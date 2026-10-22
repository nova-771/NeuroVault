/* Build M · QC 105 (feedback: "for code I can freely move and attachement, or code snippet up or down the note - this is annoying"):
   moving a block up or down the note. Attachment cards, code blocks, tables, images and callouts show a drag handle (⋮⋮) at their
   left edge while the pointer is over them: drag it to a gap between blocks, or click it to pick the block. Alt+Shift+↑ / ↓ moves
   the picked block, or the one the caret is in, past the block above or below.
   A move is the note's own blocks changing places in the editor: one Ctrl+Z step (edRecord, then edChanged), and the .md is written
   from the editor as always, so it round-trips. A block is all of its parts: an attachment's card and its ![[…]] line; a photo's
   picture, its caption line, its pins comment and the pins' list. The front matter stays first. codeblocks.js, tables.js and
   photos.js are not changed: their decorations live inside the block (or beside the note) and move with it. */
'use strict';
const BLK = { hover: null, pick: null, drag: null, pend: null, leave: 0, noClick: false };   // pend: a press on a block's body, not yet moved 5px (QC 115)   // pick: { id: the note, i: the block's place }, so it outlives a redraw
const BLK_KINDS = { attachment: 'attachment', image: 'image', code: 'code block', table: 'table', callout: 'callout' };
const BLK_IMG = /\.(png|jpe?g|gif|webp|bmp|svg)$/i;

/* ---- The note's blocks: its top-level nodes, grouped ---- */
const blkPins = n => n?.nodeType === 8 && /^\s*nv-pins[\s\d.,-]*$/.test(n.data);
const blkEmpty = el => el.nodeName === 'P' && !el.textContent.trim() && !el.querySelector('img, [contenteditable="false"]');
function blkKind(el) {
  if (el.matches('[data-embed-for]')) return el.matches('.att-img') || BLK_IMG.test(el.dataset.embedFor) ? 'image' : 'attachment';   // a photo whose file is missing is still a photo, with its pins
  if (el.matches('p.att-src, p.ph-cap-p') || edEmbedLine(el)) return BLK_IMG.test(el.querySelector('.wikilink')?.dataset.wiki || '') ? 'image' : 'attachment';
  if (el.nodeName === 'PRE') return 'code';
  if (el.nodeName === 'TABLE') return 'table';
  if (el.nodeName === 'BLOCKQUOTE' && el.matches('.callout, [data-callout]')) return 'callout';
  if (el.nodeName === 'P' && el.querySelector('img') && ![...el.childNodes].some(c => (c.nodeType === 3 && c.data.trim()) || (c.nodeType === 1 && !c.matches('img, br, .vid-embed, a')) || (c.nodeName === 'A' && c.textContent.trim()))) return 'image';
  return '';
}
function blkUnits(doc) {
  const us = []; let cur = null;
  for (const n of doc.childNodes) {
    if (n.nodeType === 8) { if (blkPins(n) && cur?.kind === 'image') { cur.nodes.push(n); cur.pins = true; } continue; }   // a photo's pins; other comments stay put
    if (n.nodeType !== 1) continue;
    if (n.matches('[data-md="frontmatter"]')) { us.length = 0; cur = null; continue; }   // nothing goes above the front matter
    if ((n.matches('[data-md-ignore]') && !n.matches('[data-embed-for]')) || blkEmpty(n)) continue;   // the editor's own bits and empty lines stay where they are
    const last = cur?.nodes[cur.nodes.length - 1];
    if (last?.nodeType === 1 && last.matches('[data-embed-for]') && (edIsEmbed(n) || n.matches('p.ph-cap-p'))) { cur.nodes.push(n); continue; }   // the card, then its line
    if (cur?.pins && blkPins(last) && n.nodeName === 'OL') { cur.nodes.push(n); continue; }   // the pins' notes
    cur = { nodes: [n], kind: blkKind(n) }; us.push(cur);
  }
  return us;
}
function blkIndexOf(doc, us, node) { let top = node; while (top && top.parentNode !== doc) top = top.parentNode; return top ? us.findIndex(u => u.nodes.includes(top)) : -1; }
function blkRect(u) {
  let t = Infinity, b = -Infinity, l = Infinity, r = -Infinity;
  u.nodes.forEach(n => { if (n.nodeType !== 1) return; const x = n.getBoundingClientRect(); if (!x.width && !x.height) return; t = Math.min(t, x.top); b = Math.max(b, x.bottom); l = Math.min(l, x.left); r = Math.max(r, x.right); });
  return t === Infinity ? null : { top: t, bottom: b, left: l, right: r };
}
const blkDocs = () => [...app.querySelectorAll('.ed-pane > .doc[contenteditable="true"]')].filter(d => !d.classList.contains('is-reading'));
const blkDoc = id => blkDocs().find(d => d.dataset.note === id) || null;

