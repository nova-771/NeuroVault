/* Drives the real note editor (the app in #app-frame) through every case in design/editor-behaviour.md and writes a
   plain-text report: PASS / FAIL / NOT BUILT / SKIP per case, then the totals.

   How a case runs
   - Start: a note's Markdown (or, when it starts with "<", the editor's HTML: an empty line can't be written in
     Markdown). The app draws it with its own renderAll(). Markers place the caret or selection, then are removed:
       ‸ the caret    ⟦ … ⟧ a selection
     With no marker the caret goes to the end of the note.
   - Action: the toolbar's real buttons (mousedown + click, as a mouse sends them), the Text style list, the pickers,
     keys and pastes.
   - Keys: Chromium never types or deletes for a synthetic KeyboardEvent, so key() does what the browser does for a
     real key: keydown (the app may handle it and preventDefault) → beforeinput with the real inputType (the app may
     handle that instead) → if nothing was prevented, the browser's own editing command for that key
     (insertText, insertParagraph, insertLineBreak, delete, forwardDelete, selectAll, undo, redo, bold…).
     Tab's default is to move focus out of the editor, so key('Tab') blurs it when nothing handled it.
     Limits: beforeinput.getTargetRanges() is empty for these events, and the browser's own paste cleaning isn't run
     (paste() inserts the clipboard HTML with insertHTML). The real-keystroke checks in the spec cover the rest.
   - Checks: the Markdown the note would save (the app's own typedLinks + NVMarkdown.htmlToMd, as syncDoc does), the
     DOM, the selection, focus staying in the editor, the change being marked for saving, no blocks inside a <p>, and
     the save round trip (the saved .md, loaded again, shows the same blocks and saves to the same .md).
     Then an optional probe: type "Z" where the caret is now, and check where it went.
   - Undo: each action that changes the note runs a second time, then Ctrl+Z (must give the start back) and Ctrl+Y
     (must give the result again). Reported as its own case, "<id>u". */
