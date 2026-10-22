/* BUILD F · THE END-OF-DAY WRAP-UP AND THE MORNING LAUNCHPAD. Extracted from design/vault-notes-mockups.html (R29, surfaces
   wrap1, wrap2, wrap3 and launch; Settings → Daily wrap-up):
   - the window bar's sunset button (or Ctrl+K "Wrap up day") opens it; at the wind-down time a calm reminder opens it, with
     Snooze while a timer runs (Settings: on/off, the time, the snooze length);
   - 1 Today's wins: tasks and steps ticked today, focus time and sessions; pick one (or name one) to celebrate;
   - 2 Tidy up, no guilt: tasks due by today, sticky notes and inbox thoughts: Roll to tomorrow, Park in backlog or Mark done
     (nothing changes until Finish, so Undo is free);
   - 3 Note to tomorrow-you: up to 3 starter tasks (picked or typed), a note, and a 10-second voice memo recorded with
     Build A's pill and kept as a clip (voice_start(10) → voice_stop → wrapup_memo_keep), played with Build A's clip player;
   - the morning launchpad: on the first open of a later day, the note, the memo and the first starter task, with
     "Launch first task and timer" (the quick timer, on the timer backend's running session).
   With the app it reads and writes through window.pywebview.api (wrapup_* and launchpad_*, design/api-contract.md);
   on the sample vault (a browser, ?check=1) it works in memory, as the mockup did. */
'use strict';
Object.assign(ICON, { arrowr: '<path d="M5 12h14M12 5l7 7-7 7"/>',
  star: '<path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z"/>' });

/* ---- Settings (config.json): the reminder, its time, the snooze length, the launchpad ---- */
const WRAP = { cfg: { on: true, time: '17:00', snooze: 15, launchpad: true }, lp: null, day: null, timer: null, lpPending: false, quietDay: null };
const WRAP_CFG = { on: ['wrapup_reminder', v => typeof v === 'boolean'], time: ['wrapup_time', v => typeof v === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(v)],
  snooze: ['wrapup_snooze_minutes', v => [10, 15, 30].includes(v)], launchpad: ['wrapup_launchpad', v => typeof v === 'boolean'] };
const _readerFromConfigF = readerFromConfig;
readerFromConfig = function (c) { _readerFromConfigF(c); Object.entries(WRAP_CFG).forEach(([k, [key, good]]) => { if (good(c[key])) WRAP.cfg[k] = c[key]; }); };
function setWrapCfg(k, v) { WRAP.cfg[k] = v; saveSettings({ [WRAP_CFG[k][0]]: v }); }
const wrapLive = () => !!api() && VAULT.live;   // a sample vault (?check=1 through the dev bridge too) never writes
const wrapOpen = () => /^wrap[123]$/.test(S.modal || '');
const timerLive = () => TIMER_ACTIVE.includes(UI.tstate) && D.projects.length > 0;
// Ctrl+K's "Wrap up day" and "Open morning launchpad" are built now
PAL_COMMANDS.forEach(c => { if (c[2] === 'wrap' || c[2] === 'launch') c.length = 4; });

/* ---- Step 1: wins. With the app, wrapup_wins (ticked today, by completed_at / done_at); on the sample, from memory ---- */
function sampleWins() {
  const tS = timerStats(), by = {};
  tS.today.forEach(s => { const k = s.project_id || 'none', b = by[k] ||= { id: k, name: s.project_name, color: s.color, count: 0, seconds: 0 }; b.count++; b.seconds += s.actual_seconds; });
  const steps = D.tasks.flatMap(t => (t.steps || []).map((s, i) => s.done ? { id: `${t.id}:${i}`, title: s.t, task: t.title } : null).filter(Boolean));
  return { tasks: D.tasks.filter(t => t.done).map(t => ({ id: t.id, title: t.title })), steps, projects: Object.values(by).sort((a, b) => b.seconds - a.seconds),
    totals: { tasks: D.tasks.filter(t => t.done).length, steps: steps.length, sessions: tS.today.length, seconds: tS.todaySec } };
}
const winsFromApi = r => ({ tasks: r.tasks.map(t => ({ id: 't-' + t.id, title: t.title })), steps: r.steps.map(s => ({ id: 's-' + s.id, title: s.text, task: s.task_title })),
  projects: r.projects.map(p => ({ id: p.project_id != null ? 'p-' + p.project_id : 'none', name: p.name, color: p.color || 0, count: p.count, seconds: p.seconds || 0 })), totals: r.totals });
function winItems(W) {
  return [...W.tasks.map(t => ({ key: 'task:' + t.id, label: t.title, icon: 'ok', src: 'Task' })), ...W.steps.map(s => ({ key: 'step:' + s.id, label: s.title, icon: 'ok', src: 'Step of ' + s.task })),
    ...W.projects.map(p => ({ key: 'project:' + p.id, label: `Focused ${fmtDur(p.seconds)} on ${p.name}`, icon: 'timer', src: `${p.count} session${p.count === 1 ? '' : 's'}` }))];
}

