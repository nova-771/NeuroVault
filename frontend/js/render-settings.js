/* Settings dialog and the reader settings (theme, accent, font, text size, spacing and comfort).
   Extracted from design/vault-notes-mockups.html (R20). Settings opens as a dialog (R9).
   Phase 5: every page reads and writes config.json (store.js: setReader, setComfort, setSoundscape, setTset). */
'use strict';
const SET_SECTIONS = [['appearance', 'Reading & comfort'], ['editor', 'Editor'], ['focus', 'Focus & nudges'], ['alerts', 'Timer alerts'], ['sound', 'Alert sound'], ['wrapup', 'Daily wrap-up'], ['ai', 'AI models'], ['voice', 'Voice'], ['vault', 'Vault & files'], ['data', 'Data'], ['hotkeys', 'Keyboard shortcuts'], ['about', 'About']];
// ---- Build F: Daily wrap-up is built (wrapup.js), so no page is Coming soon now ----
const SET_SOON = {};   // pages for features that come later (Build B: AI models is built, render-ai.js)
// ---- end Build F ----
const VOICE_PAGE = [];   // Settings → Voice: each feature pushes a function that returns its rows (6B speech to text, 6C read aloud; Build A unshifts live words and "After a voice ramble", voice-attach.js)
const VAULT_PAGE = [];   // Build A: Settings → Vault & files rows from other files (the Attachments tab, unused attachments)
function settingsPane(sec) {
  const ts = D.tset, tog = (k, l, d) => `<div class="set-row"><div><div class="set-label" id="set-${k}">${l}</div><div class="set-desc">${d}</div></div><button class="toggle" role="switch" aria-checked="${ts[k]}" aria-labelledby="set-${k}" data-act="toggle" data-v="${k}"></button></div>`;
  const seg = (label, list, cur, k) => `<div class="set-row"><div class="set-label" id="rd-${k}">${label}</div><div class="seg" role="group" aria-labelledby="rd-${k}">${list.map(([v, l]) => `<button class="seg-opt" data-act="set-reader" data-k="${k}" data-v="${v}" aria-pressed="${cur === v}">${l}</button>`).join('')}</div></div>`;
  if (sec === 'appearance') return comfortControls('set') + `<div class="pop-sec">${seg('Text size', TEXT_SIZES, READER.textsize, 'textsize')}</div>`;   // the accent is violet (decided R5)
  if (sec === 'editor') return a11yTog('zoneB', 'Show HTML extensions', 'The &lt;HTML&gt; part of the toolbar: underline, highlight, colour, alignment, sub and superscript, folds. Off keeps notes pure Markdown')
    + a11yTog('homophones', 'Homophone guard', 'A blue dotted line under easily swapped words: their / there, affect / effect, quiet / quite')
    + `<div class="set-row"><div><div class="set-label">Pasted images</div><div class="set-desc code">attachments/paste-YYYYMMDD-HHMMSS.png</div></div></div>`;
  if (sec === 'focus') return `<div class="set-row"><div><div class="set-label">Hyperfocus nudge</div><div class="set-desc">A gentle reminder to blink, stretch and drink water after a long stretch</div></div><div class="seg" role="group" aria-label="Hyperfocus nudge">${[[0, 'Off'], [45, '45 min'], [60, '60 min']].map(([v, l]) => `<button class="seg-opt" data-act="a11y-set" data-k="nudge" data-v="${v}" aria-pressed="${S.a11y.nudge === v}">${l}</button>`).join('')}</div></div>
    <div class="set-row"><div><div class="set-label">Focus sound</div><div class="set-desc">Made by the app as you listen: no audio files</div></div><div class="seg" role="group" aria-label="Focus sound">${[['off', 'Off'], ['brown', 'Brown'], ['pink', 'Pink'], ['rain', 'Rain']].map(([k, l]) => `<button class="seg-opt" data-act="sound" data-v="${k}" aria-pressed="${(S.sound.kind || 'off') === k}">${l}</button>`).join('')}</div></div>`;
  if (sec === 'alerts') return tog('five_min', '5-minute warning', 'A cue when a planned session has 5 minutes left') + tog('sound', 'Sound when time is up', 'Plays when the timer reaches zero') + tog('desktop', 'Desktop notification', 'Depends on Windows notification settings') + tog('taskbar', 'Flash the taskbar icon', 'Windows only') + tog('overtime_repeat', 'Remind me during overtime', `Every ${ts.interval} minutes until you stop`);
  if (sec === 'sound') return `<div class="set-actions"><select class="field" data-act="tsound" aria-label="Alert sound">${[['bell', 'Bell'], ['chime', 'Chime'], ['alarm', 'Alarm'], ['pop', 'Soft pop'], ['scifi', 'Sci-fi'], ['silent', 'Silent']].map(([v, l]) => `<option value="${v}" ${ts.sound_name === v && !ts.custom_sound ? 'selected' : ''}>${l}</option>`).join('')}${ts.custom_sound ? `<option value="" selected>Custom: ${esc(fileName(ts.custom_sound))}</option>` : ''}</select>
      <button class="btn btn--secondary" data-act="tsound-preview">Preview</button><button class="btn btn--secondary" data-act="tsound-file">Custom file…</button></div>
    <div class="rate-row"><div class="rate-head"><span id="vol-l">Volume</span><span class="num" data-range-val="volume">${ts.volume}%</span></div><input class="range" type="range" min="0" max="100" value="${ts.volume}" data-act="trange" data-k="volume" aria-labelledby="vol-l"></div>
    <div class="rate-row"><div class="rate-head"><span id="int-l">Overtime reminder every</span><span class="num" data-range-val="interval">${ts.interval} min</span></div><input class="range" type="range" min="1" max="20" value="${ts.interval}" data-act="trange" data-k="interval" aria-labelledby="int-l"></div>`;
  if (sec === 'vault') return `${vaultHead()}<p class="view-sub">Each logged session is added to that day's note. Leave empty to turn this off.</p><div class="set-actions"><input class="field code" data-act="tvault" value="${esc(ts.vault)}" placeholder="No vault folder set: export is off" aria-label="Vault folder">
      <button class="btn btn--secondary" data-act="tvault-browse">Browse…</button><button class="btn btn--secondary" data-act="tvault-test" ${ts.vault ? '' : 'disabled'}>Test</button>
      ${ts.vaultStatus === 'ok' ? '<span class="chip chip--success">Test file written</span>' : ts.vaultStatus === 'fail' ? '<span class="chip chip--danger">Folder not found</span>' : ''}</div>`;
  if (sec === 'data') return `<div class="set-row"><div><div class="set-label">Export every session</div><div class="set-desc">One CSV with sessions, pauses and check-ins</div></div><button class="btn btn--secondary" data-act="texport" ${D.sessions.length ? '' : 'disabled'}>${ic('download')}Export CSV</button></div>
    <div class="set-row"><div><div class="set-label">Database</div><div class="set-desc code">${esc(ts.db)}</div></div></div>${setupAgainRow()}`;   // Build D: Run the setup again (setup.js)
  // v0.1.1: each part draws on its own, so one that can't (an odd status) says so in a line and the rest of the page still shows
  if (sec === 'voice') return VOICE_PAGE.map(f => { try { return f(); } catch (e) { console.warn('Settings → Voice part failed', e); if (typeof log95 === 'function') log95('error', 'Settings → Voice: ' + (e?.message || e), f.name || '');
    return '<div class="set-row" data-voice-part-failed><div><div class="set-desc" role="alert">This part of the Voice settings couldn’t be shown. Close Settings and open it again; if it stays, the details are in neurovault.log.</div></div></div>'; } }).join('');
  // Packaging: the version (version.py, through get_settings) and the licence
  if (sec === 'about') return `<div class="set-row"><div><div class="set-label">NeuroVault</div><div class="set-desc">Version <span class="num">${esc(ts.version || 'dev')}</span></div></div></div>
    <div class="set-row"><div><div class="set-label">Licence</div><div class="set-desc">Free software under the GNU General Public License, version 3. The licences of the parts it uses are in THIRD-PARTY-NOTICES.md, next to NeuroVault.exe</div></div></div>`;
  if (sec === 'ai') return aiPane();   // Build B: render-ai.js
  if (sec === 'wrapup') return wrapSettings();   // Build F: wrapup.js
  return shortcutsPane();   // Build M (QC 4 · 31): every key, grouped (shortcuts.js)
}
function settingsModal() {
  const label = SET_SECTIONS.find(x => x[0] === S.setSec)[1];
  return dlg({ id: 'settings', size: 'wide', cls: 'modal--settings', title: 'Settings', titleId: 'set-title', xLabel: 'Close settings',   // Build L: R41's anatomy, wide
    pre: `<div class="settings-grid">${settingsNav()}<div class="settings-pane"><h3 class="view-title">${label}</h3><div class="card card-pad">${settingsPane(S.setSec)}</div></div></div>` });
}
const settingsNav = () => `<nav class="settings-nav" aria-label="Settings sections">${SET_SECTIONS.map(([k, l]) => `<button class="list-item" data-act="set-sec" data-v="${k}" ${S.setSec === k ? 'aria-current="true"' : ''}${SET_SOON[k] ? ' ' + soon(SET_SOON[k]) : ''}><span class="list-item-title">${l}</span></button>`).join('')}</nav>`;
function openSettings(sec) {
  if (sec && !SET_SOON[sec]) S.setSec = sec; S.menu = false;
  S.modal = 'settings'; S.focus = { sel: '.settings-nav [aria-current="true"]' }; renderAll();
}

