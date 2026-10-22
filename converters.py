"""
converters.py: PDF and DOCX files to Markdown notes (Build K).

    docx_to_markdown(path, att_base=None, progress=None, cancel=None)
    pdf_to_markdown(path, att_base=None, progress=None, cancel=None)
        → {markdown, title, images: [{file, name, size}], tables: [{file, name, size, rows, cols}], warnings: [...], pages}

Both keep headings, paragraphs, bold / italic / strike, bullet and numbered lists (nested), tables (as Markdown tables),
links and images. Images are written to <att_base>/attachments/ and embedded on a line of their own as
"![[attachments/<name>]]", the way Build A's attachments are; with att_base None they're counted but not written.
A PDF also keeps its page breaks (a "---" line between pages) and reads multi-column pages column by column.
Each table is also saved as "<note> table N.csv" in attachments/ (table_stem names it; else the title), linked under
the table by a hidden "<!-- ![[attachments/…csv]] -->" line, so the note's Attachments tab lists it.

DOCX is read with the standard library (zipfile + ElementTree): word/document.xml with its styles, numbering and
relationships. PDF needs pdfplumber (pdfminer.six underneath); without it pdf_to_markdown raises ConvertError.

progress(done, total, label) is called as the work goes (a PDF: once a page); cancel() returning True stops the work
with Cancelled. A file that can't be read raises ConvertError with a message in plain words. Images written
before a failure are removed again, so a failed conversion leaves nothing behind.

    Jobs                  a small registry of background conversions, polled by the page (api.py's convert_job)
"""
import csv
import io
import logging
import os
import re
import threading
import zipfile
import xml.etree.ElementTree as ET

import attachments
from errors import plain_error  # v0.1.1 (QC 90): failures in plain words, the detail in the log

log = logging.getLogger(__name__)

MAX_BYTES = 200 * 1024 * 1024   # a bigger file is refused before reading
EXTS = {".pdf": "pdf", ".docx": "docx", ".docm": "docx", ".dotx": "docx"}


class ConvertError(Exception):
    """A problem worth telling the user about, in their words."""


class Cancelled(Exception):
    """The user cancelled the conversion."""


def kind_of(path):
    """pdf | docx | None, from the file's extension."""
    return EXTS.get(os.path.splitext(str(path or ""))[1].lower())


def _check_file(path, what):
    if not path or not os.path.isfile(path):
        raise ConvertError(f"{os.path.basename(str(path or '')) or 'That file'} isn't there any more.")
    if os.path.getsize(path) > MAX_BYTES:
        raise ConvertError(f"{os.path.basename(path)} is over {MAX_BYTES // (1024 * 1024)} MB, too big to convert.")
    if os.path.getsize(path) == 0:
        raise ConvertError(f"{os.path.basename(path)} is empty: there's no {what} in it.")


def safe_name(text, limit=80):
    """Text made into a file name attachments/ accepts and "![[…]]" can embed (no <>:"/\|?*[]#^)."""
    return (re.sub(r'[<>:"/\\|?*\[\]#^\x00-\x1f]+', "-", str(text or "")).strip(" .-") or "file")[:limit].strip(" .-") or "file"


def _stem(path):
    """The source's name as a safe file-name stem for its images: "Week 3 notes.pdf" → "week-3-notes"."""
    s = re.sub(r"[^\w-]+", "-", os.path.splitext(os.path.basename(path))[0].lower(), flags=re.UNICODE).strip("-_")
    return (s or "file")[:40]


# ---- Markdown text ----

_TAG_RE = re.compile(r"(^|[\s(])#(?=[\w/-])", re.UNICODE)   # NeuroVault reads "#word" as a tag (markdown.js nvTag)
_LINE_START = re.compile(r"^(\s*)(#{1,6}(?=\s|$)|>|[-+*](?=\s)|(\d{1,9})([.)])(?=\s)|=+\s*$|-{3,}\s*$|\|)")


def esc(text):
    """Plain text made safe as Markdown inline text: what would turn into formatting, a link, a tag or HTML is escaped."""
    text = text.replace("\\", "\\\\")
    text = re.sub(r"([*`\[\]~])", r"\\\1", text)
    text = re.sub(r"(?<![\w\\])_|_(?!\w)", r"\\_", text)
    text = re.sub(r"&(?=#?\w+;)", "&amp;", text)
    text = re.sub(r"<(?=[A-Za-z/!?])", r"&lt;", text)
    return _TAG_RE.sub(lambda m: m.group(1) + "\\#", text)


def esc_line_start(line):
    """A line that would start a heading, quote, list, rule or table gets its first character escaped."""
    m = _LINE_START.match(line)
    if not m:
        return line
    lead = m.group(1)
    if m.group(3):  # "12. " → "12\. "
        return lead + m.group(3) + "\\" + line[len(lead) + len(m.group(3)):]
    return lead + "\\" + line[len(lead):]


class Seg:
    """A run of text with its formatting: b(old), i(talic), s(trike), href (a link), code (monospace)."""
    __slots__ = ("text", "b", "i", "s", "href", "code")

    def __init__(self, text, b=False, i=False, s=False, href=None, code=False):
        self.text, self.b, self.i, self.s, self.href, self.code = text, b, i, s, href, code

    def fmt(self):
        return (self.b, self.i, self.s, self.code)


def _merge(segs):
    out = []
    for g in segs:
        if not g.text:
            continue
        if out and out[-1].fmt() == g.fmt() and out[-1].href == g.href:
            out[-1].text += g.text
        else:
            out.append(Seg(g.text, g.b, g.i, g.s, g.href, g.code))
    return out


_MARKS = (("s", "~~"), ("b", "**"), ("i", "*"))   # opened outermost first


def _render_fmt(segs, table=False):
    """Segments with no links → Markdown. Markers hug the words: "**bold** text", never "**bold **text"."""
    out, stack, pending = [], [], ""

    def close_to(keep):
        nonlocal stack
        while stack and stack[-1] not in keep or any(m not in keep for m in stack):
            out.append(dict(_MARKS)[stack.pop()])

    for g in segs:
        raw = g.text.replace("\r", "")
        if table:
            raw = raw.replace("\n", " ")
        if g.code:
            core = raw.strip()
            if not core:
                pending += raw
                continue
            close_to(set())
            tick = "``" if "`" in core else "`"
            out.append(pending + raw[:len(raw) - len(raw.lstrip())] + tick + core + tick)
            pending = raw[len(raw.rstrip()):]
            continue
        core = raw.strip()
        if not core:
            pending += raw
            continue
        want = [k for k, _ in _MARKS if getattr(g, k)]
        close_to(set(want))
        out.append(pending + raw[:len(raw) - len(raw.lstrip())])
        for k in want:
            if k not in stack:
                stack.append(k)
                out.append(dict(_MARKS)[k])
        text = esc(core)
        if table:
            text = text.replace("|", "\\|")
        out.append(text)
        pending = raw[len(raw.rstrip()):]
    close_to(set())
    out.append(pending)
    return "".join(out)


