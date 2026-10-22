/* Floating widgets (quick timer, hyperfocus nudge, zen pill), Ctrl+K, focus sounds and panels placed after a render.
   Extracted from design/vault-notes-mockups.html (R20). Sticky notes are in capture.js (Phase 6A); pinning a widget to the desktop comes later. */
'use strict';
/* ---- Floating widgets: quick timer and hyperfocus nudge, in one layer above every tab ---- */
const qtOpen = () => UI.widgets === 'timer' || UI.widgets === 'nudge';
function widgetPos(w, h) {
  const W = app.offsetWidth || 1600, H = app.offsetHeight || 900, p = S.qt;
  let x = p?.x, y = p?.y;
  if (x == null) { x = W - w - (UI.view === 'notes' && UI.inspector !== 'hidden' ? 292 : 32); y = 96; }
  return { x: clamp(x, 4, W - w - 4), y: clamp(y, 4, Math.max(4, H - h - 8)) };
}
function linkOptions() {
  const tasks = D.tasks.filter(t => !t.done).slice(0, 12), st = D.stickies;   // Phase 6A: sticky notes too, as the mockup has them
  return `<option value="">Nothing linked</option>${tasks.length ? `<optgroup label="Tasks">${tasks.map(t => `<option value="task:${t.id}" ${T.link === 'task:' + t.id ? 'selected' : ''}>${esc(t.title.slice(0, 48))}</option>`).join('')}</optgroup>` : ''}${st.length ? `<optgroup label="Sticky notes">${st.map(s => `<option value="sticky:${s.id}" ${T.link === 'sticky:' + s.id ? 'selected' : ''}>Sticky #${s.n} · ${esc((s.text || 'Empty').slice(0, 36))}</option>`).join('')}</optgroup>` : ''}`;
}
const qtBand = () => { const left = T.mode === 'planned' ? Math.max(0, 1 - T.elapsed / T.target) : 1; return { left, band: left > .5 ? 'calm' : left > .2 ? 'warm' : 'low' }; };
/* Build H (R34, locked: Card): a big time and two buttons, with its questions inside: Pause shows the 8 reasons, the check-in
   has its own field, and Stop asks for the 1–5 ratings. Working on and the focus sound sit under a line. Pop out is on its head;
   popped out (its own window, popout.js), the head is the window's strip: Keep on top, Back into NeuroVault, close. */
