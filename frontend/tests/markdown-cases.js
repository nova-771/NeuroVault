/* Test cases for frontend/js/markdown.js. Used by markdown-roundtrip.html.
   MD_CASES:   Markdown that must come back from md → html → md unchanged. Where the result is the same note
               written in NeuroVault's standard form, `expect` gives that form and `why` explains it.
   HTML_CASES: HTML the Word/Docs editor produces (the mockup's toolbar commands, Chrome's own editing,
               paste) and the Markdown it must save as.
   XSS_CASES:  notes that try to run script. Each calls __xss(n) if it ever runs. */

const MD_CASES = [
  // Headings, paragraphs, line breaks
  { name: 'headings 1–6', md: '# H1\n\n## H2\n\n### H3\n\n#### H4\n\n##### H5\n\n###### H6' },
  { name: 'headings directly above text', md: '# Title\nFirst line.\n## Section\nSecond line.' },
  { name: 'line breaks inside a paragraph', md: 'line one\nline two\nline three' },
  { name: 'paragraphs', md: 'First paragraph.\n\nSecond paragraph.' },
  { name: 'heading ending in #', md: '## Learn C \\#' },
  // Inline formatting
  { name: 'bold, italic, strike, code', md: '**bold** *italic* ~~strike~~ `code` ***both***' },
  { name: 'nested emphasis', md: '**bold *nested* bold** and *it **strong** it*' },
  { name: 'intraword underscores and spaced stars', md: 'snake_case_name, 2 * 3 = 6 and a _ b' },
  { name: 'escaped syntax', md: 'Literal \\*stars\\*, \\_under\\_, \\`tick\\`, \\[link](x) and [brackets]' },
  { name: 'unneeded escape', md: '\\[brackets] and Fix [object Object]', expect: '[brackets] and Fix [object Object]', why: 'A [ that cannot start a link needs no backslash, so none is written.' },
  { name: 'escaped block starts', md: '\\# not a heading\n\\- not a bullet\n1\\. not a list\n\\> not a quote' },
  { name: 'inline code with backticks', md: 'Use `` a`b `` and `[object Object]`' },
  { name: 'Windows path', md: 'Saved in C:\\Users\\alex\\notes\\file.md' },
  { name: 'entities and angle brackets', md: 'AT&T, 5 < 6, 7 > 3 and \\&amp; written out' },
  { name: 'non-breaking space', md: '10&nbsp;km' },
  { name: 'unicode', md: 'Café — “quotes” – ü 日本語 😀' },
  // Code blocks
  { name: 'fenced code with language', md: '```js\nconst a = 1;\n\nif (a) { console.log("*not md*"); }\n```' },
  { name: 'fenced code without language', md: '```\nplain text\n  indented\n```' },
  { name: 'code block containing a fence', md: '````md\n```js\nx\n```\n````' },
  { name: 'code block directly after a heading', md: '## Example\n```py\nprint(1)\n```\nAfter the code.' },
  // Lists
  { name: 'bullet list with nesting', md: '- a\n- b\n  - nested\n  - nested 2\n- c' },
  { name: 'numbered list', md: '1. one\n2. two\n3. three' },
  { name: 'numbered list starting at 3', md: '3. three\n4. four' },
  { name: 'task list', md: '- [ ] open\n- [x] done\n  - [ ] sub step (5 min)\n  - [x] sub done (3 min)' },
  { name: 'loose list', md: '- a\n\n- b\n\n- c' },
  { name: 'list item with two paragraphs', md: '1. first\n\n   more about first\n\n2. second' },
  { name: 'list with formatting', md: '- **bold** item with [[Wiki link]] and #tag\n- `code` item' },
  // Quotes
  { name: 'quote with line breaks and paragraphs', md: '> line one\n> line two\n>\n> second paragraph' },
  { name: 'nested quote', md: '> outer\n>\n> > inner' },
  { name: 'quote with a heading and list', md: '> ## Quoted heading\n> - item\n> - item 2' },
  // Tables
  { name: 'table with alignment', md: '| Name | Count | Note |\n| :--- | :---: | ---: |\n| a | 1 | left |\n| **b** | 2 | `c` |' },
  { name: 'table cell with pipe', md: '| Expr | Result |\n| --- | --- |\n| a \\| b | `x \\| y` |' },
  { name: 'table with empty cells', md: '| A | B |\n| --- | --- |\n|  | 2 |' },
  // Links and images
  { name: 'link', md: '[text](https://example.org)' },
  { name: 'link with title', md: '[text](https://example.org "The title")' },
  { name: 'link with brackets in the address', md: '[Foo](https://en.wikipedia.org/wiki/Foo_(bar))' },
  { name: 'link with spaces in the address', md: '[file](<attachments/my file.pdf>)' },
  { name: 'link with non-ASCII address', md: '[café](https://example.org/café?q=ü)' },
  { name: 'angle-bracket autolink', md: '<https://example.org/a_b>' },
  { name: 'bare URL', md: 'See https://example.org/a_b_c and www.example.com.' },
  { name: 'bare email', md: 'Mail alex@example.org today' },
  { name: 'image', md: '![A diagram](attachments/diagram.png)' },
  { name: 'image with title', md: '![Alt](https://example.org/a.png "Title")' },
  { name: 'image inside a link', md: '[![badge](b.svg)](https://example.org)' },
  { name: 'relative and anchor links', md: '[up](../other.md) [top](#overview) [mail](mailto:a@b.c)' },
  // NeuroVault syntax
  { name: 'wiki links', md: 'See [[API auth notes]], [[Q3 Roadmap Draft|the roadmap]] and [[Note#Heading]].' },
  { name: 'wiki embed', md: '![[diagram.png]]' },
  { name: 'wiki link in bold', md: '**Read [[Meeting notes — design sync]] first**' },
  { name: 'tags', md: '#tag #nested/tag #with-dash #under_score #日本' },
  { name: 'not tags', md: 'C# and issue #42 and a#b and https://example.org/#frag' },
  { name: 'tag at line start and in brackets', md: '#start of a line (#paren)' },
  { name: 'tasks placeholder between lines', md: '## Next steps\n{{tasks}}\nFinalise the schema.' },
  { name: 'tasks placeholder alone', md: '{{tasks}}' },
  { name: 'tasks placeholder written inline stays text', md: 'see {{tasks}} here' },
  { name: 'front matter', md: '---\nid: note-1\ntitle: "Q3 Roadmap Draft"\ntags: [roadmap, q3]\n---\n\n## Overview\nText.' },
  // HTML extensions (stored as HTML in the .md)
  { name: 'inline HTML extensions', md: '<u>under</u> <mark class="hl-yellow">hi</mark> <span class="tc-red">red</span> H<sub>2</sub>O x<sup>2</sup> <kbd>Ctrl</kbd>' },
  { name: 'Markdown inside HTML extensions', md: '<u>**bold underline**</u> and <mark class="hl-blue">*it* [[Link]]</mark>' },
  { name: 'centred block', md: '<div align="center">\n\nCentred **text**\n\n</div>' },
  { name: 'right-aligned heading', md: '<div align="right">\n\n## Right heading\n\n</div>' },
  // Fix A (QC 3 · 24): what Align does to lists, quotes and callouts (the whole block, wrapped)
  { name: 'right-aligned list', md: '<div align="right">\n\n- one\n- two\n\n</div>' },
  { name: 'centred numbered list with a nested task', md: '<div align="center">\n\n1. one\n   - [ ] sub task\n2. two\n\n</div>' },
  { name: 'centred quote', md: '<div align="center">\n\n> a quote\n\n</div>' },
  { name: 'right-aligned callout', md: '<div align="right">\n\n> [!note] Callout\n> body\n\n</div>' },
  { name: 'collapsible section', md: '<details>\n<summary>Click to open</summary>\n\nHidden **text**\n\n- item\n\n</details>' },
  { name: 'collapsible section, open, bold summary', md: '<details open>\n<summary><strong>Open</strong> by default</summary>\n\nBody.\n\n</details>' },
  { name: 'sized image', md: '<img src="attachments/photo.png" alt="Photo" width="320">' },
  { name: 'comments', md: 'Before <!-- inline note --> after\n\n<!-- block comment -->\n\nText' },
  { name: 'horizontal rule', md: 'Above\n\n---\n\nBelow' },
  // Content that is kept but never runs
  { name: 'script kept as inert text', md: 'Before\n\n<script>alert("kept, never run")</script>\n\nAfter' },
  { name: 'javascript link kept, not clickable', md: '[bad](javascript:alert(1))' },
  { name: 'empty note', md: '' },

  // Same note, written in the standard form
  { name: 'trailing newline', md: 'Text\n', expect: 'Text', why: 'The converter returns the note without a final newline; the store adds one when it writes a file.' },
  { name: 'several blank lines', md: 'a\n\n\n\nb', expect: 'a\n\nb', why: 'Extra blank lines between paragraphs have no meaning in Markdown; one is kept.' },
  { name: 'setext headings', md: 'Title\n=====\n\nSub\n---', expect: '# Title\n\n## Sub', why: 'Underlined headings are written as # headings.' },
  { name: 'star and plus bullets', md: '* one\n* two\n\n+ three', expect: '- one\n- two\n\n* three', why: 'Bullets are written with -; a second list straight after the first uses *, so the two stay separate lists.' },
  { name: 'two numbered lists in a row', md: '1. a\n2. b\n\n1) c', expect: '1. a\n2. b\n\n1) c' },
  { name: 'numbered list with )', md: '1) one\n2) two', expect: '1. one\n2. two', why: 'Numbers are written as "1.".' },
  { name: 'underscore emphasis', md: '__bold__ and _em_', expect: '**bold** and *em*', why: 'Bold and italic are written with * (same look).' },
  { name: 'two-space hard break', md: 'a  \nb', expect: 'a\nb', why: 'NeuroVault treats every newline as a line break (like Obsidian), so the two trailing spaces are not needed.' },
  { name: 'indented code', md: 'Text\n\n    code line', expect: 'Text\n\n```\ncode line\n```', why: 'Code blocks are written fenced.' },
  { name: 'reference link', md: '[x][r]\n\n[r]: https://example.org', expect: '[x](https://example.org)', why: 'Reference links are written inline, so the definition line goes.' },
  { name: 'compact table', md: '|a|b|\n|-|:-:|\n|1|2|', expect: '| a | b |\n| --- | :---: |\n| 1 | 2 |', why: 'Tables are written with spaces and a --- separator.' },
  { name: 'explicit link to its own address', md: '[https://example.org](https://example.org)', expect: 'https://example.org', why: 'A link whose text is its address is written as a bare address, which reads back the same.' },
  { name: 'lone ~ and spaced-out tilde', md: 'about ~5 minutes', expect: 'about \\~5 minutes', why: 'A ~ next to a word is escaped, because two of them in one line would make strikethrough.' },
  { name: 'loose task list', md: '- [ ] a\n\n- [x] b', expect: '- [ ] a\n\n- [x] b' },
];

