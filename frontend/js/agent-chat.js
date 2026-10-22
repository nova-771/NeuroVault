/* ==== Build N · R67: the Agent, in the Ask chat (mockup R67, 8e28821; agent.py does the work) ====
   The decisions: it's called Agent, it's off by default (Settings → AI models → Jobs and answers → Agent), and it lives in
   the Ask chat as a third choice beside This note and My newest notes. It can search and read your notes, summarise one, add a
   task and add text to the end of a note: five tools, nothing else. Every change asks first (Add, Edit, Skip); at the end it says
   what it changed and "Nothing else changed", with Undo all. At most 8 steps and 3 changes a request (Carry on gives 8 more
   steps). With a cloud model each step says what went to that company. A model that can't use tools (Qwen3.5 0.8B or 2B) says so
   and offers one that can. The steps show as they happen; Stop (or Esc) stops it at once. ==== */
'use strict';
Object.assign(ICON, {   // wireframe, from mockup R67
  r67agent: '<rect x="4" y="7" width="16" height="12" rx="3"/><path d="M12 7V4M9 12h.01M15 12h.01M9.5 16h5"/>',
  r67done: '<circle cx="12" cy="12" r="9"/><path d="m8 12 3 3 5-6"/>',
  r67skip: '<circle cx="12" cy="12" r="9"/><path d="M8 12h8"/>',
  r67lock: '<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>' });
const AGT_TOOLS = [['search_notes', 'Search your notes', 'Finds notes by words; it sees their titles and a line of each.'], ['read_note', 'Read a note', 'Its text, up to 12,000 characters.'],
  ['summarise_note', 'Summarise a note', 'The same kind of summary as Summarise.'], ['create_task', 'Add a task', 'In Tasks, linked to the note it came from. Asks each time.'],
  ['append_to_note', 'Add to the end of a note', 'One step that Undo all takes out. Asks each time.'],
  ['add_tags', 'Add tags to a note', 'Never removes a tag; tags a note has already are skipped. Asks each time.'],   // the user's yes, after R67
  ['link_notes', 'Link two notes', 'A [[link]] where the note names the other, else on a “Related:” line. Only notes that exist. Asks each time.']];
const AGT_LOCAL = ['qwen35-4b', 'qwen35-9b', 'phi4-mini'];   // on this PC, the models that call tools well enough (agent.py LOCAL_TOOLS)
const AGT_SUGS = ['Find what’s left to do in my notes and add tasks for it', 'Add this week’s open questions to the end of this note', 'Summarise my notes about this'];
const AGT = { on: false, tools: AGT_TOOLS.map(t => t[0]) };
const AGT_FIRST5 = 'append_to_note,create_task,read_note,search_notes,summarise_note';   // saved before add_tags and link_notes came: those two are on (as api.ai_agent)
{ const c0 = readFromConfig; readFromConfig = function (c) { c0(c); AGT.on = c.ai_agent === true;   // eslint-disable-line no-global-assign
  if (Array.isArray(c.ai_agent_tools)) AGT.tools = [...c.ai_agent_tools].sort().join() === AGT_FIRST5 ? AGT_TOOLS.map(t => t[0]) : c.ai_agent_tools.filter(k => AGT_TOOLS.some(t => t[0] === k)); }; }
const agtHere = () => AIC.scope === 'agent' && AGT.on;
const agtBy = () => { const r = ainRoute('qa'), cur = ainCur('qa'); if (!cur) return 'no model'; return r?.kind === 'cloud' ? `${cur.name} · ${r.svc} · cloud` : `${cur.name} · this PC`; };
function agtCan() {   // { ok } or { ok: false, why, name } for Ask's model
  const r = ainRoute('qa'), cur = ainCur('qa');
  if (!r || r.kind === 'none' || !cur) return { ok: false, why: 'No model is set up for Ask yet, so the Agent can’t work.' };
  if (r.kind === 'local' && !AGT_LOCAL.includes(r.model)) return { ok: false, name: cur.name, why: `${cur.name} can’t use tools reliably, so the Agent can’t work with it.` };
  return { ok: true };
}
const agtBetter = () => { const now = ainChoice('qa'), cur = ainRoute('qa'); return ainModels().find(m => m.ok && m.key !== now && !(cur?.kind === 'local' && m.key === 'local:' + cur.model) && (m.cloud || AGT_LOCAL.includes(String(m.key).replace(/^local:/, '')))); };   // a model it can use, to offer (QC 112: not the one in use)

