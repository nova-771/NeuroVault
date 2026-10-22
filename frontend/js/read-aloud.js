/* =====================================================================
   PHASE 6C · READ ALOUD — the read bar (play / pause, speed 0.75–2×, voice, Fix B's progress line), karaoke
   highlighting in the note (the sentence tinted, the spoken word underlined), and Settings → Voice's read-aloud rows.
   Two engines, chosen in Settings → Voice so they can be compared:
   · Windows voices: the page's own speechSynthesis (WebView2). Its word boundary events give exact word timing.
   · Kokoro: sherpa-onnx in Python (read_aloud.py). Fix B (QC round 3): the note goes to Python whole, in short
     clause-sized pieces; background workers make it all ahead (cached per piece, so reading again or jumping is
     instant), and the page plays the pieces as one Web Audio stream, waiting at the start just long enough that
     playback can't catch up ("Preparing… 6 s"). Word timing is estimated in Python.
     With no model on disk, the setting says so and reading uses Windows voices.
   The note is read from the spans decorateDoc() makes (render-notes.js: .ka-w words with data-w, every span with its
   sentence's data-s). Loaded before actions.js; this file has its own listeners.
   Mockup R20: readBar, readStep, the karaoke CSS, the header's Read aloud button and "Highlight as it reads".
   ===================================================================== */
'use strict';
const READ_SPEEDS = [.75, 1, 1.25, 1.5, 2];
const READ_ENGINES = [['windows', 'Windows'], ['sherpa', 'Kokoro']];   // Fix B: Piper's two voices are gone (licences)
const READ_TRY = 'This is how your notes will sound when they are read aloud.';
const READ = { engine: 'windows', voiceWin: '', voiceSherpa: '', speed: 1,   // saved in config.json (read_*)
  playing: false, paused: false, busy: false, ix: 0, noteId: null, run: 0, raf: 0, est: 0,
  sherpa: null, sherpaBusy: null, winVoices: [], tryAudio: null,
  // Fix B: the Kokoro stream. pieces [{start, end, sent, text, gap}], durs (seconds each: made, or estimated),
  // bufs (piece → {buf, words}), sched (what's queued on the audio clock), state '' | 'wait' | 'play'
  job: null, jobKey: '', pieces: null, durs: [], bufs: new Map(), sched: [], ctx: null, gain: null, state: '',
  at: 0, nextI: 0, nextT: 0, seekWord: null, wait: 0, waitAt: 0, waitFor: -1, jobState: '', loop: 0, pollT: 0, pos: 0, gaps: [] };
const CHECK_READ = new URLSearchParams(location.search).get('check') === '1';   // the layout check opens the bar but never speaks
const READ_VOL = new URLSearchParams(location.search).get('mute') === '1' ? 0 : 1;   // Fix B: tests open the page with ?mute=1, so the stream plays at a gain of 0 (silent)
COMFORT_KEYS.karaoke = ['read_highlight']; S.a11y.karaoke = true;   // "Highlight as it reads" saves like the other comfort switches

// From config.json (store.js readerFromConfig calls this)
function readFromConfig(c) {
  if (READ_ENGINES.some(([k]) => k === c.read_engine)) READ.engine = c.read_engine;
  if (typeof c.read_voice_windows === 'string') READ.voiceWin = c.read_voice_windows;
  if (typeof c.read_voice_sherpa === 'string') READ.voiceSherpa = c.read_voice_sherpa;
  if (READ_SPEEDS.includes(c.read_speed)) READ.speed = c.read_speed;
}

/* ---- Voices ---- */
const hasSpeech = () => 'speechSynthesis' in window && 'SpeechSynthesisUtterance' in window;
function loadWinVoices() {
  if (!hasSpeech()) return;
  const all = speechSynthesis.getVoices(), en = all.filter(v => /^en/i.test(v.lang));
  READ.winVoices = (en.length ? en : all).slice().sort((a, b) => (b.localService - a.localService) || a.name.localeCompare(b.name));
}
if (hasSpeech()) { loadWinVoices(); speechSynthesis.addEventListener('voiceschanged', () => { loadWinVoices(); if (!CHECK_READ && (S.modal === 'read' || S.modal === 'settings')) renderAll(); }); }
// "Microsoft Zira - English (United States)" → "Windows · Zira"; online voices say so
const winLabel = v => 'Windows · ' + v.name.replace(/^Microsoft\s+/, '').replace(/\s+-\s+.*$/, '').replace(/\s*Online \(Natural\)/, '') + (v.localService ? '' : ' (online)');
// The Kokoro voices on this PC: asked once, again when Settings → Voice or the read bar opens
function loadSherpaStatus(rerender) {
  if (!api()) { READ.sherpa ||= { available: false, voices: [], message: 'Kokoro runs in the app, not in a plain browser.' }; return Promise.resolve(READ.sherpa); }
  return READ.sherpaBusy ||= nv('read_aloud_status').then(r => {
    READ.sherpaBusy = null;
    READ.sherpa = failed(r) ? { available: false, voices: [], message: r?.message || 'The voice models could not be checked.' } : r;
    if (rerender && (S.modal === 'settings' || S.modal === 'read')) renderAll();
    return READ.sherpa;
  });
}
const readEngine = () => READ.engine === 'sherpa' && READ.sherpa?.available ? 'sherpa' : 'windows';
function voiceList() {
  if (readEngine() === 'sherpa') return READ.sherpa.voices.map(v => [v.id, v.label]);
  return READ.winVoices.map(v => [v.voiceURI, winLabel(v)]);
}
function currentVoice() {
  const list = voiceList(), want = readEngine() === 'sherpa' ? READ.voiceSherpa : READ.voiceWin;
  if (list.some(([id]) => id === want)) return want;
  if (readEngine() === 'windows') { const d = READ.winVoices.find(v => v.default && list.some(([id]) => id === v.voiceURI)); if (d) return d.voiceURI; }
  return list[0]?.[0] || '';
}
const winVoice = () => READ.winVoices.find(v => v.voiceURI === currentVoice()) || null;

