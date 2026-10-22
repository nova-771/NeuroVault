/* NeuroVault · Build O: mockup R47 and R47b in the app (design/design-profile.md: §2 one place, §3 one of each, §5 visible, §8 calm).
   1 Names: Brain Dump and Sticky Notes everywhere you read them (Fix C did most of it, QC 20); the files keep _inbox.md and stickynoted/.
   2 Lists: a click on the Brain Dump or Sticky Notes row shows its list in the main pane, never the capture bar (R47's default look,
     "pane": nothing was locked). The R46 tools row (filter, add, search), each item with its time and colour, one action and ⋮.
     Capturing stays on the window bar's button and Ctrl+Shift+D.
   3 Dropping files: an overlay says what will happen and a line shows where. Images and other files go in at the line, copied into
     attachments/. A PDF or Word file asks one question (R41: [Cancel] … the main button last, "Always do this and don't ask"), unless
     Settings → Vault & files says what to do (drop_office_default). Converting (Build K's convert_file) shows a pill with the page
     count and Cancel; the new note opens with the Attachments tab, where its images and table CSVs are outlined.
   pywebview gives a dropped file's full path only to Python (main.py → api.files_dropped); the page asks api.drop_paths for it, and
   sends the bytes (api.drop_upload) when there's no path. Loaded last: it wraps viewNotes, treeActivate, renderModal and afterRender. */
'use strict';
Object.assign(ICON, {   // Lucide outline, as the rest
  upload: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m17 8-5-5-5 5"/><path d="M12 3v12"/>',
  noteplus: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M12 18v-6M9 15h6"/>',
  taskplus: '<path d="M11 12H3M16 6H3M16 18H3M18 9v6M21 12h-6"/>',
  movein: '<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6M8 15h7M12.5 12.5 15 15l-2.5 2.5"/>' });

/* ======================================================================= 2 · the lists */
const LD_NAME = { inbox: 'Brain Dump', stickies: 'Sticky Notes' };
const LD_SUB = { inbox: 'Thoughts you captured. Tick them off, or move them into a note or a task.', stickies: 'Every sticky you made, open or closed. Show one, pop it out, or turn it into a note or a task.' };
const LD = { list: null, q: { inbox: '', stickies: '' }, f: { inbox: 'All', stickies: 'All' }, menu: null, pop: null, add: '', done: [], doneFor: null };
const ldMain = () => !!LD.list && UI.view === 'notes';
const LD_MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function ldDay(key) {   // "Today", "Yesterday", "Wed 15 Oct"
  if (!key || key === todayKey()) return 'Today';
  const [y, m, d] = key.split('-').map(Number), dt = new Date(y, m - 1, d), yd = new Date(); yd.setDate(yd.getDate() - 1);
  if (dt.toDateString() === yd.toDateString()) return 'Yesterday';
  return `${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][dt.getDay()]} ${d} ${LD_MON[m - 1]}`;
}
const ldWhen = s => { const m = (s.file || '').match(/(\d{4})-(\d{2})-(\d{2})-(\d{2})(\d{2})/); return m ? `${+m[3]} ${LD_MON[+m[2] - 1]} · ${m[4]}:${m[5]}` : ''; };
// Every thought: the open ones (D.inbox, as the capture bar has them) and the ticked-off ones (asked for when the list opens)
function ldThoughts() {
  D.inbox.forEach((x, i) => { if (x && !x.id) x.id = 'in-s' + (i + 1); });   // the sample vault's thoughts have no ids
  const seen = new Set(), all = [...D.inbox, ...LD.done].filter(x => x && !seen.has(x.id) && seen.add(x.id));
  const key = x => (x.day || todayKey()) + ' ' + (x.t || '');
  return all.sort((a, b) => key(b).localeCompare(key(a)) || String(b.id).localeCompare(String(a.id), undefined, { numeric: true }));
}
const ldShown = k => k === 'inbox' ? ldThoughts().filter(x => LD.f.inbox === 'All' || (LD.f.inbox === 'Done') === !!x.done)
  : D.stickies.filter(s => LD.f.stickies === 'All' || s.color === LD.f.stickies.toLowerCase()).slice().sort((a, b) => b.n - a.n);
async function ldLoadDone() {   // the ticked-off thoughts aren't in D.inbox (list_inbox leaves them out)
  if (!CAPTURE.live || LD.doneFor === 'live') return;
  const r = await nv('list_inbox', true); if (!Array.isArray(r)) return;
  LD.done = r.filter(x => x.done).map(mapInbox); LD.doneFor = 'live'; if (ldMain()) renderAll();
}
const ldMore = (key, label) => `<button class="icon-btn icon-btn--sm ld-more" data-act="ld-menu" data-v="${esc(key)}" aria-haspopup="menu" aria-expanded="${LD.menu === key}" aria-label="More for ${esc(label)}" title="More">${ic('more')}</button>`;
function ldStickyRow(s) {
  const state = s.out ? 'popped out' : s.open ? 'on screen' : 'closed', when = ldWhen(s);
  return `<div class="ld-item" data-ld-item="st:${s.id}" data-ld-text="${esc((s.text || '').toLowerCase())}"><span class="ld-swatch dot-${s.color}" aria-hidden="true"></span><div class="ld-main"><span class="ld-text">${esc(s.text.trim() || 'Empty sticky')}</span><span class="ld-meta">Sticky #${s.n}${when ? ' · ' + when : ''} · ${state}</span></div>
    <button class="btn btn--secondary btn--sm" data-act="ld-open" data-v="${s.id}">${s.open || s.out ? 'Show' : 'Reopen'}</button>${ldMore('st:' + s.id, 'Sticky #' + s.n)}</div>`;
}
function ldThoughtRow(x) {
  const n = x.taskIds?.length || 0;
  return `<div class="ld-item${x.done ? ' is-done' : ''}" data-ld-item="in:${x.id}" data-ld-text="${esc((x.text || '').toLowerCase())}"><input type="checkbox" class="ld-check" data-ld-done="${x.id}" ${x.done ? 'checked' : ''} aria-label="Done: ${esc(x.text || 'voice thought')}"><div class="ld-main"><span class="ld-text">${x.audio ? ic('mic') : ''}${esc(x.text || 'Voice thought')}</span><span class="ld-meta">${ldDay(x.day)} · ${esc(x.t || '')}${n ? ` · ${n} task${n === 1 ? '' : 's'} made` : ''}</span></div>${ldMore('in:' + x.id, 'this thought')}</div>`;
}
function ldEmpty(k) {
  return k === 'stickies' ? `<div class="empty empty--compact ld-empty" role="status"><div class="empty-text">No sticky notes yet. New ones land here, even after you close them.</div><button class="btn btn--secondary" data-act="sticky-new">${ic('sticky')}New sticky note</button></div>`
    : `<div class="empty empty--compact ld-empty" role="status"><div class="empty-text">Nothing in Brain Dump. Thoughts you capture with Ctrl+Shift+D land here, to sort out later.</div></div>`;
}
function ldBody(k) {
  if (k === 'stickies') return D.stickies.length ? `<div class="ld-list" data-ld-k="stickies">${ldShown(k).map(ldStickyRow).join('')}</div>` : ldEmpty(k);
  const add = `<label class="field-search ld-addrow">${ic('plus')}<input class="field" id="ld-add" data-ld-add placeholder="Add a thought: Enter saves it here" aria-label="Add a thought to Brain Dump" value="${esc(LD.add)}" autocomplete="off"></label>`;
  return add + (ldThoughts().length ? `<div class="ld-list" data-ld-k="inbox">${ldShown(k).map(ldThoughtRow).join('')}</div>` : ldEmpty(k));
}
function ldTools(k) {
  const on = LD.f[k] !== 'All';
  return `<div class="side-actions ld-tools" role="toolbar" aria-label="${LD_NAME[k]} tools">
    <button class="icon-btn icon-btn--sm bm-fbtn" data-act="ld-filter" aria-haspopup="dialog" aria-expanded="${LD.pop === 'filter'}" aria-label="Filter ${LD_NAME[k]}${on ? ', 1 on' : ''}" title="Filter${on ? ' · 1 on' : ''}">${ic('filter')}${on ? '<span class="bm-badge num" aria-hidden="true">1</span>' : ''}</button>
    <button class="icon-btn icon-btn--sm" data-act="ld-new" data-v="${k}" aria-label="${k === 'stickies' ? 'New sticky note' : 'Add a thought'}" title="${k === 'stickies' ? 'New sticky note' : 'Add a thought'}">${ic('plus')}</button>
    <label class="field-search">${ic('search')}<input class="field" id="ld-q" data-ld-q type="search" placeholder="Search ${LD_NAME[k]}…" aria-label="Search ${LD_NAME[k]}" value="${esc(LD.q[k])}" autocomplete="off"></label></div>`;
}
const ldSeg = k => `<div class="seg ld-seg" role="group" aria-label="Which list">${['stickies', 'inbox'].map(x => `<button class="seg-opt" data-act="ld-list" data-v="${x}" aria-pressed="${k === x}">${LD_NAME[x]} <span class="num ld-n">${x === 'inbox' ? D.inbox.length : D.stickies.length}</span></button>`).join('')}</div>`;
function ldPage() {
  const k = LD.list;
  return `<section class="view ld-view" id="main-view-list"><div class="view-inner ld-inner"><div class="ld-page" data-ld-page="${k}">
    <div class="ld-head">${ldSeg(k)}<span class="ld-spacer"></span><button class="icon-btn" data-act="ld-close" aria-label="Close the list" title="Close (Esc): back to your note">${ic('x')}</button></div>
    <div><h2 class="view-title">${LD_NAME[k]}</h2><p class="list-item-sub ld-sub">${LD_SUB[k]}</p></div>${ldTools(k)}${ldBody(k)}</div></div></section>`;
}
function ldShow(k) {   // a click on the sidebar row: the list, never the capture bar
  if (S.modal === 'dump') closeModal(true);
  LD.list = k; LD.menu = null; LD.pop = null; S.menu = false;
  if (k === 'inbox') ldLoadDone();
  S.focus = { sel: '#ld-q' };
  if (UI.view !== 'notes') setUI('view', 'notes'); else renderAll();
}
function ldClose() { const k = LD.list; LD.list = null; LD.menu = null; LD.pop = null; S.focus = { sel: `[data-tree="${k || 'inbox'}"]` }; renderAll(); }
{ const ta0 = treeActivate; treeActivate = function (kind, id) {   // eslint-disable-line no-global-assign
  if (kind === 'inbox' || kind === 'stickies') { S.sel = { kind, id }; S.ctx = null; ldShow(kind); return; }
  return ta0.apply(this, arguments); }; }
{ const on0 = openNote; openNote = function () { LD.list = null; LD.menu = null; LD.pop = null; return on0.apply(this, arguments); }; }   // eslint-disable-line no-global-assign
{ const at0 = activateTab; activateTab = function () { LD.list = null; return at0.apply(this, arguments); }; }   // eslint-disable-line no-global-assign
{ const vn0 = viewNotes; viewNotes = function () { return ldMain() ? ldPage() : vn0.apply(this, arguments); }; }   // eslint-disable-line no-global-assign