/* ---- Ask's menu: the third choice; the control and the head say Agent ---- */
{ const m0 = aicMenuHtml; aicMenuHtml = function () { const h = m0.apply(this, arguments); if (!h || AIC.menu?.kind !== 'opts') return h;   // eslint-disable-line no-global-assign
  const on = AIC.scope === 'agent' && AGT.on;
  const item = `<button class="menu-item agt-mi" role="menuitemradio" aria-checked="${on}" data-act="aic-scope" data-v="agent"><span class="aic-tick" aria-hidden="true">${on ? ic('r50tick') : ''}</span><span class="truncate">Agent: can search, read and add</span><span class="aic-where">${AGT.on ? 'asks first' : 'off · Settings'}</span></button>`;
  return h.replace(/(<button class="menu-item" role="menuitemradio" aria-checked="(?:true|false)" data-act="aic-scope" data-v="all">[\s\S]*?<\/button>)/, `$1${item}`); }; }
{ const c0 = aicControl; aicControl = function () { const h = c0.apply(this, arguments); return agtHere() ? h.replace(/This note · /g, 'Agent · ') : h; }; }   // eslint-disable-line no-global-assign
app.addEventListener('click', e => {   // picking it: off sends you to its settings first
  const t = e.target.closest?.('[data-act="aic-scope"][data-v="agent"]'); if (!t) return; e.preventDefault(); e.stopImmediatePropagation(); AIC.menu = null;
  if (!AGT.on) { openSettings('ai'); AIS.tab = 'jobs'; status('The Agent is off: turn it on here first'); renderAll(); if (typeof aisGoto === 'function') aisGoto('agent'); return; }
  AIC.scope = 'agent'; status('Agent: it can search, read and add, and asks before every change'); AIC.focus = '#aic-in'; renderAll();
}, true);
// QC 112: the model on this PC isn't loaded yet: the first answer waits while it loads, so say so, with Load it now and a cloud model
const agtCloud = () => ainModels().find(m => m.ok && m.cloud);
function agtLoadLine(after) {
  const r = ainRoute('qa'), cur = ainCur('qa'); if (r?.kind !== 'local' || !cur?.loads) return '';
  const c = agtCloud();
  return `<div class="agt-note agt-loadline" role="status" data-agt-load>${ic('r67agent')}<div><b>${esc(cur.name)} on this PC isn’t loaded yet${after ? ', so it didn’t get to answer' : ''}.</b><span class="set-desc">The first answer waits while it loads (it can take a minute).</span>
    <div class="agt-nact"><button class="btn btn--secondary btn--sm" data-act="agt-warm">Load it now</button>${c ? `<button class="btn btn--ghost btn--sm" data-act="agt-use" data-v="${esc(c.key)}">Use a cloud model (${esc(c.name)})</button>` : ''}</div></div></div>`;
}
function agtHello() {
  const can = agtCan(), r = ainRoute('qa');
  if (!can.ok) { const b = agtBetter();
    return `<div class="agt-note is-warn" role="alert" data-agt-notools>${ic('alert')}<div><b>${esc(can.why)}</b><span class="set-desc">Pick a model that can: Qwen3.5 4B or 9B on this PC, or any cloud model. Nothing was changed.</span>
      <div class="agt-nact">${b ? `<button class="btn btn--secondary btn--sm" data-act="agt-use" data-v="${esc(b.key)}">Use ${esc(b.name)}</button>` : ''}<button class="btn btn--ghost btn--sm" data-act="agt-setup">AI models…</button></div></div></div>`; }
  return `<div class="aic-hello agt-hello"><div class="aic-hello-t">${ic('r67agent')}Agent: ask it to do something with your notes</div>
    <div class="aic-hello-sub">It can search and read your notes, summarise them, add tasks and tags, link notes, and add text to the end of a note. <b>It asks before every change</b>: Add, Edit or Skip. At most 8 steps and 3 changes a request, and only your notes and tasks: no files, no settings, nothing deleted.</div>
    <div class="aic-hello-sub">${esc(agtBy())}: ${r?.kind === 'cloud' ? `the notes it reads go to ${esc(r.svc)}.` : 'nothing leaves this PC.'}</div>${agtLoadLine(false)}
    <div class="aic-sugs" role="group" aria-label="Try asking">${AGT_SUGS.map(s => `<button class="aic-sug" data-act="aic-sug" data-v="${esc(s)}">${ic('r67agent')}<span>${esc(s)}</span></button>`).join('')}</div></div>`;
}
{ const h0 = aicHtml; aicHtml = function () { let h = h0.apply(this, arguments); if (!h || !agtHere()) return h;   // eslint-disable-line no-global-assign
  const can = agtCan(), n = note(), c = n && aicChat(aicKey(n));
  h = h.replace(/<span class="aic-about"[^>]*>[\s\S]*?<\/span>/, `<span class="aic-about agt-about" title="${esc(agtBy())}">Agent · ${esc(agtBy())}</span>`);
  if (c && !c.turns.length) h = h.replace(/<div class="aic-hello">[\s\S]*?<\/div><\/div>/, agtHello());
  h = h.replace(/<div class="aic-capnote">[\s\S]*?<\/div>/, '');   // "Follow-ups send the whole chat" is Ask's, not the Agent's
  if (!can.ok) h = h.replace(/(<textarea class="aic-in"[^>]*?)placeholder="[^"]*"/, '$1placeholder="Pick a model that can use tools first" disabled');
  else if (!AIC.busy) h = h.replace(/(<textarea class="aic-in"[^>]*?)placeholder="[^"]*"/, `$1placeholder="${c?.turns.length ? 'Ask the Agent to do something else…' : 'Ask the Agent to do something with your notes…'}"`);
  return h; }; }
// the first-use notice says what goes with the Agent: the notes it reads
{ const f0 = cloudFacts; cloudFacts = function (p, o = {}) { const h = f0.apply(this, arguments); if (o.scope !== 'agent') return h;   // eslint-disable-line no-global-assign
  return h.replace(/(<dt>What’s sent<\/dt><dd>)[\s\S]*?(<\/dd>)/, `$1Your request, “${esc(o.q || '')}”, and the notes the Agent reads for it: each step says which.$2`); }; }

