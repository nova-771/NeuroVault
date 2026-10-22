"""
winspell.py: Windows' own spell checker (the Spell Checking API, ISpellChecker) for NeuroVault (Fix A, QC 3 · 26).

The same engine that draws the red lines in the editor (WebView2 asks Windows), so what's underlined and what's
suggested agree. Reached through ctypes and the COM vtables directly: nothing to install. British English (en-GB)
when Windows has it, else en-US, else the first English language it has.

    available()               True when Windows' spell checker answered
    language()                the language tag in use ("en-GB")
    errors(text)              [(start, length, action, replacement)] for a run of text; action: 1 suggest, 2 replace
                              (Windows' own autocorrect, e.g. teh → the), 3 delete (a repeated word)
    is_correct(word)          no error in the word
    suggest(word, limit=5)    the best spellings, ranked (rank() below), Windows' own first among equals

COM objects are made and used on one worker thread of their own (pywebview runs each call on a new thread), and a
call waits at most a few seconds for it. Nothing here writes to Windows' user dictionary: Add and Ignore are
NeuroVault's own (your words, a note's ignored words).
"""
import ctypes
import logging
import queue
import re
import sys
import threading

log = logging.getLogger(__name__)

_LANGS = ("en-GB", "en-US")
_TIMEOUT = 4.0


# ---- ranking (no Windows needed: tested on its own) ----
def distance(a, b):
    """Edit distance with a swapped pair counting once (optimal string alignment)."""
    la, lb = len(a), len(b)
    d = [[0] * (lb + 1) for _ in range(la + 1)]
    for i in range(la + 1):
        d[i][0] = i
    for j in range(lb + 1):
        d[0][j] = j
    for i in range(1, la + 1):
        for j in range(1, lb + 1):
            c = 0 if a[i - 1] == b[j - 1] else 1
            d[i][j] = min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + c)
            if i > 1 and j > 1 and a[i - 1] == b[j - 2] and a[i - 2] == b[j - 1]:
                d[i][j] = min(d[i][j], d[i - 2][j - 2] + 1)
    return d[la][lb]


def _subsequence(small, big):
    it = iter(big)
    return all(ch in it for ch in small)


def rank(word, candidates):
    """The candidates best first: closest spelling (a swapped pair counts once); then one that keeps every letter typed,
    in order (a missed letter is the commonest slip); then the engine's own order. One with a space or an apostrophe the
    typed word hasn't, or a different first letter, comes after the rest at the same distance."""
    w = word.lower()
    seen, out = set(), []
    for i, c in enumerate(candidates):
        k = c.lower()
        if not c or k == w or k in seen:
            continue
        seen.add(k)
        odd = (" " in c and " " not in word) + ("'" in c and "'" not in word) + (k[:1] != w[:1]) + (c[:1].isupper() and not word[:1].isupper())   # a name for a word
        split = (" " in c and " " not in word) or ("'" in c and "'" not in word)
        out.append((distance(w, k) + .6 * odd + .6 * split - (.5 if _subsequence(w, k) and not split else 0), i, c))
    return [c for _, _, c in sorted(out)]


# ==== Build N (QC 52): run-together words. Windows' checker never splits a word, so "hadnside" got nothing useful.
# A misspelled word may be two words typed without the space ("eachother" → each other, "alot" → a lot), with at most one
# slip in one of the halves ("hadn" → "hand": "hand side"). is_word is passed in (NeuroVault's dictionary, else Windows), so
# this runs, and is tested, without Windows. ====
SPLIT_SHORT = frozenset("a i an as at be by do go he if in is it me my no of on or so to up us we".split())   # the only 1–2 letter halves
_LETTERS = "abcdefghijklmnopqrstuvwxyz"


