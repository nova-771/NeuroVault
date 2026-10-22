/* ==== Build M · R57: a mind map of a note, like mdmap (github.com/pererinha/mdmap, MIT; feedback: "its pretty cool"). Locked
   2026-10-19 (r57-map): tidy tree first; it opens beside the note from More ⋮ and stays in step with it; Centre root and Radial are
   choices in its head (and Settings → Editor, config mindmap_layout). Our own small renderer: SVG lines and node boxes, no React.
   - The note's own parser (marked.lexer, as the editor draws it) makes the nodes: the note's title, then each heading (nested by
     level), list item and task (nested by indent), paragraph, quote, code block, table and embed, each with its line in the .md.
   - Note → map: the map is drawn from the note, and again 0.4 s after you stop typing.
   - Map → note: click a node and its line lights up in the note (scrolled to); fold a node (its − / +N, Space, ←) and its lines
     fold in the note too (a view only: the .md keeps them); double-click (or Enter, F2) edits a node's words in its line, keeping
     its #, - or [ ]; while editing, Enter writes it and adds a node beside it, Tab one under it, Esc writes it and stops.
   - Width: the note keeps 440px: the right sidebar steps aside first, then the map narrows (at least 320px).
   Not yet: drag to re-parent, images in nodes, Mermaid export, saved positions.
   QC 107 (feedback: "I want zoom and pan features for the mind map and the abilities to pop out as its own window"): zoom (Ctrl+wheel,
   a pinch, − % + Fit in its head, Ctrl+= / − / 0), pan (drag the background, Space+drag, the middle button, the wheel, the arrow
   keys on the map itself), each note's zoom and place kept for the session; Pop out: the map in its own window (popout.py), drawn
   from the note NeuroVault's window sends it, which does what's done there (the block at the end). ==== */
'use strict';
Object.assign(ICON, { mindmap: '<circle cx="12" cy="12" r="2.5"/><circle cx="4.5" cy="6" r="2"/><circle cx="19.5" cy="6" r="2"/><circle cx="4.5" cy="18" r="2"/><circle cx="19.5" cy="18" r="2"/><path d="M9.8 10.8 6.3 7.2M14.2 10.8l3.5-3.6M9.8 13.2l-3.5 3.6M14.2 13.2l3.5 3.6"/>' });
const MM = { open: false, layout: 'tidy', sel: null, edit: null, pend: null, fold: {}, auto: {}, t: 0, shown: 0, total: 0, views: {}, popNote: null, popBase: null, lastPush: null };
const MM_POP = typeof POP !== 'undefined' && POP?.kind === 'mindmap';   // QC 107: this page is the map's own window
const mmOut = () => !MM_POP && typeof POPS !== 'undefined' && POPS.items.some(x => x.key === 'mindmap');   // NeuroVault's window: the map is in its own
const MM_LAYOUTS = [['tidy', 'Tree', 'A tree, left to right, like an outline'], ['centre', 'Centre', 'The note in the middle, its sections either side'], ['radial', 'Radial', 'The note in the middle, its sections around it']];
const MM_NW = 176, MM_NH = 40, MM_GX = 56, MM_GY = 12, MM_MAX = 300;
const MM_EDITS = new Set(['root', 'head', 'item', 'task', 'para', 'quote']);

/* ---- The note as nodes ---- */
const mmPlain = s => String(s ?? '').replace(/!\[\[([^\]|]+)(\|[^\]]*)?\]\]/g, '$1').replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, '$2').replace(/\[\[([^\]]+)\]\]/g, '$1')
  .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/<[^>]+>/g, '').replace(/(\*\*|__|~~|==)(.+?)\1/g, '$2').replace(/(\*|`)(.+?)\1/g, '$2')
  .replace(/(^|[^\w])_(\S(?:[^_]*\S)?)_(?=[^\w]|$)/g, '$1$2').replace(/\\([\\`*_{}[\]()#+\-.!|>~=])/g, '$1').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\s+/g, ' ').trim();
const MM_ITEM = /^(\s*)([-*+]|\d{1,9}[.)])([ \t]+|$)(\[[ xX]\][ \t]+)?(.*)$/, MM_HEAD = /^(\s{0,3}#{1,6})(?:[ \t]+(.*?))?(?:[ \t]+#+)?[ \t]*$/;
function mmTree(md, title, n) {
  const src = String(md ?? '').replace(/\r\n?/g, '\n'), L = src.split('\n'), nl = []; for (let i = 0; i < src.length; i++) if (src[i] === '\n') nl.push(i);
  const lineAt = off => { let a = 0, b = nl.length; while (a < b) { const m = (a + b) >> 1; if (nl[m] < off) a = m + 1; else b = m; } return a; };
  let body = src, base = 0; try { const b = NVMarkdown.splitFrontMatter(src).body; if (b !== src && src.endsWith(b)) { base = src.length - b.length; body = b; } } catch (e) { /* no front matter */ }
  let toks = []; try { toks = marked.lexer(body); } catch (e) { toks = []; }
  const seen = {}, root = { key: 'root', kind: 'root', text: title || 'Untitled note', raw: title || '', line: -1, end: L.length - 1, level: 0, depth: 0, kids: [], parent: null };
  const add = (par, nd) => { const k = nd.kind + ':' + nd.text.toLowerCase().slice(0, 80); seen[k] = (seen[k] || 0) + 1; Object.assign(nd, { key: k + '#' + seen[k], kids: [], parent: par, depth: par.depth + 1 }); par.kids.push(nd); return nd; };
  const lastLine = (l0, raw) => l0 + (String(raw).replace(/\n+$/, '').match(/\n/g) || []).length;
  // a node's line, checked against the .md: marked's raw text gives the line; a line that doesn't look right is looked for nearby
  const fix = (nd, ok) => { if (ok(L[nd.line] ?? '')) return; for (let d = 1; d <= 4; d++) for (const l of [nd.line + d, nd.line - d]) if (l >= 0 && l < L.length && ok(L[l])) { nd.end += l - nd.line; nd.line = l; return; } nd.lost = true; };
  const heads = [root];
  const walkList = (list, par, line0) => {
    let at = line0;
    (list.items || []).forEach(it => {
      const first = (it.tokens || []).find(t => t.type === 'text' || t.type === 'paragraph'), text = mmPlain(first ? first.text : it.text);
      const nd = add(par, { kind: it.task ? 'task' : 'item', text: text || '(empty item)', done: !!it.checked, line: at, end: lastLine(at, it.raw) });
      fix(nd, l => MM_ITEM.test(l)); const m = MM_ITEM.exec(L[nd.line] || '');
      nd.tend = nd.line + (first ? (String(first.raw).replace(/\n+$/, '').match(/\n/g) || []).length : 0);   // the item's own words end here (its children follow)
      if (m && !nd.lost) Object.assign(nd, { pre: m[1] + m[2] + (m[3] || ' ') + (m[4] || ''), ind: m[1].replace(/\t/g, '    ').length, cind: (m[1] + m[2] + (m[3] || ' ')).replace(/\t/g, '    ').length, marker: m[2],
        raw: [m[5], ...L.slice(nd.line + 1, nd.tend + 1)].map(x => x.trim()).filter(Boolean).join(' ') });
      let inner = '';
      (it.tokens || []).forEach((t, ti) => {
        const l = at + (inner.match(/\n/g) || []).length; inner += t.raw || '';
        if (t.type === 'list') walkList(t, nd, l);
        else if (t !== first && t.type !== 'space' && t.type !== 'checkbox') block(t, nd, l);
      });
      if (nd.kids.length) nd.end = Math.max(nd.end, ...nd.kids.map(k => k.end));
      at += (String(it.raw).match(/\n/g) || []).length;
    });
  };
  const block = (t, par, l0) => {
    const l1 = lastLine(l0, t.raw);
    switch (t.type) {
      case 'heading': { if (par !== heads.at(-1)) { const nd = add(par, { kind: 'para', text: mmPlain(t.text), line: l0, end: l1, ro: true }); return nd; }
        while (heads.at(-1).level >= t.depth) heads.pop();
        const nd = add(heads.at(-1), { kind: 'head', level: t.depth, text: mmPlain(t.text) || '(empty heading)', line: l0, end: l1 }); fix(nd, l => MM_HEAD.test(l));
        const m = MM_HEAD.exec(L[nd.line] || ''); if (m && !nd.lost) Object.assign(nd, { pre: m[1].trim() + ' ', raw: (m[2] || '').trim() }); else nd.ro = true;
        heads.push(nd); return nd; }
      case 'paragraph': { const tx = t.text.trim();
        if (tx === '{{tasks}}') { const nd = add(par, { kind: 'tasks', text: 'Tasks', line: l0, end: l1, ro: true });
          (n?.ltasks || (typeof taskLines === 'function' && n ? taskLines(n) : [])).forEach(x => add(nd, { kind: 'ltask', text: x.title, done: !!x.done, line: l0, end: l0, ro: true })); return nd; }
        if (/^!\[\[[^\]]+\]\]$|^!\[[^\]]*\]\([^)]*\)$/.test(tx)) return add(par, { kind: 'embed', text: mmPlain(tx), line: l0, end: l1, ro: true });
        const nd = add(par, { kind: 'para', text: mmPlain(t.text) || '(empty)', line: l0, end: l1 }); fix(nd, l => l.trim() !== '');
        if (!nd.lost) { nd.raw = L.slice(nd.line, nd.end + 1).map(x => x.trim()).join(' '); nd.pad = (L[nd.line].match(/^\s*/) || [''])[0]; } return nd; }
      case 'list': walkList(t, par, l0); return null;
      case 'blockquote': { const m = /^\s*>\s*\[!(\w+)\][+-]?\s*(.*)$/.exec(L[l0] || ''), one = l1 === l0 && !m;
        return add(par, { kind: 'quote', text: m ? mmPlain(m[2]) || m[1] : mmPlain(t.text).slice(0, 200), line: l0, end: l1, ro: !one, raw: one ? (L[l0] || '').replace(/^\s*>\s?/, '').trim() : undefined }); }
      case 'code': return add(par, { kind: 'code', text: 'Code' + (t.lang ? ' · ' + t.lang : ''), line: l0, end: l1, ro: true });
      case 'table': return add(par, { kind: 'table', text: `Table · ${(t.rows || []).length} row${(t.rows || []).length === 1 ? '' : 's'}`, line: l0, end: l1, ro: true });
      case 'html': { const tx = mmPlain(t.text); if (!tx || /^\s*<!--/.test(t.text)) return null; return add(par, { kind: 'para', text: tx, line: l0, end: l1, ro: true }); }
      case 'space': case 'hr': case 'def': return null;
      default: { const tx = mmPlain(t.text || t.raw || ''); return tx ? add(par, { kind: 'para', text: tx.slice(0, 200), line: l0, end: l1, ro: true }) : null; }
    }
  };
  let off = 0;
  toks.forEach(t => { const l0 = lineAt(base + off); off += (t.raw || '').length; block(t, heads.at(-1), l0); });
  // each heading's section: to the next heading at its level or higher
  const all = []; (function walk(x) { all.push(x); x.kids.forEach(walk); })(root);
  const hs = all.filter(x => x.kind === 'head').sort((a, b) => a.line - b.line), last = (() => { let i = L.length - 1; while (i > 0 && !L[i].trim()) i--; return i; })();
  hs.forEach((h, i) => { const nx = hs.slice(i + 1).find(x => x.level <= h.level); let e = nx ? nx.line - 1 : last; while (e > h.line && !(L[e] || '').trim()) e--; h.end = Math.max(h.line, e); });
  all.forEach(x => { x.edit = MM_EDITS.has(x.kind) && !x.ro && !x.lost && (x.kind === 'root' || x.raw !== undefined); });
  root.lines = L; root.all = all; return root;
}
// The text the map is drawn from: the editor's, while you type (read only: nothing is saved from here)
function mmMd(n) {
  if (n.docDirty) { const el = liveDoc(n); if (el) try { return NVMarkdown.htmlToMd(typedLinks(el, n.html)); } catch (e) { /* the last saved text */ } }
  return n.md;
}
const mmNote = () => { if (MM_POP) return MM.popNote; const n = note(); return n && D.notes.includes(n) ? n : null; };
const mmFind = (root, key) => root.all.find(x => x.key === key) || null;

