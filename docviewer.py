"""
docviewer.py — the document viewer (mockup R66): PDF and Word (.docx) attachments open in
their own NeuroVault window, with notes on them.

The user (2026-10-19): "docx viewer with the anotation youve built for the images and the same for pdfs, I want it to open in a
seperate neurovault window! … if we can use already built code … obviously checking if it is secure before doing so."

How it fits together (security from, followed as written):
- ViewerWindows opens one window per file, like popout.py's sticky pop-outs: frameless, with our own window bar (viewer.html),
  winframe's resize edges and snapping, and the live taskbar icon (Build N). Opening a file that's open brings it up.
- The window gets its OWN small js_api, ViewerApi, never NeuroVaultApi. It's bound to its one file when it's made, so the page
  can't name another: even a fully compromised viewer page can read only its document and write only its notes.
- The document goes to the page as bytes (no URL, no path); the page has a CSP with connect-src 'none' (no network at all).
  PDF.js's cmaps and fonts come through vendor_file, which only reads the vendor folder's own font files.
- A library is only offered to the page when its files match the pinned SHA-256 hashes below (vendor_status). None are
  vendored yet: the user says yes first. Until then a PDF or Word file shows "needs the PDF reader / Word reader" with
  Open in your default app, and the checks run on the small fake renderer (frontend/viewer/renderers.js).
- Notes on a file live beside it in the vault, in .neurovault/annotations/<sha256 of the file>.json, keyed by its content, so
  a rename keeps them and another file of the same name doesn't take them. The original is NEVER changed (QC 68 / QC 88).
- The Timeline gets one entry per viewing session that changed the notes ("Annotated report.pdf · 3 pins, 1 highlight") with
  Restore (the set from before it; the last KEEP sets per file are kept), and one per annotated copy saved.
- "Save an annotated copy" (COPY_KINDS): the page draws each page with the notes on it, and a notes page last; this makes one
  PDF of them with Pillow, "<name> (annotated).pdf" beside the original, which remembers where it came from (QC 68).

Tests drive it with fake windows: set `create` to a stand-in and `async_ = False` (test_api.py, test_doc_viewer).
"""
import base64
import hashlib
import io
import json
import logging
import os
import re
import secrets
import threading

import attachments
import winframe
from errors import plain_error
from db import utc_now_iso

log = logging.getLogger(__name__)

# ---- the layout answers (R66, the drawn defaults; the user may still answer R66). The page reads these from info(), so a
#      different answer is a one-line change here. ----
# The R66 decisions (): the tools' place is a setting ("customisable user
# setting", config.json viewer_tools, changed in Settings → Document viewer or the viewer's own "Tools: …"), its default the
# floating bar; pages left and notes right; one long scroll; the copy offers both a PDF and pictures of the pages.
TOOL_PLACES = ("top", "float", "rail", "bottom", "context", "panel")   # under the window bar | over the page | down the left |
#                                         along the bottom | beside what you pick (a mini toolbar) | in the notes panel
# The default moved to "top" after the user tried it (2026-10-20): "having a tool bar fixed and under the window header bar makes
# more sense". Settings that still hold the old default, "float", move to "top" once (migrate_tools).
LAYOUT = {"bar": "top",       # the tools' default place (one of TOOL_PLACES; the setting overrides it)
          "side": "right",    # your notes: "right" (pages left, notes right) | "tabs" (one panel: Notes, Pages, Outline)
          "flow": "scroll"}   # pages: "scroll" (one long scroll) | "single" (one at a time) | "spread" (two side by side)
COPY_KINDS = ("pdf", "png")   # what "Save an annotated copy" offers: "pdf" (the notes on the pages, a notes page last), "png"

KINDS = {".pdf": "pdf", ".docx": "docx"}
WINDOW_SIZE = (1180, 820)
WINDOW_MIN = (720, 480)
MAX_DOC_BYTES = attachments.MAX_DATA_BYTES          # what the bridge can carry as base64 (64 MB)
MAX_NOTES_BYTES = 2 * 1024 * 1024                   # one file's notes, as JSON
MAX_ITEMS = 2000
MAX_COPY_PAGES = 400
MAX_COPY_BYTES = 160 * 1024 * 1024                  # every page's PNG together
MAX_PAGE_PIXELS = 26_000_000                        # one page's picture (about 5100 × 5100)
KEEP = 10                                           # earlier sets of notes kept per file, for Restore
ITEM_KINDS = ("pin", "texthl", "cap", "arrow", "box", "hl", "text", "pen")
COLOURS = ("red", "amber", "blue")
ANN_DIR = (".neurovault", "annotations")
_ID = re.compile(r"^[A-Za-z0-9_-]{1,40}$")

# ---- the libraries the viewer would use, pinned (). NOTHING here is downloaded by the app: the files go in
#      frontend/viewer/vendor/<dir>/ once the user says yes (packaging/fetch_viewer_vendor.py checks every hash below). A library is
#      only handed to the page when every one of its files is there and matches. ----
VENDOR = {
    "pdfjs": {"name": "pdfjs-dist", "version": "6.4.299", "licence": "Apache-2.0", "dir": "pdfjs", "for": "pdf",
              "renderer": "pdfjs@6.4.299", "min_safe": "6.2.108 (CVE-2026-16633)",
              "files": {"pdf.min.mjs": "build/pdf.min.mjs", "pdf.worker.min.mjs": "build/pdf.worker.min.mjs", "LICENSE": "LICENSE"},
              "folders": {"cmaps": "cmaps", "standard_fonts": "standard_fonts"}},
    "docx": {"name": "docx-preview", "version": "0.4.1", "licence": "Apache-2.0", "dir": "docx", "for": "docx",
             "renderer": "docx-preview@0.4.1", "files": {"docx-preview.min.js": "dist/docx-preview.min.js", "LICENSE": "LICENSE"}},
    "jszip": {"name": "jszip", "version": "3.10.2", "licence": "MIT (or GPL-3.0)", "dir": "jszip", "for": "docx",
              "files": {"jszip.min.js": "dist/jszip.min.js", "LICENSE.markdown": "LICENSE.markdown"}},
    "dompurify": {"name": "dompurify", "version": "3.4.17", "licence": "MPL-2.0 or Apache-2.0", "dir": "dompurify", "for": "docx",
                  "files": {"purify.min.js": "dist/purify.min.js", "LICENSE": "LICENSE"}},
}
# expected SHA-256 of each vendored file (lowercase hex), from the npm registry / jsDelivr listings (vendor-plan.json has the
# tarballs' sha512 integrity too). Filled by the plan: a file whose hash is unknown is never trusted.
VENDOR_SHA256 = {}
VENDOR_PLAN = None   # tests point it at a plan of their own; otherwise frontend/viewer/vendor/vendor-plan.json (_plan_path)