/* ---- The note, as words and sentences (decorateDoc made the spans) ---- */
const readDocEl = () => READ.noteId ? app.querySelector(`.doc[data-note="${CSS.escape(READ.noteId)}"]`) : null;
const readWords = () => { const d = readDocEl(); return d ? [...d.querySelectorAll('.ka-w')] : []; };
// QC 84 (Build V, overnight): what a word says. A [[wiki link]] is one word (decorateDoc) that says its label: [[Note.md|Label]] →
// "Label", [[Folder/Note name.md]] → "Note name", [[Note#Part]] → "Note, Part", ![[attachments/song.ogg]] → "song". Its spaces are
// non-breaking, so a piece still has one space per word
const readSay = w => w.dataset.say ?? w.textContent;
function readSayLink(raw) {
  const inner = String(raw || '').trim().replace(/^!?\[\[/, '').replace(/\]\]$/, ''), bar = inner.indexOf('|');
  let say = bar >= 0 ? inner.slice(bar + 1) : inner.split('|')[0];
  if (bar < 0) { const [page, part] = say.split('#'); say = page.split('/').pop().replace(/\.(md|markdown|txt|png|jpe?g|gif|webp|svg|pdf|docx?|ogg|mp3|m4a|wav|webm|csv|html?)$/i, '') + (part ? ', ' + part.replace(/^\^/, '') : ''); }
  return say.trim().replace(/\s+/g, '\u00a0') || 'link';
}
// From word ix to the end of its sentence (at most 60 words, cut after a comma when it can be)
function segmentFrom(ix) {
  const ws = readWords(); if (ix >= ws.length) return null;
  const s = ws[ix].dataset.s; let j = ix;
  while (j + 1 < ws.length && ws[j + 1].dataset.s === s && j - ix < 59) j++;
  if (j - ix === 59 && ws[j + 1]?.dataset.s === s) { for (let k = j; k > ix + 20; k--) if (/[,;:]$/.test(ws[k].textContent)) { j = k; break; } }
  return { start: ix, end: j, words: ws.slice(ix, j + 1).map(readSay) };
}
function paintRead() {
  const doc = readDocEl(); if (!doc) return;
  doc.querySelectorAll('.is-word, .is-sent').forEach(x => x.classList.remove('is-word', 'is-sent'));
  const w = doc.querySelector(`[data-w="${READ.ix}"]`); if (!w) return;
  if (S.a11y.karaoke) { doc.querySelectorAll(`[data-s="${w.dataset.s}"]`).forEach(x => x.classList.add('is-sent')); w.classList.add('is-word'); }
  if (READ.playing) w.scrollIntoView({ block: 'nearest' });
}
function setIx(i) { if (i === READ.ix) return; READ.ix = i; paintRead(); }

/* ---- Playing: one engine at a time; READ.run tells a late event from a stopped run to do nothing ---- */
function stopSpeech() {
  READ.run++; clearInterval(READ.est); cancelAnimationFrame(READ.raf);
  if (hasSpeech()) speechSynthesis.cancel();
  if (READ.tryAudio) { READ.tryAudio.pause(); READ.tryAudio = null; }
  readHush(); clearInterval(READ.loop); clearTimeout(READ.pollT); READ.state = '';   // Fix B: the stream stops; the note keeps being made
  READ.paused = false; READ.busy = false;
}
function stopReading() { stopSpeech(); READ.playing = false; readEndJob(); }
function playReading() {
  if (readEngine() === 'sherpa' && READ.paused && READ.job) {   // Kokoro: carry on where it paused (the audio clock was frozen)
    READ.paused = false; READ.playing = true; READ.ctx?.resume(); readLoop(READ.run); readPoll(READ.run); return;
  }
  stopSpeech();
  if (!readWords().length) { toast(readDocEl() ? 'Nothing to read in this note' : 'Switch to Document or Split to read aloud'); READ.playing = false; return; }
  READ.playing = true; paintRead();
  if (readEngine() === 'sherpa') sherpaPlay(READ.ix, READ.run); else speakWin(READ.ix, READ.run);
}
function pauseReading() {
  if (readEngine() === 'sherpa' && READ.job) { READ.ctx?.suspend(); cancelAnimationFrame(READ.raf); clearInterval(READ.loop); READ.paused = true; READ.playing = false; return; }
  stopReading();   // Windows voices start again at the word they reached
}
function finishReading() { stopReading(); READ.ix = 0; READ.pos = 0; READ.at = 0; status('Finished reading'); renderAll(); }
function paintReadSub() { const el = app.querySelector('[data-read-sub]'), t = readSub(); if (el && el.textContent !== t) el.textContent = t; }
const readWaitLeft = () => Math.max(0, READ.wait - (performance.now() - READ.waitAt) / 1000);
const readSub = () => READ.busy ? 'Preparing the voice…'
  : readEngine() === 'sherpa' ? (READ.state === 'wait' && (READ.playing || READ.paused) ? (READ.job && READ.waitFor >= 0 ? `Preparing… ${Math.max(1, Math.ceil(readWaitLeft()))} s` : 'Preparing…') : 'On this PC')
  : winVoice() && !winVoice().localService ? 'Online voice' : 'On this PC';

