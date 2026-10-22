"""
popout.py — Build H (mockup R34): sticky notes and the quick timer popped out of NeuroVault's window.

A popped-out sticky or timer is its own small, frameless pywebview window that stays on top of other
apps (on_top) and has no taskbar button (WS_EX_TOOLWINDOW, winframe.make_popout). It loads the same
front end as the main window, with "#pop=sticky:12" or "#pop=timer" on the URL, and the same
NeuroVaultApi as its js_api, so every window reads and writes the one database.

The windows are kept here in a dict. Each window has its own JavaScript, so after anything changes
(a sticky saved, the timer paused, what's popped out) Python tells every window with evaluate_js:
window.nvSync({kind: ...}) (frontend/js/popout.js). The running timer itself lives in Python
(the running_session record in api.py), so all windows agree.

Saved per sticky (db.py STICKY_POP_COLUMNS): out, on_top, its desktop x/y/w/h and the screen it was on;
the timer's in config.json (timer_pop). When the saved screen is gone, the window goes the same
distance from the main screen's top-right corner.

Build N (QC 103): the Ask chat floats as its own window too ("ask", #pop=ask), its place and Keep on top in config.json
(ask_pop). Its conversation lives in the page, so the windows swap it with sync({kind: "ask"}) (api.pop_ask_sync); closing it
puts the chat back in NeuroVault's dock.

Build M (QC 107): a note's mind map has its own window too ("mindmap", #pop=mindmap), its place and Keep on top in config.json
(mindmap_pop). NeuroVault's window owns the note: it sends the map's window the note as it is (api.pop_mm_sync, every change),
and the map's window sends back what was done there (a pick, a fold, words written: api.pop_mm_relay). Closing it docks the
map beside the note again.

Tests drive this with fake windows: set `create` (and `screens`) to stand-ins, and `async_ = False`.
"""
import json
import logging
import queue
import threading

import winframe
from errors import plain_error  # v0.1.1 (QC 90): failures in plain words, the detail in the log

log = logging.getLogger(__name__)

STICKY_SIZE = (248, 224)       # a sticky's default size (the in-app card's)
STICKY_MIN = (200, 160)
TIMER_SIZE = (312, 300)        # the Card quick timer; its height follows what it shows (pop_fit)
TIMER_MIN = (280, 120)
ASK_SIZE = (440, 580)          # QC 103: the Ask chat's own window (the in-page float's default, AIC_DEF)
ASK_MIN = (360, 380)
MAP_SIZE = (760, 560)          # QC 107: a mind map's own window
MAP_MIN = (420, 320)
KINDS = ("sticky", "timer", "ask", "mindmap")
TASKBAR = {"ask": "Ask"}   # QC 111: kinds with their own taskbar button (an AppUserModelID suffix); the others stay off the taskbar
CFG_KEY = {"timer": "timer_pop", "ask": "ask_pop", "mindmap": "mindmap_pop"}   # where a window that isn't a sticky keeps its place
EDGE = 40                      # first window's gap from the screen's top-right corner
GAP = 24                       # between windows laid out side by side
SAVE_DELAY = 0.4               # seconds after the last move or resize before the place is saved
SEND_WAIT = 3                  # Fix C: seconds a window gets to take a sync message before it is skipped
STICKY_BG = {"yellow": "#F3DF8A", "pink": "#F2C4CF", "mint": "#BFE3CC", "blue": "#C3D8F0", "lilac": "#D8CDF2"}


def key_of(kind, item_id=None):
    return kind if kind in CFG_KEY else f"sticky:{item_id}"


def screen_id(s):
    return f"{int(s.x)},{int(s.y)},{int(s.width)},{int(s.height)}"


def _rect_of_screen(text):
    try:
        x, y, w, h = (int(v) for v in str(text).split(","))
        return x, y, w, h
    except (TypeError, ValueError):
        return None