/* ---- Sensory comfort: theme, font, spacing and reading aids, in Settings → Reading & comfort (R9) ---- */
function comfortControls(where) {
  const a = S.a11y;
  const slider = (k, label, min, max, step, fmt) => `<div class="slider-row"><div class="slider-head"><span id="sl-${where}-${k}">${label}</span><b data-sl-val="${k}">${fmt(a[k])}</b></div><input class="range" type="range" min="${min}" max="${max}" step="${step}" value="${a[k]}" data-act="a11y-range" data-k="${k}" aria-labelledby="sl-${where}-${k}"></div>`;
  const tog = (k, label, desc) => `<div class="set-row"><div><div class="set-label" id="tg-${where}-${k}">${label}</div><div class="set-desc">${desc}</div></div><button class="toggle" role="switch" aria-checked="${a[k]}" aria-labelledby="tg-${where}-${k}" data-act="a11y-toggle" data-v="${k}"></button></div>`;
  return `<div class="pop-sec"><div class="eyebrow">Theme</div><div class="swatches" role="group" aria-label="Theme">${THEMES.map(([v, l]) => `<button class="swatch swatch--${v}" data-act="set-reader" data-k="theme" data-v="${v}" aria-pressed="${READER.theme === v}"><span class="swatch-aa" aria-hidden="true">Aa</span>${l}</button>`).join('')}</div></div>
    <div class="pop-sec"><div class="eyebrow">Font</div><div class="fonts" role="group" aria-label="Font">${FONTS.map(([v, l]) => `<button class="font-opt font-opt--${v}" data-act="set-reader" data-k="font" data-v="${v}" aria-pressed="${READER.font === v}">${l}</button>`).join('')}</div></div>
    <div class="pop-sec"><div class="eyebrow">Spacing in the editor</div>${slider('letter', 'Letter spacing', 0, .15, .01, v => (+v).toFixed(2) + ' em')}${slider('word', 'Word spacing', 0, .3, .02, v => (+v).toFixed(2) + ' em')}${slider('line', 'Line height', 1.4, 2.2, .05, v => (+v).toFixed(2))}${slider('width', 'Line width', 55, 95, 5, v => +v >= 95 ? 'Full width' : v + ' characters')}</div>
    <div class="pop-sec pop-toggles">${tog('ruler', 'Reading ruler', 'Dims everything but the lines you are reading')}${a.ruler ? slider('rulerLines', 'Lines in focus', 1, 3, 1, v => v) : ''}${tog('bionic', 'Bionic reading', 'Bolds the start of each word. Editing pauses while it is on')}${tog('still', 'Reduced motion', 'Turns off slides, fades and pulses')}</div>`;
}
/* QC 89 (the user's first real user: "the borders on each side of the 'page' is too wide feels limiting"): Page width.
   Narrow and Comfortable are line lengths (65 and 80 characters, or a custom 55-95); Wide, the default, is most of the note area
   but never more than 1320px, so an ultrawide screen never gets edge-to-edge lines by default (the user: full-width bars there are
   "ridiculous"); Full is the whole note area. The toolbar's Fit width (QC 66) is centred on this column. */
