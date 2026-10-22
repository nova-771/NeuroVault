"""
db.py — persistence layer for the merged NeuroVault app.

Plain sqlite3 (no ORM). Projects/Notes/Tasks/Tags is the original
NeuroVault data model (Project / Task / Note / Tag with M2M tags).
Sessions/Pauses/Milestones is time-tracker's session-logging model,
merged in so a Project doubles as a time-tracking category: any project
can have sessions logged against it, and a project with no sessions is
just a plain notes/tasks bucket.

A single sqlite3.Connection is shared across the whole app (pywebview's
JS bridge can call in off the main thread while bottle serves frontend
assets on another), so every access — reads included — goes through one
lock rather than relying on sqlite3's check_same_thread=False alone,
which disables the thread check but does not make concurrent use of one
connection object safe.
"""

import logging
import re
import sqlite3
import threading
from datetime import date, datetime, timedelta, timezone  # Build J: date
from collections import Counter

log = logging.getLogger(__name__)


def utc_now_iso():
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


# ---- Build J · the year heatmap's fixed steps (R37): under 30 min, 30 min–1 h, 1–2 h, 2 h or more ----
HEAT_STEPS = (1800, 3600, 7200)


def heat_level(seconds):
    """0 for no focus, then 1–4 by the fixed steps. A square both fills and darkens with its level."""
    if not seconds:
        return 0
    return 1 + sum(seconds >= s for s in HEAT_STEPS)


def _as_date(v):
    return v if isinstance(v, date) else datetime.strptime(str(v)[:10], "%Y-%m-%d").date()
# ---- end Build J ----


# Palette used to auto-assign a color to a new project when one isn't given
# explicitly (e.g. the timer view's inline "+ Add" category flow).
PALETTE = ["#34e0e0", "#f5b45a", "#8b7cf6", "#6fd1ff", "#7ee787", "#ff7eb6"]

SCHEMA = """
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS projects (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT NOT NULL,
    description TEXT,
    color       TEXT,
    icon        TEXT,
    archived    INTEGER NOT NULL DEFAULT 0,
    created_at  TEXT NOT NULL,
    updated_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS notes (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    title       TEXT NOT NULL,
    content     TEXT,
    category    TEXT,
    project_id  INTEGER REFERENCES projects(id) ON DELETE SET NULL,
    created_at  TEXT NOT NULL,
    updated_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS tasks (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    title       TEXT NOT NULL,
    description TEXT,
    completed   INTEGER NOT NULL DEFAULT 0,
    priority    TEXT NOT NULL DEFAULT 'Medium',
    due_date    TEXT,
    project_id  INTEGER REFERENCES projects(id) ON DELETE SET NULL,
    created_at  TEXT NOT NULL,
    updated_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS tags (
    id    INTEGER PRIMARY KEY AUTOINCREMENT,
    name  TEXT NOT NULL UNIQUE COLLATE NOCASE,
    color TEXT
);

CREATE TABLE IF NOT EXISTS note_tags (
    note_id INTEGER NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
    tag_id  INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
    PRIMARY KEY (note_id, tag_id)
);

CREATE TABLE IF NOT EXISTS task_tags (
    task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    tag_id  INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
    PRIMARY KEY (task_id, tag_id)
);

CREATE TABLE IF NOT EXISTS sessions (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id       INTEGER REFERENCES projects(id) ON DELETE SET NULL,
    start_time       TEXT NOT NULL,
    end_time         TEXT NOT NULL,
    target_seconds   INTEGER NOT NULL,
    actual_seconds   INTEGER NOT NULL,
    overtime_seconds INTEGER NOT NULL DEFAULT 0,
    energy           INTEGER,
    focus            INTEGER,
    is_unplanned     INTEGER NOT NULL DEFAULT 0,
    created_at       TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS pauses (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id       INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    category         TEXT NOT NULL,
    start_time       TEXT NOT NULL,
    end_time         TEXT NOT NULL,
    duration_seconds INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS milestones (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id       INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    note             TEXT NOT NULL,
    at_time          TEXT NOT NULL,
    elapsed_seconds  INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_notes_project ON notes(project_id);
CREATE INDEX IF NOT EXISTS idx_tasks_project ON tasks(project_id);
CREATE INDEX IF NOT EXISTS idx_sessions_project ON sessions(project_id);
CREATE INDEX IF NOT EXISTS idx_pauses_session ON pauses(session_id);
CREATE INDEX IF NOT EXISTS idx_milestones_session ON milestones(session_id);

-- New front end (build plan R20). A folder with a parent_id sits inside that
-- folder; one with only a project_id sits at that project's root; one with
-- neither is a top-level folder (e.g. "Unsorted"). project_id is kept equal
-- to the project of the folder's top ancestor.
CREATE TABLE IF NOT EXISTS folders (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT NOT NULL,
    parent_id   INTEGER REFERENCES folders(id) ON DELETE CASCADE,
    project_id  INTEGER REFERENCES projects(id) ON DELETE SET NULL,
    created_at  TEXT NOT NULL,
    updated_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS task_steps (
    id       INTEGER PRIMARY KEY AUTOINCREMENT,
    task_id  INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    text     TEXT NOT NULL,
    minutes  INTEGER,
    done     INTEGER NOT NULL DEFAULT 0,
    position INTEGER NOT NULL DEFAULT 0
);

-- At most one timer session in progress (id is always 1). Times are local
-- ISO strings like the sessions table; pauses and milestones are JSON lists
-- in log_session's shape so finishing hands them straight over.
CREATE TABLE IF NOT EXISTS running_session (
    id              INTEGER PRIMARY KEY CHECK (id = 1),
    project_id      INTEGER REFERENCES projects(id) ON DELETE SET NULL,
    task_id         INTEGER REFERENCES tasks(id) ON DELETE SET NULL,
    mode            TEXT NOT NULL DEFAULT 'planned',
    target_seconds  INTEGER NOT NULL DEFAULT 0,
    started_at      TEXT NOT NULL,
    paused_at       TEXT,
    pause_reason    TEXT,
    stopped_at      TEXT,
    pauses          TEXT NOT NULL DEFAULT '[]',
    milestones      TEXT NOT NULL DEFAULT '[]',
    last_seen_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS app_meta (
    key   TEXT PRIMARY KEY,
    value TEXT
);

CREATE INDEX IF NOT EXISTS idx_folders_parent ON folders(parent_id);
CREATE INDEX IF NOT EXISTS idx_folders_project ON folders(project_id);
CREATE INDEX IF NOT EXISTS idx_task_steps_task ON task_steps(task_id);
"""