def _edits1(w):
    """(word, cost) one slip away: a swapped pair (the commonest slip, so it costs less), a missed, an extra or a wrong letter."""
    out = {}
    for i in range(len(w) - 1):
        if w[i] != w[i + 1]:
            out.setdefault(w[:i] + w[i + 1] + w[i] + w[i + 2:], .8)
    for i in range(len(w) + 1):
        for c in _LETTERS:
            out.setdefault(w[:i] + c + w[i:], 1)
            if i < len(w) and c != w[i]:
                out.setdefault(w[:i] + c + w[i + 1:], 1)
        if i < len(w):
            out.setdefault(w[:i] + w[i + 1:], 1)
    out.pop(w, None)
    return out.items()


def splits(word, is_word, slips=True, limit=3, scored=False, quick=None):
    """[(cost, "left right")], best first: the two words a misspelled word may be run together from. cost 0 when both
    halves are words, .8 or 1 with one slip in one half. A half of 1–2 letters must be a common small word (a, an, of…).
    is_word(h) gives how common a word is (0 = not a word; WordNet's sense count, say), so a tie goes to the commoner pair
    ("hand side" before "had snide"). scored=True adds that commonness: [(cost, phrase, common)]. quick(h), when given, is a
    fast first test for the hundreds of one-slip halves (an in-memory word list); the ones it lets through are checked
    with is_word."""
    low = str(word or "").lower()
    if not (4 <= len(low) <= 24) or not low.isalpha():
        return []
    ok = lambda h: (50 if h in SPLIT_SHORT else 0) if len(h) <= 2 else float(is_word(h) or 0)   # noqa: E731
    found, common = {}, {}
    for i in range(1, len(low)):
        a, b = low[:i], low[i:]
        if len(a) <= 2 and a not in SPLIT_SHORT or len(b) <= 2 and b not in SPLIT_SHORT:
            continue
        wa, wb = ok(a), ok(b)
        if wa and wb:
            found[f"{a} {b}"], common[f"{a} {b}"] = 0, min(wa, wb)
        elif slips and (wa or wb):
            bad, good = (b, wa) if wa else (a, wb)
            if len(bad) < 3:
                continue
            for e, cost in _edits1(bad):
                if len(e) < 3 or quick is not None and not quick(e):
                    continue
                we = ok(e)
                if we:
                    phrase = f"{a} {e}" if wa else f"{e} {b}"
                    if cost < found.get(phrase, 9):
                        found[phrase], common[phrase] = cost, min(good, we)
    order = sorted(found, key=lambda p: (found[p], -common[p], abs(len(p.split()[0]) - len(p.split()[1]))))[:limit]
    return [(found[p], p, common[p]) for p in order] if scored else [(found[p], p) for p in order]


def split_winner(word, is_word, best_whole=None, quick=None):
    """The one split autocorrect may use: the cheapest by a clear margin, at most one slip, and no whole-word suggestion
    as close (best_whole: the edit distance of the best one-word spelling, if any). None when it isn't clear."""
    found = splits(word, is_word, limit=4, scored=True, quick=quick)
    if not found or found[0][0] > 1:
        return None
    if len(found) > 1 and round(found[1][0] - found[0][0], 2) < .2 and found[0][2] < 4 * found[1][2]:
        return None   # as cheap as another split and not clearly the commoner pair
    if best_whole is not None and best_whole <= found[0][0] + 1:   # the space counts as a change too
        return None
    return found[0][1]
# ==== end Build N ====


def case_like(word, c):
    """A suggestion in the case the word was typed (Brithcish → British stays; teh → the; TEH → THE)."""
    if word.isupper() and len(word) > 1:
        return c.upper()
    if word[:1].isupper() and c[:1].islower():
        return c[:1].upper() + c[1:]
    return c


# ---- the COM interfaces (spellcheck.h) ----
if sys.platform == "win32":
    _HR, _P = ctypes.HRESULT, ctypes.c_void_p
    _PW = ctypes.c_wchar_p

    class _GUID(ctypes.Structure):
        _fields_ = [("a", ctypes.c_uint32), ("b", ctypes.c_uint16), ("c", ctypes.c_uint16), ("d", ctypes.c_ubyte * 8)]


def _guid(s):
    g = _GUID()
    ctypes.oledll.ole32.CLSIDFromString(ctypes.c_wchar_p("{" + s + "}"), ctypes.byref(g))
    return g


