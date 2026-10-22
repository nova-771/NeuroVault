"""R68 · keep a project, a folder or a note off cloud AI.

The user (R68, 2026-10-19): "execute on them". Projects, folders and notes can each be locked. A locked item, and everything
inside it, is never sent to a cloud model: Ask says so and offers (Use local AI / Unlock for this question), Summarise and
Tidy up use a model on this PC, the model menu marks cloud models as unavailable there, and attachments never go.

Where it lives: <vault>/.neurovault/ai-lock.json, so a lock travels with the vault. It is keyed by the item's path inside
the vault (a project is its top-level folder). Each entry also carries this install's id for the item, so a rename or a
move inside NeuroVault keeps the lock. The file also keeps the projects already asked about (the first-use question) and a
short log that the Timeline lists.

    is_cloud_locked(note_id_or_path) -> bool      the one question the rest of the app (and the Agent) asks
    AiLock.bind(api)                              the app's NeuroVaultApi, once, so ids and paths can be looked up

The backend refuses locked content at the cloud send (local_ai.Manager._cloud_run), not only in the page.
"""
import hashlib
import json
import logging
import os
import re
import threading
import time

log = logging.getLogger(__name__)

FILE = os.path.join(".neurovault", "ai-lock.json")
KINDS = ("project", "folder", "note")
LOG_KEEP = 200


def _now():
    return time.strftime("%Y-%m-%dT%H:%M:%S", time.localtime())


def _key(path):
    return str(path or "").replace("\\", "/").strip("/").lower()


