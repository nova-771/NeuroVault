/* PHASE 6B · VOICE RAMBLER: record → offline transcript (sherpa-onnx Whisper, api.py voice_*) → the check dialog:
   the raw transcript beside the cleaned note and its tasks, every anchor (numbers, money, dates, times, deadlines, names)
   marked green when it's in both, amber with "+ Insert" when the cleaned note lost it. Enter adds it all to the open note
   (or a new note); ticked tasks become "- [ ]" lines, which the note's save turns into tasks on the Tasks board.
   Extracted from design/vault-notes-mockups.html (R20): voiceModal, the voicerec and voice states, .voice* and .anchor.
   With no backend (a browser, ?check=1) the dialog runs on a sample recording, so its layout can still be checked. */
'use strict';
Object.assign(S, { voice: { stage: 'idle', status: null, loading: false, seconds: 0, bars: [], done: 0, total: 0, result: null, message: '', added: new Set(), skip: new Set(), dl: null } });
const VOICE_POLL_MS = 150;
const VOICE_KINDS = { Money: 'Money', Number: 'Number', Date: 'Date', Time: 'Time', 'Date and time': 'Date and time', Deadline: 'Deadline', Name: 'Name' };
// The sample the dialog shows without the app: voice.tidy() on the mockup's ramble, with "£450" dropped from the cleaned note
const VOICE_DEMO = { raw: [['Okay so, um, for the ', null], ['Q3', 'a1'], [' roadmap I need to email ', null], ['Maya', 'a2'], [' by ', null], ['Friday', 'a3'], [' about the ', null], ['£450', 'a4'], [' for the accessibility audit. And the design sync moved to ', null], ['Tuesday at 3pm', 'a5'], ['. Oh, and remind me to book the user-testing room for the ', null], ['21st', 'a6'], [', and ask ', null], ['Sam', 'a7'], [' if the ', null], ['PKCE', 'a8'], [' fix shipped.', null]],
  paras: [[['The design sync moved to ', null], ['Tuesday at 3pm', 'a5'], ['.', null]]],
  tasks: [[['Email ', null], ['Maya', 'a2'], [' by ', null], ['Friday', 'a3'], [' about the accessibility audit budget (for the ', null], ['Q3', 'a1'], [' roadmap)', null]], [['Book the user-testing room for the ', null], ['21st', 'a6']], [['Ask ', null], ['Sam', 'a7'], [' if the ', null], ['PKCE', 'a8'], [' fix shipped', null]]],
  anchors: { a1: { text: 'Q3', kind: 'Date', found: true }, a2: { text: 'Maya', kind: 'Name', found: true }, a3: { text: 'Friday', kind: 'Deadline', found: true }, a4: { text: '£450', kind: 'Money', found: false, item: ['t', 0] },
    a5: { text: 'Tuesday at 3pm', kind: 'Date and time', found: true }, a6: { text: '21st', kind: 'Date', found: true }, a7: { text: 'Sam', kind: 'Name', found: true }, a8: { text: 'PKCE', kind: 'Name', found: true } }, demo: true };

const voiceOpen = () => S.modal === 'voicerec' || S.modal === 'voice';
const mmss = s => `${Math.floor(s / 60)}:${two(Math.floor(s % 60))}`;
const voiceModelName = () => S.voice.status?.model?.name || 'base.en';
// The note the voice note goes into: the one open in the current tab, if the Notes view shows one
function voiceTarget() { const at = S.tabs.find(t => t.id === S.activeTab); return UI.view === 'notes' && at?.kind === 'note' && !S.offTab ? D.notes.find(n => n.id === S.noteId) || null : null; }

