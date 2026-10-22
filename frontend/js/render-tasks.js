/* Tasks board: quick add, filters, energy badges and micro-steps.
   Extracted from design/vault-notes-mockups.html (R20). Phase 3: on real data through store.js's "PHASE 3 · TASKS DATA".
   Build I: the page is mockup R35's "Today, Upcoming and Done, each its own card" (locked 2026-10-16), from the R35 code
   (r35Tasks, r35Card, r35Row, r35Steps, r35Quick, r35Act and the r35-* CSS), plus the decisions: a date picker
   with Today, Tomorrow and Later beside it, an Overdue card above Today, Delete under ⋯ with Undo in the status bar,
   and the energy chip keeping its click cycle while looking like a button. Data: store.js "BUILD I · TASKS PAGE DATA". */
'use strict';
// Phase 3: what the quick-add row holds between renders, and which card is adding a step by hand
// Build I: due ("YYYY-MM-DD", or null for Later); a choice changes it without a re-render (R35)
S.taskDraft = { title: '', note: null, priority: 'Medium', energy: 'medium', due: undefined };   // note: a note id, a project id (no note) or ''
S.stepAdd = null;
S.taskStay = new Map();   // Build I: tasks ticked or unticked since the view or filter last changed keep their card (R35 r35stay)
S.taskShowDone = false;   // Build I: the Done card is folded until Show
S.taskMenu = null;        // Build I: the row whose ⋯ menu is open
const TASK_PRIO = { Critical: 0, High: 0, Medium: 1, Low: 2 };
const taskDone = t => S.taskStay.has(t.id) ? S.taskStay.get(t.id) : t.done;   // ticked just now: shown where it was
const draftDue = () => S.taskDraft.due === undefined ? todayKey() : S.taskDraft.due;
// Within a card: oldest due date first, then High → Low, then as the database listed them
const taskSort = l => l.map((t, i) => [t, i]).sort(([a, i], [b, j]) => ((taskDue(a) || '9') < (taskDue(b) || '9') ? -1 : (taskDue(a) || '9') > (taskDue(b) || '9') ? 1 : 0)
  || ((TASK_PRIO[a.priority] ?? 1) - (TASK_PRIO[b.priority] ?? 1)) || i - j).map(x => x[0]);
// The energy and project filters; the view filters (Due today, Upcoming, Completed) pick the cards
function taskBase() {
  const f = S.taskFilter, ef = f.startsWith('energy:') ? f.slice(7) : null;
  return D.tasks.filter(t => ef ? t.energy === ef && !taskDone(t) : ['All', 'Today', 'Upcoming', 'Completed'].includes(f) || taskProjectName(t) === f);
}
const taskLabel = () => S.taskFilter.startsWith('energy:') ? ENERGY[S.taskFilter.slice(7)][1] : { All: 'All tasks', Today: 'Due today', Upcoming: 'Upcoming', Completed: 'Completed' }[S.taskFilter] || (S.taskFilter.startsWith('note:') ? `From “${D.notes.find(n => n.id === S.taskFilter.slice(5))?.title || 'a note'}”` : S.taskFilter);   // Build M · R59
const taskCount = l => { const d = l.filter(t => t.done).length; return `${l.length - d} open${d ? ` · ${d} done` : ''}`; };
const splitModel = () => { const r = aiSt().routes.split; return r.name || r.label; };

