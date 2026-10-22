/* BUILD DV · the document viewer's renderers (mockup R66). A renderer draws one kind of document into page
   boxes; viewer.js does everything else (the window, the tools, the notes, find, zoom, the copy) the same way for each.

   The interface (every renderer is a class with these):
     static id                      'pdfjs@6.4.299' | 'docx-preview@0.4.1' | 'fake@1': saved in the notes file
     static can(kind, bytes, info)  true when it can draw this document now (its library is in and matches its pinned hashes)
     async open(bytes)              → { pages: [{ w, h }] (CSS px at 100%), outline: [{ title, page, level }] }
     async draw(n, el, zoom)        draws page n (1-based) into el, an empty box zoom × its size; text the reader can select
                                    goes in elements under el, so Find and Highlight text work on the DOM
     async thumb(n, canvas)         a small picture of page n (optional: a blank page is drawn without it)
     async pageCanvas(n, scale)     page n as a canvas, scale × its size (Save an annotated copy draws the notes over it)
     quoteNear(n, el, x, y)         the words at a point (percent), kept with a pin so a Word page can place it again (optional)
     close()

   Hardening, as the research says: PDF.js gets the bytes (never a URL), no scripting (no PDFScriptingManager: these are the bare
   components), enableXfa off, isEvalSupported off (gone in 6.x; the CSP has no 'unsafe-eval' anyway), no wasm, no fetching (its
   character maps and fonts come over ViewerApi.vendor_file), links through our own "open in the browser" step. docx-preview
   renders into a detached box with renderAltChunks off, then DOMPurify cleans every page before it's shown; its styles keep only
   rules for its own .docx classes, with @import and any url() that isn't data: taken out. */
'use strict';
const DV_RENDERERS = [];
const dvRegister = R => { DV_RENDERERS.push(R); return R; };
const DV_VENDOR = 'viewer/vendor/';
const dvLoadScript = src => new Promise((ok, no) => { const s = document.createElement('script'); s.src = src; s.onload = ok; s.onerror = () => no(new Error(`${src} didn't load`)); document.head.appendChild(s); });
const dvB64 = b64 => { const s = atob(b64), u = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i); return u; };

/* ---- the fake renderer: a tiny made-up format, so the window, the tools, the notes file, the Timeline and the chip are all checked
   without PDF.js or docx-preview. A file starting "NVFAKEDOC\n" then JSON: { pages: [{ w, h, blocks: [[kind, text], …] }],
   outline: [[title, page, level]] }. It's drawn with textContent only, line by line at fixed places, so the page's HTML and its
   canvas (the copy) match. Real PDFs and Word files never reach it. ---- */