/* ---- Moving: block i to the gap before block `to` (us.length: after the last one) ---- */
function blkMove(doc, us, i, to) {
  const u = us[i]; if (!u || to < 0 || to > us.length || to === i || to === i + 1) return false;
  const r = edRange(doc), keep = r && r.startContainer !== doc && r.endContainer !== doc ? [r.startContainer, r.startOffset, r.endContainer, r.endOffset] : null;
  edRecord(doc, 'cmd');
  if (to < us.length) us[to].nodes[0].before(...u.nodes); else us[us.length - 1].nodes[us[us.length - 1].nodes.length - 1].after(...u.nodes);
  if (keep) try { edPut([keep[0], keep[1]], [keep[2], keep[3]]); } catch (e) { /* the caret was in a part that's redrawn */ }
  edChanged(doc);
  if (typeof tbPaintSoon === 'function') tbPaintSoon();   // a table's grips follow it
  return true;
}
function blkStep(doc, i, d) {   // the keys: one block up or down
  const us = blkUnits(doc), u = us[i]; if (!u) return;
  const to = d < 0 ? i - 1 : i + 2, name = BLK_KINDS[u.kind] || 'block';
  if (to < 0 || to > us.length) { status(d < 0 ? `The ${name} is already at the top` : `The ${name} is already at the bottom`); return; }
  blkMove(doc, us, i, to); const ni = d < 0 ? i - 1 : i + 1;
  if (BLK.pick) BLK.pick = { id: doc.dataset.note, i: ni };
  u.nodes.find(n => n.nodeType === 1 && n.getBoundingClientRect().height)?.scrollIntoView({ block: 'nearest' });
  status(`Moved the ${name} ${d < 0 ? 'up' : 'down'} · Ctrl+Z puts it back`); blkPaint();
}
// The block the keys move: the picked one, else the one the caret is in (only the five kinds; elsewhere the keys do what they did)
function blkTarget() {
  if (BLK.pick) { const doc = blkDoc(BLK.pick.id); if (doc && blkUnits(doc)[BLK.pick.i]) return { doc, i: BLK.pick.i }; BLK.pick = null; }
  const doc = document.activeElement?.closest?.('.doc[contenteditable="true"]'); if (!doc || doc.classList.contains('is-reading')) return null;
  const r = edRange(doc); if (!r) return null;
  let node = r.startContainer; if (node === doc) node = doc.childNodes[r.startOffset] || doc.childNodes[r.startOffset - 1];
  const us = blkUnits(doc), i = blkIndexOf(doc, us, node);
  return i >= 0 && BLK_KINDS[us[i].kind] ? { doc, i } : null;
}

