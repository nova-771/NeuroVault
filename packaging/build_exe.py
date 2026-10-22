"""
Packaging: build NeuroVault as a Windows app (PyInstaller one folder, then an Inno Setup installer).

Run it with the packaging venv's Python (never the venv the app is developed in), from anywhere:

    <venv>\\Scripts\\python.exe packaging\\build_exe.py [--out FOLDER] [--installer] [--allow-dirty]

What it does, all inside --out (default: NeuroVault-build beside the main checkout's folder, outside every checkout):
  1. `git archive` of HEAD into src\\<commit>\\, so only committed, tracked files are built: no database, config.json,
     downloaded model or scratch file from a working folder can get in. The same archive, zipped, is the GPL source
     that ships with the app (source\\NeuroVault-<commit>-source.zip).
  2. PyInstaller with packaging\\neurovault.spec → dist\\NeuroVault\\NeuroVault.exe.
  3. The licence bundle next to the exe: LICENSE, THIRD-PARTY-NOTICES.md, the source zip, and soundfile's LGPL text.
  4. A check of the output: it fails if anything that must never ship is in it (dev scripts, tests, databases,
     config.json, models, the ASIO PortAudio DLL).
  5. With --installer: Inno Setup's ISCC on packaging\\neurovault.iss → installer\\NeuroVault-Setup-<version>.exe.
     It bundles Microsoft's WebView2 bootstrapper, which must be at <out>\\redist\\MicrosoftEdgeWebview2Setup.exe.
"""
import argparse
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import zipfile

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(HERE)

# Anything with these names (or under these folders) in the output fails the build
FORBIDDEN_FILES = {"test_api.py", "dev_bridge.py", "dev_dict_sample.py", "migrate_time_tracker.py", "check.js",
                   "config.json", "glossary.json", "catalog.json"}
FORBIDDEN_EXTS = {".db", ".db-wal", ".db-shm", ".bak", ".gguf", ".onnx"}
FORBIDDEN_DIRS = {"tests", "models", "attachments", ".neurovault", "design", "docs", ".claude", "sandbox-tests"}
ISCC_PLACES = [os.path.join(os.environ.get("LOCALAPPDATA", ""), "Programs", "Inno Setup 6", "ISCC.exe"),
               os.path.join(os.environ.get("ProgramFiles(x86)", ""), "Inno Setup 6", "ISCC.exe"),
               os.path.join(os.environ.get("ProgramFiles", ""), "Inno Setup 6", "ISCC.exe")]


def default_out():
    """NeuroVault-build beside the main checkout's folder (worktrees share it), outside every checkout."""
    common = git("rev-parse", "--path-format=absolute", "--git-common-dir")
    return os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(common))), "NeuroVault-build")


def run(args, **kw):
    print(">", " ".join(args), flush=True)
    return subprocess.run(args, check=True, **kw)


def git(*args):
    return subprocess.run(["git", "-C", REPO, *args], check=True, capture_output=True, text=True).stdout.strip()


def app_version(root):
    """VERSION from version.py, the one place it's set (Settings → About shows the same)."""
    ns = {}
    exec(open(os.path.join(root, "version.py"), encoding="utf-8").read(), ns)
    v = ns["VERSION"]
    if not all(p.isdigit() for p in v.split(".")) or not 1 <= len(v.split(".")) <= 4:
        raise SystemExit(f"version.py: {v!r} isn't like 0.1.0")
    return v


def write_version_info(src, version):
    """Fill the version resource template in the clean tree (the exe's Properties → Details)."""
    p = os.path.join(src, "packaging", "version_info.txt")
    parts = [int(x) for x in version.split(".")] + [0] * (4 - len(version.split(".")))
    text = open(p, encoding="utf-8").read().replace("VERSION_TUPLE", str(tuple(parts))).replace("VERSION_TEXT", version)
    open(p, "w", encoding="utf-8").write(text)


# What must be in the build (paths under _internal, and modules in PyInstaller's archive); the build fails without them.
# Platform layer (step 0): PyInstaller builds on the OS it runs on, so each OS has its own lists, keyed like
# platform_layer.OS; the lists for this OS are added to the shared ones. macOS and Linux aren't built yet: theirs are
# what cross-platform-options.md says they need, to be confirmed on their first build.
BUILD_OS = "windows" if sys.platform == "win32" else "macos" if sys.platform == "darwin" else "linux"
REQUIRED_FILES = ["frequency_dictionary_en_82_765.txt", "neurovault.ico", "ai_models.json",
                  os.path.join("frontend", "cloud_providers.json"),
                  os.path.join("frontend", "vendor", "highlight-11.11.1.min.js"),
                  os.path.join("frontend", "viewer.html"), os.path.join("frontend", "viewer", "viewer.js"),   # Build DV: the document viewer
                  os.path.join("frontend", "viewer", "renderers.js"), os.path.join("frontend", "viewer", "vendor", "vendor-plan.json"),
                  os.path.join("frontend", "licences", "symspell-frequencies.txt"),
                  os.path.join("_soundfile_data", "COPYING")]