/* ---- asking it, and following it ---- */
const agtFinal = s => !!s && !['running', 'waiting'].includes(s.state);
{ const a0 = aicAsk; aicAsk = function (n, q, opt = {}) { return AIC.scope === 'agent' && !opt.turn ? agtAsk(n, q) : a0.apply(this, arguments); }; }   // eslint-disable-line no-global-assign
async function agtAsk(n, q) {
  q = String(q || '').trim(); if (!q || !n || AIC.busy || !ainOn() || !AGT.on) return;
  const can = agtCan(); if (!can.ok) { status(can.why); renderAll(); return; }
  if (!api()) { status('The Agent works in the NeuroVault app'); return; }
  if (!await cloudGate('qa', { q, scope: 'agent', note: n.title })) { AIC.focus = '#aic-in'; renderAll(); return; }
  const key = aicKey(n), c = aicChat(key), t = { q, scope: 'agent', answers: [], at: 0 }, a = { pending: 'agent', text: '', t0: Date.now(), by: agtBy(), agent: null };
  t.answers.push(a); c.turns.push(t);
  const seq = ++AIC.seq; AIC.busy = { noteId: n.id, key, ans: a, job: null, seq, agent: true }; AIC.stick = true; AIC.viewing = null; AIC.drafts[key] = ''; AIC.focus = '#aic-in'; renderAll();
  const r = await nv('ai_agent', q, rawId(n.id));
  if (AIC.busy?.seq !== seq) { if (!failed(r) && r.run) nv('ai_agent_stop', r.run, 'new'); return; }   // QC 112: said as why
  if (failed(r)) { agtEnd(a, { err: r.message || 'The Agent didn’t start.', code: r.code }); return; }
  AIC.busy.job = r.run; agtApply(a, r); agtPoll(a, seq);
}
async function agtPoll(a, seq) {
  const t0 = Date.now();
  while (Date.now() - t0 < 30 * 60e3) {   // a change can wait for you a while
    if (agtFinal(a.agent)) { agtEnd(a); return; }
    await new Promise(ok => setTimeout(ok, AIN_CHECK ? 5 : 300));
    if (AIC.busy?.seq !== seq) return;
    const s = await nv('ai_agent_poll', a.agent.run); if (AIC.busy?.seq !== seq) return;
    if (failed(s)) { agtEnd(a, { err: s.message }); return; }
    agtApply(a, s);
  }
  agtEnd(a, { err: 'It waited too long for you, so it stopped.' });
}
function agtApply(a, s) {   // the newest state; the changes it made reach this window's tasks and notes
  const was = a.agent ? JSON.stringify(a.agent) : '', done = a.agent?.writes?.length || 0;
  (s.writes || []).slice(done).forEach(w => {
    if (w.kind === 'task' && w.task) { if (!D.tasks.some(x => rawId(x.id) === w.task.id)) D.tasks.push(mapTask(w.task)); }
    if (w.kind === 'append' || w.kind === 'link') { const nn = D.notes.find(x => rawId(x.id) === w.note_id); if (nn) { nn.md = w.content; nn.html = null; nn.dirty = false; nn.docDirty = false; } }
    if (w.kind === 'tags') { const nn = D.notes.find(x => rawId(x.id) === w.note_id); if (nn && Array.isArray(w.all)) nn.tags = [...w.all]; }
  });
  a.agent = s; if (JSON.stringify(s) !== was) renderAll();
}
function agtEnd(a, o = {}) {
  if (o.err) { a.err = o.err; a.code = o.code || ''; }
  a.pending = null; a.text = a.agent?.answer || ''; a.secs = a.agent?.secs ?? aicSecs(a.t0);
  if (AIC.busy?.ans === a) AIC.busy = null;
  const s = a.agent; status(o.err ? 'The Agent didn’t finish: see the chat' : s?.state === 'done' ? 'The Agent is done' : s?.state === 'stopped' ? 'Stopped' : 'The Agent stopped: see the chat');
  renderAll();
}
{ const s0 = aicStop; aicStop = async function () { const b = AIC.busy; if (!b?.agent) return s0.apply(this, arguments);   // eslint-disable-line no-global-assign
  AIC.busy = null; AIC.seq++; const a = b.ans; renderAll();
  const s = b.job ? await nv('ai_agent_stop', b.job, 'you') : null; if (s && !failed(s)) a.agent = s; else if (a.agent) a.agent = { ...a.agent, state: 'stopped', pending: null };
  agtEnd(a); status(`Stopped after ${a.agent?.used || 0} step${a.agent?.used === 1 ? '' : 's'}. ${a.agent?.writes?.length ? 'The changes you added are kept: Undo all takes them out.' : 'Nothing was changed.'}`); }; }

