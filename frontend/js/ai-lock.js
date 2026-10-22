/* ==== R68 · keep a project, a folder or a note off cloud AI (ai_lock.py; the R68 decisions, 2026-10-19: "execute on them";
   the drawn design is mockup R68, commit ae0edc0) ====
   - What can be kept off: projects, folders and single notes. A lock covers everything inside it. It is set from a project's, a
     folder's or a note's ⋮ menu (and the note header's), or in Settings → AI models → Overview, which lists what's kept off with
     "Allow cloud AI". The lock lives in the vault (.neurovault/ai-lock.json) and is in the Timeline.
   - A lock badge on what's kept off (a quieter one on the notes inside it), and "Kept off cloud AI" in the note's header.
   - In a kept-off note: Ask says so and offers "Use local AI" / "Unlock for this question" (it asks every time, and the lock
     stays); Summarise and Tidy up quietly run on this PC and say so; the model menu greys the cloud models ("kept off here");
     attachments stay on this PC. "My newest notes" leaves kept-off notes out for a cloud model.
   - The default is to ask the first time a cloud model is asked about a project: "Send to <company>" or "Keep it on this PC".
   The backend refuses to send a kept-off note to the cloud whatever the page does (local_ai.Manager._cloud_run). This file is
   the page's side: what's kept off, the menus, the badges, the notices and the settings. */
'use strict';
const LK = { items: [], ask: true, once: true, first: null, next: null, outside: {} };   // outside (R69): { 'n-7': 'web' | 'imported' }: notes whose words came from outside   // items: [{kind, id, page, name}] (page: p-1, f-3, n-7)
Object.assign(ICON, { lock: '<rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>' });

/* ---- what is kept off ---- */
const lkPageId = (kind, id) => ({ project: 'p-', folder: 'f-', note: 'n-' }[kind] + id);
const lkKind = page => String(page).startsWith('p-') ? 'project' : String(page).startsWith('f-') ? 'folder' : 'note';
const lkBy = page => LK.items.find(i => i.page === page) || null;
function lkItemFor(n) { if (!n || !LK.items.length) return null; return lkBy(n.id) || ancestors(n.folder).map(lkBy).find(Boolean) || null; }   // the entry that keeps this note off
function lkFolderItem(id) { return LK.items.length && id ? ancestors(id).map(lkBy).find(Boolean) || null : null; }
function lkName(page) { const k = lkKind(page); return (k === 'project' ? D.projects.find(p => p.id === page)?.name : k === 'folder' ? folderById(page)?.name : D.notes.find(n => n.id === page)?.title) || 'It'; }
const lkWhat = (it, n) => !it ? '' : it.kind === 'note' ? 'This note' : it.kind === 'folder' ? `The ${it.name} folder` : it.name;   // as the backend says it
const lkHere = () => { const n = UI.view === 'notes' ? note() : null; return n && !S.modal && AIC.scope !== 'all' ? lkItemFor(n) : null; };   // a kept-off note is open (and Ask reads it)
function lkApply(r) {
  LK.items = (r.items || []).filter(i => i.id).map(i => ({ kind: i.kind, id: i.id, page: lkPageId(i.kind, i.id), name: i.name || '' }));
  if (typeof r.ask === 'boolean') LK.ask = r.ask;
  if (typeof r.once === 'boolean') LK.once = r.once;
  if (Array.isArray(r.outside)) LK.outside = Object.fromEntries(r.outside.map(o => [lkPageId('note', o.id), o.origin]));
  renderAll();
}
async function lkLoad() { if (!(VAULT.live && api())) return; const r = await nv('ai_lock_status'); if (!failed(r)) lkApply(r); }
async function lkToggle(page, on) {
  const kind = lkKind(page), id = rawId(page), name = lkName(page); on = on ?? !lkBy(page);
  if (VAULT.live && api()) { const r = await nv('ai_lock_set', kind, id, on); if (failed(r)) { toast(r.message || 'That didn’t work.'); return; } LK.items = (r.items || []).filter(i => i.id).map(i => ({ kind: i.kind, id: i.id, page: lkPageId(i.kind, i.id), name: i.name || '' })); }
  else LK.items = on ? [...LK.items.filter(i => i.page !== page), { kind, id, page, name }] : LK.items.filter(i => i.page !== page);
  S.ctx = null; S.menu = false;
  status(on ? `${name} is kept off cloud AI. AI on this PC still works there.` : `${name}: cloud AI allowed again`); renderAll();
}
const lkBmReload = () => { if (UI.view === 'history' && typeof S.bm === 'object') S.bm.actAt = 0; };
{ const l0 = loadVault; loadVault = async function () { const ok = await l0.apply(this, arguments); if (ok) lkLoad(); return ok; }; }   // eslint-disable-line no-global-assign

