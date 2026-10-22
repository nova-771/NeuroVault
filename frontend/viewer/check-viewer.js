/* BUILD DV · the viewer window's self-check (dev only): viewer.html?check=1&mute=1. A fake ViewerApi stands in for docviewer.py's,
   with a three-page document in the fake renderer's format, so the window, every tool, the notes list, saving, Find, the copy, the
   three layout answers, the themes and the "reader not installed" state are all checked without PDF.js or docx-preview.
   The result is window.__check ({ summary, issues, numbers }), and the page title ends "· checked". Nothing is heard (mute.js). */
'use strict';
(() => {
let N_ctx = [];
const out = window.__check = { combos: 0, issues: {}, numbers: {}, errs: [] }, iss = (k, v) => (out.issues[k] ||= []).push(v);
addEventListener('error', e => out.errs.push(e.message));
const wait = ms => new Promise(r => setTimeout(r, ms)), tick = () => new Promise(r => setTimeout(() => setTimeout(r, 0), 0));   // no requestAnimationFrame: it pauses in a hidden tab
const $ = s => app.querySelector(s), $$ = s => [...app.querySelectorAll(s)];
const DOC = { pages: [
  { w: 612, h: 792, blocks: [['h1', 'Accessibility audit: quote'], ['p', 'Prepared for NeuroVault, the desktop app, v0.1'], ['h2', 'Scope'], ['p', 'We test the desktop app on Windows 11 in its three reading themes, by keyboard only, with screen-reader testing with NVDA and JAWS. The phone apps are not part of this quote.'],
    ['h2', 'What you get'], ['li', 'A report of every issue, ranked by WCAG 2.2 level'], ['li', 'Two retests after your fixes'], ['li', 'A short call to walk through the findings']] },
  { w: 612, h: 792, blocks: [['h2', 'Costs'], ['p', 'Planning 1 day £600. Testing 4 days £2,400. Report 1 day £600. Retests (2) £450. Total £4,050.'], ['p', 'Retests are booked within five working days of your fixes.']] },
  { w: 612, h: 792, blocks: [['h2', 'Terms'], ['p', 'This quote is valid for 30 days. If the retests find new issues, retests are booked again at the day rate.']] }],
  outline: [['Scope', 1, 0], ['What you get', 1, 1], ['Costs', 2, 0], ['Terms', 3, 0]] };
const b64 = s => btoa(unescape(encodeURIComponent(s)));
const FAKE_BYTES = b64('NVFAKEDOC\n' + JSON.stringify(DOC));
// Sample files made here (never the user's): a PDF and a Word file with what the real readers must handle safely
function samplePdfBytes() {   // two pages of Helvetica text, an outline, a web link, and PDF JavaScript that must never run
  const text = (lines) => lines.map(([size, y, s]) => `BT /F1 ${size} Tf 72 ${y} Td (${s}) Tj ET`).join('\n');
  const c1 = text([[24, 700, 'Accessibility audit quote'], [12, 660, 'Screen reader testing with NVDA and JAWS.'], [12, 640, 'Two retests after your fixes.'], [12, 600, 'Visit example.com for the terms.'], [12, 560, 'A script link that must do nothing.']]);
  const c2 = text([[18, 700, 'Costs and retests'], [12, 660, 'Retests are booked within five working days.'], [12, 640, 'Total 4,050 pounds.']]);
  const o = [];
  o[1] = '<< /Type /Catalog /Pages 2 0 R /Outlines 9 0 R /OpenAction 12 0 R /Names << /JavaScript << /Names [(nv) 12 0 R] >> >> >>';
  o[2] = '<< /Type /Pages /Kids [3 0 R 5 0 R] /Count 2 >>';
  o[3] = '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 7 0 R >> >> /Contents 4 0 R /Annots [8 0 R 13 0 R] /AA << /O 12 0 R >> >>';
  o[4] = `<< /Length ${c1.length} >>\nstream\n${c1}\nendstream`;
  o[5] = '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 7 0 R >> >> /Contents 6 0 R >>';
  o[6] = `<< /Length ${c2.length} >>\nstream\n${c2}\nendstream`;
  o[7] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>';
  o[8] = '<< /Type /Annot /Subtype /Link /Rect [72 595 260 615] /Border [0 0 0] /A << /S /URI /URI (https://example.com/terms) >> >>';
  o[9] = '<< /Type /Outlines /First 10 0 R /Last 11 0 R /Count 2 >>';
  o[10] = '<< /Title (Scope) /Parent 9 0 R /Next 11 0 R /Dest [3 0 R /Fit] >>';
  o[11] = '<< /Title (Costs) /Parent 9 0 R /Prev 10 0 R /Dest [5 0 R /Fit] >>';
  o[12] = '<< /S /JavaScript /JS (this.__nvPdfScriptRan = 1; app.alert\\(1\\);) >>';
  o[13] = '<< /Type /Annot /Subtype /Link /Rect [72 555 300 575] /Border [0 0 0] /A << /S /JavaScript /JS (app.alert\\(2\\)) >> >>';
  let s = '%PDF-1.7\n%\xe2\xe3\xcf\xd3\n'; const off = [];
  for (let i = 1; i < o.length; i++) { off[i] = s.length; s += `${i} 0 obj\n${o[i]}\nendobj\n`; }
  const x = s.length; s += `xref\n0 ${o.length}\n0000000000 65535 f \n` + off.slice(1).map(n => String(n).padStart(10, '0') + ' 00000 n \n').join('') + `trailer\n<< /Size ${o.length} /Root 1 0 R >>\nstartxref\n${x}\n%%EOF\n`;
  return btoa(s);   // every character is one byte (latin1)
}
async function sampleDocxBytes() {   // two pages (a page break), headings, a web link, a javascript: link, and an altChunk with a script
  if (!window.JSZip) await dvLoadScript(DV_VENDOR + 'jszip/jszip.min.js');
  const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
  const p = (t, style) => `<w:p>${style ? `<w:pPr><w:pStyle w:val="${style}"/></w:pPr>` : ''}<w:r><w:t xml:space="preserve">${t}</w:t></w:r></w:p>`;
  const body = p('Audit scope', 'Heading1') + p('The first release goes to family and friends, with screen reader testing by the end of November.')
    + `<w:p><w:hyperlink r:id="rIdWeb"><w:r><w:t>the supplier site</w:t></w:r></w:hyperlink></w:p>`
    + `<w:p><w:hyperlink r:id="rIdJs"><w:r><w:t>a script link</w:t></w:r></w:hyperlink></w:p>`
    + `<w:altChunk r:id="rIdAlt"/>`
    + `<w:p><w:r><w:br w:type="page"/></w:r></w:p>` + p('What is out', 'Heading1') + p('The phone apps and the website. Retests follow in the spring.')
    + '<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr>';
  const z = new JSZip();
  z.file('[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="html" ContentType="text/html"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>');
  z.file('_rels/.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
  z.file('word/_rels/document.xml.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rIdStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/><Relationship Id="rIdWeb" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="https://example.com/supplier" TargetMode="External"/><Relationship Id="rIdJs" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="javascript:window.__nvDocxJs=1" TargetMode="External"/><Relationship Id="rIdAlt" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/aFChunk" Target="chunk.html"/></Relationships>');
  z.file('word/chunk.html', '<html><body><p>ALTCHUNK TEXT</p><script>window.__nvAltChunk=1</script><img src=x onerror="window.__nvAltChunk=2"></body></html>');
  z.file('word/styles.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles ${W}><w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:pPr><w:outlineLvl w:val="0"/></w:pPr><w:rPr><w:b/><w:sz w:val="32"/></w:rPr></w:style></w:styles>`);
  z.file('word/document.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document ${W}><w:body>${body}</w:body></w:document>`);
  return z.generateAsync({ type: 'base64' });
}
window.__dvSamples = { samplePdfBytes, sampleDocxBytes };
const calls = [], saved = { items: [] };
let cfgTools = 'top', realRenderers = [], canDock = true;   // the real readers only for the openings that test them   // config.json viewer_tools, as docviewer.py keeps it
let docBytes = FAKE_BYTES, kind = 'pdf', layout = { bar: 'top', side: 'right', flow: 'scroll' }, copyKinds = ['pdf', 'png'], look = { theme: 'slate', dark: 'true', accent: 'violet', font: 'system', textsize: 'm', vars: {} };
const fake = {
  info: async () => ({ status: 'success', file: 'attachments/audit-quote.pdf', name: kind === 'docx' ? 'audit-scope.docx' : 'audit-quote.pdf', kind, size: 1234, note_id: 1, from: 'Q3 Roadmap Draft', look, layout: { ...layout, bar: cfgTools }, copy_kinds: copyKinds,
    libraries: { pdfjs: 'missing', docx: 'missing', jszip: 'missing', dompurify: 'missing' }, renderers: realRenderers, versions: { pdfjs: 'pdfjs-dist 6.4.299', docx: 'docx-preview 0.4.1' }, maximized: false, can_dock: canDock }),
  doc_bytes: async () => ({ status: 'success', data: docBytes }),
  set_tools: async v => { cfgTools = v; return { status: 'success', bar: v }; },
  annotations_get: async () => ({ status: 'success', items: JSON.parse(JSON.stringify(saved.items)) }),
  annotations_save: async (items, renderer) => { saved.items = JSON.parse(JSON.stringify(items)); saved.renderer = renderer; return { status: 'success', count: items.length }; },
  save_copy: async (k, pages) => ({ status: 'success', file: 'attachments/audit-quote (annotated).pdf', name: 'audit-quote (annotated).pdf', ...(k === 'png' ? { pages: pages.length } : {}) }),
  open_link: async () => ({ status: 'success' }), open_default: async () => ({ status: 'success' }), vendor_file: async () => ({ status: 'error' }),
  log_client: async () => ({ status: 'success' }), window_minimize: async () => true, window_toggle_maximize: async () => false, window_start_drag: async () => false, window_fill: async () => false, window_close: async () => true, dock: async () => true,
};
window.pywebview = { api: new Proxy(fake, { get: (t, n) => typeof n !== 'string' || n === 'then' ? undefined : (...a) => { calls.push([n, a]); return t[n] ? t[n](...a) : Promise.resolve({ status: 'error' }); } }) };
const reset = () => { try { V.rend?.close?.(); } catch (e) { /* gone */ } Object.assign(V, { info: null, state: 'loading', msg: '', R: null, rend: null, pages: [], outline: [], items: [], undo: [], tool: 'select', col: 'red', sel: null, zoom: 1, fit: true, cur: 1, nav: null, ptab: 'notes', find: null, dlg: null, busy: false, status: '', save: { state: 'saved', err: '' }, typing: null, drawn: {}, thumbs: {}, editing: null, notesHidden: false }); };
window.__dvOpen = o => open(o);
async function open(o = {}) { reset(); ({ docBytes = FAKE_BYTES, kind = 'pdf', layout = { bar: cfgTools, side: 'right', flow: 'scroll' }, copyKinds = ['pdf', 'png'] } = o); if (o.layout?.bar) cfgTools = o.layout.bar; realRenderers = o.renderers || []; if (o.look) look = o.look; if (o.items) saved.items = o.items; await boot(); for (let i = 0; i < 20 && V.state === 'loading'; i++) await wait(20); await tick(); await drawAllPages(); out.combos++; }
async function drawAllPages() { if (V.state !== 'ready') return; for (let n = 1; n <= V.pages.length; n++) await drawPage(n); await tick(); }
const rc = el => el.getBoundingClientRect();
const ink = n => $(`.dv-ink[data-page="${n}"]`);
function at(n, x, y) { const r = rc(ink(n)); return { clientX: r.left + x / 100 * r.width, clientY: r.top + y / 100 * r.height, button: 0, bubbles: true, cancelable: true, pointerId: 1 }; }
async function press(n, x, y, x2, y2, steps = 4) {   // a click (x2 omitted) or a drag on page n, in percent
  ink(n).dispatchEvent(new PointerEvent('pointerdown', at(n, x, y)));
  if (x2 != null) for (let i = 1; i <= steps; i++) document.body.dispatchEvent(new PointerEvent('pointermove', at(n, x + (x2 - x) * i / steps, y + (y2 - y) * i / steps)));
  document.body.dispatchEvent(new PointerEvent('pointerup', at(n, x2 ?? x, y2 ?? y))); await tick();
}
const tool = async v => { $(`[data-act="tool"][data-v="${v}"]`).click(); await tick(); };
const key = async (k, o = {}, target = document.activeElement || document.body) => { target.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...o })); await tick(); };
const savedNow = async () => { await flushSave(); await wait(10); return saved.items; };
const L = ([r, g, b]) => { const f = v => { v /= 255; return v <= .03928 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4; }; return .2126 * f(r) + .7152 * f(g) + .0722 * f(b); };
const rgb = c => { const m = (String(c).match(/[\d.]+/g) || []).map(Number); return /^color\(srgb/.test(c) ? [...m.slice(0, 3).map(x => x * 255), m[3] ?? 1] : m; };
const bgOf = el => { for (let e = el; e; e = e.parentElement) { const c = rgb(getComputedStyle(e).backgroundColor); if (c.length >= 3 && (c[3] ?? 1) > .9) return c; } return [255, 255, 255]; };
function contrast(name) {
  let min = 99, worst = '';
  $$('.dv-wbar *, .dv-bar *, .dv-nav *, .dv-notes *, .dv-st *, .dv-find *, .dv-mb *').forEach(el => { if (!el.getClientRects().length || el.closest('svg, [aria-hidden="true"]')) return; if (![...el.childNodes].some(t => t.nodeType === 3 && t.textContent.trim().length > 1)) return;
    const cs = getComputedStyle(el), a = L(rgb(cs.color)), b = L(bgOf(el)), r = (Math.max(a, b) + .05) / (Math.min(a, b) + .05), need = parseFloat(cs.fontSize) >= 24 ? 3 : 4.5;
    if (r / need < min) { min = r / need; worst = `${r.toFixed(2)}:1 “${el.textContent.trim().slice(0, 30)}”`; } });
  out.numbers['contrast ' + name] = worst; if (min < .99) iss('text under AA', `${name}: ${worst}`);
}
function chrome(name) {   // the layout: the window filled, the tools in one row (or one rail), nothing spilling, the pages get the room
  const f = [], W = rc(app), doc = rc($('.dv-doc')), wb = rc($('.dv-wbar'));
  if (Math.abs(W.width - innerWidth) > 1 || Math.abs(W.height - innerHeight) > 1) f.push('the window isn’t filled');
  $$('.dv-wbar, .dv-bar, .dv-rail, .dv-float, .dv-bbar, .dv-ctx, .dv-st').forEach(b => { if (b.scrollWidth > b.clientWidth + 1 || (b.scrollHeight > b.clientHeight + 1 && !b.classList.contains('dv-rail'))) f.push(`${b.className.split(' ')[0]} spills`); });
  const tb = $$('.dv-tools .dv-t'), ts = tb.map(rc), rail = V.layout.bar === 'rail', panel = V.layout.bar === 'panel';
  if (ts.length !== 9 || (panel ? !tb.every(b => b.closest('.dv-notes, .dv-side')) : !ts.every(r => rail ? Math.abs(r.left - ts[0].left) < 1 : Math.abs(r.top - ts[0].top) < 1))) f.push(`the tools aren’t in one ${rail ? 'rail' : panel ? 'panel' : 'row'}`);
  const share = doc.width * doc.height / (W.width * (W.height - wb.height)); out.numbers['pages get ' + name] = Math.round(share * 100) + '%'; if (share < .55) f.push(`the pages get ${Math.round(share * 100)}%`);
  if ($$('.dv-win .icon-btn').some(b => !b.dataset.tip || b.getAttributeNames().includes('title'))) f.push('an icon-only control without its tooltip (or a native one)');
  if ($$('.dv-win .btn:not(.icon-btn), .dv-win .win-btn').some(b => b.dataset.tip)) f.push('a named button or window button with a tooltip');
  if (document.documentElement.scrollWidth > innerWidth + 1) f.push('the page scrolls sideways');
  if (f.length) iss('layout', `${name}: ${f.join('; ')}`);
}

async function run() {
  await document.fonts.ready;
  // a hidden tab (a background pane) pauses requestAnimationFrame, which PDF.js paints with: test-only, a timer stands in when no frame comes
  if (!(await Promise.race([new Promise(r => requestAnimationFrame(() => r(true))), wait(250).then(() => false)]))) { window.requestAnimationFrame = cb => setTimeout(() => cb(performance.now()), 16); out.numbers.frames = 'paused: a timer stood in'; }
  // 1 · it opens: the window bar, three pages, thumbnails, the outline, an empty notes list, the status line
  saved.items = []; await open();
  { const f = [], wb = $('.dv-wbar')?.textContent || '';
    if (!/audit-quote\.pdf/.test(wb) || !/3 pages · from Q3 Roadmap Draft/.test(wb)) f.push(`the window bar: ${wb.slice(0, 80)}`);
    if ($$('.dv-page').length !== 3 || $$('.dv-fake').length !== 3) f.push(`${$$('.dv-page').length} pages, ${$$('.dv-fake').length} drawn`);
    if ($$('.dv-thumb').length !== 3) f.push('the thumbnails');
    if (!$('.dv-nempty')) f.push('the empty notes list');
    if (!/Notes are saved beside the file · the PDF isn’t changed/.test($('.dv-st')?.textContent || '')) f.push('the status line');
    $('[data-act="nav"][data-v="outline"]').click(); await tick(); if ($$('.dv-ol').length !== 4) f.push('the outline'); $$('.dv-ol')[2]?.click(); await tick(); if (V.cur !== 2) f.push('the outline jumps'); $('[data-act="nav"][data-v="pages"]').click(); await tick();
    if (document.title !== 'audit-quote.pdf · NeuroVault') f.push('the title');
    if (!$$('.dv-page').every(p => Math.abs(p.offsetWidth / p.offsetHeight - 612 / 792) < .01)) f.push('a page lost its shape');
    if (f.length) iss('opening', f.join('; ')); }
  chrome('1 slate'); contrast('slate');

  // 2 · every tool makes its note; each one is listed, numbered and saved beside the file
  { const f = [];
    await tool('pin'); await press(1, 70, 30); const pin = V.items[0]; if (pin?.kind !== 'pin' || Math.abs(pin.pts[0] - 70) > .5) f.push('a pin');
    const ta = document.getElementById('dv-note-in'); await wait(20); if (!ta) f.push('the note box'); else { ta.focus(); ta.value = 'Does this cover the phone apps?'; ta.dispatchEvent(new Event('input', { bubbles: true })); }
    await tool('arrow'); await press(2, 30, 40, 60, 30); await tool('box'); await press(2, 10, 20, 80, 26); await tool('hl'); await press(2, 10, 50, 50, 54); await tool('pen'); await press(3, 10, 40, 40, 50, 8);
    await tool('text'); await press(2, 20, 70); const ti = document.getElementById('dv-typein'); if (!ti) f.push('the text box'); else { ti.value = 'Ask for a phased price'; await key('Enter', {}, ti); }
    await tool('cap'); await press(2, 12, 80); const ci = document.getElementById('dv-typein'); if (ci) { ci.value = 'Most days go to testing'; await key('Enter', {}, ci); } else f.push('the caption box');
    await tool('pin'); await press(2, 85, 22);
    // Highlight text: select words on page 1, then the tool
    await tool('select'); const line = [...$$('.dv-page[data-page="1"] .dv-fake > div')].find(d => /NVDA and JAWS/.test(d.textContent)) || $$('.dv-page[data-page="1"] .dv-fake > div')[3];
    const r = document.createRange(), tn = line.firstChild, i0 = Math.max(0, tn.data.indexOf('NVDA')); r.setStart(tn, i0); r.setEnd(tn, Math.min(tn.data.length, i0 + 13)); getSelection().removeAllRanges(); getSelection().addRange(r);
    $('[data-act="tool"][data-v="texthl"]').click(); await tick();
    const kinds = V.items.map(x => x.kind).sort().join(',');
    if (kinds !== 'arrow,box,cap,hl,pen,pin,pin,text,texthl') f.push(`made: ${kinds}`);
    const hl = V.items.find(x => x.kind === 'texthl'); if (!hl || !hl.rects.length || !/NVDA/.test(hl.quote)) f.push(`the text highlight: ${JSON.stringify(hl?.quote)}`);
    if ($$('.dv-note').length !== 9) f.push(`${$$('.dv-note').length} notes listed`);
    const nos = $$('.dv-note .dv-nb.num').map(x => x.textContent).join(','); if (nos !== '1,2') f.push(`pin numbers ${nos}`);
    if ($$('.dv-pin').map(x => x.textContent).join(',') !== '1,2') f.push('the pins on the pages');
    if ($$('.dv-ink[data-page="2"] .dv-svg [data-id]').length !== 3) f.push('the marks on page 2');
    const s = await savedNow(); if (s.length !== 9 || s.find(x => x.kind === 'pin' && x.page === 1)?.note !== 'Does this cover the phone apps?' || saved.renderer !== 'fake@1') f.push(`saved ${s.length}, ${saved.renderer}`);
    if (!/9 notes, saved beside the file/.test($('.dv-st').textContent)) f.push('the status line after saving');
    // undo, Delete, a colour on the picked mark
    await key('z', { ctrlKey: true }, document.body); if (V.items.length !== 8) f.push('undo');
    $$('.dv-note')[0].click(); await tick(); if (!$('.dv-note[aria-current="true"]') || !$('.dv-pin.is-sel')) f.push('a click on a note picks it');
    // jump: the second pin's row scrolls page 2 into view
    dvPages().scrollTop = 0; await tick(); const row = $$('.dv-note').find(x => x.querySelector('.dv-nb.num')?.textContent === '2'); row?.click(); await wait(30); await tick();
    if (!(dvPages().scrollTop > 100) || $('.dv-pin.is-sel')?.textContent !== '2' || V.cur !== 2) f.push(`jumping to pin 2 (scroll ${dvPages().scrollTop}, page ${V.cur})`);
    const before = V.items.length; $('[data-act="del"]')?.click(); await tick(); if (V.items.length !== before - 1) f.push('Delete in the list'); await key('z', { ctrlKey: true }, document.body);
    await tool('select'); const arrow = V.items.find(x => x.kind === 'arrow'); selectItem(arrow.id); $('[data-act="col"][data-v="blue"]').click(); await tick(); if (V.items.find(x => x.kind === 'arrow').colour !== 'blue') f.push('a colour on the picked mark');
    if (f.length) iss('the tools', f.join('; ')); out.numbers.tools = `${V.items.length} notes: ${V.items.map(x => x.kind).join(' ')}`; }
  chrome('2 annotated'); contrast('annotated');

  // 3 · find: every match marked, the current one stronger, up and down, Esc closes
  { const f = []; $('[data-act="find"]').click(); await wait(30); await tick(); const inp = document.getElementById('dv-find-in'); if (!inp) f.push('no find box');
    else { inp.value = 'retest'; inp.dispatchEvent(new Event('input', { bubbles: true })); await tick(); const n = $$('mark.dv-hit').length;
      const want = DOC.pages.flatMap(p => p.blocks.map(b => b[1])).join(' ').match(/retest/gi).length; if (n !== want || $$('mark.dv-hit.is-cur').length !== 1 || $('.dv-find-n').textContent !== `1 of ${n}`) f.push(`${n} matches, "${$('.dv-find-n')?.textContent}"`);
      $('[data-act="find-next"]').click(); await tick(); if ($('.dv-find-n').textContent !== `2 of ${n}`) f.push('next match');
      const cs = getComputedStyle(document.getElementById('dv-find-in')); if ((cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) > 0) || cs.boxShadow !== 'none') f.push('a focus ring on the find box');
      contrast('find');
      await key('Escape', {}, document.getElementById('dv-find-in') || document.body); if (V.find || $$('mark.dv-hit').length) f.push('Esc closes find'); }
    if (f.length) iss('find', f.join('; ')); }

  // 4 · Save an annotated copy: the dialog, then each page drawn with its notes and the notes page last
  { const f = []; calls.length = 0; $('[data-act="save-copy"]').click(); await tick();
    const b = $$('.dv-mb .modal-foot .btn'); if (b.length !== 2 || !b[1].classList.contains('btn--primary') || !/A PDF with your notes on the pages/.test($('.dv-mb')?.textContent || '')) f.push('the dialog');
    contrast('save dialog');
    await key('Escape', {}, document.body); if (V.dlg) f.push('Esc closes it');
    $('[data-act="save-copy"]').click(); await tick(); $('[data-act="dlg-save"]').click(); for (let i = 0; i < 50 && V.busy; i++) await wait(20); await tick();
    const c = calls.find(x => x[0] === 'save_copy'); if (!c || c[1][0] !== 'pdf' || c[1][1].length < 4 || !c[1][1].every(p => /^data:image\/png;base64,/.test(p))) f.push(`the copy's pages: ${c ? c[1][1].length : 'none'}`);
    if (!/Saved audit-quote \(annotated\)\.pdf beside the original, which isn’t changed/.test(V.status)) f.push(`status "${V.status}"`);
    if (V.dlg) f.push('the dialog stayed');
    // the drawn pages: the pin's colour is on page 1 near where it is, and the notes page lists the notes
    if (c) { const img = new Image(); await new Promise((ok, no) => { img.onload = ok; img.onerror = no; img.src = c[1][1][0]; setTimeout(ok, 3000); }); const cv = document.createElement('canvas'); cv.width = img.width; cv.height = img.height; const g = cv.getContext('2d'); g.drawImage(img, 0, 0);
      const pin = V.items.find(x => x.kind === 'pin' && x.page === 1), px = g.getImageData(Math.round(pin.pts[0] / 100 * cv.width) - 10, Math.round(pin.pts[1] / 100 * cv.height), 1, 1).data; if (px[0] > 240 && px[1] > 240 && px[2] > 240) f.push('the pin isn’t drawn on the copy');
      if (img.width !== Math.round(612 * 1.5)) f.push(`the copy's page is ${img.width}px wide`); }
    // both kinds are offered (R66 "offer both"): the PDF first; pictures of the pages make one PNG a page, no notes page
    $('[data-act="save-copy"]').click(); await tick(); const radios = $$('.dv-mb input[name="dv-copy"]');
    if (radios.length !== 2 || radios[0].value !== 'pdf' || radios[1].value !== 'png' || !/A picture of each page/.test($('.dv-mb').textContent)) f.push('both kinds offered');
    radios[1]?.click(); await tick(); calls.length = 0; $('[data-act="dlg-save"]').click(); for (let i = 0; i < 50 && V.busy; i++) await wait(20); await tick();
    const c2 = calls.find(x => x[0] === 'save_copy'); if (!c2 || c2[1][0] !== 'png' || c2[1][1].length !== 3) f.push(`pictures of the pages: ${c2 ? c2[1][0] + ' ' + c2[1][1].length : 'none'}`);
    if (!/Saved 3 pictures of the pages beside the original/.test(V.status)) f.push(`status "${V.status}"`);
    if (f.length) iss('the copy', f.join('; ')); }

  // 5 · it opens again with the notes it saved; a Word file; "the reader isn't installed"; a broken file
  { const f = [], keep = JSON.parse(JSON.stringify(saved.items)); await open(); if (V.items.length !== keep.length || $$('.dv-note').length !== keep.length) f.push('the notes come back');
    await open({ kind: 'docx' }); if (!/audit-scope\.docx/.test($('.dv-wbar').textContent) || !/the Word file isn’t changed/.test($('.dv-st').textContent) || !$('.dv-nav.is-outline')) f.push('a Word file');
    await open({ docBytes: b64('%PDF-1.7 not a fake') }); if (V.state !== 'missing' || !/needs the PDF reader/.test($('.dv-empty')?.textContent || '') || !$('[data-act="open-default"]')) f.push('the PDF reader isn’t installed');
    calls.length = 0; $('[data-act="open-default"]')?.click(); await tick(); if (!calls.some(x => x[0] === 'open_default')) f.push('Open in your default app');
    if (!$$('.dv-t').every(b => b.disabled)) f.push('the tools stay on without a document'); chrome('missing');
    await open({ kind: 'docx', docBytes: b64('PK not a fake') }); if (!/needs the Word reader/.test($('.dv-empty')?.textContent || '')) f.push('the Word reader isn’t installed');
    await open({ docBytes: b64('NVFAKEDOC\n{broken') }); if (V.state !== 'error' || !$('.dv-empty')) f.push('a broken file');
    if (f.length) iss('opening again', f.join('; ')); }

  // 6 · the other layout answers (docviewer.LAYOUT): each is one line there; here each must draw and work
  for (const lay of [{ bar: 'float' }, { side: 'tabs' }, { flow: 'single' }, { flow: 'spread' }]) {
    const l = { bar: 'top', side: 'right', flow: 'scroll', ...lay }, name = Object.entries(lay).map(e => e.join('=')).join(); await open({ layout: l });
    const f = []; if (app.dataset.bar !== l.bar || app.dataset.side !== l.side || app.dataset.flow !== l.flow) f.push('not applied');
    await tool('pin'); await press(1, 50, 50); if (V.items.length !== keepCount() + 1) f.push('a pin'); await key('z', { ctrlKey: true }, document.body);
    const shown = $$('.dv-page').filter(p => p.getClientRects().length && getComputedStyle(p).display !== 'none'), t = shown.map(rc);
    if (l.flow === 'single' && (shown.length !== 1 || !$('.dv-pnav')?.getClientRects().length)) f.push(`${shown.length} pages shown`);
    if (l.flow === 'spread' && !(t.length >= 2 && Math.abs(t[1].top - t[0].top) < 2)) f.push('not side by side');
    if (l.side === 'tabs' && (!$('.dv-side') || $('.dv-notes'))) f.push('the side panel');
    if (f.length) iss('layout answers', `${name}: ${f.join('; ')}`); chrome(name); }
  function keepCount() { return saved.items.length; }

  // 6c · where the tools sit, a setting (R66: "customisable user setting"): every place draws its tools where R66 drew them and works
  { const f = [], where = { float: '.dv-doc > .dv-float', top: '.dv-bar', rail: '.dv-rail', bottom: '.dv-bbar', context: '.dv-doc > .dv-ctx', panel: '.dv-notes .dv-tsec' };
    for (const bar of Object.keys(where)) { await open({ layout: { bar, side: 'right', flow: 'scroll' } });
      if ($(where[bar])?.querySelectorAll('.dv-t').length !== 9 || $$('.dv-t').length !== 9) f.push(`${bar}: the tools aren’t in ${where[bar]}`);
      if ($('.dv-tplace')?.textContent !== `Tools: ${dvPlace(bar)[1]}`) f.push(`${bar}: the status line says "${$('.dv-tplace')?.textContent}"`);
      if (bar === 'bottom' && !(rc($('.dv-bbar')).top >= rc($('.dv-body')).bottom - 1 && rc($('.dv-bbar')).bottom <= rc($('.dv-st')).top + 1)) f.push('bottom: not between the pages and the status line');
      const n0 = V.items.length; await tool('pin'); await press(1, 40, 40); if (V.items.length !== n0 + 1) f.push(`${bar}: a pin`); await key('z', { ctrlKey: true }, document.body);
      chrome('tools ' + bar); }
    // beside what you pick: the tools follow a click on a page, and step aside while the pages scroll
    // It sits 16px under the click, centred on it; near the pages' edge (a small window, a click near the side) it's pushed back
    // to stay 8px inside, so it never covers the side panels: checked in a 1024 × 768 window and in this one, at both edges too
    const fr = document.getElementById('frame'), sizes = [[1024, 768], [0, 0]]; N_ctx = [];
    for (const [W, H] of sizes) { Object.assign(fr.style, W ? { width: W + 'px', height: H + 'px' } : { width: '', height: '' }); await tick();
      await open({ layout: { bar: 'context', side: 'right', flow: 'scroll' } }); await tool('select');
      for (const [x, y] of [[30, 40], [50, 30], [3, 50], [97, 50]]) { const p = at(1, x, y); ink(1).dispatchEvent(new PointerEvent('pointerup', p)); await tick();
        const cx = $('.dv-ctx'), cr = rc(cx), d = rc($('.dv-doc')), lo = d.left + cr.width / 2 + 8, hi = d.right - cr.width / 2 - 8, want = Math.max(lo, Math.min(p.clientX, hi)), mid = cr.left + cr.width / 2;
        N_ctx.push(`${W || innerWidth}: ${x}% → ${Math.round(mid - p.clientX)}px`);
        const wantT = Math.max(d.top + 8, Math.min(p.clientY + 16, d.bottom - cr.height - 8)); if (cx.hidden || Math.abs(cr.top - wantT) > 3 || Math.abs(mid - want) > 2) f.push(`context ${W || innerWidth}×${H || innerHeight}: not beside the click (${Math.round(mid)},${Math.round(cr.top)} for ${Math.round(p.clientX)},${Math.round(p.clientY)}, want ${Math.round(want)})`);
        if (cr.left < d.left + 7 || cr.right > d.right - 7 || cr.top < d.top + 7 || cr.bottom > d.bottom - 7) f.push(`context ${W || innerWidth}: the tools leave the pages (${Math.round(cr.left)}–${Math.round(cr.right)} in ${Math.round(d.left)}–${Math.round(d.right)})`); }
      dvPages().scrollTop += 60; onScroll(); await tick(); if (!$('.dv-ctx').hidden) f.push('context: still there while the pages scroll');
      ink(2).dispatchEvent(new PointerEvent('pointerup', at(2, 50, 20))); await tick(); if ($('.dv-ctx').hidden) f.push('context: back on the next click'); }
    Object.assign(fr.style, { width: '', height: '' }); out.numbers['context offset'] = N_ctx.join(' · ');
    // Tools: … in the viewer: the six places, the one in use ticked; a pick moves the tools at once (no reload) and is saved
    await open({ layout: { bar: 'float', side: 'right', flow: 'scroll' } }); const info0 = V.info, drawn0 = $$('.dv-fake').length; calls.length = 0;
    $('[data-act="tools-menu"]').click(); await tick(); const items = $$('.dv-tmenu [role="menuitemradio"]'), mr = $('.dv-tmenu') && rc($('.dv-tmenu')), A = rc(app);
    if (items.length !== 6 || $('.dv-tmenu [aria-checked="true"]')?.dataset.v !== 'float' || $('[data-act="tools-menu"]').getAttribute('aria-expanded') !== 'true') f.push('the Tools menu');
    if (!mr || mr.left < A.left || mr.right > A.right || mr.top < A.top || mr.bottom > rc($('.dv-st')).top + 1) f.push('the Tools menu isn’t inside the window, above the status line');
    contrast('tools menu');
    await key('Escape', {}, document.activeElement || document.body); if ($('.dv-tmenu')) f.push('Esc closes the Tools menu');
    $('[data-act="tools-menu"]').click(); await tick(); $$('.dv-tmenu [role="menuitemradio"]').find(i => i.dataset.v === 'rail')?.click(); await wait(10); await tick();
    if (app.dataset.bar !== 'rail' || $$('.dv-rail .dv-t').length !== 9 || V.info !== info0 || $$('.dv-fake').length < Math.min(1, drawn0) || $('.dv-tmenu')) f.push('a pick moves the tools at once');
    if (!calls.some(c => c[0] === 'set_tools' && c[1][0] === 'rail') || !/Tools: Down the left\. Remembered for every document/.test(V.status)) f.push(`saved: "${V.status}"`);
    await open(); if (app.dataset.bar !== 'rail') f.push('remembered next time');
    window.nvViewer({ kind: 'tools', bar: 'bottom' }); await tick(); if (app.dataset.bar !== 'bottom' || $$('.dv-bbar .dv-t').length !== 9 || $('.dv-tplace')?.textContent !== 'Tools: Along the bottom') f.push('a change in Settings reaches an open viewer');
    cfgTools = 'top';
    if (f.length) iss('where the tools sit', f.join('; ')); }
  // 6d · a drag draws one mark: the preview replaces itself each move (the user saw a "smear": every in-between arrow stayed)
  { const f = []; await open({ layout: { bar: 'top', side: 'right', flow: 'scroll' } }); const n0 = V.items.length;
    for (const k of ['arrow', 'box', 'hl', 'pen']) { await tool(k); const before = V.items.length, svg = () => $$('.dv-ink[data-page="3"] .dv-svg > *');
      ink(3).dispatchEvent(new PointerEvent('pointerdown', at(3, 10, 10)));
      let most = 0; for (let i = 1; i <= 20; i++) { document.body.dispatchEvent(new PointerEvent('pointermove', at(3, 10 + i * 2.5, 10 + i * 1.5))); most = Math.max(most, svg().length); }
      document.body.dispatchEvent(new PointerEvent('pointerup', at(3, 60, 40))); await tick();
      const mine = V.items.filter(x => x.page === 3 && ['arrow', 'box', 'hl', 'pen'].includes(x.kind)).length, shapes = svg().length;   // one shape each
      if (V.items.length !== before + 1) f.push(`${k}: ${V.items.length - before} marks after one drag`);
      if (most > mine) f.push(`${k}: ${most} shapes on the page while dragging (${mine - 1} marks before it, plus the one being drawn)`);
      if (shapes !== mine) f.push(`${k}: ${shapes} shapes on the page for ${mine} marks`); }
    // moving a pin: 20 moves, still one pin, in one place
    await tool('pin'); await press(3, 30, 70); const pin = V.items[V.items.length - 1]; await tool('select');
    const pe = $(`.dv-ink[data-page="3"] [data-id="${pin.id}"]`); pe.dispatchEvent(new PointerEvent('pointerdown', at(3, 30, 70)));
    for (let i = 1; i <= 20; i++) document.body.dispatchEvent(new PointerEvent('pointermove', at(3, 30 + i, 70 - i))); document.body.dispatchEvent(new PointerEvent('pointerup', at(3, 50, 50))); await tick();
    if ($$('.dv-ink[data-page="3"] .dv-pin').length !== 1 || Math.abs(itemById(pin.id).pts[0] - 50) > 1 || V.items.filter(x => x.kind === 'pin' && x.page === 3).length !== 1) f.push('moving a pin left copies or didn’t follow');
    // text placed: one box while typing, one mark after
    await tool('text'); await press(3, 20, 85); await press(3, 25, 88); if ($$('#dv-typein').length !== 1) f.push(`${$$('#dv-typein').length} text boxes`);
    const ti = document.getElementById('dv-typein'); if (ti) { ti.value = 'One word'; await key('Enter', {}, ti); } if (V.items.filter(x => x.kind === 'text' && x.page === 3).length !== 1) f.push('text: not one mark');
    out.numbers.drag = `${V.items.length - n0} marks for 4 drags, a pin and a word`;
    if (f.length) iss('one mark per drag', f.join('; ')); }
  // 6e · the zoom stays when the window changes size (feedback: "it also auto zooms in when adjusting the size of the window,
  // this is jaring"); Fit to width is a one-off; the page you're reading stays in view; Ctrl+wheel zooms
  { const f = [], fr = document.getElementById('frame'); await open({ layout: { bar: 'top', side: 'right', flow: 'scroll' } });
    const z0 = V.zoom; goPage(2); await tick(); const top0 = dvPages().scrollTop;
    for (const [W, H] of [[1024, 768], [1920, 1080], [1366, 900]]) { Object.assign(fr.style, { width: W + 'px', height: H + 'px' }); dispatchEvent(new Event('resize')); await wait(200);
      if (V.zoom !== z0) f.push(`${W}×${H}: the zoom went ${Math.round(z0 * 100)}% → ${Math.round(V.zoom * 100)}%`); if (V.cur !== 2) f.push(`${W}: the reading place moved to page ${V.cur}`); }
    if (Math.abs(dvPages().scrollTop - top0) > 2) f.push(`the scroll moved ${Math.round(dvPages().scrollTop - top0)}px`);
    $('[data-act="navt"]')?.click(); await wait(50); $('[data-act="notest"]')?.click(); await wait(50); if (V.zoom !== z0) f.push('hiding a side panel changed the zoom');
    $('[data-act="navt"]')?.click(); $('[data-act="notest"]')?.click(); await tick();
    Object.assign(fr.style, { width: '1920px', height: '1080px' }); await tick(); $('[data-act="zoom"][data-v="fit"]').click(); await tick(); const zf = V.zoom;
    if ($('[data-act="zoom"][data-v="fit"]')?.hasAttribute('aria-pressed')) f.push('Fit to width shows as a mode');
    Object.assign(fr.style, { width: '1024px', height: '768px' }); dispatchEvent(new Event('resize')); await wait(200); if (V.zoom !== zf) f.push('after Fit to width, a resize still changed the zoom');
    const zw = V.zoom; dvPages().dispatchEvent(new WheelEvent('wheel', { deltaY: -100, ctrlKey: true, bubbles: true, cancelable: true })); await tick(); if (!(V.zoom > zw)) f.push('Ctrl+wheel doesn’t zoom in');
    Object.assign(fr.style, { width: '', height: '' }); dispatchEvent(new Event('resize')); await tick();
    out.numbers.resize = `zoom ${Math.round(z0 * 100)}% kept through 1024, 1920 and 1366; Fit ${Math.round(zf * 100)}% kept; Ctrl+wheel → ${Math.round(V.zoom * 100)}%`;
    if (f.length) iss('the zoom stays', f.join('; ')); }
  // 6f · R70 "Pro editor": the ribbon of labelled groups under the window bar, named colour squares, notes as rows, a box to type
  // in for a mark with no words (no dead "No note yet", no focus ring), Redo, a compact window bar, Back into a tab when popped out
  { const f = []; await open({ layout: { bar: 'top', side: 'right', flow: 'scroll' }, items: [{ id: 'a1', kind: 'arrow', page: 1, pts: [10, 10, 40, 30], note: '', colour: 'red', text: '', quote: '' }, { id: 'p1', kind: 'pin', page: 2, pts: [50, 50], note: 'Ask Maya', colour: 'red', text: '', quote: '' }] });
    const groups = $$('.dv-ribbon .dv-rgl').map(x => x.textContent).join(); if (groups !== 'View,Mark,Shapes,Colour,History,File') f.push(`the ribbon’s groups: ${groups}`);
    const rb = rc($('.dv-bar')), wb = rc($('.dv-wbar')); if (Math.abs(rb.top - wb.bottom) > 1 || Math.round(wb.height) !== 30) f.push(`the bar under a compact window bar (${Math.round(wb.height)} px)`);
    const sq = $$('.dv-ribbon .dv-sq'); const shown = sq.filter(b => b.querySelector('span')?.offsetWidth); if (sq.map(b => b.textContent.trim()).join() !== 'Red,Amber,Blue' || (innerWidth >= 1366 && shown.length !== 3)) f.push('named colour squares');   // a narrow window hides the names (our tooltip names them then)
    if ($('.dv-nl')?.textContent.includes('No note yet')) f.push('a dead “No note yet”');
    const inp = $('.dv-n.is-empty .dv-in'); if (!inp || $$('.dv-in').length !== 1) f.push('a box to type in for the arrow');
    else { inp.focus(); const cs = getComputedStyle(inp); if ((cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) > 0) || cs.boxShadow !== 'none') f.push('a focus ring on the note box'); inp.value = 'Points at the total'; inp.dispatchEvent(new Event('input', { bubbles: true })); await key('Enter', {}, inp); inp.blur(); await tick(); await wait(10);
      if (itemById('a1')?.note !== 'Points at the total' || !/Points at the total/.test($('.dv-nl').textContent) || $('.dv-in')) f.push('typing in the box keeps the note'); }
    const row = $$('.dv-note').map(rc); if (!row.every(r => r.height < 48)) f.push('notes as tight rows');
    const n0 = V.items.length; await tool('pin'); await press(1, 60, 60); await key('z', { ctrlKey: true }, document.body); if (V.items.length !== n0) f.push('undo'); await key('y', { ctrlKey: true }, document.body); if (V.items.length !== n0 + 1) f.push('redo');
    $('[data-act="undo"]')?.click(); await tick(); $('[data-act="redo"]')?.click(); await tick(); if (V.items.length !== n0 + 1) f.push('the History buttons');
    if (!/^Page 1 of 3 · \d+%$/.test($('.dv-st .num')?.textContent || '')) f.push(`the status: ${$('.dv-st .num')?.textContent}`);
    calls.length = 0; if (!$('.dv-wbar .dv-dock')) f.push('Back into a tab'); else { $('.dv-dock').click(); await wait(20); if (!calls.some(c => c[0] === 'dock')) f.push('Back into a tab asks to dock'); }
    canDock = false; await open(); if ($('.dv-dock')) f.push('Back into a tab for a file from outside the vault'); canDock = true;
    chrome('pro'); contrast('pro');
    if (f.length) iss('the Pro editor look', f.join('; ')); }
  // 6b · Fit to width on wide screens: the page stops at DV_PAGE_MAX (never edge to edge), centred; at 1366 it fits the room
  { const fr = document.getElementById('frame'), f = []; await open();
    for (const [W, H] of [[1366, 768], [1920, 1080], [3440, 1440]]) {
      Object.assign(fr.style, { width: W + 'px', height: H + 'px' }); await tick(); setZoom(fitZoom(), true); await tick();
      for (const flow of [V.layout.flow]) { const box = dvPages(), pg = $('.dv-page'), b = rc(box), r = rc(pg), left = r.left - b.left, right = b.left + box.clientWidth - r.right;
        out.numbers[`fit page ${W}`] = `${Math.round(r.width)}px at ${Math.round(V.zoom * 100)}%`;
        if (r.width > DV_PAGE_MAX + 1) f.push(`${W}: the page is ${Math.round(r.width)}px wide`);
        if (r.width > box.clientWidth - 40) f.push(`${W}: the page fills the room`);
        if (Math.abs(left - right) > 2) f.push(`${W}: not centred (${Math.round(left)} / ${Math.round(right)})`);
        if (W === 1366 && r.width < box.clientWidth - 60) f.push('1366: the page doesn’t use the room'); } }
    await open({ layout: { bar: 'top', side: 'right', flow: 'spread' } }); Object.assign(fr.style, { width: '3440px', height: '1440px' }); await tick(); setZoom(fitZoom(), true); await tick();
    const ps = $$('.dv-page').map(rc); out.numbers['fit spread 3440'] = `${Math.round(ps[0].width)}px each`; if (ps[0].width > DV_PAGE_MAX + 1 || Math.abs(ps[1].top - ps[0].top) > 2) f.push(`3440 spread: ${Math.round(ps[0].width)}px, side by side ${Math.abs(ps[1].top - ps[0].top) <= 2}`);
    Object.assign(fr.style, { width: '', height: '' }); await tick();
    if (f.length) iss('fit to width', f.join('; ')); }
  // 8 · the real readers (vendored, hash-checked), on sample files made here: PDF.js 6.4.299 and docx-preview 0.4.1, safely
  { const f = [], N = out.numbers.real = {}, drawn = async (sel) => { for (let i = 0; i < 100 && !$(sel); i++) await wait(50); return !!$(sel); };
    const ink = c => { if (!c) return 0; const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let k = 0; for (let i = 0; i < d.length; i += 16) if (d[i] < 128) k++; return k; };
    saved.items = []; await open({ docBytes: samplePdfBytes(), renderers: ['pdf', 'docx'] }); await drawn('.dv-page[data-page="1"] .textLayer span');
    const spans = $$('.dv-page[data-page="1"] .textLayer span').map(s => s.textContent), links = $$('.dv-link');
    N.pdf = `${V.R?.id} · ${V.pages.length} pages · outline ${V.outline.map(o => o.title + '→' + o.page).join(', ')} · ink ${ink($('.dv-page[data-page="1"] canvas'))} · ${spans.length} text runs · links ${links.map(l => l.dataset.url || l.dataset.page).join(', ')}`;
    if (V.R?.id !== 'pdfjs@6.4.299' || V.state !== 'ready' || V.pages.length !== 2) f.push(`PDF: ${V.state} ${V.R?.id} ${V.msg}`);
    if (V.outline.map(o => o.title + o.page).join() !== 'Scope1,Costs2') f.push('PDF: the outline');
    if (!(ink($('.dv-page[data-page="1"] canvas')) > 50)) f.push('PDF: the page isn’t drawn');
    if (!spans.some(s => /NVDA and JAWS/.test(s))) f.push('PDF: no text layer');
    if (links.length !== 1 || links[0].dataset.url !== 'https://example.com/terms' || links[0].getAttribute('href')) f.push('PDF: the links (one web link; the script link left out)');
    if (window.__nvPdfScriptRan != null) f.push('PDF JavaScript ran');
    calls.length = 0; links[0]?.click(); await tick(); if (!calls.some(c => c[0] === 'open_link' && c[1][0] === 'https://example.com/terms')) f.push('PDF: a link opens through open_link');
    const sp = $$('.dv-page[data-page="1"] .textLayer span').find(s => /NVDA and JAWS/.test(s.textContent)), tn = sp?.firstChild, at0 = tn ? tn.data.indexOf('NVDA') : -1;
    if (tn && at0 >= 0) { const rg = document.createRange(); rg.setStart(tn, at0); rg.setEnd(tn, at0 + 13); getSelection().removeAllRanges(); getSelection().addRange(rg); $('[data-act="tool"][data-v="texthl"]').click(); await tick(); }
    const hl = V.items.find(x => x.kind === 'texthl'); if (!hl || hl.quote !== 'NVDA and JAWS' || !(hl.rects[0][2] > 5)) f.push(`PDF: Highlight text (${hl?.quote})`);
    $('[data-act="find"]').click(); await wait(30); const fi = document.getElementById('dv-find-in'); if (fi) { fi.value = 'retests'; fi.dispatchEvent(new Event('input', { bubbles: true })); await tick(); }
    N.pdfFind = $('.dv-find-n')?.textContent; if ($$('mark.dv-hit').length < 2) f.push(`PDF: Find (${N.pdfFind})`); closeFind();
    calls.length = 0; V.copyKind = 'pdf'; await makeCopy(); const cp = calls.find(c => c[0] === 'save_copy'); if (!cp || cp[1][0] !== 'pdf' || cp[1][1].length !== 3) f.push(`PDF: the copy (${cp?.[1][1].length} pages)`);
    // Word: docx-preview into a detached box, DOMPurify on every page, no altChunk, no javascript: link, its own styles only
    saved.items = []; await open({ kind: 'docx', docBytes: await sampleDocxBytes(), renderers: ['pdf', 'docx'] }); await drawn('.dv-page[data-page="1"] section.docx');
    const pg = $('.dv-pages'), html = pg?.innerHTML || '';
    N.docx = `${V.R?.id} · ${V.pages.length} pages · outline ${V.outline.map(o => o.title + '→' + o.page).join(', ')} · links ${$$('.dv-pages [data-url]').map(a => a.dataset.url).join(', ')}`;
    if (V.R?.id !== 'docx-preview@0.4.1' || V.state !== 'ready' || V.pages.length !== 2) f.push(`Word: ${V.state} ${V.R?.id} ${V.msg}`);
    if (V.outline.map(o => o.title + o.page).join() !== 'Audit scope1,What is out2') f.push(`Word: the outline (${V.outline.map(o => o.title).join()})`);
    if (/ALTCHUNK/.test(document.body.innerHTML) || window.__nvAltChunk != null) f.push('Word: the altChunk (embedded HTML) was shown or ran');
    if (window.__nvDocxJs != null || /javascript:/i.test(html) || $$('.dv-pages script, .dv-pages style, .dv-pages iframe, .dv-pages object, .dv-pages form, .dv-pages a[href]').length) f.push('Word: something unsafe reached the page');
    if ($$('.dv-pages [data-url]').map(a => a.dataset.url).join() !== 'https://example.com/supplier') f.push('Word: the web link');
    if (![...document.adoptedStyleSheets].every(sh => [...sh.cssRules].every(r => /^\s*\.docx/.test(r.selectorText || '')))) f.push('Word: a style outside .docx');
    await tool('pin'); await press(1, 50, 13); const pin = V.items.find(x => x.kind === 'pin'); if (!pin || !/family and friends|Audit scope/.test(pin.quote)) f.push(`Word: a pin keeps the words near it (${pin?.quote})`);
    calls.length = 0; V.copyKind = 'png'; await makeCopy(); const cw = calls.find(c => c[0] === 'save_copy'); if (!cw || cw[1][0] !== 'png' || cw[1][1].length !== 2) f.push(`Word: the copy (${cw?.[1][1].length} pages, "${V.status}")`);
    else { const img = new Image(); await new Promise(ok => { img.onload = ok; img.onerror = ok; img.src = cw[1][1][0]; setTimeout(ok, 3000); }); const c = document.createElement('canvas'); c.width = img.width; c.height = img.height; c.getContext('2d').drawImage(img, 0, 0); if (!(ink(c) > 50)) f.push('Word: the copy’s page is blank'); }
    V.copyKind = 'pdf';
    if (f.length) iss('the real readers', f.join('; ')); }
  // 7 · a light theme; nothing reaches the network; nothing is heard; the CSP is as the research says
  await open({ look: { theme: 'paper', dark: 'false', accent: 'violet', font: 'opendyslexic', textsize: 'm', vars: {} } }); chrome('paper'); contrast('paper');
  { const f = [], csp = document.querySelector('meta[http-equiv="Content-Security-Policy"]')?.content || '';
    for (const part of ["default-src 'none'", "script-src 'self'", "connect-src 'none'", "object-src 'none'", "frame-src 'none'", "base-uri 'none'", "form-action 'none'"]) if (!csp.includes(part)) f.push(`the CSP lacks ${part}`);
    if (/unsafe-eval|wasm-unsafe-eval/.test(csp)) f.push('the CSP allows eval');
    const off = performance.getEntriesByType('resource').filter(e => new URL(e.name).origin !== location.origin); if (off.length) f.push(`network: ${off.map(e => e.name).slice(0, 3)}`);
    if (typeof nvAudible === 'function' && nvAudible().length) f.push('something can be heard');
    if ([...document.querySelectorAll('*')].some(e => e.getAttributeNames().includes('title'))) f.push('a native tooltip');
    if (f.length) iss('safety', f.join('; ')); }
  out.summary = `viewer: ${out.combos} openings, ${Object.keys(out.issues).length} issue groups, ${out.errs.length} script errors`;
  document.title += ' · checked';
}
run().catch(e => { out.errs.push(String(e?.stack || e)); out.summary = 'viewer check stopped: ' + e; document.title += ' · checked'; });
})();
