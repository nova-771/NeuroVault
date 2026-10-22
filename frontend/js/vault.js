/* BUILD V · THE VAULT ON DISK: notes are plain .md files in a folder you choose (api.py's Build V block, vault_disk.py).
   The user (2026-10-18), on the installed setup's "Daily notes in Obsidian" card: "this should not be the case"; "do both".
   Profile: "First run starts with your vault folder". Mockup: the setup's step 1 (Create a new vault / Open a folder as
   a vault) and Settings → Vault & files (vaultHead).
   - vaultCards(): the two cards, for the setup's step 1 and the one-time screen.
   - The one-time screen: an install that had notes before the vault existed is asked once where the vault goes (the
     user: "Ask once, then copy"); the backend backs up the database and copies every note out as a .md file.
   - Settings → Vault & files: the vault folder and Change…, the settings file, Sticky Notes and Brain Dump as files.
   - vaultPoll(): every few seconds and when the window gets focus, the backend writes what's behind and reads the
     folder; notes made, changed, moved or deleted outside NeuroVault show up. A note you're typing in keeps your text
     (the outside text is kept as a version: "Changed outside NeuroVault").
   Without the app (a browser, ?check=1) the cards work on the sample: nothing is written anywhere. */
'use strict';
const VSTATE = { path: '', documents: '', legacy: 0, ask: false, busy: false, name: 'NeuroVault', missing: false, timer: null, polling: false };
const VAULT_POLL_MS = 4000;
BM_REASON.outside = 'Changed outside NeuroVault';   // Build M's Timeline names this version

const vaultDocs = () => VSTATE.documents || 'Documents';
const vaultShort = p => { const d = VSTATE.documents, low = (p || '').toLowerCase(); return d && (low === d.toLowerCase() || low.startsWith(d.toLowerCase() + '\\')) ? 'Documents' + p.slice(d.length) : p; };
const vaultNew = () => `${vaultShort(vaultDocs())}\\${(VSTATE.name || '').trim() || 'NeuroVault'}`;
const vaultLive = () => !!api() && !CHECK;

// The two cards (mockup R24 step 1). where: 'setup' or 'move' (the one-time screen)
function vaultCards(where) {
  const busy = VSTATE.busy ? 'disabled' : '';
  const now = VSTATE.path ? `<p class="ob-row vault-now" role="status"><span class="chip chip--success">Your vault</span><span class="code truncate" title="${esc(VSTATE.path)}">${esc(VSTATE.path)}</span></p>` : '';
  return `<div class="choice-grid vault-cards" data-vault-cards="${where}"><div class="card choice">${ic('folderplus')}<div class="set-label" id="vc-new-l">Create a new vault</div>
      <input class="field" id="vault-name" data-act="vault-name" value="${esc(VSTATE.name)}" aria-label="Vault name" maxlength="80" ${busy}>
      <div class="set-desc code truncate" data-vault-new title="${esc(vaultNew())}">${esc(vaultNew())}</div>
      <button class="btn btn--primary" data-act="vault-create" ${busy}>Create vault</button></div>
    <div class="card choice">${ic('folder')}<div class="set-label">Open a folder as a vault</div><div class="set-desc">Works with an Obsidian vault too: your files are not moved or changed.</div>
      <button class="btn btn--secondary" data-act="vault-choose" ${busy}>Choose folder…</button></div></div>${now}`;
}

// The one-time screen: notes from before the vault existed are copied out once a folder is picked
function vaultMoveScreen() {
  const n = VSTATE.legacy;
  return `<div class="onboard"><div class="card onboard-card" role="dialog" aria-modal="true" aria-labelledby="vm-t"><div><div class="eyebrow">NeuroVault update</div>
    <h1 class="view-title" id="vm-t" tabindex="-1">Pick a folder for your notes</h1><p class="view-sub">Your notes now stay as plain .md files in a folder you choose. Nothing needs an account or the internet.</p></div>
    ${vaultCards('move')}
    <p class="set-desc">${n ? `NeuroVault copies your ${n} note${n === 1 ? '' : 's'} there as .md files. It backs up its database first, and nothing is deleted.` : 'New notes are saved there as .md files.'} Settings stay in <span class="code">config.json</span> on this PC.</p></div></div>`;
}

async function vaultLoadState() {
  if (!vaultLive()) return null;
  const r = await nv('vault_state'); if (failed(r)) return null;
  Object.assign(VSTATE, { path: r.path || '', documents: r.documents || '', legacy: r.legacy_notes || 0, missing: !!r.path && !r.exists, inUse: r.in_use || null });   // QC 86: in_use
  return r;
}

