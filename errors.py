"""
errors.py — Build N, v0.1.1 (QC 90; UI cohesion review must-fix 2): a failure in plain words, never Python's own text.

The user's sister saw "<urlopen error [SSL: CERTIFICATE_VERIFY_FAILED] …>". Every network or download failure (a certificate, no
internet, a name that doesn't resolve, a timeout, 401/403/404/429/5xx, a full disk, no permission, a missing file, a cancel) is
one sentence of what happened plus what to do. The technical detail goes to neurovault.log (and, where a screen offers "Details",
into the result's "detail"), never into the message itself.

    plain_error(e, doing="")      an exception → the sentence (logs the detail)
    plain_message(text, doing="") text that may already hold an exception's words → the sentence (unchanged if it's plain)
    looks_raw(text)               True when text carries Python exception text (the checks use the same pattern)
"""
import errno
import json
import logging
import re
import socket
import sqlite3
import ssl
import urllib.error
import zlib

log = logging.getLogger(__name__)

# Python's own words in a message: what must never reach the screen
RAW = re.compile(r"urlopen error|\[Errno \d+\]|Errno \d+|\[WinError \d+\]|Traceback|_ssl\b|\bSSL:|CERTIFICATE_VERIFY|getaddrinfo|"
                 r"HTTP Error \d{3}|<[a-z_.]+ (?:error|object)|\b[A-Z][A-Za-z]*(?:Error|Exception)\b(?::|\()|Unexpected error:", re.I)

CERT = ("NeuroVault couldn't check the site's security certificate, so nothing was downloaded. This happens on some work or school "
        "networks, and when the PC's date and time are wrong: check the clock, or try another network.")
OFFLINE = "NeuroVault couldn't reach the internet. Check that you're online, then try again."
CUT = "The connection was cut off. Try again in a moment."
REFUSED = "The site didn't answer. Check that you're online, then try again."
SLOW = "The site took too long to answer. Check your connection, then try again."
FULL = "The disk is full. Free some space, then try again."
DENIED = "Windows didn't let NeuroVault use that file or folder. Close any program that has it open, then try again."
GONE = "A file NeuroVault needed isn't there any more."
DAMAGED = "The download arrived damaged. Try again."
STOPPED = "Stopped."
GENERIC = "Something went wrong. Try again; if it keeps happening, the details are in neurovault.log."


def _http(code):
    if code in (401, 403):
        return f"The site refused access ({code}). If it needs a key, check the key; otherwise try again later."
    if code == 404:
        return "The file isn't on the site any more (404). NeuroVault may need an update."
    if code == 429:
        return "The site says too many requests for now (429). Wait a minute, then try again."
    if code and code >= 500:
        return f"The site had a problem on its side ({code}). Try again later."
    return f"The site said no ({code}). Try again later." if code else GENERIC


def _with(doing, sentence):
    return f"Couldn't {doing}. {sentence}" if doing and sentence not in (STOPPED,) else sentence


def plain_error(e, doing=""):
    """The sentence for an exception. App errors that are already plain (they don't look raw) keep their own words."""
    log.info("%s: %r", doing or "error", e, exc_info=isinstance(e, BaseException) and not isinstance(e, (urllib.error.URLError, OSError)))
    s = _classify(e)
    if s is None:
        text = str(e) if e is not None else ""
        return text if text.strip() and not looks_raw(text) else _with(doing, plain_message(text) if text.strip() else GENERIC)
    return _with(doing, s)


def _classify(e):
    if e is None:
        return GENERIC
    name = type(e).__name__
    if name in ("JobCancelled", "CancelledError", "KeyboardInterrupt") or "cancel" in name.lower():
        return STOPPED
    if isinstance(e, urllib.error.HTTPError):
        return _http(e.code)
    if isinstance(e, (ssl.SSLCertVerificationError,)) or "CERTIFICATE_VERIFY" in str(e):
        return CERT
    if isinstance(e, urllib.error.URLError):
        return _classify(e.reason) if isinstance(e.reason, BaseException) else plain_message(str(e.reason))
    if isinstance(e, ssl.SSLError):
        return CERT if "CERTIFICATE" in str(e).upper() else CUT
    if isinstance(e, (socket.timeout, TimeoutError)):
        return SLOW
    if isinstance(e, socket.gaierror):
        return OFFLINE
    if isinstance(e, ConnectionRefusedError):
        return REFUSED
    if isinstance(e, (ConnectionResetError, ConnectionAbortedError, BrokenPipeError)):
        return CUT
    if name == "BadZipFile" or isinstance(e, (EOFError, zlib.error)):
        return DAMAGED
    # a programming slip or a store error: its text ("'x'", "Expecting value: line 1", "database is locked") means nothing to the user
    if isinstance(e, (KeyError, AttributeError, TypeError, IndexError, NameError, ZeroDivisionError, UnicodeError, AssertionError,
                      RecursionError, MemoryError, sqlite3.Error, json.JSONDecodeError)):
        return GENERIC
    if isinstance(e, OSError):
        if e.errno == errno.ENOSPC or getattr(e, "winerror", None) in (39, 112):
            return FULL
        if e.errno in (errno.EACCES, errno.EPERM) or getattr(e, "winerror", None) in (5, 32, 33):
            return DENIED
        if e.errno == errno.ENOENT or getattr(e, "winerror", None) in (2, 3):
            return GONE
        if getattr(e, "winerror", None) in (10060,) or e.errno == errno.ETIMEDOUT:
            return SLOW
        if getattr(e, "winerror", None) in (11001, 11002, 10065, 10051) or e.errno in (errno.ENETUNREACH, errno.EHOSTUNREACH):
            return OFFLINE
        if getattr(e, "winerror", None) == 10061 or e.errno == errno.ECONNREFUSED:
            return REFUSED
        if getattr(e, "winerror", None) in (10054, 10053) or e.errno == errno.ECONNRESET:
            return CUT
        return GENERIC
    return None   # not a network or file failure: an app error with its own words, or something unexpected


def looks_raw(text):
    return bool(RAW.search(str(text or "")))


def plain_message(text, doing=""):
    """Text that may already carry an exception's words → the sentence. Plain text is left as it is."""
    t = str(text or "")
    if not looks_raw(t):
        return t
    log.info("raw message replaced: %s", t[:400])
    u = t.upper()
    if "CERTIFICATE" in u or "SSL" in u and "VERIFY" in u:
        s = CERT
    elif "GETADDRINFO" in u or "NAME OR SERVICE" in u or "11001" in u or "NETWORK IS UNREACHABLE" in u or "NO ROUTE" in u:
        s = OFFLINE
    elif "TIMED OUT" in u or "TIMEOUT" in u or "10060" in u:
        s = SLOW
    elif m := re.search(r"HTTP Error (\d{3})", t, re.I):
        s = _http(int(m.group(1)))
    elif "NO SPACE" in u or "ERRNO 28" in u or "DISK" in u and "FULL" in u:
        s = FULL
    elif "PERMISSION DENIED" in u or "ERRNO 13" in u or "WINERROR 5]" in u or "WINERROR 32" in u or "ACCESS IS DENIED" in u:
        s = DENIED
    elif "NO SUCH FILE" in u or "ERRNO 2]" in u or "CANNOT FIND THE" in u:
        s = GONE
    elif "CONNECTION REFUSED" in u or "10061" in u or "ACTIVELY REFUSED" in u:
        s = REFUSED
    elif "CONNECTION RESET" in u or "10054" in u or "REMOTE END CLOSED" in u:
        s = CUT
    else:
        s = GENERIC
    return _with(doing, s)