def render_inline(segs, table=False):
    """Segments → one line (or several, for line breaks) of Markdown, with links as [text](url)."""
    segs = _merge(segs)
    out, i = [], 0
    while i < len(segs):
        href = segs[i].href
        j = i
        while j < len(segs) and segs[j].href == href:
            j += 1
        text = _render_fmt(segs[i:j], table)
        if href and text.strip():
            lead, core, trail = text[:len(text) - len(text.lstrip())], text.strip(), text[len(text.rstrip()):]
            url = href.replace(" ", "%20").replace("(", "%28").replace(")", "%29")
            out.append(f"{lead}[{core}]({url}){trail}")
        else:
            out.append(text)
        i = j
    md = "".join(out)
    md = "\n".join(re.sub(r"[ \t]+", " ", ln).strip() for ln in md.split("\n"))
    return md.strip("\n")


_BOXES = {"☐": "[ ]", "□": "[ ]", "❑": "[ ]", "❒": "[ ]", "◻": "[ ]", "☑": "[x]", "☒": "[x]", "✅": "[x]"}


def task_box(md):
    """("[ ]" or "[x]", the rest) when a line starts with a check box character (☐ ☑ ☒ …), else None."""
    m = re.match(r"^\s*([☐□❑❒◻☑☒✅])[\s ]+(\S.*)$", md, re.S)
    return (_BOXES[m.group(1)], m.group(2)) if m else None


def table_md(rows):
    """[[cell markdown]] → a GFM table; the first row is the header. Rows are padded to the widest."""
    rows = [r for r in rows if any(c.strip() for c in r)]
    if not rows:
        return ""
    width = max(len(r) for r in rows)
    rows = [[c.strip() for c in r] + [""] * (width - len(r)) for r in rows]
    lines = ["| " + " | ".join(rows[0]) + " |", "|" + "|".join([" --- "] * width) + "|"]
    lines += ["| " + " | ".join(r) + " |" for r in rows[1:]]
    return "\n".join(lines)


def join_blocks(blocks):
    """Blocks → the note's Markdown. A block is (kind, text): items of one list ("li:<list>") follow each other
    directly, the rest get a blank line between them."""
    out, prev = [], None
    for kind, text in blocks:
        if not text.strip():
            continue
        if out:
            out.append("\n" if kind.startswith("li") and kind == prev else "\n\n")
        out.append(text)
        prev = kind
    md = "".join(out).strip("\n")
    return md + "\n" if md else ""


class Images:
    """Writes a conversion's images to attachments/ under unique names; undo() removes them again."""

    def __init__(self, att_base, stem):
        self.base, self.stem, self.files, self.by_key = att_base, stem, [], {}
        self.skipped = 0
        self.tables, self.table_rows = [], []   # the CSVs written, and each table's plain rows until then

    def add(self, data, ext, key=None):
        """Saves the bytes and returns "attachments/<name>" (the same name again for the same key), or None."""
        if key is not None and key in self.by_key:
            return self.by_key[key]
        if not data:
            return None
        if self.base is None:
            self.skipped += 1
            return None
        attachments.folder(self.base, create=True)
        name = attachments.unique_name(self.base, f"{self.stem}-img{len(self.files) + 1}", ext.lower())
        path = os.path.join(attachments.folder(self.base), name)
        with open(path, "wb") as f:
            f.write(data)
        file = f"{attachments.DIR}/{name}"
        self.files.append({"file": file, "name": name, "size": len(data)})
        if key is not None:
            self.by_key[key] = file
        return file

    def table_slot(self, rows):
        """Keeps a table's plain rows for its CSV; the block returned marks where its link goes (see _finish)."""
        self.table_rows.append(rows)
        return ("csv", str(len(self.table_rows) - 1))

    def add_table(self, stem, rows):
        """Saves rows as "attachments/<stem> table N.csv" (UTF-8 with a BOM, so Excel reads it) and returns that, or None."""
        if self.base is None:
            return None
        attachments.folder(self.base, create=True)
        buf = io.StringIO()
        csv.writer(buf, lineterminator="\r\n").writerows(rows)
        data = buf.getvalue().encode("utf-8-sig")
        name = attachments.unique_name(self.base, f"{safe_name(stem, 60)} table {len(self.tables) + 1}", ".csv")
        with open(os.path.join(attachments.folder(self.base), name), "wb") as f:
            f.write(data)
        file = f"{attachments.DIR}/{name}"
        self.tables.append({"file": file, "name": name, "size": len(data), "rows": len(rows),
                            "cols": max((len(r) for r in rows), default=0)})
        return file

    def undo(self):
        Images.undo_files(self.base, self.files + self.tables)
        self.files, self.tables = [], []

    @staticmethod
    def undo_files(base, files):
        """Removes images a conversion wrote (their {name}s), when its note couldn't be saved or it was cancelled."""
        for f in files:
            try:
                os.remove(os.path.join(attachments.folder(base), f["name"]))
            except OSError:
                log.exception("removing %s", f["name"])


def _tick(progress, cancel, done, total, label):
    if cancel and cancel():
        raise Cancelled()
    if progress:
        try:
            progress(done, total, label)
        except Exception:
            log.exception("progress callback")


def _drop_title_heading(blocks, title):
    """The note's title is shown above its text, so a first "# Title" that only repeats it is left out."""
    for n, (kind, text) in enumerate(blocks):
        if not text.strip():
            continue
        if kind == "h" and re.sub(r"^#+\s*", "", text).strip().lower() == title.strip().lower():
            return blocks[:n] + blocks[n + 1:]
        return blocks
    return blocks


def _finish(blocks, title, images, warnings, pages=None, table_stem=None):
    """The result. Each table is also saved as "<note> table N.csv" in attachments/, linked to the note by a hidden
    line under the table, "<!-- ![[attachments/<note> table N.csv]] -->": the Attachments tab lists it (it finds a
    note's files by their "![[…]]"), the editor doesn't show it, and Remove in the tab takes the line out."""
    title = (title or "").strip()
    if title:
        blocks = _drop_title_heading(blocks, title)
    done = []
    for kind, text in blocks:
        if kind == "csv":
            rows = [r for r in images.table_rows[int(text)] if any(c.strip() for c in r)]
            file = images.add_table(table_stem or title or images.stem, rows) if rows else None
            if file:
                done.append(("comment", f"<!-- ![[{file}]] -->"))
        else:
            done.append((kind, text))
    out = {"markdown": join_blocks(done), "title": title, "images": list(images.files), "tables": list(images.tables),
           "warnings": warnings}
    if pages is not None:
        out["pages"] = pages
    if images.skipped:
        warnings.append(f"{images.skipped} image{'s were' if images.skipped > 1 else ' was'} left out (no attachments folder).")
    return out


# =====================================================================================================================
# DOCX: word/document.xml read with ElementTree
# =====================================================================================================================

W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
NS = {
    "w": W, "r": R,
    "a": "http://schemas.openxmlformats.org/drawingml/2006/main",
    "wp": "http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing",
    "v": "urn:schemas-microsoft-com:vml",
    "mc": "http://schemas.openxmlformats.org/markup-compatibility/2006",
    "m": "http://schemas.openxmlformats.org/officeDocument/2006/math",
    "rel": "http://schemas.openxmlformats.org/package/2006/relationships",
    "dc": "http://purl.org/dc/elements/1.1/",
    "cp": "http://schemas.openxmlformats.org/package/2006/metadata/core-properties",
}
MONO_FONTS = ("consolas", "courier", "courier new", "lucida console", "menlo", "monaco", "source code pro", "cascadia")
WEB_IMAGES = {".png", ".jpg", ".jpeg", ".gif", ".bmp", ".webp", ".svg", ".tif", ".tiff"}


