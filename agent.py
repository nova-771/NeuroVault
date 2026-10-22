"""
agent.py — Build N, R67: the Agent, a small tool loop of our own on the chat we already have (agent-harness-options.md).

Feedback: "Can we add an opensource agentic harness? A basic one with limited functions". Their R67 answers: it's called Agent,
it's off by default (Settings → AI models → Jobs and answers), and it lives in the Ask chat as a third choice beside This note and
My newest notes. Nothing new is installed: every model call is local_ai.Ai.run("qa"), so the model picked for Ask, each company's
own rules, the limits and the first-use yes all apply as they do for Ask.

Seven tools (five from R67; add_tags and link_notes added with the user's yes), each a thin wrapper over the app's own API,
and nothing else the model can reach:
    search_notes(query)            reads: titles, folders and a line of each (at most 8), this vault only
    read_note(note)                reads: one note's text, cut at 12,000 characters
    summarise_note(note)           reads: a summary, by the same model
    create_task(title, due?, note?)   writes: a task in Tasks, linked to its note
    append_to_note(note, text)     writes: text added to the end of a note
    add_tags(note, tags)           writes: tags added to a note (never removed; those it has already are skipped)
    link_notes(from_note, to_note, where?)   writes: a [[to_note]] link in from_note: where it names to_note, else on a
                                   "Related:" line at its end; only notes that exist; no other text changes
Every write waits for Add / Edit / Skip in the chat; a run nobody confirms changes nothing; Undo all takes the run's changes out.
R69 (prompt-injection safety): what a note says is data, never instructions: every note,
search line and summary goes back to the model between random <<<DATA-… lines, cleaned of invisible characters. A card says which
notes the run had read ("After reading: …") and turns amber, with a line saying why, when one of them seems to talk to an AI, when the
change is for a note the request didn't name (and the run read something from outside or suspicious), or when a web address was left
out of what it wanted to write. After two Skips it stops proposing. Add stays one click.
QC 117 (trial feedback: "what am I even being asked"): R68's one-time question, and R69's for a note from outside, are asked in a card
in the run itself (Send once / Always allow for this project / Keep it on this PC): the run carries on after the answer, and Keep stops it
in plain words. A Read step never claims a send that didn't happen: it says "not sent yet" until the model call that carries it has been
made. The Agent has no web tool: asked to open a link or a site, it says so at once and in its answer, and says what to do instead.
At most 8 steps (tool calls) and 3 changes a request; Carry on gives 8 more steps. No code is run, no file outside the vault is
touched, nothing is deleted, and nothing goes on the network but the model call itself.

The model calls the tools natively (OpenAI `tools`) where its server takes them, and otherwise writes one JSON object per turn
(the strict fallback); a malformed call gets one retry. With a cloud model every note it reads goes to that company and each
step says so; notes kept off cloud AI (R68, ai_lock.is_cloud_locked) are skipped and the step says that too.
"""
import datetime
import json
import logging
import re
import threading
import time
import uuid

import ai_guard   # R69: notes go to the model fenced as data; what it proposes is checked
import local_ai
from errors import plain_error

try:   # R68 is built alongside: without it, nothing is locked
    from ai_lock import is_cloud_locked
except Exception:   # noqa: BLE001 - any import problem means "no locks yet"
    def is_cloud_locked(_note):
        return False

try:
    import ai_lock as _lk
except Exception:   # noqa: BLE001
    _lk = None

try:   # R69: a note from the web or an imported file is asked about before a cloud model reads it
    from ai_lock import outside_origin, outside_allowed
except Exception:   # noqa: BLE001
    def outside_origin(_note):
        return ""

    def outside_allowed(_note):
        return True

log = logging.getLogger(__name__)

MAX_STEPS = 8          # tool calls a request (Carry on gives 8 more)
MAX_WRITES = 3         # changes a request
READ_CHARS = 12000     # read_note gives at most this much of a note
SEARCH_MAX = 8         # search_notes gives at most this many notes
REPLY_TOKENS = 900     # each turn of the model
KEEP_RUNS = 20
TOOLS = ("search_notes", "read_note", "summarise_note", "create_task", "append_to_note", "add_tags", "link_notes")
WRITES = ("create_task", "append_to_note", "add_tags", "link_notes")
LOCAL_TOOLS = ("qwen35-4b", "qwen35-9b", "phi4-mini")   # on this PC: the models that call tools well enough (not 0.8B or 2B)

_NOTE = {"type": "string", "description": "The note's title (or its number)."}
TOOL_DEFS = {
    "search_notes": {"description": "Find the user's notes by words. Gives up to 8 notes: title, folder and a matching line.",
                     "parameters": {"type": "object", "properties": {"query": {"type": "string", "description": "A word or a few words to look for."}}, "required": ["query"]}},
    "read_note": {"description": "Read one note's text (up to 12,000 characters).",
                  "parameters": {"type": "object", "properties": {"note": _NOTE}, "required": ["note"]}},
    "summarise_note": {"description": "A short summary of one note.",
                       "parameters": {"type": "object", "properties": {"note": _NOTE}, "required": ["note"]}},
    "create_task": {"description": "Add a task to the user's Tasks (the user is asked first). Fill in only what the user said: priority and energy "
                                   "from their words (\"high prio\" → High, \"low energy\" → low), a due date only if they gave a day or a date, never one "
                                   "you made up.",
                    "parameters": {"type": "object", "properties": {
                        "title": {"type": "string", "description": "What to do, as a short task."},
                        "priority": {"type": "string", "enum": ["Low", "Medium", "High", "Critical"], "description": "How important: only if the user said (\"high prio\", \"urgent\")."},
                        "energy": {"type": "string", "enum": ["low", "medium", "high"], "description": "How much energy it takes: only if the user said (\"low energy\")."},
                        "due": {"type": "string", "description": "YYYY-MM-DD, only when the user gave a day or a date. Otherwise leave it out."},
                        "project": {"type": "string", "description": "The project it belongs to, by name, if the user said."},
                        "note": _NOTE,
                        "steps": {"type": "array", "items": {"type": "string"}, "description": "Small steps, if the user asked for them (at most 10)."}},
                        "required": ["title"]}},
    "add_tags": {"description": "Add tags to a note (the user is asked first). Never removes a tag; tags it has already are skipped.",
                 "parameters": {"type": "object", "properties": {"note": _NOTE, "tags": {"type": "array", "items": {"type": "string"}, "description": "Tags, without the #."}}, "required": ["note", "tags"]}},
    "link_notes": {"description": "Link one note to another with a [[wikilink]] (the user is asked first): where from_note names to_note, else on a \"Related:\" line at its end. Both notes must exist.",
                   "parameters": {"type": "object", "properties": {"from_note": {"type": "string", "description": "The note the link goes in (its title or number)."},
                                                                  "to_note": {"type": "string", "description": "The note it links to (its title or number)."},
                                                                  "where": {"type": "string", "enum": ["mention", "related"], "description": "mention: where from_note names it; related: on the Related line."}},
                                  "required": ["from_note", "to_note"]}},
    "append_to_note": {"description": "Add text to the end of a note (the user is asked first). Never repeats what the note already says.",
                       "parameters": {"type": "object", "properties": {"note": _NOTE, "text": {"type": "string", "description": "The Markdown to add."}}, "required": ["note", "text"]}},
}


