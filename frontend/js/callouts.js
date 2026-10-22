/* NeuroVault · Build P (QC 40): Obsidian callouts in the note. markdown.js reads "> [!type]± Title" into
   <blockquote class="callout" data-callout="type" [data-callout-fold="±"]><p class="callout-title">Title</p> …</blockquote> and writes it
   back exactly; callouts.css draws the icon, the colour and the fold chevron. This file is what the editor does with one:
   - Enter in the title starts the body (the title is one line); Backspace at the start of the title makes it a plain quote again.
   - The chevron (foldable callouts only) folds and unfolds it. That's a view: the .md keeps its "-" or "+".
   - Typing "[!" at the start of a line (or "> [!") offers the types; Enter, Tab or a click picks one and the line becomes its title.
   Each change is one editor undo step (edRecord → edChanged in editor.js). */
'use strict';
// [the name the list shows, its colour token, its other names]: Obsidian's types
const CO_TYPES = [['note', 'tc-blue', []], ['summary', 'accent-text', ['abstract', 'tldr']], ['info', 'tc-blue', []], ['todo', 'tc-blue', []],
  ['tip', 'tc-violet', ['hint', 'important']], ['success', 'tc-green', ['check', 'done']], ['question', 'tc-orange', ['help', 'faq']],
  ['warning', 'tc-orange', ['caution', 'attention']], ['failure', 'tc-red', ['fail', 'missing']], ['danger', 'tc-red', ['error']],
  ['bug', 'tc-red', []], ['example', 'tc-violet', []], ['quote', 'tc-grey', ['cite']]];
const CO = { pick: null };   // the type list: { doc, line, typed, items, i }
const coSay = msg => { status(msg); paintSave(); };
function coTitleAt(doc) { const r = edRange(doc); return r && r.collapsed ? edEl(r.startContainer).closest('.callout > .callout-title') : null; }
const coBefore = (el, r) => { const x = document.createRange(); x.setStart(el, 0); x.setEnd(r.startContainer, r.startOffset); return x; };
function coKeepView(doc) { const n = edNoteOf(doc); if (n) n.html = doc.innerHTML; edHist(doc).seen = doc.innerHTML; }   // a fold is a view: no undo step, no save

/* ---- Enter and Backspace in the title ---- */
function coEnter(doc, t) {
  const r = edRange(doc); edRecord(doc);
  const after = document.createRange(); after.setStart(r.startContainer, r.startOffset); after.setEnd(t, t.childNodes.length);
  const p = document.createElement('p'); p.append(after.extractContents()); if (!p.textContent && !p.querySelector('img, br')) p.append(document.createElement('br'));
  t.after(p); t.setAttribute('data-tight', ''); t.closest('.callout').removeAttribute('data-folded');
  if (t.lastChild?.nodeName === 'BR' && t.childNodes.length === 1) t.lastChild.remove();
  edPut([p, 0]); edChanged(doc); edShow();
}
function coUnCallout(doc, t) {
  const q = t.closest('.callout'); edRecord(doc);
  ['class', 'data-callout', 'data-callout-fold', 'data-folded'].forEach(a => q.removeAttribute(a));
  let line = t; if (!t.textContent.trim() && !t.querySelector('img')) { line = t.nextElementSibling; t.remove(); if (!line) { line = edNewP(); q.append(line); } }
  else ['class', 'data-callout', 'data-tight'].forEach(a => t.removeAttribute(a));
  edPut([line, 0]); edChanged(doc); coSay('A plain quote now · Ctrl+Z makes it a callout again');
}

