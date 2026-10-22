/* Build M · mockup R44 (locked 2026-10-17), with R45's settings: tabs are for notes only; Tasks, Timer, Timeline and Dictionary open
   from the rail and dock beside a note by dragging their rail icon onto a pane's edge. Up to three panes, side by side or stacked
   (top / bottom, for portrait screens), each at least 360px wide and 240px tall.
   Design: tabs hold notes and documents only; modules (Tasks, Timer, Timeline and so on) open split screen beside a note,
   placed by dragging their rail icon to a split-screen drop zone.
   - The layout: PN.cols = [{ w, rows: [{ p, h }] }], p = { id, kind: 'main' | 'mod' | 'note', v?, ref? }. 'main' is the pane the note
     tabs drive (or a module opened there from the rail: S.offTab); 'mod' a docked module; 'note' a note moved out of the tabs.
   - The pane you work in (PN.focus) is drawn live; the others are drawn read-only (inert) and a click anywhere in one moves the focus.
   - Each pane has one header (the note's own, or the module's icon, path, ⋮ and ×) and one ×; the window bar and the right sidebar are
     drawn for the note, so nothing above the panes changes when the focus moves.
   - Keyboard ways: right-click a rail icon; Ctrl+K "Open … beside the note"; F6 / Shift+F6 to the next pane; the lines between panes
     move with the arrow keys.
   - Settings → Editor → Split screen (config.json): pane_focus_style frame | tint | underline, pane_fade (the
     other panes fade, with any look; QC 4 · 42), pane_split auto | side | stacked, pane_restore last | notes, and pane_layout (the panes and note tabs as you left them). */
'use strict';
const PANE_MODS = ['tasks', 'timer', 'history', 'dict'], PANE_FILES = ['notes', 'newtab'];
const PANE_MIN = { w: 360, h: 240 }, PANE_MAX = 3, PANE_GAP = 7;   // locked: three panes at most (R45); the line between two panes is 7px
const PANE_SET = { focus: 'frame', fade: false, split: 'auto', restore: 'last' };
const PANE_CHOICES = {
  focus: ['pane_focus_style', 'Pane you work in', [['frame', 'Accent frame'], ['tint', 'Tinted header'], ['underline', 'Underline on its tab']]],
  split: ['pane_split', 'How panes split', [['auto', 'Automatic'], ['side', 'Side by side'], ['stacked', 'Stacked']]],
  restore: ['pane_restore', 'When NeuroVault opens', [['last', 'As I left it'], ['notes', 'Notes only']]] };