LOG_SCHEMA = """CREATE TABLE IF NOT EXISTS doc_annotation_log (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    sha256      TEXT NOT NULL,            -- the file's content (the notes are keyed by it)
    file        TEXT NOT NULL,            -- attachments/<name> when it happened
    note_id     INTEGER,                  -- the note it was opened from, if any
    what        TEXT NOT NULL,            -- notes (a viewing session changed them) | copy (an annotated copy saved)
    before      TEXT,                     -- notes rows: the items before the session (JSON), for Restore; NULL once too old
    after       TEXT,                     -- notes rows: the items after it
    counts      TEXT,                     -- {"pin": 3, "texthl": 1, ...} after it
    copy        TEXT,                     -- copy rows: the file(s) saved
    vault       TEXT,
    at          TEXT NOT NULL,
    restored_at TEXT
)"""


def migrate_tools(cfg):
    """Once per config.json: the old default "float" becomes the new one, "top". A place picked after this stays. True if changed."""
    if cfg.get("viewer_tools_v2"):
        return False
    if cfg.get("viewer_tools") == "float":
        cfg["viewer_tools"] = "top"
    cfg["viewer_tools_v2"] = True
    return True


def layout_for(cfg):
    """LAYOUT with the tools where the user put them (config.json viewer_tools), or the default."""
    bar = (cfg or {}).get("viewer_tools")
    return {**LAYOUT, "bar": bar if bar in TOOL_PLACES else LAYOUT["bar"]}


def kind_of(file):
    return KINDS.get(os.path.splitext(str(file or ""))[1].lower())


# ---- QC 116: Explorer's Open with → NeuroVault. The file's path comes on the command line (sys.argv), or from a second launch
# (platform_layer.instance). Only an existing .pdf or .docx file gets through; it opens in a tab, viewed where it is.
MAX_LAUNCH = 8


def launch_path(arg):
    """The path to open for one command-line argument, or None: never a switch, a URL, a folder or another kind of file."""
    if not isinstance(arg, str):
        return None
    p = arg.strip().strip('"').strip()
    if not p or p.startswith("-") or "\x00" in p or len(p) > 4096 or re.match(r"^[A-Za-z][A-Za-z0-9+.-]+:", p):
        return None   # a switch, or a URL (file:, http:, ms-…:); a drive letter (one letter, C:\) is a path
    if not kind_of(p):
        return None
    p = os.path.abspath(p)
    return p if os.path.isfile(p) else None


def launch_paths(argv):
    """The files a launch asks to open: argv[1:], each through launch_path, in order, without repeats, at most MAX_LAUNCH."""
    out = []
    for a in list(argv or [])[1:]:
        p = launch_path(a)
        if p and p not in out:
            out.append(p)
    return out[:MAX_LAUNCH]


