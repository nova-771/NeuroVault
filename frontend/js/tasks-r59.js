/* Build M · R59, tasks kept out of notes (the first user: "tasks is added to notes, would like if there was an option to keep it
   separate without it appearing in any notes (though manageable)"; r59-tlink a quiet link; r59-texist the drawn default).
   Settings → Vault & files → Where tasks live: In their notes (as before) | Only in Tasks (config tasks_keep_out).
   - Only in Tasks: a new task (quick add, voice, the Brain Dump, a sticky) never goes into a note's text: it keeps a link to its
     note, and the note shows one quiet "3 tasks from this note" in its header, which opens them in Tasks (store.js addTask,
     voice-attach.js and render-voice.js follow tkoOn()).
   - Turning it on asks once about the tasks already in notes: Move them to Tasks (their lines leave the notes' text, each task
     keeping its link; nothing is deleted and the Timeline can put the lines back) or Leave them in the notes (they still show
     there). */
'use strict';
const TKO = { on: false, left: false, since: '', ask: null, busy: false, demoMoves: {} };
const tkoOn = () => !!TKO.on;

/* ---- what a note shows: its {{tasks}} block only shows the tasks left in notes, made before Only in Tasks was turned on ---- */
{ const tl0 = taskLines;
  taskLines = function (n) {   // eslint-disable-line no-global-assign
    const all = tl0.apply(this, arguments); if (!tkoOn()) return all;
    return TKO.left ? all.filter(t => !t.created || !TKO.since || t.created < TKO.since) : [];   // left in: what was there before (no date: older than the setting)
  };
}
const tkoNoteTasks = n => D.tasks.filter(t => t.noteId === n.id && !isLineTask(t, n) && !taskLines(n).includes(t));
function tkoNoteLink(n) {   // r59-tlink: one quiet link in the note's header
  if (!tkoOn() || !n) return ''; const l = tkoNoteTasks(n); if (!l.length) return '';
  const open = l.filter(t => !t.done).length, label = `${l.length} task${l.length === 1 ? '' : 's'} from this note`;
  return `<button class="link-btn tko-link" data-act="tko-open" data-v="${esc(n.id)}" title="Open them in Tasks${open < l.length ? ` · ${open} open` : ''}">${ic('check')}${label}</button>`;
}
// Tasks: "note:<id>" shows that note's tasks
{ const tb0 = taskBase;
  taskBase = function () { const f = S.taskFilter; if (String(f).startsWith('note:')) return D.tasks.filter(t => t.noteId === f.slice(5)); return tb0.apply(this, arguments); };   // eslint-disable-line no-global-assign
}

/* ---- Settings → Vault & files → Where tasks live ---- */
VAULT_PAGE.push(() => `<div class="set-row tko-set"><div><div class="set-label" id="tko-where">Where tasks live</div><div class="set-desc">${tkoOn()
  ? 'Only in Tasks: new tasks never go into a note’s text. A note links to its tasks (“3 tasks from this note”).'
  : 'In their notes: a task made from a note shows in it, as a list. Only in Tasks keeps them out of every note.'}</div></div>
  <div class="seg" role="group" aria-labelledby="tko-where">${[['in', 'In their notes'], ['out', 'Only in Tasks']].map(([v, l]) => `<button class="seg-opt" data-act="tko-where" data-v="${v}" aria-pressed="${(v === 'out') === tkoOn()}">${l}</button>`).join('')}</div></div>`);
