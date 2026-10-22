/* ==== Build N · AI in the cloud with your own key (mockup R56, the R56 decisions
   2026-10-19; design profile "AI works on any PC, through a free key if need be") ====
   Feedback: "I want people to still use ai in the app even if they have slow pcs", then "id like to build for all - but we must
   be transparent in the application". cloud_providers.json (read here and by cloud_ai.py) holds every company's facts and links,
   read on the live pages; no hard limits show: each card links to the company's own page. NeuroVault ships no key.
   - Settings → AI models · "AI in the cloud · with your own key": a card per company (Groq suggested), its facts (who runs it,
     what's sent, kept or trained on?), links (privacy, limits) and Add key… / Test / Remove. "Get a free key" is three steps in the
     card itself (a dialog would stack on the Settings dialog): open the key page, paste, Test and save ("Hello", none of your notes).
   - Setup's AI step: "In the cloud" picks a company, with the same facts and steps.
   - The first-use notice (r56-notice: a small dialog), before anything goes to a company the first time: the real question and
     note, the facts and links, Not now / Use Groq, nothing to tick, Esc = Not now. Ask, summaries and Tidy up all wait for it.
   - Who answered: the "by" line and the Ask control say "Groq · cloud" with a cloud icon ("· this PC" with a chip icon).
   - The free limit (429): "Groq's free limit for today is used up. Nothing was sent anywhere else", Use this PC (until tomorrow)
     or Use another key. Nothing is ever retried on another company by itself.
   - Every model menu lists the companies you have a key for; Automatic may pick a free key on a slow PC (r56-auto: cloud).
   - Ollama and LM Studio get "Get Ollama" / "Get LM Studio" when they aren't running. Every link opens in the default browser
     (open_external), never inside NeuroVault. */
'use strict';
if (!ICON.external) ICON.external = '<path d="M14 4h6v6"/><path d="M20 4l-9 9"/><path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>';
const CLOUD = { data: null, add: null, val: {}, show: {}, res: {}, busy: null, notice: null, alt: null, limits: {}, obProv: 'groq' };

/* ---- the companies: the app's status (ai_status().cloud), or the file itself without the app ---- */
function cloudDemoFill(st) {
  const d = CLOUD.data; if (!d || !st) return st;
  if (!Array.isArray(st.cloud) || typeof st.cloud[0] !== 'object') st.cloud = d.providers.map(p => ({ ...p, has_key: false, masked: '', seen: '', used: false, acct_set: p.acct ? false : null, list_state: 'default', listed_at: '',
    models: [{ id: p.model, name: p.model_name || p.name, ctx: '', vision: false, rec: true, used: false }] }));   // QC 91: the fixed model until a list comes
  Object.assign(st, { cloud_keys: st.cloud_keys ?? true, cloud_checked: d.checked, cloud_sent: d.sent, local_get: d.local, slow: st.slow ?? !st.pc?.gpu });
  return st;
}
{ const d0 = aiDemo; aiDemo = function () { return cloudDemoFill(d0.apply(this, arguments)); }; }   // eslint-disable-line no-global-assign
CLOUD.ready = fetch('cloud_providers.json').then(r => r.ok ? r.json() : Promise.reject(new Error('cloud_providers.json')))
  .then(d => { CLOUD.data = d; if (AI.st?.demo) cloudDemoFill(AI.st); if (started) renderAll(); }).catch(e => console.warn('cloud AI', e));
const cloudRows = () => (AI.st || aiSt()).cloud?.filter?.(p => p && typeof p === 'object') || [];
const cloudP = id => cloudRows().find(p => p.id === id);
const cloudKeyed = () => cloudRows().filter(p => p.has_key);
const cloudHost = u => String(u || '').replace(/^https?:\/\//, '').split('/')[0];
const cloudToday = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const cloudDay = iso => { const d = new Date(String(iso) + 'T12:00:00'); return isNaN(d) ? '' : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }); };
const cloudLinksAll = () => new Set([...cloudRows().flatMap(p => [p.keys, p.privacy, p.limits]), ...Object.values(AI.st?.local_get || CLOUD.data?.local || {}).map(x => x.get)]);
function cloudOpen(url) {   // only the links in cloud_providers.json, in the default browser
  if (!cloudLinksAll().has(url)) return;
  if (api()) nv('open_external', url).then(r => { if (failed(r)) toast(r.message); else status(`Opened ${cloudHost(url)} in your browser`); });
  else toast(`Opens ${cloudHost(url)} in your browser`);
}

/* ---- the facts, said the same way on every card, in setup and in the first-use notice ---- */
function cloudFacts(p, o = {}) {
  const what = o.q ? `Your question, “${esc(o.q)}”, and ${o.scope === 'all' ? 'your newest notes' : `the note “${esc(o.note || 'this note')}”`}.`
    : o.job === 'summary' ? `The note “${esc(o.note || 'this note')}”, to summarise it.` : o.job === 'tidy' ? 'The words you selected, to tidy them.' : esc(aiSt().cloud_sent || '');
  return `<dl class="cl-facts"><div class="cl-fact"><dt>Who runs it</dt><dd>${esc(p.who)}</dd></div><div class="cl-fact"><dt>What’s sent</dt><dd>${what}</dd></div>
    <div class="cl-fact cl-keep is-${p.tone}"><dt>Kept or trained on?</dt><dd>${ic(p.tone === 'ok' ? 'check' : 'alert')}<span>${esc(p.keep)}</span></dd></div></dl>`;
}
const cloudLink = (url, label) => `<button class="cl-link" data-act="cl-link" data-v="${esc(url)}" aria-description="Opens ${esc(cloudHost(url))} in your browser">${esc(label)}${ic('external')}</button>`;
const cloudLinks = p => `<div class="cl-links">${cloudLink(p.privacy, p.privacy_label || 'Privacy terms')}${cloudLink(p.limits, p.limits_label || (p.group === 'paid' ? 'Prices and limits' : 'Current free limits'))}<span class="cl-checked">Checked ${esc(aiSt().cloud_checked || '')}</span></div>`;

/* ---- "Get a free key": the company's key page, paste, Test and save. In the card (or setup), never a dialog over Settings ---- */
function cloudWalk(p, where) {
  const shown = CLOUD.show[p.id], kid = `cl-key-${where}`, res = CLOUD.res[p.id], busy = CLOUD.busy === p.id, ok = !!res?.ok;
  const keyField = `<label class="set-label cl-flabel" for="${kid}">${p.acct ? 'API token' : 'Paste the key here'}</label><div class="cl-keyrow"><input class="field cl-keyin" id="${kid}" type="${shown ? 'text' : 'password'}" data-cl-key="${p.id}" value="${esc(CLOUD.val[p.id] || '')}" placeholder="${p.prefix ? `Starts with ${esc(p.prefix)}` : 'Paste the key'}" autocomplete="off" spellcheck="false">
    <button class="icon-btn cl-eye" data-act="cl-eye" data-v="${p.id}" aria-pressed="${!!shown}" aria-label="${shown ? 'Hide' : 'Show'} the key">${ic('eye')}</button></div>`;
  const acct = p.acct ? `<label class="set-label cl-flabel" for="${kid}-acct">Account ID</label><div class="cl-keyrow"><input class="field cl-keyin" id="${kid}-acct" data-cl-key="${p.id}:acct" value="${esc(CLOUD.val[p.id + ':acct'] || '')}" placeholder="32 letters and numbers" autocomplete="off" spellcheck="false"></div>` : '';
  const out = res ? `<div class="cl-res is-${ok ? 'ok' : 'bad'}" role="${ok ? 'status' : 'alert'}">${ic(ok ? 'check' : 'alert')}<span>${esc(plainMsg(res.message))}</span></div>` : '';
  const test = `<button class="btn ${where === 'setup' ? 'btn--secondary' : 'btn--primary'}" data-act="cl-save" data-v="${p.id}"${busy ? ' aria-disabled="true" aria-description="Testing the key"' : ''}>${busy ? 'Testing…' : 'Test and save'}</button>`;
  const foot = where === 'setup' ? '' : `<div class="cl-walk-foot">${ok ? '<button class="btn btn--primary" data-act="cl-done">Done</button>' : `<button class="btn btn--secondary" data-act="cl-cancel">Cancel</button>${test}`}</div>`;
  return `<div class="cl-walk" data-cl-walk="${p.id}" role="group" aria-label="Add a ${esc(p.name)} key"><ol class="cl-steps">
    <li><span class="cl-n" aria-hidden="true">1</span><div class="cl-sb"><div class="set-label">${p.group === 'paid' ? 'Make a key' : 'Make a free key'} on ${esc(p.name)}’s site</div><div class="set-desc">${esc(p.steps)}</div><button class="btn btn--secondary cl-open" data-act="cl-link" data-v="${esc(p.keys)}" aria-description="Opens ${esc(cloudHost(p.keys))} in your browser">${ic('external')}Open ${esc(p.name)}’s key page</button></div></li>
    <li><span class="cl-n" aria-hidden="true">2</span><div class="cl-sb">${acct}${keyField}<div class="set-desc">It goes straight into Windows Credential Manager: never into a file, your vault or NeuroVault’s settings.</div></div></li>
    <li><span class="cl-n" aria-hidden="true">3</span><div class="cl-sb"><div class="set-label">Test it</div><div class="set-desc">Sends one word, “Hello”, to ${esc(p.name)}. None of your notes.</div>${where === 'setup' && !ok ? test : ''}${out}</div></li></ol>${foot}</div>`;
}

