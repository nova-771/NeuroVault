"""
api.py — the Api class exposed to the frontend as window.pywebview.api.*.

Merges the original KnowledgeOS surface (projects/notes/tasks) with
time-tracker's surface (sessions/insights/settings/vault export/CSV
export), all backed by db.py's single unified Database. Owns no SQL
directly — delegates persistence to db.Database — so this file stays
readable as "what the app can do" rather than "how sqlite works".

Every method reachable from JS is wrapped (via safe_list/safe_action) so a
bad input or an unexpected DB/filesystem error returns a normal JS value
instead of raising across the pywebview bridge, which previously surfaced
as an unhandled exception in the JS console with no usable message.
"""

import base64
import csv
import functools
import json
import logging
import os
import re  # Build K: safe names for attached files
import shutil  # Build A: free space for live words
import sys  # Build N: the static icon next to the .exe
import subprocess  # Build A: Reveal in File Explorer
import webbrowser
import tempfile, threading, time  # noqa: E401  Build O: dropped files' paths and stand-in uploads
from datetime import datetime, timedelta, timezone  # Build F: timedelta; Build M: timezone

import webview

import config as cfgmod
import attachments  # Build A: files in attachments/ (voice clips, pasted images, PDFs)
import converters  # Build K: PDF and DOCX to Markdown
from platform_layer import spell as syspell  # Fix A (QC 3 · 26): the system spell checker (Windows: winspell, through ctypes)
import autocorrect  # Build N (QC 76): Gboard-style ranking with word frequencies, learning on this PC
import guided_setup  # Build D: the guided first-run setup
import local_ai  # Build B: local AI (llama.cpp's server, run by the app)
from errors import plain_error, plain_message  # v0.1.1 (QC 90): failures in plain words
import cloud_ai  # Build N (R56): AI in the cloud with your own key (Windows Credential Manager)
import ai_attach  # Build N (QC 101): every attachment the AI can read, for any model, said file by file
import ai_lock  # R68: a project, folder or note kept off cloud AI
import agent  # Build N (R67): the Agent, a small tool loop on the chat we have
import fonts as fontsmod  # Build E: reading fonts (More fonts, your own font)
import dictionary as dictmod  # Build J: the dictionary and thesaurus, with your own words
import read_aloud  # Phase 6C
import vault
import vault_disk as vdisk  # Build V: notes as .md files in the vault folder
import voice as voicemod  # Phase 6B: the voice rambler's engine
import popout  # Build H: stickies and the quick timer popped out as their own windows
import platform_layer  # cross-platform step 0: every Windows-only call goes through here
import winframe
from db import (ENERGY_LEVELS, PALETTE, Database, folder_name_error, nearest_slot,
                utc_now_iso)
from db import STICKY_COLOURS, inbox_markdown, sticky_file_text  # Phase 6A
from db import TIDY_ACTIONS, TIDY_KINDS, WRAP_DAY_HOUR, wrapup_markdown  # Build F
from db import TASK_BIN_DAYS  # Build I
from db import NOTE_VERSION_WINDOW_MIN  # Build M
from db import UNSORTED_FOLDER  # Build V
from utils import app_dir
from version import VERSION  # Settings → About

log = logging.getLogger(__name__)


def _split_tags(tags_text):
    if not tags_text:
        return []
    return [t.strip() for t in tags_text.split(",") if t.strip()]


def _clean_id(value):
    """The frontend sends '', 0, or a non-numeric sentinel like '__new__'
    for 'no selection' from a <select>. Returns None for any of those, the
    int otherwise — never raises on garbage input."""
    if not value:
        return None
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


# Default for "leave this as it is" arguments. JS can't send this value, and
# an argument it leaves out arrives as the default, so the old front end's
# calls keep a note's folder / a task's note link untouched.
KEEP = "__keep__"


def _due_date(value):
    """Build I: (due date "YYYY-MM-DD" or None, error). None or "" is no due date (Later)."""
    value = (str(value) if value is not None else "").strip()
    if not value:
        return None, None
    try:
        return datetime.strptime(value[:10], "%Y-%m-%d").strftime("%Y-%m-%d"), None
    except ValueError:
        return None, f"Invalid due date: {value!r}"


def _local_now():
    """Local time without a zone, the format the sessions table uses."""
    return datetime.now().replace(microsecond=0)


def _slot(value):
    """A colour slot 1-6 from JS, or None."""
    try:
        v = int(value)
    except (TypeError, ValueError):
        return None
    return v if 1 <= v <= 6 else None


def _rating(value):
    """An energy / focus rating 1-5, or None for 'not rated'."""
    try:
        v = int(value)
    except (TypeError, ValueError):
        return None
    return v if 1 <= v <= 5 else None


def safe_list(default=None):
    """For read methods returning a list/dict/None to JS: log and return a
    safe default instead of raising across the pywebview bridge."""
    def deco(fn):
        @functools.wraps(fn)
        def wrapper(self, *args, **kwargs):
            try:
                return fn(self, *args, **kwargs)
            except Exception:
                log.exception("%s failed", fn.__name__)
                return [] if default is None else default
        return wrapper
    return deco


def safe_action(fn):
    """For write/action methods returning a {"status": ...}-shaped dict:
    catch anything unexpected and return that same shape instead of
    raising across the JS bridge."""
    @functools.wraps(fn)
    def wrapper(self, *args, **kwargs):
        try:
            return fn(self, *args, **kwargs)
        except Exception as e:
            log.exception("%s failed", fn.__name__)
            return {"status": "error", "message": plain_error(e)}   # v0.1.1 (QC 90): plain words; the detail is in the log
    return wrapper


def _default_db_path():
    """neurovault.db next to the app. The app used to be called KnowledgeOS
    and kept its data in knowledge_os.db, so on first launch after the
    rename that file (and any WAL/SHM side files) is moved across rather
    than starting from an empty database."""
    new_path = os.path.join(app_dir(), "neurovault.db")
    old_path = os.path.join(app_dir(), "knowledge_os.db")
    if not os.path.exists(new_path) and os.path.exists(old_path):
        try:
            for suffix in ("", "-wal", "-shm"):
                if os.path.exists(old_path + suffix):
                    os.replace(old_path + suffix, new_path + suffix)
            log.info("Moved knowledge_os.db to neurovault.db")
        except OSError as e:
            log.warning("Could not move knowledge_os.db (%s); using it in place", e)
            return old_path
    return new_path


class NeuroVaultApi:
    def __init__(self, db_path=None):
        # The pywebview window, set by main.py right after it is created. Private: pywebview exposes every
        # public attribute of this object to the page, and would walk the whole .NET window object graph.
        self._window = None
        self.maximized = False  # kept in step by main.py's maximized / restored events
        self.db = Database(db_path or _default_db_path())
        self.cfg = cfgmod.load_config()
        ai_lock.instance().bind(self)   # R68: the lock file, and what an id or a path is, in this install
        self._pop = popout.PopOuts(self)  # Build H: the popped-out windows (main.py gives it create_window and the page)

    # ------------------------------------------------------------------
    # Config
    # ------------------------------------------------------------------

    def get_config(self):
        return self.cfg

    # ------------------------------------------------------------------
    # Projects (also used as time-tracking categories — see Timer below)
    # ------------------------------------------------------------------

    @safe_list()
    def list_projects(self, include_archived=False):
        sql = "SELECT * FROM projects"
        if not include_archived:
            sql += " WHERE archived = 0"
        sql += " ORDER BY name COLLATE NOCASE"
        return [dict(r) for r in self.db.query(sql)]

    @safe_action
    def create_project(self, name, description="", color="", icon="", color_slot=None):
        """color_slot (1-6) is what the new front end draws with; color (hex)
        is kept for the old one. Either can be given; the other follows."""
        name = (name or "").strip()
        if not name:
            return {"status": "error", "message": "Project name can't be empty."}
        existing = self.db.query_one("SELECT id FROM projects WHERE name = ? COLLATE NOCASE", (name,))
        if existing:
            return {"status": "error", "message": f'"{name}" already exists.'}
        if self.db.query_one(
                "SELECT id FROM folders WHERE parent_id IS NULL AND project_id IS NULL AND name = ? COLLATE NOCASE",
                (name,)):
            return {"status": "error", "message": f'A top-level folder is already called "{name}".'}
        color = (color or "").strip()
        slot = _slot(color_slot) or (nearest_slot(color) if color else None)
        if slot is None:
            count = self.db.query_one("SELECT COUNT(*) AS n FROM projects")["n"]
            slot = count % 6 + 1
        color = color or PALETTE[slot - 1]
        now = utc_now_iso()
        cur = self.db.execute(
            """INSERT INTO projects (name, description, color, color_slot, icon, archived, created_at, updated_at)
               VALUES (?, ?, ?, ?, ?, 0, ?, ?)""",
            (name, description, color, slot, icon, now, now),
        )
        return {"status": "success", "id": cur.lastrowid, "name": name, "color": color, "color_slot": slot}

    @safe_action
    def update_project(self, project_id, name=None, color_slot=None, description=None):
        """Rename a project and/or change its colour slot or description.
        Arguments left as None stay as they are."""
        pid = _clean_id(project_id)
        row = pid and self.db.query_one("SELECT * FROM projects WHERE id = ?", (pid,))
        if not row:
            return {"status": "error", "message": "Project not found."}
        new_name = row["name"] if name is None else (name or "").strip()
        if not new_name:
            return {"status": "error", "message": "Project name can't be empty."}
        if self.db.query_one("SELECT id FROM projects WHERE name = ? COLLATE NOCASE AND id != ?", (new_name, pid)):
            return {"status": "error", "message": f'"{new_name}" already exists.'}
        slot = row["color_slot"]
        if color_slot is not None:
            slot = _slot(color_slot)
            if slot is None:
                return {"status": "error", "message": "Colour slot must be 1 to 6."}
        color = PALETTE[slot - 1] if slot != row["color_slot"] else row["color"]
        desc = row["description"] if description is None else description
        self.db.execute(
            "UPDATE projects SET name=?, color_slot=?, color=?, description=?, updated_at=? WHERE id=?",
            (new_name, slot, color, desc, utc_now_iso(), pid),
        )
        return {"status": "success", "id": pid, "name": new_name, "color_slot": slot, "color": color}

    @safe_action
    def set_project_archived(self, project_id, archived):
        pid = _clean_id(project_id)
        if pid is None:
            return {"status": "error", "message": "Invalid project id."}
        self.db.execute(
            "UPDATE projects SET archived = ?, updated_at = ? WHERE id = ?",
            (1 if archived else 0, utc_now_iso(), pid),
        )
        return {"status": "success"}

    @safe_action
    def delete_project(self, project_id):
        # Notes/tasks/sessions referencing this project fall back to "no
        # project" (ON DELETE SET NULL) rather than being deleted themselves.
        # Its folders become top-level folders the same way; notes at its root
        # go to "Unsorted" so every note stays somewhere in the tree.
        pid = _clean_id(project_id)
        if pid is None:
            return {"status": "error", "message": "Invalid project id."}
        # Phase 4 (Timer): a project with logged sessions can't be deleted, so its time history stays whole.
        logged = self.db.query_one("SELECT COUNT(*) AS n FROM sessions WHERE project_id = ?", (pid,))["n"]
        if logged:
            return {"status": "error", "code": "has_sessions", "sessions": logged,
                    "message": f"This project has {logged} logged session{'' if logged == 1 else 's'}, so it can't be deleted."}
        if self.db.query_one("SELECT 1 FROM notes WHERE project_id = ? AND folder_id IS NULL AND vault IS ?", (pid, self.db.vault)):
            self.db.execute("UPDATE notes SET folder_id = ? WHERE project_id = ? AND folder_id IS NULL AND vault IS ?",
                            (self.db.unsorted_folder_id(), pid, self.db.vault))   # Build V: the open vault's Unsorted
        self.db.execute("DELETE FROM projects WHERE id = ?", (pid,))
        return {"status": "success"}

    # ------------------------------------------------------------------
    # Notes
    # ------------------------------------------------------------------

    @safe_list()
    def list_notes(self, project_id=None, folder_id=None, include_content=False):
        """include_content=True keeps each note's body, so the front end can
        build the outline, backlinks and search from one load."""
        project_id = _clean_id(project_id)
        folder_id = _clean_id(folder_id)
        sql = """SELECT n.*, p.name AS project_name
                  FROM notes n LEFT JOIN projects p ON p.id = n.project_id WHERE n.vault IS ?"""
        params = [self.db.vault]   # Build V: only the open vault's notes
        if project_id is not None:
            sql += " AND n.project_id = ?"
            params.append(project_id)
        if folder_id is not None:
            sql += " AND n.folder_id = ?"
            params.append(folder_id)
        sql += " ORDER BY n.updated_at DESC"
        notes = [dict(r) for r in self.db.query(sql, tuple(params))]
        for note in notes:
            note["tags"] = self.db.get_tags_for("note_tags", "note_id", note["id"])
            if not include_content:
                note.pop("content", None)  # list view doesn't need full body
        return notes

    @safe_list(default=None)
    def get_note(self, note_id):
        note_id = _clean_id(note_id)
        if note_id is None:
            return None
        row = self.db.query_one(
            """SELECT n.*, p.name AS project_name
               FROM notes n LEFT JOIN projects p ON p.id = n.project_id
               WHERE n.id = ?""",
            (note_id,),
        )
        if not row:
            return None
        note = dict(row)
        note["tags"] = self.db.get_tags_for("note_tags", "note_id", note_id)
        return note

    def _place(self, folder_id, project_id):
        """Where a note goes: (folder_id, project_id, error). In a folder, the
        note takes that folder's project. With no folder it sits at the
        project's root, and with neither it goes in "Unsorted"."""
        if folder_id is not None:
            row = self.db.query_one("SELECT project_id FROM folders WHERE id = ?", (folder_id,))
            if not row:
                return None, None, "Folder not found."
            return folder_id, row["project_id"], None
        if project_id is not None:
            if not self.db.query_one("SELECT id FROM projects WHERE id = ?", (project_id,)):
                return None, None, "Project not found."
            return None, project_id, None
        return self.db.unsorted_folder_id(), None, None

    @safe_action
    def save_note(self, note_id, title, content, category, project_id=None, tags_text="", folder_id=KEEP):
        """folder_id: a folder id, or None for the project's root (or
        "Unsorted" when there's no project). Leave it out to keep an existing
        note where it is."""
        title = (title or "Untitled Note").strip() or "Untitled Note"
        category = (category or "#General").strip() or "#General"
        project_id = _clean_id(project_id)
        note_id = _clean_id(note_id)
        now = utc_now_iso()

        existing = note_id and self.db.query_one("SELECT folder_id FROM notes WHERE id = ?", (note_id,))
        if note_id and not existing:
            return {"status": "error", "message": "Note not found."}
        if folder_id == KEEP:
            folder_id = existing["folder_id"] if existing else None
        folder_id, project_id, err = self._place(_clean_id(folder_id), project_id)
        if err:
            return {"status": "error", "message": err}

        if note_id:
            self.db.execute(
                """UPDATE notes SET title=?, content=?, category=?, project_id=?, folder_id=?, updated_at=?
                   WHERE id=?""",
                (title, content, category, project_id, folder_id, now, note_id),
            )
        else:
            cur = self.db.execute(
                """INSERT INTO notes (title, content, category, project_id, folder_id, created_at, updated_at, vault)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
                (title, content, category, project_id, folder_id, now, now, self.db.vault),
            )
            note_id = cur.lastrowid

        self.db.set_tags("note_tags", "note_id", note_id, _split_tags(tags_text))
        return {"status": "success", "message": f"Saved '{title}'", "id": note_id,
                "folder_id": folder_id, "project_id": project_id, "updated_at": now}

    @safe_action
    def move_note(self, note_id, folder_id=None, project_id=None):
        """Move a note into a folder, or to a project's root (folder_id None),
        or to "Unsorted" (both None)."""
        note_id = _clean_id(note_id)
        if note_id is None or not self.db.query_one("SELECT id FROM notes WHERE id = ?", (note_id,)):
            return {"status": "error", "message": "Note not found."}
        folder_id, project_id, err = self._place(_clean_id(folder_id), _clean_id(project_id))
        if err:
            return {"status": "error", "message": err}
        # A move isn't an edit, so updated_at (the "Modified time" sort) stays.
        self.db.execute(
            "UPDATE notes SET folder_id = ?, project_id = ? WHERE id = ?",
            (folder_id, project_id, note_id),
        )
        return {"status": "success", "id": note_id, "folder_id": folder_id, "project_id": project_id}

    @safe_action
    def delete_note(self, note_id):
        note_id = _clean_id(note_id)
        if note_id is None:
            return {"status": "error", "message": "Invalid note id."}
        self.db.execute("DELETE FROM notes WHERE id = ?", (note_id,))
        return {"status": "success"}

    # ---- Phase 2: a link in a note opens in the default browser or mail app, never inside the window ----

    @safe_action
    def open_external(self, url):
        url = (url or "").strip() if isinstance(url, str) else ""
        scheme = url.split(":", 1)[0].lower() if ":" in url else ""
        if scheme not in ("http", "https", "mailto") or any(c in url for c in "\r\n\t") or len(url) > 2048:
            return {"status": "error", "message": "Only web and email links open from a note."}
        if scheme != "mailto" and not url.lower().startswith(scheme + "://"):
            return {"status": "error", "message": "That link has no web address."}
        if not webbrowser.open(url):
            return {"status": "error", "message": "No app could open that link."}
        return {"status": "success"}

    # ------------------------------------------------------------------
    # Folders (the Notes file explorer). Projects are the top level of the
    # tree, next to top-level folders such as "Unsorted".
    # ------------------------------------------------------------------

    @safe_list()
    def list_folders(self):
        """Every folder, flat: id, name, parent_id, project_id, created_at, updated_at."""
        return [dict(r) for r in self.db.query(
            "SELECT id, name, parent_id, project_id, created_at, updated_at FROM folders WHERE vault IS ? ORDER BY id",
            (self.db.vault,))]   # Build V: only the open vault's folders

    @safe_list(default={})
    def get_folder_tree(self, sort=None):
        """The whole explorer tree, sorted. sort is one of config.TREE_SORTS;
        left out, it's the saved order (set_tree_sort)."""
        if sort not in cfgmod.TREE_SORTS:
            sort = self.cfg.get("tree_sort", "name-asc")
        tree = self.db.folder_tree(sort)
        tree["sort"] = sort
        return tree

    @safe_action
    def set_tree_sort(self, sort):
        if sort not in cfgmod.TREE_SORTS:
            return {"status": "error", "message": "Sort must be one of: " + ", ".join(cfgmod.TREE_SORTS) + "."}
        self.cfg["tree_sort"] = sort
        cfgmod.save_config(self.cfg)
        return {"status": "success", "sort": sort}

    def _folder(self, folder_id):
        fid = _clean_id(folder_id)
        return fid and self.db.query_one("SELECT * FROM folders WHERE id = ?", (fid,))

    def _folder_parent(self, parent_id, project_id):
        """Checks a destination. Returns (parent_id, project_id, error)."""
        parent_id, project_id = _clean_id(parent_id), _clean_id(project_id)
        if parent_id is not None:
            parent = self._folder(parent_id)
            if not parent:
                return None, None, "Parent folder not found."
            return parent_id, parent["project_id"], None
        if project_id is not None and not self.db.query_one("SELECT id FROM projects WHERE id = ?", (project_id,)):
            return None, None, "Project not found."
        return None, project_id, None

    @safe_action
    def create_folder(self, name, parent_id=None, project_id=None):
        """In parent_id if given, else at project_id's root, else at the top level."""
        name = (name or "").strip()
        err = folder_name_error(name)
        if err:
            return {"status": "error", "message": err}
        parent_id, project_id, err = self._folder_parent(parent_id, project_id)
        if err:
            return {"status": "error", "message": err}
        if self.db.sibling_name_taken(name, parent_id, project_id):
            return {"status": "error", "message": f'"{name}" already exists in this folder.'}
        now = utc_now_iso()
        cur = self.db.execute(
            "INSERT INTO folders (name, parent_id, project_id, created_at, updated_at, vault) VALUES (?, ?, ?, ?, ?, ?)",
            (name, parent_id, project_id, now, now, self.db.vault),
        )
        return {"status": "success", "id": cur.lastrowid, "name": name,
                "parent_id": parent_id, "project_id": project_id}

    @safe_action
    def rename_folder(self, folder_id, name):
        folder = self._folder(folder_id)
        if not folder:
            return {"status": "error", "message": "Folder not found."}
        name = (name or "").strip()
        err = folder_name_error(name)
        if err:
            return {"status": "error", "message": err}
        if self.db.sibling_name_taken(name, folder["parent_id"], folder["project_id"], exclude_id=folder["id"]):
            return {"status": "error", "message": f'"{name}" already exists in this folder.'}
        self.db.execute("UPDATE folders SET name = ?, updated_at = ? WHERE id = ?",
                        (name, utc_now_iso(), folder["id"]))
        return {"status": "success", "id": folder["id"], "name": name}

    @safe_action
    def move_folder(self, folder_id, parent_id=None, project_id=None):
        """Into parent_id, or to project_id's root, or to the top level. The
        folder, everything below it and the notes inside take the new project."""
        folder = self._folder(folder_id)
        if not folder:
            return {"status": "error", "message": "Folder not found."}
        parent_id, project_id, err = self._folder_parent(parent_id, project_id)
        if err:
            return {"status": "error", "message": err}
        subtree = self.db.folder_subtree_ids(folder["id"])
        if parent_id in subtree:
            return {"status": "error", "message": "A folder can't go inside itself."}
        if self.db.sibling_name_taken(folder["name"], parent_id, project_id, exclude_id=folder["id"]):
            return {"status": "error", "message": f'"{folder["name"]}" already exists there.'}
        marks = ",".join("?" * len(subtree))
        with self.db._lock:
            self.db.conn.execute("UPDATE folders SET parent_id = ?, updated_at = ? WHERE id = ?",
                                 (parent_id, utc_now_iso(), folder["id"]))
            self.db.conn.execute(f"UPDATE folders SET project_id = ? WHERE id IN ({marks})", (project_id, *subtree))
            self.db.conn.execute(f"UPDATE notes SET project_id = ? WHERE folder_id IN ({marks})", (project_id, *subtree))
            self.db.conn.commit()
        return {"status": "success", "id": folder["id"], "parent_id": parent_id, "project_id": project_id}

    @safe_action
    def delete_folder(self, folder_id, cascade=False):
        """Deletes the folder and the folders inside it. If any notes are
        inside, refuses unless cascade is true, which deletes those notes too.
        (The vault phase will send them to the recycle bin instead.)"""
        folder = self._folder(folder_id)
        if not folder:
            return {"status": "error", "message": "Folder not found."}
        subtree = self.db.folder_subtree_ids(folder["id"])
        marks = ",".join("?" * len(subtree))
        notes = self.db.query_one(f"SELECT COUNT(*) AS n FROM notes WHERE folder_id IN ({marks})", subtree)["n"]
        if notes and not cascade:
            plural = "" if notes == 1 else "s"
            return {"status": "error", "code": "not_empty", "notes": notes,
                    "message": f'"{folder["name"]}" still has {notes} note{plural} inside.'}
        with self.db._lock:
            self.db.conn.execute(f"DELETE FROM notes WHERE folder_id IN ({marks})", subtree)
            self.db.conn.execute("DELETE FROM folders WHERE id = ?", (folder["id"],))  # subfolders cascade
            self.db.conn.commit()
        return {"status": "success", "folders_deleted": len(subtree), "notes_deleted": notes}

    # ------------------------------------------------------------------
    # Tasks
    # ------------------------------------------------------------------

    def _steps_for(self, task_ids):
        """{task_id: [step, ...]} in step order."""
        if not task_ids:
            return {}
        marks = ",".join("?" * len(task_ids))
        out = {}
        for r in self.db.query(
                f"""SELECT id, task_id, text, minutes, done, position FROM task_steps
                    WHERE task_id IN ({marks}) ORDER BY position, id""", tuple(task_ids)):
            step = dict(r)
            step["done"] = bool(step["done"])
            out.setdefault(step["task_id"], []).append(step)
        return out

    @safe_list()
    def list_tasks(self, project_id=None, include_completed=True, note_id=None):
        """Each task carries note_id, energy and its steps."""
        project_id = _clean_id(project_id)
        note_id = _clean_id(note_id)
        sql = """SELECT t.*, p.name AS project_name
                  FROM tasks t LEFT JOIN projects p ON p.id = t.project_id
                  WHERE 1=1"""
        params = []
        if project_id is not None:
            sql += " AND t.project_id = ?"
            params.append(project_id)
        if note_id is not None:
            sql += " AND t.note_id = ?"
            params.append(note_id)
        if not include_completed:
            sql += " AND t.completed = 0"
        sql += " ORDER BY t.completed ASC, t.due_date IS NULL, t.due_date ASC, t.created_at DESC"
        tasks = [dict(r) for r in self.db.query(sql, tuple(params))]
        steps = self._steps_for([t["id"] for t in tasks])
        for task in tasks:
            task["tags"] = self.db.get_tags_for("task_tags", "task_id", task["id"])
            task["steps"] = steps.get(task["id"], [])
        return tasks

    @safe_list(default=None)
    def get_task(self, task_id):
        task_id = _clean_id(task_id)
        if task_id is None:
            return None
        row = self.db.query_one(
            """SELECT t.*, p.name AS project_name
               FROM tasks t LEFT JOIN projects p ON p.id = t.project_id
               WHERE t.id = ?""",
            (task_id,),
        )
        if not row:
            return None
        task = dict(row)
        task["tags"] = self.db.get_tags_for("task_tags", "task_id", task_id)
        task["steps"] = self._steps_for([task_id]).get(task_id, [])
        return task

    @safe_action
    def save_task(self, task_id, title, description, priority, due_date,
                   project_id=None, tags_text="", completed=False, note_id=KEEP, energy=None):
        """note_id: the note this task belongs to (None to unlink); left out,
        an existing task keeps its link. energy: high | medium | low; left out,
        an existing task keeps its energy and a new one gets medium."""
        title = (title or "Untitled Task").strip() or "Untitled Task"
        priority = priority if priority in ("Low", "Medium", "High", "Critical") else "Medium"
        project_id = _clean_id(project_id)
        task_id = _clean_id(task_id)
        due_date = (due_date or "").strip() or None
        if due_date:
            try:
                datetime.strptime(due_date[:10], "%Y-%m-%d")
            except ValueError:
                return {"status": "error", "message": f"Invalid due date: {due_date!r}"}
        if energy is not None and energy not in ENERGY_LEVELS:
            return {"status": "error", "message": "Energy must be high, medium or low."}
        existing = task_id and self.db.query_one("SELECT note_id, energy FROM tasks WHERE id = ?", (task_id,))
        if task_id and not existing:
            return {"status": "error", "message": "Task not found."}
        if note_id == KEEP:
            note_id = existing["note_id"] if existing else None
        else:
            note_id = _clean_id(note_id)
            if note_id is not None and not self.db.query_one("SELECT id FROM notes WHERE id = ?", (note_id,)):
                return {"status": "error", "message": "Note not found."}
        energy = energy or (existing["energy"] if existing else "medium")
        now = utc_now_iso()

        if task_id:
            self.db.execute(
                """UPDATE tasks SET title=?, description=?, priority=?, due_date=?,
                   project_id=?, completed=?, note_id=?, energy=?, updated_at=? WHERE id=?""",
                (title, description, priority, due_date, project_id,
                 1 if completed else 0, note_id, energy, now, task_id),
            )
        else:
            cur = self.db.execute(
                """INSERT INTO tasks (title, description, priority, due_date, project_id,
                   completed, note_id, energy, created_at, updated_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (title, description, priority, due_date, project_id,
                 1 if completed else 0, note_id, energy, now, now),
            )
            task_id = cur.lastrowid

        self.db.set_tags("task_tags", "task_id", task_id, _split_tags(tags_text))
        return {"status": "success", "message": f"Saved '{title}'", "id": task_id,
                "note_id": note_id, "energy": energy}

    @safe_action
    def set_task_energy(self, task_id, energy):
        task_id = _clean_id(task_id)
        if energy not in ENERGY_LEVELS:
            return {"status": "error", "message": "Energy must be high, medium or low."}
        if task_id is None or not self.db.query_one("SELECT id FROM tasks WHERE id = ?", (task_id,)):
            return {"status": "error", "message": "Task not found."}
        self.db.execute("UPDATE tasks SET energy = ?, updated_at = ? WHERE id = ?",
                        (energy, utc_now_iso(), task_id))
        return {"status": "success", "id": task_id, "energy": energy}

    # ---- task steps (the splitter's timed micro-steps) ----

    def _step_fields(self, text, minutes):
        """(text, minutes, error) with text trimmed and minutes a whole number >= 0 or None."""
        text = (text or "").strip()
        if not text:
            return None, None, "Step text can't be empty."
        if minutes in (None, ""):
            return text, None, None
        try:
            minutes = int(minutes)
        except (TypeError, ValueError):
            return None, None, "Minutes must be a whole number."
        if minutes < 0:
            return None, None, "Minutes can't be negative."
        return text, minutes, None

    @safe_action
    def add_task_step(self, task_id, text, minutes=None):
        task_id = _clean_id(task_id)
        if task_id is None or not self.db.query_one("SELECT id FROM tasks WHERE id = ?", (task_id,)):
            return {"status": "error", "message": "Task not found."}
        text, minutes, err = self._step_fields(text, minutes)
        if err:
            return {"status": "error", "message": err}
        pos = self.db.query_one(
            "SELECT COALESCE(MAX(position), -1) + 1 AS p FROM task_steps WHERE task_id = ?", (task_id,))["p"]
        cur = self.db.execute(
            "INSERT INTO task_steps (task_id, text, minutes, done, position) VALUES (?, ?, ?, 0, ?)",
            (task_id, text, minutes, pos),
        )
        return {"status": "success", "step": {"id": cur.lastrowid, "task_id": task_id, "text": text,
                                              "minutes": minutes, "done": False, "position": pos}}

    @safe_action
    def update_task_step(self, step_id, text=None, minutes=KEEP, done=None):
        """Change a step's text, minutes (None clears them) and/or done.
        Arguments left out stay as they are."""
        step_id = _clean_id(step_id)
        row = step_id and self.db.query_one("SELECT * FROM task_steps WHERE id = ?", (step_id,))
        if not row:
            return {"status": "error", "message": "Step not found."}
        text, minutes, err = self._step_fields(
            row["text"] if text is None else text, row["minutes"] if minutes == KEEP else minutes)
        if err:
            return {"status": "error", "message": err}
        done = bool(row["done"]) if done is None else bool(done)
        self.db.execute("UPDATE task_steps SET text = ?, minutes = ?, done = ? WHERE id = ?",
                        (text, minutes, int(done), step_id))
        return {"status": "success", "step": {"id": step_id, "task_id": row["task_id"], "text": text,
                                              "minutes": minutes, "done": done, "position": row["position"]}}

    @safe_action
    def delete_task_step(self, step_id):
        step_id = _clean_id(step_id)
        if step_id is None or not self.db.query_one("SELECT id FROM task_steps WHERE id = ?", (step_id,)):
            return {"status": "error", "message": "Step not found."}
        self.db.execute("DELETE FROM task_steps WHERE id = ?", (step_id,))
        return {"status": "success"}

    @safe_action
    def reorder_task_steps(self, task_id, step_ids):
        """step_ids: every step of the task, in the new order."""
        task_id = _clean_id(task_id)
        if task_id is None or not self.db.query_one("SELECT id FROM tasks WHERE id = ?", (task_id,)):
            return {"status": "error", "message": "Task not found."}
        current = {r["id"] for r in self.db.query("SELECT id FROM task_steps WHERE task_id = ?", (task_id,))}
        ids = [_clean_id(s) for s in (step_ids or [])]
        if set(ids) != current or len(ids) != len(current):
            return {"status": "error", "message": "Give every step of this task exactly once."}
        with self.db._lock:
            for pos, sid in enumerate(ids):
                self.db.conn.execute("UPDATE task_steps SET position = ? WHERE id = ?", (pos, sid))
            self.db.conn.commit()
        return {"status": "success", "steps": self._steps_for([task_id]).get(task_id, [])}

    @safe_action
    def set_task_steps(self, task_id, steps):
        """Replace all of a task's steps at once (the splitter's result).
        steps: [{text, minutes?, done?}, ...]; [] removes them all."""
        task_id = _clean_id(task_id)
        if task_id is None or not self.db.query_one("SELECT id FROM tasks WHERE id = ?", (task_id,)):
            return {"status": "error", "message": "Task not found."}
        clean = []
        for s in steps or []:
            if not isinstance(s, dict):
                return {"status": "error", "message": "Each step must be an object with text."}
            text, minutes, err = self._step_fields(s.get("text"), s.get("minutes"))
            if err:
                return {"status": "error", "message": err}
            clean.append((text, minutes, int(bool(s.get("done")))))
        with self.db._lock:
            self.db.conn.execute("DELETE FROM task_steps WHERE task_id = ?", (task_id,))
            for pos, (text, minutes, done) in enumerate(clean):
                self.db.conn.execute(
                    "INSERT INTO task_steps (task_id, text, minutes, done, position) VALUES (?, ?, ?, ?, ?)",
                    (task_id, text, minutes, done, pos))
            self.db.conn.commit()
        return {"status": "success", "steps": self._steps_for([task_id]).get(task_id, [])}

    @safe_action
    def toggle_task(self, task_id):
        task_id = _clean_id(task_id)
        if task_id is None:
            return {"status": "error", "message": "Invalid task id."}
        row = self.db.query_one("SELECT completed FROM tasks WHERE id = ?", (task_id,))
        if not row:
            return {"status": "error", "message": "Task not found."}
        new_state = 0 if row["completed"] else 1
        self.db.execute(
            "UPDATE tasks SET completed = ?, updated_at = ? WHERE id = ?",
            (new_state, utc_now_iso(), task_id),
        )
        return {"status": "success", "completed": bool(new_state)}

    # ---- Phase 3: change a task's title or done state without re-sending the rest ----
    @safe_action
    def update_task(self, task_id, title=None, completed=None, due_date=KEEP):
        """A None argument is left as it is. For ticks (board, note) and
        `- [ ]` lines renamed in a note: save_task would need every field.
        Build I: due_date "YYYY-MM-DD" sets the due date, None or "" clears it
        (Later); left out, it stays."""
        task_id = _clean_id(task_id)
        row = task_id and self.db.query_one("SELECT title, completed, due_date FROM tasks WHERE id = ?", (task_id,))
        if not row:
            return {"status": "error", "message": "Task not found."}
        if title is not None:
            title = str(title).strip()
            if not title:
                return {"status": "error", "message": "A task needs a title."}
        if due_date == KEEP:
            due_date = row["due_date"]
        else:
            due_date, err = _due_date(due_date)
            if err:
                return {"status": "error", "message": err}
        title = row["title"] if title is None else title
        completed = bool(row["completed"]) if completed is None else bool(completed)
        self.db.execute("UPDATE tasks SET title = ?, completed = ?, due_date = ?, updated_at = ? WHERE id = ?",
                        (title, int(completed), due_date, utc_now_iso(), task_id))
        return {"status": "success", "id": task_id, "title": title, "completed": completed, "due_date": due_date}

    @safe_action
    def delete_task(self, task_id):
        task_id = _clean_id(task_id)
        if task_id is None:
            return {"status": "error", "message": "Invalid task id."}
        self.db.execute("DELETE FROM tasks WHERE id = ?", (task_id,))
        return {"status": "success"}

    # ==== Build I · the Tasks page: Delete with Undo, and Ctrl+K searching the text of notes ====
    # Delete moves the task into task_bin (db.py) and Undo puts it back under its old id. delete_task above stays a
    # hard delete: it is how a note's removed "- [ ]" line drops its task. Search reads the notes' saved text.

    @safe_action
    def trash_task(self, task_id):
        """Delete a task with its steps and tags, keeping a copy in the bin for
        restore_task. Returns bin_id. A timer running on it loses the link
        (as a hard delete does) and gets it back on restore."""
        task_id = _clean_id(task_id)
        row = task_id and self.db.query_one("SELECT * FROM tasks WHERE id = ?", (task_id,))
        if not row:
            return {"status": "error", "message": "Task not found."}
        steps = [dict(r) for r in self.db.query(
            "SELECT * FROM task_steps WHERE task_id = ? ORDER BY position, id", (task_id,))]
        tags = self.db.get_tags_for("task_tags", "task_id", task_id)
        run = self.db.query_one("SELECT started_at FROM running_session WHERE id = 1 AND task_id = ?", (task_id,))
        data = {"task": dict(row), "steps": steps, "tags": tags, "running": run["started_at"] if run else None}
        now = utc_now_iso()
        purge_before = (datetime.fromisoformat(now.replace("Z", "+00:00")) - timedelta(days=TASK_BIN_DAYS)).isoformat()
        with self.db._lock:
            cur = self.db.conn.execute(
                "INSERT INTO task_bin (task_id, title, data, deleted_at) VALUES (?, ?, ?, ?)",
                (task_id, row["title"], json.dumps(data), now))
            self.db.conn.execute("DELETE FROM tasks WHERE id = ?", (task_id,))
            self.db.conn.execute("DELETE FROM task_bin WHERE deleted_at < ?", (purge_before,))
            self.db.conn.commit()
        return {"status": "success", "bin_id": cur.lastrowid, "id": task_id, "title": row["title"]}

    @safe_action
    def restore_task(self, bin_id):
        """Undo a trash_task: the task comes back under its old id with its
        steps, tags and done time. A note or project deleted since leaves it
        unlinked. Returns the task as get_task does."""
        bin_id = _clean_id(bin_id)
        row = bin_id and self.db.query_one("SELECT * FROM task_bin WHERE id = ?", (bin_id,))
        if not row:
            return {"status": "error", "message": "That task isn't in the bin any more."}
        data = json.loads(row["data"])
        task = dict(data["task"])
        if self.db.query_one("SELECT id FROM tasks WHERE id = ?", (task["id"],)):
            return {"status": "error", "message": "That task is already back."}
        for col, table in (("note_id", "notes"), ("project_id", "projects")):
            if task.get(col) is not None and not self.db.query_one(f"SELECT id FROM {table} WHERE id = ?", (task[col],)):
                task[col] = None
        cols = [c for c in task if c in self.db._columns("tasks")]
        step_cols = self.db._columns("task_steps")
        with self.db._lock:
            self.db.conn.execute(
                f"INSERT INTO tasks ({', '.join(cols)}) VALUES ({', '.join('?' * len(cols))})",
                tuple(task[c] for c in cols))
            for st in data.get("steps") or []:
                sc = [c for c in st if c in step_cols]
                self.db.conn.execute(
                    f"INSERT INTO task_steps ({', '.join(sc)}) VALUES ({', '.join('?' * len(sc))})",
                    tuple(st[c] for c in sc))
            if data.get("running"):
                self.db.conn.execute(
                    "UPDATE running_session SET task_id = ? WHERE id = 1 AND task_id IS NULL AND started_at = ?",
                    (task["id"], data["running"]))
            self.db.conn.execute("DELETE FROM task_bin WHERE id = ?", (bin_id,))
            self.db.conn.commit()
        self.db.set_tags("task_tags", "task_id", task["id"], data.get("tags") or [])
        return {"status": "success", "task": self.get_task(task["id"])}

    _SEARCH_LINE = 160  # characters of the matching line sent back

    @safe_list()
    def search_notes(self, query, limit=20):
        """Notes whose title or text holds query (any case), most recently
        edited first. Each: note_id, title, title_match, matches (in the
        text), and the first matching line: line (trimmed), line_no (0-based
        in the saved Markdown) and col (where the match starts in that line).
        A note matching by its title only has line None. A query under 2
        characters returns []."""
        q = " ".join(str(query or "").split()).casefold()
        if len(q) < 2:
            return []
        try:
            limit = max(1, min(int(limit), 200))
        except (TypeError, ValueError):
            limit = 20
        out = []
        for r in self.db.query("SELECT id, title, content FROM notes WHERE vault IS ? ORDER BY updated_at DESC, id DESC", (self.db.vault,)):
            title, text = r["title"] or "", r["content"] or ""
            low, hit = text.casefold(), None
            if q in low:
                for i, line in enumerate(text.split("\n")):
                    col = line.casefold().find(q)
                    if col >= 0 and line.strip() != "{{tasks}}":
                        hit = (i, line.rstrip("\r"), col)
                        break
            title_match = q in title.casefold()
            if not hit and not title_match:
                continue
            item = {"note_id": r["id"], "title": title, "title_match": title_match,
                    "matches": low.count(q), "line": None, "line_no": None, "col": None}
            if hit:
                i, line, col = hit
                lead = len(line) - len(line.lstrip())
                line, col = line.strip(), col - lead
                if len(line) > self._SEARCH_LINE:   # keep the match in view: start a little before it
                    start = max(0, min(col - 40, len(line) - self._SEARCH_LINE))
                    cut = line[start:start + self._SEARCH_LINE]
                    line = ("…" if start else "") + cut + ("…" if start + self._SEARCH_LINE < len(line) else "")
                    col = col - start + (1 if start else 0)
                item.update(line=line, line_no=i, col=col)
            out.append(item)
            if len(out) >= limit:
                break
        return out
    # ==== end Build I ====

    # ==== Phase 6A · sticky notes and the brain dump inbox ====================
    # SQLite for now, shaped like their future files (db.py, CAPTURE_SCHEMA):
    # a sticky becomes stickynoted/<file>, the inbox becomes _inbox.md.

    _STICKY_MAX_TEXT = 100_000
    _INBOX_MAX_TEXT = 10_000

    def _sticky_view(self, row):
        s = dict(row)
        s["open"] = bool(s["open"])
        s["file"] = "stickynoted/" + s.pop("file_name")
        # Build H: popped out (its own desktop window) and kept on top; the desktop place stays in Python (popout.py)
        s["out"], s["on_top"] = bool(s.get("out")), s.get("on_top", 1) != 0
        for k in ("desk_x", "desk_y", "desk_w", "desk_h", "desk_screen"):
            s.pop(k, None)
        return s

    def _sticky_row(self, sticky_id):
        sticky_id = _clean_id(sticky_id)
        return sticky_id and self.db.query_one("SELECT * FROM stickies WHERE id = ?", (sticky_id,))

    def _colour_error(self):
        return {"status": "error", "message": "Colour must be one of " + ", ".join(STICKY_COLOURS) + "."}

    @safe_list()
    def list_stickies(self):
        """Every sticky note, open (shown on the overlay) or closed, by number."""
        return [self._sticky_view(r) for r in self.db.query("SELECT * FROM stickies ORDER BY n, id")]

    @safe_action
    def create_sticky(self, text="", color=None):
        """A new, open sticky. Its number is one more than the highest in use;
        without a colour it takes the next of the five in turn."""
        text = str(text or "")
        if len(text) > self._STICKY_MAX_TEXT:
            return {"status": "error", "message": "That sticky note is too long."}
        if color is not None and color not in STICKY_COLOURS:
            return self._colour_error()
        n = (self.db.query_one("SELECT MAX(n) AS n FROM stickies")["n"] or 0) + 1
        color = color or STICKY_COLOURS[(n - 1) % len(STICKY_COLOURS)]
        now = _local_now()
        base = now.strftime("%Y-%m-%d-%H%M")
        name, k = base + ".md", 2
        while self.db.query_one("SELECT 1 FROM stickies WHERE file_name = ?", (name,)):
            name, k = f"{base}-{k}.md", k + 1
        stamp = now.isoformat()
        cur = self.db.execute(
            """INSERT INTO stickies (n, text, color, open, file_name, created_at, updated_at)
               VALUES (?, ?, ?, 1, ?, ?, ?)""", (n, text, color, name, stamp, stamp))
        return {"status": "success", "sticky": self._sticky_view(self._sticky_row(cur.lastrowid))}

    @safe_action
    def update_sticky(self, sticky_id, patch):
        """patch: any of text, color, open, x, y, w, h. x/y/w/h are whole pixels
        (None forgets them, so the card goes back to its default place or size)."""
        row = self._sticky_row(sticky_id)
        if not row:
            return {"status": "error", "message": "Sticky note not found.", "gone": True}   # Fix C (QC 18): the card can go
        if not isinstance(patch, dict) or not patch:
            return {"status": "error", "message": "Nothing to change."}
        bad = sorted(set(patch) - {"text", "color", "open", "x", "y", "w", "h"})
        if bad:
            return {"status": "error", "message": "Unknown sticky field: " + ", ".join(bad)}
        sets = {}
        if "text" in patch:
            text = str(patch["text"] or "")
            if len(text) > self._STICKY_MAX_TEXT:
                return {"status": "error", "message": "That sticky note is too long."}
            sets["text"] = text
        if "color" in patch:
            if patch["color"] not in STICKY_COLOURS:
                return self._colour_error()
            sets["color"] = patch["color"]
        if "open" in patch:
            sets["open"] = 1 if patch["open"] else 0
        for k in ("x", "y", "w", "h"):
            if k in patch:
                v = patch[k]
                if v is not None:
                    try:
                        v = int(round(float(v)))
                    except (TypeError, ValueError):
                        return {"status": "error", "message": f"{k} must be a number of pixels."}
                    if not -10_000 <= v <= 20_000:
                        return {"status": "error", "message": f"{k} is out of range."}
                sets[k] = v
        if "text" in sets or "color" in sets:   # an edit; moving, sizing or closing a card isn't
            sets["updated_at"] = _local_now().isoformat()
        cols = ", ".join(f"{k} = ?" for k in sets)
        self.db.execute(f"UPDATE stickies SET {cols} WHERE id = ?", (*sets.values(), row["id"]))
        return {"status": "success", "sticky": self._sticky_view(self._sticky_row(row["id"]))}

    @safe_action
    def delete_sticky(self, sticky_id):
        """Used once a sticky has become a note or a task, or when an empty one is closed.
        Fix C (QC 18): one that's already gone says gone: True, and its window (if one is left) still closes."""
        row = self._sticky_row(sticky_id)
        if not row:
            return {"status": "error", "message": "Sticky note not found.", "gone": True}
        self.db.execute("DELETE FROM stickies WHERE id = ?", (row["id"],))
        return {"status": "success", "id": row["id"]}

    @safe_action
    def get_sticky_file(self, sticky_id):
        """{status, file, text}: the sticky as the vault-on-disk build will write it."""
        row = self._sticky_row(sticky_id)
        if not row:
            return {"status": "error", "message": "Sticky note not found."}
        s = self._sticky_view(row)
        return {"status": "success", "file": s["file"], "text": sticky_file_text(s)}

    def _inbox_view(self, row):
        it = dict(row)
        it["done"] = bool(it["done"])
        it["day"], it["time"] = it["created_at"][:10], it["created_at"][11:16]
        it["tasks"] = json.loads(it.get("tasks") or "[]")   # Build A: a voice thought's tasks (thoughts saved before Build A+)
        it["task_ids"] = json.loads(it.get("task_ids") or "[]")   # Build A+: the board tasks they became
        return it

    def _inbox_text(self, text):
        """(clean text, error message): one line, spaces squeezed."""
        text = " ".join(str(text or "").split())
        if not text:
            return None, "Type a thought first."
        if len(text) > self._INBOX_MAX_TEXT:
            return None, "That thought is too long for the inbox."
        return text, None

    @safe_list()
    def list_inbox(self, include_done=False):
        """Brain-dump thoughts, oldest first. Done ones (triaged at wrap-up) only on request."""
        sql = "SELECT * FROM inbox_items" + ("" if include_done else " WHERE done = 0") + " ORDER BY created_at, id"
        return [self._inbox_view(r) for r in self.db.query(sql)]

    @safe_action
    def add_inbox_item(self, text):
        """One thought, stamped with the local time. No folder, no title: that's the point."""
        text, err = self._inbox_text(text)
        if err:
            return {"status": "error", "message": err}
        cur = self.db.execute("INSERT INTO inbox_items (text, done, created_at) VALUES (?, 0, ?)",
                              (text, _local_now().isoformat()))
        row = self.db.query_one("SELECT * FROM inbox_items WHERE id = ?", (cur.lastrowid,))
        return {"status": "success", "item": self._inbox_view(row)}

    @safe_action
    def update_inbox_item(self, item_id, text=None, done=None):
        """A None argument is left as it is."""
        item_id = _clean_id(item_id)
        row = item_id and self.db.query_one("SELECT * FROM inbox_items WHERE id = ?", (item_id,))
        if not row:
            return {"status": "error", "message": "That Brain Dump thought isn't there any more."}  # Fix C (QC 20)
        if text is not None:
            text, err = self._inbox_text(text)
            if err:
                return {"status": "error", "message": err}
        self.db.execute("UPDATE inbox_items SET text = ?, done = ? WHERE id = ?",
                        (row["text"] if text is None else text,
                         row["done"] if done is None else int(bool(done)), item_id))
        return {"status": "success", "item": self._inbox_view(
            self.db.query_one("SELECT * FROM inbox_items WHERE id = ?", (item_id,)))}

    @safe_action
    def delete_inbox_item(self, item_id):
        item_id = _clean_id(item_id)
        if item_id is None or not self.db.query_one("SELECT 1 FROM inbox_items WHERE id = ?", (item_id,)):
            return {"status": "error", "message": "That Brain Dump thought isn't there any more."}  # Fix C (QC 20)
        self.db.execute("DELETE FROM inbox_items WHERE id = ?", (item_id,))
        return {"status": "success", "id": item_id}

    @safe_action
    def get_inbox_markdown(self):
        """{status, file, text}: the whole inbox, done thoughts too, as _inbox.md."""
        rows = [self._inbox_view(r) for r in self.db.query("SELECT * FROM inbox_items")]
        return {"status": "success", "file": "_inbox.md", "text": inbox_markdown(rows)}
    # ==== end Phase 6A ========================================================

    # ------------------------------------------------------------------
    # Timer: sessions, insights, categories-as-projects
    # ------------------------------------------------------------------

    @safe_action
    def log_session(self, project_id, start_iso, end_iso, target_seconds, actual_seconds,
                     energy=None, focus=None, is_unplanned=False, pauses=None, milestones=None):
        project_id = _clean_id(project_id)
        if project_id is None:
            return {"status": "error", "message": "A project must be selected to log a session."}
        try:
            start_dt = datetime.fromisoformat(start_iso)
            end_dt = datetime.fromisoformat(end_iso)
        except (TypeError, ValueError):
            return {"status": "error", "message": "Invalid session start/end time."}

        session = self.db.log_session(
            project_id, start_iso, end_iso, int(target_seconds or 0), int(actual_seconds or 0),
            energy=energy, focus=focus, is_unplanned=bool(is_unplanned),
            pauses=pauses, milestones=milestones,
        )

        vault_status = None
        vault_path = self.cfg.get("obsidian_vault_path", "").strip()
        if vault_path:
            today_total_min = round(self.db.get_stats_today()["total_seconds"] / 60)
            ok, msg = vault.export_session(
                vault_path, session["project_name"], start_dt, end_dt,
                session["target_seconds"], session["actual_seconds"], today_total_min,
                energy=energy, focus=focus, is_unplanned=bool(is_unplanned),
                pauses=pauses, milestones=milestones,
            )
            vault_status = {"ok": ok, "message": msg}

        return {"session": session, "dashboard": self.get_dashboard_data(), "vault_status": vault_status}

    @safe_list()
    def get_recent_sessions(self, limit=200):
        return self.db.get_recent_sessions(limit=limit)

    @safe_list()
    def get_project_time_stats(self):
        """All-time session totals per project, for the timer's Categories page."""
        return self.db.get_project_time_stats()

    @safe_list()
    def list_sessions(self, limit=500):
        """Logged sessions newest first, with pauses and milestones, shaped
        like the new front end's D.sessions (color = project colour slot)."""
        try:
            limit = max(1, int(limit))
        except (TypeError, ValueError):
            limit = 500
        return self.db.list_sessions(limit)

    # ---- running session: a timer that survives the app closing ----
    #
    # One row (running_session.id = 1) holds the session in progress as wall-
    # clock times, so elapsed time is worked out from the clock, not from a
    # JS counter that dies with the window. The front end calls
    # get_running_session on launch to pick it back up.

    def _running_row(self):
        return self.db.query_one("SELECT * FROM running_session WHERE id = 1")

    def _running_view(self, row, now=None):
        """The stored row plus the numbers the timer view draws."""
        if not row:
            return None
        now = now or _local_now()
        r = dict(row)
        r["pauses"] = json.loads(r["pauses"] or "[]")
        r["milestones"] = json.loads(r["milestones"] or "[]")
        start = datetime.fromisoformat(r["started_at"])
        end = datetime.fromisoformat(r["stopped_at"]) if r["stopped_at"] else now
        paused = sum(p["duration_seconds"] for p in r["pauses"])
        if r["paused_at"]:
            paused += max(0, int((end - datetime.fromisoformat(r["paused_at"])).total_seconds()))
        r["paused_seconds"] = paused
        r["elapsed_seconds"] = max(0, int((end - start).total_seconds()) - paused)
        r["state"] = "stopped" if r["stopped_at"] else "paused" if r["paused_at"] else "running"
        r["is_over"] = r["mode"] == "planned" and r["elapsed_seconds"] > r["target_seconds"]
        # Time since the front end last checked in: large after the app was closed.
        r["away_seconds"] = 0 if r["stopped_at"] else max(
            0, int((now - datetime.fromisoformat(r["last_seen_at"])).total_seconds()))
        proj = r["project_id"] and self.db.query_one(
            "SELECT name, color_slot FROM projects WHERE id = ?", (r["project_id"],))
        r["project_name"] = proj["name"] if proj else None
        r["color"] = proj["color_slot"] if proj else None
        return r

    @safe_list(default=None)
    def get_running_session(self):
        """The session in progress, or None. Call on launch to recover it."""
        return self._running_view(self._running_row())

    @safe_action
    def start_running_session(self, project_id, target_seconds=0, mode="planned", task_id=None):
        """mode: planned (counts down from target_seconds) or stopwatch."""
        if self._running_row():
            return {"status": "error", "code": "already_running",
                    "message": "A session is already running. Finish or discard it first."}
        project_id = _clean_id(project_id)
        if project_id is None or not self.db.query_one("SELECT id FROM projects WHERE id = ?", (project_id,)):
            return {"status": "error", "message": "Pick a project for this session."}
        if mode not in ("planned", "stopwatch"):
            return {"status": "error", "message": "Mode must be planned or stopwatch."}
        try:
            target = int(target_seconds or 0)
        except (TypeError, ValueError):
            return {"status": "error", "message": "Target must be a whole number of seconds."}
        if mode == "planned" and target <= 0:
            return {"status": "error", "message": "A planned session needs a target above 0 minutes."}
        if mode == "stopwatch":
            target = 0
        task_id = _clean_id(task_id)
        if task_id is not None and not self.db.query_one("SELECT id FROM tasks WHERE id = ?", (task_id,)):
            return {"status": "error", "message": "Task not found."}
        now = _local_now().isoformat()
        self.db.execute(
            """INSERT INTO running_session (id, project_id, task_id, mode, target_seconds, started_at, last_seen_at)
               VALUES (1, ?, ?, ?, ?, ?, ?)""",
            (project_id, task_id, mode, target, now, now),
        )
        return {"status": "success", "session": self.get_running_session()}

    @safe_action
    def update_running_session(self, action, value=None):
        """action, with value where it needs one:
        pause (reason) · resume · checkin (note) · retarget (seconds) ·
        stop (ends the clock; the rating step comes next) · heartbeat (the
        front end is still open; send about once a minute) · away (count the
        time since the last heartbeat as a pause, value = reason, default
        "App closed")."""
        row = self._running_row()
        if not row:
            return {"status": "error", "code": "not_running", "message": "No session is running."}
        now = _local_now()
        view = self._running_view(row, now)
        stamp = now.isoformat()
        sets = {"last_seen_at": stamp}
        pauses, milestones = view["pauses"], view["milestones"]

        def close_pause():
            start = row["paused_at"]
            secs = max(0, int((now - datetime.fromisoformat(start)).total_seconds()))
            pauses.append({"category": row["pause_reason"] or "Pause", "start_iso": start,
                           "end_iso": stamp, "duration_seconds": secs})
            sets.update(paused_at=None, pause_reason=None, pauses=json.dumps(pauses))

        if view["state"] == "stopped" and action != "heartbeat":
            return {"status": "error", "message": "This session has stopped. Finish or discard it."}
        if action == "pause":
            if row["paused_at"]:
                return {"status": "error", "message": "Already paused."}
            reason = (value or "").strip()
            if not reason:
                return {"status": "error", "message": "Pick a reason for the pause."}
            sets.update(paused_at=stamp, pause_reason=reason)
        elif action == "resume":
            if not row["paused_at"]:
                return {"status": "error", "message": "Not paused."}
            close_pause()
        elif action == "checkin":
            note = (value or "").strip()
            if not note:
                return {"status": "error", "message": "Write what you did for the check-in."}
            milestones.append({"note": note, "at_iso": stamp, "elapsed_seconds": view["elapsed_seconds"]})
            sets["milestones"] = json.dumps(milestones)
        elif action == "retarget":
            try:
                target = int(value)
            except (TypeError, ValueError):
                return {"status": "error", "message": "Target must be a whole number of seconds."}
            if row["mode"] != "planned" or target <= 0:
                return {"status": "error", "message": "Only a planned session takes a target above 0."}
            sets["target_seconds"] = target
        elif action == "stop":
            if row["paused_at"]:
                close_pause()
            sets["stopped_at"] = stamp
        elif action == "away":
            if not row["paused_at"] and view["away_seconds"] > 0:
                pauses.append({"category": (value or "").strip() or "App closed",
                               "start_iso": row["last_seen_at"], "end_iso": stamp,
                               "duration_seconds": view["away_seconds"]})
                sets["pauses"] = json.dumps(pauses)
        elif action != "heartbeat":
            return {"status": "error", "message": f"Unknown action: {action!r}."}

        cols = ", ".join(f"{k} = ?" for k in sets)
        self.db.execute(f"UPDATE running_session SET {cols} WHERE id = 1", tuple(sets.values()))
        return {"status": "success", "session": self.get_running_session()}

    @safe_action
    def finish_running_session(self, energy=None, focus=None, project_id=None):
        """Logs the running session as a normal session (stopping it first if
        needed) and clears the record. energy / focus are the 1-5 ratings, or
        None to skip rating. project_id overrides the project, e.g. when the
        original one was deleted. Returns log_session's result."""
        row = self._running_row()
        if not row:
            return {"status": "error", "code": "not_running", "message": "No session is running."}
        if not row["stopped_at"]:
            stopped = self.update_running_session("stop")
            if stopped.get("status") != "success":
                return stopped
            row = self._running_row()
        view = self._running_view(row)
        project = _clean_id(project_id) or view["project_id"]
        result = self.log_session(
            project, view["started_at"], view["stopped_at"], view["target_seconds"], view["elapsed_seconds"],
            energy=_rating(energy), focus=_rating(focus), is_unplanned=view["mode"] == "stopwatch",
            pauses=view["pauses"], milestones=view["milestones"],
        )
        if result.get("status") == "error":
            return result  # the record stays, so nothing is lost
        self.db.execute("DELETE FROM running_session WHERE id = 1")
        return {"status": "success", **result}

    @safe_action
    def discard_running_session(self):
        """Throws the running session away without logging it."""
        self.db.execute("DELETE FROM running_session WHERE id = 1")
        return {"status": "success"}

    @safe_action
    def export_csv(self):
        if not self._window:
            return {"ok": False, "message": "Window not ready."}
        rows = self.db.get_all_sessions_for_export()
        default_name = f"neurovault-sessions-{datetime.now().strftime('%Y%m%d')}.csv"
        result = self._window.create_file_dialog(webview.SAVE_DIALOG, save_filename=default_name)
        if not result:
            return {"ok": False, "message": "Cancelled."}
        path = result[0] if isinstance(result, (tuple, list)) else result

        headers = ["id", "start_time", "end_time", "project_name", "target_seconds", "actual_seconds",
                   "overtime_seconds", "energy", "focus", "is_unplanned", "pause_count", "pause_seconds",
                   "milestone_count"]
        try:
            with open(path, "w", newline="", encoding="utf-8") as f:
                writer = csv.DictWriter(f, fieldnames=headers, extrasaction="ignore")
                writer.writeheader()
                for r in rows:
                    writer.writerow(r)
        except OSError as e:
            return {"ok": False, "message": plain_error(e, "write the file")}
        return {"ok": True, "message": f"Exported {len(rows)} sessions to {path}"}

    # ---- dashboard (Timer > Log session page) ----
    @safe_list(default={})
    def get_dashboard_data(self):
        today = datetime.now().strftime("%Y-%m-%d")
        return {
            "categories": self.list_projects(),
            "today_sessions": self.db.get_sessions_for_day(today),
            "stats_today": self.db.get_stats_today(),
            "stats_week": self.db.get_stats_week(),
            "streak": self.db.get_streak(),
            "ui_prefs": self._ui_prefs(),
        }

    # ---- Timer > Insights page ----
    @safe_list(default={})
    def get_insights(self):
        return {
            "heatmap": self.db.get_heatmap(weeks=12),
            "breakdown_alltime": self.db.get_project_breakdown_alltime(),
            "averages": self.db.get_averages(),
            "estimation": self.db.get_estimation_analytics(),
            "pauses": self.db.get_pause_analytics(),
        }

    # ------------------------------------------------------------------
    # Settings
    # ------------------------------------------------------------------

    def _ui_prefs(self):
        vault_path = self.cfg.get("obsidian_vault_path", "").strip()
        return {
            "sidebar_collapsed": self.cfg.get("sidebar_collapsed", False),
            "theme": self.cfg.get("theme", "obsidian"),
            "vault_name": os.path.basename(vault_path.rstrip("/\\")) if vault_path else None,
        }

    @safe_list(default={})
    def get_settings(self):
        s = dict(self.cfg)
        s["vault_name"] = self._ui_prefs()["vault_name"]
        s["db_path"] = self.db.path
        s["app_version"] = VERSION   # Settings → About (version.py)
        return s

    @safe_action
    def save_settings(self, patch):
        """patch: partial dict of any config keys to update. Reader settings
        (theme, font, comfort_* ...) are checked; a bad value is not saved and
        is listed in the result's "rejected" as {key: message}."""
        if not isinstance(patch, dict):
            return self.get_settings()
        rejected, clean = {}, {}
        for key, value in patch.items():
            value, err = cfgmod.check_reader_setting(key, value)
            if err:
                rejected[key] = err
            else:
                clean[key] = value
        if clean.get("theme") and clean["theme"] not in cfgmod.DARK_THEMES:
            clean["last_light_theme"] = clean["theme"]  # what the rail's light/dark button returns to
        self.cfg.update(clean)
        cfgmod.save_config(self.cfg)
        result = self.get_settings()
        if rejected:
            result["rejected"] = rejected
        return result

    def browse_vault_folder(self):
        if not self._window:
            return None
        try:
            result = self._window.create_file_dialog(webview.FOLDER_DIALOG)
        except Exception:
            log.exception("browse_vault_folder failed")
            return None
        return result[0] if result else None

    def browse_sound_file(self):
        if not self._window:
            return None
        try:
            result = self._window.create_file_dialog(
                webview.OPEN_DIALOG, file_types=("Audio Files (*.wav;*.mp3)", "All files (*.*)")
            )
        except Exception:
            log.exception("browse_sound_file failed")
            return None
        return result[0] if result else None

    # ---- Phase 5 · settings: the custom alert sound, read for the page ----
    # The page is served over http, so it can't open a file:/// path itself. This reads
    # only the file chosen in Settings (notify_custom_sound_path), never a path from the page.
    _SOUND_TYPES = {".wav": "audio/wav", ".mp3": "audio/mpeg", ".ogg": "audio/ogg"}
    _SOUND_MAX_BYTES = 10 * 1024 * 1024

    @safe_action
    def read_custom_sound(self):
        """{status, name, data_url} for the custom alert sound, so Preview and time-up can play it."""
        path = (self.cfg.get("notify_custom_sound_path") or "").strip()
        if not path:
            return {"status": "error", "message": "No custom sound is chosen."}
        kind = self._SOUND_TYPES.get(os.path.splitext(path)[1].lower())
        if not kind:
            return {"status": "error", "message": "The sound must be a .wav, .mp3 or .ogg file."}
        if not os.path.isfile(path):
            return {"status": "error", "message": f"Sound file not found: {os.path.basename(path)}"}
        if os.path.getsize(path) > self._SOUND_MAX_BYTES:
            return {"status": "error", "message": "The sound file is over 10 MB."}
        with open(path, "rb") as f:
            data = base64.b64encode(f.read()).decode("ascii")
        return {"status": "success", "name": os.path.basename(path), "data_url": f"data:{kind};base64,{data}"}
    # ---- end Phase 5 ----

    # ---- Phase 6C · read aloud: the sherpa-onnx engine (read_aloud.py). Windows voices run in the page. ----
    @safe_action
    def read_aloud_status(self):
        """{status, available, voices: [{id, label}], models, folder, message}: the Kokoro / Piper voices on this PC."""
        return read_aloud.status()

    @safe_action
    def read_aloud_speak(self, text, voice="", speed=1.0):
        """{status, audio (a WAV data: URL), duration, words: [[start, end], ...]} for one sentence."""
        if not isinstance(text, str):
            return {"status": "error", "message": "Nothing to read."}
        return read_aloud.speak(text, voice, speed)

    # ==== Fix B (QC round 3): the whole note made ahead by background workers, cached, polled by the page ====
    @safe_action
    def read_aloud_start(self, pieces, voice="", speed=1.0, at=0):
        """Starts making a note's pieces (short texts) from piece `at`. {status, job, total, voice, made, wait, durs}."""
        return read_aloud.start(pieces, voice, speed, at)

    @safe_action
    def read_aloud_poll(self, job, at=0, want=None):
        """{state, made, total, wait, durs, pieces: {index: {audio, sr, dur, words}}} for the made pieces in `want`."""
        return read_aloud.poll(job, at, want)

    @safe_action
    def read_aloud_stop(self, job=None):
        return read_aloud.stop(job)
    # ==== end Fix B ====
    # ---- end Phase 6C ----

    def test_vault_connection(self):
        vault_path = self.cfg.get("obsidian_vault_path", "").strip()
        ok, msg = vault.test_connection(vault_path)
        return {"ok": ok, "message": msg}

    # ------------------------------------------------------------------
    # Notifications
    # ------------------------------------------------------------------

    def flash_taskbar(self):
        return platform_layer.flash()

    # ------------------------------------------------------------------
    # Window — the app draws its own window bar (main.py: frameless), so its
    # buttons, its drag area and the resize edges call these
    # ------------------------------------------------------------------

    def window_minimize(self):
        if not self._window:
            return False
        self._window.minimize()
        return True

    def window_is_maximized(self):
        return winframe.is_maximized(self._window) if self._window else self.maximized

    def window_toggle_maximize(self):
        """Maximise, or restore if maximised. Returns the new state.
        Bug fix 2026-10-16: the state comes from Windows (IsZoomed), not a flag that could fall out of step."""
        if not self._window:
            return False
        target = not winframe.is_maximized(self._window)
        self.maximized = target
        if target:
            winframe.fit_maximized_bounds(self._window)
            self._window.maximize()
        else:
            self._window.restore()
        return target

    def window_fill(self, axis):
        """Double-click on a window edge: 'v' (top or bottom edge) stretches the window to the
        screen's full height, 'h' (left or right edge) to its full width. Bug fix 2026-10-16."""
        if not self._window or winframe.is_maximized(self._window):
            return False
        return winframe.fill(self._window, axis)

    def window_close(self):
        """Build H: with a sticky or the timer popped out, NeuroVault goes to the tray (pystray) so they stay;
        otherwise the popped-out windows close with it. Returns "tray", or True once it has quit."""
        if not self._window:
            return False
        return self._pop.close_main()

    def window_start_drag(self, part):
        """part: 'caption' to move the window, or the edge or corner being
        resized ('n', 's', 'e', 'w', 'nw', 'ne', 'sw', 'se')."""
        if not self._window or part not in winframe.HIT or (part != "caption" and winframe.is_maximized(self._window)):
            return False
        if part == "caption":
            winframe.fit_maximized_bounds(self._window)   # snapping to the top of the screen maximises
        return winframe.start_drag(self._window, part)

    def on_window_state(self, maximized):
        """main.py calls this when Windows maximises or restores the window
        (the buttons, Win+Up, snapping), so the bar's Maximise / Restore icon follows."""
        self.maximized = bool(maximized)
        if not self.maximized:
            winframe.repaint(self._window)   # bug fix 2026-10-16: WebView2 could stay blank after a restore from minimised
        if self._window:
            try:
                self._window.evaluate_js(f"window.nvWindowState && window.nvWindowState({'true' if self.maximized else 'false'})")
            except Exception:
                log.exception("on_window_state failed")

    # ---- Phase 6B · voice rambler: record, transcribe offline (sherpa-onnx Whisper), tidy by rules, anchor check ----
    # The page starts a recording, polls it for the timer and level, stops it, and polls again while Whisper
    # works (a long ramble takes longer than the bridge's 8-second wait, so nothing here blocks). voice.py has
    # the engine; its Recorder is reusable (the wrap-up's 10-second memo). Settings: voice_stt_model, voice_mic.

    def _voice(self):
        if not hasattr(self, "_voice_session"):
            self._voice_session = voicemod.Session()
        return self._voice_session

    def _voice_model(self):
        name = self.cfg.get("voice_stt_model") or voicemod.DEFAULT_MODEL
        return name if name in voicemod.MODELS else voicemod.DEFAULT_MODEL

    @safe_action
    def voice_status(self):
        """{status, model, models, mics, mic, stage, download}: what the voice dialog and Settings → Voice show."""
        try:
            mics, mic_error = voicemod.list_mics(), ""
        except voicemod.VoiceError as e:
            mics, mic_error = [], plain_error(e)
        return {"status": "success", "model": voicemod.model_info(self._voice_model()),
                "models": [voicemod.model_info(n) for n in voicemod.MODELS], "mics": mics, "mic_error": mic_error,
                "mic": self.cfg.get("voice_mic", ""), "stage": self._voice().stage, "download": dict(self._voice().dl),
                "test_wav": bool(voicemod.Session.TEST_WAV), **self._voice_v2_status()}  # Build A

    @safe_action
    def voice_start(self, max_seconds=600):
        try:
            seconds = max(1, min(600, int(max_seconds or 600)))
            self._voice().start(self._voice_model(), self.cfg.get("voice_mic", ""), seconds, live=self._voice_live_on())  # Build A: live words
        except (TypeError, ValueError):
            return {"status": "error", "message": "max_seconds must be a number."}
        except voicemod.VoiceError as e:
            return {"status": "error", "message": plain_error(e)}
        return {"status": "success", "max_seconds": seconds}

    @safe_action
    def voice_poll(self):
        """stage recording: seconds, level, bars (24 levels, 0–1), full; transcribing: done / total parts;
        done: result (voice.tidy's check data plus text and seconds); error: message."""
        return {"status": "success", **self._voice().poll()}

    @safe_action
    def voice_stop(self):
        try:
            self._voice().stop(self._voice_model())
        except voicemod.VoiceError as e:
            return {"status": "error", "message": plain_error(e)}
        return {"status": "success"}

    @safe_action
    def voice_discard(self):
        self._voice().discard()
        return {"status": "success"}

    @safe_action
    def voice_tidy(self, text):
        """The rules cleanup and anchor check for any transcript (the dialog's data, without recording)."""
        if not isinstance(text, str) or not text.strip():
            return {"status": "error", "message": "Nothing to tidy."}
        return {"status": "success", **voicemod.tidy(voicemod.clean_whisper(text))}

    @safe_action
    def voice_download_model(self, name=None):
        """Starts fetching a Whisper model into models/ (only when the user clicks Download); poll voice_status().download."""
        name = name or self._voice_model()
        if name not in voicemod.MODELS:
            return {"status": "error", "message": f"Unknown model {name}."}
        try:
            self._voice().download(name)
        except voicemod.VoiceError as e:
            return {"status": "error", "message": plain_error(e)}
        return {"status": "success"}

    @safe_action
    def voice_cancel_download(self):
        self._voice().cancel_download()
        return {"status": "success"}
    # ---- end Phase 6B ----

    # ==== Build N (mockup R69) · speaking a question in Ask, the Agent and the floating window ====
    # Its own voicemod.Session (the ramble's keeps its state), the same Whisper model and microphone, or Groq's Whisper after a key AND
    # the first-use yes (ask_voice_cloud_seen). The page polls ask_voice_poll while you speak (live words, level, and how long it has
    # been quiet, for "stops by itself after a pause") and sends the words at once when ask_voice_poll says done.
    # Settings → Voice: ask_voice_start (tap | hold | auto), ask_voice_where (pc | cloud).
    ASK_VOICE_SECONDS = 120   # a long question; Stop is always there

    def _ask_voice(self):
        if not hasattr(self, "_ask_voice_session"):
            self._ask_voice_session = voicemod.Session()
        return self._ask_voice_session

    def _ask_voice_cloud(self):
        return cloud_ai.stt_info(self.cfg)

    @safe_action
    def ask_voice_status(self):
        """{status, start, where, model, mic_ok, mic_error, cloud: {id, name, model, has_key, seen} | None, stage}: what the mic and
        Settings → Voice show."""
        try:
            mics, mic_error = voicemod.list_mics(), ""
        except voicemod.VoiceError as e:
            mics, mic_error = [], plain_error(e)
        test = bool(voicemod.Session.TEST_WAV)
        return {"status": "success", "start": self.cfg.get("ask_voice_start", "tap"), "where": self.cfg.get("ask_voice_where", "pc"),
                "model": voicemod.model_info(self._voice_model()), "mic_ok": bool(mics) or test, "mic_error": mic_error, "test_wav": test,
                "cloud": self._ask_voice_cloud(), "stage": self._ask_voice().stage, "download": dict(self._voice().dl)}

    @safe_action
    def ask_voice_start(self):
        """Starts listening. Errors carry a code the page turns into its card: nomic | nomodel | nokey | first | busy."""
        where = self.cfg.get("ask_voice_where", "pc")
        sess = self._ask_voice()
        if self._voice().stage == "recording":
            return {"status": "error", "code": "busy", "message": "A voice ramble is recording. Finish it first."}
        cloud = self._ask_voice_cloud() if where == "cloud" else None
        if where == "cloud":
            if not cloud:
                return {"status": "error", "code": "nokey", "message": "No cloud model here turns speech into text."}
            if not cloud["has_key"]:
                return {"status": "error", "code": "nokey", "message": f"There's no {cloud['name']} key. Settings → AI models can add one."}
            if not cloud["seen"]:
                return {"status": "error", "code": "first", "message": f"Nothing was recorded: say yes to {cloud['name']} hearing you first."}
        elif not voicemod.model_info(self._voice_model())["present"]:
            return {"status": "error", "code": "nomodel", "message": "Speaking needs the speech model, and it isn't on this PC yet."}
        try:
            sess.start(self._voice_model(), self.cfg.get("voice_mic", ""), self.ASK_VOICE_SECONDS, live=self._voice_live_on(), local=where == "pc")
        except voicemod.VoiceError as e:
            return {"status": "error", "code": "nomic", "message": plain_error(e)}
        self._ask_voice_used = where
        return {"status": "success", "where": where, "max_seconds": self.ASK_VOICE_SECONDS}

    @safe_action
    def ask_voice_poll(self):
        """recording: seconds, level, bars, words (the live tail, or None), heard, quiet (seconds since the last loud moment), full;
        transcribing; done: result {text}; error: message and code (nothing | key | limit | error)."""
        return {"status": "success", **self._ask_voice().poll()}

    @safe_action
    def ask_voice_stop(self):
        """Stop listening and turn it into words (poll for done). Words heard by the cloud go only after the key and the yes."""
        engine = None
        if getattr(self, "_ask_voice_used", "pc") == "cloud":
            cloud = self._ask_voice_cloud()
            if not cloud or not cloud["has_key"] or not cloud["seen"]:
                self._ask_voice().discard()
                return {"status": "error", "code": "first", "message": "Nothing was sent: the cloud model isn't set up to hear you."}

            def engine(samples, pid=cloud["id"]):
                try:
                    return cloud_ai.transcribe(pid, voicemod.encode(samples, ".wav"), self.cfg)
                except cloud_ai.SttError as e:
                    ve = voicemod.VoiceError(str(e))
                    ve.code = e.code
                    raise ve
        try:
            self._ask_voice().stop(self._voice_model(), plain=True, engine=engine)
        except voicemod.VoiceError as e:
            return {"status": "error", "message": plain_error(e)}
        return {"status": "success"}

    @safe_action
    def ask_voice_discard(self):
        self._ask_voice().discard()
        return {"status": "success"}

    @safe_action
    def ask_voice_cloud_yes(self, yes=True):
        """"Let Groq hear what you say?": Use Groq (yes) records the date; the setting becomes the cloud. Anything else changes nothing."""
        cloud = self._ask_voice_cloud()
        if not cloud:
            return {"status": "error", "message": "No cloud model here turns speech into text."}
        if yes is True:
            self._ai_save({"ask_voice_cloud_seen": cloud_ai.today(), "ask_voice_where": "cloud"})
        else:
            self._ai_save({"ask_voice_cloud_seen": ""})
        return {"status": "success", "seen": bool(self.cfg.get("ask_voice_cloud_seen")), "where": self.cfg.get("ask_voice_where", "pc")}

    @safe_action
    def open_mic_settings(self):
        """"Microphone settings" on the no-microphone card: Windows Settings → Privacy → Microphone."""
        if sys.platform != "win32" or not hasattr(os, "startfile"):
            return {"status": "error", "message": "Open your system's privacy settings and allow apps to use the microphone."}
        os.startfile("ms-settings:privacy-microphone")
        return {"status": "success"}
    # ==== end Build N (R69) ====

    # ==== Build A · voice ramble v2 and attachments (mockup R21–R28) ===========
    # Files that notes and the brain dump embed live in attachments/ next to the database (attachments.py); a note
    # embeds one with "![[attachments/…]]" on its own line. A voice ramble records in the pill (pause, stop, discard),
    # then the take is saved as attachments/voice-YYYYMMDD-HHMMSS.ogg (or .wav without soundfile), and Text only sends
    # it to the recycle bin. Live words: a small streaming model shows the last few words while you talk.

    def _att_base(self):
        if getattr(self, "_vroot", None):   # Build V: attachments/ and .neurovault/ live in the vault folder
            return self._vroot
        return app_dir() if self.db.path == ":memory:" else os.path.dirname(os.path.abspath(self.db.path))

    def _db_base(self):
        """The folder that holds the database (where attachments/ and .neurovault/ were before the vault on disk)."""
        return app_dir() if self.db.path == ":memory:" else os.path.dirname(os.path.abspath(self.db.path))

    def _att_free_gb(self):
        try:
            return round(shutil.disk_usage(self._att_base()).free / 1e9, 1)
        except OSError:
            return None

    def _voice_live_on(self):
        pick = self.cfg.get("voice_live", "auto")
        if pick in ("on", "off"):
            return pick == "on"
        free = self._att_free_gb()
        return free is None or free >= voicemod.LIVE_MIN_FREE_GB

    def _voice_v2_status(self):
        """The voice_status keys Build A adds: the after-Stop defaults, live words, and the clip format."""
        free = self._att_free_gb()
        return {"after": {"keep": self.cfg.get("voice_after_keep", "both"), "dest": self.cfg.get("voice_after_dest", "dump"),
                          "ask": self.cfg.get("voice_after_ask", True)},
                "live": {**voicemod.live_info(), "pick": self.cfg.get("voice_live", "auto"), "on": self._voice_live_on(),
                         "free_gb": free, "min_free_gb": voicemod.LIVE_MIN_FREE_GB,
                         "drive": os.path.splitdrive(self._att_base())[0] or "/"},
                "clip_ext": voicemod.audio_ext()}

    def _att_uses_rows(self):
        notes = [dict(r) for r in self.db.query("SELECT id, title, content FROM notes WHERE vault IS ?", (self.db.vault,))]
        inbox = [dict(r) for r in self.db.query("SELECT id, audio FROM inbox_items WHERE audio IS NOT NULL")]
        return notes, inbox

    @safe_action
    def list_attachments(self):
        """{status, folder, files: [{file, name, kind, size, mtime, seconds (audio), uses: [{kind, id, title}]}]}"""
        notes, inbox = self._att_uses_rows()
        files = attachments.list_files(self._att_base())
        for f in files:
            f["uses"] = attachments.uses(f["file"], notes, inbox)
        return {"status": "success", "folder": attachments.folder(self._att_base()), "files": files}

    @safe_action
    def attachment_data(self, file):
        """{status, data_url}: the file for the page's player (audio) or preview."""
        try:
            return {"status": "success", "data_url": attachments.data_url(self._att_base(), file)}
        except attachments.AttachmentError as e:
            return {"status": "error", "message": plain_error(e)}

    def _att_path(self, file):
        path = attachments.resolve(self._att_base(), file)
        if not os.path.isfile(path):
            raise attachments.AttachmentError(f"{file} isn't there any more.")
        return path

    @safe_action
    def attachment_open(self, file):
        """Opens the file in its default app (Open on a PDF or other file)."""
        try:
            platform_layer.open_path(self._att_path(file))
        except attachments.AttachmentError as e:
            return {"status": "error", "message": plain_error(e)}
        return {"status": "success"}

    @safe_action
    def attachment_reveal(self, file):
        """Shows the file selected in File Explorer."""
        try:
            path = self._att_path(file)
        except attachments.AttachmentError as e:
            return {"status": "error", "message": plain_error(e)}
        platform_layer.reveal_path(path)
        return {"status": "success"}

    # ==== Fix A · pasted images saved as files (editor E-76 / PST-14) ====
    # The page has the bytes (a pasted screenshot), not a path, so attach_file (Build K) can't take them. This saves them
    # in attachments/ under a dated name; the editor puts "![[attachments/…]]" at the caret, and the note saves as typed.
    _SAVE_TYPES = {"image/png": (".png", lambda b: b.startswith(b"\x89PNG\r\n\x1a\n")),
                   "image/jpeg": (".jpg", lambda b: b.startswith(b"\xff\xd8\xff")),
                   "image/gif": (".gif", lambda b: b[:6] in (b"GIF87a", b"GIF89a")),
                   "image/webp": (".webp", lambda b: b[:4] == b"RIFF" and b[8:12] == b"WEBP"),
                   "image/bmp": (".bmp", lambda b: b[:2] == b"BM"),
                   "image/avif": (".avif", lambda b: b[4:12] in (b"ftypavif", b"ftypavis"))}

    @safe_action
    def attachment_save(self, data, stem="paste"):
        """Saves an image the page has, as a data: URL ("data:image/png;base64,…"), as attachments/<stem>-YYYYMMDD-HHMMSS.<ext>
        (-2, -3… when taken). PNG, JPEG, GIF, WebP, BMP and AVIF; the bytes must be what the type says.
        {status, file, name, kind, size, mtime}"""
        m = re.match(r"data:([\w/+.-]+);base64,", data) if isinstance(data, str) else None
        if not m or m.group(1).lower() not in self._SAVE_TYPES:
            return {"status": "error", "message": "Only a pasted image (PNG, JPEG, GIF, WebP, BMP or AVIF) can be saved."}
        ext, looks_right = self._SAVE_TYPES[m.group(1).lower()]
        try:
            raw = base64.b64decode(data[m.end():], validate=True)
        except (ValueError, TypeError):
            return {"status": "error", "message": "The pasted image couldn't be read."}
        if not raw or not looks_right(raw):
            return {"status": "error", "message": "The pasted data isn't the image it says it is."}
        if len(raw) > attachments.MAX_DATA_BYTES:
            return {"status": "error", "message": "The pasted image is too big to keep in a note."}
        stem = re.sub(r"[^\w-]+", "-", str(stem or "paste")).strip("-")[:40] or "paste"
        base = self._att_base()
        attachments.folder(base, create=True)
        name = attachments.unique_name(base, f"{stem}-{datetime.now():%Y%m%d-%H%M%S}", ext)
        dest = os.path.join(attachments.folder(base), name)
        with open(dest + ".part", "wb") as f:   # list_files leaves .part files out until the bytes are all there
            f.write(raw)
        os.replace(dest + ".part", dest)
        return {"status": "success", **attachments.info(base, name)}
    # ==== end Fix A ====

    @safe_action
    def remove_attachment(self, file):
        """Moves the file to the recycle bin, takes its "![[…]]" lines out of every note, and clears it from brain-dump
        thoughts (a thought with no text or tasks left goes). {status, notes: [ids changed], inbox: [ids changed],
        inbox_removed: [ids]}"""
        try:
            path = self._att_path(file)
            file = "attachments/" + os.path.basename(path)
            attachments.recycle(path)
        except attachments.AttachmentError as e:
            return {"status": "error", "message": plain_error(e)}
        notes, _ = self._att_uses_rows()
        changed = []
        for n in notes:
            if file in attachments.embeds(n["content"]):
                self.db.execute("UPDATE notes SET content = ?, updated_at = ? WHERE id = ?",
                                (attachments.remove_embed(n["content"], file), utc_now_iso(), n["id"]))
                changed.append(n["id"])
        inbox, gone = [], []
        for r in self.db.query("SELECT * FROM inbox_items WHERE audio = ?", (file,)):
            if (r["text"] or "").strip() or json.loads(r["tasks"] or "[]") or json.loads(r["task_ids"] or "[]"):   # Build A+: or board tasks
                self.db.execute("UPDATE inbox_items SET audio = NULL WHERE id = ?", (r["id"],))
                inbox.append(r["id"])
            else:
                self.db.execute("DELETE FROM inbox_items WHERE id = ?", (r["id"],))
                gone.append(r["id"])
        return {"status": "success", "file": file, "notes": changed, "inbox": inbox, "inbox_removed": gone}

    # ==== Fix A (QC 4 · 35): Rename… a file in attachments/ and Find the file… for a link whose file is gone ====
    def _relink_everywhere(self, old, new):
        """Points every link to old at new: notes, Brain Dump thoughts, wrap-up memos. {notes, inbox} (ids changed)."""
        notes, inbox, now = [], [], utc_now_iso()
        for n in self.db.query("SELECT id, content FROM notes WHERE vault IS ?", (self.db.vault,)):
            if old in attachments.embeds(n["content"]):
                self.db.execute("UPDATE notes SET content = ?, updated_at = ? WHERE id = ?", (attachments.relink(n["content"], old, new), now, n["id"]))
                notes.append(n["id"])
        for r in self.db.query("SELECT id FROM inbox_items WHERE audio = ?", (old,)):
            self.db.execute("UPDATE inbox_items SET audio = ? WHERE id = ?", (new, r["id"]))
            inbox.append(r["id"])
        self.db.execute("UPDATE wrapups SET memo = ? WHERE memo = ?", (new, old))
        return {"notes": notes, "inbox": inbox}

    @safe_action
    def rename_attachment(self, file, new_name):
        """Rename… : the file in attachments/ gets the new name (its extension kept) and every link to it follows, in one
        step. {status, file (the new "attachments/…"), old, notes: [ids], inbox: [ids]}. A name that's taken, empty or not
        allowed by Windows is refused, and nothing changes."""
        try:
            path = self._att_path(file)
            old = "attachments/" + os.path.basename(path)
            name = attachments.clean_name(new_name, os.path.splitext(path)[1])
        except attachments.AttachmentError as e:
            return {"status": "error", "message": plain_error(e)}
        new, dest = "attachments/" + name, os.path.join(os.path.dirname(path), name)
        if new == old:
            return {"status": "success", "file": new, "old": old, "notes": [], "inbox": [], "same": True}
        if os.path.exists(dest) and os.path.normcase(dest) != os.path.normcase(path):   # a case-only change is the same file on Windows
            return {"status": "error", "message": f"There's already a file called {name} in attachments/."}
        try:
            os.rename(path, dest)
        except OSError as e:
            return {"status": "error", "message": f"Couldn't rename {os.path.basename(path)}: {e.strerror or e}."}
        return {"status": "success", "file": new, "old": old, **self._relink_everywhere(old, new)}

    @safe_action
    def relink_attachment(self, missing, file):
        """Find the file… : every link to missing (a file that isn't there any more) points at file instead, a file in
        attachments/. {status, file, old, notes, inbox}"""
        try:
            old = "attachments/" + os.path.basename(attachments.resolve(self._att_base(), missing))
            new = "attachments/" + os.path.basename(self._att_path(file))
        except attachments.AttachmentError as e:
            return {"status": "error", "message": plain_error(e)}
        if new == old:
            return {"status": "error", "message": "Pick the file the link should point at."}
        return {"status": "success", "file": new, "old": old, **self._relink_everywhere(old, new)}

    @safe_action
    def attachment_pick(self, kind="audio"):
        """Find the file… → Choose on this PC: a file anywhere. One in attachments/ is used as it is; one elsewhere is copied
        in (under a free name). {status, file} or {status: "cancelled"}"""
        if not self._window:
            return {"status": "error", "message": "Window not ready."}
        exts = sorted(attachments.KINDS.get(kind, set()))
        types = ((f"{kind.title()} files ({';'.join('*' + e for e in exts)})",) if exts else ()) + ("All files (*.*)",)
        picked = self._window.create_file_dialog(webview.OPEN_DIALOG, file_types=types)
        if not picked:
            return {"status": "cancelled"}
        src, root = os.path.abspath(picked[0]), os.path.abspath(attachments.folder(self._att_base(), create=True))
        if os.path.normcase(os.path.dirname(src)) == os.path.normcase(root):
            return {"status": "success", "file": "attachments/" + os.path.basename(src)}
        stem, ext = os.path.splitext(os.path.basename(src))
        name = attachments.unique_name(self._att_base(), stem, ext)
        try:
            shutil.copy2(src, os.path.join(root, name))
        except OSError as e:
            return {"status": "error", "message": f"Couldn't copy {os.path.basename(src)}: {e.strerror or e}."}
        self._att_from("attachments/" + name, src, "pick")   # Build M · QC 68: where it came from
        return {"status": "success", "file": "attachments/" + name, "copied": True}
    # ==== end Fix A ====

    def _unused(self):
        notes, inbox = self._att_uses_rows()
        memos = {r["memo"] for r in self.db.query("SELECT memo FROM wrapups WHERE memo IS NOT NULL")}  # Build F: wrap-up memos are used
        return [f for f in attachments.list_files(self._att_base()) if not attachments.uses(f["file"], notes, inbox) and f["file"] not in memos]

    @safe_action
    def unused_attachments(self):
        """{status, count, bytes, files}: files in attachments/ that no note or thought uses."""
        files = self._unused()
        return {"status": "success", "count": len(files), "bytes": sum(f["size"] for f in files), "files": [f["file"] for f in files]}

    @safe_action
    def recycle_unused_attachments(self, files=None):
        """Moves every unused file to the recycle bin. {status, moved, bytes, failed: [{file, message}]}
        Build L: with files (a list of "attachments/…" names, as unused_attachments gave them), only those, and only if
        they're still unused: the front end holds the move for 10 seconds (Undo), so nothing that became unused in between goes."""
        if files is not None and (not isinstance(files, list) or not all(isinstance(f, str) for f in files)):
            return {"status": "error", "message": "files must be a list of names."}
        moved, size, failed = 0, 0, []
        for f in self._unused():
            if files is not None and f["file"] not in files:
                continue
            try:
                attachments.recycle(attachments.resolve(self._att_base(), f["file"]))
                moved, size = moved + 1, size + f["size"]
            except attachments.AttachmentError as e:
                failed.append({"file": f["file"], "message": plain_error(e)})
        return {"status": "success", "moved": moved, "bytes": size, "failed": failed}

    @safe_action
    def voice_pause(self, paused=True):
        try:
            return {"status": "success", "paused": self._voice().pause(paused)}
        except voicemod.VoiceError as e:
            return {"status": "error", "message": plain_error(e)}

    def _take_name(self, ext):
        stamp = (self._voice().take_started or datetime.now()).strftime("voice-%Y%m%d-%H%M%S")
        return attachments.unique_name(self._att_base(), stamp, ext)

    @safe_action
    def voice_take(self):
        """{status, data_url, seconds, file}: the recording just stopped, for the player in the question (not saved
        yet); file is the name it will be saved under."""
        try:
            ext = voicemod.audio_ext()
            data = self._voice().take_bytes(ext)
        except voicemod.VoiceError as e:
            return {"status": "error", "message": plain_error(e)}
        mime = attachments.MIME.get(ext, "audio/wav")
        return {"status": "success", "data_url": f"data:{mime};base64," + base64.b64encode(data).decode("ascii"),
                "seconds": round(self._voice().seconds, 2), "file": "attachments/" + self._take_name(ext)}

    @safe_action
    def voice_keep(self, keep="both"):
        """Saves the recording just stopped as attachments/voice-YYYYMMDD-HHMMSS.ogg. keep="text" saves it and then
        moves it to the recycle bin (in case the transcript is wrong). {status, file, size, seconds, recycled}"""
        if keep not in ("both", "text", "audio"):
            return {"status": "error", "message": "keep must be both, text or audio."}
        sess, ext = self._voice(), voicemod.audio_ext()
        # Fix A (QC 4 · 35): Save again after an answer the page never got (a slow save, a timeout) is the same file, not "no recording"
        kept = getattr(self, "_voice_kept", None)
        if sess.take is None and kept and kept[0] is not None and kept[0] == sess.take_started and (
                kept[1]["recycled"] or os.path.isfile(os.path.join(attachments.folder(self._att_base()), os.path.basename(kept[1]["file"])))):
            return dict(kept[1])
        try:
            data = sess.take_bytes(ext)
        except voicemod.VoiceError as e:
            return {"status": "error", "message": plain_error(e)}
        base = self._att_base()
        name = self._take_name(ext)
        # Fix A (QC 4 · 35): the file is on disk, whole, before "success" (the page adds the ![[…]] line only then); if not,
        # the recording stays here for Try again
        try:
            attachments.folder(base, create=True)
            path = os.path.join(attachments.folder(base), name)
            with open(path + ".part", "wb") as f:
                f.write(data)
                f.flush()
                os.fsync(f.fileno())
            os.replace(path + ".part", path)
            if os.path.getsize(path) != len(data):
                raise OSError(f"{name} is {os.path.getsize(path)} bytes on disk, not {len(data)}")
        except OSError as e:
            log.warning("Saving the recording failed: %s", e)
            try:
                os.remove(os.path.join(attachments.folder(base), name) + ".part")
            except OSError:
                pass
            return {"status": "error", "message": f"Couldn't save the recording: {e.strerror or e}."}
        sess.drop_take()
        out = {"status": "success", "file": "attachments/" + name, "size": len(data), "seconds": round(sess.seconds, 2), "recycled": False}
        if keep == "text":
            try:
                attachments.recycle(path)
                out["recycled"] = True
            except attachments.AttachmentError as e:
                log.warning("Text only: %s", e)
        self._voice_kept = (sess.take_started, dict(out))   # Fix A (QC 4 · 35): for a Save again
        return out

    @safe_action
    def voice_transcribe_file(self, file):
        """Transcribe a saved clip (Transcribe on its player); poll voice_poll() as after Stop."""
        try:
            samples, rate = voicemod.read_audio(self._att_path(file))
            self._voice().transcribe_samples(voicemod.to_rate(samples, rate), self._voice_model())
        except (attachments.AttachmentError, voicemod.VoiceError) as e:
            return {"status": "error", "message": plain_error(e)}
        return {"status": "success"}

    @safe_action
    def voice_download_live(self):
        """Starts fetching the live-words model (only when the user clicks Download); poll voice_status().download."""
        try:
            self._voice().download_live()
        except voicemod.VoiceError as e:
            return {"status": "error", "message": plain_error(e)}
        return {"status": "success"}

    def _voice_tasks(self, tasks):
        return [" ".join(str(t).split()) for t in (tasks or []) if str(t).strip()][:50]

    @safe_action
    def add_inbox_voice(self, text="", audio=None, tasks=None):
        """A voice thought: its clip ("attachments/…"), its text and its tasks (any of them; at least one)."""
        text = " ".join(str(text or "").split())
        tasks = self._voice_tasks(tasks)
        if audio:
            try:
                audio = "attachments/" + os.path.basename(attachments.resolve(self._att_base(), audio))
            except attachments.AttachmentError as e:
                return {"status": "error", "message": plain_error(e)}
        if not (text or audio or tasks):
            return {"status": "error", "message": "Nothing to add."}
        if len(text) > self._INBOX_MAX_TEXT:
            return {"status": "error", "message": "That thought is too long for the Brain Dump."}  # Fix C (QC 20): the display name
        made = self._voice_board_tasks(tasks)   # Build A+: ticked tasks go straight to the Tasks board
        cur = self.db.execute("INSERT INTO inbox_items (text, done, created_at, audio, task_ids) VALUES (?, 0, ?, ?, ?)",
                              (text, _local_now().isoformat(), audio or None, json.dumps([t["id"] for t in made]) if made else None))
        return {"status": "success", "item": self._inbox_view(self.db.query_one("SELECT * FROM inbox_items WHERE id = ?", (cur.lastrowid,))),
                "tasks_added": made}

    @safe_action
    def update_inbox_voice(self, item_id, text="", tasks=None):
        """Transcribe on a voice thought that had no text: its text, and its ticked tasks as Tasks-board tasks
        (added to any it already made)."""
        item_id = _clean_id(item_id)
        row = item_id and self.db.query_one("SELECT * FROM inbox_items WHERE id = ?", (item_id,))
        if not row:
            return {"status": "error", "message": "That Brain Dump thought isn't there any more."}  # Fix C (QC 20)
        text, tasks = " ".join(str(text or "").split()), self._voice_tasks(tasks)
        if len(text) > self._INBOX_MAX_TEXT:
            return {"status": "error", "message": "That thought is too long for the Brain Dump."}  # Fix C (QC 20): the display name
        made = self._voice_board_tasks(tasks)   # Build A+
        ids = json.loads(row["task_ids"] or "[]") + [t["id"] for t in made]
        self.db.execute("UPDATE inbox_items SET text = ?, task_ids = ? WHERE id = ?", (text, json.dumps(ids) if ids else None, item_id))
        return {"status": "success", "item": self._inbox_view(self.db.query_one("SELECT * FROM inbox_items WHERE id = ?", (item_id,))),
                "tasks_added": made}

    def _voice_board_tasks(self, titles):
        """Build A+ (voice tasks): each ticked task of a voice thought as a real task, made the way the wrap-up parks an
        inbox thought (wrapup_tidy, Build F): no project, no note, no due date, Medium priority, medium energy. The
        tasks table has no column pointing back at a thought, so the thought keeps the ids (inbox_items.task_ids)."""
        made = []
        for title in titles:
            title = title if len(title) <= 200 else title[:199].rstrip() + "…"
            r = self.save_task(None, title, "", "Medium", None, None, "", False, None, "medium")
            if r.get("status") == "success":
                made.append(self.get_task(r["id"]))
            else:
                log.warning("A voice task wasn't made: %s", r.get("message"))
        return made
    # ==== end Build A =========================================================
    # ---- Build B · local AI: llama.cpp's llama-server, downloaded on first use (asked first) and run by the app on a
    # local port (local_ai.py). Settings → AI models, the status bar, the router (ramble clean-up, task breakdown,
    # Q&A, offline fallback) and Ollama / LM Studio as optional connections. Downloads and model jobs run in threads:
    # the page polls ai_status() / ai_job(). The guided setup (piece D) calls ai_hardware, ai_recommend, ai_download.
    def _ai(self):
        if not hasattr(self, "_ai_mgr"):
            self._ai_mgr = local_ai.Manager(self.cfg, self._ai_save)
            voicemod.AI_CLEANUP = self._ai_ramble   # the voice rambler's AI pass; its rules stay the fallback
        return self._ai_mgr

    def _ai_save(self, patch):
        self.cfg.update(patch)
        cfgmod.save_config(self.cfg)

    def _ai_fail(self, e):
        return {"status": "error", "message": plain_error(e)}

    def _ai_ramble(self, text, rules):
        """voice.py's hook: the model in use cleans the ramble when it's ready now; otherwise the rules' result stays."""
        mgr = self._ai()
        if not mgr.ready("ramble"):
            return rules
        try:
            paras, tasks, name = mgr.ramble(voicemod.clean_whisper(text))
        except local_ai.AiError as e:
            log.info("AI clean-up skipped: %s", e)
            return rules
        paras = [voicemod.finish_sentence(voicemod.strip_leadins(voicemod.remove_fillers(p))) for p in paras]   # "Okay, so…" and any filler left
        out = voicemod.check_anchors(text, paras, tasks)
        out["cleaned_by"] = name
        return out

    @safe_action
    def ai_boot(self):
        """The page is up: starts the engine when a model is set and the engine is on."""
        self._ai().boot()
        return {"status": "success"}

    @safe_action
    def ai_status(self):
        """Everything Settings → AI models and the status bar show (see local_ai.Manager.status)."""
        return self._ai().status()

    @safe_action
    def ai_hardware(self):
        """{status, pc: {mem_gb, free_gb, free_bytes, drive, gpu: {name, vram_gb} | null, vulkan, card}, line}: read fresh."""
        pc = local_ai.pc_info(refresh=True)
        return {"status": "success", "pc": pc, "line": local_ai.pc_line(pc)}

    @safe_action
    def ai_recommend(self):
        """{status, model: the best fit for this PC (a model row, as in ai_status) | null, models, pc,
        engine: the engine file that downloads first (file, mb, source) | null when it's installed}."""
        st = self._ai().status()
        rec = next((m for m in st["models"] if m["id"] == st["rec"]), None)
        return {"status": "success", "model": rec, "models": st["models"], "pc": st["pc"],
                "engine": None if st["engine"]["build"] else st["engine"]["offer"]}

    @safe_action
    def ai_download(self, model_id, with_engine=True):
        """Starts a model's download, and the engine's too when it isn't installed (with_engine). Only on the user's
        click, after the page has shown the files, source and sizes. Poll ai_status().downloads."""
        mgr = self._ai()
        try:
            if with_engine and not mgr.engine_build():
                mgr.download_engine()
            mgr.download_model(model_id)
        except local_ai.AiError as e:
            return self._ai_fail(e)
        return {"status": "success", "downloads": mgr.status()["downloads"]}

    @safe_action
    def ai_download_engine(self, variant=""):
        """Just the engine: vulkan (graphics card) or cpu; "" picks for this PC."""
        try:
            self._ai().download_engine(variant or None)
        except local_ai.AiError as e:
            return self._ai_fail(e)
        return {"status": "success"}

    @safe_action
    def ai_pause(self, key):
        """key: a model id, or "engine"."""
        self._ai().pause(key)
        return {"status": "success"}

    @safe_action
    def ai_resume(self, key):
        try:
            self._ai().resume(key)
        except local_ai.AiError as e:
            return self._ai_fail(e)
        return {"status": "success"}

    @safe_action
    def ai_cancel(self, key):
        """Stops a download and deletes its .part file."""
        self._ai().cancel(key)
        return {"status": "success"}

    @safe_action
    def ai_use(self, model_id):
        """The model in use changes (the engine reloads). With "Delete the old one" the old file goes: removed says which."""
        try:
            removed = self._ai().use(model_id)
        except local_ai.AiError as e:
            return self._ai_fail(e)
        return {"status": "success", "removed": removed}

    @safe_action
    def ai_remove(self, model_id):
        try:
            removed = self._ai().remove(model_id)
        except local_ai.AiError as e:
            return self._ai_fail(e)
        return {"status": "success", "removed": removed}

    @safe_action
    def ai_engine(self, on):
        """Start or stop the engine (saved as ai_engine_on)."""
        try:
            self._ai().set_engine(bool(on))
        except local_ai.AiError as e:
            return self._ai_fail(e)
        return {"status": "success"}

    @safe_action
    def ai_gpu(self, choice):
        """QC 87: Use graphics card for AI: off | some | full. A running engine restarts on next use."""
        try:
            self._ai().set_gpu(choice)
        except local_ai.AiError as e:
            return self._ai_fail(e)
        return {"status": "success"}

    @safe_action
    def ai_check_catalog(self):
        """Check for new models: re-reads the model list."""
        return self._ai().reload_catalog()

    @safe_action
    def ai_add_gguf(self):
        """Add a .gguf file…: a model file already on this PC (used where it is, never copied or deleted)."""
        if not self._window:
            return {"status": "error", "message": "Window not ready."}
        picked = self._window.create_file_dialog(webview.OPEN_DIALOG, file_types=("GGUF models (*.gguf)", "All files (*.*)"))
        if not picked:
            return {"status": "cancelled"}
        try:
            return {"status": "success", "model": self._ai().add_gguf(picked[0])}
        except local_ai.AiError as e:
            return self._ai_fail(e)

    @safe_action
    def ai_test_provider(self, key):
        """Ollama or LM Studio: {status, running, models, chip, tone, desc}."""
        try:
            return {"status": "success", **self._ai().test_provider(key)}
        except local_ai.AiError as e:
            return self._ai_fail(e)

    @safe_action
    def ai_set_route(self, job, choice):
        """A job's model when the smart auto-router is off: "auto", "local:<id>", "ollama" or "lmstudio"."""
        if job not in dict(local_ai.JOBS):
            return {"status": "error", "message": "Unknown job."}
        pid, mid = cloud_ai.split_key(choice) if isinstance(choice, str) else (None, None)
        ok = choice in ("auto", "ollama", "lmstudio") or (isinstance(choice, str) and choice.startswith("local:") and self._ai().model(choice[6:])) \
            or bool(pid and cloud_ai.has_key(pid) and (mid is None or cloud_ai.model_info(pid, mid)))   # Build N (R56; QC 91: or one of its listed models)
        if not ok:
            return {"status": "error", "message": "That choice isn't available."}
        self._ai_save({"ai_route": {**(self.cfg.get("ai_route") or {}), job: choice},
                       "ai_route_back": {k: v for k, v in (self.cfg.get("ai_route_back") or {}).items() if k != job}})   # your pick ends a "Use this PC" hold
        return {"status": "success"}

    # ==== Build N (R56) · AI in the cloud with your own key: Add key / Test / Remove, the first-use yes, "Use this PC" ====
    def _cloud_pid(self, pid):
        return pid if isinstance(pid, str) and pid in cloud_ai.PROVIDERS else None

    @safe_action
    def ai_cloud_key(self, pid, key, acct=None):
        """Add or change a key: it's tested with one word, "Hello" (none of your notes), and saved in Windows Credential Manager
        only when the company answers. acct: Cloudflare's Account ID. {status, ok, secs, limit, message}."""
        if not self._cloud_pid(pid):
            return {"status": "error", "message": "Unknown company."}
        try:
            return {"status": "success", **self._ai().cloud_test(pid, key if isinstance(key, str) else "", acct if isinstance(acct, str) else None)}
        except (local_ai.AiError, cloud_ai.KeyStoreError) as e:
            return self._ai_fail(e)

    @safe_action
    def ai_cloud_test(self, pid):
        """Test the saved key: "Hello", nothing else. {status, ok, secs, limit, message}."""
        if not self._cloud_pid(pid):
            return {"status": "error", "message": "Unknown company."}
        try:
            return {"status": "success", **self._ai().cloud_test(pid)}
        except local_ai.AiError as e:
            return self._ai_fail(e)

    @safe_action
    def ai_cloud_models(self, pid):
        """QC 91: Refresh: ask the company for its models now (only the key goes, never a note). {status, ok, models, at,
        message}; offline, the saved list stays."""
        if not self._cloud_pid(pid):
            return {"status": "error", "message": "Unknown company."}
        return {"status": "success", **cloud_ai.fetch_models(pid, self.cfg)}

    @safe_action
    def ai_cloud_usage(self, pid, mid=None):
        """QC 92/98: "Check my limits", only on click. OpenRouter is asked for its key's free-model use (only the key goes); a company
        whose answers say what's left (Groq, Cerebras, OpenAI, Anthropic) gets one tiny message, "Hi", for mid (its recommended
        model by default); the rest don't say, so nothing is sent. {status, ok, message}."""
        if not self._cloud_pid(pid):
            return {"status": "error", "message": "Unknown company."}
        if cloud_ai.PROVIDERS[pid].get("reports") == "headers":
            try:
                return {"status": "success", **self._ai().cloud_check_limits(pid, mid if isinstance(mid, str) and mid else None)}
            except local_ai.AiError as e:
                return self._ai_fail(e)
        return {"status": "success", **cloud_ai.fetch_key_usage(pid, self.cfg)}

    @safe_action
    def ai_cloud_remove(self, pid):
        """The key goes from Windows Credential Manager; so does your yes (the notice shows again if you add a key), and every
        job that used this company goes back to Automatic."""
        if not self._cloud_pid(pid):
            return {"status": "error", "message": "Unknown company."}
        try:
            cloud_ai.del_key(pid)
        except cloud_ai.KeyStoreError as e:
            return self._ai_fail(e)
        drop = lambda m: {k: v for k, v in (self.cfg.get(m) or {}).items() if k != pid and not k.startswith(pid + ":")}
        cloud_ai.cache()["lists"].pop(pid, None)
        for k in [k for k in cloud_ai.cache()["use"] if k == pid or k.startswith(pid + ":")]:   # QC 92: its counts go too
            del cloud_ai.cache()["use"][k]
        cloud_ai.save_cache()
        self._ai_save({"ai_cloud_seen": drop("ai_cloud_seen"), "ai_cloud_used": drop("ai_cloud_used"), "ai_cloud_acct": drop("ai_cloud_acct"),
                       "ai_route": {j: ("auto" if cloud_ai.split_key(c)[0] == pid else c) for j, c in (self.cfg.get("ai_route") or {}).items()},
                       "ai_route_back": {j: b for j, b in (self.cfg.get("ai_route_back") or {}).items() if cloud_ai.split_key(b.get("choice"))[0] != pid}})
        return {"status": "success"}

    @safe_action
    def ai_cloud_yes(self, pid, yes=True):
        """The first-use notice: "Use Groq" (yes) records the date; "Show the notice again" (yes=False) forgets it."""
        if not self._cloud_pid(pid):
            return {"status": "error", "message": "Unknown company."}
        seen = {k: v for k, v in (self.cfg.get("ai_cloud_seen") or {}).items() if k != pid}
        if yes is True:
            seen[pid] = cloud_ai.today()
        self._ai_save({"ai_cloud_seen": seen})
        return {"status": "success", "seen": seen.get(pid, "")}

    @safe_action
    def ai_use_local(self, job="qa"):
        """After a free limit: "Use this PC". The job goes to the model on this PC (or Ollama / LM Studio) until tomorrow, then
        back to what it was. {status, name}."""
        if job not in local_ai.PICK_JOBS:
            return {"status": "error", "message": "Unknown job."}
        mgr = self._ai()
        m = mgr.in_use()
        choice = f"local:{m['id']}" if m and mgr.is_installed(m) else next((k for k, p in mgr.providers.items() if p.get("running") and p.get("models")), None)
        if not choice:
            return {"status": "error", "message": "There's no model on this PC yet. Settings → AI models."}
        prev = mgr.route_choice(job)
        tomorrow = (datetime.now().date() + timedelta(days=1)).isoformat()
        self._ai_save({"ai_route": {**(self.cfg.get("ai_route") or {}), job: choice},
                       "ai_route_back": {**(self.cfg.get("ai_route_back") or {}), job: {"choice": prev, "on": tomorrow}}})
        return {"status": "success", "choice": choice, "name": mgr.who(mgr.route(job)), "back": prev}
    # ==== end Build N ====

    @safe_action
    def ai_breakdown(self, task_id):
        """Magic task breakdown: the model splits the task into small timed steps, saved as its steps. Poll ai_job(job)."""
        task = self.get_task(task_id)
        if not task:
            return {"status": "error", "message": "Task not found."}
        note = self.db.query_one("SELECT content FROM notes WHERE id = ?", (task["note_id"],)) if task.get("note_id") else None
        mgr = self._ai()

        info = {}   # R68: a kept-off note's task is split on this PC

        def run():
            steps, by = mgr.breakdown(task["title"], (note["content"] if note else "") or "", notes=[task["note_id"]] if task.get("note_id") else None, info=info)
            saved = self.set_task_steps(task["id"], steps)
            if saved.get("status") != "success":
                raise local_ai.AiError(saved.get("message") or "The steps couldn't be saved.")
            return {"steps": saved["steps"], "by": by, **({"kept_off": info["kept_off"]} if info.get("kept_off") else {})}
        return {"status": "success", "job": mgr.start_job("split", run)}

    @safe_action
    def ai_ask(self, question, note_id=None, text=None, history=None, attachments=None, unlock=False, local=False):
        """Ask about a note: answers from one note, or from the newest notes (note_id None) with the model chosen for
        Ask (the qa job). text (Build N): the note as the editor has it now, unsaved words included. history (Build N):
        the chat's earlier [{q, a}], oldest first: all of them go along, the oldest dropped when they don't fit the
        model's context (Build N parity, R51; the page sends only the last N when Settings → Follow-ups send says so).
        Settings → AI models → Ask (ai_ask_mode): "general" lets the model add labelled general knowledge; "notes" keeps
        it to the notes. Poll ai_job(job); ai_job_cancel(job) stops it.
        result: {answer, by, notes: how many notes it read, turns: earlier turns sent, dropped: the oldest that didn't fit,
        general: it used general knowledge, attachments: the files that went}.
        attachments (QC 93/101): the files the page names (the note's ticked ones, and any added from the vault); with "Let AI
        read this note's attachments" on, every text-based one goes as its text to any model, trimmed to what it can read, and
        pictures to a model that can see them; the model is told which it couldn't get. result.att: each file's state."""
        if not str(question or "").strip():
            return {"status": "error", "message": "Ask a question."}
        nid = _clean_id(note_id)
        if note_id and not nid:
            return {"status": "error", "message": "Note not found."}
        ids, skipped = [], 0   # R68
        if nid:
            row = self.db.query_one("SELECT title, content FROM notes WHERE id = ?", (nid,))
            if not row:
                return {"status": "error", "message": "Note not found."}
            context, count = f"# {row['title']}\n{text if isinstance(text, str) else row['content'] or ''}", 1
        else:
            # R68: "My newest notes" for a cloud model leaves the kept-off notes out (and says how many)
            cloud = self._ai().route("qa")["kind"] == "cloud"
            context, count = self._ai_newest_notes(skip_locked=cloud, ids_out=ids)
            skipped = len(self._ai_skipped)
        mgr = self._ai()

        general = self.cfg.get("ai_ask_mode", "general") != "notes"
        turns = local_ai.qa_history(history, turns=None, chars=10 ** 9)   # Build N parity: the whole chat; ask() keeps what fits
        sent = local_ai.qa_messages(str(question), context, not nid, turns, general)[1]

        box = {}   # R50: the job's words so far ("partial" in ai_job), so the chat shows them as they come and Stop keeps them

        def partial(text):
            j = mgr.jobs.get(box.get("jid"))
            if j is not None and j["state"] == "running":
                j["partial"] = text

        # R68: a kept-off note's attachments never go to a cloud model, not even for one unlocked question
        cloud_now = mgr.route("qa")["kind"] == "cloud" and not local
        att_stay = bool(nid and attachments and cloud_now and ai_lock.is_cloud_locked(nid))
        plan = self._ai_attach_plan(nid, attachments, context, question) if nid and attachments and not att_stay else None
        attach = ai_attach.for_model(plan, self._att_base()) if plan else []
        info, notes = {}, ([nid] if nid else ids)

        def run(cancel=None):
            answer, by = mgr.ask(str(question), context, cancel=cancel, many=not nid, history=turns, general=general, on_text=partial, attach=attach,
                                 notes=notes, unlock=bool(unlock), info=info, local=bool(local))
            answer, used = local_ai.qa_clean(answer)   # QC 46: an empty "Not from your note:" caveat goes
            return {"answer": answer, "by": by, "notes": count, "turns": sent, "dropped": len(turns) - sent, "general": general and used,
                    "attachments": [a["name"] for a in attach if a["kind"] != "missing"], "att": ai_attach.public(plan)["items"] if plan else [],
                    **({"kept_off": info["kept_off"]} if info.get("kept_off") else {}), **({"unlocked_once": True} if info.get("unlocked_once") else {}),
                    **({"att_stay": [os.path.basename(str(f)) for f in attachments if isinstance(f, str)]} if att_stay else {}),
                    **({"skipped": skipped} if skipped else {})}
        box["jid"] = jid = mgr.start_job("qa", run, stoppable=True)
        return {"status": "success", "job": jid}

    # ==== Build N · QC 93 → QC 101: the note's attachments, for any model (ai_attach.py) ====
    def _ai_attach_plan(self, nid, files, context, question=""):
        """ai_attach.plan for the asked-for files: the note's own (it embeds them) and any the user added from the vault (a file
        in attachments/), when the setting is on; None when it's off."""
        if not self.cfg.get("ai_read_attachments") or not isinstance(files, list):
            return None
        files = [f for f in files if isinstance(f, str) and f.startswith(attachments.DIR + "/")][:ai_attach.MAX_FILES]
        if not files:
            return None
        used = len(local_ai.QA_TALK) + 600 + min(len(context), local_ai.QA_NOTE_CHARS) + len(str(question or ""))   # the system message, the note, the question
        return ai_attach.plan(self._att_base(), files, self._ai().route("qa"), used)

    @safe_action
    def ai_attach_preview(self, note_id, files, text=None):
        """QC 101: what would go with the next question, file by file, before it's asked (nothing is sent anywhere):
        {status, on, items: [{file, name, kind, state: included | trimmed | unreadable, why, chars, of}], budget}."""
        nid = _clean_id(note_id)
        row = self.db.query_one("SELECT title, content FROM notes WHERE id = ?", (nid,)) if nid else None
        if not row:
            return {"status": "error", "message": "Note not found."}
        if not self.cfg.get("ai_read_attachments"):
            return {"status": "success", "on": False, "items": [], "budget": 0}
        context = f"# {row['title']}\n{text if isinstance(text, str) else row['content'] or ''}"
        plan = self._ai_attach_plan(nid, files, context)
        return {"status": "success", "on": True, **(ai_attach.public(plan) if plan else {"items": [], "budget": 0})}
    # ==== end Build N · QC 101 ====

    # ==== Build N · R67: the Agent (agent.py): in the Ask chat, off by default; every change asks; 8 steps and 3 changes ====
    def _agents(self):
        if not hasattr(self, "_agent_runs"):
            self._agent_runs = agent.Agents(self)
        return self._agent_runs

    def _agent_run(self, run):
        r = self._agents().get(run)
        return (r, None) if r else (None, {"status": "error", "message": "That request isn't there any more: ask again."})

    @safe_action
    def ai_agent(self, question, note_id=None):
        """Asks the Agent to do something with your notes, with the model picked for Ask. {status, run, state, steps, …}; poll
        ai_agent_poll(run). It needs Settings → AI models → Agent on, and a model that can use tools (state "notools" if not)."""
        if not self.cfg.get("ai_agent"):
            return {"status": "error", "code": "off", "message": "The Agent is off. Settings → AI models → Jobs and answers turns it on."}
        if not str(question or "").strip():
            return {"status": "error", "message": "Ask it to do something."}
        chosen = self.cfg.get("ai_agent_tools") or agent.TOOLS
        if set(chosen) == {"search_notes", "read_note", "summarise_note", "create_task", "append_to_note"}:
            chosen = agent.TOOLS   # the first five, as saved before add_tags and link_notes came: those two are on too
        enabled = [k for k in agent.TOOLS if k in chosen]
        if not enabled:
            return {"status": "error", "code": "notools", "message": "Every tool is off in Settings → AI models → Agent, so it can't do anything."}
        run = self._agents().start(str(question), _clean_id(note_id), enabled)
        return {"status": "success", **run.snapshot()}

    @safe_action
    def ai_agent_poll(self, run):
        """Where a request is: {status, run, state: running | waiting | done | limit | wlimit | stopped | error | notools, steps,
        pending (the change waiting for Add / Edit / Skip), writes, skipped, answer, by, sent_to, used, budget, …}."""
        r, err = self._agent_run(run)
        return err or {"status": "success", **r.snapshot()}

    @safe_action
    def ai_agent_change(self, run, choice, fields=None):
        """The change waiting: choice "add" (fields: what you edited: title / due / note, or text) or "skip"."""
        r, err = self._agent_run(run)
        if err:
            return err
        if not r.answer_change(choice, fields):
            return {"status": "error", "message": "There's no change waiting.", **r.snapshot()}
        for _ in range(40):   # the write lands on the agent's thread: wait a moment so the answer has it
            if r.snapshot()["state"] != "waiting" or r.pending is None:
                break
            time.sleep(0.025)
        time.sleep(0.05)
        return {"status": "success", **r.snapshot()}

    @safe_action
    def ai_agent_stop(self, run, why="you"):
        """Stop, at once (a change waiting isn't made). why (QC 112): you | new | closed, said in the chat."""
        r, err = self._agent_run(run)
        if err:
            return err
        r.stop(why if isinstance(why, str) else "you")
        return {"status": "success", **r.snapshot()}

    @safe_action
    def ai_agent_warm(self):
        """QC 112: "Load it now": the model on this PC that Ask (and the Agent) uses starts loading, so the first answer doesn't wait
        for it. {status, loading: true when it started, model}. Nothing happens for a cloud model or one already loaded."""
        mgr = self._ai()
        r = mgr.route("qa")
        if r.get("kind") != "local":
            return {"status": "success", "loading": False, "model": r.get("name") or ""}
        if mgr.engine.model_id == r["model"] and mgr.engine.state() in ("running", "starting"):
            return {"status": "success", "loading": False, "model": r.get("name") or ""}
        try:
            mgr.start_engine(mgr.model(r["model"]))
        except local_ai.AiError as e:
            return self._ai_fail(e)
        return {"status": "success", "loading": True, "model": r.get("name") or ""}

    @safe_action
    def ai_agent_carry(self, run):
        """After the step limit: 8 more steps, from where it stopped."""
        r, err = self._agent_run(run)
        if err:
            return err
        if not r.carry_on():
            return {"status": "error", "message": "It hasn't stopped at the step limit.", **r.snapshot()}
        return {"status": "success", **r.snapshot()}

    @safe_action
    def ai_agent_undo(self, run):
        """Undo all: the request's changes come out (tasks deleted, added text taken out of its note). {undone, kept, notes, tasks}."""
        r, err = self._agent_run(run)
        if err:
            return err
        if r.state in ("running", "waiting"):
            r.stop()
        return {"status": "success", **r.undo_all(), **r.snapshot()}
    # ==== end Build N · R67 ====

    # ==== Build N · the window and taskbar icon in the current theme and accent (design profile "The logo wears your
    # theme"): the page draws the hypercube tile and sends it here on start and on every theme or accent change ====
    LOGO_SIZES = (16, 20, 24, 32, 40, 48, 64, 256)   # QC 78: every size Windows may pick
    LOGO_MAX = 400_000   # characters in one data URL: a 256 px PNG of the tile is about 20 KB

    @staticmethod
    def _logo_ico():
        base = getattr(sys, "_MEIPASS", os.path.dirname(os.path.abspath(__file__)))
        return os.path.join(base, "neurovault.ico")

    @safe_action
    def window_icon(self, pngs, kind=None):
        """kind (Build N, QC 111): "ask", the Ask chat's own icon (the logo with a chat mark), for its window only.
        The window and taskbar icon. pngs: {"16": "data:image/png;base64,…", …} for 16, 20, 24, 32, 40, 48, 64 and 256 px, each a
        square PNG of its size (logo-vars.js logoPng). Anything else is refused and the icon stays as it was. The icons
        go on the main window and every pop-out, and are kept for windows that open later.
        {status, applied: how many windows took it}."""
        bad = {"status": "error", "message": "The icon needs PNGs at 16, 20, 24, 32, 40, 48, 64 and 256 px."}
        if not isinstance(pngs, dict) or len(pngs) != len(self.LOGO_SIZES):
            return bad
        out = {}
        for k, v in pngs.items():
            if isinstance(k, bool) or not str(k).isdigit() or int(k) not in self.LOGO_SIZES or not isinstance(v, str) or len(v) > self.LOGO_MAX:
                return bad
            head, _, data = v.partition(",")
            if head != "data:image/png;base64":
                return bad
            try:
                b = base64.b64decode(data, validate=True)
            except Exception:
                return bad
            if len(b) < 24 or b[:8] != b"\x89PNG\r\n\x1a\n" or b[12:16] != b"IHDR" or b[16:24] != int(k).to_bytes(4, "big") * 2:
                return bad
            out[int(k)] = b
        if set(out) != set(self.LOGO_SIZES):
            return bad
        if kind is not None:   # QC 111: a pop-out kind's own icon
            if kind not in getattr(popout, "TASKBAR", {}):
                return {"status": "error", "message": "That kind of window has no icon of its own."}
            self._logo_kind_pngs = {**getattr(self, "_logo_kind_pngs", {}), kind: out}
            w = self._pop.window(kind) if getattr(self, "_pop", None) else None
            return {"status": "success", "applied": int(bool(w is not None and platform_layer.set_window_icon(w, out)))}
        self._logo_pngs = out
        return {"status": "success", "applied": sum(1 for w in self._logo_windows() if platform_layer.set_window_icon(w, out))}

    def _logo_windows(self):   # QC 111: a window with an icon of its own keeps it
        own = {k for k in getattr(self, "_logo_kind_pngs", {})}
        pops = [w for k, w in getattr(self._pop, "windows", {}).items() if k.partition(":")[0] not in own]
        return [w for w in [self._window, *pops] if w is not None]

    def window_icon_shown(self, window, kind=None):
        """A window has just shown (main.py, popout.py): the page's icon if it has drawn one, else the static .ico.
        kind (QC 111): a pop-out with an icon of its own gets that one."""
        pngs = getattr(self, "_logo_kind_pngs", {}).get(kind) or getattr(self, "_logo_pngs", None)
        return platform_layer.set_window_icon(window, pngs) if pngs else platform_layer.set_window_icon(window, ico_path=self._logo_ico())
    # ==== end Build N ====

    @safe_action
    def ai_job(self, job_id):
        """{status, state: running | done | error, result, message}."""
        j = self._ai().jobs.get(job_id)
        return {"status": "success", **j} if j else {"status": "error", "message": "Unknown job."}
    # ---- end Build B ----

    # ==== Build N · AI summaries, Ask about this note and Tidy up with AI (mockups R43, R45, R46) =====================
    # Three jobs, each on its own route (Settings → AI models: Note summaries, Ask about a note, Tidy up), and each a real
    # stop: ai_job_cancel closes the model's connection (llama-server stops working on it) and the answer is dropped.
    AI_CONTEXT = 12000   # characters the model reads: "My newest notes" are whole notes, newest first, until this is used

    def _ai_newest_notes(self, skip_locked=False, ids_out=None):
        """(context, how many notes): the newest notes, whole, until AI_CONTEXT is used (the first is cut if it's longer).
        R68: skip_locked leaves out the notes kept off cloud AI (self._ai_skipped lists them); ids_out gets the ids that went."""
        out, used = [], 0
        self._ai_skipped = []
        for r in self.db.query("SELECT id, title, content FROM notes WHERE vault IS ? ORDER BY updated_at DESC LIMIT 40", (self.db.vault,)):
            if skip_locked and ai_lock.is_cloud_locked(r["id"]):
                self._ai_skipped.append(r["id"])
                continue
            block = f"# {r['title']}\n{r['content'] or ''}"
            if out and used + len(block) + 2 > self.AI_CONTEXT:
                break
            out.append(block[:self.AI_CONTEXT])
            used += len(block) + 2
            if ids_out is not None:
                ids_out.append(r["id"])
        return "\n\n".join(out), len(out)

    @safe_action
    def ai_summary(self, note_id, text=None, unlock=False):
        """Summarise this note, with the model chosen for Note summaries. text: the note as the editor has it now.
        Poll ai_job(job): result {answer, by}. ai_job_cancel(job) stops it."""
        nid = _clean_id(note_id)
        row = self.db.query_one("SELECT title, content FROM notes WHERE id = ?", (nid,)) if nid else None
        if not row:
            return {"status": "error", "message": "Note not found."}
        body = text if isinstance(text, str) else row["content"] or ""
        if not re.search(r"\w", re.sub(r"^---\n.*?\n---\n", "", body, flags=re.S).replace("{{tasks}}", "")):
            return {"status": "error", "message": "This note is empty: there's nothing to summarise yet."}
        mgr = self._ai()

        info = {}   # R68: for a kept-off note the summary is made on this PC, and says so

        def run(cancel=None):
            answer, by = mgr.summarise(f"# {row['title']}\n{body}", cancel=cancel, notes=[nid], unlock=bool(unlock), info=info)
            return {"answer": answer, "by": by, **({"kept_off": info["kept_off"]} if info.get("kept_off") else {}), **({"unlocked_once": True} if info.get("unlocked_once") else {})}
        return {"status": "success", "job": mgr.start_job("summary", run, stoppable=True)}

    @safe_action
    def ai_tidy(self, text, note_id=None, unlock=False):
        """Tidy up with AI: the selected Markdown with its spelling and grammar fixed and its wording tidied (nothing added,
        nothing removed), with the model chosen for Tidy up. Poll ai_job(job): result {text, lost, same, added, cut, strength,
        by}: lost lists the [[links]] and URLs the answer dropped, added the numbers and names it brought in, cut how much
        of the words it left out (in %, when it's a lot); the page shows them before Replace. ai_job_cancel(job) stops it.
        QC 38: Settings → AI models → Tidy up: ai_tidy_strength (light | standard | polished) and ai_tidy_rule."""
        if not isinstance(text, str) or not re.search(r"\w", text):
            return {"status": "error", "message": "Select some words to tidy."}
        if len(text) > local_ai.TIDY_MAX:
            return {"status": "error", "message": f"Select less text: Tidy up takes up to {local_ai.TIDY_MAX:,} characters at a time."}
        if local_ai.tidy_words(text) < local_ai.TIDY_MIN_WORDS:   # QC 43: a word or two never goes to the model
            return {"status": "error", "message": local_ai.TIDY_SHORT_MSG, "short": True}
        mgr = self._ai()

        strength = self.cfg.get("ai_tidy_strength", "standard")
        rule = self.cfg.get("ai_tidy_rule", "") or ""

        nid, info = _clean_id(note_id), {}   # R68: note_id is the note the words come from (a kept-off one is tidied on this PC)

        def run(cancel=None):
            res, by = mgr.tidy(text, cancel=cancel, strength=strength, rule=rule, notes=[nid] if nid else None, unlock=bool(unlock), info=info)
            used = "light" if local_ai.tidy_words(text) < local_ai.TIDY_SHORT else strength if strength in local_ai.TIDY_STRENGTHS else "standard"
            return {**res, "strength": used, "by": by, **({"kept_off": info["kept_off"]} if info.get("kept_off") else {})}
        return {"status": "success", "job": mgr.start_job("tidy", run, stoppable=True)}

    # ==== R68 · keep a project, folder or note off cloud AI (ai_lock.py; the R68 decisions, 2026-10-19) ====
    # The lock lives in <vault>/.neurovault/ai-lock.json. Set it from a project's, folder's or note's ⋮ menu or Settings → AI models;
    # the page marks what's kept off (ai_lock_status). The backend refuses to send a kept-off note to a cloud model (local_ai).
    def _ai_lock_state(self):
        st = ai_lock.instance().status()
        return {"status": "success", **st, "ask": self.cfg.get("ai_lock_ask", True) is not False, "once": self.cfg.get("ai_lock_once", True) is not False}

    @safe_action
    def ai_lock_status(self):
        """{status, items: [{kind, id, name, path, since}], notes, folders, projects: every id that is off cloud AI (what it sits in
        counts), ask, once}."""
        return self._ai_lock_state()

    @safe_action
    def ai_lock_set(self, kind, item_id, on=True):
        """Keep a project, folder or note off cloud AI (on) or allow it again (not on). The Timeline records it."""
        iid = _clean_id(item_id)
        if kind not in ai_lock.KINDS or not iid:
            return {"status": "error", "message": "Pick a project, a folder or a note."}
        lk = ai_lock.instance()
        if on is False:
            lk.unlock(kind, iid)
        elif not lk.lock(kind, iid):
            return {"status": "error", "message": "That isn't in this vault."}
        if getattr(self, "_vclash", None):
            return {**self._ai_lock_state(), "warning": "Another NeuroVault uses this folder, so the lock isn't saved in it yet."}
        return self._ai_lock_state()

    @safe_action
    def ai_lock_allow_all(self):
        """Settings → AI models → Allow cloud AI everywhere."""
        ai_lock.instance().clear()
        return self._ai_lock_state()

    @safe_action
    def ai_lock_first(self, project_key, answer):
        """The first-use question's answer: "send" (it won't ask again for this project) or "keep" (the project is kept off cloud AI).
        R69: for a note from outside the key is "outside:<note id>" and the answer "once" (a while, in memory), "always" (this note's
        project, kept in the vault) or "keep" (the note is kept off cloud AI)."""
        if isinstance(project_key, str) and project_key.startswith("outside:"):
            nid = _clean_id(project_key.partition(":")[2])
            if answer not in ("once", "always", "keep") or not nid or not self.db.query_one("SELECT 1 FROM notes WHERE id = ?", (nid,)):
                return {"status": "error", "message": "Send it once, always, or keep it on this PC."}
            lk = ai_lock.instance()
            if answer == "keep":
                lk.lock("note", nid, source="outside note")
            else:
                lk.allow_outside(nid, answer)
            return self._ai_lock_state()
        if answer not in ("send", "once", "always", "keep") or not isinstance(project_key, str) or ":" not in project_key:
            return {"status": "error", "message": "Send it, or keep it on this PC."}
        lk = ai_lock.instance()
        kind, _, ident = project_key.partition(":")
        if kind != "project" or not _clean_id(ident):
            return {"status": "error", "message": "That isn't a project."}
        if answer == "keep" and not lk.lock("project", int(ident), source="first use"):
            return {"status": "error", "message": "That project isn't in this vault."}
        if answer == "once":   # QC 117: the Agent's card: this once, and it asks again later
            lk.allow_project_once(project_key)
        else:
            lk.mark_asked(project_key)
        return self._ai_lock_state()

    @safe_list()
    def list_ai_lock_changes(self, limit=80):
        """For the Timeline: [{id, at, action: lock | allow, kind, name, path, source}], newest first."""
        return ai_lock.instance().changes(limit)
    # ==== end R68 ====

    @safe_action
    def ai_job_cancel(self, job_id):
        """Cancel: stops a summary, Ask or Tidy up job (the model stops) and drops its answer. {status, state, partial}:
        partial (R50) is what Ask had written so far, which the chat keeps, marked "Stopped"."""
        mgr = self._ai()
        if not mgr.cancel_job(job_id):
            return {"status": "error", "message": "Unknown job."}
        j = mgr.jobs[job_id]
        return {"status": "success", "state": j["state"], "partial": local_ai.qa_clean(j.get("partial") or "")[0] if j.get("kind") == "qa" else ""}
    # ==== end Build N =================================================================================================

    # ==== Build D · guided first-run setup (mockup R24, with R23's AI step and R28's live words) ===============
    # Six steps in the page (frontend/js/setup.js): Vault, Reading, Focus, Voice, AI, Ready. What the page shows live
    # (theme, font, the nudge, live words, the voice defaults, keep / long questions, the vault folder) saves through
    # save_settings as it's picked. setup_finish writes the choices that need a download and starts the downloads the
    # Ready step listed: the voice files one after another (guided_setup.Queue), the AI model and engine through Build B.

    def _setup_q(self):
        if not hasattr(self, "_setup_queue"):
            self._setup_queue = guided_setup.Queue()
            self._setup_ai = None   # {keys, labels, model} once the setup started an AI download
        return self._setup_queue

    def _setup_save(self, patch):
        self.cfg.update(patch)
        cfgmod.save_config(self.cfg)

    @safe_action
    def setup_state(self):
        """{status, show, done, new_db}: the setup shows when config.json has no setup_done flag and the database is
        new (no notes, tasks or sessions). An install that's been used is marked done here, so it's never forced on it."""
        done, new = bool(self.cfg.get("setup_done")), guided_setup.db_is_new(self.db)
        if not done and not new:
            self._setup_save({"setup_done": True})
            done = True
        return {"status": "success", "show": not done, "done": done, "new_db": new}

    @safe_action
    def setup_info(self):
        """What the steps show: this PC, speech to text and read-aloud voices (size, installed, source), live words,
        the AI models with their fit, the microphones, and the current values of the settings the setup writes."""
        rec = self.ai_recommend()
        try:
            mics = voicemod.list_mics()
        except voicemod.VoiceError:
            mics = []
        def files(spec):
            return {"files": [f for f, _ in spec.values()], "bytes": sum(n for _, n in spec.values())}
        return {"status": "success", "pc": rec.get("pc"),
                "stt": [{**voicemod.model_info(n), **files(voicemod.MODELS[n]["files"])} for n in voicemod.MODELS],
                "live": {**self._voice_v2_status()["live"], **files(voicemod.LIVE_MODEL["files"])},
                "tts": [guided_setup.tts_info(k) for k in guided_setup.TTS],
                "ai": {"rec": (rec.get("model") or {}).get("id"), "models": rec.get("models", []), "engine": rec.get("engine")},
                "mics": mics, "first_run": not self.cfg.get("setup_done"),
                "settings": {k: self.cfg.get(k) for k in guided_setup.SETUP_KEYS}}

    def _setup_choices(self, choices):
        c = choices if isinstance(choices, dict) else {}
        return c.get("stt") or "base.en", c.get("tts") or "windows", c.get("ai") or "", c.get("live")

    def _setup_plan(self, choices):
        """The downloads for the setup's choices: [{key, label, files, source, bytes, folder}], the total, and the space
        each drive keeps. choices: {stt: base.en | small.en | none, live: true | false | null (auto),
        tts: windows | kokoro, ai: a model id | ""}. Raises SetupError for a choice that can't be."""
        stt, tts, ai, live = self._setup_choices(choices)
        if stt not in voicemod.MODELS and stt != "none":
            raise guided_setup.SetupError(f"Unknown speech-to-text model {stt}.")
        if tts != "windows" and tts not in guided_setup.TTS:
            raise guided_setup.SetupError(f"Unknown read-aloud voice {tts}.")
        items = []
        if stt != "none":
            m = voicemod.model_info(stt)
            if not m["present"]:
                files = list(voicemod.MODELS[stt]["files"].values())
                items.append({"key": "stt", "label": f"Whisper {stt} (speech to text)", "files": [f for f, _ in files],
                              "source": m["source"], "bytes": sum(n for _, n in files), "folder": m["folder"]})
            li = voicemod.live_info()
            if (self._voice_live_on() if live is None else bool(live)) and not li["present"]:
                items.append({"key": "live", "label": "Live words model", "files": [f for f, _ in voicemod.LIVE_MODEL["files"].values()],
                              "source": li["source"], "bytes": li["bytes"], "folder": li["folder"]})
        if tts != "windows":
            t = guided_setup.tts_info(tts)
            if not t["present"]:
                sizes = {f: n for f, n, _ in guided_setup.TTS[tts]["archives"]}
                items.append({"key": "tts", "label": f"{t['label']} (read aloud)", "files": t["missing"], "source": t["source"],
                              "bytes": sum(sizes[f] for f in t["missing"]), "folder": t["folder"]})
        if ai:
            st = self._ai().status()
            m = next((x for x in st["models"] if x["id"] == ai), None)
            if not m:
                raise guided_setup.SetupError(f"Unknown AI model {ai}.")
            if not m["installed"] and m["fit"]:
                raise guided_setup.SetupError(m["fit"])
            if not st["engine"]["build"]:
                e = st["engine"]["offer"]
                items.append({"key": "engine", "label": "AI engine (llama.cpp)", "files": [e["file"]], "source": e["source"],
                              "bytes": e["bytes"], "folder": local_ai.engine_dir()})
            if not m["installed"]:
                items.append({"key": ai, "label": f"{m['name']} (AI)", "files": [m["file"]], "source": str(m.get("page") or "").replace("https://", ""),
                              "bytes": m["bytes"], "folder": local_ai.models_dir()})
        drives = {}
        for it in items:
            drive, free = guided_setup.free_on(it["folder"])
            d = drives.setdefault(drive, {"drive": drive, "free_bytes": free, "need_bytes": 0})
            d["need_bytes"] += it["bytes"]
        for d in drives.values():
            d["left_bytes"] = d["free_bytes"] - d["need_bytes"]
        return {"items": items, "total_bytes": sum(it["bytes"] for it in items), "drives": list(drives.values()),
                "fits": all(d["left_bytes"] > 0 for d in drives.values())}

    @safe_action
    def setup_plan(self, choices):
        """{status, items, total_bytes, drives: [{drive, free_bytes, need_bytes, left_bytes}], fits}: what the Ready step
        lists (every file, where it comes from, how big) before anything downloads."""
        try:
            return {"status": "success", **self._setup_plan(choices)}
        except guided_setup.SetupError as e:
            return {"status": "error", "message": plain_error(e)}

    @safe_action
    def setup_finish(self, choices):
        """Start NeuroVault: writes the choices that need a download (speech to text, the read-aloud engine and voice),
        marks the setup done, and starts the downloads setup_plan listed, in the background. Poll setup_status()."""
        try:
            plan = self._setup_plan(choices)
        except guided_setup.SetupError as e:
            return {"status": "error", "message": plain_error(e)}
        if not plan["fits"]:
            d = next(d for d in plan["drives"] if d["left_bytes"] <= 0)
            return {"status": "error", "message": f"Not enough space: {d['drive']} has {d['free_bytes'] / 1e9:.1f} GB free "
                                                  f"and the downloads need {d['need_bytes'] / 1e9:.1f} GB."}
        if self._setup_q().busy():
            return {"status": "error", "message": "The setup's downloads are already running."}
        stt, tts, ai, live = self._setup_choices(choices)
        patch = {"setup_done": True, "read_engine": "windows" if tts == "windows" else "sherpa"}
        if stt != "none":
            patch["voice_stt_model"] = stt
            if live is not None:
                patch["voice_live"] = "on" if live else "off"
        if tts != "windows":
            patch["read_voice_sherpa"] = guided_setup.TTS[tts]["voice"]
        self._setup_save(patch)
        sess, jobs = self._voice(), []
        for it in plan["items"]:
            if it["key"] == "stt":
                run = lambda p, cancel: guided_setup.wait_voice(sess, cancel, p, lambda: sess.download(stt))
            elif it["key"] == "live":
                run = lambda p, cancel: guided_setup.wait_voice(sess, cancel, p, sess.download_live)
            elif it["key"] == "tts":
                run = lambda p, cancel: guided_setup.download_tts(tts, p, cancel)
            else:
                continue   # the AI engine and model: Build B's downloads, below
            jobs.append({"key": it["key"], "label": it["label"], "bytes": it["bytes"], "run": run})
        if jobs:
            self._setup_q().start(jobs)
        ai_items = [it for it in plan["items"] if it["key"] not in ("stt", "live", "tts")]
        self._setup_ai = None
        if ai_items:
            r = self.ai_download(ai, True)
            if r.get("status") != "success":
                return {"status": "error", "message": r.get("message", "The AI download didn't start."), "plan": plan}
            self._setup_ai = {"keys": [it["key"] for it in ai_items], "labels": {it["key"]: it["label"] for it in ai_items}, "model": ai}
        return {"status": "success", "plan": plan, "downloads": self._setup_items()}

    def _setup_items(self):
        items = self._setup_q().status()
        ai = getattr(self, "_setup_ai", None)
        if ai:
            st = self._ai().status()
            for key in ai["keys"]:
                d = st["downloads"].get(key)
                if d:
                    state = {"checking": "downloading"}.get(d["state"], d["state"])
                    items.append({"key": key, "label": ai["labels"][key], "state": state, "done": d["done"], "total": d["total"],
                                  "message": d.get("message", "")})
                else:
                    have = st["engine"]["build"] if key == "engine" else key in st["installed"]
                    items.append({"key": key, "label": ai["labels"][key], "state": "done" if have else "cancelled", "done": 0, "total": 0, "message": ""})
        return items

    @safe_action
    def setup_status(self):
        """{status, items: [{key, label, state (queued | downloading | paused | done | error | cancelled), done, total,
        message}], busy}: the setup's background downloads."""
        items = self._setup_items()
        return {"status": "success", "items": items, "busy": any(it["state"] in ("queued", "downloading", "paused") for it in items)}

    @safe_action
    def setup_cancel(self):
        """Stops the setup's downloads that haven't finished (their part files are deleted)."""
        self._setup_q().cancel()
        for key in (getattr(self, "_setup_ai", None) or {}).get("keys", []):
            self._ai().cancel(key)
        return {"status": "success"}

    @safe_action
    def setup_skip(self):
        """Skip on a first run writes the defaults for everything the setup asks and marks it done. From "Run the setup
        again" it only closes: nothing that's set changes."""
        patch = {"setup_done": True}
        if not self.cfg.get("setup_done"):
            patch.update({k: cfgmod.DEFAULT_CONFIG[k] for k in guided_setup.SETUP_KEYS})
        self._setup_save(patch)
        return {"status": "success", **self.get_settings()}
    # ==== end Build D =========================================================
    # ==== Build F · the end-of-day wrap-up and the morning launchpad (mockup wrap1–wrap3, launch) ====================
    # A calm reminder at the wind-down time (Snooze while a timer runs), or the window bar's sunset button, opens three
    # steps: 1 wins (tasks and steps ticked today, focus time and sessions; pick one), 2 tidy (unfinished tasks, sticky
    # notes and inbox thoughts: roll on to tomorrow, park or done), 3 a note to tomorrow-you (1–3 starter tasks, a
    # typed note, a 10-second voice memo). On the first open of a later day the launchpad shows the note and the first
    # starter task, and "Launch first task and timer" starts it on the timer. A day turns over at 04:00 (db.WRAP_DAY_HOUR).

    _WRAP_NOTE_MAX = 5_000
    _WRAP_WIN_MAX = 500
    _LAUNCH_MINUTES = 25   # the launchpad's suggested session, when the task has no timed step left

    def _wrap_now(self):
        """Local time now (tests replace this to move the clock)."""
        return _local_now()

    def _wrap_day(self, now=None):
        return ((now or self._wrap_now()) - timedelta(hours=WRAP_DAY_HOUR)).date().isoformat()

    @staticmethod
    def _wrap_day_ok(day):
        try:
            return datetime.strptime(str(day), "%Y-%m-%d").date().isoformat() == day
        except ValueError:
            return False

    @staticmethod
    def _wrap_window(day):
        """[start, end) of a wrap-up day as local ISO times: 04:00 to 04:00."""
        start = datetime.strptime(day, "%Y-%m-%d").replace(hour=WRAP_DAY_HOUR)
        return start.isoformat(), (start + timedelta(days=1)).isoformat()

    @staticmethod
    def _wrap_next(day):
        return (datetime.strptime(day, "%Y-%m-%d") + timedelta(days=1)).date().isoformat()

    def _wrap_row(self, day, create=False):
        row = self.db.query_one("SELECT * FROM wrapups WHERE day = ?", (day,))
        if row or not create:
            return row
        stamp = self._wrap_now().isoformat()
        self.db.execute("INSERT OR IGNORE INTO wrapups (day, created_at, updated_at) VALUES (?, ?, ?)", (day, stamp, stamp))
        return self.db.query_one("SELECT * FROM wrapups WHERE day = ?", (day,))

    def _wrap_view(self, row):
        if not row:
            return None
        w = dict(row)
        w["tidy"] = json.loads(w["tidy"] or "[]")
        w["starters"] = json.loads(w["starters"] or "[]")
        w["finished"] = bool(w["finished_at"])
        w["file"] = f"wrapups/{w['day']}.md"
        return w

    def _wrap_set(self, day, **sets):
        self._wrap_row(day, create=True)
        sets["updated_at"] = self._wrap_now().isoformat()
        cols = ", ".join(f"{k} = ?" for k in sets)
        self.db.execute(f"UPDATE wrapups SET {cols} WHERE day = ?", (*sets.values(), day))
        return self._wrap_view(self._wrap_row(day))

    def _wind_down(self, day):
        """The wind-down time on that wrap-up day, as a datetime (a time before 04:00 falls on the next calendar day)."""
        t = self.cfg.get("wrapup_time") or "17:00"
        if cfgmod.check_reader_setting("wrapup_time", t)[1]:
            t = "17:00"
        h, m = map(int, t.split(":"))
        at = datetime.strptime(day, "%Y-%m-%d").replace(hour=h, minute=m)
        return at + timedelta(days=1) if h < WRAP_DAY_HOUR else at

    @safe_action
    def wrapup_status(self):
        """{status, day, reminder, time, snooze_minutes, launchpad, reached, due, snoozed_until, finished, dismissed,
        timer_running, wrapup}. due: the reminder should show now (on, the time reached, not finished, dismissed or
        snoozed). The page asks about once a minute."""
        now = self._wrap_now()
        day = self._wrap_day(now)
        w = self._wrap_view(self._wrap_row(day))
        on = self.cfg.get("wrapup_reminder", True) is not False
        reached = now >= self._wind_down(day)
        snoozed = bool(w and w["snoozed_until"] and now.isoformat() < w["snoozed_until"])
        finished, dismissed = bool(w and w["finished_at"]), bool(w and w["dismissed_at"])
        run = self._running_row()
        return {"status": "success", "day": day, "reminder": on, "time": self.cfg.get("wrapup_time", "17:00"),
                "snooze_minutes": self.cfg.get("wrapup_snooze_minutes", 15), "launchpad": self.cfg.get("wrapup_launchpad", True) is not False,
                "reached": reached, "due": on and reached and not (finished or dismissed or snoozed),
                "snoozed_until": w["snoozed_until"] if snoozed else None, "finished": finished, "dismissed": dismissed,
                "timer_running": bool(run) and not run["stopped_at"], "wrapup": w}

    @safe_action
    def wrapup_snooze(self, minutes=None):
        """The reminder comes back in `minutes` (default: the snooze setting). {status, minutes, snoozed_until}"""
        try:
            minutes = int(minutes if minutes not in (None, "") else self.cfg.get("wrapup_snooze_minutes", 15))
        except (TypeError, ValueError):
            return {"status": "error", "message": "Snooze minutes must be a whole number."}
        if not 1 <= minutes <= 240:
            return {"status": "error", "message": "Snooze for 1 to 240 minutes."}
        now = self._wrap_now()
        until = (now + timedelta(minutes=minutes)).isoformat()
        self._wrap_set(self._wrap_day(now), snoozed_until=until, dismissed_at=None)
        return {"status": "success", "minutes": minutes, "snoozed_until": until}

    @safe_action
    def wrapup_dismiss(self):
        """The reminder was closed without finishing: it doesn't come back today (the sunset button still opens it)."""
        now = self._wrap_now()
        self._wrap_set(self._wrap_day(now), dismissed_at=now.isoformat())
        return {"status": "success"}

    @safe_action
    def wrapup_wins(self, day=None):
        """Step 1: what got done that day. {status, day, tasks: [{id, title, completed_at, project_name}], steps: [{id,
        text, minutes, done_at, task_id, task_title}], projects: [{project_id, name, color, count, seconds}], totals:
        {tasks, steps, sessions, seconds}}. Tasks and steps count from when they were ticked (completed_at / done_at)."""
        day = day or self._wrap_day()
        if not self._wrap_day_ok(day):
            return {"status": "error", "message": "day must be YYYY-MM-DD."}
        start, end = self._wrap_window(day)
        between = "datetime({0}) >= datetime(?) AND datetime({0}) < datetime(?)"
        tasks = [dict(r) for r in self.db.query(
            f"""SELECT t.id, t.title, t.completed_at, t.project_id, p.name AS project_name FROM tasks t
                LEFT JOIN projects p ON p.id = t.project_id WHERE t.completed = 1 AND {between.format('t.completed_at')}
                ORDER BY t.completed_at, t.id""", (start, end))]
        steps = [dict(r) for r in self.db.query(
            f"""SELECT s.id, s.text, s.minutes, s.done_at, s.task_id, t.title AS task_title FROM task_steps s
                JOIN tasks t ON t.id = s.task_id WHERE s.done = 1 AND {between.format('s.done_at')}
                ORDER BY s.done_at, s.id""", (start, end))]
        projects = [dict(r) for r in self.db.query(
            f"""SELECT s.project_id, COALESCE(p.name, 'No project') AS name, p.color_slot AS color, COUNT(*) AS count,
                       SUM(s.actual_seconds) AS seconds FROM sessions s LEFT JOIN projects p ON p.id = s.project_id
                WHERE {between.format('s.start_time')} GROUP BY s.project_id ORDER BY seconds DESC""", (start, end))]
        return {"status": "success", "day": day, "tasks": tasks, "steps": steps, "projects": projects,
                "totals": {"tasks": len(tasks), "steps": len(steps), "sessions": sum(p["count"] for p in projects),
                           "seconds": sum(p["seconds"] or 0 for p in projects)}}

    @staticmethod
    def _first_line(text, fallback):
        line = next((x.strip() for x in str(text or "").split("\n") if x.strip()), "")
        return line or fallback

    @safe_action
    def wrapup_tidy_items(self):
        """Step 2: the loose ends. {status, day, items: [{kind: task | sticky | inbox, id, title, ...}]}: tasks not done
        and due by today (overdue too), every sticky note, and the inbox's thoughts not yet done."""
        day = self._wrap_day()
        items = [{"kind": "task", "id": r["id"], "title": r["title"], "due_date": r["due_date"], "project_name": r["project_name"],
                  "overdue": r["due_date"][:10] < day}
                 for r in self.db.query("""SELECT t.id, t.title, t.due_date, p.name AS project_name FROM tasks t
                                           LEFT JOIN projects p ON p.id = t.project_id
                                           WHERE t.completed = 0 AND t.due_date IS NOT NULL AND substr(t.due_date, 1, 10) <= ?
                                           ORDER BY t.due_date, t.id""", (day,))]
        items += [{"kind": "sticky", "id": r["id"], "n": r["n"], "title": self._first_line(r["text"], "Empty sticky note"), "open": bool(r["open"])}
                  for r in self.db.query("SELECT * FROM stickies ORDER BY n, id")]
        items += [{"kind": "inbox", "id": it["id"], "title": it["text"] or (it["tasks"][0] if it["tasks"] else "Voice thought"),
                   "day": it["day"], "time": it["time"], "audio": it.get("audio"), "tasks": it["tasks"]}
                  for it in (self._inbox_view(r) for r in self.db.query("SELECT * FROM inbox_items WHERE done = 0 ORDER BY created_at, id"))]
        return {"status": "success", "day": day, "items": items}

    def _tidy_apply(self, kind, item_id, action, day):
        """One loose end sorted. Returns the log entry; raises ValueError with a message the page can show."""
        if kind not in TIDY_KINDS:
            raise ValueError("kind must be task, sticky or inbox.")
        if action not in TIDY_ACTIONS:
            raise ValueError("action must be roll, park or done.")
        item_id = _clean_id(item_id)
        entry = {"kind": kind, "id": item_id, "action": action, "at": self._wrap_now().isoformat()}
        now = utc_now_iso()
        if kind == "task":
            row = item_id and self.db.query_one("SELECT * FROM tasks WHERE id = ?", (item_id,))
            if not row:
                raise ValueError("Task not found.")
            entry["title"] = row["title"]
            if action == "done":
                self.db.execute("UPDATE tasks SET completed = 1, updated_at = ? WHERE id = ?", (now, item_id))
            else:   # roll: due the day after; park: no due date, so it waits in the backlog
                due = self._wrap_next(day) if action == "roll" else None
                self.db.execute("UPDATE tasks SET due_date = ?, updated_at = ? WHERE id = ?", (due, now, item_id))
                entry["due_date"] = due
        elif kind == "sticky":
            row = self._sticky_row(item_id)
            if not row:
                raise ValueError("Sticky note not found.")
            entry["title"] = self._first_line(row["text"], f"Sticky #{row['n']}")
            if action == "done":   # finished with: it goes (its text stays in this wrap-up's log)
                self.db.execute("DELETE FROM stickies WHERE id = ?", (item_id,))
            else:   # roll: on the screen tomorrow; park: the card closes, the note stays in stickynoted/
                self.db.execute("UPDATE stickies SET open = ? WHERE id = ?", (1 if action == "roll" else 0, item_id))
        else:
            row = item_id and self.db.query_one("SELECT * FROM inbox_items WHERE id = ?", (item_id,))
            if not row:
                raise ValueError("Inbox item not found.")
            it = self._inbox_view(row)
            entry["title"] = it["text"] or (it["tasks"][0] if it["tasks"] else "Voice thought")
            if action == "park":   # a task in the backlog (no due date), and the thought is ticked off in _inbox.md
                title = entry["title"] if len(entry["title"]) <= 200 else entry["title"][:199].rstrip() + "…"
                desc = "\n".join(([it["text"]] if it["text"] and len(it["text"]) > 200 else []) + [f"Task: {t}" for t in it["tasks"]]
                                 + ([f"![[{it['audio']}]]"] if it.get("audio") else []))
                r = self.save_task(None, title, desc, "Medium", None, None, "", False, None, "medium")
                if r.get("status") != "success":
                    raise ValueError(r.get("message") or "Couldn't make the task.")
                entry["task_id"] = r["id"]
            if action != "roll":
                self.db.execute("UPDATE inbox_items SET done = 1 WHERE id = ?", (item_id,))
        return entry

    def _tidy_log(self, day, entries):
        w = self._wrap_view(self._wrap_row(day, create=True))
        keep = [t for t in w["tidy"] if not any(t["kind"] == e["kind"] and t["id"] == e["id"] for e in entries)]
        self._wrap_set(day, tidy=json.dumps(keep + entries))

    @safe_action
    def wrapup_tidy(self, kind, item_id, action):
        """One loose end: kind task | sticky | inbox, action roll | park | done (see _tidy_apply). Logged on today's
        wrap-up. {status, entry}"""
        day = self._wrap_day()
        try:
            entry = self._tidy_apply(kind, item_id, action, day)
        except ValueError as e:
            return {"status": "error", "message": plain_error(e)}
        self._tidy_log(day, [entry])
        return {"status": "success", "entry": entry}

    def _starter_ids(self, ids):
        out = []
        for raw in ids or []:
            tid = _clean_id(raw)
            if tid is None or tid in out:
                continue
            if not self.db.query_one("SELECT id FROM tasks WHERE id = ? AND completed = 0", (tid,)):
                raise ValueError("A starter task isn't open any more.")
            out.append(tid)
        return out

    @safe_action
    def wrapup_finish(self, data):
        """Finish the day. data: {win, win_ref, note, starters: [task ids], new_starters: [titles], tidy: [{kind, id,
        action}]}. The tidy choices are applied (each one on its own: a failure is listed in errors, the rest go on),
        typed starters become tasks, and starters are due the next day (at most 3 in all). {status, wrapup, errors}"""
        if not isinstance(data, dict):
            return {"status": "error", "message": "Nothing to save."}
        day = self._wrap_day()
        win = " ".join(str(data.get("win") or "").split())
        note = str(data.get("note") or "").strip()
        if len(win) > self._WRAP_WIN_MAX:
            return {"status": "error", "message": "That win is too long."}
        if len(note) > self._WRAP_NOTE_MAX:
            return {"status": "error", "message": "The note to tomorrow is too long."}
        typed = [" ".join(str(t).split()) for t in (data.get("new_starters") or []) if str(t).strip()]
        try:
            ids = self._starter_ids(data.get("starters"))
        except ValueError as e:
            return {"status": "error", "message": plain_error(e)}
        if len(ids) + len(typed) > 3:
            return {"status": "error", "message": "Pick up to 3 starter tasks."}
        if any(len(t) > 200 for t in typed):
            return {"status": "error", "message": "A starter task's name is too long."}
        win_ref = data.get("win_ref") if win and isinstance(data.get("win_ref"), str) and len(data["win_ref"]) <= 40 else None
        entries, errors = [], []
        for t in data.get("tidy") or []:
            try:
                entries.append(self._tidy_apply((t or {}).get("kind"), t.get("id"), t.get("action"), day))
            except (ValueError, AttributeError) as e:
                errors.append({"kind": (t or {}).get("kind") if isinstance(t, dict) else None, "id": t.get("id") if isinstance(t, dict) else None, "message": plain_error(e)})
        if entries:
            self._tidy_log(day, entries)
        tomorrow = self._wrap_next(day)
        for title in typed:
            r = self.save_task(None, title, "", "Medium", tomorrow, None, "", False, None, "medium")
            if r.get("status") == "success":
                ids.append(r["id"])
            else:
                errors.append({"kind": "starter", "id": None, "message": r.get("message")})
        starters = []
        for tid in ids:   # still open (a tidy "done" may have closed one), and due the next day at the latest
            row = self.db.query_one("SELECT id, title, due_date, completed FROM tasks WHERE id = ?", (tid,))
            if not row or row["completed"]:
                continue
            if not row["due_date"] or row["due_date"][:10] < tomorrow:
                self.db.execute("UPDATE tasks SET due_date = ?, updated_at = ? WHERE id = ?", (tomorrow, utc_now_iso(), tid))
            starters.append({"task_id": tid, "title": row["title"]})
        w = self._wrap_set(day, win=win, win_ref=win_ref, note=note, starters=json.dumps(starters),
                           finished_at=self._wrap_now().isoformat(), launch_shown_at=None, launched_at=None)
        return {"status": "success", "wrapup": w, "errors": errors}

    @safe_action
    def wrapup_memo_keep(self):
        """Step 3's 10-second memo: the recording just stopped (voice_start(10), voice_stop) is saved as
        attachments/voice-….ogg on today's wrap-up, like Build A's take; an earlier memo of today goes to the
        recycle bin. {status, file, seconds, size}"""
        k = self.voice_keep("audio")
        if k.get("status") != "success":
            return k
        self._voice().discard()   # the memo needs no transcript
        day = self._wrap_day()
        old = (self._wrap_row(day) or {"memo": None})["memo"]
        self._wrap_set(day, memo=k["file"], memo_seconds=k["seconds"])
        if old and old != k["file"]:
            try:
                attachments.recycle(self._att_path(old))
            except attachments.AttachmentError as e:
                log.warning("Old memo: %s", e)
        return {"status": "success", "file": k["file"], "seconds": k["seconds"], "size": k["size"]}

    @safe_action
    def wrapup_memo_remove(self):
        """Today's memo goes to the recycle bin."""
        day = self._wrap_day()
        row = self._wrap_row(day)
        if not row or not row["memo"]:
            return {"status": "error", "message": "There's no memo to delete."}
        try:
            attachments.recycle(self._att_path(row["memo"]))
        except attachments.AttachmentError as e:
            log.warning("Memo: %s", e)
        self._wrap_set(day, memo=None, memo_seconds=None)
        return {"status": "success"}

    @safe_action
    def wrapup_get(self, day=None):
        """{status, wrapup}: that day's wrap-up (default today), or None."""
        day = day or self._wrap_day()
        if not self._wrap_day_ok(day):
            return {"status": "error", "message": "day must be YYYY-MM-DD."}
        return {"status": "success", "wrapup": self._wrap_view(self._wrap_row(day))}

    @safe_action
    def get_wrapup_file(self, day=None):
        """{status, file, text}: the wrap-up as the vault-on-disk build will write it."""
        day = day or self._wrap_day()
        w = self._wrap_day_ok(day) and self._wrap_view(self._wrap_row(day))
        if not w:
            return {"status": "error", "message": "No wrap-up for that day."}
        return {"status": "success", "file": w["file"], "text": wrapup_markdown(w)}

    def _launch_view(self, row):
        """The wrap-up with its starters looked up again (done since? deleted?) and the first one still open."""
        w = self._wrap_view(row)
        first, out = None, []
        for s in w["starters"]:
            t = self.db.query_one("SELECT id, title, completed, energy, priority, project_id, note_id FROM tasks WHERE id = ?", (s["task_id"],))
            item = {"task_id": s["task_id"], "title": t["title"] if t else s["title"], "gone": not t, "done": bool(t and t["completed"])}
            if t:
                item.update(energy=t["energy"], priority=t["priority"], project_id=t["project_id"], note_id=t["note_id"])
                step = self.db.query_one("""SELECT minutes FROM task_steps WHERE task_id = ? AND done = 0 AND minutes > 0
                                            ORDER BY position, id LIMIT 1""", (t["id"],))
                item["minutes"] = step["minutes"] if step else self._LAUNCH_MINUTES
                if not first and not t["completed"]:
                    first = item
            out.append(item)
        w["starters"], w["first"] = out, first
        return w

    @safe_action
    def launchpad_get(self):
        """{status, launchpad, show}: the latest wrap-up finished on an earlier day, with its starters; show is true
        when the launchpad is on in Settings and it hasn't been shown yet (once, on the first open of a later day)."""
        row = self.db.query_one("SELECT * FROM wrapups WHERE finished_at IS NOT NULL AND day < ? ORDER BY day DESC LIMIT 1",
                                (self._wrap_day(),))
        if not row:
            return {"status": "success", "launchpad": None, "show": False}
        w = self._launch_view(row)
        return {"status": "success", "launchpad": w,
                "show": self.cfg.get("wrapup_launchpad", True) is not False and not w["launch_shown_at"]}

    @safe_action
    def launchpad_seen(self, day):
        """The launchpad for that wrap-up showed: not again on its own (Ctrl+K still opens it)."""
        if not self._wrap_day_ok(day) or not self._wrap_row(day):
            return {"status": "error", "message": "No wrap-up for that day."}
        self._wrap_set(day, launch_shown_at=self._wrap_now().isoformat())
        return {"status": "success"}

    @safe_action
    def launchpad_launch(self, day, minutes=None):
        """Launch first task and timer: a planned session on the first open starter task (its first timed step's
        minutes, else 25), in the task's project, else its note's, else the first project. With a session already
        going, nothing starts (started false, reason running | rate). {status, started, reason, task_id, project_id,
        minutes, session}"""
        row = self._wrap_day_ok(day) and self._wrap_row(day)
        if not row or not row["finished_at"]:
            return {"status": "error", "message": "No wrap-up for that day."}
        first = self._launch_view(row)["first"]
        if not first:
            return {"status": "error", "code": "no_task", "message": "No starter task is left open."}
        pid = first["project_id"]
        if not pid and first["note_id"]:
            n = self.db.query_one("SELECT project_id FROM notes WHERE id = ?", (first["note_id"],))
            pid = n and n["project_id"]
        if not pid:
            p = self.db.query_one("SELECT id FROM projects WHERE archived = 0 ORDER BY id LIMIT 1")
            pid = p and p["id"]
        if not pid:
            return {"status": "error", "code": "no_project", "message": "Make a project first, so the timer has something to log to."}
        try:
            mins = int(minutes if minutes not in (None, "") else first["minutes"])
        except (TypeError, ValueError):
            return {"status": "error", "message": "minutes must be a whole number."}
        if not 1 <= mins <= 600:
            return {"status": "error", "message": "minutes must be 1 to 600."}
        out = {"status": "success", "task_id": first["task_id"], "project_id": pid, "minutes": mins}
        run = self._running_row()
        self._wrap_set(day, launched_at=self._wrap_now().isoformat(), launch_shown_at=row["launch_shown_at"] or self._wrap_now().isoformat())
        if run:
            return {**out, "started": False, "reason": "rate" if run["stopped_at"] else "running", "session": self.get_running_session()}
        r = self.start_running_session(pid, mins * 60, "planned", first["task_id"])
        if r.get("status") != "success":
            return r
        return {**out, "started": True, "reason": None, "session": r["session"]}
    # ==== end Build F =========================================================
    # ---- Build E · reading fonts: Settings → Reading & comfort → More fonts (fonts.py). Fonts download from
    # font_list.json (each font's official release, size and sha256 checked) or are your own .ttf / .otf / .woff2,
    # checked by its first bytes. They live in .neurovault/fonts next to the database until the vault on disk exists.
    # Downloads run in a thread: the page polls fonts_status(). An added font applies to the whole app (font_use).
    def _fonts(self):
        if not hasattr(self, "_fonts_mgr"):
            base = self._att_base  # Build V: .neurovault/fonts in the vault once there is one
            self._fonts_mgr = fontsmod.Fonts(base, self.cfg, self._fonts_save)
        return self._fonts_mgr

    def _fonts_save(self, patch):
        self.cfg.update(patch)
        cfgmod.save_config(self.cfg)

    def _fonts_call(self, fn, *args):
        try:
            return fn(*args)
        except fontsmod.FontError as e:
            return {"status": "error", "message": plain_error(e)}

    @safe_action
    def fonts_status(self):
        """{status, fonts: [list rows with installed / download], own: [...], use, offline, folder, used_bytes, used_mb}."""
        return self._fonts().status()

    @safe_action
    def font_download(self, font_id):
        """Starts one font's download from the font list; progress comes from fonts_status()."""
        return self._fonts_call(self._fonts().download, str(font_id))

    @safe_action
    def font_cancel(self, font_id):
        return self._fonts_call(self._fonts().cancel, str(font_id))

    @safe_action
    def font_use(self, font_id):
        """An added font for the whole app; "" goes back to the built-in font in `font`."""
        return self._fonts_call(self._fonts().use, str(font_id or ""))

    @safe_action
    def font_remove(self, font_id):
        """Deletes the font's folder; the font in use goes back to the built-in one."""
        return self._fonts_call(self._fonts().remove, str(font_id))

    @safe_action
    def font_data(self, font_id):
        """{status, family, name, files: [{weight, style, format, data (base64)}]} for the page's FontFace."""
        return self._fonts_call(self._fonts().data, str(font_id))

    @safe_action
    def font_add_file(self):
        """Add your own font…: a file picker for .ttf / .otf / .woff2, then the checks and the copy."""
        if not self._window:
            return {"status": "error", "message": "Opens a file picker in the app."}
        picked = self._window.create_file_dialog(webview.OPEN_DIALOG, file_types=("Font files (*.ttf;*.otf;*.woff2)", "All files (*.*)"))
        if not picked:
            return {"status": "cancelled"}
        return self._font_add_path(picked[0])

    def _font_add_path(self, path):
        try:
            return {"status": "success", "font": self._fonts().add_file(path)}
        except fontsmod.FontError as e:
            return {"status": "error", "bad": True, "file": os.path.basename(path), "message": plain_error(e)}
    # ---- end Build E ----

    # ==== Build H · stickies and the quick timer popped out of the app (mockup R34) ====================
    # Each is its own small frameless window on top of other apps, with no taskbar button (popout.py, winframe.py).
    # kind: "sticky" (item_id: the sticky's id) or "timer" (item_id: None). Every change is sent to every window
    # (window.nvSync, frontend/js/popout.js), so the main window, the popped-out ones and the Timer view agree.

    def _pop_kind(self, kind, item_id):
        if kind not in popout.KINDS:   # Build N (QC 103): "ask", the Ask chat's own window; Build M (QC 107): "mindmap"
            return None, {"status": "error", "message": "kind must be sticky, timer, ask or mindmap."}
        if kind == "sticky":
            item_id = _clean_id(item_id)
            if item_id is None:
                return None, {"status": "error", "message": "Which sticky note?"}
        return (item_id if kind == "sticky" else None), None

    @safe_action
    def pop_out(self, kind, item_id=None, x=None, y=None, w=None, h=None):
        """Pops a sticky or the quick timer out as its own window. x / y (desktop, logical pixels) are optional:
        without them it opens where it was last time, or else from the top-right corner of NeuroVault's screen."""
        item_id, err = self._pop_kind(kind, item_id)
        return err or self._pop.pop_out(kind, item_id, x, y, w, h)

    @safe_action
    def pop_in(self, kind, item_id=None):
        """Back into NeuroVault: its window closes and it shows inside the app again."""
        item_id, err = self._pop_kind(kind, item_id)
        return err or self._pop.pop_in(kind, item_id)

    @safe_action
    def pop_close(self, kind, item_id=None):
        """The popped-out window's Close: a sticky stays saved (closed), a running timer keeps going."""
        item_id, err = self._pop_kind(kind, item_id)
        return err or self._pop.pop_close(kind, item_id)

    @safe_action
    def set_on_top(self, kind, item_id=None, on=True):
        """Keep on top of other apps (on), or let other apps cover it. Saved."""
        item_id, err = self._pop_kind(kind, item_id)
        return err or self._pop.set_on_top(kind, item_id, on)

    @safe_list()
    def popped(self):
        """What's popped out now: [{kind, id, key, on_top}]."""
        return self._pop.items()

    @safe_action
    def pop_show(self, kind=None, item_id=None):
        """Brings one popped-out window to the front (or all of them, with no kind)."""
        if kind is None:
            return self._pop.show_all()
        item_id, err = self._pop_kind(kind, item_id)
        return err or self._pop.show(kind, item_id)

    @safe_action
    def pop_all_in(self):
        """Brings every popped-out window back into NeuroVault."""
        return self._pop.all_in()

    def pop_drag(self, kind, item_id, part):
        """A press on a popped-out window's strip ('caption') or its resize grip ('se'): Windows moves or sizes it."""
        item_id, err = self._pop_kind(kind, item_id)
        return False if err else self._pop.drag(kind, item_id, part)

    def pop_fit(self, kind, item_id, w, h):
        """The popped-out timer's page asks for the size of what it shows."""
        item_id, err = self._pop_kind(kind, item_id)
        return False if err else self._pop.fit(kind, item_id, w, h)

    ASK_SYNC_MAX = 4_000_000   # characters: a chat and its note, as JSON

    @safe_action
    def pop_ask_sync(self, payload):
        """Build N (QC 103): the Ask chat's conversation, from the window it changed in to every other window (NeuroVault's dock
        and the chat's own window), so both show the same chat. payload: {from, key, chat, past, busy, note?, hello?}."""
        if not isinstance(payload, dict):
            return {"status": "error", "message": "Nothing to send."}
        size = len(json.dumps(payload, default=str))
        if size > self.ASK_SYNC_MAX:
            return {"status": "error", "message": "That chat is too long to show in two windows at once."}
        self._pop.sync({"kind": "ask", "data": payload})
        return {"status": "success"}

    # ---- Build M (QC 107): a note's mind map in its own window. NeuroVault's window owns the note ----
    @safe_action
    def pop_mm_sync(self, payload):
        """NeuroVault's window → the map's window: the note as it is now. payload: {id, title, md, layout, fold, sel, ltasks}."""
        if not isinstance(payload, dict):
            return {"status": "error", "message": "Nothing to send."}
        if len(json.dumps(payload, default=str)) > self.ASK_SYNC_MAX:
            return {"status": "error", "message": "That note is too long to show in two windows at once."}
        self._pop.sync({"kind": "mindmap", "data": payload}, to="pops")
        return {"status": "success"}

    @safe_action
    def pop_mm_relay(self, payload):
        """The map's window → NeuroVault's: what was done there (hello, pick, fold, layout, md). NeuroVault's window writes the note."""
        if not isinstance(payload, dict) or payload.get("op") not in ("hello", "pick", "fold", "layout", "md"):
            return {"status": "error", "message": "That can't be done from the map's window."}
        if len(json.dumps(payload, default=str)) > self.ASK_SYNC_MAX:
            return {"status": "error", "message": "That note is too long to send from the map's window."}
        self._pop.sync({"kind": "mindmap-do", "data": payload}, to="main")
        return {"status": "success"}

    @safe_action
    def pop_relay(self, act, value):
        """A popped-out sticky's menu (promote, append, attach, time it): the main window comes up and does it."""
        return self._pop.relay(act, value)

    @safe_list(default={})
    def popout_info(self):
        """Whether closing NeuroVault can keep it in the tray (pystray installed)."""
        return {"tray": bool(self._pop._tray_available())}

    @safe_action
    def timer_hotkey(self, action):
        """The global hotkeys (main.py, optional `keyboard` package): 'pause-toggle' (a quick pause, or resume) and 'stop'.
        Done here, where the timer lives, so every window follows (the timer's own window too)."""
        row = self._running_row()
        if not row or row["stopped_at"]:
            return {"status": "error", "code": "not_running", "message": "No session is running."}
        if action == "pause-toggle":
            if row["paused_at"]:
                return self.update_running_session("resume")
            return self.update_running_session("pause", "Quick pause")
        if action == "stop":
            return self.update_running_session("stop")
        return {"status": "error", "message": f"Unknown action: {action!r}."}
    # ==== end Build H =========================================================
    # ==== Build J · the dictionary and thesaurus with your own words, and the year on Timer → Insights (R37) ====
    # dictionary.py: Open English WordNet downloads once (after the page's ask) and is read into a SQLite index on this
    # PC; your words live in .neurovault/glossary.json next to the database (the vault, later), indexed in my_words.
    # The page polls dict_status() while the dictionary downloads and is made ready.
    def _dict(self):
        if not hasattr(self, "_dict_mgr"):
            base = self._att_base  # Build V: .neurovault/glossary.json in the vault once there is one
            self._dict_mgr = dictmod.Dictionary(base, self.db)
        return self._dict_mgr

    def _dict_call(self, fn, *args):
        try:
            return fn(*args)
        except dictmod.DictError as e:
            return {"status": "error", "message": plain_error(e), "field": e.field}

    @safe_action
    def dict_status(self):
        """{status, state: none | downloading | building | failed | ready, dictionary: the list entry, offline, words,
        mine (how many of yours), job: {done, total, fraction, message, kind}, glossary (the file), glossary_error}."""
        return self._dict().status()

    @safe_action
    def dict_download(self):
        """Starts the download of the listed dictionary, then makes it ready. Call only after the page's ask."""
        return self._dict_call(self._dict().download)

    @safe_action
    def dict_cancel(self):
        """Stops the download or the build; nothing half-finished is kept."""
        return self._dict_call(self._dict().cancel)

    @safe_action
    def dict_dismiss(self):
        """After a failed download: back to the ask."""
        return self._dict().dismiss()

    @safe_action
    def dict_search(self, q, scope="all"):
        """{status, q, exact, prefix, close, in_defs, via, shown (the entry to show, or null), guessed}. Rows are
        {key, word, pos, def, mine}. scope: all | mine. Searches WordNet (when it's here) and your words."""
        d = self._dict()
        res = d.search(str(q or "")[:80], "mine" if scope == "mine" else "all")
        key, guessed = d.best(res)
        return {"status": "success", **res, "shown": d.lookup(key) if key else None, "guessed": guessed}

    # ==== Fix A (QC 3 · 26): spelling for the note's right-click menu ====
    @safe_action
    def dict_spell(self, word, note_id=None, prev=None):
        """{status, word, known, suggestions: [{word, mine, d, span?}], checked, first?}: whether a right-clicked word is spelled
        as a known word, and if not, up to 5 close spellings (WordNet and your words; Dictionary.spell). A word the note's
        "Ignore in this note" keeps (config spell_ignore) is known there. prev (Build N, QC 76): the word just before it, so a
        space typed one letter late ("ther eown") is offered as "there own" (span "prev": it replaces both words).
        first: Windows' own first suggestion."""
        w = str(word or "")[:60]
        ign = (self.cfg.get("spell_ignore") or {}).get(str(note_id)) if note_id is not None else None
        if ign and w.strip().lower().replace("’", "'") in ign:
            return {"status": "success", "word": w.strip(), "known": True, "suggestions": [], "checked": True, "ignored": True}
        d = self._dict()
        base = d.spell(w, wide=not syspell.available())   # your words, the small words, numbers, short forms and WordNet: known without asking Windows
        trusted = base["checked"] or bool(d.my_word(dictmod.norm(w)))   # without WordNet, "known" only meant "can't tell"
        if (base["known"] and trusted) or not syspell.available():
            return {"status": "success", **base, "engine": "wordnet"}
        # Windows' spell checker (the red lines' own engine): British spelling and every word form WordNet lacks
        if syspell.is_correct(base["word"]):
            return {"status": "success", **base, "known": True, "suggestions": [], "checked": True, "engine": "windows"}
        sp = self._speller()   # Build N (QC 76): SymSpell's frequencies and Gboard-style keyboard slips, when the list is there
        more = (lambda x: []) if sp else (lambda x: [s["word"].lower() for s in d.spell(x, 8, wide=False)["suggestions"] if not s["mine"]])   # noqa: E731
        win = syspell.suggest(base["word"], 8, more)
        mine = [s["word"] for s in base["suggestions"] if s["mine"]]
        low = base["word"].lower()
        if sp:
            boost = self._ac_boost()
            extra = mine + [x for x in win if " " not in x] + self._ac_note_near(low, boost)
            cased = {x.lower(): x for x in [*win, *mine] if " " not in x}   # Windows' and your casing (British, a name of yours)
            model = [(sc, c, cased.get(x.lower(), x)) for sc, c, x in sp.rank(low, extra, boost)]
            self._ac_last = (low, model)
            ranked = [x[2] for x in model][:5]
        else:
            ranked = syspell.rank(base["word"], mine + win)[:5]
        # Build N (QC 76): a doubled letter typed once too many ("usefull") leads; Windows' own pair for a word ("alot" → a lot)
        # stays; any other two-word spelling goes when a one-word spelling is a slip away (feedback: "usefull" became "use full")
        pair = self._spell_pair(base["word"]) or next((pr for pr in map(self._spell_pair, sorted(self._spell_collapses(low))) if pr), None)   # aalot → alot → a lot
        if pair and pair not in ranked:
            ranked = [pair] + ranked[:4]
        col = [x for x in ranked if " " not in x and x.lower() in self._spell_collapses(low)]
        if col:
            ranked = col[:1] + [x for x in ranked if x != col[0]]
        if any(" " not in x and syspell.distance(low, x.lower()) <= 1 for x in ranked):
            ranked = [x for x in ranked if " " not in x or x == pair]
        if pair and pair in ranked:
            ranked = [pair] + [x for x in ranked if x != pair]
        # Build N (QC 52): run-together words ("hadnside" → hand side), only when no one-word spelling is a slip away (QC 76)
        good = [x for x in ranked if " " not in x and syspell.distance(low, x.lower()) <= 1]
        two = [] if good else [p for _, p in syspell.splits(base["word"], self._spell_is_word, slips=True, quick=self._spell_quick())]
        if two:
            rest = [x for x in ranked if x.lower() not in two]
            ranked = ([p for p in two] + [x for x in rest if x not in two])[:5]
        if pair and pair in ranked:   # Windows' own pair leads, splits or not (aalot → a lot)
            ranked = [pair] + [x for x in ranked if x != pair]
        sugg = [{"word": syspell.case_like(base["word"], x) if x not in mine else x, "mine": x in mine,
                 "d": syspell.distance(base["word"].lower(), x.lower())} for x in ranked]
        shift = self._spell_shift(prev, base["word"])   # Build N (QC 76): "ther eown" → there own, first, as a suggestion only
        if shift:
            sugg = [{"word": shift, "mine": False, "d": 1, "span": "prev"}] + sugg[:4]
        return {"status": "success", "word": base["word"], "known": False, "suggestions": sugg, "checked": True, "engine": "windows",
                "first": win[0] if win else None}

    # ==== Build N · QC 76: the user's live typing test ("usefull" became "use full"; opnion, recived and aalot left alone;
    # "ther eown" not offered as "there own") ====
    @staticmethod
    def _spell_collapses(low):
        """The word with one doubled letter typed once: usefull → useful, aalot → alot."""
        return {low[:i] + low[i + 1:] for i in range(1, len(low)) if low[i] == low[i - 1] and low[i].isalpha()}

    @staticmethod
    def _spell_pair(word):
        """Windows' own autocorrect pair for a word (alot → a lot), or None."""
        rep = [x[3] for x in syspell.errors(word) if x[2] == 2 and x[3]] if syspell.available() else []
        return rep[0] if rep else None

    def _spell_real(self, w):
        """A real word for the fixes below: Windows knows it and it isn't a rare one (WordNet's sense count, the small words)."""
        return syspell.available() and syspell.is_correct(w) and self._spell_is_word(w.lower()) >= 1

    def _spell_shift(self, prev, word):
        """A space typed one letter late or early: "ther eown" → "there own", "thereo wn" → "there own". Both words real."""
        p, w = str(prev or "").strip(), str(word or "").strip()
        if not (p.isalpha() and w.isalpha() and len(p) >= 2 and len(w) >= 2):
            return None
        for a, b in ((p + w[0], w[1:]), (p[:-1], p[-1] + w)):
            if len(a) >= 2 and len(b) >= 2 and self._spell_real(a) and self._spell_real(b):
                return f"{syspell.case_like(p, a.lower())} {b.lower()}"
        return None

    def _spell_tiebreak(self, w, first, ones):
        """Several spellings one slip away: the one the doubled letter makes (usefull → useful), else Windows' own first
        choice when the word is long enough and that choice is at least as common as each rival (opnion → opinion,
        recived → received). None when it's still a guess."""
        low = w.lower()
        col = [s for s in ones if s["word"].lower() in self._spell_collapses(low)]
        if len(col) == 1:
            return col[0]["word"]
        if len(low) >= 5 and first and any(s["word"].lower() == first.lower() for s in ones):
            f = self._spell_is_word(first.lower())
            if f >= 1 and all(f >= self._spell_is_word(s["word"].lower()) for s in ones):
                return next(s["word"] for s in ones if s["word"].lower() == first.lower())
        return None
    # ---- QC 76, grown: autocorrect like Gboard, learning on this PC (design profile "Autocorrect feels like Gboard and learns
    # from you"; feedback: "I really like the gboard keyboard auto correct. Also, is it trainable???") ----
    def _speller(self):
        """SymSpell's frequency list in memory (autocorrect.Speller), or None while it isn't downloaded."""
        path = autocorrect.freq_path()
        sp = self.__dict__.get("_ac_sp")
        if sp is None or sp.path != path:
            sp = self._ac_sp = autocorrect.Speller(path)
        return sp if sp.ready() else None

    def _ac_notes(self):
        """{word: uses} across your notes (lower case), when Settings lets autocorrect learn from them. Counted again when a
        note changes, at most every 20 seconds."""
        if not self.cfg.get("autocorrect_learn_notes", True):
            return {}
        row = self.db.query_one("SELECT COUNT(*) AS n, MAX(updated_at) AS u FROM notes")
        stamp = (row["n"], row["u"]) if row else None
        have = self.__dict__.get("_ac_nw")
        if have is None or (stamp != self.__dict__.get("_ac_nw_stamp") and time.time() - self.__dict__.get("_ac_nw_t", 0) > 20):
            cnt = {}
            for r in self.db.query("SELECT content FROM notes"):
                for x in re.findall(r"[a-z]+(?:'[a-z]+)?", (r["content"] or "").lower()):
                    if len(x) >= 3:
                        cnt[x] = cnt.get(x, 0) + 1
            self._ac_nw, self._ac_nw_stamp, self._ac_nw_t = cnt, stamp, time.time()
        return self.__dict__.get("_ac_nw") or {}

    def _ac_boost(self):
        """A word you use in two or more notes' worth of places counts as used more often (as 200,000 uses in the list each)."""
        return {k: min(c, 250) * 200_000 for k, c in self._ac_notes().items() if c >= 2}

    @staticmethod
    def _ac_note_near(low, boost):
        """Your notes' words within two edits of the word: candidates even when the list hasn't them (a name, a term)."""
        return [k for k in boost if abs(len(k) - len(low)) <= 2 and dictmod.distance(k, low, 2) <= 2]

    @staticmethod
    def _ac_decide(w, model, first, limit):
        """The correction autocorrect makes, or None: the best guess is a small enough slip and clearly ahead of the next one
        (about six times as likely and Windows' own first choice, or thirty times as likely on its own)."""
        if not model:
            return None
        score, cost, top = model[0]
        if top[:1].isupper() and not w[:1].isupper() and limit <= 1:   # "Only obvious slips": never a name for a word typed in lower case
            return None
        margin = score - (model[1][0] if len(model) > 1 else -99)
        agree = bool(first) and top.lower() == first.lower()
        if cost > limit or (len(w) < 4 and cost > .6):
            return None
        if margin >= 1.5 or (margin >= autocorrect.MARGIN and (agree or not syspell.available())):
            return syspell.case_like(w, top)
        return None

    @safe_action
    def autocorrect_learn(self, word, to, how="undone"):
        """Build N (QC 76): you undid autocorrect's change of `word` to `to` (Backspace or Ctrl+Z straight after), so it isn't
        made again for that word. Kept in config.json (autocorrect_learned), on this PC only."""
        w = str(word or "").strip().lower()[:60]
        if how != "undone" or not w:
            return {"status": "error", "message": "Nothing to learn."}
        learned = dict(self.cfg.get("autocorrect_learned") or {})
        undone = dict(learned.get("undone") or {})
        undone[w] = str(to or "")[:60]
        if len(undone) > 2000:
            undone = dict(list(undone.items())[-2000:])
        learned["undone"] = undone
        self.save_settings({"autocorrect_learned": learned})
        return {"status": "success", **self.autocorrect_learned()}

    def autocorrect_learned(self):
        """What autocorrect has learned on this PC: {undone: corrections you undid, words: words of yours from your notes,
        learn_notes, list: the frequency list is there}."""
        nw = self._ac_notes()
        return {"status": "success", "undone": len((self.cfg.get("autocorrect_learned") or {}).get("undone") or {}),
                "words": sum(1 for c in nw.values() if c >= 3), "learn_notes": bool(self.cfg.get("autocorrect_learn_notes", True)),
                "list": self._speller() is not None}

    @safe_action
    def autocorrect_forget(self):
        """Settings → Clear what it learned: forgets the corrections you undid and the words it picked up from your notes (they
        come back from your notes as you write, unless Learn from my notes is off)."""
        self.save_settings({"autocorrect_learned": {}})
        self._ac_nw = None
        self._ac_nw_t = time.time()
        self._ac_nw_stamp = None
        return {"status": "success", **self.autocorrect_learned()}
    # ==== end Build N · QC 76 ====

    @safe_action
    def autocorrect_word(self, word, note_id=None):
        """{status, word, to (or null), why}: the spelling a just-finished word becomes, only when that's clear (Settings →
        Editor → Autocorrect). Windows' own autocorrect pairs (teh → the) always count. Otherwise the best suggestion must
        be one slip away ("obvious") or two ("more"), with no rival as close, not a split word or a name for a word typed in
        lower case. Never a word of yours, a word in autocorrect_never, a note's ignored word, all capitals or with a capital
        or digit inside (the page never sends code, links or the start of a URL)."""
        w = str(word or "").strip()[:60]
        out = {"status": "success", "word": w, "to": None, "why": ""}
        if not self.cfg.get("autocorrect", True):
            return {**out, "why": "off"}
        low = w.lower().replace("’", "'")
        if (len(w) < 3 or re.search(r"[\d_]", w) or (w.isupper() and len(w) > 1) or any(c.isupper() for c in w[1:])
                or low in (self.cfg.get("autocorrect_never") or [])):
            return {**out, "why": "skipped"}
        r = self.dict_spell(w, note_id)
        if r.get("status") != "success" or r.get("known"):
            return {**out, "why": "known"}
        if syspell.available():
            rep = [x[3] for x in syspell.errors(w) if x[2] == 2 and x[3]]
            if rep:
                return {**out, "to": syspell.case_like(w, rep[0]), "why": "windows"}
            # Build N (QC 76): a doubled letter typed once too many, where that one change gives a real word or Windows' own
            # pair (usefull → useful, aalot → alot → a lot)
            hits = []
            for c in self._spell_collapses(low):
                pr = self._spell_pair(c)
                if pr or self._spell_real(c):
                    hits.append(pr or c)
            if len(set(hits)) == 1:
                return {**out, "to": syspell.case_like(w, hits[0]), "why": "doubled"}
        sp = self._speller()
        if sp:   # Build N (QC 76): learned on this PC first, then SymSpell's ranking with Gboard-style keyboard slips
            if low in ((self.cfg.get("autocorrect_learned") or {}).get("undone") or {}):
                return {**out, "why": "undone"}
            if self._ac_notes().get(low, 0) >= 3:
                return {**out, "why": "yours"}
            last = self.__dict__.get("_ac_last")
            model = last[1] if last and last[0] == low else []
            model = [x for x in model if " " not in x[2] and ("'" not in x[2] or "'" in w)]
            limit = 1.0 if self.cfg.get("autocorrect_strength", "obvious") == "obvious" else 2.0
            if model and model[0][1] <= 1.0 or not model:
                verdict = self._ac_decide(w, model, r.get("first"), limit)
                if verdict or model:
                    return {**out, "to": verdict, "why": "likely" if verdict else "not sure"}
            best = model[0][1] if model else None
            two = syspell.split_winner(w, self._spell_is_word, None if best is None else (1 if best <= 1 else 2), quick=self._spell_quick())
            if two:
                return {**out, "to": syspell.case_like(w, two), "why": "split"}
            verdict = self._ac_decide(w, model, r.get("first"), limit)
            return {**out, "to": verdict, "why": "likely" if verdict else "not sure"}
        sugg = [s for s in r.get("suggestions") or [] if " " not in s["word"] and ("'" not in s["word"] or "'" in w) and not s.get("span")]
        # Build N (QC 52): two words typed as one, only when one split clearly wins and no one-word spelling is as close
        best = min((s["d"] for s in sugg), default=None)
        two = syspell.split_winner(w, self._spell_is_word, best, quick=self._spell_quick()) if best is None or best > 1 else None   # a one-word slip always wins
        if two:
            return {**out, "to": syspell.case_like(w, two), "why": "split"}
        if not sugg:
            return {**out, "why": "no suggestion"}
        limit = 1 if self.cfg.get("autocorrect_strength", "obvious") == "obvious" else 2
        top = sugg[0]
        rivals = [s for s in sugg[1:] if s["d"] <= top["d"]]
        if rivals and top["d"] == 1:   # Build N (QC 76): ties one slip away
            tb = self._spell_tiebreak(w, r.get("first"), [s for s in sugg if s["d"] == 1])
            if tb:
                top, rivals = next(s for s in sugg if s["word"] == tb), []
        name = top["word"][:1].isupper() and not w[:1].isupper() and limit == 1
        if top["d"] > limit or rivals or name or (limit == 1 and len(w) < 4 and top["d"] > 0):
            return {**out, "why": "not sure"}
        return {**out, "to": top["word"], "why": "close"}

    def _spell_quick(self):
        """Build N (QC 52): a fast test for the one-slip halves a split tries: WordNet's headwords and the small words, in
        memory (None without the dictionary: then every half goes to _spell_is_word)."""
        d = self._dict()
        if not d._wn():
            return None
        mem = d._memory()
        if self.__dict__.get("_split_mem") is not mem:
            self._split_keys = d.memory_keys() | set(dictmod.COMMON_WORDS)   # QC 62: made in the same pass as the headwords
            self._split_mem = mem
        keys = self._split_keys
        return keys.__contains__

    def spell_warm(self, wait=False):
        """Build N (QC 62): load the dictionary's headwords (about 90 ms on a quiet PC, longer on a busy one) and the split
        search's set once, in the background, so the first right-clicked misspelling doesn't wait for them. Only when spell
        check or autocorrect is on and the dictionary is downloaded (that's when the first misspelling would load them anyway).
        main.py calls it once the page has loaded."""
        if not (self.cfg.get("editor_spell_check", True) or self.cfg.get("autocorrect", True)):
            return False
        def go():
            try:
                self._spell_quick()
                sp = self._speller()   # Build N (QC 76): the frequency list (about 100 ms)
                if sp:
                    sp.load()
            except Exception:
                log.exception("spell_warm")
        if wait:
            go()
        else:
            threading.Thread(target=go, daemon=True, name="nv-spell-warm").start()
        return True

    def _spell_is_word(self, w):
        """Build N (QC 52): how common a half of a run-together word is, 0 when it isn't a word: WordNet's sense count for
        an exact lower-case entry or one of its forms (no names, no loose stems), the small words, your words; with no
        dictionary downloaded, Windows' checker (1). Remembered for a while (a split tries a few hundred halves)."""
        cache = self.__dict__.setdefault("_split_words", {})
        if w in cache:
            return cache[w]
        d, k = self._dict(), dictmod.norm(w)
        con = d._wn()
        ok = 0
        if k in dictmod.COMMON_WORDS:
            ok = 30
        elif d.my_word(k):
            ok = 10
        elif con:
            mem = d._memory()   # the in-memory list first: most halves tried aren't words, and that answers at once
            keys = self.__dict__.get("_split_keys")
            if keys is None or self.__dict__.get("_split_mem") is not mem:
                keys = self._split_keys = {key for rows in mem.values() for key, _, _ in rows}
                self._split_mem = mem
            if k not in keys and not (len(k) > 3 and k[-1] in "sd"):   # not a headword (inflections need the forms table)
                cache[w] = 0
                return 0
            r = con.execute("SELECT word, nsenses FROM words WHERE key = ?", (k,)).fetchone()
            if r and r["word"] == r["word"].lower():
                ok = r["nsenses"]
            else:
                f = con.execute("SELECT w.word, w.nsenses FROM forms f JOIN words w ON w.id = f.word_id WHERE f.key = ?", (k,)).fetchone()
                ok = f["nsenses"] if f and f["word"] == f["word"].lower() else 0
        elif syspell.available():
            ok = 1 if syspell.is_correct(w) else 0
        if len(cache) > 20000:
            cache.clear()
        cache[w] = ok
        return ok

    @safe_action
    def spell_words(self, words, note_id=None):
        """{status, wrong: [words], engine}: which of a note's words aren't known (Check spelling, F7). The same rules as
        dict_spell (your words, the small words, the note's ignored words, WordNet, then Windows' spell checker), without
        the suggestions; up to 3000 different words."""
        if not isinstance(words, list):
            return {"status": "error", "message": "words must be a list."}
        ign = set((self.cfg.get("spell_ignore") or {}).get(str(note_id)) or []) if note_id is not None else set()
        d, win = self._dict(), syspell.available()
        wrong = []
        for w in list(dict.fromkeys(str(x)[:60] for x in words if isinstance(x, str) and x.strip()))[:3000]:
            if w.strip().lower().replace("’", "'") in ign:
                continue
            base = d.spell(w, 0, wide=False)
            trusted = base["checked"] or bool(d.my_word(dictmod.norm(w)))
            if base["known"] and (trusted or not win):
                continue
            if win and syspell.is_correct(base["word"]):
                continue
            wrong.append(w)
        return {"status": "success", "wrong": wrong, "engine": "windows" if win else "wordnet"}
    # ==== end Fix A ====

    @safe_action
    def dict_lookup(self, word):
        """{status, entry}: one word in full (meanings by part of speech, similar, opposite, sound-alikes, yours), or null."""
        return {"status": "success", "entry": self._dict().lookup(str(word or "")[:80])}

    @safe_action
    def dict_words(self):
        """{status, words}: your words, A to Z, read from glossary.json when it changed."""
        return {"status": "success", "words": self._dict().my_words()}

    @safe_action
    def dict_word_save(self, data, old_key=None):
        """Adds a word of yours ({word, pos, definition, example, tags}), or edits the one at old_key (keeps its added date).
        Writes glossary.json. Errors say which box: {status: error, message, field}."""
        return self._dict_call(lambda: {"status": "success", "word": self._dict().save_word(data, old_key or None)})

    @safe_action
    def dict_word_delete(self, key):
        return self._dict_call(lambda: (self._dict().delete_word(str(key or "")), {"status": "success"})[1])

    @safe_list(default={})
    def get_year_heatmap(self, which="past"):
        """The year on Timer → Insights: which = "past" (the past 12 months) or a calendar year. See db.get_year_heatmap."""
        if which != "past":
            try:
                which = int(which)
            except (TypeError, ValueError):
                which = "past"
            if which != "past" and not 1970 <= which <= 2100:
                which = "past"
        return self.db.get_year_heatmap(which)
    # ==== end Build J ====

    # ==== Build K · PDF and DOCX files to Markdown notes (converters.py), attaching a file, the drop default (R47) ====
    # convert_file starts a background job and returns its id at once; the page polls convert_job(job) for "Page N of M"
    # and gets the note's id when it's done. The note is saved through save_note, as if typed, so the page opens it and
    # its editor does the rest (autosave, "- [ ]" lines as tasks). Images go to attachments/ as "![[attachments/…]]".
    # attach_file copies a file into attachments/ and embeds it in a note (Build A has no call that takes a file in).

    _CONVERT_MODES = ("new_note",)   # plus "into_note:<id>"

    def _convert_jobs(self):
        if not hasattr(self, "_convert_mgr"):
            self._convert_mgr = converters.Jobs()
        return self._convert_mgr

    def _convert_mode(self, mode):
        """(note id or None for a new note, error)."""
        mode = str(mode or "new_note")
        if mode in self._CONVERT_MODES:
            return None, None
        if mode.startswith("into_note:"):
            nid = _clean_id(mode.split(":", 1)[1])
            if nid is None or not self.db.query_one("SELECT id FROM notes WHERE id = ?", (nid,)):
                return None, "Note not found."
            return nid, None
        return None, "mode must be new_note or into_note:<id>."

    @staticmethod
    def _source_path(path):
        """The file the page asked for, as a full path, or (None, message)."""
        path = os.path.abspath(str(path)) if isinstance(path, str) and path.strip() else None
        if not path or not os.path.isfile(path):
            return None, "That file isn't there any more."
        return path, None

    def _append_md(self, note_id, md):
        """Adds Markdown to the end of a note, after a blank line, through save_note."""
        note = self.get_note(note_id)
        if not note:
            return {"status": "error", "message": "Note not found."}
        body = (note["content"] or "").rstrip("\n")
        content = (body + "\n\n" if body else "") + md.strip("\n") + "\n"
        return self.save_note(note_id, note["title"], content, note["category"], note["project_id"],
                              ", ".join(note.get("tags") or []))

    @safe_action
    def convert_file(self, path, mode="new_note", folder_id=None, sheets=None):
        """Converts a PDF or DOCX into Markdown: mode new_note (a new note named after the file, in folder_id or
        Unsorted) or into_note:<id> (added to the end of that note). {status, job}; poll convert_job(job).
        The job's result: {note_id, title, created, warnings, images, tables, pages, scan}. images and tables are the
        files added to attachments/ ([{file, name, size}], tables also rows and cols): each picture is embedded where it
        was, and each table stays a Markdown table and is saved as "<note> table N.csv", linked by a hidden line under
        it, so all of them show in the note's Attachments tab. A scanned PDF (no text) makes no note: note_id is None,
        scan is True and warnings says why."""
        path, err = self._source_path(path)
        if err:
            return {"status": "error", "message": err}
        if not converters.kind_of(path):
            return {"status": "error", "message": "Only PDF, Word (.docx) and Excel (.xlsx) files can be converted to Markdown."}
        if sheets is not None and (not isinstance(sheets, list) or not all(isinstance(x, str) for x in sheets)):   # Build M · R57: a workbook's sheets
            return {"status": "error", "message": "sheets must be a list of sheet names."}
        into, err = self._convert_mode(mode)
        if err:
            return {"status": "error", "message": err}
        folder = _clean_id(folder_id)
        if folder is not None and not self._folder(folder):
            return {"status": "error", "message": "Folder not found."}
        base = self._att_base()
        into_title = (self.get_note(into) or {}).get("title") if into else None   # names the tables' CSVs

        def run(progress, cancel):
            res = converters.convert(path, base, progress, cancel, into_title, sheets=sheets)
            warnings, files = list(res["warnings"]), res["images"] + res["tables"]
            out = {"note_id": None, "title": res["title"], "created": False, "warnings": warnings,
                   "images": res["images"], "tables": res["tables"], "pages": res.get("pages"), "scan": bool(res.get("scan"))}
            if not res["markdown"].strip():
                converters.Images.undo_files(base, files)
                return out
            if cancel():
                converters.Images.undo_files(base, files)
                raise converters.Cancelled()
            # Build M · R47 r47-keeppdf ("keep the PDF attached too"): the file itself goes to attachments/ as well, embedded
            # at the top of what was converted, so it shows in the note and in its Attachments tab
            kept = self._keep_source(path, base)
            md = f"![[{kept['file']}]]\n\n{res['markdown']}" if kept else res["markdown"]
            if kept:
                files = files + [kept]
            saved = (self._append_md(into, md) if into else
                     self.save_note(None, res["title"] or os.path.splitext(os.path.basename(path))[0], md,
                                    "#General", None, "", folder))
            if saved.get("status") != "success":
                converters.Images.undo_files(base, files)
                raise converters.ConvertError(saved.get("message") or "The note couldn't be saved.")
            out.update(note_id=saved["id"], created=not into, updated_at=saved.get("updated_at"), source=kept)
            ai_lock.instance().mark_outside(saved["id"], "imported")   # R69: someone else's file: a cloud model asks first
            return out
        return {"status": "success", "job": self._convert_jobs().start(run)}

    @safe_action
    def convert_job(self, job_id):
        """{status, state: running | done | error | cancelled, done, total, label ("Page 3 of 12"), result, message}."""
        j = self._convert_jobs().get(job_id)
        return {"status": "success", **j} if j else {"status": "error", "message": "Unknown job."}

    @safe_action
    def convert_cancel(self, job_id):
        """Stops a conversion at the next page; nothing is saved and its images are removed."""
        if not self._convert_jobs().cancel(job_id):
            return {"status": "error", "message": "Unknown job."}
        return {"status": "success"}

    @safe_list(default={})
    def convert_status(self):
        """What the page needs before offering Convert: {pdf: pdfplumber installed?, docx: True, drop_office_default}."""
        return {"pdf": converters.pdf_available(), "docx": True,
                "drop_office_default": self.cfg.get("drop_office_default", "ask")}

    @safe_action
    def attach_file(self, path, note_id=None):
        """Copies a file into attachments/ and puts "![[attachments/<name>]]" at the end of the note; with no note_id
        a new note named after the file holds it. {status, file, note_id, created}"""
        path, err = self._source_path(path)
        if err:
            return {"status": "error", "message": err}
        nid = _clean_id(note_id)
        if note_id not in (None, "", "new") and (nid is None or not self.db.query_one("SELECT id FROM notes WHERE id = ?", (nid,))):
            return {"status": "error", "message": "Note not found."}
        if os.path.getsize(path) > converters.MAX_BYTES:
            return {"status": "error", "message": f"{os.path.basename(path)} is too big to attach."}
        base = self._att_base()
        attachments.folder(base, create=True)
        stem, ext = os.path.splitext(os.path.basename(path))
        stem = converters.safe_name(stem)
        name = attachments.unique_name(base, stem, re.sub(r"[^\w.]", "", ext.lower()))
        dest = os.path.join(attachments.folder(base), name)
        shutil.copyfile(path, dest)
        file = f"{attachments.DIR}/{name}"
        embed = f"![[{file}]]"
        saved = (self._append_md(nid, embed) if nid else
                 self.save_note(None, stem.strip() or "Untitled Note", embed + "\n", "#General"))
        if saved.get("status") != "success":
            os.remove(dest)
            return saved
        return {"status": "success", "file": file, "note_id": saved["id"], "created": not nid,
                "updated_at": saved.get("updated_at")}

    def _keep_source(self, path, base):
        """Build M · r47-keeppdf: a copy of the converted file in attachments/ ({file, name, size}), or None if it can't be kept
        (the conversion still goes ahead)."""
        try:
            attachments.folder(base, create=True)
            stem, ext = os.path.splitext(os.path.basename(path))
            name = attachments.unique_name(base, converters.safe_name(stem) or "document", re.sub(r"[^\w.]", "", ext.lower()))
            dest = os.path.join(attachments.folder(base), name)
            shutil.copyfile(path, dest)
            return {"file": f"{attachments.DIR}/{name}", "name": name, "size": os.path.getsize(dest)}
        except OSError:
            log.exception("keeping the converted file failed")
            return None

    def browse_convert_file(self):
        """Ctrl+K → Convert PDF to Markdown: the Open dialog for a PDF or Word file. The path, or None."""
        if not self._window:
            return None
        try:
            result = self._window.create_file_dialog(
                webview.OPEN_DIALOG, file_types=("PDF and Word files (*.pdf;*.docx)", "PDF files (*.pdf)",
                                                 "Word documents (*.docx)"))
        except Exception:
            log.exception("browse_convert_file failed")
            return None
        return result[0] if result else None
    # ==== end Build K ====

    # ==== Build O · files dropped on the window (mockup R47 / R47b): their paths, a copy in attachments/, a stand-in upload ====
    # pywebview gives a dropped file's full path only to a Python-side DOM drop handler (main.py wire_window registers one on
    # the document), as dataTransfer.files[i].pywebviewFullPath. That handler calls files_dropped; the page's own drop handler
    # then asks drop_paths for the names it saw. With no path (the dev bridge, or a name pywebview couldn't match), the page
    # sends the bytes to drop_upload, which keeps them in a temp folder, so convert_file / attach_file always get a path.
    _DROP_KEEP_S = 120   # a path the page never asked for is forgotten after two minutes

    def _drops(self):
        if not hasattr(self, "_drop_list"):
            self._drop_list, self._drop_lock = [], threading.Lock()
        return self._drop_list

    @safe_action
    def files_dropped(self, files):
        """main.py's drop handler: [{name, pywebviewFullPath}] (pywebview's event files). The dev bridge's check calls it
        too, with real paths, to stand in for the window. {status, count}"""
        now, got = time.time(), 0
        drops = self._drops()
        with self._drop_lock:
            drops[:] = [d for d in drops if now - d[0] < self._DROP_KEEP_S]
            for f in files if isinstance(files, list) else []:
                path = f.get("pywebviewFullPath") if isinstance(f, dict) else None
                name = f.get("name") if isinstance(f, dict) else None
                if isinstance(path, str) and os.path.isfile(path):
                    drops.append((now, str(name or os.path.basename(path)), os.path.abspath(path)))
                    got += 1
        return {"status": "success", "count": got}

    @safe_list(default={})
    def drop_paths(self, names):
        """{name: full path} for the dropped files the window saw with these names (each path is handed out once)."""
        out, drops = {}, self._drops()
        with self._drop_lock:
            for name in names if isinstance(names, list) else []:
                hit = next((d for d in reversed(drops) if d[1] == name), None)
                if hit:
                    drops.remove(hit)
                    out[name] = hit[2]
        return out

    @safe_action
    def drop_import(self, path):
        """Copies a dropped file into attachments/ (the page puts "![[…]]" where it was dropped and saves the note as typed).
        {status, file, name, kind, size, mtime}"""
        path, err = self._source_path(path)
        if err:
            return {"status": "error", "message": err}
        if os.path.getsize(path) > converters.MAX_BYTES:
            return {"status": "error", "message": f"{os.path.basename(path)} is too big to attach."}
        base = self._att_base()
        attachments.folder(base, create=True)
        stem, ext = os.path.splitext(os.path.basename(path))
        name = attachments.unique_name(base, converters.safe_name(stem) if stem.strip() else "Dropped file", re.sub(r"[^\w.]", "", ext.lower()))
        dest = os.path.join(attachments.folder(base), name)
        shutil.copyfile(path, dest + ".part")   # list_files leaves .part files out until the bytes are all there
        os.replace(dest + ".part", dest)
        return {"status": "success", **attachments.info(base, name)}

    # ==== Build N (QC 56): the editor toolbar's Image button: the Open dialog for an image, copied into attachments/ like a drop
    IMAGE_TYPES = (".png", ".jpg", ".jpeg", ".gif", ".webp")

    @safe_action
    def image_import(self, path):
        """A picked image (PNG, JPEG, GIF or WebP) copied into attachments/; the page puts "![[…]]" at the caret.
        {status, file, name, kind, size, mtime}"""
        if os.path.splitext(str(path or ""))[1].lower() not in self.IMAGE_TYPES:
            return {"status": "error", "message": "Pick a PNG, JPEG, GIF or WebP image."}
        return self.drop_import(path)

    def image_pick(self):
        """The Open dialog for one image, then image_import. {status: cancelled} when nothing was picked."""
        if not self._window:
            return {"status": "error", "message": "Window not ready."}
        try:
            picked = self._window.create_file_dialog(webview.OPEN_DIALOG, file_types=("Images (*.png;*.jpg;*.jpeg;*.gif;*.webp)",))
        except Exception as e:
            log.exception("image_pick failed")
            return {"status": "error", "message": plain_error(e, "open the picker")}
        if not picked:
            return {"status": "cancelled"}
        return self.image_import(picked[0] if isinstance(picked, (list, tuple)) else picked)
    # ==== end Build N (QC 56) ====

    @safe_action
    def drop_upload(self, name, data):
        """A dropped file the page has only as bytes (a data: URL): kept in a temp folder under its own name.
        {status, path}; the page then calls drop_import, attach_file or convert_file with it."""
        m = re.match(r"data:[^;,]*(;[^,]*)?;base64,", data) if isinstance(data, str) else None
        if not m:
            return {"status": "error", "message": "The dropped file couldn't be read."}
        try:
            raw = base64.b64decode(data[m.end():], validate=True)
        except (ValueError, TypeError):
            return {"status": "error", "message": "The dropped file couldn't be read."}
        if len(raw) > attachments.MAX_DATA_BYTES:
            return {"status": "error", "message": "That file is too big to drop here."}
        stem, ext = os.path.splitext(os.path.basename(str(name or "")))
        folder = tempfile.mkdtemp(prefix="nv-drop-")
        dest = os.path.join(folder, (converters.safe_name(stem) if stem.strip() else "Dropped file") + re.sub(r"[^\w.]", "", ext.lower()))
        with open(dest, "wb") as f:
            f.write(raw)
        return {"status": "success", "path": dest}

    # ---- Build O (QC 48): open .md / .markdown / .txt files as new notes (the Open file icon, Ctrl+O, a dropped .md) ----
    MD_TYPES = (".md", ".markdown", ".txt")
    _MD_MAX = 20 * 1024 * 1024
    _MD_EMBED = re.compile(r"!\[\[([^\]|#^\n]+)((?:[#^|][^\]\n]*)?)\]\]")          # ![[file.png]], ![[file.png|300]]
    _MD_IMAGE = re.compile(r"!\[([^\]\n]*)\]\(<?([^)>\s]+)>?(?:\s+\"[^\"]*\")?\)")  # ![alt](file.png "title")

    def browse_md_files(self):
        """The Open dialog for Markdown and text files, several at once: [paths] (none when cancelled)."""
        if not self._window:
            return []
        try:
            result = self._window.create_file_dialog(
                webview.OPEN_DIALOG, allow_multiple=True,
                file_types=("Markdown and text files (*.md;*.markdown;*.txt)", "Markdown files (*.md;*.markdown)", "Text files (*.txt)"))
        except Exception:
            log.exception("browse_md_files failed")
            return []
        return list(result or [])

    @staticmethod
    def _md_text(path):
        """(text with \\n line ends and no BOM, error)."""
        name = os.path.basename(path)
        if os.path.getsize(path) > NeuroVaultApi._MD_MAX:
            return None, f"{name} is too big to open as a note."
        with open(path, "rb") as f:
            raw = f.read()
        if raw.startswith(b"\xef\xbb\xbf"):
            raw = raw[3:]
        try:
            text = raw.decode("utf-8")
        except UnicodeDecodeError:
            return None, f"{name} isn't UTF-8 text, so it can't be opened as a note. Save it as UTF-8 (Notepad: Save as → Encoding: UTF-8) and try again."
        if "\x00" in text:
            return None, f"{name} isn't a text file."
        return text.replace("\r\n", "\n").replace("\r", "\n"), None

    @staticmethod
    def _md_title(text, path):
        """(title, body, tags): NeuroVault's own export front matter gives its title and tags and is taken off (its id is
        this vault's, not the new note's); else the first # heading outside code; else the file name. Other front matter stays."""
        body, tags = text, ""
        m = re.match(r"---[ \t]*\n([\s\S]*?)\n---[ \t]*(?:\n|$)", text)
        if m and re.search(r"^sqlite_sync:\s*neurovault\.db\s*$", m.group(1), re.M):
            fm, body = m.group(1), text[m.end():].lstrip("\n")
            t = re.search(r'^title:\s*"((?:[^"\\]|\\.)*)"\s*$', fm, re.M) or re.search(r"^title:\s*(.+?)\s*$", fm, re.M)
            tg = re.search(r"^tags:\s*\[(.*)\]\s*$", fm, re.M)
            tags = tg.group(1) if tg else ""
            if t and t.group(1).strip():
                return re.sub(r"\\(.)", r"\1", t.group(1)).strip(), body, tags
        fence = None
        start = m.end() if m else 0
        for line in text[start:].split("\n"):
            f = re.match(r"\s*(`{3,}|~{3,})", line)
            if f:
                fence = None if fence and f.group(1)[0] == fence[0] else (fence or f.group(1))
                continue
            h = None if fence else re.match(r"#[ \t]+(.+?)[ \t]*#*[ \t]*$", line)
            if h:
                title = re.sub(r"[*_`~]|\[\[|\]\]", "", h.group(1)).strip()
                if title:
                    return title[:200], body, tags
        stem = os.path.splitext(os.path.basename(path))[0].strip()
        return stem or "Untitled Note", body, tags

    def _md_images(self, body, src_dir):
        """Embeds whose files sit beside the .md (or below it) are copied into attachments/ and point there. (body, files)"""
        base, done, files = self._att_base(), {}, []

        def take(ref):
            ref = ref.strip()
            if not ref or re.match(r"^[a-z][\w+.-]*:", ref, re.I) or ref.startswith(("/", "\\", "attachments/")):
                return None   # a link, an absolute path, or already in this vault's attachments/
            from urllib.parse import unquote
            src = os.path.normpath(os.path.join(src_dir, unquote(ref)))
            if not src.startswith(os.path.normpath(src_dir) + os.sep) or not os.path.isfile(src) \
                    or os.path.getsize(src) > converters.MAX_BYTES:
                return None   # never outside the file's own folder
            if src not in done:
                attachments.folder(base, create=True)
                stem, ext = os.path.splitext(os.path.basename(src))
                name = attachments.unique_name(base, converters.safe_name(stem) if stem.strip() else "image", re.sub(r"[^\w.]", "", ext.lower()))
                shutil.copyfile(src, os.path.join(attachments.folder(base), name))
                done[src] = f"{attachments.DIR}/{name}"
                self._att_from(done[src], src, "open")   # Build M · QC 68: where it came from
                files.append(done[src])
            return done[src]

        def embed(m):
            new = take(m.group(1))
            return f"![[{new}{m.group(2)}]]" if new else m.group(0)

        def image(m):
            new = take(m.group(2))
            return f"![[{new}]]" if new else m.group(0)
        out, fence = [], None
        for line in body.split("\n"):   # not inside code blocks
            f = re.match(r"\s*(`{3,}|~{3,})", line)
            if f:
                fence = None if fence and f.group(1)[0] == fence[0] else (fence or f.group(1))
            elif not fence:
                line = self._MD_IMAGE.sub(image, self._MD_EMBED.sub(embed, line))
            out.append(line)
        return "\n".join(out), files

    def _md_free_title(self, title, folder_id, project_id):
        """A title no other note in that place has ("Notes", "Notes 1", "Notes 2"…), as the page's uniqueName."""
        if folder_id is not None:
            rows = self.db.query("SELECT title FROM notes WHERE folder_id = ?", (folder_id,))
        else:
            rows = self.db.query("SELECT title FROM notes WHERE folder_id IS NULL AND project_id IS ?", (project_id,))
        taken = {(r["title"] or "").lower() for r in rows}
        name, k = title, 1
        while name.lower() in taken:
            name, k = f"{title} {k}", k + 1
        return name

    @safe_action
    def import_md_files(self, paths, folder_id=None, project_id=None):
        """Opens .md / .markdown / .txt files as new notes, copied in: the files are only read, never moved or changed.
        In folder_id, else at project_id's root, else in Unsorted. {status, notes: [{id, title, file, images}], errors: [{file, message}]}"""
        notes, errors = [], []
        for path in paths if isinstance(paths, list) else [paths]:
            name = os.path.basename(str(path or ""))
            try:
                path, err = self._source_path(path)
                if not err and os.path.splitext(path)[1].lower() not in self.MD_TYPES:
                    err = f"{name} isn't a Markdown or text file (.md, .markdown or .txt)."
                text, err = (None, err) if err else self._md_text(path)
                if err:
                    errors.append({"file": name, "message": err})
                    continue
                title, body, tags = self._md_title(text, path)
                fid, pid, err = self._place(_clean_id(folder_id), _clean_id(project_id))
                if err:
                    return {"status": "error", "message": err}
                body, images = self._md_images(body, os.path.dirname(path))
                pj = self.db.query_one("SELECT name FROM projects WHERE id = ?", (pid,)) if pid else None
                title = self._md_free_title(title, fid, pid)
                saved = self.save_note(None, title, body, pj["name"] if pj else "#General", pid, tags, fid)
                if saved.get("status") != "success":
                    attachments_dir = attachments.folder(self._att_base())
                    for f in images:
                        os.remove(os.path.join(attachments_dir, os.path.basename(f)))
                    errors.append({"file": name, "message": saved.get("message") or "The note couldn't be saved."})
                    continue
                ai_lock.instance().mark_outside(saved["id"], "imported")   # R69: someone else's file: a cloud model asks first
                notes.append({"id": saved["id"], "title": title, "file": name, "images": images})
            except OSError as e:
                errors.append({"file": name, "message": f"{name} couldn't be read ({e.strerror or e})."})
        if not notes and errors:
            return {"status": "error", "message": errors[0]["message"], "notes": [], "errors": errors}
        return {"status": "success", "notes": notes, "errors": errors}
    # ==== end Build O ====

    # ==== Build M · note history (mockup R42, locked 2026-10-17): every save keeps a version; list, compare, restore ====
    # The table and its keeping rules are in db.py (NOTE_VERSIONS_SCHEMA). save_note is wrapped at the bottom of this file,
    # so it keeps a version after each save that changed the text; restore_version keeps the text it replaces.

    def _versions_kept(self):
        n = self.cfg.get("note_versions_kept", 5)
        return n if n in cfgmod.NOTE_VERSIONS_KEPT else 5

    @classmethod
    def _word_count(cls, text):
        """Words as you read them: Markdown marks (#, -, **) don't count."""
        return sum(len(line.split()) for line in cls._plain_lines(text))

    def _prune_versions(self, note_id=None):
        """Keep each note's newest note_versions_kept rows (one note, or every note)."""
        keep = self._versions_kept()
        ids = [note_id] if note_id is not None else [r["note_id"] for r in self.db.query("SELECT DISTINCT note_id FROM note_versions")]
        gone = 0
        for nid in ids:
            cur = self.db.execute(
                """DELETE FROM note_versions WHERE note_id = ? AND id NOT IN
                   (SELECT id FROM note_versions WHERE note_id = ? ORDER BY id DESC LIMIT ?)""", (nid, nid, keep))
            gone += cur.rowcount or 0
        return gone

    def _add_version(self, note_id, title, content, reason, at, started=None, restored_from=None):
        cur = self.db.execute(
            """INSERT INTO note_versions (note_id, title, content, words, reason, restored_from, started_at, saved_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
            (note_id, title or "", content or "", self._word_count(content), reason, restored_from, started or at, at))
        return cur.lastrowid

    def _keep_version(self, note_id, old, title, content, now):
        """After a save: keep the new text as a version. old is the note's row before the save (None for a new note).
        A note saved before Build M has no versions yet, so its text from before this save is kept first."""
        content = content or ""
        if old is not None and (old["content"] or "") == content:
            return  # a rename or a tag change: the text didn't change
        last = self.db.query_one("SELECT * FROM note_versions WHERE note_id = ? ORDER BY id DESC LIMIT 1", (note_id,))
        if old is not None and (last is None or last["content"] != (old["content"] or "")):
            self._add_version(note_id, old["title"], old["content"], "save", old["updated_at"] or now)
            last = None  # the text from before is history: this save starts a new version
        window = datetime.fromisoformat(now) - timedelta(minutes=NOTE_VERSION_WINDOW_MIN)
        started = self._utc(last["started_at"]) if last is not None else None
        if last is not None and last["reason"] == "save" and started is not None and started > window:
            self.db.execute("UPDATE note_versions SET title = ?, content = ?, words = ?, saved_at = ? WHERE id = ?",
                            (title, content, self._word_count(content), now, last["id"]))
        else:
            self._add_version(note_id, title, content, "save", now)
        self._prune_versions(note_id)

    @staticmethod
    def _utc(text):
        """A stored UTC ISO time as an aware datetime, or None if it can't be read."""
        try:
            d = datetime.fromisoformat(str(text).replace("Z", "+00:00"))
        except (TypeError, ValueError):
            return None
        return d if d.tzinfo else d.replace(tzinfo=timezone.utc)

    def _version_view(self, row, older=None):
        return {"id": row["id"], "note_id": row["note_id"], "saved_at": row["saved_at"], "words": row["words"],
                "delta_words": row["words"] - older["words"] if older is not None else None,
                "reason": row["reason"], "restored_from": row["restored_from"]}

    @safe_list()
    def list_versions(self, note_id):
        """A note's kept versions, newest first: [{id, saved_at, words, delta_words, reason, restored_from}].
        The newest is the note's text now. delta_words is against the next older version (None for the oldest)."""
        note_id = _clean_id(note_id)
        rows = self.db.query("SELECT * FROM note_versions WHERE note_id = ? ORDER BY id DESC", (note_id,)) if note_id else []
        return [self._version_view(r, rows[i + 1] if i + 1 < len(rows) else None) for i, r in enumerate(rows)]

    @safe_list(default=None)
    def get_version(self, version_id):
        """One version with its text: {id, note_id, title, content, words, saved_at, reason}, or None."""
        version_id = _clean_id(version_id)
        row = version_id and self.db.query_one("SELECT * FROM note_versions WHERE id = ?", (version_id,))
        if not row:
            return None
        v = self._version_view(row)
        v.update(title=row["title"], content=row["content"])
        return v

    @safe_list()
    def list_recent_versions(self, limit=60):
        """The newest versions across the vault, for the Timeline's activity: [{id, note_id, title, saved_at, reason,
        restored_from, words, delta_words}], newest first."""
        try:
            limit = max(1, min(int(limit), 500))
        except (TypeError, ValueError):
            limit = 60
        rows = self.db.query(
            """SELECT v.*, n.title AS note_title,
                      (SELECT o.words FROM note_versions o WHERE o.note_id = v.note_id AND o.id < v.id ORDER BY o.id DESC LIMIT 1) AS prev_words
               FROM note_versions v JOIN notes n ON n.id = v.note_id WHERE n.vault IS ? ORDER BY v.id DESC LIMIT ?""", (self.db.vault, limit))
        return [{"id": r["id"], "note_id": r["note_id"], "title": r["note_title"], "saved_at": r["saved_at"], "reason": r["reason"],
                 "restored_from": r["restored_from"], "words": r["words"],
                 "delta_words": r["words"] - r["prev_words"] if r["prev_words"] is not None else None} for r in rows]

    @staticmethod
    def _plain_lines(md):
        """The text as you read it, one paragraph per line, without the Markdown marks (for showing changes only)."""
        out = []
        for line in (md or "").replace("\r\n", "\n").split("\n"):
            s = line.strip()
            if not s or re.fullmatch(r"(-{3,}|\*{3,}|_{3,}|```.*)", s):
                continue
            s = re.sub(r"^(#{1,6}\s+|>\s?|[-*+]\s+(\[[ xX]\]\s+)?|\d+[.)]\s+)", "", s)
            s = re.sub(r"!\[\[([^\]]*)\]\]", r"[\1]", s)
            s = re.sub(r"\*\*|__|`|\[\[|\]\]|~~", "", s).strip()
            if s:
                out.append(s)
        return out

    @staticmethod
    def _word_ops(a, b):
        """Word changes from line a to line b: [[op, text]], op eq | add | del."""
        import difflib
        wa, wb = a.split(), b.split()
        ops = []
        for tag, i1, i2, j1, j2 in difflib.SequenceMatcher(None, wa, wb, autojunk=False).get_opcodes():
            if tag == "equal":
                ops.append(["eq", " ".join(wa[i1:i2])])
            else:
                if i2 > i1:
                    ops.append(["del", " ".join(wa[i1:i2])])
                if j2 > j1:
                    ops.append(["add", " ".join(wb[j1:j2])])
        return ops

    @safe_action
    def compare_versions(self, note_id, version_id, other_id=None):
        """What changed from a version to another one (other_id) or to the note's text now (other_id None), in the text:
        {status, paras: [{kind: same | add | del | edit | gap, ops: [[eq|add|del, text]], n}], added, removed}.
        Only changed paragraphs are listed, with one unchanged paragraph either side; the rest folds into a gap of n."""
        import difflib
        note_id, version_id, other_id = _clean_id(note_id), _clean_id(version_id), _clean_id(other_id)
        a = version_id and self.db.query_one("SELECT * FROM note_versions WHERE id = ? AND note_id = ?", (version_id, note_id))
        if not a:
            return {"status": "error", "message": "That version isn't kept any more."}
        if other_id:
            b = self.db.query_one("SELECT content FROM note_versions WHERE id = ? AND note_id = ?", (other_id, note_id))
        else:
            b = self.db.query_one("SELECT content FROM notes WHERE id = ?", (note_id,))
        if not b:
            return {"status": "error", "message": "Note not found."}
        la, lb = self._plain_lines(a["content"]), self._plain_lines(b["content"])
        paras, added, removed = [], 0, 0

        def words(ops, op):
            return sum(len(t.split()) for o, t in ops if o == op)
        for tag, i1, i2, j1, j2 in difflib.SequenceMatcher(None, la, lb, autojunk=False).get_opcodes():
            if tag == "equal":
                block = [{"kind": "same", "ops": [["eq", t]]} for t in la[i1:i2]]
                paras.extend(block)
                continue
            old, new = la[i1:i2], lb[j1:j2]
            for k in range(max(len(old), len(new))):
                o, n = (old[k] if k < len(old) else None), (new[k] if k < len(new) else None)
                if o is not None and n is not None and difflib.SequenceMatcher(None, o.split(), n.split()).ratio() >= 0.4:
                    ops = self._word_ops(o, n)
                    paras.append({"kind": "edit", "ops": ops})
                    added += words(ops, "add")
                    removed += words(ops, "del")
                    continue
                if o is not None:
                    paras.append({"kind": "del", "ops": [["del", o]]})
                    removed += len(o.split())
                if n is not None:
                    paras.append({"kind": "add", "ops": [["add", n]]})
                    added += len(n.split())
        # fold the unchanged paragraphs that aren't next to a change
        near = {i for i, p in enumerate(paras) if p["kind"] != "same"}
        near |= {i + d for i in list(near) for d in (-1, 1)}
        out = []
        for i, p in enumerate(paras):
            if p["kind"] != "same" or i in near:
                out.append(p)
            elif out and out[-1]["kind"] == "gap":
                out[-1]["n"] += 1
            else:
                out.append({"kind": "gap", "n": 1, "ops": []})
        return {"status": "success", "paras": out[:400], "added": added, "removed": removed,
                "changed": bool(near), "from_saved_at": a["saved_at"]}

    @safe_action
    def restore_version(self, note_id, version_id):
        """Puts a kept version's text back as the note's text, at once (R45 answer: no confirm). The text it replaces is
        kept as a "before-restore" version, so nothing is lost, and the restore is a version of its own. The note keeps its
        title, folder and tags. Returns {status, message, content, updated_at, version_id}."""
        note_id, version_id = _clean_id(note_id), _clean_id(version_id)
        cur = note_id and self.db.query_one("SELECT title, content, updated_at FROM notes WHERE id = ?", (note_id,))
        if not cur:
            return {"status": "error", "message": "Note not found."}
        v = version_id and self.db.query_one("SELECT * FROM note_versions WHERE id = ? AND note_id = ?", (version_id, note_id))
        if not v:
            return {"status": "error", "message": "That version isn't kept any more."}
        now = utc_now_iso()
        last = self.db.query_one("SELECT * FROM note_versions WHERE note_id = ? ORDER BY id DESC LIMIT 1", (note_id,))
        if (cur["content"] or "") == v["content"]:
            return {"status": "error", "message": "This is already the note's text."}
        if last is not None and last["content"] == (cur["content"] or ""):
            self.db.execute("UPDATE note_versions SET reason = 'before-restore' WHERE id = ?", (last["id"],))
        else:
            self._add_version(note_id, cur["title"], cur["content"], "before-restore", cur["updated_at"] or now)
        self.db.execute("UPDATE notes SET content = ?, updated_at = ? WHERE id = ?", (v["content"], now, note_id))
        new_id = self._add_version(note_id, cur["title"], v["content"], "restore", now, restored_from=v["saved_at"])
        self._prune_versions(note_id)
        return {"status": "success", "message": "Restored · the version it replaced is kept",
                "content": v["content"], "updated_at": now, "version_id": new_id, "restored_from": v["saved_at"]}
    # ==== end Build M ====

    # ------------------------------------------------------------------
    # Lifecycle
    # ------------------------------------------------------------------

    def shutdown(self):
        self._pop.quitting = True  # Build H: popped-out windows closing now stay "out", so they open again next time
        for key in list(self._pop.windows):
            self._pop._destroy(key, "quit")
        if self._pop.tray:
            self._pop.tray.stop()
        read_aloud.stop()  # Fix B: the read-aloud workers stop with the app
        if hasattr(self, "_ai_mgr"):  # Build B: the engine stops with the app; downloads pause (their .part files stay)
            self._ai_mgr.shutdown()
        if hasattr(self, "_fonts_mgr"):  # Build E: a font still downloading is cancelled (its part file goes)
            self._fonts_mgr.shutdown()
        if hasattr(self, "_dict_mgr"):  # Build J: a dictionary still downloading is cancelled (nothing half-finished is kept)
            self._dict_mgr.shutdown()
        if hasattr(self, "_convert_mgr"):  # Build K: conversions still running stop (their images are removed)
            for jid in list(self._convert_mgr.jobs):
                self._convert_mgr.cancel(jid)
        log.info("Closing database connection...")
        self.db.close()


# ==== Build H · after each change, every window hears of it (popout.PopOuts.sync) ===========================
def _then_sync(name, after):
    import functools
    fn = getattr(NeuroVaultApi, name)

    @functools.wraps(fn)
    def wrapper(self, *args, **kwargs):
        result = fn(self, *args, **kwargs)
        try:
            after(self, result, *args, **kwargs)
        except Exception:
            log.exception("sync after %s failed", name)
        return result
    setattr(NeuroVaultApi, name, wrapper)


def _ok(result):
    return isinstance(result, dict) and result.get("status") == "success"


def _sync_timer(self, result, *args, **kwargs):
    if _ok(result):
        self._pop.sync_timer()


def _sync_update(self, result, action=None, *args, **kwargs):
    if _ok(result) and action != "heartbeat":   # a heartbeat changes nothing anyone sees
        self._pop.sync_timer()


def _sync_logged(self, result, *args, **kwargs):
    if _ok(result):
        self._pop.sync_timer(logged=result.get("session"))


def _sync_sticky(self, result, *args, **kwargs):
    if _ok(result) and result.get("sticky"):
        self._pop.sync({"kind": "sticky", "sticky": result["sticky"]})


def _sync_sticky_gone(self, result, sticky_id=None, *args, **kwargs):
    # Fix C (QC 18): forget_sticky tells NeuroVault's window first, then closes the sticky's own window. A sticky that's
    # already gone (a second ×) still closes a window left behind, so it can't get stuck open
    if _ok(result):
        self._pop.forget_sticky(result.get("id"))
    elif isinstance(result, dict) and result.get("gone"):
        try:
            self._pop.forget_sticky(int(sticky_id))
        except (TypeError, ValueError):
            pass


def _sync_settings(self, result, patch=None, *args, **kwargs):
    if isinstance(patch, dict) and patch:   # the theme, the minute sets…: the popped-out windows follow
        self._pop.sync({"kind": "settings", "keys": sorted(patch)}, to="pops")


for _name, _after in (("start_running_session", _sync_timer), ("update_running_session", _sync_update),
                      ("finish_running_session", _sync_logged), ("discard_running_session", _sync_timer),
                      ("create_sticky", _sync_sticky), ("update_sticky", _sync_sticky),
                      ("delete_sticky", _sync_sticky_gone), ("save_settings", _sync_settings)):
    _then_sync(_name, _after)
# ==== end Build H ===========================================================


# ==== Build M · every save keeps a version; a new "Versions kept" prunes at once =============================
def _keep_versions_on_save():
    import functools
    fn = NeuroVaultApi.save_note

    @functools.wraps(fn)
    def save_note(self, note_id, title, content, *args, **kwargs):
        nid = _clean_id(note_id)
        old = self.db.query_one("SELECT title, content, updated_at FROM notes WHERE id = ?", (nid,)) if nid else None
        result = fn(self, note_id, title, content, *args, **kwargs)
        if _ok(result):
            try:
                row = self.db.query_one("SELECT title, content, updated_at FROM notes WHERE id = ?", (result["id"],))
                self._keep_version(result["id"], old, row["title"], row["content"], row["updated_at"])
            except Exception:
                log.exception("keeping a version of note %s failed", result.get("id"))
        return result
    NeuroVaultApi.save_note = save_note

    fs = NeuroVaultApi.save_settings

    @functools.wraps(fs)
    def save_settings(self, patch):
        result = fs(self, patch)
        if isinstance(patch, dict) and "note_versions_kept" in patch and not (result or {}).get("rejected", {}).get("note_versions_kept"):
            try:
                self._prune_versions()
            except Exception:
                log.exception("pruning note versions failed")
        return result
    NeuroVaultApi.save_settings = save_settings


_keep_versions_on_save()
# ==== end Build M ===========================================================


# ==== Build M · round 6 (R48 r48-simplify: "Simplify to Markdown keeps a copy too") ==========================================
@safe_action
def attachment_save_text(self, text, stem="table", ext="html", exact=False):
    """Saves text the page made (the rich table Simplify to Markdown replaced) as attachments/<stem> YYYYMMDD-HHMMSS.<ext>,
    so a copy is kept; with exact, as attachments/<stem>.<ext> (the page has already linked that name), or the next free
    name if it's taken. ext: html, csv, md or txt. {status, file, name, kind, size, mtime}"""
    if not isinstance(text, str) or not text.strip():
        return {"status": "error", "message": "There's nothing to keep."}
    if ext not in ("html", "csv", "md", "txt"):
        return {"status": "error", "message": "Only an HTML, CSV, Markdown or text copy can be kept."}
    raw = text.encode("utf-8")
    if len(raw) > attachments.MAX_DATA_BYTES:
        return {"status": "error", "message": "The copy is too big to keep."}
    stem = re.sub(r"[^\w ()-]+", "-", str(stem or "table")).strip(" -")[:60] or "table"
    base = self._att_base()
    attachments.folder(base, create=True)
    name = attachments.unique_name(base, stem if exact else f"{stem} {datetime.now():%Y%m%d-%H%M%S}", "." + ext)
    dest = os.path.join(attachments.folder(base), name)
    with open(dest + ".part", "wb") as f:   # list_files leaves .part files out until the bytes are all there
        f.write(raw)
    os.replace(dest + ".part", dest)
    return {"status": "success", **attachments.info(base, name)}


NeuroVaultApi.attachment_save_text = attachment_save_text


# QC 55: Open file (the window bar's icon, Ctrl+O) takes what a drop takes: notes (.md / .markdown / .txt), PDF and Word files
# (converted), and PNG / JPEG images (a note named after the file). The page sorts the paths; this is only the dialog.
OPEN_TYPES = ("Notes documents and images (*.md;*.markdown;*.txt;*.pdf;*.docx;*.xlsx;*.png;*.jpg;*.jpeg)",   # QC 60: no comma (pywebview allows only letters, digits, _ and spaces before the brackets)
              "Markdown and text files (*.md;*.markdown;*.txt)", "PDF files (*.pdf)", "Word documents (*.docx)", "Excel workbooks (*.xlsx)",   # Build M · R57
              "Images (*.png;*.jpg;*.jpeg)")


def browse_open_files(self):
    """The Open dialog for notes, PDF and Word files and images, several at once: [paths] (none when cancelled)."""
    if not self._window:
        return []
    try:
        result = self._window.create_file_dialog(webview.OPEN_DIALOG, allow_multiple=True, file_types=OPEN_TYPES)
    except Exception:
        log.exception("browse_open_files failed")
        return []
    return list(result or [])


NeuroVaultApi.browse_open_files = browse_open_files


# Build M · parity round (R52b): the editor toolbar's Attach (paperclip): a file of any kind, picked, goes straight into the note
# you're writing in (the page copies it in with drop_import and puts its embed at the caret, with Undo). Never a new note.
def attach_pick(self):
    """The Open dialog for one file of any kind: {status: success, path} or {status: cancelled}."""
    if not self._window:
        return {"status": "error", "message": "Window not ready."}
    try:
        picked = self._window.create_file_dialog(webview.OPEN_DIALOG, file_types=("All files (*.*)",))
    except Exception as e:
        log.exception("attach_pick failed")
        return {"status": "error", "message": plain_error(e, "open the file picker")}
    if not picked:
        return {"status": "cancelled"}
    return {"status": "success", "path": picked[0]}


NeuroVaultApi.attach_pick = attach_pick
# ==== end Build M · round 6 ==================================================


# ==== Build M · QC 68 (design profile 2026-10-18, "When we attach a file we CREATE COPIES!!! and show its original location
# first not the vault location!"): opening, attaching, dropping or converting a file copies it and never touches the original.
# Each copy remembers where it came from (attachment_sources: the vault-relative file → the original's full path, how it came
# in, and the copy's size so a later file under the same name isn't mistaken for it). list_attachments gives each file its
# source {path, exists, how}, and a note opened from a .md its own; attachment_reveal_source shows the original in File
# Explorer. Where the copies are stored is unchanged. ====
ATT_SOURCES_SCHEMA = """CREATE TABLE IF NOT EXISTS attachment_sources (
    file      TEXT PRIMARY KEY,          -- "attachments/<name>", or "note:<id>" for a note opened from a .md / .txt file
    source    TEXT NOT NULL,             -- the original's full path, as it was when it was copied
    how       TEXT NOT NULL,             -- attach | drop | convert | open | pick
    size      INTEGER,                   -- the copy's size then (a different file under the same name later isn't it)
    added_at  TEXT NOT NULL
)"""


def _att_src_table(self):
    if not getattr(self, "_att_src_ready", False):
        self.db.execute(ATT_SOURCES_SCHEMA)
        self._att_src_ready = True


def _att_from(self, file, source, how):
    """Remembers that the copy `file` came from `source`. A stand-in upload (a temp copy of a dropped file's bytes) has no
    original to name, so it's left out."""
    try:
        src = os.path.abspath(str(source))
        if os.path.basename(os.path.dirname(src)).startswith("nv-drop-"):
            return
        size = None
        if file.startswith(attachments.DIR + "/"):
            size = os.path.getsize(attachments.resolve(self._att_base(), file))
        _att_src_table(self)
        self.db.execute("INSERT OR REPLACE INTO attachment_sources (file, source, how, size, added_at) VALUES (?, ?, ?, ?, ?)",
                        (file, src, how, size, utc_now_iso()))
    except Exception:   # never in the way of the copy itself
        log.exception("remembering where %s came from", file)


def _att_sources(self, files=None):
    """{file: {path, exists, how}} for the copies that still are what was copied (same name and size)."""
    _att_src_table(self)
    sizes = {f["file"]: f["size"] for f in files} if files is not None else None
    out = {}
    for r in self.db.query("SELECT file, source, how, size FROM attachment_sources"):
        if r["file"].startswith(attachments.DIR + "/") and sizes is not None and sizes.get(r["file"]) != r["size"]:
            continue
        out[r["file"]] = {"path": r["source"], "exists": os.path.isfile(r["source"]), "how": r["how"]}
    return out


for _n, _f in (("_att_src_table", _att_src_table), ("_att_from", _att_from), ("_att_sources", _att_sources)):
    setattr(NeuroVaultApi, _n, _f)


def _qc68_wrap(name, after):
    orig = getattr(NeuroVaultApi, name)

    @functools.wraps(orig)
    def wrapped(self, *args, **kwargs):
        result = orig(self, *args, **kwargs)
        try:
            after(self, result, *args, **kwargs)
        except Exception:
            log.exception("QC 68: remembering a file's source after %s", name)
        return result
    setattr(NeuroVaultApi, name, wrapped)


def _src_ok(result):
    return isinstance(result, dict) and result.get("status") == "success" and isinstance(result.get("file"), str)


_qc68_wrap("attach_file", lambda self, r, path=None, *a, **k: _src_ok(r) and self._att_from(r["file"], path, "attach"))
_qc68_wrap("drop_import", lambda self, r, path=None, *a, **k: _src_ok(r) and self._att_from(r["file"], path, "drop"))
_qc68_wrap("_keep_source", lambda self, r, path=None, base=None, *a, **k: isinstance(r, dict) and r.get("file") and self._att_from(r["file"], path, "convert"))


def _md_opened(self, result, paths=None, *args, **kwargs):
    """A note opened from a .md / .txt file remembers that file (its images are remembered as they're copied)."""
    if not isinstance(result, dict) or result.get("status") != "success":
        return
    by_name = {os.path.basename(str(p)): p for p in (paths if isinstance(paths, list) else [paths]) if isinstance(p, str)}
    for n in result.get("notes") or []:
        if by_name.get(n.get("file")):
            self._att_from(f"note:{n['id']}", by_name[n["file"]], "open")


_qc68_wrap("import_md_files", _md_opened)


def _relinked(self, result, old=None, new=None, *args, **kwargs):
    """Rename… and Find the file…: the remembered source follows the file's new name."""
    if old and new and old != new:
        self._att_src_table()
        if self.db.query_one("SELECT 1 FROM attachment_sources WHERE file = ?", (old,)):
            self.db.execute("DELETE FROM attachment_sources WHERE file = ?", (new,))
            self.db.execute("UPDATE attachment_sources SET file = ? WHERE file = ?", (new, old))


_qc68_wrap("_relink_everywhere", _relinked)


def _listed(self, result, *args, **kwargs):
    if not isinstance(result, dict) or result.get("status") != "success":
        return
    src = self._att_sources(result.get("files") or [])
    for f in result.get("files") or []:
        f["source"] = src.get(f["file"])
    result["note_sources"] = {k[5:]: v for k, v in src.items() if k.startswith("note:")}


_qc68_wrap("list_attachments", _listed)


@safe_action
def attachment_reveal_source(self, file):
    """Shows the original a copy came from (or a note opened from a file) selected in File Explorer."""
    src = self._att_sources().get(file if isinstance(file, str) else "")
    if not src:
        return {"status": "error", "message": "NeuroVault doesn't know where this file came from."}
    if not src["exists"]:
        return {"status": "error", "message": f"The original isn't at {src['path']} any more: it was moved or deleted outside NeuroVault."}
    platform_layer.reveal_path(src["path"])
    return {"status": "success", "path": src["path"]}


NeuroVaultApi.attachment_reveal_source = attachment_reveal_source
# ==== end Build M · QC 68 ====
# ==== Build V · the vault on disk: notes as plain .md files in a folder you choose ====================================
# The user (2026-10-18): "this should not be the case" (the setup's "Daily notes in Obsidian", notes in the database);
# "do both". Profile: "First run starts with your vault folder".
# Files are the truth, the notes table is the index (vault_disk.py has the file rules, db.py the index columns):
#   - saving writes the note's file (only when its bytes change), renaming or moving renames or moves it, deleting sends
#     it to the Recycle Bin;
#   - projects (the user, profile 86cd7cf: "Top level folders are projects okay. A folder within a projects, is just a
#     folder. … notes can be root level, as well as projects level, and folder level and cascading further down"):
#     every top-level folder of the vault is a project, and every project is a top-level folder; folders inside a
#     project nest to any depth; notes at the vault's top show under "Unsorted" (feedback: "unsorted is good tbh, I
#     prefer it"), which is the one top-level entry that isn't a project;
#   - vault_poll (the page calls it every few seconds and on focus) writes what the index has that the files don't yet,
#     then reads the folder: new files become notes, changed ones are read again (each change a Build M version), a
#     file moved outside keeps its note (same text), a file gone takes its note out of the index;
#   - a file edited outside while NeuroVault had a newer text: NeuroVault's text is written and the outside text is
#     kept as a version ("Changed outside NeuroVault"), so nothing is lost;
#   - the first vault takes the notes that lived only in the database (feedback: "Ask once, then copy"): the database
#     is backed up, every note is written out as a .md file, attachments/ and .neurovault/ are copied over, nothing is
#     deleted. Settings stay in config.json on this PC (the decision); vault_path names the folder;
#   - Sticky Notes and Brain Dump are written as stickynoted/<file>.md and _inbox.md (their tables stay the working copy).
_VSTEM = re.compile(r"^(.*?)(?: (\d+))?$")


def _vf_fmt(fmt):
    fmt = fmt or "lf"
    return {"newline": "\r\n" if fmt.startswith("crlf") else "\n", "bom": "+bom" in fmt}


def _vf_fmt_of(d):
    return ("crlf" if d["newline"] == "\r\n" else "lf") + ("+bom" if d["bom"] else "")


def _vf_iso(ns):
    return datetime.fromtimestamp(ns / 1e9, timezone.utc).isoformat(timespec="seconds")


def _vf_same_tags(a, b):
    return sorted(t.lower() for t in a) == sorted(t.lower() for t in b)


class _VaultMixin:
    # ---- where things are ----
    def _vlock_(self):
        if not hasattr(self, "_vlock"):
            self._vlock = threading.RLock()
        return self._vlock

    def _vlive(self):
        """The vault folder, when there is one and it's there."""
        root = getattr(self, "_vroot", None)
        if getattr(self, "_vclash", None):   # QC 86: another install's vault, not answered yet: nothing is written there
            return None
        return root if root and os.path.isdir(root) else None

    def _vf_projects(self):
        return {vdisk.safe_name(r["name"]).lower(): r["id"] for r in self.db.query("SELECT id, name FROM projects")}

    def _vf_project_dir(self, pid):
        row = pid and self.db.query_one("SELECT name FROM projects WHERE id = ?", (pid,))
        return vdisk.safe_name(row["name"]) if row else ""

    @staticmethod
    def _vf_is_unsorted(f):
        return f["parent_id"] is None and f["project_id"] is None and (f["name"] or "").lower() == UNSORTED_FOLDER.lower()

    def _vf_folder_rel(self, folder_id, project_id=None):
        """The directory inside the vault for a folder (or a project's root): "" is the vault's top (Unsorted)."""
        names, fid, pid = [], folder_id, project_id
        while fid:
            f = self.db.query_one("SELECT id, name, parent_id, project_id FROM folders WHERE id = ?", (fid,))
            if not f or self._vf_is_unsorted(f):
                break
            names.insert(0, f["name"])
            pid, fid = f["project_id"], f["parent_id"]
        if pid:
            names.insert(0, self._vf_project_dir(pid))
        return "/".join(n for n in names if n)

    def _vf_project_for(self, name, projects):
        """The project a top-level directory is: the one with that name, or a new one (projects is updated)."""
        pid = projects.get(vdisk.safe_name(name).lower())
        if pid:
            return pid
        n = self.db.query_one("SELECT COUNT(*) AS n FROM projects")["n"]
        slot, now = n % 6 + 1, utc_now_iso()
        pid = self.db.execute("""INSERT INTO projects (name, description, color, color_slot, icon, archived, created_at, updated_at)
                                 VALUES (?, '', ?, ?, '', 0, ?, ?)""", (name, PALETTE[slot - 1], slot, now, now)).lastrowid
        projects[vdisk.safe_name(name).lower()] = pid
        return pid

    def _vf_place_rel(self, relpath, projects):
        """(folder_id, project_id) for a directory inside the vault: "" is the vault's top (Unsorted); a top-level
        directory is a project (made if new); deeper ones are folders, made as needed."""
        parts = [p for p in relpath.split("/") if p]
        if not parts:
            return self.db.unsorted_folder_id(), None
        pid = self._vf_project_for(parts[0], projects)
        rest = parts[1:]
        if not rest:
            return None, pid
        parent = None
        with self.db._lock:
            for name in rest:
                parent = self.db._child_folder(name, parent, pid)
            self.db.conn.commit()
        return parent, pid

    def _vf_prefix(self, old, new):
        """Note paths under directory old now sit under new (after a folder or project moved)."""
        if not old or old == new:
            return
        lo = old.lower() + "/"
        for r in self.db.query("SELECT id, path FROM notes WHERE vault IS ? AND path IS NOT NULL", (self.db.vault,)):
            if r["path"].lower().startswith(lo):
                self.db.execute("UPDATE notes SET path = ? WHERE id = ?", ((new + "/" if new else "") + r["path"][len(lo):], r["id"]))

    def _vf_move_dir(self, old, new):
        """Moves directory old to new inside the vault (or makes new). Returns where it went (a free name if new was
        taken)."""
        root = self._vlive()
        if not root or old == new or not new:
            return new
        src = vdisk.full(root, old) if old else None
        if src and os.path.isdir(src):
            dest = vdisk.full(root, new)
            if os.path.exists(dest) and os.path.normcase(dest) != os.path.normcase(src):
                dest = vdisk.free_path(os.path.dirname(dest), os.path.basename(dest), "")
                new = vdisk.rel(root, dest)
            vdisk.move(src, dest)
        else:
            os.makedirs(vdisk.full(root, new), exist_ok=True)
        self._vf_prefix(old, new)
        return new

    # ---- writing what the index has ----
    def _vf_write_row(self, row):
        """Writes one note's file where its folder and title say. Returns True if the file's bytes changed."""
        root = self._vlive()
        if not root:
            return False
        tags = self.db.get_tags_for("note_tags", "note_id", row["id"])
        want_dir, stem = self._vf_folder_rel(row["folder_id"], row["project_id"]), vdisk.safe_name(row["title"])
        cur, target = row["path"], None
        if cur:
            cdir, cname = cur.rsplit("/", 1) if "/" in cur else ("", cur)
            m = _VSTEM.match(os.path.splitext(cname)[0])
            if cdir.lower() == want_dir.lower() and m and m.group(1).lower() == stem.lower():
                target = cur   # same folder and title (a " 2" for a clash stays)
        if self._vf_absorb(row["id"]):
            row = self.db.query_one("SELECT * FROM notes WHERE id = ?", (row["id"],))
        fm, fmt = row["front_matter"] or "", _vf_fmt(row["file_fmt"])
        cur_path = vdisk.full(root, cur) if cur else None
        if cur_path and os.path.isfile(cur_path):
            if target is None:   # renamed or moved: the file moves (it keeps its dates), then gets the text
                dest = vdisk.free_path(vdisk.full(root, want_dir), stem)
                vdisk.move(cur_path, dest)
                target = vdisk.rel(root, dest)
        elif target is None:
            path0, same = self._vf_same_file(vdisk.full(root, want_dir), stem, row)   # QC 86
            target = vdisk.rel(root, path0)
            if same:
                return self._vf_match(row, target, same, tags)
        if not _vf_same_tags(vdisk.fm_tags(fm), tags):
            fm = vdisk.fm_set_tags(fm, tags, fmt["newline"])
        data = vdisk.note_bytes(row["content"] or "", fm, fmt["newline"], fmt["bom"])
        path = vdisk.full(root, target)
        try:
            with open(path, "rb") as f:
                changed = f.read() != data
        except OSError:
            changed = True
        st = vdisk.write_bytes(path, data) if changed else vdisk.stat(path)
        self.db.execute("""UPDATE notes SET path = ?, file_mtime = ?, file_size = ?, front_matter = ?, file_fmt = ?,
                           synced_at = ? WHERE id = ?""",
                        (target, st[0], st[1], fm, _vf_fmt_of(fmt), utc_now_iso(), row["id"]))
        return changed

    def _vf_absorb(self, nid):
        """The note's file changed outside NeuroVault since it was last written or read, and NeuroVault is about to
        write its own text: the outside text is kept as a version ("Changed outside NeuroVault") and its front matter
        (properties edited in Obsidian) is taken, so nothing is lost. True if it did."""
        root, row = self._vlive(), self.db.query_one("SELECT * FROM notes WHERE id = ?", (nid,))
        if not root or not row or not row["path"] or row["file_mtime"] is None:
            return False
        path = vdisk.full(root, row["path"])
        if not os.path.isfile(path) or vdisk.stat(path) == (row["file_mtime"], row["file_size"]):
            return False
        disk = vdisk.read_note(path)
        last = self.db.query_one("SELECT content FROM note_versions WHERE note_id = ? ORDER BY id DESC LIMIT 1", (nid,))
        if disk["body"] != (row["content"] or "") and (last is None or last["content"] != disk["body"]):
            self._add_version(nid, row["title"], disk["body"], "outside", _vf_iso(disk["mtime"]))
            self._prune_versions(nid)
        self.db.execute("UPDATE notes SET front_matter = ?, file_fmt = ?, file_mtime = ?, file_size = ? WHERE id = ?",
                        (disk["fm"], _vf_fmt_of(disk), disk["mtime"], disk["size"], nid))
        return True

    def _vf_flush(self, ids=None):
        """Writes every note whose file is behind the index (or the notes in ids, whatever their state). Returns how
        many files changed."""
        if not self._vlive():
            return 0
        with self._vlock_():
            if ids:
                marks = ",".join("?" * len(ids))
                rows = self.db.query(f"SELECT * FROM notes WHERE vault IS ? AND id IN ({marks})", (self.db.vault, *ids))
            else:
                rows = self.db.query("SELECT * FROM notes WHERE vault IS ? AND (path IS NULL OR synced_at IS NULL)",
                                     (self.db.vault,))
            n = 0
            for r in rows:
                try:
                    n += self._vf_write_row(r)
                except (OSError, vdisk.VaultError) as e:
                    log.warning("[vault] couldn't write note %s: %s", r["id"], e)
            return n

    # ---- reading the folder ----
    def _vf_scan(self):
        """Reads the vault folder into the index. {changed, added, removed, folders}: note ids, and whether the tree's
        folders changed."""
        root = self._vlive()
        out = {"changed": [], "added": [], "removed": [], "folders": False}
        if not root:
            return out
        with self._vlock_():
            files, dirs = vdisk.scan(root)
            projects, key = self._vf_projects(), self.db.vault
            rows = [dict(r) for r in self.db.query(
                "SELECT id, title, content, path, file_mtime, file_size, front_matter, folder_id, project_id, updated_at "
                "FROM notes WHERE vault IS ? AND path IS NOT NULL", (key,))]
            known = {r["path"].lower(): r for r in rows}
            on_disk = {p.lower(): p for p in files}
            folders_before = {r["id"] for r in self.db.query("SELECT id FROM folders WHERE vault IS ?", (key,))}
            for low, r in known.items():
                p = on_disk.get(low)
                if not p:
                    continue
                if p != r["path"]:
                    self.db.execute("UPDATE notes SET path = ? WHERE id = ?", (p, r["id"]))
                if files[p] == (r["file_mtime"], r["file_size"]):
                    continue
                try:
                    d = vdisk.read_note(vdisk.full(root, p))
                except OSError:
                    continue
                tags = self.db.get_tags_for("note_tags", "note_id", r["id"])
                if d["body"] == (r["content"] or "") and d["fm"] == (r["front_matter"] or "") and _vf_same_tags(d["tags"], tags):
                    self.db.execute("UPDATE notes SET file_mtime = ?, file_size = ?, file_fmt = ? WHERE id = ?",
                                    (d["mtime"], d["size"], _vf_fmt_of(d), r["id"]))
                    continue
                at = _vf_iso(d["mtime"])
                self.db.execute("""UPDATE notes SET content = ?, front_matter = ?, file_fmt = ?, file_mtime = ?, file_size = ?,
                                   updated_at = ? WHERE id = ?""",
                                (d["body"], d["fm"], _vf_fmt_of(d), d["mtime"], d["size"], at, r["id"]))
                self.db.execute("UPDATE notes SET synced_at = ? WHERE id = ?", (at, r["id"]))   # read, not behind (after the trigger)
                if not _vf_same_tags(d["tags"], tags):
                    self.db.set_tags("note_tags", "note_id", r["id"], d["tags"])
                    self._log_tags(r["id"], tags, d["tags"], "outside")   # QC 85
                if d["body"] != (r["content"] or ""):
                    self._keep_version(r["id"], r, r["title"], d["body"], at)
                out["changed"].append(r["id"])
            gone = [r for low, r in known.items() if low not in on_disk]
            for low, p in sorted(on_disk.items()):
                if low in known:
                    continue
                try:
                    d = vdisk.read_note(vdisk.full(root, p))
                except OSError:
                    continue
                fid, pid = self._vf_place_rel(p.rsplit("/", 1)[0] if "/" in p else "", projects)
                stem = os.path.splitext(p.rsplit("/", 1)[-1])[0]
                twin = next((g for g in gone if d["body"].strip() and (g["content"] or "") == d["body"]), None)
                if twin:   # moved or renamed outside NeuroVault: the same note, so its history and tasks stay
                    gone.remove(twin)
                    m = _VSTEM.match(stem)
                    title = twin["title"] if m and m.group(1).lower() == vdisk.safe_name(twin["title"]).lower() else stem
                    self.db.execute("""UPDATE notes SET path = ?, title = ?, folder_id = ?, project_id = ?, front_matter = ?,
                                       file_fmt = ?, file_mtime = ?, file_size = ? WHERE id = ?""",
                                    (p, title, fid, pid, d["fm"], _vf_fmt_of(d), d["mtime"], d["size"], twin["id"]))
                    self.db.execute("UPDATE notes SET synced_at = ? WHERE id = ?", (utc_now_iso(), twin["id"]))
                    out["changed"].append(twin["id"])
                    continue
                at = _vf_iso(d["mtime"])
                pname = self.db.query_one("SELECT name FROM projects WHERE id = ?", (pid,)) if pid else None
                cur = self.db.execute(
                    """INSERT INTO notes (title, content, category, project_id, folder_id, created_at, updated_at, vault, path,
                                          file_mtime, file_size, front_matter, file_fmt, synced_at)
                       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                    (stem, d["body"], pname["name"] if pname else "#General", pid, fid, at, at, key, p,
                     d["mtime"], d["size"], d["fm"], _vf_fmt_of(d), at))
                if d["tags"]:
                    self.db.set_tags("note_tags", "note_id", cur.lastrowid, d["tags"])
                out["added"].append(cur.lastrowid)
            for g in gone:   # deleted outside NeuroVault (it's in that app's bin or the Recycle Bin): it leaves the index
                self.db.execute("DELETE FROM notes WHERE id = ?", (g["id"],))
                out["removed"].append(g["id"])
            projects_before = set(projects.values())
            for dpath in dirs:
                self._vf_place_rel(dpath, projects)
            self._vf_drop_gone_folders({x.lower() for x in dirs})
            gone_projects = self._vf_drop_gone_projects({x.lower() for x in dirs if "/" not in x})
            out["folders"] = folders_before != {r["id"] for r in self.db.query("SELECT id FROM folders WHERE vault IS ?", (key,))} \
                or bool(set(projects.values()) - projects_before) or gone_projects
            out["projects"] = bool(set(projects.values()) - projects_before) or gone_projects
        return out

    def _vf_drop_gone_folders(self, dirs):
        """Folders whose directory has gone and that hold no notes leave the index."""
        for f in self.db.query("SELECT * FROM folders WHERE vault IS ? ORDER BY id DESC", (self.db.vault,)):
            if self._vf_is_unsorted(f):
                continue
            relp = self._vf_folder_rel(f["id"])
            if not relp or relp.lower() in dirs:
                continue
            sub = self.db.folder_subtree_ids(f["id"])
            marks = ",".join("?" * len(sub))
            if not self.db.query_one(f"SELECT 1 FROM notes WHERE folder_id IN ({marks})", tuple(sub)):
                self.db.execute("DELETE FROM folders WHERE id = ?", (f["id"],))

    def _vf_drop_gone_projects(self, top_dirs):
        """A project whose folder has gone from the vault and that holds nothing anywhere (no notes or folders in any
        vault, no tasks, no timed sessions) leaves the list. True if any did."""
        dropped = False
        for p in self.db.query("SELECT id, name FROM projects"):
            if vdisk.safe_name(p["name"]).lower() in top_dirs:
                continue
            pid = p["id"]
            if any(self.db.query_one(f"SELECT 1 FROM {t} WHERE project_id = ? LIMIT 1", (pid,))
                   for t in ("notes", "folders", "tasks", "sessions")):
                continue
            if self.db.query_one("SELECT 1 FROM running_session WHERE project_id = ?", (pid,)):
                continue
            self.db.execute("DELETE FROM projects WHERE id = ?", (pid,))
            dropped = True
        return dropped

    def _vf_toplevel(self):
        """No plain top-level folders in a vault but Unsorted: each other one becomes a project (the one with its name,
        or a new one), its folders and notes going with it. Unsorted keeps its notes (the vault's top); a folder inside
        it becomes top-level, so a project. Only index rows change; no file is touched or deleted."""
        projects = self._vf_projects()
        for _ in range(100):   # a folder inside Unsorted becomes top-level, then a project, on the next pass
            rows = [f for f in self.db.query("SELECT * FROM folders WHERE vault IS ? AND parent_id IS NULL AND project_id IS NULL",
                                             (self.db.vault,))
                    if not (self._vf_is_unsorted(f) and not self.db.query_one("SELECT 1 FROM folders WHERE parent_id = ?", (f["id"],)))]
            if not rows:
                return
            for f in rows:
                fid = f["id"]
                with self.db._lock:
                    c = self.db.conn
                    if self._vf_is_unsorted(f):   # it stays, with its notes; its folders go to the top (projects next pass)
                        c.execute("UPDATE folders SET parent_id = NULL WHERE parent_id = ?", (fid,))
                        c.commit()
                        continue
                    else:
                        pid = self._vf_project_for(f["name"], projects)
                        sub = [r[0] for r in c.execute(
                            "WITH RECURSIVE s(id) AS (SELECT ? UNION ALL SELECT x.id FROM folders x JOIN s ON x.parent_id = s.id) "
                            "SELECT id FROM s", (fid,))]
                        marks = ",".join("?" * len(sub))
                        c.execute(f"UPDATE folders SET project_id = ? WHERE id IN ({marks})", (pid, *sub))
                        c.execute(f"UPDATE notes SET project_id = ? WHERE folder_id IN ({marks})", (pid, *sub))
                        c.execute("UPDATE folders SET parent_id = NULL WHERE parent_id = ?", (fid,))
                        c.execute("UPDATE notes SET folder_id = NULL WHERE folder_id = ?", (fid,))
                    c.execute("DELETE FROM folders WHERE id = ?", (fid,))
                    c.commit()

    # ---- Sticky Notes and Brain Dump as files ----
    def _vf_capture(self):
        root = self._vlive()
        if not root:
            return
        try:
            for s in self.db.query("SELECT * FROM stickies"):
                data = sticky_file_text(dict(s)).encode("utf-8")
                path = os.path.join(root, vdisk.STICKY_DIR, vdisk.safe_name(s["file_name"]))
                if not os.path.isfile(path) or open(path, "rb").read() != data:
                    vdisk.write_bytes(path, data)
            items = []
            for r in self.db.query("SELECT * FROM inbox_items"):
                it = dict(r)
                it["tasks"] = json.loads(it["tasks"]) if it.get("tasks") else []
                it["task_ids"] = json.loads(it["task_ids"]) if it.get("task_ids") else []
                items.append(it)
            path = os.path.join(root, vdisk.INBOX_FILE)
            if items or os.path.isfile(path):
                data = inbox_markdown(items).encode("utf-8")
                if not os.path.isfile(path) or open(path, "rb").read() != data:
                    vdisk.write_bytes(path, data)
        except (OSError, ValueError) as e:
            log.warning("[vault] Sticky Notes / Brain Dump files: %s", e)

    # ---- opening a vault ----
    def _vf_set(self, path):
        self._vroot = os.path.abspath(path) if path else None
        self.db.vault = vdisk.key(path) if path else None

    def _vf_adopt(self):
        """The first vault takes what lived only in the database: a backup first, then attachments/ and .neurovault/
        are copied over, and every note is written out as a file (by the flush that follows). Nothing is deleted."""
        legacy = self.db.query_one("SELECT COUNT(*) AS n FROM notes WHERE vault IS NULL")["n"]
        legacy_f = self.db.query_one("SELECT COUNT(*) AS n FROM folders WHERE vault IS NULL")["n"]
        if not legacy and not legacy_f:
            return {"notes": 0, "files": 0, "backup": None}
        backup = self.db.backup("pre-vault") if legacy else None
        files = 0
        old, new = self._db_base(), self._vroot
        if os.path.normcase(os.path.abspath(old)) != os.path.normcase(os.path.abspath(new)):
            n, renames = vdisk.copy_attachments(os.path.join(old, "attachments"), os.path.join(new, "attachments"))   # QC 86
            files += n + vdisk.copy_tree_missing(os.path.join(old, ".neurovault"), os.path.join(new, ".neurovault"))
            self._vf_relink_legacy(renames)
        with self.db._lock:
            self.db.conn.execute("UPDATE folders SET vault = ? WHERE vault IS NULL", (self.db.vault,))
            self.db.conn.execute("UPDATE notes SET vault = ?, path = NULL, synced_at = NULL WHERE vault IS NULL", (self.db.vault,))
            self.db.conn.execute("INSERT OR REPLACE INTO app_meta (key, value) VALUES ('vault_adopted', ?)",
                                 (f"{utc_now_iso()} notes={legacy} vault={new} backup={backup or ''}",))
            self.db.conn.commit()
        self._vf_toplevel()   # a top-level folder becomes a project; Unsorted stays (the vault's top)
        return {"notes": legacy, "files": files, "backup": backup}

    def _vf_use(self, path):
        """Makes path the vault: remembers it, takes the database's own notes if this is the first vault, writes, reads."""
        path = os.path.abspath(path)
        with self._vlock_():
            self._vclash = None
            vdisk.write_marker(path, self._vf_me())   # QC 86: this install uses this folder (with any others it had)
            self._vf_set(path)
            self.cfg["vault_path"] = path
            cfgmod.save_config(self.cfg)
            adopted = self._vf_adopt()
            self._vf_toplevel()
            for f in self.db.query("SELECT id FROM folders WHERE vault IS ?", (self.db.vault,)):
                relp = self._vf_folder_rel(f["id"])
                if relp:
                    os.makedirs(vdisk.full(path, relp), exist_ok=True)
            written = self._vf_flush()
            self._vf_capture()
            scan = self._vf_scan()
        n = self.db.query_one("SELECT COUNT(*) AS n FROM notes WHERE vault IS ?", (self.db.vault,))["n"]
        return {"status": "success", "path": path, "notes": n, "copied": adopted["notes"], "written": written,
                "found": len(scan["added"]), "files_copied": adopted["files"], "backup": adopted["backup"]}

    def _vf_check_folder(self, path):
        if not path or not isinstance(path, str):
            return "Pick a folder."
        path = os.path.abspath(path)
        if os.path.dirname(path) == path:
            return "A whole drive can't be a vault: pick or make a folder on it."
        if os.path.normcase(path) == os.path.normcase(os.path.abspath(self._db_base())):
            return "That's NeuroVault's own folder: pick another one for your notes."
        if vdisk.is_test_install():   # QC 86 (c): a dev bridge or a check never touches the user's real vault
            return vdisk.test_vault_refusal(path)
        return None

    @safe_action
    def vault_state(self):
        """{status, path, exists, default, documents, legacy_notes}: the vault folder ("" before one is picked), whether
        it's there, the suggested new vault (Documents\\NeuroVault), and how many notes live only in the database."""
        path = self.cfg.get("vault_path") or ""
        return {"status": "success", "path": path, "exists": bool(path) and os.path.isdir(path),
                "in_use": self._vf_in_use_said(path, getattr(self, "_vclash", None)),   # QC 86
                "default": vdisk.default_vault(), "documents": vdisk.documents_dir(),
                "legacy_notes": 0 if path else self.db.query_one("SELECT COUNT(*) AS n FROM notes WHERE vault IS NULL")["n"]}

    @safe_action
    def vault_create(self, name="NeuroVault", parent=None, together=False):
        """Create a new vault: <parent or Documents>\\<name>, made if missing (a folder already there is opened).
        QC 86: a folder another NeuroVault uses is only taken with together=True (the user's "Use it together")."""
        name = vdisk.safe_name(name, "NeuroVault")
        path = os.path.join(parent or vdisk.documents_dir(), name)
        err = self._vf_check_folder(path)
        if err:
            return {"status": "error", "message": err}
        asked = os.path.isdir(path) and self._vf_ask_first(path, together)
        if asked:
            return asked
        try:
            os.makedirs(path, exist_ok=True)
        except OSError as e:
            return {"status": "error", "message": f"Couldn't make {path}: {e.strerror or e}"}
        return {**self._vf_use(path), "created": True}

    @safe_action
    def vault_open(self, path, together=False):
        """Open a folder as the vault (an Obsidian vault works too: its files are read, not moved or changed).
        QC 86: a folder another NeuroVault uses is only taken with together=True (the user's "Use it together")."""
        err = self._vf_check_folder(path)
        if err:
            return {"status": "error", "message": err}
        if not os.path.isdir(path):
            return {"status": "error", "message": f"That folder isn't there: {path}"}
        return self._vf_ask_first(path, together) or self._vf_use(path)

    def vault_choose(self):
        """The folder dialog, then vault_open. {status: cancelled} when nothing was picked."""
        picked = self.browse_vault_folder()
        if not picked:
            return {"status": "cancelled"}
        return self.vault_open(picked)

    @safe_action
    def vault_poll(self):
        """Writes what the index has that the files don't, then reads the folder.
        {status, changed, added, removed, folders, missing}."""
        empty = {"status": "success", "changed": [], "added": [], "removed": [], "folders": False, "missing": False}
        if not self.cfg.get("vault_path"):
            return empty
        if getattr(self, "_vclash", None):   # QC 86: waiting for "Use it together / Pick another folder"
            return {**empty, "in_use": self._vf_in_use_said(self.cfg.get("vault_path"), self._vclash)}
        if not self._vlive():
            return {**empty, "missing": True, "path": self.cfg.get("vault_path")}
        try:
            self._vf_flush()
            out = self._vf_scan()
        except vdisk.VaultError as e:
            return {**empty, "missing": True, "message": plain_error(e)}
        return {"status": "success", **out, "missing": False}

    # ---- QC 86 · whose vault is this (vault_disk.py's marker), and the copy-out matching what's there ----
    def _vf_me(self):
        """This install: the id kept in its database, its database's folder, and whether it's a test."""
        iid = self.db.get_meta("install_id")
        if not iid:
            import uuid
            iid = uuid.uuid4().hex
            self.db.execute("INSERT OR REPLACE INTO app_meta (key, value) VALUES ('install_id', ?)", (iid,))
        return {"install": iid, "data": os.path.abspath(self._db_base()), "test": vdisk.is_test_install()}

    def _vf_ask_first(self, path, together):
        """None when the folder can be used now; else the question for the page (code vault_in_use). A test install
        joins another test's scratch vault without asking."""
        c = vdisk.clash(path, self._vf_me())
        if not c or together or (c["test_only"] and vdisk.is_test_install()):
            return None
        return {"status": "error", "code": "vault_in_use", "path": os.path.abspath(path),
                "message": "This folder is already used by another NeuroVault.", "in_use": self._vf_in_use_said(path, c)}

    def _vf_claim_at_start(self, path):
        self._vclash = None
        if not os.path.isdir(path):
            return
        try:
            me = self._vf_me()
            c = vdisk.clash(path, me, at_start=True)
            if c and not (c["test_only"] and me["test"]):
                self._vclash = c
                log.warning("[vault] %s is another NeuroVault's vault: nothing is written until the user answers", path)
                return
            vdisk.write_marker(path, me)
        except OSError as e:
            log.warning("[vault] couldn't mark %s as this install's vault: %s", path, e)

    @staticmethod
    def _vf_in_use_said(path, c):
        """{path, message, detail} for the question "Use it together / Pick another folder", or None."""
        if not c:
            return None
        if c.get("legacy"):
            detail = "It already holds NeuroVault data (a .neurovault folder) from another install."
        else:
            n = len(c["installs"])
            detail = f"Its .neurovault/vault-id.json lists {n} other install{'' if n == 1 else 's'}." if n else \
                "Its .neurovault/vault-id.json can't be read, so it may belong to another install."
        return {"path": path, "message": "This folder is already used by another NeuroVault.",
                "detail": detail + " Use it together: both see the same notes, and nothing is copied twice."}

    def _vf_same_file(self, folder, stem, row):
        """Where a note with no file yet goes: (path, None) for the first free "<stem>.md" / "<stem> 2.md"..., or (path,
        the file as read) when a file of one of those names that no other note has already holds this note's text
        (the copy-out into a folder that has these notes: matched, not copied again)."""
        body, k, name = (row["content"] or "").replace("\r\n", "\n"), 1, stem
        while True:
            path = os.path.join(folder, name + vdisk.NOTE_EXT)
            if not os.path.exists(path):
                return path, None
            relp = vdisk.rel(self._vroot, path)
            if os.path.isfile(path) and not self.db.query_one(
                    "SELECT 1 FROM notes WHERE vault IS ? AND lower(path) = lower(?) AND id != ?", (self.db.vault, relp, row["id"])):
                try:
                    d = vdisk.read_note(path)
                except OSError:
                    d = None
                if d and d["body"] == body:
                    return path, d
            k += 1
            name = f"{stem} {k}"

    def _vf_match(self, row, target, d, tags):
        """The note takes the file that already holds its text: the file isn't written; its front matter is kept and
        its tags join the note's (none is dropped)."""
        low = {t.lower() for t in tags}
        extra = [t for t in d["tags"] if t.lower() not in low]
        if extra:
            self.db.set_tags("note_tags", "note_id", row["id"], list(tags) + extra)
        self.db.execute("""UPDATE notes SET path = ?, file_mtime = ?, file_size = ?, front_matter = ?, file_fmt = ?,
                           synced_at = ? WHERE id = ?""",
                        (target, d["mtime"], d["size"], d["fm"], _vf_fmt_of(d), utc_now_iso(), row["id"]))
        log.info("[vault] note %s matched %s (same text): nothing written", row["id"], target)
        return False

    def _vf_relink_legacy(self, renames):
        """An attachment that the copy-out matched by its bytes under another name, or copied under a free name: the
        notes being copied out (and the Brain Dump's clips) point at the name it has in the vault."""
        if not renames:
            return
        for r in self.db.query("SELECT id, content FROM notes WHERE vault IS NULL AND content LIKE '%attachments/%'"):
            text = r["content"] or ""
            for old, new in renames.items():
                text = attachments.relink(text, old, new)
            if text != (r["content"] or ""):
                self.db.execute("UPDATE notes SET content = ? WHERE id = ?", (text, r["id"]))
        cols = {c["name"] for c in self.db.query("PRAGMA table_info(inbox_items)")}
        for col in ("audio", "memo"):
            if col in cols:
                for old, new in renames.items():
                    self.db.execute(f"UPDATE inbox_items SET {col} = ? WHERE {col} = ?", (new, old))
    # ---- end QC 86 ----

    @safe_action
    def vault_reveal(self):
        """Shows the vault folder in File Explorer."""
        root = self._vlive()
        if not root:
            return {"status": "error", "message": "The vault folder isn't there."}
        platform_layer.open_path(root)
        return {"status": "success"}


for _n, _f in list(vars(_VaultMixin).items()):
    if not _n.startswith("__"):
        setattr(NeuroVaultApi, _n, _f)


def _vault_wraps():
    """Hooks the vault into the note, folder, project, Sticky Notes, Brain Dump and setup methods. Without a vault
    folder each runs exactly as before."""
    def wrap(name, before=None, after=None):
        fn = getattr(NeuroVaultApi, name)

        @functools.wraps(fn)
        def wrapped(self, *args, **kwargs):
            if not self._vlive():
                return fn(self, *args, **kwargs)
            with self._vlock_():
                ctx = before(self, *args, **kwargs) if before else None
                if isinstance(ctx, dict) and ctx.get("status") == "error":
                    return ctx
                if isinstance(ctx, dict) and "args" in ctx:
                    args, kwargs = ctx["args"], ctx.get("kwargs", kwargs)
                result = fn(self, *args, **kwargs)
                if after and _ok(result):
                    try:
                        after(self, result, ctx, *args, **kwargs)
                    except Exception as e:   # the database change stands; the next vault_poll writes the file
                        log.exception("[vault] %s", name)
                        result = {**result, "vault_warning": plain_error(e, "update the file")}
                return result
        setattr(NeuroVaultApi, name, wrapped)

    def unsorted_parent(self, args, kwargs, i, key="parent_id"):
        """A folder made or moved into Unsorted goes to the vault's top (Unsorted is the top itself)."""
        args = list(args)
        pid = args[i] if len(args) > i else kwargs.get(key)
        f = _clean_id(pid) and self.db.query_one("SELECT * FROM folders WHERE id = ?", (_clean_id(pid),))
        if f and self._vf_is_unsorted(f):
            if len(args) > i:
                args[i] = None
            else:
                kwargs = {**kwargs, key: None}
        return {"args": tuple(args), "kwargs": kwargs}

    def note_path(self, nid, *a, **k):
        row = self.db.query_one("SELECT path FROM notes WHERE id = ?", (_clean_id(nid),))
        return {"path": row["path"] if row else None}

    def save_before(self, nid, title=None, content=None, category=None, project_id=None, tags_text="", folder_id=KEEP):
        row = _clean_id(nid) and self.db.query_one("SELECT folder_id, project_id FROM notes WHERE id = ?", (_clean_id(nid),))
        if row:
            self._vf_absorb(_clean_id(nid))   # before Build M keeps the new text, so the versions stay in order
            if folder_id is KEEP and _clean_id(project_id) is None and row["folder_id"] is None and row["project_id"]:
                project_id = row["project_id"]   # a note at a project's top stays there (it isn't moved to the vault's top)
        return {"args": (nid, title, content, category, project_id, tags_text, folder_id), "kwargs": {}}
    wrap("save_note", before=save_before, after=lambda self, r, ctx, *a, **k: self._vf_flush([r["id"]]))
    wrap("move_note", after=lambda self, r, ctx, *a, **k: self._vf_flush([r["id"]]))
    wrap("restore_version", before=lambda self, nid, *a, **k: self._vf_absorb(_clean_id(nid)) and None, after=lambda self, r, ctx, note_id, *a, **k: self._vf_flush([_clean_id(note_id)]))

    def del_note_after(self, r, ctx, *a, **k):
        if ctx["path"]:
            vdisk.recycle(self._vroot, vdisk.full(self._vroot, ctx["path"]))
    wrap("delete_note", before=note_path, after=del_note_after)

    def folder_top(self, name=None, parent_id=None, project_id=None, *a, **k):
        parent = _clean_id(parent_id) and self.db.query_one("SELECT * FROM folders WHERE id = ?", (_clean_id(parent_id),))
        if (_clean_id(parent_id) is None and _clean_id(project_id) is None) or (parent and self._vf_is_unsorted(parent)):   # Unsorted is the top
            return {"status": "error", "code": "top_is_project",
                    "message": "A folder at the top of the vault is a project: make a project instead."}
        return {"args": (name, parent_id, project_id, *a), "kwargs": k}

    def mk_folder(self, r, ctx, *a, **k):
        relp = self._vf_folder_rel(r["id"])
        if relp:
            os.makedirs(vdisk.full(self._vroot, relp), exist_ok=True)
    wrap("create_folder", before=folder_top, after=mk_folder)

    def folder_before(self, fid, *a, **k):
        return {"old": self._vf_folder_rel(_clean_id(fid)), "args": (fid, *a), "kwargs": k}

    def folder_after(self, r, ctx, fid, *a, **k):
        fid = _clean_id(fid)
        want = self._vf_folder_rel(fid)
        new = self._vf_move_dir(ctx["old"], want)
        if new != want and new:   # the directory needed a free name there
            self.db.execute("UPDATE folders SET name = ? WHERE id = ?", (new.rsplit("/", 1)[-1], fid))
    wrap("rename_folder", before=folder_before, after=folder_after)

    def move_folder_before(self, fid, *a, **k):
        ctx = unsorted_parent(self, a, k, 0)
        return {**ctx, "old": self._vf_folder_rel(_clean_id(fid)), "args": (fid, *ctx["args"])}
    def move_folder_after(self, r, ctx, fid, *a, **k):
        folder_after(self, r, ctx, fid, *a, **k)
        self._vf_toplevel()   # moved to the top: it's a project now
    wrap("move_folder", before=move_folder_before, after=move_folder_after)

    def del_folder_after(self, r, ctx, *a, **k):
        if ctx["old"]:
            vdisk.recycle(self._vroot, vdisk.full(self._vroot, ctx["old"]))
    wrap("delete_folder", before=folder_before, after=del_folder_after)

    def proj_before(self, pid, name=None, *a, **k):
        old = self._vf_project_dir(_clean_id(pid))
        if name is not None and old:
            new = vdisk.safe_name((name or "").strip())
            if new.lower() != old.lower() and os.path.exists(vdisk.full(self._vroot, new)):
                return {"status": "error", "message": f'A folder called "{new}" is already in the vault.'}
        return {"old": old, "args": (pid, name, *a), "kwargs": k}

    def proj_after(self, r, ctx, pid, *a, **k):
        new = self._vf_project_dir(_clean_id(pid))
        if ctx["old"] and new != ctx["old"] and os.path.isdir(vdisk.full(self._vroot, ctx["old"])):
            self._vf_move_dir(ctx["old"], new)
    wrap("update_project", before=proj_before, after=proj_after)

    def proj_new_before(self, name="", *a, **k):
        d = vdisk.safe_name((name or "").strip()) if (name or "").strip() else ""
        if d and (d.startswith(".") or d.lower() in vdisk.SKIP_TOP):
            return {"status": "error", "message": f'"{d}" is a name NeuroVault keeps for its own folder.'}
        if d and os.path.exists(vdisk.full(self._vroot, d)) and vdisk.safe_name(d).lower() not in self._vf_projects():
            return {"status": "error", "message": f'"{d}" is already in the vault.'}
        return {"args": (name, *a), "kwargs": k}

    def proj_new_after(self, r, ctx, *a, **k):
        os.makedirs(vdisk.full(self._vroot, self._vf_project_dir(r["id"])), exist_ok=True)
    wrap("create_project", before=proj_new_before, after=proj_new_after)

    def del_proj_before(self, pid, *a, **k):
        p = _clean_id(pid)
        roots = [n["id"] for n in self.db.query(
            "SELECT id FROM notes WHERE folder_id IS NULL AND project_id = ? AND vault IS ?", (p, self.db.vault))]
        return {"dir": self._vf_project_dir(p),
                "folders": [f["id"] for f in self.db.query(
                    "SELECT id FROM folders WHERE parent_id IS NULL AND project_id = ? AND vault IS ?", (p, self.db.vault))],
                "notes": roots, "args": (pid, *a), "kwargs": k}

    def del_proj_after(self, r, ctx, *a, **k):
        d = ctx["dir"]
        for fid in ctx["folders"]:   # its folders are top-level folders now
            f = self.db.query_one("SELECT name FROM folders WHERE id = ?", (fid,))
            if f and d:
                want = self._vf_folder_rel(fid)
                new = self._vf_move_dir(f"{d}/{f['name']}", want)
                if new != want:
                    self.db.execute("UPDATE folders SET name = ? WHERE id = ?", (new.rsplit("/", 1)[-1], fid))
        self._vf_toplevel()   # its folders, top-level now, are projects
        if ctx["notes"]:
            self._vf_flush(ctx["notes"])   # its own notes are in Unsorted now: the vault's top
        path = vdisk.full(self._vroot, d) if d else None
        if path and os.path.isdir(path) and not any(os.scandir(path)):
            os.rmdir(path)   # only an empty folder; one with files left in it stays (it reads back as a folder)
    wrap("delete_project", before=del_proj_before, after=del_proj_after)

    for name in ("create_sticky", "update_sticky", "add_inbox_item", "update_inbox_item", "delete_inbox_item",
                 "add_inbox_voice", "update_inbox_voice"):
        if hasattr(NeuroVaultApi, name):
            wrap(name, after=lambda self, r, ctx, *a, **k: self._vf_capture())

    def del_sticky_before(self, sid, *a, **k):
        row = self.db.query_one("SELECT file_name FROM stickies WHERE id = ?", (_clean_id(sid),))
        return {"file": row["file_name"] if row else None, "args": (sid, *a), "kwargs": k}

    def del_sticky_after(self, r, ctx, *a, **k):
        if ctx["file"]:
            vdisk.recycle(self._vroot, os.path.join(self._vroot, vdisk.STICKY_DIR, vdisk.safe_name(ctx["file"])))
    wrap("delete_sticky", before=del_sticky_before, after=del_sticky_after)

    # Skip the setup on a first run makes the default vault (Documents\NeuroVault); the page reads vault_state
    sk = NeuroVaultApi.setup_skip

    @functools.wraps(sk)
    def setup_skip(self):
        first = not self.cfg.get("setup_done")
        r = sk(self)
        if _ok(r) and first and not self.cfg.get("vault_path"):
            v = self.vault_create()
            r = {**r, "vault_path": v.get("path", "")} if _ok(v) else {**r, "vault_warning": v.get("message")}
        return r
    NeuroVaultApi.setup_skip = setup_skip

    init = NeuroVaultApi.__init__

    @functools.wraps(init)
    def __init__(self, *args, **kwargs):
        init(self, *args, **kwargs)
        path = self.cfg.get("vault_path") or ""
        if path:
            self._vf_set(path)
            self._vf_claim_at_start(path)   # QC 86: another install's vault waits for an answer; nothing is written
            if self._vlive():
                try:
                    self._vf_toplevel()
                    self._vf_flush()
                    self._vf_scan()
                except Exception:
                    log.exception("[vault] reading %s at start failed", path)
    NeuroVaultApi.__init__ = __init__


_vault_wraps()


# QC 85 (Build V, overnight): the Timeline's "Tag changes" filter gets real data. Each save (or an outside edit read back from
# the vault) that adds or removes a note's tags is a row in tag_changes; list_tag_changes gives the Timeline the newest ones.
def _tag_diff(before, after):
    low_b, low_a = {t.lower() for t in before}, {t.lower() for t in after}
    return [t for t in after if t.lower() not in low_b], [t for t in before if t.lower() not in low_a]


def _log_tags(self, note_id, before, after, source="app"):
    added, removed = _tag_diff(before or [], after or [])
    if added or removed:
        self.db.execute("INSERT INTO tag_changes (note_id, added, removed, source, at) VALUES (?, ?, ?, ?, ?)",
                        (note_id, json.dumps(added), json.dumps(removed), source, utc_now_iso()))


def _tag_wraps():
    fn = NeuroVaultApi.save_note

    @functools.wraps(fn)
    def save_note(self, note_id, *args, **kwargs):
        nid = _clean_id(note_id)
        before = self.db.get_tags_for("note_tags", "note_id", nid) if nid else []
        result = fn(self, note_id, *args, **kwargs)
        if _ok(result):
            try:
                self._log_tags(result["id"], before, self.db.get_tags_for("note_tags", "note_id", result["id"]))
            except Exception:
                log.exception("logging the tag change of note %s failed", result.get("id"))
        return result
    NeuroVaultApi.save_note = save_note   # (the vault scan logs an outside edit's tags itself)


@safe_list()
def list_tag_changes(self, limit=80):
    """The newest tag changes in the open vault, for the Timeline: [{id, note_id, title, added, removed, source, at}]."""
    try:
        limit = max(1, min(int(limit), 500))
    except (TypeError, ValueError):
        limit = 80
    rows = self.db.query("""SELECT c.*, n.title AS note_title FROM tag_changes c JOIN notes n ON n.id = c.note_id
                            WHERE n.vault IS ? ORDER BY c.id DESC LIMIT ?""", (self.db.vault, limit))
    return [{"id": r["id"], "note_id": r["note_id"], "title": r["note_title"], "added": json.loads(r["added"] or "[]"),
             "removed": json.loads(r["removed"] or "[]"), "source": r["source"], "at": r["at"]} for r in rows]


NeuroVaultApi._log_tags = _log_tags
NeuroVaultApi.list_tag_changes = list_tag_changes
_tag_wraps()
# ==== end Build V ===========================================================


# ==== Build M · R56: the offline dictionary at setup and in Settings (Download / Remove), and the online lookup (off by
# default; "Look it up online" asks each time unless "Look words up online without asking" is on). setup_info carries the
# dictionary's status for the Reading step's card (Start then begins its download: dict-r56.js). ====
@safe_action
def dict_remove(self):
    """Settings → Editor → Dictionary → Remove: the offline dictionary off this PC (your words stay)."""
    return self._dict_call(self._dict().remove)


@safe_action
def dict_online(self, word, asked=False):
    """One word looked up online (dictionary.online_lookup), when the settings allow it: dict_online "always", or "ask" and the
    user asked just now (asked=True). "off" never sends anything."""
    mode = self.cfg.get("dict_online", "ask")
    if mode == "off" or (mode != "always" and not asked):
        return {"status": "error", "message": "Online lookup is off: turn it on in Settings → Editor → Dictionary, or choose Look it up online."}
    return dictmod.online_lookup(word)


def _setup_info_dict(self, result, *args, **kwargs):
    if isinstance(result, dict) and result.get("status", "success") == "success":
        try:
            st = self._dict().status()
            result["dict"] = {k: st.get(k) for k in ("state", "dictionary", "offline")}
        except Exception:   # noqa: BLE001 - the setup still opens without the card's numbers
            log.exception("setup_info: the dictionary's status")


def _r56_wrap(name, after):
    orig = getattr(NeuroVaultApi, name)

    @functools.wraps(orig)
    def wrapped(self, *args, **kwargs):
        result = orig(self, *args, **kwargs)
        try:
            after(self, result, *args, **kwargs)
        except Exception:   # noqa: BLE001
            log.exception("R56: after %s", name)
        return result
    setattr(NeuroVaultApi, name, wrapped)


NeuroVaultApi.dict_remove = dict_remove
NeuroVaultApi.dict_online = dict_online
_r56_wrap("setup_info", _setup_info_dict)
# ==== end Build M · R56 ====


# ==== Build M · R57: a dropped or opened workbook's sheets, for the one dialog (Convert lists them, the hidden ones unticked) ====
@safe_action
def xlsx_info(self, path):
    """{status, sheets: [{name, hidden, rows, cols, merged}], size} for an .xlsx the page is asking about (the file is only read)."""
    path, err = self._source_path(path)
    if err:
        return {"status": "error", "message": err}
    if converters.kind_of(path) != "xlsx":
        return {"status": "error", "message": "That isn't an Excel workbook (.xlsx)."}
    try:
        return {"status": "success", **converters.xlsx_info(path)}
    except converters.ConvertError as e:
        return {"status": "error", "message": plain_error(e)}


NeuroVaultApi.xlsx_info = xlsx_info
# ==== end Build M · R57 ====


# ==== Build M · QC 88 (design profile 2026-10-19, "Removing an attachment only takes it out of the app"; feedback: "remove
# attachment buttons puts deleted them to the recycle bin, I just wanted to remove them from the app, and have history show up in
# the timeline"). Remove takes the file's "![[…]]" lines out of the notes and the file out of NeuroVault's lists; the file stays
# in attachments/, never in the Recycle Bin. Each removal is a row in attachment_removals: the notes it was taken out of (each
# line with the line before it, so Restore puts it back where it was), and the Brain Dump thoughts it changed or took away. The
# Timeline lists them (list_attachment_removals) with Restore (restore_attachment). A removed file is hidden from
# list_attachments and from "unused" (so a clean-up never recycles it) until it's restored or a note embeds it again. Moving
# unused files to the Recycle Bin stays Settings' own, explicitly named action. ====
ATT_REMOVALS_SCHEMA = """CREATE TABLE IF NOT EXISTS attachment_removals (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    file          TEXT NOT NULL,              -- "attachments/<name>"
    notes         TEXT NOT NULL DEFAULT '[]', -- JSON [{id, title, lines: [{line, after}]}]: what Restore puts back
    inbox_changed TEXT NOT NULL DEFAULT '[]', -- JSON [thought ids] whose recording was cleared
    inbox_gone    TEXT NOT NULL DEFAULT '[]', -- JSON [thought rows] that had nothing else, taken away with it
    vault         TEXT,                       -- the vault it happened in (Build V), as tag_changes
    size          INTEGER,                    -- the file's size then: a different file under its name later isn't it
    at            TEXT NOT NULL,
    restored_at   TEXT
)"""


def _rm_table(self):
    if not getattr(self, "_rm_ready", False):
        self.db.execute(ATT_REMOVALS_SCHEMA)
        self._rm_ready = True


def _rm_vault(self):
    return getattr(self.db, "vault", None)


def _embed_lines(content, file):
    """The lines that are only this file's embed, each with the non-blank line before it (None: the top of the note)."""
    out, prev = [], None
    for line in (content or "").split("\n"):
        if line.strip() in (f"![[{file}]]", f"<!-- ![[{file}]] -->"):
            out.append({"line": line.strip(), "after": prev})
            continue
        if line.strip():
            prev = line
    return out


def _put_back(content, lines):
    """The note's text with each removed line back after the line it followed (or at the top), else at the end."""
    rows = (content or "").split("\n")
    for item in lines:
        if any(r.strip() == item["line"] for r in rows):
            continue   # already there (embedded again since)
        at = None
        if item["after"] is None:
            at = 0
        else:
            for k, r in enumerate(rows):
                if r == item["after"]:
                    at = k + 1
                    break
        if at is None:
            body = "\n".join(rows).rstrip("\n")
            rows = ((body + "\n\n") if body else "").split("\n") + [item["line"], ""]
        elif at == 0:
            rows[0:0] = [item["line"], ""]
        else:
            rows[at:at] = ["", item["line"]]
    return re.sub(r"\n{3,}", "\n\n", "\n".join(rows))


def _rm_hidden(self, uses_notes=None, uses_inbox=None):
    """Files removed and not restored, that no note or thought embeds again."""
    self._rm_table()
    rows = self.db.query("""SELECT file, size FROM attachment_removals WHERE restored_at IS NULL AND vault IS ?""", (self._rm_vault(),))
    files = set()
    for r in rows:   # still the file that was removed (same size): a different file put there since isn't hidden
        try:
            if r["size"] is None or os.path.getsize(attachments.resolve(self._att_base(), r["file"])) == r["size"]:
                files.add(r["file"])
        except (OSError, attachments.AttachmentError):
            pass
    if not files:
        return set()
    if uses_notes is None:
        uses_notes, uses_inbox = self._att_uses_rows()
    return {f for f in files if not attachments.uses(f, uses_notes, uses_inbox)}


@safe_action
def remove_attachment(self, file):  # noqa: F811
    """Remove (QC 88): takes the file's "![[…]]" lines out of every note and clears it from Brain Dump thoughts (a thought with
    nothing else left goes, and comes back with Restore). The file stays in attachments/. {status, file, notes: [ids changed],
    inbox: [ids changed], inbox_removed: [ids], removal: id}"""
    try:
        path = self._att_path(file)
    except attachments.AttachmentError as e:
        return {"status": "error", "message": plain_error(e)}
    file = "attachments/" + os.path.basename(path)
    self._rm_table()
    notes, uses_inbox = self._att_uses_rows()
    if file in self._rm_hidden(notes, uses_inbox):
        return {"status": "error", "message": f"{os.path.basename(file)} is already out of NeuroVault: Restore it from the Timeline."}
    changed, record = [], []
    for n in notes:
        if file in attachments.embeds(n["content"]):
            record.append({"id": n["id"], "title": n.get("title") or "", "lines": _embed_lines(n["content"], file)})
            self.db.execute("UPDATE notes SET content = ?, updated_at = ? WHERE id = ?",
                            (attachments.remove_embed(n["content"], file), utc_now_iso(), n["id"]))
            changed.append(n["id"])
    inbox, gone, gone_rows = [], [], []
    for r in self.db.query("SELECT * FROM inbox_items WHERE audio = ?", (file,)):
        if (r["text"] or "").strip() or json.loads(r["tasks"] or "[]") or json.loads(r["task_ids"] or "[]"):
            self.db.execute("UPDATE inbox_items SET audio = NULL WHERE id = ?", (r["id"],))
            inbox.append(r["id"])
        else:
            gone_rows.append(dict(r))
            self.db.execute("DELETE FROM inbox_items WHERE id = ?", (r["id"],))
            gone.append(r["id"])
    cur = self.db.execute("""INSERT INTO attachment_removals (file, notes, inbox_changed, inbox_gone, vault, size, at)
                             VALUES (?, ?, ?, ?, ?, ?, ?)""", (file, json.dumps(record), json.dumps(inbox), json.dumps(gone_rows, default=str),
                                                                self._rm_vault(), os.path.getsize(path), utc_now_iso()))
    return {"status": "success", "file": file, "notes": changed, "inbox": inbox, "inbox_removed": gone, "removal": cur.lastrowid,
            "kept": os.path.isfile(path)}


@safe_action
def restore_attachment(self, removal_id):
    """The Timeline's Restore: the file's lines go back into the notes they were taken out of (where they were), its thoughts
    get their recording back, and it shows in NeuroVault's lists again. {status, file, notes: [ids], inbox: [ids]}"""
    self._rm_table()
    try:
        rid = int(removal_id)
    except (TypeError, ValueError):
        return {"status": "error", "message": "Unknown removal."}
    row = self.db.query_one("SELECT * FROM attachment_removals WHERE id = ?", (rid,))
    if not row:
        return {"status": "error", "message": "Unknown removal."}
    if row["restored_at"]:
        return {"status": "error", "message": "It's already back."}
    file, notes, inbox = row["file"], [], []
    if not os.path.isfile(attachments.resolve(self._att_base(), file)):
        return {"status": "error", "message": f"{file} isn't in attachments/ any more, so it can't come back."}
    for n in json.loads(row["notes"] or "[]"):
        cur = self.db.query_one("SELECT id, content FROM notes WHERE id = ?", (n["id"],))
        if not cur:
            continue
        new = _put_back(cur["content"], n["lines"])
        if new != cur["content"]:
            self.db.execute("UPDATE notes SET content = ?, updated_at = ? WHERE id = ?", (new, utc_now_iso(), n["id"]))
            notes.append(n["id"])
    for tid in json.loads(row["inbox_changed"] or "[]"):
        if self.db.query_one("SELECT id FROM inbox_items WHERE id = ? AND audio IS NULL", (tid,)):
            self.db.execute("UPDATE inbox_items SET audio = ? WHERE id = ?", (file, tid))
            inbox.append(tid)
    for r in json.loads(row["inbox_gone"] or "[]"):
        if r.get("id") is not None and not self.db.query_one("SELECT id FROM inbox_items WHERE id = ?", (r["id"],)):
            cols = [c for c in r if c in self.db._columns("inbox_items")]
            self.db.execute(f"INSERT INTO inbox_items ({', '.join(cols)}) VALUES ({', '.join('?' for _ in cols)})", [r[c] for c in cols])
            inbox.append(r["id"])
    self.db.execute("UPDATE attachment_removals SET restored_at = ? WHERE id = ?", (utc_now_iso(), rid))
    return {"status": "success", "file": file, "notes": notes, "inbox": inbox}


@safe_list()
def list_attachment_removals(self, limit=80):
    """The newest removals in the open vault, for the Timeline: [{id, file, name, notes: [{id, title}], at, restored_at, kept}]."""
    self._rm_table()
    try:
        limit = max(1, min(int(limit), 500))
    except (TypeError, ValueError):
        limit = 80
    out = []
    for r in self.db.query("SELECT * FROM attachment_removals WHERE vault IS ? ORDER BY id DESC LIMIT ?", (self._rm_vault(), limit)):
        notes = [{"id": n["id"], "title": n.get("title") or ""} for n in json.loads(r["notes"] or "[]")]
        out.append({"id": r["id"], "file": r["file"], "name": os.path.basename(r["file"]), "notes": notes, "at": r["at"],
                    "restored_at": r["restored_at"], "kept": os.path.isfile(attachments.resolve(self._att_base(), r["file"]))})
    return out


def _qc88_listed(orig):
    @functools.wraps(orig)
    def list_attachments(self, *a, **k):
        result = orig(self, *a, **k)
        if isinstance(result, dict) and result.get("status") == "success":
            try:
                hidden = self._rm_hidden()
                if hidden:
                    result["files"] = [f for f in result.get("files") or [] if f["file"] not in hidden]
                    result["hidden"] = len(hidden)
            except Exception:   # noqa: BLE001 - the list still shows
                log.exception("QC 88: hiding removed attachments")
        return result
    return list_attachments


def _qc88_unused(orig):
    @functools.wraps(orig)
    def _unused(self, *a, **k):
        files = orig(self, *a, **k)
        try:
            hidden = self._rm_hidden()
        except Exception:   # noqa: BLE001
            log.exception("QC 88: hiding removed attachments from unused")
            return files
        return [f for f in files if f["file"] not in hidden]   # a removed file is never recycled by a clean-up
    return _unused


for _n, _f in (("_rm_table", _rm_table), ("_rm_vault", _rm_vault), ("_rm_hidden", _rm_hidden), ("remove_attachment", remove_attachment),
               ("restore_attachment", restore_attachment), ("list_attachment_removals", list_attachment_removals)):
    setattr(NeuroVaultApi, _n, _f)
NeuroVaultApi.list_attachments = _qc88_listed(NeuroVaultApi.list_attachments)
NeuroVaultApi._unused = _qc88_unused(NeuroVaultApi._unused)
# ==== end Build M · QC 88 ====


# ==== Build M · R59 (the first user: "tasks is added to notes, would like if there was an option to keep it separate without it
# appearing in any notes (though manageable)"; r59-tlink a quiet link; r59-texist the drawn default). Settings → Vault & files →
# Where tasks live: In their notes (as today) | Only in Tasks (config tasks_keep_out). Turning it on asks once about the tasks
# already in notes: tasks_in_notes counts them; tasks_move_out takes their lines ({{tasks}} and "- [ ]" lines) out of the notes'
# text, each task keeping its link to its note (one is made for a line that had none), and records each note in task_moves so
# the Timeline can put the lines back (restore_task_move). Nothing is deleted. ====
TASK_MOVES_SCHEMA = """CREATE TABLE IF NOT EXISTS task_moves (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    note_id      INTEGER NOT NULL,
    title        TEXT NOT NULL DEFAULT '',
    lines        TEXT NOT NULL DEFAULT '[]',  -- JSON [{line, after}]: the lines taken out, in order
    before_text  TEXT,                        -- the note's text before and after the move: Restore writes "before" back
    after_text   TEXT,                        -- when the note hasn't changed since, else adds the lines at its end
    count        INTEGER NOT NULL DEFAULT 0,  -- tasks it took out
    vault        TEXT,
    at           TEXT NOT NULL,
    restored_at  TEXT
)"""
_TASK_LINE = re.compile(r"^\s*[-*+]\s+\[( |x|X)\]\s+(.+?)\s*$")


def _tm_table(self):
    if not getattr(self, "_tm_ready", False):
        self.db.execute(TASK_MOVES_SCHEMA)
        self._tm_ready = True


def _note_task_lines(content):
    """The note's task lines: "{{tasks}}" and "- [ ] …" lines outside code blocks: [(index, line, title or None, done)]."""
    out, fence = [], None
    for i, line in enumerate((content or "").split("\n")):
        f = re.match(r"\s*(`{3,}|~{3,})", line)
        if f:
            fence = None if fence and f.group(1)[0] == fence[0] else (fence or f.group(1))
            continue
        if fence:
            continue
        if line.strip() == "{{tasks}}":
            out.append((i, line, None, False))
            continue
        m = _TASK_LINE.match(line)
        if m:
            out.append((i, line, re.sub(r"\\([\\`*_{}\[\]()#+\-.!|<>~])", r"\1", m.group(2)), m.group(1).lower() == "x"))   # unescaped, as the page reads it (store.js mdTaskLines)
    return out


def _tasks_of_note(self, note_id):
    return [dict(r) for r in self.db.query("SELECT id, title, completed FROM tasks WHERE note_id = ?", (note_id,))]


@safe_action
def tasks_in_notes(self):
    """What Only in Tasks would take out: {status, notes: [{id, title, count}], total} (the open vault's notes)."""
    out = []
    for n in self.db.query("SELECT id, title, content FROM notes WHERE vault IS ?", (getattr(self.db, "vault", None),)):
        lines = _note_task_lines(n["content"])
        if not lines:
            continue
        titles = [t for _, _, t, _ in lines if t]
        block = any(t is None for _, _, t, _ in lines)
        linked = [t for t in self._tasks_of_note(n["id"]) if t["title"] not in titles] if block else []
        count = len(titles) + len(linked)
        if count:
            out.append({"id": n["id"], "title": n["title"] or "", "count": count})
    return {"status": "success", "notes": out, "total": sum(x["count"] for x in out)}


@safe_action
def tasks_move_out(self):
    """Only in Tasks → Move them to Tasks: each note's task lines leave its text; every task keeps its link to the note (a line
    with no task gets one). {status, moved: [{move, note_id, title, count}], total}"""
    self._tm_table()
    vault, now, moved = getattr(self.db, "vault", None), utc_now_iso(), []
    for n in self.db.query("SELECT id, title, content, folder_id, project_id FROM notes WHERE vault IS ?", (vault,)):
        lines = _note_task_lines(n["content"])
        if not lines:
            continue
        have = {t["title"] for t in self._tasks_of_note(n["id"])}
        block = any(t is None for _, _, t, _ in lines)
        count = len([1 for _, _, t, _ in lines if t]) + (len([t for t in have if t not in {x for _, _, x, _ in lines}]) if block else 0)
        if not count:
            continue
        for _, _, title, done in lines:   # a line that never became a task (made outside NeuroVault): one is made, linked
            if title and title not in have:
                self.save_task(None, title, "", "Medium", None, n["project_id"], "", done, n["id"], "medium")
                have.add(title)
        rows, record, prev, drop = n["content"].split("\n"), [], None, {i for i, _, _, _ in lines}
        for i, line in enumerate(rows):
            if i in drop:
                record.append({"line": line, "after": prev})
            elif line.strip():
                prev = line
        kept = [line for i, line in enumerate(rows) if i not in drop]
        text = re.sub(r"\n{3,}", "\n\n", "\n".join(kept)).strip("\n") + "\n"
        self.db.execute("UPDATE notes SET content = ?, updated_at = ? WHERE id = ?", (text, now, n["id"]))
        cur = self.db.execute("INSERT INTO task_moves (note_id, title, lines, before_text, after_text, count, vault, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                              (n["id"], n["title"] or "", json.dumps(record), n["content"], text, count, vault, now))
        moved.append({"move": cur.lastrowid, "note_id": n["id"], "title": n["title"] or "", "count": count})
    return {"status": "success", "moved": moved, "total": sum(m["count"] for m in moved)}


@safe_action
def restore_task_move(self, move_id):
    """The Timeline's Restore: the task lines go back into the note where they were (at the end if it changed since); the tasks
    were never touched. {status, note_id, title}"""
    self._tm_table()
    try:
        mid = int(move_id)
    except (TypeError, ValueError):
        return {"status": "error", "message": "Unknown move."}
    row = self.db.query_one("SELECT * FROM task_moves WHERE id = ?", (mid,))
    if not row:
        return {"status": "error", "message": "Unknown move."}
    if row["restored_at"]:
        return {"status": "error", "message": "They're already back in the note."}
    cur = self.db.query_one("SELECT id, content FROM notes WHERE id = ?", (row["note_id"],))
    if not cur:
        return {"status": "error", "message": "The note is gone, so the lines can't go back into it."}
    if row["after_text"] is not None and cur["content"] == row["after_text"]:
        new = row["before_text"]   # unchanged since: exactly as it was
    else:   # changed since: the lines, in their order, as one block at the end (any already there aren't added again)
        here = {x.strip() for x in cur["content"].split("\n")}
        add = [x["line"] for x in json.loads(row["lines"] or "[]") if x["line"].strip() not in here]
        new = cur["content"] if not add else cur["content"].rstrip("\n") + "\n\n" + "\n".join(add) + "\n"
    if new != cur["content"]:
        self.db.execute("UPDATE notes SET content = ?, updated_at = ? WHERE id = ?", (new, utc_now_iso(), row["note_id"]))
    self.db.execute("UPDATE task_moves SET restored_at = ? WHERE id = ?", (utc_now_iso(), mid))
    return {"status": "success", "note_id": row["note_id"], "title": row["title"]}


@safe_list()
def list_task_moves(self, limit=80):
    """For the Timeline: [{id, note_id, title, count, at, restored_at}] in the open vault, newest first."""
    self._tm_table()
    try:
        limit = max(1, min(int(limit), 500))
    except (TypeError, ValueError):
        limit = 80
    return [{"id": r["id"], "note_id": r["note_id"], "title": r["title"], "count": r["count"], "at": r["at"], "restored_at": r["restored_at"]}
            for r in self.db.query("SELECT * FROM task_moves WHERE vault IS ? ORDER BY id DESC LIMIT ?", (getattr(self.db, "vault", None), limit))]


for _n, _f in (("_tm_table", _tm_table), ("_tasks_of_note", _tasks_of_note), ("tasks_in_notes", tasks_in_notes), ("tasks_move_out", tasks_move_out),
               ("restore_task_move", restore_task_move), ("list_task_moves", list_task_moves)):
    setattr(NeuroVaultApi, _n, _f)
# ==== end Build M · R59 ====


# ==== Build M · QC 95 (a page stall on the user's ultrawide left no trace: the Python side was fine, so trial.log had nothing).
# Page-side errors (window.onerror, unhandledrejection) and long stalls (a frame over about a second) come here from
# frontend/js/log-r95.js and go into the app log (neurovault.log / trial.log) under "neurovault.page". Only the error message
# and where it happened: the page never sends note text, and this side cuts each line short and drops long quoted text too.
# Rate-limited: at most 20 lines a minute; the same line again within the minute is only counted, and said once after. ====
_PAGE_LOG = logging.getLogger("neurovault.page")
_PAGE_LEVELS = {"error": logging.ERROR, "warn": logging.WARNING, "warning": logging.WARNING, "info": logging.INFO}
_PAGE_RATE = {"window": 0.0, "sent": 0, "seen": {}, "dropped": 0}
_PAGE_QUOTED = re.compile(r"([\"'“‘`])[^\"'”’`]{24,}[\"'”’`]")


def _page_clean(s, cap):
    s = re.sub(r"\s+", " ", str(s or "")).strip()
    s = _PAGE_QUOTED.sub(r"\1…\1", s)   # a long quoted run could be someone's text: never logged
    s = s[:cap] + ("…" if len(s) > cap else "")
    enc = getattr(sys.stderr, "encoding", None) or "utf-8"   # the log is the console's: what it can't show becomes "?", never a logging error
    try:
        return s.encode(enc, "replace").decode(enc)
    except LookupError:
        return s


def log_client(self, level="error", message="", where=""):
    """The page's errors and stalls into the app log. Returns {"status": "success", "logged": bool}."""
    try:
        now = time.monotonic()
        lvl = _PAGE_LEVELS.get(str(level or "").lower(), logging.INFO)
        msg, at = _page_clean(message, 300), _page_clean(where, 160)
        if not msg:
            return {"status": "success", "logged": False}
        r = _PAGE_RATE
        if now - r["window"] >= 60:   # a new minute: say what was held back in the last one
            held = {k: v for k, v in r["seen"].items() if v > 1}
            for k, v in list(held.items())[:5]:
                _PAGE_LOG.warning("%s (repeated %d times in a minute)", k, v - 1)
            if r["dropped"]:
                _PAGE_LOG.warning("%d more page messages in a minute were not logged", r["dropped"])
            r.update(window=now, sent=0, seen={}, dropped=0)
        key = f"{msg} @ {at}" if at else msg
        if key in r["seen"]:
            r["seen"][key] += 1
            return {"status": "success", "logged": False}
        if r["sent"] >= 20:
            r["dropped"] += 1
            return {"status": "success", "logged": False}
        r["seen"][key] = 1
        r["sent"] += 1
        _PAGE_LOG.log(lvl, "%s", key)
        return {"status": "success", "logged": True}
    except Exception:   # logging must never break the page
        return {"status": "success", "logged": False}


setattr(NeuroVaultApi, "log_client", log_client)
# ==== end Build M · QC 95 ====


# ==== Build V · R59 editing photos (feedback: "Both"; "Editing always saves a copy and keeps the original", QC 68 / 88) =========
# Crop, rotate, flip and mark-up are drawn in the page (a canvas); photo_save_edit writes the result as a copy beside the original,
# "<name> (edited).png", remembers where it came from (QC 68: how "edit"), and points the note's embed at the copy. QC 100: one
# copy per original, no "(edited 2)" chains: editing the copy again (or the original again) re-uses "<name> (edited).png", and the
# version it replaces goes to the Recycle Bin. Each edit is a row in photo_edits whose from_file is the ORIGINAL; the Timeline lists
# them (list_photo_edits) and Restore (restore_photo_edit) points the note back at the original. The original is never changed.
PHOTO_EDITS_SCHEMA = """CREATE TABLE IF NOT EXISTS photo_edits (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    note_id     INTEGER,                  -- the note whose embed now shows the copy (NULL: none)
    from_file   TEXT NOT NULL,            -- "attachments/<name>": the photo it was made from
    to_file     TEXT NOT NULL,            -- "attachments/<name> (edited).png"
    what        TEXT NOT NULL,            -- crop | rotate | flip | markup | edit
    vault       TEXT,                     -- the vault it happened in (Build V)
    at          TEXT NOT NULL,
    restored_at TEXT                      -- Restore pointed the note back at from_file
)"""
PHOTO_WHATS = ("crop", "rotate", "flip", "markup", "edit")
_EDITED = re.compile(r"\s\(edited(?:\s\d+)?\)$")


def _ph_table(self):
    if not getattr(self, "_ph_ready", False):
        self.db.execute(PHOTO_EDITS_SCHEMA)
        self._ph_ready = True


def _ph_original(self, rel):
    """The original a photo was edited from: rel itself, or, for an "(edited)" copy, the from_file of the edit that made it."""
    if not _EDITED.search(os.path.splitext(os.path.basename(rel))[0]):
        return rel
    _ph_table(self)
    r = self.db.query_one("SELECT from_file FROM photo_edits WHERE to_file = ? ORDER BY id DESC LIMIT 1", (rel,))
    try:
        return r["from_file"] if r and self._att_path(r["from_file"]) else rel
    except attachments.AttachmentError:
        return rel


def _ph_swap(self, nid, old, new):
    """Points the note's embeds of old at new (its own text only). True if it changed."""
    row = nid and self.db.query_one("SELECT content FROM notes WHERE id = ?", (nid,))
    if not row or f"![[{old}]]" not in (row["content"] or ""):
        return False
    self.db.execute("UPDATE notes SET content = ?, updated_at = ? WHERE id = ?",
                    (row["content"].replace(f"![[{old}]]", f"![[{new}]]"), utc_now_iso(), nid))
    if getattr(self, "_vlive", None) and self._vlive():
        self._vf_flush([nid])   # the vault's .md follows at once
    return True


@safe_action
def photo_save_edit(self, file, data, note_id=None, what="edit"):
    """Saves an edited photo (a PNG data: URL from the page) as a copy beside the original and points the note's embed at it.
    {status, file, from, edit, note_id, swapped, name, size, …}. The original is never changed."""
    try:
        src = self._att_path(file)
    except attachments.AttachmentError as e:
        return {"status": "error", "message": plain_error(e)}
    if attachments.kind_of(src) != "image":
        return {"status": "error", "message": "Only a photo can be edited."}
    m = re.match(r"^data:image/png;base64,([A-Za-z0-9+/=\s]+)$", str(data or ""))
    if not m:
        return {"status": "error", "message": "The edited photo didn't arrive as a PNG."}
    raw = base64.b64decode(m.group(1))
    if len(raw) > attachments.MAX_DATA_BYTES:
        return {"status": "error", "message": "The edited photo is too big to keep."}
    if not raw.startswith(b"\x89PNG\r\n\x1a\n"):
        return {"status": "error", "message": "The edited photo isn't a PNG."}
    what = what if what in PHOTO_WHATS else "edit"
    base = self._att_base()
    shown = "attachments/" + os.path.basename(src)
    orig = _ph_original(self, shown)   # QC 100: the copy of a copy is still the original's one copy
    stem = _EDITED.sub("", os.path.splitext(os.path.basename(orig))[0])
    root = attachments.folder(base, create=True)
    name = f"{stem} (edited).png"
    dest = os.path.join(root, name)
    if os.path.exists(dest):   # the earlier edit: to the Recycle Bin, so it can still be got back (QC 88: nothing is deleted)
        try:
            attachments.recycle(dest)
        except attachments.AttachmentError:
            log.info("photo edit: %s is replaced in place (no Recycle Bin)", name)
    with open(dest + ".part", "wb") as f:
        f.write(raw)
    os.replace(dest + ".part", dest)
    new = "attachments/" + name
    self._att_from(new, attachments.resolve(base, orig), "edit")   # QC 68: where it came from
    nid = _clean_id(note_id)
    swapped = (self._ph_swap(nid, shown, new) if shown != new else False) if nid else False
    row = nid and self.db.query_one("SELECT content FROM notes WHERE id = ?", (nid,))
    shows = bool(row and f"![[{new}]]" in (row["content"] or ""))
    _ph_table(self)
    cur = self.db.execute("INSERT INTO photo_edits (note_id, from_file, to_file, what, vault, at) VALUES (?, ?, ?, ?, ?, ?)",
                          (nid if shows else None, orig, new, what, getattr(self.db, "vault", None), utc_now_iso()))
    return {"status": "success", "from": orig, "edit": cur.lastrowid, "note_id": nid if shows else None, "swapped": swapped,
            **attachments.info(base, name)}


@safe_list()
def list_photo_edits(self, limit=80):
    """The newest photo edits in the open vault: [{id, note_id, title, from, to, what, at, restored_at, kept}] (kept: the
    original is still in attachments/, so Restore can show it)."""
    _ph_table(self)
    try:
        limit = max(1, min(int(limit), 500))
    except (TypeError, ValueError):
        limit = 80
    rows = self.db.query("""SELECT e.*, n.title AS note_title FROM photo_edits e LEFT JOIN notes n ON n.id = e.note_id
                            WHERE e.vault IS ? ORDER BY e.id DESC LIMIT ?""", (getattr(self.db, "vault", None), limit))
    base = self._att_base()
    return [{"id": r["id"], "note_id": r["note_id"], "title": r["note_title"], "from": r["from_file"], "to": r["to_file"],
             "what": r["what"], "at": r["at"], "restored_at": r["restored_at"],
             "kept": os.path.isfile(attachments.resolve(base, r["from_file"]))} for r in rows]


@safe_action
def restore_photo_edit(self, edit_id):
    """Restore: the note shows the original again. The edited copy stays in attachments/.
    {status, note_id, file, to}"""
    _ph_table(self)
    eid = _clean_id(edit_id)
    r = eid and self.db.query_one("SELECT * FROM photo_edits WHERE id = ?", (eid,))
    if not r:
        return {"status": "error", "message": "That edit isn't recorded."}
    if r["restored_at"]:
        return {"status": "error", "message": f"{os.path.basename(r['from_file'])} is already back."}
    try:
        self._att_path(r["from_file"])
    except attachments.AttachmentError:
        return {"status": "error", "message": f"{os.path.basename(r['from_file'])} isn't in attachments/ any more."}
    if r["note_id"] and not self._ph_swap(r["note_id"], r["to_file"], r["from_file"]):
        return {"status": "error", "message": f"The note doesn't show {os.path.basename(r['to_file'])} any more."}
    self.db.execute("UPDATE photo_edits SET restored_at = ? WHERE id = ?", (utc_now_iso(), eid))
    return {"status": "success", "note_id": r["note_id"], "file": r["from_file"], "to": r["to_file"]}


for _n, _f in (("_ph_original", _ph_original), ("_ph_swap", _ph_swap), ("photo_save_edit", photo_save_edit), ("list_photo_edits", list_photo_edits),
               ("restore_photo_edit", restore_photo_edit)):
    setattr(NeuroVaultApi, _n, _f)
# ==== end Build V · R59 editing photos ====
# ==== Build DV · the document viewer (mockup R66): PDF and Word files in their own window, with notes beside the file ====
import docviewer  # noqa: E402
docviewer.install(NeuroVaultApi)
# ==== end Build DV ====
# ==== Build M · QC 107 (feedback: "and also the ability to save as pdf or png or jpg"): a note's mind map saved as a file. The page
# draws the whole map on a canvas (any zoom or pan, at about 2x, or 300 dpi for a PDF) and sends the PNG's bytes; the save dialog starts
# in the note's folder in the vault, named "<note title> – mind map.<ext>" (Windows' own dialog asks before it replaces a file, and
# nothing else here writes over one); Pillow writes the PDF and JPG (on a solid background). Each save is a row in map_exports, for
# the Timeline (list_map_exports). ====
import io  # noqa: E402
MAP_FORMATS = {"pdf": ".pdf", "png": ".png", "jpg": ".jpg"}
MAP_MAX_B64 = 120_000_000   # characters of base64: a 16,000 px map is far below it
MAP_EXPORTS_SCHEMA = """CREATE TABLE IF NOT EXISTS map_exports (
    id       INTEGER PRIMARY KEY AUTOINCREMENT,
    note_id  INTEGER,
    title    TEXT NOT NULL DEFAULT '',
    fmt      TEXT NOT NULL,
    path     TEXT NOT NULL,
    white    INTEGER NOT NULL DEFAULT 0,   -- the "White background (for printing)" choice
    width    INTEGER, height INTEGER,      -- the picture's pixels
    vault    TEXT,
    at       TEXT NOT NULL
)"""


def _map_table(self):
    if not getattr(self, "_map_ready", False):
        self.db.execute(MAP_EXPORTS_SCHEMA)
        self._map_ready = True


def _map_dir(self, row):
    """The note's folder in the vault (where the file goes first), else the vault, else the app's folder."""
    base = getattr(self, "_vroot", None)
    if base and row and row["path"]:
        d = os.path.dirname(os.path.join(base, row["path"]))
        if os.path.isdir(d):
            return d
    return base if base and os.path.isdir(base) else self._att_base()


@safe_action
def save_map_image(self, note_id, fmt, png_b64, white=False, dpi=300):
    """The mind map of a note as a PDF, PNG or JPG file, through the save dialog. png_b64: the map drawn by the page, as PNG (base64,
    a data: URL is fine too). {status: success|cancelled|error, path, name, width, height, size}"""
    fmt = str(fmt or "").lower().lstrip(".")
    if fmt == "jpeg":
        fmt = "jpg"
    if fmt not in MAP_FORMATS:
        return {"status": "error", "message": "Save it as PDF, PNG or JPG."}
    if not isinstance(png_b64, str) or not png_b64 or len(png_b64) > MAP_MAX_B64:
        return {"status": "error", "message": "The map's picture didn't come through: try again."}
    try:
        raw = base64.b64decode(png_b64.split(",", 1)[1] if png_b64.startswith("data:") else png_b64, validate=True)
        from PIL import Image
        img = Image.open(io.BytesIO(raw))
        img.load()
    except Exception as e:
        log.warning("save_map_image: not a picture: %s", e)
        return {"status": "error", "message": "The map's picture didn't come through: try again."}
    nid = _clean_id(note_id)
    row = nid and self.db.query_one("SELECT id, title, path FROM notes WHERE id = ?", (nid,))
    title = (row["title"] if row else "") or "Untitled note"
    name = converters.safe_name(f"{title} – mind map", 120) + MAP_FORMATS[fmt]
    if not self._window:
        return {"status": "error", "message": "Saving a file needs the desktop app."}
    types = {"pdf": ("PDF document (*.pdf)",), "png": ("PNG image (*.png)",), "jpg": ("JPEG image (*.jpg;*.jpeg)",)}[fmt]
    picked = self._window.create_file_dialog(webview.SAVE_DIALOG, directory=_map_dir(self, row), save_filename=name, file_types=types)
    if not picked:
        return {"status": "cancelled"}
    path = picked[0] if isinstance(picked, (list, tuple)) else picked
    if not os.path.splitext(path)[1]:
        path += MAP_FORMATS[fmt]
    part = path + ".part"
    try:
        if fmt == "png":
            img.save(part, "PNG")
        else:
            flat = img.convert("RGBA")
            bg = Image.new("RGB", flat.size, (255, 255, 255) if white else flat.getpixel((0, 0))[:3])   # JPG and PDF: always solid
            bg.paste(flat, mask=flat.split()[3])
            if fmt == "jpg":
                bg.save(part, "JPEG", quality=92, subsampling=0)
            else:
                try:
                    dpi = max(72, min(int(dpi), 600))
                except (TypeError, ValueError):
                    dpi = 300
                bg.save(part, "PDF", resolution=float(dpi))
        os.replace(part, path)
    except OSError as e:
        try:
            os.remove(part)
        except OSError:
            pass
        return {"status": "error", "message": plain_error(e, "save the map")}
    _map_table(self)
    self.db.execute("INSERT INTO map_exports (note_id, title, fmt, path, white, width, height, vault, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
                    (row["id"] if row else None, title, fmt, path, 1 if white else 0, img.width, img.height, getattr(self.db, "vault", None), utc_now_iso()))
    return {"status": "success", "path": path, "name": os.path.basename(path), "width": img.width, "height": img.height, "size": os.path.getsize(path)}


@safe_list(default=[])
def list_map_exports(self, limit=80):
    """For the Timeline: [{id, note_id, title, fmt, path, name, white, at}] in the open vault, newest first."""
    _map_table(self)
    try:
        limit = max(1, min(int(limit), 500))
    except (TypeError, ValueError):
        limit = 80
    return [{"id": r["id"], "note_id": r["note_id"], "title": r["title"], "fmt": r["fmt"], "path": r["path"], "name": os.path.basename(r["path"]),
             "white": bool(r["white"]), "at": r["at"]}
            for r in self.db.query("SELECT * FROM map_exports WHERE vault IS ? ORDER BY id DESC LIMIT ?", (getattr(self.db, "vault", None), limit))]


for _n, _f in (("save_map_image", save_map_image), ("list_map_exports", list_map_exports)):
    setattr(NeuroVaultApi, _n, _f)
# ==== end Build M · QC 107 ====