/* ---- the item menu and the filter popover (Build L: under their button, a click away closes them) ---- */
function ldMenuHtml() {
  const key = LD.menu; if (!key || S.modal || !ldMain()) return ''; const t = key.split(':')[0], id = key.slice(key.indexOf(':') + 1), n = D.notes.find(x => x.id === S.noteId);
  const item = (act, icon, label, extra = '') => `<button class="menu-item" role="menuitem" data-act="${act}" data-v="${esc(key)}"${extra}>${ic(icon)}<span>${label}</span></button>`;
  if (t === 'st') { const s = stickyById(id); if (!s) return '';
    return `<div class="menu card ld-menu" role="menu" aria-label="Sticky #${s.n}">${s.out ? '' : item('ld-pop', 'popout', 'Pop out, on top of other apps')}${item('ld-note', 'noteplus', 'Make it a note')}${item('ld-task', 'taskplus', 'Make it a task')}<div class="menu-sep"></div>${item('ld-del', 'trash', 'Delete', ' data-danger')}</div>`; }
  const x = ldThoughts().find(y => y.id === id); if (!x) return '';
  return `<div class="menu card ld-menu" role="menu" aria-label="This thought">${n ? item('ld-move', 'movein', `Move to “${esc(n.title)}”`) : ''}${item('ld-move-new', 'noteplus', 'Move to a new note')}${item('ld-task', 'taskplus', 'Make it a task')}${item('ld-tick', 'ok', x.done ? 'Not done yet' : 'Mark done')}<div class="menu-sep"></div>${item('ld-del', 'trash', 'Delete', ' data-danger')}</div>`;
}
function ldFilterHtml() {
  if (LD.pop !== 'filter' || S.modal || !ldMain()) return ''; const k = LD.list, cur = LD.f[k];
  const opts = k === 'inbox' ? ['All', 'Open', 'Done'] : ['All', 'Yellow', 'Pink', 'Mint', 'Blue', 'Lilac'];
  return `<div class="popover card bm-pop ld-filter" role="dialog" aria-labelledby="ld-f-t"><div class="bm-pop-head"><span class="bm-pop-title" id="ld-f-t">Filter ${LD_NAME[k]}</span><button class="icon-btn icon-btn--sm" data-act="ld-pop-x" aria-label="Close" title="Close (Esc)">${ic('x')}</button></div>
    <div class="bm-fgroup" role="group" aria-labelledby="ld-fl"><span class="bm-flabel" id="ld-fl">${k === 'inbox' ? 'Show' : 'Colour'}</span><div class="bm-chips">${opts.map(o => `<button class="bm-chip" data-act="ld-f" data-v="${o}" aria-pressed="${o === cur}">${k === 'stickies' && o !== 'All' ? `<span class="ld-swatch dot-${o.toLowerCase()}" aria-hidden="true"></span>` : ''}${o}</button>`).join('')}</div></div></div>`;
}
POPOVERS.push({ id: 'ld-menu', on: () => LD.menu, off: () => { LD.menu = null; }, el: '.ld-menu', btn: '[data-act="ld-menu"][aria-expanded="true"]', menu: true },
  { id: 'ld-filter', on: () => LD.pop, off: () => { LD.pop = null; }, el: '.ld-filter', btn: '[data-act="ld-filter"]' });
// Search as you type: the list shrinks without a redraw (R46)
function ldApply() {
  app.querySelector('.ld-none')?.remove();
  const pg = app.querySelector('[data-ld-page]'); if (!pg) return; const k = pg.dataset.ldPage, q = (LD.q[k] || '').trim().toLowerCase();
  const items = [...pg.querySelectorAll('[data-ld-item]')]; let shown = 0;
  items.forEach(it => { const ok = !q || it.dataset.ldText.includes(q); it.hidden = !ok; if (ok) shown++; });
  const all = k === 'inbox' ? ldThoughts().length : D.stickies.length, list = pg.querySelector('.ld-list');
  if (items.length && !shown) list?.insertAdjacentHTML('afterend', `<div class="empty empty--compact ld-none" role="status"><div class="empty-text">Nothing in ${LD_NAME[k]} matches “${esc(q)}”.</div><button class="btn btn--secondary" data-act="ld-clear">Clear the search</button></div>`);
  else if (!items.length && all && LD.f[k] !== 'All') list?.insertAdjacentHTML('afterend', `<div class="empty empty--compact ld-none" role="status"><div class="empty-text">Nothing ${k === 'inbox' ? LD.f[k].toLowerCase() : 'in ' + LD.f[k].toLowerCase()} in ${LD_NAME[k]}.</div><button class="btn btn--secondary" data-act="ld-clear">Show all</button></div>`);
}

/* ---- what the items do ---- */
const ldThought = id => ldThoughts().find(x => x.id === id);
async function ldTick(x, done) {   // ticked off: it stays in the list, greyed (R47's default answer), and leaves the capture bar's today
  if (!x || !!x.done === done) return;
  const r = await capCall('update_inbox_item', rawId(x.id), null, done);
  if (failed(r)) { toast(r.message || "Couldn't change the thought"); renderAll(); return false; }
  x.done = done;
  if (done) { D.inbox = D.inbox.filter(y => y !== x); if (!LD.done.includes(x)) LD.done.push(x); }
  else { LD.done = LD.done.filter(y => y !== x); if (!D.inbox.includes(x)) D.inbox.push(x); }
  return true;
}
async function ldAddThought(input) {
  const text = input.value.replace(/\s+/g, ' ').trim(); if (!text) return;
  input.value = LD.add = '';
  if (CAPTURE.live) { const r = await nv('add_inbox_item', text); if (failed(r)) { LD.add = text; toast(r.message || "Couldn't save to Brain Dump"); renderAll(); return; } D.inbox.push(mapInbox(r.item)); }
  else { const d = new Date(); D.inbox.push({ id: 'in-' + Date.now(), t: clock(d), day: todayKey(), text, done: false }); }
  status('Added to Brain Dump'); S.focus = { sel: '#ld-add' }; renderAll();
}
function ldDelete(key) {   // Build L: no confirm, Undo for 10 seconds
  const [t] = key.split(':'), id = key.slice(key.indexOf(':') + 1);
  if (t === 'st') { const s = stickyById(id); if (!s) return; const i = D.stickies.indexOf(s);
    hold({ msg: `Deleted sticky #${s.n}`, back: `Sticky #${s.n} is back`, apply() { forgetSticky(s); }, undo() { D.stickies.splice(Math.min(i, D.stickies.length), 0, s); },
      commit: () => capCall('delete_sticky', rawId(s.id)).then(r => stickyGone(r) ? { status: 'success' } : r) }); return; }
  const x = ldThought(id); if (!x) return; const inOpen = D.inbox.includes(x);
  hold({ msg: 'Deleted the thought', back: 'The thought is back', apply() { D.inbox = D.inbox.filter(y => y !== x); LD.done = LD.done.filter(y => y !== x); },
    undo() { (inOpen ? D.inbox : LD.done).push(x); }, commit: () => capCall('delete_inbox_item', rawId(x.id)) });
}
// A thought into the open note, a new note or a task: it's ticked off (kept, greyed), so nothing is lost and a tick brings it back
async function ldMove(x, where) {
  if (!x) return; const text = x.text || '';
  if (where === 'note') { const n = D.notes.find(y => y.id === S.noteId); if (!n) return; syncDoc(n);
    n.md = n.md.replace(/\s*$/, '') + `\n\n${text}\n`; n.html = null; n.dirty = true; const r = await saveNote(n);
    if (failed(r)) { toast(r.message || "Couldn't save the note"); return; }
    await ldTick(x, true); status(`Moved to “${n.title}” · the thought is ticked off`); renderAll(); return; }
  if (where === 'new') { const folder = targetFolder(); if (!folder && !vaultRoot()) { toast('Create a project folder first'); return; }
    const n = await ldNewNote(text, folder); if (!n) return; await ldTick(x, true);
    ancestors(n.folder).forEach(f => S.open.add(f)); status(`Moved to a new note, “${n.title}” · the thought is ticked off`); renderAll(); return; }
  const n = D.notes.find(y => y.id === S.noteId), pj = (n && rootProject(n.folder)) || D.projects[0] || null;
  const tk = await addTask({ title: text.slice(0, 120) || 'Brain Dump thought', project: pj?.id || null, noteId: null, priority: 'Medium', energy: 'medium' }); if (!tk) return;
  await ldTick(x, true); toast('Task added · the thought is ticked off');
}
async function ldNewNote(text, folder, name) {   // as noteFromSticky (capture.js), without its "sticky" tag
  const title = uniqueName(cleanName(name || stickyTitle({ text })) || 'Brain Dump thought', folder, 'note');
  let id = 'note-' + Date.now(), home = folder, mtime = iso(new Date()), ctime = mtime;
  if (VAULT.live) { const [f, p] = placeArgs(folder); const r = await nv('save_note', null, title, text, rootProject(folder)?.name || '', p, '', f);
    if (failed(r)) { toast(r.message || "Couldn't make the note."); return null; } id = 'n-' + r.id; home = homeOf(r) || folder; mtime = ctime = r.updated_at; }
  const n = { id, title, category: rootProject(home)?.name || '', oldCategory: '', folder: home, tags: [], md: text, mtime, ctime };
  D.notes.unshift(n); if (VAULT.live) primeOne(n); return n;
}
async function ldStickyTask(s) {   // a plain task (the sticky's own ⋮ has the timed one)
  if (!s) return; await saveStickyText(s);
  const n = D.notes.find(y => y.id === S.noteId), pj = (n && rootProject(n.folder)) || D.projects[0] || null;
  const tk = await addTask({ title: stickyTitle(s, 120) || 'Sticky task', project: pj?.id || null, noteId: null, priority: 'Medium', energy: 'medium', description: /\n/.test(s.text.trim()) ? s.text.trim() : '' });
  if (!tk) return; await dropSticky(s); toast(`Task added · sticky #${s.n} became it`); renderAll();
}

