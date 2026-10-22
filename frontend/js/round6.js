/* Build M · round 6: the Brain Dump as a free window (mockup R49, r49dump "float", locked 2026-10-18).
   Feedback: "I want it to be resizeable and movable modal thats all."
   - Drag it by its head; resize it from any edge or corner (eight zones; the corner shows a grip). On the head, the arrow keys
     move it 16px and Shift + arrows size it.
   - It remembers its size and place (config brain_dump_rect, in the window's own pixels) and is always kept on screen: never over
     the window bar, 360 × 220 at least, at most 760 × 640 (or the window, less 8px).
   - The first time, it opens centred over the note (r49-start).
   - A click elsewhere closes it and keeps the draft (r49-away; Fix C's click-away, R41's popover rule); so do Esc and ×. The draft
     is whatever was typed (S.dumpDraft), never "undefined".
   - Settings → Vault & files → "Brain Dump opens as": Free window (default) | Centred dialog (config brain_dump_mode), and
     "Put it back in the middle", which forgets the place. */
'use strict';
const BD = { mode: 'float', rect: null };
const BD_MIN = { w: 360, h: 220 }, BD_MAX = { w: 760, h: 640 }, BD_FIRST = { w: 480, h: 360 }, BD_STEP = 16;
const bdZoom = () => app.getBoundingClientRect().width / app.offsetWidth || 1;
const bdTop = () => (app.querySelector('.titlebar')?.offsetHeight || 36);
// Kept inside the window, under the window bar, between the smallest and largest size
function bdClamp(r) {
  const W = app.offsetWidth, H = app.offsetHeight, top = bdTop();
  const w = clamp(Math.round(r.w), BD_MIN.w, Math.max(BD_MIN.w, Math.min(BD_MAX.w, W - 8))), h = clamp(Math.round(r.h), BD_MIN.h, Math.max(BD_MIN.h, Math.min(BD_MAX.h, H - top - 8)));
  return { x: clamp(Math.round(r.x), 4, Math.max(4, W - w - 4)), y: clamp(Math.round(r.y), top + 4, Math.max(top + 4, H - h - 4)), w, h };
}
// The first time: centred over the note (the main area), else the window
function bdFirst() {
  const m = app.querySelector('.app-body > .main'), z = bdZoom(), ar = app.getBoundingClientRect(), r = m?.getBoundingClientRect();
  const a = r ? { x: (r.left - ar.left) / z, y: (r.top - ar.top) / z, w: r.width / z, h: r.height / z } : { x: 0, y: bdTop(), w: app.offsetWidth, h: app.offsetHeight - bdTop() };
  return bdClamp({ x: a.x + (a.w - BD_FIRST.w) / 2, y: a.y + (a.h - BD_FIRST.h) / 2, ...BD_FIRST });
}
// the centred dialog sits where Ctrl+K does (Build L: one place for both), as wide
const bdCentre = () => { const w = Math.min(720, app.offsetWidth - 32); return bdClamp({ x: (app.offsetWidth - w) / 2, y: bdTop() + Math.round(app.offsetHeight * .09), w, h: 380 }); };
const bdRect = () => BD.mode === 'centre' ? bdCentre() : bdClamp(BD.rect || bdFirst());
function bdHtml() {
  const today = inboxToday(), r = bdRect(), free = BD.mode !== 'centre';
  const items = today.slice().reverse().map(x => (typeof dumpItemA === 'function' && dumpItemA(x)) || `<div class="dump-item"><span class="num">${esc(x.t)}</span><span>${esc(x.text)}</span></div>`).join('') || '<div class="list-item-sub">Nothing captured yet today.</div>';
  const zones = free ? ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'].map(z => `<div class="bd-rz bd-rz--${z}" data-bd-rz="${z}" aria-hidden="true"></div>`).join('') : '';
  return `<div class="card dump bd-win bd-win--${free ? 'float' : 'centre'}" role="dialog" aria-label="Brain Dump" style="left:${r.x}px;top:${r.y}px;width:${r.w}px;height:${r.h}px">
    <div class="bd-head"${free ? ' data-bd-drag tabindex="0" aria-label="Brain Dump: drag to move, arrow keys move it, Shift + arrow keys size it" title="Drag to move · arrow keys move it, Shift + arrows size it"' : ''}>${ic('inbox')}<span class="bd-title">Brain Dump</span><span class="bd-count num">${today.length} today</span><button class="icon-btn icon-btn--sm" data-act="close" aria-label="Close the Brain Dump" title="Close (Esc): what you typed is kept">${ic('x')}</button></div>
    <div class="bd-in"><input class="dump-input" id="dump-input" data-act="dump-input" placeholder="Dump a thought. Enter saves it to the Brain Dump" value="${esc(S.dumpDraft || '')}" aria-label="Thought to capture" autocomplete="off">${typeof dumpMicA === 'function' ? dumpMicA() : ''}</div>
    <div class="dump-list" aria-label="In the Brain Dump today">${items}</div>${zones}</div>`;
}
{ const bdModal0 = renderModal;
  renderModal = function () {   // eslint-disable-line no-global-assign
    const h = bdModal0.apply(this, arguments); if (S.modal !== 'dump') return h;
    const bar = dumpBar(), i = h.indexOf(bar); return i < 0 ? h + bdHtml() : h.slice(0, i) + bdHtml() + h.slice(i + bar.length);   // the bar becomes the window; what other files add (Check spelling's card) stays
  };
}
function bdSave(r, said) {
  BD.rect = bdClamp(r); if (!CHECK) saveSettings({ brain_dump_rect: BD.rect }); else (BD.saved ||= []).push(BD.rect);
  status(said || 'Brain Dump moved · it opens here next time');
}
function bdApply(el, r) { Object.assign(el.style, { left: r.x + 'px', top: r.y + 'px', width: r.w + 'px', height: r.h + 'px' }); }