// Menu icons (wireframe, Lucide-style): the main area, a pane below, up
Object.assign(ICON, { square: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M8 8h8v8H8z"/>', rows: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 12h18"/>', up: '<path d="m18 15-6-6-6 6"/>' });
const PN = { cols: [], focus: 'main', seq: 0, drag: null, menu: null, pmenu: null, inner: false, swallow: false, layout: null, saved: '', fit: false };

const pnAll = () => PN.cols.flatMap(c => c.rows.map(r => r.p));
const pnFind = id => pnAll().find(p => p.id === id);
const pnTab = () => S.tabs.find(t => t.id === S.activeTab);
const pnMainView = () => S.offTab || (pnTab() ? tabView(pnTab()) : 'notes');
const pnViewOf = p => p.kind === 'main' ? pnMainView() : p.kind === 'mod' ? p.v : 'notes';
const pnNoteOf = p => p.kind === 'note' ? p.ref : pnTab()?.kind === 'note' ? pnTab().ref : S.noteId;
const pnName = p => p.kind === 'note' ? (D.notes.find(n => n.id === p.ref)?.title || 'Missing note') : p.kind === 'mod' ? VIEW_LABEL[p.v] : S.offTab ? VIEW_LABEL[S.offTab] : pnTab() ? tabTitle(pnTab()) : 'New tab';
const pnOpenMod = v => pnAll().find(p => p.kind === 'mod' && p.v === v) || (S.offTab === v ? pnFind('main') : null);
const pnNotePane = () => pnAll().find(p => (p.kind === 'main' && !S.offTab && pnTab()?.kind === 'note') || p.kind === 'note');
const pnNoteShown = () => !!pnNotePane();
const pnZoom = () => app.getBoundingClientRect().width / app.offsetWidth || 1;
const pnCol = (p, w = 1) => ({ w, rows: [{ p, h: 1 }] });
// More than one pane shows: the main area is the pane grid (zen shows only the pane you work in)
function paneLayout() { return UI.zen !== 'on' && pnAll().length > 1; }
// The right sidebar can show: a note is open, here or in another pane (Ctrl+Alt+N and the window bar's toggle)
function paneInspOk() { return UI.view === 'notes' || (paneLayout() && pnNoteShown()); }
// Draw something as if this pane were the one you work in, then put everything back
function pnWith(view, noteId, fn, clearOff = PANE_FILES.includes(view)) {
  const k = { view: UI.view, noteId: S.noteId, edPop: S.edPop, menu: S.menu, offTab: S.offTab, inner: PN.inner };
  UI.view = view; if (noteId != null) S.noteId = noteId; S.edPop = null; S.menu = false; if (clearOff) S.offTab = null; PN.inner = true;
  try { return fn(); } finally { UI.view = k.view; S.noteId = k.noteId; S.edPop = k.edPop; S.menu = k.menu; S.offTab = k.offTab; PN.inner = k.inner; }
}
const pnInert = h => h.replace(/\sid="/g, ' data-pane-id="').replace(/contenteditable="true"/g, 'contenteditable="false"').replace(/\saria-controls="[^"]*"/g, '');
function pnReset() { PN.cols = [pnCol({ id: 'main', kind: 'main' })]; PN.focus = 'main'; PN.seq = 0; PN.drag = null; PN.menu = null; PN.pmenu = null; }
// The panes as text, for keepScroll and for saving: what shows where
const paneSig = () => PN.cols.map(c => c.rows.map(r => r.p.kind + ':' + (r.p.v || r.p.ref || S.offTab || '')).join('/')).join('|') + '@' + PN.focus;

/* ---- Before each draw: the pane you work in and the view agree (a rail click, a note opened from the sidebar, a tab) ---- */
function pnSync() {
  if (!PN.cols.length) pnReset();
  if (!pnFind(PN.focus)) PN.focus = 'main';
  // Build M · QC 95: a note opened in a new tab (Ctrl+N, a note opened in a tab) while a docked note pane has the focus shows in
  // the main area, which the tabs drive; the docked note stays (Ctrl+N used to swap it out, so a 3rd note never stayed)
  if (PN.lastTab !== undefined && S.activeTab !== PN.lastTab && pnFind(PN.focus).kind === 'note' && UI.view === 'notes' && pnTab()?.kind === 'note' && pnTab().ref === S.noteId && !S.tabDrag) PN.focus = 'main';
  PN.lastTab = S.activeTab;
  const f = pnFind(PN.focus);
  if (PANE_FILES.includes(UI.view)) {
    if (f.kind === 'mod') PN.focus = 'main';
    else if (f.kind === 'note') { if (UI.view === 'notes' && S.noteId) f.ref = S.noteId; else PN.focus = 'main'; }
  } else if (PANE_MODS.includes(UI.view)) {
    const open = pnAll().find(p => p.kind === 'mod' && p.v === UI.view);
    if (open) { PN.focus = open.id; if (S.offTab === UI.view) S.offTab = null; } else { PN.focus = 'main'; S.offTab = UI.view; }
  }
}
const pnSyncTabs0 = syncTabs;
syncTabs = function () {   // eslint-disable-line no-global-assign
  pnSync();
  const f = pnFind(PN.focus); if (f && f.kind !== 'main') return;   // a docked pane has the focus: the note tabs stay as they are
  if (PANE_MODS.includes(UI.view)) { S.offTab = UI.view; return; }   // a module in the main area: never a tab, the note tabs stay put
  return pnSyncTabs0();
};
// Tabs for notes only: no Tasks or Timer tab at launch (QC 19)
const pnDefaultTabs0 = defaultTabs;
defaultTabs = kind => pnDefaultTabs0(kind).filter(t => t.kind !== 'view');   // eslint-disable-line no-global-assign

/* ---- Drawing the panes ---- */
function pnClose(label, p) { return `<button class="icon-btn" data-act="pn-close" data-v="${p.id}" aria-label="Close ${esc(label)}" title="Close ${esc(label)}${p.kind === 'note' ? '' : ' (reopen it from the rail any time)'}">${ic('x')}</button>`; }
function pnHead(p, on) {
  const v = pnViewOf(p), label = pnName(p);
  if (PANE_FILES.includes(v)) {   // a note: its own Back / Forward, path and actions; a second note adds its ×
    const h = on ? renderHeader() : pnInert(pnWith(v, pnNoteOf(p), () => renderHeader()));
    return p.kind === 'note' ? h.replace(/<\/div><\/header>\s*$/, `${pnClose(label, p)}</div></header>`) : h;
  }
  const crumb = on ? crumbText() : pnWith(v, undefined, () => crumbText());
  return `<header class="app-header pane-head"><div class="crumb"><span class="pane-head-icon" aria-hidden="true">${ic(VIEW_ICON[v] || 'file')}</span><span class="crumb-text truncate">${esc(crumb)}</span></div>
    <div class="header-actions"><button class="icon-btn" data-act="pn-menu" data-v="${p.id}" aria-haspopup="menu" aria-expanded="${PN.pmenu === p.id}" aria-label="More for ${esc(label)}" title="More">${ic('more')}</button>${pnClose(label, p)}</div></header>`;
}
function pnPane(p, row) {
  const on = p.id === PN.focus, v = pnViewOf(p);
  const body = on ? (() => { const k = PN.inner; PN.inner = true; try { return viewFn(UI.view)(); } finally { PN.inner = k; } })()
    : pnInert(pnWith(v, p.kind === 'mod' ? undefined : pnNoteOf(p), () => viewFn(v)(), p.kind !== 'main' || PANE_FILES.includes(v)));
  return `<div class="pane${on ? ' is-focused' : ''}" data-pane="${p.id}" data-pane-view="${v}" role="region" aria-label="${esc(pnName(p))}${on ? ', the pane you work in' : ', click to work here'}" style="flex-grow:${row.h}">${pnHead(p, on)}<div class="${on ? 'pane-live' : 'pane-body'}"${on ? '' : ' inert'}>${body}</div></div>`;
}
function panesHtml() {
  const cols = PN.cols.map((c, ci) => `${ci ? `<div class="pane-split pane-split--col" data-pane-split="${ci}" role="separator" aria-orientation="vertical" tabindex="0" aria-label="Resize the panes beside this line" title="Drag to resize · arrow keys"></div>` : ''}<div class="pane-col" data-pane-col="${ci}" style="flex-grow:${c.w}">${c.rows.map((r, ri) =>
    `${ri ? `<div class="pane-split pane-split--row" data-pane-split="${ci}.${ri}" role="separator" aria-orientation="horizontal" tabindex="0" aria-label="Resize the panes above and below this line" title="Drag to resize · arrow keys"></div>` : ''}${pnPane(r.p, r)}`).join('')}</div>`).join('');
  return `<div class="panes" data-n="${pnAll().length}">${cols}</div>`;
}
// The right sidebar while a docked module has the focus: the note's, so it stays put (renderAll draws it for the note view itself)
function paneInspector() {
  const np = paneLayout() && !PANE_FILES.includes(UI.view) && pnNotePane(); if (!np) return '';
  return pnWith('notes', pnNoteOf(np), () => renderInspector(), np.kind === 'main');
}
// The window bar is drawn for the note too, for the same reason
const pnTitlebar0 = renderTitlebar;
renderTitlebar = function () {   // eslint-disable-line no-global-assign
  const np = !PN.inner && paneLayout() && !PANE_FILES.includes(UI.view) && pnNotePane();
  return np ? pnWith('notes', pnNoteOf(np), () => pnTitlebar0(), np.kind === 'main') : pnTitlebar0();
};
// One pane showing a module (it has no tab): its × in the header puts the note back
const pnHeader0 = renderHeader;
renderHeader = function () {   // eslint-disable-line no-global-assign
  const h = pnHeader0(); if (PN.inner || !S.offTab || paneLayout()) return h;
  return h.replace(/<\/div><\/header>\s*$/, `${pnClose(VIEW_LABEL[S.offTab], { id: 'main', kind: 'main' })}</div></header>`);
};

/* ---- Where a drop lands: left, right, top or bottom of the pane under the pointer, or the whole pane to swap ---- */
function pnArea() {   // the one-pane main area: under the header, above the status bar
  const m = app.querySelector('.app-body > .main'); if (!m) return null;
  const r = m.getBoundingClientRect(), h = m.querySelector(':scope > .app-header')?.getBoundingClientRect(), s = m.querySelector(':scope > .status-bar')?.getBoundingClientRect();
  const a = { left: r.left, right: r.right, top: h ? h.bottom : r.top, bottom: s ? s.top : r.bottom }; a.width = a.right - a.left; a.height = a.bottom - a.top; return a;
}
const pnWide = () => { const el = app.querySelector('.panes'); return (el ? el.getBoundingClientRect().width : pnArea()?.width || 0) / pnZoom(); };
const PN_EDGE = { left: 'on the left', right: 'on the right', top: 'on top', bottom: 'below' };
function pnTarget(x, y, what) {   // what: { v } a module, { tab } a note tab, or { note } a note dragged from the sidebar (QC 95)
  if (UI.zen === 'on') return { pane: 'main', zone: 'centre', name: what.v ? VIEW_LABEL[what.v] : 'The note', blocked: 'Zen shows one pane · F11 leaves Zen, then drop to split' };   // Build M · QC 95
  const inR = (r, px, py) => px >= r.left && px <= r.right && py >= r.top && py <= r.bottom;
  let id = 'main', pr, cr;
  const els = [...app.querySelectorAll('.panes [data-pane]')];
  if (els.length) { const el = els.find(e => inR(e.getBoundingClientRect(), x, y)); if (!el) return null; id = el.dataset.pane; pr = el.getBoundingClientRect(); cr = el.closest('.pane-col').getBoundingClientRect(); }
  else { pr = cr = pnArea(); if (!pr || !inR(pr, x, y)) return null; }
  const p = pnFind(id), z = pnZoom(), rx = (x - pr.left) / pr.width, ry = (y - pr.top) / pr.height;
  const d = { left: rx, right: 1 - rx, top: ry, bottom: 1 - ry }, edge = Object.keys(d).reduce((a, k) => d[k] < d[a] ? k : a, 'left');
  const zone = d[edge] > .3 ? 'centre' : edge, name = what.v ? VIEW_LABEL[what.v] : what.note ? (D.notes.find(n => n.id === what.note)?.title || 'Untitled note') : tabTitle(S.tabs.find(t => t.id === what.tab) || { kind: 'note' });
  const col = PN.cols.find(c => c.rows.some(r => r.p.id === id)), rows = col?.rows.length || 1, moving = what.v && pnOpenMod(what.v)?.kind === 'mod' ? 1 : 0;
  const t = { pane: id, zone, name, pr, cr };
  if (what.v && p.kind === 'mod' && p.v === what.v) return { ...t, blocked: `${name} is already here` };
  if (what.v && p.kind === 'main' && S.offTab === what.v && zone === 'centre') return { ...t, blocked: `${name} is already here` };
  if (zone === 'centre') {
    if (what.tab || what.note) return { ...t, blocked: 'Drop on an edge to open the note beside' };
    t.label = p.kind === 'mod' ? `Swap ${VIEW_LABEL[p.v]} for <b>${esc(name)}</b>` : p.kind === 'note' ? `<b>${esc(name)}</b> in place of this note` : `Open <b>${esc(name)}</b> here; the note stays in its tab`;
    return t;
  }
  if (pnAll().length - moving >= PANE_MAX) return { ...t, blocked: `${PANE_MAX} panes is the most · drop on a pane to swap` };
  if (edge === 'left' || edge === 'right') {
    if (PANE_SET.split === 'stacked') return { ...t, blocked: 'Panes stack (Settings → Editor) · drop on the top or bottom edge' };
    const half = (cr.width / z - PANE_GAP) / 2 >= PANE_MIN.w, even = (pnWide() - PANE_GAP * PN.cols.length) / (PN.cols.length + 1) >= PANE_MIN.w;
    if (!half && !even) return { ...t, blocked: `No room: panes stay at least ${PANE_MIN.w}px wide${PANE_SET.split !== 'side' && rows < 2 ? ' · try below' : ''}` };
    t.even = !half;
  } else {
    if (PANE_SET.split === 'side') return { ...t, blocked: 'Panes sit side by side (Settings → Editor) · drop on the left or right edge' };
    if (rows >= (PANE_SET.split === 'stacked' ? PANE_MAX : 2)) return { ...t, blocked: 'Two panes high is the most · drop on a pane to swap' };
    if ((cr.height / z - PANE_GAP * rows) / (rows + 1) < PANE_MIN.h) return { ...t, blocked: `No room: panes stay at least ${PANE_MIN.h}px tall` };
  }
  t.label = `<b>${esc(name)}</b> ${PN_EDGE[edge]}`;
  return t;
}
function pnPaint() {   // the drop zone and the chip under the pointer, drawn without a re-render while you drag
  app.querySelectorAll('.pane-ghost, .pane-zone').forEach(e => e.remove());
  const d = PN.drag; if (!d || d.x == null) return;
  const z = pnZoom(), ar = app.getBoundingClientRect(), t = d.tgt, main = app.querySelector('.app-body > .main'), mr = main?.getBoundingClientRect();
  if (t && !t.blocked && main) {
    const r = t.zone === 'left' || t.zone === 'right' ? t.cr : t.pr;
    let L = (r.left - mr.left) / z, T = (r.top - mr.top) / z, W = r.width / z, H = r.height / z;
    if (t.zone === 'right') { L += W / 2; W /= 2; } else if (t.zone === 'left') W /= 2; else if (t.zone === 'bottom') { T += H / 2; H /= 2; } else if (t.zone === 'top') H /= 2; else { L += 8; T += 8; W -= 16; H -= 16; }
    main.insertAdjacentHTML('beforeend', `<div class="pane-zone" data-zone="${t.zone}" style="left:${L + 4}px;top:${T + 4}px;width:${W - 8}px;height:${H - 8}px"><span>${t.label}</span></div>`);
  }
  if (d.tab || d.note) {   // a note: the browser draws the dragged tab or row; ours are the zone and, when it can't go there, why (QC 95)
    if (t?.blocked) app.insertAdjacentHTML('beforeend', `<div class="pane-ghost pane-ghost--note is-blocked" role="status" style="left:${(d.x - ar.left) / z + 16}px;top:${(d.y - ar.top) / z + 20}px">${ic('file')}<span>${esc(t.name)}</span><span class="pane-why">${esc(t.blocked)}</span></div>`);
  } else
  app.insertAdjacentHTML('beforeend', `<div class="pane-ghost${t?.blocked ? ' is-blocked' : ''}" role="status" style="left:${(d.x - ar.left) / z}px;top:${(d.y - ar.top) / z}px">${ic(VIEW_ICON[d.v])}<span>${esc(VIEW_LABEL[d.v])}</span>${t?.blocked ? `<span class="pane-why">${esc(t.blocked)}</span>` : !t ? '<span class="pane-why">Drop on a note or a pane · Esc cancels</span>' : ''}</div>`);
  const g = app.querySelector('.pane-ghost'); if (g && g.offsetLeft + g.offsetWidth + 20 > app.offsetWidth) g.style.left = (app.offsetWidth - g.offsetWidth - 20) + 'px';
}
function pnDragAt(x, y) { const d = PN.drag; if (!d) return; d.x = x; d.y = y; d.tgt = pnTarget(x, y, d.tab ? { tab: d.tab } : d.note ? { note: d.note } : { v: d.v }); pnPaint(); }
function pnStop() { PN.drag = null; app.querySelectorAll('.pane-ghost, .pane-zone').forEach(e => e.remove()); app.querySelectorAll('.is-pane-dragging').forEach(b => b.classList.remove('is-pane-dragging')); }

/* ---- What a drop, a click or a close does ---- */
function pnRemove(id) {   // take a pane out; its space goes back to its neighbour
  const ci = PN.cols.findIndex(c => c.rows.some(r => r.p.id === id)); if (ci < 0) return;
  const c = PN.cols[ci]; c.rows.splice(c.rows.findIndex(r => r.p.id === id), 1);
  if (c.rows.length) c.rows.forEach(r => { r.h = 1; });
  else { PN.cols.splice(ci, 1); const nb = PN.cols[ci - 1] || PN.cols[ci]; if (nb) nb.w += c.w; }
  if (PN.focus === id) PN.focus = 'main';
}
function pnFocusPane(id, quiet) {
  const p = pnFind(id); if (!p) return; PN.focus = id; PN.pmenu = null; S.menu = false;
  const v = pnViewOf(p); if (p.kind !== 'mod') { const n = pnNoteOf(p); if (n) S.noteId = n; }
  UI.view = v;
  if (!quiet) renderAll();
}
function pnDrop(what, t) {
  if (!t || t.blocked) return false;
  const tp = pnFind(t.pane); if (!tp) return false;
  let np;
  if (what.v) {
    const was = pnOpenMod(what.v);
    if (was?.kind === 'mod') { if (t.zone === 'centre' && t.pane === was.id) return false; pnRemove(was.id); }
    if (was?.kind === 'main' && t.zone !== 'centre') S.offTab = null;   // it leaves the main area; the note comes back there
    np = { id: 'p' + (++PN.seq), kind: 'mod', v: what.v };
  } else if (what.note) {   // Build M · QC 95: a note dragged from the sidebar, like a module from the rail
    if (!D.notes.some(n => n.id === what.note)) return false;
    np = { id: 'p' + (++PN.seq), kind: 'note', ref: what.note };
  } else {
    const tab = S.tabs.find(x => x.id === what.tab); if (!tab || tab.kind !== 'note') return false;
    const i = S.tabs.indexOf(tab); S.tabs.splice(i, 1);   // the note moves out of the tabs into its pane: one close for it, not two
    if (!S.tabs.length) S.tabs.push(mkTab('newtab', null));
    if (S.activeTab === tab.id) S.activeTab = (S.tabs[i] || S.tabs[i - 1]).id;
    np = { id: 'p' + (++PN.seq), kind: 'note', ref: tab.ref };
  }
  if (t.zone === 'centre') {
    if (tp.kind === 'main') { S.offTab = what.v; PN.focus = 'main'; }
    else { if (tp.kind === 'note' && !S.tabs.some(x => x.kind === 'note' && x.ref === tp.ref)) S.tabs.push(mkTab('note', tp.ref));   // the note it replaces goes back to the tabs
      Object.keys(tp).forEach(k => { if (k !== 'id') delete tp[k]; }); Object.assign(tp, { kind: np.kind, v: np.v, ref: np.ref }); PN.focus = tp.id; }
  } else {
    const ci = PN.cols.findIndex(c => c.rows.some(r => r.p.id === tp.id)), c = PN.cols[ci];
    if (t.zone === 'left' || t.zone === 'right') { if (t.even) PN.cols.forEach(x => { x.w = 1; }); else c.w /= 2; PN.cols.splice(t.zone === 'left' ? ci : ci + 1, 0, { w: t.even ? 1 : c.w, rows: [{ p: np, h: 1 }] }); }
    else { const ri = c.rows.findIndex(r => r.p.id === tp.id); c.rows.forEach(r => { r.h = 1; }); c.rows.splice(t.zone === 'top' ? ri : ri + 1, 0, { p: np, h: 1 }); }
    PN.focus = np.id;
  }
  pnFocusPane(PN.focus, true);
  status(t.zone === 'centre' ? `${t.name} opened in the main area · its × puts the note back` : `${t.name} docked ${PN_EDGE[t.zone]} · drag the line between to resize; × closes it, the rail reopens it`);
  renderAll(); return true;
}
function pnCloseP(id) {
  const p = pnFind(id); if (!p) return;
  const label = pnName(p);
  if (p.kind === 'main') { if (!S.offTab) return; S.offTab = null; PN.focus = 'main'; const t = pnTab(); UI.view = t ? tabView(t) : 'notes'; if (t?.kind === 'note') S.noteId = t.ref; }
  else { pnRemove(id); pnFocusPane(PN.focus, true); }
  PN.pmenu = null; status(`${label} closed${p.kind === 'note' ? '' : ' · reopen it from the rail any time'}`); renderAll();
  const host = app.querySelector('.pane.is-focused') || app.querySelector('.app-body > .main'); (host?.querySelector('.doc[contenteditable="true"]') || host?.querySelector('.view'))?.focus?.({ preventScroll: true });   // back to the text
}
// Where "beside" goes: the setting decides (Automatic: on the right while there's room, else below)
function pnWhere(where, probe) {
  if (where !== 'beside') return where;
  if (PANE_SET.split === 'stacked') return 'below';
  if (PANE_SET.split === 'side') return 'right';
  const r = probe('right'); return r && !r.blocked ? 'right' : 'below';
}
function pnProbe(what, where) {   // where a keyboard dock would land, measured on the drawn app: beside or below the note
  const host = pnNotePane() || pnFind('main'), el = app.querySelector(`.panes [data-pane="${host.id}"]`), r = el ? el.getBoundingClientRect() : pnArea(); if (!r) return null;
  return pnTarget(r.left + (r.right - r.left) * (where === 'right' ? .92 : .5), r.top + (r.bottom - r.top) * (where === 'below' ? .92 : .5), what);
}
function pnDock(v, where) {   // the keyboard ways: Ctrl+K and the rail's right-click menu
  PN.menu = null;
  if (where === 'main') { const o = pnOpenMod(v); if (o?.kind === 'mod') pnRemove(o.id); S.offTab = v; PN.focus = 'main'; UI.view = v; status(`${VIEW_LABEL[v]} in the main area · the note tabs stay put`); renderAll(); return; }
  renderAll();
  const w = pnWhere(where, x => pnProbe({ v }, x)), t = pnProbe({ v }, w);
  if (!t || t.blocked) { status(`${VIEW_LABEL[v]}: ${t?.blocked || 'no room'}`); renderAll(); return; }
  pnDrop({ v }, t);
}
// The note's More → Split right: the same note opens in a pane beside, like Obsidian (below, when the panes stack)
function pnSplitNote(tabId) {
  S.menu = false; let id = tabId;
  if (!id) { const n = pnNoteOf(pnFind(PN.focus) || { kind: 'main' }); if (!n) return; const tab = mkTab('note', n); S.tabs.push(tab); id = tab.id; }
  renderAll();
  const w = pnWhere('beside', x => pnProbe({ tab: id }, x)), tg = pnProbe({ tab: id }, w);
  if (!pnDrop({ tab: id }, tg)) { if (!tabId) S.tabs = S.tabs.filter(x => x.id !== id); status(tg?.blocked || 'No room beside'); renderAll(); }
}
function pnPaintMenu() {   // a rail icon's right-click menu: 6px right of the icon, tops lined up
  const v = PN.menu.v, b = app.querySelector(`.rail [data-act="view"][data-v="${v}"]`); if (!b) return;
  const z = pnZoom(), ar = app.getBoundingClientRect(), br = b.getBoundingClientRect(), o = pnOpenMod(v), l = VIEW_LABEL[v];
  const why = w => { const t = pnProbe({ v }, w); return !t ? 'disabled title="No room"' : t.blocked ? `disabled title="${esc(t.blocked)}"` : ''; };
  app.insertAdjacentHTML('beforeend', `<div class="menu card pane-menu" role="menu" aria-label="${l}" style="left:${(br.right - ar.left) / z + 6}px;top:${(br.top - ar.top) / z}px">
    <div class="pane-menu-head">${l}</div>
    <button class="menu-item" role="menuitem" data-act="pn-rm" data-v="main">${ic('square')}${o ? 'Go to it' : 'Open in the main area'}</button>
    <button class="menu-item" role="menuitem" data-act="pn-rm" data-v="right" ${why('right')}>${ic('columns')}Open beside the note</button>
    <button class="menu-item" role="menuitem" data-act="pn-rm" data-v="below" ${why('below')}>${ic('rows')}Open below the note</button>
    <div class="menu-sep"></div>
    <button class="menu-item" role="menuitem" data-act="pn-rm" data-v="close" ${o ? '' : 'disabled title="Not open"'}>${ic('x')}Close ${l}</button></div>`);
  const m = app.querySelector('.pane-menu'); if (m.offsetTop + m.offsetHeight > app.offsetHeight - 8) m.style.top = (app.offsetHeight - m.offsetHeight - 8) + 'px';
}
function pnPaintPMenu() {   // a pane's ⋮ menu: under its button, right edges lined up
  const p = pnFind(PN.pmenu), b = app.querySelector(`[data-act="pn-menu"][data-v="${PN.pmenu}"]`); if (!p || !b) return;
  const z = pnZoom(), ar = app.getBoundingClientRect(), br = b.getBoundingClientRect(), ci = PN.cols.findIndex(c => c.rows.some(r => r.p.id === p.id)), c = PN.cols[ci], ri = c.rows.findIndex(r => r.p.id === p.id);
  const item = (act, v, icon, l, on) => `<button class="menu-item" role="menuitem" data-act="${act}" data-v="${v}" ${on ? '' : 'disabled'}>${ic(icon)}${l}</button>`;
  app.insertAdjacentHTML('beforeend', `<div class="menu card pane-menu pane-pmenu" role="menu" aria-label="${esc(pnName(p))}">
    ${item('pn-move', 'left', 'left', 'Move left', ci > 0)}${item('pn-move', 'right', 'right', 'Move right', ci < PN.cols.length - 1)}${c.rows.length > 1 ? item('pn-move', 'up', 'up', 'Move up', ri > 0) + item('pn-move', 'down', 'down', 'Move down', ri < c.rows.length - 1) : ''}
    ${p.kind === 'mod' ? item('pn-tomain', p.id, 'square', 'Open in the main area', true) : ''}
    <div class="menu-sep"></div>${item('pn-close', p.id, 'x', 'Close', true)}</div>`);
  const m = app.querySelector('.pane-pmenu'); m.style.left = Math.max(8, (br.right - ar.left) / z - m.offsetWidth) + 'px'; m.style.top = (br.bottom - ar.top) / z + 6 + 'px';
}
function pnMove(dir) {
  const id = PN.pmenu, ci = PN.cols.findIndex(c => c.rows.some(r => r.p.id === id)); if (ci < 0) return; PN.pmenu = null;
  if (dir === 'left' || dir === 'right') { const to = ci + (dir === 'left' ? -1 : 1); if (to < 0 || to >= PN.cols.length) return; const [c] = PN.cols.splice(ci, 1); PN.cols.splice(to, 0, c); }
  else { const rows = PN.cols[ci].rows, ri = rows.findIndex(r => r.p.id === id), to = ri + (dir === 'up' ? -1 : 1); if (to < 0 || to >= rows.length) return; const [r] = rows.splice(ri, 1); rows.splice(to, 0, r); }
  status(`${pnName(pnFind(id))} moved ${dir}`); S.focus = { sel: `[data-act="pn-menu"][data-v="${id}"]` }; renderAll();
}
// A click into a note's pane: the caret goes where you clicked, as if the pane had been yours (else the pane's page takes the keys)
function pnCaretAt(id, x, y) {
  const el = app.querySelector(`.panes [data-pane="${id}"]`), doc = el?.querySelector('.doc[contenteditable="true"]'), r = doc && document.caretRangeFromPoint?.(x, y);
  if (doc && r && doc.contains(r.startContainer)) { doc.focus({ preventScroll: true }); const s = getSelection(); s.removeAllRanges(); s.addRange(r); return; }
  el?.querySelector('.view')?.focus?.({ preventScroll: true });
}
function pnNext(back) {
  const ps = pnAll(); if (ps.length < 2) { status('Only one pane open'); renderAll(); return; }
  const i = ps.findIndex(p => p.id === PN.focus), p = ps[(i + (back ? ps.length - 1 : 1)) % ps.length]; pnFocusPane(p.id, true);
  status(`Working in ${pnName(p)}`); renderAll();
  const el = app.querySelector(`.pane[data-pane="${p.id}"] .doc[contenteditable="true"]`) || app.querySelector(`.pane[data-pane="${p.id}"] .view`); el?.focus({ preventScroll: true });   // a note: its text takes the keys
}
function pnAct(act, v) {
  switch (act) {
    case 'pn-close': pnCloseP(v); break;
    case 'pn-menu': PN.pmenu = PN.pmenu === v ? null : v; PN.menu = null; PN.menuKeys = !!PN.pmenu; if (!PN.pmenu) S.focus = { sel: `[data-act="pn-menu"][data-v="${v}"]` }; renderAll(); break;
    case 'pn-move': pnMove(v); break;
    case 'pn-tomain': { const p = pnFind(v); PN.pmenu = null; if (p) pnDock(p.v, 'main'); break; }
    case 'pn-rm': { const m = PN.menu?.v; if (!m) break; const o = pnOpenMod(m); PN.menu = null;
      if (v === 'close') { if (o) pnCloseP(o.id); else renderAll(); break; }
      if (v === 'main' && o) { pnFocusPane(o.id); break; } pnDock(m, v); break; }
    case 'pn-dock': { const [m, w] = String(v).split(':'); pnDock(m, w || 'beside'); break; }
    case 'pn-next': pnNext(); break;
    case 'pn-fade': PANE_SET.fade = !PANE_SET.fade; saveSettings({ pane_fade: PANE_SET.fade }); paneLook(); status(`The other panes ${PANE_SET.fade ? 'fade' : 'stay as they are'}`); S.focus = { sel: '[data-act="pn-fade"]' }; renderAll(); break;
    case 'pn-set': { const [k, val] = String(v).split(':'); if (!PANE_CHOICES[k]) break; PANE_SET[k] = val; saveSettings({ [PANE_CHOICES[k][0]]: val }); paneLook();
      if (k === 'restore' && val === 'last') PN.saved = ''; status(`${PANE_CHOICES[k][1]}: ${PANE_CHOICES[k][2].find(x => x[0] === val)[1]}`); S.focus = { sel: `[data-act="pn-set"][data-v="${v}"]` }; renderAll(); break; }
  }
}
// Ctrl+K: the keyboard way to dock
PAL_COMMANDS.push(...PANE_MODS.map(m => [`Open ${VIEW_LABEL[m]} beside the note`, VIEW_ICON[m], 'pn-dock', `${m}:beside`]), ['Next pane', 'columns', 'pn-next']);
const paneLook = () => { document.body.dataset.paneFocus = PANE_SET.focus; document.body.dataset.paneFade = PANE_SET.fade ? 'on' : 'off'; };
paneLook();

/* ---- After each draw: the rail shows every open module (one pressed look), the menus, a drag that's on, the layout saved ---- */
const pnAfter0 = afterRender;
afterRender = function () {   // eslint-disable-line no-global-assign
  pnAfter0.apply(this, arguments);
  const f = pnFind(PN.focus), cur = f && pnViewOf(f);
  app.querySelectorAll('.rail [data-act="view"][data-v]').forEach(b => {
    const v = b.dataset.v, open = v === 'notes' ? pnNoteShown() && (paneLayout() || UI.view === 'notes') : !!pnOpenMod(v);
    if (open) b.setAttribute('aria-pressed', 'true'); else b.removeAttribute('aria-pressed');
    if (cur === v || (v === 'notes' && cur === 'newtab')) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
    if (PANE_MODS.includes(v)) b.title = `${VIEW_LABEL[v]}${open ? ' (open)' : ''} · drag beside a note to dock it`;
    b.classList.toggle('is-pane-dragging', PN.drag?.v === v);
  });
  if (PN.menu) pnPaintMenu();
  if (PN.pmenu) pnPaintPMenu();
  if (PN.menuKeys) { PN.menuKeys = false; app.querySelector('.pane-menu .menu-item:not([disabled])')?.focus({ preventScroll: true }); }   // the menus are drawn after the page: the focus goes in now
  if (PN.drag && !PN.drag.tab) pnPaint();
  if (PN.fit) { PN.fit = false; pnFit(); }
  pnSave();
};
// keepScroll: a page keeps its place while the same panes show
const pnKeep0 = keepScroll;
keepScroll = function () { const k = S.split; S.split = paneLayout() ? paneSig() : null; try { return pnKeep0.apply(this, arguments); } finally { S.split = k; } };   // eslint-disable-line no-global-assign

/* ---- Listeners: clicks (capture: a click in another pane only moves the focus there), the rail drag, note tabs, the lines, keys ---- */
app.addEventListener('click', e => {
  if (PN.swallow) { e.stopPropagation(); e.preventDefault(); return; }   // the click that ends a drag
  const t = e.target.closest('[data-act]'), act = t?.dataset.act;
  if (act?.startsWith('pn-')) { e.stopPropagation(); e.preventDefault(); if (!t.disabled) pnAct(act, t.dataset.v); return; }
  if ((e.target.closest('[data-wstab]') && act !== 'tab-close') || act === 'tab-pick' || act === 'tab-new') PN.focus = 'main';   // a note tab belongs to the main pane
  const pane = e.target.closest('.panes [data-pane]');
  if (pane && pane.dataset.pane !== PN.focus) { e.stopPropagation(); e.preventDefault(); pnFocusPane(pane.dataset.pane); pnCaretAt(pane.dataset.pane, e.clientX, e.clientY); return; }   // anywhere in a pane moves the focus there
  if ((PN.menu || PN.pmenu) && !e.target.closest('.pane-menu')) { PN.menu = null; PN.pmenu = null; if (!t) { renderAll(); return; } }
  if (act === 'view' && PANE_MODS.includes(t.dataset.v)) { const o = pnOpenMod(t.dataset.v); if (o?.kind === 'mod') { e.stopPropagation(); e.preventDefault(); pnFocusPane(o.id); return; } }   // already docked: go to it
  if (act === 'split-right') { e.stopPropagation(); e.preventDefault(); pnSplitNote(); return; }
  if (act === 'tab-split') { e.stopPropagation(); e.preventDefault(); const c = S.ctx; S.ctx = null; if (c) pnSplitNote(c.id); return; }   // a tab's right-click → Split right
}, true);
app.addEventListener('contextmenu', e => {
  const b = e.target.closest('.rail [data-act="view"][data-v]'); if (!b || !PANE_MODS.includes(b.dataset.v)) return;
  e.preventDefault(); e.stopPropagation(); PN.pmenu = null; PN.menu = { v: b.dataset.v }; PN.menuKeys = true; renderAll();
}, true);
app.addEventListener('pointerdown', e => {   // drag a module's rail icon over the main area
  if (e.button !== 0) return;
  const b = e.target.closest('.rail [data-act="view"][data-v]'); if (!b || !PANE_MODS.includes(b.dataset.v)) return;
  const st = { v: b.dataset.v, x: e.clientX, y: e.clientY, live: false };
  const move = ev => {
    if (!st.live) { if (Math.hypot(ev.clientX - st.x, ev.clientY - st.y) < 6) return; st.live = true; PN.menu = null; PN.pmenu = null; app.querySelectorAll('.pane-menu').forEach(m => m.remove()); PN.drag = { v: st.v }; b.classList.add('is-pane-dragging'); }
    if (PN.drag) pnDragAt(ev.clientX, ev.clientY);
  };
  const end = ev => {
    document.removeEventListener('pointermove', move, true); document.removeEventListener('pointerup', end, true); document.removeEventListener('pointercancel', end, true);
    if (!st.live) return;
    PN.swallow = true; setTimeout(() => { PN.swallow = false; }, 0);
    const d = PN.drag, tgt = d?.tgt; pnStop();
    if (ev.type === 'pointerup' && d && tgt && !tgt.blocked) pnDrop({ v: st.v }, tgt);
    else { if (d && ev.type === 'pointerup') status(tgt?.blocked ? `${VIEW_LABEL[st.v]}: ${tgt.blocked}` : `${VIEW_LABEL[st.v]} not moved`); renderAll(); }
  };
  document.addEventListener('pointermove', move, true); document.addEventListener('pointerup', end, true); document.addEventListener('pointercancel', end, true);
}, true);
// A note tab dragged onto a pane's edge opens beside (the note split, kept); over the tab strip it still reorders (actions.js).
// Build M · QC 95: a note dragged from the sidebar does the same over the note area (feedback: "cannot seem to add more than 2
// notes, but adding tasks or timeline is fine": modules came from the rail, a note from the sidebar did nothing). Over the note
// area the drag is ours: the editor never tracks a caret for it, and a drop that can't land is refused (no-drop), never pasted.
const pnNoteDrag = e => qc69Files(e) || e.target.closest?.('.tabstrip, .tab-tools') ? null : S.tabDrag ? { tab: S.tabDrag }
  : S.drag?.kind === 'note' && e.target.closest?.('.app-body > .main') ? { note: S.drag.id } : null;
app.addEventListener('dragover', e => {
  const w = pnNoteDrag(e); if (!w) { if (PN.drag?.tab || PN.drag?.note) pnStop(); return; }   // Build M · QC 69: never a file from outside
  e.stopPropagation(); e.preventDefault(); PN.drag = { ...w }; pnDragAt(e.clientX, e.clientY);
  if (e.dataTransfer) e.dataTransfer.dropEffect = PN.drag.tgt && !PN.drag.tgt.blocked ? 'move' : 'none';
}, true);
app.addEventListener('drop', e => {
  const w = pnNoteDrag(e); if (!w) return;   // Build M · QC 69
  e.stopPropagation(); e.preventDefault(); const tg = pnTarget(e.clientX, e.clientY, w); S.tabDrag = null; if (w.note) S.drag = null; pnStop();
  if (!pnDrop(w, tg)) { if (tg?.blocked) status(`${tg.name}: ${tg.blocked}`); renderAll(); }
}, true);
app.addEventListener('dragend', () => { if (PN.drag?.tab || PN.drag?.note) pnStop(); }, true);
// The lines between panes: drag, or arrow keys; never narrower than 360px or shorter than 240px
function pnPair(d) {
  const [ci, ri] = d.dataset.paneSplit.split('.').map(Number), row = ri != null && !Number.isNaN(ri);
  return { row, a: row ? PN.cols[ci].rows[ri - 1] : PN.cols[ci - 1], b: row ? PN.cols[ci].rows[ri] : PN.cols[ci], k: row ? 'h' : 'w' };
}
app.addEventListener('pointerdown', e => {
  const d = e.target.closest('[data-pane-split]'); if (!d || e.button !== 0) return;
  const { row, a, b, k } = pnPair(d), ea = d.previousElementSibling, eb = d.nextElementSibling, ra = ea.getBoundingClientRect(), rb = eb.getBoundingClientRect();
  const total = row ? ra.height + rb.height : ra.width + rb.width, sum = a[k] + b[k], minF = Math.min(.45, (row ? PANE_MIN.h : PANE_MIN.w) * pnZoom() / total);
  d.setPointerCapture?.(e.pointerId); d.classList.add('is-dragging'); e.preventDefault();
  const move = ev => { const f = clamp(row ? (ev.clientY - ra.top) / total : (ev.clientX - ra.left) / total, minF, 1 - minF); a[k] = sum * f; b[k] = sum * (1 - f); ea.style.flexGrow = a[k]; eb.style.flexGrow = b[k]; };
  const up = () => { d.removeEventListener('pointermove', move); d.removeEventListener('pointerup', up); d.classList.remove('is-dragging'); fitToolbar(); pnSave(); };
  d.addEventListener('pointermove', move); d.addEventListener('pointerup', up);
});
app.addEventListener('keydown', e => {
  if (e.key === 'Escape' && (PN.menu || PN.pmenu)) { e.stopPropagation(); e.preventDefault(); const v = PN.menu?.v, pm = PN.pmenu; PN.menu = null; PN.pmenu = null;
    S.focus = { sel: v ? `.rail [data-act="view"][data-v="${v}"]` : `[data-act="pn-menu"][data-v="${pm}"]` }; renderAll(); return; }
  const d = e.target.closest?.('[data-pane-split]');
  if (d && e.key.startsWith('Arrow')) { e.preventDefault(); const { row, a, b, k } = pnPair(d); if (row !== (e.key === 'ArrowUp' || e.key === 'ArrowDown')) return;
    const ra = d.previousElementSibling.getBoundingClientRect(), rb = d.nextElementSibling.getBoundingClientRect(), total = row ? ra.height + rb.height : ra.width + rb.width, minF = Math.min(.45, (row ? PANE_MIN.h : PANE_MIN.w) * pnZoom() / total);
    const sum = a[k] + b[k], step = sum * .05 * (e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : -1); a[k] = clamp(a[k] + step, sum * minF, sum * (1 - minF)); b[k] = sum - a[k];
    d.previousElementSibling.style.flexGrow = a[k]; d.nextElementSibling.style.flexGrow = b[k]; fitToolbar(); pnSave(); }
}, true);
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && PN.drag && !PN.drag.tab) { e.preventDefault(); e.stopPropagation(); const v = PN.drag.v; pnStop(); status(`${VIEW_LABEL[v]}: drag cancelled, nothing changed`); renderAll(); return; }   // wherever the focus is
  if (e.key === 'F6' && !e.ctrlKey && !e.altKey && !POP && !S.modal) { e.preventDefault(); e.stopPropagation(); pnNext(e.shiftKey); }
}, true);

