/* BUILD D · GUIDED SETUP: the first-run setup. Extracted from design/vault-notes-mockups.html R24 ("guide", locked), with
   R23's AI step, R28's live words and R29's three-column swatches: obGuide, obGuideBody, OB_STEPS, obChoice, obDownloads,
   OB_STT, OB_TTS, obAiStep / obAiBody and the .ob-* CSS. obSeg and S.ob come from Build B (render-ai.js), vSeg and
   V_KEEP from Build A (voice-attach.js).
   Six steps: Vault, Reading, Focus, Voice, AI and Ready, with a stepper, Back / Skip / Next, the download total and the
   space left. What the page shows live saves as it's picked, through the same handlers as Settings (theme, font, the
   nudge, the focus sound, live words, the voice defaults, keep / long questions; Build V: the vault folder). What needs a
   download is only listed until Ready: that list (every file, its source and size, the total, the space left) is the
   ask. Start NeuroVault writes those choices (api.setup_finish) and the downloads run in the background, with their
   progress in the status bar. Skip on a step puts back what was changed on it; "Skip the setup" writes the defaults.
   First run (api.setup_state): no setup_done in config.json and a new database. Settings → Data: Run the setup again.
   Without the app (a browser, ?check=1) it runs on the mockup's sample PCs. */
'use strict';
const SETUP = { open: false, again: false, info: null, reached: 0, snap: null, err: '', starting: false, checked: false, dl: null, timer: null };
Object.assign(S.ob, { step: 'vault', how: 'local', model: null, stt: 'base.en', tts: 'windows' });
KEEP_SCROLL.push(['.onboard', false]);   // a click inside a step keeps its place; a new step starts at the top (obGo)

const OB_STEPS = [['vault', 'Vault'], ['comfort', 'Reading'], ['focus', 'Focus'], ['voice', 'Voice'], ['ai', 'AI'], ['done', 'Ready']];
const OB_TITLE = { vault: 'Welcome to NeuroVault', comfort: 'Make it easy to read', focus: 'Focus and wind-down', voice: 'Voice', ai: 'How should AI run?', done: "You're ready" };
const OB_STT = [['base.en', 'Whisper base.en', 'Quick, good for clear speech'], ['small.en', 'Whisper small.en', 'Slower, better with accents and noise'], ['none', 'Not now', 'Voice ramble stays off until you add one']];
const OB_TTS = [['windows', 'Windows voices', 'Already on this PC; less natural'], ['kokoro', 'Kokoro', 'Natural, several voices']];   // Fix B: Piper's two voices dropped (licences)
const OB_HOW = [['local', 'cpu', 'On this PC', 'Private and works offline. NeuroVault downloads one model and runs it.'],
  ['cloud', 'cloud', 'In the cloud', 'Quickest on an older PC. Free with your own key; your question and notes go to that company.'],
  ['none', 'x', 'No AI for now', 'Everything else works. Turn it on later in Settings → AI models.']];
const OB_FONTS = ['opendyslexic', 'lexend', 'atkinson', 'system'];   // the built-in four; more fonts come in Settings → Reading & comfort
const obIx = step => OB_STEPS.findIndex(x => x[0] === step);

