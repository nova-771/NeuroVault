"""
pdf_layout.py: a PDF's words laid out as Markdown (Build K, called by converters.pdf_to_markdown).

pdfplumber (pdfminer.six) gives each word with its place, font and size; this module turns those into blocks:

    pass 1, a page at a time ("Page N of M"): words, ruled tables (find_tables), links, images (saved to attachments/)
    pass 2, the whole file: the body text size (the most common), heading sizes (bigger than the body, biggest = #),
            running headers / footers and page numbers (dropped), then each page:
              columns: a gap that no line crosses splits the page into columns, read left then right; a heading or
                       picture across the gap starts a new band, so a two-column article reads in the right order
              lines → paragraphs (by the space between lines), bullet and numbered items (nested by indent),
              bold / italic / monospace by font name, links by the link areas, words split by a hyphen joined again
            and a "---" between pages.

A page with no text but a picture over most of it is a scan: its picture is kept, with a warning. When every page is a
scan, nothing is written and the result says "This PDF is a scan: no text to convert". No OCR.
"""
import hashlib
import io
import logging
import os
import re
import unicodedata
from collections import Counter

from converters import (Cancelled, ConvertError, Images, Seg, _finish, _stem, _tick, esc, esc_line_start,  # noqa: F401
                        render_inline, table_md, task_box)

log = logging.getLogger(__name__)

BOLD_RE = re.compile(r"bold|black|heavy|semibold|demibold|extrabold|[-,]bd\b|[-,]b$", re.I)
ITALIC_RE = re.compile(r"italic|oblique|[-,]it\b|[-,]i$", re.I)
MONO_RE = re.compile(r"mono|courier|consol|menlo|inconsolata|sourcecode|source code|lucidaconsole", re.I)
BULLET_RE = re.compile(r"^[•◦▪▫‣⁃●○■□►▸➢➤✓✔–—*·\-]$")
BULLET_LEAD_RE = re.compile(r"^([•◦▪▫‣⁃●○■►▸➢➤·])(\S.*)$")
NUMBER_RE = re.compile(r"^(\d{1,3}|[a-zA-Z]|[ivxIVX]{1,5})[.)]$|^\((\d{1,3}|[a-zA-Z]|[ivxIVX]{1,5})\)$")
LABELS_ONLY_RE = re.compile(r"^(\(?\d{1,3}[.)]\s*)+$")
PAGE_NO_RE =re.compile(r"^\W*(page\s+)?\d{1,4}(\s*(of|/)\s*\d{1,4})?\W*$", re.I)
LIGATURES = {"ﬀ": "ff", "ﬁ": "fi", "ﬂ": "fl", "ﬃ": "ffi", "ﬄ": "ffl", "ﬅ": "st", "ﬆ": "st",
             "­": "", " ": " "}
CID_RE = re.compile(r"\(cid:\d+\)")
MIN_IMAGE_PT = 20      # smaller pictures are rules, bullets or icons
SCAN_COVER = 0.5       # a picture over half a page with no text: a scan
LABEL_COVER = 0.6      # text on a smaller picture is its labels (kept in the picture); on a bigger one, a background


class Item:
    """A thing on a page with a box: a line fragment (kind "text"), a table or a picture."""
    __slots__ = ("kind", "x0", "x1", "top", "bottom", "words", "size", "data")

    def __init__(self, kind, x0, x1, top, bottom, words=None, size=0.0, data=None):
        self.kind, self.x0, self.x1, self.top, self.bottom = kind, x0, x1, top, bottom
        self.words, self.size, self.data = words or [], size, data

    @property
    def text(self):
        return " ".join(w["text"] for w in self.words)


def _clean(text):
    for k, v in LIGATURES.items():
        text = text.replace(k, v)
    return text


# ---- pass 1: one page ----

