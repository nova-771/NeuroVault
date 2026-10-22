"""
attachments.py: files that notes and the brain dump embed (Build A, mockup R21–R28).

Files live in an attachments/ folder in the app's data folder (next to the database) and are named as Obsidian
expects: a note embeds one with "![[attachments/voice-20261016-154200.ogg]]" on a line of its own. The
vault-on-disk build moves the folder into the vault; nothing here assumes where that folder is.

    folder(base)              the attachments/ folder under base (made on demand)
    resolve(base, file)       "attachments/x.ogg" → its full path, refusing anything outside the folder
    list_files(base)          every file with its kind (audio, image, pdf, other), size, date and, for audio, length
    uses(file, notes, inbox)  which notes embed a file, and whether a brain-dump thought carries it
    unique_name(base, stem)   a free "attachments/<stem>.<ext>" name
    recycle(path)             moves a file to the recycle bin (platform_layer.recycle; Windows: SHFileOperationW + FOF_ALLOWUNDO)
    data_url(base, file)      the file as a data: URL, for the page's players
"""
import base64
import logging
import mimetypes
import os
import re
from datetime import datetime

log = logging.getLogger(__name__)

DIR = "attachments"
KINDS = {
    "audio": {".ogg", ".opus", ".oga", ".wav", ".mp3", ".m4a", ".webm", ".flac", ".aac"},
    "image": {".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".svg", ".avif"},
    "pdf": {".pdf"},
}
MIME = {".ogg": "audio/ogg", ".opus": "audio/ogg", ".oga": "audio/ogg", ".wav": "audio/wav", ".webm": "audio/webm",
        ".m4a": "audio/mp4", ".mp3": "audio/mpeg", ".flac": "audio/flac", ".svg": "image/svg+xml"}
MAX_DATA_BYTES = 64 * 1024 * 1024  # a data: URL for anything bigger would choke the bridge
EMBED_RE = re.compile(r"!\[\[(attachments/[^\[\]\n|#]+?)(?:[|#][^\[\]\n]*)?\]\]")


class AttachmentError(Exception):
    """A problem worth telling the user about, in their words."""


def kind_of(name):
    ext = os.path.splitext(name)[1].lower()
    return next((k for k, exts in KINDS.items() if ext in exts), "other")


def folder(base, create=False):
    path = os.path.join(base, DIR)
    if create:
        os.makedirs(path, exist_ok=True)
    return path


def resolve(base, file):
    """The full path of "attachments/<name>", or AttachmentError for anything that isn't a plain file name in there."""
    rel = str(file or "").replace("\\", "/")
    if rel.startswith(DIR + "/"):
        rel = rel[len(DIR) + 1:]
    if not rel or "/" in rel or rel in (".", "..") or re.search(r'[<>:"|?*\x00-\x1f]', rel):
        raise AttachmentError("That isn't a file in attachments/.")
    return os.path.join(folder(base), rel)


def audio_seconds(path):
    """The length of an audio file in seconds (soundfile reads .ogg, .wav and .flac; the wave module .wav), or None."""
    try:
        import soundfile
        info = soundfile.info(path)
        return round(info.frames / info.samplerate, 2) if info.samplerate else None
    except Exception:
        pass
    if path.lower().endswith(".wav"):
        try:
            import wave
            with wave.open(path, "rb") as w:
                return round(w.getnframes() / w.getframerate(), 2)
        except Exception:
            return None
    return None


def info(base, name):
    path = os.path.join(folder(base), name)
    st = os.stat(path)
    out = {"file": f"{DIR}/{name}", "name": name, "kind": kind_of(name), "size": st.st_size,
           "mtime": datetime.fromtimestamp(st.st_mtime).isoformat(timespec="seconds")}
    if out["kind"] == "audio":
        out["seconds"] = audio_seconds(path)
    return out


def list_files(base):
    """Every file in attachments/, newest first (sub-folders and .part files are left out)."""
    root = folder(base)
    if not os.path.isdir(root):
        return []
    out = []
    for name in os.listdir(root):
        if name.endswith(".part") or not os.path.isfile(os.path.join(root, name)):
            continue
        try:
            out.append(info(base, name))
        except OSError:
            log.exception("reading %s", name)
    return sorted(out, key=lambda a: (a["mtime"], a["name"]), reverse=True)


def embeds(text):
    """The attachments/… files a note's Markdown embeds, in order, each once."""
    seen = []
    for m in EMBED_RE.finditer(text or ""):
        if m.group(1) not in seen:
            seen.append(m.group(1))
    return seen


def uses(file, notes, inbox):
    """[{kind: note, id, title} | {kind: inbox, id}]: where file is used. notes and inbox are rows (id, title, content /
    id, audio)."""
    out = [{"kind": "note", "id": n["id"], "title": n["title"]} for n in notes if file in embeds(n["content"])]
    out += [{"kind": "inbox", "id": i["id"]} for i in inbox if i["audio"] == file]
    return out


def remove_embed(text, file):
    """The note's Markdown without the lines that are only "![[file]]" (and one of the blank lines around each). Build K:
    also "<!-- ![[file]] -->", the hidden line that links a converted table's CSV to its note."""
    lines, out = (text or "").split("\n"), []
    for i, line in enumerate(lines):
        if line.strip() in (f"![[{file}]]", f"<!-- ![[{file}]] -->"):
            if out and not out[-1].strip() and i + 1 < len(lines) and not lines[i + 1].strip():
                out.pop()
            continue
        out.append(line)
    return "\n".join(out)


def relink(text, old, new):
    """The note's Markdown with every link to old ("![[old]]", "![[old|…]]", "![[old#…]]", the hidden CSV line) pointing
    at new (Fix A, QC 4 · 35: Rename… and Find the file…)."""
    return EMBED_RE.sub(lambda m: m.group(0).replace(m.group(1), new, 1) if m.group(1) == old else m.group(0), text or "")


RESERVED = {"con", "prn", "aux", "nul", *(f"com{i}" for i in range(1, 10)), *(f"lpt{i}" for i in range(1, 10))}


def clean_name(name, ext):
    """A new file name for Rename…: the name typed (its extension, if typed, is the file's own), checked for Windows; the
    file keeps ext. AttachmentError says what's wrong, in plain words."""
    stem = " ".join(str(name or "").split())
    if stem.lower().endswith(ext.lower()):
        stem = stem[:-len(ext)].rstrip()
    if not stem:
        raise AttachmentError("Type a name for the file.")
    bad = sorted(set(re.findall(r'[<>:"/\\|?*\x00-\x1f\[\]#^]', stem)))
    if bad:
        raise AttachmentError("A file name can't have " + " ".join(c if c.isprintable() else "control characters" for c in bad) + " in it.")
    if stem.endswith(".") or stem.startswith("."):
        raise AttachmentError("A file name can't start or end with a full stop.")
    if stem.split(".")[0].lower() in RESERVED:
        raise AttachmentError(f"Windows keeps the name {stem.split('.')[0]} for itself: pick another.")
    if len(stem + ext) > 120:
        raise AttachmentError("That name is too long (120 characters at most).")
    return stem + ext


def unique_name(base, stem, ext):
    """A free attachments/ name: <stem><ext>, else <stem>-2<ext>, …"""
    root = folder(base)
    name, k = stem + ext, 2
    while os.path.exists(os.path.join(root, name)):
        name, k = f"{stem}-{k}{ext}", k + 1
    return name


def data_url(base, file):
    path = resolve(base, file)
    if not os.path.isfile(path):
        raise AttachmentError(f"{file} isn't there any more.")
    if os.path.getsize(path) > MAX_DATA_BYTES:
        raise AttachmentError(f"{file} is too big to play here. Open it instead.")
    ext = os.path.splitext(path)[1].lower()
    mime = MIME.get(ext) or mimetypes.guess_type(path)[0] or "application/octet-stream"
    with open(path, "rb") as f:
        return f"data:{mime};base64," + base64.b64encode(f.read()).decode("ascii")


# ---- The recycle bin: platform_layer.recycle (Windows: SHFileOperationW with FOF_ALLOWUNDO, so the file can be restored) ----

def recycle(path):
    """Move a file to the recycle bin. Raises AttachmentError if the system says no (or has no bin NeuroVault can use)."""
    path = os.path.abspath(path)
    if not os.path.exists(path):
        raise AttachmentError(f"{os.path.basename(path)} isn't there any more.")
    import platform_layer
    try:
        platform_layer.recycle(path)
    except platform_layer.RecycleError as e:
        raise AttachmentError(str(e))
