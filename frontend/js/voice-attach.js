/* BUILD A · VOICE RAMBLE V2 AND ATTACHMENTS. Extracted from design/vault-notes-mockups.html R21–R28 (every switch locked):
   - the recording pill (vPill: live words, or the compact look when live words is off), with no backdrop;
   - the one question after Stop (vAsk): Keep (audio + text / text / audio), Save to (brain dump / this note / new note),
     "Always do this"; "Check the text first" opens Phase 6B's check dialog (with the clip on top and "Keep this text");
   - Settings → Voice: live words and "After a voice ramble" (liveRow, voiceDefaultsRows); with Ask off, Stop saves at once;
   - the one-line clip player (clipHtml, look "line") for ![[attachments/…]] in notes and for voice thoughts in the brain
     dump, with Transcribe for a clip that has no text;
   - the Attachments tab, fourth in the right sidebar (attPanel, attRow, attRemoveModal; this note only, tab4 "fit");
   - Settings → Vault & files: the tab with no note open (a message or hidden), and moving unused files to the recycle bin.
   It sits on Phase 6B (render-voice.js): recording, polling, the check dialog and its helpers are reused, and the few
   functions whose behaviour changes are wrapped here. Without the app (a browser, ?check=1) it runs on sample clips. */
'use strict';
Object.assign(ICON, {
  clip: '<path d="M13.234 20.252 21 12.3"/><path d="m16 6-8.414 8.586a2 2 0 0 0 0 2.828 2 2 0 0 0 2.828 0l8.414-8.586a4 4 0 0 0 0-5.656 4 4 0 0 0-5.656 0l-8.415 8.585a6 6 0 1 0 8.486 8.486"/>',
  fileaudio: '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4M8 14v3M11 12v7M14 13v5M17 15v1"/>',
  folderopen: '<path d="m6 14 1.45-2.9A2 2 0 0 1 9.24 10H20a2 2 0 0 1 1.94 2.5l-1.55 6a2 2 0 0 1-1.94 1.5H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.93a2 2 0 0 1 1.66.9l.82 1.2a2 2 0 0 0 1.66.9H18a2 2 0 0 1 2 2v2"/>',
  external: '<path d="M15 3h6v6M10 14 21 3M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>' });

/* ---- State and settings (config.json: voice_after_keep / _dest / _ask, voice_live, attachments_empty_tab) ---- */
Object.assign(S.voice, { paused: false, words: null, keep: 'both', dest: 'dump', remember: false, text: 'clean', take: null, startedAt: null, fromAtt: null, fromWhere: null, pending: false, txErr: '', forceDest: null });
Object.assign(S, { clips: {}, attOpen: null, attDel: null, attUnused: null, flashInbox: null });
const VA = { cfg: { keep: 'both', dest: 'dump', ask: true, live: 'auto', empty: 'message' }, loaded: false };
const VA_CFG = { keep: ['voice_after_keep', ['both', 'text', 'audio']], dest: ['voice_after_dest', ['dump', 'note', 'new']], ask: ['voice_after_ask', [true, false]],
  live: ['voice_live', ['auto', 'on', 'off']], empty: ['attachments_empty_tab', ['message', 'hide']] };
const _readerFromConfigA = readerFromConfig;
readerFromConfig = function (c) { _readerFromConfigA(c); Object.entries(VA_CFG).forEach(([k, [key, ok]]) => { if (ok.includes(c[key])) VA.cfg[k] = c[key]; }); };
const vdef = () => VA.cfg;
function setVdef(k, v) { VA.cfg[k] = v; saveSettings({ [VA_CFG[k][0]]: v }); }
// R28: live words is on with 5 GB or more free on the data drive, unless you chose; it also needs its model on this PC
// The app with its real vault (a sample vault, as in the ?check=1 sweep through the dev bridge, never reads or writes files)
const realData = () => !!api() && VAULT.live;
const liveSt = () => S.voice.status?.live;
function vLive() { const p = VA.cfg.live; if (p !== 'auto') return p === 'on'; const f = liveSt()?.free_gb; return f == null || f >= 5; }
const liveReady = () => !realData() || !!liveSt()?.present;
const LIVE_MB = () => liveSt()?.size_mb || 44;
const clipExt = () => S.voice.status?.clip_ext || '.ogg';

/* ---- Attachments: the backend's list (live), or sample files (no app) in D.atts ---- */
const ATT_ICON = { audio: 'fileaudio', image: 'image', pdf: 'filepdf', other: 'file' };
const ATT_KIND = { audio: 'Audio', image: 'Images', pdf: 'PDFs', other: 'Other files' };
const attKind = f => /\.(ogg|opus|oga|wav|mp3|m4a|webm|flac|aac)$/i.test(f) ? 'audio' : /\.(png|jpe?g|gif|webp|bmp|svg|avif)$/i.test(f) ? 'image' : /\.pdf$/i.test(f) ? 'pdf' : 'other';
const attBase = f => f.split('/').pop();
const attByFile = f => (D.atts || []).find(a => a.file === f);
const fmtT = x => `${Math.floor((x || 0) / 60)}:${two(Math.floor((x || 0) % 60))}`;
const fmtSize = b => b >= 1e6 ? (b / 1e6).toFixed(1) + ' MB' : Math.max(1, Math.round(b / 1e3)) + ' KB';
const attDate = a => { const d = new Date(a.mtime); return isNaN(d) ? '' : `${d.getDate()} ${d.toLocaleString('en-GB', { month: 'short' })}`; };
const nameHtml = n => n.length <= 14 ? esc(n) : `<span class="truncate">${esc(n.slice(0, -11))}</span><span class="att-tail">${esc(n.slice(-11))}</span>`;   // the start is cut, the end (time and type) always shows
const SAMPLE_ATTS = [
  { file: 'attachments/voice-20261014-125412.ogg', kind: 'audio', size: 168000, mtime: '2026-10-14T12:54:12', seconds: 42 },
  { file: 'attachments/voice-20261014-090311.ogg', kind: 'audio', size: 302000, mtime: '2026-10-14T09:03:11', seconds: 75 },
  { file: 'attachments/voice-20261014-123105.ogg', kind: 'audio', size: 71000, mtime: '2026-10-14T12:31:05', seconds: 18 },
  { file: 'attachments/paste-20261014-101233.png', kind: 'image', size: 412000, mtime: '2026-10-14T10:12:33' },
  { file: 'attachments/audit-quote.pdf', kind: 'pdf', size: 1230000, mtime: '2026-10-13T16:00:00' }];