/* ---- What the steps show: api.setup_info(), or the mockup's sample PCs without the app ---- */
function obSample() {
  const a = aiSt(), pc = a.pc, hf = 'https://huggingface.co/csukuangfj/';
  return { demo: true, pc, first_run: !SETUP.again, mics: ['Mic in at rear panel (Realtek(R) Audio)', 'Headset microphone'],
    stt: [{ name: 'base.en', size_mb: 161, bytes: 160625066, present: false, source: hf + 'sherpa-onnx-whisper-base.en', files: ['base.en-encoder.int8.onnx', 'base.en-decoder.int8.onnx', 'base.en-tokens.txt'] },
      { name: 'small.en', size_mb: 376, bytes: 375501079, present: false, source: hf + 'sherpa-onnx-whisper-small.en', files: ['small.en-encoder.int8.onnx', 'small.en-decoder.int8.onnx', 'small.en-tokens.txt'] }],
    live: { size_mb: 44, bytes: 43649301, present: false, free_gb: pc.free_gb, drive: pc.drive, source: hf + 'sherpa-onnx-streaming-zipformer-en-20M-2023-02-17',
      files: ['encoder-epoch-99-avg-1.int8.onnx', 'decoder-epoch-99-avg-1.int8.onnx', 'joiner-epoch-99-avg-1.int8.onnx', 'tokens.txt'] },
    tts: [{ id: 'kokoro', label: 'Kokoro', size_mb: 103, bytes: 103e6, present: false, source: 'github.com/k2-fsa/sherpa-onnx (tts-models release)', files: ['kokoro-int8-en-v0_19.tar.bz2'], missing: ['kokoro-int8-en-v0_19.tar.bz2'] }],
    ai: { rec: a.rec, models: a.models, engine: a.engine.build ? null : a.engine.offer }, settings: {} };
}
const obInfo = () => SETUP.info || obSample();
const obPc = () => obInfo().pc;
const obGb = n => n < 1 ? `${Math.round(n * 1000)} MB` : `${n.toFixed(1)} GB`;
const obStt = v => obInfo().stt.find(m => m.name === v);
const obTts = v => obInfo().tts.find(t => t.id === v);
const obModel = id => obInfo().ai.models.find(m => m.id === id);
const obMic = () => obInfo().settings.voice_mic ?? '';
// R28: live words is on with 5 GB or more free on the data drive, unless it was turned on or off
function obLive() { const p = vdef().live; if (p !== 'auto') return p === 'on'; const f = obInfo().live?.free_gb; return f == null || f >= 5; }
// The answers to start from: the defaults on a first run, today's settings when it runs again
function obDefaults() {
  const i = obInfo(), s = i.settings, a = AI.st && !AI.demo ? AI.st : null, use = a?.use;
  S.ob.stt = SETUP.again && s.voice_stt_model ? s.voice_stt_model : 'base.en';
  S.ob.tts = SETUP.again && s.read_engine === 'sherpa' ? 'kokoro' : 'windows';   // Fix B: a saved Piper voice reads with Kokoro
  S.ob.model = use && obModel(use) ? use : i.ai.rec || i.ai.models.find(m => !m.fit)?.id || null;
  S.ob.how = SETUP.again && !use ? 'none' : S.ob.model ? 'local' : 'none';
}
async function obLoad() {
  const r = await nv('setup_info'); if (failed(r)) { toast(r.message || "The setup couldn't read this PC"); return; }
  SETUP.info = r; obDefaults(); aiRefresh();
}

/* ---- What Start downloads: [{key, label, files, source, bytes}], as api.setup_plan works it out ---- */
function obDownloads() {
  const i = obInfo(), o = S.ob, list = [];
  const stt = o.stt !== 'none' && obStt(o.stt), tts = o.tts !== 'windows' && obTts(o.tts);
  if (stt && !stt.present) list.push({ key: 'stt', label: `Whisper ${stt.name} (speech to text)`, files: stt.files || [], source: stt.source, bytes: stt.bytes || stt.size_mb * 1e6 });
  if (stt && obLive() && !i.live.present) list.push({ key: 'live', label: 'Live words model', files: i.live.files || [], source: i.live.source, bytes: i.live.bytes || i.live.size_mb * 1e6 });   // R28
  if (tts && !tts.present) list.push({ key: 'tts', label: `${tts.label} (read aloud)`, files: tts.missing || tts.files, source: tts.source, bytes: tts.bytes });
  const m = o.how === 'local' && o.model && obModel(o.model);
  if (m && i.ai.engine) list.push({ key: 'engine', label: 'AI engine (llama.cpp)', files: [i.ai.engine.file], source: i.ai.engine.source, bytes: i.ai.engine.bytes });
  if (m && !m.installed) list.push({ key: m.id, label: `${m.name} (AI)`, files: [m.file], source: aiSource(m), bytes: m.bytes });
  return list;
}
const obTotal = () => obDownloads().reduce((t, x) => t + x.bytes, 0) / 1e9;
const obChoices = () => ({ stt: S.ob.stt, live: S.ob.stt === 'none' ? null : obLive(), tts: S.ob.tts, ai: S.ob.how === 'local' && S.ob.model || '' });

/* ---- The steps (R24) ---- */
// A choice of three, each with its size; one that needs more space than the drive has is greyed out with the reason
const obChoice = (k, rows) => `<div class="ob-models ob-models--3" role="group" aria-label="${k === 'stt' ? 'Speech to text' : 'Read-aloud voice'}">${rows.map(([v, l, d]) => {
  const m = k === 'stt' ? obStt(v) : obTts(v), gb = m ? (m.bytes || m.size_mb * 1e6) / 1e9 : 0, p = obPc();
  const why = gb && !m.present && gb + 1 > p.free_gb ? `Needs ${obGb(gb)} free; ${p.drive} has ${p.free_gb} GB` : '';
  return `<button class="ob-model" data-act="ob-set" data-k="${k}" data-v="${v}" aria-pressed="${S.ob[k] === v}" ${why ? `disabled title="${esc(why)}"` : ''}><span class="set-label">${l}${gb ? ` <span class="set-desc">· ${m.present ? 'on this PC' : obGb(gb)}</span>` : ''}</span><span class="set-desc">${esc(why || d)}</span></button>`; }).join('')}</div>`;