/* ======================================================================= 3 · dropping files */
const DROPO = { def: 'ask', pdf: true, drag: null, at: null, t: 0, ask: null, job: null, result: null, scan: null, undo: null, flash: null };
const DO_IMG = /\.(png|jpe?g|gif|webp|svg|bmp|avif)$/i;
const doKind = name => DO_IMG.test(name) ? 'image' : /\.pdf$/i.test(name) ? 'pdf' : /\.docx$/i.test(name) ? 'docx' : /\.xlsx$/i.test(name) ? 'xlsx' : 'other';   // Build M · R57: workbooks
const DO_DEFS = { ask: ['Ask each time', 'One short question when you drop one', 'help'], convert: ['Convert to a new note', 'A note you can edit; its images and tables go to Attachments too', 'filepdf'],
  attach: ['Attach to this note', 'Kept as a file, where you drop it', 'clip'], attach_new: ['Attach to a new note', 'A new note named after the file holds it', 'noteplus'] };
const doHasFiles = e => [...(e.dataTransfer?.types || [])].includes('Files');
const doSize = b => b == null ? '' : typeof fmtSize === 'function' ? fmtSize(b) : Math.round(b / 1e3) + ' KB';
const doBase = name => cleanName(String(name).replace(/\.[^.]+$/, '')) || 'Dropped file';
// The note a drop goes into: the one you can see and edit (not a list, another view or Raw .md); null means a new note
function doDoc() { if (UI.view !== 'notes' || ldMain()) return null; const d = app.querySelector('#note-body-editor'); return d?.isContentEditable && d.offsetParent ? d : null; }
const doBlocks = doc => [...doc.children].filter(e => e.offsetParent && !e.hasAttribute('data-md-ignore'));
function doAtPoint(y) {   // the line goes after block `at` (-1: above the first)
  const doc = doDoc(); if (!doc) return null; const bs = doBlocks(doc); if (!bs.length) return -1;
  for (let i = 0; i < bs.length; i++) { const r = bs[i].getBoundingClientRect(); if (y < r.top + r.height / 2) return i - 1; }
  return bs.length - 1;
}
function doOverlayText(d) {
  const doc = !!doDoc(), many = d.n > 1, office = d.kind === 'pdf' || d.kind === 'docx' || d.kind === 'xlsx';   // Build M · R57
  if (d.kind === 'md') return [`Drop to open ${many ? 'them as notes' : 'it as a note'}`, 'Copied in as a new note; the file itself stays where it is.'];
  if (office) return [`Drop to add ${many ? 'the files' : `the ${d.kind === 'pdf' ? 'PDF' : d.kind === 'xlsx' ? 'workbook' : 'Word file'}`}`, DROPO.def === 'ask' ? 'NeuroVault asks one question: convert it to a note you can edit, or attach it.'
    : `${DO_DEFS[DROPO.def][0]}${DROPO.def === 'attach' && !doc ? ' (no note is open: a new note)' : ''}, as your setting says (Settings → Vault & files).`];
  if (!doc) return [`Drop to attach ${many ? 'them' : 'it'} to a new note`, 'A new note named after the file holds it.'];
  return d.kind === 'image' ? [`Drop to put ${many ? 'the images' : 'the image'} here`, 'Saved in attachments/ and shown where the line is.'] : [`Drop to attach ${many ? 'the files' : 'the file'}`, 'Saved in attachments/ and linked where the line is.'];
}
function doPaint() {   // the overlay and the line, drawn on top without a redraw (dragover fires many times a second)
  app.querySelectorAll('.do-drop, .do-drop-line').forEach(x => x.remove());
  const d = DROPO.drag; if (!d) return;
  const t = app.querySelector('.main .view') || app.querySelector('.main'); if (!t) return;
  const a = app.getBoundingClientRect(), z = a.width / app.offsetWidth || 1, b = t.getBoundingClientRect(), [title, sub] = doOverlayText(d);
  const doc = doDoc(), bs = doc && DROPO.at != null ? doBlocks(doc) : [], ref = bs.length ? (DROPO.at < 0 ? bs[0] : bs[Math.min(DROPO.at, bs.length - 1)]) : null, r = ref?.getBoundingClientRect();
  const ly = r ? (DROPO.at < 0 ? r.top - 4 : r.bottom + 4) : null, top = ly != null && ly > b.top + b.height / 2;   // the box goes in the half away from the line
  app.insertAdjacentHTML('beforeend', `<div class="do-drop${top ? ' do-drop--top' : ''}" role="status" aria-live="polite" style="left:${((b.left - a.left) / z).toFixed(1)}px;top:${((b.top - a.top) / z).toFixed(1)}px;width:${(b.width / z).toFixed(1)}px;height:${(b.height / z).toFixed(1)}px"><div class="do-drop-box">${ic('upload')}<b>${title}</b><span>${sub}</span></div></div>`);
  if (r) app.insertAdjacentHTML('beforeend', `<div class="do-drop-line" aria-hidden="true" style="left:${((r.left - a.left) / z).toFixed(1)}px;top:${((ly - a.top) / z).toFixed(1)}px;width:${(r.width / z).toFixed(1)}px"></div>`);
}
function doEnd() { DROPO.drag = null; clearTimeout(DROPO.t); doPaint(); }
if (!POP) {   // Build H: a popped-out sticky or timer takes no files
  // Capture phase on the document, so nothing in the page (the editor least of all) takes the file, and WebView2 never opens it in
  // place of NeuroVault. No stopPropagation: pywebview's own document listener (main.py) must see the drop to pass the paths
  document.addEventListener('dragover', e => {
    if (!doHasFiles(e)) return; e.preventDefault();
    const busy = S.modal && S.modal !== 'dump'; e.dataTransfer.dropEffect = busy ? 'none' : 'copy'; if (busy) return;
    const items = [...(e.dataTransfer.items || [])], ty = items[0]?.type || '', kind = /^image\//.test(ty) ? 'image' : /pdf/.test(ty) ? 'pdf' : /spreadsheetml|ms-excel/.test(ty) ? 'xlsx' : /word|officedocument/.test(ty) ? 'docx' : /markdown|^text\/plain/.test(ty) ? 'md' : 'other';   // QC 48: text/markdown, text/plain
    const at = doAtPoint(e.clientY), d = DROPO.drag;
    clearTimeout(DROPO.t); DROPO.t = setTimeout(doEnd, 250);   // no dragover for a moment: the file left the window
    if (!d || d.kind !== kind || d.n !== items.length || DROPO.at !== at || !app.querySelector('.do-drop')) { DROPO.drag = { kind, n: items.length }; DROPO.at = at; doPaint(); }
  }, true);
  document.addEventListener('dragleave', e => { if (doHasFiles(e) && !e.relatedTarget) doEnd(); }, true);
  document.addEventListener('drop', e => {
    if (!doHasFiles(e)) return; e.preventDefault(); const at = doAtPoint(e.clientY); doEnd();
    if (S.modal && S.modal !== 'dump') { status('Close the dialog first, then drop the file again'); return; }
    const files = [...e.dataTransfer.files]; if (files.length) doDropped(files, at);
  }, true);
}
// Each dropped file as a path the backend can read: the window's (main.py), else its bytes sent over (the dev bridge, or no match)
async function doPaths(files) {
  const names = files.map(f => f.name), out = {};
  for (let i = 0; i < (window.__devBridge ? 1 : 12) && names.some(n => !out[n]); i++) {   // the window's message comes a moment after the drop
    if (i) await new Promise(r => setTimeout(r, 80));
    Object.assign(out, await nv('drop_paths', names.filter(n => !out[n])) || {});
  }
  for (const f of files) {
    if (out[f.name] || typeof f.arrayBuffer !== 'function') continue;
    const url = await new Promise(res => { const rd = new FileReader(); rd.onload = () => res(rd.result); rd.onerror = () => res(null); rd.readAsDataURL(f); });
    const r = url && await nv('drop_upload', f.name, url); if (r && !failed(r)) out[f.name] = r.path;
  }
  return out;
}
async function doDropped(files, at) {
  if (!realData()) { toast('Dropping files needs the app with your vault open'); return; }
  if (S.modal === 'dump') closeModal(true);
  const doc = doDoc(), noteId = doc?.dataset.note || null, paths = await doPaths(files);
  const list = files.map(f => ({ name: f.name, size: f.size, kind: doKind(f.name), path: paths[f.name] }));
  list.filter(f => !f.path).forEach(f => toast(`Couldn't read “${f.name}”`));
  const ok = list.filter(f => f.path), office = ok.filter(f => f.kind === 'pdf' || f.kind === 'docx' || f.kind === 'xlsx'), mds = ok.filter(f => DO_MD.test(f.name)), rest = ok.filter(f => !office.includes(f) && !mds.includes(f));
  if (mds.length) await mdDropped(mds, noteId, at);   // QC 48: a .md opens as a note ("Attach instead" for 10 seconds)
  if (rest.length) await doAttach(rest, noteId, at);
  if (!office.length) return;
  const how = DROPO.def;
  if (how === 'ask') { DROPO.ask = { files: office, noteId, at }; S.modal = 'do-ask'; S.focus = { sel: '.do-ask .modal-foot .btn:last-child' }; renderAll(); return; }
  await doOffice(office, how, noteId, at);
}
async function doOffice(files, how, noteId, at) {
  if (how === 'convert') { const t = targetFolder(); for (const f of files) await doConvert(f.path, f.name, 'new_note', t, { at, noteId, sheets: f.sheets }); return; }   // Build M · R57: a workbook's sheets
  await doAttach(files, how === 'attach' ? noteId : null, at);
}
// Files into the note at the line (copied into attachments/; the note saves as typed), or into a new note named after the first
async function doAttach(files, noteId, at) {
  const n = noteId && D.notes.find(x => x.id === noteId), doc = n && app.querySelector(`.doc[data-note="${CSS.escape(n.id)}"]`);
  if (n) {
    const got = [];
    for (const f of files) { const r = await nv('drop_import', f.path); if (failed(r)) { toast(r.message || `Couldn't attach “${f.name}”`); continue; } got.push({ ...r, uses: [] }); }
    if (!got.length) return;
    got.forEach(a => { D.atts = [a, ...(D.atts || []).filter(x => x.file !== a.file)]; });
    const lines = got.map(a => `![[${a.file}]]`);
    if (doc?.isConnected && doc.isContentEditable) {
      edRecord(doc); const box = document.createElement('div'); box.innerHTML = NVMarkdown.mdToHtml(lines.join('\n\n'));
      const bs = doBlocks(doc), els = [...box.children];
      if (at == null || at >= bs.length - 1 || !bs.length) { const last = bs[bs.length - 1]; if (last) last.after(...els); else doc.append(...els); }
      else if (at < 0) { let ref = bs[0]; while (ref.previousElementSibling?.hasAttribute('data-md-ignore')) ref = ref.previousElementSibling; ref.before(...els); }
      else bs[at].after(...els);
      edChanged(doc); embedAtts();
    } else { syncDoc(n); n.md = n.md.replace(/\s*$/, '') + '\n\n' + lines.join('\n\n') + '\n'; n.html = null; n.dirty = true; saveNote(n); }
    DROPO.flash = got.map(a => a.file);
    const msg = `Added ${got.length === 1 ? `“${got[0].name}”` : got.length + ' files'} to “${n.title}”`;
    hold({ msg, back: 'Taken out of the note (the file stays in attachments/)', apply() {}, commit: async () => null,
      undo() { syncDoc(n); lines.forEach(l => { n.md = removeEmbed(n.md, l); }); n.html = null; n.dirty = true; saveNote(n); } });
    return;
  }
  const folder = targetFolder(); if (!folder && !vaultRoot()) { toast('Create a project folder first'); return; }
  const got = [];
  for (const f of files) { const r = await nv('drop_import', f.path); if (failed(r)) { toast(r.message || `Couldn't attach “${f.name}”`); continue; } got.push({ ...r, uses: [], from: f.name }); }
  if (!got.length) return;
  got.forEach(a => { D.atts = [a, ...(D.atts || []).filter(x => x.file !== a.file)]; });
  const made = await ldNewNote(got.map(a => `![[${a.file}]]`).join('\n\n') + '\n', folder, doBase(got[0].from)); if (!made) return;
  ancestors(made.folder).forEach(f => S.open.add(f)); S.scrollTo = made.id; DROPO.flash = got.map(a => a.file);
  status(`Attached “${got[0].from}”${got.length > 1 ? ` and ${got.length - 1} more` : ''} to a new note`); openNote(made.id);
}
// A note the backend made (converting) goes where you're working, as a new note does: a folder is passed to convert_file,
// a project gets it moved in; and the tree learns of a folder the backend made (its "Unsorted")
async function doHome(n, target) {
  if (target && n.folder !== target && isProj(target)) { const r = await nv('move_note', rawId(n.id), ...placeArgs(target)); if (!failed(r)) n.folder = target; }
  if (n.folder && !folderById(n.folder) && !proj(n.folder)) { const fs = await nv('list_folders'); if (Array.isArray(fs)) D.folders = fs.map(mapFolder); }
  ancestors(n.folder).forEach(f => S.open.add(f)); S.scrollTo = n.id;
}
async function doLoadNote(rawNoteId) {   // a note the backend made or changed, into the page (its "- [ ]" lines become tasks)
  const row = await nv('get_note', rawNoteId); if (!row || failed(row)) { toast("The note was saved, but it didn't load"); return null; }
  const fresh = mapNote(row), old = D.notes.find(n => n.id === fresh.id);
  if (old) { Object.assign(old, { md: fresh.md, mtime: fresh.mtime, html: null }); syncLineTasks(old); return old; }
  D.notes.unshift(fresh); primeOne(fresh); ancestors(fresh.folder).forEach(f => S.open.add(f)); return fresh;
}