def file_sha256(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for block in iter(lambda: f.read(1 << 20), b""):
            h.update(block)
    return h.hexdigest()


_SHA_CACHE = {}   # (path, size, mtime_ns) -> sha256: the attachment list asks for every PDF and Word file


def cached_sha(path):
    st = os.stat(path)
    key = (os.path.normcase(os.path.abspath(path)), st.st_size, st.st_mtime_ns)
    if key not in _SHA_CACHE:
        if len(_SHA_CACHE) > 500:
            _SHA_CACHE.clear()
        _SHA_CACHE[key] = file_sha256(path)
    return _SHA_CACHE[key]


# ------------------------------------------------------------------ the notes beside the file

def _num(v, lo=0.0, hi=100.0):
    if isinstance(v, bool) or not isinstance(v, (int, float)) or v != v:
        raise ValueError("a position isn't a number")
    return round(min(hi, max(lo, float(v))), 3)


def _text(v, cap):
    if v is None:
        return ""
    if not isinstance(v, str):
        raise ValueError("a note isn't text")
    return v.replace("\x00", "")[:cap]


def clean_item(it):
    """One note, checked: anything else in it is dropped. ValueError for what can't be kept."""
    if not isinstance(it, dict):
        raise ValueError("a note isn't an object")
    kind = it.get("kind")
    if kind not in ITEM_KINDS:
        raise ValueError(f"unknown kind {kind!r}")
    iid = it.get("id")
    if not isinstance(iid, str) or not _ID.match(iid):
        raise ValueError("a note has no id")
    page = it.get("page")
    if isinstance(page, bool) or not isinstance(page, int) or not 1 <= page <= 100000:
        raise ValueError("a note has no page")
    out = {"id": iid, "kind": kind, "page": page}
    pts = it.get("pts") or []
    if not isinstance(pts, list) or len(pts) > 4000 or len(pts) % 2:
        raise ValueError("a note's points")
    need = {"pin": 2, "cap": 2, "text": 2, "arrow": 4, "box": 4, "hl": 4}.get(kind)
    if need and len(pts) != need:
        raise ValueError(f"a {kind} needs {need} numbers")
    if kind == "pen" and len(pts) < 4:
        raise ValueError("a pen line needs two points")
    out["pts"] = [_num(v) for v in pts]
    if kind == "texthl":
        rects = it.get("rects")
        if not isinstance(rects, list) or not 1 <= len(rects) <= 400 or not all(isinstance(r, list) and len(r) == 4 for r in rects):
            raise ValueError("a text highlight needs its boxes")
        out["rects"] = [[_num(v) for v in r] for r in rects]
    out["note"] = _text(it.get("note"), 4000)
    out["text"] = _text(it.get("text"), 500)        # the words of a text mark or a caption
    out["quote"] = _text(it.get("quote"), 500)      # the words it's on (a highlight), or near (a pin on a Word page)
    out["colour"] = it.get("colour") if it.get("colour") in COLOURS else "red"
    for k in ("created", "updated"):
        v = it.get(k)
        out[k] = v[:40] if isinstance(v, str) else ""
    return out


def clean_items(items):
    if not isinstance(items, list):
        raise ValueError("the notes aren't a list")
    if len(items) > MAX_ITEMS:
        raise ValueError(f"more than {MAX_ITEMS} notes on one file")
    seen, out = set(), []
    for it in items:
        c = clean_item(it)
        if c["id"] in seen:
            raise ValueError("two notes share an id")
        seen.add(c["id"])
        out.append(c)
    return out


def counts_of(items):
    c = {}
    for it in items:
        c[it["kind"]] = c.get(it["kind"], 0) + 1
    return c


_SAID = {"pin": ("pin", "pins"), "texthl": ("highlight", "highlights"), "cap": ("caption", "captions"), "arrow": ("arrow", "arrows"),
         "box": ("box", "boxes"), "hl": ("marked area", "marked areas"), "text": ("word", "words"), "pen": ("drawing", "drawings")}


def counts_text(counts):
    """{"pin": 3, "texthl": 1} -> "3 pins, 1 highlight"."""
    bits = [f"{n} {_SAID[k][0 if n == 1 else 1]}" for k, n in sorted((counts or {}).items(), key=lambda kv: ITEM_KINDS.index(kv[0])
                                                                   if kv[0] in ITEM_KINDS else 99) if n and k in _SAID]
    return ", ".join(bits) if bits else "no notes"


class Store:
    """The sidecar files: <base>/.neurovault/annotations/<sha256>.json."""

    def __init__(self, base_fn):
        self.base_fn = base_fn   # api._att_base: the vault (or the database's folder)
        self.lock = threading.RLock()

    def folder(self, create=False):
        path = os.path.join(self.base_fn(), *ANN_DIR)
        if create:
            os.makedirs(path, exist_ok=True)
        return path

    def path(self, sha):
        if not re.match(r"^[0-9a-f]{64}$", sha or ""):
            raise ValueError("not a file hash")
        return os.path.join(self.folder(), sha + ".json")

    def read(self, sha):
        """{version, file, sha256, renderer, items, updated} or None."""
        try:
            with open(self.path(sha), encoding="utf-8") as f:
                d = json.load(f)
        except FileNotFoundError:
            return None
        except (OSError, ValueError):
            log.exception("the notes for %s couldn't be read", sha)
            return None
        if not isinstance(d, dict):
            return None
        try:
            d["items"] = clean_items(d.get("items") or [])
        except ValueError:
            log.warning("the notes for %s didn't check out: shown as none (the file is kept)", sha)
            d["items"] = []
        return d

    def items(self, sha):
        d = self.read(sha)
        return d["items"] if d else []

    def write(self, sha, file, items, renderer=""):
        doc = {"version": 1, "file": os.path.basename(str(file)), "sha256": sha, "renderer": str(renderer or "")[:40],
               "items": items, "updated": utc_now_iso()}
        text = json.dumps(doc, ensure_ascii=False, indent=1)
        if len(text.encode("utf-8")) > MAX_NOTES_BYTES:
            raise ValueError("too many notes on one file to keep")
        with self.lock:
            self.folder(create=True)
            p = self.path(sha)
            with open(p + ".part", "w", encoding="utf-8") as f:
                f.write(text)
            os.replace(p + ".part", p)
        return doc


# ------------------------------------------------------------------ the libraries

_VENDOR_CACHE = {}


def vendor_root():
    """frontend/viewer/vendor beside this file (from source), or in the packaged app's _internal."""
    import sys
    base = getattr(sys, "_MEIPASS", None) or os.path.dirname(os.path.abspath(__file__))
    return os.path.join(base, "frontend", "viewer", "vendor")


def plan_path():
    return VENDOR_PLAN or os.path.join(vendor_root(), "vendor-plan.json")


def _plan_hashes():
    """The pinned hashes from vendor-plan.json ({"<dir>/<file>": sha256}), merged over VENDOR_SHA256."""
    out = dict(VENDOR_SHA256)
    try:
        with open(plan_path(), encoding="utf-8") as f:
            plan = json.load(f)
        for pkg in plan.get("packages", []):
            for name, info in (pkg.get("files") or {}).items():
                if isinstance(info, dict) and re.match(r"^[0-9a-f]{64}$", str(info.get("sha256", ""))):
                    out[f"{pkg['dir']}/{name}"] = info["sha256"]
    except (OSError, ValueError, KeyError, TypeError):
        pass
    return out


def vendor_status(root=None):
    """{"pdfjs": "ready" | "missing" | "changed", ...} and which renderers the page may use. A library is ready only when each of
    its listed files is there with its pinned hash (folders: there and not empty; the fetch script checked each file)."""
    root = root or vendor_root()
    hashes = _plan_hashes()
    st = {}
    for key, v in VENDOR.items():
        state = "ready"
        for name in v["files"]:
            p = os.path.join(root, v["dir"], name)
            if not os.path.isfile(p):
                state = "missing"
                break
            want = hashes.get(f"{v['dir']}/{name}")
            try:
                got = cached_sha(p)
            except OSError:
                state = "missing"
                break
            if not want or got != want:
                state = "changed"
                break
        if state == "ready":
            for folder in (v.get("folders") or {}):
                d = os.path.join(root, v["dir"], folder)
                if not os.path.isdir(d) or not os.listdir(d):
                    state = "missing"
                    break
        st[key] = state
    renderers = []
    if st.get("pdfjs") == "ready":
        renderers.append("pdf")
    if all(st.get(k) == "ready" for k in ("docx", "jszip", "dompurify")):
        renderers.append("docx")
    return {"libraries": st, "renderers": renderers}


# ------------------------------------------------------------------ the windows

class _Session:
    def __init__(self, file, path, sha, kind, note_id, note_title, look):
        self.token = secrets.token_urlsafe(16)
        self.file, self.path, self.sha, self.kind = file, path, sha, kind
        self.note_id, self.note_title, self.look = note_id, note_title, look
        self.win = None
        self.tab = False          # QC 114: shown in a tab of NeuroVault's window (an iframe on the viewer's own origin)
        self.log_id = None        # the Timeline row, once the notes change
        self.before = None        # the items when the window opened
        self.lock = threading.RLock()


class ViewerWindows:
    def __init__(self, api):
        self.api = api
        self.store = Store(api._att_base)
        self.sessions = {}        # file -> _Session (one window per file)
        self.url = None           # the main page's URL (main.py sets it); the viewer is viewer.html beside it
        self.create = None        # webview.create_window (main.py); tests pass a fake
        self.async_ = True
        self._lock = threading.RLock()
        self._log_ready = False
        self.pending = []         # QC 116: files from the command line or a second launch, for the main window to open in tabs

    # ---- the Timeline's table
    @property
    def db(self):
        return self.api.db

    def _log_table(self):
        if not self._log_ready:
            self.db.execute(LOG_SCHEMA)
            self._log_ready = True

    def viewer_url(self):
        u = str(self.url or "")
        return re.sub(r"index\.html$", "viewer.html", u) if u.endswith("index.html") else u.rstrip("/") + "/viewer.html"

    # ---- opening
    def _resolve(self, file, outside=False):
        if not isinstance(file, str):
            raise attachments.AttachmentError("That isn't a file in attachments/.")
        kind = kind_of(file)
        if not kind:
            raise attachments.AttachmentError("Only a PDF or a Word file (.docx) opens in the viewer.")
        if outside and os.path.isabs(file):   # Open a file…: viewed where it is, never copied (R70: "View it as it is")
            path = os.path.abspath(file)
            if not os.path.isfile(path):
                raise attachments.AttachmentError(f"{os.path.basename(file)} isn't there any more.")
            return path, path, kind
        path = attachments.resolve(self.api._att_base(), file)
        if not os.path.isfile(path):
            raise attachments.AttachmentError(f"{os.path.basename(file)} isn't in attachments/ any more.")
        return "attachments/" + os.path.basename(path), path, kind

    def open(self, file, note_id=None, look=None):
        try:
            file, path, kind = self._resolve(file)
        except attachments.AttachmentError as e:
            return {"status": "error", "message": plain_error(e)}
        with self._lock:
            s = self.sessions.get(file)
        if s is not None and s.tab:   # Pop out from its tab: the tab's session ends (its notes are saved), the window opens
            self.tab_close(s.token, tell=True)
            s = None
        if s is not None:   # open already: bring it up
            self.show(file)
            return {"status": "success", "file": file, "already": True}
        if not self.create or not self.url:
            return {"status": "error", "message": "The document viewer opens in the desktop app."}
        if os.path.getsize(path) > MAX_DOC_BYTES:
            return {"status": "error", "message": f"{os.path.basename(file)} is too big for the viewer. Open it in your default app instead."}
        nid, title = None, ""
        try:
            nid = int(note_id) if note_id not in (None, "") else None
            row = nid and self.db.query_one("SELECT title FROM notes WHERE id = ?", (nid,))
            title = row["title"] if row else ""
            if not row:
                nid = None
        except (TypeError, ValueError):
            nid = None
        s = _Session(file, path, cached_sha(path), kind, nid, title, _clean_look(look))
        s.before = self.store.items(s.sha)
        w, h = WINDOW_SIZE
        try:
            win = self.create(f"{os.path.basename(file)} · NeuroVault", url=f"{self.viewer_url()}#v={s.token}",
                              js_api=ViewerApi(self, s), width=w, height=h, min_size=WINDOW_MIN, frameless=True,
                              easy_drag=False, resizable=True, text_select=True, focus=True,
                              background_color=(s.look.get("bg") or "#16161A"))
        except Exception as e:
            log.exception("opening the viewer for %s failed", file)
            return {"status": "error", "message": plain_error(e, "open the viewer")}
        s.win = win
        with self._lock:
            self.sessions[file] = s
        self._recent(file)
        self._wire(win, s)
        return {"status": "success", "file": file}

    def _wire(self, win, s):
        ev = getattr(win, "events", None)
        if ev is None:
            return
        for name, fn in (("shown", lambda: self._shown(win)), ("closed", lambda: self._closed(s)), ("loaded", lambda: self._guard(win, s)),
                         ("maximized", lambda: self._send(s, {"kind": "max", "on": True})),
                         ("restored", lambda: self._send(s, {"kind": "max", "on": False}))):
            e = getattr(ev, name, None)
            if e is not None:
                e += fn

    def _shown(self, win):
        """A full document window: Windows' frame features (snap, maximise, the taskbar button) without a drawn frame, and our icon."""
        winframe.enable_native_frame(win)
        try:
            self.api.window_icon_shown(win)
        except Exception:
            log.exception("the viewer's icon")

    def _guard(self, win, s):
        """The navigation guard: the window only ever shows viewer.html. Anything else (a link that got through) closes it."""
        try:
            url = str(win.get_current_url() or "")
        except Exception:
            return
        if url and "viewer.html" not in url.split("#")[0].split("?")[0]:
            log.warning("the viewer window went to another page: closed")
            self._destroy(s)

    def show(self, file):
        s = self.sessions.get(file)
        if s is None or s.win is None:
            return False
        try:
            s.win.show()
            s.win.restore()
        except Exception:
            pass
        winframe.raise_window(s.win, False)
        return True

    def _destroy(self, s):
        try:
            s.win.destroy()
        except Exception:
            log.exception("closing the viewer failed")

    def _closed(self, s):
        with self._lock:
            if self.sessions.get(s.file) is s:
                self.sessions.pop(s.file, None)
        self._tell_main({"kind": "docv", "file": s.file, "closed": True, "count": len(self.store.items(s.sha))})

    # ---- QC 114: a document in a tab of NeuroVault's window, like a note. The viewer page runs in an iframe served by ViewerServer
    #      on its own origin, so it can't reach NeuroVault's window or its API; it asks for what it needs by postMessage, and the
    #      main window passes each ask to tab_call, which only runs ViewerApi's own calls for that one token.
    TAB_CALLS = ("info", "doc_bytes", "annotations_get", "annotations_save", "save_copy", "vendor_file", "open_link", "open_default",
                 "log_client", "set_tools")

    def open_tab(self, file, note_id=None, look=None, outside=False):
        try:
            file, path, kind = self._resolve(file, outside)
        except attachments.AttachmentError as e:
            return {"status": "error", "message": plain_error(e)}
        with self._lock:
            s = self.sessions.get(file)
        if s is not None and not s.tab:   # it's in its own window: bring that up
            self.show(file)
            return {"status": "success", "file": file, "window": True}
        if os.path.getsize(path) > MAX_DOC_BYTES:
            return {"status": "error", "message": f"{os.path.basename(file)} is too big for the viewer. Open it in your default app instead."}
        try:
            srv = self.server()
        except OSError as e:
            log.exception("the viewer's own server didn't start")
            return {"status": "error", "message": plain_error(e, "start the viewer")}
        if s is None:
            nid, title = self._note(note_id)
            s = _Session(file, path, cached_sha(path), kind, nid, title, _clean_look(look))
            s.tab, s.before = True, self.store.items(s.sha)
            with self._lock:
                self.sessions[file] = s
            self._recent(file)
        return {"status": "success", "file": file, "token": s.token, "kind": kind, "name": os.path.basename(file),
                "origin": srv.origin, "url": f"{srv.origin}/viewer.html?embed=1#v={s.token}", "from": s.note_title}

    def _note(self, note_id):
        try:
            nid = int(note_id) if note_id not in (None, "") else None
            row = nid and self.db.query_one("SELECT title FROM notes WHERE id = ?", (nid,))
            return (nid, row["title"]) if row else (None, "")
        except (TypeError, ValueError):
            return None, ""

    def _tab(self, token):
        return next((s for s in list(self.sessions.values()) if s.tab and secrets.compare_digest(s.token, str(token or ""))), None)

    def tab_call(self, token, method, args=None):
        s = self._tab(token)
        if s is None:
            return {"status": "error", "message": "That document isn't open in a tab any more."}
        if method not in self.TAB_CALLS:
            return {"status": "error", "message": "The viewer can't ask for that."}
        args = list(args) if isinstance(args, (list, tuple)) else []
        try:
            r = getattr(ViewerApi(self, s), method)(*args[:3])
        except TypeError:
            return {"status": "error", "message": "The viewer asked in a way that isn't offered."}
        if method == "info" and isinstance(r, dict):
            r["embedded"] = True
        return r

    def tab_close(self, token, tell=False):
        s = self._tab(token)
        if s is None:
            return False
        with self._lock:
            if self.sessions.get(s.file) is s:
                self.sessions.pop(s.file, None)
        if tell:
            self._tell_main({"kind": "docv-tabclose", "file": s.file, "token": s.token})
        self._tell_main({"kind": "docv", "file": s.file, "closed": True, "count": len(self.store.items(s.sha))})
        return True

    def pop_out(self, token, look=None):
        s = self._tab(token)
        if s is None:
            return {"status": "error", "message": "That document isn't open in a tab any more."}
        if os.path.isabs(s.file):
            return {"status": "error", "message": "A file from outside the vault opens in a tab only."}
        if not self.create or not self.url:   # the tab stays as it is
            return {"status": "error", "message": "The document viewer opens in the desktop app."}
        nid, file = s.note_id, s.file
        self.tab_close(token)
        return self.open(file, nid, look or s.look)

    def dock(self, s):
        """Back into a tab (the popped-out window's button): the window closes and NeuroVault's window opens it in a tab."""
        file, nid = s.file, s.note_id
        with self._lock:   # forgotten first, so the tab can open while Windows is still closing the window
            if self.sessions.get(file) is s:
                self.sessions.pop(file, None)
        self._destroy(s)
        self._tell_main({"kind": "docv-dock", "file": file, "note_id": nid})
        return True

    def _recent(self, file):
        try:
            cfg = self.api.cfg
            rec = [f for f in (cfg.get("viewer_recent") or []) if isinstance(f, str) and f != file]
            cfg["viewer_recent"] = [file, *rec][:8]
            import config as cfgmod
            cfgmod.save_config(cfg)
        except Exception:
            log.exception("remembering a recent document")

    # ---- QC 116: files from the command line or a second launch
    def hand_in(self, paths, tell=True):
        """Queue files for the main window (it opens each in a tab); tell=False before the window has loaded (it asks itself)."""
        ok = [p for p in (launch_path(x) for x in (paths or [])) if p]
        with self._lock:
            for p in ok:
                if p not in self.pending:
                    self.pending.append(p)
            self.pending = self.pending[-MAX_LAUNCH:]
        if ok and tell:
            self._tell_main({"kind": "docv-openpath"})   # no path in the script: the page asks for them (viewer_take_pending)
        return ok

    def take_pending(self):
        with self._lock:
            out, self.pending = [p for p in self.pending if os.path.isfile(p)], []
        return out

    def second_launch(self, paths):
        """platform_layer.instance's handler: the main window comes to the front, then opens what was handed over."""
        try:
            self.api._pop.show_main()
        except Exception:
            log.exception("bringing NeuroVault to the front for a second launch")
        self.hand_in(paths)

    def server(self):
        if getattr(self, "_server", None) is None:
            self._server = ViewerServer()
        return self._server

    def close_all(self):
        for s in list(self.sessions.values()):
            if s.win is not None:
                self._destroy(s)
        if getattr(self, "_server", None) is not None:
            self._server.stop()
            self._server = None

    def windows(self):
        return [s.win for s in self.sessions.values() if s.win is not None]

    # ---- messages
    def _tell_main(self, msg):
        try:
            self.api._pop.sync(msg, to="main")
        except Exception:
            log.exception("telling NeuroVault's window about the viewer")

    def _send(self, s, msg):
        if s.tab:   # in a tab: NeuroVault's window hands it to the viewer's frame
            self._tell_main({"kind": "docv-tab", "token": s.token, "msg": msg})
            return
        if s.win is None:
            return
        script = "window.nvViewer && window.nvViewer(%s)" % json.dumps(msg)
        if not self.async_:
            try:
                s.win.evaluate_js(script)
            except Exception:
                pass
            return
        threading.Thread(target=lambda: _quiet(s.win.evaluate_js, script), daemon=True, name="nv-viewer-send").start()

    # ---- the notes
    def save_items(self, s, items, renderer=""):
        items = clean_items(items)
        with s.lock:
            doc = self.store.write(s.sha, s.file, items, renderer)
            changed = json.dumps(items, sort_keys=True) != json.dumps(s.before or [], sort_keys=True)
            self._log_table()
            counts = json.dumps(counts_of(items))
            if s.log_id is None and changed:
                cur = self.db.execute("INSERT INTO doc_annotation_log (sha256, file, note_id, what, before, after, counts, vault, at)"
                                      " VALUES (?, ?, ?, 'notes', ?, ?, ?, ?, ?)",
                                      (s.sha, s.file, s.note_id, json.dumps(s.before or []), json.dumps(items), counts,
                                       getattr(self.db, "vault", None), utc_now_iso()))
                s.log_id = cur.lastrowid
                self._prune(s.sha)
            elif s.log_id is not None:   # the same session, still going: its row follows (back to unchanged: the row goes)
                if changed:
                    self.db.execute("UPDATE doc_annotation_log SET after = ?, counts = ?, at = ? WHERE id = ?",
                                    (json.dumps(items), counts, utc_now_iso(), s.log_id))
                else:
                    self.db.execute("DELETE FROM doc_annotation_log WHERE id = ?", (s.log_id,))
                    s.log_id = None
        self._tell_main({"kind": "docv", "file": s.file, "count": len(items)})
        return {"status": "success", "count": len(items), "saved_at": doc["updated"]}

    def _prune(self, sha):
        """The last KEEP sets per file stay restorable; older rows stay in the Timeline without them."""
        rows = self.db.query("SELECT id FROM doc_annotation_log WHERE sha256 = ? AND what = 'notes' AND before IS NOT NULL ORDER BY id DESC",
                             (sha,))
        for r in rows[KEEP:]:
            self.db.execute("UPDATE doc_annotation_log SET before = NULL, after = NULL WHERE id = ?", (r["id"],))

    def list_log(self, limit=80):
        self._log_table()
        try:
            limit = max(1, min(int(limit), 500))
        except (TypeError, ValueError):
            limit = 80
        rows = self.db.query("""SELECT l.*, n.title AS note_title FROM doc_annotation_log l LEFT JOIN notes n ON n.id = l.note_id
                                WHERE l.vault IS ? ORDER BY l.id DESC LIMIT ?""", (getattr(self.db, "vault", None), limit))
        out = []
        for r in rows:
            counts = _loads(r["counts"], {})
            before = _loads(r["before"], None)
            out.append({"id": r["id"], "file": r["file"], "name": os.path.basename(r["file"]), "note_id": r["note_id"],
                        "title": r["note_title"], "what": r["what"], "counts": counts, "said": counts_text(counts),
                        "before_said": counts_text(counts_of(before)) if isinstance(before, list) else None,
                        "copy": r["copy"], "at": r["at"], "restored_at": r["restored_at"],
                        "can_restore": r["what"] == "notes" and before is not None and not r["restored_at"]})
        return out

    def restore(self, entry_id):
        """Restore: the notes on the file go back to the set from before that session. The set it replaces is kept as a new row."""
        self._log_table()
        try:
            eid = int(entry_id)
        except (TypeError, ValueError):
            return {"status": "error", "message": "That change isn't recorded."}
        r = self.db.query_one("SELECT * FROM doc_annotation_log WHERE id = ?", (eid,))
        if not r or r["what"] != "notes":
            return {"status": "error", "message": "That change isn't recorded."}
        if r["restored_at"]:
            return {"status": "error", "message": "Those notes are back already."}
        before = _loads(r["before"], None)
        if not isinstance(before, list):
            return {"status": "error", "message": "That set of notes is too old to bring back."}
        try:
            before = clean_items(before)
        except ValueError:
            return {"status": "error", "message": "That set of notes couldn't be read."}
        now_items = self.store.items(r["sha256"])
        d = self.store.read(r["sha256"]) or {}
        self.store.write(r["sha256"], d.get("file") or r["file"], before, d.get("renderer", ""))
        self.db.execute("UPDATE doc_annotation_log SET restored_at = ? WHERE id = ?", (utc_now_iso(), eid))
        open_s = next((s for s in self.sessions.values() if s.sha == r["sha256"]), None)
        if open_s is not None:   # the window shows the restored set, and its session starts again from it
            with open_s.lock:
                open_s.before, open_s.log_id = before, None
            self._send(open_s, {"kind": "reload"})
        self._tell_main({"kind": "docv", "file": r["file"], "count": len(before)})
        return {"status": "success", "file": r["file"], "count": len(before), "replaced": len(now_items)}

    def count_for(self, path):
        try:
            return len(self.store.items(cached_sha(path)))
        except OSError:
            return 0

    # ---- the annotated copy
    def save_copy(self, s, kind, pages):
        if kind not in COPY_KINDS:
            return {"status": "error", "message": "That kind of copy isn't offered."}
        if not isinstance(pages, list) or not 1 <= len(pages) <= MAX_COPY_PAGES:
            return {"status": "error", "message": "The copy needs its pages."}
        raws, total = [], 0
        for p in pages:
            m = re.match(r"^data:image/png;base64,([A-Za-z0-9+/=]+)$", p if isinstance(p, str) else "")
            if not m:
                return {"status": "error", "message": "A page of the copy didn't arrive as a picture."}
            raw = base64.b64decode(m.group(1))
            total += len(raw)
            if not raw.startswith(b"\x89PNG\r\n\x1a\n") or total > MAX_COPY_BYTES:
                return {"status": "error", "message": "The copy is too big to make."}
            raws.append(raw)
        try:
            from PIL import Image
        except ImportError:
            return {"status": "error", "message": "Saving a copy needs Pillow, which isn't installed."}
        try:
            imgs = []
            for raw in raws:
                im = Image.open(io.BytesIO(raw))
                if im.format != "PNG" or im.width * im.height > MAX_PAGE_PIXELS:
                    return {"status": "error", "message": "A page of the copy is too big."}
                imgs.append(im.convert("RGB"))
        except Exception as e:
            log.exception("reading the copy's pages")
            return {"status": "error", "message": plain_error(e, "make the copy")}
        base = self.api._att_base()
        root = attachments.folder(base, create=True)
        stem = re.sub(r"\s\(annotated(?:\s\d+)?\)$", "", os.path.splitext(os.path.basename(s.path))[0])
        saved = []
        if kind == "pdf":
            name, k = f"{stem} (annotated).pdf", 1
            while os.path.exists(os.path.join(root, name)):
                k += 1
                name = f"{stem} (annotated {k}).pdf"
            dest = os.path.join(root, name)
            buf = io.BytesIO()
            imgs[0].save(buf, "PDF", save_all=True, append_images=imgs[1:], resolution=144.0,
                         title=f"{os.path.basename(s.path)}, annotated", producer="NeuroVault")
            with open(dest + ".part", "wb") as f:
                f.write(buf.getvalue())
            os.replace(dest + ".part", dest)
            saved.append(name)
        else:   # "png": a picture of each page, beside the original
            k = 1
            while any(os.path.exists(os.path.join(root, f"{stem} (annotated{'' if k == 1 else ' ' + str(k)}) page {i + 1}.png"))
                      for i in range(len(raws))):
                k += 1
            for i, raw in enumerate(raws):
                name = f"{stem} (annotated{'' if k == 1 else ' ' + str(k)}) page {i + 1}.png"
                with open(os.path.join(root, name), "wb") as f:
                    f.write(raw)
                saved.append(name)
        for name in saved:
            self.api._att_from("attachments/" + name, s.path, "annotate")   # QC 68: where it came from
        self._log_table()
        self.db.execute("INSERT INTO doc_annotation_log (sha256, file, note_id, what, counts, copy, vault, at) VALUES (?, ?, ?, 'copy', ?, ?, ?, ?)",
                        (s.sha, s.file, s.note_id, json.dumps(counts_of(self.store.items(s.sha))), json.dumps(saved),
                         getattr(self.db, "vault", None), utc_now_iso()))
        self._tell_main({"kind": "docv", "file": s.file, "copy": saved})
        first = "attachments/" + saved[0]
        return {"status": "success", "file": first, "files": ["attachments/" + n for n in saved], "name": saved[0],
                **({"pages": len(saved)} if kind == "png" else {})}


def _quiet(fn, *a):
    try:
        fn(*a)
    except Exception:
        pass


def _loads(text, default):
    try:
        return json.loads(text) if text else default
    except (TypeError, ValueError):
        return default


_LOOK_KEYS = ("theme", "dark", "accent", "font", "textsize", "spacing", "cvd")
_VAR = re.compile(r"^--[a-z0-9-]{1,40}$")
_VAL = re.compile(r"^[#(),.%\w\s-]{1,80}$")


def _clean_look(look):
    """The main window's theme for the viewer: body attributes and its accent's colour tokens, checked (plain words and colours)."""
    out = {"vars": {}}
    if not isinstance(look, dict):
        return out
    for k in _LOOK_KEYS:
        v = look.get(k)
        if isinstance(v, str) and re.match(r"^[a-z0-9-]{1,24}$", v):
            out[k] = v
    for k, v in list((look.get("vars") or {}).items())[:40] if isinstance(look.get("vars"), dict) else []:
        if isinstance(k, str) and _VAR.match(k) and isinstance(v, str) and _VAL.match(v.strip()) and "url" not in v.lower():
            out["vars"][k] = v.strip()
    bg = look.get("bg")
    if isinstance(bg, str) and re.match(r"^#[0-9a-fA-F]{6}$", bg):
        out["bg"] = bg
    return out


class ViewerApi:
    """The viewer window's js_api. Small on purpose (): it reads its one file and writes its one file's notes.
    Everything it holds is private (a leading _), so pywebview shows the page only these methods."""

    def __init__(self, viewers, session):
        self._v = viewers
        self._s = session

    def info(self):
        s, v = self._s, self._v
        st = vendor_status()
        return {"status": "success", "file": s.file, "name": os.path.basename(s.file), "kind": s.kind,
                "size": os.path.getsize(s.path) if os.path.isfile(s.path) else 0, "note_id": s.note_id, "from": s.note_title,
                "look": s.look, "layout": layout_for(v.api.cfg), "copy_kinds": list(COPY_KINDS), "libraries": st["libraries"],
                "renderers": st["renderers"], "versions": {k: f"{x['name']} {x['version']}" for k, x in VENDOR.items()},
                "maximized": winframe.is_maximized(s.win) if s.win is not None else False, "embedded": False,
                "can_dock": not os.path.isabs(s.file)}

    def doc_bytes(self):
        """{status, data: base64}: the document itself, never a path or a URL."""
        s = self._s
        try:
            if os.path.getsize(s.path) > MAX_DOC_BYTES:
                return {"status": "error", "message": "The file is too big for the viewer."}
            with open(s.path, "rb") as f:
                raw = f.read()
        except OSError as e:
            return {"status": "error", "message": plain_error(e, "read the file")}
        if hashlib.sha256(raw).hexdigest() != s.sha:   # changed since the window opened: the notes belong to the old one
            return {"status": "error", "message": f"{os.path.basename(s.file)} changed since the viewer opened. Close the window and open it again."}
        return {"status": "success", "data": base64.b64encode(raw).decode("ascii"), "size": len(raw)}

    def annotations_get(self):
        d = self._v.store.read(self._s.sha) or {}
        return {"status": "success", "items": d.get("items") or [], "updated": d.get("updated")}

    def annotations_save(self, items, renderer=""):
        try:
            return self._v.save_items(self._s, items, renderer)
        except ValueError as e:
            return {"status": "error", "message": f"The notes couldn't be saved: {e}."}
        except OSError as e:
            log.exception("saving the notes")
            return {"status": "error", "message": plain_error(e, "save the notes")}

    def save_copy(self, kind, pages):
        try:
            return self._v.save_copy(self._s, kind, pages)
        except OSError as e:
            log.exception("saving the annotated copy")
            return {"status": "error", "message": plain_error(e, "save the copy")}

    def vendor_file(self, path):
        """PDF.js's character maps and standard fonts (the page has no network to fetch them): only files in those two folders."""
        rel = str(path or "").replace("\\", "/")
        m = re.match(r"^pdfjs/(cmaps|standard_fonts)/([A-Za-z0-9._-]{1,80})$", rel)
        if not m or ".." in rel:
            return {"status": "error", "message": "Not a viewer font file."}
        if vendor_status()["libraries"].get("pdfjs") != "ready":
            return {"status": "error", "message": "The PDF reader isn't installed."}
        p = os.path.join(vendor_root(), "pdfjs", m.group(1), m.group(2))
        if not os.path.isfile(p) or os.path.getsize(p) > 8 * 1024 * 1024:
            return {"status": "error", "message": "Not a viewer font file."}
        with open(p, "rb") as f:
            return {"status": "success", "data": base64.b64encode(f.read()).decode("ascii")}

    def open_link(self, url):
        """A link in the document: the app's open_external rules (web and email only), in the browser, never in this window."""
        return self._v.api.open_external(url)

    def open_default(self):
        """The file in its default app (when the reader for it isn't installed yet)."""
        return self._v.api.attachment_open(self._s.file)

    def log_client(self, level="error", message="", where=""):
        return self._v.api.log_client(level, message, f"viewer · {where}"[:160])

    def set_tools(self, place):
        """The viewer's own "Tools: …" choice: saved as the setting (every viewer window and Settings follow)."""
        if place not in TOOL_PLACES:
            return {"status": "error", "message": "That isn't a place for the tools."}
        r = self._v.api.save_settings({"viewer_tools": place})
        if (r or {}).get("rejected"):
            return {"status": "error", "message": "The place for the tools wasn't saved."}
        return {"status": "success", "bar": place}

    # ---- the window bar (frameless, like the main window)
    def window_minimize(self):
        try:
            self._s.win.minimize()
            return True
        except Exception:
            return False

    def window_toggle_maximize(self):
        w = self._s.win
        if w is None:
            return False
        target = not winframe.is_maximized(w)
        try:
            if target:
                winframe.fit_maximized_bounds(w)
                w.maximize()
            else:
                w.restore()
        except Exception:
            log.exception("maximising the viewer")
        return target

    def window_fill(self, axis):
        w = self._s.win
        return bool(w) and not winframe.is_maximized(w) and winframe.fill(w, axis)

    def window_start_drag(self, part):
        w = self._s.win
        if w is None or part not in winframe.HIT or (part != "caption" and winframe.is_maximized(w)):
            return False
        if part == "caption":
            winframe.fit_maximized_bounds(w)
        return winframe.start_drag(w, part)

    def window_close(self):
        self._v._destroy(self._s)
        return True

    def dock(self):
        """Back into a tab: QC 114 / R70 (a document can pop out of its tab and come back)."""
        if os.path.isabs(self._s.file):
            return False
        return self._v.dock(self._s)


# ------------------------------------------------------------------ the viewer's own origin (QC 114)

class ViewerServer:
    """A small static server on 127.0.0.1 for the in-tab viewer, so the viewer page runs on an origin of its own: an iframe from
    here can't reach NeuroVault's window, its page or its API (: "a separate origin would be stricter").
    It serves only the files the viewer page loads, read-only, and nothing else."""
    ALLOW = (re.compile(r"^viewer\.html$"), re.compile(r"^viewer/(viewer\.js|renderers\.js|viewer\.css)$"),
             re.compile(r"^viewer/vendor/(pdfjs|docx|jszip|dompurify)/[A-Za-z0-9._/-]+$"), re.compile(r"^css/(tokens|app)\.css$"),
             re.compile(r"^fonts/[A-Za-z0-9._-]+$"), re.compile(r"^js/(mute|log-r95|icons|tooltip)\.js$"))
    TYPES = {".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8",
             ".css": "text/css; charset=utf-8", ".woff": "font/woff", ".woff2": "font/woff2", ".ttf": "font/ttf", ".pfb": "application/octet-stream",
             ".bcmap": "application/octet-stream"}

    def __init__(self, root=None):
        from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
        import sys
        base = root or os.path.join(getattr(sys, "_MEIPASS", None) or os.path.dirname(os.path.abspath(__file__)), "frontend")
        allow, types = self.ALLOW, self.TYPES

        class H(BaseHTTPRequestHandler):
            def log_message(self, *a):
                pass

            def do_GET(self):
                rel = self.path.split("?", 1)[0].split("#", 1)[0].lstrip("/")
                ok = rel and ".." not in rel and "\\" not in rel and any(p.match(rel) for p in allow)
                path = os.path.normpath(os.path.join(base, *rel.split("/"))) if ok else None
                if not path or not path.startswith(os.path.normpath(base) + os.sep) or not os.path.isfile(path):
                    self.send_error(404)
                    return
                with open(path, "rb") as f:
                    data = f.read()
                self.send_response(200)
                self.send_header("Content-Type", types.get(os.path.splitext(path)[1].lower(), "application/octet-stream"))
                self.send_header("Content-Length", str(len(data)))
                self.send_header("X-Content-Type-Options", "nosniff")
                self.send_header("Cache-Control", "no-store")
                self.send_header("Referrer-Policy", "no-referrer")
                self.end_headers()
                self.wfile.write(data)

            def do_POST(self):
                self.send_error(405)

        self.httpd = ThreadingHTTPServer(("127.0.0.1", 0), H)
        self.httpd.daemon_threads = True
        self.origin = f"http://127.0.0.1:{self.httpd.server_address[1]}"
        threading.Thread(target=self.httpd.serve_forever, daemon=True, name="nv-viewer-server").start()

    def stop(self):
        try:
            self.httpd.shutdown()
            self.httpd.server_close()
        except Exception:
            pass


# ------------------------------------------------------------------ into NeuroVaultApi (api.py calls install at its end)

def install(cls):
    from api import safe_action, safe_list

    def _viewer(self):
        v = getattr(self, "_viewer_wins", None)
        if v is None:
            v = self._viewer_wins = ViewerWindows(self)
        return v

    @safe_action
    def viewer_open(self, file, note_id=None, look=None):
        """Opens a PDF or Word attachment in its own viewer window (one per file). {status, file, already?}"""
        return self._dv().open(file, note_id, look)

    @safe_list()
    def viewer_files(self):
        """The files open in a viewer window now."""
        return sorted(self._dv().sessions)

    @safe_list()
    def list_doc_annotations(self, limit=80):
        """The Timeline: [{id, file, name, note_id, title, what: notes|copy, counts, said, before_said, copy, at, restored_at, can_restore}]"""
        return self._dv().list_log(limit)

    @safe_action
    def restore_doc_annotations(self, entry_id):
        return self._dv().restore(entry_id)

    @safe_action
    def viewer_status(self):
        """Which libraries are in (and match their pinned hashes), and the layout answers."""
        return {"status": "success", **vendor_status(), "layout": layout_for(self.cfg), "copy_kinds": list(COPY_KINDS),
                "tool_places": list(TOOL_PLACES)}

    @safe_action
    def viewer_tab_open(self, file, note_id=None, look=None):
        """QC 114: a PDF or Word attachment in a tab, like a note. {status, file, token, url, origin, kind, name} (or window: True when
        it's open in its own window, which comes to the front)."""
        return self._dv().open_tab(file, note_id, look)

    @safe_action
    def viewer_tab_open_path(self, path, look=None):
        """Open a file…: a PDF or Word file from this PC (the Open dialog's path), viewed where it is: never copied or changed."""
        return self._dv().open_tab(path, None, look, outside=True)

    @safe_action
    def viewer_tab_call(self, token, method, args=None):
        """The in-tab viewer's asks, passed on by NeuroVault's window: only ViewerApi's own calls, for that one document."""
        return self._dv().tab_call(token, method, args)

    @safe_action
    def viewer_tab_close(self, token):
        return {"status": "success", "closed": self._dv().tab_close(token)}

    @safe_action
    def viewer_pop_out(self, token, look=None):
        """Pop out (on the tab and in the document's header): the tab closes and the document opens in its own window."""
        return self._dv().pop_out(token, look)

    @safe_action
    def viewer_source_path(self, file):
        """Convert to a note… (a separate action from viewing): the attachment's full path for Build K's convert_file."""
        try:
            _, path, _ = self._dv()._resolve(file)
        except attachments.AttachmentError as e:
            return {"status": "error", "message": plain_error(e)}
        return {"status": "success", "path": path}

    @safe_list()
    def viewer_recent(self):
        """The documents viewed lately (newest first), still there."""
        out = []
        for f in self.cfg.get("viewer_recent") or []:
            try:
                ok = os.path.isfile(f) if os.path.isabs(f) else os.path.isfile(attachments.resolve(self._att_base(), f))
            except attachments.AttachmentError:
                ok = False
            if ok and kind_of(f):
                out.append(f)
        return out

    @safe_list()
    def viewer_take_pending(self):
        """QC 116: the PDF and Word files Open with (or a second launch) asked to open; the page opens each in a tab. Once."""
        return self._dv().take_pending()

    for n, f in (("viewer_tab_open", viewer_tab_open), ("viewer_tab_open_path", viewer_tab_open_path), ("viewer_tab_call", viewer_tab_call),
                 ("viewer_tab_close", viewer_tab_close), ("viewer_pop_out", viewer_pop_out), ("viewer_source_path", viewer_source_path),
                 ("viewer_recent", viewer_recent), ("viewer_take_pending", viewer_take_pending)):
        setattr(cls, n, f)

    for n, f in (("_dv", _viewer), ("viewer_open", viewer_open), ("viewer_files", viewer_files),
                 ("list_doc_annotations", list_doc_annotations), ("restore_doc_annotations", restore_doc_annotations),
                 ("viewer_status", viewer_status)):
        setattr(cls, n, f)

    # the attachment list says how many notes each PDF and Word file has (the card's "Annotated · N" chip)
    listed0 = cls.list_attachments

    def list_attachments(self, *a, **k):
        r = listed0(self, *a, **k)
        if isinstance(r, dict) and r.get("status") == "success":
            v = self._dv()
            for f in r.get("files") or []:
                if kind_of(f.get("file")):
                    try:
                        f["annotated"] = v.count_for(attachments.resolve(self._att_base(), f["file"]))
                    except Exception:
                        f["annotated"] = 0
        return r
    list_attachments.__name__ = listed0.__name__
    list_attachments.__doc__ = listed0.__doc__
    cls.list_attachments = list_attachments

    # the tools' place is a setting (R66): config.json viewer_tools, checked like the other choices; a change from Settings or from
    # any viewer window reaches every open viewer at once, and NeuroVault's Settings page
    import config as cfgmod
    cfgmod._CHOICES["viewer_tools"] = TOOL_PLACES
    cfgmod.DEFAULT_CONFIG.setdefault("viewer_tools", LAYOUT["bar"])
    init0 = cls.__init__

    def __init__(self, *a, **k):
        init0(self, *a, **k)
        try:
            if migrate_tools(self.cfg):
                cfgmod.save_config(self.cfg)
        except Exception:
            log.exception("moving the viewer's tools to the new default")
    __init__.__name__ = "__init__"
    cls.__init__ = __init__
    ss0 = cls.save_settings

    def save_settings(self, patch, *a, **k):
        r = ss0(self, patch, *a, **k)
        if isinstance(patch, dict) and patch.get("viewer_tools") in TOOL_PLACES and not (r or {}).get("rejected", {}).get("viewer_tools"):
            v = self._dv()
            for s in list(v.sessions.values()):
                v._send(s, {"kind": "tools", "bar": patch["viewer_tools"]})
            v._tell_main({"kind": "docv-tools", "bar": patch["viewer_tools"]})
        return r
    save_settings.__name__ = "save_settings"
    save_settings.__doc__ = ss0.__doc__
    cls.save_settings = save_settings

    # the themed taskbar icon reaches the viewer windows too (Build N)
    lw0 = cls._logo_windows
    cls._logo_windows = lambda self: [*lw0(self), *self._dv().windows()]

    # closing NeuroVault closes its viewers (their notes are saved as they go)
    sd0 = cls.shutdown

    def shutdown(self, *a, **k):
        try:
            self._dv().close_all()
        except Exception:
            log.exception("closing the viewers")
        return sd0(self, *a, **k)
    shutdown.__name__ = "shutdown"
    cls.shutdown = shutdown
