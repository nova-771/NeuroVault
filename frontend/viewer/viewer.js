/* BUILD DV · THE DOCUMENT VIEWER WINDOW (mockup R66). Feedback: "docx viewer with the anotation
   youve built for the images and the same for pdfs, I want it to open in a seperate neurovault window!"
   One PDF or Word file in its own NeuroVault window (docviewer.py opens it, like the sticky pop-outs): its window bar (the file,
   its pages and the note it came from), the tools in one bar under it, page thumbnails or the outline at the left, the pages in
   one long scroll, your notes at the right (R66's drawn defaults: the three answers are docviewer.LAYOUT, read from info()).
   The tools are the photo tools the user liked (R59: numbered pins with notes, captions, arrow, box, highlight, text, pen, three
   colours, undo) plus Highlight text on selected words. Notes are saved beside the file as you go (ViewerApi.annotations_save):
   the file itself is never changed. "Save an annotated copy" draws each page with its notes, and a notes page last, into a PDF
   beside the original. The page talks only to its own small ViewerApi, never to NeuroVault's; it has no network (viewer.html's CSP).
   Drawing a page is the renderer's job (renderers.js), so everything here works the same on PDF.js, docx-preview or the fake. */
'use strict';
const app = document.getElementById('app');
let afterRender = () => {};   // tooltip.js wraps it (the app's own tooltips)
const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const Q = new URLSearchParams(location.search);
// QC 114 · in a tab of NeuroVault's window: an iframe from the viewer's own origin (docviewer.ViewerServer), so it can't reach the
// app's page or API. Every ask goes to the window that holds it (only that one, checked by origin) as a postMessage; NeuroVault
// passes it to docviewer.tab_call, which runs only ViewerApi's own calls for this document's token.
const EMBED = Q.get('embed') === '1' && window.parent !== window;
const PARENT = EMBED ? (decodeURIComponent((location.hash.match(/[#&]p=([^&]+)/) || [])[1] || '') || location.ancestorOrigins?.[0] || '') : '';   // NeuroVault's window says its origin in the hash
const EMBED_API = EMBED ? (() => {
  let seq = 0; const wait = new Map(), token = (location.hash.match(/[#&]v=([\w-]+)/) || [])[1] || '';
  addEventListener('message', e => {
    if (e.source !== window.parent || e.origin !== PARENT) return; const d = e.data || {};
    if (d.nvViewerReply != null && wait.has(d.nvViewerReply)) { wait.get(d.nvViewerReply)(d.result); wait.delete(d.nvViewerReply); }
    else if (d.nvViewerMsg) window.nvViewer?.(d.nvViewerMsg);
  });
  return new Proxy({}, { get: (_, name) => typeof name !== 'string' || name === 'then' ? undefined : (...args) => new Promise(ok => {
    const id = ++seq; wait.set(id, ok); window.parent.postMessage({ nvViewerCall: id, token, method: name, args: JSON.parse(JSON.stringify(args)) }, PARENT);
    setTimeout(() => { if (wait.has(id)) { wait.delete(id); ok({ status: 'error', message: 'NeuroVault didn’t answer.' }); } }, 20000); }) });
})() : null;
if (EMBED) { document.body.classList.add('is-embed'); if (!window.pywebview) window.pywebview = { api: EMBED_API }; }
const vapi = () => EMBED_API || window.pywebview?.api || null;
Object.assign(ICON, {   // R66's tool icons; the photo tools' own drawings (photos.js, photos-edit.js)
  dvsel: '<path d="M5 3l13 7.5-5.5 1.5L10 18z"/>', dvpin: '<path d="M12 21s-6-5.6-6-11a6 6 0 0 1 12 0c0 5.4-6 11-6 11z"/><circle cx="12" cy="10" r="2"/>',
  dvmark: '<path d="M4 20h16"/><path d="M7 16l8.5-8.5 3 3L10 19H7z"/>', dvcap: '<rect x="4" y="4" width="16" height="11" rx="1"/><path d="M7 19h10"/>',
  dvarrow: '<path d="M5 19 19 5"/><path d="M9 5h10v10"/>', dvbox: '<rect x="4" y="5" width="16" height="14" rx="1.5"/>',
  dvhl: '<path d="m9 11-6 6v3h9l3-3"/><path d="m22 12-4.6 4.6a2 2 0 0 1-2.8 0l-5.2-5.2a2 2 0 0 1 0-2.8L14 4"/>', dvtext: '<path d="M4 7V4h16v3"/><path d="M9 20h6"/><path d="M12 4v16"/>',
  dvpen: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>', dvundo: '<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>',
  dvzin: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4M8 11h6M11 8v6"/>', dvzout: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4M8 11h6"/>',
  dvfit: '<path d="M4 9V5h4M20 9V5h-4M4 15v4h4M20 15v4h-4"/>', dvup: '<path d="M6 15l6-6 6 6"/>', dvdown: '<path d="M6 9l6 6 6-6"/>',
  dvprev: '<path d="M15 6l-6 6 6 6"/>', dvnext: '<path d="M9 6l6 6-6 6"/>', dvpages: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16"/>',
  dvnotes: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M15 4v16"/>', dvredo: '<path d="m15 14 5-5-5-5"/><path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13"/>',
  dvdock: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18M12 13v5M9.5 15.5 12 18l2.5-2.5"/>' });
const DV_TOOLS = [['select', 'dvsel', 'Select'], ['pin', 'dvpin', 'Pin a note'], ['texthl', 'dvmark', 'Highlight text'], ['cap', 'dvcap', 'Caption'], ['arrow', 'dvarrow', 'Arrow'],
  ['box', 'dvbox', 'Box'], ['hl', 'dvhl', 'Highlight an area'], ['text', 'dvtext', 'Text'], ['pen', 'dvpen', 'Pen']];
const DV_TOOL_SAID = { select: 'Select: pick a note to move or delete it', pin: 'Pin a note: click the page where it goes', texthl: 'Highlight text: select the words',
  cap: 'Caption: click where it goes, then type', text: 'Text: click where it goes, then type', pen: 'Pen: draw on the page', arrow: 'Arrow: drag on the page', box: 'Box: drag on the page', hl: 'Highlight an area: drag on the page' };
const DV_COLOURS = [['red', 'Red', '#c92a2a'], ['amber', 'Amber', '#c77700'], ['blue', 'Blue', '#1c6dd0']];
const DV_WHAT = { pin: 'Pin', texthl: 'Highlight', cap: 'Caption', arrow: 'Arrow', box: 'Box', hl: 'Marked area', text: 'Text', pen: 'Drawing' };
const DV_ICON_OF = { texthl: 'dvmark', cap: 'dvcap', arrow: 'dvarrow', box: 'dvbox', hl: 'dvhl', text: 'dvtext', pen: 'dvpen' };
const DV_ZOOMS = [.5, .67, .75, .9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3];
const DV_PAGE_MAX = 1200;   // Fit to width: the widest a page gets, in CSS px
const DV_COPY_SCALE = 1.5;   // the copy's pages: 1.5 × CSS size = 144 dpi, the resolution docviewer.save_copy writes
const DV_LAYOUT0 = { bar: 'top', side: 'right', flow: 'scroll' };   // only until info() says (docviewer.LAYOUT is the one place)
// R66, the decision "customisable user setting": where the tools sit is theirs to pick (Settings → Document viewer, or Tools: …
// in this window's status line), remembered in config.json viewer_tools; docviewer.TOOL_PLACES has the same six, the first the default
const DV_TOOL_PLACES = [['top', 'Under the window bar', 'One bar under the window bar, with zoom and Find'], ['float', 'Over the page', 'A floating bar over the page, like the note editor’s toolbar'],
  ['rail', 'Down the left', 'A slim rail at the left, so the pages get the full height'], ['bottom', 'Along the bottom', 'One bar along the bottom, above the status line'],
  ['context', 'Beside what you pick', 'Beside where you click or what you select, like Word’s mini toolbar'], ['panel', 'In the notes panel', 'At the top of your notes, so everything to do with notes is in one place']];
const dvPlace = v => DV_TOOL_PLACES.find(p => p[0] === v) || DV_TOOL_PLACES[0];

const V = { info: null, state: 'loading', msg: '', kind: 'pdf', name: '', R: null, rend: null, pages: [], outline: [], items: [], undo: [],
  tool: 'select', col: 'red', sel: null, zoom: 1, fit: true, cur: 1, nav: null, ptab: 'notes', find: null, dlg: null, busy: false, status: '',
  save: { state: 'saved', err: '' }, max: false, layout: { ...DV_LAYOUT0 }, typing: null, drawn: {}, thumbs: {}, editing: null };
const dvPages = () => document.getElementById('dv-pages');
const pageEl = n => app.querySelector(`.dv-page[data-page="${n}"]`);
const itemById = id => V.items.find(x => x.id === id);
const docWord = () => V.kind === 'docx' ? 'Word file' : 'PDF';
function status(msg) { V.status = msg || ''; const el = app.querySelector('.dv-st-msg'); if (el) el.textContent = V.status; }

/* ---- the notes, in reading order: page, then from the top; pins numbered in that order ---- */
const dvTop = it => it.kind === 'texthl' ? it.rects[0][1] : Math.min(...it.pts.filter((_, i) => i % 2));
const ordered = () => [...V.items].sort((a, b) => a.page - b.page || dvTop(a) - dvTop(b));
function pinNos() { const m = {}; let k = 0; ordered().forEach(it => { if (it.kind === 'pin') m[it.id] = ++k; }); return m; }
const newId = () => 'a' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const nowIso = () => new Date().toISOString().slice(0, 19);
function snap() { V.undo.push(JSON.stringify(V.items)); if (V.undo.length > 60) V.undo.shift(); V.redo = []; }
function change(paintAll = true) { queueSave(); if (paintAll) { paintInkAll(); paint(); } }
function addItem(it) { snap(); V.editing = null; const full = { id: newId(), colour: V.col, note: '', text: '', quote: '', created: nowIso(), updated: nowIso(), pts: [], ...it }; V.items.push(full); V.sel = full.id; change(); return full; }
function removeItem(id) { const it = itemById(id); if (!it) return; snap(); V.items = V.items.filter(x => x.id !== id); if (V.sel === id) V.sel = null; change(); status(`Deleted the ${DV_WHAT[it.kind].toLowerCase()} · Undo brings it back`); }
function undo() { const u = V.undo.pop(); if (u == null) { status('Nothing to undo'); return; } (V.redo ||= []).push(JSON.stringify(V.items)); V.items = JSON.parse(u); if (V.sel && !itemById(V.sel)) V.sel = null; change(); status('Undid the last change · Redo puts it back'); }
function redo() { const r = (V.redo ||= []).pop(); if (r == null) { status('Nothing to redo'); return; } V.undo.push(JSON.stringify(V.items)); V.items = JSON.parse(r); if (V.sel && !itemById(V.sel)) V.sel = null; change(); status('Redid it'); }

/* ---- saving: as you go, a moment after the last change; the status line says where (no "Saving…" flashes: QC 96) ---- */
let saveT = 0, saving = null;
function queueSave() { clearTimeout(saveT); V.save.state = 'pending'; saveT = setTimeout(flushSave, 400); }
async function flushSave() {
  clearTimeout(saveT); if (V.save.state !== 'pending' && V.save.state !== 'error') return saving;
  const a = vapi(); if (!a) return; V.save.state = 'busy';
  saving = (async () => {
    try { const r = await a.annotations_save(V.items, V.R?.id || ''); if (r?.status !== 'success') throw new Error(r?.message || 'The notes weren’t saved.');
      if (V.save.state === 'busy') V.save = { state: 'saved', err: '' }; }
    catch (e) { V.save = { state: 'error', err: String(e.message || e) }; }
    paintStatus();
  })();
  return saving;
}
addEventListener('pagehide', () => { if (V.save.state === 'pending') flushSave(); });

/* ---- the chrome: drawn into slots; the pages themselves are drawn once per zoom ---- */
const tip = (act, icon, label, o = {}) => `<button class="icon-btn icon-btn--sm${o.cls ? ' ' + o.cls : ''}" data-act="${act}"${o.v != null ? ` data-v="${esc(o.v)}"` : ''} aria-label="${esc(label)}" data-tip="${esc(label + (o.key ? ' · ' + o.key : ''))}"${o.on !== undefined ? ` aria-pressed="${!!o.on}"` : ''}${o.off ? ' disabled' : ''}>${ic(icon)}</button>`;
const ready = () => V.state === 'ready';
function toolsHtml() {
  const vertical = V.layout.bar === 'rail', off = !ready();
  return `<div class="dv-tools${V.layout.bar === 'panel' ? ' is-panel' : ''}" role="toolbar" aria-label="Annotate"${vertical ? ' aria-orientation="vertical"' : ''}>${DV_TOOLS.map(([v, i, l]) => tip('tool', i, l, { v, on: V.tool === v, cls: 'dv-t', off })).join('')}<span class="dv-sep"></span>`
    + DV_COLOURS.map(([v, l]) => `<button class="dv-sw" data-act="col" data-v="${v}" aria-label="${l}" data-tip="${l}" aria-pressed="${V.col === v}"${off ? ' disabled' : ''}></button>`).join('')
    + `<span class="dv-sep"></span>${tip('undo', 'dvundo', 'Undo', { key: 'Ctrl+Z', off: off || !V.undo.length })}</div>`;
}
// R70, the chosen design "Pro editor": a dense ribbon with labelled groups, named colour squares, a dark canvas and notes as rows.
// It's the tools bar under the window bar (R66's place, a setting, top by default); the other places keep their compact bars.
const DV_GROUPS = { mark: ['select', 'pin', 'texthl', 'text', 'pen'], shapes: ['arrow', 'box', 'hl', 'cap'] };
function ribbonHtml() {
  const off = !ready(), n = V.pages.length, tool = v => { const [, i, l] = DV_TOOLS.find(t => t[0] === v); return tip('tool', i, l, { v, on: V.tool === v, cls: 'dv-t', off }); };
  const grp = (label, inner) => `<div class="dv-rg" role="group" aria-label="${label}"><div class="dv-rgi">${inner}</div><span class="dv-rgl">${label}</span></div>`;
  const view = (V.layout.side === 'right' ? tip('navt', 'dvpages', V.nav === 'hidden' ? 'Show pages' : 'Hide pages', { on: V.nav !== 'hidden' }) : '')
    + `${tip('zoom', 'dvzout', 'Zoom out', { v: 'out', key: 'Ctrl+-', off })}<span class="dv-zv num">${Math.round(V.zoom * 100)}%</span>${tip('zoom', 'dvzin', 'Zoom in', { v: 'in', key: 'Ctrl+=', off })}`
    + `${tip('zoom', 'dvfit', 'Fit to width, once', { v: 'fit', key: 'Ctrl+0', off })}<span class="dv-pg num">${n ? `${V.cur} / ${n}` : '–'}</span>${V.notesHidden ? tip('notest', 'dvnotes', 'Show notes', { on: false }) : ''}`;
  const cols = `<span class="dv-sqs" role="group" aria-label="Colour">${DV_COLOURS.map(([v, l]) => `<button class="dv-sq" data-act="col" data-v="${v}" aria-label="${l}" data-tip="${l}" aria-pressed="${V.col === v}"${off ? ' disabled' : ''}><i class="dv-c-${v}"></i><span>${l}</span></button>`).join('')}</span>`;
  const hist = tip('undo', 'dvundo', 'Undo', { key: 'Ctrl+Z', off: off || !V.undo.length }) + tip('redo', 'dvredo', 'Redo', { key: 'Ctrl+Y', off: off || !(V.redo || []).length });
  const file = `${tip('find', 'search', 'Find in the document', { on: !!V.find, key: 'Ctrl+F', off })}<button class="btn btn--secondary btn--sm" data-act="save-copy"${off ? ' disabled' : ''}>Save an annotated copy…</button>`;
  return `<div class="dv-ribbon" role="toolbar" aria-label="Tools">${grp('View', view)}<div class="dv-tools dv-tools--ribbon" role="group" aria-label="Annotate">${grp('Mark', DV_GROUPS.mark.map(tool).join(''))}${grp('Shapes', DV_GROUPS.shapes.map(tool).join(''))}</div>${grp('Colour', cols)}${grp('History', hist)}<span class="dv-fill"></span>${grp('File', file)}</div>`;
}
function viewHtml() {
  const n = V.pages.length, hideBtn = V.layout.side === 'right';
  return `<div class="dv-view" role="toolbar" aria-label="View">${hideBtn ? tip('navt', 'dvpages', V.nav === 'hidden' ? 'Show pages' : 'Hide pages', { on: V.nav !== 'hidden' }) : ''}`
    + `${tip('zoom', 'dvzout', 'Zoom out', { v: 'out', key: 'Ctrl+-', off: !ready() })}<span class="dv-zv num">${Math.round(V.zoom * 100)}%</span>${tip('zoom', 'dvzin', 'Zoom in', { v: 'in', key: 'Ctrl+=', off: !ready() })}`
    + `${tip('zoom', 'dvfit', 'Fit to width', { v: 'fit', key: 'Ctrl+0', off: !ready() })}<span class="dv-pg num">${n ? `${V.cur} / ${n}` : '–'}</span></div>`;
}
function rightHtml() {
  return `<div class="dv-right">${tip('find', 'search', 'Find in the document', { on: !!V.find, key: 'Ctrl+F', off: !ready() })}<button class="btn btn--secondary btn--sm" data-act="save-copy"${ready() ? '' : ' disabled'}>Save an annotated copy…</button>`
    + `${V.layout.side === 'right' ? tip('notest', 'dvnotes', V.notesHidden ? 'Show notes' : 'Hide notes', { on: !V.notesHidden }) : ''}</div>`;
}
function wbarHtml() {
  const n = V.pages.length, from = V.info?.from;
  const meta = [n ? `${n} page${n === 1 ? '' : 's'}` : '', from ? `from ${from}` : ''].filter(Boolean).join(' · ');
  const ctrls = `<div class="win-controls"><button class="win-btn" data-act="win" data-v="min" aria-label="Minimise">${ic('winmin')}</button><button class="win-btn" data-act="win" data-v="max" aria-label="${V.max ? 'Restore down' : 'Maximise'}">${ic(V.max ? 'winrestore' : 'winmax')}</button><button class="win-btn win-btn--close" data-act="win" data-v="close" aria-label="Close">${ic('x')}</button></div>`;
  if (EMBED) return V.layout.bar === 'top' ? '' : `<span class="dv-fill"></span>${viewHtml() + rightHtml()}`;
  const dock = V.info?.can_dock ? `<button class="btn btn--ghost btn--sm dv-dock" data-act="dock">${ic('dvdock')}Back into a tab</button>` : '';
  return `<span class="dv-wfile">${ic(V.kind === 'docx' ? 'file' : 'filepdf')}<span class="dv-wname truncate">${esc(V.name || 'Document')}</span>${meta ? `<span class="dv-wmeta truncate">${esc(meta)}</span>` : ''}</span><span class="dv-fill" data-drag></span>${V.layout.bar === 'top' ? '' : viewHtml() + rightHtml()}${dock}${ctrls}`;
}
function thumbsHtml() {
  const cnt = {}; V.items.forEach(it => { cnt[it.page] = (cnt[it.page] || 0) + 1; });
  return `<div class="dv-thumbs">${V.pages.map((p, i) => { const n = i + 1, c = cnt[n] || 0, w = 72, h = Math.round(w * p.h / p.w);
    return `<div class="dv-th"><button class="dv-thumb" data-act="page" data-v="${n}" style="height:${h}px" aria-label="Page ${n}${c ? `, ${c} note${c === 1 ? '' : 's'}` : ''}"${n === V.cur ? ' aria-current="true"' : ''}>${V.thumbs[n] ? `<img src="${V.thumbs[n]}" alt="" width="${w}" height="${h}">` : ''}${c ? `<b class="dv-tcnt num">${c}</b>` : ''}</button><span class="dv-tn num">${n}</span></div>`; }).join('')}</div>`;
}
const outlineHtml = () => V.outline.length ? `<div class="dv-outline">${V.outline.map(o => `<button class="dv-ol${o.level === 1 ? ' is-sub' : o.level > 1 ? ' is-sub2' : ''}" data-act="page" data-v="${o.page}"><span class="truncate">${esc(o.title)}</span><span class="dv-olp num">${o.page}</span></button>`).join('')}</div>`
  : `<div class="dv-navnone">This ${docWord()} has no outline.</div>`;
function noteListHtml() {
  if (!V.items.length) return `<div class="dv-nempty"><b>No notes yet</b><span>Pick Pin a note, then click the page. Or select some text and pick Highlight text.</span></div>`;
  const nos = pinNos();
  return `<ol class="dv-nl">${ordered().map(it => { const cur = V.sel === it.id, words = it.note || (it.kind === 'cap' || it.kind === 'text' ? it.text : ''), what = DV_WHAT[it.kind];
    const badge = it.kind === 'pin' ? `<span class="dv-nb num">${nos[it.id]}</span>` : `<span class="dv-nb is-ic">${ic(DV_ICON_OF[it.kind])}</span>`;
    const quote = it.quote && it.kind === 'texthl' ? `<span class="dv-nq">“${esc(it.quote.slice(0, 90))}”</span>` : '';
    return `<li class="dv-n${words ? '' : ' is-empty'}"><button class="dv-note" data-act="go" data-v="${it.id}"${cur ? ' aria-current="true"' : ''}>${badge}${words ? `<span class="dv-nt">${esc(words)}</span>` : `<span class="dv-nt dv-nk">${what} · page ${it.page}</span>`}<span class="dv-nm num">p.${it.page}</span>${quote}</button>`
      + (cur ? `<div class="dv-nedit"><textarea class="field" id="dv-note-in" data-act="note-in" data-v="${it.id}" aria-label="Note on this ${what.toLowerCase()}" placeholder="Type a note">${esc(it.note)}</textarea><button class="btn btn--ghost btn--sm" data-act="del" data-v="${it.id}">${ic('trash')}Delete</button></div>`
        : words ? '' : `<input class="field dv-in" data-act="note-in" data-v="${it.id}" placeholder="Type a note" aria-label="Note for the ${what.toLowerCase()} on page ${it.page}" autocomplete="off">`) + '</li>'; }).join('')}</ol><p class="dv-nfoot">Click a note to jump to it.</p>`;
}
function leftHtml() {
  if (V.layout.side === 'tabs') {
    const tabs = [['notes', `Notes · ${V.items.length}`], ['pages', 'Pages'], ['outline', 'Outline']];
    return `<div class="seg seg--full dv-navseg" role="group" aria-label="Show">${tabs.map(([v, l]) => `<button class="seg-opt" data-act="ptab" data-v="${v}" aria-pressed="${V.ptab === v}">${l}</button>`).join('')}</div>
      <div class="dv-sidebody">${V.ptab === 'pages' ? thumbsHtml() : V.ptab === 'outline' ? outlineHtml() : noteListHtml()}</div>`;
  }
  const nav = V.nav || (V.kind === 'docx' ? 'outline' : 'pages');
  return `<div class="seg seg--full dv-navseg" role="group" aria-label="Show">${[['pages', 'Pages'], ['outline', 'Outline']].map(([v, l]) => `<button class="seg-opt" data-act="nav" data-v="${v}" aria-pressed="${nav === v}">${l}</button>`).join('')}</div>${nav === 'pages' ? thumbsHtml() : outlineHtml()}`;
}
const notesHtml = () => `<div class="dv-nh"><span>Notes on this file</span><span class="dv-nc num">${V.items.length}</span>${V.layout.side === 'right' && V.layout.bar === 'top' ? tip('notest', 'dvnotes', 'Hide notes', { on: true }) : ''}</div>${noteListHtml()}`;
function statusHtml() {
  const n = V.items.length, s = V.save, err = s.state === 'error';
  const saved = err ? `${ic('alert')}Not saved: ${esc(s.err)}` : `${ic('ok')}${n ? `${n} note${n === 1 ? '' : 's'}, saved` : 'Notes are saved'} beside the file · the ${docWord()} isn’t changed`;
  const tp = `<button class="dv-tplace" data-act="tools-menu" aria-haspopup="menu" aria-expanded="${!!V.tmenu}">Tools: ${dvPlace(V.layout.bar)[1]}</button>`;
  return `<span class="num">${V.pages.length ? `Page ${V.cur} of ${V.pages.length} · ${Math.round(V.zoom * 100)}%` : ''}</span><span class="dv-st-msg truncate">${esc(V.status)}</span>${tp}<span class="dv-st-save${err ? ' is-error' : ''}" role="status">${saved}</span>`;
}
// Tools: … in the status line: the six places, the one in use ticked; a pick moves the tools now and is remembered
const toolsMenuHtml = () => !V.tmenu ? '' : `<div class="menu card dv-tmenu" role="menu" aria-label="Where the tools sit">${DV_TOOL_PLACES.map(([v, l, d]) => `<button class="menu-item" role="menuitemradio" data-act="tools-place" data-v="${v}" aria-checked="${V.layout.bar === v}"><span class="dv-tm-t"><span>${l}</span><span class="dv-tm-d">${esc(d)}</span></span></button>`).join('')}</div>`;
function placeToolsMenu() { const m = app.querySelector('.dv-tmenu'), b = app.querySelector('.dv-tplace'); if (!m || !b) return; const A = app.getBoundingClientRect(), r = b.getBoundingClientRect();
  m.style.left = Math.max(8, Math.min(r.left - A.left, A.width - m.offsetWidth - 8)) + 'px'; m.style.bottom = (A.bottom - r.top + 6) + 'px'; }
async function setTools(bar, save) {
  V.tmenu = false; if (!DV_TOOL_PLACES.some(p => p[0] === bar)) return;
  if (bar !== V.layout.bar) {
    const box = dvPages(), keep = box ? box.scrollTop / Math.max(1, box.scrollHeight) : 0;
    V.layout.bar = bar; V.ctx = null; build(); if (ready()) layoutPages(); paint(); const nb = dvPages(); if (nb && ready()) nb.scrollTop = keep * nb.scrollHeight;
    if (V.find?.q) runFind(false);
  } else paint();
  if (save) { const r = await vapi()?.set_tools(bar); status(r?.status === 'success' ? `Tools: ${dvPlace(bar)[1]}. Remembered for every document` : r?.message || 'The place for the tools wasn’t saved'); }
}
// Beside what you pick: the tools follow the last click or selection on a page, and step aside while the pages scroll
function placeCtx() {
  const el = slot('ctx'), doc = app.querySelector('.dv-doc'); if (!el || !doc) return; el.hidden = !!V.ctxHidden || !ready(); if (el.hidden || !V.ctx) { el.style.left = el.style.top = ''; return; }
  const w = el.offsetWidth, h = el.offsetHeight, W = doc.clientWidth, H = doc.clientHeight;
  // centred under the click, but kept 8px inside the pages (near an edge, or in a small window, it moves in rather than spill
  // over the side panels); when the bar is wider than the room, it's centred in it
  el.style.left = (w + 16 > W ? W / 2 : Math.max(w / 2 + 8, Math.min(V.ctx.x, W - w / 2 - 8))) + 'px'; el.style.top = Math.max(8, Math.min(V.ctx.y + 16, H - h - 8)) + 'px';
}
function findHtml() {
  const f = V.find; if (!f) return '';
  return `<div class="dv-find" role="search"><span class="dv-find-ic">${ic('search')}</span><input class="dv-find-in" id="dv-find-in" data-act="find-q" value="${esc(f.q)}" aria-label="Find in the document" placeholder="Find" autocomplete="off" spellcheck="false"><span class="dv-find-n num">${f.q ? (f.hits ? `${f.ix + 1} of ${f.hits}` : 'No matches') : ''}</span>`
    + `${tip('find-prev', 'dvup', 'Previous match', { off: !f.hits })}${tip('find-next', 'dvdown', 'Next match', { off: !f.hits })}${tip('find-close', 'x', 'Close find', { key: 'Esc' })}</div>`;
}
function dlgHtml() {
  if (V.dlg !== 'save') return '';
  const kinds = V.info?.copy_kinds || ['pdf'], stem = V.name.replace(/\.[^.]+$/, ''), n = V.pages.length;
  const say = { pdf: ['A PDF with your notes on the pages', `${stem} (annotated).pdf, beside the original · your notes listed on a last page`], png: ['A picture of each page', `${n} PNG file${n === 1 ? '' : 's'} beside the original`] };
  V.copyKind = kinds.includes(V.copyKind) ? V.copyKind : kinds[0];
  const opts = kinds.length > 1 ? `<div class="dv-opts" role="radiogroup" aria-label="Make">${kinds.map(k => `<label class="dv-opt"><input type="radio" name="dv-copy" data-act="copy-kind" value="${k}"${k === V.copyKind ? ' checked' : ''}><span><b>${say[k][0]}</b><span class="set-desc">${esc(say[k][1])}</span></span></label>`).join('')}</div>`
    : `<p class="set-desc"><b>${say[kinds[0]][0]}</b>: ${esc(say[kinds[0]][1])}.</p>`;
  return `<div class="modal-backdrop dv-mb"><div class="modal modal--sm card" role="dialog" aria-modal="true" aria-labelledby="dv-save-t"><div class="modal-head"><h2 class="modal-title" id="dv-save-t">Save an annotated copy</h2>${tip('dlg-cancel', 'x', 'Close', { key: 'Esc' })}</div>
    <div class="modal-body"><p class="set-desc">Your notes are already saved beside the file as you go. This makes a copy with them drawn in, to send or print. The original isn’t changed.</p>${opts}</div>
    <div class="modal-foot"><button class="btn btn--secondary" data-act="dlg-cancel"${V.busy ? ' disabled' : ''}>Cancel</button><button class="btn btn--primary" data-act="dlg-save"${V.busy ? ' disabled' : ''}>${V.busy ? '<span class="spinner" aria-hidden="true"></span>Saving the copy…' : 'Save the copy'}</button></div></div></div>`;
}
function emptyHtml() {
  if (V.state === 'loading') return '';
  const lib = V.kind === 'docx' ? ['the Word reader', V.info?.versions?.docx || 'docx-preview'] : ['the PDF reader', V.info?.versions?.pdfjs || 'PDF.js'];
  const h = V.state === 'missing' ? `This ${docWord()} needs ${lib[0]}` : `${esc(V.name)} couldn’t be shown`;
  const p = V.state === 'missing' ? `NeuroVault’s viewer draws ${V.kind === 'docx' ? 'Word files' : 'PDFs'} with ${esc(lib[1])}, which isn’t installed yet. Your notes on this file are kept.` : esc(V.msg);
  return `<div class="dv-empty card"><h2>${h}</h2><p>${p}</p><button class="btn btn--secondary btn--sm" data-act="open-default">Open in your default app</button></div>`;
}
function build() {   // once: the slots
  const L = V.layout;
  app.dataset.bar = L.bar; app.dataset.side = L.side; app.dataset.flow = L.flow;
  V.ctxHidden = false;
  app.innerHTML = `<div class="dv-wbar" data-slot="wbar"></div>${L.bar === 'top' ? '<div class="dv-bar" data-slot="bar"></div>' : ''}<div class="dv-body">`
    + `<aside class="${L.side === 'tabs' ? 'dv-side' : 'dv-nav'}" data-slot="left" aria-label="${L.side === 'tabs' ? 'Notes, pages and outline' : 'Pages and outline'}"></aside>${L.bar === 'rail' ? '<div class="dv-rail" data-slot="rail"></div>' : ''}`
    + `<div class="dv-doc">${L.bar === 'float' ? '<div class="dv-float" data-slot="float"></div>' : L.bar === 'context' ? '<div class="dv-ctx" data-slot="ctx"></div>' : ''}<div data-slot="find"></div><div class="dv-pages" id="dv-pages" tabindex="-1"></div></div>`
    + `${L.side === 'right' ? '<aside class="dv-notes" data-slot="notes" aria-label="Notes on this file"></aside>' : ''}</div>${L.bar === 'bottom' ? '<div class="dv-bbar" data-slot="bbar"></div>' : ''}<div class="dv-st" data-slot="st"></div><div data-slot="dlg"></div><div data-slot="tmenu"></div>`;
  dvPages().addEventListener('scroll', onScroll, { passive: true });
}
const slot = k => app.querySelector(`[data-slot="${k}"]`);
const drawnHtml = new WeakMap();   // what each slot shows now, so an unchanged part isn't drawn again (focus and scroll stay)
function put(k, html) { const el = slot(k); if (el && drawnHtml.get(el) !== html) { el.innerHTML = html; drawnHtml.set(el, html); } }
function paint() {
  app.dataset.tool = V.tool;
  const wb = wbarHtml(), ws = slot('wbar'); if (ws) ws.hidden = !wb; put('wbar', wb);
  const bar = V.layout.bar, tsec = bar === 'panel' ? `<div class="dv-tsec"><div class="dv-nh"><span>Tools</span></div>${toolsHtml()}</div>` : '';
  if (bar === 'top') put('bar', ribbonHtml());
  else if (bar !== 'panel') put({ rail: 'rail', float: 'float', bottom: 'bbar', context: 'ctx' }[bar] || 'float', toolsHtml());
  const left = slot('left'); if (left) { left.hidden = V.nav === 'hidden'; left.classList.toggle('is-outline', V.layout.side === 'right' && (V.nav || (V.kind === 'docx' ? 'outline' : 'pages')) === 'outline'); if (V.editing && V.layout.side === 'tabs') { /* typing a note */ } else put('left', (V.layout.side === 'tabs' ? tsec : '') + leftHtml()); }
  const notes = slot('notes'); if (notes) { notes.hidden = !!V.notesHidden && bar !== 'panel'; if (!V.editing) put('notes', tsec + notesHtml()); }
  put('find', findHtml()); paintStatus(); put('dlg', dlgHtml()); put('tmenu', toolsMenuHtml()); placeToolsMenu(); if (bar === 'context') placeCtx();
  if (!ready()) { const pg = dvPages(); if (pg && pg.dataset.empty !== V.state + V.msg) { pg.innerHTML = emptyHtml(); pg.dataset.empty = V.state + V.msg; } }
  afterRender();
}
function paintStatus() { put('st', statusHtml()); }

/* ---- the pages: a box per page at the zoom, drawn when it scrolls into view ---- */
let io = null;
function layoutPages() {
  const box = dvPages(); if (!box) return; box.dataset.empty = ''; V.drawn = {};
  io?.disconnect(); io = new IntersectionObserver(es => es.forEach(e => { if (e.isIntersecting) drawPage(+e.target.dataset.page); }), { root: box, rootMargin: '600px 0px' });
  box.innerHTML = V.pages.map((p, i) => `<div class="dv-page${i + 1 === V.cur ? ' is-cur' : ''}" data-page="${i + 1}" role="region" aria-label="Page ${i + 1} of ${V.pages.length}" style="width:${Math.round(p.w * V.zoom)}px;height:${Math.round(p.h * V.zoom)}px"><div class="dv-content"></div><div class="dv-ink" data-page="${i + 1}"></div></div>`).join('')
    + `<div class="dv-pnav">${tip('page-prev', 'dvprev', 'Previous page')}<span class="num">Page ${V.cur} of ${V.pages.length}</span>${tip('page-next', 'dvnext', 'Next page')}</div>`;
  box.querySelectorAll('.dv-page').forEach(el => io.observe(el));
  paintInkAll(); [V.cur, V.cur + 1].filter(n => n <= V.pages.length).forEach(drawPage);   // the page in view at once, not only when the observer says
}
const drawing = {};
async function drawPage(n) {
  if (V.drawn[n] === V.zoom || drawing[n] === V.zoom) return; drawing[n] = V.zoom;
  const el = pageEl(n)?.querySelector('.dv-content'); if (!el) return;
  try { const tmp = document.createElement('div'); await V.rend.draw(n, tmp, V.zoom); if (drawing[n] !== V.zoom || !el.isConnected) return; el.replaceChildren(...tmp.childNodes); V.drawn[n] = V.zoom; if (V.find?.q) runFind(false); }
  catch (e) { console.warn('drawing page', n, e); el.textContent = ''; }
  finally { if (drawing[n] === V.zoom) delete drawing[n]; }
}
async function drawAll() { for (let n = 1; n <= V.pages.length; n++) await drawPage(n); }
function setZoom(z, fit = false) {
  const box = dvPages(); const keep = box ? (box.scrollTop + box.clientHeight / 3) / Math.max(1, box.scrollHeight) : 0;
  V.zoom = Math.round(Math.max(.25, Math.min(4, z)) * 100) / 100; V.fit = fit; layoutPages(); paint();
  if (box) box.scrollTop = keep * box.scrollHeight - box.clientHeight / 3;
}
// Fit to width, but never edge to edge on a wide screen (the user's ultrawide rule; the note page stops at 1,320px): a page is
// at most DV_PAGE_MAX px wide, centred, so its text stays about the size of the note's (cohesion review v0.1.1, should-fix 11)
function fitZoom() {
  const box = dvPages(); if (!box || !V.pages.length) return 1;
  const w = Math.max(...V.pages.map(p => p.w)), room = box.clientWidth - 48, each = V.layout.flow === 'spread' ? (room - 24) / 2 : room;
  return Math.max(.25, Math.min(3, Math.min(each, DV_PAGE_MAX) / w));
}
function zoomStep(dir) { V.fitFirst = false; const z = V.zoom; const next = dir > 0 ? DV_ZOOMS.find(x => x > z + .001) : [...DV_ZOOMS].reverse().find(x => x < z - .001); if (next) setZoom(next); }
let scrollRaf = 0;
function onScroll() { if (V.layout.bar === 'context' && V.ctx && !V.ctxHidden) { V.ctxHidden = true; placeCtx(); } if (scrollRaf) return; scrollRaf = requestAnimationFrame(() => { scrollRaf = 0; const box = dvPages(); if (!box || V.layout.flow === 'single') return; const at = box.getBoundingClientRect().top + box.clientHeight / 3;
  let cur = 1; box.querySelectorAll('.dv-page').forEach(p => { if (p.getBoundingClientRect().top <= at) cur = +p.dataset.page; }); if (cur !== V.cur) { V.cur = cur; markCur(); paint(); } }); }
function markCur() { app.querySelectorAll('.dv-page').forEach(p => p.classList.toggle('is-cur', +p.dataset.page === V.cur)); const s = app.querySelector('.dv-pnav .num'); if (s) s.textContent = `Page ${V.cur} of ${V.pages.length}`; }
function goPage(n, el) {
  n = Math.max(1, Math.min(V.pages.length, +n || 1)); V.cur = n; markCur();
  const box = dvPages(), pg = pageEl(n); if (box && pg && V.layout.flow !== 'single') { const r = el?.getBoundingClientRect(), b = box.getBoundingClientRect(); box.scrollTop += r ? r.top - b.top - box.clientHeight / 2 : pg.getBoundingClientRect().top - b.top - 16; }
  drawPage(n); paint();
}

/* ---- what you add, drawn over each page in percent of it ---- */
const colourOf = k => DV_COLOURS.find(c => c[0] === k)?.[2] || DV_COLOURS[0][2];
function inkHtml(n) {
  const p = V.pages[n - 1]; if (!p) return ''; const a = p.h / p.w, Y = v => (v * a).toFixed(3), nos = pinNos(), sel = id => V.sel === id ? ' is-sel' : '';
  let svg = '', marks = '';
  for (const it of V.items.filter(x => x.page === n)) {
    const c = `dv-c-${it.colour}`, [x0, y0, x1, y1] = it.pts, d = `data-id="${it.id}"`;
    if (it.kind === 'texthl') svg += it.rects.map(r => `<rect class="dv-t${sel(it.id)}" ${d} x="${r[0]}" y="${Y(r[1])}" width="${r[2]}" height="${Y(r[3])}"/>`).join('');
    else if (it.kind === 'box') svg += `<rect class="dv-s ${c}${sel(it.id)}" ${d} x="${Math.min(x0, x1)}" y="${Y(Math.min(y0, y1))}" width="${Math.abs(x1 - x0)}" height="${Y(Math.abs(y1 - y0))}"/>`;
    else if (it.kind === 'hl') svg += `<rect class="dv-a ${c}${sel(it.id)}" ${d} x="${Math.min(x0, x1)}" y="${Y(Math.min(y0, y1))}" width="${Math.abs(x1 - x0)}" height="${Y(Math.abs(y1 - y0))}"/>`;
    else if (it.kind === 'arrow') { const ang = Math.atan2((y1 - y0) * a, x1 - x0), L = 2.4, hx = t => (x1 - L * Math.cos(ang + t)).toFixed(3), hy = t => (y1 * a - L * Math.sin(ang + t)).toFixed(3);
      svg += `<path class="dv-s ${c}${sel(it.id)}" ${d} d="M${x0} ${Y(y0)} L${x1} ${Y(y1)} M${hx(-.45)} ${hy(-.45)} L${x1} ${Y(y1)} L${hx(.45)} ${hy(.45)}"/>`; }
    else if (it.kind === 'pen') svg += `<polyline class="dv-s ${c}${sel(it.id)}" ${d} points="${it.pts.reduce((s, v, i) => s + (i % 2 ? `,${Y(v)} ` : v), '')}"/>`;
    else if (it.kind === 'pin') marks += `<button class="dv-mark dv-pin num${sel(it.id)}" ${d} data-act="mark" data-v="${it.id}" style="left:${x0}%;top:${y0}%" aria-label="Pin ${nos[it.id]}${it.note ? ': ' + esc(it.note.slice(0, 80)) : ''}">${nos[it.id]}</button>`;
    else if (it.kind === 'text') marks += `<span class="dv-mark dv-text ${c}${sel(it.id)}" ${d} data-act="mark" data-v="${it.id}" style="left:${x0}%;top:${y0}%;font-size:${Math.round(15 * V.zoom)}px">${esc(it.text)}</span>`;
    else if (it.kind === 'cap') marks += `<span class="dv-mark dv-capn${sel(it.id)}" ${d} data-act="mark" data-v="${it.id}" style="left:${x0}%;top:${y0}%">${ic('dvcap')}<span>${esc(it.text)}</span></span>`;
  }
  const t = V.typing?.page === n ? `<input class="field dv-typein" id="dv-typein" style="left:${V.typing.pts[0]}%;top:${V.typing.pts[1]}%" placeholder="${V.typing.kind === 'cap' ? 'A caption, then Enter' : 'Type, then Enter'}" aria-label="${V.typing.kind === 'cap' ? 'Caption' : 'Text on the page'}" autocomplete="off">` : '';
  return `<svg class="dv-svg" viewBox="0 0 100 ${(100 * a).toFixed(3)}" preserveAspectRatio="none" aria-hidden="true">${svg}${V.preview?.page === n ? V.preview.svg : ''}</svg>${marks}${t}`;
}
function paintInk(n) { const el = app.querySelector(`.dv-ink[data-page="${n}"]`); if (el) { const h = inkHtml(n); if (drawnHtml.get(el) !== h) { el.innerHTML = h; drawnHtml.set(el, h); } } }
function paintInkAll() { for (let n = 1; n <= V.pages.length; n++) paintInk(n); if (V.typing) document.getElementById('dv-typein')?.focus(); }
const pct = (el, e) => { const r = el.getBoundingClientRect(); return [Math.max(0, Math.min(100, (e.clientX - r.left) / r.width * 100)), Math.max(0, Math.min(100, (e.clientY - r.top) / r.height * 100))]; };
const r3 = v => Math.round(v * 1000) / 1000;
// the shape being dragged, alone: never the last frame's preview (that left every in-between arrow drawn, the user's "smear")
function previewSvg(it, n) { const keep = V.items, kp = V.preview; V.items = [it]; V.preview = null; const h = inkHtml(n).match(/<svg[^>]*>([\s\S]*)<\/svg>/)?.[1] || ''; V.items = keep; V.preview = kp; return h; }
app.addEventListener('pointerdown', e => {
  const ink = e.target.closest?.('.dv-ink'); if (!ink || e.button !== 0 || !ready()) return;
  const n = +ink.dataset.page, mark = e.target.closest('[data-id]');
  if (mark && (V.tool === 'select' || mark.classList.contains('dv-mark'))) { e.preventDefault(); selectItem(mark.dataset.id); if (V.tool === 'select') dragMark(mark.dataset.id, ink, e); return; }
  if (e.target.closest('.dv-typein')) return;
  if (V.tool === 'select' || V.tool === 'texthl') return;
  e.preventDefault(); const [x, y] = pct(ink, e);
  if (V.tool === 'pin') { const quote = V.rend.quoteNear ? V.rend.quoteNear(n, ink, x, y) : ''; addItem({ kind: 'pin', page: n, pts: [r3(x), r3(y)], quote }); status('Pinned · type its note at the right'); requestAnimationFrame(() => document.getElementById('dv-note-in')?.focus()); return; }
  if (V.tool === 'text' || V.tool === 'cap') { V.typing = { kind: V.tool, page: n, pts: [r3(x), r3(y)] }; paintInk(n); document.getElementById('dv-typein')?.focus(); return; }
  const it = { kind: V.tool, page: n, colour: V.col, pts: V.tool === 'pen' ? [x, y] : [x, y, x, y] };
  const mv = ev => { const [a, b] = pct(ink, ev); if (it.kind === 'pen') { const l = it.pts.length; if (Math.hypot(a - it.pts[l - 2], b - it.pts[l - 1]) > .35) it.pts.push(a, b); } else { it.pts[2] = a; it.pts[3] = b; } V.preview = { page: n, svg: previewSvg({ ...it, id: 'preview' }, n) }; paintInk(n); };
  const up = () => { removeEventListener('pointermove', mv, true); removeEventListener('pointerup', up, true); V.preview = null;
    const big = it.kind === 'pen' ? it.pts.length >= 6 : Math.hypot(it.pts[2] - it.pts[0], it.pts[3] - it.pts[1]) > .8;
    if (big) { it.pts = it.pts.map(r3); addItem(it); status(`${DV_WHAT[it.kind]} added · Undo takes it off`); } else paintInk(n); };
  addEventListener('pointermove', mv, true); addEventListener('pointerup', up, true);
});
function dragMark(id, ink, e) {   // Select: a pin, a word or a caption moves with the mouse
  const it = itemById(id); if (!it || !['pin', 'text', 'cap'].includes(it.kind)) return; const start = [e.clientX, e.clientY], from = [...it.pts]; let moved = false;
  const mv = ev => { if (!moved && Math.hypot(ev.clientX - start[0], ev.clientY - start[1]) < 4) return; if (!moved) { snap(); moved = true; } const [x, y] = pct(ink, ev); it.pts = [r3(x), r3(y)]; paintInk(it.page); };
  const up = () => { removeEventListener('pointermove', mv, true); removeEventListener('pointerup', up, true); if (moved) { it.updated = nowIso(); change(); status(`Moved the ${DV_WHAT[it.kind].toLowerCase()}`); } else it.pts = from; };
  addEventListener('pointermove', mv, true); addEventListener('pointerup', up, true);
}
function selectItem(id, jump = false) {
  V.sel = id; V.editing = null; const it = itemById(id); paintInkAll(); paint();
  if (it && jump) { const el = app.querySelector(`.dv-ink[data-page="${it.page}"] [data-id="${id}"]`); goPage(it.page, el); }
  app.querySelector(`.dv-note[aria-current="true"]`)?.scrollIntoView({ block: 'nearest' });
}
// Highlight text: the words selected on a page become boxes in percent of it
function highlightSelection() {
  const s = getSelection(); if (!s || s.isCollapsed || !s.rangeCount) return false;
  const r = s.getRangeAt(0), host = (r.commonAncestorContainer.nodeType === 1 ? r.commonAncestorContainer : r.commonAncestorContainer.parentElement)?.closest('.dv-page'); if (!host) return false;
  const pb = host.getBoundingClientRect(), rects = [...r.getClientRects()].filter(x => x.width > 1 && x.height > 1).slice(0, 400)
    .map(x => [r3((x.left - pb.left) / pb.width * 100), r3((x.top - pb.top) / pb.height * 100), r3(x.width / pb.width * 100), r3(x.height / pb.height * 100)]).filter(q => q[2] > 0 && q[3] > 0);
  const quote = s.toString().replace(/\s+/g, ' ').trim().slice(0, 500); if (!rects.length || !quote) return false;
  s.removeAllRanges(); addItem({ kind: 'texthl', page: +host.dataset.page, rects, quote }); status('Highlighted · type a note at the right if you like'); return true;
}
document.addEventListener('pointerup', e => {
  if (V.tool === 'texthl' && ready()) setTimeout(highlightSelection, 0);
  const pages = e.target.closest?.('.dv-pages'); if (V.layout.bar === 'context' && pages && ready()) { const d = app.querySelector('.dv-doc').getBoundingClientRect(); V.ctx = { x: e.clientX - d.left, y: e.clientY - d.top }; V.ctxHidden = false; placeCtx(); }
});

/* ---- find in the document: every match marked on the pages' text, the current one stronger ---- */
function clearHits() { app.querySelectorAll('mark.dv-hit').forEach(m => { const p = m.parentNode; m.replaceWith(...m.childNodes); p.normalize(); }); }
function runFind(jump = true) {
  const f = V.find; clearHits(); if (!f) return; const q = f.q.trim().toLowerCase(); f.hits = 0; if (!q) { f.ix = 0; put('find', findHtml()); return; }
  app.querySelectorAll('.dv-page').forEach(pg => { const root = pg.querySelector('.dv-text-root'); if (!root) return; const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT), nodes = []; while (w.nextNode()) nodes.push(w.currentNode);
    for (const t of nodes) { const low = t.data.toLowerCase(); let at = low.indexOf(q), node = t; if (at < 0) continue;
      while (at >= 0 && node) { const hit = node.splitText(at), rest = hit.splitText(q.length), m = document.createElement('mark'); m.className = 'dv-hit'; hit.replaceWith(m); m.appendChild(hit); f.hits++; node = rest; at = rest.data.toLowerCase().indexOf(q); } } });
  f.ix = f.hits ? Math.min(f.ix, f.hits - 1) : 0; showHit(jump);
}
function showHit(jump) { const f = V.find, hits = [...app.querySelectorAll('mark.dv-hit')]; hits.forEach((m, i) => m.classList.toggle('is-cur', i === f.ix)); const cur = hits[f.ix];
  if (cur && jump) goPage(+cur.closest('.dv-page').dataset.page, cur); else { const inp = document.getElementById('dv-find-in'), pos = inp?.selectionStart; put('find', findHtml()); const n = document.getElementById('dv-find-in'); if (n && inp === document.activeElement) { n.focus(); n.setSelectionRange(pos, pos); } } }
async function openFind() { if (!ready()) return; V.find = V.find || { q: '', hits: 0, ix: 0 }; paint(); document.getElementById('dv-find-in')?.focus(); await drawAll(); if (V.find?.q) runFind(false); }
function closeFind() { clearHits(); V.find = null; paint(); }

/* ---- Save an annotated copy: each page with its notes drawn in, then the notes listed on a last page ---- */
function drawItems(g, n, W, H, s) {
  const nos = pinNos(), lw = Math.max(2, .0045 * W); g.setTransform(1, 0, 0, 1, 0, 0);   // a renderer's own scale never reaches the notes
  for (const it of V.items.filter(x => x.page === n)) {
    const col = colourOf(it.colour), P = i => [it.pts[i] / 100 * W, it.pts[i + 1] / 100 * H]; g.save(); g.strokeStyle = col; g.fillStyle = col; g.lineWidth = lw; g.lineCap = 'round'; g.lineJoin = 'round';
    if (it.kind === 'texthl') { g.globalCompositeOperation = 'multiply'; g.globalAlpha = .45; g.fillStyle = '#ffe066'; it.rects.forEach(r => g.fillRect(r[0] / 100 * W, r[1] / 100 * H, r[2] / 100 * W, r[3] / 100 * H)); }
    else if (it.kind === 'box' || it.kind === 'hl') { const [a, b] = P(0), [c, d] = P(2); if (it.kind === 'hl') { g.globalAlpha = .3; g.fillRect(Math.min(a, c), Math.min(b, d), Math.abs(c - a), Math.abs(d - b)); } else g.strokeRect(Math.min(a, c), Math.min(b, d), Math.abs(c - a), Math.abs(d - b)); }
    else if (it.kind === 'arrow') { const [a, b] = P(0), [c, d] = P(2), ang = Math.atan2(d - b, c - a), L = .024 * W; g.beginPath(); g.moveTo(a, b); g.lineTo(c, d); g.moveTo(c - L * Math.cos(ang - .45), d - L * Math.sin(ang - .45)); g.lineTo(c, d); g.lineTo(c - L * Math.cos(ang + .45), d - L * Math.sin(ang + .45)); g.stroke(); }
    else if (it.kind === 'pen') { g.beginPath(); for (let i = 0; i < it.pts.length; i += 2) { const [a, b] = P(i); if (i) g.lineTo(a, b); else g.moveTo(a, b); } g.stroke(); }
    else if (it.kind === 'pin') { const [a, b] = P(0), r = 11 * s; g.fillStyle = getComputedStyle(app).getPropertyValue('--accent').trim() || '#4839e8'; g.beginPath(); g.arc(a, b, r + 2 * s, 0, 7); g.fillStyle = '#fff'; g.fill(); g.beginPath(); g.arc(a, b, r, 0, 7); g.fillStyle = getComputedStyle(app).getPropertyValue('--accent').trim() || '#4839e8'; g.fill();
      g.fillStyle = getComputedStyle(app).getPropertyValue('--on-accent').trim() || '#fff'; g.font = `700 ${11 * s}px "Segoe UI", sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(String(nos[it.id]), a, b + .5 * s); }
    else if (it.kind === 'text') { const [a, b] = P(0); g.font = `600 ${15 * s}px "Segoe Print", "Comic Sans MS", cursive`; g.textBaseline = 'bottom'; g.fillText(it.text, a, b); }
    else if (it.kind === 'cap') { const [a, b] = P(0); g.font = `600 ${11.5 * s}px "Segoe UI", sans-serif`; const w = g.measureText(it.text).width + 16 * s, h = 22 * s; g.fillStyle = '#e8eefc'; g.fillRect(a, b, w, h); g.fillStyle = '#1f2328'; g.textBaseline = 'middle'; g.fillText(it.text, a + 8 * s, b + h / 2); }
    g.restore();
  }
}
function wrapLines(g, text, width) { const out = []; for (const para of String(text).split('\n')) { let line = ''; for (const w of para.split(/\s+/)) { const t = line ? line + ' ' + w : w; if (g.measureText(t).width > width && line) { out.push(line); line = w; } else line = t; } out.push(line); } return out; }
function notesPages(W, H, s) {   // the notes, listed, on as many pages as they need
  const pages = [], nos = pinNos(), pad = 56 * s, list = ordered(); let c, g, y;
  const page = () => { c = document.createElement('canvas'); c.width = W; c.height = H; g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, W, H); g.fillStyle = '#1f2328'; g.textBaseline = 'top'; y = pad; pages.push(c); };
  page(); g.font = `700 ${20 * s}px "Segoe UI", sans-serif`; g.fillText(`Notes on ${V.name}`, pad, y); y += 34 * s;
  g.font = `400 ${11 * s}px "Segoe UI", sans-serif`; g.fillStyle = '#57606a'; g.fillText(`${list.length} note${list.length === 1 ? '' : 's'} · made in NeuroVault · ${new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}`, pad, y); y += 30 * s;
  if (!list.length) { g.fillStyle = '#1f2328'; g.font = `400 ${12 * s}px "Segoe UI", sans-serif`; g.fillText('No notes on this file.', pad, y); }
  for (const it of list) {
    g.font = `400 ${12 * s}px "Segoe UI", sans-serif`; const body = [it.kind === 'cap' || it.kind === 'text' ? it.text : '', it.note].filter(Boolean).join(' — ') || '(no note)';
    const lines = wrapLines(g, body, W - pad * 2 - 34 * s), quote = it.quote && it.kind === 'texthl' ? wrapLines(g, `“${it.quote}”`, W - pad * 2 - 34 * s).slice(0, 3) : [];
    const need = (18 + (lines.length + quote.length) * 17 + 12) * s; if (y + need > H - pad) page();
    g.fillStyle = '#57606a'; g.font = `700 ${11 * s}px "Segoe UI", sans-serif`; g.fillText(`${it.kind === 'pin' ? nos[it.id] + '  ' : ''}${DV_WHAT[it.kind]} · page ${it.page}`, pad, y); y += 18 * s;
    g.fillStyle = '#1f2328'; g.font = `400 ${12 * s}px "Segoe UI", sans-serif`; lines.forEach(l => { g.fillText(l, pad + 34 * s, y); y += 17 * s; });
    g.fillStyle = '#57606a'; g.font = `italic 400 ${12 * s}px "Segoe UI", sans-serif`; quote.forEach(l => { g.fillText(l, pad + 34 * s, y); y += 17 * s; }); y += 12 * s;
  }
  return pages;
}
async function makeCopy() {
  if (V.busy) return; V.busy = true; paint(); await flushSave();
  try {
    const s = DV_COPY_SCALE, pages = [];
    for (let n = 1; n <= V.pages.length; n++) { status(`Drawing page ${n} of ${V.pages.length}…`); const c = await V.rend.pageCanvas(n, s); drawItems(c.getContext('2d'), n, c.width, c.height, s); pages.push(c.toDataURL('image/png')); }
    if (V.copyKind !== 'png') { const p0 = V.pages[0]; notesPages(Math.round(p0.w * s), Math.round(p0.h * s), s).forEach(c => pages.push(c.toDataURL('image/png'))); }
    const r = await vapi().save_copy(V.copyKind || 'pdf', pages); if (r?.status !== 'success') throw new Error(r?.message || 'The copy wasn’t saved.');
    V.dlg = null; status(`Saved ${r.pages ? `${r.pages} pictures of the pages` : r.name} beside the original, which isn’t changed`);
  } catch (e) { status(`The copy wasn’t saved: ${e.message || e}`); }
  finally { V.busy = false; paint(); }
}

/* ---- clicks and keys ---- */
app.addEventListener('click', e => {
  if (V.tmenu && !e.target.closest('.dv-tmenu, [data-act="tools-menu"]')) { V.tmenu = false; paint(); }
  const link = e.target.closest('a[href], [data-url], .dv-link[data-page]'); if (link && link.closest('.dv-page')) { e.preventDefault(); if (link.dataset.page) goPage(link.dataset.page); else if (link.dataset.url) vapi()?.open_link(link.dataset.url).then(r => status(r?.status === 'success' ? 'Opened in your browser' : r?.message || 'That link can’t be opened')); return; }
  const t = e.target.closest('[data-act]'); if (!t || t.disabled) return; const v = t.dataset.v;
  switch (t.dataset.act) {
    case 'tool': V.editing = null; if (v === 'texthl' && highlightSelection()) { V.tool = 'select'; paint(); return; } V.tool = v; V.typing = null; paintInkAll(); paint(); status(DV_TOOL_SAID[v]); break;
    case 'col': V.col = v; paint(); status(`${t.getAttribute('aria-label')} for new marks`); { const it = itemById(V.sel); if (it && it.kind !== 'pin' && it.kind !== 'texthl') { snap(); it.colour = v; change(); } } break;
    case 'undo': undo(); break;
    case 'redo': redo(); break;
    case 'dock': flushSave().then(() => vapi()?.dock?.()); break;
    case 'go': selectItem(v, true); requestAnimationFrame(() => document.getElementById('dv-note-in')?.focus({ preventScroll: true })); break;
    case 'mark': if (V.tool !== 'select' && !t.classList.contains('dv-mark')) break; selectItem(v); break;
    case 'del': removeItem(v); break;
    case 'page': goPage(v); break;
    case 'page-prev': goPage(V.cur - 1); break;
    case 'page-next': goPage(V.cur + 1); break;
    case 'nav': V.nav = v; paint(); break;
    case 'navt': V.nav = V.nav === 'hidden' ? null : 'hidden'; paint(); break;
    case 'notest': V.notesHidden = !V.notesHidden; paint(); break;
    case 'ptab': V.ptab = v; paint(); break;
    case 'zoom': if (v === 'fit') setZoom(fitZoom(), true); else zoomStep(v === 'in' ? 1 : -1); status(`Zoom ${Math.round(V.zoom * 100)}%`); break;
    case 'find': if (V.find) closeFind(); else openFind(); break;
    case 'find-next': case 'find-prev': if (V.find?.hits) { V.find.ix = (V.find.ix + (t.dataset.act === 'find-next' ? 1 : -1) + V.find.hits) % V.find.hits; showHit(true); } break;
    case 'find-close': closeFind(); break;
    case 'save-copy': V.dlg = 'save'; paint(); app.querySelector('.dv-mb .btn--primary')?.focus(); break;
    case 'dlg-cancel': if (!V.busy) { V.dlg = null; paint(); status('Nothing was saved'); } break;
    case 'dlg-save': makeCopy(); break;
    case 'open-default': vapi()?.open_default().then(r => status(r?.status === 'success' ? `Opened ${V.name} in your default app` : r?.message || 'It couldn’t be opened')); break;
    case 'win': winBtn(v); break;
    case 'tools-menu': V.tmenu = !V.tmenu; paint(); app.querySelector('.dv-tmenu [aria-checked="true"]')?.focus(); break;
    case 'tools-place': setTools(v, true); break;
  }
});
app.addEventListener('change', e => { if (e.target.dataset.act === 'copy-kind') V.copyKind = e.target.value; if (e.target.dataset.act === 'note-in' && e.target.classList.contains('dv-in') && V.editing) { V.editing = null; paint(); } });   // the note box settles when you leave it (or press Enter)
app.addEventListener('input', e => {
  const t = e.target;
  if (t.dataset.act === 'find-q') { V.find.q = t.value; V.find.ix = 0; runFind(true); }
  if (t.dataset.act === 'note-in') { const it = itemById(t.dataset.v); if (!it) return; if (!V.editing) snap(); V.editing = it.id; it.note = t.value.slice(0, 4000); it.updated = nowIso(); queueSave();
    const row = t.closest('li')?.querySelector('.dv-nt'); if (row) { row.textContent = it.note || 'No note yet'; row.classList.toggle('is-empty', !it.note); } paintInk(it.page); }
});
app.addEventListener('focusout', e => { if (e.target.dataset?.act === 'note-in' && V.editing) { V.editing = null; setTimeout(paint, 0); } });
document.addEventListener('keydown', e => {
  const t = e.target, typing = /^(INPUT|TEXTAREA)$/.test(t.tagName), k = e.key, ctrl = e.ctrlKey || e.metaKey;
  if (t.id === 'dv-typein') {
    if (k === 'Enter') { e.preventDefault(); const s = t.value.trim().slice(0, 500), ty = V.typing; V.typing = null; if (s) { addItem({ kind: ty.kind, page: ty.page, pts: ty.pts, text: s }); status(`${DV_WHAT[ty.kind]} added`); } else paintInk(ty.page); }
    if (k === 'Escape') { e.preventDefault(); const p = V.typing?.page; V.typing = null; paintInk(p); }
    return; }
  if (t.classList?.contains('dv-in') && k === 'Enter') { e.preventDefault(); t.dispatchEvent(new Event('change', { bubbles: true })); return; }
  if (t.id === 'dv-find-in' && k === 'Enter') { e.preventDefault(); if (V.find.hits) { V.find.ix = (V.find.ix + (e.shiftKey ? -1 : 1) + V.find.hits) % V.find.hits; showHit(true); } return; }
  if (k === 'Escape' && V.tmenu) { e.preventDefault(); V.tmenu = false; paint(); app.querySelector('.dv-tplace')?.focus(); return; }
  if (k === 'Escape') { if (V.dlg) { e.preventDefault(); if (!V.busy) { V.dlg = null; paint(); status('Nothing was saved'); } } else if (V.find) { e.preventDefault(); closeFind(); } else if (V.sel) { V.sel = null; paintInkAll(); paint(); } else if (V.tool !== 'select') { V.tool = 'select'; paintInkAll(); paint(); status(DV_TOOL_SAID.select); } return; }
  if (ctrl && k.toLowerCase() === 'f') { e.preventDefault(); openFind(); return; }
  if (ctrl && (k === '=' || k === '+')) { e.preventDefault(); zoomStep(1); return; }
  if (ctrl && k === '-') { e.preventDefault(); zoomStep(-1); return; }
  if (ctrl && k === '0') { e.preventDefault(); setZoom(fitZoom(), true); return; }
  if (typing || V.dlg) return;
  if (ctrl && (k.toLowerCase() === 'y' || (e.shiftKey && k.toLowerCase() === 'z'))) { e.preventDefault(); redo(); return; }
  if (ctrl && k.toLowerCase() === 'z') { e.preventDefault(); undo(); return; }
  if ((k === 'Delete' || k === 'Backspace') && V.sel) { e.preventDefault(); removeItem(V.sel); return; }
  if (V.layout.flow === 'single' && (k === 'PageDown' || k === 'ArrowRight')) { e.preventDefault(); goPage(V.cur + 1); }
  if (V.layout.flow === 'single' && (k === 'PageUp' || k === 'ArrowLeft')) { e.preventDefault(); goPage(V.cur - 1); }
});
document.addEventListener('submit', e => e.preventDefault(), true);   // nothing in the window navigates on its own
// Feedback: "it also auto zooms in when adjusting the size of the window, this is jaring". Only you change the zoom (−, +, Fit
// to width, Ctrl+wheel, Ctrl+= / − / 0); a window that changes size keeps it, and the page you're reading stays in view
// the opening fit, once: a frame (a tab) can open before it has its size, so it fits when it first gets room; after that only you zoom
addEventListener('resize', () => { if (V.fitFirst && ready() && (dvPages()?.clientWidth || 0) >= 200) { V.fitFirst = false; setZoom(fitZoom(), true); } });
addEventListener('wheel', e => { if (!(e.ctrlKey || e.metaKey) || !ready() || !e.target.closest?.('.dv-doc')) return; e.preventDefault(); zoomStep(e.deltaY < 0 ? 1 : -1); status(`Zoom ${Math.round(V.zoom * 100)}%`); }, { passive: false });

/* ---- the window: our own bar, like the main window (winframe through ViewerApi) ---- */
async function winBtn(v) {
  const a = vapi(); if (!a || EMBED) return;
  if (v === 'min') a.window_minimize();
  if (v === 'max') { V.max = await a.window_toggle_maximize(); document.body.classList.toggle('is-maximised', V.max); paint(); }
  if (v === 'close') { await flushSave(); if (V.save.state === 'error') { status('The notes aren’t saved yet: close again to close anyway'); V.save.state = 'saved'; return; } a.window_close(); }
}
let lastBar = 0, lastEdge = { at: 0, edge: '' };
app.addEventListener('pointerdown', e => {
  if (EMBED || e.button !== 0 || !e.target.closest('.dv-wbar') || e.target.closest('button, input, [data-act]')) return;
  const a = vapi(); if (!a) return; e.preventDefault();
  if (e.timeStamp - lastBar < 450) { lastBar = 0; winBtn('max'); return; } lastBar = e.timeStamp; a.window_start_drag('caption');
});
document.querySelectorAll('.win-edge').forEach(el => el.addEventListener('pointerdown', e => {
  const a = vapi(); if (e.button !== 0 || !a) return; e.preventDefault(); const edge = el.dataset.edge;
  if (edge.length === 1 && lastEdge.edge === edge && e.timeStamp - lastEdge.at < 450) { lastEdge = { at: 0, edge: '' }; a.window_fill('ns'.includes(edge) ? 'v' : 'h'); return; }
  lastEdge = { at: e.timeStamp, edge }; a.window_start_drag(edge);
}));
// docviewer.py talks to the window: maximised or not, and Restore from NeuroVault's Timeline (load the notes again)
window.nvViewer = msg => {
  if (msg?.kind === 'max') { V.max = !!msg.on; document.body.classList.toggle('is-maximised', V.max); paint(); }
  if (msg?.kind === 'tools' && msg.bar) setTools(msg.bar, false);
  if (msg?.kind === 'flush') flushSave().then(() => EMBED && window.parent.postMessage({ nvViewerFlushed: true }, PARENT));   // the place was changed in Settings or another viewer
  if (msg?.kind === 'reload') loadNotes().then(() => { V.undo = []; V.sel = null; paintInkAll(); paint(); status('Your notes from before are back (restored from the Timeline)'); });
};

/* ---- opening: the look, the file, its renderer, its notes ---- */
function applyLook(look) {
  if (!look) return; const b = document.body.dataset;
  ['theme', 'dark', 'accent', 'font', 'textsize', 'spacing', 'cvd'].forEach(k => { if (look[k]) b[k] = look[k]; });
  Object.entries(look.vars || {}).forEach(([k, v]) => app.style.setProperty(k, v));
}
async function loadNotes() { const r = await vapi().annotations_get(); V.items = r?.status === 'success' && Array.isArray(r.items) ? r.items : []; }
async function boot() {
  const a = vapi(); if (!a) { V.state = 'error'; V.msg = 'The viewer opens from NeuroVault.'; build(); paint(); return; }
  try {
    const info = V.info = await a.info(); if (info?.status !== 'success') throw new Error(info?.message || 'The file couldn’t be opened.');
    V.layout = { ...DV_LAYOUT0, ...(info.layout || {}) }; V.kind = info.kind; V.name = info.name; V.max = !!info.maximized; document.body.classList.toggle('is-maximised', V.max);
    applyLook(info.look); document.title = `${info.name} · NeuroVault`; build(); paint();
    await loadNotes();
    const d = await a.doc_bytes(); if (d?.status !== 'success') throw new Error(d?.message || 'The file couldn’t be read.');
    const bytes = dvB64(d.data), R = dvRendererFor(V.kind, bytes, info);
    if (!R) { V.state = 'missing'; paint(); return; }
    V.R = R; V.rend = new R(); const opened = await V.rend.open(bytes); V.pages = opened.pages; V.outline = opened.outline || [];
    if (!V.pages.length) throw new Error('It has no pages.');
    V.state = 'ready'; paint(); V.fitFirst = (dvPages()?.clientWidth || 0) < 200; V.zoom = V.fitFirst ? 1 : fitZoom(); layoutPages(); paint(); status(`Opened ${V.name}`);
    thumbsInBackground();
  } catch (e) { console.warn('viewer', e); V.state = 'error'; V.msg = String(e?.message || e); if (!slot('wbar')) build(); paint(); }
}
async function thumbsInBackground() {
  if (!V.rend.thumb) return;
  for (let n = 1; n <= Math.min(V.pages.length, 300); n++) { const p = V.pages[n - 1], c = document.createElement('canvas'); c.width = 144; c.height = Math.round(144 * p.h / p.w);
    try { await V.rend.thumb(n, c); V.thumbs[n] = c.toDataURL('image/png'); if (n % 4 === 0 || n === V.pages.length) paint(); } catch (e) { break; } }
  paint();
}
if (Q.get('check') === '1') { const s = document.createElement('script'); s.src = 'viewer/check-viewer.js'; document.head.appendChild(s); }   // dev only: a fake ViewerApi and the checks
else if (vapi()) boot(); else { addEventListener('pywebviewready', boot, { once: true }); setTimeout(() => { if (!V.info && !app.firstChild) boot(); }, 4000); }