/* ---- Settings → AI models: a card per company, the free ones first ---- */
function cloudCard(p) {
  const has = p.has_key, open = CLOUD.add === p.id, cur = ainRoute('qa')?.prov === p.id, noKeys = aiSt().cloud_keys === false;
  const off = has ? '' : ' aria-disabled="true" aria-description="Add a key first"';
  const val = !has ? 'No key' : p.used ? 'Free limit used up today' : `Key saved${p.masked ? ` · ${p.masked}` : ''}${cur ? ' · Ask uses it' : ''}`;
  const tags = `${p.suggest ? '<span class="chip chip--accent">Suggested</span>' : ''}<span class="chip chip--neutral">${p.group === 'paid' ? 'Paid' : 'Free to start'}</span>`;
  const yes = p.seen && has ? `<span class="cl-yes"><span class="set-desc">You said yes on ${esc(cloudDay(p.seen))}</span><button class="cl-link" data-act="cl-again" data-v="${p.id}">Show the notice again</button></span>` : '';
  const add = noKeys ? `<button class="btn btn--secondary" aria-disabled="true" aria-description="Cloud keys need the keyring package">${ic('key')}Add key…</button>` : `<button class="btn btn--secondary" data-act="cl-add" data-v="${p.id}">${ic('key')}${has ? 'Change key…' : 'Add key…'}</button>`;
  const acts = `<div class="cl-acts">${add}<button class="btn btn--secondary" data-act="cl-test" data-v="${p.id}"${off}>Test</button><button class="btn btn--ghost" data-act="cl-remove" data-v="${p.id}"${off}>Delete key</button>${yes}</div>`;
  return `<div class="cl-card${open ? ' is-open' : ''}" data-cl-card="${p.id}"><div class="cl-head">${ic('cloud')}<span class="set-label">${esc(p.name)}</span>${tags}<span class="cl-val">${esc(val)}</span></div>${cloudFacts(p)}${cloudLinks(p)}${open ? cloudWalk(p, 'card') : acts}</div>`;
}
function cloudSection() {
  const rows = cloudRows(); if (!rows.length) return '';
  const warn = aiSt().cloud_keys === false ? '<p class="set-desc ai-nofit" role="alert">Cloud keys need the keyring package, which isn’t installed, so they can’t be kept in Windows Credential Manager yet.</p>' : '';
  return `<section class="cl-cloud" id="cl-cloud" aria-labelledby="cl-ct"><div class="eyebrow mt-4" id="cl-ct">AI in the cloud · with your own key</div>
    <p class="cl-lede set-desc">For a PC that’s slow at AI. Most companies below give you a free key to start. Nothing goes to a company until you add its key and say yes once. NeuroVault never comes with a key.</p>${warn}
    <div class="cl-group">Free to start</div>${rows.filter(p => p.group !== 'paid').map(cloudCard).join('')}<div class="cl-group">Paid</div>${rows.filter(p => p.group === 'paid').map(cloudCard).join('')}</section>`;
}
{ const p0 = aiPane; aiPane = function () { const h = p0.apply(this, arguments), at = h.indexOf('<div class="eyebrow mt-4">Which model does each job</div>');   // eslint-disable-line no-global-assign
  return at < 0 ? h + cloudSection() : h.slice(0, at) + cloudSection() + h.slice(at); }; }

/* ---- setup's AI step, "In the cloud": pick a company (Groq first), its facts, then the same three steps ---- */
function cloudObHtml() {
  const rows = cloudRows(), p = cloudP(CLOUD.obProv) || rows[0]; if (!p) return '<p class="set-desc">Loading the companies…</p>';
  return `<div class="eyebrow">Pick a company · each gives you its own key</div><div class="ob-models cl-obprovs" role="group" aria-label="Company">${rows.map(x => `<button class="ob-model" data-act="cl-obpick" data-v="${x.id}" aria-pressed="${x.id === p.id}"><span class="set-label">${esc(x.name)}${x.suggest ? ' <span class="chip chip--accent">Suggested</span>' : x.group === 'paid' ? ' <span class="chip chip--neutral">Paid</span>' : ''}</span><span class="set-desc cl-short">${ic(x.tone === 'ok' ? 'check' : 'alert')}<span>${esc(x.short)}</span></span></button>`).join('')}</div>
    <div class="cl-obdetail" data-cl-ob="${p.id}"><div class="cl-head">${ic('cloud')}<span class="set-label">${esc(p.name)}</span><span class="cl-val">${p.has_key ? 'Key saved' : 'No key yet'}</span></div>${cloudFacts(p)}${cloudLinks(p)}${cloudWalk(p, 'setup')}</div>
    <p class="set-desc">You can add, test or remove keys later in Settings → AI models.</p>`;
}
const cloudObSummary = () => { const k = cloudKeyed(); return k.length ? `${k.map(p => p.name).join(', ')} in the cloud, with your own key` : 'In the cloud · no key yet'; };

/* ---- the first-use notice: before anything goes to a company the first time ---- */
function cloudNoticeHtml() {
  const n = CLOUD.notice, p = n && cloudP(n.prov); if (!p) return '';
  const body = `<p id="dlg-cl-notice-d">${esc(p.name)} runs in the cloud, so your text leaves this PC. Here’s where it goes.</p>${cloudFacts(p, n.what)}${cloudLinks(p)}<p class="set-desc cl-once">You’ll see this once for ${esc(p.name)}. Settings → AI models can show it again, or remove the key.</p>`;
  return dlg({ id: 'cl-notice', size: 'sm', title: `Send this to ${esc(p.name)}?`, descId: 'dlg-cl-notice-d', x: 'cl-notnow', xLabel: 'Not now: nothing is sent', xTitle: 'Not now (Esc)', keep: true, cls: 'cl-notice', body,
    cancel: '<button class="btn btn--secondary" data-act="cl-notnow">Not now</button>', main: `<button class="btn btn--primary" data-act="cl-use">Use ${esc(p.name)}</button>` });
}
{ const m0 = renderModal; renderModal = function () { return S.modal === 'cl-notice' ? cloudNoticeHtml() : m0.apply(this, arguments); }; }   // eslint-disable-line no-global-assign
function cloudAskFirst(prov, what) {   // resolves true on "Use Groq"; false on Not now, Esc or the dialog closing any other way
  if (CLOUD.notice) return Promise.resolve(false);
  return new Promise(ok => { CLOUD.notice = { prov, what, ok, back: S.modal || null }; S.modal = 'cl-notice'; S.focus = { sel: '[data-dlg="cl-notice"] .modal-foot [data-act="cl-notnow"]' };
    status('Nothing is sent yet: first, where it would go'); renderAll(); });
}
async function cloudNoticeAnswer(yes) {
  const n = CLOUD.notice; if (!n) return; CLOUD.notice = null; if (S.modal === 'cl-notice') S.modal = n.back;
  if (yes) {
    const r = await nv('ai_cloud_yes', n.prov, true);
    if (failed(r)) { toast(r.message || "That didn't work."); renderAll(); n.ok(false); return; }
    const p = cloudP(n.prov); if (p) p.seen = r.seen || cloudToday();
    Object.values(AI.st?.routes || {}).forEach(x => { if (x?.prov === n.prov) { x.seen = true; x.ready = !!p?.has_key; } });
  } else status('Nothing was sent. Your question is still in the box');
  renderAll(); n.ok(!!yes);
}
function cloudGate(job, what) {   // true when the job may go ahead: not a company, or one you've said yes to
  const r = ainRoute(job); if (r?.kind !== 'cloud' || r.seen) return Promise.resolve(true);
  return cloudAskFirst(r.prov, what);
}
{ const a0 = aicAsk; aicAsk = async function (n, q, opt = {}) {   // eslint-disable-line no-global-assign
  const qq = String(q || '').trim(); if (!qq || AIC.busy || !ainOn() || !api()) return a0.apply(this, arguments);
  if (!await cloudGate('qa', { q: qq, scope: opt.turn ? opt.turn.scope : AIC.scope, note: n?.title })) { AIC.focus = '#aic-in'; renderAll(); return; }
  return a0.call(this, n, q, opt); }; }
{ const s0 = ainSummarise; ainSummarise = async function (n) {   // eslint-disable-line no-global-assign
  if (n && ainOn() && ainNote(n.id).state !== 'thinking' && !await cloudGate('summary', { job: 'summary', note: n.title })) return;
  return s0.apply(this, arguments); }; }
{ const t0 = ainTidyStart; ainTidyStart = async function (c) {   // eslint-disable-line no-global-assign
  if (c?.tidy && ainOn() && !await cloudGate('tidy', { job: 'tidy' })) return;
  return t0.apply(this, arguments); }; }
{ const a0 = afterRender; afterRender = function () { a0.apply(this, arguments); if (CLOUD.notice && S.modal !== 'cl-notice') setTimeout(() => cloudNoticeAnswer(false)); }; }   // eslint-disable-line no-global-assign
document.addEventListener('keydown', e => { if (e.key === 'Escape' && CLOUD.notice && S.modal === 'cl-notice') { e.preventDefault(); e.stopImmediatePropagation(); cloudNoticeAnswer(false); } }, true);

/* ---- every model menu: the companies you have a key for ---- */
{ const m0 = ainModels; ainModels = function () { const l = m0.apply(this, arguments); if (!AI.st) return l;   // eslint-disable-line no-global-assign
  return [...l, ...cloudKeyed().map(p => ({ key: 'cloud:' + p.id, name: p.name, where: p.used ? 'cloud · limit used up today' : 'cloud', ok: true, cloud: true }))]; }; }