/* ---- the badge, the header, the menus ---- */
const lkBadge = (inside, what) => `<span class="lk-badge${inside ? ' is-inside' : ''}" role="img" aria-label="Kept off cloud AI" data-tip="${esc(what || 'Kept off cloud AI')}">${ic('lock')}</span>`;
{ const t0 = treeRow; treeRow = function (kind, id) { const h = t0.apply(this, arguments); if (!LK.items.length || !h.includes('data-tree=')) return h;   // eslint-disable-line no-global-assign
  const it = kind === 'note' ? lkItemFor(D.notes.find(n => n.id === id)) : kind === 'folder' ? lkFolderItem(id) : null; if (!it) return h;
  return h.replace(/<\/div>$/, `${lkBadge(it.page !== id, it.page === id ? 'Kept off cloud AI' : `Kept off cloud AI by ${it.name}`)}</div>`); }; }
{ const h0 = renderHeader; renderHeader = function () { let h = h0.apply(this, arguments); const n = UI.view === 'notes' ? note() : null; if (!n) return h;   // eslint-disable-line no-global-assign
  const it = lkItemFor(n), on = it?.page === n.id;
  const item = `<button class="menu-item" role="menuitem" data-act="lk-set" data-v="${n.id}"${it && !on ? ' aria-disabled="true"' : ''}>${ic('lock')}${on ? 'Allow cloud AI again' : it ? `Kept off by ${esc(it.name)}` : 'Keep off cloud AI'}</button>`;
  h = h.replace('<button class="menu-item" role="menuitem" data-act="read"', item + '<button class="menu-item" role="menuitem" data-act="read"');
  const ob = LK.outside[n.id], obChip = ob ? `<span class="chip chip--neutral lk-chip" data-ob-chip="${ob}" data-tip="${ob === 'web' ? 'Its words came from the web.' : 'Made from a file you imported.'} A cloud model asks you before it reads it.">${ic(ob === 'web' ? 'r50globe' : 'file')}${ob === 'web' ? 'From the web' : 'Imported'}</span>` : '';   // R69
  return it || ob ? h.replace('<div class="header-actions', `${it ? `<span class="chip chip--neutral lk-chip" data-lk-chip>${ic('lock')}Kept off cloud AI</span>` : ''}${obChip}<div class="header-actions`) : h; }; }
{ const c0 = renderContextMenu; renderContextMenu = function () { const h = c0.apply(this, arguments), c = S.ctx; if (!c || !['folder', 'note'].includes(c.kind)) return h;   // eslint-disable-line no-global-assign
  const it = c.kind === 'note' ? lkItemFor(D.notes.find(n => n.id === c.id)) : lkFolderItem(c.id), on = it?.page === c.id, off = it && !on;
  const item = `<button class="menu-item" role="menuitem" data-act="lk-set" data-v="${c.id}"${off ? ' aria-disabled="true"' : ''}>${ic('lock')}${on ? 'Allow cloud AI again' : off ? `Kept off by ${esc(it.name)}` : 'Keep off cloud AI'}</button>`;
  return h.replace(/(<div class="menu-sep"><\/div><button class="menu-item menu-item--danger")/, `<div class="menu-sep"></div>${item}$1`); }; }

