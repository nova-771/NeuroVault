/* NeuroVault: Markdown ⇄ HTML for the Word/Docs editor.

   NVMarkdown.mdToHtml(md, { renderTasks })  → safe HTML for the editor (.doc)
   NVMarkdown.htmlToMd(htmlOrElement)        → Markdown to save
   NVMarkdown.sanitize(html)                 → safe HTML (the same cleaner mdToHtml uses)

   Needs, loaded first: vendor/marked-18.0.14.umd.js (window.marked) and
   vendor/turndown-7.2.4.browser.umd.js (window.TurndownService). No network use.

   What a note can hold, and how it looks in each form:
     Markdown (GFM)   headings, paragraphs, **bold**, *italic*, ~~strike~~, `code`, fenced code,
                      - bullets, 1. numbers, - [ ] tasks, > quotes, tables, [links](url), ![images](src), ---
     NeuroVault       [[wiki links]] → span.wikilink[data-wiki]   #tags → span.tag[data-tag]
                      {{tasks}} (a line of its own) → div.md-tasks[data-md=tasks], filled by opts.renderTasks()
                      front matter (--- yaml --- at the top) → pre.md-frontmatter[data-md=frontmatter]
     HTML extensions  <u>, <mark class="hl-*">, <span class="tc-*">, <sub>, <sup>, <kbd>,
     (kept as HTML    <div align="center|right|justify"> … </div> around blocks, <details><summary>,
      in the .md)     <!-- comments -->, <img … width height>

   Line spacing is kept: a block followed directly by the next (no blank line) gets data-tight, and
   htmlToMd writes it back without the blank line, but only where Markdown reads it back the same way.

   Safety: everything from a note goes through sanitize(), an allow-list run in an inert document
   (DOMParser: no scripts run, no images load, no handlers fire while it works).
     - Only the tags and attributes listed in ALLOWED survive. No on* handlers, no style, no id/name.
     - href/src must be http(s), mailto, tel, a relative path or #anchor (images may also be data:image/*).
       Any other URL (javascript:, data:text/html, vbscript:, file:, custom schemes) is moved to an inert
       data-nv-href / data-nv-src attribute, so it is kept in the .md but can't be followed or loaded.
     - script, style, iframe, object, svg, math, form and the like never reach the page. When they come
       from the .md file they are shown as inert text (span.md-raw) so saving doesn't lose them; when they
       come from the editor (a paste) they are dropped.
     - The result is re-parsed and cleaned until it no longer changes, so a parser round trip can't turn
       it into something else (mutation XSS).
   The app's own task HTML (opts.renderTasks) is added after cleaning, so it is the app's job to escape it.

   For the editor: pass the .doc element itself to htmlToMd (checkbox ticks live in properties, not in
   innerHTML), set document.execCommand('defaultParagraphSeparator', false, 'p'), and give editor-only
   decorations data-md-ignore so they aren't saved. Links should open through the app (http/https/mailto
   only), never by letting the WebView follow them. */
