"""
platform_layer — the one place NeuroVault asks the operating system for something (cross-platform step 0).

Every Windows-only piece goes through here, so the rest of the app imports and runs on macOS and Linux too:

    OS                      "windows" | "macos" | "linux" (the key per-OS lists and the engine catalog use)
    data_dir()              the per-user data folder: %LOCALAPPDATA%\\NeuroVault, ~/Library/Application Support/NeuroVault,
                            $XDG_DATA_HOME/neurovault (~/.local/share/neurovault). Never made here; callers make it.
    documents_dir()         the system's own answer for Documents (Windows: SHGetFolderPathW; Linux: user-dirs.dirs)
    recycle(path)           to the Recycle Bin / Trash; raises RecycleError when there's no bin (callers then keep the file)
    open_path(path)         in its default app (a folder opens in the file manager)
    reveal_path(path)       the file manager, with the file selected where the system can
    set_app_identity()      Windows' AppUserModelID; elsewhere the bundle id / .desktop file does it (False)
    set_window_icon(...)    the live window/taskbar icon; False where the system can't
    flash()                 ask for attention (taskbar flash); False where not done yet
    allow_foreground()      let the running NeuroVault come to the front (a second launch, QC 116); False where not needed
    instance                one NeuroVault at a time: claim() / hand_off() on 127.0.0.1 (platform_layer.instance, QC 116)
    keystore_name()         what the system calls the place cloud keys are kept, for messages
    engine_builds(engine)   this OS's llama-server builds from ai_models.json ({variant: {file, bytes, sha256, url}})
    pid_alive(pid)          is that process still running (the AI engine's lock file)
    total_memory(), vulkan_present()   off-Windows answers for local_ai (Windows keeps its own DXGI / job-object code)
    spell                   the system spell checker (platform_layer.spell)

windows.py wraps the existing win*.py code unchanged; macos.py and linux.py hold the other two; common.py the shared
fallbacks. The half is picked once, at import, from sys.platform.
"""
import sys

from .common import RecycleError  # noqa: F401  (re-exported)

if sys.platform == "win32":
    from . import windows as _impl
    OS = "windows"
elif sys.platform == "darwin":
    from . import macos as _impl
    OS = "macos"
else:
    from . import linux as _impl
    OS = "linux"

data_dir = _impl.data_dir
documents_dir = _impl.documents_dir
recycle = _impl.recycle
open_path = _impl.open_path
reveal_path = _impl.reveal_path
set_app_identity = _impl.set_app_identity
set_window_icon = _impl.set_window_icon
popout_frame = _impl.popout_frame        # Build N (QC 111): a pop-out's frame, with its own taskbar button when app_id is given
popout_app_id = _impl.popout_app_id      # QC 111: that button's AppUserModelID ("NeuroVault.Ask"; None off Windows)
flash = _impl.flash
allow_foreground = _impl.allow_foreground
keystore_name = _impl.keystore_name
total_memory = _impl.total_memory
vulkan_present = _impl.vulkan_present
pid_alive = _impl.pid_alive


def engine_builds(engine):
    """This OS's llama-server builds. Windows keeps the catalog's original "builds" (so older catalog.json files still
    work); macOS and Linux read "os_builds": {"macos": {...}, "linux": {...}} and get {} until the catalog has them."""
    if OS == "windows":
        return engine.get("builds") or {}
    return (engine.get("os_builds") or {}).get(OS) or {}


from . import spell  # noqa: E402,F401  (after OS: spell picks its backend from it)
from . import instance  # noqa: E402,F401  (QC 116: uses pid_alive)
