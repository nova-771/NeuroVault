/* ==== Build N · mockup R69 · speaking a question in Ask, the Agent and the floating window ====
   Feedback: "Next for ai chat interface is voice", then (R69 answers, 2026-10-20): Start and stop is a user setting, after you stop the
   words are sent at once, and where the words are heard is a user setting (this PC by default, or a cloud model such as Groq).
   - A mic in the chat's input, beside send. The same input serves Ask docked, the floating window, its own window and the Agent
     (agent-chat.js asks through aicAsk), so the one mic serves all four.
   - Settings → Voice: "Start and stop" (ask_voice_start: tap | hold | auto) and "Where your words are heard" (ask_voice_where: pc | cloud),
     a plain line each. Tap: one click each way. Hold: hold the mic or Ctrl+Space, let go to finish. Auto: tap once; it stops by itself
     after 1.5 s of quiet (api.ask_voice_poll says how long it has been quiet).
   - While you speak: the live words and a moving line drawn from the real level (a pill with Stop and Discard once it is long), how to
     finish, and where your words are heard. When you stop, the words go to the model at once (aicAsk), and the question says "spoken".
   - Cloud: nothing is recorded before a key is added (Settings → AI models) and you say yes to "Let Groq hear what you say?" once.
   - Cards (r69Note): no microphone, no speech model (download it here), nothing heard, no key, an error. Esc discards what you said.
   Backend: api.ask_voice_* (its own voice.Session; the ramble's keeps its state). Nothing here runs without the app. ==== */
'use strict';
const AVX_QUIET = 1.5, AVX_LONG = 20, AVX_TAP_MIN = 400, AVX_POLL = 150;
const AVX_STARTS = [['tap', 'Tap to start and stop'], ['hold', 'Hold to talk, or Ctrl+Space'], ['auto', 'Tap once, stops by itself after a pause']];
const AVX_WHERES = [['pc', 'On this PC'], ['cloud', 'A cloud model such as Groq']];
const AVX_STC = { tap: 'Tap to start, tap again to stop: one click each way, nothing to hold.', hold: 'Hold to talk, like a walkie-talkie, with the mouse or Ctrl+Space; let go to finish.', auto: 'Tap to start; it stops by itself after 1.5 s of quiet.' };
const AVX = { start: 'tap', where: 'pc', seen: false, info: null, loading: false, stage: 'idle', secs: 0, bars: [], words: '', heard: false, note: null, first: null,
  timer: null, seq: 0, noteId: null, hold: null, rel: false, spoken: null, long: false, dl: null };

const avxModel = () => S.voice?.status?.model?.name || AVX.info?.model?.name || 'base.en';   // Settings → Voice refreshes S.voice.status, so a model picked there shows at once
const avxCloud = () => AVX.info?.cloud || { name: 'Groq', model: 'Whisper large-v3' };
const avxHeard = () => AVX.where === 'cloud' ? `Heard by ${avxCloud().name} (${avxCloud().model}) · your recording goes to ${avxCloud().name}` : `Heard on this PC (${avxModel()}) · nothing you say leaves it`;
const avxHc = (w = AVX.where) => w === 'cloud' ? `A cloud model (${avxCloud().name}, ${avxCloud().model}): quicker on an older PC. Your recording goes to ${avxCloud().name}, after a first-use yes.`
  : `On this PC: the speech model you already have (${avxModel()}). Nothing you say leaves the PC; a little slower.`;
const avxTip = (label, extra = '') => `aria-label="${esc(label)}" data-tip="${esc(label)}"${extra}`;
const avxRec = () => AVX.stage === 'listening' || AVX.stage === 'starting';