function obLiveRow() {   // R28's liveRow('setup')
  const L = obInfo().live, on = obLive(), free = L.free_gb, low = free != null && free < 5, noStt = S.ob.stt === 'none', mb = L.size_mb, drive = esc(L.drive || 'C:');
  const desc = noStt ? 'Needs speech to text' : on ? `Shows the words as you talk. Adds a small streaming model (${mb} MB)${low ? `; ${drive} has only ${free} GB free` : ''}`
    : low ? `Off to save space: ${drive} has ${free} GB free, so the pill shows just the time. Turn it on to add ${mb} MB` : `Off: the pill shows just the time. Turn it on to add ${mb} MB`;
  return `<div class="set-row"><div><div class="set-label" id="live-setup">Live words while recording</div><div class="set-desc">${desc}</div></div><button class="toggle" role="switch" aria-checked="${on && !noStt}" aria-labelledby="live-setup" data-act="ob-live"${noStt ? ' disabled' : ''}></button></div>`;
}
// Build V: the mockup's step 1 (profile, 2026-10-18: "First run starts with your vault folder"): notes are plain .md
// files in a folder you choose; Create a new vault or Open a folder as a vault. No Obsidian daily notes here (they're
// in Settings → Vault & files). The cards and their handlers are vault.js's (vaultCards).
function obVault() {
  return `<p class="view-sub">Your notes stay as plain .md files in a folder you choose. Nothing needs an account or the internet.</p>
  ${vaultCards('setup')}
  <p class="set-desc">Settings stay in <span class="code">config.json</span> on this PC. Your fonts, your own words and attachments go in the vault, so they travel with it.</p>`;
}
function obAiStep() {   // R23, inside the guided setup
  const o = S.ob, p = obPc(), i = obInfo();
  const how = `<div class="ob-hows" role="group" aria-label="How should AI run?">${OB_HOW.map(([v, ico, l, d]) => `<button class="card ob-how" data-act="ob-set" data-k="how" data-v="${v}" aria-pressed="${o.how === v}"><span class="ob-how-head">${ic(ico)}<span class="set-label">${l}</span>${v === 'local' ? '<span class="chip chip--accent">Suggested</span>' : ''}</span><span class="set-desc">${d}</span></button>`).join('')}</div>`;
  const local = `<div class="eyebrow">Pick a model · these fit this PC</div><div class="ob-models" role="group" aria-label="Model">${i.ai.models.map(x => { const why = x.installed ? '' : x.fit; return `<button class="ob-model" data-act="ob-set" data-k="model" data-v="${x.id}" aria-pressed="${o.model === x.id}" ${why ? `disabled title="${esc(why)}"` : ''}>
      <span class="set-label">${esc(x.name)}${x.id === i.ai.rec ? ' <span class="chip chip--accent">Best for this PC</span>' : ''}</span><span class="set-desc">${esc(why || `${x.installed ? 'On this PC' : x.gb + ' GB'} · ${x.good} · ${x.speed}`)}</span></button>`; }).join('')}</div>
    ${obSeg('keep', 'When you change model later', `Models take 1–6 GB each; ${esc(p.drive)} has ${p.free_gb} GB free`, [['keep', 'Keep the old one'], ['delete', 'Delete the old one']])}
    ${obSeg('long', 'Long questions', 'Summaries and questions about your notes', [['local', 'Stay on this PC'], ['cloud', 'Cloud, if I add a key']])}`;
  const body = `${how}<div class="ob-detail${o.how === 'cloud' ? ' cl-ob' : ''}">${o.how === 'local' ? local : o.how === 'cloud' ? cloudObHtml() : '<p class="set-desc">Nothing is downloaded. Voice ramble still tidies text with its built-in rules.</p>'}</div>`;
  return `<p class="ob-pc set-desc">${ic('cpu')}<span>Optional: AI tidies voice rambles, breaks tasks into steps and answers questions about your notes. <b>This PC:</b> ${p.mem_gb} GB memory · ${p.free_gb} GB free on ${esc(p.drive)} · ${esc(p.card)}</span></p>${body}`;
}
const obAiBody = () => obAiStep();
function obReady() {
  const o = S.ob, dl = obDownloads(), total = dl.reduce((t, x) => t + x.bytes, 0), p = obPc(), left = (p.free_bytes ?? p.free_gb * 1e9) - total;
  const row = (k, l, v) => `<div class="ob-sum"><span class="set-label">${l}</span><span class="set-desc">${v}</span><button class="btn btn--ghost btn--sm" data-act="ob-go" data-v="${k}">Change</button></div>`;
  const font = FONTS.find(x => x[0] === READER.font)?.[1] || READER.font, sound = S.sound.kind ? `${S.sound.kind} sound` : 'no focus sound';
  const live = obLive() && o.stt !== 'none' ? 'on' : 'off', keep = V_KEEP.find(x => x[0] === vdef().keep)?.[1].toLowerCase() || 'audio + text';
  const ai = o.how === 'local' && o.model ? `${esc(obModel(o.model)?.name || o.model)} on this PC · long questions ${S.ob.long === 'cloud' ? 'may use the cloud' : 'stay here'}` : o.how === 'cloud' ? esc(cloudObSummary()) : 'Off for now';   // Build N (R56)
  const files = it => `<li class="ob-file"><span class="set-label">${esc(it.label)} <span class="set-desc num">· ${obGb(it.bytes / 1e9)}</span></span><span class="set-desc"><span class="code">${it.files.map(esc).join(', ')}</span> · from ${esc(String(it.source).replace(/^https?:\/\//, ''))}</span></li>`;
  return `<p class="view-sub">Here's what you picked. Everything is in Settings if you change your mind.</p>
    ${row('vault', 'Vault', VSTATE.path ? `<span class="code">${esc(VSTATE.path)}</span>` : `<span class="code">${esc(vaultNew())}</span>`)}
    ${row('comfort', 'Reading', `${THEMES.find(x => x[0] === READER.theme)?.[1] || READER.theme} · ${font}`)}
    ${row('focus', 'Focus', `${S.a11y.nudge ? `Nudge after ${S.a11y.nudge} min` : 'No nudge'} · ${sound}`)}
    ${row('voice', 'Voice', `${OB_STT.find(x => x[0] === o.stt)[1]} · ${OB_TTS.find(x => x[0] === o.tts)[1]} · live words ${live} · rambles go to the ${{ dump: 'Brain Dump', note: 'open note', new: 'a new note' }[vdef().dest]} as ${keep}`)}
    ${row('ai', 'AI', ai)}
    <div class="ob-total" role="group" aria-labelledby="ob-total-l">${dl.length ? `<span class="set-label" id="ob-total-l">To download: ${obGb(total / 1e9)}</span><ul class="ob-files">${dl.map(files).join('')}</ul>
      <span class="set-desc">It runs in the background; ${esc(p.drive)} keeps ${(left / 1e9).toFixed(1)} GB free. Nothing is sent from this PC.</span>` : '<span class="set-desc" id="ob-total-l">Nothing to download.</span>'}
      ${SETUP.err ? `<span class="set-desc ai-nofit" role="alert">${esc(SETUP.err)}</span>` : ''}</div>`;
}
function obGuideBody(step) {
  const o = S.ob;
  if (step === 'vault') return obVault();
  if (step === 'comfort') return `<p class="view-sub">Pick what's easiest to read. The whole app changes as you pick, so you can see it.</p>
    <div class="eyebrow">Theme</div><div class="swatches ob-swatches" role="group" aria-label="Theme">${THEMES.map(([v, l]) => `<button class="swatch swatch--${v}" data-act="set-reader" data-k="theme" data-v="${v}" aria-pressed="${READER.theme === v}"><span class="swatch-aa" aria-hidden="true">Aa</span><span class="truncate">${l}</span></button>`).join('')}</div>
    <div class="eyebrow">Font</div><div class="fonts" role="group" aria-label="Font">${FONTS.filter(([v]) => OB_FONTS.includes(v)).map(([v, l]) => `<button class="font-opt font-opt--${v}" data-act="set-reader" data-k="font" data-v="${v}" aria-pressed="${READER.font === v}"><span class="truncate">${l}</span></button>`).join('')}</div>
    <p class="set-desc">More fonts later in Settings → Reading &amp; comfort.</p>
    <p class="ob-sample">The quick brown fox jumps over the lazy dog. Notes, tasks and timers all use this text.</p>`;
  if (step === 'focus') return `<p class="view-sub">Gentle help to keep going, and to stop. Leave anything off you don't want.</p>
    ${settingsPane('focus')}${SET_SOON.wrapup ? '' : settingsPane('wrapup')}`;   // the wrap-up's rows join here once Daily wrap-up is built
  if (step === 'voice') { const mics = obInfo().mics || [], mic = obMic();
    return `<p class="view-sub">Talk instead of typing, and have notes read to you. Both run on this PC.</p>
    <div class="set-row"><div><div class="set-label" id="ob-mic">Microphone</div><div class="set-desc">The voice ramble records from this one</div></div><div class="ob-mic"><select class="field" data-act="voice-mic" aria-labelledby="ob-mic" ${api() ? '' : 'disabled'}><option value="">Windows default</option>${mics.map(x => `<option value="${esc(x)}" ${x === mic ? 'selected' : ''}>${esc(x)}</option>`).join('')}</select></div></div>
    <div class="eyebrow">Speech to text</div>${obChoice('stt', OB_STT)}${obLiveRow()}
    <div class="eyebrow">Read-aloud voice</div>${obChoice('tts', OB_TTS)}
    <div class="eyebrow">After a voice ramble</div>${vSeg('vdef-keep', 'Keep', V_KEEP, vdef().keep)}${vSeg('vdef-dest', 'Save to', [['dump', 'Brain Dump'], ['note', 'Open note'], ['new', 'New note']], vdef().dest)}`; }   // R25
  if (step === 'ai') return obAiBody();
  return obReady();
}
function obGuide() {
  const step = S.ob.step, ix = obIx(step), dl = obTotal();
  const nav = `<ol class="ob-steps" aria-label="Setup steps">${OB_STEPS.map(([k, l], i) => `<li><button class="ob-step${i === ix ? ' is-current' : i < ix ? ' is-done' : ''}" data-act="ob-go" data-v="${k}" ${i === ix ? 'aria-current="step"' : ''} ${i > SETUP.reached ? 'disabled' : ''}><span class="ob-step-n num">${i < ix ? ic('ok') : i + 1}</span>${l}</button></li>`).join('')}</ol>`;
  const next = step === 'done' ? `<button class="btn btn--primary" id="ob-start" data-act="ob-start" ${SETUP.starting ? 'disabled' : ''}>${dl ? ic('download') : ''}${SETUP.starting ? 'Starting…' : SETUP.again ? (dl ? 'Start the downloads' : 'Done') : 'Start NeuroVault'}</button>`
    : `<button class="btn btn--primary" id="ob-next" data-act="ob-go" data-v="${OB_STEPS[ix + 1][0]}">Next</button>`;
  const back = ix ? `<button class="btn btn--ghost" data-act="ob-go" data-v="${OB_STEPS[ix - 1][0]}">Back</button>`
    : `<button class="btn btn--ghost" data-act="ob-skip-all" title="${SETUP.again ? 'Nothing you picked before changes' : 'Use the defaults; everything is in Settings later'}">${SETUP.again ? 'Close the setup' : 'Skip the setup'}</button>`;
  const skip = ix && step !== 'done' ? `<button class="btn btn--ghost" data-act="ob-skip" data-v="${OB_STEPS[ix + 1][0]}" title="Keep the defaults for this step">Skip</button>` : '';
  return `<div class="onboard"><div class="card onboard-card onboard-card--ai" role="dialog" aria-modal="true" aria-labelledby="ob-t">${nav}
    <div><div class="eyebrow">Setting up NeuroVault · step ${ix + 1} of ${OB_STEPS.length}</div><h1 class="view-title" id="ob-t" tabindex="-1">${OB_TITLE[step]}</h1></div>
    <div class="ob-detail">${obGuideBody(step)}</div>
    <div class="ob-foot">${back}<span class="ob-spacer"></span>${skip}${next}</div></div></div>`;
}

