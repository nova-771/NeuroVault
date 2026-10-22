/* BUILD DV · THE DOCUMENT VIEWER, from NeuroVault's own window (mockup R66). A PDF or Word (.docx) attachment opens in its own
   NeuroVault window (docviewer.py, viewer.html) from: Open on its card in a note, a double-click on the card, Open in the
   Attachments tab, and Ctrl+K (type the file's name). Back in the note, the card says "Annotated · N": a chip, no banner and
   no copy in the note (QC 100). The Timeline lists each viewing session that changed the notes, with Restore, and each
   annotated copy saved. The viewer window tells this one about changes (nvSync kind "docv"). */
'use strict';
const DV = { log: [], tools: 'top' };
const dvKind = f => /\.pdf$/i.test(f || '') ? 'pdf' : /\.docx$/i.test(f || '') ? 'docx' : null;
const dvCount = f => +(attByFile(f)?.annotated || 0);
const dvLook = () => {   // the viewer opens in this window's theme, font and accent (accents.js may set the accent's tokens here)
  const b = document.body.dataset, cs = getComputedStyle(app), vars = {};
  ['--accent', '--accent-bg', '--accent-text', '--on-accent', '--muted-on-accent'].forEach(k => { const v = app.style.getPropertyValue(k).trim(); if (v) vars[k] = v; });
  const m = cs.backgroundColor.match(/\d+/g), bg = m ? '#' + m.slice(0, 3).map(x => (+x).toString(16).padStart(2, '0')).join('') : null;
  return { theme: b.theme, dark: b.dark, accent: b.accent, font: b.font, textsize: b.textsize, spacing: b.spacing, cvd: b.cvd, vars, bg };
};
async function dvOpen(file, noteId) {
  if (!dvKind(file)) return false;
  if (!realData()) { status(`Opens ${attBase(file)} in its own NeuroVault window (in the desktop app)`); return true; }
  const r = await nv('viewer_open', file, rawId(noteId ?? note()?.id), dvLook());
  if (failed(r)) toast(r.message || "The viewer couldn't open"); else status(r.already ? `${attBase(file)} is open already: brought it to the front` : `Opened ${attBase(file)} in its own NeuroVault window`);
  return true;
}
// Open (a card in the note, the Attachments tab) and Ctrl+K's Documents: the viewer, for a PDF or Word file
document.addEventListener('click', e => {
  const t = e.target.closest?.('[data-act="att-show"], [data-act="dv-open"]'); if (!t) return; const f = t.dataset.v;
  if (t.dataset.act === 'att-show' && !dvKind(f)) return;   // other files still open in their default app
  e.preventDefault(); e.stopImmediatePropagation(); dvOpen(f, t.closest('.doc')?.dataset.note);
}, true);
document.addEventListener('dblclick', e => {
  const c = e.target.closest?.('.att-embed[data-embed-for]'); if (!c || !dvKind(c.dataset.embedFor) || e.target.closest('button')) return;
  e.preventDefault(); e.stopImmediatePropagation(); dvOpen(c.dataset.embedFor, c.closest('.doc')?.dataset.note);
}, true);

/* ---- the chip on the card, and the Attachments tab's line ---- */
const dvChip = f => { const n = dvCount(f); return n ? `<span class="chip chip--accent dv-badge" aria-label="Annotated: ${n} note${n === 1 ? '' : 's'} on it">${ic('phpin')}Annotated · ${n}</span>` : ''; };
{ const e0 = embedHtml; embedHtml = function (file) {   // eslint-disable-line no-global-assign
  const h = e0.apply(this, arguments); if (!dvKind(file) || !dvCount(file)) return h;
  return h.replace('<button class="btn btn--secondary btn--sm" data-act="att-show"', dvChip(file) + '<button class="btn btn--secondary btn--sm" data-act="att-show"'); }; }
{ const a0 = attRow; attRow = function (a) {   // eslint-disable-line no-global-assign
  const h = a0.apply(this, arguments), n = a && dvKind(a.file) ? dvCount(a.file) : 0;
  return n ? h.replace('<span class="list-item-sub truncate">', `<span class="list-item-sub truncate">Annotated · ${n} note${n === 1 ? '' : 's'} · `) : h; }; }

/* ---- Ctrl+K: a PDF or Word file by its name (this note's first, when nothing's typed) ---- */
{ const p0 = palResults; palResults = function () {   // eslint-disable-line no-global-assign
  const g = p0.apply(this, arguments), q0 = S.pal.q.trim(); if (q0.startsWith('>')) return g;
  const q = q0.toLowerCase(), here = new Set(noteEmbeds(note()) || []), docs = (D.atts || []).filter(a => dvKind(a.file) && (q ? fuzzy(attBase(a.file).toLowerCase(), q) : here.has(a.file))).slice(0, q ? 5 : 3);
  if (docs.length) g.splice(Math.min(1, g.length), 0, [q ? 'Documents' : 'Documents in this note', docs.map(a => { const n = dvCount(a.file);
    return { icon: dvKind(a.file) === 'pdf' ? 'filepdf' : 'file', label: attBase(a.file), sub: `Open in the viewer${n ? ` · Annotated · ${n}` : ''}`, run: ['dv-open', a.file] }; })]);
  return g; }; }

/* ---- the viewer says the notes changed (or a copy was saved): the chip, the list and the Timeline follow ---- */
{ const s0 = window.nvSync; window.nvSync = msg => {
  if (msg?.kind !== 'docv') return s0 ? s0(msg) : undefined;
  (async () => { await refreshAtts(); if (typeof bmActivity === 'function') { S.bm.actAt = 0; await bmActivity(); } renderAll(); })().catch(e => console.warn('docv sync', e)); }; }