/* ---- what the backend knows (the model's name, the cloud ear), asked once ---- */
function avxLoad(force) {
  if (!api()) return Promise.resolve(null);
  if (AVX.loading) return AVX.loading;
  if (AVX.info && !force) return Promise.resolve(AVX.info);
  AVX.loading = nv('ask_voice_status').then(r => {
    AVX.loading = false; AVX.info = failed(r) ? { error: r?.message || 'The voice engine didn’t answer.' } : r;
    if (!failed(r)) { if (['tap', 'hold', 'auto'].includes(r.start)) AVX.start = r.start; if (['pc', 'cloud'].includes(r.where)) AVX.where = r.where; AVX.seen = !!r.cloud?.seen; }
    renderAll(); return AVX.info; });
  return AVX.loading;
}
{ const c0 = readFromConfig; readFromConfig = function (c) { c0.apply(this, arguments);   // eslint-disable-line no-global-assign
  if (['tap', 'hold', 'auto'].includes(c.ask_voice_start)) AVX.start = c.ask_voice_start;
  if (['pc', 'cloud'].includes(c.ask_voice_where)) AVX.where = c.ask_voice_where;
  if (typeof c.ask_voice_cloud_seen === 'string') AVX.seen = !!c.ask_voice_cloud_seen; }; }

/* ---- what it looks like ---- */
const avxMicTip = () => ({ tap: 'Speak: tap to start, tap again to stop', hold: 'Speak: hold to talk, or hold Ctrl+Space', auto: 'Speak: it stops by itself after a pause' }[AVX.start]);
const avxHint = () => ({ tap: `${ic('mic')}<span>Tap the mic, speak, then tap it again.</span>`, hold: `${ic('mic')}<span>Hold the mic, or hold <kbd>Ctrl</kbd>+<kbd>Space</kbd>, and let go when you’re done.</span>`,
  auto: `${ic('mic')}<span>Tap the mic and speak: it stops by itself after 1.5 s of quiet.</span>` }[AVX.start]);
const avxHintListening = () => AVX.start === 'hold' ? `${ic('mic')}<span>Let go of the mic, or of <kbd>Ctrl</kbd>+<kbd>Space</kbd>, to finish.</span>`
  : AVX.start === 'auto' ? '<span class="avx-pause" aria-hidden="true"></span><span>Stops by itself after 1.5 s of quiet · or tap the mic.</span>' : `${ic('stop')}<span>Tap the mic again to finish.</span>`;
