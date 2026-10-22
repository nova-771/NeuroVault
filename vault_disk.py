"""
Build V · the vault on disk: notes as plain .md files in a folder you choose.

This module only touches files; api.py's Build V block keeps the database index in step with it. A note is
<vault>/<project>/<folder>/…/<Title>.md, or <vault>/<Title>.md for a note in "Unsorted". The file holds the note's
text; an optional YAML front matter block at the top is kept exactly as it was, except its tags, which NeuroVault
writes (that is where Obsidian reads them).

What NeuroVault never reads as notes: dot-folders (.obsidian, .trash, .git, .neurovault), and at the vault's top
attachments/, stickynoted/ (Sticky Notes) and _inbox.md (Brain Dump).

A file is only ever written when its note is saved with a change: reading a vault (an Obsidian one too) leaves every
byte as it was. Writes go to a temporary file first, then replace the old one, so a crash never leaves half a note.
Deleting sends the file to the Windows Recycle Bin (attachments.recycle); off Windows it goes to
<vault>/.neurovault/bin/ instead. Nothing here deletes a file outright.
"""
import json  # QC 86: the vault marker
import logging
import os
import re
import shutil
from datetime import datetime

log = logging.getLogger(__name__)

NOTE_EXT = ".md"
SKIP_TOP = {"attachments", "stickynoted"}       # NeuroVault's own folders at the vault's top
SKIP_TOP_FILES = {"_inbox.md"}                   # Brain Dump
STICKY_DIR = "stickynoted"
INBOX_FILE = "_inbox.md"
BAD_CHARS = set('\\/:*?"<>|')
RESERVED = {"con", "prn", "aux", "nul", *(f"com{i}" for i in range(1, 10)), *(f"lpt{i}" for i in range(1, 10))}
MAX_NAME = 120
_FM_RE = re.compile(r"\A(---[ \t]*\r?\n)(.*?\r?\n)?((?:---|\.\.\.)[ \t]*(?:\r?\n|\Z))", re.S)


class VaultError(Exception):
    pass


# ---- names ----

def safe_name(name, fallback="Untitled"):
    """A file or folder name Windows can hold: \\ / : * ? " < > | and control characters become "-", no trailing dots
    or spaces, not a reserved device name (CON, NUL…), at most MAX_NAME characters."""
    out = "".join("-" if (ch in BAD_CHARS or ord(ch) < 32) else ch for ch in str(name or ""))
    out = out.strip().rstrip(". ")[:MAX_NAME].rstrip(". ")
    if not out:
        out = fallback
    if out.split(".")[0].lower() in RESERVED:
        out += "-"
    return out


def free_path(folder, stem, ext=NOTE_EXT, taken=None):
    """<folder>/<stem><ext>, or "<stem> 2", "<stem> 3"… when that name is taken on disk (any case) or in `taken`
    (lower-case full paths already promised to other notes)."""
    taken = taken or set()
    k, name = 1, stem
    while True:
        path = os.path.join(folder, name + ext)
        if not os.path.exists(path) and os.path.normcase(os.path.abspath(path)).lower() not in taken:
            return path
        k += 1
        name = f"{stem} {k}"


def rel(root, path):
    """The path inside the vault, with forward slashes ("Project/Folder/Note.md")."""
    return os.path.relpath(path, root).replace(os.sep, "/")


def full(root, relpath):
    return os.path.join(root, *relpath.split("/"))


def key(root):
    """How the index names a vault: its absolute path, in Windows' case-insensitive form."""
    return os.path.normcase(os.path.abspath(root)) if root else None


def documents_dir():
    """The user's Documents folder (Windows' own answer, so a Documents moved to OneDrive or another drive is found)."""
    if os.environ.get("NEUROVAULT_DOCUMENTS"):   # dev and checks: a stand-in, so nothing is made in the real Documents
        return os.environ["NEUROVAULT_DOCUMENTS"]
    import platform_layer   # Windows: SHGetFolderPathW; Linux: user-dirs.dirs; else ~/Documents
    return platform_layer.documents_dir()


def default_vault(name="NeuroVault"):
    return os.path.join(documents_dir(), safe_name(name, "NeuroVault"))


# ---- reading the folder ----

def skipped_dir(parts):
    """True for a folder NeuroVault doesn't read notes from (parts: the path inside the vault, split)."""
    return any(p.startswith(".") for p in parts) or (len(parts) >= 1 and parts[0].lower() in SKIP_TOP)


