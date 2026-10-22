import logging
import os
import sys

# RAM: numpy's OpenBLAS commits about 32 MB per CPU thread the moment numpy is imported (about 490 MB
# on a 16-thread PC), and voice, read aloud and the setup all import it. The app's numpy work is audio
# arrays, never matrix maths, so one BLAS thread is enough. Set before anything imports numpy.
os.environ.setdefault("OPENBLAS_NUM_THREADS", "1")

# Packaging: the packaged app has no console; its output goes to a log file in its data folder (utils.py)
from utils import app_dir, frozen_output_to_log, resource_path
frozen_output_to_log()

import webview

from api import NeuroVaultApi
import docviewer
import platform_layer  # cross-platform step 0
import winframe

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s [%(name)s] %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger("neurovault")


def register_hotkeys(window, cfg):
    """Global hotkeys for the timer — work even when the window isn't
    focused. Optional: needs the `keyboard` package. If it's not installed,
    or registration fails for any reason (some Linux/macOS setups need
    extra permissions for global key hooks), this just logs a note and the
    app runs fine without hotkeys.

    Ctrl+Alt+P — pause/resume the active session
    Ctrl+Alt+S — stop & log the active session
    Ctrl+Alt+H — bring the window to the front
    Ctrl+Shift+D — brain dump: bring the window up with the capture bar open (Phase 6A)
    """
    if not cfg.get("hotkeys_enabled", True):
        return
    try:
        import keyboard
    except ImportError:
        log.info("'keyboard' package not installed — global hotkeys disabled "
                  "(pip install keyboard, then restart, to enable them).")
        return

    def call_js(fn):
        try:
            window.evaluate_js(f"window.{fn} && window.{fn}()")
        except Exception as e:
            log.warning("hotkey %s failed: %s", fn, e)

    def brain_dump():
        # Phase 6A: from any app, the window comes up with the brain dump bar open and focused
        try:
            window.restore()
            window.show()
        except Exception as e:
            log.warning("brain dump hotkey couldn't show the window: %s", e)
        call_js("hotkeyBrainDump")

    # Build H: pause / resume and stop are done in Python, where the timer lives, so every window follows
    # (the main one and a popped-out timer), even when NeuroVault's window is hidden in the tray
    api = getattr(window, "_nv_api", None)

    def timer(action, fallback):
        if api is None:
            call_js(fallback)
            return
        try:
            api.timer_hotkey(action)
        except Exception as e:
            log.warning("hotkey %s failed: %s", action, e)

    try:
        keyboard.add_hotkey("ctrl+alt+p", lambda: timer("pause-toggle", "hotkeyPauseResume"))
        keyboard.add_hotkey("ctrl+alt+s", lambda: timer("stop", "hotkeyStop"))
        keyboard.add_hotkey("ctrl+alt+h", lambda: window.restore())
        keyboard.add_hotkey("ctrl+shift+d", brain_dump)  # Phase 6A
        log.info("Hotkeys registered: Ctrl+Alt+P (pause/resume), Ctrl+Alt+S (stop & log), Ctrl+Alt+H (show window), "
                 "Ctrl+Shift+D (brain dump)")
    except Exception as e:
        log.warning("Could not register global hotkeys: %s", e)


def widen_server_backlog():
    """pywebview serves frontend/ from a wsgiref server whose listen backlog is
    5 connections. The page asks for ~13 files at once (two stylesheets, ten
    scripts, a font), and on Windows the overflow is refused outright, so a
    script silently fails to load. A deeper backlog lets them all queue."""
    from wsgiref.simple_server import WSGIServer
    WSGIServer.request_queue_size = 64


