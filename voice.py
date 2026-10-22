"""
voice.py: the voice rambler's engine (Phase 6B).

    Recorder     records mono 16 kHz audio from a microphone with sounddevice. It is reusable: the
                 rambler records until Stop, and the wrap-up's memo can pass max_seconds=10.
    transcribe() turns the audio into text offline with sherpa-onnx Whisper (no network).
    tidy()       cleans the transcript by rules: filler words go, sentences and paragraphs get
                 capitals, and "I need to…", "remember to…", "don't forget…" lines become tasks.
                 It also runs the anchor check: numbers, money, dates, times, deadlines and
                 names in what was said, and whether each one survived into the cleaned note.
    Session      the state the API polls: idle, recording, transcribing, done or error.

Models live in <app folder>/models/whisper-<name>/ (NV_MODELS_DIR overrides that, for dev).
They are never in git, and download_model() fetches them only when the user asks.
"""
import logging
import os
import re
import threading
import time
import urllib.request
import netssl  # QC 81: Windows' certificate store for the model downloads
import wave
from collections import deque
from datetime import datetime  # Build A: the clip's file name is when the recording began

from utils import app_dir
from errors import plain_error  # v0.1.1 (QC 90): failures in plain words, the detail in the log

log = logging.getLogger(__name__)

RATE = 16000  # Whisper's sample rate


class VoiceError(Exception):
    """A problem worth telling the user about, in their words."""


# ======================================================================
# Models
# ======================================================================

MODELS = {
    # int8 sherpa-onnx exports of OpenAI Whisper; sizes are the exact bytes on Hugging Face
    "base.en": {"label": "base.en", "note": "fast", "files": {
        "encoder": ("base.en-encoder.int8.onnx", 29120534),
        "decoder": ("base.en-decoder.int8.onnx", 130669978),
        "tokens": ("base.en-tokens.txt", 835554)}},
    "small.en": {"label": "small.en", "note": "more accurate", "files": {
        "encoder": ("small.en-encoder.int8.onnx", 112442483),
        "decoder": ("small.en-decoder.int8.onnx", 262223042),
        "tokens": ("small.en-tokens.txt", 835554)}},
}
DEFAULT_MODEL = "base.en"
AI_CLEANUP = None   # Build B: api.py sets this to (whisper text, rules result) -> result; see NeuroVaultApi._ai_ramble
MODEL_URL = "https://huggingface.co/csukuangfj/sherpa-onnx-whisper-{name}/resolve/main/{file}"


def models_dir():
    return os.environ.get("NV_MODELS_DIR") or os.path.join(app_dir(), "models")


def model_folder(name):
    return os.path.join(models_dir(), "whisper-" + name)


def model_info(name):
    """What the page needs to show a model: installed or not, where, how big, from where."""
    m = MODELS.get(name) or MODELS[DEFAULT_MODEL]
    name = m["label"]
    folder = model_folder(name)
    missing = [f for f, size in m["files"].values()
               if not (os.path.isfile(os.path.join(folder, f)) and os.path.getsize(os.path.join(folder, f)) == size)]
    total = sum(size for _, size in m["files"].values())
    return {"name": name, "note": m["note"], "present": not missing, "missing": missing, "folder": folder,
            "size_mb": round(total / 1e6), "source": MODEL_URL.format(name=name, file="")[:-1]}


def download_model(name, progress=None, cancel=None):
    """Fetch the model's three files into its folder (a .part file each, renamed once its size is right).
    progress(done_bytes, total_bytes) is called as it goes; cancel is a threading.Event."""
    m = MODELS.get(name)
    if not m:
        raise VoiceError(f"Unknown model {name}.")
    folder = model_folder(name)
    os.makedirs(folder, exist_ok=True)
    total = sum(size for _, size in m["files"].values())
    done = 0
    for fname, size in m["files"].values():
        dest = os.path.join(folder, fname)
        if os.path.isfile(dest) and os.path.getsize(dest) == size:
            done += size
            continue
        part = dest + ".part"
        req = urllib.request.Request(MODEL_URL.format(name=name, file=fname), headers={"User-Agent": "NeuroVault"})
        with netssl.urlopen(req, timeout=30) as r, open(part, "wb") as f:
            while True:
                if cancel is not None and cancel.is_set():
                    f.close()
                    os.remove(part)
                    raise VoiceError("Download cancelled.")
                chunk = r.read(1 << 16)
                if not chunk:
                    break
                f.write(chunk)
                done += len(chunk)
                if progress:
                    progress(done, total)
        if os.path.getsize(part) != size:
            os.remove(part)
            raise VoiceError(f"{fname} arrived incomplete. Try again.")
        os.replace(part, dest)
    if progress:
        progress(total, total)


# ======================================================================
# Microphones and the recorder
# ======================================================================

def _sd():
    try:
        import sounddevice
        return sounddevice
    except Exception as e:  # PortAudio missing, or the package isn't installed
        raise VoiceError(plain_error(e, "load the microphone library"))


def list_mics():
    """Input devices by name. WASAPI gives full names (MME cuts them at 31 characters), so its list is used when there is one."""
    sd = _sd()
    try:
        devs, apis = sd.query_devices(), sd.query_hostapis()
    except Exception as e:
        raise VoiceError(plain_error(e, "list the microphones"))
    wasapi = next((i for i, a in enumerate(apis) if "WASAPI" in a["name"]), None)
    api = wasapi if wasapi is not None else sd.default.hostapi
    names = []
    for d in devs:
        if d["max_input_channels"] > 0 and d["hostapi"] == api and d["name"] not in names:
            names.append(d["name"])
    return names


def _find_device(sd, name):
    if not name:
        return None  # the system's default input
    for i, d in enumerate(sd.query_devices()):
        if d["max_input_channels"] > 0 and d["name"] == name:
            return i
    raise VoiceError(f'The microphone "{name}" isn\'t connected. Choose another in Settings → Voice.')


def to_rate(samples, rate):
    """Mono float32 at `rate` → 16 kHz: a short average (against aliasing), then linear interpolation."""
    import numpy as np
    x = np.asarray(samples, dtype=np.float32)
    if rate == RATE or not len(x):
        return x
    k = int(round(rate / RATE))
    if k > 1:
        x = np.convolve(x, np.ones(k, dtype=np.float32) / k, mode="same")
    n = int(len(x) * RATE / rate)
    return np.interp(np.linspace(0, len(x) - 1, n), np.arange(len(x)), x).astype(np.float32)


