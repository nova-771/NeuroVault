"""
winframe.py — what Windows gives a framed window, for NeuroVault's frameless one.

The front end draws its own window bar (frameless=True), and a frameless
WinForms window has no resize border and no caption, so it can't be resized
from its edges or dragged with Aero snap. The page catches the press on its
window bar or on a thin strip along each edge and calls api.window_start_drag;
this module hands that press to Windows (WM_NCLBUTTONDOWN with the matching
hit-test code) on the window's UI thread, so Windows runs its own move or
resize loop: edge resizing, snap layouts, drag-down from maximised.

Windows only; elsewhere every function is a no-op that returns False.
"""
import ctypes
import logging
import sys

log = logging.getLogger(__name__)

WM_NCLBUTTONDOWN = 0x00A1
# Hit-test codes for the part of the frame being dragged
HIT = {"caption": 2, "w": 10, "e": 11, "n": 12, "nw": 13, "ne": 14, "s": 15, "sw": 16, "se": 17}


def _on_ui_thread(window, fn):
    """Run fn on the WinForms UI thread and wait for it (pywebview calls the
    API from worker threads; window messages must come from the UI thread)."""
    from System import Func, Type  # pythonnet, loaded by pywebview's WinForms backend
    form = window.native
    if form is None:
        return False
    form.Invoke(Func[Type](fn))
    return True


_DLLS = {}


def _dll(name):
    """Build H: winframe's own copy of a DLL. Setting argtypes on ctypes.windll.user32's functions changed them for
    pywebview too (its window.move() passes None to SetWindowPos and failed with "wrong type"); a private WinDLL
    keeps the declarations here."""
    if name not in _DLLS:
        _DLLS[name] = ctypes.WinDLL(name)
    return _DLLS[name]


def start_drag(window, part):
    """Let Windows move (part 'caption') or resize (part 'n', 'se'…) the
    window, following the mouse button that is already down."""
    if sys.platform != "win32" or window is None or part not in HIT:
        return False
    user32 = _dll("user32")   # Build H: a private copy (see _dll)
    user32.SendMessageW.argtypes = [ctypes.c_void_p, ctypes.c_uint, ctypes.c_size_t, ctypes.c_ssize_t]

    def _go():
        hwnd = ctypes.c_void_p(window.native.Handle.ToInt64())
        user32.ReleaseCapture()
        user32.SendMessageW(hwnd, WM_NCLBUTTONDOWN, HIT[part], 0)   # returns when the button is released

    try:
        return _on_ui_thread(window, _go)
    except Exception:
        log.exception("start_drag(%s) failed", part)
        return False


def fit_maximized_bounds(window):
    """A borderless form maximises over the taskbar; keep it to the working
    area of the screen the window is on (relative to that screen)."""
    if sys.platform != "win32" or window is None:
        return False

    def _fit():
        from System.Drawing import Rectangle
        from System.Windows.Forms import Screen
        form = window.native
        scr = Screen.FromHandle(form.Handle)
        wa, b = scr.WorkingArea, scr.Bounds
        form.MaximizedBounds = Rectangle(wa.X - b.X, wa.Y - b.Y, wa.Width, wa.Height)

    try:
        return _on_ui_thread(window, _fit)
    except Exception:
        log.exception("fit_maximized_bounds failed")
        return False


