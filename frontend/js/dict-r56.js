/* Build M · R56, the dictionary (feedback: "of installed should also prompt to install the offline dictionary, and we should also
   route to an online one to cover everything we can"; design profile: the dictionary is offered at setup and backed by an online
   one; the R56 decision for the setup: in the Reading step).
   1. Setup → Reading: one card, nothing picked: Download it / Not now, with its size, source and licence. Download it joins the
      setup's downloads (the Ready step lists it; Start begins it: api.setup_finish).
   2. Settings → Editor → Dictionary: the Offline dictionary card (what, from, size, licence; Download or Delete) and the Online
      lookup card ("Look words up online without asking", off; what's sent; the three services: who runs them, what they keep).
   3. Lookups: the offline dictionary and your words first; online only when they have nothing and it's on, or you ask (the first
      time, an inline notice, nothing to tick). The answer is tagged Online and credited (CC BY-SA, as the service gives it).
      Offline: a plain message. Config dict_online (ask | always | off) and dict_online_seen. */
'use strict';
const DJO = { mode: 'ask', seen: false, res: {}, busy: null, notice: null, demo: 'found', saved: [], removeAsk: false, stAsked: false };
const DJO_SERVICES = [
  { id: 'freedict', name: 'Free Dictionary API', host: 'dictionaryapi.dev', role: 'Meanings, examples, similar words', who: 'Run by one volunteer developer; the meanings come from Wiktionary.',
    keeps: 'Publishes no privacy policy.', links: [['Site', 'https://dictionaryapi.dev/'], ['Source code', 'https://github.com/meetDeveloper/freeDictionaryAPI']] },
  { id: 'wiktionary', name: 'Wiktionary', host: 'en.wiktionary.org', role: 'Meanings when the Free Dictionary API has none', who: 'Run by the Wikimedia Foundation, a non-profit.',
    keeps: 'Keeps personal data such as your IP address for 90 days at most.', links: [['Site', 'https://en.wiktionary.org/'], ['Privacy policy', 'https://foundation.wikimedia.org/wiki/Policy:Privacy_policy'], ['Terms', 'https://foundation.wikimedia.org/wiki/Policy:Terms_of_Use']] },
  { id: 'datamuse', name: 'Datamuse', host: 'api.datamuse.com', role: '“Did you mean”, when neither has the word', who: 'Run by Datamuse, the makers of OneLook.',
    keeps: 'Doesn’t say what it keeps.', links: [['Site', 'https://www.datamuse.com/api/']] }];
const djoWhat = 'Only the word you look up, and your IP address, which every website sees. Never the sentence or the note.';
const djoKey = w => String(w || '').trim().toLowerCase();
const djoLink = (label, url) => `<button class="link-btn djo-link" data-act="nv-link" data-v="${esc(url)}" title="${esc(url)}">${esc(label)}</button>`;
const djoEntryInfo = () => DJ.st?.dictionary || (typeof DJ_SAMPLE !== 'undefined' ? DJ_SAMPLE : null);
const djoMB = b => typeof djMB === 'function' ? djMB(b) : `${(b / 1e6).toFixed(1)} MB`;

/* ---- the lookup: the app's, or (no app, the check) a sample written for it ---- */
DJ_LOCAL.dict_online = word => DJO.demo === 'offline' ? { status: 'offline', message: 'You’re offline, so only the offline dictionary and your words were searched.' }
  : DJO.demo === 'none' ? { status: 'success', word, found: false, entry: null, suggestions: ['amble', 'ample'], sent_to: ['api.dictionaryapi.dev', 'en.wiktionary.org', 'api.datamuse.com'] }
  : { status: 'success', word, found: true, suggestions: [], sent_to: ['api.dictionaryapi.dev'], entry: { word, phonetic: '', syn: ['sample'], ant: [],
      senses: [{ pos: 'noun', def: 'A meaning written for this preview, standing in for the one the online dictionary gives.', examples: [] }],
      source: { service: 'Free Dictionary API', host: 'api.dictionaryapi.dev', from: 'Wiktionary', pages: [`https://en.wiktionary.org/wiki/${encodeURIComponent(word)}`], licence: { name: 'CC BY-SA 3.0', url: 'https://creativecommons.org/licenses/by-sa/3.0' } } } };
