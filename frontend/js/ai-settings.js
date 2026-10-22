/* ==== Build N · R60: Settings → AI models, reworked, in both layouts (mockup R60 4/5; design profile 9c5def6; feedback: "lets rework
   the Ai settings modal, make it more clear and add text clearly describing the settings functions, also the download local models
   needs to look cleanner", and of the two layouts: "I want you to build both as I need to get a feel for it") ====
   - One order: what's running now → the models on this PC → AI in the cloud → which model does each job → free limits and switching →
     answers and the Ask chat → No AI. Each section says what it's for in one line; every setting has one plain line saying what it
     does. The same parts as before (render-ai.js, cloud-ai.js, ai-notes.js, ai-chat.js), moved into place: nothing is a card in a card.
   - Four tabs (the user, after trying both layouts: "ai models - four tabs"; design profile "AI models uses four tabs; Settings has a
     dark header", 2026-10-19): Overview, On this PC, Cloud, Jobs and answers. The one-page layout and the switch are gone.
   - Models on this PC are rows (the R60 decision): name and maker, what it's good at, its size and whether it fits this PC in
     words, and one button (Download, Pause / Resume, Use it, In use), with Remove as an icon. A download is asked first, under its row. */
'use strict';
const AIS = { tab: 'overview' };
const AIS_SECS = [
  ['now', 'Running now', 'What answers when you press Summarise or Ask, and what this PC can run.', 'overview'],
  ['local', 'Models on this PC', 'Download one and it runs here: nothing you write leaves this PC, and it works offline.', 'pc'],
  ['cloud', 'AI in the cloud, with your own key', 'Quicker on an older PC. A company gets your question and the notes it’s about only after you add its key and say yes once. NeuroVault never comes with a key.', 'cloud'],
  ['jobs', 'Which model does each job', 'Automatic picks for you; turn it off to choose a model for each job yourself.', 'jobs'],
  ['limits', 'Free limits and switching', 'What happens when a cloud model’s free limit for the day runs out.', 'cloud'],
  ['attach', 'Attachments', 'Whether a model that can read images and documents gets this note’s attachments too.', 'jobs'],   // QC 93
  ['chat', 'Answers and the Ask chat', 'What answers may use, how Tidy up works, where summaries show, and how the chat behaves.', 'jobs'],
  ['noai', 'No AI', 'Turn every AI control off, or keep them greyed until a model is ready.', 'overview']];
const AIS_TABS = [['overview', 'Overview'], ['pc', 'On this PC'], ['cloud', 'Cloud'], ['jobs', 'Jobs and answers']];
const aisRow = (label, desc, ctl, id) => `<div class="set-row"${id ? ` data-ais-row="${id}"` : ''}><div><div class="set-label">${label}</div><div class="set-desc">${desc}</div></div>${ctl ? `<div class="ais-ctl">${ctl}</div>` : ''}</div>`;
const aisGo = v => `data-act="ais-goto" data-v="${v}"`;

