/* BUILD B · LOCAL AI: Settings → AI models, the status bar's model name and the Magic task breakdown.
   NeuroVault runs the models itself with llama.cpp's server (local_ai.py, api.py ai_*): nothing else to install.
   The locked page is R22's "pick" (R27): one recommended model first, the full list folded away; R23's two answers
   (keep or delete the old model, where long questions go) are settings on it.
   Extracted from design/vault-notes-mockups.html (R22, R23, R27): aiPcData, aiFits, aiRec, aiSpeed, aiPane22 (pick),
   aiRow, aiHeroDl, aiLibFoot, aiRoute, obSeg('long'…), obSeg('keep'…), aiOthers, aiStatusLink, and the .ai-* CSS.
   The page asks before anything downloads, with each file, its source and its size.
   Without the app (a browser, ?check=1) it shows the mockup's sample PCs, so the layout can still be checked. */
'use strict';
// Fix C: its own ?check=1 flag. actions.js's CHECK isn't defined yet when aiStart's setTimeout (and the aiRefresh after
// ai_boot) can run during page load: "CHECK is not defined"
const AI_CHECK = new URLSearchParams(location.search).get('check') === '1';
const AI = { st: null, loading: false, timer: null, more: false, ask: null, probed: false, demo: false, started: false };
S.ob = S.ob || {};   // R23's answers (keep, long), shared with the guided setup (piece D)
S.splitting = null;  // the task being broken down

/* ---- The mockup's sample PCs and list, for the page without the app ---- */
const AI_SAMPLE_MODELS = [
  ['qwen35-4b', 'Qwen3.5 4B', 'Qwen3.5 4B', 'Alibaba Qwen', 'Voice ramble clean-up, task breakdown, summaries', 2.7, 6, 'Apache 2.0', 'Mar 2026'],
  ['qwen35-2b', 'Qwen3.5 2B', 'Qwen3.5 2B', 'Alibaba Qwen', 'Quick clean-ups on any PC', 1.3, 4, 'Apache 2.0', 'Mar 2026'],
  ['qwen35-08b', 'Qwen3.5 0.8B', 'Qwen3.5 0.8B', 'Alibaba Qwen', 'The smallest: quick tidy-ups on older PCs', 0.5, 3, 'Apache 2.0', 'Mar 2026'],
  ['phi4-mini', 'Phi-4-mini 3.8B', 'Phi-4-mini', 'Microsoft', 'Step-by-step reasoning', 2.5, 6, 'MIT', 'Feb 2025'],
  ['gemma4-e2b', 'Gemma 4 E2B', 'Gemma 4 E2B', 'Google', 'Small and careful', 3.1, 5, 'Apache 2.0', 'Apr 2026'],
  ['qwen35-9b', 'Qwen3.5 9B', 'Qwen3.5 9B', 'Alibaba Qwen', 'Best answers about your notes; wants a graphics card', 5.7, 10, 'Apache 2.0', 'Mar 2026']];
const AI_PCS = { gpu: { mem_gb: 32, free_gb: 214, gpu: { name: 'NVIDIA GeForce RTX 3070', vram_gb: 8 }, card: 'NVIDIA GeForce RTX 3070 (8 GB): models run on the graphics card' },
  nogpu: { mem_gb: 16, free_gb: 38, gpu: null, card: 'no graphics card found: models run on the processor, so a small one is quickest' },
  lowdisk: { mem_gb: 8, free_gb: 3.9, gpu: null, card: 'no graphics card found: models run on the processor' } };   // R23: the sample PCs