def _page_data(page, n, images, counts):
    """{w, h, items: [Item], scan: bool} for one page (words, tables, pictures), with the pictures saved."""
    W, H = float(page.width), float(page.height)
    x_off, y_off = float(page.bbox[0]), float(page.bbox[1])
    try:
        words = page.extract_words(x_tolerance=2, y_tolerance=3, keep_blank_chars=False, use_text_flow=False,
                                   extra_attrs=["fontname", "size"])
    except Exception:
        log.exception("words on page %s", n)
        words, counts["bad_pages"] = [], counts["bad_pages"] + 1
    clean = []
    for w in words:
        t = _clean(w["text"])
        if CID_RE.search(t):
            counts["cid"] += 1
            t = CID_RE.sub("", t)
        if t.strip():
            clean.append({"text": t, "x0": float(w["x0"]) - x_off, "x1": float(w["x1"]) - x_off,
                          "top": float(w["top"]) - y_off, "bottom": float(w["bottom"]) - y_off,
                          "size": round(float(w.get("size") or 0), 1), "font": str(w.get("fontname") or "")})
    items = []
    # ruled tables: their words become the table
    try:
        tables = page.find_tables()
    except Exception:
        log.exception("tables on page %s", n)
        tables = []
    for tb in tables:
        try:
            rows = tb.extract()
        except Exception:
            continue
        rows = [[_clean(c or "").replace("\n", " ").strip() for c in r] for r in rows or []]
        rows = [r for r in rows if any(r)]
        if len(rows) < 2 or max(len(r) for r in rows) < 2:
            continue   # a box around text, not a table: its words stay text
        x0, top, x1, bottom = (float(v) for v in tb.bbox)
        x0, x1, top, bottom = x0 - x_off, x1 - x_off, top - y_off, bottom - y_off
        inside = lambda w: x0 - 1 <= (w["x0"] + w["x1"]) / 2 <= x1 + 1 and top - 1 <= (w["top"] + w["bottom"]) / 2 <= bottom + 1
        clean = [w for w in clean if not inside(w)]
        items.append(Item("table", x0, x1, top, bottom, data=rows))
    # links
    links = []
    for ln in getattr(page, "hyperlinks", None) or []:
        uri = ln.get("uri")
        if uri and re.match(r"^(https?:|mailto:|www\.)", str(uri), re.I):
            links.append((float(ln["x0"]) - x_off, float(ln["x1"]) - x_off, float(ln["top"]) - y_off,
                          float(ln["bottom"]) - y_off, str(uri)))
    for w in clean:
        cx, cy = (w["x0"] + w["x1"]) / 2, (w["top"] + w["bottom"]) / 2
        w["href"] = next((u for a, b, c, d, u in links if a - 1 <= cx <= b + 1 and c - 1 <= cy <= d + 1), None)
    # pictures
    scan = False
    for im in page.images or []:
        x0, x1 = max(float(im["x0"]), 0), min(float(im["x1"]), W)
        top, bottom = max(float(im["top"]), 0), min(float(im["bottom"]), H)
        if x1 - x0 < MIN_IMAGE_PT or bottom - top < MIN_IMAGE_PT:
            continue
        if not clean and (x1 - x0) * (bottom - top) >= SCAN_COVER * W * H:
            scan = True
        file = _save_image(page, im, (x0, top, x1, bottom), images, counts)
        if file:
            items.append(Item("img", x0, x1, top, bottom, data=file))
        if (x1 - x0) * (bottom - top) < LABEL_COVER * W * H:   # numbers and labels drawn on a picture belong to it
            clean = [w for w in clean if not (x0 <= (w["x0"] + w["x1"]) / 2 <= x1 and top <= (w["top"] + w["bottom"]) / 2 <= bottom)]
    # line fragments
    items += _fragments(clean)
    return {"w": W, "h": H, "items": items, "scan": scan, "words": len(clean)}


def _save_image(page, im, box, images, counts):
    """Saves a picture: a JPEG as it is, anything else drawn from the page as a PNG. Returns "attachments/…" or None;
    the same picture again (a logo on every page) is only kept the first time."""
    data, ext = None, ".png"
    try:
        stream = im.get("stream")
        filters = [f[0] if isinstance(f, (list, tuple)) else f for f in (stream.get_filters() if stream is not None else [])]
        names = [str(getattr(f, "name", f)).lstrip("/") for f in filters]
        if names == ["DCTDecode"]:
            data, ext = stream.get_rawdata(), ".jpg"
    except Exception:
        data = None
    if data is None:
        try:
            x_off, y_off = float(page.bbox[0]), float(page.bbox[1])
            crop = page.crop((box[0] + x_off, box[1] + y_off, box[2] + x_off, box[3] + y_off))
            pic = crop.to_image(resolution=144).original
            buf = io.BytesIO()
            pic.save(buf, format="PNG", optimize=True)
            data = buf.getvalue()
        except Exception:
            log.exception("drawing a picture")
            counts["bad_images"] += 1
            return None
    key = hashlib.sha1(data).hexdigest()
    if key in images.by_key:
        counts["repeat_images"] += 1
        return None
    return images.add(data, ext, key=key)


