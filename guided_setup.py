"""
Build D · the guided first-run setup (mockup R24, with R23's AI step and R28's live words).

The page walks six steps: Vault, Reading, Focus, Voice, AI and Ready. Most answers are ordinary settings that save
as they are picked (theme, font, the nudge, live words, the voice defaults, keep / long questions). What needs a
download (speech to text, a read-aloud voice, an AI model and its engine) is only listed until the Ready step: its list
of files, sources and sizes is the ask. Start writes those settings and runs the downloads in the background.

First run: the setup shows when config.json has no setup_done flag and the database is new (no notes, tasks or
sessions). An existing install is marked done the first time it's seen, so the setup is never forced on it.
Settings → Data has "Run the setup again".

This module holds what api.py's Build D block needs: the new-database check, the read-aloud voice downloads (sherpa-onnx
releases a model as a .tar.bz2, unpacked safely into read_aloud's download folder), and a small queue that runs the
voice downloads one after another (the voice engine has one download slot).
"""
import logging
import os
import shutil
import tarfile
import threading
import time
import urllib.request
import netssl  # QC 81: Windows' certificate store for the read-aloud voice downloads

import read_aloud
from errors import plain_error  # v0.1.1 (QC 90): failures in plain words, the detail in the log

log = logging.getLogger(__name__)


class SetupError(Exception):
    """A problem worth telling the user about, in their words."""


# ======================================================================
# First run
# ======================================================================

def db_is_new(db):
    """True when the database has no notes, tasks or sessions: a fresh install, not one that's been used."""
    for table in ("notes", "tasks", "sessions"):
        if db.query_one(f"SELECT 1 FROM {table} LIMIT 1"):
            return False
    return True


def free_on(folder):
    """(drive like "C:", free bytes) for the drive a folder is on (or would be, once made)."""
    p = os.path.abspath(folder)
    while not os.path.isdir(p) and os.path.dirname(p) != p:
        p = os.path.dirname(p)
    try:
        return (os.path.splitdrive(p)[0] or p), shutil.disk_usage(p).free
    except OSError:
        return (os.path.splitdrive(p)[0] or p), 0


# The settings the steps write, with the value a whole-setup Skip writes on a first run (config.DEFAULT_CONFIG's)
SETUP_KEYS = ("obsidian_vault_path", "theme", "font", "focus_nudge_minutes", "comfort_soundscape", "voice_mic",
              "voice_stt_model", "voice_live", "voice_after_keep", "voice_after_dest", "voice_after_ask",
              "read_engine", "read_voice_sherpa", "ai_keep", "ai_long")


# ======================================================================
# Read-aloud voices (sherpa-onnx releases; Phase 6C's read_aloud.py finds them once unpacked)
# ======================================================================

TTS_URL = "https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/{file}"
TTS_SOURCE = "github.com/k2-fsa/sherpa-onnx (tts-models release)"
# kind -> label, the archives (file, size in bytes as released, about), the folder each unpacks to, the voice it sets.
# Fix B (QC item 22): Piper's Amy and Alan voices are gone. Alan's data is "All Rights Reserved" and Amy's card names no
# licence, so a GPL-3.0 installer can't offer them (licence audit flag 1). Kokoro's weights are Apache-2.0.
TTS = {
    "kokoro": {"label": "Kokoro", "archives": [("kokoro-int8-en-v0_19.tar.bz2", 103_000_000, "kokoro-int8-en-v0_19")],
               "voice": "kokoro-int8-en-v0_19:1"},   # Bella (US)
}
CHUNK = 1 << 16


def tts_info(kind):
    """{id, label, files, bytes, size_mb, present, missing, source, folder} for a read-aloud voice kind."""
    spec = TTS[kind]
    have = {m["id"] for m in read_aloud.find_models()}
    missing = [a for a in spec["archives"] if a[2] not in have]
    total = sum(a[1] for a in spec["archives"])
    return {"id": kind, "label": spec["label"], "files": [a[0] for a in spec["archives"]], "bytes": total,
            "size_mb": round(total / 1e6), "present": not missing, "missing": [a[0] for a in missing],
            "source": TTS_SOURCE, "folder": read_aloud.download_folder(), "voice": spec["voice"]}


def _safe_members(tar, folder):
    """The archive's members, checked: everything inside folder/, plain files and folders only."""
    out = []
    for m in tar.getmembers():
        name = m.name.replace("\\", "/")
        parts = [p for p in name.split("/") if p not in ("", ".")]
        if not parts or name.startswith("/") or ":" in name or ".." in parts or parts[0] != folder:
            raise SetupError(f"{os.path.basename(tar.name)} holds a file outside {folder}/ ({m.name}).")
        if not (m.isfile() or m.isdir()):
            raise SetupError(f"{os.path.basename(tar.name)} holds a link ({m.name}): not unpacked.")
        out.append(m)
    return out


