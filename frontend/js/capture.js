/* PHASE 6A · Sticky notes and the brain dump inbox: data, cards, pickers and the capture bar.
   Extracted from design/vault-notes-mockups.html (R20): stickyCard, stickyPickModal, stickyPromote, stickyPick, stickyTask, dumpBar.
   With the backend they save through window.pywebview.api (list_stickies … add_inbox_item, design/api-contract.md);
   on the sample vault they change memory only, as the mockup did. Events are wired at the end of actions.js. */
'use strict';
const STICKY_COLOURS = ['yellow', 'pink', 'mint', 'blue', 'lilac'];
const STICKY_SAVE_MS = 450;
const CAPTURE = { live: false };   // true once stickies and the inbox came from the backend
const mapSticky = s => ({ id: 'st-' + s.id, n: s.n, text: s.text || '', color: s.color, open: !!s.open, x: s.x, y: s.y, w: s.w, h: s.h, file: s.file, saved: s.updated_at, out: !!s.out });   // Build H: out = popped out (its own window)
const mapInbox = x => ({ id: 'in-' + x.id, t: x.time, day: x.day, text: x.text, done: !!x.done, audio: x.audio || null, tasks: x.tasks || [], taskIds: x.task_ids || [] });   // Build A: a voice thought's clip and tasks (Build A+: the board tasks they became)
const stickyById = id => D.stickies.find(s => s.id === id);
const openStickies = () => D.stickies.filter(s => s.open === true && !s.out);   // the sample's stickies start closed; Build H: a popped-out one is in its own window
const capCall = (name, ...args) => CAPTURE.live ? nv(name, ...args) : Promise.resolve({ status: 'success' });
const clock = d => `${two(d.getHours())}:${two(d.getMinutes())}`;
async function loadCapture() {
  if (!api()) return false;
  const [st, inbox] = await Promise.all([nv('list_stickies'), nv('list_inbox')]);
  if (!Array.isArray(st) || !Array.isArray(inbox)) return false;   // an older backend: keep the empty lists loadVault set
  D.stickies = st.map(mapSticky); D.inbox = inbox.map(mapInbox); CAPTURE.live = true;
  return true;
}

