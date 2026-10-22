/* The note editor's behaviour (Editor QC, 2026-10-16). render-notes.js draws the editor and its toolbar; this file is
   what the editor does when you type, press keys and use the toolbar.
   - Undo and redo: the editor keeps its own history per note, a snapshot before each command and before each run of
     typing or deleting, so one Ctrl+Z undoes one step, toolbar commands included. Ctrl+Y and Ctrl+Shift+Z redo.
     (The browser's own undo can't follow edits made outside execCommand, and loses everything at a re-render.)
   - A re-render (a toast, a picker, a timer nudge rebuilds the window) puts the caret back where it was.
   - Commands work the same with no selection, a selection inside one line and one across lines, and never type
     placeholder text: lines (task, quote, lists, align, code block, fold) change every selected line; text commands
     (highlight, colour, link) wrap the selected text in each line, or the word at the caret.
   - Lines and blocks are changed with Range and DOM calls: insertHTML merges a block into the paragraph around it
     (lists inside lists, a heading joined to the next line, style="" spans).
   - Keys: Enter and Backspace in tasks, Delete before a task, Tab in lists and tables, Ctrl+A then Delete, Backspace,
     typing or paste, and a paste cleaned to what the note keeps. */
'use strict';
const ED_BLOCK = 'p, h1, h2, h3, h4, h5, h6, li, ul, ol, blockquote, pre, div, table, thead, tbody, tfoot, tr, td, th, details, summary, hr, section, figure';
const edIsBlock = n => n?.nodeType === 1 && n.matches(ED_BLOCK);
const edNoteOf = doc => D.notes.find(n => n.id === doc?.dataset.note);
const edEl = n => n && (n.nodeType === 1 ? n : n.parentElement);
const edNewP = () => { const p = document.createElement('p'); p.append(document.createElement('br')); return p; };
const edUnwrapEl = el => el.replaceWith(...el.childNodes);
const edSib = (n, d) => { let s = d < 0 ? n.previousSibling : n.nextSibling; while (s && s.nodeType === 3 && !s.data.trim()) s = d < 0 ? s.previousSibling : s.nextSibling; return s; };
// The editor a command is for: the one holding the selection, else the focused pane's
function edDocNow() {
  const s = getSelection(), own = s.rangeCount ? edEl(s.getRangeAt(0).startContainer)?.closest('.doc') : null;
  return own && app.contains(own) ? own : app.querySelector('.pane.is-focused .doc') || app.querySelector('.doc');
}
function edRange(doc) { const s = getSelection(); if (!s.rangeCount) return null; const r = s.getRangeAt(0); return doc.contains(r.startContainer) && doc.contains(r.endContainer) ? r : null; }
function edPut(a, b) { const r = document.createRange(); r.setStart(a[0], a[1]); r.setEnd((b || a)[0], (b || a)[1]); const s = getSelection(); s.removeAllRanges(); s.addRange(r); return r; }
function edShow() { const s = getSelection(); if (s.rangeCount) edEl(s.getRangeAt(0).endContainer)?.scrollIntoView({ block: 'nearest' }); }

/* ---- Where the selection is: as a path of child numbers (exact, for the same HTML) or as characters from the top ---- */
function edPath(root, node) { const p = []; for (; node && node !== root; node = node.parentNode) { if (!node.parentNode) return null; p.unshift([...node.parentNode.childNodes].indexOf(node)); } return node ? p : null; }
function edNode(root, path) { let n = root; for (const i of path) n = n?.childNodes[i]; return n || null; }
function edSelSave(doc) {
  const r = edRange(doc); if (!r) return null;
  return { a: edPath(doc, r.startContainer), ao: r.startOffset, b: edPath(doc, r.endContainer), bo: r.endOffset, ca: edOffset(doc, r.startContainer, r.startOffset), cb: edOffset(doc, r.endContainer, r.endOffset) };
}
function edSelLoad(doc, m, exact) {
  if (!m) return;
  try { if (!exact) throw 0; edPut([edNode(doc, m.a), m.ao], [edNode(doc, m.b), m.bo]); }
  catch (e) { edPut(edPoint(doc, m.ca), edPoint(doc, m.cb)); }
}
function edOffset(doc, node, off) { const x = document.createRange(); x.setStart(doc, 0); x.setEnd(node, off); return x.toString().length; }
function edPoint(doc, c) {
  const w = document.createTreeWalker(doc, NodeFilter.SHOW_TEXT); let t, last = null;
  while ((t = w.nextNode())) { if (c <= t.length) return [t, c]; c -= t.length; last = t; }
  return last ? [last, last.length] : [doc, doc.childNodes.length];
}

/* ---- Undo and redo ---- */
const EDH = new Map();   // note id → { undo, redo, kind of the last step, when, inputs in it }
function edHist(doc) { const id = doc.dataset.note; let h = EDH.get(id); if (!h) EDH.set(id, h = { undo: [], redo: [], kind: '', at: 0, n: 0 }); return h; }
function edSnap(doc) {
  const box = doc.cloneNode(true), live = doc.querySelectorAll('input');
  box.querySelectorAll('input').forEach((x, i) => { if (live[i]?.checked) x.setAttribute('checked', ''); else x.removeAttribute('checked'); });
  return { html: box.innerHTML, sel: edSelSave(doc) };
}
// Before a change. A command is always a step of its own; typing or deleting joins the step before it, until a pause,
// a switch between typing and deleting, 40 keys, or the editor being drawn again (its text may have changed from outside)
function edRecord(doc, kind = 'cmd') {
  const h = edHist(doc), now = Date.now();
  if (kind !== 'cmd' && kind === h.kind && now - h.at < 1000 && h.n < 40 && h.el === doc) { h.at = now; h.n++; return; }
  h.undo.push(edSnap(doc)); if (h.undo.length > 200) h.undo.shift();
  h.redo = []; h.kind = kind; h.at = now; h.n = 0; h.el = doc;
}
// After a change made here (not by the browser's own typing, which the input listener in actions.js follows)
function edChanged(doc) {
  const n = edNoteOf(doc); if (!n) return;
  noteEdited(n, true); paintTelemetry(doc.innerText); liveRaw(n); paintFmtState();
  edHist(doc).seen = doc.innerHTML;
}
function edUndo(doc, redo) {
  const h = edHist(doc), from = redo ? h.redo : h.undo;
  if (!from.length) { status(redo ? 'Nothing to redo' : 'Nothing to undo'); paintSave(); return; }
  (redo ? h.undo : h.redo).push(edSnap(doc));
  const s = from.pop(), n = edNoteOf(doc);
  doc.innerHTML = s.html;
  if (n) doc.querySelectorAll('[data-md="tasks"]').forEach(el => { el.innerHTML = taskLinesHtml(n); });   // the linked tasks as they are now
  doc.focus({ preventScroll: true }); edSelLoad(doc, s.sel, true); h.kind = ''; edChanged(doc); edShow();
}

/* ---- The caret through a re-render: noted as the window is rebuilt (syncDocs), put back after it (afterRender) ---- */
let edKeep = null, edLast = null;   // edLast: where the selection was when focus last left the note (the palette, a picker)
function edKeepCaret() {
  const doc = document.activeElement?.closest?.('.doc'), at = doc?.isContentEditable ? { id: doc.dataset.note, html: doc.innerHTML, sel: edSelSave(doc) } : null;
  if (at) edLast = at;
  edKeep = at && !S.focus ? at : null;
}
function edAfterRender() {
  app.querySelectorAll('.doc[contenteditable="true"]').forEach(doc => {
    edTail(doc);
    const h = EDH.get(doc.dataset.note); if (!h) return;
    if (h.seen != null && h.seen !== doc.innerHTML) { h.undo = []; h.redo = []; h.kind = ''; }   // changed outside the editor
    h.seen = doc.innerHTML;
  });
  const k = edKeep; edKeep = null;
  if (k) { const doc = app.querySelector(`.doc[data-note="${CSS.escape(k.id)}"]`);
    if (doc && doc.isContentEditable && k.sel) { doc.focus({ preventScroll: true }); edSelLoad(doc, k.sel, doc.innerHTML === k.html); } }
  const ep = app.querySelector('[data-anchor-ed="link"]');   // the link box hangs under the Link button (or ⋯ when it's in there)
  if (ep) { let b = app.querySelector('.ed-zone [data-fmt="link"]'); if (b && !b.offsetWidth) b = app.querySelector('[data-act="ed-more"]');
    if (b) { const z = app.getBoundingClientRect().width / app.offsetWidth || 1; ep.style.left = clamp((b.getBoundingClientRect().left - ep.parentElement.getBoundingClientRect().left) / z, 0, Math.max(0, ep.parentElement.offsetWidth - ep.offsetWidth)) + 'px'; } }
}