def q(tag):
    p, t = tag.split(":")
    return f"{{{NS[p]}}}{t}"


def _wval(el, default=None):
    return el.get(q("w:val"), default) if el is not None else default


def _on(el):
    """A w:b / w:i style toggle: present and not w:val="0" / "false" / "off"."""
    return el is not None and _wval(el, "1").lower() not in ("0", "false", "off", "none")


def _xml(z, name):
    try:
        return ET.fromstring(z.read(name))
    except KeyError:
        return None


def _rels(z, part):
    """{rId: (target path in the zip or URL, external?)} for a part like word/document.xml."""
    folder, base = part.rsplit("/", 1)
    root = _xml(z, f"{folder}/_rels/{base}.rels")
    out = {}
    if root is None:
        return out
    for r in root.findall("rel:Relationship", NS):
        target, ext = r.get("Target", ""), r.get("TargetMode") == "External"
        if not ext:
            target = target.lstrip("/") if target.startswith("/") else os.path.normpath(f"{folder}/{target}").replace("\\", "/")
        out[r.get("Id")] = (target, ext)
    return out


class _Styles:
    def __init__(self, root):
        self.by_id = {}
        if root is None:
            return
        for s in root.findall("w:style", NS):
            sid = s.get(q("w:styleId"))
            name = _wval(s.find("w:name", NS), sid) or ""
            ppr, rpr = s.find("w:pPr", NS), s.find("w:rPr", NS)
            self.by_id[sid] = {
                "name": name.lower(), "type": s.get(q("w:type")), "based": _wval(s.find("w:basedOn", NS)),
                "outline": _wval(ppr.find("w:outlineLvl", NS)) if ppr is not None else None,
                "numPr": ppr.find("w:numPr", NS) if ppr is not None else None,
                "rPr": rpr,
            }

    def chain(self, sid):
        seen = []
        while sid and sid in self.by_id and sid not in seen:
            seen.append(sid)
            sid = self.by_id[sid]["based"]
        return [self.by_id[s] for s in seen]

    def heading(self, sid):
        """1–6 for a heading style (Heading N, Title, or an outline level), else None."""
        for st in self.chain(sid):
            m = re.fullmatch(r"heading\s*(\d)", st["name"])
            if m:
                return min(max(int(m.group(1)), 1), 6)
            if st["name"] == "title":
                return 1
            if st["outline"] is not None and st["outline"].isdigit() and int(st["outline"]) < 9:
                return min(int(st["outline"]) + 1, 6)
        return None

    def num_pr(self, sid):
        for st in self.chain(sid):
            if st["numPr"] is not None:
                return st["numPr"]
        return None

    def name(self, sid):
        st = self.by_id.get(sid)
        return st["name"] if st else ""

    def run_fmt(self, sid):
        """{b, i, s, code} that a style's run properties (and the styles it's based on) switch on or off."""
        fmt = {}
        for st in reversed(self.chain(sid)):
            fmt.update(_rpr_fmt(st["rPr"]))
        return fmt


def _rpr_fmt(rpr):
    fmt = {}
    if rpr is None:
        return fmt
    for key, tags in (("b", ("w:b",)), ("i", ("w:i",)), ("s", ("w:strike", "w:dstrike"))):
        for t in tags:
            el = rpr.find(t, NS)
            if el is not None:
                fmt[key] = _on(el)
    if rpr.find("w:vanish", NS) is not None and _on(rpr.find("w:vanish", NS)):
        fmt["hidden"] = True
    fonts = rpr.find("w:rFonts", NS)
    if fonts is not None:
        face = (fonts.get(q("w:ascii")) or fonts.get(q("w:hAnsi")) or "").lower()
        if face:
            fmt["code"] = any(face.startswith(m) for m in MONO_FONTS)
    return fmt


class _Numbering:
    """numId → its list's levels: {ilvl: (ordered?, start)}; plus counters for numbering items as they come."""

    def __init__(self, root):
        self.levels, self.counters = {}, {}
        if root is None:
            return
        abstract = {}
        for a in root.findall("w:abstractNum", NS):
            abstract[a.get(q("w:abstractNumId"))] = self._lvls(a)
        for n in root.findall("w:num", NS):
            lv = dict(abstract.get(_wval(n.find("w:abstractNumId", NS)), {}))
            for o in n.findall("w:lvlOverride", NS):
                il = int(o.get(q("w:ilvl"), "0"))
                inner = o.find("w:lvl", NS)
                if inner is not None:
                    lv.update(self._lvls(o))
                so = o.find("w:startOverride", NS)
                if so is not None and il in lv:
                    lv[il] = (lv[il][0], int(_wval(so, "1")))
            self.levels[n.get(q("w:numId"))] = lv

    @staticmethod
    def _lvls(parent):
        out = {}
        for lvl in parent.findall("w:lvl", NS):
            fmt = _wval(lvl.find("w:numFmt", NS), "decimal")
            start = _wval(lvl.find("w:start", NS), "1")
            out[int(lvl.get(q("w:ilvl"), "0"))] = (None if fmt == "none" else fmt != "bullet",
                                                    int(start) if start.isdigit() else 1)
        return out

    def item(self, num_id, ilvl):
        """(ordered?, number) for the next item of list num_id at level ilvl; ordered None = not shown as a list."""
        ordered, start = self.levels.get(num_id, {}).get(ilvl, (False, 1))
        counts = self.counters.setdefault(num_id, {})
        for deeper in [k for k in counts if k > ilvl]:
            del counts[deeper]
        counts[ilvl] = counts.get(ilvl, start - 1) + 1
        return ordered, counts[ilvl]