/* ---- Drag by the head, resize from an edge or corner: the window moves in place (no redraw), and its place is saved at the end ---- */
app.addEventListener('pointerdown', e => {
  if (e.button !== 0 || BD.mode === 'centre') return;
  const head = e.target.closest?.('[data-bd-drag]'), zone = e.target.closest?.('[data-bd-rz]');
  if (!(zone || (head && !e.target.closest('button, input')))) return;
  const el = e.target.closest('.bd-win'); if (!el) return;
  e.preventDefault(); e.stopPropagation();
  const z = bdZoom(), r0 = { x: el.offsetLeft, y: el.offsetTop, w: el.offsetWidth, h: el.offsetHeight }, sx = e.clientX, sy = e.clientY, k = zone?.dataset.bdRz || 'move';
  el.classList.add('is-moving'); head?.classList.add('is-grabbing'); let r = r0;
  const move = ev => {
    const dx = (ev.clientX - sx) / z, dy = (ev.clientY - sy) / z; let { x, y, w, h } = r0;
    if (k === 'move') { x += dx; y += dy; }
    else { if (k.includes('e')) w += dx; if (k.includes('s')) h += dy; if (k.includes('w')) { w -= dx; x += dx; } if (k.includes('n')) { h -= dy; y += dy; }
      if (w < BD_MIN.w) { if (k.includes('w')) x -= BD_MIN.w - w; w = BD_MIN.w; } if (h < BD_MIN.h) { if (k.includes('n')) y -= BD_MIN.h - h; h = BD_MIN.h; } }
    r = bdClamp({ x, y, w, h }); bdApply(el, r);
  };
  const up = () => { document.removeEventListener('pointermove', move, true); document.removeEventListener('pointerup', up, true); document.removeEventListener('pointercancel', up, true);
    el.classList.remove('is-moving'); app.querySelector('[data-bd-drag]')?.classList.remove('is-grabbing');
    BD.swallow = true; setTimeout(() => { BD.swallow = false; }, 0);   // the click that ends a drag lands wherever the pointer is: it isn't a click away
    if (r.x !== r0.x || r.y !== r0.y || r.w !== r0.w || r.h !== r0.h) bdSave(r, k === 'move' ? 'Brain Dump moved · it opens here next time' : `Brain Dump is ${r.w} × ${r.h} · it opens this size next time`); };
  document.addEventListener('pointermove', move, true); document.addEventListener('pointerup', up, true); document.addEventListener('pointercancel', up, true);
}, true);
window.addEventListener('click', e => { if (BD.swallow) { BD.swallow = false; e.stopImmediatePropagation(); e.preventDefault(); } }, true);   // before Fix C's click-away (document)
app.addEventListener('keydown', e => {
  const head = e.target.closest?.('[data-bd-drag]'); if (!head || !/^Arrow/.test(e.key) || e.ctrlKey || e.altKey) return;
  e.preventDefault(); e.stopPropagation(); const el = head.closest('.bd-win'), r = { x: el.offsetLeft, y: el.offsetTop, w: el.offsetWidth, h: el.offsetHeight };
  const d = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
  const n = bdClamp(e.shiftKey ? { ...r, w: r.w + d[0] * BD_STEP, h: r.h + d[1] * BD_STEP } : { ...r, x: r.x + d[0] * BD_STEP, y: r.y + d[1] * BD_STEP });
  bdApply(el, n); bdSave(n, e.shiftKey ? `Brain Dump is ${n.w} × ${n.h}` : 'Brain Dump moved');
}, true);
// A smaller window brings it back on screen
if (window.ResizeObserver) new ResizeObserver(() => { const el = app.querySelector('.bd-win'); if (el) bdApply(el, bdRect()); }).observe(app);