const HTML_CASES = [
  // The mockup's toolbar commands (doFormat) and what Chrome's execCommand makes
  { name: 'execCommand bold/italic/strike/underline', html: '<p>Plain <b>bold</b> <i>it</i> <strike>s</strike> <u>u</u> <sub>2</sub> <sup>3</sup></p>', md: 'Plain **bold** *it* ~~s~~ <u>u</u> <sub>2</sub> <sup>3</sup>' },
  { name: 'highlight', html: '<p>Some <mark class="hl-green">highlighted</mark>&nbsp;</p>', md: 'Some <mark class="hl-green">highlighted</mark>' },
  { name: 'text colour', html: '<p>Some <span class="tc-blue">coloured text</span>&nbsp;</p>', md: 'Some <span class="tc-blue">coloured text</span>' },
  { name: 'align centre (mockup)', html: '<p align="center" data-align="center">Centre me</p>', md: '<div align="center">\n\nCentre me\n\n</div>' },
  { name: 'align right (Chrome)', html: '<div style="text-align: right;">Right</div>', md: '<div align="right">\n\nRight\n\n</div>' },
  { name: 'align left is the default', html: '<p align="left" data-align="left">Left</p>', md: 'Left' },
  { name: 'aligned heading', html: '<h2 align="center">Title</h2>', md: '<div align="center">\n\n## Title\n\n</div>' },
  { name: 'aligned table column (Fix A)', html: '<table><thead><tr><th>A</th><th align="right">B</th></tr></thead><tbody><tr><td>1</td><td align="right">2</td></tr></tbody></table>', md: '| A | B |\n| --- | ---: |\n| 1 | 2 |' },
  { name: 'aligned list (Fix A)', html: '<div align="center"><ul><li>one</li><li>two</li></ul></div>', md: '<div align="center">\n\n- one\n- two\n\n</div>' },
  { name: 'collapsible section', html: '<details><summary>Click to open</summary><p>Hidden until you open it</p></details><p><br></p>', md: '<details>\n<summary>Click to open</summary>\n\nHidden until you open it\n\n</details>' },
  { name: 'table from the grid picker', html: '<table><thead><tr><th>Column 1</th><th>Column 2</th><th>Column 3</th></tr></thead><tbody><tr><td>&nbsp;</td><td>&nbsp;</td><td>&nbsp;</td></tr></tbody></table><p><br></p>', md: '| Column 1 | Column 2 | Column 3 |\n| --- | --- | --- |\n|  |  |  |' },
  { name: 'table cell with two lines', html: '<table><thead><tr><th>A</th></tr></thead><tbody><tr><td>one<br>two</td></tr></tbody></table>', md: '| A |\n| --- |\n| one<br>two |' },
  { name: 'code block (mockup data-lang)', html: '<pre data-lang="JavaScript"><code>// your code</code></pre><p><br></p>', md: '```javascript\n// your code\n```' },
  { name: 'code block, Plain text', html: '<pre data-lang="Plain text"><code>text</code></pre>', md: '```\ntext\n```' },
  { name: 'code block edited in Chrome (div lines)', html: '<pre><code>line 1<div>line 2</div><div>line 3</div></code></pre>', md: '```\nline 1\nline 2\nline 3\n```' },
  { name: 'task row (mockup)', html: '<div class="task"><input type="checkbox" aria-label="Done"><span>New task</span></div><div class="task is-done"><input type="checkbox" checked aria-label="Done"><span>Done task</span></div>', md: '- [ ] New task\n- [x] Done task' },
  { name: 'wiki link (mockup)', html: '<p>See <span class="wikilink" data-wiki="API auth notes">[[API auth notes]]</span>&nbsp;</p>', md: 'See [[API auth notes]]' },
  { name: 'image attachment (mockup)', html: '<p><span class="attach" contenteditable="false"><img alt="attachments/diagram.png" src="attachments/diagram.png"><span class="attach-cap">attachments/diagram.png</span></span>&nbsp;</p>', md: '![attachments/diagram.png](attachments/diagram.png)' },
  { name: 'link (mockup)', html: '<p><a href="https://example.org">link text</a>&nbsp;</p>', md: '[link text](https://example.org)' },
  { name: 'inline code (mockup)', html: '<p>Run <code>npm test</code>&nbsp;</p>', md: 'Run `npm test`' },
  { name: 'horizontal line (mockup)', html: '<p>Above</p><hr><p><br></p>', md: 'Above\n\n---' },
  { name: 'heading from the style menu', html: '<h3>Small heading</h3><p>Text</p>', md: '### Small heading\n\nText' },
  { name: 'execCommand lists', html: '<ul><li>one</li><li>two<ul><li>nested</li></ul></li></ul><ol><li>first</li><li>second</li></ol>', md: '- one\n- two\n  - nested\n\n1. first\n2. second' },
  { name: 'Chrome div lines', html: '<div>Line one</div><div>Line two</div><div><br></div><div>Line three</div>', md: 'Line one\n\nLine two\n\nLine three' },
  { name: 'text typed straight into the editor root', html: 'Loose text <b>bold</b><p>Para</p>', md: 'Loose text **bold**\n\nPara' },
  { name: 'Markdown characters typed as text', html: '<p>2 * 3 = 6, file_name.md, [not a link], # not heading</p><p>1. not a list</p><p>- not a bullet</p><p>{{tasks}}</p>', md: '2 * 3 = 6, file_name.md, [not a link], # not heading\n\n1\\. not a list\n\n\\- not a bullet\n\n\\{{tasks}}' },
  { name: 'HTML typed as text', html: '<p>Type &lt;u&gt; and &amp;amp; literally</p>', md: 'Type \\<u> and \\&amp; literally' },
  { name: 'bionic reading marks', html: '<p><b class="bionic">Rea</b>ding <b class="bionic">wo</b>rds</p>', md: 'Reading words' },
  { name: 'spelling and homophone marks', html: '<p>Readers will <span class="spell" data-word="recieve" title="Spelling">recieve</span> it; <span class="homophone" data-word="there">there</span> eyes</p>', md: 'Readers will recieve it; there eyes' },
  { name: 'editor-only decoration', html: '<p>Text<span data-md-ignore="">(3 min read)</span></p>', md: 'Text' },
  { name: 'tasks placeholder with rendered tasks', html: '<h2>Next steps</h2><div class="md-tasks" data-md="tasks" contenteditable="false"><div class="task"><input type="checkbox" data-task="t-1"><span>Fix it</span><button class="task-wand">x</button></div></div><p>After</p>', md: '## Next steps\n\n{{tasks}}\n\nAfter' },
  { name: 'pasted web page', html: '<meta charset="utf-8"><style>p{color:red}</style><p style="color: rgb(32,33,36); font-family: Arial" class="MsoNormal" id="p1">Pasted <span style="font-weight:700">text</span> <font color="red">red</font></p><script>window.__xss && __xss("paste")</script>', md: 'Pasted text red' },
  { name: 'pasted link with javascript:', html: '<p><a href="javascript:__xss(\'paste-link\')">click</a></p>', md: '[click](javascript:__xss(\'paste-link\'))' },
  { name: 'empty editor', html: '<p><br></p>', md: '' },
];