/* ---- Moving between steps; Skip puts back what this step changed ---- */
const OB_KEYS = {   // [read now, put back] for what each step can change
  vault: [],   // Build V: a vault that was made or opened stays (Next makes the default one when none is picked)
  comfort: [[() => READER.theme, v => setReader('theme', v)], [() => READER.font, v => setReader('font', v)]],
  focus: [[() => S.a11y.nudge, v => setComfort('nudge', v)], [() => S.sound.kind || 'off', v => { setSound(v); setSoundscape({ kind: S.sound.kind }); }]],
  voice: [[() => S.ob.stt, v => { S.ob.stt = v; }], [() => S.ob.tts, v => { S.ob.tts = v; }], [() => vdef().live, v => setVdef('live', v)], [() => vdef().keep, v => setVdef('keep', v)],
    [() => vdef().dest, v => setVdef('dest', v)], [() => obMic(), v => { saveSettings({ voice_mic: v }); obInfo().settings.voice_mic = v; }]],
  ai: [[() => S.ob.how, v => { S.ob.how = v; }], [() => S.ob.model, v => { S.ob.model = v; }], [() => S.ob.keep, v => { S.ob.keep = v; if (AI.st) AI.st.keep = v; saveSettings({ ai_keep: v }); }],
    [() => S.ob.long, v => { S.ob.long = v; if (AI.st) AI.st.long = v; saveSettings({ ai_long: v }); }]],
  done: [] };