/* ---- who answered, and where the next question goes ---- */
const cloudIsCloud = where => /(^|· )cloud$/.test(String(where || ''));   // QC 91: "cloud" or "Groq · cloud"
const cloudIc = where => ic(cloudIsCloud(where) ? 'cloud' : 'cpu');
const cloudWhere = w => w === 'on this PC' ? 'this PC' : String(w || '').replace(', on this PC', ' · this PC');   // "Groq · cloud", "Qwen3.5 4B · this PC" (R56)
const cloudByFix = (h, a) => a.where ? h.replace(` · ${esc(a.where)}`, ` · ${esc(cloudWhere(a.where))}`) : h;
{ const a0 = aicActs; aicActs = function (t, a) { const h = a0.apply(this, arguments); if (!a?.by) return h;   // eslint-disable-line no-global-assign
  return cloudByFix(h.replace('<span class="aic-meta">', `<span class="aic-meta cl-by" data-cl-by="${cloudIsCloud(a.where) ? 'cloud' : 'pc'}">${cloudIc(a.where)}`), a); }; }
{ const b0 = ainByLine; ainByLine = function (a) { const h = b0.apply(this, arguments); if (!a?.by) return h;   // eslint-disable-line no-global-assign
  return cloudByFix(h.replace('<span class="ain-by-text">', `<span class="ain-by-text cl-by" data-cl-by="${cloudIsCloud(a.where) ? 'cloud' : 'pc'}">${cloudIc(a.where)}`), a); }; }
{ const c0 = aicControl; aicControl = function (off) { const h = c0.apply(this, arguments), cur = ainCur('qa'); if (off || !cur) return h;   // eslint-disable-line no-global-assign
  const cloud = cloudIsCloud(cur.where), svc = cloudSvcOf(cur.where), sc = AIC.scope === 'all' ? 'My newest notes' : 'This note', where = cloud ? (svc && svc !== 'cloud' ? svc : 'cloud') : 'this PC';   // QC 91: "Llama 3.3 70B · Groq"
  const tip = `${ainChoice('qa') === 'auto' ? 'Automatic: ' : ''}your next question goes to ${esc(cur.name)}${cloud ? `${svc && svc !== 'cloud' ? ` on ${esc(svc)}` : ''}, in the cloud` : ', on this PC'}`;
  return h.replace(/<span>[^<]*<\/span>/, `<span>${esc(sc)} · </span>${cloudIc(cur.where)}<span class="cl-next-t">${esc(cur.name)} · ${where}</span>`)
    .replace(/aria-label="[^"]*"/, `aria-label="Where answers come from, and the model: ${esc(sc)}. ${tip}"`).replace(/data-tip="[^"]*"/, `data-tip="${tip}"`)
    .replace('class="aic-chip', `data-cl-next="${cloud ? 'cloud' : 'pc'}" class="aic-chip cl-next`); }; }
{ const m0 = aicMenuHtml; aicMenuHtml = function () { const h = m0.apply(this, arguments), r = ainRoute('qa'); if (!h || r?.kind !== 'cloud' || ainChoice('qa') !== 'auto') return h;   // eslint-disable-line no-global-assign
  return h.replace(/(data-act="aic-model" data-v="auto">[\s\S]*?<span class="aic-where">)[^<]*/, `$1${esc(r.name)} · ${esc(r.svc || 'cloud')}`); }; }

/* ---- the free limit is used up (429): one message, and two ways on; nothing goes elsewhere by itself ---- */
{ const n0 = nv; nv = async function (name, ...a) {   // eslint-disable-line no-global-assign
  const r = await n0.call(this, name, ...a);
  if (name === 'ai_job' && r?.state === 'error' && r.limit) CLOUD.limits[a[0]] = r.limit;
  return r; }; }
{ const e0 = aicEnd; aicEnd = function (a, o) { const jid = AIC.busy?.job; if (o?.err && jid && CLOUD.limits[jid]) o = { ...o, limit: CLOUD.limits[jid] }; return e0.call(this, a, o); }; }   // eslint-disable-line no-global-assign
function cloudLocal() {   // the model on this PC that "Use this PC" would use
  const st = AI.st; if (!st) return null; const m = st.use && aiModel(st.use);
  if (m) return m.name; const p = Object.values(st.providers || {}).find(x => x.running && x.models?.length); return p ? p.models[0] : null;
}
function cloudLimitBox(pid, i, err) {
  const p = cloudP(pid) || { id: pid, name: pid, limits: '' }, local = cloudLocal(), others = cloudKeyed().filter(x => x.id !== pid && !x.used), open = CLOUD.alt === i;
  const msg = err || (p.group === 'paid' ? `${p.name}’s limit is reached for now.` : `${p.name}’s free limit for today is used up.`);   // QC 91: the backend names the model
  const alts = open ? `<div class="cl-alts" role="group" aria-label="Use another key">${others.map(x => `<button class="btn btn--secondary btn--sm" data-act="cl-altuse" data-v="${i}" data-k="cloud:${x.id}">${ic('cloud')}${esc(x.name)}</button>`).join('')}<button class="btn btn--ghost btn--sm" data-act="cl-addmore">${ic('key')}Add a key…</button></div>` : '';
  return `<div class="aic-err cl-limit" role="alert" data-cl-limit="${esc(pid)}"><div class="aic-err-text">${ic('alert')}<span><b>${esc(msg)}</b> Nothing was sent anywhere else. It comes back on ${esc(p.name)}’s own schedule: ${p.limits ? cloudLink(p.limits, 'see its limits') : ''}</span></div>
    <div class="aic-err-acts"><button class="btn btn--secondary btn--sm" data-act="cl-uselocal" data-v="${i}"${local ? ` aria-description="${esc(local)} answers, on this PC"` : ' aria-disabled="true" aria-description="No model on this PC yet"'}>${ic('cpu')}Use this PC</button><button class="btn btn--ghost btn--sm" data-act="cl-alt" data-v="${i}" aria-expanded="${open}">Use another key${ic('down')}</button></div>${alts}</div>`;
}
{ const t0 = aicTurnHtml; aicTurnHtml = function (t, i, all, ro) { const h = t0.apply(this, arguments), a = t.answers[t.at] || {};   // eslint-disable-line no-global-assign
  if (!a.limit || ro || a.pending) return h; const at = h.indexOf('<div class="aic-err"'); return at < 0 ? h : h.slice(0, at) + cloudLimitBox(a.limit, i, a.err) + '</div></div>'; }; }
function cloudRetry(i) { const n = note(), tt = n && aicChat(aicKey(n)).turns[i]; if (!tt) return; tt.answers.splice(tt.at, 1); tt.at = Math.max(0, tt.answers.length - 1); aicAsk(n, tt.q, { turn: tt }); }
async function cloudUseLocal(i) {
  const r = await nv('ai_use_local', 'qa'); if (failed(r)) { toast(r.message || "That didn't work."); return; }
  CLOUD.alt = null; await aiRefresh();
  const back = r.back === 'auto' ? 'Automatic' : cloudP(String(r.back).slice(6))?.name || 'what it was';
  toast(`${r.name} answers on this PC. Ask stays on this PC until tomorrow, then goes back to ${back}`); cloudRetry(i);
}
async function cloudAltUse(i, key) { CLOUD.alt = null; if (await ainSetRoute('qa', key)) cloudRetry(i); }

/* ---- the keys: Test and save, Test, Remove, Show the notice again ---- */
async function cloudSave(pid) {
  const p = cloudP(pid); if (!p || CLOUD.busy) return;
  if (!api()) { toast('Cloud keys need the app'); return; }
  const key = String(CLOUD.val[pid] || '').trim(), acct = p.acct ? String(CLOUD.val[pid + ':acct'] || '').trim() : null;
  CLOUD.busy = pid; CLOUD.res[pid] = null; renderAll();
  const r = await nv('ai_cloud_key', pid, key, acct);
  CLOUD.busy = null;
  const res = CLOUD.res[pid] = failed(r) ? { ok: false, message: r?.message || "That didn't work." } : { ok: !!r.ok, message: r.message, limit: !!r.limit };
  if (res.ok) { CLOUD.val[pid] = ''; CLOUD.val[pid + ':acct'] = ''; CLOUD.show[pid] = false; }
  status(res.message); S.focus = { sel: res.ok ? (CLOUD.add === pid ? '[data-act="cl-done"]' : `[data-cl-walk="${pid}"] .cl-res`) : `[data-cl-walk="${pid}"] [data-cl-key="${pid}"]` };
  await aiRefresh(); renderAll();
}
async function cloudCall(name, pid, ...more) {
  if (!api()) { toast('Cloud keys need the app'); return null; }
  const r = await nv(name, pid, ...more); if (failed(r)) { toast(r?.message || "That didn't work."); return null; }
  await aiRefresh(); return r;
}
async function cloudTest(pid) { const r = await cloudCall('ai_cloud_test', pid); if (r) status(r.message); renderAll(); }
async function cloudRemove(pid) {
  const p = cloudP(pid), r = await cloudCall('ai_cloud_remove', pid); if (!r) return;
  status(`${p?.name || pid}’s key is deleted from Windows Credential Manager`);   // QC 88: it's a delete S.focus = { sel: `[data-act="cl-add"][data-v="${pid}"]` }; renderAll();
}
async function cloudAgain(pid) {
  const p = cloudP(pid), r = await cloudCall('ai_cloud_yes', pid, false); if (!r) return;
  if (p) p.seen = ''; status(`${p?.name || pid}: the notice shows again before anything goes to it`); S.focus = { sel: `[data-act="cl-add"][data-v="${pid}"]` }; renderAll();
}

