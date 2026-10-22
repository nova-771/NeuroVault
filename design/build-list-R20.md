# NeuroVault new front end: build plan (mockup R20)

_From [vault-notes-mockups.html](vault-notes-mockups.html) at R20 (commit `be1769b`), every design switch locked. Written and agreed 2026-10-15; nothing in the app has changed yet._

## What gets built

The new NeuroVault front end is the one we designed in the mockup. It **replaces** the old `frontend/` (`index.html`, `app.js`, `timer.js`, `style.css`, `timer.css`, `theme.js`), which stays in git history only. The Python side stays: `main.py`, `api.py`, `db.py`, `config.py` and `vault.py`, extended where the new screens need more data.

## Approach: extract the mockup, don't redraw it

The mockup is already working code: real tokens, components, render functions and actions. The build turns that file into the app:

1. **Strip the mockup parts:** the switch toolbar, locks, decisions panel, changelog, parts gallery, self-check, screen-size emulation, "Open panel" demo switch and sample-profile switch.
2. **Bake in the decisions:**
   - Every `G.<switch>` branch keeps only the locked option.
   - CSS rules written as `body[data-<switch>="<chosen>"] …` lose that prefix.
   - Rules for set-aside options are deleted.
   - Theme, accent, font and text size become reader settings (Settings → Appearance), saved in `config.json`.
3. **Swap the sample data for the backend:** a small store layer loads from `window.pywebview.api.*` and writes back through it. The render code keeps reading the same `D.notes`, `D.tasks` and so on.
4. **Split the single file** into plain files loaded in order (no build step, same as today):
   - `index.html`;
   - `css/tokens.css` (scales and the nine themes);
   - `css/app.css`;
   - `fonts/` (OpenDyslexic, Lexend, Atkinson; all OFL);
   - `js/icons.js`, `js/store.js`, `js/render-*.js` (shell, notes, tasks, timer, settings, widgets) and `js/actions.js`.

   Lucide isn't needed: the mockup draws its own wireframe icons.

## Data: what the backend has and what it needs

