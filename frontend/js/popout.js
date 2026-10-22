/* BUILD H · Sticky notes and the quick timer popped out of the app (mockup R34, locked 2026-10-16), the two minute sets (R39)
   and the check-in interval (R38).
   "oh sticky notes and the quick timer just stay locked within the app. I also think we should do a redesign of both modals"
   Pop out (on every sticky, first in its ⋮ menu, and on the quick timer) makes it its own small frameless window that stays on top
   of other apps (popout.py). That window loads this same page with #pop=sticky:12 or #pop=timer and draws only the card, whose
   head is its strip: Keep on top, Back into NeuroVault, close. NeuroVault shows what's out with a link in the status bar.
   Python sends every change to every window (window.nvSync), so they stay in step. The Paper sticky is in capture.js, the
   Card quick timer in render-widgets.js. */
'use strict';
Object.assign(ICON, {
  popout: '<path d="M21 9V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v10c0 1.1.9 2 2 2h4"/><rect width="10" height="7" x="12" y="13" rx="2"/>',   // Lucide picture-in-picture-2
  popin: '<path d="M2 10h6V4"/><path d="m2 4 6 6"/><path d="M21 10V7a2 2 0 0 0-2-2h-7"/><path d="M3 14v2a2 2 0 0 0 2 2h3"/><rect x="12" y="14" width="10" height="7" rx="1"/>' });   // Lucide picture-in-picture