/* ---- the clicks and the key boxes ---- */
app.addEventListener('click', e => {
  const t = e.target.closest?.('[data-act]'), act = t?.dataset.act || ''; if (!act.startsWith('cl-')) return;
  e.preventDefault(); e.stopPropagation();
  if (t.getAttribute('aria-disabled') === 'true') { status(t.getAttribute('aria-description') || 'Not now'); return; }
  const v = t.dataset.v, p = cloudP(v);
  switch (act) {
    case 'cl-link': cloudOpen(v); return;
    case 'cl-add': CLOUD.add = v; CLOUD.res[v] = null; S.focus = { sel: `[data-cl-walk="${v}"] .cl-open` }; status(`${p?.name}: three steps to add a key`); break;
    case 'cl-cancel': case 'cl-done': { const k = CLOUD.add; S.focus = { sel: `[data-act="cl-add"][data-v="${k}"]` }; CLOUD.res[k] = null; CLOUD.val[k] = ''; CLOUD.val[k + ':acct'] = ''; CLOUD.add = null; break; }
    case 'cl-eye': CLOUD.show[v] = !CLOUD.show[v]; S.focus = { sel: `[data-act="cl-eye"][data-v="${v}"]` }; break;
    case 'cl-save': cloudSave(v); return;
    case 'cl-test': cloudTest(v); return;
    case 'cl-remove': cloudRemove(v); return;
    case 'cl-again': cloudAgain(v); return;
    case 'cl-obpick': CLOUD.obProv = v; S.focus = { sel: `[data-act="cl-obpick"][data-v="${v}"]` }; break;
    case 'cl-use': cloudNoticeAnswer(true); return;
    case 'cl-notnow': cloudNoticeAnswer(false); return;
    case 'cl-uselocal': cloudUseLocal(+v); return;
    case 'cl-alt': CLOUD.alt = CLOUD.alt === +v ? null : +v; S.focus = { sel: `[data-act="cl-alt"][data-v="${v}"]` }; break;
    case 'cl-altuse': cloudAltUse(+v, t.dataset.k); return;
    case 'cl-addmore': CLOUD.alt = null; openSettings('ai'); return;
    default: return;
  }
  renderAll();
}, true);
app.addEventListener('input', e => { const k = e.target.dataset?.clKey; if (k) CLOUD.val[k] = e.target.value; }, true);
app.addEventListener('keydown', e => { const k = e.target.dataset?.clKey; if (k && e.key === 'Enter') { e.preventDefault(); cloudSave(k.split(':')[0]); } }, true);
/* ==== end Build N · AI in the cloud ==== */

/* ==== Build N · QC 91: every model a company offers (mockup R60; the R60 decisions: grouped by service on one list, the
   models on this PC in the same menu). After a key is added, and on Test or Refresh, the company's own list comes in (only the key
   is sent, never a note); every chat model is in every model menu, the fixed one marked Recommended, OpenRouter's free ones only.
   The by line and the Ask control name the model and its company: "Llama 3.3 70B · Groq · cloud". ==== */
if (!ICON.image) ICON.image = '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.1-3.1a2 2 0 0 0-2.8 0L6 21"/>';
const cloudSvcOf = where => String(where || '').replace(/ · cloud$/, '');
const cloudKeyOf = (p, m) => m.rec ? 'cloud:' + p.id : `cloud:${p.id}:${m.id}`;
// every model of every company with a key, in each model menu
{ const m0 = ainModels; ainModels = function () { const l = m0.apply(this, arguments).filter(m => !m.cloud); if (!AI.st) return l;   // eslint-disable-line no-global-assign
  for (const p of cloudKeyed()) for (const m of p.models || []) l.push({ key: cloudKeyOf(p, m), name: m.name, svc: p.name, where: `${p.name} · cloud`, prov: p.id, id: m.id, ctx: m.ctx, rec: !!m.rec, vision: !!m.vision, used: !!m.used, ok: true, cloud: true });
  return l; }; }
const cloudFindModel = key => ainModels().find(m => m.key === key) || null;
function cloudListLine() {   // where the lists came from, and what listing sends
  const ks = cloudKeyed(), at = ks.map(p => p.listed_at).filter(Boolean).sort().at(-1);
  const when = at ? new Date(at).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '';
  return at ? `Lists from each company, ${esc(when)} · listing sends only your key, never your notes` : 'Each company’s list comes once its key is tested · listing sends only your key';
}
function cloudPickRow(m, cur, act, tick) {
  const on = cur === m.key, text = `${m.name} ${m.svc || ''} ${m.id || ''} ${m.where || ''}`.toLowerCase();
  const vis = m.vision ? `<span class="cl-vis" role="img" aria-label="Can read images" data-tip="Can read images and documents">${ic('image')}</span>` : '';
  const meter = typeof cloudMenuMeter === 'function' && m.cloud ? cloudMenuMeter(m) : '';
  return `<button class="menu-item cl-mi" role="menuitemradio" aria-checked="${on}" data-act="${act}" data-v="${esc(m.key)}" data-cl-text="${esc(text)}"${m.ok ? '' : ` aria-disabled="true" title="${esc(m.why || '')}"`}>${tick(on)}<span class="cl-mn"><span class="cl-mname">${esc(m.name)}</span>${m.rec ? '<span class="chip chip--accent cl-rec">Recommended</span>' : ''}${vis}</span>${meter}${m.cloud ? '' : `<span class="aic-where">${esc(m.ok ? m.where : 'off')}</span>`}</button>`;   // a cloud model sits under its company's heading
}
function cloudPickerHtml(cur, act, tick) {   // grouped by company on one list; a search box when it's long
  const all = ainModels(), here = all.filter(m => !m.cloud);
  const groups = [['On this PC', here, null], ...cloudKeyed().map(p => [p.id === 'openrouter' ? 'OpenRouter · free models' : p.name, all.filter(m => m.prov === p.id), p])];
  const head = (l, ms, p) => `<div class="cl-ghead" data-cl-group><span>${esc(l)}</span>${p ? `<span class="cl-gcount">${ms.length}</span>` : ''}</div>${p?.id === 'openrouter' ? '<div class="cl-gnote" data-cl-group-note>Its free models share one limit, so switching between them won’t help.</div>' : ''}`;
  const search = all.length > 8 ? `<div class="cl-search"><input class="field cl-q" type="search" data-cl-q placeholder="Find a model…" aria-label="Find a model" autocomplete="off" spellcheck="false"></div>` : '';
  return `${search}<div class="cl-mlist" data-cl-mlist>${groups.map(([l, ms, p]) => ms.length ? `<div class="cl-group-box" data-cl-gbox>${head(l, ms, p)}${ms.map(m => cloudPickRow(m, cur, act, tick)).join('')}</div>` : '').join('')}<div class="cl-none" hidden data-cl-none>No model matches. <button class="cl-link" data-act="cl-qclear">Clear</button></div></div>`
    + (cloudKeyed().length ? `<div class="cl-mfoot"><span>${cloudListLine()}</span><button class="cl-link" data-act="cl-refresh-all">Refresh</button></div>` : '');
}
{ const m0 = aicMenuHtml; aicMenuHtml = function () { let h = m0.apply(this, arguments); const mn = AIC.menu; if (!h || !mn || !['opts', 'again'].includes(mn.kind)) return h;   // eslint-disable-line no-global-assign
  const tick = on => `<span class="aic-tick" aria-hidden="true">${on ? ic('r50tick') : ''}</span>`;
  if (mn.kind === 'opts') {
    h = h.replace(/<button class="menu-item" role="menuitemradio" aria-checked="(?:true|false)" data-act="aic-model" data-v="(?!auto")[^"]*"[^>]*>[\s\S]*?<\/button>/g, '');
    h = h.replace(/(<button class="menu-item" role="menuitemradio" aria-checked="(?:true|false)" data-act="aic-model" data-v="auto">[\s\S]*?<\/button>)/, `$1${cloudPickerHtml(ainChoice('qa'), 'aic-model', tick)}`);
  } else {
    const t = aicChat(aicKey(note())).turns[mn.i], cur = t?.answers[t.at]?.key;
    h = h.replace(/<button class="menu-item" role="menuitemradio" aria-checked="(?:true|false)" data-act="aic-again"[^>]*>[\s\S]*?<\/button>/g, '');
    h = h.replace('<div class="aic-mlabel">Ask again with</div>', `<div class="aic-mlabel">Ask again with</div>${cloudPickerHtml(cur, 'aic-again', tick)}`);
  }
  return h.replace('class="menu card aic-menu', 'class="menu card aic-menu cl-pmenu'); }; }
// the search box filters the rows in place (no redraw, so it keeps the caret)
app.addEventListener('input', e => { if (!e.target.matches?.('[data-cl-q]')) return; const q = e.target.value.trim().toLowerCase(), list = e.target.closest('.menu')?.querySelector('[data-cl-mlist]'); if (!list) return;
  let any = false; list.querySelectorAll('[data-cl-gbox]').forEach(g => { let n = 0; g.querySelectorAll('[data-cl-text]').forEach(r => { const hit = !q || r.dataset.clText.includes(q); r.hidden = !hit; if (hit) n++; }); g.hidden = !n; any ||= n > 0; });
  list.querySelector('[data-cl-none]').hidden = any; }, true);
