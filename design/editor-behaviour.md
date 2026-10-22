# Note editor: how it should behave

The note editor is the Document view of a note: a `contenteditable` page (`frontend/js/render-notes.js`, toolbar in `doFormat()` and `zonesRibbon()`, events in `frontend/js/actions.js`), saved to Markdown by `frontend/js/markdown.js`. This spec says what each action should do, where that comes from, and what it does today.

- **Tests:** `frontend/tests/editor-behaviour.html` drives the real editor through every row with an ID. Run it through the dev bridge on a scratch database, as described under [Running the suite](#running-the-suite).
- **Today** means `build/new-frontend` at **49ada02**, tested on 2026-10-16. Each Today cell is one of:
  - **Pass**;
  - **Fail**, with what happens instead;
  - **Not built**.

  Rows marked *(real keys)* were also checked with real mouse and keyboard input in the browser pane.
- **E-n** points to the case in the shared fix list, `editor-qc.md`. E-1 to E-39 came from the user and the fix session; E-40 onward came from this spec.

## The rules behind every row

These apply to every action. The suite checks them on every case, after the case's own checks.

| Rule | What it means | Source |
|---|---|---|
| R1 · Focus stays | After a toolbar button, picker, menu or key, the note keeps focus and the caret stays where it was (or after what was inserted). Clicking the toolbar never moves focus to the toolbar. | GD-KS, W-KS: the toolbar acts on the text. MDN-SEL: the selection belongs to the editing host. |
| R2 · Selection kept | An inline style applied to a selection leaves the same text selected. | Docs and Word behaviour, NV |
| R3 · Nothing invented | A button never inserts placeholder text ("New task", "highlighted", "link text", "// your code"). With only a caret, the next typed text gets the format, or the new block is empty with the caret inside. | User (E-1); Notion N1 "Turn into" keeps the content |
| R4 · Nothing lost | A block button keeps the text of every line it touches. Deleting a selection removes only the selection, then joins the two ends. | User (E-2); EXEC-SPEC "delete the selection" |
| R5 · Every line | Block buttons (heading, quote, lists, task, alignment, code block) act on every block the selection touches, and each paragraph stays its own item or line. | EXEC-SPEC: block commands extend to each block that contains part of the selection; W-L "select the text … then Bullets" |
| R6 · Saved | Every change marks the note for saving (`noteEdited`), so nothing is lost on close. | NV autosave (render-notes.js:40) |
| R7 · What you see is what reopens | The saved `.md`, loaded again, shows the same blocks with the same text, and saving it again gives the same `.md`. Empty lines may go, but nothing else may change. Valid HTML only: no list, heading or other block inside a `<p>`. | NV: the note is Markdown (markdown.js header); markdown-roundtrip.html |
| R8 · One undo per action | Each button, key or paste is one Ctrl+Z, and Ctrl+Y or Ctrl+Shift+Z brings it back. A change made with direct DOM edits is not on the browser's undo stack. | MDN-EC: execCommand keeps the undo buffer, unlike direct DOM changes. GD-KS: redo is Ctrl+Shift+Z. W-KS: redo is Ctrl+Y. |
| R9 · No surprise re-renders | Nothing rebuilds the editor while you write: not a picker, the ⋯ menu, a toast, the palette or a board tick. A rebuild loses the caret, the selection and the undo history. | Follows from R1 and R8 |

## Toolbar: Task checkbox

Starting states: *empty line* is `<p><br></p>` after a paragraph. A caret is shown as ‸ and a selection as ⟦…⟧.

| ID | Action | Start | Should | Source | Today | E |
|---|---|---|---|---|---|---|
| TASK-01 | Task button | empty line | Checkbox, caret right after it, no text. Typing goes into the task. | User E-1; GD-L checklist; N2 Ctrl+Shift+4 | **Fail** *(real keys)*: inserts "New task" and types after it | E-1, E-46 |
| TASK-02 | Task button | caret mid-line `alpha be‸ta` | The line becomes `- [ ] alpha beta`, caret where it was | N1 Turn into; R4 | **Fail**: splits the line at the caret: `alpha be` / empty task / `New taskta` | E-40 |
| TASK-03 | Task button | caret at the end of a line | The line becomes a task | as above | **Fail**: same split; the caret jumps to the note's start | E-40 |
| TASK-04 | Task button | selection inside one line | The line becomes a task, text kept, still selected | User E-2; R2, R4 | **Fail**: the selected text is deleted | E-2, E-41 |
| TASK-05 | Task button | selection across three paragraphs | Three tasks, one per paragraph | R5; GD-L | **Fail**: everything selected is replaced by one "New task" | E-41 |
| TASK-06 | Task button | in a bullet item | That item becomes a task in the same list | R5; N1 Turn into | **Fail**: nests a new "New task" under the item | E-42 |
| TASK-07 | Task button | on a task | Toggles off: plain text | GD-L, W-L (list buttons toggle) | **Fail**: nests a second task | E-43 |
| TASK-08 | Ctrl+A, then the Task button | whole note | Every line becomes a task | R5 | **Fail**: the whole note becomes one "New task" | E-41 |
| TASK-09 | Task button | in a code block | Nothing changes: code stays code | NV (code is literal) | **Fail**: a checkbox and "New task" go into the code | E-44 |
| TASK-10 | Task button | in a quote | `> - [ ] quoted` | R4 | **Fail**: splits the quote line | E-45 |
| TASK-11 | Task, type, Enter, type | empty line | Two tasks | GD-L; O1 | **Fail**: "New taskOne"; the second line is a plain `<div>` with no box that reopens as a task | E-46 |
| TASK-12 | (state) | caret in a task | The Task button shows as on | NV (paintFmtState) | Pass | |
| TASK-13 | (state) | after inserting a task | The Task button shows as on | NV | **Fail**: off (the inserted `div.task` isn't the `li.task-list-item` the state checks) | E-46 |

## Toolbar: inline styles

Bold, italic, strike, underline, superscript and subscript each run the same four cases (INL-01 to INL-28, four per style, in that order). Inline code has no toolbar button.

| ID | Action | Start | Should | Source | Today | E |
|---|---|---|---|---|---|---|
| INL-01/05/09/13/21/25 | Style button | selection in a line | Wraps it, keeps it selected | GD-KS, W-KS; R2 | Pass for all six styles (undo Pass) | |
| INL-02/06/10/14/22/26 | Style button | caret only | Nothing inserted; the next typed text has the style | Docs and Word behaviour; R3 | Pass | |
| INL-03/07/11/15/23/27 | Style button | selection across two paragraphs | Both styled, still two paragraphs | R5 | Pass | |
| INL-04/08/16/24/28 | Style button | styled text selected | The style comes off (toggle) | GD-KS, W-KS | Pass | |
| INL-12 | Strikethrough | `~~text~~` selected | The strike comes off | as above | **Fail**: stays struck (`strikeThrough` doesn't recognise the `<del>` that Markdown makes) | E-48 |
| INL-17–20 | Inline code | any | Wraps in `code` (Obsidian Ctrl+E) | O1 | **Not built**: no toolbar button. `doFormat('code')` exists but nothing calls it. | |
| INL-29 | Highlight (picker) | selection | `<mark class="hl-yellow">` around it, kept selected | R1, R2 | **Fail**: opening the picker rebuilds the editor, so "highlighted" goes in at the note's top; Ctrl+Z doesn't undo it | E-49 |
| INL-30 | Highlight | caret only | No placeholder; typing is highlighted | R3 | **Fail**: "highlighted" at the top | E-49 |
| INL-31 | Highlight | across two paragraphs | Both highlighted, still two paragraphs | R5 | **Fail**: placeholder at the top | E-49, E-8 |
| INL-32 | Remove highlight | highlighted text | Only the highlight goes | NV | **Fail**: `<mark>` stays | E-50, E-18 |
| INL-33–35 | Text colour (picker) | selection, caret, two paragraphs | As highlight | as above | **Fail**: "coloured text" at the top, not undoable | E-49 |
| INL-36–38 | Ctrl+B, Ctrl+I, Ctrl+U | selection | Bold, italic, underline | GD-KS, W-KS | Pass | |
| INL-39 | Ctrl+B, then type | caret | Typed text is bold | as above | Pass | |
| INL-40 | Bold | selection in a heading | `# alpha **beta**` | O1 | **Fail**: nothing (Chromium thinks heading text is already bold) | E-51 |
| INL-41 | Bold | selection in a list item | `- alpha **beta**` | | Pass | |
| INL-42 | (state) | caret in bold text | The Bold button shows as on | NV | Pass | |

## Toolbar: blocks (Text style list, quote, lists, code block)

| ID | Action | Start | Should | Source | Today | E |
|---|---|---|---|---|---|---|
| BLK-01 | Heading 1 | caret in a paragraph | `# alpha`, caret stays | GD-KS Ctrl+Alt+1 | Pass | |
| BLK-02 | Heading 2 | two paragraphs | Two headings | R5; EXEC-SPEC (p/div per line) | **Fail**: one heading "one two" (`formatBlock` merges the lines with `<br>`) | E-52 |
| BLK-03 | Text | on a heading | Paragraph | GD-KS Ctrl+Alt+0 | Pass | |
| BLK-04 | Heading 1, then type | empty line | `# Z` | | Pass | |
| BLK-05 | Heading 6 | caret | `###### alpha` | | Pass | |
| BLK-06 | (state) | caret in a Heading 2 | The list says Heading 2 | NV | Pass | |
| BLK-07 | Quote | caret | `> alpha` | | Pass | |
| BLK-08 | Quote | on a quote | Toggles off | GD-L / W-L toggle pattern | **Fail**: nests `> > alpha` | E-53, E-26 |
| BLK-09 | Quote | two paragraphs | One quote holding two paragraphs | R5 | **Fail**: one paragraph with a line break (`> one\n> two`) | E-54 |
| BLK-10 | Quote from the Text style list | caret | `> alpha` | | Pass | |
| BLK-11 | Bullet list | caret in a paragraph | `- alpha`, caret stays | W-L | **Fail**: `<p><ul>…</ul></p>` (invalid HTML), caret jumps to the item's start | E-55 |
| BLK-12 | Bullet list, then type | empty line | `- Z` | | **Fail**: invalid `<p><ul>` (the text is right) | E-55 |
| BLK-13 | Bullet list | on a bullet | Toggles off | GD-L, W-L | Pass | |
| BLK-14 | Bullet list | three paragraphs | Three bullets | W-L | **Fail**: invalid `<p><ul>` | E-55 |
| BLK-15/16 | Numbered list | caret / two paragraphs | `1. …` | W-L | **Fail**: invalid `<p><ol>` | E-55 |
| BLK-17 | Numbered list | on a bullet list | The list switches type | EXEC-SPEC (converts lists of the other type) | **Fail**: only the item at the caret switches (`1. a` then `- b`) | E-56 |
| BLK-18 | Bullet list | on a numbered list | as above | as above | **Fail**: as above | E-56 |
| BLK-19 | Bullet list | on a task | `- a` (the box goes) | GD-L | **Fail**: the box stays and the bullet goes (` a`) | E-57, E-27 |
| BLK-20 | Ctrl+A, then Bullet list | whole note | Every line a bullet | R5 | **Fail**: invalid `<p><ul>` | E-55 |
| BLK-21 | (state) | caret in a bullet | The Bullet list button shows as on | NV | Pass | |
| BLK-22 | Code block (JavaScript) | empty line | Empty fenced block there, caret inside | R3; O1 | **Fail**: "// your code" block at the note's top; not undoable | E-58, E-9, E-12 |
| BLK-23 | Code block | two selected lines | One block holding both lines | R4, R5 | **Fail**: placeholder block at the top; the lines stay outside | E-58 |
| BLK-24 | Code block | caret in a paragraph | That line becomes code, in place | R5 | **Fail**: as BLK-22 | E-58 |

## Toolbar: insert (line, table, link, wiki link, fold, image)

| ID | Action | Start | Should | Source | Today | E |
|---|---|---|---|---|---|---|
| INS-01 | Horizontal line | end of a paragraph | `---` below; typing goes on the line after | | Pass | |
| INS-02 | Horizontal line | mid-line | The line splits around it, nothing lost | R4 | Pass | |
| INS-03 | Horizontal line | empty line | `---`; typing below it | | Pass | |
| INS-04 | Table 2×3 (picker) | empty line | Table there, caret in the first cell | R1 | **Fail**: the table goes in at the note's top, typing goes outside it, not undoable | E-59 |
| INS-05 | Table | caret after "Second" | Table after "Second" | R1, R9 | **Fail**: at the top | E-59 |
| INS-06 | Link | selection | The selection becomes the link text, and you choose the address | GD-KS / W-KS (Ctrl+K link box) | **Fail**: fixed `https://example.org` | E-60, E-10 |
| INS-07 | Link | caret | No placeholder link | R3 | **Fail**: inserts "link text" → example.org | E-60 |
| INS-08 | Link to a note | selection "Ideas" | `[[Ideas]]` | O1 (wiki links) | **Fail**: the selection is replaced by another note's title | E-61, E-11 |
| INS-09 | Link to a note, then type a title | caret | `[[` `]]` with the caret inside | O1 | **Fail**: inserts a link to whichever note is first | E-61 |
| INS-10 | Collapsible section | selection | The text goes inside `<details>` | NV | Pass | |
| INS-11 | Collapsible section | two paragraphs | Both go inside | R5 | Pass | |
| — | Image or attachment | any | Insert a file from `attachments/` | NV | **Not built**: the button says "coming soon" | |

## Toolbar: alignment (Zone B)

| ID | Action | Start | Should | Source | Today | E |
|---|---|---|---|---|---|---|
| ALN-01 | Align centre | caret | `<div align="center">` around the paragraph; undoable | NV markdown.js | Pass; **Fail on undo**: `setAttribute` isn't on the undo stack | E-62 |
| ALN-02 | Align right | two paragraphs | Both aligned | R5 | **Fail**: only the first; not undoable | E-62, E-15 |
| ALN-03 | Align left | centred paragraph | Plain (left is the default) | NV | **Fail**: writes `align="left"`; not undoable | E-62, E-15 |
| ALN-04 | (state) | caret in a centred paragraph | Align centre shows as on | NV | Pass | |

The Zone A / Zone B layout itself: Zone B shows only with *Show HTML extensions* on (Settings → Editor). Buttons that don't fit move into ⋯, which is covered next.

## The ⋯ menu (a narrow window)

| ID | Action | Start | Should | Source | Today | E |
|---|---|---|---|---|---|---|
| OVF-01 | ⋯ → Task checkbox | empty line | As TASK-01 | R1, R9 | **Fail** *(real mouse)*: opening ⋯ rebuilds the editor and the caret goes to the top, so the task and "New task" go at the top, splitting the first line | E-79 |
| OVF-02 | ⋯ → Task checkbox | selection | As TASK-04 | R2, R9 | **Fail** *(real mouse)*: the selection is gone, and the task goes at the top | E-79 |
| OVF-03 | ⋯ → Numbered list | caret in the second paragraph | `1. second` | R9 | **Fail**: the *first* paragraph becomes the list | E-79 |
| OVF-04 | Open ⋯ | caret mid-word | The caret stays | R9 | **Fail**: the caret moves to the note's start | E-79 |

On a narrow window this is probably how the user meets E-1 and E-2: every ⋯ format lands at the top of the note.

## Enter and Shift+Enter

| ID | Key | Start | Should | Source | Today | E |
|---|---|---|---|---|---|---|
| ENT-01 | Enter | end of a bullet | A new bullet | GD-L, W-L, N2 | Pass | |
| ENT-02 | Enter | end of a task | A new unticked task, caret after its box | GD-L checklist; O1 | **Fail** *(real keys)*: a bullet with no box | E-63, E-6 |
| ENT-03 | Enter | end of a ticked task | The new task is unticked | as above | **Fail**: a bullet with no box | E-63 |
| ENT-04 | Enter | empty bullet | The list ends (a paragraph) | GD-L "Enter twice"; W-L | Pass *(real keys)* | |
| ENT-05 | Enter | empty task | The list ends | as above | **Fail**: a plain bullet; the empty task reopens as literal "[ ]" | E-64, E-25 |
| ENT-06 | Enter | middle of a bullet | Splits into two bullets | | Pass | |
| ENT-07 | Enter | middle of a task | Two tasks | GD-L | **Fail**: the second half has no box | E-63 |
| ENT-08 | Enter | start of a task's text | An empty task above; the caret stays with the text in a task | | **Fail**: the text's line loses its box | E-63 |
| ENT-09 | Enter | end of a heading | The next line is plain text | Docs and Word behaviour | Pass | |
| ENT-10 | Enter | end of a quote | A new line in the quote | | Pass | |
| ENT-11 | Enter | empty line in a quote | The quote ends | like lists (GD-L) | **Fail**: stays in the quote | E-65 |
| ENT-12 | Enter | in a code block | A new code line | | Pass | |
| ENT-13/14 | Enter | numbered item / empty numbered item | The next number / the list ends | | Pass | |
| ENT-15 | Enter | middle of a paragraph | Two paragraphs | | Pass | |
| ENT-16/17 | Shift+Enter | in a bullet / in a task | A line break inside the same item | O1, N2 | Pass | |
| ENT-18 | Shift+Enter | in a paragraph | A line break, same paragraph | | Pass | |
| ENT-19/20 | type, Enter, type | empty note / note with no blocks | Two paragraphs (`<p>`) | NV (defaultParagraphSeparator) | Pass | |

## Backspace and Delete

| ID | Key | Start | Should | Source | Today | E |
|---|---|---|---|---|---|---|
| BSP-01 | Backspace | start of the first bullet | The bullet goes, the text stays | EXEC-SPEC (start of the first `li` outdents); Docs | **Fail** *(real keys)*: nothing happens | E-66 |
| BSP-02 | Backspace | start of a later bullet | That bullet goes; its text becomes a paragraph | Docs / Word | **Fail**: joins the item above | E-66 |
| BSP-03 | Backspace | start of a task's text | The box goes, the text stays | GD-L | **Fail**: the box stays | E-67, E-7 |
| BSP-04 | Backspace ×2 | empty task | It goes; the caret ends after the task above. Two keys may be two undo steps. | | Pass | |
| BSP-05 | Backspace ×2 | empty bullet | It goes; the caret ends after the bullet above | | **Fail**: empties the bullet above (`-`) | E-68 |
| BSP-06 | Backspace | start of a heading at the top | It becomes text | Docs | **Fail**: nothing | E-69 |
| BSP-07 | Backspace | start of a quote at the top | It leaves the quote | | **Fail**: nothing | E-69 |
| BSP-08 | Backspace | start of a paragraph after a list | Joins the last item | EXEC-SPEC | Pass | |
| BSP-09 | Backspace | selection across two items | One item left | EXEC-SPEC | Pass | |
| BSP-10 | Backspace | one character | Deletes it | | Pass | |
| BSP-11 | Delete | end of a bullet | The next bullet joins it | EXEC-SPEC | Pass | |
| BSP-12 | Delete | end of a task, before a ticked task | Its text joins, its box doesn't | | **Fail**: the next box lands mid-line (`a[x] b`) | E-70, E-22 |
| BSP-13/14 | Delete | before a list / a selection into a list item | The text joins | EXEC-SPEC | Pass | |
| BSP-15 | Backspace | start of a task, with a task above | The box goes first | GD-L | **Fail**: nothing | E-67 |

## Tab and Shift+Tab

| ID | Key | Start | Should | Source | Today | E |
|---|---|---|---|---|---|---|
| TAB-01 | Tab | second bullet | Nests under the first; focus stays | O1 "Tab or Shift+Tab to indent or unindent"; GD-L; N2 | **Fail** *(real keys)*: focus moves to a toolbar button | E-71, E-14 |
| TAB-02 | Shift+Tab | nested bullet | Back out a level | as above | **Fail**: focus leaves | E-71 |
| TAB-03 | Tab | second task | A nested task | O1 | **Fail** | E-71 |
| TAB-04 | Tab | second numbered item | Nested | | **Fail** | E-71 |
| TAB-05 | Tab | first bullet | No change; focus stays | | **Fail**: focus leaves | E-71 |
| TAB-06 | Tab | two selected bullets | Both nest | O1 "selected list items" | **Fail** | E-71 |
| TAB-07 | Tab | paragraph | Focus stays in the editor | Obsidian inserts a tab; Docs indents. The fix session asks Q-2 | **Fail**: focus leaves | E-71 |

## Select all (Ctrl+A)

| ID | Keys | Start | Should | Source | Today | E |
|---|---|---|---|---|---|---|
| ALL-01 | Ctrl+A, Delete | paragraphs and a list | One empty paragraph; focus stays; undoable | User E-3 | Pass | |
| ALL-02 | Ctrl+A, Backspace | as above | as above | E-3 | Pass | |
| ALL-03 | Ctrl+A, type | as above | The note is what you typed | | Pass | |
| ALL-04 | Ctrl+A, Delete | heading, tasks, table, code, quote | One empty paragraph | E-3 | **Fail** *(real keys)*: an empty `<h1>` is left | E-72 |
| ALL-05 | Ctrl+A, Delete, type | starts with a heading | Plain text | E-3 | **Fail** *(real keys)*: `# Z` | E-72 |
| ALL-06 | as ALL-05 | starts with a list | Plain text | E-3 | **Fail**: `- Z` | E-72 |
| ALL-07 | Ctrl+A, Backspace, type | starts with a task | Plain text | E-3 | **Fail** *(real keys)*: an empty bullet is left, so `- Z` | E-72 |
| ALL-08 | Ctrl+A, Delete | front matter + body | The front matter stays (it's hidden; edit it in Raw .md) | O3 / NV Properties | Pass *(real keys too: E-17 doesn't reproduce here)* | |
| ALL-09 | Ctrl+A, Delete | ends with a table | One empty paragraph | | Pass | |
| ALL-10 | Ctrl+A, Bold | two paragraphs | Both bold, still two paragraphs | | Pass | |
| ALL-11 | Ctrl+A | | Selects the note only (not the title or toolbar) | MDN-EC selectAll | Pass | |
| ALL-12 | Ctrl+A, paste | | The paste replaces the note | | Pass | |
| ALL-13 | Ctrl+A, type | starts with a heading | A plain paragraph | E-16 | **Fail** *(real keys)*: `# Z` | E-72, E-16 |

## Undo and redo

Each action row above with an undo variant (`<id>u` in the report) runs the action again, then Ctrl+Z (the start must come back), Ctrl+Y and Ctrl+Shift+Z (the result must come back). The rows above say where this fails: every picker (INL-29–35, BLK-22–24, INS-04/05) and alignment.

| ID | Keys | Start | Should | Source | Today |
|---|---|---|---|---|---|
| UND-01 | type, Ctrl+Z | | The typing is undone | GD-KS, W-KS | Pass |
| UND-02 | type, Ctrl+Z, Ctrl+Shift+Z | | Back again | GD-KS | Pass |
| UND-03 | type, Ctrl+Z, Ctrl+Y | | Back again | W-KS | Pass |
| UND-04 | Task button, type, Ctrl+Z ×2 | empty line | The note as it was | R8 | Pass |
| UND-05 | Ctrl+A, Delete, Ctrl+Z | big note | The whole note comes back | E-3 | Pass *(real keys: two Ctrl+Z after typing)* |

## Paste

The suite fires a real `paste` event with the clipboard data. If the app doesn't handle it, the suite does what Chromium would: it inserts the HTML (only the part between Windows' `<!--StartFragment-->` markers) or the text. Chromium's own paste cleaning isn't run. A real Ctrl+C / Ctrl+V can't be driven in the browser pane, which has no clipboard: both keys did nothing.

| ID | Paste | Start | Should | Source | Today | E |
|---|---|---|---|---|---|---|
| PST-01 | plain text, two lines | empty line | Two paragraphs | | Pass | |
| PST-02/03 | plain text mid-line / over a selection | | Inserted / replaces | | Pass | |
| PST-04 | Markdown text `- one\n- two` | empty line | A list (the note is Markdown) | O3 (Obsidian keeps Markdown); N2 shortcuts | **Fail**: escaped text `\- one` | E-73 |
| PST-05 | `- [ ] buy milk` | | A task | | **Fail**: `\- [ ] buy milk` | E-73 |
| PST-06 | `# Title` + `**bold**` | | Heading and bold | | **Fail**: escaped | E-73 |
| PST-07 | Word HTML | | Bold kept; fonts and `Mso` classes dropped | GD-KS / W-KS (paste keeps formatting, Ctrl+Shift+V drops it); R7 | **Fail**: Calibri spans and `MsoNormal` stay in the editor | E-74, E-20 |
| PST-08 | Word bulleted list | | A list | | **Fail**: "· one" paragraphs; `<!--[if !supportLists]-->` comments saved into the .md | E-74 |
| PST-09 | Google Docs HTML | | `**Bold** text` | | **Fail**: bold lost (it's carried by `font-weight:700`); styles stay in the editor | E-74 |
| PST-10 | web page | | Heading, link and list kept; styles dropped | | **Fail**: the `style` attributes stay in the editor | E-74 |
| PST-11 | rich text | in a code block | Plain code | | Pass | |
| PST-12 | two paragraphs | into a task | The second becomes a new task | GD-L behaviour | **Fail**: it joins the task ("abc"), saved as a continuation line | E-75 |
| PST-13 | tasks copied from a note | | Tasks, ticks kept | | Pass | |
| PST-14 | an image | | Shown at the caret, saved as `attachments/…png` | actions.js:373 comment; render-settings "Pasted images" | Saved as base64 `data:` in the .md. Now reported as **Not built**: it needs a backend call to save the file, and `api.py` has none yet | E-76 |
| — | Ctrl+Shift+V (paste as text) | | Plain text | GD-KS, W-KS | Can't be automated (no clipboard in the pane); Chromium handles it natively | |

## Markdown shortcuts while typing

The editor doesn't offer these: there's no claim in Settings, the help or the toolbar. They're listed as **Not built** and not counted in the pass/fail total. Typing Markdown today saves it escaped (`\- one`, `\# one`), so it stays text when the note is reopened.

| ID | Type | Should (if built) | Source | Today |
|---|---|---|---|---|
| MDS-01/02 | `- ` / `* ` | A bullet | N2; W-L ("* " AutoFormat) | Not built |
| MDS-03 | `1. ` | A numbered list | N2; W-L | Not built |
| MDS-04/05 | `[ ] ` / `- [ ] ` | A task | N1 `[]`; O1 | Not built |
| MDS-06/07 | `# ` / `## ` | Headings | N2 | Not built |
| MDS-08 | `> ` | A quote (in Notion `> ` makes a toggle list) | N2 | Not built |
| MDS-09 | ```` ``` ```` then Enter | A code block | O1 | Not built |
| MDS-10 | `**bold**` | Bold | N1 | Not built |
| MDS-11 | `---` then Enter | A line | N2 | Not built |

## Tasks in the note and the Tasks board

These cases need the dev bridge, which gives a live vault. Without it they report SKIP.

| ID | Action | Should | Source | Today | E |
|---|---|---|---|---|---|
| SYNC-01 | Tick a `- [ ]` line in the note | Its board task is done; the .md says `[x]` | NV Phase 3 (store.js:441) | Pass *(real click too)* | |
| SYNC-02 | Untick it | The board follows | | Pass | |
| SYNC-03 | Tick it on the board | The open note shows the tick | | **Fail**: the editor still shows it unticked, and the next edit there writes the unticked line back | E-77 |
| SYNC-04 | Toolbar task + typed title, save | A board task with that title | | **Fail**: the board task is "New taskPay rent…" | E-47 |
| — | Click a checkbox in the note | The caret stays in the text | Obsidian / Docs behaviour | *(real click)* Focus moves onto the checkbox | E-81 |

## Caret, focus, modes

| ID | Action | Should | Source | Today | E |
|---|---|---|---|---|---|
| FOC-01 | Ctrl+K → Bold on a selection | Applies to the selection; focus returns | R1, R9 | **Fail**: closing the palette rebuilds the editor, so nothing gets bold; the tip toast then re-renders twice more | E-78 |
| FOC-02 | Ctrl+S while typing | Saved; the caret stays | GD-KS / W-KS | Pass *(real keys too)* | |
| FOC-03 | Type, then Raw .md | The text is there | NV | Pass | |
| FOC-04 | Raw .md and back | Unchanged | NV | Pass | |
| FOC-05 | A toast while typing | The caret stays | R9 | **Fail**: `toast()` re-renders the page now and 1.8 s later; the caret jumps to the start | E-80 |

## Save round trip (open and save without edits)

| ID | Note | Should | Today |
|---|---|---|---|
| RT-01–06 | The six sample notes (`tests/mockup-notes.js`), through the editor's render path (renderTasks, the props panel, video embeds) | The saved .md equals the converter's standard form of the note | Pass |
| RT-90 | Spelling and homophone marks on | The marks never reach the .md | Pass |
| — | `markdown-roundtrip.html` | 545 cases | Pass 545/545 |

## Totals

| Run | Counted | Pass | Fail | Not built |
|---|---|---|---|---|
| Baseline, `build/new-frontend` 49ada02 | 304 | 203 | 101 | 15 |
| Interim: the fix branch `claude/editor-fixes-f7ae4e` at 4baf9d9, merged into a scratch branch (not committed) | 312 | 278 | 34 | 15 |
| Rerun 2: 4baf9d9 plus the fix session's uncommitted `editor.js`, `markdown.js` and `store.js` (scratch branch, not committed) | 313 | 313 | 0 | 16 |
| **Final: the fix branch at 8e626ad** (committed tip, scratch merge not committed), with the wrap-up reminder due | 313 | 313 | 0 | 16 |

Rerun 2 also passed `markdown-roundtrip.html` (545/545). Real keys on that build passed too:
- **E-1:** ⋯ → Task on an empty line, then typing.
- **E-2:** a drag selection → ⋯ → Task keeps the text.
- **Enter and Tab:** Enter after a task makes a task, and Tab nests it.
- **E-3:** Ctrl+A, Delete, then typing gives a plain paragraph, and two Ctrl+Z bring the note back.

The 16 not built are:
- the inline code button;
- Markdown shortcuts while typing;
- PST-14, a pasted image saved as a file, which needs a backend call to save the file.

The suite doesn't cover E-81 (focus after a checkbox click) or E-83 (undo after an outside change). The list below is from the interim run.

Counted cases include the `u` (undo / redo) variants. A variant runs only when the action changes the note, so the count moves a little between runs.

### Still failing on the fix branch at 4baf9d9

- **Strikethrough doesn't toggle off** (INL-12, E-48).
- **Bold in a heading** does nothing (INL-40, E-51).
- **Highlight or Text colour with only a caret** styles the word at the caret, then leaves the word selected. The next key replaces it, so typing Z turns "alpha" into "Z" (INL-30, INL-34). Applying the format to the word is the fix session's choice (Word); leaving the word selected loses text.
- **Heading on two paragraphs** merges them (BLK-02, E-52).
- **Lists inside `<p>`**: the Bullet and Numbered list buttons nest the list in a `<p>`, and the caret jumps to the item's start (BLK-11/12/14/15/16/20, OVF-03, E-55).
- **List type switch** converts only the item at the caret (BLK-17/18, E-56).
- **Align left** on a centred paragraph leaves it centred (ALN-03, E-62).
- **Enter on an empty quote line** doesn't leave the quote (ENT-11, E-65).
- **Backspace** at the start of the first bullet, a later bullet, a heading or a quote (BSP-01/02/06/07), and twice on an empty bullet (BSP-05) (E-66, E-68, E-69).
- **Paste**: Markdown text is escaped (PST-04/05/06, E-73). Word lists and Google Docs bold (PST-08/09, E-74). Two paragraphs into a task (PST-12, E-75). Images saved as base64 (PST-14, E-76).
- **Board tick** doesn't reach the open note (SYNC-03, E-77).
- **Palette Bold** on a selection (FOC-01, E-78).
- **Decisions where the spec and the fix session differ** (for the user to settle):
  - INS-02: a horizontal line mid-line goes *after* the line, where the spec splits the line at the caret (as Docs and Word do).
  - BLK-24: a code block with the caret in a paragraph is added *after* the line, where the spec turns that line into code (as the other block buttons do).
  - TAB-07: Tab on a plain paragraph still leaves the editor (the fix session's Q-2).

## Real keystrokes (browser pane, dev bridge, 2026-10-16)

These used real mouse and keyboard input on `http://localhost:8813/` with a scratch database:

1. **Ctrl+A, Delete** on a heading + list + tasks note: an empty `<h1>` is left, and typing gives `# Z`. Two Ctrl+Z bring the note back. (ALL-04/05)
2. **Ctrl+A, Backspace** on a note starting with tasks: an empty bullet is left, and typing gives `- Z`. (ALL-07)
3. **⋯ → Task checkbox** on an empty line: opening ⋯ moves the caret to the note's start. The box and "New task" go at the top, inside a `style="background-color: transparent"` span. (E-1, OVF-01)
4. **Drag-select, then ⋯ → Task checkbox**: the selection is gone when ⋯ opens, and the task goes at the top. (E-2, OVF-02)
5. **Enter** at the end of a task: a bullet with no box. Enter twice ends the list. (ENT-02, ENT-04)
6. **Backspace** at the start of the first bullet does nothing. (BSP-01)
7. **Tab** in a bullet: focus moves to a toolbar button. (TAB-01)
8. **Ctrl+S** while typing: the caret stays. (FOC-02)
9. **Clicking a checkbox** ticks it, the board task follows, and the .md says `[x]`. Focus moves onto the checkbox. (SYNC-01, E-81)
10. **Drag-select, then the Bold button** (visible in the row): works, and the selection stays. (INL-01)
11. **Ctrl+A, Delete** with front matter: the front matter stays. (ALL-08)
12. **Ctrl+C / Ctrl+V and Ctrl+Shift+V**: nothing happens in the pane, which has no clipboard, so paste can't be tested with real keys here.

## What the suite can't automate

- **Real key defaults.** Chromium doesn't type for synthetic key events, so the suite runs keydown, then beforeinput with the real `inputType`, then the browser's own command. A handler that relies on `beforeinput.getTargetRanges()` gets an empty list, and IME composition isn't covered. The real-keystroke list above covers Ctrl+A, Delete, Backspace, Enter in lists and Tab.
- **Focus moving to a clicked toolbar button.** Synthetic `mousedown` has no default, so a missing `preventDefault` wouldn't show. Real clicks (checks 3, 4 and 10 above) cover this.
- **Real clipboard paste**, including Chromium's own HTML cleaning and Ctrl+Shift+V.
- **Visual checks**: the caret being visible on screen, scrolling to the caret, toolbar wrapping.
- **The Link address box and a note picker** (if they're built): they need their own UI steps.

## Running the suite

```
python dev_bridge.py --db <scratch>/test.db --config <scratch>/config.json --port 8813
http://localhost:8813/tests/editor-behaviour.html          (about 25 s)
http://localhost:8813/tests/editor-behaviour.html?only=TASK  (one area)
```

- **Data:** use a fresh database, never a copy of `knowledge_os.db`. A seed script that makes a project and two notes through `NeuroVaultApi` is enough. Give it a config with `obsidian_vault_path` blank and `setup_done: true`. The suite switches off the wrap-up reminder and the launchpad itself, because they open on their own when due and take focus.
- **Report:** the page's `<pre id="report">` holds one line per case: PASS, FAIL, NOT BUILT or SKIP, with its problems. The totals come first and last.
- **Status and data:** `document.title` ends `PASS n/n` or `FAIL f/n`. `window.__editorResults` holds the rows. `window.__editor` exposes the harness, so you can step through one case from the console.
- **Without the bridge** (`py -m http.server --directory frontend`), it runs on the sample vault, and the SYNC cases report SKIP.

## Sources

| Key | Page |
|---|---|
| GD-KS | Google Docs keyboard shortcuts: https://support.google.com/docs/answer/179738 |
| GD-L | Google Docs: Add a numbered list, bulleted list or checklist: https://support.google.com/docs/answer/3300615 |
| W-KS | Word keyboard shortcuts: https://support.microsoft.com/en-us/office/keyboard-shortcuts-in-word-95ef89dd-7142-4b50-afb2-f762f663ceb2 |
| W-L | Word: Create a bulleted or numbered list: https://support.microsoft.com/en-us/office/create-a-bulleted-or-numbered-list-9ff81241-58a8-4d88-8d8c-acab3006a23e (Word's checklist page returned 404) |
| O1 | Obsidian basic formatting syntax: https://obsidian.md/help/syntax |
| O3 | Obsidian Live Preview, edit and read: https://obsidian.md/help/edit-and-read |
| O4 | Obsidian editing shortcuts: https://obsidian.md/help/editing-shortcuts |
| N1 | Notion writing and editing basics: https://www.notion.com/help/writing-and-editing-basics |
| N2 | Notion keyboard shortcuts: https://www.notion.com/help/keyboard-shortcuts |
| MDN-CE | MDN contenteditable: https://developer.mozilla.org/en-US/docs/Web/HTML/Global_attributes/contenteditable |
| MDN-EC | MDN Document.execCommand (deprecated; keeps the undo buffer, unlike direct DOM changes): https://developer.mozilla.org/en-US/docs/Web/API/Document/execCommand |
| MDN-BI | MDN beforeinput: https://developer.mozilla.org/en-US/docs/Web/API/Element/beforeinput_event |
| IE2 | Input Events Level 2 (inputType list, cancelable, getTargetRanges): https://w3c.github.io/input-events/ |
| MDN-SEL | MDN Selection and Range: https://developer.mozilla.org/en-US/docs/Web/API/Selection, https://developer.mozilla.org/en-US/docs/Web/API/Range |
| EXEC-SPEC | execCommand draft (block-extended ranges, delete the selection, list toggling): https://w3c.github.io/editing/docs/execCommand/ |
| NV | NeuroVault's own rules: the Markdown note model (markdown.js header), Phase 3 line tasks (store.js), autosave (render-notes.js) |

What the sources don't settle, decided here, in Docs and Word's favour:

- **Task button on a task:** toggles it off.
- **Backspace at the start of a task:** removes the box first.
- **Tab on a plain paragraph:** keeps focus in the editor (see the fix session's Q-2).
- **Pasted Markdown text:** becomes Markdown.

Obsidian's own pages don't document list continuation, Ctrl+L or clicking a checkbox in Live Preview; those rows use Docs and Word.