# Columns added to existing tables after the first release. Each is added
# only if missing, so opening any older database brings it up to date.
ADDED_COLUMNS = [
    ("notes", "folder_id", "INTEGER REFERENCES folders(id) ON DELETE SET NULL"),
    ("tasks", "note_id", "INTEGER REFERENCES notes(id) ON DELETE SET NULL"),
    ("tasks", "energy", "TEXT NOT NULL DEFAULT 'medium'"),
    ("projects", "color_slot", "INTEGER"),
]

ENERGY_LEVELS = ("high", "medium", "low")
UNSORTED_FOLDER = "Unsorted"
BAD_NAME_CHARS = set('\\/:*?"<>|')

# The six project colour slots, as the mockup's dark and light themes draw
# them (slot n = index n-1): teal, amber, violet, blue, green, pink.
SLOT_HEX = [
    ["#2dd4bf", "#0d7c72"], ["#fbbf24", "#b45309"], ["#a29bfe", "#4839e8"],
    ["#7aa7ff", "#1f5fd6"], ["#4ade80", "#15803d"], ["#f472b6", "#be185d"],
]


def nearest_slot(hex_color):
    """Colour slot 1-6 nearest to a '#rrggbb' colour, or None if it can't be read."""
    def rgb(h):
        h = h.strip().lstrip("#")
        if len(h) == 3:
            h = "".join(c * 2 for c in h)
        return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))
    try:
        c = rgb(hex_color or "")
    except ValueError:
        return None
    best, best_d = None, None
    for slot, refs in enumerate(SLOT_HEX, start=1):
        for ref in refs:
            d = sum((a - b) ** 2 for a, b in zip(c, rgb(ref)))
            if best_d is None or d < best_d:
                best, best_d = slot, d
    return best


def folder_name_error(name):
    """Error message for an unusable folder name, or None if it's fine."""
    if not name:
        return "Folder name can't be empty."
    bad = sorted(set(name) & BAD_NAME_CHARS)
    if bad:
        return "Folder names can't contain " + " ".join(bad) + "."
    if name in (".", ".."):
        return "Folder name can't be . or .."
    return None


def category_folder_name(category):
    """Folder name for an old note category: '#Meetings' -> 'Meetings'.
    Characters a folder can't hold become '-'. '' means no category."""
    name = (category or "").strip().lstrip("#").strip()
    return "".join("-" if ch in BAD_NAME_CHARS else ch for ch in name).strip(" .")


# ==== Phase 6A · sticky notes and the brain dump inbox ======================
# Kept in SQLite until the vault on disk exists. Each table is shaped like its
# future file, so that build can write them out unchanged:
#   a sticky -> stickynoted/<file_name> (front matter: n, color, open, x, y, w, h, created)
#   the inbox -> _inbox.md (one "## YYYY-MM-DD" heading per day, one "- HH:MM text" line per thought)
# Times are local, without a zone (like the sessions table), because the file
# names and the inbox's day headings are local.
CAPTURE_SCHEMA = """
CREATE TABLE IF NOT EXISTS stickies (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    n           INTEGER NOT NULL,
    text        TEXT NOT NULL DEFAULT '',
    color       TEXT NOT NULL DEFAULT 'yellow',
    open        INTEGER NOT NULL DEFAULT 1,
    x           INTEGER,
    y           INTEGER,
    w           INTEGER,
    h           INTEGER,
    file_name   TEXT NOT NULL UNIQUE,
    created_at  TEXT NOT NULL,
    updated_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS inbox_items (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    text        TEXT NOT NULL,
    done        INTEGER NOT NULL DEFAULT 0,
    created_at  TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_inbox_created ON inbox_items(created_at);
"""

STICKY_COLOURS = ("yellow", "pink", "mint", "blue", "lilac")


def sticky_file_text(sticky):
    """A sticky as its future stickynoted/ file: front matter, then the text."""
    keys = ("n", "color", "open", "x", "y", "w", "h")
    lines = [f"{k}: {'true' if sticky[k] else 'false'}" if k == "open" else f"{k}: {sticky[k]}"
             for k in keys if sticky.get(k) is not None]
    return "---\n" + "\n".join(lines + [f"created: {sticky['created_at']}"]) + "\n---\n" + (sticky.get("text") or "")


def inbox_markdown(items):
    """The inbox as its future _inbox.md, oldest day first. Done thoughts keep their line, ticked."""
    out, day = ["# Inbox"], None
    for it in sorted(items, key=lambda x: (x["created_at"], x["id"])):
        if it["created_at"][:10] != day:
            day = it["created_at"][:10]
            out += ["", f"## {day}"]
        text = " ".join((it["text"] or "").split())
        out.append(f"- {'[x] ' if it['done'] else ''}{it['created_at'][11:16]} {text}".rstrip())
        # Build A: a voice thought's clip on the line under it (an Obsidian embed), then its tasks, sorted at the wrap-up
        if it.get("audio"):
            out.append(f"  ![[{it['audio']}]]")
        out += [f"  - Task: {' '.join(str(t).split())}" for t in (it.get("tasks") or [])]   # thoughts saved before Build A+
        n = len(it.get("task_ids") or [])   # Build A+: ticked tasks went to the Tasks board; one line says so
        if n:
            out.append(f"  {n} task{'' if n == 1 else 's'} added to Tasks")
    return "\n".join(out) + "\n"
# ==== end Phase 6A ===========================================================

# ==== Build A · voice thoughts in the inbox: the clip they carry ("attachments/…") and their tasks (a JSON list) ====
INBOX_VOICE_COLUMNS = (("audio", "TEXT"), ("tasks", "TEXT"),
                       ("task_ids", "TEXT"))   # Build A+ (voice tasks): the Tasks-board tasks a thought's ticked tasks became (JSON ids)
# ==== end Build A ============================================================

