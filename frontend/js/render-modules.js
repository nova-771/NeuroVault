/* Build M · the workspaces from mockups R42 and R46 (locked 2026-10-17), through design/design-profile.md.
   - The module sidebars (Tasks, Timer, Timeline): R46's tools row (a search of this module only, a filter popover with a badge
     count, Add project), no "VAULT · TASKS" title row and no + on it, over R42's flat groups ("flat, like Obsidian: small
     headings, no boxes"), every choice one 32px row at one weight with its count in a fixed slot.
   - The Timer's session page (R42 · "just the timer: Today folds to one line"): the session card as labelled rows, with the
     decided big digits + bar and 1–5 buttons kept; Today is one line until Show.
   - Note history (R42 · "a Note history card on top: versions left, changes right"; "in the text: added words marked, removed
     words struck"): the card on top of the Timeline (render-views.js draws the page). Every save keeps a version (api.py
     list_versions / compare_versions / restore_version); Restore happens at once and keeps the version it replaced
     (R45 answer). The note's ⋮ → Version history… and Ctrl+K's open it.
   - On a real vault the Timeline's activity is real: the kept versions (edits and restores) and the notes made lately.
   Loaded after render-shell.js; actions.js doesn't know the bm-* acts, so this file handles them. */
'use strict';
S.bm = { q: { tasks: '', timer: '', history: '' }, f: { tasks: {}, timer: {}, history: {} }, pop: null, projDraft: '', projErr: '', todayOpen: false,
  hist: { noteId: null, ver: null }, hv: {}, hd: {}, sv: {}, actAt: 0, actBusy: false, actKey: '' };
COMFORT_KEYS.history = ['note_versions_kept', 3, 10];   // Settings → Vault & files → Versions kept (3, 5 or 10; config.py checks the value)
const BM_KEPT = [3, 5, 10];
const BM_MOD = { tasks: { label: 'Tasks', noun: 'tasks', ph: 'Search tasks…', rows: '.tp-row' },
  timer: { label: 'Timer', noun: 'sessions', ph: 'Search sessions…', rows: '.session-row' },
  history: { label: 'Timeline', noun: 'events', ph: 'Search timeline…', rows: '.feed-item' } };
const bmOn = () => !!BM_MOD[UI.view];

/* ---- The sidebar: one tools row, then flat groups; the progress or week line pinned at the bottom ---- */
function bmRow(act, v, label, count, cur, o = {}) {
  return `<button class="bm-row" data-act="${act}" data-v="${esc(v)}" ${cur ? 'aria-current="true"' : ''} title="${esc(o.title || label)}"><span class="bm-row-label">${esc(label)}</span><span class="bm-row-count num${o.wide ? ' bm-row-count--wide' : ''}"${o.tick ? ' data-tick="time"' : ''}>${count ?? ''}</span></button>`;
}
function bmGroup(title, rows, cur, empty) {   // rows: [act, v, label, count, opts]; the heading names the current choice when it's in this group
  const on = rows.find(r => r[1] === cur);
  return `<section class="bm-group" aria-label="${esc(title)}"><div class="bm-group-head"><h3 class="bm-group-title">${esc(title)}</h3><span class="bm-group-val">${on ? esc(on[2]) : ''}</span></div>
    <div class="bm-rows">${rows.length ? rows.map(r => bmRow(r[0], r[1], r[2], r[3], r[1] === cur, r[4])).join('') : `<div class="bm-none">${empty}</div>`}</div></section>`;
}
function moduleSidebar() {
  const v = UI.view, m = BM_MOD[v]; if (!m) return '';
  let groups = '', foot = '';
  if (UI.state === 'loading') groups = `<div class="bm-group">${skelList(5)}</div>`;
  else if (v === 'tasks') {
    const open = t => !t.done, f = S.taskFilter, done = D.tasks.filter(t => t.done).length, pct = D.tasks.length ? Math.round(done / D.tasks.length * 100) : 0;
    groups = bmGroup('Views', [['task-filter', 'All', 'All tasks', D.tasks.length], ['task-filter', 'Today', 'Due today', D.tasks.filter(t => t.due === 'Today' && open(t)).length],
        ['task-filter', 'Upcoming', 'Upcoming', D.tasks.filter(t => t.due === 'Upcoming' && open(t)).length], ['task-filter', 'Completed', 'Completed', done]], f)
      + bmGroup('Energy', Object.entries(ENERGY).map(([k, [, l]]) => ['task-filter', 'energy:' + k, l, D.tasks.filter(t => t.energy === k && open(t)).length]), f)
      + bmGroup('By project', taskProjectFilters().map(([k, l, c]) => ['task-filter', k, l, c]), f, 'No projects yet');
    foot = bmFoot(VAULT.live ? 'All tasks' : 'Q3 sprint', `${pct}%`, `<span>${done} of ${D.tasks.length} done</span><div class="progress"><span style="width:${pct}%"></span></div>`);
  } else if (v === 'timer') {
    const tS = timerStats(), live = TIMER_ACTIVE.includes(UI.tstate) && D.projects.length;
    groups = bmGroup('Timer', TPAGES.map(([k, l]) => ['tpage', k, l, k === 'session' && live ? timeText() : k === 'projects' ? D.projects.length : '', { tick: k === 'session' && live }]), UI.tpage);
    foot = bmFoot('This week', fmtHours(tS.weekSec), `<span>${tS.streak.toLocaleString('en-GB')}-day streak</span>`);
  } else {
    const all = [...(S.visits || []).map(() => ({ range: 'Today', type: 'Where I was' })), ...D.events];
    const n = (r, t) => all.filter(e => (r === 'All' || e.range === r) && (t === 'All' || e.type === t)).length;
    groups = bmGroup('Time range', ['All', 'Today', 'Yesterday', 'This week'].map(r => ['range', r, r, n(r, S.type)]), S.range)
      + bmGroup('Event type', ['All', 'Edits', 'Created', 'Tag changes', 'Attachments', 'Tasks', 'AI lock', 'Where I was'].map(t => ['type', t, t, n(S.range, t)]), S.type);
  }
  return `<aside class="sidebar bm-side" id="left-sidebar" aria-label="${m.label}">${bmTools()}<div class="side-body bm-side-body">${groups}</div>${foot}</aside>`;
}
const bmFoot = (title, val, body) => `<section class="bm-foot" aria-label="${esc(title)}"><div class="bm-group-head"><h3 class="bm-group-title">${esc(title)}</h3><span class="bm-group-val num">${val}</span></div><div class="bm-foot-body">${body}</div></section>`;

