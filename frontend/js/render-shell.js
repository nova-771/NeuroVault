/* The shell: window bar with tabs, rail, sidebars, note header, right sidebar, status bar, split panes and renderAll().
   Extracted from design/vault-notes-mockups.html (R20) with every design switch baked in. */
'use strict';
// Build M: Graph and Branches were removed (2026-10-17); the Timeline has its own icon, Route (R42), distinct from Timer's clock
const VIEW_LABEL = { notes: 'Notes', tasks: 'Tasks', timer: 'Timer', history: 'Timeline', newtab: 'New tab' };
const VIEW_ICON = { notes: 'file', tasks: 'tasks', timer: 'timer', history: 'route', newtab: 'file' };
function viewFn(v) { return { notes: viewNotes, tasks: viewTasks, timer: viewTimer, history: viewHistory, newtab: viewNewTab }[v]; }

/* ---- Rail: icons, 28px buttons, 4px under the window bar (R18). Views swap and tabs stay put (R9) ---- */
function renderRail() {
  const views = [['notes', 'Notes'], ['tasks', 'Tasks'], ['timer', 'Timer'], ['history', 'Timeline']];   // Build M: Graph and Branches removed
  return `<nav class="rail" aria-label="Views"><div class="rail-main"><div class="rail-nav">${views.map(([v, l]) =>
    `<button class="rail-btn" data-act="view" data-v="${v}" ${UI.view === v ? 'aria-current="page"' : ''} aria-label="${l}" title="${l}">${ic(VIEW_ICON[v])}</button>`).join('')}</div></div>
    <div class="rail-foot"><button class="rail-btn" data-act="theme-toggle" aria-label="Switch to ${isDark() ? 'light' : 'dark'} theme" title="Light / dark">${ic(isDark() ? 'moon' : 'sun')}</button>
    <button class="rail-btn" data-act="settings" aria-label="Settings" title="Settings" ${S.modal === 'settings' ? 'aria-pressed="true"' : ''}>${ic('gear')}</button></div></nav>`;
}

/* ---- Left sidebar: the file explorer beside notes (R8), the module's own sidebar beside every other view (Build M) ---- */
function skelList(n) { return Array.from({ length: n }, () => `<div class="list-item"><div class="list-item-main" style="width:100%"><div class="skel" style="height:12px;width:80%"></div><div class="skel mt-1" style="height:9px;width:40%"></div></div></div>`).join(''); }
function renderSidebar() {
  if (UI.view === 'notes' || UI.view === 'newtab') return renderFileExplorer();
  return moduleSidebar();   // Build M: Tasks, Timer and Timeline (render-modules.js): R46's tools row over R42's flat groups
}

/* ---- Note header: Back, Forward and the folder path like Obsidian (R10), 8px from the sidebar's edge (R20); More menu only (R9) ---- */
// R19: measure where the path's lowercase letters sit against Back's arrow and nudge the text, in whole pixels, onto it
function alignCrumb() {
  document.querySelectorAll('.app .app-header').forEach(h => {
    h.style.removeProperty('--crumb-nudge');
    const t = h.querySelector('.crumb-label') || h.querySelector('.crumb-text'), sv = h.querySelector('[data-act="back"] svg'); if (!t || !sv || !t.offsetWidth) return;
    const z = h.getBoundingClientRect().width / h.offsetWidth || 1, probe = document.createElement('span'); probe.style.cssText = 'display:inline-block;width:0;height:0;vertical-align:baseline'; t.appendChild(probe);
    const base = probe.getBoundingClientRect().top; probe.remove(); const c = document.createElement('canvas').getContext('2d'); c.font = getComputedStyle(t).font;
    const half = c.measureText('xnmao').actualBoundingBoxAscent / 2, r = sv.getBoundingClientRect();
    h.style.setProperty('--crumb-nudge', Math.round(((r.top + r.bottom) / 2 - base) / z + half) + 'px'); });
}
if (document.fonts) { document.fonts.ready.then(() => alignCrumb()); document.fonts.addEventListener?.('loadingdone', () => alignCrumb()); }
function crumbPath() {
  const n = UI.view === 'notes' && note(); if (!n) return '';
  return `<span class="crumb-path">${ancestors(n.folder).map(f => `<button class="crumb-folder" data-act="crumb-folder" data-v="${f}" title="Show ${esc(folderName(f))} in the sidebar"><span class="crumb-label">${esc(folderName(f))}</span></button><span class="crumb-sep" aria-hidden="true">/</span>`).join('')}</span>`;
}
function crumbText() {
  const n = note();
  return { notes: n ? n.title : 'No note open', tasks: 'Tasks · ' + S.taskFilter, timer: 'Timer · ' + TPAGES.find(x => x[0] === UI.tpage)[1], history: 'Timeline · ' + S.range + ' · ' + S.type, newtab: 'New tab' }[UI.view];
}
function renderHeader() {
  const nav = `<div class="crumb"><button class="icon-btn icon-btn--sm" data-act="back" aria-label="Back" ${S.histIx <= 0 ? 'disabled' : ''}>${ic('left')}</button><button class="icon-btn icon-btn--sm" data-act="fwd" aria-label="Forward" ${S.histIx >= S.hist.length - 1 ? 'disabled' : ''}>${ic('right')}</button>${crumbPath()}<span class="crumb-text truncate">${esc(crumbText())}</span></div>`;
  const noteOpen = UI.view === 'notes' && note(), off = noteOpen ? '' : 'disabled';
  // R9: read aloud, the reading ruler and zen sit here when the pane has room
  const opt = noteOpen ? `<button class="icon-btn hdr-optional" data-act="read" aria-label="Read aloud" aria-pressed="${S.modal === 'read'}" title="Read aloud">${ic('volume')}</button><button class="icon-btn hdr-optional" data-act="ruler" aria-label="Reading ruler (Ctrl+Alt+R)" aria-pressed="${S.a11y.ruler}" title="Reading ruler (Ctrl+Alt+R)">${ic('ruler')}</button><button class="icon-btn hdr-optional" data-act="zen" aria-label="Zen mode" aria-pressed="${UI.zen === 'on'}" title="Zen mode (F11)">${ic('focus')}</button>` : '';
  const actions = `${opt}<button class="icon-btn" data-act="menu" aria-label="More actions" aria-expanded="${S.menu}" title="More">${ic('more')}</button>
      ${S.menu ? `<div class="menu card" role="menu"><button class="menu-item" role="menuitem" data-act="export" ${off}>${ic('download')}Export as .md</button><button class="menu-item" role="menuitem" data-act="move-open" data-kind="note" data-v="${noteOpen ? note().id : ''}" ${off}>${ic('folder')}Move to…</button><button class="menu-item" role="menuitem" data-act="read" ${off}>${ic('volume')}Read aloud</button><button class="menu-item" role="menuitem" data-act="spell-pass" ${off}>${ic('check')}Check spelling<span class="menu-kbd">F7</span></button><button class="menu-item" role="menuitem" ${soon('Export to PDF')}>${ic('download')}Export to PDF…</button><button class="menu-item" role="menuitem" data-act="history" ${off}>${ic('route')}Version history…</button><button class="menu-item" role="menuitem" data-act="zen">${ic('focus')}Zen mode<span class="menu-kbd">F11</span></button><button class="menu-item" role="menuitem" data-act="split-right">${ic('columns')}Split right</button><div class="menu-sep"></div><button class="menu-item" role="menuitem" data-act="sync">${ic('db')}Sync details</button><div class="menu-sep"></div><button class="menu-item menu-item--danger" role="menuitem" data-act="delete" ${off}>${ic('trash')}Delete note…</button></div>` : ''}`;
  return `<header class="app-header">${nav}<div class="header-actions">${actions}</div></header>`;
}

