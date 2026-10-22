"""One NeuroVault at a time (Build DV · QC 116): a second launch (Explorer's Open with on a PDF or a Word file, a double-click
on the shortcut) hands its files to the NeuroVault that's running and exits, and that one comes to the front.

The same on every OS: a lock file in the app's own folder (so the trial and a dev copy each have their own) names the running
process, its port on 127.0.0.1 and a random secret. A second launch connects and sends one line of JSON:
{"token": <the secret>, "open": [<paths>]}. Nothing else is understood: the running app checks the secret, keeps only the paths
`check` lets through (callers pass one that allows existing .pdf / .docx files only) and never runs or opens anything else.

    inst = claim(folder, check)      # None: another NeuroVault answered (it has the files); else this process is the one
    inst.serve(handler)              # handler(paths) gets every later hand-off, and any that came in before serve
    inst.close()                     # on exit (also done at interpreter exit)
"""
import atexit
import hmac
import json
import logging
import os
import secrets
import socket
import threading
import time

log = logging.getLogger(__name__)

LOCK_NAME = ".neurovault-instance.json"
MAX_LINE = 64 * 1024     # one hand-off line; longer is refused
MAX_PATHS = 8
TIMEOUT = 3.0            # a second launch waits this long for an answer


def _alive(pid):
    from . import pid_alive   # the per-OS answer (platform_layer)
    return pid_alive(pid)


def _read(path):
    try:
        with open(path, encoding="utf-8") as f:
            d = json.load(f)
        if isinstance(d, dict) and isinstance(d.get("port"), int) and isinstance(d.get("token"), str) and isinstance(d.get("pid"), int):
            return d
    except (OSError, ValueError):
        pass
    return None


def clean_paths(paths, check):
    """The paths a hand-off may carry: strings, at most MAX_PATHS, each one `check` lets through (it returns the path to use,
    or None)."""
    out = []
    if not isinstance(paths, list):
        return out
    for p in paths[:MAX_PATHS]:
        if not isinstance(p, str) or not p or len(p) > 4096 or "\x00" in p:
            continue
        try:
            q = check(p)
        except Exception:
            q = None
        if q and q not in out:
            out.append(q)
    return out


def hand_off(info, paths, timeout=TIMEOUT, connect=None):
    """Send `paths` to the running NeuroVault `info` names. True when it answered ok."""
    connect = connect or (lambda addr: socket.create_connection(addr, timeout=timeout))
    try:
        s = connect(("127.0.0.1", info["port"]))
    except OSError:
        return False
    try:
        s.settimeout(timeout)
        s.sendall((json.dumps({"token": info["token"], "open": list(paths)}) + "\n").encode("utf-8"))
        reply = s.recv(256)
        return reply.strip() == b'{"ok": true}'
    except OSError:
        return False
    finally:
        try:
            s.close()
        except OSError:
            pass


class Instance:
    """The running NeuroVault's side: the lock file and the listener."""

    def __init__(self, lock_path, sock, token, check):
        self.lock_path, self.sock, self.token, self.check = lock_path, sock, token, check
        self.handler, self.waiting, self.closed = None, [], False
        self._lk = threading.Lock()
        self.port = sock.getsockname()[1]
        threading.Thread(target=self._loop, daemon=True, name="nv-instance").start()

    def serve(self, handler):
        with self._lk:
            self.handler, early = handler, self.waiting
            self.waiting = []
        for paths in early:
            self._give(paths)

    def _give(self, paths):
        try:
            self.handler(paths)
        except Exception:
            log.exception("handing a second launch's files to NeuroVault")

    def _loop(self):
        while not self.closed:
            try:
                c, _ = self.sock.accept()
            except OSError:
                return
            threading.Thread(target=self.answer, args=(c,), daemon=True, name="nv-instance-ask").start()

    def answer(self, c):
        """One connection: one line, the secret, the files. Anything wrong is dropped without a word."""
        try:
            c.settimeout(2.0)
            buf = b""
            while b"\n" not in buf and len(buf) <= MAX_LINE:
                chunk = c.recv(4096)
                if not chunk:
                    break
                buf += chunk
            if b"\n" not in buf or len(buf) > MAX_LINE:
                return
            msg = json.loads(buf.split(b"\n", 1)[0].decode("utf-8"))
            if not isinstance(msg, dict) or not isinstance(msg.get("token"), str) or not hmac.compare_digest(msg["token"], self.token):
                return
            paths = clean_paths(msg.get("open", []), self.check)
            c.sendall(b'{"ok": true}\n')
            with self._lk:
                if self.handler is None:
                    self.waiting.append(paths)
                    return
            self._give(paths)
        except (OSError, ValueError, UnicodeDecodeError):
            return
        finally:
            try:
                c.close()
            except OSError:
                pass

    def close(self):
        if self.closed:
            return
        self.closed = True
        try:
            self.sock.close()
        except OSError:
            pass
        d = _read(self.lock_path)
        if d and d.get("pid") == os.getpid() and d.get("port") == self.port:
            try:
                os.remove(self.lock_path)
            except OSError:
                pass


def claim(folder, check, paths=(), alive=None, hand=None, wait=2.0):
    """Become the one NeuroVault, or hand `paths` to the one that's running. None: handed off (this launch should exit).
    alive / hand stand in for the process check and the hand-off in tests."""
    alive, hand = alive or _alive, hand or hand_off
    lock = os.path.join(folder, LOCK_NAME)
    paths = clean_paths(list(paths), check)
    for _ in range(3):
        info, t0 = _read(lock), time.monotonic()
        while info is None and os.path.exists(lock) and time.monotonic() - t0 < wait:   # being written right now
            time.sleep(0.05)
            info = _read(lock)
        if info and info["pid"] != os.getpid() and alive(info["pid"]):
            if hand(info, paths):
                return None
            # alive but not answering: a process that reused the id (we listen before we write the file), so it's stale
        try:
            if os.path.exists(lock):
                os.remove(lock)
        except OSError:
            pass
        sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        sock.bind(("127.0.0.1", 0))
        sock.listen(8)
        token = secrets.token_urlsafe(32)
        try:
            fd = os.open(lock, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        except FileExistsError:   # another launch got there first: ask it instead
            sock.close()
            continue
        except OSError:
            log.warning("Couldn't write %s; this NeuroVault won't take files from a second launch", lock)
            inst = Instance(lock, sock, token, check)
            return inst
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump({"pid": os.getpid(), "port": sock.getsockname()[1], "token": token}, f)
        inst = Instance(lock, sock, token, check)
        atexit.register(inst.close)
        return inst
    log.warning("Couldn't settle which NeuroVault runs; starting this one anyway")
    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    sock.bind(("127.0.0.1", 0))
    sock.listen(8)
    return Instance(lock, sock, secrets.token_urlsafe(32), check)
