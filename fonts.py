"""
fonts.py: reading fonts beyond the built-in four (Build E, mockup R29–R32).

Settings → Reading & comfort → More fonts lists the fonts in font_list.json (in the repo, like ai_models.json): free,
openly licensed reading fonts, each pointing at its official release with every file's size and sha256, so a broken
or changed download is caught. "Add your own font…" copies a .ttf, .otf or .woff2 file in after checking its first
bytes and its table directory, so a renamed text file or a damaged font gives a plain message instead.

Each added font is a folder <fonts>/<id>/ holding its files and a font.json. The fonts folder is .neurovault/fonts
in the vault; until the vault on disk exists it sits next to the database (as attachments/ does, Build A), and moves
with the vault later. NEUROVAULT_FONTS overrides it, and NEUROVAULT_FONT_LIST the font list (dev and tests). The page loads a font through font_data() (base64), as
read_custom_sound() does for the alert sound, because it is served over http and can't open file:/// paths.
"""
import base64
import datetime
import json
import logging
import os
import re
import shutil
import socket
import struct
import threading
import time
import urllib.parse
import zlib
import errors
from errors import plain_error  # v0.1.1 (QC 90): failures in plain words, the detail in the log

import local_ai  # Build B's Download: HTTP ranges, cancel, retries, size and sha256 checks

log = logging.getLogger(__name__)

LIST_PATH = os.environ.get("NEUROVAULT_FONT_LIST") or os.path.join(os.path.dirname(os.path.abspath(__file__)), "font_list.json")   # the env: dev and tests
FONT_ID = re.compile(r"^[a-z0-9][a-z0-9-]{0,63}$")
EXTS = (".ttf", ".otf", ".woff2")
FORMATS = {"ttf": "truetype", "otf": "opentype", "woff": "woff", "woff2": "woff2"}
MAX_BYTES = 20 * 1024 * 1024   # a reading font is well under 2 MB; this only stops a wrong pick (a video renamed .ttf)
PROBE_SECONDS = 30             # how long "online" / "offline" is trusted before it's checked again


class FontError(Exception):
    """A message to show as it is."""


def fonts_dir(base):
    """<base>/.neurovault/fonts; base is the folder that holds the database (the vault, later)."""
    return os.environ.get("NEUROVAULT_FONTS") or os.path.join(base, ".neurovault", "fonts")


# ======================================================================
# The font list
# ======================================================================

def _ok_file(f):
    name = f.get("file", "")
    return (isinstance(name, str) and name == os.path.basename(name) and os.path.splitext(name)[1].lower() in EXTS
            and isinstance(f.get("bytes"), int) and 0 < f["bytes"] <= MAX_BYTES
            and re.fullmatch(r"[0-9a-f]{64}", str(f.get("sha256", ""))) is not None
            and urllib.parse.urlparse(str(f.get("url", ""))).scheme in ("https", "http")
            and re.fullmatch(r"\d{3}( \d{3})?", str(f.get("weight", "400"))) is not None
            and f.get("style", "normal") in ("normal", "italic"))


def load_list(path=None):
    """{updated, fonts: [...]} with only the entries that are complete; a bad entry is logged and left out."""
    path = path or LIST_PATH
    try:
        with open(path, encoding="utf-8") as fh:
            raw = json.load(fh)
    except (OSError, ValueError) as e:
        log.warning("font list not read (%s)", e)
        return {"updated": "", "fonts": []}
    fonts, seen = [], set()
    for x in raw.get("fonts", []):
        files = x.get("files") or []
        if not (FONT_ID.match(str(x.get("id", ""))) and x.get("name") and files and all(_ok_file(f) for f in files)) or x["id"] in seen:
            log.warning("font list: entry %r left out", x.get("id"))
            continue
        seen.add(x["id"])
        fonts.append(x)
    return {"updated": raw.get("updated", ""), "fonts": fonts}


# ======================================================================
# Is it really a font? The first bytes, then the table directory
# ======================================================================