/* ---- R46: the tools row, in the Notes sidebar's places and sizes (44px row, 28px icons, the search box to the right) ---- */
function bmFilterCount() {
  const f = S.bm.f[UI.view] || {}, on = Object.values(f).filter(x => x && x !== 'Any').length;
  return on + (UI.view === 'tasks' && S.taskFilter !== 'All' ? 1 : 0) + (UI.view === 'history' ? (S.range !== 'All') + (S.type !== 'All') : 0);
}
function bmTools() {
  const m = BM_MOD[UI.view], n = bmFilterCount();
  return `<div class="side-actions bm-tools" role="toolbar" aria-label="${m.label} tools">
    <button class="icon-btn icon-btn--sm bm-fbtn" data-act="bm-filter" aria-haspopup="dialog" aria-expanded="${S.bm.pop === 'filter'}" aria-label="Filter ${m.noun}${n ? `, ${n} on` : ''}" title="Filter ${m.noun}${n ? ` · ${n} on` : ''}">${ic('filter')}${n ? `<span class="bm-badge num" aria-hidden="true">${n}</span>` : ''}</button>
    <button class="icon-btn icon-btn--sm" data-act="bm-proj" aria-haspopup="dialog" aria-expanded="${S.bm.pop === 'proj'}" aria-label="Add a project" title="Add a project">${ic('projplus')}</button>
    <label class="field-search">${ic('search')}<input class="field" id="bm-q" data-bm-q type="search" placeholder="${m.ph}" value="${esc(S.bm.q[UI.view] || '')}" aria-label="${m.ph}" autocomplete="off"></label>
    ${bmPop()}</div>`;
}
function bmFilterGroups() {
  const projects = D.projects.map(p => p.name), names = [...new Set(taskProjectFilters().map(x => x[0]))], f = S.bm.f[UI.view] || {};
  if (UI.view === 'tasks') return [['view', 'View', [['All', 'All'], ['Today', 'Due today'], ['Upcoming', 'Upcoming'], ['Completed', 'Completed']], ['All', 'Today', 'Upcoming', 'Completed'].includes(S.taskFilter) ? S.taskFilter : ''],
    ['energy', 'Energy', Object.entries(ENERGY).map(([k, [, l]]) => ['energy:' + k, l]), S.taskFilter.startsWith('energy:') ? S.taskFilter : ''],
    ['project', 'Project', names.map(p => [p, p]), names.includes(S.taskFilter) ? S.taskFilter : ''],
    ['due', 'Due', ['Any', 'Today', 'Tomorrow', 'Later'].map(x => [x, x]), f.due || 'Any']];
  if (UI.view === 'timer') return [['project', 'Project', ['Any', ...projects].map(x => [x, x]), f.project || 'Any'], ['range', 'Date', ['Any', 'Today', 'Yesterday', 'This week'].map(x => [x, x]), f.range || 'Any'],
    ['rating', 'Focus rating', ['Any', '3 and up', '4 and up', '5'].map(x => [x, x]), f.rating || 'Any']];
  return [['type', 'Type', ['All', 'Edits', 'Created', 'Tag changes', 'Attachments', 'Tasks', 'AI lock', 'Where I was'].map(x => [x, x]), S.type], ['project', 'Project', ['Any', ...projects].map(x => [x, x]), f.project || 'Any'],
    ['range', 'Date', ['All', 'Today', 'Yesterday', 'This week'].map(x => [x, x]), S.range]];
}
function bmPop() {
  if (!S.bm.pop || S.modal) return '';
  const head = (id, t) => `<div class="bm-pop-head"><span class="bm-pop-title" id="${id}">${t}</span><button class="icon-btn icon-btn--sm" data-act="bm-close" aria-label="Close" title="Close (Esc)">${ic('x')}</button></div>`;
  if (S.bm.pop === 'proj') return `<div class="popover card bm-pop bm-pop--proj" role="dialog" aria-labelledby="bm-proj-t">${head('bm-proj-t', 'New project')}
    <input class="field" id="bm-proj-name" data-bm-projname placeholder="Project name" aria-label="Project name" value="${esc(S.bm.projDraft)}" autocomplete="off"${S.bm.projErr ? ' aria-invalid="true" aria-describedby="bm-proj-err"' : ''}>${S.bm.projErr ? `<div class="field-error" id="bm-proj-err" role="alert">${esc(S.bm.projErr)}</div>` : ''}
    <p class="bm-pop-help">Shared with Notes, Tasks and the Timer: a project is a top-level folder.</p>
    <div class="bm-pop-foot"><button class="btn btn--secondary" data-act="bm-close">Cancel</button><button class="btn btn--primary" data-act="bm-proj-add">Add project</button></div></div>`;
  const m = BM_MOD[UI.view];
  return `<div class="popover card bm-pop bm-pop--filter" role="dialog" aria-labelledby="bm-f-t">${head('bm-f-t', `Filter ${m.noun}`)}
    ${bmFilterGroups().filter(g => g[2].length).map(([k, l, opts, cur]) => `<div class="bm-fgroup" role="group" aria-labelledby="bm-fl-${k}"><span class="bm-flabel" id="bm-fl-${k}">${l}</span><div class="bm-chips">${opts.map(([v, t]) => `<button class="bm-chip" data-act="bm-f" data-k="${k}" data-v="${esc(v)}" aria-pressed="${v === cur}">${esc(t)}</button>`).join('')}</div></div>`).join('')}
    <div class="bm-pop-foot"><span class="bm-shown num"></span><button class="btn btn--secondary" data-act="bm-clear">Clear filters and search</button></div></div>`;
}
function bmSetFilter(k, v) {
  const f = S.bm.f[UI.view];
  if (UI.view === 'tasks' && k !== 'due') { S.taskFilter = S.taskFilter === v ? 'All' : v; S.taskStay?.clear?.(); }
  else if (UI.view === 'history' && (k === 'type' || k === 'range')) S[k] = v;
  else f[k] = v;
  if (UI.view === 'timer' && UI.tpage !== 'history' && v !== 'Any') UI.tpage = 'history';   // the sessions are listed on History
  S.focus = { sel: `[data-act="bm-f"][data-k="${k}"][data-v="${CSS.escape(v)}"]` }; renderAll();
}
function bmClear() {
  const v = UI.view; S.bm.q[v] = ''; S.bm.f[v] = {};
  if (v === 'tasks') S.taskFilter = 'All'; if (v === 'history') { S.range = 'All'; S.type = 'All'; }
  S.focus = { sel: S.bm.pop ? '[data-act="bm-clear"]' : '#bm-q' }; status(`${BM_MOD[v].label}: filters and search cleared`); renderAll();
}
// The search and the filters the app doesn't keep (due, project, date, rating) hide rows in the page, with no redraw (R46)
function bmKeep(row) {
  const v = UI.view, q = (S.bm.q[v] || '').trim().toLowerCase(), f = S.bm.f[v] || {};
  if (q && !row.textContent.toLowerCase().includes(q)) return false;
  if (v === 'tasks' && f.due && f.due !== 'Any') { const t = D.tasks.find(x => x.id === row.dataset.taskRow); if (!t) return false;
    const d = taskDue(t), k = todayKey(), tm = dayKeyFrom(1); if (f.due === 'Today' ? !(d && d <= k) : f.due === 'Tomorrow' ? d !== tm : d && d <= tm) return false; }
  if (v === 'timer') { const s = D.sessions.find(x => x.id === row.dataset.session); if (!s) return !(f.project || f.range || f.rating) || Object.values(f).every(x => !x || x === 'Any');
    if (f.project && f.project !== 'Any' && s.project_name !== f.project) return false;
    if (f.range && f.range !== 'Any') { const day = s.start_time.slice(0, 10), now = tNow(), y = new Date(now); y.setDate(now.getDate() - 1); const wk = new Date(now); wk.setDate(now.getDate() - 6);
      if (f.range === 'Today' ? day !== dayKey(now) : f.range === 'Yesterday' ? day !== dayKey(y) : day < dayKey(wk)) return false; }
    if (f.rating && f.rating !== 'Any' && !((s.focus ?? 0) >= +f.rating[0])) return false; }
  if (v === 'history' && f.project && f.project !== 'Any') { const n = D.notes.find(x => x.id === row.dataset.note); if (!n || bmProjectOf(n) !== f.project) return false; }
  return true;
}
const bmProjectOf = n => rootProject(n.folder)?.name || n.category || '';
function bmApply() {
  app.querySelectorAll('.bm-hide').forEach(e => e.classList.remove('bm-hide')); app.querySelector('.bm-nomatch')?.remove();
  if (!bmOn() || UI.state === 'loading') return;
  const m = BM_MOD[UI.view], rows = [...app.querySelectorAll('.view ' + m.rows)].filter(r => !r.closest('.bm-hist')), pf = app.querySelector('.bm-shown');
  if (!rows.length) { if (pf) pf.textContent = `0 ${m.noun}`; return; }
  let shown = 0; rows.forEach(r => { const ok = bmKeep(r); r.classList.toggle('bm-hide', !ok); if (ok) shown++; });
  app.querySelectorAll('.view .day-head').forEach(h => { let n = h.nextElementSibling, any = false;
    const list = h.closest('.hist-day') ? h.parentElement.querySelectorAll(m.rows) : null;
    if (list) any = [...list].some(r => !r.classList.contains('bm-hide'));
    else while (n && !n.matches('.day-head')) { if (n.matches(m.rows) && !n.classList.contains('bm-hide')) any = true; n = n.nextElementSibling; }
    if (!any) (h.closest('.hist-day') || h).classList.add('bm-hide'); });
  app.querySelectorAll('.view .tp-card').forEach(c => { const rs = c.querySelectorAll('.tp-row'); if (rs.length && [...rs].every(r => r.classList.contains('bm-hide'))) c.classList.add('bm-hide'); });
  if (pf) pf.textContent = `${shown} of ${rows.length} ${m.noun}`;
  const q = (S.bm.q[UI.view] || '').trim();
  if (!shown) rows[0].closest('.view-inner')?.insertAdjacentHTML('beforeend', `<div class="card empty empty--compact bm-nomatch" role="status"><div class="empty-text">No ${m.noun} match${q ? ` “${esc(q)}”` : ' these filters'}.</div><button class="btn btn--secondary" data-act="bm-clear">Clear filters and search</button></div>`);
}
async function bmAddProject() {
  const name = S.bm.projDraft.trim(), dup = D.projects.find(p => p.name.toLowerCase() === name.toLowerCase());
  S.bm.projErr = !name ? 'Type a name for the project.' : dup ? `"${dup.name}" already exists. Pick another name.` : '';
  if (!S.bm.projErr && D.live) {
    let r; try { r = await api().create_project(name); } catch (e) { r = { status: 'error', message: plainErr(e) }; }
    if (r?.status === 'success') D.projects.push(projFromApi({ id: r.id, name: r.name, color_slot: r.color_slot })); else S.bm.projErr = r?.message || "Couldn't add the project.";
  } else if (!S.bm.projErr) D.projects.push({ id: 'p-' + Date.now(), name, color: (D.projects.length % 6) + 1 });
  if (S.bm.projErr) S.focus = { sel: '#bm-proj-name' };
  else { S.bm.pop = null; S.bm.projDraft = ''; S.focus = { sel: '[data-act="bm-proj"]' }; status(`Added the project "${name}" · it's in Notes, Tasks and the Timer`); }
  renderAll();
}

