# Product Requirements Document (PRD): NeuroVault — Accessibility-First Local Workspace & Design Studio

## 1. Product Vision & Overview
**Product Summary:** A lightweight, local-first desktop knowledge vault, task manager, focus timer, and HTML/PDF studio built specifically for neurodivergent users (ADHD, Dyslexia, Irlen Syndrome, and Executive Dysfunction).  
**Core Philosophy:** Combine the local file ownership of Obsidian (`.md` vault), the beginner-friendly formatting of MS Word, the executive-function tooling of Goblin.tools/Tiimo, a live HTML/CSS prototyping sandbox, and local AI voice tools (STT/TTS) into a single, cohesive desktop application without requiring community plugins or cloud subscriptions.

### Technical Stack & Packaging Constraints
* **Desktop Wrapper:** `pywebview` (Edge WebView2 on Windows). Supports spawning frameless child windows with `on_top=True` and `easy_drag=True` for OS-level desktop widgets.
* **Backend:** Python (FastAPI loopback server + local WebSockets for real-time state sync across windows; `sherpa-onnx` for lightweight offline STT/TTS; SQLite/JSON for offline WordNet dictionary & thesaurus; `Docling`/`MarkItDown` & `WeasyPrint` for PDF pipelines).
* **Frontend:** HTML5, CSS3 (heavily utilising CSS Custom Properties `:root` for instant accessibility overrides), Vanilla JS / lightweight reactive state, and embedded CodeMirror/Monaco for HTML editing.
* **Storage:** Plain-text Markdown (`.md`) and `.html` files on disk, with a dedicated `stickynoted/` subfolder for floating scratchpad notes, `_inbox.md` for rapid brain dumps, and `.neurovault/` for portable config and rolling file history.

---

## 2. Global Window Chrome, Navigation & Workspace Layout

### 2.1 Unified Top Window Title Bar
* **Sidebar Collapse Controls:** Both the **Left Sidebar Collapse** icon and the **Right Sidebar Collapse** icon reside in the top window bar (relocating the right collapse toggle from the main body into the top bar).
* **Icon Sizing Hierarchy:** Standardise all top-bar and toolbar icons to a uniform bounding box (`20px × 20px`, `1.75px` stroke), with one intentional exception: the **Left Sidebar Collapse icon** must be slightly smaller (`15px × 15px` or `16px × 16px`) to establish visual hierarchy.
* **Global Quick-Action Triggers (Top Bar Right):**
  * **Quick Timer Icon (`⏱`):** Launches/toggles the Floating Quick Timer modal from anywhere in the app.
  * **New Sticky Note Icon (`📌`):** Spawns or toggles a floating Sticky Note modal.
  * **Brain Dump Inbox Icon (`📥`):** Opens the zero-friction `_inbox.md` rapid capture input.
  * **Voice Rambler Mic Icon (`🎙`):** Opens the Entity-Verified Voice Dictation modal.
  * **Reading Ruler Toggle:** Toggles the horizontal dyslexia line-focus overlay.
  * **Sensory Comfort Popover (`Aa`):** Opens rapid adjustments for fonts, Irlen pastel themes, and spacing sliders.
  * **Daily Wrap-Up Trigger (`🌙`):** Manually triggers the End-of-Day Shutdown Ritual modal.
  * **Command Palette Trigger (`🔍` / `Ctrl + K`):** Opens the fuzzy Omni-Search and Shortcut Tutor modal.

### 2.2 Multi-Tab Workspace
* **Obsidian-Style Tab Bar:** Horizontal scrollable and reorderable tab strip supporting multiple open `.md` notes, `.html` live review tabs, task views, and settings tabs simultaneously.
* **Persistent Widget Overlay Layer:** Floating Sticky Notes and the Quick Timer exist in a high `z-index` overlay container above the tab viewport so switching tabs never hides pinned notes or active timers.

