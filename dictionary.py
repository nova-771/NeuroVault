"""
dictionary.py: the dictionary and thesaurus, with your own words (Build J, mockup R37, locked 2026-10-16).

Two sources, searched together:

1. **Open English WordNet** (CC BY 4.0, from en-word.net, built on Princeton WordNet). dict_list.json (in the repo,
   like font_list.json) pins the release file: its URL, byte size and sha256. It downloads once, only after the
   page has shown the ask (file, source, size), through Build B's local_ai.Download (HTTP ranges, cancel, size and
   sha256 checks). The file is WN-LMF XML, gzipped. It is then read once into a SQLite index on this PC
   (<dict folder>/<id>.sqlite), and the download is deleted. The folder is %LOCALAPPDATA%\\NeuroVault\\dictionary,
   next to the AI models; NEUROVAULT_DICT overrides it and NEUROVAULT_DICT_LIST the list (dev and tests).

2. **Your own words**, which travel with the vault. The file is .neurovault/glossary.json next to the database (the
   vault, later), as Build E does for fonts. It is the truth; the my_words table in the database is only its index.
   - Written: the whole file at once, as UTF-8 JSON, sorted by word, to glossary.json.tmp first and then moved over
     the old file (os.replace), so a crash never leaves half a file.
   - Read back: every call compares the file's size and modified time with the last read. When they differ (the vault
     was synced or copied from another PC) the file is read again and the index is rebuilt to match it.
   - A file that can't be read is never overwritten: your words come from the index meanwhile, and the next save
     first moves the bad file aside as glossary.unreadable-<date>.json.
   - A missing file while the index still has words (a vault copied without .neurovault) is written again from the index.

Search is fuzzy and tolerant of misspellings: the exact word, words that start with what you typed, close spellings
(edit distance 1, or 2 past six letters, a swapped pair counting once), words that sound alike (a sound skeleton:
first letter plus consonants), the dictionary form of an inflected word ("consolidated" → consolidate), and words
whose meanings mention it.
"""
import gzip
import hashlib
import json
import logging
import os
import re
import shutil
import socket
import sqlite3
import threading
import time
import urllib.parse
import xml.etree.ElementTree as ET
from datetime import date, datetime
import errors
from errors import plain_error  # v0.1.1 (QC 90): failures in plain words, the detail in the log

import local_ai  # Build B's Download

log = logging.getLogger(__name__)

LIST_PATH = os.environ.get("NEUROVAULT_DICT_LIST") or os.path.join(os.path.dirname(os.path.abspath(__file__)), "dict_list.json")
INDEX_VERSION = "2"            # bump when the SQLite layout changes: an older index is built again from a new download
PROBE_SECONDS = 30             # how long "online" / "offline" is trusted
POS_NAMES = {"n": "noun", "v": "verb", "a": "adjective", "s": "adjective", "r": "adverb", "c": "conjunction", "p": "preposition"}
MY_POS = ("noun", "verb", "adjective", "adverb", "other")
MAX_WORD, MAX_DEF, MAX_EX, MAX_TAGS = 80, 2000, 500, 12
TAG_RE = re.compile(r"^[a-z0-9][a-z0-9_/-]{0,39}$")


class DictError(Exception):
    """A message to show as it is; `field` names the form box it is about (word, def, ex, tags, pos)."""
    def __init__(self, message, field=None):
        super().__init__(message)
        self.field = field


def dict_dir():
    import platform_layer
    return os.environ.get("NEUROVAULT_DICT") or os.path.join(platform_layer.data_dir(), "dictionary")


def glossary_path(base):
    """<base>/.neurovault/glossary.json; base is the folder that holds the database (the vault, later)."""
    return os.path.join(base, ".neurovault", "glossary.json")


# ======================================================================
# Words: the search key, the sound skeleton, syllables, dictionary forms
# ======================================================================

def norm(s):
    """The search key: lower case, curly apostrophes straightened, only letters, apostrophes, hyphens and spaces."""
    s = str(s or "").lower().replace("’", "'").replace("_", " ")
    s = re.sub(r"[^\w' -]|\d", "", s)
    return re.sub(r"\s+", " ", s).strip()


def skel(k):
    """First letter plus consonants, ph→f, ck→k, a hard c→k, doubles collapsed: words that sound alike share it."""
    if not k:
        return ""
    s = k.replace("ph", "f").replace("ck", "k")
    s = re.sub(r"c(?![eiy])", "k", s)
    s = re.sub(r"(.)\1+", r"\1", s)
    return s[0] + re.sub(r"[aeiouyhw' -]", "", s[1:])


_MASKS = {}


def letter_mask(w):
    """Build N (QC 62): which of a–z a word has, as bits. One edit changes that set by at most two letters (a swapped pair by
    none), so words more than 2 × limit letters apart can't be within `limit` edits: a free test before distance()."""
    m = _MASKS.get(w)
    if m is None:
        m = 0
        for ch in w:
            o = ord(ch) - 97
            if 0 <= o < 26:
                m |= 1 << o
        if len(_MASKS) < 400000:
            _MASKS[w] = m
    return m


def distance(a, b, limit=2):
    """Edit distance with a swapped pair counting once (optimal string alignment), worked out only within `limit`
    of the diagonal: anything over `limit` comes back as limit + 1."""
    la, lb = len(a), len(b)
    if abs(la - lb) > limit:
        return limit + 1
    if a == b:
        return 0
    big = limit + 1
    prev2, prev = None, [j if j <= limit else big for j in range(lb + 1)]
    for i in range(1, la + 1):
        cur = [big] * (lb + 1)
        if i <= limit:
            cur[0] = i
        lo, hi, ai, low = max(1, i - limit), min(lb, i + limit), a[i - 1], cur[0]
        for j in range(lo, hi + 1):
            v = prev[j - 1] + (ai != b[j - 1])
            x = prev[j] + 1
            if x < v:
                v = x
            x = cur[j - 1] + 1
            if x < v:
                v = x
            if i > 1 and j > 1 and ai == b[j - 2] and a[i - 2] == b[j - 1]:
                x = prev2[j - 2] + 1
                if x < v:
                    v = x
            cur[j] = v if v < big else big
            if v < low:
                low = v
        if low > limit:
            return big
        prev2, prev = prev, cur
    return min(prev[lb], big)


_ONSETS = {"bl", "br", "ch", "cl", "cr", "dr", "dw", "fl", "fr", "gl", "gr", "kn", "ph", "pl", "pr", "qu", "sc", "sh", "sk",
           "sl", "sm", "sn", "sp", "st", "sw", "th", "tr", "tw", "wh", "wr", "chr", "sch", "scr", "shr", "sph", "spl", "spr",
           "squ", "str", "thr"}
_SPLIT_PAIRS = ("ia", "io", "eo", "ua", "uo", "iu", "ea")   # two vowels that are usually two syllables (with exceptions below)


