"""
QC 81 · one TLS context for every HTTPS call NeuroVault makes.

On the user's sister's PC the AI engine download failed with "[SSL: CERTIFICATE_VERIFY_FAILED] certificate verify failed:
unable to get local issuer certificate". Python checks certificates against its own bundle (or OpenSSL's), so a frozen app
doesn't see the roots Windows installs only when they're first needed, or the roots an antivirus adds to inspect HTTPS.
truststore (MIT, pinned in requirements.txt) checks certificates with Windows' own certificate store instead, as a browser
does. Feedback: "yes to the trust score!"

Every download and online call goes through context() (urllib's context=, http.client's HTTPSConnection(context=)):
local_ai (engine and model downloads, the cloud AI and local server calls), guided_setup (read-aloud voices), voice
(Whisper and live words), dictionary (its download, and the online look-ups), and fonts (through local_ai.Download).
One context, made once, rather than truststore.inject_into_ssl(): nothing else in the process changes.
If truststore can't be loaded, the default context (certifi-free: Python's / OpenSSL's) is used, as before.
"""
import logging
import ssl
import threading
import urllib.request

log = logging.getLogger(__name__)
_LOCK = threading.Lock()
_CTX = None
SOURCE = None   # "truststore" or "default": which one context() made (Settings and the log can say)


def _make():
    try:
        import truststore
        ctx = truststore.SSLContext(ssl.PROTOCOL_TLS_CLIENT)   # certificates checked against Windows' store; hostnames checked
        return ctx, "truststore"
    except Exception as e:   # not bundled, or it can't load on this system: Python's own checks, as before
        log.warning("truststore unavailable (%s): HTTPS uses Python's default certificate checks", e)
        return ssl.create_default_context(), "default"


def context():
    """The one SSLContext every HTTPS call uses."""
    global _CTX, SOURCE
    if _CTX is None:
        with _LOCK:
            if _CTX is None:
                _CTX, SOURCE = _make()
    return _CTX


def urlopen(req, timeout=None):
    """urllib.request.urlopen with the shared context (an http:// URL ignores it)."""
    return urllib.request.urlopen(req, timeout=timeout, context=context())


def reset():
    """Tests: make the context again on the next call."""
    global _CTX, SOURCE
    with _LOCK:
        _CTX, SOURCE = None, None