/* ---- Ask: the model menu, the attachments line, the notice, the answer's line ---- */
{ const m0 = ainModels; ainModels = function () { const l = m0.apply(this, arguments), it = lkHere(); if (!it) return l;   // eslint-disable-line no-global-assign
  return l.map(m => m.cloud ? { ...m, ok: false, off: 'kept off here', why: `${lkWhat(it)} is kept off cloud AI` } : m); }; }
{ const a0 = aicMenuHtml; aicMenuHtml = function () { let h = a0.apply(this, arguments), it = lkHere(); if (!it || !h.includes('Model for Ask')) return h;   // eslint-disable-line no-global-assign
  h = h.replace(/(<button class="menu-item cl-mi"[^>]*data-v="cloud:[^"]*"[\s\S]*?)<\/button>/g, '$1<span class="aic-where">kept off here</span></button>');   // the grouped list's cloud rows say it too
  return h.replace('<div class="aic-mlabel">Model for Ask</div>', `<div class="aic-mlabel">Model for Ask</div><div class="lk-mnote">${ic('lock')}<span>${esc(lkWhat(it))} is kept off cloud AI: only models on this PC answer here.</span></div>`); }; }
{ const l0 = cloudAttLine; cloudAttLine = function () { const it = lkHere(), n = note(); if (!it || !CLOUD.att || ainRoute('qa')?.kind !== 'cloud') return l0.apply(this, arguments);   // eslint-disable-line no-global-assign
  const all = cloudAttAll(n); if (!all.length) return l0.apply(this, arguments); const names = all.map(cloudAttName), shown = names.length > 2 ? `${names.slice(0, 2).join(', ')} and ${names.length - 2} more` : names.join(' and ');
  return `<div class="lk-att" role="note" data-lk-att>${ic('lock')}<span>${esc(lkWhat(it))} is kept off cloud AI: its attachment${names.length === 1 ? '' : 's'}, ${esc(shown)}, stay${names.length === 1 ? 's' : ''} on this PC too.</span></div>`; }; }
const lkChatCard = (a, i) => { const L = a.lock;
  if (L.code === 'cloud_first') return `<div class="lk-note" role="status" data-lk-card="first">${ic('lock')}<div><b>Waiting for your answer</b><span class="set-desc">Notes from ${esc(L.project)} haven’t been sent to ${esc(L.company)} yet, so nothing was sent.</span><div class="lk-act"><button class="btn btn--primary btn--sm" data-act="lk-first-open" data-v="${i}">Choose…</button></div></div></div>`;
  return `<div class="lk-note" role="status" data-lk-card="locked">${ic('lock')}<div><b>${esc(a.err)}</b><span class="set-desc">A model on this PC can still answer it.</span><div class="lk-act"><button class="btn btn--primary btn--sm" data-act="lk-local" data-v="${i}">Use local AI</button>${LK.once && L.can_unlock ? `<button class="btn btn--secondary btn--sm" data-act="lk-once" data-v="${i}">Unlock for this question</button>` : ''}</div></div></div>`; };
const lkKeptLine = a => `<div class="lk-line" data-lk-line>${ic('lock')}<span>Answered on this PC by ${esc(a.by || 'a model')}: ${esc(a.kept)} is kept off cloud AI.</span></div>`;
function lkRetryTurn(noteId, t, how) {   // asks the same question again (one answer replaced), on this PC or unlocked for it
  const n = D.notes.find(x => x.id === noteId) || note(); if (!n || !t) return; t.answers.splice(t.at, 1); t.at = Math.max(0, t.answers.length - 1); if (how) LK.next = how; aicAsk(n, t.q, { turn: t });
}

/* ---- the first-use question (the default is to ask once for each project) ---- */
function lkFirst(j, retry, decline) {   // true when it was a first-use refusal (the dialog is open)
  if (j?.code !== 'cloud_first') return false;
  const L = j.lock || {}; LK.first = { project: L.project || 'this project', key: L.project_key || '', company: L.company || 'the cloud', outside: L.outside || '', retry, decline }; renderAll(); return true;
}
{ const m0 = renderModal; renderModal = function () { const h = m0.apply(this, arguments), f = LK.first; if (!f) return h;   // eslint-disable-line no-global-assign
  if (f.outside) return h + dlg({ id: 'lock-first', size: 'sm', role: 'alertdialog', keep: true, title: `Send “${esc(f.project)}” to ${esc(f.company)}?`, descId: 'lock-first-d',   // R69: a note from outside
    x: 'lk-first-no', xLabel: 'Close: nothing is sent', xTitle: 'Close (Esc): nothing is sent',
    body: `<p class="set-desc" id="lock-first-d">${esc(f.project)} came from ${f.outside === 'web' ? 'the web' : 'a file you imported'}, so it may hold text written to trick an AI. ${esc(f.company)} would get your question and this note.</p><p class="set-desc">Pick what NeuroVault should do with it. “Always” covers the notes in its project, and you can change it in Settings → AI models.</p>`,
    others: [`<button class="btn btn--secondary" data-act="lk-first-keep">Keep it on this PC</button>`, `<button class="btn btn--secondary" data-act="lk-first-always">Always allow for this project</button>`],
    main: `<button class="btn btn--primary" data-act="lk-first-once">Send once to ${esc(f.company)}</button>` });
  return h + dlg({ id: 'lock-first', size: 'sm', role: 'alertdialog', keep: true, title: `Send notes from ${esc(f.project)} to ${esc(f.company)}?`, descId: 'lock-first-d',
    x: 'lk-first-no', xLabel: 'Close: nothing is sent', xTitle: 'Close (Esc): nothing is sent',
    body: `<p class="set-desc" id="lock-first-d">This is the first time a cloud model is asked about ${esc(f.project)}. ${esc(f.company)} would get your question and the notes it’s about.</p><p class="set-desc">Or keep ${esc(f.project)} off cloud AI: Ask, Summarise, Tidy up and the agent then use a model on this PC there. You can change it any time in its ⋮ menu.</p>`,
    others: [`<button class="btn btn--secondary" data-act="lk-first-keep">Keep it on this PC</button>`], main: `<button class="btn btn--primary" data-act="lk-first-send">Send to ${esc(f.company)}</button>` }); }; }
async function lkFirstAnswer(how) {
  const f = LK.first; if (!f) return; LK.first = null;
  if (how === 'no') { f.decline?.(); renderAll(); return; }
  if (f.outside) {   // R69: Send once / Keep on this PC / Always allow for this project
    if (VAULT.live && api()) { const r = await nv('ai_lock_first', f.key, how); if (failed(r)) { toast(r.message || 'That didn’t work.'); f.decline?.(); renderAll(); return; } lkApply(r); }
    status(how === 'keep' ? `${f.project} is kept off cloud AI` : how === 'always' ? 'Allowed for this project. It won’t ask again there.' : 'Sent once. It will ask again later.');
    if (how === 'keep') LK.next = { local: true };   // the question is still answered, on this PC
    renderAll(); f.retry?.(); return;
  }
  if (VAULT.live && api()) { const r = await nv('ai_lock_first', f.key, how === 'keep' ? 'keep' : 'send'); if (failed(r)) { toast(r.message || 'That didn’t work.'); f.decline?.(); renderAll(); return; } lkApply(r); }
  else if (how === 'keep') { const pg = String(f.key).replace(/^project:/, 'p-'); if (!lkBy(pg)) LK.items.push({ kind: 'project', id: rawId(pg), page: pg, name: f.project }); }
  status(how === 'keep' ? `${f.project} is kept off cloud AI` : 'Sent. It won’t ask again for this project.');
  if (how === 'keep') LK.next = { local: true };   // the question is still answered, on this PC
  renderAll(); f.retry?.();
}

/* ---- every call: the page's one-shot flags go to the backend; a Summarise or Tidy up on this PC says so ---- */
{ const n0 = nv; nv = async function (name, ...a) {   // eslint-disable-line no-global-assign
    if (name === 'ai_ask') { a = [...a]; while (a.length < 4) a.push(null); while (a.length < 5) a.push(null); if (LK.next) { a[5] = !!LK.next.unlock; a[6] = !!LK.next.local; LK.next = null; } }
    else if (name === 'ai_tidy' && a.length < 2) { const n = note(); a = [...a, n ? rawId(n.id) : null]; }
    const r = await n0.call(this, name, ...a);
    if ((name === 'convert_job' && r?.state === 'done') || (name === 'import_md_files' && !failed(r))) setTimeout(lkLoad, 400);   // R69: the new note's "Imported" chip
    if (name === 'ai_job' && r?.state === 'done' && r.result?.kept_off && ['summary', 'tidy', 'split'].includes(r.kind)) toast(`${{ summary: 'Summarised', tidy: 'Tidied', split: 'Split' }[r.kind]} on this PC by ${r.result.by}: ${r.result.kept_off} is kept off cloud AI.`);
    return r; }; }

/* ---- Settings → AI models → Overview: what's kept off, and the defaults ---- */
const lkSettingsRows = () => {
  const row = (lab, desc, ctl, id) => `<div class="set-row" data-lk-row="${id}"><div><div class="set-label">${lab}</div><div class="set-desc">${desc}</div></div>${ctl ? `<div class="ais-ctl">${ctl}</div>` : ''}</div>`;
  const kinds = { project: 'Project', folder: 'Folder', note: 'Note' };
  const kept = LK.items.length ? LK.items.map(i => row(`<span class="lk-name">${ic('lock')}${esc(i.name || lkName(i.page))}</span>`, `${kinds[i.kind]} · Ask, Summarise, Tidy up and the agent use this PC here, and its attachments stay too.`, `<button class="btn btn--secondary" data-act="lk-allow" data-v="${i.page}">Allow cloud AI</button>`, 'item')).join('')
    : row('Nothing is kept off yet', 'Every note can go to a cloud model you’ve added a key for, after its first-use yes.', '', 'none');
  const opts = [...D.projects.map(p => [p.id, p.name]), ...D.folders.filter(f => !lkBy(f.id)).map(f => [f.id, `${ancestors(f.parent).map(x => lkName(x)).join(' / ')}${f.parent ? ' / ' : ''}${f.name}`])].filter(([id]) => !lkBy(id));
  const pick = row('Keep another off cloud AI', 'Pick a project or a folder, or use its ⋮ menu in the sidebar (a note’s is in its header’s ⋮).',
    `<select class="field" data-act="lk-pick" aria-label="Keep off cloud AI"><option value="">Choose…</option>${opts.map(([id, nm]) => `<option value="${esc(id)}">${esc(nm)}</option>`).join('')}</select>`, 'pick');
  const first = row('The first time a cloud model is asked about a project', LK.ask ? 'NeuroVault asks once for each project: send it to the cloud, or keep it on this PC.' : 'Nothing is kept off unless you choose it here or in a ⋮ menu.',
    `<div class="seg" role="group" aria-label="The first time">${[['0', 'Don’t ask'], ['1', 'Ask']].map(([v, l]) => `<button class="seg-opt" data-act="lk-ask" data-v="${v}" aria-pressed="${(v === '1') === LK.ask}">${l}</button>`).join('')}</div>`, 'ask');
  const once = row('<span id="lk-once-l">Unlock for one question</span>', 'In a kept-off note you can still send one question to the cloud. It asks each time, and the lock stays.',
    `<button class="toggle" role="switch" aria-checked="${LK.once}" aria-labelledby="lk-once-l" data-act="lk-once-set"></button>`, 'once');
  return kept + pick + first + once;
};
const lkSettingsBody = () => `<div class="card" data-lk-set>${lkSettingsRows()}</div>`;
if (typeof AIS_SECS !== 'undefined' && !AIS_SECS.some(s => s[0] === 'lock')) {
  AIS_SECS.splice(AIS_SECS.findIndex(s => s[0] === 'noai'), 0, ['lock', 'Kept off cloud AI', 'Notes here never go to a cloud model. AI on this PC still works on them.', 'overview']);
  AIS_BODY.lock = lkSettingsBody;
}

/* ---- clicks ---- */
document.addEventListener('click', async e => {
  const t = e.target.closest?.('[data-act]'), act = t?.dataset.act || '';
  if (t && act === 'aic-model' && /^cloud:/.test(t.dataset.v || '') && lkHere()) { e.preventDefault(); e.stopImmediatePropagation(); status(`${lkWhat(lkHere())} is kept off cloud AI. Pick a model on this PC, or allow cloud AI again in its ⋮ menu.`); return; }
  if (!t || !act.startsWith('lk-') || act === 'lk-pick') return; e.preventDefault(); e.stopImmediatePropagation(); const v = t.dataset.v;
  if (t.getAttribute('aria-disabled') === 'true') { const it = lkItemFor(D.notes.find(n => n.id === v)) || lkFolderItem(v); status(it ? `Kept off cloud AI by ${it.name}: allow it there to change this` : ''); return; }
  if (act === 'lk-set') await lkToggle(v);
  else if (act === 'lk-allow') await lkToggle(v, false);
  else if (act === 'lk-ask') { LK.ask = v === '1'; saveSettings({ ai_lock_ask: LK.ask }); renderAll(); }
  else if (act === 'lk-once-set') { LK.once = !LK.once; saveSettings({ ai_lock_once: LK.once }); renderAll(); }
  else if (act === 'lk-local' || act === 'lk-once') { const n = note(), t2 = aicChat(aicKey(n)).turns[+v]; lkRetryTurn(n.id, t2, act === 'lk-local' ? { local: true } : { unlock: true }); }
  else if (act === 'lk-first-open') { const L = aicChat(aicKey(note())).turns[+v]?.answers.slice(-1)[0]?.lock; const n = note(), t2 = aicChat(aicKey(n)).turns[+v];
    lkFirst({ code: 'cloud_first', lock: L }, () => lkRetryTurn(n.id, t2), () => {}); }
  else if (act === 'lk-first-keep') lkFirstAnswer('keep');
  else if (act === 'lk-first-send') lkFirstAnswer('send');
  else if (act === 'lk-first-once') lkFirstAnswer('once');
  else if (act === 'lk-first-always') lkFirstAnswer('always');
  else if (act === 'lk-first-no') lkFirstAnswer('no');
}, true);
document.addEventListener('change', e => { const s = e.target.closest?.('[data-act="lk-pick"]'); if (!s || !s.value) return; e.stopImmediatePropagation(); lkToggle(s.value, true); }, true);
document.addEventListener('keydown', e => { if (e.key === 'Escape' && LK.first && document.querySelector('[data-dlg="lock-first"]')) { e.preventDefault(); e.stopImmediatePropagation(); lkFirstAnswer('no'); } }, true);
/* ==== end R68 ==== */