def _syllables_word(w):
    low = w.lower()
    if len(low) <= 3 or not re.fullmatch(r"[a-z']+", low):
        return [w]
    vow = [c in "aeiou" or (c == "y" and i > 0 and low[i - 1] not in "aeiou") for i, c in enumerate(low)]
    # a silent final e (but "-le" after a consonant is a syllable), and -es / -ed that add none
    n = len(low)
    if low.endswith("e") and n > 2 and not vow[n - 2] and not (low.endswith("le") and n > 3 and not vow[n - 3]):
        vow[n - 1] = False
    if low.endswith("ed") and n > 3 and low[n - 3] not in "td" and not vow[n - 3]:
        vow[n - 2] = False
    if low.endswith("es") and n > 3 and low[n - 3] not in "sxzcg" and not low.endswith(("ches", "shes")) and not vow[n - 3]:
        vow[n - 2] = False
    for m in re.finditer(r"(?<=[^aeiouy])e(?=(ly|ment|ful|ness|less|ty)$)", low):   # safe·ty, def·i·nite·ly: a silent e before a suffix
        vow[m.start()] = False
    nuclei, i = [], 0
    while i < n:
        if vow[i]:
            j = i
            while j + 1 < n and vow[j + 1]:
                j += 1
            group = low[i:j + 1]
            # "-tion", "-sion", "-cian", "-tial", "-cial", "-gion": one syllable; other ia / io / eo… pairs are two
            cut = None
            for k in range(len(group) - 1):
                if group[k:k + 2] in _SPLIT_PAIRS and not (i + k > 0 and low[i + k - 1] in "tscgx" and group[k:k + 2] in ("ia", "io")) \
                        and not (group[k:k + 2] == "ea" and not (i + k + 2 == n)):
                    cut = i + k + 1
                    break
            if cut:
                nuclei += [(i, cut), (cut, j + 1)]
            else:
                nuclei.append((i, j + 1))
            i = j + 1
        else:
            i += 1
    if len(nuclei) <= 1:
        return [w]
    cuts = []
    for (s1, e1), (s2, e2) in zip(nuclei, nuclei[1:]):
        c = low[e1:s2]
        if not c:
            cuts.append(s2)
        elif e2 == n and low.endswith("le") and s2 == n - 1 and len(c) >= 1:   # ta·ble, can·dle
            cuts.append(s2 - 2)
        elif len(c) == 1:
            cuts.append(e1 + (1 if c == "x" else 0))
        elif c.startswith("ck"):
            cuts.append(e1 + 2)
        else:
            k = next((k for k in range(min(3, len(c) - 1), 0, -1) if k == 1 or c[-k:] in _ONSETS), 1)
            cuts.append(s2 - k)
    out, at = [], 0
    for cpos in cuts:
        out.append(w[at:cpos])
        at = cpos
    out.append(w[at:])
    return [p for p in out if p]


def syllables(word):
    """"consolidate" → "con·so·li·date": rules on spelling (WordNet has no syllables), right in most everyday words."""
    return " ".join("·".join(_syllables_word(p)) for p in str(word).split(" ")) if word else ""


def base_forms(k):
    """Dictionary forms an inflected word may come from (WordNet's morphy rules): "consolidated" → consolidate…"""
    out = []
    rules = (("ies", "y"), ("ied", "y"), ("ier", "y"), ("iest", "y"), ("ves", "f"), ("ves", "fe"), ("sses", "ss"), ("xes", "x"), ("ches", "ch"), ("shes", "sh"),
             ("es", "e"), ("es", ""), ("s", ""), ("ed", "e"), ("ed", ""), ("ing", "e"), ("ing", ""), ("er", ""), ("er", "e"), ("est", ""), ("est", "e"), ("ly", ""))
    for suf, rep in rules:
        if k.endswith(suf) and len(k) - len(suf) >= 2:
            b = k[:-len(suf)] + rep
            out.append(b)
            if rep == "" and len(b) > 2 and b[-1] == b[-2] and b[-1] not in "aeiouls":   # stopped → stop
                out.append(b[:-1])
    return list(dict.fromkeys(out))


# Sounds alike, or easily mixed up (homophones and near-homophones). A word's own entry lists the others.
SOUND_SETS = [
    "accept except", "affect effect", "aisle isle", "allowed aloud", "altar alter", "ate eight", "bare bear", "base bass",
    "berry bury", "berth birth", "board bored", "brake break", "buy by bye", "capital capitol", "cell sell", "cent scent sent",
    "cereal serial", "chord cord", "cite sight site", "coarse course", "complement compliment", "council counsel",
    "creak creek", "desert dessert", "dew due", "die dye", "discreet discrete", "draft draught", "dual duel",
    "elicit illicit", "ensure insure", "fair fare", "farther further", "flea flee", "flour flower", "for four fore",
    "foul fowl", "grate great", "hair hare", "heal heel", "hear here", "heard herd", "hole whole", "hour our",
    "idle idol", "its it's", "knew new", "knight night", "knot not", "know no", "lead led", "lessen lesson",
    "loan lone", "loose lose", "made maid", "mail male", "main mane", "meat meet", "medal meddle", "morning mourning",
    "none nun", "one won", "pail pale", "pain pane", "pair pare pear", "passed past", "patience patients", "peace piece",
    "peak peek pique", "pedal peddle", "personal personnel", "plain plane", "pore pour", "pray prey", "precede proceed",
    "presence presents", "principal principle", "quiet quite", "rain reign rein", "rap wrap", "read reed", "real reel",
    "right rite write", "ring wring", "road rode rowed", "role roll", "root route", "sail sale", "scene seen",
    "sea see", "seam seem", "sew so sow", "sole soul", "some sum", "son sun", "stair stare", "stationary stationery",
    "steal steel", "suite sweet", "tail tale", "than then", "their there they're", "threw through", "throne thrown",
    "tide tied", "to too two", "toe tow", "vain vane vein", "vary very", "waist waste", "wait weight", "warn worn",
    "way weigh", "weak week", "wear where", "weather whether", "which witch", "whose who's", "wood would",
    "your you're", "yoke yolk", "advice advise", "breath breathe", "cloth clothe", "dairy diary", "later latter",
    "lightening lightning", "lose loss", "moral morale", "quiet quit", "sight site", "thorough through",
    "freeze frees frieze",
]
# ==== Fix A (QC 3 · 26): small words WordNet leaves out (it has nouns, verbs, adjectives and adverbs only): never
# called misspelled. Contractions are spelled with a straight apostrophe, as norm() leaves them ====
COMMON_WORDS = set("""
a an the and or but nor so yet for of to in on at by from with without within into onto upon about above below over under
after before since until till than then as if because though although while whereas whether unless once whenever wherever
i me my mine myself you your yours yourself yourselves he him his himself she her hers herself it its itself we us our ours
ourselves they them their theirs themselves this that these those who whom whose which what whatever whoever whichever
where when why how there here is am are was were be been being have has had having do does did doing done will would
shall should can could may might must ought not no yes nope yeah also very just only even still already again ever never
always often sometimes more most less least much many few some any every each all both either neither none other another
such own same etc ok okay vs via eg ie hi hello thanks thank please sorry oh um uh
don't doesn't didn't isn't aren't wasn't weren't won't wouldn't can't couldn't shouldn't mustn't haven't hasn't hadn't
i'm i've i'll i'd you're you've you'll you'd he's he'll he'd she's she'll she'd it's it'll we're we've we'll we'd
they're they've they'll they'd let's that's there's here's what's who's where's when's how's
""".split())
# ==== end Fix A ====
SOUNDS = {}
for _set in SOUND_SETS:
    _ws = _set.split()
    for _w in _ws:
        SOUNDS.setdefault(_w, [])
        SOUNDS[_w] += [x for x in _ws if x != _w and x not in SOUNDS[_w]]


# ======================================================================
# The dictionary list (dict_list.json)
# ======================================================================

def load_list(path=None):
    """{updated, dictionaries: [...]} with only complete entries (id, name, file, url, bytes, sha256)."""
    try:
        with open(path or LIST_PATH, encoding="utf-8") as fh:
            raw = json.load(fh)
    except (OSError, ValueError) as e:
        log.warning("dictionary list not read (%s)", e)
        return {"updated": "", "dictionaries": []}
    out = []
    for x in raw.get("dictionaries", []):
        ok = (re.fullmatch(r"[a-z0-9][a-z0-9-]{0,63}", str(x.get("id", ""))) and x.get("name")
              and str(x.get("file", "")) == os.path.basename(str(x.get("file", ""))) and str(x.get("file", "")).endswith(".xml.gz")
              and isinstance(x.get("bytes"), int) and x["bytes"] > 0 and re.fullmatch(r"[0-9a-f]{64}", str(x.get("sha256", "")))
              and urllib.parse.urlparse(str(x.get("url", ""))).scheme in ("https", "http"))
        if ok:
            out.append(x)
        else:
            log.warning("dictionary list: entry %r left out", x.get("id"))
    return {"updated": raw.get("updated", ""), "dictionaries": out}


