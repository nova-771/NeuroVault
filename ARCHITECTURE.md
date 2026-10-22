# NeuroVault — Architecture & Features

_Last updated: 2026-10-15 (renamed to NeuroVault; product direction now lives in [PRD.md](PRD.md), with progress in [PRD-STATUS.md](PRD-STATUS.md))_

## What this is

A single-window Windows desktop app (Python + [pywebview](https://pywebview.flowrl.com/)) that combines:
- **Notes & Tasks** — a personal knowledge base with Projects, Notes, and Tasks (tags, filtering, markdown-lite editing).
- **Timer** — session-based time tracking (planned countdown or stopwatch), with pause tracking, milestone check-ins, energy/focus ratings, analytics, and optional Obsidian vault export.

Formerly named **KnowledgeOS** (renamed to NeuroVault on 2026-10-15; the database file moved from `knowledge_os.db` to `neurovault.db` automatically on first launch). It started as two separate apps (`KnowledgeOS` and `time-tracker`) and was merged into one app with one shared database.

## Tech stack

- **Backend**: Python 3, `pywebview` (renders a WebView2/Chromium window on Windows), `sqlite3` (stdlib, no ORM).
- **Frontend**: plain HTML/CSS/JS — no framework, no build step, nothing loaded from the internet. Extracted from the R20 design mockup (`design/vault-notes-mockups.html`); see `design/build-list-R20.md` for the build phases.
- **Icons**: the app's own wireframe icons (`frontend/js/icons.js`, drawn in the Lucide outline style). Fonts (OpenDyslexic, Lexend, Atkinson Hyperlegible) are bundled in `frontend/fonts/`.
- **Bridge**: pywebview exposes a Python object (`NeuroVaultApi`) to the frontend as `window.pywebview.api.*`; the frontend calls it like an async local API. A small `bottle` HTTP server (bundled with pywebview) serves the static frontend files from `frontend/`.

## Process / file layout

```
NeuroVault/
  main.py              # entry point — creates the pywebview window, wires shutdown, optional hotkeys
  api.py               # NeuroVaultApi — everything the frontend can call (window.pywebview.api.*)
  db.py                # sqlite schema + all queries, behind a single locked connection
  config.py            # config.json load/save (theme, vault path, notification prefs, hotkeys)
  vault.py             # writes daily Obsidian markdown notes for logged sessions
  winflash.py          # best-effort Windows taskbar-flash notification (ctypes, no pywin32)
  winframe.py          # frameless window: hands bar drags and edge resizes to Windows (move, snap, resize)
  utils.py             # app_dir() / resource_path() — path helpers, frozen-exe aware
  test_api.py          # headless backend test suite (bypasses pywebview, hits NeuroVaultApi directly)
  migrate_time_tracker.py   # one-off script that folded the old time-tracker DB into this one
  requirements.txt
  config.json          # generated on first run; per-machine settings (vault path, theme, etc.)
  neurovault.db       # the single sqlite database
  frontend/            # plain files loaded in order, no build step
    index.html         # the window frame, resize edges and the script list
    css/tokens.css     # type / spacing / radius / control scales, the nine themes, accents, colour slots, @font-face
    css/app.css        # shell, components and views
    fonts/             # OpenDyslexic, Lexend, Atkinson Hyperlegible
    js/icons.js        # wireframe icons
    js/store.js        # reader settings (config.json), view state, app state; Phase 1 runs on the mockup's sample vault
    js/render-*.js     # shell, notes, tasks, timer, views (timeline, graph), settings, widgets
    js/actions.js      # every click, key and drag; boot
    js/check.js        # dev-only layout and contrast sweep (?check=1)
```

Everything runs as **one Python process, one window, one database** — there is no separate frontend build/server step; `main.py` starts pywebview, which in turn spins up a local bottle server just to serve the `frontend/` files to the embedded browser view.

## Data model (`db.py`)

One SQLite database (`neurovault.db`), single connection, `WAL` journal mode, guarded by a `threading.RLock` (pywebview's JS-bridge calls and the asset-serving thread can both touch it).

```
projects (id, name, description, color, icon, archived, created_at, updated_at)
notes    (id, title, content, category, project_id → projects, created_at, updated_at)
tasks    (id, title, description, completed, priority, due_date, project_id → projects, created_at, updated_at)
tags     (id, name unique)
note_tags / task_tags   — many-to-many join tables

sessions   (id, project_id → projects, start_time, end_time, target_seconds, actual_seconds,
            overtime_seconds, energy, focus, is_unplanned, created_at)
pauses     (id, session_id → sessions, category, start_time, end_time, duration_seconds)
milestones (id, session_id → sessions, note, at_time, elapsed_seconds)
```

**Key design point**: a `project` doubles as a time-tracking category. There's no separate "categories" table — any Project can have Notes, Tasks, *and* time Sessions logged against it. Deleting a Project sets `project_id` to `NULL` on anything that referenced it (notes, tasks, sessions) rather than deleting that data.

## Backend API surface (`api.py`)

Exposed to JS as `window.pywebview.api.<method>(...)`. Every method is wrapped so bad input or an unexpected error returns a normal value (`{"status": "error", "message": ...}` or an empty list/dict) instead of raising across the JS bridge.

- **Projects**: `list_projects`, `create_project`, `set_project_archived`, `delete_project`
- **Notes**: `list_notes`, `get_note`, `save_note`, `delete_note`
- **Tasks**: `list_tasks`, `get_task`, `save_task`, `toggle_task`, `delete_task`
- **Timer / sessions**: `log_session`, `get_recent_sessions`, `get_project_time_stats`, `export_csv`, `get_dashboard_data`, `get_insights`
- **Settings**: `get_settings`, `save_settings`, `browse_vault_folder`, `browse_sound_file`, `test_vault_connection`
- **Notifications**: `flash_taskbar`
- **Window** (the app draws its own window bar): `window_minimize`, `window_toggle_maximize`, `window_is_maximized`, `window_close`, `window_start_drag` (move or resize, handed to Windows)
- **Lifecycle**: `shutdown` (closes the DB connection on window close)

## Frontend architecture

The new front end (build Phase 1, from the R20 mockup) is a frameless window like Obsidian: an app-drawn window bar with tabs for every open note or view, a rail (Notes, Tasks, Timer, Branches, Timeline, Graph; light/dark; Settings as a dialog), a left sidebar (folder tree beside notes), a right sidebar (Outline / Backlinks / Tags), and a status bar. State lives in plain objects (`READER`, `UI`, `S`, `T`, `D` in `store.js` and `render-timer.js`); every change calls `renderAll()`, which rebuilds `#app`'s `innerHTML`. Phase 1 runs on the mockup's sample data; Phases 2–5 swap in the backend (`design/build-list-R20.md`). Features not built yet are drawn in their final places, dimmed, with a "Coming soon" tooltip.

The feature notes below describe the old front end (on `main`) and the backend it used.

### Feature highlights

- **Notes**: projects, free-text category (folder grouping), comma-separated tags, live word count, markdown heading outline, note history (back/forward navigation).
- **Tasks**: priority levels (Low/Medium/High/Critical), due dates, tags, project assignment, completed/open grouping.
- **Timer — Log session**: Planned mode (pick a project + duration, countdown ring, overtime handling) or Stopwatch mode (count up, tagged "unplanned"). Pause with a reason (8 preset categories), milestone check-ins every 30 minutes, post-session energy/focus rating (1–5, skippable).
- **Timer — Insights**: 12-week activity heatmap, all-time breakdown by project, time-estimation accuracy (planned vs. actual vs. overtime) per project, pause analytics (most common pause reason, average lost time/day).
- **Timer — History**: every session ever logged, grouped by day.
- **Timer — Categories**: lists projects with session counts/totals; inline "+ Add" (creates a Project); delete blocked client-side if the project has logged sessions.
- **Settings**: Obsidian vault path (+ connection test), notification preferences (5-min warning, completion sound with 6 built-in synthesized tones or a custom file, desktop notification, taskbar flash, overtime repeat + interval, volume), one-click CSV export of all sessions, Dark/Light/System theme (applies to the whole app, not just Timer).
- **Obsidian export**: if a vault path is set, every logged session also appends a row to that day's `YYYY-MM-DD.md` note (one file per day, a markdown table, milestone notes as bullets under the row). Independent of SQLite — a vault write failure never loses the session, it just surfaces a toast.
- **Optional global hotkeys** (needs `pip install keyboard`, not installed by default): Ctrl+Alt+P pause/resume, Ctrl+Alt+S stop & log, Ctrl+Alt+H bring window to front. The app runs fine without this package.

## Design system

- Nine themes (Obsidian dark by default, Soft Slate, the four Irlen pastels, Paper, Sepia, High contrast; no "System"), three accents, four fonts and three text sizes, all reader settings saved in `config.json` and applied as `body[data-theme|data-dark|data-accent|data-font|data-textsize]`. Every colour is a token in `css/tokens.css`.
- One icon family throughout (outline/wireframe, 18px in every icon button) — no emoji, no filled icons, no mixed icon sets.
- Flat, minimal aesthetic — no glassmorphism/blur effects (an earlier version of the Timer view had blurred background blobs and translucent "glass" cards; this was intentionally removed to match the rest of the app).
- Fonts: IBM Plex Sans (UI text) + JetBrains Mono (numbers/metadata), loaded from Google Fonts.

## Robustness notes (things fixed while merging)

- Both the database path and the frontend `resource_path()` are anchored to the app's own directory (`utils.app_dir()`), not the process's current working directory — previously launching from a different folder would silently create/open a *different* empty database.
- SQLite runs in WAL mode with a lock around every access (not just writes) — the JS bridge and the asset-serving thread can both touch the DB.
- All JS-facing API methods validate/catch rather than let exceptions cross the pywebview bridge (e.g. a non-numeric project id, a malformed due date, or a filesystem error exporting CSV all come back as a normal error value).
- `logging` module used throughout instead of bare `print()`.
- `requirements.txt` is pinned (`pywebview==6.2.1`).
- `test_api.py` is a real (if lightweight) regression suite — it exercises the whole backend headlessly against a temp DB, including sessions/pauses/milestones and garbage-input handling.

## Known gaps / not built yet

- **No AI features yet.** No LLM provider integration and no chatbot over your notes/tasks/sessions — this is the planned **Phase 3**.
- **No packaging** — runs via `python main.py`, not built into a standalone `.exe` (no PyInstaller spec yet, though `utils.resource_path()` is already written to support one).
- **Backlinks pane is a stub** — the UI exists but there's no `get_backlinks` API behind it yet.
- **No crash recovery mid-session** — if the app closes while a Timer session is running, that in-progress session (and any pauses/milestones so far) is lost; everything is written together only on Stop.
- **No automated frontend tests** — `test_api.py` covers the Python backend only; the UI has been checked by launching the app and inspecting logs/asset loads, not by automated UI testing.
- **Desktop notifications / taskbar flash are best-effort** — they depend on OS/WebView2 permission behavior and haven't been verified across every Windows configuration.
- Two timestamped `.bak` files and a stray empty root-level `knowledge_os.db` are left over from the merge/migration — safe to delete once you're confident nothing's needed from them.