/* ---- Where each node goes: a tidy tree (left to right), the note in the centre (sections either side), or radial ---- */
function mmFolded(n) { return MM.fold[n.id] || (MM.fold[n.id] = new Set()); }
function mmLayout(root, how, fold) {
  const pos = {}, vis = nd => fold.has(nd.key) ? [] : nd.kids, leaves = nd => vis(nd).length ? vis(nd).reduce((t, c) => t + leaves(c), 0) : 1;
  if (how === 'radial') {
    const total = leaves(root); let at = 0;
    const walk = (nd, d) => { if (!vis(nd).length) { const a = (at + .5) / total * Math.PI * 2 - Math.PI / 2; at++; pos[nd.key] = { a, d }; return a; }
      const as = vis(nd).map(c => walk(c, d + 1)), a = (Math.min(...as) + Math.max(...as)) / 2; pos[nd.key] = { a, d }; return a; };
    walk(root, 0);
    const ring = Math.max(210, total * (MM_NH + MM_GY) / (Math.PI * 2) * 1.1);   // room on the outer ring for every leaf
    Object.values(pos).forEach(p => { const r = p.d ? Math.min(ring, 210) + (p.d - 1) * 210 + (p.d > 1 ? Math.max(0, ring - 210) : 0) : 0; p.x = Math.cos(p.a) * r; p.y = Math.sin(p.a) * r * .78; });
    pos.root.x = 0; pos.root.y = 0; return pos;
  }
  const tidy = (nd, d, y0, dir) => { const h = leaves(nd) * (MM_NH + MM_GY); pos[nd.key] = { x: dir * d * (MM_NW + MM_GX), y: y0 + h / 2, dir }; let y = y0; vis(nd).forEach(c => { tidy(c, d + 1, y, dir); y += leaves(c) * (MM_NH + MM_GY); }); };
  if (how === 'centre') {
    const ks = vis(root), tot = ks.reduce((t, c) => t + leaves(c), 0); let acc = 0, cut = ks.length;
    for (let i = 0; i < ks.length; i++) { acc += leaves(ks[i]); if (acc >= tot / 2) { cut = i + 1; break; } }   // as many leaves on each side as can be
    [ks.slice(0, cut), ks.slice(cut)].forEach((side, si) => { const dir = si ? -1 : 1, h = side.reduce((t, c) => t + leaves(c), 0) * (MM_NH + MM_GY); let y = -h / 2; side.forEach(c => { tidy(c, 1, y, dir); y += leaves(c) * (MM_NH + MM_GY); }); });
    pos.root = { x: 0, y: 0, dir: 1 }; return pos;
  }
  tidy(root, 0, 0, 1); return pos;
}
// A big note opens with its deeper levels folded, so the map stays readable (and quick)
function mmAutoFold(n, root) {
  if (MM.auto[n.id]) return; MM.auto[n.id] = true; const f = mmFolded(n), count = () => { let c = 0; (function w(x) { c++; if (!f.has(x.key)) x.kids.forEach(w); })(root); return c; };
  for (let d = Math.max(...root.all.map(x => x.depth)) - 1; d >= 1 && count() > MM_MAX; d--) root.all.forEach(x => { if (x.depth === d && x.kids.length) f.add(x.key); });
}

/* ---- Drawing it ---- */
function mmWorld(n) {
  const root = mmTree(mmMd(n), n.title, n), fold = mmFolded(n); mmAutoFold(n, root);
  if (MM.pend) { const p = mmFind(root, MM.pend.parent); if (p) p.kids.splice(Math.min(MM.pend.index, p.kids.length), 0, { key: 'pend', kind: MM.pend.kind, text: '', kids: [], parent: p, depth: p.depth + 1, edit: true, pend: true }); else MM.pend = null; }
  const pos = mmLayout(root, MM.layout, fold), shown = [];
  (function walk(nd, par) { if (!pos[nd.key]) return; if (shown.length >= MM_MAX * 2) return; shown.push([nd, par]); if (!fold.has(nd.key)) nd.kids.forEach(c => walk(c, nd)); })(root, null);
  MM.shown = shown.length; MM.total = root.all.length;
  const xs = shown.map(([nd]) => pos[nd.key].x), ys = shown.map(([nd]) => pos[nd.key].y), pad = 24;
  const minX = Math.min(...xs) - MM_NW / 2 - pad, minY = Math.min(...ys) - MM_NH / 2 - pad, W = Math.max(...xs) - Math.min(...xs) + MM_NW + pad * 2, H = Math.max(...ys) - Math.min(...ys) + MM_NH + pad * 2;
  const P = k => ({ x: pos[k].x - minX, y: pos[k].y - minY, dir: pos[k].dir });
  const edges = shown.filter(([, par]) => par).map(([nd, par]) => { const a = P(par.key), b = P(nd.key);
    if (MM.layout === 'radial') return `<path d="M${a.x.toFixed(1)} ${a.y.toFixed(1)} Q${((a.x + b.x) / 2).toFixed(1)} ${a.y.toFixed(1)} ${b.x.toFixed(1)} ${b.y.toFixed(1)}"/>`;
    const dir = b.x >= a.x ? 1 : -1, x1 = a.x + dir * MM_NW / 2, x2 = b.x - dir * MM_NW / 2, mx = (x1 + x2) / 2; return `<path d="M${x1} ${a.y} C${mx} ${a.y} ${mx} ${b.y} ${x2} ${b.y}"/>`; }).join('');
  const tab = MM.sel && shown.some(([nd]) => nd.key === MM.sel) ? MM.sel : 'root';
  const nodes = shown.map(([nd]) => { const p = P(nd.key), sel = MM.sel === nd.key, ed = MM.edit === nd.key, f = fold.has(nd.key), kids = nd.kids.length;
    const mark = nd.kind === 'task' || nd.kind === 'ltask' ? `<span class="mm-box${nd.done ? ' is-done' : ''}" aria-hidden="true">${nd.done ? ic('check') : ''}</span>` : '';
    const inner = ed ? `<input class="mm-in" data-mm-in="${esc(nd.key)}" value="${esc(nd.pend ? '' : nd.kind === 'root' ? nd.text : nd.raw ?? nd.text)}" aria-label="${nd.pend ? 'The new node' : 'Edit this node'}" placeholder="${nd.pend ? 'Type, then Enter' : ''}" spellcheck="true" autocomplete="off">`
      : `${mark}<span class="mm-nt">${esc(nd.text)}</span>`;
    const side = MM.layout === 'radial' ? 1 : p.dir || 1;
    const tog = kids && !ed ? `<button class="mm-tog${f ? ' is-folded' : ''}" data-act="mm-fold" data-v="${esc(nd.key)}" tabindex="-1" aria-label="${f ? `Unfold ${kids}` : 'Fold'}" title="${f ? `Unfold (${kids} under it)` : 'Fold it here and in the note'}" style="${side > 0 ? 'right' : 'left'}:-11px">${f ? '+' + kids : '−'}</button>` : '';
    return `<div class="mm-node is-${nd.kind}${sel ? ' is-sel' : ''}${ed ? ' is-edit' : ''}${nd.done ? ' is-done' : ''}" style="left:${(p.x - MM_NW / 2).toFixed(1)}px;top:${(p.y - MM_NH / 2).toFixed(1)}px" data-mm="${esc(nd.key)}" role="treeitem" aria-level="${nd.depth + 1}" aria-selected="${sel}"${kids ? ` aria-expanded="${!f}"` : ''} tabindex="${nd.key === tab ? 0 : -1}" aria-label="${esc(nd.text || 'New node')}">${inner}${tog}</div>`; }).join('');
  return `<div class="mm-zoom"><div class="mm-world" style="width:${W.toFixed(0)}px;height:${H.toFixed(0)}px" role="tree" aria-label="Nodes"><svg class="mm-edges" width="${W.toFixed(0)}" height="${H.toFixed(0)}" aria-hidden="true">${edges}</svg>${nodes}</div></div>`;
}
const mmHint = () => MM.edit ? 'Enter: write it, and a node beside it · Tab: a node under it · Esc: done. The note changes as you go.'
  : MM.shown < MM.total ? `Showing ${MM.shown} of ${MM.total} nodes · unfold one with its + to see more`
    : 'Click a node to find its line · double-click to edit · Space folds · Ctrl+wheel zooms · Ctrl+drag (or drag the background) moves it';