def scan(root):
    """Every note file and every folder in the vault: ({relpath: (mtime_ns, size)}, [folder relpaths]).
    Raises VaultError when the folder can't be read (a drive that isn't there): the index must not be emptied then."""
    if not root or not os.path.isdir(root):
        raise VaultError(f"The vault folder isn't there: {root}")
    files, dirs = {}, []
    for here, subdirs, names in os.walk(root, onerror=None):
        parts = [] if os.path.samefile(here, root) else rel(root, here).split("/")
        subdirs[:] = sorted(d for d in subdirs if not skipped_dir(parts + [d]))
        if parts:
            dirs.append("/".join(parts))
        for n in names:
            if not n.lower().endswith(NOTE_EXT) or n.startswith("."):
                continue
            if not parts and n.lower() in SKIP_TOP_FILES:
                continue
            path = os.path.join(here, n)
            try:
                st = os.stat(path)
            except OSError:
                continue
            files["/".join(parts + [n])] = (st.st_mtime_ns, st.st_size)
    return files, dirs


def stat(path):
    st = os.stat(path)
    return st.st_mtime_ns, st.st_size


# ---- one note file ----

def split_front_matter(text):
    """(front matter block with its --- lines, or "", the text under it)."""
    m = _FM_RE.match(text)
    if not m:
        return "", text
    return m.group(0), text[m.end():]


def _fm_lines(fm):
    return fm.splitlines()[1:-1] if fm else []


def fm_tags(fm):
    """The tags a front matter block lists: "tags: [a, b]", "tags: a, b" or a "- a" list under "tags:" ("tag:" too)."""
    lines, out, i = _fm_lines(fm), [], 0
    while i < len(lines):
        m = re.match(r"^(tags?)\s*:\s*(.*)$", lines[i])
        if m:
            rest = m.group(2).strip()
            if rest:
                out += [t for t in re.split(r"[,\s]+", rest.strip("[]")) if t]
            else:
                j = i + 1
                while j < len(lines) and re.match(r"^\s*-\s*", lines[j]):
                    out.append(re.sub(r"^\s*-\s*", "", lines[j]).strip())
                    j += 1
                i = j - 1
        i += 1
    return [t.strip("'\"").lstrip("#") for t in out if t.strip("'\"").lstrip("#")]


def fm_set_tags(fm, tags, newline="\n"):
    """The front matter with its tags set to `tags` (a "- tag" list), the rest of its lines exactly as they were.
    No tags and no other lines: no front matter at all."""
    lines, keep, i = _fm_lines(fm), [], 0
    while i < len(lines):
        if re.match(r"^tags?\s*:", lines[i]):
            j = i + 1
            if not lines[i].split(":", 1)[1].strip():
                while j < len(lines) and re.match(r"^\s*-\s*", lines[j]):
                    j += 1
            i = j
            continue
        keep.append(lines[i])
        i += 1
    if tags:
        keep += ["tags:"] + [f"  - {t}" for t in tags]
    if not keep:
        return ""
    if fm and fm_tags(fm) == list(tags) and sorted(_fm_lines(fm)) == sorted(keep):
        return fm   # nothing changed: keep the block byte for byte
    return newline.join(["---", *keep, "---"]) + newline


def read_note(path):
    """{body, fm, tags, newline, bom, encoding, mtime, size}: body is the text under the front matter, with \\n lines."""
    with open(path, "rb") as f:
        raw = f.read()
    bom = raw.startswith(b"\xef\xbb\xbf")
    try:
        text, enc = raw.decode("utf-8-sig"), "utf-8"
    except UnicodeDecodeError:
        text, enc = raw.decode("cp1252", errors="replace"), "cp1252"
    newline = "\r\n" if "\r\n" in text else "\n"
    fm, body = split_front_matter(text)
    st = os.stat(path)
    return {"body": body.replace("\r\n", "\n"), "fm": fm, "tags": fm_tags(fm), "newline": newline, "bom": bom,
            "encoding": enc, "mtime": st.st_mtime_ns, "size": st.st_size}


def note_bytes(body, fm="", newline="\n", bom=False, encoding="utf-8"):
    text = (fm or "") + (body or "").replace("\r\n", "\n")
    if newline == "\r\n":
        text = text.replace("\r\n", "\n").replace("\n", "\r\n")
    data = text.encode(encoding if encoding == "utf-8" else "cp1252", errors="replace" if encoding != "utf-8" else "strict")
    return (b"\xef\xbb\xbf" if bom else b"") + data


def write_bytes(path, data):
    """Writes the whole file at once: a temporary file beside it, then a replace."""
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = path + ".nv-part"
    with open(tmp, "wb") as f:
        f.write(data)
        f.flush()
        os.fsync(f.fileno())
    os.replace(tmp, path)
    return stat(path)


