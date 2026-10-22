/* Build M · parity round with mockup R52 (the R51 / R52 decisions, 2026-10-18):
   1. The side panels resize like Obsidian's: drag the line between a side bar and the note (or ← → on it), 200–480px, kept
      (config side_w / insp_w). Double-click the line for the default width again.
   2. No Windows right-click menu anywhere: a text box that has no menu of its own gets NeuroVault's Cut / Copy / Paste /
      Select all; anywhere else that has no menu, the right-click does nothing (dictionary.js: Shift + right-click is plain).
   3. The editor toolbar's Attach (paperclip, right after Image): a picker, then straight into the note you're writing in, at the
      caret, with Undo; no question and never a new note ("it WILL ALWAYS open in that notes rather than an new").
   4. Settings → Editor → Toolbar: Position (Top default · Left · Right, a column beside the text), Width (Fit the buttons default
      since R54 (QC 66) · Text column · Full width), Autohide (Off default · On hover · While typing). Config toolbar_position /
      toolbar_width / toolbar_autohide.
   QC 110 (feedback: "autohide the toolbar and bring it back when clicking or hovering over the top of a note"): Autohide's
   "On hover" (shown whenever the pointer was anywhere on the note) is now "Point at the top" (the same saved value, hover): the
   toolbar is hidden and takes no room (the text moves up; when it shows it lies over the text, so nothing jumps); it shows when you
   point at or click a strip along the top of the note (or the side it's on), or Tab into it; it stays while you're on it or one of
   its menus is open, and goes 1 s after you leave. A slim line in the strip shows where to point. */
'use strict';
const PAR = { side: null, insp: null, tb: { pos: 'top', width: 'fit', hide: 'off' } };
const PAR_MIN = 200, PAR_MAX = 480, PAR_STEP = 16;
const PAR_TB = {
  pos: ['toolbar_position', 'Position', 'Above the note, or down its left or right side as a column', [['top', 'Top'], ['left', 'Left'], ['right', 'Right']]],
  width: ['toolbar_width', 'Width', 'As wide as its buttons, centred on the text; held to the text column; or across the note area', [['fit', 'Fit the buttons'], ['text', 'Text column'], ['full', 'Full width']]],
  hide: ['toolbar_autohide', 'Autohide', () => ({ off: 'Always shown', hover: `Hidden until you point at or click the ${PAR.tb.pos === 'top' ? 'top' : PAR.tb.pos + ' side'} of the note`, caret: 'Hidden until the caret is in the note' })[PAR.tb.hide] || '',
    [['off', 'Off'], ['hover', 'Point at the top'], ['caret', 'While typing']]] };
const parZoom = () => app.getBoundingClientRect().width / app.offsetWidth || 1;