/* ---- Step 2: the loose ends, from the store (tasks due by today, every sticky note, inbox thoughts not done) ---- */
const TRIAGE = { roll: ['arrowr', 'Roll to tomorrow', 'Rolled to tomorrow', 'accent'], park: ['archive', 'Park in backlog', 'Parked', 'neutral'], done: ['ok', 'Mark done', 'Done', 'success'] };
const TRIAGE_TIP = { task: { roll: 'Due tomorrow', park: 'No due date: it waits in the backlog', done: 'Ticks the task' },
  sticky: { roll: 'Stays on the screen for tomorrow', park: 'The card closes; it stays in Sticky Notes', done: 'Deletes the sticky note' },
  inbox: { roll: 'Stays in the Brain Dump', park: 'Becomes a task in the backlog', done: 'Ticked off in the Brain Dump' } };
function triageItems() {
  D.inbox.forEach((x, i) => { x.id ||= 'in-s' + i; });   // the sample's thoughts have no ids
  const day = todayKey(), when = x => (x.day && x.day !== day ? new Date(x.day + 'T12:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) + ' ' : '') + (x.t || '');
  return [...D.tasks.filter(t => !t.done && t.due === 'Today').map(t => ({ key: 'task:' + t.id, kind: 'task', id: t.id, label: t.title, src: ['Task', taskProjectName(t)].filter(Boolean).join(' · '), icon: 'tasks' })),
    ...D.stickies.map(s => ({ key: 'sticky:' + s.id, kind: 'sticky', id: s.id, label: stickyTitle(s, 120) || 'Empty sticky note', src: 'Sticky #' + s.n, icon: 'sticky' })),
    ...D.inbox.filter(x => !x.done).map(x => ({ key: 'inbox:' + x.id, kind: 'inbox', id: x.id, label: x.text || x.tasks?.[0] || 'Voice thought', src: 'Brain Dump · ' + when(x), icon: 'inbox' }))];
}

/* ---- Step 3: starter tasks (rolled ones first, then today's), up to 3 with the typed ones ---- */
function starterPool() {
  const w = S.wrap, rank = t => w.triage['task:' + t.id] === 'roll' ? 0 : t.due === 'Today' ? 1 : 2;
  return D.tasks.filter(t => !t.done && w.triage['task:' + t.id] !== 'done').sort((a, b) => rank(a) - rank(b)).slice(0, 8);
}
const starterCount = () => S.wrap.starters.size + S.wrap.typed.length;

/* ---- The dialog (mockup wrapModal) ---- */
function wrapModal() {
  const w = S.wrap, step = +S.modal.slice(4), steps = ["Today's wins", 'Tidy up, no guilt', 'Note to tomorrow-you'];
  let body = '';
  if (step === 1) {
    const W = w.wins;
    if (!W) body = `<div class="receipt">${skelCard(40).repeat(3)}</div>${skelCard(120)}`;
    else if (W.error) body = `<div class="alert alert--danger" role="alert">${ic('alert')}<span>${esc(plainMsg(W.error))}</span></div>`;
    else { const T0 = W.totals, items = winItems(W);
      body = `<div class="receipt">${kpi(T0.tasks, `task${T0.tasks === 1 ? '' : 's'} done`)}${kpi(T0.steps, `step${T0.steps === 1 ? '' : 's'} ticked`)}${kpi(fmtDur(T0.seconds), `focus · ${T0.sessions} session${T0.sessions === 1 ? '' : 's'}`)}</div>
        <div class="card card-pad"><div class="eyebrow">${items.length ? 'Done today · pick one to celebrate' : 'Done today'}</div><div class="win-list" role="group" aria-label="Pick today's win">${items.map(it => { const on = w.winRef === it.key;
          return `<button class="win-row win-pick" data-act="wrap-win" data-v="${esc(it.key)}" aria-pressed="${on}" title="${esc(it.src)}">${ic(on ? 'star' : it.icon)}<span class="truncate">${esc(it.label)}</span>${on ? `<span class="chip chip--success">Today's win</span>` : ''}</button>`; }).join('')
          || '<div class="list-item-sub">No ticks today, and that is fine. You still showed up.</div>'}</div></div>
        <label class="rate-row"><span class="set-label">${items.length ? 'Or name a win in your own words' : 'Name a win in your own words'}</span><input class="field" id="wrap-win-text" data-act="wrap-win-text" maxlength="500" placeholder="e.g. Answered the email I'd been avoiding" value="${esc(w.winRef ? '' : w.win)}" autocomplete="off"></label>`; }
  } else if (step === 2) {
    const items = triageItems();
    body = `<p class="view-sub">Decide where each loose end goes. Nothing here is late; it just needs a home.</p><div class="card card-pad">${items.map(it => { const c = w.triage[it.key];
      return `<div class="triage-row"><div class="session-main"><span class="session-name">${ic(it.icon)}<span class="truncate">${esc(it.label)}</span></span><span class="session-note">${esc(it.src)}</span></div>
        <div class="triage-actions">${c ? `<span class="chip chip--${TRIAGE[c][3]}">${ic(TRIAGE[c][0])}${TRIAGE[c][2]}</span><button class="link-btn" data-act="wrap-triage" data-v="${esc(it.key)}|">Undo</button>`
          : Object.entries(TRIAGE).map(([k, [i, l]]) => `<button class="btn btn--${k === 'roll' ? 'tint' : 'secondary'} btn--sm" data-act="wrap-triage" data-v="${esc(it.key)}|${k}" title="${TRIAGE_TIP[it.kind][k]}">${ic(i)}${l}</button>`).join('')}</div></div>`; }).join('')
      || '<div class="empty empty--compact"><div class="empty-text">Nothing loose today.</div></div>'}</div>`;
  } else {
    const open = starterPool(), full = starterCount() >= 3, rec = !!w.memoRec;
    const typed = w.typed.map((t, i) => `<div class="task starter-typed"><input type="checkbox" checked data-act="wrap-typed-remove" data-v="${i}" aria-label="Remove ${esc(t)}"><span>${esc(t)}</span><span class="chip chip--neutral">New</span></div>`).join('');
    body = `<div class="card card-pad"><div class="eyebrow">Start tomorrow with (pick up to 3)</div><div class="win-list">${open.map(t => { const on = w.starters.has(t.id);
        return `<label class="task"><input type="checkbox" data-act="wrap-starter" data-v="${t.id}" ${on ? 'checked' : ''} ${!on && full ? 'disabled' : ''}><span>${esc(t.title)}</span></label>`; }).join('')}${typed}
        ${open.length || typed ? '' : '<div class="list-item-sub">No open tasks. Type one to start with.</div>'}</div>
        <div class="starter-add"><input class="field" id="wrap-starter-input" data-act="wrap-starter-draft" maxlength="200" placeholder="${full ? 'Three is plenty' : 'Type a new starter task'}" value="${esc(w.draft)}" aria-label="New starter task" autocomplete="off" ${full ? 'disabled' : ''}><button class="btn btn--secondary" data-act="wrap-starter-add" ${full ? 'disabled' : ''}>${ic('plus')}Add</button></div></div>
      <label class="rate-row"><span class="set-label">Where I left off, and what to do first</span><textarea class="field field--area" id="wrap-note" data-act="wrap-note" rows="3" maxlength="5000" placeholder="e.g. The failing test is already open. Start there, roadmap after 11.">${esc(w.note)}</textarea></label>
      <div class="memo-row"><div class="note-meta"><button class="btn btn--secondary" id="wrap-memo" data-act="wrap-memo" ${rec ? 'aria-pressed="true"' : ''} ${S.voice.stage === 'saving' && w.memoRec ? 'disabled' : ''}>${ic(rec ? 'stop' : 'mic')}${rec ? 'Recording… tap to stop' : w.memo ? 'Record again' : 'Record a 10-second memo'}</button>
        ${w.memo && !rec ? `<span class="chip chip--success">${ic('ok')}Memo saved · ${fmtT(w.memo.seconds)}</span><button class="icon-btn icon-btn--sm" data-act="wrap-memo-remove" aria-label="Delete the memo" title="Delete the memo (it goes to the recycle bin)">${ic('trash')}</button>` : ''}</div>
        ${w.memo && !rec ? clipHtml(clipFor(w.memo.file), { ctx: 'panel' }) : ''}</div>`;
  }
  const busy = !!w.busy;
  // Build L: R41's anatomy, medium. Back on the left; Snooze, then the main button last; × closes (nothing changes until Finish)
  return dlg({ id: 'wrap', size: 'md', keep: true, cls: 'wrap-modal', backdropCls: pillOn() ? ' has-pill' : '', title: 'Wrap up the day', titleId: 'wr-t',
    headExtra: `<div class="stepper" aria-label="Steps">${steps.map((l, i) => `<span class="step${i + 1 < step ? ' is-done' : ''}" ${i + 1 === step ? 'aria-current="step"' : ''}><span class="step-num">${i + 1 < step ? ic('ok') : i + 1}</span>${l}</span>`).join('')}</div>`,
    xLabel: 'Close wrap-up', xTitle: 'Close (nothing changes until Finish)', body,
    back: step > 1 ? `<button class="btn btn--secondary" data-act="wrap-step" data-v="${step - 1}">Back</button>` : '',
    others: [timerLive() ? `<button class="btn btn--secondary wrap-snooze" data-act="wrap-snooze" title="The timer keeps going; this comes back in ${WRAP.cfg.snooze} minutes">Snooze ${WRAP.cfg.snooze} min</button>` : ''],
    main: step < 3 ? `<button class="btn btn--primary" id="wrap-next" data-act="wrap-step" data-v="${step + 1}">Next</button>` : `<button class="btn btn--primary" id="wrap-next" data-act="wrap-finish" ${busy || w.memoRec ? 'disabled' : ''}>${busy ? '<span class="spinner" aria-hidden="true"></span>Saving…' : ic('moon') + 'Finish the day'}</button>` });
}
async function openWrap(prompted = false) {
  if (wrapOpen()) return;
  if (S.modal) closeModal(true);
  S.menu = false; S.edPop = null; S.stickyMenu = null; S.ctx = null;
  S.wrap = { prompted, winRef: null, win: '', triage: {}, starters: new Set(), typed: [], draft: '', note: '', memo: null, memoRec: false, busy: false, wins: wrapLive() ? null : sampleWins() };
  S.modal = 'wrap1'; S.focus = { sel: '#wrap-next' }; renderAll();
  if (!wrapLive()) return;
  const w = S.wrap, [r, g] = await Promise.all([nv('wrapup_wins'), nv('wrapup_get')]);
  if (S.wrap !== w) return;
  w.wins = failed(r) ? { error: r.message || "Couldn't read today's wins." } : winsFromApi(r);
  const row = !failed(g) && g.wrapup;   // what was saved today already (a memo, or a wrap-up finished earlier)
  if (row) { if (row.memo) { w.memo = { file: row.memo, seconds: row.memo_seconds || 0 }; (PLAYER.durs ||= {})[row.memo] = row.memo_seconds || 0; }
    if (row.finished) { w.note = row.note; w.win = row.win; w.winRef = row.win_ref ? row.win_ref.replace(/^(task|step|project):(\d+)$/, (_, k, n) => `${k}:${{ task: 't-', step: 's-', project: 'p-' }[k]}${n}`) : null; (row.starters || []).forEach(s => { if (taskById('t-' + s.task_id) && !taskById('t-' + s.task_id).done) w.starters.add('t-' + s.task_id); }); } }
  if (wrapOpen()) renderAll();
}
function wrapStep(n) {
  const w = S.wrap; if (!w || w.memoRec) { if (w?.memoRec) toast('Stop the memo first'); return; }
  S.modal = 'wrap' + n; S.focus = { sel: '#wrap-next' }; renderAll();
  app.querySelector('.wrap-modal .modal-body')?.scrollTo(0, 0);   // a new step starts at its top
}
function pickWin(key) {
  const w = S.wrap, it = winItems(w.wins || { tasks: [], steps: [], projects: [] }).find(x => x.key === key); if (!it) return;
  if (w.winRef === key) { w.winRef = null; w.win = ''; } else { w.winRef = key; w.win = it.label; }
  S.focus = { sel: `[data-act="wrap-win"][data-v="${CSS.escape(key)}"]` }; renderAll();
}
function addStarter() {
  const w = S.wrap, el = app.querySelector('#wrap-starter-input'), t = (el?.value || w.draft).replace(/\s+/g, ' ').trim();
  if (!t || starterCount() >= 3) { el?.focus(); return; }
  w.typed.push(t); w.draft = ''; S.focus = { sel: starterCount() >= 3 ? '#wrap-note' : '#wrap-starter-input' }; renderAll();
}

/* ---- Finish: the tidy choices, the starters, the note and the win (Finish the day) ---- */
async function finishWrap() {
  const w = S.wrap; if (!w || w.busy || w.memoRec) return;
  const tidy = Object.entries(w.triage).map(([key, action]) => { const i = key.indexOf(':'); return { kind: key.slice(0, i), id: key.slice(i + 1), action }; });
  if (wrapLive()) {
    w.busy = true; renderAll();
    const ref = w.winRef && w.winRef.split(':'), refId = ref && rawId(ref[1]);   // task:12 | step:4 | project:2, as the database has them
    const r = await nv('wrapup_finish', { win: w.win, win_ref: refId ? ref[0] + ':' + refId : null, note: w.note, starters: [...w.starters].map(rawId).filter(Boolean), new_starters: w.typed,
      tidy: tidy.map(t => ({ kind: t.kind, id: rawId(t.id), action: t.action })) });
    w.busy = false;
    if (failed(r)) { toast(r.message || "Couldn't save the wrap-up."); renderAll(); return; }
    w.finished = true;
    await wrapReload();
    WRAP.day = null;   // the next tick reads the reminder state again
    closeModal(true); toast(r.errors?.length ? `Day wrapped. ${r.errors.length} loose end${r.errors.length === 1 ? '' : 's'} couldn't be sorted: ${r.errors[0].message}` : 'Day wrapped. Tomorrow-you has a starting point');
    return;
  }
  // the sample vault: the mockup's finishDay, in memory
  tidy.forEach(({ kind, id, action }) => {
    if (kind === 'task') { const t = taskById(id); if (t) { if (action === 'done') t.done = true; else t.due = 'Upcoming'; redrawNote(t); } }
    if (kind === 'sticky') { const s = stickyById(id); if (s) { if (action === 'done') forgetSticky(s); else s.open = action === 'roll'; } }
    if (kind === 'inbox') { const x = D.inbox.find(i => i.id === id); if (x && action !== 'roll') { x.done = true;
      if (action === 'park') D.tasks.unshift({ id: 't-park-' + Date.now() + '-' + id, noteId: null, title: x.text || x.tasks?.[0] || 'Voice thought', priority: 'Medium', due: 'Upcoming', done: false, energy: 'medium' }); } }
  });
  const typed = w.typed.map((title, i) => { const t = { id: 't-start-' + Date.now() + '-' + i, noteId: null, title, priority: 'Medium', due: 'Upcoming', done: false, energy: 'medium' }; D.tasks.unshift(t); return t.id; });
  const d = new Date();
  D.bridge = { day: todayKey(), at: clock(d), note: w.note.trim(), starters: [...w.starters].filter(id => !taskById(id)?.done).concat(typed).slice(0, 3), memo: w.memo, win: w.win };
  w.finished = true; closeModal(true); toast('Day wrapped. Tomorrow-you has a starting point');
}
// After Finish on a real vault: the tasks, sticky notes and inbox as the database now has them
async function wrapReload() {
  const r = await nv('list_tasks'); if (Array.isArray(r)) { D.tasks = r.map(mapTask); D.notes.forEach(n => { n.html = null; }); }
  await loadCapture();
}

/* ---- The 10-second memo: Build A's recorder and pill, kept as a clip on today's wrap-up ---- */
async function memoStart() {
  const v = S.voice, w = S.wrap; if (!w) return;
  if (v.stage !== 'idle') { toast('Finish the voice ramble first'); return; }
  Object.assign(v, { stage: 'recording', memo: true, seconds: 0, bars: [], words: null, paused: false, startedAt: new Date(), demo: !wrapLive(), forceDest: null });
  w.memoRec = true; S.focus = { sel: '#wrap-memo' }; renderAll();
  if (!wrapLive()) {   // no app: the clock runs for 10 seconds by itself (the check never starts it)
    if (!CHECK) { const t0 = Date.now(); voicePollEvery(() => { v.seconds = (Date.now() - t0) / 1000; paintMemoClock(); if (v.seconds >= 10) memoStop(); }); }
    return;
  }
  const r = await nv('voice_start', 10);
  if (!S.wrap?.memoRec || S.wrap !== w) { nv('voice_discard'); return; }
  if (failed(r)) { memoReset(); toast(r.message || "Couldn't start the microphone."); renderAll(); return; }
  voicePollEvery(memoTick);
}
const paintMemoClock = () => { const el = app.querySelector('[data-voice-clock]'); if (el) el.textContent = mmss(S.voice.seconds); };
async function memoTick() {
  const r = await nv('voice_poll'), v = S.voice; if (failed(r) || !v.memo || v.stage !== 'recording') return;
  if (r.stage === 'recording') { v.seconds = r.seconds; v.words = r.words; paintMemoClock(); const ww = app.querySelector('[data-voice-words]'); if (ww && !v.paused && v.words) ww.textContent = '…' + v.words; if (r.full) memoStop(); return; }
  if (r.stage === 'error') { memoReset(); toast(r.message || 'The recording stopped.'); renderAll(); }
}
async function memoStop() {
  const v = S.voice, w = S.wrap; if (!v.memo || v.stage !== 'recording') return;
  voiceStopPolling(); v.stage = 'saving'; renderAll();
  if (!wrapLive()) {
    const file = takeClip().file, seconds = Math.min(10, Math.max(1, Math.round(v.seconds))) || 10;
    D.atts = [{ file, name: attBase(file), kind: 'audio', size: seconds * 4000, mtime: new Date().toISOString(), seconds }, ...(D.atts || []).filter(a => a.file !== w?.memo?.file)];
    memoReset(); if (w) w.memo = { file, seconds }; status('Memo saved'); renderAll(); return;
  }
  const s = await nv('voice_stop');
  const k = failed(s) ? s : await nv('wrapup_memo_keep');
  memoReset();
  if (failed(k)) { toast(k.message || "Couldn't save the memo."); renderAll(); return; }
  (PLAYER.durs ||= {})[k.file] = k.seconds;
  if (S.wrap === w) w.memo = { file: k.file, seconds: k.seconds };
  await refreshAtts(); status('Memo saved'); renderAll();
}
function memoReset() { voiceStopPolling(); Object.assign(S.voice, { stage: 'idle', memo: false, paused: false, words: null, demo: false }); if (S.wrap) S.wrap.memoRec = false; }
function memoDiscard() { if (wrapLive()) nv('voice_discard'); memoReset(); }
async function memoRemove() {
  const w = S.wrap; if (!w?.memo) return;
  if (PLAYER.id === w.memo.file) stopPlayer();
  if (wrapLive()) { const r = await nv('wrapup_memo_remove'); if (failed(r)) { toast(r.message); return; } await refreshAtts(); }
  w.memo = null; status('Memo moved to the recycle bin'); S.focus = { sel: '#wrap-memo' }; renderAll();
}
// The pill's Stop and × (and the window bar's mic) mean the memo while it records
const _voiceStopF = voiceStop;
voiceStop = function () { return S.voice.memo ? memoStop() : _voiceStopF(); };
const _voiceDiscardF = voiceDiscard;
voiceDiscard = function () { if (!S.voice.memo) return _voiceDiscardF(); memoDiscard(); status('Memo discarded'); renderAll(); };

/* ---- Snooze, close ---- */
async function snoozeWrap() {
  const m = WRAP.cfg.snooze, w = S.wrap; if (w?.memoRec) memoDiscard();
  if (w) w.finished = true;   // a snooze isn't a dismissal
  closeModal(true);
  if (wrapLive()) { const r = await nv('wrapup_snooze', m); if (failed(r)) { toast(r.message); renderAll(); return; } }
  toast(`Wrap-up snoozed for ${m} minutes`);
}
const _closeModalF = closeModal;
closeModal = function (quiet) {
  if (wrapOpen()) {
    const w = S.wrap; if (w?.memoRec) memoDiscard();
    if (w?.memo && PLAYER.id === w.memo.file) stopPlayer();
    if (w?.prompted && !w.finished && wrapLive()) nv('wrapup_dismiss');   // the reminder was closed: not again today
  }
  if (S.modal === 'launch' && WRAP.lp?.memo && PLAYER.id === WRAP.lp.memo) stopPlayer();
  return _closeModalF(quiet);
};
// Esc while the memo records, with focus outside the pill, would close the wrap-up and lose it: only the pill's × discards
document.addEventListener('keydown', e => { if (e.key === 'Escape' && S.voice?.memo && !e.target.closest?.('.vpill')) { e.stopImmediatePropagation(); e.preventDefault(); } }, true);

/* ---- The morning launchpad (mockup launchModal) ---- */
const lpFromApi = L => ({ day: L.day, at: (L.finished_at || '').slice(11, 16), note: L.note || '', memo: L.memo || null, memoSeconds: L.memo_seconds || 0, win: L.win || '',
  starters: L.starters.map(s => ({ id: 't-' + s.task_id, title: s.title, done: s.done || s.gone, minutes: s.minutes || 25, energy: s.energy })), first: L.first ? 't-' + L.first.task_id : null, minutes: L.first?.minutes || 25 });
const SAMPLE_MEMO = 'attachments/voice-20261013-170412.ogg';
function lpFromSample() {
  const b = D.bridge; if (!b) return null;
  const ids = b.starters || (b.starter ? [b.starter] : []), memo = b.memo === true ? { file: SAMPLE_MEMO, seconds: 10 } : b.memo || null;
  const starters = ids.map(id => taskById(id)).filter(Boolean).map(t => ({ id: t.id, title: t.title, done: t.done, energy: t.energy, minutes: (t.steps || []).find(s => !s.done && s.m)?.m || 25 }));
  if (memo) (PLAYER.durs ||= {})[memo.file] = memo.seconds;
  const first = starters.find(s => !s.done) || null;
  return { day: b.day || null, at: b.at || '17:04', note: b.note || '', memo: memo?.file || null, memoSeconds: memo?.seconds || 0, win: b.win || '', starters, first: first?.id || null, minutes: first?.minutes || 25 };
}
function launchModal() {
  const L = WRAP.lp, now = new Date(), first = L?.first ? taskById(L.first) || L.starters.find(s => s.id === L.first) : null, fs = L?.starters.find(s => s.id === L?.first);
  const greet = now.getHours() < 12 ? 'Good morning' : now.getHours() < 18 ? 'Good afternoon' : 'Good evening';
  const yest = L?.day && Math.round((new Date(todayKey() + 'T12:00') - new Date(L.day + 'T12:00')) / 864e5) > 1 ? new Date(L.day + 'T12:00').toLocaleDateString('en-GB', { weekday: 'long' }) + '-you' : 'Yesterday-you';
  const rest = (L?.starters || []).filter(s => s.id !== L.first && !s.done);
  const go = first && D.projects.length;
  // Build L: R41's anatomy, medium: the greeting is the title with the date under it, × to close, [Not now] [Launch…]
  return dlg({ id: 'launch', size: 'md', cls: 'launch', title: `${greet}. Here's where you left off.`, titleId: 'lp-t', sub: esc(now.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })),
    body: `    ${L?.note ? `<blockquote class="launch-quote">${esc(L.note).replace(/\n/g, '<br>')}<div class="list-item-sub">${yest}${L.at ? ', ' + esc(L.at) : ''}</div></blockquote>` : `<p class="view-sub">No note from ${L ? 'last time' : 'yesterday'}. Pick one small thing to start with.</p>`}
    ${L?.memo ? `<div class="launch-memo"><div class="eyebrow">Your 10-second memo</div>${clipHtml(clipFor(L.memo), { ctx: 'panel' })}</div>` : ''}
    ${first ? `<div class="card card-pad"><div class="eyebrow">First task</div><div class="task-card-title">${esc(first.title)}</div><div class="task-card-meta">${energyChip({ energy: first.energy || 'medium' }, true)}<span>${fs?.minutes || 25} minutes suggested</span></div>
      ${rest.length ? `<div class="launch-next">${rest.map(s => `<div class="list-item-sub truncate">Then: ${esc(s.title)}</div>`).join('')}</div>` : ''}</div>`
      : `<div class="empty empty--compact"><div class="empty-text">No starter task left open. Enjoy the clear start.</div></div>`}
    ${first && !D.projects.length ? `<p class="set-desc">Make a project in Timer → Projects first, so the session has somewhere to go.</p>` : ''}`,
    cancel: '<button class="btn btn--secondary" data-act="close">Not now</button>',
    main: `<button class="btn btn--primary" id="launch-go" data-act="launch-go" ${go ? '' : 'disabled'}>${ic('rocket')}Launch first task and timer</button>` });
}
async function openLaunch(auto = false) {
  if (S.modal === 'launch') return;
  let L = null;
  if (wrapLive()) { const r = await nv('launchpad_get'); if (failed(r)) { toast(r.message); return; } L = r.launchpad ? lpFromApi(r.launchpad) : null; if (auto && (!r.show || !L)) return; }
  else L = lpFromSample();
  if (auto && S.modal) { WRAP.lpPending = true; return; }   // after the dialog that's open
  WRAP.lpPending = false; WRAP.lp = L;
  if (S.modal) closeModal(true);
  S.menu = false; S.modal = 'launch'; S.focus = { sel: L?.first ? '#launch-go' : '[data-act="close"]' }; renderAll();
  if (auto && L && wrapLive()) nv('launchpad_seen', L.day);
}
async function launchGo() {
  const L = WRAP.lp, tk = L?.first && taskById(L.first); if (!L?.first) return;
  const title = tk?.title || L.starters.find(s => s.id === L.first)?.title || '';
  if (wrapLive()) {
    const r = await nv('launchpad_launch', L.day); if (failed(r)) { toast(r.message || "Couldn't start the timer."); return; }
    closeModal(true); T.link = 'task:t-' + r.task_id; S.qtDur = r.minutes; UI.widgets = qtOpen() ? UI.widgets : 'timer';
    if (r.started) { syncRunning(r.session); status(`Started ${r.minutes} minutes on "${title.slice(0, 40)}"`); }
    toast(r.started ? `${r.minutes}-minute timer started` : r.reason === 'rate' ? 'Log the last session first, then start this one' : 'A timer is already running: the task is linked to it');
    if (tk?.noteId && D.notes.some(n => n.id === tk.noteId)) openNote(tk.noteId); else renderAll();
    return;
  }
  // the sample vault: the mockup's launchGo
  const nn = tk && D.notes.find(x => x.id === tk.noteId), pj = (nn && rootProject(nn.folder)) || taskProject(tk) || D.projects[0]; if (!pj) return;
  closeModal(true); T.link = 'task:' + L.first; S.qtDur = L.minutes; if (!qtOpen()) UI.widgets = 'timer';
  if (TIMER_ACTIVE.includes(UI.tstate) || UI.tstate === 'rate') { toast(UI.tstate === 'rate' ? 'Log the last session first, then start this one' : 'A timer is already running: the task is linked to it'); renderAll(); return; }
  if (nn) { S.noteId = nn.id; UI.view = 'notes'; }
  status(`Started ${L.minutes} minutes on "${title.slice(0, 40)}"`); startSession('planned', L.minutes, pj.id, tk?.id); toast(`${L.minutes}-minute timer started`);
}