// Windows voices: one utterance per sentence; its boundary events say which word is being spoken
function speakWin(ix, run) {
  const seg = segmentFrom(ix); if (!seg) { finishReading(); return; }
  if (!hasSpeech() || !READ.winVoices.length && !speechSynthesis.getVoices().length) { stopReading(); toast('No Windows voices were found on this PC'); renderAll(); return; }
  const offs = []; let text = '';
  seg.words.forEach(w => { offs.push(text.length); text += w + ' '; });
  const at = c => { let k = 0; while (k + 1 < offs.length && offs[k + 1] <= c) k++; return seg.start + k; };
  const u = new SpeechSynthesisUtterance(text.trim()), v = winVoice();
  if (v) { u.voice = v; u.lang = v.lang; } u.rate = READ.speed; u.volume = READ_VOL;
  let heard = false, t0 = 0;
  u.onstart = () => { if (run !== READ.run) return; t0 = performance.now(); setIx(seg.start); };
  u.onboundary = e => { if (run !== READ.run || (e.name && e.name !== 'word')) return; heard = true; setIx(at(e.charIndex)); };
  // A voice without boundary events: step through the words at about 14 characters a second
  clearInterval(READ.est);
  READ.est = setInterval(() => { if (run !== READ.run) return; paintReadProgress(); if (heard || !t0) return; const s = (performance.now() - t0) / 1000; if (s > .5) setIx(at(s * 14 * READ.speed)); }, 120);
  u.onend = () => { if (run !== READ.run) return; clearInterval(READ.est); speakWin(seg.end + 1, run); };
  u.onerror = e => { if (run !== READ.run || e.error === 'interrupted' || e.error === 'canceled') return; stopReading(); toast('The Windows voice stopped: ' + e.error); renderAll(); };
  READ.utt = u;   // kept, or the browser may drop it (and its events) mid-sentence
  speechSynthesis.speak(u);
}

/* ==== Fix B (QC round 3, items 9–12): Kokoro as one continuous stream ==== */
const READ_GAP = { clause: .12, sentence: .32, block: .6 };   // the rest after a piece, in seconds at 1×
const READ_AHEAD = 4;    // seconds queued on the audio clock (timers slow to once a second when the window is behind)
const READ_FETCH = 40;   // seconds of audio fetched ahead of where it's reading
const READ_SPC = .062;   // seconds of speech per character at 1×, until Python has measured the voice