class _Docx:
    def __init__(self, z, att_base, stem, warnings):
        self.z, self.warnings = z, warnings
        self.styles = _Styles(_xml(z, "word/styles.xml"))
        self.numbering = _Numbering(_xml(z, "word/numbering.xml"))
        self.rels = _rels(z, "word/document.xml")
        self.images = Images(att_base, stem)
        self.blocks = []
        self.widths = {}          # list level → its marker's width, for nesting
        self.counts = {"footnotes": 0, "math": 0, "linked_images": 0, "odd_images": 0, "comments": 0}

    # ---- blocks ----
    def body(self, el, cell=False):
        for child in el:
            tag = child.tag
            if tag == q("w:p"):
                self.paragraph(child)
            elif tag == q("w:tbl"):
                self.table(child)
            elif tag in (q("w:sdt"),):
                inner = child.find("w:sdtContent", NS)
                if inner is not None:
                    self.body(inner)
            elif tag in (q("w:customXml"), q("w:ins")):
                self.body(child)
            elif tag == q("mc:AlternateContent"):
                pick = child.find("mc:Choice", NS)
                if pick is None:
                    pick = child.find("mc:Fallback", NS)
                if pick is not None:
                    self.body(pick)

    def _list_end(self):
        self.widths = {}

    def paragraph(self, p):
        ppr = p.find("w:pPr", NS)
        sid = _wval(ppr.find("w:pStyle", NS)) if ppr is not None else None
        pieces = self.runs(p, self.styles.run_fmt(sid) if sid else {})
        level = self.styles.heading(sid)
        if ppr is not None and level is None:
            ol = _wval(ppr.find("w:outlineLvl", NS))
            if ol and ol.isdigit() and int(ol) < 9:
                level = min(int(ol) + 1, 6)
        num = ppr.find("w:numPr", NS) if ppr is not None else None
        if num is None and level is None:
            num = self.styles.num_pr(sid)
        list_info = None
        if num is not None:
            num_id = _wval(num.find("w:numId", NS))
            ilvl = int(_wval(num.find("w:ilvl", NS), "0") or 0)
            if num_id and num_id != "0":
                list_info = (num_id, ilvl)
        elif level is None and sid:
            name = self.styles.name(sid)
            if name.startswith("list bullet") or name.startswith("list number"):
                m = re.search(r"(\d)$", name)
                list_info = ("style:" + name.rstrip("0123456789 "), int(m.group(1)) - 1 if m else 0)
                self.numbering.levels.setdefault(list_info[0], {})[list_info[1]] = (name.startswith("list number"), 1)
        if level is not None:
            list_info = None
        self.emit(pieces, level, list_info)

    def emit(self, pieces, level=None, list_info=None, quote=False):
        """pieces: Segs and ("img", file) → blocks. A paragraph with images is split around them."""
        groups, cur = [], []
        for x in pieces:
            if isinstance(x, tuple):
                groups.append(cur)
                groups.append(x)
                cur = []
            else:
                cur.append(x)
        groups.append(cur)
        first = True
        for g in groups:
            if isinstance(g, tuple) and g[0] == "blocks":   # a text box's paragraphs, after the text around it
                self.blocks += g[1]
                continue
            if isinstance(g, tuple):
                self.blocks.append(("img", f"![[{g[1]}]]"))
                if not list_info:
                    self._list_end()
                continue
            if level:
                for s in g:
                    s.b = False   # a heading is bold already
            text = render_inline(g)
            if not text.strip():
                continue
            if level:
                self._list_end()
                self.blocks.append(("h", "#" * level + " " + text.replace("\n", " ")))
            elif list_info and first:
                self.list_item(text, *list_info)
                first = False
            elif task_box(text):   # "☐ Buy milk" → "- [ ] Buy milk", a task in NeuroVault
                self._list_end()
                box, rest = task_box(text)
                self.blocks.append(("li:tasks", f"- {box} " + esc_line_start(rest.replace("\n", " "))))
            else:
                if not list_info:
                    self._list_end()
                lines = [esc_line_start(ln) for ln in text.split("\n")]
                self.blocks.append(("p", "\n".join(lines)))

    def list_item(self, text, num_id, ilvl):
        ordered, n = self.numbering.item(num_id, ilvl)
        if ordered is None:
            self.blocks.append(("p", esc_line_start(text)))
            return
        for deeper in [k for k in self.widths if k > ilvl]:
            del self.widths[deeper]
        marker = f"{n}." if ordered else "-"
        indent = sum(self.widths.get(k, 3) for k in range(ilvl))
        self.widths[ilvl] = len(marker) + 1
        pad = " " * (indent + len(marker) + 1)
        box = task_box(text)
        if box:
            text = box[1]
        lines = text.split("\n")
        body = (lines[0] if lines[0] else "") + "".join("\n" + pad + esc_line_start(ln) for ln in lines[1:])
        first = (box[0] + " " + body) if box else esc_line_start(body)
        self.blocks.append(("li:" + num_id, " " * indent + marker + " " + first if body.strip() else ""))

    def table(self, tbl):
        self._list_end()
        rows, plain = [], []
        for tr in tbl.findall("w:tr", NS):
            row, prow = [], []
            for tc in tr.findall("w:tc", NS):
                tcpr = tc.find("w:tcPr", NS)
                span, cont = 1, False
                if tcpr is not None:
                    gs = tcpr.find("w:gridSpan", NS)
                    span = int(_wval(gs, "1")) if gs is not None and _wval(gs, "1").isdigit() else 1
                    vm = tcpr.find("w:vMerge", NS)
                    cont = vm is not None and _wval(vm, "continue") != "restart"
                md, text = ("", "") if cont else self.cell(tc)
                row += [md] + [""] * (span - 1)
                prow += [text] + [""] * (span - 1)
            rows.append(row)
            plain.append(prow)
        if len(rows) == 1 and len(rows[0]) == 1:   # a one-cell table is a box around text: keep the text
            sub = _Docx.__new__(_Docx)
            sub.__dict__.update(self.__dict__)
            sub.blocks, sub.widths = [], {}
            sub.body(tbl.find("w:tr", NS).find("w:tc", NS))
            self.blocks += sub.blocks
            return
        md = table_md(rows)
        if md:
            self.blocks.append(("table", md))
            self.blocks.append(self.images.table_slot(plain))

    def cell(self, tc):
        """(Markdown for the table, plain text for its CSV)."""
        parts, plain = [], []
        for el in tc.iter():
            if el.tag != q("w:p"):
                continue
            pieces = self.runs(el, {})
            extra = [f"![[{x[1]}]]" for x in pieces if isinstance(x, tuple) and x[0] == "img"]
            extra += [re.sub(r"\s*\n\s*", " ", t) for x in pieces if isinstance(x, tuple) and x[0] == "blocks" for _, t in x[1]]
            text = " ".join(extra)
            line = render_inline([x for x in pieces if not isinstance(x, tuple)], table=True)
            ppr = el.find("w:pPr", NS)
            if ppr is not None and ppr.find("w:numPr", NS) is not None and line:
                line = "• " + line
            if line or text:
                parts.append((line + (" " + text if line and text else text)).strip())
            words = "".join(x.text for x in pieces if isinstance(x, Seg)).strip()
            if words:
                plain.append(("• " if line.startswith("• ") else "") + re.sub(r"[ \t]+", " ", words))
        return "<br>".join(parts), "\n".join(plain)

    # ---- runs ----
    def runs(self, p, base):
        out, fields = [], []
        self._walk(p, dict(base), None, out, fields)
        return out

    def _walk(self, el, fmt, href, out, fields):
        for child in el:
            tag = child.tag
            if tag == q("w:pPr"):
                continue
            if tag == q("w:r"):
                self._run(child, fmt, href, out, fields)
            elif tag == q("w:hyperlink"):
                rid = child.get(q("r:id"))
                link = self.rels.get(rid, (None, False))[0] if rid else None
                self._walk(child, fmt, link or href, out, fields)
            elif tag == q("w:fldSimple"):
                m = re.search(r'HYPERLINK\s+"([^"]+)"', child.get(q("w:instr"), ""))
                self._walk(child, fmt, m.group(1) if m else href, out, fields)
            elif tag in (q("w:ins"), q("w:smartTag"), q("w:customXml"), q("w:moveTo"), q("w:bdo"), q("w:dir")):
                self._walk(child, fmt, href, out, fields)
            elif tag == q("w:sdt"):
                inner = child.find("w:sdtContent", NS)
                if inner is not None:
                    self._walk(inner, fmt, href, out, fields)
            elif tag == q("mc:AlternateContent"):
                pick = child.find("mc:Choice", NS)
                if pick is None:
                    pick = child.find("mc:Fallback", NS)
                if pick is not None:
                    self._walk(pick, fmt, href, out, fields)
            elif tag in (q("m:oMath"), q("m:oMathPara")):
                self.counts["math"] += 1

    def _run(self, r, fmt, href, out, fields):
        rpr = r.find("w:rPr", NS)
        f = dict(fmt)
        if rpr is not None:
            rs = _wval(rpr.find("w:rStyle", NS))
            if rs:
                f.update(self.styles.run_fmt(rs))
            f.update(_rpr_fmt(rpr))
        if f.get("hidden"):
            return
        for child in r:
            tag = child.tag
            if tag == q("w:fldChar"):
                kind = child.get(q("w:fldCharType"))
                if kind == "begin":
                    fields.append({"instr": "", "phase": "code", "href": None})
                elif kind == "separate" and fields:
                    fld = fields[-1]
                    fld["phase"] = "result"
                    m = re.search(r'HYPERLINK\s+"([^"]+)"', fld["instr"])
                    fld["href"] = m.group(1) if m else None
                elif kind == "end" and fields:
                    fields.pop()
                continue
            if tag == q("w:instrText"):
                if fields:
                    fields[-1]["instr"] += child.text or ""
                continue
            if any(fl["phase"] == "code" for fl in fields):
                continue
            link = next((fl["href"] for fl in reversed(fields) if fl["href"]), None) or href
            seg = lambda text: Seg(text, f.get("b", False), f.get("i", False), f.get("s", False), link, f.get("code", False))
            if tag == q("w:t"):
                out.append(seg(child.text or ""))
            elif tag == q("w:tab"):
                out.append(seg(" "))
            elif tag in (q("w:br"), q("w:cr")):
                if child.get(q("w:type")) not in ("page", "column"):
                    out.append(seg("\n"))
            elif tag == q("w:noBreakHyphen"):
                out.append(seg("-"))
            elif tag == q("w:footnoteReference") or tag == q("w:endnoteReference"):
                self.counts["footnotes"] += 1
            elif tag in (q("w:drawing"), q("w:pict"), q("w:object")):
                self._image(child, out)
            elif tag == q("mc:AlternateContent"):
                pick = child.find("mc:Choice", NS)
                if pick is None:
                    pick = child.find("mc:Fallback", NS)
                for sub in (pick if pick is not None else []):
                    if sub.tag in (q("w:drawing"), q("w:pict")):
                        self._image(sub, out)

    def _image(self, el, out):
        rids = [b.get(q("r:embed")) for b in el.iter(q("a:blip")) if b.get(q("r:embed"))]
        rids += [b.get(q("r:id")) for b in el.iter(q("v:imagedata")) if b.get(q("r:id"))]
        if not rids and any(True for _ in el.iter(q("a:blip"))):
            self.counts["linked_images"] += 1
        for rid in rids[:1]:
            target, external = self.rels.get(rid, (None, False))
            if not target or external:
                self.counts["linked_images"] += 1
                continue
            ext = os.path.splitext(target)[1].lower() or ".png"
            if ext not in WEB_IMAGES:
                self.counts["odd_images"] += 1
            try:
                data = self.z.read(target)
            except KeyError:
                continue
            file = self.images.add(data, ext, key=target)
            if file:
                out.append(("img", file))
        for box in el.iter(q("w:txbxContent")):   # a text box: its text follows as paragraphs
            sub = _Docx.__new__(_Docx)
            sub.__dict__.update(self.__dict__)
            sub.blocks, sub.widths = [], {}
            sub.body(box)
            if sub.blocks:
                out.append(("blocks", sub.blocks))

    def warn(self):
        c = self.counts
        if c["footnotes"]:
            self.warnings.append(f"{c['footnotes']} footnote{'s' if c['footnotes'] > 1 else ''} left out.")
        if c["math"]:
            self.warnings.append(f"{c['math']} equation{'s' if c['math'] > 1 else ''} left out.")
        if c["linked_images"]:
            self.warnings.append(f"{c['linked_images']} linked image{'s' if c['linked_images'] > 1 else ''} left out "
                                 "(the file only points to it).")
        if c["odd_images"]:
            self.warnings.append(f"{c['odd_images']} image{'s are' if c['odd_images'] > 1 else ' is'} in a Windows-only "
                                 "format (EMF or WMF) and may not show in the note.")