// Settings → AI models: each company with a key lists its models (three, then all), and the list's state, with Refresh
function cloudModelsBlock(p) {
  const ms = p.models || [], open = CLOUD.allModels?.[p.id], shown = open ? ms : ms.slice(0, 3), when = p.listed_at ? new Date(p.listed_at).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '';
  const state = p.list_state === 'default' ? 'Only the model NeuroVault starts with: the list comes when the key is tested' : `Listed ${esc(when)} · only your key was sent`;
  return `<div class="cl-cm" data-cl-cm="${p.id}"><div class="cl-cm-head"><span class="set-label">Models</span><span class="set-desc cl-cm-state">${state}</span><button class="btn btn--ghost btn--sm" data-act="cl-refresh" data-v="${p.id}"${CLOUD.listing === p.id ? ' aria-disabled="true" aria-description="Asking for the list"' : ''}>${CLOUD.listing === p.id ? 'Asking…' : 'Refresh'}</button></div>
    <div class="cl-cm-list">${shown.map(m => `<div class="cl-cm-row"><span class="cl-cm-name">${esc(m.name)}${m.rec ? '<span class="chip chip--accent cl-rec">Recommended</span>' : ''}${m.vision ? `<span class="cl-vis" role="img" aria-label="Can read images" data-tip="Can read images and documents">${ic('image')}</span>` : ''}</span><span class="cl-cm-id">${esc(m.id)}</span><span class="cl-cm-ctx">${m.ctx ? esc(m.ctx) + ' context' : ''}</span>${typeof cloudCardMeter === 'function' ? cloudCardMeter(p, m) : ''}</div>`).join('')}</div>
    ${ms.length > 3 ? `<button class="btn btn--ghost btn--sm cl-cm-more" data-act="cl-cmore" data-v="${p.id}" aria-expanded="${!!open}">${open ? 'Fewer' : `All ${ms.length} models`}${ic('down')}</button>` : ''}${p.id === 'openrouter' ? '<p class="set-desc cl-cm-note">Only its free models are here.</p>' : ''}</div>`;
}
{ const k0 = cloudCard; cloudCard = function (p) { const h = k0.apply(this, arguments); if (!p.has_key || CLOUD.add === p.id) return h; return h.replace('<div class="cl-acts">', `${cloudModelsBlock(p)}<div class="cl-acts">`); }; }   // eslint-disable-line no-global-assign
async function cloudRefresh(pids) {
  if (!api()) { toast('Cloud keys need the app'); return; }
  const msgs = [];
  for (const pid of pids) { CLOUD.listing = pid; renderAll(); const r = await nv('ai_cloud_models', pid); msgs.push(failed(r) ? r?.message : r.message); }
  CLOUD.listing = null; await aiRefresh(); renderAll(); status(msgs.filter(Boolean).join(' · ') || 'Lists refreshed: only your keys were sent');
}
app.addEventListener('click', e => {
  const t = e.target.closest?.('[data-act]'), act = t?.dataset.act || ''; if (!/^cl-(refresh|refresh-all|cmore|qclear)$/.test(act)) return;
  e.preventDefault(); e.stopPropagation(); if (t.getAttribute('aria-disabled') === 'true') return;
  if (act === 'cl-refresh') { cloudRefresh([t.dataset.v]); return; }
  if (act === 'cl-refresh-all') { cloudRefresh(cloudKeyed().map(p => p.id)); return; }
  if (act === 'cl-cmore') { CLOUD.allModels = { ...(CLOUD.allModels || {}), [t.dataset.v]: !CLOUD.allModels?.[t.dataset.v] }; S.focus = { sel: `[data-act="cl-cmore"][data-v="${t.dataset.v}"]` }; renderAll(); return; }
  if (act === 'cl-qclear') { const q = t.closest('.menu')?.querySelector('[data-cl-q]'); if (q) { q.value = ''; q.dispatchEvent(new Event('input', { bubbles: true })); q.focus(); } }
}, true);
/* ==== end Build N · QC 91 ==== */

/* ==== Build N · QC 92: how much of a free limit is left (mockup R60; the R60 decisions: a small ring beside each cloud model in
   the menu; "that percentage circle icon when connected to an online model turns into the limits, and when hovered over it should
   the rate limits and rest times"; at a limit NeuroVault offers the next model with room, and "Switch automatically (same company
   only)" is a setting, off). The numbers come with each answer (cloud_ai.use_of): from the company's own headers, OpenRouter's key
   on Refresh, or NeuroVault's own count, said as such. Amber at 75%, red at 90%, always with words. ==== */
CLOUD.auto = false;
{ const c0 = readFromConfig; readFromConfig = function (c) { c0(c); CLOUD.auto = c.ai_cloud_autoswitch === true; }; }   // eslint-disable-line no-global-assign
const cloudN = n => Number(n).toLocaleString('en-GB');
const cloudK = n => n >= 10000 ? `${Math.round(n / 1000)}k` : n >= 1000 ? `${+(n / 1000).toFixed(1)}k` : String(n);   // 1k, 14k: the menu's short form
const cloudIn = s => s == null ? '' : s >= 5400 ? `${Math.round(s / 3600)} h` : s >= 90 ? `${Math.round(s / 60)} min` : `${Math.max(1, Math.round(s))} s`;
const cloudTone = (used, of) => !of ? 'ok' : used / of >= .9 ? 'red' : used / of >= .75 ? 'amber' : 'ok';
const cloudRingSvg = (used, of) => `<svg class="cl-ring-svg" viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="6" class="cl-ring-bg"/><circle cx="8" cy="8" r="6" class="cl-ring-fg" stroke-dasharray="${(of ? Math.min(1, used / of) * 37.7 : 0).toFixed(1)} 37.7" transform="rotate(-90 8 8)"/></svg>`;
const cloudAsOf = at => { const t = at && new Date(at); if (!t || isNaN(t) || Date.now() - t < 10 * 60e3) return ''; const d = new Date(); const same = t.toDateString() === d.toDateString();   // QC 98: last-known
  return `, last known at ${t.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}${same ? '' : ` on ${t.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}`}`; };
const cloudUseOf = m => { const p = m && cloudP(m.prov); return p?.models?.find(x => x.id === m.id)?.use || null; };
function cloudSay(u, p) {   // {short, long, tone, pct} for one model's use
  const r = u?.requests, shared = p?.id === 'openrouter' ? ', shared by its free models' : '';
  if (r) { const per = r.window === 'day' ? 'today' : 'this minute', tone = cloudTone(r.used, r.of);
    return { tone, pct: Math.round(Math.min(1, r.used / r.of) * 100), short: `${cloudN(r.used)} of ${cloudN(r.of)}`, tiny: `${cloudK(r.used)} of ${cloudK(r.of)}`,
      long: `Requests ${per}: ${cloudN(r.used)} of ${cloudN(r.of)}${shared} · ${cloudN(r.left)} left${r.reset_in == null ? '' : r.rolling ? ` · refills gradually · next one back in ${cloudIn(r.reset_in)}` : ` · resets in ${cloudIn(r.reset_in)}`}` }; }
  const sent = u?.sent || 0;
  if (p?.reports) return { tone: 'ok', pct: 0, short: sent ? `${cloudN(sent)} sent` : '', tiny: sent ? `${cloudK(sent)} sent` : '', waiting: true,   // QC 98: it says, after the first answer
    long: `Your limits show after your first question today${sent ? ` · ${cloudN(sent)} sent` : ''}` };
  return { tone: 'ok', pct: 0, short: sent ? `${cloudN(sent)} sent` : '', tiny: sent ? `${cloudK(sent)} sent` : '', long: `${cloudN(sent)} sent today · counted by NeuroVault (${esc(p?.name || 'it')} doesn’t say what’s left)`, counted: true };
}
function cloudMeter(u, p, opts = {}) {
  const s = cloudSay(u, p); if (!s.short) return '';
  return `<span class="cl-meter is-${s.counted || s.waiting ? 'counted' : s.tone}" role="meter" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${s.pct}" aria-label="${esc(s.long)}">${s.counted || s.waiting ? '' : cloudRingSvg(u.requests.used, u.requests.of)}<span class="cl-mt">${esc(opts.long ? s.long : opts.tiny ? s.tiny : s.short)}</span></span>`;
}
window.cloudMenuMeter = m => cloudMeter(cloudUseOf(m), cloudP(m.prov), { tiny: true });
window.cloudCardMeter = (p, m) => cloudMeter(m.use, p);
// Settings: the company's limits today, where they come from, and Refresh
function cloudUsageBlock(p) {
  const rows = (p.models || []).filter(m => m.use && (m.use.requests || m.use.sent)), src = rows.find(m => m.use.source !== 'counted')?.use.source || (p.reports && rows.length ? p.reports : '');
  const from = p.reports === 'headers' ? `From ${esc(p.name)}’s replies: each answer says what’s left, and NeuroVault keeps the last-known limits. Check my limits sends one tiny message (“Hi”, none of your notes), which counts as one request.`
    : p.reports === 'key' ? 'From your OpenRouter key, on Check my limits (only the key is sent, no request is used). Its free models share one limit.'
    : `${esc(p.name)} doesn’t say what’s left, so NeuroVault counts what it sent today.`;
  const body = rows.length ? rows.map(m => { const t = m.use.tokens;
    return `<div class="cl-urow"><span class="cl-ul">${esc(m.name)}</span>${cloudMeter(m.use, p, { long: true })}${t ? `<span class="cl-ud">Tokens this minute: ${cloudN(t.used)} of ${cloudN(t.of)}</span>` : ''}</div>`; }).join('')
    : '<p class="set-desc cl-unone">Nothing sent yet today.</p>';
  return `<div class="cl-usage" data-cl-usage="${p.id}"><div class="cl-cm-head"><span class="set-label">Free limit today</span><span class="set-desc cl-cm-state">${src ? 'Updated with each answer' : p.reports ? 'Your limits show after your first question today' : '<span class="chip chip--neutral">Counted by NeuroVault</span>'}</span>${p.reports ? `<button class="btn btn--ghost btn--sm" data-act="cl-usage" data-v="${p.id}">Check my limits</button>` : ''}</div>${body}<p class="set-desc cl-usrc">${from} ${cloudLink(p.limits, 'Its current limits')}</p></div>`;
}
{ const k0 = cloudCard; cloudCard = function (p) { const h = k0.apply(this, arguments); if (!p.has_key || CLOUD.add === p.id) return h; return h.replace('<div class="cl-acts">', `${cloudUsageBlock(p)}<div class="cl-acts">`); }; }   // eslint-disable-line no-global-assign
// the ring by Send: with a cloud model it shows that model's limit; its hover (and focus) shows every limit and when each resets
{ const m0 = aicMeter; aicMeter = function (ctx) {   // eslint-disable-line no-global-assign
  const cur = ainCur('qa'), r = ainRoute('qa'); if (!cur || !cloudIsCloud(cur.where) || r?.kind !== 'cloud') return m0.apply(this, arguments);
  const p = cloudP(r.prov), m = { prov: r.prov, id: r.model }, u = cloudUseOf(m), s = cloudSay(u, p);
  const lines = [`<b>${esc(r.name)} on ${esc(p?.name || '')}</b>`, s.long || 'Nothing sent yet today', u?.tokens ? `Tokens this minute: ${cloudN(u.tokens.used)} of ${cloudN(u.tokens.of)}${u.tokens.reset_in != null ? ` · resets in ${cloudIn(u.tokens.reset_in)}` : ''}` : '',
    s.counted ? `${esc(p?.name || 'It')} doesn’t say what’s left: NeuroVault counts what it sent.` : s.waiting ? `${esc(p?.name || 'It')} says what’s left with each answer. To see it now: Settings → AI models → Check my limits.`
      : u?.source === 'key' ? 'From your OpenRouter key (Check my limits in Settings → AI models).' : `From ${esc(p?.name || 'its')}’s replies${cloudAsOf(u?.at)}.`].filter(Boolean);
  return `<span class="aic-meter cl-ring is-${s.counted || s.waiting ? 'counted' : s.tone}" role="meter" tabindex="0" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${s.pct}" aria-label="${esc(lines.join('. ').replace(/<[^>]+>/g, ''))}" aria-describedby="cl-ringpop" data-aic-meter data-cl-ring>`
    + `<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="6" class="aic-ring-bg"/><circle cx="8" cy="8" r="6" class="aic-ring" stroke-dasharray="${(s.pct / 100 * 37.7).toFixed(1)} 37.7" transform="rotate(-90 8 8)"/></svg>`
    + `<span class="num">${s.counted || s.waiting ? esc(s.short || '0 sent') : `${s.pct}%`}</span><span class="cl-ringpop" id="cl-ringpop" role="tooltip">${lines.map(l => `<span>${l}</span>`).join('')}</span></span>`; }; }