/* ---- drawing a request: the steps, the change waiting, how it ended ---- */
const AGT_ICON = { search: 'search', read: 'doctext', sum: 'sparkles', task: 'tasks', append: 'listplus', tags: 'tag', link: 'link', lock: 'r67lock', limit: 'r67skip' };
const AGT_WRITE = ['task', 'append', 'tags', 'link'];
const agtDate = d => { if (!/^\d{4}-\d\d-\d\d$/.test(d || '')) return d || ''; const t = new Date(d + 'T12:00'); return t.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' }); };
function agtStep(s) {
  const st = s.st === 'done' && /^(Skipped|Wanted)/.test(s.text) ? 'skip' : s.st, icon = st === 'run' ? '<span class="aic-dots" aria-hidden="true"><i></i><i></i><i></i></span>'
    : ic(st === 'done' && AGT_WRITE.includes(s.k) && !/^Looked/.test(s.text) ? 'r67done' : st === 'skip' && [...AGT_WRITE, 'limit'].includes(s.k) ? 'r67skip' : AGT_ICON[s.k] || 'r67agent');
  return `<li class="agt-step is-${st}"><span class="agt-si">${icon}</span><span class="agt-st">${esc(s.text)}${st === 'run' ? '…' : ''}</span>${s.sub ? `<span class="agt-ss">${esc(s.sub)}</span>` : ''}</li>`;
}
const agtSteps = s => `<ol class="agt-steps" aria-label="What it did">${(s.steps || []).map(agtStep).join('')}</ol>`;
const agtLinkHtml = (line, to) => esc(line).replace(/\[\[([^\]|]+)(?:\|([^\]]*))?\]\]/g, (m, t, as) => t === to ? `<span class="agt-link">${esc(as || t)}</span>` : m);   // the new link, shown as a link
function agtCardMore(i, a, p) {   // add_tags and link_notes (the user's yes, after R67)
  const when = `change ${p.n} · at most ${a.agent.max_writes}`, tags = p.kind === 'tags';
  if (a.edit) return `<div class="agt-card is-edit" data-agt-card="${p.kind}" role="group" aria-label="${tags ? 'Edit the tags' : 'Edit where the link goes'}"><div class="agt-ch">${ic(AGT_ICON[p.kind])}<b>${tags ? `Edit the tags for “${esc(p.note_title)}”` : 'Where the link goes'}</b></div>
    <div class="agt-form">${tags ? `<label class="agt-fl"><span>Tags</span><input class="field agt-in" id="agt-e-tags" data-agt-f="tags" value="${esc(p.tags.join(', '))}" maxlength="300"></label>`
      : `<label class="agt-fl"><span>Where</span><select class="field agt-in" id="agt-e-where" data-agt-f="where"><option value="mention"${p.how === 'mention' ? ' selected' : ''}>Where it names “${esc(p.to_title)}”</option><option value="related"${p.how === 'related' ? ' selected' : ''}>On a “Related:” line at the end</option></select></label>`}</div>
    <div class="agt-cact"><button class="btn btn--primary btn--sm" data-act="agt-esave" data-i="${i}">${tags ? 'Add tags' : 'Add link'}</button><button class="btn btn--secondary btn--sm" data-act="agt-ecancel" data-i="${i}">Cancel</button></div></div>`;
  const head = tags ? `Add ${p.tags.length === 1 ? 'this tag' : 'these tags'} to “${p.note_title}”?` : `Link “${p.note_title}” to “${p.to_title}”?`;
  const body = tags ? `<div class="agt-chips">${(p.have || []).map(t => `<span class="chip chip--neutral agt-had">#${esc(t)}</span>`).join('')}${p.tags.map(t => `<span class="chip chip--accent agt-new">+ #${esc(t)}</span>`).join('')}</div>`
    : `${p.before ? `<div class="agt-was"><span class="agt-wl">Now</span><span>${esc(p.before)}</span></div>` : ''}<blockquote class="agt-quote">${agtLinkHtml(p.after, p.to_title)}</blockquote><div class="agt-ss">${p.how === 'mention' ? `Where it names “${esc(p.to_title)}”: no other words change.` : 'On a “Related:” line at the end: no other words change.'}</div>`;
  return `<div class="agt-card" data-agt-card="${p.kind}" role="group" aria-label="${esc(head)}"><div class="agt-ch">${ic(AGT_ICON[p.kind])}<b>${esc(head)}</b><span class="agt-cm">${when}</span></div><div class="agt-cb">${body}</div>
    <div class="agt-cact"><button class="btn btn--primary btn--sm" data-act="agt-add" data-i="${i}">${tags ? 'Add tags' : 'Add link'}</button><button class="btn btn--secondary btn--sm" data-act="agt-edit" data-i="${i}">Edit</button><button class="btn btn--ghost btn--sm" data-act="agt-skip" data-i="${i}">Skip</button></div></div>`;
}
// QC 112: a task's card lists every field it will set (title, priority, energy, due, project, its note, steps), and Edit changes each
const AGT_PRI = ['Low', 'Medium', 'High', 'Critical'], AGT_EN = ['low', 'medium', 'high'];
function agtTaskCard(i, a, p) {
  const when = `change ${p.n} · at most ${a.agent.max_writes}`, opt = (vals, cur, none) => `<option value=""${cur ? '' : ' selected'}>${none}</option>` + vals.map(v => `<option value="${v}"${v === cur ? ' selected' : ''}>${v[0].toUpperCase() + v.slice(1)}</option>`).join('');
  if (a.edit) return `<div class="agt-card is-edit" data-agt-card="task" role="group" aria-label="Edit the task"><div class="agt-ch">${ic(AGT_ICON.task)}<b>Edit the task</b></div>
    <div class="agt-form"><label class="agt-fl"><span>Task</span><input class="field agt-in" id="agt-e-title" data-agt-f="title" value="${esc(p.title)}" maxlength="200"></label>
      <label class="agt-fl"><span>Priority</span><select class="field agt-in" id="agt-e-priority" data-agt-f="priority">${opt(AGT_PRI, p.priority, 'Not set (Medium)')}</select></label>
      <label class="agt-fl"><span>Energy</span><select class="field agt-in" id="agt-e-energy" data-agt-f="energy">${opt(AGT_EN, p.energy, 'Not set')}</select></label>
      <label class="agt-fl"><span>Due</span><input class="field agt-in" id="agt-e-due" data-agt-f="due" type="date" value="${esc(p.due || '')}"></label>
      <label class="agt-fl"><span>Project</span><select class="field agt-in" id="agt-e-project" data-agt-f="project"><option value=""${p.project ? '' : ' selected'}>None</option>${(p.projects || []).map(n => `<option value="${esc(n)}"${n === p.project ? ' selected' : ''}>${esc(n)}</option>`).join('')}</select></label>
      <label class="agt-fl"><span>From</span><input class="field agt-in" id="agt-e-note" data-agt-f="note" value="${esc(p.note_title || '')}" placeholder="No note"></label>
      <label class="agt-fl"><span>Steps</span><textarea class="field agt-in" id="agt-e-steps" data-agt-f="steps" rows="3" placeholder="One step a line (optional)">${esc((p.steps || []).join('\n'))}</textarea></label></div>
    <div class="agt-cact"><button class="btn btn--primary btn--sm" data-act="agt-esave" data-i="${i}">Add task</button><button class="btn btn--secondary btn--sm" data-act="agt-ecancel" data-i="${i}">Cancel</button></div></div>`;
  const row = (k, v, none) => `<div class="agt-f" data-agt-field="${k}"><span class="agt-fk">${k}</span><span class="agt-fv${v ? '' : ' is-none'}">${v ? esc(v) : none}</span></div>`;
  const notes = [p.due_dropped ? 'It suggested a due date you didn’t ask for: left out.' : '', p.project_missing ? `There’s no project called “${p.project_missing}”: none set.` : ''].filter(Boolean);
  const body = `<div class="agt-task"><span class="agt-cbx" aria-hidden="true"></span><span>${esc(p.title)}</span></div><div class="agt-fields">${row('Priority', p.priority, 'Not set (Medium)')}${row('Energy', p.energy ? p.energy[0].toUpperCase() + p.energy.slice(1) : '', 'Not set')}${row('Due', p.due ? agtDate(p.due) : '', 'No due date')}${row('Project', p.project, 'None')}${row('From', p.note_title, 'No note')}</div>`
    + (p.steps?.length ? `<ol class="agt-tsteps" aria-label="Its steps">${p.steps.map(s => `<li>${esc(s)}</li>`).join('')}</ol>` : '') + (notes.length ? `<p class="agt-ss agt-fnote">${esc(notes.join(' '))}</p>` : '');
  return `<div class="agt-card" data-agt-card="task" role="group" aria-label="Add this task?"><div class="agt-ch">${ic(AGT_ICON.task)}<b>Add this task?</b><span class="agt-cm">${when}</span></div><div class="agt-cb">${body}</div>
    <div class="agt-cact"><button class="btn btn--primary btn--sm" data-act="agt-add" data-i="${i}">Add task</button><button class="btn btn--secondary btn--sm" data-act="agt-edit" data-i="${i}">Edit</button><button class="btn btn--ghost btn--sm" data-act="agt-skip" data-i="${i}">Skip</button></div></div>`;
}
function agtCard0(i, a, p) {
  if (p.kind === 'task') return agtTaskCard(i, a, p);
  if (p.kind === 'tags' || p.kind === 'link') return agtCardMore(i, a, p);
  const task = p.kind === 'task', when = `change ${p.n} · at most ${a.agent.max_writes}`;
  if (a.edit) return `<div class="agt-card is-edit" data-agt-card="${p.kind}" role="group" aria-label="${task ? 'Edit the task' : 'Edit what it adds'}"><div class="agt-ch">${ic(AGT_ICON[p.kind])}<b>${task ? 'Edit the task' : `Edit what goes at the end of “${esc(p.note_title)}”`}</b></div>
    <div class="agt-form">${task ? `<label class="agt-fl"><span>Task</span><input class="field agt-in" id="agt-e-title" data-agt-f="title" value="${esc(p.title)}" maxlength="200"></label><label class="agt-fl"><span>Due</span><input class="field agt-in" id="agt-e-due" data-agt-f="due" type="date" value="${esc(p.due || '')}"></label><label class="agt-fl"><span>From</span><input class="field agt-in" id="agt-e-note" data-agt-f="note" value="${esc(p.note_title || '')}" placeholder="No note"></label>`
      : `<label class="agt-fl"><span>Text</span><textarea class="field agt-in" id="agt-e-text" data-agt-f="text" rows="3" maxlength="4000">${esc(p.text)}</textarea></label>`}</div>
    <div class="agt-cact"><button class="btn btn--primary btn--sm" data-act="agt-esave" data-i="${i}">${task ? 'Add task' : 'Add it'}</button><button class="btn btn--secondary btn--sm" data-act="agt-ecancel" data-i="${i}">Cancel</button></div></div>`;
  const body = task ? `<div class="agt-task"><span class="agt-cbx" aria-hidden="true"></span><span>${esc(p.title)}</span></div>${p.due || p.note_title ? `<div class="agt-chips">${p.due ? `<span class="chip chip--neutral">Due ${esc(agtDate(p.due))}</span>` : ''}${p.note_title ? `<span class="chip chip--neutral">From ${esc(p.note_title)}</span>` : ''}</div>` : ''}`
    : `<blockquote class="agt-quote">${esc(p.text)}</blockquote>`;
  const head = task ? 'Add this task?' : `Add this to the end of “${p.note_title}”?`;
  return `<div class="agt-card" data-agt-card="${p.kind}" role="group" aria-label="${esc(head)}"><div class="agt-ch">${ic(AGT_ICON[p.kind])}<b>${esc(head)}</b><span class="agt-cm">${when}</span></div><div class="agt-cb">${body}</div>
    <div class="agt-cact"><button class="btn btn--primary btn--sm" data-act="agt-add" data-i="${i}">${task ? 'Add task' : 'Add it'}</button><button class="btn btn--secondary btn--sm" data-act="agt-edit" data-i="${i}">Edit</button><button class="btn btn--ghost btn--sm" data-act="agt-skip" data-i="${i}">Skip</button></div></div>`;
}
/* ---- R69 · prompt-injection safety (decided 2026-10-20): a card says which notes the run had read ("After reading: …"),
   and turns amber with a warning line when one of them seems to talk to an AI, when the change is for a note the request didn't
   name, or when a web address was left out of what it wanted to write. Add stays one click. ---- */