/* ---- the sections ---- */
function aisNow() {
  const a = aiSt(), m = a.use && aiModel(a.use), e = a.engine, cur = ainCur('qa'), keys = cloudKeyed().map(p => p.name);
  const ask = cur ? `${esc(cur.name)} · ${esc(cloudIsCloud(cur.where) ? cloudSvcOf(cur.where) + ', in the cloud' : cur.where || 'on this PC')}${ainChoice('qa') === 'auto' ? ' (picked automatically)' : ''}` : 'No model yet: download one below, or add a cloud key';
  const engineMissing = m && !e.build;
  const pcCtl = !m ? `<button class="btn btn--secondary" ${aisGo('local')}>Pick a model</button>`
    : engineMissing ? (a.downloads.engine ? '' : AI.ask?.engine ? '' : `<button class="btn btn--secondary" data-act="ai-engine-dl">${ic('download')}Download the AI engine (${e.offer.mb} MB)</button>`)
    : `<button class="btn btn--secondary" data-act="ai-engine">${aiEngineOn() ? 'Stop the engine' : 'Start the engine'}</button>`;
  const pcDesc = !m ? 'No model downloaded yet.' : engineMissing ? `${esc(m.name)} is downloaded; the AI engine that runs it isn’t yet.` : `${esc(m.name)}, ${aiEngineOn() ? `running on the ${e.where === 'gpu' ? 'graphics card' : 'processor'}` : 'stopped: it starts again when a job needs it'}.`;
  const err = e.state === 'error' && e.message ? `<div class="set-desc ai-nofit" role="alert">${esc(plainMsg(e.message))}</div>` : '';
  return aisRow('Summarise and Ask use', ask, `<button class="btn btn--secondary" ${aisGo('jobs')}>Change</button>`, 'ask')
    + aisRow('On this PC', pcDesc + err, pcCtl, 'pc') + (engineMissing && (a.downloads.engine || AI.ask?.engine) ? `<div class="ais-sub">${a.downloads.engine ? aiEngineLine() : aiConfirm()}</div>` : '')
    + aisRow('Cloud keys', keys.length ? esc(keys.join(', ')) : 'None yet. A free key makes AI quick on an older PC.', `<button class="btn btn--secondary" ${aisGo('cloud')}>${keys.length ? 'Manage' : 'Add a key'}</button>`, 'keys')
    + `<p class="set-desc ais-pc">${ic('cpu')}<span>This PC: ${esc(aiPc())}</span></p>`;
}
const aisLow = w => { w = String(w); return w.charAt(0).toLowerCase() + w.slice(1); };   // fix round A: "quick on this PC", the PC keeps its capitals
function aisLocalRow(m) {
  const a = aiSt(), dl = a.downloads[m.id], inst = m.installed, use = a.use === m.id, rec = m.id === a.rec, why = aiFits(m), p = a.pc;
  const fit = why ? `<span class="ai-nofit" id="ais-why-${esc(m.id)}">${esc(why)}</span>` : `needs ${m.ram} GB memory (this PC has ${p.mem_gb} GB) · ${esc(aisLow(aiSpeed(m)))}`;
  const act = dl ? aiDlBtns(dl)
    : use ? '<span class="chip chip--success ais-inuse">In use</span>'
    : inst ? `<button class="btn btn--secondary" data-act="ai-use" data-v="${m.id}">Use it</button>`
    : `<button class="btn ${rec ? 'btn--primary' : 'btn--secondary'}" data-act="ai-dl" data-v="${m.id}"${why ? ` disabled aria-describedby="ais-why-${esc(m.id)}"` : ` aria-label="Download ${esc(m.name)}, ${m.gb} GB"`}>${ic('download')}Download</button>`;
  const rm = inst && !dl ? `<button class="icon-btn ais-rm" data-act="ai-remove" data-v="${m.id}" aria-label="${esc(m.custom ? `Remove ${m.name}: the file stays where it is` : `Delete ${m.name} from this PC (${m.gb} GB)`)}" title="${m.custom ? 'Remove (the file stays where it is)' : `Delete the model file (${m.gb} GB)`}">${ic('trash')}</button>` : '';
  return `<div class="ais-lm${use ? ' is-use' : ''}${why && !inst ? ' is-nofit' : ''}" role="listitem" data-ais-lm="${esc(m.id)}"><div class="ais-lm-main"><div class="ais-lm-name"><span class="set-label">${esc(m.name)}</span>${rec ? '<span class="chip chip--accent">Best for this PC</span>' : ''}<span class="set-desc">${esc(m.by)}</span></div>
    <div class="set-desc">${esc(m.good)}</div><div class="set-desc ais-lm-meta"><b>${m.gb} GB</b> · ${fit}</div>${dl ? `<div class="ai-dl" data-ai-dl="${m.id}">${aiBar(dl, m.name, m.gb)}</div>${aiDlErr(dl)}` : ''}</div><div class="ais-lm-act">${act}${rm}</div></div>
    ${AI.ask?.id === m.id ? `<div class="ais-sub">${aiConfirm()}</div>` : ''}`;
}
function aisLocal() {
  const a = aiSt(), list = [...a.models].sort((x, y) => (y.id === a.rec) - (x.id === a.rec));
  return `${aisGpuRow()}<div class="ais-lms" role="list" aria-label="Models you can run on this PC">${list.map(aisLocalRow).join('')}</div>${a.downloads.engine && a.use ? '' : aiEngineLine()}${aiLibFoot()}${aiOthers()}`;
}
function aisCloud() {
  const rows = cloudRows(); if (!rows.length) return '<p class="set-desc">Loading the companies…</p>';
  const warn = aiSt().cloud_keys === false ? '<p class="set-desc ai-nofit" role="alert">Cloud keys need the keyring package, which isn’t installed, so they can’t be kept in Windows Credential Manager yet.</p>' : '';
  return `<div class="cl-cloud" id="cl-cloud">${warn}<div class="cl-group">Free to start</div>${rows.filter(p => p.group !== 'paid').map(cloudCard).join('')}<div class="cl-group">Paid</div>${rows.filter(p => p.group === 'paid').map(cloudCard).join('')}</div>`;
}
const aisJobs = () => ainRoute0().replace('<div class="eyebrow mt-4">Which model does each job</div>', '');
const aisLimits = () => cloudAutoRow() + aisRow('Today’s limits', 'Each cloud company above shows how much of its free limit is left, and the model menu shows a small ring beside each model. OpenRouter’s free models share one limit.', `<button class="btn btn--secondary" ${aisGo('cloud')}>See them</button>`, 'meters');
const aisChat = () => ainModeRow() + ainTidyRows() + aicCard() + ainPlaceCard();
const aisNoAi = () => aicAiCard();
const AIS_BODY = { now: aisNow, local: aisLocal, cloud: aisCloud, jobs: aisJobs, limits: aisLimits, attach: () => cloudAttRow(), chat: aisChat, noai: aisNoAi };
const aisSec = id => { const [, t, i] = AIS_SECS.find(x => x[0] === id); return `<section class="ais-sec" data-ais-sec="${id}" id="ais-sec-${id}" aria-labelledby="ais-st-${id}"><div class="ais-sh"><h4 class="ais-st" id="ais-st-${id}" tabindex="-1">${t}</h4><p class="ais-si">${i}</p></div>${AIS_BODY[id]()}</section>`; };
aiPane = function () {   // eslint-disable-line no-global-assign
  if (!AI.st && api() && !AI_CHECK) aiRefresh();
  if (!AI.probed && api() && !AI_CHECK) { AI.probed = true; ['ollama', 'lmstudio'].forEach(k => aiTest(k, true)); }
  if (!AIC.aiOn) return `<div class="ais" data-ais-layout="off">${aisSec('noai')}</div>`;
  const tab = AIS_TABS.some(t => t[0] === AIS.tab) ? AIS.tab : 'overview';
  const bar = `<div class="ais-tabs" role="tablist" aria-label="AI models">${AIS_TABS.map(([v, l]) => `<button class="ais-tab" role="tab" id="ais-tab-${v}" aria-selected="${tab === v}" aria-controls="ais-panel" tabindex="${tab === v ? 0 : -1}" data-act="ais-tab" data-v="${v}">${l}</button>`).join('')}</div>`;
  return `<div class="ais" data-ais-layout="tabs">${bar}<div class="ais-panel" role="tabpanel" id="ais-panel" aria-labelledby="ais-tab-${tab}">${AIS_SECS.filter(s => s[3] === tab).map(s => aisSec(s[0])).join('')}</div></div>`;
};
function aisGoto(id) {   // "Change", "Manage", "See them": to that section, its tab first
  AIS.tab = AIS_SECS.find(s => s[0] === id)?.[3] || AIS.tab;
  S.focus = { sel: `#ais-st-${id}` }; renderAll(); app.querySelector(`#ais-sec-${id}`)?.scrollIntoView({ block: 'start' });
}
app.addEventListener('click', e => {
  const t = e.target.closest?.('[data-act]'), act = t?.dataset.act || ''; if (!/^ais-(goto|tab)$/.test(act)) return;
  e.preventDefault(); e.stopPropagation(); const v = t.dataset.v;
  if (act === 'ais-goto') { aisGoto(v); return; }
  if (act === 'ais-tab') { AIS.tab = v; S.focus = { sel: `#ais-tab-${v}` }; renderAll(); }
}, true);
app.addEventListener('keydown', e => {   // the tabs: ← → Home End, as a tab list does
  const t = e.target.closest?.('.ais-tab'); if (!t || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return; e.preventDefault();
  const i = AIS_TABS.findIndex(x => x[0] === t.dataset.v), n = AIS_TABS.length, j = e.key === 'Home' ? 0 : e.key === 'End' ? n - 1 : (i + (e.key === 'ArrowRight' ? 1 : -1) + n) % n;
  AIS.tab = AIS_TABS[j][0]; S.focus = { sel: `#ais-tab-${AIS.tab}` }; renderAll();
}, true);
// the download question opens under its row: bring it into view (render-ai.js's handler has just drawn it)
app.addEventListener('click', e => { const t = e.target.closest?.('[data-act="ai-dl"], [data-act="ai-engine-dl"]'); if (!t || !app.querySelector('.ais')) return;
  app.querySelector('.ais .ai-confirm')?.scrollIntoView({ block: 'nearest' }); });
/* ==== QC 87 · Use graphics card for AI: Off / Some / Full (Settings → AI models → On this PC) ====
   -ngl 99 on every start pushed a shaky graphics card hard. The app sends gpu {choice, default, capable, set, note, options}; the
   choice is saved as ai_gpu and the engine restarts on next use (api.ai_gpu). One engine runs per PC: a second NeuroVault uses the
   first one's engine, so while one is shared the setting applies the next time an engine starts here. */
const AIS_GPU = [['off', 'Off'], ['some', 'Some'], ['full', 'Full']];
const AIS_GPU_WORDS = { off: 'The AI stays on the processor. Slowest, and the graphics card is left alone.',
  some: 'Part of the AI runs on the graphics card. A good balance, and gentle on the card.',
  full: 'All of the AI runs on the graphics card. Quickest, but it works the card hardest.' };
function aisGpu() {   // the app's answer, or the sample's (a browser, ?check=1)
  const a = aiSt(); if (a.gpu) return a.gpu; const can = !!a.pc?.gpu;
  return { choice: can ? 'some' : 'off', default: can ? 'some' : 'off', capable: can, set: '', note: can ? '' : 'No graphics card was found, so the AI runs on the processor.' };
}
function aisGpuRow() {   // fix round A (should-fix 12): the row's own description and the one line for the chosen option, not all three
  const g = aisGpu(), shared = !!aiSt().engine?.shared;
  const sug = g.capable && g.choice === g.default ? ' (suggested for this PC)' : '';
  const line = !g.capable ? '' : `<div class="set-desc ais-gpu-line" data-ais-gpu-line="${g.choice}"><b>${AIS_GPU.find(x => x[0] === g.choice)[1]}</b>${sug}: ${AIS_GPU_WORDS[g.choice]}</div>`;
  const note = g.note ? `<div class="set-desc ai-nofit">${esc(g.note)}</div>` : '';
  const share = shared ? '<div class="set-desc">Another NeuroVault on this PC is running the AI engine, so this PC runs just the one. This setting applies the next time the engine starts here.</div>' : '';
  const ctl = `<div class="seg" role="group" aria-labelledby="ais-gpu-l">${AIS_GPU.map(([v, l]) => `<button class="seg-opt" data-act="ais-gpu" data-v="${v}" aria-pressed="${g.choice === v}" aria-description="${esc(AIS_GPU_WORDS[v])}"${g.capable ? '' : ' disabled'}>${l}</button>`).join('')}</div>`;
  return `<div class="set-row" data-ais-row="gpu"><div><div class="set-label" id="ais-gpu-l">Use graphics card for AI</div><div class="set-desc">How much of the AI runs on this PC’s graphics card instead of the processor. A change takes effect the next time the AI is used.</div>${line}${note}${share}</div><div class="ais-ctl">${ctl}</div></div>`;
}
app.addEventListener('click', async e => {
  const t = e.target.closest?.('[data-act="ais-gpu"]'); if (!t) return; e.preventDefault(); e.stopPropagation();
  const v = t.dataset.v, a = aiSt(); if (!AIS_GPU.some(x => x[0] === v) || t.disabled) return;
  a.gpu = { ...aisGpu(), choice: v, set: v };   // the page shows the choice at once
  S.focus = { sel: `[data-act="ais-gpu"][data-v="${v}"]` }; renderAll();
  if (api() && !a.demo) await aiCall('ai_gpu', v);
}, true);
/* ==== end QC 87 ==== */
/* ==== end Build N · R60 AI settings ==== */