/* ---- The type list ("[!" at the start of a line) ---- */
const coName = s => s[0].toUpperCase() + s.slice(1);
function coItems(typed) {
  const k = typed.toLowerCase(), out = [];
  CO_TYPES.forEach(([name, tok, also]) => { if (name.startsWith(k)) out.push({ type: name, tok, alias: '' }); else { const a = also.find(x => x.startsWith(k)); if (a) out.push({ type: a, tok, alias: name }); } });
  return out;
}
function coScan(doc) {   // is the caret just after "[!" (or "> [!") at the start of a plain line?
  const r = edRange(doc); if (!r || !r.collapsed) return null;
  const line = edEl(r.startContainer).closest('p'); if (!line || !doc.contains(line) || line.matches('.callout-title') || line.closest('td, th, li, pre, [contenteditable="false"]')) return null;
  const m = /^(?:>\s?)?\[!([A-Za-z-]{0,20})$/.exec(coBefore(line, r).toString()); if (!m) return null;
  const items = coItems(m[1]); return items.length ? { doc, line, typed: m[0], items } : null;
}
function coPaint() {
  app.querySelector(':scope > .co-pick')?.remove(); const p = CO.pick; if (!p || !p.line.isConnected) { CO.pick = null; return; }
  app.insertAdjacentHTML('beforeend', `<div class="menu card co-pick" role="listbox" aria-label="Callout types">${p.items.map((it, i) => `<button class="menu-item" role="option" data-co="${i}" aria-selected="${i === p.i}" style="--co: var(--${it.tok})"><span class="co-sw" aria-hidden="true"></span><span>${coName(it.type)}</span>${it.alias ? `<span class="co-alias">${coName(it.alias)}</span>` : ''}</button>`).join('')}</div>`);
  const el = app.querySelector(':scope > .co-pick'), s = getSelection(), rr = s.rangeCount ? s.getRangeAt(0).getBoundingClientRect() : null, lb = p.line.getBoundingClientRect();
  const a = app.getBoundingClientRect(), z = a.width / app.offsetWidth || 1, x = (rr && rr.left ? rr.left : lb.left) - a.left, y = ((rr && rr.bottom ? rr.bottom : lb.bottom) - a.top) / z + 6;
  Object.assign(el.style, { left: clamp(x / z, 8, app.offsetWidth - el.offsetWidth - 8) + 'px', top: (y + el.offsetHeight > app.offsetHeight - 8 ? Math.max(8, y - el.offsetHeight - 30) : y) + 'px' });
  el.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' });
}
function coChoose(i) {
  const p = CO.pick, it = p && p.items[i]; CO.pick = null; coPaint(); if (!it || !p.line.isConnected) return;
  const { doc, line } = p, r = edRange(doc); if (!r) return; edRecord(doc);
  coBefore(line, r).deleteContents();   // the typed "[!…" goes: it's the type now
  const parent = line.parentElement, plainQuote = parent.matches('blockquote:not(.callout)') && parent.firstElementChild === line;
  const q = plainQuote ? parent : document.createElement('blockquote');
  if (!plainQuote) { line.before(q); q.append(line); }
  q.className = 'callout'; q.setAttribute('data-callout', it.type);
  const br = [...line.childNodes].find(c => c.nodeName === 'BR' && c.nextSibling);   // the title is one line: what follows a line break is the body
  if (br) { const rest = document.createRange(); rest.setStartAfter(br); rest.setEnd(line, line.childNodes.length); const body = document.createElement('p'); body.append(rest.extractContents()); br.remove(); line.after(body); }
  line.className = 'callout-title'; line.setAttribute('data-callout', it.type); if (line.nextElementSibling) line.setAttribute('data-tight', '');
  if (line.firstChild?.nodeType === 3) line.firstChild.data = line.firstChild.data.replace(/^\s+/, '');
  if (!line.textContent && line.childNodes.length === 1 && line.firstChild.nodeName === 'BR') line.firstChild.remove();
  edTail(doc); edPut(edLineEnd(line)); edChanged(doc); coSay(`${coName(it.type)} callout · type its title, Enter for the text under it`);
}
app.addEventListener('input', e => { const doc = e.target.closest?.('.doc'); if (!doc?.isContentEditable) return; const s = coScan(doc);
  CO.pick = s ? { ...s, i: CO.pick && CO.pick.line === s.line ? Math.min(CO.pick.i, s.items.length - 1) : 0 } : null; coPaint(); });
document.addEventListener('selectionchange', () => { if (CO.pick && !coScan(CO.pick.doc)) { CO.pick = null; coPaint(); } });
document.addEventListener('mousedown', e => {
  const it = e.target.closest?.('.co-pick [data-co]'); if (it) { e.preventDefault(); return; }   // the caret stays on the line
  if (CO.pick && !e.target.closest?.('.co-pick')) { CO.pick = null; coPaint(); }
  // the chevron (drawn at the right of a foldable callout's title row): fold or unfold, the caret stays where it was
  const q = e.target.matches?.('.doc[contenteditable="true"] blockquote.callout[data-callout-fold]') ? e.target : null; if (!q || e.button !== 0) return;
  const b = q.getBoundingClientRect(), t = q.querySelector(':scope > .callout-title'), tb = t ? t.getBoundingClientRect() : b;
  if (e.clientX < b.right - 36 || e.clientY > tb.bottom + 4) return;
  e.preventDefault(); e.stopPropagation(); const doc = q.closest('.doc');
  q.toggleAttribute('data-folded'); const r = edRange(doc); if (q.hasAttribute('data-folded') && r && q.contains(r.startContainer) && !t?.contains(r.startContainer) && t) edPut(edLineEnd(t));
  coKeepView(doc); coSay(q.hasAttribute('data-folded') ? 'Folded (the .md keeps it as it was)' : 'Unfolded (the .md keeps it as it was)');
}, true);
document.addEventListener('click', e => { const it = e.target.closest?.('.co-pick [data-co]'); if (!it) return; e.preventDefault(); e.stopPropagation(); coChoose(+it.dataset.co); }, true);
document.addEventListener('keydown', e => {
  if (e.isComposing) return;
  const p = CO.pick;
  if (p) {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); e.stopImmediatePropagation(); p.i = (p.i + (e.key === 'ArrowDown' ? 1 : p.items.length - 1)) % p.items.length; coPaint(); return; }
    if ((e.key === 'Enter' || e.key === 'Tab') && !e.shiftKey && !e.ctrlKey) { e.preventDefault(); e.stopImmediatePropagation(); coChoose(p.i); return; }
    if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); CO.pick = null; coPaint(); return; }
  }
  const doc = e.target.closest?.('.doc'); if (!doc?.isContentEditable || e.ctrlKey || e.metaKey || e.altKey) return;
  const t = coTitleAt(doc); if (!t || !doc.contains(t)) return;
  if (e.key === 'Enter') { e.preventDefault(); e.stopImmediatePropagation(); coEnter(doc, t); return; }   // Shift+Enter too: the title is one line
  if (e.key === 'Backspace' && !coBefore(t, edRange(doc)).toString() && !coBefore(t, edRange(doc)).cloneContents().querySelector('img, input')) { e.preventDefault(); e.stopImmediatePropagation(); coUnCallout(doc, t); }
}, true);