/* ---- Right sidebar: Outline / Backlinks / Tags as underline tabs, three equal parts (R18) ---- */
const INSP_TABS = [['outline', 'Outline', 'toc', 1], ['backlinks', 'Backlinks', 'link', 2], ['tags', 'Tags', 'tag', 3], ['files', 'Attachments', 'clip', 4]];   // Build A: Attachments, fourth (R21 tab4: fit); the number is its Alt key
// Build N (R54, the decision "icons only"): wireframe icons; the name and its key show in our own tooltip (data-tip, on hover
// and on keyboard focus), Alt+1–5 (insp-tabs.js). One tab stop: ← → move between them (the ARIA tabs pattern)
const tabBtn = (k, l, i, on, n) => `<button class="tab" role="tab" id="insp-tab-${k}" data-act="tab" data-v="${k}" aria-selected="${on}" tabindex="${on ? 0 : -1}" aria-controls="insp-panel" aria-label="${l}"${n ? ` aria-keyshortcuts="Alt+${n}" data-tip="${l} · Alt+${n}"` : ` data-tip="${l}"`}>${ic(i)}</button>`;
// the tabs there are now (ai-chat.js adds Ask while the chat is docked), and what the Ask tab shows (ai-chat.js)
function inspTabs(n) { return INSP_TABS.filter(t => t[0] !== 'files' || attTabShown(n)); }   // Build A: R28, the tab can hide with no note open
function inspAsk() { return ''; }
const backlinks = n => D.notes.filter(x => x.id !== n.id && wikiLinks(x).some(t => wikiTarget(t) === n));   // Phase 2: notes with a [[link]] to this one
function renderInspector() {
  const n = note(), tabs = inspTabs(n), cur = tabs.some(t => t[0] === S.tab) ? S.tab : 'outline';
  let body = '';
  if (cur === 'files') body = attPanel(n);   // Build A
  else if (!n) body = `<div class="list-item-sub">Open a note to see its outline.</div>`;
  else if (cur === 'outline') { const o = outline(n); body = `<div class="eyebrow truncate">${esc(n.title)}</div><div class="outline">${o.map((h, i) => `<button class="outline-link${h.level === 3 ? ' is-h3' : ''}" data-act="jump" data-v="${i}">${esc(h.text)}</button>`).join('') || '<span class="list-item-sub">No headings</span>'}</div>`; }
  else if (cur === 'backlinks') { const bl = backlinks(n); body = `<div class="eyebrow">Linked mentions · ${bl.length}</div>${bl.map(x => `<button class="list-item" data-act="note" data-v="${x.id}"><span class="list-item-main"><span class="list-item-title truncate">${esc(x.title)}</span><span class="list-item-sub">${esc(folderPath(x.folder).join(' / '))}</span></span></button>`).join('') || `<div class="list-item-sub">Nothing links to this note yet.</div>`}`; }
  else body = `<div class="eyebrow">Tags · ${n.tags.length}</div><div class="note-meta">${n.tags.map(t => `<button class="chip chip--accent" data-act="tag" data-v="${esc(t)}">#${esc(t)}</button>`).join('') || '<span class="list-item-sub">No tags</span>'}</div>`;
  const strip = `<div class="tabs" role="tablist" aria-label="Right sidebar"><div class="tab-track">${tabs.map(([k, l, i, key]) => tabBtn(k, l, i, cur === k, key)).join('')}</div></div>`;
  if (cur === 'ask') return `<aside class="inspector is-ask" id="right-sidebar" aria-label="Inspector">${strip}${inspAsk()}</aside>`;   // Build N (R54): the docked chat, a tab
  return `<aside class="inspector" id="right-sidebar" aria-label="Inspector">${strip}<div class="insp-body" id="insp-panel" role="tabpanel" aria-labelledby="insp-tab-${cur}">${body}</div></aside>`;
}