### 2.3 Bottom Status Bar & Breadcrumb Trail
* **Left Zone — "What Was I Doing?" Breadcrumb Trail:** Displays the last 4 navigation actions (e.g., `Spec.md > Sticky #2 > UI-Mockup.html > Timer`) as clickable pills to combat ADHD working-memory drops when switching tabs.
* **Centre Zone — Automatic Backlinks Counter:** Lightweight regex scanner displays `🔗 Backlinks (X)` whenever other notes in the vault mention the active note's title.
* **Right Zone — Live Writing Telemetry:** Real-time **Word Count**, **Character Count**, **Estimated Reading Time**, and an active **Offline/Online Model Status Indicator**.

### 2.4 "One-Thing" Zen Mode (`F11`)
* Single shortcut or button that collapses both sidebars, hides the tab strip, and dims the formatting ribbon—leaving only the active paragraph and a minimal countdown pill visible.

---

## 3. Floating Widgets Engine (In-App & OS Desktop Pinning)

Both widgets support **Dual-Level Pinning**:
1. **In-App Pin:** Floats above all workspace tabs via fixed positioning inside the main window.
2. **OS Desktop Pin ("Pin to Desktop"):** Triggers `pywebview.create_window(..., frameless=True, on_top=True, easy_drag=True)` to detach the widget into a tiny Always-on-Top Windows desktop utility that floats over browsers, spreadsheets, and other software.

### 3.1 Floating Sticky Notes (`stickynoted/`)
* **Auto-Persistence:** Every sticky note auto-saves immediately inside the vault's `stickynoted/` directory so no scratchpad data is ever lost.
* **Card UI:** Compact, draggable, resizable modal with selectable pastel colour headers.
* **3-Dot Triage & Promotion Menu (`⋮`):**
  * *Promote to Full Note:* Converts the sticky note into a standard `.md` file and opens it in a new workspace tab.
  * *Append to Existing Note:* Opens a quick fuzzy picker to append the sticky note contents to an existing `.md` file.
  * *Attach to Project / Folder:* Moves the note into an existing project/folder or creates a new folder inline.
  * *Convert to Timed Task:* Extracts the text into a task item with an immediate time estimate and links it directly to the Quick Timer.

### 3.2 Global Quick Timer, Acoustic Shield & Hyperfocus Guard
* **Compact Draggable Modal:** Accessible globally from the top bar clock icon.
* **Visual Time-Blindness Progress Bar:** Alongside digital numbers (`24:15`), displays a prominent shrinking bar or ring that smoothly transitions colour from **Calm Teal (100%–50%) -> Warm Amber (50%–20%) -> Soft Coral (under 20%)** to visually communicate time passing.
* **Task Linking:** Dropdown to attach the running timer to an active task or sticky note.
* **Built-In Procedural Soundscape (Web Audio API):** Toggle buttons inside the timer modal for **Brown Noise**, **Pink Noise**, and **Soft Rain** (generated mathematically via Web Audio API with `0 MB` of external audio file bloat), plus a volume slider.
* **Hyperfocus Body-Check Nudge:** Optional interval alert (every 45–60 mins of continuous activity) that displays a gentle, non-blocking toast: *"You've been locked in for an hour—time to blink, drop your shoulders, and grab water?"*

---

## 4. Two-Tier Accessible Editor, HTML Studio & Document Lifecycle

### 4.1 The Two-Tier Formatting Ribbon
To make `.md` editing effortless for beginners while supporting rich text styling, the top editor toolbar is visually divided into two distinct zones separated by a vertical divider:

* **Zone A — Pure Markdown Controls (Standard Neutral Icons):**
  * Heading level dropdown (`H1`–`H6`), Bold (`**`), Italic (`*`), Strikethrough (`~~`), Blockquote (`>`), Bullet List, Numbered List, Interactive Task Checkbox (`- [ ]`), Code Block (with language dropdown), Horizontal Rule, Link Inserter, Image/Attachment Picker, and a **Visual Table Grid Picker** (MS Word-style hover grid + **"Auto-Beautify Table"** button with zebra-striped rows).
* **Zone B — HTML Rich-Text Extensions (Subtle Accent Border + `<HTML>` Badge):**
  * Inserts clean inline HTML tags for features native Markdown lacks. Includes a toggle in Settings to hide Zone B for strict Markdown purists.
  * Controls: **Underline** (`<u>`), **Multi-Colour Highlight Palette** (`<mark style="...">`), **Text Colour Picker**, **Text Alignment** (Left, Centre, Right via `<div align="...">`), **Subscript / Superscript**, and **Collapsible Accordion Fold** (`<details><summary>`).