/* ---- 1 · the side panels' widths ---- */
function parWidths() {
  ['side', 'insp'].forEach(k => { if (PAR[k]) app.style.setProperty(`--${k}-w`, PAR[k] + 'px'); else app.style.removeProperty(`--${k}-w`); });
  document.body.dataset.tbpos = PAR.tb.pos; document.body.dataset.tbwidth = PAR.tb.width; document.body.dataset.tbhide = PAR.tb.hide;
}
const parNow = k => Math.round((k === 'side' ? app.querySelector('#left-sidebar') : app.querySelector('.app-body > .inspector'))?.getBoundingClientRect().width / parZoom() || 0);
function parHandles() {
  const h = (k, label) => `<div class="par-resize par-resize--${k}" data-par-resize="${k}" role="separator" aria-orientation="vertical" tabindex="0" aria-label="${label}" aria-valuemin="${PAR_MIN}" aria-valuemax="${PAR_MAX}" aria-valuenow="${parNow(k)}" title="Drag to resize · ← → · double-click for the default width"></div>`;
  const sb = app.querySelector('#left-sidebar'), ins = app.querySelector('.app-body > .inspector');
  if (sb && !sb.querySelector(':scope > .par-resize')) sb.insertAdjacentHTML('beforeend', h('side', 'Resize the left sidebar'));
  if (ins && ins.offsetWidth && !ins.querySelector(':scope > .par-resize')) ins.insertAdjacentHTML('beforeend', h('insp', 'Resize the right sidebar'));
}
function parSet(k, w, save) {
  PAR[k] = w == null ? null : clamp(Math.round(w), PAR_MIN, PAR_MAX); parWidths(); parBar(); parToolbar();   // the toolbar follows the note area as you drag
  app.querySelectorAll(`[data-par-resize="${k}"]`).forEach(x => x.setAttribute('aria-valuenow', parNow(k)));
  if (save) { if (!CHECK) saveSettings({ [k === 'side' ? 'side_w' : 'insp_w']: PAR[k] }); else (PAR.saved ||= []).push({ [k]: PAR[k] });
    tabOverflow(); fitToolbar(); status(`${k === 'side' ? 'Left' : 'Right'} sidebar: ${PAR[k] ? PAR[k] + 'px' : 'the default width'}`); }
}
app.addEventListener('pointerdown', e => {
  const d = e.target.closest?.('[data-par-resize]'); if (!d || e.button !== 0) return;
  e.preventDefault(); e.stopPropagation(); const k = d.dataset.parResize, w0 = parNow(k), x0 = e.clientX, z = parZoom(), dir = k === 'side' ? 1 : -1;
  d.setPointerCapture?.(e.pointerId); d.classList.add('is-dragging'); document.body.classList.add('is-resizing');
  const move = ev => parSet(k, w0 + dir * (ev.clientX - x0) / z, false);
  const up = () => { d.removeEventListener('pointermove', move); d.removeEventListener('pointerup', up); d.classList.remove('is-dragging'); document.body.classList.remove('is-resizing'); if (PAR[k] !== w0) parSet(k, PAR[k], true); };
  d.addEventListener('pointermove', move); d.addEventListener('pointerup', up);
}, true);
app.addEventListener('dblclick', e => { const d = e.target.closest?.('[data-par-resize]'); if (d) { e.preventDefault(); parSet(d.dataset.parResize, null, true); } }, true);
app.addEventListener('keydown', e => {
  const d = e.target.closest?.('[data-par-resize]'); if (!d || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
  e.preventDefault(); e.stopPropagation(); const k = d.dataset.parResize, dir = k === 'side' ? 1 : -1, w = parNow(k);
  parSet(k, e.key === 'Home' ? PAR_MIN : e.key === 'End' ? PAR_MAX : w + dir * (e.key === 'ArrowRight' ? PAR_STEP : -PAR_STEP), true);
}, true);

/* ---- 2 · no Windows menu: a text box's own menu (Cut, Copy, Paste, Select all); elsewhere nothing ---- */
const PAR_TEXT = 'input:not([type="checkbox"]):not([type="radio"]):not([type="range"]):not([type="color"]):not([type="file"]):not([type="button"]):not([type="submit"]), textarea';
const PARM = { el: null, a: 0, b: 0 };
function parFieldMenu(e, el) {
  parMenuClose(); PARM.el = el; PARM.a = el.selectionStart ?? 0; PARM.b = el.selectionEnd ?? 0;
  const sel = PARM.b > PARM.a, ro = el.readOnly || el.disabled, z = parZoom(), ar = app.getBoundingClientRect();
  const it = (act, icon, label, key, on) => `<button class="menu-item" role="menuitem" data-par-menu="${act}" ${on ? '' : 'disabled'}>${ic(icon)}<span class="truncate">${label}</span><span class="menu-key">${key}</span></button>`;
  app.insertAdjacentHTML('beforeend', `<div class="menu menu--context card menu--tight par-fieldmenu" role="menu" aria-label="Text" style="left:${Math.min((e.clientX - ar.left) / z, app.offsetWidth - 240)}px;top:${Math.min((e.clientY - ar.top) / z, app.offsetHeight - 160)}px">
    ${it('cut', 'cut', 'Cut', 'Ctrl+X', sel && !ro)}${it('copy', 'copy', 'Copy', 'Ctrl+C', sel)}${it('paste', 'paste', 'Paste', 'Ctrl+V', !ro)}<div class="menu-gap"></div>${it('all', 'selectall', 'Select all', 'Ctrl+A', !!el.value)}</div>`);
  app.querySelector('.par-fieldmenu .menu-item:not([disabled])')?.focus({ preventScroll: true });
}
function parMenuClose(back) { app.querySelectorAll('.par-fieldmenu').forEach(m => m.remove()); if (back && PARM.el?.isConnected) { PARM.el.focus({ preventScroll: true }); PARM.el.setSelectionRange?.(PARM.a, PARM.b); } }
async function parFieldAct(act) {
  const el = PARM.el; parMenuClose(); if (!el?.isConnected) return;
  el.focus({ preventScroll: true }); el.setSelectionRange?.(PARM.a, PARM.b);
  if (act === 'all') { el.select(); status('Selected all'); return; }
  if (act === 'cut' || act === 'copy') { document.execCommand(act); status(act === 'cut' ? 'Cut' : 'Copied'); return; }
  let text = null; try { text = await navigator.clipboard.readText(); } catch (x) { text = null; }
  if (text == null) { status('Paste with Ctrl+V: this window can’t read the clipboard for the menu'); return; }
  el.focus({ preventScroll: true }); el.setSelectionRange?.(PARM.a, PARM.b); document.execCommand('insertText', false, text); status('Pasted');
}
app.addEventListener('contextmenu', e => {   // after the app's own menus (the note, a writing field, a tree row, a tab, a rail icon…)
  if (e.defaultPrevented) return;
  const el = e.target.closest?.(PAR_TEXT); e.preventDefault();
  if (el) parFieldMenu(e, el); else parMenuClose();
});
document.addEventListener('contextmenu', e => { if (!e.defaultPrevented) e.preventDefault(); });   // outside the app's frame too: never Windows' menu
app.addEventListener('pointerdown', e => { if (!e.target.closest?.('.par-fieldmenu')) parMenuClose(); }, true);
app.addEventListener('click', e => { const b = e.target.closest?.('[data-par-menu]'); if (b && !b.disabled) { e.stopPropagation(); parFieldAct(b.dataset.parMenu); } }, true);
document.addEventListener('keydown', e => {
  const m = app.querySelector('.par-fieldmenu'); if (!m) return;
  if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); parMenuClose(true); return; }
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); const it = [...m.querySelectorAll('.menu-item:not([disabled])')], i = it.indexOf(document.activeElement); it[(i + (e.key === 'ArrowDown' ? 1 : it.length - 1)) % it.length]?.focus(); }
}, true);