// The same rules as local_ai.py (fits, recommend, speed), for the sample only: the app sends its own answers
const aiSampleFits = (m, p, inst) => m.ram > p.mem_gb ? `Needs ${m.ram} GB memory; this PC has ${p.mem_gb} GB` : !inst && m.gb + 1 > p.free_gb ? `Needs ${m.gb} GB free space; C: has ${p.free_gb} GB` : '';
const aiSampleSpeed = (m, p) => p.gpu && p.gpu.vram_gb >= m.gb + .8 ? (m.gb > 5 ? 'Fine on this PC' : 'Quick on this PC') : (m.gb < 2 ? 'Quick on this PC' : m.gb > 5 ? 'Slow on this PC' : 'Fine on this PC');
function aiDemo(state = 'none', more = false) {
  const pc = { ...AI_PCS[state === 'nogpu' || state === 'lowdisk' ? state : 'gpu'], drive: 'C:', vulkan: true };
  pc.free_bytes = pc.free_gb * 1e9;
  const ready = ['ready', 'nogpu', 'lowdisk'].includes(state), inst = ready ? (pc.gpu ? ['qwen35-4b', 'qwen35-2b'] : ['qwen35-2b']) : [];
  const models = AI_SAMPLE_MODELS.map(([id, name, short, by, good, gb, ram, licence, released]) => { const m = { id, name, short, by, good, gb, bytes: gb * 1e9, ram, licence, released, file: name.replace(/ /g, '-') + '-Q4_K_M.gguf', page: 'https://huggingface.co/unsloth/' + name.replace(/ /g, '-') + '-GGUF', installed: inst.includes(id), custom: false };
    return { ...m, fit: aiSampleFits(m, pc, m.installed), speed: aiSampleSpeed(m, pc) }; });
  const rec = pc.gpu ? 'qwen35-4b' : 'qwen35-2b', use = ready ? rec : null;
  const offer = { variant: pc.gpu ? 'vulkan' : 'cpu', file: 'llama-b11696-bin-win-vulkan-x64.zip', bytes: 32220792, mb: 32, source: 'github.com/ggml-org/llama.cpp (official release b11696)' };
  const local = use ? { kind: 'local', model: use, label: `On this PC · ${models.find(m => m.id === use).name}`, ready: true, name: models.find(m => m.id === use).name } : { kind: 'none', model: null, label: 'Waits for a model on this PC', ready: false };
  AI.st = { status: 'success', demo: true, pc, pc_line: `${pc.mem_gb} GB memory · ${pc.free_gb} GB free on C: · ${pc.card}`, models, rec, installed: inst, use,
    downloads: state === 'downloading' ? { 'qwen35-4b': { key: 'qwen35-4b', label: 'Qwen3.5 4B', state: 'downloading', done: 2.7e9 * .46, total: 2.7e9, message: '', file: 'Qwen3.5-4B-Q4_K_M.gguf' } } : {},
    engine: { state: ready ? 'running' : state === 'downloading' ? 'stopped' : 'none', where: pc.gpu ? 'gpu' : 'cpu', message: '', port: null, model: use, build: ready || state === 'downloading' ? { tag: 'b11696', variant: offer.variant } : null, offer, on: true },
    keep: pc.free_gb < 20 ? 'delete' : 'keep', long: 'local', auto_route: true, route: { ramble: 'auto', split: 'auto', summary: 'auto', qa: 'auto', tidy: 'auto', fallback: 'auto' },   // Build N: summary, qa, tidy
    routes: { ramble: local, split: local, summary: local, qa: local, tidy: local, fallback: local }, providers: {}, cloud: [],   // Build N (R56): cloud-ai.js fills the companies from cloud_providers.json
    catalog_updated: '2026-10-16', models_dir: 'C:\\Users\\you\\AppData\\Local\\NeuroVault\\models\\llm', used_gb: inst.reduce((t, id) => t + models.find(m => m.id === id).gb, 0), drive: 'C:' };
  AI.demo = true; AI.more = more; AI.ask = null; aiSyncOb();
  return AI.st;
}

