#!/usr/bin/env python3
"""Stage the deployable slice of stock-portal into build/stage for rsync.

Copies the server package and the prebuilt web bundle, dropping node_modules
and local database files. LF endings are enforced so shell files survive SSH.
"""
import os
import shutil
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
STAGE = os.path.join(ROOT, "build", "stage")

SKIP_DIRS = {"node_modules", ".gradle", ".git", "build", "dist", "__pycache__", "android"}
SKIP_FILES = {"portal.db", "portal.db-shm", "portal.db-wal"}


def copy_tree(src, dst):
    for entry in sorted(os.listdir(src)):
        if entry in SKIP_DIRS or entry in SKIP_FILES:
            continue
        s = os.path.join(src, entry)
        d = os.path.join(dst, entry)
        if os.path.isdir(s):
            os.makedirs(d, exist_ok=True)
            copy_tree(s, d)
        else:
            shutil.copy2(s, d)


def normalize(path):
    for base, _dirs, files in os.walk(path):
        for name in files:
            if name.endswith((".sh", ".json", ".js", ".sql", ".md")):
                p = os.path.join(base, name)
                with open(p, "rb") as fh:
                    data = fh.read()
                fixed = data.replace(b"\r\n", b"\n")
                if fixed != data:
                    with open(p, "wb") as fh:
                        fh.write(fixed)


def main() -> int:
    if os.path.isdir(STAGE):
        shutil.rmtree(STAGE)
    os.makedirs(STAGE, exist_ok=True)

    copy_tree(os.path.join(ROOT, "server"), os.path.join(STAGE, "server"))
    copy_tree(os.path.join(ROOT, "web", "dist"), os.path.join(STAGE, "web"))

    normalize(os.path.join(STAGE, "server"))

    total = sum(len(files) for _b, _d, files in os.walk(STAGE))
    print("staged:", STAGE, "files:", total)
    for base, _dirs, files in os.walk(STAGE):
        for name in sorted(files):
            print(" ", os.path.relpath(os.path.join(base, name), STAGE))
    return 0


if __name__ == "__main__":
    sys.exit(main())