# ======================================================================
# WN-LMF XML (gzipped) → the SQLite index
# ======================================================================

INDEX_SCHEMA = """
CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT);
CREATE TABLE words (id INTEGER PRIMARY KEY, word TEXT NOT NULL, key TEXT NOT NULL UNIQUE, skel TEXT NOT NULL, nsenses INTEGER NOT NULL);
CREATE TABLE forms (key TEXT NOT NULL, word_id INTEGER NOT NULL);
CREATE TABLE synsets (id INTEGER PRIMARY KEY, pos TEXT NOT NULL, def TEXT NOT NULL, examples TEXT NOT NULL);
CREATE TABLE senses (word_id INTEGER NOT NULL, synset_id INTEGER NOT NULL, ord INTEGER NOT NULL);
CREATE TABLE antonyms (word_id INTEGER NOT NULL, pos TEXT NOT NULL, other_id INTEGER NOT NULL);
CREATE TABLE similar (synset_id INTEGER NOT NULL, other_id INTEGER NOT NULL);
"""
INDEX_AFTER = """
CREATE INDEX words_skel ON words(skel);
CREATE INDEX forms_key ON forms(key);
CREATE INDEX senses_word ON senses(word_id);
CREATE INDEX senses_synset ON senses(synset_id);
CREATE INDEX antonyms_word ON antonyms(word_id);
CREATE INDEX similar_synset ON similar(synset_id);
"""


class _Counting:
    """A file object that counts the bytes read, for the build's progress."""
    def __init__(self, f):
        self.f, self.n = f, 0

    def read(self, size=-1):
        b = self.f.read(size)
        self.n += len(b)
        return b


def _clean_example(t):
    t = (t or "").strip()
    if len(t) >= 2 and t[0] in "\"“'" and t[-1] in "\"”'":
        t = t[1:-1].strip()
    return t


def build_index(gz_path, out_path, meta=None, progress=None, stop=None):
    """Reads a WN-LMF .xml.gz into a fresh SQLite index at out_path (written to out_path.tmp, then moved in).
    progress(fraction) is called as it reads; stop() returning True abandons it. Returns the word count."""
    tmp = out_path + ".tmp"
    if os.path.exists(tmp):
        os.remove(tmp)
    total = os.path.getsize(gz_path) or 1
    words, forms, synsets, senses, ant_rel, sense_owner, sim_rel = {}, [], {}, [], [], {}, []

    def word_id(written):
        k = norm(written)
        if not k:
            return None
        w = words.get(k)
        if w is None:
            w = words[k] = {"id": len(words) + 1, "word": written, "n": 0}
        elif w["word"] != written and written == k:   # prefer the plain lower-case spelling for the display
            w["word"] = written
        return w["id"]

    raw = open(gz_path, "rb")
    counter = _Counting(raw)
    kind = lambda el: el.tag.rsplit("}", 1)[-1]   # noqa: E731 - the tag without a namespace
    try:
        with gzip.GzipFile(fileobj=counter) as gz:
            lexicon, entry_wid, entry_pos, last = None, None, None, 0
            for ev, el in ET.iterparse(gz, events=("start", "end")):
                tag = kind(el)
                if ev == "start":
                    if tag == "Lexicon":
                        lexicon = el
                    elif tag == "LexicalEntry":
                        entry_wid, entry_pos = None, None
                    continue
                if tag == "Lemma":
                    entry_wid = word_id(el.get("writtenForm", ""))
                    entry_pos = POS_NAMES.get(el.get("partOfSpeech", ""), "other")
                elif tag == "Form" and entry_wid:
                    k = norm(el.get("writtenForm", ""))
                    if k:
                        forms.append((k, entry_wid))
                elif tag == "Sense" and entry_wid and el.get("synset"):
                    senses.append((entry_wid, el.get("synset"), len(senses)))
                    sense_owner[el.get("id")] = (entry_wid, entry_pos)
                    ant_rel.extend((el.get("id"), r.get("target")) for r in el if kind(r) == "SenseRelation" and r.get("relType") == "antonym")
                elif tag == "Synset":
                    defs = [x.text for x in el if kind(x) == "Definition"]
                    exs = [_clean_example(x.text) for x in el if kind(x) == "Example"]
                    synsets[el.get("id")] = (len(synsets) + 1, POS_NAMES.get(el.get("partOfSpeech", ""), "other"),
                                             (defs[0] or "").strip() if defs else "", [x for x in exs if x][:3])
                    # adjectives link their near-synonyms through "similar" (beautiful → lovely, attractive…)
                    sim_rel.extend((el.get("id"), r.get("target")) for r in el if kind(r) == "SynsetRelation" and r.get("relType") == "similar")
                if tag in ("LexicalEntry", "Synset") and lexicon is not None:
                    lexicon.clear()   # done with it: keeps memory flat across the whole file
                if progress and counter.n - last > 262144:
                    last = counter.n
                    progress(min(.95, counter.n / total * .95))
                    if stop and stop():
                        return 0
    finally:
        raw.close()
    if not words or not synsets:
        raise DictError("The dictionary file has no words in it. Try the download again.")
    counts = {}
    for wid, syn, _ in senses:
        if syn in synsets:
            counts[wid] = counts.get(wid, 0) + 1
    con = sqlite3.connect(tmp)
    try:
        con.executescript(INDEX_SCHEMA)
        con.executemany("INSERT INTO words VALUES (?,?,?,?,?)", ((w["id"], w["word"], k, skel(k), counts.get(w["id"], 0)) for k, w in words.items()))
        con.executemany("INSERT INTO forms VALUES (?,?)", forms)
        con.executemany("INSERT INTO synsets VALUES (?,?,?,?)", ((sid, pos, d, json.dumps(ex, ensure_ascii=False)) for sid, pos, d, ex in synsets.values()))
        con.executemany("INSERT INTO senses VALUES (?,?,?)", ((wid, synsets[syn][0], o) for wid, syn, o in senses if syn in synsets))
        ants = set()
        for sid, target in ant_rel:
            a, b = sense_owner.get(sid), sense_owner.get(target)
            if a and b and a[0] != b[0]:
                ants.add((a[0], a[1], b[0]))
        con.executemany("INSERT INTO antonyms VALUES (?,?,?)", sorted(ants))
        con.executemany("INSERT INTO similar VALUES (?,?)", sorted({(synsets[a][0], synsets[b][0]) for a, b in sim_rel if a in synsets and b in synsets}))
        con.executescript(INDEX_AFTER)
        fts = True
        try:
            con.execute("CREATE VIRTUAL TABLE defs USING fts5(def, content='synsets', content_rowid='id', tokenize='porter unicode61')")
            con.execute("INSERT INTO defs(rowid, def) SELECT id, def FROM synsets")
        except sqlite3.OperationalError:   # a Python built without FTS5: "in meanings" falls back to LIKE
            fts = False
        info = {**(meta or {}), "index_version": INDEX_VERSION, "words": str(len(words)), "synsets": str(len(synsets)),
                "built": datetime.now().isoformat(timespec="seconds"), "fts": "1" if fts else "0"}
        con.executemany("INSERT INTO meta VALUES (?,?)", info.items())
        con.commit()
    finally:
        con.close()
    os.replace(tmp, out_path)
    if progress:
        progress(1.0)
    return len(words)


# ======================================================================
# The manager: download, build, search, entries and your words
# ======================================================================