/* ---- Drawing: the handle, the picked block's outline, the drop line; in a layer beside the note (never saved) ---- */
function blkLayer(doc) { const pane = doc.parentElement; let L = pane.querySelector(':scope > .blk-layer'); if (!L) { L = document.createElement('div'); L.className = 'blk-layer'; L.setAttribute('contenteditable', 'false'); L.setAttribute('data-md-ignore', ''); pane.append(L); } return L; }
function blkPaint() {
  const z = app.getBoundingClientRect().width / app.offsetWidth || 1;
  app.querySelectorAll('.blk-layer').forEach(L => { if (!L.parentElement.querySelector(':scope > .doc[contenteditable="true"]')) L.remove(); });
  blkDocs().forEach(doc => {
    const id = doc.dataset.note, hv = BLK.hover?.id === id ? BLK.hover.i : -1, pk = BLK.pick?.id === id ? BLK.pick.i : -1, dr = BLK.drag?.id === id ? BLK.drag : null;
    let L = doc.parentElement.querySelector(':scope > .blk-layer');
    if (hv < 0 && pk < 0 && !dr) { if (L && L.innerHTML) L.innerHTML = ''; return; }
    L = blkLayer(doc); const lr = L.getBoundingClientRect(), X = v => ((v - lr.left) / z).toFixed(1), Y = v => ((v - lr.top) / z).toFixed(1), us = blkUnits(doc);
    let h = '';
    const handle = i => { const u = us[i], b = u && BLK_KINDS[u.kind] && blkRect(u); if (!b) return '';
      return `<button class="blk-handle${dr ? ' is-drag' : ''}" data-blk-handle data-i="${i}" tabindex="-1" aria-pressed="${pk === i}" aria-label="Move this ${BLK_KINDS[u.kind]}: drag it, or Alt+Shift+↑ or ↓" data-tip="Drag to move · click, then Alt+Shift+↑ / ↓"`
        + ` style="left:${X(b.left - 24 * z)}px;top:${Y(u.kind === 'table' ? b.top - 22 * z : b.top + 2 * z)}px">${ic('tbgrip')}</button>`; };   // a table's row grips are beside its rows: its handle takes the corner above them
    if (pk >= 0) { const b = us[pk] && blkRect(us[pk]); if (b) h += `<span class="blk-pick" style="left:${X(b.left - 4 * z)}px;top:${Y(b.top - 4 * z)}px;width:${((b.right - b.left) / z + 8).toFixed(1)}px;height:${((b.bottom - b.top) / z + 8).toFixed(1)}px"></span>`; }
    const shown = dr ? dr.i : hv >= 0 ? hv : pk; if (shown >= 0) h += handle(shown);
    if (pk >= 0 && pk !== shown) h += handle(pk);
    if (dr && dr.to != null && dr.to !== dr.i && dr.to !== dr.i + 1) { const dl = doc.getBoundingClientRect(); h += `<span class="blk-drop" style="left:${X(dl.left)}px;top:${Y(dr.y - z)}px;width:${(dl.width / z).toFixed(1)}px"></span>`; }
    if (L.innerHTML !== h) L.innerHTML = h;
  });
}
{ const blkAfter0 = afterRender;
  afterRender = function () { blkAfter0.apply(this, arguments); if (BLK.hover && !blkDoc(BLK.hover.id)) BLK.hover = null; if (BLK.pick && !blkDoc(BLK.pick.id)) BLK.pick = null; if (BLK.hover || BLK.pick) blkPaint(); };   // eslint-disable-line no-global-assign
}

/* ---- The pointer: the handle over the block it's beside; dragging it shows where the block goes ---- */
function blkGaps(us) {   // the y of each gap between blocks, top to bottom (us.length + 1 of them)
  const rs = us.map(blkRect); return us.map((u, k) => k === 0 ? rs[0]?.top : ((rs[k - 1]?.bottom ?? 0) + (rs[k]?.top ?? 0)) / 2).concat(rs[rs.length - 1]?.bottom);
}
function blkScroller(el) { for (let p = el.parentElement; p; p = p.parentElement) { const o = getComputedStyle(p).overflowY; if ((o === 'auto' || o === 'scroll') && p.scrollHeight > p.clientHeight) return p; } return null; }
function blkDragAt(y) {
  const d = BLK.drag, doc = blkDoc(d.id); if (!doc) return;
  const gaps = blkGaps(blkUnits(doc)); let best = 0; gaps.forEach((g, k) => { if (g != null && Math.abs(g - y) < Math.abs((gaps[best] ?? Infinity) - y)) best = k; });
  d.to = best; d.y = gaps[best]; blkPaint();
}
/* QC 115 (feedback: "icon dissapears when I try to get to it so I cannot drag anything, ideally we should just drag from anywhere on the ui elements"):
   the handle never vanishes on the way to it: a block's hover zone is the block plus its handle plus the gap between them (and a grace
   of 350 ms once the pointer leaves it), whatever element the pointer is over. And a block is picked up by dragging any part of it, after
   the pointer moves 5 px: attachment cards and photos anywhere on them, a code block or callout by its frame (its text still selects),
   a table by its grips. A click without that move does what it always did (Open, the caret). */