/* ---- Dialogs ---- */
function renderModal() {
  if (S.modal === 'palette') return paletteModal();
  if (S.modal === 'voicerec' || S.modal === 'voice') return voiceModal();   // Phase 6B
  // Fix C (QC 17): the two tables stack inside the dialog's width, and a long line is cut with "…" (the whole line on hover)
  if (S.modal === 'sync') return dlg({ id: 'sync', size: 'md', title: 'Sync details', sub: 'How your notes and your .md files stay in step',   // Build L: R41's anatomy, medium
    body: `<div class="sync-tables"><div class="card card-pad"><div class="eyebrow">Table · tasks</div><div class="mini-table mt-2">${D.tasks.slice(0, 8).map(t => `<div class="mini-row"><span class="truncate" title="${esc(t.title)}">${t.done ? '☑' : '☐'} ${esc(t.title)}</span></div>`).join('') || '<span class="list-item-sub">Empty</span>'}</div></div>
    <div class="card card-pad"><div class="eyebrow">Table · notes → files</div><div class="mini-table mt-2">${D.notes.slice(0, 8).map(n => `<div class="mini-row"><span class="truncate" title="${esc(n.title)}">${esc(n.title)}</span><span class="code truncate" title="vault/${esc(n.category)}/${slug(n.title)}.md">vault/${esc(n.category)}/${slug(n.title)}.md</span></div>`).join('') || '<span class="list-item-sub">Empty</span>'}</div></div></div>
    <p class="list-item-sub">Ticking a task in a note or on the Tasks board updates both the database and the .md file.</p>`,
    main: '<button class="btn btn--primary" data-act="close">Done</button>' });
  if (S.modal === 'settings') return settingsModal();
  if (S.modal === 'timer-away') return awayModal();   // Phase 4: the app was closed while a session ran
  if (S.modal === 'move') return moveModal();
  if (S.modal === 'dump') return dumpBar();   // Phase 6A
  if (S.modal === 'sticky-append' || S.modal === 'sticky-attach') return stickyPickModal();   // Phase 6A
  if (S.modal === 'read') return readBar();   // Phase 6C: the read bar (read-aloud.js)
  // Build L: deleting has no confirm (the note, folder and project dialogs are gone): it's done at once, with Undo (dialogs.js hold)
  return '';
}