const PAGE_WIDE = 'clamp(560px, 90cqi, 1320px)';
const pageCol = w => w >= 120 ? 'none' : w >= 100 ? PAGE_WIDE : `min(${PAGE_WIDE}, ${w}ch)`;
function applyComfort() {
  const a = S.a11y, s = app.style;   // the app sets these :root tokens from the reader's settings
  s.setProperty('--editor-letter-spacing', a.letter + 'em'); s.setProperty('--editor-word-spacing', a.word + 'em');
  s.setProperty('--editor-line-height', a.line); s.setProperty('--editor-max-width', a.width >= 100 ? 'none' : a.width + 'ch');
  s.setProperty('--note-col', pageCol(a.width));   // R8: the centred note column follows the Page width (QC 89)
  app.classList.toggle('is-still', a.still); app.classList.toggle('is-zen', UI.zen === 'on');
}
const a11yTog = (k, label, desc, extra = '') => `<div class="set-row"><div><div class="set-label" id="at-${k}">${label}</div><div class="set-desc">${desc}</div></div><button class="toggle" role="switch" aria-checked="${S.a11y[k]}" aria-labelledby="at-${k}" data-act="a11y-toggle" data-v="${k}" ${extra}></button></div>`;
const SL_FMT = { letter: v => (+v).toFixed(2) + ' em', word: v => (+v).toFixed(2) + ' em', line: v => (+v).toFixed(2), width: v => +v >= 120 ? 'Full' : +v >= 100 ? 'Wide' : v + ' characters', rulerLines: v => String(v) };
// Build V: the vault folder and the settings file (vault.js), note history (Build M), the lists saved as files;
// the Daily notes export under them is an Obsidian folder that gets a note per day of timer sessions
const vaultHead = () => `${vaultSettingsHead()}
  <div class="set-row"><div><div class="set-label" id="bm-kept-l">Versions kept</div><div class="set-desc">Every save keeps a version of the note, so you can see what changed and restore one, in the Timeline</div></div><div class="seg" role="group" aria-labelledby="bm-kept-l">${BM_KEPT.map(v => `<button class="seg-opt" data-act="bm-kept" data-v="${v}" aria-pressed="${S.a11y.history === v}">${v}</button>`).join('')}</div></div>
  <div class="set-row"><div><div class="set-label">Sticky Notes and Brain Dump</div><!-- Build O (QC 20): names, not file names --><div class="set-desc">Saved as files in your vault folder</div></div></div>${VAULT_PAGE.map(f => f()).join('')}<div class="eyebrow eyebrow--gap">Daily notes export</div>`;   // Build A: VAULT_PAGE