def write_note(path, body, fm="", newline="\n", bom=False, encoding="utf-8"):
    """Writes a note file; returns (mtime_ns, size)."""
    return write_bytes(path, note_bytes(body, fm, newline, bom, encoding))


def move(src, dest):
    """Renames or moves a file or folder inside the vault (the destination's folder is made if missing)."""
    if os.path.normcase(os.path.abspath(src)) == os.path.normcase(os.path.abspath(dest)):
        if src != dest:   # only the case of a letter changed
            os.replace(src, dest)
        return
    if os.path.exists(dest):
        raise VaultError(f"{os.path.basename(dest)} is already there.")
    os.makedirs(os.path.dirname(dest), exist_ok=True)
    shutil.move(src, dest)


def recycle(root, path):
    """Sends a file or folder to the Recycle Bin. Off Windows (or if Windows says no) it moves to
    <vault>/.neurovault/bin/<time> <name>, so nothing is ever deleted outright."""
    if not os.path.exists(path):
        return
    import attachments
    try:
        attachments.recycle(path)
        return
    except Exception as e:
        log.warning("Recycle Bin refused %s (%s): moving it to .neurovault/bin", path, e)
    bin_dir = os.path.join(root, ".neurovault", "bin")
    os.makedirs(bin_dir, exist_ok=True)
    shutil.move(path, os.path.join(bin_dir, f"{datetime.now():%Y%m%d-%H%M%S} {os.path.basename(path)}"))


def copy_tree_missing(src, dest):
    """Copies every file under src to dest that dest doesn't have yet (never overwrites). Returns the count."""
    n = 0
    if not os.path.isdir(src):
        return 0
    for here, _dirs, names in os.walk(src):
        to = os.path.join(dest, os.path.relpath(here, src))
        for name in names:
            if name.endswith((".part", ".nv-part")):
                continue
            if name == MARKER_FILE and os.path.basename(here) == MARKER_DIR:   # QC 86: a marker belongs to its own folder
                continue
            target = os.path.join(to, name)
            if not os.path.exists(target):
                os.makedirs(to, exist_ok=True)
                shutil.copy2(os.path.join(here, name), target)
                n += 1
    return n


# ==== QC 86 · whose vault is this: a marker file, and the guard for test bridges ====================================
# 2026-10-18: a test bridge's scratch config named the user's real vault (Documents\NeuroVault), and its one-time
# copy-out wrote 55 " 2" notes and ~30 attachments into it. So:
#   - every vault carries .neurovault/vault-id.json: {vault_id, created, installs: [{install, data, test, since}]}. An
#     install is its database (the install id kept in it) in its folder; a test install (a dev bridge, the checks) says
#     test: true. It sits in a dot-folder, which Obsidian and NeuroVault never read as notes: no note's bytes change;
#   - a folder already marked by another install, or holding NeuroVault data from before markers, is never taken
#     without asking ("Use it together / Pick another folder");
#   - dev bridges and tests refuse the user's real vault: Documents\NeuroVault, or a folder an app install marked.
MARKER_DIR, MARKER_FILE = ".neurovault", "vault-id.json"


def marker_path(root):
    return os.path.join(root, MARKER_DIR, MARKER_FILE)


def read_marker(root):
    """The folder's marker, or None when it has none. An unreadable one counts as someone else's ({installs: [], bad})."""
    path = marker_path(root)
    if not os.path.isfile(path):
        return None
    try:
        with open(path, "r", encoding="utf-8") as f:
            m = json.load(f)
        if isinstance(m, dict) and isinstance(m.get("installs"), list):
            return m
    except (OSError, ValueError):
        pass
    return {"vault_id": None, "installs": [], "bad": True}


def _same_dir(a, b):
    return bool(a and b) and os.path.normcase(os.path.abspath(a)) == os.path.normcase(os.path.abspath(b))


def same_install(entry, me):
    return isinstance(entry, dict) and entry.get("install") == me["install"] and _same_dir(entry.get("data"), me["data"])


def has_old_data(root):
    """NeuroVault data from before markers: a .neurovault folder with something in it, and no marker."""
    try:
        return any(e.name != MARKER_FILE for e in os.scandir(os.path.join(root, MARKER_DIR)))
    except OSError:
        return False