/* ---- 3 · the toolbar's Attach: right after Image; into this note, at the caret, with Undo ---- */
Object.assign(ICON, { paperclip: '<path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48"/>' });
{ const zr0 = zonesRibbon;
  zonesRibbon = function () {   // eslint-disable-line no-global-assign
    const h = zr0.apply(this, arguments), btn = `<button class="ed-btn" data-fmt="attach" aria-label="Attach a file to this note" title="Attach a file to this note">${ic('paperclip')}</button>`;
    const m = h.match(/<button class="ed-btn" data-fmt="image"[^>]*>[\s\S]*?<\/button>/); return m ? h.replace(m[0], () => m[0] + btn) : h;
  };
}
ED_OVERFLOW.splice(ED_OVERFLOW.indexOf('image'), 0, 'attach');   // it leaves the row just before Image
{ const df0 = doFormat; doFormat = function (cmd) { if (cmd === 'attach') { parAttach(); return; } return df0.apply(this, arguments); }; }   // eslint-disable-line no-global-assign
async function parAttach() {
  S.edMore = false; const doc = typeof edDocNow === 'function' ? edDocNow() : app.querySelector('.doc'); if (!doc) return;
  if (!doc.isContentEditable) { toast('Editing is paused while a reading mode is on'); return; }
  const n = D.notes.find(x => x.id === doc.dataset.note); if (!n) return;
  // where the caret is: the block it's in (else the end of the note)
  const r = typeof edRange === 'function' ? edRange(doc) : null, bs = doBlocks(doc);
  let at = bs.length - 1; if (r) { let el = r.startContainer.nodeType === 1 ? r.startContainer : r.startContainer.parentElement; while (el && el.parentElement !== doc) el = el.parentElement; const i = bs.indexOf(el); if (i >= 0) at = i; }
  if (!realData()) { toast('Attaching a file needs the app with your vault open'); return; }
  let p; try { p = await api().attach_pick(); } catch (x) { p = { status: 'error', message: "The file picker didn't open" }; }   // straight to the bridge: the dialog waits for you
  if (p?.status === 'cancelled') return;
  if (failed(p) || !p?.path) { toast(p?.message || "Couldn't attach the file"); return; }
  await doAttach([{ name: fileName(p.path), path: p.path }], n.id, at);   // Build O's pipeline: copied in, the embed after the caret's block, Undo
}