# ---------------------------------------------------------------------------
# Bug fix 2026-10-17: a frameless window opened 16 x 39 px smaller than asked
# (1424 x 881 for 1440 x 920 at 100%). pywebview's BrowserForm sets Size while
# the form still has WinForms' default sizable border, then sets
# FormBorderStyle to None, and WinForms keeps the client size across a border
# change, so the window loses a frame's worth. It happens in pywebview's
# constructor, before enable_native_frame runs (which keeps the size it finds).
# ---------------------------------------------------------------------------
def keep_requested_size(window):
    """Give a frameless window the size it was created with (initial size x
    pywebview's scale). For a window created before webview.start (main.py),
    call it from window.events.before_show: that runs on the UI thread before
    the first Show, so the window never jumps. A window created later (the
    pop-outs) is built and shown inside create_window, so before_show has
    already fired when create_window returns: call it from events.shown."""
    if sys.platform != "win32" or getattr(window, "native", None) is None:
        return False
    w, h = getattr(window, "initial_width", None), getattr(window, "initial_height", None)
    if not w or not h:
        return False

    def _go():
        from System.Drawing import Size
        form = window.native
        if form.WindowState.ToString() != "Normal":
            return
        scale = getattr(form, "_scale", None) or form.DeviceDpi / 96   # pywebview's own logical-to-physical scale
        form.Size = Size(int(w * scale), int(h * scale))

    try:
        return _on_ui_thread(window, _go)
    except Exception:
        log.exception("keep_requested_size failed")
        return False


# ---------------------------------------------------------------------------
# Bug fix 2026-10-16: give the frameless window back what Windows needs for
# taskbar minimise, Aero Snap (drag to an edge, Win+arrows, snap layouts) and
# a correct maximise, without drawing a frame.
#
# A WinForms form with FormBorderStyle.None has no WS_THICKFRAME, WS_CAPTION,
# WS_SYSMENU or WS_MINIMIZEBOX, and Windows only offers those features to
# windows that have them. So the styles go back on, and a window subclass
# answers WM_NCCALCSIZE with "the client area is the whole window", which
# keeps the frame from being drawn. When maximised, Windows makes a framed
# window larger than the screen by its border, so the client area is clamped
# to the monitor's work area (the taskbar stays visible).
# ---------------------------------------------------------------------------
# Platform layer (step 0): the Windows-only types are made only on Windows, so this module imports on macOS and Linux
# (ctypes.WINFUNCTYPE doesn't exist there, and ctypes.wintypes may not import); every function below is a no-op there.
if sys.platform == "win32":
    from ctypes import wintypes as _W

GWL_STYLE = -16
WS_CAPTION, WS_SYSMENU, WS_THICKFRAME = 0x00C00000, 0x00080000, 0x00040000
WS_MINIMIZEBOX, WS_MAXIMIZEBOX = 0x00020000, 0x00010000
FRAME_STYLES = WS_CAPTION | WS_SYSMENU | WS_THICKFRAME | WS_MINIMIZEBOX | WS_MAXIMIZEBOX
WM_NCCALCSIZE, WM_NCACTIVATE = 0x0083, 0x0086
SWP_FRAMECHANGED, SWP_NOMOVE, SWP_NOSIZE, SWP_NOZORDER, SWP_NOACTIVATE = 0x20, 0x2, 0x1, 0x4, 0x10


if sys.platform == "win32":
    class _MONITORINFO(ctypes.Structure):
        _fields_ = [("cbSize", _W.DWORD), ("rcMonitor", _W.RECT), ("rcWork", _W.RECT), ("dwFlags", _W.DWORD)]

    _SUBCLASSPROC = ctypes.WINFUNCTYPE(ctypes.c_ssize_t, _W.HWND, _W.UINT, _W.WPARAM, _W.LPARAM,
                                       ctypes.c_size_t, ctypes.c_size_t)
_keep = {}   # the subclass callback must outlive the window, or Windows calls freed memory