/* ---- the Timeline: each viewing session that changed a file's notes, with Restore; each annotated copy ---- */
{ const b0 = bmActivity; bmActivity = async function () {   // eslint-disable-line no-global-assign
  await b0.apply(this, arguments); if (!VAULT.live) return;
  const r = await nv('list_doc_annotations', 80); if (!Array.isArray(r)) return; DV.log = r;
  const ev = r.map(x => ({ id: 'dv-' + x.id, at: x.at, time: bmTime(x.at), range: bmRange(x.at), type: 'Attachments', noteId: x.note_id ? 'n-' + x.note_id : null, file: `the notes from before on ${x.name}`,
    restoreId: x.can_restore ? x.id : null, restoreAct: 'dv-restore', restored: !!x.restored_at,
    title: x.what === 'copy' ? `Saved an annotated copy of ${x.name}` : `Annotated ${x.name}${x.title ? ` in “${x.title.slice(0, 60)}”` : ''}`,
    desc: x.what === 'copy' ? `${(JSON.parse(x.copy || '[]')[0]) || 'The copy'} beside the original · the original isn’t changed`
      : x.restored_at ? `Restored ${bmTime(x.restored_at)} · ${x.before_said || 'the notes from before'} back on the file`
      : `${x.said[0].toUpperCase() + x.said.slice(1)} · the file isn’t changed${x.can_restore ? ` · Restore puts back ${x.before_said === 'no notes' ? 'no notes' : x.before_said}` : ''}` }));
  const seen = new Set(D.events.map(e => e.id)), add = ev.filter(e => !seen.has(e.id));
  if (add.length) { D.events = [...D.events, ...add].sort((a, b) => (b.at > a.at) - (b.at < a.at)); if (UI.view === 'history') renderAll(); }
}; }
app.addEventListener('click', async e => {
  const b = e.target.closest?.('[data-act="dv-restore"]'); if (!b) return; e.stopImmediatePropagation();
  const r = await nv('restore_doc_annotations', +b.dataset.v); if (failed(r)) { toast(r.message || "Those notes couldn't be brought back"); return; }
  await refreshAtts(); S.bm.actAt = 0; D.events = D.events.filter(x => !String(x.id).startsWith('dv-')); await bmActivity();
  status(`The notes from before are back on ${attBase(r.file)}${r.count ? ` (${r.count})` : ''} · the file isn’t changed`); renderAll();
}, true);
/* ---- Settings → Document viewer (R66, the decision "customisable user setting"): where the mark-up tools sit, remembered in
   config.json viewer_tools (docviewer.TOOL_PLACES; the viewer's own Tools: … changes the same setting). Open viewers follow at
   once (docviewer.py sends them the change); the rest of the window is the user's other R66 answers, said in words ---- */
const DV_PLACES = [['top', 'Under the window bar', 'One bar under the window bar, with zoom and Find'], ['float', 'Over the page', 'A floating bar over the page, like the note editor’s toolbar'],
  ['rail', 'Down the left', 'A slim rail at the left, so the pages get the full height'], ['bottom', 'Along the bottom', 'One bar along the bottom, above the status line'],
  ['context', 'Beside what you pick', 'Beside where you click or what you select, like Word’s mini toolbar'], ['panel', 'In the notes panel', 'At the top of your notes, so everything to do with notes is in one place']];
const DV_TOOLS_DEFAULT = DV_PLACES[0][0];
SET_SECTIONS.splice(SET_SECTIONS.findIndex(s => s[0] === 'vault'), 0, ['viewer', 'Document viewer']);
PAL_SETTINGS.push(['Where the document viewer’s tools sit', 'viewer']);
function dvSettings() {
  const cur = DV_PLACES.find(p => p[0] === DV.tools) || DV_PLACES[0];
  return `<div class="pop-sec dv-set"><div class="eyebrow">Where the tools sit</div><div class="set-row"><div><div class="set-label" id="dv-tools-l">Mark-up tools</div><div class="set-desc" data-dv-tools-say>${esc(cur[2])}. You can also change this in the viewer: Tools: … in its status line.</div></div></div>
    <div class="seg dv-seg" role="group" aria-labelledby="dv-tools-l">${DV_PLACES.map(([v, l]) => `<button class="seg-opt" data-act="dv-tools" data-v="${v}" aria-pressed="${DV.tools === v}">${l}</button>`).join('')}</div></div>
    <div class="pop-sec"><div class="eyebrow">The window</div><div class="set-row"><div><div class="set-label">Pages and notes</div><div class="set-desc">Pages at the left, your notes on the file at the right, in one long scroll. A PDF or Word file opens from Open on its card, a double-click on the card, the Attachments tab or Ctrl+K</div></div></div>
      <div class="set-row"><div><div class="set-label">Save an annotated copy</div><div class="set-desc">Offers a PDF with your notes on the pages and listed on a last page, or a picture of each page. Your notes are saved beside the file as you go, and the file itself is never changed</div></div></div></div>
    <div class="set-actions"><button class="btn btn--secondary btn--sm" data-act="dv-tools-reset"${DV.tools === DV_TOOLS_DEFAULT ? ' disabled' : ''}>${ic('restore')}Reset to defaults</button></div>`;
}
{ const sp0 = settingsPane; settingsPane = sec => sec === 'viewer' ? dvSettings() : sp0(sec); }   // eslint-disable-line no-global-assign
{ const rc0 = readerFromConfig; readerFromConfig = function (c) { rc0.apply(this, arguments); if (c && DV_PLACES.some(p => p[0] === c.viewer_tools)) DV.tools = c.viewer_tools; }; }   // eslint-disable-line no-global-assign
function dvSetTools(v, said) {
  if (!DV_PLACES.some(p => p[0] === v)) return; DV.tools = v; saveSettings({ viewer_tools: v });
  status(`${said || 'Document viewer'}: the tools sit ${DV_PLACES.find(p => p[0] === v)[1].toLowerCase()}${realData() ? ' · open viewers follow' : ''}`);
  S.focus = { sel: `[data-act="dv-tools"][data-v="${v}"]` }; renderAll();
}
document.getElementById('app').addEventListener('click', e => {
  const t = e.target.closest?.('[data-act="dv-tools"], [data-act="dv-tools-reset"]'); if (!t || t.disabled) return;
  if (t.dataset.act === 'dv-tools') dvSetTools(t.dataset.v); else dvSetTools(DV_TOOLS_DEFAULT, 'Reset to defaults');
});
{ const s1 = window.nvSync; window.nvSync = msg => { if (msg?.kind !== 'docv-tools') return s1(msg); if (DV_PLACES.some(p => p[0] === msg.bar) && msg.bar !== DV.tools) { DV.tools = msg.bar; renderAll(); } }; }   // a viewer's own Tools: … changed it
/* ---- end Build DV ---- */