def sniff(data):
    """'ttf' | 'otf' | 'woff' | 'woff2' when data is a whole, sane font file, else None. Collections (.ttc) aren't taken."""
    if len(data) < 12:
        return None
    tag = data[:4]
    if tag in (b"\x00\x01\x00\x00", b"true", b"OTTO"):
        n = struct.unpack(">H", data[4:6])[0]
        if not 1 <= n <= 128 or len(data) < 12 + 16 * n:
            return None
        tables = {}
        for i in range(n):
            t, _, off, ln = struct.unpack(">4sIII", data[12 + 16 * i:28 + 16 * i])
            if off + ln > len(data):
                return None
            tables[t] = (off, ln)
        if b"cmap" not in tables or not ({b"glyf", b"CFF ", b"CFF2"} & set(tables)):
            return None
        return "otf" if tag == b"OTTO" else "ttf"
    if tag in (b"wOFF", b"wOF2"):
        length, n = struct.unpack(">IH", data[8:14])
        if length != len(data) or n == 0 or len(data) < (48 if tag == b"wOF2" else 44):
            return None
        return "woff2" if tag == b"wOF2" else "woff"
    return None


def _sfnt_tables(data):
    """{tag: bytes} for a TrueType / OpenType file, or a WOFF one (tables inflated). WOFF2 needs Brotli: {}."""
    tag = data[:4]
    out = {}
    try:
        if tag in (b"\x00\x01\x00\x00", b"true", b"OTTO"):
            for i in range(struct.unpack(">H", data[4:6])[0]):
                t, _, off, ln = struct.unpack(">4sIII", data[12 + 16 * i:28 + 16 * i])
                out[t] = data[off:off + ln]
        elif tag == b"wOFF":
            for i in range(struct.unpack(">H", data[12:14])[0]):
                t, off, clen, olen, _ = struct.unpack(">4sIIII", data[44 + 20 * i:64 + 20 * i])
                raw = data[off:off + clen]
                out[t] = zlib.decompress(raw) if clen < olen else raw
    except (struct.error, zlib.error):
        return {}
    return out


def font_facts(data):
    """(family name or None, weight, style) read from the font's name and OS/2 tables."""
    t = _sfnt_tables(data)
    name, weight, style = None, 400, "normal"
    nm = t.get(b"name")
    if nm and len(nm) >= 6:
        try:
            count, start = struct.unpack(">HH", nm[2:6])
            found = {}
            for i in range(count):
                pid, eid, lang, nid, ln, off = struct.unpack(">HHHHHH", nm[6 + 12 * i:18 + 12 * i])
                if nid not in (1, 16) or nid in found and pid != 3:
                    continue
                raw = nm[start + off:start + off + ln]
                text = raw.decode("utf-16-be", "ignore") if pid in (0, 3) else raw.decode("latin-1")
                if text.strip():
                    found[nid] = text.strip()
            name = found.get(16) or found.get(1)
        except struct.error:
            pass
    os2 = t.get(b"OS/2")
    if os2 and len(os2) >= 64:
        w = struct.unpack(">H", os2[4:6])[0]
        if 100 <= w <= 900:
            weight = w
        if struct.unpack(">H", os2[62:64])[0] & 1:
            style = "italic"
    return name, weight, style


def check_font_file(path):
    """(kind, data) for a font file someone picked; FontError with a plain message otherwise."""
    shown = os.path.basename(path)
    if os.path.splitext(path)[1].lower() not in EXTS:
        raise FontError(f"{shown} couldn't be added: pick a .ttf, .otf or .woff2 file.")
    try:
        size = os.path.getsize(path)
        if size > MAX_BYTES:
            raise FontError(f"{shown} couldn't be added: it's {size / 2 ** 20:.0f} MB, too big for a font file.")
        with open(path, "rb") as fh:
            data = fh.read()
    except OSError:
        raise FontError(f"{shown} couldn't be read. Is it still there?")
    kind = sniff(data)
    if not kind:
        raise FontError(f"{shown} couldn't be added: it isn't a font file, or it's damaged.")
    return kind, data


# ======================================================================
# The fonts on this PC (or in the vault) and the downloads
# ======================================================================

def _slug(text):
    return re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")[:40] or "font"