function agtGuardHtml(p) {
  const after = (p.after_read || []).map(r => `${esc(r.title)}${r.origin ? ` (${r.origin === 'web' ? 'from the web' : 'imported'})` : ''}`);
  const warn = (p.warn || []).map(w => `<li>${esc(w)}</li>`).join('');
  return (after.length ? `<p class="agt-ss agt-after" data-agt-after>After reading: ${after.join(' · ')}</p>` : '')
    + (warn ? `<div class="agt-warn" role="alert" data-agt-warn>${ic('alert')}<ul>${warn}</ul></div>` : '');
}
/* ---- QC 117 (trial feedback: "what am I even being asked"): R68's one-time question, and R69's for a note from outside, are asked
   right here in the run, in plain words, with the same three answers as everywhere else; the run carries on after one ---- */
function agtCloudCard(i, p) {
  const co = esc(p.company || 'the cloud'), nm = esc(p.project || 'this project'), o = p.outside, notes = (p.notes || []).map(t => `“${esc(t)}”`).join(', ') || 'a note';
  const lead = o ? `The Agent wants to read “${nm}”, which came from ${o === 'web' ? 'the web' : 'a file you imported'}, so it may hold text written to trick an AI. To read it, it has to send its text to ${co}, a cloud AI.`
    : `The Agent wants to read ${notes} in ${nm}. To read it, it has to send its text to ${co}, a cloud AI, and this is the first time for ${nm}.`;
  const b = (v, cls, t) => `<button class="btn btn--${cls} btn--sm" data-act="agt-cloud" data-v="${v}" data-i="${i}">${t}</button>`;
  return `<div class="agt-card" data-agt-card="cloud" role="group" aria-label="Send to ${co}?"><div class="agt-ch">${ic(AGT_ICON.lock)}<b>Send ${o ? `“${nm}”` : `notes from ${nm}`} to ${co}?</b></div>
    <div class="agt-cb"><p class="set-desc">${lead} Nothing has been sent yet.</p><p class="set-desc">Pick one, and the Agent carries on. “Keep it on this PC” stops it here: ${o ? 'that note' : nm} stays off cloud AI.</p></div>
    <div class="agt-cact">${b('once', 'primary', `Send once to ${co}`)}${b('always', 'secondary', 'Always allow for this project')}${b('keep', 'secondary', 'Keep it on this PC')}</div></div>`;
}
function agtCard(i, a, p) {
  if (p.kind === 'cloud') return agtCloudCard(i, p);
  const h = agtCard0(i, a, p); if (a.edit || !(p.after_read?.length || p.warn?.length)) return h;
  const j = h.lastIndexOf('<div class="agt-cact">'); if (j < 0) return h;
  const out = h.slice(0, j) + agtGuardHtml(p) + h.slice(j);
  return p.amber ? out.replace('<div class="agt-card"', '<div class="agt-card is-amber"') : out;
}
function agtChanged(s) {   // "Added the task “Review the UI” (High priority · low energy), 2 tags and 1 link" (QC 112: a task names its fields)
  const w = (s.writes || []).filter(x => !x.undone), of = k => w.filter(x => x.kind === k), parts = [], n = (c, one, many) => `${c} ${c === 1 ? one : many}`;
  if (of('task').length) parts.push(of('task').length > 2 ? n(of('task').length, 'task', 'tasks') : of('task').map(t => `the task “${t.title}”${t.said ? ` (${t.said})` : ''}`).join(' and '));
  const tg = of('tags').reduce((x, y) => x + (y.tags?.length || 1), 0); if (tg) parts.push(n(tg, 'tag', 'tags'));
  if (of('link').length) parts.push(n(of('link').length, 'link', 'links'));
  if (of('append').length) parts.push(of('append').length === 1 ? '1 addition to a note' : `${of('append').length} additions to notes`);
  return parts.length ? `Added ${parts.length > 1 ? parts.slice(0, -1).join(', ') + ' and ' + parts[parts.length - 1] : parts[0]}` : 'Added nothing';
}
function agtUndo(a, i) {
  if (a.undone) return `<p class="agt-undone" role="status">${esc(a.undone)}</p>`;
  return a.agent?.writes?.length ? `<button class="btn btn--secondary btn--sm" data-act="agt-undo" data-i="${i}">Undo all</button>` : '';
}
function agtTurn(t, i, all) {
  const a = t.answers[t.at] || {}, s = a.agent, newest = all && i === all.length - 1, q = `<div class="aic-q">${esc(t.q)}<span class="aic-qscope">for the Agent</span></div>`;
  const wrap = body => `<div class="aic-turn agt-turn${newest ? ' is-newest' : ''}" data-aic-turn="${i}" data-agt-turn>${q}<div class="aic-a" data-aic-a="${i}">${body}</div></div>`;
  if (a.err && (!s || !agtFinal(s))) return wrap(`<div class="agt-note is-warn" role="alert">${ic('alert')}<div><b>${esc(a.err)}</b>${a.code === 'off' ? `<div class="agt-nact"><button class="btn btn--secondary btn--sm" data-act="agt-setup">Turn it on</button></div>` : ''}</div></div>`);
  if (!s) return wrap(`<div class="aic-think" role="status"><span class="aic-dots" aria-hidden="true"><i></i><i></i><i></i></span><span>Starting the Agent</span></div>`);
  if (s.state === 'notools') { const b = agtBetter(); return wrap(`<div class="agt-note is-warn" role="alert" data-agt-notools>${ic('alert')}<div><b>${esc(s.error)}</b><span class="set-desc">Pick a model that can: Qwen3.5 4B or 9B on this PC, or any cloud model. Nothing was changed.</span><div class="agt-nact">${b ? `<button class="btn btn--secondary btn--sm" data-act="agt-use" data-v="${esc(b.key)}">Use ${esc(b.name)}</button>` : ''}<button class="btn btn--ghost btn--sm" data-act="agt-setup">AI models…</button></div></div></div>`); }
  const nw = (s.writes || []).length, step = Math.max(1, s.used);
  if (!agtFinal(s)) {   // working, or a change waiting for you
    const wait = s.state === 'waiting' && s.pending;
    const run = `<div class="agt-run" role="status"><span class="agt-tag">${ic('r67agent')}Agent</span><span class="num">Step ${step} of ${s.budget}</span><span aria-hidden="true">·</span><span>${wait ? 'waiting for you' : nw ? `${nw} of ${s.max_writes} changes` : 'no changes yet'}</span></div>`;
    return wrap(`<div class="agt-runbox">${run}${agtSteps(s)}${wait ? agtCard(i, a, s.pending) : ''}</div>`);
  }
  const reads = s.reads ? ` · read ${s.reads} note${s.reads === 1 ? '' : 's'}${s.sent_to ? ` (sent to ${esc(s.sent_to)})` : ''}` : '';
  const sum = `<details class="agt-sum"${s.state === 'done' ? '' : ' open'}><summary><span>${s.used} step${s.used === 1 ? '' : 's'}${reads} · ${nw} change${nw === 1 ? '' : 's'}</span>${ic('down')}</summary>${agtSteps(s)}</details>`;
  const changed = `${agtChanged(s)}. Skipped ${s.skipped}. Nothing else changed.`;
  let end;
  if (s.state === 'done') end = `<div class="agt-note is-ok" role="status">${ic('r67done')}<div><b>${esc(changed)}</b>${nw || a.undone ? `<div class="agt-nact">${agtUndo(a, i)}</div>` : ''}</div></div>`;
  else if (s.state === 'limit') end = `<div class="agt-note is-warn" role="status">${ic('alert')}<div><b>${esc(s.error)}</b><span class="set-desc">${esc(agtChanged(s))}; nothing else changed. Carry on to give it ${s.max_steps} more steps, from where it stopped.</span><div class="agt-nact"><button class="btn btn--secondary btn--sm" data-act="agt-carry" data-i="${i}">Carry on</button>${agtUndo(a, i)}</div></div></div>`;
  else if (s.state === 'wlimit') end = `<div class="agt-note is-warn" role="status">${ic('alert')}<div><b>${esc(s.error)}</b><span class="set-desc">It made ${nw} changes, each one you said yes to. Nothing more was changed.</span><div class="agt-nact">${agtUndo(a, i)}</div></div></div>`;
  else if (s.state === 'stopped') end = `<div class="agt-note" role="status">${ic('r67skip')}<div><b>Stopped after ${s.used} step${s.used === 1 ? '' : 's'}${{ you: ': you pressed Stop (or Esc)', new: ': another request took its place', closed: ': its chat was closed' }[s.why] || ''}.</b><span class="set-desc">${nw ? `${esc(agtChanged(s))}: you said yes to ${nw === 1 ? 'it' : 'each'}. Undo all takes ${nw === 1 ? 'it' : 'them'} out.` : 'Nothing was changed.'}</span>${nw ? `<div class="agt-nact">${agtUndo(a, i)}</div>` : ''}</div></div>`;
  else if (s.code === 'noreply') { const b = agtBetter(); end = `<div class="agt-note is-warn" role="alert" data-agt-noreply>${ic('alert')}<div><b>${esc(s.error)}</b><span class="set-desc">Some models on this PC don’t call tools every time. Try again, or use a model that handles tools better.</span><div class="agt-nact">${b ? `<button class="btn btn--secondary btn--sm" data-act="agt-use" data-v="${esc(b.key)}">Use ${esc(b.name)}</button>` : ''}<button class="btn btn--ghost btn--sm" data-act="agt-setup">AI models…</button></div></div></div>`; }
  else end = `<div class="agt-note is-warn" role="alert">${ic('alert')}<div><b>${esc(s.error || a.err || 'The Agent stopped.')}</b>${nw ? `<div class="agt-nact">${agtUndo(a, i)}</div>` : ''}</div></div>`;
  if (!s.used && ['stopped', 'error'].includes(s.state) && s.code !== 'notools') end += agtLoadLine(true);   // QC 112
  if (s.state === 'done' && s.code === 'notool') { const b = agtBetter();   // QC 112: words, but no tool: nothing done, and said
    end = `<div class="agt-note is-warn" role="status" data-agt-notool>${ic('alert')}<div><b>It answered without using a tool, so nothing was changed.</b><span class="set-desc">If you asked it to do something, a model that handles tools better may do it.</span><div class="agt-nact">${b ? `<button class="btn btn--secondary btn--sm" data-act="agt-use" data-v="${esc(b.key)}">Use ${esc(b.name)}</button>` : ''}</div></div></div>`; }
  const ans = s.state === 'done' && s.answer ? `<div class="aic-body agt-ans">${aicMd(s.answer)}</div>` : '';
  return wrap(`<div class="agt-runbox is-done">${sum}${ans}${end}<div class="agt-acts"><span class="agt-meta">Agent · ${esc(a.by || s.by || '')} · <span class="num">${s.secs || a.secs || 0} s</span></span></div></div>`);
}
{ const t0 = aicTurnHtml; aicTurnHtml = function (t, i, all) { return t.scope === 'agent' ? agtTurn(t, i, all) : t0.apply(this, arguments); }; }   // eslint-disable-line no-global-assign

