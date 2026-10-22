/* NeuroVault · Build L: one dialog and popover system (mockup R41, locked by the user 2026-10-17; design profile §8).
   - dlg(): every dialog's anatomy. A title and one line under it, × on the title's line (every dialog), one row of
     buttons: Back on the left, then Cancel, the others, and the main button last. Three sizes: sm 440, md 720, wide 920.
     No grey bands; the lines under the head and over the buttons show only when the body scrolls.
   - A click on the dimmed window closes a dialog that holds nothing of yours. One with your work in it (keep: true:
     the wrap-up, a voice note, the timer's question) ignores it. R41's answer: "keep the split".
   - Popovers and menus open 6px under their button, centred on it, 8px inside the window (placeUnder). The Brain Dump and
     Ctrl+K open centred, at the same height.
   - A click away closes every popover and menu (the Brain Dump's own click-away is Fix C's, in capture.js, and keeps the
     draft). A scroll outside a menu, or the window losing focus, closes the menus.
   - Deleting has no confirm. It's done at once, with Undo for 10 seconds (hold).
   - A question is one short question with "Always do this and don't ask" (dlgAlways). */
'use strict';

/* ---- The anatomy ---- */
const DLG_SIZES = { sm: 440, md: 720, wide: 920 };
const dlgMark = (h, role) => h ? h.replace(/<button\b/, `<button data-dlg-btn="${role}"`) : '';
// o: id, size (sm | md | wide), title (HTML), sub (one line, HTML), titleCls, headExtra (in place of sub: the wrap-up's steps),
//    x (the ×'s data-act, default close), xV, xLabel, xTitle, role, descId, cls, keep (holds your work: the dimmed window
//    doesn't close it), top (a picker, near the top), backdropCls, pre (between the head and the body: a picker's box and list),
//    body (HTML; leave it out for none), back, cancel, others [], main (each a <button> string)
function dlg(o) {
  const tid = o.titleId || `dlg-${o.id}-t`;
  const right = [dlgMark(o.cancel, 'cancel'), ...(o.others || []).filter(Boolean).map(h => dlgMark(h, 'alt')), dlgMark(o.main, 'main')].join('');
  const foot = o.back || right ? `<div class="modal-foot">${o.back ? dlgMark(o.back, 'back') + '<span class="modal-foot-gap"></span>' : ''}${right}</div>` : '';
  const x = `<button class="icon-btn icon-btn--sm modal-x" data-act="${o.x || 'close'}"${o.xV ? ` data-v="${o.xV}"` : ''}${o.xId ? ` id="${o.xId}"` : ''} aria-label="${esc(o.xLabel || 'Close')}" title="${esc(o.xTitle || 'Close (Esc)')}">${ic('x')}</button>`;
  return `<div class="modal-backdrop${o.top ? ' modal-backdrop--top' : ''}${o.backdropCls || ''}"${o.keep ? '' : ' data-act="close-bg"'}><div class="modal card${o.cls ? ' ' + o.cls : ''}" data-dlg="${o.id}" data-size="${o.size || 'md'}" role="${o.role || 'dialog'}" aria-modal="true" aria-labelledby="${tid}"${o.descId ? ` aria-describedby="${o.descId}"` : ''}>`
    + `<div class="modal-head"><div class="modal-titles"><h2 class="modal-title${o.titleCls ? ' ' + o.titleCls : ''}" id="${tid}">${o.title}</h2>${o.sub ? `<div class="modal-sub"${o.subData || ''}>${o.sub}</div>` : ''}${o.headExtra || ''}</div>${x}</div>`
    + (o.pre || '') + (o.body != null ? `<div class="modal-body">${o.body}</div>` : '') + foot + `</div></div>`;
}
// The one question's tick box: once ticked and answered, nothing asks again (the setting it names can change that)
const dlgAlways = (attrs, on, where) => `<label class="dlg-always"><input type="checkbox" ${attrs} ${on ? 'checked' : ''}><span>Always do this and don’t ask${where ? ` (change it in ${where})` : ''}</span></label>`;