// After a vault is made or opened: the notes, folders and lists come from it now
async function vaultReload() {
  if (!VAULT.live) return;
  const keep = S.noteId; await flushSaves(); await loadVault();
  S.noteId = D.notes.some(n => n.id === keep) ? keep : D.notes[0]?.id ?? null;
  if (typeof loadCapture === 'function') loadCapture();
}
async function vaultPick(how, where, together) {   // QC 86: together = the folder the user said to use together
  if (VSTATE.busy) return null;
  if (!vaultLive()) {   // the sample: show it worked, write nothing
    VSTATE.path = how === 'create' ? vaultNew() : 'D:\\Obsidian';
    return { status: 'success', path: VSTATE.path, notes: D.notes.length, copied: 0, found: 0, sample: true };
  }
  VSTATE.busy = true; renderAll();
  const r = together ? await nv('vault_open', together, true)
    : how === 'create' ? await nv('vault_create', (VSTATE.name || '').trim() || 'NeuroVault') : await nv('vault_choose');
  VSTATE.busy = false;
  if (r?.code === 'vault_in_use') { vaultAskInUse(r.in_use || { path: r.path }, how, where); return null; }   // QC 86
  if (r?.status === 'cancelled') { renderAll(); return null; }
  if (failed(r)) { toast(r.message || "That folder couldn't be used"); renderAll(); return null; }
  VSTATE.path = r.path; VSTATE.legacy = 0; VSTATE.missing = false; VSTATE.inUse = null; VSTATE.clash = null;   // QC 86
  await vaultReload(); vaultWatch();
  return r;
}
const vaultSaid = (r, how) => `${how === 'create' ? 'Created your vault in' : 'Opened'} ${vaultShort(r.path)}${how === 'create' ? '' : ' as your vault'}${r.copied ? ` · ${r.copied} note${r.copied === 1 ? '' : 's'} copied in` : ''}${r.found ? ` · ${r.found} note${r.found === 1 ? '' : 's'} found` : ''}`;

async function vaultAct(how, where, together) {
  const r = await vaultPick(how, where, together); if (!r) return;
  if (where === 'setup') { obGo('comfort'); toast(vaultSaid(r, how)); return; }
  if (where === 'move') { VSTATE.ask = false; app.classList.remove('is-setup'); resetVaultView(); renderAll(); toast(vaultSaid(r, how)); return; }
  renderAll(); toast(how === 'create' ? vaultSaid(r, how) : `${vaultSaid(r, how)} · the old vault stays as it was`);
}

/* ---- Notes made, changed or deleted outside NeuroVault ---- */
const sameTags = (a, b) => a.length === b.length && a.every((t, i) => t === b[i]);
async function vaultApply(r) {
  if (!(r.changed?.length || r.added?.length || r.removed?.length || r.folders)) return;
  const [folders, notes, projects] = await Promise.all([nv('list_folders'), nv('list_notes', null, null, true), nv('list_projects')]);
  if (!Array.isArray(folders) || !Array.isArray(notes)) return;
  D.folders = folders.map(mapFolder); if (Array.isArray(projects)) D.projects = projects.map(mapProject);   // a new top-level folder is a project
  const had = new Map(D.notes.map(n => [n.id, n]));
  D.notes = notes.map(raw => {
    const m = mapNote(raw), n = had.get(m.id); if (!n) return m;
    if (n.dirty || n.docDirty || n.saving) return n;   // you're typing in it: your text wins (the outside text is a version)
    if (n.md !== m.md) { n.md = m.md; n.html = null; if (typeof EDH !== 'undefined') EDH.delete(n.id); }
    if (n.title !== m.title || n.folder !== m.folder || !sameTags(n.tags, m.tags)) Object.assign(n, { title: m.title, folder: m.folder, tags: m.tags });
    n.mtime = m.mtime; n.path = m.path; return n;
  });
  if (!D.notes.some(n => n.id === S.noteId)) S.noteId = D.notes[0]?.id ?? null;
  syncCategories(); renderAll();
}
async function vaultPoll() {
  if (VSTATE.polling || !vaultLive() || !VAULT.live || !VSTATE.path || SETUP.open || VSTATE.ask) return;
  VSTATE.polling = true;
  try {
    await flushSaves();   // your latest typing reaches the file first, so an outside delete or edit can't lose it
    const r = await nv('vault_poll'); if (failed(r)) return;
    if (r.in_use) { VSTATE.inUse = r.in_use; if (!VSTATE.clash && !VSTATE.clashLater) vaultAskInUse(r.in_use, 'start', 'settings'); return; }   // QC 86
    if (r.missing !== VSTATE.missing) { VSTATE.missing = !!r.missing; if (r.missing) toast(`The vault folder isn't there: ${VSTATE.path}. Your edits are kept and saved to it when it's back`); }
    await vaultApply(r);
  } finally { VSTATE.polling = false; }
}
function vaultWatch() {
  clearInterval(VSTATE.timer); if (!vaultLive() || !VSTATE.path) return;
  VSTATE.timer = setInterval(() => { if (document.visibilityState === 'visible') vaultPoll(); }, VAULT_POLL_MS);
}
window.addEventListener('focus', () => vaultPoll());