def read_wav(path):
    """(mono float32 samples, rate) from a PCM .wav file."""
    import numpy as np
    with wave.open(path, "rb") as w:
        ch, width, rate, frames = w.getnchannels(), w.getsampwidth(), w.getframerate(), w.readframes(w.getnframes())
    if width == 2:
        x = np.frombuffer(frames, dtype="<i2").astype(np.float32) / 32768
    elif width == 1:
        x = (np.frombuffer(frames, dtype=np.uint8).astype(np.float32) - 128) / 128
    elif width == 4:
        x = np.frombuffer(frames, dtype="<i4").astype(np.float32) / 2147483648
    else:
        raise VoiceError("Only 8, 16 or 32-bit PCM .wav files can be read.")
    if ch > 1:
        x = x.reshape(-1, ch).mean(axis=1)
    return x, rate


LOUD = 0.3   # Build N (R69): a block louder than this (about -40 dBFS) counts as speech for "stops by itself after a pause"


def _level(block):
    """0 to 1 for the meter: the block's RMS from -55 dBFS (silence) to -5 dBFS (loud)."""
    import numpy as np
    rms = float(np.sqrt(np.mean(np.square(block)))) if len(block) else 0.0
    db = 20 * np.log10(rms + 1e-9)
    return max(0.0, min(1.0, (db + 55) / 50))


class Recorder:
    """Records from a microphone (or, for tests, plays a .wav file in real time as if it were one).

        r = Recorder(device_name, max_seconds=10); r.start(); … r.poll() … samples = r.stop()

    stop() returns mono float32 at 16 kHz. Reaching max_seconds stops taking audio (poll says full)."""
    BLOCK_S = 0.05

    def __init__(self, device=None, max_seconds=600, wav_path=None):
        self.device, self.max_seconds, self.wav_path = device, max_seconds, wav_path
        self.rate = RATE
        self._blocks, self._frames = [], 0
        self._levels = deque(maxlen=64)
        self._lock = threading.Lock()
        self._stream = self._thread = None
        self._stop = threading.Event()
        self.full = False
        self.started = None
        self.paused = False   # Build A: Pause in the recording pill; blocks are dropped (a test .wav holds its place)
        self.listeners = []   # Build A: called with each 16 kHz block as it arrives (live words)
        self._loud_at = None  # Build N (R69): the frame count when the last loud block ended; None until something loud was heard

    def start(self):
        self.started = time.monotonic()
        if self.wav_path:
            data, self.rate = read_wav(self.wav_path)
            self._thread = threading.Thread(target=self._play_wav, args=(data,), daemon=True)
            self._thread.start()
            return self
        sd = _sd()
        dev = _find_device(sd, self.device)
        try:
            info = sd.query_devices(dev, "input")
        except Exception as e:
            raise VoiceError("No microphone found. Check one is plugged in and allowed in Windows Settings → Privacy → Microphone.")
        channels = max(1, min(2, int(info["max_input_channels"])))
        last = None
        for rate in (RATE, int(info["default_samplerate"])):  # 16 kHz if the device takes it, else its own rate
            try:
                self.rate = rate
                self._stream = sd.InputStream(device=dev, channels=channels, samplerate=rate, dtype="float32",
                                              blocksize=int(rate * self.BLOCK_S), callback=self._callback)
                self._stream.start()
                return self
            except Exception as e:
                last, self._stream = e, None
        raise VoiceError(f"The microphone didn't open ({last}). Check it's plugged in and that Windows lets apps use it.")

    def _callback(self, indata, frames, t, status):
        self._take(indata.mean(axis=1) if indata.ndim > 1 else indata[:, 0])

    def _take(self, mono):
        with self._lock:
            if self.full or self.paused:   # Build A: paused
                return
            self._blocks.append(mono.copy())
            self._frames += len(mono)
            lvl = _level(mono)
            self._levels.append(lvl)
            if lvl > LOUD:   # Build N (R69): "stops by itself after a pause" needs to know when the last words were
                self._loud_at = self._frames
            if self._frames >= self.max_seconds * self.rate:
                self.full = True
        for fn in self.listeners:   # Build A: live words
            try:
                fn(to_rate(mono, self.rate))
            except Exception:
                log.exception("a recorder listener failed")

    def _play_wav(self, data):
        import numpy as np
        step = int(self.rate * self.BLOCK_S)
        i, t0 = 0, time.monotonic()
        while not self._stop.is_set() and not self.full:
            if self.paused:   # Build A: a paused test file holds its place, as a microphone would hear nothing new
                time.sleep(self.BLOCK_S)
                t0 += self.BLOCK_S
                continue
            block = data[i:i + step] if i < len(data) else np.zeros(step, dtype=np.float32)  # after the file: silence
            if len(block) < step:
                block = np.concatenate([block, np.zeros(step - len(block), dtype=np.float32)])
            self._take(block)
            i += step
            wait = t0 + i / self.rate - time.monotonic()
            if wait > 0:
                time.sleep(wait)

    @property
    def seconds(self):
        return self._frames / self.rate if self.rate else 0.0

    def poll(self, bars=24):
        with self._lock:
            lv = list(self._levels)[-bars:]
            heard = self._loud_at is not None
            quiet = round((self._frames - self._loud_at) / self.rate, 2) if heard and self.rate else None
        lv = [0.0] * (bars - len(lv)) + lv
        return {"seconds": round(self.seconds, 2), "level": lv[-1], "bars": [round(v, 3) for v in lv],
                "full": self.full, "max_seconds": self.max_seconds, "heard": heard, "quiet": quiet}   # Build N (R69): heard / quiet (seconds since the last loud block)

    def _close(self):
        self._stop.set()
        if self._stream is not None:
            try:
                self._stream.stop()
                self._stream.close()
            except Exception:
                log.exception("closing the input stream")
            self._stream = None
        if self._thread is not None:
            self._thread.join(timeout=2)
            self._thread = None

    def stop(self):
        import numpy as np
        self._close()
        with self._lock:
            x = np.concatenate(self._blocks) if self._blocks else np.zeros(0, dtype=np.float32)
        return to_rate(x, self.rate)

    def cancel(self):
        self._close()
        with self._lock:
            self._blocks = []


# ======================================================================
# Transcription (sherpa-onnx Whisper, offline)
# ======================================================================

_RECOGNIZERS = {}
_REC_LOCK = threading.Lock()


