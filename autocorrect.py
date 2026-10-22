"""
autocorrect.py — Build N · QC 76: autocorrect that feels like Gboard and learns from you (design profile, "Autocorrect feels
like Gboard and learns from you"). Feedback: "yes lets add symspell! I really like the gboard keyboard auto correct. Also, is
it trainable???"

SymSpell's way of ranking (Wolf Garbe; the method, written here, not the library): every word within two edits of what was
typed, ranked by how often it's used (SymSpell's frequency_dictionary_en_82_765.txt: Google Books Ngram counts matched with
SCOWL, downloaded with the user's yes into the dictionary folder) and, like Gboard, by how likely the slip is on a keyboard:
a key next to the right one, a doubled key, a swapped pair or a dropped vowel cost less than any other edit.

The candidates come from a bounded scan rather than SymSpell's delete index: the words of each length within two edits, a
letter-set test first (dictionary.letter_mask), then the edit distance. That finds the same words for a fraction of the RAM
(the delete index would be about 2.4 million entries; this keeps the 82,765 words).

Learning, on this PC only (api.py): words in your notes count as used more; a correction you undo isn't made again for that
word; your words and ignored words are never flagged. Nothing leaves the PC.
"""
import math
import os
import threading

import dictionary as dictmod

FREQ_FILE = "frequency_dictionary_en_82_765.txt"
# A slip's cost (1 = an ordinary edit). Calibrated on the user's test (usefull, opnion, recived, aalot) and common misspellings
COST = {"near": .55, "sub": 1.0, "swap": .5, "double": .4, "extra_near": .7, "extra": 1.0, "vowel": .5, "missed_double": .5, "missed": .9}
WEIGHT = 3.0     # how much one edit counts against ten times the use (log10 of the frequency)
MARGIN = .8      # how far ahead the best guess must be for autocorrect to act (log10 units: about six times as likely)
VOWELS = set("aeiou")
_ROWS = ("qwertyuiop", "asdfghjkl", "zxcvbnm")
_POS = {ch: (r, c + (0, .25, .75)[r]) for r, row in enumerate(_ROWS) for c, ch in enumerate(row)}


def near_keys(a, b):
    """Two letters on neighbouring keys (the same row or the rows above and below, QWERTY)."""
    pa, pb = _POS.get(a), _POS.get(b)
    return bool(pa and pb and a != b and abs(pa[0] - pb[0]) <= 1 and abs(pa[1] - pb[1]) <= 1.01)


def typo_cost(typed, word):
    """How likely `typed` is a slip for `word`: an edit distance (a swapped pair counting once) where each edit costs what
    it would on a keyboard (COST)."""
    t, w = typed.lower(), word.lower()
    n, m = len(t), len(w)
    big = 99.0
    d = [[big] * (m + 1) for _ in range(n + 1)]
    d[0][0] = 0.0
    for i in range(n + 1):
        for j in range(m + 1):
            if i == 0 and j == 0:
                continue
            best = big
            if i and j:   # the same letter, or one key for another
                c = 0.0 if t[i - 1] == w[j - 1] else COST["near"] if near_keys(t[i - 1], w[j - 1]) else COST["sub"]
                best = d[i - 1][j - 1] + c
            if i:   # a letter typed that the word hasn't: a doubled key, a neighbour of the one before or after, or any
                ch = t[i - 1]
                if (i > 1 and t[i - 2] == ch) or (i < n and t[i] == ch):
                    c = COST["double"]
                elif (i > 1 and near_keys(t[i - 2], ch)) or (i < n and near_keys(t[i], ch)):
                    c = COST["extra_near"]
                else:
                    c = COST["extra"]
                best = min(best, d[i - 1][j] + c)
            if j:   # a letter of the word not typed: a dropped vowel, one of a double, or any
                ch = w[j - 1]
                if (j > 1 and w[j - 2] == ch) or (j < m and w[j] == ch):
                    c = COST["missed_double"]
                elif ch in VOWELS:
                    c = COST["vowel"]
                else:
                    c = COST["missed"]
                best = min(best, d[i][j - 1] + c)
            if i > 1 and j > 1 and t[i - 1] == w[j - 2] and t[i - 2] == w[j - 1] and t[i - 1] != t[i - 2]:
                best = min(best, d[i - 2][j - 2] + COST["swap"])
            d[i][j] = best
    return d[n][m]


class Speller:
    """The frequency list in memory, by length, and the ranking."""

    def __init__(self, path):
        self.path = path
        self._lock = threading.Lock()
        self.freq = None      # word -> count
        self.by_len = None    # length -> [(word, letter mask)]

    def ready(self):
        return bool(self.path and os.path.isfile(self.path))

    def load(self):
        if self.freq is not None or not self.ready():
            return self.freq is not None
        with self._lock:
            if self.freq is None:
                freq, by_len = {}, {}
                with open(self.path, encoding="utf-8-sig") as f:
                    for line in f:
                        p = line.split()
                        if len(p) == 2 and p[1].isdigit():
                            w = p[0].lower()
                            freq[w] = int(p[1])
                            by_len.setdefault(len(w), []).append((w, dictmod.letter_mask(w)))
                self.by_len, self.freq = by_len, freq
        return True

    def count(self, w):
        return (self.freq or {}).get(w.lower(), 0)

    def near(self, typed, limit=2):
        """Words of the list within `limit` edits of `typed` (any first letter)."""
        if not self.load():
            return []
        q = typed.lower()
        mq, cap, out = dictmod.letter_mask(q), 2 * limit, []
        for n in range(max(1, len(q) - limit), len(q) + limit + 1):
            for w, mk in self.by_len.get(n, ()):
                if w != q and (mq ^ mk).bit_count() <= cap and dictmod.distance(w, q, limit) <= limit:
                    out.append(w)
        return out

    def rank(self, typed, extra=(), boost=None):
        """[(score, cost, word)] best first: log10 of how often the word is used (plus what your notes add, `boost`) less
        WEIGHT × the slip's cost. `extra`: more candidates (Windows' suggestions, your words, your notes' words)."""
        boost = boost or {}
        seen, out = set(), []
        for w in [*self.near(typed), *extra]:
            k = w.lower()
            if k in seen or k == typed.lower() or " " in k:
                continue
            seen.add(k)
            f = self.count(k) + boost.get(k, 0)
            if f <= 0:
                f = 1   # a word Windows or you know but the list hasn't: it can still win on a small slip
            c = typo_cost(typed, k)
            if c > 2.2:
                continue
            out.append((math.log10(f) - WEIGHT * c, c, w))
        out.sort(key=lambda x: (-x[0], x[1], x[2]))
        return out


def freq_path():
    """The frequency list: the dictionary folder (downloaded there), else next to the app (a packaged copy)."""
    for d in (dictmod.dict_dir(), os.path.dirname(os.path.abspath(__file__))):
        p = os.path.join(d, FREQ_FILE)
        if os.path.isfile(p):
            return p
    return os.path.join(dictmod.dict_dir(), FREQ_FILE)