/* ---- The mockup's helpers, on the app's answers ---- */
const aiSt = () => AI.st || aiDemo();
const aiPcData = () => aiSt().pc;
const aiPc = () => aiSt().pc_line;
const aiModel = id => aiSt().models.find(m => m.id === id);
const aiFits = m => m.installed ? '' : m.fit;
const aiRec = () => aiModel(aiSt().rec) || aiSt().models.find(m => !m.fit) || aiSt().models[0];
const aiSpeed = m => m.speed;
const aiGb = n => n >= 10 ? Math.round(n) : +n.toFixed(1);
const aiSource = m => String(m.page || '').replace(/^https?:\/\//, '');
const aiActive = d => d && ['downloading', 'checking'].includes(d.state);
const aiModelDl = () => Object.values(aiSt().downloads).find(d => d.key !== 'engine' && d.state !== 'error') || null;
function aiSyncOb() { const a = aiSt(); S.ob.keep = a.keep; S.ob.long = a.long; }
const aiEngineOn = () => ['running', 'starting'].includes(aiSt().engine.state);

function aiStatusLink() {
  const a = aiSt(), m = a.use && aiModel(a.use), dl = aiModelDl() || (aiActive(a.downloads.engine) ? a.downloads.engine : null);
  const short = m && (m.short.length > 14 ? m.short.slice(0, 13) + '…' : m.short);
  const [label, title] = m && aiEngineOn() ? [short, `AI models: ${m.name} runs on this PC, inside NeuroVault`] : dl ? ['Downloading…', `AI models: ${dl.label} is downloading`]
    : m ? ['Local AI · off', `AI models: ${m.name} is on this PC; the engine is stopped`] : ['Local AI · off', 'AI models: no model on this PC yet'];   // no longer than "Ollama · local", so the trail keeps its room
  return `<button class="status-link" data-act="model" title="${esc(title)}" aria-label="${esc(title)}">${ic('cpu')}<span class="status-label">${esc(label)}</span></button>`;
}

/* ---- Downloads: the bar, how much, Pause / Resume, Cancel ---- */
function aiDlText(d, gb) {
  const pct = d.total ? d.done / d.total : 0;
  if (d.state === 'checking') return d.key === 'engine' ? 'Unpacking…' : 'Checking the file…';
  const of = d.key === 'engine' ? `${Math.round(d.done / 1e6)} of ${Math.round(d.total / 1e6)} MB` : `${(gb * pct).toFixed(1)} of ${gb} GB`;
  return of + (d.state === 'paused' ? ' · paused' : d.state === 'error' ? ' · stopped' : '');
}
function aiBar(d, label, gb) {
  const pct = Math.min(100, d.total ? d.done / d.total * 100 : 0);
  return `<div class="progress" role="progressbar" aria-label="Downloading ${esc(label)}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(pct)}"><span style="width:${pct.toFixed(1)}%"></span></div>
    <span class="set-desc num" data-ai-dl-text>${aiDlText(d, gb)}</span>`;
}
const aiDlBtns = d => d.state === 'checking' ? '' : `<button class="btn btn--ghost btn--sm" data-act="${d.state === 'downloading' ? 'ai-pause' : 'ai-resume'}" data-v="${d.key}">${d.state === 'downloading' ? 'Pause' : 'Resume'}</button><button class="btn btn--ghost btn--sm" data-act="ai-cancel" data-v="${d.key}">Cancel</button>`;
const aiDlErr = d => d.state === 'error' && d.message ? `<div class="set-desc ai-nofit" role="alert">${esc(plainMsg(d.message))}</div>` : '';
function aiEngineLine() {   // the engine's own download, under the model's
  const d = aiSt().downloads.engine;
  return d ? `<div class="ai-hero-dl" data-ai-dl="engine"><span class="set-desc">AI engine</span>${aiBar(d, 'the AI engine', 0)}${aiDlBtns(d)}</div>${aiDlErr(d)}` : '';
}

/* ---- Asking first: each file, where it comes from and how big ---- */
function aiConfirm() {
  const a = aiSt(), q = AI.ask; if (!q) return '';
  const m = q.id && aiModel(q.id), eng = !a.engine.build && !a.downloads.engine ? a.engine.offer : null;
  const lines = [eng && `The AI engine: <span class="code">${esc(eng.file)}</span>, ${eng.mb} MB, from ${esc(eng.source)}`, m && `${esc(m.name)}: <span class="code">${esc(m.file)}</span>, ${m.gb} GB, from ${esc(aiSource(m))}`].filter(Boolean);
  const total = (eng ? eng.bytes : 0) + (m ? m.bytes : 0);
  return `<div class="ai-callout ai-confirm" role="group" aria-labelledby="ai-ask-t"><div class="set-label" id="ai-ask-t">Download ${lines.length > 1 ? 'these two files' : 'this file'}?</div>
    ${lines.map(l => `<div class="set-desc">${l}</div>`).join('')}<div class="set-desc">${aiGb(total / 1e9)} GB in all; ${a.pc.drive} has ${a.pc.free_gb} GB free. Nothing is sent from this PC.</div>
    <div class="ai-hero-btns ai-confirm-btns"><button class="btn btn--primary" id="ai-ask-go" data-act="ai-dl-go">${ic('download')}Download</button><button class="btn btn--ghost" data-act="ai-dl-no">Not now</button></div></div>`;
}

/* ---- The list's rows (R22) ---- */
function aiRow(m) {
  const a = aiSt(), dl = a.downloads[m.id], inst = m.installed, use = a.use === m.id, rec = m.id === a.rec, why = aiFits(m);
  const act = dl ? `<div class="ai-dl" data-ai-dl="${m.id}">${aiBar(dl, m.name, m.gb)}${aiDlBtns(dl)}</div>`
    : inst ? `${use ? '<span class="chip chip--success">In use</span>' : `<button class="btn btn--secondary btn--sm" data-act="ai-use" data-v="${m.id}">Use</button>`}<button class="btn btn--ghost btn--sm" data-act="ai-remove" data-v="${m.id}" title="${m.custom ? 'Remove (the file stays where it is)' : `Delete the model file (${m.gb} GB)`}">${m.custom ? 'Remove' : 'Delete'}</button>`   /* QC 88: only the one that deletes says Delete */
    : why ? `<button class="btn btn--secondary btn--sm" disabled title="${esc(why)}" aria-label="Download ${esc(m.name)}: ${esc(why)}">${ic('download')}Download</button>`
    : `<button class="btn btn--secondary btn--sm" data-act="ai-dl" data-v="${m.id}" aria-label="Download ${esc(m.name)}, ${m.gb} GB">${ic('download')}Download</button>`;
  return `<div class="ai-model${use ? ' is-use' : ''}"><div class="provider-main"><div class="ai-name"><span class="set-label">${esc(m.name)}</span><span class="set-desc">${esc(m.by)}</span>${rec ? '<span class="chip chip--accent">Best for this PC</span>' : ''}</div>
    <div class="set-desc${m.custom ? ' code' : ''}">${esc(m.good)}</div><div class="set-desc ai-meta">${m.gb} GB download · needs ${m.ram} GB memory · ${why && !inst ? `<span class="ai-nofit">${esc(why)}</span>` : aiSpeed(m)} · ${esc(m.licence)} · ${esc(m.released)}</div>${dl ? aiDlErr(dl) : ''}</div><div class="ai-act">${act}</div></div>
    ${AI.ask?.id === m.id && !AI.ask.hero ? aiConfirm() : ''}`;
}
function aiHeroDl(m) {
  const d = aiSt().downloads[m.id];
  return `<div class="ai-hero-dl" data-ai-dl="${m.id}">${aiBar(d, m.name, m.gb)}${aiDlBtns(d)}</div>${aiDlErr(d)}${aiEngineLine()}`;
}
const aiDate = s => { const d = new Date(s + 'T12:00:00'); return isNaN(d) ? s : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }); };
const aiShortPath = p => String(p).replace(/^[A-Z]:\\Users\\[^\\]+\\/i, '');
const aiLibFoot = () => `<div class="ai-foot"><span class="set-desc">Model list from NeuroVault, updated ${aiDate(aiSt().catalog_updated)}. Models folder: ${esc(aiShortPath(aiSt().models_dir))} (${aiGb(aiSt().used_gb)} GB used)</span>
  <button class="btn btn--ghost btn--sm" data-act="ai-check">Check for new models</button><button class="btn btn--ghost btn--sm" data-act="ai-gguf">Add a .gguf file…</button></div>`;