def recognizer(name):
    info = model_info(name)
    if not info["present"]:
        raise VoiceError(f"The Whisper {info['name']} model isn't installed. Download it in Settings → Voice.")
    with _REC_LOCK:
        if info["name"] not in _RECOGNIZERS:
            try:
                import sherpa_onnx
            except Exception as e:
                raise VoiceError(plain_error(e, "load the speech library"))
            f = {k: os.path.join(info["folder"], v[0]) for k, v in MODELS[info["name"]]["files"].items()}
            _RECOGNIZERS[info["name"]] = sherpa_onnx.OfflineRecognizer.from_whisper(
                encoder=f["encoder"], decoder=f["decoder"], tokens=f["tokens"], language="en", task="transcribe",
                num_threads=max(1, min(4, (os.cpu_count() or 2) - 1)))
        return _RECOGNIZERS[info["name"]]


def split_chunks(samples, max_s=28.0, look_s=8.0):
    """Whisper reads at most 30 seconds at a time: cut longer audio at the quietest moment of each window's last 8 seconds."""
    import numpy as np
    n, cap, out, i = len(samples), int(max_s * RATE), [], 0
    win = int(0.2 * RATE)
    while n - i > cap:
        lo, hi = i + cap - int(look_s * RATE), i + cap
        seg = samples[lo:hi]
        e = np.convolve(np.square(seg), np.ones(win) / win, mode="valid") if len(seg) > win else np.square(seg)
        cut = lo + int(np.argmin(e)) + win // 2
        out.append(samples[i:cut])
        i = cut
    out.append(samples[i:])
    return [c for c in out if len(c)]


SILENT_PEAK = 0.01  # under -40 dBFS throughout: nothing said (Whisper would make up "Thank you." for silence)


def transcribe(samples, name=DEFAULT_MODEL, progress=None):
    import numpy as np
    rec = recognizer(name)
    chunks = split_chunks(np.asarray(samples, dtype=np.float32))
    texts = []
    for k, chunk in enumerate(chunks):
        if progress:
            progress(k, len(chunks))
        if not len(chunk) or float(np.max(np.abs(chunk))) < SILENT_PEAK:
            continue
        s = rec.create_stream()
        s.accept_waveform(RATE, chunk)
        rec.decode_stream(s)
        texts.append(s.result.text.strip())
    if progress:
        progress(len(chunks), len(chunks))
    return clean_whisper(" ".join(t for t in texts if t))


def clean_whisper(text):
    """Whisper's own markers ([BLANK_AUDIO], (music)) and spacing."""
    text = re.sub(r"\[[^\]]*\]|\((?:[^)]*\b(?:music|silence|blank|inaudible|laugh\w*|applause|noise)\b[^)]*)\)", " ", text, flags=re.I)
    return re.sub(r"\s+", " ", text).strip()


# ======================================================================
# Cleanup by rules: filler words, sentences, paragraphs, tasks
# ======================================================================

VERBS = """ask email e-mail call ring phone text message book buy order send write check finish fix pay pick get make schedule
tell review read update clean cancel renew submit prepare prep look reply follow sort set plan print move add take bring find
return file share meet research contact post draft sign chase confirm organise organize arrange start test try put go visit
collect drop grab remind talk speak mention invite reschedule block back upload download install change ping double-check
water feed wash cook tidy note record log register apply think decide figure work learn practise practice watch listen see
give let ship push merge deploy publish refactor rename remove delete create build design outline summarise summarize charge
clear empty fill hand pack request transfer top renew print scan""".split()
_VERB = r"(?:" + "|".join(sorted(map(re.escape, set(VERBS)), key=len, reverse=True)) + r")"

_INTERJECTION = re.compile(r"\b(?:u+m+|u+h+m*|uhm|e+r+m+|er+|a+h+|h+m+|m+h+m+|mm+)\b[,.]?", re.I)
_FILLER_PHRASES = [
    re.compile(r",\s*you know\b(?=\s*[,.!?]|\s*$)", re.I),   # ", you know," / ", you know."
    re.compile(r"\byou know\s*,\s*", re.I),                 # "you know, …"
    re.compile(r"\bI mean\s*,\s*", re.I),
    re.compile(r",\s*like\s*,", re.I),                      # ", like," → ","
    re.compile(r"(?:(?<=^)|(?<=[.!?]\s))like\s*,\s*", re.I),  # a sentence starting "Like, …"
    re.compile(r"\b(?:basically|literally|honestly)\s*,\s*", re.I),
    re.compile(r",\s*(?:basically|literally)\b(?=\s*[,.!?])", re.I),
]
_STUTTER = re.compile(r"\b([a-z']+)(?:\s*,?\s+\1\b)+", re.I)
_LEADIN = re.compile(r"^(?:(?:okay|ok|alright|all right|so|oh|and|also|plus|anyway|yeah|now then)\b,?|(?:right|well|now|then|see)\s*,)\s*", re.I)
_SHIFT = re.compile(r"^(?:\W*)(?:anyway|also|another thing|next|oh,? and|and also|secondly|thirdly|finally|lastly|"
                    r"on another note|moving on|the other thing|besides|separately|other than that)\b", re.I)
_TRIGGER = re.compile(r"""\b(?:
    (?:(?:can|could|would|will)\s+you\s+)?(?:please\s+)?remind\s+me\s+(?:to|that\s+(?:i|we)\s+(?:need|have)\s+to)
  | (?:i|we)(?:'ll|\s+will)?\s+(?:(?:really|also|still|definitely|just|probably|totally|actually)\s+)*(?:need|have|ought)\s+to
  | (?:i|we)(?:'ve|\s+have)?\s+(?:(?:really|also|still|just)\s+)*got\s+to
  | (?:i|we)\s+(?:(?:really|also|still|just|definitely|probably)\s+)*(?:gotta|must|should)(?!\s+(?:have|be|not)\b)
  | (?:please\s+)?remember\s+to
  | must\s+not\s+forget\s+to
  | (?:don't|don’t|do\s+not|dont)\s+(?:let\s+me\s+)?forget(?:\s+to)?
  | make\s+sure\s+(?:to|(?:that\s+)?(?:i|we))
  | note\s+to\s+self\s*[:,]?
  | to-?do\s*[:,]
)\b\s*""", re.I | re.X)
_TAIL_CONNECTOR = re.compile(r"(?:[\s,;:]+|\b(?:and|so|but|because|cause|then|which|plus|or)\b)+$", re.I)
_HEAD_FILLER = re.compile(r"^(?:(?:and|also|then|just|really|definitely|go and|probably)\s+)+", re.I)
_HEDGE = re.compile(r"(?:(?:and|so|but)\s+)?(?:(?:i|we)\s+(?:was\s+|were\s+|am\s+|'m\s+)?(?:think(?:ing)?|guess|reckon|suppose|feel(?:\s+like)?|figured?|realised|realized)"
                   r"(?:\s+that)?|maybe|probably|perhaps|honestly|actually|basically|i\s+mean|you\s+know)\W*", re.I)