/* ---- Render ---- */
function renderAll() {
  if (POP) { renderPop(); return; }   // Build H: a popped-out sticky or timer (popout.js)
  syncDocs();   // Phase 2: the editor's unsaved HTML becomes Markdown before the page is rebuilt
  syncTabs();   // Build M · R44: panes.js keeps the panes in step first
  const at = S.tabs.find(t => t.id === S.activeTab); if (S.offTab) pushTrail({ key: 'tab:view:' + S.offTab, label: VIEW_LABEL[S.offTab], icon: VIEW_ICON[S.offTab], go: { kind: 'view', ref: S.offTab } }); else if (at) pushTrail(tabTrail(at));
  const ae = document.activeElement, keep = !S.focus && ae && app.contains(ae) ? (ae.id ? { sel: '#' + CSS.escape(ae.id), pos: ae.selectionStart } : ae.dataset?.act ? { sel: `[data-act="${ae.dataset.act}"]${ae.dataset.v ? `[data-v="${CSS.escape(ae.dataset.v)}"]` : ''}` } : null) : null;
  syncCategories();
  const scrolls = keepScroll();   // Bug fix 2026-10-16: a rebuild used to reset every scroll bar to the top
  const layout = paneLayout(), main = layout ? panesHtml() : viewFn(UI.view)();   // Build M · R44: more than one pane shows the pane grid (panes.js)
  app.innerHTML = renderTitlebar() + `<div class="app-body">` + renderRail() + (S.side ? renderSidebar() : '') +
    `<main class="main${S.a11y.ruler ? ' has-ruler' : ''}">${layout ? '' : renderHeader()}${main}${renderStatus()}${S.a11y.ruler ? '<div class="ruler" data-ruler aria-hidden="true"></div>' : ''}</main>` +
    (UI.view === 'notes' ? renderInspector() : paneInspector()) + `</div>` + renderOverlay() + renderModal() + renderContextMenu() +
    (S.toast ? `<div class="toast card" role="status">${ic('ok')}${esc(S.toast)}</div>` : '') + holdBar();   // holdBar: Build L, Undo for 10 seconds after a delete
  applyComfort();
  const rows = app.querySelectorAll('[data-tree]'); if (rows.length && !app.querySelector('[data-tree][tabindex="0"]')) rows[0].tabIndex = 0;   // roving tab stop
  tabOverflow();   // R10: show the tab list first, so the active tab is scrolled into the room that's left
  const tab = app.querySelector('.ws-tab[aria-selected="true"]'), strip = tab?.parentElement;
  if (strip) { const z = strip.getBoundingClientRect().width / strip.offsetWidth || 1, x = (tab.getBoundingClientRect().left - strip.getBoundingClientRect().left) / z + strip.scrollLeft;
    const f = strip.scrollWidth > strip.clientWidth + 1 ? 32 : 0;   // R10: keep the active tab clear of the edge fades
    if (x < strip.scrollLeft + (strip.scrollLeft ? f : 0) || x + tab.offsetWidth > strip.scrollLeft + strip.clientWidth - f) strip.scrollLeft = Math.max(0, x - 40); }
  tabOverflow(); anchorQt(); fitToolbar(); alignCrumb(); placePop();   // placePop: Build H
  const fo = S.focus || keep;
  if (fo) { const el = app.querySelector(fo.sel); if (el) { el.focus({ preventScroll: true }); if (fo.pos != null && el.setSelectionRange) el.setSelectionRange(fo.pos, fo.pos); if (fo.select && el.select) el.select(); } S.focus = null; }
  afterRender();
  scrolls();   // put the lists and pages back where they were, so a row is only scrolled to when it's out of view (after afterRender: video boxes are in by then)
  if (S.scrollTo) { app.querySelector(`[data-tree][data-v="${S.scrollTo}"]`)?.scrollIntoView({ block: 'nearest' }); S.scrollTo = null; }
}
/* Bug fix 2026-10-16: renderAll rebuilds the whole window, which put every scroller back at the top
   (clicking a row in a long tree made the list jump; any click on a long note sent the page to the top).
   Before a rebuild, note each scroller's position; after it, put it back. The sidebar always keeps its place;
   a page keeps its place only while it shows the same thing (same view, tab and note), so opening another note starts at the top. */
const KEEP_SCROLL = [['.side-body', false], ['.view', true], ['.insp-body', true], ['#raw-markdown-textarea', true], ['.settings-pane', 'sec'], ['.modal-body', false], ['.menu--tabs', false]];
function keepScroll() {
  const where = [UI.view, S.activeTab, UI.view === 'notes' ? S.noteId : '', S.split || ''].join('|');   // S.split: the panes showing (panes.js)
  const saved = KEEP_SCROLL.map(([sel]) => [...app.querySelectorAll(sel)].map(e => [e.scrollTop, e.scrollLeft]));
  if (saved[0].length) keepScroll.side = saved[0];   // the sidebar remembers its place while it's hidden too
  else saved[0] = keepScroll.side || [];
  const was = keepScroll.where, wasSec = keepScroll.sec; keepScroll.where = where; keepScroll.sec = S.setSec;
  return () => KEEP_SCROLL.forEach(([sel, samePage], i) => {
    if (samePage === 'sec' ? wasSec !== S.setSec : samePage && was !== where) return;   // Fix C: a Settings page keeps its place; another page starts at the top
    app.querySelectorAll(sel).forEach((e, j) => { const s = saved[i][j]; if (s) { e.scrollTop = s[0]; e.scrollLeft = s[1]; } });
  });
}
function openNote(id, push = true, newTab = false) {
  S.noteId = id; S.menu = false;
  const on = D.notes.find(n => n.id === id); if (on) { ancestors(on.folder).forEach(f => S.open.add(f)); S.scrollTo = id; }   // R6: opening a note opens its folders
  if (push) { S.hist = S.hist.slice(0, S.histIx + 1); if (S.hist[S.hist.length - 1] !== id) S.hist.push(id); S.histIx = S.hist.length - 1; }
  if (newTab) { const t = mkTab('note', id), i = S.tabs.findIndex(x => x.id === S.activeTab); S.tabs.splice(i + 1, 0, t); S.activeTab = t.id; }   // R7: Ctrl+click or middle-click opens a new tab
  if (UI.view !== 'notes') setUI('view', 'notes'); else renderAll();
}
function toast(msg) { S.toast = looksRaw(msg) ? plainMsg(msg) : msg;   /* QC 90 */ renderAll(); clearTimeout(toast.t); toast.t = setTimeout(() => { S.toast = null; renderAll(); }, 1800); }
// Build M · QC 96: one message at a time, painted without a redraw and held 4 s; the same message again only keeps it longer; a new
// one waits until the last has shown 0.7 s (the latest wins), so a burst of messages never flickers
const STATUS_HOLD = { gap: new URLSearchParams(location.search).get('check') === '1' ? 0 : 700 };   // the checks turn it on where they test it
function status(msg) {
  const again = msg === S.status; S.status = msg; clearTimeout(status.t); status.t = setTimeout(status.clear, 4000);
  if (!again) status.soon();
}
status.soon = () => { clearTimeout(status.p); const wait = STATUS_HOLD.gap - (Date.now() - (status.at || 0)); if (wait > 0) status.p = setTimeout(status.paint, wait); else status.paint(); };
status.paint = () => {
  if (['saving', 'error', 'loading'].includes(UI.state) || S.status === 'System ready') return;
  const el = document.querySelector('.app .status-save'), tx = document.getElementById('status-text'); if (!el || !tx) return;
  if (tx.textContent !== S.status || el.hidden) { tx.textContent = S.status; el.title = S.status; el.hidden = false; status.at = Date.now(); }
};
// R15: a message from something you just did shows for 4 seconds, then the save status hides again
status.clear = () => { clearTimeout(status.t); S.status = 'System ready'; const el = document.querySelector('.app .status-save'); if (el && !el.querySelector('.status-dot').className.match(/is-/)) el.hidden = true; };