def tool_defs(enabled):
    return [{"type": "function", "function": {"name": k, **TOOL_DEFS[k]}} for k in TOOLS if k in enabled]


def can_use_tools(route):
    """(True, "") or (False, why) for the model that answers Ask."""
    kind = (route or {}).get("kind")
    if kind == "none" or not kind:
        return False, "No model is set up for Ask yet. Settings → AI models."
    if kind == "local" and route.get("model") not in LOCAL_TOOLS:
        name = route.get("name") or route.get("model") or "This model"
        return False, f"{name} can’t use tools reliably, so the Agent can’t work with it."
    return True, ""


def _system(enabled, native, today, here):
    rules = ai_guard.DATA_RULE.strip() + " " + ("You are NeuroVault's Agent. You help the user with their own notes and tasks, using only the tools listed. "
             "Search before you read; read a note before you quote it or add to it. Each change (a task, tags, a link between notes, or text "
             "added to a note) is "
             "shown to the user first, who can say no: never ask for the same change twice. At most 8 tool calls and 3 changes. "
             "You can't delete anything, change settings, open files or reach the internet. When you're done, answer in a few plain "
             "sentences: what you found, and what you changed. Write in the user's language. " + f"Today is {today}." + here)
    if native:
        return rules
    lines = "\n".join(f"- {k}({', '.join(TOOL_DEFS[k]['parameters']['properties'])}): {TOOL_DEFS[k]['description']}" for k in TOOLS if k in enabled)
    return (rules + "\n\nTools:\n" + lines + "\n\nReply with exactly one JSON object and nothing else. To use a tool: "
            '{"tool": "search_notes", "args": {"query": "audit"}}. When you are done: {"answer": "your answer to the user"}.')


_FENCE = re.compile(r"```(?:json)?\s*(\{.*?\})\s*```", re.S)
_TAG = re.compile(r"<tool_call>\s*(\{.*?\})\s*</tool_call>", re.S)


def parse_text_call(text):
    """A tool call written in the text (the fallback, or a small model that put it in content): (name, args), ("answer", text),
    or None when there's no JSON object to read."""
    t = (text or "").strip()
    if not t:
        return None
    blobs = [m.group(1) for m in _TAG.finditer(t)] + [m.group(1) for m in _FENCE.finditer(t)]
    if t.startswith("{") and t.endswith("}"):
        blobs.append(t)
    for b in blobs:
        try:
            o = json.loads(b)
        except ValueError:
            continue
        if not isinstance(o, dict):
            continue
        if isinstance(o.get("answer"), str):
            return "answer", o["answer"]
        name = o.get("tool") or o.get("name") or (o.get("function") or {}).get("name")
        args = o.get("args", o.get("arguments", o.get("parameters", (o.get("function") or {}).get("arguments", {}))))
        if isinstance(args, str):
            try:
                args = json.loads(args or "{}")
            except ValueError:
                return name, None
        if isinstance(name, str):
            return name, args if isinstance(args, dict) else None
    return None


class Stop(Exception):
    pass


class Kept(Exception):
    """QC 117: the user chose "Keep it on this PC" for a project mid-run: the run ends in these words, nothing sent."""


# QC 117: asked to open a link or a site: the Agent has no web tool (right), and says so plainly instead of guessing
_WEB = re.compile(r"https?://|\bwww\.|\b(?:open|visit|browse|go to|follow|click|check|read|look at|fetch|load|search|google|look up)\b[^.?!\n]{0,40}"
                  r"\b(?:links?|urls?|web ?sites?|web ?pages?|sites?|online|internet|the web)\b", re.I)
_JOB = re.compile(r"job\s*(?:ad|advert|post(?:ing)?|description|listing)|vacancy", re.I)
_SAID_NO_WEB = re.compile(r"\b(?:can[’']?t|cannot|can not|unable to|don[’']?t have|no)\b[^.\n]{0,30}\b(?:open|visit|browse|access|reach|web|internet|links?)\b", re.I)


def web_note(question):
    """"" when the request doesn't need the web; else the plain sentence the Agent says (QC 117)."""
    if not _WEB.search(question or ""):
        return ""
    what = "job ad’s" if _JOB.search(question) else "page’s"
    return f"I can’t open web links or websites: I only work with your notes. Paste the {what} text into the note and ask again."