const DV_FAKE_MAGIC = 'NVFAKEDOC\n';
const dvIsFake = bytes => bytes && bytes.length > 10 && String.fromCharCode(...bytes.slice(0, 10)) === DV_FAKE_MAGIC;
dvRegister(class FakeRenderer {
  static id = 'fake@1';
  static can(kind, bytes) { return dvIsFake(bytes); }
  async open(bytes) {
    const doc = JSON.parse(new TextDecoder().decode(bytes.slice(DV_FAKE_MAGIC.length)));
    this.pages = (doc.pages || []).slice(0, 500).map(p => ({ w: +p.w || 612, h: +p.h || 792, blocks: (p.blocks || []).slice(0, 200) }));
    this.lines = this.pages.map(p => this.layout(p));
    return { pages: this.pages.map(p => ({ w: p.w, h: p.h })), outline: (doc.outline || []).map(([title, page, level]) => ({ title: String(title), page: +page || 1, level: +level || 0 })) };
  }
  static font(kind) { return kind === 'h1' ? ['700 21px "Segoe UI", system-ui, sans-serif', 30] : kind === 'h2' ? ['700 14px "Segoe UI", system-ui, sans-serif', 22] : ['400 12px "Segoe UI", system-ui, sans-serif', 18]; }
  layout(p) {   // [{ kind, text, x, y }] in px at 100%: wrapped by measuring, so HTML and canvas agree
    const g = document.createElement('canvas').getContext('2d'), out = [], left = p.w * .1, width = p.w * .8; let y = p.h * .08;
    for (const [kind, text] of p.blocks) {
      const [font, lh] = FakeRenderer.font(kind); g.font = font; const words = String(text).split(/\s+/); let line = kind === 'li' ? '• ' : '';
      if (kind === 'h2') y += 8;
      for (const w of words) { const t = line ? line + (line === '• ' ? '' : ' ') + w : w; if (g.measureText(t).width > width && line && line !== '• ') { out.push({ kind, text: line, x: left, y }); y += lh; line = (kind === 'li' ? '  ' : '') + w; } else line = t; }
      if (line) { out.push({ kind, text: line, x: left, y }); y += lh; }
      y += kind === 'p' ? 6 : 2;
    }
    return out;
  }
  async draw(n, el, zoom) {
    const p = this.pages[n - 1], box = document.createElement('div'); box.className = 'dv-fake dv-text-root';
    box.style.width = p.w + 'px'; box.style.height = p.h + 'px'; box.style.transform = `scale(${zoom})`; box.style.transformOrigin = '0 0';
    for (const l of this.lines[n - 1]) { const d = document.createElement('div'); d.className = 'is-' + l.kind; d.style.left = l.x + 'px'; d.style.top = l.y + 'px'; d.textContent = l.text; box.appendChild(d); }
    el.appendChild(box);
  }
  async thumb(n, cv) { const c = await this.pageCanvas(n, cv.width / this.pages[n - 1].w); cv.getContext('2d').drawImage(c, 0, 0, cv.width, cv.height); }
  async pageCanvas(n, scale) {
    const p = this.pages[n - 1], c = document.createElement('canvas'); c.width = Math.round(p.w * scale); c.height = Math.round(p.h * scale);
    const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); g.scale(scale, scale); g.fillStyle = '#1f2328'; g.textBaseline = 'top';
    for (const l of this.lines[n - 1]) { g.font = FakeRenderer.font(l.kind)[0]; g.fillText(l.text, l.x, l.y + 2); }
    g.setTransform(1, 0, 0, 1, 0, 0); return c;
  }
  quoteNear(n, el, x, y) { const p = this.pages[n - 1], py = y / 100 * p.h; const l = this.lines[n - 1].reduce((b, l) => Math.abs(l.y - py) < Math.abs((b?.y ?? 1e9) - py) ? l : b, null); return l ? l.text.trim().slice(0, 160) : ''; }
  close() {}
});