/* ---- converting: Build K's background job, with the pill (page N of M, Cancel); then the note, its images and table CSVs ---- */
async function doConvert(path, name, mode = 'new_note', folderId, o = {}) {
  if (DROPO.job) { toast(`Still converting “${DROPO.job.name}”`); return null; }
  name = name || fileName(path);
  const target = folderId === undefined ? targetFolder() : folderId, fid = target && !isProj(target) ? rawId(target) : null;   // a project isn't a folder: moved in after
  const r = await nv('convert_file', path, mode, fid, ...(Array.isArray(o.sheets) ? [o.sheets] : []));   // Build M · R57: the sheets picked
  if (failed(r)) { toast(r.message || `Couldn't convert “${name}”`); return null; }
  DROPO.job = { id: r.job, name, done: 0, total: 0 }; CONV.job = r.job; CONV.name = name; DROPO.result = null; renderAll();
  let j;
  for (;;) {
    await new Promise(res => setTimeout(res, 300));
    j = await nv('convert_job', r.job);
    if (failed(j) || j.state !== 'running') break;
    if (DROPO.job) { DROPO.job.done = j.done; DROPO.job.total = j.total; doPaintPill(); }
  }
  DROPO.job = null; CONV.job = null;
  if (j?.state === 'cancelled') { status(`Stopped converting “${name}”: nothing was added`); renderAll(); return j; }
  if (failed(j) || j.state !== 'done') { toast(j?.message || `Couldn't convert “${name}”`); renderAll(); return j; }
  const res = j.result;
  if (!res.note_id) {   // a scan: no text to turn into a note
    if (res.scan) { DROPO.scan = { name, path, noteId: o.noteId || null, at: o.at ?? null }; S.modal = 'do-scan'; S.focus = { sel: '.do-scan .modal-foot .btn:last-child' }; }
    else toast(res.warnings?.[0] || `“${name}” has no text to convert`);
    renderAll(); return j;
  }
  await refreshAtts(); const n = await doLoadNote(res.note_id); if (!n) return j;
  if (res.created) await doHome(n, target);
  const ni = res.images?.length || 0, nt = res.tables?.length || 0, bits = [ni && `${ni} image${ni === 1 ? '' : 's'}`, nt && `${nt} table${nt === 1 ? '' : 's'}`].filter(Boolean);
  const line = (bits.length ? `${bits.join(' and ')} added to Attachments` : 'No images or tables') + (res.warnings?.length ? ' · ' + res.warnings.join(' · ') : '');
  DROPO.result = { noteId: n.id, name, line, files: [...(res.images || []), ...(res.tables || [])].map(f => f.file), flash: true };
  openNote(n.id);
  S.tab = 'files'; if (UI.inspector !== 'shown') setUI('inspector', 'shown');   // the Attachments tab, with the new files outlined
  status(`Converted “${name}” · ${line}`); renderAll();
  return j;
}
convertStart = (path, mode = 'new_note', folderId) => doConvert(path, fileName(path), mode, folderId);   // eslint-disable-line no-global-assign
PAL_COMMANDS.forEach(c => { if (c[2] === 'pdfin') c[0] = 'Convert PDF or Word to Markdown'; });   // R47b
function doPillHtml() {
  const j = DROPO.job; if (!j) return ''; const pct = j.total ? Math.round(j.done / j.total * 100) : 0;
  return `<div class="vpill card do-pill" role="status" aria-label="Converting ${esc(j.name)}${j.total ? `: page ${j.done} of ${j.total}` : ''}">${ic('filepdf')}<span class="vpill-label truncate">Converting “${esc(j.name)}”…${j.total > 1 ? ` page <span class="num">${Math.max(1, j.done)}</span> of <span class="num">${j.total}</span>` : ''}</span><span class="progress do-progress" aria-hidden="true"><span style="width:${pct}%"></span></span><button class="btn btn--ghost btn--sm" data-act="do-conv-cancel" title="Stop converting. Nothing is added">Cancel</button></div>`;
}
function doPaintPill() { const p = app.querySelector('.do-pill'); if (p) p.outerHTML = doPillHtml(); else renderAll(); }
function doResultHtml() {
  const r = DROPO.result; if (!r || ldMain() || UI.view !== 'notes' || note()?.id !== r.noteId) return '';
  return `<div class="alert alert--success do-result" role="status">${ic('ok')}<span>Converted from <b>${esc(r.name)}</b> · ${esc(r.line)}</span><button class="btn btn--ghost btn--sm" data-act="do-result-att">Show in Attachments</button><button class="icon-btn icon-btn--sm" data-act="do-result-x" aria-label="Dismiss" title="Dismiss">${ic('x')}</button></div>`;
}

