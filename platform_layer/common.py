"""The fallbacks macOS and Linux share (platform_layer). Nothing here runs on Windows except RecycleError."""
import ctypes.util
import logging
import os
import subprocess

log = logging.getLogger(__name__)


class RecycleError(OSError):
    """The file couldn't go to the bin. Said to the user as it is; the caller keeps the file (never deletes it outright)."""


def recycle(path):
    """To the system's Trash through Send2Trash (BSD-3), when it's installed. It isn't yet: packaging adds it per OS."""
    try:
        from send2trash import send2trash
    except ImportError:
        raise RecycleError("Moving files to the bin needs the Send2Trash package, which isn't installed.")
    try:
        send2trash(path)
    except Exception as e:   # Linux: TrashPermissionError on a drive with no .Trash folder
        raise RecycleError(f"The system couldn't move {os.path.basename(path)} to the bin ({e}).")


def run(args):
    """Starts a helper (open, xdg-open) and doesn't wait for it."""
    subprocess.Popen(args, stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


def set_app_identity(app_id=None):
    return False


def set_window_icon(window, pngs=None, ico_path=None):
    return False   # the page already copes with False


def flash():
    return False


def allow_foreground():   # QC 116: the running NeuroVault may come to the front (Windows only needs asking)
    return False


def total_memory():
    """Bytes of RAM from sysconf (Linux; most Unixes), or 0 when it can't be read."""
    try:
        return int(os.sysconf("SC_PAGE_SIZE")) * int(os.sysconf("SC_PHYS_PAGES"))
    except (ValueError, OSError, AttributeError):
        return 0


def vulkan_present():
    try:
        return bool(ctypes.util.find_library("vulkan"))
    except Exception:
        return False


def pid_alive(pid):
    """True while a process with this id is running (QC 87: the AI engine's lock file names the process that holds it)."""
    if not isinstance(pid, int) or isinstance(pid, bool) or pid <= 0:
        return False
    try:
        os.kill(pid, 0)
        return True
    except ProcessLookupError:
        return False
    except OSError:
        return True   # it exists, but isn't ours to signal


def popout_frame(window, app_id=None):   # Build N (QC 111): a pop-out's own frame and taskbar button: Windows only for now
    return False


def popout_app_id(suffix):   # QC 111: no AppUserModelID off Windows (the bundle id / .desktop file names the app)
    return None
