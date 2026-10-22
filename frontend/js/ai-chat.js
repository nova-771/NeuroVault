/* ==== Build N round 6 · Ask about this note as a chat (mockup R50; the user's locks and answers, 2026-10-18) ====
   Locked: r50ask = chat, r50win = dock (float stays a choice), r50model = one, r50insert = menu; answers: r43-cancel (a real
   stop), r50-esc (a setting, Esc stops the answer first). Design profile: "Asking AI feels like a chat" and "How the chat behaves".
   - One conversation per note: your questions as quiet bubbles on the right, answers as plain text on the left, one roomy
     input with send inside it, and one control under it, "This note · <model>", for where answers come from and the model.
   - It opens docked on the right (the note makes room and the right sidebar steps aside); drag its left edge to resize, and
     the width is kept (ai_chat_dock_w). The head's icon floats it: a free window you drag by its head and resize from any edge
     or corner, kept on screen, its place kept (ai_chat_rect). ai_chat_mode says which.
   - The words arrive as the model writes them (ai_job's partial). Stop, or Esc, really stops the model (ai_job_cancel closes
     its connection) and keeps what came, marked "Stopped". Esc closes instead when Settings → AI models says so (ai_chat_esc).
   - The newest answer's actions are always under it (R51 r50-acts); earlier ones show on hover or focus: Copy, Insert ▾ (At
     the cursor, At the top as a callout; with Undo), Ask again ▾ (another model; both answers kept, ‹ 1 / 2 ›).
   - Build N parity round (mockups R51, R52; decisions R50-R52), in the labelled block at the end and the parts marked "parity":
     follow-ups send the whole chat (or the last N, Settings → Follow-ups send), with a context meter beside Send that turns
     amber at 80% and a "nearly full" line offering New chat; a full chat keeps going, the oldest turns dropped. New chat keeps
     the last one in Earlier chats (the clock in the head), read only, with "Carry on from it" and Undo. Settings → AI models:
     the "Ask about this note" card, and "AI in NeuroVault" On/Off (Off hides every AI control). Side panels: Build M.
   This replaces R46's Ask popover (ai-notes.js keeps the summary, Tidy up and the shared helpers). */
'use strict';
Object.assign(ICON, {   // wireframe, from mockup R50
  r50send: '<path d="M12 19V5M5 12l7-7 7 7"/>',
  r50float: '<rect x="3" y="4" width="18" height="16" rx="2"/><rect x="11" y="11" width="7" height="6" rx="1"/>',
  r50globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>',
  r50sliders: '<path d="M4 7h9M17 7h3M4 17h3M11 17h9"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="17" r="2"/>',
  r50at: '<path d="M9 4h6M9 20h6M12 4v16"/><path d="M17 12h4M19 10v4"/>',
  r50top: '<path d="M4 4h16M12 20V9M7 13l5-5 5 5"/>',
  r50tick: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  r50stop: '<rect x="6" y="6" width="12" height="12" rx="2"/>' });
if (!ICON.grip) ICON.grip = '<circle cx="9" cy="6" r="1"/><circle cx="15" cy="6" r="1"/><circle cx="9" cy="12" r="1"/><circle cx="15" cy="12" r="1"/><circle cx="9" cy="18" r="1"/><circle cx="15" cy="18" r="1"/>';

const AIC_MIN = { w: 360, h: 380 }, AIC_DEF = { w: 440, h: 580 }, AIC_DOCK = { min: 320, def: 400, max: 640 }, AIC_TOP = 40, AIC_POLL = 250;
const AIC = { open: false, mode: 'dock', dockW: AIC_DOCK.def, rect: null, esc: 'stop', scope: 'note', chats: {}, drafts: {}, busy: null, menu: null,
  unread: false, stick: true, copied: null, caret: null, seq: 0, focus: null,
  follow: 'note', hist: 'whole', histN: 6, newHow: 'fresh', aiOn: true, past: {}, viewing: null, toTop: false };   // parity
const aicChat = id => AIC.chats[id] ||= { turns: [] };
const aicKey = n => AIC.follow === 'keep' ? '_keep' : n.id;   // parity: "Opening another note: keeps this chat" shares one chat
const aicBusyHere = n => !!AIC.busy && AIC.busy.key === aicKey(n);
const aicHere = () => UI.view === 'notes' && !!note();
const aicTip = (label, extra = '') => `aria-label="${esc(label)}" data-tip="${esc(label)}"${extra}`;
const aicSecs = t0 => Math.max(1, Math.round((Date.now() - t0) / 1000));
// The answer's Markdown, with the general-knowledge part set apart under a small label: a word and an icon, never colour alone
function aicMd(text) {
  const s = String(text || ''), m = /not from your notes?\s*:/i.exec(s);
  if (!m) return ainMd(s);
  return (m.index ? ainMd(s.slice(0, m.index)) : '') + `<div class="aic-gk" role="note" aria-label="Not from your note"><span class="aic-gk-tag">${ic('r50globe')}Not from your note</span>${ainMd(s.slice(m.index + m[0].length).trim())}</div>`;
}
const aicDockW = () => clamp(AIC.dockW || AIC_DOCK.def, AIC_DOCK.min, Math.max(AIC_DOCK.min, Math.min(AIC_DOCK.max, Math.round(app.offsetWidth * .5))));
function aicBox() {   // the free window: the first time under its icon; then where you left it; always on screen, never over the window bar
  const W = app.offsetWidth, H = app.offsetHeight, maxW = Math.max(AIC_MIN.w, Math.min(960, W - 16)), maxH = Math.max(AIC_MIN.h, Math.min(900, H - AIC_TOP - 8));
  let b = AIC.rect && AIC.rect.w ? { ...AIC.rect } : null;
  if (!b) { const btn = app.querySelector('[data-act="ain-ask"]'), ar = app.getBoundingClientRect(), z = ar.width / W || 1, r = btn?.getBoundingClientRect();
    const w = AIC_DEF.w, top = r ? (r.bottom - ar.top) / z + 6 : 96, h = Math.max(AIC_MIN.h, Math.min(AIC_DEF.h, H - top - 8));
    b = { x: r ? (r.left + r.width / 2 - ar.left) / z - w / 2 : W - w - 24, y: top, w, h }; }
  b.w = clamp(b.w, AIC_MIN.w, maxW); b.h = clamp(b.h, AIC_MIN.h, maxH);
  b.x = clamp(b.x, 8, Math.max(8, W - b.w - 8)); b.y = clamp(b.y, AIC_TOP, Math.max(AIC_TOP, H - b.h - 8));
  return b;
}
const aicSave = patch => { if (api() && !AIN_CHECK) saveSettings(patch); };
const aicPh = n => { const b = AIC.busy, other = b && b.key !== aicKey(n) ? D.notes.find(x => x.id === b.noteId) : null;
  return !ainOn() ? AIN_OFF : other ? `Answering in “${other.title}”: wait, or stop it there` : aicChat(aicKey(n)).turns.length ? 'Ask a follow-up…' : `Ask about ${AIC.scope === 'all' ? 'your newest notes' : 'this note'}…`; };