function tkoSave(patch) { Object.assign(TKO, { on: patch.tasks_keep_out ?? TKO.on, left: patch.tasks_keep_out_left ?? TKO.left, since: patch.tasks_keep_out_since ?? TKO.since }); if (!CHECK) saveSettings(patch); else (TKO.saved ||= []).push(patch); }
// the tasks in notes now, for the question: the backend's count, or (no app) the page's
function tkoCountHere() {
  const out = []; D.notes.forEach(n => { const lines = mdTaskLines(n.md).length, block = /^\{\{tasks\}\}[ \t]*$/m.test(n.md) ? D.tasks.filter(t => t.noteId === n.id && !isLineTask(t, n)).length : 0;
    if (lines + block) out.push({ id: n.id, title: n.title, count: lines + block }); });
  return { notes: out, total: out.reduce((s, x) => s + x.count, 0) };
}
async function tkoWhere(v) {
  if ((v === 'out') === tkoOn()) return;
  if (v === 'in') { tkoSave({ tasks_keep_out: false, tasks_keep_out_left: false, tasks_keep_out_since: '' }); status('New tasks show in their notes again. Tasks moved out stay in Tasks; the Timeline can put their lines back.'); renderAll(); return; }
  const got = realData() ? await nv('tasks_in_notes') : tkoCountHere();
  if (failed(got) || !got.total) { tkoSave({ tasks_keep_out: true, tasks_keep_out_left: false, tasks_keep_out_since: new Date().toISOString() }); status('Tasks now live only in Tasks'); renderAll(); return; }
  TKO.ask = got; S.modal = 'tko-ask'; S.focus = { sel: '.tko-ask [data-act="tko-move"]' }; renderAll();
}
function tkoAskHtml() {
  const a = TKO.ask; if (!a) return ''; const n = a.notes.length;
  const list = a.notes.slice(0, 5).map(x => `<li><span class="truncate">${esc(x.title || 'Untitled')}</span><span class="set-desc num">${x.count}</span></li>`).join('') + (n > 5 ? `<li class="set-desc">and ${n - 5} more note${n - 5 === 1 ? '' : 's'}</li>` : '');
  return dlg({ id: 'tko-ask', size: 'sm', cls: 'tko-ask', title: 'Keep tasks out of notes', x: 'tko-cancel', xLabel: 'Cancel: nothing changes',
    body: `<p class="set-desc">${a.total} task${a.total === 1 ? ' is' : 's are'} in ${n} note${n === 1 ? '' : 's'} now. Move them to Tasks? Each keeps a link to its note. Nothing is deleted: the Timeline can put the lines back.</p><ul class="tko-notes">${list}</ul>`,
    others: ['<button class="btn btn--secondary" data-act="tko-cancel">Cancel</button>', '<button class="btn btn--secondary" data-act="tko-leave">Leave them in the notes</button>'],
    main: `<button class="btn btn--primary" data-act="tko-move"${TKO.busy ? ' disabled' : ''}>${TKO.busy ? 'Moving…' : 'Move them to Tasks'}</button>` });
}
{ const m0 = renderModal; renderModal = function () { return S.modal === 'tko-ask' ? tkoAskHtml() : m0.apply(this, arguments); }; }   // eslint-disable-line no-global-assign
// a note the backend changed: its text, with its "- [ ]" lines as the new baseline (so the page never takes a moved line for a deleted task)
async function tkoReload(rawNoteId) {
  const row = await nv('get_note', rawNoteId); if (!row || failed(row)) return null;
  const n = D.notes.find(x => x.id === 'n-' + rawNoteId); if (!n) return null;
  clearTimeout(n.saveT); n.md = row.content || ''; n.html = null; n.dirty = false; n.lineBase = mdTaskLines(n.md).map(l => l.title); n.mtime = row.updated_at || n.mtime; return n;
}
async function tkoMove() {
  if (TKO.busy) return; TKO.busy = true; renderAll(); const since = new Date().toISOString(); let total = 0, notes = 0;
  try {
    if (realData()) {
      await flushSaves(); const r = await nv('tasks_move_out'); if (failed(r)) { toast(r.message || "The tasks couldn't be moved"); return; }
      for (const m of r.moved) await tkoReload(m.note_id); total = r.total; notes = r.moved.length;
      if (typeof bmActivity === 'function') { S.bm.actAt = 0; bmActivity(); }
    } else {   // no app: the same, in the page, with a Timeline row for each note (Restore puts its text back)
      tkoCountHere().notes.forEach(x => { const n = D.notes.find(y => y.id === x.id); const before = n.md;
        n.md = n.md.split('\n').filter((l, i) => !/^\{\{tasks\}\}[ \t]*$/.test(l) && !mdTaskLines(n.md).some(t => t.line === i)).join('\n').replace(/\n{3,}/g, '\n\n'); n.html = null; n.lineBase = mdTaskLines(n.md).map(l => l.title);
        const id = 'tm-' + x.id; TKO.demoMoves[id] = { id: x.id, before, after: n.md };
        D.events.unshift({ id, at: since, time: 'Just now', range: 'Today', type: 'Tasks', noteId: x.id, restoreId: id, restoreAct: 'tko-restore', restored: false,
          title: `Moved ${x.count} task${x.count === 1 ? '' : 's'} out of “${x.title}” to Tasks`, desc: 'Each keeps a link to its note · Restore puts the lines back' }); total += x.count; notes++; });
    }
    tkoSave({ tasks_keep_out: true, tasks_keep_out_left: false, tasks_keep_out_since: since }); TKO.ask = null; closeModal(true);
    status(`Moved ${total} task${total === 1 ? '' : 's'} out of ${notes} note${notes === 1 ? '' : 's'} to Tasks: each keeps a link to its note`);
  } finally { TKO.busy = false; renderAll(); }
}
async function tkoRestore(id) {
  const ev = (D.events || []).find(e => e.restoreId === id);
  if (!realData()) { const m = TKO.demoMoves[id], n = m && D.notes.find(x => x.id === m.id); if (n && n.md === m.after) { n.md = m.before; n.html = null; n.lineBase = mdTaskLines(n.md).map(l => l.title); }
    if (ev) { ev.restored = true; ev.desc = 'Restored · the lines are back in the note'; } status('The task lines are back in the note'); renderAll(); return; }
  const r = await nv('restore_task_move', id); if (failed(r)) { toast(r.message || "The lines couldn't go back"); return; }
  await tkoReload(r.note_id); S.bm.actAt = 0; await bmActivity(); status(`The task lines are back in “${r.title}”`); renderAll();
}
app.addEventListener('click', e => {
  const b = e.target.closest?.('[data-act^="tko-"]'); if (!b) return; e.stopImmediatePropagation(); const act = b.dataset.act, v = b.dataset.v;
  if (act === 'tko-where') tkoWhere(v);
  else if (act === 'tko-cancel') { TKO.ask = null; closeModal(true); status('Nothing changed'); renderAll(); }
  else if (act === 'tko-leave') { TKO.ask = null; closeModal(true); tkoSave({ tasks_keep_out: true, tasks_keep_out_left: true, tasks_keep_out_since: new Date().toISOString() }); status('Tasks now live only in Tasks; the ones already in notes stay there'); renderAll(); }
  else if (act === 'tko-move') tkoMove();
  else if (act === 'tko-restore') tkoRestore(isNaN(+v) ? v : +v);
  else if (act === 'tko-open') { S.taskFilter = 'note:' + v; setUI('view', 'tasks'); status(`Tasks from “${D.notes.find(n => n.id === v)?.title || 'this note'}”`); }
}, true);
document.addEventListener('keydown', e => { if (S.modal === 'tko-ask' && e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); TKO.ask = null; closeModal(true); renderAll(); } }, true);
{ const rc0 = readerFromConfig;
  readerFromConfig = function (c) { rc0(c); if (CHECK) return; TKO.on = !!c.tasks_keep_out; TKO.left = !!c.tasks_keep_out_left; TKO.since = c.tasks_keep_out_since || ''; };   // eslint-disable-line no-global-assign
}