function viewTasks() {
  const head = `<div class="view-head"><div><h1 class="view-title">Tasks</h1><p class="view-sub">Every "- [ ]" line in your notes, in one place. Low on energy? Filter by Low battery.</p></div></div>`;
  let board;
  if (UI.state === 'loading') board = `<section class="card tp-card"><div class="tp-rows">${Array.from({ length: 4 }, () => `<div class="tp-row"><span></span><div class="skel" style="height:14px;width:60%"></div></div>`).join('')}</div></section>`;
  else if (!D.tasks.length) board = `<section class="card empty"><div class="empty-title">No tasks yet</div><div class="empty-text">Type one above and press Enter, or write "- [ ]" in any note.</div></section>`;
  else {
    const base = taskBase(), f = S.taskFilter, open = g => taskSort(base.filter(t => !taskDone(t) && (Array.isArray(g) ? g.includes(dueGroup(t)) : dueGroup(t) === g)));
    const late = open('overdue'), today = open('today'), up = open(['upcoming', 'later']), done = base.filter(taskDone);
    const cards = [f !== 'Upcoming' && f !== 'Completed' && late.length ? taskCard('Overdue', late) : '',
      f !== 'Upcoming' && f !== 'Completed' && (today.length || f === 'Today') ? taskCard('Today', today, { empty: late.length ? 'Nothing else due today.' : 'Nothing due today.' }) : '',
      f !== 'Today' && f !== 'Completed' && (up.length || f === 'Upcoming') ? taskCard('Upcoming', up, { empty: 'Nothing coming up.' }) : '',
      f !== 'Today' && f !== 'Upcoming' && done.length ? taskCard('Done', done, { fold: f !== 'Completed' && !S.taskShowDone }) : ''].filter(Boolean);
    board = cards.length ? cards.join('') : `<section class="card empty tp-empty"><div class="empty-text">Nothing in "${esc(taskLabel())}". <button class="btn btn--secondary btn--sm" data-act="task-filter" data-v="All">Show all tasks</button></div></section>`;
  }
  return `<section class="view tp"><div class="view-inner">${head}${quickAdd()}<div class="tp-board" id="tasks-main-board">${board}</div></div></section>`;
}
function taskCard(title, list, { fold, empty } = {}) {
  const head = `<div class="tp-card-head"><h2 class="tp-card-title">${esc(title)}</h2><span class="tp-card-val num">${fold === undefined ? taskCount(list) : list.length + ' done'}</span>${fold !== undefined ? `<button class="btn btn--secondary btn--sm" data-act="task-done-fold" aria-expanded="${!fold}">${fold ? 'Show' : 'Hide'}</button>` : ''}</div>`;
  const rows = fold ? '' : list.length ? `<div class="tp-rows">${list.map(taskRow).join('')}</div>` : `<div class="empty empty--compact tp-empty"><div class="empty-text">${empty || 'Nothing here.'}</div></div>`;
  return `<section class="card tp-card${fold ? ' is-folded' : ''}" aria-label="${esc(title)}" data-card="${esc(title.toLowerCase())}">${head}${rows}</section>`;
}
// The project and note as one chip that opens the note (R35 "one place")
function taskWhere(t) {
  const n = taskNote(t), pj = taskProjectName(t), label = n ? `${pj ? pj + ' / ' : ''}${n.title || 'Untitled'}` : pj ? `${pj} · no note` : 'No note';
  return `<button class="chip chip--neutral chip--act tp-where" data-act="note" data-v="${n ? n.id : ''}" ${n ? '' : 'disabled'} title="${n ? 'Open ' + esc(label) : 'Not in a note'}">${ic('file')}<span>${esc(label)}</span></button>`;
}
function taskRow(t) {
  const done = t.done, due = taskDue(t), grp = dueGroup(t);
  const meta = `<div class="tp-meta">${energyChip(t)}${taskWhere(t)}${done || S.stepAdd === t.id ? '' : `<button class="chip chip--neutral chip--act" data-act="step-add" data-v="${t.id}" title="Add a step by hand">${ic('plus')}Step</button>`}</div>`;
  return `<div class="tp-row${done ? ' is-done' : ''}" data-task-row="${t.id}">
    <label class="tp-tick" title="${done ? 'Reopen' : 'Mark done'}"><input type="checkbox" data-act="task-done" data-v="${t.id}" ${done ? 'checked' : ''} aria-label="Done: ${esc(t.title)}"></label>
    <div class="tp-main"><div class="tp-title">${esc(t.title)}</div></div>
    <div class="tp-cell"><span class="chip chip--${PRIO[t.priority] || 'neutral'}">${esc(t.priority === 'Critical' ? 'High' : t.priority)}</span></div>
    <div class="tp-cell"><span class="tp-due${!done && (grp === 'today' || grp === 'overdue') ? ' is-now' : ''}" title="${esc(dueLong(due))}">${esc(dueText(due))}</span></div>
    <button class="icon-btn icon-btn--sm tp-wand" data-act="ai-split" data-v="${t.id}" aria-label="Break down: ${esc(t.title)}" title="Break it into small timed steps (${esc(splitModel())})" ${done || S.splitting ? 'disabled' : ''}>${ic('wand')}</button>
    ${taskMenu(t)}${meta}${taskSteps(t)}</div>`;
}
// ⋯ on the row: the due date (Today, Tomorrow, Later, or a date) and Delete; a line task says its line goes too
function taskMenu(t) {
  const on = S.taskMenu === t.id, n = taskNote(t), line = n && isLineTask(t, n), due = taskDue(t);
  const pick = [['today', 'Today', todayKey()], ['tomorrow', 'Tomorrow', dayKeyFrom(1)], ['later', 'Later', null]];
  const menu = on ? `<div class="menu card tp-menu" role="menu" aria-label="Task: ${esc(t.title)}">
      <div class="tp-menu-sec"><span class="tp-opt-label" id="tpm-due-${t.id}">Due</span><div class="tp-due-pick"><div class="seg" role="group" aria-labelledby="tpm-due-${t.id}">${pick.map(([k, l, d]) => `<button type="button" class="seg-opt" data-act="task-due" data-k="${k}" data-v="${t.id}" aria-pressed="${due === d}">${l}</button>`).join('')}</div>
        <input type="date" class="field tp-date" data-act="task-due-date" data-v="${t.id}" value="${due || ''}" aria-label="Due date" title="Pick a date"></div></div>
      <div class="menu-sep"></div>
      <button class="menu-item menu-item--danger" role="menuitem" data-act="task-delete" data-v="${t.id}">${ic('trash')}<span class="tp-menu-text">Delete${line ? `<span class="tp-menu-sub">Its "- [ ]" line leaves "${esc((n.title || 'Untitled').slice(0, 40))}" too</span>` : ''}</span></button></div>` : '';
  return `<div class="tp-more"><button class="icon-btn icon-btn--sm" data-act="task-menu" data-v="${t.id}" aria-haspopup="menu" aria-expanded="${on}" aria-label="More: ${esc(t.title)}" title="Due date, Delete">${ic('more')}</button>${menu}</div>`;
}
// Steps: a 24px tick target, the text, minutes in a fixed column, Start (a quick timer for its minutes) and × to remove
function taskSteps(t) {
  if (S.splitting === t.id) return `<div class="tp-split"><span class="spinner"></span>Breaking it down with ${esc(splitModel())}…</div>`;
  const add = S.stepAdd === t.id ? `<div class="tp-step tp-step--add"><span></span><input class="field" id="new-step-text" placeholder="A small step…" aria-label="New step for: ${esc(t.title)}"><input class="field num" id="new-step-min" inputmode="numeric" maxlength="3" placeholder="min" aria-label="Minutes (optional)">`
    + `<span class="tp-step-btns"><button class="btn btn--primary btn--sm" data-act="step-save" data-v="${t.id}">Add</button><button class="btn btn--secondary btn--sm" data-act="step-cancel">Cancel</button></span></div>` : '';
  if (!(t.steps || []).length && !add) return '';
  return `<div class="tp-steps">${(t.steps || []).map((s, i) => `<div class="tp-step${s.done ? ' is-done' : ''}"><label class="tp-tick"><input type="checkbox" data-act="step-done" data-v="${t.id}:${i}" ${s.done ? 'checked' : ''} aria-label="Done: ${esc(s.t)}"></label><span class="tp-step-text">${esc(s.t)}</span><span class="tp-step-min num">${s.m != null ? s.m + ' min' : ''}</span>`
    + `<button class="btn btn--secondary btn--sm" data-act="step-timer" data-v="${t.id}:${i}" ${s.done || !D.projects.length ? 'disabled' : ''} title="${s.m ? `Start a ${s.m}-minute quick timer` : 'Start a quick timer'}">${ic('play')}Start</button>`
    + `<button class="icon-btn icon-btn--sm step-x" data-act="step-delete" data-v="${t.id}:${i}" aria-label="Delete step: ${esc(s.t)}" title="Delete step">${ic('x')}</button></div>`).join('')}${add}</div>`;
}
/* ---- Phase 3: quick add. The mockup's one Note list carries the project too: a group per project (A to Z) with its notes
        (newest edit first) and "No note" (the task goes on the project alone), then notes outside any project.
        Default: the project filter in use, else the open note.
        Build I (R35): the title, the note and Add task on one line, then Due (Today, Tomorrow, Later and a date picker),
        Priority and Energy as labelled choices that keep one weight and don't re-render ---- */