/* ---- Settings → Editor → Split screen (R45): the user's choice, with a good default ---- */
function paneSettings() {
  const seg = k => { const [, label, list] = PANE_CHOICES[k]; return `<div class="set-row"><div class="set-label" id="pn-${k}">${label}</div><div class="seg" role="group" aria-labelledby="pn-${k}">${list.map(([v, l]) =>
    `<button class="seg-opt" data-act="pn-set" data-v="${k}:${v}" aria-pressed="${PANE_SET[k] === v}">${l}</button>`).join('')}</div></div>`; };
  // QC 4 · 42: each row changes one thing: the look of the pane you work in, then whether the others fade (with any look)
  const fade = `<div class="set-row"><div><div class="set-label" id="pn-fade">Fade the other panes</div><div class="set-desc">The panes you are not working in show at 62%, with any of the looks above</div></div><button class="toggle" role="switch" aria-checked="${PANE_SET.fade}" aria-labelledby="pn-fade" data-act="pn-fade"></button></div>`;
  return `<div class="pop-sec pn-set"><div class="eyebrow">Split screen</div>${seg('focus')}${fade}${seg('split')}${seg('restore')}
    <p class="set-desc">Drag a module's rail icon beside a note to dock it. Three panes at most, each at least ${PANE_MIN.w}px wide and ${PANE_MIN.h}px tall. Automatic puts a new pane beside while there's room, else below.</p></div>`;
}
const pnSettings0 = settingsPane;
settingsPane = sec => pnSettings0(sec) + (sec === 'editor' ? paneSettings() : '');   // eslint-disable-line no-global-assign