/* ---- Window bar, drawn by the app (R8): sidebar toggle, sticky / brain dump / voice centred over the sidebar (R13), tabs (R8),
        the timer pill ending 8px before the right sidebar's edge, wrap-up / search / toggle centred over it (R20), window buttons ---- */
function captureBtns() {
  if (UI.zen === 'on') return '';
  // Phase 6A: sticky notes and brain dump are built (capture.js); voice is built (Phase 6B)
  return [['sticky-new', 'sticky', 'New sticky note', ''], ['dump', 'inbox', 'Brain Dump (Ctrl+Shift+D)', `aria-pressed="${S.modal === 'dump'}"`], ['voice', 'mic', 'Voice ramble', `aria-pressed="${voiceOpen()}"`]]
    .map(([a, i, l, x]) => `<button class="top-btn" data-act="${a}" aria-label="${l}" ${x.startsWith('aria-disabled') ? x : `title="${l}" ${x}`}>${ic(i)}</button>`).join('');
}
function renderTitlebar() {
  const ctrls = `<div class="win-controls"><button class="win-btn" data-act="win" data-v="min" aria-label="Minimise" title="Minimise">${ic('winmin')}</button><button class="win-btn" data-act="win" data-v="max" aria-label="${S.max ? 'Restore down' : 'Maximise'}" title="${S.max ? 'Restore down' : 'Maximise'}">${ic(S.max ? 'winrestore' : 'winmax')}</button><button class="win-btn win-btn--close" data-act="win" data-v="close" aria-label="Close" title="Close">${ic('x')}</button></div>`;
  const caps = captureBtns();
  const capCell = caps ? `<div class="tb-caps" role="group" aria-label="Capture">${caps}</div>` : '';
  const left = `<div class="tb-left${caps ? ' has-caps' : ''}"><button class="top-btn top-btn--small" data-act="side-toggle" aria-expanded="${S.side}" aria-controls="left-sidebar" aria-label="${S.side ? 'Hide' : 'Show'} left sidebar" title="${S.side ? 'Hide' : 'Show'} left sidebar">${ic('sidebar')}</button>${capCell}</div>`;
  const inspShown = UI.view === 'notes' && UI.inspector !== 'hidden' && UI.zen !== 'on';
  // the drag area: actions.js hands a press here to Windows (move, snap) rather than pywebview's own page-driven drag
  const mid = renderTabs() + `<div class="tb-fill" data-drag title="Drag to move · double-click to maximise"></div>`;
  const split = inspShown;   // R17: with the right sidebar shown, the timer ends before its edge and the three icons sit centred over it
  return `<div class="titlebar${S.side ? ' has-side' : ''}${split ? ' is-split' : ''}">${left}${mid}${topActions(split ? 'pill' : 'all')}<div class="tb-right${inspShown ? ' is-insp' : ''}">${UI.zen === 'on' ? '' : (split ? `<div class="tb-icons" role="toolbar" aria-label="Day, search and right sidebar">${topActions('icons')}${inspToggle()}</div>` : inspToggle()) + '<span class="tb-sep tb-sep--win" aria-hidden="true"></span>'}${ctrls}</div></div>`;
}
function topActions(part = 'all') {   // R17: 'pill' = the timer only, 'icons' = wrap-up and search only (Build F: the wrap-up button is built, wrapup.js)
  if (UI.zen === 'on') return `<div class="tb-actions"><button class="top-btn top-btn--exit" data-act="zen" aria-label="Leave zen mode" title="Leave zen mode (F11 or Esc)">${ic('focus')}Leave zen</button></div>`;
  const live = TIMER_ACTIVE.includes(UI.tstate) && D.projects.length;
  const b = (act, icon, label, extra = '', badge = '') => `<button class="top-btn" data-act="${act}" aria-label="${label}" title="${label}" ${extra}>${ic(icon)}${badge}</button>`;
  const icons = `<button class="top-btn" data-act="wrap" aria-label="Wrap up the day" title="Wrap up the day" aria-pressed="${typeof wrapOpen === 'function' && wrapOpen()}">${ic('sunset')}</button>
    ${b('palette', 'search', 'Search and commands (Ctrl+K)', `aria-pressed="${S.modal === 'palette'}"`)}`;
  if (part === 'icons') return icons;
  return `<div class="tb-actions" role="toolbar" aria-label="Quick actions">
    ${live ? timerPill() : b('qt-toggle', 'timer', 'Quick timer', `aria-pressed="${qtOpen()}"`)}
    ${part === 'all' ? icons : ''}</div>`;
}
// R11: the right sidebar toggle sits beside the window buttons, with a short divider
function inspToggle() {
  const inspOk = UI.view === 'notes', inspOn = inspOk && UI.inspector !== 'hidden';
  return `<button class="top-btn" data-act="inspector" ${inspOk ? `aria-expanded="${inspOn}" aria-controls="right-sidebar"` : 'aria-disabled="true"'} aria-label="${inspOn ? 'Hide' : 'Show'} right sidebar" title="${inspOk ? (inspOn ? 'Hide' : 'Show') + ' right sidebar' : 'No right sidebar in this view'}">${ic('panel')}</button>`;
}
// The frameless window's buttons call the backend (api.py); in a browser (dev) they only change the drawing
function winAction(v) {
  const a = api();
  if (v === 'min') { if (a) a.window_minimize(); else toast('Minimise (in the app)'); }
  if (v === 'max') { if (a) a.window_toggle_maximize().then(m => setMaximised(!!m)); else setMaximised(!S.max); }
  if (v === 'close') { if (a) a.window_close(); else toast('Close (in the app)'); }
}
function setMaximised(on) { if (S.max === on) return; S.max = on; document.body.classList.toggle('is-maximised', on); renderAll(); }
window.nvWindowState = on => setMaximised(!!on);   // main.py calls this when Windows maximises or restores the window (Win+Up, Aero snap…)