function mmHtml() {
  const n = mmNote(); if (!n) return ''; let world = '';
  try { world = mmWorld(n); } catch (e) { world = `<p class="list-item-sub mm-err">${esc(plainErr(e, 'The map couldn’t be drawn.'))}</p>`; }
  const seg = `<div class="seg mm-seg" role="group" aria-label="Layout">${MM_LAYOUTS.map(([v, l, d]) => `<button class="seg-opt" data-act="mm-layout" data-v="${v}" aria-pressed="${MM.layout === v}" title="${d}">${l}</button>`).join('')}</div>`;
  return `<aside class="mm-map" data-mm-map="${esc(n.id)}" aria-label="Mind map of ${esc(n.title || 'Untitled note')}"><div class="mm-head"${MM_POP ? ' data-drag-widget="mm"' : ''}>${ic('mindmap')}<span class="set-label truncate">${MM_POP ? esc(n.title || 'Untitled note') : 'Mind map'}</span>${seg}<span class="mm-grow"></span><span class="mm-tools">${mmZoomCtl()}${mmSaveBtn()}${mmWinBtns()}</span></div>${mmSaveMenu()}
    <div class="mm-canvas" data-mm-canvas tabindex="0" aria-label="The map: Ctrl+drag or the arrow keys move around, Ctrl+= and Ctrl+− zoom">${world}</div><div class="mm-hint" aria-live="polite">${mmHint()}</div></aside>`;
}
const mmHere = () => UI.zen !== 'on' && !!mmNote() && (UI.view === 'notes' || (typeof paneLayout === 'function' && paneLayout() && pnNoteShown()));
const mmOn = () => MM_POP ? !!MM.popNote : MM.open && !mmOut() && mmHere();   // drawn beside the note (not while it has its own window)
const mmActive = () => !MM_POP && (MM.open || mmOut()) && mmHere();   // the note shows the map's picks and folds
{ const ri0 = renderInspector; renderInspector = function () { const h = ri0.apply(this, arguments); return mmOn() ? mmHtml() + h : h; }; }   // eslint-disable-line no-global-assign
// More ⋮ → Open as a mind map (after Split right)
{ const rh0 = renderHeader;
  renderHeader = function () {   // eslint-disable-line no-global-assign
    const h = rh0.apply(this, arguments); if (!h.includes('data-act="split-right"')) return h;
    return h.replace(/(data-act="split-right">[\s\S]*?<\/button>)/, `$1<button class="menu-item" role="menuitem" data-act="mm-open">${ic('mindmap')}${mmOut() ? 'Show the mind map window' : MM.open ? 'Close the mind map' : 'Open as a mind map'}</button>`);
  };
}
// After each draw: the map fits its pane; the note keeps 440px; the picked node's line lights up; folded nodes fold in the note
function mmFit() {
  const map = app.querySelector('[data-mm-map]'), c = map?.querySelector('[data-mm-canvas]'), w = c?.querySelector('.mm-world');
  if (map) {
    const main = app.querySelector('.app-body > .main'), insp = app.querySelector('.app-body > #right-sidebar');
    if (main && main.offsetWidth < 440 && insp && insp.offsetWidth) insp.style.display = 'none';   // the right sidebar steps aside first (R50's rule)
    if (main && main.offsetWidth < 440) map.style.flexBasis = Math.max(320, map.offsetWidth - (440 - main.offsetWidth)) + 'px';
  }
  if (w) { const n = mmNote(), v = mmView(n), s = v.z ?? mmAutoZ(c, w); mmSize(w, s);   // QC 107: the zoom you chose, else the map as wide as there's room (55-100%)
    const at = map.dataset.mmMap + '|' + MM.layout, r = w.querySelector('[data-mm="root"]'), zm = w.parentElement;   // a new note or layout: the note's own node in view, centred where there's room
    if (v.at !== at && r) { v.at = at; c.scrollLeft = Math.max(0, zm.offsetLeft + (r.offsetLeft + MM_NW / 2) * s - c.clientWidth / 2); c.scrollTop = Math.max(0, zm.offsetTop + (r.offsetTop + MM_NH / 2) * s - c.clientHeight / 2); }
    else if (v.sl != null) { c.scrollLeft = v.sl; c.scrollTop = v.st; }   // a redraw keeps where you were (each note its own)
    mmShow(c, w); }
  mmPaintNote();
  mmPaintNote();
  const inp = app.querySelector('[data-mm-in]'); if (inp && document.activeElement !== inp) { inp.focus({ preventScroll: true }); const v = inp.value.length; inp.setSelectionRange(v, v); }
}
function mmShow(c, w) {   // the picked node (or the one being edited) in view
  const el = w.querySelector('.mm-node.is-edit, .mm-node.is-sel'), s = MM.scale || 1, zm = w.parentElement; if (!el) return;
  const x = zm.offsetLeft + el.offsetLeft * s, y = zm.offsetTop + el.offsetTop * s, ew = MM_NW * s, eh = MM_NH * s;
  if (x < c.scrollLeft) c.scrollLeft = x - 16; else if (x + ew > c.scrollLeft + c.clientWidth) c.scrollLeft = x + ew - c.clientWidth + 24;
  if (y < c.scrollTop) c.scrollTop = y - 16; else if (y + eh > c.scrollTop + c.clientHeight) c.scrollTop = y + eh - c.clientHeight + 16;
}
document.addEventListener('scroll', e => { if (!e.target.matches?.('[data-mm-canvas]') || !e.target.isConnected) return; const id = e.target.closest('[data-mm-map]')?.dataset.mmMap; if (id) Object.assign(mmView({ id }), { sl: e.target.scrollLeft, st: e.target.scrollTop }); }, true);   // each note's place (the map's own note: a scroll comes a frame late)
{ const ar0 = afterRender; afterRender = function () { ar0.apply(this, arguments); mmFit(); }; }   // eslint-disable-line no-global-assign

