# NeuroVault API contract for the new front end

_Every `window.pywebview.api.*` call the new front end (build plan R20, Phases 2–5) uses, existing and new. Written 2026-10-15 on branch `build/backend-data`, merged into `build/new-frontend` with Phase 1's window calls ([Window](#window))._

## Conventions

- **Calls are positional.** pywebview passes JS arguments in order, so `save_note(id, title, md, category, projectId, tagsText, folderId)`. An argument left off the end takes its default.
- **"Keep" defaults.** Some arguments default to "leave this as it is": `save_note`'s `folder_id`, `save_task`'s `note_id` and `energy`, and `update_task_step`'s `minutes`. Leave the argument off to keep the value. Pass `null` to clear it.
- **Ids are integers.** The API also accepts numeric strings. `''`, `0`, `null` and non-numbers mean "none".
- **Write calls** return `{status: "success", …}`, or `{status: "error", message, code?}`. `message` is plain English, ready to show. The `code` values are `not_empty`, `already_running`, `not_running` and `has_sessions`.
- **Read calls** never throw across the bridge. On an unexpected failure a list call returns `[]`, a dict call returns `{}`, and a single-item call returns `null`. A missing item returns `null`.
- **Times.**
  - `created_at` and `updated_at` are UTC ISO strings, like `2026-10-15T21:25:10+00:00`.
  - Session and timer times are local ISO strings with no zone, like `2026-10-15T09:10:00`, the same as the `sessions` table.
- **Colour slots.** Projects carry `color_slot` (1–6: teal, amber, violet, blue, green, pink), which is the mockup's `proj-color-N`. The old hex `color` is kept for compatibility.

## Filling the store

The mockup keeps project ids (`p-1`) and folder ids (`f-…`) in one namespace: `ancestors()` walks `folder.parent` up to a project. The store should keep that by prefixing the ids: `p-<id>` for projects, `f-<id>` for folders, and `n-<id>` / `t-<id>` for notes and tasks. Strip the prefix before calling the API.