/* ---- The Timer's session page (R42 · just the timer): the card as labelled rows; Today folds to one line ---- */
const bmHead = (title, val, extra = '') => `<div class="bm-card-head">${title}<span class="bm-card-val">${val}</span>${extra}</div>`;
const bmTRow = (label, help, ctl) => `<div class="bm-trow"><div class="bm-trow-label">${label}${help ? `<span class="bm-trow-help">${help}</span>` : ''}</div><div class="bm-trow-ctl">${ctl}</div></div>`;
function bmTimerCard() {
  if (UI.state === 'loading' || !D.projects.length) return timerCard();   // the skeleton, and "No projects yet" with its one next step
  const st = UI.tstate, p = proj(T.projectId) || D.projects[0], wrap = inner => `<section class="card timer-card bm-card bm-timer" id="timer-card" aria-label="Timer">${inner}</section>`;
  if (st === 'idle') {
    const planned = T.mode === 'planned', mins = T.custom ? +T.custom : T.dur;
    const why = !T.projectId ? 'Pick a project to start.' : planned && !(mins > 0) ? 'Pick how long, or type the minutes.' : '';
    const minutes = `<div class="seg" role="group" aria-label="Minutes">${timerMins('planned').map(m => `<button class="seg-opt" data-act="tdur" data-v="${m}" aria-pressed="${planned && !T.custom && T.dur === m}" ${planned ? '' : 'disabled'}>${m} min</button>`).join('')}</div>
      <label class="timer-hint">or <input class="field field-num num" id="timer-custom-min" data-act="tcustom" inputmode="numeric" maxlength="3" placeholder="—" value="${esc(planned ? T.custom : '')}" aria-label="Custom minutes" ${planned ? '' : 'disabled'}> min</label>`;
    return wrap(bmHead('<h2 class="bm-card-title">Start a session</h2>', 'Ready') + `<div class="bm-trows">
      ${bmTRow('Type', 'Planned aims for a target; Stopwatch counts up', `<div class="seg" role="group" aria-label="Session type"><button class="seg-opt" data-act="tmode" data-v="planned" aria-pressed="${planned}">Planned</button><button class="seg-opt" data-act="tmode" data-v="stopwatch" aria-pressed="${!planned}">Stopwatch</button></div>`)}
      ${bmTRow('Project', 'Shared with Notes and Tasks', `<select class="field" data-bm-proj aria-label="Project"><option value="" ${T.projectId ? '' : 'selected'} disabled>Pick a project</option>${D.projects.map(x => `<option value="${x.id}" ${x.id === T.projectId ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select>`)}
      ${bmTRow('Minutes', 'Planned only · your set from Settings → Timer alerts', minutes)}</div>
      <div class="bm-tfoot"><span class="bm-tfoot-why">${why}</span><button class="btn btn--primary btn--lg" data-act="tstart" ${why ? 'disabled' : ''}>${ic('play')}${planned ? `Start ${mins || '–'} min session` : 'Start stopwatch'}</button></div>`);
  }
  if (st === 'rate') {
    const pauseSec = T.pauses.reduce((a, x) => a + x.duration_seconds, 0), busy = UI.state === 'saving' || T.busy, err = UI.state === 'error' || !!T.err;
    const seg = (k, label) => `<div class="seg" role="group" aria-label="${label}, 1 to 5">${[1, 2, 3, 4, 5].map(n => `<button class="seg-opt" data-act="trate" data-k="${k}" data-v="${n}" aria-pressed="${T[k] === n}">${n}</button>`).join('')}</div>`;
    return wrap(bmHead('<h2 class="bm-card-title">How did it go?</h2>', `${esc(p.name)} · ${fmtDur(T.elapsed)}${pauseSec ? ` · ${fmtDur(pauseSec)} paused` : ''}`) +
      (err ? `<div class="bm-tpanel"><div class="alert alert--danger" role="alert">${ic('alert')}<span>Couldn't log this session. Nothing is lost: it stays here until it saves.</span></div></div>` : '') +
      `<div class="bm-trows">${bmTRow('Energy', '1 drained · 5 energised', seg('energy', 'Energy'))}${bmTRow('Focus', '1 distracted · 5 locked in', seg('focus', 'Focus'))}</div>
      <div class="bm-tfoot"><button class="btn btn--secondary" data-act="tlog" data-v="skip" ${busy ? 'disabled' : ''}>Skip rating</button>
        <button class="btn btn--primary" data-act="tlog" data-v="rate" ${busy ? 'disabled' : ''}>${busy ? '<span class="spinner"></span>Logging…' : err ? `${ic('save')}Retry` : `${ic('save')}Log session`}</button></div>`);
  }
  // running, paused, overtime, or waiting on a check-in or a pause reason: the decided big digits + bar in the middle
  const over = isOver(), paused = isPaused();
  const val = st === 'paused' ? `Paused · ${esc(T.pauseReason)} · <span class="num" data-tick="pause">${fmtClock(T.pauseElapsed)}</span>` : st === 'pausepick' ? 'Pausing' : st === 'checkin' ? 'Check-in'
    : T.mode === 'stopwatch' ? 'Counting up · unplanned' : over ? 'Overtime' : 'Running';
  const panel = st === 'pausepick' ? `<div class="bm-tpanel" role="group" aria-labelledby="pause-q"><div class="timer-panel-title" id="pause-q">Why the pause?</div>
      <div class="pick-row">${PAUSE_REASONS.map(r => `<button class="pick" data-act="treason" data-v="${r}" aria-pressed="false">${r}</button>`).join('')}<button class="btn btn--secondary" data-act="tcancel-pause">Keep going</button></div></div>`
    : st === 'checkin' ? `<div class="bm-tpanel" role="group" aria-labelledby="checkin-q"><div class="timer-panel-title" id="checkin-q">${fmtDur(T.elapsed)} in. What did you just finish?</div>
      <div class="timer-panel-row"><input class="field" id="milestone-input" placeholder="A quick note, e.g. Drafted the overview" aria-labelledby="checkin-q"><button class="btn btn--secondary" data-act="tcheckin" data-v="skip">Skip</button><button class="btn btn--primary" data-act="tcheckin" data-v="save">Save</button></div></div>` : '';
  // Pause and Resume share one width, so Stop & log never moves; Pause greys out while the reason is picked
  const first = st === 'paused' ? `<button class="btn btn--primary" data-act="tresume">${ic('play')}Resume</button>`
    : `<button class="btn btn--secondary" data-act="tpause" ${st === 'pausepick' ? 'disabled title="Pick a reason above, or Keep going"' : ''}>${ic('pause')}Pause</button>`;
  return wrap(bmHead(`<h2 class="bm-card-title bm-proj proj-color-${p.color}"><span class="proj-dot"></span><span class="truncate">${esc(p.name)}</span></h2>`, val) + `<div class="bm-tclock">${dial()}
    ${over && !paused ? `<div class="alert alert--warning" role="status">${ic('alert')}<span>Time's up, and you're still going. Stop when you're ready.</span></div>` : ''}
    <div class="timer-controls bm-tctl">${first}<button class="btn btn--${st === 'paused' ? 'secondary' : 'primary'}" data-act="tstop">${ic('stop')}Stop &amp; log</button></div></div>${panel}
    <div class="timer-hint bm-thint"><span class="kbd">Ctrl+Alt+P</span> pause or resume · <span class="kbd">Ctrl+Alt+S</span> stop &amp; log</div>`);
}
function bmTodayCard(tS) {
  const fold = !S.bm.todayOpen;
  const body = UI.state === 'loading' ? '<div class="bm-none"><div class="skel" style="height:80px"></div></div>' : !tS.today.length ? `<div class="bm-none">Nothing logged today yet.</div>` : `<div class="session-list">${tS.today.map(sessionRow).join('')}</div>`;
  return `<section class="card bm-card bm-today${fold ? ' is-folded' : ''}" aria-label="Today">${bmHead('<h2 class="bm-card-title">Today</h2>', `${tS.today.length} session${tS.today.length === 1 ? '' : 's'} · ${fmtDur(tS.todaySec)}`,
    `<button class="btn btn--secondary btn--sm" data-act="bm-today" aria-expanded="${!fold}">${fold ? 'Show' : 'Hide'}</button>`)}${fold ? '' : body}</section>`;
}
function bmTimerSession() {
  const dateLine = tNow().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });
  // no number tiles and no head chip (R42): today's total heads the Today line, the week and streak sit in the sidebar, the state heads the card
  return `<div class="view-head"><div><h1 class="view-title">Focus session</h1><p class="view-sub">${dateLine}</p></div></div>${bmTimerCard()}${bmTodayCard(timerStats())}`;
}

/* ---- Note history (R42): versions left, changes right, in the text ---- */
const BM_REASON = { 'before-restore': 'Before the restore' };
const bmWhen = iso => { const d = new Date(iso); if (isNaN(d)) return 'Earlier'; const k = dayKey(d), now = new Date(), y = new Date(now); y.setDate(now.getDate() - 1);
  const t = d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  return k === dayKey(now) ? `Today ${t}` : k === dayKey(y) ? `Yesterday ${t}` : `${d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })} ${t}`; };
const bmWords = d => d == null ? 'First kept' : d > 0 ? `+${d.toLocaleString('en-GB')} words` : d < 0 ? `−${(-d).toLocaleString('en-GB')} words` : 'Same words';
const bmChange = (v, i) => i === 0 ? (v.reason === 'restore' ? 'Restored · current' : 'Current') : v.reason === 'restore' ? 'Restored' : BM_REASON[v.reason] || bmWords(v.delta_words);
const bmHistNote = () => D.notes.find(n => n.id === S.bm.hist.noteId) || note() || D.notes[0] || null;
// The plain text of a note, a paragraph a line, without the Markdown marks (the same rules as api._plain_lines)
function bmPlain(md) {
  return String(md || '').replace(/\r\n/g, '\n').split('\n').map(l => l.trim()).filter(s => s && !/^(-{3,}|\*{3,}|_{3,}|```.*)$/.test(s) && s !== '{{tasks}}')
    .map(s => s.replace(/^(#{1,6}\s+|>\s?|[-*+]\s+(\[[ xX]\]\s+)?|\d+[.)]\s+)/, '').replace(/!\[\[([^\]]*)\]\]/g, '[$1]').replace(/\*\*|__|`|\[\[|\]\]|~~/g, '').trim()).filter(Boolean);
}
const bmCount = md => bmPlain(md).reduce((a, l) => a + l.split(/\s+/).length, 0);
// difflib-style opcodes from a longest common subsequence (the sample vault's history; a real vault asks api.compare_versions)
function bmOps(a, b) {
  const n = a.length, m = b.length; if (n * m > 400000) return [['replace', 0, n, 0, m]];
  const L = Array.from({ length: n + 1 }, () => new Int32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) L[i][j] = a[i] === b[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  const ops = []; let i = 0, j = 0, i0 = 0, j0 = 0;
  const flush = () => { if (i > i0 || j > j0) ops.push([i > i0 && j > j0 ? 'replace' : i > i0 ? 'delete' : 'insert', i0, i, j0, j]); };
  while (i < n || j < m) {
    if (i < n && j < m && a[i] === b[j]) { flush(); const s = [i, j]; while (i < n && j < m && a[i] === b[j]) { i++; j++; } ops.push(['equal', s[0], i, s[1], j]); i0 = i; j0 = j; }
    else if (j < m && (i >= n || L[i][j + 1] >= L[i + 1][j])) j++; else i++;
  }
  flush(); return ops;
}
const bmRatio = (a, b) => { const x = a.split(/\s+/), y = b.split(/\s+/), same = bmOps(x, y).filter(o => o[0] === 'equal').reduce((s, o) => s + o[2] - o[1], 0); return 2 * same / ((x.length + y.length) || 1); };
function bmCompare(aMd, bMd) {
  const la = bmPlain(aMd), lb = bmPlain(bMd), paras = []; let added = 0, removed = 0;
  const wc = s => s.split(/\s+/).filter(Boolean).length;
  for (const [tag, i1, i2, j1, j2] of bmOps(la, lb)) {
    if (tag === 'equal') { la.slice(i1, i2).forEach(t => paras.push({ kind: 'same', ops: [['eq', t]] })); continue; }
    const old = la.slice(i1, i2), neu = lb.slice(j1, j2);
    for (let k = 0; k < Math.max(old.length, neu.length); k++) {
      const o = old[k], w = neu[k];
      if (o != null && w != null && bmRatio(o, w) >= .4) { const x = o.split(/\s+/), y = w.split(/\s+/), ops = [];
        for (const [t2, a1, a2, b1, b2] of bmOps(x, y)) { if (t2 === 'equal') ops.push(['eq', x.slice(a1, a2).join(' ')]); else { if (a2 > a1) ops.push(['del', x.slice(a1, a2).join(' ')]); if (b2 > b1) ops.push(['add', y.slice(b1, b2).join(' ')]); } }
        ops.forEach(([op, t]) => { if (op === 'add') added += wc(t); if (op === 'del') removed += wc(t); }); paras.push({ kind: 'edit', ops }); continue; }
      if (o != null) { paras.push({ kind: 'del', ops: [['del', o]] }); removed += wc(o); }
      if (w != null) { paras.push({ kind: 'add', ops: [['add', w]] }); added += wc(w); }
    }
  }
  const near = new Set(); paras.forEach((p, i) => { if (p.kind !== 'same') [i - 1, i, i + 1].forEach(x => near.add(x)); });
  const out = []; paras.forEach((p, i) => { if (p.kind !== 'same' || near.has(i)) out.push(p); else if (out.length && out[out.length - 1].kind === 'gap') out[out.length - 1].n++; else out.push({ kind: 'gap', n: 1, ops: [] }); });
  return { status: 'success', paras: out.slice(0, 400), added, removed, changed: paras.some(p => p.kind !== 'same') };
}
// The sample vault (no backend): five versions made from the note's own text, so the page shows real changes
function bmSampleVers(n) {
  const kept = S.a11y.history || 5, at = mins => new Date(Date.now() - mins * 60000).toISOString().replace(/\.\d+Z$/, '+00:00');
  let V = S.bm.sv[n.id];
  if (!V) {
    const lines = n.md.split('\n'), prose = lines.map((l, i) => [l, i]).filter(([l]) => l.trim().length > 30 && !/^\s*(#|-|\||>|`|\*|\d+\.|\{\{)/.test(l)).map(x => x[1]);
    const cut = (ls, i) => ls.filter((_, k) => k !== i);
    let v1 = lines.slice(); if (prose[0] != null) { const w = v1[prose[0]].split(' '); v1[prose[0]] = w.slice(0, Math.max(3, w.length - 4)).join(' '); }
    let v2 = prose[1] != null ? cut(v1, prose[1]) : v1.slice();
    let v3 = v2.concat(['', 'Old idea: sync every note the moment it saves.']);
    let v4 = prose[2] != null ? cut(v3, prose[2] - (prose[1] != null && prose[1] < prose[2] ? 1 : 0)) : v3.slice(0, Math.max(1, Math.ceil(v3.length / 2)));
    V = [[n.md, 'save', 28], [v1.join('\n'), 'save', 70], [v2.join('\n'), 'save', 190], [v3.join('\n'), 'save', 420], [v4.join('\n'), 'save', 1500]].map(([content, reason, mins], i) => ({ id: `sv-${n.id}-${5 - i}`, content, reason, saved_at: at(i ? mins : 1), restored_from: null }));
    S.bm.sv[n.id] = V;
  }
  if (V[0].content !== n.md) V.unshift({ id: `sv-${n.id}-${Date.now()}`, content: n.md, reason: 'save', saved_at: at(0), restored_from: null });   // edited here since: the text now is a version
  V.length = Math.min(V.length, kept);
  return V.map((v, i) => ({ ...v, words: bmCount(v.content), delta_words: V[i + 1] ? bmCount(v.content) - bmCount(V[i + 1].content) : null }));
}
// Versions, from the backend (cached until the note saves again) or the sample; null while they load
function bmVersions(n) {
  if (!VAULT.live) return bmSampleVers(n);
  const c = S.bm.hv[n.id]; if (c && c.mtime === n.mtime && c.list) return c.list;
  if (!c || c.mtime !== n.mtime) { S.bm.hv[n.id] = { mtime: n.mtime, list: null };
    (async () => { if (n.dirty || n.docDirty || n.saving) await saveNote(n); const list = await nv('list_versions', rawId(n.id)); const e = S.bm.hv[n.id];
      if (e && e.mtime === n.mtime) { e.list = Array.isArray(list) ? list : []; if (UI.view === 'history') renderAll(); } else if (e) { delete S.bm.hv[n.id]; if (UI.view === 'history') renderAll(); } })(); }   // saved meanwhile: ask again for the new text
  return null;
}
function bmDiff(n, V, k) {
  if (!VAULT.live) return bmCompare(V[k].content, V[0].content);
  const key = `${n.id}|${V[k].id}|${V[0].id}|${n.mtime}`, c = S.bm.hd[key]; if (c) return c.r;
  S.bm.hd[key] = { r: null }; nv('compare_versions', rawId(n.id), V[k].id).then(r => { S.bm.hd[key] = { r }; if (UI.view === 'history') renderAll(); });
  return null;
}
function bmDiffHtml(d) {
  if (!d) return `<div class="bm-none" role="status"><span class="spinner" aria-hidden="true"></span> Finding the changes…</div>`;
  if (d.status === 'error') return `<div class="alert alert--danger" role="alert">${ic('alert')}<span>${esc(plainMsg(d.message || "Couldn't compare the versions."))}</span></div>`;
  if (!d.changed) return `<div class="bm-none">No changes in the text since this version.</div>`;
  const p = x => x.kind === 'gap' ? `<p class="bm-diff-gap">… ${x.n} unchanged paragraph${x.n === 1 ? '' : 's'}</p>`
    : `<p class="is-${x.kind}">${x.ops.map(([op, t]) => op === 'add' ? `<ins>${esc(t)}</ins>` : op === 'del' ? `<del>${esc(t)}</del>` : esc(t)).join(' ')}</p>`;
  return `<div class="bm-diff">${d.paras.map(p).join('')}<p class="bm-diff-key"><ins>Added</ins> <del>Removed</del> · the rest is unchanged</p></div>`;
}
function bmHistCard() {
  const n = bmHistNote();
  if (!n) return `<section class="card bm-card bm-hist" aria-label="Note history">${bmHead('<h2 class="bm-card-title">Note history</h2>', '')}<div class="bm-none">Open a note to see its versions here.</div></section>`;
  const notes = D.notes.slice(0, 40); if (!notes.includes(n)) notes.unshift(n);
  const sel = `<select class="field bm-hist-note" data-bm-hist-note aria-label="Note">${notes.map(x => `<option value="${x.id}" ${x.id === n.id ? 'selected' : ''}>${esc(x.title || 'Untitled')}</option>`).join('')}</select>`;
  const V = bmVersions(n);
  if (!V) return `<section class="card bm-card bm-hist" aria-label="Note history">${bmHead('<h2 class="bm-card-title">Note history</h2>', 'Loading…', sel)}<div class="bm-none"><div class="skel" style="height:96px"></div></div></section>`;
  let k = V.findIndex(v => String(v.id) === String(S.bm.hist.ver)); if (k < 0) k = V.length > 1 ? 1 : 0;
  const list = V.length ? `<div class="bm-rows bm-versions" role="group" aria-label="Versions">${V.map((v, i) => bmRow('bm-ver', v.id, bmWhen(v.saved_at), bmChange(v, i), i === k, { wide: true, title: `${bmWhen(v.saved_at)} · ${bmChange(v, i)}${v.restored_from ? ` · brought back the ${bmWhen(v.restored_from)} version` : ''}` })).join('')}</div>`
    : `<div class="bm-none">No versions kept yet. One is kept each time the note saves.</div>`;
  const d = k && V[k] ? bmDiff(n, V, k) : null;
  const sub = !V.length ? '' : k ? `Changes since ${esc(bmWhen(V[k].saved_at))}${d?.status === 'success' && d.changed ? ` · <span class="num">+${d.added} −${d.removed} words</span>` : ''}` : 'The current version';
  const body = !V.length ? '' : k ? bmDiffHtml(d) : `<div class="bm-none">This is the note as it is now. Pick an older version to see what changed since.</div>`;
  const restore = `<button class="btn btn--primary" data-act="bm-restore" data-v="${V[k]?.id ?? ''}" ${k ? '' : `aria-disabled="true" title="${V.length ? 'This is already the current version' : 'No older version yet'}"`}>${ic('restore')}Restore this version</button>`;
  return `<section class="card bm-card bm-hist" aria-label="Note history" data-note="${n.id}">${bmHead('<h2 class="bm-card-title">Note history</h2>', `${V.length} version${V.length === 1 ? '' : 's'} kept`, sel)}
    <div class="bm-hist-grid"><div class="bm-hist-list">${list}</div><div class="bm-hist-diff"><div class="bm-hist-sub">${sub}</div>${body}<div class="bm-hist-foot"><span class="bm-hist-why">Restoring asks first, and keeps the text it replaces as a version.</span>${restore}</div></div></div></section>`;
}
async function bmRestore(id) {
  const n = bmHistNote(); if (!n || !id) return;
  const V = bmVersions(n); const k = V ? V.findIndex(v => String(v.id) === String(id)) : -1; if (k <= 0) return;
  const when = bmWhen(V[k].saved_at), title = (n.title || 'Untitled').slice(0, 40);
  if (!VAULT.live) {
    const S0 = S.bm.sv[n.id], old = S0[k]; S0[0].reason = 'before-restore';
    S0.unshift({ id: `sv-${n.id}-${Date.now()}`, content: old.content, reason: 'restore', saved_at: new Date().toISOString().replace(/\.\d+Z$/, '+00:00'), restored_from: old.saved_at });
    n.md = old.content; n.html = null; n.dirty = false; n.docDirty = false;
    D.events.unshift({ id: 'ev-' + Date.now(), time: 'Just now', range: 'Today', type: 'Edits', title: `Restored the ${when} version of "${title}"`, desc: 'The version it replaced is kept', noteId: n.id });
  } else {
    await flushSaves();
    const r = await nv('restore_version', rawId(n.id), id);
    if (failed(r)) { toast(r.message || "Couldn't restore that version"); delete S.bm.hv[n.id]; renderAll(); return; }
    n.md = r.content; n.html = null; n.mtime = r.updated_at; n.dirty = false; n.docDirty = false; syncLineTasks(n);   // its "- [ ]" lines → tasks, as a save does
    S.bm.actAt = 0;   // the activity shows the restore
  }
  if (typeof EDH !== 'undefined') EDH.delete(n.id);   // the note's Ctrl+Z steps were for the text that's gone
  S.bm.hist.ver = null; S.focus = { sel: `[data-act="bm-ver"]` };
  status(`Restored the ${when} version of "${title}" · the version it replaced is kept`); renderAll();
}
/* ---- Round 6 (the decision to r42-restore, 2026-10-18): "Ask first" before restoring an old version ---- */
function bmAskRestore(id) { S.bm.ask = id; S.modal = 'bm-restore'; S.focus = { sel: '[data-dlg="bm-restore"] [data-dlg-btn="main"]' }; renderAll(); }
function bmRestoreModal() {
  const n = bmHistNote(), V = n && bmVersions(n), old = V?.find(v => String(v.id) === String(S.bm.ask)); if (!old) return '';
  const when = bmWhen(old.saved_at);
  return dlg({ id: 'bm-restore', size: 'sm', title: 'Restore this version?', role: 'alertdialog', descId: 'bm-restore-d', xLabel: 'Close: keep the note as it is',
    body: `<p id="bm-restore-d">“${esc(n.title || 'Untitled')}” goes back to its text from ${esc(when)}. The text it has now is kept as a version, so you can come back to it.</p>`,
    cancel: '<button class="btn btn--secondary" data-act="close">Cancel</button>', main: `<button class="btn btn--primary" data-act="bm-restore-ok" title="Enter">${ic('restore')}Restore</button>` });
}
{ const bmModal0 = renderModal;
  renderModal = function () { return S.modal === 'bm-restore' ? bmRestoreModal() : bmModal0.apply(this, arguments); };   // eslint-disable-line no-global-assign
  const bmClose0 = closeModal;
  closeModal = function () {   // eslint-disable-line no-global-assign
    const was = S.modal, r = bmClose0.apply(this, arguments);
    if (was === 'bm-restore' && !S.modal) { S.bm.ask = null; const b = app.querySelector('[data-act="bm-restore"]'); if (b) b.focus({ preventScroll: true }); else S.focus = { sel: '[data-act="bm-restore"]' }; }   // back to Restore
    return r;
  };
}
function bmOpenHistory(id) {
  const n = D.notes.find(x => x.id === id) || note(); if (!n) return;
  S.menu = false; if (S.modal === 'palette') S.modal = null; S.bm.hist = { noteId: n.id, ver: null };
  if (UI.view !== 'history') setUI('view', 'history'); else renderAll();
  status(`Note history · ${n.title || 'Untitled'}`);
}

/* ---- A real vault's Timeline activity: the kept versions (edits and restores) and the notes made in the last fortnight ---- */
function bmRange(iso) {
  const d = new Date(iso); if (isNaN(d)) return 'Earlier';
  const days = Math.round((new Date(dayKey(new Date()) + 'T12:00:00') - new Date(dayKey(d) + 'T12:00:00')) / 864e5);
  return days <= 0 ? 'Today' : days === 1 ? 'Yesterday' : days < 7 ? 'This week' : 'Earlier';
}
const bmTime = iso => { const d = new Date(iso), r = bmRange(iso); return isNaN(d) ? '' : r === 'Today' || r === 'Yesterday' ? d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }); };
async function bmActivity() {
  if (!VAULT.live || S.bm.actBusy) return; S.bm.actBusy = true; S.bm.actAt = Date.now();
  try {
    const rows = await nv('list_recent_versions', 80), ev = [];
    (Array.isArray(rows) ? rows : []).forEach(r => { const t = `"${(r.title || 'Untitled').slice(0, 60)}"`;
      ev.push({ id: 'v-' + r.id, at: r.saved_at, time: bmTime(r.saved_at), range: bmRange(r.saved_at), type: 'Edits', noteId: 'n-' + r.note_id,
        title: r.reason === 'restore' ? `Restored a version of ${t}` : `Edited ${t}`,
        desc: r.reason === 'restore' ? `The ${bmWhen(r.restored_from)} version is back · the one it replaced is kept` : bmWords(r.delta_words) + (r.reason === 'before-restore' ? ' · kept when a restore replaced it' : '') }); });
    // QC 85 (Build V): tags added or removed on a save, or by an edit made outside NeuroVault
    const tags = await nv('list_tag_changes', 80), hs = l => l.map(t => '#' + t).join(' and ');
    (Array.isArray(tags) ? tags : []).forEach(r => { const t = `"${(r.title || 'Untitled').slice(0, 60)}"`, add = r.added || [], rem = r.removed || [];
      ev.push({ id: 'g-' + r.id, at: r.at, time: bmTime(r.at), range: bmRange(r.at), type: 'Tag changes', noteId: 'n-' + r.note_id,
        title: add.length ? `Tagged ${hs(add)} on ${t}` : `Removed ${hs(rem)} from ${t}`,
        desc: [add.length && rem.length ? `Removed ${hs(rem)}` : '', r.source === 'outside' ? 'Changed outside NeuroVault' : ''].filter(Boolean).join(' · ') || 'Tags changed in the note' }); });
    // Build M · QC 88: attachments taken out of the app, with Restore (the file stayed in attachments/)
    const rems = await nv('list_attachment_removals', 80);
    (Array.isArray(rems) ? rems : []).forEach(r => { const ns = r.notes || [], t = ns.length ? `“${(ns[0].title || 'Untitled').slice(0, 60)}”${ns.length > 1 ? ` and ${ns.length - 1} more` : ''}` : 'NeuroVault';
      ev.push({ id: 'r-' + r.id, at: r.at, time: bmTime(r.at), range: bmRange(r.at), type: 'Attachments', noteId: ns.length ? 'n-' + ns[0].id : null, file: r.name,
        restoreId: r.restored_at || !r.kept ? null : r.id, restored: !!r.restored_at, title: `Removed ${r.name} from ${t}`,
        desc: r.restored_at ? `Restored ${bmTime(r.restored_at)} · it's back in the note` : r.kept ? 'The file is still in attachments/ · Restore puts it back' : 'The file isn’t in attachments/ any more' }); });
    // Build M · R59: tasks moved out of a note (Only in Tasks), with Restore
    const tms = await nv('list_task_moves', 80);
    (Array.isArray(tms) ? tms : []).forEach(r => ev.push({ id: 'tm-' + r.id, at: r.at, time: bmTime(r.at), range: bmRange(r.at), type: 'Tasks', noteId: 'n-' + r.note_id,
      restoreId: r.restored_at ? null : r.id, restoreAct: 'tko-restore', restored: !!r.restored_at, file: `the lines in “${(r.title || 'Untitled').slice(0, 40)}”`,
      title: `Moved ${r.count} task${r.count === 1 ? '' : 's'} out of “${(r.title || 'Untitled').slice(0, 60)}” to Tasks`,
      desc: r.restored_at ? `Restored ${bmTime(r.restored_at)} · the lines are back in the note` : 'Each keeps a link to its note · Restore puts the lines back' }));
    // R68: what was kept off cloud AI, and what was allowed again (the lock file in the vault keeps the log)
    const lkc = await nv('list_ai_lock_changes', 80);
    (Array.isArray(lkc) ? lkc : []).forEach(r => { const nm = `“${(r.name || 'It').slice(0, 60)}”`, kind = { project: 'project', folder: 'folder', note: 'note' }[r.kind] || 'item';
      ev.push({ id: 'k-' + r.id, at: r.at, time: bmTime(r.at), range: bmRange(r.at), type: 'AI lock', title: r.action === 'lock' ? `Kept ${nm} off cloud AI` : `Allowed cloud AI again for ${nm}`,
        desc: r.action === 'lock' ? `The ${kind} and everything in it stay on this PC · allow it again from its ⋮ menu` : `The ${kind} can go to a cloud model again (after its first-use yes)` }); });
    // Build M · QC 107: a note's mind map saved as a PDF, PNG or JPG
    const mxs = await nv('list_map_exports', 80);
    (Array.isArray(mxs) ? mxs : []).forEach(r => ev.push({ id: 'mx-' + r.id, at: r.at, time: bmTime(r.at), range: bmRange(r.at), type: 'Created', noteId: r.note_id ? 'n-' + r.note_id : null,
      title: `Saved the mind map of “${(r.title || 'Untitled').slice(0, 60)}” as ${String(r.fmt).toUpperCase()}`, desc: `${r.name}${r.white ? ' · on a white background' : ''}` }));
    const since = Date.now() - 14 * 864e5;
    D.notes.filter(n => n.ctime && new Date(n.ctime) >= since).forEach(n => ev.push({ id: 'c-' + n.id, at: n.ctime, time: bmTime(n.ctime), range: bmRange(n.ctime), type: 'Created', noteId: n.id,
      title: `Created "${(n.title || 'Untitled').slice(0, 60)}"`, desc: folderPath(n.folder).join(' / ') || 'Unsorted' }));
    ev.sort((a, b) => (b.at > a.at) - (b.at < a.at));
    const key = ev.map(e => e.id + e.at).join(); D.events = ev;
    if (key !== S.bm.actKey) { S.bm.actKey = key; if (UI.view === 'history') renderAll(); }
  } finally { S.bm.actBusy = false; }
}
const bmLoadVault0 = loadVault;
loadVault = async function () { const ok = await bmLoadVault0.apply(this, arguments); if (ok) { D.events = []; S.bm.hv = {}; S.bm.hd = {}; S.bm.actKey = ''; bmActivity(); } return ok; };   // eslint-disable-line no-global-assign
const bmAfter0 = afterRender;
afterRender = function () {   // eslint-disable-line no-global-assign
  bmAfter0.apply(this, arguments); bmApply();
  if (UI.view === 'history' && VAULT.live && Date.now() - S.bm.actAt > 4000) bmActivity();
};

/* ---- Clicks, typing, Esc ---- */
app.addEventListener('click', e => {
  if (S.bm.pop && !e.target.closest('.bm-pop, [data-act="bm-filter"], [data-act="bm-proj"]')) { S.bm.pop = null; if (!e.target.closest('[data-act]')) { renderAll(); return; } }   // a click away closes it; the draft is kept
  const b = e.target.closest('[data-act]'); if (!b || b.closest('[data-soon]')) return; const act = b.dataset.act, v = b.dataset.v;
  if (act === 'history') { e.stopImmediatePropagation(); bmOpenHistory(v); return; }   // ⋮ → Version history… and Ctrl+K's
  if (!act.startsWith('bm-')) return;
  e.stopImmediatePropagation();
  if (act === 'bm-filter' || act === 'bm-proj') { const p = act === 'bm-filter' ? 'filter' : 'proj'; S.bm.pop = S.bm.pop === p ? null : p; S.bm.projErr = '';
    S.focus = { sel: S.bm.pop === 'proj' ? '#bm-proj-name' : S.bm.pop ? '.bm-pop [data-act="bm-close"]' : `[data-act="${act}"]` }; renderAll(); }
  else if (act === 'bm-close') { const p = S.bm.pop; S.bm.pop = null; S.focus = { sel: `[data-act="${p === 'proj' ? 'bm-proj' : 'bm-filter'}"]` }; renderAll(); }
  else if (act === 'bm-f') bmSetFilter(b.dataset.k, v);
  else if (act === 'bm-clear') bmClear();
  else if (act === 'bm-proj-add') bmAddProject();
  else if (act === 'bm-today') { S.bm.todayOpen = !S.bm.todayOpen; S.focus = { sel: '[data-act="bm-today"]' }; renderAll(); }
  else if (act === 'bm-ver') { S.bm.hist.ver = v; S.bm.hist.noteId = bmHistNote()?.id || null; S.focus = { sel: `[data-act="bm-ver"][data-v="${CSS.escape(v)}"]` }; renderAll(); }
  else if (act === 'bm-restore') { if (b.getAttribute('aria-disabled') !== 'true') bmAskRestore(v); }   // round 6 (R50 r42-restore): ask first
  else if (act === 'bm-restore-ok') { const id = S.bm.ask; S.bm.ask = null; S.modal = null; bmRestore(id); }
  else if (act === 'bm-kept') { setComfort('history', +v); S.bm.hv = {}; S.bm.hd = {}; Object.values(S.bm.sv).forEach(V => { V.length = Math.min(V.length, +v); });
    status(`Each note keeps its ${v} newest versions`); renderAll(); }
});
app.addEventListener('input', e => {
  const t = e.target;
  if (t.matches('[data-bm-q]')) { const v = UI.view; S.bm.q[v] = t.value;
    if (v === 'timer' && UI.tpage !== 'history' && t.value.trim()) { UI.tpage = 'history'; S.focus = { sel: '#bm-q', pos: t.selectionStart }; renderAll(); return; }   // the sessions are listed on History
    bmApply(); }
  else if (t.matches('[data-bm-projname]')) { S.bm.projDraft = t.value; if (S.bm.projErr) { S.bm.projErr = ''; S.focus = { sel: '#bm-proj-name', pos: t.selectionStart }; renderAll(); } }
});
app.addEventListener('change', e => {
  const t = e.target;
  if (t.matches('[data-bm-proj]')) { T.projectId = t.value; S.focus = { sel: '[data-bm-proj]' }; renderAll(); }
  else if (t.matches('[data-bm-hist-note]')) { S.bm.hist = { noteId: t.value, ver: null }; S.focus = { sel: '[data-bm-hist-note]' }; renderAll(); }
});
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && S.bm.pop) { e.preventDefault(); e.stopImmediatePropagation(); const p = S.bm.pop; S.bm.pop = null; S.focus = { sel: `[data-act="${p === 'proj' ? 'bm-proj' : 'bm-filter'}"]` }; renderAll(); }
  else if (e.key === 'Enter' && e.target.matches?.('[data-bm-projname]')) { e.preventDefault(); bmAddProject(); }
}, true);