def _m(obj, index, *argtypes):
    """Method `index` of a COM object's vtable, as a callable taking the object first."""
    vtbl = ctypes.cast(obj, ctypes.POINTER(ctypes.POINTER(_P))).contents
    return ctypes.WINFUNCTYPE(_HR, _P, *argtypes)(vtbl[index])


def _release(obj):
    if obj:
        vtbl = ctypes.cast(obj, ctypes.POINTER(ctypes.POINTER(_P))).contents
        ctypes.WINFUNCTYPE(ctypes.c_ulong, _P)(vtbl[2])(obj)


def _strings(e, limit=20):
    """The strings of an IEnumString (released)."""
    out = []
    if not e:
        return out
    nxt = _m(e, 3, ctypes.c_ulong, ctypes.POINTER(_PW), ctypes.POINTER(ctypes.c_ulong))
    for _ in range(limit):
        s, n = _PW(), ctypes.c_ulong()
        nxt(e, 1, ctypes.byref(s), ctypes.byref(n))
        if n.value != 1:
            break
        out.append(s.value)
        ctypes.windll.ole32.CoTaskMemFree(s)
    _release(e)
    return out


class _Engine:
    """The checker, on its own thread: jobs go in a queue and their answers come back through an Event."""

    def __init__(self):
        self.jobs = queue.Queue()
        self.ready = threading.Event()
        self.ok, self.lang, self.chk = False, "", None
        threading.Thread(target=self._run, name="winspell", daemon=True).start()
        self.ready.wait(_TIMEOUT)

    def _run(self):
        try:
            ole32 = ctypes.oledll.ole32
            ole32.CoInitializeEx(None, 0x2)   # apartment-threaded, this thread only
            fac = _P()
            ole32.CoCreateInstance(ctypes.byref(_guid("7AB36653-1796-484B-BDFA-E74F1DB7C1DC")), None, 1,
                                   ctypes.byref(_guid("8E018A9D-2415-4677-BF08-794EA61F94BB")), ctypes.byref(fac))
            langs = _P()
            _m(fac, 3, ctypes.POINTER(_P))(fac, ctypes.byref(langs))
            have = _strings(langs, 100)
            lang = next((x for x in _LANGS if x in have), next((x for x in have if x.startswith("en")), None))
            if lang:
                chk = _P()
                _m(fac, 5, _PW, ctypes.POINTER(_P))(fac, lang, ctypes.byref(chk))
                self.chk, self.lang, self.ok = chk, lang, bool(chk)
            _release(fac)
        except OSError as e:
            log.info("Windows' spell checker isn't available (%s)", e)
        finally:
            self.ready.set()
        while True:
            fn, box, done = self.jobs.get()
            try:
                box.append(fn())
            except Exception as e:   # noqa: BLE001 - an answer of None, never a dead thread
                log.warning("spell check failed: %s", e)
                box.append(None)
            done.set()

    def call(self, fn):
        if not self.ok:
            return None
        box, done = [], threading.Event()
        self.jobs.put((fn, box, done))
        return box[0] if done.wait(_TIMEOUT) and box else None

    # ---- on the worker thread ----
    def _errors(self, text):
        e = _P()
        _m(self.chk, 4, _PW, ctypes.POINTER(_P))(self.chk, text, ctypes.byref(e))
        out = []
        if not e:
            return out
        nxt = _m(e, 3, ctypes.POINTER(_P))
        while True:
            err = _P()
            if nxt(e, ctypes.byref(err)) != 0 or not err:
                break
            st, ln, act, rep = ctypes.c_ulong(), ctypes.c_ulong(), ctypes.c_int(), _PW()
            _m(err, 3, ctypes.POINTER(ctypes.c_ulong))(err, ctypes.byref(st))
            _m(err, 4, ctypes.POINTER(ctypes.c_ulong))(err, ctypes.byref(ln))
            _m(err, 5, ctypes.POINTER(ctypes.c_int))(err, ctypes.byref(act))
            _m(err, 6, ctypes.POINTER(_PW))(err, ctypes.byref(rep))
            out.append((st.value, ln.value, act.value, rep.value or ""))
            if rep.value:
                ctypes.windll.ole32.CoTaskMemFree(rep)
            _release(err)
        _release(e)
        return out

    def _suggest(self, word):
        e = _P()
        _m(self.chk, 5, _PW, ctypes.POINTER(_P))(self.chk, word, ctypes.byref(e))
        return _strings(e, 12)