def _api():
    u, c = _dll("user32"), _dll("comctl32")   # Build H: private copies, so pywebview's own calls keep their types
    u.GetWindowLongPtrW.restype = ctypes.c_ssize_t
    u.GetWindowLongPtrW.argtypes = [_W.HWND, ctypes.c_int]
    u.SetWindowLongPtrW.restype = ctypes.c_ssize_t
    u.SetWindowLongPtrW.argtypes = [_W.HWND, ctypes.c_int, ctypes.c_ssize_t]
    u.SetWindowPos.argtypes = [_W.HWND, _W.HWND, ctypes.c_int, ctypes.c_int, ctypes.c_int, ctypes.c_int, _W.UINT]
    u.MonitorFromWindow.restype = _W.HMONITOR
    u.MonitorFromWindow.argtypes = [_W.HWND, _W.DWORD]
    u.GetMonitorInfoW.argtypes = [_W.HMONITOR, ctypes.POINTER(_MONITORINFO)]
    u.IsZoomed.argtypes = [_W.HWND]
    u.IsIconic.argtypes = [_W.HWND]
    u.GetWindowRect.argtypes = [_W.HWND, ctypes.POINTER(_W.RECT)]
    c.SetWindowSubclass.argtypes = [_W.HWND, _SUBCLASSPROC, ctypes.c_size_t, ctypes.c_size_t]
    c.DefSubclassProc.restype = ctypes.c_ssize_t
    c.DefSubclassProc.argtypes = [_W.HWND, _W.UINT, _W.WPARAM, _W.LPARAM]
    return u, c


def _hwnd(window):
    return _W.HWND(window.native.Handle.ToInt64())


def work_area(hwnd):
    """The work area (screen minus taskbar) of the monitor the window is on."""
    u, _ = _api()
    mi = _MONITORINFO()
    mi.cbSize = ctypes.sizeof(_MONITORINFO)
    u.GetMonitorInfoW(u.MonitorFromWindow(hwnd, 2), ctypes.byref(mi))
    return mi.rcWork


def enable_native_frame(window, styles=None):
    """Call once the window exists (main.py: window.events.shown). styles: the frame styles to add
    (default all of FRAME_STYLES; Build H's popped-out windows take WS_THICKFRAME only, so they resize but never snap or maximise)."""
    if sys.platform != "win32" or getattr(window, "native", None) is None:
        return False
    u, c = _api()

    def proc(hwnd, msg, wparam, lparam, _id, _ref):
        try:
            if msg == WM_NCCALCSIZE and wparam:
                if u.IsZoomed(hwnd):
                    rc = ctypes.cast(lparam, ctypes.POINTER(_W.RECT)).contents   # NCCALCSIZE_PARAMS.rgrc[0]
                    wa = work_area(hwnd)
                    rc.left, rc.top = max(rc.left, wa.left), max(rc.top, wa.top)
                    rc.right, rc.bottom = min(rc.right, wa.right), min(rc.bottom, wa.bottom)
                return 0   # no frame: the client area is the whole window
            if msg == WM_NCACTIVATE:
                return c.DefSubclassProc(hwnd, msg, wparam, -1)   # -1: don't repaint a caption we don't draw
        except Exception:
            log.exception("frame subclass failed on message %#x", msg)
        return c.DefSubclassProc(hwnd, msg, wparam, lparam)

    cb = _SUBCLASSPROC(proc)

    def _go():
        hwnd = _hwnd(window)
        _keep[int(hwnd.value)] = cb
        c.SetWindowSubclass(hwnd, cb, 0x4E56, 0)
        style = u.GetWindowLongPtrW(hwnd, GWL_STYLE)
        u.SetWindowLongPtrW(hwnd, GWL_STYLE, style | (FRAME_STYLES if styles is None else styles))
        u.SetWindowPos(hwnd, None, 0, 0, 0, 0, SWP_FRAMECHANGED | SWP_NOMOVE | SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE)

    try:
        return _on_ui_thread(window, _go)
    except Exception:
        log.exception("enable_native_frame failed")
        return False


def is_maximized(window):
    """Ask Windows, rather than trusting a flag (a flag can fall out of step with Win+Up, snapping or the taskbar)."""
    if sys.platform != "win32" or getattr(window, "native", None) is None:
        return bool(getattr(window, "maximized", False))   # no real window (tests): fall back to what the window reports
    u, _ = _api()
    return bool(u.IsZoomed(_hwnd(window)))