/* ---- R23's two answers, as settings ---- */
const obSeg = (k, label, desc, opts) => `<div class="set-row"><div><div class="set-label" id="ob-${k}">${label}</div><div class="set-desc">${desc}</div></div><div class="seg" role="group" aria-labelledby="ob-${k}">${opts.map(([v, l]) => `<button class="seg-opt" data-act="ob-set" data-k="${k}" data-v="${v}" aria-pressed="${aiSt() && S.ob[k] === v}">${l}</button>`).join('')}</div></div>`;

/* ---- Which model does each job ---- */
// Build N (R46 §2): Note summaries, Ask about a note and Tidy up are jobs of their own, each with its own model (AI_PICK: a choice
// that counts with the smart auto-router on too; "The model in use (automatic)" leaves it to the router)
const AI_JOBS = [['ramble', 'Voice ramble clean-up'], ['split', 'Magic task breakdown'], ['summary', 'Note summaries'], ['qa', 'Ask about a note'], ['tidy', 'Tidy up'], ['fallback', 'Offline fallback']];
const AI_PICK = ['summary', 'qa', 'tidy'];
function aiRoute() {   // which model does each job: "On this PC" means the model in use
  const a = aiSt(), auto = a.auto_route;
  const pickText = k => { const r = a.routes[k]; return k === 'qa' && S.ob.long === 'cloud' && r.kind === 'local' ? `${r.label} · no cloud key yet` : r.label; };
  const opts = [['auto', 'The model in use'], ...a.installed.map(id => [`local:${id}`, `On this PC · ${aiModel(id)?.name || id}`]), ['ollama', 'Ollama · if it’s running'], ['lmstudio', 'LM Studio · if it’s running'],
    ...(a.cloud || []).filter(c => c?.has_key).flatMap(c => (c.models || [{ rec: true, name: c.name }]).map(m => [m.rec ? `cloud:${c.id}` : `cloud:${c.id}:${m.id}`, `${m.name} · ${c.name}`]))];   // Build N (R56): each company you have a key for; QC 91: each of its models
  const autoName = r => r.kind === 'cloud' ? r.label : r.name || r.model || r.label;
  const pick = k => AI_PICK.includes(k) || !auto;   // Build N
  return `<div class="eyebrow mt-4">Which model does each job</div>
    <div class="set-row"><div><div class="set-label" id="ar-l">Smart auto-router</div><div class="set-desc">Quick, frequent jobs and offline work stay on this PC; on a PC that’s slow at AI, Ask, summaries and Tidy up may use a free key you’ve added (it says which before anything is sent)</div></div><button class="toggle" role="switch" aria-checked="${auto}" aria-labelledby="ar-l" data-act="ai-auto"></button></div>
    ${obSeg('long', 'Long questions', 'Summaries and questions about your notes', [['local', 'Stay on this PC'], ['cloud', 'Cloud, if I add a key']])}
    ${obSeg('keep', 'When you change model', `Models take 1–6 GB each; ${a.pc.drive} has ${a.pc.free_gb} GB free`, [['keep', 'Keep the old one'], ['delete', 'Delete the old one']])}
    ${AI_JOBS.map(([k, l]) => k === 'fallback' ? aiSoonRow(k, l) : `<div class="route-row"><span class="set-label" id="rt-${k}">${l}</span>${!pick(k) ? `<span class="set-desc">${esc(pickText(k))}${a.routes[k]?.kind !== 'none' ? ' · chosen automatically' : ''}</span>`
      : `<select class="field" data-act="ai-route" data-k="${k}" aria-labelledby="rt-${k}">${opts.map(([v, o]) => `<option value="${v}" ${(a.route[k] || 'auto') === v ? 'selected' : ''}>${esc(AI_PICK.includes(k) && v === 'auto' ? ((a.route[k] || 'auto') === 'auto' && a.routes[k]?.kind !== 'none' ? `Automatic · ${autoName(a.routes[k])}` : 'Automatic (the model in use)') : o)}</option>`).join('')}</select>`}</div>`).join('')}`;
}

