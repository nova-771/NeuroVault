/* BUILD V · PHOTOS IN NOTES (mockup R59, from the first user's feedback: "not able to clicked and create text boxes on sides of photos";
   "cant edit the photos that ive added to the notes"). The decisions: "I like a caption and numbered pins - this should be a user
   setting" (r59-imgtext) and "Both" (r59-edit: crop, rotate and flip on a bar over the picked photo; mark-up in an editor window).
   In the .md, Obsidian-friendly (design notes: buildV-handover.md):
     ![[attachments/whiteboard.png]]
     *A caption: an italic line right under the embed, in the same paragraph*

     <!-- nv-pins 24.0,30.0 70.0,30.0 -->

     1. Pin 1's note
     2. Pin 2's note
   Obsidian shows the photo, the italic caption and a numbered list (it hides the comment). NeuroVault draws the caption under the photo
   (edited in place) and numbered pins on it, with the list as their notes.
   Settings → Editor → "Text with photos": Caption and pins (default) · Captions only · Pins only · Neither. What's turned off is never
   taken out of a note: a caption shows as a plain italic line, pins as a plain list. Picking a photo shows its bar (photos-edit:
   crop, rotate, flip, mark up; this file: Caption and Add a pin). */
'use strict';
Object.assign(ICON, {
  phcap: '<rect x="3" y="3" width="18" height="12" rx="2"/><path d="M7 19h10M9 22h6"/>',
  phpin: '<path d="M12 21s-6-5.6-6-11a6 6 0 0 1 12 0c0 5.4-6 11-6 11z"/><circle cx="12" cy="10" r="2"/>',
});
const PH_MODES = [['both', 'Caption and pins'], ['caption', 'Captions only'], ['pins', 'Pins only'], ['off', 'Neither']];
const PH = { mode: 'both', sel: null, pinning: null, menu: null };
const phCaps = () => PH.mode === 'both' || PH.mode === 'caption';
const phPins = () => PH.mode === 'both' || PH.mode === 'pins';
const PH_PINS_RE = /^\s*nv-pins((?:\s+-?\d+(?:\.\d+)?,-?\d+(?:\.\d+)?)*)\s*$/;

/* ---- Reading a photo's parts from the editor ---- */
const phImgFile = w => w && /^attachments\/.+\.(png|jpe?g|gif|webp|bmp)$/i.test(w.dataset.wiki || '') ? w.dataset.wiki : null;
// A caption paragraph: "!" [[attachments/…image]] <br> <em>…</em> and nothing else
function phCapParts(p) {
  if (!p || p.nodeName !== 'P') return null;
  const kids = [...p.childNodes].filter(n => !(n.nodeType === 3 && !n.data.trim() && n !== p.firstChild));
  let i = 0, bang = null, hide = null;
  if (kids[0]?.nodeType === 1 && kids[0].classList.contains('ph-hide')) { hide = kids[0]; const w = hide.querySelector('.wikilink'); const file = phImgFile(w); if (!file) return null; i = 1; return phCapRest(p, kids, i, file, hide); }
  if (kids[0]?.nodeType === 3 && kids[0].data === '!') { bang = kids[0]; i = 1; } else return null;
  const w = kids[i]; if (!(w?.nodeType === 1 && w.classList.contains('wikilink'))) return null; const file = phImgFile(w); if (!file) return null;
  return phCapRest(p, kids, i + 1, file, null, bang, w);
}
function phCapRest(p, kids, i, file, hide, bang, w) {
  const br = kids[i]; if (br?.nodeName !== 'BR') return null;
  const rest = kids.slice(i + 1); if (rest.length !== 1 || rest[0].nodeName !== 'EM') return null;
  return { p, file, hide, bang, w, br, em: rest[0] };
}
function phPinsAfter(p) {   // the comment with the pins' places, then the numbered list, right after the photo's paragraph
  let n = p.nextSibling; while (n && n.nodeType === 3 && !n.data.trim()) n = n.nextSibling;
  if (!n || n.nodeType !== 8) return null; const m = n.data.match(PH_PINS_RE); if (!m) return null;
  let l = n.nextSibling; while (l && l.nodeType === 3 && !l.data.trim()) l = l.nextSibling;
  const pts = m[1].trim() ? m[1].trim().split(/\s+/).map(s => s.split(',').map(Number)) : [];
  return { comment: n, pts, ol: l?.nodeName === 'OL' ? l : null };
}
const phPinsText = pts => ' nv-pins ' + pts.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ') + ' ';