def docx_to_markdown(path, att_base=None, progress=None, cancel=None, table_stem=None):
    """A Word document (.docx) → {markdown, title, images, warnings}. See the module's docstring."""
    _check_file(path, "text")
    if os.path.splitext(path)[1].lower() == ".doc":
        raise ConvertError("Old .doc files can't be converted. Open it in Word and save it as .docx first.")
    try:
        z = zipfile.ZipFile(path)
    except (zipfile.BadZipFile, OSError):
        raise ConvertError(f"{os.path.basename(path)} isn't a Word document, or it's damaged.")
    warnings = []
    with z:
        try:
            doc = _xml(z, "word/document.xml")
        except ET.ParseError:
            doc = None
        if doc is None:
            raise ConvertError(f"{os.path.basename(path)} isn't a Word document, or it's damaged.")
        _tick(progress, cancel, 0, 1, "Reading the document")
        d = _Docx(z, att_base, _stem(path), warnings)
        try:
            body = doc.find("w:body", NS)
            if body is not None:
                d.body(body)
            d.warn()
            title = ""
            core = _xml(z, "docProps/core.xml")
            if core is not None:
                t = core.find("dc:title", NS)
                title = (t.text or "").strip() if t is not None else ""
            if not title:
                first = next((t for k, t in d.blocks if k == "h"), "")
                title = re.sub(r"^#+\s*", "", first).replace("\\", "").strip()
            if not title:
                title = os.path.splitext(os.path.basename(path))[0]
            out = _finish(d.blocks, title, d.images, warnings, table_stem=table_stem)
            if not out["markdown"].strip():
                warnings.append("This document has no text to convert.")
            _tick(progress, cancel, 1, 1, "Done")
            return out
        except BaseException:
            d.images.undo()
            raise


# =====================================================================================================================
# PDF: pdfplumber (pdfminer.six) words, laid out by this module
# =====================================================================================================================

def pdf_available():
    try:
        import pdfplumber  # noqa: F401
        return True
    except Exception:
        return False


def pdf_to_markdown(path, att_base=None, progress=None, cancel=None, table_stem=None):
    """A PDF → {markdown, title, images, warnings, pages}. See the module's docstring."""
    _check_file(path, "text")
    if not pdf_available():
        raise ConvertError("Converting PDFs needs the pdfplumber package, which isn't installed yet.")
    import pdf_layout
    return pdf_layout.convert(path, att_base, progress, cancel, table_stem)


def convert(path, att_base=None, progress=None, cancel=None, table_stem=None):
    """Either converter, by the file's extension."""
    kind = kind_of(path)
    if os.path.splitext(str(path or ""))[1].lower() == ".doc":
        raise ConvertError("Old .doc files can't be converted. Open it in Word and save it as .docx first.")
    if kind == "pdf":
        return pdf_to_markdown(path, att_base, progress, cancel, table_stem)
    if kind == "docx":
        return docx_to_markdown(path, att_base, progress, cancel, table_stem)
    raise ConvertError("Only PDF and Word (.docx) files can be converted to Markdown.")