const BLK_MOVE = 5;
function blkZone(u, z) {   // the block, its handle and the gap between them, as one box
  const b = blkRect(u); if (!b) return null; const g = 10 * z, hx = b.left - 24 * z, hy = u.kind === 'table' ? b.top - 22 * z : b.top + 2 * z;
  return { b, top: Math.min(b.top - 4, hy - g), left: Math.min(b.left, hx - g), right: b.right, bottom: b.bottom + 4 };
}
function blkHoverAt(x, y) {
  const z = app.getBoundingClientRect().width / app.offsetWidth || 1, cur = BLK.hover; let near = null;
  for (const doc of blkDocs()) { const us = blkUnits(doc);
    for (let i = 0; i < us.length; i++) { if (!BLK_KINDS[us[i].kind]) continue; const q = blkZone(us[i], z); if (!q) continue;
      if (x >= q.b.left && x <= q.b.right && y >= q.b.top - 4 && y <= q.b.bottom + 4) return { id: doc.dataset.note, i };   // over the block itself
      if (x >= q.left && x <= q.right && y >= q.top && y <= q.bottom && (!near || (cur?.id === doc.dataset.note && cur.i === i))) near = { id: doc.dataset.note, i }; } }   // on its way to the handle
  return near;
}
function blkBodyAt(e) {   // the block a press on its body picks up, or null (text, controls and the handle keep their own press)
  if (e.button !== 0 || e.pointerType === 'touch' || e.shiftKey || e.ctrlKey || e.altKey || e.metaKey) return null;
  const t = e.target; if (!(t instanceof Element) || t.closest('[data-blk-handle], input, textarea, select, .tb-layer, .blk-layer')) return null;
  const doc = t.closest('.ed-pane > .doc[contenteditable="true"]'); if (!doc || doc.classList.contains('is-reading')) return null;
  const us = blkUnits(doc), i = blkIndexOf(doc, us, t), u = us[i]; if (!u) return null;
  const ok = u.kind === 'attachment' || u.kind === 'image' ? !!t.closest('[data-embed-for], img') || (t.nodeName === 'P' && !!t.querySelector('img'))
    : u.kind === 'code' ? t.nodeName === 'PRE' || (!!t.closest('[data-md-ignore]') && !t.closest('code > [data-md-ignore]'))
    : u.kind === 'callout' ? t === u.nodes[0] : false;   // a table is picked up by its grips; text inside any of them selects as usual
  return ok ? { id: doc.dataset.note, i } : null;
}
function blkBodyStart(p, e) {
  BLK.drag = { id: p.id, i: p.i, y0: p.y0, moved: true, to: null, y: 0, body: true }; BLK.hover = { id: p.id, i: p.i }; document.body.classList.add('is-blk-drag');
  const s = getSelection(); if (s.rangeCount && s.anchorNode) { try { s.collapse(s.anchorNode, s.anchorOffset); } catch (x) { /* a node that is gone */ } }   // the press must not leave a stretch selected
  blkDragAt(e.clientY);
}
document.addEventListener('pointermove', e => {
  const p = BLK.pend;
  if (p && !BLK.drag) { if (!(e.buttons & 1)) BLK.pend = null; else if (Math.hypot(e.clientX - p.x0, e.clientY - p.y0) >= BLK_MOVE) { BLK.pend = null; blkBodyStart(p, e); } }
  const d = BLK.drag;
  if (d) { if (!d.moved && Math.abs(e.clientY - d.y0) < BLK_MOVE) return; d.moved = true; document.body.classList.add('is-blk-drag');
    const doc = blkDoc(d.id), sc = doc && blkScroller(doc); if (sc) { const s = sc.getBoundingClientRect(); if (e.clientY < s.top + 40) sc.scrollTop -= 16; else if (e.clientY > s.bottom - 40) sc.scrollTop += 16; }   // near an edge: the note scrolls
    blkDragAt(e.clientY); return; }
  if (e.buttons) return;
  const over = e.target.closest?.('.blk-layer') ? BLK.hover : blkHoverAt(e.clientX, e.clientY);   // over the handle: it stays
  if (over) { clearTimeout(BLK.leave); BLK.leave = 0; if (over.id !== BLK.hover?.id || over.i !== BLK.hover?.i) { BLK.hover = over; blkPaint(); } }
  else if (BLK.hover && !BLK.leave) BLK.leave = setTimeout(() => { BLK.leave = 0; if (!BLK.drag) { BLK.hover = null; blkPaint(); } }, 350);   // a grace: the pointer may only be crossing a gap
}, { passive: true });
document.addEventListener('pointerdown', e => { BLK.pend = null; const b = blkBodyAt(e); if (b) BLK.pend = { ...b, x0: e.clientX, y0: e.clientY }; }, true);   // nothing is prevented: a click stays a click
document.addEventListener('dragstart', e => { if (BLK.pend || BLK.drag) e.preventDefault(); }, true);   // a picture or link in a card isn't dragged out by the browser
document.addEventListener('click', e => { if (!BLK.noClick) return; BLK.noClick = false; e.preventDefault(); e.stopPropagation(); }, true);   // the click that ends a drag is not an Open
document.addEventListener('pointerdown', e => {
  const h = e.target.closest?.('[data-blk-handle]');
  if (!h) { if (BLK.pick) { BLK.pick = null; blkPaint(); } return; }
  if (e.button !== 0) return;
  e.preventDefault(); e.stopPropagation();   // the caret stays where it was
  const doc = h.closest('.ed-pane')?.querySelector(':scope > .doc[contenteditable="true"]'); if (!doc) return;
  BLK.drag = { id: doc.dataset.note, i: +h.dataset.i, y0: e.clientY, moved: false, to: null, y: 0 }; blkPaint();
  try { app.querySelector('.blk-layer [data-blk-handle][data-i="' + h.dataset.i + '"]')?.setPointerCapture(e.pointerId); } catch (x) { /* a synthetic pointer */ }
}, true);
document.addEventListener('mousedown', e => { if (e.target.closest?.('[data-blk-handle]')) e.preventDefault(); }, true);   // nor does the focus move
function blkDrop(cancel) {
  const d = BLK.drag; if (!d) return; BLK.drag = null; BLK.pend = null; document.body.classList.remove('is-blk-drag');
  if (d.body) { BLK.noClick = true; setTimeout(() => { BLK.noClick = false; }, 120); }   // the click that follows a drag
  const doc = blkDoc(d.id); if (!doc) { blkPaint(); return; }
  const us = blkUnits(doc), name = BLK_KINDS[us[d.i]?.kind] || 'block';
  if (!d.moved) { BLK.pick = BLK.pick?.id === d.id && BLK.pick.i === d.i ? null : { id: d.id, i: d.i }; if (BLK.pick) status(`Picked the ${name} · Alt+Shift+↑ / ↓ moves it, Esc lets go`); blkPaint(); return; }   // a click picks it
  if (!cancel && d.to != null && blkMove(doc, us, d.i, d.to)) { BLK.pick = { id: d.id, i: d.to > d.i ? d.to - 1 : d.to }; status(`Moved the ${name} · Ctrl+Z puts it back`); }
  BLK.hover = null; blkPaint();
}
document.addEventListener('pointerup', e => { BLK.pend = null; if (BLK.drag) { e.preventDefault(); blkDrop(false); } }, true);
document.addEventListener('pointercancel', () => { BLK.pend = null; blkDrop(true); }, true);

