/* =====================================================================
   BUILD J · THE DICTIONARY AND THESAURUS, WITH YOUR OWN WORDS (mockup R37, locked 2026-10-16)
   · The Dictionary page opens as a tab: matches on the left, the word on the right. It opens from the rail button,
     Ctrl+K (a Define group, and "> Open dictionary"), the word popover's "Open in dictionary" and "Look up" on a
     note's right-click menu.
   · Search is as you type, fuzzy and tolerant of misspellings ("You typed…"). Each word has its syllables, meanings by
     part of speech with examples, similar words, opposites and sound-alikes. Recent lookups are kept (config.json).
   · Your own words (add, edit, delete: word, part of speech, definition, example, tags) are marked "Yours" and searched
     with the rest. They live in .neurovault/glossary.json in the vault (dictionary.py says how it is written and read back).
   · The word popover (the full one): meaning, similar, opposite, read aloud, Open in dictionary, and Add.
   · Read aloud uses Phase 6C's engine; Settings → Voice says whether it reads the word only, or the word and its meanings.
   · Data: Open English WordNet (CC BY 4.0), downloaded once after the ask (file, source, size), then offline.
   In the app every call goes to dictionary.py through the bridge. In a plain browser and in ?check=1 the mockup's
   sample words answer instead (DJ_LOCAL, same shapes), and nothing is saved.
   Loaded before actions.js; it wraps viewFn, crumbText, renderSidebar, renderRail, renderStatus, renderModal,
   renderContextMenu, palResults and afterRender, and has its own listeners.
   ===================================================================== */
'use strict';
Object.assign(ICON, {
  book: '<path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H19a1 1 0 0 1 1 1v18a1 1 0 0 1-1 1H6.5a1 1 0 0 1 0-5H20"/><path d="m8 13 4-7 4 7"/><path d="M9.1 11h5.7"/>',
  user: '<circle cx="12" cy="8" r="5"/><path d="M20 21a8 8 0 0 0-16 0"/>' });
ICON.dict = ICON.book;
VIEW_LABEL.dict = 'Dictionary'; VIEW_ICON.dict = 'book';
const DJ_CHECK = new URLSearchParams(location.search).get('check') === '1';
const DJ = { st: null, q: '', scope: 'all', sel: null, selEntry: null, res: null, form: null, confirm: null, later: false, reading: null,
  recent: [], mine: [], rows: {}, seq: 0, readMode: 'meanings', poll: 0, more: new Set(), loaded: false, warm: false, pal: null };
const djLive = () => !!api() && !DJ_CHECK;

/* ---- The sample (a plain browser and ?check=1): the mockup's words, answering in dictionary.py's shapes ---- */
const DJ_WN = {
  consolidate: ['con·so·li·date', [['verb', 'Combine several things into one stronger, simpler whole.', 'We consolidated three to-do lists into one.'], ['verb', 'Make something firmer or more secure.', 'Regular practice consolidates what you learn.']], ['combine', 'unify', 'merge', 'strengthen'], ['split', 'divide', 'weaken']],
  consolation: ['con·so·la·tion', [['noun', 'Comfort for someone who is sad or disappointed.', 'Her kind note was a real consolation.']], ['comfort', 'relief', 'support'], ['distress']],
  combine: ['com·bine', [['verb', 'Join or mix two or more things together.', 'Combine the notes into one page.'], ['noun', 'A large farm machine that cuts and threshes grain.', 'The combine crossed the field.']], ['join', 'merge', 'mix', 'unite'], ['separate', 'split']],
  merge: ['merge', [['verb', 'Join two things so they become one.', 'Merge the two branches before Friday.']], ['combine', 'join', 'fuse'], ['split', 'separate']],
  roadmap: ['road·map', [['noun', 'A plan that shows the steps and dates toward a goal.', 'The Q3 roadmap lists four milestones.'], ['noun', 'A map that shows the roads of an area.', '']], ['plan', 'schedule', 'blueprint', 'outline'], []],
  milestone: ['mi·les·tone', [['noun', 'An important point or event in a project.', 'Shipping the beta is our next milestone.'], ['noun', 'A stone by a road that shows the distance in miles.', '']], ['landmark', 'checkpoint', 'stage'], []],
  draft: ['draft', [['noun', 'An early version that will change.', 'Send me the first draft by Friday.'], ['verb', 'Write the first version of something.', 'I drafted the overview this morning.']], ['outline', 'sketch', 'first version'], ['final version']],
  draught: ['draught', [['noun', 'A flow of cold air into a room.', 'Close the window, there’s a draught.']], ['breeze', 'current'], []],
  freeze: ['freeze', [['noun', 'A time when no more changes are allowed.', 'The code freeze starts on Monday.'], ['verb', 'Turn to ice, or become very cold.', 'The pond froze overnight.']], ['halt', 'stop', 'lock'], ['thaw', 'release']],
  conflict: ['con·flict', [['noun', 'A clash between two versions or ideas.', 'Two devices made a sync conflict.'], ['verb', 'Disagree, or not fit together.', 'The two plans conflict on dates.']], ['clash', 'disagreement', 'collision'], ['agreement', 'harmony']],
  resolution: ['re·so·lu·tion', [['noun', 'The way a problem is settled.', 'Conflict resolution keeps both versions.'], ['noun', 'How sharp an image or screen is.', 'A high-resolution screenshot.'], ['noun', 'A firm decision to do something.', 'A new year’s resolution.']], ['answer', 'fix', 'solution', 'decision'], []],
  finalise: ['fi·na·lise', [['verb', 'Finish the last details of something.', 'Finalise the schema by Tuesday.']], ['complete', 'settle', 'wrap up', 'conclude'], ['begin', 'start']],
  reference: ['re·fe·rence', [['verb', 'Mention or point to something.', 'Reference the API notes in the roadmap.'], ['noun', 'A mention of a source.', 'Add a reference to the paper.']], ['cite', 'mention', 'link to'], []],
  affect: ['af·fect', [['verb', 'Change or influence something.', 'Noise affects my focus.']], ['influence', 'change', 'impact'], []],
  effect: ['ef·fect', [['noun', 'A result or change caused by something.', 'The new theme had a calming effect.'], ['verb', 'Make something happen.', 'Effect a change in the plan.']], ['result', 'outcome', 'impact'], ['cause']],
  quiet: ['quiet', [['adjective', 'Making little or no noise.', 'A quiet room helps me read.']], ['silent', 'calm', 'hushed'], ['loud', 'noisy']],
  quite: ['quite', [['adverb', 'Fairly, or to a certain amount.', 'The page feels quite calm.'], ['adverb', 'Completely.', 'I’m not quite finished.']], ['fairly', 'rather', 'completely'], []],
  receive: ['re·ceive', [['verb', 'Get something that is given or sent to you.', 'Beta readers will receive the build on Friday.']], ['get', 'accept', 'collect'], ['send', 'give']],
  separate: ['se·pa·rate', [['adjective', 'Apart, not joined or together.', 'Keep the two notes separate.'], ['verb', 'Move things apart.', 'Separate the tasks from the notes.']], ['apart', 'divide', 'split'], ['join', 'combine']],
  definitely: ['de·fi·nite·ly', [['adverb', 'Without any doubt.', 'I’ll definitely finish it today.']], ['certainly', 'surely'], ['maybe']],
  focus: ['fo·cus', [['noun', 'The thing you give your attention to.', 'My focus today is the pipeline.'], ['verb', 'Give all your attention to one thing.', 'Focus on one task at a time.']], ['attention', 'concentrate', 'centre'], ['distraction']],
  pipeline: ['pipe·line', [['noun', 'A long pipe that carries oil, gas or water a long way.', 'A gas pipeline runs under the sea.'], ['noun', 'In the pipeline: being planned or worked on.', 'Two new features are in the pipeline.']], ['channel', 'conduit'], []],
  accept: ['ac·cept', [['verb', 'Say yes to something offered.', 'Accept the meeting invite.']], ['agree to', 'take', 'receive'], ['refuse', 'reject']],
  except: ['ex·cept', [['preposition', 'Apart from; not including.', 'Every task except the last is done.']], ['apart from', 'but'], []],
  whole: ['whole', [['adjective', 'All of something, with nothing missing.', 'I read the whole chapter.']], ['entire', 'complete', 'full'], ['part', 'partial']],
  hole: ['hole', [['noun', 'An empty space or gap in something.', 'There’s a hole in the plan.']], ['gap', 'opening'], []],
  course: ['course', [['noun', 'A series of lessons in one subject.', 'The data engineering course runs for ten weeks.']], ['class', 'programme'], []],
};
const DJ_SOUNDS = { their: ['there', 'they’re'], there: ['their', 'they’re'], draft: ['draught'], draught: ['draft'], affect: ['effect'], effect: ['affect'], accept: ['except'], except: ['accept'], quiet: ['quite'], quite: ['quiet'], whole: ['hole'], hole: ['whole'], freeze: ['frees', 'frieze'] };
const DJ_MY0 = [
  { word: 'CRDT', pos: 'noun', definition: 'Conflict-free replicated data type: data two devices can edit offline and merge later without losing changes.', example: 'Should offline conflict resolution favour local snapshots or CRDT merges?', tags: ['sync', 'engineering'], added: '2026-10-02' },
  { word: 'PKCE', pos: 'noun', definition: 'Said “pixie”: an extra check in OAuth2 sign-in, so a stolen sign-in code is useless to anyone else.', example: 'Audit OAuth2 PKCE refresh token rotation.', tags: ['auth', 'engineering'], added: '2026-10-09' },
  { word: 'ETL', pos: 'noun', definition: 'Extract, transform, load: copy data out of a source, clean it up, then load it into a warehouse.', example: 'The ETL job runs every night at 2am.', tags: ['data-engineering', 'course'], added: '2026-09-21' },
  { word: 'idempotent', pos: 'adjective', definition: 'Safe to run more than once: the second run changes nothing.', example: 'Make the load step idempotent so a retry can’t double the rows.', tags: ['data-engineering', 'course'], added: '2026-09-24' },
  { word: 'pipeline', pos: 'noun', definition: 'In my course: a chain of data steps, where each step’s output feeds the next.', example: 'Finished the pipeline exercise.', tags: ['data-engineering', 'course'], added: '2026-09-18' },
];
const DJ_SAMPLE = { id: 'oewn-2025', name: 'Open English WordNet 2025', short: 'WordNet', version: '2025', file: 'english-wordnet-2025.xml.gz', url: 'https://github.com/globalwordnet/english-wordnet/releases/download/2025-edition/english-wordnet-2025.xml.gz',
  bytes: 11363503, disk_mb: 34, words: 'about 127,000', licence: 'CC BY 4.0', licence_url: 'https://creativecommons.org/licenses/by/4.0/', source: 'en-word.net', source_url: 'https://en-word.net/',
  attribution: 'Open English WordNet 2025 by the Open English WordNet team (en-word.net), CC BY 4.0. Based on Princeton WordNet: WordNet 3.1 Copyright 2011 by Princeton University. All rights reserved.' };
