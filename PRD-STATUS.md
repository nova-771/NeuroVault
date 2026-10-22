# NeuroVault — PRD status: built vs. to build

_Compared on 2026-10-15: [PRD.md](PRD.md) against the running app (`main.py`, `api.py`, `db.py`, `frontend/`) and the R6 design mockup ([design/vault-notes-mockups.html](design/vault-notes-mockups.html))._

> **Update 2026-10-15:** mockup revision R7 (`design/vault-notes-mockups.html`) now designs almost every ⬜ item below as a clickable screen. The tables still describe the app itself, which hasn't changed. The R7 changelog in the mockup lists what was added.
>
> **R8 (2026-10-15):** workspace polish from your feedback: rail views without new tabs, tags on the title line, toolbar mode icons, one timer pill, a page with no card, centred columns, and tabs side by side. Your four locks are now decisions. See the R8 changelog.
>
> **R9 (2026-10-15):** your locks recorded. The Split button and Aa are gone, the ruler moved next to Read aloud, and sticky and voice sit on the left of the window bar. "Was doing" feeds the Timeline. Icon buttons are one size (18px), and the top rows and window-bar columns line up.
>
> **R10 (2026-10-15):** cohesion audit fixes. Sticky, brain dump and voice are grouped in the window bar, with no divider lines. Overflowing tabs fade and get a tab list. The rail lines up with the top row and the status bar, the editor toolbar no longer leaves a divider or a lone button on a line, and every control is on the 24/28/32/36 scale. The quick timer opens under its pill, the sidebar toggles stay plain, and the note's folder moved into the header path. See the R10 changelog.
>
> **R11 (2026-10-15):** the first tab's border lies on the sidebar's edge line. New switches for the top row height (36px default, 40, 32, R9's 44), the right sidebar toggle (beside the window buttons, with a divider) and the editor toolbar (one row with a ⋯ menu, or two rows as wide as the buttons). See the R11 changelog.
>
> **R12 (2026-10-15):** no focus outline around the note's text while you type (a switch keeps R11's outline to compare). See the R12 changelog.
>
> **Build Phase 1, shell (2026-10-15, branch `build/new-frontend`):** the old `frontend/` is replaced by the R20 mockup, extracted with every switch baked in (plain files, no build step). The app opens frameless with its own window bar, tabs, rail, sidebars and status bar on the mockup's sample data. Theme, accent, font and text size are reader settings in `config.json` (nine themes, Obsidian dark by default). Unbuilt features show dimmed as "Coming soon" in their final places. Edges resize and the window buttons work. The tables below still describe the real data, which comes in Phases 2–5 (`design/build-list-R20.md`).
>
> **Build Phase 2, Notes (2026-10-15, branch `build/phase2-notes`):** the Notes screen runs on the real database. Projects, folders and notes load through the API (existing notes are placed in folders once, on first launch). The file explorer creates, renames, moves (dialog and drag), sorts, collapses and deletes against the backend, with right-click menus and keys. The editor saves Word/Docs and Raw .md through the Markdown converter, autosaves 1.2 s after an edit and saves at once with Ctrl+S. Outline, Backlinks ([[wiki links]]), Tags, the Graph and Ctrl+K come from the loaded notes. Tasks are loaded for reading only (ticking them saves in Phase 3), and the Timer and Timeline still show sample data until their phases.
>
> **Build Phase 3, Tasks (2026-10-15, branch `build/phase3-tasks`):** the Tasks board runs on the real database. Quick add saves a task to a project and note (or a project alone) with priority, energy and today's due date. Ticking, the energy badge (high → medium → low), the filters (views, energy, project) and the linked note all work on real data. Steps can be added by hand with optional minutes, ticked one by one and removed; the 🪄 AI splitter stays "Coming soon". Ticks in a note's `{{tasks}}` block save at once. `- [ ]` lines in a note are tasks too: they are made, renamed, ticked and removed when the note saves, and ticking one on the board rewrites its line. New API call: `update_task`.
>
> **Build Phase 4, Timer (2026-10-15, branch `build/phase4-timer`):** the Timer runs on real data: projects with colour slots, every logged session, and the timer settings from `config.json`. Each start, pause (8 reasons), resume, 30-minute check-in, stop and 1–5 rating goes to the backend's running-session record, so a session survives the app closing; on launch it is picked up again, and after more than 2 minutes closed the app asks whether that time counts as work or a pause. Alerts follow the settings: 5-minute warning, sound, desktop notification, taskbar flash and overtime reminders. Projects can be added and deleted; `delete_project` now refuses a project with logged sessions.
>
> **Build Phase 5, Settings (2026-10-15, branch `build/phase5-settings`):** every working page of the Settings dialog reads and writes `config.json`: Reading & comfort (nine themes, four fonts, text size, letter / word spacing, line height and width, reading ruler on the pointer or caret, bionic reading, reduced motion), Editor, Focus & nudges (nudge interval, brown / pink / rain focus sound and its volume, which start again on launch), Timer alerts, Alert sound (a custom file now plays, read through `read_custom_sound`), Vault & files (Obsidian daily-notes folder, Browse, Test), Data (CSV export, database path) and Keyboard shortcuts (Ctrl+T and Ctrl+W now work). The rail's light/dark button swaps between Obsidian dark and the last light theme. Reduced motion now switches transitions off rather than shortening them, which had left the quick timer and note path measured one frame early. Daily wrap-up, AI models, Voice, the vault on disk and file history stay "Coming soon".