const XSS_CASES = [
  '<script>__xss(1)</script>',
  '<img src=x onerror="__xss(2)">',
  '<svg onload="__xss(3)"></svg>',
  '<svg><script>__xss(4)</script></svg>',
  '[click](javascript:__xss(5))',
  '[click](JaVaScRiPt:__xss(6))',
  '[click](java&#x09;script:__xss(7))',
  '<a href="java&#x0A;script:__xss(8)">x</a>',
  '<a href=" &#14; javascript:__xss(9)">x</a>',
  '![x](javascript:__xss(10))',
  '<iframe src="javascript:__xss(11)"></iframe>',
  '<iframe srcdoc="<script>parent.__xss(12)</script>"></iframe>',
  '<object data="javascript:__xss(13)"></object>',
  '<embed src="javascript:__xss(14)">',
  '<math><mtext><table><mglyph><style><img src=x onerror=__xss(15)>',
  '<noscript><p title="</noscript><img src=x onerror=__xss(16)>">',
  '<form><button formaction="javascript:__xss(17)">go</button></form>',
  '<details open ontoggle="__xss(18)"><summary>s</summary></details>',
  '<input autofocus onfocus="__xss(19)">',
  '<meta http-equiv="refresh" content="0;url=javascript:__xss(20)">',
  '<base href="javascript:__xss(21)//">\n\n[a](x)',
  '<a href="data:text/html,<script>__xss(22)</script>">x</a>',
  '| a |\n| --- |\n| <img src=x onerror=__xss(23)> |',
  '<div style="background:url(javascript:__xss(24))">x</div>',
  '<template><img src=x onerror=__xss(25)></template>',
  '<svg><a xlink:href="javascript:__xss(26)"><text>x</text></a></svg>',
  '<xmp><img src=x onerror=__xss(27)></xmp>',
  '<textarea><img src=x onerror=__xss(28)></textarea>',
  '<!--><img src=x onerror=__xss(29)>-->',
  '<a href="vbscript:__xss(30)">x</a>',
  '<a href="&#106;avascript:__xss(31)">x</a>',
  '<a href="javascript&colon;__xss(32)">x</a>',
  '[[x" onmouseover="__xss(33)]] #a"onclick=__xss(33)',
  '```js" onmouseover="__xss(34)\ncode\n```',
  "<style>@import 'javascript:__xss(35)';</style>",
  '<link rel="import" href="data:text/html,<script>__xss(36)</script>">',
  '<img src="data:image/svg+xml,<svg xmlns=\'http://www.w3.org/2000/svg\' onload=\'__xss(37)\'/>">',
  '[x](data:image/svg+xml,<svg onload=__xss(38)>)',
  '<video><source onerror="__xss(39)"></video>',
  '<body onload="__xss(40)">',
  '<isindex action=javascript:__xss(41) type=image>',
  '<a href="\u0001javascript:__xss(42)">x</a>',
  '<details><summary>s</summary>\n\n<img src=x onerror=__xss(43)>\n\n</details>\n\n<div align="center">\n\n<img src=x onerror=__xss(43)>\n\n</div>',
  '<marquee onstart="__xss(44)">m</marquee>',
  '<p onclick="__xss(45)" id="x" name="y" style="position:fixed;inset:0">click</p>',
  '<a href="#" onclick="__xss(46)">x</a>',
  '<scr<script>ipt>__xss(48)</script>',
  '<<script>script>__xss(49)</script>',
  '<img src=x:alert(1) onerror=__xss(50)//',
  '<select><style></select><img src=x onerror=__xss(53)>',
  '<svg><style><img src=x onerror=__xss(54)></style></svg>',
  '<math><style><img src=x onerror=__xss(55)></style></math>',
  '<table><tr><td><style></td></tr></table><img src=x onerror=__xss(56)>',
  '[a](javascript:__xss(57) "t") ![b](javascript:__xss(57))',
  '<a href="https://ok.example" onmouseover="__xss(58)">ok</a>',
  '<span class="md-raw" data-md="raw" data-raw="<img src=x onerror=__xss(59)>">x</span>',
  '<div data-md="tasks" onclick="__xss(60)"><img src=x onerror=__xss(60)></div>',
  '<pre class="md-frontmatter" data-md="frontmatter"><img src=x onerror=__xss(61)></pre>',
  '<a href="javascript:__xss(62)" data-md="angle">x</a> <javascript:__xss(62)>',
  '<img src="https://x.example/a.png" srcset="javascript:__xss(63) 1x">',
  '<a href="http://x" formaction="javascript:__xss(64)" ping="http://evil.example">x</a>',
  '<keygen autofocus onfocus=__xss(65)>',
  '<frameset onload=__xss(66)>',
  '<object data="data:text/html;base64,PHNjcmlwdD5wYXJlbnQuX194c3MoNjcpPC9zY3JpcHQ+"></object>',
  '<svg><animate onbegin=__xss(68) attributeName=x dur=1s>',
  '<audio src=x onerror=__xss(69)>',
  '<p constructor="x" __proto__="y" hasownproperty="z" tostring="w" onclick="__xss(72)">built-in names</p><constructor>c</constructor><__proto__>p</__proto__>',
  '<a href="javascript:__xss(73)"><img src=x onerror=__xss(73)></a>',
  '<div align="center" onmouseenter="__xss(74)">\n\n[x](javascript:__xss(74))\n\n</div>',
  '<span class="wikilink" data-wiki="x" onclick="__xss(75)">[[x]]</span> <span class="tag tc-red" onclick="__xss(75)">#t</span>',
  '<a href="javas\u00adcript:__xss(70)">soft hyphen</a>',
  '<a href="javas\u200bcript:__xss(71)">zero width</a>',
];