class PopOuts:
    def __init__(self, api):
        self.api = api
        self.windows = {}        # key -> pywebview window
        self.rects = {}          # key -> [x, y, w, h], kept from the moved / resized events
        self.url = None          # frontend/index.html (main.py sets it)
        self.create = None       # webview.create_window (main.py sets it; tests pass a fake)
        self.screens = None      # webview.screens
        self.async_ = True       # evaluate_js from a worker thread, so API calls return at once
        self.quitting = False    # set while NeuroVault quits: windows close but stay "out" for next time
        self.tray = None         # tray.Tray while the main window is hidden in the tray
        self.tray_ok = None      # None = not checked yet (tray.available())
        self._intent = {}        # key -> "in" | "close": a window closing because we asked it to
        self._made = {}          # Fix C (QC 18): key -> window, until Windows says it has really closed (a retry can close it)
        self._timers = {}        # key -> threading.Timer for a delayed save
        self._lock = threading.RLock()
        self._q = queue.Queue()
        self._worker = None

    # ------------------------------------------------------------------ state

    @property
    def db(self):
        return self.api.db

    def _sticky(self, item_id):
        try:
            item_id = int(item_id)
        except (TypeError, ValueError):
            return None
        return self.db.query_one("SELECT * FROM stickies WHERE id = ?", (item_id,))

    def _timer_state(self, kind="timer"):
        st = self.api.cfg.get(CFG_KEY[kind])
        return dict(st) if isinstance(st, dict) else {}

    def _save_timer(self, kind="timer", **patch):
        st = self._timer_state(kind)
        st.update(patch)
        self.api.cfg[CFG_KEY[kind]] = st
        import config as cfgmod
        cfgmod.save_config(self.api.cfg)

    def _saved(self, kind, item_id):
        """(out, on_top, [x, y, w, h] or None, screen or None) as saved."""
        if kind in CFG_KEY:
            st = self._timer_state(kind)
            place = [st.get(k) for k in ("x", "y", "w", "h")]
            return bool(st.get("out")), st.get("on_top", True) is not False, place if None not in place else None, st.get("screen")
        row = self._sticky(item_id)
        place = [row["desk_x"], row["desk_y"], row["desk_w"], row["desk_h"]]
        return bool(row["out"]), bool(row["on_top"]), place if None not in place else None, row["desk_screen"]

    def _store(self, kind, item_id, **sets):
        """Saves out / on_top / place for one window. sets: out, on_top, open (stickies), x, y, w, h, screen."""
        if kind in CFG_KEY:
            self._save_timer(kind, **{k: v for k, v in sets.items() if k != "open"})
            return
        cols = {"out": "out", "on_top": "on_top", "open": "open", "x": "desk_x", "y": "desk_y",
                "w": "desk_w", "h": "desk_h", "screen": "desk_screen"}
        vals = {cols[k]: (int(v) if isinstance(v, bool) else v) for k, v in sets.items() if k in cols}
        if vals:
            self.db.execute(f"UPDATE stickies SET {', '.join(c + ' = ?' for c in vals)} WHERE id = ?",
                            (*vals.values(), int(item_id)))

    def items(self):
        """What's popped out now, for the main window's status bar link."""
        out = []
        with self._lock:
            keys = list(self.windows)
        for key in keys:
            kind, _, rid = key.partition(":")
            item_id = int(rid) if rid else None
            try:
                on_top = self._saved(kind, item_id)[1]
            except Exception:
                on_top = True
            out.append({"kind": kind, "id": item_id, "key": key, "on_top": on_top})
        return out

    def window(self, kind, item_id=None):
        return self.windows.get(key_of(kind, item_id))

    # ------------------------------------------------------------------ places and screens

    def _screen_list(self):
        try:
            return list(self.screens()) if self.screens else []
        except Exception:
            log.exception("screens() failed")
            return []

    def _main_screen(self, scr):
        """The screen NeuroVault's main window is on (its centre), else the first (the main screen)."""
        w = self.api._window
        try:
            cx, cy = w.x + w.width // 2, w.y + w.height // 2
            for s in scr:
                if s.x <= cx < s.x + s.width and s.y <= cy < s.y + s.height:
                    return s
        except Exception:
            pass
        return scr[0] if scr else None

    @staticmethod
    def _clamp(x, y, w, h, s):
        if s is None:
            return x, y
        x = max(s.x, min(x, s.x + s.width - w))
        y = max(s.y, min(y, s.y + s.height - h))
        return x, y

    def _screen_at(self, x, y, w, h, scr=None):
        scr = scr if scr is not None else self._screen_list()
        cx, cy = x + w // 2, y + h // 2
        for s in scr:
            if s.x <= cx < s.x + s.width and s.y <= cy < s.y + s.height:
                return s
        return None

    def place_saved(self, place, screen_text):
        """A saved place, checked against the screens there are now. If its screen is gone, the same distance
        from the main screen's top-right corner (R34)."""
        x, y, w, h = place
        scr = self._screen_list()
        if not scr:
            return x, y, w, h
        same = next((s for s in scr if screen_id(s) == screen_text), None)
        if same is not None:
            x, y = self._clamp(x, y, w, h, same)
            return x, y, w, h
        old = _rect_of_screen(screen_text)
        main = scr[0]
        if old:
            ox, oy, ow, _oh = old
            right, top = (ox + ow) - (x + w), y - oy
            x, y = main.x + main.width - w - right, main.y + top
        x, y = self._clamp(x, y, w, h, self._screen_at(x, y, w, h, scr) or main)
        return x, y, w, h

    def place_new(self, w, h):
        """The first time: from the top-right corner of NeuroVault's screen, right to left, a new row when one is full."""
        scr = self._screen_list()
        s = self._main_screen(scr)
        if s is None:
            return None, None
        taken = [r for k, r in self.rects.items() if k in self.windows]
        y = s.y + EDGE
        while y + h <= s.y + s.height:
            x = s.x + s.width - EDGE - w
            while x >= s.x:
                if not any(x < rx + rw + GAP and rx < x + w + GAP and y < ry + rh + GAP and ry < y + h + GAP
                           for rx, ry, rw, rh in taken):
                    return x, y
                x -= w + GAP
            y += h + GAP
        return s.x + s.width - EDGE - w, s.y + EDGE

    # ------------------------------------------------------------------ the windows

    def pop_out(self, kind, item_id=None, x=None, y=None, w=None, h=None, focus=True):
        if kind not in KINDS:
            return {"status": "error", "message": "kind must be sticky, timer, ask or mindmap."}
        if kind == "sticky":
            row = self._sticky(item_id)
            if not row:
                return {"status": "error", "message": "Sticky note not found."}
            item_id = row["id"]
        else:
            item_id, row = None, None
        key = key_of(kind, item_id)
        if key in self.windows:   # already out: bring it up
            self.show(kind, item_id)
            return {"status": "success", "popped": self.items(), "already": True}
        if not self.create or not self.url:
            return {"status": "error", "message": "Popping out needs the desktop app."}
        _out, on_top, saved, screen_text = self._saved(kind, item_id)
        dw, dh = STICKY_SIZE if kind == "sticky" else ASK_SIZE if kind == "ask" else MAP_SIZE if kind == "mindmap" else TIMER_SIZE
        try:
            w = int(w) if w else (saved[2] if saved else (row["w"] if row and row["w"] else dw))
            h = int(h) if h else (saved[3] if saved else (row["h"] if row and row["h"] else dh))
        except (TypeError, ValueError):
            return {"status": "error", "message": "w and h must be whole pixels."}
        if x is not None and y is not None:
            px, py = int(x), int(y)
            px, py = self._clamp(px, py, w, h, self._screen_at(px, py, w, h) or self._main_screen(self._screen_list()))
        elif saved:
            px, py, w, h = self.place_saved([saved[0], saved[1], w, h], screen_text)
        else:
            px, py = self.place_new(w, h)
        title = (f"NeuroVault · Sticky #{row['n']}" if row else "Ask · NeuroVault" if kind == "ask"
                 else "NeuroVault · Mind map" if kind == "mindmap" else "NeuroVault · Quick timer")
        frag = f"pop=sticky:{item_id}" if row else f"pop={kind}"
        minw, minh = STICKY_MIN if row else ASK_MIN if kind == "ask" else MAP_MIN if kind == "mindmap" else TIMER_MIN
        try:
            win = self.create(title, url=f"{self.url}#{frag}", js_api=self.api, width=w, height=h, x=px, y=py,
                              frameless=True, easy_drag=False, on_top=on_top, focus=focus, resizable=True,
                              min_size=(minw, minh), text_select=True,
                              background_color=STICKY_BG.get(row["color"], "#F3DF8A") if row else "#16161A")
        except Exception as e:
            log.exception("pop_out(%s) failed", key)
            return {"status": "error", "message": plain_error(e, "open its window")}
        with self._lock:
            self.windows[key] = win
            self._made[key] = win
            self.rects[key] = [px if px is not None else 0, py if py is not None else 0, w, h]
        self._wire(win, kind, item_id, key)
        sets = {"out": True, "on_top": on_top, "w": w, "h": h}
        if px is not None:
            s = self._screen_at(px, py, w, h)
            sets.update(x=px, y=py, screen=screen_id(s) if s else screen_text)
        if row:
            sets["open"] = True
        self._store(kind, item_id, **sets)
        self.sync_popped()
        return {"status": "success", "popped": self.items()}

    def _wire(self, win, kind, item_id, key):
        ev = getattr(win, "events", None)
        if ev is None:
            return
        ev.shown += lambda: self._shown(win, key)
        ev.moved += lambda x, y: self._moved(key, kind, item_id, x=x, y=y)
        ev.resized += lambda w, h: self._moved(key, kind, item_id, w=w, h=h)
        ev.closed += lambda: self._closed(key, kind, item_id, win)

    def _shown(self, win, key):
        """Once shown: no taskbar button and a resize frame (winframe.make_popout). Changing the frame styles left the
        window 16 x 39 px smaller in the real app (checked 2026-10-17), so it gets its size back."""
        kind = key.partition(":")[0]
        import platform_layer   # QC 111: through the platform layer; a kind in TASKBAR gets its own taskbar button
        platform_layer.popout_frame(win, platform_layer.popout_app_id(TASKBAR[kind]) if kind in TASKBAR else None)
        try:
            self.api.window_icon_shown(win, kind)   # Build N: the themed icon, like the main window's (QC 111: the Ask chat's own)
        except Exception:
            log.exception("the icon for %s", key)
        r = self.rects.get(key)
        if r and getattr(win, "native", None) is not None:
            try:
                win.resize(r[2], r[3])
            except Exception:
                log.exception("resizing %s after its frame change failed", key)

    def _moved(self, key, kind, item_id, **xywh):
        """moved / resized fire all through a drag: keep the newest place, save it once the window settles."""
        with self._lock:
            r = self.rects.get(key)
            if r is None or key not in self.windows:
                return
            for i, k in enumerate("xywh"):
                if k in xywh and xywh[k] is not None:
                    r[i] = int(xywh[k])
            t = self._timers.pop(key, None)
            if t:
                t.cancel()
            if SAVE_DELAY <= 0:
                self._save_place(key, kind, item_id)
                return
            t = threading.Timer(SAVE_DELAY, self._save_place, (key, kind, item_id))
            t.daemon = True
            self._timers[key] = t
            t.start()

    def _save_place(self, key, kind, item_id):
        with self._lock:
            self._timers.pop(key, None)
            r = self.rects.get(key)
            if r is None or key not in self.windows:
                return
            x, y, w, h = r
        s = self._screen_at(x, y, w, h)
        try:
            self._store(kind, item_id, x=x, y=y, w=w, h=h, **({"screen": screen_id(s)} if s else {}))
        except Exception:
            log.exception("saving %s's place failed", key)

    def _closed(self, key, kind, item_id, closed_win=None):
        """A popped-out window has gone: because we closed it (Back into NeuroVault, Close, Quit) or from Windows (Alt+F4)."""
        with self._lock:
            if closed_win is not None and self._made.get(key) is closed_win:
                self._made.pop(key, None)
            t = self._timers.pop(key, None)
        if t:   # a move or resize not saved yet: save it before the window is forgotten
            t.cancel()
            self._save_place(key, kind, item_id)
        with self._lock:
            win = self.windows.pop(key, None)
            intent = self._intent.pop(key, None)
        if win is None or intent is not None or self.quitting:
            return   # we closed it: pop_in / pop_close / quit say so themselves (one message, in order)
        try:   # closed from Windows (Alt+F4): like its Close button
            if kind in CFG_KEY or self._sticky(item_id):
                self._store(kind, item_id, out=False, open=False)
        except Exception:
            log.exception("closing %s failed", key)
        self.sync_popped(closed=key)

    def _destroy(self, key, intent):
        with self._lock:
            win = self.windows.get(key) or self._made.get(key)   # Fix C: a window whose last destroy didn't close it
            if win is None:
                return False
            self._intent[key] = intent
        if not self._call(win.destroy):   # QC 109: a window that doesn't answer is never waited for
            log.warning("destroying %s didn't finish: it's forgotten", key)
        with self._lock:   # a fake window, or one whose closed event never comes: forget it now
            if self.windows.get(key) is win:
                self.windows.pop(key, None)
            if key not in self.windows:
                self._intent.pop(key, None)
        return True

    def pop_in(self, kind, item_id=None, show_main=True):
        """Back into NeuroVault: the window closes and the sticky (or the timer) shows inside the app again."""
        key = key_of(kind, item_id)
        if kind == "sticky" and not self._sticky(item_id):
            return {"status": "error", "message": "Sticky note not found."}
        self._store(kind, item_id, out=False, open=True)
        self._destroy(key, "in")
        self.sync_popped(back=key)
        if show_main:
            self.show_main()
        return {"status": "success", "popped": self.items()}

    def pop_close(self, kind, item_id=None):
        """The strip's Close: the window goes; a sticky stays saved (closed), a running timer keeps going."""
        key = key_of(kind, item_id)
        if kind == "sticky" and not self._sticky(item_id):
            if self._destroy(key, "close"):   # Fix C (QC 18): NeuroVault's window drops it too
                self.sync_popped(gone=key)
            return {"status": "error", "message": "Sticky note not found.", "gone": True}
        self._store(kind, item_id, out=False, open=False)
        self._destroy(key, "close")
        self.sync_popped(closed=key)
        return {"status": "success", "popped": self.items()}

    def forget_sticky(self, item_id):
        """A deleted sticky (it became a note or a task, or it was empty when closed): its window just goes.
        Fix C (QC 18): NeuroVault's window hears first (sticky-gone), so it never draws the card in the app, and
        the popped list names it as gone. This runs inside that window's own API call (its ×), which is fine:
        destroy() closes it on the UI thread, and the call's answer to a closed window is dropped."""
        key = key_of("sticky", item_id)
        self.sync({"kind": "sticky-gone", "id": item_id}, to="main")
        gone = self._destroy(key, "close")
        self.sync_popped(gone=key if gone else None)
        return gone

    def set_on_top(self, kind, item_id=None, on=True):
        win = self.window(kind, item_id)
        if win is None:
            return {"status": "error", "message": "It isn't popped out."}
        on = bool(on)
        winframe.set_topmost(win, on)   # on the window's UI thread: pywebview's on_top setter hung when called from here
        self._store(kind, item_id, on_top=on)
        if on:
            winframe.raise_window(win, True)
        self.sync_popped()
        return {"status": "success", "on_top": on, "popped": self.items()}

    # ==== Build N · QC 109 (feedback: "buttosn dont do anything", on the status bar's "on your desktop" list): Show, Bring back
    # and Bring them all back work for every kind (sticky, timer, ask, mindmap). A window call never waits for ever; a window that
    # doesn't answer, or isn't there any more, is forgotten and comes back into NeuroVault, and the page hears it (back=key) ====
    CALL_WAIT = 2.0   # seconds a window gets to answer show / restore / move / destroy

    def _call(self, fn, *args):
        """True when fn(*args) returned in time without raising. In tests (async_ off) it runs right here."""
        if not self.async_:
            try:
                fn(*args)
                return True
            except Exception as e:
                log.info("window call %s failed: %s", getattr(fn, "__name__", fn), e)
                return False
        box = {}

        def go():
            try:
                fn(*args)
                box["ok"] = True
            except Exception as e:   # noqa: BLE001 - said in the log; the caller decides
                box["e"] = e
        t = threading.Thread(target=go, daemon=True, name="nv-popout-call")
        t.start()
        t.join(self.CALL_WAIT)
        if t.is_alive():
            log.warning("a window didn't answer %s in %ss", getattr(fn, "__name__", fn), self.CALL_WAIT)
            return False
        if "e" in box:
            log.info("window call %s failed: %s", getattr(fn, "__name__", fn), box["e"])
        return bool(box.get("ok"))

    def _gone(self, kind, item_id):
        """Its window isn't there (or doesn't answer): it comes back into NeuroVault, saved so, and every window hears it."""
        key = key_of(kind, item_id)
        with self._lock:
            win = self.windows.pop(key, None)
            self._intent.pop(key, None)
            t = self._timers.pop(key, None)
        if t:
            t.cancel()
        try:
            if kind != "sticky" or self._sticky(item_id):
                self._store(kind, item_id, out=False, open=True)
        except Exception:
            log.exception("saving %s as back failed", key)
        if win is not None:
            threading.Thread(target=self._call, args=(win.destroy,), daemon=True).start() if self.async_ else self._call(win.destroy)
        self.sync_popped(back=key)
        return {"status": "error", "gone": True, "message": "Its window wasn’t open any more, so it’s back in NeuroVault.", "popped": self.items()}

    def show(self, kind, item_id=None):
        """Brings its window up, focused, on a screen you have (one that was on a screen that's gone comes back on the main one)."""
        win = self.window(kind, item_id)
        if win is None:
            return {"status": "error", "message": "It isn't popped out.", "popped": self.items()}
        key = key_of(kind, item_id)
        if not self._call(win.show) or not self._call(win.restore):
            return self._gone(kind, item_id)
        r = self.rects.get(key)
        scr = self._screen_list()
        if r and scr and self._screen_at(*r, scr) is None:   # off every screen: onto the main one
            x, y, w, h = self.place_saved(list(r), None)
            if self._call(win.move, x, y):
                r[0], r[1] = x, y
        winframe.raise_window(win, self._saved(kind, item_id)[1])
        return {"status": "success", "popped": self.items()}
    # ==== end Build N · QC 109 ====

    def show_all(self):
        for it in self.items():
            self.show(it["kind"], it["id"])
        return {"status": "success", "popped": self.items()}

    def all_in(self):
        for it in self.items():
            self.pop_in(it["kind"], it["id"], show_main=False)
        self.show_main()
        return {"status": "success", "popped": self.items()}

    def drag(self, kind, item_id, part):
        win = self.window(kind, item_id)
        if win is None or part not in winframe.HIT:
            return False
        return winframe.start_drag(win, part)

    def fit(self, kind, item_id, w, h):
        """The page asks for its window's size (the timer grows with its questions)."""
        win = self.window(kind, item_id)
        if win is None:
            return False
        try:
            w, h = max(120, min(int(w), 1200)), max(80, min(int(h), 1200))
        except (TypeError, ValueError):
            return False
        r = self.rects.get(key_of(kind, item_id))
        if r and r[2] == w and r[3] == h:
            return True
        try:
            win.resize(w, h)
        except Exception:
            log.exception("resize failed")
            return False
        if r:
            r[2], r[3] = w, h
        return True

    def restore_all(self):
        """On launch: what was popped out opens again where it was (without taking the keyboard)."""
        opened = []
        for row in self.db.query("SELECT id FROM stickies WHERE out = 1 ORDER BY n, id"):
            if self.pop_out("sticky", row["id"], focus=False).get("status") == "success":
                opened.append(key_of("sticky", row["id"]))
        if self._timer_state().get("out") and self.pop_out("timer", focus=False).get("status") == "success":
            opened.append("timer")
        if self._timer_state("ask").get("out") and self.pop_out("ask", focus=False).get("status") == "success":   # QC 103
            opened.append("ask")
        if self._timer_state("mindmap").get("out") and self.pop_out("mindmap", focus=False).get("status") == "success":   # QC 107
            opened.append("mindmap")
        return opened

    # ------------------------------------------------------------------ the main window

    def show_main(self):
        w = self.api._window
        if w is None:
            return False
        try:
            w.show()
            w.restore()
        except Exception:
            pass
        winframe.raise_window(w, False)
        if self.tray:
            self.tray.stop()
            self.tray = None
        return True

    def relay(self, act, value):
        """A popped-out sticky's ⋮ menu (promote, append, attach, convert to a timed task) runs in the main
        window, which has the notes and folders: it comes up and does it there. The popped-out timer's focus sound
        (sound, sound-vol) plays from the main window too, so there's one sound however many windows: no need to raise it."""
        if act not in ("sticky-promote", "sticky-append", "sticky-attach", "sticky-task", "sound", "sound-vol", "aic-ins", "aic-open"):
            return {"status": "error", "message": "That can't be done from a popped-out window."}
        if act.startswith("sticky-") or act == "aic-open":   # QC 103: "Open AI models" and links from the Ask window
            self.show_main()
        self.send(f"window.nvRelay && window.nvRelay({json.dumps(act)}, {json.dumps(value)})", to="main")
        return {"status": "success"}

    def _tray_available(self):
        if self.tray_ok is None:
            try:
                import tray
                self.tray_ok = tray.available()
            except Exception:
                self.tray_ok = False
        return self.tray_ok

    def close_main(self):
        """The window bar's Close (the front end has saved first). With something popped out and pystray there,
        NeuroVault goes to the tray so it stays; otherwise it quits and the popped-out windows close with it."""
        if self.windows and self._tray_available():
            return self.to_tray()
        return self.quit()

    def to_tray(self):
        import tray
        w = self.api._window
        try:
            w.hide()
        except Exception:
            log.exception("hiding the main window failed")
        if self.tray is None:
            self.tray = tray.Tray(self)
            self.tray.start()
        return "tray"

    def on_main_closing(self):
        """main.py: the main window's closing event (Alt+F4, the taskbar's Close). False keeps it open."""
        if self.quitting:
            return True
        if self.windows and self._tray_available():
            threading.Thread(target=self.to_tray, daemon=True).start()
            return False
        self.quitting = True
        for key in list(self.windows):
            self._destroy(key, "quit")
        return True

    def flush_pops(self, timeout=1.5):
        """Asks each popped-out window to save what's typed, and waits a little for the answers."""
        wins = list(self.windows.values())
        if not wins:
            return
        done = threading.Semaphore(0)
        for win in wins:
            try:
                win.evaluate_js("window.nvFlush ? window.nvFlush() : true", lambda *_: done.release())
            except Exception:
                done.release()
        for _ in wins:
            if not done.acquire(timeout=timeout):
                break

    def quit(self):
        """Quit: save, close every popped-out window (each stays "out", so it opens again next time), then the main one."""
        try:
            self.flush_pops()
        except Exception:
            log.exception("flushing the popped-out windows failed")
        self.quitting = True
        for key in list(self.windows):
            self._destroy(key, "quit")
        if self.tray:
            self.tray.stop()
            self.tray = None
        w = self.api._window
        if w is not None:
            try:
                w.destroy()
            except Exception:
                log.exception("closing the main window failed")
        return True

    # ------------------------------------------------------------------ keeping every window in step

    def _targets(self, to):
        main = self.api._window
        pops = list(self.windows.values())
        if to == "main":
            return [main] if main is not None else []
        if to == "pops":
            return pops
        return ([main] if main is not None else []) + pops

    def send(self, script, to="all"):
        self._push(lambda: script, to)

    def sync(self, msg, to="all"):
        """msg: a dict, or a function returning one when it is sent (so it's the newest state)."""
        self._push(lambda: "window.nvSync && window.nvSync(%s)" % json.dumps(msg() if callable(msg) else msg, default=str), to)

    def _push(self, make, to):
        if not self.windows and to != "main" and self.api._window is None:
            return
        if not self.async_:
            self._run(make, to)
            return
        self._q.put((make, to))
        if self._worker is None or not self._worker.is_alive():
            self._worker = threading.Thread(target=self._loop, daemon=True, name="nv-popout-sync")
            self._worker.start()

    def _loop(self):
        while True:
            try:
                make, to = self._q.get(timeout=30)
            except queue.Empty:
                return
            try:
                self._run(make, to)
            finally:
                self._q.task_done()

    def _run(self, make, to):
        targets = self._targets(to)
        if not targets:
            return
        try:
            script = make()
        except Exception:
            log.exception("building a sync message failed")
            return
        for win in targets:
            self._eval(win, script)

    def _eval(self, win, script):
        """Fix C (QC 18): a window that closes while a message is on its way never answers, and pywebview's
        evaluate_js would wait for ever, so every later message (sticky-gone among them) never arrived. On the
        worker thread each send gets SEND_WAIT seconds; a window that's closing is skipped."""
        with self._lock:
            closing = any(w is win for k, w in self.windows.items() if k in self._intent)
        if closing:
            return
        def send():
            try:
                win.evaluate_js(script)
            except Exception as e:
                log.debug("sync to a window failed: %s", e)
        if not self.async_:
            send()
            return
        t = threading.Thread(target=send, daemon=True, name="nv-popout-send")
        t.start()
        t.join(SEND_WAIT)
        if t.is_alive():
            log.warning("a window didn't take a sync message in %ss: skipped", SEND_WAIT)

    def flush(self, timeout=5):
        """Tests: wait until every queued message has been sent."""
        self._q.join() if self._worker and self._worker.is_alive() else None

    def sync_popped(self, back=None, closed=None, gone=None):
        """back: the key that just came back into NeuroVault (it shows there); closed: the key whose window was closed
        (a sticky stays saved, closed); gone: a sticky whose window closed because it was deleted (Fix C)."""
        self.sync(lambda: {"kind": "popped", "items": self.items(), "back": back, "closed": closed, "gone": gone})

    def sync_timer(self, logged=None):
        self.sync(lambda: {"kind": "timer", "session": self.api.get_running_session(), "logged": logged})
