"""
Phase 6C · read aloud: the sherpa-onnx engine (Kokoro voices, on this PC; Piper voices still load if a licensed one is added).

Fix B (QC round 3): the page hands over the whole note at once, cut into short
clause-sized pieces (start()). Background workers make every piece ahead, in
order from where reading starts, and keep the audio in a cache keyed by the
piece's text, voice and speed, so reading a note again, or jumping in it, is
instant. The page polls (poll()) for the pieces it is about to play, as 16-bit
PCM with a start and end time for every word, and for how long it should wait
before it starts so that playback never catches up with the workers (wait,
from the speed measured on this PC). Each piece has its silence trimmed and a
short fade at both edges, so the joins don't click.

"Try it" in Settings still makes one sentence with speak() (a WAV data: URL).

Word timing is estimated, because Kokoro and Piper (as sherpa-onnx runs them)
don't report where each word falls in the audio. See estimate_word_times().

Models are never in git. They are looked for in, in this order:
    %NEUROVAULT_MODELS%\\tts\\<model>\\     (if that variable is set)
    <app folder>\\models\\tts\\<model>\\
    %LOCALAPPDATA%\\NeuroVault\\models\\tts\\<model>\\   (where they are downloaded to)
Each <model> folder is a sherpa-onnx release unpacked as it is:
    Kokoro: model*.onnx, voices.bin, tokens.txt, espeak-ng-data\\
    Piper:  <name>.onnx, tokens.txt, espeak-ng-data\\
"""
import base64
import io
import json
import logging
import os
import re
import sys
import threading
import time
import wave
from collections import OrderedDict

from utils import app_dir
from errors import plain_error  # v0.1.1 (QC 90): failures in plain words, the detail in the log

log = logging.getLogger(__name__)

# Set by tests to look only in their own folders
MODEL_ROOTS = None

# Kokoro English v0.19 has 11 voices, in this order (sid 0–10)
KOKORO_EN_V019 = ["af", "af_bella", "af_nicole", "af_sarah", "af_sky", "am_adam", "am_michael",
                  "bf_emma", "bf_isabella", "bm_george", "bm_lewis"]
_ACCENT = {"a": "US", "b": "UK"}
_PIPER_ACCENT = {"US": "US", "GB": "UK"}

# Fix B: the Piper voices whose licences don't allow shipping them (QC item 22, licence audit flag 1). A folder of
# theirs already on a PC is not offered, and a saved voice of theirs reads with Kokoro instead.
UNLICENSED = ("en_GB-alan-", "en_US-amy-")   # every quality of the two voices