/* ---- the one question, and the scan ---- */
function doAskHtml() {
  const a = DROPO.ask; if (!a) return ''; const f = a.files[0], many = a.files.length > 1, n = a.noteId && D.notes.find(x => x.id === a.noteId);
  const what = k => k === 'pdf' ? 'PDF' : 'Word file', pdfOff = !DROPO.pdf && a.files.some(x => x.kind === 'pdf');
  const btn = (v, label, cls = 'btn--secondary', extra = '') => `<button class="btn ${cls}" data-act="do-answer" data-v="${v}"${extra}>${label}</button>`;
  const conv = btn('convert', `${ic('filepdf')}Convert to a new note${many ? 's' : ''}`, 'btn--secondary', pdfOff ? ' disabled title="Converting PDFs needs pdfplumber, which isn’t installed"' : '');
  const sub = many ? `${a.files.length} files · ${a.files.map(x => esc(x.name)).join(', ')}` : `${what(f.kind)} · ${doSize(f.size)}`;
  return dlg({ id: 'do-ask', size: 'md', cls: 'do-ask', title: many ? `Add ${a.files.length} files` : `Add “${esc(f.name)}”`, titleCls: 'truncate', sub, descId: 'do-ask-d', x: 'do-ask-x', xLabel: 'Close: nothing is added', xTitle: 'Close: nothing is added',
    body: `<p id="do-ask-d">Convert ${many ? 'them into notes' : 'it into a note'} you can edit (images and tables go to Attachments too), or keep ${many ? 'them as files' : 'it as a file'}.</p>${dlgAlways('id="do-always"', false, 'Settings → Vault &amp; files')}`,
    cancel: '<button class="btn btn--secondary" data-act="do-ask-x">Cancel</button>',
    others: n ? [conv, btn('attach_new', 'Attach to a new note')] : [conv], main: n ? btn('attach', 'Attach to this note', 'btn--primary', ' title="Enter"') : btn('attach_new', 'Attach to a new note', 'btn--primary', ' title="Enter"') });
}
function doScanHtml() {
  const s = DROPO.scan; if (!s) return '';
  return dlg({ id: 'do-scan', size: 'sm', cls: 'do-scan', role: 'alertdialog', title: 'This PDF is a scan: no text to convert', descId: 'do-scan-d', x: 'do-scan-x', xLabel: 'Close: nothing is added', xTitle: 'Close: nothing is added',
    body: `<p id="do-scan-d">“${esc(s.name)}” is pictures of pages, so there’s no text in it to turn into a note. You can keep it as a file.</p>`,
    cancel: '<button class="btn btn--secondary" data-act="do-scan-x">Cancel</button>', main: '<button class="btn btn--primary" data-act="do-scan-attach" title="Enter">Attach it instead</button>' });
}

/* ---- Settings → Vault & files: When you drop a PDF or Word file (drop_office_default) ---- */
function doCard() {
  const d = DROPO.def, u = DROPO.undo;
  const reset = u ? `<button class="btn btn--tint btn--sm cf-card-reset" data-act="do-undo-reset">${ic('restore')}Undo reset</button>` : d !== 'ask' ? `<button class="btn btn--ghost btn--sm cf-card-reset" data-act="do-reset" aria-label="Reset When you drop a PDF or Word file to the default">${ic('restore')}Reset</button>` : '';
  return `<section class="do-card" id="do-drop-card" aria-labelledby="do-card-t"><div class="cf-card-head"><h4 class="cf-card-title" id="do-card-t">When you drop a PDF or Word file</h4><span class="cf-card-val">${DO_DEFS[d][0]}</span>${reset}</div>
    <p class="set-desc">Images always go straight in, where you drop them. Other files are attached the same way.</p>
    <div class="preset-grid" role="group" aria-label="When you drop a PDF or Word file">${Object.entries(DO_DEFS).map(([v, [t, sub, i]]) => `<button class="preset do-opt" data-act="do-def" data-v="${v}" aria-pressed="${d === v}"><span class="do-sample" aria-hidden="true">${ic(i in ICON ? i : 'file')}</span><span class="list-item-title">${t}${v === 'ask' ? ' <span class="do-default">· default</span>' : ''}</span><span class="set-desc">${sub}</span></button>`).join('')}</div></section>`;
}
VAULT_PAGE.push(doCard);
function doSetDef(v, why) { if (!DO_DEFS[v]) return; DROPO.def = v; saveSettings({ drop_office_default: v }); if (why) status(why); }
{ const b0 = boot; boot = function () {   // eslint-disable-line no-global-assign
  b0.apply(this, arguments);
  if (api() && !CHECK) nv('convert_status').then(r => { if (!r || failed(r)) return; if (DO_DEFS[r.drop_office_default]) DROPO.def = r.drop_office_default; DROPO.pdf = r.pdf !== false; }); }; }

/* ======================================================================= QC 48 · opening .md files as notes
   The window bar's Open file icon (between Wrap up and Search) and Ctrl+O: the Open dialog for .md, .markdown and .txt, several at
   once. Each is copied in as a new note where you're working (the file itself is only read), titled by its first # heading (else
   its name, made unique), with the images beside it copied into attachments/; the first one opens. A dropped .md does the same,
   with "Attach instead" on the message for 10 seconds. */
const DO_MD = /\.(md|markdown|txt)$/i;
const MDO = { bar: null };
{ const ta0 = topActions; topActions = function (part) {   // eslint-disable-line no-global-assign
  const h = ta0.apply(this, arguments); if (part === 'pill' || UI.zen === 'on') return h;
  return h; }; }   // Build M · QC 55: the Open file icon moved next to New sticky note (captureBtns, below)