/* ---- The note's side: the picked node's line lights up; folded nodes fold their lines (CSS only, so the .md never changes) ---- */
const mmOwn = el => (el.tagName === 'LI' ? [...el.childNodes].filter(c => !/^(UL|OL)$/.test(c.nodeName)).map(c => c.textContent).join('') : el.textContent).replace(/\s+/g, ' ').trim();
const MM_SEL = { head: 'h1, h2, h3, h4, h5, h6', item: 'li', task: 'li', para: 'p', quote: 'blockquote', code: 'pre', table: 'table', embed: 'img, figure, .embed, .att, audio, video, iframe, [data-embed]', tasks: '.tasks-block, [data-tasks], .note-tasks' };
function mmElFor(doc, root, nd) {   // the element in the drawn note for a node: same kind, same words, the same one of them
  const sel = MM_SEL[nd.kind]; if (!doc || !sel) return null;
  const want = nd.text.replace(/\s+/g, ' ').trim(), same = root.all.filter(x => x.kind === nd.kind && x.text === nd.text), k = same.indexOf(nd);
  const els = [...doc.querySelectorAll(sel)].filter(e => nd.kind !== 'head' || e.tagName === 'H' + nd.level);
  const hit = els.filter(e => mmOwn(e) === want); if (hit[k]) return hit[k];
  const pre = want.slice(0, 24).toLowerCase(), near = els.filter(e => mmOwn(e).toLowerCase().startsWith(pre)); if (near[k]) return near[k];
  const order = root.all.filter(x => x.kind === nd.kind && (nd.kind !== 'head' || x.level === nd.level)).indexOf(nd); return els[order] || null;
}
const mmPath = (el, doc) => { const p = []; for (let x = el; x && x !== doc; x = x.parentElement) p.unshift(`:nth-child(${[...x.parentElement.children].indexOf(x) + 1})`); return p.join(' > '); };
function mmPaintNote() {
  app.querySelectorAll('.doc .mm-hl').forEach(e => e.classList.remove('mm-hl'));
  let css = document.getElementById('mm-fold-css'); const n = mmNote();
  if (!mmActive() || !n) { if (css) css.textContent = ''; return; }
  const docs = [...app.querySelectorAll(`.doc[data-note="${CSS.escape(n.id)}"]`)], doc = docs.find(d => d.isContentEditable) || docs[0]; if (!doc) { if (css) css.textContent = ''; return; }
  const root = mmTree(mmMd(n), n.title, n), fold = mmFolded(n), rules = [], q = `.doc[data-note="${CSS.escape(n.id)}"] > `;
  root.all.filter(x => fold.has(x.key) && x.kids.length).forEach(nd => {
    const el = mmElFor(doc, root, nd); if (!el) return;
    if (nd.kind === 'head') { const lv = nd.level, path = mmPath(el, doc); if (path.includes('>')) return;   // a heading inside something else: the map folds, the note doesn't
      rules.push(`${q}${path}::after { content: "  +${nd.kids.length}"; }`);
      for (let s = el.nextElementSibling; s; s = s.nextElementSibling) { const m = /^H([1-6])$/.exec(s.tagName); if (m && +m[1] <= lv) break; rules.push(`${q}${mmPath(s, doc)} { display: none !important; }`); } }
    else if (nd.kind === 'item' || nd.kind === 'task') rules.push(`${q}${mmPath(el, doc)} > :is(ul, ol, p:not(:first-child), pre, blockquote) { display: none !important; }`, `${q}${mmPath(el, doc)}::after { content: "  +${nd.kids.length}"; }`);
  });
  if (!css) { css = document.createElement('style'); css.id = 'mm-fold-css'; document.head.appendChild(css); }
  css.textContent = rules.length ? rules.join('\n') + `\n${q}*::after { color: var(--accent-text); font-size: var(--fs-xs); font-weight: 700; }` : '';
  const nd = MM.sel && mmFind(root, MM.sel); if (nd && nd.kind !== 'root') mmElFor(doc, root, nd)?.classList.add('mm-hl');
}
function mmJump(n, nd, root) {   // the node's line in the note: scrolled to and lit (the .md mode: its lines picked in the text)
  const ta = app.querySelector('#raw-markdown-textarea');
  if (ta && S.mode === 'raw') {   // the .md view shows the front matter above the text the map is drawn from
    let fm = 0; try { const b = NVMarkdown.splitFrontMatter(ta.value).body; if (b !== ta.value && ta.value.endsWith(b)) fm = (ta.value.slice(0, ta.value.length - b.length).match(/\n/g) || []).length; } catch (e) { /* none */ }
    const L = ta.value.split('\n'), ln = Math.max(0, nd.line) + fm, off = L.slice(0, ln).reduce((a, l) => a + l.length + 1, 0);
    ta.setSelectionRange(off, off + (L[ln] || '').length); const lh = parseFloat(getComputedStyle(ta).lineHeight) || 24; ta.scrollTop = Math.max(0, ln * lh - ta.clientHeight / 3); return true; }
  const doc = [...app.querySelectorAll(`.doc[data-note="${CSS.escape(n.id)}"]`)].find(d => d.isContentEditable) || liveDoc(n), el = mmElFor(doc, root, nd); if (!el) return false;
  el.scrollIntoView({ block: 'center', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches || CHECK ? 'auto' : 'smooth' }); return true;
}

/* ---- Map → note: a node's words into its line; a new node beside or under it ---- */
function mmWrite(n, change) {   // the editor's text first, then the change; the note is drawn again from the .md and saved as usual
  syncDoc(n); const L = n.md.split('\n'), r = change(L, mmTree(n.md, n.title, n)); if (r === false) return false;
  n.md = L.join('\n'); n.html = null; if (typeof EDH !== 'undefined') EDH.delete(n.id); mmEdited(n); return r;
}
function mmSetText(n, key, text) {
  text = String(text).replace(/\s*\n\s*/g, ' ').trim();
  if (key === 'root') { if (!text || text === n.title) return 'same'; n.title = text; mmEdited(n); return 'root'; }
  return mmWrite(n, (L, root) => {
    const nd = mmFind(root, key); if (!nd || !nd.edit) return false; if (text === (nd.raw ?? '')) return false;
    if (!text && (nd.kind === 'head' || nd.kind === 'para')) return false;   // an empty node keeps its line: delete words in the note itself
    if (nd.kind === 'head') L[nd.line] = nd.pre + text;
    else if (nd.kind === 'item' || nd.kind === 'task') L.splice(nd.line, Math.max(nd.line, nd.tend ?? nd.line) - nd.line + 1, nd.pre + text);   // its words (one line now); its children stay
    else if (nd.kind === 'quote') L[nd.line] = (L[nd.line].match(/^\s*>\s?/) || ['> '])[0] + text;
    else L.splice(nd.line, nd.end - nd.line + 1, (nd.pad || '') + text);
    return mmKeyAfter(L, n, nd.kind, text);
  });
}
const mmKeyAfter = (L, n, kind, text) => { const r = mmTree(L.join('\n'), n.title, n), k = kind + ':' + mmPlain(text).toLowerCase().slice(0, 80); return (r.all.find(x => x.key.startsWith(k + '#')) || {}).key || null; };
// Where a node beside (Enter) or under (Tab) goes, in the .md
function mmSpot(root, nd, how) {
  const L = root.lines, lastBody = () => { let i = L.length - 1; while (i >= 0 && !L[i].trim()) i--; return i; }, idx = x => x.parent ? x.parent.kids.indexOf(x) : 0;
  if (how === 'beside') {
    if (nd.kind === 'root') return null;
    if (nd.kind === 'head') return { parent: nd.parent.key, index: idx(nd) + 1, kind: 'head', at: nd.end + 1, pre: nd.pre, gap: true };
    if (nd.kind === 'item' || nd.kind === 'task') { const num = /^\d+/.exec(nd.marker || ''), pre = num ? nd.pre.replace(/\d+/, String(+num[0] + 1)) : nd.pre.replace(/\[[xX]\]/, '[ ]');
      return { parent: nd.parent.key, index: idx(nd) + 1, kind: nd.kind, at: nd.end + 1, pre, gap: false }; }
    return { parent: nd.parent.key, index: idx(nd) + 1, kind: 'para', at: nd.end + 1, pre: nd.pad || '', gap: true };
  }
  if (nd.kind === 'root') { const lv = Math.min(...root.kids.filter(x => x.kind === 'head').map(x => x.level), 2) || 2; return { parent: 'root', index: root.kids.length, kind: 'head', at: lastBody() + 1, pre: '#'.repeat(lv) + ' ', gap: true }; }
  if (nd.kind === 'head') { const sub = nd.kids.find(x => x.kind === 'head'); let at = sub ? sub.line - 1 : nd.end; while (at > nd.line && !L[at].trim()) at--;
    const lastKid = nd.kids.filter(x => x.kind !== 'head').at(-1), inList = lastKid && (lastKid.kind === 'item' || lastKid.kind === 'task') && lastKid.ind === 0 && lastKid.end === at;
    return { parent: nd.key, index: sub ? nd.kids.indexOf(sub) : nd.kids.length, kind: 'item', at: at + 1, pre: inList ? lastKid.pre.replace(/\[[xX]\]/, '[ ]').replace(/\d+/, d => String(+d + 1)) : '- ', gap: !inList }; }
  if (nd.kind === 'item' || nd.kind === 'task') return { parent: nd.key, index: nd.kids.length, kind: 'item', at: nd.end + 1, pre: ' '.repeat(nd.cind || 2) + '- ', gap: false };
  return null;
}
function mmAdd(n, key, how) {   // a new node: drawn at once, written to the .md when it has words
  const root = mmTree(mmMd(n), n.title, n), nd = mmFind(root, key); if (!nd) return false;
  const sp = mmSpot(root, nd, how);
  if (!sp) { status(how === 'beside' ? 'The note itself has nothing beside it · Tab adds a node under it' : 'Only the note, a heading or a list item can have nodes under it · Enter adds one beside it'); return false; }
  mmFolded(n).delete(nd.key); MM.pend = sp; MM.edit = 'pend'; MM.sel = 'pend'; return true;
}
function mmInsert(n, text) {   // the new node's line goes into the .md
  const sp = MM.pend; MM.pend = null; text = String(text).replace(/\s*\n\s*/g, ' ').trim(); if (!sp || !text) return null;
  return mmWrite(n, L => { const at = Math.min(sp.at, L.length), lines = [sp.pre + text];
    if (sp.gap) { if (at > 0 && (L[at - 1] || '').trim()) lines.unshift(''); if (at < L.length && (L[at] || '').trim()) lines.push(''); }
    L.splice(at, 0, ...lines); return mmKeyAfter(L, n, sp.kind === 'item' && /\[ \]/.test(sp.pre) ? 'task' : sp.kind, text); });
}
// Write what's being edited; then (Enter) a node beside, (Tab) one under, or stop
function mmCommit(then) {
  const n = mmNote(), inp = app.querySelector('[data-mm-in]'); if (!n || !MM.edit) return;
  const key = MM.edit, val = inp ? inp.value : ''; let k = key;
  if (key === 'pend') { k = mmInsert(n, val); if (!k) { MM.edit = null; MM.sel = null; status('Nothing added'); renderAll(); return; } status('Added to the note'); }
  else { const r = mmSetText(n, key, val); if (r === false) status('Not changed'); else if (r === 'same') status('Not changed'); else { k = r === 'root' ? 'root' : r || key; status(r === 'root' ? 'The note’s name changed' : 'Written into the note'); } }
  MM.edit = null; MM.sel = k;
  if (then && k) mmAdd(n, k, then);
  renderAll();
}