/* ==== Build DV · QC 114 and R70: documents open inside the app, like notes. Feedback: "there should be a viewer icon to load pdfs, docx
   into the application on the right side bar, which opens the same way a new note does or the user can pop it out", and "this is
   different from loading a pdf or docx and converting it!". The R70 answers: a document's tab has a file icon and a small PDF / Word
   label; Pop out is on both the tab and the document's header; the viewer takes the Pro editor look.
   - The right sidebar's Documents tab (Alt+6) lists this note's PDFs and Word files, then every one in the vault (with Find), the
     recent ones, and Open a file…. View, the main click, opens it as it is in a tab; Convert to a note… is set apart in ⋮, never
     the main click.
   - In a tab, the viewer is an iframe from its own origin (docviewer.ViewerServer), placed over the tab's area after every draw
     (rebuilding #app would reload a frame inside it). It asks for what it needs by postMessage; this window passes only that, for
     that document's token, to api.viewer_tab_call, so the viewer page never reaches NeuroVault's API.
   - Pop out (the tab's icon, the header's button) moves it to its own window; that window's Back into a tab brings it back. ==== */
Object.assign(ICON, { dvview: '<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6"/><circle cx="11.5" cy="14.5" r="2.5"/><path d="m13.5 16.5 2 2"/>',
  dvpop: '<path d="M14 4h6v6M20 4l-8 8"/><path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>' });
VIEW_LABEL.doc = 'Document'; VIEW_ICON.doc = 'filepdf';
NV_WAIT.viewer_tab_call = 60000;   // a big file's bytes, or an annotated copy of many pages, take a while
const DVT = { frames: {}, menu: null, q: '', recent: [] };   // frames: file → { token, url, origin, el }
const DV_LINE = { view: 'View it as it is: the file is read and marked up where it is, never changed or copied.', convert: 'Make a note from it: Convert to a note…, in a document’s ⋮ menu, writes a Markdown copy.' };
const dvTabOf = f => S.tabs.find(t => t.kind === 'doc' && t.ref === f);
const dvActiveTab = () => { const t = S.tabs.find(x => x.id === S.activeTab); return UI.view === 'doc' && !S.offTab && t?.kind === 'doc' ? t : null; };
const dvName = f => String(f || '').split(/[\\/]/).pop();
const dvType = f => dvKind(f) === 'docx' ? 'Word' : 'PDF';
const dvIcon = f => dvKind(f) === 'docx' ? 'file' : 'filepdf';
const dvOutside = f => /^([A-Za-z]:[\\/]|\/)/.test(String(f || ''));
function openDocTab(file, noteId) {
  if (!dvKind(file)) return false;
  let t = dvTabOf(file);
  if (!t) { t = mkTab('doc', file); t.note = noteId ?? (UI.view === 'notes' ? note()?.id : null); const i = S.tabs.findIndex(x => x.id === S.activeTab); S.tabs.splice(i < 0 ? S.tabs.length : i + 1, 0, t); }
  S.activeTab = t.id; S.offTab = null; S.menu = false; DVT.menu = null;
  status(`Viewing ${dvName(file)} as it is, in a tab`);
  if (UI.view !== 'doc') setUI('view', 'doc'); else renderAll();
  return true;
}
// Open on a card, a double-click, the Attachments tab and Ctrl+K open the document in a tab now (Pop out gives it its own window)
dvOpen = async function (file, noteId) { return openDocTab(file, noteId); };   // eslint-disable-line no-global-assign
{ const t0 = tabTitle; tabTitle = function (t) { return t?.kind === 'doc' ? dvName(t.ref) : t0.apply(this, arguments); }; }   // eslint-disable-line no-global-assign
{ const v0 = viewFn; viewFn = v => v === 'doc' ? viewDoc : v0(v); }   // eslint-disable-line no-global-assign
{ const c0 = crumbText; crumbText = function () { if (UI.view !== 'doc') return c0.apply(this, arguments); const f = DVT.cur || dvActiveTab()?.ref; return f ? `Document · ${dvName(f)}` : 'Document'; }; }   // eslint-disable-line no-global-assign
{ const s0 = syncTabs; syncTabs = function () {   // eslint-disable-line no-global-assign
  if (UI.view === 'doc' && !S.tabs.some(t => t.kind === 'doc') && !dvPanes().length) UI.view = 'notes';   // the last document has gone
  return s0.apply(this, arguments); }; }
