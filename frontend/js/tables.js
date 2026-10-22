/* NeuroVault · Build P: table controls and rich tables in the note (mockups R48, R48b and R48c, 2026-10-17).
   "I need better table controls too!" · "all of the options" (R48b) · "I want the freedom that excel or word gives … I dont wanna
   edit in html i wanna use it like word or excel" (R48c). A table is edited as a table, never as HTML.
   - Three ways in, one set of actions (TB_ACTS: one icon and one label each): grips over each column and beside each row (drag to
     move, click for that row's or column's menu) with a + on every gap and a resize edge on every column; a toolbar over the table
     while the caret is in it; and a right-click menu on a cell (no browser menu, Shift or not: Build M parity).
   - The tools live outside the note's text: a layer beside the .doc (grips, +, resize edges, the rich tag), the toolbar and menus
     on the app, and the current cell and the selection drawn by a <style>. So they're never saved, never in the editor's undo
     snapshots, and a redraw can't lose them.
   - Every action reads the table into a grid (merged cells and all), changes it and writes the table back, as one editor undo step
     (edRecord → edChanged in editor.js): Ctrl+Z and Ctrl+Y undo and redo it like any other edit.
   - Markdown until it can't be. Alignment is the separator row (:---: / ---:): the same align attribute Fix A's align buttons
     write (QC 24). Merged cells, column widths, cell colours, vertical alignment, borders, or a list or checkbox in a cell make it
     a rich table, which markdown.js saves as an HTML <table> in R48c's source format; a quiet "Rich table · saved as HTML" tag
     says so. Simplify to Markdown (a confirm, then Undo) takes it back; "Show it in the .md" shows the source.
   - Keys: Tab / Shift+Tab move between cells (Tab in the last cell adds a row); Enter stays in the cell (Shift+Enter is a line
     break; Enter in a cell's list makes the next item); Delete or Backspace on several selected cells clears them, or deletes whole
     rows or columns; Esc clears the selection and closes the menus. Drag across cells, or Shift+click, to select several.
   Open questions, built as the mockup's defaults: r48-header (the Header toggle stays; header off keeps an empty header row in
   the .md, as Markdown tables always have one) and r48-widths (widths can be dragged; the table turns rich). */
'use strict';
Object.assign(ICON, {   // wireframe, as the mockup's R48 set; the grip is the filled-dots exception (design profile)
  tbrowup: '<rect x="3" y="12" width="18" height="8" rx="1"/><path d="M12 3v6M9 6h6"/>', tbrowdown: '<rect x="3" y="4" width="18" height="8" rx="1"/><path d="M12 15v6M9 18h6"/>',
  tbcolleft: '<rect x="12" y="3" width="8" height="18" rx="1"/><path d="M3 12h6M6 9v6"/>', tbcolright: '<rect x="4" y="3" width="8" height="18" rx="1"/><path d="M15 12h6M18 9v6"/>',
  tbdelrow: '<rect x="3" y="8" width="18" height="8" rx="1"/><path d="m10 10 4 4M14 10l-4 4"/>', tbdelcol: '<rect x="8" y="3" width="8" height="18" rx="1"/><path d="m10 10 4 4M14 10l-4 4"/>',
  tbal: '<path d="M4 6h16M4 10h10M4 14h16M4 18h10"/>', tbac: '<path d="M4 6h16M7 10h10M4 14h16M7 18h10"/>', tbar: '<path d="M4 6h16M10 10h10M4 14h16M10 18h10"/>',
  tbvt: '<path d="M4 4h16M12 8v12M8 12l4-4 4 4"/>', tbvm: '<path d="M4 12h16M12 3v5M12 16v5M9 6l3 2 3-2M9 18l3-2 3 2"/>', tbvb: '<path d="M4 20h16M12 4v12M8 12l4 4 4-4"/>',
  tbmerge: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M8 12h8M14 9l3 3-3 3M10 9l-3 3 3 3"/>', tbsplit: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M12 5v14M5 12h4M7 10l2 2-2 2M19 12h-4M17 10l-2 2 2 2"/>',
  tbcolour: '<path d="M12 3a9 9 0 1 0 0 18c1.1 0 2-.9 2-2 0-.5-.2-1-.5-1.3-.3-.4-.5-.8-.5-1.3 0-1.1.9-2 2-2h2.4A4.6 4.6 0 0 0 21 9.8C21 6 17 3 12 3z"/><circle cx="7.5" cy="10.5" r="1"/><circle cx="10.5" cy="7" r="1"/><circle cx="15" cy="7.5" r="1"/>',
  tblist: '<path d="M9 6h11M9 12h11M9 18h11"/><circle cx="4.5" cy="6" r="1"/><circle cx="4.5" cy="12" r="1"/><circle cx="4.5" cy="18" r="1"/>', tbcheck: '<rect x="4" y="4" width="16" height="16" rx="3"/><path d="m8 12 3 3 5-6"/>',
  tbball: '<rect x="3" y="3" width="18" height="18" rx="1"/><path d="M3 12h18M12 3v18"/>', tbbout: '<rect x="3" y="3" width="18" height="18" rx="1"/><path d="M3 12h18M12 3v18" stroke-dasharray="1.5 2.5" opacity=".55"/>', tbbnone: '<path d="M3 12h18M12 3v18M3 3h18v18H3z" stroke-dasharray="1.5 2.5" opacity=".55"/>',
  tbcode: '<path d="m8 8-4 4 4 4M16 8l4 4-4 4M14 5l-4 14"/>', tbsimp: '<path d="M4 6h16M4 12h10M4 18h6M17 14l3 3-3 3"/>',
  tbhead: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9.5h18M3 7h18"/>', tbsort: '<path d="M7 4v16M4 7l3-3 3 3M17 20V4M14 17l3 3 3-3"/>',
  tbcopy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/>',
  tbgrip: '<g fill="currentColor" stroke="none"><circle cx="9" cy="6" r="1.6"/><circle cx="15" cy="6" r="1.6"/><circle cx="9" cy="12" r="1.6"/><circle cx="15" cy="12" r="1.6"/><circle cx="9" cy="18" r="1.6"/><circle cx="15" cy="18" r="1.6"/></g>' });

const TB_BG = ['yellow', 'green', 'blue', 'pink', 'orange'], TB_FG = ['red', 'orange', 'green', 'blue', 'violet', 'grey'];   // the editor's own highlight and text colours
const TB_AL = { left: 'left', center: 'centre', right: 'right' }, TB_VA = { t: 'top', m: 'middle', b: 'bottom' };
// cur: the cell the caret is in ({ id: note, t: table, r, c }; r 0 is the header). sel: a rectangle of cells. menu: { kind: cell | row | col, x, y | btn }.
const TB = { cur: null, sel: null, menu: null, more: false, pick: null, drag: null, dragGrip: null, resize: null, hot: null, simp: null, raw: null, toast: null, sortDir: {}, copied: '' };

/* ---- Where the tables are ---- */
const tbDocs = () => [...app.querySelectorAll('.doc[contenteditable="true"]')];
const tbDocOf = id => tbDocs().find(d => d.dataset.note === id) || null;
const tbTables = doc => doc ? [...doc.querySelectorAll('table')].filter(t => !t.parentElement.closest('table, [contenteditable="false"], [data-md]')) : [];
const tbTable = p => (p && tbTables(tbDocOf(p.id))[p.t]) || null;
function tbMap(tb) {   // which cell covers each (row, column), and where each cell starts
  const occ = [], pos = new Map(), nr = tb.rows.length;
  [...tb.rows].forEach((tr, r) => { occ[r] = occ[r] || []; let c = 0;
    [...tr.cells].forEach(td => { while (occ[r][c]) c++; const cs = Math.max(1, td.colSpan || 1), rs = Math.max(1, Math.min(td.rowSpan || 1, nr - r)); pos.set(td, [r, c]);
      for (let i = 0; i < rs; i++) { occ[r + i] = occ[r + i] || []; for (let j = 0; j < cs; j++) if (!occ[r + i][c + j]) occ[r + i][c + j] = td; } c += cs; }); });
  return { occ, pos, nr, nc: Math.max(1, ...occ.map(x => x.length)) };
}
function tbPos(cell) {
  const tb = cell?.closest?.('table'), doc = tb?.closest('.doc'); if (!doc || !doc.isContentEditable || !app.contains(doc)) return null;
  const t = tbTables(doc).indexOf(tb); if (t < 0) return null;
  const at = tbMap(tb).pos.get(cell); return at ? { id: doc.dataset.note, t, r: at[0], c: at[1] } : null;
}
const tbCellAt = (p, r = p.r, c = p.c) => { const tb = tbTable(p); return tb ? tbMap(tb).occ[r]?.[c] || null : null; };
function tbFromSel() { const s = getSelection(); if (!s.rangeCount) return null; const n = s.anchorNode, el = n && (n.nodeType === 1 ? n : n.parentElement); return tbPos(el?.closest?.('td, th')); }
const tbSame = (a, b) => !!a && !!b && a.id === b.id && a.t === b.t;
const tbBox = p => { const s = TB.sel; return s && tbSame(s, p) ? { r0: Math.min(s.r0, s.r1), r1: Math.max(s.r0, s.r1), c0: Math.min(s.c0, s.c1), c1: Math.max(s.c0, s.c1) } : { r0: p.r, r1: p.r, c0: p.c, c1: p.c }; };
const tbMulti = () => !!TB.sel && (TB.sel.r0 !== TB.sel.r1 || TB.sel.c0 !== TB.sel.c1);
function tbCaret(p, selectAll) {   // the caret at the end of a cell (or its text selected: Tab, as in Docs and Word)
  const c = p && tbCellAt(p); if (!c) return; const doc = c.closest('.doc'); doc.focus({ preventScroll: true });
  const x = document.createRange(); x.selectNodeContents(c); if (!selectAll) x.collapse(false); const s = getSelection(); s.removeAllRanges(); s.addRange(x);
  const at = tbMap(tbTable(p)).pos.get(c); TB.cur = { id: p.id, t: p.t, r: at[0], c: at[1] };
}