/* Line-start escapes inside headings and table cells (build/md-escapes): no block can start there, so "## 1. Title"
   is saved as typed. A lone # or - keeps its backslash ("## #" would be an empty heading). */
MD_CASES.push(
  { name: 'numbered headings', md: '## 1. Personal Profile\nText.\n\n### 2) Goals\n\n#### 10. Last' },
  { name: 'headings starting with block characters', md: '## - dash\n\n## + plus\n\n## > arrow\n\n## # hash\n\n## ## two hashes \\##' },
  { name: 'heading that is only # or -', md: '## \\#\n\n## \\-' },
  { name: 'table cells starting with block characters', md: '| Step | Note |\n| --- | --- |\n| 1. Plan | - first<br>2. second |\n| > quoted | # hash |' }
);
HTML_CASES.push(
  { name: 'numbered heading typed in the editor', html: '<h2>1. Personal Profile</h2><p>1. not a list</p><h3 align="center">2. Centred</h3>', md: '## 1. Personal Profile\n\n1\\. not a list\n\n<div align="center">\n\n### 2. Centred\n\n</div>' }
);

/* ==== Build P · tables (mockups R48, R48c): Markdown tables stay Markdown; a table using what Markdown can't store (merged cells,
   widths, cell colours, vertical alignment, borders, lists or checkboxes in cells) is saved as an HTML <table> in R48c's source
   format, with Markdown in its cells, and reads back into the same editable table ==== */
