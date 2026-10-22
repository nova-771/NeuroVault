"""The Linux half of platform_layer (freedesktop folders and xdg-open). Untested on a real Linux PC yet.
Later steps: the GTK window icon and urgency hint, Hunspell through pyenchant (LGPL-2.1)."""
import logging
import os
import re

from .common import allow_foreground, flash, popout_app_id, popout_frame, recycle, run, set_app_identity, set_window_icon, total_memory, vulkan_present, pid_alive  # noqa: F401

log = logging.getLogger(__name__)


def data_dir():
    base = os.environ.get("XDG_DATA_HOME") or os.path.join(os.path.expanduser("~"), ".local", "share")
    return os.path.join(base, "neurovault")


def documents_dir():
    """XDG_DOCUMENTS_DIR from user-dirs.dirs (what `xdg-user-dir DOCUMENTS` reads), else ~/Documents."""
    home = os.path.expanduser("~")
    conf = os.path.join(os.environ.get("XDG_CONFIG_HOME") or os.path.join(home, ".config"), "user-dirs.dirs")
    try:
        with open(conf, encoding="utf-8") as f:
            for line in f:
                m = re.match(r'\s*XDG_DOCUMENTS_DIR\s*=\s*"(.*)"\s*$', line)
                if m:
                    path = m.group(1).replace("$HOME", home)
                    if os.path.isabs(path) and os.path.normpath(path) != os.path.normpath(home):   # $HOME/ means "not set"
                        return path
    except OSError:
        pass
    return os.path.join(home, "Documents")


def open_path(path):
    run(["xdg-open", path])


def reveal_path(path):
    """The folder the file is in (xdg-open can't select a file; FileManager1 over D-Bus can, a later step)."""
    run(["xdg-open", os.path.dirname(path) or path])


def keystore_name():
    return "your system keyring"