addEventListener('DOMContentLoaded', () => {   // shortcuts.js loads after this file: Ctrl+O joins its table (keys, tooltip, Settings)
  if (typeof KEYS === 'undefined' || KEYS.some(k => k.sel?.includes('md-open'))) return;
  const i = KEYS.findIndex(k => k.l === 'Search and commands');
  KEYS.splice(i + 1, 0, { g: 'go', l: 'Open a Markdown or text file', k: ['Ctrl', 'O'], sel: '.titlebar [data-act="md-open"]', run: () => fire('md-open') });
});
async function mdOpenPick() {
  if (!realData()) { toast('Opening files needs the app with your vault open'); return; }
  let paths = [];
  try { paths = await api().browse_md_files(); } catch (e) { console.warn('browse_md_files', e); }   // straight to the bridge: the dialog can stay open longer than nv()'s 8 s
  if (paths?.length) await mdImport(paths);
}
// Copies the files in as notes; returns the notes made (in the page), or [] (each failure is said)
async function mdImport(paths) {
  const target = targetFolder(), place = !target ? [null, null] : isProj(target) ? [null, rawId(target)] : [rawId(target), null];
  const r = await nv('import_md_files', paths, ...place);
  if (failed(r) && !r.notes?.length) { toast(r.message || "Couldn't open the file"); return []; }
  const made = [];
  for (const x of r.notes) { const n = await doLoadNote(x.id); if (n) { await doHome(n, null); made.push(n); } }
  if (r.notes.some(x => x.images.length)) await refreshAtts();
  if (!made.length) return [];
  const names = r.notes.map(x => x.file), bad = r.errors || [];
  status(`Opened ${names.length === 1 ? `“${names[0]}”` : names.length + ' files'} as ${names.length === 1 ? 'a note' : 'notes'}${bad.length ? ` · ${bad.length} couldn't be opened: ${bad[0].message}` : ''}`);
  if (bad.length) toast(bad[0].message);
  openNote(made[0].id);
  return made;
}
// A dropped .md: a note, and for 10 seconds "Attach instead" (the note goes again if it's untouched; the file is attached where it was dropped)
async function mdDropped(files, noteId, at) {
  const made = await mdImport(files.map(f => f.path)); if (!made.length) return;
  clearTimeout(MDO.bar?.t);
  MDO.bar = { files, noteId, at, made: made.map(n => ({ n, md: n.md, title: n.title })), msg: `Opened ${files.length === 1 ? `“${files[0].name}”` : files.length + ' files'} as ${files.length === 1 ? 'a note' : 'notes'}` };
  MDO.bar.t = setTimeout(() => { MDO.bar = null; renderAll(); }, 10000); renderAll();
}
async function mdAttachInstead() {
  const b = MDO.bar; if (!b) return; clearTimeout(b.t); MDO.bar = null;
  let kept = 0;
  for (const { n, md, title } of b.made) {   // Build L's delete: off the page now, the backend's delete after its Undo
    syncDoc(n);
    if (!D.notes.includes(n) || n.md !== md || n.title !== title) { kept++; continue; }   // you've started on it: it stays
    await deleteItem('note', n.id);
  }
  const back = b.noteId && D.notes.find(x => x.id === b.noteId);
  if (back) openNote(back.id);
  await doAttach(b.files, back ? back.id : null, b.at);
  if (kept) toast(`Attached instead · ${kept === 1 ? 'the note was' : kept + ' notes were'} kept: you'd changed ${kept === 1 ? 'it' : 'them'}`);
  renderAll();
}
const mdBarHtml = () => MDO.bar && !HOLD.cur ? `<div class="toast card toast--undo do-mdbar" role="status">${ic('ok')}<span class="truncate" title="${esc(MDO.bar.msg)}">${esc(MDO.bar.msg)}</span><button class="btn btn--secondary btn--sm" data-act="md-attach-instead" title="Attach the file where you dropped it, and take this note back out (10 seconds)">Attach instead</button></div>` : '';
app.addEventListener('click', e => {
  const act = e.target.closest('[data-act]')?.dataset.act;
  if (act === 'md-open') mdOpenPick(); else if (act === 'md-attach-instead') mdAttachInstead();
});

/* ======================================================================= drawing */
{ const m0 = renderModal; renderModal = function () {   // eslint-disable-line no-global-assign
  if (S.modal === 'do-ask') return doAskHtml(); if (S.modal === 'do-scan') return doScanHtml();
  return m0.apply(this, arguments) + ldMenuHtml() + ldFilterHtml() + doPillHtml() + mdBarHtml(); }; }
{ const a0 = afterRender; afterRender = function () {   // eslint-disable-line no-global-assign
  app.classList.toggle('ld-listing', ldMain());
  a0.apply(this, arguments);
  ldApply();
  const rh = doResultHtml(), grid = app.querySelector('#main-view-notes .ed-grid'); if (rh && grid) grid.insertAdjacentHTML('beforebegin', rh);
  const res = DROPO.result; if (res && UI.view === 'notes') {
    const rows = [...app.querySelectorAll('#right-sidebar .att-row')].filter(b => res.files.includes(b.title)); rows.forEach(b => b.classList.add('do-new'));
    if (res.flash) { res.flash = false; rows.forEach(b => b.classList.add('do-flash')); rows[0]?.scrollIntoView({ block: 'nearest' }); setTimeout(() => app.querySelectorAll('.att-row.do-flash').forEach(b => b.classList.remove('do-flash')), 4000); } }
  if (DROPO.flash) { const fs = DROPO.flash; DROPO.flash = null; fs.forEach(f => app.querySelectorAll(`#note-body-editor [data-embed-for="${CSS.escape(f)}"]`).forEach(el => { el.classList.add('do-dropped'); setTimeout(() => el.classList.remove('do-dropped'), 3000); })); }
  if (DROPO.drag) doPaint(); }; }

/* ======================================================================= clicks, keys, typing */
app.addEventListener('click', async e => {
  const t = e.target.closest('[data-act]'), act = t?.dataset.act || '', v = t?.dataset.v;
  if (!act.startsWith('ld-') && !act.startsWith('do-')) return;
  const key = v || '', kind = key.split(':')[0], id = key.slice(key.indexOf(':') + 1), st = kind === 'st' ? stickyById(id) : null, th = kind === 'in' ? ldThought(id) : null;
  switch (act) {
    case 'ld-list': LD.list = v; LD.menu = null; LD.pop = null; if (v === 'inbox') ldLoadDone(); S.focus = { sel: '#ld-q' }; renderAll(); break;
    case 'ld-close': ldClose(); break;
    case 'ld-menu': LD.menu = LD.menu === v ? null : v; LD.pop = null; renderAll(); break;
    case 'ld-filter': LD.pop = LD.pop ? null : 'filter'; LD.menu = null; renderAll(); break;
    case 'ld-pop-x': LD.pop = null; S.focus = { sel: '[data-act="ld-filter"]' }; renderAll(); break;
    case 'ld-f': LD.f[LD.list] = v; S.focus = { sel: `[data-act="ld-f"][data-v="${v}"]` }; renderAll(); break;
    case 'ld-clear': LD.q[LD.list] = ''; LD.f[LD.list] = 'All'; S.focus = { sel: '#ld-q' }; renderAll(); break;
    case 'ld-new': if (v === 'stickies') newSticky(); else app.querySelector('#ld-add')?.focus(); break;
    case 'ld-open': showSticky(v); renderAll(); break;
    case 'ld-pop': LD.menu = null; if (st) { if (CAPTURE.live && api()) popOut('st:' + st.id); else toast('Popping out needs the app'); } renderAll(); break;
    case 'ld-note': LD.menu = null; if (st) await stickyPromote(st.id); LD.list = null; renderAll(); break;
    case 'ld-task': LD.menu = null; if (st) await ldStickyTask(st); else if (th) await ldMove(th, 'task'); renderAll(); break;
    case 'ld-move': LD.menu = null; await ldMove(th, 'note'); break;
    case 'ld-move-new': LD.menu = null; await ldMove(th, 'new'); break;
    case 'ld-tick': LD.menu = null; if (th && await ldTick(th, !th.done)) status(th.done ? 'Ticked off' : 'Back to not done'); renderAll(); break;
    case 'ld-del': LD.menu = null; ldDelete(key); break;
    case 'do-ask-x': { const a = DROPO.ask; DROPO.ask = null; closeModal(true); status(a ? 'Nothing was added' : ''); renderAll(); break; }
    case 'do-answer': { const a = DROPO.ask; if (!a || t.disabled) break; const always = app.querySelector('#do-always')?.checked; DROPO.ask = null; closeModal(true); renderAll();
      if (always) doSetDef(v, `${DO_DEFS[v][0]} from now on · change it in Settings → Vault & files`);
      await doOffice(a.files, v, a.noteId, a.at); break; }
    case 'do-scan-x': DROPO.scan = null; closeModal(true); status('Nothing was added'); renderAll(); break;
    case 'do-scan-attach': { const s = DROPO.scan; DROPO.scan = null; closeModal(true); renderAll(); if (s) await doAttach([{ name: s.name, path: s.path }], s.noteId, s.at); break; }
    case 'do-conv-cancel': if (DROPO.job) { nv('convert_cancel', DROPO.job.id); t.disabled = true; t.textContent = 'Stopping…'; } break;
    case 'do-result-att': S.tab = 'files'; if (UI.inspector !== 'shown') setUI('inspector', 'shown'); if (DROPO.result) DROPO.result.flash = true; renderAll(); break;
    case 'do-result-x': DROPO.result = null; renderAll(); break;
    case 'do-def': DROPO.undo = null; doSetDef(v); S.focus = { sel: `[data-act="do-def"][data-v="${v}"]` }; renderAll(); break;
    case 'do-reset': DROPO.undo = DROPO.def; doSetDef('ask', 'When you drop a PDF or Word file: back to Ask each time'); S.focus = { sel: '[data-act="do-undo-reset"]' }; renderAll(); break;
    case 'do-undo-reset': { const u = DROPO.undo; DROPO.undo = null; if (u) doSetDef(u, `When you drop a PDF or Word file: ${DO_DEFS[u][0]} again`); S.focus = { sel: '[data-act="do-reset"]' }; renderAll(); break; }
  }
});
app.addEventListener('change', e => { const id = e.target.dataset?.ldDone; if (!id) return; const x = ldThought(id); ldTick(x, e.target.checked).then(ok => { if (ok) status(x.done ? 'Ticked off' : 'Back to not done'); renderAll(); }); });
app.addEventListener('input', e => {
  if (e.target.matches?.('[data-ld-q]')) { LD.q[LD.list] = e.target.value; ldApply(); }
  else if (e.target.matches?.('[data-ld-add]')) LD.add = e.target.value;
});
app.addEventListener('keydown', e => {
  if (e.key === 'Enter' && e.target.matches?.('[data-ld-add]')) { e.preventDefault(); ldAddThought(e.target); }
});
document.addEventListener('keydown', e => {   // capture: before actions.js. Esc closes a menu, then the list (back to the note)
  if (e.key !== 'Escape' || S.modal || !ldMain()) return;
  if (LD.menu || LD.pop) { e.stopImmediatePropagation(); const sel = LD.menu ? `[data-act="ld-menu"][data-v="${CSS.escape(LD.menu)}"]` : '[data-act="ld-filter"]'; LD.menu = null; LD.pop = null; S.focus = { sel }; renderAll(); return; }
  if (e.target.matches?.('[data-ld-q]') && e.target.value) { e.stopImmediatePropagation(); e.target.value = ''; LD.q[LD.list] = ''; ldApply(); return; }
  e.stopImmediatePropagation(); ldClose();
}, true);
/* ===================================================================== end Build O · lists and dropped files */

/* ==== Build M · round 6 (the user's lock r47list "grid", 2026-10-18): Sticky Notes as cards in their own colours, and Brain Dump
   as a timeline by day (the time on the left, the day as a heading). Search, the filter, ⋮, Show / Reopen and the tick work as in
   the rows (same data-ld-item / data-act); a ticked thought stays, greyed (r47-done). ==== */
function ldStickyCard(s) {
  const state = s.out ? 'popped out' : s.open ? 'on screen' : 'closed', when = ldWhen(s);
  return `<div class="ld-card dot-${s.color}" data-ld-item="st:${s.id}" data-ld-text="${esc((s.text || '').toLowerCase())}"><div class="ld-card-text">${esc(s.text.trim() || 'Empty sticky')}</div>
    <div class="ld-card-foot"><span class="ld-meta" title="Sticky #${s.n}${when ? ' · ' + when : ''} · ${state}">#${s.n}${when ? ' · ' + when : ''} · ${state}</span><button class="btn btn--ghost btn--sm" data-act="ld-open" data-v="${s.id}">${s.open || s.out ? 'Show' : 'Reopen'}</button>${ldMore('st:' + s.id, 'Sticky #' + s.n)}</div></div>`;
}
const ldThoughtTime = x => ldThoughtRow(x).replace('<div class="ld-item', '<div class="ld-item ld-item--time').replace('<input type="checkbox"', () => `<span class="ld-time num">${esc(x.t || '')}</span><input type="checkbox"`)
  .replace(/<span class="ld-meta">[^<]*<\/span>/, () => (x.taskIds?.length ? `<span class="ld-meta">${x.taskIds.length} task${x.taskIds.length === 1 ? '' : 's'} made</span>` : ''));
{ const ldBody0 = ldBody;
  ldBody = function (k) {   // eslint-disable-line no-global-assign
    if (k === 'stickies') return D.stickies.length ? `<div class="ld-list ld-grid" data-ld-k="stickies">${ldShown(k).map(ldStickyCard).join('')}</div>` : ldEmpty(k);
    const h = ldBody0(k), l = ldShown(k); if (!ldThoughts().length) return h;
    const days = [...new Set(l.map(x => x.day || todayKey()))];
    const tl = `<div class="ld-list ld-tl" data-ld-k="inbox">${days.map(d => `<div class="ld-day" data-ld-day="${esc(d)}"><div class="day-head">${ldDay(d)}</div>${l.filter(x => (x.day || todayKey()) === d).map(ldThoughtTime).join('')}</div>`).join('')}</div>`;
    return h.replace(/<div class="ld-list" data-ld-k="inbox">[\s\S]*$/, () => tl);   // a function: a "$" in a thought stays as typed
  };
  const ldApply0 = ldApply;
  ldApply = function () {   // eslint-disable-line no-global-assign
    ldApply0.apply(this, arguments);
    app.querySelectorAll('.ld-day').forEach(d => { d.hidden = !d.querySelector('[data-ld-item]:not([hidden])'); });   // a day with nothing found goes too
  };
}
/* ==== end Build M · round 6 ==== */

/* ==== Build M · QC 55: Open file (the icon, Ctrl+O) takes what a drop takes. .md / .markdown / .txt open as today; PDF and Word
   become a new note through the converter (the file kept attached at the top, r47-keeppdf); PNG and JPEG become a new note named
   after the file, the image embedded. No new questions: each kind does its default. The icon sits right of New sticky note. ==== */
const OPEN_IMG = /\.(png|jpe?g)$/i, OPEN_OFFICE = /\.(pdf|docx)$/i;
{ const cb0 = captureBtns;
  captureBtns = function () {   // eslint-disable-line no-global-assign
    const h = cb0.apply(this, arguments); if (!h) return h;
    const btn = `<button class="top-btn" data-act="md-open" aria-label="Open a file as a note" title="Open a file as a note (Markdown, text, PDF, Word, Excel, PNG or JPEG)">${ic('folderopen')}</button>`;
    const i = h.indexOf('<button class="top-btn" data-act="dump"'); return i < 0 ? h + btn : h.slice(0, i) + btn + h.slice(i);
  };
}
mdOpenPick = async function () {   // eslint-disable-line no-global-assign
  if (!realData()) { toast('Opening files needs the app with your vault open'); return; }
  let paths = [];
  try { paths = await api().browse_open_files(); } catch (e) { console.warn('browse_open_files', e); }   // straight to the bridge: the dialog can stay open a while
  if (paths?.length) await openPaths(paths);
};
async function openPaths(paths) {
  const mds = paths.filter(p => DO_MD.test(p)), office = paths.filter(p => OPEN_OFFICE.test(p)), images = paths.filter(p => OPEN_IMG.test(p));
  const books = paths.filter(p => /\.xlsx$/i.test(p));   // Build M · R57: a workbook asks in the one dialog (convert with the sheets picked, or attach)
  const other = paths.filter(p => !mds.includes(p) && !office.includes(p) && !images.includes(p) && !books.includes(p));
  other.forEach(p => toast(`“${fileName(p)}” can't be opened as a note: only Markdown, text, PDF, Word, Excel, PNG and JPEG files`));
  if (mds.length) await mdImport(mds);
  for (const p of images) await doAttach([{ name: fileName(p), path: p }], null);   // a new note named after the file, the image in it
  for (const p of office) await doConvert(p, fileName(p), 'new_note', targetFolder());   // the converter's pill, then the new note
  if (books.length) { DROPO.ask = { files: books.map(p => ({ name: fileName(p), size: null, kind: 'xlsx', path: p })), noteId: doDoc()?.dataset.note || null, at: null }; S.modal = 'do-ask'; S.focus = { sel: '.do-ask [data-act="dq-add"]' }; renderAll(); }
}
addEventListener('DOMContentLoaded', () => {   // after Build O's: the shortcut's name says what it opens now
  const k = typeof KEYS !== 'undefined' && KEYS.find(x => x.sel?.includes('md-open')); if (k) k.l = 'Open a file as a note (Markdown, text, PDF, Word, Excel, image)';
});
/* ==== end Build M · QC 55 ==== */

/* ==== Build M · parity round (R51 r47-several "one for each", R52 r52-drop "choice rows and a bar over the note, as a setting"):
   dropped PDF and Word files are asked about one at a time: the file, "1 of 3", three choices (Attach to this note · Convert into a
   new note · Attach to a new note), Skip, and "Do the same for the other N" (on the last one, "Always do this" sets the default).
   Settings → Vault & files → "When you drop a file": Choice rows (default) | A bar over the note (config drop_dialog). R47's
   old dialog and the two-big-choices design are gone. ==== */
const DQ_CHOICES = [['attach', 'clip', 'Attach to this note', 'A link to the file where you dropped it', 'Attach here'],
  ['convert', 'filepdf', 'Convert into a new note', 'Text, images and tables you can edit; the file stays attached', 'Convert'],   // a workbook says so in its own words (dqConvDesc)
  ['attach_new', 'noteplus', 'Attach to a new note', 'A new note that holds just the file', 'New note']];
DROPO.dialog = 'rows';
function dqWhy(a, v) {   // why a choice can't be picked (no note open; converting a PDF needs pdfplumber)
  const n = a.noteId && D.notes.find(x => x.id === a.noteId);
  if (v === 'attach' && !n) return 'No note is open';
  if (v === 'convert' && a.files[0].kind === 'pdf' && DROPO.pdf === false) return 'Converting PDFs needs pdfplumber, which isn’t installed';
  return '';
}
const dqOk = (a, v) => !dqWhy(a, v);
function dqState(a) {   // the question's own state on the drop: which file of how many, what's picked
  if (!a.q) a.q = { idx: 1, total: a.files.length, same: false };
  if (!a.q.pick || !dqOk(a, a.q.pick)) a.q.pick = DQ_CHOICES.map(c => c[0]).find(v => dqOk(a, v));
  return a.q;
}
doAskHtml = function () {   // eslint-disable-line no-global-assign
  const a = DROPO.ask; if (!a || !a.files.length) return ''; const q = dqState(a), f = a.files[0], rest = a.files.length - 1;
  if (f.kind === 'xlsx') dqLoadX(f);   // Build M · R57: its sheets, for Convert
  const meta = f.kind === 'xlsx' ? dqXMeta(f) : `${f.kind === 'pdf' ? 'PDF' : 'Word file'} · ${doSize(f.size)}`, count = q.total > 1 ? `<span class="dq-count num" aria-label="File ${q.idx} of ${q.total}">${q.idx} of ${q.total}</span>` : '';
  const file = `<div class="dq-file"><span class="dq-file-ic" aria-hidden="true">${ic(f.kind === 'pdf' ? 'filepdf' : f.kind === 'xlsx' ? 'table' : 'file')}</span><span class="dq-file-t"><span class="dq-file-name" title="${esc(f.name)}">${esc(f.name)}</span><span class="dq-file-meta">${meta}</span></span></div>`;
  const skip = rest ? '<button class="btn btn--secondary" data-act="dq-skip">Skip</button>' : '';
  const x = `<button class="icon-btn icon-btn--sm" data-act="dq-x" aria-label="Close: nothing more is added" title="Close (Esc): nothing more is added">${ic('x')}</button>`;
  if (DROPO.dialog === 'bar') return `<div class="card dq-bar do-ask" role="dialog" aria-label="Add ${esc(f.name)}">${file}${count}<div class="seg" role="radiogroup" aria-label="What to do">${DQ_CHOICES.map(([v, , , , short]) => { const why = dqWhy(a, v);
      return `<button class="seg-opt" role="radio" data-act="dq-pick" data-v="${v}" aria-checked="${q.pick === v}" aria-pressed="${q.pick === v}"${why ? ` aria-disabled="true" title="${esc(why)}"` : ''}>${short}</button>`; }).join('')}</div>${skip}<button class="btn btn--primary btn--sm" data-act="dq-add" title="Enter">Add</button>${x}</div>`;
  const choices = `<div class="dq-choices" role="radiogroup" aria-label="What to do with it">${DQ_CHOICES.map(([v, i, l, s]) => { const why = dqWhy(a, v);
    return `<button class="dq-choice" role="radio" data-act="dq-pick" data-v="${v}" aria-checked="${q.pick === v}"${why ? ` aria-disabled="true" title="${esc(why)}"` : ''}>${ic(i)}<span class="dq-choice-t"><b>${l}</b><span>${why || dqConvDesc(f, v, s)}</span></span></button>`; }).join('')}</div>`
    + (f.kind === 'xlsx' && q.pick === 'convert' ? dqSheetsHtml(f) : '');   // Build M · R57: the sheets, under Convert
  const same = rest ? `<label class="dq-same"><input type="checkbox" data-dq-same ${q.same ? 'checked' : ''}>Do the same for the other ${rest}</label>` : '<label class="dq-same"><input type="checkbox" id="do-always">Always do this (Settings → Vault &amp; files)</label>';
  return dlg({ id: 'do-ask', size: 'sm', cls: 'do-ask dq-ask', title: 'Add a file', headExtra: count, x: 'dq-x', xLabel: 'Close: nothing more is added', xTitle: 'Close (Esc): nothing more is added',
    body: file + choices, back: same, others: [skip], main: dqMainBtn(f, q) });
};
async function dqAnswer(act, v) {
  const a = DROPO.ask; if (!a) return; const q = dqState(a);
  if (act === 'dq-pick') { if (!dqOk(a, v)) return; q.pick = v; S.focus = { sel: `.do-ask [data-act="dq-pick"][data-v="${v}"]` }; renderAll(); return; }
  if (act === 'dq-x') { DROPO.ask = null; closeModal(true); status(q.idx > 1 ? 'Nothing more was added' : 'Nothing was added'); renderAll(); return; }
  if (act === 'dq-add' && a.files[0]?.kind === 'xlsx' && q.pick === 'convert') { const f0 = a.files[0], picked = dqPicked(f0); if (picked && !picked.length) return; f0.sheets = picked || undefined; }   // Build M · R57
  const f = a.files.shift(), pick = q.pick, always = act === 'dq-add' && !a.files.length && !!app.querySelector('#do-always')?.checked;
  const all = act === 'dq-add' ? (q.same ? [f, ...a.files.splice(0)] : [f]) : [];
  const next = a.files.length ? a : null; DROPO.ask = null; closeModal(true); renderAll();
  if (act === 'dq-skip') status(`Skipped “${f.name}”`);
  if (always) doSetDef(pick, `${DO_DEFS[pick][0]} from now on · change it in Settings → Vault & files`);
  if (all.length) await doOffice(all, pick, a.noteId, a.at);   // this file (or all that are left), then the next one asks
  if (next) { q.idx++; q.pick = null; q.same = false; DROPO.ask = next; S.modal = 'do-ask'; S.focus = { sel: '.do-ask [data-act="dq-add"]' }; renderAll(); }
}
app.addEventListener('click', e => { const t = e.target.closest?.('[data-act^="dq-"]'); if (!t || t.dataset.act === 'dq-mode' || t.getAttribute('aria-disabled') === 'true') return; e.stopImmediatePropagation(); dqAnswer(t.dataset.act, t.dataset.v); }, true);
app.addEventListener('change', e => { if (e.target.matches?.('[data-dq-same]') && DROPO.ask?.q) DROPO.ask.q.same = e.target.checked; });
document.addEventListener('keydown', e => {
  if (S.modal !== 'do-ask' || !DROPO.ask) return;
  if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); dqAnswer('dq-x'); }
  else if (e.key === 'Enter' && !e.target.closest?.('button, input')) { e.preventDefault(); dqAnswer('dq-add'); }
}, true);
VAULT_PAGE.push(() => `<div class="set-row dq-set"><div><div class="set-label" id="dq-mode">When you drop a file</div><div class="set-desc">How a dropped PDF or Word file asks what to do, one file at a time</div></div>
  <div class="seg" role="group" aria-labelledby="dq-mode">${[['rows', 'Choice rows'], ['bar', 'A bar over the note']].map(([v, l]) => `<button class="seg-opt" data-act="dq-mode" data-v="${v}" aria-pressed="${DROPO.dialog === v}">${l}</button>`).join('')}</div></div>`);