/* ---- voice: with Only in Tasks, a ramble's ticked tasks become tasks linked to the note, not "- [ ]" lines in it ---- */
{ const vm0 = voiceMarkdown;
  voiceMarkdown = function () {   // eslint-disable-line no-global-assign
    const r = vm0.apply(this, arguments); if (!tkoOn()) return r;
    const R = S.voice.result, text = segs => segs.map(s => s[0]).join('').trim();
    return { md: R.paras.map(p => mdText(text(p))).filter(Boolean).join('\n\n'), tasks: r.tasks };
  };
  const va0 = voiceAccept;
  voiceAccept = async function () {   // eslint-disable-line no-global-assign
    const titles = tkoOn() && VAULT.live ? voiceMarkdown().tasks : []; await va0.apply(this, arguments);
    const n = titles.length && note(); if (n) for (const title of titles) await addTask({ title, noteId: n.id, priority: 'Medium', energy: 'medium', due: null });
  };
}
async function tkoVoiceTasks(n, tasks) {   // voice-attach.js: the ticked ones, linked to the note
  if (!tkoOn() || !VAULT.live || !n) return;
  for (const t of tasks.filter(x => x.on)) await addTask({ title: unescMd(mdText(t.title)), noteId: n.id, priority: 'Medium', energy: 'medium', due: null });
}