# Fix B: workers that make pieces side by side, each with its own copy of the model (about 290 MB each for Kokoro
# int8). Measured on a 16-core PC: one copy makes 1 s of speech in 0.74 s, two copies in 0.41 s, three in 0.32 s.
CPUS = os.cpu_count() or 2
WORKERS = 2 if CPUS >= 8 else 1
THREADS = max(1, min(4, CPUS // (2 * WORKERS)))
_load_lock = threading.Lock()
_engine = {"dir": None, "list": []}   # the model's copies: [{"tts", "lock"}]; only one model in memory at a time


def sherpa_installed():
    try:
        import sherpa_onnx  # noqa: F401
        return True
    except Exception:
        return False


def model_roots():
    if MODEL_ROOTS is not None:
        return list(MODEL_ROOTS)
    roots = []
    env = os.environ.get("NEUROVAULT_MODELS")
    if env:
        roots.append(os.path.join(env, "tts"))
    try:
        here = app_dir()
    except AttributeError:   # run from an interactive shell (no __main__ file)
        here = os.path.dirname(os.path.abspath(__file__))
    roots.append(os.path.join(here, "models", "tts"))
    if sys.platform != "win32" or os.environ.get("LOCALAPPDATA"):   # Windows: only with LOCALAPPDATA set, as before
        import platform_layer
        roots.append(os.path.join(platform_layer.data_dir(), "models", "tts"))
    return roots


def download_folder():
    """Where a model is unpacked to: the last of model_roots() (per user, outside the app and git)."""
    return model_roots()[-1]


def _onnx(folder):
    files = sorted(f for f in os.listdir(folder) if f.endswith(".onnx"))
    # an int8 model if that's all there is; otherwise the plain one
    return os.path.join(folder, files[0]) if files else None


def _voice_label(kind, name, folder_name):
    if kind == "kokoro":
        accent = _ACCENT.get(name[:1], "")
        who = name.split("_", 1)[1].title() if "_" in name else ("Default" if name == "af" else name.title())
        return f"Kokoro · {who}" + (f" ({accent})" if accent else "")
    m = re.search(r"piper-([a-z]{2})_([A-Z]{2})-([a-z_]+?)-(x_low|low|medium|high)", folder_name)
    if not m:
        return "Piper · " + folder_name
    return f"Piper · {m.group(3).replace('_', ' ').title()} ({_PIPER_ACCENT.get(m.group(2), m.group(2))})"


def find_models():
    """[{id, kind, dir, voices: [{id, label}]}] for every usable model folder, first root first."""
    out, seen = [], set()
    for root in model_roots():
        if not os.path.isdir(root):
            continue
        for name in sorted(os.listdir(root)):
            d = os.path.join(root, name)
            if name in seen or not os.path.isdir(d):
                continue
            files = set(os.listdir(d))
            model = _onnx(d)
            if not model or "tokens.txt" not in files or "espeak-ng-data" not in files:
                continue
            if any(u in name for u in UNLICENSED):
                continue
            if "voices.bin" in files:
                kind = "kokoro"
                names = KOKORO_EN_V019 if "en-v0_19" in name else None
                if names is None:   # another Kokoro release: number its speakers from voices.bin
                    per_voice = 511 * 256 * 4   # bytes per voice in v1.x
                    count = max(1, os.path.getsize(os.path.join(d, "voices.bin")) // per_voice)
                    names = [f"speaker {i}" for i in range(count)]
                voices = [{"id": f"{name}:{i}", "label": _voice_label(kind, n, name)} for i, n in enumerate(names)]
            else:
                kind = "piper"
                voices = [{"id": f"{name}:0", "label": _voice_label(kind, "", name)}]
            seen.add(name)
            out.append({"id": name, "kind": kind, "dir": d, "voices": voices})
    return out


def status():
    models = find_models() if sherpa_installed() else []
    voices = [v for m in models for v in m["voices"]]
    if not sherpa_installed():
        message = "The sherpa-onnx package isn't installed, so reading uses Windows voices."
    elif not models:
        message = f"No Kokoro voice model is on this PC yet (looked in {download_folder()}), so reading uses Windows voices."
    else:
        message = ""
    return {"status": "success", "available": bool(voices), "voices": voices,
            "models": [{"id": m["id"], "kind": m["kind"]} for m in models],
            "folder": download_folder(), "message": message}


def _copy(model, i=0):
    """Copy i of the model ({"tts", "lock"}), loaded the first time it's needed."""
    with _load_lock:
        if _engine["dir"] != model["dir"]:
            _engine.update(dir=model["dir"], list=[])
        while len(_engine["list"]) <= i:
            _engine["list"].append({"tts": _new_tts(model), "lock": threading.Lock()})
        return _engine["list"][i]


def _new_tts(model):
    import sherpa_onnx
    d = model["dir"]
    common = {"tokens": os.path.join(d, "tokens.txt"), "data_dir": os.path.join(d, "espeak-ng-data")}
    if model["kind"] == "kokoro":
        mc = sherpa_onnx.OfflineTtsModelConfig(
            kokoro=sherpa_onnx.OfflineTtsKokoroModelConfig(model=_onnx(d), voices=os.path.join(d, "voices.bin"), **common),
            num_threads=THREADS)
    else:
        mc = sherpa_onnx.OfflineTtsModelConfig(
            vits=sherpa_onnx.OfflineTtsVitsModelConfig(model=_onnx(d), **common), num_threads=THREADS)
    return sherpa_onnx.OfflineTts(sherpa_onnx.OfflineTtsConfig(model=mc, max_num_sentences=1))


def _drop_extra_copies():
    """Frees every copy but the first, once a note is made (each Kokoro copy holds about 290 MB)."""
    with _load_lock:
        del _engine["list"][1:]


def _frames(samples, sr, ms=10):
    """RMS level of each `ms` frame."""
    import numpy as np
    n = max(1, int(sr * ms / 1000))
    usable = len(samples) // n * n
    if not usable:
        return np.zeros(0), n
    f = samples[:usable].reshape(-1, n)
    return np.sqrt((f * f).mean(axis=1)), n


def _speech_span(level):
    """(first, last + 1) frame above the silence threshold, and that threshold."""
    import numpy as np
    if not len(level) or level.max() <= 0:
        return 0, len(level), 0.0
    thr = max(level.max() * 0.06, 1e-4)
    loud = np.nonzero(level > thr)[0]
    return int(loud[0]), int(loud[-1]) + 1, thr


def trim_silence(samples, sr, keep_ms=40):
    """The samples without the silence before and after the speech, keeping a short margin."""
    level, n = _frames(samples, sr)
    a, b, _ = _speech_span(level)
    keep = int(sr * keep_ms / 1000)
    return samples[max(0, a * n - keep): min(len(samples), b * n + keep)]


def fade(samples, sr, ms=8):
    """A short raised-cosine fade in and out, so a piece starts and ends at zero (no click at the joins)."""
    import numpy as np
    n = min(int(sr * ms / 1000), len(samples) // 2)
    if n < 2:
        return samples
    out = np.array(samples, dtype=np.float32)
    ramp = (0.5 - 0.5 * np.cos(np.linspace(0, np.pi, n))).astype(np.float32)
    out[:n] *= ramp
    out[-n:] *= ramp[::-1]
    return out


def word_weight(word):
    """Roughly how long a word takes to say: letters, with digits and symbols spelled out longer."""
    letters = sum(c.isalpha() for c in word)
    digits = sum(c.isdigit() for c in word)
    symbols = sum(c in "%&£$€@+=#/" for c in word)
    return 1.5 + letters + 2.5 * digits + 4 * symbols


_BREAK = re.compile(r"[,;:.!?)\]–—\"']$|^[–—-]$")


def estimate_word_times(words, samples, sr):
    """[(start, end)] in seconds for each word of `words`, spoken in `samples`.

    1. The speech is found by level: 10 ms frames, the silence threshold at 6% of the loudest.
    2. Gaps of 120 ms or more inside the speech are pauses. Pauses are matched, in order, to the
       words that end in punctuation (a comma, colon, full stop, dash ...), where a pause is
       expected, by where they fall: a dynamic-programming match on the share of the sentence
       said so far. A pause too far from any such word is treated as a breath and ignored.
    3. Between matched pauses, the time is shared between the words by word_weight(): letters,
       with digits and symbols counting more, since "2026" or "£450" take longer to say.
    """
    import numpy as np
    if not words:
        return []
    samples = np.asarray(samples, dtype=np.float32)
    total = len(samples) / sr if sr else 0.0
    level, n = _frames(samples, sr)
    a, b, thr = _speech_span(level)
    fs = n / sr if sr else 0.01
    start, end = a * fs, b * fs
    if end - start <= 0:
        start, end = 0.0, total

    # pauses inside the speech
    pauses, run = [], None
    for i in range(a, b):
        quiet = level[i] <= thr
        if quiet and run is None:
            run = i
        elif not quiet and run is not None:
            if (i - run) * fs >= 0.12:
                pauses.append((run * fs, i * fs))
            run = None

    weights = [word_weight(w) for w in words]
    cum = np.cumsum(weights) / sum(weights)
    breaks = [i for i, w in enumerate(words[:-1]) if _BREAK.search(w)]
    span = end - start
    # the pause's share of the speech, against the share of the weight said by that word
    pfrac = [((p0 + p1) / 2 - start) / span for p0, p1 in pauses]
    bfrac = [cum[i] for i in breaks]
    INF, SKIP_P, SKIP_B, FAR = 1e9, 0.12, 0.04, 0.2
    P, B = len(pauses), len(breaks)
    cost = [[INF] * (B + 1) for _ in range(P + 1)]
    move = [[None] * (B + 1) for _ in range(P + 1)]
    cost[0][0] = 0.0
    for i in range(P + 1):
        for j in range(B + 1):
            c = cost[i][j]
            if c >= INF:
                continue
            if i < P and c + SKIP_P < cost[i + 1][j]:
                cost[i + 1][j], move[i + 1][j] = c + SKIP_P, "p"
            if j < B and c + SKIP_B < cost[i][j + 1]:
                cost[i][j + 1], move[i][j + 1] = c + SKIP_B, "b"
            if i < P and j < B:
                d = abs(pfrac[i] - bfrac[j])
                if d < FAR and c + d < cost[i + 1][j + 1]:
                    cost[i + 1][j + 1], move[i + 1][j + 1] = c + d, "m"
    matched, i, j = [], P, B
    while i or j:
        m = move[i][j]
        if m == "m":
            matched.append((breaks[j - 1], pauses[i - 1]))
            i, j = i - 1, j - 1
        elif m == "p":
            i -= 1
        else:
            j -= 1
    matched.reverse()

    # segments of words between matched pauses, each with its stretch of time
    out, w0, t0 = [], 0, start
    for wi, (p0, p1) in matched + [(len(words) - 1, (end, end))]:
        seg = weights[w0:wi + 1]
        t, per = t0, (p0 - t0) / sum(seg)
        for wgt in seg:
            out.append((round(t, 3), round(t + wgt * per, 3)))
            t += wgt * per
        w0, t0 = wi + 1, p1
    return out


def _wav_data_url(samples, sr):
    import numpy as np
    pcm = (np.clip(samples, -1, 1) * 32767).astype("<i2").tobytes()
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(sr)
        w.writeframes(pcm)
    return "data:audio/wav;base64," + base64.b64encode(buf.getvalue()).decode("ascii")


def speak(text, voice, speed=1.0):
    """{status, audio (data: URL), duration, words: [[start, end], ...]} for one sentence."""
    import numpy as np
    text = " ".join(str(text or "").split())
    if not text:
        return {"status": "error", "message": "Nothing to read."}
    if len(text) > 2000:
        return {"status": "error", "message": "That passage is too long to read in one go."}
    try:
        speed = float(speed)
    except (TypeError, ValueError):
        return {"status": "error", "message": "Speed must be a number."}
    if not 0.5 <= speed <= 2.5:
        return {"status": "error", "message": "Speed must be between 0.5 and 2.5."}
    if not sherpa_installed():
        return {"status": "error", "message": "The sherpa-onnx package isn't installed."}
    model, sid = pick_voice(voice)
    if model is None:
        return {"status": "error", "message": "No Kokoro voice model is on this PC.", "missing": True}
    copy = _copy(model)
    with copy["lock"]:
        audio = copy["tts"].generate(text, sid=sid, speed=speed)
    samples, sr = np.asarray(audio.samples, dtype=np.float32), int(audio.sample_rate)
    if not len(samples):
        return {"status": "error", "message": "The voice made no sound for that text."}
    samples = fade(trim_silence(samples, sr), sr)
    words = text.split(" ")
    return {"status": "success", "audio": _wav_data_url(samples, sr), "duration": round(len(samples) / sr, 3),
            "words": [list(t) for t in estimate_word_times(words, samples, sr)],
            "voice": f"{model['id']}:{sid}"}


# ==== Fix B (QC round 3, items 9–11): the whole note made ahead, in the background, and cached ====

def pick_voice(voice):
    """(model, speaker) for a saved voice id "<folder>:<speaker>". A voice that has gone (or a Piper voice that is no
    longer offered) reads with Kokoro: Bella in v0.19, the setup's default, else its first speaker. (None, 0): no model."""
    models = find_models()
    model_id, _, sid = str(voice or "").partition(":")
    model = next((m for m in models if m["id"] == model_id), None)
    if model is None:
        if not models:
            return None, 0
        model = next((m for m in models if m["kind"] == "kokoro"), models[0])
        sid = "1" if "en-v0_19" in model["id"] else "0"
    sid = int(sid) if str(sid).isdigit() else 0
    return model, (sid if sid < len(model["voices"]) else 0)


# Made pieces, newest last: (model folder, speaker, speed, text) -> {pcm (16-bit bytes), sr, dur, words}. About
# 45 minutes of Kokoro speech fit in the cap; the oldest go first.
CACHE_BYTES = 128 * 1024 * 1024
_cache = OrderedDict()
_cache_lock = threading.Lock()
_cached = [0]


def _cache_get(key):
    with _cache_lock:
        piece = _cache.get(key)
        if piece is not None:
            _cache.move_to_end(key)
        return piece


def _cache_put(key, piece):
    with _cache_lock:
        if key in _cache:
            return
        _cache[key] = piece
        _cached[0] += len(piece["pcm"])
        while _cached[0] > CACHE_BYTES and len(_cache) > 1:
            _, old = _cache.popitem(last=False)
            _cached[0] -= len(old["pcm"])


def clear_cache():
    with _cache_lock:
        _cache.clear()
        _cached[0] = 0


# The voice's speed on this PC, per model: "rtf" = seconds one worker takes per second of speech it makes (with the
# fixed cost of each piece), "spc" = seconds of speech per character at 1×. Measured as pieces are made and kept in
# speed.json in the models folder, so the next first wait is right too. The defaults are this PC's first measures.
DEFAULT_RATE = {"kokoro": {"rtf": 0.9, "spc": 0.062}, "piper": {"rtf": 0.2, "spc": 0.062}}
_rates = {}
_rates_read = [False]


def _rate_file():
    return os.path.join(download_folder(), "speed.json")


def rate(model):
    if not _rates_read[0]:
        _rates_read[0] = True
        try:
            with open(_rate_file(), encoding="utf-8") as f:
                saved = json.load(f)
            _rates.update({k: v for k, v in saved.items() if isinstance(v, dict) and {"rtf", "spc"} <= set(v)})
        except (OSError, ValueError, AttributeError):
            pass
    return dict(_rates.get(model["id"]) or DEFAULT_RATE.get(model["kind"], DEFAULT_RATE["kokoro"]))


def _learn(model, gen_s, dur, chars, speed):
    """Moves the model's measured speed towards this piece's (a longer piece counts for more)."""
    if dur <= 0 or chars <= 0:
        return
    r = rate(model)
    w = min(0.25, dur / 40)
    r["rtf"] = round(r["rtf"] * (1 - w) + gen_s / dur * w, 4)
    r["spc"] = round(r["spc"] * (1 - w) + dur * speed / chars * w, 5)
    _rates[model["id"]] = r


def save_rates():
    try:
        if _rates and os.path.isdir(download_folder()):
            with open(_rate_file(), "w", encoding="utf-8") as f:
                json.dump(_rates, f)
    except OSError:
        pass


def make_piece(copy, text, sid, speed):
    """One piece: {pcm, sr, dur, words, gen}. Silence trimmed to 40 ms at each end, then faded in and out."""
    import numpy as np
    t0 = time.perf_counter()
    with copy["lock"]:
        audio = copy["tts"].generate(text, sid=sid, speed=speed)
    gen = time.perf_counter() - t0
    samples, sr = np.asarray(audio.samples, dtype=np.float32), int(audio.sample_rate)
    if not len(samples):
        samples = np.zeros(int(sr * 0.2), dtype=np.float32)   # the voice said nothing (a lone symbol): a short rest
    samples = fade(trim_silence(samples, sr), sr)
    pcm = (np.clip(samples, -1, 1) * 32767).astype("<i2").tobytes()
    words = [list(t) for t in estimate_word_times(text.split(" "), samples, sr)]
    return {"pcm": pcm, "sr": sr, "dur": round(len(samples) / sr, 3), "words": words, "gen": gen}


class Job:
    """One note being made: its pieces, the workers making them in order from `cursor`, and what's done."""

    def __init__(self, model, sid, speed, pieces, at):
        self.id = os.urandom(6).hex()
        self.model, self.sid, self.speed, self.pieces = model, sid, speed, pieces
        self.made = {}          # index -> piece (also in the cache)
        self.busy = {}          # index -> when a worker started it
        self.cursor = at
        self.cancelled = False
        self.error = ""
        self.lock = threading.Lock()
        self.workers = []
        for i in range(len(pieces)):   # what's cached already (the same note read before, or the parts not edited)
            hit = _cache_get(self.key(i))
            if hit is not None:
                self.made[i] = hit

    def key(self, i):
        return (self.model["dir"], self.sid, self.speed, self.pieces[i])

    def take(self):
        """The next piece to make: the first one not made or being made from the cursor on, then from the top."""
        with self.lock:
            n = len(self.pieces)
            for i in list(range(self.cursor, n)) + list(range(0, min(self.cursor, n))):
                if i in self.made or i in self.busy:
                    continue
                self.busy[i] = time.perf_counter()
                return i
            return None

    def run(self, worker):
        try:
            copy = _copy(self.model, worker)
            while not self.cancelled:
                i = self.take()
                if i is None:
                    break
                piece = make_piece(copy, self.pieces[i], self.sid, self.speed)
                _learn(self.model, piece["gen"], piece["dur"], len(self.pieces[i]), self.speed)
                _cache_put(self.key(i), piece)
                with self.lock:
                    self.made[i] = piece
                    self.busy.pop(i, None)
        except Exception as e:   # a model that won't load, or a sherpa-onnx error: the page says so
            log.exception("read aloud: making the note failed")
            self.error = plain_error(e, "read it aloud")
        finally:
            if worker == 0:
                for t in self.workers[1:]:
                    t.join()
                save_rates()
                now = _job["job"]
                if now is None or now.done():   # nothing left to make: free the second copy
                    _drop_extra_copies()

    def done(self):
        return len(self.made) == len(self.pieces)

    def durations(self):
        """Seconds of speech in each piece: what it is once made, else from its length. Once five pieces are made, a
        straight line through this note's made pieces (a fixed part, for the breath at each end, plus so much per
        character), so headings and list items aren't under-counted and the estimate settles as the note is made.
        Until then, the voice's measured speed per character."""
        with self.lock:
            made = dict(self.made)
        a, b = 0.0, rate(self.model)["spc"] / self.speed
        if len(made) >= 5:
            xs = [len(self.pieces[i]) for i in made]
            ys = [made[i]["dur"] for i in made]
            mx, my = sum(xs) / len(xs), sum(ys) / len(ys)
            var = sum((x - mx) ** 2 for x in xs)
            fit = sum((x - mx) * (y - my) for x, y in zip(xs, ys)) / var if var else 0
            if fit > 0 and 0 <= my - fit * mx <= 1.5:
                a, b = my - fit * mx, fit
            elif mx:
                a, b = 0.0, my / mx
        return [made[i]["dur"] if i in made else round(a + len(t) * b, 2) for i, t in enumerate(self.pieces)]

    def wait(self, at, durs=None):
        """Seconds to wait before playing from piece `at`, so that playback never catches up with the workers.

        The workers are played forward in time: each takes the next piece not made yet (from `at` on), and a piece
        takes its length × the measured rtf (plus 15% and 0.1 s, for safety). Playback starts after the wait and plays
        the pieces back to back, so the wait is the largest (ready − due) over the pieces from `at` on."""
        durs = durs or self.durations()
        rtf = rate(self.model)["rtf"] * 1.15
        now = time.perf_counter()
        with self.lock:
            made, busy = set(self.made), dict(self.busy)
        left = lambda i: max(0.0, durs[i] * rtf + 0.1 - (now - busy[i]))
        free = sorted([left(i) for i in busy] + [0.0] * max(0, WORKERS - len(busy)))
        need, due = 0.0, 0.0
        for i in range(at, len(self.pieces)):
            if i in made:
                ready = 0.0
            elif i in busy:
                ready = left(i)
            else:
                free.sort()
                ready = free[0] + durs[i] * rtf + 0.1
                free[0] = ready
            need = max(need, ready - due)
            due += durs[i]
        return round(need + 0.3, 2) if need > 0 else 0


_job = {"job": None}


def start(pieces, voice, speed=1.0, at=0):
    """Starts making a note: pieces is a list of short texts, made in order from piece `at`. Stops the job before it.
    {status, job, total, voice (the one used), made, wait, durs}."""
    if not isinstance(pieces, list) or not pieces or not all(isinstance(p, str) for p in pieces):
        return {"status": "error", "message": "Nothing to read."}
    pieces = [" ".join(p.split()) for p in pieces]
    if not all(pieces):
        return {"status": "error", "message": "A piece of the note is empty."}
    if len(pieces) > 20000 or any(len(p) > 2000 for p in pieces):
        return {"status": "error", "message": "That note is too long to read in one go."}
    try:
        speed = float(speed)
        at = int(at)
    except (TypeError, ValueError):
        return {"status": "error", "message": "Speed must be a number."}
    if not 0.5 <= speed <= 2.5:
        return {"status": "error", "message": "Speed must be between 0.5 and 2.5."}
    if not sherpa_installed():
        return {"status": "error", "message": "The sherpa-onnx package isn't installed."}
    model, sid = pick_voice(voice)
    if model is None:
        return {"status": "error", "message": "No Kokoro voice model is on this PC.", "missing": True}
    stop()
    job = Job(model, sid, speed, pieces, max(0, min(at, len(pieces) - 1)))
    _job["job"] = job
    if not job.done():
        job.workers = [threading.Thread(target=job.run, args=(w,), daemon=True, name=f"read-aloud-{w}") for w in range(WORKERS)]
        for t in job.workers:
            t.start()
    durs = job.durations()
    return {"status": "success", "job": job.id, "total": len(pieces), "voice": f"{model['id']}:{sid}",
            "made": len(job.made), "wait": job.wait(job.cursor, durs), "durs": durs}


def poll(job_id, at=0, want=None, budget=3_000_000):
    """What the page needs while it reads: {state: making | done | error, made, total, wait (seconds to wait before
    playing from piece `at`), durs, pieces: {index: {audio (base64 16-bit PCM), sr, dur, words}}} for the pieces in
    `want` that are made, up to about `budget` bytes. `at` also tells the workers where to carry on from."""
    job = _job["job"]
    if job is None or job.id != job_id:
        return {"status": "error", "message": "That reading has stopped.", "state": "stopped"}
    try:
        at = max(0, min(int(at), len(job.pieces) - 1))
    except (TypeError, ValueError):
        at = 0
    with job.lock:
        job.cursor = at
        made = dict(job.made)
    out, size = {}, 0
    for i in want if isinstance(want, list) else []:
        piece = made.get(i) if isinstance(i, int) and not isinstance(i, bool) else None
        if piece is None:
            continue
        b64 = len(piece["pcm"]) * 4 // 3
        if out and size + b64 > budget:
            break
        out[str(i)] = {"audio": base64.b64encode(piece["pcm"]).decode("ascii"), "sr": piece["sr"], "dur": piece["dur"],
                       "words": piece["words"]}
        size += b64
    durs = job.durations()
    state = "error" if job.error else "done" if job.done() else "making"
    return {"status": "success", "state": state, "message": job.error, "made": len(made), "total": len(job.pieces),
            "wait": 0 if state != "making" else job.wait(at, durs), "durs": durs, "pieces": out}


def stop(job_id=None):
    """Stops making the note (what's made so far stays in the cache)."""
    job = _job["job"]
    if job is not None and (not job_id or job.id == job_id):
        job.cancelled = True
        _job["job"] = None
    return {"status": "success"}
# ==== end Fix B ====