const DJL = { state: 'ready', mine: null, done: 0, fraction: 0, offline: false, failed: '', timer: 0 };
const djNorm = s => String(s || '').toLowerCase().replace(/’/g, "'").replace(/_/g, ' ').replace(/[^\p{L}' -]/gu, '').replace(/\s+/g, ' ').trim();
function djLev(a, b) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]); for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) { d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1); }
  return d[a.length][b.length];
}
const djSkel = w => { const s = w.replace(/ph/g, 'f').replace(/ck/g, 'k').replace(/c(?![eiy])/g, 'k').replace(/(.)\1+/g, '$1'); return s[0] + s.slice(1).replace(/[aeiouyhw' -]/g, ''); };
const DJ_SMALL = new Set('a an the and or but of to in on at by for with from as is are was were be been it its this that these those i you he she we they not no yes do did does have has had will would can could'.split(' '));   // Fix A: the sample's small words (dictionary.py has the full list)
const djMine0 = () => DJL.mine ||=DJ_MY0.map(w => ({ ...w, key: djNorm(w.word), tags: [...w.tags], updated: w.added }));
const djWnOn = () => DJL.state === 'ready';
const djStubs = () => djStubs.v ||= [...new Set(Object.values(DJ_WN).flatMap(e => [...e[2], ...e[3]]).concat(Object.values(DJ_SOUNDS).flat()).map(djNorm))].filter(k => !DJ_WN[k]);
function djLocalEntry(k) {
  const mine = djMine0().find(w => w.key === k) || null, e = djWnOn() ? DJ_WN[k] : null, stub = djWnOn() && !e && djStubs().includes(k);
  if (!mine && !e && !stub && !DJ_SOUNDS[k]) return null;   // a small word WordNet leaves out still lists what it's mixed up with
  const senses = e ? e[1].map(([pos, def, ex]) => ({ pos, def, examples: ex ? [ex] : [] })) : stub ? [{ pos: 'noun', def: 'In the full dictionary (the sample has a few words in full).', examples: [] }] : [];
  return { key: k, word: mine?.word || k, syl: e ? e[0] : '', pos: [...new Set([...(mine ? [mine.pos] : []), ...senses.map(s => s.pos)])], senses, syn: e ? e[2] : [], ant: e ? e[3] : [],
    sounds: (DJ_SOUNDS[k] || []).map(w => ({ word: w, def: DJ_WN[w]?.[1][0][1] || '' })), mine, wordnet: !!(e || stub) };
}
const djRowOf = (e, k) => e && { key: k, word: e.word, pos: e.pos, def: e.mine?.definition || e.senses[0]?.def || '', mine: !!e.mine };
function djLocalSearch(q0, scope = 'all') {
  const q = djNorm(q0), mine = djMine0().map(w => w.key), pool = scope === 'mine' ? mine : [...new Set([...(djWnOn() ? [...Object.keys(DJ_WN), ...djStubs()] : []), ...mine])];
  const res = { status: 'success', q, exact: null, prefix: [], close: [], in_defs: [], via: null, scope, shown: null, guessed: false };
  if (!q) return res;
  const row = k => djRowOf(djLocalEntry(k), k);
  const lim = q.length > 6 ? 2 : 1, near = k => q.length >= 3 && (djLev(k, q) <= lim || (q.length >= 4 && djSkel(k) === djSkel(q)));
  let exact = pool.includes(q) ? q : null;
  if (!exact && djWnOn() && scope !== 'mine') { const base = ['ed', 'd', 's', 'es', 'ing'].map(s => q.endsWith(s) ? q.slice(0, -s.length) : null).filter(Boolean).flatMap(b => [b, b + 'e']).find(b => DJ_WN[b]); if (base) { exact = base; res.via = q0.trim(); } }
  const senses = k => DJ_WN[k]?.[1].length || 0, prefix = pool.filter(k => k !== q && k !== exact && k.startsWith(q)).sort((a, b) => senses(b) - senses(a) || a.length - b.length || a.localeCompare(b));   // as dictionary.py: most meanings, then the shorter word
  const close = pool.filter(k => k !== exact && !k.startsWith(q) && near(k)).sort((a, b) => djLev(a, q) - djLev(b, q));
  const taken = new Set([exact, ...prefix, ...close]);
  const inDefs = q.length >= 3 ? pool.filter(k => !taken.has(k) && (DJ_WN[k]?.[1].some(s => s[1].toLowerCase().includes(q)) || djMine0().find(w => w.key === k)?.definition.toLowerCase().includes(q))).slice(0, 6) : [];
  Object.assign(res, { exact: exact && row(exact), prefix: prefix.slice(0, 8).map(row), close: close.slice(0, 6).map(row), in_defs: inDefs.map(row) });
  const best = exact || prefix[0] || close[0] || null; res.guessed = !exact && !prefix[0] && !!close[0]; res.shown = best ? djLocalEntry(best) : null;
  return res;
}
const djLocalStatus = () => ({ status: 'success', state: DJL.state, dictionary: DJ_SAMPLE, offline: DJL.offline, words: djWnOn() ? 150000 : 0, mine: djMine0().length,
  glossary: 'vault\\.neurovault\\glossary.json', glossary_error: '', job: DJL.state === 'downloading' ? { done: Math.round(DJ_SAMPLE.bytes * DJL.fraction), total: DJ_SAMPLE.bytes, fraction: DJL.fraction }
    : DJL.state === 'building' ? { done: DJ_SAMPLE.bytes, total: DJ_SAMPLE.bytes, fraction: DJL.fraction } : DJL.state === 'failed' ? { message: DJL.failed, kind: 'offline' } : undefined });
const DJ_LOCAL = {
  dict_status: djLocalStatus,
  dict_download() { DJL.state = 'downloading'; DJL.fraction = .04; clearInterval(DJL.timer);
    if (!DJ_CHECK) DJL.timer = setInterval(() => { DJL.fraction = Math.min(1, DJL.fraction + .16); if (DJL.fraction >= 1) { if (DJL.state === 'downloading') { DJL.state = 'building'; DJL.fraction = .1; } else { DJL.state = 'ready'; clearInterval(DJL.timer); } } }, 600);
    return djLocalStatus(); },
  dict_cancel() { clearInterval(DJL.timer); DJL.state = 'none'; return { ...djLocalStatus(), message: 'Download cancelled: nothing was kept.' }; },
  dict_dismiss() { if (DJL.state === 'failed') DJL.state = 'none'; return djLocalStatus(); },
  dict_search: (q, scope) => djLocalSearch(q, scope),
  dict_lookup: w => ({ status: 'success', entry: djLocalEntry(djNorm(w)) }),
  autocorrect_word(w, noteId) {   // Fix A: the sample's answer: one clear suggestion, one letter off
    if (!ACOR.cfg.on || ACOR.cfg.never.includes(String(w).toLowerCase())) return { status: 'success', word: w, to: null, why: 'off' };
    const r = DJ_LOCAL.dict_spell(w, noteId), [a, b] = r.suggestions || [], quick = SPELL[djNorm(w)];
    const to = quick || (!r.known && a && a.d <= (ACOR.cfg.strength === 'more' ? 2 : 1) && !(b && b.d <= a.d) ? a.word : null);
    return { status: 'success', word: w, to: r.known && !quick ? null : to, why: to ? 'close' : 'not sure' };
  },
  autocorrect_learn: () => ({ status: 'success', undone: 0, words: 0, learn_notes: true, list: false }),   // Build N (QC 76): learning lives in the app
  autocorrect_learned: () => ({ status: 'success', undone: 0, words: 0, learn_notes: true, list: false }),
  autocorrect_forget: () => ({ status: 'success', undone: 0, words: 0, learn_notes: true, list: false }),
  spell_words: (ws, noteId) => ({ status: 'success', wrong: [...new Set(ws)].filter(w => !DJ_LOCAL.dict_spell(w, noteId).known), engine: 'sample' }),   // Fix A: Check spelling's one call
  dict_spell(w0, noteId) {   // Fix A (QC 3 · 26): as dictionary.py's spell, on the sample's words
    const w = String(w0 || '').trim(), k = djNorm(w), mine = djMine0(), out = { status: 'success', word: w, known: true, suggestions: [], checked: djWnOn() };
    if (!k || k.length < 2 || k.includes(' ') || /\d/.test(w) || (w === w.toUpperCase() && w.length <= 6) || DJ_SMALL.has(k) || (noteId != null && (DJS.ignore[noteId] || []).includes(k))) return out;
    const forms = [k, ...['s', 'es', 'ed', 'd', 'ing'].filter(s => k.endsWith(s)).flatMap(s => [k.slice(0, -s.length), k.slice(0, -s.length) + 'e'])];
    if (forms.some(f => mine.some(x => x.key === f) || (djWnOn() && (DJ_WN[f] || djStubs().includes(f))))) return out;
    if (!djWnOn() && !mine.length) return out;
    const lim = k.length <= 4 ? 1 : 2, pool = [...mine.map(x => [x.key, x.word, true]), ...(djWnOn() ? [...Object.keys(DJ_WN), ...djStubs(), ...DJ_SMALL].map(x => [x, x, false]) : [])];
    const fit = x => w[0] === w[0].toUpperCase() && w[0] !== w[0].toLowerCase() ? (w === w.toUpperCase() ? x.toUpperCase() : x[0].toUpperCase() + x.slice(1)) : x;
    out.known = false;
    out.suggestions = pool.map(([key, word, m]) => ({ word: fit(word), mine: m, d: djLev(key, k) })).filter(x => x.d <= lim && djNorm(x.word) !== k)
      .sort((a, b) => a.d - b.d || (DJ_WN[djNorm(b.word)]?.[1].length || 0) - (DJ_WN[djNorm(a.word)]?.[1].length || 0)).filter((x, i, a) => a.findIndex(y => djNorm(y.word) === djNorm(x.word)) === i).slice(0, 5);
    return out;
  },
  dict_words: () => ({ status: 'success', words: djMine0().map(w => ({ ...w })) }),
  dict_word_save(data, oldKey) {
    const word = String(data.word || '').trim(), key = djNorm(word), def = String(data.definition || '').trim(), mine = djMine0();
    if (!word) return { status: 'error', message: 'Type the word.', field: 'word' };
    const clash = mine.find(w => w.key === key && w.key !== oldKey); if (clash) return { status: 'error', message: `You already have “${clash.word}”. Edit that one instead.`, field: 'word' };
    if (!def) return { status: 'error', message: 'Add a short definition in your own words.', field: 'def' };
    const old = oldKey ? mine.find(w => w.key === oldKey) : null, today = dayKey(tNow());
    const w = { key, word, pos: data.pos || 'noun', definition: def, example: String(data.example || '').trim(), tags: [...new Set(String(data.tags || '').split(/[\s,]+/).map(t => t.replace(/^#+/, '').toLowerCase()).filter(Boolean))], added: old ? old.added : today, updated: today };
    DJL.mine = [...mine.filter(x => x !== old), w].sort((a, b) => a.word.localeCompare(b.word)); return { status: 'success', word: w };
  },
  dict_word_delete(key) { DJL.mine = djMine0().filter(w => w.key !== key); return { status: 'success' }; },
};
// One call: dictionary.py in the app, the sample otherwise
const dj = (name, ...args) => djLive() ? nv(name, ...args) : Promise.resolve(DJ_LOCAL[name](...args));
// The check's demo states (none, downloading, building, failed, ready), and a fresh page
function djDemo(state, o = {}) {
  clearInterval(DJL.timer); DJL.state = state; DJL.mine = null; DJL.fraction = state === 'building' ? .45 : .62; DJL.offline = !!o.offline;
  DJL.failed = 'The download stopped: you seem to be offline. Try again when you’re back online; your own words work meanwhile.';
  Object.assign(DJ, { st: djLocalStatus(), q: '', scope: 'all', sel: null, selEntry: null, res: null, form: null, confirm: null, later: false, reading: null, more: new Set(),
    recent: ['milestone', 'effect', 'crdt', 'resolution', 'pipeline'], mine: djMine0().map(w => ({ ...w })), loaded: true, warm: true });
  DJ.recent.forEach(k => { const e = djLocalEntry(k); if (e) DJ.rows[k] = djRowOf(e, k); });
}

/* ---- Loading, searching, picking ---- */
const djReady = () => DJ.st?.state === 'ready';
async function djRefresh(render = true) {
  const [st, w] = await Promise.all([dj('dict_status'), dj('dict_words')]);
  if (!failed(st)) DJ.st = st; if (!failed(w)) DJ.mine = w.words;
  DJ.loaded = true; djPollIfBusy();
  if (!DJ.warm) { DJ.warm = true; DJ.recent.filter(k => !DJ.rows[k]).forEach(k => dj('dict_lookup', k).then(r => { if (r?.entry) { DJ.rows[k] = djRowOf(r.entry, k); if (UI.view === 'dict') renderAll(); } })); }
  if (render && UI.view === 'dict') renderAll();
}
// While it downloads and is made ready, the page asks every half second
function djPollIfBusy() {
  clearTimeout(DJ.poll);
  if (!['downloading', 'building'].includes(DJ.st?.state)) return;
  DJ.poll = setTimeout(async () => { const was = DJ.st?.state, st = await dj('dict_status'); if (failed(st)) return; DJ.st = st;
    if (was !== 'ready' && st.state === 'ready') { status(`The dictionary is ready: ${st.words.toLocaleString('en-GB')} words, offline`); djSearchNow(); }
    if (st.state === 'failed') status('The dictionary download stopped');
    if (UI.view === 'dict') renderAll(); djPollIfBusy(); }, DJ_CHECK ? 60000 : 500);
}
function djRecent(k) { if (!k) return; DJ.recent = [k, ...DJ.recent.filter(x => x !== k)].slice(0, 12); if (!DJ_CHECK) saveSettings({ dict_recent: DJ.recent }); }
function djCache(rows) { rows.forEach(r => { if (r?.key) DJ.rows[r.key] = r; }); }
async function djSearchNow() {
  const s = ++DJ.seq, q = DJ.q, scope = DJ.scope;
  if (!q.trim()) { DJ.res = null; if (UI.view === 'dict') renderAll(); return; }
  const r = await dj('dict_search', q, scope); if (s !== DJ.seq || failed(r)) return;
  DJ.res = r; djCache([r.exact, ...r.prefix, ...r.close, ...r.in_defs]);
  if (UI.view === 'dict') renderAll();
  return r;
}
function djType(v) { DJ.q = v; DJ.sel = null; DJ.selEntry = null; DJ.form = null; DJ.confirm = null; clearTimeout(djType.t); if (DJ_CHECK) return djSearchNow(); djType.t = setTimeout(djSearchNow, 90); }
// Fix A (QC 3 · 4): Recent lookups is a timeline in the order you looked words up. A search, Look up or a word picked from
// the matches adds to the top; opening one from Recent lookups (keep) leaves the list as it is
async function djPick(k, render = true, keep = false) {
  DJ.sel = k; DJ.form = null; DJ.confirm = null; if (!keep) djRecent(k);
  const r = await dj('dict_lookup', k); if (DJ.sel !== k) return;
  DJ.selEntry = r?.entry || null; if (DJ.selEntry) djCache([djRowOf(DJ.selEntry, k)]);
  if (render) renderAll();
}
// What the page shows: your pick, else the search's best (the exact word, the first that starts with it, else the closest)
function djShown() {
  if (DJ.form) return [null, false];
  if (DJ.sel) return [DJ.selEntry, false];
  if (!DJ.q.trim() && DJ.scope === 'mine') return [null, false];
  return DJ.res && djNorm(DJ.q) === DJ.res.q ? [DJ.res.shown, DJ.res.guessed] : [null, false];
}
// Opens the Dictionary tab, optionally on a word or on the form
function openDict(word, opts = {}) {
  if (S.modal && S.modal !== 'settings') closeModal(true);
  S.ctx = null; DJ.form = opts.form || null; DJ.confirm = null;
  if (word != null && word !== '') { DJ.q = word; DJ.scope = 'all'; DJ.sel = null; DJ.selEntry = null; djSearchNow().then(r => { if (r?.shown && !r.guessed) djRecent(r.shown.key); }); }
  if (!DJ.loaded) djRefresh(false).then(() => renderAll());
  if (opts.focus) S.focus = { sel: opts.focus };
  if (UI.view !== 'dict') setUI('view', 'dict'); else renderAll();
}

/* ---- Read aloud: Phase 6C's engine and voice. The setting says the word only, or the word and its meanings ---- */
function djReadText(e) {
  if (DJ.readMode === 'word' || !e) return e?.word || '';
  const parts = [e.word + '.'];
  if (e.mine) parts.push(`Your meaning: ${e.mine.definition}`);
  [...new Set(e.senses.map(s => s.pos))].forEach(p => { const ss = e.senses.filter(s => s.pos === p).slice(0, 3); parts.push(`${p[0].toUpperCase() + p.slice(1)}: ${ss.map(s => s.def.replace(/[.;:]\s*$/, '')).join('. ')}.`); });
  return parts.join(' ');
}
function djStopSpeech() { if (DJ.reading) { DJ.reading = null; stopSpeech(); } }
function djSpeak(e, where) {
  if (DJ.reading === e.key + where) { djStopSpeech(); status('Stopped reading'); renderAll(); return; }
  stopReading(); const text = djReadText(e); DJ.reading = e.key + where; const run = READ.run;
  const done = () => { if (run !== READ.run && DJ.reading !== e.key + where) return; if (DJ.reading === e.key + where) { DJ.reading = null; renderAll(); } };
  status(DJ.readMode === 'word' ? `Reading “${e.word}”` : `Reading “${e.word}”, then its meanings`);
  if (DJ_CHECK || CHECK_READ) { renderAll(); return; }
  if (readEngine() === 'sherpa') {
    within(api().read_aloud_speak(text, currentVoice(), READ.speed), 90000).catch(x => ({ status: 'error', message: x.message })).then(r => {
      if (run !== READ.run || DJ.reading !== e.key + where) return;
      if (failed(r)) { toast(r?.message || 'The voice did not answer'); DJ.reading = null; renderAll(); return; }
      READ.tryAudio = new Audio(r.audio); READ.tryAudio.onended = done; READ.tryAudio.play().catch(done); });
  } else {
    if (!hasSpeech() || !READ.winVoices.length) { toast('No Windows voices were found on this PC'); DJ.reading = null; renderAll(); return; }
    const u = new SpeechSynthesisUtterance(text), v = winVoice(); if (v) { u.voice = v; u.lang = v.lang; } u.rate = READ.speed;
    u.onend = done; u.onerror = done; READ.utt = u; speechSynthesis.speak(u);
  }
  renderAll();
}
// Settings → Voice: one row, after the read-aloud rows
VOICE_PAGE.push(() => `<div class="set-row"><div><div class="set-label" id="dj-read">Read aloud in the dictionary</div><div class="set-desc">What the dictionary and the word popover read when you press Read aloud. Uses the voice and speed above.</div></div>
  <div class="seg" role="group" aria-labelledby="dj-read">${[['word', 'The word only'], ['meanings', 'The word and its meanings']].map(([k, l]) => `<button class="seg-opt" data-act="dict-readmode" data-v="${k}" aria-pressed="${DJ.readMode === k}">${l}</button>`).join('')}</div></div>`);
// From config.json, with the read-aloud settings (store.js readerFromConfig → readFromConfig)
const djReadFromConfig = readFromConfig;
readFromConfig = function (c) {   // eslint-disable-line no-global-assign
  djReadFromConfig(c);
  if (c.dict_read === 'word' || c.dict_read === 'meanings') DJ.readMode = c.dict_read;
  if (Array.isArray(c.dict_recent)) DJ.recent = c.dict_recent.filter(x => typeof x === 'string').slice(0, 12);
  if (c.spell_ignore && typeof c.spell_ignore === 'object' && !Array.isArray(c.spell_ignore)) DJS.ignore = c.spell_ignore;   // Fix A (QC 3 · 26)
  ACOR.cfg = { on: c.autocorrect !== false, strength: c.autocorrect_strength === 'more' ? 'more' : 'obvious', never: Array.isArray(c.autocorrect_never) ? c.autocorrect_never : [] };   // Fix A: autocorrect
  ACOR.learnNotes = c.autocorrect_learn_notes !== false; ACOR.learned = null;   // Build N (QC 76)
  SPW.where = c.spell_where === 'notes' ? 'notes' : 'everywhere';   // Fix A (QC 4 · 30)
};

/* ---- The Dictionary page (R37 "split": matches on the left, the word on the right) ---- */
const djPos = p => p[0].toUpperCase() + p.slice(1);
const djAdded = d => new Date(d + 'T12:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
const djMB = b => (b / 1e6).toFixed(1) + ' MB';
const djMineRow = w => ({ key: w.key, word: w.word, pos: [w.pos], def: w.definition, mine: true });
function djRow(r, cur, kind) {   // Fix A (QC 3 · 4): a row in Recent lookups opens its word where it is (data-recent)
  return `<button class="list-item dict-row" role="option" aria-selected="${r.key === cur}" aria-current="${r.key === cur}" data-act="dict-pick" data-v="${esc(r.key)}"${kind === 'recent' ? ' data-recent=""' : ''}><span class="list-item-main">
    <span class="dict-row-top"><span class="list-item-title">${esc(r.word)}</span>${r.pos?.length ? `<span class="dict-row-pos">${esc(r.pos.join(', '))}</span>` : ''}${r.mine ? `<span class="dict-mine">${ic('user')}Yours</span>` : ''}</span>
    ${r.def ? `<span class="list-item-sub">${esc(r.def)}</span>` : ''}</span></button>`;
}
function djGetCard() {
  const st = DJ.st, e = st?.dictionary; if (!st || !e || st.state === 'ready') return '';
  const job = st.job || {}, size = `<b>${djMB(e.bytes)}</b> to download, about ${e.disk_mb} MB on this PC`, host = (() => { try { return new URL(e.url).host; } catch (x) { return e.source; } })();
  if (st.state === 'downloading') { const pct = Math.round(100 * (job.done || 0) / (job.total || e.bytes));
    return `<div class="card card-pad dict-get" role="status"><div class="dict-get-main"><span class="spinner" aria-hidden="true"></span><div><div class="set-label">Downloading the dictionary · ${djMB(job.done || 0)} of ${djMB(job.total || e.bytes)}</div>
      <div class="progress" role="progressbar" aria-label="Dictionary download" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100"><span style="width:${pct}%"></span></div>
      <div class="set-desc">Keep working: your own words already search.</div></div></div><div class="dict-get-acts"><button class="btn btn--secondary" data-act="dict-cancel">${ic('x')}Cancel download</button></div></div>`; }
  if (st.state === 'building') { const pct = Math.round(100 * (job.fraction || 0));
    return `<div class="card card-pad dict-get" role="status"><div class="dict-get-main"><span class="spinner" aria-hidden="true"></span><div><div class="set-label">Getting the dictionary ready · ${pct}%</div>
      <div class="progress" role="progressbar" aria-label="Getting the dictionary ready" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100"><span style="width:${pct}%"></span></div>
      <div class="set-desc">The download checked out. NeuroVault is putting its words in order, once; it works offline after this.</div></div></div><div class="dict-get-acts"><button class="btn btn--secondary" data-act="dict-cancel">${ic('x')}Cancel</button></div></div>`; }
  if (st.state === 'failed') return `<div class="card card-pad dict-get dict-get--failed" role="alert"><div class="dict-get-main">${ic('alert')}<div><div class="set-label">The dictionary didn’t download</div>
    <div class="set-desc">${esc(plainMsg(job.message || 'The download stopped.'))} Nothing half-finished was kept.</div></div></div><div class="dict-get-acts"><button class="btn btn--secondary" data-act="dict-dismiss">Not now</button><button class="btn btn--primary" data-act="dict-download">${ic('download')}Try again · ${djMB(e.bytes)}</button></div></div>`;
  if (DJ.later) return `<div class="card dict-get dict-get--slim"><div class="dict-get-main">${ic('book')}<span>The dictionary isn't on this PC yet, so only your own words are searched.</span></div><div class="dict-get-acts"><button class="btn btn--secondary btn--sm" data-act="dict-download">${ic('download')}Download · ${djMB(e.bytes)}</button></div></div>`;
  return `<div class="card card-pad dict-get"><div class="dict-get-main">${ic('book')}<div><div class="set-label">Download the dictionary to look up any word</div>
    <div class="set-desc">${esc(e.name)}: ${esc(e.words)} words with meanings, examples, similar words and opposites. From ${esc(e.source)}, free to use (${esc(e.licence)}). ${size}. Works offline after that.</div>
    <div class="set-desc">The file: <span class="code">${esc(e.file)}</span> from ${esc(host)}. Your own words work without it.</div>
    ${st.offline ? `<div class="set-desc dict-offline">${ic('alert')}You seem to be offline: the download needs the internet.</div>` : ''}</div></div>
    <div class="dict-get-acts"><button class="btn btn--secondary" data-act="dict-later">Not now</button><button class="btn btn--primary" data-act="dict-download">${ic('download')}Download · ${djMB(e.bytes)}</button></div></div>`;
}
function djList(r, cur) {
  const g = [], q = DJ.q.trim(), mineRows = DJ.mine.map(djMineRow);
  if (DJ.scope === 'mine' && !q) g.push([`Your words · ${DJ.mine.length}`, mineRows]);
  else if (!q) { const rec = DJ.recent.map(k => DJ.rows[k] || { key: k, word: k, pos: [], def: '' }); if (rec.length) g.push(['Recent lookups', rec, 'recent']); g.push([`Your words · ${DJ.mine.length}`, mineRows]); }
  else if (r) { const m = [r.exact, ...r.prefix].filter(Boolean); if (m.length) g.push(['Matches', m.slice(0, 8)]); if (r.close.length) g.push(['Close spellings', r.close]); if (r.in_defs.length) g.push(['In meanings', r.in_defs]); }
  const seen = new Set(), body = g.map(([t, rows, kind]) => [t, rows.filter(x => !seen.has(t + x.key) && seen.add(t + x.key)), kind]).filter(x => x[1].length)
    .map(([t, rows, kind]) => `<div class="eyebrow dict-group" role="presentation"><span>${t}</span>${kind === 'recent' ? '<button class="btn btn--ghost btn--sm" data-act="dict-recent-clear">Clear</button>' : ''}</div>${rows.map(x => djRow(x, cur, kind)).join('')}`).join('');
  return `<div class="card dict-list" role="listbox" aria-label="${q ? 'Matches for ' + esc(q) : 'Recent lookups and your words'}">${body || `<div class="empty empty--compact"><div class="empty-text">${!r && q ? 'Looking…' : DJ.scope === 'mine' ? 'No words of yours match.' : 'No matches.'}</div></div>`}</div>`;
}
function djGuess(r, e) {
  if (r.via) return `<div class="alert alert--info dict-guess" role="status">${ic('book')}<span>Showing <b>${esc(e.word)}</b>, the dictionary form of “${esc(r.via)}”.</span></div>`;
  const others = r.close.filter(x => x.key !== e.key).slice(0, 3);
  return `<div class="alert alert--info dict-guess" role="status">${ic('search')}<span>Showing <b>${esc(e.word)}</b>. You typed “${esc(DJ.q)}”.</span>${others.length ? `<span>Or:</span>${others.map(x => `<button class="btn btn--secondary btn--sm" data-act="dict-pick" data-v="${esc(x.key)}">${esc(x.word)}</button>`).join('')}` : ''}</div>`;
}
function djNone(r) {
  const off = !djReady();
  return `<div class="card dict-none"><div class="empty"><div class="empty-title">No word like “${esc(DJ.q)}”</div>${r?.in_defs.length ? `<div class="empty-text">It’s in the meanings of ${r.in_defs.map(x => `<b>${esc(x.word)}</b>`).join(', ')}: see the list.</div>` : ''}
    <div class="empty-text">${off ? 'It isn’t one of your words, and the dictionary isn’t downloaded yet.' : DJ.scope === 'mine' ? 'It isn’t one of your words. Search all words, or add it.' : 'Check the letters, or add it as your own word: course jargon, names, short forms.'}</div>
    <div class="dict-entry-acts">${DJ.scope === 'mine' ? '<button class="btn btn--secondary" data-act="dict-scope" data-v="all">Search all words</button>' : ''}<button class="btn btn--primary" data-act="dict-add" data-v="${esc(DJ.q.trim())}">${ic('plus')}Add “${esc(DJ.q.trim())}” as your word</button></div></div></div>`;
}
function djWelcome() {
  const rec = DJ.recent.filter(k => DJ.rows[k]);
  return `<div class="card card-pad dict-hello"><h2 class="dict-card-title">Look up a word</h2><p class="set-desc">Type in the box above. The spelling doesn't have to be right: close spellings and words that sound alike are found too. In a note, right-click a word and choose Look up.</p>
    ${rec.length ? `<div class="eyebrow">Recent lookups</div><div class="chip-row">${rec.map(k => `<button class="chip chip--accent" data-act="dict-pick" data-v="${esc(k)}" data-recent="">${esc(DJ.rows[k].word)}</button>`).join('')}</div>` : ''}</div>`;
}
const djChips = ws => `<div class="chip-row">${ws.map(w => `<button class="chip chip--accent" data-act="dict-go" data-v="${esc(w)}">${esc(w)}</button>`).join('')}</div>`;
function djEntryCard(e) {
  const reading = DJ.reading === e.key + 'page', conf = DJ.confirm === e.key, m = e.mine;
  const head = `<div class="dict-entry-head"><div><h2 class="dict-word">${esc(e.word)}</h2>${e.syl ? `<div class="dict-syl" title="Syllables">${esc(e.syl)}</div>` : ''}</div>
    <div class="dict-entry-acts"><button class="btn btn--secondary" data-act="dict-read" data-v="${esc(e.key)}" aria-pressed="${reading}">${ic(reading ? 'stop' : 'volume')}${reading ? 'Stop reading' : 'Read aloud'}</button>
    ${m ? `<button class="btn btn--secondary" data-act="dict-edit" data-v="${esc(e.key)}">${ic('edit')}Edit</button><button class="btn btn--secondary" data-act="dict-del" data-v="${esc(e.key)}">${ic('trash')}Delete</button>`
      : `<button class="btn btn--secondary" data-act="dict-add" data-v="${esc(e.word)}" data-mean="1">${ic('plus')}Add your meaning</button>`}</div></div>
    <div class="dict-chips">${e.pos.map(p => `<span class="chip chip--neutral">${esc(p)}</span>`).join('')}${m ? `<span class="chip chip--accent">${ic('user')}Your word</span>${m.tags.map(t => `<span class="chip chip--neutral">#${esc(t)}</span>`).join('')}` : ''}</div>
    ${conf ? `<div class="alert alert--warning dict-confirm" role="alertdialog" aria-label="Delete ${esc(e.word)}">${ic('alert')}<span>Delete “${esc(e.word)}” from your words? Notes that use it don’t change.</span><span class="dict-confirm-acts"><button class="btn btn--secondary btn--sm" data-act="dict-del-no">Cancel</button><button class="btn btn--danger btn--sm" data-act="dict-del-yes" data-v="${esc(e.key)}">Delete</button></span></div>` : ''}`;
  const mine = m ? `<section class="dict-sec dict-sec--mine" aria-label="Your meaning"><div class="eyebrow">${ic('user')}Your meaning</div><div class="dict-def">${esc(m.definition)}</div>${m.example ? `<span class="dict-ex">“${esc(m.example)}”</span>` : ''}<div class="set-desc">Added ${djAdded(m.added)}</div></section>` : '';
  const byPos = [...new Set(e.senses.map(s => s.pos))].map(p => { const all = e.senses.filter(s => s.pos === p), open = DJ.more.has(e.key + '|' + p), shown = open ? all : all.slice(0, 5);
    return `<section class="dict-sec"><h3 class="dict-pos">${djPos(p)}</h3><ol class="dict-senses">${shown.map(s => `<li><span class="dict-def">${esc(s.def)}</span>${s.examples[0] ? `<span class="dict-ex">“${esc(s.examples[0])}”</span>` : ''}</li>`).join('')}</ol>
      ${all.length > 5 ? `<button class="btn btn--ghost btn--sm dict-more-btn" data-act="dict-more" data-v="${esc(e.key + '|' + p)}" aria-expanded="${open}">${open ? 'Show fewer' : `Show ${all.length - 5} more`}</button>` : ''}</section>`; }).join('');
  const syn = e.syn.length ? `<section class="dict-sec"><h3 class="eyebrow">Similar words (synonyms)</h3>${djChips(e.syn)}</section>` : '';
  const ant = e.ant.length ? `<section class="dict-sec"><h3 class="eyebrow">Opposites (antonyms)</h3>${djChips(e.ant)}</section>` : '';
  const sl = e.sounds.length ? `<section class="dict-sec"><h3 class="eyebrow">Sounds alike or easily mixed up</h3><div class="dict-sounds">${e.sounds.map(s => `<div class="dict-sound"><button class="chip chip--accent" data-act="dict-go" data-v="${esc(s.word)}">${esc(s.word)}</button><span>${esc(s.def || 'Not in the dictionary.')}</span></div>`).join('')}</div></section>` : '';
  const src = `<div class="dict-foot">${ic(m ? 'user' : 'book')}${m && e.wordnet ? 'Your meaning, then WordNet’s · offline' : m ? 'Your word · saved in your vault, searched everywhere' : e.wordnet ? 'WordNet · offline' : 'WordNet leaves out small words like this one. It’s here for the words it’s easily mixed up with.'}</div>`;
  return `<article class="card card-pad dict-entry" aria-label="${esc(e.word)}">${head}${mine}${byPos}${syn}${ant}${sl}${src}</article>`;
}
const DJ_POS = ['noun', 'verb', 'adjective', 'other'];
function djForm() {
  const f = DJ.form, err = f.err || {};
  const row = (id, label, desc, ctl) => `<div class="set-row"><div><div class="set-label" id="dfl-${id}">${label}</div><div class="set-desc">${desc}</div></div>${ctl}</div>`;
  const inv = k => err[k] ? ` aria-invalid="true" aria-describedby="dfe-${k}"` : '';
  const msg = k => err[k] ? `<div class="field-error" id="dfe-${k}">${esc(err[k])}</div>` : '';
  const tags = f.tags.split(/[\s,]+/).map(t => t.replace(/^#+/, '').toLowerCase()).filter(Boolean);
  return `<div class="card cf-card dict-form" role="form" aria-label="${f.mode === 'edit' ? 'Edit ' + esc(f.orig) : 'Add a word'}">
    <div class="cf-card-head"><h2 class="cf-card-title">${f.mode === 'edit' ? `Edit “${esc(f.orig)}”` : 'Add a word'}</h2><span class="cf-card-val">Saved in your vault, searched with the rest</span></div>
    ${row('word', 'Word', 'As you spell it. Capitals are kept.', `<div class="dict-f-ctl"><input class="field" id="dict-f-word" data-act="dict-f" data-k="word" value="${esc(f.word)}" aria-labelledby="dfl-word"${inv('word')} autocomplete="off" maxlength="80">${msg('word')}</div>`)}
    ${row('pos', 'Part of speech', 'What kind of word it is', `<div class="dict-f-ctl"><div class="seg" role="group" aria-labelledby="dfl-pos">${DJ_POS.map(p => `<button class="seg-opt" data-act="dict-f-pos" data-v="${p}" aria-pressed="${f.pos === p}">${djPos(p)}</button>`).join('')}</div>${msg('pos')}</div>`)}
    ${row('def', 'Your definition', 'In your own words, as short as you like', `<div class="dict-f-ctl"><textarea class="field field--area" id="dict-f-def" data-act="dict-f" data-k="def" rows="3" aria-labelledby="dfl-def"${inv('def')} maxlength="2000">${esc(f.def)}</textarea>${msg('def')}</div>`)}
    ${row('ex', 'Example', 'Optional: a sentence that uses it', `<div class="dict-f-ctl"><input class="field" id="dict-f-ex" data-act="dict-f" data-k="ex" value="${esc(f.ex)}" aria-labelledby="dfl-ex"${inv('ex')} maxlength="500">${msg('ex')}</div>`)}
    ${row('tags', 'Tags', 'Optional: group words, like #course', `<div class="dict-f-ctl"><input class="field" id="dict-f-tags" data-act="dict-f" data-k="tags" value="${esc(f.tags)}" aria-labelledby="dfl-tags"${inv('tags')} placeholder="#course #sync">${tags.length ? `<div class="dict-f-tags">${tags.map(t => `<span class="chip chip--neutral">#${esc(t)}</span>`).join('')}</div>` : ''}${msg('tags')}</div>`)}
    <div class="dict-form-foot"><button class="btn btn--secondary" data-act="dict-form-cancel">Cancel</button><button class="btn btn--primary" data-act="dict-form-save" ${f.busy ? 'disabled' : ''}>${ic('ok')}${f.mode === 'edit' ? 'Save changes' : 'Save word'}</button></div></div>`;
}
function djAttribution() {
  const e = DJ.st?.dictionary; if (!e) return '';
  return `<footer class="dict-attrib">${ic('book')}<span>${esc(e.attribution)} <button class="link-btn" data-act="dict-licence" aria-expanded="${!!DJ.licence}">The WordNet licence</button>
    ${DJ.licence ? `<pre class="dict-licence">${esc(DJ.licence)}</pre>` : ''}${DJ.st.glossary_error ? `<span class="dict-gloss-err">${esc(DJ.st.glossary_error)}</span>` : ''}</span></footer>`;
}
function viewDict() {
  if (!DJ.loaded && !DJ.loading) { DJ.loading = true; djRefresh(); }
  const r = DJ.q.trim() && DJ.res && djNorm(DJ.q) === DJ.res.q ? DJ.res : null, [e, guessed] = djShown(), cur = e?.key ?? DJ.sel;
  const ready = djReady(), n = DJ.mine.length;
  const search = `<div class="dict-search" role="search"><div class="dict-q-wrap">${ic('search')}<input class="field dict-q" id="dict-q" data-act="dict-q" type="search" value="${esc(DJ.q)}" placeholder="${ready ? 'Look up a word…' : 'Look up one of your words…'}" aria-label="Look up a word" autocomplete="off" spellcheck="false" aria-controls="dict-results" maxlength="80">
    ${DJ.q ? `<button class="icon-btn icon-btn--sm dict-q-clear" data-act="dict-q-clear" aria-label="Clear the search" title="Clear (Esc)">${ic('x')}</button>` : ''}</div>
    <div class="seg dict-scope" role="group" aria-label="Search in"><button class="seg-opt" data-act="dict-scope" data-v="all" aria-pressed="${DJ.scope === 'all'}">All words</button><button class="seg-opt" data-act="dict-scope" data-v="mine" aria-pressed="${DJ.scope === 'mine'}">Your words · ${n}</button></div></div>
    <p class="dict-meta">${ready ? `Searches <b>${(DJ.st.words || 0).toLocaleString('en-GB')}</b> words and your <b>${n}</b>, on this PC. The spelling doesn't have to be right.` : `Searches your <b>${n}</b> words. The full dictionary comes with the download.`}</p>`;
  const main = DJ.form ? djForm() : e ? (guessed || (r?.via && !DJ.sel) ? djGuess(r, e) : '') + djEntryCard(e) : DJ.q.trim() ? (r ? djNone(r) : '') : DJ.scope === 'mine' ? '' : djWelcome();
  return `<section class="view" id="main-view-dict"><div class="view-inner view-inner--dict">
    <div class="view-head"><div><h1 class="view-title">Dictionary</h1><p class="view-sub">Meanings, similar words and words that sound alike, offline. Your own words are searched too.</p></div>
      <button class="btn btn--primary" data-act="dict-add">${ic('plus')}Add a word</button></div>${djGetCard()}${search}
    <div class="dict-body dict-body--split" id="dict-results">${djList(r, cur)}<div class="dict-main">${main}</div></div>${djAttribution()}</div></section>`;
}
async function djSave() {
  const f = DJ.form; if (f.busy) return;
  const empty = { ...(f.word.trim() ? {} : { word: 'Type the word.' }), ...(f.def.trim() ? {} : { def: 'Add a short definition in your own words.' }) };   // both at once, as R37 shows
  if (Object.keys(empty).length) { f.err = empty; S.focus = { sel: empty.word ? '#dict-f-word' : '#dict-f-def' }; renderAll(); return false; }
  f.busy = true;
  const r = await dj('dict_word_save', { word: f.word, pos: f.pos, definition: f.def, example: f.ex, tags: f.tags }, f.mode === 'edit' ? f.key : null); f.busy = false;
  if (failed(r)) { f.err = { [r.field || 'word']: r.message || "Couldn't save the word." }; S.focus = { sel: '#dict-f-' + ({ word: 'word', def: 'def', ex: 'ex', tags: 'tags' }[r.field] || 'word') }; renderAll(); return false; }
  const w = r.word; DJ.form = null; DJ.q = w.word; DJ.scope = 'all'; DJ.res = null; await Promise.all([djRefresh(false), djPick(w.key, false), djSearchNow()]);
  status(f.mode === 'edit' ? `Saved your changes to “${w.word}”` : `Added “${w.word}” to your words${DJ.selEntry?.wordnet ? ': your meaning shows first, above WordNet’s' : ''}`); renderAll(); return true;
}
function djAdd(word, mean) {
  const k = djNorm(word), pos0 = (DJ.selEntry?.key === k ? DJ.selEntry : DJ.res?.shown?.key === k ? DJ.res.shown : null)?.pos[0];
  const f = { mode: 'add', word: word || '', pos: DJ_POS.includes(pos0) ? pos0 : 'noun', def: '', ex: '', tags: '', err: {} };
  if (mean) status('Your meaning shows first, above WordNet’s');
  openDict(null, { form: f, focus: word ? '#dict-f-def' : '#dict-f-word' });
}
async function djEdit(k) {
  let w = DJ.mine.find(x => x.key === k); if (!w) { await djRefresh(false); w = DJ.mine.find(x => x.key === k); } if (!w) return;
  openDict(null, { form: { mode: 'edit', key: k, orig: w.word, word: w.word, pos: DJ_POS.includes(w.pos) ? w.pos : 'other', def: w.definition, ex: w.example || '', tags: w.tags.map(t => '#' + t).join(' '), err: {} }, focus: '#dict-f-def' });
}

/* ---- The word popover (R37 "full"): meaning, similar, opposite, read aloud, Open in dictionary, Add ---- */
function djWordOccurrences(doc, word) {
  const out = [], re = new RegExp(`(^|[^\\p{L}'’])(${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})(?![\\p{L}])`, 'giu');
  const walker = document.createTreeWalker(doc, NodeFilter.SHOW_TEXT); let n;
  while ((n = walker.nextNode())) { let m; re.lastIndex = 0; while ((m = re.exec(n.textContent))) out.push({ node: n, start: m.index + m[1].length, end: m.index + m[1].length + m[2].length }); }
  return out;
}
const djDoc = () => app.querySelector('#note-body-editor') || app.querySelector('.doc');
function djWordRange() {
  const doc = djDoc(), w = S.word; if (!doc || !w) return null;
  const o = djWordOccurrences(doc, w.word)[w.nth]; if (!o) return null;
  const r = document.createRange(); r.setStart(o.node, o.start); r.setEnd(o.node, o.end); return r;
}
async function openWord(word, node, offset, at) {
  const doc = djDoc(); word = String(word || '').trim(); if (!doc || !/^[\p{L}'’-]{2,40}$/u.test(word)) return;
  const occ = djWordOccurrences(doc, word); let nth = occ.findIndex(o => o.node === node && offset >= o.start && offset <= o.end); if (nth < 0) nth = 0;
  S.menu = false; S.ctx = null; S.edPop = null; S.modal = 'word'; S.word = { word, nth, at, res: null };
  renderAll();
  const r = await dj('dict_search', word, 'all'); if (S.modal !== 'word' || S.word?.word !== word) return;
  if (!DJ.loaded) await djRefresh(false);
  S.word.res = failed(r) ? { shown: null, guessed: false, close: [] } : r; if (r?.shown && !r.guessed) djRecent(r.shown.key);   // Fix A (QC 3 · 4): Look up is a lookup
  renderAll();
}
function wordPopover() {
  const w = S.word; if (!w) return ''; const k = djNorm(w.word), r = w.res, e = r && !r.guessed ? r.shown : null, mine = e?.mine;
  const h = HOMO[k], sp = SPELL[k], locked = S.a11y.bionic, reading = e && DJ.reading === e.key + 'pop';
  const pill = x => `<button class="chip chip--accent" data-act="word-swap" data-v="${esc(x)}" ${locked ? 'disabled title="Turn off bionic reading to edit"' : ''}>${esc(x)}</button>`;
  const guesses = r && !e ? [...new Set([sp, ...(r.close || []).map(x => x.word), ...(r.prefix || []).slice(0, 2).map(x => x.word)].filter(Boolean))].slice(0, 4) : [];
  const s0 = e?.senses?.[0];
  return `<div class="card popover wordpop" role="dialog" aria-label="About the word ${esc(w.word)}" data-wordpop>
    <div class="pop-head"><span class="wordpop-word">${esc(w.word)}</span>${e?.pos[0] ? `<span class="chip chip--neutral">${esc(e.pos[0])}</span>` : ''}${mine ? `<span class="chip chip--accent">${ic('user')}Yours</span>` : ''}
      <span class="wordpop-head-acts">${e ? `<button class="icon-btn icon-btn--sm" data-act="dict-read-pop" data-v="${esc(e.key)}" aria-pressed="${!!reading}" aria-label="${reading ? 'Stop reading' : `Read ${esc(w.word)} aloud`}" title="${reading ? 'Stop reading' : 'Read aloud'}">${ic(reading ? 'stop' : 'volume')}</button>` : ''}<button class="icon-btn icon-btn--sm" data-act="close" aria-label="Close">${ic('x')}</button></span></div>
    ${!r ? '<div class="wordpop-def">Looking it up…</div>' : ''}
    ${r && !e && guesses.length ? `<div class="wordpop-def">This might be misspelled. Did you mean:</div><div class="chip-row">${guesses.map(pill).join('')}</div>` : ''}
    ${h ? `<div class="wordpop-def">${esc(h)}</div><div class="eyebrow">Easily swapped with</div><div class="chip-row">${HOMO_SWAP[k].map(pill).join('')}</div>` : ''}
    ${mine ? `<div class="wordpop-mine"><span class="eyebrow">${ic('user')}Your meaning</span><span class="wordpop-def">${esc(mine.definition)}</span>${mine.tags.length ? `<span class="wordpop-ex">${mine.tags.map(t => '#' + esc(t)).join(' ')}</span>` : ''}</div>` : ''}
    ${s0 ? `<div class="wordpop-def">${esc(s0.def)}</div>${s0.examples[0] ? `<div class="wordpop-ex">“${esc(s0.examples[0])}”</div>` : ''}` : ''}
    ${e?.syn.length ? `<div class="eyebrow">Similar · click one to swap it in</div><div class="chip-row">${e.syn.slice(0, 6).map(pill).join('')}</div>` : ''}
    ${e?.ant.length ? `<div class="eyebrow">Opposite</div><div class="chip-row">${e.ant.slice(0, 4).map(pill).join('')}</div>` : ''}
    ${r && !e && !h && !guesses.length ? `<div class="wordpop-def">${djReady() ? 'Not in the dictionary, and not one of your words.' : 'The dictionary isn’t downloaded yet, and this isn’t one of your words.'}</div>` : ''}
    <div class="wordpop-foot">${djReady() || e ? `<button class="btn btn--secondary btn--sm" data-act="dict-open" data-v="${esc(w.word)}">${ic('book')}Open in dictionary</button>` : `<button class="btn btn--secondary btn--sm" data-act="dict-get" data-v="">${ic('download')}Get the dictionary</button>`}
      ${mine ? `<button class="btn btn--secondary btn--sm" data-act="dict-edit" data-v="${esc(mine.key)}">${ic('edit')}Edit your meaning</button>` : `<button class="btn btn--secondary btn--sm" data-act="dict-add" data-v="${esc(w.word)}">${ic('plus')}Add as your word</button>`}</div></div>`;
}
// Places the popover under the word (above it when there's no room), inside the window; scrolls inside when it must
function placeWordPop() {
  const wp = app.querySelector('[data-wordpop]'); if (!wp) return;
  const ar = app.getBoundingClientRect(), z = ar.width / app.offsetWidth || 1, rg = djWordRange();
  const rr = rg?.getBoundingClientRect(), anchor = rr && rr.width ? rr : S.word?.at ? { left: S.word.at[0], top: S.word.at[1], bottom: S.word.at[1] } : null;
  if (!anchor) { wp.style.left = '50%'; wp.style.top = '120px'; return; }
  const H = app.offsetHeight; wp.style.maxHeight = ''; wp.style.overflowY = '';
  wp.style.left = clamp((anchor.left - ar.left) / z, 8, app.offsetWidth - wp.offsetWidth - 8) + 'px';
  const below = (anchor.bottom - ar.top) / z + 8, above = (anchor.top - ar.top) / z - wp.offsetHeight - 8;
  let top = below + wp.offsetHeight <= H - 8 ? below : above >= 8 ? above : clamp(below, 8, Math.max(8, H - wp.offsetHeight - 8));
  wp.style.top = top + 'px';
  if (top + wp.offsetHeight > H - 8) { wp.style.maxHeight = (H - top - 8) + 'px'; wp.style.overflowY = 'auto'; }
}
// A word picked in the popover replaces the word in the note (one undo step)
function djSwap(v) {
  const r = djWordRange(), doc = djDoc(); if (!r || !doc || S.a11y.bionic) return;
  const was = r.toString(), keep = was[0] === was[0].toUpperCase() && was[0] !== was[0].toLowerCase() ? v[0].toUpperCase() + v.slice(1) : v;
  if (typeof edRecord === 'function') edRecord(doc, 'cmd');
  const span = r.startContainer.parentElement.closest('.spell, .homophone');
  if (span && span.textContent === was) span.replaceWith(document.createTextNode(keep)); else { r.deleteContents(); r.insertNode(document.createTextNode(keep)); }
  doc.normalize(); if (typeof edChanged === 'function') edChanged(doc); else noteEdited(note(), true);
  status(`Swapped “${was}” for “${keep}”`); S.modal = null; S.word = null; renderAll();
}

/* ---- A note's right-click menu: Look up, Add as your word, Cut, Copy, Paste, Select all (no Windows menu, Shift or not: Build M parity) ---- */
function djWordAt(e) {
  const doc = e.target.closest?.('.doc'); if (!doc || !document.caretRangeFromPoint) return null;
  const sel = getSelection(), st = sel.toString().trim();
  if (st && /^[\p{L}'’-]{2,40}$/u.test(st) && sel.rangeCount && doc.contains(sel.anchorNode)) { const rr = sel.getRangeAt(0).getBoundingClientRect(); if (e.clientX >= rr.left - 2 && e.clientX <= rr.right + 2 && e.clientY >= rr.top - 2 && e.clientY <= rr.bottom + 2) return { word: st, node: sel.anchorNode, offset: Math.min(sel.anchorOffset, sel.focusOffset) }; }
  const r = document.caretRangeFromPoint(e.clientX, e.clientY); if (!r || r.startContainer.nodeType !== 3) return null;
  const txt = r.startContainer.textContent; let a = r.startOffset, b = a;
  while (a > 0 && /[\p{L}'’-]/u.test(txt[a - 1])) a--; while (b < txt.length && /[\p{L}'’-]/u.test(txt[b])) b++;
  const word = txt.slice(a, b).replace(/^['’-]+|['’-]+$/g, '');
  return word.length > 1 ? { word, node: r.startContainer, offset: a } : null;
}
/* ---- Fix A (QC 4 · 39): what a right-click acts on (design profile: "Right-click acts on what you mean") ----
   Inside a selection: the selection, as it is (the press doesn't change it). Anywhere else, for the text actions (Copy,
   Tidy up with AI): the paragraph, list item, quote line or table cell under the pointer, without selecting it first;
   spelling and Look up keep the word under the pointer (djWordAt). Nothing on the page is selected until an action runs. */
const MT_BLOCK = 'td, th, li, p, h1, h2, h3, h4, h5, h6, div.task';
function menuTarget(e) {
  const doc = e.target.closest?.('.doc'); if (!doc) return null;
  const sel = getSelection(), r0 = sel.rangeCount ? sel.getRangeAt(0) : null;
  if (r0 && !r0.collapsed && doc.contains(r0.commonAncestorContainer) && r0.toString().trim() && mtInSel(e, r0)) return mtMake(doc, 'selection', r0.cloneRange());
  const p = document.caretRangeFromPoint?.(e.clientX, e.clientY), at = p && doc.contains(p.startContainer) ? p.startContainer : e.target;
  const el = (at.nodeType === 1 ? at : at.parentElement)?.closest(MT_BLOCK);
  if (!el || !doc.contains(el) || el.closest('[contenteditable="false"], [data-md], pre')) return null;
  const r = document.createRange(); r.selectNodeContents(el);
  if (el.matches('li')) { const sub = [...el.children].find(k => k.matches('ul, ol')); if (sub) r.setEndBefore(sub); }   // the item's own line, not its sub-items
  const box = el.matches('li, div.task') && (typeof edBox === 'function' ? edBox(el) : null) || el.querySelector(':scope > input[type="checkbox"]'); if (box) r.setStartAfter(box);   // a task keeps its box
  return r.toString().trim() ? mtMake(doc, 'paragraph', r) : null;
}
// The pointer is in the selection: on its highlight, or where the caret would go inside it (past the end of a triple-clicked
// line, say); a press just at its edge is outside it
function mtInSel(e, r0) {
  if ([...r0.getClientRects()].some(b => e.clientX >= b.left - 1 && e.clientX <= b.right + 1 && e.clientY >= b.top - 1 && e.clientY <= b.bottom + 1)) return true;
  const cp = document.caretRangeFromPoint?.(e.clientX, e.clientY); if (!cp) return false;
  const n = cp.startContainer, o = cp.startOffset, at = (c, k) => n === c && o === k;
  try { return r0.comparePoint(n, o) === 0 && !at(r0.startContainer, r0.startOffset) && !at(r0.endContainer, r0.endOffset); } catch (x) { return false; }
}
function mtMake(doc, kind, r) {
  if (kind === 'selection' && r.endOffset === 0 && r.endContainer !== r.startContainer) {   // a triple-click ends at the next line's start: not that line
    const w = document.createTreeWalker(r.commonAncestorContainer.nodeType === 1 ? r.commonAncestorContainer : r.commonAncestorContainer.parentNode, NodeFilter.SHOW_TEXT); let last = null, t;
    while ((t = w.nextNode())) { if (r.comparePoint(t, 0) > 0 || (t === r.endContainer)) break; if (r.intersectsNode(t) && t.data.trim()) last = t; }
    if (last) r.setEnd(last, last.length);
  }
  const box = document.createElement('div'); box.append(r.cloneContents());
  return { kind, range: r, text: r.toString(), md: NVMarkdown.htmlToMd(box).replace(/\n+$/, ''), noteId: doc.dataset.note,
    sel: { a: edPath(doc, r.startContainer), ao: r.startOffset, b: edPath(doc, r.endContainer), bo: r.endOffset, ca: edOffset(doc, r.startContainer, r.startOffset), cb: edOffset(doc, r.endContainer, r.endOffset) } };
}
function mtLive(t) {   // the target in the note as it's drawn now (a redraw replaces the nodes): by its place, else by its characters
  if (!t) return null; if (t.range.startContainer.isConnected && t.range.toString() === t.text) return t.range;
  return typeof ainLiveRange === 'function' ? ainLiveRange(t)?.r || null : null;
}
function mtCopy(t) {   // the target's text and HTML, without selecting anything
  const r = mtLive(t) || t.range, box = document.createElement('div'); box.append(r.cloneContents());
  const put = e => { e.clipboardData.setData('text/plain', t.text); e.clipboardData.setData('text/html', box.innerHTML); e.preventDefault(); };
  document.addEventListener('copy', put, { once: true, capture: true }); document.execCommand('copy'); document.removeEventListener('copy', put, true);
}
// While a text action is hovered or has the keyboard, its target is shown with a soft highlight (a CSS highlight: the note isn't touched)
function mtShow(on, t = S.ctx?.target) {
  if (!window.CSS?.highlights || typeof Highlight === 'undefined') return;
  const r = on && mtLive(t); if (r) CSS.highlights.set('nv-target', new Highlight(r)); else CSS.highlights.delete('nv-target');
}
['pointerover', 'focusin'].forEach(ev => document.addEventListener(ev, e => { const m = e.target.closest?.('.menu--word, .tb-menu'); if (m) mtShow(!!e.target.closest('[data-mt]'), m.matches('.tb-menu') ? DJM.cell : S.ctx?.target); }, true));
// In a table cell the right-click menu is Build P's cell menu (tables.js): its top gets the text actions, on the same target
function djCellText() {
  const d = DJM.target; if (d && performance.now() - d.at < 5000) { DJM.cell = d.t; d.at = 0; }   // taken once, as the menu opens (it's drawn again on hover)
  const t = DJM.cell; if (!t?.md.trim()) return '';
  const what = t.kind === 'paragraph' ? 'this cell' : 'selection', off = typeof ainOn === 'function' && !ainOn();
  return `<!-- Fix A · QC 4 · 39: right-click acts on what you mean --><button class="menu-item" role="menuitem" data-act="cell-tidy" data-mt${off ? ` aria-disabled="true" title="${esc(typeof AIN_OFF === 'string' ? AIN_OFF : 'Turn on an AI model in Settings → AI models')}"` : ''}>${ic('sparkles')}<span>Tidy up ${what}</span></button>`
    + `<button class="menu-item" role="menuitem" data-act="cell-copy" data-mt>${ic('file')}<span>${what === 'this cell' ? 'Copy this cell' : 'Copy'}</span></button><div class="menu-sep"></div><!-- end Fix A -->`;
}
document.getElementById('app').addEventListener('click', e => {
  const b = e.target.closest('[data-act="cell-tidy"], [data-act="cell-copy"]'); if (!b) return;
  const t = DJM.cell; if (typeof TB !== 'undefined') { TB.menu = null; if (typeof tbPaint === 'function') tbPaint(); } mtShow(false); if (!t) return;
  if (b.dataset.act === 'cell-copy') { mtCopy(t); status(t.kind === 'paragraph' ? 'Copied the cell' : 'Copied'); return; }
  if (typeof ainTidyStart !== 'function') return;
  if (typeof ainOn === 'function' && !ainOn()) { status((typeof AIN_OFF === 'string' ? AIN_OFF : 'No AI model is on') + ': Settings → AI models'); openSettings('ai'); return; }
  ainTidyStart({ tidy: { sel: t.sel, md: t.md, text: t.text, noteId: t.noteId } });
});
const mtAfter = afterRender; afterRender = function () { mtAfter(); if (S.ctx?.kind !== 'word' && window.CSS?.highlights) CSS.highlights.delete('nv-target'); };   // eslint-disable-line no-global-assign
['pointerout', 'focusout'].forEach(ev => document.addEventListener(ev, e => { if (e.target.closest?.('[data-mt]') && !e.relatedTarget?.closest?.('[data-mt]')) mtShow(false); }, true));
/* ==== Build M · round 6 (R49 r49menu "tight", locked 2026-10-18; r49-dict "drop Open in the dictionary"): the right-click menu is
   small and quiet: 28px rows, 248px wide, the spellings on top in the accent colour with one line under them, then Look up (its
   popover has the dictionary), Add to your words, Ignore in this note; Cut / Copy / Paste and Check spelling with their keys on the
   right. The Windows spelling menu's hint is Check spelling's tooltip (as drawn; r49-hint waits for the user's compare). ==== */
Object.assign(ICON, {   // wireframe, Lucide-style: the menu's Cut, Copy, Paste and Check spelling
  cut: '<circle cx="6" cy="6" r="3"/><path d="M8.12 8.12 12 12"/><path d="M20 4 8.12 15.88"/><circle cx="6" cy="18" r="3"/><path d="M14.8 14.8 20 20"/>',
  copy: '<rect x="8" y="8" width="13" height="13" rx="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>',
  paste: '<rect x="8" y="2" width="8" height="4" rx="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/>',
  spellcheck: '<path d="m6 16 6-12 6 12"/><path d="M8 12h8"/><path d="m16 20 2 2 4-4"/>',
  selectall: '<path d="M5 3a2 2 0 0 0-2 2"/><path d="M19 3a2 2 0 0 1 2 2"/><path d="M21 19a2 2 0 0 1-2 2"/><path d="M5 21a2 2 0 0 1-2-2"/><path d="M9 3h1M9 21h1M14 3h1M14 21h1M3 9v1M21 9v1M3 14v1M21 14v1"/><rect x="8" y="8" width="8" height="8" rx="1"/>' });
function djWordMenu(c) {
  const it = (act, icon, label, o = {}) => `<button class="menu-item${o.cls ? ' ' + o.cls : ''}" role="menuitem" data-act="${act}" ${o.extra || ''}>${icon ? ic(icon) : '<span class="menu-pad" aria-hidden="true"></span>'}<span class="truncate">${label}</span>${o.key ? `<span class="menu-key">${o.key}</span>` : ''}</button>`;
  const w = esc(c.word), mt = c.target, sp = c.spell, wrong = sp && !sp.known, pop = typeof POP !== 'undefined' && POP;
  const sel = c.field ? c.end > c.start : mt?.kind === 'selection' || (!mt && !!getSelection().toString());
  const copy = c.field ? c.end > c.start : !!mt || !!getSelection().toString(), edit = c.field || !!app.querySelector('.doc[contenteditable="true"]');
  const fixes = wrong ? (sp.suggestions.length ? sp.suggestions.map(x => it('ctx-fix', null, esc(x.word), { cls: 'menu-sug', extra: `data-v="${esc(x.word)}"${x.mine ? ' title="From your words"' : ''}` })).join('') : '<div class="menu-none">No close spelling</div>') + '<div class="menu-sep"></div>' : '';
  const look = !c.word || pop ? '' : c.field ? it('ctx-define', 'search', `Look up “${w}”`) : it('ctx-lookup', 'search', `Look up “${w}”`);   // in a field there's no word to anchor the popover: the dictionary page
  const words = look + (!c.word || pop ? '' : it('ctx-addword', 'plus', `Add “${w}” to your words`)) + ((wrong || c.style) && !c.field ? it('ctx-ignore', 'eye', 'Ignore in this note', c.style && !wrong ? { extra: `title="The blue line goes: “${w}” is fine in this note"` } : {}) : '');   // QC 54: a style hint too
  const clip = it('ctx-cut', 'cut', 'Cut', { key: 'Ctrl+X', extra: sel && edit ? '' : 'disabled' }) + it('ctx-copy', 'copy', mt?.kind === 'paragraph' ? 'Copy this paragraph' : 'Copy', { key: 'Ctrl+C', extra: (copy ? '' : 'disabled') + (mt ? ' data-mt' : '') })
    + it('ctx-paste', 'paste', 'Paste', { key: 'Ctrl+V', extra: edit ? '' : 'disabled' }) + it('ctx-all', 'selectall', 'Select all', { key: 'Ctrl+A' });   // Build M parity: every text box keeps Select all
  const spell = it('ctx-spell', 'spellcheck', 'Check spelling', { key: 'F7' });   // Build M parity: no Windows menu, so no hint about it
  return `<div class="menu menu--context card menu--word menu--tight" role="menu" aria-label="${wrong ? 'Spelling and word actions' : 'Word actions'}" style="left:${c.x}px;top:${c.y}px">${fixes}${words}${words ? '<div class="menu-gap"></div>' : ''}${clip}<div class="menu-gap"></div>${spell}</div>`;
}
/* ==== end Build M · round 6 ==== */

/* ---- Ctrl+K: "> Open dictionary", "> Add a word…", and a Dictionary group for what you type (Define “…”) ---- */
PAL_COMMANDS.push(['Open dictionary', 'book', 'dict-open'], ['Add a word to your dictionary', 'plus', 'dict-add']);
async function djPalSearch(q0) {
  const q = q0.trim(); if (q.length < 2 || q.startsWith('>')) { DJ.pal = null; return; }
  const r = await dj('dict_search', q, 'all'); if (failed(r) || S.modal !== 'palette' || S.pal.q.trim() !== q) return;
  DJ.pal = { q, rows: [r.exact, ...r.prefix, ...r.close].filter(Boolean).slice(0, 3) }; renderAll();
}

/* ---- Wiring into the shell ---- */
const djViewFn = viewFn; viewFn = v => v === 'dict' ? viewDict : djViewFn(v);   // eslint-disable-line no-global-assign
const djCrumb = crumbText; crumbText = () => UI.view === 'dict' ? 'Dictionary' + (DJ.form ? ' · ' + (DJ.form.mode === 'edit' ? 'Edit a word' : 'Add a word') : DJ.scope === 'mine' ? ' · Your words' : '') : djCrumb();   // eslint-disable-line no-global-assign
const djSide = renderSidebar; renderSidebar = () => UI.view === 'dict' ? renderFileExplorer() : djSide();   // eslint-disable-line no-global-assign
const djRail = renderRail;
renderRail = function () {   // eslint-disable-line no-global-assign
  const h = djRail(), b = `<button class="rail-btn" data-act="view" data-v="dict" ${UI.view === 'dict' ? 'aria-current="page"' : ''} aria-label="Dictionary" title="Dictionary">${ic('book')}</button>`, at = h.indexOf('</div></div>');
  return at < 0 ? h : h.slice(0, at) + b + h.slice(at);
};
const djStatus = renderStatus;
renderStatus = function () {   // eslint-disable-line no-global-assign
  const h = djStatus(); if (UI.view !== 'dict') return h;
  const txt = djReady() ? `${(DJ.st.words || 0).toLocaleString('en-GB')} words · ${DJ.mine.length} yours` : `${DJ.mine.length} words of yours`;
  return h.replace(/(<span id="word-count-display" class="num">)[^<]*(<\/span>)/, `$1${esc(txt)}$2`);
};
const djModal = renderModal; renderModal = () => S.modal === 'word' ? wordPopover() : djModal();   // eslint-disable-line no-global-assign
const djCtx = renderContextMenu; renderContextMenu = () => S.ctx?.kind === 'word' ? djWordMenu(S.ctx) : djCtx();   // eslint-disable-line no-global-assign
const djPal = palResults;
palResults = function () {   // eslint-disable-line no-global-assign
  const g = djPal(), q = S.pal.q.trim(); if (!DJ.pal || DJ.pal.q !== q || q.startsWith('>')) return g;
  const items = DJ.pal.rows.map(r => ({ icon: r.mine ? 'user' : 'book', label: `Define “${r.word}”`, sub: `${r.mine ? 'Your word · ' : ''}${r.pos.join(', ')}${r.def ? ' · ' + r.def : ''}`, run: ['dict-open', r.word] }));
  if (!items.length) items.push({ icon: 'book', label: `Look up “${q}” in the dictionary`, sub: 'No close word; you can add it as your own', run: ['dict-open', q] });
  g.splice(Math.min(1, g.length), 0, ['Dictionary', items]); return g;
};
const djAfter = afterRender; afterRender = function () { djAfter(); if (S.modal === 'word') placeWordPop(); };   // eslint-disable-line no-global-assign
if (window.ResizeObserver) new ResizeObserver(() => { if (S.modal === 'word') placeWordPop(); }).observe(document.getElementById('app'));

/* ---- Clicks, typing and keys (actions.js ignores these data-act names) ---- */
document.getElementById('app').addEventListener('click', e => {
  if (e.target.closest('[data-soon]')) return;
  const t = e.target.closest('[data-act]'), act = t?.dataset.act, v = t?.dataset.v;
  // the popover closes on a click anywhere else; a click on a marked word opens it there
  if (S.modal === 'word' && !e.target.closest('.wordpop')) { S.modal = null; S.word = null; djStopSpeech(); app.querySelector('[data-wordpop]')?.remove(); }
  const proof = (!t || t.dataset.act === 'doc') && e.target.closest('.doc .spell, .doc .homophone');
  if (proof && !proof.closest('.pane-body')) { openWord(proof.textContent, proof.firstChild, 0, [e.clientX, e.clientY]); return; }
  if (!act || !/^(dict-|word-swap$|ctx-(lookup|define|addword|copy|fix|ignore)$)/.test(act)) return;
  const c = S.ctx;
  switch (act) {
    case 'dict-open': openDict(v || null); break;
    case 'dict-get': openDict(null, { focus: '[data-act="dict-download"]' }); break;
    case 'dict-q-clear': DJ.q = ''; DJ.sel = null; DJ.selEntry = null; DJ.res = null; S.focus = { sel: '#dict-q' }; renderAll(); break;
    case 'dict-scope': DJ.scope = v; DJ.sel = null; DJ.selEntry = null; DJ.form = null; if (v === 'mine') { DJ.q = ''; DJ.res = null; const f = DJ.mine[0]; if (f) djPick(f.key); }
      S.focus = { sel: `[data-act="dict-scope"][data-v="${v}"]` }; renderAll(); if (DJ.q) djSearchNow(); break;
    case 'dict-pick': djPick(v, true, t.hasAttribute('data-recent')); break;
    case 'dict-go': DJ.q = v; DJ.scope = 'all'; DJ.form = null; DJ.sel = null; DJ.selEntry = null; djSearchNow().then(r => { if (r?.shown && !r.guessed) djRecent(r.shown.key); app.querySelector('.dict-entry')?.scrollIntoView({ block: 'nearest' }); }); break;
    case 'dict-recent-clear': DJ.recent = []; if (!DJ_CHECK) saveSettings({ dict_recent: [] }); status('Cleared your recent lookups'); renderAll(); break;
    case 'dict-more': if (DJ.more.has(v)) DJ.more.delete(v); else DJ.more.add(v); S.focus = { sel: `[data-act="dict-more"][data-v="${CSS.escape(v)}"]` }; renderAll(); break;
    case 'dict-read': { const [en] = djShown(); if (en) djSpeak(en, 'page'); break; }
    case 'dict-read-pop': { const en = S.word?.res?.shown; if (en) djSpeak(en, 'pop'); break; }
    case 'dict-readmode': DJ.readMode = v; saveSettings({ dict_read: v }); status(v === 'word' ? 'The dictionary reads the word only' : 'The dictionary reads the word, then its meanings'); S.focus = { sel: `[data-act="dict-readmode"][data-v="${v}"]` }; renderAll(); break;
    case 'dict-add': djAdd(v ?? (DJ.q.trim() && !djShown()[0] ? DJ.q.trim() : ''), t.dataset.mean); break;
    case 'dict-edit': djEdit(v); break;
    case 'dict-f-pos': DJ.form.pos = v; S.focus = { sel: `[data-act="dict-f-pos"][data-v="${v}"]` }; renderAll(); break;
    case 'dict-form-save': djSave(); break;
    case 'dict-form-cancel': DJ.form = null; renderAll(); break;
    case 'dict-del': DJ.confirm = v; S.focus = { sel: '[data-act="dict-del-no"]' }; renderAll(); break;
    case 'dict-del-no': DJ.confirm = null; S.focus = { sel: '[data-act="dict-del"]' }; renderAll(); break;
    case 'dict-del-yes': { const w = DJ.mine.find(x => x.key === v); dj('dict_word_delete', v).then(async r => {
      if (failed(r)) { toast(r.message || "Couldn't delete the word"); return; }
      DJ.confirm = null; DJ.sel = null; DJ.selEntry = null; delete DJ.rows[v]; await djRefresh(false); if (DJ.q) await djSearchNow(); status(`Deleted “${w?.word || v}” from your words`); renderAll(); }); break; }
    case 'dict-download': { const go = DJ.st?.state === 'failed' ? dj('dict_dismiss').then(() => dj('dict_download')) : dj('dict_download');
      go.then(st => { if (failed(st)) { toast(st.message || "The download didn't start"); return; } DJ.st = st; DJ.later = false; djPollIfBusy(); status(`Downloading the dictionary: ${djMB(st.dictionary.bytes)} from ${st.dictionary.source}`); renderAll(); }); break; }
    case 'dict-cancel': dj('dict_cancel').then(st => { if (!failed(st)) DJ.st = st; clearTimeout(DJ.poll); status('Download cancelled; nothing was kept'); renderAll(); }); break;
    case 'dict-dismiss': dj('dict_dismiss').then(st => { if (!failed(st)) DJ.st = st; DJ.later = true; renderAll(); }); break;
    case 'dict-later': DJ.later = true; renderAll(); break;
    case 'dict-licence': if (DJ.licence) { DJ.licence = null; renderAll(); } else fetch('licences/wordnet-licence.txt').then(r => r.text()).then(x => { DJ.licence = x; renderAll(); }).catch(() => toast('The licence file is missing')); break;
    case 'word-swap': djSwap(v); break;
    case 'ctx-lookup': case 'ctx-define': case 'ctx-addword': case 'ctx-copy': case 'ctx-fix': case 'ctx-ignore': djCtxRun(act, c, v); break;   // Fix A: a pointer runs them on release (below); this is Enter or Space
  }
});
document.getElementById('app').addEventListener('input', e => {
  const t = e.target, act = t.dataset?.act;
  if (act === 'dict-q') djType(t.value);
  if (act === 'dict-f' && DJ.form) { DJ.form[t.dataset.k] = t.value; if (DJ.form.err?.[t.dataset.k]) delete DJ.form.err[t.dataset.k]; if (t.dataset.k === 'tags') { S.focus = { sel: '#dict-f-tags', pos: t.selectionStart }; renderAll(); } }
  if (act === 'pal-q') djPalSearch(t.value);
});
document.getElementById('app').addEventListener('keydown', e => {
  if (e.target.id === 'dict-q') {
    if (e.key === 'Escape' && DJ.q) { e.preventDefault(); e.stopPropagation(); DJ.q = ''; DJ.sel = null; DJ.selEntry = null; DJ.res = null; S.focus = { sel: '#dict-q' }; renderAll(); }
    if (e.key === 'Enter') {   // Fix A (QC 3 · 4): Enter straight after typing waits for the search (90 ms behind the keys), so the lookup is kept
      const go = () => { const [en] = djShown(); if (en) { djRecent(en.key); djPick(en.key); } };
      if (DJ.q.trim() && !(DJ.res && djNorm(DJ.q) === DJ.res.q)) { clearTimeout(djType.t); djSearchNow().then(go); } else go();
    }
    if (e.key === 'ArrowDown') { const r = app.querySelector('.dict-row'); if (r) { e.preventDefault(); r.focus(); } }
  }
  if (e.target.classList?.contains('dict-row') && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) { e.preventDefault(); const rows = [...app.querySelectorAll('.dict-row')], i = rows.indexOf(e.target) + (e.key === 'ArrowDown' ? 1 : -1); (rows[i] || (i < 0 ? app.querySelector('#dict-q') : null))?.focus(); }
  if (e.key === 'Enter' && e.ctrlKey && e.target.closest?.('.dict-form')) { e.preventDefault(); djSave(); }
}, true);
document.getElementById('app').addEventListener('contextmenu', e => {
  if (djShifted(e)) { djCtxClose(); return; }   // Fix A: Shift + right-click: the browser's own menu, always
  if (e.target.matches?.(SPELL_FIELDS) && !e.target.closest('.wordpop')) { djFieldMenu(e, e.target); return; }   // QC 4 · 30: a field you write in (QC 102: in a split pane too)
  if (e.target.closest('.pane-body, .wordpop')) return;
  const d0 = DJM.target, mt = d0 && d0.doc === e.target.closest('.doc') && performance.now() - d0.at < 3000 ? d0.t : menuTarget(e);   // QC 4 · 39: as the press found it
  const w = djWordAt(e) || (mt && { word: '', node: null, offset: 0 }); if (!w) return;   // no word under the pointer (a space, the line's end): still the paragraph's menu
  e.preventDefault();
  const r = app.getBoundingClientRect(), z = r.width / app.offsetWidth || 1;
  S.ctx = { kind: 'word', ...w, target: mt, style: !!e.target.closest?.('.doc .homophone'), cx: e.clientX, cy: e.clientY, x: Math.min((e.clientX - r.left) / z, app.offsetWidth - 280), y: Math.min((e.clientY - r.top) / z, app.offsetHeight - 220) };
  if (S.modal === 'word') { S.modal = null; S.word = null; }
  if (w.word) djSpellAsk(S.ctx, e.target.closest('.doc'));   // Fix A (QC 3 · 26)
  renderAll(); app.querySelector('.menu--word .menu-item')?.focus();
});

/* ---- Fix A (QC 3 · 2 and 3): the right-click menu closes and its items always run ----
   - It closes on a press anywhere else (either button), on Esc, when anything scrolls and when the window loses focus.
     The menu is taken out of the page as it is, so a press in the note still puts the caret where you pressed.
   - An item runs when the mouse button comes up on it, and the click that follows is swallowed. A click needs the
     same element under the press and the release, so a redraw in between (a save, a timer, a toast) lost it before.
   - Windows sends the contextmenu event when the right button comes up: Shift counts if it was down at the press
     too, so a Shift let go a moment early still gives the browser's own menu (Paste, spelling). */
const DJM = { rDown: null, upAt: 0 };
function djShifted() { return false; }   // Build M parity (R51 r49-hint): no Windows right-click menu anywhere: Shift + right-click is a plain right-click
function djCtxClose(back) {
  if (!S.ctx) return; const c = S.ctx; S.ctx = null; mtShow(false);
  app.querySelectorAll('.menu--context').forEach(m => m.remove());
  if (back && c.field) { const el = app.querySelector(c.field); if (el) { el.focus({ preventScroll: true }); el.setSelectionRange(c.start, c.end); } return; }   // QC 4 · 30
  if (back && c.kind === 'word') { const doc = djDoc(); if (doc?.isContentEditable) { doc.focus({ preventScroll: true }); if (c.node?.isConnected) { const r = document.createRange(); r.setStart(c.node, Math.min(c.offset, c.node.length)); r.collapse(true); const s = getSelection(); s.removeAllRanges(); s.addRange(r); } } }
}
function djCtxRun(act, c, v) {
  if (!c) return; S.ctx = null; mtShow(false);
  if (act === 'ctx-fix') { djSpellFix(c, v); return; }   // Fix A (QC 3 · 26)
  if (act === 'ctx-ignore') { djSpellIgnore(c); return; }
  if (act === 'ctx-lookup') openWord(c.word, c.node, c.offset, [c.cx, c.cy]);
  else if (act === 'ctx-define') openDict(c.word);
  else if (act === 'ctx-addword') djAdd(c.word);
  else if (act === 'ctx-copy' && c.target && !c.field) { mtCopy(c.target); status(c.target.kind === 'paragraph' ? 'Copied the paragraph' : 'Copied'); renderAll(); }   // QC 4 · 39
  else if (act === 'ctx-copy') { const el = c.field && app.querySelector(c.field); if (el) { el.focus({ preventScroll: true }); el.setSelectionRange(c.start, c.end); } document.execCommand('copy'); status('Copied'); renderAll(); }
  else if (act === 'ctx-cut' || act === 'ctx-paste') djClip(act, c);   // Build M · round 6
  else if (act === 'ctx-all') { renderAll(); const el = c.field && app.querySelector(c.field); if (el) { el.focus({ preventScroll: true }); el.select(); } else { const d = app.querySelector(`.doc[data-note="${CSS.escape(c.noteId || c.target?.noteId || '')}"]`) || djDoc(); if (d?.isContentEditable) { d.focus({ preventScroll: true }); edSelectAll(d); } } status('Selected all'); }   // Build M parity
  else if (act === 'ctx-spell') { renderAll(); spAct('spell-pass'); }
}
// Build M · round 6: Cut takes what's selected (one Undo step, as Ctrl+X); Paste puts the clipboard's text where the caret or
// selection is. WebView2 may not hand the page the clipboard: then it says to use Ctrl+V
async function djClip(act, c) {
  const el = c.field && app.querySelector(c.field), doc = !c.field && (app.querySelector(`.doc[data-note="${CSS.escape(c.target?.noteId || c.noteId || '')}"]`) || djDoc());
  const put = () => { if (el) { el.focus({ preventScroll: true }); el.setSelectionRange(c.start, c.end); return true; }
    if (!doc?.isContentEditable) return false; doc.focus({ preventScroll: true });
    const r = c.target?.kind === 'selection' && typeof mtLive === 'function' ? mtLive(c.target) : null; if (r) { const s = getSelection(); s.removeAllRanges(); s.addRange(r); } return true; };
  if (act === 'ctx-cut') { renderAll(); if (put() && document.execCommand('cut')) status('Cut'); else status('Select some text to cut'); return; }
  let text = null; try { text = await navigator.clipboard.readText(); } catch (e) { text = null; }
  renderAll();
  if (text == null) { status('Paste with Ctrl+V: this window can’t read the clipboard for the menu'); return; }
  if (!text) { status('Nothing to paste'); return; }
  if (put()) { document.execCommand('insertText', false, text); status('Pasted'); }
}
document.addEventListener('pointerdown', e => {
  if (e.button === 2) DJM.rDown = { at: performance.now(), shift: e.shiftKey };
  if (S.ctx && !e.target.closest?.('.menu--context')) djCtxClose();
}, true);
// A right-click in the note (with or without Shift) selects just the word under the pointer, or keeps a selection it lands
// in. The browser's own press would put the caret there, or with Shift held stretch the selection from the caret to the
// pointer ("half the sentence"), and Windows' menu then had the wrong text to spell (QC 3 · 26)
document.addEventListener('mousedown', e => {
  if (e.button !== 2) return;
  const doc = e.target.closest?.('.doc'); if (!doc?.isContentEditable || e.target.closest('[contenteditable="false"]')) return;
  DJM.target = { t: menuTarget(e), at: performance.now(), doc };   // QC 4 · 39: what the menu acts on, as the press found it
  const sel = getSelection(), r0 = sel.rangeCount ? sel.getRangeAt(0) : null;
  const inSel = r0 && !r0.collapsed && doc.contains(r0.commonAncestorContainer) && mtInSel(e, r0);
  e.preventDefault(); doc.focus({ preventScroll: true });
  if (inSel) return;
  if (!djShifted(e)) return;   // QC 4 · 39: NeuroVault's menu leaves the selection as it is (it acts on menuTarget); Windows' menu (Shift) needs the word selected to spell it
  const r = document.caretRangeFromPoint?.(e.clientX, e.clientY); if (!r || !doc.contains(r.startContainer)) return;
  const pick = document.createRange();
  if (r.startContainer.nodeType === 3) {
    const t = r.startContainer.data; let a = r.startOffset, b = a;
    while (a > 0 && /[\p{L}\p{N}'’-]/u.test(t[a - 1])) a--; while (b < t.length && /[\p{L}\p{N}'’-]/u.test(t[b])) b++;
    while (a < b && /['’-]/.test(t[a])) a++; while (b > a && /['’-]/.test(t[b - 1])) b--;
    pick.setStart(r.startContainer, a); pick.setEnd(r.startContainer, b);
  } else { pick.setStart(r.startContainer, r.startOffset); pick.collapse(true); }
  sel.removeAllRanges(); sel.addRange(pick);
}, true);
document.addEventListener('pointerup', e => {
  if (e.button !== 0 || !S.ctx) return;
  const t = e.target.closest?.('.menu--word [data-act]'); if (!t || t.disabled) return;
  DJM.upAt = performance.now(); DJM.upXY = [e.clientX, e.clientY]; e.preventDefault(); djCtxRun(t.dataset.act, S.ctx, t.dataset.v);
}, true);
document.addEventListener('click', e => {   // only the click that release makes: a real one (detail), at the same spot
  const xy = DJM.upXY || [0, 0];
  if (performance.now() - DJM.upAt < 600 && e.detail > 0 && Math.abs(e.clientX - xy[0]) < 6 && Math.abs(e.clientY - xy[1]) < 6) { DJM.upAt = 0; e.stopImmediatePropagation(); e.preventDefault(); }
}, true);
document.addEventListener('keydown', e => { if (e.key === 'Escape' && S.ctx?.kind === 'word') { e.stopImmediatePropagation(); e.preventDefault(); djCtxClose(true); } }, true);   // back to the word in the note (actions.js closes the others)
// A redraw puts each pane's scroll back, which fires scroll too: those (just after a draw) don't count; the wheel always does
// (QC 3 · 26: and where the draw put each scroll, since a hidden or busy window can send that scroll event much later)
const djmAfter = afterRender; afterRender = function () { djmAfter(); DJM.drawnAt = performance.now(); DJM.put = new Map([...app.querySelectorAll('.view')].map(v => [v, v.scrollTop])); };   // eslint-disable-line no-global-assign
document.addEventListener('scroll', e => {
  if (!S.ctx || e.target.closest?.('.menu--context') || performance.now() - (DJM.drawnAt || 0) <= 150 || DJM.put?.get(e.target) === e.target.scrollTop) return;
  djCtxClose();
}, true);
document.addEventListener('wheel', e => { if (S.ctx && !e.target.closest?.('.menu--context')) djCtxClose(); }, { capture: true, passive: true });
window.addEventListener('blur', () => djCtxClose());

/* ---- Fix A (QC 3 · 26): spelling in the note's right-click menu ----
   The browser draws the red line (spellcheck on the editor, Settings → Editor → Spell check), but its suggestions were only
   in Windows' own menu (Shift + right-click), which nobody finds. Now a word that isn't a known word (dict_spell: WordNet, your
   words, the small words WordNet leaves out) leads the menu with up to 5 "Did you mean" spellings: a click puts one in place
   of the word (one Undo step). "Ignore in this note" keeps the word as it is in that note (config spell_ignore), and its red
   line goes: the word is drawn inside spellcheck="false" (in the editor only; the .md is unchanged). */
const DJS = { ignore: {}, seq: 0 };
const djIgnored = (noteId, w) => !!noteId && (DJS.ignore[rawId(noteId)] || DJS.ignore[noteId] || []).includes(djNorm(w));
function djSpellAsk(c, doc) {
  if (!c || (!doc && !c.field)) return;
  if (doc) { const occ = djWordOccurrences(doc, c.word); c.nth = Math.max(0, occ.findIndex(o => o.node === c.node && c.offset >= o.start && c.offset <= o.end)); c.noteId = doc.dataset.note;
    const o = occ[c.nth], before = o && /([A-Za-z']{2,}) $/.exec(o.node.data.slice(0, o.start)); c.prev = before ? before[1] : null; }   // Build N (QC 76): the word before, for "ther eown" → there own
  if (!S.a11y.spell || (doc && djIgnored(c.noteId, c.word))) return;
  const k = djNorm(c.word), quick = SPELL[k];   // the few the app knows by heart answer at once
  if (quick) c.spell = { known: false, suggestions: [{ word: c.word[0] === c.word[0].toUpperCase() ? quick[0].toUpperCase() + quick.slice(1) : quick, mine: false }] };
  const seq = ++DJS.seq;
  dj('dict_spell', c.word, rawId(c.noteId), c.prev || null).then(r => {
    if (seq !== DJS.seq || S.ctx !== c || failed(r) || !r) return;
    const had = c.spell?.suggestions || [], merged = [...had, ...(r.suggestions || []).filter(x => !had.some(h => h.word.toLowerCase() === x.word.toLowerCase()))].slice(0, 5);
    c.spell = { known: r.known && !quick, suggestions: merged, checked: r.checked };
    const items0 = [...app.querySelectorAll('.menu--word .menu-item')], f = items0.indexOf(document.activeElement);
    renderAll(); djPlaceMenu(c); const items = app.querySelectorAll('.menu--word .menu-item'); (c.spell.known && f >= 0 ? items[f] : items[0])?.focus();
  });
}
// The menu grew (Did you mean): up so it ends inside the window, and the new place is kept for the next draw
function djPlaceMenu(c) {
  const m = app.querySelector('.menu--word'); if (!m) return;
  const over = m.offsetTop + m.offsetHeight - (app.offsetHeight - 8);
  if (over > 0) { c.y = Math.max(8, c.y - over); m.style.top = c.y + 'px'; }
}
function djSpellFix(c, to) {
  if (c.field) { fieldFix(c, to); return; }   // QC 4 · 30
  const doc = app.querySelector(`.doc[data-note="${CSS.escape(c.noteId || '')}"]`) || djDoc(); if (!doc?.isContentEditable || !to) { renderAll(); return; }
  const o = djWordOccurrences(doc, c.word)[c.nth || 0]; if (!o) { toast(`“${c.word}” isn't there any more`); renderAll(); return; }
  if (typeof edRecord === 'function') edRecord(doc, 'cmd');
  const span = o.node.parentElement.closest('.spell, .homophone, .spell-ok'); let t;
  const both = c.prev && c.spell?.suggestions?.some(x => x.word === to && x.span === 'prev') && o.node.data.slice(o.start - c.prev.length - 1, o.start) === c.prev + ' ';   // Build N (QC 76): it replaces the word before too
  if (both) { const r = document.createRange(); r.setStart(o.node, o.start - c.prev.length - 1); r.setEnd(o.node, o.end); r.deleteContents(); t = document.createTextNode(to); r.insertNode(t); }
  else if (span && span.textContent === c.word) { t = document.createTextNode(to); span.replaceWith(t); }
  else { const r = document.createRange(); r.setStart(o.node, o.start); r.setEnd(o.node, o.end); r.deleteContents(); t = document.createTextNode(to); r.insertNode(t); }
  doc.focus({ preventScroll: true }); const s = getSelection(), at = document.createRange(); at.setStart(t, t.length); at.collapse(true); s.removeAllRanges(); s.addRange(at);
  if (typeof edChanged === 'function') edChanged(doc); else noteEdited(note(), true);
  status(`Changed “${both ? c.prev + ' ' + c.word : c.word}” to “${to}” · Ctrl+Z puts it back`); renderAll();
}
function djSpellIgnore(c) {
  const id = rawId(c.noteId), n = D.notes.find(x => x.id === c.noteId); if (id == null) { renderAll(); return; }
  const list = DJS.ignore[id] = [...new Set([...(DJS.ignore[id] || []), djNorm(c.word)])];
  if (!DJ_CHECK) saveSettings({ spell_ignore: DJS.ignore });
  if (n) { if (n.docDirty) syncDoc(n); n.html = null; }   // drawn again, with the word inside spellcheck="false"
  // QC 54: with Undo for 10 seconds (Build L's bar), for a spelling and a style hint alike
  const k = djNorm(c.word), what = c.style && !(c.spell && !c.spell.known) ? 'style hint' : 'spelling';
  hold({ msg: `“${c.word}” is fine in this note: its ${what} line is gone`, back: `“${c.word}” is marked again in this note`, apply() {}, commit: async () => null,
    undo() { DJS.ignore[id] = (DJS.ignore[id] || []).filter(x => x !== k); if (!DJS.ignore[id].length) delete DJS.ignore[id];
      if (!DJ_CHECK) saveSettings({ spell_ignore: DJS.ignore }); if (n) { if (n.docDirty) syncDoc(n); n.html = null; } } });
  status(`“${c.word}” is fine in this note (${list.length} word${list.length === 1 ? '' : 's'} ignored here)`);
}
// The note's ignored words, inside spellcheck="false" (the converter keeps only their text when the note saves)
const djsMdToHtml = mdToHtml;
mdToHtml = function (n) {   // eslint-disable-line no-global-assign
  const html = djsMdToHtml(n), ws = (n && (DJS.ignore[rawId(n.id)] || DJS.ignore[n.id])) || [];
  if (!ws.length) return html;
  const re = new RegExp(`(^|[^\\p{L}'’])(${ws.map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace("'", "(?:'|’|&#39;)")).join('|')})(?![\\p{L}])`, 'giu');
  let inCode = 0;
  return html.split(/(<[^>]+>)/).map(seg => {
    if (seg.startsWith('<')) { if (/^<(code|pre)\b/.test(seg)) inCode++; if (/^<\/(code|pre)>/.test(seg)) inCode--; return seg; }
    return inCode ? seg : seg.replace(re, (m, pre, w) => `${pre}<span class="spell-ok" spellcheck="false">${w}</span>`);
  }).join('');
};

/* ---- Fix A (QC 3 · 26): Check spelling (F7, or ⋯ More → Check spelling), one misspelling at a time, as in Word ----
   The note's words go to spell_words in one call (your words, the note's ignored words, WordNet, then Windows' spell
   checker); each flagged word is shown in turn, in note order, selected in the note, with its suggestions (dict_spell):
   Replace (one Undo step each), Replace all, Ignore (this one), Ignore in this note, Add to your words. Code, links,
   [[wiki links]], embeds and the front matter are never checked. The card sits over the note's corner, not over the text. */
const SP = { on: false, loading: false, wrong: new Set(), skip: {}, cur: null, sugg: null, pick: 0, noteId: null, seq: 0, fixed: 0 };
const SP_SKIP = 'code, pre, a, .wikilink, [data-md], [contenteditable="false"], .spell-ok, .props, .att-src';
function spOccurrences(doc) {
  if (doc?.matches?.(SPELL_FIELDS)) return fieldOccs(doc);   // QC 4 · 30: a field you write in
  const out = [], w = document.createTreeWalker(doc, NodeFilter.SHOW_TEXT, { acceptNode: t => t.parentElement.closest(SP_SKIP) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT });
  const re = /[\p{L}][\p{L}'’-]*/gu; let t;
  while ((t = w.nextNode())) { let m; re.lastIndex = 0; while ((m = re.exec(t.data))) { const word = m[0].replace(/['’-]+$/, ''); if (word.length > 1) out.push({ node: t, start: m.index, end: m.index + word.length, word }); } }
  return out;
}
function spFind(doc) {   // the first flagged word in note order that hasn't been passed over (Ignore once)
  const seen = {};
  for (const o of spOccurrences(doc)) { const k = djNorm(o.word); if (!SP.wrong.has(k)) continue; seen[k] = (seen[k] || 0) + 1; if (seen[k] > (SP.skip[k] || 0)) return o; }
  return null;
}
const spLeft = doc => spOccurrences(doc).filter(o => SP.wrong.has(djNorm(o.word))).length - Object.values(SP.skip).reduce((a, b) => a + b, 0);
const spDoc = () => SP.field ? app.querySelector(SP.field) : app.querySelector(`.doc[data-note="${CSS.escape(SP.noteId || '')}"]`);   // the note, or the field (QC 4 · 30)
function spSelect(o) {   // the word, selected in the note (shown while the card has the keyboard) and on screen
  if (!o) return; if (o.field) { o.field.setSelectionRange(o.start, o.end); return; }
  const r = document.createRange(); r.setStart(o.node, o.start); r.setEnd(o.node, o.end);
  const s = getSelection(); s.removeAllRanges(); s.addRange(r);
  const v = o.node.parentElement.closest('.view'), b = r.getBoundingClientRect(), vb = v?.getBoundingClientRect();
  if (v && (b.top < vb.top + 80 || b.bottom > vb.bottom - 80)) v.scrollTop += b.top - (vb.top + vb.height / 3);
}
async function spStart() {
  // QC 4 · 30: in a field you write in (the Brain Dump, a sticky, a task…), that field; with "Only in notes", a word about it
  const fe = document.activeElement, kind = fe?.matches?.(SPELL_FIELDS) ? spellField(fe) : null;
  if (fe?.matches?.(SPELL_WRITE) && !kind) { status('Spelling help is on in notes only: Settings → Editor → Spelling and autocorrect work in'); return; }
  const field = kind === 'write' && fe.id ? '#' + CSS.escape(fe.id) : null, doc = field ? fe : djDoc();
  if (!field && !doc?.isContentEditable) { toast('Open a note to check its spelling'); return; }
  S.ctx = null; S.edMore = false; S.edPop = null; S.menu = false;   // QC 4 · 29: also from the note's ⋮ More
  Object.assign(SP, { on: true, loading: true, wrong: new Set(), skip: {}, cur: null, sugg: null, pick: 0, noteId: field ? null : doc.dataset.note, field, fixed: 0 });
  const words = [...new Set(spOccurrences(doc).map(o => o.word))], seq = ++SP.seq; renderAll();
  const r = await dj('spell_words', words, rawId(SP.noteId)); if (seq !== SP.seq || !SP.on) return;
  SP.loading = false; if (failed(r)) { SP.on = false; toast(r?.message || "The spelling couldn't be checked"); renderAll(); return; }
  SP.wrong = new Set(r.wrong.map(djNorm)); spNext();
}
function spNext() {
  const doc = spDoc(); if (!doc) { spClose(); return; }
  const o = spFind(doc), seq = ++SP.seq;
  SP.cur = o ? { word: o.word } : null; SP.sugg = null; SP.pick = 0; renderAll(); spSelect(spDoc() && spFind(spDoc()));
  app.querySelector(o ? '.spellpass [data-act="spell-replace"], .spellpass [data-act="spell-skip"]' : '.spellpass [data-act="spell-close"]')?.focus();
  if (!o) return;
  dj('dict_spell', o.word, rawId(SP.noteId)).then(r => {
    if (seq !== SP.seq || !SP.on || failed(r)) return;
    SP.sugg = r.suggestions || []; renderAll(); spSelect(spDoc() && spFind(spDoc()));
    app.querySelector(SP.sugg.length ? '.spellpass [data-act="spell-replace"]' : '.spellpass [data-act="spell-skip"]')?.focus();
  });
}
function spClose() { SP.on = false; SP.seq++; SP.cur = null; renderAll(); const d = spDoc() || djDoc(); d?.focus({ preventScroll: true }); }
function spReplace(all) {
  const doc = spDoc(), o = doc && spFind(doc), to = SP.sugg?.[SP.pick]?.word; if (!o || !to) return;
  const k = djNorm(o.word);
  if (SP.field) {   // QC 4 · 30: in a field, one change from the first to the last, so the field's Undo puts them all back at once
    const ts = all ? spOccurrences(doc).filter(x => djNorm(x.word) === k) : [o], a = ts[0].start, b = ts[ts.length - 1].end;
    let mid = doc.value.slice(a, b); [...ts].reverse().forEach(x => { mid = mid.slice(0, x.start - a) + (x.word === o.word ? to : winCase(x.word, to)) + mid.slice(x.end - a); });
    fieldPut(doc, a, b, mid); SP.fixed += ts.length; if (all) { SP.wrong.delete(k); delete SP.skip[k]; }
    status(all ? `Changed every “${o.word}” to “${to}” (${ts.length}) · Ctrl+Z puts them back` : `Changed “${o.word}” to “${to}” · Ctrl+Z puts it back`); spNext(); return;
  }
  if (typeof edRecord === 'function') edRecord(doc, 'cmd');
  const targets = all ? spOccurrences(doc).filter(x => djNorm(x.word) === k).reverse() : [o];   // from the end, so the places stay right
  targets.forEach(x => { const r = document.createRange(); r.setStart(x.node, x.start); r.setEnd(x.node, x.end); r.deleteContents(); r.insertNode(document.createTextNode(x.word === o.word ? to : winCase(x.word, to))); });
  doc.normalize(); if (typeof edChanged === 'function') edChanged(doc); else noteEdited(note(), true);
  SP.fixed += targets.length; if (all) { SP.wrong.delete(k); delete SP.skip[k]; }
  status(all ? `Changed every “${o.word}” to “${to}” (${targets.length}) · Ctrl+Z puts them back` : `Changed “${o.word}” to “${to}” · Ctrl+Z puts it back`);
  spNext();
}
const winCase = (w, to) => w === w.toUpperCase() && w.length > 1 ? to.toUpperCase() : w[0] === w[0].toUpperCase() ? to[0].toUpperCase() + to.slice(1) : to.toLowerCase();
function spAct(act, v) {
  const w = SP.cur?.word, k = w && djNorm(w);
  if (act === 'spell-pass') { if (SP.on) spClose(); else spStart(); return; }
  if (act === 'spell-close') { spClose(); return; }
  if (!w) return;
  if (act === 'spell-pick') { SP.pick = +v || 0; renderAll(); spSelect(spDoc() && spFind(spDoc())); app.querySelector(`.spellpass [data-act="spell-pick"][data-v="${SP.pick}"]`)?.focus(); return; }
  if (act === 'spell-replace') spReplace(false);
  else if (act === 'spell-replace-all') spReplace(true);
  else if (act === 'spell-skip') { SP.skip[k] = (SP.skip[k] || 0) + 1; spNext(); }
  else if (act === 'spell-ignore') {
    const id = rawId(SP.noteId), n = D.notes.find(x => x.id === SP.noteId);
    if (id != null) { DJS.ignore[id] = [...new Set([...(DJS.ignore[id] || []), k])]; if (!DJ_CHECK) saveSettings({ spell_ignore: DJS.ignore }); }
    if (n) { if (n.docDirty) syncDoc(n); n.html = null; }
    SP.wrong.delete(k); status(`“${w}” is fine in this note`); spNext();
  } else if (act === 'spell-add') {
    dj('dict_word_save', { word: w, pos: 'noun', definition: 'Added from Check spelling: give it a meaning in the Dictionary any time.' }).then(async r => {
      if (failed(r)) { toast(r.message || "Couldn't add the word"); return; }
      await djRefresh(false); SP.wrong.delete(k); status(`Added “${w}” to your words`); spNext();
    });
  }
}
function spellPassCard() {
  if (!SP.on) return '';
  const b = (act, label, cls = 'btn--secondary', extra = '') => `<button class="btn ${cls} btn--sm" data-act="${act}" ${extra}>${label}</button>`;
  const head = `<div class="pop-head"><span class="spellpass-title">Check spelling</span><button class="icon-btn icon-btn--sm" data-act="spell-close" aria-label="Close Check spelling" title="Close (Esc)">${ic('x')}</button></div>`;
  if (SP.loading) return `<div class="card popover spellpass${SP.field ? ' spellpass--field' : ''}" role="dialog" aria-label="Check spelling">${head}<div class="spellpass-msg">${SP.field ? 'Checking…' : 'Checking the note…'}</div></div>`;
  if (!SP.cur) return `<div class="card popover spellpass${SP.field ? ' spellpass--field' : ''}" role="dialog" aria-label="Check spelling">${head}<div class="spellpass-msg">${SP.fixed ? `Done: ${SP.fixed} fixed.` : 'No spelling mistakes found.'} ${SP.field ? 'The rest looks right.' : 'The rest of the note looks right.'}</div>
    <div class="spellpass-acts">${b('spell-close', 'Close', 'btn--primary')}</div></div>`;
  const doc = spDoc(), o = doc && spFind(doc), t = o ? (o.field ? o.field.value : o.node.data) : '', a = o ? Math.max(0, o.start - 40) : 0, z = o ? Math.min(t.length, o.end + 40) : 0;
  const ctx = o ? `${a ? '…' : ''}${esc(t.slice(a, o.start))}<mark>${esc(t.slice(o.start, o.end))}</mark>${esc(t.slice(o.end, z))}${z < t.length ? '…' : ''}` : esc(SP.cur.word);
  const left = doc ? spLeft(doc) : 0, sg = SP.sugg;
  const list = !sg ? '<div class="spellpass-msg">Finding spellings…</div>' : sg.length
    ? `<div class="spellpass-sugg" role="listbox" aria-label="Suggestions">${sg.map((x, i) => `<button class="list-item spellpass-opt" role="option" data-act="spell-pick" data-v="${i}" aria-selected="${i === SP.pick}">${esc(x.word)}${x.mine ? '<span class="dict-mine">Yours</span>' : ''}</button>`).join('')}</div>`
    : '<div class="spellpass-msg">No close spelling.</div>';
  return `<div class="card popover spellpass${SP.field ? ' spellpass--field' : ''}" role="dialog" aria-label="Check spelling: ${esc(SP.cur.word)}">${head}
    <div class="eyebrow">Not a known word · ${left} left</div><div class="spellpass-ctx">${ctx}</div>${list}
    <div class="spellpass-acts">${b('spell-replace', 'Replace', 'btn--primary', sg?.length ? '' : 'disabled')}${b('spell-replace-all', 'Replace all', 'btn--secondary', sg?.length ? '' : 'disabled')}${b('spell-skip', 'Ignore')}</div>
    <div class="spellpass-acts">${SP.field ? '' : b('spell-ignore', 'Ignore in this note', 'btn--ghost')}${b('spell-add', 'Add to your words', 'btn--ghost')}</div></div>`;
}
const spModal = renderModal; renderModal = () => spellPassCard() + spModal();   // eslint-disable-line no-global-assign
const spAfter = afterRender; afterRender = function () { spAfter(); if (SP.on && SP.cur && document.activeElement?.closest?.('.spellpass')) { const d = spDoc(); if (d) spSelect(spFind(d)); } };   // eslint-disable-line no-global-assign
document.getElementById('app').addEventListener('click', e => { const t = e.target.closest('[data-act^="spell-"]'); if (t && !t.disabled) spAct(t.dataset.act, t.dataset.v); });
document.addEventListener('keydown', e => {
  if (e.key === 'F7' && !e.ctrlKey && !e.altKey) { e.preventDefault(); spAct('spell-pass'); return; }
  if (!SP.on || !e.target.closest?.('.spellpass')) return;
  if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); spClose(); }
  else if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && SP.sugg?.length) { e.preventDefault(); spAct('spell-pick', String(clamp(SP.pick + (e.key === 'ArrowDown' ? 1 : -1), 0, SP.sugg.length - 1))); }
}, true);

/* ---- Fix A (QC 3 · 26): autocorrect as you type (Settings → Editor → Autocorrect) ----
   When a word is finished (a space, punctuation or Enter), autocorrect_word says whether it's a clear slip (teh → the,
   understadn → understand) and the word becomes that spelling, a moment later, if it's still there. A short underline
   marks it (a CSS highlight: the note's text isn't touched for it). Backspace straight after, or Ctrl+Z, gives back what
   was typed, and that word isn't corrected again in the note. Never in code, links, [[wiki links]], URLs, paths, #tags,
   emails, the front matter, a word in capitals or with a capital inside, a name (a capital mid-sentence), your words or
   the words the setting lists. */
const ACOR = { cfg: { on: true, strength: 'obvious', never: [] }, last: null, skip: {}, busy: 0 };   // busy: answers still to come (the tests wait on it)
const ACOR_DEF = { on: true, strength: 'obvious', never: [] };
const ACOR_END = /^[\s.,;:!?)\]}"'’»…]$/;
const ACOR_SKIP = 'code, pre, a, .wikilink, [data-md], [contenteditable="false"], .spell-ok, .props, h1 .tag';
function acWordBefore(node, off) {   // the word that ends at off in a text node
  if (node?.nodeType !== 3 || node.parentElement.closest(ACOR_SKIP)) return null;
  const w = acWordIn(node.data.slice(0, off)); return w && { node, ...w };
}
function acWordIn(before) {   // the word that ends the text, and why it may not be corrected (a note's text, or a field's: QC 4 · 30)
  const m = /([\p{L}][\p{L}'’]*)$/u.exec(before); if (!m) return null;
  const word = m[1].replace(/['’]+$/, ''), start = m.index, token = /\S*$/.exec(before)[0];
  if (word.length < 3 || /[\/\\:@#_.\d=<>`~]/.test(token.slice(0, token.length - m[1].length)) || /\[\[[^\]]*$/.test(before) || (before.split('`').length - 1) % 2) return null;
  if (word === word.toUpperCase() || /\p{Lu}/u.test(word.slice(1))) return null;
  if (/^\p{Lu}/u.test(word)) { const prev = before.slice(0, start).trimEnd(); if (prev && !/[.!?:]$/.test(prev)) return null; }   // a name, mid-sentence
  return { start, end: start + word.length, word };
}
function acFlash(node, start, end) {
  if (!window.CSS?.highlights || typeof Highlight === 'undefined') return;
  const r = document.createRange(); r.setStart(node, start); r.setEnd(node, end); CSS.highlights.set('nv-autocorrect', new Highlight(r));
  clearTimeout(acFlash.t); acFlash.t = setTimeout(() => CSS.highlights.delete('nv-autocorrect'), 1400);
}
// The word before the caret, just before the key that ends it goes in
app.addEventListener('beforeinput', e => {
  if (e.target.matches?.(SPELL_FIELDS)) { acField(e, e.target); return; }   // QC 4 · 30: a field you write in (the Brain Dump, a sticky, a task…)
  let doc = e.target.closest?.('.doc'); if (!doc?.isContentEditable || !ACOR.cfg.on) return;
  const t = e.inputType; if (!((t === 'insertText' && e.data && ACOR_END.test(e.data)) || t === 'insertParagraph' || t === 'insertLineBreak')) { if (!/^history/.test(t)) ACOR.last = null; return; }
  const s = getSelection(); if (!s.rangeCount || !s.getRangeAt(0).collapsed) return;
  const r = s.getRangeAt(0), w = acWordBefore(r.startContainer, r.startOffset); ACOR.last = null; if (!w) return;
  const noteId = doc.dataset.note; if ((ACOR.skip[noteId] || new Set()).has(w.word.toLowerCase())) return;
  w.abs = edOffset(doc, w.node, w.start);   // where it is in the note's text, if a redraw (an autosave) rebuilds the note meanwhile
  const log = m => { if (ACOR.debug) (ACOR.log ||= []).push(`${w.word}: ${m}`); };   // ACOR.debug = true in the console to see why
  ACOR.busy++; setTimeout(() => dj('autocorrect_word', w.word, rawId(noteId)).then(res => {   // each word on its own: typing on doesn't cancel it
    log(`answer ${res?.to} (${res?.why})`);
    if (failed(res) || !res?.to || res.to === w.word) return;
    if (w.node.isConnected && w.node.data.slice(w.start, w.end) !== w.word) {   // Build N (QC 76): an earlier correction in the same line moved it a little
      const at = acNear(w.node.data, w.word, w.start); if (at >= 0) Object.assign(w, { start: at, end: at + w.word.length });
    }
    if (!w.node.isConnected || w.node.data.slice(w.start, w.end) !== w.word) {
      log(`moved: connected ${w.node.isConnected}, text "${w.node.data.slice(w.start, w.end)}"`);
      const d2 = app.querySelector(`.doc[data-note="${CSS.escape(noteId)}"]`); if (!d2) return;
      let [n2, o2] = edPoint(d2, w.abs); if (n2?.nodeType === 3 && o2 === n2.length) { const nx = document.createTreeWalker(d2, NodeFilter.SHOW_TEXT); nx.currentNode = n2; const t2 = nx.nextNode(); if (t2) { n2 = t2; o2 = 0; } }
      if (n2?.nodeType !== 3 || n2.data.slice(o2, o2 + w.word.length) !== w.word) { log(`not found again at ${w.abs}: "${n2?.data?.slice(o2, o2 + w.word.length)}"`); return; }
      Object.assign(w, { node: n2, start: o2, end: o2 + w.word.length }); doc = d2;
    }
    const sel = getSelection(), at = sel.rangeCount && sel.getRangeAt(0), same = at && at.collapsed && at.startContainer === w.node, off = same ? at.startOffset : null;
    if (typeof edRecord === 'function') edRecord(doc, 'cmd');   // Ctrl+Z gives back the word as typed
    w.node.replaceData(w.start, w.word.length, res.to);
    if (same) { const pos = off + res.to.length - w.word.length; edPut([w.node, Math.max(w.start + res.to.length, pos)]); }
    acFlash(w.node, w.start, w.start + res.to.length);
    ACOR.last = { doc, node: w.node, start: w.start, from: w.word, to: res.to, noteId, after: same ? off + res.to.length - w.word.length : null };
    if (typeof edChanged === 'function') edChanged(doc);
  }).finally(() => { ACOR.busy--; }), 0);
});
// Backspace straight after a correction (nothing typed since) gives the word back as typed; so does Ctrl+Z
app.addEventListener('keydown', e => {
  const L = ACOR.last; if (!L) return;
  const k = e.key.toLowerCase(), undo = (e.ctrlKey || e.metaKey) && k === 'z' && !e.shiftKey;
  if (undo) { (ACOR.skip[L.noteId] ||= new Set()).add(L.from.toLowerCase()); acLearnUndo(L); ACOR.last = null; return; }   // editor.js undoes it (the step before the change)
  if (e.key !== 'Backspace' || e.ctrlKey || e.altKey) { if (!['Shift', 'Control', 'Alt', 'Meta'].includes(e.key)) ACOR.last = null; return; }
  if (L.field) { acFieldBack(e, L); return; }   // QC 4 · 30
  const s = getSelection(), r = s.rangeCount && s.getRangeAt(0);
  if (!r || !r.collapsed || r.startContainer !== L.node || L.after == null || r.startOffset !== L.after || L.node.data.slice(L.start, L.start + L.to.length) !== L.to) { ACOR.last = null; return; }
  e.preventDefault(); e.stopImmediatePropagation();
  if (typeof edRecord === 'function') edRecord(L.doc, 'cmd');
  L.node.replaceData(L.start, L.to.length, L.from); edPut([L.node, L.after + L.from.length - L.to.length]);
  (ACOR.skip[L.noteId] ||= new Set()).add(L.from.toLowerCase()); acLearnUndo(L); ACOR.last = null; CSS.highlights?.delete('nv-autocorrect');
  status(`Kept “${L.from}” as typed · it won't be corrected again in this note`);
  if (typeof edChanged === 'function') edChanged(L.doc);
}, true);

// Settings → Editor → Spelling and autocorrect (QC 4 · 41): one flat group, as the rows around it (it was a boxed card from
// the Dictionary page, and the spelling settings were in three places). Reset, at its foot, only when something differs
function acSave(patch) { Object.assign(ACOR.cfg, patch); if (!DJ_CHECK) saveSettings({ autocorrect: ACOR.cfg.on, autocorrect_strength: ACOR.cfg.strength, autocorrect_never: ACOR.cfg.never }); }
const acDiffers = () => ACOR.learnNotes === false || ACOR.cfg.on !== ACOR_DEF.on || ACOR.cfg.strength !== ACOR_DEF.strength || ACOR.cfg.never.length > 0 || SPW.where !== 'everywhere' || !S.a11y.spell;
function acCard() {
  const c = ACOR.cfg, row = (id, label, desc, ctl) => `<div class="set-row"><div><div class="set-label" id="${id}">${label}</div><div class="set-desc">${desc}</div></div>${ctl}</div>`;
  const seg = [['obvious', 'Only obvious slips'], ['more', 'More']].map(([v, l]) => `<button class="seg-opt" data-act="ac-strength" data-v="${v}" aria-pressed="${c.strength === v}">${l}</button>`).join('');
  return `<div class="pop-sec sp-set" id="sp-set"><div class="eyebrow" id="sp-set-h" tabindex="-1">Spelling and autocorrect</div>
    ${a11yTog('spell', 'Spell check', 'A red dotted line under words that look misspelled; right-click one for spellings to swap in. The line uses the spelling languages set in Windows (Settings → Time &amp; language → Language); the suggestions are English')}${spellWhereRow()}
    ${row('ac-on', 'Autocorrect as you type', 'When you finish a word, a clear slip becomes its spelling (teh → the). Backspace straight after keeps what you typed', `<button class="toggle" role="switch" aria-checked="${c.on}" aria-labelledby="ac-on" data-act="ac-toggle"></button>`)}
    ${row('ac-strength', 'How sure it must be', 'Obvious slips: one letter off, with no other word as close. More: two letters off', `<div class="seg" role="group" aria-labelledby="ac-strength">${seg}</div>`)}
    ${row('ac-learn', 'Learn from my notes', 'Words you use in your notes count as used more, so they win when a slip could be two words, and a word you use often isn’t corrected. On this PC only', `<button class="toggle" role="switch" aria-checked="${ACOR.learnNotes !== false}" aria-labelledby="ac-learn" data-act="ac-learn"></button>`)}
    ${row('ac-learned', 'What it learned', acLearnedText(), `<button class="btn btn--secondary btn--sm" data-act="ac-forget"${ACOR.learned && !ACOR.learned.undone && !ACOR.learned.words ? ' disabled' : ''}>Clear what it learned</button>`)}
    ${row('ac-never', 'Words never to correct', 'Names and words of your own, separated by commas', `<input class="field" id="ac-never-field" data-act="ac-never" value="${esc(c.never.join(', '))}" placeholder="e.g. Alex, ETL" aria-labelledby="ac-never" spellcheck="false">`)}
    ${acDiffers() ? '<div class="set-foot"><button class="link-btn" data-act="ac-reset">Reset spelling and autocorrect</button></div>' : ''}</div>`;
}
const acPane = settingsPane;
settingsPane = function (sec) { const h = acPane(sec); return sec === 'editor' ? h + acCard() : h; };   // eslint-disable-line no-global-assign
document.getElementById('app').addEventListener('click', e => {
  const t = e.target.closest('[data-act^="ac-"]'); if (!t || t.dataset.act === 'ac-never') return;
  if (t.dataset.act === 'ac-toggle') { acSave({ on: !ACOR.cfg.on }); status(ACOR.cfg.on ? 'Autocorrect is on' : 'Autocorrect is off'); S.focus = { sel: '[data-act="ac-toggle"]' }; }
  else if (t.dataset.act === 'ac-strength') { acSave({ strength: t.dataset.v }); status(t.dataset.v === 'more' ? 'Autocorrect fixes more slips' : 'Autocorrect fixes only obvious slips'); S.focus = { sel: `[data-act="ac-strength"][data-v="${t.dataset.v}"]` }; }
  else if (t.dataset.act === 'ac-learn') { ACOR.learnNotes = ACOR.learnNotes === false; if (!DJ_CHECK) saveSettings({ autocorrect_learn_notes: ACOR.learnNotes }); ACOR.learned = null; status(ACOR.learnNotes ? 'Autocorrect learns from your notes' : 'Autocorrect doesn’t learn from your notes'); S.focus = { sel: '[data-act="ac-learn"]' }; }
  else if (t.dataset.act === 'ac-forget') { dj('autocorrect_forget').then(r => { if (!failed(r)) ACOR.learned = r; status('Autocorrect forgot what it learned: the corrections you undid and the words from your notes'); S.focus = { sel: '[data-act="ac-forget"]' }; renderAll(); }); return; }
  else if (t.dataset.act === 'ac-reset') {   // the whole group: Spell check on, everywhere you write, autocorrect as it came
    acSave({ ...ACOR_DEF, never: [] }); SPW.where = 'everywhere'; ACOR.learnNotes = true; if (!DJ_CHECK) saveSettings({ spell_where: 'everywhere', autocorrect_learn_notes: true });
    if (!S.a11y.spell) { setComfort('spell', true); D.notes.forEach(n => { n.html = null; }); }
    status('Spelling and autocorrect are back to how they came'); S.focus = { sel: '#sp-set-h' }; }
  else return;
  renderAll();
});
document.getElementById('app').addEventListener('change', e => {
  if (e.target.dataset?.act !== 'ac-never') return;
  const never = [...new Set(e.target.value.split(/[,\n]+/).map(x => x.trim().toLowerCase()).filter(Boolean))].slice(0, 500);
  acSave({ never }); status(never.length ? `${never.length} word${never.length === 1 ? '' : 's'} never corrected` : 'No words kept from autocorrect'); S.focus = { sel: '#ac-never-field' }; renderAll();
});

/* ---- Fix A (QC 4 · 30): where spelling help works (Settings → Editor → "Spelling and autocorrect work in") ----
   Everywhere you write (the default): notes, the Brain Dump, sticky notes, task names (a new task, its steps, tomorrow's
   starters), Timer and Timeline notes (check-ins, the wrap-up) and your own word's meaning; QC 102 adds the Ask chat's input,
   Brain Dump's add box, the photo mark-up's text tool and Tidy up's own rule (photo captions and pin notes are the note's own). Only in notes: notes and their
   titles. Never search boxes, names, paths, code, links or Raw .md. The red line (spellcheck), the right-click suggestions,
   Check spelling (F7) and autocorrect all follow it. A note's title counts as the note, without autocorrect (it's the file's name). */
const SPW = { where: 'everywhere' };
const SPELL_FIELDS = 'textarea, input:not([type]), input[type="text"], input[type="search"]';
const SPELL_WRITE = '#dump-input, .sticky-text, #new-task-title, #new-step-text, #wrap-starter-input, #milestone-input, #qt-milestone, #wrap-win-text, #wrap-note, #dict-f-def, #dict-f-ex'
  + ', #aic-in, #ain-ask-q, #ld-add, #phe-textin, #ain-rule';   // Build N (QC 102): the Ask chat (docked, a tab or its own window), Brain Dump's add box, the photo mark-up's text, Tidy up's own rule
function spellField(el) {   // 'note' (the note's title), 'write' (a field you write in, with Everywhere) or null
  if (!el?.matches?.(SPELL_FIELDS) || el.readOnly || el.disabled || !el.id) return null;
  if (el.id === 'note-title-input') return 'note';
  return SPW.where === 'everywhere' && el.matches(SPELL_WRITE) ? 'write' : null;
}
function spellPaint() { app.querySelectorAll(SPELL_FIELDS).forEach(el => { const on = !!S.a11y.spell && !!spellField(el); if (el.spellcheck !== on) el.spellcheck = on; }); }
function fieldOccs(el) {   // a field's words, as Check spelling sees them: not in `code`, [[links]], web addresses, emails or paths
  const t = el?.value || '', out = [], skip = [...t.matchAll(/`[^`\n]*`|\[\[[^\]\n]*\]\]|\S*(?::\/\/|@|[\\/])\S*/g)].map(m => [m.index, m.index + m[0].length]);
  for (const m of t.matchAll(/[\p{L}][\p{L}'’-]*/gu)) { const word = m[0].replace(/['’-]+$/, ''); if (word.length > 1 && !skip.some(([a, b]) => m.index >= a && m.index < b)) out.push({ field: el, start: m.index, end: m.index + word.length, word }); }
  return out;
}
function fieldPut(el, a, b, to) {   // the field's own handlers see the change (a sticky saves as you type), and Ctrl+Z puts it back
  const before = el.value, sel = '#' + CSS.escape(el.id);
  el.focus({ preventScroll: true }); el.setSelectionRange(a, b);
  if (!document.execCommand('insertText', false, to)) { el.setRangeText(to, a, b, 'end'); el.dispatchEvent(new Event('input', { bubbles: true })); }
  FUNDO.last = { sel, before, after: (app.querySelector(sel) || el).value, caret: b };
}
// A redraw replaces a field, and the browser's own Undo with it: the last spelling change in a field is kept here instead
const FUNDO = { last: null };
document.addEventListener('keydown', e => {
  const L = FUNDO.last, f = document.activeElement; if (!L || !((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !e.shiftKey)) return;
  FUNDO.last = null; if (!f?.matches?.(L.sel) || f.value !== L.after) return;
  e.preventDefault(); f.value = L.before; f.setSelectionRange(L.caret, L.caret); f.dispatchEvent(new Event('input', { bubbles: true }));
}, true);
function fieldFix(c, to) {
  const el = app.querySelector(c.field); if (!el || !to) { renderAll(); return; }
  const a = el.value.slice(c.start, c.end) === c.word ? c.start : el.value.indexOf(c.word); if (a < 0) { toast(`“${c.word}” isn't there any more`); renderAll(); return; }
  fieldPut(el, a, a + c.word.length, to); status(`Changed “${c.word}” to “${to}” · Ctrl+Z puts it back`); renderAll();
}
function fieldWordAt(el, x, y) {   // the word under the pointer in a field (or the word that's selected, if the pointer is on it)
  const p = document.caretPositionFromPoint?.(x, y), t = el.value, s0 = el.selectionStart, s1 = el.selectionEnd;
  const off = p?.offsetNode === el ? p.offset : s0; if (off == null) return null;
  if (s1 > s0 && off >= s0 && off <= s1 && /^[\p{L}'’-]{2,40}$/u.test(t.slice(s0, s1))) return { word: t.slice(s0, s1), start: s0, end: s1 };
  let a = off, b = off;
  while (a > 0 && /[\p{L}'’-]/u.test(t[a - 1])) a--; while (b < t.length && /[\p{L}'’-]/u.test(t[b])) b++;
  while (a < b && /['’-]/.test(t[a])) a++; while (b > a && /['’-]/.test(t[b - 1])) b--;
  return b - a > 1 ? { word: t.slice(a, b), start: a, end: b } : null;
}
// A right-click in a field selects just the word under the pointer (or keeps the selection it lands in), as in a note
document.addEventListener('mousedown', e => {
  if (e.button !== 2 || djShifted(e) || !S.a11y.spell || !spellField(e.target)) return;
  const el = e.target, w = fieldWordAt(el, e.clientX, e.clientY); if (!w) return;
  e.preventDefault(); el.focus({ preventScroll: true }); el.setSelectionRange(w.start, w.end);
}, true);
function djFieldMenu(e, el) {
  if (!S.a11y.spell || !spellField(el)) return;   // other fields (a search box…) keep the browser's own menu
  const w = fieldWordAt(el, e.clientX, e.clientY); if (!w) return;
  e.preventDefault();
  const r = app.getBoundingClientRect(), z = r.width / app.offsetWidth || 1;
  S.ctx = { kind: 'word', ...w, field: '#' + CSS.escape(el.id), node: null, offset: 0, cx: e.clientX, cy: e.clientY, x: Math.max(4, Math.min((e.clientX - r.left) / z, app.offsetWidth - 280)), y: Math.max(4, Math.min((e.clientY - r.top) / z, app.offsetHeight - 220)) };
  if (S.modal === 'word') { S.modal = null; S.word = null; }
  djSpellAsk(S.ctx, null); renderAll(); app.querySelector('.menu--word .menu-item')?.focus();
}
// Autocorrect in a field you write in: the same rules as in a note (not in `code`, [[links]], addresses, capitals or names)
function acField(e, el) {
  if (!ACOR.cfg.on || spellField(el) !== 'write') return;
  const t = e.inputType; if (!((t === 'insertText' && e.data && ACOR_END.test(e.data)) || t === 'insertLineBreak')) { if (!/^history/.test(t)) ACOR.last = null; return; }
  if (el.selectionStart !== el.selectionEnd) return;
  const w = acWordIn(el.value.slice(0, el.selectionStart)); ACOR.last = null; if (!w) return;
  const sel = '#' + CSS.escape(el.id), key = 'field:' + el.id; if ((ACOR.skip[key] || new Set()).has(w.word.toLowerCase())) return;
  ACOR.busy++; setTimeout(() => dj('autocorrect_word', w.word, null).then(res => {
    if (failed(res) || !res?.to || res.to === w.word) return;
    const f = app.querySelector(sel); if (!f || document.activeElement !== f || f.value.slice(w.start, w.end) !== w.word) return;   // typed on past it, or left the field: as it is
    const s0 = f.selectionStart, s1 = f.selectionEnd, d = res.to.length - w.word.length, mv = p => p >= w.end ? p + d : p;
    fieldPut(f, w.start, w.end, res.to); FUNDO.last.caret = s0;   // Ctrl+Z: the word as typed, the caret where it was
    const f2 = app.querySelector(sel) || f; f2.setSelectionRange(mv(s0), mv(s1));
    ACOR.last = { field: sel, start: w.start, from: w.word, to: res.to, noteId: key, after: mv(s0) };
    status(`Corrected “${w.word}” to “${res.to}” · Backspace keeps what you typed`);   // a field can't show the underline flash
  }).finally(() => { ACOR.busy--; }), 0);
}
function acFieldBack(e, L) {   // Backspace straight after a correction in a field: the word as typed
  const f = document.activeElement;
  if (!f?.matches?.(L.field) || f.selectionStart !== L.after || f.selectionEnd !== L.after || f.value.slice(L.start, L.start + L.to.length) !== L.to) { ACOR.last = null; return; }
  e.preventDefault(); e.stopImmediatePropagation();
  fieldPut(f, L.start, L.start + L.to.length, L.from); FUNDO.last = null; const p = L.after + L.from.length - L.to.length; (app.querySelector(L.field) || f).setSelectionRange(p, p);
  (ACOR.skip[L.noteId] ||= new Set()).add(L.from.toLowerCase()); acLearnUndo(L); ACOR.last = null;
  status(`Kept “${L.from}” as typed · it won't be corrected again`);
}
/* ---- Build N (QC 76): autocorrect learns on this PC (design profile "Autocorrect feels like Gboard and learns from you").
   A correction you undo (Backspace or Ctrl+Z straight after) isn't made again for that word, in any note; Settings → Editor shows
   what it learned and clears it. Nothing leaves this PC. ---- */
function acNear(text, word, from, span = 40) {   // the whole word nearest to `from` (within span), or -1: typing fast, answers land after more words
  let best = -1; for (let d = 0; d <= span && best < 0; d++) for (const i of d ? [from - d, from + d] : [from]) {
    if (i < 0 || text.slice(i, i + word.length) !== word || /[\p{L}'’]/u.test(text[i - 1] || '') || /[\p{L}'’]/u.test(text[i + word.length] || '')) continue; best = i; break; }
  return best;
}
function acLearnUndo(L) { if (L?.from) dj('autocorrect_learn', L.from, L.to, 'undone').then(r => { if (!failed(r)) ACOR.learned = r; }); }
function acLearnedText() {
  const L = ACOR.learned;
  if (!L) { if (!ACOR.learnedAsk) { ACOR.learnedAsk = true; dj('autocorrect_learned').then(r => { ACOR.learnedAsk = false; if (!failed(r)) { ACOR.learned = r; if (S.modal === 'settings' || UI.view === 'settings') renderAll(); } }); } return 'Counting…'; }
  const n = (k, one, many) => `${L[k]} ${L[k] === 1 ? one : many}`;
  return `${n('undone', 'correction you undid', 'corrections you undid')} (not made again) · ${n('words', 'word of yours', 'words of yours')} from your notes${L.list ? '' : ' · the word list isn’t downloaded, so autocorrect uses Windows’ spellings only'}`;
}
// Check spelling on a field: the card sits under the field (or over it, if there's no room), kept inside the window
function spPlace() {
  const c = app.querySelector('.spellpass'), el = SP.field && app.querySelector(SP.field); if (!c || !el) return;
  const P = c.offsetParent || document.body, pr = P.getBoundingClientRect(), z = pr.width / P.offsetWidth || 1, b = el.getBoundingClientRect(), H = P.clientHeight, W = P.clientWidth;
  let top = (b.bottom - pr.top) / z + 6; if (top + c.offsetHeight > H - 8) top = (b.top - pr.top) / z - c.offsetHeight - 6; if (top < 8) top = 8;
  c.style.top = top + 'px'; c.style.right = 'auto'; c.style.left = Math.max(8, Math.min((b.left - pr.left) / z, W - c.offsetWidth - 8)) + 'px';
  if (top + c.offsetHeight > H - 8) { c.style.maxHeight = (H - top - 8) + 'px'; c.style.overflowY = 'auto'; }
}
const spwAfter = afterRender; afterRender = function () { spwAfter(); spellPaint(); spPlace(); };   // eslint-disable-line no-global-assign
// A popped-out sticky or timer draws itself (popout.js): its fields, its right-click menu and its Check spelling card too
const spwPop = renderPop;
renderPop = function () {   // eslint-disable-line no-global-assign
  spwPop(); app.insertAdjacentHTML('beforeend', spellPassCard() + (S.ctx?.kind === 'word' ? djWordMenu(S.ctx) : ''));
  spellPaint(); spPlace();
};
// Settings → Editor, under Spell check
function spellWhereRow() {
  const opt = (v, l) => `<button class="seg-opt" data-act="spw" data-v="${v}" aria-pressed="${SPW.where === v}">${l}</button>`;
  return `<div class="set-row"><div><div class="set-label" id="set-spw">Spelling and autocorrect work in</div><div class="set-desc">Everywhere you write: notes (captions and pin notes too), the Ask chat, the Brain Dump, sticky notes, tasks, the wrap-up, Timer and Timeline notes, and text on a photo. Never in search boxes, code, links or Raw .md</div></div><div class="seg" role="group" aria-labelledby="set-spw">${opt('everywhere', 'Everywhere you write')}${opt('notes', 'Only in notes')}</div></div>`;
}
document.getElementById('app').addEventListener('click', e => {
  const t = e.target.closest('[data-act="spw"]'); if (!t) return;
  SPW.where = t.dataset.v === 'notes' ? 'notes' : 'everywhere'; if (!DJ_CHECK) saveSettings({ spell_where: SPW.where });
  status(SPW.where === 'notes' ? 'Spelling help works in notes only' : 'Spelling help works everywhere you write'); S.focus = { sel: `[data-act="spw"][data-v="${SPW.where}"]` }; renderAll();
});
/* ===================================================================== end Build J · dictionary */

/* ==== Build M · QC 54: "Ignore in this note" also takes a word's blue style line (the homophone guard: quite / quiet, their /
   there…), kept per note in config spell_ignore like ignored spellings, with Undo. The note's ignored words lose both marks. ==== */
{ const igMd0 = mdToHtml;
  mdToHtml = function (n) {   // eslint-disable-line no-global-assign
    const h = igMd0(n), ws = (n && (DJS.ignore[rawId(n.id)] || DJS.ignore[n.id])) || []; if (!ws.length) return h;
    return h.replace(/<span class="(?:homophone|spell)" data-word="([^"]+)"[^>]*>((?:<span class="spell-ok"[^>]*>[^<]*<\/span>)|[^<]*)<\/span>/g,
      (m, w, inner) => ws.includes(djNorm(w.replace(/&#39;/g, "'"))) ? inner : m);
  };
}
/* ==== end Build M · QC 54 ==== */

/* ==== Build N · QC 102 (feedback: "auto correct and spellchecker not functional in the ai chat bot"): the same spelling help in
   every box you write prose in (SPELL_WRITE above): the dotted line, the right-click suggestions, F7 and autocorrect with its
   learning, Backspace and Ctrl+Z to undo, all under Settings → Editor. The photo mark-up's text box keeps no value of its own
   (photos-edit.js draws it empty), so a redraw after a spelling fix keeps what's typed in it. ==== */
{ const r0 = renderAll; renderAll = function () {   // eslint-disable-line no-global-assign
  const t = document.getElementById('phe-textin'), v = t?.value, at = typeof PHE !== 'undefined' ? PHE.ed?.typing : null;
  const out = r0.apply(this, arguments);
  const t2 = v && at && PHE.ed?.typing === at ? document.getElementById('phe-textin') : null;
  if (t2 && !t2.value) { const p = Math.min(v.length, t.selectionStart ?? v.length); t2.value = v; t2.setSelectionRange(p, p); }
  return out; }; }
/* ==== end Build N · QC 102 ==== */