def fill(window, axis):
    """Stretch the window to the full height ('v') or width ('h') of its screen's
    work area, as double-clicking a framed window's top or bottom edge does."""
    if sys.platform != "win32" or getattr(window, "native", None) is None or axis not in ("v", "h"):
        return False
    u, _ = _api()

    def _go():
        hwnd = _hwnd(window)
        r = _W.RECT()
        u.GetWindowRect(hwnd, ctypes.byref(r))
        wa = work_area(hwnd)
        if axis == "v":
            u.SetWindowPos(hwnd, None, r.left, wa.top, r.right - r.left, wa.bottom - wa.top, SWP_NOZORDER | SWP_NOACTIVATE)
        else:
            u.SetWindowPos(hwnd, None, wa.left, r.top, wa.right - wa.left, r.bottom - r.top, SWP_NOZORDER | SWP_NOACTIVATE)

    try:
        return _on_ui_thread(window, _go)
    except Exception:
        log.exception("fill(%s) failed", axis)
        return False


def repaint(window):
    """Coming back from minimised, WebView2 can stay blank until the window is
    resized: nudge the size by one pixel and back so it lays out and paints again."""
    if sys.platform != "win32" or getattr(window, "native", None) is None:
        return False

    def _go():
        form = window.native
        if form.WindowState.ToString() != "Normal":
            return
        w = form.Width
        form.Width = w + 1
        form.Width = w

    try:
        return _on_ui_thread(window, _go)
    except Exception:
        log.exception("repaint failed")
        return False


# ---------------------------------------------------------------------------
# Build H (mockup R34): sticky notes and the quick timer popped out as their own small windows (popout.py).
# They get no taskbar button (WS_EX_TOOLWINDOW, the chosen design), and a resize frame Windows doesn't draw,
# like the main window's, so a sticky resizes from its corner grip (start_drag 'se').
# ---------------------------------------------------------------------------
GWL_EXSTYLE = -20
WS_EX_TOOLWINDOW, WS_EX_APPWINDOW = 0x00000080, 0x00040000
SW_HIDE, SW_SHOWNOACTIVATE, SW_RESTORE = 0, 4, 9
HWND_TOPMOST, HWND_NOTOPMOST, HWND_TOP = -1, -2, 0


GWLP_HWNDPARENT = -8


def make_popout(window, app_id=None):
    """Call once a popped-out window is shown (popout.py wires it to window.events.shown).
    app_id (Build N, QC 111): the window gets its own taskbar button under that AppUserModelID (the Ask chat's, "NeuroVault.Ask"):
    a normal app window, owned by no other, instead of a tool window with none."""
    if sys.platform != "win32" or getattr(window, "native", None) is None:
        return False
    enable_native_frame(window, WS_THICKFRAME)
    u, _ = _api()
    u.ShowWindow.argtypes = [_W.HWND, ctypes.c_int]

    def _go():
        hwnd = _hwnd(window)
        ex = u.GetWindowLongPtrW(hwnd, GWL_EXSTYLE)
        # the taskbar only drops (or makes) the button when the window is shown again after the change
        u.ShowWindow(hwnd, SW_HIDE)
        if app_id:
            u.SetWindowLongPtrW(hwnd, GWLP_HWNDPARENT, 0)   # owned by no window: its own button, not grouped under its owner's
            u.SetWindowLongPtrW(hwnd, GWL_EXSTYLE, (ex | WS_EX_APPWINDOW) & ~WS_EX_TOOLWINDOW)
            if not _set_aumid(hwnd, app_id):
                log.warning("the window's AppUserModelID %s wasn't set", app_id)
        else:
            u.SetWindowLongPtrW(hwnd, GWL_EXSTYLE, (ex | WS_EX_TOOLWINDOW) & ~WS_EX_APPWINDOW)
        u.SetWindowPos(hwnd, None, 0, 0, 0, 0, SWP_FRAMECHANGED | SWP_NOMOVE | SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE)
        u.ShowWindow(hwnd, SW_SHOWNOACTIVATE)

    try:
        return _on_ui_thread(window, _go)
    except Exception:
        log.exception("make_popout failed")
        return False


