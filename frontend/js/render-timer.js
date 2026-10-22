/* Timer view (session, insights, history, projects), its one-second clock and the timer pill in the window bar.
   Extracted from design/vault-notes-mockups.html (R20). */
'use strict';
/* ---- Timer (R5): state machine, numbers and pages ---- */
const T = { mode: 'planned', projectId: null, dur: 30, custom: '', elapsed: 0, target: 1800, prev: 'running', pauseReason: null, pauseElapsed: 0,
  energy: 3, focus: 3, pauses: [], milestones: [], projErr: '', projDraft: '' };
const TPAGES = [['session', 'Session', 'play'], ['insights', 'Insights', 'chart'], ['history', 'History', 'history'], ['projects', 'Projects', 'folder']];
const TIMER_ACTIVE = ['running', 'stopwatch', 'checkin', 'pausepick', 'paused', 'overtime'];
const proj = id => D.projects.find(p => p.id === id);
const two = n => String(n).padStart(2, '0');
const fmtClock = sec => { sec = Math.max(0, Math.round(sec)); const h = Math.floor(sec / 3600), m = Math.floor(sec % 3600 / 60), s = sec % 60; return h ? `${h}:${two(m)}:${two(s)}` : `${two(m)}:${two(s)}`; };
const fmtDur = sec => { if (sec > 0 && sec < 30) return '<1m'; const m = Math.round(sec / 60); return m < 60 ? `${m}m` : `${Math.floor(m / 60)}h ${two(m % 60)}m`; };
const fmtHours = sec => sec >= 360000 ? `${Math.round(sec / 3600).toLocaleString('en-GB')}h` : fmtDur(sec);
const hm = s => s.slice(11, 16);
const sameDay = (s, d) => s.start_time.slice(0, 10) === dayKey(d);
function seedTimer(st) {
  const p = D.projects[3] || D.projects[0];
  Object.assign(T, { projectId: st === 'idle' ? T.projectId && proj(T.projectId) ? T.projectId : null : p?.id || null, mode: st === 'stopwatch' ? 'stopwatch' : 'planned',
    target: 1800, elapsed: { running: 1104, stopwatch: 2525, checkin: CHECKIN_SEC, pausepick: 1104, paused: 1104, overtime: 1992, rate: 1860 }[st] || 0,
    pauseReason: st === 'paused' ? 'Coffee break' : null, pauseElapsed: st === 'paused' ? 134 : 0, prev: 'running',
    pauses: st === 'rate' ? [{ category: 'Coffee break', duration_seconds: 240 }] : [], milestones: [], energy: 3, focus: 3 });
}
// Phase 4: the clock runs from the wall clock since the last change (or the backend's last answer), so a throttled
// background window or a missed tick never loses time. T.sync = { at: Date.now(), elapsed, pause }.
function clockNow() {
  if (!T.sync) return;
  const dt = Math.max(0, Math.floor((Date.now() - T.sync.at) / 1000));
  if (UI.tstate === 'paused') T.pauseElapsed = T.sync.pause + dt;
  else if (TIMER_ACTIVE.includes(UI.tstate)) T.elapsed = T.sync.elapsed + dt;
}
const markClock = () => { T.sync = { at: Date.now(), elapsed: T.elapsed, pause: T.pauseElapsed }; };
function goTimer(st, focus) { clockNow(); UI.tstate = st; markClock(); if (focus) S.focus = { sel: focus }; renderAll(); }
const tNow = () => D.live ? new Date() : NOW;   // the sample vault's "now" is fixed
const isPaused = () => UI.tstate === 'paused' || UI.tstate === 'pausepick';
const isOver = () => T.mode === 'planned' && T.elapsed > T.target;
const timeText = () => T.mode === 'stopwatch' ? fmtClock(T.elapsed) : isOver() ? '+' + fmtClock(T.elapsed - T.target) : fmtClock(T.target - T.elapsed);
const dialFrac = () => T.mode === 'stopwatch' ? (T.elapsed % 3600) / 3600 : Math.min(1, T.elapsed / T.target);