// the next model with room: the same company's (most left), else another company's Recommended one
function cloudNext(r) {
  const same = ainModels().filter(x => x.cloud && x.prov === r.prov && x.id !== r.model && !x.used && r.prov !== 'openrouter').map(x => [x, cloudUseOf(x)?.requests])
    .filter(([, q]) => !q || q.used / q.of < .75).sort((a, b) => (b[1] ? b[1].left : 0) - (a[1] ? a[1].left : 0));
  const other = ainModels().find(x => x.cloud && x.rec && x.prov !== r.prov && !x.used);
  return { same: same[0]?.[0] || null, other: other || null };
}
const cloudLeft = x => { const q = cloudUseOf(x)?.requests; return q ? ` (${cloudN(q.left)} left)` : ''; };
function cloudOffer(r, i) {
  const { same, other } = cloudNext(r), di = i != null ? ` data-i="${i}"` : '';
  return `${same ? `<button class="btn btn--primary btn--sm" data-act="cl-switch" data-v="${esc(same.key)}"${di}>Use ${esc(same.name)} on ${esc(same.svc)}${cloudLeft(same)}</button>` : ''}${other ? `<button class="btn btn--secondary btn--sm" data-act="cl-switch" data-v="${esc(other.key)}"${di}>or ${esc(other.name)}</button>` : ''}`;
}
// at 90%: a heads-up above the input (never over it), with the offer; with Switch automatically on, what answers next
function cloudHeads() {
  const r = ainRoute('qa'); if (r?.kind !== 'cloud' || AIC.busy) return '';
  const q = cloudUseOf({ prov: r.prov, id: r.model })?.requests; if (!q || q.used / q.of < .9 || !q.left) return '';
  const { same } = cloudNext(r), per = q.window === 'day' ? 'today' : 'this minute';
  return `<div class="cl-heads" role="status">${ic('alert')}<span><b>${esc(r.name)}: ${cloudN(q.left)} requests left ${per}</b>${q.reset_in != null ? ` (resets in ${cloudIn(q.reset_in)})` : ''}.${CLOUD.auto && same ? ` When it runs out, ${esc(same.name)} on ${esc(same.svc)} answers instead, and its name shows under the answer.` : ''}</span>${CLOUD.auto ? '' : `<span class="cl-offer">${cloudOffer(r)}</span>`}</div>`;
}
{ const h0 = aicHtml; aicHtml = function () { const h = h0.apply(this, arguments); if (!h) return h; const x = cloudHeads(); return x ? h.replace('<div class="aic-compose">', `${x}<div class="aic-compose">`) : h; }; }   // eslint-disable-line no-global-assign
// at the limit: the offer (or, with Switch automatically on, it asks the next model of the same company by itself)
{ const t0 = aicTurnHtml; aicTurnHtml = function (t, i, all, ro) { let h = t0.apply(this, arguments); const a = t.answers[t.at] || {}; if (!a.limit || ro || a.pending) return h;   // eslint-disable-line no-global-assign
  const r = { prov: a.limit, model: cloudP(a.limit) && (String(a.limitKey || '').split(':').slice(2).join(':') || cloudP(a.limit).models?.find(m => m.rec)?.id) };
  h = h.replace('<div class="aic-err-acts">', `<div class="aic-err-acts cl-offer">${cloudOffer(r, i)}`);
  return a.limit === 'openrouter' ? h.replace('Nothing was sent anywhere else.', 'Nothing was sent anywhere else. OpenRouter’s free models share one limit, so another free model there won’t help.') : h; }; }
{ const n0 = nv; nv = async function (name, ...a) { const r = await n0.call(this, name, ...a); if (name === 'ai_job' && r?.state === 'error' && r.limit_key) CLOUD.limitKeys = { ...(CLOUD.limitKeys || {}), [a[0]]: r.limit_key }; return r; }; }   // eslint-disable-line no-global-assign
{ const e0 = aicEnd; aicEnd = function (a, o) { const jid = AIC.busy?.job, lk = jid && CLOUD.limitKeys?.[jid]; if (o?.err && lk) o = { ...o, limitKey: lk };   // eslint-disable-line no-global-assign
  const r = e0.call(this, a, o);
  if (o?.err && a.limit && CLOUD.auto) {   // Switch automatically: the same company's next model, which you've already said yes to
    const { same } = cloudNext({ prov: a.limit, model: String(a.limitKey || '').split(':').slice(2).join(':') || cloudP(a.limit)?.models?.find(m => m.rec)?.id });
    const n = note(), c = n && aicChat(aicKey(n)), i = c ? c.turns.findIndex(t => t.answers.includes(a)) : -1;
    if (same && i >= 0) ainSetRoute('qa', same.key).then(ok => { if (ok) { toast(`${a.by || 'That model'}’s free limit is used up: ${same.name} on ${same.svc} answers instead (Switch automatically is on)`); cloudRetry(i); } });
  }
  return r; }; }
// Settings: Switch automatically (same company only), off by default
function cloudAutoRow() {
  return `<div class="set-row" data-cl-row="auto"><div><div class="set-label" id="cl-auto-l">Switch automatically</div><div class="set-desc">Off: when a free limit runs out, NeuroVault offers another model and you choose. On: the next model from the same company answers by itself (never a new company), and the answer names it.</div></div><button class="toggle" role="switch" aria-checked="${CLOUD.auto}" aria-labelledby="cl-auto-l" data-act="cl-auto"></button></div>`;
}
app.addEventListener('click', e => {
  const t = e.target.closest?.('[data-act]'), act = t?.dataset.act || ''; if (!/^cl-(switch|usage|auto)$/.test(act)) return;
  e.preventDefault(); e.stopPropagation();
  if (act === 'cl-switch') { const k = t.dataset.v, m = cloudFindModel(k);
    ainSetRoute('qa', k).then(ok => { if (!ok) return; status(`Ask now uses ${m?.name || 'that model'}${m?.svc ? ` on ${m.svc}` : ''}`); if (t.dataset.i != null) cloudRetry(+t.dataset.i); else renderAll(); }); return; }
  if (act === 'cl-usage') { if (!api()) { toast('Cloud keys need the app'); return; } const rq = ainRoute('qa'); status(`Checking ${cloudP(t.dataset.v)?.name || ''}’s limits…`);
    nv('ai_cloud_usage', t.dataset.v, rq?.kind === 'cloud' && rq.prov === t.dataset.v ? rq.model : null).then(async r => { status(failed(r) ? r?.message : r.message); await aiRefresh(); renderAll(); }); return; }
  if (act === 'cl-auto') { CLOUD.auto = !CLOUD.auto; if (api() && !AI_CHECK) saveSettings({ ai_cloud_autoswitch: CLOUD.auto }); status(CLOUD.auto ? 'Switch automatically is on: the same company’s next model answers when a free limit runs out' : 'Switch automatically is off: NeuroVault offers another model at a limit'); S.focus = { sel: '[data-act="cl-auto"]' }; renderAll(); }
}, true);
{ const s0 = cloudSection; cloudSection = function () { const h = s0.apply(this, arguments); if (!h) return h;   // eslint-disable-line no-global-assign
  return h.replace(/<\/section>$/, `<div class="cl-group">Free limits and switching</div>${cloudAutoRow()}</section>`); }; }
/* ==== end Build N · QC 92 ==== */

/* ==== Build N · QC 93 → QC 101: AI may read this note's attachments, if you allow it (design profile 3900648; off by default).
   QC 101 (feedback: "how can we get an ai to review the attachement?", "there is a second one in there but the model doesnt have
   access to it"): every text-based file goes as its text to ANY model (HTML sanitised to its words, Markdown, text, CSV, JSON,
   code, PDF, Word, Excel: ai_attach.py, cached); pictures only to a model that can see them. Nothing is skipped silently: above
   the input each file is included, trimmed (to what the model reads at once) or not readable, with why, and the model is told
   which files it couldn't get. The paperclip picker by the input ticks files per question and adds one from the vault. With the setting
   off, one quiet line says how to include them. The cloud notice names the files. ==== */