const R48C_SAMPLE = '## Reading budget\nWhat each study costs this quarter.\n<table data-nv-borders="all">\n  <colgroup><col style="width:120px"><col style="width:200px"><col style="width:96px"><col style="width:96px"><col style="width:240px"></colgroup>\n  <tr>\n    <th data-nv-bg="blue" style="background:#cfe0f7">Team</th>\n    <th data-nv-bg="blue" style="background:#cfe0f7">Study</th>\n    <th data-nv-bg="blue" style="text-align:right;background:#cfe0f7">Planned</th>\n    <th data-nv-bg="blue" style="text-align:right;background:#cfe0f7">Spent</th>\n    <th data-nv-bg="blue" style="background:#cfe0f7">Status</th>\n  </tr>\n  <tr>\n    <td rowspan="2" style="vertical-align:middle">**Reading**</td>\n    <td>[[Line length study]]</td>\n    <td style="text-align:right">£4,000</td>\n    <td style="text-align:right">£3,200</td>\n    <td><ul><li>Fieldwork done</li><li>Write-up by **24 Oct**</li></ul></td>\n  </tr>\n  <tr>\n    <td>Ruler prototype</td>\n    <td style="text-align:right">£2,500</td>\n    <td data-nv-fg="red" style="text-align:right;color:#b42318">£2,900</td>\n    <td><label class="r48-chk"><input type="checkbox"> Needs sign-off from Maya</label></td>\n  </tr>\n  <tr>\n    <td>Focus</td>\n    <td>Timer research</td>\n    <td style="text-align:right">£3,000</td>\n    <td style="text-align:right">£1,100</td>\n    <td>On track</td>\n  </tr>\n  <tr>\n    <td colspan="2">**Total**</td>\n    <td style="text-align:right">£9,500</td>\n    <td style="text-align:right">£7,200</td>\n    <td data-nv-bg="green" style="background:#cdebc5">Under budget</td>\n  </tr>\n</table>\n\n## Next\n- Ask Maya to sign off the ruler overspend.';
const R48_T = (rows, b, cols) => `<table data-nv-borders="${b || 'all'}">\n` + (cols ? `  <colgroup>${cols}</colgroup>\n` : '') + rows.map(r => '  <tr>\n' + r.map(c => '    ' + c).join('\n') + '\n  </tr>').join('\n') + '\n</table>';
MD_CASES.push(
  { name: 'Build P: the R48c rich table (merged cells, widths, colours, a list, a checkbox)', md: R48C_SAMPLE },
  { name: 'Build P: rich table with no borders', md: R48_T([['<th>A</th>', '<th>B</th>'], ['<td>1</td>', '<td>2</td>']], 'none') },
  { name: 'Build P: rich table with outside borders only, right after a paragraph line', md: 'Intro line\n' + R48_T([['<th>A</th>', '<th>B</th>'], ['<td>1</td>', '<td>2</td>']], 'outer') + '\n\nAfter' },
  { name: 'Build P: rich table between headings', md: '## Before\n\n' + R48_T([['<th colspan="2">Both</th>'], ['<td>1</td>', '<td>2</td>']]) + '\n\n## After' },
  { name: 'Build P: rich cells keep their Markdown (links, wiki links, tags, code, strike, highlight)', md: R48_T([['<th>Links</th>', '<th>More</th>'], ['<td style="vertical-align:bottom">[[Note|shown]] and [site](https://example.com/a) #tag</td>', '<td>`co|de` ~~old~~ <mark class="hl-yellow">hi</mark> <u>u</u></td>']]) },
  { name: 'Build P: rich cells with literal < > & and escapes', md: R48_T([['<th rowspan="2">5 < 6, &lt;b> &amp; AT&amp;T</th>', '<th>\\*not bold\\* and a | pipe</th>'], ['<td>C:\\Users\\alex and &amp;amp; written out</td>']]) },
  { name: 'Build P: rich cells with line breaks, a ticked box and an ordered list from 3', md: R48_T([['<th>Lines</th>', '<th>Done</th>', '<th>Steps</th>'], ['<td>one<br>two</td>', '<td><label class="r48-chk"><input type="checkbox" checked> Signed</label></td>', '<td><ol start="3"><li>three</li><li>four **md**</li></ol></td>']]) },
  { name: 'Build P: every cell colour and text colour', md: R48_T([['<th data-nv-bg="yellow" style="background:#fbe7a1">y</th>', '<th data-nv-bg="pink" style="background:#f6d0dc">p</th>', '<th data-nv-bg="orange" style="background:#fbd6b4">o</th>'], ['<td data-nv-fg="orange" style="color:#a14a07">o</td>', '<td data-nv-bg="blue" data-nv-fg="violet" style="background:#cfe0f7;color:#5b3fd6">v</td>', '<td data-nv-fg="grey" style="text-align:center;color:#5d6470">g</td>']]) },
  { name: 'Build P: aligned Markdown table stays Markdown', md: '| A | B | C |\n| :--- | :---: | ---: |\n| [[x]] | **b** | 3 |' },
  { name: 'Build P: an old-style HTML table (no data-nv) is written in the R48c format', md: '<table><thead><tr><th colspan="2">Head</th></tr></thead><tbody><tr><td>a</td><td>b</td></tr></tbody></table>',
    expect: R48_T([['<th colspan="2">Head</th>'], ['<td>a</td>', '<td>b</td>']]), why: 'Rich tables are saved in one format (R48c): a row per line, data-nv-borders on the table.' },
  { name: 'Build P: colours written by hand in Obsidian (style only) get their theme names', md: R48_T([['<th style="background:#cfe0f7">A</th>'], ['<td style="color:#b42318">1</td>']]),
    expect: R48_T([['<th data-nv-bg="blue" style="background:#cfe0f7">A</th>'], ['<td data-nv-fg="red" style="color:#b42318">1</td>']]), why: 'A fallback colour that matches a theme colour is read as that colour, so NeuroVault draws it in every theme.' },
  { name: 'Build P: a style colour that is no theme colour is dropped (the table becomes Markdown)', md: R48_T([['<th style="background:#123456">A</th>'], ['<td>1</td>']]),
    expect: '| A |\n| --- |\n| 1 |', why: 'Only the editor\'s own colours are kept; with nothing rich left, the table is Markdown.' }
);
HTML_CASES.push(
  { name: 'Build P: merged cells from the editor', html: '<table><thead><tr><th>A</th><th>B</th></tr></thead><tbody><tr><td colspan="2">both</td></tr><tr><td>1</td><td>2</td></tr></tbody></table>', md: R48_T([['<th>A</th>', '<th>B</th>'], ['<td colspan="2">both</td>'], ['<td>1</td>', '<td>2</td>']]) },
  { name: 'Build P: a dragged column width', html: '<table><colgroup><col width="140"><col></colgroup><thead><tr><th>A</th><th>B</th></tr></thead><tbody><tr><td>1</td><td>2</td></tr></tbody></table>', md: R48_T([['<th>A</th>', '<th>B</th>'], ['<td>1</td>', '<td>2</td>']], 'all', '<col style="width:140px"><col>') },
  { name: 'Build P: cell colour, text colour and vertical alignment', html: '<table><thead><tr><th data-nv-bg="green">A</th><th align="center">B</th></tr></thead><tbody><tr><td data-nv-fg="blue" data-nv-va="middle">1</td><td align="center">2</td></tr></tbody></table>',
    md: R48_T([['<th data-nv-bg="green" style="background:#cdebc5">A</th>', '<th style="text-align:center">B</th>'], ['<td data-nv-fg="blue" style="vertical-align:middle;color:#1d4ed8">1</td>', '<td style="text-align:center">2</td>']]) },
  { name: 'Build P: no borders', html: '<table data-nv-borders="none"><thead><tr><th>A</th></tr></thead><tbody><tr><td>1</td></tr></tbody></table>', md: R48_T([['<th>A</th>'], ['<td>1</td>']], 'none') },
  { name: 'Build P: a list and a ticked checkbox in cells, with Markdown in them', html: '<table><thead><tr><th>A</th><th>B</th></tr></thead><tbody><tr><td><ul><li>one <strong>b</strong></li><li><span class="wikilink" data-wiki="Two">[[Two]]</span></li></ul></td><td><input type="checkbox" checked=""> sign <em>it</em></td></tr></tbody></table>',
    md: R48_T([['<th>A</th>', '<th>B</th>'], ['<td><ul><li>one **b**</li><li>[[Two]]</li></ul></td>', '<td><label class="r48-chk"><input type="checkbox" checked> sign *it*</label></td>']]) },
  { name: 'Build P: borders back to all and nothing rich: Markdown again', html: '<table data-nv-borders="all"><thead><tr><th>A</th><th align="right">B</th></tr></thead><tbody><tr><td>1</td><td align="right">2</td></tr></tbody></table>', md: '| A | B |\n| --- | ---: |\n| 1 | 2 |' },
  { name: 'Build P: a colspan of 1 is no merge', html: '<table><thead><tr><th colspan="1">A</th></tr></thead><tbody><tr><td rowspan="1">1</td></tr></tbody></table>', md: '| A |\n| --- |\n| 1 |' }
);
XSS_CASES.push(
  '<table data-nv-borders="all" onmouseover="__xss(90)"><tr><td style="background:url(javascript:__xss(90))">x</td></tr></table>',
  '<table><colgroup><col style="width:expression(__xss(91))" onclick="__xss(91)"></colgroup><tr><th data-nv-bg="blue;x:url(javascript:__xss(91))">a</th></tr></table>',
  '<table data-nv-borders="none\\" onmouseover=\\"__xss(92)"><tr><td colspan="2 onclick=__xss(92)" rowspan="999999">x</td></tr></table>',
  '<table>\n  <tr>\n    <td>[x](javascript:__xss(93)) <img src=x onerror=__xss(93)></td>\n    <td><label class="r48-chk" onclick="__xss(93)"><input type="checkbox" onfocus="__xss(93)" autofocus> y</label></td>\n  </tr>\n</table>',
  '<table data-nv-borders="outer">\n  <tr>\n    <th><ul><li><script>__xss(94)</script></li></ul></th>\n  </tr>\n</table>'
);
/* ==== end Build P ==== */