DJ_LOCAL.dict_remove = () => { DJL.state = 'none'; return { ...djLocalStatus(), message: 'The offline dictionary was deleted. Your own words stay.' }; };
async function djoLookup(word, asked) {
  const k = djoKey(word); if (!k || DJO.busy === k) return;
  DJO.busy = k; DJO.notice = null; renderAll();
  const r = await dj('dict_online', word, !!asked); DJO.busy = null;
  DJO.res[k] = failed(r) && r.status !== 'offline' ? { status: 'error', message: r.message || 'The online lookup didn’t work.' } : r;
  renderAll();
}
function djoAsk(word) {   // "Look it up online": the first time, a notice in place (nothing to tick); after that, straight away
  if (!DJO.seen) { DJO.notice = djoKey(word); S.focus = { sel: '[data-act="djo-yes"]' }; renderAll(); return; }
  djoLookup(word, true);
}
function djoSeen() { DJO.seen = true; if (!DJ_CHECK) saveSettings({ dict_online_seen: true }); else DJO.saved.push({ dict_online_seen: true }); }

/* ---- what shows when the offline dictionary and your words have nothing ---- */
function djoCredit(e, sent) {
  const s = e.source || {}, via = s.service && s.service !== s.from ? `From ${esc(s.from)}, via the ${esc(s.service)}` : `From ${esc(s.from || s.service || 'the web')}`;
  const page = s.pages?.[0] ? ` · ${djoLink(`${s.from || 'The source'}’s page`, s.pages[0])}` : '', lic = s.licence?.name ? ` · ${s.licence.url ? djoLink(s.licence.name, s.licence.url) : esc(s.licence.name)}` : '';
  return `<div class="djo-credit">${ic('globe')}<span>${via}${page}${lic} · the word went to ${esc((sent || [s.host]).join(', '))}</span></div>`;
}
function djoEntry(r, compact) {
  const e = r.entry, byPos = [...new Set(e.senses.map(s => s.pos))];
  const senses = compact ? `<div class="wordpop-def">${esc(e.senses[0].def)}</div>`
    : byPos.map(p => { const all = e.senses.filter(s => s.pos === p).slice(0, 5); return `<section class="dict-sec"><h3 class="dict-pos">${esc(p || 'Meaning')}</h3><ol class="dict-senses">${all.map(s => `<li><span class="dict-def">${esc(s.def)}</span>${s.examples[0] ? `<span class="dict-ex">“${esc(s.examples[0])}”</span>` : ''}</li>`).join('')}</ol></section>`; }).join('');
  const syn = !compact && e.syn.length ? `<section class="dict-sec"><h3 class="eyebrow">Similar words</h3>${djChips(e.syn.slice(0, 10))}</section>` : '';
  const ant = !compact && e.ant.length ? `<section class="dict-sec"><h3 class="eyebrow">Opposites</h3>${djChips(e.ant.slice(0, 6))}</section>` : '';
  return `<div class="djo-entry${compact ? ' djo-entry--pop' : ''}" data-djo="found">${compact ? '' : `<div class="dict-entry-head"><div><h2 class="dict-word">${esc(e.word)}</h2>${e.phonetic ? `<div class="dict-syl">${esc(e.phonetic)}</div>` : ''}</div></div>`}
    <div class="dict-chips"><span class="chip chip--accent djo-tag">${ic('globe')}Online</span></div>${senses}${syn}${ant}${djoCredit(e, r.sent_to)}</div>`;
}
function djoSection(word, compact) {   // '' when online lookup is off
  if (DJO.mode === 'off') return ''; const k = djoKey(word), r = DJO.res[k];
  if (DJO.busy === k) return `<div class="djo-sec" data-djo="busy" role="status"><span class="spinner" aria-hidden="true"></span><span>Looking “${esc(word)}” up online…</span></div>`;
  if (r?.status === 'offline') return `<div class="djo-sec djo-offline" data-djo="offline" role="status">${ic('wifioff')}<span>${esc(plainMsg(r.message))}</span></div>`;
  if (r?.status === 'error') return `<div class="djo-sec" data-djo="error" role="alert">${ic('alert')}<span>${esc(plainMsg(r.message))}</span></div>`;
  if (r?.found) return djoEntry(r, compact);
  if (r) return `<div class="djo-sec" data-djo="none"><span>Not found online either.</span>${r.suggestions?.length ? `<span class="set-desc">Did you mean (Datamuse):</span>${djChips(r.suggestions)}` : ''}</div>`;
  if (DJO.notice === k) return `<div class="djo-sec djo-notice" data-djo="notice" role="group" aria-label="Look it up online?"><div><b>Look “${esc(word)}” up online?</b> It goes to dictionaryapi.dev (then Wiktionary, and Datamuse for “did you mean”, if needed). ${djoWhat}</div>
    <div class="djo-acts"><button class="btn btn--secondary btn--sm" data-act="djo-no">Not now</button><button class="btn btn--primary btn--sm" data-act="djo-yes" data-v="${esc(word)}">${ic('globe')}Look it up</button></div></div>`;
  if (DJO.mode === 'always') { setTimeout(() => { if (!DJO.res[k] && DJO.busy !== k) djoLookup(word, false); }, 0); return `<div class="djo-sec" data-djo="busy" role="status"><span class="spinner" aria-hidden="true"></span><span>Looking “${esc(word)}” up online…</span></div>`; }
  return `<div class="djo-sec" data-djo="ask"><button class="btn btn--secondary${compact ? ' btn--sm' : ''}" data-act="djo-look" data-v="${esc(word)}">${ic('globe')}Look it up online</button><span class="set-desc">The word goes to dictionaryapi.dev.</span></div>`;
}
{ const none0 = djNone;
  djNone = function (r) {   // eslint-disable-line no-global-assign
    const q = DJ.q.trim(), on = djoSection(q, false); if (!on || DJ.scope === 'mine') return none0.apply(this, arguments);
    if (DJO.res[djoKey(q)]?.found) return `<article class="card card-pad dict-entry djo-card" aria-label="${esc(q)}, online">${on}</article>`;
    return none0.apply(this, arguments).replace(/<\/div><\/div>$/, () => `${on}</div></div>`);
  };
}
{ const wp0 = wordPopover;
  wordPopover = function () {   // eslint-disable-line no-global-assign
    const h = wp0.apply(this, arguments), w = S.word, r = w?.res, e = r && !r.guessed ? r.shown : null; if (!w || !r || e) return h;
    const on = djoSection(w.word, true); return on ? h.replace('<div class="wordpop-foot">', () => `<div class="wordpop-online">${on}</div><div class="wordpop-foot">`) : h;
  };
}

