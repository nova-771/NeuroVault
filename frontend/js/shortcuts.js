/* Build M (QC 4 · 31): a keyboard shortcut for every rail and window-bar button (design profile: "Every icon has a shortcut").
   One table, KEYS, is the truth for the keys that run, the tooltips ("Timer · Ctrl+Alt+3", with aria-keyshortcuts)
   and Settings → Keyboard shortcuts. The rail is Ctrl+Alt+1…5 in rail order; the window bar is Ctrl+Alt+letter; Settings is
   Ctrl+, as in most apps. Entries without `run` are the keys the app already had (actions.js, editor.js, dictionary.js, main.py):
   they are listed and shown, and run where they always did.
   Never used, so nothing clashes: the editor's Ctrl+B / I / A / Z / Y / Shift+Z, Tab, F2, F7; the app's Ctrl+K / N / S / T / W,
   Ctrl+Shift+D, Ctrl+Alt+R, F11; the global Ctrl+Alt+P / S / H (main.py); WebView2's Ctrl+F / G / P / R / U, F5, F12,
   Ctrl+Shift+I / J / C, Alt+← / →, Ctrl+Tab, Ctrl+± / 0; Windows' Alt+F4, Alt+Tab, Win+…, Ctrl+Esc, Ctrl+Shift+Esc, Ctrl+Alt+Del
   and Ctrl+Alt+arrows (some graphics drivers rotate the screen). No vowel letters either: on a UK keyboard Ctrl+Alt+A / E / I / O / U
   type á é í ó ú.
   The new keys work from anywhere except while a dialog (or the setup) is open, and never in a popped-out window. Ctrl+Alt is
   AltGr on Windows, so in a text field a press that types a character (Ctrl+Alt+2 is @ on a Portuguese keyboard, Ctrl+Alt+4 is €
   on a UK one) is left to type it; everywhere else it runs the shortcut. */