/* ---- Drawing: the caption paragraph keeps its embed hidden (and saved), the pins go on the photo ---- */
function phDecorate(doc) {
  const n = D.notes.find(x => x.id === doc.dataset.note) || note();
  doc.querySelectorAll(':scope > p').forEach(p => {
    const c = phCapParts(p); if (!c) return;
    if (!c.hide) {   // wrap "!" and the link: not editable, not shown, still saved as written
      const s = document.createElement('span'); s.className = 'ph-hide'; s.setAttribute('contenteditable', 'false'); c.bang.before(s); s.append(c.bang, c.w); c.hide = s; }
    p.classList.add('ph-cap-p'); p.classList.toggle('is-plain', !phCaps()); c.em.classList.add('ph-cap');
    const prev = p.previousElementSibling, html = embedHtml(c.file, n);
    if (prev?.dataset?.embedFor === c.file) { if (!prev.matches('.att-img')) prev.outerHTML = html; } else p.insertAdjacentHTML('beforebegin', html);
  });
  doc.querySelectorAll('.att-img[data-embed-for]').forEach(box => {
    const p = box.nextElementSibling, file = box.dataset.embedFor, pins = p && phPinsAfter(p);
    box.classList.toggle('is-picked', PH.sel?.doc === doc && PH.sel.file === file && PH.sel.box === box);
    box.classList.toggle('is-pinning', !!PH.pinning && PH.sel?.box === box);
    const show = pins && phPins(), lis = pins?.ol ? [...pins.ol.children].filter(x => x.nodeName === 'LI') : [];
    const html = show ? pins.pts.map(([x, y], i) => `<button class="ph-pin" data-ph-pin="${i}" style="left:${x}%;top:${y}%" aria-label="Pin ${i + 1}${lis[i] ? ': ' + esc(lis[i].textContent.trim().slice(0, 80)) : ''}" data-tip="${lis[i] ? esc(lis[i].textContent.trim().slice(0, 80)) : 'Pin ' + (i + 1)}">${i + 1}</button>`).join('') : '';
    let layer = box.querySelector(':scope > .ph-pins');
    if (html) { if (!layer) { layer = document.createElement('span'); layer.className = 'ph-pins'; box.append(layer); } if (layer.innerHTML !== html) layer.innerHTML = html; } else layer?.remove();
    if (pins?.ol) pins.ol.classList.toggle('ph-pinlist', !!show);
    phFit(box);
    const bar = PH.sel?.box === box ? phBarHtml(file, p) : '';
    let b = box.querySelector(':scope > .ph-bar'); if (bar) { if (!b) { box.insertAdjacentHTML('afterbegin', bar); } else if (b.outerHTML !== bar) b.outerHTML = bar; } else b?.remove();
    if (bar) phFit(box);
  });
}
function phFit(box) {   // the pins' layer over the picture itself, and the bar centred on it (the box is as wide as the text)
  const img = box.querySelector(':scope > img'); if (!img) return;
  if (!img.complete || !img.naturalWidth) { if (!img.dataset.phFit) { img.dataset.phFit = '1'; img.addEventListener('load', () => phFit(box), { once: true }); } return; }
  const l = img.offsetLeft + img.clientLeft, t = img.offsetTop + img.clientTop, w = img.clientWidth, h = img.clientHeight;
  const layer = box.querySelector(':scope > .ph-pins'); if (layer) Object.assign(layer.style, { left: l + 'px', top: t + 'px', width: w + 'px', height: h + 'px' });
  const bar = box.querySelector(':scope > .ph-bar'); if (bar) bar.style.left = (img.offsetLeft + img.offsetWidth / 2) + 'px';
}
const phTool = (act, icon, label, on) => `<button class="icon-btn icon-btn--sm ph-tool" data-ph="${act}" aria-label="${label}" data-tip="${label}"${on != null ? ` aria-pressed="${on}"` : ''}>${ic(icon)}</button>`;
let phBarExtra = () => '';   // photos-edit.js adds crop, rotate, flip and Mark up…
function phBarHtml(file, p) {
  const cap = phCaps() ? phTool('caption', 'phcap', p && phCapParts(p) ? 'Edit the caption' : 'Add a caption') : '';
  const pin = phPins() ? phTool('pin', 'phpin', PH.pinning ? 'Click the photo to place the pin (Esc stops)' : 'Add a pin', !!PH.pinning) : '';
  const extra = phBarExtra(file, p);
  return `<span class="ph-bar" role="toolbar" aria-label="Photo">${extra}${extra && (cap || pin) ? '<span class="ph-sep"></span>' : ''}${cap}${pin}</span>`;
}