/* ---- Settings → Vault & files: how it opens ---- */
VAULT_PAGE.push(() => `<div class="set-row bd-set"><div><div class="set-label" id="bd-mode">Brain Dump opens as</div><div class="set-desc">A free window you can drag and resize (it remembers where), or a dialog centred at the top</div></div>
  <div class="seg" role="group" aria-labelledby="bd-mode">${[['float', 'Free window'], ['centre', 'Centred dialog']].map(([v, l]) => `<button class="seg-opt" data-act="bd-mode" data-v="${v}" aria-pressed="${BD.mode === v}">${l}</button>`).join('')}</div></div>
  <div class="set-row bd-set"><div><div class="set-label">Its place</div><div class="set-desc">${BD.rect ? `${BD.rect.w} × ${BD.rect.h}, where you left it` : 'Centred over the note'}</div></div><button class="btn btn--secondary" data-act="bd-reset" ${BD.rect ? '' : 'disabled title="It isn’t moved yet"'}>Put it back in the middle</button></div>`);
app.addEventListener('click', e => {
  const t = e.target.closest?.('[data-act="bd-mode"], [data-act="bd-reset"]'); if (!t || t.disabled) return;
  e.stopImmediatePropagation();
  if (t.dataset.act === 'bd-mode') { BD.mode = t.dataset.v; saveSettings({ brain_dump_mode: BD.mode }); status(`The Brain Dump opens as a ${BD.mode === 'centre' ? 'centred dialog' : 'free window'}`); S.focus = { sel: `[data-act="bd-mode"][data-v="${BD.mode}"]` }; }
  else { BD.rect = null; saveSettings({ brain_dump_rect: null }); status('The Brain Dump opens centred over the note again'); S.focus = { sel: '[data-act="bd-mode"][aria-pressed="true"]' }; }
  renderAll();
}, true);
{ const bdReader0 = readerFromConfig;
  readerFromConfig = function (c) {   // eslint-disable-line no-global-assign
    bdReader0(c);
    if (CHECK) return;   // ?check=1 sets its own (a late settings read must not move the window under the check)
    if (['float', 'centre'].includes(c.brain_dump_mode)) BD.mode = c.brain_dump_mode;
    if ('brain_dump_rect' in c) { const r = c.brain_dump_rect; BD.rect = r && ['x', 'y', 'w', 'h'].every(k => Number.isFinite(r[k])) ? { x: r.x, y: r.y, w: r.w, h: r.h } : null; }
  };
}

/* ==== Build M · QC 61: a double-click below (or beside) a note's text selected the status bar's "TIMELINE": Build N's QC 51
   handler takes single clicks only, so the second press fell to the browser, which selects the nearest text it finds. A
   double-click there now does what a single click does (the caret at the end of the note, or at that line's start or end) and
   never selects anything outside the editor. The app's chrome is never selectable at all (app.css). ==== */
app.addEventListener('mousedown', e => {
  if (e.button !== 0 || e.shiftKey || e.detail < 2) return;
  const view = e.target.closest?.('.view--note'); if (!view || e.target.closest(EDN_SKIP)) return;
  const inDoc = e.target.closest('.doc'); if (inDoc && e.target !== inDoc) return;   // on the text: the browser selects the word, as it should
  const doc = inDoc || view.querySelector('.doc[contenteditable="true"]'); if (!doc?.isContentEditable) return;
  const kids = [...doc.children].filter(k => k.getClientRects().length && !k.matches('[data-md-ignore]')), dr = doc.getBoundingClientRect();
  e.preventDefault(); doc.focus({ preventScroll: true });   // nothing outside the editor is selected, whatever happens next
  if (!kids.length || e.clientY > kids[kids.length - 1].getBoundingClientRect().bottom) { ednEnd(doc); edShow(); return; }   // below the last line
  if (e.clientY < kids[0].getBoundingClientRect().top) { ednEnd(doc); return; }   // the empty page above the text (under the toolbar)
  const leftSide = e.clientX < dr.left; if (!ednLine(doc, leftSide ? dr.left + 1 : dr.right - 1, e.clientY)) ednEnd(doc);   // beside a line
}, true);
/* ==== end Build M · QC 61 ==== */