(function () {
  'use strict';
  const FRAME = document.getElementById('app-frame'), REPORT = document.getElementById('report');
  const ONLY = new URLSearchParams(location.search).get('only');
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const until = async (cond, ms = 8000) => { const t0 = Date.now(); while (!cond()) { if (Date.now() - t0 > ms) return false; await sleep(20); } return true; };   // Fix A: wait on what a case needs, not a fixed time (a busy PC is slower)
  let W, E, live = false;
  const H = {
    get doc() { return W.document.querySelector('.doc'); },
    get n() { return W.eval('note()'); },
    get W() { return W; },
  };

  /* ================= The app ================= */
  async function bootApp() {
    FRAME.src = '../index.html?mute=1';   // always muted (QC 115)
    await new Promise(r => FRAME.addEventListener('load', r, { once: true }));
    W = FRAME.contentWindow; E = s => W.eval(s);
    for (let i = 0; i < 150 && !(E('typeof started !== "undefined" && !!started')); i++) await sleep(100);
    await E('started');
    // Build M (coordinator, 2026-10-19): the app reopens the workspace it saved, which may be the Dictionary or another module
    // with no note showing. The suite needs a note, so it goes to Notes and opens one itself, whatever was saved (again if a late
    // render puts the saved workspace back)
    const toNotes = () => E(`(() => { try { if (typeof LD !== 'undefined') LD.list = null; S.modal = null; UI.zen = 'off';
      S.offTab = null; if (UI.view !== 'notes') setUI('view', 'notes');   // offTab: a module the saved workspace opened in the main pane
      const n = (typeof note === 'function' && note()) || D.notes[0]; if (n && typeof openNote === 'function') openNote(n.id); else renderAll(); } catch (e) { renderAll(); } })()`);
    for (let i = 0; i < 30 && !H.doc; i++) await sleep(100);
    // An empty vault (the staging bridge's scratch vault, QC 86) has no note to open: the suite makes one to test in, in the vault
    // the bridge was started with. Never in the user's own vault: a vault in Documents\NeuroVault stops the suite instead
    if (!H.doc && !E('D.notes.length')) {
      const where = String(E('typeof VSTATE !== "undefined" ? VSTATE.path : ""') || '');
      if (/[\\/]Documents[\\/]NeuroVault[\\/]?$/i.test(where)) throw new Error(`the bridge's vault is ${where}: start it on a scratch vault, the suite won't write there`);
      await E(`(async () => { if (D.notes.length) return; if (typeof vaultRoot === 'function' && !vaultRoot() && !D.folders.length && !D.projects.length) { await newItem('folder'); S.rename = null; }
        await newItem('note'); S.rename = null; S.focus = null; renderAll(); })()`);
    }
    for (let i = 0; i < 100 && !H.doc; i++) { if (i % 20 === 0) toNotes(); await sleep(100); }
    if (!H.doc) throw new Error('the editor never appeared');
    // The wrap-up reminder and the morning launchpad (Build F) open on their own after boot when the backend says they're
    // due (an evening run on a fresh config): they'd take focus from the note mid-case, so they're switched off here
    E('if (typeof openWrap === "function") openWrap = async () => {}; if (typeof openLaunch === "function") openLaunch = async () => {}');
    // The app renders again once the bridge's pywebviewready lands (settings, vault, timer): wait until the editor
    // element has stayed the same for 800 ms, so that late render can't land in the first case
    for (let el = H.doc, quiet = 0, n = 0; quiet < 8 && n < 300; n++) { await sleep(100); if (!H.doc) { toNotes(); quiet = 0; continue; } if (H.doc === el) quiet++; else { el = H.doc; quiet = 0; } }
    if (!H.doc) throw new Error('the editor never appeared');
    E('S.modal = null; S.a11y.zoneB = true; S.a11y.spell = false; S.a11y.homophones = false; S.a11y.bionic = false; S.a11y.ruler = false; UI.zen = "off"; renderAll()');
    live = !!E('VAULT.live');
  }

  /* ================= Starting state ================= */
  const MARK = /[‸⟦⟧]/;
  function placeMarkers(root) {
    const at = {};
    for (;;) {
      const w = W.document.createTreeWalker(root, W.NodeFilter.SHOW_TEXT); let t, hit = null;
      while ((t = w.nextNode())) { const i = t.data.search(MARK); if (i >= 0) { hit = [t, i]; break; } }
      if (!hit) break;
      const [node, i] = hit, ch = node.data[i];
      node.deleteData(i, 1);
      if (!node.data.length) { const p = node.parentNode, k = [...p.childNodes].indexOf(node); p.removeChild(node); at[ch] = [p, k]; }
      else at[ch] = [node, i];
    }
    const sel = W.getSelection();
    if (at['⟦'] && at['⟧']) sel.setBaseAndExtent(at['⟦'][0], at['⟦'][1], at['⟧'][0], at['⟧'][1]);
    else if (at['‸']) sel.collapse(at['‸'][0], at['‸'][1]);
    else { const r = W.document.createRange(); r.selectNodeContents(root); r.collapse(false); sel.removeAllRanges(); sel.addRange(r); }
  }
  async function setup(c) {
    E('S.modal = null; S.edPop = null; S.edMore = false; S.mode = "wysiwyg"; UI.view = "notes"; UI.zen = "off"; S.pal = S.pal || {}');
    clearTimeout(W.toast.t); E('S.toast = null');
    E('typeof EDH !== "undefined" && EDH.clear && EDH.clear()');   // editor-made undo history (per note), when the editor keeps one   // a toast from the case before re-renders the page 1.8 s later (FOC-05 tests that on its own)
    if (c.prep) c.prep(H);
    const n = H.n; clearTimeout(n.saveT);
    const html = c.start.trim().startsWith('<');
    if (html) { n.html = c.start; n.md = ''; } else { n.md = c.start; n.html = null; }
    n.docDirty = false; n.dirty = false;
    W.renderAll();
    const doc = H.doc; doc.focus();
    placeMarkers(doc);
    n.html = doc.innerHTML;   // the editor's state, as after an edit: a re-render draws the same thing
    n.md = html ? readMd() : c.start.replace(/[‸⟦⟧]/g, '');
    await sleep(0);   // selectionchange (the toolbar's pressed states) runs here
  }
  function cleanup(c) {
    const n = H.n; clearTimeout(n.saveT); n.dirty = false; n.docDirty = false;
    if (c.post) c.post(H);
  }

  /* ================= Reading the result ================= */
  function readMd() {
    const doc = H.doc, n = H.n;
    if (!doc) return n.md;
    return W.NVMarkdown.htmlToMd(W.typedLinks(doc, n.html));
  }
  const norm = s => String(s ?? '').replace(/ /g, ' ').replace(/\s+$/, '');
  const show = s => JSON.stringify(s);
  // The blocks a reader sees, in order: kind and text. The live editor and the note loaded again from its .md must match.
  // A block is the nearest block element around each run of text (or around a checkbox); empty blocks are left out:
  // an empty line can't be written in Markdown, so it is fine for one to go when the note is reopened.
  const BLOCK_SEL = 'p, h1, h2, h3, h4, h5, h6, li, pre, td, th, blockquote, div, summary, details';
  function sig(root) {
    const blocks = [], seen = new Set();
    const w = W.document.createTreeWalker(root, W.NodeFilter.SHOW_TEXT | W.NodeFilter.SHOW_ELEMENT);
    for (let node = w.nextNode(); node; node = w.nextNode()) {
      if (node.nodeType === 1 && node.tagName === 'HR') { blocks.push({ hr: true }); continue; }
      const isBox = node.nodeType === 1 && node.matches('input[type="checkbox"]');
      if (node.nodeType === 1 && !isBox) continue;
      if (!isBox && !node.data.replace(/[ \s​]+/g, '')) continue;
      const host = node.parentElement;
      if (host.closest('[data-md-ignore], .props, .md-frontmatter, [data-md="tasks"], .attach-cap')) continue;
      let el = host.closest(BLOCK_SEL); if (!el || !root.contains(el) || el === root) el = root;
      if (el !== root && el.matches('p') && el.parentElement.closest('li, td, th, summary') && root.contains(el.parentElement)) el = el.parentElement.closest('li, td, th, summary');
      if (!seen.has(el)) { seen.add(el); blocks.push({ el }); }
    }
    return blocks.map(({ el, hr }) => {
      if (hr) return 'hr';
      let kind = el === root ? 'p' : el.tagName.toLowerCase();
      if (kind === 'div' && !el.matches('.task')) kind = 'p';
      if (kind === 'blockquote') kind = 'quote>p';   // text straight in a <blockquote> looks the same as a quoted <p>
      if (kind === 'li' || (el !== root && el.matches('div.task'))) {
        const box = el.querySelector(':scope > input[type="checkbox"], :scope > p > input[type="checkbox"]');
        let depth = 0; for (let p = el.parentElement; p && p !== root; p = p.parentElement) if (p.tagName === 'LI') depth++;
        kind = (box ? (box.checked ? 'task-x' : 'task') : el.parentElement.tagName.toLowerCase()) + (depth ? '@' + depth : '');
      }
      if (el !== root && el.tagName !== 'BLOCKQUOTE' && el.closest('blockquote')) kind = 'quote>' + kind;
      const alEl = el === root ? null : el.closest('[align]'), al = alEl && root.contains(alEl) ? alEl.getAttribute('align') : null;
      if (al && al !== 'left') kind += '/' + al;
      const copy = el.cloneNode(true); copy.querySelectorAll('ul, ol, [data-md-ignore]' + (el === root ? ', ' + BLOCK_SEL : '')).forEach(x => x.remove());   // data-md-ignore: the editor's own chrome (a code block's head), never saved
      return kind + ':' + copy.textContent.replace(/[ \s]+/g, ' ').replace(/​/g, '').trim();
    }).join(' | ');
  }
  // Saving twice must give the same .md. Lines a fresh Enter leaves behind (a lone "-" or "2.", a blank last code line) are left out
  const settled = md => norm(md).split('\n').filter(l => !/^\s*(?:[-*+]|\d+[.)])\s*$/.test(l)).join('\n').replace(/^```[^\n]*\n\n?```$/gm, '').replace(/\n\n(```)/g, '\n$1').replace(/\n{3,}/g, '\n\n').replace(/\s+$/, '');
  function reloadBox(md) {
    const n = H.n, box = W.document.createElement('div');
    box.innerHTML = W.mdToHtml(Object.assign({}, n, { md, _ltMd: undefined }));
    return box;
  }
  const inDoc = node => !!node && !!H.doc && H.doc.contains(node);
  const describe = el => !el ? 'nothing' : el === W.document.body ? 'the page' : (el.getAttribute?.('aria-label') || el.id || el.className || el.tagName);

  /* ================= Actions ================= */
  const KEYS = {   // the browser's default for a key the app didn't handle: [inputType, editing command]
    'Enter': ['insertParagraph', 'insertParagraph'], 'Shift+Enter': ['insertLineBreak', 'insertLineBreak'],
    'Backspace': ['deleteContentBackward', 'delete'], 'Delete': ['deleteContentForward', 'forwardDelete'],
    'Ctrl+a': [null, 'selectAll'], 'Ctrl+z': ['historyUndo', 'undo'], 'Ctrl+y': ['historyRedo', 'redo'], 'Ctrl+Shift+z': ['historyRedo', 'redo'],
    'Ctrl+b': ['formatBold', 'bold'], 'Ctrl+i': ['formatItalic', 'italic'], 'Ctrl+u': ['formatUnderline', 'underline'],
  };
  const CODES = { Enter: 'Enter', Backspace: 'Backspace', Delete: 'Delete', Tab: 'Tab', ' ': 'Space' };
  async function key(combo) {
    const parts = combo.split('+'), k = parts.pop() || '+', ctrl = parts.includes('Ctrl'), shift = parts.includes('Shift'), alt = parts.includes('Alt');
    const name = (ctrl ? 'Ctrl+' : '') + (shift ? 'Shift+' : '') + (k.length === 1 ? k.toLowerCase() : k);
    const keyVal = k.length === 1 && shift ? k.toUpperCase() : k;
    const target = W.document.activeElement || W.document.body;
    const init = { key: keyVal, code: CODES[k] || (k.length === 1 ? 'Key' + k.toUpperCase() : k), ctrlKey: ctrl, shiftKey: shift, altKey: alt, bubbles: true, cancelable: true, composed: true };
    const down = new W.KeyboardEvent('keydown', init); target.dispatchEvent(down);
    if (!down.defaultPrevented) {
      const ae = W.document.activeElement, host = ae && ae.isContentEditable ? ae.closest('[contenteditable="true"]') || ae : ae;
      if (k === 'Tab' && !ctrl) { ae?.blur?.(); }   // the browser moves focus to the next control
      else {
        const def = KEYS[name] || (k.length === 1 && !ctrl && !alt ? ['insertText', 'insertText', keyVal] : null);
        if (def) {
          let go = true;
          if (def[0] && host) { const bi = new W.InputEvent('beforeinput', { inputType: def[0], data: def[2] ?? null, bubbles: true, cancelable: true, composed: true }); host.dispatchEvent(bi); go = !bi.defaultPrevented; }
          if (go) W.document.execCommand(def[1], false, def[2] ?? null);
        }
      }
    }
    (W.document.activeElement || W.document.body).dispatchEvent(new W.KeyboardEvent('keyup', init));
    await sleep(0);
  }
  async function type(text) { for (const ch of text) await key(ch === '\n' ? 'Enter' : ch); }
  function press(el) {
    if (!el) throw new Error('control not found');
    el.dispatchEvent(new W.MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0 }));
    el.dispatchEvent(new W.MouseEvent('mouseup', { bubbles: true, cancelable: true, button: 0 }));
    el.dispatchEvent(new W.MouseEvent('click', { bubbles: true, cancelable: true, button: 0 }));
  }
  async function fmt(name) {
    const b = W.document.querySelector(`.ed-toolbar [data-fmt="${name}"]`);
    if (!b) throw new Error(`no toolbar button "${name}"`);
    press(b); await sleep(0);
  }
  async function block(v) {   // the Text style list: a click on a <select> takes focus from the note, then the choice fires change
    const s = W.document.querySelector('.ed-toolbar [data-fmt-block]'); if (!s) throw new Error('no Text style list');
    s.focus(); s.value = v; s.dispatchEvent(new W.Event('input', { bubbles: true })); s.dispatchEvent(new W.Event('change', { bubbles: true }));
    await sleep(0);
  }
  async function pop(spec) {   // "code=JavaScript", "hl=yellow", "tc=red", "table=2x3"
    const [p, v] = spec.split('=');
    press(W.document.querySelector(`.ed-toolbar [data-act="ed-pop"][data-v="${p}"]`)); await sleep(0);
    if (p === 'table') { const [r, c] = v.split('x'); press(W.document.querySelector(`[data-act="table-insert"][data-r="${r}"][data-c="${c}"]`)); }
    else press(W.document.querySelector(`[data-act="fmt-${p}"][data-v="${v}"]`));
    await sleep(0);
  }
  async function paste({ text, html, file }) {
    const target = W.document.activeElement || W.document.body, dt = new W.DataTransfer();
    if (text != null) dt.setData('text/plain', text);
    if (html != null) dt.setData('text/html', html);
    if (file) dt.items.add(file);
    const ev = new W.ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true, composed: true });
    target.dispatchEvent(ev);
    if (!ev.defaultPrevented) {
      const host = target.closest?.('[contenteditable="true"]') || target;
      const bi = new W.InputEvent('beforeinput', { inputType: 'insertFromPaste', dataTransfer: dt, bubbles: true, cancelable: true, composed: true });
      host.dispatchEvent(bi);
      const frag = html != null && /<!--StartFragment-->([\s\S]*)<!--EndFragment-->/.exec(html);   // Chromium pastes only the marked fragment of Windows clipboard HTML
      if (!bi.defaultPrevented) { if (html != null) W.document.execCommand('insertHTML', false, frag ? frag[1] : html); else if (text != null) W.document.execCommand('insertText', false, text); }
    }
    await sleep(file ? 250 : 0);   // a pasted image is read with FileReader
  }
  async function clickAct(act, v) { press(W.document.querySelector(`[data-act="${act}"]${v != null ? `[data-v="${v}"]` : ''}`)); await sleep(0); }
  Object.assign(H, { key, type, fmt, block, pop, paste, clickAct, sleep, readMd, press, E: s => E(s) });
  async function step(s) {
    if (typeof s === 'function') return s(H);
    const i = s.indexOf(':'), k = s.slice(0, i), v = s.slice(i + 1);
    if (k === 'fmt') return fmt(v); if (k === 'key') return key(v); if (k === 'type') return type(v);
    if (k === 'block') return block(v); if (k === 'pop') return pop(v);
    throw new Error('unknown step ' + s);
  }
  const run = async c => { for (const s of [].concat(c.act || [])) await step(s); await sleep(c.wait || 20); };

  /* ================= Checks ================= */
  function want(label, got, w, problems) {
    if (w === undefined) return;
    if (typeof w === 'function') { const p = w(got, H); if (p) problems.push(`${label}: ${p} (got ${show(got)})`); return; }
    if (w instanceof RegExp) { if (!w.test(got)) problems.push(`${label}: wanted to match ${w}, got ${show(got)}`); return; }
    if (norm(got) !== norm(w)) problems.push(`${label}: wanted ${show(norm(w))}, got ${show(norm(got))}`);
  }
  function generic(c, md0, md1, problems) {
    const doc = H.doc, n = H.n;
    if (c.generic === false) return;
    if (!doc) { problems.push('the editor is gone'); return; }
    if (c.focus !== false) {
      const ae = W.document.activeElement;
      if (!(ae === doc || inDoc(ae))) problems.push(`focus left the editor (now on ${describe(ae)})`);
      const sel = W.getSelection();
      if (!sel.rangeCount || !inDoc(sel.anchorNode)) problems.push('the caret is not in the editor any more');
    }
    if (norm(md1) !== norm(md0) && c.dirty !== false && !(n.docDirty || n.dirty || n.saving || norm(n.md) === norm(md1))) problems.push('the note changed but isn\'t marked for saving (it would be lost)');
    const bad = doc.querySelector('p :is(p, div, ul, ol, h1, h2, h3, h4, h5, h6, pre, blockquote, table, hr, details)');
    if (bad) problems.push(`a <${bad.tagName.toLowerCase()}> sits inside a <p> (invalid HTML: ${show(bad.parentElement.outerHTML.slice(0, 120))})`);
    if (c.reload !== false) {
      const box = reloadBox(md1), a = sig(doc), b = sig(box), md2 = W.NVMarkdown.htmlToMd(box);
      if (a !== b) problems.push(`reopening the saved note shows something else: editor ${show(a)} → reopened ${show(b)}`);
      if (settled(md2) !== settled(md1)) problems.push(`saving it again changes it: ${show(norm(md1))} → ${show(norm(md2))}`);
    }
  }

  /* ================= Runner ================= */
  const results = [];
  function record(c, id, name, problems, extra) {
    const status = extra || (problems.length ? (c.notBuilt ? 'NOT BUILT' : 'FAIL') : 'PASS');
    results.push({ id, area: c.area, name, status, problems });
    paint();
  }
  async function runCase(c) {
    if (c.live && !live) { record(c, c.id, c.name, ['needs the dev bridge (a live vault)'], 'SKIP'); return; }
    const problems = [];
    let md0 = '', md1 = '';
    try {
      await setup(c); md0 = readMd();
      await run(c); md1 = readMd();
      want('saved .md', md1, c.want, problems);
      if (c.dom) { const p = await c.dom(H.doc, H); if (p) problems.push(p); }
      if (c.sel !== undefined) { const s = norm(W.getSelection().toString()); if (s !== c.sel) problems.push(`selection: wanted ${show(c.sel)} still selected, got ${show(s)}`); }
      generic(c, md0, md1, problems);
      if (c.probe !== undefined) {
        await type(c.probe); await sleep(10);
        want(`then typing ${show(c.probe)}`, readMd(), c.wantTyped, problems);
        if (c.domTyped) { const p = c.domTyped(H.doc, H); if (p) problems.push(p); }
      }
    } catch (e) { problems.push('threw ' + (e && e.stack || e)); }
    cleanup(c);
    record(c, c.id, c.name, problems);
    if (c.undo === false || problems.some(p => p.startsWith('threw')) || norm(md1) === norm(md0)) return;
    const up = [];
    try {
      await setup(c); const s0 = readMd(); await run(c); const s1 = readMd();
      if (!H.doc?.contains(W.document.activeElement)) H.doc?.focus();   // undo needs the editor focused; a focus problem is reported above
      await key('Ctrl+z'); await sleep(10); const u = readMd();
      if (norm(u) !== norm(s0)) up.push(`Ctrl+Z: wanted the start back ${show(norm(s0))}, got ${show(norm(u))}`);
      await key('Ctrl+y'); await sleep(10); const r = readMd();
      if (norm(r) !== norm(s1)) up.push(`Ctrl+Y: wanted the result again ${show(norm(s1))}, got ${show(norm(r))}`);
      await key('Ctrl+z'); await key('Ctrl+Shift+z'); await sleep(10); const r2 = readMd();
      if (norm(r2) !== norm(s1)) up.push(`Ctrl+Shift+Z: wanted the result again ${show(norm(s1))}, got ${show(norm(r2))}`);
    } catch (e) { up.push('threw ' + (e && e.stack || e)); }
    cleanup(c);
    record(c, c.id + 'u', c.name + ' · undo / redo', up);
  }
  function paint(done) {
    const k = s => results.filter(r => r.status === s).length;
    const lines = results.map(r => `${r.status.padEnd(9)} ${r.id.padEnd(9)} [${r.area}] ${r.name}${r.problems.length && r.status !== 'PASS' ? '\n            ' + r.problems.join('\n            ') : ''}`);
    const counted = results.filter(r => r.status === 'PASS' || r.status === 'FAIL');
    const total = `${done ? 'Done' : 'Running'}: ${counted.length} cases counted, ${k('PASS')} pass, ${k('FAIL')} fail · ${k('NOT BUILT')} not built (Markdown shortcuts, the inline code button) · ${k('SKIP')} skipped${live ? '' : ' (no dev bridge: the sample vault)'}`;
    REPORT.textContent = total + '\n\n' + lines.join('\n') + (done ? '\n\n' + total : '');
    if (done) document.title = `Editor behaviour: ${k('FAIL') ? 'FAIL ' + k('FAIL') : 'PASS ' + k('PASS')}/${counted.length}`;
  }

  /* ================= The cases (ids match design/editor-behaviour.md) ================= */
  const C = [];
  const T = (id, area, name, start, act, w, more) => C.push(Object.assign({ id, area, name, start, act, want: w }, more || {}));
  const pressed = f => doc => { const b = W.document.querySelector(`.ed-toolbar [data-fmt="${f}"]`); return b?.getAttribute('aria-pressed') === 'true' ? '' : `the ${f} button doesn't show as on (aria-pressed=${b?.getAttribute('aria-pressed')})`; };
  const noText = s => doc => doc.textContent.includes(s) ? `placeholder text ${show(s)} was inserted` : '';
  const all = (...fs) => (doc, h) => fs.map(f => f(doc, h)).filter(Boolean).join('; ');
  const boxes = k => doc => { const m = doc.querySelectorAll('input[type="checkbox"]').length; return m === k ? '' : `wanted ${k} checkbox${k === 1 ? '' : 'es'}, found ${m}`; };
  const EMPTY_LINE = '<p>Before</p><p>‸<br></p>';

  // ---- Task button (E-1, E-2) ----
  T('TASK-01', 'Task button', 'empty line: a checkbox, no "New task", caret after it', EMPTY_LINE, 'fmt:task', 'Before\n\n- [ ]', { dom: all(noText('New task'), boxes(1)), probe: 'Z', wantTyped: 'Before\n\n- [ ] Z' });
  T('TASK-02', 'Task button', 'caret mid-line: the line becomes a task, text kept, caret stays', 'alpha be‸ta', 'fmt:task', '- [ ] alpha beta', { dom: noText('New task'), probe: 'Z', wantTyped: '- [ ] alpha beZta' });
  T('TASK-03', 'Task button', 'caret at the end of a line', 'alpha beta‸', 'fmt:task', '- [ ] alpha beta', { probe: 'Z', wantTyped: '- [ ] alpha betaZ' });
  T('TASK-04', 'Task button', 'selection inside one line: the line becomes a task, the text stays (and stays selected)', 'alpha ⟦beta⟧ gamma', 'fmt:task', '- [ ] alpha beta gamma', { sel: 'beta' });
  T('TASK-05', 'Task button', 'selection across three paragraphs: each becomes a task', 'one ⟦two\n\nthree\n\nfo⟧ur', 'fmt:task', '- [ ] one two\n- [ ] three\n- [ ] four');
  T('TASK-06', 'Task button', 'in a bullet item: that item becomes a task in the same list', '- a\n- b‸\n- c', 'fmt:task', '- a\n- [ ] b\n- c');
  T('TASK-07', 'Task button', 'on a task: turns it back into plain text (toggle)', '- [ ] buy‸ milk', 'fmt:task', 'buy milk', { dom: boxes(0) });
  T('TASK-08', 'Task button', 'whole note selected (Ctrl+A): every line becomes a task', 'one\n\ntwo‸', ['key:Ctrl+a', 'fmt:task'], '- [ ] one\n- [ ] two');
  T('TASK-09', 'Task button', 'inside a code block: nothing changes (code stays code)', '```\ncode‸ line\n```', 'fmt:task', '```\ncode line\n```', { dom: boxes(0) });
  T('TASK-10', 'Task button', 'in a quote: the line becomes a task inside the quote', '> quo‸ted', 'fmt:task', '> - [ ] quoted');
  T('TASK-11', 'Task button', 'empty line, type, Enter, type: two tasks', EMPTY_LINE, ['fmt:task', 'type:One', 'key:Enter', 'type:Two'], 'Before\n\n- [ ] One\n- [ ] Two', { undo: false });
  T('TASK-12', 'Task button', 'caret in a task: the Task button shows as on', '- [ ] a‸', [], undefined, { dom: pressed('task'), undo: false });
  T('TASK-13', 'Task button', 'after inserting a task: the Task button shows as on', EMPTY_LINE, ['fmt:task', h => h.sleep(10)], undefined, { dom: pressed('task') });

  // ---- Inline formats: selection, caret, across paragraphs, toggle off ----
  const INLINE = [['bold', x => `**${x}**`], ['italic', x => `*${x}*`], ['strike', x => `~~${x}~~`], ['underline', x => `<u>${x}</u>`],
    ['code', x => `\`${x}\``, true], ['sup', x => `<sup>${x}</sup>`], ['sub', x => `<sub>${x}</sub>`]];
  // Inline code has no toolbar button (doFormat('code') exists, nothing calls it): reported as NOT BUILT
  INLINE.forEach(([f, w, nb], i) => {
    const id = k => `INL-${String(i * 4 + k).padStart(2, '0')}`, more = o => Object.assign(nb ? { notBuilt: true, undo: false } : {}, o);
    T(id(1), 'Inline: ' + f, 'selection inside one line: wraps it, keeps it selected', 'alpha ⟦beta⟧', 'fmt:' + f, `alpha ${w('beta')}`, more({ sel: 'beta' }));
    T(id(2), 'Inline: ' + f, 'caret only: nothing inserted; what you type next has the style', 'alpha‸', 'fmt:' + f, 'alpha', more({ probe: 'Z', wantTyped: `alpha${w('Z')}` }));
    T(id(3), 'Inline: ' + f, 'selection across two paragraphs: both styled, still two paragraphs', '⟦one\n\ntwo⟧', 'fmt:' + f, `${w('one')}\n\n${w('two')}`, more());
    T(id(4), 'Inline: ' + f, 'click again on styled text: the style comes off', `alpha ${w('⟦beta⟧')}`, 'fmt:' + f, 'alpha beta', more());
  });
  T('INL-29', 'Inline: highlight', 'selection: highlighted, kept selected', 'alpha ⟦beta⟧', 'pop:hl=yellow', 'alpha <mark class="hl-yellow">beta</mark>', { sel: 'beta' });
  T('INL-30', 'Inline: highlight', 'caret only: no placeholder; typing is highlighted', 'alpha‸', 'pop:hl=yellow', 'alpha', { probe: 'Z', wantTyped: 'alpha<mark class="hl-yellow">Z</mark>' });
  T('INL-31', 'Inline: highlight', 'across two paragraphs: both highlighted, still two paragraphs', '⟦one\n\ntwo⟧', 'pop:hl=yellow', '<mark class="hl-yellow">one</mark>\n\n<mark class="hl-yellow">two</mark>');
  T('INL-32', 'Inline: highlight', 'Remove highlight on highlighted text', 'alpha <mark class="hl-yellow">⟦beta⟧</mark>', 'pop:hl=none', 'alpha beta');
  T('INL-33', 'Inline: text colour', 'selection: coloured, kept selected', 'alpha ⟦beta⟧', 'pop:tc=red', 'alpha <span class="tc-red">beta</span>', { sel: 'beta' });
  T('INL-34', 'Inline: text colour', 'caret only: no placeholder; typing is coloured', 'alpha‸', 'pop:tc=red', 'alpha', { probe: 'Z', wantTyped: 'alpha<span class="tc-red">Z</span>' });
  T('INL-35', 'Inline: text colour', 'across two paragraphs: both coloured, still two paragraphs', '⟦one\n\ntwo⟧', 'pop:tc=red', '<span class="tc-red">one</span>\n\n<span class="tc-red">two</span>');
  T('INL-36', 'Inline: shortcuts', 'Ctrl+B on a selection', 'alpha ⟦beta⟧', 'key:Ctrl+b', 'alpha **beta**', { sel: 'beta' });
  T('INL-37', 'Inline: shortcuts', 'Ctrl+I on a selection', 'alpha ⟦beta⟧', 'key:Ctrl+i', 'alpha *beta*', { sel: 'beta' });
  T('INL-38', 'Inline: shortcuts', 'Ctrl+U on a selection', 'alpha ⟦beta⟧', 'key:Ctrl+u', 'alpha <u>beta</u>', { sel: 'beta' });
  T('INL-39', 'Inline: shortcuts', 'Ctrl+B with a caret, then type', 'alpha‸', 'key:Ctrl+b', 'alpha', { probe: 'Z', wantTyped: 'alpha**Z**' });
  T('INL-40', 'Inline: bold', 'selection inside a heading', '# alpha ⟦beta⟧', 'fmt:bold', '# alpha **beta**');
  T('INL-41', 'Inline: bold', 'selection inside a list item', '- alpha ⟦beta⟧', 'fmt:bold', '- alpha **beta**');
  T('INL-42', 'Inline: bold', 'caret in bold text: the Bold button shows as on', 'alpha **be‸ta**', [], undefined, { dom: pressed('bold'), undo: false });

  // ---- Block formats ----
  T('BLK-01', 'Block: heading', 'Heading 1 with the caret in a paragraph; caret stays', 'alpha‸', 'block:h1', '# alpha', { probe: 'Z', wantTyped: '# alphaZ' });
  T('BLK-02', 'Block: heading', 'Heading 2 across two paragraphs: each becomes a heading', '⟦one\n\ntwo⟧', 'block:h2', '## one\n\n## two');
  T('BLK-03', 'Block: heading', 'Text on a heading: back to a paragraph', '### Title‸', 'block:p', 'Title');
  T('BLK-04', 'Block: heading', 'Heading 1 on an empty line, then type', EMPTY_LINE, 'block:h1', 'Before', { probe: 'Z', wantTyped: 'Before\n\n# Z', undo: false });
  T('BLK-05', 'Block: heading', 'Heading 6', 'alpha‸', 'block:h6', '###### alpha');
  T('BLK-06', 'Block: heading', 'caret in a Heading 2: the Text style list says Heading 2', '## Sec‸tion', [], undefined, { dom: () => { const v = W.document.querySelector('[data-fmt-block]')?.value; return v === 'h2' ? '' : `the list says ${show(v)}`; }, undo: false });
  T('BLK-07', 'Block: quote', 'Quote with the caret in a paragraph', 'alpha‸', 'fmt:quote', '> alpha', { probe: 'Z', wantTyped: '> alphaZ' });
  T('BLK-08', 'Block: quote', 'Quote on a quote: back to a paragraph (toggle)', '> alpha‸', 'fmt:quote', 'alpha');
  T('BLK-09', 'Block: quote', 'Quote across two paragraphs: one quote, two paragraphs', '⟦one\n\ntwo⟧', 'fmt:quote', '> one\n>\n> two');
  T('BLK-10', 'Block: quote', 'Quote from the Text style list', 'alpha‸', 'block:blockquote', '> alpha');
  T('BLK-11', 'Block: bullets', 'Bullet list with the caret in a paragraph; caret stays', 'alpha‸', 'fmt:ul', '- alpha', { probe: 'Z', wantTyped: '- alphaZ' });
  T('BLK-12', 'Block: bullets', 'Bullet list on an empty line, then type', EMPTY_LINE, 'fmt:ul', undefined, { probe: 'Z', wantTyped: 'Before\n\n- Z' });
  T('BLK-13', 'Block: bullets', 'Bullet list on a bullet: back to a paragraph (toggle)', '- alpha‸', 'fmt:ul', 'alpha');
  T('BLK-14', 'Block: bullets', 'Bullet list across three paragraphs', '⟦one\n\ntwo\n\nthree⟧', 'fmt:ul', '- one\n- two\n- three');
  T('BLK-15', 'Block: numbers', 'Numbered list with the caret in a paragraph', 'alpha‸', 'fmt:ol', '1. alpha');
  T('BLK-16', 'Block: numbers', 'Numbered list across two paragraphs', '⟦one\n\ntwo⟧', 'fmt:ol', '1. one\n2. two');
  T('BLK-17', 'Block: numbers', 'Numbered list on a bullet list: the list switches type', '- a‸\n- b', 'fmt:ol', '1. a\n2. b');
  T('BLK-18', 'Block: bullets', 'Bullet list on a numbered list: the list switches type', '1. a‸\n2. b', 'fmt:ul', '- a\n- b');
  T('BLK-19', 'Block: bullets', 'Bullet list on a task: the checkbox goes, the text stays', '- [ ] a‸', 'fmt:ul', '- a', { dom: boxes(0) });
  T('BLK-20', 'Block: bullets', 'Bullet list on the whole note (Ctrl+A)', 'one\n\ntwo', ['key:Ctrl+a', 'fmt:ul'], '- one\n- two');
  T('BLK-21', 'Block: bullets', 'caret in a bullet: the Bullet list button shows as on', '- al‸pha', [], undefined, { dom: pressed('ul'), undo: false });
  T('BLK-22', 'Block: code block', 'Code block on an empty line: no placeholder, caret inside', EMPTY_LINE, 'pop:code=JavaScript', /^Before\n\n```javascript\n\n?```$/, { dom: noText('// your code'), probe: 'Z', wantTyped: 'Before\n\n```javascript\nZ\n```' });
  T('BLK-23', 'Block: code block', 'Code block on two selected lines: one block with both lines', '⟦let a = 1;\n\nlet b = 2;⟧', 'pop:code=JavaScript', '```javascript\nlet a = 1;\nlet b = 2;\n```');
  T('BLK-24', 'Block: code block', 'Code block with the caret in a paragraph: that line becomes code, in place', 'first\n\nalpha‸\n\nlast', 'pop:code=Python', 'first\n\n```python\nalpha\n```\n\nlast');
  /* Build V · photos in notes (mockup R59): a caption is the italic line under the embed; pins are a hidden comment with their
     places, then a numbered list (their notes). The photo's bar adds a caption or a pin; a pin's menu removes it; the setting hides them. */
  const PHF = 'attachments/paste-20261014-101233.png', PHE = `![[${PHF}]]`;
  const phPrep = () => E(`PLAYER.urls['${PHF}'] = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="400" height="200"><rect width="400" height="200" fill="#9ab"/></svg>'); PH.mode = 'both'; PH.sel = null; PH.pinning = null; PH.menu = null; D.atts = (D.atts || []).filter(a => !a.file.includes(' (edited')); if (!D.atts.some(a => a.file === '${PHF}')) D.atts.push({ file: '${PHF}', name: 'paste-20261014-101233.png', kind: 'image', size: 2048, mtime: '2026-10-14T10:12:33' }); PHE.edits = []; PHE.crop = null; PHE.ed = null; PHE.sample = true`);
  const phBox = () => W.document.querySelector(`.doc .att-img[data-embed-for="${PHF}"]`) || W.document.querySelector('.doc .att-img');   // (or its edited copy)
  const phDown = (el, x, y) => { const b = el.getBoundingClientRect(); mouse(el, 'mousedown', { button: 0, clientX: b.left + b.width * x, clientY: b.top + b.height * y }); mouse(el, 'mouseup', { button: 0, clientX: b.left + b.width * x, clientY: b.top + b.height * y }); };
  const phPick = async h => { await h.sleep(30); const box = phBox(); if (!box) throw new Error('no photo drawn'); phDown(box.querySelector('img'), .9, .9); await h.sleep(10); };
  const phBtn = which => async h => { const b = W.document.querySelector(`.doc .ph-bar [data-ph="${which}"]`); if (!b) throw new Error('no bar button ' + which); h.press(b); await h.sleep(10); };
  const PINS2 = `${PHE}\n\n<!-- nv-pins 25.0,40.0 75.0,60.0 -->\n\n1. The token\n2. The refresh path`;
  T('PH-01', 'Photos', 'a caption: the italic line under the photo is drawn as its caption and saves as written', `Before\n\n${PHE}\n*Tuesday’s whiteboard*`, [h => h.sleep(30)], `Before\n\n${PHE}\n*Tuesday’s whiteboard*`,
    { undo: false, focus: false, prep: phPrep, dom: d => { const p = d.querySelector('p.ph-cap-p'); return !phBox() ? 'no photo' : !p ? 'no caption paragraph' : p.querySelector('.ph-cap')?.textContent !== 'Tuesday’s whiteboard' ? `caption ${show(p.textContent)}` : W.getComputedStyle(p.querySelector('.ph-hide')).display !== 'none' ? 'the embed line shows' : ''; } });
  T('PH-02', 'Photos', 'typing in the caption edits it in place', `${PHE}\n*A cap‸*`, 'type:tion', `${PHE}\n*A caption*`, { prep: phPrep });
  T('PH-03', 'Photos', 'the bar’s Add a caption: a caption line under the photo, typed over', `Intro‸\n\n${PHE}`, [phPick, phBtn('caption'), 'type:Whiteboard'], `Intro\n\n${PHE}\n*Whiteboard*`, { prep: phPrep, focus: false });
  T('PH-04', 'Photos', 'emptying the caption takes it away: the plain photo line is left', `${PHE}\n*x‸*`, 'key:Backspace', PHE, { prep: phPrep, focus: false });
  T('PH-05', 'Photos', 'Add a pin, click the photo: pin 1 there, its note typed as item 1', `Intro‸\n\n${PHE}`,
    [phPick, phBtn('pin'), async h => { phDown(phBox().querySelector('img'), .5, .5); await h.sleep(10); }, 'type:Token'],
    md => { const m = md.match(/^Intro\n\n!\[\[attachments\/paste-20261014-101233\.png\]\]\n\n<!-- nv-pins (\d+\.\d),(\d+\.\d) -->\n\n1\. Token$/); return m && Math.abs(m[1] - 50) < 1 && Math.abs(m[2] - 50) < 1 ? '' : 'not one pin at the middle with its note'; },   // MouseEvent rounds the click to whole pixels
    { prep: phPrep, focus: false, dom: () => W.document.querySelectorAll('.doc .ph-pin').length === 1 ? '' : 'no pin drawn' });
  T('PH-06', 'Photos', 'pins from the .md: drawn where they were, the list is their notes; saved unchanged', PINS2, [h => h.sleep(30)], PINS2,
    { undo: false, focus: false, prep: phPrep, dom: d => { const pins = [...d.querySelectorAll('.ph-pin')]; return pins.length !== 2 ? `${pins.length} pins` : pins[0].style.left !== '25%' || pins[1].style.top !== '60%' ? 'pins in the wrong place' : !d.querySelector('ol.ph-pinlist') ? 'the list isn’t marked as the pins’ notes' : ''; } });
  T('PH-07', 'Photos', 'a pin’s menu → Remove: the pin and its note go, the next one becomes 1', PINS2,
    [async h => { await h.sleep(30); phDown(phBox().querySelector('[data-ph-pin="0"]'), .5, .5); await h.sleep(10); const b = W.document.querySelector('.ph-pinmenu [data-ph-menu="remove"]'); if (!b) throw new Error('no pin menu'); h.press(b); await h.sleep(10); }],
    `${PHE}\n\n<!-- nv-pins 75.0,60.0 -->\n\n1. The refresh path`, { prep: phPrep, focus: false });
  T('PH-08', 'Photos', 'the setting “Neither”: no pins drawn, the caption a plain italic line; the note keeps both', `${PHE}\n*Cap*\n\n<!-- nv-pins 25.0,40.0 -->\n\n1. One`, [h => h.sleep(30)], `${PHE}\n*Cap*\n\n<!-- nv-pins 25.0,40.0 -->\n\n1. One`,
    { undo: false, focus: false, prep: () => { phPrep(); E("PH.mode = 'off'"); }, post: () => E("PH.mode = 'both'"), dom: d => d.querySelector('.ph-pin') ? 'pins drawn' : !d.querySelector('p.ph-cap-p.is-plain') ? 'the caption isn’t plain' : '' });
  // Build V · R59 editing photos: always a copy beside the original; the note shows the copy (QC 100: no tag under it, one copy)
  const PHC = 'attachments/paste-20261014-101233 (edited).png';
  const phCopy = () => W.document.querySelector(`.doc img[data-att-img="${PHC}"]`);
  const phWait = async (h, test, ms = 3000) => { for (let t = 0; t < ms && !test(); t += 30) await h.sleep(30); };
  T('PH-09', 'Photos', 'the bar’s Rotate right: a copy is saved and the note shows it; the original is kept', `${PHE}`, [phPick, phBtn('rotate'), h => phWait(h, phCopy)], `![[${PHC}]]`,
    { undo: false, focus: false, prep: phPrep, dom: d => { return d.querySelector('.phe-tag, [data-phe="orig"]') ? 'QC 100: the “Edited copy” tag is back' : !E(`(D.atts || []).some(a => a.file === '${PHF}')`) ? 'the original went' : !/^data:image\/png/.test(E(`PLAYER.urls['${PHC}']`) || '') ? 'the copy isn’t a PNG' : ''; } });
  T('PH-10', 'Photos', 'QC 100: editing the edited copy re-uses the one “(edited)” copy, made from the original; Restore shows the original', `${PHE}`,
    [phPick, phBtn('flip'), h => phWait(h, phCopy), phPick, phBtn('rotate'), h => phWait(h, () => E('PHE.edits.length') === 2),
      async h => { if (E(`(D.atts || []).filter(a => a.file.includes(' (edited')).map(a => a.file).join('|')`) !== PHC) throw new Error(`copies: ${E(`(D.atts || []).map(a => a.file).join(', ')`)}`);
        if (E(`PHE.edits.map(e => e.from).join('|')`) !== `${PHF}|${PHF}`) throw new Error('an edit isn’t from the original');
        E('pheRestore(PHE.edits[0].id)'); await phWait(h, () => W.document.querySelector(`.doc img[data-att-img="${PHF}"]`)); }],
    PHE, { undo: false, focus: false, prep: phPrep });
  T('PH-11', 'Photos', 'Crop: 8 handles; Done with nothing cropped saves nothing; a corner dragged in saves the cropped copy', `${PHE}`,
    [phPick, phBtn('crop'), async h => { const hs = W.document.querySelectorAll('.doc .phe-h'); if (hs.length !== 8) throw new Error(`${hs.length} handles`); h.press(W.document.querySelector('.doc .ph-bar [data-ph="crop-done"]')); await h.sleep(20); },
      phPick, phBtn('crop'), async h => { const nw = W.document.querySelector('.doc .phe-h--nw'), r = phBox().querySelector('img').getBoundingClientRect(); mouse(nw, 'mousedown', { button: 0 }); mouse(W.document, 'mousemove', { buttons: 1, clientX: r.left + r.width * .3, clientY: r.top + r.height * .3 }); mouse(W.document, 'mouseup', {}); await h.sleep(10);
        h.press(W.document.querySelector('.doc .ph-bar [data-ph="crop-done"]')); await phWait(h, phCopy); }],
    `![[${PHC}]]`, { undo: false, focus: false, prep: phPrep, dom: () => new Promise(res => { const im = new W.Image(); im.onload = () => res(im.naturalWidth < 400 && im.naturalHeight < 200 ? '' : `the copy is ${im.naturalWidth}×${im.naturalHeight}`); im.onerror = () => res('the copy doesn’t load'); im.src = E(`PLAYER.urls['${PHC}']`); }) });
  T('PH-12', 'Photos', 'Mark up…: the window (8 tools, 3 colours, “the original stays”), an arrow drawn, Save a copy', `${PHE}`,
    [phPick, phBtn('markup'), h => phWait(h, () => W.document.querySelector('.phe-ed canvas')),
      async h => { const ed = W.document.querySelector('.phe-ed'); if (ed.querySelectorAll('[data-phe-tool]').length !== 8 || ed.querySelectorAll('[data-phe-colour]').length !== 3 || !/original stays as it was/.test(ed.textContent) || !ed.querySelector('[data-phe-ed="save"]').disabled) throw new Error('the window isn’t as drawn');
        const cv = ed.querySelector('canvas'), r = cv.getBoundingClientRect(); mouse(cv, 'mousedown', { button: 0, clientX: r.left + 20, clientY: r.top + 20 }); mouse(W.document, 'mousemove', { buttons: 1, clientX: r.left + r.width * .6, clientY: r.top + r.height * .6 }); mouse(W.document, 'mouseup', {}); await h.sleep(20);
        const save = W.document.querySelector('.phe-ed [data-phe-ed="save"]'); if (save.disabled) throw new Error('Save stays off after drawing'); h.press(save); await phWait(h, () => !W.document.querySelector('.phe-ed') && phCopy()); }],
    `![[${PHC}]]`, { undo: false, focus: false, prep: phPrep });
  T('PH-13', 'Photos', 'Mark up… then Esc: the window closes and nothing is saved', `${PHE}`,
    [phPick, phBtn('markup'), h => phWait(h, () => W.document.querySelector('.phe-ed canvas')), async h => { W.document.querySelector('.phe-ed [data-phe-tool="box"]').click(); await h.sleep(10); W.document.dispatchEvent(new W.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })); await h.sleep(20); }],
    PHE, { undo: false, focus: false, prep: phPrep, dom: () => W.document.querySelector('.phe-ed') ? 'the window is still open' : '' });
  /* Build V · code blocks like VS Code (mockup R57): Tab, Enter, pairs that close themselves, the language picker, Copy, the
     colours, line numbers, the outlined pair and the light check. The head and numbers are never saved (data-md-ignore). */
  const cbPre = () => W.document.querySelector('.doc pre.cb');
  T('CB-01', 'Code block', 'Tab indents (2 spaces in JavaScript)', '```js\nif (a) {\n‸\n}\n```', 'key:Tab', undefined, { probe: 'x', wantTyped: '```js\nif (a) {\n  x\n}\n```' });
  T('CB-02', 'Code block', 'Shift+Tab takes the indent off the line', '```js\n    x‸\n```', 'key:Shift+Tab', '```js\nx\n```');
  T('CB-03', 'Code block', 'Enter keeps the line’s indent', '```python\nif a:\n    b‸\n```', 'key:Enter', undefined, { probe: 'c', wantTyped: '```python\nif a:\n    b\n    c\n```' });
  T('CB-04', 'Code block', 'Enter after a colon in Python indents the next line (4 spaces)', '```python\nif a:‸\n```', 'key:Enter', undefined, { probe: 'b', wantTyped: '```python\nif a:\n    b\n```' });
  T('CB-05', 'Code block', 'Enter between { and }: the pair opens onto its own lines, the caret indented between them', '```js\nif (a) {‸}\n```', 'key:Enter', undefined, { probe: 'x', wantTyped: '```js\nif (a) {\n  x\n}\n```' });
  T('CB-06', 'Code block', 'a ( closes itself; typing on goes between', '```js\nf‸\n```', 'type:(', '```js\nf()\n```', { probe: 'x', wantTyped: '```js\nf(x)\n```' });
  T('CB-07', 'Code block', 'typing the closing bracket steps over the one already there', '```js\nf‸\n```', 'type:(x)', '```js\nf(x)\n```');
  T('CB-08', 'Code block', 'quotes close themselves; an apostrophe in a word stays one', '```js\nx = ‸\n```', "type:'a' // don't", "```js\nx = 'a' // don't\n```");
  T('CB-09', 'Code block', 'Backspace in an empty pair takes both', '```js\nf(‸)\n```', 'key:Backspace', '```js\nf\n```');
  T('CB-10', 'Code block', 'a selection typed over with ( is wrapped in the pair', '```js\nlet ⟦a + b⟧\n```', 'type:(', '```js\nlet (a + b)\n```');
  T('CB-11', 'Code block', 'the language picker: Python, and the fence follows', '```js\nlet a‸\n```',
    async h => { h.press(cbPre().querySelector('.cb-lang')); await h.sleep(10); const b = W.document.querySelector('.cb-langmenu [data-cb-pick="Python"]'); if (!b) throw new Error('no language menu'); h.press(b); await h.sleep(10); },
    '```python\nlet a\n```', { dom: () => { const m = W.document.querySelectorAll('.cb-langmenu').length, l = cbPre()?.querySelector('.cb-lang')?.dataset.label; return m ? 'the menu is still open' : l !== 'Python' ? `the head says ${l}` : ''; } });
  T('CB-12', 'Code block', 'the language menu lists the 10 languages, the current one ticked', '```ts\nlet a‸\n```',
    async h => { h.press(cbPre().querySelector('.cb-lang')); await h.sleep(10); }, undefined,
    { undo: false, focus: false, post: () => E('cbMenuClose()'), dom: () => { const it = [...W.document.querySelectorAll('.cb-langmenu .menu-item')], on = it.filter(x => x.getAttribute('aria-checked') === 'true').map(x => x.textContent.trim());
      return it.length !== 10 ? `${it.length} languages` : on.join() !== 'TypeScript' ? `ticked: ${on}` : ''; } });
  T('CB-13', 'Code block', 'Copy takes the code without the line numbers; the note doesn’t change', '```js\nconst a = 1;\nlet b‸ = 2;\n```',
    async h => { h.press(cbPre().querySelector('.cb-copy')); await h.sleep(10); }, '```js\nconst a = 1;\nlet b = 2;\n```',
    { undo: false, focus: false, prep: () => E('window.__tbNoClipboard = true; CB.copied = null'), dom: () => E('CB.copied') === 'const a = 1;\nlet b = 2;' ? '' : `copied ${show(E('CB.copied'))}` });
  T('CB-14', 'Code block', 'colours: a keyword, a string and a number are their own colours', '```js\nconst a = "x" + 1;‸\n```', [], undefined,
    { undo: false, dom: () => { const c = cbPre(), cs = sel => c?.querySelector(sel) && W.getComputedStyle(c.querySelector(sel)).color, kw = cs('.hljs-keyword'), st = cs('.hljs-string'), nu = cs('.hljs-number'), tx = W.getComputedStyle(c.querySelector('code')).color;
      return !kw || !st || !nu ? 'not coloured' : new Set([kw, st, nu, tx]).size < 4 ? `colours ${kw} / ${st} / ${nu} / ${tx}` : ''; } });
  T('CB-15', 'Code block', 'line numbers down the side (a setting): one per line, none when it’s off', '```js\na\nb‸\nc\n```', [], undefined,
    { undo: false, dom: () => { const g = cbPre()?.querySelector('.cb-gut'); if (g?.dataset.nums !== '1\n2\n3') return `numbers ${show(g?.dataset.nums)}`;
      E('S.a11y.codeNums = false; cbAll()'); const off = cbPre()?.querySelector('.cb-gut'); E('S.a11y.codeNums = true; cbAll()'); return off ? 'still numbered with the setting off' : ''; } });
  T('CB-16', 'Code block', 'the caret by a bracket: the pair is outlined, and the hint shows', '```js\nf(x‸)\n```', [h => h.sleep(30)], undefined,
    { undo: false, dom: () => { const p = cbPre(); return p?.querySelectorAll('.cb-match').length !== 2 ? `${p?.querySelectorAll('.cb-match').length} outlined` : !p.classList.contains('is-editing') ? 'no hint' : ''; } });
  T('CB-17', 'Code block', 'the light check: a quote left open is underlined, "1 problem" in the head', "```js\nconst a = 'x;‸\n```", [h => h.sleep(10)], undefined,
    { undo: false, dom: () => { const p = cbPre(), n = p?.querySelector('.cb-note')?.dataset.label || ''; return !/^1 problem: a quote is left open on line 1/.test(n) ? `head: ${show(n)}` : !p.querySelector('.cb-issue') ? 'no underline' : ''; } });
  T('CB-18', 'Code block', 'closing the quote clears the problem', "```js\nconst a = 'x‸;\n```", "type:'", "```js\nconst a = 'x';\n```", { dom: () => cbPre()?.querySelector('.cb-note, .cb-issue') ? 'the problem is still shown' : '' });
  T('CB-19', 'Code block', 'Tab on two selected lines indents both; Shift+Tab takes it back', '```js\n⟦a\nb⟧\n```', ['key:Tab', 'key:Shift+Tab', 'key:Tab'], '```js\n  a\n  b\n```');
  T('CB-20', 'Code block', 'opening a note with code and saving it changes nothing (the head and numbers aren’t saved)', '```python\ndef f():\n    return {"a": [1, 2]}\n```\n\nAfter.', [], '```python\ndef f():\n    return {"a": [1, 2]}\n```\n\nAfter.', { undo: false, focus: false });
  T('CB-21', 'Code block', 'QC 104: “2 problems” opens every problem with its line; a pick puts the caret there; a dot in the gutter by each line', '```js\nf(‸\nlet a = [1\n```',
    [h => h.sleep(20), async h => { const b = cbPre().querySelector('.cb-head .cb-note'); if (b?.tagName !== 'BUTTON') throw new Error('“2 problems” isn’t a button'); h.press(b); await h.sleep(20);
      const it = [...W.document.querySelectorAll('.cb-probmenu [data-cb-prob]')]; if (it.map(x => x.textContent).join('|') !== 'Line 1a ( is never closed|Line 2a [ is never closed') throw new Error(`the list: ${it.map(x => x.textContent).join(' | ')}`);
      h.press(it[1]); await h.sleep(20); }],
    undefined, { undo: false, probe: 'X', wantTyped: '```js\nf(\nlet a = X[1\n```', dom: () => W.document.querySelector('.cb-probmenu') ? 'the list stays open' : cbPre().querySelectorAll('.cb-gut .cb-gmark').length !== 2 ? 'not 2 gutter dots' : cbPre().querySelectorAll('.cb-issue').length !== 2 ? 'the underlines went' : '' });

  // ---- Insert buttons ----
  T('INS-01', 'Insert: line', 'Horizontal line at the end of a paragraph; typing goes below it', 'alpha‸', 'fmt:hr', 'alpha\n\n---', { probe: 'Z', wantTyped: 'alpha\n\n---\n\nZ' });
  T('INS-02', 'Insert: line', 'Horizontal line mid-line: the line splits around it, nothing lost', 'al‸pha', 'fmt:hr', 'al\n\n---\n\npha');
  T('INS-03', 'Insert: line', 'Horizontal line on an empty line', EMPTY_LINE, 'fmt:hr', 'Before\n\n---', { probe: 'Z', wantTyped: 'Before\n\n---\n\nZ' });
  T('INS-04', 'Insert: table', 'Table on an empty line: placed there, caret in the first cell', EMPTY_LINE, 'pop:table=2x3', md => /^Before\n\n\|.*\|.*\|.*\|\n\| --- \| --- \| --- \|\n\|.*\|$/.test(norm(md)) ? '' : 'wanted "Before" then a 3-column table with a header and one row',
    { probe: 'Z', wantTyped: md => /\n\| ?Z/.test(md) ? '' : 'Z didn\'t go into the first cell' });
  T('INS-05', 'Insert: table', 'Table at the caret, not at the top of the note', '<p>First</p><p>Second‸</p>', 'pop:table=2x2', md => md.indexOf('Second') >= 0 && md.indexOf('Second') < md.indexOf('| --- |') ? '' : 'the table isn\'t after "Second"');
  const fillLink = url => async h => {   // the link box, when there is one: type the address, then Add link
    const box = W.document.querySelector('#ed-link-url'); if (!box) return;
    box.focus(); box.select?.(); W.document.execCommand('insertText', false, url); box.dispatchEvent(new W.Event('input', { bubbles: true }));
    h.press(W.document.querySelector('[data-act="link-apply"]')); await h.sleep(10);
  };
  T('INS-06', 'Insert: link', 'Link with a selection: the text becomes the link text, and you choose the address', 'see ⟦site⟧', ['fmt:link', fillLink('https://example.com/site')], md => /example\.org/.test(md) ? 'the address is the fixed https://example.org (no way to enter one)' : norm(md) === 'see [site](https://example.com/site)' ? '' : 'wanted see [site](https://example.com/site)');
  T('INS-07', 'Insert: link', 'Link with only a caret: no "link text" placeholder link to example.org', 'see‸', ['fmt:link', fillLink('https://example.com/x')], md => /example\.org|link text/.test(md) ? 'inserts a placeholder link "link text" → https://example.org' : /\(https:\/\/example\.com\/x\)/.test(md) ? '' : 'no link to the typed address');
  T('INS-08', 'Insert: wiki link', 'Link to a note with a selection: [[selected text]]', 'see ⟦Ideas⟧', 'fmt:wiki', 'see [[Ideas]]');
  T('INS-09', 'Insert: wiki link', 'Link to a note with a caret: [[ ]] with the caret inside, ready for a name', 'see‸', 'fmt:wiki', undefined, { probe: 'Second note', wantTyped: 'see[[Second note]]' });
  T('INS-10', 'Insert: fold', 'Collapsible section around a selection: the text goes inside', '⟦hidden text⟧', 'fmt:fold', /<details( open)?>[\s\S]*hidden text[\s\S]*<\/details>/);
  T('INS-11', 'Insert: fold', 'Collapsible section across two paragraphs: both go inside', '⟦one\n\ntwo⟧', 'fmt:fold', md => /<details( open)?>[\s\S]*one[\s\S]*two[\s\S]*<\/details>/.test(md) ? '' : 'both paragraphs should be inside <details>');

  // ---- Alignment ----
  T('ALN-01', 'Alignment', 'Align centre with the caret in a paragraph', 'alpha‸', 'fmt:aligncenter', '<div align="center">\n\nalpha\n\n</div>');
  T('ALN-02', 'Alignment', 'Align right across two paragraphs: both aligned', '⟦one\n\ntwo⟧', 'fmt:alignright', md => { const b = reloadBox(md); const r = [...b.querySelectorAll('[align="right"]')].map(x => x.textContent).join(' '); return /one/.test(r) && /two/.test(r) ? '' : 'only some paragraphs are aligned'; });
  T('ALN-03', 'Alignment', 'Align left on a centred paragraph: back to plain (left is the default)', '<div align="center">\n\nalpha‸\n\n</div>', 'fmt:alignleft', 'alpha');
  T('ALN-04', 'Alignment', 'caret in a centred paragraph: Align centre shows as on', '<div align="center">\n\nal‸pha\n\n</div>', [], undefined, { dom: pressed('aligncenter'), undo: false });
  // Fix A (QC 3 · 26): spelling in the right-click menu (the word is right-clicked, as a mouse sends it; a pick is a release)
  const rmenu = async (h, word) => {
    await W.eval('api()')?.save_settings({ spell_ignore: {} });   // nothing ignored while the case runs (the backend asks config too)
    const o = W.djWordOccurrences(h.doc, word)[0], r = W.document.createRange(); r.setStart(o.node, o.start); r.setEnd(o.node, o.end);
    const b = r.getBoundingClientRect(), p = { bubbles: true, cancelable: true, clientX: b.left + 2, clientY: b.top + b.height / 2, button: 2 };
    o.node.parentElement.dispatchEvent(new W.PointerEvent('pointerdown', p)); o.node.parentElement.dispatchEvent(new W.MouseEvent('contextmenu', p));
    await until(() => { const S = W.eval('S'), c = S.ctx; return c?.kind === 'word' && W.document.querySelector('.menu--word') && (c.spell !== undefined || !S.a11y.spell || W.eval('djIgnored')(c.noteId, c.word)); }); await h.sleep(30);
  };
  const pick = act => async h => { const b = W.document.querySelector(`.menu--word [data-act="${act}"]`); if (!b) throw new Error(`no "${act}" in the menu: ${W.document.querySelector('.menu--word')?.textContent || 'no menu'}`);
    b.dispatchEvent(new W.PointerEvent('pointerup', { bubbles: true, cancelable: true, button: 0 })); await h.sleep(30); };
  // The suite runs with Spell check off, so these turn it on; the words a note ignores (page and config) are set aside and put back
  const ign = { was: null };
  const noIgnore = { prep: () => { W.eval('S').a11y.spell = true; ign.was ??= JSON.parse(JSON.stringify(W.eval('DJS').ignore)); W.eval('DJS').ignore = {}; },
    post: () => { W.eval('S').a11y.spell = false; W.eval('DJS').ignore = ign.was || {}; W.eval('api()')?.save_settings({ spell_ignore: ign.was || {} }); ign.was = null; } };
  T('SPL-01', 'Spelling', 'right-click a misspelled word: Did you mean leads the menu; a pick replaces the word', 'I recieve‸ it', [h => rmenu(h, 'recieve'), pick('ctx-fix')], 'I receive it', { ...noIgnore, focus: false });
  T('SPL-02', 'Spelling', 'the menu on a misspelled word has Ignore in this note, and no Windows hint', 'I recieve‸ it', [h => rmenu(h, 'recieve')], undefined,
    { ...noIgnore, undo: false, focus: false, dom: () => { const m = W.document.querySelector('.menu--word'); return m && m.firstElementChild?.matches('[data-act="ctx-fix"]') && m.querySelector('[data-act="ctx-ignore"]') && !/Windows/.test(m.innerHTML) ? '' : `menu: ${m?.textContent || 'none'}`; } });   // Build M parity (R51 r49-hint): no Windows menu, so no hint   // Build M round 6: R49 tight (the spellings first, no label; the hint is Check spelling's tooltip)
  T('SPL-03', 'Spelling', 'Ignore in this note: the word stays, without its red line, and the .md is unchanged', 'I recieve‸ it', [h => rmenu(h, 'recieve'), pick('ctx-ignore')], 'I recieve it',
    { ...noIgnore, undo: false, focus: false, reload: false, dom: d => { const s = d.querySelector('.spell-ok'); return s && s.getAttribute('spellcheck') === 'false' && s.textContent === 'recieve' ? '' : `got ${show(d.innerHTML.slice(0, 120))}`; } });
  T('SPL-05', 'Spelling', 'the user\'s own typing, through Windows\' spell checker: univerties → universities, laboratroies → laboratories', 'used by univerties and laboratroies‸', [h => rmenu(h, 'univerties'), pick('ctx-fix'), h => rmenu(h, 'laboratroies'), pick('ctx-fix')], 'used by universities and laboratories',
    { ...noIgnore, live: true, undo: false, focus: false });
  // Check spelling (F7): one misspelling at a time, in note order; code and [[links]] are left alone
  const f7 = async h => { await W.eval('api()')?.save_settings({ spell_ignore: {} }); h.doc.focus(); h.doc.dispatchEvent(new W.KeyboardEvent('keydown', { key: 'F7', bubbles: true, cancelable: true })); await until(() => { const sp = W.eval('SP'); return !sp.on || (!sp.loading && (!sp.cur || sp.sugg !== null) && !!W.document.querySelector('.spellpass')); }); await h.sleep(30); };
  const card = act => async h => { const b = W.document.querySelector(`.spellpass [data-act="${act}"]`); if (!b) throw new Error(`no ${act}: ${W.document.querySelector('.spellpass')?.textContent || 'no card'}`); b.click(); await until(() => { const sp = W.eval('SP'); return !sp.on || (!sp.loading && (!sp.cur || sp.sugg !== null) && !!W.document.querySelector('.spellpass')); }); await h.sleep(30); };
  T('SPL-06', 'Spelling', 'F7: the first misspelling is shown and selected; Replace takes the first suggestion, then the next', 'I recieve it and recieve more‸', [f7, card('spell-replace')], 'I receive it and recieve more',
    { ...noIgnore, undo: false, focus: false, post: h => { noIgnore.post(h); W.eval('spClose()'); } });
  T('SPL-07', 'Spelling', 'Replace all changes every one, and a word in code or a [[link]] is left alone', 'I recieve it, `recieve` and [[recieve]], recieve more‸', [f7, card('spell-replace-all')], 'I receive it, `recieve` and [[recieve]], receive more',
    { ...noIgnore, undo: false, focus: false, post: h => { noIgnore.post(h); W.eval('spClose()'); } });
  T('SPL-08', 'Spelling', 'Ignore skips one; at the end the card says it is done', 'I recieve it‸', [f7, card('spell-skip')], 'I recieve it',
    { ...noIgnore, undo: false, focus: false, dom: () => /No spelling mistakes|Done/.test(W.document.querySelector('.spellpass')?.textContent || '') ? '' : `card: ${W.document.querySelector('.spellpass')?.textContent || 'none'}`, post: h => { noIgnore.post(h); W.eval('spClose()'); } });
  // Fix A (QC 4 · 34): a voice note's player (an ![[attachments/…]] embed) never traps the caret, and a quote takes it along
  const VE = '![[attachments/voice-20261017-221517.ogg]]', VE2 = '![[attachments/voice-20261017-224210.ogg]]';
  const embedAt = (h, i = 0) => h.doc.querySelectorAll('.att-src')[i];
  const tailOk = d => { const last = d.lastElementChild, src = d.querySelector('.att-src'); return last?.matches('p') && !last.textContent.trim() && last.isContentEditable && src && (src.compareDocumentPosition(last) & 4) ? '' : `the note ends on ${show(last?.outerHTML.slice(0, 120) || 'nothing')}`; };
  const toTail = h => { const p = h.doc.lastElementChild; W.edPut([p, 0]); };
  const gap = (h, i = 0) => { const c = embedAt(h, i); return [h.doc, [...h.doc.childNodes].indexOf(c) + 1]; };   // the caret between blocks, just after embed i's ![[…]] line
  T('EMB-01', 'Embeds', 'a note that ends on a voice note\'s player has an empty line after it to type on', `Notes‸\n\n${VE}`, [], undefined, { undo: false, dom: tailOk });
  T('EMB-02', 'Embeds', 'typing on the line after the last player: saved under it', `Notes‸\n\n${VE}`, [toTail, 'type:More'], `Notes\n\n${VE}\n\nMore`, { undo: false });
  T('EMB-03', 'Embeds', 'Enter with the caret just after a player, before another: a line between them', `A‸\n\n${VE}\n\n${VE2}\n\nB`, [h => W.edPut(gap(h)), 'key:Enter', 'type:Z'], `A\n\n${VE}\n\nZ\n\n${VE2}\n\nB`, { undo: false });
  T('EMB-04', 'Embeds', 'Enter with a player selected: a line after it', `A‸\n\n${VE}\n\n${VE2}`, [h => { const pl = h.doc.querySelector('[data-embed-for]') || embedAt(h), r = W.document.createRange(); r.selectNode(pl); const s = W.getSelection(); s.removeAllRanges(); s.addRange(r); }, 'key:Enter', 'type:Z'], `A\n\n${VE}\n\nZ\n\n${VE2}`, { undo: false });
  T('EMB-05', 'Embeds', 'a press in the space between two players: a line there', `A‸\n\n${VE}\n\n${VE2}\n\nB`, [h => { const a = h.doc.querySelector('[data-embed-for]'), b = a.getBoundingClientRect(); h.doc.dispatchEvent(new W.MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0, detail: 1, clientX: b.left + 20, clientY: b.bottom + 1 })); }, 'type:Z'], `A\n\n${VE}\n\nZ\n\n${VE2}\n\nB`, { undo: false });
  T('EMB-06', 'Embeds', 'quoting a voice note (heading, player, text): the player goes into the quote, in its place', `## ⟦Voice note · 22:17\n\n${VE}\n\nThe transcript⟧`, 'fmt:quote', `> ## Voice note · 22:17\n>\n> ${VE}\n>\n> The transcript`);
  T('EMB-07', 'Embeds', 'quoting from the player to the end of the text: the player goes in too', `## Voice note · 22:17\n\n${VE}\n\nThe transcript‸`, [h => { const pl = h.doc.querySelector('[data-embed-for]') || embedAt(h), t = [...h.doc.querySelectorAll('p')].find(p => p.textContent === 'The transcript'); const r = W.document.createRange(); r.setStartBefore(pl); r.setEnd(t.firstChild, t.firstChild.length); const s = W.getSelection(); s.removeAllRanges(); s.addRange(r); }, 'fmt:quote'], `## Voice note · 22:17\n\n> ${VE}\n>\n> The transcript`);
  // Fix A (QC 4 · 39): a right-click acts on what you mean: inside a selection, the selection (kept); else the paragraph,
  // list item, quote line or table cell under the pointer, for Copy and Tidy up; nothing is selected by the right-click
  const rAt = async (h, word, nth = 0) => {   // as a mouse sends it: pointerdown, mousedown, then contextmenu (on the release)
    const o = W.djWordOccurrences(h.doc, word)[nth]; if (!o) throw new Error(`no "${word}" in the note`);
    const r = W.document.createRange(); r.setStart(o.node, o.start + 1); r.setEnd(o.node, o.start + 1); const b = r.getBoundingClientRect();
    const p = { bubbles: true, cancelable: true, clientX: b.left, clientY: b.top + b.height / 2, button: 2, buttons: 2, detail: 1 }, t = o.node.parentElement;
    t.dispatchEvent(new W.PointerEvent('pointerdown', p)); t.dispatchEvent(new W.MouseEvent('mousedown', p)); t.dispatchEvent(new W.MouseEvent('contextmenu', { ...p, buttons: 0 }));
    await until(() => W.document.querySelector('.menu--word')); await h.sleep(30);
  };
  const tgt = (kind, text, label) => () => {
    const c = W.eval('S').ctx, t = c?.target, m = W.document.querySelector('.menu--word'), tidy = m?.querySelector('[data-act="ctx-tidy"]'), copy = m?.querySelector('[data-act="ctx-copy"]');
    const bad = [!t && 'no target', t && t.kind !== kind && `kind ${t.kind}`, t && t.text.trim() !== text && `text "${t.text}"`, tidy && label && !tidy.textContent.includes(label) && `Tidy says "${tidy.textContent}"`,
      copy && copy.disabled && 'Copy is off', kind === 'paragraph' && copy && !/Copy this paragraph/.test(copy.textContent) && `Copy says "${copy.textContent}"`].filter(Boolean);
    return bad.join(', ');
  };
  const close = h => { W.eval('djCtxClose')(); };
  T('MT-01', 'Right-click target', 'a drag-selection, then a right-click inside it: the selection stays and is the target ("Tidy up selection")', 'Start ⟦two words⟧ here', [h => rAt(h, 'words')], undefined,
    { undo: false, focus: false, sel: 'two words', dom: tgt('selection', 'two words', 'Tidy up selection'), post: close });
  T('MT-02', 'Right-click target', 'a plain right-click in a paragraph: the paragraph is the target, nothing gets selected ("Tidy up this paragraph")', 'First line‸\n\nThe second paragraph here', [h => rAt(h, 'second')], undefined,
    { undo: false, focus: false, sel: '', dom: tgt('paragraph', 'The second paragraph here', 'Tidy up this paragraph'), post: close });
  T('MT-03', 'Right-click target', 'a list item: its own line, not its sub-items', '- one\n- two items here‸\n  - a sub item', [h => rAt(h, 'items')], undefined,
    { undo: false, focus: false, sel: '', dom: tgt('paragraph', 'two items here', 'Tidy up this paragraph'), post: close });
  T('MT-04', 'Right-click target', 'a quote: the quote\'s line', 'Before‸\n\n> a quoted line here', [h => rAt(h, 'quoted')], undefined,
    { undo: false, focus: false, sel: '', dom: tgt('paragraph', 'a quoted line here', 'Tidy up this paragraph'), post: close });
  // a table cell: Build P's cell menu (tables.js) leads with Tidy up this cell and Copy this cell, on the cell's text
  const rCell = async (h, word) => { const o = W.djWordOccurrences(h.doc, word)[0], r = W.document.createRange(); r.setStart(o.node, o.start + 1); r.collapse(true); const b = r.getBoundingClientRect(), t = o.node.parentElement;
    const p = { bubbles: true, cancelable: true, clientX: b.left, clientY: b.top + b.height / 2, button: 2, buttons: 2, detail: 1 };
    t.dispatchEvent(new W.PointerEvent('pointerdown', p)); t.dispatchEvent(new W.MouseEvent('mousedown', p)); t.dispatchEvent(new W.MouseEvent('contextmenu', { ...p, buttons: 0 }));
    await until(() => W.document.querySelector('.tb-menu [data-act="cell-tidy"]')); await h.sleep(30); };
  T('MT-05', 'Right-click target', 'a table cell: its menu leads with Tidy up this cell and Copy this cell, on the cell\'s text', 'Before‸\n\n| A | B |\n| --- | --- |\n| cell text | 2 |', [h => rCell(h, 'cell')], undefined,
    { undo: false, focus: false, dom: () => { const m = W.document.querySelector('.tb-menu'), t = W.eval('DJM').cell;
      return m && /Tidy up this cell/.test(m.textContent) && /Copy this cell/.test(m.textContent) && t?.text === 'cell text' && /Row|Column/.test(m.textContent) ? '' : `menu "${m?.textContent.slice(0, 80)}", target "${t?.text}"`; },
      post: () => { const TB = W.eval('TB'); TB.menu = null; W.eval('tbPaint')(); } });
  T('MT-06', 'Right-click target', 'a task: its words, not its box', 'Before‸\n\n- [ ] buy the milk', [h => rAt(h, 'milk')], undefined,
    { undo: false, focus: false, sel: '', dom: () => tgt('paragraph', 'buy the milk', 'Tidy up this paragraph')() || (/\[ \]/.test(W.eval('S').ctx.target.md) ? `md "${W.eval('S').ctx.target.md}"` : ''), post: close });
  T('MT-07', 'Right-click target', 'a whole paragraph selected (as a triple-click does), then a right-click: the selection', 'One line‸\n\nAll of this one', [h => { const p = [...h.doc.querySelectorAll('p')].find(x => x.textContent === 'All of this one'), r = W.document.createRange(); r.selectNodeContents(p); const s = W.getSelection(); s.removeAllRanges(); s.addRange(r); }, h => rAt(h, 'this')], undefined,
    { undo: false, focus: false, sel: 'All of this one', dom: tgt('selection', 'All of this one', 'Tidy up selection'), post: close });
  T('MT-09', 'Right-click target', 'a triple-clicked list item (the selection runs to the next item\'s start): the target is the item, no empty item after it', 'Before‸\n\n- the first item\n- the second', [h => { const li = h.doc.querySelectorAll('li'), r = W.document.createRange(); r.setStart(li[0], 0); r.setStart(li[0].firstChild, 0); r.setEnd(li[1], 0); const s = W.getSelection(); s.removeAllRanges(); s.addRange(r); }, h => rAt(h, 'first')], undefined,
    { undo: false, focus: false, dom: () => { const t = W.eval('S').ctx?.target; return t?.kind === 'selection' && t.text === 'the first item' && !/\n/.test(t.md) ? '' : `target ${t?.kind} "${t?.text}" md ${JSON.stringify(t?.md)}`; }, post: close });
  T('MT-08', 'Right-click target', 'hovering Tidy up shows its paragraph with a soft highlight; leaving it takes the highlight away', 'First‸\n\nThe target paragraph', [h => rAt(h, 'target'), async h => { W.document.querySelector('.menu--word [data-act="ctx-tidy"]').dispatchEvent(new W.PointerEvent('pointerover', { bubbles: true })); await h.sleep(10); }], undefined,
    { undo: false, focus: false, dom: () => { const hl = W.CSS.highlights?.get('nv-target'), r = hl && [...hl][0]; const on = r ? r.toString() : 'none';
      W.document.querySelector('.menu--word [data-act="ctx-tidy"]').dispatchEvent(new W.PointerEvent('pointerout', { bubbles: true })); const off = W.CSS.highlights?.get('nv-target');
      return on === 'The target paragraph' && !off ? '' : `highlight "${on}", after leaving ${off ? 'still there' : 'gone'}`; }, post: close });
  // QC 4 · 29: the note's ⋮ More has Check spelling, with F7 on the right; a click opens the same card
  const moreSpell = async h => { W.document.querySelector('.app-header [data-act="menu"]').click(); await h.sleep(150);
    const it = W.document.querySelector('.app-header .menu [data-act="spell-pass"]'), k = it?.querySelector('.menu-kbd');
    if (!it || it.disabled || !/^Check spelling/.test(it.textContent) || k?.textContent !== 'F7') throw new Error(`⋮ More: ${W.document.querySelector('.app-header .menu')?.textContent || 'no menu'}`);
    await W.eval('api()')?.save_settings({ spell_ignore: {} }); it.click(); await until(() => { const sp = W.eval('SP'); return !sp.on || (!sp.loading && (!sp.cur || sp.sugg !== null) && !!W.document.querySelector('.spellpass')); });
    if (W.document.querySelector('.app-header .menu')) throw new Error('⋮ More stayed open'); };
  T('SPL-09', 'Spelling', '⋮ More → Check spelling (F7 shown on the right) opens the card; Replace fixes the word', 'I recieve it‸', [moreSpell, card('spell-replace')], 'I receive it',
    { ...noIgnore, undo: false, focus: false, post: h => { noIgnore.post(h); W.eval('spClose()'); } });
  // Autocorrect as you type (Settings → Editor): a clear slip becomes its spelling when the word is finished
  const acOn = (strength = 'obvious') => ({ prep: () => { W.eval('ACOR').cfg = { on: true, strength, never: [] }; W.eval('ACOR').skip = {}; W.eval('DJS').ignore = {}; },
    post: () => { W.eval('ACOR').cfg = { on: true, strength: 'obvious', never: [] }; W.eval('ACOR').skip = {}; W.eval('ACOR').last = null; } });
  const ac = async h => { await h.sleep(0); await until(() => W.eval('ACOR').busy === 0); await h.sleep(30); };
  T('ACR-01', 'Autocorrect', 'typing "recieve" then a space: it becomes "receive"', '<p>‸<br></p>', ['type:I recieve ', ac], 'I receive', { ...acOn(), undo: false });
  T('ACR-02', 'Autocorrect', 'Backspace straight after the correction gives back what was typed', '<p>‸<br></p>', ['type:I recieve ', ac, 'key:Backspace', ac], 'I recieve', { ...acOn(), undo: false });
  T('ACR-03', 'Autocorrect', 'Ctrl+Z straight after the correction gives back what was typed, and it isn\'t corrected again in the note', '<p>‸<br></p>', ['type:I recieve ', ac, 'key:Ctrl+z', ac, 'type:recieve ', ac], 'I recieve recieve', { ...acOn(), undo: false });
  T('ACR-04', 'Autocorrect', 'inside code: left alone', '<p><code>recieve‸</code></p>', ['type: ', ac], md => /recieve/.test(md) && !/receive/.test(md) ? '' : 'the code was corrected', { ...acOn(), undo: false, reload: false });
  T('ACR-05', 'Autocorrect', 'inside a [[link]] being typed: left alone', '<p>‸<br></p>', ['type:See [[recieve ', ac], md => /recieve/.test(md) && !/receive/.test(md) ? '' : 'the link was corrected', { ...acOn(), undo: false });
  T('ACR-06', 'Autocorrect', 'a word in the "never" list: left alone', '<p>‸<br></p>', ['type:I recieve ', ac], 'I recieve', { prep: () => { W.eval('ACOR').cfg = { on: true, strength: 'obvious', never: ['recieve'] }; W.eval('api()')?.save_settings({ autocorrect_never: ['recieve'] }); }, post: () => { W.eval('ACOR').cfg = { on: true, strength: 'obvious', never: [] }; W.eval('api()')?.save_settings({ autocorrect_never: [] }); }, undo: false });
  T('ACR-07', 'Autocorrect', 'with the setting off: nothing changes', '<p>‸<br></p>', ['type:I recieve ', ac], 'I recieve', { prep: () => { W.eval('ACOR').cfg = { on: false, strength: 'obvious', never: [] }; }, post: () => { W.eval('ACOR').cfg = { on: true, strength: 'obvious', never: [] }; }, undo: false });
  T('ACR-09', 'Autocorrect', 'with "Spelling and autocorrect work in: Only in notes", a note is still corrected (QC 4 · 30)', '<p>‸<br></p>', ['type:I recieve ', ac], 'I receive',
    { prep: () => { acOn().prep(); W.eval('SPW').where = 'notes'; }, post: () => { acOn().post(); W.eval('SPW').where = 'everywhere'; }, undo: false });
  T('ACR-08', 'Autocorrect', 'the user\'s typing (live, Windows\' spell checker): advacne, laboratroies, teh and understadn are fixed, nothing else', '<p>‸<br></p>', ['type:supports advacne research laboratroies around teh world, understadn their ', ac], 'supports advance research laboratories around the world, understand their',
    { ...acOn(), live: true, undo: false });
  /* ==== Build N (QC 76): the user's live typing test, through Windows' spell checker ("usefull" became "use full"; opnion, recived
     and aalot were left alone; "ther eown" wasn't offered as "there own") ==== */
  T('ACR-10', 'Autocorrect', 'a doubled letter typed once too many: usefull becomes useful, never "use full"', '<p>‸<br></p>', ['type:it was usefull ', ac], 'it was useful', { ...acOn(), live: true, undo: false });
  T('ACR-11', 'Autocorrect', 'opnion (a letter left out) becomes opinion', '<p>‸<br></p>', ['type:my own opnion ', ac], 'my own opinion', { ...acOn(), live: true, undo: false });
  T('ACR-12', 'Autocorrect', 'recived becomes received', '<p>‸<br></p>', ['type:I recived it ', ac], 'I received it', { ...acOn(), live: true, undo: false });
  T('ACR-13', 'Autocorrect', 'aalot becomes a lot (as alot does)', '<p>‸<br></p>', ['type:I got aalot ', ac], 'I got a lot', { ...acOn(), live: true, undo: false });
  T('SPL-10', 'Spelling', 'a space typed one letter late: "ther eown" is offered as "there own", first; a pick replaces both words', 'they had ther eown‸ view', [h => rmenu(h, 'eown'), pick('ctx-fix')], 'they had there own view', { ...noIgnore, live: true, focus: false });
  // QC 76, grown (Gboard-style ranking with SymSpell's word frequencies, learning on this PC): the user's own test sentence, typed
  T('ACR-14', 'Autocorrect', 'the user’s test sentence: every slip fixed, the real words left alone', '<p>‸<br></p>',
    ['type:Teh meeting yesterday was definately usefull, but i recieved alot of feedback and its going to take untill next week to seperate the good ideas form the bad ones becuase evryone had there own opnion. ', ac],
    'The meeting yesterday was definitely useful, but i received a lot of feedback and its going to take until next week to separate the good ideas form the bad ones because everyone had there own opinion.', { ...acOn(), live: true, undo: false });
  // learning: a correction you undo isn’t made again for that word (in any note, not just this one); Clear what it learned forgets it
  const forget = async h => { await W.eval('api()')?.autocorrect_forget(); await h.sleep(0); };
  T('ACR-15', 'Autocorrect', 'learning: undo a correction and it isn’t made again for that word, even with the note’s own memory cleared', '<p>‸<br></p>',
    [forget, 'type:I recived ', ac, 'key:Backspace', ac, h => { W.eval('ACOR').skip = {}; return h.sleep(0); }, 'type:recived ', ac, forget], 'I recived recived', { ...acOn(), live: true, undo: false });
  T('ACR-16', 'Autocorrect', 'learning: Clear what it learned, and the correction is made again', '<p>‸<br></p>',
    [forget, 'type:I recived ', ac, 'key:Backspace', ac, async h => { W.eval('ACOR').skip = {}; await forget(h); }, 'type:recived ', ac, forget], 'I recived received', { ...acOn(), live: true, undo: false });
  /* ==== end Build N (QC 76) ==== */
  T('SPL-04', 'Spelling', 'a known word: no Did you mean', 'It went ‸well', [h => rmenu(h, 'went')], undefined,
    { ...noIgnore, undo: false, focus: false, dom: () => { const m = W.document.querySelector('.menu--word'); return m && !/Did you mean/.test(m.textContent) ? '' : `menu: ${m?.textContent || 'none'}`; } });
  // Fix A (QC 3 · 24): tables, lists, quotes and callouts; off with a reason in a code block
  const alignBtns = want => () => { const bs = [...W.document.querySelectorAll('.ed-toolbar [data-fmt^="align"]')]; return bs.length && bs.every(want) ? '' : `buttons: ${bs.map(b => b.disabled + ' ' + b.title).join(' / ')}`; };
  T('ALN-05', 'Alignment', 'Align centre in a table cell: its column, saved as :---:', '| A | B |\n| --- | --- |\n| 1‸ | 2 |', 'fmt:aligncenter', '| A | B |\n| :---: | --- |\n| 1 | 2 |');
  T('ALN-06', 'Alignment', 'Align right across two cells of different columns: both columns', '| A | B |\n| --- | --- |\n| ⟦1 | 2⟧ |', 'fmt:alignright', '| A | B |\n| ---: | ---: |\n| 1 | 2 |');
  T('ALN-07', 'Alignment', 'Align left on a centred column: back to plain', '| A | B |\n| :---: | --- |\n| 1‸ | 2 |', 'fmt:alignleft', '| A | B |\n| --- | --- |\n| 1 | 2 |');
  T('ALN-08', 'Alignment', 'Align right in a list item: the whole list', '- one\n- tw‸o', 'fmt:alignright', '<div align="right">\n\n- one\n- two\n\n</div>');
  T('ALN-09', 'Alignment', 'Align centre in a nested task: the whole list', '- one\n  - [ ] su‸b', 'fmt:aligncenter', '<div align="center">\n\n- one\n  - [ ] sub\n\n</div>');
  T('ALN-10', 'Alignment', 'Align centre in a quote: the whole quote', '> a qu‸ote', 'fmt:aligncenter', '<div align="center">\n\n> a quote\n\n</div>');
  T('ALN-11', 'Alignment', 'Align right in a callout: the whole callout', '> [!note] Title\n> bo‸dy', 'fmt:alignright', '<div align="right">\n\n> [!note] Title\n> body\n\n</div>');
  T('ALN-12', 'Alignment', 'Align left on an aligned list: plain again', '<div align="right"><ul><li>one</li><li>tw‸o</li></ul></div>', 'fmt:alignleft', '- one\n- two');
  T('ALN-13', 'Alignment', 'caret in a code block: the align buttons are off and say why', '```\nco‸de\n```', [], undefined, { undo: false, dom: alignBtns(b => b.disabled && /code block/.test(b.title)) });
  T('ALN-14', 'Alignment', 'caret back in a paragraph: the align buttons are on again', '```\ncode\n```\n\nte‸xt', [], undefined, { undo: false, dom: alignBtns(b => !b.disabled && /^Align/.test(b.title)) });

  // ---- Enter and Shift+Enter ----
  T('ENT-01', 'Enter', 'end of a bullet: a new bullet', '- a‸', 'key:Enter', undefined, { probe: 'Z', wantTyped: '- a\n- Z' });
  T('ENT-02', 'Enter', 'end of a task: a new unticked task', '- [ ] a‸', 'key:Enter', undefined, { probe: 'Z', wantTyped: '- [ ] a\n- [ ] Z' });
  T('ENT-03', 'Enter', 'end of a ticked task: the new task is unticked', '- [x] a‸', 'key:Enter', undefined, { probe: 'Z', wantTyped: '- [x] a\n- [ ] Z' });
  T('ENT-04', 'Enter', 'on an empty bullet: the list ends', '- a\n- ‸', 'key:Enter', undefined, { probe: 'Z', wantTyped: '- a\n\nZ' });
  T('ENT-05', 'Enter', 'on an empty task: the list ends', '- [ ] a\n- [ ] ‸', 'key:Enter', undefined, { probe: 'Z', wantTyped: '- [ ] a\n\nZ' });
  T('ENT-06', 'Enter', 'middle of a bullet: splits it into two bullets', '- al‸pha', 'key:Enter', '- al\n- pha', { probe: 'Z', wantTyped: '- al\n- Zpha' });
  T('ENT-07', 'Enter', 'middle of a task: splits it into two tasks', '- [ ] al‸pha', 'key:Enter', '- [ ] al\n- [ ] pha', { probe: 'Z', wantTyped: '- [ ] al\n- [ ] Zpha' });
  T('ENT-08', 'Enter', 'start of a task\'s text: an empty task above, the caret stays with the text', '- [ ] ‸alpha', 'key:Enter', '- [ ]\n- [ ] alpha', { probe: 'Z', wantTyped: '- [ ]\n- [ ] Zalpha' });
  T('ENT-09', 'Enter', 'end of a heading: the next line is plain text', '# Title‸', 'key:Enter', undefined, { probe: 'Z', wantTyped: '# Title\n\nZ' });
  T('ENT-10', 'Enter', 'end of a quote: a new line in the quote', '> quote‸', 'key:Enter', undefined, { probe: 'Z', wantTyped: '> quote\n>\n> Z' });
  T('ENT-11', 'Enter', 'on an empty line in a quote: the quote ends', '<blockquote><p>quote</p><p>‸<br></p></blockquote>', 'key:Enter', undefined, { probe: 'Z', wantTyped: '> quote\n\nZ' });
  T('ENT-12', 'Enter', 'in a code block: a new line in the code', '```\nline‸\n```', 'key:Enter', undefined, { probe: 'Z', wantTyped: '```\nline\nZ\n```' });
  T('ENT-13', 'Enter', 'end of a numbered item: the next number', '1. a‸', 'key:Enter', undefined, { probe: 'Z', wantTyped: '1. a\n2. Z' });
  T('ENT-14', 'Enter', 'on an empty numbered item: the list ends', '1. a\n2. ‸', 'key:Enter', undefined, { probe: 'Z', wantTyped: '1. a\n\nZ' });
  T('ENT-15', 'Enter', 'middle of a paragraph: two paragraphs', 'ab‸cd', 'key:Enter', 'ab\n\ncd', { probe: 'Z', wantTyped: 'ab\n\nZcd' });
  T('ENT-16', 'Shift+Enter', 'in a bullet: a line break inside the same item', '- a‸', 'key:Shift+Enter', undefined, { probe: 'Z', wantTyped: '- a\n  Z' });
  T('ENT-17', 'Shift+Enter', 'in a task: a line break inside the same task', '- [ ] a‸', 'key:Shift+Enter', undefined, { probe: 'Z', wantTyped: '- [ ] a\n  Z' });
  T('ENT-18', 'Shift+Enter', 'in a paragraph: a line break, same paragraph', 'a‸', 'key:Shift+Enter', undefined, { probe: 'Z', wantTyped: 'a\nZ' });
  T('ENT-19', 'Enter', 'typing in an empty note, Enter, typing: two paragraphs', '<p>‸<br></p>', ['type:one', 'key:Enter', 'type:two'], 'one\n\ntwo', { dom: doc => doc.querySelectorAll(':scope > p').length === 2 ? '' : `wanted two <p>, got ${show(doc.innerHTML.slice(0, 120))}`, undo: false });
  T('ENT-20', 'Enter', 'typing into a note with no blocks at all', '', ['type:one', 'key:Enter', 'type:two'], 'one\n\ntwo', { undo: false });

  // ---- Backspace and Delete ----
  T('BSP-01', 'Backspace', 'start of the first bullet: the bullet goes, the text stays', '- ‸alpha', 'key:Backspace', 'alpha');
  T('BSP-02', 'Backspace', 'start of the second bullet: that bullet goes, its text becomes a paragraph', '- a\n- ‸b', 'key:Backspace', '- a\n\nb');
  T('BSP-03', 'Backspace', 'start of a task\'s text: the checkbox goes, the text stays', '- [ ] ‸alpha', 'key:Backspace', md => /\[[ x]\]/.test(md) || !/alpha/.test(md) ? 'wanted the text without its checkbox' : '', { dom: boxes(0) });
  T('BSP-04', 'Backspace', 'twice on an empty task: it goes, the caret ends after the task above', '- [ ] a\n- [ ] ‸', ['key:Backspace', 'key:Backspace'], '- [ ] a', { probe: 'Z', wantTyped: '- [ ] aZ', undo: false });   // two keys, two steps: one Ctrl+Z may undo only the second
  T('BSP-05', 'Backspace', 'twice on an empty bullet: it goes, the caret ends after the bullet above', '- a\n- ‸', ['key:Backspace', 'key:Backspace'], '- a', { probe: 'Z', wantTyped: '- aZ', undo: false });
  T('BSP-06', 'Backspace', 'start of a heading at the top: it becomes text', '# ‸Title', 'key:Backspace', 'Title');
  T('BSP-07', 'Backspace', 'start of a quote at the top: it leaves the quote', '> ‸quoted', 'key:Backspace', 'quoted');
  T('BSP-08', 'Backspace', 'start of a paragraph after a list: joins the last item', '- a\n\n‸b', 'key:Backspace', '- ab');
  T('BSP-09', 'Backspace', 'a selection across two list items: one item left', '- a⟦b\n- c⟧d', 'key:Backspace', '- ad');
  T('BSP-10', 'Backspace', 'one character', 'abc‸', 'key:Backspace', 'ab');
  T('BSP-11', 'Delete', 'end of a bullet: the next bullet joins it', '- a‸\n- b', 'key:Delete', '- ab');
  T('BSP-12', 'Delete', 'end of a task: the next task\'s text joins, its checkbox doesn\'t', '- [ ] a‸\n- [x] b', 'key:Delete', '- [ ] ab', { dom: boxes(1) });
  T('BSP-13', 'Delete', 'end of a paragraph before a list: the first item\'s text joins', 'a‸\n\n- b', 'key:Delete', 'ab');
  T('BSP-14', 'Delete', 'a selection from a paragraph into a list item', 'pa⟦ra\n\n- it⟧em', 'key:Delete', 'paem');
  T('BSP-15', 'Backspace', 'start of a task with a task above: the checkbox goes first', '- [ ] a\n- [ ] ‸b', 'key:Backspace', md => /^- \[ \] a\n\n?b$|^- \[ \] a\n- b$/.test(norm(md)) ? '' : 'wanted task "a" and "b" without its checkbox', { dom: boxes(1) });

  // ---- Tab and Shift+Tab ----
  T('TAB-01', 'Tab', 'second bullet: nests under the first, focus stays', '- a\n- b‸', 'key:Tab', md => /^- a\n\s+- b$/.test(norm(md)) ? '' : 'wanted b nested under a');
  T('TAB-02', 'Tab', 'Shift+Tab on a nested bullet: back out a level', '- a\n  - b‸', 'key:Shift+Tab', '- a\n- b');
  T('TAB-03', 'Tab', 'second task: nests under the first', '- [ ] a\n- [ ] b‸', 'key:Tab', md => /^- \[ \] a\n\s+- \[ \] b$/.test(norm(md)) ? '' : 'wanted task b nested under task a');
  T('TAB-04', 'Tab', 'second numbered item: nests under the first', '1. a\n2. b‸', 'key:Tab', md => /^1\. a\n\s+1\. b$/.test(norm(md)) ? '' : 'wanted b nested under a');
  T('TAB-05', 'Tab', 'first bullet: nothing to nest under, nothing changes, focus stays', '- a‸', 'key:Tab', '- a');
  T('TAB-06', 'Tab', 'two selected bullets: both nest', '- a\n- ⟦b\n- c⟧', 'key:Tab', md => /^- a\n\s+- b\n\s+- c$/.test(norm(md)) ? '' : 'wanted b and c nested under a');
  T('TAB-07', 'Tab', 'in a paragraph: focus stays in the editor', 'alpha‸', 'key:Tab', undefined, { undo: false });

  // ---- Select all (E-3) ----
  const BIG = '# Title\n\nSome **bold** text.\n\n- [ ] t1\n- [x] t2\n\n| A | B |\n| --- | --- |\n| 1 | 2 |\n\n```\ncode\n```\n\n> quote\n\nend';
  const oneEmptyP = doc => { const k = [...doc.children]; return k.length === 1 && k[0].tagName === 'P' && !k[0].textContent.trim() ? '' : `wanted one empty paragraph, got ${show(doc.innerHTML.slice(0, 160))}`; };
  T('ALL-01', 'Select all', 'Ctrl+A, Delete: the note is one empty paragraph, focus stays', 'one\n\n- two\n\nthree', ['key:Ctrl+a', 'key:Delete'], '', { dom: oneEmptyP, probe: 'Z', wantTyped: 'Z' });
  T('ALL-02', 'Select all', 'Ctrl+A, Backspace: the same', 'one\n\n- two\n\nthree', ['key:Ctrl+a', 'key:Backspace'], '', { dom: oneEmptyP, probe: 'Z', wantTyped: 'Z' });
  T('ALL-03', 'Select all', 'Ctrl+A, type: the note is just what you typed', 'one\n\n- two\n\nthree', ['key:Ctrl+a', 'type:Z'], 'Z', { dom: doc => doc.querySelector('p')?.textContent === 'Z' ? '' : 'Z isn\'t in a paragraph' });
  T('ALL-04', 'Select all', 'Ctrl+A, Delete on a note with a heading, tasks, a table, code and a quote', BIG, ['key:Ctrl+a', 'key:Delete'], '', { dom: all(oneEmptyP, boxes(0)) });
  T('ALL-05', 'Select all', 'Ctrl+A, Delete when the note starts with a heading: typing after it is plain text', '# Title\n\ntext', ['key:Ctrl+a', 'key:Delete'], '', { probe: 'Z', wantTyped: 'Z' });
  T('ALL-06', 'Select all', 'Ctrl+A, Delete when the note starts with a list: typing after it is plain text', '- a\n- b', ['key:Ctrl+a', 'key:Delete'], '', { probe: 'Z', wantTyped: 'Z' });
  T('ALL-07', 'Select all', 'Ctrl+A, Delete when the note starts with a task: typing after it is plain text', '- [ ] a\n- [ ] b', ['key:Ctrl+a', 'key:Delete'], '', { dom: boxes(0), probe: 'Z', wantTyped: 'Z' });
  T('ALL-08', 'Select all', 'Ctrl+A, Delete keeps the hidden front matter (edit it in Raw .md)', '---\nstatus: draft\n---\n\nBody text', ['key:Ctrl+a', 'key:Delete'], '---\nstatus: draft\n---');
  T('ALL-09', 'Select all', 'Ctrl+A, Delete on a note ending with a table', 'a\n\n| A | B |\n| --- | --- |\n| 1 | 2 |', ['key:Ctrl+a', 'key:Delete'], '', { dom: oneEmptyP });
  T('ALL-10', 'Select all', 'Ctrl+A, Bold: everything bold, still two paragraphs', 'one\n\ntwo', ['key:Ctrl+a', 'fmt:bold'], '**one**\n\n**two**');
  T('ALL-11', 'Select all', 'Ctrl+A selects the note only (not the title or the toolbar)', 'one\n\ntwo', ['key:Ctrl+a'], undefined, { dom: () => { const s = W.getSelection(), r = s.rangeCount && s.getRangeAt(0); return r && H.doc.contains(r.startContainer) && H.doc.contains(r.endContainer) && norm(s.toString()).replace(/\s+/g, ' ') === 'one two' ? '' : `selected ${show(s.toString())}`; }, undo: false });
  T('ALL-12', 'Select all', 'Ctrl+A, paste plain text: replaces the note', 'one\n\ntwo', ['key:Ctrl+a', h => h.paste({ text: 'pasted' })], 'pasted');
  T('ALL-13', 'Select all', 'Ctrl+A, type, when the note starts with a heading: a plain paragraph', '# Title\n\ntext', ['key:Ctrl+a', 'type:Z'], 'Z');
  // Fix A (QC 3 · 21): a note that starts with its {{tasks}} list (a daily note). Chromium's own Select All selects
  // nothing there (key() runs it when the app leaves Ctrl+A alone), so the editor selects from the first line itself.
  // The list stays when the note is cleared: it was never selected, as in what the highlight shows
  const linked = { prep: h => { const D = W.eval('D'); D.tasks = D.tasks.filter(t => t.id !== 't-all14'); D.tasks.push({ id: 't-all14', title: 'Linked ALL14', noteId: h.n.id, done: false, steps: [] }); },
    post: () => { const D = W.eval('D'); D.tasks = D.tasks.filter(t => t.id !== 't-all14'); } };
  const TASKS_TOP = '---\nstatus: draft\n---\n{{tasks}}\n\nSome text.\n\nMore text.', KEPT = '---\nstatus: draft\n---\n{{tasks}}';
  T('ALL-14', 'Select all', 'Ctrl+A on a note that starts with its tasks list: all the text under it is selected', TASKS_TOP, ['key:Ctrl+a'], undefined,
    { ...linked, undo: false, dom: () => { const t = norm(W.getSelection().toString()).trim(); return /^Some text\.\s+More text\.$/.test(t) ? '' : `selected ${show(t)}`; } });
  T('ALL-15', 'Select all', 'Ctrl+A, Delete on a note that starts with its tasks list: one empty paragraph under it, front matter kept', TASKS_TOP, ['key:Ctrl+a', 'key:Delete'], KEPT, { ...linked, probe: 'Z', wantTyped: KEPT + '\n\nZ' });
  T('ALL-16', 'Select all', 'Ctrl+A, Backspace on a note that starts with its tasks list: the same', TASKS_TOP, ['key:Ctrl+a', 'key:Backspace'], KEPT, linked);
  T('ALL-17', 'Select all', 'Ctrl+A, type on a note that starts with its tasks list: just what you typed', TASKS_TOP, ['key:Ctrl+a', 'type:Z'], KEPT + '\n\nZ', linked);

  // ---- Undo and redo of typing ----
  T('UND-01', 'Undo', 'type, Ctrl+Z: the typing is undone', 'alpha‸', ['type: beta', 'key:Ctrl+z'], 'alpha', { undo: false });
  T('UND-02', 'Undo', 'type, Ctrl+Z, Ctrl+Shift+Z: back again', 'alpha‸', ['type: beta', 'key:Ctrl+z', 'key:Ctrl+Shift+z'], 'alpha beta', { undo: false });
  T('UND-03', 'Undo', 'type, Ctrl+Z, Ctrl+Y: back again', 'alpha‸', ['type: beta', 'key:Ctrl+z', 'key:Ctrl+y'], 'alpha beta', { undo: false });
  T('UND-04', 'Undo', 'Task button then type, Ctrl+Z twice: the note as it was', EMPTY_LINE, ['fmt:task', 'type:Z', 'key:Ctrl+z', 'key:Ctrl+z'], 'Before', { undo: false });
  T('UND-05', 'Undo', 'Ctrl+A, Delete, Ctrl+Z: the whole note comes back', BIG, ['key:Ctrl+a', 'key:Delete', 'key:Ctrl+z'], BIG, { undo: false });

  // ---- Paste ----
  const WORD = `<html xmlns:o="urn:schemas-microsoft-com:office:office"><body><!--StartFragment--><p class=MsoNormal><b><span style='font-family:"Calibri",sans-serif'>Bold</span></b><span style='font-size:11.0pt'> text</span><o:p></o:p></p><!--EndFragment--></body></html>`;
  const WORD_LIST = `<p class=MsoListParagraphCxSpFirst style='text-indent:-18.0pt;mso-list:l0 level1 lfo1'><![if !supportLists]><span style='font-family:Symbol;mso-list:Ignore'>·<span style='font:7.0pt "Times New Roman"'>&nbsp;&nbsp;&nbsp; </span></span><![endif]>one<o:p></o:p></p><p class=MsoListParagraphCxSpLast style='text-indent:-18.0pt;mso-list:l0 level1 lfo1'><![if !supportLists]><span style='font-family:Symbol;mso-list:Ignore'>·<span style='font:7.0pt "Times New Roman"'>&nbsp;&nbsp;&nbsp; </span></span><![endif]>two<o:p></o:p></p>`;
  const GDOCS = `<meta charset="utf-8"><b style="font-weight:normal;" id="docs-internal-guid-1a2b3c"><p dir="ltr" style="line-height:1.38;margin-top:0pt;margin-bottom:0pt;"><span style="font-size:11pt;font-family:Arial,sans-serif;color:#000000;background-color:transparent;font-weight:700;font-style:normal;">Bold</span><span style="font-size:11pt;font-family:Arial,sans-serif;color:#000000;font-weight:400;"> text</span></p></b>`;
  const WEB = `<h2 style="font-size:24px">Title</h2><p>Some <a href="https://example.com/x" style="color:blue">link</a> here</p><ul><li>one</li><li>two</li></ul>`;
  const clean = doc => { const s = doc.querySelector('[style], font, [class^="Mso"], o\\:p, meta, script'); return s ? `pasted styling came along: ${show(s.outerHTML.slice(0, 100))}` : ''; };
  T('PST-01', 'Paste', 'plain text with two lines: two paragraphs', '<p>‸<br></p>', h => h.paste({ text: 'one\ntwo' }), 'one\n\ntwo');
  T('PST-02', 'Paste', 'plain text mid-line', 'ab‸cd', h => h.paste({ text: 'XY' }), 'abXYcd');
  T('PST-03', 'Paste', 'plain text over a selection replaces it', 'a⟦bc⟧d', h => h.paste({ text: 'X' }), 'aXd');
  T('PST-04', 'Paste', 'Markdown text (a list) becomes a list', '<p>‸<br></p>', h => h.paste({ text: '- one\n- two' }), '- one\n- two');
  T('PST-05', 'Paste', 'Markdown text (a task) becomes a task', '<p>‸<br></p>', h => h.paste({ text: '- [ ] buy milk' }), '- [ ] buy milk');
  T('PST-06', 'Paste', 'Markdown text (a heading and bold) keeps its meaning', '<p>‸<br></p>', h => h.paste({ text: '# Title\n\nSome **bold**' }), '# Title\n\nSome **bold**');
  T('PST-07', 'Paste', 'from Word: bold kept, fonts and Mso styling dropped', '<p>‸<br></p>', h => h.paste({ html: WORD, text: 'Bold text' }), 'Bold text'.replace('Bold', '**Bold**'), { dom: clean });
  T('PST-08', 'Paste', 'from Word: a bulleted list stays a list', '<p>‸<br></p>', h => h.paste({ html: WORD_LIST, text: '· one\n· two' }), '- one\n- two', { dom: clean });
  T('PST-09', 'Paste', 'from Google Docs: bold kept (not everything bold), styling dropped', '<p>‸<br></p>', h => h.paste({ html: GDOCS, text: 'Bold text' }), '**Bold** text', { dom: clean });
  T('PST-10', 'Paste', 'from a web page: heading, link and list kept; styles dropped', '<p>‸<br></p>', h => h.paste({ html: WEB, text: 'Title\nSome link here\none\ntwo' }), '## Title\n\nSome [link](https://example.com/x) here\n\n- one\n- two', { dom: clean });
  T('PST-11', 'Paste', 'rich text into a code block: pasted as plain code', '```\nco‸de\n```', h => h.paste({ html: '<b>X</b>', text: 'X' }), '```\ncoXde\n```');
  T('PST-12', 'Paste', 'two paragraphs into a task: the second becomes a new task', '- [ ] a‸', h => h.paste({ html: '<p>b</p><p>c</p>', text: 'b\nc' }), '- [ ] ab\n- [ ] c');
  T('PST-13', 'Paste', 'tasks copied from a note paste as tasks', '<p>‸<br></p>', h => h.paste({ html: '<ul><li class="task-list-item"><input type="checkbox"> one</li><li class="task-list-item"><input type="checkbox" checked> two</li></ul>', text: 'one\ntwo' }), '- [ ] one\n- [x] two');
  const PNG = () => { const b = atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='); const u = new Uint8Array(b.length); for (let i = 0; i < b.length; i++) u[i] = b.charCodeAt(i); return new W.File([u], 'image.png', { type: 'image/png' }); };
  // Fix A: built (api.attachment_save; with no dev bridge the file is only in the page)
  T('PST-14', 'Paste', 'an image: shown at the caret, saved as a file in attachments/ and embedded on a line of its own (no base64 in the .md)', 'see ‸', h => h.paste({ file: PNG() }),
    md => /data:image/.test(md) ? 'the .md holds the image as base64 data' : /^see\n\n!\[\[attachments\/paste-\d{8}-\d{6}(?:-\d+)?\.png\]\]$/.test(md.trim()) ? '' : 'wanted "see", then the ![[attachments/paste-….png]] line',
    { undo: false, dom: doc => doc.querySelector('.att-img img[src]') ? '' : 'no image drawn in the note', wait: 600 });

  // ---- Markdown shortcuts while typing (not claimed by the editor: reported as NOT BUILT) ----
  const MDS = [['- ', '- one'], ['* ', '- one'], ['1. ', '1. one'], ['[ ] ', '- [ ] one'], ['- [ ] ', '- [ ] one'], ['# ', '# one'], ['## ', '## one'], ['> ', '> one']];
  // Fix A (QC 3 · 25): the list and task shortcuts (MDS-01 to 05) are built; headings and quotes (06 to 08) aren't yet
  MDS.forEach(([pre, w], i) => T(`MDS-0${i + 1}`, 'Markdown shortcuts', `typing "${pre}one" on an empty line`, '<p>‸<br></p>', 'type:' + pre + 'one', w, { notBuilt: i >= 5, undo: false }));
  T('MDS-12', 'Markdown shortcuts', 'typing "3. " starts a numbered list at 3', '<p>‸<br></p>', 'type:3. one', '3. one', { undo: false });
  T('MDS-13', 'Markdown shortcuts', 'typing "[x] " makes a done task', '<p>‸<br></p>', 'type:[x] one', '- [x] one', { undo: false });
  T('MDS-14', 'Markdown shortcuts', 'a typed "- " in the middle of a line stays text', 'one‸', 'type: - two', 'one - two', { undo: false });
  T('MDS-15', 'Markdown shortcuts', 'Ctrl+Z after "- " gives the typed dash back', '<p>‸<br></p>', ['type:- ', 'key:Ctrl+z'], '\\-', { undo: false });
  T('TAB-20', 'Tab', 'a list typed with "- ", then Tab on its second line: nested (2 spaces in the .md)', '<p>‸<br></p>', ['type:- a\nb', 'key:Tab'], '- a\n  - b', { undo: false, probe: 'Z', wantTyped: '- a\n  - bZ' });
  T('TAB-21', 'Tab', 'typed numbers, Tab then Shift+Tab: renumbered per level (3 spaces under "1.")', '<p>‸<br></p>', ['type:1. a\nb\nc', 'key:Tab'], '1. a\n2. b\n   1. c', { undo: false });
  T('TAB-22', 'Tab', 'a typed task under a typed bullet, then Shift+Tab', '<p>‸<br></p>', ['type:- a\n[ ] t', 'key:Tab', 'key:Shift+Tab'], '- a\n- [ ] t', { undo: false });
  T('MDS-09', 'Markdown shortcuts', 'typing ``` then Enter starts a code block', '<p>‸<br></p>', ['type:```', 'key:Enter', 'type:x'], '```\nx\n```', { notBuilt: true, undo: false });
  T('MDS-10', 'Markdown shortcuts', 'typing **bold** makes it bold', '<p>‸<br></p>', 'type:**bold** ', '**bold**', { notBuilt: true, undo: false });
  T('MDS-11', 'Markdown shortcuts', 'typing --- then Enter makes a horizontal line', '<p>‸<br></p>', ['type:---', 'key:Enter'], '---', { notBuilt: true, undo: false });

  // ---- Tasks in the note and the Tasks board (needs the dev bridge) ----
  const saveSync = async h => { const n = h.n; n.dirty = true; n.docDirty = true; await W.saveNote(n); await n.lineSync; await h.sleep(50); };
  const task = (h, title) => W.eval('D').tasks.find(t => t.noteId === h.n.id && t.title === title);
  T('SYNC-01', 'Tasks sync', 'tick a task line in the note: its task is done on the board, the .md says [x]', '- [ ] Buy milk SYNC1\n- [ ] Call Sam SYNC1',
    [saveSync, h => h.doc.querySelector('li input[type="checkbox"]').click(), h => h.sleep(400)], '- [x] Buy milk SYNC1\n- [ ] Call Sam SYNC1',
    { live: true, focus: false, undo: false, dom: (d, h) => task(h, 'Buy milk SYNC1')?.done === true ? '' : `the board's task is ${task(h, 'Buy milk SYNC1') ? 'not done' : 'missing'}` });
  T('SYNC-02', 'Tasks sync', 'untick it: the board follows', '- [x] Done thing SYNC2', [saveSync, h => h.doc.querySelector('li input[type="checkbox"]').click(), h => h.sleep(400)], '- [ ] Done thing SYNC2',
    { live: true, focus: false, undo: false, dom: (d, h) => task(h, 'Done thing SYNC2')?.done === false ? '' : 'the board\'s task is still done (or missing)' });
  T('SYNC-03', 'Tasks sync', 'tick it on the board: the open note shows the tick', '- [ ] Board tick SYNC3', [saveSync, async h => { await W.setTaskDone(task(h, 'Board tick SYNC3'), true); await h.sleep(300); }], '- [x] Board tick SYNC3',
    { live: true, focus: false, undo: false, dom: d => d.querySelector('li input[type="checkbox"]')?.checked ? '' : 'the editor still shows it unticked' });
  T('SYNC-04', 'Tasks sync', 'a task made with the toolbar becomes a board task with the typed title', EMPTY_LINE, ['fmt:task', 'type:Pay rent SYNC4', saveSync], 'Before\n\n- [ ] Pay rent SYNC4',
    { live: true, focus: false, undo: false, dirty: false, dom: (d, h) => !task(h, 'Pay rent SYNC4') ? 'no board task "Pay rent SYNC4"' : task(h, 'New task') ? 'a board task "New task" was made' : '' });

  // ---- Caret, focus and modes ----
  T('FOC-01', 'Focus', 'Bold from the command palette (Ctrl+K) on a selection: applies to it, focus returns', 'alpha ⟦beta⟧',
    ['key:Ctrl+k', h => h.sleep(30), 'type:Bold', 'key:Enter', h => h.sleep(120)], 'alpha **beta**');   // 120 ms: the palette's tip toast comes 60 ms later
  T('FOC-02', 'Focus', 'Ctrl+S while typing: saved, caret stays', 'alpha‸', ['key:Ctrl+s', h => h.sleep(50)], 'alpha', { probe: 'Z', wantTyped: 'alphaZ', undo: false });
  T('FOC-03', 'Modes', 'type in Document, switch to Raw .md: the text is there', 'alpha‸', ['type: beta', h => h.clickAct('mode', 'raw')], undefined,
    { generic: false, undo: false, dom: () => (W.document.querySelector('#raw-markdown-textarea')?.value || '').includes('alpha beta') ? '' : 'Raw .md doesn\'t show the typed text' });
  T('FOC-04', 'Modes', 'Raw .md and back to Document: the note is unchanged', '# Head\n\n- [ ] task\n\ntext‸', [h => h.clickAct('mode', 'raw'), h => h.clickAct('mode', 'wysiwyg')], '# Head\n\n- [ ] task\n\ntext', { focus: false, undo: false });

  // ---- The ⋯ menu: buttons that don't fit the toolbar row (a narrow window). The frame is made narrow for these ----
  const narrow = { prep: () => { FRAME.style.width = '760px'; }, post: () => { FRAME.style.width = ''; } };
  const viaMore = f => [h => h.sleep(60), h => h.clickAct('ed-more'), h => { h.press(W.document.querySelector(`.ed-more-menu [data-fmt="${f}"]`)); return h.sleep(10); }];
  T('OVF-01', '⋯ menu', 'Task checkbox from ⋯ on an empty line: there, at the caret', EMPTY_LINE, viaMore('task'), 'Before\n\n- [ ]', Object.assign({ probe: 'Z', wantTyped: 'Before\n\n- [ ] Z' }, narrow));
  T('OVF-02', '⋯ menu', 'Task checkbox from ⋯ with a selection: that line becomes a task, text kept', 'first\n\n⟦second line⟧', viaMore('task'), 'first\n\n- [ ] second line', narrow);
  T('OVF-03', '⋯ menu', 'Numbered list from ⋯ with the caret in the second paragraph', 'first\n\nsec‸ond', viaMore('ol'), 'first\n\n1. second', narrow);
  T('OVF-04', '⋯ menu', 'opening ⋯ keeps the caret where it was', 'first\n\nsec‸ond', [h => h.sleep(60), h => h.clickAct('ed-more')], undefined, Object.assign({ probe: 'Z', wantTyped: 'first\n\nsecZond', undo: false }, narrow));
  T('FOC-05', 'Focus', 'a toast (here "Moved") while you type doesn\'t move the caret', 'alpha‸', [() => { W.toast('Moved'); }, h => h.sleep(2000)], undefined, { probe: 'Z', wantTyped: 'alphaZ', undo: false });

  // ---- Load and save without edits (the save round trip through the editor) ----
  (typeof MOCK_BASE_NOTES !== 'undefined' ? MOCK_BASE_NOTES : []).forEach((m, i) => T(`RT-${String(i + 1).padStart(2, '0')}`, 'Save round trip', `open "${m.title}" and save without editing: the .md doesn't change`, m.md, [],
    md => norm(md) === norm(W.NVMarkdown.htmlToMd(W.NVMarkdown.mdToHtml(m.md))) ? '' : 'the editor changed the note', { focus: false, undo: false }));
  const SPELL_MD = 'We will recieve the files there, and their notes affect the plan.';
  T('RT-90', 'Save round trip', 'spelling and homophone marks never reach the .md', SPELL_MD, [], SPELL_MD,
    { focus: false, undo: false, prep: () => E('S.a11y.spell = true; S.a11y.homophones = true'), post: () => E('S.a11y.spell = false; S.a11y.homophones = false'),
      dom: d => d.querySelector('.spell, .homophone') ? '' : '(setup) no marks were drawn' });

  /* ==== Build P · table controls and rich tables (mockups R48, R48b "all", R48c): the toolbar, the right-click menu, the grips
     (click, drag, +), the keys, and the rich (HTML) table and back. Every case that changes the note also runs Ctrl+Z / Ctrl+Y.
     Copying never touches the real clipboard here (__tbNoClipboard): TB.copied holds what would be copied. ==== */
  const TBL0 = '| A | B | C |\n| --- | :---: | ---: |\n';
  const tbl = rows => TBL0 + rows.map(r => '| ' + r.join(' | ') + ' |').join('\n');
  const T0 = tbl([['a1', 'b1', 'c1'], ['a2', 'b2', 'c2']]);
  const at = (s, cell) => s.replace(cell, cell + '‸');   // the caret at the end of a cell
  const R = s => 'Budget\n' + s;   // a line before a rich table: a start beginning with "<" would be read as the editor's HTML, not as the .md
  const RT = (rows, b, cols) => `<table data-nv-borders="${b || 'all'}">\n` + (cols ? `  <colgroup>${cols}</colgroup>\n` : '') + rows.map(r => '  <tr>\n' + r.map(c => '    ' + c).join('\n') + '\n  </tr>').join('\n') + '\n</table>';
  const HEAD = ['<th>A</th>', '<th style="text-align:center">B</th>', '<th style="text-align:right">C</th>'];
  const ROW = n => [`<td>a${n}</td>`, `<td style="text-align:center">b${n}</td>`, `<td style="text-align:right">c${n}</td>`];
  const tbReset = () => E('TB.sel = null; TB.menu = null; TB.more = false; TB.pick = null; TB.toast = null; TB.sortDir = {}; TB.hot = null; TB.copied = ""; window.__tbNoClipboard = true');
  const TP = (id, name, start, act, w, more) => { more = more || {}; const p0 = more.prep; T(id, 'Tables', name, start, [h => h.sleep(20)].concat(act), w, Object.assign({}, more, { prep: h => { tbReset(); if (p0) p0(h); } })); };
  const cellOf = (r, c) => W.tbMap(H.doc.querySelector('table')).occ[r][c];
  const mouse = (el, type, o) => el.dispatchEvent(new W.MouseEvent(type, Object.assign({ bubbles: true, cancelable: true, button: 0 }, o || {})));
  const tbBtn = a => async h => { await h.sleep(20); const b = W.document.querySelector(`.tb-bar [data-tb="${a}"]`); if (!b) throw new Error('no toolbar button ' + a); h.press(b); await h.sleep(10); };
  const tbPick = (k, a) => async h => { await h.sleep(20); h.press(W.document.querySelector(`.tb-bar [data-tb-pick="${k}"]`)); await h.sleep(10); const b = W.document.querySelector(`.tb-pick [data-tb="${a}"]`); if (!b) throw new Error('no picker item ' + a); h.press(b); await h.sleep(10); };
  const tbMore = a => async h => { await h.sleep(20); h.press(W.document.querySelector('.tb-bar [data-tb-more]')); await h.sleep(10); const b = W.document.querySelector(`.tb-moremenu [data-tb="${a}"]`); if (!b) throw new Error('no More item ' + a); h.press(b); await h.sleep(10); };
  const rclick = (r, c) => async h => { const el = cellOf(r, c), b = el.getBoundingClientRect(); mouse(el, 'contextmenu', { button: 2, clientX: b.left + 8, clientY: b.top + 8 }); await h.sleep(10); };
  const menu = a => async h => { const b = W.document.querySelector(`.tb-menu:not(.tb-moremenu) [data-tb="${a}"]`); if (!b) throw new Error('no menu item ' + a); h.press(b); await h.sleep(10); };
  const shiftTo = (r, c) => async h => { await h.sleep(10); mouse(cellOf(r, c), 'mousedown', { shiftKey: true }); await h.sleep(10); };
  const dragSel = (r0, c0, r1, c1) => async h => { await h.sleep(10); mouse(cellOf(r0, c0), 'mousedown'); mouse(cellOf(r1, c1), 'mousemove', { buttons: 1 }); mouse(W.document, 'mouseup'); await h.sleep(10); };
  const grip = (k, i) => W.document.querySelector(`.tb-layer .tb-grip[data-tb-grip="${k}"][data-i="${i}"]`);
  const gripClick = (k, i) => async h => { await h.sleep(20); const g = grip(k, i); if (!g) throw new Error(`no ${k} grip ${i}`); h.press(g); await h.sleep(10); };
  const gripDrag = (k, i, r, c) => async h => { await h.sleep(20); const g = grip(k, i); if (!g) throw new Error(`no ${k} grip ${i}`); const b = g.getBoundingClientRect(), t = cellOf(r, c).getBoundingClientRect(), x = t.left + t.width / 2, y = t.top + t.height / 2;
    mouse(g, 'mousedown', { clientX: b.left + 5, clientY: b.top + 5 }); mouse(W.document, 'mousemove', { buttons: 1, clientX: x, clientY: y }); mouse(W.document, 'mouseup', { clientX: x, clientY: y }); await h.sleep(10); };
  const hover = async h => { const t = H.doc.querySelector('table'), b = t.getBoundingClientRect(); mouse(t, 'mousemove', { clientX: b.left + 10, clientY: b.top + 10 }); await h.sleep(20); };
  const plus = (k, i) => async h => { await hover(h); const b = W.document.querySelector(`.tb-layer [data-tb-plus="${k}"][data-i="${i}"]`); if (!b) throw new Error(`no ${k} + ${i}`); h.press(b); await h.sleep(10); };
  const resize = (c, dx) => async h => { await h.sleep(20); const s = W.document.querySelector(`.tb-colsize[data-tb-size="${c}"]`); if (!s) throw new Error('no resize edge ' + c); const b = s.getBoundingClientRect();
    mouse(s, 'mousedown', { clientX: b.left + 4, clientY: b.top + 4 }); mouse(W.document, 'mousemove', { buttons: 1, clientX: b.left + 4 + dx, clientY: b.top + 4 }); mouse(W.document, 'mouseup', { clientX: b.left + 4 + dx }); await h.sleep(10); };
  const said = re => () => re.test(E('S.status')) ? '' : `status: ${show(E('S.status'))}`;
  const copied = want => () => E('TB.copied') === want ? '' : `copied ${show(E('TB.copied'))}`;
  const noBar = 'the toolbar is gone';

  // The toolbar
  TP('TBL-01', 'toolbar: insert a row above (caret in a2): an empty row there, the caret in it', at(T0, 'a2'), tbBtn('rowup'), tbl([['a1', 'b1', 'c1'], ['', '', ''], ['a2', 'b2', 'c2']]), { probe: 'Z', wantTyped: tbl([['a1', 'b1', 'c1'], ['Z', '', ''], ['a2', 'b2', 'c2']]) });
  TP('TBL-02', 'toolbar: insert a row below (caret in b1)', at(T0, 'b1'), tbBtn('rowdown'), tbl([['a1', 'b1', 'c1'], ['', '', ''], ['a2', 'b2', 'c2']]), { probe: 'Z', wantTyped: tbl([['a1', 'b1', 'c1'], ['', 'Z', ''], ['a2', 'b2', 'c2']]) });
  TP('TBL-03', 'toolbar: delete the row (caret in b1)', at(T0, 'b1'), tbBtn('delrow'), tbl([['a2', 'b2', 'c2']]));
  TP('TBL-04', 'toolbar: delete row on the header is off and says why; nothing changes', at(T0, '| B'), tbBtn('delrow'), T0, { undo: false, dom: () => /header row can’t go/.test(W.document.querySelector('.tb-bar [data-tb="delrow"]')?.title || '') && W.document.querySelector('.tb-bar [data-tb="delrow"]').getAttribute('aria-disabled') === 'true' ? '' : 'delete row isn’t off on the header' });
  TP('TBL-05', 'toolbar: insert a column to the left (caret in b1): plain alignment, the others keep theirs; the caret in its header', at(T0, 'b1'), tbBtn('colleft'), '| A |  | B | C |\n| --- | --- | :---: | ---: |\n| a1 |  | b1 | c1 |\n| a2 |  | b2 | c2 |', { probe: 'Z', wantTyped: '| A | Z | B | C |\n| --- | --- | :---: | ---: |\n| a1 |  | b1 | c1 |\n| a2 |  | b2 | c2 |' });
  TP('TBL-06', 'toolbar: insert a column to the right (caret in b1)', at(T0, 'b1'), tbBtn('colright'), '| A | B |  | C |\n| --- | :---: | --- | ---: |\n| a1 | b1 |  | c1 |\n| a2 | b2 |  | c2 |');
  TP('TBL-07', 'toolbar: delete the column (caret in b1)', at(T0, 'b1'), tbBtn('delcol'), '| A | C |\n| --- | ---: |\n| a1 | c1 |\n| a2 | c2 |');
  TP('TBL-08', 'toolbar: align centre, written in the separator row as :---: (the same align as Fix A)', at(T0, 'a1'), tbBtn('ac'), T0.replace('| --- | :---: |', '| :---: | :---: |'), { dom: d => d.querySelector('td').getAttribute('align') === 'center' && W.getComputedStyle(d.querySelector('td')).textAlign === 'center' ? '' : 'the cell isn’t drawn centred' });
  TP('TBL-09', 'toolbar: align right on a selection of two columns: both columns', at(T0, 'a1'), [shiftTo(1, 1), tbBtn('ar')], T0.replace('| --- | :---: | ---: |', '| ---: | ---: | ---: |'));
  TP('TBL-10', 'toolbar: align left on a right column: plain --- again', at(T0, 'c1'), tbBtn('al'), T0.replace('| :---: | ---: |', '| :---: | --- |'));
  TP('TBL-11', 'toolbar: sort by a column of numbers, smallest first (as numbers, not text)', at('| N | Name |\n| --- | --- |\n| 10 | ten |\n| 9 | nine |\n| 100 | hundred |', '| N'), tbBtn('sort'), '| N | Name |\n| --- | --- |\n| 9 | nine |\n| 10 | ten |\n| 100 | hundred |', { dom: said(/smallest first/) });
  TP('TBL-12', 'toolbar: sort again: reversed', at('| N | Name |\n| --- | --- |\n| 10 | ten |\n| 9 | nine |\n| 100 | hundred |', '| N'), [tbBtn('sort'), tbBtn('sort')], '| N | Name |\n| --- | --- |\n| 100 | hundred |\n| 10 | ten |\n| 9 | nine |', { undo: false });
  TP('TBL-13', 'toolbar: sort text A to Z, empty cells last; £ amounts sort as numbers', at('| Who | Cost |\n| --- | ---: |\n| ben | £2,500 |\n|  | £900 |\n| Ana | £10,000 |', '| Who'), tbBtn('sort'), '| Who | Cost |\n| --- | ---: |\n| Ana | £10,000 |\n| ben | £2,500 |\n|  | £900 |');
  TP('TBL-14', 'toolbar: header off: an empty header row stays in the .md (Markdown tables always have one)', at(T0, 'a1'), tbBtn('header'), '|  |  |  |\n| --- | :---: | ---: |\n| A | B | C |\n| a1 | b1 | c1 |\n| a2 | b2 | c2 |', { dom: () => W.document.querySelector('.tb-bar [data-tb="header"]')?.getAttribute('aria-pressed') === 'false' ? '' : 'Header row still shows as on' });
  TP('TBL-15', 'toolbar: header on again: the empty header row goes', at('|  |  |\n| --- | --- |\n| A | B |\n| 1 | 2 |', '| 1'), tbBtn('header'), '| A | B |\n| --- | --- |\n| 1 | 2 |');
  TP('TBL-16', 'More: copy as CSV (Build K’s format: quoted when needed, \\r\\n, plain text)', at(tbl([['x, y', 'say "hi"', '**b** [[L]]'], ['a2', 'b2', 'c2']]), 'a2'), tbMore('copycsv'), undefined, { undo: false, dom: copied('A,B,C\r\n"x, y","say ""hi""",b [[L]]\r\na2,b2,c2\r\n') });
  TP('TBL-17', 'More: copy as Markdown', at(T0, 'a1'), tbMore('copymd'), undefined, { undo: false, dom: copied(T0) });
  TP('TBL-18', 'More: copy as HTML (R48c’s format)', at(T0, 'a1'), tbMore('copyhtml'), undefined, { undo: false, dom: copied(RT([HEAD, ROW(1), ROW(2)])) });
  TP('TBL-19', 'More: convert to text, one line per row', 'Before\n\n' + at(T0, 'a1'), tbMore('totext'), 'Before\n\nA · B · C\n\na1 · b1 · c1\n\na2 · b2 · c2', { dom: d => d.querySelector('table') ? 'the table is still there' : '' });
  TP('TBL-20', 'More: delete the table; the caret goes to the line after it', 'Before\n\n' + at(T0, 'a1') + '\n\nAfter', tbMore('deltable'), 'Before\n\nAfter', { probe: 'Z', wantTyped: 'Before\n\nZAfter' });

  // The right-click menu and the grips
  TP('TBL-21', 'right-click a cell: the table menu at the pointer; Insert a row below from it', at(T0, 'a1'), [rclick(1, 1), h => { if (!W.document.querySelector('.tb-menu--cell')) throw new Error('no menu'); }, menu('rowdown')], tbl([['a1', 'b1', 'c1'], ['', '', ''], ['a2', 'b2', 'c2']]), { dom: () => W.document.querySelector('.tb-menu') ? 'the menu stayed open' : '' });
  TP('TBL-22', 'the same actions everywhere: toolbar (with More and its pickers), right-click menu, a grip’s menu', at(T0, 'a1'), [], undefined, { undo: false, dom: async (d, h) => {
    const set = sel => [...W.document.querySelectorAll(sel)].map(b => b.dataset.tb).filter(Boolean).sort().join(' ');
    const bar = new Set(set('.tb-bar [data-tb]').split(' ')); for (const k of ['colour', 'borders']) { h.press(W.document.querySelector(`[data-tb-pick="${k}"]`)); await h.sleep(10); set('.tb-pick [data-tb]').split(' ').forEach(x => bar.add(x)); }
    h.press(W.document.querySelector('[data-tb-more]')); await h.sleep(10); set('.tb-moremenu [data-tb]').split(' ').forEach(x => bar.add(x)); E('TB.more = false; tbPaint()');
    await rclick(1, 1)(h); const cellMenu = set('.tb-menu--cell [data-tb]'); E('TB.menu = null; tbPaint()'); await gripClick('col', 1)(h); const gripMenu = set('.tb-menu--col [data-tb]'); E('TB.menu = null; TB.sel = null; tbPaint()');
    const b = [...bar].sort().join(' '), n = b.split(' ').length;
    return b === cellMenu && b === gripMenu && n === 41 ? '' : `toolbar ${n}: ${b} | menu: ${cellMenu} | grip menu: ${gripMenu}`; } });
  TP('TBL-23', 'a column grip: selects the column and opens its menu; Sort from there', at('| N | Name |\n| --- | --- |\n| 2 | b |\n| 1 | a |', '| a'), [gripClick('col', 0), h => { if (!W.document.querySelector('.tb-menu--col')) throw new Error('no column menu'); }, menu('sort')], '| N | Name |\n| --- | --- |\n| 1 | a |\n| 2 | b |');
  TP('TBL-24', 'drag a row grip onto another row: the row moves there', at(T0, 'a1'), gripDrag('row', 2, 1, 0), tbl([['a2', 'b2', 'c2'], ['a1', 'b1', 'c1']]), { dom: said(/Moved the row/) });
  TP('TBL-25', 'drag a column grip onto another column: the column moves with its alignment', at(T0, 'a1'), gripDrag('col', 2, 1, 0), '| C | A | B |\n| ---: | --- | :---: |\n| c1 | a1 | b1 |\n| c2 | a2 | b2 |');
  TP('TBL-26', 'the header row’s grip doesn’t drag (the header stays on top)', at(T0, 'a1'), gripDrag('row', 0, 2, 0), T0, { undo: false });
  TP('TBL-27', 'a + between rows (shown on hover) inserts a row there', at(T0, 'a1'), plus('row', 2), tbl([['a1', 'b1', 'c1'], ['', '', ''], ['a2', 'b2', 'c2']]));
  TP('TBL-28', 'a + between columns inserts a column there', at(T0, 'a1'), plus('col', 1), '| A |  | B | C |\n| --- | --- | :---: | ---: |\n| a1 |  | b1 | c1 |\n| a2 |  | b2 | c2 |');
  TP('TBL-29', 'the toolbar and the grips never overlap; the toolbar sits inside the window', at(T0, 'a1'), hover, undefined, { undo: false, dom: () => {
    const bar = W.document.querySelector('.tb-bar'); if (!bar) return 'no toolbar'; const b = bar.getBoundingClientRect(), a = W.document.querySelector('.app').getBoundingClientRect();
    const hit = [...W.document.querySelectorAll('.tb-grip, .tb-plus')].filter(g => { const r = g.getBoundingClientRect(); return r.left < b.right && r.right > b.left && r.top < b.bottom && r.bottom > b.top; });
    return hit.length ? `${hit.length} grips under the toolbar` : b.left < a.left || b.right > a.right || b.top < a.top ? 'the toolbar is outside the window' : ''; } });

  // Keys and selections
  TP('TBL-30', 'Tab: the next cell, its text selected (Docs, Word); typing replaces it', at(T0, 'a1'), 'key:Tab', T0, { undo: false, sel: 'b1', probe: 'Z', wantTyped: tbl([['a1', 'Z', 'c1'], ['a2', 'b2', 'c2']]) });
  TP('TBL-31', 'Tab in the last cell adds a row, the caret in its first cell', at(T0, 'c2'), 'key:Tab', tbl([['a1', 'b1', 'c1'], ['a2', 'b2', 'c2'], ['', '', '']]), { probe: 'Z', wantTyped: tbl([['a1', 'b1', 'c1'], ['a2', 'b2', 'c2'], ['Z', '', '']]) });
  TP('TBL-32', 'Shift+Tab: the cell before', at(T0, 'b1'), 'key:Shift+Tab', T0, { undo: false, sel: 'a1' });
  TP('TBL-33', 'Enter stays in the cell (no new paragraph in the table)', at(T0, 'b1'), 'key:Enter', T0, { undo: false, probe: 'Z', wantTyped: tbl([['a1', 'b1Z', 'c1'], ['a2', 'b2', 'c2']]) });
  TP('TBL-34', 'Shift+Enter: a new line in the cell (<br> in the .md)', at(T0, 'b1'), ['key:Shift+Enter', 'type:x'], tbl([['a1', 'b1<br>x', 'c1'], ['a2', 'b2', 'c2']]), { undo: false });
  TP('TBL-35', 'drag across four cells, then Delete: they’re cleared', at(T0, 'a1'), [dragSel(1, 0, 2, 1), 'key:Delete'], tbl([['', '', 'c1'], ['', '', 'c2']]));
  TP('TBL-36', 'a row grip selects the row; Delete deletes it', at(T0, 'a1'), [gripClick('row', 1), h => { E('TB.menu = null; tbPaint()'); return h.sleep(10); }, 'key:Delete'], tbl([['a2', 'b2', 'c2']]));
  TP('TBL-37', 'Esc clears a selection', at(T0, 'a1'), [dragSel(1, 0, 2, 1), 'key:Escape'], T0, { undo: false, dom: () => E('TB.sel') ? 'the selection is still there' : '' });

  // R48c · rich tables: saved as an HTML table in R48c's format, and back
  TP('TBL-40', 'merge two selected cells: the table turns rich (HTML), the tag says so', at(T0, 'a1'), [shiftTo(1, 1), tbBtn('merge')], RT([HEAD, ['<td colspan="2">a1<br>b1</td>', '<td style="text-align:right">c1</td>'], ROW(2)]),
    { dom: (d) => { const tag = W.document.querySelector('.tb-richtag'); return !tag ? 'no rich tag' : !/merged cell/.test(tag.title) ? 'tag: ' + tag.title : said(/saved as HTML now/)(); } });
  TP('TBL-41', 'merge refuses a selection from the header into the rows', at(T0, '| A'), [shiftTo(1, 0), tbBtn('merge')], T0, { undo: false, dom: said(/header into the rows/) });
  TP('TBL-42', 'split the merged cell: back to plain Markdown (the text stays in the first cell)', R(RT([HEAD, ['<td colspan="2">a1‸</td>', '<td style="text-align:right">c1</td>'], ROW(2)])), tbBtn('split'), 'Budget\n\n' + tbl([['a1', '', 'c1'], ['a2', 'b2', 'c2']]), { dom: said(/plain Markdown again/) });
  TP('TBL-43', 'cell colour from the toolbar’s picker (a theme name and a fallback colour)', at(T0, 'a1'), tbPick('colour', 'bg-blue'), RT([HEAD, ['<td data-nv-bg="blue" style="background:#cfe0f7">a1</td>', ...ROW(1).slice(1)], ROW(2)]));
  TP('TBL-44', 'text colour from the right-click menu', at(T0, 'a1'), [rclick(2, 2), menu('fg-red')], RT([HEAD, ROW(1), ['<td>a2</td>', '<td style="text-align:center">b2</td>', '<td data-nv-fg="red" style="text-align:right;color:#b42318">c2</td>']]));
  TP('TBL-45', 'no colour again: plain Markdown again', R(RT([HEAD, ['<td data-nv-bg="blue" style="background:#cfe0f7">a1‸</td>', ...ROW(1).slice(1)], ROW(2)])), tbPick('colour', 'bg-none'), 'Budget\n\n' + T0);
  TP('TBL-46', 'align to the middle (vertical alignment)', at(T0, 'b2'), tbBtn('vm'), RT([HEAD, ROW(1), ['<td>a2</td>', '<td style="text-align:center;vertical-align:middle">b2</td>', '<td style="text-align:right">c2</td>']]));
  TP('TBL-47', 'no borders, from the borders picker', at(T0, 'a1'), tbPick('borders', 'b-none'), RT([HEAD, ROW(1), ROW(2)], 'none'), { dom: d => W.getComputedStyle(d.querySelector('td')).borderTopColor === 'rgba(0, 0, 0, 0)' ? '' : 'the borders still show' });
  TP('TBL-48', 'a list in the cell (its lines become items)', at(tbl([['one<br>two', 'b1', 'c1'], ['a2', 'b2', 'c2']]), 'two'), tbBtn('list'), RT([HEAD, ['<td><ul><li>one</li><li>two</li></ul></td>', ...ROW(1).slice(1)], ROW(2)]));
  TP('TBL-49', 'a checkbox in the cell; ticking it is saved', at(T0, 'a1'), [tbBtn('check'), h => { const b = H.doc.querySelector('td input'); b.click(); return h.sleep(10); }], RT([HEAD, ['<td><label class="r48-chk"><input type="checkbox" checked> a1</label></td>', ...ROW(1).slice(1)], ROW(2)]), { undo: false });
  TP('TBL-50', 'drag a column’s edge: a set width (HTML <colgroup>)', at(T0, 'a1'), resize(1, 60), md => /^<table data-nv-borders="all">\n  <colgroup><col><col style="width:\d+px"><col><\/colgroup>\n/.test(md) ? '' : 'no width in the .md',
    { dom: d => { const w = +(/width:(\d+)px/.exec(E('NVMarkdown.htmlToMd(document.querySelector(".doc"))')) || [])[1]; const got = cellOf(0, 1).getBoundingClientRect().width; return Math.abs(got - w) <= 1 ? '' : `the column is ${got}px, the .md says ${w}px`; } });
  TP('TBL-51', 'sort refuses while cells are merged, and says why', R(RT([HEAD, ['<td colspan="2">a1‸</td>', '<td style="text-align:right">c1</td>'], ROW(2)])), tbBtn('sort'), R(RT([HEAD, ['<td colspan="2">a1</td>', '<td style="text-align:right">c1</td>'], ROW(2)])), { undo: false, dom: said(/split the merged cells first/i) });
  const SIMP = [h => h.sleep(20), h => { h.press(W.document.querySelector('[data-tb-more]')); return h.sleep(10); }, h => { h.press(W.document.querySelector('.tb-moremenu [data-tb="simplify"]')); return h.sleep(20); }];
  const RICH1 = R(RT([HEAD, ['<td colspan="2" data-nv-bg="green" style="background:#cdebc5">a1‸ **x**</td>', '<td style="text-align:right"><ul><li>c1</li><li>[[L]]</li></ul></td>'], ROW(2)]));
  TP('TBL-52', 'Simplify to Markdown: the confirm lists what goes; Simplify; an Undo bar', RICH1, [...SIMP, h => { const d = W.document.querySelector('[data-dlg="tb-simplify"]'); if (!d || !/merged cell[\s\S]*colour[\s\S]*lists/.test(d.textContent)) throw new Error('the confirm doesn’t list the losses'); W.eval('TB').copyKept = null; h.press(d.querySelector('[data-dlg-btn="main"]')); return until(() => W.eval('TB').copyKept); }],   // QC 63: wait for the copy's save (late on a busy PC)
    // Build M · round 6 (r48-simplify "keep a copy too"): a hidden line under the table links the rich table's copy in attachments/
    got => { const base = 'Budget\n\n' + tbl([['a1 **x**', '', '• c1<br>• [[L]]'], ['a2', 'b2', 'c2']]); return got.startsWith(base) && /^\s*<!-- !\[\[attachments\/[^\]]+ table \(rich\) \d{8}-\d{6}\.html\]\] -->\s*$/.test(got.slice(base.length)) ? '' : 'not the simplified table with the copy’s hidden line'; },
    { dom: () => W.document.querySelector('.tb-toast [data-tb-undo]') ? '' : 'no Undo bar' });
  TP('TBL-53', 'Simplify, then the Undo bar: the rich table is back', RICH1, [...SIMP, h => { h.press(W.document.querySelector('[data-dlg="tb-simplify"] [data-dlg-btn="main"]')); return h.sleep(20); }, h => { h.press(W.document.querySelector('.tb-toast [data-tb-undo]')); return h.sleep(20); }], RICH1.replace('‸', ''), { undo: false });
  TP('TBL-54', 'Simplify, then Keep the rich table: nothing changes', RICH1, [...SIMP, h => { h.press(W.document.querySelector('[data-dlg="tb-simplify"] [data-dlg-btn="cancel"]')); return h.sleep(20); }], RICH1.replace('‸', ''), { undo: false, dom: said(/Kept the rich table/) });
  TP('TBL-55', '“Show it in the .md”: the HTML as saved beside the Markdown Simplify would keep', RICH1, tbMore('rawmd'), undefined, { undo: false, focus: false, post: () => E('closeModal()'), dom: () => {
    const html = W.document.querySelector('[data-tb-src="html"]')?.textContent, md = W.document.querySelector('[data-tb-src="md"]')?.textContent;
    return 'Budget\n' + html === RICH1.replace('‸', '') && md === tbl([['a1 **x**', '', '• c1<br>• [[L]]'], ['a2', 'b2', 'c2']]) ? '' : `html ${show(html)} md ${show(md)}`; } });
  TP('TBL-56', 'a rich table from the .md is editable: typing in a cell keeps its Markdown and the HTML', RICH1, 'type:yz', RICH1.replace('‸', 'yz'), { undo: false });
  TP('TBL-57', 'Fix A’s align buttons on a rich table: the column, as text-align in the HTML', RICH1.replace('<td>a2</td>', '<td>a2‸</td>').replace('‸ **x**', ' **x**'), 'fmt:alignright', RICH1.replace('‸', '').replace('<th>A</th>', '<th style="text-align:right">A</th>').replace('<td colspan="2" data-nv-bg="green" style="background:#cdebc5">', '<td colspan="2" data-nv-bg="green" style="text-align:right;background:#cdebc5">').replace('<td>a2</td>', '<td style="text-align:right">a2</td>'));
  TP('TBL-58', 'the toolbar steps aside while the cell’s right-click menu is open', at(T0, 'a1'), rclick(1, 0), undefined, { undo: false, focus: false, dom: () => W.document.querySelector('.tb-bar') ? 'the toolbar is still up' : W.document.querySelector('.tb-menu--cell') ? '' : 'no menu', post: () => E('TB.menu = null; tbPaint()') });   // focus: the menu's first item (R41), as the word menu
  TP('TBL-59', 'a click away closes the menu; the caret stays in the note', at(T0, 'a1'), [rclick(1, 0), h => { const p = H.doc.querySelector('p') || H.doc; p.dispatchEvent(new W.PointerEvent('pointerdown', { bubbles: true })); return h.sleep(20); }], undefined, { undo: false, focus: false, dom: () => W.document.querySelector('.tb-menu') ? 'the menu is still open' : '' });   // a real press then puts the caret where it lands
  // Build V · QC 82: copy, cut and paste a range of cells as tab-separated text (Excel, Word). Never the real clipboard (TB.copied)
  TP('TBL-60', 'Ctrl+C on four selected cells copies them as tab-separated rows; the note doesn’t change', at(T0, 'a1'), [dragSel(1, 0, 2, 1), 'key:Ctrl+c'], T0, { undo: false, focus: false, dom: copied('a1\tb1\na2\tb2') });
  TP('TBL-61', 'Ctrl+X copies the cells, then clears them', at(T0, 'a1'), [dragSel(1, 1, 2, 2), 'key:Ctrl+x'], tbl([['a1', '', ''], ['a2', '', '']]), { dom: copied('b1\tc1\nb2\tc2') });
  TP('TBL-62', 'Ctrl+V of tab-separated rows fills the cells from the caret', at(T0, 'a1'), h => h.paste({ text: 'x\ty\r\nz\tw\r\n' }), tbl([['x', 'y', 'c1'], ['z', 'w', 'c2']]));
  TP('TBL-63', 'a paste that runs past the edge adds the rows and columns it needs', at(T0, 'c2'), h => h.paste({ text: 'p\tq\nr\ts' }),
    md => /\| a2 \| b2 \| p \| q \|/.test(md) && /\|\s+\|\s+\| r \| s \|/.test(md) && md.split('\n').length === 5 ? '' : 'not pasted past the edge as a grid');
  TP('TBL-64', 'Ctrl+V of a selection’s copy pastes into the selected cells', at(T0, 'a1'), [dragSel(1, 0, 2, 1), 'key:Ctrl+c', dragSel(1, 2, 2, 2), h => h.paste({ text: 'a1\tb1\na2\tb2' })],
    md => /\| a1 \| b1 \| a1 \|/.test(md) && /\| a2 \| b2 \| a2 \|/.test(md) && /\| b1 \|$/m.test(md) ? '' : 'the copy didn’t land in the selected cells', { undo: false, focus: false });
  TP('TBL-65', 'plain text with no tabs pastes into the one cell, as before', at(T0, 'a1'), h => h.paste({ text: 'x' }), tbl([['a1x', 'b1', 'c1'], ['a2', 'b2', 'c2']]), { undo: false });
  // Build V · QC 83: arrow keys inside the table menus (Up / Down by line, Left / Right along a row of icons, Home / End, wrapping)
  const onTb = want => () => { const a = W.document.activeElement; return a?.dataset?.tb === want ? '' : `focus on ${a?.dataset?.tb || a?.tagName}, wanted ${want}`; };
  const shut = () => E('TB.menu = null; TB.more = false; TB.pick = null; tbPaint()');
  TP('TBL-66', 'cell menu: Down goes to the next line, Right along it, Up back up in the same column', at(T0, 'a1'), [rclick(1, 0), 'key:ArrowDown', 'key:ArrowRight', 'key:ArrowUp'], undefined, { undo: false, focus: false, dom: onTb('rowdown'), post: shut });
  TP('TBL-67', 'cell menu: Left from the first icon of a row wraps to its last', at(T0, 'a1'), [rclick(1, 0), 'key:ArrowLeft'], undefined, { undo: false, focus: false, dom: onTb('delrow'), post: shut });
  TP('TBL-68', 'More menu: Down, Up, End and Home move through its items; the keys stay in the menu', at(T0, 'a1'),
    [async h => { await h.sleep(20); h.press(W.document.querySelector('.tb-bar [data-tb-more]')); await h.sleep(10); W.document.querySelector('.tb-moremenu button:not([aria-disabled="true"])').focus(); }, 'key:ArrowDown', 'key:ArrowDown', 'key:ArrowUp', 'key:End'],
    undefined, { undo: false, focus: false, post: shut, dom: () => { const its = [...W.document.querySelectorAll('.tb-moremenu button:not([disabled]):not([aria-disabled="true"])')], a = W.document.activeElement;
      return !its.length ? 'no More menu' : a !== its[its.length - 1] ? `End: focus on ${a?.dataset?.tb || a?.tagName}, wanted ${its[its.length - 1].dataset.tb}` : ''; } });
  /* ==== end Build P ==== */

  /* ==== Build P (QC 40) · Obsidian callouts in the editor: drawn as one (icon, colour, title row, no [!type] text), the title
     edited as text, Enter into the body, Backspace back to a quote, the fold chevron, the "[!" type list, Build N's insert, a voice
     note inside one ==== */
  const CO_SUM = '> [!summary] Summary · Qwen3.5 4B · 17 Oct 2026\n> - The interview went well\n> - Follow up with **Maya** about [[Line length study]]';
  const coT = (h, i = 0) => h.doc.querySelectorAll('.callout > .callout-title')[i];
  const coEnd = i => h => { const t = coT(h, i); W.edPut(E('edLineEnd')(t)); return h.sleep(10); };
  const coStart = i => h => { const t = coT(h, i); W.edPut([t, 0]); return h.sleep(10); };
  const coPicked = () => W.document.querySelector('.co-pick') ? 'the type list is still open' : '';
  T('COL-01', 'Callouts', 'the AI summary callout: an icon and a title row, no "[!summary]" text', CO_SUM + '\n\nAfter‸', [], undefined, { undo: false, dom: d => {
    const q = d.querySelector('blockquote.callout[data-callout="summary"]'), t = q?.querySelector(':scope > .callout-title'), ic = t && W.getComputedStyle(t, '::before');
    return !q ? 'no callout drawn' : /\[!/.test(d.textContent) ? 'the [!summary] marker shows as text' : t.textContent !== 'Summary · Qwen3.5 4B · 17 Oct 2026' ? 'title: ' + show(t.textContent) : !/url\(/.test(ic.maskImage || ic.webkitMaskImage) ? 'no icon' : ''; } });
  T('COL-02', 'Callouts', 'type at the end of the title: saved in the title', CO_SUM, [coEnd(0), 'type: (edited)'], CO_SUM.replace('2026', '2026 (edited)'));
  T('COL-03', 'Callouts', 'Enter in the title: a body line under it, straight after the title in the .md', '> [!warning] Check the numbers\n> The ruler overspend.', [coEnd(0), 'key:Enter', 'type:New line'], '> [!warning] Check the numbers\n> New line\n>\n> The ruler overspend.');
  T('COL-04', 'Callouts', 'Enter mid-title: the rest of the title goes to the body', '> [!note] Title rest', [h => { const t = coT(h); W.edPut([t.firstChild, 5]); return h.sleep(10); }, 'key:Enter'], '> [!note] Title\n> rest', { probe: 'Z', wantTyped: '> [!note] Title\n> Zrest' });
  T('COL-05', 'Callouts', 'Shift+Enter in the title also starts the body (the title is one line)', '> [!tip] Tip', [coEnd(0), 'key:Shift+Enter', 'type:body'], '> [!tip] Tip\n> body');
  T('COL-06', 'Callouts', 'Backspace at the start of the title: a plain quote again, its title a line', '> [!warning] Check\n> Body', [coStart(0), 'key:Backspace'], '> Check\n>\n> Body', { dom: d => d.querySelector('.callout') ? 'still a callout' : '' });
  T('COL-07', 'Callouts', 'Backspace in an empty title: a plain quote with the body', '> [!bug]\n> Only the body', [coStart(0), 'key:Backspace'], '> Only the body');
  T('COL-08', 'Callouts', 'no title: the type’s name is drawn there (not saved)', '> [!bug]\n> body‸', [], '> [!bug]\n> body', { undo: false, dom: d => /bug/i.test(W.getComputedStyle(coT(H), '::after').content) ? '' : 'no type name: ' + W.getComputedStyle(coT(H), '::after').content });
  T('COL-09', 'Callouts', 'a [!type]- callout starts folded: the title shows, the body doesn’t', '> [!faq]- Folded question\n> Hidden answer.\n\nAfter‸', [], undefined, { undo: false, dom: d => {
    const q = d.querySelector('.callout'), b = q.querySelector(':scope > p:not(.callout-title)'); return !q.hasAttribute('data-folded') ? 'not folded' : W.getComputedStyle(b).display !== 'none' ? 'the body shows' : W.getComputedStyle(coT(H)).display === 'none' ? 'the title is hidden' : ''; } });
  T('COL-10', 'Callouts', 'the chevron unfolds it; the .md keeps "-" (a fold is a view)', '> [!faq]- Folded question\n> Hidden answer.\n\nAfter‸', [h => { const q = h.doc.querySelector('.callout'), b = q.getBoundingClientRect(); q.dispatchEvent(new W.MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0, clientX: b.right - 20, clientY: b.top + 14 })); return h.sleep(10); }],
    '> [!faq]- Folded question\n> Hidden answer.\n\nAfter', { undo: false, dom: d => d.querySelector('.callout').hasAttribute('data-folded') ? 'still folded' : '' });
  T('COL-11', 'Callouts', 'typing "[!" offers the types; Enter picks the first (Note); the line is its title', EMPTY_LINE, ['type:[!', h => { if (!W.document.querySelectorAll('.co-pick [data-co]').length) throw new Error('no type list'); }, 'key:Enter'], 'Before\n\n> [!note]', { undo: false, dom: coPicked, probe: 'My title', wantTyped: 'Before\n\n> [!note] My title' });
  T('COL-12', 'Callouts', 'typing "> [!wa" offers Warning; Tab picks it', EMPTY_LINE, ['type:> [!wa', h => { const it = [...W.document.querySelectorAll('.co-pick [data-co]')].map(b => b.textContent).join(); if (it !== 'Warning') throw new Error('list: ' + it); }, 'key:Tab'], 'Before\n\n> [!warning]', { undo: false, probe: 'T', wantTyped: 'Before\n\n> [!warning] T' });
  T('COL-13', 'Callouts', 'another name finds its type: "[!tl" offers Tldr (Summary)', EMPTY_LINE, ['type:[!tl', 'key:Enter'], 'Before\n\n> [!tldr]', { undo: false });
  T('COL-14', 'Callouts', 'ArrowDown, then Enter: the second type', EMPTY_LINE, ['type:[!', 'key:ArrowDown', 'key:Enter'], 'Before\n\n> [!summary]', { undo: false });
  T('COL-21', 'Callouts', 'Ctrl+Z after picking a type gives the typed "[!" back (as the list shortcuts do)', EMPTY_LINE, ['type:[!', 'key:Enter', 'key:Ctrl+z'], 'Before\n\n\\[!', { undo: false });
  T('COL-15', 'Callouts', 'Esc closes the list; the text stays as typed', EMPTY_LINE, ['type:[!no', 'key:Escape'], 'Before\n\n\\[!no', { undo: false, dom: coPicked });
  T('COL-16', 'Callouts', '"[!" on the first line of a plain quote makes that quote the callout', '<blockquote><p>‸<br></p><p>Body</p></blockquote>', ['type:[!', 'key:Enter', 'type:Title'], '> [!note] Title\n> Body', { undo: false });
  T('COL-22', 'Callouts', '"[!" on a line with a line break: the title is the first line, the rest its body', '<p>‸<br>Second line</p>', ['type:[!', 'key:Enter', 'type:Title'], '> [!note] Title\n> Second line', { undo: false });
  T('COL-17', 'Callouts', 'Build N’s Insert at the top puts a callout, drawn as one', 'Notes‸', [h => { W.ainInsert({ text: '- one\n- two', by: 'Qwen3.5 4B', q: '' }, h.n); return h.sleep(30); }],
    md => /^> \[!summary\] Summary · Qwen3\.5 4B · .+\n> - one\n> - two\n\nNotes$/.test(md) ? '' : 'wanted the summary callout on top', { focus: false, undo: false, dom: d => d.querySelector('.callout[data-callout="summary"] > .callout-title') && !/\[!summary/.test(d.textContent) ? '' : 'not drawn as a callout' });
  T('COL-18', 'Callouts', 'a voice note in a callout: its player inside it, and a line to type on after it (QC 34)', '> [!note] Voice note · 22:17\n>\n> ' + VE + '\n>\n> The transcript‸', [h => { const p = h.doc.lastElementChild; W.edPut([p, 0]); return h.sleep(10); }, 'type:After'],
    '> [!note] Voice note · 22:17\n>\n> ' + VE + '\n>\n> The transcript\n\nAfter', { undo: false, dom: d => d.querySelector('.callout .att-src, .callout [data-embed-for]') || d.querySelector('.callout .wikilink[data-wiki^="attachments/"]') ? '' : 'the player isn’t in the callout' });
  T('COL-19', 'Callouts', 'the types have their own colours (warning ≠ note ≠ success), every one an icon', '> [!note] N\n\n> [!warning] W\n\n> [!success] S\n\n> [!my-type] Unknown‸', [], undefined, { undo: false, dom: d => {
    const c = [...d.querySelectorAll('.callout > .callout-title')].map(t => W.getComputedStyle(t).color); return new Set(c.slice(0, 3)).size === 3 && c[3] === c[0] ? '' : 'colours: ' + c.join(' | '); } });
  T('COL-20', 'Callouts', 'the Quote button on a callout’s line takes the quote off; its title stays as a line', '> [!note] Title\n> Bo‸dy', 'fmt:quote', 'Title\n\nBody');
  /* ==== end Build P callouts ==== */

  /* ==== Build N (QC 51): a click below or beside the text, as in Word or Google Docs ====
     A press in the empty space below the last line: the caret at the end of the note (a new line after a table, a code block or
     a callout). A press left or right of a line: that line's start or end. Each case starts with the caret elsewhere (‸). */
  const clickAt = (where) => h => {
    const d = h.doc, r = d.getBoundingClientRect(), kids = [...d.children].filter(k => k.getClientRects().length), last = kids[kids.length - 1].getBoundingClientRect();
    const line = i => kids[i].getBoundingClientRect(), mid = b => b.top + Math.min(b.height / 2, 10);
    const [x, y] = where === 'below' ? [r.left + 40, last.bottom + 24] : where === 'farbelow' ? [r.left + r.width / 2, last.bottom + 120]
      : where === 'left0' ? [r.left - 10, mid(line(0))] : where === 'right0' ? [r.right + 10, mid(line(0))] : where === 'left1' ? [r.left - 10, mid(line(1))] : [r.right + 10, mid(line(1))];
    const t = W.document.elementFromPoint(x, y) || d, o = { bubbles: true, cancelable: true, button: 0, detail: 1, clientX: x, clientY: y };
    t.dispatchEvent(new W.MouseEvent('mousedown', o)); t.dispatchEvent(new W.MouseEvent('mouseup', o)); t.dispatchEvent(new W.MouseEvent('click', o));
    if (t.closest('.doc') && t !== h.doc) throw new Error('the press landed on the text, not beside or below it: ' + t.nodeName);
    return h.sleep(20);
  };
  T('CLK-01', 'Clicks', 'a press below the last line: the caret at the end of the note', '‸First line\n\nLast line', [clickAt('below'), 'type:Z'], 'First line\n\nLast lineZ', { undo: false });
  T('CLK-02', 'Clicks', 'a press far below the text (the page under it): the end of the note', 'One ‸line\n\nLast line', [clickAt('farbelow'), 'type:Z'], 'One line\n\nLast lineZ', { undo: false });
  T('CLK-03', 'Clicks', 'below a table at the end: a new line after it', '‸Intro\n\n| a | b |\n| --- | --- |\n| 1 | 2 |', [clickAt('below'), 'type:Z'], 'Intro\n\n| a | b |\n| --- | --- |\n| 1 | 2 |\n\nZ', { undo: false });
  T('CLK-04', 'Clicks', 'below a code block at the end: a new line after it', '‸Intro\n\n```\ncode here\n```', [clickAt('below'), 'type:Z'], 'Intro\n\n```\ncode here\n```\n\nZ', { undo: false });
  T('CLK-05', 'Clicks', 'below a callout at the end: a new line after it', '‸Intro\n\n> [!note] Title\n> Body', [clickAt('below'), 'type:Z'], 'Intro\n\n> [!note] Title\n> Body\n\nZ', { undo: false });
  T('CLK-06', 'Clicks', 'a press left of a line: that line’s start', 'First line\n\nLast line‸', [clickAt('left0'), 'type:Z'], 'ZFirst line\n\nLast line', { undo: false });
  T('CLK-07', 'Clicks', 'a press right of a line: that line’s end', '‸First line\n\nLast line', [clickAt('right0'), 'type:Z'], 'First lineZ\n\nLast line', { undo: false });
  T('CLK-08', 'Clicks', 'left of the second line: its start', '‸First line\n\nSecond line', [clickAt('left1'), 'type:Z'], 'First line\n\nZSecond line', { undo: false });
  T('CLK-09', 'Clicks', 'right of a heading: its end', '# Title‸\n\nBody text', [clickAt('right1'), 'type:Z'], '# Title\n\nBody textZ', { undo: false });
  T('CLK-10', 'Clicks', 'below a bullet list at the end: the end of its last item', '‸Intro\n\n- one\n- two', [clickAt('below'), 'type:Z'], 'Intro\n\n- one\n- twoZ', { undo: false });
  /* ==== end Build N (QC 51) ==== */


  /* ==== QC 115 · a block is picked up from anywhere on it (feedback: "icon dissapears when I try to get to it so I cannot drag anything,
     ideally we should just drag from anywhere on the ui elements"). The grip stays all the way to it, a file card is dragged from its
     body after 5 px, a click on Open stays a click, and text still selects. Synthetic pointer events, as the app's own sweep sends ==== */
  const DRG = '![[attachments/budget.docx]]', DRG_MD = 'Intro line\n\n' + DRG + '\n\n```js\nconst a = 1;\n```\n\nLast line‸', DRG_SAME = 'Intro line\n\n' + DRG + '\n\n```js\nconst a = 1;\n```\n\nLast line';
  const pe = (type, x, y, o) => new W.PointerEvent(type, Object.assign({ clientX: x, clientY: y, button: 0, buttons: type === 'pointerup' ? 0 : 1, bubbles: true, cancelable: true }, o || {}));
  const drgUnit = kind => W.blkUnits(H.doc).find(u => u.kind === kind);
  const drgGrip = () => W.document.querySelector('.blk-layer [data-blk-handle]');
  const drgReach = kind => async h => {   // over the block, then over its margin on the way to the grip: the grip stays
    const u = drgUnit(kind), b = W.blkRect(u), el = u.nodes.find(x => x.nodeType === 1); const BK = W.eval('BLK'); BK.hover = null; BK.leave = 0;
    el.dispatchEvent(pe('pointermove', b.left + 30, (b.top + b.bottom) / 2, { buttons: 0 })); const g = drgGrip(); if (!g) throw new Error('no grip over the ' + kind);
    const r = g.getBoundingClientRect(), gx = (r.left + r.right) / 2, gy = (r.top + r.bottom) / 2, sx = b.left + 30, sy = (b.top + b.bottom) / 2;
    for (let i = 1; i <= 12; i++) { const x = sx + (gx - sx) * i / 12, y = sy + (gy - sy) * i / 12, inside = x >= b.left && x <= b.right && y >= b.top && y <= b.bottom;
      (inside ? el : i === 12 ? g : H.doc.parentElement).dispatchEvent(pe('pointermove', x, y, { buttons: 0 })); if (!drgGrip()) throw new Error(`the grip vanished at step ${i} of 12 on the way to it`); }
    const at = W.document.elementFromPoint(gx, gy); if (!at?.closest('[data-blk-handle]')) throw new Error('something covers the grip: ' + (at?.className || at?.nodeName));
  };
  const gripIs = on => () => !!drgGrip() === on ? '' : on ? 'the grip is gone' : 'the grip is still there';
  T('DRG-01', 'Block drag', 'the grip beside a file card stays all the way to it (pointer over the margin, not the card)', DRG_MD, drgReach('attachment'), undefined, { undo: false, focus: false, dom: gripIs(true) });
  T('DRG-02', 'Block drag', 'the grip beside a code block stays all the way to it', DRG_MD, drgReach('code'), undefined, { undo: false, focus: false, dom: gripIs(true) });
  T('DRG-03', 'Block drag', 'the grip leaves only after the pointer has been away a moment', DRG_MD, [drgReach('attachment'), async h => { W.document.body.dispatchEvent(pe('pointermove', 2, 2, { buttons: 0 })); if (!drgGrip()) throw new Error('gone at once'); await h.sleep(500); }],
    undefined, { undo: false, focus: false, dom: gripIs(false) });
  const drgPress = (pick, dy) => async h => {   // a press on the card, a move of dy px (then on to the top of the note), and let go
    const card = drgUnit('attachment').nodes[0], el = pick(card), r = el.getBoundingClientRect(), top = W.blkRect(W.blkUnits(H.doc)[0]).top, x = r.left + Math.min(40, r.width / 2), y = r.top + Math.min(8, r.height / 2);
    const down = pe('pointerdown', x, y); el.dispatchEvent(down); if (down.defaultPrevented) throw new Error('the press was taken over');
    W.document.dispatchEvent(pe('pointermove', x + dy, y)); if (dy > 4) W.document.dispatchEvent(pe('pointermove', x, top - 6));
    W.document.dispatchEvent(pe('pointerup', x, dy > 4 ? top - 6 : y)); await h.sleep(10);
  };
  const cardFirst = md => md.indexOf('budget.docx') < md.indexOf('Intro line') && /Last line/.test(md) && md.includes('const a = 1;') ? '' : 'wanted the card above "Intro line", got ' + show(md);
  T('DRG-04', 'Block drag', 'a file card is dragged from its body (anywhere on it, 5 px): it goes to the top', DRG_MD, drgPress(c => c, 8), cardFirst, { undo: false, focus: false });
  T('DRG-05', 'Block drag', 'a file card is dragged from its Open button too (5 px)', DRG_MD, drgPress(c => c.querySelector('button, a, [data-act]') || c, 8), cardFirst, { undo: false, focus: false });
  T('DRG-06', 'Block drag', 'a press that moves 2 px is a click: nothing is picked up or moved', DRG_MD, drgPress(c => c, 2), DRG_SAME, { undo: false, focus: false, dom: () => W.eval('!!(BLK.drag || BLK.pend)') ? 'a drag is still on' : '' });
  T('DRG-07', 'Block drag', 'a click on the card\'s Open button still opens it, and the click that ends a drag does not', DRG_MD, [async h => {
    const btn0 = drgUnit('attachment').nodes[0].querySelector('button, a, [data-act]'); if (!btn0) throw new Error('no Open button on the card');
    let clicks = 0; const f = () => clicks++; btn0.addEventListener('click', f); W.eval('BLK').noClick = false;
    const r = btn0.getBoundingClientRect(), x = r.left + r.width / 2, y = r.top + r.height / 2;
    btn0.dispatchEvent(pe('pointerdown', x, y)); W.document.dispatchEvent(pe('pointermove', x + 1, y)); W.document.dispatchEvent(pe('pointerup', x, y)); btn0.dispatchEvent(new W.MouseEvent('click', { clientX: x, clientY: y, bubbles: true, cancelable: true }));
    if (clicks !== 1) throw new Error(clicks + ' clicks for a plain click');
    await h.sleep(30); const btn = drgUnit('attachment').nodes[0].querySelector('button, a, [data-act]'); btn.addEventListener('click', f);   // a click may redraw the note
    btn.dispatchEvent(pe('pointerdown', x, y)); W.document.dispatchEvent(pe('pointermove', x + 10, y + 4)); W.document.dispatchEvent(pe('pointermove', x + 12, y + 30)); W.document.dispatchEvent(pe('pointerup', x + 12, y + 30));
    btn.dispatchEvent(new W.MouseEvent('click', { clientX: x, clientY: y, bubbles: true, cancelable: true })); if (clicks !== 1) throw new Error('the click that ends a drag opened it too'); W.eval('BLK').noClick = false;
  }], undefined, { undo: false, focus: false });
  T('DRG-08', 'Block drag', 'pressing and dragging in a paragraph or in code still selects text: nothing taken over, nothing picked up', DRG_MD, [async h => {
    for (const el of [H.doc.querySelector('p'), H.doc.querySelector('pre code')]) { const r = el.getBoundingClientRect(), x = r.left + 12, y = r.top + 8, down = pe('pointerdown', x, y);
      el.dispatchEvent(down); W.document.dispatchEvent(pe('pointermove', x + 6, y)); W.document.dispatchEvent(pe('pointermove', x + 40, y + 2));
      if (down.defaultPrevented || W.eval('!!(BLK.pend || BLK.drag)') || W.document.body.classList.contains('is-blk-drag')) throw new Error('the press in ' + el.nodeName + ' was taken over');
      const t = W.document.createTreeWalker(el, NodeFilter.SHOW_TEXT).nextNode(); H.doc.focus(); W.getSelection().setBaseAndExtent(t, 0, t, 3); W.document.dispatchEvent(pe('pointerup', x + 40, y + 2));
      if (W.getSelection().toString().length !== 3) throw new Error('the selection did not stay in ' + el.nodeName); }
  }], DRG_SAME, { undo: false });
  /* ==== end QC 115 ==== */

  /* ================= Go ================= */
  (async () => {
    try { await bootApp(); } catch (e) { REPORT.textContent = 'FAIL: the app did not start: ' + e; document.title = 'Editor behaviour: FAIL (no app)'; return; }
    for (const c of C.filter(c => !ONLY || ONLY.split(',').some(p => c.id.startsWith(p)))) {   // only=TBL or only=MT,ACR,ENT (short runs: a hidden pane throttles a long one)
      let done = false;
      await Promise.race([runCase(c).catch(e => record(c, c.id, c.name, ['the runner threw ' + (e && e.stack || e)])).then(() => { done = true; }),
        sleep(8000).then(() => { if (!done) record(c, c.id, c.name, ['timed out after 8 s']); })]);
    }
    paint(true);
    window.__editorResults = results;
    window.__editor = { H, cases: C, runCase, setup, run, readMd };   // for debugging one case from the console
  })();
})();