/* ---- Folding, picking, the keys ---- */
function mmFold(n, key, to) { const f = mmFolded(n), on = to ?? !f.has(key); if (on) f.add(key); else f.delete(key); if (MM_POP) mmRelay({ op: 'fold', id: n.id, key, on }); return on; }
function mmPick(key, jump = true) {
  const n = mmNote(); if (!n) return; MM.sel = key; mmRepaint(true);
  const root = mmTree(mmMd(n), n.title, n), nd = mmFind(root, key);
  if (jump && nd && nd.kind !== 'root') { if (MM_POP) { mmRelay({ op: 'pick', id: n.id, key }); status('Its line is lit in NeuroVault'); }
    else { const ok = mmJump(n, nd, root); status(ok ? 'Its line in the note is lit' : 'That one isn’t drawn in the note (unfold it there, or try the .md view)'); } }
  app.querySelector(`[data-mm="${CSS.escape(key)}"]`)?.focus({ preventScroll: true });
}
function mmStartEdit(key) {
  const n = mmNote(); if (!n) return; const nd = mmFind(mmTree(mmMd(n), n.title, n), key); if (!nd) return;
  if (!nd.edit) { status(nd.kind === 'ltask' ? 'This task lives in Tasks: edit it there' : nd.kind === 'tasks' ? 'The tasks block lists the note’s tasks: edit them in Tasks' : `A ${{ code: 'code block', table: 'table', embed: 'file', quote: 'longer quote' }[nd.kind] || 'line like this'} is edited in the note`); return; }
  MM.sel = MM.edit = key; renderAll();
}
document.addEventListener('click', e => {
  const t = e.target.closest?.('[data-act^="mm-"], [data-mm]'); if (!t || !app.contains(t)) return;
  const act = t.dataset.act, n = mmNote();
  if (!act) { if (t.classList.contains('is-edit')) return; e.preventDefault(); e.stopPropagation(); mmPick(t.dataset.mm); return; }
  e.preventDefault(); e.stopPropagation();
  if (act === 'mm-open' && mmOut()) { S.menu = false; nv('pop_show', 'mindmap'); renderAll(); return; }   // QC 107: it has its own window: brought up
  if (mmAct(act, t) || mmSaveAct(act, t)) return;   // QC 107: zoom, Save as, Pop out, and the map's window
  if (act === 'mm-open') { S.menu = false; MM.open = !MM.open; Object.assign(MM, { sel: null, edit: null, pend: null }); status(MM.open ? 'The note as a mind map, beside it: they stay in step' : 'Mind map closed'); renderAll(); if (MM.open) app.querySelector('[data-mm="root"]')?.focus({ preventScroll: true }); return; }
  if (act === 'mm-close') { MM.open = false; Object.assign(MM, { sel: null, edit: null, pend: null }); status('Mind map closed'); renderAll(); app.querySelector('.doc[contenteditable="true"]')?.focus({ preventScroll: true }); return; }
  if (act === 'mm-layout' || act === 'mm-set') { const v = t.dataset.v; if (!MM_LAYOUTS.some(x => x[0] === v)) return; MM.layout = v; if (MM_POP) mmRelay({ op: 'layout', v }); else if (!CHECK) saveSettings({ mindmap_layout: v }); status(`Mind map: ${MM_LAYOUTS.find(x => x[0] === v)[1]} · kept for next time`); if (act === 'mm-set') S.focus = { sel: `[data-act="mm-set"][data-v="${v}"]` }; renderAll(); return; }
  if (act === 'mm-fold' && n) { const on = mmFold(n, t.dataset.v); status(on ? 'Folded, here and in the note (the .md keeps every line)' : 'Unfolded'); MM.sel = t.dataset.v; mmRepaint(true); app.querySelector(`[data-mm="${CSS.escape(t.dataset.v)}"]`)?.focus({ preventScroll: true }); }
}, true);
document.addEventListener('dblclick', e => { const t = e.target.closest?.('[data-mm]'); if (!t || !app.contains(t) || t.classList.contains('is-edit') || e.target.closest('.mm-tog')) return; e.preventDefault(); e.stopPropagation(); mmStartEdit(t.dataset.mm); }, true);
document.addEventListener('keydown', e => {
  const inp = e.target.closest?.('[data-mm-in]');
  if (inp) {
    if (e.isComposing) return;
    if (e.key === 'Enter' || e.key === 'Tab' || e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); mmCommit(e.key === 'Enter' ? 'beside' : e.key === 'Tab' && !e.shiftKey ? 'under' : null); }
    else e.stopPropagation();   // the app's own keys (Ctrl+B, F6…) stay out of the box
    return;
  }
  const node = e.target.closest?.('[data-mm]'); if (!node || !app.contains(node) || e.ctrlKey || e.metaKey || e.altKey) return;
  const n = mmNote(); if (!n) return; const key = node.dataset.mm, root = mmTree(mmMd(n), n.title, n), nd = mmFind(root, key), fold = mmFolded(n);
  const order = []; (function w(x) { order.push(x); if (!fold.has(x.key)) x.kids.forEach(w); })(root);
  const go = x => { if (x) { e.preventDefault(); mmPick(x.key, false); } };
  if (e.key === 'Enter' || e.key === 'F2') { e.preventDefault(); mmStartEdit(key); }
  else if (e.key === ' ') { e.preventDefault(); if (nd?.kids.length) { mmFold(n, key); mmRepaint(true); app.querySelector(`[data-mm="${CSS.escape(key)}"]`)?.focus({ preventScroll: true }); } }
  else if (e.key === 'ArrowDown') go(order[order.findIndex(x => x.key === key) + 1]);
  else if (e.key === 'ArrowUp') go(order[order.findIndex(x => x.key === key) - 1]);
  else if (e.key === 'ArrowLeft') { if (nd?.kids.length && !fold.has(key)) { e.preventDefault(); mmFold(n, key, true); mmPick(key, false); } else go(nd?.parent); }
  else if (e.key === 'ArrowRight') { if (nd?.kids.length && fold.has(key)) { e.preventDefault(); mmFold(n, key, false); mmPick(key, false); } else go(nd?.kids[0]); }
  else if (e.key === 'Home') go(root);
  else if (e.key === 'Escape' && !MM_POP) { e.preventDefault(); e.stopPropagation(); app.querySelector('[data-act="mm-close"]')?.click(); }   // in its own window, Esc doesn't close it
}, true);
// the input box: writes when you click away from it
document.addEventListener('focusout', e => { if (e.target.closest?.('[data-mm-in]') && MM.edit && !MM.busy) setTimeout(() => { if (MM.edit && !app.querySelector('[data-mm-in]:focus')) { MM.busy = true; try { mmCommit(null); } finally { MM.busy = false; } } }, 0); }, true);

/* ---- Note → map: the map follows your typing, 0.4 s after the last key (only the map is drawn again) ---- */
function mmRepaint(now) {   // now: a pick or a fold (the map and the note's marks only, no full redraw)
  const n = mmNote(), c = app.querySelector('[data-mm-canvas]'); if (!c || !n || (MM.edit && !now)) return;
  const st = c.scrollTop, sl = c.scrollLeft; try { c.innerHTML = mmWorld(n); } catch (e) { return; }
  const h = app.querySelector('.mm-map .mm-hint'); if (h) h.textContent = mmHint();
  const w = c.querySelector('.mm-world'); if (w) mmSize(w, MM.scale || 1);
  c.scrollTop = st; c.scrollLeft = sl; if (w) mmShow(c, w); mmPaintNote();
}
document.addEventListener('input', e => {
  if (!(MM.open || mmOut()) || !e.target.closest?.('.doc, #raw-markdown-textarea')) return;
  app.querySelectorAll('.doc .mm-hl').forEach(x => x.classList.remove('mm-hl'));
  clearTimeout(MM.t); MM.t = setTimeout(mmOut() ? () => mmPush() : mmRepaint, CHECK ? 0 : 400);   // QC 107: its own window draws it from the note sent
}, true);

/* ---- Settings → Editor → Mind map layout; config.json mindmap_layout ---- */
{ const sp0 = settingsPane; settingsPane = sec => sp0(sec) + (sec === 'editor' ? `<div class="pop-sec mm-set"><div class="eyebrow">Mind map</div><div class="set-row"><div><div class="set-label" id="mm-lay">Layout</div><div class="set-desc">More ⋮ → Open as a mind map shows the note as a map beside it. ${esc(MM_LAYOUTS.find(x => x[0] === MM.layout)[2])}.</div></div>
  <div class="seg" role="group" aria-labelledby="mm-lay">${MM_LAYOUTS.map(([v, l]) => `<button class="seg-opt" data-act="mm-set" data-v="${v}" aria-pressed="${MM.layout === v}">${l}</button>`).join('')}</div></div></div>` : ''); }   // eslint-disable-line no-global-assign
{ const rc0 = readerFromConfig; readerFromConfig = function (c) { rc0.apply(this, arguments); if (!CHECK && c && MM_LAYOUTS.some(x => x[0] === c.mindmap_layout)) MM.layout = c.mindmap_layout; }; }   // eslint-disable-line no-global-assign