/* ---- Caption: add one, or go to it; an emptied caption goes, leaving the photo as it was ---- */
function phCaption(doc, p) {
  if (!p || !doc) return;
  const c = phCapParts(p); if (c) { const r = document.createRange(); r.selectNodeContents(c.em); getSelection().removeAllRanges(); getSelection().addRange(r); return; }
  if (!p.classList.contains('att-src')) return;
  edRecord(doc, 'type');   // one Ctrl+Z step with the words typed into it
  const w = p.querySelector('.wikilink'), bang = p.firstChild;
  p.classList.remove('att-src'); p.removeAttribute('contenteditable');
  const hide = document.createElement('span'); hide.className = 'ph-hide'; hide.setAttribute('contenteditable', 'false');
  p.textContent = ''; hide.append(bang?.nodeType === 3 ? bang : document.createTextNode('!'), w); p.append(hide, document.createElement('br'));
  const em = document.createElement('em'); em.className = 'ph-cap'; em.textContent = 'Caption'; p.append(em); p.classList.add('ph-cap-p');
  doc.focus({ preventScroll: true }); const r = document.createRange(); r.selectNodeContents(em); getSelection().removeAllRanges(); getSelection().addRange(r);
  edChanged(doc); status('Type the caption · it saves as the line under the photo');
}
function phTidyCaptions(doc) {   // an empty caption: back to the plain photo line; stray text typed outside the caption goes into it
  let changed = false;
  doc.querySelectorAll(':scope > p.ph-cap-p').forEach(p => {
    const em = p.querySelector(':scope > em'), w = p.querySelector('.ph-hide .wikilink');
    if (!w) return;
    const loose = [...p.childNodes].filter(n => n !== em && !(n.nodeType === 1 && (n.classList.contains('ph-hide') || n.nodeName === 'BR')) && (n.textContent || '').trim());
    if (loose.length && em) { loose.forEach(n => em.append(n.nodeType === 3 ? n : document.createTextNode(n.textContent))); changed = true; }
    if (!em || !em.textContent.replace(/​/g, '').trim()) {
      const file = w.dataset.wiki; p.textContent = ''; p.append('!', w); p.className = 'att-src'; p.setAttribute('contenteditable', 'false'); changed = true;
      if (!p.previousElementSibling?.dataset?.embedFor) p.insertAdjacentHTML('beforebegin', embedHtml(file, note()));
    }
  });
  return changed;
}