def raise_window(window, on_top):
    """Bring a window to the front (Show it, from the status bar's list or the tray). A window that isn't kept on top
    goes topmost for a moment, which lifts it above other apps without making it stay there."""
    if sys.platform != "win32" or getattr(window, "native", None) is None:
        return False
    u, _ = _api()
    u.ShowWindow.argtypes = [_W.HWND, ctypes.c_int]
    u.SetForegroundWindow.argtypes = [_W.HWND]

    def _go():
        hwnd = _hwnd(window)
        if u.IsIconic(hwnd):
            u.ShowWindow(hwnd, SW_RESTORE)
        flags = SWP_NOMOVE | SWP_NOSIZE
        u.SetWindowPos(hwnd, _W.HWND(HWND_TOPMOST), 0, 0, 0, 0, flags)
        if not on_top:
            u.SetWindowPos(hwnd, _W.HWND(HWND_NOTOPMOST), 0, 0, 0, 0, flags)
        u.SetForegroundWindow(hwnd)

    try:
        return _on_ui_thread(window, _go)
    except Exception:
        log.exception("raise_window failed")
        return False


def set_topmost(window, on):
    """Keep on top (or not). pywebview's window.on_top sets the form's TopMost from the calling thread, which hung the
    app when an API call did it (checked 2026-10-17); this sets it on the window's own UI thread."""
    if sys.platform != "win32" or getattr(window, "native", None) is None:
        window.on_top = on   # no real window (tests)
        return True

    def _go():
        window.native.TopMost = bool(on)

    try:
        return _on_ui_thread(window, _go)
    except Exception:
        log.exception("set_topmost failed")
        return False


def set_memory_target(window, low):
    """RAM: WebView2's memory target, Low while the window is minimised (the page drops caches it can
    rebuild; scripts, the timer and its sounds keep running) and Normal again when it comes back."""
    if sys.platform != "win32" or getattr(window, "native", None) is None:
        return False

    def _go():
        from Microsoft.Web.WebView2.Core import CoreWebView2MemoryUsageTargetLevel as Level
        core = window.native.browser.webview.CoreWebView2
        if core is not None:
            core.MemoryUsageTargetLevel = Level.Low if low else Level.Normal

    try:
        return _on_ui_thread(window, _go)
    except Exception:
        log.exception("set_memory_target(%s) failed", low)
        return False


# ==== Build N · the window and taskbar icon: the hypercube in the current theme and accent (design profile "The logo
# wears your theme", 2026-10-18). The page draws the tile at 16/24/32/48/256 px (logo-vars.js logoPng) and api.window_icon
# hands the PNGs here. Windows (Vista and later) makes an icon straight from PNG bytes (CreateIconFromResourceEx), so the app
# needs no image library. Before the page has drawn, the static neurovault.ico (Soft Slate + Sand) is the icon. ====
WM_SETICON, ICON_SMALL, ICON_BIG = 0x0080, 0, 1
IMAGE_ICON, LR_LOADFROMFILE = 1, 0x0010
_icons = {}   # hwnd -> (small, big): the icons in use, destroyed once they're replaced


def _icon_api():
    u = _dll("user32")
    u.CreateIconFromResourceEx.restype = _W.HICON
    u.CreateIconFromResourceEx.argtypes = [ctypes.c_char_p, _W.DWORD, _W.BOOL, _W.DWORD, ctypes.c_int, ctypes.c_int, _W.UINT]
    u.LoadImageW.restype = _W.HANDLE
    u.LoadImageW.argtypes = [_W.HINSTANCE, _W.LPCWSTR, _W.UINT, ctypes.c_int, ctypes.c_int, _W.UINT]
    u.SendMessageW.argtypes = [ctypes.c_void_p, ctypes.c_uint, ctypes.c_size_t, ctypes.c_ssize_t]   # as start_drag declares it
    u.DestroyIcon.argtypes = [_W.HICON]
    u.GetDpiForWindow.restype = _W.UINT
    u.GetDpiForWindow.argtypes = [_W.HWND]
    return u


