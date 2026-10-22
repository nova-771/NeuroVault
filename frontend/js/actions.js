/* Every click, key, drag and input in the app, the frameless window's edges, and boot.
   Extracted from design/vault-notes-mockups.html (R20). Not-yet-built controls carry data-soon and are ignored here. */
'use strict';
const app = document.getElementById('app');
const CHECK = new URLSearchParams(location.search).get('check') === '1';

app.addEventListener('click', e => {
  const t = e.target.closest('[data-act]'); const fmt = e.target.closest('[data-fmt]'), ta = t?.dataset.act, newTabKey = e.ctrlKey || e.metaKey;
  if (e.target.closest('[data-soon]')) return;   // coming soon: the tooltip says so, the click does nothing
  // R7: the editor's pickers close on a click anywhere else
  if (S.edPop && !e.target.closest('.ed-pop') && ta !== 'ed-pop') { S.edPop = null; if (!t && !fmt) { renderAll(); return; } }
  if (fmt) { if (S.edMore) { S.edMore = false; app.querySelector('.ed-more-menu')?.remove(); app.querySelector('[data-act="ed-more"]')?.setAttribute('aria-expanded', 'false'); } doFormat(fmt.dataset.fmt); return; }
  const wiki = e.target.closest('[data-wiki]');
  if (wiki) { const n = wikiTarget(wiki.dataset.wiki); if (n) openNote(n.id, true, newTabKey); else toast(`No note called "${wiki.dataset.wiki.split('|')[0].trim()}" yet`); return; }
  // Phase 2: links in a note open in the browser with Ctrl+click (a plain click puts the caret there, as in Word); #tags search the vault
  const link = e.target.closest('.doc a[href], .props a[href]');   // .props: bug fix 2026-10-16, the Properties panel's links open with a plain click
  if (link) { e.preventDefault(); const editing = !!link.closest('.doc')?.isContentEditable;
    if (editing && !newTabKey) { status('Ctrl+click to open the link'); paintSave(); return; }
    const href = link.getAttribute('href'); if (!/^(https?:|mailto:)/i.test(href)) { toast('Only web and email links open from a note'); return; }
    if (api()) nv('open_external', href).then(r => { if (failed(r)) toast(r.message); }); else window.open(href, '_blank', 'noopener'); return; }
  const tagEl = e.target.closest('.doc [data-tag]');
  if (tagEl && (newTabKey || !tagEl.closest('.doc').isContentEditable)) { S.search = '#' + tagEl.dataset.tag; S.project = 'All'; S.side = true; renderAll(); return; }
  const wt = e.target.closest('[data-wstab]');
  if (wt && !t) { activateTab(wt.dataset.wstab, true); return; }
  const row = e.target.closest('[data-tree]');   // R6: folder tree rows
  if (row && !t) { treeActivate(row.dataset.tree, row.dataset.v, newTabKey); return; }
  if (!t) { if (!e.target.closest('.menu, .popover') && (S.menu || S.ctx || S.sortMenu || S.tabList || S.edMore)) {   // Build L: a click inside a menu (between its items) keeps it open
    S.menu = false; S.ctx = null; S.sortMenu = false; S.tabList = false; S.edMore = false; renderAll(); } return; }
  if (S.ctx && !t.closest('.menu--context')) S.ctx = null;
  if (S.sortMenu && !t.closest('.side-actions')) S.sortMenu = false;
  if (S.tabList && !t.closest('.tab-tools')) S.tabList = false;
  if (S.edMore && !t.closest('.ed-more-wrap')) S.edMore = false;
  const v = t.dataset.v, act = t.dataset.act;
  if (t.tagName === 'INPUT' && t.type !== 'checkbox') return;
  if (popAct(act, v, t)) return;   // Build H: pop out, back in, keep on top, the list, the minute sets (popout.js)
  switch (act) {
    case 'view': S.menu = false; S.forceTab = newTabKey; if (S.forceTab && UI.view === v) { S.forceTab = false; break; } setUI('view', v); break;   // R8: Ctrl+click a rail button still opens a tab
    case 'theme-toggle': setReader('theme', isDark() ? READER.lastLight || 'cream' : 'obsidian'); renderAll(); break;
    case 'note': openNote(v, true, newTabKey); break;
    case 'back': if (S.histIx > 0) { S.histIx--; openNote(S.hist[S.histIx], false); } break;
    case 'fwd': if (S.histIx < S.hist.length - 1) { S.histIx++; openNote(S.hist[S.histIx], false); } break;
    case 'clear-search': S.search = ''; S.project = 'All'; renderAll(); break;
    case 'plus':
      if (UI.view === 'tasks') { document.getElementById('new-task-title')?.focus(); }
      else if (UI.view === 'history') { S.range = 'All'; S.type = 'All'; renderAll(); }
      else if (UI.view === 'timer') { S.focus = { sel: '#new-project-name' }; UI.tpage = 'projects'; renderAll(); }
      else newItem('note');
      break;
    case 'task-filter': S.taskFilter = v; renderAll(); break;
    /* R6: file explorer, panels, settings, window */
    case 'side-toggle': S.side = !S.side; renderAll(); break;
    case 'tree-new-note': newItem('note'); break;
    case 'tree-new-folder': newItem('folder'); break;
    case 'tree-sort': S.sortMenu = !S.sortMenu; renderAll(); if (S.sortMenu) app.querySelector('.side-actions .menu-item')?.focus(); break;
    case 'sort': S.sort = v; S.sortMenu = false; if (VAULT.live) nv('set_tree_sort', v); status('Sorted by ' + SORTS.find(x => x[0] === v)[1]); S.focus = { sel: '[data-act="tree-sort"]' }; renderAll(); break;
    case 'tree-fold': if (S.open.size) S.open.clear(); else [...D.projects.map(x => x.id), ...D.folders.map(f => f.id)].forEach(id => S.open.add(id)); renderAll(); break;
    case 'ctx-new-note': { const c = S.ctx; S.ctx = null; newItem('note', c.kind === 'folder' ? c.id : null); break; }
    case 'ctx-new-folder': { const c = S.ctx; S.ctx = null; newItem('folder', c.kind === 'root' ? '__root' : c.id); break; }
    case 'ctx-rename': { const c = S.ctx; S.ctx = null; startRename(c.kind, c.id); break; }
    case 'ctx-open': { const c = S.ctx; S.ctx = null; treeActivate(c.kind, c.id); break; }
    case 'ctx-open-tab': { const c = S.ctx; S.ctx = null; treeActivate(c.kind, c.id, true); break; }
    case 'ctx-move': { const c = S.ctx; S.ctx = null; openMove(c.kind, c.id); break; }
    case 'move-open': S.menu = false; openMove(t.dataset.kind, v); break;
    case 'crumb-folder': S.side = true; ancestors(v).forEach(f => S.open.add(f)); S.sel = { kind: 'folder', id: v }; S.scrollTo = v; S.search = ''; S.focus = { sel: `[data-tree][data-v="${v}"]` }; renderAll(); break;
    case 'move-to': moveItem(S.moveItem.kind, S.moveItem.id, v === '__root' ? null : v, true); break;
    case 'ctx-delete': { const c = S.ctx; S.ctx = null; askDelete(c.kind, c.id); break; }
    case 'settings': openSettings(); break;
    case 'set-sec': S.setSec = v; S.focus = { sel: `.settings-nav [data-v="${v}"]` }; renderAll(); break;
    case 'set-reader': setReader(t.dataset.k, v); S.focus = { sel: `[data-act="set-reader"][data-k="${t.dataset.k}"][data-v="${v}"]` }; renderAll(); break;
    case 'set-open': closeModal(true); openSettings(v); break;
    case 'win': if (v === 'close') Promise.all([flushSaves(), flushStickies()]).then(() => winAction(v)); else winAction(v); break;   // Phase 2: unsaved edits go first (Phase 6A: sticky notes too)
    /* R5: Timer */
    case 'tpage': S.menu = false; UI.tpage = v; if (UI.view !== 'timer') setUI('view', 'timer'); else renderAll(); break;
    case 'tmode': T.mode = v; renderAll(); break;
    case 'tproj': T.projectId = v; renderAll(); break;
    case 'tdur': T.dur = +v; T.custom = ''; renderAll(); break;
    /* Phase 4: each step also goes to the backend's running-session record (tcall / startSession / logSession, render-timer.js) */
    case 'tstart': { const mins = T.custom ? +T.custom : T.dur;
      status(`Started ${T.mode === 'planned' ? mins + ' min' : 'a stopwatch'} on ${proj(T.projectId).name}`); startSession(T.mode, mins, T.projectId); break; }
    case 'tpause': T.prev = UI.tstate === 'checkin' ? (T.mode === 'planned' ? (isOver() ? 'overtime' : 'running') : 'stopwatch') : UI.tstate; goTimer('pausepick', '.timer-panel .pick, .qt-panel .pick'); break;   // Build H: .qt-panel, the Card's
    case 'tcancel-pause': goTimer(T.prev, '#timer-card [data-act="tpause"], .widget.qt [data-act="tpause"]'); break;
    case 'treason': T.pauseReason = v; T.pauseElapsed = 0; status('Paused · ' + v); goTimer('paused', '[data-act="tresume"]'); tcall(a => a.update_running_session('pause', v)); break;
    case 'tresume': T.pauses.push({ category: T.pauseReason, duration_seconds: T.pauseElapsed }); status(`Resumed after ${fmtDur(T.pauseElapsed)}`);
      goTimer(T.prev === 'pausepick' ? 'running' : T.prev, '[data-act="tpause"], [data-act="qt-pause"]'); tcall(a => a.update_running_session('resume')); break;
    case 'tstop': if (UI.tstate === 'paused') T.pauses.push({ category: T.pauseReason, duration_seconds: T.pauseElapsed });
      goTimer('rate', '#timer-card [data-act="trate"][data-k="energy"][aria-pressed="true"], .qt-panel [data-act="trate"][data-k="energy"][aria-pressed="true"]'); tcall(a => a.update_running_session('stop')); break;
    case 'tcheckin': { const inp = [document.getElementById('qt-milestone'), document.getElementById('milestone-input')].find(x => x?.value.trim()) || document.getElementById('milestone-input'), text = v === 'save' && inp?.value.trim();   // Build H: the Card's field too
      if (text) { T.milestones.push({ note: text, elapsed_seconds: T.elapsed }); toast('Check-in saved'); tcall(a => a.update_running_session('checkin', text)); }
      goTimer(T.prev && T.prev !== 'checkin' ? T.prev : T.mode === 'planned' ? (isOver() ? 'overtime' : 'running') : 'stopwatch', '#timer-card [data-act="tpause"], .widget.qt [data-act="tpause"]'); break; }
    case 'trate': T[t.dataset.k] = +v; S.focus = { sel: `[data-act="trate"][data-k="${t.dataset.k}"][data-v="${v}"]` }; renderAll(); break;
    case 'tlog': logSession(v === 'rate'); break;
    case 'taway': awayAnswer(v); renderAll(); break;
    case 'taway-set': setTset('away', v); status(v === 'ask' ? 'It asks again next time' : `The closed time counts as ${v === 'pause' ? 'a pause' : 'work'}, without asking`); S.focus = { sel: `[data-act="taway-set"][data-v="${v}"]` }; renderAll(); break;   // Build L   // Build L: render-timer.js, with "Always do this and don't ask"
    case 'tproj-add': addProject(); break;
    case 'tproj-delete': if (t.getAttribute('aria-disabled') === 'true') break; deleteProject(v); break;   // Build L: no confirm, Undo for 10 seconds
    case 'toggle': setTset(v, !D.tset[v]); status('Setting saved'); renderAll(); break;
    case 'tnotice': toast(v); break;
    case 'tsound-preview': loadCustomSound().then(() => playAlert()); status('Playing ' + (D.tset.custom_sound ? D.tset.custom_sound.split(/[\\/]/).pop() : D.tset.sound_name)); break;
    case 'tsound-file': if (!api()) { toast('Opens a file picker for a .wav or .mp3'); break; }
      api().browse_sound_file().then(f => { if (!f) return; setTset('custom_sound', f); toast('Alert sound: ' + fileName(f)); loadCustomSound(); renderAll(); }).catch(() => {}); break;   // Phase 5: shown in the list, read ahead
    case 'tvault-browse': if (!api()) { toast('Opens a folder picker'); break; }
      api().browse_vault_folder().then(f => { if (!f) return; setTset('vault', f); D.tset.vaultStatus = null; renderAll(); }).catch(() => {}); break;
    case 'tvault-test': if (!D.live) { D.tset.vaultStatus = /^[a-z]:\\/i.test(D.tset.vault) ? 'ok' : 'fail'; renderAll(); break; }
      api().test_vault_connection().then(r => { D.tset.vaultStatus = r?.ok ? 'ok' : 'fail'; status(r?.message || ''); renderAll(); }).catch(() => {}); break;
    case 'texport': if (!D.live) { toast(`Exported ${D.sessions.length.toLocaleString('en-GB')} sessions to CSV`); break; }
      api().export_csv().then(r => { if (r?.message && r.message !== 'Cancelled.') toast(r.message); }).catch(() => {}); break;
    /* Phase 3: Tasks write back through store.js (setTaskDone, addTask, cycleEnergy, the step calls) */
    case 'task-done': { const tk = taskById(v); if (!tk) break; setTaskDone(tk, t.checked); status(`${tk.done ? 'Completed' : 'Reopened'} "${tk.title.slice(0, 40)}" · .md and database updated`); renderAll(); break; }
    case 'add-task': { const inp = document.getElementById('new-task-title'), title = inp.value.trim(); if (!title) { inp.focus(); break; }
      const val = id => document.getElementById(id).value, d = S.taskDraft;
      const where = val('new-task-note'), due = draftDue();   // Build I: priority, energy and due are the quick add's choices (render-tasks.js)
      addTask({ title, project: isProj(where) ? where : null, noteId: isProj(where) ? null : where, priority: d.priority, energy: d.energy, due }).then(tk => { if (tk) status(`Added to ${tk.noteId ? `"${(taskNote(tk)?.title || 'the note').slice(0, 32)}"` : 'the board'} · ${dueText(due)} · ${d.priority} priority · ${ENERGY[d.energy][1]}`); });
      d.title = ''; S.focus = { sel: '#new-task-title' }; renderAll(); break; }
    case 'step-add': S.stepAdd = v; S.focus = { sel: '#new-step-text' }; renderAll(); break;
    case 'step-cancel': S.stepAdd = null; renderAll(); break;
    case 'step-save': saveStepDraft(v); break;
    case 'step-delete': { const [id, i] = v.split(':'), tk = taskById(id); if (!tk) break; const st = tk.steps?.[+i]; deleteStep(tk, +i); status(`Removed the step "${(st?.t || '').slice(0, 40)}"`); renderAll(); break; }
    case 'range': S.range = v; renderAll(); break;
    case 'type': S.type = v; renderAll(); break;
    case 'tab': S.tab = v; renderAll(); break;
    case 'jump': { const hs = app.querySelectorAll('.doc h1, .doc h2, .doc h3'); const h = hs[+v]; if (h) { h.scrollIntoView({ block: 'start', behavior: 'smooth' }); h.classList.add('is-flash'); setTimeout(() => h.classList.remove('is-flash'), 900); } break; }
    case 'vid-play': playVideo(v); break;   // 2026-10-16: video embeds
    case 'tag': S.search = '#' + v; S.project = 'All'; S.side = true; setUI('view', 'notes'); break;
    /* R8 */
    case 'tag-remove': { const n = note(); if (n) { n.tags = n.tags.filter(x => x !== v); noteEdited(n); status(`Removed #${v}`); S.focus = { sel: '#note-tags-input' }; renderAll(); } break; }
    // split-right, tab-split and the panes' own actions: Build M · R44, panes.js
    case 'tab-close-ctx': { const c = S.ctx; S.ctx = null; closeTab(c.id); break; }
    case 'tab-close-others': { const c = S.ctx; S.ctx = null; S.tabs = S.tabs.filter(x => x.id === c.id); activateTab(c.id, true); break; }
    case 'inspector': { if (t.getAttribute('aria-disabled') === 'true') break; const insp = app.querySelector('.inspector'); const visible = insp && getComputedStyle(insp).display !== 'none'; setUI('inspector', visible ? 'hidden' : 'shown'); break; }
    case 'menu': S.menu = !S.menu; renderAll(); break;
    case 'sync': S.menu = false; S.modal = 'sync'; renderAll(); break;
    case 'delete': S.menu = false; if (note()) askDelete('note', note().id); break;   // Phase 2: one delete for the menu and the explorer (Build L: with Undo, no dialog)
    case 'close': closeModal(); break;
    case 'close-bg': if (e.target === t) closeModal(); break;
    case 'export': { S.menu = false; const n = note(); if (!n) break; syncDoc(n); const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([noteToMd(n)], { type: 'text/markdown' })); a.download = slug(n.title) + '.md'; a.click(); toast('Exported ' + slug(n.title) + '.md'); break; }
    case 'mode': S.mode = v; if (UI.state === 'parser' && v === 'raw') UI.state = 'ready'; renderAll(); break;
    case 'save': save(); break;
    /* R7: tabs, trail, window bar, quick timer, comfort, editor pickers */
    case 'tab-close': closeTab(v); break;
    case 'tab-new': S.tabList = false; newTab(); break;
    case 'tab-list': S.tabList = !S.tabList; S.focus = { sel: S.tabList ? '.menu--tabs [aria-checked="true"]' : '[data-act="tab-list"]' }; renderAll(); break;
    case 'tab-pick': S.tabList = false; activateTab(v, true); break;
    case 'tab-close-current': closeTab(S.activeTab); break;
    case 'trail': followTrail(+v); break;
    case 'trail-timeline': S.range = 'Today'; S.type = 'Where I was'; setUI('view', 'history'); break;
    case 'visit': followTrail(+v, S.visits); break;
    case 'palette': openPalette(); break;
    case 'pal-run': runPalette(+v); break;
    case 'qt-toggle': if (timerOut()) { nv('pop_show', 'timer'); break; }   // Build H: the pill finds a popped-out timer
      if (!qtOpen()) pushTrail({ key: 'qt', label: 'Quick timer', icon: 'timer', go: { widget: 'qt' } }); setUI('widgets', qtOpen() ? 'none' : 'timer'); break;
    case 'qt-open': setUI('widgets', 'timer'); break;
    case 'qt-close': setUI('widgets', 'none'); break;
    case 'qt-dur': S.qtDur = +v; renderAll(); break;
    case 'qt-start': { const tk = T.link?.startsWith('task:') ? D.tasks.find(x => x.id === T.link.slice(5)) : null, nn = tk && D.notes.find(x => x.id === tk.noteId), pj = (nn && rootProject(nn.folder)) || proj(T.projectId) || D.projects[0];
      status(`Quick timer: ${S.qtDur} min on ${pj.name}`); startSession('planned', S.qtDur, pj.id, tk?.id); break; }
    case 'qt-pause': T.prev = UI.tstate === 'checkin' || UI.tstate === 'pausepick' ? (T.mode === 'planned' ? (isOver() ? 'overtime' : 'running') : 'stopwatch') : UI.tstate; T.pauseReason = 'Quick pause'; T.pauseElapsed = 0; status('Paused');
      goTimer('paused', '[data-act="tresume"]'); tcall(a => a.update_running_session('pause', 'Quick pause')); break;
    case 'tpause-toggle': if (UI.tstate === 'paused') fire('tresume'); else if (TIMER_ACTIVE.includes(UI.tstate)) fire('qt-pause'); break;
    case 'sound': setSound(v); setSoundscape({ kind: S.sound.kind }); status(v === 'off' ? 'Sound off' : `Playing ${v} ${v === 'rain' ? '' : 'noise'}`.trim()); renderAll(); break;
    /* Phase 6A: sticky notes and the brain dump (capture.js) */
    case 'sticky-new': newSticky(); break;
    case 'sticky-close': closeSticky(v); break;
    case 'sticky-menu': S.stickyMenu = S.stickyMenu === v ? null : v; renderAll(); if (S.stickyMenu) app.querySelector('.sticky .menu .menu-item')?.focus(); break;
    case 'sticky-colour': { const [id, c] = v.split(':'); stickyColour(id, c); break; }
    case 'sticky-promote': stickyPromote(v); break;
    case 'sticky-append': case 'sticky-attach': openStickyPick(act, v); break;
    case 'sticky-pick': stickyPick(v); break;
    case 'sticky-task': stickyTask(v); break;
    case 'dump': if (S.modal === 'dump') closeModal(); else openDump(); break;
    /* end Phase 6A */
    case 'nudge': setUI('widgets', 'timer'); toast(v === 'done' ? 'Nice. Back to it when you are ready' : 'I\'ll check in again in 15 minutes'); break;
    case 'ruler': setComfort('ruler', !S.a11y.ruler); status(S.a11y.ruler ? 'Reading ruler on' : 'Reading ruler off'); renderAll(); break;
    case 'zen': S.menu = false; setUI('zen', UI.zen === 'on' ? 'off' : 'on'); break;
    case 'a11y-toggle': setComfort(v, !S.a11y[v]); if (v === 'spell' || v === 'homophones') D.notes.forEach(n => { n.html = null; }); status('Setting saved'); renderAll(); break;
    case 'a11y-set': setComfort(t.dataset.k, isNaN(+v) ? v : +v); status('Setting saved'); renderAll(); break;
    case 'ed-pop': S.edPop = S.edPop === v ? null : v; S.edMore = false; S.gridHover = [0, 0]; renderAll(); break;
    case 'ed-more': S.edMore = !S.edMore; S.edPop = null; renderAll(); break;
    case 'table-insert': S.edPop = null; doFormat('table', [+t.dataset.r, +t.dataset.c]); status(`Inserted a ${t.dataset.r} × ${t.dataset.c} table`); renderAll(); break;
    case 'table-beautify': { S.edPop = null; const doc = app.querySelector('.doc'), n0 = doc ? doc.querySelectorAll('table').length : 0; doc?.querySelectorAll('table').forEach(x => x.classList.add('is-zebra')); if (doc && n0) noteEdited(note(), true);
      toast(n0 ? `Tidied ${n0} table${n0 > 1 ? 's' : ''}: columns lined up in the .md, rows striped` : 'No tables in this note yet'); break; }
    case 'fmt-hl': S.edPop = null; doFormat('hl', v); renderAll(); break;
    case 'fmt-tc': S.edPop = null; doFormat('tc', v); renderAll(); break;
    case 'fmt-code': S.edPop = null; doFormat('codeblock', v); renderAll(); break;
    case 'fmt': doFormat(v); break;
    case 'link-apply': edLinkApply(); break;   // Editor QC: the link box
    case 'link-remove': edLinkApply(true); break;
    case 'energy': { const tk = taskById(v); if (!tk) break; cycleEnergy(tk); status(`Energy: ${ENERGY[tk.energy][1]}`); S.focus = { sel: `[data-act="energy"][data-v="${v}"]` }; renderAll(); break; }   // Phase 3
    case 'step-done': { const [id, i] = v.split(':'), tk = taskById(id); if (!tk) break; setStepDone(tk, +i, t.checked); renderAll(); break; }   // Phase 3
    case 'step-timer': { const [id, i] = v.split(':'), tk = D.tasks.find(x => x.id === id), st = tk.steps[+i], nn = D.notes.find(x => x.id === tk.noteId), pj = (nn && rootProject(nn.folder)) || D.projects[0];
      T.link = 'task:' + id; S.qtDur = st.m || S.qtDur; status(`${S.qtDur}-minute timer: ${st.t}`);
      if (!qtOpen()) UI.widgets = 'timer'; startSession('planned', S.qtDur, pj.id, id); break; }
  }
});
app.addEventListener('change', e => {
  const t = e.target, act = t.dataset.act;
  if (act === 'tsound') { setTset('sound_name', t.value); if (D.tset.custom_sound) setTset('custom_sound', ''); status('Sound set to ' + t.value); renderAll(); }   // Phase 4: saved in config.json
  if (act === 'trange') { setTset(t.dataset.k, +t.value); status('Setting saved'); }
  if (act === 'tvault') { setTset('vault', t.value.trim()); D.tset.vaultStatus = null; renderAll(); }
  if (act === 'qt-link') { T.link = t.value; status(t.value ? 'Timer linked to ' + t.selectedOptions[0].text : 'Timer unlinked'); }
  if (act === 'a11y-range') { setComfort(t.dataset.k, +t.value); renderAll(); }   // saved when the drag ends; labels elsewhere catch up
  if (act === 'sound-vol') setSoundscape({ vol: +t.value });   // Phase 5
  if (t.matches('[data-fmt-block]')) { doFormat(t.value); }
  if (act === 'task-done') return;
  /* Phase 3: ticks in a note save at once: the {{tasks}} block's tasks and steps, and "- [ ]" lines (their tasks follow; the note saves as usual) */
  if (act === 'task-draft' && t.tagName === 'SELECT') { const k = t.dataset.k; S.taskDraft[k] = t.value; S.focus = { sel: '#' + t.id }; renderAll(); return; }
  if (t.matches('.doc input[data-step]')) { const [id, i] = t.dataset.step.split(':'), tk = taskById(id); if (tk) setStepDone(tk, +i, t.checked); note().html = null; renderAll(); return; }
  if (t.matches('.doc input[data-task]')) { const tk = taskById(t.dataset.task); if (tk) setTaskDone(tk, t.checked); note().html = null; status('Task synced to the Tasks board'); renderAll(); return; }
  if (t.matches('.doc li input[type="checkbox"]')) { const n = D.notes.find(x => x.id === t.closest('.doc').dataset.note); lineTicked(n); status(VAULT.live ? 'Task synced to the Tasks board' : 'Ticked'); }
});
app.addEventListener('input', e => {
  const t = e.target, act = t.dataset.act, n = note();
  if (act === 'a11y-range') { const k = t.dataset.k; S.a11y[k] = +t.value; applyComfort(); app.querySelectorAll(`[data-sl-val="${k}"]`).forEach(x => { x.textContent = SL_FMT[k](t.value); }); if (k === 'rulerLines') sizeRuler(); return; }
  if (act === 'sound-vol') { S.sound.vol = +t.value; if (AUDIO.gain) AUDIO.gain.gain.value = S.sound.vol / 250; return; }
  if (act === 'pal-q') { S.pal.q = t.value; S.pal.ix = 0; S.focus = { sel: '#palette-input', pos: t.selectionStart }; renderAll(); return; }
  if (act === 'search') { S.search = t.value; S.focus = { sel: '#search-input', pos: t.selectionStart }; renderAll(); }
  if (act === 'move-filter') { S.moveQ = t.value; S.focus = { sel: '#move-filter', pos: t.selectionStart }; renderAll(); }
  if (act === 'rename-input' && S.renameErr) { S.renameErr = ''; S.rename.draft = t.value; S.focus = { sel: '#rename-input', pos: t.selectionStart }; renderAll(); }
  if (act === 'tcustom') { const clean = t.value.replace(/\D/g, '').slice(0, 3); T.custom = clean === '0' ? '' : clean; S.focus = { sel: '#timer-custom-min', pos: T.custom.length }; renderAll(); }   // digits only, paste included
  if (act === 'task-draft' && t.dataset.k === 'title') { S.taskDraft.title = t.value; return; }   // Phase 3: the quick-add title survives a re-render
  if (act === 'tproj-name') { T.projDraft = t.value; if (T.projErr) { T.projErr = ''; S.focus = { sel: '#new-project-name', pos: t.selectionStart }; renderAll(); } }
  if (act === 'trange') { app.querySelector(`[data-range-val="${t.dataset.k}"]`).textContent = t.value + (t.dataset.k === 'volume' ? '%' : ' min'); }
  if (act === 'title') { n.title = t.value; noteEdited(n); app.querySelector('.crumb-text').textContent = t.value || 'Untitled note'; t.size = Math.max(8, t.value.length + 1); t.title = notePath(n);
    const tr = app.querySelector(`[data-tree="note"][data-v="${n.id}"] .tree-name`); if (tr) tr.textContent = t.value || 'Untitled'; }
  if (act === 'tag-input' && t.value && !t.value.startsWith('#')) { t.value = '#' + t.value; }   // R8: a tag always starts with #
  if (act === 'raw') { const doc = app.querySelector('.doc'); if (doc) edRecord(doc, 'raw');   // Editor QC: Ctrl+Z in the document undoes Raw .md typing too
    mdFromRaw(n, t.value); n.html = null; n.docDirty = false; noteEdited(n); if (doc) doc.innerHTML = mdToHtml(n); paintTelemetry(app.querySelector('.doc')?.innerText || ''); fitRaw(); }
  if (t.dataset.act === 'doc' || t.closest?.('.doc')) { noteEdited(n, true); paintTelemetry(app.querySelector('.doc').innerText); liveRaw(n); }
});
function paintTelemetry(text) {   // R7: words, characters and reading time update as you type
  const w = (text.match(/\S+/g) || []).length, set = (id, v) => { const el = app.querySelector(id); if (el) el.textContent = v; };
  set('#word-count-display', w + ' words'); set('#char-count-display', text.replace(/\s+/g, ' ').trim().length + ' characters'); set('#read-time-display', readMins(w) + ' min read');
}
// Phase 3: the "Add step" row: text needed, minutes optional (a whole number), then the row stays open for the next step
async function saveStepDraft(id) {
  const tk = taskById(id), ti = document.getElementById('new-step-text'), mi = document.getElementById('new-step-min'); if (!tk || !ti) return;
  const text = ti.value.trim(), m = (mi?.value || '').trim();
  if (!text) { ti.focus(); status('Write the step first'); return; }
  if (m && !/^\d{1,3}$/.test(m)) { mi.focus(); status('Minutes: a whole number, or leave it empty'); return; }
  ti.value = ''; if (mi) mi.value = '';
  if (await addStep(tk, text, m ? +m : null)) { status(`Added the step "${text.slice(0, 40)}"`); S.focus = { sel: '#new-step-text' }; renderAll(); }
}
app.addEventListener('keydown', e => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); save(); }
  // Phase 4: Enter saves a check-in and Esc skips it; Esc in the pause reasons keeps going; Enter adds a project
  if ((e.target.id === 'milestone-input' || e.target.id === 'qt-milestone') && (e.key === 'Enter' || e.key === 'Escape')) {   // Build H: #qt-milestone, the Card's
    e.preventDefault(); fire('tcheckin', e.key === 'Enter' ? 'save' : 'skip'); return; }
  if (e.key === 'Escape' && UI.tstate === 'pausepick' && e.target.closest?.('.timer-panel, .qt-panel')) { e.preventDefault(); fire('tcancel-pause'); return; }
  if (e.target.id === 'new-project-name' && e.key === 'Enter') { e.preventDefault(); addProject(); return; }
  // R7: palette keys, tab arrows, widget nudging, ruler on the caret
  if (e.target.id === 'palette-input') { if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); const n = S.pal.flat?.length || 0; if (n) { S.pal.ix = (S.pal.ix + (e.key === 'ArrowDown' ? 1 : -1) + n) % n; S.focus = { sel: '#palette-input', pos: e.target.selectionStart }; renderAll(); app.querySelector('.pal-item[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' }); } return; }
    if (e.key === 'Enter') { e.preventDefault(); runPalette(S.pal.ix); return; } }
  // R8: "#" at the title starts a tag; in the tag field Enter, Space or comma adds it, Backspace on an empty field removes the last one
  if (e.target.id === 'note-title-input' && e.key === '#') { e.preventDefault(); const ti = app.querySelector('#note-tags-input'); if (ti) { ti.focus(); ti.value = '#'; } return; }
  if (e.target.id === 'note-tags-input') {
    const n = note(), v = e.target.value;
    if ((e.key === 'Enter' || e.key === ' ' || e.key === ',') && n) { e.preventDefault(); const name = v.replace(/^#+/, '').trim().toLowerCase().replace(/\s+/g, '-').replace(/[^\p{L}\p{N}_\/-]/gu, '');
      if (name) { if (!n.tags.includes(name)) { n.tags.push(name); noteEdited(n); } status(`Tagged #${name}`); } S.focus = { sel: '#note-tags-input' }; renderAll(); return; }
    if (e.key === 'Backspace' && (v === '' || v === '#') && n?.tags.length) { e.preventDefault(); const gone = n.tags.pop(); noteEdited(n); status(`Removed #${gone}`); S.focus = { sel: '#note-tags-input' }; renderAll(); return; }
    if (e.key === 'Escape') { e.target.value = ''; e.target.blur(); return; }
  }
  if (e.target.matches?.('[data-wstab]')) { const tabs = [...app.querySelectorAll('[data-wstab]')], i = tabs.indexOf(e.target);
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') { e.preventDefault(); activateTab(tabs[(i + (e.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length].dataset.wstab, true); return; }
    if (e.key === 'Delete') { e.preventDefault(); closeTab(e.target.dataset.wstab); return; } }
  if (e.altKey && e.key.startsWith('Arrow') && e.target.closest?.('.widget')) { e.preventDefault(); const w = e.target.closest('.widget'), host = w.parentElement, d = 16;
    const x = clamp(w.offsetLeft + (e.key === 'ArrowRight' ? d : e.key === 'ArrowLeft' ? -d : 0), 0, host.offsetWidth - w.offsetWidth), y = clamp(w.offsetTop + (e.key === 'ArrowDown' ? d : e.key === 'ArrowUp' ? -d : 0), 0, host.offsetHeight - 40);
    w.style.left = x + 'px'; w.style.top = y + 'px'; saveWidget(w.dataset.widget, x, y); return; }
  if (S.a11y.ruler && e.target.closest?.('.doc') && !['Control', 'Shift', 'Alt', 'Meta'].includes(e.key)) setTimeout(rulerToCaret);   // Phase 5: typing, Enter and Page keys move it too
  if (e.target.id === 'new-task-title' && e.key === 'Enter') app.querySelector('[data-act="add-task"]').click();
  if ((e.target.id === 'new-step-text' || e.target.id === 'new-step-min') && (e.key === 'Enter' || e.key === 'Escape')) { e.preventDefault(); if (e.key === 'Enter') saveStepDraft(S.stepAdd); else { const id = S.stepAdd; S.stepAdd = null; S.focus = { sel: `[data-act="step-add"][data-v="${id}"]` }; renderAll(); } return; }   // Phase 3
  if (e.target.id === 'new-project-name' && e.key === 'Enter') addProject();
  if (e.target.id === 'milestone-input' && e.key === 'Enter') app.querySelector('[data-act="tcheckin"][data-v="save"]').click();
  if (e.key === 'Escape' && S.rename) { S.rename = null; S.renameErr = ''; renderAll(); return; }
  if (e.key === 'Escape' && (S.modal || S.menu || S.ctx || S.sortMenu || S.edPop || S.tabList || S.edMore)) { const back = S.ctx?.id; if (S.tabList) S.focus = { sel: '[data-act="tab-list"]' }; S.edMore = false; closeModal(true); S.menu = false; S.ctx = null; S.sortMenu = false; S.tabList = false; if (back) S.focus = { sel: `[data-tree][data-v="${back}"]` }; renderAll(); return; }
  if (e.key === 'Escape' && UI.zen === 'on') { setUI('zen', 'off'); return; }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'n') { e.preventDefault(); newItem('note'); return; }
  if (e.target.id === 'rename-input' && e.key === 'Enter') { e.preventDefault(); commitRename(); return; }
  if (e.target.matches?.('[data-tree]')) { treeKey(e); return; }
  // Ctrl+B and Ctrl+I in the editor: editor.js (edKey)
});
app.addEventListener('mousedown', e => { if (e.target.closest('[data-fmt], .ed-pop button, [data-act="ed-pop"], [data-act="ed-more"]')) e.preventDefault(); });   // keep the text selection in the note
/* R6: right-click menu, drag and drop in the tree, rename commits on blur, double-click the bar to maximise */
app.addEventListener('contextmenu', e => {
  const wt = e.target.closest('[data-wstab]'); if (wt) { e.preventDefault(); openContext('tab', wt.dataset.wstab, e.clientX, e.clientY); return; }   // R8
  const row = e.target.closest('[data-tree]'), root = e.target.closest('[data-tree-root]');
  if (!row && !root) return; e.preventDefault(); openContext(row ? row.dataset.tree : 'root', row ? row.dataset.v : null, e.clientX, e.clientY);
});
// Phase 2: leaving the note's title, tags or text saves it straight away
app.addEventListener('focusout', e => { if (e.target.closest?.('#note-title-input, #note-tags-input, .doc, #raw-markdown-textarea') && note()?.dirty) saveNote(note()); });
app.addEventListener('focusout', e => { if (e.target.id === 'rename-input' && S.rename && !S.renameErr) setTimeout(() => { if (S.rename && document.activeElement?.id !== 'rename-input') commitRename(); }, 0); });
app.addEventListener('dblclick', e => { if (onBarSpace(e.target) && !api()) winAction('max'); });   // in the app, the press handler below counts double-clicks
const dropTarget = e => { const row = e.target.closest('[data-tree]'); if (row) return row.dataset.tree === 'folder' ? row.dataset.v : D.notes.find(n => n.id === row.dataset.v)?.folder; return e.target.closest('[data-tree-root]') ? null : undefined; };
const clearDrop = () => app.querySelectorAll('.is-drop').forEach(x => x.classList.remove('is-drop'));
app.addEventListener('dragstart', e => { const row = e.target.closest?.('[data-tree]'); if (!row || row.dataset.soon !== undefined) return; S.drag = { kind: row.dataset.tree, id: row.dataset.v }; e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', row.dataset.v); row.classList.add('is-dragging'); });
app.addEventListener('dragover', e => {
  if (!S.drag || qc69Files(e)) return; const tgt = dropTarget(e);   // Build M · QC 69: a file from outside is never moved if (tgt === undefined || !canMove(S.drag.kind, S.drag.id, tgt)) { clearDrop(); return; }
  e.preventDefault(); e.dataTransfer.dropEffect = 'move'; clearDrop();
  (tgt === null ? app.querySelector('[data-tree-root]') : app.querySelector(`[data-tree="folder"][data-v="${tgt}"]`))?.classList.add('is-drop');
  if (tgt && !S.open.has(tgt) && S.hoverOpen?.id !== tgt) { clearTimeout(S.hoverOpen?.t); S.hoverOpen = { id: tgt, t: setTimeout(() => { if (S.drag) { S.open.add(tgt); renderAll(); } }, 700) }; }   // hover to open, as in Obsidian
});
app.addEventListener('drop', e => { if (!S.drag || qc69Files(e)) return; e.preventDefault(); const tgt = dropTarget(e), d = S.drag;   // Build M · QC 69
  S.drag = null; clearDrop(); if (tgt !== undefined) moveItem(d.kind, d.id, tgt); });
app.addEventListener('dragend', () => { S.drag = null; clearTimeout(S.hoverOpen?.t); S.hoverOpen = null; clearDrop(); app.querySelectorAll('.is-dragging').forEach(x => x.classList.remove('is-dragging')); });

/* ---- R7: shortcuts anywhere, tab drag, widget drag, ruler, paste ---- */
document.addEventListener('keydown', e => {
  const k = e.key.toLowerCase(), ctrl = e.ctrlKey || e.metaKey;
  if (ctrl && !e.shiftKey && !e.altKey && k === 'k') { e.preventDefault(); openPalette(); return; }
  if (ctrl && e.shiftKey && k === 'd') { e.preventDefault(); openDump(); return; }   // Phase 6A: brain dump (main.py's global hotkey opens it from other apps)
  if (ctrl && e.altKey && k === 'r') { e.preventDefault(); setComfort('ruler', !S.a11y.ruler); renderAll(); return; }
  if (ctrl && !e.shiftKey && !e.altKey && (k === 't' || k === 'w')) { e.preventDefault(); fire(k === 't' ? 'tab-new' : 'tab-close-current'); return; }   // Phase 5: as Settings > Keyboard shortcuts lists
  if (e.key === 'F11') { e.preventDefault(); setUI('zen', UI.zen === 'on' ? 'off' : 'on'); return; }
  if (e.key === 'Escape' && !app.contains(e.target)) {   // Bug fix 2026-10-16: with focus outside the app (after a click on empty page), Esc closes open menus too
    if (S.menu || S.ctx || S.sortMenu || S.edPop || S.tabList || S.edMore) { S.menu = false; S.ctx = null; S.sortMenu = false; S.edPop = null; S.tabList = false; S.edMore = false; renderAll(); }
    else if (S.modal) closeModal(); else if (UI.zen === 'on') setUI('zen', 'off'); }
});
document.addEventListener('selectionchange', () => { if (UI.zen === 'on') markActiveBlock(); paintFmtState(); });   // paintFmtState: bug fix 2026-10-16
app.addEventListener('mousemove', e => { if (S.a11y.ruler) placeRuler(e.clientY); });
app.addEventListener('mouseover', e => {
  const gc = e.target.closest('.grid-cell');
  if (gc) { S.gridHover = [+gc.dataset.r, +gc.dataset.c]; app.querySelectorAll('.grid-cell').forEach(c => c.classList.toggle('is-on', +c.dataset.r <= S.gridHover[0] && +c.dataset.c <= S.gridHover[1]));
    const l = app.querySelector('[data-grid-label]'); if (l) l.textContent = `${S.gridHover[0]} × ${S.gridHover[1]} table`; }
});
// R10: the tab strip's edge fades follow its scroll; the mouse wheel scrolls tabs sideways; a new window size re-checks the fit
app.addEventListener('scroll', e => { if (e.target.classList?.contains('tabstrip')) tabOverflow(); }, true);
app.addEventListener('wheel', e => { const s = e.target.closest?.('.tabstrip'); if (s && s.scrollWidth > s.clientWidth && Math.abs(e.deltaY) > Math.abs(e.deltaX)) { s.scrollLeft += e.deltaY; e.preventDefault(); } }, { passive: false });
if (window.ResizeObserver) new ResizeObserver(() => { tabOverflow(); anchorQt(); fitToolbar(); }).observe(app);
app.addEventListener('auxclick', e => {
  if (e.button !== 1) return; const wt = e.target.closest('[data-wstab]');
  if (wt) { e.preventDefault(); closeTab(wt.dataset.wstab); return; }
  const row = e.target.closest('[data-tree="note"]'); if (row) { e.preventDefault(); openNote(row.dataset.v, true, true); }
});
app.addEventListener('dragstart', e => { const wt = e.target.closest?.('[data-wstab]'); if (!wt) return; S.tabDrag = wt.dataset.wstab; e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', S.tabDrag); wt.classList.add('is-dragging'); });
app.addEventListener('dragover', e => {
  if (!S.tabDrag || qc69Files(e)) return; const wt = e.target.closest('[data-wstab]');   // Build M · QC 69
  app.querySelectorAll('.ws-tab.is-drop').forEach(x => x.classList.remove('is-drop'));   // a drop beside a note: Build M · R44, panes.js
  if (!wt || wt.dataset.wstab === S.tabDrag) return; e.preventDefault(); wt.classList.add('is-drop');
});
app.addEventListener('drop', e => {
  if (!S.tabDrag || qc69Files(e)) return; const wt = e.target.closest('[data-wstab]'),   // Build M · QC 69
    from = S.tabs.findIndex(x => x.id === S.tabDrag); S.tabDrag = null;
  if (wt && from >= 0) { e.preventDefault(); const [tb] = S.tabs.splice(from, 1); S.tabs.splice(S.tabs.findIndex(x => x.id === wt.dataset.wstab), 0, tb); }
  renderAll();
});
app.addEventListener('dragend', () => { if (S.tabDrag) { S.tabDrag = null; renderAll(); } });

app.addEventListener('pointerdown', e => {
  const h = e.target.closest('[data-drag-widget]'); if (!h || e.target.closest('button') || e.button !== 0) return;
  const w = h.closest('.widget'), host = w.parentElement, z = app.getBoundingClientRect().width / app.offsetWidth || 1, start = { x: e.clientX, y: e.clientY, l: w.offsetLeft, t: w.offsetTop };
  h.classList.add('is-grabbing'); h.setPointerCapture(e.pointerId); e.preventDefault();
  const move = ev => { w.style.left = clamp(start.l + (ev.clientX - start.x) / z, 0, host.offsetWidth - w.offsetWidth) + 'px'; w.style.top = clamp(start.t + (ev.clientY - start.y) / z, 0, host.offsetHeight - 40) + 'px'; };
  const up = () => { h.removeEventListener('pointermove', move); h.removeEventListener('pointerup', up); h.classList.remove('is-grabbing'); saveWidget(h.dataset.dragWidget, w.offsetLeft, w.offsetTop); };
  h.addEventListener('pointermove', move); h.addEventListener('pointerup', up);
});
/* ---- Fix A (editor E-76 / PST-14): a pasted image is saved as a file in attachments/ (api.attachment_save) and the note
        embeds it with "![[attachments/paste-….png]]" on a line of its own, at the caret: no base64 in the .md. It is drawn
        like any embedded image (voice-attach.js) and listed in the note's Attachments tab. With no app (the sample), the
        file is only in the page ---- */
app.addEventListener('paste', e => {
  const doc = e.target.closest?.('.doc'); if (!doc || !doc.isContentEditable) return;
  const file = [...(e.clipboardData?.items || [])].find(i => i.type.startsWith('image/'))?.getAsFile(); if (!file) return;
  e.preventDefault(); const rd = new FileReader(); rd.onload = () => pasteImage(doc, rd.result, file); rd.readAsDataURL(file);
});
async function pasteImage(doc, url, blob) {
  let a;
  if (api()) { const r = await nv('attachment_save', url, 'paste'); if (failed(r)) { toast(r.message || "Couldn't save the pasted image"); return; } a = { ...r, uses: [] }; }
  else { const d = new Date(), name = `paste-${d.getFullYear()}${two(d.getMonth() + 1)}${two(d.getDate())}-${two(d.getHours())}${two(d.getMinutes())}${two(d.getSeconds())}.png`;
    a = { file: 'attachments/' + name, name, kind: 'image', size: blob.size, mtime: d.toISOString().slice(0, 19), uses: [] }; }
  D.atts = [a, ...(D.atts || []).filter(x => x.file !== a.file)]; PLAYER.urls[a.file] = url;   // drawn at once, without asking the app for it again
  if (!doc.isConnected) doc = app.querySelector(`.doc[data-note="${CSS.escape(doc.dataset.note)}"]`);
  if (!doc?.isContentEditable) { toast(`Saved to ${a.file}, but the note was closed`); return; }
  if (!edRange(doc)) { doc.focus({ preventScroll: true }); if (edLast?.id === doc.dataset.note && edLast.sel) edSelLoad(doc, edLast.sel, doc.innerHTML === edLast.html); else edPut(edPoint(doc, Infinity)); }
  edRecord(doc); const box = document.createElement('div'); box.innerHTML = NVMarkdown.mdToHtml(`![[${a.file}]]`);
  pasteLine(doc, box.firstElementChild); edChanged(doc); embedAtts(); edShow(); toastHere('Saved to ' + a.file);
}
// A line of its own at the caret: the line splits around it (insertHTML would join it to the line), the caret on the line after
function pasteLine(doc, el) {
  const r = edRange(doc), top = r && edTop(doc, r.startContainer);
  if (top?.nodeType === 1 && top.matches('p, h1, h2, h3, h4, h5, h6')) {
    if (!r.collapsed) r.deleteContents();
    const tail = document.createRange(); tail.setStart(r.startContainer, r.startOffset); tail.setEnd(top, top.childNodes.length);
    const rest = top.cloneNode(false); rest.append(tail.extractContents()); top.after(el);
    if (rest.textContent.trim() || rest.querySelector('img')) el.after(rest);
    if (!top.textContent.trim() && !top.querySelector('img')) top.remove();
  } else if (top) top.after(el); else doc.append(el);
  let next = el.nextElementSibling;
  if (!next || next.getAttribute('contenteditable') === 'false' || next.hasAttribute('data-md') || !next.matches('p, h1, h2, h3, h4, h5, h6')) { next = edNewP(); el.after(next); }
  edPut([next, 0]);
}

/* ---- The frameless window: a press on the bar's drag area or on a thin strip along an edge is handed to Windows (api.py,
        winframe.py), which moves or resizes the window itself: Aero snap, drag down from maximised, edge resizing ---- */
let lastEdgeDown = { at: 0, edge: '' };
document.querySelectorAll('.win-edge').forEach(el => el.addEventListener('pointerdown', e => {
  if (e.button !== 0 || !api()) return; e.preventDefault();
  // Bug fix 2026-10-16: double-click an edge to fill the screen, as Windows does for a framed window:
  // the top or bottom edge gives the full height, the left or right edge the full width (presses counted, as on the bar)
  const edge = el.dataset.edge;
  if (edge.length === 1 && lastEdgeDown.edge === edge && e.timeStamp - lastEdgeDown.at < 450) { lastEdgeDown = { at: 0, edge: '' }; api().window_fill('ns'.includes(edge) ? 'v' : 'h'); return; }
  lastEdgeDown = { at: e.timeStamp, edge }; api().window_start_drag(edge);
}));
// Bug fix 2026-10-16: every empty part of the window bar moves the window (it used to be only the strip between the tabs and the timer)
const BAR_CONTROLS = 'button, a, input, select, textarea, [data-act], [role="tab"], .ws-tab, [contenteditable="true"], [draggable="true"], [role="menu"], .menu, .popover';
const onBarSpace = t => !!t.closest('[data-drag]') || (!!t.closest('.titlebar') && !t.closest(BAR_CONTROLS));
let lastBarDown = 0;
app.addEventListener('pointerdown', e => {
  if (e.button !== 0 || !api() || !onBarSpace(e.target)) return;
  e.preventDefault();
  // Windows' move loop swallows the button's release, so the page never sees a dblclick: count the two presses here
  if (e.timeStamp - lastBarDown < 450) { lastBarDown = 0; winAction('max'); return; }
  lastBarDown = e.timeStamp; api().window_start_drag('caption');
});
/* ---- Phase 6A: sticky notes (typing saves, a resized card keeps its size, the ⋮ menu closes on Esc or a click elsewhere)
        and the brain dump bar (Enter saves the thought) ---- */
app.addEventListener('input', e => {
  const t = e.target;
  if (t.dataset.act === 'sticky-text') { const s = stickyById(t.dataset.v); if (s) stickyTyped(s, t.value); }
  if (t.dataset.act === 'dump-input') S.dumpDraft = t.value;
});
app.addEventListener('keydown', e => { if (e.target.id === 'dump-input' && e.key === 'Enter') { e.preventDefault(); dumpEnter(e.target); } });
app.addEventListener('focusout', e => { if (e.target.dataset?.act === 'sticky-text') { const s = stickyById(e.target.dataset.v); if (s) saveStickyText(s); } });
document.addEventListener('pointerup', e => {
  const w = !POP && e.target.closest?.('.sticky'); if (!w) return;   // Build H: a popped-out sticky's size is its window's (popout.py saves it)
  stickySized(w.dataset.widget.slice(3), w.offsetWidth, w.offsetHeight);
});
document.addEventListener('click', e => {   // capture phase: before the app's own handler, as the mockup's first lines did
  if (!S.stickyMenu || e.target.closest('.sticky .menu') || e.target.closest('[data-act="sticky-menu"]')) return;
  S.stickyMenu = null; if (!e.target.closest('[data-act]')) { e.stopPropagation(); renderAll(); }
}, true);
document.addEventListener('keydown', e => {
  if (e.key !== 'Escape' || !S.stickyMenu) return;
  const id = S.stickyMenu; S.stickyMenu = null; e.stopPropagation(); S.focus = { sel: `[data-act="sticky-menu"][data-v="${id}"]` }; renderAll();
}, true);
window.hotkeyBrainDump = () => openDump();
// Global hotkeys from main.py (Ctrl+Alt+P pause or resume, Ctrl+Alt+S stop and log)
window.hotkeyPauseResume = () => fire('tpause-toggle');
window.hotkeyStop = () => { if (TIMER_ACTIVE.includes(UI.tstate)) fire('tstop'); };   // (Build H: main.py calls api.timer_hotkey instead, so a popped-out timer follows too)

/* ---- Boot: the reader settings from config.json (once pywebview's bridge is ready), then the sample vault ---- */
function boot() {
  document.body.dataset.inspector = UI.inspector;
  document.execCommand('defaultParagraphSeparator', false, 'p');   // Phase 2: Enter in the editor makes a <p>, which NVMarkdown saves as a paragraph
  if (!D.live) { seedTimer(UI.tstate); markClock(); }   // Phase 4: with the backend, T comes from its running-session record
  S.hist = S.noteId ? [S.noteId] : []; S.histIx = S.hist.length - 1;
  S.open = new Set(defaultOpen());   // R6: the open note's folders start expanded
  S.tabs = defaultTabs('typical'); S.activeTab = S.tabs[0]?.id || null; seedTrail();   // R7: starting tabs and trail
  renderAll();
  if (!CHECK) setInterval(timerTick, 1000);   // R5: the sample session really runs
  if (api()) api().window_is_maximized().then(m => setMaximised(!!m)).catch(() => {});
  restoreSoundscape(); loadCustomSound();   // Phase 5: the focus sound plays again; a custom alert sound is read ahead
  if (CHECK) { const s = document.createElement('script'); s.src = 'js/check.js'; document.body.appendChild(s); }
  wrapStart();   // Build F: the wrap-up reminder and the morning launchpad (wrapup.js; not in the ?check=1 sweep)
}
// The bridge usually comes within a few hundred milliseconds. If it is late (or never comes: a browser, in dev), the app starts on
// the default reader settings and re-applies config.json's when the bridge arrives.
let started = null;
const start = () => started ||= POP ? popStart() : (async () => {   // Build H: a popped-out window loads only what its card needs (popout.js)
  await loadReader(); if (await loadVault()) resetVaultView(); await loadCapture(); await loadTimerData(); boot(); popBoot(); })();   // Phase 2: the real vault, Phase 6A: stickies and the inbox, Phase 4: the timer's data, when the bridge has them
applyReader();
if (api()) start();
else setTimeout(start, 700);
window.addEventListener('pagehide', () => { flushSaves(); flushStickies(); });   // Phase 2: best effort when the window goes (Phase 6A: sticky notes too)
window.addEventListener('pywebviewready', async () => {
  if (!started) { start(); return; }
  if (POP) return;   // Build H
  await started; await loadReader(); restoreSoundscape(); if (!VAULT.live && !CHECK && await loadVault()) resetVaultView(); if (!CAPTURE.live && !CHECK) await loadCapture(); if (!D.live) await loadTimerData(); renderAll(); api()?.window_is_maximized().then(m => setMaximised(!!m)).catch(() => {});
});