/* ---- Workspace tabs: one per open note or view, like Obsidian (R7) ---- */
const tabView = t => t.kind === 'note' ? 'notes' : t.kind === 'view' ? t.ref : t.kind;
function tabTitle(t) {
  if (t.kind === 'note') return D.notes.find(n => n.id === t.ref)?.title || 'No note open';
  return VIEW_LABEL[tabView(t)];
}
const mkTab = (kind, ref) => ({ id: 'tab-' + (++S.tabSeq), kind, ref });
function tabFor(view) {
  if (view === 'notes') return mkTab('note', S.noteId || D.notes[0]?.id || null);
  if (view === 'newtab') return mkTab(view, null);
  return mkTab('view', view);
}
function defaultTabs(kind) {
  S.tabSeq = 0;
  if (kind === 'empty') return [];
  const t = [...D.notes.slice(0, 2).map(n => mkTab('note', n.id)), mkTab('view', 'tasks'), mkTab('view', 'timer')];   // Phase 2: a real vault can have fewer than two notes
  if (kind === 'stress') D.notes.slice(2, 13).forEach(n => t.push(mkTab('note', n.id)));
  return t;
}
// Keeps the active tab in step with the view: picking a view shows its tab; a rail view with no tab shows without opening one (R9)
const RAIL_VIEWS = ['tasks', 'timer', 'history'];
function syncTabs() {
  if (S.offTab) { if (S.offTab === UI.view) return; S.offTab = null; }
  const at = S.tabs.find(t => t.id === S.activeTab);
  if (at && tabView(at) === UI.view && (at.kind !== 'note' || at.ref === (S.noteId ?? null))) return;
  let t;
  // R10: if what you open is already in a tab, go to that tab and drop the empty New tab (no duplicate tabs)
  const open = at && at.kind === 'newtab' && UI.view !== 'newtab' && S.tabs.find(x => x !== at && tabView(x) === UI.view && (x.kind !== 'note' || x.ref === (S.noteId ?? null)));
  if (open) { S.tabs.splice(S.tabs.indexOf(at), 1); t = open; }
  else if (at && at.kind === 'newtab' && UI.view !== 'newtab') { Object.assign(at, tabFor(UI.view), { id: at.id }); t = at; }   // a New tab turns into what you open in it
  else if (UI.view === 'notes') {
    t = S.tabs.find(x => x.kind === 'note' && x.ref === (S.noteId ?? null));
    if (!t && at?.kind === 'note') { at.ref = S.noteId ?? null; t = at; }   // opening a file replaces the note in the current tab
  } else t = S.tabs.find(x => tabView(x) === UI.view);
  if (!t && RAIL_VIEWS.includes(UI.view) && !S.forceTab) { S.offTab = UI.view; return; }
  S.forceTab = false;
  if (!t) { t = tabFor(UI.view); const i = S.tabs.indexOf(at); S.tabs.splice(i < 0 ? S.tabs.length : i + 1, 0, t); }
  S.activeTab = t.id;
  if (t.kind === 'note') S.noteId = t.ref;
}
function activateTab(id, focus) {
  const t = S.tabs.find(x => x.id === id); if (!t) return;
  S.activeTab = id; S.menu = false; S.offTab = null;
  if (t.kind === 'note') S.noteId = t.ref;
  if (focus) S.focus = { sel: `[data-wstab="${id}"]` };
  if (UI.view !== tabView(t)) setUI('view', tabView(t)); else renderAll();
}
function closeTab(id) {
  const i = S.tabs.findIndex(x => x.id === id); if (i < 0) return;
  const was = S.activeTab === id; S.tabs.splice(i, 1);
  if (!S.tabs.length) S.tabs.push(mkTab('newtab', null));
  if (was) activateTab((S.tabs[i] || S.tabs[i - 1]).id, true); else renderAll();
}
function newTab() {
  const t = mkTab('newtab', null), i = S.tabs.findIndex(x => x.id === S.activeTab);
  S.tabs.splice(i + 1, 0, t); activateTab(t.id, true);
}
function renderTabs() {
  return `<div class="tabstrip" role="tablist" aria-label="Open tabs">${S.tabs.map(t => {
    const on = t.id === S.activeTab && !S.offTab, title = tabTitle(t);
    return `<div class="ws-tab" role="tab" tabindex="${on || (S.offTab && t === S.tabs[0]) ? 0 : -1}" aria-selected="${on}" data-wstab="${t.id}" draggable="true" title="${esc(title)}"><span class="ws-tab-icon" aria-hidden="true">${ic(VIEW_ICON[tabView(t)])}</span><span class="ws-tab-title">${esc(title)}</span><button class="ws-tab-close" data-act="tab-close" data-v="${t.id}" tabindex="-1" aria-label="Close ${esc(title)}" title="Close tab (Ctrl+W)">${ic('x')}</button></div>`;
  }).join('')}</div>${tabTools()}`;
}
// R10: tabs that don't fit fade at the edge they're hidden behind, and the tab list button appears
function tabOverflow() {
  app.querySelectorAll('.tabstrip').forEach(strip => {
    const over = strip.scrollWidth > strip.clientWidth + 1, x = strip.scrollLeft;
    strip.classList.toggle('fade-l', over && x > 1); strip.classList.toggle('fade-r', over && x + strip.clientWidth < strip.scrollWidth - 1);
    strip.nextElementSibling?.classList.toggle('is-overflow', over || !!S.tabList);
  });
}
function tabTools() {
  const on = id => id === S.activeTab && !S.offTab;
  return `<div class="tab-tools"><button class="icon-btn icon-btn--sm tab-list" data-act="tab-list" aria-haspopup="menu" aria-expanded="${!!S.tabList}" aria-label="All open tabs (${S.tabs.length})" title="All open tabs">${ic('down')}</button><button class="icon-btn icon-btn--sm tab-new" data-act="tab-new" aria-label="New tab" title="New tab (Ctrl+T)">${ic('plus')}</button>
    ${S.tabList ? `<div class="menu card menu--tabs" role="menu" aria-label="Open tabs">${S.tabs.map(t => `<button class="menu-item" role="menuitemradio" aria-checked="${on(t.id)}" data-act="tab-pick" data-v="${t.id}">${ic(VIEW_ICON[tabView(t)])}<span class="truncate">${esc(tabTitle(t))}</span></button>`).join('')}</div>` : ''}</div>`;
}

