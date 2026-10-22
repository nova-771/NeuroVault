"""The system spell checker, per OS (platform_layer). Windows: winspell (ISpellChecker, Fix A). macOS (NSSpellChecker)
and Linux (Hunspell through pyenchant) come later: until then available() is False there, and the app's own SymSpell
autocorrect and dictionary carry on, exactly as on a Windows PC with no spell checker.

The word helpers (distance, rank, splits, split_winner, case_like) are plain Python and the same on every OS. Every name
is looked up on winspell when it's called, so a test that swaps one of winspell's functions still reaches the app."""
import sys

import winspell

_HELPERS = ("distance", "rank", "splits", "split_winner", "case_like")


def _backend():
    return winspell if sys.platform == "win32" else None


def available():
    b = _backend()
    return bool(b) and b.available()


def language():
    b = _backend()
    return b.language() if b else ""


def errors(text):
    b = _backend()
    return b.errors(text) if b else []


def is_correct(word):
    b = _backend()
    return b.is_correct(word) if b else None


def suggest(word, limit=5, more=None):
    b = _backend()
    return b.suggest(word, limit, more) if b else []


def __getattr__(name):
    if name in _HELPERS:
        return getattr(winspell, name)
    raise AttributeError(f"module {__name__!r} has no attribute {name!r}")