(function (root) {
  'use strict';
  const marked = root.marked, TurndownService = root.TurndownService;
  if (!marked || !TurndownService) throw new Error('markdown.js needs vendor/marked and vendor/turndown loaded first');

  const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  const TAG_RE = /^#([\p{L}\p{N}_\/-]*[\p{L}_\/-][\p{L}\p{N}_\/-]*)/u;   // like Obsidian: at least one non-digit
  const WIKI_RE = /^\[\[([^\[\]\n]+?)\]\]/;
  const TASKS_LINE = /^\{\{tasks\}\}[ \t]*(?:\n|$)(?:[ \t]*\n)*/;   // the line, and any blank lines after it (as marked's headings do)

  /* ================= Sanitiser ================= */
  const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);   // never match built-ins like constructor or __proto__
  const URL_ATTR = { A: 'href', IMG: 'src' };
  const ALLOWED = {   // tag → attributes it may keep (class, data-* and align are checked separately)
    P: [], DIV: [], BR: [], HR: [], H1: [], H2: [], H3: [], H4: [], H5: [], H6: [],
    STRONG: [], B: [], EM: [], I: [], DEL: [], S: [], STRIKE: [], U: [], INS: [], MARK: [], SPAN: [], SUB: [], SUP: [], KBD: [],
    CODE: [], PRE: [], BLOCKQUOTE: [], UL: [], OL: ['start'], LI: [], INPUT: ['type', 'checked'],
    TABLE: [], THEAD: [], TBODY: [], TFOOT: [], TR: [], TH: ['colspan', 'rowspan'], TD: ['colspan', 'rowspan'],   // Build P: merged cells
    COLGROUP: [], COL: ['width'],   // Build P: column widths
    A: ['href', 'title'], IMG: ['src', 'alt', 'title', 'width', 'height'], DETAILS: ['open'], SUMMARY: [],
  };
  const ALIGN_TAGS = new Set(['P', 'DIV', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'TH', 'TD']);
  // Never rendered, even as an empty shell: their content is code, styling, embedded documents or form controls
  const DANGEROUS = new Set(['SCRIPT', 'STYLE', 'IFRAME', 'FRAME', 'FRAMESET', 'OBJECT', 'EMBED', 'APPLET', 'PARAM', 'LINK', 'META', 'BASE',
    'FORM', 'TEXTAREA', 'SELECT', 'OPTION', 'OPTGROUP', 'BUTTON', 'SVG', 'MATH', 'TEMPLATE', 'NOSCRIPT', 'NOEMBED', 'NOFRAMES', 'TITLE', 'HEAD',
    'XMP', 'PLAINTEXT', 'LISTING', 'AUDIO', 'VIDEO', 'SOURCE', 'TRACK', 'CANVAS', 'PORTAL', 'DIALOG', 'SLOT', 'MARQUEE', 'IMAGE', 'FENCEDFRAME', 'SEARCH', 'OUTPUT']);
  const CLASS_OK = /^(?:wikilink|tag|md-tasks|md-frontmatter|md-raw|task-list-item|hl-[a-z]{1,20}|tc-[a-z]{1,20}|language-[\w#+.-]{1,40}|callout|callout-title)$/;   // callout: Build P (QC 40)
  const DATA_OK = {
    'data-wiki': v => v.length <= 500, 'data-tag': v => TAG_RE.test('#' + v), 'data-md': v => /^(?:tasks|frontmatter|raw|angle)$/.test(v),
    'data-tight': v => v === '', 'data-lang': v => /^[\w #+.-]{0,40}$/.test(v), 'data-nv-href': () => true, 'data-nv-src': () => true, 'data-raw': () => true,
    // Build P (R48c): a rich table's cell colours (theme names), vertical alignment and borders
    'data-nv-bg': v => own(NV_BG, v), 'data-nv-fg': v => own(NV_FG, v), 'data-nv-va': v => v === 'middle' || v === 'bottom', 'data-nv-borders': v => v === 'outer' || v === 'none',   // all is the default: kept out of the editor, so a table reads the same both ways
    // Build P (QC 40): an Obsidian callout's type as written (any case), its fold marker, and whether it shows folded now
    'data-callout': v => CALLOUT_TYPE.test(v), 'data-callout-fold': v => v === '+' || v === '-', 'data-folded': v => v === '',
  };
  /* ==== Build P · rich tables (mockup R48c) ====
     A table keeps to Markdown until it uses what Markdown can't store (merged cells, column widths, cell colours, vertical
     alignment, borders, a list or a checkbox in a cell). Then it's saved as an HTML <table>: colours as theme names
     (data-nv-bg / data-nv-fg) with a style="background / color" fallback so Obsidian shows them, vertical-align and
     text-align in style, borders as data-nv-borders, widths as <colgroup><col style="width:Npx">. The text in each cell
     stays Markdown (**bold**, [[links]]); lists and checkboxes are HTML. The fallback colours are the light theme's. */
  const NV_BG = { yellow: '#fbe7a1', green: '#cdebc5', blue: '#cfe0f7', pink: '#f6d0dc', orange: '#fbd6b4' };
  const NV_FG = { red: '#b42318', orange: '#a14a07', green: '#157f3c', blue: '#1d4ed8', violet: '#5b3fd6', grey: '#5d6470' };
  const hexName = (map, v) => { v = String(v || '').trim().toLowerCase(); const m = /^rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)$/.exec(v);
    if (m) v = '#' + m.slice(1).map(x => (+x).toString(16).padStart(2, '0')).join(''); return Object.keys(map).find(k => map[k] === v) || ''; };
  // The style a rich table is saved with becomes the attributes the editor keeps (style itself never survives cleaning)
  function richStyle(el, tag) {
    const st = el.getAttribute('style') || '', get = p => ((st.match(new RegExp('(?:^|;)\\s*' + p + '\\s*:\\s*([^;]+)', 'i')) || [])[1] || '').trim();
    if (tag === 'COL') { const w = /^(\d{1,5})(?:px)?$/i.exec(get('width')); if (w && !el.hasAttribute('width')) el.setAttribute('width', w[1]); return; }
    if (tag !== 'TD' && tag !== 'TH') return;
    const va = get('vertical-align').toLowerCase(); if ((va === 'middle' || va === 'bottom') && !el.hasAttribute('data-nv-va')) el.setAttribute('data-nv-va', va);
    const bg = hexName(NV_BG, get('background-color') || get('background')); if (bg && !el.hasAttribute('data-nv-bg')) el.setAttribute('data-nv-bg', bg);
    const fg = hexName(NV_FG, get('color')); if (fg && !el.hasAttribute('data-nv-fg')) el.setAttribute('data-nv-fg', fg);
  }
  /* ==== end Build P ==== */
  const SIZE_RE = /^\d{1,5}(?:%|px)?$/;
  const INVISIBLE = /[\u0000- \u007f-\u009f\u00ad\u061c\u115f\u1160\u17b4\u17b5\u180e\u200b-\u200f\u2028-\u202e\u2060-\u206f\u3164\ufeff\uffa0]/g;
  const DATA_IMG = /^data:image\/(?:png|gif|jpe?g|webp|bmp|avif|svg\+xml)[;,]/i;

  /* Is this URL safe to follow (a) or load (img)? Browsers drop tabs, newlines and leading control
     characters before reading a scheme, so they are removed here before looking for one. */
  function safeUrl(url, forImage) {
    const s = String(url).replace(INVISIBLE, '');
    const m = s.match(/^([^\/?#]*?):/);
    if (!m) return true;                                   // relative path, #anchor, ?query or //host
    const scheme = m[1].toLowerCase();
    if (scheme === 'http' || scheme === 'https') return true;
    if (!forImage && (scheme === 'mailto' || scheme === 'tel')) return true;
    return forImage && scheme === 'data' && DATA_IMG.test(s);
  }

  let parser = null;
  function inertDoc(html) {   // DOMParser documents never run scripts, load images or fire handlers
    parser = parser || new DOMParser();
    return parser.parseFromString('<!doctype html><html><head></head><body>' + (html || '') + '</body></html>', 'text/html');
  }

  /* Cleans every node under root in place. keepBlocked: show dangerous elements as inert text (content
     from the .md file) instead of dropping them (content from the editor). */
  function cleanTree(root, keepBlocked) {
    const doc = root.ownerDocument;
    const walk = parent => {
      let child = parent.firstChild;
      while (child) {
        const next = child.nextSibling;
        if (child.nodeType === 1) cleanElement(child, keepBlocked, doc, walk);
        else if (child.nodeType !== 3 && child.nodeType !== 8) child.remove();   // keep text and comments (inert)
        child = next;
      }
    };
    walk(root);
  }
  function cleanElement(el, keepBlocked, doc, walk) {
    const tag = el.nodeName.toUpperCase();
    if (el.namespaceURI !== 'http://www.w3.org/1999/xhtml' || DANGEROUS.has(tag)) {
      if (keepBlocked) {
        const raw = doc.createElement('span');
        raw.className = 'md-raw'; raw.setAttribute('data-md', 'raw');
        raw.textContent = el.outerHTML;
        raw.setAttribute('data-raw', el.outerHTML);   // turndown squashes whitespace in text; the attribute keeps it exact
        el.replaceWith(raw);
      } else el.remove();
      return;
    }
    if (!own(ALLOWED, tag)) {   // unknown but harmless (font, center, section…): keep the content, lose the tag
      walk(el);
      el.replaceWith(...el.childNodes);
      return;
    }
    if (tag === 'INPUT' && (el.getAttribute('type') || '').toLowerCase() !== 'checkbox') { el.remove(); return; }
    // alignment written as style="text-align" (Chrome) or data-align (mockup) becomes align
    if (ALIGN_TAGS.has(tag) && !el.hasAttribute('align')) {
      const a = (el.getAttribute('data-align') || ((el.getAttribute('style') || '').match(/text-align\s*:\s*([a-z]+)/i) || [])[1] || '').toLowerCase();
      if (a) el.setAttribute('align', a);
    }
    if (tag === 'TD' || tag === 'TH' || tag === 'COL') richStyle(el, tag);   // Build P
    for (const attr of [...el.attributes]) {
      const name = attr.name.toLowerCase(), v = attr.value;
      let ok = false;
      if (ALLOWED[tag].includes(name)) ok = true;
      else if (name === 'class') {
        const kept = v.split(/\s+/).filter(c => CLASS_OK.test(c));
        if (kept.length) { el.setAttribute('class', kept.join(' ')); continue; }
      } else if (name === 'align') ok = ALIGN_TAGS.has(tag) && /^(?:left|center|right|justify)$/i.test(v);
      else if (own(DATA_OK, name)) ok = DATA_OK[name](v);
      if (ok && own(URL_ATTR, tag) && name === URL_ATTR[tag] && !safeUrl(v, tag === 'IMG')) {   // keep the address, inert
        el.setAttribute(tag === 'IMG' ? 'data-nv-src' : 'data-nv-href', v);
        ok = false;
      }
      if (ok && name === 'start') ok = /^\d{1,9}$/.test(v);
      if (ok && name === 'type') ok = v.toLowerCase() === 'checkbox';
      if (ok && (name === 'width' || name === 'height')) ok = SIZE_RE.test(v);
      if (ok && (name === 'colspan' || name === 'rowspan')) ok = /^[1-9]\d{0,2}$/.test(v);   // Build P
      if (!ok) el.removeAttribute(attr.name);
    }
    if (tag === 'IMG' && !el.hasAttribute('src') && !el.hasAttribute('data-nv-src')) { el.remove(); return; }
    walk(el);
  }

  /* Clean, serialise, re-parse: repeat until the HTML stops changing (guards against parser round trips) */
  function sanitizeHtml(html, keepBlocked) {
    let out = String(html == null ? '' : html);
    for (let i = 0; i < 4; i++) {
      const body = inertDoc(out).body;
      cleanTree(body, keepBlocked);
      const next = body.innerHTML;
      if (next === out) return out;
      out = next;
    }
    const body = inertDoc(out).body; body.textContent = out; return body.innerHTML;   // never stabilised: show as text
  }

  /* ================= Markdown → HTML (marked) ================= */
  const base = new marked.Renderer();
  const tight = (html, tok) => tok && tok.nvTight ? html.replace(/^<([a-z][a-z0-9]*)/, '<$1 data-tight=""') : html;
  const withTight = name => function (tok) { return tight(base[name].call(this, tok), tok); };

  let tasksAt = [], lexLength = 0;   // set by mdToHtml before each lex: where the {{tasks}} lines are
  const md = new marked.Marked({ gfm: true, breaks: true, async: false });
  md.use({
    extensions: [
      { name: 'nvTasks', level: 'block',
        // Where the next {{tasks}} line is, so a paragraph above it stops there. marked asks at every paragraph with
        // the rest of the note (minus its first character); the lines were found once (tasksAt), so this is a lookup.
        start(src) {
          if (!tasksAt.length || !this.lexer.state.top) return;
          const from = lexLength - src.length;   // where src starts in the note
          let lo = 0, hi = tasksAt.length;
          while (lo < hi) { const mid = (lo + hi) >> 1; if (tasksAt[mid] < from) lo = mid + 1; else hi = mid; }
          const at = lo < tasksAt.length ? tasksAt[lo] - from : -1;
          return at > 0 && src[at - 1] === '\n' && src.startsWith('{{tasks}}', at) ? at : undefined;
        },
        tokenizer(src) { const m = TASKS_LINE.exec(src); if (m) return { type: 'nvTasks', raw: m[0] }; },
        renderer(tok) { return tight('<div class="md-tasks" data-md="tasks"></div>\n', tok); } },
      { name: 'nvWiki', level: 'inline',
        // no start(): marked's plain-text scan already stops at every [
        tokenizer(src) { const m = WIKI_RE.exec(src); if (m) return { type: 'nvWiki', raw: m[0], inner: m[1] }; },
        renderer(tok) { return `<span class="wikilink" data-wiki="${esc(tok.inner.split('|')[0].trim())}">[[${esc(tok.inner)}]]</span>`; } },
      { name: 'nvTag', level: 'inline',
        // Looks 2 KB ahead at most, so long paragraphs stay linear. With no # there, plain text stops after the window's
        // last space instead (marked joins the pieces back into one text), and the next call looks further.
        start(src) {
          const w = src.length > 2048 ? src.slice(0, 2048) : src;
          const m = w.match(/(?:^|[\s(])#[\p{L}\p{N}_\/-]/u);
          if (m) return m.index + m[0].indexOf('#');
          if (w.length < src.length) { const ws = w.search(/\s\S*$/); return ws > 0 ? ws + 1 : undefined; }
        },
        tokenizer(src, tokens) {
          const prev = tokens.length ? tokens[tokens.length - 1].raw : '';
          if (prev && !/[\s(]$/.test(prev)) return;   // C#, x#y and URL fragments are not tags
          const m = TAG_RE.exec(src);
          if (m) return { type: 'nvTag', raw: m[0], name: m[1] };
        },
        renderer(tok) { return `<span class="tag" data-tag="${esc(tok.name)}">#${esc(tok.name)}</span>`; } },
    ],
    renderer: {
      paragraph: withTight('paragraph'), heading: withTight('heading'), list: withTight('list'),
      blockquote(tok) { return tight(calloutHtml.call(this, tok) || base.blockquote.call(this, tok), tok); },   // Build P (QC 40): callouts
      code: withTight('code'), hr: withTight('hr'),
      table(tok) { return tight(base.table.call(this, tok).replace(/>\n+</g, '><'), tok); },   // Build P: no text between a table's rows, as a rich table loads
      checkbox({ checked }) { return `<input type="checkbox"${checked ? ' checked' : ''}> `; },
      listitem(item) {
        // Editor QC: "- [ ]" with nothing after it is an empty task (as Obsidian shows it), so a task saved before its text was typed comes back as a task
        const empty = !item.task && /^\[([ xX])\]$/.exec((item.text || '').trim());
        if (empty && (item.tokens || []).every(t => t.type === 'text' || t.type === 'paragraph')) return `<li class="task-list-item"><input type="checkbox"${empty[1] === ' ' ? '' : ' checked'}> </li>
`;
        return base.listitem.call(this, item).replace(/^<li>/, item.task ? '<li class="task-list-item">' : '<li>');
      },
      // Addresses are kept as written (not URL-encoded) so they come back unchanged; sanitize() checks them
      link(tok) {
        const text = tok.tokens ? this.parser.parseInline(tok.tokens) : esc(tok.text);
        const angle = /^<[^>]*>$/.test(tok.raw) ? ' data-md="angle"' : '';
        return `<a href="${esc(tok.href)}"${tok.title ? ` title="${esc(tok.title)}"` : ''}${angle}>${text}</a>`;
      },
      image(tok) { return `<img src="${esc(tok.href)}" alt="${esc(tok.text)}"${tok.title ? ` title="${esc(tok.title)}"` : ''}>`; },
      html(tok) { return tok.block && RICH_SRC.test(tok.text) ? richTableHtml(tok.text) : tok.text; },   // Build P
    },
  });
  /* ==== Build P · a rich (HTML) table from the .md: its cells hold Markdown, so each cell is read as a line of Markdown
     (bold, links, [[wiki links]], #tags), as a Markdown table's cells are. Lists and checkboxes in a cell are HTML and stay.
     A cell holding a code block, a quote, a fold or another table is left as written. ==== */
  /* ---- Build P (QC 40) · Obsidian callouts: "> [!type]± Title" then the body. The editor holds them as
     <blockquote class="callout" data-callout="type" [data-callout-fold="±"]> <p class="callout-title">Title</p> …body </blockquote>:
     the [!type] marker lives in the attributes, so it's never text you can break, and the title stays editable text.
     data-tight on the title: the body starts on the very next line (no "> " line between). "-" draws it folded (data-folded). ---- */
  const CALLOUT_TYPE = /^[A-Za-z][\w-]{0,39}$/;
  const CALLOUT_RE = /^\[!([A-Za-z][\w-]{0,39})\]([+-]?)(?:[ \t]+([^\n]*?))?[ \t]*(?:\n([\s\S]*))?$/;
  function calloutHtml(tok) {
    const first = tok.tokens && tok.tokens[0], m = first && first.type === 'paragraph' && CALLOUT_RE.exec(first.text); if (!m) return '';
    const type = m[1], fold = m[2], title = m[3] || '', rest = m[4];
    let body = tok.tokens.slice(1), titleTight = !!first.nvTight;
    if (rest && rest.trim()) {   // body lines straight under the title were read as the same paragraph
      tasksAt = []; const more = md.lexer(rest); flagTight(more);
      if (more.length) more[more.length - 1].nvTight = first.nvTight;
      body = more.concat(body); titleTight = true;
    }
    return `<blockquote class="callout" data-callout="${type}"${fold ? ` data-callout-fold="${fold}"` : ''}${fold === '-' ? ' data-folded=""' : ''}>`
      + `<p class="callout-title" data-callout="${type}"${titleTight ? ' data-tight=""' : ''}>${title ? md.parseInline(title) : ''}</p>\n${this.parser.parse(body)}</blockquote>\n`;   // the type on the title too: it's drawn there when there's no title
  }
  const RICH_SRC = /^\s*<table[\s>][\s\S]*<\/table>\s*$/i;
  function richTableHtml(src) {
    const body = inertDoc(src).body, t = body.querySelector('table'); if (!t) return src;
    // as the editor holds a table: no text between its rows, and a first row of header cells in <thead> (unless a cell spans down)
    t.querySelectorAll('colgroup, thead, tbody, tfoot, tr').forEach(el => [...el.childNodes].forEach(n => { if (n.nodeType === 3 && !n.data.trim()) n.remove(); }));
    [...t.childNodes].forEach(n => { if (n.nodeType === 3 && !n.data.trim()) n.remove(); });
    const r0 = t.rows[0];
    if (r0 && !t.tHead && r0.parentElement.nodeName === 'TBODY' && r0.cells.length && [...r0.cells].every(c => c.nodeName === 'TH' && c.rowSpan <= 1)) t.createTHead().append(r0);
    t.querySelectorAll('th, td').forEach(cell => {
      if (cell.closest('table') !== t || cell.querySelector('pre, table, blockquote, details')) return;
      try { cell.innerHTML = md.parseInline(cell.innerHTML.trim()); } catch (e) { /* left as written */ }
    });
    return body.innerHTML + '\n';
  }
  /* ==== end Build P ==== */

  /* A block followed directly by another block, with no blank line between them. marked keeps blank lines either
     as a space token or at the end of the block's own raw text (headings, lists), so both are checked. */
  function flagTight(tokens) {
    for (let i = 0; i < tokens.length; i++) {
      const t = tokens[i], n = tokens[i + 1];
      const tail = t.raw.slice(t.raw.trimEnd().length), blank = (tail.match(/\n/g) || []).length >= 2;
      if (t.type !== 'space' && t.type !== 'def' && n && n.type !== 'space' && n.type !== 'def' && !blank) t.nvTight = true;
      if (t.type === 'blockquote' && t.tokens) flagTight(t.tokens);
    }
  }

  /* Front matter: a --- line, YAML, a --- line, at the very top */
  function splitFrontMatter(src) {
    const m = /^---[ \t]*\n([\s\S]*?)\n---[ \t]*(?:\n|$)/.exec(src);
    if (!m) return { front: null, body: src, tight: false };
    const body = src.slice(m[0].length);
    return { front: m[1], body: body.replace(/^\n+/, ''), tight: !!body && !/^\n/.test(body) };
  }

  function mdToHtml(src, opts) {
    opts = opts || {};
    src = String(src == null ? '' : src).replace(/\r\n?/g, '\n');
    const fm = splitFrontMatter(src);
    let html;
    try {
      tasksAt = []; lexLength = fm.body.length;
      for (const m of fm.body.matchAll(/\n\{\{tasks\}\}[ \t]*(?=\n|$)/g)) tasksAt.push(m.index + 1);
      const tokens = md.lexer(fm.body);
      flagTight(tokens);
      html = md.parser(tokens);
    } catch (e) {   // marked should never throw; if it does, show the text rather than lose it
      html = fm.body.split(/\n{2,}/).map(p => `<p>${esc(p).replace(/\n/g, '<br>')}</p>`).join('');
    }
    // (the leading \n: the HTML parser drops a newline right after <pre>)
    if (fm.front !== null) html = `<pre class="md-frontmatter" data-md="frontmatter"${fm.tight ? ' data-tight=""' : ''}>\n${esc(fm.front)}</pre>` + html;
    html = sanitizeHtml(html, true);
    if (!/data-md="(?:tasks|frontmatter|raw)"/.test(html)) return html;
    const body = inertDoc(html).body;   // already clean; only marks the app-owned blocks read-only and fills tasks
    body.querySelectorAll('[data-md="tasks"], [data-md="frontmatter"], [data-md="raw"]').forEach(el => el.setAttribute('contenteditable', 'false'));
    if (typeof opts.renderTasks === 'function') body.querySelectorAll('[data-md="tasks"]').forEach(el => { el.innerHTML = opts.renderTasks() || ''; });
    return body.innerHTML;
  }

  /* ================= HTML → Markdown (turndown) ================= */
  const BLOCK = new Set(['P', 'DIV', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'HR', 'PRE', 'BLOCKQUOTE', 'UL', 'OL', 'TABLE', 'DETAILS']);
  const PUNCT = /[!-\/:-@\[-`{-~]/;
  const isWs = c => c === undefined || c === '' || /\s/.test(c);
  const isAlnum = c => !!c && /[\p{L}\p{N}]/u.test(c);
  const alignOf = el => (el.getAttribute && (el.getAttribute('align') || '').toLowerCase()) || '';

  /* Could this [ start a link, image, wiki link or task box? Only when its ] is followed by ( [ or :, when it is
     [[, when it opens a task box ([ ] or [x] at the start), or when its ] isn't in this text (it may close in the
     next node, as in [a<b>b</b>](url)). "Fix [object Object] now" needs no escape. */
  function bracketPlan(s) {   // one pass: pair each [ with its ], then answer per [ in O(1)
    const close = new Map(), open = [];
    for (let j = 0; j < s.length; j++) {
      if (s[j] === '[') open.push(j);
      else if (s[j] === ']' && open.length) close.set(open.pop(), j);
    }
    return i => s[i + 1] === '[' || s[i - 1] === '!' || (i === 0 && /^\[[ xX]\]/.test(s)) || !close.has(i) || /[(\[:]/.test(s[close.get(i) + 1] || '');
  }
  const ENTITY = /&#?[A-Za-z0-9]+;/y;

  /* Escape only what Markdown would otherwise read as syntax. Called once per text node. */
  function escapeText(s) {
    let out = '';
    const bracketOpens = s.includes('[') ? bracketPlan(s) : null;
    for (let i = 0; i < s.length; i++) {
      const c = s[i], p = s[i - 1], n = s[i + 1];
      if (c === '\\') out += PUNCT.test(n || '') ? '\\\\' : '\\';
      else if (c === '`') out += '\\`';
      else if (c === '*' || c === '~') out += (isWs(p) && p !== undefined && isWs(n) && n !== undefined) ? c : '\\' + c;
      else if (c === '_') out += ((isAlnum(p) && isAlnum(n)) || (p !== undefined && n !== undefined && isWs(p) && isWs(n))) ? c : '\\_';
      else if (c === '[') out += bracketOpens(i) ? '\\[' : c;
      else if (c === '<') out += /[A-Za-z\/!?]/.test(n || '') ? '\\<' : c;
      else if (c === '&') { ENTITY.lastIndex = i; out += ENTITY.test(s) ? '\\&' : c; }
      else if (c === '\u00a0') out += (p !== undefined && n !== undefined && !/[\s\u00a0]/.test(p) && !/[\s\u00a0]/.test(n)) ? '&nbsp;' : ' ';
      else out += c;
    }
    // at the start of a line (a text node can start one: after <br> or as a block's first text)
    return out
      .replace(/^(#{1,6})(?=[ \t]|$)/, '\\$1')
      .replace(/^>/, '\\>')
      .replace(/^([-+])(?=[ \t]|$)/, '\\$1')
      .replace(/^(=+|-+)[ \t]*$/, m => '\\' + m)
      .replace(/^(\d+)([.)])(?=[ \t]|$)/, '$1\\$2')
      .replace(/^\{\{tasks\}\}/, '\\{{tasks}}');
  }
  /* Inside a heading or a table cell no block can start, so escapeText's line-start escapes aren't needed there
     ("## 1. Profile" stays as typed). A lone # or - keeps its backslash: "## #" would be an empty heading. */
  const inlineStarts = s => s
    .replace(/^\\(#{1,6}|[-+])(?=[ \t]+\S)/gm, '$1')
    .replace(/^\\>/gm, '>')
    .replace(/^(\d+)\\([.)])/gm, '$1$2');

  const svc = new TurndownService({ headingStyle: 'atx', hr: '---', bulletListMarker: '-', codeBlockStyle: 'fenced', fence: '```',
    emDelimiter: '*', strongDelimiter: '**', linkStyle: 'inlined', br: '',
    // Editor QC: an empty code block is kept (turndown drops an element with no text before any rule sees it)
    blankReplacement: (c, node) => node.nodeName === 'PRE' ? block(node, '```' + codeLang(node) + '\n```') : isCallout(node) ? calloutMd(node, '') : node.isBlock ? '\n\n' : '' });   // Build P (QC 40): "> [!note]" alone is kept
  svc.escape = escapeText;

  function linkDest(href) {   // <…> when the address has spaces or unbalanced brackets
    let depth = 0, balanced = true;
    for (const c of href) { if (c === '(') depth++; else if (c === ')' && --depth < 0) balanced = false; }
    if (depth) balanced = false;
    if (/[\s<>]/.test(href) || !balanced || !href) return '<' + href.replace(/[<>]/g, m => encodeURIComponent(m)) + '>';
    return href;
  }
  const linkTitle = t => t ? ' "' + t.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"' : '';
  const hrefOf = el => el.getAttribute('href') || el.getAttribute('data-nv-href') || '';
  const srcOf = el => el.getAttribute('src') || el.getAttribute('data-nv-src') || '';

  function preText(node) {   // code as typed: <br> and block children are line breaks
    let s = '';
    node.childNodes.forEach(c => {
      if (c.nodeType === 3) s += c.nodeValue;
      else if (c.nodeName === 'BR') s += '\n';
      else if (c.nodeType === 1) { const block = c.nodeName === 'DIV' || c.nodeName === 'P'; if (block && s && !s.endsWith('\n')) s += '\n'; s += preText(c); if (block && !s.endsWith('\n')) s += '\n'; }
    });
    return s;
  }
  function codeLang(pre) {
    const code = pre.querySelector('code');
    const cls = ((code && code.getAttribute('class')) || '').match(/language-(\S+)/);
    let lang = cls ? cls[1] : (pre.getAttribute('data-lang') || '');
    if (/^plain ?text$/i.test(lang)) lang = '';
    return lang.trim().toLowerCase().replace(/\s+/g, '-');
  }

  /* --- spacing between blocks: a blank line, or a single newline where the note had none and Markdown reads it back
     the same. Each block works out its own newlines from its neighbours, and turndown joins on the larger of the two,
     so every node is converted exactly once (nested quotes, folds and aligned blocks stay linear). --- */
  function kindOf(el) {
    const t = el.nodeName, md = el.getAttribute('data-md');
    if (md === 'tasks') return 'tasks';
    if (/^H[1-6]$/.test(t)) return alignOf(el) && alignOf(el) !== 'left' ? 'html' : 'heading';
    if (t === 'P' || t === 'DIV') return alignOf(el) && (t === 'DIV' || alignOf(el) !== 'left') ? 'html' : 'p';
    if (t === 'TABLE') return tableIsHtml(el) ? 'html' : 'table';   // Build P: a rich table is an HTML block (it needs its blank lines)
    return { HR: 'hr', PRE: 'pre', BLOCKQUOTE: 'quote', UL: 'ul', OL: 'ol' }[t] || 'html';
  }
  function canInterruptParagraph(el, kind) {
    if (['heading', 'pre', 'quote', 'tasks', 'html'].includes(kind)) return true;
    if (kind === 'ul' || kind === 'ol') {
      const first = el.querySelector(':scope > li');
      return !!first && !!first.textContent.trim() && (kind === 'ul' || +(el.getAttribute('start') || 1) === 1);
    }
    return false;
  }
  function tightOk(prev, next) {
    if (!prev.hasAttribute('data-tight')) return false;
    const pk = kindOf(prev), nk = kindOf(next);
    if (['heading', 'hr', 'pre', 'tasks'].includes(pk)) return true;
    if (pk === 'p') return canInterruptParagraph(next, nk);
    if (pk === 'ul' || pk === 'ol' || pk === 'quote') return nk === 'heading' || nk === 'pre';
    if (pk === 'table') return nk === 'heading';
    return false;
  }
  const isBlockEl = n => !!n && n.nodeType === 1 && (BLOCK.has(n.nodeName) || n.getAttribute('data-md') === 'tasks');
  function sibling(node, dir) {   // nearest sibling, skipping whitespace-only text
    let s = node[dir];
    while (s && s.nodeType === 3 && !s.nodeValue.trim()) s = s[dir];
    return s;
  }
  function block(node, text) {
    if (!text) return '';
    const p = sibling(node, 'previousSibling'), n = sibling(node, 'nextSibling');
    return (isBlockEl(p) && tightOk(p, node) ? '\n' : '\n\n') + text + (isBlockEl(n) && tightOk(node, n) ? '\n' : '\n\n');
  }
  const trimNl = s => s.replace(/^\n+|\n+$/g, '');
  const trimLineEnd = l => { let e = l.length; while (e && (l[e - 1] === ' ' || l[e - 1] === '\t')) e--; return l.slice(0, e); };   // a loop: /[ \t]+$/ backtracks on long indents

  /* ==== Build P · when a table can't be Markdown, and how it's written then (R48c's source format) ==== */
  const TABLE_COMPLEX = 'td pre, td table, td blockquote, td details, th pre, th table, th blockquote, th details';   // written as the editor holds it
  const TABLE_RICH = 'td[colspan]:not([colspan="1"]), th[colspan]:not([colspan="1"]), td[rowspan]:not([rowspan="1"]), th[rowspan]:not([rowspan="1"]), col[width], '
    + 'td[data-nv-bg], th[data-nv-bg], td[data-nv-fg], th[data-nv-fg], td[data-nv-va], th[data-nv-va], td ul, td ol, th ul, th ol, td input, th input';
  const tableIsRich = t => !!t.querySelector(TABLE_RICH) || /^(?:outer|none)$/.test(t.getAttribute('data-nv-borders') || '');
  const tableIsHtml = t => !!t.querySelector(TABLE_COMPLEX) || tableIsRich(t);
  const isCellEl = c => c.nodeName === 'TD' || c.nodeName === 'TH';
  // A cell (or a list item in one) as it's saved: Markdown for the text, HTML for lists and checkboxes, all on one line
  // (a blank line would end the HTML block). The HTML parser reads it first, so a literal < or & is written as an entity.
  function richCellMd(node) {
    const box = node.cloneNode(true), held = [], first = [...node.childNodes].find(c => c.nodeType !== 3 || c.data.trim());
    const hold = (el, h) => { held.push(h); el.replaceWith(el.ownerDocument.createTextNode('' + (held.length - 1) + '')); };
    [...box.querySelectorAll('ul, ol')].filter(l => !l.parentElement.closest('ul, ol')).forEach(l => {
      const tag = l.nodeName.toLowerCase(), start = tag === 'ol' && +(l.getAttribute('start') || 1) !== 1 ? ` start="${+l.getAttribute('start')}"` : '';
      hold(l, `<${tag}${start}>` + [...l.children].filter(li => li.nodeName === 'LI').map(li => `<li>${richCellMd(li)}</li>`).join('') + `</${tag}>`);
    });
    box.querySelectorAll('input').forEach(i => hold(i, `<input type="checkbox"${i.hasAttribute('checked') ? ' checked' : ''}>`));
    let s = inlineStarts(trimNl(svc.turndown(box))).replace(/[ \t]*\n+[ \t]*/g, '<br>');
    s = s.replace(/\\&/g, '\u0002').replace(/&(?!nbsp;)/g, '&amp;').replace(/\u0002/g, '&amp;').replace(/\\</g, '&lt;')
      .replace(/(\d+)/g, (m, i) => held[+i]).trim();
    return node.nodeName !== 'LI' && first?.nodeName === 'INPUT' && !node.querySelector('ul, ol') ? `<label class="r48-chk">${s}</label>` : s;
  }
  function richTableToMd(table, rows) {
    const occ = [];
    rows.forEach((tr, r) => { occ[r] = occ[r] || []; let c = 0;
      [...tr.children].filter(isCellEl).forEach(td => { while (occ[r][c]) c++; const cs = +td.getAttribute('colspan') || 1, rs = +td.getAttribute('rowspan') || 1;
        for (let i = 0; i < rs; i++) for (let j = 0; j < cs; j++) (occ[r + i] = occ[r + i] || [])[c + j] = 1; c += cs; }); });
    const nc = Math.max(0, ...occ.map(r => r.length)), w = [...table.querySelectorAll(':scope > colgroup > col')].map(c => (c.getAttribute('width') || '').replace(/^(\d+)$/, '$1px'));
    const cell = td => { const tag = td.nodeName.toLowerCase(), a = alignOf(td), va = td.getAttribute('data-nv-va'), bg = td.getAttribute('data-nv-bg'), fg = td.getAttribute('data-nv-fg'), cs = +td.getAttribute('colspan') || 1, rs = +td.getAttribute('rowspan') || 1;
      const st = [a && a !== 'left' && `text-align:${a}`, va && `vertical-align:${va}`, bg && `background:${NV_BG[bg]}`, fg && `color:${NV_FG[fg]}`].filter(Boolean).join(';');
      return `    <${tag}${cs > 1 ? ` colspan="${cs}"` : ''}${rs > 1 ? ` rowspan="${rs}"` : ''}${bg ? ` data-nv-bg="${bg}"` : ''}${fg ? ` data-nv-fg="${fg}"` : ''}${st ? ` style="${st}"` : ''}>${richCellMd(td)}</${tag}>`; };
    return [`<table data-nv-borders="${table.getAttribute('data-nv-borders') || 'all'}">`,
      ...(w.some(Boolean) ? [`  <colgroup>${Array.from({ length: Math.max(nc, w.length) }, (_, i) => w[i] ? `<col style="width:${w[i]}">` : '<col>').join('')}</colgroup>`] : []),
      ...rows.flatMap(tr => ['  <tr>', ...[...tr.children].filter(isCellEl).map(cell), '  </tr>']), '</table>'].join('\n');
  }
  // The table controls' "Show it in the .md" and Copy as HTML / Markdown (tables.js): one table, as it's saved ('saved'), or
  // written as an HTML table ('html') or as a Markdown table ('md'), cleaned as a save cleans it
  function tableSource(el, kind) {
    const t = inertDoc(sanitizeHtml(el && el.outerHTML || '', false)).body.querySelector('table'); if (!t) return '';
    const rows = [...t.querySelectorAll(':scope > thead > tr, :scope > tbody > tr, :scope > tfoot > tr, :scope > tr')]; if (!rows.length) return '';
    return kind === 'html' ? richTableToMd(t, rows) : kind === 'md' ? mdTable(rows) : tableToMd(t);
  }
  /* ==== end Build P ==== */
  function tableToMd(table) {
    const rows = [...table.querySelectorAll(':scope > thead > tr, :scope > tbody > tr, :scope > tfoot > tr, :scope > tr')];
    if (!rows.length) return '';
    const complex = table.querySelector(TABLE_COMPLEX);
    if (complex) return table.outerHTML.replace(/>\s*\n\s*</g, '><').replace(/\n{2,}/g, '\n');   // stays HTML
    if (tableIsRich(table)) return richTableToMd(table, rows);   // Build P
    return mdTable(rows);
  }
  function mdTable(rows) {
    const cells = rows.map(r => [...r.children].filter(c => c.nodeName === 'TD' || c.nodeName === 'TH'));
    const cols = Math.max(...cells.map(r => r.length));
    if (!cols) return '';
    const cellMd = el => inlineStarts(trimNl(svc.turndown(el.cloneNode(true)))).replace(/\n+/g, '<br>').replace(/\|/g, '\\|');
    const line = r => '| ' + Array.from({ length: cols }, (_, i) => r[i] ? cellMd(r[i]) : '').join(' | ') + ' |';
    const sep = '| ' + Array.from({ length: cols }, (_, i) => {
      const a = cells[0][i] ? alignOf(cells[0][i]) : '';
      return a === 'center' ? ':---:' : a === 'right' ? '---:' : a === 'left' ? ':---' : '---';
    }).join(' | ') + ' |';
    return [line(cells[0]), sep, ...cells.slice(1).map(line)].join('\n');
  }

  /* --- rules (turndown checks the last added first) --- */
  svc.addRule('nvPara', { filter: ['p', 'div'], replacement: (c, node) => block(node, c.replace(/^[ \t]+|[ \t]+$/g, '').replace(/[ \t]+\n/g, '\n').replace(/^\n+|\s+$/g, '')) });
  svc.addRule('nvBreak', { filter: 'br', replacement: () => '\n' });
  svc.addRule('nvHr', { filter: 'hr', replacement: (c, node) => block(node, '---') });
  svc.addRule('nvHeading', { filter: ['h1', 'h2', 'h3', 'h4', 'h5', 'h6'], replacement: (c, node) => {
    c = inlineStarts(c.replace(/\s*\n\s*/g, ' ').trim()).replace(/(\s)(#+)$/, '$1\\$2');
    return c ? block(node, '#'.repeat(+node.nodeName[1]) + ' ' + c) : '';
  } });
  svc.addRule('nvCode', { filter: n => n.nodeName === 'CODE' && !(n.parentNode.nodeName === 'PRE' && !n.previousSibling && !n.nextSibling), replacement: c => {
    if (!c) return '';
    c = c.replace(/\r?\n|\r/g, ' ');
    let fence = '`';
    while ((c.match(/`+/g) || []).includes(fence)) fence += '`';
    // padded when it holds a backtick or starts and ends with a space (Markdown strips one space from each end)
    const pad = c.includes('`') || /^ .*[^ ].* $/.test(c) ? ' ' : '';
    return fence + pad + c + pad + fence;
  } });
  svc.addRule('nvStrike', { filter: ['del', 's', 'strike'], replacement: c => c.trim() ? '~~' + c + '~~' : '' });
  svc.addRule('nvInlineHtml', { filter: ['u', 'ins', 'sub', 'sup', 'kbd'], replacement: (c, node) => {
    const t = node.nodeName.toLowerCase(); return c ? `<${t}>${c}</${t}>` : '';
  } });
  svc.addRule('nvMark', { filter: 'mark', replacement: (c, node) => {
    const cls = (node.getAttribute('class') || '').split(/\s+/).filter(x => /^hl-/.test(x)).join(' ');
    return c ? `<mark${cls ? ` class="${cls}"` : ''}>${c}</mark>` : '';
  } });
  svc.addRule('nvColour', { filter: n => n.nodeName === 'SPAN' && /(^|\s)tc-[a-z]+/.test(n.getAttribute('class') || ''), replacement: (c, node) => {
    const cls = (node.getAttribute('class') || '').split(/\s+/).filter(x => /^tc-/.test(x)).join(' ');
    return c ? `<span class="${cls}">${c}</span>` : '';
  } });
  svc.addRule('nvCheckbox', { filter: n => n.nodeName === 'INPUT', replacement: (c, node) => node.closest('li') ? (node.hasAttribute('checked') ? '[x] ' : '[ ] ') : '' });
  svc.addRule('nvList', { filter: ['ul', 'ol'], replacement: (c, node) => {
    const parent = node.parentNode;
    if (parent.nodeName === 'LI') return parent.lastElementChild === node ? '\n' + c : '\n\n' + c + '\n\n';
    return block(node, trimNl(c));
  } });
  svc.addRule('nvListItem', { filter: 'li', replacement: (c, node) => {
    const list = node.parentNode;
    // Two separate lists in a row would read back as one, so every second one uses * (or 1)) instead of - (or 1.)
    let run = 0;
    for (let s = sibling(list, 'previousSibling'); s && s.nodeName === list.nodeName; s = sibling(s, 'previousSibling')) run++;
    let prefix = run % 2 ? '* ' : '- ';
    if (list.nodeName === 'OL') {
      const start = +(list.getAttribute('start') || 1), i = [...list.children].indexOf(node);
      prefix = (start + i) + (run % 2 ? ') ' : '. ');
    }
    const loose = [...list.children].some(li => [...li.children].some(x => x.nodeName === 'P'));
    c = trimNl(c).split('\n').map(trimLineEnd).join('\n').replace(/^(\[[ x]\]) +/, '$1 ');
    c = c.replace(/\n(?=[^\n])/g, '\n' + ' '.repeat(prefix.length));
    return prefix + c + (node.nextElementSibling ? (loose ? '\n\n' : '\n') : '');
  } });
  svc.addRule('nvCodeBlock', { filter: 'pre', replacement: (c, node) => {
    const code = preText(node).replace(/\n$/, '');
    if (!code) return block(node, '```' + codeLang(node) + '\n```');   // Editor QC: an empty code block, as just inserted
    let fence = '```';
    (code.match(/^`{3,}/gm) || []).forEach(m => { if (m.length >= fence.length) fence = '`'.repeat(m.length + 1); });
    return block(node, fence + codeLang(node) + '\n' + code + '\n' + fence);
  } });
  svc.addRule('nvBlockquote', { filter: 'blockquote', replacement: (c, node) => {
    const inner = trimNl(c).replace(/^\[!(?=[A-Za-z][\w-]{0,39}\][+-]?(?:[ \t\n]|$))/, '\\[!');   // Build P (QC 40): "[!note]" typed as text in a quote stays text, not a callout
    return inner ? block(node, inner.replace(/^/gm, '> ').replace(/^> $/gm, '>')) : '';
  } });
  // Build P (QC 40): a callout's first line from its attributes and title, then its body as any quote's
  const isCallout = n => !!n && n.nodeName === 'BLOCKQUOTE' && CALLOUT_TYPE.test(n.getAttribute('data-callout') || '');
  const calloutTitleEl = n => { const t = n.firstElementChild; return t && t.nodeName === 'P' && t.classList.contains('callout-title') ? t : null; };
  function calloutMd(node, c) {
    const t = calloutTitleEl(node), title = t ? inlineStarts(trimNl(svc.turndown(t.cloneNode(true)))).replace(/\s*\n\s*/g, ' ').trim() : '';
    const inner = trimNl(c || ''), head = `[!${node.getAttribute('data-callout')}]${node.getAttribute('data-callout-fold') || ''}${title ? ' ' + title : ''}`;
    return block(node, (head + (inner ? (t && t.hasAttribute('data-tight') ? '\n' : '\n\n') + inner : '')).replace(/^/gm, '> ').replace(/^> $/gm, '>'));
  }
  svc.addRule('nvCalloutTitle', { filter: n => n.nodeName === 'P' && isCallout(n.parentNode) && calloutTitleEl(n.parentNode) === n, replacement: () => '' });
  svc.addRule('nvCallout', { filter: isCallout, replacement: (c, node) => calloutMd(node, c) });
  svc.addRule('nvLink', { filter: n => n.nodeName === 'A', replacement: (c, node) => {
    const href = hrefOf(node), text = node.textContent;
    if (!href) return c;
    if (node.getAttribute('data-md') === 'angle') return '<' + href + '>';
    if (!node.getAttribute('title') && (href === text || href === 'http://' + text || href === 'mailto:' + text) && /^\S+$/.test(text)) return text;   // bare URL, as typed
    return '[' + c + '](' + linkDest(href) + linkTitle(node.getAttribute('title')) + ')';
  } });
  svc.addRule('nvImage', { filter: 'img', replacement: (c, node) => {
    const src = srcOf(node);
    if (!src) return '';
    const alt = node.getAttribute('alt') || '', title = node.getAttribute('title') || '';
    if (node.hasAttribute('width') || node.hasAttribute('height')) {   // sized images stay HTML
      const attrs = [['src', src], ['alt', alt], ['title', title], ['width', node.getAttribute('width')], ['height', node.getAttribute('height')]];
      return '<img' + attrs.filter(([k, v]) => v || k === 'alt').map(([k, v]) => ` ${k}="${esc(v)}"`).join('') + '>';
    }
    return '![' + alt.replace(/([\[\]\\])/g, '\\$1').replace(/\n+/g, ' ') + '](' + linkDest(src) + linkTitle(title) + ')';
  } });
  svc.addRule('nvTable', { filter: 'table', replacement: (c, node) => block(node, tableToMd(node)) });
  svc.addRule('nvAlign', { filter: n => ['P', 'DIV', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6'].includes(n.nodeName) && /^(?:center|right|justify)$/.test(alignOf(n)) || (n.nodeName === 'DIV' && alignOf(n) === 'left'),
    replacement: (c, node) => {
      let inner = trimNl(c);
      if (node.nodeName[0] === 'H') inner = inner.replace(/\s*\n\s*/g, ' ').trim() && '#'.repeat(+node.nodeName[1]) + ' ' + inlineStarts(inner.replace(/\s*\n\s*/g, ' ').trim());
      else if (node.nodeName === 'P') inner = inner.replace(/^[ \t]+|[ \t]+$/g, '').replace(/[ \t]+\n/g, '\n');
      return inner ? block(node, `<div align="${alignOf(node)}">\n\n${inner}\n\n</div>`) : '';
    } });
  svc.addRule('nvSummary', { filter: 'summary', replacement: () => '' });   // written by nvDetails, as HTML
  svc.addRule('nvDetails', { filter: 'details', replacement: (c, node) => {
    const summary = [...node.children].find(x => x.nodeName === 'SUMMARY'), inner = trimNl(c);
    const head = `<details${node.hasAttribute('open') ? ' open' : ''}>` + (summary ? `\n<summary>${summary.innerHTML.replace(/\s*\n\s*/g, ' ').trim()}</summary>` : '');   // HTML: Markdown isn't read inside <summary>
    return block(node, head + '\n\n' + (inner ? inner + '\n\n' : '') + '</details>');
  } });
  svc.addRule('nvTag', { filter: n => n.nodeName === 'SPAN' && n.classList.contains('tag'), replacement: (c, node) => {
    const t = node.textContent;
    if (TAG_RE.test(t) && TAG_RE.exec(t)[0] === t) return t;
    const d = node.getAttribute('data-tag');
    return d && TAG_RE.test('#' + d) ? '#' + d : escapeText(t);
  } });
  svc.addRule('nvWiki', { filter: n => n.nodeName === 'SPAN' && n.classList.contains('wikilink'), replacement: (c, node) => {
    const t = node.textContent;
    if (/^\[\[[^\[\]\n]+\]\]$/.test(t)) return t;
    const d = node.getAttribute('data-wiki');
    return d ? '[[' + d + ']]' : escapeText(t);
  } });
  svc.addRule('nvRaw', { filter: n => n.getAttribute('data-md') === 'raw', replacement: (c, node) => node.getAttribute('data-raw') || node.textContent });
  svc.addRule('nvComment', { filter: n => n.nodeName === 'NV-COMMENT', replacement: (c, node) => '<!--' + node.getAttribute('data-text') + '-->' });
  svc.addRule('nvTasks', { filter: n => n.getAttribute('data-md') === 'tasks', replacement: (c, node) => block(node, '{{tasks}}') });

  /* Editor-only decorations: removed or unwrapped before saving */
  function stripEditorChrome(body) {
    body.querySelectorAll('[data-md-ignore], .attach-cap, .task-wand, .spinner, .chip').forEach(el => el.remove());
    body.querySelectorAll('b.bionic').forEach(el => el.replaceWith(...el.childNodes));
    // the mockup's task rows (div.task > input + span) become a task list
    body.querySelectorAll('div.task').forEach(div => {
      const prev = div.previousElementSibling;
      const list = prev && prev.nodeName === 'UL' && prev.nvFromTasks ? prev : div.ownerDocument.createElement('ul');
      if (list !== prev) { list.nvFromTasks = true; div.before(list); }
      const li = div.ownerDocument.createElement('li'), box = div.querySelector('input[type="checkbox"]');
      const done = box ? box.hasAttribute('checked') : div.classList.contains('is-done');
      li.innerHTML = `<input type="checkbox"${done ? ' checked' : ''}> `;
      [...div.childNodes].filter(c => c !== box).forEach(c => li.appendChild(c));
      list.appendChild(li); div.remove();
    });
  }

  function htmlToMd(input) {
    let html;
    if (input && input.nodeType === 1) {
      const copy = input.cloneNode(true);   // a clone in the same document keeps checkbox ticks
      const live = input.querySelectorAll('input'), copied = copy.querySelectorAll('input');
      copied.forEach((el, i) => { if (live[i] && live[i].checked) el.setAttribute('checked', ''); else el.removeAttribute('checked'); });
      html = copy.innerHTML;
    } else html = String(input == null ? '' : input);
    const doc = inertDoc(html), body = doc.body;
    const front = body.querySelector('[data-md="frontmatter"]');
    const frontText = front ? front.textContent.replace(/\n+$/, '') : null, frontTight = front && front.hasAttribute('data-tight');
    stripEditorChrome(body);
    const clean = inertDoc(sanitizeHtml(body.innerHTML, false)).body;
    clean.querySelectorAll('[data-md="frontmatter"]').forEach(el => el.remove());
    clean.querySelectorAll('[data-md="tasks"]').forEach(el => { el.textContent = 'tasks'; });   // tasks live in the task store; the text stops turndown skipping it as empty
    // comments are kept: turndown skips comment nodes, so they become elements it can see
    const comments = [], tw = clean.ownerDocument.createTreeWalker(clean, 128);
    while (tw.nextNode()) comments.push(tw.currentNode);
    comments.forEach(c => { const el = clean.ownerDocument.createElement('nv-comment'); el.setAttribute('data-text', c.data); el.textContent = 'comment'; c.replaceWith(el); });
    let out = svc.turndown(clean);
    if (frontText !== null) out = '---\n' + frontText + '\n---\n' + (out ? (frontTight ? '' : '\n') + out : '');
    return out;
  }

  // frozen, so no other script can swap the cleaner out
  root.NVMarkdown = Object.freeze({ mdToHtml, htmlToMd, sanitize: html => sanitizeHtml(html, true), safeUrl, splitFrontMatter, tableSource, versions: Object.freeze({ marked: '18.0.14', turndown: '7.2.4' }) });
})(typeof window !== 'undefined' ? window : globalThis);