'use strict';
const KEYS = [
  // Go to: the rail, top to bottom
  { g: 'go', l: 'Notes', k: ['Ctrl', 'Alt', '1'], sel: '.rail [data-act="view"][data-v="notes"]', run: () => fire('view', 'notes') },
  { g: 'go', l: 'Tasks', k: ['Ctrl', 'Alt', '2'], sel: '.rail [data-act="view"][data-v="tasks"]', run: () => fire('view', 'tasks') },
  { g: 'go', l: 'Timer', k: ['Ctrl', 'Alt', '3'], sel: '.rail [data-act="view"][data-v="timer"]', run: () => fire('view', 'timer') },
  { g: 'go', l: 'Timeline', k: ['Ctrl', 'Alt', '4'], sel: '.rail [data-act="view"][data-v="history"]', run: () => fire('view', 'history') },
  { g: 'go', l: 'Dictionary', k: ['Ctrl', 'Alt', '5'], sel: '.rail [data-act="view"][data-v="dict"]', run: () => fire('view', 'dict') },
  { g: 'go', l: 'Search and commands', k: ['Ctrl', 'K'], sel: '.titlebar [data-act="palette"]' },
  { g: 'go', l: 'All open tabs', k: ['Ctrl', 'Alt', 'L'], sel: '.titlebar [data-act="tab-list"]', run: was => { S.tabList = !was.tabList; S.keyTabs = true; S.focus = { sel: S.tabList ? '.menu--tabs [aria-checked="true"]' : tabListBack() }; renderAll(); } },
  { g: 'go', l: 'New tab', k: ['Ctrl', 'T'], sel: '.titlebar [data-act="tab-new"]' },
  { g: 'go', l: 'Close tab', k: ['Ctrl', 'W'] },
  { g: 'go', l: 'Settings', k: ['Ctrl', ','], sel: '.rail [data-act="settings"]', run: () => fire('settings') },
  // Capture: the three buttons over the sidebar, then the quick timer and the wrap-up
  { g: 'cap', l: 'New sticky note', k: ['Ctrl', 'Alt', 'J'], sel: '.titlebar [data-act="sticky-new"]', run: () => fire('sticky-new') },
  { g: 'cap', l: 'Brain Dump (anywhere)', k: ['Ctrl', 'Shift', 'D'], sel: '.titlebar [data-act="dump"]' },
  { g: 'cap', l: 'Voice ramble', k: ['Ctrl', 'Alt', 'V'], sel: '.titlebar [data-act="voice"]', run: () => fire('voice') },
  { g: 'cap', l: 'Quick timer', k: ['Ctrl', 'Alt', 'Q'], sel: '.titlebar [data-act="qt-toggle"]', run: () => fire('qt-toggle') },
  { g: 'cap', l: 'Wrap up the day', k: ['Ctrl', 'Alt', 'W'], sel: '.titlebar [data-act="wrap"]', run: () => fire('wrap') },
  // Window and panels
  { g: 'win', l: 'Left sidebar', k: ['Ctrl', 'Alt', 'B'], sel: '.titlebar [data-act="side-toggle"]', run: () => fire('side-toggle') },
  { g: 'win', l: 'Right sidebar (in a note)', k: ['Ctrl', 'Alt', 'N'], sel: '.titlebar [data-act="inspector"]', run: () => { if (paneInspOk() && UI.zen !== 'on') fire('inspector'); } },   // in a note, or with a note in another pane (panes.js)
  { g: 'win', l: 'Light or dark theme', k: ['Ctrl', 'Alt', 'T'], sel: '.rail [data-act="theme-toggle"]', run: () => fire('theme-toggle') },
  { g: 'win', l: 'Next pane (split screen)', k: ['F6'], or: ['Shift', 'F6'] },   // panes.js
  { g: 'win', l: 'Zen mode', k: ['F11'], sel: '.titlebar [data-act="zen"]', tip: 'F11 or Esc', aria: 'F11 Escape' },
  { g: 'win', l: 'Reading ruler', k: ['Ctrl', 'Alt', 'R'] },
  { g: 'win', l: 'Minimise', k: ['Ctrl', 'Alt', 'M'], sel: '.titlebar [data-act="win"][data-v="min"]', run: () => fire('win', 'min') },
  { g: 'win', l: 'Maximise or restore down', k: ['Ctrl', 'Alt', 'Enter'], sel: '.titlebar [data-act="win"][data-v="max"]', run: () => fire('win', 'max') },
  { g: 'win', l: 'Close NeuroVault', k: ['Alt', 'F4'], sel: '.titlebar [data-act="win"][data-v="close"]' },   // Windows' own key: the window has a system menu (winframe.py), and popout.py's closing handler takes it
  // Editor (editor.js, dictionary.js, actions.js)
  { g: 'ed', l: 'Bold', k: ['Ctrl', 'B'] }, { g: 'ed', l: 'Italic', k: ['Ctrl', 'I'] },
  { g: 'ed', l: 'Undo', k: ['Ctrl', 'Z'] }, { g: 'ed', l: 'Redo', k: ['Ctrl', 'Y'], or: ['Ctrl', 'Shift', 'Z'] },
  { g: 'ed', l: 'Select the whole note', k: ['Ctrl', 'A'] },
  { g: 'ed', l: 'Indent or outdent a list item', k: ['Tab'], or: ['Shift', 'Tab'] },
  { g: 'ed', l: 'Check spelling', k: ['F7'] },
  { g: 'ed', l: 'New note', k: ['Ctrl', 'N'] }, { g: 'ed', l: 'Save', k: ['Ctrl', 'S'] },
  { g: 'ed', l: 'Rename the selected file or folder', k: ['F2'] },
  // Anywhere in Windows (main.py, the optional keyboard package)
  { g: 'any', l: 'Pause or resume the timer', k: ['Ctrl', 'Alt', 'P'] },
  { g: 'any', l: 'Stop &amp; log', k: ['Ctrl', 'Alt', 'S'] },
  { g: 'any', l: 'Bring NeuroVault to the front', k: ['Ctrl', 'Alt', 'H'] },
];
const KEY_GROUPS = [['go', 'Go to'], ['cap', 'Capture'], ['win', 'Window and panels'], ['ed', 'Editor'], ['any', 'Anywhere in Windows']];
const keyText = k => k.join('+');
const keyAria = k => k.map(x => ({ Ctrl: 'Control', Esc: 'Escape' }[x] || x)).join('+');
// 'ctrl+alt+3': the modifiers in one order, then the key
const keySig = k => ['Ctrl', 'Shift', 'Alt'].filter(m => k.includes(m)).concat(k.filter(x => !['Ctrl', 'Shift', 'Alt'].includes(x))).join('+').toLowerCase();
// The key a press means: the letter as the layout has it, else the physical key (Ctrl+Alt+2 on a Portuguese keyboard says "@")
const codeKey = c => /^Key[A-Z]$/.test(c) ? c.slice(3).toLowerCase() : /^(Digit|Numpad)\d$/.test(c) ? c.slice(-1) : ({ Comma: ',', Enter: 'enter', NumpadEnter: 'enter' }[c] || '');
function pressKey(e) { const k = (e.key || '').toLowerCase(); return /^[a-z0-9,]$/.test(k) ? k : codeKey(e.code) || k; }
function pressSig(e) { return [e.ctrlKey || e.metaKey ? 'ctrl' : '', e.shiftKey ? 'shift' : '', e.altKey ? 'alt' : '', pressKey(e)].filter(Boolean).join('+'); }