/* ---- What it looks like ---- */
function aicActs(t, a, i, ro) {
  const open = k => AIC.menu?.kind === k && AIC.menu.i === i, b = (cls = '') => `class="icon-btn icon-btn--sm aic-tip${cls}"`, copied = AIC.copied === i;
  const pager = t.answers.length > 1 ? `<span class="aic-pager" role="group" aria-label="Answers to this question"><button class="icon-btn" data-act="aic-alt" data-v="${i}" data-d="-1" aria-label="Earlier answer" ${t.at ? '' : 'disabled'}>${ic('left')}</button><span class="num">${t.at + 1} / ${t.answers.length}</span><button class="icon-btn" data-act="aic-alt" data-v="${i}" data-d="1" aria-label="Later answer" ${t.at < t.answers.length - 1 ? '' : 'disabled'}>${ic('right')}</button></span>` : '';
  return `<div class="aic-acts" role="group" aria-label="This answer">
    <button ${b(copied ? ' is-done' : '')} data-act="aic-copy" data-v="${i}" ${aicTip(copied ? 'Copied' : 'Copy as Markdown')}>${ic(copied ? 'r50tick' : 'copy')}</button>
    ${ro ? '' : `<button ${b()} data-act="aic-menu" data-v="ins" data-i="${i}" data-aic-opener="ins:${i}" aria-haspopup="menu" aria-expanded="${open('ins')}" ${aicTip('Insert into the note')}>${ic('listplus')}</button>
    <button ${b()} data-act="aic-menu" data-v="again" data-i="${i}" data-aic-opener="again:${i}" aria-haspopup="menu" aria-expanded="${open('again')}" ${aicTip('Ask again with another model')}>${ic('rotate')}</button>`}${pager}
    <span class="aic-meta">${esc(a.by || '')}${a.where ? ` · ${esc(a.where)}` : ''}${a.secs ? ` · <span class="num">${a.secs} s</span>` : ''}</span></div>`;
}
function aicTurnHtml(t, i, all, ro) {
  const a = t.answers[t.at] || {}, newest = all && i === all.length - 1;
  let body;
  if (a.pending === 'think') body = `<div class="aic-think" role="status"><span class="aic-dots" aria-hidden="true"><i></i><i></i><i></i></span><span>Thinking</span><span class="aic-secs num" data-aic-secs="${a.t0}">${aicSecs(a.t0)} s</span></div>`;
  else if (a.pending === 'stream') body = `<div class="aic-body" data-aic-live aria-busy="true">${aicMd(a.text)}<span class="aic-caret" aria-hidden="true"></span></div>`;
  else if (a.lock && a.err && !ro) body = lkChatCard(a, i);   // R68: a kept-off note: say so and offer (ai-lock.js)
  else if (a.err && ro) body = `<div class="aic-err-text">${ic('alert')}<span>${esc(a.by || 'The model')} couldn’t answer: ${esc(a.err)}</span></div>`;
  else if (a.err) body = `<div class="aic-err" role="alert"><div class="aic-err-text">${ic('alert')}<span>${esc(a.by || 'The model')} couldn’t answer: ${esc(a.err)}</span></div><div class="aic-err-acts"><button class="btn btn--secondary btn--sm" data-act="aic-retry" data-v="${i}">${ic('rotate')}Try again</button><button class="btn btn--ghost btn--sm" data-act="aic-menu" data-v="again" data-i="${i}" data-aic-opener="again:${i}" aria-haspopup="menu" aria-expanded="${AIC.menu?.kind === 'again' && AIC.menu.i === i}">Ask another model${ic('down')}</button></div></div>`;
  else body = `<div class="aic-body">${a.text ? aicMd(a.text) : ''}</div>${a.kept ? lkKeptLine(a) : ''}${a.stopped ? `<div class="aic-stopped">${a.text ? 'Stopped: this is as far as it got.' : 'Stopped before it started.'}</div>` : ''}`;
  return `<div class="aic-turn${newest ? ' is-newest' : ''}" data-aic-turn="${i}"><div class="aic-q">${esc(t.q)}${t.scope === 'all' ? '<span class="aic-qscope">from my newest notes</span>' : ''}</div>
    <div class="aic-a" data-aic-a="${i}">${body}${a.pending || a.err ? '' : aicActs(t, a, i, ro)}</div></div>`;
}
const AIC_SUGS = ['Summarise this note', 'What’s left to do?', 'Which questions are still open?'];
function aicControl(off) {   // r50model "one": one control under the input, "This note · Qwen3.5 4B", opens scope and model
  const cur = ainCur('qa'), label = `${AIC.scope === 'all' ? 'My newest notes' : 'This note'} · ${off || !cur ? 'No model' : cur.name}`, open = AIC.menu?.kind === 'opts';
  return `<button class="aic-chip aic-tip" data-act="aic-menu" data-v="opts" data-aic-opener="opts" aria-haspopup="menu" aria-expanded="${open}"${off ? ' aria-disabled="true"' : ''} aria-label="${esc(off ? AIN_OFF : `Where answers come from, and the model: ${label}`)}" data-tip="${esc(off ? AIN_OFF : 'Where answers come from, and the model')}">${ic('r50sliders')}<span>${esc(label)}</span>${ic('down')}</button>`;
}
function aicHtml(where) {
  const n = note(); if (!n) return '';
  const key = aicKey(n), cur = aicChat(key), v = aicViewed(n), c = v || cur, ro = !!v, off = !ainOn(), here = aicBusyHere(n), other = AIC.busy && !here, draft = AIC.drafts[key] || '';
  const dock = where === 'dock', about = AIC.scope === 'all' ? 'your newest notes' : `“${n.title}”`, past = (AIC.past[key] || []).length, histOpen = AIC.menu?.kind === 'hist';
  const head = `<div class="aic-head"${dock ? '' : ' data-aic-drag tabindex="0" aria-label="Move the chat: drag it, or use the arrow keys. Shift + arrow keys resize it" title="Drag to move. Pull any edge or corner to resize"'}>${dock ? '' : ic('grip')}<span class="aic-title" id="aic-t">Ask</span><span class="aic-about" title="Answers come from ${esc(about)}">about ${esc(about)}</span>
    <button class="icon-btn aic-tip" data-act="aic-menu" data-v="hist" data-aic-opener="hist" aria-haspopup="menu" aria-expanded="${histOpen}"${ro ? ' aria-pressed="true"' : ''} aria-label="Earlier chats${past ? ` (${past})` : ''}" data-tip="Earlier chats">${ic('history')}</button>
    <button class="icon-btn aic-tip" data-act="aic-new" ${aicTip('New chat', (cur.turns.length || cur.carry) && !here && !ro ? '' : ' disabled')}>${ic('edit')}</button>
    <button class="icon-btn aic-tip" data-act="aic-dock" ${aicTip(dock ? 'Float it: a free window' : 'Dock it on the right')}>${ic(dock ? 'r50float' : 'panel')}</button>
    <button class="icon-btn aic-tip" data-act="aic-close" ${aicTip('Close: the conversation is kept')}>${ic('x')}</button></div>`;
  const hello = `<div class="aic-hello"><div class="aic-hello-t">Ask anything about ${esc(about)}</div><div class="aic-hello-sub">Answers come from ${AIC.scope === 'all' ? 'your newest notes' : 'this note'} first${AIN.askMode !== 'notes' ? ', then general knowledge, labelled “Not from your note”' : ' only'}. Nothing goes into the note unless you press Insert.</div>
    <div class="aic-sugs" role="group" aria-label="Try asking">${AIC_SUGS.map(s => `<button class="aic-sug" data-act="aic-sug" data-v="${esc(s)}"${off || other ? ' disabled' : ''}>${ic('chat')}<span>${esc(s)}</span></button>`).join('')}</div></div>`;
  const ctx = ro ? null : aicCtx(n, cur), full = ctx && ctx.pct >= 100;
  const cap = c.turns.length && !ro ? `<div class="aic-capnote">${AIC.hist === 'last' ? `Follow-ups send the last ${AIC.histN} questions and answers` : 'Follow-ups send the whole chat'}${full ? ' · the oldest no longer fit' : ''}</div>` : '';
  const band = ro ? `<div class="aic-band">${ic('r51lock')}<span>An earlier chat, ${esc(v.date)} · ${v.n} question${v.n === 1 ? '' : 's'} · read only</span></div>` : '';
  const carry = c.carry ? `<details class="aic-carry"${ro ? '' : ' open'}><summary>${ic('r51sum')}${ro ? 'It began with a summary of an earlier chat' : 'Carried over: a summary of your last chat'}</summary><div class="aic-carry-body">${esc(c.carry)}</div></details>` : '';
  const offNote = off ? `<div class="aic-off" role="status"><b>Ask is paused: no AI is set up.</b><span class="set-desc">Start a model on this PC, or turn on Ollama or LM Studio, in Settings → AI models. Your conversation is kept.</span><button class="btn btn--secondary btn--sm" data-act="aic-setup">${ic('gear')}Open AI models</button></div>` : '';
  const thread = `<div class="aic-thread" role="log" aria-label="${ro ? 'An earlier chat' : 'Conversation'} about ${esc(about)}" data-aic-thread>${band}${carry}${c.turns.length ? cap + c.turns.map((t, i, all) => aicTurnHtml(t, i, all, ro)).join('') : off || ro ? '' : hello}${ro ? '' : offNote}
    <button class="aic-newest" data-act="aic-newest" hidden>${ic('down')}Newest</button></div>`;
  const send = here ? `<button class="aic-send is-stop aic-tip" data-act="aic-stop" ${aicTip(AIC.esc === 'stop' ? 'Stop answering (Esc)' : 'Stop answering')}>${ic('r50stop')}</button>`
    : `<button class="aic-send aic-tip" data-act="aic-send" ${aicTip(off ? AIN_OFF : other ? 'One answer at a time' : 'Ask (Enter) · Shift+Enter: new line')}${off || other || !draft.trim() ? ' aria-disabled="true"' : ''}>${ic('r50send')}</button>`;
  const fullLine = ctx && !off && ctx.pct >= 80 && cur.turns.length ? aicFullLine(ctx.pct) : '';
  const compose = ro ? `<div class="aic-compose"><div class="aic-ro-bar" role="group" aria-label="An earlier chat">${ic('r51lock')}<span>Read only. Carry on from it in a new chat, with its summary.</span><button class="btn btn--secondary btn--sm" data-act="aic-continue">Carry on from it</button><button class="btn btn--primary btn--sm" data-act="aic-hist-cur">Back to the current chat</button></div></div>`
    : `${fullLine}<div class="aic-compose">${avxTop()}<div class="aic-box${off ? ' is-off' : ''}">${avxIn()}<textarea class="aic-in" id="aic-in" data-aic-in rows="2" maxlength="4000" placeholder="${esc(aicPh(n))}" aria-label="Your question" ${off || other ? 'disabled' : ''}>${esc(draft)}</textarea><div class="aic-row">${aicControl(off)}<span class="aic-grow"></span>${off ? '' : aicMeter(ctx)}${avxRow(!!AIC.busy)}${send}</div></div>${avxBelow()}</div>`;   // Build N (R69): ask-voice.js draws the mic, the live words, the hint and the cards
  const rz = dock ? '' : ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'].map(d => `<span class="aic-rz aic-rz--${d}" data-aic-rz="${d}" aria-hidden="true"></span>`).join('');
  // Build N (R54): docked, the chat is the right sidebar's Ask tab, its panel under the tabs (the sidebar's own edge resizes it)
  if (dock) return `<section class="card aic-win aic-win--dock aic-win--tab" role="tabpanel" id="insp-panel" aria-labelledby="insp-tab-ask" data-aic-win>${head}${thread}${compose}</section>`;
  const b = aicBox();
  return `<div class="card aic-win aic-win--float" role="dialog" aria-labelledby="aic-t" data-aic-win style="left:${b.x}px;top:${b.y}px;width:${b.w}px;height:${b.h}px">${head}${thread}${compose}${rz}</div>`;
}
function aicMenuHtml() {
  const mn = AIC.menu; if (!mn || !AIC.open || !aicHere()) return '';
  const tick = on => `<span class="aic-tick" aria-hidden="true">${on ? ic('r50tick') : ''}</span>`, sep = '<div class="menu-sep"></div>';
  const models = (cur, act) => ainModels().map(m => `<button class="menu-item" role="menuitemradio" aria-checked="${cur === m.key}" data-act="${act}" data-v="${m.key}"${m.ok ? '' : ` aria-disabled="true" title="${esc(m.why)}"`}>${tick(cur === m.key)}<span class="truncate">${esc(m.name)}</span><span class="aic-where">${esc(m.ok ? m.where : (m.off || 'off'))}</span></button>`).join('');   // R68: a cloud model in a kept-off note says "kept off here"   // v0.1.1 should-fix 7: a model that isn't on says "off" (its tooltip says why), never cut to "not ru…"
  const ch = ainChoice('qa'), auto = ainRoute('qa');
  let body = '', label = '';
  if (mn.kind === 'opts') { label = 'Where answers come from, and the model';
    body = `<div class="aic-mlabel">Answer from</div>${[['note', 'This note'], ['all', 'My newest notes']].map(([v, l]) => `<button class="menu-item" role="menuitemradio" aria-checked="${AIC.scope === v}" data-act="aic-scope" data-v="${v}">${tick(AIC.scope === v)}<span class="truncate">${l}</span></button>`).join('')}
      <button class="menu-item" role="menuitemcheckbox" aria-checked="${AIN.askMode !== 'notes'}" data-act="aic-gk">${tick(AIN.askMode !== 'notes')}<span class="truncate">Then general knowledge</span><span class="aic-where">labelled</span></button>${sep}
      <div class="aic-mlabel">Model for Ask</div><button class="menu-item" role="menuitemradio" aria-checked="${ch === 'auto'}" data-act="aic-model" data-v="auto">${tick(ch === 'auto')}<span class="truncate">Automatic</span><span class="aic-where">${esc(ch === 'auto' ? ainName(auto) : '')}</span></button>${models(ch, 'aic-model')}${sep}
      <button class="menu-item" role="menuitem" data-act="aic-setup">${tick(false)}<span class="truncate">AI models…</span></button>`; }
  else if (mn.kind === 'ins') { const ok = AIC.caret && AIC.caret.noteId === note()?.id; label = 'Insert into the note';
    body = `<button class="menu-item" role="menuitem" data-act="aic-ins" data-how="cursor" data-v="${mn.i}"${ok ? '' : ' aria-disabled="true" title="Click in the note where it should go first"'}>${ic('r50at')}<span class="truncate">At the cursor</span>${ok ? '' : '<span class="aic-where">click in the note first</span>'}</button>
      <button class="menu-item" role="menuitem" data-act="aic-ins" data-how="top" data-v="${mn.i}">${ic('r50top')}<span class="truncate">At the top, as a callout</span></button>`; }
  else if (mn.kind === 'hist') { label = 'Earlier chats'; body = aicHistMenu(); }
  else if (mn.kind === 'again') { const t = aicChat(aicKey(note())).turns[mn.i], cur = t?.answers[t.at]?.key; label = 'Ask again with'; body = `<div class="aic-mlabel">Ask again with</div>${models(cur, 'aic-again')}`; }
  return `<div class="menu card aic-menu${mn.kind === 'hist' ? ' aic-menu--hist' : ''}" role="menu" aria-label="${label}" data-aic-menu>${body}</div>`;
}