def icon_pick(sizes, want):
    """The size to hand Windows for a want-px icon: the smallest that's at least as big (Windows scales down cleanly),
    else the biggest."""
    up = sorted(s for s in sizes if s >= want)
    return up[0] if up else max(sizes)


def set_icon(window, pngs=None, ico_path=None):
    """The window's small (title, Alt+Tab) and big (taskbar) icon: pngs {px: PNG bytes} from the page, or the .ico at
    ico_path. Sized for the window's DPI (16 and 32 px at 100%)."""
    if sys.platform != "win32" or getattr(window, "native", None) is None or not (pngs or ico_path):
        return False

    def _go():
        u, hwnd = _icon_api(), _hwnd(window)
        dpi = u.GetDpiForWindow(hwnd) or 96
        want = (round(16 * dpi / 96), round(32 * dpi / 96))
        if pngs:
            def make(px):
                b = pngs[px]
                return u.CreateIconFromResourceEx(b, len(b), True, 0x00030000, px, px, 0)
            small, big = (make(icon_pick(pngs, w)) for w in want)
        else:
            small, big = (u.LoadImageW(None, ico_path, IMAGE_ICON, w, w, LR_LOADFROMFILE) for w in want)
        if not small or not big:
            raise OSError("Windows couldn't make the icon")
        u.SendMessageW(hwnd, WM_SETICON, ICON_SMALL, small)
        u.SendMessageW(hwnd, WM_SETICON, ICON_BIG, big)
        old = _icons.get(int(hwnd.value or 0))
        _icons[int(hwnd.value or 0)] = (small, big)
        for h in old or ():
            u.DestroyIcon(h)

    try:
        return _on_ui_thread(window, _go)
    except Exception:
        log.exception("set_icon failed")
        return False


# NeuroVault runs under python.exe: without an AppUserModelID of its own, Windows can group its taskbar button with Python's
# and show Python's icon, whatever WM_SETICON says. main.py sets this before any window is made. Pinning to the taskbar
# would also need a Start menu shortcut carrying the same ID: the installer's job, later.
APP_ID = "NeuroVault.App"


def set_app_id(app_id=APP_ID):
    """This process's AppUserModelID (shell32 SetCurrentProcessExplicitAppUserModelID). True when Windows took it."""
    if sys.platform != "win32":
        return False
    try:
        s = _dll("shell32")
        s.SetCurrentProcessExplicitAppUserModelID.restype = ctypes.c_long
        s.SetCurrentProcessExplicitAppUserModelID.argtypes = [ctypes.c_wchar_p]
        return s.SetCurrentProcessExplicitAppUserModelID(app_id) == 0
    except Exception:
        log.exception("set_app_id failed")
        return False


# ---- Build N · QC 111 (feedback: "it need its own windows icon in the task bar thingy"): one window's own AppUserModelID,
# through its property store (SHGetPropertyStoreForWindow, PKEY_AppUserModel_ID), so Windows gives it a taskbar button of
# its own instead of grouping it with NeuroVault's. Set while the window is hidden (make_popout), so the button is made anew ----
class _GUID(ctypes.Structure):
    _fields_ = [("Data1", ctypes.c_ulong), ("Data2", ctypes.c_ushort), ("Data3", ctypes.c_ushort), ("Data4", ctypes.c_ubyte * 8)]


def _guid(text):
    import uuid
    b = uuid.UUID(text).bytes_le
    g = _GUID()
    ctypes.memmove(ctypes.byref(g), b, 16)
    return g


class _PROPERTYKEY(ctypes.Structure):
    _fields_ = [("fmtid", _GUID), ("pid", ctypes.c_ulong)]