function avxMic(busy) {   // beside send (when the chat can ask at all)
  const rec = avxRec(), wait = AVX.stage === 'transcribing', k = AVX.note?.kind, off = k === 'nomic' || k === 'nomodel';
  const lab = rec ? ({ tap: 'Stop: tap to finish', hold: 'Let go to finish', auto: 'Listening: stops by itself after a pause' }[AVX.start]) : wait ? 'Turning your words into text…'
    : off ? (k === 'nomic' ? 'No microphone' : 'Needs the speech model') : busy ? 'One answer at a time' : avxMicTip();
  const dis = !rec && (wait || off || busy);
  return `<button class="avx-mic${rec ? ' is-rec' : ''}" data-act="avx-mic" ${avxTip(lab)}${rec ? ' aria-pressed="true"' : ''}${dis ? ' aria-disabled="true"' : ''}>${ic(rec && AVX.start === 'tap' ? 'stop' : 'mic')}</button>`;
}
const avxWave = () => `<span class="avx-wave" data-avx-wave aria-hidden="true">${Array.from({ length: 22 }, (_, i) => `<i style="height:${avxBarH(AVX.bars[i + 2])}%"></i>`).join('')}</span>`;
const avxStill = () => document.body.dataset.still === 'true' || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
const avxBarH = v => avxStill() ? [30, 55, 80, 45, 95, 60, 35, 70, 100, 50, 25, 65][Math.floor(Math.random() * 12)] : Math.round(18 + Math.max(0, Math.min(1, v || 0)) * 82);
const avxWordsHtml = () => `<span dir="ltr">${AVX.words ? '…' + esc(AVX.words) : 'Listening…'}</span>`;
function avxLive() {   // inside the box, above the text: the clock, the moving line, the live words (a pill once it is long)
  if (AVX.stage === 'transcribing') return `<div class="avx-live" role="status"><span class="spinner" aria-hidden="true"></span><span>Turning what you said into text${AVX.usedWhere === 'cloud' ? ` with ${esc(avxCloud().name)}` : ' on this PC'}…</span></div>`;
  if (!avxRec() || AVX.long) return '';
  return `<div class="avx-live" role="status" aria-live="off"><span class="vpill-dot" aria-hidden="true"></span><span class="num avx-time" data-avx-time>${mmss(AVX.secs)}</span>${avxWave()}<span class="avx-words" data-avx-words>${avxWordsHtml()}</span></div>`;
}
function avxPill() {   // a long question: the clock and the last words, Stop and Discard
  if (!avxRec() || !AVX.long) return '';
  return `<div class="avx-pill card" role="region" aria-label="Recording a long question"><span class="vpill-dot" aria-hidden="true"></span><span class="num avx-time" data-avx-time>${mmss(AVX.secs)}</span><span class="avx-cap" data-avx-words>${avxWordsHtml()}</span>`
    + `<button class="btn btn--primary btn--sm" data-act="avx-stop">${ic('stop')}Stop</button><button class="icon-btn icon-btn--sm" data-act="avx-discard" ${avxTip('Discard what you said')}>${ic('x')}</button></div>`;
}
function avxNoteHtml() {
  const nt = AVX.note; if (!nt || avxRec() || AVX.stage === 'transcribing') return '';
  const card = (warn, title, sub, acts, extra = '') => `<div class="avx-note${warn ? ' is-warn' : ''}" role="${warn ? 'alert' : 'status'}" data-avx-note="${nt.kind}">${ic(warn ? 'alert' : 'mic')}<div><b>${esc(title)}</b><span class="set-desc">${sub}</span>${extra}${acts ? `<div class="avx-acts">${acts}</div>` : ''}</div></div>`;
  const keep = '<button class="btn btn--ghost btn--sm" data-act="avx-type">Keep typing</button>';
  if (nt.kind === 'nomic') return card(true, 'NeuroVault can’t hear you', 'No microphone was found, or Windows has the microphone turned off for apps. You can still type.', '<button class="btn btn--secondary btn--sm" data-act="avx-micset">Microphone settings</button>');
  if (nt.kind === 'nomodel') {
    const m = AVX.info?.model, dl = AVX.dl;
    if (dl?.stage === 'downloading') return card(false, `Downloading ${esc(m?.name || avxModel())}…`, 'The mic works when it’s done.', '<button class="btn btn--secondary btn--sm" data-act="voice-dl-cancel">Cancel</button>', typeof voiceDlBar === 'function' ? voiceDlBar() : '');
    return card(false, 'Speaking needs the speech model', `${esc(m?.name || avxModel())}, ${m?.size_mb || 160} MB, runs on this PC: nothing you say leaves it. It’s the same model as the voice ramble.`,
      `<button class="btn btn--primary btn--sm" data-act="avx-dl">${ic('download')}Download (${m?.size_mb || 160} MB)</button>${AVX.where === 'cloud' ? `<button class="btn btn--secondary btn--sm" data-act="avx-usecloud">Use ${esc(avxCloud().name)} instead</button>` : ''}${keep}`);
  }
  if (nt.kind === 'first') { const c = avxCloud(), nm = esc(c.name);   // the chat's own window draws no dialogs: the same question, as a card
    return card(false, `Let ${c.name} hear what you say?`, `${nm} turns your recording into words (${esc(c.model)}, quicker on an older PC). Each recording goes to ${nm}; the words come back into the box. ${nm} keeps it as its terms say, linked from Settings → AI models. Or keep it on this PC: ${esc(avxModel())}, slower, and nothing you say leaves it.`,
      `<button class="btn btn--secondary btn--sm" data-act="avx-fkeep">Keep it on this PC</button><button class="btn btn--primary btn--sm" data-act="avx-fyes">Use ${nm}</button>`); }
  if (nt.kind === 'nothing') return card(true, 'Nothing was heard', 'It was too quiet, or too noisy to make out words. Check the microphone is on, or move somewhere quieter.', '<button class="btn btn--secondary btn--sm" data-act="avx-retry">Try again</button>');
  if (nt.kind === 'nokey') return card(true, `${avxCloud().name} needs a key`, `Add your ${esc(avxCloud().name)} key in Settings → AI models to have it hear you. Nothing was recorded.`,
    `<button class="btn btn--secondary btn--sm" data-act="avx-ai">${ic('gear')}AI models…</button><button class="btn btn--secondary btn--sm" data-act="avx-usepc">Use this PC instead</button>${keep}`);
  if (nt.kind === 'busy') return card(true, 'A voice ramble is recording', 'Finish it first, then speak your question.', '<button class="btn btn--secondary btn--sm" data-act="avx-retry">Try again</button>');
  return card(true, 'Your words didn’t come through', esc(plainMsg(nt.message || 'Something went wrong.')), `<button class="btn btn--secondary btn--sm" data-act="avx-retry">Try again</button>${keep}`);
}
function avxHintHtml() {
  if (AVX.stage === 'transcribing') return '';
  if (avxRec()) return `<div class="avx-hint" data-avx-hint>${avxHintListening()}<span class="avx-where">${esc(avxHeard())}</span></div>`;
  return AVX.note ? '' : `<div class="avx-hint" data-avx-hint>${avxHint()}<span class="avx-where">${esc(avxHeard())}</span></div>`;
}
// the pieces the chat's input draws (ai-chat.js aicHtml): avxTop above the box, avxIn inside it, avxRow beside send, avxBelow under it
function avxOk() { return api() && ainOn() && AIC.aiOn; }
function avxTop() { if (!avxOk()) return ''; if (!AVX.info && !AVX.loading) avxLoad(); return avxNoteHtml() + avxPill(); }
function avxIn() { return avxOk() ? avxLive() : ''; }
function avxRow(busy) { return avxOk() ? avxMic(busy) : ''; }
function avxBelow() { return avxOk() ? avxHintHtml() : ''; }
// the question the words made says it was spoken (a small mic and "spoken" after it)
{ const t0 = aicTurnHtml; aicTurnHtml = function (t) {   // eslint-disable-line no-global-assign
  if (AVX.spoken && !t.spoken && t.q === AVX.spoken) { t.spoken = true; AVX.spoken = null; }
  const h = t0.apply(this, arguments); return t.spoken ? h.replace(/(<div class="aic-q">[\s\S]*?)(<\/div>)/, `$1<span class="avx-qmic">${ic('mic')}spoken</span>$2`) : h; }; }