/* ---- New tab ---- */
const viewNewTab = () => `<section class="view"><div class="newtab"><div class="empty-title">No file is open</div><div class="newtab-links">
  <button class="link-btn" data-act="tree-new-note" ${D.projects.length ? '' : 'disabled'}>Create a new note <span class="kbd">Ctrl+N</span></button><button class="link-btn" data-act="palette">Go to a file <span class="kbd">Ctrl+K</span></button>
  <button class="link-btn" data-act="dump">Add a thought to the Brain Dump <span class="kbd">Ctrl+Shift+D</span></button><button class="link-btn" data-act="tab-close-current">Close this tab</button></div></div></section>`;

/* =====================================================================
   PHASE 5 · SETTINGS — the focus sound comes back on launch, and the custom alert sound is read through the app
   ===================================================================== */
const fileName = p => String(p || '').split(/[\\/]/).pop();
// The focus sound saved last time starts again. WebView2, like a browser, may hold audio until the first click or key: it waits for one.
function restoreSoundscape() {
  if (CHECK || !S.sound.kind || AUDIO.src) return;
  setSound(S.sound.kind);
  if (AUDIO.ctx?.state !== 'suspended') return;
  const go = () => { AUDIO.ctx.resume(); ['pointerdown', 'keydown'].forEach(n => removeEventListener(n, go, true)); };
  ['pointerdown', 'keydown'].forEach(n => addEventListener(n, go, true));
}
// The reading ruler on the caret's line (after any key in the note). An empty line has no text box, so its block's box is used.
function rulerToCaret() {
  const sel = getSelection(); if (!S.a11y.ruler || !sel.rangeCount) return;
  let r = sel.getRangeAt(0).getBoundingClientRect();
  if (!r.height) { const n = sel.focusNode; r = (n?.nodeType === 1 ? n : n?.parentElement)?.getBoundingClientRect() || r; }
  if (r.height) placeRuler(r.top + Math.min(r.height, 40) / 2);
}
// The page is served over http, so it can't open the custom sound's file:/// path: api.read_custom_sound() hands it over as a data: URL
const ALERT_FILE = { path: null, url: null, busy: null };
function loadCustomSound() {
  const path = D.tset.custom_sound;
  if (!path || !api()) return Promise.resolve(null);
  if (ALERT_FILE.path === path) return ALERT_FILE.busy || Promise.resolve(ALERT_FILE.url);
  ALERT_FILE.path = path; ALERT_FILE.url = null;
  return ALERT_FILE.busy = nv('read_custom_sound').then(r => {
    if (ALERT_FILE.path !== path) return null;
    ALERT_FILE.busy = null;
    if (failed(r)) { ALERT_FILE.path = null; toast(r.message); return null; }   // tried again next time (the file may come back)
    return ALERT_FILE.url = r.data_url;
  });
}
// For playAlert (render-timer.js): the sound if it's loaded; otherwise it starts loading and the built-in sound plays this time
const customSoundUrl = () => ALERT_FILE.path === D.tset.custom_sound && ALERT_FILE.url || (loadCustomSound(), null);