/* ---- "What was I doing?" trail: the last four places you went; every place is also kept for the Timeline's "Where I was" (R9) ---- */
function recordVisit(item) {
  S.visits ||= []; const last = S.visits[S.visits.length - 1]; if (last?.key === item.key) { last.label = item.label; return; }
  S.visits.push({ ...item, at: Date.now() }); if (S.visits.length > 40) S.visits.shift();
}
const agoText = t => { const m = Math.round((Date.now() - t) / 60000); return m < 1 ? 'Just now' : m < 60 ? m + ' min ago' : Math.round(m / 60) + ' h ago'; };
function pushTrail(item) {
  recordVisit(item);
  if (S.trail[S.trail.length - 1]?.key === item.key) { S.trail[S.trail.length - 1] = item; return; }
  S.trail = S.trail.filter(x => x.key !== item.key); S.trail.push(item); if (S.trail.length > 4) S.trail.shift();
}
const tabTrail = t => ({ key: 'tab:' + t.kind + ':' + (t.ref ?? ''), label: tabTitle(t), icon: VIEW_ICON[tabView(t)], go: { kind: t.kind, ref: t.ref } });
function seedTrail() {
  S.trail = []; S.visits = []; const n = D.notes[1] || D.notes[0]; if (!n) return;
  pushTrail({ key: 'tab:note:' + n.id, label: n.title, icon: 'file', go: { kind: 'note', ref: n.id } });
}
function followTrail(i, list = S.trail) {
  const g = list[i]?.go; if (!g) return;
  if (g.widget) { setUI('widgets', 'timer'); return; }
  if (g.sticky) { showSticky(g.sticky); return; }   // Phase 6A
  const t = S.tabs.find(x => x.kind === g.kind && x.ref === g.ref);
  if (t) { activateTab(t.id); return; }
  if (g.kind === 'note' && D.notes.find(n => n.id === g.ref)) { openNote(g.ref, true, true); return; }
  setUI('view', g.kind === 'view' ? g.ref : g.kind);
}