_LOWER_FIRST = set("""for about on in at with re regarding by before after tomorrow today tonight this next on the when if
once while during""".split())
_ABBREV = {"mr", "mrs", "ms", "dr", "st", "vs", "etc", "e.g", "i.e", "approx", "no", "jr", "sr", "prof"}


def remove_fillers(text):
    text = _INTERJECTION.sub(" ", text)
    for rx in _FILLER_PHRASES:
        text = rx.sub(lambda m: "," if m.group(0).strip().startswith(",") and m.group(0).strip().endswith(",") else " ", text)
    text = _STUTTER.sub(r"\1", text)
    return tidy_punctuation(text)


def tidy_punctuation(text):
    text = re.sub(r"\s+([,.!?;:])", r"\1", text)
    text = re.sub(r",(?:\s*,)+", ",", text)
    text = re.sub(r",\s*([.!?])", r"\1", text)
    text = re.sub(r"([.!?])(?:\s*[,.!?])+", r"\1", text)
    text = re.sub(r"(^|[.!?]\s+)[,;:]\s*", r"\1", text)
    text = re.sub(r"\s+", " ", text).strip()
    return re.sub(r"^[,;:.\s]+", "", text)


def split_sentences(text):
    """Split after . ! ? when a space follows; "Dr. Smith", "e.g. this" and "3 p.m. on Friday" stay whole."""
    out, start = [], 0
    for m in re.finditer(r"[.!?]+(?=\s+|$)", text):
        end = m.end()
        word = re.search(r"([A-Za-z.]+)\.$", text[start:end])
        nxt = text[end:].lstrip()[:1]
        if word and word.group(1).lower().rstrip(".") in _ABBREV and nxt:
            continue
        if re.search(r"\b[ap]\.m\.$", text[start:end], re.I) and nxt and not nxt.isupper():
            continue
        out.append(text[start:end].strip())
        start = end
    if text[start:].strip():
        out.append(text[start:].strip())
    return [s for s in out if re.search(r"\w", s)]


def strip_leadins(s):
    while True:
        t = _LEADIN.sub("", s, count=1)
        if t == s or len(re.findall(r"\w+", t)) < 2:
            return s
        s = t


def finish_sentence(s):
    s = tidy_punctuation(s)
    s = re.sub(r"\bi\b(?!\.e)(?=(?:'|’|\s|[,.!?;:]|$))", "I", s)
    if s and s[0].isalpha():
        s = s[0].upper() + s[1:]
    if s and s[-1] not in ".!?":
        s += "."
    return s


def _task_text(piece):
    piece = _HEAD_FILLER.sub("", piece.strip(" ,;:")).strip()
    piece = _TAIL_CONNECTOR.sub("", piece).strip()
    piece = re.sub(r"[.!?]+$", "", piece).strip()
    piece = re.sub(r"\bi\b(?!\.e)(?=(?:'|’|\s|[,.!?;:]|$))", "I", piece)
    return piece[0].upper() + piece[1:] if piece else ""


_SPLIT_VERB = re.compile(r"(?:,\s*(?:and\s+)?|\s+and\s+)(?:(?:also|then)\s+)?(?=" + _VERB + r"\b)|;\s*", re.I)


def extract_tasks(sentence):
    """([task, …], note_text or "") for one sentence."""
    hits = list(_TRIGGER.finditer(sentence))
    if not hits:
        return [], sentence
    tasks = []
    for k, m in enumerate(hits):
        rest = sentence[m.end():hits[k + 1].start() if k + 1 < len(hits) else len(sentence)]
        trig = m.group(0).lower()
        no_to = re.search(r"forget\s*$", trig) is not None
        for piece in _SPLIT_VERB.split(rest):
            t = _task_text(piece)
            if not t:
                continue
            if no_to and not re.match(_VERB + r"\b", t, re.I):
                t = "Don't forget " + t[0].lower() + t[1:]
            tasks.append(t)
    prefix = strip_leadins(sentence[:hits[0].start()].strip(" ,;:"))
    prefix = _TAIL_CONNECTOR.sub("", prefix).strip()
    prefix = strip_leadins(prefix) if prefix else ""
    if re.fullmatch(r"(?:(?:okay|ok|so|oh|and|also|well|right|anyway|but|plus|then|now)\W*)*", prefix, re.I) or _HEDGE.fullmatch(prefix):
        prefix = ""
    if not tasks:
        return [], sentence
    if prefix:
        if len(re.findall(r"[\w'’£$€%-]+", prefix)) <= 6:
            first = prefix.split()[0]
            p = first.lower() + prefix[len(first):] if first.lower() in _LOWER_FIRST else prefix
            tasks[0] = f"{tasks[0]} ({p})"
            prefix = ""
    return tasks, prefix


def tidy(raw):
    """The cleaned note and tasks for a raw transcript, with the anchor check (see check_anchors)."""
    text = remove_fillers(clean_whisper(raw or ""))
    paras, tasks, cur = [], [], []
    for s in split_sentences(text):
        shift = bool(_SHIFT.match(s))
        s = strip_leadins(s)
        found, note = extract_tasks(s)
        tasks.extend(found)
        if note and re.search(r"\w", note):
            if (shift and cur) or len(cur) >= 4:
                paras.append(" ".join(cur))
                cur = []
            cur.append(finish_sentence(note))
    if cur:
        paras.append(" ".join(cur))
    return check_anchors(raw or "", paras, tasks)


# ======================================================================
# Anchors: what must not get lost between what was said and the cleaned note
# ======================================================================

_MONTHS = r"(?:january|february|march|april|may|june|july|august|september|october|november|december)"
_MON_ABBR = r"(?:jan|feb|mar|apr|jun|jul|aug|sept?|oct|nov|dec)\.?"
_DAYS = r"(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)s?"
_ORD = r"\d{1,2}(?:st|nd|rd|th)"
_NW = (r"(?:two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|"
       r"nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand|million|billion)"
       r"(?:-(?:one|two|three|four|five|six|seven|eight|nine))?")
_NUMWORDS = r"(?:(?:one|a)(?=\s+(?:hundred|thousand|million|billion))|" + _NW + r")(?:[\s-]+(?:and\s+)?(?:" + _NW + r"|one))*"
_HOUR = r"(?:\d{1,2}|one|" + _NW + r")"
_AMPM = r"(?:a\.?m\.?|p\.?m\.?)(?![a-z])"
_CUR_WORDS = r"(?:pounds?|quid|dollars?|bucks|euros?|pence|cents?|grand)"