# =====================================================================================================================
# Background jobs: the page starts one, then polls it for "page N of M"
# =====================================================================================================================

class Jobs:
    """job(id) → {id, state: running | done | error | cancelled, done, total, label, result, message}."""

    def __init__(self, keep=20):
        self.jobs, self._lock, self._seq, self._keep, self._cancel = {}, threading.Lock(), 0, keep, {}

    def start(self, fn, wait=False):
        """Runs fn(progress, cancel) in a thread (or now, with wait=True) and returns the job's id."""
        with self._lock:
            self._seq += 1
            jid = f"convert-{self._seq}"
            self.jobs[jid] = {"id": jid, "state": "running", "done": 0, "total": 0, "label": "Starting",
                              "result": None, "message": ""}
            self._cancel[jid] = threading.Event()
            for old in list(self.jobs)[:-self._keep]:
                self.jobs.pop(old, None)
                self._cancel.pop(old, None)
        job, stop = self.jobs[jid], self._cancel[jid]

        def progress(done, total, label=""):
            job.update(done=done, total=total, label=label)

        def go():
            try:
                job.update(state="done", result=fn(progress, stop.is_set))
            except Cancelled:
                job.update(state="cancelled", message="Cancelled.")
            except ConvertError as e:
                job.update(state="error", message=plain_error(e))
            except Exception as e:
                log.exception("conversion %s failed", jid)
                job.update(state="error", message=plain_error(e, "convert the file"))
        if wait:
            go()
        else:
            threading.Thread(target=go, daemon=True, name=jid).start()
        return jid

    def get(self, jid):
        j = self.jobs.get(jid)
        return dict(j) if j else None

    def cancel(self, jid):
        ev = self._cancel.get(jid)
        if ev is None:
            return False
        ev.set()
        return True


# =====================================================================================================================
# Build M · R57 (feedback: "I want to be able to add xlsx files and convert to md(html)"; r57-xflow one dialog, r57-xrows the
# first 500 rows in the note and every row in a CSV per sheet, hidden sheets skipped). A workbook read with the standard
# library only (zipfile + ElementTree, the sheets streamed with iterparse): each sheet you pick becomes a heading and a table,
# Markdown, or a rich (HTML) table when it has merged cells (R48's rule); values as Excel showed them (cached formula
# results, numbers and dates through their number formats); the first 500 rows in the note and every row in
# "<workbook> · <sheet>.csv" in attachments/. The original file is only read.
# =====================================================================================================================
import datetime as _dt  # noqa: E402

XLSX_ROWS_IN_NOTE = 500
EXTS[".xlsx"] = "xlsx"
EXTS[".xlsm"] = "xlsx"
_XM = "http://schemas.openxmlformats.org/spreadsheetml/2006/main"
_XR = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
_PR = "http://schemas.openxmlformats.org/package/2006/relationships"
_BUILTIN_FMT = {0: "General", 1: "0", 2: "0.00", 3: "#,##0", 4: "#,##0.00", 9: "0%", 10: "0.00%", 11: "0.00E+00", 12: "General", 13: "General",
                14: "dd/mm/yyyy", 15: "d-mmm-yy", 16: "d-mmm", 17: "mmm-yy", 18: "h:mm AM/PM", 19: "h:mm:ss AM/PM", 20: "hh:mm", 21: "hh:mm:ss", 22: "dd/mm/yyyy hh:mm",
                37: "#,##0;(#,##0)", 38: "#,##0;(#,##0)", 39: "#,##0.00;(#,##0.00)", 40: "#,##0.00;(#,##0.00)", 45: "mm:ss", 46: "[h]:mm:ss", 47: "mm:ss",
                48: "0.0E+0", 49: "@"}


def _xq(tag, ns=_XM):
    return f"{{{ns}}}{tag}"


def _col_index(ref):
    """"C12" → 2 (0-based column)."""
    n = 0
    for ch in ref:
        if not ch.isalpha():
            break
        n = n * 26 + (ord(ch.upper()) - 64)
    return n - 1


def _cell_rc(ref):
    m = re.match(r"([A-Za-z]+)(\d+)$", ref or "")
    return (int(m.group(2)) - 1, _col_index(m.group(1))) if m else (None, None)


