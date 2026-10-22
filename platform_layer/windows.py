"""The Windows half of platform_layer: the code that was spread over the app, moved or wrapped here unchanged."""
import ctypes
import logging
import os
import subprocess

from .common import RecycleError

log = logging.getLogger(__name__)


def data_dir():
    return os.path.join(os.environ.get("LOCALAPPDATA") or os.path.expanduser("~"), "NeuroVault")


def documents_dir():
    """Windows' own answer (so a Documents moved to OneDrive or another drive is found), else ~/Documents."""
    try:
        from ctypes import wintypes
        buf = ctypes.create_unicode_buffer(wintypes.MAX_PATH)
        if ctypes.windll.shell32.SHGetFolderPathW(None, 5, None, 0, buf) == 0 and buf.value:   # CSIDL_PERSONAL
            return buf.value
    except Exception:
        log.exception("Couldn't ask Windows for the Documents folder")
    return os.path.join(os.path.expanduser("~"), "Documents")


# ---- The recycle bin: SHFileOperationW with FO_DELETE and FOF_ALLOWUNDO, so the file can be restored ----
FO_DELETE = 0x0003
FOF_SILENT, FOF_NOCONFIRMATION, FOF_ALLOWUNDO, FOF_NOERRORUI = 0x0004, 0x0010, 0x0040, 0x0400


def recycle(path):
    from ctypes import wintypes

    class SHFILEOPSTRUCTW(ctypes.Structure):
        _fields_ = [("hwnd", wintypes.HWND), ("wFunc", wintypes.UINT), ("pFrom", wintypes.LPCWSTR),
                    ("pTo", wintypes.LPCWSTR), ("fFlags", ctypes.c_ushort), ("fAnyOperationsAborted", wintypes.BOOL),
                    ("hNameMappings", ctypes.c_void_p), ("lpszProgressTitle", wintypes.LPCWSTR)]

    op = SHFILEOPSTRUCTW(hwnd=None, wFunc=FO_DELETE, pFrom=path + "\0", pTo=None,  # pFrom ends with two NULs
                         fFlags=FOF_ALLOWUNDO | FOF_NOCONFIRMATION | FOF_SILENT | FOF_NOERRORUI)
    rc = ctypes.windll.shell32.SHFileOperationW(ctypes.byref(op))
    if rc or op.fAnyOperationsAborted or os.path.exists(path):
        raise RecycleError(f"Windows couldn't move {os.path.basename(path)} to the recycle bin (code {rc}).")


def open_path(path):
    os.startfile(path)  # noqa: S606


def reveal_path(path):
    subprocess.Popen(["explorer", "/select,", path])


def set_app_identity(app_id=None):
    import winframe
    return winframe.set_app_id() if app_id is None else winframe.set_app_id(app_id)


def popout_frame(window, app_id=None):   # Build N (QC 111): a pop-out's frame; app_id: its own taskbar button
    import winframe
    return winframe.make_popout(window, app_id)


def popout_app_id(suffix):   # QC 111: "NeuroVault.Ask", or "NeuroVault.Trial.Ask" in the trial
    import winframe
    return winframe.window_app_id(suffix)


def set_window_icon(window, pngs=None, ico_path=None):
    import winframe
    return winframe.set_icon(window, pngs) if pngs else winframe.set_icon(window, ico_path=ico_path)


def flash():
    import winflash
    return winflash.flash_taskbar()


def allow_foreground():
    """QC 116: a second launch (it has the foreground, Explorer just started it) lets the running NeuroVault take the front
    before handing it its files; otherwise Windows only flashes its taskbar button."""
    try:
        return bool(ctypes.windll.user32.AllowSetForegroundWindow(-1))   # ASFW_ANY
    except Exception:
        return False


def keystore_name():
    return "Windows Credential Manager"


def total_memory():
    import local_ai
    return local_ai.total_memory()


def vulkan_present():
    import local_ai
    return local_ai.vulkan_present()


_K32 = None


def pid_alive(pid):
    """True while a process with this id is running (QC 87: the AI engine's lock file names the process that holds it)."""
    if not isinstance(pid, int) or isinstance(pid, bool) or pid <= 0:
        return False
    global _K32
    from ctypes import wintypes
    if _K32 is None:
        _K32 = ctypes.WinDLL("kernel32", use_last_error=True)   # its own copy, so the argument types below stay ours
        _K32.OpenProcess.argtypes = [wintypes.DWORD, wintypes.BOOL, wintypes.DWORD]
        _K32.OpenProcess.restype = wintypes.HANDLE
        _K32.GetExitCodeProcess.argtypes = [wintypes.HANDLE, ctypes.POINTER(wintypes.DWORD)]
        _K32.CloseHandle.argtypes = [wintypes.HANDLE]
    h = _K32.OpenProcess(0x1000, False, pid)   # PROCESS_QUERY_LIMITED_INFORMATION
    if not h:
        return ctypes.get_last_error() == 5   # access denied: it exists
    try:
        code = wintypes.DWORD()
        return bool(_K32.GetExitCodeProcess(h, ctypes.byref(code))) and code.value == 259   # STILL_ACTIVE
    finally:
        _K32.CloseHandle(h)