/* ---- Popovers and menus: 6px under their button (over it when there's no room under), centred on it, 8px inside the window ---- */
function placeUnder(el, btn, above) {
  if (!el || !btn || !btn.offsetWidth) return null;
  Object.assign(el.style, { right: 'auto', bottom: 'auto', transform: 'none', left: '0px', width: '', maxHeight: '', overflowY: '' });   // its own width first, then its place
  const ar = app.getBoundingClientRect(), k = ar.width / app.offsetWidth || 1, br = btn.getBoundingClientRect(), P = el.offsetParent || app, pr = P.getBoundingClientRect();
  const clips = P !== app && getComputedStyle(P).overflow === 'hidden';   // a small card that clips (a sticky): it fits inside that, 4px in
  const w = Math.min(el.offsetWidth, clips ? P.offsetWidth - 8 : Infinity), cx = (br.left + br.width / 2 - ar.left) / k; el.style.width = w + 'px';
  const h = el.offsetHeight;
  let lo = 8, hi = app.offsetWidth - w - 8;   // inside the window
  if (clips) { const pl = (pr.left - ar.left) / k; lo = Math.max(lo, pl + 4); hi = Math.min(hi, pl + P.offsetWidth - w - 4); }
  const left = clamp(cx - w / 2, lo, Math.max(lo, hi));
  const bTop = (br.top - ar.top) / k, bBot = (br.bottom - ar.top) / k, roomBelow = app.offsetHeight - 8 - (bBot + 6), roomAbove = bTop - 6 - 8;
  let top = above ? bTop - 6 - h : bBot + 6;
  if (!above && h > roomBelow) { if (h <= roomAbove) top = bTop - 6 - h; else { el.style.maxHeight = Math.max(120, roomBelow) + 'px'; el.style.overflowY = 'auto'; } }   // over it when there's room; else under it, scrolling inside
  if (above && h > roomAbove) top = 8;
  const px = (pr.left - ar.left) / k + P.clientLeft - P.scrollLeft, py = (pr.top - ar.top) / k + P.clientTop - P.scrollTop;
  Object.assign(el.style, { left: (left - px).toFixed(1) + 'px', top: (top - py).toFixed(1) + 'px' });
  el.dataset.anchored = ''; return el;
}
// Every popover and menu the click-away rule covers. menu: true also closes on a scroll outside it and when the window loses focus.
// (The note's right-click menu is Fix A's, dictionary.js; the editor's pickers are editor.js's; the Brain Dump is Fix C's.)
const POPOVERS = [
  { id: 'more', on: () => S.menu, off: () => { S.menu = false; }, el: '.header-actions > .menu', btn: '[data-act="menu"]', menu: true },
  { id: 'sort', on: () => S.sortMenu, off: () => { S.sortMenu = false; }, el: '.side-actions .menu', btn: '[data-act="tree-sort"]', menu: true },
  { id: 'tabs', on: () => S.tabList, off: () => { S.tabList = false; }, el: '.menu--tabs', btn: '[data-act="tab-list"]', menu: true },
  { id: 'sticky', on: () => S.stickyMenu, off: () => { S.stickyMenu = null; }, el: '.sticky .menu', btn: '.sticky [data-act="sticky-menu"][aria-expanded="true"]', menu: true },
  { id: 'task', on: () => S.taskMenu, off: () => { S.taskMenu = null; }, el: '.tp-menu', btn: '[data-act="task-menu"][aria-expanded="true"]', menu: true, own: true },   // Build I places it in its scrolling list
  { id: 'downloads', on: () => S.dlPop, off: () => { S.dlPop = false; }, el: '.dl-pop', btn: '.status-bar [data-act="setup-dl"]', above: true },   // ongoing work: the list above its status-bar link
];
const popOpen = () => POPOVERS.filter(p => p.on());
// Closes them without a redraw, so the click goes where it was aimed (the caret into a note, a row, a button)
function popDrop(p) {
  const btn = app.querySelector(p.btn); p.off(); app.querySelectorAll(p.el).forEach(m => m.remove());
  if (btn?.hasAttribute('aria-expanded')) btn.setAttribute('aria-expanded', 'false');
}
document.addEventListener('click', e => {   // capture phase: before the app's own handlers
  const t = e.target; if (!t?.closest || t.hidden || !t.isConnected) return;   // hidden: fire()'s stand-in button
  popOpen().forEach(p => { if (!t.closest(p.el) && !t.closest(p.btn)) popDrop(p); });
}, true);
app.addEventListener('wheel', e => { popOpen().forEach(p => { if (p.menu && !e.target.closest?.(p.el)) popDrop(p); }); }, { passive: true });
window.addEventListener('blur', () => popOpen().forEach(p => { if (p.menu) popDrop(p); }));
document.addEventListener('keydown', e => { if (e.key === 'Escape' && S.dlPop) { e.stopImmediatePropagation(); S.dlPop = false; S.focus = { sel: '[data-act="setup-dl"]' }; renderAll(); } }, true);

