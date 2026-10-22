"""
ai_attach.py — Build N, QC 101: what an AI model gets of a note's attachments (with "Let AI read this note's attachments" on).

Feedback: "how can we get an ai to review the attachement?" and "there is a second one in there but the model doesnt have access
to it". Every text-based file goes as its text to ANY model, on this PC or in the cloud: Markdown, plain text, CSV, JSON, code,
HTML (sanitised to its text), and PDF, Word and Excel through converters.py. Pictures go only to a model that can see them.
Nothing is skipped silently: each file is included, trimmed (to what the model can read at once, shared fairly between the
files) or not readable, with the reason, and the model is told which files it couldn't get.

    plan(base, files, route, used_chars)  → {"items": [{file, name, state, kind, why, chars, of}], "budget": chars}
    for_model(plan_result)                → what local_ai.Ai.ask sends: [{kind: text | image | missing, ...}]

Each file's text is cached by its path, size and modified time, so a second question about it reads nothing again.
"""
import html.parser
import logging
import os
import re
import threading

import attachments
import cloud_ai
import converters
import local_ai
from errors import plain_error

log = logging.getLogger(__name__)

TEXT_EXT = {".md", ".markdown", ".txt", ".text", ".csv", ".tsv", ".json", ".jsonl", ".ndjson", ".log", ".xml", ".yaml", ".yml", ".toml",
            ".ini", ".cfg", ".conf", ".env.example", ".rst", ".tex", ".srt", ".vtt", ".ics", ".vcf", ".ipynb",
            ".py", ".pyw", ".js", ".mjs", ".cjs", ".ts", ".tsx", ".jsx", ".vue", ".svelte", ".css", ".scss", ".sass", ".less",
            ".java", ".kt", ".kts", ".scala", ".groovy", ".c", ".h", ".cc", ".cpp", ".cxx", ".hpp", ".cs", ".fs", ".go", ".rs", ".rb",
            ".php", ".pl", ".lua", ".r", ".jl", ".dart", ".swift", ".m", ".sh", ".bash", ".zsh", ".ps1", ".psm1", ".bat", ".cmd",
            ".sql", ".graphql", ".gql", ".proto", ".dockerfile", ".makefile", ".gradle", ".cmake", ".nix", ".hcl", ".tf"}
HTML_EXT = {".html", ".htm", ".xhtml", ".mhtml"}
DOC_EXT = {".pdf": "pdf", ".docx": "docx", ".docm": "docx", ".dotx": "docx", ".xlsx": "xlsx", ".xlsm": "xlsx"}
IMAGE_EXT = {".png", ".jpg", ".jpeg", ".webp", ".gif"}   # what the vision APIs take
VIDEO_EXT = {".mp4", ".mov", ".mkv", ".avi", ".wmv", ".m4v", ".webm"}
ARCHIVE_EXT = {".zip", ".7z", ".rar", ".tar", ".gz", ".tgz", ".bz2", ".xz"}
OFFICE_OLD = {".doc", ".xls", ".ppt", ".pptx", ".odt", ".ods", ".odp", ".rtf", ".pages", ".numbers", ".key"}

MAX_FILES = 20
TEXT_BYTES = 8 * 1024 * 1024         # a text file bigger than this is read only this far (and trimmed anyway)
DOC_BYTES = 60 * 1024 * 1024         # a PDF, Word or Excel file bigger than this isn't opened
IMAGES_MAX, IMAGE_BYTES = 4, 4_000_000
MIN_SHARE = 400                      # characters: a file that would get less is left out ("no room"), not cut to a stub
CLOUD_TOKENS_MAX = 32768             # what NeuroVault sends a cloud model at most, whatever its context: free limits are per minute
CLOUD_TOKENS_UNKNOWN = 16384         # a cloud model whose context the company's list doesn't give
KEEP_FOR_CHAT = 1500                 # characters kept back for the chat's last turns and the list of files

_cache, _cache_lock = {}, threading.Lock()