# ==== Build H · sticky notes popped out of the app (mockup R34) =============
# Per sticky: whether it's popped out as its own desktop window, whether that window keeps on top of other
# apps, and its place on the desktop (logical pixels, as pywebview reports them) with the screen it was on
# ("x,y,w,h" of that screen), so it opens there again. Nullable columns only: old rows are untouched.
STICKY_POP_COLUMNS = (("out", "INTEGER NOT NULL DEFAULT 0"), ("on_top", "INTEGER NOT NULL DEFAULT 1"),
                      ("desk_x", "INTEGER"), ("desk_y", "INTEGER"), ("desk_w", "INTEGER"), ("desk_h", "INTEGER"),
                      ("desk_screen", "TEXT"))
# ==== end Build H ============================================================

# ==== Build F · the end-of-day wrap-up and the morning launchpad ============
# One row per day wrapped up. Shaped like its future file, wrapups/YYYY-MM-DD.md (wrapup_markdown), so the
# vault-on-disk build can write it out unchanged. Times are local without a zone, like the 6A tables.
# A "day" turns over at 04:00 (WRAP_DAY_HOUR), so a wrap-up at 00:30 still belongs to the evening before.
# The launchpad state (shown, launched) lives on the row it comes from.
WRAP_DAY_HOUR = 4
WRAPUP_SCHEMA = """
CREATE TABLE IF NOT EXISTS wrapups (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    day             TEXT NOT NULL UNIQUE,          -- YYYY-MM-DD: the day being wrapped up
    win             TEXT NOT NULL DEFAULT '',      -- the win picked from the list, or typed
    win_ref         TEXT,                          -- task:<id> | step:<id> | project:<id>; NULL when typed
    tidy            TEXT NOT NULL DEFAULT '[]',    -- JSON [{kind, id, title, action, at}]
    note            TEXT NOT NULL DEFAULT '',      -- the note to tomorrow-you
    starters        TEXT NOT NULL DEFAULT '[]',    -- JSON [{task_id, title}], 1 to 3
    memo            TEXT,                          -- attachments/voice-….ogg (the 10-second memo)
    memo_seconds    REAL,
    snoozed_until   TEXT,                          -- the reminder waits until then
    dismissed_at    TEXT,                          -- the reminder was closed: not again that day
    finished_at     TEXT,                          -- Finish the day
    launch_shown_at TEXT,                          -- the launchpad showed (once, on a later day)
    launched_at     TEXT,                          -- Launch first task and timer
    created_at      TEXT NOT NULL,
    updated_at      TEXT NOT NULL
);

-- When a task or step is ticked (stamped by these triggers, so every way of ticking one counts): the wins query.
-- An UPDATE that sets the time itself (an import) keeps it.
CREATE TRIGGER IF NOT EXISTS wrapup_task_done AFTER UPDATE OF completed ON tasks
WHEN NEW.completed IS NOT OLD.completed AND NEW.completed_at IS OLD.completed_at
BEGIN UPDATE tasks SET completed_at = CASE WHEN NEW.completed THEN strftime('%Y-%m-%dT%H:%M:%S', 'now', 'localtime') END WHERE id = NEW.id; END;
CREATE TRIGGER IF NOT EXISTS wrapup_task_done_new AFTER INSERT ON tasks WHEN NEW.completed AND NEW.completed_at IS NULL
BEGIN UPDATE tasks SET completed_at = strftime('%Y-%m-%dT%H:%M:%S', 'now', 'localtime') WHERE id = NEW.id; END;
CREATE TRIGGER IF NOT EXISTS wrapup_step_done AFTER UPDATE OF done ON task_steps
WHEN NEW.done IS NOT OLD.done AND NEW.done_at IS OLD.done_at
BEGIN UPDATE task_steps SET done_at = CASE WHEN NEW.done THEN strftime('%Y-%m-%dT%H:%M:%S', 'now', 'localtime') END WHERE id = NEW.id; END;
CREATE TRIGGER IF NOT EXISTS wrapup_step_done_new AFTER INSERT ON task_steps WHEN NEW.done AND NEW.done_at IS NULL
BEGIN UPDATE task_steps SET done_at = strftime('%Y-%m-%dT%H:%M:%S', 'now', 'localtime') WHERE id = NEW.id; END;
"""
# Two nullable columns on existing tables: old rows stay as they are (NULL = ticked before this build), so no backup
WRAPUP_DONE_COLUMNS = (("tasks", "completed_at", "TEXT"), ("task_steps", "done_at", "TEXT"))
TIDY_ACTIONS = ("roll", "park", "done")
TIDY_KINDS = ("task", "sticky", "inbox")


def init_wrapups(conn, columns):
    """The wrapups table, the done-time columns and their triggers. columns(table) -> set of column names."""
    for table, column, decl in WRAPUP_DONE_COLUMNS:
        if column not in columns(table):
            conn.execute(f"ALTER TABLE {table} ADD COLUMN {column} {decl}")
    conn.executescript(WRAPUP_SCHEMA)


def wrapup_markdown(w):
    """A wrap-up as its future wrapups/YYYY-MM-DD.md: front matter, then the win, the tidy, the note and the starters."""
    front = [f"day: {w['day']}"] + [f"{k}: {w[k]}" for k in ("finished_at", "memo") if w.get(k)]
    out = ["---", *front, "---", f"# Wrap-up · {w['day']}"]
    if w.get("win"):
        out += ["", "## Today's win", w["win"]]
    if w.get("tidy"):
        verb = {"roll": "Rolled to tomorrow", "park": "Parked", "done": "Done"}
        out += ["", "## Tidy"] + [f"- {verb.get(t['action'], t['action'])}: {' '.join(str(t.get('title') or '').split())} ({t['kind']})"
                                  for t in w["tidy"]]
    if w.get("note") or w.get("memo"):
        out += ["", "## Note to tomorrow"] + ([w["note"]] if w.get("note") else []) + ([f"![[{w['memo']}]]"] if w.get("memo") else [])
    if w.get("starters"):
        out += ["", "## Start with"] + [f"- [ ] {' '.join(str(s.get('title') or '').split())}" for s in w["starters"]]
    return "\n".join(out) + "\n"
# ==== end Build F ============================================================