/* ---- Pins: click the photo to place one (its note is the new list item), drag one to move it, its menu removes it ---- */
function phAddPin(doc, box, x, y) {
  const p = box.nextElementSibling; if (!p) return;
  edRecord(doc, 'type');   // one Ctrl+Z step with its note typed after it
  let pins = phPinsAfter(p);
  if (!pins) { const cm = document.createComment(phPinsText([])); p.after(cm); pins = { comment: cm, pts: [], ol: null }; }
  if (!pins.ol) { const ol = document.createElement('ol'); pins.comment.after(ol); pins.ol = ol; }
  const pts = [...pins.pts, [x, y]]; pins.comment.data = phPinsText(pts);
  const lis = [...pins.ol.children].filter(n => n.nodeName === 'LI');
  let li = lis[pts.length - 1];
  if (!li) { li = document.createElement('li'); li.append(document.createElement('br')); pins.ol.append(li); }
  phDecorate(doc); doc.focus({ preventScroll: true }); edPut([li, 0]);
  edChanged(doc); status(`Pin ${pts.length} placed · type its note`);
}
function phMovePin(doc, box, i, x, y, record) {
  const pins = phPinsAfter(box.nextElementSibling); if (!pins || !pins.pts[i]) return;
  if (record) edRecord(doc);
  pins.pts[i] = [x, y]; pins.comment.data = phPinsText(pins.pts); phDecorate(doc);
}
function phRemovePin(doc, box, i) {
  const pins = phPinsAfter(box.nextElementSibling); if (!pins || !pins.pts[i]) return;
  edRecord(doc);
  pins.pts.splice(i, 1);
  const lis = pins.ol ? [...pins.ol.children].filter(n => n.nodeName === 'LI') : [];
  lis[i]?.remove();
  if (!pins.pts.length) { pins.comment.remove(); if (pins.ol && !pins.ol.querySelector('li')) pins.ol.remove(); }
  else pins.comment.data = phPinsText(pins.pts);
  PH.menu = null; phDecorate(doc); edChanged(doc); status(`Pin ${i + 1} removed · Ctrl+Z puts it back`);
}
const phAt = (box, e) => {   // percent of the picture itself (inside its border)
  const img = box.querySelector('img') || box, r = img.getBoundingClientRect(), z = r.width / (img.offsetWidth || r.width) || 1;
  const l = r.left + img.clientLeft * z, t = r.top + img.clientTop * z, w = img.clientWidth * z || r.width, h = img.clientHeight * z || r.height;
  return [Math.min(100, Math.max(0, (e.clientX - l) / w * 100)), Math.min(100, Math.max(0, (e.clientY - t) / h * 100))];
};