/* ---- Talking to api.py ---- */
async function refreshVoiceStatus() {
  if (!api() || S.voice.loading) return S.voice.status;
  S.voice.loading = true; const r = await nv('voice_status'); S.voice.loading = false;
  S.voice.status = failed(r) ? { error: r?.message || 'The voice engine didn\'t answer.' } : r;
  return S.voice.status;
}
function voiceStopPolling() { clearInterval(S.voice.timer); S.voice.timer = null; }
function voicePollEvery(fn) { voiceStopPolling(); let busy = false; S.voice.timer = setInterval(async () => { if (busy) return; busy = true; try { await fn(); } finally { busy = false; } }, VOICE_POLL_MS); }
async function openVoice() {
  if (voiceOpen()) { closeModal(); return; }
  Object.assign(S.voice, { stage: 'starting', demo: false, seconds: 0, bars: [], result: null, message: '', added: new Set(), skip: new Set() });
  S.menu = false; S.modal = 'voicerec'; renderAll();
  if (!api()) { voiceDemoRecording(); return; }
  const st = await refreshVoiceStatus(); if (!voiceOpen()) return;
  if (st?.error) { voiceError(st.error); return; }
  if (!st.model.present) { S.voice.stage = st.download?.stage === 'downloading' ? 'downloading' : 'nomodel'; if (S.voice.stage === 'downloading') voiceWatchDownload(); renderAll(); return; }
  voiceRecord();
}
async function voiceRecord() {
  S.voice.stage = 'starting'; renderAll();
  const r = await nv('voice_start'); if (!voiceOpen()) { nv('voice_discard'); return; }
  if (failed(r)) { voiceError(r.message); return; }
  S.voice.stage = 'recording'; S.focus = { sel: '#voice-stop' }; renderAll();
  voicePollEvery(voiceTick);
}
async function voiceTick() {
  const r = await nv('voice_poll'); if (!voiceOpen() || failed(r)) return;
  if (r.stage === 'recording') { S.voice.seconds = r.seconds; S.voice.bars = r.bars; paintVoiceLevel(); if (r.full) voiceStop(); return; }
  if (r.stage === 'transcribing') { if (S.voice.stage !== 'transcribing') { S.voice.stage = 'transcribing'; renderAll(); } S.voice.done = r.done; S.voice.total = r.total; paintVoiceProgress(); return; }
  if (r.stage === 'done') { voiceStopPolling(); voiceCheck(r.result); return; }
  if (r.stage === 'error') { voiceStopPolling(); voiceError(r.message); }
}
async function voiceStop() {
  if (!api()) { voiceStopPolling(); voiceCheck(VOICE_DEMO); return; }
  if (S.voice.stage !== 'recording') return;
  S.voice.stage = 'transcribing'; S.voice.done = 0; S.voice.total = 0; renderAll();
  const r = await nv('voice_stop'); if (failed(r)) { voiceStopPolling(); voiceError(r.message); }
}
function voiceCheck(result) {
  S.voice.result = JSON.parse(JSON.stringify(result)); S.voice.added = new Set(); S.voice.skip = new Set(); S.voice.stage = 'check';
  S.modal = 'voice'; S.focus = { sel: '#voice-accept' }; renderAll();
}
function voiceError(message) { voiceStopPolling(); S.voice.stage = 'error'; S.voice.message = message ? plainMsg(message) : 'Something went wrong.'; if (voiceOpen()) { S.modal = 'voicerec'; renderAll(); } }
// Called by closeModal (render-widgets.js) when the voice dialog closes: the recording is thrown away
function voiceClosed() { voiceStopPolling(); if (api() && ['starting', 'recording', 'transcribing', 'check', 'error'].includes(S.voice.stage)) nv('voice_discard'); S.voice.stage = 'idle'; }
// Without the app: a pretend recording (the wave moves by itself, the clock runs), then the sample check
function voiceDemoRecording() {
  S.voice.stage = 'recording'; S.voice.demo = true; S.focus = { sel: '#voice-stop' }; renderAll();
  if (CHECK) return; const t0 = Date.now();
  voicePollEvery(() => { S.voice.seconds = (Date.now() - t0) / 1000; const el = app.querySelector('[data-voice-clock]'); if (el) el.textContent = mmss(S.voice.seconds); });
}
/* ---- The model download (asked for with the button; nothing downloads by itself) ---- */
async function voiceDownload(name) {
  const r = await nv('voice_download_model', name || voiceModelName()); if (failed(r)) { toast(r.message); return; }
  S.voice.dl = { stage: 'downloading', name: name || voiceModelName(), done: 0, total: 1 }; if (S.voice.status) S.voice.status.download = S.voice.dl;
  if (voiceOpen()) S.voice.stage = 'downloading'; renderAll(); voiceWatchDownload();
}
function voiceWatchDownload() {
  clearInterval(voiceWatchDownload.t);
  voiceWatchDownload.t = setInterval(async () => {
    const st = await refreshVoiceStatus(); if (!st || st.error) return; const dl = S.voice.dl = st.download;
    if (dl.stage === 'downloading') { if (!app.querySelector('[data-voice-dl]') && (voiceOpen() || (S.modal === 'settings' && S.setSec === 'voice'))) renderAll(); else paintVoiceDownload(); return; }
    clearInterval(voiceWatchDownload.t);
    if (dl.stage === 'done') { toast(dl.message); if (voiceOpen()) S.voice.stage = st.model.present ? 'ready' : 'nomodel'; }
    else if (dl.stage === 'error') { if (voiceOpen()) voiceError(dl.message); else toast(dl.message); }
    renderAll();
  }, 400);
}
const dlText = dl => `${Math.round((dl?.done || 0) / 1e6)} of ${Math.round((dl?.total || 1) / 1e6)} MB`;
const dlPct = dl => Math.min(100, (dl?.done || 0) / (dl?.total || 1) * 100).toFixed(1);
function paintVoiceDownload() { app.querySelectorAll('[data-voice-dl]').forEach(el => { el.querySelector('.progress > span').style.width = dlPct(S.voice.dl) + '%'; el.querySelector('.num').textContent = dlText(S.voice.dl); }); }
/* ---- Painted in place while recording, so the dialog isn't rebuilt 7 times a second ---- */
const barH = v => Math.round(6 + Math.max(0, Math.min(1, v)) * 34);
function paintVoiceLevel() {
  const clock = app.querySelector('[data-voice-clock]'); if (clock) clock.textContent = mmss(S.voice.seconds);
  app.querySelectorAll('.wave.is-live span').forEach((s, i) => { s.style.height = barH(S.voice.bars[i] || 0) + 'px'; });
}
function paintVoiceProgress() { const el = app.querySelector('[data-voice-progress]'); if (el) el.textContent = S.voice.total > 1 ? `Part ${Math.min(S.voice.done + 1, S.voice.total)} of ${S.voice.total}` : 'One moment'; }