/* ---- Settings → Editor → Dictionary ---- */
function djoOfflineCard() {
  const st = DJ.st, e = djoEntryInfo(); if (!e) return '';
  const what = `<div class="set-desc">${esc(String(e.words || 'about 127,000').replace(/^./, c => c.toUpperCase()))} words with meanings, examples, similar words and opposites, on this PC: lookups work without the internet and send nothing.</div>
    <div class="set-desc">${esc(e.name)} · from ${djoLink(e.source || 'en-word.net', e.source_url || 'https://en-word.net/')} · licence ${djoLink(e.licence || 'CC BY 4.0', e.licence_url || 'https://creativecommons.org/licenses/by/4.0/')} · ${djoMB(e.bytes)} download, about ${e.disk_mb} MB on this PC</div>`;
  let state;
  if (st?.state === 'ready') state = DJO.removeAsk ? `<div class="alert alert--warning djo-confirm" role="alertdialog" aria-label="Delete the offline dictionary">${ic('alert')}<span>Delete the offline dictionary? Your own words stay, and you can download it again.</span><span class="dict-confirm-acts"><button class="btn btn--secondary btn--sm" data-act="djo-remove-no">Cancel</button><button class="btn btn--danger btn--sm" data-act="djo-remove-yes">Delete</button></span></div>`
    : `<div class="djo-state"><span class="chip chip--success">${ic('ok')}On this PC</span><span class="set-desc">${(st.words || 0).toLocaleString('en-GB')} words${st.size_bytes ? ` · ${djoMB(st.size_bytes)}` : ''}</span><button class="btn btn--secondary btn--sm" data-act="djo-remove">${ic('trash')}Delete</button></div>`;
  else if (['downloading', 'building'].includes(st?.state)) { const j = st.job || {}, pct = st.state === 'building' ? Math.round(100 * (j.fraction || 0)) : Math.round(100 * (j.done || 0) / (j.total || e.bytes));
    state = `<div class="djo-state" role="status"><span class="spinner" aria-hidden="true"></span><span class="set-desc">${st.state === 'building' ? `Getting it ready · ${pct}%` : `Downloading · ${djoMB(j.done || 0)} of ${djoMB(j.total || e.bytes)}`}</span><button class="btn btn--secondary btn--sm" data-act="dict-cancel">${ic('x')}Cancel</button></div>`; }
  else state = `<div class="djo-state">${st?.state === 'failed' ? `<span class="set-desc" role="alert">${esc(plainMsg(st.job?.message || 'The download stopped.'))}</span>` : '<span class="set-desc">Not on this PC: only your own words are searched offline.</span>'}<button class="btn btn--primary btn--sm" data-act="dict-download">${ic('download')}Download · ${djoMB(e.bytes)}</button></div>`;
  return `<div class="set-row djo-flat" id="djo-offline"><div class="djo-flat-main"><div class="set-label">Offline dictionary</div>${what}${state}</div></div>`;   // a flat row, as the pane's others (Fix A 41: no card in a Settings list)
}
function djoOnlineCard() {
  const on = DJO.mode === 'always';
  const svc = DJO_SERVICES.map(s => `<li class="djo-svc" data-svc="${s.id}"><div class="djo-svc-head"><span class="set-label">${esc(s.name)}</span><span class="code set-desc">${esc(s.host)}</span></div>
    <div class="set-desc">${esc(s.role)}. ${esc(s.who)} ${esc(s.keeps)}</div><div class="djo-links">${s.links.map(([l, u]) => djoLink(l, u)).join('<span aria-hidden="true">·</span>')}</div></li>`).join('');
  return `<div class="djo-flat" id="djo-online"><div class="set-row"><div><div class="set-label" id="djo-always">Look words up online without asking</div>
    <div class="set-desc">${on ? 'On: a word that isn’t in the offline dictionary or your words is looked up online straight away.' : 'Off: when a word isn’t in the offline dictionary or your words, “Look it up online” asks first.'}</div></div>
    <button class="toggle" role="switch" aria-checked="${on}" aria-labelledby="djo-always" data-act="djo-mode"></button></div>
    <div class="set-row djo-sent"><div><div class="set-label">What’s sent</div><div class="set-desc">${djoWhat}</div></div></div>
    <div class="set-row djo-svcs-row"><div class="djo-flat-main"><div class="set-label">The online services</div><ul class="djo-svcs">${svc}</ul></div></div></div>`;
}
function djoSettings() {
  if (!DJ.loaded && !DJO.stAsked) { DJO.stAsked = true; djRefresh(false).then(() => { if (S.modal === 'settings') renderAll(); }); }
  return `<div class="pop-sec djo-set" id="nv-dict"><div class="eyebrow">Dictionary</div>${djoOfflineCard()}${djoOnlineCard()}</div>`;
}
{ const sp0 = settingsPane; settingsPane = sec => sp0(sec) + (sec === 'editor' ? djoSettings() : ''); }   // eslint-disable-line no-global-assign
{ const pb0 = djPollIfBusy;   // the download's progress also redraws Settings while it's open there
  djPollIfBusy = function () { pb0.apply(this, arguments); if (S.modal === 'settings' && UI.view !== 'dict') { clearTimeout(DJO.rt); DJO.rt = setTimeout(() => { if (S.modal === 'settings') renderAll(); }, 600); } };   // eslint-disable-line no-global-assign
}