def wire_window(window, api):
    """Everything the window needs once created (also used by test launchers, so they match the app)."""
    api._window = window
    window._nv_api = api   # Build H: the hotkeys call the timer through the API

    register_hotkeys(window, api.cfg)

    # Bug fix 2026-10-17: pywebview's frameless form loses a frame's worth of size (16 x 39 px at 100%); put it back
    # before it shows (this works because the main window is created before webview.start; see keep_requested_size)
    window.events.before_show += lambda: winframe.keep_requested_size(window)

    # Bug fix 2026-10-16: give the frameless window Windows' own frame features back
    # (taskbar minimise, Aero Snap, Win+arrows) without drawing a frame (winframe.py)
    window.events.shown += lambda: winframe.enable_native_frame(window)
    # Build N: the window and taskbar icon, the static neurovault.ico until the page draws the themed one (api.window_icon)
    window.events.shown += lambda: api.window_icon_shown(window)

    # The bar's Maximise / Restore button follows the window, however it was maximised
    window.events.maximized += lambda: api.on_window_state(True)
    window.events.restored += lambda: api.on_window_state(False)

    # Build H (R34): stickies and the quick timer pop out as their own windows (popout.py). They open with the same
    # page and API; what was popped out last time opens again once the main window has loaded. Closing the main
    # window with something popped out keeps NeuroVault in the tray when pystray is installed (tray.py).
    pops = api._pop
    pops.create = webview.create_window
    pops.screens = lambda: list(webview.screens)   # webview.screens is a list (behind a proxy), not a function
    pops.url = getattr(window, "original_url", None) or resource_path(os.path.join('frontend', 'index.html'))
    window.events.closing += pops.on_main_closing
    # Build DV (R66): PDF and Word attachments open in their own viewer window (docviewer.py), viewer.html beside index.html
    api._dv().create, api._dv().url = webview.create_window, pops.url
    restored = []

    def restore_popouts():
        if not restored:
            restored.append(True)
            pops.restore_all()
    window.events.loaded += restore_popouts
    window.events.loaded += lambda: api.spell_warm()   # Build N (QC 62): the dictionary's headwords, loaded in the background

    # Build O (R47): files dropped on the window. pywebview hands a dropped file's full path only to a Python-side DOM
    # drop handler (dataTransfer.files[i].pywebviewFullPath); it goes to api.files_dropped, and the page's own drop
    # handler (lists-drop.js) asks api.drop_paths for it. Once per page load: a reload drops the page's listener.
    def watch_drops():
        try:
            from webview.dom import DOMEventHandler
            window.dom.document.events.drop += DOMEventHandler(
                lambda e: api.files_dropped((e.get("dataTransfer") or {}).get("files") or []), False, False)
        except Exception as e:
            log.warning("dropped files' paths won't reach NeuroVault: %s", e)
    window.events.loaded += watch_drops
    # RAM: WebView2 trims its memory while the window is minimised (winframe.py)
    window.events.minimized += lambda: winframe.set_memory_target(window, True)
    window.events.restored += lambda: winframe.set_memory_target(window, False)

    # Bind the shutdown event to release the database correctly
    window.events.closed += api.shutdown


def claim_instance(argv):
    """Build DV · QC 116: one NeuroVault at a time. Explorer's Open with → NeuroVault (or a second double-click) hands its
    PDF or Word files to the NeuroVault that's running, which comes to the front and opens them in tabs; this launch exits.
    Only existing .pdf / .docx paths are passed on (docviewer.launch_path). (files to open, the instance or None to exit)"""
    opening = docviewer.launch_paths(argv)

    def hand(info, paths):
        platform_layer.allow_foreground()   # Windows lets the running one take the front only if this one says so
        return platform_layer.instance.hand_off(info, paths)
    try:
        inst = platform_layer.instance.claim(app_dir(), docviewer.launch_path, opening, hand=hand)
    except Exception:
        log.exception("Couldn't check for a NeuroVault that's already running; starting this one")
        inst = False
    return opening, inst


if __name__ == '__main__':
    opening, instance = claim_instance(sys.argv)
    if instance is None:
        log.info("NeuroVault is already running: handed it %d file(s) and stepped aside", len(opening))
        sys.exit(0)

    # Build N: NeuroVault's own taskbar identity (not Python's), before any window exists, so the taskbar button shows our icon
    platform_layer.set_app_identity()
    widen_server_backlog()

    # Initialise the backend API (opens/creates neurovault.db next to this file)
    api = NeuroVaultApi()
    # QC 116: files from Open with, for the window to open in tabs once its vault is ready; later launches hand theirs in
    api._dv().hand_in(opening, tell=False)
    if instance:
        instance.serve(api._dv().second_launch)

    # Locate the frontend
    html_path = resource_path(os.path.join('frontend', 'index.html'))

    # Create the window. The front end draws its own window bar with tabs, like
    # Obsidian (frameless); its drag area and resize edges hand the press to
    # Windows through api.window_start_drag (winframe.py), so pywebview's
    # page-driven drag stays off (easy_drag=False).
    window = webview.create_window(
        title='NeuroVault',
        url=html_path,
        js_api=api,
        width=1440,
        height=920,
        min_size=(1024, 640),
        text_select=True,
        frameless=True,
        easy_drag=False,
        resizable=True,
        background_color='#16161A',
    )
    wire_window(window, api)

    # Start the application. debug keeps the right-click menu and F12 / Inspect; DevTools only opens by
    # itself with NEUROVAULT_DEVTOOLS=1 (RAM: an open DevTools window is a second renderer, about 75 MB)
    webview.settings['OPEN_DEVTOOLS_IN_DEBUG'] = os.environ.get('NEUROVAULT_DEVTOOLS') == '1'
    webview.start(debug=True)