| Mockup data | Backend today | Needed |
|---|---|---|
| **Projects** (name, colour slot 1–6) | `projects` table, colour stored as hex | Store the colour slot, so contrast holds in every theme; map the old hex colours to the nearest slot once |
| **Folders** (name, parent, project) | — | New `folders` table (id, name, parent_id, project_id) and `folder_id` on notes. API calls to create, rename, move, delete (to the recycle bin) and sort |
| **Notes** (title, Markdown, folder, tags) | `notes` (content, category, project_id) + tags | `folder_id`. Existing notes get a folder per (project, category) once (question 3) |
| **Tasks** (priority, due, project, done, linked note, energy, steps) | `tasks` (no note link, energy or steps) | Add `note_id` and `energy`, and store steps (JSON column or a `task_steps` table) |
| **Timer** (sessions, pauses, check-ins, ratings, insights, history) | `sessions`, `pauses`, `milestones`, insights and history calls | Mostly there. Add a running-session record so a session survives the app closing (an open question since R6) |
| **Timer settings, reader settings** | `config.json` via `get_settings` / `save_settings` | Add the reader settings (theme, font, text size, spacing, comfort options) |
| **Window** | Standard Windows frame | `main.py`: `frameless=True, easy_drag=False, resizable=True`. API: minimise, maximise / restore, close. Check edge-resizing on Windows 11 first |
| **HTML / PDF files, sticky notes, inbox, version history, branches** | — | Need the vault on disk (`.md` and files in a folder, the PRD's first storage change). Later builds |

Outline, Backlinks, Tags, the Graph, Ctrl+K and the "Where I was" trail are worked out in the front end from the loaded notes, so they need nothing new from the backend.

## Phases

Each phase ends with the app running in pywebview, `test_api.py` passing, and the checks below.

| Phase | Built | Backend work |
|---|---|---|
| **1. Shell** | New `frontend/` from the mockup with the decisions baked in. Window bar drawn by the app with tabs, rail, sidebars, status bar, nine themes, fonts, reader settings. Runs on the mockup's sample data, so every screen can be checked against the mockup before real data goes in | Frameless window + window-button calls |
| **2. Notes** | File explorer (folders, rename, move, drag, delete, sort, keys), the Notes top row with Search, Word/Docs and Raw .md editing, tags, header path, Outline / Backlinks / Tags, Graph, Ctrl+K over notes and tasks | `folders` table, folder calls, `folder_id`, migration of existing notes |
| **3. Tasks** | Tasks board, filters, linked notes, energy badges, steps | `note_id`, `energy`, steps |
| **4. Timer** | Timer view (session, insights, history, projects), quick timer, timer pill, check-ins, 1–5 ratings | Running-session record; colour slots |
| **5. Settings** | Settings dialog's six pages; comfort suite (ruler, bionic, spacing, reduced motion, soundscapes) | Reader settings in `config.json` |

**Shown but disabled ("Coming soon") until their own build:** sticky notes, brain dump, voice, wrap-up and the launchpad, HTML studio, PDF in and out, version history, Branches, read aloud, dictionary and synonyms, and the AI model router. They sit in their final places, so nothing moves when each one lands. The Timeline view shows sessions and note edits from the start, and the rest of its events come later.

## Decisions baked in

All locked in the mockup's decisions panel. The ones that shape the shell:

- **Window bar:**
  - drawn by the app, with tabs in the window bar like Obsidian;
  - 36px bar, 40px top rows;
  - sticky, brain dump and voice centred over the left sidebar;
  - the timer pill ends 8px before the right sidebar's edge;
  - wrap-up, search and the right sidebar toggle centred over the right sidebar, with a divider before the window buttons.
- **Rail:** icons, 28px buttons, fixed 4px under the window bar. Views swap and tabs stay put. Light/dark button kept (it swaps between Obsidian dark and the last light theme used); Settings opens as a dialog.
- **Notes sidebar:** folders like Obsidian. One top row: New note, New folder, Sort and Collapse on the left, Search beside them. No line under sidebar headers.
- **Note header:** starts 8px from the sidebar's edge, folder path like Obsidian, lowercase centred on Back and Forward (measured per font), More menu only.
- **Editor toolbar:** two zones (Markdown + HTML) in one row, with the rest under ⋯.
- **Note page:** text on the background, centred column sized to the screen, no outline while typing.
- **Right sidebar:** Outline / Backlinks / Tags as underline tabs, three equal parts.
- **Status bar:** no Backlinks link; save status only while saving or with news; Timeline label.
- **Timer:** timer above today, big digits + bar, 1–5 rating buttons, one timer pill in the window bar, quick timer opens under its button.
- **Look:** nine themes with Obsidian dark the default and no "System" choice; violet accent; OpenDyslexic default (Lexend, Atkinson, System offered); text size M; comfortable rows; wireframe icons at one size; plain sidebar toggles.

## Answers (2026-10-15)

1. **Where:** its own worktree on a new branch, `build/new-frontend`, cut from `design/timer-mockup` (so it has the mockup and this plan).
2. **Replace in place:** the first commit on that branch deletes the old `frontend/` files; the old app stays on `main` until the branch merges.
3. **Existing notes:** each (project, category) pair becomes a folder under its project folder. Notes with no category, and notes with no project, both go in a top-level "Unsorted" folder.
4. **Markdown:** vendor `marked` and `turndown` into `frontend/vendor/` (pinned versions, offline). Ask before downloading them.

Also answered: the nine themes with no "System"; unbuilt features shown disabled; the rail's light/dark button kept. Your earlier questions 3 (the old project filter) and 5 (Tailwind) no longer apply, because the old front end goes.

## How each phase is checked

- Port the mockup's `?check=1` sweep as a dev-only check (`?check=1` in the app). It covers alignment, control sizes, contrast in the nine themes, no sideways scroll and the measured numbers from R9–R19.
- Run the app at 1920 × 1080, 1366 × 768, portrait 1080 and 3440 × 1440.
- `test_api.py` covers every new backend call.
- One commit per phase, a line in `PRD-STATUS.md`, and the app's changelog.