/* ---- The two dialogs ---- */
function voiceRecBody() {
  const v = S.voice, st = v.status, m = st?.model, spin = text => `<div class="rec"><span class="spinner" aria-hidden="true"></span><p class="view-sub" role="status">${text}</p></div>`;
  if (v.stage === 'starting') return spin('Opening the microphone…');
  if (v.stage === 'transcribing') return `<div class="rec"><span class="spinner" aria-hidden="true"></span><span class="kpi-value num">${mmss(v.seconds)}</span><p class="view-sub" role="status">Turning what you said into text, on this PC. <span data-voice-progress>${v.total > 1 ? `Part ${Math.min(v.done + 1, v.total)} of ${v.total}` : 'One moment'}</span></p></div>`;
  if (v.stage === 'error') return `<div class="alert alert--danger" role="alert">${ic('alert')}<span>${esc(plainMsg(v.message))}</span></div>`;
  if (v.stage === 'nomodel' || v.stage === 'downloading' || v.stage === 'ready') {
    if (v.stage === 'ready') return `<div class="alert alert--success" role="status">${ic('ok')}<span>Whisper ${esc(m?.name || '')} is installed. Recording and transcribing now stay on this PC.</span></div>`;
    return `<div class="alert alert--warning" role="status">${ic('alert')}<span>Speech to text needs the Whisper ${esc(m.name)} model, and it isn't on this PC yet.</span></div>
      <p class="view-sub">It's a one-time download of ${m.size_mb} MB: sherpa-onnx's int8 build of OpenAI Whisper, from Hugging Face (<span class="code voice-path">${esc(m.source.replace(/^https:\/\//, ''))}</span>). It's saved in <span class="code voice-path">${esc(m.folder)}</span>. After that, nothing you say leaves this PC. A different model can be chosen in Settings → Voice.</p>
      ${v.stage === 'downloading' ? voiceDlBar() : ''}`;
  }
  const live = !v.demo;
  return `<div class="rec"><button class="rec-mic" data-act="voice-stop" aria-label="Stop and check">${ic('mic')}</button>
    <div class="wave${live ? ' is-live' : ''}" aria-hidden="true">${Array.from({ length: 24 }, (_, i) => `<span${live ? ` style="height:${barH(v.bars[i] || 0)}px"` : ''}></span>`).join('')}</div>
    <span class="kpi-value num" role="timer" aria-live="off" data-voice-clock>${mmss(v.seconds)}</span>
    <p class="view-sub">Say it however it comes out. You'll check the clean version before anything is saved.${v.demo ? ' <b>Sample:</b> without the app there is no microphone, so Stop shows a sample.' : ''}</p></div>`;
}
const voiceDlBar = () => `<div class="voice-dl" data-voice-dl><div class="progress" role="progressbar" aria-label="Download" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(dlPct(S.voice.dl))}"><span style="width:${dlPct(S.voice.dl)}%"></span></div><span class="num list-item-sub">${dlText(S.voice.dl)}</span></div>`;
function voiceRecFoot() {   // Build L: the buttons by their place in the row (dlg): Cancel, the others, the main button last
  const st = S.voice.stage, m = S.voice.status?.model;
  const cancel = `<button class="btn btn--secondary" data-act="close">${st === 'recording' || st === 'transcribing' ? 'Discard' : 'Close'}</button>`;
  if (st === 'recording') return { cancel, main: `<button class="btn btn--primary" id="voice-stop" data-act="voice-stop">${ic('stop')}Stop and check</button>` };
  if (st === 'nomodel') return { cancel, main: `<button class="btn btn--primary" id="voice-download" data-act="voice-download">${ic('download')}Download (${m?.size_mb} MB)</button>` };
  if (st === 'downloading') return { cancel, others: ['<button class="btn btn--secondary" data-act="voice-dl-cancel">Cancel download</button>'] };
  if (st === 'ready' || (st === 'error' && api() && S.voice.status?.model?.present)) return { cancel, main: `<button class="btn btn--primary" id="voice-record" data-act="voice-record">${ic('mic')}${st === 'error' ? 'Try again' : 'Start recording'}</button>` };
  return { cancel };
}
const anchorPill = (id, a, missing) => `<span class="anchor${missing ? ' is-missing' : ''}" data-anchor="${id}" tabindex="0" title="${esc(VOICE_KINDS[a.kind] || a.kind)}${missing ? ' · missing from the cleaned note' : ' · found in both'}">${esc(a.text)}${missing ? `<button class="anchor-insert" data-act="voice-insert" data-v="${id}" aria-label="Insert ${esc(a.text)} into the cleaned note">+ Insert</button>` : ''}</span>`;
const voiceMissing = id => { const a = S.voice.result.anchors[id]; return !a.found && !S.voice.added.has(id); };
const segHtml = segs => segs.map(([t, id]) => id && S.voice.result.anchors[id] ? anchorPill(id, S.voice.result.anchors[id], false) : esc(t)).join('');
const voiceTitle = () => `Voice note · ${two(new Date().getHours())}:${two(new Date().getMinutes())}`;
function voiceModal() {
  const sub = S.voice.demo || !api() ? 'Sample · the app records and transcribes on this PC' : `Whisper ${esc(voiceModelName())} on this PC · nothing leaves it`;
  if (S.modal === 'voicerec') return dlg({ id: 'voicerec', size: 'md', keep: true, title: 'Voice ramble', titleId: 'vr-t', sub, xLabel: 'Discard and close', body: voiceRecBody(), ...voiceRecFoot() });   // Build L: R41's anatomy
  const R = S.voice.result, raw = R.raw.map(([t, id]) => id ? anchorPill(id, R.anchors[id], voiceMissing(id)) : esc(t)).join('');
  const missing = Object.keys(R.anchors).filter(voiceMissing).length, target = voiceTarget();
  const tasks = R.tasks.map((segs, i) => `<label class="task"><input type="checkbox" data-act="voice-task" data-v="${i}" ${S.voice.skip.has(i) ? '' : 'checked'}><span>${segHtml(segs)}</span></label>`).join('');
  return dlg({ id: 'voice', size: 'wide', keep: true, title: 'Check your voice note', titleId: 'vc-t', xLabel: 'Discard and close',   // Build L: R41's anatomy, wide ("Enter accepts" is the main button's tooltip)
    sub: `${R.cleaned_by ? `Cleaned up by ${esc(R.cleaned_by)} on this PC, with the rules' anchor check` : 'Cleaned up by rules on this PC: filler words out, sentences and capitals, "I need to…" lines as tasks'}`,
    body: `<div class="legend">${cvLegend()}<span>Hover a highlight to find its twin.</span></div>
      ${missing ? `<div class="alert alert--warning" role="status">${ic('alert')}<span>${missing} detail${missing === 1 ? '' : 's'} from your recording ${missing === 1 ? 'is' : 'are'} missing from the cleaned note. Insert ${missing === 1 ? 'it' : 'them'}, or accept without ${missing === 1 ? 'it' : 'them'}.</span></div>` : ''}
      <div class="voice-grid"><div class="card voice-pane"><div class="eyebrow">What you said · raw transcript</div><div class="voice-text">${raw}</div></div>
        <div class="card voice-pane voice-out is-chosen"><div class="eyebrow">Cleaned note and tasks · will be added</div><h3>${esc(voiceTitle())}</h3>${R.paras.map(p => `<p>${segHtml(p)}</p>`).join('') || (R.tasks.length ? '' : '<p class="list-item-sub">Nothing left after the clean-up.</p>')}
          ${R.tasks.length ? `<div class="eyebrow">Tasks · ticked ones go to Tasks</div><div class="win-list">${tasks}</div>` : ''}</div></div>`,
    cancel: '<button class="btn btn--secondary" data-act="close">Discard</button>',
    others: [target ? `<button class="btn btn--secondary" data-act="voice-accept" data-v="new">${ic('plus')}New note</button>` : ''],
    main: `<button class="btn btn--primary" id="voice-accept" data-act="voice-accept" data-v="${target ? 'note' : 'new'}" title="Enter">${ic('ok')}${target ? `Add to "${esc(target.title || 'Untitled')}"` : 'Save as a new note'}</button>` });
}

