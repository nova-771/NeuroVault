/* ==== Build N · editor batch from trial feedback, 2026-10-18 (QC 50, 51, 56; QC 53 is CSS only, in app.css) ====
   - QC 50: a rich (HTML) table isn't held to the text column: it may use the free space on both sides of the note and sits
     centred on the text column; it scrolls inside itself only when even that runs out. Markdown tables are unchanged. The
     room is measured after each draw and kept as --nv-rich-max on the .doc element itself (never on the note's own HTML,
     whose changes would restart the editor's undo history).
   - QC 51: clicking in a note behaves like Word or Google Docs (design profile §9). A click in the empty space below the last
     line puts the caret at the end of the note, on a new empty line when the note ends in a table, image, callout or code
     block. A click left or right of a line puts the caret at that line's start or end. The whole page area round the text
     takes the click, not only the text itself.
   - QC 56: the toolbar's Image button opens a picker (PNG, JPEG, GIF, WebP) and puts the image at the caret, copied into
     attachments/ like a dropped or pasted image (api.image_pick). */
'use strict';

/* ---- QC 50: rich tables use the room on both sides ---- */
function ednRichRoom() {
  const z = app.getBoundingClientRect().width / app.offsetWidth || 1;
  app.querySelectorAll('.view--note').forEach(view => {
    const vr = view.getBoundingClientRect(), left = vr.left + view.clientLeft * z, right = left + view.clientWidth * z;
    view.querySelectorAll('.doc').forEach(doc => {
      const dr = doc.getBoundingClientRect(); if (!dr.width) return;
      const c = (dr.left + dr.right) / 2, half = (Math.min(c - left, right - c)) / z - 28;   // 28: the table's grips and its last + (Build P) stay inside
      const w = Math.round(Math.max(dr.width / z - 34, 2 * half));
      if (doc.style.getPropertyValue('--nv-rich-max') !== w + 'px') doc.style.setProperty('--nv-rich-max', w + 'px');
    });
  });
}
const ednAfter0 = afterRender;
afterRender = function () { ednAfter0(); ednRichRoom(); };   // eslint-disable-line no-global-assign
if (window.ResizeObserver) new ResizeObserver(() => ednRichRoom()).observe(document.getElementById('app'));

/* ---- QC 51: a click below or beside the text ---- */
const EDN_SKIP = 'button, a, input, textarea, select, label, summary, [contenteditable="false"], .ed-toolbar, .note-head, .props, .save-alert, .ed-raw, '
  + '.tb-layer, .tb-menu, .tb-bar, .menu, .popover, .reading-note, .ribbon, .att-embed, .clip, [data-embed-for]';