app.addEventListener('click', e => {
  const b = e.target.closest?.('[data-act="dq-mode"]'); if (!b) return; e.stopImmediatePropagation(); DROPO.dialog = b.dataset.v;
  if (!CHECK) saveSettings({ drop_dialog: DROPO.dialog }); status(`A dropped file asks with ${DROPO.dialog === 'bar' ? 'a bar over the note' : 'choice rows'}`); S.focus = { sel: `[data-act="dq-mode"][data-v="${DROPO.dialog}"]` }; renderAll();
}, true);
{ const dqr0 = readerFromConfig;
  readerFromConfig = function (c) { dqr0(c); if (!CHECK && ['rows', 'bar'].includes(c.drop_dialog)) DROPO.dialog = c.drop_dialog; };   // eslint-disable-line no-global-assign
}
/* ==== end Build M · parity round ==== */

/* ==== Build M · QC 75 (design profile: "A voice thought plays wherever it's listed"; feedback: "if there is a voice note in the
   brain dump I wanna be able to listen from here"): every Brain Dump row from a recording, done or not, has the clip player
   under its text, the same one as in a note and the capture window (voice-attach.js clipHtml, through PLAYER, one at a time):
   play/pause, position and speed, compact (the row's own tick and ⋮ stay). A recording that has gone shows as a clip does. ==== */
{ const tr0 = ldThoughtRow;
  ldThoughtRow = function (x) {   // eslint-disable-line no-global-assign
    const h = tr0.apply(this, arguments); if (!x.audio) return h;
    const clip = `<div class="ld-clip">${clipHtml(clipFor(x.audio), { ctx: 'list', missing: !attByFile(x.audio) })}</div>`;
    return h.replace(`<span class="ld-text">${ic('mic')}`, '<span class="ld-text">').replace(/<span class="ld-text">[\s\S]*?<\/span>/, m => m + clip);
  };
}
/* ==== end Build M · QC 75 ==== */