/* ---- QC 107 · zoom: Ctrl+wheel or a pinch (around the pointer), − % + Fit in the head, Ctrl+= / − / 0 with the map focused.
        25-400%, in steps like a browser's. Each note keeps its zoom and place for the session (MM.views); until you zoom, the map
        is as wide as there's room (55-100%), as before ---- */
Object.assign(ICON, {
  mmzin: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3M11 8v6M8 11h6"/>',   // Lucide zoom-in
  mmzout: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3M8 11h6"/>',          // Lucide zoom-out
  mmfit: '<path d="M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2"/>' });   // Lucide scan
const MM_ZMIN = .25, MM_ZMAX = 4, MM_STEPS = [.25, .33, .5, .67, .75, .8, .9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4];
function mmView(n) { return MM.views[n.id] || (MM.views[n.id] = { z: null, sl: null, st: null, at: null }); }
function mmKeep(c) { const id = c?.closest('[data-mm-map]')?.dataset.mmMap; if (id) Object.assign(mmView({ id }), { sl: c.scrollLeft, st: c.scrollTop }); }   // where you moved it, at once (its scroll event comes a frame later)
const mmAutoZ = (c, w) => Math.max(.55, Math.min(1, (c.clientWidth - 8) / w.offsetWidth, (c.clientHeight - 8) / w.offsetHeight));
const mmAppZ = () => app.getBoundingClientRect().width / app.offsetWidth || 1;
function mmSize(w, z) {   // the world drawn at z; its box (.mm-zoom) is the zoomed size, so the canvas scrolls on it and centres a small one
  const zm = w.parentElement; w.style.transform = `scale(${z.toFixed(4)})`;
  if (zm?.classList.contains('mm-zoom')) { zm.style.width = Math.ceil(w.offsetWidth * z) + 'px'; zm.style.height = Math.ceil(w.offsetHeight * z) + 'px'; }
  MM.scale = z; mmZoomLabel();
}
const mmPct = () => Math.round((MM.scale || 1) * 100);
function mmZoomLabel() { app.querySelectorAll('.mm-zpct').forEach(b => { const p = mmPct(); b.textContent = p + '%'; b.setAttribute('aria-label', `Zoom ${p}%: back to 100%`); b.title = `Zoom ${p}% · click for 100% (Ctrl+0)`; }); }
const mmZBtn = (act, icon, label, tip) => `<button class="icon-btn icon-btn--sm" data-act="${act}" aria-label="${label}" title="${tip}">${ic(icon)}</button>`;
const mmZoomCtl = () => `<div class="mm-zoomctl" role="group" aria-label="Zoom">${mmZBtn('mm-zout', 'mmzout', 'Zoom out', 'Zoom out (Ctrl+−)')}<button class="mm-zpct" data-act="mm-z100" aria-label="Zoom ${mmPct()}%: back to 100%" title="Zoom ${mmPct()}% · click for 100% (Ctrl+0)">${mmPct()}%</button>${mmZBtn('mm-zin', 'mmzin', 'Zoom in', 'Zoom in (Ctrl+=)')}${mmZBtn('mm-zfit', 'mmfit', 'Fit the whole map', 'Fit the whole map in view')}</div>`;
// Pop out (NeuroVault's window); in the map's own window: Keep on top and close (it goes back beside the note)
const mmWinBtns = () => MM_POP
  ? `<button class="icon-btn icon-btn--sm" data-act="pop-top" data-v="mindmap" aria-pressed="${popOnTop('mindmap')}" aria-label="Keep on top of other apps" title="${popOnTop('mindmap') ? 'On top of other apps · click to let other apps cover it' : 'Other apps can cover it · click to keep it on top'}">${ic('pin')}</button><button class="icon-btn icon-btn--sm" data-act="mm-close" aria-label="Close this window: the map goes back beside the note" title="Close: the map goes back beside the note">${ic('x')}</button>`
  : `<button class="icon-btn icon-btn--sm" data-act="mm-pop" aria-label="Pop out" title="Pop out: the map in its own window, beside or on top of anything">${ic('popout')}</button><button class="icon-btn icon-btn--sm" data-act="mm-close" aria-label="Close the mind map" title="Close the mind map">${ic('x')}</button>`;
function mmZoomTo(c, z1, px, py) {   // px, py: the point that stays put (in the canvas, CSS pixels); the middle without them
  const w = c?.querySelector('.mm-world'), zm = w?.parentElement, n = mmNote(); if (!w || !zm || !n) return;
  if (px == null) { px = c.clientWidth / 2; py = c.clientHeight / 2; }
  z1 = Math.min(MM_ZMAX, Math.max(MM_ZMIN, z1)); const z0 = MM.scale || 1, v = mmView(n);
  const u = (c.scrollLeft + px - zm.offsetLeft) / z0, y = (c.scrollTop + py - zm.offsetTop) / z0;
  mmSize(w, z1); v.z = z1;
  c.scrollLeft = u * z1 + zm.offsetLeft - px; c.scrollTop = y * z1 + zm.offsetTop - py; v.sl = c.scrollLeft; v.st = c.scrollTop;
}
function mmStep(c, d) { const z0 = MM.scale || 1; mmZoomTo(c, d > 0 ? MM_STEPS.find(s => s > z0 + .005) ?? MM_ZMAX : [...MM_STEPS].reverse().find(s => s < z0 - .005) ?? MM_ZMIN); }
function mmFitAll(c) {   // the whole map in view, centred (never bigger than 100%)
  const w = c?.querySelector('.mm-world'), n = mmNote(); if (!w || !n) return;
  const z = Math.min(1, Math.max(MM_ZMIN, Math.min((c.clientWidth - 16) / w.offsetWidth, (c.clientHeight - 16) / w.offsetHeight))), v = mmView(n);
  mmSize(w, z); v.z = z; c.scrollLeft = (c.scrollWidth - c.clientWidth) / 2; c.scrollTop = (c.scrollHeight - c.clientHeight) / 2; v.sl = c.scrollLeft; v.st = c.scrollTop;
}
function mmAct(act, t) {
  const c = t.closest('.mm-map')?.querySelector('[data-mm-canvas]');
  if (act === 'mm-zin' || act === 'mm-zout') { mmStep(c, act === 'mm-zin' ? 1 : -1); return true; }
  if (act === 'mm-z100') { mmZoomTo(c, 1); return true; }
  if (act === 'mm-zfit') { mmFitAll(c); return true; }
  if (act === 'mm-pop') { mmPopOut(); return true; }
  if (act === 'mm-close' && MM_POP) { nv('pop_in', 'mindmap'); return true; }   // its own window closes; the map goes back beside the note
  return false;
}
// Ctrl+wheel and a touchpad pinch (Chromium sends it as Ctrl+wheel) zoom around the pointer; Shift+wheel goes sideways; the wheel scrolls
document.addEventListener('wheel', e => {
  const c = e.target.closest?.('[data-mm-canvas]'); if (!c || !app.contains(c)) return;
  if (e.ctrlKey || e.metaKey) { e.preventDefault(); const r = c.getBoundingClientRect(), az = mmAppZ(), k = Math.exp(-e.deltaY * (e.deltaMode === 1 ? .05 : .0025));
    mmZoomTo(c, (MM.scale || 1) * k, (e.clientX - r.left) / az - c.clientLeft, (e.clientY - r.top) / az - c.clientTop); return; }
  if (e.shiftKey && !e.deltaX) { e.preventDefault(); c.scrollLeft += e.deltaY * (e.deltaMode === 1 ? 16 : 1); mmKeep(c); }
}, { passive: false, capture: true });

/* ---- QC 107 · pan (feedback: "I prefer cntrl + left click to pan", "or drag"): Ctrl + left-drag from anywhere, nodes included (a Ctrl+click
        that doesn't move still picks), or a plain drag on the empty background. Extras: the middle button, Space + drag (with no node
        focused), the wheel and Shift+wheel, and the arrow keys with the map itself focused. Ctrl held over the map shows the grab hand ---- */