// the tab: a file icon, a small PDF / Word label, Pop out beside Close; dragged onto a pane's edge it opens beside, like a note's
{ const r0 = renderTabs; renderTabs = function () {   // eslint-disable-line no-global-assign
  let h = r0.apply(this, arguments);
  S.tabs.filter(t => t.kind === 'doc').forEach(t => { const f = t.ref, name = esc(dvName(f));
    h = h.replace(new RegExp(`<div class="ws-tab" ([^>]*?)data-wstab="${t.id}" draggable="true"([^>]*)><span class="ws-tab-icon" aria-hidden="true">[\\s\\S]*?</span><span class="ws-tab-title">([\\s\\S]*?)</span>`),
      (m, a, b, title) => `<div class="ws-tab dv-wstab" ${a}data-wstab="${t.id}" draggable="true"${b}><span class="ws-tab-icon" aria-hidden="true">${ic(dvIcon(f))}</span><span class="ws-tab-title">${title}</span><span class="dv-ttype">${dvType(f)}</span><button class="ws-tab-close dv-tpop" data-act="dv-pop" data-v="${esc(f)}" tabindex="-1" aria-label="Pop out ${name}: its own window">${ic('dvpop')}</button>`); });
  return h; }; }
// the document in the main area: its header (name, where it's from, Pop out, ⋮), and the room the viewer's frame fills
function dvMenu(f, where) {
  return `<div class="menu card dv-dmenu${where === 'head' ? ' is-head' : ''}" role="menu" aria-label="${esc(dvName(f))}">${where === 'head' ? '' : `<button class="menu-item dv-mview" role="menuitem" data-act="dv-view" data-v="${esc(f)}">${ic('dvview')}<b>View</b></button>`}`
    + `${dvOutside(f) ? '' : `<button class="menu-item" role="menuitem" data-act="dv-pop" data-v="${esc(f)}">${ic('dvpop')}Pop out</button>`}<button class="menu-item" role="menuitem" data-act="dv-reveal" data-v="${esc(f)}">${ic('folderopen')}Show in File Explorer</button><div class="menu-sep"></div>`
    + `<button class="menu-item dv-conv" role="menuitem" data-act="dv-convert" data-v="${esc(f)}">${ic('notes')}<span>Convert to a note…<span class="dv-msub">Makes a Markdown copy. The file stays as it is.</span></span></button></div>`;
}
const dvMore = (f, label) => `<button class="icon-btn icon-btn--sm" data-act="dv-more" data-v="${esc(f)}" aria-haspopup="menu" aria-expanded="${DVT.menu === f}" aria-label="${esc(label)}" data-tip="${esc(label)}">${ic('more')}</button>`;
function viewDoc() {
  const f = DVT.cur || dvActiveTab()?.ref; if (!f) return '<section class="view dv-docview" id="main-view-doc"></section>';
  const a = attByFile(f), n = D.notes.find(x => x.id === dvNoteOf(f)), fr = DVT.frames[f], pane = DVT.curPane;
  const meta = [dvType(f), a ? fmtSize(a.size) : dvOutside(f) ? 'on this PC' : '', n ? `in ${n.title}` : ''].filter(Boolean).join(' · ');
  const head = `<div class="dv-dhead">${ic(dvIcon(f))}<b class="truncate">${esc(dvName(f))}</b><span class="dv-dhm truncate">${esc(meta)}</span><span class="dv-dfill"></span>`
    + `${dvOutside(f) ? '' : `<button class="btn btn--ghost btn--sm" data-act="dv-pop" data-v="${esc(f)}">${ic('dvpop')}Pop out</button>`}${dvMore(f, `More for ${dvName(f)}`)}${pane ? pnClose(dvName(f), pane) : ''}</div>${DVT.menu === f + '|head' ? dvMenu(f, 'head') : ''}`;
  if (DVT.headOnly) return head;   // a document's pane: this is the pane's (live) header
  const body = !realData() ? `<div class="dv-dempty card"><b>${esc(dvName(f))} opens here in the desktop app</b><span>${DV_LINE.view}</span></div>`
    : fr?.error ? `<div class="dv-dempty card"><b>${esc(dvName(f))} couldn’t be shown</b><span>${esc(fr.error)}</span></div>` : '';
  return `<section class="view dv-docview" id="main-view-doc" aria-label="${esc(dvName(f))}">${pane ? '' : head}<div class="dv-host" data-dv-host="${esc(f)}">${body}</div></section>`;
}
// the frames live in #frame beside #app (never inside it: a rebuild would reload them), each placed over its tab's area
function dvLayer() { let l = document.getElementById('dv-frames'); if (!l) { l = document.createElement('div'); l.id = 'dv-frames'; document.getElementById('frame').appendChild(l); } return l; }
async function dvFrame(f) {
  let fr = DVT.frames[f]; if (fr?.el || fr?.busy || fr?.error) return fr;
  fr = DVT.frames[f] = { ...(fr || {}), busy: true };
  const r = fr.token ? fr : await nv('viewer_tab_open', f, rawId(dvNoteOf(f)), dvLook());
  if (failed(r)) { fr.busy = false; fr.error = r.message || 'The viewer couldn’t open it.'; renderAll(); return fr; }
  if (r.window) { fr.busy = false; delete DVT.frames[f]; dvDrop(f); status(`${dvName(f)} is open in its own window: brought it to the front`); renderAll(); return null; }
  Object.assign(fr, { token: r.token, url: r.url, origin: r.origin, busy: false });
  const el = document.createElement('iframe'); el.className = 'dv-iframe'; el.title = dvName(f); el.setAttribute('aria-label', dvName(f));
  el.setAttribute('referrerpolicy', 'no-referrer'); el.src = `${r.url}&p=${encodeURIComponent(location.origin)}`; fr.el = el; dvLayer().appendChild(el); dvPlace(); return fr;
}
function dvPlace() {
  const hosts = new Map([...app.querySelectorAll('[data-dv-host]')].map(h => [h.dataset.dvHost, h])), frame = document.getElementById('frame'), F = frame.getBoundingClientRect(), z = F.width / frame.offsetWidth || 1;
  Object.entries(DVT.frames).forEach(([f, fr]) => { if (!fr.el) return; const host = hosts.get(f);
    fr.el.hidden = !host; if (!host) return; const r = host.getBoundingClientRect();
    Object.assign(fr.el.style, { left: (r.left - F.left) / z + 'px', top: (r.top - F.top) / z + 'px', width: r.width / z + 'px', height: r.height / z + 'px' }); });
  if (realData()) hosts.forEach((h, f) => { const fr = DVT.frames[f]; if (!fr?.el && !fr?.busy && !fr?.error) dvFrame(f); });
}
{ const a0 = afterRender; afterRender = function () { a0.apply(this, arguments); dvPlace(); }; }   // eslint-disable-line no-global-assign
addEventListener('resize', () => dvPlace());
function dvDrop(f) { const fr = DVT.frames[f]; fr?.el?.remove(); delete DVT.frames[f]; }
function dvFlush(fr) {   // the viewer saves what's typed before its tab closes or pops out
  if (!fr?.el?.contentWindow) return Promise.resolve();
  return new Promise(ok => { fr.flushed = ok; fr.el.contentWindow.postMessage({ nvViewerMsg: { kind: 'flush' } }, fr.origin); setTimeout(ok, 1500); });
}
// the frame's asks: only from our frame, only from its origin, only for its token; the answer goes back to that frame alone
addEventListener('message', async e => {
  const d = e.data; if (!d || typeof d !== 'object') return;
  const fr = Object.values(DVT.frames).find(x => x.el && x.el.contentWindow === e.source); if (!fr || e.origin !== fr.origin) return;
  if (d.nvViewerFlushed) { fr.flushed?.(); return; }
  if (d.nvViewerCall == null || d.token !== fr.token || typeof d.method !== 'string') return;
  const r = await nv('viewer_tab_call', fr.token, d.method, Array.isArray(d.args) ? d.args : []);
  fr.el?.contentWindow?.postMessage({ nvViewerReply: d.nvViewerCall, result: r }, fr.origin);
});
async function dvCloseDoc(f, quiet) {
  const fr = DVT.frames[f]; if (fr?.token) { await dvFlush(fr); await nv('viewer_tab_close', fr.token); }
  dvDrop(f); const t = dvTabOf(f); if (t && !quiet) closeTab(t.id); else if (t) { S.tabs.splice(S.tabs.indexOf(t), 1); if (!S.tabs.length) S.tabs.push(mkTab('newtab', null)); }
}
{ const c0 = closeTab; closeTab = function (id) {   // eslint-disable-line no-global-assign
  const t = S.tabs.find(x => x.id === id); if (t?.kind === 'doc' && DVT.frames[t.ref]) { const f = t.ref; dvCloseDoc(f, true).then(() => { if (UI.view === 'doc' && !dvActiveTab()) { const n = S.tabs[0]; if (n) activateTab(n.id); else renderAll(); } else renderAll(); }); return; }
  return c0.apply(this, arguments); }; }