/* ---- Setup → Reading: one card, nothing picked ---- */
const djoSetupSt = () => obInfo().dict || { state: DJ.st?.state || 'none', dictionary: djoEntryInfo() };
function djoSetupCard() {
  const d = djoSetupSt(), e = d.dictionary; if (!e) return '';
  const have = d.state === 'ready', pick = S.ob.dict;
  return `<div class="card card-pad ob-dict" id="ob-dict" role="group" aria-labelledby="ob-dict-t"><div class="ob-dict-head">${ic('book')}<div><div class="set-label" id="ob-dict-t">Offline dictionary</div>
    <div class="set-desc">Look up any word, right-click Look up in a note, and spelling help, without the internet. ${esc(e.name)}, from ${djoLink(e.source || 'en-word.net', e.source_url || 'https://en-word.net/')}, ${djoLink(e.licence || 'CC BY 4.0', e.licence_url || 'https://creativecommons.org/licenses/by/4.0/')}: ${djoMB(e.bytes)} download, about ${e.disk_mb} MB on this PC.</div></div></div>
    ${have ? `<div class="set-desc">${ic('ok')}Already on this PC.</div>` : `<div class="seg ob-dict-seg" role="group" aria-label="Offline dictionary"><button class="seg-opt" data-act="ob-dict" data-v="yes" aria-pressed="${pick === 'yes'}">${ic('download')}Download it</button><button class="seg-opt" data-act="ob-dict" data-v="no" aria-pressed="${pick === 'no'}">Not now</button></div>
    <div class="set-desc">${pick === 'yes' ? 'It downloads with the rest when you start.' : pick === 'no' ? 'You can download it later in Settings → Editor → Dictionary.' : 'Nothing is picked: choose one.'}</div>`}</div>`;
}
{ const gb0 = obGuideBody; obGuideBody = function (step) { const h = gb0.apply(this, arguments); return step === 'comfort' ? h + djoSetupCard() : h; }; }   // eslint-disable-line no-global-assign
{ const od0 = obDownloads;
  obDownloads = function () {   // eslint-disable-line no-global-assign
    const list = od0.apply(this, arguments), d = djoSetupSt(), e = d.dictionary;
    if (S.ob.dict === 'yes' && e && d.state !== 'ready') list.push({ key: 'dict', label: `${e.name} (dictionary)`, files: [e.file], source: e.url, bytes: e.bytes });
    return list;
  };
  const os0 = obStart;
  obStart = async function () {   // eslint-disable-line no-global-assign
    const want = S.ob.dict === 'yes' && djoSetupSt().state !== 'ready';
    await os0.apply(this, arguments);
    if (want && !SETUP.open) { DJO.setupStarted = true; if (api() && !DJ_CHECK) dj('dict_download').then(st => { if (failed(st)) { toast(st.message || 'The dictionary download didn’t start: try again in Settings → Editor → Dictionary'); return; } DJ.st = st; djPollIfBusy(); }); }
  };
}