/* ---- Picking a photo, its bar, the pin menu ---- */
function phPick(doc, box) {
  PH.sel = box ? { doc, box, file: box.dataset.embedFor } : null; PH.pinning = null; PH.menu = null;
  app.querySelectorAll('.doc[contenteditable="true"]').forEach(phDecorate);
}
function phMenuPaint() {
  app.querySelector(':scope > .ph-pinmenu')?.remove(); const m = PH.menu; if (!m || !m.box.isConnected) { PH.menu = null; return; }
  app.insertAdjacentHTML('beforeend', `<div class="menu card ph-pinmenu" role="menu" aria-label="Pin ${m.i + 1}"><button class="menu-item" role="menuitem" data-ph-menu="note">${ic('edit')}<span>Go to its note</span></button><button class="menu-item menu-item--danger" role="menuitem" data-ph-menu="remove">${ic('trash')}<span>Remove pin ${m.i + 1}</span></button></div>`);
  const el = app.querySelector(':scope > .ph-pinmenu'), pin = m.box.querySelector(`[data-ph-pin="${m.i}"]`); if (pin && typeof placeUnder === 'function') placeUnder(el, pin);
  el.querySelector('.menu-item')?.focus({ preventScroll: true });
}
document.addEventListener('mousedown', e => {
  const t = e.target, doc = t.closest?.('.doc');
  if (t.closest?.('.ph-pinmenu, .ph-bar')) { e.preventDefault(); return; }
  const pin = t.closest?.('.ph-pin');
  if (pin && doc?.isContentEditable && e.button === 0) {   // drag a pin; a click without moving opens its menu
    e.preventDefault(); const box = pin.closest('.att-img'), i = +pin.dataset.phPin, x0 = e.clientX, y0 = e.clientY; let moved = false;
    const mv = ev => { if (!moved && Math.hypot(ev.clientX - x0, ev.clientY - y0) < 4) return; const [x, y] = phAt(box, ev); phMovePin(doc, box, i, x, y, !moved); moved = true; };
    const up = () => { document.removeEventListener('mousemove', mv, true); document.removeEventListener('mouseup', up, true);
      if (moved) { edChanged(doc); status(`Pin ${i + 1} moved`); } else { PH.menu = { doc, box, i }; phMenuPaint(); } };
    document.addEventListener('mousemove', mv, true); document.addEventListener('mouseup', up, true); return;
  }
  const box = t.closest?.('.doc .att-img[data-embed-for]');
  if (box && doc?.isContentEditable && e.button === 0) {
    e.preventDefault();
    if (PH.pinning && PH.sel?.box === box && !t.closest('.ph-bar')) { const [x, y] = phAt(box, e); PH.pinning = null; phAddPin(doc, box, x, y); return; }
    if (PH.sel?.box !== box) phPick(doc, box);
    return;
  }
  if (PH.sel && !t.closest?.('.ph-bar, .ph-pinmenu, [data-dlg], .modal')) phPick(null, null);
  if (PH.menu && !t.closest?.('.ph-pinmenu')) { PH.menu = null; phMenuPaint(); }
}, true);
document.addEventListener('click', e => {
  const m = e.target.closest?.('[data-ph-menu]');
  if (m && PH.menu) { e.preventDefault(); e.stopImmediatePropagation(); const { doc, box, i } = PH.menu;
    if (m.dataset.phMenu === 'remove') { phRemovePin(doc, box, i); phMenuPaint(); return; }
    const pins = phPinsAfter(box.nextElementSibling), li = pins?.ol && [...pins.ol.children].filter(x => x.nodeName === 'LI')[i];
    PH.menu = null; phMenuPaint(); if (li) { doc.focus({ preventScroll: true }); edPut([li, li.childNodes.length]); } return; }
  const b = e.target.closest?.('.ph-bar [data-ph]'); if (!b || !PH.sel) return;
  e.preventDefault(); e.stopImmediatePropagation(); const { doc, box } = PH.sel, p = box.nextElementSibling;
  if (b.dataset.ph === 'caption') { phPick(null, null); phCaption(doc, p); return; }
  if (b.dataset.ph === 'pin') { PH.pinning = PH.pinning ? null : { at: Date.now() }; phDecorate(doc); status(PH.pinning ? 'Click the photo where the pin goes' : 'Pin placing stopped'); return; }
  phAct?.(b.dataset.ph, doc, box, p);
}, true);
let phAct = null;   // photos-edit.js: crop, rotate, flip, mark up
document.addEventListener('keydown', e => {
  if (e.key !== 'Escape') return;
  if (PH.menu) { e.preventDefault(); e.stopImmediatePropagation(); PH.menu = null; phMenuPaint(); return; }
  if (PH.pinning) { e.preventDefault(); e.stopImmediatePropagation(); PH.pinning = null; if (PH.sel) phDecorate(PH.sel.doc); status('Pin placing stopped'); return; }
  if (PH.sel && !S.modal) { e.preventDefault(); e.stopImmediatePropagation(); phPick(null, null); }
}, true);
document.addEventListener('keydown', e => {
  if ((e.key !== 'Backspace' && e.key !== 'Delete') || e.ctrlKey || e.altKey || e.metaKey) return;
  const s = getSelection(); if (!s.rangeCount) return; const r = s.getRangeAt(0), el = r.startContainer.nodeType === 1 ? r.startContainer : r.startContainer.parentElement;
  const p = el?.closest?.('.doc p.ph-cap-p'), doc = p?.closest('.doc'), em = p?.querySelector(':scope > em'); if (!p || !em || !doc?.isContentEditable) return;
  const a = document.createRange(); a.selectNodeContents(em); const before = r.collapsed ? (() => { const x = document.createRange(); x.setStart(em, 0); x.setEnd(r.startContainer, r.startOffset); return x.toString().length; })() : null;
  const len = em.textContent.length, all = !r.collapsed && r.toString().length >= len;
  const empties = all || (r.collapsed && len <= 1 && ((e.key === 'Backspace' && before === 1) || (e.key === 'Delete' && before === 0)));
  if (empties) { e.preventDefault(); e.stopImmediatePropagation(); edRecord(doc); em.textContent = ''; phTidyCaptions(doc); phDecorate(doc); edChanged(doc); status('Caption taken away · Ctrl+Z puts it back'); return; }
  if (r.collapsed && ((e.key === 'Backspace' && before === 0) || (e.key === 'Delete' && before === len))) { e.preventDefault(); e.stopImmediatePropagation(); }   // the caption's edges: not into the photo line or the next paragraph
}, true);
document.addEventListener('input', e => { const doc = e.target.closest?.('.doc'); if (doc && doc.querySelector('p.ph-cap-p, .ph-pins')) { if (phTidyCaptions(doc)) edChanged(doc); phDecorate(doc); } }, true);

