/* BUILD V · CODE BLOCKS LIKE VS CODE (mockup R57; feedback: "want the code text editor to be better, with colours and syntax
   review kinda like how vs code does it"; answers r57-code "Like VS Code", r57-check "Keep the light checks").
   A code block stays <pre><code class="language-…"> in the note, so the ```lang fence saves exactly as before. Around the code
   the editor draws, never saved (data-md-ignore, contenteditable="false"):
   - a head: the language (a picker of 10), "1 problem…" when the light check finds one, and Copy (icon only, our tooltip);
   - line numbers (Settings → Editor, on by default: code_line_numbers);
   - while the caret is in the block, a hint line, and the bracket pair at the caret outlined.
   The code is coloured by highlight.js 11.11.1 (vendor/, BSD-3-Clause) in the theme's own colours (--code-kw/str/num/fn/com).
   Typing: Tab indents (Shift+Tab outdents; several lines at once), Enter keeps the line's indent (and opens a bracket pair onto
   its own line), ( [ { " ' ` close themselves, a closing one you type over is skipped, Backspace in an empty pair takes both.
   The light check: a bracket or quote left open (or a closing bracket with no opening one) gets a dotted underline.
   QC 104 (feedback: "problems are hidden and no way to see what or where they are"): "N problems" in the head is a button that
   opens every problem with its line; picking one puts the caret there and lights the line up for a moment. A dot in the
   line-number gutter marks each line with a problem (a click on it jumps there too). */
'use strict';
Object.assign(ICON, { cbcopy: '<rect x="8" y="8" width="14" height="14" rx="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>' });
// [label, the fence's word when picked, highlight.js's name]
const CB_LANGS = [['JavaScript', 'js', 'javascript'], ['TypeScript', 'ts', 'typescript'], ['Python', 'python', 'python'], ['SQL', 'sql', 'sql'], ['JSON', 'json', 'json'],
  ['HTML', 'html', 'xml'], ['CSS', 'css', 'css'], ['Bash', 'bash', 'bash'], ['Markdown', 'markdown', 'markdown'], ['Plain text', '', '']];
const CB_ALIAS = { js: 'JavaScript', javascript: 'JavaScript', jsx: 'JavaScript', mjs: 'JavaScript', cjs: 'JavaScript', node: 'JavaScript', ts: 'TypeScript', typescript: 'TypeScript', tsx: 'TypeScript',
  py: 'Python', python: 'Python', python3: 'Python', sql: 'SQL', json: 'JSON', jsonc: 'JSON', html: 'HTML', htm: 'HTML', xml: 'HTML', svg: 'HTML', xhtml: 'HTML', css: 'CSS',
  bash: 'Bash', sh: 'Bash', shell: 'Bash', zsh: 'Bash', console: 'Bash', md: 'Markdown', markdown: 'Markdown', '': 'Plain text', text: 'Plain text', txt: 'Plain text', plain: 'Plain text', plaintext: 'Plain text', 'plain-text': 'Plain text' };
const CB_CHECKED = ['JavaScript', 'TypeScript', 'Python', 'SQL', 'JSON', 'CSS', 'Bash'];   // the light check runs on these
const CB_PAIRS = { '(': ')', '[': ']', '{': '}', '"': '"', "'": "'", '`': '`' };
const CB_HINT = 'Tab indents · brackets and quotes close themselves · the matching bracket is outlined';
const CB = { copied: null, copyAt: null, menu: null, max: 20000, seen: new WeakMap() };