def _fragments(words):
    """Words → line fragments: words on one line, split where the gap is wide (a column gutter or a table's gap)."""
    words = sorted(words, key=lambda w: (w["top"], w["x0"]))
    lines = []
    for w in words:
        h = max(w["bottom"] - w["top"], 1)
        for ln in reversed(lines[-6:]):
            lh = max(ln["bottom"] - ln["top"], 1)
            overlap = min(ln["bottom"], w["bottom"]) - max(ln["top"], w["top"])
            if overlap >= 0.5 * min(h, lh):
                ln["words"].append(w)
                ln["top"], ln["bottom"] = min(ln["top"], w["top"]), max(ln["bottom"], w["bottom"])
                break
        else:
            lines.append({"words": [w], "top": w["top"], "bottom": w["bottom"]})
    out = []
    for ln in lines:
        ws = sorted(ln["words"], key=lambda w: w["x0"])
        cur = [ws[0]]
        for w in ws[1:]:
            size = max(cur[-1]["size"], w["size"], 4)
            if w["x0"] - cur[-1]["x1"] > max(1.5 * size, 10):
                out.append(_frag(cur))
                cur = [w]
            else:
                cur.append(w)
        out.append(_frag(cur))
    return out


def _unspace(words):
    """Runs of three or more single letters set apart ("G A M E   M A N U A L") are one word each, split where the
    gap is clearly wider than the gap between the letters."""
    out, k = [], 0
    while k < len(words):
        j = k
        while j < len(words) and len(words[j]["text"]) == 1 and words[j]["text"].isalnum():
            j += 1
        if j - k >= 3:
            run = words[k:j]
            gaps = sorted(b["x0"] - a["x1"] for a, b in zip(run, run[1:]))
            step = gaps[len(gaps) // 2]
            cur = dict(run[0])
            for a, b in zip(run, run[1:]):
                if b["x0"] - a["x1"] > max(1.6 * step, step + 2):
                    out.append(cur)
                    cur = dict(b)
                else:
                    cur["text"] += b["text"]
                    cur["x1"] = b["x1"]
            out.append(cur)
            k = j
        else:
            out.append(words[k])
            k += 1
    return out


def _frag(words):
    words = _unspace(words)
    sizes = Counter()
    for w in words:
        sizes[w["size"]] += len(w["text"])
    return Item("text", min(w["x0"] for w in words), max(w["x1"] for w in words), min(w["top"] for w in words),
                max(w["bottom"] for w in words), words, sizes.most_common(1)[0][0])


# ---- pass 2: the whole file ----

def _margin_repeats(pages):
    """Keys of the line fragments in the top / bottom margins that repeat on many pages (running headers, footers)."""
    seen = Counter()
    for p in pages:
        keys = set()
        for it in p["items"]:
            if it.kind == "text" and (it.bottom < 0.08 * p["h"] or it.top > 0.92 * p["h"]):
                keys.add(re.sub(r"\d+", "#", it.text).strip().lower())
        seen.update(keys)
    need = max(2, (len(pages) + 1) // 2)
    return {k for k, c in seen.items() if c >= need} if len(pages) > 1 else set()


def _drop_margins(page, repeats):
    keep = []
    for it in page["items"]:
        if it.kind == "text" and (it.bottom < 0.08 * page["h"] or it.top > 0.92 * page["h"]):
            if PAGE_NO_RE.match(it.text) or re.sub(r"\d+", "#", it.text).strip().lower() in repeats:
                continue
        keep.append(it)
    page["items"] = keep


def _find_split(items, lo, hi):
    """The x of a column gutter between lo and hi, or None: the widest gap that the fewest lines cross, with enough
    lines on both sides of it side by side."""
    texts = [it for it in items if it.kind == "text"]
    if len(texts) < 4 or hi - lo < 150:
        return None
    width = hi - lo
    xs = [lo + width * 0.2 + k * 2 for k in range(int(width * 0.6 / 2) + 1)]
    cross = [sum(1 for it in items if it.x0 < x - 1 and it.x1 > x + 1) for x in xs]
    runs, start = [], 0   # (lines crossing, -width, first, last): stretches of x crossed by the same number of lines
    for k in range(1, len(cross) + 1):
        if k == len(cross) or cross[k] != cross[start]:
            runs.append((cross[start], -(k - 1 - start), start, k - 1))
            start = k
    for c, negw, a, b in sorted(runs):   # fewest lines crossing first, then the widest gap
        if c > 0.25 * len(items):
            break
        if -negw * 2 < 6:
            continue
        split = (xs[a] + xs[b]) / 2
        left = [it for it in texts if it.x1 <= split]
        right = [it for it in texts if it.x0 >= split]
        if len(left) < 2 or len(right) < 2:
            continue
        side = sum(1 for r in right if any(min(r.bottom, ln.bottom) - max(r.top, ln.top) > 0 for ln in left))
        if side >= 2:
            return split
    return None


def _order(items, lo, hi, depth=0):
    """Reading order: column by column within bands, top to bottom."""
    split = _find_split(items, lo, hi) if depth < 3 else None
    items = sorted(items, key=lambda it: (round(it.top, 1), it.x0))
    if split is None:
        return items
    out, band = [], []

    def flush():
        out.extend(_order([it for it in band if it.x1 <= split + 1], lo, split, depth + 1))
        out.extend(_order([it for it in band if it.x1 > split + 1], split, hi, depth + 1))
        band.clear()
    for it in items:
        if it.x0 < split - 1 and it.x1 > split + 1:
            flush()
            out.append(it)
        else:
            band.append(it)
    flush()
    return out


def _label(it):
    """("bullet" | "number", label text, the words after it) when the line starts a list item, else None."""
    if not it.words:
        return None
    first = it.words[0]["text"]
    if BULLET_RE.match(first) and len(it.words) > 1:
        return "bullet", first, it.words[1:]
    m = BULLET_LEAD_RE.match(first)
    if m:
        return "bullet", m.group(1), [dict(it.words[0], text=m.group(2))] + it.words[1:]
    if NUMBER_RE.match(first) and len(it.words) > 1:
        return "number", first, it.words[1:]
    if len(first) == 1 and unicodedata.category(first) in ("So", "Sm", "Co", "Pd") and len(it.words) > 1:
        return "bullet", first, it.words[1:]
    return None


class _Writer:
    """Turns one page's ordered items into blocks, with the file's text sizes."""

    def __init__(self, body, levels, images):
        self.body, self.levels, self.images = body, levels, images
        self.blocks, self.list = [], None   # list: {"stack": [label x0], "counts": {level: n}, "widths": {level: w}}

    def segs(self, words):
        out = []
        for k, w in enumerate(words):
            font = w["font"].split("+")[-1]
            seg = Seg(w["text"], bool(BOLD_RE.search(font)), bool(ITALIC_RE.search(font)), False, w.get("href"),
                      bool(MONO_RE.search(font)))
            if k:
                prev = words[k - 1]
                gap = Seg(" ", seg.b and out[-1].b, seg.i and out[-1].i, False, w.get("href") if w.get("href") == prev.get("href") else None)
                out.append(gap)
            out.append(seg)
        return out

    @staticmethod
    def join_lines(lines):
        """Line fragments of one paragraph → their words, joined; "pipe-" + "line" → "pipeline"."""
        words = []
        for ln in lines:
            ws = [dict(w) for w in ln.words]
            if words and words[-1]["text"].endswith("-") and len(words[-1]["text"]) > 2 and ws and ws[0]["text"][:1].islower():
                ws[0]["text"] = words[-1]["text"][:-1] + ws[0]["text"]
                ws[0]["font"] = words[-1]["font"]
                words.pop()
            words += ws
        return words

    def heading_level(self, lines, words):
        size = Counter()
        for ln in lines:
            size[ln.size] += len(ln.text)
        sz = size.most_common(1)[0][0]
        text = " ".join(w["text"] for w in words)
        if len(lines) > 3 or len(text) > 160 or sum(ch.isalpha() for ch in text) < 2:
            return None
        if sz >= self.body * 1.15:
            return self.levels.get(sz, min(len(self.levels) or 1, 6))
        bold = all(BOLD_RE.search(w["font"].split("+")[-1]) for w in words)
        if (bold and len(lines) == 1 and len(words) <= 12 and sz >= self.body - 0.6 and not re.search(r"[.,;:]$", text)
                and any(ch.isalpha() for ch in text)):
            return -min(len(self.levels) + 1, 6)   # negative: a bold line, kept as a heading only if it stands alone
        return None

    def end_list(self):
        self.list = None

    def item(self, kind, label, words, x0):
        if self.list is None:
            self.list = {"stack": [], "counts": {}, "widths": {}, "key": f"li:{len(self.blocks)}"}
        L = self.list
        while L["stack"] and x0 < L["stack"][-1] - 3:
            L["stack"].pop()
        if not L["stack"] or x0 > L["stack"][-1] + 3:
            L["stack"].append(x0)
        level = len(L["stack"]) - 1
        if level == 0 and L.get("kind", kind) != kind:   # bullets, then numbers: two lists, with a blank line between
            L.update(counts={}, widths={}, key=f"li:{len(self.blocks)}")
        if level == 0:
            L["kind"] = kind
        for deeper in [k for k in L["counts"] if k > level]:
            del L["counts"][deeper]
            L["widths"].pop(deeper, None)
        if kind == "number":
            digits = re.sub(r"\D", "", label)
            n = int(digits) if digits else L["counts"].get(level, 0) + 1
            L["counts"][level] = n
            marker = f"{n}."
        else:
            marker = "-"
        indent = sum(L["widths"].get(k, 2) for k in range(level))
        L["widths"][level] = len(marker) + 1
        text = render_inline(self.segs(words)).replace("\n", " ")
        box = task_box(text)
        text = (box[0] + " " + box[1]) if box else esc_line_start(text)
        self.blocks.append((L["key"], " " * indent + marker + " " + text))

    def page(self, items):
        para, lab, prev = [], None, None   # lab: the open list item's (kind, label, words, x0, text_x0)

        def flush_para():
            nonlocal para
            if not para:
                return
            words = self.join_lines(para)
            level = self.heading_level(para, words)
            if level:
                self.end_list()
                plain = esc_line_start(render_inline(self.segs(words)).replace("\n", " "))
                segs = self.segs(words)
                for s in segs:
                    s.b = False
                head = "#" * abs(level) + " " + render_inline(segs).replace("\n", " ")
                self.blocks.append(("hb", head, plain) if level < 0 else ("h", head))
            elif LABELS_ONLY_RE.match(" ".join(w["text"] for w in words)):
                pass   # "1." "5. 4.": callout numbers around a picture, with nothing to say on their own
            else:
                text = render_inline(self.segs(words)).replace("\n", " ")
                box = task_box(text)
                if box:
                    self.blocks.append(("li:tasks", f"- {box[0]} " + esc_line_start(box[1])))
                else:
                    self.end_list()
                    short_bold = len(para) == 1 and len(words) <= 12 and all(BOLD_RE.search(w["font"].split("+")[-1]) for w in words)
                    self.blocks.append(("pb" if short_bold else "p", esc_line_start(text)))
            para = []

        def flush_item():
            nonlocal lab
            if lab:
                self.item(lab[0], lab[1], lab[2], lab[3])
                lab = None

        for it in items:
            if it.kind != "text":
                flush_para()
                flush_item()
                self.end_list()
                if it.kind == "table":
                    rows = [[esc(c).replace("|", "\\|") for c in r] for r in it.data]
                    self.blocks.append(("table", table_md(rows)))
                    self.blocks.append(self.images.table_slot(it.data))   # its CSV, linked under it
                else:
                    self.blocks.append(("img", f"![[{it.data}]]"))
                prev = None
                continue
            size = max(it.size, 4)
            gap = it.top - prev.bottom if prev is not None else None
            near = prev is not None and -0.5 * size <= gap <= 0.7 * size and abs(it.size - prev.size) <= 1
            label = _label(it)
            if label:
                flush_para()
                flush_item()
                lab = [label[0], label[1], list(label[2]), it.x0, label[2][0]["x0"]]
            elif lab and near and it.x0 >= lab[4] - 3:
                lab[2] += [dict(w) for w in it.words]   # the item's next line
            else:
                flush_item()
                if para and not (near and it.x0 <= para[-1].x0 + size):
                    flush_para()
                elif para and self.heading_level([para[-1]], para[-1].words) and not self.heading_level([it], it.words):
                    flush_para()
                para.append(it)
            prev = it
        flush_para()
        flush_item()
        self.end_list()
        # bold lines one after another are a list of bold words, not headings
        bold = {k for k, b in enumerate(self.blocks) if b[0] in ("hb", "pb")}
        for k, b in enumerate(self.blocks):
            if b[0] == "hb":
                alone = (k - 1 not in bold) and (k + 1 not in bold)
                self.blocks[k] = ("h", b[1]) if alone else ("p", b[2])
            elif b[0] == "pb":
                self.blocks[k] = ("p", b[1])


def convert(path, att_base=None, progress=None, cancel=None, table_stem=None):
    import pdfplumber
    name = os.path.basename(path)
    warnings, images = [], Images(att_base, _stem(path))
    counts = Counter(cid=0, bad_pages=0, bad_images=0, repeat_images=0)
    try:
        pdf = pdfplumber.open(path)
    except Exception as e:
        if "password" in f"{type(e).__name__} {e}".lower() or "encrypt" in f"{type(e).__name__} {e}".lower():
            raise ConvertError(f"{name} is locked with a password. Open it, save a copy without one, then convert that.")
        raise ConvertError(f"{name} isn't a PDF, or it's damaged.")
    try:
        with pdf:
            try:
                n = len(pdf.pages)
                meta = pdf.metadata or {}
            except Exception:
                raise ConvertError(f"{name} isn't a PDF, or it's damaged.")
            if not n:
                raise ConvertError(f"{name} has no pages.")
            pages = []
            for i, page in enumerate(pdf.pages):
                _tick(progress, cancel, i, n, f"Page {i + 1} of {n}")
                pages.append(_page_data(page, i + 1, images, counts))
                try:
                    page.close()   # frees the page's parsed objects as we go
                except Exception:
                    pass
            _tick(progress, cancel, n, n, f"Page {n} of {n}")
        if all(p["scan"] or not p["words"] for p in pages):
            images.undo()
            scan = any(p["scan"] for p in pages)
            msg = "This PDF is a scan: no text to convert." if scan else "This PDF has no text to convert."
            return {"markdown": "", "title": _title(meta, [], path), "images": [], "tables": [], "warnings": [msg], "pages": n,
                    "scan": scan}
        sizes = Counter()
        for p in pages:
            for it in p["items"]:
                if it.kind == "text":
                    sizes[it.size] += len(it.text)
        body = sizes.most_common(1)[0][0] if sizes else 10.0
        big = sorted({s for s in sizes if s >= body * 1.15}, reverse=True)
        levels = {s: min(k + 1, 6) for k, s in enumerate(big)}
        repeats = _margin_repeats(pages)
        blocks, scans = [], []
        for i, p in enumerate(pages):
            _drop_margins(p, repeats)
            w = _Writer(body, levels, images)
            w.page(_order(p["items"], 0, p["w"]))
            if p["scan"]:
                scans.append(i + 1)
            if w.blocks:
                if blocks:
                    blocks.append(("hr", "---"))
                blocks += w.blocks
        used = sorted({len(t) - len(t.lstrip("#")) for k, t in blocks if k == "h"})   # sizes used → #, ##, ### with no gaps
        step = {lv: k + 1 for k, lv in enumerate(used)}
        blocks = [(k, "#" * step[len(t) - len(t.lstrip("#"))] + t.lstrip("#")) if k == "h" else (k, t) for k, t in blocks]
        if scans:
            pg = ", ".join(map(str, scans))
            warnings.append(f"Page{'s' if len(scans) > 1 else ''} {pg} {'are scans' if len(scans) > 1 else 'is a scan'}: "
                            "kept as a picture, with no text.")
        if counts["cid"]:
            warnings.append("Some characters couldn't be read: the PDF's fonts don't say which letters they are.")
        if counts["bad_pages"]:
            warnings.append(f"{counts['bad_pages']} page{'s' if counts['bad_pages'] > 1 else ''} couldn't be read.")
        if counts["bad_images"]:
            warnings.append(f"{counts['bad_images']} picture{'s' if counts['bad_images'] > 1 else ''} couldn't be saved.")
        out = _finish(blocks, _title(meta, blocks, path), images, warnings, pages=n, table_stem=table_stem)
        out["scan"] = False
        return out
    except BaseException:
        images.undo()
        raise


def _title(meta, blocks, path):
    t = str((meta or {}).get("Title") or "").strip()
    if t and not re.match(r"^(untitled|microsoft (word|powerpoint)\s*-|document\d*$|.*\.(docx?|pdf|pptx?|indd|tex)$)", t, re.I):
        return t[:200]
    first = next((txt for k, txt in blocks if k == "h"), "")
    first = re.sub(r"^#+\s*", "", first).replace("\\", "").replace("*", "").strip()
    return first[:200] or os.path.splitext(os.path.basename(path))[0]