// and the placeholder says it is listening (after the Agent's own placeholder)
{ const h0 = aicHtml; aicHtml = function () { const h = h0.apply(this, arguments); return h && avxRec() ? h.replace(/(<textarea class="aic-in"[^>]*?)placeholder="[^"]*"/, '$1placeholder="Listening…"') : h; }; }   // eslint-disable-line no-global-assign

/* ---- starting, listening, stopping ---- */
function avxClear() { clearInterval(AVX.timer); AVX.timer = null; AVX.busyPoll = false; }
async function avxBegin(how) {   // how: click | pointer | key
  if (AVX.stage !== 'idle') return;
  if (!api()) { status('Speaking works in the NeuroVault app'); return; }
  const n = note(); if (!n || !ainOn() || AIC.busy) return;
  const seq = ++AVX.seq; AVX.note = null; AVX.stage = 'starting'; AVX.secs = 0; AVX.bars = []; AVX.words = ''; AVX.heard = false; AVX.long = false; AVX.rel = false; AVX.how = how; AVX.noteId = n.id; AVX.usedWhere = AVX.where; renderAll();
  const r = await nv('ask_voice_start'); if (seq !== AVX.seq) { if (!failed(r)) nv('ask_voice_discard'); return; }
  if (failed(r)) { AVX.stage = 'idle'; await avxProblem(r); return; }
  AVX.stage = 'listening'; AVX.usedWhere = r.where || AVX.where; status('Listening'); renderAll();
  avxPoll(seq);
  if (AVX.rel) avxRelease();   // let go before it had started
}
async function avxProblem(r) {   // a start that didn't happen: its card, or the first-use question
  if (r.code === 'first') { avxAskFirst(); return; }
  const kind = ['nomic', 'nomodel', 'nokey', 'busy'].includes(r.code) ? r.code : 'error';
  if (kind === 'nomodel') await avxLoad(true);
  AVX.note = { kind, message: r.message }; status(r.message || 'Speaking did not start'); AIC.focus = null; renderAll();
}
function avxPoll(seq) {
  avxClear();
  AVX.timer = setInterval(async () => {
    if (AVX.busyPoll) return; AVX.busyPoll = true;
    try { const r = await nv('ask_voice_poll'); if (seq !== AVX.seq) return; await avxTick(r, seq); } finally { AVX.busyPoll = false; } }, AIN_CHECK ? 15 : AVX_POLL);
}
async function avxTick(r, seq) {
  if (failed(r)) { avxClear(); AVX.stage = 'idle'; AVX.note = { kind: 'error', message: r.message }; renderAll(); return; }
  if (r.stage === 'recording') {
    AVX.secs = r.seconds || 0; AVX.bars = r.bars || []; AVX.words = r.words || ''; AVX.heard = !!r.heard;
    if (!AVX.long && AVX.secs >= AVX_LONG) { AVX.long = true; renderAll(); } else avxPaint();
    if (r.full) avxStop();                                                                  // the longest a question can be
    else if (AVX.start === 'auto' && ((r.heard && r.quiet >= AVX_QUIET) || (!r.heard && AVX.secs >= 8))) avxStop();   // tap once: it stops by itself after a pause
    return; }
  if (r.stage === 'transcribing') { if (AVX.stage !== 'transcribing') { AVX.stage = 'transcribing'; renderAll(); } return; }
  if (r.stage === 'done') { avxClear(); avxFinish(r.result?.text || ''); return; }
  if (r.stage === 'error') {
    avxClear(); AVX.stage = 'idle';
    if (r.code === 'nothing') AVX.note = { kind: 'nothing' };
    else if (r.code === 'key') AVX.note = { kind: 'nokey', message: r.message };
    else AVX.note = { kind: 'error', message: r.message };
    status(r.code === 'nothing' ? 'Nothing was heard' : r.message || 'Your words didn’t come through'); AIC.focus = null; renderAll(); }
}
function avxPaint() {   // the clock, the line and the words, in place (no redraw)
  app.querySelectorAll('[data-avx-time]').forEach(el => { el.textContent = mmss(AVX.secs); });
  app.querySelectorAll('[data-avx-words]').forEach(el => { el.innerHTML = avxWordsHtml(); });
  app.querySelectorAll('[data-avx-wave] i').forEach((b, i) => { b.style.height = avxBarH(AVX.bars[i + 2]) + '%'; });
}
async function avxStop() {
  if (AVX.stage !== 'listening') return; const seq = AVX.seq;
  AVX.stage = 'transcribing'; renderAll();
  const r = await nv('ask_voice_stop'); if (seq !== AVX.seq) return;
  if (failed(r)) { avxClear(); AVX.stage = 'idle'; if (r.code === 'first') { avxAskFirst(); return; } AVX.note = { kind: 'error', message: r.message }; renderAll(); }
}
function avxRelease() {   // hold to talk: let go. A tap is not a question: under 0.4 s it is dropped
  AVX.hold = null;
  if (AVX.stage === 'starting') { AVX.rel = true; return; }
  if (AVX.stage !== 'listening') return;
  if (AVX.secs < AVX_TAP_MIN / 1000 && (AVX.how === 'pointer' || AVX.how === 'key')) { avxDiscard('Hold the mic while you speak, and let go to finish'); return; }
  avxStop();
}
async function avxDiscard(msg) {
  const was = AVX.stage; if (was === 'idle') return;
  avxClear(); AVX.seq++; AVX.stage = 'idle'; AVX.note = null; AVX.long = false; AVX.rel = false; AVX.hold = null;
  if (api()) nv('ask_voice_discard');
  status(msg || 'Discarded: nothing was kept'); AIC.focus = '#aic-in'; renderAll();
}
function avxFinish(text) {   // the words are sent at once (R69: "send at once"); anything already typed goes with them
  AVX.stage = 'idle'; AVX.long = false; AVX.secs = 0; AVX.rel = false;
  const n = note(); if (!n || n.id !== AVX.noteId && AIC.follow !== 'keep') { status('The chat moved to another note, so what you said was dropped. Say it again there'); renderAll(); return; }
  const key = aicKey(n), draft = (AIC.drafts[key] || '').trim(), q = [draft, String(text || '').trim()].filter(Boolean).join(' ');
  if (!q) { AVX.note = { kind: 'nothing' }; renderAll(); return; }
  if (!ainOn() || AIC.busy || !api()) { AIC.drafts[key] = q; AIC.focus = '#aic-in'; status('Your words are in the box: press Enter to ask'); renderAll(); return; }
  AVX.spoken = q; setTimeout(() => { if (AVX.spoken === q) AVX.spoken = null; }, 4000);
  status('Sent as soon as you stopped speaking'); aicAsk(n, q);
}

/* ---- the first time a cloud model would hear you (R56's yes, for a recording) ---- */
function avxAskFirst() {
  if (app.querySelector('.aic-win--pop')) { AVX.note = { kind: 'first' }; status('Nothing is recorded yet: first, where it would go'); renderAll(); return; }   // the chat's own window: a card, not a dialog
  if (AVX.first) return;
  AVX.first = { back: S.modal || null }; S.modal = 'avx-first'; S.focus = { sel: '[data-dlg="avx-first"] [data-act="avx-fkeep"]' }; status('Nothing is recorded yet: first, where it would go'); renderAll();
}
function avxFirstHtml() {
  const c = avxCloud(), nm = esc(c.name);
  return dlg({ id: 'avx-first', size: 'sm', title: `Let ${nm} hear what you say?`, descId: 'dlg-avx-first-d', x: 'avx-fno', xLabel: 'Close: nothing is sent', xTitle: 'Close: nothing is sent (Esc)', keep: true,
    body: `<p class="set-desc" id="dlg-avx-first-d">${nm} turns your recording into words (${esc(c.model)}, quicker on an older PC). Each recording goes to ${nm}; the words come back into the box. ${nm} keeps it as its terms say, linked from Settings → AI models.</p><p class="set-desc">Or keep it on this PC: ${esc(avxModel())}, slower, and nothing you say leaves it.</p>`,
    cancel: '<button class="btn btn--secondary" data-act="avx-fkeep">Keep it on this PC</button>', main: `<button class="btn btn--primary" data-act="avx-fyes">Use ${nm}</button>` });
}
{ const m0 = renderModal; renderModal = function () { return S.modal === 'avx-first' ? avxFirstHtml() : m0.apply(this, arguments); }; }   // eslint-disable-line no-global-assign
async function avxFirstAnswer(how) {   // yes | keep | no
  const f = AVX.first || (AVX.note?.kind === 'first' ? { back: null } : null); if (!f) return; AVX.first = null; AVX.note = null; if (S.modal === 'avx-first') S.modal = f.back;
  if (how === 'yes') {
    const r = await nv('ask_voice_cloud_yes', true); if (failed(r)) { toast(r.message || "That didn't work."); renderAll(); return; }
    AVX.seen = true; AVX.where = 'cloud'; if (AVX.info) { AVX.info.where = 'cloud'; if (AVX.info.cloud) AVX.info.cloud.seen = true; }
    status(`${avxCloud().name} hears what you say from now on. Change it in Settings → Voice`); renderAll(); avxBegin('click');
  } else if (how === 'keep') {
    AVX.where = 'pc'; if (AVX.info) AVX.info.where = 'pc'; saveSettings({ ask_voice_where: 'pc' }); status('Heard on this PC'); renderAll(); avxBegin('click');
  } else { status('Nothing was sent'); renderAll(); }
}
{ const a0 = afterRender; afterRender = function () { a0.apply(this, arguments);   // eslint-disable-line no-global-assign
  if (AVX.first && S.modal !== 'avx-first') { AVX.first = null; }
  if (avxRec() || AVX.stage === 'transcribing') {   // the chat went away (closed, or another note): what was said is dropped
    const n = note();
    if (!app.querySelector('.avx-mic') || (n && AVX.noteId && n.id !== AVX.noteId && AIC.follow !== 'keep')) setTimeout(() => avxDiscard('The chat changed: nothing was kept'));
  } }; }

/* ---- the speech model, downloaded from the card (the ramble's own download) ---- */
async function avxDownload() {
  const name = AVX.info?.model?.name || avxModel();
  AVX.dl = { stage: 'downloading', name, done: 0, total: 1 };
  if (typeof voiceDownload === 'function') await voiceDownload(name);
  clearInterval(avxDownload.t);
  avxDownload.t = setInterval(async () => {
    const r = await nv('ask_voice_status'); if (failed(r)) return; AVX.info = r; AVX.dl = r.download;
    if (r.download?.stage === 'downloading') { if (!app.querySelector('[data-voice-dl]')) renderAll(); return; }
    clearInterval(avxDownload.t); AVX.dl = null;
    if (r.model?.present) { AVX.note = null; status('The speech model is ready: tap the mic'); } else if (r.download?.stage === 'error') AVX.note = /cancel/i.test(r.download.message || '') ? { kind: 'nomodel' } : { kind: 'error', message: r.download.message };
    renderAll(); }, AIN_CHECK ? 20 : 500);
}

/* ---- clicks, keys ---- */
app.addEventListener('click', e => {
  const t = e.target.closest?.('[data-act^="avx-"]'); if (!t) return;
  const act = t.dataset.act;
  if (act === 'avx-mic') {
    if (t.getAttribute('aria-disabled') === 'true') { const k = AVX.note?.kind; status(k === 'nomic' ? 'No microphone: see Microphone settings' : k === 'nomodel' ? 'Download the speech model first' : AIC.busy ? 'One answer at a time' : 'One moment'); return; }
    if (AVX.start === 'hold' && e.detail > 0) return;   // a mouse press is handled on pointerdown / pointerup; a key press (detail 0) toggles
    if (AVX.stage === 'idle') avxBegin('click'); else if (AVX.stage === 'listening') avxStop(); return; }
  if (act === 'avx-stop') avxStop();
  else if (act === 'avx-discard') avxDiscard();
  else if (act === 'avx-micset') nv('open_mic_settings').then(r => { if (failed(r)) status(r.message); });
  else if (act === 'avx-dl') avxDownload();
  else if (act === 'avx-type') { AVX.note = null; AIC.focus = '#aic-in'; renderAll(); }
  else if (act === 'avx-retry') { AVX.note = null; avxBegin('click'); }
  else if (act === 'avx-ai') { AVX.note = null; openSettings('ai'); }
  else if (act === 'avx-usepc') { AVX.where = 'pc'; if (AVX.info) AVX.info.where = 'pc'; saveSettings({ ask_voice_where: 'pc' }); AVX.note = null; status('Heard on this PC'); avxBegin('click'); }
  else if (act === 'avx-usecloud') { AVX.where = 'cloud'; saveSettings({ ask_voice_where: 'cloud' }); AVX.note = null; avxBegin('click'); }
  else if (act === 'avx-fyes') avxFirstAnswer('yes');
  else if (act === 'avx-fkeep') avxFirstAnswer('keep');
  else if (act === 'avx-fno') avxFirstAnswer('no');
  else if (act === 'avx-again') { nv('ask_voice_cloud_yes', false).then(() => { AVX.seen = false; if (AVX.info?.cloud) AVX.info.cloud.seen = false; renderAll(); }); }
});
app.addEventListener('pointerdown', e => {   // hold to talk: the press starts it, letting go anywhere finishes it
  const m = e.target.closest?.('.avx-mic'); if (!m || e.button !== 0 || AVX.start !== 'hold' || m.getAttribute('aria-disabled') === 'true' || AVX.stage !== 'idle') return;
  e.preventDefault(); AVX.hold = 'pointer'; avxBegin('pointer');
});
document.addEventListener('pointerup', () => { if (AVX.hold === 'pointer') avxRelease(); }, true);
document.addEventListener('pointercancel', () => { if (AVX.hold === 'pointer') avxRelease(); }, true);
window.addEventListener('keydown', e => {   // on the window, capturing: before the chat's own Esc, which would close it
  if (e.key === 'Escape' && AVX.note?.kind === 'first') { e.preventDefault(); e.stopImmediatePropagation(); avxFirstAnswer('no'); return; }
  if (e.key === 'Escape' && S.modal === 'avx-first') { e.preventDefault(); e.stopImmediatePropagation(); avxFirstAnswer('no'); return; }
  if (e.key === 'Escape' && (AVX.stage === 'starting' || AVX.stage === 'listening' || AVX.stage === 'transcribing')) { e.preventDefault(); e.stopImmediatePropagation(); avxDiscard(); return; }
  if (AVX.start === 'hold' && e.ctrlKey && e.code === 'Space' && !e.repeat && app.querySelector('.avx-mic') && !e.target.closest?.('.doc, [contenteditable="true"]') && S.modal !== 'avx-first') {
    e.preventDefault(); if (AVX.stage === 'idle') { AVX.hold = 'key'; avxBegin('key'); } }
}, true);
document.addEventListener('keyup', e => { if (AVX.hold === 'key' && (e.code === 'Space' || e.key === 'Control')) avxRelease(); }, true);

/* ---- Settings → Voice: Start and stop, and Where your words are heard (a plain line each) ---- */
function avxRows() {
  const sel = (k, cur, list, id) => `<select class="field" data-avx-set="${k}" id="${id}" aria-labelledby="${id}-l" ${api() ? '' : 'disabled'}>${list.map(([v, l]) => `<option value="${v}" ${v === cur ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>`;
  if (!AVX.info && api() && !AVX.loading) avxLoad();
  const cl = AVX.info?.cloud, cloudLine = AVX.where === 'cloud' ? (cl && !cl.has_key ? ` Add a ${esc(cl.name)} key in Settings → AI models first.` : AVX.seen ? ` You said yes to ${esc(avxCloud().name)} hearing you.` : ` You’ll be asked once before anything is recorded.`) : '';
  return `<div class="set-row" data-avx-row="start"><div><div class="set-label" id="avx-start-l">Start and stop</div><div class="set-desc" data-avx-desc="start">${esc(AVX_STC[AVX.start])}</div></div>${sel('start', AVX.start, AVX_STARTS, 'avx-start')}</div>
    <div class="set-row" data-avx-row="where"><div><div class="set-label" id="avx-where-l">Where your words are heard</div><div class="set-desc" data-avx-desc="where">${esc(avxHc())}${cloudLine}${AVX.where === 'cloud' && AVX.seen ? ` <button class="cl-link" data-act="avx-again">Ask me again</button>` : ''}</div></div>${sel('where', AVX.where, AVX_WHERES, 'avx-where')}</div>`;
}
VOICE_PAGE.splice(Math.max(0, VOICE_PAGE.indexOf(sttRows)) + 1, 0, avxRows);   // right under the speech-to-text rows
app.addEventListener('change', e => {
  const k = e.target.dataset?.avxSet; if (!k) return; const v = e.target.value;
  if (k === 'start' && AVX_STARTS.some(x => x[0] === v)) { AVX.start = v; saveSettings({ ask_voice_start: v }); status('Setting saved: ' + AVX_STC[v]); }
  if (k === 'where' && AVX_WHERES.some(x => x[0] === v)) { AVX.where = v; if (AVX.info) AVX.info.where = v; saveSettings({ ask_voice_where: v }); status(v === 'cloud' ? 'Words will be heard by a cloud model, after a first-use yes' : 'Words are heard on this PC'); }
  S.focus = { sel: `#avx-${k}` }; renderAll();
});
/* ==== end Build N · R69 ==== */