/* ---- The reminder: asked about every 30 seconds (once the vault is loaded); a new day may bring the launchpad ---- */
async function wrapTick() {
  if (!wrapLive()) return;
  const st = await nv('wrapup_status'); if (failed(st)) return;
  // Packaging test (user, 2026-10-18): nothing pops up over the guided setup, nor for the rest of a first run's day
  if (SETUP.open) { if (!SETUP.again) WRAP.quietDay = st.day; return; }
  if (st.day === WRAP.quietDay) return;
  if (st.day !== WRAP.day) { WRAP.day = st.day; await openLaunch(true); }
  else if (WRAP.lpPending && !S.modal) await openLaunch(true);
  if (st.due && !S.modal && !pillOn() && S.voice.stage === 'idle') openWrap(true);
}
function wrapStart() { if (WRAP.timer || CHECK) return; setTimeout(wrapTick, 1500); WRAP.timer = setInterval(wrapTick, 30000); }

/* ---- Settings → Daily wrap-up (mockup settingsPane('wrapup')) ---- */
function wrapSettings() {
  const c = WRAP.cfg, tog = (k, l, d) => `<div class="set-row"><div><div class="set-label" id="wu-${k}">${l}</div><div class="set-desc">${d}</div></div><button class="toggle" role="switch" aria-checked="${c[k]}" aria-labelledby="wu-${k}" data-act="wrap-cfg" data-v="${k}"></button></div>`;
  return tog('on', 'Remind me to wrap up', `A calm prompt at your wind-down time, with Snooze ${c.snooze} min if a timer is running`)
    + `<div class="set-row"><div><div class="set-label" id="wind-l">Wind-down time</div><div class="set-desc">After midnight counts as the same evening until 04:00</div></div><input class="field field-time num" type="time" id="wrap-time" value="${esc(c.time)}" data-act="wrap-time" aria-labelledby="wind-l" ${c.on ? '' : 'disabled'}></div>
    <div class="set-row"><div><div class="set-label" id="snz-l">Snooze for</div><div class="set-desc">Offered while a timer runs</div></div><div class="seg" role="group" aria-labelledby="snz-l">${[10, 15, 30].map(m => `<button class="seg-opt" data-act="wrap-snooze-len" data-v="${m}" aria-pressed="${c.snooze === m}">${m} min</button>`).join('')}</div></div>`
    + tog('launchpad', 'Morning launchpad', 'On your first open of a new day: your note, your memo and the first starter task, with a button that starts it on the timer')
    + `<div class="set-row"><div class="set-label">Wrap up now</div><button class="btn btn--secondary" data-act="wrap">${ic('sunset')}Start the wrap-up</button></div>`;
}