/* ---- Add, Edit, Skip, Undo all, Carry on; a model it can use ---- */
const agtAns = i => { const n = note(), t = n && aicChat(aicKey(n)).turns[i]; return t?.scope === 'agent' ? t.answers[t.at] : null; };
async function agtSaveFirst(p) {   // a change to a note you may be typing in: what you typed is saved first
  if (!['append', 'link', 'tags'].includes(p?.kind)) return; const nn = D.notes.find(x => rawId(x.id) === p.note_id); if (!nn || !(nn.dirty || nn.docDirty)) return;
  if (nn.docDirty && typeof syncDoc === 'function') syncDoc(nn); if (typeof saveNote === 'function') await saveNote(nn);
}
async function agtChange(i, choice, fields) {
  const a = agtAns(i), s = a?.agent; if (!s?.pending) return;
  if (choice === 'add') await agtSaveFirst(s.pending);
  a.edit = false; const r = await nv('ai_agent_change', s.run, choice, fields || null);
  if (failed(r)) { toast(r.message || 'That didn’t work.'); return; }
  agtApply(a, r); if (s.pending?.kind === 'cloud' || ['once', 'always', 'keep'].includes(choice)) { status(choice === 'keep' ? 'Kept on this PC: nothing was sent' : choice === 'always' ? 'Allowed for this project: it won’t ask again there' : 'Sent once: the Agent carries on'); AIC.stick = true; renderAll(); return; }
  status(choice === 'skip' ? 'Skipped: nothing added' : { task: 'Task added', tags: `Tags added to “${s.pending.note_title}”`, link: `Linked “${s.pending.note_title}” to “${s.pending.to_title}”` }[s.pending.kind] || `Added to the end of “${s.pending.note_title}”`);
  AIC.stick = true; renderAll();
}
app.addEventListener('click', e => {
  const t = e.target.closest?.('[data-act^="agt-"]'); if (!t) return; e.preventDefault(); e.stopImmediatePropagation();
  const act = t.dataset.act, i = +t.dataset.i, a = Number.isInteger(i) ? agtAns(i) : null;
  if (act === 'agt-add') { agtChange(i, 'add'); return; }
  if (act === 'agt-skip') { agtChange(i, 'skip'); return; }
  if (act === 'agt-cloud') { agtChange(i, t.dataset.v); return; }
  if (act === 'agt-edit' && a) { a.edit = true; S.focus = { sel: { task: '#agt-e-title', tags: '#agt-e-tags', link: '#agt-e-where' }[a.agent.pending.kind] || '#agt-e-text' }; renderAll(); return; }
  if (act === 'agt-ecancel' && a) { a.edit = false; S.focus = { sel: `[data-act="agt-edit"][data-i="${i}"]` }; renderAll(); return; }
  if (act === 'agt-esave' && a) { const f = {}; app.querySelectorAll('[data-agt-f]').forEach(x => { f[x.dataset.agtF] = x.value; }); agtChange(i, 'add', f); return; }
  if (act === 'agt-undo' && a?.agent) { nv('ai_agent_undo', a.agent.run).then(r => { if (failed(r)) { toast(r.message); return; }
    D.tasks = D.tasks.filter(x => !(r.tasks || []).includes(rawId(x.id)));
    Object.entries(r.notes || {}).forEach(([id, md]) => { const nn = D.notes.find(x => rawId(x.id) === +id); if (nn) { nn.md = md; nn.html = null; nn.dirty = false; nn.docDirty = false; } });
    Object.entries(r.tags || {}).forEach(([id, tg]) => { const nn = D.notes.find(x => rawId(x.id) === +id); if (nn) nn.tags = [...tg]; });
    a.undone = r.kept?.length ? `Undone ${r.undone} of ${r.undone + r.kept.length}. Left as it is: ${r.kept.join('; ')}.` : 'Undone: everything it changed is gone. Your notes and tasks are as they were.';
    a.agent = { ...a.agent, writes: (a.agent.writes || []).map(w => ({ ...w, undone: true })) }; status('Undid the changes from this request'); renderAll(); }); return; }
  if (act === 'agt-carry' && a?.agent && !AIC.busy) { nv('ai_agent_carry', a.agent.run).then(r => { if (failed(r)) { toast(r.message); return; }
    const n = note(), seq = ++AIC.seq; a.pending = 'agent'; AIC.busy = { noteId: n.id, key: aicKey(n), ans: a, job: r.run, seq, agent: true }; agtApply(a, r); status('Carrying on: 8 more steps'); agtPoll(a, seq); }); return; }
  if (act === 'agt-warm') { nv('ai_agent_warm').then(async r => { if (failed(r)) { toast(r.message); return; } status(r.loading ? `Loading ${r.model}: it’s ready in a moment` : `${r.model || 'The model'} is ready`); await aiRefresh(); renderAll(); }); return; }
  if (act === 'agt-use') { ainSetRoute('qa', t.dataset.v).then(ok => { if (ok) { status('Ask now uses a model that can use tools'); AIC.focus = '#aic-in'; renderAll(); } }); return; }
  if (act === 'agt-setup') { openSettings('ai'); AIS.tab = 'jobs'; renderAll(); if (typeof aisGoto === 'function') aisGoto('agent'); return; }
  if (act === 'agt-on') { AGT.on = !AGT.on; if (!AGT.on && AIC.scope === 'agent') AIC.scope = 'note'; if (api() && !AI_CHECK) saveSettings({ ai_agent: AGT.on });
    status(AGT.on ? 'The Agent is on: pick it in Ask, beside This note' : 'The Agent is off'); S.focus = { sel: '[data-act="agt-on"]' }; renderAll(); return; }
  if (act === 'agt-tool') { const k = t.dataset.v; AGT.tools = AGT.tools.includes(k) ? AGT.tools.filter(x => x !== k) : AGT_TOOLS.map(x => x[0]).filter(x => x === k || AGT.tools.includes(x));
    if (api() && !AI_CHECK) saveSettings({ ai_agent_tools: AGT.tools }); status('Saved'); S.focus = { sel: `[data-act="agt-tool"][data-v="${k}"]` }; renderAll(); return; }
  if (act === 'agt-lock') status('Always on: nothing is changed until you press Add');
}, true);
app.addEventListener('keydown', e => {   // Esc in an edit card: back to the card (an answer that's running: Ask's own Esc stops it)
  if (e.key !== 'Escape' || !e.target.closest?.('.agt-card.is-edit')) return; const i = +e.target.closest('[data-aic-turn]')?.dataset.aicTurn, a = agtAns(i); if (!a) return;
  e.preventDefault(); e.stopImmediatePropagation(); a.edit = false; S.focus = { sel: `[data-act="agt-edit"][data-i="${i}"]` }; renderAll();
}, true);