/* ==== Build P (QC 40) · Obsidian callouts: "> [!type]± Title" and its body come back exactly: the title, the fold marker,
   the type as written, body lines straight under the title or after an empty ">" line, lists, bold, [[links]], nesting ==== */
const CO_ALL = ['note', 'abstract', 'summary', 'tldr', 'info', 'todo', 'tip', 'hint', 'important', 'success', 'check', 'done', 'question', 'help', 'faq',
  'warning', 'caution', 'attention', 'failure', 'fail', 'missing', 'danger', 'error', 'bug', 'example', 'quote', 'cite', 'my-own-type'];
MD_CASES.push(
  { name: 'Build P callout: the AI summary (Build N) with a list straight under the title', md: '> [!summary] Summary · Qwen3.5 4B · 17 Oct 2026\n> - The interview went well\n> - Follow up with **Maya** about [[Line length study]]' },
  { name: 'Build P callout: folded, a body line straight under the title', md: '> [!faq]- Are callouts foldable?\n> Yes! In a foldable callout, the contents are hidden.' },
  { name: 'Build P callout: open fold, empty > lines between the parts', md: '> [!tip]+ Open by default\n>\n> Body after an empty line\n>\n> - one\n> - two\n>\n> Last line' },
  { name: 'Build P callout: the type as written (upper case), no title', md: '> [!NOTE]\n> Upper-case type, no title' },
  { name: 'Build P callout: only the marker', md: '> [!warning]' },
  { name: 'Build P callout: only the marker and a title', md: '## Before\n\n> [!success] Done\n\nAfter' },
  { name: 'Build P callout: a title with Markdown, then two lines', md: 'Intro line\n> [!quote] Title with *em*, `code`, [[Note|shown]] and #tag\n> Line one\n> line two\n## After' },
  { name: 'Build P callout: nested callouts and a code block', md: '> [!note] Outer\n> > [!bug]- Inner\n> > body\n>\n> ```js\n> let x = 1;\n> ```' },
  { name: 'Build P callout: every type and other name', md: CO_ALL.map(t => `> [!${t}] ${t} title\n> ${t} body`).join('\n\n') },
  { name: 'Build P callout: a voice note in a callout (heading, player line, transcript)', md: '> [!note] Voice note · 22:17\n>\n> ![[attachments/voice-20261017-221517.ogg]]\n>\n> The transcript' },
  { name: 'Build P callout: escapes in the title stay escaped', md: '> [!info] 2 * 3 is not \\*bold\\* and \\[not a link](x)\n> body' },
  { name: 'Build P callout: plain quotes stay plain (no marker, or an escaped one)', md: '> plain quote\n> two\n\n> \\[!note] written out, not a callout' }
);
HTML_CASES.push(
  { name: 'Build P callout: Enter in the title made a body line (data-tight)', html: '<blockquote class="callout" data-callout="note"><p class="callout-title" data-tight="">Title</p><p>Body</p></blockquote>', md: '> [!note] Title\n> Body' },
  { name: 'Build P callout: folded in the editor is a view: the .md keeps its marker', html: '<blockquote class="callout" data-callout="faq" data-callout-fold="+" data-folded=""><p class="callout-title">Q</p><p>A</p></blockquote>', md: '> [!faq]+ Q\n>\n> A' },
  { name: 'Build P callout: the title deleted, the body kept', html: '<blockquote class="callout" data-callout="tip"><p>Only the body</p></blockquote>', md: '> [!tip]\n>\n> Only the body' },
  { name: 'Build P callout: a title line left in a plain quote is a plain line', html: '<blockquote><p class="callout-title" data-callout="note">Was a title</p><p>Body</p></blockquote>', md: '> Was a title\n>\n> Body' },
  { name: 'Build P callout: a callout turned to a quote (no data-callout) is a plain quote', html: '<blockquote class="callout"><p class="callout-title">T</p></blockquote>', md: '> T' }
);
XSS_CASES.push(
  '> [!note" onmouseover="__xss(95)] T\n> body',
  '<blockquote class="callout" data-callout="note onmouseover=__xss(96)" onclick="__xss(96)"><p class="callout-title" data-callout="&lt;img src=x onerror=__xss(96)&gt;">T</p></blockquote>',
  '> [!note] <img src=x onerror=__xss(97)> [x](javascript:__xss(97))\n> <script>__xss(97)</script>'
);
/* ==== end Build P callouts ==== */