function quickAdd() {
  const d = S.taskDraft, open = note(), filtered = D.projects.find(p => p.name === S.taskFilter), due = draftDue();
  const home = n => rootProject(n.folder)?.id || '';
  const pick = d.note !== null ? d.note : filtered ? (open && home(open) === filtered.id ? open.id : D.notes.find(n => home(n) === filtered.id)?.id || filtered.id) : open?.id || D.projects[0]?.id || '';
  const opt = (v, l, on) => `<option value="${esc(v)}" ${on ? 'selected' : ''}>${esc(l)}</option>`;
  const group = (label, pid, notes) => `<optgroup label="${esc(label.slice(0, 40))}">${notes.map(n => opt(n.id, (n.title || 'Untitled').slice(0, 40), n.id === pick)).join('')}${opt(pid, pid ? 'No note' : 'No project, no note', pid === pick)}</optgroup>`;
  const seg = (k, name, opts, on) => `<div class="seg" role="group" aria-label="${name}">${opts.map(([v, l, i]) => `<button type="button" class="seg-opt" data-act="task-q" data-k="${k}" data-v="${v}" aria-pressed="${on(v)}">${i ? ic(i) : ''}${l}</button>`).join('')}</div>`;
  const quick = { today: todayKey(), tomorrow: dayKeyFrom(1), later: '' };
  return `<div class="card tp-quick quick-add" role="group" aria-label="Add a task">
    <div class="tp-quick-top"><input class="field" id="new-task-title" data-act="task-draft" data-k="title" value="${esc(d.title)}" placeholder="Add a task…" aria-label="New task">`
    + `<select class="field" id="new-task-note" data-act="task-draft" data-k="note" aria-label="The note it goes in">${D.projects.map(p => group(p.name, p.id, D.notes.filter(n => home(n) === p.id))).join('')}${group('No project', '', D.notes.filter(n => !home(n)))}</select>`
    + `<button class="btn btn--primary" data-act="add-task" title="Add it to the note and the board (Enter)">${ic('plus')}Add task</button></div>
    <div class="tp-quick-opts">
      <div class="tp-opt"><span class="tp-opt-label">Due</span><div class="tp-due-pick">${seg('due', 'Due', Object.entries(quick).map(([k, v]) => [k, k[0].toUpperCase() + k.slice(1)]), k => (quick[k] || null) === due)}<input type="date" class="field tp-date" id="new-task-due" data-act="task-q-date" value="${due || ''}" aria-label="Due date" title="Pick a date"></div></div>
      <div class="tp-opt"><span class="tp-opt-label">Priority</span>${seg('priority', 'Priority', [['High', 'High'], ['Medium', 'Medium'], ['Low', 'Low']], v => d.priority === v)}</div>
      <div class="tp-opt"><span class="tp-opt-label">Energy</span>${seg('energy', 'Energy', Object.entries(ENERGY).map(([k, [i, l]]) => [k, l, i]), v => d.energy === v)}</div></div></div>`;
}
// Phase 3: the "By project" filters: every project that has a task, in the projects' order (A to Z from the API)
function taskProjectFilters() {
  const used = new Set(D.tasks.map(taskProjectName).filter(Boolean)), names = [...new Set([...D.projects.map(p => p.name).filter(p => used.has(p)), ...used])];
  return names.map(p => [p, p, D.tasks.filter(t => taskProjectName(t) === p).length]);
}
/* ---- Tasks: priority and energy badges ---- */
const PRIO = { Critical: 'danger', High: 'danger', Medium: 'warning', Low: 'neutral' };   // Phase 3: the old app's Critical shows as High does
const ENERGY = { high: ['zap', 'High focus', 'accent'], medium: ['cloudsun', 'Medium', 'neutral'], low: ['battery', 'Low battery', 'info'] };
const ENERGY_NEXT = { high: 'medium', medium: 'low', low: 'high' };
// Build I: the energy chip keeps its click cycle (High → Medium → Low) and looks like a button: an edge, the one hover, and the cycle icon
const energyChip = (t, still) => { const [i, l, tone] = ENERGY[t.energy || 'medium']; return still ? `<span class="chip chip--${tone}">${ic(i)}${l}</span>`
  : `<button class="chip chip--${tone} chip--act chip--cycle" data-act="energy" data-v="${t.id}" title="Energy: ${l} · click for ${ENERGY[ENERGY_NEXT[t.energy || 'medium']][1]}">${ic(i)}${l}${ic('cycle')}</button>`; };