const obSnap = () => { SETUP.snap = { step: S.ob.step, vals: OB_KEYS[S.ob.step].map(([get]) => get()) }; };
function obRestore() {
  const sn = SETUP.snap; if (!sn || sn.step !== S.ob.step) return 0; let n = 0;
  OB_KEYS[sn.step].forEach(([get, put], i) => { if (get() !== sn.vals[i]) { put(sn.vals[i]); n++; } });
  return n;
}
function obGo(step, focus) {
  if (obIx(step) < 0) return;
  S.ob.step = step; SETUP.reached = Math.max(SETUP.reached, obIx(step)); SETUP.err = ''; obSnap();
  S.focus = { sel: focus || '#ob-t' }; renderAll();
  const ob = app.querySelector('.onboard'); if (ob) ob.scrollTop = 0;   // each step starts at its top
}
function openSetup(again) {
  if (SETUP.open) return;
  closeModal(true); S.menu = false; S.ctx = null; S.edPop = null;
  Object.assign(SETUP, { open: true, again: !!again, reached: again ? OB_STEPS.length - 1 : 0, err: '', starting: false });
  if (api() && !CHECK) { SETUP.info = null; aiRefresh(); }
  obDefaults(); obGo('vault');
  if (api() && !CHECK) obLoad().then(() => { if (SETUP.open) renderAll(); });
}
function closeSetup() { SETUP.open = false; SETUP.snap = null; app.classList.remove('is-setup'); renderAll(); }
// "Skip the setup": the defaults on a first run (api.setup_skip writes them); from Settings, just close
async function obSkipAll() {
  if (!api() || CHECK) { closeSetup(); toast(SETUP.again ? 'Nothing changed' : 'Using the defaults: everything is in Settings'); return; }
  const r = await nv('setup_skip'); if (failed(r)) { toast(r.message); return; }
  const first = !SETUP.again; closeSetup();
  if (first) { await loadReader(); D.tset = tsetFromConfig(r); setSound('off'); S.voice.status = null; aiRefresh(); renderAll(); }
  toast(first ? 'Using the defaults: everything is in Settings' : 'Nothing changed');
}
async function obStart() {
  if (SETUP.starting) return;
  const dl = obTotal(), msg = dl ? `Downloading ${obGb(dl)} in the background: you can start writing now` : 'All set';
  if (!api() || CHECK) { closeSetup(); toast(msg); return; }
  SETUP.starting = true; SETUP.err = ''; renderAll();
  const ch = obChoices(), r = await nv('setup_finish', ch); SETUP.starting = false;
  if (failed(r)) { SETUP.err = r.message || "The setup couldn't start."; S.focus = { sel: '#ob-start' }; renderAll(); return; }
  if (ch.ai && obModel(ch.ai)?.installed && AI.st?.use !== ch.ai) await nv('ai_use', ch.ai);   // run again: a model already on this PC is put in use
  closeSetup(); await loadReader(); S.voice.status = null; aiRefresh(); renderAll(); toast(msg);
  if (r.plan.items.length) obWatch();
}