/* ---- Deleting: no confirm. It's done at once, with Undo for 10 seconds ----
   Held, not restored: what you delete leaves the page at once, but the backend call waits the 10 seconds (or until the next
   delete, or the window closing). Undo just drops the call, so nothing has to be rebuilt; a file never has to come back out of
   the Windows recycle bin; and if NeuroVault stops in those 10 seconds, the thing is still there. One delete is held at a time. */
const HOLD = { cur: null, ms: 10000 };
// h: msg, apply() (off the page now), undo() (back on the page), commit() → a Promise of the backend's answer (or null)
function hold(h) {
  if (HOLD.cur) holdCommit();   // the one before goes through now
  h.apply(); HOLD.cur = h; S.toast = null; clearTimeout(toast.t);
  h.t = setTimeout(holdCommit, HOLD.ms); renderAll();
}
async function holdCommit() {
  const h = HOLD.cur; if (!h) return null; HOLD.cur = null; clearTimeout(h.t);
  if (!h.quiet) renderAll();
  let r = null; try { r = await h.commit(); } catch (e) { r = { status: 'error', message: plainErr(e) }; }
  if (r && failed(r)) { h.undo(); toast(`${String(r.message || "That didn't work.").replace(/\.?$/, '.')} It's back where it was.`); renderAll(); }
  return r;
}
function holdUndo() {
  const h = HOLD.cur; if (!h) return; HOLD.cur = null; clearTimeout(h.t);
  h.undo(); status(h.back || 'Put back'); renderAll();
}
const holdBar = () => HOLD.cur ? `<div class="toast card toast--undo" role="status">${ic('ok')}<span class="truncate" title="${esc(HOLD.cur.msg)}">${esc(HOLD.cur.msg)}</span><button class="btn btn--secondary btn--sm" data-act="hold-undo" title="Put it back (10 seconds)">Undo</button></div>` : '';
document.addEventListener('click', e => { if (e.target.closest?.('[data-act="hold-undo"]')) { e.stopPropagation(); holdUndo(); } }, true);
window.addEventListener('pagehide', () => { if (HOLD.cur) { HOLD.cur.quiet = true; holdCommit(); } });   // best effort, as the saves

/* ---- After a draw: lines only when a dialog scrolls, a cut line's full text on hover, the popovers under their buttons ---- */
function dlgPaint() {
  app.querySelectorAll('.modal').forEach(m => {
    const body = m.querySelector('.modal-body, .settings-pane, .picker-list');
    if (body && body.scrollHeight > body.clientHeight + 1) m.dataset.scrolls = ''; else delete m.dataset.scrolls;   // an attribute, not a class: keepScroll matches boxes by their classes
    m.querySelectorAll('.modal-sub').forEach(s => { if (s.scrollWidth > s.clientWidth + 1) s.title = s.textContent.trim(); else s.removeAttribute('title'); });
  });
  popOpen().forEach(p => {
    if (p.own) { centreOn(app.querySelector(p.el), app.querySelector(p.btn)); return; }
    placeUnder(app.querySelector(p.el), [...app.querySelectorAll(p.btn)].find(b => b.offsetWidth), p.above);
  });
}
// Build I's task menu keeps its own up / down (it lives in the scrolling list); this centres it on its ⋮
function centreOn(el, btn) {
  if (!el || !btn) return; const P = el.offsetParent; if (!P) return;
  const k = app.getBoundingClientRect().width / app.offsetWidth || 1, br = btn.getBoundingClientRect(), pr = P.getBoundingClientRect(), ar = app.getBoundingClientRect();
  const w = el.offsetWidth, cx = (br.left + br.width / 2 - pr.left) / k, minL = (ar.left - pr.left) / k + 8, maxL = (ar.right - pr.left) / k - w - 8;
  Object.assign(el.style, { right: 'auto', left: clamp(cx - w / 2, minL, Math.max(minL, maxL)).toFixed(1) + 'px' }); el.dataset.anchored = '';
}
const _afterRenderL = afterRender;
afterRender = function () { _afterRenderL(); dlgPaint(); };   // eslint-disable-line no-global-assign
if (window.ResizeObserver) new ResizeObserver(() => { if (popOpen().length || app.querySelector('.modal')) dlgPaint(); }).observe(app);

/* ---- Closing a question answers it with its usual answer: Esc on the timer's question counts the time as a pause ---- */
const _closeModalL = closeModal;
closeModal = function (quiet) {   // eslint-disable-line no-global-assign
  if (S.modal === 'timer-away') { fire('taway', 'pause'); return; }
  return _closeModalL(quiet);
};
/* ===================================================================== end Build L · dialogs */