/* ---- PDF.js 6.4.299 (pdfjs-dist, Apache-2.0): the bare API (no viewer app, no scripting manager) ---- */
// The character maps and standard fonts arrive over the bridge, not by fetch (the window has no network: connect-src 'none')
// PDF.js 6.4's one BinaryDataFactory: fetch({ kind, filename }) → the file's bytes. Ours asks ViewerApi.vendor_file, which reads only
// the vendor folder's character maps and standard fonts; wasm is never asked for (useWasm is off)
const DV_PDF_DATA = { cMapUrl: 'pdfjs/cmaps/', standardFontDataUrl: 'pdfjs/standard_fonts/' };
class DvBinaryData {
  constructor() {}
  async fetch({ kind, filename }) {
    const dir = DV_PDF_DATA[kind]; if (!dir || !/^[A-Za-z0-9._-]{1,80}$/.test(String(filename || ''))) throw new Error(`PDF data that isn't offered: ${kind}`);
    const r = await window.pywebview.api.vendor_file(dir + filename); if (!r || r.status !== 'success') throw new Error(r?.message || `${filename} isn't there`);
    return dvB64(r.data);
  }
}
dvRegister(class PdfJsRenderer {
  static id = 'pdfjs@6.4.299';
  static can(kind, bytes, info) { return kind === 'pdf' && (info?.renderers || []).includes('pdf'); }
  async open(bytes) {
    const lib = this.lib = await import('./vendor/pdfjs/pdf.min.mjs');
    lib.GlobalWorkerOptions.workerSrc = new URL(DV_VENDOR + 'pdfjs/pdf.worker.min.mjs', location.href).href;
    // the bytes (a copy: PDF.js hands the buffer to its worker), never a URL; no XFA, no eval, no wasm; the worker fetches nothing
    this.doc = await lib.getDocument({ data: bytes.slice(), isEvalSupported: false, enableXfa: false, useWasm: false, wasmUrl: null, iccUrl: null, useWorkerFetch: false,
      disableAutoFetch: true, disableStream: true, disableRange: true, stopAtErrors: false, cMapPacked: true,
      cMapUrl: DV_PDF_DATA.cMapUrl, standardFontDataUrl: DV_PDF_DATA.standardFontDataUrl, BinaryDataFactory: DvBinaryData }).promise;
    const pages = [];
    for (let i = 1; i <= this.doc.numPages; i++) { const v = (await this.doc.getPage(i)).getViewport({ scale: 96 / 72 }); pages.push({ w: v.width, h: v.height }); }
    return { pages, outline: await this.outline() };
  }
  async outline() {
    const out = [], walk = async (items, level) => { for (const it of items || []) { if (out.length > 400) return; let page = null;
      try { const dest = typeof it.dest === 'string' ? await this.doc.getDestination(it.dest) : it.dest; if (Array.isArray(dest) && dest[0]) page = (typeof dest[0] === 'object' ? await this.doc.getPageIndex(dest[0]) : dest[0]) + 1; } catch (e) { /* no place */ }
      if (page) out.push({ title: String(it.title || '').slice(0, 200), page, level: Math.min(level, 2) }); await walk(it.items, level + 1); } };
    try { await walk(await this.doc.getOutline(), 0); } catch (e) { /* no outline */ }
    return out;
  }
  async draw(n, el, zoom) {
    const page = await this.doc.getPage(n), dpr = window.devicePixelRatio || 1, v = page.getViewport({ scale: 96 / 72 * zoom });
    const cv = document.createElement('canvas'); cv.className = 'dv-canvas'; cv.width = Math.floor(v.width * dpr); cv.height = Math.floor(v.height * dpr); cv.style.width = v.width + 'px'; cv.style.height = v.height + 'px';
    el.appendChild(cv);
    await page.render({ canvasContext: cv.getContext('2d'), viewport: v, transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : null, annotationMode: this.lib.AnnotationMode?.DISABLE ?? 0 }).promise;
    const tl = document.createElement('div'); tl.className = 'textLayer dv-text-root'; tl.style.setProperty('--total-scale-factor', v.scale); el.appendChild(tl);
    try { await new this.lib.TextLayer({ textContentSource: page.streamTextContent(), container: tl, viewport: v }).render(); } catch (e) { console.warn('text layer', e); }
    try {   // links: a web link opens through our "open in the browser" step; a link inside the PDF jumps to its page
      for (const a of await page.getAnnotations({ intent: 'display' })) {
        if (a.subtype !== 'Link' || (!a.url && !a.dest)) continue; const [x1, y1] = v.convertToViewportPoint(a.rect[0], a.rect[1]), [x2, y2] = v.convertToViewportPoint(a.rect[2], a.rect[3]), l = document.createElement('a');
        l.className = 'dv-link'; Object.assign(l.style, { left: Math.min(x1, x2) + 'px', top: Math.min(y1, y2) + 'px', width: Math.abs(x2 - x1) + 'px', height: Math.abs(y2 - y1) + 'px' });
        if (a.url) { if (!/^(https?:|mailto:)/i.test(a.url)) continue; l.dataset.url = a.url; l.setAttribute('aria-label', a.url); }   // open_link checks again
        else { try { const d = typeof a.dest === 'string' ? await this.doc.getDestination(a.dest) : a.dest; l.dataset.page = (typeof d[0] === 'object' ? await this.doc.getPageIndex(d[0]) : d[0]) + 1; } catch (e) { continue; } l.setAttribute('aria-label', 'Page ' + l.dataset.page); }
        el.appendChild(l); }
    } catch (e) { /* no links */ }
    page.cleanup();
  }
  async thumb(n, cv) { const c = await this.pageCanvas(n, cv.width / ((await this.doc.getPage(n)).getViewport({ scale: 1 }).width)); cv.getContext('2d').drawImage(c, 0, 0, cv.width, cv.height); }
  async pageCanvas(n, scale) {   // scale × the page's CSS size at 100%
    const page = await this.doc.getPage(n), v = page.getViewport({ scale: 96 / 72 * scale }), c = document.createElement('canvas'); c.width = Math.round(v.width); c.height = Math.round(v.height);
    const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
    await page.render({ canvasContext: g, viewport: v, annotationMode: this.lib.AnnotationMode?.DISABLE ?? 0 }).promise; return c;
  }
  close() { try { this.doc?.destroy(); } catch (e) { /* gone */ } }
});