def _stack(fam, fallback):
    return f"'{fam}', {fallback}" if fallback else f"'{fam}', system-ui, sans-serif"


class _Job:
    """One font's download: its files one after another into a staging folder, then moved in whole."""

    def __init__(self, owner, entry):
        self.owner, self.entry = owner, entry
        self.total = sum(f["bytes"] for f in entry["files"])
        self.state, self.message, self.done_files = "downloading", "", 0
        self.current = None
        self._cancel = threading.Event()
        self.thread = threading.Thread(target=self._run, name="nv-font-" + entry["id"], daemon=True)

    def info(self):
        cur = self.current.done if self.current and self.state == "downloading" else 0
        done = self.total if self.state == "done" else min(self.total, self.done_files + cur)
        return {"state": self.state, "done": done, "total": self.total, "message": self.message}

    def cancel(self):
        self._cancel.set()
        if self.current:
            self.current.cancel()   # deletes its .part file
        self.thread.join(timeout=10)
        shutil.rmtree(self.owner.staging(self.entry["id"]), ignore_errors=True)
        self.state, self.message = "cancelled", "Download cancelled: the part file is deleted."

    def _run(self):
        fid, stage = self.entry["id"], self.owner.staging(self.entry["id"])
        try:
            os.makedirs(stage, exist_ok=True)
            for f in self.entry["files"]:
                if self._cancel.is_set():
                    return
                d = local_ai.Download(f"{fid}:{f['file']}", self.entry["name"], f["url"], os.path.join(stage, f["file"]), f["bytes"], f["sha256"])
                self.current = d
                d.start()
                d.wait()
                if self._cancel.is_set():
                    return
                if d.state != "done":
                    self.state = "error"
                    self.message = re.sub(r" ?Resume to (carry on|fetch the rest)\.", " Try again.", d.message or "The download stopped. Try again.")
                    if any(x in self.message for x in (errors.OFFLINE, errors.REFUSED, errors.SLOW, "getaddrinfo", "timed out")) or "refused" in self.message.lower():   # QC 90: the plain sentences
                        self.owner.mark_offline()
                        self.message = "The download stopped: you seem to be offline. Try again when you're back online."
                    shutil.rmtree(stage, ignore_errors=True)
                    return
                self.done_files += f["bytes"]
            self.state = "checking"
            for f in self.entry["files"]:
                with open(os.path.join(stage, f["file"]), "rb") as fh:
                    if not sniff(fh.read()):
                        raise FontError(f"{f['file']} arrived, but it isn't a font file. Try again later.")
            self.owner.install_staged(self.entry)
            self.state = "done"
        except FontError as e:
            self.state, self.message = "error", plain_error(e, "download the font")
            shutil.rmtree(stage, ignore_errors=True)
        except Exception as e:   # noqa: BLE001 - a thread: say so on the page instead of dying quietly
            log.exception("font download %s failed", fid)
            self.state, self.message = "error", plain_error(e, "download the font")
            shutil.rmtree(stage, ignore_errors=True)