/* ---- The downloads after Start: polled while they run; the status bar shows them (Build B's label covers the AI ones) ---- */
const OB_ACTIVE = ['queued', 'downloading', 'paused'];
const obAiKey = k => !['stt', 'live', 'tts'].includes(k);
const obDlActive = () => (SETUP.dl?.items || []).filter(it => OB_ACTIVE.includes(it.state));
function obDlPct() { const it = SETUP.dl?.items || [], tot = it.reduce((t, x) => t + (x.total || 0), 0), done = it.reduce((t, x) => t + (x.state === 'done' ? x.total || 0 : x.done || 0), 0); return tot ? Math.min(99, Math.floor(done / tot * 100)) : 0; }
function setupDlLink() {
  const act = obDlActive(); if (!act.length || act.every(it => obAiKey(it.key))) return '';
  const t = `Setup downloads: ${act.length} file${act.length === 1 ? '' : 's'} left, ${obDlPct()}% done`;
  return `<button class="status-link" data-act="setup-dl" aria-expanded="${!!S.dlPop}" title="${t}" aria-label="${t}">${ic('download')}<span class="status-label" data-setup-dl>Setup · ${obDlPct()}%</span></button>`;
}
const OB_STATE = { queued: 'Waiting', downloading: 'Downloading', paused: 'Paused', done: 'Done', error: 'Stopped', cancelled: 'Cancelled' };
// Build L (R41, ongoing work): the list opens above its status-bar link, with no dimmed window; × and a click away close
// the list (the downloads go on); Cancel the rest stops what hasn't finished
function setupDlPop() {
  const items = SETUP.dl?.items || [], left = obDlActive().length;
  const row = it => { const pct = it.state === 'done' ? 100 : Math.min(100, it.total ? it.done / it.total * 100 : 0);
    return `<div class="ob-dl" data-ob-dl="${esc(it.key)}"><div class="ob-dl-head"><span class="set-label">${esc(it.label)}</span><span class="set-desc num" data-ob-dl-text>${OB_STATE[it.state] || it.state}${it.state === 'downloading' && it.total ? ` · ${obGb(it.done / 1e9)} of ${obGb(it.total / 1e9)}` : ''}</span></div>
      <div class="progress" role="progressbar" aria-label="${esc(it.label)}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(pct)}"><span style="width:${pct.toFixed(1)}%"></span></div>${it.message ? `<span class="set-desc ai-nofit" role="alert">${esc(plainMsg(it.message))}</span>` : ''}</div>`; };
  return `<div class="card popover dl-pop" role="dialog" aria-labelledby="sd-t"><div class="dl-pop-head"><div><div class="dl-pop-title" id="sd-t">Downloads from the setup</div><div class="list-item-sub">${left ? `${left} left · they run in the background: keep working` : 'Nothing left to download'}</div></div><button class="icon-btn icon-btn--sm" id="sd-close" data-act="setup-dl" aria-label="Close the list (the downloads go on)" title="Close the list">${ic('x')}</button></div>
    ${items.map(row).join('')}${left ? '<div class="dl-pop-foot"><button class="btn btn--secondary btn--sm" data-act="setup-dl-cancel">Cancel the rest</button></div>' : ''}</div>`;
}
const obDlShape = d => JSON.stringify((d?.items || []).map(it => [it.key, it.state]));
async function obWatch() {
  clearTimeout(SETUP.timer); if (!api() || CHECK) return;
  const r = await nv('setup_status'); if (failed(r)) { SETUP.timer = setTimeout(obWatch, 3000); return; }
  const was = SETUP.dl, shape = obDlShape(was) !== obDlShape(r), wasBusy = !!was && obDlActive().length > 0; SETUP.dl = r;
  if (shape || S.dlPop && !app.querySelector('[data-ob-dl]')) renderAll(); else obPaint();
  if (r.busy) { SETUP.timer = setTimeout(obWatch, 1000); return; }
  if (wasBusy || !was) { const bad = r.items.filter(it => it.state === 'error'); S.voice.status = null; obReadReset();
    if (bad.length) toast(`${bad.length} download${bad.length === 1 ? '' : 's'} stopped: see Settings → Voice or AI models`);
    else if (!r.items.some(it => it.state === 'cancelled')) toast('The setup\'s downloads are finished'); }   // a cancel says so itself
}
function obReadReset() { if (typeof loadSherpaStatus === 'function') loadSherpaStatus(true); }   // Phase 6C: the new voice shows up in Settings → Voice
function obPaint() {   // progress in place, so a poll doesn't redraw the window while you type
  const lab = app.querySelector('[data-setup-dl]'); if (lab) lab.textContent = `Setup · ${obDlPct()}%`;
  (SETUP.dl?.items || []).forEach(it => { const el = app.querySelector(`[data-ob-dl="${CSS.escape(it.key)}"]`); if (!el) return; const pct = it.state === 'done' ? 100 : Math.min(100, it.total ? it.done / it.total * 100 : 0);
    const bar = el.querySelector('.progress'); bar.setAttribute('aria-valuenow', Math.round(pct)); bar.firstElementChild.style.width = pct.toFixed(1) + '%';
    el.querySelector('[data-ob-dl-text]').textContent = `${OB_STATE[it.state] || it.state}${it.state === 'downloading' && it.total ? ` · ${obGb(it.done / 1e9)} of ${obGb(it.total / 1e9)}` : ''}`; });
}