async function dvPopOut(f) {
  DVT.menu = null; if (dvOutside(f)) { toast('A file from outside the vault opens in a tab only'); return; }
  if (!realData()) { status(`Pops ${dvName(f)} out into its own window (in the desktop app)`); renderAll(); return; }
  const fr = DVT.frames[f], t = dvTabOf(f);
  if (fr?.token) await dvFlush(fr);
  const r = fr?.token ? await nv('viewer_pop_out', fr.token, dvLook()) : await nv('viewer_open', f, rawId(t?.note), dvLook());
  if (failed(r)) { toast(r.message || "The window couldn't open"); return; }
  dvDrop(f); dvUnpane(f); if (t) { const was = S.activeTab === t.id; S.tabs.splice(S.tabs.indexOf(t), 1); if (!S.tabs.length) S.tabs.push(mkTab('newtab', null)); if (was) { const n = S.tabs[0]; S.activeTab = n.id; UI.view = tabView(n); if (n.kind === 'note') S.noteId = n.ref; } }
  status(`${dvName(f)} popped out into its own window · Back into a tab brings it here`); renderAll();
}
async function dvConvert(f) {   // Convert to a note…: Build K's Markdown copy, set apart from viewing; the file stays as it is
  DVT.menu = null; if (!realData()) { status(`Convert to a note…: makes a Markdown note from ${dvName(f)} (the file stays as it is)`); renderAll(); return; }
  const p = dvOutside(f) ? { status: 'success', path: f } : await nv('viewer_source_path', f); if (failed(p)) { toast(p.message); return; }
  renderAll(); convertStart(p.path, 'new_note');
}
async function dvPick() {   // Open a file…: a PDF or Word file from this PC, viewed where it is
  if (!realData()) { status('Open a file…: pick a PDF or Word file to view as it is (in the desktop app)'); return; }
  let path = null; try { path = await api().browse_convert_file(); } catch (e) { console.warn('browse_convert_file', e); }
  if (!path) return; if (!dvKind(path)) { toast('Only a PDF or a Word file (.docx) opens in the viewer'); return; }
  await dvOpenPath(path);
}
async function dvOpenPath(path) {   // a file from this PC (Open a file…, or Explorer's Open with: QC 116), viewed where it is, in a tab
  const r = await nv('viewer_tab_open_path', path, dvLook()); if (failed(r)) { toast(r.message); return false; }
  DVT.frames[r.file] = { token: r.token, url: r.url, origin: r.origin }; dvRecent(); return openDocTab(r.file, null);
}
// QC 116: Explorer's Open with → NeuroVault, at start or into the NeuroVault that's running (a second launch): Python keeps the
// paths (only existing .pdf / .docx files), the page asks for them once its vault is ready and opens each in a tab
async function dvTakePending() { if (!realData()) return; const ps = await nv('viewer_take_pending'); if (Array.isArray(ps)) for (const p of ps) if (typeof p === 'string' && dvKind(p)) await dvOpenPath(p); }
async function dvRecent() { if (!realData()) return; const r = await nv('viewer_recent'); if (Array.isArray(r)) DVT.recent = r; }
// the right sidebar's Documents tab (Alt+6)
{ const i0 = inspTabs; inspTabs = function () { return [...i0.apply(this, arguments), ['docs', 'Documents', 'dvview', 6]]; }; }   // eslint-disable-line no-global-assign
KEYS.push({ g: 'win', l: 'Right sidebar: Documents', k: ['Alt', '6'] });
document.addEventListener('keydown', e => {   // Alt+6, like Alt+1–5 (insp-tabs.js): the number row only
  if (POP || e.isComposing || !e.altKey || e.ctrlKey || e.shiftKey || e.metaKey || e.code !== 'Digit6' || S.modal || UI.zen === 'on' || typeof SETUP !== 'undefined' && SETUP.open) return;
  e.preventDefault(); e.stopImmediatePropagation(); if (e.repeat) return; if (UI.view !== 'notes' && UI.view !== 'doc') { UI.view = 'notes'; } inspTabGo('docs', !!e.target.closest?.('#right-sidebar'));
}, true);
function dvRow(f, sub) {
  const n = dvCount(f), name = dvName(f);
  return `<div class="dv-row${DVT.menu === f ? ' is-open' : ''}"><button class="dv-rmain" data-act="dv-view" data-v="${esc(f)}" aria-label="View ${esc(name)}">${ic(dvIcon(f))}<span class="dv-rnm"><span class="truncate">${esc(name)}</span><span class="dv-rmeta truncate">${esc(sub)}${n ? ` · ${n} note${n === 1 ? '' : 's'}` : ''}</span></span></button>`
    + `${dvOutside(f) ? '' : `<button class="icon-btn icon-btn--sm" data-act="dv-pop" data-v="${esc(f)}" aria-label="Pop out ${esc(name)}: its own window" data-tip="Pop out ${esc(name)}: its own window">${ic('dvpop')}</button>`}${dvMore(f, `More for ${name}`)}</div>${DVT.menu === f ? dvMenu(f, 'row') : ''}`;
}
function dvPanel(n) {
  const sub = f => { const a = attByFile(f); return dvOutside(f) ? 'On this PC' : [dvType(f), a ? fmtSize(a.size) : ''].filter(Boolean).join(' · '); };
  const all = (D.atts || []).filter(a => dvKind(a.file)).map(a => a.file), mine = n ? noteEmbeds(n).filter(f => dvKind(f) && all.includes(f)) : [];
  const q = DVT.q.trim().toLowerCase(), found = all.filter(f => !q || dvName(f).toLowerCase().includes(q)), rec = DVT.recent.filter(f => all.includes(f) || dvOutside(f)).slice(0, 4);
  let menuShown = false; const rows = l => l.map(f => { const h = dvRow(f, sub(f)); if (DVT.menu === f && menuShown) return h.replace(/<div class="menu card dv-dmenu[\s\S]*$/, ''); if (DVT.menu === f) menuShown = true; return h; }).join('');
  const empty = `<div class="dv-pempty"><b>No documents in this note</b><span>${DV_LINE.view}</span><span>${DV_LINE.convert}</span></div>`;
  return `<div class="dv-panel" data-dv-panel><div class="eyebrow">In this note · ${mine.length}</div>${mine.length ? rows(mine) : empty}
    <div class="eyebrow eyebrow--gap">All documents in the vault · ${all.length}</div><div class="dv-search">${ic('search')}<input class="field dv-q" id="dv-q" data-act="dv-q" value="${esc(DVT.q)}" placeholder="Find a document" aria-label="Find a document" autocomplete="off" spellcheck="false"></div>
    ${found.length ? rows(found) : `<div class="list-item-sub">${q ? `No document called “${esc(DVT.q)}”` : 'No PDFs or Word files in the vault yet'}</div>`}
    ${q || !rec.length ? '' : `<div class="eyebrow eyebrow--gap">Recent</div>${rows(rec)}`}
    <button class="btn btn--secondary btn--sm dv-pick" data-act="dv-pick">${ic('folderopen')}Open a file…</button><p class="dv-pline">${DV_LINE.view}</p></div>`;
}
{ const ri0 = renderInspector; renderInspector = function () {   // eslint-disable-line no-global-assign
  const h = ri0.apply(this, arguments); if (S.tab !== 'docs') return h;
  return h.replace(/<div class="insp-body" id="insp-panel" role="tabpanel" aria-labelledby="insp-tab-[\w-]+">[\s\S]*<\/div><\/aside>\s*$/, `<div class="insp-body" id="insp-panel" role="tabpanel" aria-labelledby="insp-tab-docs">${dvPanel(note())}</div></aside>`); }; }
app.addEventListener('input', e => { if (e.target.dataset?.act !== 'dv-q') return; DVT.q = e.target.value; S.focus = { sel: '#dv-q', pos: e.target.selectionStart }; renderAll(); });
document.addEventListener('click', e => {
  const t = e.target.closest?.('[data-act^="dv-"]'), act = t?.dataset.act; if (!t || !['dv-view', 'dv-pop', 'dv-more', 'dv-reveal', 'dv-convert', 'dv-pick'].includes(act)) return;
  e.preventDefault(); e.stopImmediatePropagation(); const f = t.dataset.v;
  if (act === 'dv-view') { DVT.menu = null; openDocTab(f, UI.view === 'notes' ? note()?.id : null); }
  if (act === 'dv-pop') dvPopOut(f);
  if (act === 'dv-more') { const k = t.closest('.dv-dhead') ? f + '|head' : f; DVT.menu = DVT.menu === k ? null : k; renderAll(); }
  if (act === 'dv-reveal') { DVT.menu = null; renderAll(); if (dvOutside(f)) status(`${dvName(f)} is at ${f}`); else attReveal(f); }
  if (act === 'dv-convert') dvConvert(f);
  if (act === 'dv-pick') dvPick();
}, true);
document.addEventListener('click', e => { if (DVT.menu && !e.target.closest?.('.dv-dmenu, [data-act="dv-more"]')) { DVT.menu = null; renderAll(); } });
document.addEventListener('keydown', e => { if (e.key === 'Escape' && DVT.menu) { e.preventDefault(); e.stopImmediatePropagation(); DVT.menu = null; renderAll(); } }, true);
// the viewer and docviewer.py talk to this window: the frame's messages, Pop out from Python's side, and Back into a tab
{ const s2 = window.nvSync; window.nvSync = msg => {
  if (msg?.kind === 'docv-tab') { const fr = Object.values(DVT.frames).find(x => x.token === msg.token); fr?.el?.contentWindow?.postMessage({ nvViewerMsg: msg.msg }, fr.origin); return; }
  if (msg?.kind === 'docv-tabclose') { const f = Object.keys(DVT.frames).find(k => DVT.frames[k].token === msg.token) || msg.file; dvDrop(f); dvUnpane(f); const t = dvTabOf(f); if (t) { S.tabs.splice(S.tabs.indexOf(t), 1); if (!S.tabs.length) S.tabs.push(mkTab('newtab', null)); if (UI.view === 'doc' && !dvActiveTab()) { const n = S.tabs[0]; S.activeTab = n.id; UI.view = tabView(n); } } renderAll(); return; }
  if (msg?.kind === 'docv-dock') { dvRecent(); openDocTab(msg.file, msg.note_id ? 'n-' + msg.note_id : null); return; }
  if (msg?.kind === 'docv-openpath') { dvTakePending(); return; }   // QC 116: before the vault is ready, loadVault asks instead
  return s2(msg); }; }
{ const lv0 = loadVault; loadVault = async function () { const ok = await lv0.apply(this, arguments); if (ok) { dvRecent(); dvTakePending(); } return ok; }; }   // eslint-disable-line no-global-assign
/* ---- A document beside a note (the coordinator, after the user's QC 114: "a document tab should behave like a note's"): drag its
   tab onto a pane's edge (panes.js) and it opens in its own pane, the way a note does; × closes it there; Pop out still gives it a
   window. A document's pane is panes.js's module kind ('mod', v 'doc') holding the file in ref; its frame follows it (outside #app,
   so moving it between a tab and a pane never reloads it). While anything is dragged, the frames let the pointer through. ---- */
VIEW_LABEL.doc = 'Document';
function dvPanes() { return typeof pnAll === 'function' ? pnAll().filter(p => p.kind === 'mod' && p.v === 'doc') : []; }
function dvNoteOf(f) { return dvTabOf(f)?.note ?? dvPanes().find(p => p.ref === f)?.note ?? null; }
function dvUnpane(f) { dvPanes().filter(p => p.ref === f).forEach(p => pnRemove(p.id)); if (PN.focus && !pnFind(PN.focus)) PN.focus = 'main'; }
{ const d0 = pnDrop; pnDrop = function (what, t) {   // eslint-disable-line no-global-assign
  const tab = what?.tab && S.tabs.find(x => x.id === what.tab); if (tab?.kind !== 'doc') return d0.apply(this, arguments);
  if (!t || t.blocked || t.zone === 'centre') return false; const tp = pnFind(t.pane); if (!tp) return false;
  const i = S.tabs.indexOf(tab); S.tabs.splice(i, 1); if (!S.tabs.length) S.tabs.push(mkTab('newtab', null));   // it moves out of the tabs into its pane
  if (S.activeTab === tab.id) { const n = S.tabs[i] || S.tabs[i - 1]; S.activeTab = n.id; if (n.kind === 'note') S.noteId = n.ref; }
  const np = { id: 'p' + (++PN.seq), kind: 'mod', v: 'doc', ref: tab.ref, note: tab.note }, ci = PN.cols.findIndex(c => c.rows.some(r => r.p.id === tp.id)), c = PN.cols[ci];
  if (t.zone === 'left' || t.zone === 'right') { if (t.even) PN.cols.forEach(x => { x.w = 1; }); else c.w /= 2; PN.cols.splice(t.zone === 'left' ? ci : ci + 1, 0, { w: t.even ? 1 : c.w, rows: [{ p: np, h: 1 }] }); }
  else { const ri = c.rows.findIndex(r => r.p.id === tp.id); c.rows.forEach(r => { r.h = 1; }); c.rows.splice(t.zone === 'top' ? ri : ri + 1, 0, { p: np, h: 1 }); }
  PN.focus = np.id; UI.view = 'doc'; status(`${dvName(tab.ref)} opened ${PN_EDGE[t.zone]} · drag the line between to resize; × closes it`); renderAll(); return true; }; }
// a pane draws its own document; its head is the document's (name, Pop out, ⋮, ×): one header, like a note's pane
{ const pp0 = pnPane; pnPane = function (p) {   // eslint-disable-line no-global-assign
  const doc = p.kind === 'mod' && p.v === 'doc', k = [DVT.cur, DVT.curPane];
  DVT.cur = doc ? p.ref : p.kind === 'main' ? (dvActiveTab()?.ref || null) : null; DVT.curPane = doc ? p : null;
  try { const h = pp0.apply(this, arguments); return doc ? h.replace(/aria-label="Document(,| )/, `aria-label="${esc(dvName(p.ref))}$1`) : h; } finally { [DVT.cur, DVT.curPane] = k; } }; }
{ const ph0 = pnHead; pnHead = function (p) {   // eslint-disable-line no-global-assign
  if (pnViewOf(p) !== 'doc') return ph0.apply(this, arguments); if (p.kind === 'main') return '';   // a document tab in the main pane draws its own head
  DVT.headOnly = true; try { return `<header class="app-header pane-head dv-panehead">${viewDoc()}</header>`; } finally { DVT.headOnly = false; } }; }
{ const pf0 = pnFocusPane; pnFocusPane = function (id) { const r = pf0.apply(this, arguments); const p = pnFind(id); if (p?.kind === 'mod' && p.v === 'doc') DVT.menu = null; return r; }; }   // eslint-disable-line no-global-assign
{ const pc0 = pnCloseP; pnCloseP = function (id) {   // eslint-disable-line no-global-assign
  const p = pnFind(id); if (!(p?.kind === 'mod' && p.v === 'doc')) return pc0.apply(this, arguments);
  const f = p.ref; pnRemove(id); pnFocusPane(PN.focus, true); PN.pmenu = null; dvCloseDoc(f, true).then(() => renderAll());
  status(`${dvName(f)} closed · the Documents tab opens it again`); renderAll(); }; }
{ const ps0 = pnSync; pnSync = function () {   // eslint-disable-line no-global-assign
  const r = ps0.apply(this, arguments), f = pnFind(PN.focus);
  if (f?.kind === 'mod' && f.v === 'doc' && UI.view !== 'doc') PN.focus = 'main';   // a note or a tab clicked: the main area has the focus
  if (f?.kind === 'mod' && f.v === 'doc' && UI.view === 'doc' && S.offTab === 'doc') S.offTab = null;
  return r; }; }
const dvPass = on => document.body.classList.toggle('dv-pass', !!on);
document.addEventListener('dragstart', () => dvPass(true), true);
['dragend', 'drop'].forEach(k => document.addEventListener(k, () => dvPass(false), true));
document.addEventListener('pointerdown', e => { if (e.target.closest?.('.rail, [data-pane-split]')) dvPass(true); }, true);
['pointerup', 'pointercancel'].forEach(k => document.addEventListener(k, () => dvPass(false), true));
/* ---- The right sidebar beside a document, as beside a note: the note the document came from (or the last one) shows its tabs,
   Documents among them; the window bar's toggle and Ctrl+Alt+N show and hide it there too ---- */
const dvSideNote = () => (DVT.cur || dvActiveTab()?.ref ? dvNoteOf(DVT.cur || dvActiveTab()?.ref) : null) || S.noteId;
{ const pi0 = paneInspector; paneInspector = function () {   // eslint-disable-line no-global-assign
  if (UI.view !== 'doc') return pi0.apply(this, arguments);
  const fp = pnFind(PN.focus), f = fp?.kind === 'mod' && fp.v === 'doc' ? fp.ref : dvActiveTab()?.ref, nid = (f && dvNoteOf(f)) || S.noteId;
  return pnWith('notes', nid, () => renderInspector(), false); }; }
{ const it0 = inspToggle; inspToggle = function () { return UI.view === 'doc' ? pnWith('notes', dvSideNote(), () => it0(), false) : it0.apply(this, arguments); }; }   // eslint-disable-line no-global-assign
{ const ok0 = paneInspOk; paneInspOk = function () { return UI.view === 'doc' || ok0.apply(this, arguments); }; }   // eslint-disable-line no-global-assign
/* ==== end Build DV · QC 114 ==== */