/* ---- Settings → Vault & files: the folder, Change…, the settings file and the lists as files ---- */
function vaultSettingsHead() {
  const p = VSTATE.path || (vaultLive() ? '' : 'D:\\Obsidian');
  return `<div class="set-row"><div><div class="set-label">Vault folder</div><div class="set-desc code truncate" title="${esc(p)}">${p ? esc(p) : 'None yet: notes are in the database until you pick one'}</div>${VSTATE.inUse && !VSTATE.clash ? '<div class="set-desc ai-nofit" role="alert">Paused: this folder is used by another NeuroVault. <button class="btn btn--secondary btn--sm" data-act="vault-inuse-again">Decide…</button></div>' : ''}${VSTATE.missing ? '<div class="set-desc ai-nofit" role="alert">The folder isn\'t there: your edits are kept and saved to it when it\'s back</div>' : ''}</div><button class="btn btn--secondary" data-act="vault-change" ${VSTATE.busy ? 'disabled' : ''}>Change…</button></div>
  <div class="set-row"><div><div class="set-label">Settings file</div><div class="set-desc code">config.json, on this PC · it stays here when you change the vault</div></div></div>`;
}

/* ---- Drawing, clicks and keys ---- */
const _renderModalV = renderModal;
renderModal = function () {
  if (!VSTATE.ask || SETUP.open) return _renderModalV();
  app.classList.add('is-setup');   // the window bar shows only its drag area and buttons, as for the setup
  return vaultMoveScreen();   // a dialog that opens meanwhile (a wrap-up reminder) waits until a vault is picked
};
document.getElementById('app').addEventListener('input', e => {
  if (e.target.dataset?.act !== 'vault-name') return;
  VSTATE.name = e.target.value; const el = e.target.closest('.choice')?.querySelector('[data-vault-new]');
  if (el) { el.textContent = vaultNew(); el.title = vaultNew(); }
});
document.getElementById('app').addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.dataset?.act === 'vault-name') { e.preventDefault(); app.querySelector('[data-act="vault-create"]')?.click(); } });
document.getElementById('app').addEventListener('click', e => {
  const t = e.target.closest?.('[data-act]'); if (!t || t.disabled) return;
  const act = t.dataset.act, where = t.closest('[data-vault-cards]')?.dataset.vaultCards || 'settings';
  if (act === 'vault-create') { vaultAct('create', where); return; }
  if (act === 'vault-choose') { vaultAct('choose', where); return; }
  if (act === 'vault-change') { vaultAct('choose', 'settings'); return; }
  // Next on step 1 with no vault picked: the default one is made first (Skip on a step keeps the defaults)
  if (SETUP.open && S.ob.step === 'vault' && !VSTATE.path && (act === 'ob-go' || act === 'ob-skip') && t.dataset.v !== 'vault') {
    e.stopImmediatePropagation(); vaultAct('create', 'setup'); }
}, true);
document.addEventListener('keydown', e => {   // the one-time screen can't be closed: a vault is needed
  if (!VSTATE.ask || SETUP.open) return;
  const k = e.key.toLowerCase(), ctrl = e.ctrlKey || e.metaKey;
  if (e.key === 'Escape' || e.key === 'F11' || (ctrl && ['k', 'd', 'n', 't', 'w', 'r'].includes(k))) { e.stopImmediatePropagation(); if (e.key !== 'Escape') e.preventDefault(); }
}, true);

// Skip the setup on a first run makes the default vault (api.setup_skip): read it back
const _obSkipAllV = obSkipAll;
obSkipAll = async function () { await _obSkipAllV(); if (vaultLive()) { await vaultLoadState(); await vaultReload(); vaultWatch(); renderAll(); } };