/* ---- 4 · the toolbar's place, width and Autohide (measured after each draw) ---- */
const parVert = () => PAR.tb.pos === 'left' || PAR.tb.pos === 'right';
{ const fo0 = fitOne;
  fitOne = function (tb) {   // eslint-disable-line no-global-assign
    if (!parVert() || !tb.closest('.view-inner')) return fo0.apply(this, arguments);
    const wrap = tb.querySelector('.ed-more-wrap'), zb = tb.querySelector('.ed-zone--html'), hidden = [];   // a column: what doesn't fit its height goes into ⋯
    tb.querySelectorAll('.is-ovf').forEach(x => x.classList.remove('is-ovf'));
    if (tb.scrollHeight > tb.clientHeight + 1) {
      for (const k of ED_OVERFLOW) { const b = tb.querySelector(`.ed-zone [data-fmt="${k}"], .ed-zone [data-act="ed-pop"][data-v="${k}"]`); if (!b) continue;
        b.classList.add('is-ovf'); hidden.push(b); if (zb && !zb.querySelector('.ed-btn:not(.is-ovf)')) zb.classList.add('is-ovf'); if (tb.scrollHeight <= tb.clientHeight + 1) break; }
    }
    const m = tb.querySelector('.ed-more-menu'); if (!m) return;
    const attr = b => ['fmt', 'act', 'v'].filter(k => b.dataset[k]).map(k => `data-${k}="${esc(b.dataset[k])}"`).join(' ');
    m.innerHTML = `<button class="menu-item" role="menuitem" data-act="spell-pass">${ic('check')}Check spelling<span class="menu-kbd">F7</span></button>${hidden.length ? '<div class="menu-sep"></div>' : ''}`
      + hidden.slice().reverse().map(b => `<button class="menu-item" role="menuitem" ${attr(b)}>${b.querySelector('svg')?.outerHTML || ''}${esc(b.getAttribute('aria-label'))}</button>`).join('');
  };
}
function parToolbar() {
  app.querySelectorAll('.view--note .view-inner > .ed-toolbar').forEach(tb => {
    const vi = tb.parentElement, view = tb.closest('.view--note'), k = parZoom(), vr = view.getBoundingClientRect(), ir = vi.getBoundingClientRect();
    const grid = vi.querySelector('.ed-grid'), head = vi.querySelector('.note-head'), gl = (ir.left - vr.left) / k, gr = (vr.right - ir.right) / k - (view.offsetWidth - view.clientWidth);
    ['width', 'marginLeft', 'marginRight', 'marginBottom', 'maxHeight'].forEach(p => { tb.style[p] = ''; }); [grid, head].forEach(x => { if (x) { x.style.paddingLeft = ''; x.style.paddingRight = ''; } });
    delete tb.dataset.side; delete tb.dataset.fit;
    if (parVert()) {
      const left = PAR.tb.pos === 'left', g = left ? gl : gr, W = 44, inside = g < W + 12;
      const top = Math.max(8, (tb.getBoundingClientRect().top - vr.top) / k); tb.style.maxHeight = Math.max(160, view.clientHeight - top - 8) + 'px';   // from where it starts to the bottom of the note area
      if (inside) { if (!parPoint()) [grid, head].forEach(x => { if (x) x.style[left ? 'paddingLeft' : 'paddingRight'] = (W + 12) + 'px'; }); tb.style[left ? 'marginLeft' : 'marginRight'] = '0px'; }   // QC 110: Point at the top keeps no room
      else tb.style[left ? 'marginLeft' : 'marginRight'] = -(W + 12) + 'px';
      fitOne(tb); tb.style.marginBottom = -tb.offsetHeight + 'px'; tb.dataset.side = inside ? 'inside' : 'gutter';
    } else if (PAR.tb.width === 'full') {
      const pad = 16, w = view.clientWidth - pad * 2; tb.style.width = w + 'px'; tb.style.marginLeft = -(gl - pad) + 'px'; fitOne(tb);
    } else if (PAR.tb.width === 'fit') {   // R54 (QC 66): as wide as its buttons, centred on the text column, growing into the free
      const pad = 16, room = view.clientWidth - pad * 2;   // space beside the text before anything goes into ⋯; never wider than the note area
      tb.querySelectorAll('.is-ovf').forEach(x => x.classList.remove('is-ovf')); tb.style.width = 'max-content';
      const natural = Math.ceil(tb.getBoundingClientRect().width / k), w = Math.min(natural, room);
      tb.style.width = w + 'px'; tb.style.marginLeft = clamp((vi.clientWidth - w) / 2, -(gl - pad), room - (gl - pad) - w) + 'px';
      tb.dataset.fit = natural > room ? 'overflow' : 'fits'; fitOne(tb);
    }
    if (parPoint() && !parVert()) tb.style.marginBottom = -tb.offsetHeight + 'px';   // QC 110: at the top it takes no room; shown, it lies over the text
  });
}
// the note area changes size without a redraw (a side panel dragged, the docked chat's edge, the window): measure again, once a frame
let parTbRaf = 0; const parTbSoon = () => { if (!parTbRaf) parTbRaf = requestAnimationFrame(() => { parTbRaf = 0; parToolbar(); }); };
const parRO = window.ResizeObserver ? new ResizeObserver(parTbSoon) : null;
{ const pa0 = afterRender;
  afterRender = function () { pa0.apply(this, arguments); parHandles(); parBar(); parToolbar(); if (parRO) { parRO.disconnect(); parRO.observe(app); app.querySelectorAll('.view--note').forEach(v => parRO.observe(v)); } };   // eslint-disable-line no-global-assign
}
parRO?.observe(app);