const mmGrab = on => app.querySelectorAll('[data-mm-canvas]').forEach(c => c.classList.toggle('is-grab', !!on));
document.addEventListener('pointerdown', e => {
  MM.noClick = false;
  const c = e.target.closest?.('[data-mm-canvas]'); if (!c || !app.contains(c) || MM.edit) return;
  const bg = !e.target.closest('.mm-node, button, input'), ctrl = e.button === 0 && (e.ctrlKey || e.metaKey) && !e.target.closest('button, input');
  if (!(e.button === 1 || (e.button === 0 && (bg || MM.space || ctrl)))) return;
  const wait = ctrl && !bg && !MM.space;   // over a node: a pan only once it moves, so a still Ctrl+click keeps its meaning
  MM.pan = { c, x: e.clientX, y: e.clientY, sl: c.scrollLeft, st: c.scrollTop, moved: false, wait };
  if (!wait) { e.preventDefault(); c.classList.add('is-panning'); }
  try { c.setPointerCapture(e.pointerId); } catch (x) { /* a synthetic pointer */ }
  if (bg && e.button === 0) c.focus({ preventScroll: true });   // the map has the keys now (the arrows move it)
}, true);
document.addEventListener('mousedown', e => { if (e.button === 1 && e.target.closest?.('[data-mm-canvas]')) e.preventDefault(); }, true);   // no autoscroll circle
document.addEventListener('pointermove', e => {
  MM.over = !!e.target.closest?.('[data-mm-canvas]'); if (MM.over && !MM.pan) mmGrab(e.ctrlKey || e.metaKey || MM.space);
  const p = MM.pan; if (!p) return; const az = mmAppZ();
  if (p.wait) { if (Math.hypot(e.clientX - p.x, e.clientY - p.y) < 5 * az) return; p.wait = false; p.c.classList.add('is-panning'); }
  p.c.scrollLeft = p.sl - (e.clientX - p.x) / az; p.c.scrollTop = p.st - (e.clientY - p.y) / az; p.moved = true; mmKeep(p.c);
}, true);
const mmPanEnd = () => { const p = MM.pan; if (!p) return; p.c.classList.remove('is-panning'); MM.noClick = p.moved; MM.pan = null; if (p.moved) setTimeout(() => { MM.noClick = false; }, 0); };   // only the drag's own click
document.addEventListener('pointerup', mmPanEnd, true);
document.addEventListener('pointercancel', mmPanEnd, true);
window.addEventListener('click', e => { if (MM.noClick) { MM.noClick = false; e.preventDefault(); e.stopPropagation(); } }, true);   // a drag that panned is no click (no pick)
document.addEventListener('keyup', e => {
  if (e.key === ' ' && MM.space) MM.space = false;
  if (e.key === ' ' || e.key === 'Control' || e.key === 'Meta') mmGrab(MM.space || (e.key !== 'Control' && e.ctrlKey));
}, true);
document.addEventListener('keydown', e => {
  if ((e.key === 'Control' || e.key === 'Meta') && MM.over) { mmGrab(true); return; }
  const map = e.target.closest?.('.mm-map');
  // Space held with the pointer over the map (and no node or box focused): drag pans
  if (e.key === ' ' && MM.over && !e.ctrlKey && !e.altKey && !e.target.closest?.('input, textarea, select, button, [contenteditable="true"], [data-mm]')) {
    e.preventDefault(); if (!MM.space) { MM.space = true; mmGrab(true); } return; }
  if (!map || !app.contains(map) || e.target.closest('[data-mm-in]')) return;
  const c = map.querySelector('[data-mm-canvas]'); if (!c) return;
  if ((e.ctrlKey || e.metaKey) && !e.altKey) {
    const inn = e.key === '=' || e.key === '+' || e.code === 'NumpadAdd', outk = e.key === '-' || e.key === '_' || e.code === 'NumpadSubtract', zero = e.key === '0' || e.code === 'Numpad0';
    if (!inn && !outk && !zero) return; e.preventDefault(); e.stopPropagation();   // the map's zoom, not the page's
    if (zero) mmZoomTo(c, 1); else mmStep(c, inn ? 1 : -1); return; }
  if (e.target === c && /^Arrow(Up|Down|Left|Right)$/.test(e.key) && !e.altKey && !e.metaKey) {
    e.preventDefault(); const d = e.shiftKey ? 240 : 60;
    if (e.key === 'ArrowLeft') c.scrollLeft -= d; else if (e.key === 'ArrowRight') c.scrollLeft += d; else if (e.key === 'ArrowUp') c.scrollTop -= d; else c.scrollTop += d; mmKeep(c); }
}, true);

/* ---- QC 107 · Pop out: the map in its own NeuroVault window (popout.py, #pop=mindmap). NeuroVault's window owns the note: it sends
        the map's window the note as it is (each draw, and 0.4 s after typing), and does what's done there: a pick lights the line, a
        fold folds it, words written there are written into the note (if it hasn't changed meanwhile), and saved as usual. Closing the
        window puts the map back beside the note ---- */
function mmRelay(d) { if (api()) nv('pop_mm_relay', d); }
function mmEdited(n) {   // a write from the map: saved here, or sent to NeuroVault's window from the map's own
  if (!MM_POP) { noteEdited(n); return; }
  const base = MM.popBase; MM.popBase = n.md; mmRelay({ op: 'md', id: n.id, base, md: n.md, title: n.title });
}
function mmSnap() {
  const n = note(); if (!n || !D.notes.includes(n)) return { id: null };
  const md = mmMd(n), root = mmTree(md, n.title, n); mmAutoFold(n, root);   // a big note: its deeper levels folded, the same in both windows
  return { id: n.id, title: n.title || '', md, layout: MM.layout, fold: [...mmFolded(n)], sel: MM.sel, ltasks: (typeof taskLines === 'function' ? taskLines(n) : []).map(x => ({ title: x.title, done: !!x.done })) };
}
function mmPush(force) {
  if (MM_POP || !mmOut() || !api()) return; let d; try { d = mmSnap(); } catch (e) { return; }
  const s = JSON.stringify(d); if (!force && s === MM.lastPush) return; MM.lastPush = s; nv('pop_mm_sync', d);
}
async function mmPopOut() {
  if (!api() || !D.live) { toast('Popping out works in the desktop app'); return; }
  const r = await nv('pop_out', 'mindmap'); if (failed(r)) { toast(r.message || 'Couldn’t pop it out'); return; }
  popApply(r); Object.assign(MM, { open: true, edit: null, pend: null, lastPush: null });
  status('The mind map has its own window now: it follows the note'); renderAll(); mmPush(true);
}
function mmDo(d) {   // NeuroVault's window: what was done in the map's
  if (MM_POP || !d) return;
  if (d.op === 'hello') { MM.lastPush = null; mmPush(true); return; }
  if (d.op === 'layout') { if (MM_LAYOUTS.some(x => x[0] === d.v)) { MM.layout = d.v; if (!CHECK) saveSettings({ mindmap_layout: d.v }); } mmPush(); return; }
  const n = D.notes.find(x => x.id === d.id); if (!n) { mmPush(true); return; }
  if (d.op === 'pick') { MM.sel = d.key; const root = mmTree(mmMd(n), n.title, n), nd = mmFind(root, d.key); if (n === note() && nd && nd.kind !== 'root') mmJump(n, nd, root); mmPaintNote(); mmPush(); return; }
  if (d.op === 'fold') { mmFold(n, d.key, !!d.on); mmPaintNote(); mmPush(); return; }
  if (d.op === 'md') { syncDoc(n);
    if (typeof d.md !== 'string' || n.md !== d.base) { status('The note changed while you wrote in the map: the map shows it now, so try again'); mmPush(true); return; }
    n.md = d.md; if (d.title && d.title !== n.title) n.title = String(d.title); n.html = null; if (typeof EDH !== 'undefined') EDH.delete(n.id);
    noteEdited(n); status('Written into the note from the map’s window'); renderAll(); }
}
function mmSyncIn(d) {   // the map's window: the note as NeuroVault's window has it
  if (!MM_POP || !d) return; const same = MM.popNote?.id === d.id;
  MM.popNote = d.id ? { id: d.id, title: d.title || '', md: d.md || '', ltasks: d.ltasks || [] } : null; MM.popBase = d.md || '';
  if (MM_LAYOUTS.some(x => x[0] === d.layout)) MM.layout = d.layout;
  if (d.id) { MM.fold[d.id] = new Set(d.fold || []); MM.auto[d.id] = true; }
  if (!same) Object.assign(MM, { sel: null, edit: null, pend: null }); else if (!MM.edit && d.sel !== undefined) MM.sel = d.sel;
  MM.open = true; if (MM.edit) return;   // drawn once the words being written are in
  renderAll();
}
{ const sync0 = window.nvSync;
  window.nvSync = msg => {
    if (msg?.kind === 'mindmap') { try { mmSyncIn(msg.data); } catch (e) { console.warn('mindmap sync', e); } return; }
    if (msg?.kind === 'mindmap-do') { try { mmDo(msg.data); } catch (e) { console.warn('mindmap do', e); } return; }
    const was = mmOut(); sync0(msg);
    if (msg?.kind === 'popped' && was && !mmOut()) { Object.assign(MM, { open: true, lastPush: null }); status('The mind map is back beside the note'); renderAll(); }   // its window closed: docked again
  };
}
const mmPopCard = () => `<div class="mm-popwin">${mmHtml() || `<aside class="mm-map"><div class="mm-head" data-drag-widget="mm">${ic('mindmap')}<span class="set-label">Mind map</span><span class="mm-grow"></span>${mmWinBtns()}</div><div class="pop-gone">${ic('mindmap')}<span>Open a note in NeuroVault: its map shows here.</span></div></aside>`}</div>`;
async function mmPopLoad() { MM.open = true; for (let i = 0; i < 50 && !api(); i++) await new Promise(r => setTimeout(r, 100)); mmRelay({ op: 'hello' }); }
{ const ar1 = afterRender; afterRender = function () { ar1.apply(this, arguments); mmPush(); }; }   // eslint-disable-line no-global-assign

/* ---- QC 107 · Save as… (feedback: "and also the ability to save as pdf or png or jpg"): PDF, PNG or JPG of the whole map, whatever
        the zoom or place, drawn on a canvas here (about 2× for PNG and JPG, 300 dpi for a PDF) in the theme's look, or on white for
        printing. The app's save dialog starts in the note's folder, named "<note title> – mind map.<ext>" (api.save_map_image, which
        Pillow writes); the Timeline lists it ---- */
