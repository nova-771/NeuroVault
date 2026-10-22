/* BUILD V · EDITING PHOTOS (mockup R59, the decision r59-edit "Both"): crop, rotate and flip on the picked photo's bar; mark-up
   (arrow, box, highlight, text, pen) in an editor window. The first user: "cant edit the photos that ive added to the notes".
   Editing ALWAYS saves a copy, "<name> (edited).png", and keeps the original (QC 68: the copy remembers where it came from;
   QC 88: nothing is deleted). The note shows the copy; the Timeline records each edit with Restore (api.photo_save_edit /
   list_photo_edits / restore_photo_edit). QC 100: no tag under the photo, and one "(edited)" copy per original (editing it again
   re-uses it). Drawn on a canvas in the page: no new library. */
'use strict';
Object.assign(ICON, {
  phcrop: '<path d="M6 2v14a2 2 0 0 0 2 2h14"/><path d="M18 22V8a2 2 0 0 0-2-2H2"/>',
  phrot: '<path d="M21 12a9 9 0 1 1-3-6.7L21 8"/><path d="M21 3v5h-5"/>',
  phflip: '<path d="M12 3v18"/><path d="M8 7 3 12l5 5V7z"/><path d="M16 7l5 5-5 5V7z"/>',
  phpen: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>',
});
const PHE = { edits: [], crop: null, ed: null, sample: false };   // sample: the editor tests keep edits in the page even beside a live vault
const pheLive = () => realData() && !PHE.sample;
const pheNoteOf = doc => D.notes.find(n => n.id === doc?.dataset.note) || note();
const pheOriginal = file => (/ \(edited(?: \d+)?\)\.[^.]+$/.test(file) && PHE.edits.find(e => e.to === file)?.from) || file;
const pheCopyName = file => attBase(pheOriginal(file)).replace(/\.[^.]+$/, '').replace(/ \(edited(?: \d+)?\)$/, '') + ' (edited).png';

/* ---- The bar: Crop, Rotate right, Flip | Mark up… (and, while cropping, Cancel / Done) ---- */
phBarExtra = () => phTool('crop', 'phcrop', 'Crop') + phTool('rotate', 'phrot', 'Rotate right') + phTool('flip', 'phflip', 'Flip')
  + '<span class="ph-sep"></span><button class="btn btn--secondary btn--sm ph-mark" data-ph="markup">' + ic('phpen') + 'Mark up…</button>';
const pheBar0 = phBarHtml;
phBarHtml = function (file, p) {   // eslint-disable-line no-global-assign
  if (PHE.crop && PHE.crop.file === file) return `<span class="ph-bar" role="toolbar" aria-label="Crop">${ic('phcrop')}<span class="ph-bar-t">Drag the corners</span><button class="btn btn--secondary btn--sm" data-ph="crop-cancel">Cancel</button><button class="btn btn--primary btn--sm" data-ph="crop-done">Done</button></span>`;
  return pheBar0.apply(this, arguments);
};