/* ---- Status bar (R15, lean): the Timeline trail; save status only while saving or with news; words and model status ---- */
const chars = n => n.md.replace('{{tasks}}', taskLines(n).map(t => t.title).join(' ')).replace(/[#>*`\[\]]/g, '').replace(/\s+/g, ' ').trim().length;
const readMins = w => Math.max(1, Math.round(w / 200));
function renderStatus() {
  const n = note(), isNote = UI.view === 'notes' && n;
  const steps = S.trail.map((x, i) => { const age = S.trail.length - 1 - i;
    return `<span class="trail-step" data-age="${age}">${i ? `<span class="trail-sep" aria-hidden="true">${ic('right')}</span>` : ''}${age === 0
      ? `<button class="trail-pill" data-act="trail" data-v="${i}" aria-current="true" title="You are here: ${esc(x.label)}">${ic(x.icon)}<span>${esc(x.label)}</span></button>`
      : `<button class="trail-link" data-act="trail" data-v="${i}" title="Back to ${esc(x.label)}">${esc(x.label)}</button>`}</span>`; }).join('');
  const trail = `<nav class="trail" aria-label="What was I doing?"><button class="eyebrow trail-label" data-act="trail-timeline" title="Everywhere you've been today, in the Timeline">Timeline</button>${steps || '<span class="list-item-sub">Nothing yet</span>'}</nav>`;
  const other = { timer: (tS => `${fmtDur(tS.todaySec)} today · ${tS.today.length} sessions`)(timerStats()), tasks: `${D.tasks.filter(t => t.done).length}/${D.tasks.length} tasks done`, history: `${D.events.length} events`, newtab: `${S.tabs.length} tabs open` }[UI.view] || '—';
  const w = isNote ? words(n) : 0;
  const tele = isNote ? `<span id="word-count-display" class="num">${w} words</span><span id="char-count-display" class="num status-extra">${chars(n)} characters</span><span id="read-time-display" class="num status-extra">${readMins(w)} min read</span>` : `<span id="word-count-display" class="num">${other}</span>`;
  const dot = UI.state === 'error' ? 'is-error' : UI.state === 'saving' || UI.state === 'loading' ? 'is-busy' : '';
  let text = UI.state === 'error' ? 'Save failed' : UI.state === 'saving' ? 'Saving…' : UI.state === 'loading' ? 'Opening vault…' : S.status;
  { const cur = document.getElementById('status-text'), shown = cur && !cur.closest('[hidden]') ? cur.textContent : null;   // Build M · QC 96: the last message keeps its 0.7 s
    if (!dot && shown && text !== shown && text !== 'System ready' && Date.now() - (status.at || 0) < STATUS_HOLD.gap) { text = shown; status.soon(); }
    else if (text !== shown && text !== 'System ready') status.at = Date.now(); }
  const model = setupDlLink() + aiStatusLink();   // Build B: the model in use (render-ai.js); Build D: the setup's downloads (setup.js)
  // Build M · QC 96 (feedback: "a flashing status bar text … next to the word count"): the message has its own fixed-width column
  // before the counts, so a message coming or going never moves the word count
  return `<footer class="status-bar">${trail}<span class="status-msg"><span class="status-save"${!dot && S.status === 'System ready' ? ' hidden' : ''}${text !== 'System ready' ? ` title="${esc(text)}"` : ''}><span class="status-dot ${dot}"></span><span id="status-text">${esc(text)}</span>${taskUndoBtn()}</span></span><span class="status-right">${popStatus()}${tele}${model}</span></footer>`;   // popStatus: Build H, what's popped out; taskUndoBtn: Build I, Undo after a task's Delete (render-tasks.js)
}

/* ---- R8's two-pane split was here: Build M · R44 replaced it with the pane grid in panes.js (modules dock by dragging their rail icon) ---- */

/* ==== Build M (the coordinator, from the full sweep: "clipped trail" at 1366): the trail never clips. Its steps shrink, but the
   "Timeline" label, the arrows and the current place can't, so a narrow column (the status bar's right side grown, say by a download)
   cut it off. After each drawing, and when its width changes: the oldest steps go first, then the "Timeline" label, then the current
   place shortens with "…". Every step keeps its full words on hover (its title) and in the Timeline ==== */
function trailFit() {
  app.querySelectorAll('nav.trail').forEach(t => {
    t.querySelectorAll('[data-fit-hide], .is-fit-first').forEach(x => { x.removeAttribute('data-fit-hide'); x.classList.remove('is-fit-first'); }); t.classList.remove('is-tight');
    const over = () => t.scrollWidth > t.clientWidth + 1; if (!t.clientWidth || !over()) return;
    const steps = [...t.querySelectorAll(':scope > .trail-step')].filter(s => getComputedStyle(s).display !== 'none');
    for (const s of steps.slice(0, -1)) { s.setAttribute('data-fit-hide', ''); if (!over()) break; }   // the oldest first
    if (over()) t.querySelector(':scope > .trail-label')?.setAttribute('data-fit-hide', '');
    if (over()) t.classList.add('is-tight');   // the current place's name shortens with "…"
    if (t.querySelector(':scope > .trail-label[data-fit-hide]')) [...t.querySelectorAll(':scope > .trail-step')].find(s => !s.hasAttribute('data-fit-hide') && getComputedStyle(s).display !== 'none')?.classList.add('is-fit-first');   // alone, no arrow before it
  });
}
const TRAIL_RO = typeof ResizeObserver === 'function' ? new ResizeObserver(() => trailFit()) : null;
addEventListener('DOMContentLoaded', () => {   // after every file has wrapped afterRender
  const trailAfter0 = afterRender;
  afterRender = function () { trailAfter0.apply(this, arguments); trailFit(); app.querySelectorAll('nav.trail').forEach(b => TRAIL_RO?.observe(b)); };   // its grid column sets its width, never its steps   // eslint-disable-line no-global-assign
});
/* ==== end Build M · trail fit ==== */