function qtPanel() {
  const st = UI.tstate, p = proj(T.projectId) || D.projects[0];
  if (st === 'pausepick') return `<div class="qt-panel" role="group" aria-labelledby="qtp-q"><div class="qt-panel-title" id="qtp-q">Why the pause?</div>
    <div class="qt-reasons">${PAUSE_REASONS.map(r => `<button class="pick" data-act="treason" data-v="${r}" aria-pressed="false">${r}</button>`).join('')}</div>
    <button class="btn btn--secondary btn--block" data-act="tcancel-pause">${ic('play')}Keep going</button></div>`;
  if (st === 'checkin') return `<div class="qt-panel" role="group" aria-labelledby="qtc-q"><div class="qt-panel-title" id="qtc-q">${fmtDur(T.elapsed)} in. What did you just finish?</div>
    <input class="field" id="qt-milestone" placeholder="e.g. Drafted the overview" aria-labelledby="qtc-q">
    <div class="qt-two"><button class="btn btn--secondary" data-act="tcheckin" data-v="skip">Skip</button><button class="btn btn--primary" data-act="tcheckin" data-v="save">${ic('save')}Save</button></div></div>`;
  if (st === 'rate') { const busy = UI.state === 'saving' || T.busy, err = UI.state === 'error' || !!T.err;
    return `<div class="qt-panel" role="group" aria-labelledby="qtr-q"><div class="qt-panel-title" id="qtr-q">How did it go?</div><div class="qt-mini"><span class="truncate">${esc(p?.name || '')}</span><span class="num">${fmtDur(T.elapsed)}</span></div>
    ${err ? `<div class="alert alert--danger" role="alert">${ic('alert')}<span>Couldn't log this session. Nothing is lost: it stays here until it saves.</span></div>` : ''}
    ${rateRow('energy', 'Energy', 'Drained', 'Energised')}${rateRow('focus', 'Focus', 'Distracted', 'Locked in')}
    <div class="qt-two"><button class="btn btn--secondary" data-act="tlog" data-v="skip" ${busy ? 'disabled' : ''}>Skip rating</button><button class="btn btn--primary" data-act="tlog" data-v="rate" ${busy ? 'disabled' : ''}>${busy ? '<span class="spinner"></span>Logging…' : ic('save') + (err ? 'Retry' : 'Log session')}</button></div></div>`; }
  return '';
}
function quickTimer() {
  const out = popped('qt'), pos = widgetPos(312, 300), has = D.projects.length, st = UI.tstate, running = TIMER_ACTIVE.includes(st) && has, paused = st === 'paused', p = proj(T.projectId), sfx = out ? 'd' : 'a';
  const panel = has ? qtPanel() : '', { left, band } = qtBand();
  const sub = paused ? `Paused · ${esc(T.pauseReason || 'Quick pause')} · <span class="num" data-tick="pause">${fmtClock(T.pauseElapsed)}</span>` : st === 'pausepick' ? 'Paused · pick a reason' : T.mode === 'planned' ? (isOver() ? 'Over time · stop when ready' : 'left of ' + fmtClock(T.target)) : 'Counting up · no target';
  const ctrls = paused ? `<button class="btn btn--primary" data-act="tresume">${ic('play')}Resume</button><button class="btn btn--secondary" data-act="tstop">${ic('stop')}Stop &amp; log</button>`
    : `<button class="btn btn--secondary" data-act="tpause">${ic('pause')}Pause</button><button class="btn btn--primary" data-act="tstop">${ic('stop')}Stop &amp; log</button>`;
  const bar = `<div class="qt-bar${paused || st === 'pausepick' ? ' is-paused' : ''}" data-band="${band}" data-tick="qtbar" role="img" aria-label="Time left"><span style="width:${(left * 100).toFixed(1)}%"></span></div>`;
  const idle = has ? `<div class="seg seg--fill" role="group" aria-label="Minutes">${timerMins('unplanned').map(m => `<button class="seg-opt" data-act="qt-dur" data-v="${m}" aria-pressed="${S.qtDur === m}">${m} min</button>`).join('')}</div>
      <button class="btn btn--primary btn--block" data-act="qt-start">${ic('play')}Start ${S.qtDur} minutes</button>`
    : `<div class="qt-empty">Add a project in Timer → Projects, then start here.</div><button class="btn btn--primary btn--block" disabled>${ic('play')}Start ${S.qtDur} minutes</button>`;
  const more = `<div class="qt-row"><span class="qt-label" id="qt-link-${sfx}">Working on</span><select class="field" data-act="qt-link" aria-labelledby="qt-link-${sfx}">${linkOptions()}</select></div>
    <div class="qt-row"><span class="qt-label" id="qt-snd-${sfx}">Sound</span><div class="seg seg--fill" role="group" aria-labelledby="qt-snd-${sfx}">${[['off', 'Off'], ['brown', 'Brown'], ['pink', 'Pink'], ['rain', 'Rain']].map(([k, l]) => `<button class="seg-opt" data-act="sound" data-v="${k}" aria-pressed="${(S.sound.kind || 'off') === k}">${l}</button>`).join('')}</div></div>
    ${S.sound.kind ? `<div class="qt-row"><span class="qt-label" id="qt-vol-${sfx}">Volume</span><input class="range" type="range" min="0" max="100" value="${S.sound.vol}" data-act="sound-vol" aria-labelledby="qt-vol-${sfx}"></div>` : ''}`;
  const name = `Quick timer${running && p ? ' · ' + p.name : ''}`;
  const btns = out ? popBtns('qt') + popCloseBtn('qt', 'quick timer') : popOutBtn('qt') + `<button class="icon-btn icon-btn--sm" data-act="qt-close" aria-label="Close quick timer" title="Close (a running timer keeps going)">${ic('x')}</button>`;
  const mini = running ? `<div class="qt-mini"><span class="truncate">${sub}</span><span class="num" data-tick="time">${timeText()}</span></div>` : '';
  let main;
  if (!has || (!running && st !== 'rate')) main = idle;
  else if (panel) main = (st === 'rate' ? '' : mini) + panel;
  else main = `<div class="qt-time" data-tick="time" role="timer" aria-live="off">${timeText()}</div><div class="qt-sub">${sub}</div>${bar}<div class="qt-two">${ctrls}</div>`;
  return `<section class="widget qt qt--r34 qt--card${out ? ' is-popped' : ''}" style="${out ? '' : `left:${pos.x}px;top:${pos.y}px;`}width:${out ? '100%' : '312px'}" aria-label="Quick timer" data-widget="qt">
    <div class="widget-head" data-drag-widget="qt"><span class="widget-grip" aria-hidden="true">${ic('grip')}</span><span class="widget-title">${esc(name)}</span>${btns}</div>
    <div class="widget-body">${main}<div class="qt-more">${more}</div></div></section>`;
}
const nudgeCard = () => `<div class="card nudge" role="status" aria-live="polite">${ic('coffee')}<div><div class="nudge-text">You've been locked in for an hour—time to blink, drop your shoulders, and grab water?</div>
  <div class="timer-controls"><button class="btn btn--primary btn--sm" data-act="nudge" data-v="done">Done, thanks</button><button class="btn btn--ghost btn--sm" data-act="nudge" data-v="snooze">Remind me in 15 min</button></div></div></div>`;
function renderOverlay() {
  let h = '';
  if (qtOpen() && !timerOut()) h += quickTimer();   // Build H: a popped-out timer is in its own window
  h += stickyLayer();   // Phase 6A: open sticky notes stay on this layer whichever tab is showing
  if (UI.widgets === 'nudge') h += nudgeCard();
  h += popMenu();   // Build H: the status bar link's list of what's popped out
  const zen = UI.zen === 'on' ? `<span class="chip chip--timer zen-pill">${TIMER_ACTIVE.includes(UI.tstate) && D.projects.length ? `<span class="status-dot${isPaused() ? ' is-busy' : ''}"></span><span class="num" data-tick="time">${timeText()}</span>` : 'Zen mode · F11 to leave'}</span>` : '';
  return `<div class="overlay-layer">${h}${zen}</div>`;
}
// R10: until you drag it somewhere else, the quick timer opens centred under its window-bar button
function anchorQt() {
  const w = app.querySelector('.widget.qt'), btn = app.querySelector('.titlebar [data-act="qt-toggle"]');
  if (!w || !btn || S.qt) return;
  const layer = w.offsetParent || app, L = layer.getBoundingClientRect(), b = btn.getBoundingClientRect(), z = L.width / layer.offsetWidth || 1;
  w.style.left = clamp((b.left + b.width / 2 - L.left) / z - w.offsetWidth / 2, 4, layer.offsetWidth - w.offsetWidth - 4) + 'px';
  w.style.top = (b.bottom - L.top) / z + 6 + 'px';
}
function saveWidget(key, x, y) { if (key === 'qt') S.qt = { x, y }; else if (key.startsWith('st:')) stickyMoved(key.slice(3), x, y); }   // Phase 6A: a sticky's place is saved

/* ---- Ctrl+K: notes, tasks and files; shortcut tutor; commands; settings. Not-yet-built entries show, dimmed, as Coming soon ---- */
const PAL_SHORTCUTS = [['Bold', ['Ctrl', 'B'], 'fmt', 'bold'], ['Italic', ['Ctrl', 'I'], 'fmt', 'italic'], ['Zen mode', ['F11'], 'zen'], ['Search and commands', ['Ctrl', 'K'], 'palette'], ['Brain Dump', ['Ctrl', 'Shift', 'D'], 'dump'],
  ['New note', ['Ctrl', 'N'], 'tree-new-note'], ['Save', ['Ctrl', 'S'], 'save'], ['New tab', ['Ctrl', 'T'], 'tab-new'], ['Close tab', ['Ctrl', 'W'], 'tab-close-current'], ['Reading ruler', ['Ctrl', 'Alt', 'R'], 'ruler'],
  ['Pause or resume the timer', ['Ctrl', 'Alt', 'P'], 'tpause-toggle'], ['Stop and log the timer', ['Ctrl', 'Alt', 'S'], 'tstop']];
const PAL_COMMANDS = [['Pop out the quick timer', 'popout', 'pop-out', 'qt'], ['Convert PDF to Markdown', 'filepdf', 'pdfin', null, 'PDF to Markdown'], ['Wrap up day', 'sunset', 'wrap', null, 'Wrap-up'], ['Start quick timer', 'timer', 'qt-open'], ['New sticky note', 'sticky', 'sticky-new'],
  ['Voice ramble', 'mic', 'voice'], ['Read aloud', 'volume', 'read'], ['Export to PDF', 'download', 'pdfout', null, 'PDF export'], ['Version history', 'route', 'history'], ['Toggle bionic reading', 'type', 'a11y-toggle', 'bionic'],
  ['Open morning launchpad', 'rocket', 'launch', null, 'Morning launchpad'], ['Open settings', 'gear', 'settings']];
const PAL_SETTINGS = [['Download and run AI models on this PC', 'ai'], ['Choose a model for each AI job', 'ai'], ['Theme, font and spacing', 'appearance'], ['Hyperfocus nudge interval', 'focus'], ['Wind-down time', 'wrapup'],
  ['Show HTML extensions in the toolbar', 'editor'], ['Vault folder and versions kept', 'vault'], ['Speech and read-aloud voices', 'voice']];
const fuzzy = (s, q) => { if (s.includes(q)) return true; if (q.length < 2) return false; let i = 0; for (const ch of s) if (ch === q[i]) i++; return i === q.length; };
function palResults() {
  const q0 = S.pal.q.trim(), cmdOnly = q0.startsWith('>'), q = (cmdOnly ? q0.slice(1) : q0).trim().toLowerCase(), m = s => !q || fuzzy(s.toLowerCase(), q);
  const g = [];
  if (!cmdOnly) {
    const notes = q ? palNotes(q, m) : S.tabs.filter(t => t.kind === 'note' && t.ref).map(t => D.notes.find(n => n.id === t.ref)).filter(Boolean).slice(0, 5)   // Build I: palNotes, the text too
      .map(n => ({ icon: 'file', label: n.title, sub: folderPath(n.folder).join(' / '), run: ['note', n.id] }));
    const files = D.files.filter(f => m(f.name)).slice(0, 2).map(f => ({ icon: f.kind === 'pdf' ? 'filepdf' : 'filecode', label: f.name, sub: folderPath(f.folder).join(' / '), soon: f.kind === 'pdf' ? 'PDF to Markdown' : 'HTML studio' }));
    const tasks = q ? D.tasks.filter(t => !t.done && m(t.title)).slice(0, 3).map(t => ({ icon: 'tasks', label: t.title, sub: 'Task' + ((x => x ? ' · ' + x : '')(D.notes.find(n => n.id === t.noteId)?.title)), run: t.noteId ? ['note', t.noteId] : ['view', 'tasks'] })) : [];
    if (notes.length + files.length + tasks.length) g.push([q ? 'Notes, files and tasks' : 'Open notes', [...notes, ...files, ...tasks]]);
    const sc = PAL_SHORTCUTS.filter(x => m(x[0])).slice(0, q ? 6 : 4).map(x => ({ icon: 'key', label: x[0], sub: 'Runs it and shows the shortcut', keys: x[1], run: [x[2], x[3]], teach: x[1], soon: x[4] }));
    if (sc.length) g.push(['Shortcuts', sc]);
  }
  const cm = PAL_COMMANDS.filter(x => m(x[0])).slice(0, q || cmdOnly ? 12 : 5).map(x => ({ icon: x[1], label: '> ' + x[0], run: [x[2], x[3]], soon: x[4] }));
  if (cm.length) g.push(['Commands', cm]);
  const st = PAL_SETTINGS.filter(x => m(x[0])).slice(0, q || cmdOnly ? 8 : 2).map(x => ({ icon: 'gear', label: '> ' + x[0], sub: 'Settings · ' + SET_SECTIONS.find(s => s[0] === x[1])[1], run: ['set-open', x[1]], soon: SET_SOON[x[1]] }));
  if (st.length) g.push(['Settings', st]);
  return g;
}
/* ---- Build I (the R38 answer "Yes, the text too"): Ctrl+K finds notes by the words inside them. A note whose title matches
        comes first, as before; a note that matches only in its text shows the matching line as its sub-text, and Enter opens it
        at the match (selected, in the middle of the page). On a real vault the text comes from api.search_notes (asked 120 ms
        after the last key); notes with unsaved edits, and the sample vault, are searched here ---- */
const PALS = { q: null, hits: null, seq: 0, t: 0 };
const palPlain = l => unescMd(l.replace(/^\s*(#{1,6}\s+|>\s*|[-*+]\s+\[[ xX]\]\s+|[-*+]\s+|\d+[.)]\s+)/, '').replace(/\[\[(?:[^\]|]*\|)?([^\]]*)\]\]/g, '$1').replace(/\*\*|__|`/g, '')).trim();
function palTextLine(md, q) {   // the first line holding q (not the {{tasks}} line), as plain words, with the match kept in view
  for (const raw of String(md || '').split('\n')) {
    if (raw.trim() === '{{tasks}}' || !raw.toLowerCase().includes(q)) continue;
    const l = palPlain(raw), at = l.toLowerCase().indexOf(q);
    return at > 60 ? '…' + l.slice(at - 40) : l || raw.trim();
  }
  return null;
}
function palAsk(q) {
  PALS.q = q; PALS.hits = null; clearTimeout(PALS.t); if (q.length < 2) return;
  const seq = ++PALS.seq;
  PALS.t = setTimeout(async () => {
    const r = await nv('search_notes', q, 20); if (seq !== PALS.seq || !Array.isArray(r)) return;
    PALS.hits = r;
    const inp = app.querySelector('#palette-input');
    if (S.modal === 'palette' && inp && S.pal.q.trim().toLowerCase() === q) { S.focus = { sel: '#palette-input', pos: inp.selectionStart }; renderAll(); }
  }, 120);
}
function palNotes(q, m) {
  if (VAULT.live && PALS.q !== q) palAsk(q);
  const fromDb = VAULT.live && PALS.q === q && PALS.hits, text = new Map();
  if (fromDb) PALS.hits.forEach(h => { if (h.line != null) text.set('n-' + h.note_id, palPlain(h.line) || h.line); });
  if (q.length >= 2) D.notes.forEach(n => { if (fromDb && !n.dirty && !n.docDirty) return; const l = n.md.toLowerCase().includes(q) ? palTextLine(n.md, q) : null; if (l) text.set(n.id, l); else text.delete(n.id); });
  const byTitle = D.notes.filter(n => m(n.title)).slice(0, 5), inText = D.notes.filter(n => !byTitle.includes(n) && text.has(n.id)).slice(0, 8 - byTitle.length);
  return [...byTitle.map(n => ({ icon: 'file', label: n.title, sub: folderPath(n.folder).join(' / '), run: ['note', n.id] })),
    ...inText.map(n => ({ icon: 'file', label: n.title, sub: text.get(n.id), run: ['note-at', n.id + '|' + q] }))];
}
// Open a note at the first place its text holds q: the words selected, scrolled to the middle of the page
function openNoteAt(id, q) {
  openNote(id);
  const doc = app.querySelector(`.doc[data-note="${CSS.escape(id)}"]`); if (!doc || !q) return;
  const walk = document.createTreeWalker(doc, NodeFilter.SHOW_TEXT, { acceptNode: t => t.parentElement.closest('[data-md="frontmatter"], .props') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT });
  let r = null;
  while (walk.nextNode()) { const t = walk.currentNode, at = t.data.toLowerCase().indexOf(q); if (at >= 0) { r = document.createRange(); r.setStart(t, at); r.setEnd(t, at + q.length); break; } }
  const block = r ? r.startContainer.parentElement : [...doc.querySelectorAll('p, li, h1, h2, h3, h4, h5, h6, td, blockquote, pre')].find(b => b.textContent.toLowerCase().includes(q));
  if (!block) return;
  if (r) { if (doc.isContentEditable) doc.focus({ preventScroll: true }); const sel = getSelection(); sel.removeAllRanges(); sel.addRange(r); }
  block.scrollIntoView({ block: 'center' });
}
document.getElementById('app').addEventListener('click', e => { const b = e.target.closest?.('[data-act="note-at"]'); if (!b) return; const v = b.dataset.v, i = v.indexOf('|'); openNoteAt(v.slice(0, i), v.slice(i + 1)); });
function paletteModal() {
  const groups = palResults(); S.pal.flat = groups.flatMap(x => x[1]); if (S.pal.ix >= S.pal.flat.length) S.pal.ix = 0;
  let k = 0;
  return `<div class="modal-backdrop modal-backdrop--top" data-act="close-bg"><div class="modal modal--picker card" data-dlg="palette" data-size="md" role="dialog" aria-modal="true" aria-label="Search and commands">
    <input class="picker-input" id="palette-input" data-act="pal-q" placeholder="Search notes, tasks and shortcuts · type > for commands" value="${esc(S.pal.q)}" role="combobox" aria-expanded="true" aria-controls="pal-list" aria-activedescendant="pal-${S.pal.ix}" aria-label="Search and commands" autocomplete="off">
    <div class="picker-list" id="pal-list" role="listbox" aria-label="Results">${groups.map(([title, items]) => `<div class="eyebrow pal-group" role="presentation">${title}</div>` + items.map(it => { const i = k++, sub = it.soon ? 'Coming soon' : it.sub;
      return `<div class="list-item pal-item" role="option" id="pal-${i}" aria-selected="${i === S.pal.ix}" data-act="pal-run" data-v="${i}"${it.soon ? ' ' + soon(it.soon) : ''}>${ic(it.icon)}<span class="list-item-main"><span class="list-item-title truncate">${esc(it.label)}</span>${sub ? `<span class="list-item-sub truncate">${esc(sub)}</span>` : ''}</span>${it.keys ? `<span class="pal-keys">${it.keys.map(x => `<span class="kbd">${x}</span>`).join('')}</span>` : ''}</div>`; }).join('')).join('')
      || `<div class="empty empty--compact"><div class="empty-text">Nothing matches "${esc(S.pal.q)}".</div></div>`}</div>
    <div class="pal-foot"><span><span class="kbd">↑</span> <span class="kbd">↓</span> move</span><span><span class="kbd">Enter</span> run</span><span><span class="kbd">&gt;</span> commands only</span><span><span class="kbd">Esc</span> close</span><span>Searches on this PC, no AI model needed</span></div></div></div>`;
}
function runPalette(i) {
  const it = S.pal.flat?.[i]; if (!it || it.soon) return;
  closeModal(true); fire(it.run[0], it.run[1]);
  if (it.teach) { S.toast = null; setTimeout(() => toast(`Tip: ${it.teach.join(' + ')} does this any time`), 60); }
}
// Runs an action through the same click handler the buttons use
function fire(act, v) { const b = document.createElement('button'); b.dataset.act = act; if (v != null) b.dataset.v = v; b.hidden = true; app.appendChild(b); b.click(); b.remove(); }
function openPalette() {
  if (S.modal === 'palette') { closeModal(); return; }
  S.menu = false; S.edPop = null; S.pal = { q: '', ix: 0 }; S.focus = { sel: '#palette-input' }; S.modal = 'palette'; renderAll();
}
function closeModal(quiet) {
  if (S.modal === 'voicerec' || S.modal === 'voice') voiceClosed();   // Phase 6B: closing the voice dialog throws the recording away
  if (S.modal === 'read') stopReading();   // Phase 6C
  S.modal = null; S.edPop = null;
  if (!quiet) renderAll();
}

