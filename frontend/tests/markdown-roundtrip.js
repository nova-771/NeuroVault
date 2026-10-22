/* Runs the round-trip, editor-HTML and safety tests for NVMarkdown and writes a plain-text report. */
(function () {
  'use strict';
  const M = window.NVMarkdown, out = [], failures = [], groups = {};
  const t0 = performance.now();
  const show = s => JSON.stringify(s);
  const diff = (want, got) => {
    const A = want.split('\n'), B = got.split('\n');
    for (let i = 0; i < Math.max(A.length, B.length); i++) if (A[i] !== B[i]) return `line ${i + 1}: wanted ${show(A[i])}, got ${show(B[i])}`;
    return '';
  };
  const noSpacing = h => h.replace(/ data-tight=""/g, '');   // spacing marks aren't content
  const tally = (group, ok, name, problems) => {
    const g = groups[group] || (groups[group] = { pass: 0, fail: 0 });
    if (ok) g.pass++; else { g.fail++; failures.push(`[${group}] ${name}\n    ` + problems.join('\n    ')); }
  };

  /* md → html → md must give the note back (or its standard form), be stable on a second pass and
     produce the same HTML both times (so nothing in the note was lost or changed) */
  function roundTrip(group, name, md, expect, opts) {
    const want = expect === undefined ? md : expect, problems = [];
    let h1, md1, h2, md2;
    try {
      h1 = M.mdToHtml(md, opts); md1 = M.htmlToMd(h1);
      h2 = M.mdToHtml(md1, opts); md2 = M.htmlToMd(h2);
    } catch (e) { tally(group, false, name, ['threw ' + e.stack]); return; }
    if (md1 !== want) problems.push('md → html → md: ' + diff(want, md1));
    if (md2 !== md1) problems.push('second pass changed it: ' + diff(md1, md2));
    if (noSpacing(h2) !== noSpacing(h1)) problems.push('HTML differs between passes: ' + diff(noSpacing(h1), noSpacing(h2)));
    tally(group, !problems.length, name, problems);
  }

  /* ---- 1. The mockup's sample notes ---- */
  const tasksOf = id => MOCK_BASE_TASKS.filter(t => t.noteId === id).map(t => t.id === 't-7' ? Object.assign({}, t, { steps: MOCK_T7_STEPS }) : t);
  // The editor shows the note's tasks inside the {{tasks}} block, built the way the mockup builds them
  const renderTasksFor = id => () => tasksOf(id).map(t => `<div class="task${t.done ? ' is-done' : ''}"><input type="checkbox" data-task="${t.id}" ${t.done ? 'checked' : ''} aria-label="Done"><span>${t.title}</span>`
    + (t.done ? '' : `<button class="icon-btn icon-btn--sm task-wand" contenteditable="false" data-act="split" data-v="${t.id}" aria-label="Break down">✨</button>`) + '</div>'
    + (t.steps || []).map((x, i) => `<div class="task is-sub${x.done ? ' is-done' : ''}"><input type="checkbox" data-step="${t.id}:${i}" ${x.done ? 'checked' : ''}><span>${x.t}</span> <span class="chip chip--neutral" contenteditable="false">${x.m} min</span></div>`).join('')).join('');
  // The .md file the mockup's "Raw .md" view shows (noteToMd): front matter, and tasks written out as a task list
  const noteToMd = n => `---\nid: ${n.id}\ntitle: "${n.title}"\nproject: ${n.category}\ntags: [${n.tags.join(', ')}]\nsqlite_sync: neurovault.db\n---\n\n`
    + n.md.replace('{{tasks}}', tasksOf(n.id).map(t => `- [${t.done ? 'x' : ' '}] ${t.title}` + (t.steps || []).map(x => `\n  - [${x.done ? 'x' : ' '}] ${x.t} (${x.m} min)`).join('')).join('\n'));
  MOCK_BASE_NOTES.forEach(n => roundTrip('BASE_NOTES', n.id + ' ' + n.title, n.md));
  MOCK_BASE_NOTES.forEach(n => roundTrip('BASE_NOTES in the editor, tasks shown', n.id, n.md, undefined, { renderTasks: renderTasksFor(n.id) }));
  /* noteToMd puts the line after the tasks straight below them. Markdown reads such a line as part of the last task
     (a "lazy continuation"), so it comes back indented under that task: the same note as Markdown reads it, but not
     what the mockup meant. The store should write a blank line after the tasks; that form round-trips exactly. */
  const lazy = md => md.replace(/(\n {0,2}- \[[ x]\] [^\n]*)\n(?![-\s#>]|\d+\. )([^\n]+)/g, '$1\n  $2');
  const noteToMdBlank = n => noteToMd(Object.assign({}, n, { md: n.md.replace('{{tasks}}', '{{tasks}}\n') })).replace(/\n+$/, '');
  let lazyCount = 0;
  MOCK_BASE_NOTES.forEach(n => { const md = noteToMd(n), want = lazy(md); if (want !== md) lazyCount++; roundTrip('BASE_NOTES as .md files (noteToMd)', n.id, md, want); });
  MOCK_BASE_NOTES.forEach(n => roundTrip('BASE_NOTES as .md files, blank line after the tasks', n.id, noteToMdBlank(n)));
  MOCK_STRESS_NOTES.forEach(n => roundTrip('stress notes 7–40', n.id, n.md));
  const longTitle = Object.assign({}, MOCK_BASE_NOTES[0], { title: 'Q3 Roadmap Draft — vault synchronisation, offline conflict resolution and the dyslexia-first editor', tags: MOCK_BASE_NOTES[0].tags.concat(['very-long-tag-name-for-cross-team-initiatives', 'mobile', 'desktop', 'crdt']) });
  roundTrip('stress notes 7–40', 'note-1 with the stress title and tags, as a .md file', noteToMdBlank(longTitle));

  /* ---- 2. Edge cases ---- */
  const explained = [`noteToMd (mockup): in ${lazyCount} of ${MOCK_BASE_NOTES.length} notes the line after the task list comes back indented under the last task\n    Markdown reads a line straight after a list as part of its last item; the mockup's noteToMd writes no blank line there. Nothing is lost (the HTML is the same both passes). The store should write a blank line after the tasks: that form round-trips exactly (see the group above).`];
  MD_CASES.forEach(c => { roundTrip('edge cases', c.name, c.md, c.expect); if (c.expect !== undefined && c.expect !== c.md) explained.push(`${c.name}: ${show(c.md)} → ${show(c.expect)}\n    ${c.why}`); });

  /* ---- 3. HTML the editor makes ---- */
  HTML_CASES.forEach(c => {
    const problems = [];
    try {
      const md = M.htmlToMd(c.html);
      if (md !== c.md) problems.push('html → md: ' + diff(c.md, md));
      const md2 = M.htmlToMd(M.mdToHtml(md));
      if (md2 !== md) problems.push('md → html → md changed it: ' + diff(md, md2));
    } catch (e) { problems.push('threw ' + e.stack); }
    tally('editor HTML', !problems.length, c.name, problems);
  });
  // Ticking a checkbox changes a property, not the HTML: htmlToMd(element) must still see it
  (() => {
    const live = document.getElementById('live'), box = document.createElement('div');
    box.innerHTML = M.mdToHtml('- [ ] open\n- [x] done');
    live.appendChild(box);
    const inputs = box.querySelectorAll('input');
    inputs[0].checked = true; inputs[1].checked = false;
    const md = M.htmlToMd(box);
    tally('editor HTML', md === '- [x] open\n- [ ] done', 'ticks made by clicking (live element)', ['got ' + show(md)]);
    box.remove();
  })();

  /* ---- 4. Safety ---- */
  const TAGS = new Set(['P', 'DIV', 'BR', 'HR', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'STRONG', 'B', 'EM', 'I', 'DEL', 'S', 'STRIKE', 'U', 'INS', 'MARK', 'SPAN', 'SUB', 'SUP', 'KBD',
    'CODE', 'PRE', 'BLOCKQUOTE', 'UL', 'OL', 'LI', 'INPUT', 'TABLE', 'THEAD', 'TBODY', 'TFOOT', 'TR', 'TH', 'TD', 'A', 'IMG', 'DETAILS', 'SUMMARY',
    'COLGROUP', 'COL']);   // Build P: column widths
  const ATTRS = new Set(['class', 'align', 'start', 'type', 'checked', 'href', 'title', 'src', 'alt', 'width', 'height', 'open', 'contenteditable',
    'data-wiki', 'data-tag', 'data-md', 'data-tight', 'data-lang', 'data-nv-href', 'data-nv-src', 'data-raw',
    'colspan', 'rowspan', 'data-nv-bg', 'data-nv-fg', 'data-nv-va', 'data-nv-borders',   // Build P: rich tables
    'data-callout', 'data-callout-fold', 'data-folded']);   // Build P: callouts
  const VALUES = { colspan: /^[1-9]\d{0,2}$/, rowspan: /^[1-9]\d{0,2}$/, 'data-nv-bg': /^(?:yellow|green|blue|pink|orange)$/, 'data-nv-fg': /^(?:red|orange|green|blue|violet|grey)$/,
    'data-nv-va': /^(?:middle|bottom)$/, 'data-nv-borders': /^(?:outer|none)$/,
    'data-callout': /^[A-Za-z][\w-]{0,39}$/, 'data-callout-fold': /^[+-]$/, 'data-folded': /^$/ };   // Build P: and only these values
  const SAFE_PROTOCOLS = new Set(['http:', 'https:', 'mailto:', 'tel:', 'file:']);   // file: = relative paths, as this page is opened from disk
  const live = document.getElementById('live');
  let checked = 0, staticBad = 0;
  function inspect(label, html) {
    checked++;
    const holder = document.createElement('div');
    holder.innerHTML = html;            // the real, live parser, as the editor will use it
    live.appendChild(holder);
    const bad = [];
    holder.querySelectorAll('*').forEach(el => {
      if (el.namespaceURI !== 'http://www.w3.org/1999/xhtml' || !TAGS.has(el.nodeName)) bad.push('element ' + el.nodeName);
      [...el.attributes].forEach(a => { if (!ATTRS.has(a.name)) bad.push(`${el.nodeName}[${a.name}]`); else if (VALUES[a.name] && !VALUES[a.name].test(a.value)) bad.push(`${el.nodeName}[${a.name}=${a.value}]`); });
      if (el.nodeName === 'A' && el.hasAttribute('href') && !SAFE_PROTOCOLS.has(new URL(el.href).protocol)) bad.push('link to ' + el.href);
      if (el.nodeName === 'IMG' && el.hasAttribute('src') && !SAFE_PROTOCOLS.has(new URL(el.src).protocol) && !/^data:image\//.test(el.src)) bad.push('image from ' + el.src);
      if (el.nodeName === 'INPUT' && el.type !== 'checkbox') bad.push('input ' + el.type);
    });
    if (bad.length) { staticBad++; tally('safety', false, label, bad); } else tally('safety', true, label, []);
  }
  XSS_CASES.forEach((p, i) => {
    const name = `payload ${i + 1}: ${p.slice(0, 60)}`;
    try {
      const h = M.mdToHtml(p);
      inspect(name + ' (opened)', h);
      inspect(name + ' (saved and reopened)', M.mdToHtml(M.htmlToMd(h)));
      inspect(name + ' (pasted as HTML, saved, reopened)', M.mdToHtml(M.htmlToMd(p)));
      inspect(name + ' (sanitize)', M.sanitize(p));
    } catch (e) { tally('safety', false, name, ['threw ' + e.stack]); }
  });
  HTML_CASES.forEach(c => inspect('editor case: ' + c.name, M.mdToHtml(M.htmlToMd(c.html))));
  // URL rules on their own
  const urls = [['https://a.example', 1], ['http://a', 1], ['mailto:a@b.c', 1], ['tel:+441234', 1], ['notes/x.md', 1], ['#top', 1], ['//cdn.example/x', 1], ['?q=1', 1],
    ['javascript:x', 0], [' JAVASCRIPT:x', 0], ['java\tscript:x', 0], ['java\nscript:x', 0], ['\u0001javascript:x', 0], ['vbscript:x', 0], ['data:text/html,x', 0], ['file:///C:/x', 0], ['obsidian://open', 0], ['C:\\x', 0]];
  urls.forEach(([u, ok]) => tally('safety', M.safeUrl(u, false) === !!ok, 'link URL ' + show(u), ['safeUrl gave ' + M.safeUrl(u, false)]));
  [['data:image/png;base64,AAAA', 1], ['data:image/svg+xml,<svg/>', 1], ['data:text/html,x', 0], ['data:image/png', 0]].forEach(([u, ok]) => tally('safety', M.safeUrl(u, true) === !!ok, 'image URL ' + show(u), ['safeUrl gave ' + M.safeUrl(u, true)]));

  /* ---- 5. Speed ---- */
  const big = Array.from({ length: 120 }, (_, i) => MOCK_BASE_NOTES[i % MOCK_BASE_NOTES.length].md + '\n\n| a | b |\n| --- | --- |\n| 1 | 2 |\n\n```js\nconst x = ' + i + ';\n```').join('\n\n');
  let s = performance.now(); const bigHtml = M.mdToHtml(big); const tOpen = performance.now() - s;
  s = performance.now(); const bigMd = M.htmlToMd(bigHtml); const tSave = performance.now() - s;
  tally('speed', bigMd === M.htmlToMd(M.mdToHtml(bigMd)), `large note (${big.split('\n').length} lines) is stable`, ['second pass changed it']);
  s = performance.now(); MOCK_BASE_NOTES.forEach(n => M.htmlToMd(M.mdToHtml(n.md))); const tSample = (performance.now() - s) / MOCK_BASE_NOTES.length;
  // Hostile shapes: each must open, save and reopen within 1 s without throwing, and stay safe
  const nasty = [['500 nested quotes', '>'.repeat(500) + ' deep'], ['500 nested lists', Array.from({ length: 500 }, (_, i) => ' '.repeat(i * 2) + '- x').join('\n')],
    ['2,000 nested HTML elements', '<div>'.repeat(2000) + 'x' + '</div>'.repeat(2000)], ['10,000 [ in one line', 'a ['.repeat(10000)],
    ['10,000 * and _', '*_'.repeat(10000)], ['10,000 < and &', '<& '.repeat(10000)], ['10,000 wiki links', '[[n]] '.repeat(10000)],
    ['10,000 #tags', '#t '.repeat(10000)], ['20,000 lines', 'line\n'.repeat(20000)], ['unclosed fence', '```\n' + 'code\n'.repeat(5000)],
    ['5,000-row table', '| a | b |\n| --- | --- |\n' + '| 1 | 2 |\n'.repeat(5000)]];
  const nastyTimes = [];
  nasty.forEach(([name, md]) => {
    const problems = [];
    let ms = 0;
    try {
      const a = performance.now(), h = M.mdToHtml(md), back = M.htmlToMd(h), h2 = M.mdToHtml(back);
      ms = performance.now() - a; nastyTimes.push(`${name} ${ms.toFixed(0)} ms`);
      if (ms > 1000) problems.push(`took ${ms.toFixed(0)} ms`);
      inspect('hostile shape: ' + name, h2);
    } catch (e) { problems.push('threw ' + e.message); }
    tally('hostile shapes', !problems.length, name, problems);
  });

  // Script from a note would run when inserted, or on the next tasks; wait, then report
  setTimeout(() => {
    tally('safety', !window.__xssHits.length, 'no payload ran (live page)', ['ran: ' + window.__xssHits.join(', ')]);
    live.innerHTML = '';
    const total = Object.values(groups).reduce((a, g) => ({ pass: a.pass + g.pass, fail: a.fail + g.fail }), { pass: 0, fail: 0 });
    out.push(`NVMarkdown tests — marked ${M.versions.marked}, turndown ${M.versions.turndown}`);
    out.push(`${total.pass} passed, ${total.fail} failed (${(performance.now() - t0).toFixed(0)} ms)\n`);
    Object.entries(groups).forEach(([k, g]) => out.push(`${g.fail ? 'FAIL' : 'pass'}  ${k}: ${g.pass}/${g.pass + g.fail}`));
    out.push(`\nSafety: ${XSS_CASES.length} payloads × 4 paths + ${HTML_CASES.length} editor cases = ${checked} HTML outputs put into the live page; ${staticBad} with a disallowed element, attribute or URL; ${window.__xssHits.length} ran script.`);
    out.push(`Speed: a sample note round trip takes ${tSample.toFixed(2)} ms; a ${big.length.toLocaleString()}-character note opens in ${tOpen.toFixed(0)} ms and saves in ${tSave.toFixed(0)} ms.`);
    out.push(`Hostile shapes (open + save + reopen): ${nastyTimes.join('; ')}.`);
    out.push(`\nStandard-form changes (the same note, written NeuroVault's way):\n  ` + explained.join('\n  '));
    if (failures.length) out.push('\nFailures:\n' + failures.join('\n'));
    const report = document.getElementById('report');
    report.textContent = out.join('\n');
    report.className = total.fail ? 'fail' : 'pass';
    document.title = `Markdown round trip: ${total.fail ? 'FAIL' : 'PASS'} ${total.pass}/${total.pass + total.fail}`;
  }, 1500);
})();