class AiLock:
    def __init__(self):
        self._api = None
        self._mu = threading.RLock()
        self._file = None        # the file read last, so a changed vault re-reads
        self._data = None
        self._once = {}          # R69: note id -> until when "Send once" holds
        self._once_proj = {}     # QC 117: project key -> until when "Send once" holds

    # ---- the app ----
    def bind(self, api):
        with self._mu:
            self._api, self._data, self._file = api, None, None

    def _db(self):
        return self._api.db if self._api is not None else None

    def _install(self):
        db = self._db()
        return hashlib.sha1(os.path.abspath(db.path).lower().encode("utf-8")).hexdigest()[:10] if db is not None and db.path != ":memory:" else "memory"

    def _path(self):
        if self._api is None:
            return None
        return os.path.join(self._api._att_base(), FILE)

    # ---- the file ----
    def _load(self):
        p = self._path()
        with self._mu:
            if self._data is not None and self._file == p:
                return self._data
            data = {"version": 1, "locked": [], "asked": [], "log": [], "outside": [], "outside_ok": []}
            try:
                if p and os.path.isfile(p):
                    with open(p, encoding="utf-8") as f:
                        raw = json.load(f)
                    if isinstance(raw, dict):
                        data["locked"] = [e for e in raw.get("locked", []) if isinstance(e, dict) and e.get("kind") in KINDS and (e.get("path") or e.get("ids"))]
                        data["asked"] = [str(a) for a in raw.get("asked", []) if a]
                        data["log"] = [e for e in raw.get("log", []) if isinstance(e, dict)][-LOG_KEEP:]
                        data["outside"] = [e for e in raw.get("outside", []) if isinstance(e, dict) and (e.get("path") or e.get("ids"))]   # R69
                        data["outside_ok"] = [str(a) for a in raw.get("outside_ok", []) if a]
            except (OSError, ValueError):
                log.exception("couldn't read %s", p)
            self._data, self._file = data, p
            return data

    def _save(self):
        p = self._path()
        if not p:
            return False
        if getattr(self._api, "_vclash", None):   # QC 86: another install's vault, not answered yet: nothing is written there
            return False
        tmp = p + ".tmp"
        try:
            os.makedirs(os.path.dirname(p), exist_ok=True)
            with open(tmp, "w", encoding="utf-8") as f:
                json.dump(self._data, f, indent=1)
            os.replace(tmp, p)
            return True
        except OSError:
            log.exception("couldn't write %s", p)
            return False

    # ---- what an id or a path is, in this install ----
    def _rel(self, kind, ident):
        """The vault path of a project, folder or note (None when it has none yet)."""
        api, db = self._api, self._db()
        try:
            if kind == "note":
                r = db.query_one("SELECT path FROM notes WHERE id = ?", (ident,))
                return (r["path"] or None) if r else None
            if kind == "project":
                return api._vf_folder_rel(None, ident) or None
            return api._vf_folder_rel(ident) or None
        except Exception:
            log.exception("ai-lock: path of %s %s", kind, ident)
            return None

    def _name(self, kind, ident, fallback=""):
        db = self._db()
        try:
            if kind == "note":
                r = db.query_one("SELECT title FROM notes WHERE id = ?", (ident,))
                return (r["title"] if r else None) or fallback
            if kind == "project":
                r = db.query_one("SELECT name FROM projects WHERE id = ?", (ident,))
                return (r["name"] if r else None) or fallback
            r = db.query_one("SELECT name FROM folders WHERE id = ?", (ident,))
            return (r["name"] if r else None) or fallback
        except Exception:
            return fallback

    def _exists(self, kind, ident):
        db = self._db()
        t = {"note": "notes", "project": "projects", "folder": "folders"}[kind]
        return bool(ident) and db.query_one(f"SELECT 1 FROM {t} WHERE id = ?", (ident,)) is not None

    def _id_of_path(self, kind, path):
        """This install's id for a path inside the vault, or None."""
        db, k = self._db(), _key(path)
        if not k:
            return None
        try:
            if kind == "note":
                for r in db.query("SELECT id, path FROM notes WHERE vault IS ? AND path IS NOT NULL", (db.vault,)):
                    if _key(r["path"]) == k:
                        return r["id"]
                return None
            if kind == "project":
                for r in db.query("SELECT id FROM projects"):
                    if _key(self._api._vf_folder_rel(None, r["id"])) == k:
                        return r["id"]
                return None
            for r in db.query("SELECT id FROM folders WHERE vault IS ?", (db.vault,)):
                if _key(self._api._vf_folder_rel(r["id"])) == k:
                    return r["id"]
        except Exception:
            log.exception("ai-lock: id of %s", path)
        return None

    def _reconcile(self, data):
        """Follows renames and moves: an entry whose item is known here takes the item's current path; one whose path is known
        (a vault from another install) learns this install's id. Returns True when something changed."""
        changed, me = False, self._install()
        for e in data["locked"]:
            ids = e.setdefault("ids", {})
            ident = ids.get(me)
            if ident and not self._exists(e["kind"], ident):
                ids.pop(me, None)
                ident = None
            if ident:
                now = self._rel(e["kind"], ident)
                if now and _key(now) != _key(e.get("path")):
                    e["path"], changed = now, True
                nm = self._name(e["kind"], ident, e.get("name", ""))
                if nm and nm != e.get("name"):
                    e["name"], changed = nm, True
            elif e.get("path"):
                found = self._id_of_path(e["kind"], e["path"])
                if found:
                    ids[me], changed = found, True
        return changed

    # ---- the question ----
    def _entries(self):
        data = self._load()
        with self._mu:
            if self._reconcile(data):
                self._save()
        return data["locked"]

    def _chain(self, nid):
        """[(kind, id)] for a note and everything above it: the note, its folders, its project."""
        db = self._db()
        n = db.query_one("SELECT id, path, folder_id, project_id FROM notes WHERE id = ?", (nid,))
        if not n:
            return None, []
        chain, fid, pid = [("note", n["id"])], n["folder_id"], n["project_id"]
        seen = set()
        while fid and fid not in seen:
            seen.add(fid)
            f = db.query_one("SELECT id, parent_id, project_id FROM folders WHERE id = ?", (fid,))
            if not f:
                break
            chain.append(("folder", f["id"]))
            pid = f["project_id"] or pid
            fid = f["parent_id"]
        if pid:
            chain.append(("project", pid))
        return n, chain

    def which(self, ref):
        """The entry that keeps a note off cloud AI ({kind, name, path, ...}), or None. ref: a note id, or a path in the vault
        (relative to it, or absolute)."""
        if self._api is None or ref is None or ref == "":
            return None
        entries = self._entries()
        if not entries:
            return None
        me = self._install()
        nid, path = None, None
        if isinstance(ref, bool):
            return None
        if isinstance(ref, int) or (isinstance(ref, str) and ref.strip().isdigit()):
            nid = int(ref)
        else:
            path = str(ref).replace("\\", "/")
            root = (getattr(self._api, "_vroot", None) or "").replace("\\", "/").rstrip("/")
            if root and path.lower().startswith(root.lower() + "/"):
                path = path[len(root) + 1:]
            nid = self._id_of_path("note", path)
        n, chain = self._chain(nid) if nid else (None, [])
        npath = _key((n["path"] if n else None) or path)
        for e in entries:
            if e["kind"] == "note":
                if (nid and e.get("ids", {}).get(me) == nid) or (npath and _key(e.get("path")) == npath):
                    return e
                continue
            if any(k == e["kind"] and e.get("ids", {}).get(me) == i for k, i in chain):
                return e
            ep = _key(e.get("path"))
            if ep and npath and (npath == ep or npath.startswith(ep + "/")):
                return e
        return None

    def is_locked(self, ref):
        return self.which(ref) is not None

    # ---- setting it ----
    def label(self, entry, short=False):
        """"This note" / "Engineering" etc., for the notice the page shows."""
        nm = entry.get("name") or "it"
        return {"note": "This note", "folder": f"The {nm} folder", "project": nm}[entry["kind"]] if not short else nm

    def lock(self, kind, ident, source="menu"):
        if kind not in KINDS or not self._exists(kind, ident):
            return None
        data = self._load()
        me, name = self._install(), self._name(kind, ident)
        with self._mu:
            for e in data["locked"]:
                if e["kind"] == kind and e.get("ids", {}).get(me) == ident:
                    return e
            e = {"kind": kind, "path": self._rel(kind, ident), "name": name, "ids": {me: ident}, "since": _now()}
            data["locked"].append(e)
            self._log(data, "lock", e, source)
            self._save()
            return e

    def unlock(self, kind, ident, source="menu"):
        data, me = self._load(), self._install()
        with self._mu:
            self._reconcile(data)
            keep, gone = [], None
            for e in data["locked"]:
                if e["kind"] == kind and e.get("ids", {}).get(me) == ident:
                    gone = e
                else:
                    keep.append(e)
            if not gone:
                return False
            data["locked"] = keep
            self._log(data, "allow", gone, source)
            self._save()
            return True

    def clear(self, source="settings"):
        data = self._load()
        with self._mu:
            data["outside_ok"] = []   # R69: "Always allow" for outside notes goes too
            for e in list(data["locked"]):
                self._log(data, "allow", e, source)
            data["locked"] = []
            self._save()

    def _log(self, data, action, e, source=""):
        data["log"].append({"at": _now(), "action": action, "kind": e["kind"], "name": e.get("name", ""), "path": e.get("path") or "", "source": source})
        del data["log"][:-LOG_KEEP]

    def changes(self, limit=80):
        """The Timeline's rows, newest first: [{id, at, action, kind, name, path}]."""
        data = self._load()
        rows = [dict(r, id=i) for i, r in enumerate(data["log"])]
        return list(reversed(rows))[:max(1, int(limit))]

    # ---- the first-use question ----
    def project_of(self, nid):
        """(key, name) of the project a note sits in; ("", "this vault") for a note at the vault's top."""
        n, chain = self._chain(nid) if nid else (None, [])
        for k, i in chain:
            if k == "project":
                return f"project:{i}", self._name("project", i)
        return "", ""

    def asked(self, key):
        if not key:
            return True
        if self._once_proj.get(key.lower(), 0) > time.time():   # QC 117: "Send once" in the Agent's card
            return True
        data = self._load()
        return key.lower() in [a.lower() for a in data["asked"]] or self._asked_name(key) in data["asked"]

    def _asked_name(self, key):
        kind, _, ident = key.partition(":")
        try:
            rel = self._rel(kind, int(ident))
        except ValueError:
            rel = None
        return "name:" + _key(rel) if rel else key

    def allow_project_once(self, key):
        """QC 117: the first-use question answered "once": for OUTSIDE_ONCE_SECS, in memory (the project is asked about again later)."""
        self._once_proj[str(key).lower()] = time.time() + self.OUTSIDE_ONCE_SECS
        return True

    def mark_asked(self, key):
        data = self._load()
        with self._mu:
            for k in {key, self._asked_name(key)}:
                if k and k not in data["asked"]:
                    data["asked"].append(k)
            self._save()

    # ==== R69 · notes that came from outside (decided 2026-10-20) ====
    # A note from the web ("From the web": front matter with source: / url: / clipped:, or in a folder called Clippings) or
    # one made from someone else's file ("Imported": a converted PDF, Word or Excel file, or an opened .md / .txt) can hold
    # text written to the AI. Before a cloud model reads one, the first time, the user is asked: Send once / Keep on this PC /
    # Always allow for this project. A model on this PC reads it as usual. "Always" is kept in this file (outside_ok);
    # "once" lasts OUTSIDE_ONCE_SECS, in memory.
    OUTSIDE_ONCE_SECS = 900
    _FM = re.compile(r"\A﻿?---[ \t]*\r?\n(.*?)\r?\n---[ \t]*(?:\r?\n|\Z)", re.S)
    _FM_SOURCE = re.compile(r"^(?:source|url|clipped|clipped[_-]?from|original[_-]?url|source[_-]?url)[ \t]*:[ \t]*\S", re.I | re.M)

    def _note_ref(self, ref):
        """(note id or None, vault path key or "") for a note id or a path in the vault."""
        if self._api is None or ref is None or ref == "" or isinstance(ref, bool):
            return None, ""
        if isinstance(ref, int) or (isinstance(ref, str) and ref.strip().isdigit()):
            nid = int(ref)
            n = self._db().query_one("SELECT path FROM notes WHERE id = ?", (nid,))
            return nid, (_key(n["path"]) if n else "")
        path = str(ref).replace("\\", "/")
        root = (getattr(self._api, "_vroot", None) or "").replace("\\", "/").rstrip("/")
        if root and path.lower().startswith(root.lower() + "/"):
            path = path[len(root) + 1:]
        return self._id_of_path("note", path), _key(path)

    def outside(self, ref):
        """"web", "imported" or "" for a note (an id or a vault path): where its words came from."""
        try:
            nid, pkey = self._note_ref(ref)
            if not nid:
                return ""
            row = self._db().query_one("SELECT content, path FROM notes WHERE id = ?", (nid,))
            if not row:
                return ""
            me, pkey = self._install(), pkey or _key(row["path"])
            m = self._FM.match(row["content"] or "")
            if m and self._FM_SOURCE.search(m.group(1)):
                return "web"
            if pkey.split("/", 1)[0] == "clippings" and "/" in pkey:
                return "web"
            _n, chain = self._chain(nid)
            if any(k != "note" and self._name(k, i).strip().lower() == "clippings" for k, i in chain):
                return "web"
            for e in self._load()["outside"]:
                if e.get("ids", {}).get(me) == nid or (pkey and _key(e.get("path")) == pkey):
                    return e.get("origin") or "imported"
        except Exception:
            log.exception("ai-lock: outside(%r)", ref)
        return ""

    def mark_outside(self, nid, origin="imported"):
        """A note made from someone else's file: its words are 'from outside' from now on."""
        if self._api is None or not nid or not self._exists("note", nid):
            return False
        data, me = self._load(), self._install()
        with self._mu:
            for e in data["outside"]:
                if e.get("ids", {}).get(me) == nid:
                    return True
            data["outside"].append({"path": self._rel("note", nid), "ids": {me: nid}, "origin": origin, "since": _now()})
            self._save()
        return True

    def outside_key(self, nid):
        """(key, name): the project the note sits in, else the note itself: what 'Always allow' is kept for."""
        key, name = self.project_of(nid)
        if key:
            return key, name
        return f"note:{nid}", self._name("note", nid, "this note")

    def outside_allowed(self, nid):
        """True once the user has said Send once (a while ago at most) or Always allow for this note's project."""
        try:
            nid = int(nid)
            if self._once.get(nid, 0) > time.time():
                return True
            key, _name = self.outside_key(nid)
            ok = self._load()["outside_ok"]
            return key.lower() in [a.lower() for a in ok] or self._asked_name(key) in ok
        except Exception:
            log.exception("ai-lock: outside_allowed(%r)", nid)
            return False

    def allow_outside(self, nid, how):
        """how: "once" (for a while, in memory) or "always" (this note's project, kept in the vault)."""
        nid = int(nid)
        if how == "once":
            self._once[nid] = time.time() + self.OUTSIDE_ONCE_SECS
            return True
        key, _name = self.outside_key(nid)
        data = self._load()
        with self._mu:
            for k in {key, self._asked_name(key)}:
                if k and k not in data["outside_ok"]:
                    data["outside_ok"].append(k)
            self._save()
        return True

    def outside_notes(self):
        """[{id, origin}] for every note in this vault that came from outside (the page's chips)."""
        db, out = self._db(), {}
        if db is None:
            return []
        try:
            me, data = self._install(), self._load()
            for e in data["outside"]:
                i = e.get("ids", {}).get(me) or self._id_of_path("note", e.get("path"))
                if i:
                    out[i] = e.get("origin") or "imported"
            for r in db.query("SELECT id FROM notes WHERE vault IS ? AND (substr(content, 1, 3) = '---' OR substr(content, 1, 4) = ? OR lower(path) LIKE 'clippings/%')", (db.vault, "﻿---")):
                if r["id"] not in out:
                    o = self.outside(r["id"])
                    if o:
                        out[r["id"]] = o
            for f in db.query("SELECT id FROM folders WHERE vault IS ? AND lower(name) = 'clippings'", (db.vault,)):
                for n in db.query("SELECT id FROM notes WHERE vault IS ? AND folder_id = ?", (db.vault, f["id"])):
                    out.setdefault(n["id"], "web")
        except Exception:
            log.exception("ai-lock: outside_notes")
        return [{"id": i, "origin": o} for i, o in sorted(out.items())]
    # ==== end R69 ====

    # ---- what the page shows ----
    def status(self):
        """{items, notes, folders, projects}: items are the entries (each with this install's id); notes, folders and projects
        are every id that is off cloud AI, directly or by what it sits in."""
        if self._api is None:
            return {"items": [], "notes": [], "folders": [], "projects": [], "outside": []}
        entries = self._entries()
        db, me = self._db(), self._install()
        items = [{"kind": e["kind"], "id": e.get("ids", {}).get(me), "name": e.get("name", ""), "path": e.get("path") or "", "since": e.get("since", "")} for e in entries]
        notes, folders, projects = set(), set(), set()
        for it in items:
            if it["id"]:
                {"note": notes, "folder": folders, "project": projects}[it["kind"]].add(it["id"])
        if items:
            for f in db.query("SELECT id, parent_id, project_id FROM folders WHERE vault IS ?", (db.vault,)):
                fid, seen = f["id"], set()
                while fid and fid not in seen:
                    seen.add(fid)
                    if fid in folders:
                        folders.add(f["id"])
                        break
                    r = db.query_one("SELECT parent_id FROM folders WHERE id = ?", (fid,))
                    fid = r["parent_id"] if r else None
                if f["project_id"] in projects:
                    folders.add(f["id"])
            for n in db.query("SELECT id, folder_id, project_id FROM notes WHERE vault IS ?", (db.vault,)):
                if n["id"] in notes or n["folder_id"] in folders or n["project_id"] in projects:
                    notes.add(n["id"])
        return {"items": items, "notes": sorted(notes), "folders": sorted(folders), "projects": sorted(projects), "outside": self.outside_notes()}


_LOCK = AiLock()


def instance():
    return _LOCK


def is_cloud_locked(note_id_or_path):
    """True when the note (an id, or a path in the vault) is kept off cloud AI, itself or by a folder or project above it."""
    try:
        return _LOCK.is_locked(note_id_or_path)
    except Exception:
        log.exception("is_cloud_locked(%r) failed: treated as locked", note_id_or_path)
        return True   # when in doubt, nothing is sent


def outside_origin(note_id_or_path):
    """R69: "web", "imported" or "" for a note: did its words come from outside?"""
    try:
        return _LOCK.outside(note_id_or_path)
    except Exception:
        log.exception("outside_origin(%r) failed", note_id_or_path)
        return ""


def outside_allowed(note_id):
    """R69: True when a cloud model may read this outside note (Send once, or Always allow for its project)."""
    return _LOCK.outside_allowed(note_id)
