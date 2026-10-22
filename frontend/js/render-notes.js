/* Notes: Markdown to the editor and back, the note page, the editor toolbar, the file explorer and its folder actions.
   Extracted from design/vault-notes-mockups.html (R20). */
'use strict';
/* ---- Phase 2: Markdown ⇄ the Word/Docs editor through NVMarkdown (js/markdown.js: marked + turndown, sanitised).
        The {{tasks}} line shows the note's linked tasks; they live in the task store, so they're never saved into the note ---- */
function inline(s) {   // task titles: escaped, with the same light Markdown the mockup showed
  return esc(s).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/\*(.+?)\*/g, '<em>$1</em>').replace(/~~(.+?)~~/g, '<del>$1</del>')
    .replace(/`(.+?)`/g, '<code>$1</code>').replace(/\[\[(.+?)\]\]/g, (m, t) => `<span class="wikilink" data-wiki="${t}">[[${t}]]</span>`);
}
function taskLines(n) { return D.tasks.filter(t => t.noteId === n.id && !isLineTask(t, n)); }   // Phase 3: a task that is a "- [ ]" line in the note shows as that line
function taskLinesHtml(n) {
  return taskLines(n).map(t => `<div class="task${t.done ? ' is-done' : ''}"><input type="checkbox" data-task="${t.id}" ${t.done ? 'checked' : ''} aria-label="Done"><span>${inline(t.title)}</span>${t.done ? '' : `<button class="icon-btn icon-btn--sm task-wand" contenteditable="false" data-act="ai-split" data-v="${t.id}" aria-label="Break down: ${esc(t.title)}" title="Break it into small timed steps">${S.splitting === t.id ? '<span class="spinner"></span>' : ic('wand')}</button>`}</div>`
    + (t.steps || []).map((x, i) => `<div class="task is-sub${x.done ? ' is-done' : ''}"><input type="checkbox" data-step="${t.id}:${i}" ${x.done ? 'checked' : ''} aria-label="Done"><span>${esc(x.t)}</span>${x.m != null ? ` <span class="chip chip--neutral" contenteditable="false">${x.m} min</span>` : ''}</div>`).join('')).join('');   // Phase 3: minutes are optional
}
function mdToHtml(n) { return proofMark(NVMarkdown.mdToHtml(n.md, { renderTasks: () => taskLinesHtml(n) })); }
function frontMatter(n) {
  const q = s => '"' + String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
  return `---\nid: ${n.id}\ntitle: ${q(n.title)}\nproject: ${q(rootProject(n.folder)?.name || '')}\ntags: [${n.tags.join(', ')}]\nsqlite_sync: neurovault.db\n---\n\n`;
}
// Export as .md: the tasks written out under {{tasks}}, with a blank line after them so the next line doesn't join the last task
function noteToMd(n) {
  const tasks = taskLines(n).map(t => `- [${t.done ? 'x' : ' '}] ${t.title}` + (t.steps || []).map(x => `\n  - [${x.done ? 'x' : ' '}] ${x.t}${x.m != null ? ` (${x.m} min)` : ''}`).join('')).join('\n');
  return frontMatter(n) + n.md.replace(/^\{\{tasks\}\}[ \t]*$/m, () => tasks ? tasks + '\n' : '');
}
// Raw .md: the note as stored, under its front matter. {{tasks}} stays a line of its own: tasks are edited on the Tasks board
const rawMd = n => frontMatter(n) + n.md;
function mdFromRaw(n, raw) { n.md = /^---[ \t]*\n[\s\S]*?\n---[ \t]*(?:\n|$)/.test(raw) ? NVMarkdown.splitFrontMatter(raw).body : raw; }
// Headings 1–3 in reading order, as the editor shows them (code blocks and front matter left out); remembered per text
function outline(n) {
  if (n._olMd === n.md) return n._ol;
  const out = [], walk = ts => (ts || []).forEach(t => { if (t.type === 'heading' && t.depth <= 3) out.push({ level: t.depth, text: (t.text || '').replace(/\[\[([^\]|#]+)[^\]]*\]\]/g, '$1').replace(/[*_`~]|<[^>]+>/g, '').trim() }); else walk(t.tokens || t.items); });
  try { walk(marked.lexer(NVMarkdown.splitFrontMatter(n.md).body)); } catch (e) { /* the outline is a convenience: leave it empty */ }
  n._olMd = n.md; n._ol = out; return out;
}
const words = n => (n.md.replace('{{tasks}}', taskLines(n).map(t => t.title).join(' ')).replace(/<[^<>\n]+>/g, ' ').replace(/[#>*`\[\]-]/g, ' ').match(/\S+/g) || []).length;   // Build P: HTML tags (a rich table's) aren't words
// [[wiki links]]: "Title", "Title|shown text" or "Title#heading" all point at the note called Title (any case)
function wikiTarget(t) { const k = String(t).split('|')[0].split('#')[0].trim().toLowerCase(); return k ? D.notes.find(n => n.title.trim().toLowerCase() === k) : null; }
const wikiLinks = n => [...n.md.matchAll(/\[\[([^\[\]\n]+?)\]\]/g)].map(m => m[1]);

/* ---- Phase 2: saving. The title, tags and text save 1.2 s after the last change, when you leave the note, and at once with Ctrl+S.
        The status bar shows "Saving…" while a save runs and "Save failed" (with the reason above the toolbar) until a save works;
        Ctrl+S also gives the news "Saved just now". Painted in place, so the caret never jumps while you type ---- */
const AUTOSAVE_MS = 1200;
const SAVE = { busy: 0, err: null };
const liveDoc = n => app.querySelector(`.doc[data-note="${CSS.escape(n.id)}"]`);
function noteEdited(n, fromDoc) {
  if (!n) return;
  if (fromDoc) { const el = liveDoc(n); if (el) n.html = el.innerHTML; n.docDirty = true; }
  n.dirty = true; clearTimeout(n.saveT); n.saveT = setTimeout(() => saveNote(n), AUTOSAVE_MS);
}
// The editor's HTML → n.md, before a save, a mode switch or a re-render (which rebuilds the editor)
function syncDoc(n) {
  if (!n?.docDirty) return; const el = liveDoc(n), box = typedLinks(el, n.html);
  n.md = NVMarkdown.htmlToMd(box); n.docDirty = false;
  if (box.nvLinked) n.html = null;   // the next render draws the new links from the Markdown
}
// [[Title]] typed as text becomes a wiki link when it's saved (NVMarkdown escapes brackets in plain text, so text stays text otherwise)
function typedLinks(el, html) {
  const box = el ? el.cloneNode(true) : Object.assign(document.createElement('div'), { innerHTML: html || '' });
  if (el) { const live = el.querySelectorAll('input'); box.querySelectorAll('input').forEach((x, i) => { if (live[i]?.checked) x.setAttribute('checked', ''); else x.removeAttribute('checked'); }); }
  const re = /\[\[([^\[\]\n]+?)\]\]/g, walker = document.createTreeWalker(box, NodeFilter.SHOW_TEXT, { acceptNode: t => /\[\[[^\[\]\n]+?\]\]/.test(t.data) &&!t.parentElement.closest('code, pre, a, .wikilink, [data-md]') ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT });
  const hits = []; while (walker.nextNode()) hits.push(walker.currentNode);
  hits.forEach(t => { const frag = document.createDocumentFragment(); let at = 0; re.lastIndex = 0;
    for (const m of t.data.matchAll(re)) { frag.append(t.data.slice(at, m.index)); const s = document.createElement('span'); s.className = 'wikilink'; s.dataset.wiki = m[1]; s.textContent = m[0]; frag.append(s); at = m.index + m[0].length; }
    frag.append(t.data.slice(at)); t.replaceWith(frag); });
  box.nvLinked = hits.length > 0;
  return box;
}
function syncDocs() { edKeepCaret(); D.notes.forEach(n => { if (n.docDirty) syncDoc(n); }); }   // edKeepCaret: the caret goes back after the rebuild (editor.js)
async function saveNote(n, manual) {
  if (!n || !D.notes.includes(n)) return { status: 'success' };
  clearTimeout(n.saveT); syncDoc(n);
  if (!VAULT.live) { n.dirty = false; if (manual) { D.events.unshift({ id: 'ev-' + Date.now(), time: 'Just now', range: 'Today', type: 'Edits', title: `Saved "${n.title}"`, desc: `${n.category} · ${n.tags.join(', ')}`, noteId: n.id }); saved(); } return { status: 'success' }; }
  if (n.saving) { n.again = true; n.againManual ||= manual; return n.saving; }
  if (!n.dirty && !manual) return { status: 'success' };
  n.dirty = false; SAVE.busy++; paintSave();
  const pj = rootProject(n.folder);
  n.saving = nv('save_note', rawId(n.id), n.title.trim() || 'Untitled', n.md, n.oldCategory || pj?.name || '', rawId(pj?.id), n.tags.join(', '));
  const r = await n.saving; n.saving = null; SAVE.busy--;
  if (!D.notes.includes(n)) { paintSave(); return r; }   // deleted while saving
  if (failed(r)) { n.dirty = true; SAVE.err = { id: n.id, message: r.message || 'The database said no.' }; status('Save failed'); }
  else { n.mtime = r.updated_at || n.mtime; if (SAVE.err?.id === n.id) SAVE.err = null; if (manual) saved(); syncLineTasks(n); }   // Phase 3: its "- [ ]" lines → tasks
  paintSave();
  if (n.again) { const m = n.againManual; n.again = n.againManual = false; return saveNote(n, m); }
  return r;
}
function saved() { status('Saved just now'); paintSave(); toastHere('Saved'); }
const flushSaves = () => Promise.all(D.notes.filter(n => n.dirty || n.docDirty || n.saving).map(n => saveNote(n)));
function saveAlert(n) {
  if (UI.state === 'parser') return `<div class="alert alert--warning" role="alert">${ic('alert')}<span>This note's content couldn't be read (an empty block in the parser). The .md file on disk is fine.</span><button class="btn btn--secondary btn--sm" data-act="mode" data-v="raw">Open raw .md</button></div>`;
  if (UI.state !== 'error' || !n) return '';
  const m = SAVE.err?.message || "the file is open in another app.";
  return `<div class="alert alert--danger" role="alert">${ic('alert')}<span>Couldn't save <span class="code">${esc(notePath(n))}</span>: ${esc(m.replace(/\.?$/, '.'))} Your changes are kept here.</span><button class="btn btn--secondary btn--sm" data-act="save">Retry</button></div>`;
}
// Build M · QC 96: an autosave after each pause in typing flashed "Saving…" beside the word count for a few milliseconds and moved
// it. Now "Saving…" only shows when a save takes longer than 0.6 s, then stays at least 0.8 s; a quick save draws nothing at all.
// A failed save shows at once, as before.
const SAVE_SHOW = { after: 600, hold: 800, t: 0, h: 0, at: 0 };
function paintSave() {
  if (SAVE.busy && !SAVE.err && !SAVE_SHOW.at) {   // still saving, not shown yet: show it only if it is slow
    if (!SAVE_SHOW.t) SAVE_SHOW.t = setTimeout(() => { SAVE_SHOW.t = 0; if (SAVE.busy && !SAVE.err) { SAVE_SHOW.at = Date.now(); paintSave0(); } }, SAVE_SHOW.after);
    return;
  }
  clearTimeout(SAVE_SHOW.t); SAVE_SHOW.t = 0;
  if (!SAVE.busy && !SAVE.err && SAVE_SHOW.at) {   // done: "Saving…" was showing, so it stays for its hold time
    const left = SAVE_SHOW.hold - (Date.now() - SAVE_SHOW.at); clearTimeout(SAVE_SHOW.h);
    if (left > 0) { SAVE_SHOW.h = setTimeout(() => { SAVE_SHOW.at = 0; paintSave(); }, left); return; }
    SAVE_SHOW.at = 0;
  }
  if (SAVE.err) SAVE_SHOW.at = 0;
  const was = UI.state; paintSave0(was);
}
function paintSave0(was) {
  if (VAULT.live || SAVE.busy || SAVE.err || ['saving', 'error'].includes(UI.state)) UI.state = SAVE.busy ? 'saving' : SAVE.err ? 'error' : ['saving', 'error'].includes(UI.state) ? 'ready' : UI.state;
  if (was === undefined || UI.state !== was || SAVE.err || ['saving', 'error'].includes(was)) { const sb = app.querySelector('.status-bar'); if (sb) sb.outerHTML = renderStatus(); }   // nothing changed: no redraw
  const slot = app.querySelector('[data-save-alert]'); if (slot) slot.innerHTML = saveAlert(note());
}
// A toast without re-rendering the page (the editor keeps its caret); same look and timing as toast()
function toastHere(msg) {
  msg = looksRaw(msg) ? plainMsg(msg) : msg; S.toast = msg; app.querySelector(':scope > .toast')?.remove(); app.insertAdjacentHTML('beforeend', `<div class="toast card" role="status">${ic('ok')}${esc(msg)}</div>`);
  clearTimeout(toast.t); toast.t = setTimeout(() => { S.toast = null; app.querySelector(':scope > .toast')?.remove(); }, 1800);
}
// After a failed explorer action: say why, and reload from the database so the tree shows what's really there
async function explorerError(r) {
  status(r?.message || 'That didn\'t work.'); S.modal = null;
  if (VAULT.live && !r?.offline) { const keep = S.noteId; await flushSaves(); await loadVault(); if (D.notes.some(n => n.id === keep)) S.noteId = keep; else S.noteId = D.notes[0]?.id ?? null; }
  toast(r?.message || 'That didn\'t work.');
}
// R8: Document, Split and Raw .md are icons at the right end of the editor toolbar
function modeGroup() {
  return `<div class="ed-zone ed-zone--mode" role="group" aria-label="Editor mode">${[['wysiwyg', 'Document', 'doctext'], ['split', 'Split: document and .md side by side', 'columns'], ['raw', 'Raw .md', 'markdown']].map(([m, l, k]) =>
    `<button class="ed-btn" data-act="mode" data-v="${m}" aria-pressed="${S.mode === m}" aria-label="${l}" title="${l}">${ic(k)}</button>`).join('')}</div>`;
}
function ribbon() {
  if (S.mode === 'raw') return `<div class="ed-toolbar card ed-toolbar--raw" role="toolbar" aria-label="Editor"><span class="list-item-sub">Raw .md · formatting buttons return in Document and Split</span>${modeGroup()}</div>`;
  return zonesRibbon();
}
function viewNotes() {
  const n = note();
  if (UI.state === 'loading') return `<section class="view"><div class="view-inner"><div class="skel" style="height:34px;width:50%"></div><div class="skel" style="height:24px;width:70%"></div><div class="card ed-pane"><div class="skel" style="height:16px;width:30%"></div><div class="skel mt-3" style="height:12px;width:90%"></div><div class="skel mt-2" style="height:12px;width:84%"></div><div class="skel mt-2" style="height:12px;width:60%"></div></div></div></section>`;
  if (!n) return `<section class="view"><div class="empty empty--view"><div class="empty-title">Your vault is empty</div><div class="empty-text">Notes are saved as .md files in your vault folder and indexed in neurovault.db.</div><button class="btn btn--primary" data-act="plus">${ic('plus')}New note</button></div></section>`;
  const alert = `<div class="save-alert" data-save-alert>${saveAlert(n)}</div>`;   // Phase 2: repainted in place by paintSave()
  const doc = UI.state === 'parser' ? '<p>[object Object]</p>' : (n.html || mdToHtml(n));
  // R8: tags sit on the title line, styled like the right sidebar's tags; type # to add one
  const tagRow = `<div class="tag-row" role="group" aria-label="Tags">${n.tags.map(t => `<span class="chip chip--accent tag-chip"><button class="tag-chip-name" data-act="tag" data-v="${esc(t)}" title="Find notes tagged #${esc(t)}">#${esc(t)}</button><button class="tag-chip-x" data-act="tag-remove" data-v="${esc(t)}" aria-label="Remove tag ${esc(t)}" title="Remove #${esc(t)}">${ic('x')}</button></span>`).join('')}<input class="tag-input" id="note-tags-input" data-act="tag-input" placeholder="#tag" size="4" aria-label="Add a tag: type # and a name, then Enter" title="Type # to add a tag (also from the end of the title)"></div>`;
  const panes = `<div class="ed-grid${S.mode === 'split' ? ' is-split' : ''}">
    ${S.mode !== 'raw' ? `<div class="card ed-pane${parseFrontMatter(n.md)?.length ? ' has-props' : ''}">${propsPanel(n)}<div class="doc" id="note-body-editor" contenteditable="true" data-act="doc" data-note="${n.id}" spellcheck="${S.a11y.spell ? 'true' : 'false'}">${doc}</div></div>` : ''}
    ${S.mode !== 'wysiwyg' ? `<div class="card ed-raw"><div class="eyebrow">File on disk · .md with front matter</div><textarea id="raw-markdown-textarea" data-act="raw" spellcheck="false" aria-label="Raw markdown">${esc(rawMd(n))}</textarea></div>` : ''}</div>`;
  return `<section class="view view--note" id="main-view-notes"><div class="view-inner">
    <div class="note-head"><input class="note-title" id="note-title-input" data-act="title" value="${esc(n.title)}" size="${Math.max(8, (n.title || '').length + 1)}" aria-label="Note title" placeholder="Untitled note" title="${esc(notePath(n))}">${tagRow}${typeof tkoNoteLink === 'function' ? tkoNoteLink(n) : ''}</div>
    ${alert}${readingNote()}${ribbon()}${panes}</div></section>`;
}
// doFormat (the toolbar's commands) is in editor.js, with the rest of what the editor does
// Phase 2: the top level holds the projects and top-level folders such as Unsorted (and any note the backend left without a home)
function childrenOf(pid) {
  const fs = pid === null ? [...D.projects.map(x => ({ id: x.id, name: x.name, color: x.color })), ...D.folders.filter(f => f.parent === null).map(f => ({ ...f }))] : D.folders.filter(f => f.parent === pid).map(f => ({ ...f }));
  const ns = D.notes.filter(n => n.folder === pid);
  const [key, dir] = S.sort.split('-'), k = dir === 'asc' ? 1 : -1, f = key === 'mod' ? 'mtime' : 'ctime';
  fs.sort((a, b) => (key === 'name' ? k : 1) * byName(a.name, b.name));
  ns.sort((a, b) => key === 'name' ? k * byName(a.title, b.title) : k * a[f].localeCompare(b[f]));
  return { fs, ns };
}
function treeRow(kind, id, name, depth, open, color) {
  const cur = kind === 'note' && UI.view === 'notes' && id === S.noteId, sel = S.sel && S.sel.kind === kind && S.sel.id === id;
  const lead = kind === 'folder' ? `<span class="tree-chev">${ic('right')}</span>` : '<span class="tree-spacer"></span>';
  if (S.rename && S.rename.id === id) return `<div class="list-item list-item--tree is-${kind}" style="--depth:${depth}">${lead}<input class="field field--inline" id="rename-input" data-act="rename-input" value="${esc(S.rename.draft ?? name)}" aria-label="Rename ${kind === 'note' ? 'note' : 'folder'}"${S.renameErr ? ' aria-invalid="true" aria-describedby="rename-err"' : ''}></div>${S.renameErr ? `<div class="field-error tree-error" id="rename-err" style="--depth:${depth}">${esc(S.renameErr)}</div>` : ''}`;
  return `<div class="list-item list-item--tree is-${kind}" role="treeitem" tabindex="${cur || (sel && !S.noteId) ? 0 : -1}" aria-level="${depth + 1}"${kind === 'folder' ? ` aria-expanded="${open}"` : ''}${cur ? ' aria-current="true"' : ''}${sel ? ' aria-selected="true"' : ''} data-tree="${kind}" data-v="${id}" draggable="true" style="--depth:${depth}" title="${esc(name)}">${lead}${color ? `<span class="proj-dot proj-color-${color}" aria-hidden="true"></span>` : ''}<span class="tree-name">${esc(name)}</span></div>`;
}
function treeHtml(pid, depth) {
  const { fs, ns } = childrenOf(pid);
  return fs.map(f => treeRow('folder', f.id, f.name, depth, S.open.has(f.id), f.color) + (S.open.has(f.id) ? `<div role="group">${treeHtml(f.id, depth + 1)}</div>` : '')).join('') + ns.map(n => treeRow('note', n.id, n.title, depth)).join('') + (pid === null ? '' : D.files.filter(f => f.folder === pid).map(f => fileRow(f, depth)).join(''));
}
function renderFileExplorer() {
  const loading = UI.state === 'loading';
  // R14: Search notes moves up into the toolbar row, beside the four actions ("Search notes" needs 91px in OpenDyslexic; the row leaves 75)
  const searchField = `<label class="field-search">${ic('search')}<input class="field" id="search-input" data-act="search" type="search" placeholder="Search" value="${esc(S.search)}" aria-label="Search notes"></label>`;
  const actions = `<div class="side-actions" role="toolbar" aria-label="File explorer">
    <button class="icon-btn icon-btn--sm" data-act="tree-new-note" aria-label="New note" title="New note (Ctrl+N)" ${D.projects.length || D.folders.length || vaultRoot() ? '' : 'disabled'}>${ic('edit')}</button>
    <button class="icon-btn icon-btn--sm" data-act="tree-new-folder" aria-label="New folder" title="New folder">${ic('folderplus')}</button>
    <button class="icon-btn icon-btn--sm" data-act="tree-sort" aria-label="Change sort order" title="Change sort order" aria-haspopup="menu" aria-expanded="${S.sortMenu}">${ic('sort')}</button>
    <button class="icon-btn icon-btn--sm" data-act="tree-fold" aria-label="${S.open.size ? 'Collapse all' : 'Expand all'}" title="${S.open.size ? 'Collapse all' : 'Expand all'}">${ic(S.open.size ? 'fold' : 'unfold')}</button>
    ${searchField}
    ${S.sortMenu ? `<div class="menu card" role="menu" aria-label="Sort order">${SORTS.map(([k, l], i) => `${i && i % 2 === 0 ? '<div class="menu-sep"></div>' : ''}<button class="menu-item" role="menuitemradio" aria-checked="${S.sort === k}" data-act="sort" data-v="${k}">${l}</button>`).join('')}</div>` : ''}</div>`;
  // Phase 2: "#tag" finds notes with that tag (on the title line or written in the text); anything else matches titles, folders and tags
  const q = S.search.trim().toLowerCase(), tq = q.startsWith('#') ? q.slice(1) : null;
  const hits = !q ? [] : D.notes.filter(n => tq !== null ? n.tags.some(t => t.toLowerCase().startsWith(tq)) || (tq && n.md.toLowerCase().includes('#' + tq)) : (n.title + ' ' + folderPath(n.folder).join(' ') + ' ' + n.tags.join(' ')).toLowerCase().includes(q));
  const body = loading ? skelList(6) : !D.projects.length && !D.folders.length
      ? `<div class="empty empty--compact"><div class="empty-title">No folders yet</div><div class="empty-text">A top-level folder is a project: its notes, tasks and timed sessions live together.</div><button class="btn btn--primary btn--sm" data-act="tree-new-folder">${ic('folderplus')}New folder</button></div>`
    : q ? `<div class="side-section" id="notes-list">${hits.map(n => `<button class="list-item" data-act="note" data-v="${n.id}" ${n.id === S.noteId ? 'aria-current="true"' : ''} title="${esc(n.title)}"><span class="list-item-main"><span class="list-item-title truncate">${esc(n.title)}</span><span class="list-item-sub truncate">${esc(folderPath(n.folder).join(' / '))}</span></span></button>`).join('')
        || `<div class="empty empty--compact"><div class="empty-text">No notes match "${esc(S.search)}".</div><button class="btn btn--ghost btn--sm" data-act="clear-search">Clear search</button></div>`}</div>`
    : `<div class="tree" role="tree" aria-label="Vault folders" data-tree-root>${treeHtml(null, 0)}</div>`;
  // Build C (QC round 1): _inbox.md and stickynoted are pinned under the scrolling list, always in view (also while searching)
  return `<aside class="sidebar" id="left-sidebar" aria-label="Notes">${actions}<div class="side-body">${body}</div>${loading ? '' : sysRows()}</aside>`;
}
function treeActivate(kind, id, newTabKey) {
  S.sel = { kind, id }; S.ctx = null;
  if (kind === 'folder') { S.open.has(id) ? S.open.delete(id) : S.open.add(id); S.focus = { sel: `[data-tree][data-v="${id}"]` }; renderAll(); }
  else if (['html', 'pdf'].includes(kind)) return;   // HTML studio and PDF: coming soon
  else if (kind === 'inbox' || kind === 'stickies') captureTree(kind);   // Phase 6A
  else { S.focus = { sel: `[data-tree][data-v="${id}"]` }; openNote(id, true, newTabKey); }
}
function treeKey(e) {
  const row = e.target, rows = [...app.querySelectorAll('[data-tree]')], i = rows.indexOf(row), kind = row.dataset.tree, id = row.dataset.v;
  const go = r => { if (!r) return; rows.forEach(x => x.tabIndex = -1); r.tabIndex = 0; r.focus(); };
  if (e.key === 'ArrowDown') { e.preventDefault(); go(rows[i + 1]); }
  else if (e.key === 'ArrowUp') { e.preventDefault(); go(rows[i - 1]); }
  else if (e.key === 'Home') { e.preventDefault(); go(rows[0]); }
  else if (e.key === 'End') { e.preventDefault(); go(rows[rows.length - 1]); }
  else if (e.key === 'ArrowRight' && kind === 'folder') { e.preventDefault(); if (!S.open.has(id)) { S.open.add(id); S.focus = { sel: `[data-tree][data-v="${id}"]` }; renderAll(); } else go(rows[i + 1]); }
  else if (e.key === 'ArrowLeft') { e.preventDefault(); if (kind === 'folder' && S.open.has(id)) { S.open.delete(id); S.focus = { sel: `[data-tree][data-v="${id}"]` }; renderAll(); }
    else { const parent = kind === 'note' ? D.notes.find(n => n.id === id).folder : ['html', 'pdf'].includes(kind) ? D.files.find(f => f.id === id)?.folder : folderById(id)?.parent; go(app.querySelector(`[data-tree="folder"][data-v="${parent}"]`)); } }
  else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); treeActivate(kind, id, e.ctrlKey || e.metaKey); }
  else if (e.key === 'F2' && (kind === 'note' || kind === 'folder')) { e.preventDefault(); startRename(kind, id); }
  else if (e.key === 'Delete' && (kind === 'note' || kind === 'folder')) { e.preventDefault(); askDelete(kind, id); }
  else if (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) { e.preventDefault(); const r = row.getBoundingClientRect(); openContext(kind, id, r.left + 24, r.bottom); }
}
/* ---- Phase 2: explorer actions. With a live vault each one asks the backend first and changes the tree only when it said yes;
        a refusal shows its reason and the tree reloads. On the sample vault they change the tree alone, as the mockup did ---- */
const siblingsOf = parent => parent === null ? [...D.projects, ...D.folders.filter(f => f.parent === null)] : D.folders.filter(f => f.parent === parent);
const placeArgs = target => isProj(target) ? [null, rawId(target)] : [rawId(target), null];   // [folder_id, project_id] for the API
function uniqueName(base, parent, kind) {
  const taken = (kind === 'note' ? D.notes.filter(n => n.folder === parent).map(n => n.title) : siblingsOf(parent).map(x => x.name)).map(x => x.toLowerCase());
  let name = base, k = 1; while (taken.includes(name.toLowerCase())) name = `${base} ${k++}`; return name;
}
function targetFolder() { return S.sel?.kind === 'folder' ? S.sel.id : note()?.folder || D.projects[0]?.id || D.folders.find(f => f.parent === null)?.id; }
async function newItem(kind, inFolder) {
  if (S.busy) return;
  if (kind === 'note') {
    const folder = inFolder || targetFolder(); if (!folder && !vaultRoot()) { toast('Create a folder first: notes live inside a project folder'); return; }   // Build V: in a vault it goes to Unsorted (the vault's top)
    const title = uniqueName('Untitled', folder, 'note'); let id = 'note-' + Date.now(), home = folder, mtime = iso(NOW), ctime = mtime;
    if (VAULT.live) {
      const [f, p] = placeArgs(folder); S.busy = true; const r = await nv('save_note', null, title, '', rootProject(folder)?.name || '', p, '', f); S.busy = false;
      if (failed(r)) { explorerError(r); return; }
      id = 'n-' + r.id; home = homeOf(r) || folder; mtime = ctime = r.updated_at;
    }
    D.notes.unshift({ id, title, category: '', oldCategory: '', folder: home, tags: [], md: '', mtime, ctime });
    UI.view = 'notes'; S.search = '';
    ancestors(home).forEach(f => S.open.add(f)); S.sel = { kind: 'note', id }; status(`Created "${title}" in ${folderPath(home).join(' / ') || 'the vault'}`);
    S.focus = { sel: '#note-title-input', select: true }; openNote(id, true, true); return;
  }
  // A new folder at the top level is a project folder (its notes, tasks and timed sessions live together)
  const parent = topOf(inFolder === '__root' || !D.projects.length ? null : inFolder || (S.sel?.kind === 'folder' ? S.sel.id : note()?.folder ?? null));
  const name = uniqueName('Untitled', parent, 'folder'); let id = (parent === null ? 'p-' : 'f-') + Date.now(), color = (D.projects.length % 6) + 1;
  if (VAULT.live) {
    S.busy = true; const r = parent === null ? await nv('create_project', name) : await nv('create_folder', name, ...placeArgs(parent)); S.busy = false;
    if (failed(r)) { explorerError(r); return; }
    id = (parent === null ? 'p-' : 'f-') + r.id; color = r.color_slot || color;
  }
  if (parent === null) D.projects.push({ id, name, color }); else { D.folders.push({ id, name, parent }); ancestors(parent).forEach(f => S.open.add(f)); }
  S.search = ''; S.sel = { kind: 'folder', id }; startRename('folder', id);
}
function startRename(kind, id) { S.rename = { kind, id, draft: null }; S.renameErr = ''; S.ctx = null; S.focus = { sel: '#rename-input', select: true }; renderAll(); }
async function commitRename() {
  const r = S.rename; if (!r || r.busy) return; const inp = document.getElementById('rename-input'); const name = (inp ? inp.value : r.draft || '').trim();
  const isNote = r.kind === 'note', n = isNote && D.notes.find(x => x.id === r.id), parent = isNote ? n.folder : folderById(r.id)?.parent ?? null;
  const sibs = isNote ? D.notes.filter(x => x.folder === parent && x.id !== r.id).map(x => x.title) : siblingsOf(parent).filter(x => x.id !== r.id).map(x => x.name);
  const err = !name ? 'Type a name.' : BAD_NAME.test(name) ? 'Names can\'t contain \\ / : * ? " < > |' : name === '.' || name === '..' ? 'That name is kept for the system.' : sibs.some(x => x.toLowerCase() === name.toLowerCase()) ? `"${name}" already exists in this folder.` : '';
  const fail = msg => { S.renameErr = msg; r.draft = name; S.focus = { sel: '#rename-input' }; renderAll(); };
  if (err) { fail(err); return; }
  const old = isNote ? n.title : folderName(r.id);
  if (name !== old) {
    if (isNote) { n.title = name; n.dirty = true; }
    if (VAULT.live) {
      r.busy = true;
      const res = isNote ? await saveNote(n) : isProj(r.id) ? await nv('update_project', rawId(r.id), name) : await nv('rename_folder', rawId(r.id), name);
      r.busy = false;
      if (failed(res)) { if (isNote) { n.title = old; n.dirty = false; SAVE.err = null; paintSave(); } fail(res.message || 'Couldn\'t rename it.'); return; }
    }
    if (!isNote) (proj(r.id) || folderById(r.id)).name = name;
  }
  S.rename = null; S.renameErr = ''; S.focus = { sel: `[data-tree][data-v="${r.id}"]` }; if (name !== old) status(`Renamed to "${name}"`); renderAll();
}
function openContext(kind, id, cx, cy) {
  const r = app.getBoundingClientRect(), z = r.width / app.offsetWidth || 1;
  S.ctx = { kind, id, x: Math.min((cx - r.left) / z, app.offsetWidth - 240), y: Math.min((cy - r.top) / z, app.offsetHeight - 260) }; S.sel = kind === 'root' || kind === 'tab' ? S.sel : { kind, id }; renderAll();
  app.querySelector('.menu--context .menu-item')?.focus();
}
function renderContextMenu() {
  const c = S.ctx; if (!c) return '';
  const it = (act, icon, label, extra = '') => `<button class="menu-item${act === 'ctx-delete' ? ' menu-item--danger' : ''}" role="menuitem" data-act="${act}" ${extra}>${ic(icon)}${label}</button>`;
  const items = c.kind === 'tab' ? it('tab-split', 'columns', 'Open to the right') + '<div class="menu-sep"></div>' + it('tab-close-ctx', 'x', 'Close tab') + it('tab-close-others', 'x', 'Close other tabs', S.tabs.length > 1 ? '' : 'disabled')
    : c.kind === 'root' ? it('ctx-new-folder', 'folderplus', 'New project folder')
    : c.kind === 'html' ? it('ctx-open', 'filecode', 'Open', soon('HTML studio')) + it('ctx-open-tab', 'plus', 'Open in a new tab', soon('HTML studio'))
    : c.kind === 'pdf' ? it('ctx-pdf', 'filepdf', 'Convert to Markdown', soon('PDF to Markdown'))
    : c.kind === 'inbox' || c.kind === 'stickies' ? it('ctx-open', c.kind === 'inbox' ? 'inbox' : 'sticky', 'Open')   // Phase 6A
    : c.kind === 'folder' ? it('ctx-new-note', 'edit', 'New note') + it('ctx-new-folder', 'folderplus', 'New folder') + it('ctx-new-html', 'filecode', 'New HTML file', soon('HTML studio')) + '<div class="menu-sep"></div>' + it('ctx-rename', 'edit', 'Rename…') + it('ctx-move', 'folder', 'Move folder to…') + '<div class="menu-sep"></div>' + it('ctx-delete', 'trash', 'Delete')
    : it('ctx-open', 'notes', 'Open') + it('ctx-open-tab', 'plus', 'Open in a new tab') + '<div class="menu-sep"></div>' + it('ctx-rename', 'edit', 'Rename…') + it('ctx-move', 'folder', 'Move file to…') + '<div class="menu-sep"></div>' + it('ctx-delete', 'trash', 'Delete');
  return `<div class="menu menu--context card" role="menu" aria-label="Actions" style="left:${c.x}px;top:${c.y}px">${items}</div>`;
}
function canMove(kind, id, target) {
  if (kind === 'note') return target !== null && D.notes.find(n => n.id === id)?.folder !== target;
  if (isProj(id)) return false;   // Phase 2: project folders stay at the top level (sessions and tasks hang off them)
  if (target !== null && ancestors(target).includes(id)) return false;   // not into itself or its own subfolders
  return (folderById(id)?.parent ?? null) !== target;
}
async function moveItem(kind, id, target, fromModal) {
  if (!canMove(kind, id, target)) { if (kind === 'note' && target === null) toast('Notes live inside a folder'); else if (isProj(id)) toast('Project folders stay at the top level'); return; }
  if (VAULT.live) {
    const r = kind === 'note' ? await nv('move_note', rawId(id), ...placeArgs(target)) : await nv('move_folder', rawId(id), ...placeArgs(target));
    if (failed(r)) { S.moveItem = null; explorerError(r); return; }
  }
  if (kind === 'note') D.notes.find(x => x.id === id).folder = target; else folderById(id).parent = target;   // a move isn't an edit: the modified time stays
  if (target) ancestors(target).forEach(f => S.open.add(f));
  S.modal = null; S.moveItem = null; S.sel = { kind, id }; S.scrollTo = id;
  status(`Moved to ${target ? folderPath(target).join(' / ') : 'the top level'}`); toast('Moved'); if (fromModal) S.focus = { sel: `[data-tree][data-v="${id}"]` };
}
function openMove(kind, id) { S.moveItem = { kind, id }; S.moveQ = ''; S.modal = 'move'; S.focus = { sel: '#move-filter' }; renderAll(); }
function moveModal() {
  const m = S.moveItem, name = m.kind === 'note' ? D.notes.find(n => n.id === m.id)?.title : folderName(m.id), q = S.moveQ.trim().toLowerCase();
  const all = []; const walk = (pid, depth) => childrenOf(pid).fs.forEach(f => { all.push({ id: f.id, depth, path: folderPath(f.id).join(' / ') }); walk(f.id, depth + 1); }); walk(null, 0);
  const opts = all.filter(f => canMove(m.kind, m.id, f.id) && (!q || f.path.toLowerCase().includes(q)));
  return dlg({ id: 'move', size: 'md', top: true, title: `Move "${esc(name)}" to…`, titleId: 'mvt', titleCls: 'truncate',   // Build L: R41's anatomy, medium
    pre: `<input class="picker-input" id="move-filter" data-act="move-filter" placeholder="Type a folder name" value="${esc(S.moveQ)}" aria-label="Filter folders">
    <div class="picker-list">${m.kind === 'folder' && canMove('folder', m.id, null) && !q ? `<button class="list-item" data-act="move-to" data-v="__root"><span class="list-item-main"><span class="list-item-title">Top level</span><span class="list-item-sub">Beside the project folders</span></span></button>` : ''}
      ${opts.map(f => `<button class="list-item list-item--tree" data-act="move-to" data-v="${f.id}" style="--depth:${q ? 0 : f.depth}"><span class="tree-name">${esc(q ? f.path : folderName(f.id))}</span></button>`).join('') || '<div class="empty empty--compact"><div class="empty-text">No folder matches.</div></div>'}</div>` });
}
async function askDelete(kind, id) {
  if (kind === 'folder' && isProj(id)) {   // a project with timed sessions can't go: the Timer's history needs it
    const stats = VAULT.live ? await nv('get_project_time_stats') : null;
    const busy = VAULT.live ? Array.isArray(stats) && stats.some(x => 'p-' + x.id === id && x.session_count) : D.sessions.some(x => x.project_id === id);
    if (busy) { toast(`"${proj(id).name}" has timed sessions, so it can't be deleted`); return; }
  }
  return deleteItem(kind, id);   // Build L (R41): no confirm; it's done at once, with Undo for 10 seconds
}
// Build L: deleting is held for 10 seconds (dialogs.js hold): it leaves the tree at once, Undo puts it back where it was,
// and the backend's delete runs when the 10 seconds are up (or at the next delete, or when the window closes).
// Tasks linked to a deleted note stay on the board, unlinked.
async function deleteItem(kind, id) {
  if (S.busy) return;
  await flushSaves();   // its last edits are saved first, so Undo brings back what you had
  const gone = new Set(kind === 'note' ? [] : [id, ...D.folders.filter(f => ancestors(f.id).includes(id)).map(f => f.id)]);
  const ns = kind === 'note' ? [id] : D.notes.filter(x => gone.has(x.folder)).map(x => x.id);
  const name = kind === 'note' ? D.notes.find(n => n.id === id)?.title || 'Untitled' : folderName(id);
  const at = (list, keep) => list.map((x, i) => [i, x]).filter(([, x]) => keep(x));
  const was = { notes: at(D.notes, x => ns.includes(x.id)), folders: at(D.folders, f => gone.has(f.id)), projects: at(D.projects, x => x.id === id),
    links: D.tasks.filter(t => ns.includes(t.noteId)).map(t => [t, t.noteId]), noteId: S.noteId };
  const putBack = (list, items) => items.forEach(([i, x]) => { if (!list.includes(x)) list.splice(Math.min(i, list.length), 0, x); });
  hold({ msg: kind === 'note' ? `Deleted “${name}”` : `Deleted “${name}”${ns.length ? ` with ${ns.length} note${ns.length === 1 ? '' : 's'}` : ''}`,
    back: `“${name}” is back`,
    apply() {
      D.notes.filter(x => ns.includes(x.id)).forEach(x => { clearTimeout(x.saveT); x.dirty = x.docDirty = false; });
      D.notes = D.notes.filter(x => !ns.includes(x.id)); D.tasks.forEach(t => { if (ns.includes(t.noteId)) t.noteId = null; });
      D.folders = D.folders.filter(f => !gone.has(f.id)); D.projects = D.projects.filter(x => x.id !== id);
      if (SAVE.err && ns.includes(SAVE.err.id)) { SAVE.err = null; paintSave(); }
      if (!D.notes.find(x => x.id === S.noteId)) S.noteId = D.notes[0]?.id ?? null;
      S.modal = null; S.sel = null;
    },
    undo() {
      putBack(D.notes, was.notes); putBack(D.folders, was.folders); putBack(D.projects, was.projects);
      was.links.forEach(([t, nid]) => { if (!t.noteId) t.noteId = nid; });
      if (ns.includes(was.noteId)) S.noteId = was.noteId; S.sel = { kind, id }; S.scrollTo = id;
    },
    async commit() {
      if (!VAULT.live) return null;
      let r = { status: 'success' };
      if (kind === 'note') r = await nv('delete_note', rawId(id));
      else if (!isProj(id)) r = await nv('delete_folder', rawId(id), true);
      else {   // a project folder: its folders and the notes at its root first, then the project
        for (const f of was.folders.map(x => x[1]).filter(x => x.parent === id)) { if (failed(r)) break; r = await nv('delete_folder', rawId(f.id), true); }
        for (const nid of was.notes.map(x => x[1]).filter(x => x.folder === id).map(x => x.id)) { if (failed(r)) break; r = await nv('delete_note', rawId(nid)); }
        if (!failed(r)) r = await nv('delete_project', rawId(id));
      }
      if (failed(r) && kind !== 'note') { explorerError(r); return null; }   // part of a folder may have gone: the vault is read again
      return r;
    } });
}
/* ---- Karaoke read-aloud, bionic reading and zen's active paragraph: decorations on the rendered note ---- */
// Phase 6C: while the read bar is open, every word becomes a .ka-w span with its number (data-w) and its sentence's
// (data-s, on the spaces too, so the sentence tint has no gaps). A new block or a word ending in . ! or ? starts a sentence.
function decorateDoc() {
  const readDoc = S.modal === 'read' ? readDocEl() : null, doc = readDoc || app.querySelector('.doc'); if (!doc) return;
  const reading = !!readDoc, bion = S.a11y.bionic;
  if (!reading && !bion) return;
  doc.setAttribute('contenteditable', 'false'); doc.classList.add('is-reading');
  const walker = document.createTreeWalker(doc, NodeFilter.SHOW_TEXT, { acceptNode: n => n.parentElement.closest('code, pre, .chip, button, details:not([open]) > :not(summary), .clip, .att-embed, .att-img, .att-src') || !n.textContent.trim() ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT });
  const nodes = []; while (walker.nextNode()) nodes.push(walker.currentNode);
  let wi = 0, si = 0, lastBlock = null;
  nodes.forEach(node => {
    const block = node.parentElement.closest('p, li, h1, h2, h3, h4, h5, h6, blockquote, .task, td, th, summary');
    if (block !== lastBlock) { if (lastBlock) si++; lastBlock = block; }
    if (reading && node.parentElement.closest('.wikilink')) {   // QC 84: a link is one word, read as its label (or its note's name), never as [[…|…]]
      const span = document.createElement('span'); span.className = 'ka-w'; span.dataset.w = wi++; span.dataset.s = si; span.dataset.say = readSayLink(node.textContent); span.textContent = node.textContent;
      node.replaceWith(span); return; }
    const frag = document.createDocumentFragment();
    node.textContent.split(/(\s+)/).forEach(part => {
      if (!part) return;
      const span = document.createElement('span');
      if (/^\s+$/.test(part)) { span.textContent = part; if (reading) span.dataset.s = si; frag.appendChild(span); return; }
      if (reading) { span.className = 'ka-w'; span.dataset.w = wi++; span.dataset.s = si; }
      if (bion) { const k = Math.max(1, Math.ceil(part.length * .45)); const b = document.createElement('b'); b.className = 'bionic'; b.textContent = part.slice(0, k); span.append(b, part.slice(k)); }
      else span.textContent = part;
      frag.appendChild(span);
      if (/[.!?]["')\]]*$/.test(part)) si++;
    });
    node.replaceWith(frag);
  });
}
function markActiveBlock() {
  if (UI.zen !== 'on') return; const doc = app.querySelector('.doc'); if (!doc) return;
  const sel = getSelection(); let el = sel.rangeCount && doc.contains(sel.anchorNode) ? sel.anchorNode : null;
  while (el && el.parentNode !== doc) el = el.parentNode;
  if (!el || el.nodeType !== 1) el = doc.querySelector(':scope > p') || doc.firstElementChild;
  doc.querySelectorAll(':scope > .is-active-block').forEach(x => x !== el && x.classList.remove('is-active-block')); el?.classList.add('is-active-block');
}

/* ---- Reading ruler: a band that follows the pointer or the caret ---- */
const rulerOn = () => S.a11y.ruler && UI.zen !== 'on' || S.a11y.ruler && UI.view === 'notes';
function placeRuler(clientY) {
  const r = app.querySelector('[data-ruler]'); if (!r) return; const m = r.parentElement, rect = m.getBoundingClientRect(), z = rect.width / m.offsetWidth || 1;
  S.rulerY = clamp((clientY - rect.top) / z - r.offsetHeight / 2, 0, m.offsetHeight - r.offsetHeight); r.style.top = S.rulerY + 'px';
}
function sizeRuler() {
  const r = app.querySelector('[data-ruler]'); if (!r) return; const doc = app.querySelector('.doc');
  const lh = doc ? parseFloat(getComputedStyle(doc).lineHeight) : 28; r.style.height = Math.round(lh * S.a11y.rulerLines + 10) + 'px';
  r.style.top = clamp(S.rulerY, 0, r.parentElement.offsetHeight - r.offsetHeight) + 'px';
}
/* ---- Offline dictionary, synonym swapper, spelling and homophone guard ---- */
const DICT = {
  consolidate: ['verb', 'Combine several things into one stronger, simpler whole.', ['combine', 'unify', 'merge', 'strengthen']],
  roadmap: ['noun', 'A plan that shows the steps and dates toward a goal.', ['plan', 'schedule', 'blueprint', 'outline']],
  milestone: ['noun', 'An important point or event in a project.', ['landmark', 'checkpoint', 'stage']],
  freeze: ['noun', 'A time when no more changes are allowed.', ['halt', 'stop', 'lock']],
  conflict: ['noun', 'A clash between two versions or ideas.', ['clash', 'disagreement', 'collision']],
  resolution: ['noun', 'The way a problem is settled.', ['answer', 'fix', 'settlement', 'solution']],
  finalise: ['verb', 'Finish the last details of something.', ['complete', 'settle', 'wrap up', 'conclude']],
  editing: ['noun', 'Making changes to a piece of writing.', ['revising', 'changing', 'correcting']],
  draft: ['noun', 'An early version that will change.', ['outline', 'sketch', 'first version']],
  reference: ['verb', 'Mention or point to something.', ['cite', 'mention', 'link to']],
};
const HOMO = { their: '"their" means it belongs to them: their desks.', there: '"there" is a place: over there.', "they're": '"they\'re" is short for "they are".', affect: '"affect" is usually a verb: noise affects focus.',
  effect: '"effect" is usually a noun, the result: a calming effect.', quiet: '"quiet" means not loud.', quite: '"quite" means very, or completely.', lose: '"lose" means to misplace: lose a file.', loose: '"loose" means not tight.', accept: '"accept" means to say yes to.', except: '"except" means apart from.' };
const HOMO_SWAP = { their: ['there', "they're"], there: ['their', "they're"], "they're": ['their', 'there'], affect: ['effect'], effect: ['affect'], quiet: ['quite'], quite: ['quiet'], lose: ['loose'], loose: ['lose'], accept: ['except'], except: ['accept'] };
const SPELL = { recieve: 'receive', definately: 'definitely', seperate: 'separate', occured: 'occurred', wich: 'which' };
function proofMark(html) {   // spans for misspellings and confusable words, on text only (never inside tags)
  if (!S.a11y.spell && !S.a11y.homophones) return html;
  const words = [...(S.a11y.spell ? Object.keys(SPELL) : []), ...(S.a11y.homophones ? Object.keys(HOMO) : [])].map(w => w.replace("'", "(?:'|&#39;)"));
  const re = new RegExp(`(^|[^\\p{L}'])(${words.join('|')})(?![\\p{L}])`, 'giu');
  let inCode = 0;
  return html.split(/(<[^>]+>)/).map(seg => { if (seg.startsWith('<')) { if (/^<code/.test(seg)) inCode++; if (/^<\/code/.test(seg)) inCode--; return seg; } return inCode ? seg : seg.replace(re, (m, pre, w) => { const k = w.toLowerCase().replace('&#39;', "'");
    // v0.1.1 should-fix 6: the hint is NeuroVault's own tooltip (data-tip; tooltip.js draws it for these marks inside the note), never Windows'
    return SPELL[k] ? `${pre}<span class="spell" data-word="${w}" data-tip="Spelling: did you mean ${SPELL[k]}?">${w}</span>` : `${pre}<span class="homophone" data-word="${w}" data-tip="${esc(HOMO[k])} Easily swapped with ${HOMO_SWAP[k].join(' or ')}.">${w}</span>`; }); }).join('');
}

/* ---- Editor toolbar in two zones (Markdown | HTML extensions) and its pickers ---- */
const CODE_LANGS = ['Plain text', 'JavaScript', 'Python', 'HTML', 'CSS', 'SQL', 'Bash', 'JSON'];
function zonesRibbon() {
  const b = (c, t, k) => `<button class="ed-btn" data-fmt="${c}" aria-label="${t}" title="${t}">${ic(k)}</button>`;
  const dd = (p, t, k) => `<button class="ed-btn" data-act="ed-pop" data-v="${p}" aria-label="${t}" title="${t}" aria-haspopup="true" aria-expanded="${S.edPop === p}">${ic(k)}<span class="ed-caret" aria-hidden="true">${ic('down')}</span></button>`;
  const zoneA = `<div class="ed-zone" role="group" aria-label="Markdown"><select class="field ed-block" data-fmt-block aria-label="Text style"><option value="p">Text</option>${[1, 2, 3, 4, 5, 6].map(i => `<option value="h${i}">Heading ${i}</option>`).join('')}<option value="blockquote">Quote</option></select>
    ${b('bold', 'Bold (Ctrl+B)', 'bold')}${b('italic', 'Italic (Ctrl+I)', 'italic')}${b('strike', 'Strikethrough', 'strike')}${b('quote', 'Quote', 'quote')}
    ${b('ul', 'Bullet list', 'ul')}${b('ol', 'Numbered list', 'ol')}${b('task', 'Task checkbox', 'check')}${dd('code', 'Code block', 'codeblock')}${b('hr', 'Horizontal line', 'minus')}
    ${b('link', 'Link', 'link')}${b('wiki', 'Link to a note', 'brackets')}${b('image', 'Image', 'image')}${dd('table', 'Table', 'table')}</div>`;
  const zoneB = S.a11y.zoneB ? `<span class="ed-zone-sep" aria-hidden="true"></span><div class="ed-zone ed-zone--html" role="group" aria-label="HTML extensions"><span class="html-badge" title="These add HTML tags to the .md file">&lt;HTML&gt;</span>
    ${b('underline', 'Underline', 'underline')}${dd('hl', 'Highlight', 'highlighter')}${dd('tc', 'Text colour', 'baseline')}${b('alignleft', 'Align left', 'alignl')}${b('aligncenter', 'Align centre', 'alignc')}${b('alignright', 'Align right', 'alignr')}
    ${b('sub', 'Subscript', 'subscript')}${b('sup', 'Superscript', 'superscript')}${b('fold', 'Collapsible section', 'fold')}</div>` : '';
  // R11 (Editor toolbar layout: one row): buttons that don't fit move into ⋯, filled in by fitToolbar() once the row is measured
  const more = `<span class="ed-more-wrap is-ovf"><button class="ed-btn ed-more" data-act="ed-more" aria-haspopup="menu" aria-expanded="${!!S.edMore}" aria-label="More formatting" title="More formatting">${ic('more')}</button>${S.edMore ? '<div class="menu card ed-more-menu" role="menu" aria-label="More formatting"></div>' : ''}</span>`;
  return `<div class="ed-toolbar ed-toolbar--zones card" role="toolbar" aria-label="Formatting">${zoneA}${zoneB}${more}${modeGroup()}${edPopover()}</div>`;
}
// R11: the order buttons leave the row in when it's too narrow: the HTML zone from its end, then the less-used Markdown buttons
const ED_OVERFLOW = ['fold', 'sup', 'sub', 'alignright', 'aligncenter', 'alignleft', 'tc', 'hl', 'underline', 'hr', 'image', 'wiki', 'quote', 'strike', 'code', 'task', 'table', 'link', 'ol', 'ul', 'italic'];
function fitToolbar() { app.querySelectorAll('.ed-toolbar--zones').forEach(fitOne); }   // both panes when two tabs sit side by side
function fitOne(tb) {
  const wrap = tb.querySelector('.ed-more-wrap'), zb = tb.querySelector('.ed-zone--html'), hidden = [];
  tb.querySelectorAll('.is-ovf').forEach(e => e.classList.remove('is-ovf'));   // Fix A (QC 3 · 26): ⋯ always shows (it holds Check spelling)
  if (tb.scrollWidth > tb.clientWidth + 1) {
    for (const k of ED_OVERFLOW) {
      const b = tb.querySelector(`.ed-zone [data-fmt="${k}"], .ed-zone [data-act="ed-pop"][data-v="${k}"]`); if (!b) continue;
      b.classList.add('is-ovf'); hidden.push(b);
      if (zb && !zb.querySelector('.ed-btn:not(.is-ovf)')) zb.classList.add('is-ovf');
      if (tb.scrollWidth <= tb.clientWidth + 1) break;
    }
  }
  const m = tb.querySelector('.ed-more-menu'); if (!m) return;
  const attr = b => ['fmt', 'act', 'v'].filter(k => b.dataset[k]).map(k => `data-${k}="${esc(b.dataset[k])}"`).join(' ');
  m.innerHTML = `<button class="menu-item" role="menuitem" data-act="spell-pass">${ic('check')}Check spelling<span class="menu-kbd">F7</span></button>${hidden.length ? '<div class="menu-sep"></div>' : ''}`   // Fix A (QC 3 · 26): first, always in reach
    + hidden.slice().reverse().map(b => `<button class="menu-item" role="menuitem" ${attr(b)}${b.hasAttribute('data-soon') ? ' ' + soon(b.getAttribute('aria-label')) : ''}>${b.querySelector('svg')?.outerHTML || ''}${esc(b.getAttribute('aria-label'))}</button>`).join('');
  const room = innerHeight - m.getBoundingClientRect().top - 12; m.style.maxHeight = room > 160 ? room + 'px' : ''; m.style.overflowY = room > 160 ? 'auto' : '';   // inside the window, scrolling when long
}
function edPopover() {
  const p = S.edPop; if (!p) return '';
  if (p === 'link') return edLinkBox();   // Editor QC: the link box (editor.js)
  const wrap = (label, inner) => `<div class="card popover ed-pop" data-anchor-ed="${p}" role="dialog" aria-label="${label}">${inner}</div>`;
  if (p === 'table') { const [r, c] = S.gridHover; return wrap('Insert a table', `<div class="grid-pick" role="group" aria-label="Table size">${Array.from({ length: 6 }, (_, i) => Array.from({ length: 8 }, (_, j) => `<button class="grid-cell${i < r && j < c ? ' is-on' : ''}" data-act="table-insert" data-r="${i + 1}" data-c="${j + 1}" aria-label="${i + 1} rows by ${j + 1} columns"></button>`).join('')).join('')}</div>
    <div class="list-item-sub num" data-grid-label>${r && c ? `${r} × ${c} table` : 'Hover to pick a size'}</div><button class="btn btn--secondary btn--sm" data-act="table-beautify">Auto-beautify tables</button>`); }
  if (p === 'hl') return wrap('Highlight colour', `<div class="swatch-row">${['yellow', 'green', 'blue', 'pink', 'orange'].map(c => `<button class="hl-dot hl-${c}" data-act="fmt-hl" data-v="${c}" aria-label="${c} highlight" title="${c[0].toUpperCase() + c.slice(1)}"></button>`).join('')}</div><button class="btn btn--ghost btn--sm" data-act="fmt-hl" data-v="none">Remove highlight</button>`);
  if (p === 'tc') return wrap('Text colour', `<div class="swatch-row">${['red', 'orange', 'green', 'blue', 'violet', 'grey'].map(c => `<button class="hl-dot hl-dot--text tc-${c}" data-act="fmt-tc" data-v="${c}" aria-label="${c} text" title="${c[0].toUpperCase() + c.slice(1)}">A</button>`).join('')}</div>`);
  return wrap('Code block language', CODE_LANGS.map(l => `<button class="menu-item" data-act="fmt-code" data-v="${l}">${l}</button>`).join(''));
}
const attachPlaceholder = name => `<span class="attach" contenteditable="false"><img alt="${esc(name)}" src="data:image/svg+xml;utf8,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="320" height="140"><rect width="320" height="140" rx="10" fill="#d9d4c7"/><path d="M40 110l60-50 40 30 50-45 90 65z" fill="#9c9483"/><circle cx="80" cy="45" r="14" fill="#9c9483"/></svg>')}"><span class="attach-cap">${esc(name)}</span></span>&nbsp;`;
/* ---- The reading-mode note and tree rows for files ---- */
const readingNote = () => S.a11y.bionic || S.modal === 'read' ? `<div class="reading-note">${ic(S.modal === 'read' ? 'volume' : 'type')}<span>${S.modal === 'read' ? 'Reading aloud' : 'Bionic reading is on'}: editing is paused.</span><button class="link-btn" data-act="${S.modal === 'read' ? 'close' : 'a11y-toggle'}" data-v="bionic">${S.modal === 'read' ? 'Stop reading' : 'Turn it off'}</button></div>` : '';   // Phase 6C: and while reading aloud
function fileRow(f, depth) {
  const dot = f.name.lastIndexOf('.');   // HTML studio and PDF to Markdown come later: the files show, dimmed
  return `<div class="list-item list-item--tree is-file" role="treeitem" tabindex="-1" data-tree="${f.kind}" data-v="${f.id}" style="--depth:${depth}" ${soon(f.name + (f.kind === 'pdf' ? ' · PDF to Markdown' : ' · HTML studio'))}><span class="tree-spacer"></span><span class="tree-file" aria-hidden="true">${ic(f.kind === 'pdf' ? 'filepdf' : 'filecode')}</span><span class="tree-name">${esc(f.name.slice(0, dot))}</span><span class="tree-ext">${esc(f.name.slice(dot))}</span></div>`;
}
function sysRows() {
  if (!D.projects.length) return '';
  // R10: the name is the file or folder's real name, and the count sits on the right like every other list count
  // Build C: pinned outside the folder tree, so they are their own small tree with one Tab stop (the chosen row, else Brain Dump).
  // Fix C (QC 20): they read as names, Brain Dump and Sticky Notes; the files stay _inbox.md and stickynoted/
  const stop = ['inbox', 'stickies'].includes(S.sel?.kind) ? S.sel.kind : 'inbox';
  return `<div class="tree-sys" role="tree" aria-label="Vault root">${[['inbox', 'inbox', 'Brain Dump', D.inbox.length, 'thought', 'Brain Dump: your captured thoughts (Ctrl+Shift+D)'], ['stickies', 'sticky', 'Sticky Notes', D.stickies.length, 'sticky note', 'Sticky Notes: show them all']].map(([k, i, n, c, u, t]) =>
    `<div class="list-item list-item--tree is-sys" role="treeitem" tabindex="${k === stop ? 0 : -1}" aria-level="1" data-tree="${k}" data-v="${k}" style="--depth:0" title="${t}"><span class="tree-spacer"></span><span class="tree-file" aria-hidden="true">${ic(i)}</span><span class="tree-name">${n}</span><span class="list-item-count num" aria-label="${c} ${u}${c === 1 ? '' : 's'}">${c}</span></div>`).join('')}</div>`;
}
// Ctrl+S: saving shows in the status bar (R8: no Save button in the header)
function save() { const n = note(); if (n) saveNote(n, true); }   // Phase 2: Ctrl+S and Retry save now (sample vault: the mockup's pretend save)

/* ---- Bug fix 2026-10-16: split view ----
   The .md side grows to fit its text (no inner scroll bar or resize corner: the page has the one scroll bar),
   and follows typing in the document side, a moment after the last key, instead of only after a mode switch. */
// Fix A (QC 3 · 23): each note view's own height, for the room after the note (app.css): a split pane is shorter than the window
const NOTE_RO = window.ResizeObserver ? new ResizeObserver(es => es.forEach(e => e.target.style.setProperty('--pane-h', e.target.clientHeight + 'px'))) : null;
function notePaneRoom() { NOTE_RO?.disconnect(); app.querySelectorAll('.view--note').forEach(v => { v.style.setProperty('--pane-h', v.clientHeight + 'px'); NOTE_RO?.observe(v); }); }   // disconnect: a redraw makes new views, the old ones go
function fitRaw() {
  notePaneRoom();
  const ta = app.querySelector('#raw-markdown-textarea'); if (!ta) return;
  // Fix A (QC 3 · 23): the "auto" height for a moment shrank the page, so the note's scroll went back to the top as you
  // typed at the end. The scroll stays, and the line you're typing on is kept clear of the bottom (a quarter of the pane)
  const v = ta.closest('.view'), top = v?.scrollTop;
  ta.style.height = 'auto'; ta.style.height = ta.scrollHeight + 'px';
  if (!v) return; v.scrollTop = top;
  if (document.activeElement === ta) rawCaretInView(ta);
}
// The page scrolls with the caret in the .md side (the grown box has no scroll of its own, so PageDown, the arrows and
// Ctrl+End moved the caret off screen): clear of the toolbar at the top and of the bottom quarter
function rawCaretInView(ta) {
  const v = ta.closest('.view'); if (!v) return;
  const lines = ta.value.split('\n').length, lh = parseFloat(getComputedStyle(ta).lineHeight) || 20;
  const y = ta.getBoundingClientRect().top + (ta.offsetHeight - lh) * (ta.value.slice(0, ta.selectionEnd).split('\n').length - 1) / Math.max(1, lines - 1), vr = v.getBoundingClientRect();
  if (y + lh > vr.bottom - v.clientHeight / 4) v.scrollTop += y + lh - (vr.bottom - v.clientHeight / 4);
  else if (y < vr.top + 64) v.scrollTop -= vr.top + 64 - y;
}
app.addEventListener('keydown', e => {
  const ta = e.target; if (ta.id !== 'raw-markdown-textarea') return;
  if (/^Page(Up|Down)$/.test(e.key) && !e.ctrlKey && !e.altKey) {   // a page of the note view (the grown box's own "page" is a few lines)
    const v = ta.closest('.view'); if (!v) return; e.preventDefault();
    const n = Math.max(1, Math.floor(v.clientHeight * .85 / (parseFloat(getComputedStyle(ta).lineHeight) || 20))), down = e.key === 'PageDown';
    const ls = ta.value.split('\n'), at = ta.value.slice(0, ta.selectionEnd).split('\n'), row = at.length - 1, col = at[row].length;
    const to = clamp(row + (down ? n : -n), 0, ls.length - 1), pos = ls.slice(0, to).reduce((s, l) => s + l.length + 1, 0) + Math.min(col, ls[to].length);
    if (e.shiftKey) ta.setSelectionRange(Math.min(ta.selectionStart, pos), Math.max(ta.selectionStart, pos)); else ta.setSelectionRange(pos, pos);
    v.scrollTop += (down ? 1 : -1) * v.clientHeight * .85; rawCaretInView(ta); return;
  }
  if (/^(Arrow(Up|Down)|Home|End|Enter|Backspace|Delete)$/.test(e.key)) setTimeout(() => rawCaretInView(ta));
});
function liveRaw(n) {
  if (S.mode !== 'split') return;
  clearTimeout(liveRaw.t);
  liveRaw.t = setTimeout(() => {
    const ta = app.querySelector('#raw-markdown-textarea'); if (!ta || document.activeElement === ta || note() !== n) return;
    syncDoc(n); ta.value = rawMd(n); fitRaw();
  }, 250);
}

/* ---- Bug fix 2026-10-16: the toolbar shows what's on where the caret is (bold, lists, quote, alignment…),
   with the same pressed look as the mode buttons, and the Text style list follows the block (Heading 2, Text…) ---- */
const FMT_ON = {
  bold: el => !!el.closest('b, strong'), italic: el => !!el.closest('i, em'), strike: el => !!el.closest('s, del, strike'),
  underline: el => !!el.closest('u'), sub: el => !!el.closest('sub'), sup: el => !!el.closest('sup'),
  quote: el => !!el.closest('blockquote'), task: el => !!el.closest('li') && !!edBox(el.closest('li')),
  ul: el => !!el.closest('ul') && !edBox(el.closest('li') || el), ol: el => !!el.closest('ol'),
  link: el => !!el.closest('a[href]'), wiki: el => !!el.closest('.wikilink'), fold: el => !!el.closest('details'),
  alignleft: el => (el.closest('[align]')?.getAttribute('align') || 'left') === 'left',   // Editor QC: left is where text starts out
  aligncenter: el => el.closest('[align]')?.getAttribute('align') === 'center', alignright: el => el.closest('[align]')?.getAttribute('align') === 'right',
};
function paintFmtState() {
  const doc = app.querySelector('.doc'), tb = app.querySelector('.ed-toolbar'); if (!doc || !tb) return;
  const sel = getSelection(), node = sel && sel.rangeCount ? sel.getRangeAt(0).startContainer : null;
  const el = node && doc.contains(node) ? (node.nodeType === 1 ? node : node.parentElement) : null;
  tb.querySelectorAll('[data-fmt]').forEach(b => { const f = FMT_ON[b.dataset.fmt]; if (f) b.setAttribute('aria-pressed', String(!!(el && f(el)))); });
  const noAlign = el && typeof edAlignWhy === 'function' ? edAlignWhy(el) : '';   // Fix A (QC 3 · 24): off, with the reason, where alignment can't go
  app.querySelectorAll('.ed-toolbar [data-fmt^="align"], .ed-more-menu [data-fmt^="align"]').forEach(b => { b.disabled = !!noAlign; b.title = noAlign || b.getAttribute('aria-label') || b.textContent.trim(); });
  const blk = tb.querySelector('[data-fmt-block]');
  if (blk && el) { const h = el.closest('h1, h2, h3, h4, h5, h6'); const v = h ? h.tagName.toLowerCase() : 'p'; if ([...blk.options].some(o => o.value === v)) blk.value = v; }
}

/* ---- Bug fix 2026-10-16: front matter as a Properties panel, as Obsidian shows it ----
   The note's own YAML (the --- block at the top of the .md) is read here and shown as rows: text, links you can
   Ctrl+click… (plain click here: the panel isn't editable), dates, lists as chips, tags that search the vault,
   [[wiki links]] that open the note. Read-only for now: change properties in Raw .md. The block itself stays in the
   note untouched (hidden in the editor), so saving writes it back exactly as it was. */
function parseFrontMatter(md) {
  const m = /^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/.exec(md || ''); if (!m) return null;
  const unq = v => { v = v.trim(); return /^(['"]).*\1$/.test(v) ? v.slice(1, -1) : v; };
  const rows = []; let cur = null;
  for (const line of m[1].split(/\r?\n/)) {
    const item = /^\s+-\s*(.*)$/.exec(line);
    if (item && cur) { if (!Array.isArray(cur.value)) cur.value = []; cur.value.push(unq(item[1])); continue; }
    const kv = /^([^\s:#][^:]*):\s*(.*)$/.exec(line);
    if (kv) { const v = kv[2].trim(); cur = { key: kv[1].trim(), value: /^\[.*\]$/.test(v) ? v.slice(1, -1).split(',').map(unq).filter(Boolean) : unq(v) }; rows.push(cur); continue; }
    if (cur && line.trim() && !Array.isArray(cur.value)) cur.value = (cur.value ? cur.value + ' ' : '') + line.trim();   // folded text
  }
  return rows;
}
function propValue(key, v) {
  const one = x => {
    const w = /^\[\[([^\]]+)\]\]$/.exec(x);
    if (w) { const label = w[1].split('|').pop().trim(); return `<button class="prop-chip prop-wiki" data-wiki="${esc(w[1])}" title="Open ${esc(label)}">${esc(label)}</button>`; }
    if (/^tags?$/i.test(key)) { const t = x.replace(/^#/, ''); return `<button class="prop-chip prop-tag" data-act="tag" data-v="${esc(t)}" title="Find notes tagged #${esc(t)}">${esc(t)}</button>`; }
    return `<span class="prop-chip">${esc(x)}</span>`;
  };
  if (Array.isArray(v)) return v.length ? `<span class="prop-chips">${v.map(one).join('')}</span>` : '<span class="prop-empty">Empty</span>';
  if (!v) return '<span class="prop-empty">Empty</span>';
  if (/^https?:\/\/\S+$/i.test(v)) return `<a class="prop-link" href="${esc(v)}" title="${esc(v)}">${esc(v)}</a>`;
  const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
  if (d) return `<span class="prop-date">${ic('timer')}${new Date(+d[1], +d[2] - 1, +d[3]).toLocaleDateString()}</span>`;
  if (/^\[\[[^\]]+\]\]$/.test(v) || /^tags?$/i.test(key)) return `<span class="prop-chips">${one(v)}</span>`;
  return `<span class="prop-text">${esc(v)}</span>`;
}
function propsPanel(n) {
  const rows = parseFrontMatter(n.md); if (!rows || !rows.length) return '';
  const icon = (k, v) => Array.isArray(v) ? 'ul' : /^https?:/i.test(v || '') ? 'link' : /^\d{4}-\d{2}-\d{2}$/.test(v || '') ? 'timer' : 'doctext';
  return `<section class="props" aria-label="Properties" data-md-ignore contenteditable="false"><div class="props-head">Properties<span class="props-hint">Edit in Raw .md</span></div>
    <dl class="props-list">${rows.map(r => `<div class="prop"><dt>${ic(icon(r.key, r.value))}<span>${esc(r.key)}</span></dt><dd>${propValue(r.key, r.value)}</dd></div>`).join('')}</dl></section>`;
}

/* ---- Video embeds (new, 2026-10-16): a YouTube link written as an image, ![](https://www.youtube.com/watch?v=…) as
   Obsidian embeds it, shows as a thumbnail that plays in the note when clicked. The .md keeps the link exactly as written
   (the player is an editor-only decoration, data-md-ignore). Needs an internet connection. */
function youtubeId(src) {
  const m = /^https?:\/\/(?:www\.|m\.)?(?:youtube\.com\/(?:watch\?(?:[^#]*&)?v=|embed\/|shorts\/|live\/)|youtu\.be\/)([\w-]{11})/i.exec(src || '');
  return m ? m[1] : null;
}
function embedVideos() {
  const doc = app.querySelector('.doc'); if (!doc) return;
  doc.querySelectorAll('img').forEach(img => {
    const id = youtubeId(img.getAttribute('src')); if (!id) return;
    img.classList.add('is-embedded');
    if (img.nextElementSibling?.matches('.vid-embed')) return;   // already decorated (the editor's HTML is kept between renders)
    img.insertAdjacentHTML('afterend', `<span class="vid-embed" data-md-ignore contenteditable="false" data-vid="${id}">
      <button class="vid-play" data-act="vid-play" data-v="${id}" aria-label="Play the video"><img class="vid-thumb" alt="" src="https://i.ytimg.com/vi/${id}/hqdefault.jpg"><span class="vid-btn">${ic('play')}</span></button></span>`);
  });
}
function playVideo(id) {
  const box = app.querySelector(`.vid-embed[data-vid="${id}"]`); if (!box) return;
  box.innerHTML = `<iframe class="vid-frame" src="https://www.youtube-nocookie.com/embed/${id}?autoplay=1" title="Video" allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowfullscreen referrerpolicy="strict-origin-when-cross-origin"></iframe>`;
}