ANCHOR_PATTERNS = [  # (kind, regex); overlaps go to the longer match, then to the earlier kind here
    ("Money", r"[£$€]\s?\d[\d,]*(?:\.\d+)?(?:\s?(?:k|m|bn|million|billion|thousand)\b)?"),
    ("Money", r"\b\d[\d,]*(?:\.\d+)?\s?(?:k\s)?" + _CUR_WORDS + r"\b"),
    ("Money", r"\b\d[\d,]*(?:\.\d+)?p\b"),
    ("Money", r"\b" + _NUMWORDS + r"\s+" + _CUR_WORDS + r"\b"),
    ("Time", r"\b\d{1,2}(?:[:.]\d{2})?\s?" + _AMPM),
    ("Time", r"\b" + _HOUR + r"\s+" + _AMPM),
    ("Time", r"\b\d{1,2}:\d{2}\b"),
    ("Time", r"\b(?:noon|midday|midnight)\b"),
    ("Time", r"\b(?:half past|quarter past|quarter to)\s+" + _HOUR + r"\b"),
    ("Time", r"\b" + _HOUR + r"\s+o'?clock\b"),
    ("Date", r"\b(?:(?:next|this|last)\s+)?" + _DAYS + r"(?:\s+(?:morning|afternoon|evening|night))?\b"),
    ("Date", r"\b(?:today|tonight|tomorrow|yesterday)(?:\s+(?:morning|afternoon|evening|night))?\b"),
    ("Date", r"\bthis\s+(?:morning|afternoon|evening)\b"),
    ("Date", r"\b(?:next|this|last)\s+(?:week|month|year|weekend|quarter)\b"),
    ("Date", r"\b(?:the\s+)?end\s+of\s+(?:the\s+)?(?:day|week|month|year|quarter)\b"),
    ("Date", r"\b(?:" + _ORD + r"|\d{1,2})\s+(?:of\s+)?(?:" + _MONTHS + "|" + _MON_ABBR + r")(?:\s+\d{4})?(?![a-z])"),
    ("Date", r"\b(?:" + _MONTHS + "|" + _MON_ABBR + r")\s+(?:the\s+)?(?:" + _ORD + r"|\d{1,2})\b(?:,?\s+\d{4})?"),
    ("Date", r"(?<=\bthe )" + _ORD + r"\b"),
    ("Date", r"\b\d{1,2}/\d{1,2}(?:/\d{2,4})?\b"),
    ("Date", r"\b\d{4}-\d{2}-\d{2}\b"),
    ("Date", r"\bin\s+(?:\d+|a|an|" + _NUMWORDS + r")\s+(?:days?|weeks?|months?|years?)\b"),
    ("Date", r"\b(?:19|20)\d{2}\b"),
    ("Number", r"\b\d[\d,]*(?:\.\d+)?(?:\s?%|\s(?:percent|per cent))?(?![\w])"),
    ("Number", r"\b" + _ORD + r"\b"),
    ("Number", r"\b" + _NUMWORDS + r"(?:\s(?:percent|per cent))?\b"),
]
_CASE_SENSITIVE = [  # quarters and capitalised month names on their own
    ("Date", r"\bQ[1-4]\b"),
    ("Date", r"\b(?:January|February|April|June|July|August|September|October|November|December)\b"),
]
_COMPILED = [(k, re.compile(p, re.I)) for k, p in ANCHOR_PATTERNS] + [(k, re.compile(p)) for k, p in _CASE_SENSITIVE]
_KIND_ORDER = ["Money", "Date", "Time", "Number", "Name"]
_DEADLINE = re.compile(r"(?:\bby|\bbefore|\bdue(?:\s+(?:on|by))?|\buntil|\btill|\bno later than|\bdeadline(?:\s+is)?)\s+(?:the\s+|on\s+)?$", re.I)
_NOT_NAMES = {"I", "I'm", "I'll", "I've", "I'd", "OK", "Okay", "AM", "PM", "A.M", "P.M", "Mr", "Mrs", "Ms", "Dr"}
# Words that often start a spoken sentence: there, a capital doesn't make a name (a word not listed here does: "Sam said…")
_STARTERS = set(VERBS) | set("""a an the this that these those there here it its it's i'm i've i'll we we're we'll they they're he
she you your my our their his her me us them what when where why how who which whose if then so and but or because also plus
oh okay ok well right yeah yes no not maybe perhaps probably actually basically honestly anyway now just only still even
first second third next last finally after before once while during since until as at by for from in into of on to with
about over under up down out off all any some every each most more much many few lots lot both either neither nothing
everything something anything someone everyone nobody one two three is are was were be been being have has had do does
did can could will would shall should may might must need needs let's lets don't didn't can't won't isn't wasn't it'd
there's here's that's what's good great nice cool fine sure thanks thank please sorry hey hi hello like really very
today tomorrow tonight yesterday morning afternoon evening night week month year time thing things stuff people idea
another other such same new old big small little long short ah uh um umm er erm hmm mhm huh wow yep nope hey due remember important quick""".split())
_NAME_TOKEN = re.compile(r"\b(?:[A-Z][a-zA-Z]*[a-z][a-zA-Z]*|[A-Z]{2,}[0-9]*|[A-Z][0-9]+)(?:['’][a-z]+)?\b")


def _sentence_starts(text):
    starts = {0}
    for m in re.finditer(r"[.!?:]\s+[\"'“‘(]?|^[\"'“‘(]", text):
        word = re.search(r"([A-Za-z.]+)[.]\s+\S*$", text[:m.end()])
        if not (word and word.group(1).lower() in _ABBREV):  # "Dr. Smith" isn't a new sentence
            starts.add(m.end())
    return starts