// Fix C (QC 14, decided 2026-10-17): nothing reads the offline fallback yet, so its row is greyed out and says Coming soon
const aiSoonRow = (k, l) => `<div class="route-row is-soon" aria-disabled="true" title="${esc(l)} · Coming soon"><span class="set-label" id="rt-${k}">${esc(l)}<span class="chip chip--neutral soon-tag">Coming soon</span></span><span class="set-desc">Not built yet</span></div>`;

/* ---- Other ways to run AI (optional): Ollama and LM Studio. Build N (R56): the cloud has its own cards (cloud-ai.js); each of
   these links to its official download when it isn't running ---- */
function aiOthers() {
  const a = aiSt(), prov = k => a.providers[k] || { name: k === 'ollama' ? 'Ollama' : 'LM Studio', tone: 'neutral', chip: 'Not checked', desc: k === 'ollama' ? 'localhost:11434' : 'localhost:1234' };
  const get = k => { const g = (a.local_get || {})[k], p = a.providers[k]; return g && !p?.running && typeof cloudLink === 'function' ? cloudLink(g.get, g.label) : ''; };
  const local = ['ollama', 'lmstudio'].map(k => { const p = prov(k); return `<div class="provider">${ic('cpu')}<div class="provider-main"><div class="set-label">${esc(p.name)}</div><div class="set-desc">${esc(p.desc)}</div>${get(k) ? `<div class="cl-get">${get(k)}</div>` : ''}</div><span class="chip chip--${p.tone}">${esc(p.chip)}</span><button class="btn btn--secondary btn--sm" data-act="ai-test" data-v="${k}">Test</button></div>`; }).join('');
  return `<details class="ai-others"${AI.othersOpen ? ' open' : ''}><summary class="eyebrow">Other ways to run AI · optional</summary><div class="set-desc">Already use Ollama or LM Studio? Connect them here.</div>${local}</details>`;
}