class Dictionary:
    """base: the folder that holds the database (callable or str). db: the app's Database (for the my_words index).
    cfg / save: the config and its saver (the recent lookups)."""

    def __init__(self, base, db, list_path=None):
        self.base, self.db, self.list_path = base, db, list_path
        self._lock = threading.RLock()
        self._con, self._con_path = None, None
        self._mem = None            # the in-memory search lists, built on first search
        self._job = None            # {state, done, total, message, kind, dl, stop}
        self._probe = (0.0, None)
        self._probing = False
        self._gloss_seen = None     # (size, mtime_ns) of glossary.json when it was last read or written
        self._gloss_error = ""
        self._mine = None           # your words, from the index
        self.db.execute("""CREATE TABLE IF NOT EXISTS my_words (
            key TEXT PRIMARY KEY, word TEXT NOT NULL, pos TEXT NOT NULL, definition TEXT NOT NULL,
            example TEXT NOT NULL DEFAULT '', tags TEXT NOT NULL DEFAULT '[]', added TEXT NOT NULL, updated TEXT NOT NULL)""")

    # ---- where things are ----
    @property
    def folder(self):
        return dict_dir()

    def entry(self):
        lst = load_list(self.list_path)["dictionaries"]
        return lst[0] if lst else None

    def index_path(self, e=None):
        e = e or self.entry()
        return os.path.join(self.folder, f"{e['id']}.sqlite") if e else None

    def _base(self):
        return self.base() if callable(self.base) else self.base

    @property
    def gloss_path(self):
        return glossary_path(self._base())

    # ---- online or not: one quick connection to the list's download host, trusted for 30 seconds ----
    def probe(self, wait=True):
        when, ok = self._probe
        if time.time() - when < PROBE_SECONDS and ok is not None:
            return ok
        if not wait:
            if not self._probing:
                self._probing = True
                threading.Thread(target=self.probe, daemon=True).start()
            return ok
        e = self.entry()
        try:
            if not e:
                ok = False
            else:
                u = urllib.parse.urlparse(e["url"])
                socket.create_connection((u.hostname, u.port or (443 if u.scheme == "https" else 80)), timeout=3).close()
                ok = True
        except OSError:
            ok = False
        self._probe, self._probing = (time.time(), ok), False
        return ok

    def mark_offline(self):
        self._probe = (time.time(), False)

    # ---- the WordNet index ----
    def _wn(self):
        """An open connection to the index, or None when it isn't there (or is from an older layout)."""
        p = self.index_path()
        if not p or not os.path.isfile(p):
            self._close()
            return None
        if self._con and self._con_path == p:
            return self._con
        self._close()
        try:
            con = sqlite3.connect(f"file:{p}?mode=ro", uri=True, check_same_thread=False)
            con.row_factory = sqlite3.Row
            meta = dict(con.execute("SELECT key, value FROM meta").fetchall())
        except sqlite3.Error as e:
            log.warning("dictionary index not opened (%s)", e)
            return None
        if meta.get("index_version") != INDEX_VERSION:
            con.close()
            return None
        self._con, self._con_path, self._meta = con, p, meta
        return con

    def _close(self):
        if self._con:
            try:
                self._con.close()
            except sqlite3.Error:
                pass
        self._con, self._con_path, self._mem = None, None, None

    def ready(self):
        return self._wn() is not None

    def status(self):
        e = self.entry()
        with self._lock:
            job = dict(self._job) if self._job else None
        if job and job["state"] in ("downloading", "building") and job.get("dl"):
            d = job["dl"]
            if job["state"] == "downloading":
                job["done"] = d.done
        st = "ready" if self.ready() else "none"
        out = {"status": "success", "state": st, "dictionary": None, "offline": False, "words": 0, "mine": len(self.my_words()),
               "glossary": self.gloss_path, "glossary_error": self._gloss_error, "folder": self.folder}
        if e:
            out["dictionary"] = {k: e.get(k) for k in ("id", "name", "short", "version", "file", "url", "bytes", "sha256", "disk_mb", "words",
                                                       "licence", "licence_url", "source", "source_url", "attribution")}
        if st == "ready":
            out["words"] = int(self._meta.get("words", 0))
            out["size_bytes"] = os.path.getsize(self._con_path)
        if job and job["state"] in ("downloading", "building", "failed"):
            out["state"] = job["state"]
            out["job"] = {k: job.get(k) for k in ("done", "total", "message", "kind", "fraction")}
        elif st == "none":
            ok = self.probe(wait=False)
            out["offline"] = ok is False
        return out

    def download(self):
        """Starts the download (after the page's ask), then the build. Progress comes from status()."""
        e = self.entry()
        if not e:
            raise DictError("No dictionary is listed in dict_list.json.")
        if self.ready():
            return self.status()
        with self._lock:
            if self._job and self._job["state"] in ("downloading", "building"):
                return self.status()
            stop = threading.Event()
            dest = os.path.join(self.folder, e["file"])
            dl = local_ai.Download("dict:" + e["id"], e["name"], e["url"], dest, e["bytes"], e["sha256"])
            self._job = {"state": "downloading", "done": dl.done, "total": e["bytes"], "message": "", "kind": "", "dl": dl, "stop": stop, "fraction": 0.0}
        threading.Thread(target=self._run, args=(e, dl, stop), name="nv-dict", daemon=True).start()
        return self.status()

    def _fail(self, message, kind):
        with self._lock:
            if self._job:
                self._job.update(state="failed", message=message, kind=kind)

    def _run(self, e, dl, stop):
        try:
            os.makedirs(self.folder, exist_ok=True)
            dl.start()
            dl.wait()
            if stop.is_set():
                return
            if dl.state != "done":
                msg = dl.message or "The download stopped."
                if "checksum" in msg:
                    self._fail("The download didn't match its checksum, so it was deleted. Try again.", "checksum")
                elif any(x in msg for x in (errors.OFFLINE, errors.REFUSED, errors.SLOW, "getaddrinfo", "refused", "timed out", "unreachable", "No route", "WinError 10051", "WinError 11001")):   # QC 90: the plain sentences
                    self.mark_offline()
                    if os.path.isfile(dl.part):
                        os.remove(dl.part)
                    self._fail("The download stopped: you seem to be offline. Try again when you're back online; your own words work meanwhile.", "offline")
                else:
                    if os.path.isfile(dl.part):
                        os.remove(dl.part)
                    self._fail(re.sub(r" ?Resume to (carry on|fetch the rest)\.", " Try again.", msg), "server")
                return
            with self._lock:
                self._job.update(state="building", done=e["bytes"], fraction=0.0)

            def prog(f):
                with self._lock:
                    if self._job:
                        self._job["fraction"] = f
            meta = {"id": e["id"], "name": e["name"], "version": str(e.get("version", "")), "sha256": e["sha256"]}
            with self._lock:
                self._close()
            n = build_index(dl.dest, self.index_path(e), meta, prog, stop.is_set)
            if stop.is_set() or not n:
                return
            try:
                os.remove(dl.dest)   # the index holds it all now
            except OSError:
                pass
            with self._lock:
                self._job = None
                self._mem = None
        except DictError as ex:
            self._fail(str(ex), "build")
        except Exception as ex:   # noqa: BLE001 - a thread: say so on the page
            log.exception("dictionary download failed")
            self._fail(plain_error(ex, "get the dictionary ready"), "build")
        finally:
            if stop.is_set():
                for p in (dl.dest, dl.part, (self.index_path(e) or "") + ".tmp"):
                    try:
                        if p and os.path.isfile(p):
                            os.remove(p)
                    except OSError:
                        pass

    def cancel(self):
        with self._lock:
            job = self._job
        if not job:
            return self.status()
        job["stop"].set()
        if job.get("dl"):
            job["dl"].cancel()   # deletes its .part file
        e = self.entry()
        for p in ((os.path.join(self.folder, e["file"]) if e else None), ((self.index_path(e) or "") + ".tmp") if e else None):
            for _ in range(20):
                try:
                    if p and os.path.isfile(p):
                        os.remove(p)
                    break
                except OSError:
                    time.sleep(.1)
        with self._lock:
            self._job = None
        out = self.status()
        out["message"] = "Download cancelled: nothing was kept."
        return out

    def dismiss(self):
        """After a failure: back to the ask."""
        with self._lock:
            if self._job and self._job["state"] == "failed":
                self._job = None
        return self.status()

    def shutdown(self):
        with self._lock:
            job = self._job
        if job and job["state"] in ("downloading", "building"):
            self.cancel()
        self._close()

    # ---- your own words: glossary.json is the truth, my_words its index ----
    def _gloss_stat(self):
        try:
            st = os.stat(self.gloss_path)
            return (st.st_size, st.st_mtime_ns)
        except OSError:
            return None

    def _load_index(self):
        rows = self.db.query("SELECT * FROM my_words ORDER BY word COLLATE NOCASE")
        self._mine = [{"key": r["key"], "word": r["word"], "pos": r["pos"], "definition": r["definition"], "example": r["example"],
                       "tags": json.loads(r["tags"] or "[]"), "added": r["added"], "updated": r["updated"]} for r in rows]

    def _sync(self):
        """Reads glossary.json again when it changed on disk and rebuilds the index to match it."""
        with self._lock:
            seen = self._gloss_stat()
            if self._mine is not None and seen == self._gloss_seen:
                return
            if self._mine is None:
                self._load_index()
            if seen is None:
                if self._mine:   # the file is gone but the index has words: write it again
                    self._write_file()
                self._gloss_seen = self._gloss_stat()
                return
            try:
                with open(self.gloss_path, encoding="utf-8") as fh:
                    raw = json.load(fh)
                if not isinstance(raw, dict) or not isinstance(raw.get("words"), list):
                    raise ValueError("no word list in it")
            except (OSError, ValueError) as ex:
                self._gloss_error = f"glossary.json couldn't be read ({ex}). Your words are shown from NeuroVault's own copy; the file is kept as it is."
                self._gloss_seen = seen
                return
            self._gloss_error = ""
            words, keys = [], set()
            for x in raw["words"]:
                try:
                    w = clean_word(x)
                except DictError:
                    log.warning("glossary.json: entry %r left out", x)
                    continue
                if w["key"] in keys:
                    continue
                keys.add(w["key"])
                words.append(w)
            self._store(words)
            self._gloss_seen = seen

    def _store(self, words):
        with self.db._lock:
            self.db.conn.execute("DELETE FROM my_words")
            self.db.conn.executemany("INSERT INTO my_words VALUES (?,?,?,?,?,?,?,?)",
                                     [(w["key"], w["word"], w["pos"], w["definition"], w["example"], json.dumps(w["tags"]), w["added"], w["updated"]) for w in words])
            self.db.conn.commit()
        self._load_index()

    def _write_file(self):
        p = self.gloss_path
        os.makedirs(os.path.dirname(p), exist_ok=True)
        if self._gloss_error and os.path.isfile(p):   # never overwrite a file that couldn't be read: move it aside first
            aside = os.path.join(os.path.dirname(p), f"glossary.unreadable-{datetime.now().strftime('%Y%m%d-%H%M%S')}.json")
            os.replace(p, aside)
            log.warning("glossary.json moved aside to %s", aside)
            self._gloss_error = ""
        doc = {"format": "neurovault-glossary", "version": 1,
               "about": "Your own words in the NeuroVault dictionary. NeuroVault reads this file again when it changes.",
               "words": [{k: w[k] for k in ("word", "pos", "definition", "example", "tags", "added", "updated")} for w in self._mine]}
        tmp = p + ".tmp"
        with open(tmp, "w", encoding="utf-8", newline="\n") as fh:
            json.dump(doc, fh, ensure_ascii=False, indent=2)
            fh.write("\n")
            fh.flush()
            os.fsync(fh.fileno())
        os.replace(tmp, p)
        self._gloss_seen = self._gloss_stat()

    def my_words(self):
        self._sync()
        return list(self._mine or [])

    def my_word(self, key):
        return next((w for w in self.my_words() if w["key"] == key), None)

    def save_word(self, data, old_key=None):
        """Add (old_key None) or edit a word of yours. Returns the saved word."""
        w = clean_word(data)
        with self._lock:
            self._sync()
            mine = list(self._mine)
            old = next((x for x in mine if x["key"] == old_key), None) if old_key else None
            if old_key and not old:
                raise DictError("That word isn't one of yours any more. It may have been deleted on another PC.")
            clash = next((x for x in mine if x["key"] == w["key"] and x is not old), None)
            if clash:
                raise DictError(f"You already have “{clash['word']}”. Edit that one instead.", "word")
            today = date.today().isoformat()
            w["added"], w["updated"] = (old["added"] if old else today), today
            mine = [x for x in mine if x is not old] + [w]
            mine.sort(key=lambda x: x["word"].lower())
            self._store(mine)
            self._write_file()
            return w

    def delete_word(self, key):
        with self._lock:
            self._sync()
            if not any(x["key"] == key for x in self._mine):
                raise DictError("That word isn't one of yours.")
            self._store([x for x in self._mine if x["key"] != key])
            self._write_file()

    # ---- search ----
    _mem_lock = threading.Lock()
    _mem_keys = set()

    def _memory(self):
        """Every headword, by (first letter, length), and (Build N, QC 62) the set of them, read in one pass. Loaded once,
        under a lock: api.spell_warm loads it in the background so the first right-click doesn't wait for it."""
        if self._mem is None:
            with self._mem_lock:
                if self._mem is None:
                    con = self._wn()
                    by_first, keys = {}, set()
                    if con:
                        for r in con.execute("SELECT id, key, nsenses FROM words"):
                            k = r["key"]
                            by_first.setdefault((k[:1], len(k)), []).append((k, r["id"], r["nsenses"]))
                            keys.add(k)
                    self._mem_keys = keys
                    self._mem = by_first
        return self._mem

    def memory_keys(self):
        """The headwords as a set (Build N, QC 52 / 62: the run-together split search's quick test)."""
        self._memory()
        return self._mem_keys

    def _rows(self, ids):
        """Search rows {key, word, pos, def} for WordNet word ids, in that order."""
        con = self._wn()
        if not con or not ids:
            return []
        q = ",".join("?" * len(ids))
        words = {r["id"]: r for r in con.execute(f"SELECT id, word, key FROM words WHERE id IN ({q})", ids)}
        first = {}
        for r in con.execute(f"""SELECT s.word_id, y.pos, y.def FROM senses s JOIN synsets y ON y.id = s.synset_id
                                 WHERE s.word_id IN ({q}) ORDER BY s.word_id, s.ord""", ids):
            f = first.setdefault(r["word_id"], {"pos": [], "def": r["def"]})
            if r["pos"] not in f["pos"]:
                f["pos"].append(r["pos"])
        out = []
        for i in ids:
            if i in words:
                f = first.get(i, {"pos": [], "def": ""})
                out.append({"key": words[i]["key"], "word": words[i]["word"], "pos": f["pos"], "def": f["def"]})
        return out

    def _merge(self, rows, mine_keys):
        """Your word on top of WordNet's, marked: one row per key."""
        out, seen = [], set()
        for r in rows:
            if r["key"] in seen:
                continue
            seen.add(r["key"])
            m = mine_keys.get(r["key"])
            if m:
                r = {**r, "word": m["word"], "pos": list(dict.fromkeys([m["pos"]] + r.get("pos", []))), "def": m["definition"], "mine": True}
            out.append(r)
        return out

    def search(self, q0, scope="all", limit=8):
        """{q, exact, prefix, close, in_defs, via} rows of {key, word, pos, def, mine}; via = the inflected word typed."""
        q = norm(q0)
        mine = self.my_words()
        mine_keys = {w["key"]: w for w in mine}
        res = {"q": q, "exact": None, "prefix": [], "close": [], "in_defs": [], "via": None, "scope": scope}
        if not q:
            return res
        mrow = lambda w: {"key": w["key"], "word": w["word"], "pos": [w["pos"]], "def": w["definition"], "mine": True}   # noqa: E731
        con = None if scope == "mine" else self._wn()
        lim = 1 if len(q) <= 6 else 2
        sounds_like = lambda k: len(q) >= 4 and len(skel(q)) >= 3 and skel(k) == skel(q) and distance(k, q, 3) <= 3   # noqa: E731
        near = lambda k: len(q) >= 3 and (distance(k, q, lim) <= lim or sounds_like(k))   # noqa: E731
        # yours
        m_exact = mine_keys.get(q)
        m_prefix = [w for w in mine if w["key"] != q and w["key"].startswith(q)]
        m_close = [w for w in mine if w["key"] != q and not w["key"].startswith(q) and near(w["key"])]
        exact, prefix, close, in_defs = (mrow(m_exact) if m_exact else None), [mrow(w) for w in m_prefix], [mrow(w) for w in m_close], []
        if con:
            r = con.execute("SELECT id FROM words WHERE key = ?", (q,)).fetchone()
            if r and not exact:
                exact = (self._rows([r["id"]]) or [None])[0]
            elif r and exact:
                exact = self._merge(self._rows([r["id"]]), mine_keys)[0]
            if not exact:   # an inflected word: its dictionary form (WordNet's own forms first, then the rules)
                cand = [f["word_id"] for f in con.execute("SELECT word_id FROM forms WHERE key = ?", (q,))]
                for b0 in base_forms(q):
                    cand += [x["id"] for x in con.execute("SELECT id FROM words WHERE key = ?", (b0,))]
                if cand:
                    exact = self._merge(self._rows([cand[0]]), mine_keys)[0]
                    res["via"] = q0.strip()
            ids = [x["id"] for x in con.execute(
                "SELECT id FROM words WHERE key > ? AND key < ? ORDER BY (instr(key, ' ') > 0), nsenses DESC, length(key), key LIMIT ?",
                (q, q + "￿", limit + 4))]
            prefix += [x for x in self._merge(self._rows(ids), mine_keys) if x["key"] not in {p["key"] for p in prefix}]
            if len(q) >= 3:
                cands = []
                mem = self._memory()
                mq, cap = letter_mask(q), 2 * lim   # Build N (QC 62): see letter_mask; the same words come out, about 10× sooner
                for n in range(len(q) - lim, len(q) + lim + 1):
                    for k, wid, ns in mem.get((q[:1], n), ()):
                        if k != q and not k.startswith(q):
                            if (mq ^ letter_mask(k)).bit_count() > cap:
                                continue
                            d = distance(k, q, lim)
                            if d <= lim:
                                cands.append((d, -ns, k, wid))
                if len(q) >= 4 and len(skel(q)) >= 3:
                    for r2 in con.execute("SELECT id, key, nsenses FROM words WHERE skel = ? LIMIT 40", (skel(q),)):
                        if r2["key"] != q and not r2["key"].startswith(q) and sounds_like(r2["key"]):
                            cands.append((lim + .5, -r2["nsenses"], r2["key"], r2["id"]))
                cands.sort()
                seen = {c["key"] for c in close}
                ids = []
                for d, _, k, wid in cands:
                    if k not in seen:
                        seen.add(k)
                        ids.append(wid)
                    if len(ids) >= 6:
                        break
                close += [x for x in self._merge(self._rows(ids), mine_keys) if x["key"] not in {c["key"] for c in close}]
        if not exact and scope != "mine" and q in SOUNDS:
            exact = {"key": q, "word": q, "pos": [], "def": "Easily mixed up with " + ", ".join(SOUNDS[q]), "mine": False}
        taken = {x["key"] for x in [exact] + prefix + close if x}
        if len(q) >= 3:
            in_defs = [mrow(w) for w in mine if w["key"] not in taken and (q in w["definition"].lower() or q in w["example"].lower() or q in w["tags"])]
            taken |= {x["key"] for x in in_defs}
            if con:
                in_defs += [x for x in self._merge(self._rows(self._in_meanings(con, q, taken)), mine_keys) if x["key"] not in taken]
        res.update(exact=exact, prefix=prefix[:limit], close=close[:6], in_defs=in_defs[:6])
        return res

    def _in_meanings(self, con, q, taken):
        if not re.fullmatch(r"[a-z][a-z' -]*", q):
            return []
        try:
            if getattr(self, "_meta", {}).get("fts") == "1":
                rows = con.execute("""SELECT s.word_id AS id FROM defs JOIN senses s ON s.synset_id = defs.rowid
                                      WHERE defs MATCH ? ORDER BY bm25(defs) LIMIT 40""", ('"' + q.replace('"', "") + '"',)).fetchall()
            else:
                rows = con.execute("SELECT s.word_id AS id FROM synsets y JOIN senses s ON s.synset_id = y.id WHERE y.def LIKE ? LIMIT 40",
                                   (f"%{q}%",)).fetchall()
        except sqlite3.Error:
            return []
        out = []
        keys = {}
        for r in rows:
            if r["id"] not in keys:
                keys[r["id"]] = True
                out.append(r["id"])
        words = {r["id"]: r["key"] for r in con.execute(f"SELECT id, key FROM words WHERE id IN ({','.join('?' * len(out))})", out)} if out else {}
        return [i for i in out if words.get(i) not in taken and words.get(i) != q][:6]

    def best(self, res):
        """(key, guessed): what the page shows for a search: the exact word, else the first that starts with it, else the closest."""
        if res["exact"]:
            return res["exact"]["key"], False
        if res["prefix"]:
            return res["prefix"][0]["key"], False
        if res["close"]:
            return res["close"][0]["key"], True
        return None, False

    # ---- one word, in full ----
    def lookup(self, word, senses_per_pos=None):
        """The whole entry: {key, word, syl, pos, senses: [{pos, def, examples}], syn, ant, sounds, mine, wordnet} or None.
        A small word WordNet leaves out (their, the, which) that is easily mixed up gets an entry with only its sound-alikes."""
        k = norm(word)
        if not k:
            return None
        mine = self.my_word(k)
        con = self._wn()
        wn = None
        if con:
            r = con.execute("SELECT id, word FROM words WHERE key = ?", (k,)).fetchone()
            if r:
                wid = r["id"]
                senses, syn = [], []
                rows = con.execute("""SELECT y.id, y.pos, y.def, y.examples FROM senses s JOIN synsets y ON y.id = s.synset_id
                                      WHERE s.word_id = ? ORDER BY s.ord""", (wid,)).fetchall()
                for x in rows:
                    senses.append({"pos": x["pos"], "def": x["def"], "examples": json.loads(x["examples"] or "[]")})
                if rows:
                    # in the order of this word's own meanings, then near-synonyms linked by "similar" (adjectives)
                    for s in con.execute("""SELECT w.word, MIN(m.ord) AS o, MAX(w.nsenses) AS n FROM senses m JOIN senses s ON s.synset_id = m.synset_id
                                            JOIN words w ON w.id = s.word_id WHERE m.word_id = ? AND s.word_id != ? GROUP BY w.id ORDER BY o, n DESC LIMIT 12""", (wid, wid)):
                        syn.append(s["word"])
                    if len(syn) < 8:
                        for s in con.execute(f"""SELECT w.word, MIN(m.ord) AS o, MAX(w.nsenses) AS n FROM senses m JOIN similar r ON r.synset_id = m.synset_id
                                                 JOIN senses s ON s.synset_id = r.other_id JOIN words w ON w.id = s.word_id
                                                 WHERE m.word_id = ? AND s.word_id != ? GROUP BY w.id ORDER BY o, n DESC LIMIT 12""", (wid, wid)):
                            if s["word"] not in syn and len(syn) < 12:
                                syn.append(s["word"])
                ant = [a["word"] for a in con.execute("""SELECT DISTINCT w.word FROM antonyms a JOIN words w ON w.id = a.other_id
                                                          WHERE a.word_id = ? LIMIT 8""", (wid,))]
                wn = {"word": r["word"], "senses": senses, "syn": syn, "ant": ant}
        if not wn and not mine and k not in SOUNDS:
            return None
        pos = list(dict.fromkeys(([mine["pos"]] if mine else []) + [s["pos"] for s in (wn["senses"] if wn else [])]))
        sounds = []
        for s in SOUNDS.get(k, []):
            d = ""
            if con:
                r2 = con.execute("""SELECT y.def FROM words w JOIN senses s ON s.word_id = w.id JOIN synsets y ON y.id = s.synset_id
                                    WHERE w.key = ? ORDER BY s.ord LIMIT 1""", (norm(s),)).fetchone()
                d = r2["def"] if r2 else ""
            m2 = self.my_word(norm(s))
            sounds.append({"word": s, "def": (m2["definition"] if m2 else d) or ""})
        word = mine["word"] if mine else wn["word"] if wn else k
        return {"key": k, "word": word, "syl": syllables(wn["word"] if wn else word) if wn else "", "pos": pos,
                "senses": wn["senses"] if wn else [], "syn": wn["syn"] if wn else [], "ant": wn["ant"] if wn else [],
                "sounds": sounds, "mine": mine, "wordnet": bool(wn)}

    # ==== Fix A (QC 3 · 26): spelling suggestions for the note's right-click menu ====
    def spell(self, word, limit=5, wide=True):
        """{word, known, suggestions: [{word, mine, d}], checked}. known: WordNet has it (or a form of it), it's one of
        your words, a common small word WordNet leaves out (the, and, which…), a number or an all-capitals short form.
        checked is False when WordNet isn't here yet (then only your words can be suggested). Suggestions: the closest
        spellings first (edit distance, a swapped pair counting once), then sound-alikes, ties to the commoner word
        (more meanings), your words alongside; the case of the word as typed (Recieve → Receive, ETL stays)."""
        raw = str(word or "").strip().replace("’", "'")[:60]
        k = norm(raw)
        con = self._wn()
        out = {"word": raw, "known": True, "suggestions": [], "checked": bool(con)}
        if not k or " " in k or len(k) < 2:
            return out
        mine = {w["key"]: w for w in self.my_words()}
        if (k in mine or any(b in mine for b in base_forms(k)) or k in COMMON_WORDS or (k.endswith("'s") and k[:-2] in COMMON_WORDS) or re.search(r"\d", raw)
                or (raw.isupper() and len(raw) <= 6)):
            return out
        if con:
            if con.execute("SELECT 1 FROM words WHERE key = ?", (k,)).fetchone() or con.execute("SELECT 1 FROM forms WHERE key = ?", (k,)).fetchone():
                return out
            if any(con.execute("SELECT 1 FROM words WHERE key = ?", (b,)).fetchone() for b in base_forms(k)):
                return out
            if k.endswith("'s") and con.execute("SELECT 1 FROM words WHERE key = ?", (k[:-2],)).fetchone():
                return out
        elif not mine:
            return out   # nothing to check against: never call a word wrong
        out["known"] = False
        if limit <= 0:   # only whether it's known (Check spelling asks for a whole note's words)
            return out
        lim = 1 if len(k) <= 4 else 2
        cands = {}   # key → (distance, -frequency, word, mine)

        def add(key, d, freq, shown, is_mine):
            if key == k or " " in key or d > lim + .5:
                return
            if key not in cands or (d, -freq) < cands[key][:2]:
                cands[key] = (d, -freq, shown, is_mine)
        for key, w in mine.items():
            add(key, distance(key, k, lim), 1000, w["word"], True)
        for key in COMMON_WORDS:   # teh → the: the small words are the commonest of all
            if abs(len(key) - len(k)) <= lim:
                add(key, distance(key, k, lim), 5000, key, False)
        if con:
            mem = self._memory()
            mk, cap = letter_mask(k), 2 * lim   # Build N (QC 62): see letter_mask; the same words come out, sooner
            for n in range(len(k) - lim, len(k) + lim + 1):
                for key, _, ns in mem.get((k[:1], n), ()):
                    if (mk ^ letter_mask(key)).bit_count() > cap:
                        continue
                    d = distance(key, k, lim)
                    if d <= lim:
                        add(key, d, ns, key, False)
            if len(k) >= 4 and len(skel(k)) >= 3:   # sounds alike: fonetic → phonetic
                for r in con.execute("SELECT key, nsenses FROM words WHERE skel = ? LIMIT 60", (skel(k),)):
                    add(r["key"], min(distance(r["key"], k, 3), lim) + .5, r["nsenses"], r["key"], False)
            if wide and len([c for c in cands.values() if c[0] <= 1]) < limit:   # a wrong first letter: same length, one edit away (wide=False: Windows' engine finds those)
                for (first, n), rows in mem.items():
                    if first != k[:1] and n == len(k):
                        for key, _, ns in rows:
                            if distance(key, k, 1) <= 1:
                                add(key, 1, ns, key, False)
        ranked = sorted(cands.values(), key=lambda c: (c[0], c[1], len(c[2])))[:limit]
        case = (lambda x: x.upper()) if raw.isupper() and len(raw) > 1 else (lambda x: x[:1].upper() + x[1:]) if raw[:1].isupper() else (lambda x: x)
        out["suggestions"] = [{"word": case(c[2]), "mine": c[3], "d": c[0]} for c in ranked]
        return out
    # ==== end Fix A ====