/* ---- + Insert: the missing detail goes into the cleaned item it came from (in brackets), or a paragraph of its own ---- */
function voiceInsert(id) {
  const R = S.voice.result, a = R.anchors[id]; if (!a) return;
  const list = a.item?.[0] === 'p' ? R.paras : a.item?.[0] === 't' ? R.tasks : null, segs = list?.[a.item[1]];
  if (segs) { const last = segs[segs.length - 1], end = last && !last[1] && /[.!?]$/.test(last[0]) ? last[0].slice(-1) : '';
    if (end) last[0] = last[0].slice(0, -1);
    segs.push([' (', null], [a.text, id], [')' + end, null]); }
  else R.paras.push([[a.text, id], ['.', null]]);
  S.voice.added.add(id); status(`Inserted ${a.text} into the cleaned note`); S.focus = { sel: '#voice-accept' }; renderAll();
}
/* ---- Accept: Markdown through NVMarkdown (so it escapes as the editor would), ticked tasks as "- [ ]" lines ---- */
const mdText = t => NVMarkdown.htmlToMd(`<p>${esc(t)}</p>`).trim();
function voiceMarkdown() {
  const R = S.voice.result, text = segs => segs.map(s => s[0]).join('').trim();
  const paras = R.paras.map(p => mdText(text(p))), tasks = R.tasks.map((t, i) => ({ title: text(t), on: !S.voice.skip.has(i) }));
  const md = [...paras, tasks.map(t => (t.on ? '- [ ] ' : '- ') + mdText(t.title)).join('\n')].filter(Boolean).join('\n\n');
  return { md, tasks: tasks.filter(t => t.on).map(t => unescMd(mdText(t.title))) };
}
async function voiceAccept(where) {
  const { md, tasks } = voiceMarkdown(); if (!md) { toast('Nothing to add'); return; }
  const target = where === 'note' ? voiceTarget() : null;
  const n = target || await voiceNewNote(md); if (!n) return;
  if (target) { syncDoc(n); n.md = n.md.replace(/\s+$/, '') + (n.md.trim() ? '\n\n' : '') + `## ${voiceTitle()}\n\n${md}`; n.html = null; n.dirty = true; }
  if (VAULT.live) { if (target) await saveNote(n); else syncLineTasks(n); }   // a saved note's "- [ ]" lines become tasks
  else { tasks.forEach((title, i) => D.tasks.unshift({ id: 't-v' + Date.now() + i, noteId: n.id, title, priority: 'Medium', due: 'Upcoming', done: false, energy: 'medium' })); n.lineBase = mdTaskLines(n.md).map(l => l.title); }
  S.voice.stage = 'idle'; closeModal(true);
  const msg = `${target ? `Added to "${n.title}"` : `Saved "${n.title}"`}${tasks.length ? ` with ${tasks.length} task${tasks.length === 1 ? '' : 's'}` : ''}`;
  status(msg); if (target) { S.noteId = n.id; renderAll(); } else openNote(n.id, true, true);
  toast(msg);
}
async function voiceNewNote(md) {
  const folder = targetFolder(); if (!folder) { toast('Create a project folder first: notes live inside one'); return null; }
  const d = new Date(), title = uniqueName(`Voice note · ${d.getDate()} ${d.toLocaleString('en-GB', { month: 'short' })} ${two(d.getHours())}.${two(d.getMinutes())}`, folder, 'note');
  let id = 'note-' + Date.now(), home = folder, mtime = iso(d), ctime = mtime;
  if (VAULT.live) {
    const [f, p] = placeArgs(folder), r = await nv('save_note', null, title, md, rootProject(folder)?.name || '', p, '', f);
    if (failed(r)) { toast(r.message || "Couldn't save the note."); return null; }
    id = 'n-' + r.id; home = homeOf(r) || folder; mtime = ctime = r.updated_at;
  }
  const n = { id, title, category: '', oldCategory: '', folder: home, tags: [], md, mtime, ctime, lineBase: [] };
  D.notes.unshift(n); ancestors(home).forEach(x => S.open.add(x)); UI.view = 'notes';
  return n;
}