def find_names(text):
    """Capitalised words that aren't at the start of a sentence (or are there and also capitalised elsewhere), and acronyms.
    Next to each other they join ("Maya Patel"); a possessive 's is left out."""
    starts = _sentence_starts(text)
    toks = []
    for m in _NAME_TOKEN.finditer(text):
        word = re.sub(r"['’][a-z]+$", "", m.group(0))
        if word in _NOT_NAMES or re.fullmatch(_DAYS + "|" + _MONTHS, word, re.I) or _INTERJECTION.fullmatch(word) \
                or word.lower() in ("wow", "yeah", "yep", "nope", "hey", "oh", "huh", "ok", "okay", "hi", "hello", "thanks"):
            continue
        toks.append((m.start(), m.start() + len(word), word, m.start() in starts))
    mid = {w for _, _, w, first in toks if not first}
    lower = set(re.findall(r"\b[a-z][a-z'’]*\b", text))  # "budget" said in lower case elsewhere: "Budget" isn't a name
    spans, k = [], 0
    while k < len(toks):
        s, e, w, first = toks[k]
        if first and w.lower() in _STARTERS and w not in mid:  # "Email Maya…": the sentence's first word isn't part of the name
            k += 1
            continue
        j = k
        while j + 1 < len(toks) and re.fullmatch(r" (?:of |de |van |von |the )?", text[toks[j][1]:toks[j + 1][0]]):
            j += 1
        acronym = w.isupper() and len(w) > 1
        if j > k or not first or acronym or w in mid or (w.lower() not in _STARTERS and w.lower() not in lower):
            title = re.search(r"\b(?:Mr|Mrs|Ms|Dr|Prof)\.?\s$", text[max(0, s - 6):s])
            spans.append((s - len(title.group(0)) if title else s, toks[j][1]))
        k = j + 1
    return spans


def find_anchors(text):
    """[(start, end, kind)] in the raw transcript, without overlaps."""
    cands = []
    for kind, rx in _COMPILED:
        for m in rx.finditer(text):
            s, e = m.start(), m.end()
            while e > s and text[e - 1] in " ,." and not re.search(r"\b[ap]\.m\.$", text[s:e], re.I):
                e -= 1
            if e > s:
                cands.append((s, e, kind))
    cands += [(s, e, "Name") for s, e in find_names(text)]
    cands.sort(key=lambda c: (-(c[1] - c[0]), _KIND_ORDER.index(c[2]), c[0]))
    taken, out = [], []
    for s, e, k in cands:
        if any(s < te and ts < e for ts, te in taken):
            continue
        taken.append((s, e))
        out.append((s, e, k))
    out.sort()
    # a date and a time side by side ("Tuesday at 3pm", "3pm on Friday") are one anchor
    merged = []
    for s, e, k in out:
        if merged:
            ps, pe, pk = merged[-1]
            gap = text[pe:s]
            if ({pk, k} == {"Date", "Time"} and (re.fullmatch(r"\s*(?:at|@|,|from|around|by|on)?\s*", gap, re.I))):
                merged[-1] = (ps, e, "Date and time")
                continue
        merged.append((s, e, k))
    final = []
    for s, e, k in merged:
        if k in ("Date", "Time", "Date and time") and _DEADLINE.search(text[max(0, s - 30):s]):
            k = "Deadline"
        final.append((s, e, k))
    return final


def _norm(s):
    return re.sub(r"\s+", " ", s.replace("’", "'")).strip().lower()


def _contains(hay, needle):
    return re.search(r"(?<![\w£$€])" + re.escape(needle) + r"(?!\w)", hay) is not None


def _segments(text, anchors):
    """[[text, anchor id or None], …]: every anchor that appears in text, longest first, without overlaps."""
    low, spans = _norm_keep(text), []
    for aid, a in sorted(anchors.items(), key=lambda kv: -len(kv[1]["key"])):
        for m in re.finditer(r"(?<![\w£$€])" + re.escape(a["key"]) + r"(?!\w)", low):
            if not any(m.start() < e and s < m.end() for s, e, _ in spans):
                spans.append((m.start(), m.end(), aid))
    spans.sort()
    out, at = [], 0
    for s, e, aid in spans:
        if s > at:
            out.append([text[at:s], None])
        out.append([text[s:e], aid])
        at = e
    if at < len(text):
        out.append([text[at:], None])
    return out


def _norm_keep(s):
    """Lower case with the same length as s, so match offsets map back."""
    return s.replace("’", "'").lower()


def check_anchors(raw, paras, tasks):
    """The check pane's data: the raw transcript and the cleaned note as segments, anchors marked, and for each anchor
    whether it's in the cleaned note (found) and which item it belongs in if not (item: ["p", i] or ["t", i])."""
    spans = find_anchors(raw)
    anchors, ids, raw_segs, at = {}, {}, [], 0
    for s, e, kind in spans:
        key = _norm(raw[s:e])
        if key not in ids:
            ids[key] = "a%d" % (len(ids) + 1)
            anchors[ids[key]] = {"text": raw[s:e], "kind": kind, "key": key}
        if s > at:
            raw_segs.append([raw[at:s], None])
        raw_segs.append([raw[s:e], ids[key]])
        at = e
    if at < len(raw):
        raw_segs.append([raw[at:], None])
    clean = _norm(" \n ".join(paras + tasks))
    sentences = [(m.start(), m.end()) for m in re.finditer(r"[^.!?]+[.!?]*", raw)]
    items = [("p", i, t) for i, t in enumerate(paras)] + [("t", i, t) for i, t in enumerate(tasks)]
    for aid, a in anchors.items():
        a["found"] = _contains(clean, a["key"])
        a["item"] = None
        if not a["found"] and items:
            first = next(s for s, e, k in spans if _norm(raw[s:e]) == a["key"])
            sent = next((raw[s:e] for s, e in sentences if s <= first < e), raw)
            words = set(re.findall(r"\w+", sent.lower()))
            best = max(items, key=lambda it: (len(words & set(re.findall(r"\w+", it[2].lower()))), -items.index(it)))
            a["item"] = [best[0], best[1]]
    return {"raw": raw_segs, "paras": [_segments(p, anchors) for p in paras], "tasks": [_segments(t, anchors) for t in tasks],
            "anchors": {k: {x: v[x] for x in ("text", "kind", "found", "item")} for k, v in anchors.items()},
            "missing": sum(1 for a in anchors.values() if not a["found"])}


# ======================================================================
# The session the API drives: record → transcribe → tidy, and the model download
# ======================================================================

