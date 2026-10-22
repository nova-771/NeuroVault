"""
One-off migration: folds time-tracker's categories/sessions/pauses/milestones
into NeuroVault's unified neurovault.db, mapping each time-tracker
category onto a NeuroVault project of the same name (creating one if it
doesn't already exist). Safe to run more than once — categories are
matched by name (INSERT OR IGNORE) and sessions/pauses/milestones are only
copied if the target neurovault.db doesn't already have a session with
that id, so a second run is a no-op rather than a duplicate import.

Usage:
    python migrate_time_tracker.py [path/to/timetracker.db]

Defaults to ../time-tracker/data/timetracker.db relative to this file,
which is where the source project sits as of this migration.
"""
import os
import shutil
import sqlite3
import sys
from datetime import datetime

from db import Database, utc_now_iso
from utils import app_dir

DEFAULT_SOURCE = os.path.join(app_dir(), "..", "time-tracker", "data", "timetracker.db")
TARGET_DB = os.path.join(app_dir(), "neurovault.db")


def backup(path):
    if not os.path.exists(path):
        return None
    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    backup_path = f"{path}.{stamp}.bak"
    shutil.copy2(path, backup_path)
    print(f"Backed up {path} -> {backup_path}")
    return backup_path


def main():
    source_path = sys.argv[1] if len(sys.argv) > 1 else DEFAULT_SOURCE
    source_path = os.path.abspath(source_path)
    if not os.path.exists(source_path):
        print(f"No time-tracker DB found at {source_path} — nothing to migrate.")
        return

    backup(source_path)
    backup(TARGET_DB)

    # Applying the unified schema is additive/idempotent — safe on the live DB.
    target = Database(TARGET_DB)

    src_conn = sqlite3.connect(source_path)
    src_conn.row_factory = sqlite3.Row

    categories = src_conn.execute("SELECT * FROM categories").fetchall()
    sessions = src_conn.execute("SELECT * FROM sessions").fetchall()
    pauses = src_conn.execute("SELECT * FROM pauses").fetchall()
    milestones = src_conn.execute("SELECT * FROM milestones").fetchall()
    src_conn.close()

    # 1. categories -> projects (matched/created by name)
    category_to_project = {}
    projects_created = 0
    now = utc_now_iso()
    for c in categories:
        row = target.query_one("SELECT id FROM projects WHERE name = ? COLLATE NOCASE", (c["name"],))
        if row:
            category_to_project[c["id"]] = row["id"]
        else:
            cur = target.execute(
                """INSERT INTO projects (name, description, color, icon, archived, created_at, updated_at)
                   VALUES (?, '', ?, '', 0, ?, ?)""",
                (c["name"], c["color"], now, now),
            )
            category_to_project[c["id"]] = cur.lastrowid
            projects_created += 1

    # 2. sessions (id preserved so pauses/milestones' session_id stays valid)
    sessions_copied = 0
    for s in sessions:
        if target.query_one("SELECT 1 FROM sessions WHERE id = ?", (s["id"],)):
            continue  # already migrated
        project_id = category_to_project.get(s["category_id"])
        target.execute(
            """INSERT INTO sessions
               (id, project_id, start_time, end_time, target_seconds, actual_seconds,
                overtime_seconds, energy, focus, is_unplanned, created_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (s["id"], project_id, s["start_time"], s["end_time"], s["target_seconds"],
             s["actual_seconds"], s["overtime_seconds"], s["energy"], s["focus"],
             s["is_unplanned"], s["created_at"]),
        )
        sessions_copied += 1

    # 3. pauses / milestones (straight copy, ids preserved)
    pauses_copied = 0
    for p in pauses:
        if target.query_one("SELECT 1 FROM pauses WHERE id = ?", (p["id"],)):
            continue
        target.execute(
            """INSERT INTO pauses (id, session_id, category, start_time, end_time, duration_seconds)
               VALUES (?, ?, ?, ?, ?, ?)""",
            (p["id"], p["session_id"], p["category"], p["start_time"], p["end_time"], p["duration_seconds"]),
        )
        pauses_copied += 1

    milestones_copied = 0
    for m in milestones:
        if target.query_one("SELECT 1 FROM milestones WHERE id = ?", (m["id"],)):
            continue
        target.execute(
            "INSERT INTO milestones (id, session_id, note, at_time, elapsed_seconds) VALUES (?, ?, ?, ?, ?)",
            (m["id"], m["session_id"], m["note"], m["at_time"], m["elapsed_seconds"]),
        )
        milestones_copied += 1

    target.close()

    print(f"Projects created from categories: {projects_created} (of {len(categories)} categories)")
    print(f"Sessions copied: {sessions_copied} (of {len(sessions)} in source)")
    print(f"Pauses copied: {pauses_copied} (of {len(pauses)} in source)")
    print(f"Milestones copied: {milestones_copied} (of {len(milestones)} in source)")
    print("Done.")


if __name__ == "__main__":
    main()