/* ---- The picture as pixels, and what each tool makes of it ---- */
async function pheImage(file) {
  const url = PLAYER.urls[file] || (realData() ? await clipUrl(file) : null); if (!url) throw new Error(`${attBase(file)} isn't loaded`);
  const img = new Image(); img.src = url; await img.decode(); return img;
}
function pheCanvas(img, op, arg) {
  const w = img.naturalWidth || img.width, h = img.naturalHeight || img.height, c = document.createElement('canvas'), g = c.getContext('2d');   // an Image or a canvas
  if (op === 'rotate') { c.width = h; c.height = w; g.translate(h, 0); g.rotate(Math.PI / 2); g.drawImage(img, 0, 0); }
  else if (op === 'flip') { c.width = w; c.height = h; g.translate(w, 0); g.scale(-1, 1); g.drawImage(img, 0, 0); }
  else if (op === 'crop') { const [x0, y0, x1, y1] = arg, sx = x0 / 100 * w, sy = y0 / 100 * h, sw = Math.max(1, (x1 - x0) / 100 * w), sh = Math.max(1, (y1 - y0) / 100 * h);
    c.width = Math.round(sw); c.height = Math.round(sh); g.drawImage(img, sx, sy, sw, sh, 0, 0, c.width, c.height); }
  else { c.width = w; c.height = h; g.drawImage(img, 0, 0); }
  return c;
}
const PHE_SAID = { crop: 'Cropped', rotate: 'Rotated a quarter turn right', flip: 'Flipped', markup: 'Marked up', edit: 'Edited' };
// Saves the copy and shows it in the note. Real vault: the backend writes it and points the note at it; the sample: in the page
const pheShowNew = (file, data) => {   // the one copy keeps its name, so every picture of it already drawn takes the new pixels
  PLAYER.urls[file] = data; document.querySelectorAll('img[data-att-img]').forEach(i => { if (i.dataset.attImg === file) i.src = data; });
};
async function pheSave(doc, file, canvas, op) {
  const n = pheNoteOf(doc), data = canvas.toDataURL('image/png');
  if (pheLive()) {
    await flushSaves();
    const r = await nv('photo_save_edit', file, data, rawId(n?.id), op);
    if (failed(r)) { toast(r.message || "The edited copy couldn't be saved"); return null; }
    pheShowNew(r.file, data);
    if (r.note_id) await doLoadNote(r.note_id);
    await refreshAtts(); await pheLoadEdits();
    status(`${PHE_SAID[op]}: saved as ${r.name} beside the original · the note shows the copy · Restore is in the Timeline`); renderAll(); return r;
  }
  const orig = pheOriginal(file), name = pheCopyName(file), to = 'attachments/' + name; pheShowNew(to, data);   // QC 100: the one copy, re-used
  D.atts = [{ file: to, name, kind: 'image', size: Math.round(data.length * .75), mtime: new Date().toISOString().slice(0, 19), source: { path: orig, exists: true, how: 'edit' } }, ...(D.atts || []).filter(a => a.file !== to)];
  if (n && file !== to) { syncDoc(n); n.md = n.md.split(`![[${file}]]`).join(`![[${to}]]`); n.html = null; n.docDirty = false; n.dirty = true; }
  else if (n) { syncDoc(n); n.html = null; n.docDirty = false; }   // the same name, new pixels: draw it again
  PHE.edits.unshift({ id: Date.now() + PHE.edits.length, note_id: n?.id || null, title: n?.title, from: orig, to, what: op, at: new Date().toISOString(), restored_at: null, kept: true });
  status(`${PHE_SAID[op]}: saved as ${name} beside the original · the note shows the copy · Restore is in the Timeline`); renderAll(); return { file: to, name };
}
async function pheApply(doc, file, op, arg) {
  try { const img = await pheImage(file); return await pheSave(doc, file, pheCanvas(img, op, arg), op); }
  catch (e) { toast(plainErr(e, "The photo couldn't be edited.")); return null; }
}
async function pheRestore(id) {
  const e = PHE.edits.find(x => x.id === id); if (!e) return;
  if (pheLive()) { await flushSaves(); const r = await nv('restore_photo_edit', id); if (failed(r)) { toast(r.message || "The original couldn't be shown"); return; }
    if (r.note_id) await doLoadNote(r.note_id); await pheLoadEdits(); if (typeof bmActivity === 'function') { S.bm.actAt = 0; bmActivity(); } }
  else { const n = D.notes.find(x => x.id === e.note_id); if (n) { syncDoc(n); n.md = n.md.split(`![[${e.to}]]`).join(`![[${e.from}]]`); n.html = null; n.docDirty = false; n.dirty = true; } e.restored_at = new Date().toISOString(); }
  status(`Showing the original, ${attBase(e.from)} · the edited copy stays in Attachments`); renderAll();
}
async function pheLoadEdits() { if (!pheLive()) return; const r = await nv('list_photo_edits', 200); if (Array.isArray(r)) PHE.edits = r; }