class Session:
    """One recording at a time. stage: idle | recording | transcribing | done | error."""
    TEST_WAV = os.environ.get("NV_VOICE_WAV") or None  # dev: play this file instead of the microphone

    def __init__(self):
        self.stage, self.message, self.result, self.progress = "idle", "", None, (0, 0)
        self.code = ""   # Build N (R69): why it failed, for the page: nothing | error
        self.rec, self.seconds = None, 0.0
        self.take, self.take_started, self.live = None, None, None   # Build A: the last recording (16 kHz), when it began, live words
        self.dl = {"stage": "idle", "name": None, "done": 0, "total": 0, "message": ""}
        self._dl_cancel = threading.Event()
        self._lock = threading.Lock()

    def start(self, model, mic, max_seconds=600, live=False, local=True):
        info = model_info(model)
        if local and not info["present"]:   # Build N (R69): words heard by a cloud model need no model here
            raise VoiceError(f"The Whisper {info['name']} model isn't installed yet.")
        with self._lock:
            if self.rec:
                self.rec.cancel()
            rec = Recorder(mic, max_seconds=max_seconds, wav_path=self.TEST_WAV)
            self.live = LiveWords() if live and live_info()["present"] else None   # Build A: live words, when on and installed
            if self.live:
                rec.listeners.append(self.live.feed)
            rec.start()
            self.rec, self.stage, self.message, self.result, self.seconds = rec, "recording", "", None, 0.0
            self.code = ""   # Build N (R69)
            self.take, self.take_started = None, datetime.now()   # Build A
        if local:
            threading.Thread(target=recognizer, args=(model,), daemon=True).start()  # load the model while you talk

    def poll(self):
        with self._lock:
            out = {"stage": self.stage, "message": self.message, "seconds": round(self.seconds, 1), "code": getattr(self, "code", "")}
            if self.stage == "recording" and self.rec:
                out.update(self.rec.poll())
                out["paused"] = self.rec.paused   # Build A
                out["words"] = self.live.words() if self.live else None   # Build A: None when live words is off
            elif self.stage == "transcribing":
                out["done"], out["total"] = self.progress
            elif self.stage == "done":
                out["result"] = self.result
            return out

    def stop(self, model, plain=False, engine=None):
        """plain (Build N, R69): just the words (clean_whisper), no tidy-up or tasks; engine: a function from the 16 kHz samples to
        the words, used instead of the local Whisper (the cloud speech call)."""
        with self._lock:
            rec = self.rec
            if self.stage != "recording" or not rec:
                raise VoiceError("Nothing is being recorded.")
            self.rec, self.stage, self.progress = None, "transcribing", (0, 1)
        samples = rec.stop()
        self.seconds = len(samples) / RATE
        self.take = samples   # Build A: kept until it's saved as a file or thrown away
        if self.live:
            self.live.close()
            self.live = None
        threading.Thread(target=self._transcribe, args=(samples, model, plain, engine), daemon=True).start()

    def _transcribe(self, samples, model, plain=False, engine=None):
        try:
            def prog(k, n):
                self.progress = (k, n)
            if engine:
                import numpy as np
                quiet = not len(samples) or float(np.max(np.abs(samples))) < SILENT_PEAK   # silence isn't sent (Whisper makes up "Thank you.")
                text = "" if quiet else clean_whisper(engine(samples))
            else:
                text = transcribe(samples, model, prog)
            if plain:   # Build N (R69): Ask wants the words as spoken
                with self._lock:
                    if self.stage != "transcribing":
                        return  # discarded meanwhile
                    if not text:
                        self.stage, self.message, self.code = "error", "Nothing was heard.", "nothing"
                    else:
                        self.stage, self.result = "done", {"text": text, "seconds": round(self.seconds, 1)}
                return
            result = tidy(text) if text else None
            if result is not None and AI_CLEANUP:   # Build B: the model in use tidies it when it's ready; the rules stay the fallback
                result = AI_CLEANUP(text, result)
            with self._lock:
                if self.stage != "transcribing":
                    return  # discarded meanwhile
                if not text:
                    self.stage, self.message, self.code = "error", "Nothing was heard. Check the microphone in Settings → Voice and try again.", "nothing"
                else:
                    result["text"], result["seconds"] = text, round(self.seconds, 1)
                    self.stage, self.result = "done", result
        except VoiceError as e:
            self.stage, self.message, self.code = "error", plain_error(e), getattr(e, "code", "error")
        except Exception as e:
            log.exception("transcription failed")
            self.stage, self.message, self.code = "error", plain_error(e, "write down what you said"), "error"

    def discard(self):
        with self._lock:
            if self.rec:
                self.rec.cancel()
            if self.live:   # Build A
                self.live.close()
            self.rec, self.stage, self.message, self.result = None, "idle", "", None
            self.take, self.live = None, None   # Build A

    # ---- model download ----
    def download(self, name):
        if self.dl["stage"] == "downloading":
            raise VoiceError("A download is already running.")
        info = model_info(name)
        self._dl_cancel.clear()
        self.dl = {"stage": "downloading", "name": info["name"], "done": 0, "total": info["size_mb"] * 10 ** 6, "message": ""}

        def run():
            try:
                download_model(info["name"], lambda d, t: self.dl.update(done=d, total=t), self._dl_cancel)
                self.dl.update(stage="done", message=f"Whisper {info['name']} is installed.")
            except VoiceError as e:
                self.dl.update(stage="error", message=plain_error(e))
            except Exception as e:
                log.exception("model download failed")
                self.dl.update(stage="error", message=plain_error(e, "download the speech model"))
        threading.Thread(target=run, daemon=True).start()

    def cancel_download(self):
        self._dl_cancel.set()

    # ---- Build A · voice ramble v2: pause, the take as a file, Transcribe for a saved clip, the live-words model ----
    def pause(self, paused):
        with self._lock:
            if self.stage != "recording" or not self.rec:
                raise VoiceError("Nothing is being recorded.")
            self.rec.paused = bool(paused)
            return self.rec.paused

    def take_bytes(self, ext):
        """The last recording, encoded (.ogg Opus or .wav), or VoiceError when there is none."""
        if self.take is None or not len(self.take):
            raise VoiceError("There's no recording to save.")
        return encode(self.take, ext)

    def drop_take(self):
        self.take = None

    def transcribe_samples(self, samples, model):
        """Transcribe audio that's already recorded (a saved clip's Transcribe); poll() as after Stop."""
        with self._lock:
            if self.stage == "recording":
                raise VoiceError("Stop the recording first.")
            self.stage, self.message, self.result, self.progress = "transcribing", "", None, (0, 1)
            self.take, self.seconds = None, len(samples) / RATE
        threading.Thread(target=self._transcribe, args=(samples, model), daemon=True).start()

    def download_live(self):
        if self.dl["stage"] == "downloading":
            raise VoiceError("A download is already running.")
        info = live_info()
        self._dl_cancel.clear()
        self.dl = {"stage": "downloading", "name": "live", "done": 0, "total": info["bytes"], "message": ""}

        def run():
            try:
                fetch_files(info["folder"], LIVE_MODEL["files"].values(), lambda f: LIVE_URL.format(repo=LIVE_MODEL["repo"], file=f),
                            lambda d, t: self.dl.update(done=d, total=t), self._dl_cancel)
                self.dl.update(stage="done", message="Live words is installed.")
            except VoiceError as e:
                self.dl.update(stage="error", message=plain_error(e))
            except Exception as e:
                log.exception("live model download failed")
                self.dl.update(stage="error", message=plain_error(e, "download the speech model"))
        threading.Thread(target=run, daemon=True).start()
    # ---- end Build A ----