/* ---- Sticky notes: make, type (saves 450 ms after the last key), colour, move, size, close ---- */
async function newSticky() {
  let s;
  if (CAPTURE.live) { const r = await nv('create_sticky'); if (failed(r)) { toast(r.message || "Couldn't make a sticky note."); return null; } s = mapSticky(r.sticky); }
  else { const n = Math.max(0, ...D.stickies.map(x => x.n)) + 1, d = new Date();
    s = { id: 'st-' + Date.now(), n, text: '', color: STICKY_COLOURS[(n - 1) % 5], open: true, file: `stickynoted/${todayKey()}-${two(d.getHours())}${two(d.getMinutes())}.md` }; }
  D.stickies.push(s); pushTrail({ key: 'st:' + s.id, label: 'Sticky #' + s.n, icon: 'sticky', go: { sticky: s.id } });
  S.focus = { sel: '#' + stickyFieldId(s) }; renderAll();
  if (D.tset.stickyOut && CAPTURE.live && api()) popOut('st:' + s.id);   // Build H: Settings → Open new stickies popped out
  return s;
}
function patchSticky(s, patch) {
  Object.assign(s, patch);
  return capCall('update_sticky', rawId(s.id), patch).then(r => { if (failed(r)) toast(r.message || "Couldn't save the sticky note."); return r; });
}
const stickyFieldId = s => 'sticky-text-' + s.id;   // an id, so a re-render keeps the caret where it was
function stickyTyped(s, text) {
  s.text = text; s.dirty = true; paintStickyStatus(s, 'Saving…');
  clearTimeout(s.saveT); s.saveT = setTimeout(() => saveStickyText(s), STICKY_SAVE_MS);
}
async function saveStickyText(s) {
  clearTimeout(s.saveT); if (!s.dirty) return;
  s.dirty = false; const text = s.text, r = await capCall('update_sticky', rawId(s.id), { text });
  if (failed(r)) { s.dirty = true; s.err = r.message || "Couldn't save"; paintStickyStatus(s); return; }
  s.err = null; s.saved = new Date(); if (!s.dirty) paintStickyStatus(s);
}
const flushStickies = () => Promise.all(D.stickies.filter(s => s.dirty).map(saveStickyText));
const stickyStatus = s => s.err ? 'Not saved: ' + s.err : s.dirty ? 'Saving…' : 'Saved' + (s.saved ? ' ' + clock(new Date(s.saved)) : '');   // Build H (R34): "Saved 15:42"
function paintStickyStatus(s, text) { const el = app.querySelector(`[data-sticky-status="${s.id}"]`); if (el) el.textContent = text ?? stickyStatus(s); }
function stickyColour(id, c) { const s = stickyById(id); if (!s || !STICKY_COLOURS.includes(c)) return; patchSticky(s, { color: c }); S.focus = { sel: `[data-act="sticky-colour"][data-v="${id}:${c}"]` }; renderAll(); }
function stickyMoved(id, x, y) { const s = stickyById(id); if (s) patchSticky(s, { x: Math.round(x), y: Math.round(y) }); }
function stickySized(id, w, h) { const s = stickyById(id); if (s && (w !== (s.w || 248) || h !== (s.h || 224))) patchSticky(s, { w, h }); }
// Close: it stays saved (and opens again from the sidebar's sticky notes row). An empty one has nothing to keep, so it goes
// Fix C (QC 18): a sticky the database no longer has ("Sticky note not found") is closed too, so its card can't get stuck
const stickyGone = r => failed(r) && (r.gone || /not found/i.test(r.message || ''));
async function closeSticky(id) {
  const s = stickyById(id); if (!s) return; S.stickyMenu = null;
  await saveStickyText(s);
  if (!s.text.trim()) { const r = await capCall('delete_sticky', rawId(id)); if (failed(r) && !stickyGone(r)) { toast(r.message); return; } forgetSticky(s); renderAll(); return; }
  s.open = false; renderAll();
  const r = await patchSticky(s, { open: false });
  if (stickyGone(r)) { forgetSticky(s); renderAll(); return; }
  if (!failed(r)) toast(`Sticky #${s.n} is still saved: open it from Sticky Notes in the sidebar`);
}
// The sidebar's sticky notes row, and the trail: show every one (or just one) where it was
// Fix C (QC 18): popped-out ones come to the front of the desktop, closed ones open in the app (one whose window has
// gone without NeuroVault hearing opens in the app too)
function showSticky(id) {
  const list = id ? [stickyById(id)].filter(Boolean) : D.stickies;
  if (!list.length) { toast('No sticky notes yet: the sticky button in the window bar makes one'); return; }
  const here = list.filter(s => !s.out);
  list.filter(s => s.out).forEach(s => nv('pop_show', 'sticky', rawId(s.id)).then(r => { if (!failed(r)) return; s.out = false; patchSticky(s, { open: true }); renderAll(); }));
  here.filter(s => !s.open).forEach(s => patchSticky(s, { open: true }));
  if (here.length) { S.focus = { sel: '#' + stickyFieldId(here[here.length - 1]) }; renderAll(); }
}
// The first line with text, cut at a word near max (48 for a note's name, as the mockup did; 120 for a task)
function stickyTitle(s, max = 48) {
  const l = (s.text.split('\n').find(x => x.trim()) || '').trim().replace(/^#+\s*/, '');
  if (l.length <= max) return l;
  const cut = l.slice(0, max), sp = cut.lastIndexOf(' ');
  return (sp > max / 2 ? cut.slice(0, sp) : cut).replace(/[\s,.;:–—-]+$/, '') + '…';
}
// Gone from the list, and from the trail (its "Sticky #n" step would lead nowhere)
function forgetSticky(s) { D.stickies = D.stickies.filter(x => x !== s); S.trail = S.trail.filter(x => x.go?.sticky !== s.id); S.visits = (S.visits || []).filter(x => x.go?.sticky !== s.id); }
// Gone from the overlay once it has become a note or a task (the backend copy too)
async function dropSticky(s) { clearTimeout(s.saveT); s.dirty = false; forgetSticky(s); const r = await capCall('delete_sticky', rawId(s.id)); if (failed(r)) toast(r.message); }

/* ---- The ⋮ menu: promote to a note (opens it in a tab), append to a note, attach to a folder, convert to a timed task ---- */
// A new note from the sticky in a folder: through save_note with a live vault, as newItem() makes one. Returns the note, or null
async function noteFromSticky(s, folder) {
  const title = uniqueName(cleanName(stickyTitle(s)) || 'Sticky note', folder, 'note');
  let id = 'note-' + Date.now(), home = folder, mtime = iso(new Date()), ctime = mtime;
  if (VAULT.live) {
    const [f, p] = placeArgs(folder); const r = await nv('save_note', null, title, s.text, rootProject(folder)?.name || '', p, 'sticky', f);
    if (failed(r)) { toast(r.message || "Couldn't make the note."); return null; }
    id = 'n-' + r.id; home = homeOf(r) || folder; mtime = ctime = r.updated_at;
  }
  const n = { id, title, category: rootProject(home)?.name || '', oldCategory: '', folder: home, tags: ['sticky'], md: s.text, mtime, ctime };
  D.notes.unshift(n); if (VAULT.live) primeOne(n);
  return n;
}
const cleanName = t => String(t || '').replace(/[\\/:*?"<>|]/g, '').trim();   // a note or folder name can't hold these
const primeOne = n => { n.lineBase = []; syncLineTasks(n); };   // Phase 3: its "- [ ]" lines become tasks
async function stickyPromote(id) {
  const s = stickyById(id), folder = targetFolder(); S.stickyMenu = null; if (!s) return;
  if (!folder) { toast('Create a project folder first'); return; }
  await saveStickyText(s); const n = await noteFromSticky(s, folder); if (!n) return;
  await dropSticky(s); ancestors(n.folder).forEach(f => S.open.add(f));
  status(`Promoted sticky #${s.n} to ${folderPath(n.folder).join(' / ')}`); openNote(n.id, true, true);
}
function openStickyPick(act, id) { S.stickyMenu = null; S.pickSticky = id; S.moveQ = ''; S.modal = act; S.focus = { sel: '#move-filter' }; renderAll(); }
async function stickyPick(v) {
  const s = stickyById(S.pickSticky); if (!s || S.busy) return;
  await saveStickyText(s);
  if (S.modal === 'sticky-append') {
    const n = D.notes.find(x => x.id === v); if (!n) return;
    syncDoc(n); const was = n.md, quote = s.text.trim().split('\n').map(l => ('> ' + l).trimEnd()).join('\n');
    n.md = n.md.replace(/\s*$/, '') + `\n\n> From sticky #${s.n}:\n${quote}\n`; n.html = null; n.mtime = iso(new Date()); n.dirty = true;
    S.busy = true; const r = await saveNote(n); S.busy = false;
    if (failed(r)) { n.md = was; n.html = null; toast(r.message || "Couldn't save the note."); return; }   // the sticky stays, so nothing is added twice
    await dropSticky(s); closeModal(true); toast(`Appended to "${n.title}"`); renderAll(); return;
  }
  let folder = v;
  if (v === '__new') {   // a new folder, made inline, inside the folder you're in
    const parent = topOf(targetFolder()), name = uniqueName(cleanName(S.moveQ) || 'New folder', parent, 'folder');
    folder = (parent === null ? 'p-' : 'f-') + Date.now();   // Build V: at the vault's top a new folder is a project
    if (VAULT.live) { S.busy = true; const r = parent === null ? await nv('create_project', name) : await nv('create_folder', name, ...placeArgs(parent)); S.busy = false; if (failed(r)) { toast(r.message || "Couldn't make the folder."); return; } folder = (parent === null ? 'p-' : 'f-') + r.id; if (parent === null) D.projects.push({ id: folder, name, color: r.color_slot || 1 }); }
    if (parent !== null || !VAULT.live) D.folders.push({ id: folder, name, parent });
  }
  S.busy = true; const n = await noteFromSticky(s, folder); S.busy = false; if (!n) return;
  await dropSticky(s); ancestors(n.folder).forEach(f => S.open.add(f)); S.scrollTo = n.id;
  closeModal(true); toast(`Filed sticky #${s.n} in ${folderPath(n.folder).join(' / ')}`); renderAll();
}
// A task with a 15-minute estimate (one timed step), linked to the quick timer, which starts on it
const STICKY_TASK_MIN = 15;
async function stickyTask(id) {
  const s = stickyById(id); S.stickyMenu = null; if (!s) return;
  await saveStickyText(s);
  const n = UI.view === 'notes' ? note() : null, title = stickyTitle(s, 120) || 'Sticky task', description = /\n/.test(s.text.trim()) ? s.text.trim() : '';
  const pj = (n && rootProject(n.folder)) || proj(T.projectId) || D.projects[0] || null;
  const tk = await addTask({ title, project: n ? null : pj?.id || null, noteId: n?.id || null, priority: 'Medium', energy: 'medium', description });
  if (!tk) return;
  await addStep(tk, title, STICKY_TASK_MIN);
  await dropSticky(s); T.link = 'task:' + tk.id; S.qtDur = STICKY_TASK_MIN;
  if (!qtOpen()) UI.widgets = 'timer';
  if (pj && UI.tstate === 'idle') { status(`${STICKY_TASK_MIN}-minute timer: ${title}`); startSession('planned', STICKY_TASK_MIN, pj.id, tk.id); toast(`Task added · ${STICKY_TASK_MIN}-minute timer started`); }
  else { renderAll(); toast(!pj ? 'Task added · make a project to time it' : UI.tstate === 'rate' ? 'Task added · log the last session, then start it' : 'Task added · linked to the timer that is running'); }
}

/* ---- Cards on the overlay layer, above every tab ---- */
function stickyPos(s, w, h) {
  const W = app.offsetWidth || 1600, H = app.offsetHeight || 900;
  let x = s.x, y = s.y;
  if (x == null) { const i = openStickies().indexOf(s); x = Math.min(W - w - 8, 420 + i * 40); y = 150 + i * 44; }
  return { x: clamp(x, 4, Math.max(4, W - w - 4)), y: clamp(y, 4, Math.max(4, H - h - 8)) };
}
/* Build H (R34, locked: Paper): the whole note in its colour, dark text on every theme; titled by its first line; "Saved 15:42"
   (the file is in the tooltip); 20px colour dots and a resize corner. Pop out is on its head and first in its ⋮ menu.
   Popped out (its own window, popout.js), the head is the window's strip: Keep on top, Back into NeuroVault, ⋮ and close. */
function stickyCard(s) {
  const out = popped('st:' + s.id), W = app.offsetWidth || 1600, H = app.offsetHeight || 900, w = Math.min(s.w || 248, W - 8), h = Math.min(s.h || 224, H - 12), pos = stickyPos(s, w, h);
  const place = out ? '' : `left:${pos.x}px;top:${pos.y}px${s.w ? `;width:${w}px;height:${h}px` : ''}`, title = stickyTitle(s) || 'New sticky note', cap = c => c[0].toUpperCase() + c.slice(1);
  const dots = `<span class="colour-dots" role="group" aria-label="Colour">${STICKY_COLOURS.map(c => `<button class="colour-dot dot-${c}" data-act="sticky-colour" data-v="${s.id}:${c}" aria-pressed="${s.color === c}" aria-label="${cap(c)}" title="${cap(c)}"></button>`).join('')}</span>`;
  const menuBtn = `<button class="icon-btn icon-btn--sm" data-act="sticky-menu" data-v="${s.id}" aria-haspopup="menu" aria-expanded="${S.stickyMenu === s.id}" aria-label="Sticky note actions" title="Promote, append, attach or time it">${ic('more')}</button>`;
  const btns = out ? popBtns('st:' + s.id) + menuBtn + popCloseBtn('st:' + s.id, 'sticky note ' + s.n)
    : popOutBtn('st:' + s.id) + menuBtn + `<button class="icon-btn icon-btn--sm" data-act="sticky-close" data-v="${s.id}" aria-label="Close sticky note ${s.n}" title="Close (it stays saved)">${ic('x')}</button>`;
  const menu = S.stickyMenu === s.id ? `<div class="menu card" role="menu" aria-label="Sticky note ${s.n}">
      ${out ? '' : `<button class="menu-item" role="menuitem" data-act="pop-out" data-v="st:${s.id}">${ic('popout')}Pop out, on top of other apps</button><div class="menu-sep"></div>`}
      <button class="menu-item" role="menuitem" data-act="sticky-promote" data-v="${s.id}">${ic('file')}Promote to full note</button>
      <button class="menu-item" role="menuitem" data-act="sticky-append" data-v="${s.id}" ${D.notes.length || out ? '' : 'disabled'}>${ic('link')}Append to an existing note…</button>
      <button class="menu-item" role="menuitem" data-act="sticky-attach" data-v="${s.id}">${ic('folder')}Attach to a project or folder…</button>
      <button class="menu-item" role="menuitem" data-act="sticky-task" data-v="${s.id}">${ic('timer')}Convert to a timed task</button></div>` : '';
  return `<section class="widget sticky sticky--r34 sticky--paper sticky--${s.color}${out ? ' is-popped' : ''}" style="${place}" aria-label="Sticky note ${s.n}" data-widget="st:${s.id}">
    <div class="widget-head" data-drag-widget="st:${s.id}"><span class="widget-grip" aria-hidden="true">${ic('grip')}</span><span class="widget-title" title="Sticky #${s.n}">${esc(title)}</span>${btns}</div>${menu}
    <textarea class="sticky-text" id="${stickyFieldId(s)}" data-act="sticky-text" data-v="${s.id}" aria-label="Sticky note ${s.n}" placeholder="Jot it down. It saves as you type.">${esc(s.text)}</textarea>
    <div class="sticky-foot"><span class="truncate" data-sticky-status="${s.id}" title="Kept in NeuroVault: open it again from Sticky Notes in the sidebar">${esc(stickyStatus(s))}</span>${dots}</div><span class="st-grip" aria-hidden="true"></span></section>`;
}
const stickyLayer = () => openStickies().map(stickyCard).join('');

/* ---- Sticky triage pickers: append to a note (fuzzy), or attach to a folder (with "new folder" inline) ---- */
function stickyPickModal() {
  const q = S.moveQ.trim().toLowerCase(), s = stickyById(S.pickSticky); if (!s) return '';
  const append = S.modal === 'sticky-append';
  let rows;
  if (append) rows = D.notes.filter(n => !q || fuzzy(n.title.toLowerCase(), q)).slice(0, 30).map(n => `<button class="list-item" data-act="sticky-pick" data-v="${n.id}"><span class="list-item-main"><span class="list-item-title truncate">${esc(n.title)}</span><span class="list-item-sub truncate">${esc(folderPath(n.folder).join(' / '))}</span></span></button>`).join('');
  else { const all = []; const walk = (pid, depth) => childrenOf(pid).fs.forEach(f => { all.push({ id: f.id, depth, path: folderPath(f.id).join(' / ') }); walk(f.id, depth + 1); }); walk(null, 0);
    rows = all.filter(f => !q || f.path.toLowerCase().includes(q)).map(f => `<button class="list-item list-item--tree" data-act="sticky-pick" data-v="${f.id}" style="--depth:${q ? 0 : f.depth}"><span class="tree-name">${esc(q ? f.path : folderName(f.id))}</span></button>`).join('')
      + (q && targetFolder() ? `<button class="list-item" data-act="sticky-pick" data-v="__new"><span class="list-item-main"><span class="list-item-title">${ic('folderplus')} New folder "${esc(S.moveQ.trim())}"</span><span class="list-item-sub">Inside ${esc(folderPath(targetFolder()).join(' / '))}</span></span></button>` : ''); }
  return dlg({ id: S.modal, size: 'md', top: true, title: append ? `Append sticky #${s.n} to…` : `Attach sticky #${s.n} to…`, titleId: 'sp-t', titleCls: 'truncate',   // Build L: R41's anatomy, medium
    pre: `<input class="picker-input" id="move-filter" data-act="move-filter" placeholder="${append ? 'Type a note name' : 'Type a folder name, or a new one'}" value="${esc(S.moveQ)}" aria-label="Filter">
    <div class="picker-list">${rows || '<div class="empty empty--compact"><div class="empty-text">Nothing matches.</div></div>'}</div>` });
}

/* ---- Brain dump: one line straight into the inbox (Ctrl+Shift+D anywhere, the window bar's inbox button, the sidebar's inbox row) ---- */
const inboxToday = () => D.inbox.filter(x => !x.done && (!x.day || x.day === todayKey()));   // the sample's thoughts are today's
const dumpBar = () => { const today = inboxToday(); return `<div class="card dump" role="dialog" aria-label="Brain Dump"><div class="dump-head">${ic('inbox')}<input class="dump-input" id="dump-input" data-act="dump-input" placeholder="Dump a thought. Enter saves it to the Brain Dump" value="${esc(S.dumpDraft || '')}" aria-label="Thought to capture" autocomplete="off">${typeof dumpMicA === 'function' ? dumpMicA() : ''}<button class="icon-btn icon-btn--sm" data-act="close" aria-label="Close the Brain Dump" title="Close (Esc)">${ic('x')}</button></div>
  <div class="dump-list"><div class="eyebrow">In the Brain Dump today · ${today.length}</div>${today.slice().reverse().slice(0, 6).map(x => (typeof dumpItemA === 'function' && dumpItemA(x)) || `<div class="dump-item"><span class="num">${esc(x.t)}</span><span>${esc(x.text)}</span></div>`).join('') || '<div class="list-item-sub">Nothing captured yet today.</div>'}</div></div>`; };
// Opens (never toggles: the global hotkey and the page's own key can both fire) and puts the caret in the box
function openDump() {
  S.menu = false; S.edPop = null; S.stickyMenu = null; S.ctx = null;
  if (S.modal !== 'dump') { S.modal = 'dump'; renderAll(); }
  const el = app.querySelector('#dump-input'); if (el) { el.focus(); el.setSelectionRange(el.value.length, el.value.length); }
}
async function dumpEnter(input) {
  const text = input.value.replace(/\s+/g, ' ').trim(); if (!text) return;
  input.value = S.dumpDraft = ''; let item;   // cleared at once: the next thought can be typed (and sent) while this one saves
  if (CAPTURE.live) { const r = await nv('add_inbox_item', text);
    if (failed(r)) { if (!S.dumpDraft) S.dumpDraft = text; S.focus = { sel: '#dump-input', pos: 1e4 }; toast(r.message || "Couldn't save to the Brain Dump."); return; }
    item = mapInbox(r.item); }
  else { const d = new Date(); item = { id: 'in-' + Date.now(), t: clock(d), day: todayKey(), text, done: false }; }
  D.inbox.push(item); status('Added to the Brain Dump'); S.focus = { sel: '#dump-input', pos: 1e4 }; toast('Saved to the Brain Dump');
}
// The sidebar's two rows: the inbox opens the capture bar (with today's thoughts), sticky notes shows them all
function captureTree(kind) { if (kind === 'inbox') openDump(); else showSticky(); }

/* ==== Fix C (QC round 3, item 7): a click away closes the Brain Dump, like Esc and ×. The half-typed thought stays in
   S.dumpDraft, so it's back next time. It stays open while a voice thought records or a clip in it plays. ==== */
const dumpBusy = () => (typeof voiceOpen === 'function' && voiceOpen()) || Object.values(S.clips || {}).some(o => o.playing);
document.addEventListener('click', e => {   // capture phase, as the sticky menu's click-away
  const t = e.target;   // Fix A (QC 4 · 30): the field's spelling menu and Check spelling card count as inside
  if (S.modal !== 'dump' || !t.closest || t.hidden || t.closest('.dump, .menu--word, .spellpass') || t.closest('[data-act="dump"]') || !t.isConnected || dumpBusy()) return;   // hidden: fire()'s stand-in button
  const el = app.querySelector('#dump-input'); if (el) S.dumpDraft = el.value;
  // Only the bar goes (no re-render), so the click lands where it was aimed: the caret goes into the note you clicked
  closeModal(true); app.querySelector('.dump')?.remove();
  app.querySelectorAll('[data-act="dump"][aria-pressed]').forEach(b => b.setAttribute('aria-pressed', 'false'));
}, true);
/* ==== end Fix C ==== */