document.addEventListener('keydown', e => {
  if (POP || e.isComposing) return;
  const x = KEYS.find(y => y.run && keySig(y.k) === pressSig(e)); if (!x) return;
  if (S.modal || (typeof SETUP !== 'undefined' && SETUP.open)) return;   // a dialog keeps its keys
  const t = e.target, typing = t?.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t?.tagName || '');
  if (typing && e.key.length === 1 && e.key.toLowerCase() !== pressKey(e)) return;   // AltGr typing a character: let it type
  e.preventDefault(); e.stopImmediatePropagation(); if (e.repeat) return;
  const was = { tabList: S.tabList };
  S.menu = false; S.ctx = null; S.sortMenu = false; S.tabList = false; S.edMore = false; S.edPop = null; if (S.bm) S.bm.pop = null;   // as a click elsewhere would
  x.run(was);
}, true);   // capture: before the editor's own keys

/* ---- The tooltips: "Timer · Ctrl+Alt+3" on every rail and window-bar button, after each draw ---- */
function keyTips() {
  KEYS.forEach(x => { if (x.sel) app.querySelectorAll(x.sel).forEach(b => {
    const tip = x.tip || keyText(x.k), base = (b.getAttribute('title') || b.getAttribute('aria-label') || x.l).replace(/\s*\((?:Ctrl|Alt|F\d|Esc)[^)]*\)$/, '').replace(/ · click for the quick timer$/, '');
    if (!b.title.endsWith(' · ' + tip)) b.title = `${base} · ${tip}`;
    b.setAttribute('aria-keyshortcuts', x.aria || keyAria(x.k));
  }); });
  app.querySelectorAll('.titlebar .ws-tab-close').forEach(b => { const on = b.closest('.ws-tab')?.getAttribute('aria-selected') === 'true'; b.title = on ? 'Close tab · Ctrl+W' : 'Close tab'; if (on) b.setAttribute('aria-keyshortcuts', 'Control+W'); });   // Ctrl+W closes the tab you're on
}
// The list's button shows only when the tabs overflow; with it hidden, closing the list (the key again, or Esc) goes back to the tab you're on
const tabListBack = () => app.querySelector('[data-act="tab-list"]')?.offsetWidth ? '[data-act="tab-list"]' : '.ws-tab[aria-selected="true"]';
const keyAfter0 = afterRender;
afterRender = function () {   // eslint-disable-line no-global-assign
  keyAfter0.apply(this, arguments); keyTips();
  if (S.keyTabs && !S.tabList) { S.keyTabs = false; if (document.activeElement === document.body) app.querySelector(tabListBack())?.focus(); }
};

/* ---- Settings → Keyboard shortcuts: every key, grouped (read-only for now) ---- */
function shortcutsPane() {
  const kbd = k => k.map(x => `<span class="kbd">${x}</span>`).join(' ');
  return KEY_GROUPS.map(([g, h]) => `<div class="pop-sec km-sec"><div class="eyebrow">${h}</div>${KEYS.filter(x => x.g === g).map(x =>
    `<div class="set-row"><div class="set-label">${x.l}</div><span class="timer-hint">${kbd(x.k)}${x.or ? ` or ${kbd(x.or)}` : ''}${x.tip && x.tip !== keyText(x.k) ? ' or <span class="kbd">Esc</span>' : ''}</span></div>`).join('')}</div>`).join('')
    + `<p class="set-desc">The "anywhere" keys work while NeuroVault is in the background too, and need the optional <span class="code">keyboard</span> package. Shortcuts wait while a dialog is open.</p>`;
}
