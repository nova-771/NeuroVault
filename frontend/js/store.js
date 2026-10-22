/* App state and data. Phase 1 runs on the mockup's sample vault; Phases 2–5 load it from window.pywebview.api.
   Reader settings (theme, accent, font, text size) are saved in config.json through api.save_settings.
   Extracted from design/vault-notes-mockups.html (R20). */
'use strict';
/* =====================================================================
   SAMPLE DATA — shaped like the app's own objects (notes, tasks and
   timeline events), using its vocabulary.
   ===================================================================== */
const BASE_NOTES = [
  { id: 'note-1', title: 'Q3 Roadmap Draft', category: 'Planning', tags: ['roadmap', 'q3', 'planning'], md:
`## Overview
Consolidate core vault synchronisation and dyslexia-first **Word/Docs-style Markdown** editing across desktop and mobile clients before the Q3 milestone freeze.
Beta readers will recieve the build on Friday; we hope the new themes effect how quite the page feels to there eyes.
## Open questions
- Should offline conflict resolution favour local snapshots or CRDT merges?
- How can we stop the JSON block parser rendering \`[object Object]\` when AST nodes are empty?
## Next steps
{{tasks}}
Finalise schema migration scripts with Engineering during Tuesday's design sync and reference [[API auth notes]].` },
  { id: 'note-2', title: 'API auth notes', category: 'Engineering', tags: ['api', 'auth', 'oauth2', 'security'], md:
`## Overview
Token rotation for the Vault Sync API uses short-lived access tokens (15m) paired with HTTP-only refresh tokens.
## Open questions
- Rate-limiting threshold per workspace key during bulk imports.
- Hardware security key support for encrypted vaults.
## Next steps
{{tasks}}
Update endpoint documentation for [[Q3 Roadmap Draft]].` },
  { id: 'note-3', title: 'Meeting notes — design sync', category: 'Meetings', tags: ['design', 'sync', 'accessibility', 'opendyslexic'], md:
`## Overview
Reviewed warm paper colour contrast and confirmed OpenDyslexic as the default reading and editing typeface, plus a low-glare dark mode.
> Muted grey text is too faint on paper; raise it to meet AA.
## Open questions
- Should the right outline sidebar remember its open/closed state per view?
## Next steps
{{tasks}}
See [[Q3 Roadmap Draft]] for milestone dates.` },
  { id: 'note-4', title: 'Reading list — accessibility research', category: 'Planning', tags: ['research', 'accessibility'], md:
`## Papers
1. Font choice and reading speed for dyslexic readers
2. Line length and comprehension on screens
3. Contrast preferences: off-white vs pure white
## Notes
Line length around 60–75 characters keeps reading comfortable. Links to [[Meeting notes — design sync]].` },
  { id: 'note-5', title: 'Sync conflict post-mortem', category: 'Engineering', tags: ['sync', 'incident'], md:
`## What happened
Two devices edited *the same note* offline; the last write won and a task list was lost.
## Fix
{{tasks}}
### Follow-up
Add a conflict banner that shows both versions. Related: [[API auth notes]].` },
  { id: 'note-6', title: '1:1 with Maya — 9 Oct', category: 'Meetings', tags: ['1-1'], md:
`## Agenda
- Graph view performance with 500+ nodes
- Hiring for the mobile client
## Actions
{{tasks}}` },
];
const BASE_TASKS = [
  { id: 't-1', noteId: 'note-1', title: 'Fix [object Object] serialisation in empty AST block parser', priority: 'High', due: 'Today', done: false },
  { id: 't-2', noteId: 'note-1', title: 'Lock Q3 roadmap milestone deliverables with product leads', priority: 'Medium', due: 'Upcoming', done: false },
  { id: 't-3', noteId: 'note-2', title: 'Audit OAuth2 PKCE refresh token rotation window (15m)', priority: 'High', due: 'Today', done: false },
  { id: 't-4', noteId: 'note-2', title: 'Configure rate-limiting headers for bulk vault imports', priority: 'Medium', due: 'Upcoming', done: true },
  { id: 't-5', noteId: 'note-3', title: 'Verify OpenDyslexic contrast ratios in dark mode', priority: 'Low', due: 'Upcoming', done: true },
  { id: 't-6', noteId: 'note-3', title: 'Export dark and paper tokens to the engineering repo', priority: 'Medium', due: 'Today', done: false },
  { id: 't-7', noteId: 'note-5', title: 'Keep both versions when two devices edit offline', priority: 'High', due: 'Upcoming', done: false },
  { id: 't-8', noteId: 'note-6', title: 'Profile graph view with 500 nodes', priority: 'Low', due: 'Upcoming', done: false },
];
const BASE_EVENTS = [
  { id: 'ev-1', time: 'Just now', range: 'Today', type: 'Edits', title: 'Edited "Q3 Roadmap Draft"', desc: 'Updated tags and section anchors.', noteId: 'note-1' },
  { id: 'ev-2', time: '42 min ago', range: 'Today', type: 'Tag changes', title: 'Tagged #oauth2 and #security on "API auth notes"', desc: 'Linked the security audit to milestone M2.', noteId: 'note-2' },
  { id: 'ev-3', time: '3 h ago', range: 'Today', type: 'Edits', title: 'Completed design sync review', desc: 'Confirmed OpenDyslexic readability and dark-mode contrast.', noteId: 'note-3' },
  { id: 'ev-4', time: 'Yesterday', range: 'Yesterday', type: 'Created', title: 'Created "Meeting notes — design sync"', desc: 'From the Meetings template.', noteId: 'note-3' },
  { id: 'ev-5', time: '2 days ago', range: 'This week', type: 'Created', title: 'Created "API auth notes"', desc: 'Branched from the Q3 roadmap for the auth spec.', noteId: 'note-2' },
  { id: 'ev-6', time: '4 days ago', range: 'This week', type: 'Created', title: 'Initialised "Q3 Roadmap Draft"', desc: 'Root planning document for the Q3 sync release.', noteId: 'note-1' },
];
/* R5: Timer sample data, shaped like NeuroVault's api.py (projects double as timer categories;
   sessions carry pauses and milestones). "Now" is fixed so every profile renders the same. */
const NOW = new Date(2026, 9, 14, 15, 42);
const PAUSE_REASONS = ['Lunch break', 'Coffee break', 'Distraction', 'Meeting', 'Admin task', 'Research', 'Interruption', 'Personal break'];
const CHECKIN_SEC = 30 * 60;
const BASE_PROJECTS = [
  { id: 'p-1', name: 'Planning', color: 1 }, { id: 'p-2', name: 'Engineering', color: 2 }, { id: 'p-3', name: 'Meetings', color: 3 },
  { id: 'p-4', name: 'Coursework', color: 4 }, { id: 'p-5', name: 'Reading', color: 5 }, { id: 'p-6', name: 'Admin', color: 6 },
];
const STRESS_PROJECTS = ['Research & Customer Discovery — onboarding friction interviews', 'Q3 roadmap: vault sync, offline conflicts and the dyslexia-first editor',
  'Engineering', 'Meetings', 'Coursework · MSc Data Engineering module 4 (pipelines)', 'Reading', 'Admin', 'Design critique', 'Bug bash', 'Release checklist', 'Spec writing', 'Ideas', 'Planning', 'Retro'];