class _PROPVARIANT(ctypes.Structure):   # vt, three reserved words, then the value (a pointer here) and the rest of the union
    _fields_ = [("vt", ctypes.c_ushort), ("r1", ctypes.c_ushort), ("r2", ctypes.c_ushort), ("r3", ctypes.c_ushort),
                ("p", ctypes.c_void_p), ("p2", ctypes.c_void_p)]


IID_IPropertyStore = "886D8EEB-8CF2-4446-8D02-CDBA1DBDCF99"
PKEY_AppUserModel_ID = ("9F4C2855-9F79-4B39-A8D0-E1D42DE1D5F3", 5)
VT_EMPTY, VT_LPWSTR = 0, 31


def _set_aumid(hwnd, app_id):
    """The window's own AppUserModelID (None or "" clears it). True when Windows took it. Runs on the window's thread."""
    if sys.platform != "win32":
        return False
    try:
        s = _dll("shell32")
        s.SHGetPropertyStoreForWindow.restype = ctypes.c_long
        s.SHGetPropertyStoreForWindow.argtypes = [ctypes.c_void_p, ctypes.POINTER(_GUID), ctypes.POINTER(ctypes.c_void_p)]
        store = ctypes.c_void_p()
        iid = _guid(IID_IPropertyStore)
        if s.SHGetPropertyStoreForWindow(hwnd, ctypes.byref(iid), ctypes.byref(store)) != 0 or not store:
            return False
        vtbl = ctypes.cast(store, ctypes.POINTER(ctypes.POINTER(ctypes.c_void_p))).contents
        HR = ctypes.c_long
        set_value = ctypes.WINFUNCTYPE(HR, ctypes.c_void_p, ctypes.POINTER(_PROPERTYKEY), ctypes.POINTER(_PROPVARIANT))(vtbl[6])
        commit = ctypes.WINFUNCTYPE(HR, ctypes.c_void_p)(vtbl[7])
        release = ctypes.WINFUNCTYPE(ctypes.c_ulong, ctypes.c_void_p)(vtbl[2])
        key = _PROPERTYKEY(_guid(PKEY_AppUserModel_ID[0]), PKEY_AppUserModel_ID[1])
        text = ctypes.create_unicode_buffer(app_id or "")
        pv = _PROPVARIANT()
        pv.vt = VT_LPWSTR if app_id else VT_EMPTY
        pv.p = ctypes.cast(text, ctypes.c_void_p).value if app_id else None
        try:
            ok = set_value(store, ctypes.byref(key), ctypes.byref(pv)) == 0 and commit(store) == 0
        finally:
            release(store)
        return ok
    except Exception:
        log.exception("_set_aumid failed")
        return False


def window_app_id(suffix):
    """A pop-out's own AppUserModelID from this process's: "NeuroVault.App" (the app) → "NeuroVault.<suffix>"; any other
    (the trial's "NeuroVault.Trial") → "<that>.<suffix>"."""
    base = (app_id() if sys.platform == "win32" else None) or APP_ID
    return f"NeuroVault.{suffix}" if base == APP_ID else f"{base}.{suffix}"


def app_id():
    """The AppUserModelID this process has set, or None."""
    if sys.platform != "win32":
        return None
    s, o = _dll("shell32"), _dll("ole32")
    s.GetCurrentProcessExplicitAppUserModelID.restype = ctypes.c_long
    s.GetCurrentProcessExplicitAppUserModelID.argtypes = [ctypes.POINTER(ctypes.c_wchar_p)]
    o.CoTaskMemFree.argtypes = [ctypes.c_void_p]
    out = ctypes.c_wchar_p()
    if s.GetCurrentProcessExplicitAppUserModelID(ctypes.byref(out)) != 0:
        return None
    try:
        return out.value
    finally:
        o.CoTaskMemFree(ctypes.cast(out, ctypes.c_void_p))
# ==== end Build N ====