/* ---- Soundscapes: brown, pink and soft rain made with the Web Audio API (no audio files) ---- */
const AUDIO = { ctx: null, src: null, gain: null };
function noiseBuffer(ctx, kind) {
  const len = ctx.sampleRate * 6, buf = ctx.createBuffer(1, len, ctx.sampleRate), d = buf.getChannelData(0);
  let last = 0, b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0, drop = 0;
  for (let i = 0; i < len; i++) {
    const w = Math.random() * 2 - 1;
    if (kind === 'brown') { last = (last + .02 * w) / 1.02; d[i] = last * 3.2; continue; }
    b0 = .99886 * b0 + w * .0555179; b1 = .99332 * b1 + w * .0750759; b2 = .969 * b2 + w * .153852; b3 = .8665 * b3 + w * .3104856; b4 = .55 * b4 + w * .5329522; b5 = -.7616 * b5 - w * .016898;
    const pink = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * .5362) * .11; b6 = w * .115926;
    if (kind === 'pink') { d[i] = pink; continue; }
    if (Math.random() < .0006) drop = .5 + Math.random() * .7; drop *= .9993;   // rain: a soft bed plus brief droplets
    d[i] = pink * (.35 + drop);
  }
  return buf;
}
function setSound(kind) {
  try {
    if (AUDIO.src) { AUDIO.src.stop(); AUDIO.src = null; }
    S.sound.kind = kind === 'off' ? null : kind;
    if (!S.sound.kind) return;
    AUDIO.ctx ||= new (window.AudioContext || window.webkitAudioContext)();
    AUDIO.gain ||= AUDIO.ctx.createGain(); AUDIO.gain.gain.value = S.sound.vol / 250;
    const lp = AUDIO.ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = kind === 'rain' ? 2600 : 9000;
    const src = AUDIO.ctx.createBufferSource(); src.buffer = noiseBuffer(AUDIO.ctx, kind); src.loop = true;
    src.connect(lp).connect(AUDIO.gain).connect(AUDIO.ctx.destination); src.start(); AUDIO.src = src;
  } catch (e) { S.sound.kind = null; }
}

// After a render: place the editor's pickers under what opened them, size the ruler, decorate the note
function afterRender() {
  const ar = app.getBoundingClientRect(), z = ar.width / app.offsetWidth || 1;
  const ep = app.querySelector('[data-anchor-ed]');
  if (ep) { let b = app.querySelector(`.ed-zone [data-act="ed-pop"][data-v="${ep.dataset.anchorEd}"]`); if (b && !b.offsetWidth) b = app.querySelector('[data-act="ed-more"]');   // R11: a picker opened from ⋯ hangs under ⋯
    if (b) ep.style.left = clamp((b.getBoundingClientRect().left - ep.parentElement.getBoundingClientRect().left) / z, 0, Math.max(0, ep.parentElement.offsetWidth - ep.offsetWidth)) + 'px'; }
  decorateDoc(); markActiveBlock(); sizeRuler(); fitRaw(); embedVideos(); edAfterRender(); paintFmtState();   // edAfterRender: Editor QC, the caret back where it was   // fitRaw: bug fix 2026-10-16, the .md side fits its text
  readAfterRender();   // Phase 6C: the read-aloud highlight, or stop when the bar has closed
}