# ==== Build I · the Tasks page: a deleted task waits in the bin, so Delete can be undone =====
# Delete on the Tasks board moves the task (with its steps and tags, as JSON) into task_bin and removes it from
# tasks, so no other query has to skip deleted rows. restore_task puts it back under its old id (tasks.id is
# AUTOINCREMENT, so a deleted id is never handed to a new task). Rows older than TASK_BIN_DAYS are purged.
TASK_BIN_DAYS = 30
TASK_BIN_SCHEMA = """
CREATE TABLE IF NOT EXISTS task_bin (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    task_id     INTEGER NOT NULL,              -- the id it had, and gets back
    title       TEXT NOT NULL,
    data        TEXT NOT NULL,                 -- JSON {task, steps, tags, running}
    deleted_at  TEXT NOT NULL                  -- UTC ISO, like updated_at
);
"""
# ==== end Build I ============================================================

# ==== Build M · note history: every save keeps a version (mockup R42, locked 2026-10-17) =====================
# One row per kept version of a note's text. While you type, saves within NOTE_VERSION_WINDOW_MIN of a version's first
# save update that version, so a burst of autosaves is one version; the next burst starts a new one. Each note keeps its
# newest `note_versions_kept` rows (Settings → Vault & files: 3, 5 or 10; 5 by default), so the table stays small.
# reason: save | restore (a restore wrote this text back) | before-restore (the text a restore replaced, so nothing is lost).
NOTE_VERSION_WINDOW_MIN = 10
NOTE_VERSIONS_SCHEMA = """
CREATE TABLE IF NOT EXISTS note_versions (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    note_id       INTEGER NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
    title         TEXT NOT NULL,
    content       TEXT NOT NULL,
    words         INTEGER NOT NULL DEFAULT 0,
    reason        TEXT NOT NULL DEFAULT 'save',
    restored_from TEXT,                          -- reason 'restore': saved_at of the version it brought back
    started_at    TEXT NOT NULL,                 -- UTC ISO: the first save in this version's burst
    saved_at      TEXT NOT NULL                  -- UTC ISO: the last save in it
);
CREATE INDEX IF NOT EXISTS idx_note_versions_note ON note_versions(note_id, id);
"""
# ==== end Build M ============================================================

# ==== Build V · the vault on disk: where each note's file is ==================================================
# The notes table stays the index (ids, tags, projects, tasks' links, Build M's versions); the .md file is the note.
#   notes.vault / folders.vault: the vault the row belongs to (vault_disk.key), NULL while notes live only in the
#     database. Rows of another vault stay (switching back keeps their history) but are left out of every list.
#   notes.path: the file inside the vault ("Project/Folder/Title.md"); NULL until it's written.
#   notes.file_mtime / file_size: the file as NeuroVault last wrote or read it, so a change made outside shows.
#   notes.front_matter: the file's YAML block, kept as it was (tags are written into it).
#   notes.file_fmt: "lf" / "crlf", "+bom", ";cp1252": how the file was written, so a save keeps it.
#   notes.synced_at: when the file was last written or read; NULL means the file is behind and gets written. A
#     trigger clears it whenever a note's title, text or place changes, whoever changes it.
VAULT_COLUMNS = (("notes", "vault", "TEXT"), ("notes", "path", "TEXT"), ("notes", "file_mtime", "INTEGER"),
                 ("notes", "file_size", "INTEGER"), ("notes", "front_matter", "TEXT"), ("notes", "file_fmt", "TEXT"),
                 ("notes", "synced_at", "TEXT"), ("folders", "vault", "TEXT"))


def init_vault_index(conn, columns):
    for table, column, decl in VAULT_COLUMNS:
        if column not in columns(table):
            conn.execute(f"ALTER TABLE {table} ADD COLUMN {column} {decl}")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_notes_vault ON notes(vault, path)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_folders_vault ON folders(vault)")
    conn.execute("""CREATE TRIGGER IF NOT EXISTS notes_file_behind AFTER UPDATE OF title, content, folder_id, project_id ON notes
                    BEGIN UPDATE notes SET synced_at = NULL WHERE id = NEW.id; END""")
    # QC 85: the Timeline's "Tag changes": one row per save that added or removed a note's tags (a new table only)
    conn.execute("""CREATE TABLE IF NOT EXISTS tag_changes (
                        id       INTEGER PRIMARY KEY AUTOINCREMENT,
                        note_id  INTEGER NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
                        added    TEXT NOT NULL DEFAULT '[]',   -- JSON list of tag names
                        removed  TEXT NOT NULL DEFAULT '[]',
                        source   TEXT NOT NULL DEFAULT 'app',  -- app | outside (a file edited outside NeuroVault)
                        at       TEXT NOT NULL)""")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_tag_changes_note ON tag_changes(note_id)")
# ==== end Build V ============================================================


