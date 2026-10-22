"""
Best-effort taskbar icon flash on Windows, via raw ctypes calls to
user32.dll (FlashWindowEx) — no pywin32 dependency needed. Finds the
window by its title rather than relying on pywebview to expose the HWND,
since that isn't part of pywebview's public API.

This is inherently untestable outside a real Windows desktop session, so
it's wrapped defensively: any failure just returns False rather than
raising, and it's a silent no-op on non-Windows platforms.
"""
import logging
import sys

log = logging.getLogger(__name__)


def flash_taskbar(title: str = "NeuroVault", count: int = 5) -> bool:
    if sys.platform != "win32":
        return False

    import ctypes

    try:
        user32 = ctypes.windll.user32
        hwnd = user32.FindWindowW(None, title)
        if not hwnd:
            return False

        FLASHW_ALL = 0x00000003
        FLASHW_TIMERNOFG = 0x0000000C

        class FLASHWINFO(ctypes.Structure):
            _fields_ = [
                ("cbSize", ctypes.c_uint),
                ("hwnd", ctypes.c_void_p),
                ("dwFlags", ctypes.c_uint),
                ("uCount", ctypes.c_uint),
                ("dwTimeout", ctypes.c_uint),
            ]

        info = FLASHWINFO(ctypes.sizeof(FLASHWINFO), hwnd, FLASHW_ALL | FLASHW_TIMERNOFG, count, 0)
        user32.FlashWindowEx(ctypes.byref(info))
        return True
    except Exception as e:
        log.warning("[taskbar] flash failed: %s", e)
        return False