/* ---- What a block is ---- */
const cbCode = pre => pre.querySelector(':scope > code');
function cbLang(pre) {
  const m = (cbCode(pre)?.getAttribute('class') || '').match(/language-(\S+)/);
  const raw = (m ? m[1] : pre.getAttribute('data-lang') || '').trim().toLowerCase().replace(/\s+/g, '-');
  const label = CB_ALIAS[raw] || raw, row = CB_LANGS.find(r => r[0] === label);
  return { raw, label: row ? row[0] : raw, hl: row ? row[2] : (window.hljs?.getLanguage(raw) ? raw : ''), known: !!row };
}
function cbRaw(node) {   // the text as markdown.js's preText reads it: <br> and block children are line breaks; the editor's chrome isn't text
  let s = '';
  node.childNodes.forEach(c => {
    if (c.nodeType === 3) s += c.nodeValue;
    else if (c.nodeName === 'BR') s += '\n';
    else if (c.nodeType === 1 && !c.hasAttribute('data-md-ignore')) { const b = c.nodeName === 'DIV' || c.nodeName === 'P'; if (b && s && !s.endsWith('\n')) s += '\n'; s += cbRaw(c); if (b && !s.endsWith('\n')) s += '\n'; }
  });
  return s;
}
const cbText = code => { const r = cbRaw(code); return r.endsWith('\n') ? r.slice(0, -1) : r; };   // as saved (markdown.js drops one last newline)
function cbOffset(code, node, off) {   // characters of the code before a DOM point
  if (!code.contains(node) && node !== code) return null;
  const r = document.createRange(); r.setStart(code, 0); r.setEnd(node, off); const box = document.createElement('div'); box.append(r.cloneContents());
  return cbRaw(box).length;
}
function cbPoint(code, off) {   // and back: the text node and offset for a character offset
  const w = document.createTreeWalker(code, NodeFilter.SHOW_TEXT, { acceptNode: n => n.parentElement.closest('[data-md-ignore]') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT });
  let n, last = null;
  while ((n = w.nextNode())) { if (off <= n.nodeValue.length) return [n, off]; off -= n.nodeValue.length; last = n; }
  return last ? [last, last.nodeValue.length] : [code, 0];
}
function cbSel(code) {   // [start, end] of the selection in the code, or null when it isn't in it
  const s = getSelection(); if (!s.rangeCount) return null; const r = s.getRangeAt(0);
  if (!code.contains(r.startContainer) || !code.contains(r.endContainer)) return null;
  const a = cbOffset(code, r.startContainer, r.startOffset), b = cbOffset(code, r.endContainer, r.endOffset);
  return a == null || b == null ? null : [Math.min(a, b), Math.max(a, b)];
}
function cbSelect(code, a, b = a) { const s = getSelection(), r = document.createRange(); r.setStart(...cbPoint(code, a)); r.setEnd(...cbPoint(code, b)); s.removeAllRanges(); s.addRange(r); }

/* ---- The light check, and which brackets pair up (strings and comments left out) ---- */
function cbScan(text, label) {
  const issues = [], match = new Map(), stack = [], line = i => text.slice(0, i).split('\n').length, checked = CB_CHECKED.includes(label);
  const lineCom = { JavaScript: '//', TypeScript: '//', Python: '#', SQL: '--', Bash: '#' }[label] || null, blockCom = ['JavaScript', 'TypeScript', 'SQL', 'CSS'].includes(label);
  const quotes = !checked ? '' : label === 'JSON' ? '"' : label === 'JavaScript' || label === 'TypeScript' ? '"\'`' : '"\'';
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (lineCom && text.startsWith(lineCom, i) && (label !== 'Bash' || i === 0 || /\s/.test(text[i - 1]))) { const e = text.indexOf('\n', i); i = e < 0 ? text.length : e; continue; }
    if (blockCom && text.startsWith('/*', i)) { const e = text.indexOf('*/', i + 2); if (e < 0) { issues.push({ a: i, b: i + 2, msg: `a comment is left open on line ${line(i)}` }); break; } i = e + 1; continue; }
    if (label === 'Python' && (text.startsWith('"""', i) || text.startsWith("'''", i))) { const q = text.slice(i, i + 3), e = text.indexOf(q, i + 3); if (e < 0) { issues.push({ a: i, b: i + 3, msg: `a quote is left open on line ${line(i)}` }); break; } i = e + 2; continue; }
    if (quotes.includes(c)) {
      let j = i + 1, closed = false;
      for (; j < text.length; j++) { const d = text[j]; if (d === '\\' && label !== 'SQL') { j++; continue; } if (d === c) { if (label === 'SQL' && text[j + 1] === c) { j++; continue; } closed = true; break; } if (d === '\n' && c !== '`' && label !== 'Bash' && label !== 'SQL') break; }
      if (!closed) { const e = text.indexOf('\n', i); issues.push({ a: i, b: e < 0 ? text.length : e, msg: `a quote is left open on line ${line(i)}` }); i = e < 0 ? text.length : e; continue; }
      i = j; continue;
    }
    if (c === '(' || c === '[' || c === '{') stack.push(i);
    else if (c === ')' || c === ']' || c === '}') {
      const o = stack[stack.length - 1];
      if (o != null && CB_PAIRS[text[o]] === c) { stack.pop(); match.set(o, i); match.set(i, o); }
      else if (checked) issues.push({ a: i, b: i + 1, msg: `a ${c} has no opening bracket on line ${line(i)}` });
    }
  }
  if (checked) stack.forEach(i => issues.push({ a: i, b: i + 1, msg: `a ${text[i]} is never closed (line ${line(i)})` }));
  return { issues: issues.sort((x, y) => x.a - y.a).map(x => ({ ...x, line: line(x.a) })), match };
}