const MM_SAVE = [['pdf', 'PDF', 'A page to print or send'], ['png', 'PNG', 'A sharp picture'], ['jpg', 'JPG', 'A smaller picture, for email and chat']];
const mmSaveBtn = () => `<button class="icon-btn icon-btn--sm" data-act="mm-save" aria-haspopup="menu" aria-expanded="${!!MM.saveMenu}" aria-label="Save as…" title="Save as PDF, PNG or JPG">${ic('download')}</button>`;
const mmSaveMenu = () => !MM.saveMenu ? '' : `<div class="menu card mm-savemenu" role="menu" aria-label="Save the map as">${MM_SAVE.map(([v, l, d]) => `<button class="menu-item" role="menuitem" data-act="mm-saveas" data-v="${v}">${ic(v === 'pdf' ? 'file' : 'image')}<span class="mm-save-l">${l}</span><span class="mm-save-d">${d}</span></button>`).join('')}
  <div class="menu-sep"></div><button class="menu-item" role="menuitemcheckbox" data-act="mm-white" aria-checked="${!!MM.white}">${MM.white ? ic('check') : '<span class="mm-save-gap" aria-hidden="true"></span>'}White background (for printing)</button></div>`;
// A theme colour as the canvas wants it (rgb), however the theme writes it
function mmColor(v) { const p = document.createElement('i'); p.style.color = `var(${v})`; app.appendChild(p); const c = getComputedStyle(p).color; p.remove(); return c; }
function mmPx(v) { const p = document.createElement('i'); p.style.fontSize = `var(${v})`; app.appendChild(p); const s = parseFloat(getComputedStyle(p).fontSize) || 12; p.remove(); return s; }
const mmAlpha = (rgb, a) => { const m = String(rgb).match(/[\d.]+/g) || [0, 0, 0]; return `rgba(${m[0]}, ${m[1]}, ${m[2]}, ${a})`; };
// The whole map (as folded now) on a canvas: nothing from the view's zoom or place goes in
function mmExport(n, scale, white) {
  const keep = { edit: MM.edit, pend: MM.pend }; MM.edit = null; MM.pend = null; let html;
  try { html = mmWorld(n); } finally { Object.assign(MM, keep); }
  const box = document.createElement('div'); box.innerHTML = html; const w = box.querySelector('.mm-world'), W = parseFloat(w.style.width), H = parseFloat(w.style.height);
  const s = Math.max(.1, Math.min(scale, 16000 / W, 16000 / H, Math.sqrt(1.2e8 / (W * H))));   // a canvas has its limits: a huge map is drawn a little smaller
  const cv = document.createElement('canvas'); cv.width = Math.round(W * s); cv.height = Math.round(H * s);
  const g = cv.getContext('2d'); g.scale(cv.width / W, cv.height / H);
  const accent = mmColor('--accent');
  const T = white ? { bg: '#ffffff', card: '#ffffff', text: '#1d1d1f', muted: '#5f6368', border: '#c3c7cd', strong: '#8a9099', accent, accentBg: mmAlpha(accent, .14), accentText: accent, on: '#ffffff' }
    : { bg: mmColor('--bg'), card: mmColor('--card'), text: mmColor('--text'), muted: mmColor('--muted'), border: mmColor('--border'), strong: mmColor('--border-strong'), accent, accentBg: mmColor('--accent-bg'), accentText: mmColor('--accent-text'), on: mmColor('--on-accent') };
  const fam = getComputedStyle(app).fontFamily, xs = mmPx('--fs-xs'), sm = mmPx('--fs-sm');
  g.fillStyle = T.bg; g.fillRect(0, 0, W, H);
  g.strokeStyle = T.strong; g.lineWidth = 1.5; w.querySelectorAll('.mm-edges path').forEach(p => g.stroke(new Path2D(p.getAttribute('d'))));
  const rr = (x, y, ww, hh, r) => { g.beginPath(); g.roundRect(x, y, ww, hh, r); };
  w.querySelectorAll('.mm-node').forEach(el => {
    const x = parseFloat(el.style.left), y = parseFloat(el.style.top), cl = el.classList, root = cl.contains('is-root'), dash = ['is-code', 'is-table', 'is-embed', 'is-tasks', 'is-quote'].some(k => cl.contains(k)), done = cl.contains('is-done');
    rr(x + .5, y + .5, MM_NW - 1, MM_NH - 1, 8); g.fillStyle = root ? T.accentBg : T.card; g.fill();
    g.setLineDash(dash ? [4, 3] : []); g.lineWidth = 1; g.strokeStyle = root ? T.accent : T.border; g.stroke(); g.setLineDash([]);
    const tick = el.querySelector('.mm-box'); let tx = x + 8;
    if (tick) { const bx = x + 8, by = y + MM_NH / 2 - 7; rr(bx, by, 14, 14, 3);
      if (tick.classList.contains('is-done')) { g.fillStyle = T.accent; g.fill(); g.strokeStyle = T.on; g.lineWidth = 1.6; g.beginPath(); g.moveTo(bx + 3.5, by + 7.5); g.lineTo(bx + 6, by + 10); g.lineTo(bx + 10.5, by + 4.5); g.stroke(); }
      else { g.strokeStyle = T.strong; g.lineWidth = 1.5; g.stroke(); }
      tx += 20; }
    const size = root || cl.contains('is-head') ? sm : xs, bold = root || cl.contains('is-head'), max = x + MM_NW - 8 - tx;
    g.font = `${bold ? 700 : 400} ${size}px ${fam}`; g.fillStyle = root ? T.accentText : dash || done ? T.muted : T.text; g.textBaseline = 'middle';
    const words = (el.querySelector('.mm-nt')?.textContent || '').split(/\s+/).filter(Boolean), lines = [''];
    for (const wd of words) { const t = lines[lines.length - 1] ? lines[lines.length - 1] + ' ' + wd : wd; if (g.measureText(t).width <= max || !lines[lines.length - 1]) lines[lines.length - 1] = t; else lines.push(wd); }
    const two = lines.slice(0, 2); if (lines.length > 2 || g.measureText(two[1] || two[0]).width > max) { let t = two[two.length - 1]; while (t && g.measureText(t + '…').width > max) t = t.slice(0, -1); two[two.length - 1] = t.trimEnd() + '…'; }
    const lh = size * 1.3, y0 = y + MM_NH / 2 - (two.length - 1) * lh / 2;
    two.forEach((t, i) => { g.fillText(t, tx, y0 + i * lh); if (done) { const tw = g.measureText(t).width; g.fillRect(tx, y0 + i * lh, tw, 1); } });
    const tog = el.querySelector('.mm-tog.is-folded');   // a folded node says how many are under it
    if (tog) { g.font = `700 11px ${fam}`; const label = tog.textContent, tw = Math.max(22, g.measureText(label).width + 8), right = tog.style.right === '-11px', px = right ? x + MM_NW + 11 - tw : x - 11, py = y + MM_NH / 2 - 9;
      rr(px, py, tw, 18, 9); g.fillStyle = T.accentBg; g.fill(); g.strokeStyle = T.accent; g.lineWidth = 1; g.stroke(); g.fillStyle = T.accentText; g.fillText(label, px + (tw - g.measureText(label).width) / 2, py + 9); }
  });
  return { canvas: cv, W, H, s };
}
async function mmSaveAs(fmt) {
  const n = mmNote(); if (!n || !MM_SAVE.some(x => x[0] === fmt)) return;
  if (!api()) { toast('Saving a file works in the desktop app'); return; }
  try { await document.fonts?.ready; } catch (e) { /* drawn with what's there */ }
  let out; try { out = mmExport(n, fmt === 'pdf' ? 300 / 96 : 2, !!MM.white); } catch (e) { toast(plainErr(e, 'The map couldn’t be drawn.')); return; }
  const png = out.canvas.toDataURL('image/png').split(',')[1]; MM.lastSave = { fmt, w: out.canvas.width, h: out.canvas.height, white: !!MM.white };
  status('Saving the map…');
  const r = await nv('save_map_image', rawId(n.id), fmt, png, !!MM.white, 300);
  if (r?.status === 'cancelled') { status('Not saved'); return; }
  if (failed(r)) { toast(r?.message || 'The map couldn’t be saved'); return; }
  status(`Saved “${r.name}” · in the Timeline`);
}
function mmSaveAct(act, t) {
  if (act === 'mm-save') { MM.saveMenu = !MM.saveMenu; renderAll(); if (MM.saveMenu) app.querySelector('.mm-savemenu .menu-item')?.focus(); return true; }
  if (act === 'mm-white') { MM.white = !MM.white; renderAll(); app.querySelector('[data-act="mm-white"]')?.focus(); return true; }
  if (act === 'mm-saveas') { MM.saveMenu = false; renderAll(); mmSaveAs(t.dataset.v); return true; }
  return false;
}
document.addEventListener('click', e => { if (MM.saveMenu && !e.target.closest?.('.mm-savemenu, [data-act="mm-save"]')) { MM.saveMenu = false; renderAll(); } }, true);   // a click away closes it
document.addEventListener('keydown', e => { if (e.key === 'Escape' && MM.saveMenu) { e.preventDefault(); e.stopImmediatePropagation(); MM.saveMenu = false; renderAll(); app.querySelector('[data-act="mm-save"]')?.focus(); } }, true);
/* ==== end Build M · R57 ==== */