function timerStats() {
  const NOW = tNow(), today = D.sessions.filter(s => sameDay(s, NOW));
  const monday = new Date(NOW); monday.setDate(NOW.getDate() - ((NOW.getDay() + 6) % 7));
  const week = D.sessions.filter(s => s.start_time.slice(0, 10) >= dayKey(monday));
  const days = new Set(D.sessions.map(s => s.start_time.slice(0, 10)));
  let streak = 0; const c = new Date(NOW); while (days.has(dayKey(c))) { streak++; c.setDate(c.getDate() - 1); }
  return { today, todaySec: today.reduce((a, s) => a + s.actual_seconds, 0), weekSec: week.reduce((a, s) => a + s.actual_seconds, 0), streak };
}
function insights() {   // same shape as api.get_insights()
  const NOW = tNow(), S0 = D.sessions, planned = S0.filter(s => !s.is_unplanned), avg = (a, k) => { const v = a.map(x => x[k]).filter(v => v != null); return v.length ? v.reduce((p, q) => p + q, 0) / v.length : null; };
  const heat = []; for (let i = 83; i >= 0; i--) { const d = new Date(NOW); d.setDate(d.getDate() - i); heat.push({ date: dayKey(d), total_seconds: S0.filter(s => sameDay(s, d)).reduce((a, s) => a + s.actual_seconds, 0) }); }
  const byProj = D.projects.map(p => ({ ...p, total: S0.filter(s => s.project_id === p.id).reduce((a, s) => a + s.actual_seconds, 0),
    n: planned.filter(s => s.project_id === p.id).length, over: planned.filter(s => s.project_id === p.id && s.overtime_seconds > 0).length }));
  const pauses = S0.flatMap(s => s.pauses), byReason = {}; pauses.forEach(p => { byReason[p.category] = (byReason[p.category] || 0) + p.duration_seconds; });
  const pauseTotal = pauses.reduce((a, p) => a + p.duration_seconds, 0), nDays = new Set(S0.map(s => s.start_time.slice(0, 10))).size || 1;
  return {
    heatmap: heat,
    breakdown_alltime: byProj.filter(p => p.total).sort((a, b) => b.total - a.total),
    averages: { avg_energy: avg(S0, 'energy'), avg_focus: avg(S0, 'focus'), unplanned_count: S0.filter(s => s.is_unplanned).length, total_count: S0.length },
    estimation: { avg_target_seconds: avg(planned, 'target_seconds'), avg_actual_seconds: avg(planned, 'actual_seconds'), avg_overtime_seconds: avg(planned, 'overtime_seconds'),
      accuracy_ratio: planned.length ? planned.reduce((a, s) => a + s.actual_seconds / s.target_seconds, 0) / planned.length : null, planned_count: planned.length,
      by_category: byProj.filter(p => p.n).map(p => ({ ...p, over_pct: Math.round(100 * p.over / p.n) })).sort((a, b) => b.over_pct - a.over_pct) },
    pauses: { total_pause_seconds: pauseTotal, avg_pause_seconds_per_day: pauseTotal / nDays, pause_count: pauses.length,
      most_common_category: Object.entries(byReason).sort((a, b) => b[1] - a[1])[0]?.[0] || null, by_category: Object.entries(byReason).sort((a, b) => b[1] - a[1]) },
  };
}
const kpi = (v, l) => `<div class="card kpi"><span class="kpi-value truncate">${v}</span><span class="kpi-label">${l}</span></div>`;
const skelCard = h => `<div class="card card-pad"><div class="skel" style="height:${h}px"></div></div>`;
function sessionChips(s) {
  const c = [];
  if (s.is_unplanned) c.push('<span class="chip chip--neutral">Unplanned</span>');
  if (s.overtime_seconds > 59) c.push(`<span class="chip chip--warning">+${fmtDur(s.overtime_seconds)} over</span>`);
  if (s.pauses.length) c.push(`<span class="chip chip--neutral">${s.pauses.length} pause${s.pauses.length > 1 ? 's' : ''} · ${fmtDur(s.pauses.reduce((a, p) => a + p.duration_seconds, 0))}</span>`);
  if (s.energy != null || s.focus != null) c.push(`<span class="chip chip--neutral">Energy ${s.energy ?? '–'} · Focus ${s.focus ?? '–'}</span>`);
  return c.join('');
}
const sessionRow = s => `<div class="session-row" data-session="${esc(s.id)}"><span class="session-time">${hm(s.start_time)}–${hm(s.end_time)}</span><div class="session-main">
  <span class="session-name proj-color-${s.color}"><span class="proj-dot"></span><span class="truncate">${esc(s.project_name)}</span></span>
  ${sessionChips(s) ? `<span class="session-chips">${sessionChips(s)}</span>` : ''}${s.milestones.map(m => `<span class="session-note">Check-in: ${esc(m.note)}</span>`).join('')}</div>
  <span class="session-dur">${fmtDur(s.actual_seconds)}</span></div>`;
const timerEmpty = () => `<div class="card empty"><div class="empty-title">No projects yet</div><div class="empty-text">Projects are shared with your notes and tasks. Add one, then time your work against it.</div><button class="btn btn--primary" data-act="tpage" data-v="projects">${ic('plus')}Add a project</button></div>`;