def clash(root, me, at_start=False):
    """None when the folder is free or already this install's; else {installs (the others), legacy, test_only}.
    at_start: the vault config.json already names, so data from before markers is this install's own."""
    m = read_marker(root)
    if m is None:
        return None if at_start or not has_old_data(root) else {"installs": [], "legacy": True, "test_only": False}
    if any(same_install(e, me) for e in m["installs"]):
        return None
    others = [e for e in m["installs"] if isinstance(e, dict)]
    return {"installs": others, "legacy": False, "bad": bool(m.get("bad")),
            "test_only": bool(others) and not m.get("bad") and all(e.get("test") for e in others)}


def write_marker(root, me):
    """Adds this install to the folder's marker (made if missing). Writes only when something changes."""
    import uuid
    m = read_marker(root)
    if m is None or m.get("bad"):
        m = {"vault_id": uuid.uuid4().hex, "created": datetime.now().isoformat(timespec="seconds"), "installs": []}
    elif any(same_install(e, me) for e in m["installs"]):
        return m
    m["installs"].append({**me, "since": datetime.now().isoformat(timespec="seconds")})
    write_bytes(marker_path(root), json.dumps(m, indent=2).encode("utf-8"))
    return m


def is_test_install():
    """A dev bridge or the checks (they set NEUROVAULT_TEST_INSTALL=1): never the user's app."""
    return os.environ.get("NEUROVAULT_TEST_INSTALL") == "1"


def real_vaults():
    """The user's real vault folders as far as tests are concerned: Documents\\NeuroVault in Windows' own Documents
    (never the NEUROVAULT_DOCUMENTS stand-in), plus any NEUROVAULT_REAL_VAULT names (checks add stand-ins: it only adds)."""
    import platform_layer
    out = [os.path.join(platform_layer.documents_dir(), "NeuroVault")]
    out += [p for p in os.environ.get("NEUROVAULT_REAL_VAULT", "").split(os.pathsep) if p.strip()]
    return [os.path.normcase(os.path.abspath(p)) for p in out]


def test_vault_refusal(path):
    """For dev bridges and test launchers: why `path` can't be their vault (the user's real one, inside it or holding
    it, or a folder an app install marked, or inside one), or None when it's a fine scratch vault."""
    if not path:
        return None
    p = os.path.normcase(os.path.abspath(path))
    for real in real_vaults():
        if p == real or p.startswith(real.rstrip(os.sep) + os.sep) or real.startswith(p.rstrip(os.sep) + os.sep):
            return (f"{path} is (or holds) the NeuroVault folder in your Documents: the real vault on this PC. "
                    "A test must use a scratch vault.")
    here = os.path.abspath(path)
    while True:
        m = read_marker(here) if os.path.isdir(here) else None
        if m and (m.get("bad") or any(not e.get("test") for e in m["installs"] if isinstance(e, dict))):
            return f"{here} is a vault the NeuroVault app uses (its .neurovault/vault-id.json says so). A test must use a scratch vault."
        up = os.path.dirname(here)
        if up == here:
            return None
        here = up


def sha256_of(path):
    import hashlib
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def copy_attachments(src, dest):
    """The one-time copy-out of attachments/ (flat): each file in src goes to dest unless dest already has the same
    bytes (SHA-256), under that name or another; same name with other bytes gets a free name ("x 2.png"). Nothing in
    dest is overwritten. Returns (copied, renames): renames maps "attachments/<old>" to "attachments/<name in dest>"
    for each file that ended up under another name, so the notes' links can follow."""
    copied, renames = 0, {}
    if not os.path.isdir(src):
        return 0, {}
    os.makedirs(dest, exist_ok=True)
    by_size = {}   # dest files by size, hashed only when a source file has that size
    for e in os.scandir(dest):
        if e.is_file() and not e.name.endswith((".part", ".nv-part")):
            by_size.setdefault(e.stat().st_size, []).append([e.name, None])
    for e in sorted(os.scandir(src), key=lambda x: x.name):
        if not e.is_file() or e.name.endswith((".part", ".nv-part")):
            continue
        size, digest, match = e.stat().st_size, None, None
        same = by_size.get(size, [])
        if same:
            digest = sha256_of(e.path)
            for cand in sorted(same, key=lambda c: c[0].lower() != e.name.lower()):   # its own name first
                if cand[1] is None:
                    cand[1] = sha256_of(os.path.join(dest, cand[0]))
                if cand[1] == digest:
                    match = cand[0]
                    break
        if match is None:
            stem, ext = os.path.splitext(e.name)
            target = free_path(dest, stem, ext)
            shutil.copy2(e.path, target)
            match = os.path.basename(target)
            by_size.setdefault(size, []).append([match, digest])
            copied += 1
        if match.lower() != e.name.lower():
            renames[f"attachments/{e.name}"] = f"attachments/{match}"
    return copied, renames
# ==== end QC 86 ====