/* ---- The keys: Alt+Shift+↑ / ↓ moves; Esc lets go of a picked block or a drag; any other key hides the handle ---- */
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && (BLK.drag || BLK.pick)) { e.preventDefault(); e.stopImmediatePropagation(); if (BLK.drag) blkDrop(true); BLK.pick = null; blkPaint(); return; }
  if (e.altKey && e.shiftKey && !e.ctrlKey && !e.metaKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
    if (S.modal || BLK.drag) return; const t = blkTarget(); if (!t) return;
    e.preventDefault(); e.stopImmediatePropagation(); blkStep(t.doc, t.i, e.key === 'ArrowUp' ? -1 : 1); return;
  }
  if (['Shift', 'Alt', 'Control', 'Meta'].includes(e.key)) return;
  if (BLK.hover || BLK.pick) { BLK.hover = null; BLK.pick = null; blkPaint(); }
}, true);

// Settings → Keyboard shortcuts lists it with the editor's keys
{ const at = KEYS.findIndex(k => k.l === 'Indent or outdent a list item');
  KEYS.splice(at < 0 ? KEYS.length : at + 1, 0, { g: 'ed', l: 'Move an attachment, code block, table, image or callout up or down', k: ['Alt', 'Shift', '↑'], or: ['Alt', 'Shift', '↓'] }); }