// This window: NeuroVault's own (POP null), or a popped-out sticky or timer
const POP = (() => { const m = /(?:^|[#&])pop=(?:sticky:(\d+)|(timer)|(ask)|(mindmap))\b/.exec(location.hash);   // Build N (QC 103): the Ask chat's own window; Build M (QC 107): a mind map's
  return m ? (m[1] ? { kind: 'sticky', id: +m[1], key: 'sticky:' + m[1] } : m[3] ? { kind: 'ask', id: null, key: 'ask' } : m[4] ? { kind: 'mindmap', id: null, key: 'mindmap' } : { kind: 'timer', id: null, key: 'timer' }) : null; })();
if (POP) document.body.classList.add('is-pop');
const POPS = { items: [], menu: false, fitH: 0 };   // what's popped out (from api.popped and each sync)
const popKeyOf = key => key === 'qt' ? 'timer' : key.startsWith('st:') ? 'sticky:' + rawId(key.slice(3)) : key;   // the page's widget key → Python's
const isOut = key => POPS.items.some(x => x.key === key);
const timerOut = () => !POP && isOut('timer');
const popItem = key => POPS.items.find(x => x.key === key);
const popOnTop = key => popItem(key)?.on_top !== false;
// Alerts, sounds and the check-in come from the window that shows the timer: a popped-out timer, or else NeuroVault's own
const alertsHere = () => POP ? POP.kind === 'timer' : !isOut('timer');

/* ---- The two minute sets (R39) and the check-in interval (R38), in config.json ---- */
const MIN_DEF = { unplanned: [5, 15, 25, 45], planned: [15, 30, 45, 60] };
Object.assign(TSET_KEYS, { mins_unplanned: 'timer_minutes_unplanned', mins_planned: 'timer_minutes_planned', checkin: 'timer_checkin_minutes', stickyOut: 'sticky_new_popped' });
Object.assign(TSET_DEFAULTS, { mins_unplanned: MIN_DEF.unplanned, mins_planned: MIN_DEF.planned, checkin: 30, stickyOut: true });   // Fix C (QC 5): new stickies open popped out
const timerMins = k => { const v = D.tset?.['mins_' + k]; return Array.isArray(v) && v.length === 4 ? v : MIN_DEF[k]; };
const minsDiffer = () => Object.keys(MIN_DEF).some(k => timerMins(k).join() !== MIN_DEF[k].join());
const checkinSec = () => { const m = D.tset?.checkin; return (m == null ? 30 : +m) * 60; };
const CHECKIN_CHOICES = [[0, 'Off'], [15, '15 min'], [20, '20 min'], [30, '30 min'], [45, '45 min'], [60, '60 min']];

/* ---- Buttons on the cards ---- */
const popOutBtn = key => `<button class="icon-btn icon-btn--sm" data-act="pop-out" data-v="${key}" aria-label="Pop out" title="Pop out: its own small window, on top of other apps">${ic('popout')}</button>`;
// A popped-out window's strip: Keep on top (on or off) and Back into NeuroVault; the close button follows
function popBtns(key) {
  const top = popOnTop(popKeyOf(key));
  return `<button class="icon-btn icon-btn--sm" data-act="pop-top" data-v="${key}" aria-pressed="${top}" aria-label="Keep on top of other apps" title="${top ? 'On top of other apps · click to let other apps cover it' : 'Other apps can cover it · click to keep it on top'}">${ic('pin')}</button>
    <button class="icon-btn icon-btn--sm" data-act="pop-in" data-v="${key}" aria-label="Back into NeuroVault" title="Back into NeuroVault">${ic('popin')}</button>`;
}
const popCloseBtn = (key, label) => `<button class="icon-btn icon-btn--sm" data-act="pop-close" data-v="${key}" aria-label="Close ${label}" title="Close this window (${key === 'qt' ? 'a running timer keeps going' : 'the note stays saved'})">${ic('x')}</button>`;
const popped = key => !!POP && POP.key === popKeyOf(key);

/* ---- In NeuroVault: a link in the status bar, and its list (Show, Bring back) ---- */
const popLabel = it => { if (it.kind === 'ask') return 'Ask: the AI chat'; if (it.kind === 'mindmap') return 'Mind map';   // QC 107
  if (it.kind === 'timer')   // QC 109: the comment above had swallowed this line, so the timer read "Sticky note"
    return 'Quick timer' + (TIMER_ACTIVE.includes(UI.tstate) && D.projects.length ? ' · ' + timeText() : '');
  const s = D.stickies.find(x => rawId(x.id) === it.id); return s ? stickyTitle(s) || 'Sticky #' + s.n : 'Sticky note'; };
const popStatus = () => POP || !POPS.items.length ? '' : `<button class="status-link pop-link" data-act="pop-list" aria-haspopup="dialog" aria-expanded="${POPS.menu}" title="Popped out of NeuroVault: show them or bring them back">${ic('popout')}<span class="num">${POPS.items.length} on your desktop</span></button>`;
function popMenu() {
  if (POP || !POPS.menu || !POPS.items.length) return '';
  return `<div class="menu card pop-menu" role="dialog" aria-label="Popped out of NeuroVault"><div class="pop-menu-head">On your desktop, on top of other apps</div>
    ${POPS.items.map(it => { const k = it.kind === 'timer' ? 'qt' : it.kind === 'ask' || it.kind === 'mindmap' ? it.kind : 'st:st-' + it.id;
      return `<div class="pop-row">${ic(it.kind === 'timer' ? 'timer' : it.kind === 'ask' ? 'chat' : it.kind === 'mindmap' ? 'mindmap' : 'sticky')}<span class="pop-row-label truncate">${esc(popLabel(it))}</span><button class="btn btn--secondary btn--sm" data-act="pop-show" data-v="${k}">Show</button><button class="btn btn--tint btn--sm" data-act="pop-in" data-v="${k}">Bring back</button></div>`; }).join('')}
    <div class="menu-sep"></div><button class="menu-item" data-act="pop-all-in">${ic('popin')}Bring them all back into NeuroVault</button></div>`;
}
// After a render: the list sits just above the link, its right edge on the link's
function placePop() {
  const m = app.querySelector('.pop-menu'), b = app.querySelector('.pop-link'); if (!m || !b) return;
  const L = app.getBoundingClientRect(), z = L.width / app.offsetWidth || 1, r = b.getBoundingClientRect();
  m.style.left = clamp((r.right - L.left) / z - m.offsetWidth, 4, app.offsetWidth - m.offsetWidth - 4) + 'px';
  m.style.top = Math.max(4, (r.top - L.top) / z - m.offsetHeight - 6) + 'px';
}

/* ---- Actions (both windows). Returns true when it handled the click ---- */
/* ==== Build N · QC 109: Show, Bring back and Bring them all back work for every kind of pop-out (feedback: "buttosn dont do
   anything"). What "back in NeuroVault" means, per kind: a sticky shows in the app, the quick timer shows, the Ask chat is docked,
   the mind map is beside its note. A window that wasn't there any more comes back too, and says so. ==== */
const POP_BACK = {
  sticky: key => { const s = stickyById('st-' + key.split(':')[1]); if (s) { s.out = false; s.open = true; } },
  timer: () => { UI.widgets = 'timer'; },
  ask: (key, show) => { if (typeof aicBack === 'function') aicBack(show); },
  mindmap: () => { if (typeof MM !== 'undefined') MM.open = true; } };
const POP_NAME = { timer: 'The quick timer', ask: 'Ask', mindmap: 'The mind map' };
const popKindOf = key => key.startsWith('sticky:') ? 'sticky' : key;
function popBack(key, show = false) { if (POP) return; try { POP_BACK[popKindOf(key)]?.(key, show); } catch (e) { console.warn('popBack', key, e); } }
const popName = key => POP_NAME[popKindOf(key)] || (s => s ? 'Sticky #' + s.n : 'The sticky note')(stickyById('st-' + key.split(':')[1]));
async function popReconcile(key, r) {   // an answer that failed: what's really out, and what isn't any more comes back
  const now = await nv('popped'); if (Array.isArray(now)) POPS.items = now; else if (Array.isArray(r?.popped)) POPS.items = r.popped;
  if (r?.gone || !isOut(key)) { popBack(key, true); toast(`${popName(key)}: its window wasn’t open any more, so it’s back in NeuroVault`); }
  else toast(r?.message || 'That didn’t work');
  D.stickies.forEach(s => { s.out = isOut('sticky:' + rawId(s.id)); }); renderAll();
}
/* ==== end Build N · QC 109 (and below: pop-in, pop-show, pop-all-in and the popped sync use it) ==== */
const popKind = key => key === 'qt' ? ['timer', null] : key === 'ask' || key === 'mindmap' ? [key, null] : ['sticky', rawId(key.slice(3))];   // QC 107: mindmap
function popApply(r) { if (Array.isArray(r?.popped)) { POPS.items = r.popped; D.stickies.forEach(s => { s.out = isOut('sticky:' + rawId(s.id)); }); } }
async function popOut(key) {
  S.stickyMenu = null; POPS.menu = false;
  const [kind, id] = popKind(key), s = kind === 'sticky' ? stickyById(key.slice(3)) : null;
  if (kind === 'sticky' && !s) return;
  if (!api() || (kind === 'sticky' ? !CAPTURE.live : !D.live)) { toast('Popping out works in the desktop app'); return; }
  if (s) await saveStickyText(s);
  const r = await nv('pop_out', kind, id, null, null, s ? s.w || 248 : 312, s ? s.h || 224 : null);
  if (failed(r)) { toast(r.message || "Couldn't pop it out"); return; }
  popApply(r); if (kind === 'timer' && qtOpen()) UI.widgets = 'none';
  status(`${s ? 'Sticky #' + s.n : 'Quick timer'} popped out: its own window, on top of other apps`); renderAll();
}
// actions.js's click handler asks first: true means it's one of these (they run here, some after a call to the app)
const POP_ACTS = ['pop-out', 'pop-in', 'pop-top', 'pop-close', 'pop-show', 'pop-all-in', 'pop-list', 'tset-set', 'min-reset'];
const POP_RELAY = ['sticky-promote', 'sticky-append', 'sticky-attach', 'sticky-task', 'sound'];
function popAct(act, v, t) {
  if (!POP_ACTS.includes(act) && !(POP && POP_RELAY.includes(act))) return false;
  popDo(act, v, t); return true;
}
async function popDo(act, v, t) {
  const [kind, id] = v && act.startsWith('pop-') ? popKind(v) : [];
  switch (act) {
    case 'tset-set': if (!t?.dataset.k) return; setTset(t.dataset.k, +v); status('Setting saved'); S.focus = { sel: `[data-act="tset-set"][data-k="${t.dataset.k}"][data-v="${v}"]` }; renderAll(); return;
    case 'min-reset': minReset(); return;
    case 'pop-out': popOut(v); return;
    case 'pop-in': { POPS.menu = false; const s = kind === 'sticky' ? stickyById(v.slice(3)) : null; if (s) await saveStickyText(s);
      const key = popKeyOf(v), r = await nv('pop_in', kind, id);
      if (failed(r)) { if (!POP) await popReconcile(key, r); else toast(r.message); return; }   // QC 109
      if (!POP) { popApply(r); popBack(key, true); status(kind === 'ask' ? 'Ask is docked in NeuroVault again' : kind === 'mindmap' ? 'The mind map is back beside the note' : `${popName(key)} is back in NeuroVault`); renderAll(); }
      return; }
    case 'pop-top': { const on = !popOnTop(popKeyOf(v)), r = await nv('set_on_top', kind, id, on); if (failed(r)) { toast(r.message); return; }
      popApply(r); S.focus = { sel: '[data-act="pop-top"]' }; toast(on ? 'Keeps on top of other apps' : 'Other apps can cover it now'); return; }
    case 'pop-close': { const s = kind === 'sticky' ? stickyById(v.slice(3)) : null;
      if (s) { await saveStickyText(s); if (!s.text.trim()) {   // an empty sticky has nothing to keep (Phase 6A)
        // Fix C (QC 18): the delete closes this window from Python (forget_sticky). If it fails (already gone) or the window
        // is somehow still here a moment later, pop_close closes it, whether or not the sticky exists
        const r = await nv('delete_sticky', id); if (failed(r)) { nv('pop_close', kind, id); return; }
        setTimeout(() => nv('pop_close', kind, id), 1500); return; } }
      nv('pop_close', kind, id); return; }
    case 'pop-show': { POPS.menu = false; renderAll(); const key = popKeyOf(v), r = await nv('pop_show', kind, id);   // QC 109: it says so when it can't
      if (failed(r)) { await popReconcile(key, r); return; } if (Array.isArray(r?.popped)) popApply(r); status(`${popName(key)}: brought to the front`); return; }
    case 'pop-all-in': { POPS.menu = false; const was = POPS.items.map(x => x.key), r = await nv('pop_all_in');   // what was out, before the syncs clear the list
      if (failed(r)) { const now = await nv('popped'); POPS.items = Array.isArray(now) ? now : POPS.items; was.filter(k => !isOut(k)).forEach(k => popBack(k)); toast(r.message || 'Not everything came back'); renderAll(); return; }
      popApply(r); was.forEach(k => popBack(k)); status('Everything is back in NeuroVault'); renderAll(); return; }   // QC 109: every kind
    case 'pop-list': POPS.menu = !POPS.menu; renderAll(); if (POPS.menu) app.querySelector('.pop-menu button')?.focus(); return;
  }
  // In a popped-out sticky: promote, append, attach and time it run in NeuroVault's window, which has the notes and folders
  if (['sticky-promote', 'sticky-append', 'sticky-attach', 'sticky-task'].includes(act)) {
    const s = stickyById(v); S.stickyMenu = null; if (s) await saveStickyText(s); renderAll();
    const r = await nv('pop_relay', act, rawId(v)); if (failed(r)) toast(r.message); return; }
  // In a popped-out timer, the focus sound plays from NeuroVault's window (one sound, however many windows)
  if (act === 'sound') { S.sound.kind = v === 'off' ? null : v; nv('pop_relay', 'sound', v); renderAll(); return; }
  return;
}
// NeuroVault's window does what a popped-out window asked of it (popout.relay)
window.nvRelay = async (act, v) => {
  if (act === 'sound') { fire('sound', v); return; }
  if (act === 'sound-vol') { S.sound.vol = +v; if (AUDIO.gain) AUDIO.gain.gain.value = S.sound.vol / 250; setSoundscape({ vol: +v }); renderAll(); return; }
  const id = 'st-' + v, list = await nv('list_stickies'), row = Array.isArray(list) && list.find(x => x.id === +v);
  if (row) { const s = stickyById(id); if (s) Object.assign(s, mapSticky(row)); else D.stickies.push(mapSticky(row)); }
  fire(act, id);
};
// A popped-out window, before NeuroVault quits: save what's typed
window.nvFlush = () => flushStickies().then(() => true);

/* ---- Every window hears of every change (popout.py: sync) ---- */
const shownHere = s => POP ? POP.key === 'sticky:' + rawId(s.id) : s.open && !s.out;   // this window is where it's typed
window.nvSync = msg => {
  try {
    if (msg.kind === 'timer') { if (!D.live) return; const was = UI.tstate; syncRunning(msg.session);
      const l = msg.logged; if (l && !D.sessions.some(s => s.id === 's-' + l.id)) D.sessions.unshift(sessionFromApi({ ...l, color: proj('p-' + l.project_id)?.color }));
      if (UI.tstate !== was || l || UI.view === 'timer') renderAll(); else paintTimer(); return; }
    if (msg.kind === 'sticky') { const m = mapSticky(msg.sticky), s = stickyById(m.id);
      if (!s) { D.stickies.push(m); if (!POP) renderAll(); return; }
      if (shownHere(s)) return;
      Object.assign(s, m); if (!POP) renderAll(); return; }
    if (msg.kind === 'sticky-gone') { const s = stickyById('st-' + msg.id); if (s) { forgetSticky(s); renderAll(); } return; }
    if (msg.kind === 'popped') { const was = new Set(POPS.items.map(x => x.key)); POPS.items = msg.items || [];
      // a sticky whose window has gone is back in NeuroVault (Back into NeuroVault), or closed and still saved (its Close)
      if (msg.gone) { const g = stickyById('st-' + msg.gone.split(':')[1]); if (g) forgetSticky(g); }   // Fix C (QC 18): deleted, so it never shows in the app
      D.stickies.forEach(s => { const key = 'sticky:' + rawId(s.id), out = isOut(key); if (msg.back === key) s.open = true; else if (msg.closed === key) s.open = false; s.out = out; });
      if (!POP && msg.back && !msg.back.startsWith('sticky:') && was.has(msg.back)) popBack(msg.back, true);   // QC 109: back, each kind its own way
      if (!POP && msg.closed && ['ask', 'mindmap'].includes(msg.closed) && was.has(msg.closed)) popBack(msg.closed);   // the chat or the map's window closed: back where it was
      if (!POPS.items.length) POPS.menu = false;
      renderAll(); return; }
    if (msg.kind === 'ask') { aicSyncIn(msg.data); return; }   // QC 103: the Ask chat, from the other window
    if (msg.kind === 'settings' && POP) popSettings();
  } catch (e) { console.warn('nvSync', e); }
};
async function popSettings() {   // NeuroVault's window changed a setting: the theme, the minute sets…
  await loadReader(); const r = await nv('get_settings'); if (!failed(r) && r && typeof r === 'object') { D.tset = { ...tsetFromConfig(r), db: D.tset.db }; S.sound.kind = r.comfort_soundscape && r.comfort_soundscape !== 'off' ? r.comfort_soundscape : null; }
  renderAll();
}

/* ---- A popped-out window: only its card, filling the window ---- */
function renderPop() {
  const ae = document.activeElement, keep = !S.focus && ae && app.contains(ae) ? (ae.id ? { sel: '#' + CSS.escape(ae.id), pos: ae.selectionStart } : ae.dataset?.act ? { sel: `[data-act="${ae.dataset.act}"]${ae.dataset.v ? `[data-v="${CSS.escape(ae.dataset.v)}"]` : ''}` } : null) : null;
  let card;
  if (POP.kind === 'sticky') { const s = D.stickies.find(x => rawId(x.id) === POP.id);
    card = s ? stickyCard(s) : `<div class="pop-gone">${ic('sticky')}<span>This sticky note isn't here any more: it became a note or a task, or it was deleted.</span></div>`;
    document.title = s ? `NeuroVault · ${stickyTitle(s) || 'Sticky #' + s.n}` : 'NeuroVault'; }
  else if (POP.kind === 'ask') { card = aicPopCard(); document.title = 'Ask · NeuroVault'; }   // QC 103; QC 111: its own taskbar button reads Ask first
  else if (POP.kind === 'mindmap') { card = mmPopCard(); document.title = 'NeuroVault · Mind map' + (MM.popNote ? ' · ' + (MM.popNote.title || 'Untitled note') : ''); }   // Build M (QC 107)
  else { card = quickTimer(); document.title = 'NeuroVault · Quick timer'; }
  app.innerHTML = card + (S.toast ? `<div class="toast card" role="status">${ic('ok')}${esc(S.toast)}</div>` : '');
  applyComfort();
  const fo = S.focus || keep;
  if (fo) { const el = app.querySelector(fo.sel); if (el) { el.focus({ preventScroll: true }); if (fo.pos != null && el.setSelectionRange) el.setSelectionRange(fo.pos, fo.pos); } S.focus = null; }
  if (POP.kind === 'timer') requestAnimationFrame(popFit);
  if (POP.kind === 'ask') aicAfterWin();
  if (POP.kind === 'mindmap') mmFit();   // Build M (QC 107): its zoom and place, as beside the note
}
// The timer's window takes the height of what it shows (its questions open inside it)
function popFit() {
  const w = app.querySelector('.widget.qt'); if (!w || !api()) return;
  const h = Math.ceil(w.getBoundingClientRect().height);
  if (h && Math.abs(h - POPS.fitH) > 1) { POPS.fitH = h; api().pop_fit('timer', null, 312, h)?.catch?.(() => {}); }
}
// Only what the card needs: the reader settings (theme, accent, font), the stickies, and for the timer its projects, tasks and running session
async function popLoad() {
  D = sample('empty'); D.tset = { ...TSET_DEFAULTS }; UI.widgets = 'timer'; UI.zen = 'off';
  await loadReader();
  if (POP.kind === 'ask') return aicPopLoad();   // QC 103: the chat gets the rest from NeuroVault's window
  if (POP.kind === 'mindmap') return mmPopLoad();   // QC 107: the note comes from NeuroVault's window
  if (!api()) return;
  await loadCapture();
  if (POP.kind !== 'timer') return;
  try {
    const [ps, cfg, run, tasks] = await within(Promise.all([api().list_projects(), api().get_settings(), api().get_running_session(), api().list_tasks()]), 8000);
    D.projects = (ps || []).map(projFromApi); D.tset = tsetFromConfig(cfg || {}); D.tasks = (tasks || []).map(mapTask); D.live = true;
    S.sound.kind = cfg?.comfort_soundscape && cfg.comfort_soundscape !== 'off' ? cfg.comfort_soundscape : null;
    if (!run) T.projectId = null; syncRunning(run);
  } catch (e) { console.warn('Timer data not loaded', e); }
}
async function popStart() {
  for (let i = 0; i < 80 && !api(); i++) await new Promise(r => setTimeout(r, 100));   // the bridge can come late; this page is nothing without it
  await popLoad();
  const r = await nv('popped'); if (Array.isArray(r)) POPS.items = r;
  renderAll();
  if (POP.kind === 'timer') { if (!D.live) { UI.tstate = 'idle'; renderAll(); } setInterval(timerTick, 1000); }
}
if (POP) {
  // The strip moves the window, and the corner grip sizes it: Windows does it (popout.drag → winframe.start_drag)
  document.addEventListener('pointerdown', e => {
    if (e.button !== 0) return;
    const grip = e.target.closest?.('.st-grip'), head = !grip && e.target.closest?.('[data-drag-widget]');
    if (!grip && !(head && !e.target.closest('button, input, select, textarea'))) return;
    e.preventDefault(); e.stopPropagation();
    api()?.pop_drag(POP.kind, POP.id, grip ? 'se' : 'caption')?.catch?.(() => {});
  }, true);
  // The main window's shortcuts (tabs, search, zen, brain dump, nudging a card) have no place in a popped-out window
  window.addEventListener('keydown', e => {
    const k = e.key.toLowerCase(), ctrl = e.ctrlKey || e.metaKey;
    if (e.key === 'F11' || (ctrl && !e.altKey && ['k', 't', 'w', 'n'].includes(k)) || (ctrl && e.shiftKey && k === 'd') || (e.altKey && e.key.startsWith('Arrow'))) { e.preventDefault(); e.stopImmediatePropagation(); }
  }, true);
  // The focus sound's volume plays from NeuroVault's window too
  window.addEventListener('change', e => { if (e.target.dataset?.act === 'sound-vol') { e.stopImmediatePropagation(); nv('pop_relay', 'sound-vol', +e.target.value); } }, true);
}
// NeuroVault's window: what's popped out, once the bridge is there
async function popBoot() { if (POP || !api()) return; const r = await nv('popped'); if (Array.isArray(r)) { POPS.items = r; D.stickies.forEach(s => { s.out = isOut('sticky:' + rawId(s.id)); }); renderAll(); } }
// The list closes on Esc or a click anywhere else
document.addEventListener('click', e => {
  if (!POPS.menu || e.target.closest('.pop-menu') || e.target.closest('[data-act="pop-list"]')) return;
  POPS.menu = false; if (!e.target.closest('[data-act]')) { e.stopPropagation(); renderAll(); }
}, true);
document.addEventListener('keydown', e => { if (e.key === 'Escape' && POPS.menu) { POPS.menu = false; e.stopPropagation(); S.focus = { sel: '.pop-link' }; renderAll(); } }, true);

/* ---- Settings → Timer alerts: Timer minutes (R39), Check-ins (R38) and the alerts, as cards like Reading & comfort ---- */
function minsCard() {
  const row = (k, label, desc) => cfRow(`min-${k}`, label, desc, `<div class="min-set" role="group" aria-labelledby="min-${k}">${timerMins(k).map((m, i) => `<input class="field min-field" type="number" inputmode="numeric" min="1" max="240" step="1" value="${m}" data-act="min-set" data-k="${k}" data-i="${i}" aria-label="${label}, choice ${i + 1}, in minutes"${S.minErr?.k === k && S.minErr.i === i ? ' aria-invalid="true"' : ''}>`).join('')}<span class="set-desc">min</span></div>`, ' cf-row--seg')
    + (S.minErr?.k === k ? `<div class="field-error min-err" role="alert">${S.minErr.msg}</div>` : '');
  return cfCard('mins', 'Timer minutes', `Unplanned ${timerMins('unplanned').join(' / ')} · Planned ${timerMins('planned').join(' / ')}`,
    `<div>${row('unplanned', 'Unplanned work', 'The quick timer’s four choices, for a burst you didn’t plan')}${row('planned', 'Planned work', 'The Timer view’s four choices, for a session you planned')}</div>`
    + `<div class="min-foot">${minsDiffer() ? `<button class="link-btn" data-act="min-reset">${ic('restore')}Back to the defaults</button><span class="set-desc">Unplanned ${MIN_DEF.unplanned.join(' / ')} · Planned ${MIN_DEF.planned.join(' / ')}</span>` : '<span class="set-desc">These are the defaults. Change any number; the list sorts itself.</span>'}</div>`);
}
const checkinCard = () => { const cur = D.tset.checkin ?? 30;
  return cfCard('checkin', 'Check-ins', cur ? `Every ${cur} minutes` : 'Off', `<div>${cfSeg('ck-every', 'Ask what I just finished', 'While a timer runs, a short question every so often. Its answer is kept with the session', CHECKIN_CHOICES, 'tset-set', 'checkin', cur)}</div>`); };
const alertTog = (k, l, d) => cfRow(`set-${k}`, l, d, `<button class="toggle" role="switch" aria-checked="${!!D.tset[k]}" aria-labelledby="set-${k}" data-act="toggle" data-v="${k}"></button>`);
const alertsCards = () => `<div class="cf cf-cards"><div class="cf-main">${minsCard()}${checkinCard()}${awayCard()}${cfCard('alerts', 'Alerts', '', `<div>${alertTog('five_min', '5-minute warning', 'A cue when a planned session has 5 minutes left') + alertTog('sound', 'Sound when time is up', 'Plays when the timer reaches zero') + alertTog('desktop', 'Desktop notification', 'Depends on Windows notification settings') + alertTog('taskbar', 'Flash the taskbar icon', 'Windows only') + alertTog('overtime_repeat', 'Remind me during overtime', `Every ${D.tset.interval} minutes until you stop`)}</div>`)}</div></div>`;
const stickyOutRow = () => `<div class="set-row"><div><div class="set-label" id="set-stickyOut">Open new stickies popped out</div><div class="set-desc">Each new sticky note opens as its own small window, on top of other apps</div></div><button class="toggle" role="switch" aria-checked="${!!D.tset.stickyOut}" aria-labelledby="set-stickyOut" data-act="toggle" data-v="stickyOut"></button></div>`;
const _settingsPaneH = settingsPane;
settingsPane = function (sec) {
  if (sec === 'alerts') return alertsCards();
  return _settingsPaneH(sec) + (sec === 'focus' && S.modal === 'settings' ? stickyOutRow() : '');   // not in the guided setup's focus step
};
const _settingsModalH = settingsModal;
settingsModal = function () {   // the cards stand on the pane, as on Reading & comfort
  const html = _settingsModalH();
  if (S.setSec !== 'alerts') return html;
  const at = html.indexOf('<div class="card card-pad"><div class="cf cf-cards">'); if (at < 0) return html;
  const end = html.lastIndexOf('</div></div></div></div></div>');
  return html.slice(0, at) + html.slice(at + '<div class="card card-pad">'.length, end) + '</div></div></div></div>';
};
function minSet(t) {
  const k = t.dataset.k, i = +t.dataset.i, v = +t.value; S.focus = { sel: `[data-act="min-set"][data-k="${k}"][data-i="${i}"]` };
  if (!t.value.trim() || !Number.isInteger(v) || v < 1 || v > 240) { S.minErr = { k, i, msg: 'Use a whole number of minutes, from 1 to 240' }; renderAll(); return; }
  const arr = [...timerMins(k)]; arr[i] = v; arr.sort((a, b) => a - b); S.minErr = null; setTset('mins_' + k, arr);
  status(`${k === 'planned' ? 'Planned' : 'Unplanned'} minutes: ${arr.join(' / ')}`); renderAll();
}
function minReset() { setTset('mins_unplanned', [...MIN_DEF.unplanned]); setTset('mins_planned', [...MIN_DEF.planned]); S.minErr = null; S.focus = { sel: '[data-act="min-set"][data-k="unplanned"][data-i="0"]' }; status('Timer minutes are back to the defaults'); renderAll(); }
document.addEventListener('change', e => { if (e.target.dataset?.act === 'min-set') minSet(e.target); });
/* ===== end Build H ===== */