/* ---- Drawing a block ---- */
const cbProblemText = iss => !iss.length ? '' : iss.length === 1 ? `1 problem: ${iss[0].msg}` : `${iss.length} problems`;   // QC 104: the list shows them all
const cbMsg = x => x.msg.replace(/ (?:on line \d+|\(line \d+\))$/, '');   // the list gives the line on its own
function cbHeadHtml(pre, L, scan) {
  const note = cbProblemText(scan.issues), copied = CB.copyAt === pre;
  // no text nodes in the chrome: the words come from attributes (CSS draws them), so the editor's caret offsets and the
  // note's text never count them
  const open = k => CB.menu?.pre === pre && (CB.menu.kind || 'lang') === k;
  return `<button class="cb-lang" data-cb="lang" aria-haspopup="menu" aria-expanded="${open('lang')}" aria-label="Language: ${esc(L.label || 'Plain text')}" data-label="${esc(L.label || 'Plain text')}">${ic('down')}</button><span class="cb-grow"></span>`
    + (note ? `<button class="cb-note" data-cb="problems" aria-haspopup="menu" aria-expanded="${open('problems')}" aria-label="${esc(note)}: show where" data-label="${esc(note)}" data-tip="Show every problem and its line">${ic('down')}</button>` : '')
    + `<button class="icon-btn icon-btn--sm cb-copy" data-cb="copy" aria-label="${copied ? 'Copied' : 'Copy the code'}" data-tip="${copied ? 'Copied' : 'Copy the code'}">${ic(copied ? 'ok' : 'cbcopy')}</button>`;
}
function cbChrome(pre, cls, html, attrs = '') {
  let el = pre.querySelector(`:scope > .${cls}`);
  if (!el) { el = document.createElement('span'); el.className = cls; el.setAttribute('data-md-ignore', ''); el.setAttribute('contenteditable', 'false'); if (attrs) el.setAttribute('aria-hidden', 'true'); }
  if (el.innerHTML !== html) el.innerHTML = html;
  return el;
}
function cbRender(pre, opts = {}) {   // colours, the head, the line numbers and the marks; keeps the selection where it was
  const code = cbCode(pre); if (!code) return;
  const L = cbLang(pre), text = cbText(code), nums = S.a11y.codeNums !== false, scan = cbScan(text, L.label);
  const sel = opts.sel !== undefined ? opts.sel : cbSel(code), seen = CB.seen.get(pre);
  const key = `${L.label}|${L.hl}|${text}`;
  if (!seen || seen.key !== key || opts.force || !code.querySelector('.hljs-cb') && L.hl && text) {
    const body = L.hl && window.hljs && text.length <= CB.max ? hljs.highlight(text, { language: L.hl, ignoreIllegals: true }).value : esc(text);
    code.innerHTML = `<span class="hljs-cb">${body}</span>${text.endsWith('\n') || !text ? '\n' : ''}`;   // a last empty line still shows (and is dropped on save)
    if (sel) cbSelect(code, Math.min(sel[0], text.length), Math.min(sel[1], text.length));
  }
  CB.seen.set(pre, { key, scan, text });
  pre.classList.add('cb'); pre.classList.toggle('has-nums', nums);
  const head = cbChrome(pre, 'cb-head', cbHeadHtml(pre, L, scan)); if (pre.firstChild !== head) pre.prepend(head);
  const lines = text.split('\n').length, gut = nums ? cbChrome(pre, 'cb-gut', cbGutMarks(code, scan), true) : pre.querySelector(':scope > .cb-gut');
  if (nums) { const v = [...Array(lines)].map((_, i) => i + 1).join('\n'); if (gut.dataset.nums !== v) gut.dataset.nums = v; if (head.nextSibling !== gut) head.after(gut); } else gut?.remove();
  const hint = cbChrome(pre, 'cb-hint', ''); if (hint.dataset.label !== CB_HINT) hint.dataset.label = CB_HINT; if (code.nextSibling !== hint) code.after(hint);
  pre.setAttribute('aria-label', `Code block, ${L.label || 'Plain text'}`);
  cbMarks(pre);
}
const cbZ = () => app.getBoundingClientRect().width / app.offsetWidth || 1;
function cbBoxes(code, a, b, cls) {   // dotted underlines and the outlined pair: boxes over the code (they scroll with it), never in the text
  if (b <= a) return '';
  const r = document.createRange(); r.setStart(...cbPoint(code, a)); r.setEnd(...cbPoint(code, b));
  const cr = code.getBoundingClientRect(), z = cbZ();
  return [...r.getClientRects()].filter(x => x.width > 0).map(x => `<span class="cb-mark ${cls}" style="left:${((x.left - cr.left) / z + code.scrollLeft).toFixed(1)}px;top:${((x.top - cr.top) / z + code.scrollTop).toFixed(1)}px;width:${(x.width / z).toFixed(1)}px;height:${(x.height / z).toFixed(1)}px"></span>`).join('');
}
function cbLineBox(code, a) {   // where the line holding character a sits in the code: [top, height] (px, unzoomed)
  const r = document.createRange(), t = cbText(code), p = cbPoint(code, Math.min(a, t.length)); r.setStart(...p); r.setEnd(...cbPoint(code, Math.min(a + 1, t.length)));
  const x = [...r.getClientRects()].find(q => q.height > 0) || r.getBoundingClientRect(), cr = code.getBoundingClientRect(), z = cbZ();
  return [(x.top - cr.top) / z + code.scrollTop, x.height / z];
}
function cbGutMarks(code, scan) {   // QC 104: a dot by the number of each line with a problem (the code and the gutter share a top)
  const byLine = new Map(); scan.issues.forEach((x, i) => { if (!byLine.has(x.line)) byLine.set(x.line, i); });
  return [...byLine].map(([ln, i]) => { const [t, h] = cbLineBox(code, scan.issues[i].a); const msgs = scan.issues.filter(x => x.line === ln).map(cbMsg).join(' · ');
    return `<i class="cb-gmark" data-cb="gjump" data-v="${i}" style="top:${(t + h / 2).toFixed(1)}px" data-tip="Line ${ln}: ${esc(msgs)}"></i>`; }).join('');
}
function cbMarks(pre) {
  const code = cbCode(pre), seen = CB.seen.get(pre); if (!code || !seen) return;
  let html = seen.scan.issues.map(x => cbBoxes(code, x.a, Math.max(x.b, x.a + 1), 'cb-issue')).join('');
  if (CB.flash?.pre === pre) { const [t, h] = cbLineBox(code, CB.flash.a); html += `<span class="cb-mark cb-flash" style="left:0;top:${t.toFixed(1)}px;width:${Math.max(code.scrollWidth, code.clientWidth)}px;height:${h.toFixed(1)}px"></span>`; }
  const sel = pre.classList.contains('is-editing') && cbSel(code);
  if (sel && sel[0] === sel[1]) {
    const o = sel[0], at = seen.scan.match.has(o - 1) ? o - 1 : seen.scan.match.has(o) ? o : null;
    if (at != null) { const m = seen.scan.match.get(at); html += cbBoxes(code, at, at + 1, 'cb-match') + cbBoxes(code, m, m + 1, 'cb-match'); }
  }
  let layer = code.querySelector(':scope > .cb-marks');
  if (!html) { layer?.remove(); return; }
  if (!layer) { layer = document.createElement('span'); layer.className = 'cb-marks'; layer.setAttribute('data-md-ignore', ''); layer.setAttribute('contenteditable', 'false'); layer.setAttribute('aria-hidden', 'true'); code.append(layer); }
  if (layer.innerHTML !== html) layer.innerHTML = html;
}
const cbPres = root => [...(root || app).querySelectorAll('.doc pre:not(.md-frontmatter)')].filter(p => cbCode(p) && !p.closest('[data-md-ignore], table'));
function cbAll() { cbPres().forEach(pre => cbRender(pre)); }

