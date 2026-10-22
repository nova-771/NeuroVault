"""
Writes a daily markdown note into an Obsidian vault for each logged session.

One file per day (YYYY-MM-DD.md), with YAML frontmatter tracking the day's
total, and a markdown table of sessions that new rows get appended to.
This is independent of the SQLite write in db.py — if the vault path is
missing or unwritable, SQLite is still the source of truth, but every
function here returns (ok, message) so the caller can actually tell the
user what happened instead of it failing silently.

Note: the table header includes Energy/Focus/Type columns. If you have
notes from before this feature existed, new rows will still append fine,
just with more columns than the old rows — Obsidian renders that without
complaint, it just won't look perfectly aligned in raw markdown.
"""
import logging
import os
import re
from datetime import datetime
from errors import plain_error  # v0.1.1 (QC 90): failures in plain words, the detail in the log

log = logging.getLogger(__name__)


def _note_path(vault_path: str, day: str) -> str:
    return os.path.join(vault_path, f"{day}.md")


def _new_note(day: str) -> str:
    return (
        f"---\n"
        f"date: {day}\n"
        f"total_minutes: 0\n"
        f"---\n\n"
        f"# {day} — Time Ledger\n\n"
        f"| Time | Category | Type | Duration | Energy | Focus |\n"
        f"|------|----------|------|----------|--------|-------|\n"
    )


def export_session(
    vault_path: str,
    category_name: str,
    start_dt: datetime,
    end_dt: datetime,
    target_seconds: int,
    actual_seconds: int,
    day_total_minutes: int,
    energy: int = None,
    focus: int = None,
    is_unplanned: bool = False,
    pauses: list = None,
    milestones: list = None,
):
    """Append a session row (+ optional pause/milestone notes) to today's
    note. Returns (ok: bool, message: str)."""
    if not vault_path:
        return False, "No vault path configured."

    try:
        os.makedirs(vault_path, exist_ok=True)
    except OSError as e:
        msg = plain_error(e, f"open the folder {vault_path}")
        log.warning("[vault] %s", msg)
        return False, msg

    day = start_dt.strftime("%Y-%m-%d")
    path = _note_path(vault_path, day)

    try:
        if os.path.exists(path):
            with open(path, "r", encoding="utf-8") as f:
                content = f.read()
        else:
            content = _new_note(day)
    except OSError as e:
        msg = plain_error(e, f"read {path}")
        log.warning("[vault] %s", msg)
        return False, msg

    content = re.sub(r"total_minutes: \d+", f"total_minutes: {day_total_minutes}", content, count=1)

    duration_min = round(actual_seconds / 60)
    overtime_min = 0 if is_unplanned else round(max(0, actual_seconds - target_seconds) / 60)
    dur_label = f"{duration_min}m" + (f" (+{overtime_min}m over)" if overtime_min > 0 else "")
    pause_seconds = sum(p.get("duration_seconds", 0) for p in (pauses or []))
    if pause_seconds > 0:
        dur_label += f" · {round(pause_seconds/60)}m paused"
    type_label = "Unplanned" if is_unplanned else "Planned"
    energy_label = str(energy) if energy is not None else "—"
    focus_label = str(focus) if focus is not None else "—"

    row = (
        f"| {start_dt.strftime('%H:%M')}–{end_dt.strftime('%H:%M')} "
        f"| {category_name} | {type_label} | {dur_label} | {energy_label} | {focus_label} |\n"
    )
    content += row

    for m in (milestones or []):
        content += f"  - {m.get('time_label', '')} — {m.get('note', '')}\n"

    try:
        with open(path, "w", encoding="utf-8") as f:
            f.write(content)
    except OSError as e:
        msg = plain_error(e, f"write {path}")
        log.warning("[vault] %s", msg)
        return False, msg

    return True, f"Written to {path}"


def test_connection(vault_path: str):
    """Writes a small standalone test file (not a real session row) so
    Settings can confirm the vault path actually works. Returns (ok, message)."""
    if not vault_path:
        return False, "No vault path set."

    try:
        os.makedirs(vault_path, exist_ok=True)
    except OSError as e:
        return False, plain_error(e, "open the folder")

    test_path = os.path.join(vault_path, "_time-tracker-test.md")
    try:
        with open(test_path, "w", encoding="utf-8") as f:
            f.write(f"Time Tracker connection test — {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}\n")
    except OSError as e:
        return False, plain_error(e, "write a test file there")

    return True, f"Wrote a test file to {test_path}"