// A note that ends in something you can't type in (the {{tasks}} block, a table, a code block, a line, a fold, a quote,
// hidden front matter) or is empty gets an empty paragraph at the end, so there is always a line to click on and type.
// An empty paragraph saves as nothing.
function edTail(doc) {
  const last = [...doc.children].pop(); if (!last && doc.textContent.trim()) return;
  if (!last || last.matches('[contenteditable="false"], [data-md], table, pre, hr, details, blockquote, .vid-embed') || edIsEmbed(last)) doc.append(edNewP());
}
// Fix A (QC 4 · 34): an attachment's ![[attachments/…]] line becomes a block you can't type in (voice-attach.js draws its
// player before it) only after this runs, so it counts as one here already; and so do the player and the drawn embeds
const edEmbedLine = el => el?.nodeName === 'P' && /^!\[\[attachments\/[^\]\n]+\]\]$/.test(el.textContent.trim()) && !!el.querySelector('.wikilink[data-wiki^="attachments/"]');
const edIsEmbed = el => !!el?.matches && (el.matches('.att-src, [data-embed-for], .vid-embed') || edEmbedLine(el));
const edEmbedEnd = el => { while (el?.matches?.('[data-embed-for]') && edIsEmbed(el.nextElementSibling)) el = el.nextElementSibling; return el; };   // the player, then its ![[…]] line
function edLineAfter(doc, el) {   // a new empty line after an embed (one Undo step), the caret in it
  el = edEmbedEnd(el); edRecord(doc, 'cmd'); const p = edNewP(); el.after(p); edPut([p, 0]); edChanged(doc); return p;
}
// Enter with the selection on an embed, or the caret beside one between blocks (where ArrowDown can leave it): a line after it
function edEmbedEnter(doc, r) {
  if (!r.collapsed) {
    if (edLines(doc, r).length) return false;
    const box = r.commonAncestorContainer.nodeType === 1 ? r.commonAncestorContainer : r.commonAncestorContainer.parentElement;
    const hit = [...(box.closest('.doc, blockquote') || doc).children].filter(c => edIsEmbed(c) && r.intersectsNode(c)).pop();
    if (!hit) return false; edLineAfter(doc, hit); return true;
  }
  const c = r.startContainer, inEmb = edEl(c).closest('.att-src, [data-embed-for], .vid-embed');
  if (inEmb && doc.contains(inEmb)) { edLineAfter(doc, inEmb); return true; }
  if (c.nodeType !== 1 || !c.matches('.doc, blockquote')) return false;
  const before = c.childNodes[r.startOffset - 1], after = c.childNodes[r.startOffset];
  if (edIsEmbed(before)) { edLineAfter(doc, before); return true; }
  if (edIsEmbed(after)) { edRecord(doc, 'cmd'); const p = edNewP(); after.before(p); edPut([p, 0]); edChanged(doc); return true; }
  return false;
}
// A press in the note's page outside the text (the room below the end, the margins beside it): the caret on the nearest
// line, or at the end below the last block, so a note that ends on a player can always be typed after (QC 4 · 34)
app.addEventListener('mousedown', e => {
  if (e.button !== 0 || e.detail > 1 || !e.target.matches?.('.view--note, .view--note .view-inner, .view--note .ed-grid, .view--note .ed-pane')) return;
  const doc = e.target.querySelector('.doc[contenteditable="true"]') || e.target.closest('.view')?.querySelector('.doc[contenteditable="true"]'); if (!doc) return;
  const kids = [...doc.children].filter(c => c.getClientRects().length), last = kids[kids.length - 1], db = doc.getBoundingClientRect(); if (!last) return;
  e.preventDefault(); doc.focus({ preventScroll: true });
  if (e.clientY > last.getBoundingClientRect().bottom) { edTail(doc); const end = doc.lastElementChild; edPut(end.isContentEditable && !edIsEmbed(end) ? edLineEnd(end) : edPoint(doc, Infinity)); return; }
  const r = document.caretRangeFromPoint?.(clamp(e.clientX, db.left + 2, db.right - 2), e.clientY);
  if (r && doc.contains(r.startContainer)) edPut([r.startContainer, r.startOffset]); else edPut(edPoint(doc, Infinity));
});
// A press in the space after an embed, where there's no line to type on (another embed next, or the end of a quote): a line there
app.addEventListener('mousedown', e => {
  if (e.button !== 0 || e.shiftKey || e.detail > 1 || !e.target.matches?.('.doc[contenteditable="true"], .doc[contenteditable="true"] blockquote')) return;
  const box = e.target, doc = box.closest('.doc'), kids = [...box.children].filter(c => c.getClientRects().length);
  let above = null, below = null;
  for (const c of kids) { const b = c.getBoundingClientRect(); if (b.bottom <= e.clientY) above = c; else if (b.top > e.clientY) { below = c; break; } else return; }   // on a block: the browser's own
  if (!edIsEmbed(above) || (below && !edIsEmbed(below))) return;
  const next = edEmbedEnd(above).nextElementSibling;
  e.preventDefault(); doc.focus({ preventScroll: true });
  if (next?.matches('p') && !next.textContent.trim() && !edIsEmbed(next)) edPut([next, 0]); else edLineAfter(doc, above);
});

/* ---- Lines ---- */
// Text typed straight into the editor or a quote (no paragraph around it) gets one, so it is a line like the others
function edTidy(doc) {
  const s = getSelection(), r = s.rangeCount ? s.getRangeAt(0) : null, keep = r && [r.startContainer, r.startOffset, r.endContainer, r.endOffset];
  const loose = c => c.nodeType === 3 ? !!c.data.trim() : c.nodeType === 1 && !edIsBlock(c) && !c.hasAttribute('data-md') && c.getAttribute('contenteditable') !== 'false';
  let run = [], changed = false;
  const wrap = () => { const real = run.filter(loose); if (real.length) { const p = document.createElement('p'); real[0].before(p); p.append(...run.slice(run.indexOf(real[0]), run.lastIndexOf(real[real.length - 1]) + 1)); changed = true; } run = []; };
  [doc, ...doc.querySelectorAll('blockquote, div[align]')].forEach(box => { [...box.childNodes].forEach(c => { if (loose(c) || (run.length && c.nodeType === 3)) run.push(c); else wrap(); }); wrap(); });   // a quote's bare text too
  if (changed && keep && keep[0] !== doc && keep[2] !== doc && doc.contains(keep[0]) && doc.contains(keep[2])) edPut([keep[0], keep[1]], [keep[2], keep[3]]);
}
const edBox = li => li.querySelector(':scope > input[type="checkbox"], :scope > p:first-child > input[type="checkbox"]');
const edIsTask = l => l.matches('div.task') || (l.matches('li') && !!edBox(l));
// The lines a selection touches, in order: paragraphs, headings and list items (a loose item's <p> is the item).
// A selection that ends at the very start of a line (as a triple-click does) doesn't take that line.
function edLines(doc, r) {
  const out = [], own = li => { const ks = [...li.childNodes].filter(c => !(c.nodeType === 1 && c.matches('ul, ol'))); return ks.length ? ks.some(c => r.intersectsNode(c)) : r.intersectsNode(li); };   // an empty item has no children
  const visit = el => { for (const c of el.children) {
    if (c.getAttribute('contenteditable') === 'false' || c.hasAttribute('data-md') || !r.intersectsNode(c)) continue;
    if (c.matches('li')) { if (own(c)) out.push(c); visit(c); }
    else if (c.matches('p, h1, h2, h3, h4, h5, h6, div.task')) { if (!c.parentElement.matches('li')) out.push(c); }
    else if (c.matches('ul, ol, blockquote, details, div')) visit(c);
  } };
  visit(doc);
  while (out.length > 1 && !r.collapsed && edAtStart(out[out.length - 1], r.endContainer, r.endOffset)) out.pop();
  return out;
}
function edAtStart(line, node, off) {   // nothing of the line's text comes before this point (a task's box doesn't count)
  if (!line.contains(node)) return false;
  const x = document.createRange(); x.setStart(line, 0); x.setEnd(node, off);
  return !x.toString().trim() && !x.cloneContents().querySelector('img, hr');
}
// A point as (line number, characters into the line's text) and back, so it survives the line being rebuilt
function edLinePos(lines, node, off) {
  for (let i = lines.length - 1; i >= 0; i--) if (lines[i].contains(node)) {   // from the end: a sub-item comes after its parent
    const x = document.createRange(); x.setStart(lines[i], 0); x.setEnd(node, off);
    return { i, c: x.toString().replace(/^\s+/, '').length };
  }
  return null;
}
function edTextStart(line) {
  const box = line.matches('li') && edBox(line);
  if (!box) return [line, 0];
  const t = box.nextSibling;
  return t?.nodeType === 3 ? [t, /^\s*/.exec(t.data)[0].length] : [box.parentNode, [...box.parentNode.childNodes].indexOf(box) + 1];
}
function edAt(line, c) {
  if (!c) return edTextStart(line);
  const w = document.createTreeWalker(line, NodeFilter.SHOW_TEXT); let t, lead = true, last = null;
  while ((t = w.nextNode())) {
    const inner = t.parentElement.closest('ul, ol'); if (inner && line.contains(inner)) continue;   // its sub-list's text
    let from = 0; if (lead) { from = /^\s*/.exec(t.data)[0].length; if (from === t.length) continue; lead = false; }
    if (c <= t.length - from) return [t, from + c];
    c -= t.length - from; last = t;
  }
  return last ? [last, last.length] : edTextStart(line);
}
const edLineEnd = line => { const ls = [...line.childNodes].filter(c => !(c.nodeType === 1 && c.matches('ul, ol'))), l = ls[ls.length - 1]; return l?.nodeType === 3 ? [l, l.length] : [line, l ? [...line.childNodes].indexOf(l) + (l.nodeName === 'BR' ? 0 : 1) : 0]; };
// The doc's child that holds a node
const edTop = (doc, n) => { while (n && n.parentNode !== doc) n = n.parentNode; return n; };

