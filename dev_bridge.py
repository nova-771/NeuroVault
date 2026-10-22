"""
Dev only: serve frontend/ to a normal browser with the real NeuroVaultApi
behind a stand-in for pywebview's bridge, so the new front end can be tried
on real data without opening the app window.

    python dev_bridge.py --db <a COPY of the database> [--config <a COPY of config.json>] [--port 8766]

The page gets a small script (injected into index.html as it is served) that
makes every window.pywebview.api.<name>(...args) call a POST /api/<name> with
the arguments as a JSON list. NeuroVaultApi answers it on the given database,
exactly as in the app. Window calls answer false (there is no window).

Safety: config.json goes to a temp folder (or to --config, a copy, for testing
that settings come back), and the app's own database and config files
(neurovault.db / knowledge_os.db / config.json next to main.py) are refused,
so this only ever touches a copy.

QC 86: the vault too. The bridge is a test install (NEUROVAULT_TEST_INSTALL=1), and it
refuses to start when the config's vault_path is the user's real vault
(the NeuroVault folder in Documents, inside it or holding it, or a folder an app install marked in
.neurovault/vault-id.json); it names a scratch vault instead. --vault <folder> sets one.
With no vault in the config, a new one goes under a scratch Documents next to the config.
"""
import argparse
import json
import os
import sys
import tempfile
import threading
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import config as cfgmod  # noqa: E402

cfgmod.CONFIG_PATH = os.path.join(tempfile.mkdtemp(prefix="nv-dev-"), "config.json")
if "--config" in sys.argv[:-1]:  # Phase 5: read before api imports config (main() refuses the app's own file)
    cfgmod.CONFIG_PATH = os.path.abspath(sys.argv[sys.argv.index("--config") + 1])
# ---- QC 86: a test install; a first-run vault goes to a scratch Documents, never the real one ----
os.environ["NEUROVAULT_TEST_INSTALL"] = "1"
os.environ.setdefault("NEUROVAULT_DOCUMENTS", os.path.join(os.path.dirname(cfgmod.CONFIG_PATH), "Documents"))

from api import NeuroVaultApi  # noqa: E402

FRONTEND = os.path.join(HERE, "frontend")
SHIM = """<script>
/* dev_bridge.py: stands in for pywebview's bridge (dev only) */
window.pywebview = { api: new Proxy({}, { get: (_, name) => typeof name !== 'string' || name === 'then' ? undefined
  : (...args) => fetch('/api/' + name, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(args) })
      .then(r => r.ok ? r.json() : r.text().then(t => Promise.reject(new Error(t)))) }) };
window.__devBridge = true;
window.addEventListener('DOMContentLoaded', () => setTimeout(() => window.dispatchEvent(new Event('pywebviewready')), 50));
</script>
"""


def real_db_paths(names=("neurovault.db", "knowledge_os.db")):
    root = os.path.dirname(os.path.abspath(os.path.join(HERE, "main.py")))
    # the worktree's own folder and the main checkout (worktrees live in <repo>/.claude/worktrees/<name>)
    roots = {root}
    parts = os.path.normcase(root).split(os.sep)
    if ".claude" in parts:
        roots.add(os.sep.join(root.split(os.sep)[:parts.index(".claude")]))
    return {os.path.normcase(os.path.abspath(os.path.join(r, n)))
            for r in roots for n in names}


class Handler(SimpleHTTPRequestHandler):
    api = None
    lock = threading.Lock()

    def __init__(self, *a, **kw):
        super().__init__(*a, directory=FRONTEND, **kw)

    def log_message(self, fmt, *args):  # quiet: only API calls
        if self.command == "POST":
            sys.stderr.write("api %s\n" % (fmt % args))

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def do_GET(self):
        path = self.path.split("?")[0]
        if path in ("/", "/index.html"):
            with open(os.path.join(FRONTEND, "index.html"), encoding="utf-8") as f:
                html = f.read()
            html = html.replace("<script", SHIM + "<script", 1).encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(html)))
            self.end_headers()
            self.wfile.write(html)
            return
        super().do_GET()

    def do_POST(self):
        name = self.path.split("?")[0][len("/api/"):]
        fn = getattr(self.api, name, None) if self.path.startswith("/api/") and not name.startswith("_") else None
        if not callable(fn):
            self.send_error(404, "No API call " + name)
            return
        args = json.loads(self.rfile.read(int(self.headers.get("Content-Length") or 0)) or b"[]")
        with self.lock:
            try:
                result = fn(*args)
            except Exception as e:  # the real bridge would reject the promise
                self.send_error(500, "%s: %s" % (type(e).__name__, e))
                return
        body = json.dumps(result, default=str).encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