/* ==== Build V · code blocks like VS Code (mockup R57): the ```lang fence comes back exactly, in the 10 languages and their
   other names, with code the light check would mark; and the editor's decorated block (head, line numbers, colours, marks:
   all data-md-ignore or plain spans) saves as the plain fence ==== */
MD_CASES.push(
  ...['js', 'javascript', 'ts', 'typescript', 'python', 'py', 'sql', 'json', 'html', 'xml', 'css', 'bash', 'sh', 'markdown', 'md', 'rust'].map(l => ({ name: `R57 fence: ${l}`, md: '```' + l + '\nfirst (line) [1] {2}\n  "second" \'third\'\n```' })),
  { name: 'R57 fence: a quote left open stays as written', md: "```js\nconst a = 'x;\nfoo(1, [2);\n```" },
  { name: 'R57 fence: tabs and trailing brackets', md: '```python\ndef f(x):\n\treturn {"a": [x]}\n```' },
  { name: 'R57 fence: an empty line inside the code', md: '```css\na { color: red; }\n\nb { color: blue; }\n```' }
);
HTML_CASES.push(
  { name: 'R57 decorated block (head, numbers, colours, marks)', html: '<pre class="cb has-nums is-editing" data-lang="Python" aria-label="Code block, Python"><span class="cb-head" data-md-ignore="" contenteditable="false"><button class="cb-lang" data-cb="lang" data-label="Python"></button><span class="cb-grow"></span><span class="cb-note" data-label="1 problem"></span><button class="icon-btn cb-copy" data-cb="copy"></button></span><span class="cb-gut" data-md-ignore="" contenteditable="false" data-nums="1&#10;2"></span><code class="language-python"><span class="hljs-cb"><span class="hljs-keyword">def</span> <span class="hljs-title function_">f</span>():\n    <span class="hljs-keyword">return</span> <span class="hljs-string">\'x</span></span><span class="cb-marks" data-md-ignore="" contenteditable="false"><span class="cb-mark cb-issue"></span></span></code><span class="cb-hint" data-md-ignore="" contenteditable="false" data-label="Tab indents"></span></pre>', md: "```python\ndef f():\n    return 'x\n```" },
  { name: 'R57 language picked: the fence word follows the code class', html: '<pre class="cb" data-lang="TypeScript"><code class="language-ts"><span class="hljs-cb">let a: number</span></code></pre>', md: '```ts\nlet a: number\n```' }
);
/* ==== end Build V · code blocks ==== */