// The sample vaults (no app): Q3 Roadmap Draft has a clip with its text and one without; the inbox has a voice thought
const _sampleA = sample;
sample = function (kind) { const d = _sampleA(kind); addSampleAtts(d, kind); return d; };
function addSampleAtts(d, kind) {
  if (kind === 'empty' || !d.notes.length) { d.atts = []; return d; }
  d.atts = SAMPLE_ATTS.map(a => ({ ...a, name: attBase(a.file) }));
  const n = d.notes[0];
  n.md = n.md.replace(/\s*$/, '') + `\n\n## Voice note · 12:54\n\n![[${SAMPLE_ATTS[0].file}]]\n\nThe design sync moved to Tuesday at 3pm.\n\n## Call with Maya · 09:03\n\n![[${SAMPLE_ATTS[1].file}]]\n\n![[${SAMPLE_ATTS[4].file}]]\n`;
  d.tasks.push({ id: 't-vs1', noteId: null, title: 'Sketch the tray menu', priority: 'Medium', due: 'Upcoming', done: false, energy: 'medium', project: null });   // Build A+: a voice thought's task is on the board
  d.inbox = d.inbox || []; d.inbox.splice(1, 0, { id: 'in-v1', t: '12:31', text: 'Launchpad idea: a one-tap timer from the tray.', audio: SAMPLE_ATTS[2].file, tasks: [], taskIds: ['t-vs1'] });
  return d;
}
addSampleAtts(D, 'typical');
async function refreshAtts() {
  if (!realData()) return;
  const r = await nv('list_attachments'); if (failed(r)) return;
  D.atts = r.files; VA.folder = r.folder; S.attUnused = null; D.attFrom = r.note_sources || {};   // Build M · QC 68: where each copy came from
}
// Loaded with stickies and the inbox (capture.js), so the first render already knows each clip's length
const _loadCaptureA = loadCapture;
loadCapture = async function () { const ok = await _loadCaptureA(); if (api()) { D.atts = []; await refreshAtts(); } return ok; };
// Where a file is used: the notes that embed it and the inbox thoughts that carry it
function attUses(file) {
  const line = `![[${file}]]`, u = D.notes.filter(n => (n.md || '').includes(line)).map(n => ({ kind: 'note', id: n.id, label: n.title || 'Untitled' }));
  (D.inbox || []).forEach(x => { if (x.audio === file) u.push({ kind: 'inbox', id: x.id, label: 'Brain Dump' }); });
  return u;
}
const noteEmbeds = n => [...new Set([...(n?.md || '').matchAll(/!\[\[(attachments\/[^\[\]\n|#]+?)(?:[|#][^\[\]\n]*)?\]\]/g)].map(m => m[1]))];
// A clip "has text" when the next line with something on it, under its embed, is text or tasks (not a heading or another embed)
function embedHasText(n, file) {
  const ls = (n?.md || '').split('\n'), i = ls.findIndex(l => l.trim() === `![[${file}]]`); if (i < 0) return true;
  const next = ls.slice(i + 1).find(l => l.trim()); return !!next && !/^\s*(#|!\[\[)/.test(next);
}

/* ---- The clip player: one <audio> at a time; the play state is painted in place, so the note never re-renders ---- */
const SPEEDS = [1, 1.25, 1.5, 2, 0.75];
const PLAYER = { el: null, id: null, urls: {}, demo: null };
const clipSt = id => (S.clips[id] ||= { pos: 0, playing: false, speed: 1, busy: false });
const clipDur = id => id === 'take' ? (S.voice.take?.seconds || S.voice.seconds || 0) : (attByFile(id)?.seconds || PLAYER.durs?.[id] || 0);
const clipSel = id => `[data-clip="${CSS.escape(id)}"]`;
function clipHtml(a, o = {}) {
  const ctx = o.ctx || 'note', id = a.id, st = clipSt(id), dur = clipDur(id), missing = !!o.missing;
  const pct = dur ? Math.min(100, st.pos / dur * 100) : 0, lab = `${ctx === 'take' ? 'Your recording' : 'Voice note'}, ${fmtT(dur)}`;
  const play = `<button class="icon-btn icon-btn--sm clip-play" data-act="clip-play" data-v="${esc(id)}" aria-pressed="${st.playing}" aria-label="${st.playing ? 'Pause' : 'Play'} · ${esc(lab)}" title="${st.playing ? 'Pause' : 'Play'}"${missing ? ' disabled' : ''}>${ic(st.playing ? 'pause' : 'play')}</button>`;
  const seek = `<div class="clip-bar" data-act="clip-seek" data-v="${esc(id)}" role="slider" tabindex="${missing ? -1 : 0}" aria-label="Position in ${esc(lab)}" aria-valuemin="0" aria-valuemax="${Math.round(dur)}" aria-valuenow="${Math.round(st.pos)}" aria-valuetext="${fmtT(st.pos)} of ${fmtT(dur)}"><span class="clip-track"><span style="width:${pct}%"></span></span></div>`;
  const time = `<span class="clip-time num" data-clip-time>${fmtT(st.pos)} / ${fmtT(dur)}</span>`;
  const nx = SPEEDS[(SPEEDS.indexOf(st.speed) + 1) % SPEEDS.length];
  const speed = ctx === 'panel' ? '' : `<button class="btn btn--ghost btn--sm clip-speed" data-act="clip-speed" data-v="${esc(id)}" aria-label="Playback speed ${st.speed}×" title="Speed: click for ${nx}×"${missing ? ' disabled' : ''}>${st.speed}×</button>`;
  const file = ctx === 'take' ? `<span class="clip-file code truncate" title="${esc(a.file)}">${esc(attBase(a.file))} · ${S.voice.keep === 'text' ? 'to the recycle bin after you save the text' : 'not saved yet'}</span>`
    : ctx === 'panel' ? '' : missing ? attMissingBits(a.file)   // Fix A (QC 4 · 35): in plain words, with Find the file…
    : ctx === 'list' ? ''   // Build M · QC 75: a Brain Dump row: play, position, speed (the row has its own ⋮)
    : `<button class="link-btn code clip-file" data-act="att-reveal" data-v="${esc(a.file)}" title="Show ${esc(a.file)} in File Explorer"><span class="truncate">${esc(attBase(a.file))}</span></button>`;
  const tr = ctx === 'take' || ctx === 'panel' || ctx === 'list' || o.hasText || missing ? '' : st.busy ? `<button class="btn btn--tint btn--sm" disabled><span class="spinner" aria-hidden="true"></span>Transcribing…</button>`
    : `<button class="btn btn--tint btn--sm" data-act="clip-transcribe" data-v="${esc(id)}" data-where="${esc(o.where || '')}" title="Turn this clip into text, on this PC" aria-label="Transcribe">${ic('doctext')}<span class="clip-tr-label">Transcribe</span></button>`;
  const extra = ctx === 'note' ? ` data-embed-for="${esc(a.file)}" data-md-ignore contenteditable="false"` : '';
  const more = ctx === 'take' || ctx === 'panel' || ctx === 'list' ? '' : attMoreBtn(a.file, missing);   // Fix A (QC 4 · 35): Rename…
  return `<div class="clip clip--line${missing ? ' is-missing' : ''}${ctx === 'take' ? ' clip-take' : ''}${o.flash ? ' is-flash' : ''}" data-clip="${esc(id)}"${extra} role="group" aria-label="${esc(lab)}"><div class="clip-row">${play}${seek}${time}${speed}${file}${tr}${more}</div></div>`;
}
function paintClip(id) {
  const st = clipSt(id), dur = clipDur(id), pct = dur ? Math.min(100, st.pos / dur * 100) : 0;
  app.querySelectorAll(clipSel(id)).forEach(el => {
    const tr = el.querySelector('.clip-track span'); if (tr) tr.style.width = pct + '%';
    const t = el.querySelector('[data-clip-time]'); if (t) t.textContent = `${fmtT(st.pos)} / ${fmtT(dur)}`;
    const sk = el.querySelector('[data-act="clip-seek"]'); if (sk) { sk.setAttribute('aria-valuenow', Math.round(st.pos)); sk.setAttribute('aria-valuemax', Math.round(dur)); sk.setAttribute('aria-valuetext', `${fmtT(st.pos)} of ${fmtT(dur)}`); }
    const pb = el.querySelector('.clip-play'); if (pb) { pb.setAttribute('aria-pressed', String(st.playing)); pb.innerHTML = ic(st.playing ? 'pause' : 'play'); pb.title = st.playing ? 'Pause' : 'Play'; pb.setAttribute('aria-label', pb.getAttribute('aria-label').replace(/^(Play|Pause)/, st.playing ? 'Pause' : 'Play')); }
    const sp = el.querySelector('.clip-speed'); if (sp) { sp.textContent = st.speed + '×'; sp.setAttribute('aria-label', `Playback speed ${st.speed}×`); sp.title = `Speed: click for ${SPEEDS[(SPEEDS.indexOf(st.speed) + 1) % SPEEDS.length]}×`; }
  });
}
async function clipUrl(id) {
  if (id === 'take') return S.voice.take?.data_url || null;
  if (PLAYER.urls[id]) return PLAYER.urls[id];
  const r = await nv('attachment_data', ATTR.pending[id] || id); if (failed(r)) { toast(r.message || "Couldn't open the clip."); return null; }
  return (PLAYER.urls[id] = r.data_url);
}
function stopPlayer() { if (PLAYER.el) PLAYER.el.pause(); clearInterval(PLAYER.demo); PLAYER.demo = null; Object.entries(S.clips).forEach(([k, o]) => { if (o.playing) { o.playing = false; paintClip(k); } }); }
async function clipPlay(id) {   // one clip plays at a time
  const st = clipSt(id);
  Object.entries(S.clips).forEach(([k, o]) => { if (k !== id && o.playing) { o.playing = false; paintClip(k); } });
  if (st.playing) { st.playing = false; if (PLAYER.id === id) PLAYER.el?.pause(); paintClip(id); return; }
  if (!realData() || (id === 'take' && S.voice.take?.demo)) {   // no app: the clock runs by itself (the check never starts it)
    if (PLAYER.el) PLAYER.el.pause(); st.playing = true; paintClip(id);
    if (!CHECK && !PLAYER.demo) PLAYER.demo = setInterval(() => { let any = false; Object.entries(S.clips).forEach(([k, o]) => { if (!o.playing) return; any = true; o.pos = Math.min(clipDur(k), o.pos + .25 * o.speed); if (o.pos >= clipDur(k)) { o.playing = false; o.pos = 0; } paintClip(k); }); if (!any) { clearInterval(PLAYER.demo); PLAYER.demo = null; } }, 250);
    return;
  }
  const url = await clipUrl(id); if (!url) { if (id === 'take') toast('One moment: the recording is still being prepared'); return; }
  if (PLAYER.id !== id || !PLAYER.el) {
    PLAYER.el?.pause(); const el = PLAYER.el = new Audio(url); PLAYER.id = id;
    el.addEventListener('timeupdate', () => { if (PLAYER.el !== el) return; clipSt(id).pos = el.currentTime; paintClip(id); });
    el.addEventListener('loadedmetadata', () => { if (isFinite(el.duration) && !clipDur(id)) { (PLAYER.durs ||= {})[id] = el.duration; paintClip(id); } });
    el.addEventListener('ended', () => { const s = clipSt(id); s.playing = false; s.pos = 0; paintClip(id); });
  }
  PLAYER.el.playbackRate = st.speed; if (Math.abs(PLAYER.el.currentTime - st.pos) > .3) PLAYER.el.currentTime = st.pos;
  st.playing = true; paintClip(id);
  try { await PLAYER.el.play(); } catch (e) { st.playing = false; paintClip(id); toast("Couldn't play the clip"); }
}
function clipSeek(id, sec) { const st = clipSt(id); st.pos = clamp(sec, 0, clipDur(id)); if (PLAYER.id === id && PLAYER.el) PLAYER.el.currentTime = st.pos; paintClip(id); }
function clipSpeed(id) { const st = clipSt(id); st.speed = SPEEDS[(SPEEDS.indexOf(st.speed) + 1) % SPEEDS.length]; if (PLAYER.id === id && PLAYER.el) PLAYER.el.playbackRate = st.speed; paintClip(id); }
// A clip in the note, the brain dump or the Attachments tab: the file's entry, or a "File not found" row
const clipFor = file => ({ id: file, file });

/* ---- Embeds in the note: the ![[attachments/…]] line stays in the editor (hidden, so it saves as written) and its player,
        image or file row is drawn before it as an editor-only decoration (data-md-ignore), like the video embeds ---- */
function embedHtml(file, n) {
  const a = attByFile(file), kind = attKind(file), flash = S.flashAtt === file;
  if (!a) return kind === 'audio' ? clipHtml(clipFor(file), { ctx: 'note', missing: true })
    : `<div class="att-embed is-missing" data-embed-for="${esc(file)}" data-md-ignore contenteditable="false"><span class="att-icon">${ic('alert')}</span><span class="list-item-main"><span class="list-item-title truncate">${esc(attBase(file))} isn't in attachments/ any more</span><span class="list-item-sub">Renamed or moved outside NeuroVault? Find it, and every note links to it again</span></span><button class="btn btn--secondary btn--sm" data-act="att-find" data-v="${esc(file)}">${ic('search')}Find the file…</button></div>`;
  if (kind === 'audio') return clipHtml(clipFor(file), { ctx: 'note', hasText: embedHasText(n, file), where: n?.id, flash });
  if (kind === 'image') return `<div class="att-img" data-embed-for="${esc(file)}" data-md-ignore contenteditable="false"><img alt="${esc(attBase(file))}" data-att-img="${esc(file)}"${PLAYER.urls[file] ? ` src="${PLAYER.urls[file]}"` : ''}></div>`;
  return `<div class="att-embed" data-embed-for="${esc(file)}" data-md-ignore contenteditable="false"><span class="att-icon">${ic(ATT_ICON[kind])}</span><span class="list-item-main"><span class="list-item-title truncate">${esc(attBase(file))}</span><span class="list-item-sub">${fmtSize(a.size)}</span></span><button class="btn btn--secondary btn--sm" data-act="att-show" data-v="${esc(file)}">${ic('external')}Open</button></div>`;
}
function embedAtts() {
  app.querySelectorAll('.doc').forEach(doc => {
    const n = D.notes.find(x => x.id === doc.dataset.note) || note();
    doc.querySelectorAll('.wikilink[data-wiki^="attachments/"]').forEach(w => {
      const p = w.parentElement, file = w.dataset.wiki; if (!p || p.nodeName !== 'P' || p.textContent.trim() !== `![[${file}]]`) return;
      p.classList.add('att-src'); p.setAttribute('contenteditable', 'false');
      const prev = p.previousElementSibling, html = embedHtml(file, n);
      if (prev?.dataset?.embedFor === file) prev.outerHTML = html; else p.insertAdjacentHTML('beforebegin', html);
    });
    doc.querySelectorAll('img[data-att-img]:not([src])').forEach(async img => { if (!realData()) return; const f = img.dataset.attImg, url = await clipUrl(f); if (url) app.querySelectorAll(`img[data-att-img="${CSS.escape(f)}"]`).forEach(x => { x.src = url; }); });
  });
}
const _afterRenderA = afterRender;
afterRender = function () { _afterRenderA(); embedAtts(); };

/* ---- R25/R26: the recording pill, at the bottom, with no backdrop: live words, or the compact look ---- */
function vPill() {
  const v = S.voice, p = v.paused, live = vLive() && liveReady(), time = `<span class="num vpill-time" role="timer" aria-live="off" data-voice-clock>${mmss(v.seconds)}</span>`;
  if (v.stage === 'saving') return `<div class="vpill vpill--mini vpill--saving card" role="status" aria-label="Saving the voice ramble"><span class="vpill-dot is-paused" aria-hidden="true"></span>${time}<span class="spinner" aria-hidden="true"></span><span class="vpill-label">Saving…</span></div>`;
  const dot = `<span class="vpill-dot${p ? ' is-paused' : ''}" aria-hidden="true"></span>`;
  const pause = `<button class="icon-btn icon-btn--sm" data-act="voice-pause" aria-label="${p ? 'Resume recording' : 'Pause recording'}" title="${p ? 'Resume' : 'Pause'}">${ic(p ? 'play' : 'pause')}</button>`;
  if (!live) {   // R26 compact: four things only; Discard is in the question after Stop
    const why = !vLive() ? 'Live words is off, so the pill shows the time only. Turn it on in Settings → Voice' : `Live words needs its ${LIVE_MB()} MB model: download it in Settings → Voice`;
    return `<div class="vpill vpill--mini card" role="region" aria-label="Voice ramble ${p ? 'paused' : 'recording'}" title="${esc(why)}">${dot}${time}${pause}
    <button class="icon-btn icon-btn--sm vpill-stop" id="voice-stop" data-act="voice-stop" aria-label="Stop recording" title="Stop">${ic('stop')}</button></div>`;
  }
  const said = p ? 'Paused · what you said so far is kept' : v.words ? '…' + v.words : v.demo ? '…okay so for the Q3 roadmap I need to email Maya by Friday about the £450 for the accessibility audit' : 'Listening…';
  return `<div class="vpill vpill--caption card" role="region" aria-label="Voice ramble ${p ? 'paused' : 'recording'}">${dot}${time}
    <span class="vpill-caption" aria-live="off"><span data-voice-words>${esc(said)}</span></span>${pause}<button class="btn btn--primary btn--sm" id="voice-stop" data-act="voice-stop">${ic('stop')}Stop</button>
    <button class="icon-btn icon-btn--sm" data-act="voice-discard" aria-label="Discard the recording" title="Discard">${ic('x')}</button></div>`;
}
const pillOn = () => ['recording', 'stopping', 'saving'].includes(S.voice.stage);
// The pill stays while another dialog (Settings, Ctrl+K…) is open, so the recording is never lost from sight
const _renderModalA = renderModal;
renderModal = function () {
  const h = _renderModalA(); return S.modal !== 'voicerec' && pillOn() ? h + vPill() : h;
};

/* ---- R25: the one question after Stop ---- */
const V_KEEP = [['both', 'Audio + text'], ['text', 'Text only'], ['audio', 'Audio only']];
const vSeg = (act, label, opts, cur) => `<div class="set-row"><div class="set-label" id="vs-${act}">${label}</div><div class="seg" role="group" aria-labelledby="vs-${act}">${opts.map(([v, l, off]) => `<button class="seg-opt" data-act="${act}" data-v="${v}" aria-pressed="${cur === v}"${off ? ' disabled title="No note is open"' : ''}>${l}</button>`).join('')}</div></div>`;
function vDest(d = S.voice.dest) {
  const n = voiceTarget(), t = n?.title || 'Untitled';
  return { note: { btn: `Add to "${t}"`, to: `to "${t}"` }, new: { btn: 'Save as a new note', to: 'as a new note' }, dump: { btn: 'Add to the Brain Dump', to: 'to the Brain Dump' } }[d];
}
const takeClip = () => { const d = S.voice.startedAt || new Date(); return { id: 'take', file: S.voice.take?.file || `attachments/voice-${d.getFullYear()}${two(d.getMonth() + 1)}${two(d.getDate())}-${two(d.getHours())}${two(d.getMinutes())}${two(d.getSeconds())}${clipExt()}` }; };
const truncLabel = t => `<span class="truncate">${esc(t)}</span>`;
function vAsk() {
  const v = S.voice, dd = vDest(), needText = v.keep !== 'audio', noText = !!v.txErr && !v.result;
  const sub = `${mmss(v.take?.seconds || v.seconds)} · ${v.result ? 'transcribed on this PC' : noText ? 'no words were heard' : 'transcribing on this PC…'}`;
  const wait = v.pending && !v.result && !noText, saveOff = wait || (noText && v.keep === 'text');
  const label = v.keep === 'audio' ? 'Save the clip ' + dd.to : dd.btn;
  return dlg({ id: 'voice', size: 'md', keep: true, cls: 'vask', title: 'Save your voice note', titleId: 'va-t', sub: esc(sub), subData: ' data-voice-ask-sub', xLabel: 'Discard and close',   // Build L: R41's anatomy, medium
    body: `${clipHtml(takeClip(), { ctx: 'take' })}
      ${v.saveErr ? `<div class="alert alert--danger" role="alert">${ic('alert')}<span>${esc(v.saveErr)} · nothing was added yet, and the recording is still here.</span></div>` : ''}
      ${noText && needText ? `<div class="alert alert--warning" role="status">${ic('alert')}<span>${esc(v.txErr)}${v.keep === 'both' ? ' You can still keep the audio.' : ''}</span></div>` : ''}
      ${vSeg('voice-keep', 'Keep', V_KEEP, v.keep)}${vSeg('voice-dest', 'Save to', [['dump', 'Brain Dump'], ['note', 'This note', !voiceTarget()], ['new', 'New note']], v.dest)}
      ${dlgAlways('data-act="voice-remember"', v.remember, 'Settings → Voice')}`,
    cancel: '<button class="btn btn--secondary" data-act="close">Discard</button>',
    others: [needText ? `<button class="btn btn--secondary" data-act="voice-next"${noText ? ' disabled' : ''}>Check the text first</button>` : ''],
    main: `<button class="btn btn--primary" id="voice-save" data-act="voice-save"${saveOff ? ' disabled' : ''} title="Enter">${wait ? '<span class="spinner" aria-hidden="true"></span>Transcribing…' : v.saveErr ? ic('restore') + 'Try again' : ic('ok') + truncLabel(label)}</button>` });
}
/* ---- The check dialog (Phase 6B's, from "Check the text first" or Transcribe): the clip on top, "Keep this text" in each pane ---- */
function vCheck() {
  const v = S.voice, R = v.result, from = v.fromAtt, useRaw = v.text === 'raw';
  const raw = R.raw.map(([t, id]) => id ? anchorPill(id, R.anchors[id], voiceMissing(id)) : esc(t)).join('');
  const missing = useRaw ? 0 : Object.keys(R.anchors).filter(voiceMissing).length;
  const tasks = R.tasks.map((segs, i) => `<label class="task"><input type="checkbox" data-act="voice-task" data-v="${i}" ${v.skip.has(i) ? '' : 'checked'}><span>${segHtml(segs)}</span></label>`).join('');
  const pick = (val, on) => `<label class="voice-pick"><input type="radio" name="voice-text" data-act="voice-text" value="${val}" ${on ? 'checked' : ''}>Keep this text</label>`;
  const label = from ? 'Add the text under the clip' : vDest().btn;
  return dlg({ id: 'voice', size: 'wide', keep: true, title: from ? 'Check the transcript' : 'Check your voice note', titleId: 'vc-t', xLabel: from ? 'Close' : 'Discard and close',   // Build L: R41's anatomy, wide
    sub: 'Cleaned up by rules on this PC: filler words out, sentences and capitals, "I need to…" lines as tasks',
    body: `${from ? clipHtml(clipFor(from), { ctx: 'panel' }) : v.keep === 'both' ? clipHtml(takeClip(), { ctx: 'take' }) : ''}<div class="legend">${cvLegend()}<span>Hover a highlight to find its twin.</span></div>
      ${missing ? `<div class="alert alert--warning" role="status">${ic('alert')}<span>${missing} detail${missing === 1 ? '' : 's'} from your recording ${missing === 1 ? 'is' : 'are'} missing from the cleaned note. Insert ${missing === 1 ? 'it' : 'them'}, or accept without ${missing === 1 ? 'it' : 'them'}.</span></div>` : ''}
      <div class="voice-grid"><div class="card voice-pane${useRaw ? ' is-chosen' : ''}"><div class="voice-pane-head"><div class="eyebrow">What you said · raw transcript</div>${pick('raw', useRaw)}</div><div class="voice-text">${raw}</div></div>
        <div class="card voice-pane voice-out${useRaw ? '' : ' is-chosen'}"><div class="voice-pane-head"><div class="eyebrow">Cleaned note and tasks${useRaw ? '' : ' · will be added'}</div>${pick('clean', !useRaw)}</div><h3>${esc(voiceTitle())}</h3>${R.paras.map(p => `<p>${segHtml(p)}</p>`).join('') || (R.tasks.length ? '' : '<p class="list-item-sub">Nothing left after the clean-up.</p>')}
          ${R.tasks.length ? `<div class="eyebrow">Tasks · ticked ones go to Tasks</div><div class="win-list">${tasks}</div>` : ''}</div></div>`,
    cancel: `<button class="btn btn--secondary" data-act="close">${from ? 'Cancel' : 'Discard'}</button>`,
    main: `<button class="btn btn--primary" id="voice-accept" data-act="voice-accept" title="Enter">${ic('ok')}${truncLabel(label)}</button>` });
}
const _voiceModalA = voiceModal;
voiceModal = function () {
  // Fix C (QC 8): while it starts (the voice check, then the microphone) the pill is already there. 6B's "Voice ramble" dialog
  // drew for that moment first: the ghost that flashed before the pill. It still shows for a missing model or an error
  if (S.modal === 'voicerec' && (pillOn() || S.voice.stage === 'starting')) return vPill();
  if (S.modal === 'voice' && S.voice.stage === 'ask') return vAsk();
  if (S.modal === 'voice' && S.voice.stage === 'check' && S.voice.result) return vCheck();
  return _voiceModalA();
};

/* ---- Recording: Phase 6B starts it; Stop now leads to the question (or straight to your default) ---- */
const _voiceRecordA = voiceRecord;
voiceRecord = function () { Object.assign(S.voice, { paused: false, words: null, startedAt: new Date() }); return _voiceRecordA(); };
const _openVoiceA = openVoice;
openVoice = function () {
  if (S.voice.stage === 'recording') { voiceStop(); return; }   // the window bar's mic while recording: Stop (never a silent discard)
  if (['saving', 'clip'].includes(S.voice.stage)) return;
  if (S.voice.stage === 'idle') Object.assign(S.voice, { startedAt: new Date(), paused: false, words: null });
  return _openVoiceA();
};
voiceTick = async function () {
  const r = await nv('voice_poll'), v = S.voice; if (failed(r) || v.stage === 'idle') return;
  if (r.stage === 'recording') { if (v.stage !== 'recording') return; v.seconds = r.seconds; v.bars = r.bars; v.words = r.words; paintVoiceLevel(); const w = app.querySelector('[data-voice-words]'); if (w && !v.paused && v.words) w.textContent = '…' + v.words; if (r.full) voiceStop(); return; }
  if (r.stage === 'transcribing') { v.done = r.done; v.total = r.total; if (S.modal === 'voicerec' && v.stage === 'transcribing') paintVoiceProgress(); return; }
  if (r.stage === 'done') { voiceStopPolling(); voiceCheck(r.result); return; }
  if (r.stage === 'error') { voiceStopPolling(); voiceError(r.message); }
};
async function voicePause() {
  const v = S.voice; if (v.stage !== 'recording') return;
  v.paused = !v.paused; renderAll();
  if (api()) { const r = await nv('voice_pause', v.paused); if (failed(r)) { v.paused = !v.paused; toast(r.message); renderAll(); } }
}
voiceStop = async function () {
  const v = S.voice; if (v.stage !== 'recording') return;
  const d = vdef(), dest = v.forceDest || d.dest;
  Object.assign(v, { keep: d.keep, dest: dest === 'note' && !voiceTarget() ? 'dump' : dest, text: 'clean', remember: false, result: null, txErr: '', pending: false, take: null, added: new Set(), skip: new Set(), paused: false });
  if (!api()) { voiceStopPolling(); v.result = JSON.parse(JSON.stringify(VOICE_DEMO)); v.take = { demo: true, seconds: v.seconds || 42 }; }
  else {
    v.stage = 'stopping'; const r = await nv('voice_stop'); if (failed(r)) { v.stage = 'recording'; voiceError(r.message); return; }
    if (v.stage !== 'stopping') return;   // discarded meanwhile
    nv('voice_take').then(t => { if (!failed(t) && v.stage !== 'idle') { v.take = t; paintClip('take'); } });
  }
  if (d.ask) { v.stage = 'ask'; S.modal = 'voice'; S.focus = { sel: '#voice-save' }; renderAll(); }
  else { v.stage = 'saving'; v.pending = true; if (!S.modal) S.modal = 'voicerec'; renderAll(); if (v.result || v.keep === 'audio') acceptV2(); }   // Ask off: Stop saves straight away
};
voiceCheck = function (result) {
  const v = S.voice; if (v.stage === 'idle') return;
  v.result = JSON.parse(JSON.stringify(result)); v.added = new Set(); v.skip = new Set();
  if (v.stage === 'clip') { clipSt(v.fromAtt).busy = false; v.stage = 'check'; S.modal = 'voice'; S.focus = { sel: '#voice-accept' }; renderAll(); return; }
  if (v.pending) { acceptV2(); return; }   // Save was pressed (or Ask is off) before the text was ready
  if (v.wantCheck && v.stage === 'ask') { v.wantCheck = false; v.stage = 'check'; S.focus = { sel: '#voice-accept' }; renderAll(); return; }   // "Check the text first" was pressed early
  if (v.stage === 'ask' && S.modal === 'voice') renderAll();
};
const _voiceErrorA = voiceError;
voiceError = function (message) {
  const v = S.voice;
  if (v.stage === 'clip') { clipSt(v.fromAtt).busy = false; v.stage = 'idle'; v.fromAtt = null; toast(message || "Couldn't transcribe the clip."); renderAll(); return; }
  if (['ask', 'check', 'saving'].includes(v.stage)) {   // after Stop: nothing was heard (or Whisper failed); the audio can still be kept
    voiceStopPolling(); v.txErr = message || 'Transcription failed.';
    if (v.stage === 'saving') { if (v.keep !== 'text') acceptV2(); else { toast(v.txErr); endVoice(); renderAll(); } return; }
    v.pending = false; if (v.stage === 'check') v.stage = 'ask'; S.modal = 'voice'; renderAll(); return;
  }
  _voiceErrorA(message);
};
const _voiceClosedA = voiceClosed;
voiceClosed = function () {
  if (PLAYER.id === 'take') { PLAYER.el?.pause(); PLAYER.el = null; PLAYER.id = null; }
  delete S.clips.take; if (S.voice.fromAtt) clipSt(S.voice.fromAtt).busy = false;
  voiceStopPolling(); if (api()) nv('voice_discard');   // after a save too: a transcription still running is dropped
  Object.assign(S.voice, { stage: 'idle', paused: false, words: null, take: null, result: null, fromAtt: null, fromWhere: null, pending: false, txErr: '', forceDest: null, wantCheck: false, saveErr: '' });
};
// Ends the voice dialog: closes it when it's the dialog showing (a pill over Settings leaves Settings open)
function endVoice() { if (S.modal === 'voice' || S.modal === 'voicerec') closeModal(true); else voiceClosed(); }
function voiceDiscard() { const m = S.modal; voiceClosed(); if (m === 'voicerec' || m === 'voice') S.modal = null; status('Recording discarded'); renderAll(); }
voiceAccept = function () { acceptV2(); };   // Phase 6B's buttons and Enter in the check dialog

/* ---- Saving: the clip (attachments/voice-….ogg), the text and the ticked tasks, where you chose ---- */
function voiceParts() {
  const R = S.voice.result; if (!R) return { paras: [], tasks: [] };
  const segText = segs => segs.map(s => s[0]).join('').trim();
  const rawText = R.text || R.raw.map(s => s[0]).join('').trim();
  return { paras: (S.voice.text === 'raw' ? [rawText] : R.paras.map(segText)).filter(Boolean), tasks: R.tasks.map((t, i) => ({ title: segText(t), on: !S.voice.skip.has(i) })) };
}
const nowHM = () => { const d = new Date(); return `${two(d.getHours())}:${two(d.getMinutes())}`; };
function voiceSaveFailed(msg) {
  const v = S.voice; v.saveErr = `Couldn't save the recording${msg ? ': ' + String(msg).replace(/^Couldn't save the recording[.:]?\s*/i, '').replace(/\.$/, '') : ''}`;
  v.pending = false; v.stage = 'ask'; S.modal = 'voice'; S.focus = { sel: '#voice-save' }; status(v.saveErr); renderAll();
}
async function acceptV2() {
  const v = S.voice; if (v.saving) return; v.saveErr = '';
  const from = v.fromAtt, keepText = !!from || v.keep !== 'audio', keepAudio = !from && v.keep !== 'text';
  if (keepText && !v.result && !v.txErr) { v.pending = true; if (v.stage === 'ask') renderAll(); return; }   // finishes when the text arrives
  if (!keepAudio && !v.result) { toast(v.txErr || 'Nothing to save'); return; }
  v.saving = true;
  try {
    if (v.remember && !from) { setVdef('keep', v.keep); setVdef('dest', v.dest); setVdef('ask', false); }   // "Always do this"
    const { paras, tasks } = keepText ? voiceParts() : { paras: [], tasks: [] }, on = tasks.filter(t => t.on).map(t => t.title);
    if (from) { await textUnderClip(from, v.fromWhere, paras, tasks); return; }
    let file = null;
    // Fix A (QC 4 · 35): the ![[…]] line goes in only once the file is in the attachments folder; if the save fails, nothing
    // is added, the recording stays (the backend keeps it until it's saved) and the dialog says so, with Try again
    if (realData()) {
      const k = await nv('voice_keep', v.keep); if (failed(k)) { voiceSaveFailed(k.offline ? 'the app didn’t answer' : k.message); return; }
      file = k.recycled ? null : k.file;
      if (file) { await refreshAtts(); if (!attByFile(file)) { voiceSaveFailed(`${attBase(file)} isn't in the attachments folder`); return; } }
    } else if (keepAudio) { file = takeClip().file;   // the sample vault (no backend vault): a made-up clip, in notes that are never saved
 D.atts = [{ file, name: attBase(file), kind: 'audio', size: Math.round((v.take?.seconds || 42) * 4000), mtime: new Date().toISOString(), seconds: v.take?.seconds || 42 }, ...(D.atts || [])]; }
    const what = file && paras.length + tasks.length ? 'a voice clip and its text' : file ? 'a voice clip' : 'a voice note';
    let dest = v.dest; if (dest === 'note' && !voiceTarget()) dest = 'new';
    v.stage = 'idle'; endVoice();
    if (dest === 'dump') await voiceToDump([...paras, ...tasks.filter(t => !t.on).map(t => t.title)].join(' '), file, on, what);
    else await voiceToNote(dest, paras, tasks, file, what);
  } finally { v.saving = false; }
}
// Build A+ (voice tasks): a voice thought's ticked tasks become real tasks on the Tasks board (api.py _voice_board_tasks:
// no project, note or due date, Medium, medium energy, as the wrap-up parks a thought); the thought keeps their ids
function boardTasks(r, titles) {
  if (r) { const made = (r.tasks_added || []).map(mapTask); D.tasks.unshift(...made); return made.map(t => t.id); }
  return titles.map((title, i) => { const t = { id: 't-v' + Date.now() + '-' + i, noteId: null, title, priority: 'Medium', due: 'Upcoming', done: false, energy: 'medium', project: null }; D.tasks.unshift(t); return t.id; });
}
const tasksAdded = n => n ? `; ${n} task${n === 1 ? '' : 's'} to Tasks` : '';
async function voiceToDump(text, file, tasks, what) {
  let item;
  if (CAPTURE.live && realData()) { const r = await nv('add_inbox_voice', text, file, tasks); if (failed(r)) { toast(r.message || "Couldn't save to the Brain Dump."); renderAll(); return; } item = mapInbox(r.item); boardTasks(r); }
  else item = { id: 'in-' + Date.now(), t: nowHM(), day: todayKey(), text, done: false, audio: file, tasks: [], taskIds: boardTasks(null, tasks) };
  D.inbox.push(item); S.flashInbox = item.id; status(`Added ${what} to the Brain Dump${tasksAdded(item.taskIds.length)}`); openDump(); toast(`Added ${what} to the Brain Dump${tasksAdded(item.taskIds.length)}`);
  setTimeout(() => { S.flashInbox = null; app.querySelectorAll('.dump-item.is-flash').forEach(x => x.classList.remove('is-flash')); }, 1600);
}
const taskMd = tasks => typeof tkoOn === 'function' && tkoOn() ? tasks.filter(t => !t.on).map(t => '- ' + mdText(t.title)).join('\n') : tasks.map(t => (t.on ? '- [ ] ' : '- ') + mdText(t.title)).join('\n');   // Build M · R59: Only in Tasks: ticked ones become linked tasks, not lines
async function voiceToNote(where, paras, tasks, file, what) {
  const text = [...paras.map(mdText), taskMd(tasks)].filter(Boolean).join('\n\n'), embed = file ? `![[${file}]]` : '';
  const body = [embed, text].filter(Boolean).join('\n\n'), target = where === 'note' ? voiceTarget() : null;
  const n = target || await voiceNewNote(body); if (!n) { renderAll(); return; }
  if (target) { syncDoc(n); n.md = n.md.replace(/\s+$/, '') + (n.md.trim() ? '\n\n' : '') + `## ${voiceTitle()}\n\n${body}\n`; n.html = null; n.dirty = true; }
  const on = tasks.filter(t => t.on);
  if (VAULT.live) { if (target) await saveNote(n); else syncLineTasks(n); await tkoVoiceTasks(n, tasks); }   // a saved note's "- [ ]" lines become tasks (Build M · R59: or, with Only in Tasks, linked tasks)
  else { on.forEach((t, i) => D.tasks.unshift({ id: 't-v' + Date.now() + i, noteId: n.id, title: unescMd(mdText(t.title)), priority: 'Medium', due: 'Upcoming', done: false, energy: 'medium' })); n.lineBase = mdTaskLines(n.md).map(l => l.title); }
  const msg = `${target ? `Added ${what} to "${n.title}"` : `Saved ${what} as "${n.title}"`}${on.length ? ` with ${on.length} task${on.length === 1 ? '' : 's'}` : ''}`;
  status(msg); if (target) { S.noteId = n.id; renderAll(); } else openNote(n.id, true, true);
  toast(msg);
}
// Transcribe: the text goes on the lines under the clip in its note, or into its inbox thought
async function textUnderClip(file, where, paras, tasks) {
  const v = S.voice, on = tasks.filter(t => t.on).map(t => t.title);
  const it = String(where || '').startsWith('in-') ? D.inbox.find(x => x.id === where) : null;
  v.stage = 'idle'; endVoice();
  if (it) {
    const text = [...paras, ...tasks.filter(t => !t.on).map(t => t.title)].join(' ');
    if (CAPTURE.live && realData()) { const r = await nv('update_inbox_voice', rawId(it.id), text, on); if (failed(r)) { toast(r.message || "Couldn't save the text."); return; } Object.assign(it, mapInbox(r.item)); boardTasks(r); }
    else Object.assign(it, { text, taskIds: [...(it.taskIds || []), ...boardTasks(null, on)] });   // Build A+
    openDump(); toast(`Added the text to the Brain Dump thought${tasksAdded(on.length)}`); return;
  }
  const n = D.notes.find(x => x.id === where) || D.notes.find(x => noteEmbeds(x).includes(file)); if (!n) { toast('The note with this clip is gone'); renderAll(); return; }
  syncDoc(n); const ls = n.md.split('\n'), i = ls.findIndex(l => l.trim() === `![[${file}]]`);
  const text = [...paras.map(mdText), taskMd(tasks)].filter(Boolean).join('\n\n');
  ls.splice(i < 0 ? ls.length : i + 1, 0, '', text); n.md = ls.join('\n'); n.html = null; n.dirty = true;
  if (VAULT.live) { await saveNote(n); await tkoVoiceTasks(n, tasks); }   // Build M · R59
  else { tasks.filter(t => t.on).forEach((t, k) => D.tasks.unshift({ id: 't-v' + Date.now() + k, noteId: n.id, title: unescMd(mdText(t.title)), priority: 'Medium', due: 'Upcoming', done: false, energy: 'medium' })); n.lineBase = mdTaskLines(n.md).map(l => l.title); }
  S.noteId = n.id; renderAll(); toast(`Added the text under the clip in "${n.title || 'Untitled'}"`);
}
async function transcribeClip(file, where) {
  const v = S.voice; if (v.stage !== 'idle') { toast('Finish the voice ramble first'); return; }
  Object.assign(v, { stage: 'clip', fromAtt: file, fromWhere: where, text: 'clean', keep: 'both', dest: 'note', added: new Set(), skip: new Set(), result: null, txErr: '' });
  clipSt(file).busy = true; app.querySelectorAll(`${clipSel(file)} [data-act="clip-transcribe"]`).forEach(b => { b.outerHTML = '<button class="btn btn--tint btn--sm" disabled><span class="spinner" aria-hidden="true"></span>Transcribing…</button>'; });
  if (!realData()) { const go = () => voiceCheck(VOICE_DEMO); if (CHECK) go(); else setTimeout(go, 900); return; }
  const r = await nv('voice_transcribe_file', file); if (failed(r)) { voiceError(r.message); return; }
  voicePollEvery(voiceTick);
}

/* ---- Brain dump: the mic beside ×, and a voice thought as its clip, text and "Task:" lines (capture.js asks for these) ---- */
const dumpMicA = () => `<button class="icon-btn icon-btn--sm" data-act="dump-voice" aria-label="Record a voice thought" title="Record a voice thought: keep the clip, the text or both">${ic('mic')}</button>`;
function dumpItemA(x) {
  const n = x.taskIds?.length || 0; if (!x.audio && !x.tasks?.length && !n) return null;
  const flash = S.flashInbox === x.id ? ' is-flash' : '';
  const added = n ? `<button class="link-btn voice-tasks-link" data-act="voice-tasks-open" title="Open the Tasks board">${n} task${n === 1 ? '' : 's'} added to Tasks</button>` : '';   // Build A+: they're on the board now
  return `<div class="dump-item${flash}"><span class="num">${esc(x.t)}</span><div class="dump-item-body">${x.audio ? (attByFile(x.audio) ? clipHtml(clipFor(x.audio), { ctx: 'dump', hasText: !!x.text || !!x.tasks?.length || !!n, where: x.id }) : clipHtml(clipFor(x.audio), { ctx: 'dump', missing: true })) : ''}${x.text ? `<span>${esc(x.text)}</span>` : ''}${(x.tasks || []).map(t => `<span class="list-item-sub">Task: ${esc(t)}</span>`).join('')}${added}</div></div>`;
}

/* ---- R21: the Attachments tab (this note only) ---- */
const attTabShown = n => !!n;   // Build M parity (R45 r45-attnote, "drop the setting"): with no note open there's no Attachments tab
function noteAtts(n) { return noteEmbeds(n).map(f => attByFile(f) || { file: f, kind: attKind(f), missing: true }); }
function attRow(a) {
  const u = attUses(a.file), open = S.attOpen === a.file, kind = a.kind || attKind(a.file);
  const meta = a.missing ? 'Not in attachments/ any more' : [attFromBit(a), kind === 'audio' ? fmtT(a.seconds) : '', fmtSize(a.size), attDate(a)].filter(Boolean).join(' · ');   // Build M · QC 68: the original's folder first
  const right = a.missing ? `<span class="chip chip--warning" title="The note embeds it, but it isn't in attachments/">Missing</span>` : u.length ? `<span class="list-item-count num" aria-label="Used in ${u.length} place${u.length === 1 ? '' : 's'}" title="Used in ${u.length} place${u.length === 1 ? '' : 's'}">${u.length}</span>` : `<span class="chip chip--warning" title="No note uses this file">Unused</span>`;
  return `<div class="att-item"><button class="list-item att-row" data-act="att-open" data-v="${esc(a.file)}" aria-expanded="${open}" title="${esc(a.file)}"><span class="att-icon">${ic(ATT_ICON[kind])}</span><span class="list-item-main"><span class="list-item-title att-name">${nameHtml(attBase(a.file))}</span><span class="list-item-sub truncate">${meta}</span></span>${right}</button>${open ? attDetail(a, u) : ''}</div>`;
}
function attDetail(a, u) {
  if (a.missing) return `<div class="att-detail"><div class="list-item-sub">This note links to it, but the file isn't in attachments/ any more: renamed or moved outside NeuroVault? Find it, and every note links to it again.</div><div class="att-actions"><button class="btn btn--secondary btn--sm" data-act="att-find" data-v="${esc(a.file)}">${ic('search')}Find the file…</button></div><div class="list-item-sub code truncate" title="${esc(a.file)}">${esc(a.file)}</div></div>`;
  const kind = a.kind || attKind(a.file);
  const preview = kind === 'audio' ? clipHtml(clipFor(a.file), { ctx: 'panel' }) : kind === 'image' ? `<div class="att-thumb"><img alt="${esc(attBase(a.file))}" data-att-img="${esc(a.file)}"${PLAYER.urls[a.file] ? ` src="${PLAYER.urls[a.file]}"` : ''}></div>` : '';
  const used = u.length ? `<div class="att-used">${u.map(x => `<button class="link-btn" data-act="att-goto" data-v="${esc(a.file)}" data-where="${esc(x.id)}" title="Open ${esc(x.label)}">${esc(x.label)}</button>`).join('')}</div>` : `<div class="list-item-sub">No note uses this file. Removing it frees ${fmtSize(a.size)}.</div>`;
  return `<div class="att-detail">${preview}${attWhereHtml(a)}<div class="eyebrow">Used in</div>${used}<div class="att-actions">${kind === 'audio' ? '' : `<button class="btn btn--secondary btn--sm" data-act="att-show" data-v="${esc(a.file)}">${ic('external')}Open</button>`}<button class="btn btn--secondary btn--sm" data-act="att-reveal" data-v="${esc(a.file)}" title="${esc(attRevealTitle(a))}">${ic('folderopen')}Reveal</button><button class="btn btn--secondary btn--sm" data-act="att-rename" data-v="${esc(a.file)}" title="A new name for the file; every note that links to it follows">${ic('edit')}Rename…</button><button class="btn btn--ghost btn--sm" data-act="att-remove" data-v="${esc(a.file)}" title="Take it out of the note and NeuroVault's lists: the file stays in attachments/, and the Timeline can restore it">${ic('x')}Remove</button></div></div>`;   // Build M · QC 68: the vault path is under "Where it is" now
}
function attPanel(n) {
  if (!n) return `<div class="att-panel"><div class="eyebrow">In this note</div><div class="list-item-sub">Open a note to see its attachments.</div></div>`;
  const list = noteAtts(n), head = `<div class="eyebrow">In this note · ${list.length}</div>` + attOpenedFrom(n);   // Build M · QC 68
  if (!list.length) return `<div class="att-panel">${head}<div class="empty empty--compact"><div class="empty-title">No attachments in this note</div><div class="empty-text">Voice clips and other files the note embeds are saved in attachments/.</div></div></div>`;
  const groups = ['audio', 'image', 'pdf', 'other'].map(k => [k, list.filter(a => (a.kind || attKind(a.file)) === k)]).filter(g => g[1].length);
  const size = list.reduce((t, a) => t + (a.size || 0), 0);
  return `<div class="att-panel">${head}${groups.map(([k, items]) => `<div class="eyebrow">${ATT_KIND[k]} · ${items.length}</div>${items.map(attRow).join('')}`).join('')}<div class="list-item-sub att-sum">${list.length} file${list.length === 1 ? '' : 's'} · ${fmtSize(size)} · <span class="code">attachments/</span></div></div>`;
}
// The note without the lines that are only the embed, and one of the blank lines around each (as attachments.remove_embed)
function removeEmbed(md, line) { const ls = md.split('\n'), out = []; ls.forEach((l, i) => { if (l.trim() !== line && l.trim() !== `<!-- ${line} -->`) { out.push(l); return; }   /* Build K: a converted table's CSV is linked by a hidden comment line */ if (out.length && !out[out.length - 1].trim() && i + 1 < ls.length && !ls[i + 1].trim()) out.pop(); }); return out.join('\n'); }
// Build L (R41): no confirm. The file leaves the lists, and its players and embeds leave the notes, at once, with Undo for 10
// seconds; remove_attachment (the notes' saved text, the thoughts) runs when they're up (dialogs.js hold). Build M · QC 88: the file
// itself stays in attachments/ (never the recycle bin); the Timeline records it, with Restore
function removeAtt(file) {
  const line = `![[${file}]]`, i = (D.atts || []).findIndex(a => a.file === file), att = i >= 0 ? D.atts[i] : null;
  const notes = D.notes.filter(n => (syncDoc(n), n.md.includes(line))).map(n => [n, n.md, removeEmbed(n.md, line)]);
  const thoughts = D.inbox.filter(x => x.audio === file), keepThought = x => x.text || x.tasks?.length || x.taskIds?.length;   // as the backend: a thought with nothing else left goes
  if (PLAYER.id === file) { PLAYER.el?.pause(); PLAYER.el = null; PLAYER.id = null; }
  hold({ msg: `Removed ${attBase(file)} from NeuroVault${notes.length ? `: out of ${notes.length} note${notes.length === 1 ? '' : 's'}` : ''} · the file stays in attachments/`, back: `${attBase(file)} is back`,
    apply() {
      notes.forEach(([n, , after]) => { n.md = after; n.html = null; });   // the backend saves the same change (attachments.remove_embed)
      D.inbox = D.inbox.filter(x => x.audio !== file || keepThought(x)).map(x => x.audio === file ? { ...x, audio: null } : x);
      delete S.clips[file]; D.atts = (D.atts || []).filter(a => a.file !== file); S.attOpen = null; S.attUnused = null;
    },
    undo() {
      notes.forEach(([n, before, after]) => { if (n.md === after) { n.md = before; n.html = null; } });   // a note you've typed in since keeps your text
      D.inbox = D.inbox.map(x => thoughts.find(o => o.id === x.id) || x); thoughts.forEach(o => { if (!D.inbox.some(x => x.id === o.id)) D.inbox.push(o); });
      if (att && !D.atts.includes(att)) D.atts.splice(Math.min(i, D.atts.length), 0, att); S.attUnused = null;
    },
    async commit() {
      if (!realData()) return null;
      await flushSaves(); const r = await nv('remove_attachment', file); if (failed(r)) return r;
      D.inbox = D.inbox.filter(x => !r.inbox_removed.includes(rawId(x.id))).map(x => r.inbox.includes(rawId(x.id)) ? { ...x, audio: null } : x);
      if (typeof bmActivity === 'function') { S.bm.actAt = 0; bmActivity(); } renderAll(); return r;   // Build M · QC 88: the Timeline has it now
    } });
}
function attGoto(file, where) {
  if (String(where).startsWith('in-')) { S.flashInbox = where; openDump(); setTimeout(() => { S.flashInbox = null; app.querySelectorAll('.dump-item.is-flash').forEach(x => x.classList.remove('is-flash')); }, 1600); return; }
  S.flashAtt = file; const n = D.notes.find(x => x.id === where); if (!n) return; n.html = null; if (UI.view !== 'notes') UI.view = 'notes'; openNote(where);
  app.querySelector(`.doc ${clipSel(file)}, .doc [data-embed-for="${CSS.escape(file)}"]`)?.scrollIntoView({ block: 'center' }); S.flashAtt = null;
  setTimeout(() => app.querySelectorAll('.doc .clip.is-flash').forEach(x => x.classList.remove('is-flash')), 1600);
}

/* ---- Settings → Voice: live words and "After a voice ramble" first (R25, R28), then Phase 6B's and 6C's rows ---- */
function liveRow() {
  const L = liveSt(), on = vLive(), free = L?.free_gb, low = free != null && free < 5, mb = LIVE_MB(), drive = L?.drive || 'C:';
  const desc = on ? `Shows the words as you talk. Adds a small streaming model (${mb} MB)${low ? `; ${esc(drive)} has only ${free} GB free` : ''}`
    : low ? `Off to save space: ${esc(drive)} has ${free} GB free, so the pill shows just the time. Turn it on to add ${mb} MB` : `Off: the pill shows just the time. Turn it on to add ${mb} MB`;
  const dl = S.voice.status?.download, busy = dl?.stage === 'downloading' && dl.name === 'live';
  const model = !on || !api() || !L ? '' : L.present ? `<div class="set-row"><div><div class="set-label">Live words model</div><div class="set-desc">Installed in <span class="code voice-path">${esc(L.folder)}</span></div></div></div>`
    : `<div class="set-row"><div><div class="set-label">Live words model</div><div class="set-desc">${busy ? 'Downloading…' : `Not on this PC yet · ${mb} MB from Hugging Face, once (<span class="code voice-path">${esc(L.source.replace(/^https:\/\//, ''))}</span>)`}</div>${busy ? voiceDlBar() : ''}</div>${busy ? '<button class="btn btn--secondary" data-act="voice-dl-cancel">Cancel</button>' : `<button class="btn btn--secondary" data-act="live-download">${ic('download')}Download</button>`}</div>`;
  return `<div class="set-row"><div><div class="set-label" id="live-settings">Live words while recording</div><div class="set-desc">${desc}</div></div><button class="toggle" role="switch" aria-checked="${on}" aria-labelledby="live-settings" data-act="vdef-live"></button></div>${model}`;
}
const voiceDefaultsRows = () => `${liveRow()}<div class="eyebrow eyebrow--gap">After a voice ramble</div>${vSeg('vdef-keep', 'Keep', V_KEEP, vdef().keep)}${vSeg('vdef-dest', 'Save to', [['dump', 'Brain dump'], ['note', 'Open note'], ['new', 'New note']], vdef().dest)}
  <div class="set-row"><div><div class="set-label" id="vdef-ask-l">Ask each time</div><div class="set-desc">Off: Stop saves straight away with the choices above</div></div><button class="toggle" role="switch" aria-checked="${vdef().ask}" aria-labelledby="vdef-ask-l" data-act="vdef-ask"></button></div>
  <div class="eyebrow mt-4">Speech and voices</div>`;
VOICE_PAGE.unshift(voiceDefaultsRows);
async function liveDownload() {
  const r = await nv('voice_download_live'); if (failed(r)) { toast(r.message); return; }
  S.voice.dl = { stage: 'downloading', name: 'live', done: 0, total: (liveSt()?.bytes || 4.4e7) }; if (S.voice.status) S.voice.status.download = S.voice.dl;
  renderAll(); voiceWatchDownload();
}

/* ---- Settings → Vault & files: the Attachments tab with no note open, and unused files to the recycle bin ---- */
function vaultAttRows() {
  if (S.attUnused === null) {
    if (realData()) { S.attUnused = 'loading'; flushSaves().then(() => nv('unused_attachments')).then(r => { S.attUnused = failed(r) ? { error: r.message } : r; if (S.modal === 'settings' && S.setSec === 'vault') renderAll(); }); }
    else { const files = (D.atts || []).filter(a => !attUses(a.file).length); S.attUnused = { count: files.length, bytes: files.reduce((t, a) => t + a.size, 0) }; }
  }
  const un = S.attUnused, n = un?.count || 0;
  const desc = un === 'loading' ? 'Checking attachments/…' : un?.error ? esc(plainMsg(un.error)) : n ? `${n} file${n === 1 ? '' : 's'} no note or brain-dump thought uses · ${fmtSize(un.bytes)}` : 'Every file in attachments/ is used';
  return `<div class="eyebrow eyebrow--gap">Attachments</div><div class="set-row"><div><div class="set-label">Unused attachments</div><div class="set-desc">${desc}</div></div><button class="btn btn--secondary" data-act="att-unused"${n ? '' : ' disabled'}>${ic('trash')}Move to the recycle bin</button></div>`;
}
VAULT_PAGE.push(vaultAttRows);
// Build L (R41): no confirm. The unused files leave the list at once, with Undo for 10 seconds; then exactly those files
// (any still unused) go to the recycle bin (dialogs.js hold)
async function recycleUnused() {
  let files, bytes;
  if (realData()) { const r = await nv('unused_attachments'); if (failed(r)) { toast(r.message); return; } files = r.files; bytes = r.bytes; }
  else { const un = (D.atts || []).filter(a => !attUses(a.file).length); files = un.map(a => a.file); bytes = un.reduce((t, a) => t + (a.size || 0), 0); }
  if (!files.length) { S.attUnused = null; status('Every file in attachments/ is used'); renderAll(); return; }
  const gone = (D.atts || []).map((a, i) => [i, a]).filter(([, a]) => files.includes(a.file)), n = files.length;
  hold({ msg: `Moved ${n} unused file${n === 1 ? '' : 's'} (${fmtSize(bytes)}) to the recycle bin`, back: `The ${n} file${n === 1 ? ' is' : 's are'} back`,
    apply() { D.atts = (D.atts || []).filter(a => !files.includes(a.file)); S.attUnused = { count: 0, bytes: 0 }; },
    undo() { gone.forEach(([i, a]) => { if (!D.atts.includes(a)) D.atts.splice(Math.min(i, D.atts.length), 0, a); }); S.attUnused = null; },
    async commit() {
      if (!realData()) return null;
      const r = await nv('recycle_unused_attachments', files); if (failed(r)) return r;
      await refreshAtts(); S.attUnused = null; if (r.failed.length) toast(`${r.failed.length} file${r.failed.length === 1 ? '' : 's'} couldn't be moved`); renderAll(); return r;
    } });
}

/* ---- Events (actions.js's switch doesn't know these acts) ---- */
document.getElementById('app').addEventListener('click', e => {
  const t = e.target.closest('[data-act]'); if (!t || e.target.closest('[data-soon]')) return;
  const v = t.dataset.v;
  switch (t.dataset.act) {
    case 'voice-pause': voicePause(); break;
    case 'voice-discard': voiceDiscard(); break;
    case 'voice-save': acceptV2(); break;
    case 'voice-next': if (S.voice.result) { S.voice.stage = 'check'; S.focus = { sel: '#voice-accept' }; renderAll(); } else { S.voice.wantCheck = true; status('One moment: still transcribing'); } break;
    case 'voice-keep': S.voice.keep = v; S.focus = { sel: `[data-act="voice-keep"][data-v="${v}"]` }; renderAll(); break;
    case 'voice-dest': S.voice.dest = v; S.focus = { sel: `[data-act="voice-dest"][data-v="${v}"]` }; renderAll(); break;
    case 'vdef-keep': setVdef('keep', v); status('Setting saved'); renderAll(); break;
    case 'vdef-dest': setVdef('dest', v); status('Setting saved'); renderAll(); break;
    case 'vdef-ask': setVdef('ask', !vdef().ask); status('Setting saved'); renderAll(); break;
    case 'vdef-live': setVdef('live', vLive() ? 'off' : 'on'); status(vLive() ? (liveReady() ? 'Live words on' : `Live words on: download its ${LIVE_MB()} MB model below`) : 'Live words off'); renderAll(); break;
    case 'live-download': liveDownload(); break;
    case 'att-empty': setVdef('empty', v); status('Setting saved'); renderAll(); break;
    case 'att-unused': recycleUnused(); break;   // Build L: no confirm, Undo for 10 seconds
    case 'clip-play': clipPlay(v); break;
    case 'clip-seek': { const r = t.getBoundingClientRect(); clipSeek(v, (r.width ? (e.clientX - r.left) / r.width : 0) * clipDur(v)); break; }
    case 'clip-speed': clipSpeed(v); break;
    case 'clip-transcribe': transcribeClip(v, t.dataset.where); break;
    case 'att-reveal': S.attMenu = null; attReveal(ATTR.pending[v] || v); break;   // Build M · QC 68: the location shown first (the original, by default)
    case 'att-show': if (realData()) nv('attachment_open', v).then(r => { if (failed(r)) toast(r.message); }); else toast(`Opens ${attBase(v)} in your default app`); break;
    case 'att-open': S.attOpen = S.attOpen === v ? null : v; S.focus = { sel: `[data-act="att-open"][data-v="${CSS.escape(v)}"]` }; renderAll(); break;
    case 'att-remove': removeAtt(v); break;   // Build L: no confirm, Undo for 10 seconds
    case 'att-goto': attGoto(v, t.dataset.where); break;
    case 'voice-tasks-open': S.modal = null; setUI('view', 'tasks'); break;   // Build A+: "3 tasks added to Tasks" opens the board
    case 'dump-voice': S.voice.forceDest = 'dump'; S.modal = null; openVoice(); break;   // R21: a voice thought; Save to starts on the brain dump
  }
});
document.getElementById('app').addEventListener('change', e => {
  const t = e.target;
  if (t.dataset.act === 'voice-remember') S.voice.remember = t.checked;
  if (t.dataset.act === 'voice-text') { S.voice.text = t.value; S.focus = { sel: `[data-act="voice-text"][value="${t.value}"]` }; renderAll(); }
});
document.getElementById('app').addEventListener('keydown', e => {   // the clip's bar: ← → 5 s, Home / End, Space or Enter plays
  const t = e.target; if (t.dataset?.act !== 'clip-seek') return; const id = t.dataset.v, st = clipSt(id);
  const to = { ArrowRight: st.pos + 5, ArrowLeft: st.pos - 5, Home: 0, End: clipDur(id) }[e.key];
  if (to != null) { e.preventDefault(); clipSeek(id, to); } else if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); clipPlay(id); }
});
// Esc while the pill records (with no dialog over it) would close it and lose the recording: only Esc on the pill itself discards
document.addEventListener('keydown', e => {
  if (e.key !== 'Escape' || !pillOn()) return;
  if (S.modal === 'voicerec' && !e.target.closest?.('.vpill')) { e.stopImmediatePropagation(); }
}, true);
// The ?check=1 sweep: the pill, the question and the check, on the sample
function voiceDemoA(stage, o = {}) {
  voiceClosed(); Object.assign(S.voice, { demo: true, seconds: 42, bars: [], words: null, paused: !!o.paused, startedAt: new Date(2026, 9, 14, 15, 42), keep: o.keep || 'both', dest: o.dest || 'dump', remember: false, text: o.raw ? 'raw' : 'clean', added: new Set(), skip: new Set() });
  if (stage === 'recording') { S.voice.stage = 'recording'; return 'voicerec'; }
  S.voice.take = { demo: true, seconds: 42 }; S.voice.result = JSON.parse(JSON.stringify(VOICE_DEMO)); S.voice.stage = stage; return 'voice';
}
/* ---- end Build A ---- */

/* ---- Fix A (QC 4 · 35): Rename… a clip or file, and Find the file… for a link whose file is gone ----
   Rename… (the player's ⋮, or the file in the Attachments tab) gives the file a new name in attachments/ (its extension
   kept, the name checked as Windows does) and every link to it, in every note, the Brain Dump and a wrap-up memo, follows:
   one step, with Undo for 10 seconds (dialogs.js hold; rename_attachment runs when they're up). A link whose file isn't
   there (renamed or moved outside NeuroVault) says so, with Find the file…: pick it from attachments/, or on this PC (it's
   copied in), and every link to the old name points at it (relink_attachment). */
const ATTR = { pending: {} };   // a new name → the name the file still has on disk, until the rename goes through
const attExt = f => (/\.[^./\\]+$/.exec(attBase(f)) || [''])[0];
const attStem = (typed, ext) => { const t = String(typed || '').split(/\s+/).join(' ').trim(); return ext && t.toLowerCase().endsWith(ext.toLowerCase()) ? t.slice(0, -ext.length).trim() : t; };
function attNameErr(file, typed) {   // as attachments.clean_name, and no other file of that name
  const ext = attExt(file), stem = attStem(typed, ext), name = stem + ext;
  if (!stem) return 'Type a name for the file.';
  const bad = [...new Set(stem.match(/[<>:"/\\|?*\x00-\x1f[\]#^]/g) || [])];
  if (bad.length) return `A file name can’t have ${bad.map(c => c < ' ' ? 'control characters' : c).join(' ')} in it.`;
  if (/^\.|\.$/.test(stem)) return 'A file name can’t start or end with a full stop.';
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(stem.split('.')[0])) return `Windows keeps the name ${stem.split('.')[0]} for itself: pick another.`;
  if (name.length > 120) return 'That name is too long (120 characters at most).';
  if ((D.atts || []).some(a => a.file !== file && attBase(a.file).toLowerCase() === name.toLowerCase())) return `There’s already a file called ${name} in attachments/.`;
  return '';
}
const relinkMd = (md, from, to) => String(md || '').replace(/!\[\[(attachments\/[^\[\]\n|#]+?)((?:[|#][^\[\]\n]*)?)\]\]/g, (m, f, rest) => f === from ? `![[${to}${rest}]]` : m);   // as attachments.relink
function attMissingBits(file) {
  return `<span class="clip-file clip-gone" title="${esc(file)} isn’t in attachments/ any more">${attKind(file) === 'audio' ? 'Recording' : 'File'} not found</span><button class="btn btn--secondary btn--sm" data-act="att-find" data-v="${esc(file)}" title="Renamed or moved outside NeuroVault? Pick it, and every note links to it again">${ic('search')}Find the file…</button>`;
}
function attMoreBtn(file, missing) {
  const on = S.attMenu === file, it = (act, icon, label) => `<button class="menu-item" role="menuitem" data-act="${act}" data-v="${esc(file)}">${ic(icon)}${label}</button>`;
  return `<span class="clip-more"><button class="icon-btn icon-btn--sm" data-act="att-menu" data-v="${esc(file)}" aria-haspopup="menu" aria-expanded="${on}" aria-label="More: ${esc(attBase(file))}" title="${missing ? 'Find the file' : 'Rename, Show in File Explorer'}">${ic('more')}</button>${on
    ? `<div class="menu card clip-menu" role="menu" aria-label="${esc(attBase(file))}">${missing ? it('att-find', 'search', 'Find the file…') : it('att-rename', 'edit', 'Rename…') + it('att-reveal', 'folderopen', 'Show in File Explorer')}</div>` : ''}</span>`;
}
function attRenameOpen(file) {
  S.attMenu = null; const ext = attExt(file); S.attRen = { file, draft: attBase(file).slice(0, attBase(file).length - ext.length), err: '' };
  S.modal = 'att-rename'; S.focus = { sel: '#att-ren-input' }; renderAll();
  const el = app.querySelector('#att-ren-input'); if (el) el.select();
}
function attRenameModal() {
  const R = S.attRen, ext = attExt(R.file), n = attUses(R.file).length;
  return dlg({ id: 'att-rename', size: 'md', title: 'Rename the file', sub: esc(n ? `${n} place${n === 1 ? '' : 's'} link${n === 1 ? 's' : ''} to it, and ${n === 1 ? 'it follows' : 'they all follow'}` : 'Nothing links to it yet'),
    body: `<label class="set-label" for="att-ren-input">New name</label><div class="att-ren-row"><input class="field" id="att-ren-input" data-act="att-ren-input" value="${esc(R.draft)}" spellcheck="false" autocomplete="off" maxlength="160"${R.err ? ' aria-invalid="true" aria-describedby="att-ren-err"' : ''}><span class="code att-ren-ext" title="The file keeps its type">${esc(ext)}</span></div>
      ${R.err ? `<div class="field-error" id="att-ren-err" role="alert">${esc(R.err)}</div>` : ''}<div class="list-item-sub code truncate" title="${esc(R.file)}">Now: ${esc(R.file)}</div>`,
    cancel: '<button class="btn btn--secondary" data-act="close">Cancel</button>', main: `<button class="btn btn--primary" data-act="att-ren-go">${ic('ok')}Rename</button>` });
}
function attRenameGo() {
  const R = S.attRen; if (!R) return; R.err = attNameErr(R.file, R.draft);
  if (R.err) { S.focus = { sel: '#att-ren-input' }; renderAll(); return; }
  const ext = attExt(R.file), name = attStem(R.draft, ext) + ext, to = 'attachments/' + name, from = R.file;
  S.attRen = null; closeModal(true);
  if (to === from) { status('The name is the same'); renderAll(); return; }
  attMove(from, to, `Renamed ${attBase(from)} to ${name}`, () => nv('rename_attachment', from, name));
}
function attFindOpen(file) { S.attMenu = null; S.attFind = { missing: file, q: '' }; S.modal = 'att-find'; S.focus = { sel: '#att-find-q' }; renderAll(); }
function attFindModal() {
  const F = S.attFind, kind = attKind(F.missing), q = F.q.trim().toLowerCase();
  const free = a => !attUses(a.file).length, list = (D.atts || []).filter(a => (a.kind || attKind(a.file)) === kind && a.file !== F.missing && (!q || attBase(a.file).toLowerCase().includes(q)))
    .sort((a, b) => free(b) - free(a));   // the files nothing links to first (a renamed one is one of them), newest first within
  const row = a => { const u = attUses(a.file).length; return `<button class="list-item att-find-row" data-act="att-find-pick" data-v="${esc(a.file)}"><span class="att-icon">${ic(ATT_ICON[kind])}</span><span class="list-item-main"><span class="list-item-title truncate">${esc(attBase(a.file))}</span><span class="list-item-sub">${[kind === 'audio' ? fmtT(a.seconds) : '', fmtSize(a.size), attDate(a), u ? `linked in ${u} place${u === 1 ? '' : 's'}` : 'nothing links to it'].filter(Boolean).join(' · ')}</span></span></button>`; };
  return dlg({ id: 'att-find', size: 'md', title: 'Find the file', sub: esc(`${attBase(F.missing)} isn’t in attachments/ any more. Pick the file it is now, and every link to it follows`),
    body: `<input class="field" id="att-find-q" data-act="att-find-q" type="search" value="${esc(F.q)}" placeholder="Filter by name" aria-label="Filter the files" autocomplete="off" spellcheck="false">
      <div class="att-find-list">${list.map(row).join('') || `<div class="list-item-sub">${q ? 'No file of that name.' : `No other ${(ATT_KIND[kind] || 'file').toLowerCase()} in attachments/.`} Choose it on this PC instead.</div>`}</div>`,
    cancel: '<button class="btn btn--secondary" data-act="close">Cancel</button>', main: `<button class="btn btn--primary" data-act="att-find-browse">${ic('folderopen')}Choose on this PC…</button>` });
}
function attFindPick(file) {
  const F = S.attFind; if (!F || !file) return; S.attFind = null; closeModal(true);
  attMove(F.missing, file, `Linked to ${attBase(file)}`, () => nv('relink_attachment', F.missing, file));
}
async function attFindBrowse() {
  const F = S.attFind; if (!F) return;
  if (!realData()) { toast('Opens a file picker on this PC'); return; }
  const r = await nv('attachment_pick', attKind(F.missing)); if (r?.status === 'cancelled') return; if (failed(r)) { toast(r.message); return; }
  await refreshAtts(); attFindPick(r.file);
}
// Every link to from becomes to, in the page now (Undo puts them back); the backend does the same when the 10 seconds are up
function attMove(from, to, msg, call) {
  const notes = D.notes.filter(n => (syncDoc(n), noteEmbeds(n).includes(from))).map(n => [n, n.md, relinkMd(n.md, from, to)]);
  const thoughts = (D.inbox || []).filter(x => x.audio === from), att = (D.atts || []).find(a => a.file === from), clip = S.clips[from];
  if (PLAYER.id === from) { PLAYER.el?.pause(); PLAYER.el = null; PLAYER.id = null; }
  const where = notes.length + thoughts.length;
  hold({ msg: `${msg}${where ? ` · ${where} link${where === 1 ? '' : 's'} updated` : ''}`, back: 'Put back as it was',
    apply() {
      notes.forEach(([n, , after]) => { n.md = after; n.html = null; });
      thoughts.forEach(x => { x.audio = to; });
      if (att) { att.file = to; att.name = attBase(to); ATTR.pending[to] = from; if (PLAYER.urls[from]) PLAYER.urls[to] = PLAYER.urls[from]; }
      if (clip) { S.clips[to] = clip; delete S.clips[from]; } if (S.attOpen === from) S.attOpen = to; S.attUnused = null;
    },
    undo() {
      notes.forEach(([n, before, after]) => { if (n.md === after) { n.md = before; n.html = null; } });   // a note you've typed in since keeps your text
      thoughts.forEach(x => { if (x.audio === to) x.audio = from; });
      if (att && att.file === to) { att.file = from; att.name = attBase(from); } delete ATTR.pending[to];
      if (clip && S.clips[to] === clip) { S.clips[from] = clip; delete S.clips[to]; } if (S.attOpen === to) S.attOpen = from;
    },
    async commit() {
      if (!realData()) { delete ATTR.pending[to]; return null; }
      await flushSaves(); const r = await call(); delete ATTR.pending[to]; if (failed(r)) return r;
      delete PLAYER.urls[from]; await refreshAtts(); renderAll(); return r;
    } });
}
const _renderModalR = renderModal;
renderModal = function () { return S.modal === 'att-rename' && S.attRen ? attRenameModal() : S.modal === 'att-find' && S.attFind ? attFindModal() : _renderModalR(); };   // eslint-disable-line no-global-assign
document.getElementById('app').addEventListener('click', e => {
  const t = e.target.closest('[data-act]'), act = t?.dataset.act, v = t?.dataset.v; if (!act) return;
  if (act === 'att-menu') {
    e.stopPropagation(); S.attMenu = S.attMenu === v ? null : v;
    if (typeof POPOVERS !== 'undefined' && !POPOVERS.some(p => p.id === 'att-menu')) POPOVERS.push({ id: 'att-menu', on: () => S.attMenu, off: () => { S.attMenu = null; }, el: '.clip-menu', btn: '[data-act="att-menu"][aria-expanded="true"]', menu: true, own: true });
    renderAll(); app.querySelector('.clip-menu .menu-item')?.focus(); return;
  }
  if (act === 'att-rename') { e.stopPropagation(); attRenameOpen(v); }
  else if (act === 'att-ren-go') attRenameGo();
  else if (act === 'att-find') { e.stopPropagation(); attFindOpen(v); }
  else if (act === 'att-find-pick') attFindPick(v);
  else if (act === 'att-find-browse') attFindBrowse();
});
document.getElementById('app').addEventListener('input', e => {
  if (e.target.id === 'att-ren-input' && S.attRen) { S.attRen.draft = e.target.value; if (S.attRen.err) { S.attRen.err = ''; S.focus = { sel: '#att-ren-input', pos: e.target.selectionStart }; renderAll(); } }
  if (e.target.id === 'att-find-q' && S.attFind) { S.attFind.q = e.target.value; S.focus = { sel: '#att-find-q', pos: e.target.selectionStart }; renderAll(); }
});
document.getElementById('app').addEventListener('keydown', e => {
  if (e.key === 'Enter' && e.target.id === 'att-ren-input') { e.preventDefault(); attRenameGo(); }
  if (e.key === 'Escape' && S.attMenu) { e.stopPropagation(); const f = S.attMenu; S.attMenu = null; S.focus = { sel: `[data-act="att-menu"][data-v="${CSS.escape(f)}"]` }; renderAll(); }
}, true);
/* ---- end Fix A ---- */

/* ==== Build M · QC 68 (design profile 2026-10-18: "When we attach a file we CREATE COPIES!!! and show its original location
   first not the vault location!"): every file NeuroVault opened, attached, dropped or converted is a copy, and the original
   stays where it was. The Attachments tab names where each copy came from first: the row says "From <folder>", the file's
   details list the original, then the vault copy (each shows itself in File Explorer), and Reveal / Show in File Explorer go
   to the original. If the original has since moved or been deleted, it says so and Reveal falls back to the copy. Settings →
   Vault & files → Show first: Where it came from (default) · The vault copy (config attach_show_first). ==== */
const ATTF = { first: 'source' };
const attSrc = a => (a && !a.missing && a.source && a.source.path) ? a.source : null;
const srcParts = p => String(p).split(/[\\/]+/).filter(Boolean);
const srcFolder = p => { const s = srcParts(p); return s.length > 1 ? s[s.length - 2] : String(p); };
const srcName = p => srcParts(p).pop() || String(p);
const srcShort = p => { const s = srcParts(p); return s.length > 3 ? [s[0], '…', s[s.length - 2], s[s.length - 1]].join(String.fromCharCode(92)) : String(p); };   // C:\…\Downloads\CV 1.1.pdf: the drive, the folder and the name
function attFromBit(a) {   // the row: "From Downloads" (or nothing when the vault copy goes first, or NeuroVault made the file)
  const src = attSrc(a); if (!src || ATTF.first !== 'source') return '';
  return src.exists ? `From ${srcFolder(src.path)}` : `From ${srcFolder(src.path)} (moved or deleted)`;
}
function attWhereHtml(a) {   // the details: the original, then the vault copy (or the other way round)
  const src = attSrc(a), f = esc(a.file);
  const copy = `<button class="link-btn att-loc" data-act="att-reveal-copy" data-v="${f}" title="Show the vault copy in File Explorer"><span class="att-loc-k">Vault copy</span><span class="att-loc-p code truncate">${f}</span></button>`;
  if (!src) return `<div class="eyebrow">Where it is</div><div class="att-where">${copy}</div>`;
  const p = esc(src.path), orig = src.exists
    ? `<button class="link-btn att-loc" data-act="att-reveal-src" data-v="${f}" title="Show the original in File Explorer: ${p}"><span class="att-loc-k">Original</span><span class="att-loc-p code truncate">${esc(srcShort(src.path))}</span></button>`
    : `<div class="att-loc is-gone" title="${p}"><span class="att-loc-k">Original</span><span class="att-loc-p code truncate">${esc(srcShort(src.path))}</span><span class="chip chip--warning" title="It was moved or deleted outside NeuroVault; the vault copy is still here">Moved or deleted</span></div>`;
  return `<div class="eyebrow">Where it is</div><div class="att-where">${ATTF.first === 'vault' ? copy + orig : orig + copy}</div>`;
}
const attRevealSrcFirst = a => ATTF.first === 'source' && !!attSrc(a)?.exists;
const attRevealTitle = a => attRevealSrcFirst(a) ? `Show the original in File Explorer: ${attSrc(a).path}` : 'Show the vault copy in File Explorer';
function attReveal(file, which) {   // which: 'src' | 'copy' | undefined (the one shown first)
  const a = attByFile(file) || { file }, src = attSrc(a), toSrc = which === 'src' || (which !== 'copy' && attRevealSrcFirst(a));
  if (!realData()) { toast(toSrc ? `Shows the original, ${src.path}, in File Explorer` : `Shows ${file} in File Explorer`); ATTF.last = toSrc ? 'src' : 'copy'; return; }
  nv(toSrc ? 'attachment_reveal_source' : 'attachment_reveal', file).then(r => { if (failed(r)) toast(r.message); });
}
function attOpenedFrom(n) {   // a note opened from a .md / .txt file: where that file is
  const src = (D.attFrom || {})[rawId(n.id)] || (D.attFrom || {})[n.id]; if (!src) return '';
  const p = esc(src.path), k = `note:${rawId(n.id)}`;
  return `<div class="att-opened list-item-sub">${src.exists ? `Opened from <button class="link-btn" data-act="att-reveal-src" data-v="${esc(k)}" title="Show ${p} in File Explorer">${esc(srcName(src.path))}</button> in ${esc(srcFolder(src.path))}`
    : `Opened from <span title="${p}">${esc(srcName(src.path))}</span> in ${esc(srcFolder(src.path))} <span class="chip chip--warning">Moved or deleted</span>`}</div>`;
}
app.addEventListener('click', e => {
  const b = e.target.closest?.('[data-act="att-reveal-src"], [data-act="att-reveal-copy"]'); if (!b) return; e.stopImmediatePropagation();
  const v = b.dataset.v, src = b.dataset.act === 'att-reveal-src';
  if (v.startsWith('note:')) { if (realData()) nv('attachment_reveal_source', v).then(r => { if (failed(r)) toast(r.message); }); else toast('Shows the file it was opened from in File Explorer'); return; }
  attReveal(v, src ? 'src' : 'copy');
}, true);
VAULT_PAGE.push(() => `<div class="set-row att-first-set"><div><div class="set-label" id="att-first">Show first</div><div class="set-desc">Opening, attaching, dropping or converting a file makes a copy; the original stays where it was. Where a file’s location is shown (the Attachments tab, its details, Show in File Explorer), which comes first</div></div>
  <div class="seg" role="group" aria-labelledby="att-first">${[['source', 'Where it came from'], ['vault', 'The vault copy']].map(([v, l]) => `<button class="seg-opt" data-act="att-first" data-v="${v}" aria-pressed="${ATTF.first === v}">${l}</button>`).join('')}</div></div>`);
app.addEventListener('click', e => {
  const b = e.target.closest?.('[data-act="att-first"]'); if (!b) return; e.stopImmediatePropagation(); ATTF.first = b.dataset.v;
  if (!CHECK) saveSettings({ attach_show_first: ATTF.first }); else (ATTF.saved ||= []).push(ATTF.first);
  status(ATTF.first === 'source' ? 'Files show where they came from first' : 'Files show the vault copy first'); S.focus = { sel: `[data-act="att-first"][data-v="${ATTF.first}"]` }; renderAll();
}, true);
{ const af0 = readerFromConfig;
  readerFromConfig = function (c) { af0(c); if (!CHECK && ['source', 'vault'].includes(c.attach_show_first)) ATTF.first = c.attach_show_first; };   // eslint-disable-line no-global-assign
}
// the sample vault (no app): the quote PDF was attached from Downloads
SAMPLE_ATTS[4].source = { path: 'C:\\Users\\you\\Downloads\\audit-quote.pdf', exists: true, how: 'attach' };
(D.atts || []).forEach(a => { if (a.file === SAMPLE_ATTS[4].file && !a.source) a.source = { ...SAMPLE_ATTS[4].source }; });
/* ==== end Build M · QC 68 ==== */

/* ==== Build M · QC 88 (design profile: "Removing an attachment only takes it out of the app"): the Timeline's Restore puts a
   removed file back (its lines into the notes it was taken out of, its thoughts' recording) and shows it again ==== */
async function attRestore(id) {
  const ev = (D.events || []).find(e => e.restoreId === id), name = ev?.file || 'The file';
  if (!realData()) { if (ev) { ev.restored = true; ev.desc = `Restored · ${name} is back`; } status(`Restored ${name}`); renderAll(); return; }
  const r = await nv('restore_attachment', id); if (failed(r)) { toast(r.message || `${name} couldn't be restored`); return; }
  for (const nid of r.notes || []) await doLoadNote(nid);   // the notes it went back into, as saved
  if ((r.inbox || []).length && typeof loadCapture === 'function') await loadCapture();
  await refreshAtts(); S.bm.actAt = 0; await bmActivity();
  const first = r.notes?.length ? D.notes.find(n => n.id === 'n-' + r.notes[0]) : null;
  status(`Restored ${attBase(r.file)}${first ? ` to “${first.title}”${r.notes.length > 1 ? ` and ${r.notes.length - 1} more` : ''}` : ''}`); renderAll();
}
app.addEventListener('click', e => { const b = e.target.closest?.('[data-act="att-restore"]'); if (!b) return; e.stopImmediatePropagation(); attRestore(+b.dataset.v); }, true);
/* ==== end Build M · QC 88 ==== */