/* ---- Next launch: as you left it (pane_restore = last), or notes only ---- */
const pnReader0 = readerFromConfig;
readerFromConfig = function (c) {   // eslint-disable-line no-global-assign
  pnReader0(c);
  Object.entries(PANE_CHOICES).forEach(([k, [key, , list]]) => { if (list.some(x => x[0] === c[key])) PANE_SET[k] = c[key]; });
  if (typeof c.pane_fade === 'boolean') PANE_SET.fade = c.pane_fade;
  if (c.pane_focus_style === 'dim') { PANE_SET.focus = 'frame'; PANE_SET.fade = true; }   // QC 4 · 42 (config.py migrates it too)
  PN.layout = c.pane_layout && typeof c.pane_layout === 'object' ? c.pane_layout : null; PN.read = true; paneLook();
  // The settings can arrive after the vault (actions.js asks for both while the later scripts still load): restore then, if nothing moved yet
  if (PN.wait && VAULT.live) { PN.wait = false; if (PANE_SET.restore === 'last' && PN.layout && paneSig() === 'main:@main' && PANE_FILES.includes(UI.view) && pnRestore(PN.layout)) PN.saved = JSON.stringify(pnLayoutNow()); }
};
function pnLayoutNow() {   // what's saved: the note tabs, the module in the main area, the panes and the one you work in
  const tabs = S.tabs.filter(t => t.kind === 'note' && t.ref).map(t => t.ref), at = pnTab();
  return { tabs, active: at?.kind === 'note' ? tabs.indexOf(at.ref) : -1, off: S.offTab || null, focus: pnAll().findIndex(p => p.id === PN.focus),
    cols: PN.cols.map(c => ({ w: +c.w.toFixed(3), rows: c.rows.map(r => ({ h: +r.h.toFixed(3), kind: r.p.kind, ...(r.p.v ? { v: r.p.v } : {}), ...(r.p.ref ? { ref: r.p.ref } : {}) })) })) };
}
function pnSave() {
  if (!VAULT.live || CHECK || PN.wait || PANE_SET.restore !== 'last') return;   // PN.wait: the layout to restore hasn't come yet: never save over it
  const L = JSON.stringify(pnLayoutNow()); if (L === PN.saved) return; PN.saved = L;
  clearTimeout(pnSave.t); pnSave.t = setTimeout(() => saveSettings({ pane_layout: JSON.parse(L) }), 800);
}
function pnRestore(L) {
  const has = id => D.notes.some(n => n.id === id);
  const tabs = (Array.isArray(L.tabs) ? L.tabs : []).filter(has);
  const cols = (Array.isArray(L.cols) ? L.cols : []).map(c => ({ w: +c.w > 0 ? +c.w : 1, rows: (Array.isArray(c.rows) ? c.rows : []).filter(r => r && (r.kind === 'main' || (r.kind === 'mod' && PANE_MODS.includes(r.v)) || (r.kind === 'note' && has(r.ref))))
    .map(r => ({ h: +r.h > 0 ? +r.h : 1, p: r.kind === 'main' ? { id: 'main', kind: 'main' } : { id: 'p' + (++PN.seq), kind: r.kind, ...(r.kind === 'mod' ? { v: r.v } : { ref: r.ref }) } })) })).filter(c => c.rows.length);
  const flat = cols.flatMap(c => c.rows.map(r => r.p)), mods = new Set();
  if (flat.filter(p => p.kind === 'main').length !== 1 || flat.length > PANE_MAX || flat.some(p => p.kind === 'mod' && (mods.has(p.v) || !mods.add(p.v)))) return false;   // a layout that can't be right: start fresh
  if (tabs.length) { S.tabSeq = 0; S.tabs = tabs.map(id => mkTab('note', id)); const i = +L.active; S.activeTab = (S.tabs[i >= 0 && i < S.tabs.length ? i : 0]).id; S.noteId = pnTab().ref; }
  PN.cols = cols; S.offTab = PANE_MODS.includes(L.off) && !flat.some(p => p.kind === 'mod' && p.v === L.off) ? L.off : null;
  const f = flat[+L.focus] || flat.find(p => p.kind === 'main'); PN.focus = f.id; UI.view = pnViewOf(f); if (f.kind === 'note') S.noteId = f.ref;
  PN.fit = true; return true;
}
// A layout saved on a wider screen: what doesn't fit at 360px a column goes, the main pane stays
function pnFit() {
  const room = Math.max(1, Math.floor((pnWide() + PANE_GAP) / (PANE_MIN.w + PANE_GAP))); let gone = 0;
  while (PN.cols.length > room) { const ci = PN.cols.length - 1 - [...PN.cols].reverse().findIndex(c => !c.rows.some(r => r.p.kind === 'main')); if (ci >= PN.cols.length) break; gone += PN.cols[ci].rows.length; PN.cols.splice(ci, 1); }
  if (!gone) return; if (!pnFind(PN.focus)) pnFocusPane('main', true); status(`${gone} pane${gone > 1 ? 's' : ''} left out: no room at this window size`); renderAll();
}
const pnResetView0 = resetVaultView;
resetVaultView = function () {   // eslint-disable-line no-global-assign
  pnResetView0.apply(this, arguments); pnReset(); PN.wait = !PN.read && !CHECK;   // the settings haven't been read yet: readerFromConfig restores when they come
  if (PANE_SET.restore === 'last' && PN.layout) { if (!pnRestore(PN.layout)) pnReset(); }
  if (PN.wait && api()) api().get_settings().then(c => { if (PN.wait && c && typeof c === 'object') { readerFromConfig(c); renderAll(); } }).catch(() => {});   // ask for them now
  PN.saved = JSON.stringify(pnLayoutNow());
};
const pnSample0 = loadSample;
loadSample = function () { pnSample0.apply(this, arguments); pnReset(); };   // eslint-disable-line no-global-assign