def clean_word(x):
    """A word of yours from the page or the file: checked and tidied, or DictError with what to fix."""
    if not isinstance(x, dict):
        raise DictError("A word needs its word and definition.")
    word = re.sub(r"\s+", " ", str(x.get("word") or "")).strip()
    definition = str(x.get("definition") if x.get("definition") is not None else x.get("def") or "").strip()
    example = str(x.get("example") if x.get("example") is not None else x.get("ex") or "").strip()
    pos = str(x.get("pos") or "noun").strip().lower()
    tags = x.get("tags") or []
    if isinstance(tags, str):
        tags = re.split(r"[\s,]+", tags)
    tags = list(dict.fromkeys(t for t in (str(t).strip().lstrip("#").lower() for t in tags) if t))
    if not word:
        raise DictError("Type the word.", "word")
    if len(word) > MAX_WORD or not norm(word):
        raise DictError(f"A word is at most {MAX_WORD} characters, with at least one letter.", "word")
    if not definition:
        raise DictError("Add a short definition in your own words.", "def")
    if len(definition) > MAX_DEF or len(example) > MAX_EX:
        raise DictError(f"A definition is at most {MAX_DEF} characters and an example {MAX_EX}.", "def" if len(definition) > MAX_DEF else "ex")
    if pos not in MY_POS:
        raise DictError("The part of speech is noun, verb, adjective, adverb or other.", "pos")
    bad = [t for t in tags if not TAG_RE.match(t)]
    if bad or len(tags) > MAX_TAGS:
        raise DictError(f"Tags are up to {MAX_TAGS} short words of letters, numbers, - and _ (not “{bad[0] if bad else tags[-1]}”).", "tags")
    out = {"key": norm(word), "word": word, "pos": pos, "definition": definition, "example": example, "tags": tags,
           "added": str(x.get("added") or ""), "updated": str(x.get("updated") or "")}
    for k in ("added", "updated"):
        if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", out[k]):
            out[k] = date.today().isoformat()
    return out