| Store | Load with | Map each item to |
|---|---|---|
| `D.projects` | `list_projects()` | `{id: 'p-'+id, name, color: color_slot}` |
| `D.folders` | `list_folders()` | `{id: 'f-'+id, name, parent}`, where `parent` is `'f-'+parent_id` if set, else `'p-'+project_id` if set, else `null` (a top-level folder such as **Unsorted**) |
| `D.notes` | `list_notes(null, null, true)` | `{id: 'n-'+id, title, md: content, tags, folder, mtime: updated_at, ctime: created_at, category: project_name}`, where `folder` is `'f-'+folder_id` if set, else `'p-'+project_id` (a note at a project's root) |
| `D.tasks` | `list_tasks()` | `{id: 't-'+id, noteId: note_id && 'n-'+note_id, title, priority, due, done: !!completed, energy, steps}`. `due` is `'Today'` when `due_date` ≤ today, else `'Upcoming'`. `steps` is `steps.map(s => ({id: s.id, t: s.text, m: s.minutes, done: s.done}))`, or `undefined` when there are none |
| `D.sessions` | `list_sessions(100000)` (Phase 4 loads every session, so Insights, the week and the streak count them all) | `makeSessions()`'s shape, with `color` already the slot. Prefix the ids: `id: 's-'+id`, `project_id: 'p-'+project_id` (or `null`), so they match `D.projects`. A session whose project was deleted has `project_name: 'No project'` and `color: 0` |
| `D.tset` | `get_settings()` | `five_min: notify_five_min_warning`, `sound: notify_sound_on_complete`, `desktop: notify_desktop`, `taskbar: notify_taskbar_flash`, `overtime_repeat: notify_overtime_repeat`, `sound_name: notify_sound`, `volume: round(notify_volume*100)`, `interval: notify_overtime_interval_min`, `custom_sound: notify_custom_sound_path`, `vault: obsidian_vault_path`, `db: db_path`, `vaultStatus: null` (set from `test_vault_connection()`) |
| Reader settings (`READER`, `S.a11y`) | `get_settings()` | Already wired in Phase 1 (`store.js`: `readerFromConfig` reads, `setReader` / `setComfort` write). `READER.theme / accent / font / textsize / spacing / lastLight` come from `theme`, `accent`, `font`, `text_size`, `row_spacing` and `last_light_theme`. `S.a11y.letter / word / line / width / ruler / rulerLines / bionic / still` come from `comfort_letter_spacing / comfort_word_spacing / comfort_line_height / comfort_line_width / comfort_ruler / comfort_ruler_lines / comfort_bionic / comfort_reduced_motion` |
| `D.stickies`, `D.inbox` **(Phase 6A)** | `list_stickies()`, `list_inbox()` | See [Sticky notes and the brain dump inbox](#sticky-notes-and-the-brain-dump-inbox-phase-6a) |
| Explorer sort (`S.sort`) | `get_settings().tree_sort` | Same six values as the mockup's `SORTS` |
| Timer (`T`, `G.tstate`) | `get_running_session()` on launch | See [Running session](#running-session) |

Two changes the front end needs for real data:

1. **Top-level folders.** The mockup's `childrenOf(null)` lists only projects. It must also list folders whose `parent` is `null` (Unsorted). `rootProject()` returns nothing for notes in them, so their `category` is empty.
2. **Deleting a note doesn't delete its tasks.** The mockup drops a note's tasks with the note. The database keeps the tasks and only clears their `note_id`.

## Projects

| Call | Returns | Errors |
|---|---|---|
| `list_projects(include_archived=false)` | `[{id, name, description, color, color_slot, icon, archived, created_at, updated_at}]`, A to Z | — |
| `create_project(name, description='', color='', icon='', color_slot=null)` | `{status, id, name, color, color_slot}`. With no slot or colour, it takes the next slot in turn. A hex colour alone maps to the nearest slot | Empty name; name already used (any case); name already used by a top-level folder |
| `update_project(project_id, name=null, color_slot=null, description=null)` **new** | `{status, id, name, color_slot, color}`. A `null` argument is left as it is | Not found; empty or duplicate name; slot not 1–6 |
| `set_project_archived(project_id, archived)` | `{status}` | Bad id |
| `delete_project(project_id)` | `{status}`. Its notes, tasks, sessions and folders stay, with no project. Its folders become top-level folders, and notes at its root move to Unsorted. A moved folder isn't renamed, so it can end up with the same name as another top-level folder | Bad id; `code: 'has_sessions'` with `sessions: n` when the project has logged sessions (Phase 4): nothing changes |

## Folders (new)

A folder sits in one of three places:

- inside another folder (`parent_id`);
- at a project's root (`project_id` only);
- at the top level (neither).

A folder's `project_id` always matches the project at the top of its branch.

| Call | Returns | Errors |
|---|---|---|
| `list_folders()` | `[{id, name, parent_id, project_id, created_at, updated_at}]`, flat | — |
| `get_folder_tree(sort=null)` | `{sort, folders: [node], notes: []}`. The top level holds projects, then top-level folders, sorted together. A node is `{kind: 'project' \| 'folder', id, name, folders: [node], notes: [{kind: 'note', id, title, folder_id, project_id, created_at, updated_at}]}`. Projects also carry `color_slot` and `archived`; folders also carry `parent_id`, `project_id` and the timestamps | Leaving `sort` off, or passing an unknown value, uses the saved order |
| `set_tree_sort(sort)` | `{status, sort}`. Saved to `config.json` as `tree_sort` | Not one of `name-asc`, `name-desc`, `mod-desc`, `mod-asc`, `created-desc`, `created-asc` |
| `create_folder(name, parent_id=null, project_id=null)` | `{status, id, name, parent_id, project_id}`. If `parent_id` is given, the folder takes the parent's project | See name rules below; parent or project not found |
| `rename_folder(folder_id, name)` | `{status, id, name}` | Not found; name rules |
| `move_folder(folder_id, parent_id=null, project_id=null)` | `{status, id, parent_id, project_id}`. The folder, its subfolders and the notes inside all take the destination's project | Not found; destination not found; into itself or one of its own subfolders; name already used at the destination |
| `delete_folder(folder_id, cascade=false)` | `{status, folders_deleted, notes_deleted}`. Subfolders go too | Not found; `code: 'not_empty'` with `notes: n` when notes are inside and `cascade` is false. Ask the user, then call again with `true`. This becomes a move to the recycle bin in the vault phase |

**Name rules** (the same as the mockup's rename checks):

- The name isn't empty once trimmed.
- It contains none of `\ / : * ? " < > |`.
- It isn't `.` or `..`.
- No other folder in the same place has the same name, in any case. At the top level, project names count too.

**Sort.** Notes sort by title (natural order, so "Note 9" comes before "Note 10"), modified time or created time. Folders always sort by name: Z to A for `name-desc`, A to Z otherwise. This is what the mockup's `childrenOf` does.

## Notes

| Call | Returns | Errors |
|---|---|---|
| `list_notes(project_id=null, folder_id=null, include_content=false)` | `[{id, title, content?, category, project_id, project_name, folder_id, tags: [string], created_at, updated_at}]`, newest edit first. `content` is only included when `include_content` is true | — |
| `get_note(note_id)` | One note with `content` and `folder_id`, or `null` | — |
| `save_note(note_id, title, content, category, project_id=null, tags_text='', folder_id=keep)` | `{status, message, id, folder_id, project_id, updated_at}`. `note_id` is `null` for a new note. `tags_text` is comma-separated | Folder or project not found; an update to a note that doesn't exist |
| `move_note(note_id, folder_id=null, project_id=null)` **new** | `{status, id, folder_id, project_id}`. Doesn't change `updated_at` | Note, folder or project not found |
| `delete_note(note_id)` | `{status}`. Linked tasks keep going, with `note_id` cleared | Bad id |
| `open_external(url)` **new (Phase 2)** | `{status}`. Opens a link from a note in the default browser or mail app (Ctrl+click in the editor), never inside the window | Not `http://`, `https://` or `mailto:`; control characters; over 2048 characters; no app could open it |

Where a note goes, for both `save_note` and `move_note`:

- **A folder:** the note takes that folder's project. Any `project_id` passed is ignored.
- **No folder, with a project:** the note sits at the project's root.
- **Neither:** the note goes in the top-level **Unsorted** folder, which is created if it's missing.
- **Saving an existing note with `folder_id` left off:** the note stays where it is.

`category` is the old free-text field. The new front end can send the project name, as `syncCategories()` does, or `''`.

## Tasks

| Call | Returns | Errors |
|---|---|---|
| `list_tasks(project_id=null, include_completed=true, note_id=null)` | `[{id, title, description, completed, priority, due_date, project_id, project_name, note_id, energy, tags, steps: [step], created_at, updated_at}]`. Open tasks come first, then by due date | — |
| `get_task(task_id)` | One task with `steps`, or `null` | — |
| `save_task(task_id, title, description, priority, due_date, project_id=null, tags_text='', completed=false, note_id=keep, energy=null)` | `{status, message, id, note_id, energy}`. `priority` is Low, Medium, High or Critical. `due_date` is `YYYY-MM-DD` or `null`. A `null` energy keeps the current one; new tasks start at `medium` | Bad due date; energy not `high`/`medium`/`low`; note not found; update of a missing task |
| `set_task_energy(task_id, energy)` **new** | `{status, id, energy}`. For the badge that cycles high → medium → low | Bad energy; task not found |
| `toggle_task(task_id)` | `{status, completed}` | Not found |
| `update_task(task_id, title=null, completed=null, due_date=keep)` **new (Phase 3; `due_date` Build I)** | `{status, id, title, completed, due_date}`. A `null` title or completed is left as it is; `due_date` is `"YYYY-MM-DD"` (a longer ISO string is cut to the date), `null` or `""` for no due date (Later), and left out it stays. Everything else (description, project, note, energy, tags, steps) is untouched. Used for ticks, renamed `- [ ]` lines and the Tasks page's due menu | Not found; empty title; a date that isn't `YYYY-MM-DD` |
| `delete_task(task_id)` | `{status}`. Its steps go too | Bad id |
| `trash_task(task_id)` **new (Build I)** | `{status, bin_id, id, title}`. Delete on the Tasks page: the task, its steps and tags go into the `task_bin` table and leave `tasks`. A timer running on it loses the link (as `delete_task` does). Bin rows older than 30 days are purged on the next delete | Not found |
| `restore_task(bin_id)` **new (Build I)** | `{status, task}` (as `get_task`). Undo: the task comes back under its old id with its steps, tags, energy, due date, done time and note link; a note or project deleted since leaves it unlinked; a timer that ran on it gets the link back if the same session is still running | Not in the bin (already restored, or purged) |

**Tasks written as lines in a note (Phase 3, front end only).** A `- [ ]` / `- [x]` line in a note's Markdown, outside code blocks, is a task linked to that note. After each successful `save_note`, the front end (`syncLineTasks` in `store.js`) compares the note's lines with its linked tasks:

- A line that matches no task makes one: `save_task(null, text, '', 'Medium', null, <the note's project>, '', <ticked>, <note>, 'medium')`.
- A line whose text changed since the last save renames its task with `update_task`, so the task keeps its energy, due date and steps.
- A tick follows with `update_task(id, null, done)`. Ticking the box in the editor sends it at once; ticking the task on the board rewrites the line and saves the note.
- A line that was removed deletes its task (`delete_task`).

Nothing is written when a vault loads: a line becomes a task the next time its note saves. The note's `{{tasks}}` block lists only its other linked tasks (added on the board), so no task shows twice.

**Steps** (new). A step is `{id, task_id, text, minutes, done, position}`. `minutes` is a whole number or `null`.

| Call | Returns | Errors |
|---|---|---|
| `add_task_step(task_id, text, minutes=null)` | `{status, step}`, added at the end | Task not found; empty text; minutes not a whole number of 0 or more |
| `update_task_step(step_id, text=null, minutes=keep, done=null)` | `{status, step}`. Pass `minutes` as `null` to clear it | Not found; same checks as `add_task_step` |
| `delete_task_step(step_id)` | `{status}` | Not found |
| `reorder_task_steps(task_id, step_ids)` | `{status, steps}` | Task not found; `step_ids` doesn't list every step exactly once |
| `set_task_steps(task_id, [{text, minutes?, done?}])` | `{status, steps}`. Replaces every step: this is how the 🪄 splitter saves its result. `[]` clears them | Task not found; any bad step (then nothing changes) |

## Timer

| Call | Returns | Errors |
|---|---|---|
| `list_sessions(limit=500)` **new** | `[{id, project_id, project_name, color, start_time, end_time, target_seconds, actual_seconds, overtime_seconds, energy, focus, is_unplanned, pauses: [{category, start_time, end_time, duration_seconds}], milestones: [{note, at_time, time_label: 'HH:MM', elapsed_seconds}]}]`, newest first | — |
| `get_insights()` | `{heatmap, breakdown_alltime, averages, estimation, pauses}`, as today. The mockup works the same numbers out from `D.sessions`, so this call is optional | — |
| `get_project_time_stats()` | `[{id, name, color, session_count, total_seconds}]` | — |
| `log_session(project_id, start_iso, end_iso, target_seconds, actual_seconds, energy, focus, is_unplanned, pauses, milestones)` | `{session, dashboard, vault_status}`. Logs a finished session directly. The new timer uses `finish_running_session` instead | No project; bad times |
| `export_csv()` | `{ok, message}`. Opens a save dialog | — |

### Running session

There's one running-session record at a time, stored as wall-clock times, so a session survives the app closing.

**What every call returns.** Each running-session call returns this object, as `session` in its result:

```
{project_id, project_name, color, task_id, mode: 'planned' | 'stopwatch', target_seconds,
 started_at, paused_at, pause_reason, stopped_at, last_seen_at,
 pauses: [{category, start_iso, end_iso, duration_seconds}],
 milestones: [{note, at_iso, elapsed_seconds}],
 state: 'running' | 'paused' | 'stopped', elapsed_seconds, paused_seconds, is_over, away_seconds}
```

- `elapsed_seconds` counts active time only, with pauses left out.
- `away_seconds` is the time since the last call or heartbeat. It's large after the app was closed.

| Call | Returns | Errors |
|---|---|---|
| `get_running_session()` | The session object, or `null`. **Call it on launch** | — |
| `start_running_session(project_id, target_seconds=0, mode='planned', task_id=null)` | `{status, session}` | `code: 'already_running'`; no project; planned with a target of 0 or less; unknown mode; task not found |
| `update_running_session(action, value=null)` | `{status, session}` | `code: 'not_running'`; the action doesn't fit the state, such as pausing while paused or anything except `heartbeat` after `stop`; a missing reason or note; an unknown action |
| `finish_running_session(energy=null, focus=null, project_id=null)` | `{status, session, dashboard, vault_status}`, the same as `log_session`. It stops the clock first if needed, then clears the record. Ratings are 1–5; anything else counts as not rated | `code: 'not_running'`. If the project was deleted, logging fails and **the record stays**; call again with a `project_id` |
| `discard_running_session()` | `{status}`. Throws the session away without logging it | — |

The `update_running_session` actions:

- `pause` (value: the reason)
- `resume`
- `checkin` (value: the note)
- `retarget` (value: seconds, planned sessions only)
- `stop`: ends the clock and goes to the rating step
- `heartbeat`: send about every 60 s while the timer runs
- `away` (value: a reason, default "App closed"): counts the time since the last heartbeat as a pause

**Mapping to the mockup's `T` and `G.tstate`:**

- `T.projectId` is `'p-'+project_id`, `T.mode` is `mode`, `T.target` is `target_seconds`, and `T.elapsed` is `elapsed_seconds`. The front end keeps ticking locally and re-syncs on each call.
- `T.pauses` and `T.milestones` are the lists above.
- `G.tstate` is:
  - `rate` when `state` is `stopped`;
  - `paused` when it's `paused`;
  - otherwise `overtime` if `is_over`, `stopwatch` if `mode` is `stopwatch`, and `running` if not.
- `pausepick` and `checkin` are front-end-only steps before `pause` and `checkin`.

**On launch,** if `away_seconds` is more than about 2 minutes, ask whether the time the app was closed counts. If it doesn't, call `update_running_session('away')`.

## Sticky notes and the brain dump inbox (Phase 6A)

Kept in SQLite until the vault on disk exists, in two tables shaped like their future files: a sticky becomes `stickynoted/<file>` and the inbox becomes `_inbox.md`. `get_sticky_file` and `get_inbox_markdown` already return that text, so the vault-on-disk build only has to write it out. Times are local, without a zone (like the sessions table), because the file names and the inbox's day headings are local.

| Call | Returns | Errors |
|---|---|---|
| `list_stickies()` | `[{id, n, text, color, open, x, y, w, h, file, created_at, updated_at}]`, by number. `open` says whether the card shows on the overlay. `x`/`y`/`w`/`h` are pixels, or `null` for the default place and size (248 × 224). `file` is `stickynoted/YYYY-MM-DD-HHMM.md` | — |
| `create_sticky(text='', color=null)` | `{status, sticky}`, open. `n` is one more than the highest in use; with no colour it takes the next of `yellow, pink, mint, blue, lilac` in turn. File names stay unique (`-2`, `-3` within the same minute) | Not one of the five colours; text over 100,000 characters |
| `update_sticky(sticky_id, patch)` | `{status, sticky}`. `patch` holds any of `text`, `color`, `open`, `x`, `y`, `w`, `h` (`null` forgets a place or size). Only `text` and `color` change `updated_at`: moving, sizing and closing aren't edits | Not found; empty or unknown keys; bad colour; a place or size that isn't a number, or is outside −10,000 to 20,000 |
| `delete_sticky(sticky_id)` | `{status, id}`. The front end calls it once a sticky has become a note or a task, and when an empty one is closed | Not found |
| `get_sticky_file(sticky_id)` | `{status, file, text}`: front matter (`n`, `color`, `open`, `x`, `y`, `w`, `h`, `created`), then the text | Not found |
| `list_inbox(include_done=false)` | `[{id, text, done, created_at, day: 'YYYY-MM-DD', time: 'HH:MM'}]`, oldest first. Done thoughts (for the wrap-up's triage) only on request | — |
| `add_inbox_item(text)` | `{status, item}`, stamped with the local time. The text is one line, with spaces squeezed | Empty; over 10,000 characters |
| `update_inbox_item(item_id, text=null, done=null)` | `{status, item}`. A `null` argument is left as it is | Not found; empty text |
| `delete_inbox_item(item_id)` | `{status, id}` | Not found |
| `get_inbox_markdown()` | `{status, file: '_inbox.md', text}`: `# Inbox`, then a `## YYYY-MM-DD` heading per day (oldest first) and a `- HH:MM text` line per thought; a done one reads `- [x] HH:MM text` | — |

**In the store** (`capture.js`, loaded by `loadCapture()` after `loadVault()`):

- `D.stickies`: `{id: 'st-'+id, n, text, color, open, x, y, w, h, file, saved: updated_at}`. Text saves 450 ms after the last key, and when the card loses focus or the window closes.
- `D.inbox`: `{id: 'in-'+id, t: time, day, text, done}` for the open thoughts. The brain dump bar lists today's.

**What the ⋮ menu does** (the front end does each step with existing calls, so a failure leaves the sticky in place):

- **Promote to full note:** `save_note` with the sticky's text and the tag `sticky`, in the folder you're in, named from its first line; then `delete_sticky`. The note opens in a new tab, and its `- [ ]` lines become tasks.
- **Append to an existing note:** the text goes on the end of the note as a quote (`> From sticky #n:`), the note saves, then `delete_sticky`.
- **Attach to a project or folder:** the same as Promote, in the folder you pick (or a new one made with `create_folder`), without opening it.
- **Convert to a timed task:** `save_task` (the first line is the title, all of the text the description, due today, linked to the open note), `add_task_step` with 15 minutes as its estimate, `delete_sticky`, then the quick timer starts on that task if no timer is running.

**Ctrl+Shift+D** opens the brain dump inside the window. `main.py` registers it as a global hotkey as well, beside Ctrl+Alt+P/S/H. It brings the window up and calls `window.hotkeyBrainDump()`. Like the others, it needs the optional `keyboard` package.

## Settings

| Call | Returns | Errors |
|---|---|---|
| `get_settings()` | Every `config.json` key, plus `vault_name` and `db_path` | — |
| `save_settings(patch)` | All settings after the change. Reader settings are checked first; any bad ones are left out and listed in `rejected: {key: message}`. Choosing a light theme also sets `last_light_theme` | — |
| `browse_vault_folder()` / `browse_sound_file()` | A path, or `null` | — |
| `test_vault_connection()` | `{ok, message}` | — |
| `read_custom_sound()` **new (Phase 5)** | `{status, name, data_url}`: the custom alert sound (`notify_custom_sound_path`) as a `data:audio/…;base64,` URL, because the page is served over http and can't open a `file:///` path. It reads only the file saved in settings, never a path from the page | None chosen; not `.wav`, `.mp3` or `.ogg`; file not found; over 10 MB |
| `read_aloud_status()` **new (Phase 6C)** | `{status, available, voices: [{id, label}], models: [{id, kind}], folder, message}`: the Kokoro / Piper voices on this PC (`read_aloud.py`). Voice ids are `<model folder>:<speaker>`. With no model, `available` is false and `message` says where models go | sherpa-onnx not installed or no model: `available: false` with a message (still `status: success`) |
| `read_aloud_speak(text, voice, speed)` **new (Phase 6C)** | `{status, audio, duration, words: [[start, end], …], voice}` for one sentence: a WAV `data:` URL, silence trimmed, and an estimated start and end (seconds) for each space-separated word | No text; over 2,000 characters; speed outside 0.5–2.5; no model (`missing: true`); a saved voice that's gone falls back to the first one |
| `flash_taskbar()` | `bool` | — |

Reader settings, their defaults, and the values `save_settings` accepts:

| Key | Default | Accepts |
|---|---|---|
| `theme` | `obsidian` | `obsidian`, `slate`, `cream`, `sage`, `sky`, `buttercup`, `paper`, `sepia`, `contrast` (no `system`; an old `dark` / `system` reads as `obsidian`, and `light` as `cream`) |
| `last_light_theme` | `cream` | Any of the six light themes |
| `accent` | `{}` | **(Build G)** `{theme: accent id or "custom"}`. Each id must be in that theme's own set (`config.ACCENT_SETS`); a theme left out has its first accent (Violet; Lavender on High contrast). An old `"violet"` string reads as `{}` |
| `accent_custom` **(Build G)** | `""` | `""` or `#rrggbb` (any case; saved lower case). Anything else is refused |
| `accent_custom_theme` **(Build G)** | `""` | `""` or a theme: where your colour was chosen. It's used exactly there and shaded to stand out on the other themes |
| `colour_vision` **(Build G)** | `off` | `off`, `rg` (red–green), `tri` (blue–yellow) |
| `font` | `opendyslexic` | `opendyslexic`, `lexend`, `atkinson`, `system` |
| `text_size` | `m` | `s`, `m`, `l`, `xl` **(Build E)**: the note text is 14 / 15 / 17 / 19px; the rest of the app stays Medium |
| `row_spacing` | `comfortable` | `comfortable`, `compact` |
| `comfort_letter_spacing` | `0` | 0 to 0.15 em |
| `comfort_word_spacing` | `0` | 0 to 0.3 em |
| `comfort_line_height` | `1.85` | 1.4 to 2.2 |
| `comfort_line_width` | `95` | 55 to 95 characters (95 means full width) |
| `comfort_ruler` | `false` | `true` / `false` |
| `comfort_ruler_lines` | `2` | 1 to 3 |
| `comfort_bionic` | `false` | `true` / `false` |
| `comfort_reduced_motion` | `false` | `true` / `false` |
| `tree_sort` | `name-asc` | The six sort orders |
| `comfort_soundscape` **(Phase 5)** | `off` | `off`, `brown`, `pink`, `rain` (`S.sound.kind`; starts again on launch) |
| `comfort_soundscape_volume` **(Phase 5)** | `40` | 0 to 100 (`S.sound.vol`) |
| `editor_html_zone` / `editor_spell_check` / `editor_homophones` **(Phase 5)** | `true` | `true` / `false` (`S.a11y.zoneB / spell / homophones`) |
| `focus_nudge_minutes` **(Phase 5)** | `60` | `0` (off), `45`, `60` (`S.a11y.nudge`); `false` isn't taken as `0` |
| `read_engine` **(Phase 6C)** | `windows` | `windows` (WebView2 speechSynthesis), `sherpa` (Kokoro / Piper; Windows voices read while no model is found) |
| `read_voice_windows` / `read_voice_sherpa` **(Phase 6C)** | `""` | Any text: a Windows voice's `voiceURI`, or `<model folder>:<speaker>`; `""` = the default / first voice |
| `read_speed` **(Phase 6C)** | `1` | `0.75`, `1`, `1.25`, `1.5`, `2`; `true` isn't taken as `1` |
| `read_highlight` **(Phase 6C)** | `true` | `true` / `false` (`S.a11y.karaoke`, "Highlight as it reads") |
| `font_use` **(Build E)** | `""` | An added font's id (its folder in the fonts folder: `[a-z0-9][a-z0-9-]{0,63}`), used for the whole app; `""` = the built-in `font`. Set it with `font_use()`, which also checks the font is there |

Timer alert keys (`notify_*`), `obsidian_vault_path` and `hotkeys_enabled` are unchanged, and `save_settings` stores them as given.

## Voice rambler (Phase 6B)

Records with `sounddevice`, transcribes offline with sherpa-onnx Whisper, then tidies by rules (`voice.py`). Nothing blocks: the page starts, polls and stops. The models live in `models/whisper-<name>/` next to the app (`NV_MODELS_DIR` overrides it; `dev_bridge.py --models`). They're downloaded only when the user clicks Download.

| Call | Returns | Notes |
|---|---|---|
| `voice_status()` | `{status, model, models, mics, mic, mic_error, stage, download, test_wav}` | `model`/`models[]`: `{name, note, present, missing, folder, size_mb, source}`. `download`: `{stage: idle\|downloading\|done\|error, name, done, total, message}` (bytes) |
| `voice_start(max_seconds=600)` | `{status, max_seconds}` | Errors: the model isn't installed; the microphone didn't open. The wrap-up memo passes `10` |
| `voice_poll()` | `{status, stage, …}` | `recording`: `seconds, level, bars` (24 levels 0–1), `full` (max reached). `transcribing`: `done, total` (30-second parts). `done`: `result`. `error`: `message` |
| `voice_stop()` | `{status}` | Starts transcribing; poll for the result |
| `voice_discard()` | `{status}` | Throws the recording (or a running transcription) away |
| `voice_tidy(text)` | `{status, raw, paras, tasks, anchors, missing}` | The rules cleanup and anchor check without recording. `raw`/`paras[]`/`tasks[]` are segments `[text, anchorId\|null]`. `anchors`: `{id: {text, kind, found, item}}`, where `kind` is Money, Number, Date, Time, Date and time, Deadline or Name, and `item` (`["p"\|"t", i]`) is where "+ Insert" puts a missing one. `voice_poll`'s `result` is the same plus `text` and `seconds` |
| `voice_download_model(name=null)` | `{status}` | `base.en` (161 MB) or `small.en` (376 MB), from huggingface.co/csukuangfj/sherpa-onnx-whisper-<name>; poll `voice_status().download` |
| `voice_cancel_download()` | `{status}` | The file in progress is deleted; finished files stay |

| Key | Default | Allowed |
|---|---|---|
| `voice_stt_model` **(Phase 6B)** | `"base.en"` | `base.en`, `small.en` |
| `voice_mic` **(Phase 6B)** | `""` | A microphone's name from `voice_status().mics`; `""` = the Windows default |

## Voice ramble v2 and attachments (Build A)

Files that notes and the brain dump embed live in `attachments/` next to the database (`attachments.py`; the vault-on-disk build moves the folder). A note embeds one as `![[attachments/<name>]]` on a line of its own. A recording is saved as `attachments/voice-YYYYMMDD-HHMMSS.ogg` (Ogg Opus through `soundfile`, about 4 KB a second), or `.wav` without `soundfile`. Removing sends a file to the Windows recycle bin (`SHFileOperationW` with `FOF_ALLOWUNDO`), never deletes it.

| Call | Returns | Notes |
|---|---|---|
| `voice_status()` | also `after`, `live`, `clip_ext` | `after`: `{keep, dest, ask}`. `live`: `{name, label, present, folder, bytes, size_mb, source, pick, on, free_gb, min_free_gb, drive}`; `on` is the pick, or (auto) 5 GB or more free on the data drive |
| `voice_start(max_seconds=600)` | as before | Live words starts too when it's on and its model is installed |
| `voice_poll()` | also `paused`, `words` | While recording: `words` is the last few words heard (lower case), or `null` when live words is off |
| `voice_pause(paused=true)` | `{status, paused}` | Paused blocks are dropped; the clock stops |
| `voice_take()` | `{status, data_url, seconds, file}` | After Stop: the recording for the question's player, and the name it will be saved under |
| `voice_keep(keep="both")` | `{status, file, size, seconds, recycled}` | Saves the take. `keep="text"` saves it, then moves it to the recycle bin (`recycled: true`). **Fix A (QC 4 · 35):** `success` only once the whole file is on disk (written to a `.part`, flushed, renamed, size checked); a failed write is `{status: "error", message: "Couldn't save the recording: …"}` and keeps the take for Try again; a Save again after an answer the page never got returns the same file. The page adds the `![[…]]` line only once `list_attachments` shows the file, and waits up to 2 minutes for this call |
| `rename_attachment(file, new_name)` | `{status, file, old, notes, inbox, same?}` | **Fix A (QC 4 · 35):** Rename… The file in attachments/ gets the new name (its extension kept, typed or not; checked: not empty, no `< > : " / \ | ? * [ ] # ^` or control characters, not a Windows reserved name, no leading or trailing full stop, 120 characters at most, no other file of that name) and every link to it follows: notes (`![[…]]`, `![[…|…]]`, `![[…#…]]`, the hidden CSV line), Brain Dump thoughts, wrap-up memos. A refused name changes nothing. The page shows it at once, with Undo for 10 seconds, and calls this when they're up |
| `relink_attachment(missing, file)` | `{status, file, old, notes, inbox}` | **Fix A:** Find the file… Every link to `missing` (a file that isn't there any more) points at `file`, which must be in attachments/ |
| `attachment_pick(kind="audio")` | `{status, file, copied?}` or `{status: "cancelled"}` | **Fix A:** Find the file… → Choose on this PC. A file already in attachments/ is used as it is; one elsewhere is copied in under a free name |
| `voice_transcribe_file(file)` | `{status}` | Transcribe for a saved clip; poll `voice_poll()` as after Stop |
| `voice_download_live()` | `{status}` | The live-words model (44 MB, huggingface.co/csukuangfj/sherpa-onnx-streaming-zipformer-en-20M-2023-02-17); poll `voice_status().download` (`name: "live"`) |
| `list_attachments()` | `{status, folder, files}` | `files[]`: `{file, name, kind (audio\|image\|pdf\|other), size, mtime, seconds (audio), uses: [{kind: note\|inbox, id, title}]}`, newest first |
| `attachment_data(file)` | `{status, data_url}` | For players and image embeds |
| `attachment_open(file)` / `attachment_reveal(file)` | `{status}` | The default app / File Explorer with the file selected |
| `attachment_save(data, stem="paste")` | `{status, file, name, kind, size, mtime}` | **Fix A:** a pasted image the page has, as a `data:image/…;base64,` URL (PNG, JPEG, GIF, WebP, BMP, AVIF; the bytes must match the type), saved as `attachments/<stem>-YYYYMMDD-HHMMSS.<ext>` (`-2` when taken). The editor embeds it with `![[file]]` on a line of its own; the note saves as typed |
| `remove_attachment(file)` | `{status, file, notes, inbox, inbox_removed}` | Recycle bin; the embed lines leave every note (saved); thoughts lose the clip, and one with no text or tasks left is deleted |
| `unused_attachments()` | `{status, count, bytes, files}` | Files no note or thought uses |
| `recycle_unused_attachments()` | `{status, moved, bytes, failed}` | |
| `add_inbox_voice(text="", audio=null, tasks=[])` | `{status, item, tasks_added}` | A voice thought. **Build A+:** each of `tasks` (the ticked ones) becomes a real task on the Tasks board, made as the wrap-up parks a thought: no project, note or due date, Medium, medium energy, title cut at 200. `tasks_added` is those tasks (`get_task` rows); the thought keeps their ids in `task_ids`. `list_inbox()` items carry `audio`, `tasks` (thoughts saved before A+ only) and `task_ids` |
| `update_inbox_voice(id, text, tasks)` | `{status, item, tasks_added}` | Transcribe on a thought: its text, and `tasks` as board tasks added to its `task_ids` |

| Key | Default | Allowed |
|---|---|---|
| `voice_after_keep` **(Build A)** | `"both"` | `both`, `text`, `audio` |
| `voice_after_dest` **(Build A)** | `"dump"` | `dump`, `note` (the open note), `new` |
| `voice_after_ask` **(Build A)** | `true` | `true` / `false`: off, Stop saves straight away |
| `voice_live` **(Build A)** | `"auto"` | `auto` (on with 5 GB or more free), `on`, `off` |
| `ask_voice_start` **(Build N · R69)** | `"tap"` | `tap` (tap to start, tap again to stop), `hold` (hold the mic or Ctrl+Space), `auto` (tap once; it stops after 1.5 s of quiet) |
| `ask_voice_where` **(Build N · R69)** | `"pc"` | `pc` (the speech model already in the app; nothing leaves the PC), `cloud` (Groq's Whisper large-v3, after a key and the first-use yes) |
| `ask_voice_cloud_seen` **(Build N · R69)** | `""` | The date you said yes to "Let Groq hear what you say?", or empty. Nothing is recorded for the cloud, and nothing sent, before it |
| `attachments_empty_tab` **(Build A)** | `"message"` | `message`, `hide`: the Attachments tab with no note open |

`inbox_items` gains three nullable columns, `audio`, `tasks` (a JSON list of titles, from before Build A+) and `task_ids` (Build A+: a JSON list of the board tasks a thought made; the tasks table has no column pointing back at a thought), added on open; old rows are untouched. `_inbox.md` writes a voice thought's clip as `  ![[…]]` under its line, then `  3 tasks added to Tasks` (an older thought keeps its `  - Task: …` lines, which the wrap-up's Park puts in the task's description).

## Local AI (Build B)

NeuroVault runs models itself with llama.cpp's `llama-server` (`local_ai.py`): an official Windows build from GitHub (Vulkan with a graphics card and its driver, CPU otherwise), downloaded on first use after the page has asked, unpacked in `%LOCALAPPDATA%\NeuroVault\engine\llama.cpp-<tag>-<variant>\`, and started on a free `127.0.0.1` port with a per-run API key. It's killed with the app (a Windows job object, and `shutdown()`). Models (Q4_K_M GGUF) go to `%LOCALAPPDATA%\NeuroVault\models\llm\` (`NEUROVAULT_MODELS\llm` and `NEUROVAULT_ENGINE` override). The list is `ai_models.json`; a newer `catalog.json` in the models folder wins. Downloads use HTTP ranges, keep a `.part` file while paused (also across restarts), and check the size and sha256. Everything slow runs in a thread: the page polls `ai_status()` and `ai_job()`.

| Call | Returns | Notes |
|---|---|---|
| `ai_boot()` | `{status}` | The page is up: starts the engine when `ai_model` is installed and `ai_engine_on`. `ai_status` says `starting` at once |
| `ai_status()` | `{status, pc, pc_line, models, rec, installed, use, downloads, engine, keep, long, auto_route, route, routes, providers, cloud, catalog_updated, models_dir, used_gb, drive}` | `models[]`: `{id, name, short, by, good, gb, bytes, ram, licence, released, file, page, installed, fit, speed, custom}`; `fit` is `""` or why not ("Needs 10 GB memory; this PC has 8 GB"). `downloads`: `{key: {key, label, state: downloading\|checking\|paused\|error, done, total, message, file}}`, key = a model id or `engine`. `engine`: `{state: none\|stopped\|starting\|running\|error, where: gpu\|cpu, message, port, model, build: {tag, variant}\|null, offer: {variant, file, bytes, mb, source, page}, on}`. `routes`: per job `{kind: local\|ollama\|lmstudio\|none, model, label, ready}` |
| `ai_hardware()` | `{status, pc, line}` | `pc`: `{mem_gb, free_gb, free_bytes, drive, gpu: {name, vram_gb}\|null, cards, vulkan, card}`, read fresh (memory: GlobalMemoryStatusEx; graphics card: DXGI, WMI as the fallback; free space on the models drive) |
| `ai_recommend()` | `{status, model, models, pc, engine}` | `model`: the best fit (Qwen3.5 4B with a 4 GB+ graphics card, 2B without; the next smaller one when it doesn't fit), a row as in `models[]`, or `null`. `engine`: the engine file that downloads first (`offer`), or `null` when installed |
| `ai_download(model_id, with_engine=true)` | `{status, downloads}` | Only after the user said yes to the files, sources and sizes. Starts the engine's download too when it isn't installed. Refused when the model doesn't fit. The first model to finish is put in use and the engine starts |
| `ai_download_engine(variant="")` | `{status}` | `vulkan`, `cpu`, or `""` for this PC |
| `ai_pause(key)` / `ai_resume(key)` / `ai_cancel(key)` | `{status}` | Cancel deletes the `.part` file |
| `ai_use(model_id)` | `{status, removed}` | Switches the model and restarts the engine. With `ai_keep` (or its default) `delete`, the old file goes: `removed` = `{id, name, gb}` |
| `ai_remove(model_id)` | `{status, removed}` | Deletes the file (a user's own .gguf is only forgotten) |
| `ai_engine(on)` | `{status}` | Start or stop; saved as `ai_engine_on` |
| `ai_check_catalog()` | `{status, updated, count, new, message}` | Re-reads the model list |
| `ai_add_gguf()` | `{status, model}` / `{status: "cancelled"}` | A file dialog for a .gguf already on this PC; used where it is |
| `ai_test_provider(key)` | `{status, running, models, chip, tone, desc}` | `ollama` (localhost:11434) or `lmstudio` (localhost:1234) |
| `ai_set_route(job, choice)` | `{status}` | Jobs `ramble`, `split`, `qa`, `fallback`; choice `auto`, `local:<id>`, `ollama`, `lmstudio` or (Build N, R56) `cloud:<id>` for a company you have a key for. Used when `ai_auto_route` is off |
| `ai_cloud_key(id, key, acct=None)` **(Build N, R56)** | `{status, ok, secs, limit, message}` | Tests the key with one word, "Hello" (none of your notes); saves it in Windows Credential Manager (keyring) only when the company answers. `acct`: Cloudflare's Account ID (config) |
| `ai_cloud_test(id)` | `{status, ok, secs, limit, message}` | The saved key, "Hello" only. `limit`: it works, but today's free limit is used up |
| `ai_cloud_remove(id)` | `{status}` | The key leaves Credential Manager; the yes, today's limit and the Account ID go; jobs that used it go back to `auto` |
| `ai_cloud_yes(id, yes=True)` | `{status, seen}` | The first-use notice: Use Groq saves the date in `ai_cloud_seen`; `yes=False` is "Show the notice again". Nothing goes to a company before this |
| `ai_use_local(job="qa")` | `{status, choice, name, back}` | After a free limit: the job goes to the model on this PC (or Ollama / LM Studio) until tomorrow (`ai_route_back`), then back to `back` |
| `ai_breakdown(task_id)` | `{status, job}` | Magic task breakdown: 3–6 steps of 2–15 minutes, saved with `set_task_steps`. Job result `{steps, by}` |
| `ai_ask(question, note_id=null)` | `{status, job}` | Note summaries and Q&A from one note (or the 40 latest). Job result `{answer, by}` |
| `ai_job(job_id)` | `{status, id, kind, state: running\|done\|error, result, message}` | |

The voice rambler's clean-up: when the ramble job's model is ready, `voice.py` passes the transcript through it (`voice.AI_CLEANUP`) and the anchor check runs on its answer; the result has `cleaned_by`. Otherwise, or when the model's answer can't be used, the rules' result stays.

| Key | Default | Allowed |
|---|---|---|
| `ai_model` **(Build B)** | `""` | A model id from `ai_status().models` |
| `ai_engine_on` **(Build B)** | `true` | `true` / `false` |
| `ai_keep` **(Build B)** | `""` | `keep`, `delete`; `""` = delete under 20 GB free, keep otherwise |
| `ai_long` **(Build B)** | `"local"` | `local`, `cloud` (cloud keys are Coming soon: long questions stay on this PC) |
| `ai_auto_route` **(Build B)** | `true` | `true` / `false` |
| `ai_route` **(Build B)** | `{}` | Set with `ai_set_route` |
| `ai_custom_models` **(Build B)** | `[]` | Set with `ai_add_gguf` |

## Guided setup (Build D)

The first-run setup (`guided_setup.py`, `frontend/js/setup.js`; mockup R24, with R23's AI step and R28's live words). It shows when `config.json` has no `setup_done` and the database is new (no notes, tasks or sessions); `setup_state()` marks an install that's been used as done, so the setup never comes up on it by itself. Settings → Data → Run the setup again opens it from the current settings. The steps save what they show as it's picked, through `save_settings` (`obsidian_vault_path`, `theme`, `font`, `focus_nudge_minutes`, `comfort_soundscape`, `voice_mic`, `voice_live`, `voice_after_keep`, `voice_after_dest`, `ai_keep`, `ai_long`). The choices that need a download are written by `setup_finish`, which also starts the downloads: speech to text, live words and a read-aloud voice one after another (the voice engine has one download slot), and the AI engine and model through Build B's `ai_download`. Read-aloud voices are sherpa-onnx's release archives (`.tar.bz2` from github.com/k2-fsa/sherpa-onnx, tts-models), unpacked into `read_aloud.download_folder()` after every member is checked (inside the model's folder; no links).

`choices` everywhere: `{stt: "base.en" | "small.en" | "none", live: true | false | null (null follows voice_live), tts: "windows" | "kokoro" | "piper", ai: a model id | ""}`.

| Call | Returns | Notes |
|---|---|---|
| `setup_state()` | `{status, show, done, new_db}` | `show` on a first run. An install with notes, tasks or sessions and no flag gets `setup_done: true` here |
| `setup_info()` | `{status, pc, stt, live, tts, ai, mics, first_run, settings}` | `stt[]`: `voice.model_info` plus `{files, bytes}`. `live`: `voice_status().live` plus `{files, bytes}`. `tts[]`: `{id, label, files, missing, bytes, size_mb, present, source, folder, voice}`. `ai`: `{rec, models (as ai_status), engine: the engine offer or null}`. `settings`: the current values of the keys the setup writes |
| `setup_plan(choices)` | `{status, items, total_bytes, drives, fits}` | What the Ready step lists. `items[]`: `{key: stt \| live \| tts \| engine \| <model id>, label, files, source, bytes, folder}`, only what isn't on this PC. `drives[]`: `{drive, free_bytes, need_bytes, left_bytes}`. Errors for an unknown choice or a model that doesn't fit (its reason) |
| `setup_finish(choices)` | `{status, plan, downloads}` | Start NeuroVault. Refused when a drive hasn't the room, or the setup's downloads already run. Writes `setup_done: true`, `voice_stt_model` (unless `none`), `voice_live` (when `live` isn't null), `read_engine` (`windows` or `sherpa`) and `read_voice_sherpa` (Kokoro: Bella; Piper: Amy). The first AI model is put in use when it lands (Build B) |
| `setup_status()` | `{status, items, busy}` | `items[]`: `{key, label, state: queued \| downloading \| paused \| done \| error \| cancelled, done, total, message}`; the AI ones come from `ai_status().downloads`. One that fails doesn't stop the next |
| `setup_cancel()` | `{status}` | Stops what hasn't finished; part files are deleted |
| `setup_skip()` | `{status, ...settings}` | "Skip the setup". On a first run it writes the defaults of every key the setup asks (`config.DEFAULT_CONFIG`) and `setup_done: true`; from Run the setup again it changes nothing |

| Key | Default | Allowed |
|---|---|---|
| `setup_done` **(Build D)** | `false` | `true` / `false` |

## End-of-day wrap-up and the morning launchpad (Build F)

One SQLite table, `wrapups`, with one row per day wrapped up, shaped like its future file `wrapups/YYYY-MM-DD.md` (`get_wrapup_file` already returns that text). The launchpad's state (shown, launched) lives on the row it comes from. Times are local, without a zone, like the 6A tables. **A day turns over at 04:00**, so a wrap-up at 00:30 still belongs to the evening before, and the launchpad shows on the first open after 04:00.

| Call | Returns | Errors |
|---|---|---|
| `wrapup_status()` | `{status, day, reminder, time, snooze_minutes, launchpad, reached, due, snoozed_until, finished, dismissed, timer_running, wrapup}`. `due`: the reminder is on, the wind-down time has passed, and today's wrap-up isn't finished, dismissed or snoozed. The page asks every 30 seconds | — |
| `wrapup_snooze(minutes=null)` | `{status, minutes, snoozed_until}`. Default: the `wrapup_snooze_minutes` setting. Clears a dismissal | Not a whole number from 1 to 240 |
| `wrapup_dismiss()` | `{status}`: the reminder was closed without finishing, so it doesn't come back today (the sunset button still opens the wrap-up) | — |
| `wrapup_wins(day=today)` | `{status, day, tasks: [{id, title, completed_at, project_id, project_name}], steps: [{id, text, minutes, done_at, task_id, task_title}], projects: [{project_id, name, color, count, seconds}], totals: {tasks, steps, sessions, seconds}}`: what was ticked from 04:00 that day to 04:00 the next, and the sessions that started then | `day` not `YYYY-MM-DD` |
| `wrapup_tidy_items()` | `{status, day, items}`: tasks not done and due by today (overdue too: `{kind: 'task', id, title, due_date, project_name, overdue}`), every sticky (`{kind: 'sticky', id, n, title, open}`) and the inbox's open thoughts (`{kind: 'inbox', id, title, day, time, audio, tasks}`) | — |
| `wrapup_tidy(kind, item_id, action)` | `{status, entry}`. One loose end, logged on today's wrap-up (a second choice for the same item replaces the first). See the table below | Bad kind or action; not found |
| `wrapup_finish(data)` | `{status, wrapup, errors}`. `data`: `{win, win_ref, note, starters: [task ids], new_starters: [titles], tidy: [{kind, id, action}]}`. The tidy choices are applied one by one (a failure goes in `errors`, the rest go on); typed starters become tasks; every starter is due the next day at the latest. Sets `finished_at` and clears the launchpad state | Not an object; over 3 starters in all; a starter that's done or gone; a win over 500 or a note over 5,000 characters; a typed starter over 200 |
| `wrapup_memo_keep()` | `{status, file, seconds, size}`. Saves the recording just stopped (`voice_start(10)`, then `voice_stop`) as `attachments/voice-YYYYMMDD-HHMMSS.ogg` on today's wrap-up, as Build A's `voice_keep('audio')` does, and drops the transcription. An earlier memo of today goes to the recycle bin | Nothing recorded |
| `wrapup_memo_remove()` | `{status}`: today's memo goes to the recycle bin | No memo today |
| `wrapup_get(day=today)` | `{status, wrapup}`: the row, or `null`. `wrapup`: `{id, day, win, win_ref, tidy: [{kind, id, title, action, at, due_date?, task_id?}], note, starters: [{task_id, title}], memo, memo_seconds, snoozed_until, dismissed_at, finished_at, finished, launch_shown_at, launched_at, file, created_at, updated_at}` | Bad day |
| `get_wrapup_file(day=today)` | `{status, file: 'wrapups/YYYY-MM-DD.md', text}`: front matter (`day`, `finished_at`, `memo`), then `## Today's win`, `## Tidy`, `## Note to tomorrow` (with the memo's `![[…]]`) and `## Start with` (`- [ ]` lines) | No wrap-up that day |
| `launchpad_get()` | `{status, launchpad, show}`. `launchpad`: the latest wrap-up finished on an earlier day, with each starter looked up again (`{task_id, title, done, gone, energy, priority, project_id, note_id, minutes}`) and `first`, the first one still open. `minutes` is its first open timed step's, else 25. `show`: the launchpad setting is on and it hasn't been shown yet | — |
| `launchpad_seen(day)` | `{status}`: shown, so not again on its own (Ctrl+K still opens it) | No wrap-up that day |
| `launchpad_launch(day, minutes=null)` | `{status, started, reason, task_id, project_id, minutes, session}`. A planned session on the first open starter, in the task's project, else its note's, else the first project. With a session already going nothing starts: `started: false`, `reason: 'running'` or `'rate'` (stopped, waiting to be logged) | No wrap-up; `code: 'no_task'` (no starter left open); `code: 'no_project'`; minutes not 1–600 |

**Tidy actions** (`wrapup_tidy` and `wrapup_finish`; nothing changes in the dialog until Finish, so Undo is free):

| | Roll to tomorrow (`roll`) | Park in backlog (`park`) | Mark done (`done`) |
|---|---|---|---|
| Task | Due the next day | No due date: it waits in the backlog | Ticked |
| Sticky note | Open, so it's on the screen tomorrow | The card closes; the note stays (sidebar `stickynoted`) | Deleted (its first line stays in the wrap-up's log) |
| Inbox thought | Stays in the inbox | Becomes a task with no due date (a voice thought's `Task:` lines go in its description); the thought is ticked in `_inbox.md` | Ticked in `_inbox.md` |

**When a task or step is ticked:** two nullable columns, `tasks.completed_at` and `task_steps.done_at`, are stamped (local time) by SQLite triggers, so every way of ticking one counts: `update_task`, `toggle_task`, `save_task`, `update_task_step`, `set_task_steps`. Unticking clears them. An update that sets the time itself (a future import) keeps it. Tasks ticked before this build have no time, so they don't count as wins.

**Settings** (`save_settings` checks them):

| Key | Default | Allowed |
|---|---|---|
| `wrapup_reminder` **(Build F)** | `true` | `true` / `false` |
| `wrapup_time` **(Build F)** | `"17:00"` | `"HH:MM"`, 00:00 to 23:59. A time before 04:00 is after midnight, the same evening |
| `wrapup_snooze_minutes` **(Build F)** | `15` | `10`, `15`, `30` |
| `wrapup_launchpad` **(Build F)** | `true` | `true` / `false` |

**The 10-second memo** reuses Build A's recorder and pill: `voice_start(10)`, `voice_poll` (Stop, or `full` after 10 seconds), `voice_stop`, then `wrapup_memo_keep`. It plays in Build A's clip player (`attachment_data`). Memo files count as used, so "Move unused attachments to the recycle bin" leaves them.

**In the page** (`wrapup.js`): the window bar's sunset button and Ctrl+K "Wrap up day" open the dialog; Ctrl+K "Open morning launchpad" opens the latest launchpad; Settings → Daily wrap-up has the four settings and "Start the wrap-up". On the sample vault (a browser, `?check=1`) it all works in memory, as the mockup did.

## Reading & comfort and reading fonts (Build E)

Settings → Reading & comfort is R31's "Cards with presets, a sample inside each card" (locked 2026-10-16), built in `frontend/js/reading.js`. It writes the same keys as before through `save_settings` (theme, `font`, `text_size`, `comfort_*`), plus `font_use`. The spacing presets are values of the existing keys: letter spacing Normal 0 / Wide 0.05 / Wider 0.10 em, word spacing 0 / 0.10 / 0.20 em, line height Snug 1.5 / Normal 1.85 / Loose 2.1, line width Narrow 65 / Medium 80 / Full 95 characters; Custom shows the slider (any value in the ranges above). **Reset to defaults** sends one `save_settings` patch with `theme`, `font`, `text_size`, the eight `comfort_*` reading keys and (through `font_use("")`) `font_use`, all at their `DEFAULT_CONFIG` values; Undo (10 seconds) sends the previous values back. Build G (below) changed Reset: it asks first, and it covers the accent and colour vision too.

More fonts (`fonts.py`): the list is `font_list.json` in the repo. Each entry is `{id, name, by, why, licence, licence_url, source, page, fallback, preview, files: [{file, weight, style?, bytes, sha256, url}]}`; every file is the family's official release on Google Fonts (`google/fonts`, pinned to commit 47d54ca), and an entry with a missing size, checksum or URL is left out. `preview` is a tiny WOFF in `frontend/fonts/previews/` (the sample line and the name only, 4–6 KB), so the list shows each real face before download. Downloaded and added fonts live in `.neurovault/fonts/<id>/` (the files and a `font.json`), next to the database until the vault on disk exists; then the folder moves into the vault. `NEUROVAULT_FONTS` and `NEUROVAULT_FONT_LIST` override the folder and the list (dev and tests); `dev_bridge.py --font-list` does the same. Downloads go into `.downloading/<id>/` and are moved in only after every file's size and sha256 match and its first bytes are a font. Slow work runs in a thread: the page polls `fonts_status()`.

| Call | Returns | Notes |
|---|---|---|
| `fonts_status()` | `{status, fonts, own, use, offline, folder, used_bytes, used_mb}` | `fonts[]`: `{id, name, by, why, licence, licence_url, page, source, bytes, mb, preview, family, stack, installed, download}`; `download` is `null` or `{state: downloading\|checking\|error, done, total, message}`. `own[]`: `{id, name, file (the original file name), bytes, mb, family, stack, own: true}`. `family` is the CSS family the page registers (`nvf-<id>`), `stack` that family with its fallbacks. `offline`: a quick connection to the list's host failed (checked at most every 30 seconds, in the background) |
| `font_download(id)` | `{status}` / `{status: "error", message}` | Starts the download (all of the font's files). Offline: "You're offline: downloads wait until you're back online." A second call while it runs, or for a font that's there, does nothing |
| `font_cancel(id)` | `{status}` | Deletes the part files |
| `font_use(id)` | `{status, use}` | `""` goes back to the built-in font. Saves `font_use` |
| `font_remove(id)` | `{status, freed_bytes, freed_mb, was_in_use}` | Deletes the font's folder; the font in use goes back to the built-in one (`font_use` = `""`) |
| `font_data(id)` | `{status, id, name, family, files: [{weight, style, format, data}]}` | `data` is base64 (the page can't open `file:///` paths); the page makes a `FontFace` from each file |
| `font_add_file()` | `{status, font}` / `{status: "cancelled"}` / `{status: "error", bad, file, message}` | A file picker for .ttf / .otf / .woff2. The file's first bytes and table directory must be a font's (`OTTO`, `00 01 00 00`, `true`, `wOFF`, `wOF2`; a collection isn't taken), under 20 MB; then it's copied in, named from its name table (a WOFF2 from its file name). A bad file: `"<file> couldn't be added: it isn't a font file, or it's damaged."` |

## Accent colours, your own colour and colour vision (Build G)

Settings → Reading & comfort → Theme, from mockup R33 (locked 2026-10-16), built in `frontend/js/accents.js` with the Reset changes in `reading.js`. There are no new bridge calls. It uses the four keys in the reader settings table above through `save_settings`.

- **Accents:** each theme has its own 6–8 accents, 65 in all (`ACCENT_SETS` in `accents.js` and `config.py`, the same ids in the same order; `test_api` checks they match). Picking one saves `accent` with that theme's pick, so each theme keeps its own.
- **The tokens** come from one colour, worked out in the page: `--accent` (the colour), `--accent-bg` (a tint on the card), `--accent-text` (shaded until it's 4.5:1 on the page, card, sidebar and tint), `--on-accent` (white or near-black, whichever reads better) and `--accent-hover`. They're written to one `<style id="nv-accent">`, so they override `tokens.css` on every theme.
- **The contrast targets:** at least 3:1 for the accent against the page, card and sidebar, and 4.5:1 for text on an accent fill and for accent text. All 65 presets pass on their theme. Measured as drawn, the lowest are 3.98, 4.99 and 4.5.
- **Your own colour** (Custom…): a colour box and a hex field. A valid colour applies as you type. It saves `accent_custom`, `accent_custom_theme` (the theme you're on) and `accent` with `"custom"` for every theme, so it follows you.
  - On the theme you chose it on, it's used exactly as typed.
  - On the others, it's used as it is when it passes there. When it doesn't, it's shaded to the nearest passing shade (same hue: darker on light themes, lighter on dark ones).
  - Picking a preset later changes only that theme.
- **The contrast line:** when the accent on the current theme doesn't pass, one line shows under the chips, even with the picker shut. It says "This colour is hard to see on Warm cream." (or "Text on this colour is hard to read on …") and has one button, "Use a darker shade" / "Use a lighter shade", which saves that shade as your colour. With the picker open and a passing colour, it says "Stands out well on …", or "Shaded to #… so it stands out on …". The numbers are in its tooltip.
- **Colour vision** sets `body[data-cvd]`.
  - Red–green and Blue–yellow replace the state tokens (`--success`, `--warning`, `--danger`, `--info`, their `-bg` / `-text`, and `--time-calm/-warm/-low`) with sets that stay apart for that colour vision. There's a light and a dark version of each.
  - They also add a shape to each state: a tick, ! or cross on state chips, voice-check anchors and success / danger alerts; square and diamond save dots; stripes on a time-left bar running low.
  - The voice check's legend says Found / Missing instead of Green / Amber.
  - Off keeps today's look.
- **Reset to defaults** (the page head) asks first, on the page. Cancel is focused. "Reset to defaults" then sends one patch: `theme`, `accent: {}`, `accent_custom: ""`, `accent_custom_theme: ""`, `colour_vision: "off"`, `font`, `text_size` and the eight `comfort_*` keys, plus `font_use("")`. It replaces Build E's "at once, with Undo".
- **A card's Reset** shows in a card's heading only while that card differs from the defaults. It sends the same patch with only that card's keys at their defaults, and offers Undo for 10 seconds in the message above the dialog.

## Popped-out stickies and quick timer, minute sets, check-ins (Build H)

From mockup R34 (locked 2026-10-16), with R39's minute sets and R38's check-in answer. The sticky is **Paper** (the whole note in its colour, dark text on every theme). The quick timer is the **Card**: a big time and two buttons, with its questions inside it. **Pop out** turns either one into its own small, frameless window that stays on top of other apps. It has no taskbar button (`WS_EX_TOOLWINDOW`).

Built in `popout.py` (the windows), `tray.py` (the optional tray), `winframe.py` (`make_popout`, `raise_window`), `frontend/js/popout.js`, `capture.js` (the Paper card) and `render-widgets.js` (the Card).

**How a popped-out window works.** It loads the same page with `#pop=sticky:<id>` or `#pop=timer` and the same `NeuroVaultApi` as its `js_api`. The page draws only the card, which fills the window. The card's head is the window's strip: drag it to move the window, then Keep on top, Back into NeuroVault, (⋮ on a sticky) and close. A sticky resizes from its corner grip. Windows does the moving and sizing (`pop_drag`).

**Keeping windows in step.** Python keeps the windows in a dict. After each change it calls `window.nvSync(msg)` in every window, from a worker thread, so API calls return at once. The messages:

| `msg.kind` | Sent after | Carries |
|---|---|---|
| `timer` | `start_running_session`, `update_running_session` (not `heartbeat`), `finish_running_session`, `discard_running_session`, `timer_hotkey` | `session`: the running session as `get_running_session` gives it, read when sent. `logged`: the session just logged, so each window adds it once |
| `sticky` | `create_sticky`, `update_sticky` | `sticky`. The window where it's being typed ignores it |
| `sticky-gone` | `delete_sticky` | `id`. Its popped-out window closes |
| `popped` | anything that pops out, back in, closes or changes Keep on top | `items` (as `popped()`), `back` (the key that just came back in, if any) and `closed` (the key whose window was just closed, if any) |
| `settings` | `save_settings` (popped-out windows only) | `keys`. They reload the theme, accent and minute sets |

**Which window does what.** The alerts, the 5-minute cue and the check-in come from the window that shows the timer: a popped-out timer's window, or else NeuroVault's own. The hyperfocus nudge stays in NeuroVault's window. A popped-out sticky's ⋮ actions (promote, append, file in a folder, convert to a timed task) run in NeuroVault's window, which has the notes: `pop_relay` raises it and calls `window.nvRelay(act, id)`. The focus sound always plays from NeuroVault's window.

| Call | Returns | Notes |
|---|---|---|
| `pop_out(kind, item_id=None, x=None, y=None, w=None, h=None)` | `{status, popped}` (`already: true` if it was out) | `kind`: `sticky` or `timer`. With no `x`/`y`, it opens at its saved place, or the first time from the top-right corner of NeuroVault's screen, right to left, then a new row. Saves `out` and the place. Without the desktop app (dev bridge) it answers "Popping out needs the desktop app." |
| `pop_in(kind, item_id=None)` | `{status, popped}` | Back into NeuroVault: the window closes, the sticky shows in the app (`open`), and NeuroVault's window comes up |
| `pop_close(kind, item_id=None)` | `{status, popped}` | The strip's close. A sticky stays saved (closed); a running timer keeps going. Closing it from Windows (Alt+F4) does the same |
| `set_on_top(kind, item_id, on)` | `{status, on_top, popped}` | Keep on top, or let other apps cover it. Saved |
| `popped()` | `[{kind, id, key, on_top}]` | What's out now. `key` is `sticky:<id>` or `timer` |
| `pop_show(kind=None, item_id=None)` | `{status}` | Brings one window to the front (all of them with no `kind`). The status bar's Show |
| `pop_all_in()` | `{status, popped}` | Every window back into NeuroVault |
| `pop_drag(kind, item_id, part)` | `bool` | `caption` moves the window, `se` sizes it (`winframe.start_drag`) |
| `pop_fit(kind, item_id, w, h)` | `bool` | The timer's page asks for its card's size, so its questions fit |
| `pop_relay(act, value)` | `{status}` | `sticky-promote`, `sticky-append`, `sticky-attach`, `sticky-task` (raises NeuroVault's window), `sound`, `sound-vol` (doesn't). Anything else is refused |
| `popout_info()` | `{tray}` | Whether closing can keep NeuroVault in the tray (`pystray` installed) |
| `timer_hotkey(action)` | Like `update_running_session` | `pause-toggle` (a "Quick pause", or resume) or `stop`. `main.py`'s global Ctrl+Alt+P / S call it, so every window follows, even with NeuroVault hidden |

**What's saved.** For each sticky: `out`, `on_top`, and its desktop `x`, `y`, `w`, `h` with the screen it's on (`"x,y,w,h"` of that screen). These are `stickies` columns. `list_stickies` and the other sticky calls return `out` and `on_top`; the desktop place stays in Python. For the timer, the same fields are kept in `config.json` as `timer_pop`. Places are logical pixels, as pywebview reports them, and are saved 0.4 s after a move or resize stops. On opening, a saved place is checked against `webview.screens()`. If its screen is gone, it goes the same distance from the main screen's top-right corner. If it's partly off its screen, it's moved back on.

**On launch.** Whatever was out opens again where it was, without taking the keyboard, once NeuroVault's window has loaded.

**Closing NeuroVault** (`window_close`, the window bar's close, after the page has saved):
- With a sticky or the timer popped out and `pystray` installed, NeuroVault's window hides and a tray icon appears, so the popped-out windows stay. It returns `"tray"`. The tray menu has Open NeuroVault, Bring them back into NeuroVault, and Quit NeuroVault.
- Otherwise it quits and returns `true`. Each popped-out window first saves what's typed (`window.nvFlush()`, up to 1.5 s), then everything closes.
- Quit keeps each window's `out`, so it opens again next time.
- Alt+F4 or the taskbar's close on NeuroVault's window go through `closing` the same way.

**Zen mode** leaves popped-out windows alone.

**Settings keys** (through `save_settings`, checked in `config.py`):

| Key | Default | Allowed |
|---|---|---|
| `sticky_new_popped` | `false` | `true` / `false`. Settings → Focus & nudges → Open new stickies popped out |
| `timer_minutes_unplanned` | `[5, 15, 25, 45]` | Four whole numbers of minutes, 1–240, saved sorted. The quick timer's choices |
| `timer_minutes_planned` | `[15, 30, 45, 60]` | The same check. The Timer view's choices |
| `timer_checkin_minutes` | `30` | `0` (off), `15`, `20`, `30`, `45` or `60` |
| `timer_pop` | `{}` | An object: the timer window's `out`, `on_top`, `x`, `y`, `w`, `h`, `screen` (written by `popout.py`) |

Settings → Timer alerts is three cards, like Reading & comfort: Timer minutes (two rows of four boxes, and Back to the defaults once either set differs), Check-ins, and Alerts.

## Tasks page (Build I)

Mockup R35 "Today, Upcoming and Done, each its own card" (locked 2026-10-16), built in `frontend/js/render-tasks.js`, with the data in `store.js` ("BUILD I · TASKS PAGE DATA").

- **Cards:** Overdue (open tasks due before today, oldest first), Today, Upcoming (later dates, then tasks with no date, which read "Later"), and Done (folded until Show). In each card, the earliest due date comes first, then High → Low. The sidebar filters pick the cards: Due today shows Overdue and Today.
- **Due dates** come from `list_tasks`' `due_date` (`t.dueDate` in the store; `t.due`, Today or Upcoming, stays for the sidebar counts and the wrap-up). Quick add has Today, Tomorrow and Later beside a date picker and sends the date to `save_task` (Later sends `null`). Changing a task's date is in its ⋯ menu: the same picks and the picker call `update_task(id, null, null, date)`.
- **Delete** is in the ⋯ menu. It calls `trash_task`, and the status bar shows what went with Undo for 10 seconds, which calls `restore_task`. A task that is a `- [ ]` line in its note takes the line out of the note too (the menu says so: 'Its "- [ ]" line leaves "<note>" too'), and the note saves. Undo puts the line back where it was and saves the note. `delete_task` stays a hard delete: it's how a removed line drops its task.
- **Search inside notes:** `search_notes(query, limit=20)` **new** returns `[{note_id, title, title_match, matches, line, line_no, col}]`, most recently edited first. It matches any case in the title or the saved text (not the `{{tasks}}` line). `line` is the first matching line, trimmed (cut to 160 characters around the match), `line_no` is its 0-based line in the Markdown and `col` is where the match starts in `line`; a title-only match has `line: null`. A query under 2 characters returns `[]`. Ctrl+K asks it 120 ms after the last key on a real vault. Notes with unsaved edits, and the sample vault, are searched in the page. A note matching only in its text shows the line as its sub-text, and Enter opens the note with the words selected in the middle of the page.

## Dictionary and thesaurus with your own words, and the year on Insights (Build J)

From mockup R37 (locked 2026-10-16: "split", the "full" popover, "fit"), built in `dictionary.py`, `frontend/js/dictionary.js` and `frontend/js/year.js`. Every call answers in well under a second, except while the dictionary downloads (the page polls `dict_status()`).

**The data.** `dict_list.json` (in the repo, like `font_list.json`) pins the dictionary file: Open English WordNet 2025 (the user's choice, 2026-10-17), `english-wordnet-2025.xml.gz` from the project's GitHub release, 11,363,503 bytes, with its sha256. This edition moved proper nouns (names of people and places) to a separate resource; the "2025+" file would bring them back. It's licensed CC BY 4.0 and built on Princeton WordNet. The attribution is in the dictionary's footer, and the full WordNet licence is in `frontend/licences/wordnet-licence.txt`.
- The file downloads only when Download is pressed on the page's ask, which names the file, the source and the size. Build B's `local_ai.Download` checks the size and the sha256.
- The download is then read once into a SQLite index at `%LOCALAPPDATA%\NeuroVault\dictionary\<id>.sqlite` (33.9 MB for the 2025 edition: 126,735 words, built in about 5 seconds), and then deleted. The index has words, forms, synsets, senses, antonyms, adjectives' "similar" links and an FTS5 table over the meanings (index version 2; an older index asks for the download again).
- `NEUROVAULT_DICT` overrides the folder and `NEUROVAULT_DICT_LIST` the list. `dev_bridge.py` has `--dict-list` and `--dict-dir`. `dev_dict_sample.py` writes a small sample in the same format.

**Your own words** travel with the vault. They live in `.neurovault/glossary.json`, next to the database until the vault on disk exists (as Build E does for fonts).
- **The file:** `{"format": "neurovault-glossary", "version": 1, "words": [{word, pos, definition, example, tags, added, updated}]}`, sorted A to Z.
- **Writing it:** after each change the whole file is written as UTF-8 to `glossary.json.tmp` and moved over the old one, so it's never half-written.
- **Reading it back:** every call compares the file's size and modified time with the last read. When they differ, it's read again and the `my_words` table (the index, in the database) is rebuilt to match it.
- **A file that can't be read** is never overwritten. The index answers meanwhile, and `glossary_error` says why. The next save moves the bad file aside as `glossary.unreadable-<date>.json`.
- **A missing file**, while the index still has words, is written again from the index.

| Call | Returns | Notes |
|---|---|---|
| `dict_status()` | `{status, state, dictionary, offline, words, mine, job, glossary, glossary_error, folder, size_bytes}` | `state`: `none` (the ask), `downloading`, `building`, `failed`, `ready`. `dictionary`: the list entry (name, file, url, bytes, disk_mb, words, licence, source, attribution). `job`: `{done, total, fraction, message, kind}`; `kind` is `offline`, `checksum`, `server` or `build`. `offline` comes from one quick connection to the download host, trusted for 30 s |
| `dict_download()` | `dict_status()` | Starts the download, then the build. Call it only after the page's ask |
| `dict_cancel()` | `dict_status()` + `message` | Stops the download or the build. The part file and any half-built index are deleted |
| `dict_dismiss()` | `dict_status()` | After a failure: back to the ask |
| `dict_search(q, scope)` | `{status, q, exact, prefix, close, in_defs, via, shown, guessed}` | `scope`: `all` or `mine`. Rows are `{key, word, pos[], def, mine}`; your word's meaning wins on a word WordNet also has. `prefix` is ordered by most meanings first, then the shorter word. `close` holds misspellings (edit distance 1, or 2 past six letters, with a swapped pair counting once) and sound-alike skeletons. `in_defs` holds words whose meanings mention it (FTS5). `via` is the inflected word typed ("consolidated"), when `exact` is its dictionary form. `shown` is the full entry the page shows; `guessed` is true when that's the closest spelling |
| `dict_lookup(word)` | `{status, entry}` | `entry`: `{key, word, syl, pos[], senses: [{pos, def, examples}], syn, ant, sounds: [{word, def}], mine, wordnet}`, or `null`. Syllables come from spelling rules, because WordNet has none. Similar words follow the word's own meanings, then adjectives' "similar" links. Sound-alikes come from a list of common homophones and words that are easily mixed up. A small word WordNet leaves out (their, the, which) that is on that list gets an entry with only its sound-alikes, never a far-off guess |
| `dict_spell(word, note_id=None)` | `{status, word, known, suggestions: [{word, mine, d}], checked, ignored?}` | **Fix A:** for the note's right-click menu, with `engine` (windows: Windows' Spell Checking API, en-GB, through ctypes in winspell.py; wordnet where it isn't there). `known`: WordNet has the word or a form of it, it's one of your words (or a form of one), a small word WordNet leaves out, a number or a short all-capitals form, or the note ignores it (`spell_ignore`). Otherwise up to 5 close spellings (edit distance, sound-alikes, a wrong first letter; ties to the commoner word), in the case typed. `checked` is false before WordNet is here: then only your words are checked, and with none nothing is called wrong |
| `spell_words(words, note_id=None)` | `{status, wrong: [words], engine}` | **Fix A:** Check spelling (F7): which of a note's words aren't known, the same rules as `dict_spell`, without suggestions; up to 3000 different words |
| `autocorrect_word(word, note_id=None)` | `{status, word, to, why}` | **Fix A:** autocorrect as you type. `to` only when it's clear: Windows' own pairs (teh → the), else one suggestion one slip away (`autocorrect_strength` obvious) or two (more) with no rival as close, not a split word or (obvious) a name. Never your words, `autocorrect_never`, the note's ignored words, all capitals or a capital or digit inside |
| `dict_words()` | `{status, words}` | Your words, A to Z: `{key, word, pos, definition, example, tags, added, updated}` |
| `dict_word_save(data, old_key)` | `{status, word}` or `{status: 'error', message, field}` | Adds (`old_key` null) or edits; an edit keeps the added date. `pos` is noun, verb, adjective, adverb or other. Tags are up to 12 words. `field` names the box: `word`, `def`, `ex`, `tags` or `pos`. A word you already have is refused ("Edit that one instead") |
| `dict_word_delete(key)` | `{status}` | |
| `get_year_heatmap(which)` | `{which, from, to, today, days, totals, years, steps}` | `which`: `"past"` (the 365 days to today, like GitHub) or a calendar year; anything else means `"past"`. `days`: `{date, total_seconds, sessions, level, future?}`. `level` uses the fixed steps: 0 none, then 1 under 30 min, 2 for 30 min–1 h, 3 for 1–2 h, 4 for 2 h or more. `totals`: `{total_seconds, sessions, active_days, days_so_far, longest_run, best_day}`. `years`: `["past", …calendar years with sessions, and this year]` |

`db.get_heatmap(weeks=12, start=None, end=None)` now takes a date range too, and each day carries `sessions` and `level`. `get_insights().heatmap` keeps its 12 weeks.

**Settings** (through `save_settings`):
- `dict_read`: `word` or `meanings` (the default). It decides what Read aloud says in the dictionary and the popover: the word only, or the word followed by its meanings. It's set in Settings → Voice.
- `dict_recent`: up to 12 recent lookups, newest first.
- `spell_ignore` (**Fix A**): `{note id: [words]}`, what "Ignore in this note" keeps (lower case, up to 500 words a note).
- `autocorrect` (on, default true), `autocorrect_strength` (`obvious` | `more`), `autocorrect_never` (up to 500 words, lower case) (**Fix A**): Settings → Editor → Autocorrect.
- `spell_where` (`everywhere` | `notes`, default `everywhere`) (**Fix A, QC 4 · 30**): Settings → Editor → "Spelling and autocorrect work in". Everywhere you write: notes, the Brain Dump, sticky notes, task names, Timer and Timeline notes, the wrap-up, your word's meaning; notes: notes and their titles. The page applies it to the red line, the right-click suggestions, Check spelling and autocorrect (in a field, `autocorrect_word` and `dict_spell` are called with no `note_id`).

## PDF and Word files to Markdown notes, and attaching a file (Build K)

`converters.py` turns a PDF or a Word `.docx` into Markdown; `pdf_layout.py` lays out a PDF's words (pdfplumber). Pictures are saved in `attachments/` (Build A's folder) as `<file-stem>-img<N>.<ext>` and embedded on a line of their own as `![[attachments/…]]`. A conversion runs as a background job: start it, then poll.

| Call | Returns | Notes |
|---|---|---|
| `convert_file(path, mode="new_note", folder_id=None)` | `{status, job}` | `mode`: `new_note` (a new note named after the file's title, in `folder_id` or Unsorted) or `into_note:<id>` (added to the end of that note after a blank line). Refused at once (no job) for a missing file, a file that isn't `.pdf` / `.docx`, a bad mode, or an unknown note or folder |
| `convert_job(job)` | `{status, id, state, done, total, label, result, message}` | `state`: `running` \| `done` \| `error` \| `cancelled`. While a PDF runs, `label` is "Page 3 of 12" (`done` / `total` pages). `result`: `{note_id, title, created, updated_at, warnings: [text], images: [{file, name, size}], tables: [{file, name, size, rows, cols}], pages, scan}`, so the page can say "3 images and 2 tables added to Attachments". A scan (no text) makes no note: `note_id` is `null`, `scan` is `true`, `warnings` is `["This PDF is a scan: no text to convert."]`. A broken or locked file ends in `error` with a message in plain words |
| `convert_cancel(job)` | `{status}` | Stops at the next page. Nothing is saved, and the job's pictures are removed |
| `convert_status()` | `{pdf, docx, drop_office_default}` | `pdf`: pdfplumber is installed. `docx` is always `true` (the standard library reads it) |
| `attach_file(path, note_id=None)` | `{status, file, note_id, created, updated_at}` | Copies the file into `attachments/` under its own name (made safe; `-2` when taken) and puts `![[attachments/<name>]]` at the end of the note. No `note_id` (or `"new"`): a new note named after the file holds it |
| `browse_convert_file()` | A path, or `null` | The Open dialog for PDF and Word files (Ctrl+K → Convert PDF to Markdown) |

The note is saved through `save_note`, so the page loads it with `get_note`, then treats it as any other note: a new one goes through `primeOne` (its `- [ ]` lines become tasks), one converted into goes through `syncLineTasks`. `frontend/js/convert.js` has `convertStart(path, mode, folderId)`, which does all of that, for the R47 drop question to call.

**Pictures and tables in the Attachments tab.** The tab lists a note's files by the `![[attachments/…]]` in its text (`noteEmbeds` in the page, `attachments.embeds` here), so everything a conversion adds shows there with no extra step:
- each picture is embedded where it was: `![[attachments/<file-stem>-img<N>.<ext>]]`;
- each table stays in the note as a Markdown table, and is also saved as `attachments/<note> table <N>.csv` (UTF-8 with a BOM, so Excel opens it). The note links it with a hidden line under the table, `<!-- ![[attachments/<note> table <N>.csv]] -->`. The editor doesn't show an HTML comment and keeps it as written. `<note>` is the converted title, or the target note's title for `into_note`;
- Remove in the tab takes out the picture's line, or the CSV's hidden line (`attachments.remove_embed`, and `removeEmbed` in voice-attach.js).

**Setting:** `drop_office_default`: `ask` (default) \| `attach` (to this note) \| `attach_new` (to a new note) \| `convert`. Saved through `save_settings`; anything else is listed in `rejected`.

**Kept:** headings (Word styles; a PDF's bigger text sizes, biggest = `#`, and short bold lines), paragraphs, **bold**, *italic*, ~~strike~~ (Word), `monospace` as code, bullet and numbered lists with nesting, tables (Word tables; a PDF's ruled tables), links, pictures, ☐ / ☑ lines as `- [ ]` / `- [x]` tasks, and for a PDF a `---` between pages, columns read in order, running headers / footers and page numbers dropped, words split by a line-end hyphen joined. A first heading that only repeats the title is left out (the title shows above the note). Markdown characters in the text are escaped, and `#word` too, so text never turns into a tag.

## Window

The window is frameless (`main.py`), so the front end draws its own bar and calls these (Phase 1).

| Call | Returns | Notes |
|---|---|---|
| `window_minimize()` | `bool` | `false` before the window exists |
| `window_toggle_maximize()` | The new state, `bool` | Maximises to the screen's work area (not over the taskbar), or restores |
| `window_is_maximized()` | `bool` | Asked on launch |
| `window_close()` | `true`, or `"tray"` | Build H: with a sticky or the timer popped out and `pystray` installed, the window hides to the tray instead (see above) |
| `window_start_drag(part)` | `bool` | `part` is `caption` (move the window: snap, drag down from maximised) or an edge or corner (`n`, `s`, `e`, `w`, `nw`, `ne`, `sw`, `se`) to resize. Windows runs the move or resize loop until the button is released. Resizing is refused while maximised |

When Windows maximises or restores the window itself (Win+Up, snapping), `main.py` calls `window.nvWindowState(true|false)` in the page, so the bar's Maximise / Restore button follows.

## The vault on disk (Build V)

Notes are plain .md files in the vault folder (`config.json` → `vault_path`). The notes table stays the index (ids, tags,
projects, task links, versions); `vault_disk.py` has the file rules. A note is `<vault>/<project>/<folder>/…/<Title>.md`;
a project is a top-level folder; "Unsorted" is the vault's top. Front matter is kept as it was, with the tags written into
its `tags:` list. A file is written only when its note is saved with a change; deleting sends it to the Recycle Bin.
`attachments/` and `.neurovault/` (fonts, your own words) live in the vault once there is one. Sticky Notes are written to
`stickynoted/<file>.md` and Brain Dump to `_inbox.md`. Without a vault the note calls work on the database as before.

| Call | Returns | Notes |
|---|---|---|
| `vault_state()` | `{status, path, exists, default, documents, legacy_notes}` | `path` is "" until one is picked; `legacy_notes` counts notes that are only in the database |
| `vault_create(name="NeuroVault", parent=None)` | `{status, path, notes, copied, written, found, files_copied, backup, created}` | `<parent or Documents>\<name>`, made if missing. The first vault takes the database's notes: a backup (`backup`), then each note is written out (`copied`); nothing is deleted |
| `vault_open(path)` | as `vault_create` | Any folder; an Obsidian vault's files are read, not moved or changed. Refused: a drive's root, NeuroVault's own folder, a folder that isn't there |
| `vault_choose()` | as `vault_open`, or `{status: "cancelled"}` | The folder dialog, then `vault_open` |
| `vault_poll()` | `{status, changed, added, removed, folders, missing}` | The page calls it every 4 s and on focus: writes notes whose file is behind, then reads the folder. `changed` / `added` / `removed` are note ids; `folders` is true when the tree's folders changed; `missing` when the folder isn't there (edits wait in the database) |
| `vault_reveal()` | `{status}` | Shows the vault folder in File Explorer |

`get_note` / `list_notes` also return `path` (the file inside the vault). A file changed outside NeuroVault is read back
and kept as a version; when NeuroVault saves over an outside change it hasn't read yet, the outside text is kept as a
version with reason `outside` ("Changed outside NeuroVault"). `setup_skip` on a first run also makes the default vault.

## Database changes behind this (db.py)

Each change is an idempotent migration that runs every time the app opens the database:

- New tables: `folders`, `task_steps`, `running_session` (one row) and `app_meta` (records the one-time migrations).
- Phase 6A: new tables `stickies` and `inbox_items` (`CAPTURE_SCHEMA`). They are only created, so opening an older database needs no backup.
- Build H: seven columns on `stickies` (`STICKY_POP_COLUMNS`): `out` (default 0), `on_top` (default 1), `desk_x`, `desk_y`, `desk_w`, `desk_h`, `desk_screen`. Old rows keep the defaults, so no backup is needed.
- Build F: a new table `wrapups` (`WRAPUP_SCHEMA`), two nullable columns `tasks.completed_at` and `task_steps.done_at`, and four triggers that stamp them. Old rows are untouched (`NULL`), so no backup is needed.
- Build I: a new table `task_bin` (`TASK_BIN_SCHEMA`): `{id, task_id, title, data (JSON: task, steps, tags, running), deleted_at}`. Only created, so no backup.
- Build V: nullable columns `notes.vault`, `path`, `file_mtime`, `file_size`, `front_matter`, `file_fmt`, `synced_at` and `folders.vault`, and a trigger (`notes_file_behind`) that clears `synced_at` when a note's title, text or place changes. Adding them needs no backup; the first vault backs the database up (`<db>.<time>.pre-vault.bak`) before it writes the notes out.
- New columns:
  - `notes.folder_id`;
  - `tasks.note_id`;
  - `tasks.energy`, which defaults to `medium`;
  - `projects.color_slot`.
- **Before any change, the database file is backed up** to `<file>.<YYYYmmdd-HHMMSS>.pre-folders.bak`. This only happens if the database has data and something is still to migrate.
- **Existing notes are placed in folders once.** Each (project, category) pair becomes a folder at that project's root:
  - The folder name is the category without its leading `#`.
  - Characters a folder name can't contain become `-`.
  - Notes with no project, or a blank category, go in the top-level **Unsorted** folder.
  - A note's `project_id` is left as it was.
- **Colour slots:** each project gets the slot nearest its old hex colour, checked against the dark and light theme slot colours. A project with no colour gets the least-used slot. Projects that already have a slot are never changed.

## Build N · R69: speaking a question in Ask, the Agent and the floating window

Its own `voice.Session` (the voice ramble's keeps its state), the same Whisper model and microphone (`voice_stt_model`, `voice_mic`), or Groq's Whisper (`cloud_providers.json`: `stt_url`, `stt_model`, `stt_name`) after a key AND `ask_voice_cloud_seen`. The page (`frontend/js/ask-voice.js`) sends the words to the chat's `aicAsk` the moment they come back, so the Agent and the floating window need nothing more.

| Method | Returns | Notes |
|---|---|---|
| `ask_voice_status()` | `{status, start, where, model, mic_ok, mic_error, test_wav, cloud: {id, name, model, has_key, seen} \| null, stage, download}` | What the mic and Settings → Voice show |
| `ask_voice_start()` | `{status, where, max_seconds: 120}` | Errors carry `code`: `nomic` (no microphone), `nomodel` (this PC's speech model isn't there), `nokey` (the cloud chosen, no key), `first` (no yes yet: nothing is recorded), `busy` (a voice ramble is recording) |
| `ask_voice_poll()` | recording: `{stage, seconds, level, bars (24), words (live tail or null), heard, quiet (seconds since the last loud moment), full}`; transcribing; done: `{result: {text, seconds}}`; error: `{message, code: nothing \| key \| limit \| error}` | `quiet` ≥ 1.5 after `heard` is what "stops by itself" waits for. 100 ms is fine |
| `ask_voice_stop()` | `{status}` | Plain words (voice.clean_whisper), no tidy-up or tasks. The cloud call is made here, with the recording only (a 16 kHz mono .wav); it refuses with `code: first` when the yes or the key is gone. Silence is never uploaded |
| `ask_voice_discard()` | `{status}` | Esc: nothing is kept |
| `ask_voice_cloud_yes(yes=True)` | `{status, seen, where}` | Yes records today's date and sets `ask_voice_where` to `cloud`; anything else clears the yes |
| `open_mic_settings()` | `{status}` | "Microphone settings" on the no-microphone card: Windows Settings → Privacy → Microphone |