class Fonts:
    """The fonts folder, the font list and its downloads. cfg / save are the app's config and its saver."""

    def __init__(self, base, cfg, save, list_path=None):
        self.base, self.cfg, self.save, self.list_path = base, cfg, save, list_path
        self.jobs = {}
        self._lock = threading.Lock()
        self._probe = (0.0, None)   # (when, online?)
        self._probing = False

    # ---- where things are ----
    @property
    def folder(self):
        return fonts_dir(self.base() if callable(self.base) else self.base)

    def staging(self, fid):
        return os.path.join(self.folder, ".downloading", fid)

    def catalog(self):
        return load_list(self.list_path)["fonts"]

    def entry(self, fid):
        return next((x for x in self.catalog() if x["id"] == fid), None)

    # ---- online or not: one quick connection to the list's download host, trusted for 30 seconds ----
    def _host(self):
        for x in self.catalog():
            u = urllib.parse.urlparse(x["files"][0]["url"])
            return u.hostname, u.port or (443 if u.scheme == "https" else 80)
        return None, None

    def probe(self, wait=True):
        """True online, False offline, None not known yet. wait=False starts a check and answers from the last one."""
        when, ok = self._probe
        if time.time() - when < PROBE_SECONDS and ok is not None:
            return ok
        if not wait:
            if not self._probing:
                self._probing = True
                threading.Thread(target=self.probe, daemon=True).start()
            return ok
        host, port = self._host()
        try:
            if not host:
                ok = False
            else:
                socket.create_connection((host, port), timeout=3).close()
                ok = True
        except OSError:
            ok = False
        self._probe, self._probing = (time.time(), ok), False
        return ok

    def mark_offline(self):
        self._probe = (time.time(), False)

    # ---- what's here ----
    def installed(self):
        """{id: font.json} for every whole font in the folder (files present, ids sane)."""
        out = {}
        try:
            names = os.listdir(self.folder)
        except OSError:
            return out
        for fid in names:
            p = os.path.join(self.folder, fid, "font.json")
            if not FONT_ID.match(fid) or not os.path.isfile(p):
                continue
            try:
                with open(p, encoding="utf-8") as fh:
                    meta = json.load(fh)
            except (OSError, ValueError):
                continue
            files = meta.get("files") or []
            if meta.get("id") != fid or not files or not all(
                    isinstance(f.get("file"), str) and f["file"] == os.path.basename(f["file"])
                    and os.path.isfile(os.path.join(self.folder, fid, f["file"])) for f in files):
                continue
            out[fid] = meta
        return out

    def _row(self, x, have, jobs):
        meta, job = have.get(x["id"]), jobs.get(x["id"])
        size = sum(f["bytes"] for f in x["files"])
        return {"id": x["id"], "name": x["name"], "by": x.get("by", ""), "why": x.get("why", ""), "licence": x.get("licence", ""),
                "licence_url": x.get("licence_url", ""), "page": x.get("page", ""), "source": x.get("source", ""),
                "bytes": size, "mb": round(size / 1e6, 1), "ls": x.get("ls", ""), "preview": x.get("preview", ""),
                "family": "nvf-" + x["id"], "stack": _stack("nvf-" + x["id"], x.get("fallback", "")),
                "installed": bool(meta), "download": job.info() if job and job.state != "done" else None}

    def status(self):
        have = self.installed()
        with self._lock:
            jobs = dict(self.jobs)
        cat = self.catalog()
        own = []
        for fid, m in sorted(have.items(), key=lambda kv: kv[1].get("added", "")):
            if not m.get("own"):
                continue
            size = sum(f.get("bytes", 0) for f in m["files"])
            own.append({"id": fid, "name": m.get("name", fid), "file": m.get("original", m["files"][0]["file"]), "bytes": size,
                        "mb": round(size / 1e6, 1), "family": m.get("family", "nvf-" + fid), "stack": _stack(m.get("family", "nvf-" + fid), ""),
                        "own": True, "installed": True, "download": None})
        used = 0
        for fid, m in have.items():
            used += sum(f.get("bytes", 0) for f in m["files"])
        use = self.cfg.get("font_use", "")
        return {"status": "success", "fonts": [self._row(x, have, jobs) for x in cat], "own": own,
                "use": use if use in have else "", "offline": self.probe(wait=False) is False,
                "folder": self.folder, "used_bytes": used, "used_mb": round(used / 1e6, 1)}

    # ---- downloads ----
    def download(self, fid):
        x = self.entry(fid)
        if not x:
            raise FontError("That font isn't in NeuroVault's font list.")
        if fid in self.installed():
            return {"status": "success", "already": True}
        with self._lock:
            job = self.jobs.get(fid)
            if job and job.state in ("downloading", "checking"):
                return {"status": "success"}
        if self.probe() is False:
            raise FontError("You're offline: downloads wait until you're back online.")
        job = _Job(self, x)
        with self._lock:
            self.jobs[fid] = job
        job.thread.start()
        return {"status": "success"}

    def cancel(self, fid):
        with self._lock:
            job = self.jobs.pop(fid, None)
        if job:
            job.cancel()
        return {"status": "success"}

    def wait(self, fid, timeout=30):
        job = self.jobs.get(fid)
        if job:
            job.thread.join(timeout)
        return job.info() if job else None

    def install_staged(self, x):
        dest = os.path.join(self.folder, x["id"])
        stage = self.staging(x["id"])
        meta = {"id": x["id"], "name": x["name"], "family": "nvf-" + x["id"], "own": False, "by": x.get("by", ""),
                "licence": x.get("licence", ""), "source": x.get("source", ""), "added": datetime.datetime.now().isoformat(timespec="seconds"),
                "files": [{"file": f["file"], "weight": str(f.get("weight", "400")), "style": f.get("style", "normal"), "bytes": f["bytes"]} for f in x["files"]]}
        with open(os.path.join(stage, "font.json"), "w", encoding="utf-8") as fh:
            json.dump(meta, fh, indent=2)
        shutil.rmtree(dest, ignore_errors=True)
        os.replace(stage, dest)

    # ---- your own file ----
    def add_file(self, path):
        kind, data = check_font_file(path)
        name, weight, style = font_facts(data)
        stem = os.path.splitext(os.path.basename(path))[0]
        name = (name or stem.replace("_", " ").replace("-", " ")).strip()[:60]
        have = self.installed()
        fid = "own-" + _slug(name)
        n = 2
        while fid in have or fid in self.jobs:
            fid = f"own-{_slug(name)[:36]}-{n}"
            n += 1
        dest = os.path.join(self.folder, fid)
        file = "font" + os.path.splitext(path)[1].lower()
        os.makedirs(dest, exist_ok=True)
        with open(os.path.join(dest, file), "wb") as fh:
            fh.write(data)
        meta = {"id": fid, "name": name, "family": "nvf-" + fid, "own": True, "original": os.path.basename(path), "kind": kind,
                "added": datetime.datetime.now().isoformat(timespec="seconds"),
                "files": [{"file": file, "weight": str(weight), "style": style, "bytes": len(data)}]}
        with open(os.path.join(dest, "font.json"), "w", encoding="utf-8") as fh:
            json.dump(meta, fh, indent=2)
        return {"id": fid, "name": name, "file": meta["original"], "bytes": len(data), "mb": round(len(data) / 1e6, 1),
                "family": meta["family"], "stack": _stack(meta["family"], ""), "own": True}

    # ---- use, remove, read ----
    def use(self, fid):
        fid = fid or ""
        if fid and fid not in self.installed():
            raise FontError("That font isn't on this PC any more. Download or add it again.")
        self.save({"font_use": fid})
        return {"status": "success", "use": fid}

    def remove(self, fid):
        if not FONT_ID.match(str(fid or "")):
            raise FontError("No such font.")
        have = self.installed()
        if fid not in have:
            raise FontError("That font is already gone.")
        freed = sum(f.get("bytes", 0) for f in have[fid]["files"])
        shutil.rmtree(os.path.join(self.folder, fid))
        with self._lock:
            self.jobs.pop(fid, None)
        was = self.cfg.get("font_use") == fid
        if was:
            self.save({"font_use": ""})
        return {"status": "success", "freed_bytes": freed, "freed_mb": round(freed / 1e6, 1), "was_in_use": was}

    def data(self, fid):
        """{family, name, files: [{weight, style, format, data}]}, the font's files as base64 for the page's FontFace."""
        meta = self.installed().get(fid) if FONT_ID.match(str(fid or "")) else None
        if not meta:
            raise FontError("That font isn't on this PC any more.")
        files = []
        for f in meta["files"]:
            with open(os.path.join(self.folder, fid, f["file"]), "rb") as fh:
                raw = fh.read()
            files.append({"weight": f.get("weight", "400"), "style": f.get("style", "normal"), "format": FORMATS.get(sniff(raw) or "", ""),
                          "data": base64.b64encode(raw).decode("ascii")})
        return {"status": "success", "id": fid, "name": meta.get("name", fid), "family": meta.get("family", "nvf-" + fid), "files": files}

    def shutdown(self):
        for fid in list(self.jobs):
            job = self.jobs.get(fid)
            if job and job.state in ("downloading", "checking"):
                self.cancel(fid)