class _Fmt:
    """Excel number formats, as far as a note needs them: dates and times, percentages, decimals, thousands, currency."""

    def __init__(self, z):
        self.codes, self.xf, self.date1904 = dict(_BUILTIN_FMT), [], False
        try:
            st = ET.fromstring(z.read("xl/styles.xml"))
            for nf in st.iter(_xq("numFmt")):
                self.codes[int(nf.get("numFmtId"))] = nf.get("formatCode") or "General"
            xfs = st.find(_xq("cellXfs"))
            self.xf = [int(x.get("numFmtId") or 0) for x in (xfs if xfs is not None else [])]
        except (KeyError, ET.ParseError, ValueError):
            pass
        try:
            wb = ET.fromstring(z.read("xl/workbook.xml"))
            pr = wb.find(_xq("workbookPr"))
            self.date1904 = pr is not None and pr.get("date1904") in ("1", "true")
        except (KeyError, ET.ParseError):
            pass

    def code(self, style):
        try:
            return self.codes.get(self.xf[int(style)], "General") if style is not None else "General"
        except (IndexError, ValueError):
            return "General"

    @staticmethod
    def _plain(code):
        """The code without quoted text, escapes, colours and conditions: what decides its kind."""
        return re.sub(r'"[^"]*"|\\.|\[(?!h\]|m\]|s\])[^\]]*\]|_.|\*.', "", code)

    def is_date(self, code):
        p = self._plain(code.split(";")[0]).lower()
        return bool(re.search(r"[dyhs]", p)) or (bool(re.search(r"m", p)) and not re.search(r"[0#?]", p))

    _DTOK = re.compile(r'yyyy|yy|mmmmm|mmmm|mmm|mm|m|dddd|ddd|dd|d|hh|h|ss|s|am/pm|a/p|"[^"]*"|\\.|\[h+\]|.', re.I)

    def date(self, v, code):
        """The date or time as the format code writes it (14 = dd/mm/yyyy, as Excel shows it in the UK)."""
        base = _dt.datetime(1904, 1, 1) if self.date1904 else _dt.datetime(1899, 12, 30)
        try:
            d = base + _dt.timedelta(days=float(v))
        except (OverflowError, ValueError):
            return str(v)
        sec = re.sub(r"\[(?!h+\])[^\]]*\]", "", code.split(";")[0])
        toks = self._DTOK.findall(sec)
        ampm = any(t.lower() in ("am/pm", "a/p") for t in toks)
        kinds = [t.lower() for t in toks]
        out = []
        for i, t in enumerate(toks):
            k = kinds[i]
            prev = next((kinds[j] for j in range(i - 1, -1, -1) if kinds[j][0] in "hsdym" and not kinds[j].startswith('"')), "")
            nxt = next((kinds[j] for j in range(i + 1, len(kinds)) if kinds[j][0] in "hsdym" and not kinds[j].startswith('"')), "")
            if k in ("m", "mm") and (prev.startswith("h") or nxt.startswith("s")):
                out.append(f"{d.minute:02d}" if k == "mm" else str(d.minute))
            elif k == "yyyy":
                out.append(f"{d.year:04d}")
            elif k == "yy":
                out.append(f"{d.year % 100:02d}")
            elif k == "mmmmm":
                out.append(d.strftime("%B")[0])
            elif k == "mmmm":
                out.append(d.strftime("%B"))
            elif k == "mmm":
                out.append(d.strftime("%b"))
            elif k == "mm":
                out.append(f"{d.month:02d}")
            elif k == "m":
                out.append(str(d.month))
            elif k == "dddd":
                out.append(d.strftime("%A"))
            elif k == "ddd":
                out.append(d.strftime("%a"))
            elif k == "dd":
                out.append(f"{d.day:02d}")
            elif k == "d":
                out.append(str(d.day))
            elif k.startswith("[h"):
                out.append(str(int(float(v) * 24)))
            elif k in ("hh", "h"):
                h = d.hour % 12 or 12 if ampm else d.hour
                out.append(f"{h:02d}" if k == "hh" else str(h))
            elif k == "ss":
                out.append(f"{d.second:02d}")
            elif k == "s":
                out.append(str(d.second))
            elif k in ("am/pm", "a/p"):
                pm = d.hour >= 12
                out.append(("PM" if pm else "AM") if k == "am/pm" else ("P" if pm else "A"))
            elif t.startswith('"'):
                out.append(t[1:-1])
            elif t.startswith("\\"):
                out.append(t[1:])
            else:
                out.append(t)
        return "".join(out).strip()

    def number(self, v, code):
        try:
            x = float(v)
        except ValueError:
            return str(v)
        if code in ("General", "@") or not code:
            return str(int(x)) if x.is_integer() and abs(x) < 1e15 else f"{x:.10g}"
        if self.is_date(code):
            return self.date(x, code)
        parts = re.findall(r'(?:"[^"]*"|[^;])+', code)
        sec = parts[1] if x < 0 and len(parts) > 1 else parts[0]
        neg_paren = x < 0 and len(parts) > 1 and "(" in sec
        cur = re.search(r"\[\$([^\]-]*)", sec)
        sym = cur.group(1) if cur else ""
        lit = "".join(re.findall(r'"([^"]*)"', sec)) + "".join(re.findall(r"\\(.)", sec))
        plain = self._plain(sec)
        sym = sym or "".join(c for c in plain + lit if c in "£$€¥₹")
        if "E+" in plain.upper():
            dec = len(re.search(r"\.([0#]*)", plain).group(1)) if "." in plain else 0
            return f"{x:.{dec}E}"
        pct = "%" in plain
        if pct:
            x *= 100
        num = re.search(r"[#0?,]*\.?[0#?]*", re.sub(r"[^#0?,.]", " ", plain).strip() or "0")
        tok = num.group(0) if num else "0"
        dec = len(tok.split(".")[1]) if "." in tok else 0
        body = f"{abs(x):,.{dec}f}" if "," in tok.split(".")[0] else f"{abs(x):.{dec}f}"
        s = f"{sym}{body}{'%' if pct else ''}"
        if x < 0:
            s = f"({s})" if neg_paren else f"-{s}"
        return s


def _shared_strings(z):
    try:
        root = ET.fromstring(z.read("xl/sharedStrings.xml"))
    except KeyError:
        return []
    out = []
    for si in root.iter(_xq("si")):
        out.append("".join(t.text or "" for t in si.iter(_xq("t")) if not any(t in rph.iter() for rph in si.iter(_xq("rPh")))))
    return out


def _sheet_list(z):
    """[{name, path, hidden}] in the workbook's order."""
    try:
        wb = ET.fromstring(z.read("xl/workbook.xml"))
        rels = ET.fromstring(z.read("xl/_rels/workbook.xml.rels"))
    except (KeyError, ET.ParseError) as e:
        raise ConvertError("This doesn't look like an Excel workbook (.xlsx).") from e
    target = {r.get("Id"): r.get("Target") for r in rels.iter(_xq("Relationship", _PR))}
    out = []
    for s in wb.iter(_xq("sheet")):
        t = target.get(s.get(_xq("id", _XR)), "")
        if not t:
            continue
        path = t.lstrip("/") if t.startswith("/") else "xl/" + t
        out.append({"name": s.get("name") or f"Sheet {len(out) + 1}", "path": os.path.normpath(path).replace("\\", "/"),
                    "hidden": (s.get("state") or "visible") != "visible"})
    return out


def _open_xlsx(path):
    _check_file(path, "sheet")
    try:
        return zipfile.ZipFile(path)
    except (zipfile.BadZipFile, OSError) as e:
        raise ConvertError(f"{os.path.basename(path)} couldn't be opened as an Excel workbook: is it password-protected or damaged?") from e


def _read_sheet(z, path, sst, fmt, cancel=None):
    """(rows: [[str]], merges: [(r0, c0, r1, c1)], formulas: bool), trailing empty rows and columns trimmed."""
    rows, merges, formulas, n = {}, [], False, 0
    with z.open(path) as f:
        for ev, el in ET.iterparse(f, events=("end",)):
            tag = el.tag
            if tag == _xq("c"):
                r, c = _cell_rc(el.get("r"))
                t, v, text = el.get("t") or "n", el.find(_xq("v")), None
                if el.find(_xq("f")) is not None:
                    formulas = True
                if t == "s" and v is not None:
                    try:
                        text = sst[int(v.text)]
                    except (IndexError, ValueError, TypeError):
                        text = ""
                elif t == "inlineStr":
                    text = "".join(x.text or "" for x in el.iter(_xq("t")))
                elif t == "b" and v is not None:
                    text = "TRUE" if v.text == "1" else "FALSE"
                elif t in ("str", "e") and v is not None:
                    text = v.text or ""
                elif t == "d" and v is not None:
                    text = (v.text or "")[:10]
                elif v is not None and v.text is not None:
                    text = fmt.number(v.text, fmt.code(el.get("s")))
                if r is not None and text not in (None, ""):
                    rows.setdefault(r, {})[c] = text
                el.clear()
            elif tag == _xq("row"):
                n += 1
                if cancel and n % 2000 == 0 and cancel():
                    raise Cancelled()
                el.clear()
            elif tag == _xq("mergeCell"):
                a, _, b = (el.get("ref") or "").partition(":")
                r0, c0 = _cell_rc(a)
                r1, c1 = _cell_rc(b or a)
                if r0 is not None and r1 is not None:
                    merges.append((r0, c0, r1, c1))
    if not rows:
        return [], [], formulas
    last_r = max(rows)
    width = max(max(cs) for cs in rows.values()) + 1
    first_r = min(rows)
    grid = [[rows.get(r, {}).get(c, "") for c in range(width)] for r in range(first_r, last_r + 1)]
    merges = [(r0 - first_r, c0, r1 - first_r, c1) for (r0, c0, r1, c1) in merges if r0 >= first_r]
    return grid, merges, formulas