/* ---- Settings → Editor: Text with photos ---- */
function phSetting() {
  return `<div class="eyebrow eyebrow--gap">Photos</div><div class="set-row"><div><div class="set-label" id="ph-mode-l">Text with photos</div><div class="set-desc">A caption under a photo, numbered pins on it with their notes listed under it, or both. Turning one off never takes it out of a note</div></div>
    <div class="seg" role="group" aria-labelledby="ph-mode-l">${PH_MODES.map(([v, l]) => `<button class="seg-opt" data-act="ph-mode" data-v="${v}" aria-pressed="${PH.mode === v}">${l}</button>`).join('')}</div></div>`;
}
app.addEventListener('click', e => { const b = e.target.closest?.('[data-act="ph-mode"]'); if (!b) return; e.stopImmediatePropagation(); PH.mode = b.dataset.v; saveSettings({ photo_text: PH.mode }); status('Setting saved'); renderAll(); }, true);
{ const sp0 = settingsPane; settingsPane = sec => sp0(sec) + (sec === 'editor' ? phSetting() : ''); }   // eslint-disable-line no-global-assign
{ const lr0 = loadReader; loadReader = async function () { const r = await lr0.apply(this, arguments); try { const c = api() ? await within(api().get_settings(), 2000) : JSON.parse(localStorage.getItem(DEV_KEY) || '{}'); if (PH_MODES.some(([v]) => v === c?.photo_text)) PH.mode = c.photo_text; } catch (e) { /* the default */ } return r; }; }   // eslint-disable-line no-global-assign

/* ---- Every draw: the photos' captions and pins (after Build A's embeds) ---- */
const phEmbed0 = embedAtts;
embedAtts = function () {   // eslint-disable-line no-global-assign
  const r = phEmbed0.apply(this, arguments); app.querySelectorAll('.doc').forEach(phDecorate); if (PH.menu) phMenuPaint();
  app.querySelectorAll('.doc img[data-att-img]:not([src])').forEach(async img => {   // a photo drawn here (a captioned one) gets its picture as Build A's do
    const f = img.dataset.attImg, url = PLAYER.urls[f] || (realData() ? await clipUrl(f) : null); if (url) img.src = url; });
  return r;
};
/* ---- end Build V · photos ---- */