# ==== Build M · R56 (feedback: "of installed should also prompt to install the offline dictionary, and we should also route to
# an online one to cover everything we can"; design profile: the dictionary is offered at setup and backed by an online one).
# Remove takes the offline dictionary off this PC (it downloads again any time). online_lookup asks the web for one word, only
# when the page says the user allows it (Settings → Editor → Dictionary, or "Look it up online"): the Free Dictionary API
# (dictionaryapi.dev, meanings from Wiktionary), else Wiktionary's own definitions, else Datamuse's "did you mean". Only the
# word goes in the request (plus what every web request carries: the IP address); never the sentence or the note. Each answer
# keeps the licence and source pages the service gives, for the credit under the entry. ====
import html as _html  # noqa: E402
import urllib.error  # noqa: E402
import urllib.request  # noqa: E402
import netssl  # noqa: E402  QC 81: Windows' certificate store for the online look-ups

ONLINE_UA = "NeuroVault (a personal notes app; GPL-3.0; one word per lookup)"
FREE_DICT_URL = "https://api.dictionaryapi.dev/api/v2/entries/en/{}"
WIKTIONARY_URL = "https://en.wiktionary.org/api/rest_v1/page/definition/{}"
WIKTIONARY_PAGE = "https://en.wiktionary.org/wiki/{}"
DATAMUSE_URL = "https://api.datamuse.com/sug?s={}&max=6"
WIKTIONARY_LICENCE = {"name": "CC BY-SA 4.0", "url": "https://creativecommons.org/licenses/by-sa/4.0/"}
ONLINE_WORD = re.compile(r"^[^\W\d_]+(?:['’ -][^\W\d_]+)*$")
_online_cache = {}