> **Build Phase 6C, Read aloud (2026-10-16, branch `build/phase6c-read-aloud`):** the note header's Read aloud button (also in More and Ctrl+K) opens the read bar: play / pause, speed 0.75–2×, a voice picker, and karaoke highlighting in the note (the sentence tinted, the spoken word marked; a click on a word reads on from there). Two engines, chosen in Settings → Voice so they can be compared: Windows voices (WebView2 speechSynthesis, exact word timing from its boundary events) and Kokoro / Piper through sherpa-onnx (`read_aloud.py`, one sentence at a time, word timing estimated). Models live outside git in `%LOCALAPPDATA%\NeuroVault\models\tts`; without one, the setting says so and Windows voices read. Settings → Voice also has Try it, Reading speed and "Highlight as it reads".
>
> **Build Phase 6A, Sticky notes and brain dump (2026-10-16, branch `build/phase6a-sticky-dump`):** the window bar's sticky button makes a floating sticky note on the layer above the tabs. It saves as you type, can be dragged, resized and coloured (five pastels), and stays put when you switch tabs; closing it keeps it, and the sidebar's `stickynoted` row opens them all again. The ⋮ menu promotes it to a note (opened in a new tab), appends it to a note (fuzzy picker), files it in a folder (or a new one) and converts it to a task with a 15-minute step, starting the quick timer. The inbox button, Ctrl+Shift+D or the sidebar's `_inbox.md` row opens the brain dump bar: Enter adds a time-stamped thought. Both are SQLite tables for now, shaped to become `stickynoted/` files and `_inbox.md` with the vault on disk. Ctrl+Shift+D is also a global hotkey in `main.py`, which needs the optional `keyboard` package.
>
> **Build A, Voice ramble v2 and attachments (2026-10-16, branch `build/voice-attach`; mockup R21–R28):** a voice ramble records in a pill at the bottom with no backdrop (pause, Stop, discard), showing the last few words heard (live words, a 44 MB streaming model; on with 5 GB or more free, else the compact pill says why). Stop asks one question: Keep (audio + text, text only, audio only), Save to (brain dump, this note, new note), "Always do this"; "Check the text first" opens the check dialog. Settings → Voice sets the defaults (audio + text into the brain dump, ask each time); with Ask off, Stop saves at once. Clips are files in `attachments/` (`.ogg`), embedded with `![[…]]`, and play in a one-line player in notes and the brain dump, with Transcribe for clips without text. The right sidebar's fourth tab, Attachments, lists the open note's files (open, reveal, remove to the recycle bin). Settings → Vault & files: the tab with no note open (message or hidden) and moving unused attachments to the recycle bin.
>
> **Build Phase 6B, Voice rambler (2026-10-16, branch `build/phase6b-voice`):** the window bar's 🎙 records (timer, live level, Stop), transcribes offline with sherpa-onnx Whisper (base.en or small.en, int8, downloaded once from the app), and opens the check dialog. The raw transcript sits beside a note cleaned by rules: filler words out, sentences and paragraphs with capitals, and "I need to…", "remind me to…" and "don't forget…" lines as pre-ticked tasks. Numbers, money, dates, times, deadlines and names are green when they're in both panes (hover pulses the twin) and amber with "+ Insert" when they're missing. Enter adds the result to the open note, or saves it as a new note; ticked tasks reach the Tasks board. Settings → Voice has the model (with Download) and the microphone. An AI clean-up comes with the model router.
>
> **Build B, Local AI (2026-10-16, branch `build/local-ai`):** NeuroVault downloads and runs AI models itself with llama.cpp's server: no Ollama or LM Studio needed. Settings → AI models (R22 "pick") reads this PC's memory, graphics card and free space, leads with the model that fits best (Qwen3.5 4B with a graphics card, 2B without), and folds the full list away (Qwen3.5 0.8B / 2B / 4B / 9B, Phi-4-mini, Gemma 4 E2B; models that don't fit are greyed out with the reason). Before anything downloads, the page names each file, its source and size. Downloads pause, resume (also after a restart) and cancel; the engine starts and stops with the app. The status bar names the model in use. "When you change model" (keep or delete the old one) and "Long questions" are settings, the router sends each job to the model in use, the voice rambler's clean-up goes through the model when it's ready (the rules stay the fallback), and the task wands break tasks into small timed steps. Ollama and LM Studio are optional connections; cloud keys are Coming soon.
>
> **Build D, Guided setup (2026-10-16, branch `claude/build-guided-setup-b8a4ef`; mockup R24 with R23's AI step, R28's live words, R29's swatches):** a fresh install (no `setup_done` in config.json and no notes, tasks or sessions) opens a six-step setup: Vault, Reading, Focus, Voice, AI and Ready, with a stepper, Back / Skip / Next. Reading changes the theme and font live (nine swatches in 3 columns, the four built-in fonts, more fonts later in Settings); Focus sets the hyperfocus nudge and focus sound; Voice picks the microphone, Whisper base.en / small.en / not now, live words (on with 5 GB or more free, else off with the reason), the read-aloud voice (Windows, Kokoro or Piper) and where rambles go; AI picks how AI runs and a model that fits this PC (greyed out with the reason when it doesn't), plus keep / delete the old model and where long questions go. Nothing downloads until Ready, which lists every file with its source and size, the total and the space left; Start NeuroVault then runs the downloads in the background, with "Setup · N%" in the status bar and a dialog to watch or cancel them. Skip on a step puts back what it changed; "Skip the setup" writes the defaults. An install that's been used never gets it: Settings → Data → Run the setup again. The Vault step can only set the Obsidian daily-notes folder for now: the vault folder on disk comes later.
>
> **Build V, The vault on disk (2026-10-18, branch `claude/build-v-vault`; profile "First run starts with your vault folder"):** notes are plain .md files in a folder you choose. The setup's step 1 is the mockup's: Create a new vault (Documents\NeuroVault) or Open a folder as a vault (an Obsidian vault works: its files are read, never moved or changed); the "Daily notes in Obsidian" card is gone (it stays in Settings → Vault & files). An install with notes from before is asked once where the vault goes; the database is backed up and every note is copied out (nothing is deleted). Saving writes the file (only when it changed), renaming and moving rename and move it, deleting sends it to the Recycle Bin; notes made, changed, moved or deleted outside NeuroVault show up within a few seconds, and an outside edit NeuroVault saves over is kept as a version. Sticky Notes and Brain Dump are saved as files in the vault; attachments and fonts move into it. Settings stay in config.json on this PC.

> **Build F, End-of-day wrap-up and morning launchpad (2026-10-16, branch `claude/build-wrapup-01364b`; mockup R29 wrap1–wrap3, launch):** the window bar's sunset button, or a calm reminder at the wind-down time (Snooze while a timer runs), opens three steps. 1 Today's wins: tasks and steps ticked today, focus time and sessions; pick one or name one. 2 Tidy up, no guilt: tasks due by today, sticky notes and inbox thoughts each get Roll to tomorrow, Park in backlog or Mark done. 3 Note to tomorrow-you: up to 3 starter tasks (picked or typed), a note, and a 10-second voice memo recorded with the pill and kept as a clip. On the first open of a later day (after 04:00), the morning launchpad shows the note, the memo and the first starter task; "Launch first task and timer" starts it on the quick timer. Settings → Daily wrap-up: the reminder, the time, the snooze length and the launchpad. A `wrapups` table, shaped to become `wrapups/YYYY-MM-DD.md`; tasks and steps now record when they were ticked.

> **Build H, Stickies and the quick timer popped out of the app (2026-10-16, branch `claude/build-sticky-timer-popout-f6fa2c`; mockup R34 with R38's and R39's answers, locked):** the sticky note is now Paper (the whole note in its colour, titled by its first line, "Saved 15:42") and the quick timer is the Card (a big time and two buttons; Pause asks the 8 reasons, the check-in and the 1–5 rating open inside it). Pop out, on each sticky (first in its ⋮ menu) and on the quick timer, makes it its own small frameless window, on top of other apps, with no taskbar button. Its strip has Keep on top, Back into NeuroVault and close. It remembers its place and screen, and opens again on launch. The status bar says "1 on your desktop", with Show and Bring back. Python keeps every window in step, and the global hotkeys update the timer window too. Closing NeuroVault with something popped out keeps it in the tray if `pystray` is installed; otherwise the windows close with it, after saving. Settings: Open new stickies popped out, two editable minute sets (unplanned 5/15/25/45, planned 15/30/45/60) with Back to the defaults, and the check-in interval.

> **Build K, PDF and Word files to Markdown notes (2026-10-17, branch `claude/build-k-converter-539a83`; backend for mockup R47):** Ctrl+K → "Convert PDF to Markdown" now works: pick a PDF or .docx, it converts in the background with "Page N of M" in the status bar, and the new note opens. Headings, paragraphs, bold / italic, nested bullet and numbered lists, tables, links and pictures are kept (pictures go to attachments/ as `![[…]]`, and each table is also saved as `<note> table N.csv`; both show in the note's Attachments tab); a PDF keeps its page breaks as `---`, reads two columns in order and drops page numbers. A scanned PDF says "This PDF is a scan: no text to convert" (no OCR). Word files are read with the standard library; PDFs use pdfplumber 0.11.10 (MIT, approved; see THIRD-PARTY-NOTICES.md). New API calls: `convert_file`, `convert_job`, `convert_cancel`, `convert_status`, `attach_file`, `browse_convert_file`; new setting `drop_office_default` (ask | attach | attach_new | convert). The drop question and its Settings card are R47's.

> **Build J, Dictionary and thesaurus with your own words, and the year on Insights (2026-10-16, branch `claude/build-dictionary-heatmap-3984c1`; mockup R37, locked):** a Dictionary tab (from the rail, Ctrl+K's Define group, the word popover and "Look up" on a note's right-click menu): matches on the left, the word on the right. It searches as you type and tolerates misspellings ("You typed…"). Each word has its syllables, meanings by part of speech with examples, similar words, opposites and sound-alikes, plus recent lookups. Your own words (word, part of speech, definition, example, tags) are marked Yours, searched with the rest, and kept in `.neurovault/glossary.json` so they travel with the vault. The word popover is the full one: meaning, similar, opposite, Read aloud, Open in dictionary and Add. Read aloud reads the word only, or the word and its meanings (a setting in Settings → Voice). The data is Open English WordNet 2025 (CC BY 4.0; your choice over 2024), downloaded once after an ask (11.4 MB, size and sha256 checked) and then offline: 126,735 words in a 34 MB index on this PC. Timer → Insights shows the whole year: 53 weeks that fit the card and fold into two halves when narrow. It opens on the past 12 months, the year picker has the calendar years, and each square fills and darkens in fixed steps. A key and the year's totals sit underneath, and clicking a day opens History at that day.
>
> **Build G, Accent colours, your own colour and colour vision (2026-10-16, branch `claude/build-accents-cvd-754856`; mockup R33, locked):** Settings → Reading & comfort → Theme has 6–8 accents chosen for each theme (65 in all, Violet first; each passes 3:1 against the page and 4.5:1 for text), plus Custom… with a colour box and hex field. Your colour follows you to the other themes, shaded to stand out on each. When the accent is hard to see on the theme, one plain line says so, with one button for the nearest shade that isn't. Colour vision (Off, Red–green, Blue–yellow) changes the ready / needs-a-look / problem colours everywhere and adds a shape to each state. Reset to defaults now asks first and also resets the accent, your colour and colour vision; each card gets its own Reset (with Undo) while it differs.

> **Build I, Tasks page (2026-10-16, branch `claude/build-tasks-page-55c3b8`; mockup R35 "Today, Upcoming and Done", locked):** the board is three cards (Today, Upcoming, Done, which folds), with an Overdue card above Today. Every row lines up in fixed columns: tick, title, priority, due, the wand and ⋯. Quick add sets Due (Today, Tomorrow, Later, or a date picker), Priority and Energy as labelled choices. A ticked task stays where it is, struck through, until the view changes. The ⋯ menu changes the due date and holds Delete, which goes to a bin with Undo in the status bar; a `- [ ]` line task takes its line with it, and Undo puts it back. The energy chip keeps its click cycle and now looks like a button. One weight app-wide: a pressed segment no longer goes bold. Ctrl+K searches the text inside notes, shows the matching line and opens the note at it. New API calls: `trash_task`, `restore_task`, `search_notes`; `update_task` takes a due date.
>
> **Build E, Reading & comfort and fonts (2026-10-16, branch `claude/build-reading-fonts-592d56`; mockup R29–R32, Reset as R33's default):** Settings → Reading & comfort is five cards (Theme, Text, Spacing, Reading aids, Motion), each with its current value and a sample, and rows with a bold label, a muted line and the control on the right. Spacing is presets (Normal / Wide / Wider, Snug / Normal / Loose, Narrow / Medium / Full) with Custom for the slider. Text size sizes the note text (Small 14, Medium 15, Large 17, Larger 19px); the rest of the app stays Medium. Reset to defaults resets at once, with Undo for 10 seconds. More fonts lists 8 free OFL reading fonts with a real-face sample each (Atkinson Hyperlegible Next, Lexend Deca / Exa / Giga, Andika, Comic Neue, Inter, Literata; OpenDyslexic Mono left out: no official compiled file), downloaded from Google Fonts with size and sha256 checked; Add your own font takes a .ttf, .otf or .woff2 after checking it's a font. An added font applies to the whole app and lives in `.neurovault/fonts` (next to the database until the vault on disk exists). Every Settings segmented control keeps its options on one line. Accents and colour vision come with R33.
>
> **Converter fix (2026-10-15, branch `build/md-escapes`):** saving a note no longer adds needless backslashes inside headings and table cells, so `## 1. Personal Profile` stays as typed instead of becoming `## 1\. Personal Profile`. Markdown round trip: 545/545 tests pass. In the real "Testing 123" note, the only changes left on save are the ones kept on purpose: `~` becomes `\~`, and two-space line ends become plain line breaks.
>
> **R20 (2026-10-15):** your R19 locks are decisions (lowercase-centred path, 8px header start, split window bar); every design switch is now locked. See the R20 changelog.
>
> **R19 (2026-10-15):** the note path's text sits on Back and Forward's centre line in every font (measured per font; switch: lowercase, capitals or R18's boxes). See the R19 changelog.
>
> **R18 (2026-10-15):** your R17 locks are decisions (40px top row, fixed 28px rail, underline tabs, lean status bar, one-row Notes header, quick actions beside the toggle); the note header starts 8px from the sidebar's edge (switch: 8, 12 or 24px). See the R18 changelog.
>
> **R17 (2026-10-15):** square hover on the underline tabs; the timer pill clears the right sidebar's edge, and wrap-up, search and the toggle sit centred over the sidebar. See the R17 changelog.
>
> **R16 (2026-10-15):** three designs for Outline / Backlinks / Tags (segmented, icons like Obsidian, equal underline tabs); none goes bold or moves when you switch. See the R16 changelog.
>
> **R15 (2026-10-15):** Outline / Backlinks / Tags centred, with the Ollama hover and a pressed-button fill for the open one; the status bar drops Backlinks (n) and System ready; "Was doing" is now "Timeline". See the R15 changelog.
>
> **R14 (2026-10-15):** your annotated screenshot, as switches: no line under the sidebar headers, the Notes sidebar's actions and Search in one row, and the timer, wrap-up and search next to the right sidebar toggle. See the R14 changelog.
>
> **R13 (2026-10-15):** your pasted locks are decisions. The rail's button size (28px default) and position (centred on the top row, or fixed) are their own switches, so the top row height no longer resizes the rail. See the R13 changelog.

## Key

| Mark | Meaning |
|---|---|
| ✅ **Built** | Works in the app today |
| 🟡 **Partial** | Something close exists in the app, but it falls short of the PRD |
| 🎨 **Designed** | Drawn and clickable in the R6 mockup only, not in the app |
| ⬜ **To build** | Not in the app and not in the mockup |

## Summary

The app today is a working **notes + tasks + time tracker** (SQLite, pywebview, plain JS) with a strong timer. Most of the PRD is still to build. The neurodivergent features that set NeuroVault apart (accessibility suite, floating widgets, voice, AI, wrap-up ritual) are all ⬜.

Counts are rows in the tables below. Some rows cover several PRD features (the eight top-bar triggers are one row), so the gap is bigger than the totals suggest.

| PRD section | ✅ | 🟡 | 🎨 | ⬜ |
|---|---|---|---|---|
| 1. Stack & storage | 2 | 1 | 1 | 7 |
| 2. Window chrome & workspace | 1 | 3 | 2 | 5 |
| 3. Floating widgets | 0 | 3 | 0 | 6 |
| 4. Editor, HTML studio, PDF, proofing | 1 | 1 | 2 | 6 |
| 5. Accessibility suite | 0 | 2 | 1 | 4 |
| 6. Voice, tasks & AI | 0 | 0 | 0 | 10 |
| 7. Wrap-up & brain dump | 0 | 1 | 0 | 5 |
| 8. Architecture & data safety | 2 | 3 | 0 | 5 |
| **Total (74 rows)** | **6** | **14** | **6** | **48** |

The biggest gap is underneath the features: **notes live in SQLite, not as `.md` files in a vault folder.** The PRD's sticky notes, `_inbox.md`, `.html` files, PDF conversion, attachments, file history and backlinks all assume files on disk, so that change comes first.

---

## 1. Technical stack & storage

| PRD item | Status | Where it stands |
|---|---|---|
| pywebview desktop wrapper (WebView2) | ✅ | `main.py`: one window, 1440×920 |
| Frameless child windows (`on_top`, `easy_drag`) for widgets | ⬜ | Only the one main window exists |
| FastAPI loopback server | 🟡 | The frontend is served by pywebview's built-in bottle server, and JS calls Python through `js_api` rather than HTTP |
| WebSockets to sync state across windows | ⬜ | Needs to exist once there's more than one window |
| `sherpa-onnx` STT/TTS | ⬜ | |
| WordNet SQLite dictionary | ⬜ | |
| Docling / MarkItDown / WeasyPrint PDF pipelines | ⬜ | |
| Frontend: HTML/CSS/vanilla JS on `:root` tokens | ✅ | `style.css` and `timer.css` share one token set. Tailwind is loaded from a CDN for layout, so the app needs internet for its first paint |
| CodeMirror/Monaco for HTML editing | ⬜ | |
| **Storage: `.md`/`.html` files in a vault folder** | 🎨 | The app stores notes in SQLite (`neurovault.db`). Its only `.md` output is the Obsidian export, which appends timer sessions to daily notes (`vault.py`). The mockup's design writes notes as `.md` files with front matter and keeps a database as an index |
| `stickynoted/`, `_inbox.md`, `.neurovault/` folders | ⬜ | |

## 2. Window chrome, navigation & workspace

| PRD item | Status | Where it stands |
|---|---|---|
| App-drawn top window bar | 🎨 | Mockup R6: app-drawn bar with minimise, maximise and close (`frameless=True`). The app uses the standard Windows title bar |
| Left and right sidebar collapse icons in the top bar (left one at 15–16px) | 🟡 | The app has a sidebar collapse button and an outline/backlinks panel toggle, but both sit in the page, not in a top bar |
| Icons at 20px with 1.75px stroke | 🟡 | One icon set (Lucide) everywhere, but sizes aren't standardised to this spec |
| Top-bar triggers: ⏱ timer, 📌 sticky, 📥 inbox, 🎙 voice, ruler, `Aa`, 🌙 wrap-up, 🔍 `Ctrl+K` | ⬜ | None of the eight exist (the Timer is a full view on the left rail, not a quick trigger) |
| Multi-tab workspace (scrollable, reorderable tabs) | ⬜ | The app shows one item at a time, with back/forward history in Notes |
| Overlay layer for floating widgets | ⬜ | |
| Status bar, left: "What was I doing?" trail of the last 4 places | 🟡 | The note header shows a breadcrumb for the open note only, and Notes has back/forward. There's no cross-view trail |
| Status bar, centre: `🔗 Backlinks (X)` | ⬜ | The backlinks pane exists but is a stub: `get_backlinks` has never been written |
| Status bar, right: word count | ✅ (1 of 4) | Word count is live. Character count, reading time and model status are ⬜ |
| Zen mode (`F11`) | ⬜ | |
| Folder tree (nested folders, rename, move, drag and drop) | 🎨 | Mockup R6. The app groups notes by a free-text "category" field. This isn't in the PRD, but the PRD's "Attach to Project / Folder" relies on it |

## 3. Floating widgets

| PRD item | Status | Where it stands |
|---|---|---|
| In-app pinning above all tabs | ✅ | Phase 6A: open sticky notes and the quick timer sit on one layer above every tab |
| "Pin to Desktop" (always-on-top OS window) | ✅ | Build H: Pop out makes a sticky or the quick timer its own small frameless window on top of other apps (Keep on top can be turned off), with no taskbar button. Its place and screen are remembered |
| Sticky notes: auto-save to `stickynoted/`, draggable card, pastel headers | 🟡 | Phase 6A: draggable, resizable, five colours, saved as you type. Kept in the database until the vault on disk exists (then `stickynoted/`) |
| Sticky ⋮ menu: Promote to note, Append to note, Attach to folder, Convert to timed task | ✅ | Phase 6A: all four |
| Quick timer as a compact draggable modal | ✅ | Build H: the Card quick timer floats in the app or pops out as its own window. Its questions (the 8 pause reasons, the check-in, the 1–5 rating) open inside it. It offers its own minute set (5/15/25/45 by default, editable in Settings) |
| Timer bar changes colour teal → amber → coral | 🟡 | A countdown ring is drawn, but with one fixed gradient. It doesn't change with time left |
| Link the timer to a task or sticky note | ⬜ | Sessions link to a **project** only |
| Brown / pink noise and soft-rain soundscapes (Web Audio) | ⬜ | The app already makes its alert tones with Web Audio (`timer.js`), so the groundwork is there |
| Hyperfocus body-check nudge (every 45–60 min) | 🟡 | A check-in prompt appears every 30 min (`MILESTONE_INTERVAL_SEC`, fixed). It asks for a progress note, not a body check, and the interval can't be changed |

## 4. Editor, HTML studio, PDF & proofing

| PRD item | Status | Where it stands |
|---|---|---|
| Zone A Markdown toolbar | 🎨 | Mockup has: Text/H1–H3/Quote, bold, italic, strikethrough, inline code, bullets, numbered list, task, wiki link. The app's editor is a plain `<textarea>` with no toolbar. Still to add: H4–H6, code block with language, horizontal rule, link inserter, image picker, table grid picker and Auto-Beautify |
| Zone B HTML extensions (underline, highlight, text colour, align, sub/sup, `<details>`) and a setting to hide them | ⬜ | |
| Document / Split / Raw editing modes for `.md` | 🎨 | Mockup has Document, Split and Raw .md. The app has raw text only |
| Outline from headings | ✅ | Not in the PRD, but built (right-hand panel) |
| `.html` files: Code / Live Preview / Split | ⬜ | |
| Export to PDF (Personal Accessible and Clean Professional presets) | ⬜ | |
| PDF → Markdown (images go to `attachments/`, opens in a new tab) | ⬜ | |
| Dictionary and synonym popover (offline WordNet, optional cloud fallback) | ⬜ | |
| Spellcheck | 🟡 | WebView2's built-in spellcheck works in the textarea, but it isn't tuned for dyslexia |
| Homophone guard (blue dotted underline with a usage hint) | ⬜ | |

## 5. Sensory & accessibility suite

| PRD item | Status | Where it stands |
|---|---|---|
| Settings on `:root` custom properties | 🟡 | Colours are tokens and the theme switches instantly. Fonts, spacing and line width are hard-coded |
| Font choice: OpenDyslexic (default), Lexend, Atkinson Hyperlegible, System | 🎨 | The mockup embeds all three and has locked OpenDyslexic as the font. Offering Lexend and Atkinson as a reader setting is an open question in the mockup; the PRD answers it with yes. The app uses IBM Plex Sans with no choice |
| Irlen pastel themes (Cream, Sage, Sky, Buttercup, Soft Slate dark `#1E2024`) | 🟡 | The app has Dark, Light and System only. The mockup locked "Obsidian dark" plus violet, and set aside Paper, Sepia and High contrast. None of the five PRD pastels exist yet |
| Sliders for letter spacing, word spacing, line height and max width | ⬜ | |
| Reading ruler (line mask) | ⬜ | |
| Bionic reading toggle | ⬜ | |
| Reduced motion | ⬜ | Not a setting. `prefers-reduced-motion` isn't respected either |

## 6. Voice, tasks & AI

| PRD item | Status | Where it stands |
|---|---|---|
| Voice rambler: record, offline transcription | ⬜ | |
| Side-by-side check (raw transcript vs. cleaned note, Enter to accept) | ⬜ | |
| Entity anchors (green when matched, amber with `+ Insert` when missed) | ⬜ | |
| Read aloud with karaoke highlighting, speed and voice controls | ⬜ | |
| 🪄 Magic task splitter (3–5 timed sub-steps) | ⬜ | Tasks can't have sub-tasks yet (no `parent_id` in `tasks`) |
| Energy badges on tasks (⚡ / 🌤 / 🔋) and a filter | ⬜ | Tasks have priority (Low → Critical), due date, project and tags. Energy is recorded only on timer sessions, after they finish |
| `Ctrl+K` palette: notes, HTML and tasks; shortcut tutor; app commands; settings links | ⬜ | Four parts. The app has a sidebar filter over title, category, description and tags, but it doesn't search note content |
| AI providers (Ollama, LM Studio, ONNX, OpenAI/Anthropic/Gemini/OpenRouter) | ⬜ | No AI code yet ("Phase 3" in ARCHITECTURE.md) |
| Smart auto-router and a per-task model table | ⬜ | |
| API keys in Windows Credential Manager (`keyring`) | ⬜ | |

## 7. Daily wrap-up & brain dump

| PRD item | Status | Where it stands |
|---|---|---|
| Wrap-up time in Settings, 🌙 button, Snooze 15m | ✅ | Build F: the window bar's sunset button; Settings → Daily wrap-up (on/off, the time, snooze 10/15/30, the launchpad); Snooze while a timer runs; closing the reminder means not again today |
| Step 1: "dopamine receipt" (tasks done, focus time, notes edited) | ✅ | Build F: tasks done, steps ticked, focus time and sessions (tasks and steps now record when they were ticked); pick a win or name one. Notes edited isn't counted |
| Step 2: no-guilt triage (Roll over, Park, Done) | ✅ | Build F: tasks due by today, sticky notes and inbox thoughts. Roll = due tomorrow; Park = no due date (the backlog); a parked inbox thought becomes a backlog task |
| Step 3: note to tomorrow-me (1–3 starter tasks, voice memo) | ✅ | Build F: up to 3 starters (picked or typed), a note, a 10-second memo with Build A's recorder and clip player |
| Morning launchpad card with `▶ Launch first task & timer` | ✅ | Build F: once, on the first open of a later day (after 04:00); the note, the memo and the first starter; Launch starts it on the quick timer (the timer backend's running session) |
| Brain dump: `Ctrl+Shift+D` adds to `_inbox.md` with a timestamp | 🟡 | Phase 6A: the capture bar adds time-stamped thoughts to the inbox table (`_inbox.md` with the vault on disk). Ctrl+Shift+D works in the window, and globally once the optional `keyboard` package is installed |

## 8. Architecture & data safety

| PRD item | Status | Where it stands |
|---|---|---|
| First-run vault picker (create or open a folder) | ⬜ | Settings has a folder path for the Obsidian export only |
| Settings in `.neurovault/config.json` inside the vault | 🟡 | Settings live in `config.json` next to the app, not in the vault |
| Pasted images saved to `attachments/paste-….png` | ⬜ | |
| Last 5 versions in `.neurovault/history/` with Restore | ⬜ | A running timer session is also lost if the app closes (it's written only on Stop) |
| Global OS hotkeys | ✅ | `Ctrl+Alt+P/S/H` for the timer, through the optional `keyboard` package (not installed by default) |
| Minimise to the system tray when a timer is running | 🟡 | The running session lives in the database, so closing never loses it. Build H: closing with a sticky or the timer popped out keeps NeuroVault in the tray (optional `pystray` package, installed 2026-10-16). Without it, they close with it after saving |
| PyInstaller build | ⬜ | No `.spec` file yet |
| `sys._MEIPASS` resource helper | ✅ | `utils.resource_path()` |
| Assets and models load from the bundle; user files go to the vault | 🟡 | Paths are anchored correctly (`utils.app_dir()`), but there's no vault and no bundled models yet |
| `window.events.closed` cleanup | 🟡 | Closes the database only. Nothing to stop yet: no widget windows or background threads |

---

## Where the PRD and current design disagree

### Decided (2026-10-15)

1. **Themes: more is better.** Keep the mockup's *Obsidian dark + violet* and add the PRD's five Irlen themes (Warm Cream Paper, Soft Sage Green, Muted Sky Blue, Pale Buttercup Yellow, Soft Slate dark `#1E2024`). The mockup's set-aside Paper, Sepia and High contrast themes can come back too. Every theme is one block of `:root` tokens.
2. **Icons: wireframe only, no emoji.** The emoji in the PRD (⏱ 📌 📥 🎙 🌙 🪄 ⚡ 🔋) are just labels. Every icon uses the current outline style (Lucide), for example `timer`, `pin`, `inbox`, `mic`, `moon`, `wand-sparkles`, `zap`, `battery-low`.
3. **Branches, Timeline and Knowledge graph stay.** They are part of NeuroVault alongside the PRD's features, even though the PRD doesn't mention them.
4. **Tabs, like Obsidian.** Notes, `.html` files, tasks, the Timer, Branches, Timeline, Graph and Settings all open as tabs in one tab strip. Tabs can be scrolled, reordered and closed. Proposed detail, to confirm in the mockup: the left rail stays as Obsidian's ribbon does, and opens or switches to a view's tab.

### Still open

1. **Notes storage:** SQLite rows (app today) vs. `.md` files in a vault (PRD and mockup). Moving to files is the biggest job and unblocks most of §3, §4, §7 and §8.
2. **Bridge:** pywebview `js_api` + bottle (today) vs. FastAPI + WebSockets (PRD). The PRD's reasons are sound: microphone permission on a stable origin, and syncing widget windows. Moving over is a contained change in `main.py` and `api.py`.
3. **Timer link:** sessions belong to a **project** today. The PRD links the timer to a **task or sticky note**. Probably both: a task already has a project.

## Suggested build order

1. **Vault foundation:** first-run vault picker, notes as `.md` files with the database as an index, `.neurovault/config.json`, folder tree (already designed), file history, image paste.
2. **Shell:** app-drawn top bar (designed), Obsidian-style tabs for every view, the overlay layer, status bar telemetry, `Ctrl+K` palette, Zen mode.
3. **Accessibility suite:** fonts, the five pastel themes alongside Obsidian dark, typography sliders, reading ruler, bionic reading, reduced motion. Mostly CSS tokens, so quick wins with a big effect.
4. **Editor:** Zone A and Zone B toolbars, Document/Split/Raw modes (designed), backlinks, HTML studio.
5. **Executive-function tools:** quick timer modal (reusing `timer.js`), sticky notes, `_inbox.md` brain dump, energy badges, tray mode, saving a running session as it goes, wrap-up ritual and morning launchpad.
6. **Offline language tools:** WordNet popover, homophone guard, PDF ⇄ Markdown.
7. **AI & voice:** model router and `keyring`, magic task splitter, voice rambler with entity checks, karaoke read-aloud.
8. **Packaging:** FastAPI loopback, desktop pinning windows, PyInstaller build.