/* ---- Crop in place: a frame with 8 handles over the picture; Done saves the copy ---- */
function pheCropHtml() {
  const [x0, y0, x1, y1] = PHE.crop.r, hs = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
  return `<span class="phe-crop" style="left:${x0}%;top:${y0}%;width:${x1 - x0}%;height:${y1 - y0}%">${hs.map(h => `<i class="phe-h phe-h--${h}" data-phe-h="${h}"></i>`).join('')}</span>`;
}
function pheDecorate(doc) {   // QC 100: no "Edited copy" tag under the photo; the Timeline keeps the edit and Restore
  doc.querySelectorAll('.att-img[data-embed-for]').forEach(box => {
    let layer = box.querySelector(':scope > .phe-croplayer');
    if (PHE.crop && PHE.crop.box === box) {
      if (!layer) { layer = document.createElement('span'); layer.className = 'phe-croplayer'; box.append(layer); }
      layer.innerHTML = pheCropHtml(); const img = box.querySelector(':scope > img');
      if (img) Object.assign(layer.style, { left: (img.offsetLeft + img.clientLeft) + 'px', top: (img.offsetTop + img.clientTop) + 'px', width: img.clientWidth + 'px', height: img.clientHeight + 'px' });
    } else layer?.remove();
  });
}
const pheDec0 = phDecorate;
phDecorate = function (doc) { pheDec0.apply(this, arguments); pheDecorate(doc); };   // eslint-disable-line no-global-assign
document.addEventListener('mousedown', e => {   // a crop handle: drag it (percent of the picture, at least 5% each way)
  const h = e.target.closest?.('[data-phe-h]'); if (!h || !PHE.crop) return;
  e.preventDefault(); e.stopImmediatePropagation(); const box = PHE.crop.box, k = h.dataset.pheH;
  const mv = ev => { const [x, y] = phAt(box, ev), r = PHE.crop.r;
    if (k.includes('w')) r[0] = Math.min(x, r[2] - 5); if (k.includes('e')) r[2] = Math.max(x, r[0] + 5);
    if (k.includes('n')) r[1] = Math.min(y, r[3] - 5); if (k.includes('s')) r[3] = Math.max(y, r[1] + 5);
    const l = box.querySelector('.phe-crop'); if (l) Object.assign(l.style, { left: r[0] + '%', top: r[1] + '%', width: (r[2] - r[0]) + '%', height: (r[3] - r[1]) + '%' }); };
  const up = () => { document.removeEventListener('mousemove', mv, true); document.removeEventListener('mouseup', up, true); };
  document.addEventListener('mousemove', mv, true); document.addEventListener('mouseup', up, true);
}, true);

/* ---- The bar's tools ---- */
phAct = async (act, doc, box) => {   // eslint-disable-line no-global-assign
  const file = box.dataset.embedFor;
  if (act === 'crop') { PHE.crop = { box, file, r: [0, 0, 100, 100] }; phDecorate(doc); status('Drag the corners, then Done · Esc cancels'); return; }
  if (act === 'crop-cancel') { PHE.crop = null; phDecorate(doc); status('Nothing was saved'); return; }
  if (act === 'crop-done') { const r = PHE.crop.r.map(v => Math.round(v * 10) / 10); PHE.crop = null; phPick(null, null);
    if (r[0] <= 0 && r[1] <= 0 && r[2] >= 100 && r[3] >= 100) { status('Nothing cropped: nothing was saved'); return; }
    await pheApply(doc, file, 'crop', r); return; }
  if (act === 'rotate' || act === 'flip') { phPick(null, null); await pheApply(doc, file, act); return; }
  if (act === 'markup') { phPick(null, null); pheOpenEditor(doc, file); }
};
document.addEventListener('keydown', e => { if (e.key === 'Escape' && PHE.crop) { e.preventDefault(); e.stopImmediatePropagation(); const doc = PHE.crop.box.closest('.doc'); PHE.crop = null; phDecorate(doc); status('Nothing was saved'); } }, true);
let pheOpenEditor = () => {};   // the mark-up window (below)

