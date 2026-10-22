"""
fetch_viewer_vendor.py — Build DV: puts the document viewer's libraries in frontend/viewer/vendor/, checked. NOT run by the app or
the build: only once the user has said yes to these downloads.

    python packaging/fetch_viewer_vendor.py --yes            # PDF.js, docx-preview, jszip, DOMPurify (about 4.0 MB in the app)
    python packaging/fetch_viewer_vendor.py --yes --mammoth  # also the optional simple view for Word files (not wired yet)

For each package in frontend/viewer/vendor/vendor-plan.json:
  1. download its npm tarball (registry.npmjs.org only) into a new, empty temporary folder;
  2. check the tarball's sha512 against the pinned `integrity` (npm's own hash): a mismatch stops everything;
  3. read ONLY the listed files out of it (never extract the archive), and check each one's pinned sha256;
  4. write them to frontend/viewer/vendor/<dir>/ (the listed folders, cmaps and standard_fonts, file by file, plain names only);
  5. add the package's ready THIRD-PARTY-NOTICES entry (frontend/viewer/vendor/NOTICES-ready.md), once.
docviewer.vendor_status then finds the files and their hashes, and the viewer offers PDF.js and docx-preview to its page.
"""
import argparse
import base64
import hashlib
import io
import json
import os
import re
import shutil
import sys
import tarfile
import tempfile
import urllib.request

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
VENDOR = os.path.join(ROOT, "frontend", "viewer", "vendor")
PLAN = os.path.join(VENDOR, "vendor-plan.json")
NOTICES = os.path.join(ROOT, "THIRD-PARTY-NOTICES.md")
READY = os.path.join(VENDOR, "NOTICES-ready.md")
NAME = re.compile(r"^[A-Za-z0-9._-]{1,120}$")


def _ctx():
    try:
        sys.path.insert(0, ROOT)
        import netssl   # QC 81: Windows' certificate store
        return netssl.context()
    except Exception:
        return None


def fetch(url, dest):
    if not url.startswith("https://registry.npmjs.org/"):
        raise SystemExit(f"refused: {url} isn't on the npm registry")
    with urllib.request.urlopen(url, timeout=60, context=_ctx()) as r, open(dest, "wb") as f:
        shutil.copyfileobj(r, f)


def check_integrity(path, integrity):
    algo, _, want = integrity.partition("-")
    if algo != "sha512":
        raise SystemExit(f"refused: integrity {algo} isn't sha512")
    got = base64.b64encode(hashlib.sha512(open(path, "rb").read()).digest()).decode()
    if got != want:
        raise SystemExit(f"STOP: {os.path.basename(path)} isn't what npm published (sha512 {got[:16]}… ≠ {want[:16]}…)")


def take(tar, member_path):
    m = tar.getmember("package/" + member_path)
    if not m.isfile():
        raise SystemExit(f"refused: {member_path} isn't a plain file")
    return tar.extractfile(m).read()


def install(pkg, tmp):
    tgz = os.path.join(tmp, f"{pkg['name']}-{pkg['version']}.tgz")
    print(f"{pkg['name']} {pkg['version']} ({pkg['licence']}): downloading {pkg['tarball']}")
    fetch(pkg["tarball"], tgz)
    check_integrity(tgz, pkg["integrity"])
    out = os.path.join(VENDOR, pkg["dir"])
    staged = {}
    with tarfile.open(tgz, "r:gz") as tar:
        for name, info in pkg["files"].items():
            data = take(tar, info["from"])
            if hashlib.sha256(data).hexdigest() != info["sha256"]:
                raise SystemExit(f"STOP: {pkg['name']}/{info['from']} doesn't match its pinned sha256")
            staged[name] = data
        for folder, info in (pkg.get("folders") or {}).items():
            prefix = f"package/{info['from']}/"
            members = [m for m in tar.getmembers() if m.name.startswith(prefix) and m.isfile()]
            if len(members) != info["files"]:
                raise SystemExit(f"STOP: {pkg['name']}/{info['from']} has {len(members)} files, the plan says {info['files']}")
            for m in members:
                leaf = m.name[len(prefix):]
                if not NAME.match(leaf):
                    raise SystemExit(f"refused: odd file name {m.name!r}")
                staged[f"{folder}/{leaf}"] = tar.extractfile(m).read()
            if sum(len(v) for k, v in staged.items() if k.startswith(folder + "/")) != info["size"]:
                raise SystemExit(f"STOP: {pkg['name']}/{info['from']} isn't the size the plan says")
    for rel, data in staged.items():
        dest = os.path.join(out, *rel.split("/"))
        os.makedirs(os.path.dirname(dest), exist_ok=True)
        with open(dest, "wb") as f:
            f.write(data)
    print(f"  {len(staged)} files checked and written to frontend/viewer/vendor/{pkg['dir']}/")


def add_notice(key):
    text = open(READY, encoding="utf-8").read()
    m = re.search(rf"<!-- notice:{key} -->\n(.*?)<!-- /notice -->", text, re.S)
    if not m:
        return
    entry = m.group(1).strip() + "\n"
    have = open(NOTICES, encoding="utf-8").read()
    if entry.splitlines()[0] not in have:   # under "Included in this repository", before the downloaded-on-demand part
        head = "## Downloaded when you choose to"
        have = have.replace(head, entry + "\n" + head, 1) if head in have else have.rstrip("\n") + "\n\n" + entry
        with open(NOTICES, "w", encoding="utf-8") as f:
            f.write(have)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--yes", action="store_true", help="the user has said yes to these downloads")
    ap.add_argument("--mammoth", action="store_true", help="also the optional mammoth 1.13.0 (BSD-2-Clause)")
    a = ap.parse_args()
    plan = json.load(open(PLAN, encoding="utf-8"))
    pkgs = plan["packages"] + ([p for p in plan.get("optional", []) if p["key"] == "mammoth"] if a.mammoth else [])
    for p in pkgs:
        print(f"- {p['name']} {p['version']}, {p['licence']}: {p['tarball']}")
    if not a.yes:
        raise SystemExit("Nothing downloaded: run again with --yes once the user has said yes.")
    tmp = tempfile.mkdtemp(prefix="nv-viewer-vendor-")
    try:
        for p in pkgs:
            install(p, tmp)
            add_notice(p["key"])
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
    sys.path.insert(0, ROOT)
    import docviewer
    print("vendor_status:", docviewer.vendor_status())


if __name__ == "__main__":
    main()