/* ---- The page: R22 "pick", one recommended model first, the rest folded away ---- */
function aiEngineChip() {
  const e = aiSt().engine;
  return e.state === 'starting' ? '<span class="chip chip--neutral">Starting…</span>' : e.state === 'running' ? '<span class="chip chip--success">Running</span>'
    : e.state === 'error' ? '<span class="chip chip--danger">Stopped</span>' : '<span class="chip chip--neutral">Stopped</span>';
}
function aiPane() {
  if (!AI.st && api() && !AI_CHECK) aiRefresh();
  if (!AI.probed && api() && !AI_CHECK) { AI.probed = true; ['ollama', 'lmstudio'].forEach(k => aiTest(k, true)); }
  const a = aiSt(), rec = aiRec(), dlm = aiModelDl(), m = a.use && aiModel(a.use), e = a.engine;
  const engMsg = e.state === 'error' && e.message ? `<div class="set-desc ai-nofit" role="alert">${esc(plainMsg(e.message))}</div>` : '';
  const engineMissing = m && !e.build;
  const hero = m ? `<div class="ai-hero"><div class="ai-hero-top">${ic('cpu')}<div class="provider-main"><div class="set-label">${esc(m.name)} is doing your AI jobs on this PC</div><div class="set-desc">${esc(m.good)}</div><div class="set-desc ai-meta">${aiSpeed(m)} · ${esc(aiPc())}</div>${engMsg}</div>
      ${engineMissing ? '<span class="chip chip--neutral">No engine yet</span>' : aiEngineChip()}</div>
      ${engineMissing ? (a.downloads.engine ? aiEngineLine() : AI.ask?.engine ? aiConfirm() : `<div class="ai-hero-btns"><button class="btn btn--primary" data-act="ai-engine-dl">${ic('download')}Download the AI engine (${e.offer.mb} MB)</button></div>`)
      : `<div class="ai-hero-btns"><button class="btn btn--secondary" data-act="ai-more" aria-expanded="${AI.more}">${AI.more ? 'Hide other models' : 'Change model'}</button><button class="btn btn--ghost" data-act="ai-engine">${aiEngineOn() ? 'Stop the engine' : 'Start the engine'}</button></div>`}</div>`
    : dlm ? `<div class="ai-hero"><div class="ai-hero-top">${ic('download')}<div class="provider-main"><div class="set-label">Getting ${esc(aiModel(dlm.key)?.name || dlm.label)} ready</div><div class="set-desc">You can keep working: it's ready in a few minutes, and nothing else needs installing.</div></div></div>${aiHeroDl(aiModel(dlm.key))}</div>`
    : `<div class="ai-hero"><div class="ai-hero-top">${ic('cpu')}<div class="provider-main"><div class="set-label">Run AI on this PC</div><div class="set-desc">NeuroVault downloads one model and runs it itself. Nothing else to install, and your notes never leave this PC.</div><div class="set-desc ai-meta">${esc(aiPc())}</div></div></div>
      ${rec && !rec.fit ? `<div class="ai-hero-pick"><span class="set-label">${esc(rec.name)}</span><span class="set-desc">${rec.gb} GB · ${esc(rec.good)} · ${aiSpeed(rec)}</span></div>
      ${AI.ask?.hero ? aiConfirm() : `<div class="ai-hero-btns"><button class="btn btn--primary" data-act="ai-dl" data-v="${rec.id}" data-hero="1">${ic('download')}Download ${esc(rec.name)} (${rec.gb} GB)</button><button class="btn btn--ghost" data-act="ai-more" aria-expanded="${AI.more}">${AI.more ? 'Hide other models' : 'Choose a different model'}</button></div>`}`
      : `<div class="ai-hero-pick"><span class="set-desc ai-nofit">No model fits this PC: ${esc(a.models[a.models.length - 1]?.fit || '')}</span></div>`}${aiEngineLine()}</div>`;
  return `${hero}${AI.more ? `<div class="eyebrow mt-4">All models</div>${a.models.map(aiRow).join('')}${aiLibFoot()}` : ''}${aiRoute()}${aiOthers()}`;
}

/* ---- Talking to api.py: one status call, polled while something downloads or the engine loads ---- */
const aiShape = st => st ? JSON.stringify([st.installed, st.use, st.rec, st.keep, st.long, st.auto_route, st.route, st.engine.state, st.engine.message, st.engine.build, st.models.length,
  Object.values(st.downloads).map(d => [d.key, d.state, d.message]), Object.values(st.providers).map(p => p.chip + p.desc)]) : '';
