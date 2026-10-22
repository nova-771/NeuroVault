"""The macOS half of platform_layer. Untested on a real Mac (none here yet): every call is plain and has a safe answer.
Later steps: the live Dock icon (NSApp.setApplicationIconImage_), requestUserAttention_, NSSpellChecker (pyobjc, MIT)."""
import logging
import os
import subprocess

from .common import allow_foreground, flash, popout_app_id, popout_frame, recycle, run, set_app_identity, set_window_icon, vulkan_present, pid_alive  # noqa: F401

log = logging.getLogger(__name__)


def data_dir():
    return os.path.join(os.path.expanduser("~"), "Library", "Application Support", "NeuroVault")


def documents_dir():
    return os.path.join(os.path.expanduser("~"), "Documents")


def open_path(path):
    run(["open", path])


def reveal_path(path):
    run(["open", "-R", path])   # Finder, with the file selected


def keystore_name():
    return "the macOS Keychain"


def total_memory():
    try:
        out = subprocess.run(["sysctl", "-n", "hw.memsize"], capture_output=True, text=True, timeout=5)
        return int(out.stdout.strip() or 0)
    except Exception:
        log.exception("sysctl hw.memsize failed")
        return 0