/* ---- Settings → Voice: the speech-to-text rows (read aloud adds its own rows to VOICE_PAGE, render-settings.js) ---- */
function sttRows() {
  const st = S.voice.status; if (!st && api() && !S.voice.loading) refreshVoiceStatus()   // RAM: while it loads, a re-render asking again looped renderAll forever.then(() => { if (S.modal === 'settings' && S.setSec === 'voice') renderAll(); });
  // v0.1.1: draws in every state (no status yet, an error, a status without a model or models, a download for another model)
  const models = Array.isArray(st?.models) && st.models.length ? st.models : [{ name: 'base.en', size_mb: 161, note: 'fast' }, { name: 'small.en', size_mb: 375, note: 'more accurate' }], m = st?.model || null, cur = m?.name || 'base.en', dl = st?.download || null;
  const sel = `<select class="field" data-act="voice-model" id="voice-model" aria-labelledby="stt-l">${models.map(x => `<option value="${esc(x.name)}" ${x.name === cur ? 'selected' : ''}>${esc([x.name, x.size_mb ? x.size_mb + ' MB' : '', x.note].filter(Boolean).join(' · '))}${x.present ? ' · installed' : ''}</option>`).join('')}</select>`;
  const where = !api() ? 'The app keeps speech models in its models folder.' : !st ? 'Checking…' : st.error ? esc(plainMsg(st.error))
    : !m ? 'No speech model is set up yet. Pick one above to download it.'
    : m.present ? `Installed in <span class="code">${esc(m.folder || 'the models folder')}</span>` : dl?.stage === 'downloading' && dl.name === m.name ? 'Downloading…' : `Not on this PC yet${m.size_mb ? ` · ${m.size_mb} MB` : ''} from Hugging Face, once`;
  const act = !api() || !m || m.present ? '' : dl?.stage === 'downloading' ? `<button class="btn btn--secondary" data-act="voice-dl-cancel">Cancel</button>` : `<button class="btn btn--secondary" data-act="voice-download" data-v="${esc(m.name)}">${ic('download')}Download</button>`;
  const mics = Array.isArray(st?.mics) ? st.mics : [], mic = st?.mic || '';
  return `<div class="set-row"><div><div class="set-label" id="stt-l">Speech to text</div><div class="set-desc">Whisper through sherpa-onnx, on this PC</div></div>${sel}</div>
    <div class="set-row"><div><div class="set-label">Model file</div><div class="set-desc">${where}</div>${dl?.stage === 'downloading' && dl.name === m?.name ? voiceDlBar() : ''}</div>${act}</div>
    <div class="set-row"><div><div class="set-label" id="mic-l">Microphone</div><div class="set-desc">${st?.test_wav ? 'Dev: a test .wav plays instead of the microphone' : st?.mic_error ? esc(st.mic_error) : 'Used by the voice ramble'}</div></div><select class="field" data-act="voice-mic" aria-labelledby="mic-l" ${api() ? '' : 'disabled'}><option value="">Windows default</option>${mics.map(x => `<option value="${esc(x)}" ${x === mic ? 'selected' : ''}>${esc(x)}</option>`).join('')}${mic && !mics.includes(mic) ? `<option value="${esc(mic)}" selected>${esc(mic)} (not connected)</option>` : ''}</select></div>`;
}
VOICE_PAGE.push(sttRows);