const aiBusy = st => Object.values(st.downloads).some(aiActive) || st.engine.state === 'starting';
const aiPageOpen = () => S.modal === 'settings' && S.setSec === 'ai';
async function aiRefresh() {   // a refresh asked for during a poll runs again after it, so a click never shows the state before it
  if (!api() || AI_CHECK) return AI.st;
  if (AI.loading) { AI.again = true; return AI.loading; }
  AI.loading = (async () => {
    do {
      AI.again = false; const r = await nv('ai_status');
      if (failed(r)) { aiSchedule(5000); return AI.st; }
      const before = aiShape(AI.st), label = aiStatusLink();
      AI.st = r; AI.demo = false; aiSyncOb();
      if (aiShape(r) !== before || aiStatusLink() !== label) renderAll(); else aiPaint();
    } while (AI.again);
    aiSchedule(); return AI.st;
  })();
  try { return await AI.loading; } finally { AI.loading = null; }
}
async function aiSave(patch) { await nv('save_settings', patch); return aiRefresh(); }   // saved first, then the status that follows from it
function aiSchedule(ms) { clearTimeout(AI.timer); if (!api() || AI_CHECK) return; const busy = AI.st && aiBusy(AI.st); if (ms || busy || aiPageOpen()) AI.timer = setTimeout(aiRefresh, ms || (busy ? 500 : 4000)); }
function aiPaint() {   // download progress in place, so a poll doesn't redraw the dialog
  app.querySelectorAll('[data-ai-dl]').forEach(el => { const d = aiSt().downloads[el.dataset.aiDl]; if (!d) return; const m = aiModel(d.key), pct = Math.min(100, d.total ? d.done / d.total * 100 : 0);
    const bar = el.querySelector('.progress'); bar.setAttribute('aria-valuenow', Math.round(pct)); bar.firstElementChild.style.width = pct.toFixed(1) + '%'; el.querySelector('[data-ai-dl-text]').textContent = aiDlText(d, m?.gb || 0); });
}
async function aiCall(name, ...args) {
  if (!api() || AI.demo && !api()) { toast('AI models need the app'); return null; }
  const r = await nv(name, ...args);
  if (failed(r)) { toast(r.message || 'That didn\'t work.'); await aiRefresh(); return null; }
  await aiRefresh(); return r;
}
async function aiTest(k, quiet) {
  const r = await nv('ai_test_provider', k); if (failed(r)) { if (!quiet) toast(r.message); return; }
  if (AI.st) AI.st.providers = { ...AI.st.providers, [k]: r };
  if (!quiet) toast(`${r.name}: ${r.running ? (r.models.length ? `answered · ${r.models.length} model${r.models.length === 1 ? '' : 's'}` : 'running, with no models') : 'not reachable'}`);
  renderAll();
}
function aiStart() {   // once the bridge is there: the engine starts if a model is set, and the status bar learns the model
  if (AI.started || !api() || AI_CHECK) return; AI.started = true;
  nv('ai_boot').then(() => aiRefresh());
}

/* ---- Magic task breakdown: the model in use splits a task into small timed steps ---- */
async function aiSplit(id) {
  const t = taskById(id); if (!t || S.splitting) return;
  if (!api()) { toast('Break down needs the app'); return; }
  const st = AI.st || await aiRefresh();
  if (!st || st.routes.split.kind === 'none') { toast('Break down needs a model on this PC: pick one in Settings → AI models'); openSettings('ai'); return; }
  const raw = await taskRaw(t); if (raw == null) return;
  S.splitting = t.id; aiNotesDirty(t); renderAll();
  const r = await nv('ai_breakdown', raw);
  const done = (msg, steps) => { S.splitting = null; if (steps) t.steps = steps.map(s => ({ id: s.id, t: s.text, m: s.minutes, done: !!s.done })); aiNotesDirty(t); if (msg) status(msg); renderAll(); };
  if (failed(r)) { done(); toast(r.message); return; }
  const t0 = Date.now();
  while (Date.now() - t0 < 300000) {
    await new Promise(ok => setTimeout(ok, 500));
    const j = await nv('ai_job', r.job); if (failed(j)) { done(); toast(j.message); return; }
    if (j.state === 'done') { done(`Split into ${j.result.steps.length} small steps by ${j.result.by}`, j.result.steps); return; }
    if (j.state === 'error') { done(); toast(j.message); return; }
  }
  done(); toast('The breakdown took too long.');
}
function aiNotesDirty(t) { D.notes.forEach(n => { if (n.id === t.noteId) n.html = null; }); }