/* ---- Settings → Editor → Toolbar (flat rows, like Split screen) ---- */
function parTbSettings() {
  const seg = k => { const [, label, desc, list] = PAR_TB[k]; return `<div class="set-row"><div><div class="set-label" id="par-${k}">${label}</div><div class="set-desc">${typeof desc === 'function' ? desc() : desc}</div></div><div class="seg" role="group" aria-labelledby="par-${k}">${list.map(([v, l]) =>
    `<button class="seg-opt" data-act="par-tb" data-v="${k}:${v}" aria-pressed="${PAR.tb[k] === v}"${k === 'width' && parVert() ? ' aria-disabled="true" title="Width is for the toolbar at the top"' : ''}>${l}</button>`).join('')}</div></div>`; };
  return `<div class="pop-sec par-tb-set"><div class="eyebrow">Toolbar</div>${seg('pos')}${seg('width')}${seg('hide')}</div>`;
}
{ const ps0 = settingsPane; settingsPane = sec => ps0(sec) + (sec === 'editor' ? parTbSettings() : ''); }   // eslint-disable-line no-global-assign
app.addEventListener('click', e => {
  const b = e.target.closest?.('[data-act="par-tb"]'); if (!b) return; e.stopImmediatePropagation(); if (b.getAttribute('aria-disabled') === 'true') return;
  const [k, v] = b.dataset.v.split(':'); if (!PAR_TB[k]) return; PAR.tb[k] = v; parWidths();
  const patch = { [PAR_TB[k][0]]: v, ...(k === 'width' ? { toolbar_width_picked: true } : {}) };   // R54: a width you pick is kept (see config.py)
  if (!CHECK) saveSettings(patch); else (PAR.saved ||= []).push(patch);
  status(`Toolbar ${PAR_TB[k][1].toLowerCase()}: ${PAR_TB[k][3].find(x => x[0] === v)[1]}`); S.focus = { sel: `[data-act="par-tb"][data-v="${k}:${v}"]` }; renderAll();
}, true);
{ const pr0 = readerFromConfig;
  readerFromConfig = function (c) {   // eslint-disable-line no-global-assign
    pr0(c); if (CHECK) return;   // ?check=1 sets its own
    if ('side_w' in c) PAR.side = Number.isFinite(c.side_w) ? clamp(c.side_w, PAR_MIN, PAR_MAX) : null;
    if ('insp_w' in c) PAR.insp = Number.isFinite(c.insp_w) ? clamp(c.insp_w, PAR_MIN, PAR_MAX) : null;
    Object.entries(PAR_TB).forEach(([k, [key, , , list]]) => { if (list.some(x => x[0] === c[key])) PAR.tb[k] = c[key]; });
    parWidths();
  };
}
parWidths();