/* ---- docx-preview 0.4.1 (Apache-2.0) with jszip 3.10.2, cleaned by DOMPurify 3.4.17 (never IN_PLACE) ---- */
const DV_URI_OK = /^(?:https?:|mailto:|#|data:image\/(?:png|jpe?g|gif|webp|bmp);base64,)/i;
function dvCleanCss(text) {   // only the document's own .docx rules; no @import, no url() that isn't data:
  const t = String(text || '').replace(/@import[^;]*;?/gi, '').replace(/url\(\s*(?!['"]?data:image\/)[^)]*\)/gi, 'none');
  const sh = new CSSStyleSheet(); try { sh.replaceSync(t); } catch (e) { return ''; }
  return [...sh.cssRules].filter(r => r instanceof CSSStyleRule && r.selectorText.split(',').every(s => /^\s*\.docx(?:[\s.:>[_-]|$)/.test(s))).map(r => r.cssText).join('\n');
}
dvRegister(class DocxRenderer {
  static id = 'docx-preview@0.4.1';
  static can(kind, bytes, info) { return kind === 'docx' && (info?.renderers || []).includes('docx'); }
  async open(bytes) {
    for (const f of ['jszip/jszip.min.js', 'dompurify/purify.min.js', 'docx/docx-preview.min.js']) await dvLoadScript(DV_VENDOR + f);
    const P = window.DOMPurify; if (!P?.sanitize || !window.docx?.renderAsync) throw new Error("The Word reader didn't start");
    P.addHook('afterSanitizeAttributes', n => { for (const a of ['href', 'src', 'xlink:href']) { const v = n.getAttribute?.(a); if (v != null && !DV_URI_OK.test(v.trim())) n.removeAttribute(a); }
      if (n.tagName === 'A') { n.removeAttribute('target'); const h = n.getAttribute('href'); if (h && !h.startsWith('#')) { n.dataset.url = h; n.removeAttribute('href'); } } });
    const host = document.createElement('div'), styles = document.createElement('div');   // detached: nothing it makes is live yet
    await window.docx.renderAsync(bytes.slice(), host, styles, { className: 'docx', inWrapper: false, breakPages: true, ignoreLastRenderedPageBreak: true, experimental: false,
      renderAltChunks: false, useBase64URL: true, ignoreFonts: true, renderComments: false, renderChanges: false, renderHeaders: true, renderFooters: true, renderFootnotes: true,
      renderEndnotes: true, trimXmlDeclaration: true, debug: false });
    const css = dvCleanCss([...styles.querySelectorAll('style')].map(s => s.textContent).join('\n'));
    this.sheet = new CSSStyleSheet(); this.sheet.replaceSync(css); document.adoptedStyleSheets = [...document.adoptedStyleSheets, this.sheet]; this.css = css;
    const opts = { RETURN_DOM_FRAGMENT: true, FORBID_TAGS: ['style', 'script', 'iframe', 'object', 'embed', 'form', 'input', 'button', 'textarea', 'select', 'link', 'meta', 'base', 'svg', 'math'], FORBID_ATTR: ['srcset', 'action', 'formaction'], ALLOW_DATA_ATTR: false };
    this.secs = [...host.querySelectorAll(':scope > section.docx, :scope section.docx')].map(sec => { const f = P.sanitize(sec.outerHTML, opts); return f.firstElementChild || f; });
    // each section's size, measured once off screen (in a box with the cleaned styles)
    const probe = document.createElement('div'); Object.assign(probe.style, { position: 'absolute', left: '-99999px', top: '0', visibility: 'hidden' }); document.body.appendChild(probe);
    const pages = this.secs.map(s => { const c = s.cloneNode(true); probe.appendChild(c); const r = { w: c.offsetWidth || 816, h: Math.max(c.offsetHeight, 200) || 1056 }; c.remove(); return r; });
    probe.remove(); this.pages = pages;
    // the outline: Word's headings (docx-preview names them by style, "docx_heading1"…, or as h1–h3)
    const outline = [], lvl = h => /^H[1-3]$/.test(h.tagName) ? +h.tagName[1] - 1 : +((h.className.match(/_heading([1-3])\b/) || [])[1] || 1) - 1;
    this.secs.forEach((s, i) => s.querySelectorAll('h1, h2, h3, p[class*="_heading1"], p[class*="_heading2"], p[class*="_heading3"]').forEach(h => { if (outline.length < 300 && h.textContent.trim()) outline.push({ title: h.textContent.trim().slice(0, 200), page: i + 1, level: lvl(h) }); }));
    return { pages, outline };
  }
  async draw(n, el, zoom) { const c = this.secs[n - 1].cloneNode(true); c.classList.add('dv-text-root'); c.style.transform = `scale(${zoom})`; c.style.transformOrigin = '0 0'; el.appendChild(c); }
  async pageCanvas(n, scale) {   // the page through an SVG picture (data: images only, so the canvas stays readable)
    const p = this.pages[n - 1], xml = new XMLSerializer().serializeToString(this.secs[n - 1]);
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${p.w * scale}" height="${p.h * scale}"><foreignObject width="${p.w}" height="${p.h}" transform="scale(${scale})"><div xmlns="http://www.w3.org/1999/xhtml"><style>${this.css.replace(/</g, '\\3c ')}</style>${xml}</div></foreignObject></svg>`;
    const img = new Image(); img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg); await img.decode();
    const c = document.createElement('canvas'); c.width = Math.round(p.w * scale); c.height = Math.round(p.h * scale); const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); g.drawImage(img, 0, 0);
    c.toDataURL();   // throws now (not at save) if the picture can't be read back
    return c;
  }
  quoteNear(n, el, x, y) {   // the paragraph under the point
    const r = el.getBoundingClientRect(), page = el.closest('.dv-page'), px = r.left + x / 100 * r.width, py = r.top + y / 100 * r.height;   // under the marks layer
    const at = document.elementsFromPoint(px, py).find(e => e.closest('.dv-content') && page?.contains(e));
    const blk = at?.closest('p, li, td, h1, h2, h3, h4') || [...(page?.querySelectorAll('.dv-content p, .dv-content li') || [])].reduce((b, e) => { const q = e.getBoundingClientRect(), d = Math.abs(q.top + q.height / 2 - py); return d < (b?.d ?? 1e9) ? { e, d } : b; }, null)?.e;
    return (blk?.textContent || '').trim().slice(0, 160);
  }
  close() { if (this.sheet) document.adoptedStyleSheets = document.adoptedStyleSheets.filter(s => s !== this.sheet); }
});

// The renderer for a document: the first that can draw it now, or null (its library isn't installed yet)
const dvRendererFor = (kind, bytes, info) => DV_RENDERERS.find(R => R.can(kind, bytes, info)) || null;