const ednTypeable = el => !!el && el.nodeType === 1 && el.matches('p, h1, h2, h3, h4, h5, h6, ul, ol') && !el.matches('.att-src, [contenteditable="false"]') && !el.closest('[data-md]');
function ednEnd(doc) {   // the caret at the end of the note; a new empty line after a table, an image, a callout or a code block
  let last = doc.lastElementChild;
  while (last && last.nodeType === 1 && last.matches('[data-md-ignore]')) last = last.previousElementSibling;
  if (!ednTypeable(last)) { edRecord(doc, 'cmd'); const p = edNewP(); doc.append(p); edPut([p, 0]); edChanged(doc); return; }
  if (last.matches('p:empty, p:has(> br:only-child)')) { edPut([last, 0]); return; }
  const w = document.createTreeWalker(last, NodeFilter.SHOW_TEXT, { acceptNode: t => t.parentElement.closest('[contenteditable="false"]') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT });
  let t = null, x; while ((x = w.nextNode())) t = x;
  if (t) edPut([t, t.length]); else edPut([last, last.childNodes.length]);
}
function ednLine(doc, x, y) {   // the caret at the start or the end of the line at height y (x is the text column's edge on that side)
  const r = document.caretRangeFromPoint?.(x, y); if (!r || !doc.contains(r.startContainer)) return false;
  const s = getSelection(); s.removeAllRanges(); s.addRange(r); return true;
}
app.addEventListener('mousedown', e => {
  if (e.button !== 0 || e.shiftKey || e.detail > 1) return;   // a shift-click extends a selection; a double click selects a word
  const view = e.target.closest?.('.view--note'); if (!view || e.target.closest(EDN_SKIP)) return;
  const inDoc = e.target.closest('.doc');
  if (inDoc && e.target !== inDoc) return;   // on the text itself: the browser's own caret
  const doc = inDoc || view.querySelector('.doc[contenteditable="true"]'); if (!doc?.isContentEditable) return;
  const z = app.getBoundingClientRect().width / app.offsetWidth || 1, vr = view.getBoundingClientRect();
  if (e.clientX > vr.left + (view.clientLeft + view.clientWidth) * z || e.clientY > vr.top + (view.clientTop + view.clientHeight) * z) return;   // the view's scroll bar
  const dr = doc.getBoundingClientRect(), kids = [...doc.children].filter(k => k.getClientRects().length && !k.matches('[data-md-ignore]'));
  if (!kids.length) { e.preventDefault(); doc.focus({ preventScroll: true }); ednEnd(doc); return; }
  const lastR = kids[kids.length - 1].getBoundingClientRect(), firstR = kids[0].getBoundingClientRect();
  if (e.clientY < firstR.top) return;   // above the text: the title, the toolbar, the tags
  if (e.clientY > lastR.bottom) { e.preventDefault(); doc.focus({ preventScroll: true }); ednEnd(doc); edShow(); return; }   // below the last line
  if (inDoc && e.clientX >= dr.left && e.clientX <= dr.right) return;   // inside the text column: the browser's own caret
  const leftSide = e.clientX < dr.left, block = kids.find(k => { const b = k.getBoundingClientRect(); return e.clientY >= b.top && e.clientY <= b.bottom; });
  if (block && !ednTypeable(block) && !block.matches('blockquote, pre, table')) return;   // beside an image: nothing to put the caret in
  e.preventDefault(); doc.focus({ preventScroll: true });
  const x = leftSide ? dr.left + 1 : dr.right - 1;
  if (!ednLine(doc, x, e.clientY)) ednEnd(doc);
}, true);

/* ---- QC 56: the toolbar's Image button ---- */
async function ednImage() {
  const doc = edDocNow(); if (!doc) return;
  if (!doc.isContentEditable) { toast('Editing is paused while a reading mode is on'); return; }
  const id = doc.dataset.note, keep = edRange(doc) ? edSelSave(doc) : edLast?.id === id ? edLast.sel : null;
  if (!api()) { toast('Adding an image needs the app'); return; }
  let r; try { r = await api().image_pick(); } catch (e) { r = { status: 'error', message: "Couldn't open the picker: " + (e?.message || e) }; }   // no 8-second limit: the dialog waits for you
  if (r?.status === 'cancelled') return;
  if (failed(r)) { toast(r?.message || "Couldn't add the image"); return; }
  const a = { ...r, uses: [] }; D.atts = [a, ...(D.atts || []).filter(x => x.file !== a.file)];
  const d = app.querySelector(`.doc[data-note="${CSS.escape(id)}"]`);
  if (!d?.isContentEditable) { toast(`Saved to ${a.file}, but the note was closed`); return; }
  d.focus({ preventScroll: true }); if (keep) edSelLoad(d, keep, true); else edPut(edPoint(d, Infinity));
  edRecord(d); const box = document.createElement('div'); box.innerHTML = NVMarkdown.mdToHtml(`![[${a.file}]]`);
  pasteLine(d, box.firstElementChild); edChanged(d); embedAtts(); edShow(); toastHere('Added ' + a.file + ' · Ctrl+Z takes it out');
}
const ednFormat0 = doFormat;
doFormat = function (cmd) { if (cmd === 'image') { ednImage(); return; } return ednFormat0.apply(this, arguments); };   // eslint-disable-line no-global-assign
/* ==== end Build N (QC 50, 51, 56) ==== */