/* ---- At start: which vault; the one-time screen when notes are still only in the database ---- */
// A test page (the app inside tests/editor-behaviour.html's frame, or ?mute=1 / ?check=1, as Build N's mute.js tells them) never
// gets the one-time screen: it would cover the editor and hold Esc and Ctrl+K. The real app is never in a frame
function vaultTestPage() {
  let framed = true; try { framed = window.parent !== window; } catch (e) { /* another origin's frame */ }
  return framed || (typeof NV_MUTE !== 'undefined' && NV_MUTE.on) || CHECK;
}
async function vaultBoot() {
  if (!vaultLive() || VSTATE.booted) return; VSTATE.booted = true;
  const st = await vaultLoadState(); if (!st) { VSTATE.booted = false; return; }
  const setup = await nv('setup_state');
  if (!st.path && !failed(setup) && !setup.show && !vaultTestPage()) { closeModal(true); VSTATE.ask = true; S.focus = { sel: '#vm-t' }; renderAll(); return; }
  if (st.path) vaultWatch();
  if (st.in_use) { vaultAskInUse(st.in_use, 'start', 'settings'); return; }   // QC 86: the vault config.json names is another NeuroVault's
  renderAll();
}
const _bootV = boot;
boot = function () { _bootV(); vaultBoot(); };
window.addEventListener('pywebviewready', () => { if (started) started.then(vaultBoot); });
/* ---- end Build V ---- */

/* ==== QC 86 · a folder another NeuroVault already uses is never taken without asking ====
   2026-10-18: a test bridge's copy-out wrote 55 " 2" notes into the user's real vault. The backend marks every vault
   (.neurovault/vault-id.json) and, for a folder another install uses, answers code vault_in_use (or in_use at start and
   in vault_poll: nothing is written there meanwhile). One question, in plain words: Use it together / Pick another folder.
   × or Esc is Not now: the vault stays paused and Settings → Vault & files asks again. */
function vaultAskInUse(info, how, where) {
  VSTATE.clash = { path: info.path || VSTATE.path, detail: info.detail || '', how, where }; VSTATE.clashLater = false;
  S.focus = { sel: '[data-dlg="vault-inuse"] [data-act="vault-other"]' }; renderAll();
}
function vaultInUseDlg() {
  const c = VSTATE.clash; if (!c) return '';
  return dlg({ id: 'vault-inuse', size: 'sm', role: 'alertdialog', keep: true, title: 'This folder is already used by another NeuroVault', descId: 'vault-inuse-d',
    x: 'vault-inuse-later', xLabel: 'Not now: nothing is written to that folder', xTitle: 'Not now (Esc): nothing is written to that folder',
    body: `<p id="vault-inuse-d"><span class="code truncate" title="${esc(c.path)}">${esc(vaultShort(c.path))}</span></p><p class="set-desc">${esc(c.detail || 'Another NeuroVault keeps its notes there.')}</p>`,
    others: [`<button class="btn btn--secondary" data-act="vault-other" ${VSTATE.busy ? 'disabled' : ''}>Pick another folder</button>`],
    main: `<button class="btn btn--primary" data-act="vault-together" ${VSTATE.busy ? 'disabled' : ''}>Use it together</button>` });
}
{ const vaultModal86 = renderModal;
  renderModal = function () { return vaultModal86.apply(this, arguments) + vaultInUseDlg(); };   // eslint-disable-line no-global-assign
}
document.getElementById('app').addEventListener('click', e => {
  const t = e.target.closest?.('[data-act]'); if (!t || t.disabled) return;
  const act = t.dataset.act, c = VSTATE.clash;
  if (act === 'vault-inuse-again' && VSTATE.inUse) { e.stopImmediatePropagation(); vaultAskInUse(VSTATE.inUse, 'start', 'settings'); return; }
  if (!c || !['vault-together', 'vault-other', 'vault-inuse-later'].includes(act)) return;
  e.stopImmediatePropagation(); VSTATE.clash = null;
  if (act === 'vault-inuse-later') { VSTATE.clashLater = true; renderAll(); return; }
  const where = c.where === 'setup' || c.where === 'move' ? c.where : 'settings';
  vaultAct(act === 'vault-together' ? c.how === 'create' ? 'create' : 'choose' : 'choose', where, act === 'vault-together' ? c.path : undefined);
}, true);
document.addEventListener('keydown', e => {
  if (!VSTATE.clash || e.key !== 'Escape') return;
  e.stopImmediatePropagation(); e.preventDefault(); VSTATE.clash = null; VSTATE.clashLater = true; renderAll();
}, true);
/* ==== end QC 86 ==== */