/* ==== Build V · photos in notes (mockup R59): the caption line and the pins (comment + numbered list) come back exactly ==== */
MD_CASES.push(
  { name: 'R59 caption under a photo', md: '![[attachments/whiteboard.png]]\n*Tuesday’s whiteboard: the token flow*' },
  { name: 'R59 pins: the comment, then their notes', md: '![[attachments/whiteboard.png]]\n\n<!-- nv-pins 24.0,30.0 70.5,30.0 -->\n\n1. The access token: 15 minutes\n2. The API checks it' },
  { name: 'R59 caption and pins, then text', md: 'Before.\n\n![[attachments/w.png]]\n*A caption with **bold***\n\n<!-- nv-pins 10.0,90.0 -->\n\n1. One pin\n\nAfter.' }
);
HTML_CASES.push(
  { name: 'R59 the editor’s caption paragraph (the embed hidden, not editable)', html: '<div class="att-img" data-embed-for="attachments/w.png" data-md-ignore="" contenteditable="false"><img alt="w"><span class="ph-pins"><button class="ph-pin">1</button></span></div><p class="ph-cap-p"><span class="ph-hide" contenteditable="false">!<span class="wikilink" data-wiki="attachments/w.png">[[attachments/w.png]]</span></span><br><em class="ph-cap">A caption</em></p>', md: '![[attachments/w.png]]\n*A caption*' }
);
/* ==== end Build V · photos ==== */