/* ---- Build I: the page's own clicks, changes and keys (store.js does the writing) ---- */
// Undo for the last Delete sits in the status bar for 10 seconds (render-shell.js renderStatus asks taskUndoBtn)
const TASK_UNDO = { cur: null, t: 0 };
const taskUndoBtn = () => TASK_UNDO.cur && S.status === TASK_UNDO.cur.msg ? '<button class="btn btn--secondary btn--sm status-undo" data-act="task-undo">Undo</button>' : '';
async function deleteTask(id) {
  const t = taskById(id); if (!t) return;
  const n = taskNote(t), line = n && isLineTask(t, n);
  S.taskMenu = null; S.taskStay.delete(t.id); if (S.stepAdd === t.id) S.stepAdd = null;
  const msg = `Deleted "${t.title.slice(0, 40)}"${line ? ` and its line in "${(n.title || 'Untitled').slice(0, 32)}"` : ''}`;
  const job = trashTask(t); renderAll();
  const u = await job; if (!u) { renderAll(); return; }
  TASK_UNDO.cur = { msg, u }; S.status = msg; clearTimeout(status.t); clearTimeout(TASK_UNDO.t);
  status.t = setTimeout(status.clear, CHECK ? 600000 : 10000); TASK_UNDO.t = setTimeout(() => { TASK_UNDO.cur = null; }, CHECK ? 600000 : 10000);
  S.focus = { sel: '#new-task-title' }; renderAll();
}
async function undoDelete() {
  const c = TASK_UNDO.cur; if (!c) return; TASK_UNDO.cur = null; clearTimeout(TASK_UNDO.t);
  const t = await restoreTask(c.u); if (!t) return;
  status(`Undone: "${t.title.slice(0, 40)}" is back${c.u.line ? ', with its line' : ''}`); renderAll();
}
const tasksApp = document.getElementById('app');
tasksApp.addEventListener('click', e => {
  const b = e.target.closest('[data-act]');
  // the ⋯ menu closes on a click anywhere else
  if (S.taskMenu && !e.target.closest('.tp-more')) { S.taskMenu = null; const m = tasksApp.querySelector('.tp-menu'); if (m) { m.previousElementSibling?.setAttribute('aria-expanded', 'false'); m.remove(); } }
  if (!b || b.disabled || e.target.closest('[data-soon]')) return;
  const act = b.dataset.act, v = b.dataset.v;
  // R35: a ticked or unticked task keeps its card (struck through) until the view or filter changes; noted before the tick lands
  if (act === 'task-done' && !S.taskStay.has(v)) S.taskStay.set(v, !!taskById(v)?.done);
  if (act === 'view' || act === 'task-filter') { S.taskStay = new Map(); S.taskMenu = null; }
  if (act === 'task-q') {   // no re-render, so nothing else moves and what you typed stays
    const k = b.dataset.k; b.parentElement.querySelectorAll('.seg-opt').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
    if (k === 'due') { S.taskDraft.due = v === 'today' ? todayKey() : v === 'tomorrow' ? dayKeyFrom(1) : null; const di = tasksApp.querySelector('#new-task-due'); if (di) di.value = S.taskDraft.due || ''; }
    else S.taskDraft[k] = v;
    return;
  }
  if (act === 'task-done-fold') { S.taskShowDone = !S.taskShowDone; S.focus = { sel: '[data-act="task-done-fold"]' }; renderAll(); return; }
  if (act === 'task-menu') { S.taskMenu = S.taskMenu === v ? null : v; S.focus = S.taskMenu ? { sel: '.tp-menu .seg-opt[aria-pressed="true"], .tp-menu .seg-opt' } : { sel: `[data-act="task-menu"][data-v="${v}"]` }; renderAll(); placeTaskMenu(); return; }
  if (act === 'task-due') { const t = taskById(v); if (!t) return; const d = { today: todayKey(), tomorrow: dayKeyFrom(1), later: null }[b.dataset.k];
    setTaskDue(t, d); S.taskMenu = null; status(`"${t.title.slice(0, 40)}" is due ${d ? dueText(d).replace(/^(\d)/, 'on $1') : 'later, with no date'}`); S.focus = { sel: `[data-act="task-menu"][data-v="${v}"]` }; renderAll(); return; }
  if (act === 'task-delete') { deleteTask(v); return; }
  if (act === 'task-undo') { undoDelete(); return; }
}, true);   // capture: before actions.js, so the tick's place is noted before it lands
tasksApp.addEventListener('change', e => {
  const el = e.target, act = el.dataset?.act;
  if (act === 'task-q-date') { S.taskDraft.due = el.value || null; const quick = { today: todayKey(), tomorrow: dayKeyFrom(1), later: null };
    el.closest('.tp-due-pick')?.querySelectorAll('.seg-opt').forEach(x => x.setAttribute('aria-pressed', String(quick[x.dataset.k] === S.taskDraft.due))); return; }
  if (act === 'task-due-date' && el.value) { const t = taskById(el.dataset.v); if (!t) return; setTaskDue(t, el.value); S.taskMenu = null;
    status(`"${t.title.slice(0, 40)}" is due ${dueText(el.value).replace(/^(\d)/, 'on $1')}`); S.focus = { sel: `[data-act="task-menu"][data-v="${t.id}"]` }; renderAll(); }
});
tasksApp.addEventListener('keydown', e => {
  if (e.key === 'Escape' && S.taskMenu) { e.stopPropagation(); const id = S.taskMenu; S.taskMenu = null; S.focus = { sel: `[data-act="task-menu"][data-v="${id}"]` }; renderAll(); }
}, true);
// The menu opens under its ⋯, or above it when there's more room there; the page only scrolls if the menu would be cut off
function placeTaskMenu() {
  const m = tasksApp.querySelector('.tp-menu'), view = m?.closest('.view'); if (!m || !view) return;
  m.previousElementSibling.scrollIntoView({ block: 'nearest' });
  const v = view.getBoundingClientRect(), b = m.previousElementSibling.getBoundingClientRect(), h = m.offsetHeight + 8;
  m.classList.toggle('is-up', b.bottom + h > v.bottom && b.top - h >= v.top);
  m.scrollIntoView({ block: 'nearest' });
}