// The note in short pieces: a sentence each, or its clauses when it's long (over 16 words, cut after , ; : or a dash
// with 5 words before and 4 after; never more than 30 words)
const readBlock = w => w.closest('p, li, h1, h2, h3, h4, h5, h6, blockquote, .task, td, th, summary');
function readPieces() {
  const ws = readWords(), out = [];
  for (let i = 0; i < ws.length;) {
    const s = ws[i].dataset.s; let j = i;
    while (j + 1 < ws.length && ws[j + 1].dataset.s === s) j++;
    let a = i;
    for (let k = i; k < j; k++) {
      const len = k - a + 1, rest = j - k, w = ws[k].textContent;
      if (rest >= 4 && (j - i >= 16 && len >= 5 && (/[,;:]["')\]]*$/.test(w) || /^[–—-]$/.test(ws[k + 1].textContent)) || len >= 30)) { out.push({ start: a, end: k, sent: +s }); a = k + 1; }
    }
    out.push({ start: a, end: j, sent: +s }); i = j + 1;
  }
  out.forEach((p, k) => {
    p.text = ws.slice(p.start, p.end + 1).map(readSay).join(' ').slice(0, 1900);
    const nx = out[k + 1]; p.gap = !nx ? '' : nx.sent === p.sent ? 'clause' : readBlock(ws[p.end]) !== readBlock(ws[nx.start]) ? 'block' : 'sentence';
  });
  return out;
}
const readPieceOf = ix => { const ps = READ.pieces || []; let k = 0; while (k + 1 < ps.length && ps[k + 1].start <= ix) k++; return k; };
const readGapS = i => (READ_GAP[READ.pieces?.[i]?.gap] || 0) / READ.speed;
// Where each piece starts on the timeline (seconds), and the whole note's length
function readTl() {
  const ps = READ.pieces || [], tl = [0];
  ps.forEach((p, i) => tl.push(tl[i] + (READ.durs[i] ?? p.text.length * READ_SPC / READ.speed) + readGapS(i)));
  return tl;
}
// One audio clock for the session, at Kokoro's own rate (24 kHz), so its pieces play without resampling in the page.
// Made on a click (play), as the browser asks.
function readCtx() {
  if (READ.ctx && READ.ctx.state !== 'closed') return READ.ctx;
  const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return null;
  try { READ.ctx = new AC({ latencyHint: 'playback', sampleRate: 24000 }); } catch { READ.ctx = new AC({ latencyHint: 'playback' }); }
  READ.gain = READ.ctx.createGain(); READ.gain.gain.value = READ_VOL; READ.gain.connect(READ.ctx.destination);
  return READ.ctx;
}
// Stops what's queued with a 15 ms fade (stopping a sound mid-wave clicks)
function readHush() {
  const ctx = READ.ctx; if (!ctx || !READ.sched.length) { READ.sched = []; return; }
  const t = ctx.currentTime, g = READ.gain.gain;
  g.cancelScheduledValues(t); g.setValueAtTime(g.value, t); g.linearRampToValueAtTime(0, t + .015);
  READ.sched.forEach(s => { try { s.src.stop(t + .02); } catch { /* already stopped */ } });
  g.setValueAtTime(READ_VOL, t + .025); READ.sched = [];
}
function readEndJob() {
  clearTimeout(READ.pollT);
  if (READ.job && api()) api().read_aloud_stop(READ.job);
  READ.job = null; READ.jobKey = ''; READ.bufs.clear(); READ.jobState = '';
}
const readKey = ps => [READ.noteId, currentVoice(), READ.speed, ps.map(p => p.text).join('\n')].join('|');
// Start (or carry on) reading from word ix: the same note, voice and speed keep their job, so a jump is instant
async function sherpaPlay(ix, run) {
  const ctx = readCtx(); if (!ctx) { stopReading(); toast('This window can\'t play audio'); renderAll(); return; }
  ctx.resume();
  const ps = readPieces(), key = readKey(ps);
  if (key !== READ.jobKey) { readEndJob(); READ.pieces = ps; READ.durs = ps.map(p => p.text.length * READ_SPC / READ.speed); }
  const p = readPieceOf(ix);
  Object.assign(READ, { at: p, nextI: p, seekWord: ix, state: 'wait', sched: [], gaps: [], waitFor: -1 });   // waits for a poll from here
  readLoop(run);
  if (!READ.job) {
    paintReadSub();
    const voice = currentVoice();
    const r = await within(api().read_aloud_start(ps.map(x => x.text), voice, READ.speed, p), 30000).catch(e => ({ status: 'error', message: plainErr(e, 'The voice did not answer.') }));
    if (run !== READ.run) { if (r?.job) api().read_aloud_stop(r.job); return; }
    if (failed(r)) {
      if (r?.missing) { READ.sherpa = { available: false, voices: [], message: r.message }; toast('No Kokoro voice on this PC: reading with Windows voices'); READ.ix = ix; playReading(); renderAll(); return; }
      stopReading(); toast(r?.message || 'The voice did not answer'); renderAll(); return;
    }
    if (r.voice !== voice) { READ.voiceSherpa = r.voice; saveSettings({ read_voice_sherpa: r.voice }); }   // a voice that's gone (or a Piper one): Kokoro reads
    Object.assign(READ, { job: r.job, jobKey: readKey(ps), durs: r.durs, wait: r.wait, waitAt: performance.now(), jobState: '' });
    if (r.voice !== voice) renderAll();
  }
  readPoll(run);
}
// The pieces wanted next: from where it's reading, up to READ_FETCH seconds ahead, that aren't here yet
function readWant() {
  const out = []; let ahead = 0;
  for (let i = READ.at; i < (READ.pieces?.length || 0) && ahead < READ_FETCH && out.length < 12; i++) { if (!READ.bufs.has(i)) out.push(i); ahead += READ.durs[i] || 0; }
  return out;
}
function readDecode(pc) {
  const bin = atob(pc.audio), n = bin.length >> 1, f = new Float32Array(n);
  for (let k = 0; k < n; k++) { const v = bin.charCodeAt(2 * k) | bin.charCodeAt(2 * k + 1) << 8; f[k] = (v & 0x8000 ? v - 0x10000 : v) / 32768; }
  const buf = READ.ctx.createBuffer(1, Math.max(1, n), pc.sr); buf.copyToChannel(f, 0);
  return { buf, words: pc.words };
}
async function readPoll(run) {
  clearTimeout(READ.pollT);
  if (run !== READ.run || !READ.job || READ.paused) return;
  const at = READ.at, want = readWant(), r = await nv('read_aloud_poll', READ.job, at, want);
  if (run !== READ.run || !READ.job) return;
  if (failed(r)) {
    if (r?.state === 'stopped') { READ.jobKey = ''; READ.job = null; sherpaPlay(READ.ix, run); return; }   // Python lost the job (restarted): start it again from here
    if (!r?.offline) { stopReading(); toast(r?.message || 'The voice stopped'); renderAll(); return; }
  } else {
    READ.durs = r.durs; READ.wait = r.wait; READ.waitAt = performance.now(); READ.waitFor = at; READ.jobState = r.state;
    Object.entries(r.pieces || {}).forEach(([i, pc]) => READ.bufs.set(+i, readDecode(pc)));
    for (const i of READ.bufs.keys()) if (i < READ.at - 2) READ.bufs.delete(i);   // the cache in Python keeps them: a jump back fetches them again
    if (r.state === 'error') { stopReading(); toast('The voice stopped: ' + (r.message || 'unknown error')); renderAll(); return; }
    readPump();
  }
  const more = READ.jobState === 'making' || readWant().some(i => i < READ.at + 3);
  READ.pollT = setTimeout(() => readPoll(run), READ.state === 'wait' ? 200 : more ? 400 : 1000);
}
// Queues the pieces on the audio clock, back to back with their rests; starts once the wait is over
function readPump() {
  const ctx = READ.ctx; if (!ctx || READ.paused || !READ.pieces) return;
  const now = ctx.currentTime, n = READ.pieces.length;
  if (READ.state === 'wait') {
    if (READ.nextI >= n) { finishReading(); return; }
    if (!READ.job || READ.waitFor !== READ.nextI || !READ.bufs.has(READ.nextI) || READ.jobState === 'making' && readWaitLeft() > 0) { paintReadSub(); return; }
    READ.state = 'play'; READ.nextT = now + .06; paintReadSub();
  }
  if (READ.state !== 'play') return;
  while (READ.nextI < n && READ.nextT - now < READ_AHEAD) {
    const i = READ.nextI, b = READ.bufs.get(i); if (!b) break;
    let off = 0;
    if (READ.seekWord != null) { const k = READ.seekWord - READ.pieces[i].start; if (k > 0 && b.words[k]) off = Math.max(0, b.words[k][0] - .03); READ.seekWord = null; }
    const src = ctx.createBufferSource(); src.buffer = b.buf; src.connect(READ.gain);
    const t = Math.max(READ.nextT, now + .04), last = READ.sched[READ.sched.length - 1];
    if (last) READ.gaps.push(+(t - last.end - readGapS(last.i)).toFixed(3));   // 0 unless the stream ran dry (measured for QC)
    src.start(t, off);
    READ.sched.push({ i, t0: t - off, start: t, end: t + b.buf.duration - off, src });
    READ.nextT = t + b.buf.duration - off + readGapS(i); READ.nextI++;
  }
  const last = READ.sched[READ.sched.length - 1];
  if (READ.nextI >= n) { if (!last || now >= last.end + .05) finishReading(); return; }
  if (!READ.bufs.has(READ.nextI) && (!last || now >= last.end)) { READ.state = 'wait'; READ.at = READ.nextI; READ.waitFor = -1; paintReadSub(); }   // ran dry: wait again, in silence
  READ.sched = READ.sched.filter(s => s.end > now - 2);
}
// The highlight and the progress line, from what the audio clock is playing now
function readTick() {
  const ctx = READ.ctx; if (!ctx || READ.state !== 'play') return;
  const ts = ctx.getOutputTimestamp?.(), now = ts?.contextTime > 0 ? ts.contextTime : ctx.currentTime;   // what's heard, not what's queued
  let s = null; for (const x of READ.sched) if (x.start <= now + .01) s = x;
  if (!s) return;
  const t = now - s.t0, words = READ.bufs.get(s.i)?.words || [];
  let k = 0; while (k + 1 < words.length && words[k + 1][0] <= t) k++;
  READ.at = s.i; setIx(READ.pieces[s.i].start + k);
  READ.pos = readTl()[s.i] + Math.min(Math.max(0, t), (READ.durs[s.i] || 0) + readGapS(s.i));
}
function readLoop(run) {
  clearInterval(READ.loop); cancelAnimationFrame(READ.raf);
  const frame = () => { if (run !== READ.run || READ.paused) return; readPump(); readTick(); paintReadProgress(); paintReadSub(); };
  READ.loop = setInterval(frame, 200);   // keeps going when the window is behind (frames stop then)
  const raf = () => { if (run !== READ.run || READ.paused) return; frame(); READ.raf = requestAnimationFrame(raf); };
  READ.raf = requestAnimationFrame(raf);
}

/* ---- The progress line: where it's reading, elapsed / left; a click or the arrow keys go to a sentence ---- */
// {pos, total, left} in seconds. Kokoro: the pieces' real lengths once made (estimates until then, from the voice's
// measured speed), plus the wait. Windows voices: about 14 characters a second.
function readTimeline() {
  if (readEngine() === 'sherpa' && READ.pieces?.length && READ.noteId) {
    const tl = readTl(), total = tl[tl.length - 1];
    const pos = READ.state === 'play' || READ.paused ? READ.pos : tl[Math.min(READ.at, tl.length - 1)];
    return { pos, total, left: Math.max(0, total - pos) + (READ.state === 'wait' && (READ.playing || READ.paused) ? readWaitLeft() : 0) };
  }
  const ws = readWords(); if (!ws.length) return { pos: 0, total: 0, left: 0 };
  let before = 0, all = 0; ws.forEach((w, i) => { const c = w.textContent.length + 1; all += c; if (i < READ.ix) before += c; });
  const cps = (readEngine() === 'sherpa' ? 1 / READ_SPC : 14) * READ.speed; return { pos: before / cps, total: all / cps, left: (all - before) / cps };
}
const readClock = s => { s = Math.max(0, Math.round(s)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
function paintReadProgress() {
  const bar = app.querySelector('.readbar'); if (!bar) return;
  const { pos, total, left } = readTimeline(), pct = total ? Math.min(100, pos / total * 100) : 0;
  const el = bar.querySelector('[data-read-el]'), lf = bar.querySelector('[data-read-left]'), fill = bar.querySelector('[data-read-fill]'), tr = bar.querySelector('[data-act="read-seek"]');
  const a = readClock(pos), b = readClock(left) + ' left';
  if (el && el.textContent !== a) el.textContent = a;
  if (lf && lf.textContent !== b) lf.textContent = b;
  if (fill) fill.style.width = pct.toFixed(2) + '%';
  if (tr) { tr.setAttribute('aria-valuenow', Math.round(pct)); tr.setAttribute('aria-valuetext', `${a} read, ${b}`); }
}
// The first word of each sentence
function readSentStarts() { const ws = readWords(), out = []; ws.forEach((w, i) => { if (!i || w.dataset.s !== ws[i - 1].dataset.s) out.push(i); }); return out; }
function readJump(word) {
  READ.ix = word; READ.pos = 0;
  if (READ.playing || READ.paused) { READ.paused = false; playReading(); }
  else { if (READ.pieces) { READ.at = readPieceOf(word); READ.pos = readTl()[READ.at]; } paintRead(); }
  paintReadProgress();
}
// A share of the line (0–1) → the start of the sentence that's playing at that point
function readSeekShare(f) {
  const ws = readWords(); if (!ws.length) return 0;
  let w = 0;
  if (readEngine() === 'sherpa' && READ.pieces?.length) {
    const tl = readTl(), at = f * tl[tl.length - 1]; let i = 0; while (i + 1 < READ.pieces.length && tl[i + 1] <= at) i++;
    w = READ.pieces[i].start;
  } else {
    const all = ws.reduce((n, x) => n + x.textContent.length + 1, 0); let c = 0;
    for (w = 0; w < ws.length - 1 && c + ws[w].textContent.length + 1 <= f * all; w++) c += ws[w].textContent.length + 1;
  }
  const s = ws[w].dataset.s; while (w > 0 && ws[w - 1].dataset.s === s) w--;
  return w;
}
/* ==== end Fix B ==== */

// Settings → Voice: "Try it" says one sentence with the chosen engine, voice and speed (no highlighting)
async function tryVoice() {
  stopReading(); const run = READ.run;
  if (readEngine() === 'sherpa') {
    status('Preparing the voice…');
    const r = await within(api().read_aloud_speak(READ_TRY, currentVoice(), READ.speed), 90000).catch(e => ({ status: 'error', message: plainErr(e) }));
    if (run !== READ.run) return; if (failed(r)) { toast(r?.message || 'The voice did not answer'); return; }
    READ.tryAudio = new Audio(r.audio); READ.tryAudio.volume = READ_VOL; READ.tryAudio.play().catch(() => {}); status('Playing ' + (voiceList().find(([id]) => id === currentVoice())?.[1] || 'the voice')); return;
  }
  if (!hasSpeech() || !READ.winVoices.length) { toast('No Windows voices were found on this PC'); return; }
  const u = new SpeechSynthesisUtterance(READ_TRY), v = winVoice(); if (v) { u.voice = v; u.lang = v.lang; } u.rate = READ.speed; u.volume = READ_VOL;
  READ.utt = u; speechSynthesis.speak(u); status('Playing ' + (v ? winLabel(v) : 'the Windows voice'));
}

/* ---- The read bar (mockup R20 readBar; Fix B: the progress line along its foot) ---- */
const readBar = () => {
  const list = voiceList(), cur = currentVoice(), play = READ.playing, { pos, total, left } = readTimeline(), pct = total ? Math.min(100, pos / total * 100) : 0;
  return `<div class="card readbar" role="toolbar" aria-label="Read aloud">
  <button class="icon-btn" data-act="read-play" aria-pressed="${play}" aria-label="${play ? 'Pause' : 'Play'}" title="${play ? 'Pause' : 'Play'}">${ic(play ? 'pause' : 'play')}</button>
  <div class="seg" role="group" aria-label="Speed">${READ_SPEEDS.map(v => `<button class="seg-opt" data-act="read-speed" data-v="${v}" aria-pressed="${READ.speed === v}">${v}×</button>`).join('')}</div>
  <select class="field" data-act="read-voice" aria-label="Voice" ${list.length ? '' : 'disabled'}>${list.map(([v, l]) => `<option value="${esc(v)}" ${cur === v ? 'selected' : ''}>${esc(l)}</option>`).join('') || '<option>No voices found</option>'}</select>
  <span class="list-item-sub read-sub" data-read-sub>${readSub()}</span><button class="icon-btn icon-btn--sm" data-act="close" aria-label="Stop reading" title="Stop reading">${ic('x')}</button>
  <div class="read-prog"><span class="read-time" data-read-el>${readClock(pos)}</span><div class="read-track" data-act="read-seek" role="slider" tabindex="0" aria-label="Reading position: click to go to a sentence" title="Go to a sentence" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(pct)}" aria-valuetext="${readClock(pos)} read, ${readClock(left)} left"><div class="read-fill" data-read-fill style="width:${pct.toFixed(2)}%"></div></div><span class="read-time read-time--left" data-read-left>${readClock(left)} left</span></div></div>`;
};
function openRead() {
  const n = note(); S.menu = false;
  if (S.modal === 'read') { closeModal(); return; }
  if (UI.view !== 'notes' || !n) { toast('Open a note first'); renderAll(); return; }
  READ.ix = 0; READ.pos = 0; if (READ.noteId !== n.id) { readEndJob(); READ.noteId = n.id; READ.pieces = null; }   // the bar opens at the top; pause keeps the place, closing doesn't
  S.modal = 'read'; S.focus = { sel: '.readbar [data-act="read-play"]' }; renderAll();
  if (CHECK_READ) return;
  if (READ.engine === 'sherpa') readCtx();   // Fix B: the audio clock is made on this click, as the browser asks
  (READ.engine === 'sherpa' ? loadSherpaStatus(true) : Promise.resolve()).then(() => { if (S.modal === 'read' && !READ.playing) { playReading(); renderAll(); } });
}
// After every render: a closed bar or another note stops the reading; otherwise the highlight is painted again
function readAfterRender() {
  if (S.modal !== 'read') { if (READ.playing || READ.paused || READ.job) stopReading(); return; }
  if (UI.view !== 'notes' || note()?.id !== READ.noteId) { stopReading(); S.modal = null; READ.noteId = null; renderAll(); return; }
  const bar = app.querySelector('.readbar'); if (bar) app.style.setProperty('--readbar-h', bar.offsetHeight + 'px');   // Build C: the note keeps room under its last line for the bar (app.css)
  paintRead();
}

/* ---- Settings → Voice: the read-aloud rows (the voice rambler adds its rows to the same page) ---- */
function readAloudRows() {
  if (!READ.sherpa && !READ.sherpaBusy) loadSherpaStatus(true);
  const sh = READ.sherpa, list = voiceList(), cur = currentVoice();
  const desc = READ.engine === 'windows' ? 'Windows\' own voices, through the app\'s browser engine. Each word is marked exactly as it is spoken.'
    : sh?.available ? 'Kokoro through sherpa-onnx, on this PC. More natural; the whole note is made ahead, and the word being spoken is estimated.'
    : sh ? `${esc(plainMsg(sh.message))}` : 'Looking for Kokoro voices…';
  return `<div class="set-row"><div><div class="set-label" id="ra-eng">Read-aloud engine</div><div class="set-desc" data-read-engine-desc>${desc}</div></div><div class="seg" role="group" aria-labelledby="ra-eng">${READ_ENGINES.map(([k, l]) => `<button class="seg-opt" data-act="read-engine" data-v="${k}" aria-pressed="${READ.engine === k}">${l}</button>`).join('')}</div></div>
    <div class="set-row"><div><div class="set-label" id="ra-voice">Read-aloud voice</div><div class="set-desc">${readEngine() === 'sherpa' ? 'Kokoro' : 'Windows'} · ${list.length} voice${list.length === 1 ? '' : 's'} on this PC</div></div><div class="set-actions"><select class="field" data-act="read-voice" aria-labelledby="ra-voice" ${list.length ? '' : 'disabled'}>${list.map(([v, l]) => `<option value="${esc(v)}" ${cur === v ? 'selected' : ''}>${esc(l)}</option>`).join('') || '<option>No voices found</option>'}</select><button class="btn btn--secondary" data-act="read-try" ${list.length ? '' : 'disabled'}>${ic('volume')}Try it</button></div></div>
    <div class="set-row"><div class="set-label" id="ra-speed">Reading speed</div><div class="seg" role="group" aria-labelledby="ra-speed">${READ_SPEEDS.map(v => `<button class="seg-opt" data-act="read-speed" data-v="${v}" aria-pressed="${READ.speed === v}">${v}×</button>`).join('')}</div></div>`
    + a11yTog('karaoke', 'Highlight as it reads', 'Tints the sentence and underlines the word being spoken');
}

VOICE_PAGE.push(readAloudRows);   // Settings → Voice (render-settings.js): Phase 6B's speech-to-text rows come first, as in the mockup

/* ---- Clicks, keys and changes (actions.js ignores these data-act names) ---- */
document.getElementById('app').addEventListener('click', e => {
  if (e.target.closest('[data-soon]')) return;
  const w = S.modal === 'read' && e.target.closest('.doc .ka-w');   // a click on a word reads on from there
  if (w && readDocEl()?.contains(w)) { readJump(+w.dataset.w); renderAll(); return; }
  const t = e.target.closest('[data-act]'); if (!t) return;
  const v = t.dataset.v;
  switch (t.dataset.act) {
    case 'read': openRead(); break;
    case 'read-play': if (READ.playing) pauseReading(); else playReading(); S.focus = { sel: '.readbar [data-act="read-play"]' }; renderAll(); break;
    case 'read-seek': { const r = t.getBoundingClientRect(); readJump(readSeekShare(Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)))); S.focus = { sel: '.readbar [data-act="read-seek"]' }; renderAll(); break; }   // Fix B
    case 'read-speed': READ.speed = +v; saveSettings({ read_speed: READ.speed }); if (READ.playing || READ.paused) { READ.paused = false; playReading(); }
      status(`Reading speed ${v}×`); S.focus = { sel: `[data-act="read-speed"][data-v="${v}"]` }; renderAll(); break;
    case 'read-engine': READ.engine = v; saveSettings({ read_engine: v }); stopReading(); if (v === 'sherpa') loadSherpaStatus(true);
      status(v === 'sherpa' && READ.sherpa && !READ.sherpa.available ? 'Kokoro chosen: no model yet, so Windows voices read' : 'Read-aloud engine: ' + READ_ENGINES.find(x => x[0] === v)[1]);
      S.focus = { sel: `[data-act="read-engine"][data-v="${v}"]` }; renderAll(); break;
    case 'read-try': tryVoice(); break;
  }
});
// Fix B: the progress line is a slider: ← → go a sentence back or on, Home and End to the first and last
document.getElementById('app').addEventListener('keydown', e => {
  if (!e.target.closest?.('.readbar [data-act="read-seek"]') || e.ctrlKey || e.altKey || e.metaKey) return;
  const starts = readSentStarts(); if (!starts.length) return;
  let k = 0; while (k + 1 < starts.length && starts[k + 1] <= READ.ix) k++;
  const to = { ArrowLeft: k - 1, ArrowDown: k - 1, ArrowRight: k + 1, ArrowUp: k + 1, Home: 0, End: starts.length - 1 }[e.key];
  if (to === undefined) return;
  e.preventDefault(); e.stopPropagation();
  readJump(starts[Math.max(0, Math.min(starts.length - 1, to))]); S.focus = { sel: '.readbar [data-act="read-seek"]' }; renderAll();
});
document.getElementById('app').addEventListener('change', e => {
  const t = e.target; if (t.dataset.act !== 'read-voice') return;
  if (readEngine() === 'sherpa') { READ.voiceSherpa = t.value; saveSettings({ read_voice_sherpa: t.value }); } else { READ.voiceWin = t.value; saveSettings({ read_voice_windows: t.value }); }
  status('Voice: ' + t.selectedOptions[0].text);
  if (READ.playing || READ.paused) { READ.paused = false; playReading(); }
  renderAll();
});
/* ==== Fix A (QC 4 · 47): while the player is open for the note, the status bar's read time is the listening time ====
   From the player's own timeline (readTimeline: each piece's length and the pauses at this speed, Kokoro's real lengths once
   it has made them), so it follows the speed and the real durations; "N min read" (silent reading) again once it closes. */
const readListen = () => S.modal === 'read' && READ.noteId && note()?.id === READ.noteId ? readClock(readTimeline().total) + ' listen' : null;
function paintReadTime() {
  const el = app.querySelector('#read-time-display'), t = readListen(); if (!el || !t || el.textContent === t) return;
  el.textContent = t; el.title = 'How long the read-aloud player takes at this speed';
}
const _paintReadProgressA = paintReadProgress;
paintReadProgress = function () { _paintReadProgressA(); paintReadTime(); };   // eslint-disable-line no-global-assign
const _readAfterRenderA = readAfterRender;
readAfterRender = function () { _readAfterRenderA(); paintReadTime(); };   // eslint-disable-line no-global-assign
document.addEventListener('input', () => paintReadTime());   // after the word count's own update (actions.js paintTelemetry)
// A speed change while nothing plays: the lengths Kokoro made at the old speed are scaled to the new one (playing makes them again)
document.addEventListener('click', e => {
  if (!e.target.closest?.('[data-act="read-speed"]')) return; const was = READ.speed;
  setTimeout(() => { if (READ.speed === was || READ.playing || !READ.durs?.length) return; READ.durs = READ.durs.map(d => d * was / READ.speed); paintReadProgress(); paintReadTime(); }, 0);
}, true);
/* ==== end Fix A ==== */
/* ===================================================================== end PHASE 6C · READ ALOUD */