/* ---- Settings → AI models → Jobs and answers → Agent ---- */
function agtSetHtml() {
  const tog = (id, lab, desc, val, act, v, lock) => `<div class="set-row" data-agt-row="${id}"><div><div class="set-label" id="agt-l-${id}">${lab}</div><div class="set-desc">${desc}</div></div><button class="toggle" role="switch" aria-checked="${val}" aria-labelledby="agt-l-${id}" data-act="${act}"${v ? ` data-v="${v}"` : ''}${lock ? ' aria-disabled="true"' : ''}></button></div>`;
  return tog('on', 'Agent', 'Off until you turn it on. In Ask, it’s the third choice beside This note and My newest notes. It needs a model that can use tools: Qwen3.5 4B or 9B on this PC, or a cloud model.', AGT.on, 'agt-on')
    + (AGT.on ? `<div class="eyebrow mt-4">What it may do</div>${AGT_TOOLS.map(([k, l, d]) => tog(k, l, d, AGT.tools.includes(k), 'agt-tool', k)).join('')}
    ${tog('ask', 'Ask before every change', 'Always on: nothing is added until you press Add.', true, 'agt-lock', '', true)}
    <div class="set-row" data-agt-row="limits"><div><div class="set-label">Limits for one request</div><div class="set-desc">At most 8 steps and 3 changes. It never deletes, runs nothing, and touches nothing but your notes and tasks.</div></div><span class="set-desc num agt-lim">8 steps · 3 changes</span></div>` : '');
}
AIS_SECS.splice(AIS_SECS.findIndex(s => s[0] === 'chat'), 0, ['agent', 'Agent', 'Ask it to do something with your notes: it searches, reads and adds, and asks before every change.', 'jobs']);
AIS_BODY.agent = agtSetHtml;
/* ==== end Build N · R67 ==== */