### 4.2 Native HTML View & Edit Mode (UI/UX Prototyping Studio)
* When opening or creating an `.html` file in the vault, the tab header presents a 3-way segmented mode switcher:
  1. **`[Code View]`:** Syntax-highlighted HTML/CSS/JS editor (CodeMirror / Monaco) with tag auto-completion and auto-formatting.
  2. **`[Live Preview]`:** Sandboxed interactive rendering of the HTML mockup inside the tab viewport.
  3. **`[Split Screen]`:** Side-by-side raw HTML/CSS code on the left and live rendered UI preview on the right for real-time UI/UX review.

### 4.3 Bidirectional PDF ⇄ Markdown Conversion Engine
* **Markdown (`.md`) to PDF Exporter:**
  * 1-click export modal offering two styling presets:
    * *Personal Accessible Preset:* Preserves the user's active Irlen Pastel Theme, `OpenDyslexic`/`Lexend` font, and spacing settings.
    * *Clean Professional Preset:* Formats the document with standard white paper, clean typography, and formatted tables for external sharing.
* **PDF to Markdown (`.md`) Extractor:**
  * Drag-and-drop or right-click any `.pdf` file in the vault to run local extraction (powered by `Docling` / `MarkItDown`).
  * Automatically extracts body text, reconstructs Markdown tables, preserves links/headings, saves embedded images into the vault's `attachments/` folder, and opens the resulting `.md` note in a new tab.

### 4.4 Offline Dictionary, Thesaurus & Proofing Suite
* **Highlight Context Popover:** Selecting or right-clicking any word presents a floating card with:
  * **Definition & Part of Speech:** Powered by a bundled offline WordNet SQLite/JSON database (~16 MB), with an optional cloud API fallback toggle for slang or technical terms.
  * **One-Click Synonym Swapper:** Displays clickable synonym pills; clicking a synonym immediately replaces the highlighted word in the editor.
* **Dyslexia-Tuned Spellcheck & Homophone Guard:**
  * Standard red squiggly underline for spelling errors.
  * **Dotted Blue Underline for Confusable Homophones:** Flags commonly swapped words (`their/there/they're`, `affect/effect`, `quiet/quite`) with a hover tooltip showing a plain-English usage hint.

---

## 5. Sensory, Dyslexia & ADHD Accessibility Suite

All visual settings map directly to root CSS Custom Properties (`:root`) for zero-latency live previewing:

* **Accessible Font Selector:**
  * `OpenDyslexic` (Default option)
  * `Lexend` (Engineered for reading fluency)
  * `Atkinson Hyperlegible` (High-clarity character differentiation for low vision)
  * `System Sans / Monospace`
* **Irlen Syndrome & Visual Stress Pastel Themes:**
  * Avoids harsh `#FFFFFF` on `#000000` contrast that causes letters to "swim".
  * Presets: **Warm Cream Paper**, **Soft Sage Green**, **Muted Sky Blue**, **Pale Buttercup Yellow**, and **Soft Slate Dark Mode** (low-glare dark grey `#1E2024` with warm off-white text).
* **Granular Typography Sliders:**
  * `--editor-letter-spacing`: `0em` to `0.15em`
  * `--editor-word-spacing`: `0em` to `0.30em`
  * `--editor-line-height`: `1.4` to `2.2`
  * `--editor-max-width`: `55ch` to `90ch` (locks line width to prevent eye-tracking fatigue).
* **Interactive Reading Ruler (Line Mask):**
  * Toggleable horizontal focus strip that tracks the cursor `Y` coordinate (or touch/arrow keys), keeping 1–3 lines at 100% brightness while dimming the surrounding viewport.
* **Bionic Reading / Saccadic Bold Toggle:**
  * Reading-mode toggle that bolds the initial letters of words to create artificial fixation points for ADHD readers.
* **Reduced Motion Mode:** Global toggle that disables all UI slide/fade animations.

---

## 6. Voice Suite, Tasks & Hybrid AI Architecture