/* ---- The Timeline: each edit, with Restore (the note shows the photo it was made from again) ---- */
const pheBm0 = bmActivity;
bmActivity = async function () {   // eslint-disable-line no-global-assign
  await pheBm0.apply(this, arguments);
  if (!VAULT.live) return;
  await pheLoadEdits();
  const ev = PHE.edits.map(r => ({ id: 'pe-' + r.id, at: r.at, time: bmTime(r.at), range: bmRange(r.at), type: 'Attachments', noteId: r.note_id ? 'n-' + r.note_id : null, file: attBase(r.from),
    photoRestoreId: r.restored_at || !r.kept || !r.note_id ? null : r.id, restored: !!r.restored_at,
    title: `${PHE_SAID[r.what] || 'Edited'} ${attBase(r.from)}${r.title ? ` in “${r.title.slice(0, 60)}”` : ''}`,
    desc: r.restored_at ? `Restored ${bmTime(r.restored_at)} · the note shows ${attBase(r.from)} again` : `Saved as ${attBase(r.to)} · the original is kept${r.note_id ? ' · Restore shows it in the note' : ''}` }));
  const seen = new Set(D.events.map(e => e.id)), add = ev.filter(e => !seen.has(e.id));
  if (add.length) { D.events = [...D.events, ...add].sort((a, b) => (b.at > a.at) - (b.at < a.at)); if (UI.view === 'history') renderAll(); }
};
app.addEventListener('click', e => { const b = e.target.closest?.('[data-act="photo-restore"]'); if (!b) return; e.stopImmediatePropagation(); pheRestore(+b.dataset.v); }, true);
{ const lv0 = loadVault; loadVault = async function () { const ok = await lv0.apply(this, arguments); if (ok) await pheLoadEdits(); return ok; }; }   // eslint-disable-line no-global-assign
/* ---- end Build V · editing photos (the bar) ---- */

/* ---- The mark-up window (R59 "Both": quick fixes on the bar, mark-up here). Every tool down the side, three colours, Undo; the
   picture is redrawn from its state after each draw, so a re-render never loses what's drawn. Save a copy flattens it to a PNG. ---- */
Object.assign(ICON, {
  pharrow: '<path d="M5 19 19 5"/><path d="M9 5h10v10"/>',
  phbox: '<rect x="4" y="5" width="16" height="14" rx="1.5"/>',
  phhl: '<path d="m9 11-6 6v3h9l3-3"/><path d="m22 12-4.6 4.6a2 2 0 0 1-2.8 0l-5.2-5.2a2 2 0 0 1 0-2.8L14 4"/>',
  phtext: '<path d="M4 7V4h16v3"/><path d="M9 20h6"/><path d="M12 4v16"/>',
  phundo: '<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>',
  phzin: '<circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/><path d="M11 8v6"/><path d="M8 11h6"/>',
  phzout: '<circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/><path d="M8 11h6"/>',
  phfit: '<path d="M8 3H5a2 2 0 0 0-2 2v3"/><path d="M21 8V5a2 2 0 0 0-2-2h-3"/><path d="M3 16v3a2 2 0 0 0 2 2h3"/><path d="M16 21h3a2 2 0 0 0 2-2v-3"/>',
});
const PHE_TOOLS = [['crop', 'phcrop', 'Crop: drag across the part to keep'], ['rotate', 'phrot', 'Rotate right'], ['flip', 'phflip', 'Flip'],
  ['arrow', 'pharrow', 'Arrow'], ['box', 'phbox', 'Box'], ['hl', 'phhl', 'Highlight'], ['text', 'phtext', 'Text'], ['pen', 'phpen', 'Pen']];