/* ==== Build M · QC 110: Autohide → Point at the top. The strip: the top 28px of the note area (Left / Right: that side), and the
   band down to the toolbar's own place (so the note's name, above it, is the top too). Pointing or clicking there shows it; it stays
   while the pointer is on it or its menus, a menu or picker of it is open, or it has the keyboard; it goes 1 s after. ==== */
const PAR_STRIP = 28, PAR_HIDE_MS = 1000;
function parPoint() { return PAR.tb.hide === 'hover'; }
function parTbShow(on) { clearTimeout(PAR.tbT); PAR.tbT = 0; PAR.tbHeld = false; if (on) { if (document.body.dataset.tbshow !== '1') document.body.dataset.tbshow = '1'; } else delete document.body.dataset.tbshow; }
const parTbHold = () => !!(S.edPop || S.edMore || app.querySelector('[data-anchor-ed]') || app.querySelector('.view-inner > .ed-toolbar:focus-within'));
const parHideMs = () => CHECK && PAR.hideMs != null ? PAR.hideMs : PAR_HIDE_MS;
function parTbTick() {   // held (pointer on it, a menu open, the keyboard in it): look again soon; once let go, it goes 1 s later
  PAR.tbT = 0; if (!parPoint()) return;
  if (PAR.tbOver || parTbHold()) { PAR.tbHeld = true; PAR.tbT = setTimeout(parTbTick, 250); return; }
  if (PAR.tbHeld) { PAR.tbHeld = false; PAR.tbT = setTimeout(parTbTick, parHideMs()); return; }
  parTbShow(false);
}
function parTbLater() { if (!PAR.tbT && document.body.dataset.tbshow === '1') PAR.tbT = setTimeout(parTbTick, parHideMs()); }   // 1 s after the pointer left
function parInStrip(v, x, y) {
  const r = v.getBoundingClientRect(), z = parZoom(), s = PAR_STRIP * z, t = v.querySelector('.view-inner > .ed-toolbar')?.getBoundingClientRect();
  if (!t || x < r.left || x > r.right || y < r.top || y > r.bottom) return false;
  if (PAR.tb.pos === 'left') return x <= Math.max(r.left + s, t.right);
  if (PAR.tb.pos === 'right') return x >= Math.min(r.left + v.clientWidth * z - s, t.left);
  return y <= Math.max(r.top + s, Math.min(t.bottom, r.top + 160 * z));   // the top, down to the toolbar's own place (not past 160px)
}
function parTbPointer(e, click) {
  if (!parPoint()) return;
  const onTb = !!e.target.closest?.('.view-inner > .ed-toolbar, [data-anchor-ed]'), v = e.target.closest?.('.view--note');
  PAR.tbOver = onTb || (!!v && parInStrip(v, e.clientX, e.clientY));
  if (PAR.tbOver) parTbShow(true); else if (!click) parTbLater();
}
document.addEventListener('pointermove', e => parTbPointer(e, false), true);
document.addEventListener('pointerdown', e => parTbPointer(e, true), true);
document.documentElement.addEventListener('pointerleave', () => { if (parPoint()) { PAR.tbOver = false; parTbLater(); } });
document.addEventListener('focusin', e => { if (parPoint() && e.target.closest?.('.view-inner > .ed-toolbar')) parTbShow(true); }, true);   // Tab, or its shortcut
document.addEventListener('focusout', e => { if (parPoint() && e.target.closest?.('.view-inner > .ed-toolbar')) setTimeout(() => { if (!app.querySelector('.view-inner > .ed-toolbar:focus-within')) parTbLater(); }, 0); }, true);
{ const pw0 = parWidths; parWidths = function () { pw0.apply(this, arguments); if (!parPoint()) parTbShow(false); }; }   // eslint-disable-line no-global-assign
/* ==== end Build M · QC 110 ==== */
/* ==== Build M · QC 65: window-bar icons never move with the panels. The capture group and the right group keep their places
   (app.css); with the left sidebar narrower than its default, the tabs start just past the capture group, not under it. ==== */