### 6.1 Entity-Verified Voice Rambler (Local STT + AI Cleanup)
* **Workflow:** User records a free-form voice ramble (transcribed offline via `sherpa-onnx` Whisper).
* **Side-by-Side Verification Modal:**
  * **Left Pane:** Original Raw Transcript.
  * **Right Pane:** AI-Cleaned Structured Note & Extracted Tasks (pre-selected by default so pressing `Enter` immediately accepts and inserts it).
* **Automatic Keyword & Entity Anchor Highlighting:**
  * Extracts critical anchors from the raw transcript: **Numbers/Currencies**, **Dates/Times**, **Proper Nouns**, and **Action Deadlines**.
  * **Matched Anchors (Soft Green Pill):** Highlighted in *both* Left and Right panes simultaneously so the user can visually verify accuracy at a glance. Hovering over a keyword in one pane pulses its counterpart in the other.
  * **Omitted Anchors (High-Contrast Amber Warning Pill):** If an anchor exists in the original transcript (e.g., `£450` or `Friday`) but was accidentally omitted by the AI, it glows Amber in the Left Pane with a one-click `+ Insert` button so no detail is ever lost.

### 6.2 Karaoke Read-Aloud (Local TTS)
* Powered offline by `sherpa-onnx` (Piper / Kokoro TTS).
* Includes floating playback controls (Play/Pause, Speed `0.75x`–`2.0x`, Voice selector).
* **Dual-Sensory Karaoke Highlighting:** Highlights the currently spoken sentence in a soft tint and bolds/highlights the active word in real time inside the editor.

### 6.3 The "Magic Task Splitter" (`🪄` Button) & Energy Tagging
* **Magic Task Splitter (`🪄`):** Every task item in the Task View or inside a note (`- [ ]`) includes a `🪄 Break Down` icon. Clicking it uses the configured LLM to split an overwhelming task into 3–5 micro-steps with estimated durations (e.g., `3m`, `5m`) as nested sub-tasks.
* **Cognitive Energy Badges:** Tasks can be tagged as **`⚡ High Focus`**, **`🌤 Medium`**, or **`🔋 Low Battery`**. Users can filter their task sidebar by `🔋 Low Battery` when fatigued to knock out easy wins.

### 6.4 `Ctrl + K` Omni-Search & Command Palette
* Fast, offline fuzzy search modal (no heavy AI embedding model required) searching across four categories simultaneously:
  1. **Notes, HTML & Tasks:** Instant title and content matches.
  2. **Shortcut Tutor:** Typing `"bold"` or `"zen"` displays the action alongside its keyboard shortcut badge (`Ctrl + B`, `F11`)—clicking executes it immediately while teaching the user the shortcut.
  3. **App Commands:** e.g., `> Pin Timer to Desktop`, `> Convert PDF to Markdown`, `> Wrap Up Day`.
  4. **Settings Deep-Links:** e.g., `> Configure Local Ollama API`.

### 6.5 Hybrid AI & Model Router Settings Page
* **Local-First Out of the Box:** Supports 100% free local inference via **Ollama**, **LM Studio**, and bundled **ONNX** models (`sherpa-onnx`), alongside optional Cloud API keys (OpenAI, Anthropic, Gemini, OpenRouter).
* **Routing Mode Selector:**
  * **Smart Auto-Router (Toggle):** Automatically routes lightweight/frequent tasks (ramble cleanup, task splitting) or offline sessions to local models, and complex reasoning to cloud APIs when online.
  * **Manual Task Assignment Matrix:** Explicit dropdown selectors allowing the user to assign specific models to:
    1. *Voice Ramble Restructuring*
    2. *Magic Task Breakdown (`🪄`)*
    3. *Note Summarisation & Q&A*
    4. *Offline Fallback Model*

---

## 7. Daily Wrap-Up Ritual, Next-Session Bridge & Brain Dump Inbox