def kind(name):
    """text | html | doc | image | audio | video | archive | other"""
    n = str(name).lower()
    ext = os.path.splitext(n)[1]
    if ext in HTML_EXT:
        return "html"
    if ext in DOC_EXT:
        return "doc"
    if ext in TEXT_EXT or os.path.basename(n) in ("dockerfile", "makefile", "readme", "license", "changelog"):
        return "text"
    if ext in IMAGE_EXT or attachments.kind_of(n) == "image":
        return "image"
    if attachments.kind_of(n) == "audio":
        return "audio"
    if ext in VIDEO_EXT:
        return "video"
    if ext in ARCHIVE_EXT:
        return "archive"
    return "other"


def readable(name):
    return kind(name) in ("text", "html", "doc")


class _HtmlText(html.parser.HTMLParser):
    """An HTML page's words: no scripts, styles or markup; block elements on their own lines, links keep their address."""
    SKIP = {"script", "style", "noscript", "template", "svg", "canvas", "iframe", "object", "head"}
    BLOCK = {"p", "div", "section", "article", "header", "footer", "main", "aside", "nav", "li", "ul", "ol", "table", "tr", "br", "hr",
             "h1", "h2", "h3", "h4", "h5", "h6", "pre", "blockquote", "figure", "figcaption", "dt", "dd", "form", "fieldset", "details", "summary"}

    VOID = {"area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "source", "track", "wbr"}
    _HIDDEN_STYLE = re.compile(r"display\s*:\s*none|visibility\s*:\s*hidden|font-size\s*:\s*0(?:px|pt|em|rem|%)?\s*(?:;|$)|opacity\s*:\s*0(?:\.0+)?\s*(?:;|$)", re.I)

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.out, self.skip, self.title, self._in_title = [], 0, "", False
        self.hidden = []   # R69: [tag, depth] of an element the page hides (display:none, hidden, font-size:0...): its words are never read

    def _hides(self, tag, attrs):
        a = dict(attrs)
        return tag not in self.VOID and ("hidden" in a or bool(self._HIDDEN_STYLE.search(a.get("style") or "")))

    def handle_starttag(self, tag, attrs):
        if self.hidden:
            if tag == self.hidden[-1][0]:
                self.hidden[-1][1] += 1
            return
        if self._hides(tag, attrs):
            self.hidden.append([tag, 1])
            return
        if tag == "title":
            self._in_title = True
        if tag in self.SKIP:
            self.skip += 1
        elif not self.skip:
            if tag in self.BLOCK:
                self.out.append("\n")
            if tag in ("h1", "h2", "h3", "h4", "h5", "h6"):
                self.out.append("#" * int(tag[1]) + " ")
            elif tag == "li":
                self.out.append("- ")
            elif tag in ("td", "th"):
                self.out.append(" | ")
            elif tag == "img":
                alt = dict(attrs).get("alt")
                if alt:
                    self.out.append(f"[picture: {alt}]")

    def handle_startendtag(self, tag, attrs):
        n, d, k = len(self.hidden), (self.hidden[-1][1] if self.hidden else 0), self.skip
        self.handle_starttag(tag, attrs)
        if len(self.hidden) > n:   # a self-closed hidden element has no content
            self.hidden.pop()
        elif self.hidden and self.hidden[-1][1] > d:
            self.hidden[-1][1] = d
        elif self.skip > k:
            self.skip -= 1

    def handle_endtag(self, tag):
        if self.hidden:
            if tag == self.hidden[-1][0]:
                self.hidden[-1][1] -= 1
                if self.hidden[-1][1] <= 0:
                    self.hidden.pop()
            return
        if tag == "title":
            self._in_title = False
        if tag in self.SKIP:
            self.skip = max(0, self.skip - 1)
        elif not self.skip and tag in self.BLOCK:
            self.out.append("\n")

    def handle_data(self, data):
        if self.hidden:
            return
        if self._in_title:
            self.title += data
        elif not self.skip:
            self.out.append(data)


def html_text(src):
    p = _HtmlText()
    try:
        p.feed(src)
        p.close()
    except Exception as e:   # a broken page: whatever was read so far
        log.info("html_text: %r", e)
    lines = [re.sub(r"[ \t\r\f\v]+", " ", x).strip() for x in "".join(p.out).split("\n")]
    body = re.sub(r"\n{3,}", "\n\n", "\n".join(lines)).strip()
    title = re.sub(r"\s+", " ", p.title).strip()
    return (f"# {title}\n\n{body}" if title and title not in body[:200] else body).strip()


def _decode(raw):
    for enc in ("utf-8-sig", "utf-16") if raw[:2] in (b"\xff\xfe", b"\xfe\xff") else ("utf-8-sig", "cp1252"):
        try:
            return raw.decode(enc)
        except UnicodeDecodeError:
            continue
    return raw.decode("utf-8", "replace")


def _why_not(name):
    k, ext = kind(name), os.path.splitext(str(name).lower())[1]
    if k == "audio":
        return "it’s a sound recording, which the AI can’t hear"
    if k == "video":
        return "it’s a video, which the AI can’t watch"
    if k == "archive":
        return "it’s a compressed archive: unzip it and add the files inside"
    if ext in OFFICE_OLD:
        return f"NeuroVault can’t read {ext} files yet: save it as .docx, .xlsx or .pdf"
    return f"NeuroVault can’t read {ext or 'these'} files"


def read_text(path, name):
    """(text, None) or (None, why) for a text-based file, cached by path, size and modified time."""
    try:
        st = os.stat(path)
    except OSError:
        return None, "it isn’t in the attachments folder any more"
    key = (os.path.normcase(os.path.abspath(path)), st.st_size, st.st_mtime_ns)
    with _cache_lock:
        if key in _cache:
            return _cache[key]
    got = _read(path, name, st.st_size)
    with _cache_lock:
        if len(_cache) > 64:
            _cache.clear()
        _cache[key] = got
    return got


def _read(path, name, size):
    k = kind(name)
    ext = os.path.splitext(name.lower())[1]
    if k == "doc":
        if size > DOC_BYTES:
            return None, f"it’s too big to read ({size / 1e6:.0f} MB; up to {DOC_BYTES // 1_000_000} MB)"
        how = DOC_EXT[ext]
        if how == "pdf" and not converters.pdf_available():
            return None, "reading PDFs needs the pdfplumber package, which isn’t installed"
        try:
            md = {"pdf": converters.pdf_to_markdown, "docx": converters.docx_to_markdown, "xlsx": converters.xlsx_to_markdown}[how](path).get("markdown") or ""
        except converters.ConvertError as e:
            return None, str(e).rstrip(".")
        except Exception as e:   # a damaged or password-protected file
            log.info("AI attachment %s: %r", name, e)
            return None, "it couldn’t be opened: it may be damaged or protected with a password"
        md = md.strip()
        if not md:
            return None, "it has no text to read (a scan, or pictures only)" if how == "pdf" else "it’s empty"
        return md, None
    if k in ("text", "html"):
        try:
            with open(path, "rb") as f:
                raw = f.read(TEXT_BYTES)
        except OSError as e:
            return None, plain_error(e).rstrip(".")
        if b"\x00" in raw[:8192] and raw[:2] not in (b"\xff\xfe", b"\xfe\xff"):
            return None, "it isn’t a text file, whatever its name says"
        text = _decode(raw)
        if k == "html":
            text = html_text(text)
        text = text.strip()
        return (text, None) if text else (None, "it’s empty")
    return None, _why_not(name)


def _ctx_tokens(s):
    m = re.fullmatch(r"\s*(\d+(?:\.\d+)?)\s*([KkMm]?)\s*", str(s or ""))
    if not m:
        return None
    return int(float(m.group(1)) * {"": 1, "k": 1000, "m": 1_000_000}[m.group(2).lower()])


def budget(route, used_chars):
    """Characters of attachments that fit: what the model reads at once (this PC: its context; a cloud model: its context, at
    most CLOUD_TOKENS_MAX and its last-known tokens a minute), less the answer's room, what's already in, and the chat's share."""
    if (route or {}).get("kind") == "cloud":
        info = cloud_ai.model_info(route.get("prov"), route.get("model")) or {}
        tok = min(_ctx_tokens(info.get("ctx")) or CLOUD_TOKENS_UNKNOWN, CLOUD_TOKENS_MAX)
        tpm = (cloud_ai.use_of(route.get("prov"), route.get("model")).get("tokens") or {}).get("of")
        if tpm:
            tok = min(tok, int(tpm))
    else:
        tok = local_ai.QA_CTX_TOKENS
    return max(0, (tok - local_ai.QA_REPLY_TOKENS) * local_ai.QA_CHARS_PER_TOKEN - int(used_chars) - KEEP_FOR_CHAT)


def _cut(text, n):
    if len(text) <= n:
        return text
    at = text.rfind("\n", int(n * 0.85), n)
    return text[:at if at > 0 else n].rstrip()


def plan(base, files, route, used_chars):
    """What goes for these files (the note's, ticked, and any added from the vault), in order."""
    route = route or {}
    vision = route.get("kind") == "cloud" and bool(route.get("vision"))
    who = route.get("name") or "This model"
    room = budget(route, used_chars)
    items, texts, n_img = [], [], 0
    seen = set()
    for f in files if isinstance(files, list) else []:
        if not isinstance(f, str) or f in seen or len(items) >= MAX_FILES:
            continue
        seen.add(f)
        name = f.rsplit("/", 1)[-1]
        it = {"file": f, "name": name, "kind": "image" if kind(name) == "image" else "text", "state": "unreadable", "why": "", "chars": 0, "of": 0}
        items.append(it)
        try:
            path = attachments.resolve(base, f)
        except attachments.AttachmentError:
            it["why"] = "it isn’t a file in the attachments folder"
            continue
        if not os.path.isfile(path):
            it["why"] = "it isn’t in the attachments folder any more"
            continue
        if it["kind"] == "image":
            if not vision:
                it["why"] = (f"{who} can’t see pictures: pick a model marked with an image icon" if route.get("kind") == "cloud"
                             else "models on this PC can’t see pictures yet")
            elif os.path.splitext(name.lower())[1] not in IMAGE_EXT:
                it["why"] = "the AI takes PNG, JPEG, WebP and GIF pictures only"
            elif os.path.getsize(path) > IMAGE_BYTES:
                it["why"] = f"it’s over {IMAGE_BYTES // 1_000_000} MB"
            elif n_img >= IMAGES_MAX:
                it["why"] = f"only {IMAGES_MAX} pictures go with one question"
            else:
                n_img += 1
                it.update(state="included", path=path)
            continue
        text, why = read_text(path, name)
        if text is None:
            it["why"] = why
            continue
        it.update(of=len(text), text=text)
        texts.append(it)
    # share the room fairly: the smallest first, each up to an equal share of what's left
    left = room
    order = sorted(texts, key=lambda x: x["of"])
    for i, it in enumerate(order):
        share = left // (len(order) - i)
        take = min(it["of"], share)
        if take < it["of"] and take < MIN_SHARE:
            it.update(state="unreadable", why=f"there’s no room left in what {who} can read at once", text=None)
            continue
        it["text"] = _cut(it["text"], take)
        it.update(chars=len(it["text"]), state="included" if len(it["text"]) >= it["of"] else "trimmed")
        left -= len(it["text"])
    return {"items": items, "budget": room}


def public(p):
    """The plan for the page: no paths, no text."""
    return {"budget": p["budget"], "items": [{k: v for k, v in it.items() if k not in ("text", "path")} for it in p["items"]]}


def for_model(p, base):
    """What Ai.ask sends: texts and pictures, and a line for each file it couldn't get."""
    out = []
    for it in p["items"]:
        if it["state"] in ("included", "trimmed") and it["kind"] == "text":
            out.append({"kind": "text", "name": it["file"], "text": it["text"], "of": it["of"], "trimmed": it["state"] == "trimmed"})
        elif it["state"] == "included" and it["kind"] == "image":
            try:
                out.append({"kind": "image", "name": it["file"], "data": attachments.data_url(base, it["file"])})
            except (OSError, attachments.AttachmentError) as e:
                out.append({"kind": "missing", "name": it["file"], "why": plain_error(e).rstrip(".")})
        else:
            out.append({"kind": "missing", "name": it["file"], "why": it["why"]})
    return out