/* ---- Asking: it thinks, then the words arrive; Stop keeps what came; one answer at a time ---- */
function aicHistory(c, scope, upto = c.turns.length) {   // parity: the chat's earlier questions and answers in this scope, all of them or the last N (the backend keeps what fits)
  const h = c.turns.slice(0, upto).filter(t => t.scope === scope).map(t => ({ q: t.q, a: (t.answers[t.at] || {}).text || '' })).filter(x => x.a.trim());
  const sent = AIC.hist === 'last' ? h.slice(-AIC.histN) : h;
  return c.carry ? [{ q: 'What did we talk about in my last chat?', a: c.carry }, ...sent] : sent;
}
async function aicAsk(n, q, opt = {}) {
  q = String(q || '').trim(); if (!q || AIC.busy || !ainOn() || !api()) return;
  const key = aicKey(n), c = aicChat(key), scope = opt.turn ? opt.turn.scope : AIC.scope;
  const t = opt.turn || { q, scope, answers: [], at: 0 }; if (!opt.turn) c.turns.push(t);
  const idx = c.turns.indexOf(t), cur = ainCur('qa'), a = { pending: 'think', text: '', t0: Date.now(), by: cur?.name || '', where: cur?.where || '', key: ainChoice('qa') };
  t.answers.push(a); t.at = t.answers.length - 1;
  const seq = ++AIC.seq; AIC.busy = { noteId: n.id, key, ans: a, job: null, seq }; AIC.stick = true; AIC.viewing = null; AIC.drafts[key] = opt.turn ? AIC.drafts[key] : '';
  AIC.focus = '#aic-in'; renderAll();
  const r = await nv('ai_ask', q, scope === 'note' ? rawId(n.id) : null, scope === 'note' ? ainEditorText(n) : null, aicHistory(c, scope, idx));
  if (AIC.busy?.seq !== seq) { if (!failed(r) && r.job) nv('ai_job_cancel', r.job); return; }   // stopped before it had its id
  if (failed(r)) { aicEnd(a, { err: r.message || "That didn't work." }); return; }
  AIC.busy.job = r.job;
  const t0 = Date.now();
  while (Date.now() - t0 < 300000) {
    await new Promise(ok => setTimeout(ok, AIN_CHECK ? 5 : AIC_POLL));
    if (AIC.busy?.seq !== seq) return;
    const j = await nv('ai_job', r.job); if (AIC.busy?.seq !== seq) return;
    if (failed(j)) { aicEnd(a, { err: j.message }); return; }
    if (j.state === 'running') { if (j.partial && j.partial !== a.text) aicLive(a, j.partial); continue; }
    if (j.state === 'done') { aicEnd(a, { text: j.result.answer, by: j.result.by, general: !!j.result.general, dropped: j.result.dropped || 0, kept: j.result.kept_off || '' }); return; }   // R68: kept = answered on this PC because the note is kept off cloud AI
    if (j.state === 'error') {   // R68: kept off cloud AI (a notice with its buttons), or the first-use question (ai-lock.js)
      aicEnd(a, { err: j.message, lock: j.code ? { ...(j.lock || {}), code: j.code } : null });
      if (j.code === 'cloud_first') lkFirst(j, () => lkRetryTurn(n.id, t), () => { a.lock = null; a.err = 'Nothing was sent: you chose not to send these notes to the cloud.'; renderAll(); });
      return; }
    if (j.state === 'cancelled') { aicEnd(a, { stopped: true }); return; }
  }
  aicEnd(a, { err: 'The model took too long.' });
}
function aicLive(a, text) {   // the words so far, written in place (no redraw, so the input keeps its caret)
  const first = a.pending !== 'stream'; a.pending = 'stream'; a.text = text;
  const el = app.querySelector('[data-aic-live]');
  if (first || !el) { renderAll(); return; }
  const th = app.querySelector('[data-aic-thread]'), stick = th && th.scrollHeight - th.scrollTop - th.clientHeight < 48;
  el.innerHTML = aicMd(text) + '<span class="aic-caret" aria-hidden="true"></span>';
  if (th && stick) th.scrollTop = th.scrollHeight;
}
function aicEnd(a, o) {
  Object.assign(a, o); if (o.err) a.text = a.text || ''; a.pending = null; a.secs = aicSecs(a.t0); AIC.busy = null;
  if (!aicShown()) AIC.unread = true;   // R54: closed, behind another tab, or the sidebar hidden: a dot on the header's icon
  if (!o.stopped) status(o.err ? 'The answer didn’t come: see the chat' : `Answer ready · by ${a.by}`);
  renderAll();
}
async function aicStop() {   // a real stop: the model's connection is closed; what came is kept, marked "Stopped"
  const b = AIC.busy; if (!b) return; AIC.busy = null; AIC.seq++;
  const a = b.ans; a.pending = null; a.stopped = true; a.secs = aicSecs(a.t0); renderAll();
  if (b.job && api()) { const r = await nv('ai_job_cancel', b.job); if (!failed(r) && r.partial && r.partial.length >= (a.text || '').length) { a.text = r.partial; renderAll(); } }
  status('Stopped: what came so far is kept');
}

/* ---- Insert ▾ (At the cursor, At the top as a callout), with Undo; Copy; New chat with Undo ---- */
function aicInsert(i, how) {
  const n = note(), t = aicChat(aicKey(n)).turns[i], a = t?.answers[t.at]; if (!a?.text) return;
  if (how === 'top') { const before = { md: n.md };
    hold({ msg: `Answer added to the top of “${n.title}”, as a callout`, apply: () => ainInsert({ text: a.text, by: a.by, q: t.q }, n), undo: () => aicUnInsert(n, before), commit: () => Promise.resolve(null), back: 'Taken out of the note' }); return; }
  const doc = liveDoc(n), cur = AIC.caret;
  if (!doc?.isContentEditable || !cur || cur.noteId !== n.id) { status('Click in the note where it should go, then Insert'); renderAll(); return; }
  const before = { md: (n.docDirty && syncDoc(n), n.md) };
  hold({ msg: `Answer added to “${n.title}” at the cursor`, back: 'Taken out of the note', commit: () => Promise.resolve(null), undo: () => aicUnInsert(n, before),
    apply: () => { const d = liveDoc(n); if (!d) return; edRecord(d, 'cmd'); const box = document.createElement('div'); box.innerHTML = aiGuardHtml(NVMarkdown.mdToHtml(a.text), 'inert');
      const after = d.children[Math.min(cur.index, d.children.length - 1)] || null, nodes = [...box.childNodes];
      if (after) after.after(...nodes); else d.append(...nodes);
      AIN.flash = { noteId: n.id, index: [...d.children].indexOf(nodes.find(x => x.nodeType === 1) || nodes[0]) }; edChanged(d); } });
}
function aicUnInsert(n, before) {   // Undo: the note as it was just before the insert (only if nothing else was typed since, else Ctrl+Z)
  if (n.docDirty) syncDoc(n);
  n.md = before.md; n.html = null; noteEdited(n);
}
function aicNew(how) {   // parity, QC 72 ("New chat starts quietly"): the chat goes to Earlier chats, read only; no toast and no Undo (the clock in the head has it)
  const n = note(); if (!n || aicBusyHere(n)) return; const key = aicKey(n), c = aicChat(key); if (!c.turns.length && !c.carry) return;
  const kept = c.turns, sum = (how || AIC.newHow) === 'summary' && kept.length;
  aicArchive(c, key); c.carry = sum ? aicSummary(kept) : null; c.turns = []; AIC.menu = null; AIC.viewing = null; AIC.stick = true; AIC.focus = '#aic-in'; renderAll();
}

/* ---- Where it's drawn: docked, as the right sidebar's Ask tab (R54: "when its opened it gets put into the tab in the sidebar"),
   or a free window over the app. Another tab hides the chat (its conversation is kept); the sidebar's collapse icon hides it all ---- */