/* ---- Lists ---- */
// Take a list item into a list of its own (the same kind), splitting its list around it
function edOwnList(li) {
  const list = li.parentElement, items = [...list.children], i = items.indexOf(li), ol = list.matches('ol'), start = +(list.getAttribute('start') || 1);
  const after = []; for (let s = li.nextSibling; s; s = s.nextSibling) after.push(s);
  if (after.some(x => x.nodeType === 1)) { const rest = list.cloneNode(false); rest.append(...after); list.after(rest); if (ol) rest.setAttribute('start', start + i + 1); }
  if (i === 0) return list;
  const mine = list.cloneNode(false); list.after(mine); mine.append(li); if (ol) mine.setAttribute('start', start + i);
  return mine;
}
const edListOf = (tag, li) => { const l = document.createElement(tag); l.append(li); return l; };
function edNewBox() { const b = document.createElement('input'); b.type = 'checkbox'; return b; }
// A line becomes a task: a "- [ ]" item, the markup the converter gives (li.task-list-item > input + space + text)
function edToTask(line) {
  if (line.matches('li')) {
    if (line.parentElement.matches('ol')) { const own = edOwnList(line), ul = document.createElement('ul'); own.replaceWith(ul); ul.append(...own.childNodes); }   // "- [ ]" lines are bullets
    const host = line.firstChild?.nodeName === 'P' ? line.firstChild : line;
    host.prepend(edNewBox(), ' '); line.classList.add('task-list-item');
    return line;
  }
  const li = document.createElement('li'); li.className = 'task-list-item';
  li.append(edNewBox(), ' ', ...line.childNodes);
  if (!li.textContent.trim() && !li.querySelector('br, img')) li.append(document.createElement('br'));
  line.replaceWith(edListOf('ul', li));
  return li;
}
// A task becomes a plain line again: a paragraph (a sub-item stays an item, now a plain bullet)
function edUntask(line) {
  if (line.matches('div.task')) { const p = document.createElement('p'); line.querySelector(':scope > input')?.remove(); line.querySelectorAll('.task-wand, .chip').forEach(x => x.remove()); p.append(...line.childNodes); line.replaceWith(p); return p; }
  const box = edBox(line); if (box) { const t = box.nextSibling; if (t?.nodeType === 3) t.data = t.data.replace(/^\s+/, ''); box.remove(); }
  line.classList.remove('task-list-item'); if (!line.classList.length) line.removeAttribute('class');
  if (line.parentElement.parentElement?.matches('li')) return line;
  return edLiToP(line);
}
function edLiToP(li) {
  const list = edOwnList(li), p = document.createElement('p'), subs = [...li.children].filter(c => c.matches('ul, ol'));
  subs.forEach(s => s.remove());
  const host = li.children.length === 1 && li.firstElementChild.matches('p') && li.textContent.trim() === li.firstElementChild.textContent.trim() ? li.firstElementChild : li;
  p.append(...host.childNodes);
  while (p.firstChild?.nodeType === 3 && !p.firstChild.data.trim()) p.firstChild.remove();
  while (p.lastChild?.nodeType === 3 && !p.lastChild.data.trim()) p.lastChild.remove();
  if (!p.textContent.trim() && !p.querySelector('br, img')) p.append(document.createElement('br'));
  list.replaceWith(p); p.after(...subs);
  return p;
}
// Task lists side by side become one list
function edJoinLists(lists) {
  const tasky = l => l?.nodeType === 1 && l.matches('ul') && l.children.length && [...l.children].every(li => li.matches('li') && edBox(li));
  lists.forEach(l => {
    if (!l?.isConnected || !tasky(l)) return;
    const p = edSib(l, -1); if (tasky(p)) { p.append(...l.childNodes); l.remove(); l = p; }
    const n = edSib(l, 1); if (tasky(n)) { l.append(...n.childNodes); n.remove(); }
  });
}
// Run a change on the selected lines and put the selection back on the same text
function edOnLines(doc, fn, opts = {}) {
  edTidy(doc);
  let r = edRange(doc);
  if (!r) { doc.focus({ preventScroll: true }); const e = edPoint(doc, Infinity); r = edPut(e); }
  let lines = edLines(doc, r);
  if (!lines.length) {
    if (r.startContainer !== doc) { status(opts.where || 'That can\'t go here'); paintSave(); return false; }   // in a table, a code block or a fold's title
    edRecord(doc); const p = edNewP(); r.insertNode(p); lines = [p]; r = edPut([p, 0]);
  } else edRecord(doc, opts.kind || 'cmd');
  const sp = edLinePos(lines, r.startContainer, r.startOffset), ep = r.collapsed ? sp : edLinePos(lines, r.endContainer, r.endOffset);
  const made = fn(lines) || lines;
  const pick = (pos, end) => pos && made[pos.i]?.isConnected ? edAt(made[pos.i], pos.c) : end ? edLineEnd(made[made.length - 1]) : edTextStart(made[0]);
  if (made.length && made[0].isConnected) edPut(pick(sp), pick(ep, true));
  edChanged(doc);
  return true;
}
function edTaskToggle(doc) {
  edOnLines(doc, lines => {
    const off = lines.every(edIsTask), made = lines.map(l => off ? edUntask(l) : edIsTask(l) ? l : edToTask(l));
    if (!off) edJoinLists(made.map(li => li.parentElement));
    return made;
  }, { where: 'Tasks go on their own line, outside tables and code blocks' });
}
const edNoBox = li => { const box = edBox(li); if (!box) return; const t = box.nextSibling; if (t?.nodeType === 3) t.data = t.data.replace(/^\s+/, ''); box.remove(); li.classList.remove('task-list-item'); if (!li.classList.length) li.removeAttribute('class'); };
// Bullet and numbered lists, made here: the browser's list commands put the list inside the paragraph (<p><ul>).
// Each selected line becomes an item; on items already in that kind of list, the list comes off (a toggle); a list of
// the other kind switches kind; a task's box goes (Docs turns a checklist into a list). Lists side by side join.
function edList(doc, cmd) {
  const tag = cmd === 'ul' ? 'UL' : 'OL';
  edOnLines(doc, lines => {
    if (lines.every(l => l.matches('li') && !edBox(l) && l.parentElement.nodeName === tag)) return lines.map(l => l.parentElement.parentElement?.matches('li') ? l : edLiToP(l));
    const out = lines.map(l => {
      if (l.matches('div.task')) l = edUntask(l);
      if (l.matches('li')) {
        edNoBox(l); const list = l.parentElement;
        if (list.nodeName !== tag) { const nl = document.createElement(tag); [...list.attributes].forEach(a => { if (a.name !== 'start') nl.setAttribute(a.name, a.value); }); list.replaceWith(nl); nl.append(...list.childNodes); }
        return l;
      }
      const li = document.createElement('li'); li.append(...l.childNodes);
      if (!li.textContent.trim() && !li.querySelector('br, img')) li.append(document.createElement('br'));
      l.replaceWith(edListOf(tag.toLowerCase(), li)); return li;
    });
    out.forEach(li => { const l = li.parentElement; if (!l?.isConnected) return; const p = edSib(l, -1); if (p?.nodeName === l.nodeName && !l.parentElement.matches('li')) { p.append(...l.childNodes); l.remove(); } });
    const last = out[out.length - 1]?.parentElement, n = last?.isConnected && edSib(last, 1); if (n && n.nodeName === last.nodeName) { last.append(...n.childNodes); n.remove(); }
    return out;
  }, { where: 'Lists go outside tables and code blocks' });
}
// Text, Heading 1–6 on every selected line (formatBlock joins several lines into one heading). List items keep theirs
function edBlockType(doc, tag) {
  edOnLines(doc, lines => lines.map(l => {
    if (l.matches('li, div.task') || l.nodeName === tag.toUpperCase()) return l;
    const el = document.createElement(tag); ['align', 'data-align'].forEach(a => { if (l.hasAttribute(a)) el.setAttribute(a, l.getAttribute(a)); });
    el.append(...l.childNodes); if (!el.firstChild) el.append(document.createElement('br')); l.replaceWith(el); return el;
  }));
}
// Quote: on lines that are all quoted already, the quote comes off (a toggle, as Obsidian's)
// (Made here, not with formatBlock: that puts the lines into the quote as bare text, so the next click nests a quote)
function edQuote(doc) {
  edOnLines(doc, lines => {
    const quotes = [...new Set(lines.map(l => l.closest('blockquote')))];
    if (!quotes.includes(null)) { quotes.forEach(q => { if (q.isConnected) edUnwrapEl(q); }); return lines; }
    const lineTops = [...new Set(lines.map(l => edTop(doc, l)))], q = document.createElement('blockquote');   // whole lists go in
    // Fix A (QC 4 · 34): a player and its ![[…]] line between the lines go in with them (they stayed behind, below the quote),
    // and so does one the selection covers at either end
    const keep = new Set(lineTops), first = lineTops[0], last = lineTops[lineTops.length - 1], r = edRange(doc);
    for (let el = first.nextElementSibling; el && el !== last; el = el.nextElementSibling) if (edIsEmbed(el)) keep.add(el);
    for (let el = first.previousElementSibling; edIsEmbed(el) && r?.intersectsNode(el); el = el.previousElementSibling) keep.add(el);
    for (let el = last.nextElementSibling; edIsEmbed(el) && r?.intersectsNode(el); el = el.nextElementSibling) keep.add(el);
    [...keep].forEach(el => { if (el.matches('[data-embed-for]')) { const p = edEmbedEnd(el); if (p) keep.add(p); } if (edIsEmbed(el) && el.previousElementSibling?.matches('[data-embed-for]')) keep.add(el.previousElementSibling); });
    const tops = [...doc.children].filter(c => keep.has(c));
    tops[0].before(q); q.append(...tops); edTail(doc);   // a quote at the end: a line after it, at once
    return lines;
  }, { where: 'A quote holds whole lines, outside tables and code blocks' });
}
function edIndent(li) {   // under the item above, at the end of its own sub-list
  const prev = li.previousElementSibling; if (!prev?.matches('li')) return;
  let sub = prev.lastElementChild?.matches('ul, ol') ? prev.lastElementChild : null;
  if (!sub) { sub = document.createElement(li.parentElement.nodeName.toLowerCase()); prev.append(sub); }
  sub.append(li);
}
function edOutdent(li) {   // beside its parent item; the items after it become its sub-items
  const list = li.parentElement, parent = list.parentElement; if (!parent?.matches('li')) return;
  const after = []; for (let s = li.nextElementSibling; s; s = s.nextElementSibling) after.push(s);
  if (after.length) { const sub = li.lastElementChild?.matches('ul, ol') ? li.lastElementChild : li.appendChild(list.cloneNode(false)); sub.append(...after); }
  parent.after(li); if (!list.children.length) list.remove();
}