class Offline(Exception):
    """No connection: the page says so, plainly."""


def _fetch(url, timeout=6):
    """(status, parsed JSON or None). Tests replace this. A 404 is (404, None); no connection raises Offline."""
    req = urllib.request.Request(url, headers={"User-Agent": ONLINE_UA, "Accept": "application/json"})
    try:
        with netssl.urlopen(req, timeout=timeout) as r:   # noqa: S310 - only the fixed https hosts above
            return r.status, json.loads(r.read(2_000_000).decode("utf-8"))
    except urllib.error.HTTPError as e:
        return e.code, None
    except (urllib.error.URLError, socket.timeout, TimeoutError, ConnectionError, OSError) as e:
        raise Offline(plain_error(e, "look the word up online")) from e
    except ValueError:
        return 0, None


def _plain(s):
    return re.sub(r"\s+", " ", _html.unescape(re.sub(r"<[^>]+>", "", str(s or "")))).strip()


def _dedupe(xs, word):
    return list(dict.fromkeys(x for x in xs if x and x.lower() != word.lower()))[:12]


def _from_free_dict(word, data):
    if not isinstance(data, list) or not data:
        return None
    senses, syn, ant, pages, licence, phon = [], [], [], [], None, ""
    for ent in data:
        if not isinstance(ent, dict):
            continue
        phon = phon or str(ent.get("phonetic") or "")
        lic = ent.get("license")
        if not licence and isinstance(lic, dict) and lic.get("name"):
            licence = {"name": str(lic["name"]), "url": str(lic.get("url") or "")}
        pages += [str(u) for u in ent.get("sourceUrls") or [] if isinstance(u, str) and u.startswith("https://")]
        for m in ent.get("meanings") or []:
            pos = str(m.get("partOfSpeech") or "")
            syn += [str(x) for x in m.get("synonyms") or []]
            ant += [str(x) for x in m.get("antonyms") or []]
            for d in m.get("definitions") or []:
                if d.get("definition"):
                    senses.append({"pos": pos, "def": _plain(d["definition"]), "examples": [_plain(d["example"])] if d.get("example") else []})
                syn += [str(x) for x in d.get("synonyms") or []]
                ant += [str(x) for x in d.get("antonyms") or []]
    if not senses:
        return None
    return {"word": str(data[0].get("word") or word), "phonetic": phon, "senses": senses[:20], "syn": _dedupe(syn, word), "ant": _dedupe(ant, word),
            "source": {"service": "Free Dictionary API", "host": "api.dictionaryapi.dev", "from": "Wiktionary",
                       "pages": list(dict.fromkeys(pages))[:3], "licence": licence or WIKTIONARY_LICENCE}}