const aicDocked = () => AIC.open && aicHere() && AIC.mode === 'dock' && AIC.aiOn;
const aicShown = () => AIC.open && aicHere() && (AIC.mode !== 'dock' || S.tab === 'ask' && UI.inspector !== 'hidden');
const aicTabs0 = inspTabs;
inspTabs = function () { const t = aicTabs0.apply(this, arguments); return aicDocked() ? [...t, ['ask', 'Ask', 'chat', 5]] : t; };   // eslint-disable-line no-global-assign
inspAsk = function () { return aicDocked() ? aicHtml('dock') : ''; };   // eslint-disable-line no-global-assign
const aicModal0 = renderModal;
renderModal = function () {   // eslint-disable-line no-global-assign
  const h = aicModal0.apply(this, arguments), ok = !S.modal || S.modal === 'dump' || S.modal === 'word';
  return h + (ok && AIC.open && aicHere() && AIC.mode === 'float' ? aicHtml('float') : '') + (ok ? aicMenuHtml() : '');
};
const aicHeader0 = renderHeader;
renderHeader = function () {   // eslint-disable-line no-global-assign
  const h0 = aicHeader0.apply(this, arguments);   // the chat icon says whether the chat is open, with a dot for an answer that came while it was closed
  const h = AIC.aiOn ? h0 : h0.replace(/<span class="ain-pair"[\s\S]*?<\/button><\/span>/, '');   // parity: AI off hides Summarise and Ask
  return h.replace(/(<button class="icon-btn ain-btn[^"]*" data-act="ain-ask"[^>]*?aria-expanded=")(true|false)("[^>]*>)([\s\S]*?)(<\/button>)/, (m, a, b, c, inner, e) => a + String(aicShown()) + c + inner + (AIC.unread && !aicShown() ? '<span class="ain-dot" aria-hidden="true"></span>' : '') + e);
};
const aicAfter0 = afterRender;
afterRender = function () {   // eslint-disable-line no-global-assign
  aicAfter0(); aicAfterWin();
};
function aicAfterWin() {   // QC 103: the chat's own window runs this after its draw too
  const win = app.querySelector('[data-aic-win]');
  if (win) {
    const ta = win.querySelector('#aic-in'); if (ta) aicGrow(ta);
    const th = win.querySelector('[data-aic-thread]'); if (th) { if (AIC.toTop) { th.scrollTop = 0; AIC.toTop = false; AIC.stick = false; } else if (AIC.stick || AIC.top == null) th.scrollTop = th.scrollHeight; else th.scrollTop = AIC.top; aicNewest(th); }
    if (AIC.focus) { const f = win.querySelector(AIC.focus); AIC.focus = null; if (f && !f.disabled) { f.focus({ preventScroll: true }); if (f.setSelectionRange) f.setSelectionRange(f.value.length, f.value.length); } }
  }
  if (AIC.unread && aicShown()) AIC.unread = false;   // seen: its tab is open again
  const m = app.querySelector('[data-aic-menu]'); if (m) aicPlaceMenu(m);
  aicTick();
}
function aicGrow(ta) { ta.style.height = 'auto'; ta.style.height = Math.min(160, Math.max(44, ta.scrollHeight)) + 'px'; }
function aicNewest(th) { const b = th.querySelector('.aic-newest'); if (!b) return; b.hidden = th.scrollHeight - th.scrollTop - th.clientHeight < 48; }
function aicPlaceMenu(m) {   // at its button: the input's control opens above it, the answer's below; 8px inside the window
  const k = AIC.menu, b = app.querySelector(`[data-aic-opener="${k.kind}${k.i != null ? ':' + k.i : ''}"]`); if (!b) { m.remove(); return; }
  const ar = app.getBoundingClientRect(), z = ar.width / app.offsetWidth || 1, r = b.getBoundingClientRect(), W = app.offsetWidth, H = app.offsetHeight;
  const bl = (r.left - ar.left) / z, bt = (r.top - ar.top) / z, bb = (r.bottom - ar.top) / z, mw = m.offsetWidth, mh = m.offsetHeight;
  const up = !!b.closest('.aic-compose'), fitsBelow = bb + 4 + mh <= H - 8, fitsAbove = bt - 4 - mh >= 8, below = up ? !fitsAbove && fitsBelow : fitsBelow || !fitsAbove;
  const P = m.offsetParent || app, pr = P.getBoundingClientRect(), px = (pr.left - ar.left) / z, py = (pr.top - ar.top) / z;
  Object.assign(m.style, { left: (clamp(bl, 8, Math.max(8, W - mw - 8)) - px) + 'px', top: ((below ? bb + 4 : Math.max(8, bt - 4 - mh)) - py) + 'px' }); m.dataset.side = below ? 'below' : 'above';
}
function aicTick() {   // the seconds while it thinks, counted in place
  clearInterval(aicTick.t); if (AIN_CHECK || !app.querySelector('[data-aic-secs]')) return;
  aicTick.t = setInterval(() => { const els = app.querySelectorAll('[data-aic-secs]'); if (!els.length) { clearInterval(aicTick.t); return; } els.forEach(e => { e.textContent = aicSecs(+e.dataset.aicSecs) + ' s'; }); }, 1000);
}

/* ---- Opening, closing, docking; the window's place and the dock's width (kept in config.json) ---- */
function aicOpen(on = !aicShown()) {   // R54: docked, opening adds the Ask tab, selected (the sidebar opens if it was hidden); closing goes back to your tab
  AIC.menu = null;
  if (on) { AIC.open = true; AIC.unread = false; AIC.stick = true; AIC.focus = '#aic-in'; AIN.askUi.open = false; if (AIC.mode === 'dock') aicToTab(); }
  else { AIC.open = false; aicFromTab(); S.focus = { sel: '[data-act="ain-ask"]' }; }
  renderAll();
}
function aicToTab() {
  if (S.tab !== 'ask') AIC.prevTab = S.tab; S.tab = 'ask';
  if (UI.inspector === 'hidden') { AIC.openedInsp = true; UI.inspector = 'shown'; document.body.dataset.inspector = 'shown'; }
  if (AIN.place === 'side') AIN.sum.open = false;   // the summary's side panel and the chat share the sidebar
}
function aicFromTab() {
  if (S.tab === 'ask') S.tab = AIC.prevTab && AIC.prevTab !== 'ask' ? AIC.prevTab : 'outline';
  if (AIC.openedInsp) { AIC.openedInsp = false; if (S.tab !== 'ask') { UI.inspector = 'hidden'; document.body.dataset.inspector = 'hidden'; } }   // as it was
}
const aicCfg0 = readFromConfig;
readFromConfig = function (c) {   // eslint-disable-line no-global-assign
  aicCfg0(c);
  if (c.ai_chat_mode === 'dock' || c.ai_chat_mode === 'float') AIC.mode = c.ai_chat_mode;
  if (Number.isFinite(+c.ai_chat_dock_w) && +c.ai_chat_dock_w) AIC.dockW = +c.ai_chat_dock_w;
  if (c.ai_chat_rect && c.ai_chat_rect.w) AIC.rect = c.ai_chat_rect;
  if (c.ai_chat_esc === 'stop' || c.ai_chat_esc === 'close') AIC.esc = c.ai_chat_esc;
  if (c.ai_chat_follow === 'note' || c.ai_chat_follow === 'keep') aicFollow(c.ai_chat_follow);   // parity
  if (c.ai_chat_hist === 'whole' || c.ai_chat_hist === 'last') AIC.hist = c.ai_chat_hist;
  if ([4, 6, 10, 20].includes(c.ai_chat_hist_n)) AIC.histN = c.ai_chat_hist_n;
  if (c.ai_chat_new === 'fresh' || c.ai_chat_new === 'summary') AIC.newHow = c.ai_chat_new;
  if (typeof c.ai_enabled === 'boolean') AIC.aiOn = c.ai_enabled;
};
// Settings → AI models: the "Ask about this note" card (parity, mockup R51): Esc, opening another note, follow-ups, New chat, where it opens
const aicRoute0 = aiRoute;
aiRoute = function () { return aicRoute0.apply(this, arguments) + aicCard(); };   // eslint-disable-line no-global-assign

/* ---- Clicks, keys, typing, dragging ---- */
app.addEventListener('click', e => {   // the note header's chat icon opens the chat (R46's popover is gone); greyed with no AI, ai-notes.js sends it to Settings first
  const b = e.target.closest?.('[data-act="ain-ask"]'); if (!b || b.hasAttribute('data-ain-off')) return;
  e.preventDefault(); e.stopImmediatePropagation(); AIN.sum.open = AIN.place !== 'popover' && AIN.sum.open; aicOpen();
}, true);
app.addEventListener('click', e => {   // R54: the right sidebar's collapse icon hides it all, the chat included (it stays open in its tab)
  if (e.target.closest?.('[data-act="inspector"]')) AIC.openedInsp = false;
}, true);
document.addEventListener('click', e => {   // a click away closes the chat's menus (R41)
  const t = e.target; if (!AIC.menu || !t?.closest || t.closest('[data-aic-menu]') || t.closest('[data-act="aic-menu"]')) return;
  AIC.menu = null; app.querySelectorAll('[data-aic-menu]').forEach(m => m.remove()); app.querySelectorAll('[data-aic-opener][aria-expanded="true"]').forEach(x => x.setAttribute('aria-expanded', 'false'));
}, true);
app.addEventListener('click', e => {
  const t = e.target.closest('[data-act]'); if (!t || !/^aic-/.test(t.dataset.act)) return;
  if (t.disabled || t.getAttribute('aria-disabled') === 'true' && !/^aic-(menu|send)$/.test(t.dataset.act)) return;
  const act = t.dataset.act, v = t.dataset.v, n = note(); if (!n && act !== 'aic-set' && act !== 'aic-ai') return;
  const key = n && aicKey(n), c = n ? aicViewed(n) || aicChat(key) : null;
  switch (act) {
    case 'aic-close': aicOpen(false); break;
    case 'aic-dock': AIC.mode = AIC.mode === 'dock' ? 'float' : 'dock'; if (AIC.mode === 'dock') aicToTab(); else aicFromTab(); aicSave({ ai_chat_mode: AIC.mode }); status(AIC.mode === 'dock' ? 'Ask is docked on the right' : 'Ask is a free window: drag its head, pull an edge to resize'); AIC.focus = '[data-act="aic-dock"]'; renderAll(); break;
    case 'aic-new': aicNew(v); break;
    case 'aic-hist-open': AIC.viewing = v; AIC.menu = null; AIC.toTop = true; status('An earlier chat, read only'); renderAll(); break;
    case 'aic-hist-cur': AIC.viewing = null; AIC.menu = null; AIC.stick = true; AIC.focus = '#aic-in'; renderAll(); break;
    case 'aic-continue': aicContinue(n); break;
    case 'aic-ai': aicAiSet(v === 'on'); break;
    case 'aic-setup': AIC.menu = null; openSettings('ai'); break;
    case 'aic-send': { if (t.getAttribute('aria-disabled') === 'true') { if (!ainOn()) openSettings('ai'); break; } const ta = app.querySelector('#aic-in'); aicAsk(n, ta ? ta.value : AIC.drafts[key]); break; }
    case 'aic-sug': aicAsk(n, v); break;
    case 'aic-stop': aicStop(); break;
    case 'aic-newest': { const th = app.querySelector('[data-aic-thread]'); if (th) { th.scrollTop = th.scrollHeight; AIC.stick = true; aicNewest(th); } break; }
    case 'aic-menu': { if (t.getAttribute('aria-disabled') === 'true') { openSettings('ai'); break; } const i = t.dataset.i != null ? +t.dataset.i : null; AIC.menu = AIC.menu?.kind === v && AIC.menu.i === i ? null : { kind: v, i }; renderAll(); break; }
    case 'aic-scope': AIC.scope = v; AIC.menu = null; status(v === 'all' ? 'Ask answers from your newest notes' : 'Ask answers from this note'); AIC.focus = '#aic-in'; renderAll(); break;
    case 'aic-gk': { const nv0 = AIN.askMode === 'notes' ? 'general' : 'notes'; AIN.askMode = nv0; aicSave({ ai_ask_mode: nv0 }); status(nv0 === 'notes' ? 'Ask answers only from your notes' : 'Ask answers from your notes, then general knowledge (labelled)'); renderAll(); break; }
    case 'aic-model': AIC.menu = null; ainSetRoute('qa', v).then(ok => { if (ok) status(`Ask about a note uses ${v === 'auto' ? 'the model in use' : ainModels().find(m => m.key === v)?.name || v} · Settings → AI models`); AIC.focus = '#aic-in'; renderAll(); }); renderAll(); break;
    case 'aic-copy': { const tt = c.turns[+v], a = tt?.answers[tt.at]; if (!a) break; ainCopy(a.text); AIC.copied = +v; clearTimeout(aicNew.t); aicNew.t = setTimeout(() => { AIC.copied = null; renderAll(); }, 1500); break; }
    case 'aic-ins': AIC.menu = null; aicInsert(+v, t.dataset.how); break;
    case 'aic-again': { const i = AIC.menu?.i, tt = c.turns[i]; AIC.menu = null; if (!tt) break; ainSetRoute('qa', v).then(ok => { if (ok) aicAsk(n, tt.q, { turn: tt }); }); renderAll(); break; }
    case 'aic-retry': { const tt = c.turns[+v]; if (!tt) break; tt.answers.splice(tt.at, 1); tt.at = Math.max(0, tt.answers.length - 1); aicAsk(n, tt.q, { turn: tt }); break; }
    case 'aic-alt': { const tt = c.turns[+v]; if (!tt) break; tt.at = clamp(tt.at + +t.dataset.d, 0, tt.answers.length - 1); renderAll(); break; }
    case 'aic-set': { const k = t.dataset.k; if (k === 'esc') { AIC.esc = v; aicSave({ ai_chat_esc: v }); status(v === 'stop' ? 'Esc stops an answer first' : 'Esc closes the chat; the answer carries on'); }
      if (k === 'mode') { AIC.mode = v; aicSave({ ai_chat_mode: v }); status(v === 'dock' ? 'Ask opens docked on the right' : 'Ask opens as a free window'); }
      if (k === 'follow') { aicFollow(v); aicSave({ ai_chat_follow: v }); status(v === 'keep' ? 'The chat you’re in stays open as you move between notes' : 'Each note keeps its own chat'); }
      if (k === 'hist') { AIC.hist = v; aicSave({ ai_chat_hist: v }); status(v === 'last' ? `Follow-ups send the last ${AIC.histN} questions and answers` : 'Follow-ups send the whole chat'); }
      if (k === 'new') { AIC.newHow = v; aicSave({ ai_chat_new: v }); status(v === 'summary' ? 'New chat starts with a summary of the last one' : 'New chat starts empty'); }
      S.focus = { sel: `[data-act="aic-set"][data-k="${k}"][data-v="${v}"]` }; renderAll(); break; }
  }
});
app.addEventListener('input', e => {
  if (!e.target.matches?.('[data-aic-in]')) return; const n = note(); if (!n) return; AIC.drafts[aicKey(n)] = e.target.value; aicGrow(e.target); aicMeterPaint(n);
  const s = app.querySelector('[data-act="aic-send"]'); if (s) s.setAttribute('aria-disabled', String(!ainOn() || !!AIC.busy || !e.target.value.trim()));
});
app.addEventListener('scroll', e => { if (!e.target.matches?.('[data-aic-thread]')) return; const th = e.target; AIC.stick = th.scrollHeight - th.scrollTop - th.clientHeight < 48; AIC.top = th.scrollTop; aicNewest(th); }, true);
document.addEventListener('keydown', e => {
  if (e.target.matches?.('[data-aic-in]') && e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); const n = note(); if (n && !AIC.busy) aicAsk(n, e.target.value); return; }
  if (e.key !== 'Escape' || !AIC.open || !aicHere() || S.modal && S.modal !== 'dump' && S.modal !== 'word') return;
  const inChat = !!e.target.closest?.('[data-aic-win], [data-aic-menu]');
  if (AIC.menu) { const k = AIC.menu; AIC.menu = null; AIC.focus = null; renderAll(); app.querySelector(`[data-aic-opener="${k.kind}${k.i != null ? ':' + k.i : ''}"]`)?.focus(); e.preventDefault(); e.stopImmediatePropagation(); return; }
  if (!inChat) return;
  e.preventDefault(); e.stopImmediatePropagation();
  if (AIC.viewing) { AIC.viewing = null; AIC.stick = true; AIC.focus = '#aic-in'; renderAll(); return; }   // parity: Esc leaves an earlier chat first
  if (aicBusyHere(note()) && AIC.esc === 'stop') { aicStop(); AIC.focus = '#aic-in'; return; }   // r50-esc: stops the answer first (the setting's default)
  aicOpen(false);
}, true);
// Insert at the cursor goes after the block the caret was last in (R43's rule)
document.addEventListener('selectionchange', () => {
  const s = getSelection(), node = s && s.rangeCount ? s.anchorNode : null, doc = node && (node.nodeType === 1 ? node : node.parentElement)?.closest?.('.doc[data-note]'); if (!doc) return;
  let el = node.nodeType === 1 ? node : node.parentElement; while (el && el.parentElement !== doc) el = el.parentElement;
  if (el) AIC.caret = { noteId: doc.dataset.note, index: [...doc.children].indexOf(el) };
});
// Drag the free window by its head, resize it from any edge or corner; the docked one by its left edge. Arrow keys on the head move it
app.addEventListener('pointerdown', e => {
  const rz = e.target.closest?.('[data-aic-rz]'), head = rz ? null : e.target.closest?.('[data-aic-drag]'); if (!rz && !head || e.button !== 0 || e.target.closest('button, textarea')) return;
  const win = e.target.closest('[data-aic-win]'); if (!win) return; e.preventDefault();
  const z = app.getBoundingClientRect().width / app.offsetWidth || 1, x0 = e.clientX, y0 = e.clientY, dock = win.classList.contains('aic-win--dock');
  const b0 = dock ? { w: win.offsetWidth } : { x: win.offsetLeft, y: win.offsetTop, w: win.offsetWidth, h: win.offsetHeight }, d = rz ? rz.dataset.aicRz : 'move';
  win.classList.add('is-moving'); head?.classList.add('is-grabbing');
  const move = ev => { const dx = (ev.clientX - x0) / z, dy = (ev.clientY - y0) / z;
    if (dock) { AIC.dockW = clamp(Math.round(b0.w - dx), AIC_DOCK.min, Math.max(AIC_DOCK.min, Math.min(AIC_DOCK.max, Math.round(app.offsetWidth * .5)))); win.style.width = AIC.dockW + 'px'; return; }
    AIC.rect = aicDrag(b0, d, dx, dy); const b = aicBoxOf(AIC.rect); Object.assign(win.style, { left: b.x + 'px', top: b.y + 'px', width: b.w + 'px', height: b.h + 'px' }); };
  const up = () => { removeEventListener('pointermove', move); removeEventListener('pointerup', up); win.classList.remove('is-moving'); head?.classList.remove('is-grabbing');
    if (dock) aicSave({ ai_chat_dock_w: AIC.dockW }); else { AIC.rect = aicBox(); aicSave({ ai_chat_rect: AIC.rect }); } renderAll(); };
  addEventListener('pointermove', move); addEventListener('pointerup', up);
});
function aicDrag(b0, d, dx, dy) {
  const b = { ...b0 };
  if (d === 'move') { b.x += dx; b.y += dy; return b; }
  if (d.includes('e')) b.w = b0.w + dx;
  if (d.includes('s')) b.h = b0.h + dy;
  if (d.includes('w')) { b.w = b0.w - dx; b.x = b0.x + (b0.w - Math.max(AIC_MIN.w, b.w)); }
  if (d.includes('n')) { b.h = b0.h - dy; b.y = b0.y + (b0.h - Math.max(AIC_MIN.h, b.h)); }
  return b;
}
function aicBoxOf(r) { const keep = AIC.rect; AIC.rect = r; const b = aicBox(); AIC.rect = keep; return b; }
app.addEventListener('keydown', e => {
  if (!e.target.matches?.('[data-aic-drag]') || !/^Arrow/.test(e.key)) return; e.preventDefault();
  const b = aicBox(), s = 16, dx = e.key === 'ArrowLeft' ? -s : e.key === 'ArrowRight' ? s : 0, dy = e.key === 'ArrowUp' ? -s : e.key === 'ArrowDown' ? s : 0;
  AIC.rect = aicBoxOf(e.shiftKey ? { ...b, w: b.w + dx, h: b.h + dy } : { ...b, x: b.x + dx, y: b.y + dy }); aicSave({ ai_chat_rect: AIC.rect }); AIC.focus = '[data-aic-drag]'; renderAll();
});
if (window.ResizeObserver) new ResizeObserver(() => { const w = app.querySelector('.aic-win--float'); if (w) { const b = aicBox(); Object.assign(w.style, { left: b.x + 'px', top: b.y + 'px', width: b.w + 'px', height: b.h + 'px' }); } }).observe(document.getElementById('app'));

