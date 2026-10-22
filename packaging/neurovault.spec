# PyInstaller spec for NeuroVault: one folder, windowed. Run it through packaging/build_exe.py, which builds from a
# clean `git archive` of the commit (never a working folder), so no database, config.json or downloaded model can
# get in. Licence notes: THIRD-PARTY-NOTICES.md, "Packaging the installer".
import os

from PyInstaller.utils.hooks import collect_dynamic_libs

ROOT = os.path.abspath(os.path.join(SPECPATH, ".."))   # noqa: F821 (SPECPATH is set by PyInstaller)

# Never shipped: dev and test files (frontend/tests, check.js is only loaded with ?check=1)
FRONTEND_SKIP_DIRS = {"tests"}
FRONTEND_SKIP_FILES = {"check.js", "check-viewer.js"}   # Build DV: the viewer's own check (viewer.html?check=1)


def frontend_datas():
    out = []
    base = os.path.join(ROOT, "frontend")
    for folder, dirs, files in os.walk(base):
        dirs[:] = [d for d in dirs if d not in FRONTEND_SKIP_DIRS]
        rel = os.path.relpath(folder, ROOT)
        for f in files:
            if f not in FRONTEND_SKIP_FILES:
                out.append((os.path.join(folder, f), rel))
    return out


datas = frontend_datas() + [
    (os.path.join(ROOT, f), ".") for f in ("ai_models.json", "font_list.json", "dict_list.json", "neurovault.ico")
]

# Autocorrect's word frequencies (SymSpell, MIT; Google Books Ngram CC BY 3.0 + SCOWL), shipped beside the modules,
# where autocorrect.freq_path() looks after the dictionary folder. Feedback: "Bundle it" (2026-10-18).
FREQ = os.path.join(SPECPATH, "data", "frequency_dictionary_en_82_765.txt")   # noqa: F821
if not os.path.isfile(FREQ):
    raise SystemExit(f"Missing {FREQ}: autocorrect's word list must ship with the app")
datas.append((FREQ, "."))

a = Analysis(   # noqa: F821
    [os.path.join(ROOT, "main.py")],
    pathex=[ROOT],
    binaries=collect_dynamic_libs("sherpa_onnx"),
    datas=datas,
    hiddenimports=[],
    excludes=[
        # dev and test modules (not imported by the app; listed so they can never be pulled in)
        "test_api", "dev_bridge", "dev_dict_sample", "migrate_time_tracker",
        # optional, not shipped: the tray (LGPL pystray) and global hotkeys
        "pystray", "keyboard",
        "tkinter", "_tkinter", "unittest", "pydoc_data",
    ],
    noarchive=False,
)

# Steinberg's ASIO SDK build of PortAudio stays out (licence audit flag 5); the app uses the plain MIT one
a.binaries = [b for b in a.binaries if "asio" not in os.path.basename(b[0]).lower()]

pyz = PYZ(a.pure)   # noqa: F821

exe = EXE(   # noqa: F821
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name="NeuroVault",
    icon=os.path.join(ROOT, "neurovault.ico"),
    version=os.path.join(SPECPATH, "version_info.txt"),   # noqa: F821
    console=False,
    upx=False,
)

coll = COLLECT(   # noqa: F821
    exe,
    a.binaries,
    a.datas,
    upx=False,
    name="NeuroVault",
)