def _from_wiktionary(word, data):
    if not isinstance(data, dict):
        return None
    senses = []
    for usage in data.get("en") or []:
        pos = str(usage.get("partOfSpeech") or "").lower()
        for d in usage.get("definitions") or []:
            text = _plain(d.get("definition"))
            if text:
                ex = [_plain(x) for x in (d.get("examples") or [])[:1] if _plain(x)]
                senses.append({"pos": pos, "def": text, "examples": ex})
    if not senses:
        return None
    return {"word": word, "phonetic": "", "senses": senses[:20], "syn": [], "ant": [],
            "source": {"service": "Wiktionary", "host": "en.wiktionary.org", "from": "Wiktionary",
                       "pages": [WIKTIONARY_PAGE.format(urllib.parse.quote(word.replace(" ", "_")))], "licence": WIKTIONARY_LICENCE}}


def online_lookup(word):
    """{status: success, word, found, entry (as above, or None), suggestions, sent_to: [hosts]}, or {status: offline | error, message}."""
    w = str(word or "").strip()
    if not (1 <= len(w) <= 60) or not ONLINE_WORD.match(w):
        return {"status": "error", "message": "Only a single word (or a short phrase) can be looked up online."}
    key = w.lower()
    if key in _online_cache:
        return dict(_online_cache[key], cached=True)
    q, sent, entry, sugg = urllib.parse.quote(w, safe=""), [], None, []
    try:
        sent.append("api.dictionaryapi.dev")
        code, data = _fetch(FREE_DICT_URL.format(q))
        if code == 200:
            entry = _from_free_dict(w, data)
        if not entry:
            sent.append("en.wiktionary.org")
            code, data = _fetch(WIKTIONARY_URL.format(urllib.parse.quote(w.replace(" ", "_"), safe="")))
            if code == 200:
                entry = _from_wiktionary(w, data)
        if not entry:
            sent.append("api.datamuse.com")
            code, data = _fetch(DATAMUSE_URL.format(q))
            if code == 200 and isinstance(data, list):
                sugg = [str(x.get("word")) for x in data if isinstance(x, dict) and x.get("word") and str(x["word"]).lower() != key][:5]
    except Offline as e:   # QC 90: a certificate problem says so, rather than "offline"
        why = str(e) if errors.CERT in str(e) else "You're offline"
        return {"status": "offline", "message": f"{why.rstrip('.')}, so only the offline dictionary and your words were searched." if why == "You're offline"
                else f"{why} Only the offline dictionary and your words were searched."}
    out = {"status": "success", "word": w, "found": bool(entry), "entry": entry, "suggestions": sugg, "sent_to": sent}
    if len(_online_cache) > 300:
        _online_cache.clear()
    _online_cache[key] = out
    return dict(out)


def _remove(self):
    """Takes the offline dictionary off this PC (your own words stay). It can be downloaded again."""
    with self._lock:
        if self._job and self._job["state"] in ("downloading", "building"):
            raise DictError("Wait for the download to finish, or cancel it first.")
        e = self.entry()
        self._close()
        gone = 0
        for p in ((self.index_path(e) if e else None), (os.path.join(self.folder, e["file"]) if e else None)):
            for _ in range(20):
                try:
                    if p and os.path.isfile(p):
                        os.remove(p)
                        gone += 1
                    break
                except OSError:
                    time.sleep(.1)
            else:
                raise DictError("The dictionary file is in use; try again in a moment.")
        self._mem = None
    out = self.status()
    out["message"] = "The offline dictionary was deleted. Your own words stay." if gone else "The offline dictionary wasn't on this PC."
    return out


Dictionary.remove = _remove
# ==== end Build M · R56 ====