function parBar() {
  const left = app.querySelector('.titlebar.has-side .tb-left'), last = left?.querySelector('.tb-caps > :last-child'); if (!left) return;
  left.style.minWidth = '';
  if (!last || app.classList.contains('is-zen')) return;
  left.style.minWidth = Math.ceil((last.getBoundingClientRect().right - left.getBoundingClientRect().left) / parZoom() + 8) + 'px';
}
/* ==== end Build M · QC 65 ==== */

/* ==== Build M · R54 (the decision r54-place "C, the smallest change", 2026-10-18): Daily wrap-up sits right after Voice
   ramble in the window bar's capture group; Open file stays right after New sticky note and nothing else moves. The right group
   keeps Search and the right sidebar toggle. ==== */
const parWrapBtn = () => `<button class="top-btn" data-act="wrap" aria-label="Wrap up the day" title="Wrap up the day" aria-pressed="${typeof wrapOpen === 'function' && wrapOpen()}">${ic('sunset')}</button>`;
{ const ta1 = topActions;
  topActions = function (part) {   // eslint-disable-line no-global-assign
    const h = ta1.apply(this, arguments); if (part === 'pill' || UI.zen === 'on') return h;
    return h.replace(/<button class="top-btn" data-act="wrap"[^>]*>[\s\S]*?<\/button>\s*/, '');
  };
  const cb1 = captureBtns;
  captureBtns = function () {   // eslint-disable-line no-global-assign
    const h = cb1.apply(this, arguments); if (!h) return h;
    const m = h.match(/<button class="top-btn" data-act="voice"[^>]*>[\s\S]*?<\/button>/); return m ? h.replace(m[0], () => m[0] + parWrapBtn()) : h + parWrapBtn();
  };
}
/* ==== end Build M · R54 ==== */

/* ==== Build M · QC 69 (urgent; the user lost a .docx from Downloads): a file dragged in from Explorer is only ever COPIED. The
   tree's dragover said "move" whenever S.drag was set, and S.drag could go stale: hover-to-open redraws the tree mid-drag, so
   the dragged row's dragend fires on a detached node and never reaches app. The next file from Explorer over a folder row was
   then reported as a move, and Explorer deleted the original after the drop. Now: a drag that carries Files clears any stale
   internal drag (tree row, note tab, pane) the moment it arrives, the tree / tab / pane handlers ignore it (actions.js,
   panes.js), and its dropEffect is never "move" (a last listener turns it back to copy). Internal drag state is also cleared
   after any drop, on a dragend that reaches the document, and on the first mouse move with no button held (a native drag
   sends none, so one means the drag is over). ==== */
const qc69Files = e => [...(e.dataTransfer?.types || [])].includes('Files');
function qc69Clear() {   // forget an internal drag: the tree row, the note tab, a tab dragged to a pane's edge
  const any = !!(S.drag || S.tabDrag || PN.drag?.tab || PN.drag?.note);   // QC 95: a note from the sidebar too
  S.drag = null; S.tabDrag = null; if (PN.drag?.tab || PN.drag?.note) pnStop();
  clearTimeout(S.hoverOpen?.t); S.hoverOpen = null;
  if (any) { clearDrop(); app.querySelectorAll('.is-dragging, .ws-tab.is-drop').forEach(x => x.classList.remove('is-dragging', 'is-drop')); }
  return any;
}
['dragenter', 'dragover', 'drop'].forEach(t => document.addEventListener(t, e => {
  if (!qc69Files(e)) return;
  if (S.drag || S.tabDrag || PN.drag?.tab || PN.drag?.note) qc69Clear();
  if (e.dataTransfer.dropEffect === 'move') e.dataTransfer.dropEffect = 'copy';
}, true));
document.addEventListener('dragover', e => { if (qc69Files(e) && e.dataTransfer.dropEffect === 'move') e.dataTransfer.dropEffect = 'copy'; });   // last word: never a move
document.addEventListener('drop', () => { setTimeout(qc69Clear, 0); });   // after the page's own drop handlers
document.addEventListener('dragend', () => { setTimeout(qc69Clear, 0); }, true);
document.addEventListener('mousemove', e => { if (!e.buttons && (S.drag || S.tabDrag)) qc69Clear(); }, true);
/* ==== end Build M · QC 69 ==== */