def vault_guard(vault=None):
    """QC 86: the config's vault (or --vault, then written into the config) must be a scratch vault. Exits with the
    reason and a scratch folder to use instead."""
    import vault_disk
    cfg = cfgmod.load_config()
    path = os.path.abspath(vault) if vault else (cfg.get("vault_path") or "")
    scratch = os.path.join(os.path.dirname(cfgmod.CONFIG_PATH), "vault")
    why = vault_disk.test_vault_refusal(path)
    if why:
        sys.exit("Refusing to start: %s\nUse a scratch vault instead, e.g. --vault \"%s\" (or set vault_path in %s)."
                 % (why, scratch, cfgmod.CONFIG_PATH))
    if vault and cfg.get("vault_path") != path:
        os.makedirs(path, exist_ok=True)
        cfg["vault_path"] = path
        cfgmod.save_config(cfg)
    print("Vault: %s" % (path or "none yet (a new one goes under %s)" % os.environ["NEUROVAULT_DOCUMENTS"]), flush=True)


def main():
    ap = argparse.ArgumentParser(description=__doc__.strip().splitlines()[0])
    ap.add_argument("--db", required=True, help="a COPY of the database (never the app's own file)")
    ap.add_argument("--config", help="a COPY of config.json (default: a fresh one in a temp folder)")
    ap.add_argument("--port", type=int, default=8766)
    ap.add_argument("--vault", help="a scratch vault folder (QC 86: written into the config; never the real vault)")
    # Phase 6B: the voice rambler without a microphone, and the Whisper models from another folder
    ap.add_argument("--voice-wav", help="a .wav file the voice recorder plays in real time instead of the microphone")
    ap.add_argument("--models", help="the folder holding whisper-<name>/ (default: models/ next to this file)")
    # Build E: More fonts from another font list (e.g. one pointing at a local server holding the files)
    ap.add_argument("--font-list", help="a font_list.json to use instead of the repo's")
    # Build J: the dictionary from another list (e.g. dev_dict_sample.py's, pointing at a local server) and another folder
    ap.add_argument("--dict-list", help="a dict_list.json to use instead of the repo's")
    ap.add_argument("--dict-dir", help="where the dictionary index goes (default: NeuroVault/dictionary under LOCALAPPDATA)")
    a = ap.parse_args()
    if a.dict_list:
        import dictionary
        dictionary.LIST_PATH = os.path.abspath(a.dict_list)
    if a.dict_dir:
        os.environ["NEUROVAULT_DICT"] = os.path.abspath(a.dict_dir)
    if a.font_list:
        import fonts
        fonts.LIST_PATH = os.path.abspath(a.font_list)
    if a.voice_wav:
        import voice
        voice.Session.TEST_WAV = os.path.abspath(a.voice_wav)
    if a.models:
        os.environ["NV_MODELS_DIR"] = os.path.abspath(a.models)
    db = os.path.abspath(a.db)
    if os.path.normcase(db) in real_db_paths():
        sys.exit("Refusing the app's own database: copy it first and pass the copy.")
    if os.path.normcase(cfgmod.CONFIG_PATH) in real_db_paths(("config.json",)):
        sys.exit("Refusing the app's own config.json: copy it first and pass the copy.")
    vault_guard(a.vault)
    Handler.api = NeuroVaultApi(db_path=db)
    srv = ThreadingHTTPServer(("127.0.0.1", a.port), Handler)
    print("NeuroVault dev bridge on http://127.0.0.1:%d/ with %s and %s" % (a.port, db, cfgmod.CONFIG_PATH), flush=True)
    srv.serve_forever()


if __name__ == "__main__":
    main()