/* ---- The model: a table read from the note (merged cells, widths, colours and all), and written back ---- */
const tbC = (h = '') => ({ h, bg: '', fg: '', va: '', cs: 1, rs: 1, hid: false });
const tbHtml = td => { const box = td.cloneNode(true), live = td.querySelectorAll('input'); box.querySelectorAll('input').forEach((x, i) => { if (live[i]?.checked) x.setAttribute('checked', ''); else x.removeAttribute('checked'); }); return box.innerHTML; };   // ticks live in properties
function tbRead(tb) {
  const { occ, pos, nr, nc } = tbMap(tb), grid = [...Array(nr)].map(() => [...Array(nc)].map(() => tbC()));
  pos.forEach(([r, c], td) => { const g = grid[r][c];
    Object.assign(g, { h: tbHtml(td), bg: td.getAttribute('data-nv-bg') || '', fg: td.getAttribute('data-nv-fg') || '', va: td.getAttribute('data-nv-va') || '', cs: Math.min(Math.max(1, td.colSpan || 1), nc - c), rs: Math.min(Math.max(1, td.rowSpan || 1), nr - r) });
    for (let i = 0; i < g.rs; i++) for (let j = 0; j < g.cs; j++) if ((i || j) && occ[r + i]?.[c + j] === td) grid[r + i][c + j].hid = true; });
  const alOf = el => { const a = (el?.getAttribute('align') || '').toLowerCase(); return a === 'center' || a === 'right' || a === 'left' ? a : ''; };
  const aligns = [...Array(nc)].map((_, c) => { for (let r = 0; r < nr; r++) { const el = occ[r][c]; if (el && el.colSpan <= 1) return alOf(el); } return alOf(occ[0][c]); });
  const cols = [...tb.querySelectorAll(':scope > colgroup > col')];
  return { grid, aligns, widths: [...Array(nc)].map((_, i) => parseInt(cols[i]?.getAttribute('width'), 10) || null), borders: tb.getAttribute('data-nv-borders') || 'all' };
}
function tbBuild(m, old) {   // the model → a <table> as the editor holds it (markdown.js decides Markdown or HTML from it)
  const t = document.createElement('table');
  if (old) [...old.attributes].forEach(a => t.setAttribute(a.name, a.value));
  if (m.borders !== 'all') t.setAttribute('data-nv-borders', m.borders); else if (t.getAttribute('data-nv-borders') !== 'all') t.removeAttribute('data-nv-borders');
  if (m.widths.some(Boolean)) { const cg = t.appendChild(document.createElement('colgroup')); m.widths.forEach(w => { const col = cg.appendChild(document.createElement('col')); if (w) col.setAttribute('width', String(Math.round(w))); }); }
  const headSpans = m.grid[0].some(g => !g.hid && g.rs > 1), head = headSpans ? null : t.createTHead(), body = t.createTBody();   // a rowspan can't leave its row group
  m.grid.forEach((row, r) => { const tr = (r || !head ? body : head).insertRow();
    row.forEach((g, c) => { if (g.hid) return; const el = document.createElement(r ? 'td' : 'th');
      if (g.cs > 1) el.colSpan = g.cs; if (g.rs > 1) el.rowSpan = g.rs;
      if (m.aligns[c]) el.setAttribute('align', m.aligns[c]);
      if (g.va) el.setAttribute('data-nv-va', g.va); if (g.bg) el.setAttribute('data-nv-bg', g.bg); if (g.fg) el.setAttribute('data-nv-fg', g.fg);
      el.innerHTML = /\S|<(?!br\b)[a-z]/i.test(g.h.replace(/&nbsp;/g, ' ')) ? g.h : '<br>'; tr.append(el); }); });
  return t;
}
function tbText(h) {   // a cell's text: for sorting, CSV and Convert to text
  const box = document.createElement('div'); box.innerHTML = h;
  box.querySelectorAll('input').forEach(i => i.replaceWith(i.hasAttribute('checked') ? '☑ ' : '☐ '));
  box.querySelectorAll('li').forEach(li => { li.prepend('• '); li.append('\n'); });
  box.querySelectorAll('br').forEach(b => b.replaceWith('\n')); box.querySelectorAll('p, div').forEach(b => b.append('\n'));
  return box.textContent.replace(/ /g, ' ').replace(/[ \t]*\n[ \t]*/g, '\n').replace(/\n{2,}/g, '\n').trim();
}
function tbRich(m) {   // why a table can't be Markdown, in words (markdown.js's tableIsRich decides the same from the HTML)
  const why = [], cells = m.grid.flat().filter(c => !c.hid), merged = cells.filter(c => c.cs > 1 || c.rs > 1).length;
  if (merged) why.push(`${merged} merged cell${merged === 1 ? '' : 's'}`);
  if (m.widths.some(Boolean)) why.push('column widths');
  if (cells.some(c => c.bg || c.fg)) why.push('cell colours');
  if (cells.some(c => c.va)) why.push('vertical alignment');
  if (m.borders !== 'all') why.push(m.borders === 'none' ? 'no borders' : 'outside borders only');
  const lists = cells.filter(c => /<(ul|ol)\b/i.test(c.h)).length, checks = cells.filter(c => /<input\b/i.test(c.h)).length;
  if (lists || checks) why.push([lists && `${lists} list${lists === 1 ? '' : 's'}`, checks && `${checks} checkbox${checks === 1 ? '' : 'es'}`].filter(Boolean).join(' and ') + ' in cells');
  if (cells.some(c => /<(pre|table|blockquote|details)\b/i.test(c.h))) why.push('code, quotes or tables in cells');
  return why;
}
function tbSimpleHtml(h) {   // a cell for Markdown: lists become "• " lines, checkboxes ☐ / ☑; bold, links and [[wiki links]] stay
  const box = document.createElement('div'); box.innerHTML = h;
  box.querySelectorAll('input').forEach(i => i.replaceWith(i.hasAttribute('checked') ? '☑ ' : '☐ '));
  box.querySelectorAll('pre, table, blockquote, details').forEach(x => { if (box.contains(x)) x.replaceWith(tbText(x.outerHTML)); });
  [...box.querySelectorAll('li')].reverse().forEach(li => { const f = document.createDocumentFragment(); f.append('• ', ...li.childNodes, document.createElement('br')); li.replaceWith(f); });
  box.querySelectorAll('ul, ol').forEach(x => x.replaceWith(...x.childNodes));
  box.querySelectorAll('p, div').forEach(x => { x.append(document.createElement('br')); x.replaceWith(...x.childNodes); });
  return box.innerHTML.replace(/(?:<br>\s*){2,}/g, '<br>').replace(/^(?:\s*<br>)+|(?:<br>\s*)+$/g, '').trim();
}
function tbSimplify(m) {   // to Markdown: merges split (the text stays in the first cell); widths, colours, vertical alignment and borders dropped
  return { grid: m.grid.map(row => row.map(g => tbC(g.hid ? '' : tbSimpleHtml(g.h)))), aligns: [...m.aligns], widths: m.aligns.map(() => null), borders: 'all' };
}
function tbLosses(m) {   // what Simplify to Markdown would drop, in words
  const w = [], cells = m.grid.flat().filter(c => !c.hid), merged = cells.filter(c => c.cs > 1 || c.rs > 1).length;
  if (merged) w.push(`${merged} merged cell${merged === 1 ? '' : 's'} will be split (the text stays in the first cell)`);
  if (m.widths.some(Boolean)) w.push('column widths dropped: columns fit their text');
  const col = cells.filter(c => c.bg || c.fg).length; if (col) w.push(`colour dropped from ${col} cell${col === 1 ? '' : 's'}`);
  const va = cells.filter(c => c.va).length; if (va) w.push(`vertical alignment dropped from ${va} cell${va === 1 ? '' : 's'}`);
  if (m.borders !== 'all') w.push('borders back to all');
  const lc = cells.filter(c => /<(ul|ol|input)\b/i.test(c.h)).length; if (lc) w.push(`lists and checkboxes in ${lc} cell${lc === 1 ? '' : 's'} become plain lines (• and ☐)`);
  const cx = cells.filter(c => /<(pre|table|blockquote|details)\b/i.test(c.h)).length; if (cx) w.push(`code, quotes or tables in ${cx} cell${cx === 1 ? '' : 's'} become plain text`);
  return w;
}
// CSV as Build K writes it (converters.py: csv.writer, QUOTE_MINIMAL, \r\n): plain text, a merged cell's text in its first place
const tbCsv = m => m.grid.map(row => row.map(g => { const t = g.hid ? '' : tbText(g.h); return /[",\r\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t; }).join(',')).join('\r\n') + '\r\n';
function tbSource(tb, kind) {   // what the .md holds for this table ('saved'), or it as HTML or as Markdown
  const box = tb.cloneNode(true), live = tb.querySelectorAll('input'); box.querySelectorAll('input').forEach((x, i) => { if (live[i]?.checked) x.setAttribute('checked', ''); else x.removeAttribute('checked'); });
  return NVMarkdown.tableSource(box, kind);
}
const tbMerged = m => m.grid.flat().some(c => !c.hid && (c.cs > 1 || c.rs > 1));
function tbSplitAt(m, r, c) { const g = m.grid[r][c]; for (let i = 0; i < g.rs; i++) for (let j = 0; j < g.cs; j++) if (i || j) m.grid[r + i][c + j] = tbC(); g.cs = 1; g.rs = 1; }
function tbInsRow(m, at) {   // a new row at grid index `at`; a merged cell that spans the gap grows to cover it
  const nc = m.grid[0].length, row = [...Array(nc)].map(() => tbC());
  for (let r = 0; r < at; r++) for (let c = 0; c < nc; c++) { const g = m.grid[r][c]; if (!g.hid && g.rs > 1 && r + g.rs > at) { g.rs++; for (let j = 0; j < g.cs; j++) row[c + j].hid = true; } }
  m.grid.splice(at, 0, row);
}
function tbInsCol(m, at) {
  m.grid.forEach(row => row.splice(at, 0, tbC())); m.aligns.splice(at, 0, ''); m.widths.splice(at, 0, null);
  m.grid.forEach((row, r) => row.forEach((g, c) => { if (c < at && !g.hid && g.cs > 1 && c + g.cs > at) { g.cs++; for (let i = 0; i < g.rs; i++) m.grid[r + i][at].hid = true; } }));
}
function tbDelRow(m, r) {   // a merged cell starting here moves down a row; one covering it from above shrinks
  const nc = m.grid[0].length;
  for (let c = 0; c < nc; c++) { const g = m.grid[r][c];
    if (!g.hid && g.rs > 1) Object.assign(m.grid[r + 1][c], { ...g, rs: g.rs - 1, hid: false });
    if (g.hid) for (let rr = r - 1; rr >= 0; rr--) { const o = m.grid[rr][c]; if (!o.hid && o.rs > 1 && rr + o.rs > r) { o.rs--; break; } } }
  m.grid.splice(r, 1);
}
function tbDelCol(m, c) {
  m.grid.forEach(row => { const g = row[c]; if (!g.hid && g.cs > 1) Object.assign(row[c + 1], { ...g, cs: g.cs - 1, hid: false });
    if (g.hid) for (let cc = c - 1; cc >= 0; cc--) { const o = row[cc]; if (!o.hid && o.cs > 1 && cc + o.cs > c) { o.cs--; break; } } });
  m.grid.forEach(row => row.splice(c, 1)); m.aligns.splice(c, 1); m.widths.splice(c, 1);
}
const tbNum = s => { const t = s.replace(/[\s,£$€¥%]/g, ''); return /^[-+]?\d*\.?\d+$/.test(t) ? parseFloat(t) : NaN; };

/* ---- The actions: one place for the toolbar, the grips and the menus ---- */
const TB_RICH_ACTS = new Set(['merge', 'split', 'vt', 'vm', 'vb', 'list', 'check', 'b-all', 'b-outer', 'b-none', 'width', ...TB_BG.map(c => 'bg-' + c), 'bg-none', ...TB_FG.map(c => 'fg-' + c), 'fg-none']);
function tbSay(msg) { status(msg); paintSave(); }
function tbDo(act, o = {}) {
  const p = o.p || TB.cur || (TB.sel && { id: TB.sel.id, t: TB.sel.t, r: Math.min(TB.sel.r0, TB.sel.r1), c: Math.min(TB.sel.c0, TB.sel.c1) }); if (!p) return;
  const doc = tbDocOf(p.id), tb = tbTable(p); if (!doc || !tb) return;
  const m = tbRead(tb), nc = m.grid[0].length, nr = m.grid.length, box = tbBox(p), want = { id: p.id, t: p.t, r: p.r, c: p.c };
  const cols = [...Array(box.c1 - box.c0 + 1)].map((_, i) => box.c0 + i), multi = box.r0 !== box.r1 || box.c0 !== box.c1;
  const each = f => { for (let r = box.r0; r <= box.r1; r++) for (let c = box.c0; c <= box.c1; c++) { const g = m.grid[r][c]; if (!g.hid) f(g, r, c); } };
  const close = () => { TB.menu = null; TB.more = false; TB.pick = null; };
  if (['copycsv', 'copymd', 'copyhtml'].includes(act)) {
    const rich = tbRich(m).length > 0, txt = act === 'copycsv' ? tbCsv(m) : act === 'copyhtml' ? tbSource(tb, 'html') : tbSource(rich ? tbBuild(tbSimplify(m)) : tb, 'md');
    TB.copied = txt; close(); tbCopy(txt); tbCaret(p);
    tbSay(act === 'copycsv' ? `Copied ${nr} rows as CSV` : act === 'copyhtml' ? 'Copied the table as HTML' : 'Copied the table as Markdown' + (rich ? ' (simplified: Markdown can’t hold all of it)' : '')); tbPaint(); return;
  }
  if (act === 'rawmd') { close(); TB.raw = { p }; S.modal = 'tb-raw'; S.focus = { sel: '[data-dlg="tb-raw"] [data-dlg-btn="main"]' }; renderAll(); return; }
  if (act === 'simplify') { close(); if (!tbRich(m).length) { tbSay('This table is already plain Markdown'); tbPaint(); return; }
    TB.simp = { p, losses: tbLosses(m) }; S.modal = 'tb-simplify'; S.focus = { sel: '[data-dlg="tb-simplify"] [data-dlg-btn="main"]' }; renderAll(); return; }
  const no = msg => { tbSay(msg); close(); tbPaint(); };
  if (['sort', 'moverow', 'movecol', 'header'].includes(act) && tbMerged(m)) return no('Split the merged cells first: merged cells can’t be moved or sorted');
  if (act === 'delrow' && (TB.sel && tbSame(TB.sel, p) ? box.r0 : p.r) === 0) return no('The header row can’t be deleted: Markdown tables always have one. Turn the header off instead');
  if (act === 'merge' && !multi) return no('Select the cells to merge first: drag across them, or Shift+click');
  if (act === 'merge' && box.r0 === 0 && box.r1 > 0) return no('A merge can’t cross from the header into the rows');
  if (act === 'split' && m.grid[p.r][p.c].cs === 1 && m.grid[p.r][p.c].rs === 1) return no('This cell isn’t merged');
  if ((act === 'moverow' || act === 'movecol') && (o.to == null || o.to === o.from || (act === 'moverow' && (o.to === 0 || o.from === 0)))) return;
  if (!o.noRecord) edRecord(doc);
  const wasRich = o.wasRich ?? tbRich(m).length > 0; let msg = '', gone = null;   // a resize has drawn its width already
  switch (act) {
    case 'rowup': case 'rowdown': { const at = act === 'rowup' ? Math.max(1, box.r0) : box.r1 + (m.grid[box.r1][p.c].rs || 1); tbInsRow(m, Math.min(at, m.grid.length)); want.r = at; msg = 'Added a row'; break; }
    case 'rowat': tbInsRow(m, o.at); Object.assign(want, { r: o.at, c: 0 }); msg = 'Added a row'; break;
    case 'addrow': tbInsRow(m, nr); Object.assign(want, { r: nr, c: 0 }); msg = 'Added a row'; break;
    case 'colleft': case 'colright': case 'colat': { const at = act === 'colat' ? o.at : act === 'colleft' ? box.c0 : box.c1 + (m.grid[p.r][box.c1].cs || 1); tbInsCol(m, Math.min(at, nc)); Object.assign(want, { c: at, r: 0 }); msg = 'Added a column'; break; }   // the caret in its header: name it
    case 'delrow': { const [a, b] = TB.sel && tbSame(TB.sel, p) ? [box.r0, box.r1] : [p.r, p.r];
      for (let r = b; r >= a; r--) tbDelRow(m, r); if (m.grid.length < 2) m.grid.push(m.grid[0].map(() => tbC())); want.r = Math.min(a, m.grid.length - 1); msg = b > a ? `Deleted ${b - a + 1} rows` : 'Deleted the row'; break; }
    case 'delcol': { const [a, b] = TB.sel && tbSame(TB.sel, p) ? [box.c0, box.c1] : [p.c, p.c]; if (b - a + 1 >= nc) { gone = 'table'; msg = 'Deleted the table'; break; }
      for (let c = b; c >= a; c--) tbDelCol(m, c); want.c = Math.min(a, m.grid[0].length - 1); msg = b > a ? `Deleted ${b - a + 1} columns` : 'Deleted the column'; break; }
    case 'deltable': gone = 'table'; msg = 'Deleted the table'; break;
    case 'al': case 'ac': case 'ar': { const how = { al: 'left', ac: 'center', ar: 'right' }[act]; cols.forEach(c => { m.aligns[c] = how === 'left' ? '' : how; });
      msg = `${cols.length > 1 ? `${cols.length} columns` : 'The column'} aligned ${TB_AL[how]} · saved in the .md as ${how === 'center' ? ':---:' : how === 'right' ? '---:' : '---'}`; break; }
    case 'vt': case 'vm': case 'vb': each(g => { g.va = act === 'vt' ? '' : act === 'vm' ? 'middle' : 'bottom'; }); msg = `Aligned to the ${TB_VA[act[1]]}`; break;
    case 'sort': { const k = `${p.id}:${p.t}:${p.c}`, dir = (TB.sortDir[k] = -(TB.sortDir[k] || -1)), v = row => tbText(row[p.c].h), body = m.grid.slice(1), num = body.every(r => !v(r) || !isNaN(tbNum(v(r))));
      body.sort((a, z) => { const x = v(a), y = v(z); if (!x) return 1; if (!y) return -1; return (num ? tbNum(x) - tbNum(y) : x.localeCompare(y, undefined, { numeric: true, sensitivity: 'base' })) * dir; });
      m.grid = [m.grid[0], ...body]; msg = `Sorted by ${tbText(m.grid[0][p.c].h) || 'this column'}, ${dir > 0 ? (num ? 'smallest first' : 'A to Z') : (num ? 'largest first' : 'Z to A')}`; break; }
    case 'header': { const hasHead = m.grid[0].some(g => tbText(g.h));
      if (hasHead) { m.grid.unshift(m.grid[0].map(() => tbC())); want.r = p.r + 1; msg = 'Header off: the first row is plain now (the .md keeps an empty header row: Markdown tables always have one)'; }
      else { m.grid.shift(); if (m.grid.length < 2) m.grid.push(m.grid[0].map(() => tbC())); want.r = Math.max(0, p.r - 1); msg = 'Header on: the first row is the header'; } break; }
    case 'totext': gone = 'text'; msg = 'Turned the table into text, one line per row'; break;
    case 'clear': each(g => { g.h = ''; }); msg = multi ? 'Cleared the cells' : 'Cleared the cell'; break;
    case 'moverow': { const [x] = m.grid.splice(o.from, 1); m.grid.splice(o.to, 0, x); want.r = o.to; msg = 'Moved the row'; break; }
    case 'movecol': { const mv = a => { const [x] = a.splice(o.from, 1); a.splice(o.to, 0, x); }; [...m.grid, m.aligns, m.widths].forEach(mv); Object.assign(want, { c: o.to, r: p.r }); msg = 'Moved the column'; break; }
    // R48c · what only a rich (HTML) table can hold
    case 'merge': {
      for (let r = box.r0; r <= box.r1; r++) for (let c = box.c0; c <= box.c1; c++) { const g = m.grid[r][c]; if (!g.hid && (r + g.rs - 1 > box.r1 || c + g.cs - 1 > box.c1)) tbSplitAt(m, r, c); }
      for (let r = box.r0; r <= box.r1; r++) for (let c = box.c0; c <= box.c1; c++) if (m.grid[r][c].hid) for (let rr = 0; rr <= r; rr++) for (let cc = 0; cc <= c; cc++) { const o2 = m.grid[rr][cc]; if (!o2.hid && (o2.rs > 1 || o2.cs > 1) && rr + o2.rs > r && cc + o2.cs > c && (rr < box.r0 || cc < box.c0)) tbSplitAt(m, rr, cc); }
      const first = m.grid[box.r0][box.c0], texts = [];
      for (let r = box.r0; r <= box.r1; r++) for (let c = box.c0; c <= box.c1; c++) { const g = m.grid[r][c]; if (!g.hid && tbText(g.h)) texts.push(g.h); if (r !== box.r0 || c !== box.c0) m.grid[r][c] = Object.assign(tbC(), { hid: true }); }
      Object.assign(first, { h: texts.join('<br>'), cs: box.c1 - box.c0 + 1, rs: box.r1 - box.r0 + 1, hid: false }); Object.assign(want, { r: box.r0, c: box.c0 }); msg = `Merged ${(box.r1 - box.r0 + 1) * (box.c1 - box.c0 + 1)} cells`; break; }
    case 'split': tbSplitAt(m, p.r, p.c); msg = 'Split the cell'; break;
    case 'list': { const g = m.grid[p.r][p.c];
      if (/<(ul|ol)\b/i.test(g.h)) { g.h = tbSimpleHtml(g.h).replace(/(^|<br>)• /g, '$1'); msg = 'The list is lines again'; }
      else { const parts = g.h.split(/<br\s*\/?>/i).map(s => s.trim()).filter(s => s && s !== '&nbsp;'); g.h = `<ul>${(parts.length ? parts : ['<br>']).map(s => `<li>${s}</li>`).join('')}</ul>`; msg = 'A list in the cell'; } break; }
    case 'check': { const g = m.grid[p.r][p.c];
      if (/^\s*<input\b/i.test(g.h)) { g.h = g.h.replace(/^\s*<input\b[^>]*>\s*/i, ''); msg = 'The checkbox is gone'; }
      else { g.h = `<input type="checkbox"> ${g.h.replace(/^(?:\s*<br\s*\/?>)+|(?:<br\s*\/?>\s*)+$/gi, '')}`; msg = 'A checkbox in the cell'; } break; }
    case 'b-all': case 'b-outer': case 'b-none': m.borders = act.slice(2); msg = { all: 'Borders on every cell', outer: 'Borders round the outside only', none: 'No borders' }[m.borders]; break;
    case 'width': m.widths[o.c] = Math.max(48, Math.round(o.w)); msg = `Column ${o.c + 1} is ${m.widths[o.c]}px wide`; break;
    case 'simplify-ok': { const s2 = tbSimplify(m); Object.assign(m, { grid: s2.grid, widths: s2.widths, borders: 'all' }); msg = 'Simplified to Markdown'; break; }
    default:
      if (/^bg-/.test(act)) { const v = act.slice(3); each(g => { g.bg = v === 'none' ? '' : v; }); msg = v === 'none' ? 'Cell colour removed' : `Cell colour: ${v}`; }
      else if (/^fg-/.test(act)) { const v = act.slice(3); each(g => { g.fg = v === 'none' ? '' : v; }); msg = v === 'none' ? 'Text colour back to the default' : `Text colour: ${v}`; }
      else return;
  }
  TB.sel = null; close();
  if (gone) {
    let next;
    if (gone === 'text') { const lines = m.grid.filter(r => r.some(g => !g.hid && tbText(g.h))).map(r => { const p2 = document.createElement('p'); p2.textContent = r.filter(g => !g.hid).map(g => tbText(g.h).replace(/\n/g, ' ')).filter(Boolean).join(' · '); return p2; });
      next = lines[0] || edNewP(); tb.replaceWith(...(lines.length ? lines : [next])); }
    else { next = edSib(tb, 1); if (!next || next.nodeType !== 1 || !next.matches('p, h1, h2, h3, h4, h5, h6')) { next = edNewP(); tb.after(next); } tb.remove(); }
    edPut([next, 0]); TB.cur = null;
  } else {
    tb.replaceWith(tbBuild(m, tb)); const nowRich = tbRich(m).length > 0;
    if (nowRich && !wasRich) msg += ' · this table is saved as HTML now (Markdown can’t store it)'; if (!nowRich && wasRich) msg += ' · plain Markdown again';
    const w = { ...want, r: Math.min(want.r, m.grid.length - 1), c: Math.min(want.c, m.grid[0].length - 1) }; tbCaret(w);
  }
  if (act === 'simplify-ok' && TB.keepCopy) tbCopyLine(TB.keepCopy, o.p);   // Build M · round 6: the copy's hidden line, in the same edit
  edChanged(doc);
  if (act === 'simplify-ok') { TB.toast = { msg: 'Simplified to Markdown', at: Date.now() }; clearTimeout(TB.toastT); TB.toastT = setTimeout(() => { TB.toast = null; app.querySelector('.tb-toast')?.remove(); }, 10000); tbSay('Simplified to Markdown · Undo puts the rich table back'); }
  else tbSay(msg + ' · Ctrl+Z undoes it');
  tbPaint();
}
async function tbCopy(text) {
  if (window.__tbNoClipboard) return true;   // the tests and ?check=1: TB.copied only, never your clipboard
  try { await navigator.clipboard.writeText(text); return true; } catch (e) { /* the pane or the app may refuse: the old way, then back to the cell */ }
  const ae = document.activeElement, s = getSelection(), r = s.rangeCount ? s.getRangeAt(0).cloneRange() : null;
  const ta = document.createElement('textarea'); ta.value = text; ta.setAttribute('readonly', ''); ta.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0';
  document.body.append(ta); ta.select(); let ok = false; try { ok = document.execCommand('copy'); } catch (e) { ok = false; } ta.remove();
  ae?.focus?.({ preventScroll: true }); if (r) { s.removeAllRanges(); s.addRange(r); } return ok;
}
/* ---- QC 82 (Build V, overnight): copy and paste a range of cells as tab-separated text, as Excel and Word do. Ctrl+C on a
   selection copies its rows (one line each, cells split by tabs; a cell's own line breaks become spaces); Ctrl+X copies, then
   clears them. Ctrl+V of text with tabs (or of what was just copied from cells) into a cell fills the cells from there, or
   from the selection's first cell, adding rows and columns when it runs past the table's edge. One Ctrl+Z undoes it. ---- */
function tbTsv(m, b) {
  const rows = [];
  for (let r = b.r0; r <= b.r1; r++) { const row = []; for (let c = b.c0; c <= b.c1; c++) { const g = m.grid[r][c]; row.push(g.hid ? '' : tbText(g.h).replace(/[\t\n]+/g, ' ')); } rows.push(row.join('\t')); }
  return rows.join('\n');
}
function tbCopyCells(cut) {
  const s = TB.sel, tb = tbTable(s); if (!tb) return; const m = tbRead(tb), b = tbBox(s), txt = tbTsv(m, b), n = (b.r1 - b.r0 + 1) * (b.c1 - b.c0 + 1);
  TB.copied = txt; tbCopy(txt);
  if (cut) { const keep = { ...s }; tbDo('clear', { p: { id: s.id, t: s.t, r: b.r0, c: b.c0 } }); TB.sel = keep; tbSay(`Cut ${n} cells · Ctrl+V pastes them, Ctrl+Z puts them back`); }
  else tbSay(`Copied ${n} cells (${b.r1 - b.r0 + 1} rows × ${b.c1 - b.c0 + 1} columns) · paste them into a table or a spreadsheet`);
  tbPaint();
}
const tbEscH = t => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
function tbPasteCells(p, text) {
  const tb = tbTable(p), doc = tbDocOf(p.id); if (!tb || !doc) return false;
  const rows = text.replace(/\r\n?/g, '\n').replace(/\n+$/, '').split('\n').map(l => l.split('\t'));
  const multi = tbMulti() && tbSame(TB.sel, p), b = multi ? tbBox(p) : null, r0 = b ? b.r0 : p.r, c0 = b ? b.c0 : p.c;
  const m = tbRead(tb), wide = Math.max(...rows.map(r => r.length)), wasRich = tbRich(m).length > 0;
  edRecord(doc);
  while (m.grid.length < r0 + rows.length) tbInsRow(m, m.grid.length);
  while (m.grid[0].length < c0 + wide) tbInsCol(m, m.grid[0].length);
  rows.forEach((row, i) => row.forEach((v, j) => { const g = m.grid[r0 + i][c0 + j]; if (!g.hid) g.h = tbEscH(v.trim()); }));
  tb.replaceWith(tbBuild(m, tb));
  TB.sel = rows.length > 1 || wide > 1 ? { id: p.id, t: p.t, r0, c0, r1: r0 + rows.length - 1, c1: c0 + wide - 1 } : null;
  tbCaret({ id: p.id, t: p.t, r: r0, c: c0 }); edChanged(doc);
  const nowRich = tbRich(m).length > 0;
  tbSay(`Pasted ${rows.length} row${rows.length === 1 ? '' : 's'} × ${wide} column${wide === 1 ? '' : 's'}${!wasRich && nowRich ? ' · this table is saved as HTML now' : ''} · Ctrl+Z undoes it`);
  tbPaint(); return true;
}
document.addEventListener('paste', e => {
  const doc = e.target.closest?.('.doc'); if (!doc || !doc.isContentEditable) return;
  const text = e.clipboardData?.getData('text/plain') || ''; if (!text) return;
  const multi = tbMulti() && TB.sel.id === doc.dataset.note, p = tbFromSel() || (multi ? { id: TB.sel.id, t: TB.sel.t, r: Math.min(TB.sel.r0, TB.sel.r1), c: Math.min(TB.sel.c0, TB.sel.c1) } : null);
  if (!p || p.id !== doc.dataset.note) return;
  const lines = text.replace(/\r\n?/g, '\n').replace(/\n+$/, '');
  if (!lines.includes('\t') && !(lines.includes('\n') && (multi || lines === (TB.copied || '').replace(/\n+$/, '')))) return;   // plain text into one cell: the editor's own paste
  e.preventDefault(); e.stopImmediatePropagation(); tbPasteCells(p, lines);
}, true);
function tbUndoSimplify() {
  const p = TB.simpAt, doc = p && tbDocOf(p.id); TB.toast = null; app.querySelector('.tb-toast')?.remove(); if (!doc) return;
  doc.focus({ preventScroll: true }); edUndo(doc); tbSay('Undone: the rich table is back'); tbPaint();
}

/* ---- The toolbar, the menus (right-click and grips), More and the two pickers: one set of actions, one icon and one label each ---- */
const TB_ACTS = { rowup: ['tbrowup', 'Insert a row above'], rowdown: ['tbrowdown', 'Insert a row below'], delrow: ['tbdelrow', 'Delete row'],
  colleft: ['tbcolleft', 'Insert a column to the left'], colright: ['tbcolright', 'Insert a column to the right'], delcol: ['tbdelcol', 'Delete column'],
  al: ['tbal', 'Align left'], ac: ['tbac', 'Align centre'], ar: ['tbar', 'Align right'], vt: ['tbvt', 'Align to the top'], vm: ['tbvm', 'Align to the middle'], vb: ['tbvb', 'Align to the bottom'],
  merge: ['tbmerge', 'Merge cells'], split: ['tbsplit', 'Split cell'], list: ['tblist', 'List in the cell'], check: ['tbcheck', 'Checkbox in the cell'],
  sort: ['tbsort', 'Sort by this column (again to reverse)'], header: ['tbhead', 'Header row'],
  'b-all': ['tbball', 'Borders on every cell'], 'b-outer': ['tbbout', 'Borders round the outside'], 'b-none': ['tbbnone', 'No borders'],
  copycsv: ['tbcopy', 'Copy as CSV'], copymd: ['tbcopy', 'Copy as Markdown'], copyhtml: ['tbcopy', 'Copy as HTML'], rawmd: ['tbcode', 'Show it in the .md'], simplify: ['tbsimp', 'Simplify to Markdown'], totext: ['file', 'Convert to text'], deltable: ['trash', 'Delete table'] };
TB_BG.forEach(c => { TB_ACTS['bg-' + c] = [null, `Cell colour: ${c}`]; }); TB_ACTS['bg-none'] = ['x', 'No cell colour'];
TB_FG.forEach(c => { TB_ACTS['fg-' + c] = [null, `Text colour: ${c}`]; }); TB_ACTS['fg-none'] = ['x', 'Default text colour'];
const TB_NOHEAD = 'Delete row: the header row can’t go (Markdown tables always have one). Turn the header off instead';
function tbState() {
  const p = TB.cur || (TB.sel && { id: TB.sel.id, t: TB.sel.t, r: Math.min(TB.sel.r0, TB.sel.r1), c: Math.min(TB.sel.c0, TB.sel.c1) }), tb = tbTable(p); if (!tb) return null;
  const m = tbRead(tb), g = m.grid[p.r]?.[p.c] || tbC();
  return { p, m, g, al: m.aligns[p.c] || 'left', va: g.va || 'top', hasHead: m.grid[0].some(x => tbText(x.h)), merged: g.cs > 1 || g.rs > 1, anyMerged: tbMerged(m), rich: tbRich(m), multi: tbMulti() && tbSame(TB.sel, p), list: /<(ul|ol)\b/i.test(g.h), check: /^\s*<input\b/i.test(g.h) };
}
function tbOff(act, s) {
  if (act === 'delrow' && (s.multi ? Math.min(TB.sel.r0, TB.sel.r1) : s.p.r) === 0) return TB_NOHEAD;
  if (act === 'split' && !s.merged) return 'Split cell: only a merged cell can be split';
  if (act === 'merge' && !s.multi) return 'Merge cells: select two or more cells first (drag across them, or Shift+click)';
  if (act === 'simplify' && !s.rich.length) return 'Simplify to Markdown: this table is already Markdown';
  if (['sort', 'header'].includes(act) && s.anyMerged) return `${TB_ACTS[act][1]}: split the merged cells first`;
  return '';
}
function tbOn(act, s) {
  if (act === 'header') return s.hasHead; if (act === 'list') return s.list; if (act === 'check') return s.check;
  if (act === 'al' || act === 'ac' || act === 'ar') return s.al === { al: 'left', ac: 'center', ar: 'right' }[act];
  if (act === 'vt' || act === 'vm' || act === 'vb') return s.va === { vt: 'top', vm: 'middle', vb: 'bottom' }[act];
  if (/^b-/.test(act)) return s.m.borders === act.slice(2); if (/^bg-/.test(act)) return (s.g.bg || 'none') === act.slice(3); if (/^fg-/.test(act)) return (s.g.fg || 'none') === act.slice(3);
  return null;
}
function tbB(act, s) {   // a toolbar button
  const [icon, label] = TB_ACTS[act], on = tbOn(act, s), off = tbOff(act, s);
  return `<button class="icon-btn icon-btn--sm" data-tb="${act}" aria-label="${esc(off || label)}" title="${esc(off || label)}"${on != null ? ` aria-pressed="${on}"` : ''}${off ? ' aria-disabled="true"' : ''}>${ic(icon)}</button>`;
}
function tbItem(act, s) {   // a menu item: the same icon and label
  const [icon, label] = TB_ACTS[act], off = tbOff(act, s), on = tbOn(act, s), danger = ['delrow', 'delcol', 'deltable'].includes(act);
  return `<button class="menu-item${danger ? ' menu-item--danger' : ''}" role="${on != null ? 'menuitemcheckbox' : 'menuitem'}" data-tb="${act}"${on != null ? ` aria-checked="${on}"` : ''}${off ? ` aria-disabled="true" title="${esc(off)}"` : ''}>${ic(icon)}<span>${label}</span></button>`;
}
const tbIconRow = (label, acts, s) => `<div class="tb-row" role="group" aria-label="${label}"><span class="tb-mlabel">${label}</span>${acts.map(a => { const off = tbOff(a, s), on = tbOn(a, s);
  return `<button class="icon-btn icon-btn--sm" data-tb="${a}" role="${on != null ? 'menuitemradio' : 'menuitem'}"${on != null ? ` aria-checked="${on}"` : ''} aria-label="${esc(off || TB_ACTS[a][1])}" title="${esc(off || TB_ACTS[a][1])}"${off ? ' aria-disabled="true"' : ''}${['delrow', 'delcol'].includes(a) && !off ? ' data-danger' : ''}>${ic(TB_ACTS[a][0])}</button>`; }).join('')}</div>`;
const tbSwatches = (kind, s) => `<div class="tb-row" role="group" aria-label="${kind === 'bg' ? 'Cell colour' : 'Text colour'}"><span class="tb-mlabel">${kind === 'bg' ? 'Cell colour' : 'Text colour'}</span>${(kind === 'bg' ? TB_BG : TB_FG).map(c => { const a = `${kind}-${c}`;
  return `<button class="hl-dot${kind === 'fg' ? ' hl-dot--text tc-' : ' hl-'}${c}" data-tb="${a}" role="menuitemradio" aria-checked="${tbOn(a, s)}" aria-label="${TB_ACTS[a][1]}" title="${TB_ACTS[a][1]}">${kind === 'fg' ? 'A' : ''}</button>`; }).join('')}<button class="icon-btn icon-btn--sm" data-tb="${kind}-none" role="menuitemradio" aria-checked="${tbOn(kind + '-none', s)}" aria-label="${TB_ACTS[kind + '-none'][1]}" title="${TB_ACTS[kind + '-none'][1]}">${ic('x')}</button></div>`;
function tbBarHtml(s) {   // rows · columns · align (both ways) · cells (merge, split, colour, list, checkbox) · header, sort, borders · ⋮ More
  const sep = '<span class="tb-sep" aria-hidden="true"></span>', grp = (l, a) => `<span class="tb-group" role="group" aria-label="${l}">${a.map(x => tbB(x, s)).join('')}</span>`;
  const pick = (k, icon, label) => `<button class="icon-btn icon-btn--sm" data-tb-pick="${k}" aria-haspopup="dialog" aria-expanded="${TB.pick === k}" aria-label="${label}" title="${label}">${ic(icon)}</button>`;
  return `<div class="card tb-bar" role="toolbar" aria-label="Table">${grp('Rows', ['rowup', 'rowdown', 'delrow'])}${sep}${grp('Columns', ['colleft', 'colright', 'delcol'])}${sep}${grp('Align across', ['al', 'ac', 'ar'])}${grp('Align up and down', ['vt', 'vm', 'vb'])}${sep}`
    + `${grp('Cells', ['merge', 'split'])}${pick('colour', 'tbcolour', 'Cell and text colour')}${grp('In the cell', ['list', 'check'])}${sep}${tbB('header', s)}${tbB('sort', s)}${pick('borders', 'tbball', 'Borders')}${sep}`
    + `<button class="icon-btn icon-btn--sm" data-tb-more aria-haspopup="menu" aria-expanded="${TB.more}" aria-label="More for this table" title="More">${ic('more')}</button></div>`;
}
const tbPickHtml = s => `<div class="popover card tb-pick" role="dialog" aria-label="${TB.pick === 'colour' ? 'Cell and text colour' : 'Borders'}">${TB.pick === 'colour' ? tbSwatches('bg', s) + tbSwatches('fg', s) : ['b-all', 'b-outer', 'b-none'].map(a => tbItem(a, s)).join('')}</div>`;
const tbFoot = s => `<div class="menu-sep"></div><div class="tb-foot">${s.rich.length ? `Rich table · saved as HTML: ${esc(s.rich.join(', '))}. Obsidian edits it as raw HTML.` : 'Saved as Markdown. Merges, widths, colours, borders or a list in a cell save it as HTML.'}</div>`;
const tbMoreHtml = s => `<div class="menu card tb-menu tb-moremenu" role="menu" aria-label="More for this table">${['rawmd', 'simplify'].map(a => tbItem(a, s)).join('')}<div class="menu-sep"></div>${['copycsv', 'copymd', 'copyhtml', 'totext'].map(a => tbItem(a, s)).join('')}<div class="menu-sep"></div>${tbItem('deltable', s)}${tbFoot(s)}</div>`;
function tbMenuHtml(s) {   // one menu, at the pointer (a right-click) or at a grip: every action, grouped Row · Column · Cell · Table; rows of icons keep it short
  const mn = TB.menu, head = l => `<div class="tb-mhead">${l}</div>`, sep = '<div class="menu-sep"></div>';
  return `<div class="menu card tb-menu tb-menu--${mn.kind}" role="menu" aria-label="${mn.kind === 'row' ? 'This row' : mn.kind === 'col' ? 'This column' : 'This cell'}">`
    + (mn.kind === 'cell' && typeof djCellText === 'function' ? djCellText() : '')   // Fix A (QC 4 · 39): Tidy up and Copy on the cell (or the selection in it)
    + `${tbIconRow('Row', ['rowup', 'rowdown', 'delrow'], s)}${tbIconRow('Column', ['colleft', 'colright', 'delcol', 'sort'], s)}${tbIconRow('Align', ['al', 'ac', 'ar'], s)}${sep}`
    + `${tbIconRow('Cell', ['merge', 'split', 'list', 'check'], s)}${tbIconRow('Up and down', ['vt', 'vm', 'vb'], s)}${tbSwatches('bg', s)}${tbSwatches('fg', s)}${sep}`
    + `${head('Table')}${tbItem('header', s)}${tbIconRow('Borders', ['b-all', 'b-outer', 'b-none'], s)}${['rawmd', 'simplify', 'copycsv', 'copymd', 'copyhtml', 'totext', 'deltable'].map(a => tbItem(a, s)).join('')}${tbFoot(s)}</div>`;
}

/* ---- The two dialogs (R41's anatomy, Build L's dlg): Simplify's confirm, and the table as the .md holds it ---- */
function tbSimplifyModal() {
  const sm = TB.simp; if (!sm) return '';
  return dlg({ id: 'tb-simplify', size: 'sm', title: 'Simplify this table to Markdown?', role: 'alertdialog', descId: 'tb-simp-d', x: 'close', xLabel: 'Close: keep the rich table',
    body: `<p id="tb-simp-d">Markdown can’t store everything this table has:</p><ul class="tb-loss">${sm.losses.map(l => `<li>${esc(l)}</li>`).join('')}</ul><p class="set-desc">You can undo it straight after.</p>`,
    cancel: '<button class="btn btn--secondary" data-act="close">Keep the rich table</button>', main: '<button class="btn btn--primary" data-tb-modal="simplify-ok" title="Enter">Simplify to Markdown</button>' });
}
function tbRawModal() {
  const tb = tbTable(TB.raw?.p); if (!tb) return '';
  const m = tbRead(tb), why = tbRich(m), rich = why.length > 0, html = tbSource(tb, 'html'), md = tbSource(rich ? tbBuild(tbSimplify(m)) : tb, 'md');
  return dlg({ id: 'tb-raw', size: 'wide', title: 'This table in the .md', sub: rich ? `Saved as HTML: ${esc(why.join(', '))}` : 'Saved as a Markdown table',
    body: `<div class="tb-rawcols"><section class="tb-rawcol${rich ? ' is-now' : ''}"><div class="eyebrow">As HTML${rich ? ' · saved now' : ''}</div><pre class="code tb-src" data-tb-src="html">${esc(html)}</pre></section>`
      + `<section class="tb-rawcol${rich ? '' : ' is-now'}"><div class="eyebrow">As Markdown${rich ? ' · what Simplify would keep' : ' · saved now'}</div><pre class="code tb-src" data-tb-src="md">${esc(md)}</pre></section></div>`
      + '<p class="set-desc">In Obsidian an HTML table shows as a table, but it’s edited as raw HTML (no table editor), and Markdown inside a cell, like **bold** or [[links]], shows as typed. NeuroVault renders it.</p>',
    others: [`<button class="btn btn--secondary" data-tb-modal="copyhtml">${ic('tbcopy')}Copy as HTML</button>`], main: '<button class="btn btn--primary" data-act="close">Done</button>' });
}
{ const tbClose0 = closeModal;
  closeModal = function () {   // eslint-disable-line no-global-assign
    const was = S.modal, p = was === 'tb-raw' ? TB.raw?.p : was === 'tb-simplify' ? TB.simp?.p : null, r = tbClose0.apply(this, arguments);
    if (p && !S.modal) { TB.raw = null; TB.simp = null; if (was === 'tb-simplify') tbSay('Kept the rich table'); if (tbCellAt(p)) { tbCaret(p); tbPaint(); } }   // back to the cell
    return r;
  };
}
{ const tbModal0 = renderModal;
  renderModal = function () { if (S.modal === 'tb-simplify') return tbSimplifyModal(); if (S.modal === 'tb-raw') return tbRawModal(); return tbModal0.apply(this, arguments); };   // eslint-disable-line no-global-assign
}

/* ---- Drawing: the layer beside each note (grips, +, resize edges, the rich tag), the current cell and selection, the toolbar and menus ---- */
const tbZ = () => app.getBoundingClientRect().width / app.offsetWidth || 1;
function tbLayer(doc) { let L = doc.nextElementSibling; if (!L || !L.classList.contains('tb-layer')) { L = document.createElement('div'); L.className = 'tb-layer'; L.setAttribute('contenteditable', 'false'); L.setAttribute('data-md-ignore', ''); doc.after(L); } return L; }
const tbCssPath = (doc, el) => { const out = []; for (let n = el; n && n !== doc; n = n.parentElement) out.unshift(`:nth-child(${[...n.parentElement.children].indexOf(n) + 1})`); return `.doc[data-note="${CSS.escape(doc.dataset.note)}"] > ` + out.join(' > '); };
function tbGrips(doc, tb, t, full) {   // grips over each column and beside each row, a + on every gap, a resize edge on every column, the rich tag
  const L = tbLayer(doc), lr = L.getBoundingClientRect(), z = tbZ(), tr = tb.getBoundingClientRect(), X = v => (v - lr.left) / z, Y = v => (v - lr.top) / z;
  const { occ, nc } = tbMap(tb), rows = [...tb.rows];
  const L0 = [], R0 = []; for (let c = 0; c < nc; c++) { for (const row of occ) { const el = row[c]; if (el && el.colSpan <= 1) { const b = el.getBoundingClientRect(); L0[c] = b.left; R0[c] = b.right; break; } } if (L0[c] == null) { L0[c] = c ? R0[c - 1] : tr.left; R0[c] = L0[c] + 64; } }
  const inView = x => x >= tb.getBoundingClientRect().left - 1 && x <= tb.getBoundingClientRect().left + tb.clientWidth + 1;   // a wide table scrolls inside itself: tools only where it shows
  let h = '';
  if (full) {
    h += L0.map((x, i) => inView((x + R0[i]) / 2) ? `<button class="tb-grip tb-grip--col" data-tb-grip="col" data-i="${i}" data-t="${t}" style="left:${(X((x + R0[i]) / 2) - 10).toFixed(1)}px;top:${(Y(tr.top) - 21).toFixed(1)}px" aria-label="Column ${i + 1}: drag to move, click for its menu" title="Drag to move · click for the column’s menu">${ic('tbgrip')}</button>` : '').join('');
    h += rows.map((r, i) => { const b = r.getBoundingClientRect(); return `<button class="tb-grip tb-grip--row" data-tb-grip="row" data-i="${i}" data-t="${t}" style="left:${(X(tr.left) - 21).toFixed(1)}px;top:${(Y((b.top + b.bottom) / 2) - 10).toFixed(1)}px" aria-label="${i ? `Row ${i}` : 'Header row'}: ${i ? 'drag to move, ' : ''}click for its menu" title="${i ? 'Drag to move · ' : ''}click for the row’s menu">${ic('tbgrip')}</button>`; }).join('');
    if (TB.hot && TB.hot.tb === tb) {   // the + on every gap: while the pointer is over the table
      h += [...L0, R0[nc - 1]].map((x, i) => inView(x) ? `<button class="tb-plus tb-plus--col" data-tb-plus="col" data-i="${i}" data-t="${t}" style="left:${(X(x) - 8).toFixed(1)}px;top:${(Y(tr.top) - 19).toFixed(1)}px" aria-label="Insert a column here" title="Insert a column here">${ic('plus')}</button>` : '').join('');
      h += rows.slice(1).map((r, i) => `<button class="tb-plus tb-plus--row" data-tb-plus="row" data-i="${i + 2}" data-t="${t}" style="left:${(X(tr.left) - 19).toFixed(1)}px;top:${(Y(r.getBoundingClientRect().bottom) - 8).toFixed(1)}px" aria-label="Insert a row here" title="Insert a row here">${ic('plus')}</button>`).join('');
    }
    h += R0.map((x, i) => inView(x) ? `<span class="tb-colsize" data-tb-size="${i}" data-t="${t}" style="left:${(X(x) - 4).toFixed(1)}px;top:${Y(tr.top).toFixed(1)}px;height:${(tr.height / z).toFixed(1)}px" role="separator" aria-orientation="vertical" aria-label="Column ${i + 1} width: drag to resize" title="Drag to resize (saved as HTML: Markdown can’t store widths)"></span>` : '').join('');
  }
  const why = tbRich(tbRead(tb));
  if (why.length) h += `<span class="tb-richtag" style="left:${(X(Math.min(tr.right, tb.getBoundingClientRect().left + tb.clientWidth))).toFixed(1)}px;top:${(Y(tr.bottom) + 6).toFixed(1)}px" title="Saved as HTML because Markdown can’t store: ${esc(why.join(', '))}">Rich table · saved as HTML</span>`;
  return h;
}
function tbHiStyle() {   // the current cell, the selection and set column widths, drawn without touching the note
  let css = ''; const cur = TB.cur, doc = cur && tbDocOf(cur.id);
  // A width you dragged holds even when the table is wider than the note (it scrolls inside itself): Chrome would squeeze a <col>'s width
  tbDocs().forEach(d => tbTables(d).forEach(tb => { const ws = [...tb.querySelectorAll(':scope > colgroup > col')].map(c => parseInt(c.getAttribute('width'), 10) || 0); if (!ws.some(Boolean)) return;
    tbMap(tb).pos.forEach(([, c], td) => { let w = 0; for (let j = 0; j < Math.max(1, td.colSpan || 1); j++) { if (!ws[c + j]) { w = 0; break; } w += ws[c + j]; }
      if (w) css += tbCssPath(d, td) + ` { box-sizing: border-box; width: ${w}px; min-width: ${w}px; max-width: ${w}px; }
`; }); }));
  if (TB.sel && tbMulti()) { const s = TB.sel, d = tbDocOf(s.id), tb = tbTable(s); if (d && tb) { const { occ } = tbMap(tb), set = new Set();
    for (let r = Math.min(s.r0, s.r1); r <= Math.max(s.r0, s.r1); r++) for (let c = Math.min(s.c0, s.c1); c <= Math.max(s.c0, s.c1); c++) if (occ[r]?.[c]) set.add(occ[r][c]);
    if (set.size) css += [...set].map(el => tbCssPath(d, el)).join(',\n') + ' { background: var(--accent-bg) !important; color: var(--text) !important; }\n'; } }
  if (cur && doc && !S.modal) { const el = tbCellAt(cur); if (el) css += tbCssPath(doc, el) + ' { box-shadow: inset 0 0 0 2px var(--accent); }\n'; }
  let st = document.getElementById('tb-hi'); if (!st) { st = document.createElement('style'); st.id = 'tb-hi'; document.head.append(st); }
  if (st.textContent !== css) st.textContent = css;
}
let tbRaf = 0;
const tbPaintSoon = () => { if (!tbRaf) tbRaf = setTimeout(() => { tbRaf = 0; tbPaint(); }, 0); };   // a timer, not a frame: a hidden window gets no frames
function tbPaint() {
  if (TB.cur && !tbCellAt(TB.cur)) TB.cur = null;
  if (TB.sel && !tbTable(TB.sel)) TB.sel = null;
  tbHiStyle();
  tbDocs().forEach(doc => { const tables = tbTables(doc), L = tbLayer(doc); if (tbRO) tables.forEach(tb => tbRO.observe(tb));   // a row growing as you type moves the grips
    L.innerHTML = tables.map((tb, t) => tbGrips(doc, tb, t, !S.modal && !doc.classList.contains('is-reading') && ((TB.hot && TB.hot.tb === tb) || (TB.cur && TB.cur.id === doc.dataset.note && TB.cur.t === t) || (TB.dragGrip && TB.dragGrip.id === doc.dataset.note && TB.dragGrip.t === t) || (TB.resize && TB.resize.tb === tb)))).join(''); });
  // the toolbar: while the caret is in a table, unless a dialog, a drag, a resize or the cell's own menu is up
  const bar = app.querySelector(':scope > .tb-bar'), s = (TB.cur || TB.sel) && tbState();
  const want = s && !S.modal && !TB.dragGrip && !TB.resize && !(TB.menu && TB.menu.kind === 'cell');
  if (want) { const html = tbBarHtml(s); if (bar) { if (bar.dataset.html !== html) { bar.outerHTML = html; app.querySelector(':scope > .tb-bar').dataset.html = html; } } else { app.insertAdjacentHTML('beforeend', html); app.querySelector(':scope > .tb-bar').dataset.html = html; } tbPlaceBar(s.p); }
  else bar?.remove();
  // the picker, More, the menu: drawn again each time (their checks follow the cell)
  app.querySelectorAll(':scope > .tb-pick, :scope > .tb-moremenu, :scope > .tb-menu').forEach(x => x.remove());
  if (s && !S.modal) {
    if (TB.pick && want) { app.insertAdjacentHTML('beforeend', tbPickHtml(s)); placeUnder(app.querySelector(':scope > .tb-pick'), app.querySelector(`.tb-bar [data-tb-pick="${TB.pick}"]`)); }
    if (TB.more && want) { app.insertAdjacentHTML('beforeend', tbMoreHtml(s)); placeUnder(app.querySelector(':scope > .tb-moremenu'), app.querySelector('.tb-bar [data-tb-more]')); }
    if (TB.menu) { app.insertAdjacentHTML('beforeend', tbMenuHtml(s)); const el = app.querySelector(':scope > .tb-menu:not(.tb-moremenu)'), g = TB.menu.btn && app.querySelector(TB.menu.btn);
      if (g) placeUnder(el, g); else tbPlaceAt(el, TB.menu.x, TB.menu.y); }
  } else { TB.pick = null; TB.more = false; if (!s) TB.menu = null; }
  const toast = app.querySelector(':scope > .tb-toast');
  if (TB.toast && !S.modal) { if (!toast) app.insertAdjacentHTML('beforeend', `<div class="toast card toast--undo tb-toast" role="status">${ic('ok')}<span>${esc(TB.toast.msg)}</span><button class="btn btn--secondary btn--sm" data-tb-undo title="Put the rich table back">Undo</button></div>`); }
  else toast?.remove();
}
function tbPlaceBar(p) {   // 6px over the table's top gutter, at its left edge; under it when there's no room above
  const bar = app.querySelector(':scope > .tb-bar'), tb = tbTable(p); if (!bar || !tb) return;
  const a = app.getBoundingClientRect(), z = tbZ(), r = tb.getBoundingClientRect(), view = (tb.closest('.view') || app).getBoundingClientRect();
  let top = (r.top - a.top) / z - 22 - bar.offsetHeight - 6; const vt = (view.top - a.top) / z + 4;
  if (top < vt) top = (r.bottom - a.top) / z + (tbRich(tbRead(tb)).length ? 32 : 10);
  const left = clamp((r.left - a.left) / z - 22, 8, app.offsetWidth - bar.offsetWidth - 8);
  Object.assign(bar.style, { left: left.toFixed(1) + 'px', top: clamp(top, 8, app.offsetHeight - bar.offsetHeight - 8).toFixed(1) + 'px' });
}
function tbPlaceAt(el, x, y) {   // R41: a menu opens at the pointer, 8px inside the window, flipped up when there's no room below
  if (!el) return; const a = app.getBoundingClientRect(), z = tbZ(); let l = (x - a.left) / z, t = (y - a.top) / z;
  l = clamp(l, 8, app.offsetWidth - el.offsetWidth - 8); if (t + el.offsetHeight > app.offsetHeight - 8) t = Math.max(8, t - el.offsetHeight);
  if (el.offsetHeight > app.offsetHeight - 16) { t = 8; el.style.maxHeight = (app.offsetHeight - 16) + 'px'; el.style.overflowY = 'auto'; }
  Object.assign(el.style, { position: 'absolute', left: l.toFixed(1) + 'px', top: t.toFixed(1) + 'px', right: 'auto', bottom: 'auto' });
}
const tbAfter0 = afterRender;
afterRender = function () {   // eslint-disable-line no-global-assign
  tbAfter0();
  tbDocs().forEach(doc => { if (doc.tbObs) return; doc.tbObs = new MutationObserver(tbPaintSoon); doc.tbObs.observe(doc, { childList: true, subtree: true, characterData: true, attributes: true }); });
  const p = tbFromSel(); TB.cur = p || (TB.cur && tbCellAt(TB.cur) ? TB.cur : null);   // a dialog or a redraw keeps the cell; the caret elsewhere in the note clears it (selectionchange)
  if (S.modal) { TB.menu = null; TB.more = false; TB.pick = null; }
  tbPaint();
};

/* ---- The caret, the keys, the mouse ---- */
const tbMine = el => !!el?.closest?.('.tb-bar, .tb-menu, .tb-pick, .tb-layer, .tb-toast');
document.addEventListener('selectionchange', () => {
  const p = tbFromSel(), c = TB.cur;
  if (p && c && p.id === c.id && p.t === c.t && p.r === c.r && p.c === c.c) return;
  if (!p && tbMine(document.activeElement)) return;
  if (!p && TB.sel && document.activeElement?.closest?.('.doc')) { if (c) return; }   // a drag selection holds no caret
  TB.cur = p; if (!p) { TB.pick = null; TB.more = false; } tbPaintSoon();
});
document.addEventListener('scroll', e => { if (e.target?.matches?.('.doc table') || app.querySelector(':scope > .tb-bar, :scope > .tb-menu, :scope > .tb-pick')) tbPaintSoon(); }, true);
const tbRO = window.ResizeObserver ? new ResizeObserver(tbPaintSoon) : null; if (tbRO) tbRO.observe(app);
function tbNext(p, back) {   // Tab: the next cell that starts somewhere (a merged cell counts once)
  const { occ, pos } = tbMap(tbTable(p)), cells = [];
  occ.forEach((row, r) => row.forEach((el, c) => { const at = pos.get(el); if (at && at[0] === r && at[1] === c) cells.push({ id: p.id, t: p.t, r, c }); }));
  const i = cells.findIndex(x => x.r === p.r && x.c === p.c); return back ? (i > 0 ? cells[i - 1] : null) : cells[i + 1] || null;
}
document.addEventListener('keydown', e => {
  if (e.isComposing) return;
  if (e.key === 'Escape' && (TB.menu || TB.more || TB.pick || tbMulti())) { e.preventDefault(); e.stopImmediatePropagation(); const p = TB.cur || (TB.sel && { id: TB.sel.id, t: TB.sel.t, r: TB.sel.r0, c: TB.sel.c0 }); TB.menu = null; TB.more = false; TB.pick = null; TB.sel = null; if (p) tbCaret(p); tbPaint(); return; }
  const doc = e.target.closest?.('.doc'); if (!doc || !doc.isContentEditable) return;
  const ctrl = e.ctrlKey || e.metaKey;
  if ((e.key === 'Delete' || e.key === 'Backspace') && !ctrl && tbMulti() && TB.sel.id === doc.dataset.note) {
    e.preventDefault(); e.stopImmediatePropagation(); const s = TB.sel, tb = tbTable(s); if (!tb) return; const m = tbRead(tb), nc = m.grid[0].length, nr = m.grid.length, b = tbBox(s);
    const rows = b.c0 === 0 && b.c1 === nc - 1 && b.r0 > 0, cols = b.r0 === 0 && b.r1 === nr - 1;
    tbDo(rows ? 'delrow' : cols ? 'delcol' : 'clear', { p: { id: s.id, t: s.t, r: b.r0, c: b.c0 } }); return;
  }
  if (ctrl && !e.altKey && !e.shiftKey && ['c', 'x'].includes(e.key.toLowerCase()) && tbMulti() && TB.sel.id === doc.dataset.note) {   // QC 82: the cells as tab-separated text
    e.preventDefault(); e.stopImmediatePropagation(); tbCopyCells(e.key.toLowerCase() === 'x'); return; }
  if (ctrl || e.altKey) return;
  const p = tbFromSel(); if (!p) return;
  if (e.key === 'Tab') { e.preventDefault(); e.stopImmediatePropagation(); TB.sel = null; const nx = tbNext(p, e.shiftKey);
    if (!nx && !e.shiftKey) { tbDo('addrow', { p }); tbCaret({ ...TB.cur, c: 0 }, true); return; } if (nx) tbCaret(nx, true); tbPaint(); return; }   // Docs and Word: the next cell's text selected
  if (e.key === 'Enter') { if (getSelection().anchorNode && edEl(getSelection().anchorNode)?.closest('li') && !e.shiftKey) return;   // Enter in a cell's list makes the next item
    if (!e.shiftKey) { e.preventDefault(); e.stopImmediatePropagation(); tbSay('Enter stays in the cell: Shift+Enter for a new line, Tab for the next cell'); } }   // Shift+Enter: the browser's line break
}, true);
document.addEventListener('mousedown', e => {
  const t = e.target;
  if (t.closest?.('.tb-colsize')) { e.preventDefault(); const sz = t.closest('.tb-colsize'), doc = sz.closest('.ed-pane')?.querySelector('.doc'), ti = +sz.dataset.t, c = +sz.dataset.tbSize, tb = tbTables(doc)[ti]; if (!tb) return;
    const el = tbMap(tb).occ.map(r => r[c]).find(x => x && x.colSpan <= 1); TB.resize = { id: doc.dataset.note, t: ti, c, tb, wasRich: tbRich(tbRead(tb)).length > 0, x0: e.clientX, w0: el ? el.getBoundingClientRect().width / tbZ() : 100, doc }; tbPaint(); return; }   // the toolbar steps aside while a column is resized
  const grip = t.closest?.('.tb-grip');
  if (grip && e.button === 0) { e.preventDefault(); const doc = grip.closest('.ed-pane')?.querySelector('.doc'); TB.gripDown = { id: doc?.dataset.note, k: grip.dataset.tbGrip, i: +grip.dataset.i, t: +grip.dataset.t, x: e.clientX, y: e.clientY }; return; }   // a grip is dragged with the pointer (no HTML5 drag: file drops keep theirs)
  if (tbMine(t)) { e.preventDefault(); return; }   // the caret stays in its cell
  if (e.button !== 0) return;
  const cell = t.closest?.('.doc td, .doc th'), p = tbPos(cell);
  if (!p) { if (TB.sel) { TB.sel = null; tbPaintSoon(); } return; }
  if (e.shiftKey && TB.cur && tbSame(TB.cur, p)) { e.preventDefault(); TB.sel = { id: p.id, t: p.t, r0: TB.cur.r, c0: TB.cur.c, r1: p.r, c1: p.c }; tbPaint(); return; }
  TB.sel = null; TB.drag = p; tbPaintSoon();
}, true);
document.addEventListener('mousemove', e => {
  const rz = TB.resize;
  if (rz) { const w = Math.max(48, rz.w0 + (e.clientX - rz.x0) / tbZ()), tb = rz.tb; if (!tb.isConnected) { TB.resize = null; return; }
    if (!rz.rec) { edRecord(rz.doc); rz.rec = true; }   // one undo step for the whole drag, from where it started
    let cg = tb.querySelector(':scope > colgroup'); if (!cg) { const nc = tbMap(tb).nc; tb.insertAdjacentHTML('afterbegin', `<colgroup>${'<col>'.repeat(nc)}</colgroup>`); cg = tb.querySelector(':scope > colgroup'); }
    const col = cg.children[rz.c]; if (col) col.setAttribute('width', String(Math.round(w))); rz.w = w; return; }
  const d0 = TB.drag;
  if (d0 && e.buttons === 1) { const p = tbPos(e.target.closest?.('.doc td, .doc th')); if (p && tbSame(p, d0) && (p.r !== d0.r || p.c !== d0.c)) { const s = { id: d0.id, t: d0.t, r0: d0.r, c0: d0.c, r1: p.r, c1: p.c }; if (!TB.sel || JSON.stringify(s) !== JSON.stringify(TB.sel)) { TB.sel = s; TB.cur = { ...d0 }; getSelection().removeAllRanges(); tbPaint(); } } }
  else if (d0) TB.drag = null;
  // the table under the pointer (and its 24px gutter): its grips and + show
  const hot = tbHotAt(e.clientX, e.clientY, e.target); if ((hot?.tb || null) !== (TB.hot?.tb || null)) { TB.hot = hot; tbPaintSoon(); }
}, { passive: true });
function tbHotAt(x, y, target) {
  if (target?.closest?.('.tb-layer')) return TB.hot;
  for (const doc of tbDocs()) for (const tb of tbTables(doc)) { const r = tb.getBoundingClientRect(); if (x >= r.left - 26 && x <= r.right + 12 && y >= r.top - 26 && y <= r.bottom + 12) return { tb }; }
  return null;
}
document.addEventListener('mouseup', () => {
  TB.drag = null; const rz = TB.resize; if (!rz) return; TB.resize = null;
  if (rz.w && rz.tb.isConnected) tbDo('width', { c: rz.c, w: rz.w, p: { id: rz.id, t: rz.t, r: 0, c: rz.c }, noRecord: rz.rec, wasRich: rz.wasRich }); else tbPaint();
}, true);
document.addEventListener('contextmenu', e => {
  // Build M parity (R51 r49-hint): no Windows right-click menu anywhere, so Shift + right-click opens the cell's menu too   // Shift + right-click: the browser's own menu (Paste, spelling)
  const cell = e.target.closest?.('.doc td, .doc th'), p = tbPos(cell); if (!p) return;
  e.preventDefault(); e.stopPropagation(); if (S.ctx) { S.ctx = null; app.querySelectorAll('.menu--context').forEach(x => x.remove()); }
  const b = TB.sel && tbSame(TB.sel, p) ? tbBox(TB.sel) : null; const inSel = b && p.r >= b.r0 && p.r <= b.r1 && p.c >= b.c0 && p.c <= b.c1, keep = inSel ? TB.sel : null;
  if (!inSel || !tbMulti()) tbCaret(p); TB.cur = p; TB.sel = keep;
  const kb = !e.clientX && !e.clientY, cb = cell.getBoundingClientRect();   // the menu key or Shift+F10: at the cell, not the window's corner
  TB.pick = null; TB.more = false; TB.menu = { kind: 'cell', x: kb ? cb.left + 12 : e.clientX, y: kb ? cb.bottom - 4 : e.clientY }; tbPaint(); app.querySelector(':scope > .tb-menu [data-tb]:not([aria-disabled])')?.focus({ preventScroll: true });
}, true);
// QC 83 (Build V, overnight): arrow keys inside the table menus, More and the pickers (Tab, Shift+Tab and Esc already worked).
// Up and Down go to the line above or below (a row of icons or swatches is one line; the column is kept where it can be);
// Left and Right go along a row of icons or swatches; Home and End go to the first and last item. Each wraps round.
document.addEventListener('keydown', e => {
  if (e.ctrlKey || e.altKey || e.metaKey || !['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
  const m = document.activeElement?.closest?.('.tb-menu, .tb-pick'); if (!m || !app.contains(m)) return;
  const items = [...m.querySelectorAll('button:not([disabled]):not([aria-disabled="true"])')].filter(b => b.getClientRects().length);
  if (!items.length) return;
  e.preventDefault(); e.stopImmediatePropagation();
  const lines = []; items.forEach(b => { const k = b.closest('.tb-row') || b, l = lines.find(x => x.k === k); if (l) l.items.push(b); else lines.push({ k, items: [b] }); });
  const at = items.indexOf(document.activeElement), li = lines.findIndex(l => l.items.includes(document.activeElement)), line = lines[li], col = line ? line.items.indexOf(document.activeElement) : 0;
  let to;
  if (e.key === 'Home') to = items[0];
  else if (e.key === 'End') to = items[items.length - 1];
  else if (at < 0) to = items[0];
  else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { const nx = lines[(li + (e.key === 'ArrowDown' ? 1 : lines.length - 1)) % lines.length]; to = nx.items[Math.min(col, nx.items.length - 1)]; }
  else to = line.items[(col + (e.key === 'ArrowRight' ? 1 : line.items.length - 1)) % line.items.length];
  to?.focus({ preventScroll: true });
}, true);
document.addEventListener('pointerdown', e => {   // R41: a press anywhere else closes a menu, More and the pickers
  if (!(TB.menu || TB.more || TB.pick)) return; const t = e.target;
  if (t.closest?.('.tb-menu, .tb-pick') || t.closest?.('[data-tb-more], [data-tb-pick], .tb-grip')) return;
  TB.menu = null; TB.more = false; TB.pick = null; tbPaintSoon();
}, true);
document.addEventListener('click', e => {
  const t = e.target.closest?.('[data-tb], [data-tb-more], [data-tb-pick], [data-tb-grip], [data-tb-plus], [data-tb-undo], [data-tb-modal]'); if (!t || !app.contains(t)) return;
  e.preventDefault(); e.stopPropagation();
  if (t.dataset.tbModal === 'simplify-ok') { const p = TB.simp?.p; TB.keepCopy = p && tbTable(p) ? tbCopyPlan(p) : null; S.modal = null; TB.simp = null; renderAll(); if (p) { TB.simpAt = p; tbDo('simplify-ok', { p: { ...p, r: 0, c: 0 } }); } if (TB.keepCopy) tbKeepCopy(TB.keepCopy); TB.keepCopy = null; return; }   // Build M · round 6: the copy
  if (t.dataset.tbModal === 'copyhtml') { const tb = tbTable(TB.raw?.p); if (tb) { const txt = tbSource(tb, 'html'); TB.copied = txt; tbCopy(txt); toastHere('Copied the table as HTML'); } return; }
  if (t.hasAttribute('data-tb-undo')) { tbUndoSimplify(); return; }
  if (t.hasAttribute('data-tb-more')) { TB.more = !TB.more; TB.menu = null; TB.pick = null; tbPaint(); return; }
  if (t.dataset.tbPick) { TB.pick = TB.pick === t.dataset.tbPick ? null : t.dataset.tbPick; TB.more = false; TB.menu = null; tbPaint(); return; }
  const doc = t.closest('.ed-pane')?.querySelector('.doc');
  if (t.dataset.tbGrip && Date.now() - (TB.dragEnded || 0) < 400) return;   // the release of a drag, not a click
  if (t.dataset.tbGrip) { const k = t.dataset.tbGrip, i = +t.dataset.i, ti = +t.dataset.t, id = doc?.dataset.note, tb = tbTables(doc)[ti]; if (!tb) return; const m = tbRead(tb);
    TB.sel = k === 'row' ? { id, t: ti, r0: i, r1: i, c0: 0, c1: m.grid[0].length - 1 } : { id, t: ti, r0: 0, r1: m.grid.length - 1, c0: i, c1: i }; tbCaret({ id, t: ti, r: k === 'row' ? i : 0, c: k === 'row' ? 0 : i });
    TB.more = false; TB.pick = null; TB.menu = { kind: k, btn: `.tb-layer .tb-grip[data-tb-grip="${k}"][data-i="${i}"][data-t="${ti}"]` }; tbPaint(); return; }
  if (t.dataset.tbPlus) { const k = t.dataset.tbPlus, i = +t.dataset.i, ti = +t.dataset.t, id = doc?.dataset.note; TB.sel = null; tbDo(k === 'row' ? 'rowat' : 'colat', { at: i, p: { id, t: ti, r: k === 'row' ? i - 1 : 0, c: k === 'row' ? 0 : Math.max(0, i - 1) } }); return; }
  const act = t.dataset.tb; if (!act || !TB_ACTS[act]) return;
  if (t.getAttribute('aria-disabled') === 'true') { tbSay(t.title || t.getAttribute('aria-label')); return; }
  tbDo(act);
}, true);
// A grip dragged: the row or column under the pointer is outlined, and the drop moves it there (the header row stays on top)
function tbDropAt(s, x, y) {
  const tb = tbTable(s); if (!tb) return null; const { occ, nr, nc } = tbMap(tb);
  if (s.k === 'row') { const rows = [...tb.rows]; let to = rows.findIndex(r => { const b = r.getBoundingClientRect(); return y < b.bottom; }); if (to < 0) to = nr - 1; return Math.max(1, to); }
  for (let c = 0; c < nc; c++) { const el = occ.map(r => r[c]).find(v => v && v.colSpan <= 1); if (el && x < el.getBoundingClientRect().right) return c; }
  return nc - 1;
}
function tbDropMark(s) {   // the outline round where it will land
  const tb = tbTable(s), doc = tbDocOf(s.id); if (!tb || !doc || s.to == null) return; const L = tbLayer(doc), lr = L.getBoundingClientRect(), z = tbZ(), tr = tb.getBoundingClientRect();
  let b; if (s.k === 'row') { const r = tb.rows[s.to].getBoundingClientRect(); b = { l: tr.left, t: r.top, w: Math.min(tr.width, tb.clientWidth), h: r.height }; }
  else { const el = tbMap(tb).occ.map(r => r[s.to]).find(v => v && v.colSpan <= 1); const r = el ? el.getBoundingClientRect() : tr; b = { l: r.left, t: tr.top, w: r.width, h: tr.height }; }
  L.querySelector('.tb-drop')?.remove();
  L.insertAdjacentHTML('beforeend', `<span class="tb-drop" style="left:${((b.l - lr.left) / z).toFixed(1)}px;top:${((b.t - lr.top) / z).toFixed(1)}px;width:${(b.w / z).toFixed(1)}px;height:${(b.h / z).toFixed(1)}px"></span>`);
}
document.addEventListener('mousemove', e => {
  const g = TB.gripDown; if (!g) return; if (e.buttons !== 1) { TB.gripDown = null; if (TB.dragGrip) { TB.dragGrip = null; tbPaintSoon(); } return; }
  if (!TB.dragGrip && Math.hypot(e.clientX - g.x, e.clientY - g.y) < 5) return;
  if (g.k === 'row' && g.i === 0) return;   // the header row doesn't move
  const was = TB.dragGrip; TB.dragGrip = { ...g, to: tbDropAt(g, e.clientX, e.clientY) }; TB.menu = null; getSelection().removeAllRanges?.();
  if (!was) tbPaint(); tbDropMark(TB.dragGrip);   // the toolbar steps aside while a grip moves
}, true);
document.addEventListener('mouseup', e => {
  const g = TB.gripDown, s = TB.dragGrip; TB.gripDown = null; if (!s) return; TB.dragGrip = null; TB.dragEnded = Date.now();
  const to = tbDropAt(s, e.clientX, e.clientY);
  if (to == null || to === s.i) { tbPaint(); return; }
  tbDo(s.k === 'row' ? 'moverow' : 'movecol', { from: s.i, to, p: { id: s.id, t: s.t, r: s.k === 'row' ? s.i : 0, c: s.k === 'col' ? s.i : 0 } }); void g;
}, true);

/* ==== Build M · round 6 (the decision to r48-simplify, 2026-10-18): "Simplify to Markdown keeps a copy too".
   The rich table, as the .md held it (HTML), is saved to attachments/ as "<note> table (rich) <time>.html" and linked by a
   hidden line under the simplified table, "<!-- ![[attachments/…html]] -->" (as the converter links a table's CSV), so it
   shows in the note's Attachments tab and nothing of the rich table is lost. Undo still puts the rich table back. ==== */
function tbCopyPlan(p) {   // what the .md held (HTML), the file's name (decided now), the note
  const n = D.notes.find(x => x.id === p.id) || note(), d = new Date();
  const stem = `${(n?.title || 'Table').slice(0, 31).trimEnd()} table (rich)`.replace(/[\\/:*?"<>|#^[\]]+/g, '-');   // QC 63: 60 at most with the time (the backend cuts at 60, which cut the time)
  const name = `${stem} ${d.getFullYear()}${two(d.getMonth() + 1)}${two(d.getDate())}-${two(d.getHours())}${two(d.getMinutes())}${two(d.getSeconds())}.html`;
  return { p, name, file: 'attachments/' + name, html: tbSource(tbTable(p), 'html'), title: stem };
}
function tbCopyLine(k, p) {   // "<!-- ![[attachments/…html]] -->" under the simplified table
  const tb = tbTable(p || k.p), doc = tb?.closest('.doc'); if (!tb || !doc) return;
  let top = tb; while (top.parentElement && top.parentElement !== doc) top = top.parentElement;
  top.after(document.createComment(` ![[${k.file}]] `));
}
async function tbKeepCopy(k) {
  const said = S.status;   // "Simplified to Markdown · Undo puts the rich table back"
  const page = `<!doctype html>\n<meta charset="utf-8">\n<title>${esc(k.title)}</title>\n${k.html}\n`;
  let a = { file: k.file, name: k.name, kind: 'other', size: page.length, mtime: new Date().toISOString().slice(0, 19), uses: [] };
  if (api()) {
    const r = await nv('attachment_save_text', page, k.name.replace(/\.html$/, ''), 'html', true);
    if (failed(r)) { toast(`The rich table's copy couldn't be kept: ${r.message || 'error'}`); return; }
    a = { ...r, uses: [] };
    if (r.file !== k.file) app.querySelectorAll('.doc').forEach(doc => { const w = document.createTreeWalker(doc, NodeFilter.SHOW_COMMENT); let c;   // the name was taken: the line follows the file
      while ((c = w.nextNode())) if (c.data.includes(k.file)) { c.data = c.data.replace(k.file, r.file); edChanged(doc); } });
  }
  D.atts = [a, ...(D.atts || []).filter(x => x.file !== a.file)];
  TB.copyKept = a.file;
  if (S.status === said) tbSay(`Simplified to Markdown · a copy of the rich table is kept in Attachments (${a.name}) · Undo puts the rich table back`);   // only if nothing was said since (the save can come back late)
}
/* ==== end Build M · round 6 ==== */