REQUIRED_METADATA = ["keyring"]   # keyring finds its backend (Windows: Credential Manager) through its entry points
REQUIRED_MODULES = ["version", "netssl", "errors", "ai_attach", "ai_guard", "agent", "vault_disk", "cloud_ai", "autocorrect", "truststore", "docviewer",
                    "platform_layer", "platform_layer.spell"]
REQUIRED_FILES_BY_OS = {"windows": [], "macos": [], "linux": []}
REQUIRED_METADATA_BY_OS = {"windows": [], "macos": [], "linux": ["secretstorage"]}   # matched lowercase, like keyring
REQUIRED_MODULES_BY_OS = {
    "windows": ["platform_layer.windows", "keyring.backends.Windows", "win32ctypes"],
    # Keychain through keyring; pywebview on WKWebView (pyobjc); the Trash through Send2Trash
    "macos": ["platform_layer.macos", "keyring.backends.macOS", "webview.platforms.cocoa", "objc", "AppKit", "WebKit", "send2trash"],
    # the Secret Service (GNOME Keyring / KWallet) through keyring; pywebview on WebKitGTK (PyGObject); freedesktop Trash
    "linux": ["platform_layer.linux", "keyring.backends.SecretService", "secretstorage", "jeepney", "webview.platforms.gtk", "gi",
              "send2trash"],
}
REQUIRED_FILES = REQUIRED_FILES + REQUIRED_FILES_BY_OS[BUILD_OS]


# Build DV: the document viewer's libraries (fetch_viewer_vendor.py put them in, checked): every file vendor-plan.json lists,
# with its pinned sha256, and each listed folder (PDF.js's character maps and standard fonts) whole
def viewer_vendor():
    base = os.path.join("frontend", "viewer", "vendor")
    with open(os.path.join(REPO, base, "vendor-plan.json"), encoding="utf-8") as f:
        plan = json.load(f)
    files, folders = {}, {}
    for p in plan["packages"]:
        for name, info in p["files"].items():
            files[os.path.join(base, p["dir"], name)] = info["sha256"]
        for name, info in (p.get("folders") or {}).items():
            folders[os.path.join(base, p["dir"], name)] = info["files"]
    return files, folders


VIEWER_FILES, VIEWER_FOLDERS = viewer_vendor()
REQUIRED_FILES = REQUIRED_FILES + list(VIEWER_FILES)
REQUIRED_METADATA = REQUIRED_METADATA + REQUIRED_METADATA_BY_OS[BUILD_OS]
REQUIRED_MODULES = REQUIRED_MODULES + REQUIRED_MODULES_BY_OS[BUILD_OS]


def check_required(dist, work, src):
    internal = os.path.join(dist, "_internal")
    missing = [f for f in REQUIRED_FILES if not os.path.isfile(os.path.join(internal, f))]
    missing += [f"{m} metadata" for m in REQUIRED_METADATA
                if not any(d.lower().startswith(m + "-") and d.endswith(".dist-info") for d in os.listdir(internal))]
    # every file the page loads
    html = open(os.path.join(src, "frontend", "index.html"), encoding="utf-8").read()
    missing += [f"frontend/{f}" for f in re.findall(r'(?:src|href)="((?:js|css|vendor|fonts|img)/[^"?#]+)', html)
                if not os.path.isfile(os.path.join(internal, "frontend", f))]
    for f, want in VIEWER_FILES.items():   # Build DV: the viewer's libraries are the pinned ones
        p = os.path.join(internal, f)
        if os.path.isfile(p) and hashlib.sha256(open(p, "rb").read()).hexdigest() != want:
            missing.append(f"{f} (not the pinned sha256)")
    for d, n in VIEWER_FOLDERS.items():
        p = os.path.join(internal, d)
        if not os.path.isdir(p) or len(os.listdir(p)) != n:
            missing.append(f"{d} ({n} files)")
    toc = open(os.path.join(work, "neurovault", "PYZ-00.toc"), encoding="utf-8").read()
    missing += [f"module {m}" for m in REQUIRED_MODULES if f"('{m}'," not in toc]
    if missing:
        raise SystemExit("Missing from the build:\n  " + "\n  ".join(missing))