class Database:
    def __init__(self, path):
        self.path = path
        self._lock = threading.RLock()
        self.conn = sqlite3.connect(path, check_same_thread=False)
        self.conn.row_factory = sqlite3.Row
        self.conn.execute("PRAGMA foreign_keys = ON")
        self.conn.execute("PRAGMA journal_mode = WAL")
        self.backup_path = None  # set if opening this file needed a pre-migration backup
        self.conn.executescript(SCHEMA)
        self.conn.executescript(CAPTURE_SCHEMA)  # Phase 6A: sticky notes and the inbox (new tables only)
        for column, decl in INBOX_VOICE_COLUMNS:  # Build A: two nullable columns; old rows are untouched
            if column not in self._columns("inbox_items"):
                self.conn.execute(f"ALTER TABLE inbox_items ADD COLUMN {column} {decl}")
        init_wrapups(self.conn, self._columns)  # Build F: the wrap-up table, done times on tasks and steps (no backup needed)
        for column, decl in STICKY_POP_COLUMNS:  # Build H: popped-out stickies (new columns with defaults; no backup needed)
            if column not in self._columns("stickies"):
                self.conn.execute(f"ALTER TABLE stickies ADD COLUMN {column} {decl}")
        self.conn.executescript(TASK_BIN_SCHEMA)  # Build I: deleted tasks wait here for Undo (a new table only)
        self.conn.executescript(NOTE_VERSIONS_SCHEMA)  # Build M: note history (a new table only)
        init_vault_index(self.conn, self._columns)  # Build V: where each note's file is (nullable columns; no backup needed)
        self.vault = None  # Build V: the open vault's key (vault_disk.key), or None while notes live only in the database
        self.conn.commit()
        self.migrate()

    # ---- migrations (idempotent; run on every open) ----

    def _columns(self, table):
        return {r["name"] for r in self.conn.execute(f"PRAGMA table_info({table})")}

    def _has_data(self):
        return any(
            self.conn.execute(f"SELECT 1 FROM {t} LIMIT 1").fetchone()
            for t in ("projects", "notes", "tasks", "sessions")
        )

    def get_meta(self, key):
        row = self.query_one("SELECT value FROM app_meta WHERE key = ?", (key,))
        return row["value"] if row else None

    def backup(self, label):
        """Copy the whole database to '<file>.<timestamp>.<label>.bak' (sqlite's
        online backup, so the WAL is included). Returns the path, or None for
        an in-memory database."""
        if self.path == ":memory:":
            return None
        stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
        path = f"{self.path}.{stamp}.{label}.bak"
        dest = sqlite3.connect(path)
        try:
            with self._lock:
                self.conn.commit()
                self.conn.backup(dest)
        finally:
            dest.close()
        log.info("Backed up the database to %s", path)
        return path

    def migrate(self):
        with self._lock:
            missing = [(t, c, d) for t, c, d in ADDED_COLUMNS if c not in self._columns(t)]
            notes_pending = (
                self.conn.execute("SELECT value FROM app_meta WHERE key = 'notes_to_folders'").fetchone() is None
                and self.conn.execute("SELECT 1 FROM notes LIMIT 1").fetchone() is not None
            )
            if (missing or notes_pending) and self._has_data():
                self.backup_path = self.backup("pre-folders")

            for table, column, decl in missing:
                self.conn.execute(f"ALTER TABLE {table} ADD COLUMN {column} {decl}")
                log.info("Added %s.%s", table, column)
            self.conn.execute("CREATE INDEX IF NOT EXISTS idx_notes_folder ON notes(folder_id)")
            self.conn.execute("CREATE INDEX IF NOT EXISTS idx_tasks_note ON tasks(note_id)")

            self._fill_color_slots()
            if self.conn.execute("SELECT 1 FROM app_meta WHERE key = 'notes_to_folders'").fetchone() is None:
                moved = self._notes_to_folders()
                self.conn.execute(
                    "INSERT INTO app_meta (key, value) VALUES ('notes_to_folders', ?)",
                    (f"{utc_now_iso()} moved={moved} backup={self.backup_path or ''}",),
                )
                if moved:
                    log.info("Placed %d existing notes in folders", moved)
            self.conn.commit()

    def _fill_color_slots(self):
        """Give every project without a colour slot the slot nearest its old hex
        colour, or the least-used slot if it has no colour. Projects that
        already have a slot are never touched, so this runs safely on every open."""
        rows = self.conn.execute("SELECT id, color, color_slot FROM projects ORDER BY id").fetchall()
        used = Counter(r["color_slot"] for r in rows if r["color_slot"])
        blank = []
        for r in rows:
            if r["color_slot"] is None:
                slot = nearest_slot(r["color"])
                if slot is None:
                    blank.append(r["id"])
                    continue
                used[slot] += 1
                self.conn.execute("UPDATE projects SET color_slot = ? WHERE id = ?", (slot, r["id"]))
        for pid in blank:
            slot = min(range(1, 7), key=lambda s: (used[s], s))
            used[slot] += 1
            self.conn.execute("UPDATE projects SET color_slot = ? WHERE id = ?", (slot, pid))

    def _child_folder(self, name, parent_id, project_id, create=True):
        """Folder called `name` (any case) directly under parent_id, or at
        project_id's root when parent_id is None. Created if missing."""
        vault = getattr(self, "vault", None)   # Build V: each vault has its own folders
        if parent_id is not None:
            row = self.conn.execute(
                "SELECT id FROM folders WHERE parent_id = ? AND name = ? COLLATE NOCASE", (parent_id, name)
            ).fetchone()
        else:
            row = self.conn.execute(
                "SELECT id FROM folders WHERE parent_id IS NULL AND project_id IS ? AND name = ? COLLATE NOCASE AND vault IS ?",
                (project_id, name, vault),
            ).fetchone()
        if row or not create:
            return row["id"] if row else None
        now = utc_now_iso()
        return self.conn.execute(
            "INSERT INTO folders (name, parent_id, project_id, created_at, updated_at, vault) VALUES (?, ?, ?, ?, ?, ?)",
            (name, parent_id, project_id, now, now, vault),
        ).lastrowid

    def unsorted_folder_id(self):
        """The top-level "Unsorted" folder, created on first use."""
        with self._lock:
            fid = self._child_folder(UNSORTED_FOLDER, None, None)
            self.conn.commit()
            return fid

    def _notes_to_folders(self):
        """One-time placement of notes made before folders existed: each
        (project, category) pair becomes a folder at that project's root;
        notes with no project or no category go in the top-level "Unsorted"
        folder. Only notes without a folder are touched."""
        rows = self.conn.execute(
            """SELECT n.id, n.category, p.id AS project_id FROM notes n
               LEFT JOIN projects p ON p.id = n.project_id
               WHERE n.folder_id IS NULL"""
        ).fetchall()
        for r in rows:
            name = category_folder_name(r["category"])
            if r["project_id"] is None or not name:
                fid = self._child_folder(UNSORTED_FOLDER, None, None)
            else:
                fid = self._child_folder(name, None, r["project_id"])
            self.conn.execute("UPDATE notes SET folder_id = ? WHERE id = ?", (fid, r["id"]))
        return len(rows)

    def close(self):
        with self._lock:
            self.conn.close()

    # ---- generic helpers (every access to self.conn goes through these) ----

    def execute(self, sql, params=()):
        with self._lock:
            cur = self.conn.execute(sql, params)
            self.conn.commit()
            return cur

    def query(self, sql, params=()):
        with self._lock:
            return self.conn.execute(sql, params).fetchall()

    def query_one(self, sql, params=()):
        with self._lock:
            return self.conn.execute(sql, params).fetchone()

    # ---- tags (shared by notes and tasks) ----

    def get_or_create_tags(self, tag_names):
        """tag_names: list of plain strings (already split/trimmed). Returns list of tag ids."""
        ids = []
        for name in tag_names:
            name = name.strip()
            if not name:
                continue
            row = self.query_one("SELECT id FROM tags WHERE name = ? COLLATE NOCASE", (name,))
            if row:
                ids.append(row["id"])
            else:
                cur = self.execute("INSERT INTO tags (name) VALUES (?)", (name,))
                ids.append(cur.lastrowid)
        return ids

    def set_tags(self, table, id_column, item_id, tag_names):
        """table is 'note_tags' or 'task_tags', id_column is 'note_id' or 'task_id'."""
        tag_ids = self.get_or_create_tags(tag_names)
        self.execute(f"DELETE FROM {table} WHERE {id_column} = ?", (item_id,))
        for tag_id in tag_ids:
            self.execute(
                f"INSERT OR IGNORE INTO {table} ({id_column}, tag_id) VALUES (?, ?)",
                (item_id, tag_id),
            )

    def get_tags_for(self, table, id_column, item_id):
        rows = self.query(
            f"""SELECT t.name FROM tags t
                JOIN {table} jt ON jt.tag_id = t.id
                WHERE jt.{id_column} = ?
                ORDER BY t.name COLLATE NOCASE""",
            (item_id,),
        )
        return [r["name"] for r in rows]

    def next_palette_color(self):
        count = self.query_one("SELECT COUNT(*) as n FROM projects")["n"]
        return PALETTE[count % len(PALETTE)]

    # ---- sessions (+ pauses + milestones) ----------------------------------

    def log_session(
        self,
        project_id,
        start_iso,
        end_iso,
        target_seconds,
        actual_seconds,
        energy=None,
        focus=None,
        is_unplanned=False,
        pauses=None,
        milestones=None,
    ):
        """pauses: [{category, start_iso, end_iso, duration_seconds}, ...]
        milestones: [{note, at_iso, elapsed_seconds}, ...]"""
        overtime = 0 if is_unplanned else max(0, actual_seconds - target_seconds)
        now = utc_now_iso()
        with self._lock:
            cur = self.conn.execute(
                """INSERT INTO sessions
                   (project_id, start_time, end_time, target_seconds, actual_seconds,
                    overtime_seconds, energy, focus, is_unplanned, created_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (project_id, start_iso, end_iso, target_seconds, actual_seconds, overtime,
                 energy, focus, int(is_unplanned), now),
            )
            session_id = cur.lastrowid

            for p in (pauses or []):
                self.conn.execute(
                    """INSERT INTO pauses (session_id, category, start_time, end_time, duration_seconds)
                       VALUES (?, ?, ?, ?, ?)""",
                    (session_id, p["category"], p["start_iso"], p["end_iso"], p["duration_seconds"]),
                )
            for m in (milestones or []):
                self.conn.execute(
                    "INSERT INTO milestones (session_id, note, at_time, elapsed_seconds) VALUES (?, ?, ?, ?)",
                    (session_id, m["note"], m["at_iso"], m["elapsed_seconds"]),
                )

            self.conn.commit()
            proj = self.conn.execute("SELECT name, color FROM projects WHERE id=?", (project_id,)).fetchone()

        return {
            "id": session_id,
            "project_id": project_id,
            "project_name": proj["name"] if proj else "Unknown",
            "project_color": proj["color"] if proj else "#888888",
            "start_time": start_iso,
            "end_time": end_iso,
            "target_seconds": target_seconds,
            "actual_seconds": actual_seconds,
            "overtime_seconds": overtime,
            "energy": energy,
            "focus": focus,
            "is_unplanned": bool(is_unplanned),
            "pauses": pauses or [],
            "milestones": milestones or [],
        }

    def get_sessions_for_day(self, date_str):
        rows = self.query(
            """SELECT s.id, s.start_time, s.end_time, s.actual_seconds, s.overtime_seconds,
                      s.energy, s.focus, s.is_unplanned,
                      p.name as project_name, p.color as project_color
               FROM sessions s LEFT JOIN projects p ON p.id = s.project_id
               WHERE date(s.start_time) = ?
               ORDER BY s.start_time DESC""",
            (date_str,),
        )
        return [dict(r) for r in rows]

    def get_stats_today(self):
        today = datetime.now().strftime("%Y-%m-%d")
        row = self.query_one(
            "SELECT COUNT(*) as cnt, COALESCE(SUM(actual_seconds),0) as total "
            "FROM sessions WHERE date(start_time) = ?",
            (today,),
        )
        return {"count": row["cnt"], "total_seconds": row["total"]}

    def get_stats_week(self):
        now = datetime.now()
        monday = (now - timedelta(days=now.weekday())).strftime("%Y-%m-%d")
        row = self.query_one(
            "SELECT COALESCE(SUM(actual_seconds),0) as total FROM sessions WHERE date(start_time) >= ?",
            (monday,),
        )
        return {"total_seconds": row["total"]}

    def get_streak(self):
        rows = self.query("SELECT DISTINCT date(start_time) as d FROM sessions")
        days = {r["d"] for r in rows}
        streak = 0
        cursor = datetime.now().date()
        while cursor.strftime("%Y-%m-%d") in days:
            streak += 1
            cursor -= timedelta(days=1)
        return streak

    def get_heatmap(self, weeks=12, start=None, end=None):
        """Daily totals, oldest first: the last `weeks` * 7 days, or (Build J) the dates from `start` to `end`
        (date objects or "YYYY-MM-DD"). Each day: date, total_seconds, sessions and its level (heat_level)."""
        today = datetime.now().date()
        start = _as_date(start) if start else today - timedelta(days=weeks * 7 - 1)
        end = _as_date(end) if end else today
        rows = self.query(
            "SELECT date(start_time) as d, SUM(actual_seconds) as total, COUNT(*) as n "
            "FROM sessions WHERE date(start_time) >= ? AND date(start_time) <= ? GROUP BY d",
            (start.strftime("%Y-%m-%d"), end.strftime("%Y-%m-%d")),
        )
        totals = {r["d"]: (r["total"], r["n"]) for r in rows}
        days, cursor = [], start
        while cursor <= end:
            key = cursor.strftime("%Y-%m-%d")
            sec, n = totals.get(key, (0, 0))
            days.append({"date": key, "total_seconds": sec, "sessions": n, "level": heat_level(sec)})
            cursor += timedelta(days=1)
        return days

    # ---- Build J · the whole year on Timer → Insights (R37, locked 2026-10-16) ----
    def get_year_heatmap(self, which="past", today=None):
        """`which` is "past" (the past 12 months, like GitHub: the 364 days before today, and today) or a calendar
        year. Days after today are marked future. Totals cover the days so far. `years` is what the year picker offers."""
        today = _as_date(today) if today else datetime.now().date()
        if which == "past":
            start, end = today - timedelta(days=364), today
        else:
            year = int(which)
            start, end = date(year, 1, 1), date(year, 12, 31)
        days = self.get_heatmap(start=start, end=min(end, today)) if start <= today else []
        cursor = max(start, today + timedelta(days=1))
        while cursor <= end:
            days.append({"date": cursor.strftime("%Y-%m-%d"), "total_seconds": 0, "sessions": 0, "level": 0, "future": True})
            cursor += timedelta(days=1)
        past = [d for d in days if not d.get("future")]
        run = best = 0
        for d in past:
            run = run + 1 if d["total_seconds"] else 0
            best = max(best, run)
        top = max((d for d in past if d["total_seconds"]), key=lambda d: d["total_seconds"], default=None)
        years = {today.year} | {int(r["y"]) for r in self.query("SELECT DISTINCT substr(start_time, 1, 4) AS y FROM sessions") if (r["y"] or "").isdigit()}
        return {
            "which": which, "from": start.strftime("%Y-%m-%d"), "to": end.strftime("%Y-%m-%d"), "today": today.strftime("%Y-%m-%d"),
            "days": days,
            "totals": {"total_seconds": sum(d["total_seconds"] for d in past), "sessions": sum(d["sessions"] for d in past),
                       "active_days": sum(1 for d in past if d["total_seconds"]), "days_so_far": len(past), "longest_run": best,
                       "best_day": {"date": top["date"], "total_seconds": top["total_seconds"]} if top else None},
            "years": ["past"] + sorted(years, reverse=True),
            "steps": list(HEAT_STEPS),
        }
    # ---- end Build J ----

    def get_project_breakdown_alltime(self):
        rows = self.query(
            """SELECT p.name, p.color, COALESCE(SUM(s.actual_seconds),0) as total
               FROM projects p LEFT JOIN sessions s ON s.project_id = p.id
               WHERE p.archived = 0
               GROUP BY p.id
               ORDER BY total DESC"""
        )
        return [dict(r) for r in rows]

    def get_averages(self):
        row = self.query_one(
            "SELECT AVG(energy) as avg_energy, AVG(focus) as avg_focus, "
            "SUM(CASE WHEN is_unplanned THEN 1 ELSE 0 END) as unplanned_count, COUNT(*) as total_count "
            "FROM sessions"
        )
        return {
            "avg_energy": round(row["avg_energy"], 1) if row["avg_energy"] is not None else None,
            "avg_focus": round(row["avg_focus"], 1) if row["avg_focus"] is not None else None,
            "unplanned_count": row["unplanned_count"] or 0,
            "total_count": row["total_count"] or 0,
        }

    def get_recent_sessions(self, limit=200):
        rows = self.query(
            """SELECT s.id, s.start_time, s.end_time, s.actual_seconds, s.overtime_seconds,
                      s.energy, s.focus, s.is_unplanned,
                      p.name as project_name, p.color as project_color
               FROM sessions s LEFT JOIN projects p ON p.id = s.project_id
               ORDER BY s.start_time DESC
               LIMIT ?""",
            (limit,),
        )
        return [dict(r) for r in rows]

    def get_all_sessions_for_export(self):
        rows = self.query(
            """SELECT s.id, s.start_time, s.end_time, s.target_seconds, s.actual_seconds,
                      s.overtime_seconds, s.energy, s.focus, s.is_unplanned,
                      p.name as project_name,
                      (SELECT COUNT(*) FROM pauses ps WHERE ps.session_id = s.id) as pause_count,
                      (SELECT COALESCE(SUM(duration_seconds),0) FROM pauses ps WHERE ps.session_id = s.id) as pause_seconds,
                      (SELECT COUNT(*) FROM milestones m WHERE m.session_id = s.id) as milestone_count
               FROM sessions s LEFT JOIN projects p ON p.id = s.project_id
               ORDER BY s.start_time ASC"""
        )
        return [dict(r) for r in rows]

    def get_estimation_analytics(self):
        """Planned sessions only — unplanned/stopwatch sessions have no target to estimate against."""
        row = self.query_one(
            "SELECT AVG(target_seconds) as avg_target, AVG(actual_seconds) as avg_actual, "
            "AVG(overtime_seconds) as avg_overtime, COUNT(*) as n "
            "FROM sessions WHERE is_unplanned = 0"
        )
        accuracy_row = self.query_one(
            "SELECT AVG(CAST(actual_seconds AS FLOAT) / target_seconds) as ratio "
            "FROM sessions WHERE is_unplanned = 0 AND target_seconds > 0"
        )
        per_proj = self.query(
            """SELECT p.name, p.color,
                      COUNT(s.id) as n,
                      SUM(CASE WHEN s.overtime_seconds > 0 THEN 1 ELSE 0 END) as over_count
               FROM sessions s JOIN projects p ON p.id = s.project_id
               WHERE s.is_unplanned = 0
               GROUP BY p.id
               HAVING n > 0
               ORDER BY (CAST(over_count AS FLOAT) / n) DESC"""
        )
        return {
            "avg_target_seconds": round(row["avg_target"]) if row["avg_target"] is not None else None,
            "avg_actual_seconds": round(row["avg_actual"]) if row["avg_actual"] is not None else None,
            "avg_overtime_seconds": round(row["avg_overtime"]) if row["avg_overtime"] is not None else None,
            "accuracy_ratio": round(accuracy_row["ratio"], 2) if accuracy_row["ratio"] is not None else None,
            "planned_count": row["n"] or 0,
            "by_category": [
                {"name": r["name"], "color": r["color"], "sessions": r["n"],
                 "over_pct": round(100 * r["over_count"] / r["n"])}
                for r in per_proj
            ],
        }

    def get_pause_analytics(self):
        rows = self.query("SELECT category, duration_seconds, start_time FROM pauses")
        days = self.query("SELECT DISTINCT date(start_time) as d FROM sessions")

        total_pause_seconds = sum(r["duration_seconds"] for r in rows)
        n_days = len({d["d"] for d in days}) or 1
        avg_per_day = total_pause_seconds / n_days

        by_category = Counter()
        for r in rows:
            by_category[r["category"]] += r["duration_seconds"]
        most_common = by_category.most_common(1)
        most_common_category = most_common[0][0] if most_common else None

        return {
            "total_pause_seconds": total_pause_seconds,
            "avg_pause_seconds_per_day": round(avg_per_day),
            "most_common_category": most_common_category,
            "pause_count": len(rows),
            "by_category": [{"category": k, "total_seconds": v} for k, v in by_category.most_common()],
        }

    def get_project_time_stats(self):
        """All-time session totals per (non-archived) project, for the timer's Categories page."""
        rows = self.query(
            """SELECT p.id, p.name, p.color,
                      COUNT(s.id) as session_count, COALESCE(SUM(s.actual_seconds),0) as total_seconds
               FROM projects p LEFT JOIN sessions s ON s.project_id = p.id
               WHERE p.archived = 0
               GROUP BY p.id
               ORDER BY p.name COLLATE NOCASE"""
        )
        return [dict(r) for r in rows]

    # ---- folders -------------------------------------------------------------

    def folder_subtree_ids(self, folder_id):
        """folder_id and every folder below it."""
        rows = self.query(
            """WITH RECURSIVE sub(id) AS (
                   SELECT ? UNION ALL SELECT f.id FROM folders f JOIN sub ON f.parent_id = sub.id)
               SELECT id FROM sub""",
            (folder_id,),
        )
        return [r["id"] for r in rows]

    def sibling_name_taken(self, name, parent_id, project_id, exclude_id=None):
        """True if a folder called `name` (any case) already sits where a folder
        with this parent_id / project_id would go. At the very top level
        projects count too, since they share that level in the tree."""
        if parent_id is not None:
            row = self.query_one(
                "SELECT id FROM folders WHERE parent_id = ? AND name = ? COLLATE NOCASE AND id IS NOT ?",
                (parent_id, name, exclude_id),
            )
        else:
            row = self.query_one(
                """SELECT id FROM folders WHERE parent_id IS NULL AND project_id IS ?
                   AND name = ? COLLATE NOCASE AND id IS NOT ? AND vault IS ?""",
                (project_id, name, exclude_id, self.vault),
            )
            if not row and project_id is None:
                row = self.query_one("SELECT id FROM projects WHERE name = ? COLLATE NOCASE", (name,))
        return row is not None

    def folder_tree(self, sort="name-asc", include_archived=False):
        """Projects, then top-level folders, each with nested folders and notes.
        Folders sort by name (reversed only for name-desc, as in Obsidian);
        notes sort by the chosen key."""
        key, _, direction = sort.partition("-")
        reverse = direction == "desc"
        note_key = {"mod": "updated_at", "created": "created_at"}.get(key, "title")

        def natural(text):
            return [int(p) if p.isdigit() else p.casefold() for p in re.split(r"(\d+)", text or "")]

        folders = [dict(r) for r in self.query("SELECT * FROM folders WHERE vault IS ?", (self.vault,))]
        notes = [dict(r) for r in self.query(
            "SELECT id, title, folder_id, project_id, created_at, updated_at FROM notes WHERE vault IS ?", (self.vault,))]
        sql = "SELECT id, name, color_slot, archived FROM projects"
        if not include_archived:
            sql += " WHERE archived = 0"
        projects = [dict(r) for r in self.query(sql)]

        kids, note_kids = {}, {}
        for f in folders:
            f.update(kind="folder", folders=[], notes=[])
            parent = ("f", f["parent_id"]) if f["parent_id"] else ("p", f["project_id"])
            kids.setdefault(parent, []).append(f)
        for n in notes:
            n["kind"] = "note"
            parent = ("f", n["folder_id"]) if n["folder_id"] else ("p", n["project_id"])
            note_kids.setdefault(parent, []).append(n)

        def fill(node, ref):
            node["folders"] = sorted(kids.get(ref, []), key=lambda f: natural(f["name"]),
                                     reverse=reverse and key == "name")
            ns = note_kids.get(ref, [])
            if note_key == "title":
                node["notes"] = sorted(ns, key=lambda n: natural(n["title"]), reverse=reverse)
            else:
                node["notes"] = sorted(ns, key=lambda n: n[note_key] or "", reverse=reverse)
            for f in node["folders"]:
                fill(f, ("f", f["id"]))
            return node

        top = [fill(dict(p, kind="project"), ("p", p["id"])) for p in projects]
        top += [fill(f, ("f", f["id"])) for f in kids.get(("p", None), [])]
        top.sort(key=lambda x: natural(x["name"]), reverse=reverse and key == "name")
        return {"folders": top, "notes": note_kids.get(("p", None), [])}

    # ---- sessions in the new front end's shape --------------------------------

    def list_sessions(self, limit=500):
        """Newest first, each with its pauses and milestones, like the mockup's
        D.sessions. color is the project's colour slot (1-6)."""
        rows = [dict(r) for r in self.query(
            """SELECT s.id, s.project_id, p.name AS project_name, p.color_slot AS color,
                      s.start_time, s.end_time, s.target_seconds, s.actual_seconds,
                      s.overtime_seconds, s.energy, s.focus, s.is_unplanned
               FROM sessions s LEFT JOIN projects p ON p.id = s.project_id
               ORDER BY s.start_time DESC LIMIT ?""",
            (limit,),
        )]
        if not rows:
            return rows
        ids = [r["id"] for r in rows]
        marks = ",".join("?" * len(ids))
        pauses, miles = {}, {}
        for p in self.query(
                f"""SELECT session_id, category, start_time, end_time, duration_seconds
                    FROM pauses WHERE session_id IN ({marks}) ORDER BY start_time""", ids):
            pauses.setdefault(p["session_id"], []).append(
                {"category": p["category"], "start_time": p["start_time"],
                 "end_time": p["end_time"], "duration_seconds": p["duration_seconds"]})
        for m in self.query(
                f"""SELECT session_id, note, at_time, elapsed_seconds
                    FROM milestones WHERE session_id IN ({marks}) ORDER BY elapsed_seconds""", ids):
            miles.setdefault(m["session_id"], []).append(
                {"note": m["note"], "at_time": m["at_time"],
                 "time_label": (m["at_time"] or "")[11:16], "elapsed_seconds": m["elapsed_seconds"]})
        for r in rows:
            r["is_unplanned"] = bool(r["is_unplanned"])
            r["pauses"] = pauses.get(r["id"], [])
            r["milestones"] = miles.get(r["id"], [])
        return rows