def unpack(archive, dest_root, folder):
    """Unpacks archive (.tar.bz2) into dest_root/folder: into a temporary folder first, renamed once it's whole."""
    tmp = os.path.join(dest_root, f".{folder}.unpacking")
    shutil.rmtree(tmp, ignore_errors=True)
    os.makedirs(tmp)
    try:
        with tarfile.open(archive, "r:*") as tar:
            members = _safe_members(tar, folder)
            try:
                tar.extractall(tmp, members=members, filter="data")
            except TypeError:   # Python without extraction filters: the members are checked above
                tar.extractall(tmp, members=members)
        final = os.path.join(dest_root, folder)
        if os.path.isdir(final):
            shutil.rmtree(final)
        os.replace(os.path.join(tmp, folder), final)
    except tarfile.TarError as e:
        raise SetupError(plain_error(e, f"unpack {os.path.basename(archive)}"))
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


def download_tts(kind, progress=None, cancel=None):
    """Fetches and unpacks the voice kind's archives into read_aloud's download folder. progress(done, total)."""
    spec = TTS.get(kind)
    if not spec:
        raise SetupError(f"Unknown read-aloud voice {kind}.")
    root = read_aloud.download_folder()
    os.makedirs(root, exist_ok=True)
    have = {m["id"] for m in read_aloud.find_models()}
    sizes = {f: size for f, size, _ in spec["archives"]}
    done = 0
    for fname, _, folder in spec["archives"]:
        if folder in have:
            done += sizes[fname]
            continue
        part = os.path.join(root, fname + ".part")
        req = urllib.request.Request(TTS_URL.format(file=fname), headers={"User-Agent": "NeuroVault"})
        start = done
        try:
            with netssl.urlopen(req, timeout=30) as r, open(part, "wb") as f:
                length = int(r.headers.get("Content-Length") or 0)
                if length:
                    sizes[fname] = length   # the release's real size replaces the estimate
                while True:
                    if cancel is not None and cancel.is_set():
                        raise SetupError("Download cancelled.")
                    chunk = r.read(CHUNK)
                    if not chunk:
                        break
                    f.write(chunk)
                    done += len(chunk)
                    if progress:
                        progress(done, sum(sizes.values()))
            if length and os.path.getsize(part) != length:
                raise SetupError(f"{fname} arrived incomplete. Try again.")
            unpack(part, root, folder)
        except OSError as e:
            raise SetupError(plain_error(e, f"download {fname}"))
        finally:
            if os.path.exists(part):
                os.remove(part)
        done = start + sizes[fname]
    if progress:
        progress(sum(sizes.values()), sum(sizes.values()))


# ======================================================================
# The download queue: one after another, in the background
# ======================================================================

class Queue:
    """Runs the setup's downloads one after another in a thread. Each job is {key, label, bytes, run}, where
    run(progress, cancel) blocks until its download is done (or raises). status() is what the page polls."""

    def __init__(self):
        self.items, self._jobs = [], {}
        self._cancel = threading.Event()
        self._thread = None
        self._lock = threading.Lock()

    def busy(self):
        return bool(self._thread and self._thread.is_alive())

    def start(self, jobs):
        if self.busy():
            raise SetupError("The setup's downloads are already running.")
        self._cancel.clear()
        with self._lock:
            self.items = [{"key": j["key"], "label": j["label"], "state": "queued", "done": 0, "total": j.get("bytes") or 0,
                           "message": ""} for j in jobs]
            self._jobs = {j["key"]: j for j in jobs}
        self._thread = threading.Thread(target=self._run, daemon=True)
        self._thread.start()

    def _run(self):
        for it in self.items:
            if self._cancel.is_set():
                it.update(state="cancelled")
                continue
            it["state"] = "downloading"

            def progress(done, total, it=it):
                it["done"], it["total"] = done, total or it["total"]
            try:
                self._jobs[it["key"]]["run"](progress, self._cancel)
                it.update(state="done", done=it["total"] or it["done"])
            except Exception as e:   # one file failing doesn't stop the others
                cancelled = self._cancel.is_set()
                if not cancelled:
                    log.warning("setup download %s failed: %s", it["key"], e)
                it.update(state="cancelled" if cancelled else "error", message="" if cancelled else plain_error(e))

    def cancel(self):
        self._cancel.set()

    def status(self):
        with self._lock:
            return [dict(it) for it in self.items]

    def wait(self, timeout=None):
        if self._thread:
            self._thread.join(timeout)


def wait_voice(session, cancel, progress, start):
    """Runs one of the voice session's downloads (start()) and waits for it, passing its progress on."""
    start()
    time.sleep(0.05)
    while session.dl.get("stage") == "downloading":
        if cancel.is_set():
            session.cancel_download()
        progress(session.dl.get("done", 0), session.dl.get("total", 0))
        time.sleep(0.2)
    if session.dl.get("stage") == "error":
        raise SetupError(session.dl.get("message") or "The download failed.")
    progress(session.dl.get("total", 0), session.dl.get("total", 0))