/* ---- clicks; the settings from config ---- */
app.addEventListener('click', e => {
  const b = e.target.closest?.('[data-act^="djo-"], [data-act="nv-link"], [data-act="ob-dict"]'); if (!b) return;
  const act = b.dataset.act, v = b.dataset.v; e.stopImmediatePropagation();
  if (act === 'nv-link') { if (api() && !DJ_CHECK) nv('open_external', v).then(r => { if (failed(r)) toast(r.message); }); else if (DJ_CHECK) DJO.opened = v; else window.open(v, '_blank', 'noopener'); return; }
  if (act === 'ob-dict') { S.ob.dict = v; S.focus = { sel: `[data-act="ob-dict"][data-v="${v}"]` }; renderAll(); return; }
  if (act === 'djo-look') { djoAsk(v); return; }
  if (act === 'djo-yes') { djoSeen(); djoLookup(v, true); return; }
  if (act === 'djo-no') { djoSeen(); DJO.notice = null; renderAll(); return; }
  if (act === 'djo-mode') { DJO.mode = DJO.mode === 'always' ? 'ask' : 'always'; if (!DJ_CHECK) saveSettings({ dict_online: DJO.mode }); else DJO.saved.push({ dict_online: DJO.mode });
    status(DJO.mode === 'always' ? 'Words the offline dictionary doesn’t have are looked up online' : 'Looking a word up online asks first'); S.focus = { sel: '[data-act="djo-mode"]' }; renderAll(); return; }
  if (act === 'djo-remove') { DJO.removeAsk = true; S.focus = { sel: '[data-act="djo-remove-no"]' }; renderAll(); return; }
  if (act === 'djo-remove-no') { DJO.removeAsk = false; S.focus = { sel: '[data-act="djo-remove"]' }; renderAll(); return; }
  if (act === 'djo-remove-yes') { dj('dict_remove').then(st => { DJO.removeAsk = false; if (failed(st)) { toast(st.message || 'The dictionary couldn’t be deleted'); renderAll(); return; } DJ.st = st; DJ.res = null; status(st.message || 'The offline dictionary was removed'); renderAll(); }); return; }
}, true);
{ const rc0 = readerFromConfig;
  readerFromConfig = function (c) { rc0(c); if (DJ_CHECK) return; if (['ask', 'always', 'off'].includes(c.dict_online)) DJO.mode = c.dict_online; DJO.seen = !!c.dict_online_seen; };   // eslint-disable-line no-global-assign
}
Object.assign(ICON, {
  globe: '<circle cx="12" cy="12" r="10"/><path d="M2 12h20"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>',
  wifioff: '<path d="M12 20h.01"/><path d="M8.5 16.43a5 5 0 0 1 7 0"/><path d="M2 8.82a15 15 0 0 1 4.17-2.65"/><path d="M10.66 5c4.01-.36 8.14.9 11.34 3.76"/><path d="M16.85 11.25a10 10 0 0 1 2.22 1.68"/><path d="M5 12.86a10 10 0 0 1 5.17-2.69"/><path d="m2 2 20 20"/>'
});