CLOUD.att = false;
CLOUD.attPick = {};      // note key → { off: [unticked files], extra: [files added from the vault] }
CLOUD.attPrev = null;    // { key, items, budget, busy }: what would go, from ai_attach_preview
CLOUD.attMenu = null;    // null | 'list' | 'vault'
CLOUD.attQ = '';
CLOUD.vault = null;      // the vault's attachments, for "Add a file from the vault"
{ const c0 = readFromConfig; readFromConfig = function (c) { c0(c); CLOUD.att = c.ai_read_attachments === true; }; }   // eslint-disable-line no-global-assign
const CLOUD_ATT_RE = /!\[\[(attachments\/[^\[\]\n|#]+?)(?:[|#][^\[\]\n]*)?\]\]/g;
function cloudNoteAtts(n) {   // every file this note embeds, each once
  const out = []; for (const m of String(n?.md || '').matchAll(CLOUD_ATT_RE)) if (!out.includes(m[1])) out.push(m[1]);
  return out;
}
const cloudAttName = f => String(f).replace(/^attachments\//, '');
const cloudAttKey = n => n ? aicKey(n) : '';
const cloudAttPickOf = n => CLOUD.attPick[cloudAttKey(n)] || (CLOUD.attPick[cloudAttKey(n)] = { off: [], extra: [] });
const cloudAttAll = n => { const own = cloudNoteAtts(n); return [...own, ...cloudAttPickOf(n).extra.filter(f => !own.includes(f))]; };
const cloudAttTicked = n => { const off = cloudAttPickOf(n).off; return cloudAttAll(n).filter(f => !off.includes(f)); };
// the page's own guess, before (or without) the app's answer: the same kinds as ai_attach.py
const CLOUD_TXT = /\.(md|markdown|txt|text|csv|tsv|json|jsonl|log|xml|ya?ml|toml|ini|cfg|conf|rst|tex|srt|vtt|ics|ipynb|py|js|mjs|cjs|tsx?|jsx|vue|svelte|s?css|sass|less|java|kts?|scala|c|h|cc|cpp|cxx|hpp|cs|fs|go|rs|rb|php|pl|lua|r|jl|dart|swift|sh|bash|ps1|bat|cmd|sql|graphql|proto|tf|html?|xhtml|pdf|docx|docm|xlsx|xlsm)$/i;
const CLOUD_PIC = /\.(png|jpe?g|webp|gif)$/i, CLOUD_SND = /\.(ogg|opus|oga|wav|mp3|m4a|flac|aac)$/i, CLOUD_VID = /\.(mp4|mov|mkv|avi|wmv|m4v|webm)$/i, CLOUD_ZIP = /\.(zip|7z|rar|tar|gz|tgz)$/i;
function cloudAttGuess(f, r) {
  const name = cloudAttName(f), ext = (name.match(/\.[^.]+$/) || [''])[0].toLowerCase(), it = { file: f, name, kind: CLOUD_PIC.test(name) ? 'image' : 'text', state: 'included', why: '', chars: 0, of: 0 };
  if (CLOUD_PIC.test(name)) { if (!(r?.kind === 'cloud' && r.vision)) Object.assign(it, { state: 'unreadable', why: r?.kind === 'cloud' ? `${r.name} can’t see pictures: pick a model marked with an image icon` : 'models on this PC can’t see pictures yet' }); return it; }
  if (CLOUD_TXT.test(name)) return it;
  return Object.assign(it, { state: 'unreadable', why: CLOUD_SND.test(name) ? 'it’s a sound recording, which the AI can’t hear' : CLOUD_VID.test(name) ? 'it’s a video, which the AI can’t watch'
    : CLOUD_ZIP.test(name) ? 'it’s a compressed archive: unzip it and add the files inside' : `NeuroVault can’t read ${ext || 'these'} files` });
}
// what would go with the next question: the app reads the files (cached) and says, file by file; the page's guess until then
function cloudAttItems(n) {
  const files = cloudAttTicked(n), r = ainRoute('qa'); if (!files.length) return { items: [], ready: true };
  const key = `${rawId(n.id)}|${files.join(',')}|${r?.key || ''}|${(n.md || '').length}`;
  if (CLOUD.attPrev?.key === key && CLOUD.attPrev.items) return { items: CLOUD.attPrev.items, ready: true };
  if (api() && CLOUD.attPrev?.key !== key) {
    CLOUD.attPrev = { key, items: null, busy: true };
    nv('ai_attach_preview', rawId(n.id), files, n.md ?? null).then(res => {
      if (CLOUD.attPrev?.key !== key) return;
      // the app's answer, file by file; the page's guess when it couldn't say (failed, the setting off there, or not every file named)
      const fine = !failed(res) && res?.on !== false && Array.isArray(res?.items) && files.every(f => res.items.some(i => i.file === f));
      CLOUD.attPrev = { key, items: fine ? files.map(f => res.items.find(i => i.file === f)) : files.map(f => cloudAttGuess(f, r)), budget: fine ? res.budget || 0 : 0 };
      if (AIC.open) renderAll(); });
  }
  return { items: files.map(f => cloudAttGuess(f, r)), ready: !api() };
}
const cloudAttGoing = items => items.filter(i => i.state === 'included' || i.state === 'trimmed');
function cloudAttSay(i) {   // one file's line
  return i.state === 'trimmed' ? `trimmed to fit: the first ${cloudN(i.chars)} of ${cloudN(i.of)} characters` : i.state === 'unreadable' ? `not readable: ${i.why}` : 'included';
}
// above the input: where they go, then each file and what happens to it
function cloudAttLine() {
  const n = note(); if (!n || AIC.busy || AIC.viewing || AIC.scope !== 'note') return '';
  const all = cloudAttAll(n); if (!all.length) return '';
  if (!CLOUD.att) { const names = all.map(cloudAttName), shown = names.length > 2 ? `${names.slice(0, 2).join(', ')} and ${names.length - 2} more` : names.join(' and ');
    return `<div class="cl-attline is-none is-hint" role="note" data-cl-att-off>${ic('paperclip')}<span>Turn on “Let AI read attachments” to include ${esc(shown)}.</span><button class="btn btn--ghost btn--sm" data-act="cl-att" data-v="hint">Turn on</button></div>`; }
  const r = ainRoute('qa'); if (!r || r.kind === 'none' || !ainCur('qa')) return '';
  const { items, ready } = cloudAttItems(n), going = cloudAttGoing(items), off = cloudAttPickOf(n).off.filter(f => all.includes(f)).length;
  const where = r.kind === 'cloud' ? `${esc(r.name)} on ${esc(r.svc)}` : `${esc(ainCur('qa')?.name || 'the model')} on this PC`;
  const head = items.length ? `<b>${going.length} of ${items.length} attachment${items.length === 1 ? '' : 's'}</b> go${going.length === 1 && items.length === 1 ? 'es' : ''} to ${where}` : '<b>No attachments</b> go with this question';
  const list = items.map(i => `<li class="cl-att-i is-${i.state}" data-cl-att-file="${esc(i.file)}" data-cl-att-state="${i.state}"><span class="cl-att-n">${esc(i.name)}</span><span class="cl-att-s">${esc(cloudAttSay(i))}</span></li>`).join('');
  return `<div class="cl-attline" role="note" data-cl-att="${going.length}"${ready ? '' : ' aria-busy="true"'}>${ic('paperclip')}<div class="cl-att-body"><span>${head}${off ? ` · ${off} unticked` : ''}${ready ? '' : ' · reading them…'}</span>${list ? `<ul class="cl-att-list">${list}</ul>` : ''}</div></div>`;
}
// the 📎 picker by the input: tick or untick each file for this question, and add one from the vault
function cloudAttBtn() {
  const n = note(); if (!n || !CLOUD.att || AIC.scope !== 'note' || AIC.viewing) return '';
  const all = cloudAttAll(n), on = cloudAttTicked(n).length, open = !!CLOUD.attMenu;
  return `<button class="icon-btn icon-btn--sm aic-tip cl-attbtn" data-act="cl-attpick" aria-haspopup="dialog" aria-expanded="${open}" aria-label="Attachments for this question: ${on} of ${all.length}" data-tip="Attachments for this question">${ic('paperclip')}${all.length ? `<span class="cl-attbtn-n">${on}</span>` : ''}</button>`;
}
function cloudAttMenu() {
  const n = note(); if (!n || !CLOUD.att || !CLOUD.attMenu) return '';
  if (CLOUD.attMenu === 'vault') {
    const have = cloudAttAll(n), q = CLOUD.attQ.trim().toLowerCase();
    const rows = (CLOUD.vault || []).filter(f => !have.includes(f.file) && (!q || f.name.toLowerCase().includes(q))).slice(0, 40);
    const body = CLOUD.vault == null ? '<p class="cl-attm-empty">Loading the vault’s files…</p>'
      : rows.length ? rows.map(f => `<button class="cl-attm-add" data-act="cl-attadd" data-v="${esc(f.file)}" data-tip-cut data-tip="${esc(f.name)}">${cloudMid(f.name)}<span class="cl-att-s">${esc(cloudAttGuess(f.file, ainRoute('qa')).state === 'unreadable' ? 'not readable' : f.size != null ? fmtBytes(f.size) : '')}</span></button>`).join('')
      : `<p class="cl-attm-empty">${q ? 'No file in the vault matches.' : 'No other files in the vault’s attachments folder.'}</p>`;
    return `<div class="cl-attm" role="dialog" aria-label="Add a file from the vault" data-cl-attm="vault"><div class="cl-attm-h"><button class="icon-btn icon-btn--sm" data-act="cl-attback" aria-label="Back to this question’s attachments">${ic('left')}</button><span>Add a file from the vault</span></div>
      <input class="input input--sm cl-attm-q" id="cl-attq" data-cl-attq type="search" placeholder="Search the vault’s files" aria-label="Search the vault’s files" value="${esc(CLOUD.attQ)}"><div class="cl-attm-list">${body}</div></div>`;
  }
  const all = cloudAttAll(n), off = cloudAttPickOf(n).off, own = cloudNoteAtts(n);
  const rows = all.map(f => `<label class="cl-attm-row" data-tip-cut data-tip="${esc(cloudAttName(f))}"><input type="checkbox" data-act="cl-atttick" data-v="${esc(f)}"${off.includes(f) ? '' : ' checked'}>${cloudMid(cloudAttName(f))}${own.includes(f) ? '' : '<span class="cl-att-s">from the vault</span>'}</label>`).join('');
  return `<div class="cl-attm" role="dialog" aria-label="Attachments for this question" data-cl-attm="list"><div class="cl-attm-h"><span>Attachments for this question</span></div>
    <div class="cl-attm-list">${rows || '<p class="cl-attm-empty">This note has no attachments.</p>'}</div><button class="btn btn--ghost btn--sm cl-attm-more" data-act="cl-attvault">${ic('plus')}Add a file from the vault</button></div>`;
}
// QC 106: a long name keeps its start and its end ("Screenshot 2026-10-18 23…(edited 6).png"); the full name is the tooltip when it's cut
function cloudMid(name) { const s = String(name), k = Math.min(16, Math.max(0, s.length - 18));
  return `<span class="cl-att-n cl-mid"><span class="cl-mid-a">${esc(s.slice(0, s.length - k))}</span>${k ? `<span class="cl-mid-b">${esc(s.slice(s.length - k))}</span>` : ''}</span>`; }   // the two halves read as the whole name
// QC 106: the picker fits between the top of the chat and the input: its list scrolls inside it, the search stays at the top
function cloudAttFit() {
  const m = app.querySelector('.cl-attm'); if (!m) return; const win = m.closest('[data-aic-win]'), box = win?.querySelector('.aic-box'); if (!win || !box) return;
  const P = m.offsetParent || win, z = P.getBoundingClientRect().width / (P.offsetWidth || 1) || 1, top = win.querySelector('.aic-head')?.getBoundingClientRect().bottom ?? win.getBoundingClientRect().top;
  const room = Math.floor((box.getBoundingClientRect().top - top) / z) - 8 - 4;
  m.style.maxHeight = Math.max(120, Math.min(360, room)) + 'px';
  const pr = P.getBoundingClientRect(); m.style.bottom = Math.round((pr.bottom - box.getBoundingClientRect().top) / z + 4) + 'px';
}
{ const a0 = afterRender; afterRender = function () { a0.apply(this, arguments); cloudAttFit(); }; }   // eslint-disable-line no-global-assign
{ const w0 = aicAfterWin; aicAfterWin = function () { w0.apply(this, arguments); cloudAttFit(); }; }   // eslint-disable-line no-global-assign
const fmtBytes = b => b >= 1e6 ? `${(b / 1e6).toFixed(1)} MB` : b >= 1e3 ? `${Math.round(b / 1e3)} KB` : `${b} B`;
{ const h0 = aicHtml; aicHtml = function () { let h = h0.apply(this, arguments); if (!h) return h; const x = cloudAttLine();   // eslint-disable-line no-global-assign
  if (x) h = h.replace('<div class="aic-compose">', `${x}<div class="aic-compose">`);
  const b = cloudAttBtn(); if (b) h = h.replace(/(<div class="aic-row">[\s\S]*?)(<span class="aic-grow"><\/span>)/, `$1${b}$2`);
  const m = cloudAttMenu(); if (m) h = h.replace('<div class="aic-compose">', `<div class="aic-compose cl-attwrap">${m}`);
  return h; }; }
// Ask sends the ticked files (the app checks again: the setting, and that each is a file in attachments/)
{ const n0 = nv; nv = async function (name, ...a) {   // eslint-disable-line no-global-assign
  if (name === 'ai_ask' && a[1] && CLOUD.att) { const n = note(), files = n && rawId(n.id) === a[1] ? cloudAttTicked(n) : []; if (files.length) { a = [...a]; while (a.length < 4) a.push(null); a[4] = files; } }
  return n0.call(this, name, ...a); }; }
// the first-use notice names them too
{ const f0 = cloudFacts; cloudFacts = function (p, o = {}) { const h = f0.apply(this, arguments); if (!o.q || !CLOUD.att) return h; const n = note(); if (!n) return h;   // eslint-disable-line no-global-assign
  const going = cloudAttGoing(cloudAttItems(n).items); if (!going.length) return h;
  return h.replace(/(<dt>What’s sent<\/dt><dd>[^<]*?)\.<\/dd>/, `$1, and its attachments: ${esc(going.map(i => i.name).join(', '))}.</dd>`); }; }
// Settings → AI models → Attachments
function cloudAttRow() {
  return `<div class="set-row" data-cl-row="att"><div><div class="set-label" id="cl-att-l">Let AI read this note’s attachments</div><div class="set-desc">Off: only the note’s words go. On: every file it can read goes as its text to any model, on this PC or in the cloud (PDF, Word, Excel, HTML, Markdown, text, CSV, JSON and code), trimmed to what the model can read at once; pictures go only to a model that can see them (an image icon in the model menu). The Ask chat lists each file first, and the paperclip by the input ticks them per question.</div></div><button class="toggle" role="switch" aria-checked="${CLOUD.att}" aria-labelledby="cl-att-l" data-act="cl-att"></button></div>`;
}
app.addEventListener('click', e => {
  const t = e.target.closest?.('[data-act]'), act = t?.dataset.act || '';
  if (CLOUD.attMenu && !e.target.closest?.('.cl-attm') && act !== 'cl-attpick') {   // a click outside closes the picker (its box goes at once; the next draw agrees)
    CLOUD.attMenu = null; app.querySelectorAll('.cl-attm').forEach(m => m.remove()); app.querySelectorAll('[data-act="cl-attpick"]').forEach(x => x.setAttribute('aria-expanded', 'false')); }
  if (!/^cl-att(|pick|vault|back|add)$/.test(act)) return;
  e.preventDefault(); e.stopPropagation();
  if (act === 'cl-att') { CLOUD.att = !CLOUD.att; CLOUD.attPrev = null; if (api() && !AI_CHECK) saveSettings({ ai_read_attachments: CLOUD.att });
    status(CLOUD.att ? 'AI may read this note’s attachments: each file shows above the input first' : 'AI reads only the note’s words'); S.focus = { sel: t.dataset.v === 'hint' ? '[data-act="cl-attpick"]' : '[data-act="cl-att"]' }; renderAll(); return; }
  if (act === 'cl-attpick') { CLOUD.attMenu = CLOUD.attMenu ? null : 'list'; S.focus = { sel: CLOUD.attMenu ? '[data-act="cl-atttick"], [data-act="cl-attvault"]' : '[data-act="cl-attpick"]' }; renderAll(); return; }
  if (act === 'cl-attback') { CLOUD.attMenu = 'list'; S.focus = { sel: '[data-act="cl-attvault"]' }; renderAll(); return; }
  if (act === 'cl-attvault') { CLOUD.attMenu = 'vault'; CLOUD.attQ = ''; S.focus = { sel: '#cl-attq' };
    if (api()) { CLOUD.vault = null; nv('list_attachments').then(r => { CLOUD.vault = failed(r) ? [] : (r.files || []); if (CLOUD.attMenu === 'vault') { S.focus = { sel: '#cl-attq' }; renderAll(); } }); } else CLOUD.vault = CLOUD.vault || [];
    renderAll(); return; }
  if (act === 'cl-attadd') { const n = note(); if (!n) return; const pk = cloudAttPickOf(n), f = t.dataset.v; if (!pk.extra.includes(f)) pk.extra.push(f); pk.off = pk.off.filter(x => x !== f);
    CLOUD.attMenu = 'list'; status(`${cloudAttName(f)} goes with this question too`); S.focus = { sel: `[data-act="cl-atttick"][data-v="${CSS.escape(f)}"]` }; renderAll(); }
}, true);
app.addEventListener('change', e => {
  const t = e.target.closest?.('[data-act="cl-atttick"]'); if (!t) return; const n = note(); if (!n) return; const pk = cloudAttPickOf(n), f = t.dataset.v;
  pk.off = t.checked ? pk.off.filter(x => x !== f) : [...new Set([...pk.off, f])];
  if (!t.checked && pk.extra.includes(f)) pk.extra = pk.extra.filter(x => x !== f);   // a vault file unticked leaves the list
  status(`${cloudAttName(f)} ${t.checked ? 'goes with' : 'stays out of'} this question`); S.focus = { sel: `[data-act="cl-atttick"][data-v="${CSS.escape(f)}"]` }; renderAll();
}, true);
app.addEventListener('input', e => { const q = e.target.closest?.('[data-cl-attq]'); if (!q) return; CLOUD.attQ = q.value; S.focus = { sel: '#cl-attq', pos: q.selectionStart }; renderAll(); }, true);
document.addEventListener('keydown', e => { if (e.key !== 'Escape' || !CLOUD.attMenu) return; CLOUD.attMenu = null; S.focus = { sel: '[data-act="cl-attpick"]' }; renderAll(); e.preventDefault(); e.stopImmediatePropagation(); }, true);
/* ==== end Build N · QC 93 → QC 101 ==== */
