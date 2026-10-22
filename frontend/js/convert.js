/* NeuroVault · Build K: PDF and Word files to Markdown notes (api.py's Build K block, converters.py).
   Ctrl+K → "Convert PDF to Markdown": the Open dialog for a PDF or .docx, then the conversion runs in the background
   (convert_file, polled through convert_job) with "Page N of M" in the status bar, and the new note opens when it's done.
   convertStart(path, mode, folderId) is the one call the R47 drop question needs too: mode 'new_note' or 'into_note:<id>'.
   The drop question, its "Always do this" and the Settings card are mockup R47's, not built here. */
const CONV = { job: null, name: '' };
PAL_COMMANDS.forEach(c => { if (c[2] === 'pdfin') c.length = 4; });   // built now: no "Coming soon"
const convLive = () => !!api() && VAULT.live;
function convStatus(msg) {   // the status bar's message, kept up to date without redrawing the page
  S.status = msg; clearTimeout(status.t);
  const el = document.querySelector('.app .status-save'), tx = document.getElementById('status-text');
  if (el && tx) { el.hidden = false; tx.textContent = msg; }
}
async function convertPick() {
  if (!convLive()) { toast('Converting needs the app with your vault open'); return; }
  if (CONV.job) { toast(`Still converting ${CONV.name}`); return; }
  let path = null;
  try { path = await api().browse_convert_file(); } catch (e) { console.warn('browse_convert_file', e); }
  if (path) convertStart(path, 'new_note');
}
async function convertStart(path, mode = 'new_note', folderId = null) {
  const name = String(path).split(/[\\/]/).pop();
  const r = await nv('convert_file', path, mode, folderId);
  if (failed(r)) { toast(r.message || `Couldn't convert ${name}`); return null; }
  CONV.job = r.job; CONV.name = name; convStatus(`Converting ${name}…`);
  let j;
  for (;;) {
    await new Promise(res => setTimeout(res, 400));
    j = await nv('convert_job', r.job);
    if (failed(j)) break;
    if (j.state !== 'running') break;
    convStatus(`Converting ${name}${j.total > 1 ? ` · ${j.label}` : '…'}`);
  }
  CONV.job = null; status.clear();
  if (failed(j) || j.state !== 'done') { toast(j?.message || `Couldn't convert ${name}`); renderAll(); return j; }
  const res = j.result;
  if (!res.note_id) { toast(res.warnings[0] || `${name} has no text to convert`); renderAll(); return j; }
  const row = await nv('get_note', res.note_id);
  if (!row || failed(row)) { toast(`Converted ${name}, but the note didn't load`); return j; }
  const fresh = mapNote(row), old = D.notes.find(n => n.id === fresh.id);
  if (old) { Object.assign(old, { md: fresh.md, mtime: fresh.mtime, html: null }); syncLineTasks(old); }   // into a note: its new "- [ ]" lines become tasks
  else { D.notes.unshift(fresh); primeOne(fresh); }
  openNote(fresh.id);
  status(res.warnings.length ? `Converted ${name} · ${res.warnings[0]}` : `Converted ${name}${res.images.length ? ` · ${res.images.length} image${res.images.length > 1 ? 's' : ''}` : ''}`);
  renderAll();
  return j;
}
document.getElementById('app').addEventListener('click', e => {   // actions.js ignores this data-act name
  if (e.target.closest('[data-soon]')) return;
  if (e.target.closest('[data-act]')?.dataset.act === 'pdfin') convertPick();
});