/* ---- Dialogs and events (actions.js's switch doesn't know these acts) ---- */
const _renderModalF = renderModal;
renderModal = function () {
  if (wrapOpen()) return wrapModal() + (pillOn() ? vPill() : '');   // the memo's pill sits over the dialog
  if (S.modal === 'launch') return launchModal();
  return _renderModalF();
};
document.getElementById('app').addEventListener('click', e => {
  const t = e.target.closest('[data-act]'); if (!t || e.target.closest('[data-soon]')) return;
  const v = t.dataset.v;
  switch (t.dataset.act) {
    case 'wrap': if (wrapOpen()) closeModal(); else openWrap(false); break;
    case 'launch': openLaunch(false); break;
    case 'launch-go': launchGo(); break;
    case 'wrap-step': wrapStep(+v); break;
    case 'wrap-win': pickWin(v); break;
    case 'wrap-triage': { const i = v.lastIndexOf('|'), key = v.slice(0, i), c = v.slice(i + 1); if (c) S.wrap.triage[key] = c; else delete S.wrap.triage[key];
      S.focus = { sel: c ? `[data-act="wrap-triage"][data-v="${CSS.escape(key + '|')}"]` : `[data-act="wrap-triage"][data-v="${CSS.escape(key + '|roll')}"]` }; renderAll(); break; }
    case 'wrap-starter': if (t.checked) { if (starterCount() < 3) S.wrap.starters.add(v); } else S.wrap.starters.delete(v); S.focus = { sel: `[data-act="wrap-starter"][data-v="${CSS.escape(v)}"]` }; renderAll(); break;
    case 'wrap-typed-remove': S.wrap.typed.splice(+v, 1); S.focus = { sel: '#wrap-starter-input' }; renderAll(); break;
    case 'wrap-starter-add': addStarter(); break;
    case 'wrap-memo': if (S.wrap?.memoRec) memoStop(); else memoStart(); break;
    case 'wrap-memo-remove': memoRemove(); break;
    case 'wrap-snooze': snoozeWrap(); break;
    case 'wrap-finish': finishWrap(); break;
    case 'wrap-cfg': setWrapCfg(v, !WRAP.cfg[v]); status('Setting saved'); renderAll(); break;
    case 'wrap-snooze-len': setWrapCfg('snooze', +v); status('Setting saved'); S.focus = { sel: `[data-act="wrap-snooze-len"][data-v="${v}"]` }; renderAll(); break;
  }
});
document.getElementById('app').addEventListener('input', e => {
  const t = e.target, w = S.wrap; if (!w) return;
  if (t.dataset.act === 'wrap-note') w.note = t.value;
  if (t.dataset.act === 'wrap-starter-draft') w.draft = t.value;
  if (t.dataset.act === 'wrap-win-text') { w.win = t.value; if (w.winRef) { w.winRef = null; app.querySelectorAll('.win-pick[aria-pressed="true"]').forEach(b => { b.setAttribute('aria-pressed', 'false'); b.querySelector('.chip')?.remove(); }); } }
});
document.getElementById('app').addEventListener('change', e => {
  const t = e.target; if (t.dataset.act !== 'wrap-time') return;
  if (WRAP_CFG.time[1](t.value)) { setWrapCfg('time', t.value); status('Wind-down time set to ' + t.value); } else t.value = WRAP.cfg.time;
});
document.getElementById('app').addEventListener('keydown', e => { if (e.target.id === 'wrap-starter-input' && e.key === 'Enter') { e.preventDefault(); addStarter(); } });