def check_output(dist):
    bad = []
    for folder, dirs, files in os.walk(dist):
        rel = os.path.relpath(folder, dist)
        # Folders that came from the repo: at the top, in _internal, or anywhere under frontend (a Python library's
        # own "tests" folder deep in _internal doesn't count)
        parts = rel.split(os.sep)
        mine = parts[1:] if parts[0] == "_internal" else parts
        if mine and (mine[0] in FORBIDDEN_DIRS or (mine[0] == "frontend" and set(mine) & FORBIDDEN_DIRS)):
            bad.append(rel)
        for f in files:
            low = f.lower()
            if f in FORBIDDEN_FILES or os.path.splitext(low)[1] in FORBIDDEN_EXTS or "asio" in low:
                bad.append(os.path.join(rel, f))
    if bad:
        raise SystemExit("These must never ship, but are in the build:\n  " + "\n  ".join(sorted(bad)))


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--out", help="build folder, outside the repository (default: NeuroVault-build beside it)")
    ap.add_argument("--installer", action="store_true", help="also build the Inno Setup installer")
    ap.add_argument("--allow-dirty", action="store_true", help="build HEAD even with uncommitted changes (they are left out)")
    a = ap.parse_args()

    out = os.path.abspath(a.out or default_out())
    if os.path.commonpath([out, REPO]) == REPO:
        raise SystemExit("--out must be outside the repository checkout")
    if git("status", "--porcelain", "--untracked-files=no") and not a.allow_dirty:
        raise SystemExit("Uncommitted changes would be left out of the build: commit them, or pass --allow-dirty")

    commit = git("rev-parse", "--short=8", "HEAD")
    src = os.path.join(out, "src", commit)
    source_zip = os.path.join(out, "source", f"NeuroVault-{commit}-source.zip")
    work, dist_root = os.path.join(out, "work"), os.path.join(out, "dist")
    dist = os.path.join(dist_root, "NeuroVault")

    # 1. the clean source tree and the GPL source zip
    shutil.rmtree(src, ignore_errors=True)
    os.makedirs(src)
    os.makedirs(os.path.dirname(source_zip), exist_ok=True)
    run(["git", "-C", REPO, "archive", "--format=zip", f"--prefix=NeuroVault-{commit}/", "-o", source_zip, "HEAD"])
    with zipfile.ZipFile(source_zip) as z:
        z.extractall(os.path.join(out, "src"))
    shutil.rmtree(src, ignore_errors=True)
    os.replace(os.path.join(out, "src", f"NeuroVault-{commit}"), src)
    version = app_version(src)
    write_version_info(src, version)

    # 2. PyInstaller, from the clean tree's own spec
    shutil.rmtree(dist, ignore_errors=True)
    run([sys.executable, "-m", "PyInstaller", "--noconfirm", "--clean", "--log-level", "WARN",
         "--workpath", work, "--distpath", dist_root, os.path.join(src, "packaging", "neurovault.spec")])

    # 3. the licence bundle next to the exe
    for f in ("LICENSE", "THIRD-PARTY-NOTICES.md"):
        shutil.copy2(os.path.join(src, f), dist)
    os.makedirs(os.path.join(dist, "source"), exist_ok=True)
    shutil.copy2(source_zip, os.path.join(dist, "source"))
    sf = os.path.join(dist, "_internal", "_soundfile_data")
    if os.path.isdir(sf) and not os.path.exists(os.path.join(sf, "COPYING")):
        import _soundfile_data
        shutil.copy2(os.path.join(os.path.dirname(_soundfile_data.__file__), "COPYING"), sf)

    # 4. nothing that must never ship, and everything that must
    check_output(dist)
    check_required(dist, work, src)
    size = sum(os.path.getsize(os.path.join(d, f)) for d, _, fs in os.walk(dist) for f in fs)
    print(f"Built {dist} ({size / 1e6:.0f} MB, commit {commit}, version {version})")

    # 5. the installer
    if a.installer:
        iscc = next((p for p in ISCC_PLACES if os.path.isfile(p)), None)
        if not iscc:
            raise SystemExit("Inno Setup 6 (ISCC.exe) not found")
        bootstrapper = os.path.join(out, "redist", "MicrosoftEdgeWebview2Setup.exe")
        if not os.path.isfile(bootstrapper):
            raise SystemExit(f"Put Microsoft's WebView2 bootstrapper at {bootstrapper}")
        run([iscc, "/Q", f"/DMyAppVersion={version}", f"/DDistDir={dist}", f"/DRedistDir={os.path.dirname(bootstrapper)}",
             f"/DOutDir={os.path.join(out, 'installer')}", f"/DCommit={commit}",
             os.path.join(src, "packaging", "neurovault.iss")])
        print(f"Installer: {os.path.join(out, 'installer', f'NeuroVault-Setup-{version}.exe')}")


if __name__ == "__main__":
    main()