/* ==== Build N parity round · the chat's history, earlier chats, its settings, and AI on or off (mockups R51, R52; the user's
   answers in decisions R50-R52: r50-history, r50-new, r50-esc, r50-note, r51-full "keeps going", r51-carry "starts empty",
   r50-acts "always under the newest", r46-noai "if they want zero ai then they are hidden") ==== */
Object.assign(ICON, {   // wireframe, from mockup R51
  r51lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
  r51sum: '<path d="M4 6h16M4 12h10M4 18h7"/><path d="m16 16 2 2 4-4"/>' });

/* ---- the context meter: how much of what the model reads at once the next follow-up uses. The numbers are local_ai.py's
   (QA_CTX_TOKENS, QA_CHARS_PER_TOKEN, QA_REPLY_TOKENS, QA_NOTE_CHARS, QA_QUESTION_CHARS, QA_ANSWER_CHARS, the system message);
   test_api checks they agree. Past 100% the backend drops the oldest turns, so a full chat keeps going ---- */
const AIC_CTX = { tokens: 8192, perToken: 4, reply: 800, note: 12000, q: 2000, a: 1500, system: 1454 };
function aicCtx(n, c) {
  const room = (AIC_CTX.tokens - AIC_CTX.reply) * AIC_CTX.perToken;
  const noteLen = AIC.scope === 'all' ? AIC_CTX.note : Math.min(AIC_CTX.note, `# ${n.title}\n${n.md || ''}`.length);
  const hist = aicHistory(c, AIC.scope).reduce((sum, h) => sum + Math.min(h.q.length, AIC_CTX.q) + Math.min(h.a.length, AIC_CTX.a), 0);
  const used = AIC_CTX.system + noteLen + hist + (AIC.drafts[aicKey(n)] || '').length;
  return { pct: Math.min(100, Math.round(used / room * 100)), used, room };
}
function aicMeter(ctx) {
  const pct = ctx.pct, last = AIC.hist === 'last', m = ainCur('qa')?.name || 'the model';
  const say = `${last ? `The last ${AIC.histN} questions and answers go` : 'The whole chat goes'} with each follow-up: about ${pct}% of what ${m} can read at once`;
  const tip = pct >= 100 ? 'Full: the oldest no longer fit' : pct >= 80 ? 'Nearly full: a new chat works best' : last ? `Sends the last ${AIC.histN}` : 'How full this chat is';
  return `<span class="aic-meter aic-tip${pct >= 80 ? ' is-high' : ''}" role="meter" tabindex="0" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct}" aria-label="${esc(say)}" data-tip="${esc(tip)}" data-aic-meter>`
    + `<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="6" class="aic-ring-bg"/><circle cx="8" cy="8" r="6" class="aic-ring" stroke-dasharray="${(pct / 100 * 37.7).toFixed(1)} 37.7" transform="rotate(-90 8 8)"/></svg>`
    + `${last ? `<span class="aic-last">Last ${AIC.histN}</span>` : `<span class="num">${pct}%</span>`}</span>`;
}
function aicMeterPaint(n) {   // while you type, in place (no redraw, so the input keeps its caret)
  const el = app.querySelector('[data-aic-meter]'); if (!el || !n) return;
  const box = document.createElement('div'); box.innerHTML = aicMeter(aicCtx(n, aicChat(aicKey(n)))); el.replaceWith(box.firstElementChild);
}
function aicFullLine(pct) {   // at 80%: the line above the input; at 100% it says the oldest no longer fit (the input never greys)
  const full = pct >= 100;
  return `<div class="aic-full" role="status">${ic('alert')}<div class="aic-full-text"><b>${full ? 'This chat is full' : 'This chat is nearly full'}</b><span>${full ? 'The oldest questions no longer fit, so answers may miss them.' : 'Answers may get worse as it fills.'} New chat keeps this one in Earlier chats.</span>`
    + `<span class="aic-full-acts"><button class="btn btn--secondary btn--sm" data-act="aic-new" data-v="fresh">New chat</button><button class="btn btn--ghost btn--sm" data-act="aic-new" data-v="summary">${ic('r51sum')}New chat with a summary</button></span></div></div>`;
}