// The ?check=1 sweep: a wrap-up on a step, with a busy or an empty day, without the app
function wrapDemo(step, o = {}) {
  memoReset(); S.wrap = { prompted: false, winRef: null, win: '', triage: {}, starters: new Set(), typed: [], draft: '', note: o.note || '', memo: o.memo ? { file: SAMPLE_MEMO, seconds: 10 } : null, memoRec: false, busy: false, wins: sampleWins() };
  if (o.memo) (PLAYER.durs ||= {})[SAMPLE_MEMO] = 10;
  if (o.pick) { const it = winItems(S.wrap.wins)[0]; if (it) { S.wrap.winRef = it.key; S.wrap.win = it.label; } }
  if (o.triage) triageItems().forEach((it, i) => { if (i % 4 !== 3) S.wrap.triage[it.key] = ['roll', 'park', 'done'][i % 4]; });
  if (o.starters) { starterPool().slice(0, 2).forEach(t => S.wrap.starters.add(t.id)); S.wrap.typed.push('Write the intro for the accessibility audit summary, with the numbers from the spreadsheet'); }
  if (o.rec) { Object.assign(S.voice, { stage: 'recording', memo: true, seconds: 4, demo: true, paused: false, words: null }); S.wrap.memoRec = true; }
  return 'wrap' + step;
}
/* ---- end Build F ---- */