/* ---- Settings → Data: run it again ---- */
const setupAgainRow = () => `<div class="set-row"><div><div class="set-label">Guided setup</div><div class="set-desc">Vault, reading, focus, voice and AI, one step at a time. It starts from your current settings</div></div><button class="btn btn--secondary" data-act="setup-again">Run the setup again</button></div>`;

/* ---- Drawing: the setup covers the window under its bar; the downloads dialog ---- */
const _renderModalD = renderModal;
renderModal = function () {
  app.classList.toggle('is-setup', SETUP.open);
  if (S.dlPop && !obDlActive().length && !(SETUP.dl?.items || []).length) S.dlPop = false;
  return (SETUP.open ? obGuide() : '') + (S.dlPop ? setupDlPop() : '') + _renderModalD();   // Build L: the downloads' list is a popover over the page
};

/* ---- Clicks, changes and keys ---- */
document.getElementById('app').addEventListener('click', e => {
  const t = e.target.closest?.('[data-act]'); if (!t || e.target.closest('[data-soon]') || t.disabled) return;
  const act = t.dataset.act, v = t.dataset.v, k = t.dataset.k;
  if (act === 'ob-go') { obGo(v, t.closest('.ob-steps') ? `.ob-steps [data-v="${v}"]` : null); return; }
  if (act === 'ob-skip') { const n = obRestore(); if (n) status('Put back the defaults for that step'); obGo(v); return; }
  if (act === 'ob-skip-all') { obSkipAll(); return; }
  if (act === 'ob-start') { obStart(); return; }
  if (act === 'ob-live') { setVdef('live', obLive() ? 'off' : 'on'); S.focus = { sel: '[data-act="ob-live"]' }; renderAll(); return; }
  if (act === 'ob-set' && ['how', 'model', 'stt', 'tts'].includes(k)) { S.ob[k] = v; if (k === 'how' && v === 'local' && !S.ob.model) S.ob.model = obInfo().ai.rec; S.focus = { sel: `[data-act="ob-set"][data-k="${k}"][data-v="${CSS.escape(v)}"]` }; renderAll(); return; }
  if (act === 'setup-again') { openSetup(true); return; }
  if (act === 'setup-dl') { S.dlPop = !S.dlPop; S.focus = { sel: S.dlPop ? '#sd-close' : '[data-act="setup-dl"]' }; renderAll(); return; }   // Build L: a popover, not a dialog
  if (act === 'setup-dl-cancel') { nv('setup_cancel').then(() => { toast('The setup\'s downloads are cancelled'); obWatch(); }); return; }
});
document.getElementById('app').addEventListener('change', e => {   // the microphone (render-voice.js saves it); the setup keeps its own copy
  if (e.target.dataset.act === 'voice-mic' && e.target.closest('.onboard')) obInfo().settings.voice_mic = e.target.value;
});
// While the setup is up, Esc doesn't close it and the window's shortcuts wait (search, brain dump, new note or tab, zen, ruler)
document.addEventListener('keydown', e => {
  if (!SETUP.open) return;
  const k = e.key.toLowerCase(), ctrl = e.ctrlKey || e.metaKey;
  if (e.key === 'Escape' || e.key === 'F11' || (ctrl && ['k', 'd', 'n', 't', 'w', 'r'].includes(k))) { e.stopImmediatePropagation(); if (e.key !== 'Escape') e.preventDefault(); }
}, true);
const _hotkeyDumpD = window.hotkeyBrainDump;
window.hotkeyBrainDump = () => { if (!SETUP.open) _hotkeyDumpD(); };   // main.py's global hotkey waits too

/* ---- First run: once the app is up, ask whether this is a fresh install ---- */
async function setupBoot() {
  if (SETUP.checked || !api() || CHECK) return; SETUP.checked = true;
  const r = await nv('setup_state');
  if (failed(r)) { SETUP.checked = false; return; }
  if (r.show) openSetup(false);
}
const _bootD = boot;
boot = function () { _bootD(); setupBoot(); };
window.addEventListener('pywebviewready', () => { if (started) started.then(setupBoot); });
/* ---- end Build D ---- */