/* ==== Build M · R57 (r57-xflow "one dialog", r57-xrows "the first 500 rows in the note, all rows in the CSV"; feedback: "I want to
   be able to add xlsx files and convert to md(html)"): a dropped or opened workbook asks in the choice rows above. Convert lists
   its sheets as checkboxes (a hidden one unticked, "Hidden in Excel"), with their size, "rich table" when cells are merged and
   "the first 500 rows go in the note" for a big one; the main button says what it does (Convert 2 sheets) and waits for one.
   The sheets come from api.xlsx_info (the file is only read). In the bar the sheets that aren't hidden are converted. ==== */
const DQ_XSAMPLE = { status: 'success', size: 64000, sheets: [{ name: 'Summary', hidden: false, rows: 9, cols: 5, merged: 2 }, { name: 'Q3 detail', hidden: false, rows: 913, cols: 6, merged: 0 }, { name: 'Lookups', hidden: true, rows: 40, cols: 2, merged: 0 }] };
function dqLoadX(f) {   // once per file: its sheets, then the dialog draws again
  if (f.x || f.xLoading) return; f.xLoading = true;
  const done = r => { f.xLoading = false; f.x = failed(r) || !r ? { status: 'error', message: r?.message || 'The workbook couldn’t be read.', sheets: [] } : r;
    f.xPick = Object.fromEntries((f.x.sheets || []).map(sh => [sh.name, !sh.hidden])); if (S.modal === 'do-ask') renderAll(); };
  if (!realData()) { done(DQ_XSAMPLE); return; }
  nv('xlsx_info', f.path).then(done, () => done(null));
}
function dqXMeta(f) {
  const x = f.x; if (!x) return 'Excel workbook · reading its sheets…'; if (x.status === 'error') return `Excel workbook · ${esc(plainMsg(x.message))}`;
  const n = x.sheets.length, hid = x.sheets.filter(sh => sh.hidden).length;
  return `Excel workbook · ${n} sheet${n === 1 ? '' : 's'}${hid ? `, ${hid} hidden` : ''} · ${doSize(x.size ?? f.size)}`;
}
const dqConvDesc = (f, v, s) => v === 'convert' && f.kind === 'xlsx' ? 'A table for each sheet you can edit; the workbook stays attached' : s;
const dqPicked = f => f.x?.sheets ? f.x.sheets.filter(sh => f.xPick?.[sh.name]).map(sh => sh.name) : null;
function dqSheetsHtml(f) {
  const x = f.x; if (!x) return '<div class="dq-sheets" role="status"><span class="spinner" aria-hidden="true"></span><span class="set-desc">Reading the workbook…</span></div>';
  if (x.status === 'error') return `<div class="dq-sheets" role="alert"><span class="set-desc">${esc(plainMsg(x.message))}</span></div>`;
  return `<div class="dq-sheets" role="group" aria-label="Sheets to convert"><div class="eyebrow">Sheets</div>${x.sheets.map((sh, i) => `<label class="dq-sheet"><input type="checkbox" data-dq-sheet="${i}" ${f.xPick?.[sh.name] ? 'checked' : ''}>
    <span class="dq-sheet-t"><b>${esc(sh.name)}</b><span>${sh.rows.toLocaleString('en-GB')} row${sh.rows === 1 ? '' : 's'} × ${sh.cols} column${sh.cols === 1 ? '' : 's'}${sh.merged ? ` · ${sh.merged} merged cell${sh.merged === 1 ? '' : 's'}, so a rich table` : ''}${sh.rows - 1 > 500 ? ' · the first 500 rows go in the note, every row in its CSV' : ''}</span></span>${sh.hidden ? '<span class="chip chip--neutral">Hidden in Excel</span>' : ''}</label>`).join('')}</div>`;
}
function dqMainBtn(f, q) {
  if (f.kind !== 'xlsx' || q.pick !== 'convert') return '<button class="btn btn--primary" data-act="dq-add" title="Enter">Add</button>';
  const n = dqPicked(f)?.length ?? 0;
  return `<button class="btn btn--primary" data-act="dq-add" title="Enter"${!f.x || !n ? ' disabled' : ''}>Convert ${n === 1 ? '1 sheet' : n + ' sheets'}</button>`;
}
app.addEventListener('change', e => {
  const b = e.target.closest?.('[data-dq-sheet]'), f = DROPO.ask?.files?.[0]; if (!b || !f?.x) return;
  const sh = f.x.sheets[+b.dataset.dqSheet]; if (!sh) return; f.xPick[sh.name] = b.checked; S.focus = { sel: `[data-dq-sheet="${b.dataset.dqSheet}"]` }; renderAll();
});
/* ==== end Build M · R57 ==== */