### 7.1 Scheduled "Daily Wrap-Up & Next-Session Bridge" (Shutdown Ritual)
* **Trigger Mechanism:** User configures a preferred daily wind-down time in Settings (e.g., `17:00`), alongside a manual **`🌙 Wrap Up Day`** button in the top bar. Includes a **"Snooze 15m"** button if a focus timer is running.
* **3-Step Guided Wrap-Up Modal:**
  1. **Today's Dopamine Receipt (Wins Summary):** Automatically aggregates and displays tasks completed today, total focus time logged (`⏱ 2h 15m`), and notes created/edited so the user ends the day with visible accomplishment.
  2. **Guilt-Free Task, Inbox & Sticky Triage:** Lists any unfinished tasks from today, unfiled `stickynoted/` notes, and `_inbox.md` brain dumps. Never uses red "Overdue" badges. Provides rapid 1-click triage buttons: **`➔ Roll to Next Session`**, **`📥 Park in Backlog`**, or **`✓ Mark Done`**.
  3. **Next-Session Context Bridge ("Note to Tomorrow-Me"):** User selects 1–3 priority starter tasks for their next session and can type or record a 10-second voice memo (*"Where I left off & what to do first"*).
* **Next-Session Launchpad (Morning Greeting Card):**
  * When the app is next opened, presents a calm summary card showing the "Note to Tomorrow-Me", the pre-selected starter task, and a 1-click **`▶ Launch First Task & Timer`** button to eliminate morning cold-start paralysis.

### 7.2 Zero-Friction "Brain Dump" Inbox (`_inbox.md`)
* Global shortcut (`Ctrl + Shift + D`) or top-bar button opens a minimalist capture bar that appends raw thoughts directly into `_inbox.md` with a timestamp—requiring zero folder selection or naming decisions while in the middle of deep work.

---

## 8. System Architecture, Data Safety & PyInstaller Guardrails

* **Vault Onboarding & Portable Config:** First-run screen allows creating or opening a vault folder. Stores app settings inside `.neurovault/config.json` for portable sync across drives, while keeping sensitive API keys strictly in the OS **Windows Credential Manager (`keyring`)**.
* **Clipboard Screenshot Handler (`Ctrl + V`):** Pasting an image into the editor intercepts the binary image, saves it cleanly into `attachments/paste-YYYYMMDD-HHMMSS.png`, and inserts a resizable image tag rather than bloating `.md` files with raw `base64` strings.
* **Rolling Local Snapshots (Anti-Data-Loss):** Background auto-save retains the last 5 timestamped versions of edited files inside `.neurovault/history/` with a 1-click **"Restore Previous Version"** option.
* **Global OS Hotkeys & System Tray Protection:** System-wide shortcuts work even when the main window is minimised. Closing the main window while a timer is running minimises to the Windows System Tray rather than terminating the active timer.
* **PyInstaller & WebView2 Packaging Rules:**
  * Serve the frontend via a local FastAPI loopback port (`http://127.0.0.1:port`) so WebView2 grants persistent microphone permissions and resolves relative font/asset paths reliably.
  * Route read-only bundled assets (`wordnet.sqlite`, `.onnx` models, `.woff2` fonts) through a `sys._MEIPASS` resource path helper, while ensuring user vault files write strictly to the user's external vault directory.
  * Bind an explicit `window.events.closed` cleanup handler to close all detached `on_top=True` widget windows and terminate background threads cleanly so the `.exe` never leaves locked `.dll` processes in the background.

---

## 9. UI/UX Prompt Instructions for Claude

When generating or merging this PRD into the application UI/UX, adhere to the following design rules:
1. Maintain a **calm, low-cognitive-load aesthetic** suitable for ADHD and dyslexic users (generous whitespace, clear visual hierarchy, distinct active tab states, tactile button states, and zero visual clutter).
2. Ensure the **Top Window Bar** includes both the Left Collapse icon (intentionally smaller, `15px–16px`) and Right Collapse icon (`20px`), plus the global triggers for Quick Timer, Sticky Note, Brain Dump Inbox, Voice Rambler, Reading Ruler, `Aa` Sensory Comfort popover, Daily Wrap-Up (`🌙`), and `Ctrl + K`.
3. Visually distinguish **Zone A (Pure Markdown)** and **Zone B (HTML `< >` Extensions)** in the editor formatting toolbar, and include the **`[Code View] | [Live Preview] | [Split Screen]`** toggle when `.html` files are active.
4. Keep all colours, fonts, and spacing hooked to `:root` CSS Custom Properties so the Irlen Pastel Themes and Typography Sliders update the entire interface instantaneously.