def xlsx_info(path):
    """The dialog's sheet list: {sheets: [{name, hidden, rows, cols, merged}], size}."""
    with _open_xlsx(path) as z:
        out = []
        for s in _sheet_list(z):
            rows = cols = merged = 0
            try:
                with z.open(s["path"]) as f:
                    for ev, el in ET.iterparse(f, events=("end",)):
                        if el.tag == _xq("dimension") and el.get("ref"):
                            a, _, b = el.get("ref").partition(":")
                            r0, c0 = _cell_rc(a)
                            r1, c1 = _cell_rc(b or a)
                            if r0 is not None and r1 is not None:
                                rows, cols = r1 - r0 + 1, c1 - c0 + 1
                        elif el.tag == _xq("row"):
                            el.clear()
                        elif el.tag == _xq("mergeCell"):
                            merged += 1
            except (KeyError, ET.ParseError):
                pass
            out.append({"name": s["name"], "hidden": s["hidden"], "rows": rows, "cols": cols, "merged": merged})
    return {"sheets": out, "size": os.path.getsize(path)}


def _md_cell(text):
    return esc(str(text)).replace("|", "\\|").replace("\r\n", "\n").replace("\n", "<br>")


def _numeric(text):
    return bool(re.fullmatch(r"\(?[-+]?[£$€¥₹]?-?[\d,]*\.?\d+(?:[eE][-+]?\d+)?%?\)?", text.strip())) if text.strip() else None


def _sheet_md(grid):
    """A GFM table, the first row the header; a column of numbers is right-aligned."""
    width = len(grid[0])
    right = []
    for c in range(width):
        vals = [_numeric(r[c]) for r in grid[1:] if r[c].strip()]
        right.append(bool(vals) and all(vals))
    lines = ["| " + " | ".join(_md_cell(x) for x in grid[0]) + " |", "|" + "|".join(" ---: " if right[c] else " --- " for c in range(width)) + "|"]
    lines += ["| " + " | ".join(_md_cell(x) for x in r) + " |" for r in grid[1:]]
    return "\n".join(lines)


def _html_cell(text):
    return str(text).replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace("\r\n", "\n").replace("\n", "<br>")


def _sheet_html(grid, merges):
    """A rich table as the editor saves one (markdown.js richTableToMd): merged cells as colspan / rowspan."""
    span, covered = {}, set()
    for (r0, c0, r1, c1) in merges:
        if r0 >= len(grid):
            continue
        r1, c1 = min(r1, len(grid) - 1), min(c1, len(grid[0]) - 1)
        span[(r0, c0)] = (r1 - r0 + 1, c1 - c0 + 1)
        covered |= {(r, c) for r in range(r0, r1 + 1) for c in range(c0, c1 + 1)} - {(r0, c0)}
    head_rows = 1 + max([rs - 1 for (r, c), (rs, cs) in span.items() if r == 0] or [0])
    out = ['<table data-nv-borders="all">']
    for r, row in enumerate(grid):
        out.append("  <tr>")
        for c, text in enumerate(row):
            if (r, c) in covered:
                continue
            tag = "th" if r < head_rows else "td"
            rs, cs = span.get((r, c), (1, 1))
            al = ' style="text-align:right"' if tag == "td" and _numeric(text) else ""
            out.append(f"    <{tag}{f' colspan={chr(34)}{cs}{chr(34)}' if cs > 1 else ''}{f' rowspan={chr(34)}{rs}{chr(34)}' if rs > 1 else ''}{al}>{_html_cell(text)}</{tag}>")
        out.append("  </tr>")
    out.append("</table>")
    return "\n".join(out)


def xlsx_to_markdown(path, att_base=None, progress=None, cancel=None, table_stem=None, sheets=None, cap=XLSX_ROWS_IN_NOTE):
    """The workbook as a note: for each sheet picked (sheets: names; None = every sheet that isn't hidden), a heading and a
    table (the first `cap` rows under its header), and every row in "<workbook> · <sheet>.csv" in attachments/."""
    title = os.path.splitext(os.path.basename(path))[0]
    stem, warnings, blocks = table_stem or title, [], []
    images = Images(att_base, _stem(path))
    with _open_xlsx(path) as z:
        listed = _sheet_list(z)
        pick = [s for s in listed if (s["name"] in sheets if sheets is not None else not s["hidden"])]
        if not pick:
            raise ConvertError("Pick at least one sheet to convert." if sheets is not None else "Every sheet in this workbook is hidden: pick the ones to convert.")
        skipped = [s["name"] for s in listed if s["hidden"] and s not in pick]
        sst, fmt, formulas = _shared_strings(z), _Fmt(z), False
        has_drawings = any(n.startswith("xl/drawings/") or n.startswith("xl/charts/") for n in z.namelist())
        try:
            for i, s in enumerate(pick):
                _tick(progress, cancel, i, len(pick), f"Sheet {i + 1} of {len(pick)}: {s['name']}")
                grid, merges, f = _read_sheet(z, s["path"], sst, fmt, cancel)
                formulas = formulas or f
                blocks.append(("h", "## " + esc(s["name"])))
                if not grid:
                    blocks.append(("p", "*This sheet is empty.*"))
                    continue
                data = len(grid) - 1
                shown = grid[:cap + 1]
                rich = any(r0 <= len(shown) - 1 for (r0, c0, r1, c1) in merges if (r1 > r0 or c1 > c0))
                blocks.append(("table", _sheet_html(shown, merges) if rich else _sheet_md(shown)))
                file = None
                if att_base is not None:
                    attachments.folder(att_base, create=True)
                    buf = io.StringIO()
                    csv.writer(buf, lineterminator="\r\n").writerows(grid)
                    raw = buf.getvalue().encode("utf-8-sig")
                    name = attachments.unique_name(att_base, safe_name(f"{stem} · {s['name']}", 70), ".csv")
                    with open(os.path.join(attachments.folder(att_base), name), "wb") as fh:
                        fh.write(raw)
                    file = f"{attachments.DIR}/{name}"
                    images.tables.append({"file": file, "name": name, "size": len(raw), "rows": len(grid), "cols": len(grid[0]), "sheet": s["name"]})
                if data > cap:
                    blocks.append(("p", f"*The first {cap:,} of {data:,} rows. Every row is in the attached file:*"))
                    if file:
                        blocks.append(("embed", f"![[{file}]]"))
                elif file:
                    blocks.append(("comment", f"<!-- ![[{file}]] -->"))
        except Exception:
            images.undo()
            raise
        _tick(progress, cancel, len(pick), len(pick), "Done")
    if formulas:
        warnings.append("Formulas show the value Excel last saved, not the formula.")
    if skipped:
        warnings.append(f"Hidden sheet{'s' if len(skipped) > 1 else ''} left out: {', '.join(skipped)}.")
    if has_drawings:
        warnings.append("Charts and pictures in the workbook aren't converted; the workbook stays attached.")
    return {"markdown": join_blocks(blocks), "title": title, "images": [], "tables": list(images.tables), "warnings": warnings,
            "sheets": [s["name"] for s in pick]}


_convert_before_xlsx = convert


def convert(path, att_base=None, progress=None, cancel=None, table_stem=None, sheets=None):  # noqa: F811
    """Either converter, by the file's extension; a workbook takes the sheets picked (None: every sheet that isn't hidden)."""
    if kind_of(path) == "xlsx":
        return xlsx_to_markdown(path, att_base, progress, cancel, table_stem, sheets)
    return _convert_before_xlsx(path, att_base, progress, cancel, table_stem)
# ==== end Build M · R57 ====