# ======================================================================
# Build A · voice ramble v2: clips as files, and live words while recording
# ======================================================================

def audio_ext():
    """.ogg (Opus, about 4 KB a second) when soundfile is installed with Opus, else .wav (16-bit, about 32 KB a second)."""
    try:
        import soundfile
        return ".ogg" if "OPUS" in soundfile.available_subtypes("OGG") else ".wav"
    except Exception:
        return ".wav"


def encode(samples, ext):
    """Mono 16 kHz float32 → the bytes of an .ogg (Opus) or .wav file."""
    import io
    import numpy as np
    x = np.clip(np.asarray(samples, dtype=np.float32), -1, 1)
    buf = io.BytesIO()
    if ext == ".ogg":
        import soundfile
        with soundfile.SoundFile(buf, "w", RATE, 1, format="OGG", subtype="OPUS") as f:
            for i in range(0, len(x), RATE * 10):  # in 10-second pieces
                f.write(x[i:i + RATE * 10])
    else:
        with wave.open(buf, "wb") as w:
            w.setnchannels(1)
            w.setsampwidth(2)
            w.setframerate(RATE)
            w.writeframes((x * 32767).astype("<i2").tobytes())
    return buf.getvalue()


def read_audio(path):
    """(mono float32, rate) from an audio file: soundfile for .ogg / .flac / .wav, the wave module for .wav without it."""
    try:
        import soundfile
        x, rate = soundfile.read(path, dtype="float32", always_2d=True)
        return x.mean(axis=1), rate
    except ImportError:
        pass
    except Exception as e:
        if not path.lower().endswith(".wav"):
            raise VoiceError(plain_error(e, f"read {os.path.basename(path)}"))
    return read_wav(path)


def fetch_files(folder, files, url_for, progress=None, cancel=None):
    """Fetch [(name, exact size), …] into folder: a .part file each, renamed once its size is right."""
    files = list(files)
    os.makedirs(folder, exist_ok=True)
    total, done = sum(size for _, size in files), 0
    for fname, size in files:
        dest = os.path.join(folder, fname)
        if os.path.isfile(dest) and os.path.getsize(dest) == size:
            done += size
            continue
        part = dest + ".part"
        req = urllib.request.Request(url_for(fname), headers={"User-Agent": "NeuroVault"})
        with netssl.urlopen(req, timeout=30) as r, open(part, "wb") as f:
            while True:
                if cancel is not None and cancel.is_set():
                    f.close()
                    os.remove(part)
                    raise VoiceError("Download cancelled.")
                chunk = r.read(1 << 16)
                if not chunk:
                    break
                f.write(chunk)
                done += len(chunk)
                if progress:
                    progress(done, total)
        if os.path.getsize(part) != size:
            os.remove(part)
            raise VoiceError(f"{fname} arrived incomplete. Try again.")
        os.replace(part, dest)
    if progress:
        progress(total, total)


# Live words: a small streaming English model (sherpa-onnx's 20M-parameter zipformer, int8). It only shows the last
# few words in the pill, so you know it's listening; Whisper still writes the real text after Stop.
LIVE_MODEL = {"repo": "sherpa-onnx-streaming-zipformer-en-20M-2023-02-17", "label": "Streaming zipformer (English, 20M)", "files": {
    "encoder": ("encoder-epoch-99-avg-1.int8.onnx", 42845182),
    "decoder": ("decoder-epoch-99-avg-1.int8.onnx", 539499),
    "joiner": ("joiner-epoch-99-avg-1.int8.onnx", 259572),
    "tokens": ("tokens.txt", 5048)}}
LIVE_URL = "https://huggingface.co/csukuangfj/{repo}/resolve/main/{file}"
LIVE_MIN_FREE_GB = 5  # R28: on by default with this much free space on the data drive


def live_info():
    folder = os.path.join(models_dir(), LIVE_MODEL["repo"])
    missing = [f for f, size in LIVE_MODEL["files"].values()
               if not (os.path.isfile(os.path.join(folder, f)) and os.path.getsize(os.path.join(folder, f)) == size)]
    total = sum(size for _, size in LIVE_MODEL["files"].values())
    return {"name": LIVE_MODEL["repo"], "label": LIVE_MODEL["label"], "present": not missing, "folder": folder, "bytes": total,
            "size_mb": round(total / 1e6), "source": "https://huggingface.co/csukuangfj/" + LIVE_MODEL["repo"]}


_LIVE_REC = []


def live_recognizer():
    info = live_info()
    if not info["present"]:
        raise VoiceError("The live-words model isn't installed. Download it in Settings → Voice.")
    with _REC_LOCK:
        if not _LIVE_REC:
            import sherpa_onnx
            f = {k: os.path.join(info["folder"], v[0]) for k, v in LIVE_MODEL["files"].items()}
            _LIVE_REC.append(sherpa_onnx.OnlineRecognizer.from_transducer(
                tokens=f["tokens"], encoder=f["encoder"], decoder=f["decoder"], joiner=f["joiner"], num_threads=1,
                sample_rate=RATE, feature_dim=80, enable_endpoint_detection=True, decoding_method="greedy_search"))
        return _LIVE_REC[0]


class LiveWords:
    """Feeds the recorder's 16 kHz blocks to the streaming model on its own thread; words() is the tail of what it heard."""

    def __init__(self):
        import queue
        self._q, self._said, self._now = queue.Queue(), [], ""
        self._stop = threading.Event()
        self._thread = threading.Thread(target=self._run, daemon=True)
        self._thread.start()

    def feed(self, block):
        if not self._stop.is_set():
            self._q.put(block)

    def _run(self):
        import queue
        try:
            rec = live_recognizer()
            stream = rec.create_stream()
        except Exception:
            log.exception("live words didn't start")
            return
        while not self._stop.is_set():
            try:
                block = self._q.get(timeout=0.2)
            except queue.Empty:
                continue
            stream.accept_waveform(RATE, block)
            while rec.is_ready(stream):
                rec.decode_stream(stream)
            text = rec.get_result(stream)
            text = (text if isinstance(text, str) else getattr(text, "text", "")).strip().lower()
            if rec.is_endpoint(stream):
                if text:
                    self._said.append(text)
                    del self._said[:-6]
                rec.reset(stream)
                text = ""
            self._now = text

    def words(self, n=16):
        return " ".join(" ".join(self._said + [self._now]).split()[-n:])

    def close(self):
        self._stop.set()