const PHE_COLOURS = [['red', 'Red', '#d6336c'], ['amber', 'Amber', '#e8890c'], ['accent', 'Accent', null]];
const pheColour = k => PHE_COLOURS.find(c => c[0] === k)?.[2] || getComputedStyle(app).getPropertyValue('--accent').trim() || '#6d5ce8';
pheOpenEditor = async (doc, file) => {   // eslint-disable-line no-global-assign
  let img; try { img = await pheImage(file); } catch (e) { toast(plainErr(e, "The photo couldn't be opened.")); return; }
  const base = pheCanvas(img, 'copy');
  PHE.ed = { doc, file, base, shapes: [], undo: [], tool: 'arrow', colour: 'red', drag: null, typing: null, changed: false };
  S.focus = { sel: '.phe-ed .phe-stage' }; renderAll();   // the photo, not a tool: a focused tool would show a ring on top of its fill
};
const pheSnap = () => { const ed = PHE.ed, c = document.createElement('canvas'); c.width = ed.base.width; c.height = ed.base.height; c.getContext('2d').drawImage(ed.base, 0, 0); ed.undo.push({ base: c, shapes: ed.shapes.map(s => ({ ...s, pts: s.pts && [...s.pts] })) }); if (ed.undo.length > 40) ed.undo.shift(); ed.changed = true; };
function pheFlat() {   // the picture with every shape drawn in
  const ed = PHE.ed, c = document.createElement('canvas'); c.width = ed.base.width; c.height = ed.base.height; const g = c.getContext('2d'); g.drawImage(ed.base, 0, 0); ed.shapes.forEach(s => pheShape(g, s, c)); return c;
}
function pheShape(g, s, c) {
  const lw = Math.max(3, Math.round(Math.max(c.width, c.height) / 180)); g.save(); g.lineCap = 'round'; g.lineJoin = 'round'; g.strokeStyle = s.colour; g.fillStyle = s.colour; g.lineWidth = lw;
  const [x0, y0, x1, y1] = s.pts || [];
  if (s.t === 'box') g.strokeRect(Math.min(x0, x1), Math.min(y0, y1), Math.abs(x1 - x0), Math.abs(y1 - y0));
  else if (s.t === 'hl') { g.globalAlpha = .35; g.fillRect(Math.min(x0, x1), Math.min(y0, y1), Math.abs(x1 - x0), Math.abs(y1 - y0)); }
  else if (s.t === 'arrow') { const a = Math.atan2(y1 - y0, x1 - x0), hl = lw * 4; g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke();
    g.beginPath(); g.moveTo(x1, y1); g.lineTo(x1 - hl * Math.cos(a - .45), y1 - hl * Math.sin(a - .45)); g.moveTo(x1, y1); g.lineTo(x1 - hl * Math.cos(a + .45), y1 - hl * Math.sin(a + .45)); g.stroke(); }
  else if (s.t === 'pen') { g.beginPath(); s.pts.forEach((v, i) => { if (i % 2) return; if (i) g.lineTo(v, s.pts[i + 1]); else g.moveTo(v, s.pts[i + 1]); }); g.stroke(); }
  else if (s.t === 'text') { const fs = Math.max(16, Math.round(c.width / 28)); g.font = `700 ${fs}px "Segoe UI", system-ui, sans-serif`; const w = g.measureText(s.s).width;
    g.fillRect(x0 - fs * .2, y0 - fs * 1.05, w + fs * .4, fs * 1.35); g.fillStyle = '#fff'; g.fillText(s.s, x0, y0); }
  else if (s.t === 'crop') { g.strokeStyle = '#fff'; g.setLineDash([lw * 2, lw * 2]); g.strokeRect(Math.min(x0, x1), Math.min(y0, y1), Math.abs(x1 - x0), Math.abs(y1 - y0)); }
  g.restore();
}
function phePaint() {
  const ed = PHE.ed, cv = app.querySelector('.phe-ed canvas'); if (!ed || !cv) return;
  if (cv.width !== ed.base.width || cv.height !== ed.base.height) { cv.width = ed.base.width; cv.height = ed.base.height; }
  if (ed.zoom == null) { cv.style.width = cv.style.height = '0px'; }   // measured with no scrollbars: Fit never needs them
  const z = pheScale(), st = cv.parentElement; cv.style.width = Math.round(ed.base.width * z) + 'px'; cv.style.height = Math.round(ed.base.height * z) + 'px';   // QC 99: fitted, or zoomed
  const zl = app.querySelector('.phe-ed .phe-zl'); if (zl) zl.textContent = Math.round(z * 100) + '%';
  if (ed.scroll && !ed.drag) { st.scrollLeft = ed.scroll[0]; st.scrollTop = ed.scroll[1]; }   // a re-render keeps the place in a zoomed photo
  const g = cv.getContext('2d'); g.clearRect(0, 0, cv.width, cv.height); g.drawImage(ed.base, 0, 0); ed.shapes.forEach(s => pheShape(g, s, cv)); if (ed.drag?.shape) pheShape(g, ed.drag.shape, cv);
}
// QC 99: the zoom. null = Fit (the whole picture in the stage, never above 100%); a number = that scale, the stage scrolls
const PHE_ZOOMS = [.1, .25, .33, .5, .67, .75, 1, 1.5, 2, 3, 4];
function pheFit() {
  const ed = PHE.ed, st = app.querySelector('.phe-ed .phe-stage'); if (!ed || !st) return 1;
  const cs = getComputedStyle(st), aw = st.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight), ah = st.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
  return Math.max(.02, Math.min(1, aw / ed.base.width, ah / ed.base.height));
}
const pheScale = () => PHE.ed?.zoom ?? pheFit();
function pheZoom(how) {
  const ed = PHE.ed, z = pheScale();
  ed.zoom = how === 'fit' ? null : how === '100' ? 1 : how === 'in' ? (PHE_ZOOMS.find(v => v > z + .001) ?? 4) : ([...PHE_ZOOMS].reverse().find(v => v < z - .001) ?? .1);
  if (ed.zoom != null && Math.abs(ed.zoom - pheFit()) < .001) ed.zoom = null;
  ed.typing = null; renderAll();
}
function pheEdHtml() {
  const ed = PHE.ed, name = pheCopyName(ed.file);
  const tool = ([k, icon, label]) => `<button class="icon-btn icon-btn--sm phe-tool" data-phe-tool="${k}" aria-label="${label}" data-tip="${label}"${['crop', 'arrow', 'box', 'hl', 'text', 'pen'].includes(k) ? ` aria-pressed="${ed.tool === k}"` : ''}>${ic(icon)}</button>`;
  const zb = (k, icon, label) => `<button class="icon-btn icon-btn--sm" data-phe-zoom="${k}" aria-label="${label}" data-tip="${label}"${k === 'fit' ? ` aria-pressed="${ed.zoom == null}"` : ''}>${ic(icon)}</button>`;
  return `<div class="modal-backdrop phe-back"><div class="modal card phe-ed" data-size="wide" role="dialog" aria-modal="true" aria-labelledby="phe-t"><div class="modal-head"><h2 class="modal-title truncate" id="phe-t">Mark up “${esc(attBase(ed.file))}”</h2><button class="icon-btn icon-btn--sm" data-phe-ed="cancel" aria-label="Cancel: nothing is saved" data-tip="Cancel (Esc)">${ic('x')}</button></div>
    <div class="modal-body phe-ed-body"><div class="phe-tools" role="toolbar" aria-label="Tools" aria-orientation="horizontal">${PHE_TOOLS.slice(0, 3).map(tool).join('')}<span class="ph-sep phe-sep"></span>${PHE_TOOLS.slice(3).map(tool).join('')}<span class="ph-sep phe-sep"></span>
      <span class="phe-sw" role="group" aria-label="Colour">${PHE_COLOURS.map(([k, l, c]) => `<button class="phe-swatch" data-phe-colour="${k}" style="--sw:${c || 'var(--accent)'}" aria-label="${l}" data-tip="${l}" aria-pressed="${ed.colour === k}"></button>`).join('')}</span><span class="ph-sep phe-sep"></span>
      <button class="icon-btn icon-btn--sm" data-phe-ed="undo" aria-label="Undo the last change" data-tip="Undo (Ctrl+Z)"${ed.undo.length ? '' : ' disabled'}>${ic('phundo')}</button>
      <span class="phe-grow"></span><span class="phe-zoom" role="group" aria-label="Zoom">${zb('out', 'phzout', 'Zoom out')}<button class="btn btn--ghost btn--sm phe-zl" data-phe-zoom="100" aria-label="Actual size" data-tip="Actual size (100%)">${Math.round(pheScale() * 100)}%</button>${zb('in', 'phzin', 'Zoom in')}${zb('fit', 'phfit', 'Fit the whole photo')}</span></div>
      <div class="phe-stage" tabindex="-1" aria-label="The photo"><canvas class="phe-canvas" aria-label="The photo"></canvas>${ed.typing ? `<input class="field phe-textin" id="phe-textin" style="left:${ed.typing.l}px;top:${ed.typing.t}px" placeholder="Type, then Enter" aria-label="Text on the photo">` : ''}</div></div>
    <div class="modal-foot"><span class="set-desc phe-note">Will be saved as a copy, ${esc(name)}. The original stays as it was.</span><span class="phe-grow"></span><button class="btn btn--secondary" data-phe-ed="cancel">Cancel</button><button class="btn btn--primary" data-phe-ed="save"${ed.changed ? '' : ' disabled'}>Save a copy</button></div></div></div>`;
}
const pheRm0 = renderModal;
renderModal = function () { const h = pheRm0.apply(this, arguments); return PHE.ed ? h + pheEdHtml() : h; };   // eslint-disable-line no-global-assign
const pheAfter0 = afterRender;
afterRender = function () { pheAfter0.apply(this, arguments); if (PHE.ed) { phePaint(); if (PHE.ed.typing) document.getElementById('phe-textin')?.focus(); } };   // eslint-disable-line no-global-assign
const phePt = (cv, e) => { const r = cv.getBoundingClientRect(); return [(e.clientX - r.left) / r.width * cv.width, (e.clientY - r.top) / r.height * cv.height]; };
function pheClose(msg) { PHE.ed = null; S.focus = null; renderAll(); if (msg) status(msg); }
async function pheEdSave() {
  const ed = PHE.ed; if (!ed?.changed) return; const flat = pheFlat(), { doc, file } = ed; PHE.ed = null; renderAll();
  await pheSave(doc, file, flat, 'markup');
}
function pheGeom(op) {   // rotate / flip in the window: the shapes are drawn in first, then the whole picture turns
  const ed = PHE.ed; pheSnap(); ed.base = pheCanvas(pheFlat(), op); ed.shapes = [];
}
document.addEventListener('mousedown', e => {
  const ed = PHE.ed, cv = e.target.closest?.('.phe-ed canvas'); if (!ed || !cv || e.button !== 0) return;
  e.preventDefault(); const [x, y] = phePt(cv, e);
  if (ed.tool === 'text') { const st = cv.parentElement.getBoundingClientRect(), z = typeof cbZ === 'function' ? cbZ() : 1; const sp = cv.parentElement; ed.typing = { x, y, l: (e.clientX - st.left) / z + sp.scrollLeft, t: (e.clientY - st.top) / z - 14 + sp.scrollTop }; renderAll(); return; }
  const shape = { t: ed.tool, colour: pheColour(ed.colour), pts: ed.tool === 'pen' ? [x, y] : [x, y, x, y] }; ed.drag = { shape };
  const mv = ev => { const [a, b] = phePt(cv, ev); if (shape.t === 'pen') shape.pts.push(a, b); else { shape.pts[2] = a; shape.pts[3] = b; } phePaint(); };
  const up = () => { document.removeEventListener('mousemove', mv, true); document.removeEventListener('mouseup', up, true); ed.drag = null;
    const [x0, y0, x1, y1] = shape.pts, big = shape.t === 'pen' ? shape.pts.length > 4 : Math.abs(x1 - x0) > 4 || Math.abs(y1 - y0) > 4;
    if (!big) { phePaint(); return; }
    pheSnap();
    if (shape.t === 'crop') { const flat = pheFlat(), W = flat.width, H = flat.height, r = [Math.min(x0, x1) / W * 100, Math.min(y0, y1) / H * 100, Math.max(x0, x1) / W * 100, Math.max(y0, y1) / H * 100];
      ed.base = pheCanvas(flat, 'crop', r); ed.shapes = []; status('Cropped · Undo puts it back'); }
    else ed.shapes.push(shape);
    renderAll(); };
  document.addEventListener('mousemove', mv, true); document.addEventListener('mouseup', up, true);
}, true);
document.addEventListener('click', e => {
  const ed = PHE.ed; if (!ed) return; const t = e.target.closest?.('[data-phe-tool], [data-phe-colour], [data-phe-ed], [data-phe-zoom]'); if (!t || !t.closest('.phe-ed')) return;
  e.preventDefault(); e.stopImmediatePropagation();
  if (t.dataset.pheZoom) { pheZoom(t.dataset.pheZoom); return; }
  if (t.dataset.pheTool) { const k = t.dataset.pheTool; if (k === 'rotate' || k === 'flip') { pheGeom(k); status(k === 'rotate' ? 'Rotated a quarter turn right' : 'Flipped'); } else ed.tool = k; ed.typing = null; renderAll(); return; }
  if (t.dataset.pheColour) { ed.colour = t.dataset.pheColour; renderAll(); return; }
  const a = t.dataset.pheEd;
  if (a === 'cancel') { pheClose('Nothing was saved'); return; }
  if (a === 'undo') { const u = ed.undo.pop(); if (u) { ed.base = u.base; ed.shapes = u.shapes; ed.changed = ed.undo.length > 0; } renderAll(); return; }
  if (a === 'save') pheEdSave();
}, true);
document.addEventListener('keydown', e => {
  const ed = PHE.ed; if (!ed) return;
  if (e.target.id === 'phe-textin') {
    if (e.key === 'Enter') { e.preventDefault(); e.stopImmediatePropagation(); const s = e.target.value.trim(); if (s) { pheSnap(); ed.shapes.push({ t: 'text', colour: pheColour(ed.colour), pts: [ed.typing.x, ed.typing.y], s }); } ed.typing = null; renderAll(); return; }
    if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); ed.typing = null; renderAll(); return; }
    return; }
  if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); pheClose('Nothing was saved'); return; }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); e.stopImmediatePropagation(); app.querySelector('.phe-ed [data-phe-ed="undo"]')?.click(); }
}, true);
document.addEventListener('scroll', e => { if (PHE.ed && e.target.classList?.contains('phe-stage')) PHE.ed.scroll = [e.target.scrollLeft, e.target.scrollTop]; }, true);
document.addEventListener('wheel', e => {   // Ctrl + the wheel over the photo zooms
  if (!PHE.ed || !(e.ctrlKey || e.metaKey) || !e.target.closest?.('.phe-ed .phe-stage')) return; e.preventDefault(); e.stopImmediatePropagation(); pheZoom(e.deltaY < 0 ? 'in' : 'out');
}, { capture: true, passive: false });
addEventListener('resize', () => { if (PHE.ed) phePaint(); });
/* ---- end Build V · the mark-up window ---- */