class AgentRun:
    def __init__(self, api, question, note_id, enabled):
        self.api, self.mgr = api, api._ai()
        self.id = "agent-" + uuid.uuid4().hex[:10]
        self.question = str(question or "").strip()[:4000]
        self.note_id = note_id
        self.enabled = [k for k in TOOLS if k in enabled]
        self.route = self.mgr.route("qa")
        self.cloud = self.route.get("kind") == "cloud"
        self.svc = self.route.get("svc") if self.cloud else None
        self.by = self.mgr.who(self.route) if self.route.get("kind") not in (None, "none") else ""
        self._here = ""
        self.state, self.code, self.error = "running", "", ""
        self.steps, self.writes, self.skipped, self.reads = [], [], 0, set()
        self.pending, self.answer = None, ""
        self.mark = ai_guard.marker()   # R69: this request's fence
        self.seen = set()               # R69: the notes the run has been shown (a search line, a read)
        self.flags = {}                 # R69: note id -> {title, origin, hints} for the notes read that came from outside or talk to an AI
        self.read_order = []            # R69: (id, title) in the order they were read
        self.no_said = False
        self.unsent = []                # QC 117: [(step index, extras, title)] for the notes whose text hasn't gone to the cloud yet
        self.web = web_note(self.question)
        self.why = ""   # QC 112: why it stopped
        self.used, self.budget = 0, MAX_STEPS
        self.native = True
        self.messages = []
        self.cancel = threading.Event()
        self._choice = threading.Event()
        self._reply = None
        self.lock = threading.RLock()
        self.t0 = time.time()
        self.secs = 0

    # ---- what the page sees ----
    def snapshot(self):
        with self.lock:
            return {"run": self.id, "state": self.state, "code": self.code, "error": self.error, "by": self.by, "sent_to": self.svc,
                    "steps": [dict(s) for s in self.steps], "pending": dict(self.pending) if self.pending else None,
                    "writes": [{k: v for k, v in w.items() if not k.startswith("_")} for w in self.writes], "skipped": self.skipped,
                    "answer": self.answer, "used": self.used, "budget": self.budget, "max_steps": MAX_STEPS, "max_writes": MAX_WRITES,
                    "reads": len(self.reads), "secs": self.secs or round(time.time() - self.t0), "why": self.why}

    def _step(self, k, text, sub="", st="done"):
        with self.lock:
            self.steps.append({"k": k, "text": text, "sub": sub, "st": st})
            return len(self.steps) - 1

    def _set(self, i, **kw):
        with self.lock:
            self.steps[i].update(kw)

    def _end(self, state, code="", error=""):
        with self.lock:
            self.state, self.code, self.error = state, code, error
            self.pending = None
            self.secs = round(time.time() - self.t0)
            self._unsent_end()

    # ---- QC 117: a Read step says "not sent yet" until the model call that carries its text has been made ----
    def _hold(self, i, extras, title):
        """A step for a note read on a cloud model: its text goes with the next model call, not now."""
        if not self.cloud:
            return
        with self.lock:
            self.unsent.append((i, list(extras), title))
        self._set(i, sub=" · ".join([f"not sent to {self.svc} yet: it goes with the next step"] + list(extras)))

    def _mark_sent(self):
        with self.lock:
            for i, extras, _t in self.unsent:
                self.steps[i]["sub"] = " · ".join([self._sent()] + extras)
            self.unsent = []

    def _unsent_end(self):   # the run stopped first: what never went is said so
        for i, extras, _t in self.unsent:
            self.steps[i]["sub"] = " · ".join([f"not sent to {self.svc}: the run stopped first"] + extras)
        self.unsent = []

    # ---- the loop ----
    def start(self):
        ok, why = can_use_tools(self.route)
        if not ok:
            self._end("notools", "notools", why)
            return
        n = self._note(self.note_id) if self.note_id else None
        here = f' The user has the note "{ai_guard.label(n["title"])}" open.' if n and not self._locked(n["id"]) else ""   # a kept-off note's title stays here too (R69: a title is cleaned: it sits in the system message)
        self.messages = [{"role": "system", "content": _system(self.enabled, True, datetime.date.today().isoformat(), here)},
                         {"role": "user", "content": self.question}]
        self._here = here
        if self.web:
            self._step("limit", "Can’t open web links", "I have no web access: only your notes", st="skip")
        threading.Thread(target=self._loop, daemon=True, name="nv-agent").start()

    def carry_on(self):
        with self.lock:
            if self.state != "limit":
                return False
            self.budget += MAX_STEPS
            self.state, self.code, self.error = "running", "", ""
        threading.Thread(target=self._loop, daemon=True, name="nv-agent").start()
        return True

    def stop(self, why="you"):
        """why (QC 112): "you" (Stop or Esc), "new" (another request took its place), "closed" (its chat went): said in the chat."""
        self.cancel.set()
        self._choice.set()
        with self.lock:
            if self.state in ("running", "waiting"):
                self.state, self.code = "stopped", "stopped"
                self.why = why if why in ("you", "new", "closed") else "you"
                self.pending = None
                self.secs = round(time.time() - self.t0)
                self._unsent_end()

    def _loading(self):   # QC 112: a model on this PC that isn't loaded yet: a step says so while it loads (it can take a while)
        try:
            e = self.mgr.engine
            return self.route.get("kind") == "local" and (e.model_id != self.route.get("model") or e.state() != "running")
        except Exception:   # noqa: BLE001 - a step that's only words
            return False

    def _ask_model(self):
        out = {}
        load = self._step("load", f"Starting {self.route.get('name') or 'the model'} on this PC", "the first answer takes a little longer", st="run") if not self.used and not any(s["k"] == "load" for s in self.steps) and self._loading() else None
        try:
            text, _r = self._gated(lambda: self.mgr.run("qa", self.messages, None, REPLY_TOKENS, cancel=self.cancel, temperature=0.2,
                                                         tools=tool_defs(self.enabled) if self.native else None, out=out, notes=sorted(self.reads) or None))   # R68's gate sees what it read
            self._mark_sent()
        except local_ai.JobCancelled:
            raise Stop()
        except local_ai.AiError as e:
            if load is not None:
                self._set(load, text=f"{self.route.get('name') or 'The model'} didn’t start", sub="", st="skip")
            if self.native and re.search(r"said (400|404|422|500)", str(e)):   # the server doesn't take tools: the JSON fallback
                log.info("agent: native tools refused (%s); the JSON fallback", e)
                self.native = False
                self.messages[0] = {"role": "system", "content": _system(self.enabled, False, datetime.date.today().isoformat(), self._here)}
                return self._ask_model()
            raise
        if load is not None:
            self._set(load, text=f"Started {self.route.get('name') or 'the model'} on this PC", sub="", st="done")
        calls = []
        for c in out.get("tool_calls") or []:
            f = (c or {}).get("function") or {}
            try:
                args = json.loads(f.get("arguments") or "{}") if isinstance(f.get("arguments"), str) else f.get("arguments")
            except ValueError:
                args = None
            calls.append({"id": c.get("id") or "call-" + uuid.uuid4().hex[:6], "name": f.get("name"), "args": args, "native": True})
        if not calls:
            p = parse_text_call(text)
            if p and p[0] == "answer":
                return p[1], []
            if p:
                calls.append({"id": None, "name": p[0], "args": p[1], "native": False})
            elif not self.native:
                return None, None   # the fallback wants JSON: plain words don't count
        return text, calls

    def _loop(self):
        bad = 0
        try:
            while True:
                if self.cancel.is_set():
                    raise Stop()
                text, calls = self._ask_model()
                if self.cancel.is_set():
                    raise Stop()
                if calls is None or any(c["name"] not in self.enabled or not isinstance(c["args"], dict) for c in calls):
                    bad += 1
                    if bad >= 2:
                        self._end("error", "malformed", "The model didn’t use the tools properly, so it stopped."
                                  + (" The changes you added are kept: Undo all takes them out." if self.writes else " Nothing was changed."))
                        return
                    self.messages.append({"role": "assistant", "content": text or ""})
                    self.messages.append({"role": "user", "content": "That wasn't a valid tool call. Use one of the tools exactly as described"
                                          + (", as one JSON object." if not self.native else ".") + f" The tools: {', '.join(self.enabled)}."})
                    continue
                bad = 0
                if not calls:
                    if not (text or "").strip() and not self.used:   # QC 112: no tool, no words: said, and a model that can is offered
                        self._end("error", "noreply", f"{self.by or 'The model'} didn’t call a tool or reply, so nothing was changed.")
                        return
                    with self.lock:
                        self.answer = (text or "").strip() or "Done."
                        if self.web and not _SAID_NO_WEB.search(self.answer):   # QC 117: said plainly, whatever the model wrote
                            self.answer = self.web + "\n\n" + self.answer
                        if not self.used and not self.writes:
                            self.code = "notool"   # it answered in words but used no tool: the chat says so, and offers a model
                    self._end("done", self.code)
                    return
                if any(c["native"] for c in calls):
                    self.messages.append({"role": "assistant", "content": text or "", "tool_calls": [
                        {"id": c["id"], "type": "function", "function": {"name": c["name"], "arguments": json.dumps(c["args"])}} for c in calls]})
                else:
                    self.messages.append({"role": "assistant", "content": text or ""})
                for j, c in enumerate(calls):
                    end = None
                    if self.used >= self.budget:
                        end = ("limit", "Wanted another step: not taken", f"Stopped after {self.used} steps: the most for one request.")
                    elif c["name"] in WRITES and len(self.writes) >= MAX_WRITES:
                        end = ("wlimit", "Wanted a 4th change: not asked", "Stopped: it wanted a 4th change, and 3 is the most for one request.")
                    if end:   # every call it made gets an answer, so Carry on can go on from here
                        for c2 in calls[j:]:
                            self._reply_to(c2, "Not done: the limit for one request was reached.")
                        self._step("limit", end[1], st="skip")
                        self._end(end[0], end[0], end[2])
                        return
                    self.used += 1
                    self._reply_to(c, self._tool(c["name"], c["args"]))
        except Stop:
            with self.lock:
                if self.state not in ("stopped",):
                    self.state, self.code = "stopped", "stopped"
                self.pending = None
                for s in self.steps:
                    if s["st"] in ("run", "wait"):
                        s["st"] = "skip"
        except Kept as e:   # QC 117: "Keep it on this PC" in the card: stopped in plain words
            self._end("error", "cloudkept", f"{e} Nothing was sent." + (" The changes you added are kept: Undo all takes them out." if self.writes else ""))
        except local_ai.LimitReached as e:
            self._end("error", "cloudlimit", str(e))
        except local_ai.CloudAsk as e:   # R68: asked in the run's card (_gated); only here when it kept coming back
            self._end("error", "cloudask", f"{e} Nothing was sent.")
        except local_ai.CloudLocked as e:   # R68's gate, on top of the skip above
            self._end("error", "cloudlocked", str(e))
        except local_ai.AiError as e:
            self._end("error", "ai", plain_error(e, "get an answer from the model"))
        except Exception as e:   # noqa: BLE001 - one run's failure is said in the chat, never a crash
            log.exception("agent run")
            self._end("error", "error", plain_error(e))

    def _reply_to(self, c, result):
        if c["native"]:
            self.messages.append({"role": "tool", "tool_call_id": c["id"], "name": c["name"], "content": result})
        else:
            self.messages.append({"role": "user", "content": f"Result of {c['name']}:\n{result}"})

    # ---- the tools ----
    def _note(self, ref):
        """A note in this vault by its id ("12", "#12", "n-12") or its title (exact, then the closest)."""
        db = self.api.db
        s = str(ref or "").strip().strip('"“”').strip()
        m = re.fullmatch(r"(?:n-|#)?(\d{1,9})", s)
        row = None
        if m:
            row = db.query_one("SELECT id, title, content FROM notes WHERE id = ? AND vault IS ?", (int(m.group(1)), db.vault))
        if not row and s:
            row = db.query_one("SELECT id, title, content FROM notes WHERE lower(title) = lower(?) AND vault IS ? ORDER BY updated_at DESC", (s, db.vault))
            if not row:
                row = db.query_one("SELECT id, title, content FROM notes WHERE lower(title) LIKE lower(?) AND vault IS ? ORDER BY length(title), updated_at DESC",
                                   ("%" + s.replace("%", "").replace("_", "") + "%", db.vault))
        return dict(row) if row else None

    def _locked(self, nid):
        if not self.cloud:
            return False
        try:
            return bool(is_cloud_locked(nid))
        except Exception:   # noqa: BLE001 - an unreadable lock keeps the note off the cloud
            log.exception("is_cloud_locked")
            return True

    def _sent(self):
        return f"its text went to {self.svc}" if self.cloud else ""

    # ---- QC 117: R68's one-time question, and R69's, in a card in the run ----
    def _preflight(self, n):
        """What the gate would ask before a cloud model reads this note, asked now instead, in the run: (key, name, outside) or None."""
        if not self.cloud:
            return None
        try:
            origin = outside_origin(n["id"])
            if origin and not outside_allowed(n["id"]):
                return f"outside:{n['id']}", n["title"], origin
            if _lk is not None and self.mgr.cfg.get("ai_lock_ask", True) is not False:
                key, name = _lk.instance().project_of(n["id"])
                if key and not _lk.instance().asked(key):
                    return key, name, ""
        except Exception:   # noqa: BLE001 - the gate itself still stands behind this
            log.exception("preflight")
        return None

    def _ask_cloud(self, key, name, outside, titles):
        """Shows the question as a card (Send once / Always allow for this project / Keep it on this PC) and waits. "allowed" or "kept"
        (the project or the note is kept off cloud AI now). The run carries on after an answer; a project kept ends it (Kept)."""
        company = self.svc or "the cloud"
        titles = [t for t in titles if t][:4]
        i = self._step("lock", f"Waiting for your answer: may {company} read {'“' + titles[0] + '”' if outside and titles else 'notes from ' + name}?", "nothing has been sent", st="wait")
        reply, _f = self._wait({"kind": "cloud", "n": None, "project": name, "company": company, "outside": outside, "notes": titles, "key": key})
        how = reply if reply in ("once", "always", "keep") else "keep"
        r = self.api.ai_lock_first(key, how)
        if isinstance(r, dict) and r.get("status") == "error":
            how = "keep"
        if how == "keep":
            self._set(i, text=f"Kept {'“' + name + '”' if outside else name} off cloud AI", sub="nothing was sent", st="skip")
            if not outside:
                raise Kept(f"{name} is kept off cloud AI now, so the Agent stopped. A model on this PC can still carry on: pick one for Ask in Settings → AI models.")
            return "kept"
        self._set(i, text=f"You allowed {company} to read {'“' + name + '”' if outside else 'notes from ' + name}" + (" once" if how == "once" else ""),
                  sub="" if how == "once" else "and it won’t ask again for this project", st="done")
        return "allowed"

    def _gated(self, call):
        """call() with R68's one-time question answered in the run, if the gate raises it (at most three times)."""
        for tries in range(3):
            try:
                return call()
            except local_ai.CloudAsk as e:
                key = getattr(e, "project_key", "")
                if not key or tries == 2:
                    raise
                if self._ask_cloud(key, getattr(e, "project", "") or "this project", getattr(e, "outside", ""), [getattr(e, "project", "")] if getattr(e, "outside", "") else [t for _i, _x, t in self.unsent]) == "kept":
                    raise
        return call()

    # ---- R69: notes from outside, and what a card says about them ----
    def _outside_held(self, nid):
        """True when a cloud model may not read this note yet: it came from the web or an imported file, and the user hasn't said yes."""
        if not self.cloud or nid is None:
            return False
        try:
            return bool(outside_origin(nid)) and not outside_allowed(nid)
        except Exception:   # noqa: BLE001 - a check that can't be made must not stop the run, nor let it past a lock (that is _locked's job)
            log.exception("outside check")
            return False

    def _flag(self, nid, title, hints, origin=""):
        with self.lock:
            f = self.flags.setdefault(nid, {"title": title, "origin": origin, "hints": []})
            f["origin"] = f["origin"] or origin
            f["hints"] = list(dict.fromkeys(f["hints"] + list(hints)))

    def _mentioned(self, n):
        q = self.question.lower()
        return n["id"] == self.note_id or n["title"].lower() in q or bool(re.search(r"(?:\bnote\s*|#|n-)%s\b" % n["id"], q))

    def _guard(self, targets=(), removed=False):
        """What a waiting card adds: the notes the run had read ("After reading: …"), and a warning line (the card turns amber) when
        a note it read seems to talk to an AI, when the change is for a note the request didn't name (a note that came from outside
        or talks to an AI was read: only the open note or one the request names; otherwise one it has neither read nor found), or
        when a web address or picture was left out of what it wanted to write."""
        warn = []
        with self.lock:
            for f in self.flags.values():
                if f["hints"]:
                    warn.append(f"“{f['title']}” seems to talk to an AI ({'; '.join(f['hints'])}).")
            tainted = bool(self.flags)
            for n in targets:
                if not n or self._mentioned(n):
                    continue
                if tainted:
                    warn.append(f"You didn’t mention “{n['title']}” in your request.")
                elif n["id"] not in self.seen:
                    warn.append(f"You didn’t mention “{n['title']}”, and it hasn’t read or found it.")
            if removed:
                warn.append("A web address or picture it wanted to add was left out.")
            after, seen_ids = [], set()
            for nid, title in self.read_order:
                if nid in seen_ids:
                    continue
                seen_ids.add(nid)
                f = self.flags.get(nid) or {}
                after.append({"title": title, "origin": f.get("origin", ""), "hint": bool(f.get("hints"))})
        return {"after_read": after[:6], "warn": warn[:4], "amber": bool(warn)}

    def _tool(self, name, args):
        if self.cancel.is_set():
            raise Stop()
        if name in WRITES and self.skipped >= 2:   # R69: two no's: the model is looping on a request the user doesn't want
            if not self.no_said:
                self.no_said = True
                self._step("limit", "Stopped asking for changes", "you said no twice", st="skip")
            return "The user said no to changes twice. Don't propose any more changes: answer now, in a few words."
        if name == "search_notes":
            return self._search(str(args.get("query") or ""))
        if name in ("read_note", "summarise_note"):
            return self._read(name, args.get("note"))
        if name == "create_task":
            return self._write_task(args)
        if name == "add_tags":
            return self._write_tags(args)
        if name == "link_notes":
            return self._write_link(args)
        return self._write_append(args)

    def _search(self, q):
        q = " ".join(q.split())[:200]
        i = self._step("search", f"Searching your notes for “{q}”", st="run")
        hits = self.api.search_notes(q, 40) if len(q) >= 2 else []
        hits = hits if isinstance(hits, list) else []
        kept, off, held = [], 0, 0
        for h in hits:
            if self._locked(h.get("note_id")):
                off += 1
                continue
            if self._outside_held(h.get("note_id")):   # R69: its line would go to a cloud model before the user said so
                held += 1
                continue
            kept.append(h)
            if len(kept) >= SEARCH_MAX:
                break
        names = [h.get("title") or "Untitled" for h in kept]
        sub = (f"{len(kept)} found" + (f": {', '.join(names[:3])}" if names else "")) if kept else "nothing found"
        if off:
            sub += f" · {off} kept off cloud AI, left out"
        if held:
            sub += f" · {held} from the web or imported, not sent to {self.svc} until you allow it"
        self._set(i, text=f"Searched your notes for “{q}”", sub=sub, st="done")
        if not kept:
            return ("No notes found." + (f" ({off} notes are kept off cloud AI and weren't searched.)" if off else "")
                    + (f" ({held} notes from the web or imported files weren't searched: the user hasn't allowed a cloud model to read them.)" if held else ""))
        rows = []
        for h in kept:
            folder = self._folder_of(h.get("note_id"))
            rows.append(f'- "{ai_guard.label(h.get("title") or "Untitled", 120)}" (note {h.get("note_id")}{", in " + ai_guard.label(folder) if folder else ""})'
                        + (f": {ai_guard.label(h['line'], 240)}" if h.get("line") else ""))
            self.seen.add(h.get("note_id"))
            hints = ai_guard.injection_hints(h.get("line") or "")
            if hints:
                self._flag(h.get("note_id"), h.get("title") or "Untitled", hints)
        return ai_guard.fence("search results", "\n".join(rows), self.mark)

    def _folder_of(self, nid):
        try:
            r = self.api.db.query_one("SELECT f.name FROM notes n LEFT JOIN folders f ON f.id = n.folder_id WHERE n.id = ?", (nid,))
            return (r["name"] or "") if r else ""
        except Exception:   # noqa: BLE001
            return ""

    def _read(self, name, ref):
        n = self._note(ref)
        verb, doing = ("Read", "Reading") if name == "read_note" else ("Summarised", "Summarising")
        if not n:
            self._step("read", f"Looked for the note “{str(ref or '')[:80]}”", "not found")
            return f'There is no note called "{ref}". Use search_notes to find it.'
        if self._locked(n["id"]):
            self._step("lock", f"Skipped “{n['title']}”", f"kept off cloud AI, so nothing of it went to {self.svc}", st="skip")
            return f'"{n["title"]}" is kept off cloud AI, so it can\'t be read with this model. Tell the user, and carry on without it.'
        for _ in range(2):   # QC 117: R69's question for a note from outside, then R68's for its project: asked here, in the run
            ask = self._preflight(n)
            if not ask:
                break
            self._ask_cloud(ask[0], ask[1], ask[2], [n["title"]])   # a project kept raises Kept: the run stops, in plain words
            if self._locked(n["id"]):   # a note from outside that was kept on this PC
                self._step("lock", f"Skipped “{n['title']}”", f"kept off cloud AI, so nothing of it went to {self.svc}", st="skip")
                return f'"{n["title"]}" is kept off cloud AI, so it can\'t be read with this model. Tell the user, and carry on without it.'
        origin = outside_origin(n["id"])
        i = self._step("read" if name == "read_note" else "sum", f"{doing} “{n['title']}”", self._sent().replace("went", "goes"), st="run")
        text = (n["content"] or "")[:READ_CHARS]
        self.reads.add(n["id"])
        self.seen.add(n["id"])
        self.read_order.append((n["id"], n["title"]))
        hints = ai_guard.injection_hints(text)
        if origin or hints:
            self._flag(n["id"], n["title"], hints, origin)
        extras = [x for x in ({"web": "from the web", "imported": "imported"}.get(origin, ""), "it seems to talk to an AI" if hints else "") if x]
        said = " · ".join(x for x in [self._sent()] + extras if x)
        title = n["title"]
        if name == "read_note":
            self._set(i, text=f"{verb} “{title}”", sub=said, st="done")
            self._hold(i, extras, title)   # QC 117: on a cloud model its text goes with the NEXT model call: until then it says "not sent yet"
            return (ai_guard.fence(f'note "{title}" (note {n["id"]})', f'# {title} (note {n["id"]})\n{text}', self.mark)
                    + ("\n[cut at 12,000 characters]" if len(n["content"] or "") > READ_CHARS else ""))
        body = f"# {title}\n{text}"
        msgs = [{"role": "system", "content": local_ai.SUMMARY_SYSTEM},
                {"role": "user", "content": "Note:\n" + ai_guard.fence("note", body, self.mark) + "\n\n" + local_ai.SUMMARY_ASK}]
        try:
            self._set(i, sub=" · ".join([f"sending it to {self.svc}" if self.cloud else ""] + extras).strip(" ·"))
            answer, _r = self._gated(lambda: self.mgr.run("qa", msgs, None, 600, cancel=self.cancel, notes=[n["id"]]))
        except local_ai.JobCancelled:
            raise Stop()
        self._set(i, text=f"{verb} “{title}”", sub=said, st="done")
        return ai_guard.fence(f'summary of note "{title}"', answer, self.mark)

    def _wait(self, pending):
        """Shows the change and waits for Add (maybe edited) or Skip. ('add', fields) | ('skip', None)."""
        with self.lock:
            self.pending, self.state = pending, "waiting"
            self._reply = None
            self._choice.clear()
        while not self._choice.wait(0.2):
            if self.cancel.is_set():
                raise Stop()
        if self.cancel.is_set():
            raise Stop()
        with self.lock:
            reply, self._reply, self.pending = self._reply, None, None
            self.state = "running"
        return reply or ("skip", None)

    def answer_change(self, choice, fields=None):
        """The page's Add (fields: what you edited) or Skip for the change waiting."""
        with self.lock:
            if self.state != "waiting" or not self.pending:
                return False
            if self.pending.get("kind") == "cloud":   # QC 117: Send once / Always allow for this project / Keep it on this PC
                self._reply = (choice if choice in ("once", "always", "keep") else "keep", None)
            else:
                self._reply = ("add" if choice == "add" else "skip", fields if isinstance(fields, dict) else None)
        self._choice.set()
        return True

    @staticmethod
    def _due(v):
        v = str(v or "").strip()[:10]
        try:
            return datetime.date.fromisoformat(v).isoformat()
        except ValueError:
            return ""

    # ---- QC 112 (the user's first real run: "agent added task, but didnt add the correct prio nor energy"): a task's fields are
    # the Tasks page's own (priority Low / Medium / High / Critical, energy low / medium / high, a project, a note, steps); plain
    # words count ("high prio" → High, "low enery" → low), from the model or, when it left one out, from the request itself; a due
    # date only when the request names a day or a date: one the model made up is dropped ----
    PRIORITY = {"low": "Low", "medium": "Medium", "med": "Medium", "normal": "Medium", "high": "High", "hi": "High", "important": "High",
                "urgent": "High", "critical": "Critical", "top": "Critical", "asap": "Critical"}
    ENERGY = {"low": "low", "lo": "low", "little": "low", "easy": "low", "light": "low", "medium": "medium", "med": "medium", "some": "medium",
              "normal": "medium", "high": "high", "hi": "high", "lots": "high", "hard": "high", "heavy": "high"}
    _W = r"(low|lo|medium|med|normal|high|hi|important|urgent|critical|top|asap|little|easy|light|some|lots|hard|heavy)"
    _PRIO_RE = re.compile(_W + r"[\s-]*(?:prio(?:rity)?|pri)\b|\bprio(?:rity)?\s*(?:[:=]|of|is)?\s*" + _W, re.I)
    _ENERGY_RE = re.compile(_W + r"[\s-]*e?n[ae]?r[gj]?[iy]e?\b|\be?n[ae]?r[gj]?[iy]e?\s*(?:[:=]|of|is|level)?\s*" + _W, re.I)
    _DUE_RE = re.compile(r"\b(today|tonight|tomorrow|tmrw|yesterday|mon|tues?|wed(?:nes)?|thu(?:rs)?|fri|sat(?:ur)?|sun)(?:day)?\b|\bnext (?:week|month)\b|\bthis (?:week|weekend|month)\b"
                         r"|\bend of (?:the )?(?:week|month|day)\b|\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\b\s*\d|\b\d{1,2}(?:st|nd|rd|th)?\s+(?:of\s+)?(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)"
                         r"|\b\d{4}-\d\d-\d\d\b|\b\d{1,2}/\d{1,2}(?:/\d{2,4})?\b|\bin \d+ (?:days?|weeks?)\b|\b(?:due|deadline)\b", re.I)

    @classmethod
    def norm_priority(cls, v):
        s = str(v or "").strip().lower()
        return cls.PRIORITY.get(s) or next((p for k, p in cls.PRIORITY.items() if s.startswith(k)), "")

    @classmethod
    def norm_energy(cls, v):
        s = str(v or "").strip().lower()
        return cls.ENERGY.get(s) or next((e for k, e in cls.ENERGY.items() if s.startswith(k)), "")

    @classmethod
    def said_fields(cls, text):
        """{priority, energy} named in the request ("high prio low enery" → High, low), and whether it asks for a due date."""
        t = str(text or "")
        mp, me = cls._PRIO_RE.search(t), cls._ENERGY_RE.search(t)
        return {"priority": cls.norm_priority((mp.group(1) or mp.group(2)) if mp else ""), "energy": cls.norm_energy((me.group(1) or me.group(2)) if me else ""),
                "due": bool(cls._DUE_RE.search(t))}

    def _project(self, name):
        s = " ".join(str(name or "").split()).strip().lower()
        if not s:
            return None
        rows = self.api.list_projects() or []
        return next((p for p in rows if (p.get("name") or "").lower() == s), None) or next((p for p in rows if s in (p.get("name") or "").lower()), None)

    def _task_fields(self, args, said):
        f = {"priority": self.norm_priority(args.get("priority")) or said["priority"], "energy": self.norm_energy(args.get("energy")) or said["energy"]}
        due = self._due(args.get("due"))
        f["due"] = due if due and said["due"] else ""
        f["due_dropped"] = bool(due and not said["due"])
        p = self._project(args.get("project")) if args.get("project") else None
        f["project_id"], f["project"] = (p["id"], p["name"]) if p else (None, "")
        f["project_missing"] = str(args.get("project") or "")[:80] if args.get("project") and not p else ""
        steps = args.get("steps") if isinstance(args.get("steps"), list) else []
        f["steps"] = [" ".join(str(x).split())[:200] for x in steps if str(x).strip()][:10]
        return f

    @staticmethod
    def fields_said(f, note_title=""):
        """"High priority · low energy · due 2026-10-24 · in Website · from “Audit plan” · 3 steps" (what it sets, and nothing else)."""
        out = []
        if f.get("priority"):
            out.append(f"{f['priority']} priority")
        if f.get("energy"):
            out.append(f"{f['energy']} energy")
        if f.get("due"):
            out.append(f"due {f['due']}")
        if f.get("project"):
            out.append(f"in {f['project']}")
        if note_title:
            out.append(f"from “{note_title}”")
        if f.get("steps"):
            out.append(f"{len(f['steps'])} step{'s' if len(f['steps']) != 1 else ''}")
        return " · ".join(out)

    def _write_task(self, args):
        title, gone = ai_guard.strip_urls(" ".join(str(args.get("title") or "").split())[:200], self.question)   # R69: no web address the request didn't hold
        title = " ".join(title.split())
        if not title:
            return "A task needs a title."
        n = self._note(args.get("note")) if args.get("note") else None
        f = self._task_fields(args, self.said_fields(self.question))
        f["steps"] = [" ".join(x.split()) for x in (ai_guard.strip_urls(s_, self.question)[0] for s_ in f["steps"]) if x.strip()]
        gone = gone or any(ai_guard.strip_urls(str(x), self.question)[1] for x in (args.get("steps") if isinstance(args.get("steps"), list) else []))
        i = self._step("task", "Wants to add a task", st="wait")
        reply, edits = self._wait({"kind": "task", "n": len(self.writes) + 1, "title": title, "priority": f["priority"], "energy": f["energy"], "due": f["due"],
                                   "project": f["project"], "project_id": f["project_id"], "steps": f["steps"], "due_dropped": f["due_dropped"],
                                   "project_missing": f["project_missing"], "note_id": n["id"] if n else None, "note_title": n["title"] if n else "",
                                   "projects": [p["name"] for p in (self.api.list_projects() or [])][:60], **self._guard([n], bool(gone))})
        if reply == "skip":
            with self.lock:
                self.skipped += 1
            self._set(i, text=f"Skipped the task “{title}”", st="skip")
            return "The user said no to this task. Don't ask for it again."
        e = edits or {}
        title = " ".join(str(e.get("title", title)).split())[:200] or title
        if "priority" in e:
            f["priority"] = self.norm_priority(e.get("priority"))
        if "energy" in e:
            f["energy"] = self.norm_energy(e.get("energy"))
        if "due" in e:
            f["due"] = self._due(e.get("due")) if e.get("due") else ""   # an edit is the user's own: kept as given
        if "project" in e:
            p = self._project(e.get("project")) if e.get("project") else None
            f["project_id"], f["project"] = (p["id"], p["name"]) if p else (None, "")
        if "steps" in e:
            raw = e.get("steps")
            raw = raw.split("\n") if isinstance(raw, str) else raw if isinstance(raw, list) else []
            f["steps"] = [" ".join(str(x).split())[:200] for x in raw if str(x).strip()][:10]
        if "note" in e:
            n = self._note(e.get("note")) if e.get("note") else None
        r = self.api.save_task(None, title, "", f["priority"] or "Medium", f["due"] or None, f["project_id"], "", False, n["id"] if n else None, f["energy"] or None)
        if not isinstance(r, dict) or r.get("status") != "success":
            self._set(i, text=f"Couldn’t add the task “{title}”", sub=(r or {}).get("message", ""), st="skip")
            return f"The task couldn't be added: {(r or {}).get('message', 'unknown error')}"
        tid = r.get("id") or (r.get("task") or {}).get("id")
        for st in f["steps"]:
            self.api.add_task_step(tid, st)
        row = self.api.get_task(tid) if tid else None
        said = self.fields_said(f, n["title"] if n else "")
        with self.lock:
            self.writes.append({"kind": "task", "task_id": tid, "title": title, "due": f["due"], "priority": f["priority"], "energy": f["energy"], "project": f["project"],
                                "steps": len(f["steps"]), "note_title": n["title"] if n else "", "said": said, "task": row})
        self._set(i, text=f"Added the task “{title}”", sub=said, st="done")
        return f'Added the task "{title}"' + (f" ({said})" if said else "") + "."

    def _write_append(self, args):
        n = self._note(args.get("note"))
        text, gone = ai_guard.strip_urls(str(args.get("text") or "").strip()[:4000], self.question)   # R69: no web address or picture the request didn't hold
        text = text.strip()
        if not n:
            self._step("append", f"Looked for the note “{str(args.get('note') or '')[:80]}”", "not found")
            return f'There is no note called "{args.get("note")}". Use search_notes to find it.'
        if not text:
            return "There's no text to add." + (" (It held only a web address or picture, which isn't added.)" if gone else "")
        if self._locked(n["id"]):
            self._step("lock", f"Skipped adding to “{n['title']}”", "kept off cloud AI", st="skip")
            return f'"{n["title"]}" is kept off cloud AI, so this model can\'t add to it. Tell the user.'
        i = self._step("append", "Wants to add a line" if "\n" not in text else "Wants to add some text", st="wait")
        reply, fields = self._wait({"kind": "append", "n": len(self.writes) + 1, "note_id": n["id"], "note_title": n["title"], "text": text, **self._guard([n], bool(gone))})
        if reply == "skip":
            with self.lock:
                self.skipped += 1
            self._set(i, text=f"Skipped adding to “{n['title']}”", st="skip")
            return "The user said no to this. Don't ask for it again."
        text = str((fields or {}).get("text", text)).strip()[:4000] or text
        row = self.api.get_note(n["id"])
        if not row:
            self._set(i, text=f"Couldn’t add to “{n['title']}”", sub="it isn’t there any more", st="skip")
            return "The note isn't there any more."
        before = row["content"] or ""
        block = ("\n\n" if before.strip() else "") + text
        after = before.rstrip("\n") + block + "\n"
        r = self.api.save_note(n["id"], row["title"], after, row.get("category") or "", row.get("project_id"), ", ".join(row.get("tags") or []))
        if not isinstance(r, dict) or r.get("status") != "success":
            self._set(i, text=f"Couldn’t add to “{n['title']}”", sub=(r or {}).get("message", ""), st="skip")
            return f"It couldn't be added: {(r or {}).get('message', 'unknown error')}"
        with self.lock:
            self.writes.append({"kind": "append", "note_id": n["id"], "note_title": n["title"], "text": text, "content": after, "_before": before})
        self._set(i, text=f"Added {'a line' if chr(10) not in text else 'some text'} to “{n['title']}”", st="done")
        return f'Added it to the end of "{n["title"]}".'

    # ---- add_tags and link_notes (the user's yes, after R67) ----
    @staticmethod
    def clean_tags(tags):
        out = []
        for t in tags if isinstance(tags, list) else re.split(r"[,\s]+", str(tags or "")):
            t = re.sub(r"\s+", "-", str(t).strip().lstrip("#").strip())
            t = re.sub(r"[^\w/-]", "", t)[:40]
            if t and t.lower() not in {x.lower() for x in out}:
                out.append(t)
        return out[:10]

    def _save_same(self, row, content=None, tags=None):
        """save_note with the note's own title, category, project and folder: only its text or its tags change."""
        return self.api.save_note(row["id"], row["title"], row["content"] if content is None else content, row.get("category") or "", row.get("project_id"),
                                  ", ".join(row.get("tags") or [] if tags is None else tags))

    def _write_tags(self, args):
        n = self._note(args.get("note"))
        if not n:
            self._step("tags", f"Looked for the note “{str(args.get('note') or '')[:80]}”", "not found")
            return f'There is no note called "{args.get("note")}". Use search_notes to find it.'
        if self._locked(n["id"]):
            self._step("lock", f"Skipped tagging “{n['title']}”", "kept off cloud AI", st="skip")
            return f'"{n["title"]}" is kept off cloud AI, so this model can\'t change it. Tell the user.'
        row = self.api.get_note(n["id"])
        have = list(row.get("tags") or [])
        new = [t for t in self.clean_tags(args.get("tags")) if t.lower() not in {h.lower() for h in have}]
        if not new:
            return f'"{n["title"]}" already has those tags: nothing to add.'
        i = self._step("tags", "Wants to add tags", st="wait")
        reply, fields = self._wait({"kind": "tags", "n": len(self.writes) + 1, "note_id": n["id"], "note_title": n["title"], "tags": new, "have": have, **self._guard([n])})
        if reply == "skip":
            with self.lock:
                self.skipped += 1
            self._set(i, text=f"Skipped tagging “{n['title']}”", st="skip")
            return "The user said no to these tags. Don't ask for them again."
        row = self.api.get_note(n["id"])
        have = list(row.get("tags") or [])
        if fields and "tags" in fields:
            new = self.clean_tags(fields["tags"])
        new = [t for t in new if t.lower() not in {h.lower() for h in have}]
        if not new:
            self._set(i, text=f"“{n['title']}” has those tags already", st="skip")
            return "It has those tags already."
        r = self._save_same(row, tags=have + new)
        if not isinstance(r, dict) or r.get("status") != "success":
            self._set(i, text=f"Couldn’t tag “{n['title']}”", sub=(r or {}).get("message", ""), st="skip")
            return f"The tags couldn't be added: {(r or {}).get('message', 'unknown error')}"
        with self.lock:
            self.writes.append({"kind": "tags", "note_id": n["id"], "note_title": n["title"], "tags": new, "all": have + new})
        self._set(i, text=f"Added {' '.join('#' + t for t in new)} to “{n['title']}”", st="done")
        return f'Added the tags {", ".join(new)} to "{n["title"]}".'

    _LINK = re.compile(r"\[\[[^\]\n]*\]\]|`[^`\n]*`")

    @classmethod
    def link_in(cls, content, title, where=None):
        """(new content, how, the line before, the line after) with [[title]] put in, or (None, why, "", "")."""
        text = content or ""
        if re.search(r"\[\[" + re.escape(title) + r"(?:[|#][^\]]*)?\]\]", text, re.I):
            return None, "linked already", "", ""
        if where != "related":
            skip = [(m.start(), m.end()) for m in cls._LINK.finditer(text)]
            fence = [(m.start(), m.end()) for m in re.finditer(r"```.*?```", text, re.S)]
            for m in re.finditer(r"(?<![\w\[])" + re.escape(title) + r"(?![\w\]])", text, re.I):
                if any(a <= m.start() < b for a, b in skip + fence):
                    continue
                said = m.group(0)
                link = f"[[{title}]]" if said == title else f"[[{title}|{said}]]"
                new = text[:m.start()] + link + text[m.end():]
                ls, le = text.rfind("\n", 0, m.start()) + 1, text.find("\n", m.end())
                le = len(text) if le < 0 else le
                return new, "mention", text[ls:le], new[ls:le + len(link) - len(said)]
        lines = text.rstrip("\n").split("\n")
        for k in range(len(lines) - 1, max(-1, len(lines) - 4), -1):   # a "Related:" line near the end is reused
            if re.match(r"^\s*(?:\*\*)?Related:?(?:\*\*)?:?\s", lines[k] + " ", re.I):
                before = lines[k]
                lines[k] = lines[k].rstrip() + (", " if re.search(r"\]\]\s*$", lines[k]) else " ") + f"[[{title}]]"
                return "\n".join(lines) + "\n", "related", before, lines[k]
        new = text.rstrip("\n") + ("\n\n" if text.strip() else "") + f"Related: [[{title}]]\n"
        return new, "related", "", f"Related: [[{title}]]"

    def _exact(self, ref):
        """A note that really exists: by its number, or its exact title (any case). (note, nearest title or "")."""
        n = self._note(ref)
        if not n:
            return None, ""
        s = str(ref or "").strip().strip('"“”').strip()
        if re.fullmatch(r"(?:n-|#)?\d{1,9}", s) or n["title"].lower() == s.lower():
            return n, ""
        return None, n["title"]

    def _write_link(self, args):
        src, near_s = self._exact(args.get("from_note"))
        dst, near_d = self._exact(args.get("to_note"))
        for ref, n, near in ((args.get("from_note"), src, near_s), (args.get("to_note"), dst, near_d)):
            if not n:
                self._step("link", f"Looked for the note “{str(ref or '')[:80]}”", f"not found{f': did it mean “{near}”?' if near else ''}; nothing was made")
                return f'There is no note called "{ref}"' + (f' (the nearest is "{near}")' if near else "") + ". Links only go between notes that exist; none is created."
        if src["id"] == dst["id"]:
            return "A note can't link to itself."
        for n in (src, dst):
            if self._locked(n["id"]):
                self._step("lock", f"Skipped linking “{src['title']}” and “{dst['title']}”", f"“{n['title']}” is kept off cloud AI", st="skip")
                return f'"{n["title"]}" is kept off cloud AI, so this model can\'t link it. Tell the user.'
        row = self.api.get_note(src["id"])
        new, how, before, after = self.link_in(row["content"] or "", dst["title"], args.get("where") if args.get("where") in ("mention", "related") else None)
        if new is None:
            return f'"{src["title"]}" links to "{dst["title"]}" already.'
        i = self._step("link", "Wants to link two notes", st="wait")
        reply, fields = self._wait({"kind": "link", "n": len(self.writes) + 1, "note_id": src["id"], "note_title": src["title"], "to_id": dst["id"], "to_title": dst["title"],
                                    "how": how, "before": before, "after": after, **self._guard([src, dst])})
        if reply == "skip":
            with self.lock:
                self.skipped += 1
            self._set(i, text=f"Skipped linking “{src['title']}” to “{dst['title']}”", st="skip")
            return "The user said no to this link. Don't ask for it again."
        row = self.api.get_note(src["id"])
        want = (fields or {}).get("where") if (fields or {}).get("where") in ("mention", "related") else how
        new, how, _b, _a = self.link_in(row["content"] or "", dst["title"], want)
        if new is None:
            self._set(i, text=f"“{src['title']}” links to “{dst['title']}” already", st="skip")
            return "It links there already."
        r = self._save_same(row, content=new)
        if not isinstance(r, dict) or r.get("status") != "success":
            self._set(i, text=f"Couldn’t link “{src['title']}”", sub=(r or {}).get("message", ""), st="skip")
            return f"The link couldn't be added: {(r or {}).get('message', 'unknown error')}"
        with self.lock:
            self.writes.append({"kind": "link", "note_id": src["id"], "note_title": src["title"], "to_title": dst["title"], "how": how, "content": new, "_before": row["content"] or ""})
        self._set(i, text=f"Linked “{src['title']}” to “{dst['title']}”", sub="where it names it" if how == "mention" else "on its Related line", st="done")
        return f'Linked "{src["title"]}" to "{dst["title"]}".'

    def undo_all(self):
        """Takes this run's changes out, newest first: a task it added is deleted; text it added comes out of the note, if the note
        still ends with it (else it's left, and said). {undone, kept: [what couldn't], notes: {id: content}, tasks: [ids]}."""
        undone, kept, notes, tasks, tags = 0, [], {}, [], {}
        with self.lock:
            writes = list(reversed(self.writes))
        for w in writes:
            if w.get("undone"):
                continue
            if w["kind"] == "task":
                r = self.api.delete_task(w["task_id"]) if w.get("task_id") and self.api.get_task(w["task_id"]) else None
                if isinstance(r, dict) and r.get("status") == "success":
                    undone += 1
                    tasks.append(w["task_id"])
                    w["undone"] = True
                else:
                    kept.append(f"the task “{w['title']}” (it isn’t there any more)")
                continue
            if w["kind"] == "tags":   # only the tags it added come off; any you added since stay
                row = self.api.get_note(w["note_id"])
                if row:
                    left = [t for t in row.get("tags") or [] if t.lower() not in {x.lower() for x in w["tags"]}]
                    r = self._save_same(row, tags=left)
                    if isinstance(r, dict) and r.get("status") == "success":
                        undone += 1
                        tags[w["note_id"]] = left
                        w["undone"] = True
                        continue
                kept.append(f"the tags on “{w['note_title']}” (the note isn’t there any more)")
                continue
            row = self.api.get_note(w["note_id"])
            cur = (row or {}).get("content") or ""
            if row and cur.rstrip("\n") == w["content"].rstrip("\n"):
                r = self.api.save_note(w["note_id"], row["title"], w["_before"], row.get("category") or "", row.get("project_id"), ", ".join(row.get("tags") or []))
                if isinstance(r, dict) and r.get("status") == "success":
                    undone += 1
                    notes[w["note_id"]] = w["_before"]
                    w["undone"] = True
                    continue
            kept.append(f"the {'link' if w['kind'] == 'link' else 'text'} in “{w['note_title']}” (the note has changed since: Ctrl+Z or the note’s history takes it out)")
        return {"undone": undone, "kept": kept, "notes": notes, "tasks": tasks, "tags": tags}


class Agents:
    """The runs, by id (the newest 20)."""

    def __init__(self, api):
        self.api, self.runs, self.lock = api, {}, threading.Lock()

    def start(self, question, note_id=None, enabled=TOOLS):
        run = AgentRun(self.api, question, note_id, enabled)
        with self.lock:
            self.runs[run.id] = run
            for k in list(self.runs)[:-KEEP_RUNS]:
                self.runs.pop(k, None)
        run.start()
        return run

    def get(self, rid):
        return self.runs.get(str(rid or ""))