/* ---- earlier chats: New chat keeps the last one, read only; open it from the clock in the head, or carry on from it ---- */
const aicDay = () => new Date().toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
function aicArchive(c, key) {
  if (!c.turns.length) return null; aicArchive.n = (aicArchive.n || 0) + 1;
  const p = { id: 'c' + Date.now().toString(36) + aicArchive.n, title: c.turns[0].q, date: aicDay(), n: c.turns.length, carry: c.carry || null,
    turns: c.turns.map(t => ({ ...t, answers: t.answers.map(a => ({ ...a, pending: null })) })) };
  (AIC.past[key] ||= []).unshift(p); return p;
}
const aicShort = (s, w) => { const x = String(s || '').replace(/\s+/g, ' ').trim().split(' '); return x.length > w ? x.slice(0, w).join(' ') + '…' : x.join(' '); };
function aicSummary(turns) {   // a short summary made here (no model call): the questions, and the gist of the last answer
  const t = turns.filter(x => x.answers[x.at]?.text), last = t.length ? t[t.length - 1].answers[t[t.length - 1].at].text : '';
  const gist = last.replace(/not from your notes?\s*:\s*/gi, '').replace(/[#*_>`|]/g, '').replace(/\n+/g, ' ').trim();
  return `You asked ${turns.length} question${turns.length === 1 ? '' : 's'}: ${turns.slice(0, 4).map(x => `“${aicShort(x.q, 8)}”`).join(', ')}${turns.length > 4 ? '…' : ''}.${gist ? ` The last answer: ${aicShort(gist, 22)}` : ''}`;
}
function aicViewed(n) { const v = AIC.viewing; return v && n ? (AIC.past[aicKey(n)] || []).find(p => p.id === v) || null : null; }
function aicHistMenu() {
  const n = note(), key = aicKey(n), past = AIC.past[key] || [], c = aicChat(key), v = aicViewed(n)?.id, tick = on => `<span class="aic-tick" aria-hidden="true">${on ? ic('r50tick') : ''}</span>`;
  return `<div class="aic-mlabel">${AIC.follow === 'keep' ? 'Chats' : 'Chats about this note'}</div>`
    + `<button class="menu-item" role="menuitemradio" aria-checked="${!v}" data-act="aic-hist-cur">${tick(!v)}<span class="truncate">Current chat</span><span class="aic-where">${c.turns.length} question${c.turns.length === 1 ? '' : 's'}</span></button>`
    + (past.length ? past.map(p => `<button class="menu-item" role="menuitemradio" aria-checked="${v === p.id}" data-act="aic-hist-open" data-v="${p.id}" title="${esc(p.title)}">${tick(v === p.id)}<span class="truncate">${esc(p.title)}</span><span class="aic-where">${esc(p.date)} · ${p.n}</span></button>`).join('')
      : '<div class="aic-none">No earlier chats yet. New chat keeps this one here, read only.</div>');
}
function aicContinue(n) {   // "Carry on from it": a new chat that starts with the earlier one's summary (the current one goes to Earlier chats)
  const p = aicViewed(n); if (!p || aicBusyHere(n)) return; const key = aicKey(n), c = aicChat(key);
  if (c.turns.length) aicArchive(c, key);
  c.turns = []; c.carry = aicSummary(p.turns); AIC.viewing = null; AIC.stick = true; AIC.focus = '#aic-in';
  status('A new chat that starts with a summary of the earlier one'); renderAll();
}
function aicFollow(v) {   // Opening another note: each note's own chat, or the chat you're in stays (it shares the note's chat it started from)
  if (v === AIC.follow) return; const id = note()?.id;
  if (v === 'keep') { AIC.chats._keep = (id && AIC.chats[id]) || { turns: [] }; AIC.past._keep = (id && AIC.past[id]) || []; AIC.drafts._keep = (id && AIC.drafts[id]) || ''; }
  else { delete AIC.chats._keep; delete AIC.past._keep; delete AIC.drafts._keep; }
  AIC.follow = v; AIC.viewing = null;
}

/* ---- Settings → AI models: "Ask about this note", and "AI in NeuroVault" first. Flat groups (an eyebrow and rows, like Fix A's
   spelling group), never cards: Settings panes are flat lists (QC 64) ---- */
const AIC_SET = [
  ['esc', 'Esc while it answers', 'Stops the answer first, then closes the window. Or closes it straight away while the answer carries on (a dot on the icon when it’s ready).', [['stop', 'Stops the answer'], ['close', 'Closes the window']]],
  ['follow', 'Opening another note', 'Each note keeps its own chat. Or the chat you’re in stays open as you move between notes.', [['note', 'Its own chat'], ['keep', 'Keeps this chat']]],
  ['hist', 'Follow-ups send', 'The whole chat, with a meter for how full it is. Or only the last few questions and answers, for smaller models.', [['whole', 'The whole chat'], ['last', 'The last few']]],
  ['new', 'New chat', 'Starts empty. Or starts with a short summary of the last chat. The last chat is kept in Earlier chats either way, read only.', [['fresh', 'Starts empty'], ['summary', 'Brings a summary']]],
  ['mode', 'Ask opens', 'Docked on the right (the note makes room), or as a free window you can move and resize.', [['dock', 'Docked on the right'], ['float', 'A free window']]]];
const aicSetVal = k => ({ esc: AIC.esc, follow: AIC.follow, hist: AIC.hist, new: AIC.newHow, mode: AIC.mode })[k];
function aicCard() {
  const rows = AIC_SET.map(([k, label, desc, opts]) => `<div class="set-row aic-set-row" data-aic-row="${k}"><div><div class="set-label" id="aic-${k}-l">${label}</div><div class="set-desc">${desc}</div></div><div class="aic-set-ctl">`
    + `<div class="seg" role="group" aria-labelledby="aic-${k}-l">${opts.map(([v, l]) => `<button class="seg-opt" data-act="aic-set" data-k="${k}" data-v="${v}" aria-pressed="${aicSetVal(k) === v}">${l}</button>`).join('')}</div>`
    + `${k === 'hist' && AIC.hist === 'last' ? `<label class="aic-last-n">How many<select class="field" data-aic-histn aria-label="How many questions and answers a follow-up sends">${[4, 6, 10, 20].map(x => `<option value="${x}"${AIC.histN === x ? ' selected' : ''}>${x}</option>`).join('')}</select></label>` : ''}</div></div>`).join('');
  return `<div class="pop-sec aic-group" id="aic-card" role="group" aria-labelledby="aic-card-t"><div class="eyebrow" id="aic-card-t">Ask about this note</div>${rows}</div>`;
}
function aicAiCard() {
  const on = AIC.aiOn;
  return `<div class="pop-sec aic-group aic-ai-group" id="aic-ai-card" role="group" aria-labelledby="aic-ai-t"><div class="eyebrow" id="aic-ai-t">AI in NeuroVault</div>`
    + `<div class="set-row aic-set-row"><div><div class="set-label" id="aic-ai-l">AI features: ${on ? 'on' : 'off, hidden'}</div><div class="set-desc">${on ? 'Summarise and Ask show in the note header, and Tidy up with AI in the right-click menu. Until a model is set up they stay greyed, and hovering says “Enable AI to use this feature”.'
      : 'Every AI control is hidden: Summarise and Ask in the note header, the chat, Tidy up with AI in the right-click menu, and the models here. Turn it on to see them again.'}</div></div>`
    + `<div class="seg" role="group" aria-labelledby="aic-ai-l">${[['on', 'On'], ['off', 'Off: hide all AI']].map(([v, l]) => `<button class="seg-opt" data-act="aic-ai" data-v="${v}" aria-pressed="${(v === 'on') === on}">${l}</button>`).join('')}</div></div></div>`;
}
const aicPane0 = aiPane;
aiPane = function () { return aicAiCard() + (AIC.aiOn ? aicPane0.apply(this, arguments) : ''); };   // eslint-disable-line no-global-assign
document.addEventListener('change', e => {
  if (!e.target.matches?.('[data-aic-histn]')) return; AIC.histN = +e.target.value; aicSave({ ai_chat_hist_n: AIC.histN });
  status(`Follow-ups send the last ${AIC.histN} questions and answers`); S.focus = { sel: '[data-aic-histn]' }; renderAll();
});

/* ---- AI in NeuroVault: Off hides every AI control (greyed with the hint stays how it looks with no model) ---- */
function aicHide() {   // what's open closes: the chat, its menus, the summary and Tidy up's popover
  AIC.open = false; AIC.menu = null; AIC.viewing = null; AIN.sum.open = false; AIN.askUi.open = false; if (AIN.tidy) AIN.tidy = null;
}
function aicAiSet(on) {
  AIC.aiOn = on; aicSave({ ai_enabled: on }); if (!on) { if (AIC.busy) aicStop(); aicHide(); }
  status(on ? 'AI is on: Summarise and Ask are back in the note header' : 'AI is off: every AI control is hidden · Settings → AI models turns it back on');
  S.focus = { sel: `[data-act="aic-ai"][data-v="${on ? 'on' : 'off'}"]` }; renderAll();
}
const aicAll0 = renderAll;
renderAll = function () { if (!AIC.aiOn) aicHide(); return aicAll0.apply(this, arguments); };   // eslint-disable-line no-global-assign
const aicStatus0 = aiStatusLink;
aiStatusLink = function () { return AIC.aiOn ? aicStatus0.apply(this, arguments) : ''; };   // eslint-disable-line no-global-assign
/* ---- parity · No AI and the right-click menu (a labelled block: Build M owns the menu): Tidy up with AI goes ---- */
const aicWordMenu0 = djWordMenu;
djWordMenu = function () { const h = aicWordMenu0.apply(this, arguments); return AIC.aiOn ? h : h.replace(/<!-- Build N · Tidy up with AI --><button[\s\S]*?<\/button>/, ''); };   // eslint-disable-line no-global-assign
const aicCtxRun0 = djCtxRun;
djCtxRun = function (act) { if (act === 'ctx-tidy' && !AIC.aiOn) return; return aicCtxRun0.apply(this, arguments); };   // eslint-disable-line no-global-assign
/* ---- end parity · No AI and the right-click menu ---- */
/* ---- QC 72: a toast never covers a writing box (the Ask input above all; feedback: "this pops up in the middle of the chat text
   box"). Toasts sit at the bottom right, where the docked chat's input is: one that would cover a box moves left of it, or above it ---- */
const WRITE_BOX = '.aic-box, textarea, input:not([type="checkbox"]):not([type="radio"]):not([type="range"]):not([type="color"]):not([type="file"]):not([type="button"]):not([type="submit"])';
function toastClear() {
  const ts = [...app.querySelectorAll('.toast')]; if (!ts.length) return;
  ts.forEach(t => { t.style.right = ''; t.style.bottom = ''; });
  const ar = app.getBoundingClientRect(), z = ar.width / app.offsetWidth || 1;
  const boxes = [...app.querySelectorAll(WRITE_BOX)].filter(b => b.offsetParent && !b.closest('.toast')).map(b => (b.closest('.aic-box') || b).getBoundingClientRect()).filter(r => r.width && r.height);
  ts.forEach(t => { for (let k = 0; k < 4; k++) {
    const r = t.getBoundingClientRect(), hit = boxes.find(b => r.left < b.right && r.right > b.left && r.top < b.bottom && r.bottom > b.top); if (!hit) break;
    if ((hit.left - ar.left) / z >= r.width / z + 24) t.style.right = Math.round((ar.right - hit.left) / z + 12) + 'px';   // room on its left
    else t.style.bottom = Math.round((ar.bottom - hit.top) / z + 12) + 'px'; } });   // else above it
}
const toastAfter0 = afterRender;
afterRender = function () { toastAfter0.apply(this, arguments); toastClear(); };   // eslint-disable-line no-global-assign
/* ==== end Build N parity round ==== */
/* ==== end Build N round 6 ==== */
/* ==== Build N · QC 103 (feedback: "ai chat floating window needs to behave like its own window just like stickynotes does"):
   in the desktop app, Float opens the chat in its own NeuroVault window (popout.py, "#pop=ask"), like a popped-out sticky: move
   it anywhere, outside the main window too; Keep on top (the pin); Back into NeuroVault, or close it, and the chat is docked again.
   One conversation: the chat lives in each window's page, so whichever window changes it sends it to the other (pop_ask_sync),
   the main window with the note it's about; it follows the note open in NeuroVault. One answer at a time across both: the other
   window shows it arriving and can stop it; if the window that asked closes, NeuroVault's dock carries on waiting for it.
   In a plain browser (no desktop app) Float stays the in-page window. ==== */
const AIC_WIN = Math.random().toString(36).slice(2, 10);   // this window, so it never takes its own messages back
const aicAway = () => !POP && typeof isOut === 'function' && isOut('ask');   // NeuroVault's window: the chat is in its own window
const aicPopHere = () => POP?.kind === 'ask';
const aicCanPop = () => !!api() && !POP;
async function aicPopOut() {
  const r = await nv('pop_out', 'ask', null, null, null, AIC_DEF.w, AIC_DEF.h);
  if (failed(r)) {   // no desktop app (a browser with the dev bridge), or Windows said no: the in-page window, as before
    AIC.mode = 'float'; AIC.open = true; aicFromTab(); status(r?.message ? `Ask is a free window here: ${r.message}` : 'Ask is a free window: drag its head, pull an edge to resize'); renderAll(); return false; }
  popApply(r); AIC.menu = null; AIC.mode = 'dock'; AIC.open = false; aicFromTab(); AIC.sent = null;
  status('Ask is in its own window: move it anywhere, keep it on top with the pin, close it to dock it again'); renderAll(); aicSyncOut(true); return true;
}
function aicBack(focus = true) {   // its window closed or came back: the chat is docked in NeuroVault again, the conversation kept
  AIC.mode = 'dock'; AIC.open = true; AIC.stick = true; AIC.unread = false; aicToTab();
  const b = AIC.busy; if (b?.remote) { AIC.busy = null; if (b.job && b.ans) aicAdopt(b); }   // the window that asked has gone: wait for the answer here
  if (focus) AIC.focus = '#aic-in'; renderAll();
}
async function aicAdopt(b) {   // another window's question, answered here: the same poll as aicAsk's
  const seq = ++AIC.seq, a = b.ans; AIC.busy = { noteId: b.noteId, key: b.key, ans: a, job: b.job, seq };
  const t0 = Date.now();
  while (Date.now() - t0 < 300000) {
    await new Promise(ok => setTimeout(ok, AIN_CHECK ? 5 : AIC_POLL));
    if (AIC.busy?.seq !== seq) return;
    const j = await nv('ai_job', b.job); if (AIC.busy?.seq !== seq) return;
    if (failed(j)) { aicEnd(a, { err: j.message }); return; }
    if (j.state === 'running') { if (j.partial && j.partial !== a.text) aicLive(a, j.partial); continue; }
    if (j.state === 'done') { aicEnd(a, { text: j.result.answer, by: j.result.by, general: !!j.result.general, dropped: j.result.dropped || 0, kept: j.result.kept_off || '' }); return; }   // R68: kept = answered on this PC because the note is kept off cloud AI
    if (j.state === 'error') { aicEnd(a, { err: j.message }); return; }
    if (j.state === 'cancelled') { aicEnd(a, { stopped: true }); return; }
  }
  aicEnd(a, { err: 'The model took too long.' });
}
// what goes to the other window: this note's chat, Earlier chats, and the question being answered (NeuroVault's window adds the note)
function aicPayload() {
  const n = note(); if (!n) return null; const key = aicKey(n), b = AIC.busy && !AIC.busy.remote ? AIC.busy : null;
  const p = { from: AIC_WIN, key, chat: AIC.chats[key] || { turns: [] }, past: AIC.past[key] || [], scope: AIC.scope, busy: b ? { key: b.key, noteId: b.noteId, job: b.job } : null };
  if (!POP) p.note = { id: n.id, title: n.title, md: n.md || '' };
  return p;
}
function aicSyncOut(force) {
  if (!(aicPopHere() || aicAway()) || !api()) return;
  clearTimeout(aicSyncOut.t);
  aicSyncOut.t = setTimeout(() => { const p = aicPayload(); if (!p) return; const j = JSON.stringify(p); if (!force && j === AIC.sent) return; AIC.sent = j; nv('pop_ask_sync', p); }, force ? 0 : 120);
}
function aicSyncIn(d) {
  if (!d || d.from === AIC_WIN) return;
  if (d.hello) { if (!POP) { AIC.sent = null; aicSyncOut(true); } return; }   // the chat's window has just opened: it gets everything
  if (aicPopHere() && d.note) { const n0 = D.notes.find(x => x.id === d.note.id);
    if (n0) Object.assign(n0, d.note); else D.notes = [{ html: null, tags: [], ...d.note }];
    S.noteId = d.note.id; }
  if (d.key) { AIC.chats[d.key] = d.chat && Array.isArray(d.chat.turns) ? d.chat : { turns: [] }; AIC.past[d.key] = Array.isArray(d.past) ? d.past : []; }
  if (d.scope === 'note' || d.scope === 'all') AIC.scope = d.scope;
  if (d.busy && (!AIC.busy || AIC.busy.remote)) {
    const c = AIC.chats[d.busy.key], a = c?.turns.flatMap(t => t.answers).find(x => x.pending) || null;
    AIC.busy = { remote: true, key: d.busy.key, noteId: d.busy.noteId, job: d.busy.job, ans: a, seq: -1 };
  } else if (!d.busy && AIC.busy?.remote) AIC.busy = null;
  const p = aicPayload(); AIC.sent = p ? JSON.stringify(p) : null;   // what came in isn't sent back
  renderAll();
}
// every change in either window goes to the other: each draw, and each word of an answer as it arrives
{ const r0 = renderAll; renderAll = function () { const o = r0.apply(this, arguments); aicSyncOut(); return o; }; }   // eslint-disable-line no-global-assign
{ const l0 = aicLive; aicLive = function () { const o = l0.apply(this, arguments); aicSyncOut(); return o; }; }   // eslint-disable-line no-global-assign
{ const e0 = aicEnd; aicEnd = function () { const o = e0.apply(this, arguments); if (aicAway()) AIC.unread = false; return o; }; }   // eslint-disable-line no-global-assign
// Stop works from either window: the one that asked sees it stopped, and says so in both
{ const s0 = aicStop; aicStop = async function () { const b = AIC.busy; if (b?.remote) { if (b.job && api()) nv('ai_job_cancel', b.job); status('Stopping the answer…'); return; } return s0.apply(this, arguments); }; }   // eslint-disable-line no-global-assign
// NeuroVault's window: Float opens the chat's own window; the header's Ask shows it while it's out; "Float" saved as where it opens does too
app.addEventListener('click', e => {
  const t = e.target.closest?.('[data-act="aic-dock"]'); if (!t || !aicCanPop() || AIC.mode !== 'dock') return;
  e.preventDefault(); e.stopImmediatePropagation(); aicPopOut();
}, true);
{ const o0 = aicOpen; aicOpen = function (on = !aicShown()) {   // eslint-disable-line no-global-assign
  if (aicAway()) { nv('pop_show', 'ask'); status('Ask is in its own window'); return; }
  if (on && AIC.mode === 'float' && aicCanPop()) { AIC.mode = 'dock'; aicPopOut(); return; }
  return o0.call(this, on); }; }
// the chat's own window: its relays (Insert goes into the note in NeuroVault's window; Open AI models opens Settings there)
{ const r0 = window.nvRelay; window.nvRelay = async (act, v) => {
  if (act === 'aic-ins') { let o = {}; try { o = JSON.parse(v); } catch (e) { return; } aicInsert(+o.i, o.how); return; }
  if (act === 'aic-open') { openSettings('ai'); return; }
  return r0(act, v); }; }
if (POP?.kind === 'ask') {
  app.addEventListener('click', e => {
    const t = e.target.closest?.('[data-act="aic-ins"], [data-act="aic-setup"]'); if (!t) return;
    e.preventDefault(); e.stopImmediatePropagation(); AIC.menu = null;
    if (t.dataset.act === 'aic-setup') { nv('pop_relay', 'aic-open', ''); return; }
    nv('pop_relay', 'aic-ins', JSON.stringify({ i: +t.dataset.v, how: t.dataset.how })).then(r => { if (failed(r)) toast(r.message); else status('Put into the note in NeuroVault’s window'); }); renderAll();
  }, true);
}
// the chat's own window: the chat fills it; its head is the strip you move it by, with Keep on top, Back into NeuroVault and Close
function aicPopCard() {
  const n = note(), head0 = '<div class="aic-head" data-drag-widget title="Drag to move the window">';
  const btns = () => { const top = popOnTop('ask');
    return `<button class="icon-btn aic-tip" data-act="pop-top" data-v="ask" aria-pressed="${top}" ${aicTip(top ? 'On top of other apps: click to let them cover it' : 'Keep on top of other apps')}>${ic('pin')}</button>`
      + `<button class="icon-btn aic-tip" data-act="pop-in" data-v="ask" ${aicTip('Dock it back in NeuroVault')}>${ic('popin')}</button>`; };
  const close = `<button class="icon-btn aic-tip" data-act="pop-close" data-v="ask" ${aicTip('Close: the chat goes back into NeuroVault, kept')}>${ic('x')}</button>`;
  if (!n || !D.notes.length) return `<section class="card aic-win aic-win--pop" role="region" aria-labelledby="aic-t" data-aic-win>${head0}<span class="aic-title" id="aic-t">Ask</span><span class="aic-grow"></span>${btns()}${close}</div>
    <div class="aic-wait" role="status">${ic('chat')}<span>${api() ? 'Getting the chat from NeuroVault…' : 'This window shows the Ask chat in the NeuroVault app.'}</span></div></section>`;
  AIC.open = true; AIC.mode = 'dock';
  let h = aicHtml('dock');
  h = h.replace(/^<section class="card aic-win aic-win--dock aic-win--tab" role="tabpanel" id="insp-panel" aria-labelledby="insp-tab-ask" data-aic-win>/, '<section class="card aic-win aic-win--pop" role="region" aria-labelledby="aic-t" data-aic-win>')
    .replace('<div class="aic-head">', head0)
    .replace(/<button class="icon-btn aic-tip" data-act="aic-dock"[^>]*>[\s\S]*?<\/button>/, btns())
    .replace(/<button class="icon-btn aic-tip" data-act="aic-close"[^>]*>[\s\S]*?<\/button>/, close);
  return h.replace(/<\/section>$/, `<span class="st-grip aic-pop-grip" aria-hidden="true">${ic('grip')}</span></section>`) + aicMenuHtml();
}
async function aicPopLoad() {   // the chat's own window: the reader settings and the chat's (loadReader), the models, then the chat itself
  UI.view = 'notes'; D.notes = []; S.noteId = null; AIC.open = true; AIC.mode = 'dock';
  if (!api()) return;
  try { await aiRefresh(); } catch (e) { console.warn('AI status not loaded', e); }
  nv('pop_ask_sync', { from: AIC_WIN, hello: true });
}
/* ==== end Build N · QC 103 ==== */

/* ==== Build N · QC 108 (feedback: "anyway we can make table outputs more pretty?"): a table in an answer looks like a note's table
   (header tint, row lines, padding, a rounded frame), words never break in the middle (only a very long token wraps), columns
   size to what's in them, and a wide table scrolls sideways in its own frame instead of squeezing. Numbers sit to the right.
   Hovering one shows Copy as table (it pastes as a table into Word or Excel) and Insert as a table (a real one, at the cursor in
   the note, or at its end). The same in the chat's own window and in the Agent's answers. ==== */
const ANS_NUM = /^[-+−]?(?:[£$€¥]\s?)?\d[\d,. ]*(?:%|[kKmMbB]|\s?(?:GB|MB|KB|ms|s|h))?$/;
function ansTables(html) {   // each <table>: its frame, its actions, and its number and long-token cells marked
  if (!/<table/i.test(html)) return html;
  const box = document.createElement('div'); box.innerHTML = html;
  [...box.querySelectorAll('table')].forEach((t, k) => {
    t.querySelectorAll('td, th').forEach(c => { const s = c.textContent.trim();
      if (c.tagName === 'TD' && s && ANS_NUM.test(s)) c.classList.add('is-num');
      if (s.split(/\s+/).some(w => w.length > 30)) c.classList.add('is-long'); });
    const wrap = document.createElement('div'); wrap.className = 'ans-tbl-wrap'; wrap.dataset.ansTbl = k;
    wrap.innerHTML = `<div class="ans-tbl-acts"><button class="icon-btn icon-btn--sm aic-tip" data-act="ans-tbl-copy" data-v="${k}" ${aicTip('Copy as table')}>${ic('copy')}</button><button class="icon-btn icon-btn--sm aic-tip" data-act="ans-tbl-ins" data-v="${k}" ${aicTip('Insert as a table')}>${ic('listplus')}</button></div><div class="ans-tbl" tabindex="0" role="region" aria-label="Table ${k + 1}: scroll sideways if it’s wide"></div>`;
    t.replaceWith(wrap); wrap.querySelector('.ans-tbl').append(t);
  });
  return box.innerHTML;
}
{ const m0 = aicMd; aicMd = function () { return ansTables(m0.apply(this, arguments)); }; }   // eslint-disable-line no-global-assign
function ansMdTables(md) {   // the answer's Markdown tables, in order (not inside a code fence)
  const out = []; let cur = null, fence = false;
  for (const line of String(md || '').split('\n')) {
    if (/^\s*```/.test(line)) { fence = !fence; if (cur) { out.push(cur); cur = null; } continue; }
    if (!fence && /^\s*\|.*\|\s*$/.test(line)) { (cur ||= []).push(line.trim()); continue; }
    if (cur) { out.push(cur); cur = null; }
  }
  if (cur) out.push(cur);
  return out.filter(b => b.length >= 2 && /^\|?(?:\s*:?-+:?\s*\|)+\s*(?::?-+:?\s*)?$/.test(b[1])).map(b => b.join('\n'));   // a separator row under the head
}
function ansInsertTable(md) {   // a real table: at the cursor in the note, else at its end; Undo for 10 seconds
  const n = note(); if (!n || !md) return;
  const before = { md: (n.docDirty && syncDoc(n), n.md) }, cur = AIC.caret;
  hold({ msg: `Table added to “${n.title}”`, back: 'Taken out of the note', commit: () => Promise.resolve(null), undo: () => aicUnInsert(n, before),
    apply: () => { const d = liveDoc(n);
      if (d?.isContentEditable && cur && cur.noteId === n.id) { edRecord(d, 'cmd'); const box = document.createElement('div'); box.innerHTML = aiGuardHtml(NVMarkdown.mdToHtml(md), 'inert');
        const after = d.children[Math.min(cur.index, d.children.length - 1)] || null, nodes = [...box.childNodes]; if (after) after.after(...nodes); else d.append(...nodes); edChanged(d); }
      else { if (n.docDirty) syncDoc(n); n.md = String(n.md || '').replace(/\s*$/, '') + '\n\n' + md + '\n'; n.html = null; noteEdited(n); } } });
}
function ansCopyTable(t) {   // as a table: a copy of it selected and copied, so Word and Excel paste rows and columns
  const host = document.createElement('div'); host.setAttribute('contenteditable', 'true'); host.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0';
  const c = t.cloneNode(true); c.querySelectorAll('[class]').forEach(e => e.removeAttribute('class')); host.append(c); document.body.append(host);
  const r = document.createRange(); r.selectNodeContents(host); const sel = getSelection(), keep = sel.rangeCount ? sel.getRangeAt(0) : null; sel.removeAllRanges(); sel.addRange(r);
  let ok = false; try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
  sel.removeAllRanges(); if (keep) sel.addRange(keep); host.remove(); return ok;
}
app.addEventListener('click', e => {
  const b = e.target.closest?.('[data-act="ans-tbl-copy"], [data-act="ans-tbl-ins"]'); if (!b) return; e.preventDefault(); e.stopImmediatePropagation();
  const turn = b.closest('[data-aic-turn]'), i = +turn?.dataset.aicTurn, k = +b.dataset.v, n = note(), tt = n && aicChat(aicKey(n)).turns[i], a = tt?.answers[tt.at];
  if (b.dataset.act === 'ans-tbl-copy') { const t = b.closest('.ans-tbl-wrap')?.querySelector('table'); status(t && ansCopyTable(t) ? 'Copied as a table: it pastes into Word or Excel as rows and columns' : 'Couldn’t copy it'); return; }
  const md = ansMdTables(a?.text || a?.agent?.answer || '')[k]; if (!md) { status('That table couldn’t be read'); return; }
  if (typeof POP !== 'undefined' && POP?.kind === 'ask') { nv('pop_relay', 'aic-ins', JSON.stringify({ i, how: 'table', t: k })).then(r => { if (failed(r)) toast(r.message); else status('Put into the note in NeuroVault’s window'); }); return; }
  ansInsertTable(md);
}, true);
{ const r0 = window.nvRelay; window.nvRelay = async (act, v) => {   // the chat's own window asks NeuroVault's to put a table in the note
  if (act === 'aic-ins') { let o = {}; try { o = JSON.parse(v); } catch (e) { return r0(act, v); }
    if (o.how === 'table') { const n = note(), tt = n && aicChat(aicKey(n)).turns[+o.i], a = tt?.answers[tt.at]; ansInsertTable(ansMdTables(a?.text || a?.agent?.answer || '')[+o.t]); return; } }
  return r0(act, v); }; }
/* ==== end Build N · QC 108 ==== */