const iso = d => { const p = n => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:00`; };
const dayKey = d => iso(d).slice(0, 10);
function makeSessions(projects, days, perDay, seed, everyDay) {
  let x = seed; const r = () => (x = (x * 16807) % 2147483647) / 2147483647;
  const out = [], notesFor = ['Drafted the overview section', 'Fixed the parser edge case', 'Read chapter 4', 'Cleared the inbox', 'Outlined next steps', 'Reviewed the PR'];
  const add = (p, start, target, actual, extra = {}) => out.push({ id: 's-' + out.length, project_id: p.id, project_name: p.name, color: p.color, start_time: iso(start),
    end_time: iso(new Date(start.getTime() + actual * 1000)), target_seconds: target, actual_seconds: actual, overtime_seconds: target ? Math.max(0, actual - target) : 0,
    energy: null, focus: null, is_unplanned: !target, pauses: [], milestones: [], ...extra });
  // today: three sessions, ending before "now"
  const at = (h, m, dd = 0) => { const t = new Date(NOW); t.setDate(t.getDate() - dd); t.setHours(h, m, 0, 0); return t; };
  if (projects.length) {
    const pk = i => projects[i % projects.length];
    add(pk(3), at(13, 50), 2700, 3020, { energy: 3, focus: 4, pauses: [{ category: 'Coffee break', duration_seconds: 420 }], milestones: [{ note: 'Finished the pipeline exercise', time_label: '14:20', elapsed_seconds: 1800 }] });
    add(pk(1), at(11, 5), 0, 1560, { energy: 4, focus: 3 });
    add(pk(0), at(9, 10), 1800, 1920, { energy: 4, focus: 5 });
  }
  for (let dd = 1; dd < days && projects.length; dd++) {
    let n = Math.floor(r() * (perDay + 1)); if (everyDay || dd < 12) n = Math.max(1, n);
    let h = 8 + Math.floor(r() * 2);
    for (let i = 0; i < n && h < 21; i++) {
      const p = projects[Math.floor(r() * projects.length)], unplanned = r() < .2;
      const target = unplanned ? 0 : [15, 30, 45, 60][Math.floor(r() * 4)] * 60;
      const actual = unplanned ? (10 + Math.floor(r() * 50)) * 60 : Math.max(300, Math.round(target * (.75 + r() * .55)));
      const extra = { energy: r() < .85 ? 1 + Math.floor(r() * 5) : null, focus: r() < .85 ? 1 + Math.floor(r() * 5) : null };
      if (r() < .35) extra.pauses = [{ category: PAUSE_REASONS[Math.floor(r() * 8)], duration_seconds: (2 + Math.floor(r() * 14)) * 60 }];
      if (actual >= CHECKIN_SEC && r() < .5) extra.milestones = [{ note: notesFor[Math.floor(r() * notesFor.length)], time_label: '', elapsed_seconds: CHECKIN_SEC }];
      add(p, at(h, Math.floor(r() * 40), dd), target, actual, extra);
      h += Math.ceil(actual / 3600) + (r() < .5 ? 1 : 0);
    }
  }
  return out.sort((a, b) => b.start_time.localeCompare(a.start_time));
}
/* R6: folders inside the project folders (projects are the top level, as in the Timer), and where each note lives */
const BASE_FOLDERS = [
  { id: 'f-roadmaps', name: 'Roadmaps', parent: 'p-1' }, { id: 'f-research', name: 'Research', parent: 'p-1' },
  { id: 'f-api', name: 'API', parent: 'p-2' }, { id: 'f-auth', name: 'Auth', parent: 'f-api' }, { id: 'f-pm', name: 'Post-mortems', parent: 'p-2' },
  { id: 'f-syncs', name: 'Design syncs', parent: 'p-3' }, { id: 'f-1on1', name: '1:1s', parent: 'p-3' }, { id: 'f-mod4', name: 'Module 4', parent: 'p-4' },
];
const NOTE_HOME = { 'note-1': 'f-roadmaps', 'note-2': 'f-auth', 'note-3': 'f-syncs', 'note-4': 'f-research', 'note-5': 'f-pm', 'note-6': 'f-1on1' };
const STRESS_CHAIN = ['Archive', '2026', 'Q3', 'Customer interviews — onboarding friction for first-time vault users', 'Week 41', 'Raw transcripts'];
function placeNotes(d, kind) {
  d.folders = JSON.parse(JSON.stringify(BASE_FOLDERS));
  if (kind === 'stress') {
    let parent = 'p-2'; STRESS_CHAIN.forEach((name, i) => { const id = 'f-deep-' + i; d.folders.push({ id, name, parent }); parent = id; });
    for (let i = 0; i < 12; i++) d.folders.push({ id: 'f-many-' + i, name: `Sprint ${i + 1} — planning, notes and follow-ups`, parent: 'p-1' });
  }
  d.notes.forEach((n, i) => {
    n.folder = NOTE_HOME[n.id] || (kind === 'stress' ? (i % 5 === 0 ? 'f-deep-5' : i % 5 === 1 ? 'f-many-' + (i % 12) : d.projects[i % d.projects.length].id) : d.projects[0].id);
    n.mtime = iso(new Date(NOW.getTime() - i * 13300e3)); n.ctime = iso(new Date(NOW.getTime() - (d.notes.length - i) * 86400e3 * 3));
  });
}
const TSET_DEFAULTS = { five_min: true, sound: true, desktop: true, taskbar: true, overtime_repeat: true, sound_name: 'chime', volume: 60, interval: 5, away: 'ask',   // away: Build L
  vault: 'D:\\Obsidian\\Daily notes', vaultStatus: null, db: 'C:\\Users\\you\\NeuroVault\\neurovault.db' };

/* R7: the sample HTML file in the vault (shown in the HTML studio) */
const HTML_SAMPLE = `<!doctype html>
<html>
<head>
  <style>
    body { font-family: system-ui, sans-serif; background: #f4f1ea; margin: 0; padding: 32px; }
    .card { max-width: 320px; background: #fffdf8; border-radius: 14px; padding: 20px; box-shadow: 0 6px 20px rgba(0,0,0,.08); }
    .card h2 { margin: 0 0 4px; font-size: 18px; }
    .bar { height: 10px; border-radius: 99px; background: #e6e1d6; overflow: hidden; margin: 14px 0; }
    .bar span { display: block; width: 62%; height: 100%; background: #0f766e; }
    button { border: 0; border-radius: 8px; padding: 8px 14px; background: #4839e8; color: #fff; font-weight: 600; }
  </style>
</head>
<body>
  <!-- Focus card: try editing the text or the colours -->
  <div class="card">
    <h2>Focus session</h2>
    <p>Coursework · 18 minutes left</p>
    <div class="bar"><span></span></div>
    <button onclick="this.textContent = this.textContent === 'Pause' ? 'Resume' : 'Pause'">Pause</button>
  </div>
</body>
</html>`;
function sample(kind) {
  const d = JSON.parse(JSON.stringify({ notes: BASE_NOTES, tasks: BASE_TASKS, events: BASE_EVENTS }));
  d.projects = JSON.parse(JSON.stringify(BASE_PROJECTS)); d.sessions = makeSessions(d.projects, 120, 4, 7, false); d.tset = { ...TSET_DEFAULTS };
  if (kind === 'empty') return { notes: [], tasks: [], events: [], projects: [], folders: [], sessions: [], files: [], stickies: [], inbox: [], bridge: null, tset: { ...TSET_DEFAULTS, vault: '' } };
  if (kind === 'stress') {
    d.projects = STRESS_PROJECTS.map((name, i) => ({ id: 'p-' + (i + 1), name, color: (i % 6) + 1 }));
    d.sessions = makeSessions(d.projects, 420, 6, 11, true);
  }
  placeNotes(d, kind);
  if (kind === 'stress') {
    d.notes[0].title = 'Q3 Roadmap Draft — vault synchronisation, offline conflict resolution and the dyslexia-first editor';
    d.notes[0].tags.push('very-long-tag-name-for-cross-team-initiatives', 'mobile', 'desktop', 'crdt');
    const topics = ['Customer interview synthesis: onboarding friction for first-time vault users migrating from other apps', 'Weekly sync', 'Bug bash', 'Design critique', 'Release checklist', 'Retro', 'Spec', 'Ideas'];
    for (let i = 7; i <= 40; i++) {
      const cat = ['Planning', 'Engineering', 'Meetings', 'Research & Customer Discovery'][i % 4];
      d.notes.push({ id: 'note-' + i, title: `${topics[i % topics.length]} ${i}`, category: cat, tags: ['q3', 'tag' + (i % 9)], md: `## Summary\nNote ${i} body.\n{{tasks}}` });
      if (i % 3 === 0) d.tasks.push({ id: 't-' + (i + 10), noteId: 'note-' + i, title: `Follow up on ${topics[i % topics.length].toLowerCase()} ${i}, including stakeholders across three regional teams`, priority: ['High', 'Medium', 'Low'][i % 3], due: i % 2 ? 'Today' : 'Upcoming', done: i % 4 === 0 });
    }
  }
  // R7: energy on every task, one task already split, an HTML and a PDF file, sticky notes, the inbox and last night's note to tomorrow-you
  const EN = { 't-1': 'high', 't-2': 'medium', 't-3': 'high', 't-4': 'low', 't-5': 'low', 't-6': 'medium', 't-7': 'high', 't-8': 'low' };
  d.tasks.forEach((t, i) => { t.energy = EN[t.id] || ['high', 'medium', 'low'][i % 3]; });
  const t7 = d.tasks.find(t => t.id === 't-7'); if (t7) t7.steps = [{ t: 'Edit the same test note on two devices', m: 10, done: true }, { t: 'Write down which version won', m: 3, done: false }, { t: 'Sketch the "both versions" banner', m: 5, done: false }, { t: 'Share the sketch in #sync', m: 2, done: false }];
  d.files = [{ id: 'file-html-1', kind: 'html', name: 'UI-Mockup.html', folder: 'f-syncs', code: HTML_SAMPLE }, { id: 'file-pdf-1', kind: 'pdf', name: 'Line length study.pdf', folder: 'f-research' }];
  d.stickies = [{ id: 'st-1', n: 1, text: 'Ask Maya about the £450 audit budget before Friday', color: 'yellow', file: 'stickynoted/2026-10-14-0942.md' }, { id: 'st-2', n: 2, text: 'Idea: could the reading ruler pick up the theme accent?', color: 'mint', file: 'stickynoted/2026-10-14-1318.md' }];
  d.inbox = [{ t: '09:14', text: 'Look into CRDT libraries for offline merges' }, { t: '11:47', text: 'Buy printer ink' }, { t: '14:02', text: 'What if the graph showed timer sessions too?' }];
  d.bridge = { note: 'Start with the parser bug: the failing test is already open. Leave the roadmap until after 11.', starter: 't-1', memo: true };
  if (kind === 'stress') {
    d.stickies.push({ id: 'st-3', n: 3, text: 'A very long sticky note that keeps going: remember to check the accessibility audit scope with legal, procurement and the three regional teams before anything is signed', color: 'pink', file: 'stickynoted/2026-10-14-1502.md' });
    for (let i = 0; i < 9; i++) d.inbox.push({ t: `${10 + i}:0${i}`, text: `Inbox thought ${i + 4}: something that came up while doing something else, written down so it stops buzzing` });
  }
  return d;
}
/* =====================================================================
   READER SETTINGS — saved in config.json (api.save_settings checks every value; see design/api-contract.md):
   theme (nine, Obsidian dark by default, no "System"), accent (violet), font, text size, row spacing, and the comfort
   options in S.a11y (spacing, line width, reading ruler, bionic reading, reduced motion). The rail's light/dark
   button swaps between Obsidian dark and the last light theme used.
   ===================================================================== */
const THEMES = [['obsidian', 'Obsidian dark'], ['slate', 'Soft Slate dark'], ['cream', 'Warm cream'], ['sage', 'Soft sage'], ['sky', 'Muted sky'], ['buttercup', 'Pale buttercup'], ['paper', 'Paper'], ['sepia', 'Sepia'], ['contrast', 'High contrast']];
const DARK_THEMES = ['obsidian', 'slate', 'contrast'];
const ACCENTS = [['violet', 'Violet']];   // decided R5; the setting stays so more can join later
const FONTS = [['opendyslexic', 'OpenDyslexic'], ['lexend', 'Lexend'], ['atkinson', 'Atkinson Hyperlegible'], ['system', 'System sans']];
const TEXT_SIZES = [['s', 'Small', 14], ['m', 'Medium', 15], ['l', 'Large', 17], ['xl', 'Larger', 19]];   // Build E (R29): the note text's px; the rest of the app stays Medium
const SPACINGS = [['comfortable', 'Comfortable'], ['compact', 'Compact']];
const READER = { theme: 'obsidian', accent: 'violet', font: 'opendyslexic', textsize: 'm', spacing: 'comfortable', lastLight: 'cream' };
const READER_KEYS = { theme: 'theme', accent: 'accent', font: 'font', textsize: 'text_size', spacing: 'row_spacing', lastLight: 'last_light_theme' };
// S.a11y key → config.json key, with the range save_settings accepts
const COMFORT_KEYS = { letter: ['comfort_letter_spacing', 0, .15], word: ['comfort_word_spacing', 0, .3], line: ['comfort_line_height', 1.4, 2.2], width: ['comfort_line_width', 55, 120],
  rulerLines: ['comfort_ruler_lines', 1, 3], ruler: ['comfort_ruler'], bionic: ['comfort_bionic'], still: ['comfort_reduced_motion'],
  // Phase 5: the Editor page's switches and the hyperfocus nudge (0 = off, 45 or 60 minutes)
  zoneB: ['editor_html_zone'], spell: ['editor_spell_check'], homophones: ['editor_homophones'], nudge: ['focus_nudge_minutes', 0, 60] };
const SOUNDSCAPES = ['off', 'brown', 'pink', 'rain'];   // Phase 5: the focus sound (S.sound) is saved as comfort_soundscape / _volume
const isDark = () => DARK_THEMES.includes(READER.theme);
const ok = (list, v) => list.some(([k]) => k === v);
function applyReader() {
  const b = document.body.dataset;
  b.theme = READER.theme; b.dark = String(isDark()); b.accent = READER.accent; b.font = READER.font; b.textsize = READER.textsize; b.spacing = READER.spacing;
}
// The old app's "dark" / "light" / "system" read as obsidian / cream / obsidian, as config.py upgrades them
function readerFromConfig(c) {
  const th = { dark: 'obsidian', system: 'obsidian', light: 'cream' }[c.theme] || c.theme;
  if (ok(THEMES, th)) READER.theme = th;
  if (ok(ACCENTS, c.accent)) READER.accent = c.accent;
  if (ok(FONTS, c.font)) READER.font = c.font;
  if (ok(TEXT_SIZES, c.text_size)) READER.textsize = c.text_size;
  if (ok(SPACINGS, c.row_spacing)) READER.spacing = c.row_spacing;
  if (ok(THEMES, c.last_light_theme) && !DARK_THEMES.includes(c.last_light_theme)) READER.lastLight = c.last_light_theme;
  Object.entries(COMFORT_KEYS).forEach(([k, [key, lo, hi]]) => { const v = c[key];
    if (lo === undefined ? typeof v === 'boolean' : typeof v === 'number' && v >= lo && v <= hi) S.a11y[k] = v; });
  if (S.a11y.width === 95) S.a11y.width = 100;   // QC 89: the old "Full" (95) was the narrower centred column; it is Wide now
  if (SOUNDSCAPES.includes(c.comfort_soundscape)) S.sound.kind = c.comfort_soundscape === 'off' ? null : c.comfort_soundscape;   // Phase 5
  if (typeof c.comfort_soundscape_volume === 'number' && c.comfort_soundscape_volume >= 0 && c.comfort_soundscape_volume <= 100) S.sound.vol = c.comfort_soundscape_volume;
  if (typeof readFromConfig === 'function') readFromConfig(c);   // Phase 6C: read aloud's engine, voices and speed (read-aloud.js)
}
// pywebview's bridge, once its calls are in place (they arrive with the pywebviewready event)
const api = () => window.pywebview?.api?.get_settings ? window.pywebview.api : null;
const within = (p, ms) => Promise.race([p, new Promise((_, no) => setTimeout(() => no(new Error('no answer in ' + ms + 'ms')), ms))]);
const DEV_KEY = 'neurovault-reader';   // opened in a browser (dev only): the same keys, kept in localStorage
async function loadReader() {
  try {
    if (api()) readerFromConfig(await within(api().get_settings(), 2000) || {});
    else readerFromConfig(JSON.parse(localStorage.getItem(DEV_KEY) || '{}'));
  } catch (e) { console.warn('Reader settings not loaded', e); }
  applyReader();
}
function saveSettings(patch) {
  try {
    if (api()) api().save_settings(patch).then(r => { if (r?.rejected) console.warn('Settings not saved', r.rejected); });
    else localStorage.setItem(DEV_KEY, JSON.stringify({ ...JSON.parse(localStorage.getItem(DEV_KEY) || '{}'), ...patch }));
  } catch (e) { console.warn('Settings not saved', e); }
}
function setReader(k, v) {
  READER[k] = v; const patch = { [READER_KEYS[k]]: v };
  if (k === 'theme' && !DARK_THEMES.includes(v)) { READER.lastLight = v; patch.last_light_theme = v; }
  applyReader(); saveSettings(patch);
}
// A comfort option: set it in S.a11y and save it (ranges and switches alike)
function setComfort(k, v) { S.a11y[k] = v; if (COMFORT_KEYS[k]) saveSettings({ [COMFORT_KEYS[k][0]]: v }); }
// Phase 5: the focus sound, { kind } and / or { vol }, saved as it changes
function setSoundscape(patch) {
  if ('kind' in patch) saveSettings({ comfort_soundscape: patch.kind || 'off' });
  if ('vol' in patch) { S.sound.vol = patch.vol; saveSettings({ comfort_soundscape_volume: patch.vol }); }
}

/* =====================================================================
   VIEW STATE — what the window shows. These were the mockup's data switches; its design switches are baked in.
   ===================================================================== */
const UI = { view: 'notes', state: 'ready', tpage: 'session', tstate: 'running', widgets: 'none', zen: 'off', inspector: 'shown' };
// state: ready | loading | saving | error | parser | offline · tstate: idle | running | stopwatch | checkin | pausepick | paused | overtime | rate
// widgets: none | timer | nudge (the quick timer and the hyperfocus nudge; sticky notes and desktop pins come later)
function setUI(k, v) { UI[k] = v; if (k === 'inspector') document.body.dataset.inspector = v; renderAll(); }

/* =====================================================================
   APP STATE
   ===================================================================== */
let D = sample('typical');
const S = { noteId: D.notes[0]?.id, hist: [], histIx: -1, mode: 'wysiwyg', tab: 'outline', taskFilter: 'All',
  range: 'All', type: 'All', search: '', project: 'All', menu: false, modal: null, toast: null, status: 'System ready', focus: null };
// R6: file explorer, settings and window state
Object.assign(S, { side: true, open: new Set(), sort: 'name-asc', sortMenu: false, sel: null, rename: null, renameErr: '', ctx: null, drag: null,
  setSec: 'appearance', max: false, moveItem: null, moveQ: '', delItem: null, scrollTo: null });
// R7: tabs, trail, reader comfort (S.a11y), the quick timer and the editor's pickers
Object.assign(S, { tabs: [], activeTab: null, tabSeq: 0, tabDrag: null, trail: [], edPop: null, gridHover: [0, 0],
  a11y: { letter: 0, word: 0, line: 1.85, width: 100, ruler: false, rulerLines: 2, bionic: false, still: false, zoneB: true, spell: true, homophones: true, nudge: 60, history: 5 },
  qt: null, qtDur: 25, sound: { kind: null, vol: 40 }, rulerY: 240, pal: { q: '', ix: 0 } });
// Swaps the whole vault for one of the mockup's samples (the check uses the long-names and empty ones)
function loadSample(kind) {
  D = sample(kind); S.noteId = D.notes[0]?.id; S.hist = S.noteId ? [S.noteId] : []; S.histIx = S.hist.length - 1; T.projectId = null; T.projErr = ''; seedTimer(UI.tstate);
  S.open = new Set(defaultOpen()); S.sel = null; S.rename = null; S.ctx = null; S.tabs = defaultTabs(kind); S.activeTab = S.tabs[0]?.id || null; S.offTab = null; S.split = null; seedTrail();
  VAULT.live = false;   // Phase 2: a sample vault never writes to the backend
}

const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
// Not built yet: shown in its final place, dimmed, with a tooltip. actions.js ignores clicks on [data-soon].
const soon = label => `aria-disabled="true" data-soon title="${esc(label)} · Coming soon"`;
const note = () => D.notes.find(n => n.id === S.noteId) || D.notes[0];
const slug = t => (t || 'Untitled').trim().replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '');
/* ---- R6: folders, file explorer, move dialog, settings dialog, window bar ---- */
const SORTS = [['name-asc', 'File name (A to Z)'], ['name-desc', 'File name (Z to A)'], ['mod-desc', 'Modified time (new to old)'], ['mod-asc', 'Modified time (old to new)'], ['created-desc', 'Created time (new to old)'], ['created-asc', 'Created time (old to new)']];
const BAD_NAME = /[\\/:*?"<>|]/;
const folderById = id => D.folders.find(f => f.id === id);
function ancestors(id) { const out = []; while (id) { out.unshift(id); id = folderById(id)?.parent ?? null; } return out; }   // [project, …, folder]
const rootProject = id => proj(ancestors(id)[0]);
const folderName = id => folderById(id)?.name ?? proj(id)?.name ?? '';
const folderPath = id => ancestors(id).map(folderName);
const notePath = n => n.path || `vault/${folderPath(n.folder).join('/')}/${slug(n.title)}.md`;   // Build V: the real file once it's written
function syncCategories() { D.notes.forEach(n => { const p = rootProject(n.folder); if (p) n.category = p.name; }); }
function defaultOpen() { const n = D.notes[0]; return n ? ancestors(n.folder) : []; }
const byName = (a, b) => a.localeCompare(b, 'en', { numeric: true, sensitivity: 'base' });

/* =====================================================================
   PHASE 2 · NOTES DATA — projects (read), folders, notes and their tags from window.pywebview.api (design/api-contract.md).
   Tasks are read too, for Ctrl+K, linked task lines and unlinking on delete; Phase 3 writes them.
   Ids carry a prefix (p- f- n- t-) so projects and folders share ancestors(); rawId() strips it for the API.
   Opened in a plain browser (no bridge) the app stays on the mockup's sample vault and nothing is sent anywhere.
   ===================================================================== */
const VAULT = { live: false };
const vaultRoot = () => VAULT.live && typeof VSTATE !== 'undefined' && !!VSTATE.path;   // Build V: a vault folder is open
// Build V: in a vault, Unsorted is the vault's top, so a folder made in it is a top-level folder: a project
const topOf = id => vaultRoot() && id && !isProj(id) && D.folders.find(f => f.id === id)?.parent === null && /^unsorted$/i.test(D.folders.find(f => f.id === id)?.name || '') ? null : id;   // true once the vault came from the backend; every write then goes back through it
const rawId = id => id == null || id === '' ? null : +String(id).replace(/^[a-z]+-/, '') || null;
const isProj = id => typeof id === 'string' && id.startsWith('p-');
const mapProject = p => ({ id: 'p-' + p.id, name: p.name, color: p.color_slot || 1 });
const mapFolder = f => ({ id: 'f-' + f.id, name: f.name, parent: f.parent_id ? 'f-' + f.parent_id : f.project_id ? 'p-' + f.project_id : null, mtime: f.updated_at, ctime: f.created_at });
const homeOf = r => r.folder_id ? 'f-' + r.folder_id : r.project_id ? 'p-' + r.project_id : null;
const mapNote = n => ({ id: 'n-' + n.id, title: n.title || '', md: n.content || '', tags: n.tags || [], folder: homeOf(n), mtime: n.updated_at, ctime: n.created_at,
  category: n.project_name || '', oldCategory: n.category || '', path: n.path || null });   // Build V: path = its file in the vault
const todayKey = () => { const d = new Date(), p = x => String(x).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`; };
const mapTask = t => ({ id: 't-' + t.id, noteId: t.note_id ? 'n-' + t.note_id : null, created: t.created_at || '', title: t.title,   /* Build M · R59: when it was made */ priority: t.priority, due: t.due_date && t.due_date <= todayKey() ? 'Today' : 'Upcoming',
  done: !!t.completed, energy: t.energy || 'medium', steps: t.steps?.length ? t.steps.map(s => ({ id: s.id, t: s.text, m: s.minutes, done: !!s.done })) : undefined,
  project: t.project_id ? 'p-' + t.project_id : null, dueDate: t.due_date ? t.due_date.slice(0, 10) : null });   // Phase 3: the task's own project (a task needn't have a note); Build I: its due date
/* Build N · v0.1.1 (QC 90): a failure in plain words, never Python's or the browser's own text. The same pattern and sentences
   as errors.py; the technical detail goes to the console and the app log. plainMsg(text) leaves plain text as it is. */
const RAW_ERR = /urlopen error|\[Errno \d+\]|Errno \d+|\[WinError \d+\]|Traceback|_ssl\b|\bSSL:|CERTIFICATE_VERIFY|getaddrinfo|HTTP Error \d{3}|<[a-z_.]+ (?:error|object)|\b[A-Z][A-Za-z]*(?:Error|Exception)\b(?::|\()|Unexpected error:|is not a function|is not defined|Cannot read propert|undefined \(reading/i;
const ERR_SAY = {
  cert: "NeuroVault couldn't check the site's security certificate, so nothing was downloaded. This happens on some work or school networks, and when the PC's date and time are wrong: check the clock, or try another network.",
  offline: "NeuroVault couldn't reach the internet. Check that you're online, then try again.",
  cut: 'The connection was cut off. Try again in a moment.',
  refused: "The site didn't answer. Check that you're online, then try again.",
  slow: 'The site took too long to answer. Check your connection, then try again.',
  full: 'The disk is full. Free some space, then try again.',
  denied: "Windows didn't let NeuroVault use that file or folder. Close any program that has it open, then try again.",
  gone: "A file NeuroVault needed isn't there any more.",
  generic: 'Something went wrong. Try again; if it keeps happening, the details are in neurovault.log.' };
const looksRaw = t => RAW_ERR.test(String(t ?? ''));
function plainMsg(text, what) {
  const t = String(text ?? ''); if (!t.trim()) return what || t;   // nothing to say stays nothing
  if (!looksRaw(t)) return what ? `${what} ${t}` : t;
  const u = t.toUpperCase(), code = +(t.match(/HTTP Error (\d{3})/i)?.[1] || 0);
  const s = /CERTIFICATE|SSL.*VERIFY/.test(u) ? ERR_SAY.cert
    : /GETADDRINFO|NAME OR SERVICE|11001|NETWORK IS UNREACHABLE|NO ROUTE|FAILED TO FETCH/.test(u) ? ERR_SAY.offline
    : /TIMED OUT|TIMEOUT|10060/.test(u) ? ERR_SAY.slow
    : code === 401 || code === 403 ? `The site refused access (${code}). If it needs a key, check the key; otherwise try again later.`
    : code === 404 ? "The file isn't on the site any more (404). NeuroVault may need an update."
    : code === 429 ? 'The site says too many requests for now (429). Wait a minute, then try again.'
    : code >= 500 ? `The site had a problem on its side (${code}). Try again later.`
    : /NO SPACE|ERRNO 28|DISK.*FULL|QUOTAEXCEEDED/.test(u) ? ERR_SAY.full
    : /PERMISSION DENIED|ERRNO 13|WINERROR 5\]|WINERROR 32|ACCESS IS DENIED/.test(u) ? ERR_SAY.denied
    : /NO SUCH FILE|ERRNO 2\]|CANNOT FIND THE/.test(u) ? ERR_SAY.gone
    : /CONNECTION REFUSED|10061|ACTIVELY REFUSED/.test(u) ? ERR_SAY.refused
    : /CONNECTION RESET|10054|REMOTE END CLOSED/.test(u) ? ERR_SAY.cut
    : ERR_SAY.generic;
  { console.warn('raw message replaced:', t.slice(0, 400)); if (typeof log95 === 'function') log95('warn', 'raw message replaced', t.slice(0, 400)); }
  return what ? `${what} ${s}` : s;
}
// An exception → its sentence: plainErr(e, "The photo couldn't be edited.")
const plainErr = (e, what) => plainMsg(e?.message || String(e ?? '') || 'Error:', what);
// One backend call: the result, or { status: 'error', message } when it fails or the bridge doesn't answer
const NV_WAIT = { voice_keep: 120000 };   // Fix A (QC 4 · 35): a long recording takes a while to encode and write; 8 s called it failed
async function nv(name, ...args) {
  try { const r = await within(api()[name](...args), NV_WAIT[name] || 8000); if (r && typeof r === 'object' && typeof r.message === 'string' && looksRaw(r.message)) r.message = plainMsg(r.message);   // QC 90: the safety net
    return r ?? { status: 'error', message: 'No answer from the app.' }; }
  catch (e) { console.warn(name, e); return { status: 'error', message: "Couldn't reach the app's database.", offline: true }; }
}
const failed = r => !r || r.status === 'error';
// Loads the vault. Returns false (and keeps the sample vault) when there's no bridge or it fails.
async function loadVault() {
  if (!api()) return false;
  try {
    const [projects, folders, notes, tasks, cfg] = await within(Promise.all([api().list_projects(), api().list_folders(), api().list_notes(null, null, true), api().list_tasks(), api().get_settings()]), 8000);
    if (![projects, folders, notes, tasks].every(Array.isArray)) throw new Error('unexpected answer');
    D.projects = projects.map(mapProject); D.folders = folders.map(mapFolder); D.notes = notes.map(mapNote); D.tasks = tasks.map(mapTask);
    D.files = [];   // HTML/PDF files come with the vault on disk
    if (!CAPTURE.live) { D.stickies = []; D.inbox = []; }   // Phase 6A: loadCapture() fills them (capture.js) and a reload keeps them
    if (SORTS.some(([k]) => k === cfg?.tree_sort)) S.sort = cfg.tree_sort;
    VAULT.live = true;
    primeLineTasks();   // Phase 3: remember each note's "- [ ]" lines, so a line edited later renames its task
    return true;
  } catch (e) { console.warn('Vault not loaded', e); return false; }
}
// After a load: open the most recently edited note with its folders expanded, as Phase 1 did for the sample
function resetVaultView() {
  S.noteId = D.notes[0]?.id ?? null; S.hist = S.noteId ? [S.noteId] : []; S.histIx = S.hist.length - 1;
  S.open = new Set(defaultOpen()); S.sel = null; S.rename = null; S.ctx = null; S.split = null; S.offTab = null;
  S.tabs = defaultTabs('typical'); S.activeTab = S.tabs[0]?.id || null; seedTrail();
}

/* =====================================================================
   PHASE 3 · TASKS DATA — the Tasks board and the tasks in notes write back through window.pywebview.api
   (design/api-contract.md, Tasks). loadVault() above reads D.tasks; this section adds tasks, ticks them, cycles their
   energy and keeps their steps. A note's "- [ ]" lines are tasks too: made, renamed, ticked and removed as the note saves.
   On the sample vault (a browser, ?check=1) every change stays in memory, as in the mockup.
   ===================================================================== */
const taskById = id => D.tasks.find(t => t.id === id || t.tmp === id);   // a new task keeps answering to the id the page drew it with
// A task's database id, once its first save is back (a click can come before it)
const taskRaw = async t => { if (t.saving) await t.saving; return rawId(t.id); };
const taskNote = t => t?.noteId ? D.notes.find(n => n.id === t.noteId) : null;
// The task's project: its own, else its note's (the sample vault's tasks only have a note)
const taskProject = t => proj(t.project) || (n => n ? rootProject(n.folder) : null)(taskNote(t)) || null;
const taskProjectName = t => taskProject(t)?.name || taskNote(t)?.category || '';
// One task write: through the bridge on a real vault, nothing to send on the sample one
const taskCall = (name, ...args) => VAULT.live ? nv(name, ...args) : Promise.resolve({ status: 'success' });
function taskFailed(r, undo) { if (!failed(r)) return false; undo?.(); toast(r.message || "Couldn't save the task."); return true; }
const redrawNote = t => { const n = taskNote(t); if (n) n.html = null; };   // the note's {{tasks}} block draws it again

// Quick add. The note's project wins; a note without a {{tasks}} line gets one at the end, so the task shows in it
async function addTask({ title, project, noteId, priority, energy, description = '', due = todayKey() }) {   // Phase 6A: description (a sticky's other lines); Build I: due ("YYYY-MM-DD", or null for Later)
  const n = D.notes.find(x => x.id === noteId) || null, pj = (n && rootProject(n.folder)) || proj(project) || null;
  const t = { id: 't-new-' + Date.now(), noteId: n?.id || null, title, priority, due: due && due <= todayKey() ? 'Today' : 'Upcoming', dueDate: due || null, done: false, energy, project: pj?.id || null };   // Build I: due
  D.tasks.unshift(t);
  t.created = new Date().toISOString();   // Build M · R59: with Only in Tasks, the task keeps its link to the note but never goes into its text
  if (n && !(typeof tkoOn === 'function' && tkoOn()) && !/^\{\{tasks\}\}[ \t]*\r?$/m.test(n.md)) { syncDoc(n); n.md = n.md.replace(/\s+$/, '') + (n.md.trim() ? '\n\n' : '') + '{{tasks}}'; n.dirty = true; }
  redrawNote(t);
  const r = await (t.saving = taskCall('save_task', null, title, description, priority, due || null, rawId(pj?.id), '', false, rawId(n?.id), energy)); t.saving = null;   // Build I: due
  if (taskFailed(r, () => { D.tasks = D.tasks.filter(x => x !== t); })) return null;
  if (VAULT.live) { t.tmp = t.id; t.id = 't-' + r.id; }
  if (n?.dirty) saveNote(n);
  return t;
}
// Done or not. A task that is a "- [ ]" line in its note ticks the line too, and the note saves
async function setTaskDone(t, done, fromLine) {
  if (!t || t.done === done) return;
  const n = taskNote(t), line = !fromLine && n && isLineTask(t, n);
  t.done = done; redrawNote(t); if (line) setLineDone(n, t, done);
  const r = await taskCall('update_task', await taskRaw(t), null, done);
  taskFailed(r, () => { t.done = !done; redrawNote(t); if (line) setLineDone(n, t, !done); });
}
// The energy badge cycles high → medium → low
async function cycleEnergy(t) {
  const order = ['high', 'medium', 'low'], was = t.energy || 'medium'; t.energy = order[(order.indexOf(was) + 1) % 3];
  const r = await taskCall('set_task_energy', await taskRaw(t), t.energy);
  taskFailed(r, () => { t.energy = was; });
}
// Steps: ticked one by one, added by hand (the 🪄 splitter's AI comes later), removed
async function setStepDone(t, i, done) {
  const s = t?.steps?.[i]; if (!s || s.done === done) return;
  s.done = done; redrawNote(t);
  const r = await taskCall('update_task_step', s.id, null, s.m ?? null, done);   // minutes sent back as they are: left off, they'd be cleared
  taskFailed(r, () => { s.done = !done; redrawNote(t); });
}
async function addStep(t, text, minutes) {
  const r = await taskCall('add_task_step', await taskRaw(t), text, minutes);
  if (taskFailed(r)) return false;
  (t.steps ||= []).push({ id: r.step?.id, t: r.step?.text ?? text, m: r.step ? r.step.minutes : minutes, done: false }); redrawNote(t);
  return true;
}
async function deleteStep(t, i) {
  const s = t?.steps?.[i]; if (!s) return;
  t.steps.splice(i, 1); if (!t.steps.length) t.steps = undefined; redrawNote(t);
  const r = await taskCall('delete_task_step', s.id);
  taskFailed(r, () => { (t.steps ||= []).splice(i, 0, s); redrawNote(t); });
}

/* ---- "- [ ]" lines in a note (outside code blocks) are tasks linked to it. When the note saves, syncLineTasks():
        a new line makes a task (Medium, medium energy, no due date); a line whose text changed renames its task, which
        keeps its energy and steps; a tick follows; a line removed deletes its task. The board's tick writes the line back.
        The {{tasks}} block lists the note's other tasks (added on the board), so no task shows twice ---- */
const LINE_TASK = /^[ \t]*[-*+][ \t]+\[([ xX])\][ \t]+(\S.*?)[ \t]*$/;
const unescMd = s => s.replace(/\\([\\`*_{}\[\]()#+\-.!|~<>&=])/g, '$1');   // NVMarkdown escapes these in plain text (escapeText's full list)
function mdTaskLines(md) {
  const out = []; let fence = null;
  String(md || '').split('\n').forEach((raw, line) => {
    const l = raw.replace(/\r$/, ''), f = /^[ \t]{0,3}(`{3,}|~{3,})/.exec(l);
    if (f) { if (!fence) fence = f[1]; else if (f[1][0] === fence[0] && f[1].length >= fence.length) fence = null; return; }
    if (fence) return;
    const m = LINE_TASK.exec(l); if (m) out.push({ title: unescMd(m[2]), done: m[1] !== ' ', line });
  });
  return out;
}
const lineTasksOf = n => n._ltMd === n.md ? n._lt : (n._ltMd = n.md, n._lt = mdTaskLines(n.md));
const isLineTask = (t, n) => !!n && t.noteId === n.id && lineTasksOf(n).some(l => l.title === t.title);
function primeLineTasks() { D.notes.forEach(n => { n.lineBase = mdTaskLines(n.md).map(l => l.title); }); }
// The board ticked a line task: tick its line in the note's Markdown and save the note
function setLineDone(n, t, done) {
  syncDoc(n);
  const hit = mdTaskLines(n.md).find(l => l.title === t.title); if (!hit) return false;
  const ls = n.md.split('\n'); ls[hit.line] = ls[hit.line].replace(/\[[ xX]\]/, done ? '[x]' : '[ ]');
  n.md = ls.join('\n'); n.html = null; n.dirty = true;
  // Editor QC: the note open in the editor shows the tick at once (and saves it, not its old box)
  const box = [...(liveDoc(n)?.querySelectorAll('li') || [])].map(li => edBox(li)).find(b => b && unescMd(b.parentElement.closest('li').textContent.trim()) === t.title);
  if (box) { box.checked = done; box.toggleAttribute('checked', done); }
  EDH.delete(n.id);   // and Ctrl+Z in the note can't untick it behind the board's back (editor.js)
  saveNote(n);
  return true;
}
// A box ticked in the editor: its task follows at once (the note itself saves on its usual timer)
function lineTicked(n) {
  if (!n) return; syncDoc(n); n.html = null;
  lineTasksOf(n).forEach(l => { const t = D.tasks.find(x => x.noteId === n.id && x.title === l.title); if (t && t.done !== l.done) setTaskDone(t, l.done, true); });
}
// After each save of a note on a real vault; one at a time per note
function syncLineTasks(n) {
  if (!VAULT.live || !n) return Promise.resolve();
  return (n.lineSync = (n.lineSync || Promise.resolve()).then(() => reconcileLines(n)).catch(e => console.warn('Line tasks not synced', e)));
}
async function reconcileLines(n) {
  if (!D.notes.includes(n)) return;
  const lines = mdTaskLines(n.md), base = n.lineBase || [], free = D.tasks.filter(t => t.noteId === n.id), pj = rootProject(n.folder);
  const take = title => { const i = free.findIndex(t => t.title === title); return i < 0 ? null : free.splice(i, 1)[0]; };
  const pairs = lines.map(l => [l, take(l.title)]);
  // the tasks of lines that were there at the last save and aren't now: renamed (paired in order) or removed
  const gone = free.filter(t => base.includes(t.title)).sort((a, b) => base.indexOf(a.title) - base.indexOf(b.title));
  const jobs = [];
  for (const [l, found] of pairs) {
    const t = found || gone.shift();
    if (!t) {
      const nt = { id: 't-new-' + Date.now() + '-' + l.line, noteId: n.id, title: l.title, priority: 'Medium', due: 'Upcoming', dueDate: null, done: l.done, energy: 'medium', project: pj?.id || null };   // Build I: dueDate
      D.tasks.unshift(nt);
      jobs.push(nt.saving = taskCall('save_task', null, l.title, '', 'Medium', null, rawId(pj?.id), '', l.done, rawId(n.id), 'medium')
        .then(r => { nt.saving = null; if (failed(r)) D.tasks = D.tasks.filter(x => x !== nt); else { nt.tmp = nt.id; nt.id = 't-' + r.id; } return r; }));
      continue;
    }
    if (t.title === l.title && t.done === l.done) continue;
    const was = { title: t.title, done: t.done }; t.title = l.title; t.done = l.done;
    jobs.push(taskRaw(t).then(id => taskCall('update_task', id, was.title === l.title ? null : l.title, l.done)).then(r => { if (failed(r)) Object.assign(t, was); return r; }));
  }
  gone.forEach(t => { D.tasks = D.tasks.filter(x => x !== t);
    jobs.push(taskRaw(t).then(id => taskCall('delete_task', id)).then(r => { if (failed(r)) D.tasks.push(t); return r; })); });
  const bad = (await Promise.all(jobs)).find(failed);
  n.lineBase = lines.map(l => l.title);
  if (bad) status("A task in this note wasn't saved: " + (bad.message || 'the database said no.'));
  if (jobs.length && UI.view === 'tasks' && !document.activeElement?.closest?.('.doc')) renderAll();
}

/* =====================================================================
   BUILD I · TASKS PAGE DATA (mockup R35 "Today, Upcoming and Done", locked 2026-10-16) — due dates and Overdue,
   Delete with Undo. A task's due date is t.dueDate ("YYYY-MM-DD" or null for Later); t.due ('Today' | 'Upcoming')
   stays for the sidebar counts and the wrap-up. Delete sends the task to the database's bin (api.trash_task) and
   Undo brings it back (api.restore_task). A task that is a "- [ ]" line in its note takes its line with it, and
   Undo puts the line back where it was.
   ===================================================================== */
const dayKeyFrom = (n = 0) => { const d = new Date(); d.setDate(d.getDate() + n); const p = x => String(x).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`; };
// The sample vault's tasks only say Today or Upcoming: Today is today's date, Upcoming has no date
const taskDue = t => t.dueDate !== undefined ? t.dueDate : t.due === 'Today' ? todayKey() : null;
const dueGroup = t => { const d = taskDue(t), k = todayKey(); return !d ? 'later' : d < k ? 'overdue' : d === k ? 'today' : 'upcoming'; };
function dueText(d) {   // what the Due column says: Today, Tomorrow, Yesterday, a weekday this week, else "19 Oct"; Later with no date
  if (!d) return 'Later';
  const diff = Math.round((new Date(d + 'T12:00:00') - new Date(todayKey() + 'T12:00:00')) / 864e5), dt = new Date(d + 'T12:00:00');
  if (diff === 0) return 'Today'; if (diff === 1) return 'Tomorrow'; if (diff === -1) return 'Yesterday';
  if (diff > 1 && diff < 7) return dt.toLocaleDateString('en-GB', { weekday: 'short' });
  return dt.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) + (dt.getFullYear() !== new Date().getFullYear() ? ` '${String(dt.getFullYear()).slice(2)}` : '');
}
const dueLong = d => d ? new Date(d + 'T12:00:00').toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }) : 'No due date';
async function setTaskDue(t, date) {
  date = date || null; if (!t || taskDue(t) === date) return;
  const was = { dueDate: t.dueDate, due: t.due }; t.dueDate = date; t.due = date && date <= todayKey() ? 'Today' : 'Upcoming';
  const r = await taskCall('update_task', await taskRaw(t), null, null, date);
  taskFailed(r, () => Object.assign(t, was));
}
// Take a line task's "- [ ]" line out of its note (the note saves); returns where it was, for Undo
function cutTaskLine(n, t) {
  syncDoc(n);
  const hit = mdTaskLines(n.md).find(l => l.title === t.title); if (!hit) return null;
  const ls = n.md.split('\n'), text = ls.splice(hit.line, 1)[0];
  n.md = ls.join('\n'); n.html = null; n.dirty = true; EDH.delete(n.id);   // the note's Ctrl+Z history would still hold the line
  const i = (n.lineBase || []).indexOf(t.title); if (i >= 0) n.lineBase.splice(i, 1);   // so the next save doesn't look for its task
  saveNote(n);
  return { at: hit.line, text };
}
// Delete: off the board at once; returns what Undo needs, or null if the database said no (the task is put back)
async function trashTask(t) {
  const n = taskNote(t), at = D.tasks.indexOf(t); if (at < 0) return null;
  const line = n && isLineTask(t, n) ? cutTaskLine(n, t) : null;
  D.tasks.splice(at, 1); redrawNote(t);
  const u = { t, at, n, line, bin: null };
  if (!VAULT.live) return u;
  const r = await taskCall('trash_task', await taskRaw(t));
  if (taskFailed(r, () => { D.tasks.splice(Math.min(at, D.tasks.length), 0, t); if (line) putTaskLine(u); redrawNote(t); })) return null;
  u.bin = r.bin_id; return u;
}
function putTaskLine(u) {
  const n = u.n; if (!u.line || !D.notes.includes(n)) return;
  syncDoc(n); const ls = n.md.split('\n'); ls.splice(Math.min(u.line.at, ls.length), 0, u.line.text);
  n.md = ls.join('\n'); n.html = null; n.dirty = true; EDH.delete(n.id); (n.lineBase ||= []).push(u.t.title);
  saveNote(n);
}
// Undo: the task back in its place (on a real vault, as the database restored it), its line back in the note
async function restoreTask(u) {
  let t = u.t;
  if (VAULT.live) { const r = await nv('restore_task', u.bin); if (failed(r)) { toast(r.message || "Couldn't bring the task back."); return null; } t = Object.assign(mapTask(r.task), { tmp: u.t.tmp }); }
  D.tasks.splice(Math.min(u.at, D.tasks.length), 0, t);
  if (t.noteId) putTaskLine(u);
  redrawNote(t);
  return t;
}

/* =====================================================================
   PHASE 4 · TIMER DATA — projects (colour slots 1–6), sessions with their pauses and check-ins, and the timer
   settings, loaded through window.pywebview.api (design/api-contract.md). In a browser (dev) and in the ?check=1
   sweep the sample vault stays. Ids carry a prefix in the store ('p-12', 's-40'); idNum() strips it for the API.
   ===================================================================== */
const SESSION_LIMIT = 100000;   // every session, so Insights, the week and the streak count them all (History shows the latest 200)
const idNum = id => id == null ? null : +String(id).replace(/^[a-z]+-/, '') || null;
const projFromApi = p => ({ id: 'p-' + p.id, name: p.name, color: p.color_slot || 1 });
const sessionFromApi = s => ({ ...s, id: 's-' + s.id, project_id: s.project_id != null ? 'p-' + s.project_id : null,
  project_name: s.project_name || 'No project', color: s.color || 0, pauses: s.pauses || [], milestones: s.milestones || [] });
// D.tset key → config.json key (volume is 0–100 here, 0–1 there)
const TSET_KEYS = { five_min: 'notify_five_min_warning', sound: 'notify_sound_on_complete', desktop: 'notify_desktop', taskbar: 'notify_taskbar_flash',
  overtime_repeat: 'notify_overtime_repeat', sound_name: 'notify_sound', volume: 'notify_volume', interval: 'notify_overtime_interval_min',
  custom_sound: 'notify_custom_sound_path', vault: 'obsidian_vault_path', away: 'timer_away_answer' };   // away: Build L, the timer's question after NeuroVault was closed
function tsetFromConfig(c) {
  const t = { ...TSET_DEFAULTS, vaultStatus: null };
  Object.entries(TSET_KEYS).forEach(([k, key]) => { if (c[key] !== undefined && c[key] !== null) t[k] = c[key]; });
  t.volume = Math.round((typeof c.notify_volume === 'number' ? c.notify_volume : .6) * 100);
  t.custom_sound = c.notify_custom_sound_path || ''; t.vault = c.obsidian_vault_path || ''; t.db = c.db_path || ''; t.version = c.app_version || '';
  return t;
}
// One timer setting: in D.tset and in config.json
function setTset(k, v) { D.tset[k] = v; if (TSET_KEYS[k]) saveSettings({ [TSET_KEYS[k]]: k === 'volume' ? v / 100 : v }); }
async function loadTimerData() {
  const a = api(); if (!a) return false;
  try {
    const [ps, ss, cfg, run] = await within(Promise.all([a.list_projects(), a.list_sessions(SESSION_LIMIT), a.get_settings(), a.get_running_session()]), 8000);
    D.projects = (ps || []).map(projFromApi); D.sessions = (ss || []).map(sessionFromApi); D.tset = tsetFromConfig(cfg || {}); D.live = true;
    recoverRunning(run);   // render-timer.js
    return true;
  } catch (e) { console.warn('Timer data not loaded', e); return false; }
}