/* ---- Editing: the text changes as one step (Ctrl+Z puts it back) ---- */
function cbEdit(pre, text, a, b = a, kind = 'cmd') {   // kind 'type': merges with the typing around it into one undo step
  const code = cbCode(pre), doc = pre.closest('.doc'); if (!code || !doc) return;
  edRecord(doc, kind);
  code.textContent = text + (text.endsWith('\n') || !text ? '\n' : '');
  cbRender(pre, { sel: [a, b], force: true });
  edChanged(doc);
}
function cbIndentUnit(text, label) {   // the block's own indent (tabs, or its smallest run of spaces); Python's default is 4, the others' 2
  if (/^\t/m.test(text)) return '\t';
  const ns = (text.match(/^ +(?=\S)/gm) || []).map(s => s.length), d = label === 'Python' ? 4 : 2, n = ns.length ? Math.min(...ns) : d;
  return ' '.repeat(n >= 2 && n <= 8 ? n : d);
}
function cbKey(e, pre) {
  const code = cbCode(pre), sel = cbSel(code); if (!sel) return false;
  const text = cbText(code), [a, b] = sel, before = text.slice(0, a), after = text.slice(b), unit = cbIndentUnit(text, cbLang(pre).label);
  const lineStart = before.lastIndexOf('\n') + 1, indent = (text.slice(lineStart).match(/^[ \t]*/) || [''])[0];
  if (e.key === 'Tab') {
    const s0 = text.lastIndexOf('\n', a - 1) + 1, e0 = b > a && text[b - 1] === '\n' ? b - 1 : b, block = text.slice(s0, e0), many = block.includes('\n');
    if (!many && !e.shiftKey && a === b) { cbEdit(pre, before + unit + after, a + unit.length); return true; }
    const lines = block.split('\n');
    const next = lines.map(l => e.shiftKey ? l.replace(new RegExp('^(\\t| {1,' + Math.max(1, unit.length) + '})'), '') : (l || many ? unit + l : l));
    const nt = text.slice(0, s0) + next.join('\n') + text.slice(e0), d0 = next[0].length - lines[0].length;
    cbEdit(pre, nt, Math.max(s0, a + d0), b + (nt.length - text.length)); return true;
  }
  if (e.key === 'Enter') {
    let extra = /[([{]$/.test(before.trimEnd()) || (pre.closest && cbLang(pre).label === 'Python' && /:\s*$/.test(before.slice(lineStart))) ? unit : '';
    if (a === b && CB_PAIRS[text[a - 1]] && CB_PAIRS[text[a - 1]] === text[a] && '([{'.includes(text[a - 1])) {   // between a pair: the pair opens onto its own lines
      const mid = '\n' + indent + unit, nt = before + mid + '\n' + indent + after; cbEdit(pre, nt, a + mid.length); return true; }
    const ins = '\n' + indent + extra; cbEdit(pre, before + ins + after, a + ins.length); return true;
  }
  if (e.key === 'Backspace' && a === b && a > 0 && CB_PAIRS[text[a - 1]] && CB_PAIRS[text[a - 1]] === text[a]) { cbEdit(pre, text.slice(0, a - 1) + text.slice(a + 1), a - 1); return true; }
  if (e.key.length === 1) {
    const c = e.key;
    if (')]}"\'`'.includes(c) && a === b && text[a] === c && text[a - 1] !== '\\') { cbSelect(code, a + 1); cbMarks(pre); return true; }   // type over the closing one
    if (CB_PAIRS[c]) {
      const quote = c === '"' || c === "'" || c === '`', prev = text[a - 1] || '', next = text[b] || '';
      if (quote && a === b && (/[\w\\]/.test(prev) || /\w/.test(next))) return false;   // don't, isn't, a\" : just the one quote
      if (!quote && a === b && /\w/.test(next)) return false;   // before a word: just the bracket
      const ins = c + (a === b ? '' : text.slice(a, b)) + CB_PAIRS[c];
      cbEdit(pre, before + ins + after, a + 1, a + 1 + (b - a), a === b ? 'type' : 'cmd'); return true;
    }
  }
  return false;
}
document.addEventListener('keydown', e => {
  if (e.isComposing || e.ctrlKey || e.altKey || e.metaKey) return;
  if (!['Tab', 'Enter', 'Backspace'].includes(e.key) && e.key.length !== 1) return;
  const s = getSelection(); if (!s.rangeCount) return;
  const node = s.anchorNode, el = node && (node.nodeType === 1 ? node : node.parentElement), pre = el?.closest?.('.doc pre.cb'), doc = pre?.closest('.doc');
  if (!pre || !doc?.isContentEditable || el.closest('[data-md-ignore]') || pre.closest('table')) return;
  if (cbKey(e, pre)) { e.preventDefault(); e.stopImmediatePropagation(); }
}, true);
document.addEventListener('input', e => {   // typed letters, a paste, a cut: the colours and the check follow
  if (e.isComposing) return;
  const s = getSelection(), node = s.rangeCount && s.anchorNode, el = node && (node.nodeType === 1 ? node : node.parentElement), pre = el?.closest?.('.doc pre.cb');
  if (pre) cbRender(pre);
}, true);
document.addEventListener('compositionend', e => { const pre = e.target.closest?.('.doc')?.querySelector('pre.cb.is-editing'); if (pre) cbRender(pre); }, true);
document.addEventListener('selectionchange', () => {   // the hint and the outlined pair follow the caret
  const s = getSelection(), node = s.rangeCount && s.anchorNode, el = node && (node.nodeType === 1 ? node : node.parentElement), at = el?.closest?.('.doc pre.cb') || null;
  app.querySelectorAll('.doc pre.cb.is-editing').forEach(p => { if (p !== at) { p.classList.remove('is-editing'); cbMarks(p); } });
  if (at && at.closest('.doc')?.isContentEditable && !el.closest('[data-md-ignore]')) { at.classList.add('is-editing'); cbRender(at); }   // cbRender: the text may have changed without an input event
});

/* ---- The head: the language picker and Copy ---- */
function cbMenuHtml() {
  if (CB.menu.kind === 'problems') {   // QC 104: every problem with its line
    const iss = CB.seen.get(CB.menu.pre)?.scan.issues || [];
    return `<div class="menu card cb-langmenu cb-probmenu" role="menu" aria-label="Problems in this code block">${iss.map((x, i) => `<button class="menu-item cb-prob" role="menuitem" data-cb-prob="${i}"><span class="cb-prob-l">Line ${x.line}</span><span class="truncate">${esc(cbMsg(x))}</span></button>`).join('')}</div>`;
  }
  const L = cbLang(CB.menu.pre);
  return `<div class="menu card cb-langmenu" role="menu" aria-label="Language">${CB_LANGS.map(([l]) => `<button class="menu-item" role="menuitemradio" aria-checked="${l === L.label}" data-cb-pick="${esc(l)}"><span class="cb-tick" aria-hidden="true">${l === L.label ? ic('ok') : ''}</span><span class="truncate">${l}</span></button>`).join('')}</div>`;
}
function cbMenuPaint() {
  app.querySelector(':scope > .cb-langmenu')?.remove();
  if (!CB.menu || !CB.menu.pre.isConnected) { CB.menu = null; return; }
  app.insertAdjacentHTML('beforeend', cbMenuHtml());
  const m = app.querySelector(':scope > .cb-langmenu'), btn = CB.menu.pre.querySelector(CB.menu.kind === 'problems' ? '.cb-note' : '.cb-lang');
  if (typeof placeUnder === 'function' && btn) placeUnder(m, btn);
  btn?.setAttribute('aria-expanded', 'true');
  (m.querySelector('[aria-checked="true"]') || m.querySelector('.menu-item'))?.focus({ preventScroll: true });
}
function cbMenuClose(back) {
  const pre = CB.menu?.pre; CB.menu = null; app.querySelector(':scope > .cb-langmenu')?.remove();
  pre?.querySelectorAll('.cb-lang, .cb-note').forEach(b => b.setAttribute('aria-expanded', 'false'));
  if (back && pre) { const code = cbCode(pre); pre.closest('.doc')?.focus({ preventScroll: true }); cbSelect(code, cbText(code).length); }
}
function cbPick(pre, label) {
  const code = cbCode(pre), doc = pre.closest('.doc'), row = CB_LANGS.find(r => r[0] === label); if (!code || !doc || !row) return;
  if (cbLang(pre).label === label) { cbMenuClose(true); return; }
  edRecord(doc);
  if (row[1]) code.className = 'language-' + row[1]; else code.removeAttribute('class');
  pre.setAttribute('data-lang', label);
  cbMenuClose(true); cbRender(pre, { force: true }); edChanged(doc);
  status(`The block is now ${label}: its colours follow · Ctrl+Z puts it back`);
}
function cbJump(pre, i) {   // QC 104: the caret to the problem, its line lit up for a moment and scrolled into view
  const x = CB.seen.get(pre)?.scan.issues[i], code = cbCode(pre), doc = pre.closest('.doc'); cbMenuClose(); if (!x || !code) return;
  CB.flash = { pre, a: x.a }; clearTimeout(CB.flashT);
  doc?.focus({ preventScroll: true }); cbSelect(code, x.a); if (doc?.isContentEditable) pre.classList.add('is-editing'); cbMarks(pre);
  pre.querySelector('.cb-flash')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  CB.flashT = setTimeout(() => { const p = CB.flash?.pre; CB.flash = null; if (p?.isConnected) cbMarks(p); }, 1800);
  status(`Line ${x.line}: ${cbMsg(x)}`);
}
async function cbCopy(pre) {
  const text = cbText(cbCode(pre)); CB.copied = text;
  if (!window.__tbNoClipboard) { try { await navigator.clipboard.writeText(text); } catch (e) { if (typeof tbCopy === 'function') await tbCopy(text); } }
  CB.copyAt = pre; cbRender(pre); status('Code copied, without the line numbers');
  clearTimeout(CB.copyT); CB.copyT = setTimeout(() => { CB.copyAt = null; if (pre.isConnected) cbRender(pre); }, 1500);
}
document.addEventListener('mousedown', e => { if (e.target.closest?.('.doc pre.cb [data-cb], .cb-langmenu')) e.preventDefault(); }, true);   // the caret stays in the note
document.addEventListener('click', e => {
  const pick = e.target.closest?.('[data-cb-pick]'); if (pick && CB.menu) { e.preventDefault(); e.stopImmediatePropagation(); cbPick(CB.menu.pre, pick.dataset.cbPick); return; }
  const prob = e.target.closest?.('[data-cb-prob]'); if (prob && CB.menu) { e.preventDefault(); e.stopImmediatePropagation(); cbJump(CB.menu.pre, +prob.dataset.cbProb); return; }
  const b = e.target.closest?.('.doc pre.cb [data-cb]');
  if (!b) { if (CB.menu && !e.target.closest?.('.cb-langmenu')) cbMenuClose(); return; }
  e.preventDefault(); e.stopImmediatePropagation(); const pre = b.closest('pre');
  if (b.dataset.cb === 'copy') { cbCopy(pre); return; }
  if (b.dataset.cb === 'gjump') { cbJump(pre, +b.dataset.v); return; }
  const kind = b.dataset.cb === 'problems' ? 'problems' : null;
  if (b.dataset.cb === 'lang' || kind) { if (CB.menu?.pre === pre && (CB.menu.kind || null) === kind) cbMenuClose(true); else { CB.menu = { pre, kind }; cbMenuPaint(); } }
}, true);
document.addEventListener('keydown', e => {   // the language menu: Up / Down, Home / End, Enter, Esc
  const m = app.querySelector(':scope > .cb-langmenu'); if (!m || !CB.menu) return;
  if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); cbMenuClose(true); return; }
  const it = [...m.querySelectorAll('.menu-item')], i = it.indexOf(document.activeElement);
  const to = { ArrowDown: (i + 1) % it.length, ArrowUp: (i - 1 + it.length) % it.length, Home: 0, End: it.length - 1 }[e.key];
  if (to != null) { e.preventDefault(); e.stopImmediatePropagation(); it[to].focus({ preventScroll: true }); }
}, true);

/* ---- Settings → Editor: line numbers; and every draw decorates the code blocks ---- */
COMFORT_KEYS.codeNums = ['code_line_numbers'];
if (S.a11y.codeNums === undefined) S.a11y.codeNums = true;
{ const sp0 = settingsPane; settingsPane = sec => sp0(sec) + (sec === 'editor' ? `<div class="eyebrow eyebrow--gap">Code blocks</div>${a11yTog('codeNums', 'Line numbers in code blocks', 'Numbers down the side of each code block. Copy never takes them')}` : ''); }   // eslint-disable-line no-global-assign
const cbAfter0 = afterRender;
afterRender = function () { cbAll(); cbAfter0.apply(this, arguments); if (CB.menu) cbMenuPaint(); };   // eslint-disable-line no-global-assign
// (first: the editor's after-render then puts the caret back and notes the HTML it has seen, with the blocks already drawn)
const cbChanged0 = edChanged;
edChanged = function (doc) { if (doc?.querySelectorAll) cbPres(doc.closest('.ed-pane') || doc.parentElement || app).forEach(pre => cbRender(pre)); return cbChanged0.apply(this, arguments); };   // eslint-disable-line no-global-assign
/* ---- end Build V · code blocks ---- */