/* ---- Text: highlight, colour, link, inline code ---- */
// No selection: the word the caret is in (Word does the same), or nothing
function edWord(r) {
  const t = r.startContainer; if (t.nodeType !== 3) return null;
  const s = t.data, w = /[\p{L}\p{N}_'’-]/u; let a = r.startOffset, b = a;
  while (a > 0 && w.test(s[a - 1])) a--; while (b < s.length && w.test(s[b])) b++;
  if (a === b) return null; const x = document.createRange(); x.setStart(t, a); x.setEnd(t, b); return x;
}
// Wrap what a selection covers in each line: the text is cut at the selection's ends, then each run of neighbouring
// pieces gets one new element (from make), so bold or links inside stay as they are and the lines stay apart
function edWrap(doc, r, make) {
  let sc = r.startContainer, so = r.startOffset, ec = r.endContainer, eo = r.endOffset;
  if (ec.nodeType === 3 && eo > 0 && eo < ec.length) ec.splitText(eo);
  if (sc.nodeType === 3 && so > 0 && so < sc.length) { const t = sc.splitText(so); if (ec === sc) { ec = t; eo -= so; } sc = t; so = 0; }
  // widen the ends to whole inline nodes ((text, 0) → before the text, and up while it is the first or last), so a node
  // whose whole content is selected counts as inside
  const len = n => n.nodeType === 3 ? n.length : n.childNodes.length, ix = n => [...n.parentNode.childNodes].indexOf(n);
  while (so === 0 && sc !== doc && !edIsBlock(sc)) { so = ix(sc); sc = sc.parentNode; }
  while (eo === len(ec) && ec !== doc && !edIsBlock(ec)) { eo = ix(ec) + 1; ec = ec.parentNode; }
  const x = document.createRange(); x.setStart(sc, so); x.setEnd(ec, eo);
  const inside = n => x.comparePoint(n.parentNode, ix(n)) === 0 && x.comparePoint(n.parentNode, ix(n) + 1) === 0;
  const inline = n => n && !(n.nodeType === 1 && edIsBlock(n));
  const w = document.createTreeWalker(doc, NodeFilter.SHOW_TEXT), tops = []; let t;
  while ((t = w.nextNode())) {
    if (!x.intersectsNode(t) || !inside(t) || !t.length) continue;
    if (t.parentElement.closest('[contenteditable="false"], pre, [data-md]')) continue;
    if (!t.data.trim() && !(inline(t.previousSibling) && inline(t.nextSibling))) continue;   // the line breaks between blocks
    let top = t; while (top.parentNode !== doc && !edIsBlock(top.parentNode) && inside(top.parentNode)) top = top.parentNode;
    if (tops[tops.length - 1] !== top) tops.push(top);
  }
  const runs = []; tops.forEach((n, i) => { if (i && n.previousSibling === tops[i - 1]) runs[runs.length - 1].push(n); else runs.push([n]); });
  return runs.map(run => { const el = make(); run[0].before(el); el.append(...run); return el; });
}
// No selection: nothing changes yet; what you type next at the caret gets the style (as Docs does)
let edPending = null;
function edInline(doc, make, same, what) {
  const r = edRange(doc); if (!r) return;
  if (r.collapsed) { edPending = { id: doc.dataset.note, c: edOffset(doc, r.startContainer, r.startOffset), make }; return; }   // by position: a picker re-renders the editor
  edRecord(doc);
  const ws = edWrap(doc, r, make); if (!ws.length) { edHist(doc).undo.pop(); return; }
  ws.forEach(w => w.querySelectorAll(same).forEach(edUnwrapEl));
  edPut([ws[0], 0], [ws[ws.length - 1], ws[ws.length - 1].childNodes.length]);
  edChanged(doc);
}
// Strike, and bold or italic in a heading: on text that already has it, it comes off; else the text gets it.
// (The browser's strikeThrough doesn't know Markdown's <del>, and in a heading, already bold, its bold does nothing)
function edToggle(doc, sel, make, what) {
  const r = edRange(doc); if (!r) return;
  if (r.collapsed) { const on = edEl(r.startContainer).closest(sel); if (on) { status(`Select the text to take the ${what} off`); paintSave(); return; } edInline(doc, make, sel, what); return; }
  const w = document.createTreeWalker(doc, NodeFilter.SHOW_TEXT); let t, all = true, any = false;
  while ((t = w.nextNode())) if (r.intersectsNode(t) && t.data.trim()) { any = true; if (!t.parentElement.closest(sel)) { all = false; break; } }
  if (any && all) edUnwrap(doc, sel, what); else edInline(doc, make, sel, what);
}
// Take off a kind of wrapper where the selection (or the caret) is: Remove highlight, a link's Remove
function edUnwrap(doc, sel, what) {
  const r = edRange(doc), hits = r ? [...doc.querySelectorAll(sel)].filter(m => r.intersectsNode(m)) : [];
  if (!hits.length) { status(`No ${what} here`); paintSave(); return; }
  edRecord(doc); const keep = edSelSave(doc);
  hits.forEach(edUnwrapEl); doc.normalize(); edSelLoad(doc, keep, false); edChanged(doc);
}

/* ---- Blocks: code block, fold, line, table ---- */
// A new block goes where the caret's line is: in place of an empty line, else after the line's top-level block
function edPlace(doc, el) {
  edTidy(doc);
  const r = edRange(doc), line = r && edLines(doc, r).pop();
  if (line && !line.textContent.trim() && !line.querySelector('img, input')) { const top = line.matches('li') ? edOwnList(line) : line; top.replaceWith(el); }
  else { const top = r && edTop(doc, r.endContainer === doc ? doc.childNodes[r.endOffset - 1] : r.endContainer); if (top && top !== doc) top.after(el); else doc.append(el); }
  if (!edSib(el, 1)) el.after(edNewP());   // a line to carry on writing on
}
function edCodeBlock(doc, lang) {
  edTidy(doc);
  let r = edRange(doc); if (!r) { doc.focus({ preventScroll: true }); r = edPut(edPoint(doc, Infinity)); }
  if (edEl(r.startContainer).closest('pre')) { status('That is already a code block'); paintSave(); return; }
  const pre = document.createElement('pre'), code = pre.appendChild(document.createElement('code')); pre.dataset.lang = lang || 'Plain text';
  const lines = edLines(doc, r).filter(l => r.collapsed ? l.textContent.trim() : true);   // a caret on a line with text: that line
  edRecord(doc);
  if (lines.length) {   // the selected lines become the code, one line each
    code.textContent = lines.map(l => { const c = l.cloneNode(true); c.querySelectorAll('ul, ol, input').forEach(x => x.remove()); return c.textContent.replace(/^\s+|\s+$/g, ''); }).join('\n');
    const first = lines[0].matches('li') ? edUntaskOrP(lines[0]) : lines[0];
    first.before(pre); lines.forEach(l => { if (l.isConnected) (l.matches('li') ? edLiToP(l) : l).remove(); }); if (first.isConnected) first.remove();
    if (!edSib(pre, 1)) pre.after(edNewP());
    edPut([code.firstChild || code, code.firstChild ? code.firstChild.length : 0]);
  } else { code.append(document.createElement('br')); edPlace(doc, pre); edPut([code, 0]); }
  edChanged(doc);
}
const edUntaskOrP = li => { const box = edBox(li); if (box) box.remove(); return edLiToP(li); };
function edFold(doc) {
  edOnLines(doc, lines => {
    const tops = [...new Set(lines.map(l => edTop(doc, l)))], d = document.createElement('details'), s = d.appendChild(document.createElement('summary'));
    s.textContent = 'Click to open';
    tops[0].before(d); d.append(...tops);
    return [s];
  }, { where: 'A collapsible section holds whole lines, outside tables and code blocks' });
  const s = getSelection(), sum = s.rangeCount && edEl(s.getRangeAt(0).startContainer)?.closest('summary');
  if (sum?.firstChild) edPut([sum.firstChild, 0], [sum.firstChild, sum.firstChild.length]);   // the title is selected: type to name it
}
function edHr(doc) {
  edTidy(doc); const r = edRange(doc), line = r && edLines(doc, r).pop(), hr = document.createElement('hr');
  edRecord(doc);
  const end = line && document.createRange(); if (end) { end.setStart(r.endContainer, r.endOffset); end.setEnd(...edLineEnd(line)); }
  if (line && r.collapsed && line.matches('p, h1, h2, h3, h4, h5, h6') && line.textContent.trim() && !edAtStart(line, r.startContainer, r.startOffset) && end.toString().trim()) {
    const rest = line.cloneNode(false); end.setEnd(line, line.childNodes.length); rest.append(end.extractContents());   // mid-line: the line splits around it
    line.after(hr); hr.after(rest); edPut([rest, 0]);
  } else if (line && r.collapsed && line.matches('p, h1, h2, h3, h4, h5, h6') && line.textContent.trim() && edAtStart(line, r.startContainer, r.startOffset)) line.before(hr);   // at the start: above it
  else { edPlace(doc, hr); const next = edSib(hr, 1); if (next && !next.textContent.trim()) edPut([next, 0]); else { const p = edNewP(); hr.after(p); edPut([p, 0]); } }
  edChanged(doc);
}
function insertTable(rows, cols) {
  const doc = edDocNow(); if (!doc) return;
  edRecord(doc);
  const t = document.createElement('table'), head = t.createTHead().insertRow(), body = t.createTBody();
  for (let j = 0; j < cols; j++) { const th = document.createElement('th'); th.textContent = `Column ${j + 1}`; head.append(th); }
  for (let i = 0; i < Math.max(1, rows - 1); i++) { const tr = body.insertRow(); for (let j = 0; j < cols; j++) tr.insertCell().append(document.createElement('br')); }
  edPlace(doc, t);
  const th = head.firstChild; edPut([th.firstChild, 0], [th.firstChild, th.firstChild.length]);   // the first heading is selected: type to name it
  edChanged(doc);
}
// Fix A (QC 3 · 24): alignment on everything a .md note can keep it on, as the converter saves it:
// - paragraphs and headings: the line (<div align> around it in the .md, as before);
// - table cells: the cell's whole column, the separator row's ":---:" / "---:" (a .md table aligns columns, not cells);
// - list items, quotes and callouts: the whole list or quote, wrapped in <div align> (Markdown can't align one item);
// - code blocks, images and embeds, lines and the {{tasks}} list: never; the buttons say so (edAlignWhy) and stay off.
const ED_NOALIGN = 'pre, hr, .att-img, .att-src, .att-embed, .clip, .vid-embed, [data-md="tasks"], [data-md="raw"], [data-md="frontmatter"]';
function edAlignWhy(el) {   // why the caret's block can't be aligned, or '' when it can
  const x = el?.closest?.(ED_NOALIGN); if (!x) return '';
  return x.matches('pre') ? "A code block can't be aligned in a .md note" : x.matches('hr') ? "A line can't be aligned"
    : x.matches('[data-md="tasks"]') ? "The note's tasks list can't be aligned" : "Images and embeds can't be aligned in a .md note";
}
function edAlign(doc, how) {
  edTidy(doc); const r = edRange(doc); if (!r) return;   // edTidy: loose text (an aligned block as saved) becomes a line first
  const why = edAlignWhy(edEl(r.startContainer)); if (r.collapsed && why) { status(why); paintSave(); return; }
  const cells = [...doc.querySelectorAll('td, th')].filter(c => r.intersectsNode(c)), outer = (el, sel) => { let o = el.closest(sel); while (o && o.parentElement?.closest(sel) && doc.contains(o.parentElement.closest(sel))) o = o.parentElement.closest(sel); return o; };
  const lines = [], wraps = new Set();
  edLines(doc, r).forEach(l => {
    if (l.closest('td, th') || l.closest(ED_NOALIGN)) return;
    const q = outer(l, 'blockquote'), list = l.closest('li') && outer(l, 'ul, ol');
    if (q && doc.contains(q)) wraps.add(q); else if (list && doc.contains(list)) wraps.add(list); else if (l.matches('p, h1, h2, h3, h4, h5, h6')) lines.push(l);
  });
  if (!cells.length && !lines.length && !wraps.size) { status(why || "That can't be aligned in a .md note"); paintSave(); return; }
  const sel = edSelSave(doc); edRecord(doc);
  const cols = new Map(); cells.forEach(c => { const t = c.closest('table'); if (!cols.has(t)) cols.set(t, new Set()); cols.get(t).add(c.cellIndex); });
  cols.forEach((is, t) => [...t.rows].forEach(row => is.forEach(i => { const c = row.cells[i]; if (!c) return; c.style.removeProperty('text-align'); if (how === 'left') c.removeAttribute('align'); else c.setAttribute('align', how); })));
  lines.forEach(l => {
    const wrap = l.parentElement.matches('div[align]') ? l.parentElement : null;   // how a saved, aligned line comes back
    if (wrap && how === 'left') { if (wrap.isConnected) edUnwrapEl(wrap); }
    else if (wrap) { wrap.setAttribute('align', how); }
    if (how === 'left') { l.removeAttribute('align'); delete l.dataset.align; } else if (!wrap) { l.setAttribute('align', how); l.dataset.align = how; }
  });
  wraps.forEach(t => {
    const w = t.parentElement?.matches('div[align]') && t.parentElement.children.length === 1 ? t.parentElement : null;
    if (how === 'left') { if (w) edUnwrapEl(w); } else if (w) w.setAttribute('align', how);
    else { const d = document.createElement('div'); d.setAttribute('align', how); t.before(d); d.append(t); }
  });
  edSelLoad(doc, sel, false); edChanged(doc);
  const said = [cols.size && 'the column (a .md table aligns whole columns)', [...wraps].some(t => t.matches('ul, ol')) && 'the whole list', [...wraps].some(t => t.matches('blockquote')) && 'the whole quote'].filter(Boolean);
  if (said.length || why) { status((said.length ? `Aligned ${said.join(' and ')}` : 'Aligned') + (why ? `. ${why}` : '')); paintSave(); }
}

/* ---- Links ---- */
function edLinkOpen(doc) {
  let r = edRange(doc); if (!r) return;
  const a = edEl(r.startContainer).closest('a[href]');
  if (r.collapsed && !a) r = edWord(r) || r;
  const x = a && r.collapsed ? (() => { const y = document.createRange(); y.selectNodeContents(a); return y; })() : r;
  S.edLink = { id: doc.dataset.note, a: edOffset(doc, x.startContainer, x.startOffset), b: edOffset(doc, x.endContainer, x.endOffset), href: a?.getAttribute('href') || '' };
  S.edPop = 'link'; S.focus = { sel: '#ed-link-url', select: true }; renderAll();
}
function edLinkBox() {
  const k = S.edLink || {};
  return `<div class="card popover ed-pop ed-pop--link" data-anchor-ed="link" role="dialog" aria-label="Link"><input class="field" id="ed-link-url" data-act="ed-link-url" value="${esc(k.href || '')}" placeholder="https://… or name@example.org" aria-label="Link address" spellcheck="false">
    <div class="ed-pop-row"><button class="btn btn--primary btn--sm" data-act="link-apply">${k.href ? 'Update' : 'Add link'}</button>${k.href ? '<button class="btn btn--ghost btn--sm" data-act="link-remove">Remove link</button>' : ''}</div></div>`;
}
function edLinkClose() {   // back to the text, selected as it was
  const k = S.edLink; S.edPop = null; S.edLink = null; renderAll();
  const doc = k && app.querySelector(`.doc[data-note="${CSS.escape(k.id)}"]`); if (!doc) return null;
  doc.focus({ preventScroll: true }); edPut(edPoint(doc, k.a), edPoint(doc, k.b)); return doc;
}
function edLinkApply(remove) {
  const raw = (document.getElementById('ed-link-url')?.value || '').trim(), k = S.edLink;
  let href = raw && (/^www\./i.test(raw) ? 'https://' + raw : /^[^\s@:/]+@[^\s@]+\.[a-z]{2,}$/i.test(raw) ? 'mailto:' + raw : !/^[a-z][\w+.-]*:/i.test(raw) && /^[^\s/]+\.[a-z]{2,}(\/\S*)?$/i.test(raw) ? 'https://' + raw : raw);
  if (!remove && href && !/^(https?:\/\/\S+|mailto:\S+)$/i.test(href)) { status('Links open web pages (https://…) and email (name@example.org)'); paintSave(); document.getElementById('ed-link-url')?.focus(); return; }
  const doc = edLinkClose(); if (!doc || !k) return;
  if (remove || !href) { if (k.href) edUnwrap(doc, 'a[href]', 'link'); return; }
  const r = edRange(doc), a = r && edEl(r.startContainer).closest('a[href]');
  if (a && k.href) { edRecord(doc); a.setAttribute('href', href); edChanged(doc); return; }
  const make = () => { const el = document.createElement('a'); el.setAttribute('href', href); return el; };
  if (!r || r.collapsed) {   // nothing selected: the address itself is the link text
    edRecord(doc); const el = make(); el.textContent = raw; (r || document.createRange()).insertNode(el); edPut([el.parentNode, [...el.parentNode.childNodes].indexOf(el) + 1]); edChanged(doc); return;
  }
  edInline(doc, make, 'a', 'link');
}
function edWiki(doc) {   // [[ ]] with the caret between, or around the selected words (the link is made when the note saves)
  const r = edRange(doc); if (!r) return;
  const t = r.toString();
  if (/\n/.test(t)) { status('A link to a note fits on one line'); paintSave(); return; }
  edRecord(doc);
  r.deleteContents(); const tn = document.createTextNode(`[[${t}]]`); r.insertNode(tn);
  edPut([tn, t ? tn.length : 2]);
}

/* ---- Select all ---- */
// Fix A (QC 3 · 21): what comes before the note's first line you can type in: the hidden front matter, and any block you
// can't type in at the very top (a {{tasks}} list in a daily note, a raw HTML block, a clip). Chromium can't select across
// such a block when it is first: its own Select All then selects nothing, so Delete and Backspace did nothing.
const edLead = c => c.nodeType === 3 ? !c.data.trim() : c.nodeType === 1 && (c.matches('[data-md="frontmatter"]') || c.getAttribute('contenteditable') === 'false');
function edLeadEnd(doc) { const k = doc.childNodes; let i = 0; while (i < k.length && edLead(k[i])) i++; return i; }
// Is all of the note's text selected (Ctrl+A)? The hidden front matter and the blocks above the first line don't count
function edAllSelected(doc, r) {
  if (r.collapsed) return false;
  const empty = (x, top) => {
    const f = x.cloneContents(); if (top) while (f.firstChild && edLead(f.firstChild)) f.firstChild.remove();
    f.querySelectorAll('[data-md="frontmatter"]').forEach(e => e.remove());
    return !f.textContent.trim() && !f.querySelector('img, input, hr, table, iframe, .clip, .att-embed, [data-md="tasks"]');
  };
  const before = document.createRange(); before.setStart(doc, 0); before.setEnd(r.startContainer, r.startOffset);
  const after = document.createRange(); after.setStart(r.endContainer, r.endOffset); after.setEnd(doc, doc.childNodes.length);
  return empty(before, true) && empty(after);   // an empty note too: the browser would delete the hidden front matter with it
}
// Ctrl+A: from the first line you can type in to the end of the note (the editor's own, so it works with a block on top)
function edSelectAll(doc) { edPut([doc, edLeadEnd(doc)], [doc, doc.childNodes.length]); }
// Empty the note to one empty paragraph (the front matter and the blocks above the first line stay), the caret in it
function edClear(doc) {
  const keep = edLeadEnd(doc);
  [...doc.childNodes].forEach((c, i) => { if (i >= keep && !(c.nodeType === 1 && c.matches('[data-md="frontmatter"]'))) c.remove(); });
  const p = edNewP(); doc.append(p); edPut([p, 0]); return p;
}

/* ---- Paste: what the note can keep (as saving would make it), so a web page's styles and fonts don't come along ---- */
function edPasteHtml(html) {
  const m = /<!--StartFragment-->([\s\S]*?)<!--EndFragment-->/.exec(html); if (m) html = m[1];
  html = html.replace(/<!(?:--)?\[if !supportLists\]>(?:-->)?[\s\S]*?<!(?:--)?\[endif\](?:--)?>/g, '')   // Word's list bullets sit between these
    .replace(/<!--[\s\S]*?-->/g, '').replace(/<!\[(?:if [^\]]*|endif)\]>/g, '');
  const box = new DOMParser().parseFromString(html, 'text/html').body;
  // Google Docs wraps everything in <b style="font-weight:normal"> and marks bold, italic and strike with styles
  box.querySelectorAll('b[style*="font-weight:normal"], b[style*="font-weight: normal"]').forEach(edUnwrapEl);
  box.querySelectorAll('span[style]').forEach(sp => {
    const st = sp.getAttribute('style').replace(/\s+/g, ''); let el = sp;
    const wrap = tag => { const w = document.createElement(tag); el.replaceWith(w); w.append(el); el = w; };
    if (/font-weight:(bold|[6-9]00)/.test(st)) wrap('strong');
    if (/font-style:italic/.test(st)) wrap('em');
    if (/text-decoration[^;]*line-through/.test(st)) wrap('del');
  });
  // Word's bulleted and numbered paragraphs (class MsoListParagraph…) become a list
  let list = null;
  [...box.querySelectorAll('p')].forEach(pp => {
    if (!/MsoListParagraph/.test(pp.className)) { list = null; return; }
    const txt = pp.textContent.replace(/^[\s\u00a0]+/, ''), num = /^\d+[.)]/.test(txt), tag = num ? 'ol' : 'ul';
    const li = document.createElement('li'); li.innerHTML = pp.innerHTML; const first = document.createTreeWalker(li, NodeFilter.SHOW_TEXT).nextNode();
    if (first) first.data = first.data.replace(/^[\s\u00a0]*(?:[·•o§▪\-–]|\d+[.)])[\s\u00a0]+/, '');   // the bullet left in the text ("o" only with a space after it, so "one" keeps its o)
    if (!list || list.nodeName.toLowerCase() !== tag || list.nextElementSibling !== pp) { list = document.createElement(tag); pp.before(list); }
    list.append(li); pp.remove();
  });
  const md = NVMarkdown.htmlToMd(box.innerHTML).replace(/^\{\{tasks\}\}[ \t]*$/gm, '');   // a copied {{tasks}} block isn't pasted twice
  return edMdHtml(md);
}
// Pasted plain text is read as Markdown, except that a single line break between two plain lines starts a new
// paragraph, as Docs pastes it (Markdown would join them into one paragraph)
function edTextMd(text) {
  const ls = text.replace(/\r\n?/g, '\n').split('\n'), mark = /^\s*(?:[-*+]\s|\d+[.)]\s|>|\||#|```|~~~|\t| {4})/, out = [];
  let fence = false;
  ls.forEach((l, i) => {
    if (/^\s*(?:```|~~~)/.test(l)) fence = !fence;
    out.push(l);
    const nx = ls[i + 1];
    if (!fence && nx !== undefined && l.trim() && nx.trim() && !mark.test(l) && !mark.test(nx)) out.push('');
  });
  return out.join('\n');
}
// Markdown → the editor's HTML for pasting: a single paragraph goes into the line, not as a paragraph of its own
function edMdHtml(md) {
  if (!md.trim()) return '';
  const html2 = NVMarkdown.mdToHtml(md), one = /^<p>([\s\S]*)<\/p>\s*$/.exec(html2);
  return one && !one[1].includes('<p') ? one[1] : html2;   // words from inside a line go into the line, not as a paragraph of their own
}

/* ---- The commands of the toolbar, its pickers, Ctrl+B and Ctrl+I ---- */
function doFormat(cmd, arg) {
  const doc = edDocNow(); if (!doc) return;
  if (!doc.isContentEditable) { toast('Editing is paused while a reading mode is on'); return; }
  const had = !!edRange(doc);
  if (document.activeElement !== doc) doc.focus({ preventScroll: true });
  if (!had) {   // focus was elsewhere (the palette, the Text style list): the selection from before
    if (edLast?.id === doc.dataset.note && edLast.sel) edSelLoad(doc, edLast.sel, doc.innerHTML === edLast.html); else edPut(edPoint(doc, Infinity));
  }
  edPending = null;
  const r = edRange(doc), at = r && edEl(r.startContainer), inHead = !!at?.closest('h1, h2, h3, h4, h5, h6');
  const native = { bold: ['bold'], italic: ['italic'], strike: ['strikeThrough'], underline: ['underline'], sub: ['subscript'], sup: ['superscript'] };
  if (/^(h[1-6]|p)$/.test(cmd)) edBlockType(doc, cmd);
  else if ((cmd === 'strike' && !r?.collapsed) || (inHead && (cmd === 'bold' || cmd === 'italic'))) {
    const [sel, tag] = { strike: ['del, s, strike', 'del'], bold: ['strong, b', 'strong'], italic: ['em, i', 'em'] }[cmd];
    edToggle(doc, sel, () => document.createElement(tag), cmd === 'strike' ? 'strikethrough' : cmd);
  }
  else if (native[cmd]) { edRecord(doc); document.execCommand(native[cmd][0], false, native[cmd][1] || null); edChanged(doc); }
  else if (cmd === 'ul' || cmd === 'ol') { edList(doc, cmd); edChanged(doc); }
  else if (cmd === 'quote' || cmd === 'blockquote') { edQuote(doc); edChanged(doc); }
  else if (cmd === 'task') edTaskToggle(doc);
  else if (cmd === 'code') edInline(doc, () => document.createElement('code'), 'code', 'format as code');
  else if (cmd === 'wiki') { edWiki(doc); edChanged(doc); }
  else if (cmd === 'hr') edHr(doc);
  else if (cmd === 'link') edLinkOpen(doc);
  else if (cmd === 'image') toast('Images and attachments come with the vault folder');
  else if (cmd === 'table') insertTable(arg[0], arg[1]);
  else if (cmd === 'codeblock') edCodeBlock(doc, arg);
  else if (cmd === 'hl') { if (arg === 'none') edUnwrap(doc, 'mark', 'highlight'); else edInline(doc, () => Object.assign(document.createElement('mark'), { className: 'hl-' + arg }), 'mark', 'highlight'); }
  else if (cmd === 'tc') edInline(doc, () => Object.assign(document.createElement('span'), { className: 'tc-' + arg }), '[class*="tc-"]', 'colour');
  else if (cmd === 'fold') edFold(doc);
  else if (cmd.startsWith('align')) edAlign(doc, cmd.slice(5));
}

/* ---- Keys, input and paste in the editor ---- */
function edKey(e) {
  if (e.target.id === 'ed-link-url') {   // the link box: Enter adds the link, Esc goes back to the text
    if (e.key === 'Enter') { e.preventDefault(); edLinkApply(); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); edLinkClose(); }
    return;
  }
  const doc = e.target.closest?.('.doc'); if (!doc || !doc.isContentEditable || e.isComposing) return;
  const ctrl = e.ctrlKey || e.metaKey, k = e.key.toLowerCase();
  if (ctrl && !e.altKey && (k === 'z' || k === 'y')) { e.preventDefault(); e.stopPropagation(); edUndo(doc, k === 'y' || e.shiftKey); return; }
  if (ctrl && !e.altKey && !e.shiftKey && (k === 'b' || k === 'i')) { e.preventDefault(); doFormat(k === 'b' ? 'bold' : 'italic'); return; }
  if (ctrl && !e.altKey && !e.shiftKey && k === 'a') { e.preventDefault(); edSelectAll(doc); return; }   // Fix A (QC 3 · 21)
  const r = edRange(doc); if (!r) return;
  if (!r.collapsed && !e.altKey && /^(Delete|Backspace|Enter)$/.test(e.key) && edAllSelected(doc, r)) {   // Fix A (QC 3 · 21): Chromium sends no beforeinput for these when the selection starts beside a block you can't type in
    e.preventDefault(); edClearAll(doc, e.key === 'Enter' ? (e.shiftKey ? 'insertLineBreak' : 'insertParagraph') : 'delete'); return;
  }
  if (e.key === 'Enter' && !e.shiftKey && !ctrl && !e.altKey && edEmbedEnter(doc, r)) { e.preventDefault(); return; }   // Fix A (QC 4 · 34)
  const at = edEl(r.startContainer), li = at.closest('li'), task = li && doc.contains(li) && edBox(li) ? li : null;
  if (e.key === 'Tab' && !ctrl && !e.altKey) {
    const cell = at.closest('td, th');
    if (cell && doc.contains(cell)) { e.preventDefault(); edCell(doc, cell, e.shiftKey); return; }
    const items = edLines(doc, r).filter(l => l.matches('li'));
    if (!items.length) { if (!e.shiftKey) e.preventDefault(); return; }   // a plain line: Tab stays in the text (Markdown has no indent); Shift+Tab still leaves
    e.preventDefault();
    edOnLines(doc, lines => { const top = lines.filter(l => l.matches('li') && !lines.some(o => o !== l && o.contains(l))); top.forEach(e.shiftKey ? edOutdent : edIndent); return lines; });
    return;
  }
  if (e.key === 'Backspace' && r.collapsed) {   // the hidden front matter above the first line isn't deleted (edit it in Raw .md)
    const top = edTop(doc, r.startContainer), fm = top && edSib(top, -1);
    if (fm?.nodeType === 1 && fm.matches('[data-md="frontmatter"]') && edAtStart(top, r.startContainer, r.startOffset)) { e.preventDefault(); return; }
  }
  if (e.key === 'Enter' && !e.shiftKey && !ctrl && task && r.collapsed) { e.preventDefault(); edTaskEnter(doc, task, r); return; }
  const line = r.collapsed ? edLines(doc, r).pop() : null;
  if (e.key === 'Enter' && !e.shiftKey && !ctrl && line && !line.matches('li') && line.closest('blockquote') && !line.textContent.trim() && !line.querySelector('img')) {
    e.preventDefault(); edOnLines(doc, () => [edOutOfQuote(line)], { kind: 'cmd' }); return;   // Enter on an empty line in a quote ends the quote
  }
  if (e.key === 'Backspace' && !ctrl && line && edAtStart(line, r.startContainer, r.startOffset) && (!line.matches('li') || edOwnsPoint(line, r.startContainer))) {
    // At the start of a line, Backspace takes off what the line is before joining it to the line above (Docs, Word):
    // a task's box, a bullet or number (a sub-item moves out a level), a heading at the top, a quote's first line
    const quote = !line.matches('li') && line.closest('blockquote'), first = quote && edLines(doc, (() => { const x = document.createRange(); x.selectNodeContents(quote); return x; })())[0] === line;
    const top = /^H[1-6]$/.test(line.nodeName) && !edPrevLine(doc, line);
    if (line.matches('li') || first || top) {
      e.preventDefault();
      edOnLines(doc, () => [line.matches('li') ? (edBox(line) ? edUntask(line) : line.parentElement.parentElement?.matches('li') ? (edOutdent(line), line) : edLiToP(line))
        : first ? edOutOfQuote(line) : edRetag(line, 'p')], { kind: 'delete' });
      return;
    }
  }
  if (e.key === 'Delete' && !ctrl && r.collapsed) {   // at the end of a line before a task: only the task's text joins this line
    const line = edLines(doc, r).pop(), next = line && edNextLine(doc, line), x = document.createRange();
    if (next && edBox(next)) { x.setStart(r.startContainer, r.startOffset); x.setEnd(...edLineEnd(line)); if (!x.toString().trim()) { edRecord(doc, 'delete'); const b = edBox(next), t = b.nextSibling; if (t?.nodeType === 3) t.data = t.data.replace(/^\s+/, ''); b.remove(); next.classList.remove('task-list-item'); } }
  }
}
const edOwnsPoint = (li, node) => { const inner = edEl(node).closest('li'); return inner === li; };
function edPrevLine(doc, line) { const x = document.createRange(); x.selectNodeContents(doc); const all = edLines(doc, x); return all[all.indexOf(line) - 1] || null; }
const edRetag = (el, tag) => { const n = document.createElement(tag); n.append(...el.childNodes); el.replaceWith(n); return n; };
// A line out of its quote: before it (the quote's first line), after it (its last), or the quote splits around it
function edOutOfQuote(line) {
  const q = line.closest('blockquote'), kids = [...q.childNodes].filter(c => c.nodeType === 1 || c.data.trim()), i = kids.indexOf(edTopIn(q, line));
  const el = line.parentElement === q ? line : edTopIn(q, line);
  if (i === 0) q.before(el); else if (i === kids.length - 1) q.after(el);
  else { const rest = q.cloneNode(false); rest.append(...kids.slice(i + 1)); q.after(el); el.after(rest); }
  if (!q.textContent.trim() && !q.querySelector('img, hr, table')) q.remove();
  return line;
}
const edTopIn = (box, n) => { while (n && n.parentNode !== box) n = n.parentNode; return n; };
function edNextLine(doc, line) {   // the next line after this one (not one inside it)
  const all = edLines(doc, (() => { const x = document.createRange(); x.selectNodeContents(doc); return x; })());
  return all[all.indexOf(line) + 1] || null;
}
// Enter in a task: a new empty task below it, the text after the caret going with it; Enter on an empty task leaves the list
function edTaskEnter(doc, li, r) {
  const own = li.cloneNode(true); own.querySelectorAll('ul, ol, input').forEach(x => x.remove());
  if (!own.textContent.trim()) {
    if (li.parentElement.parentElement?.matches('li')) { edOnLines(doc, () => { edOutdent(li); return [li]; }); return; }   // a sub-task moves out a level first
    edOnLines(doc, () => [edUntask(li)]); return;
  }
  edRecord(doc);
  const host = li.firstChild?.nodeName === 'P' ? li.firstChild : li, subs = [...li.children].filter(c => c.matches('ul, ol'));
  const tail = document.createRange(); tail.setStart(...(edAtStart(li, r.startContainer, r.startOffset) ? edTextStart(li) : [r.startContainer, r.startOffset]));   // never the box itself
  tail.setEnd(host, host === li && subs.length ? [...li.childNodes].indexOf(subs[0]) : host.childNodes.length);
  const frag = tail.extractContents(), nli = document.createElement('li');
  nli.className = 'task-list-item'; nli.append(edNewBox(), ' ', frag);
  const t = nli.childNodes[2]; if (t?.nodeType === 3) t.data = t.data.replace(/^\s+/, '');
  if (!nli.textContent.trim() && !nli.querySelector('br, img')) nli.append(document.createElement('br'));
  nli.append(...subs);   // sub-items stay under the line above them, now the new one
  if (!host.textContent.trim() && !host.querySelector('br, img')) host.append(document.createElement('br'));
  li.after(nli); edPut(edTextStart(nli)); edChanged(doc); edShow();
}
function edCell(doc, cell, back) {   // Tab: the next cell, its text selected; a new row after the last cell (Docs, Word)
  const cells = [...cell.closest('table').querySelectorAll('th, td')], i = cells.indexOf(cell);
  let next = cells[i + (back ? -1 : 1)];
  if (!next && back) return;
  if (!next) {
    edRecord(doc); const t = cell.closest('table'), body = t.tBodies[0] || t.createTBody(), tr = body.insertRow();
    for (let j = 0; j < cell.parentElement.children.length; j++) tr.insertCell().append(document.createElement('br'));
    next = tr.firstChild; edChanged(doc);
  }
  const x = document.createRange(); x.selectNodeContents(next); const s = getSelection(); s.removeAllRanges(); s.addRange(x);
}
function edBeforeInput(e) {
  const doc = e.target.closest?.('.doc'); if (!doc || !doc.isContentEditable) return;
  const t = e.inputType;
  if (t === 'historyUndo' || t === 'historyRedo') { e.preventDefault(); edUndo(doc, t === 'historyRedo'); return; }
  if (t === 'insertCompositionText') return;   // recorded at compositionstart
  const r = edRange(doc);
  // Ctrl+A, then Delete, Backspace, cut, typing or Enter: the note empties to one plain paragraph (not the first line's
  // heading or list), the front matter stays, and Ctrl+Z brings it all back
  if (r && !/^insertFrom/.test(t) && edAllSelected(doc, r)) { e.preventDefault(); edClearAll(doc, t, e.data); return; }
  if (t === 'insertText' && e.data === ' ' && r?.collapsed && edMdList(doc, r)) { e.preventDefault(); return; }   // Fix A (QC 3 · 25)
  const p = edPending; edPending = null;
  if (p && p.id === doc.dataset.note && t === 'insertText' && e.data && r?.collapsed && edOffset(doc, r.startContainer, r.startOffset) === p.c) {
    e.preventDefault(); edRecord(doc);
    const el = p.make(); el.textContent = e.data; r.insertNode(el); edPut([el.firstChild, el.firstChild.length]); edHist(doc).kind = 'type'; edChanged(doc); return;
  }
  edRecord(doc, /^insert(Text|ReplacementText)$/.test(t) ? 'type' : /^delete(Content|Word|SoftLine|HardLine)/.test(t) ? 'delete' : 'cmd');
}
// Fix A (QC 3 · 25): Markdown list shortcuts, as in Obsidian. A space after "-", "*", "+", "1." or "1)", "[ ]", "[x]" or
// "- [ ]" at the start of a line makes it a bullet, a numbered item (from that number) or a task; "[ ] " at the start of a
// bullet makes it a task. Then Tab and Shift+Tab nest it (typed as text, a "bullet" was a plain line, which Tab leaves alone).
// It joins a list of the same kind just above it. Ctrl+Z gives the typed marker back.
function edMdList(doc, r) {
  const line = edLines(doc, r).pop(); if (!line || line.closest('[contenteditable="false"], pre, td, th, h1, h2, h3, h4, h5, h6')) return false;
  const isLi = line.matches('li'); if (isLi ? !!edBox(line) : !line.matches('p')) return false;
  const pre = document.createRange(); pre.setStart(...edTextStart(line)); pre.setEnd(r.startContainer, r.startOffset);
  const typed = pre.toString(), task = /^(?:[-*+] )?\[[ xX]?\]$/.test(typed), num = /^(\d{1,9})[.)]$/.exec(typed);
  if (isLi ? !/^\[[ xX]?\]$/.test(typed) : !(task || num || /^[-*+]$/.test(typed))) return false;
  edRecord(doc); pre.deleteContents();
  let li;
  if (task) { li = edToTask(line); if (/x/i.test(typed)) { const b = edBox(li); b.checked = true; b.setAttribute('checked', ''); } }
  else { li = document.createElement('li'); li.append(...line.childNodes); if (!li.textContent.trim() && !li.querySelector('br, img')) li.append(document.createElement('br'));
    const list = edListOf(num ? 'ol' : 'ul', li); if (num && +num[1] !== 1) list.setAttribute('start', +num[1]); line.replaceWith(list); }
  const list = li.parentElement, prev = !isLi && edSib(list, -1);
  if (prev?.nodeType === 1 && prev.tagName === list.tagName && !(num && +num[1] !== prev.children.length + +(prev.getAttribute('start') || 1))) { prev.append(...list.childNodes); list.remove(); }
  const t0 = li.firstChild?.nodeType === 3 && !edBox(li) ? li.firstChild : null; if (t0) t0.data = t0.data.replace(/^\s+/, '');
  edPut(edTextStart(li)); edHist(doc).kind = ''; edChanged(doc);
  return true;
}
// The whole note selected, then a delete, typing or Enter (t: the input type it would be): one plain paragraph is left
function edClearAll(doc, t, data) {
  edRecord(doc);
  const p = edClear(doc);
  if (/^insert(Text|ReplacementText)$/.test(t) && data) { p.textContent = data; edPut([p.firstChild, p.firstChild.length]); edHist(doc).kind = 'type'; }
  else if (t === 'insertParagraph') { const q = edNewP(); p.after(q); edPut([q, 0]); }
  edChanged(doc);
}
function edPaste(e) {
  const doc = e.target.closest?.('.doc'); if (!doc || !doc.isContentEditable || e.defaultPrevented) return;   // a pasted image is handled in actions.js
  const html = e.clipboardData?.getData('text/html') || '', text = e.clipboardData?.getData('text/plain') || '', r = edRange(doc);
  const all = r && edAllSelected(doc, r);
  if (!html && !text) return;
  e.preventDefault(); edRecord(doc);
  if (all) edClear(doc);
  // Plain text is read as Markdown (the note is Markdown: "- one" pastes as a list, as in Obsidian)
  const clean = html ? edPasteHtml(html) : edMdHtml(edTextMd(text));
  if (clean) edInsert(doc, clean); else if (text) document.execCommand('insertText', false, text);
  edChanged(doc); edShow();
}
// Pasted blocks into a list item: the first joins the item, each next one is an item of its own (a task in a task list)
function edInsert(doc, html) {
  const r = edRange(doc), li = r && edEl(r.startContainer).closest('li'), box = document.createElement('div'); box.innerHTML = html;
  const blocks = [...box.childNodes].filter(c => c.nodeType === 1 || c.data.trim());
  if (!li || !doc.contains(li) || blocks.length < 2 || !blocks.every(b => b.nodeType === 1 && b.matches('p, h1, h2, h3, h4, h5, h6, ul, ol'))) { document.execCommand('insertHTML', false, html); return; }
  const lines = blocks.flatMap(b => b.matches('ul, ol') ? [...b.children] : [b]);
  if (!r.collapsed) r.deleteContents();
  const tail = document.createRange(); tail.setStart(r.startContainer, r.startOffset);
  const subs = [...li.children].filter(c => c.matches('ul, ol')); tail.setEnd(li, subs.length ? [...li.childNodes].indexOf(subs[0]) : li.childNodes.length);
  const after = tail.extractContents(), task = !!edBox(li);
  let cur = li, end = null;
  lines.forEach((l, i) => {
    const kids = [...l.childNodes].filter(c => !(c.nodeType === 1 && c.matches('ul, ol, input')));
    if (i === 0) { const ref = subs[0] || null; kids.forEach(k => li.insertBefore(k, ref)); return; }
    const n = document.createElement('li'); if (task) { n.className = 'task-list-item'; n.append(edNewBox(), ' '); }
    n.append(...kids); cur.after(n); cur = n;
  });
  const lastKid = cur.lastChild; end = lastKid?.nodeType === 3 ? [lastKid, lastKid.length] : [cur, cur.childNodes.length];
  cur.append(after); if (cur !== li) cur.append(...subs);
  edPut(end);
}
app.addEventListener('keydown', edKey, true);   // capture: before actions.js's keys (Esc closes pickers, Ctrl+K opens the palette there)
app.addEventListener('beforeinput', edBeforeInput);
app.addEventListener('compositionstart', e => { const doc = e.target.closest?.('.doc'); if (doc?.isContentEditable) edRecord(doc); });
app.addEventListener('paste', edPaste);
// A click on a box in the note ticks it but leaves the caret in the text (focus on the box sent typing nowhere)
app.addEventListener('mousedown', e => { if (e.target.matches?.('.doc[contenteditable="true"] input[type="checkbox"]')) e.preventDefault(); });
// What the editor last showed for each note, so a change made outside it (a board tick, a voice or AI insert, a reload)
// starts its undo history again: Ctrl+Z must not quietly undo that change
app.addEventListener('input', e => { const doc = e.target.closest?.('.doc'); if (doc?.isContentEditable) edHist(doc).seen = doc.innerHTML; });
app.addEventListener('focusout', e => { const doc = e.target.closest?.('.doc'); if (doc?.isContentEditable && edRange(doc)) edLast = { id: doc.dataset.note, html: doc.innerHTML, sel: edSelSave(doc) }; });   // for a command run from elsewhere
