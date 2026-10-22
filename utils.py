import __main__
import os
import sys


def frozen_data_dir():
    """Packaging: the packaged app's data folder, %LOCALAPPDATA%\\NeuroVault (made on demand). The install folder may be
    read-only and goes on an uninstall, so the database, config.json, attachments and Whisper's models live here,
    beside the AI models, engine, voices and dictionary that already do."""
    import platform_layer   # macOS: ~/Library/Application Support/NeuroVault; Linux: ~/.local/share/neurovault
    d = platform_layer.data_dir()
    os.makedirs(d, exist_ok=True)
    return d


def app_dir():
    """Directory the app's data/config files live next to — %LOCALAPPDATA%\\NeuroVault for the packaged app
    (frozen_data_dir), or main.py's folder in dev. Never the process cwd, so the app behaves the same regardless
    of where it's launched from."""
    if getattr(sys, "frozen", False):
        return frozen_data_dir()
    return os.path.dirname(os.path.abspath(__main__.__file__))


def frozen_output_to_log():
    """Packaging: a windowed exe has no console, so sys.stdout / sys.stderr are None and the log goes nowhere.
    The packaged app writes them to logs\\neurovault.log in its data folder (the last run's is kept as .log.1).
    Running from source, this does nothing."""
    if not getattr(sys, "frozen", False):
        return
    try:
        folder = os.path.join(frozen_data_dir(), "logs")
        os.makedirs(folder, exist_ok=True)
        path = os.path.join(folder, "neurovault.log")
        if os.path.exists(path):
            os.replace(path, path + ".1")
        out = open(path, "w", encoding="utf-8", errors="replace", buffering=1)
    except OSError:
        return
    sys.stdout = sys.stderr = out


def resource_path(relative_path):
    """Get absolute path to a bundled resource (e.g. frontend/index.html),
    works for dev and for PyInstaller."""
    try:
        # PyInstaller creates a temp folder and stores path in _MEIPASS
        base_path = sys._MEIPASS
    except Exception:
        base_path = app_dir()

    return os.path.join(base_path, relative_path)