/* ---- Clicks and changes on the AI page (and the status bar, and the wands) ---- */
document.getElementById('app').addEventListener('click', e => {
  const el = e.target.closest?.('[data-act]'); if (!el || el.hasAttribute('data-soon') || el.disabled) return;
  const act = el.dataset.act, v = el.dataset.v;
  if (act === 'model') { openSettings('ai'); aiRefresh(); return; }
  if (act === 'ai-split') { e.preventDefault(); aiSplit(v); return; }
  if (act === 'ob-set' && ['keep', 'long'].includes(el.dataset.k)) { S.ob[el.dataset.k] = v; if (AI.st) AI.st[el.dataset.k] = v; renderAll(); if (api() && !AI_CHECK) aiSave({ ['ai_' + el.dataset.k]: v }); else saveSettings({ ['ai_' + el.dataset.k]: v }); return; }
  if (!act.startsWith('ai-')) return;
  const a = aiSt();
  if (act === 'ai-more') { AI.more = !AI.more; AI.ask = null; renderAll(); return; }
  if (act === 'ai-dl') { AI.ask = { id: v, hero: !!el.dataset.hero }; S.focus = { sel: '#ai-ask-go' }; renderAll(); return; }   // ask first: the files, where from, how big
  if (act === 'ai-engine-dl') { AI.ask = { engine: true }; S.focus = { sel: '#ai-ask-go' }; renderAll(); return; }
  if (act === 'ai-dl-no') { AI.ask = null; renderAll(); return; }
  if (AI.demo && !api()) { toast('AI models need the app'); return; }
  if (act === 'ai-dl-go') { const q = AI.ask; AI.ask = null; renderAll(); if (q?.id) aiCall('ai_download', q.id, true); else aiCall('ai_download_engine', ''); return; }
  if (act === 'ai-pause') { aiCall('ai_pause', v); return; }
  if (act === 'ai-resume') { aiCall('ai_resume', v); return; }
  if (act === 'ai-cancel') { aiCall('ai_cancel', v).then(r => r && toast('Download cancelled: the part file is deleted')); return; }
  if (act === 'ai-use') { aiCall('ai_use', v).then(r => r && toast(`${aiModel(v)?.name} now does the jobs set to "On this PC"${r.removed ? `; ${r.removed.name} removed (${r.removed.gb} GB freed)` : ''}`)); return; }
  if (act === 'ai-remove') { const m = aiModel(v); aiCall('ai_remove', v).then(r => r && toast(m?.custom ? `${m.name} removed: the file stays where it is` : `${m?.name} deleted: ${m?.gb} GB freed`)); return; }
  if (act === 'ai-engine') { aiCall('ai_engine', !aiEngineOn()); return; }
  if (act === 'ai-check') { aiCall('ai_check_catalog').then(r => r && toast(r.message)); return; }
  // Fix C: straight to the bridge, as the other file pickers do: nv()'s 8-second limit ran out while the file dialog was still open
  if (act === 'ai-gguf') { if (!api()) { toast('AI models need the app'); return; } Promise.resolve(api().ai_add_gguf()).catch(e => ({ status: 'error', message: "Couldn't add the model file: " + (e?.message || e) })).then(r => { if (r?.status === 'cancelled') return; if (failed(r)) toast(r?.message || "Couldn't add the model file."); else { toast(`${r.model.name} added: it's used where it is`); aiRefresh(); } }); return; }
  if (act === 'ai-test') { aiTest(v); return; }
  if (act === 'ai-auto') { a.auto_route = !a.auto_route; renderAll(); aiSave({ ai_auto_route: a.auto_route }); return; }
});
document.getElementById('app').addEventListener('change', e => {
  const el = e.target.closest?.('[data-act="ai-route"]'); if (!el) return;
  aiCall('ai_set_route', el.dataset.k, el.value);
});
document.getElementById('app').addEventListener('toggle', e => { if (e.target.matches?.('.ai-others')) AI.othersOpen = e.target.open; }, true);
// Fix C: once every script has loaded (a setTimeout could fire mid-load, before actions.js and editor.js, and render too soon)
if (api()) { if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => setTimeout(aiStart), { once: true }); else setTimeout(aiStart); }
window.addEventListener('pywebviewready', aiStart);