/* ---- Events (actions.js's switch doesn't know these acts) ---- */
document.getElementById('app').addEventListener('click', e => {
  const t = e.target.closest('[data-act]'); if (!t || e.target.closest('[data-soon]')) return;
  const v = t.dataset.v;
  switch (t.dataset.act) {
    case 'voice': openVoice(); break;
    case 'voice-stop': voiceStop(); break;
    case 'voice-record': voiceRecord(); break;
    case 'voice-download': voiceDownload(v); break;
    case 'voice-dl-cancel': nv('voice_cancel_download'); break;
    case 'voice-insert': voiceInsert(v); break;
    case 'voice-accept': voiceAccept(v); break;
  }
});
document.getElementById('app').addEventListener('change', e => {
  const t = e.target, act = t.dataset.act;
  if (act === 'voice-task') { if (t.checked) S.voice.skip.delete(+t.dataset.v); else S.voice.skip.add(+t.dataset.v); }
  if (act === 'voice-model' || act === 'voice-mic') { saveSettings({ [act === 'voice-model' ? 'voice_stt_model' : 'voice_mic']: t.value }); status('Setting saved');
    S.voice.status = null; S.focus = { sel: act === 'voice-model' ? '#voice-model' : '[data-act="voice-mic"]' }; renderAll(); }
});
document.getElementById('app').addEventListener('keydown', e => {
  if (S.modal === 'voice' && e.key === 'Enter' && !e.target.closest('button, input, textarea, select, a')) { e.preventDefault(); voiceAccept(voiceTarget() ? 'note' : 'new'); }
});
// Hover or focus an anchor: it and its twin pulse
function pulseAnchor(e) { const a = e.target.closest?.('[data-anchor]'); const box = document.getElementById('app');
  box.querySelectorAll('.anchor.is-pulse').forEach(x => x.classList.remove('is-pulse'));
  if (a) box.querySelectorAll(`[data-anchor="${a.dataset.anchor}"]`).forEach(x => x.classList.add('is-pulse')); }
document.getElementById('app').addEventListener('mouseover', pulseAnchor);
document.getElementById('app').addEventListener('focusin', pulseAnchor);
// The ?check=1 sweep: the dialog in a given state, on the sample
function voiceDemo(stage) { Object.assign(S.voice, { stage, demo: true, seconds: 42, bars: [], result: stage === 'check' ? JSON.parse(JSON.stringify(VOICE_DEMO)) : null, added: new Set(), skip: new Set() }); return stage === 'check' ? 'voice' : 'voicerec'; }
/* ---- end Phase 6B ---- */