function dial() {
  const over = isOver(), paused = isPaused(), mod = over ? ' is-over' : paused ? ' is-paused' : '';
  const sub = T.mode === 'stopwatch' ? 'Counting up · no target' : over ? `Target ${fmtClock(T.target)} · overtime` : `left of ${fmtClock(T.target)}`;
  const tcls = over ? ' is-over' : paused ? ' is-paused' : '';
  return `<div class="timer-bar${mod}"><span class="timer-time${tcls}" data-tick="time" role="timer" aria-live="off">${timeText()}</span>
    <div class="progress" aria-hidden="true"><span data-tick="bar" style="width:${(dialFrac() * 100).toFixed(1)}%"></span></div><span class="timer-target">${sub}</span></div>`;
}
function rateRow(k, label, lo, hi) {
  const v = T[k];
  const control = `<div class="seg" role="group" aria-label="${label}, 1 to 5">${[1, 2, 3, 4, 5].map(n => `<button class="seg-opt" data-act="trate" data-k="${k}" data-v="${n}" aria-pressed="${v === n}">${n}</button>`).join('')}</div>`;
  return `<div class="rate-row"><div class="rate-head"><span>${label}</span><span class="num" data-rate-val="${k}">${v} / 5</span></div>${control}<div class="rate-ends"><span>${lo}</span><span>${hi}</span></div></div>`;
}
function timerCard() {
  if (UI.state === 'loading') return `<div class="card timer-card"><div class="skel" style="height:24px;width:40%"></div><div class="skel skel--round" style="height:220px;width:220px"></div><div class="skel" style="height:32px;width:50%"></div></div>`;
  if (!D.projects.length) return timerEmpty();
  const st = UI.tstate, p = proj(T.projectId) || D.projects[0];
  if (st === 'idle') {
    const planned = T.mode === 'planned', mins = T.custom ? +T.custom : T.dur;
    return `<div class="card timer-card" id="timer-card">
      <div class="seg" role="group" aria-label="Session type"><button class="seg-opt" data-act="tmode" data-v="planned" aria-pressed="${planned}">Planned</button><button class="seg-opt" data-act="tmode" data-v="stopwatch" aria-pressed="${!planned}">Stopwatch</button></div>
      <h2 class="timer-title">Start a session</h2>
      <p class="timer-sub">${planned ? 'Pick a project and how long you mean to work.' : 'Pick a project. The clock counts up until you stop.'}</p>
      <div class="pick-row" role="group" aria-label="Project">${D.projects.map(x => `<button class="pick proj-color-${x.color}" data-act="tproj" data-v="${x.id}" aria-pressed="${x.id === T.projectId}" title="${esc(x.name)}"><span class="proj-dot"></span><span>${esc(x.name)}</span></button>`).join('')}</div>
      ${planned ? `<div class="dur-row"><div class="seg" role="group" aria-label="Duration">${timerMins('planned').map(m => `<button class="seg-opt" data-act="tdur" data-v="${m}" aria-pressed="${!T.custom && T.dur === m}">${m} min</button>`).join('')}</div>
        <label class="timer-hint">or <input class="field field-num num" id="timer-custom-min" data-act="tcustom" inputmode="numeric" maxlength="3" placeholder="—" value="${esc(T.custom)}" aria-label="Custom minutes"> min</label></div>` : ''}
      <button class="btn btn--primary btn--lg" data-act="tstart" ${T.projectId && mins > 0 ? '' : 'disabled'}>${ic('play')}${planned ? `Start ${mins || '–'} min session` : 'Start stopwatch'}</button>
      ${T.projectId ? '' : '<span class="timer-hint">Pick a project to start.</span>'}</div>`;
  }
  if (st === 'rate') {
    const pauseSec = T.pauses.reduce((a, x) => a + x.duration_seconds, 0);
    const busy = UI.state === 'saving' || T.busy, err = UI.state === 'error' || !!T.err;
    return `<div class="card timer-card" id="timer-card"><h2 class="timer-title">How did it go?</h2>
      <p class="timer-sub"><span class="timer-project proj-color-${p.color}"><span class="proj-dot"></span><span class="truncate">${esc(p.name)}</span></span> · ${fmtDur(T.elapsed)}${pauseSec ? ` · ${fmtDur(pauseSec)} paused` : ''}</p>
      ${err ? `<div class="alert alert--danger" role="alert">${ic('alert')}<span>Couldn't log this session. Nothing is lost: it stays here until it saves.</span></div>` : ''}
      <div class="rate-grid">${rateRow('energy', 'Energy', 'Drained', 'Energised')}${rateRow('focus', 'Focus', 'Distracted', 'Locked in')}</div>
      <div class="timer-controls"><button class="btn btn--ghost" data-act="tlog" data-v="skip" ${busy ? 'disabled' : ''}>Skip rating</button>
      <button class="btn btn--primary" data-act="tlog" data-v="rate" ${busy ? 'disabled' : ''}>${busy ? '<span class="spinner"></span>Logging…' : err ? `${ic('save')}Retry` : `${ic('save')}Log session`}</button></div></div>`;
  }
  // a session is running, paused or waiting on a check-in
  const over = isOver(), paused = isPaused();
  const stateChip = st === 'paused' ? `<span class="chip chip--warning">Paused · ${esc(T.pauseReason)} · <span class="num" data-tick="pause">${fmtClock(T.pauseElapsed)}</span></span>`
    : T.mode === 'stopwatch' ? `<span class="chip chip--accent"><span class="status-dot rec-dot"></span>Recording · unplanned</span>` : '';
  let panel = '', controls = '';
  if (st === 'pausepick') panel = `<div class="timer-panel" role="group" aria-labelledby="pause-q"><div class="timer-panel-title" id="pause-q">Why the pause?</div>
      <div class="pick-row">${PAUSE_REASONS.map(r => `<button class="pick" data-act="treason" data-v="${r}" aria-pressed="false">${r}</button>`).join('')}</div>
      <div class="timer-panel-row"><button class="btn btn--ghost btn--sm" data-act="tcancel-pause">Keep going</button></div></div>`;
  else if (st === 'checkin') panel = `<div class="timer-panel" role="group" aria-labelledby="checkin-q"><div class="timer-panel-title" id="checkin-q">${fmtDur(T.elapsed)} in. What did you just finish?</div>
      <div class="timer-panel-row"><input class="field" id="milestone-input" placeholder="A quick note, e.g. Drafted the overview" aria-labelledby="checkin-q"><button class="btn btn--ghost" data-act="tcheckin" data-v="skip">Skip</button><button class="btn btn--primary" data-act="tcheckin" data-v="save">Save</button></div></div>`;
  if (st === 'paused') controls = `<button class="btn btn--primary" data-act="tresume">${ic('play')}Resume</button><button class="btn btn--secondary" data-act="tstop">${ic('stop')}Stop &amp; log</button>`;
  else if (st !== 'pausepick') controls = `<button class="btn btn--secondary" data-act="tpause">${ic('pause')}Pause</button><button class="btn btn--primary" data-act="tstop">${ic('stop')}Stop &amp; log</button>`;
  return `<div class="card timer-card" id="timer-card">
    <span class="timer-project proj-color-${p.color}"><span class="proj-dot"></span><span class="truncate">${esc(p.name)}</span></span>
    ${dial()}${stateChip}
    ${over && !paused ? `<div class="alert alert--warning" role="status">${ic('alert')}<span>Time's up, and you're still going. Stop when you're ready.</span></div>` : ''}
    ${panel}${controls ? `<div class="timer-controls">${controls}</div>` : ''}
    <span class="timer-hint"><span class="kbd">Ctrl+Alt+P</span> pause or resume · <span class="kbd">Ctrl+Alt+S</span> stop &amp; log</span></div>`;
}
function todayCard(tS) {
  const body = UI.state === 'loading' ? '<div class="skel" style="height:120px"></div>'
    : !tS.today.length ? `<div class="empty empty--compact"><div class="empty-text">Nothing logged today yet.</div></div>`
    : `<div class="session-list">${tS.today.map(sessionRow).join('')}</div>`;
  return `<div class="card card-pad"><div class="card-head"><h2 class="card-title">Today</h2><span class="card-sub">${tS.today.length} session${tS.today.length === 1 ? '' : 's'} · ${fmtDur(tS.todaySec)}</span></div>${body}</div>`;
}
function viewTimer() {
  const tS = timerStats(), loading = UI.state === 'loading';
  const head = (title, sub, right = '') => `<div class="view-head"><div><h1 class="view-title">${title}</h1><p class="view-sub">${sub}</p></div>${right}</div>`;
  const NOW = tNow(), dateLine = NOW.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });
  let inner = '';
  if (UI.tpage === 'session') {
    inner = bmTimerSession();   // Build M (R42 · just the timer): the session card as labelled rows, Today folded to one line (render-modules.js)
  } else if (UI.tpage === 'insights') {
    const I = insights(), A = I.averages, E = I.estimation, P = I.pauses, none = !D.sessions.length;
    const emptyC = t => `<div class="empty empty--compact"><div class="empty-text">${t}</div></div>`;
    // Build J: the whole year (year.js yearCard) replaces the 12-week activity card
    const tot = I.breakdown_alltime.reduce((a, p) => a + p.total, 0) || 1;
    inner = head('Insights', 'How your time actually goes, across every logged session.') + (loading ? `<div class="kpi-row">${skelCard(40).repeat(4)}</div>${skelCard(220)}` : `
      <div class="kpi-row">${kpi(A.avg_energy?.toFixed(1) ?? '—', 'Average energy (1–5)')}${kpi(A.avg_focus?.toFixed(1) ?? '—', 'Average focus (1–5)')}${kpi(A.total_count ? Math.round(100 * A.unplanned_count / A.total_count) + '%' : '—', 'Unplanned sessions')}${kpi(A.total_count.toLocaleString('en-GB'), 'Sessions logged')}</div>
      <div class="insight-grid">
        <div class="card card-pad"><div class="card-head"><h2 class="card-title">Time estimates</h2><span class="card-sub">${E.planned_count.toLocaleString('en-GB')} planned sessions</span></div>
          ${none ? emptyC('Plan a session with a target to see how your estimates hold up.') : `<div class="est-grid">
            <div class="est-cell"><span class="kpi-value">${fmtDur(E.avg_target_seconds)}</span><span class="kpi-label"> planned on average</span></div>
            <div class="est-cell"><span class="kpi-value">${fmtDur(E.avg_actual_seconds)}</span><span class="kpi-label"> actually worked</span></div>
            <div class="est-cell"><span class="kpi-value">${fmtDur(E.avg_overtime_seconds)}</span><span class="kpi-label"> overtime on average</span></div>
            <div class="est-cell"><span class="kpi-value">${Math.round(E.accuracy_ratio * 100)}%</span><span class="kpi-label"> of plan, on average</span></div></div>
            <div class="eyebrow">Runs over most often</div><div class="bar-list">${E.by_category.slice(0, 6).map(c => `<div class="bar-row proj-color-${c.color}"><span><span class="proj-dot"></span><span class="truncate">${esc(c.name)}</span></span><div class="progress"><span style="width:${c.over_pct}%"></span></div><span class="bar-value">${c.over_pct}% of ${c.n}</span></div>`).join('')}</div>`}</div>
        <div class="card card-pad"><div class="card-head"><h2 class="card-title">Pauses</h2><span class="card-sub">${fmtDur(P.total_pause_seconds)} in total · ${fmtDur(P.avg_pause_seconds_per_day)} a day</span></div>
          ${!P.pause_count ? emptyC('No pauses logged yet.') : `<p class="view-sub">Most common: <b>${esc(P.most_common_category)}</b> · ${P.pause_count.toLocaleString('en-GB')} pauses</p>
            <div class="bar-list">${P.by_category.map(([k, v]) => `<div class="bar-row"><span class="truncate">${esc(k)}</span><div class="progress"><span style="width:${(100 * v / P.by_category[0][1]).toFixed(1)}%"></span></div><span class="bar-value">${fmtDur(v)}</span></div>`).join('')}</div>`}</div>
      </div>
      ${yearCard()}
      <div class="card card-pad"><div class="card-head"><h2 class="card-title">By project · all time</h2><span class="card-sub">${fmtHours(I.breakdown_alltime.reduce((a, p) => a + p.total, 0))} in total</span></div>
        ${none ? emptyC('Log a session to see where your time goes.') : `<div class="stack-bar" aria-hidden="true">${I.breakdown_alltime.map(p => `<span class="proj-color-${p.color}" style="width:${(100 * p.total / tot).toFixed(2)}%" title="${esc(p.name)}"></span>`).join('')}</div>
          <div class="bar-list">${I.breakdown_alltime.map(p => `<div class="bar-row proj-color-${p.color}"><span><span class="proj-dot"></span><span class="truncate">${esc(p.name)}</span></span><div class="progress"><span style="width:${(100 * p.total / I.breakdown_alltime[0].total).toFixed(1)}%"></span></div><span class="bar-value">${fmtHours(p.total)}</span></div>`).join('')}</div>`}</div>`);
  } else if (UI.tpage === 'history') {
    // Build J: opened from a day on the Insights year, History reaches back to that day and marks it
    if (S.histDay && !D.sessions.some(s => s.start_time.slice(0, 10) === S.histDay)) S.histDay = null;
    const reach = S.histDay ? D.sessions.findIndex(s => s.start_time.slice(0, 10) < S.histDay) : -1;
    const list = D.sessions.slice(0, S.histDay ? Math.max(200, reach < 0 ? D.sessions.length : reach) : 200), days = [];
    list.forEach(s => { const k = s.start_time.slice(0, 10); let d = days.find(x => x.k === k); if (!d) days.push(d = { k, list: [] }); d.list.push(s); });
    const label = k => { const d = new Date(k + 'T12:00:00'), diff = Math.round((new Date(dayKey(NOW) + 'T12:00:00') - d) / 864e5); return diff === 0 ? 'Today' : diff === 1 ? 'Yesterday' : d.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' }); };
    inner = head('History', D.sessions.length > 200 ? 'Your latest 200 sessions, newest first.' : 'Every session you have logged, newest first.') +
      `<div class="card card-pad">${loading ? '<div class="skel" style="height:240px"></div>' : !days.length ? `<div class="empty"><div class="empty-title">No sessions yet</div><div class="empty-text">Sessions appear here once you stop and log one.</div></div>`
        : (S.histDay ? `<div class="alert alert--info hist-at" role="status">${ic('history')}<span>From ${esc(new Date(S.histDay + 'T12:00:00').toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }))}, opened from the Insights year.</span><button class="btn btn--secondary btn--sm" data-act="hist-back">${ic('left')}Back to Insights</button></div>` : '')   // Build J
          + days.map(d => `<div class="hist-day${d.k === S.histDay ? ' is-target' : ''}" data-hist-day="${d.k}"><div class="day-head"${d.k === S.histDay ? ' tabindex="-1"' : ''}><span class="list-item-title">${label(d.k)}</span><span class="card-sub">${d.list.length} · ${fmtDur(d.list.reduce((a, s) => a + s.actual_seconds, 0))}</span></div><div class="session-list">${d.list.map(sessionRow).join('')}</div></div>`).join('')}</div>`;
  } else if (UI.tpage === 'projects') {
    inner = head('Projects', 'Shared with Notes and Tasks: a project can hold notes, tasks and timed sessions.') +
      `<div class="card card-pad"><div class="project-add"><div><input class="field" id="new-project-name" data-act="tproj-name" placeholder="New project name" value="${esc(T.projDraft)}" aria-label="New project name"${T.projErr ? ' aria-invalid="true" aria-describedby="project-err"' : ''}>${T.projErr ? `<div class="field-error" id="project-err">${esc(T.projErr)}</div>` : ''}</div>
        <button class="btn btn--primary" data-act="tproj-add">${ic('plus')}Add project</button></div></div>
      <div class="card card-pad">${loading ? '<div class="skel" style="height:200px"></div>' : !D.projects.length ? `<div class="empty"><div class="empty-title">No projects yet</div><div class="empty-text">Add your first project above.</div></div>`
        : D.projects.map(p => { const ss = D.sessions.filter(s => s.project_id === p.id), nn = D.notes.filter(n => n.category === p.name).length, live = p.id === T.projectId && (TIMER_ACTIVE.includes(UI.tstate) || UI.tstate === 'rate'), tt = D.tasks.filter(t => D.notes.find(n => n.id === t.noteId)?.category === p.name).length;
          return `<div class="project-row"><div class="session-main"><span class="session-name proj-color-${p.color}"><span class="proj-dot"></span><span class="truncate">${esc(p.name)}</span></span>
            <span class="session-note">${nn} note${nn === 1 ? '' : 's'} · ${tt} task${tt === 1 ? '' : 's'} · ${ss.length.toLocaleString('en-GB')} session${ss.length === 1 ? '' : 's'}</span></div>
            <span class="session-dur">${fmtHours(ss.reduce((a, s) => a + s.actual_seconds, 0))}</span>
            <button class="icon-btn icon-btn--sm" data-act="tproj-delete" data-v="${p.id}" ${live ? `aria-disabled="true" aria-label="Can't delete ${esc(p.name)}: a session is timing it" title="A session is timing it, so it can't be deleted now"` : ss.length || nn ? `aria-disabled="true" aria-label="Can't delete ${esc(p.name)}: it has ${ss.length ? 'logged sessions' : 'notes'}" title="${ss.length ? 'Has logged sessions' : 'Its folder has notes'}, so it can't be deleted here"` : `aria-label="Delete ${esc(p.name)}" title="Delete project"`}>${ic('trash')}</button></div>`; }).join('')}</div>`;
  }
  return `<section class="view bm-tview" id="main-view-timer"><div class="view-inner">${inner}</div></section>`;   // Build M: bm-tview gives every Timer page R42's card heads
}
/* R5: Timer actions and the one-second clock.
   Phase 4: with the backend (D.live) every change also goes to its running-session record (api.py), which is the truth:
   each answer re-syncs T, so a session survives the app closing. In a browser (dev) the mockup's local session runs. */
const AWAY_ASK = 120;   // seconds the app was closed before asking whether that time counts (design/api-contract.md)
const RUN_STATES = ['running', 'stopwatch', 'overtime'];
// The backend's running session → T and UI.tstate. The reason picker and the check-in are front-end steps, so they stay up.
function syncRunning(s) {
  if (!s) { if (TIMER_ACTIVE.includes(UI.tstate) || UI.tstate === 'rate') UI.tstate = 'idle'; T.sync = null; T.away = null; return; }
  const closed = (s.pauses || []).reduce((a, p) => a + p.duration_seconds, 0);
  Object.assign(T, { projectId: s.project_id != null ? 'p-' + s.project_id : null, mode: s.mode, target: s.target_seconds || 0, elapsed: s.elapsed_seconds,
    pauses: s.pauses || [], milestones: s.milestones || [], taskId: s.task_id, pauseReason: s.pause_reason || null,
    pauseElapsed: s.state === 'paused' ? Math.max(0, s.paused_seconds - closed) : 0 });
  const run = s.is_over ? 'overtime' : s.mode === 'stopwatch' ? 'stopwatch' : 'running', st = s.state === 'stopped' ? 'rate' : s.state === 'paused' ? 'paused' : run;
  if (st !== 'rate') T.prev = run;
  if (!(st === run && ['pausepick', 'checkin'].includes(UI.tstate))) UI.tstate = st;
  markClock();
}
// On launch: pick the running session back up. If the app was closed for a while, ask whether that time counts.
function recoverRunning(s) {
  if (!s) T.projectId = null;
  syncRunning(s); T.beat = 0;
  if (s && s.state === 'running' && s.away_seconds > AWAY_ASK) { T.away = s.away_seconds;
    if (D.tset.away === 'pause' || D.tset.away === 'work') awayAnswer(D.tset.away, true);   // Build L: you ticked "Always do this", so nothing asks
    else { S.modal = 'timer-away'; S.focus = { sel: '.modal-foot [data-act="taway"][data-v="pause"]' }; } }
  else if (s) status(`Picked up your ${s.project_name || ''} session`.replace('  ', ' '));
}
// Build L (R41): one short question, its usual answer first (a pause: the main button, the focus, × and Esc), and
// "Always do this and don't ask", which Settings → Timer alerts can change back
const awayModal = () => { const p = proj(T.projectId);
  return dlg({ id: 'timer-away', size: 'sm', role: 'alertdialog', keep: true, title: `Count the ${fmtDur(T.away || 0)} as a pause?`, titleId: 'tat', descId: 'tad',
    x: 'taway', xV: 'pause', xLabel: 'Close: counts it as a pause', xTitle: 'Close: counts it as a pause, the usual answer',
    body: `<p id="tad">${p ? `Your ${esc(p.name)} session` : 'Your session'} kept running while NeuroVault was closed.</p>${dlgAlways('id="taway-always"', false, 'Settings → Timer alerts')}`,
    others: ['<button class="btn btn--secondary" data-act="taway" data-v="work">Count it as work</button>'],
    main: '<button class="btn btn--primary" data-act="taway" data-v="pause" title="Enter">Count it as a pause</button>' }); };
// Settings → Timer alerts: the question's answer, kept ("Ask" puts the question back)
const AWAY_SET = [['ask', 'Ask me'], ['pause', 'A pause'], ['work', 'Work']];
const awayCard = () => { const cur = D.tset.away || 'ask';
  return cfCard('away', 'After NeuroVault was closed', { ask: 'Asks', pause: 'Counts as a pause', work: 'Counts as work' }[cur] || 'Asks',
    `<div>${cfSeg('away-set', 'Time a timer ran while it was closed', 'Asked when you open NeuroVault again, if it was closed for over 2 minutes', AWAY_SET, 'taway-set', 'away', cur)}</div>`); };
function awayAnswer(v, setting) {
  const always = !setting && !!document.getElementById('taway-always')?.checked, gone = fmtDur(T.away || 0), as = v === 'pause' ? 'a pause' : 'work';
  if (always) setTset('away', v);
  if (S.modal === 'timer-away') S.modal = null; T.away = null; T.beat = Date.now();
  status(setting ? `NeuroVault was closed for ${gone}: counted it as ${as}, as your setting says` : `The ${gone} counts as ${as}${always ? ' · from now on it won’t ask (Settings → Timer alerts)' : ''}`);
  tcall(a => a.update_running_session(v === 'pause' ? 'away' : 'heartbeat'));
}
// One call to the running-session record. Its answer re-syncs the clock; a refusal shows its message and re-reads the record.
async function tcall(fn) {
  const a = api(); if (!a || !D.live) return null;
  let r; try { r = await fn(a); } catch (e) { r = { status: 'error', message: "Couldn't reach the timer: " + (e?.message || e) }; }
  if (r?.status === 'success') syncRunning(r.session);
  else { toast(r?.message || "Couldn't reach the timer"); try { syncRunning(await a.get_running_session()); } catch (e) { /* keep what is shown */ } }
  renderAll(); return r;
}
function startSession(mode, mins, projectId, taskId = null) {
  Object.assign(T, { mode, projectId, taskId, target: mode === 'planned' ? mins * 60 : 0, elapsed: 0, pauses: [], milestones: [], energy: 3, focus: 3, err: '', pauseElapsed: 0, prev: mode === 'planned' ? 'running' : 'stopwatch' });
  goTimer(mode === 'planned' ? 'running' : 'stopwatch', '#timer-card [data-act="tpause"]');
  const pj = idNum(projectId), tk = idNum(taskId);
  tcall(async a => { let r = await a.start_running_session(pj, T.target, mode, tk);
    if (r?.status === 'error' && tk && /task/i.test(r.message)) r = await a.start_running_session(pj, T.target, mode, null);   // a task the database doesn't have yet
    return r; });
}
async function logSession(withRatings) {
  if (UI.state === 'error') { status('Logging failed · the session is kept'); renderAll(); return; }
  const p = proj(T.projectId);
  if (!D.live) { setUI('state', 'saving');
    setTimeout(() => {
      const end = new Date(NOW), start = new Date(NOW.getTime() - T.elapsed * 1000);
      D.sessions.unshift({ id: 's-new-' + Date.now(), project_id: p.id, project_name: p.name, color: p.color, start_time: iso(start), end_time: iso(end), target_seconds: T.mode === 'planned' ? T.target : 0,
        actual_seconds: T.elapsed, overtime_seconds: T.mode === 'planned' ? Math.max(0, T.elapsed - T.target) : 0, energy: withRatings ? T.energy : null, focus: withRatings ? T.focus : null,
        is_unplanned: T.mode === 'stopwatch', pauses: [...T.pauses], milestones: [...T.milestones] });
      UI.state = 'ready'; status(`Logged ${fmtDur(T.elapsed)} · database${D.tset.vault ? ' and Obsidian note' : ''} updated`);
      const msg = `Logged ${fmtDur(T.elapsed)} to ${p.name}`; goTimer('idle'); toast(msg);
    }, 700); return; }
  T.busy = true; T.err = ''; renderAll();
  let r; try { r = await api().finish_running_session(withRatings ? T.energy : null, withRatings ? T.focus : null); } catch (e) { r = { status: 'error', message: plainErr(e) }; }
  T.busy = false;
  if (r?.status !== 'success') {
    if (r?.code === 'not_running') { syncRunning(null); toast('That session was already logged'); renderAll(); return; }
    T.err = r?.message || 'Unknown error'; status('Logging failed · the session is kept'); toast(T.err); return; }
  const s = r.session, v = r.vault_status;
  if (!D.sessions.some(x => x.id === 's-' + s.id)) D.sessions.unshift(sessionFromApi({ ...s, color: proj('p-' + s.project_id)?.color }));   // Build H: a sync may have brought it first
  status(`Logged ${fmtDur(s.actual_seconds)} · database${v?.ok ? ' and Obsidian note' : ''} updated`);
  syncRunning(null); goTimer('idle'); toast(v && !v.ok ? `Logged, but the Obsidian note failed: ${v.message}` : `Logged ${fmtDur(s.actual_seconds)} to ${s.project_name}`);
}
async function addProject() {
  const name = (document.getElementById('new-project-name')?.value || '').trim();
  T.projDraft = name;
  T.projErr = !name ? 'Type a name for the project.' : D.projects.some(p => p.name.toLowerCase() === name.toLowerCase()) ? `"${D.projects.find(p => p.name.toLowerCase() === name.toLowerCase()).name}" already exists. Pick another name.` : '';
  if (!T.projErr && D.live) {
    let r; try { r = await api().create_project(name); } catch (e) { r = { status: 'error', message: plainErr(e) }; }
    if (r?.status === 'success') { D.projects.push(projFromApi({ id: r.id, name: r.name, color_slot: r.color_slot })); T.projDraft = ''; status(`Added "${name}"`); }
    else T.projErr = r?.message || "Couldn't add the project.";
  } else if (!T.projErr) { D.projects.push({ id: 'p-' + Date.now(), name, color: (D.projects.length % 6) + 1 }); T.projDraft = ''; status(`Added "${name}"`); }
  S.focus = { sel: '#new-project-name' }; renderAll();
}
// Deleting is blocked while a project has sessions (here and in api.delete_project). Its folders become top-level folders.
// Build L (R41): no confirm. The project leaves the list at once, with Undo for 10 seconds; the backend's delete runs after (dialogs.js hold)
function deleteProject(id) {
  const p = proj(id); if (!p) return;
  const i = D.projects.indexOf(p), kids = D.folders.filter(f => f.parent === id), wasT = T.projectId === id, under = D.live ? [] : D.folders.filter(f => ancestors(f.id).includes(id));
  hold({ msg: `Deleted “${p.name}”`, back: `“${p.name}” is back`,
    apply() { if (D.live) kids.forEach(f => { f.parent = null; }); else D.folders = D.folders.filter(f => !under.includes(f)); D.projects = D.projects.filter(x => x !== p); if (wasT) T.projectId = null; },
    undo() { if (!D.projects.includes(p)) D.projects.splice(Math.min(i, D.projects.length), 0, p); kids.forEach(f => { f.parent = id; }); under.forEach(f => { if (!D.folders.includes(f)) D.folders.push(f); }); if (wasT && !T.projectId) T.projectId = id; },
    async commit() {
      if (!D.live) return null;
      try { return await api().delete_project(idNum(id)); } catch (e) { return { status: 'error', message: plainErr(e) }; }
    } });
}

/* Phase 4: alerts, as the timer settings say (D.tset): the 5-minute warning, a sound when time is up, a desktop notification,
   the taskbar flash and reminders during overtime. The sounds are made with the Web Audio API, like the old timer's. */
let ALERT_CTX = null;
function tone(freq, dur, type, delay, vol) {
  try { ALERT_CTX ||= new (window.AudioContext || window.webkitAudioContext)(); const c = ALERT_CTX, o = c.createOscillator(), g = c.createGain();
    o.type = type; o.frequency.value = freq; g.gain.setValueAtTime(Math.max(.0001, vol), c.currentTime + delay); g.gain.exponentialRampToValueAtTime(.0001, c.currentTime + delay + dur);
    o.connect(g).connect(c.destination); o.start(c.currentTime + delay); o.stop(c.currentTime + delay + dur + .05); } catch (e) { /* no audio: stay quiet */ }
}
function sweep(vol) {
  try { ALERT_CTX ||= new (window.AudioContext || window.webkitAudioContext)(); const c = ALERT_CTX, o = c.createOscillator(), g = c.createGain();
    o.type = 'sawtooth'; o.frequency.setValueAtTime(200, c.currentTime); o.frequency.exponentialRampToValueAtTime(1000, c.currentTime + .3);
    g.gain.setValueAtTime(vol * .4, c.currentTime); g.gain.exponentialRampToValueAtTime(.0001, c.currentTime + .35); o.connect(g).connect(c.destination); o.start(); o.stop(c.currentTime + .4); } catch (e) { /* no audio */ }
}
const ALERT_SOUNDS = { bell: v => { tone(880, .6, 'sine', 0, v); tone(1320, .6, 'sine', .05, v * .5); }, chime: v => { tone(660, .25, 'sine', 0, v); tone(880, .35, 'sine', .15, v); },
  alarm: v => { for (let i = 0; i < 3; i++) tone(600, .15, 'square', i * .2, v * .6); }, pop: v => tone(300, .08, 'sine', 0, v * .7), scifi: v => sweep(v), silent: () => {} };
function playAlert() {
  const vol = (D.tset.volume ?? 60) / 100, builtIn = () => (ALERT_SOUNDS[D.tset.sound_name] || ALERT_SOUNDS.chime)(vol);
  const url = D.tset.custom_sound && customSoundUrl();   // Phase 5: a data: URL from api.read_custom_sound (render-settings.js)
  if (url) { try { const au = new Audio(url); au.volume = vol; au.play().catch(builtIn); return; } catch (e) { /* fall back */ } }
  builtIn();
}
function desktopNote(body) {
  try { if (!('Notification' in window) || Notification.permission === 'denied') return;
    const show = () => new Notification('NeuroVault', { body });
    if (Notification.permission === 'granted') show(); else Notification.requestPermission().then(p => { if (p === 'granted') show(); }); } catch (e) { /* not available */ }
}
function timeUp(repeat) {
  const name = proj(T.projectId)?.name || 'Your session';
  if (D.tset.sound) playAlert();
  if (D.tset.desktop && !repeat) desktopNote(`${name}: time is up`);
  if (D.tset.taskbar) api()?.flash_taskbar()?.catch?.(() => {});
}
function heartbeat() {   // tells the backend the app is still open, about once a minute, so closed time can be told apart
  if (!D.live || (T.away != null && S.modal === 'timer-away')) return;
  T.away = null;   // the question was closed without an answer: the time counts
  if (Date.now() - (T.beat || 0) < 60000) return; T.beat = Date.now();
  api().update_running_session('heartbeat').then(r => { if (r?.status !== 'success') return; const was = UI.tstate; syncRunning(r.session); if (UI.tstate !== was) renderAll(); else paintTimer(); }).catch(() => {});
}
function paintTimer() {   // updates the clock text, dial and bar in place, so typing and focus are never interrupted
  app.querySelectorAll('[data-tick="time"]').forEach(el => { el.textContent = timeText(); });
  app.querySelectorAll('[data-tick="pause"]').forEach(el => { el.textContent = fmtClock(T.pauseElapsed); });
  app.querySelectorAll('[data-tick="bar"]').forEach(el => { el.style.width = (dialFrac() * 100).toFixed(1) + '%'; });
  app.querySelectorAll('[data-tick="qtbar"]').forEach(el => { const { left, band } = qtBand(); el.dataset.band = band; el.firstElementChild.style.width = (left * 100).toFixed(1) + '%'; });   // R7
}
function timerTick() {
  if (!D.projects.length || !TIMER_ACTIVE.includes(UI.tstate)) return;
  heartbeat();
  if (!T.sync) markClock();   // dev: the seeded sample session starts from here
  const before = T.elapsed; clockNow();
  if (UI.tstate === 'paused' || UI.tstate === 'pausepick') { paintTimer(); return; }
  const after = T.elapsed, planned = T.mode === 'planned', crossed = x => before < x && after >= x;
  const every = (n, from = 0) => n > 0 && after - from >= n && Math.floor((before - from) / n) < Math.floor((after - from) / n);
  if (S.a11y.nudge && every(S.a11y.nudge * 60) && UI.widgets !== 'nudge' && !POP) { setUI('widgets', 'nudge'); return; }   // R7: hyperfocus nudge (Build H: in NeuroVault's window)
  const here = alertsHere();   // Build H: one window sounds the alerts and asks the check-in: a popped-out timer's, else NeuroVault's
  if (planned && T.target > 300 && crossed(T.target - 300) && D.tset.five_min && here) { tone(700, .15, 'sine', 0, (D.tset.volume ?? 60) / 200); toast('5 minutes left'); }
  if (planned && crossed(T.target + 1)) { if (here) timeUp(false);
    if (UI.tstate === 'running') { goTimer('overtime'); if (here) toast("Time's up"); return; }
    if (UI.tstate === 'checkin') T.prev = 'overtime'; }
  if (planned && UI.tstate === 'overtime' && D.tset.overtime_repeat && every((D.tset.interval || 5) * 60, T.target) && here) timeUp(true);
  if (UI.tstate !== 'checkin' && here && every(checkinSec())) {   // R5: a check-in (Build H: every Settings → Timer alerts → Check-ins; 0 = off); it takes the keyboard only from the timer itself
    T.prev = UI.tstate; const ae = document.activeElement, mine = !ae || ae === document.body || !!ae.closest?.('#timer-card, .widget.qt');
    goTimer('checkin', mine ? '#milestone-input, #qt-milestone' : null); return; }
  paintTimer();
}
// R8: the quick-timer button and the running-timer pill are one control in the window bar
function timerPill() {
  const p = proj(T.projectId), paused = isPaused(), lab = `Quick timer · ${p?.name || ''}${paused ? ' · paused' : ''}`;
  return `<button class="top-btn top-btn--timer${paused ? ' is-paused' : ''}" data-act="qt-toggle" aria-pressed="${qtOpen()}" aria-label="${esc(lab)}" title="${esc(lab)} · click for the quick timer">${ic(paused ? 'pause' : 'timer')}<span class="num" data-tick="time">${timeText()}</span><span class="top-timer-proj">${esc(p?.name || '')}</span></button>`;
}