_engine = None
_lock = threading.Lock()


def _get():
    global _engine
    if sys.platform != "win32":
        return None
    with _lock:
        if _engine is None:
            _engine = _Engine()
    return _engine if _engine.ok else None


def available():
    return _get() is not None


def language():
    e = _get()
    return e.lang if e else ""


def errors(text):
    """[(start, length, action, replacement)] in text (UTF-16 offsets, the same as Python's for most text)."""
    e = _get()
    return (e.call(lambda: e._errors(str(text))) or []) if e else []


def is_correct(word):
    e = _get()
    if not e:
        return None
    r = e.call(lambda: e._errors(str(word)))
    return None if r is None else not r


_INFLECT = (("ies", "y"), ("ied", "y"), ("ier", "y"), ("iest", "y"), ("ing", ""), ("ing", "e"), ("ed", ""), ("ed", "e"),
            ("es", ""), ("s", ""), ("er", ""), ("est", ""), ("ly", ""))


def _stems(low):
    """(suffix, replacement, stem) for the longest ending the word has (cities → city; planned → plann / plane)."""
    hits = [(suf, rep) for suf, rep in _INFLECT if low.endswith(suf) and len(low) - len(suf) >= 3]
    top = max((len(suf) for suf, _ in hits), default=0)
    return [(suf, rep, low[: len(low) - len(suf)] + rep) for suf, rep in hits if len(suf) == top]


_cache = {}


def suggest(word, limit=5, more=None):
    """Up to `limit` spellings for a misspelled word, best first, in the case it was typed. Windows' own suggestions,
    plus the word's stem corrected and its ending put back (univerties → universit-ies). more(w), when given, adds close
    words from elsewhere (NeuroVault's dictionary) for the word and its stem; every candidate is checked by Windows.
    The stem is only tried when Windows has nothing a letter away that keeps every letter typed."""
    e = _get()
    word = str(word or "").strip()
    if not e or not word:
        return []
    key = (word, limit, bool(more))
    if key in _cache:
        return list(_cache[key])
    low0 = word.lower()

    def first():
        errs = e._errors(word)
        return [r for _, _, act, r in errs if act == 2 and r] + list(e._suggest(word))   # Windows' own autocorrect (teh → the) first
    cands = e.call(first) or []
    best = rank(word, cands)[:1]
    easy = best and distance(low0, best[0].lower()) <= 1 and _subsequence(low0, best[0].lower())
    if not easy:
        stems = _stems(low0)
        extra = {w: list(more(w)) for w in [low0] + [st for _, _, st in stems]} if more else {}   # on this thread: the dictionary's own connection

        def job():
            out = [x for x in extra.get(low0, []) if not e._errors(x)]
            for suf, rep, stem in stems:
                for s in e._suggest(stem)[:4] + extra.get(stem, []):
                    s = s.lower()
                    if " " in s or "'" in s:
                        continue
                    back = (s[:-1] + suf) if (rep == "y" and s.endswith("y")) else (s[: len(s) - len(rep)] + suf if rep and s.endswith(rep) else s + suf)
                    if back != low0 and not e._errors(back):
                        out.append(back)
            return out
        cands += e.call(job) or []
    out = [case_like(word, c) for c in rank(word, cands)[:limit]]
    if len(_cache) > 500:
        _cache.clear()
    _cache[key] = out
    return list(out)


WORD_RE = re.compile(r"[A-Za-zÀ-ÖØ-öø-ÿ][A-Za-zÀ-ÖØ-öø-ÿ'’-]*")
