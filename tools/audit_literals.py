#!/usr/bin/env python3
"""Scan a tree for instance-specific literals not covered by placeholders.json.

Usage: audit_literals.py <tree-to-scan> [--manifest placeholders.json]
Exit 0 if every detected literal is covered by a manifest literal; 1 otherwise.
"""
import argparse, json, os, pathlib, re, sys

# Patterns that signal an instance-specific fact. Tunable. These are *detectors*,
# not the replacements — the manifest holds the exact literals to swap.
PATTERNS = {
    "email":   re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}"),
    # Google Drive folder/file IDs: 25+ char runs that mix upper+lower+digit
    # (real IDs always do; this excludes code identifiers, snake_case slugs, and
    # all-lowercase md5/hex hashes that a bare length match would flag).
    "drive_id": re.compile(r"\b(?=[0-9A-Za-z_-]*[a-z])(?=[0-9A-Za-z_-]*[A-Z])(?=[0-9A-Za-z_-]*[0-9])[0-9A-Za-z_-]{25,}\b"),
    "institution": re.compile(r"\b(?:Example U|exampleu|seas\.exampleu)\b"),
    "owner":   re.compile(r"\bJane Roe\b"),
}
# Files/dirs that are DATA or HISTORY, never templatized — skip them.
SKIP_DIRS = {".git", "node_modules", "public", ".quartz-cache", "_archive", "Raw", "Inbox", "__pycache__", ".venv"}
# log.md is history; the other two are pure data/lockfiles whose long hashes are
# noise for the drive_id detector (npm integrity hashes, base64 emoji PNGs).
SKIP_FILES = {"log.md", "package-lock.json", "emojimap.json"}
TEXT_EXT = {".md", ".ts", ".tsx", ".sh", ".json", ".plist", ".py", ".scss", ".tex", ".sty", ".yaml", ".yml"}
TEXT_NAMES = {"gitignore", ".gitignore"}  # covers engine's extensionless hardened/gitignore and dot-prefixed .gitignore files

def covered_literals(manifest):
    out = set()
    for p in manifest.get("placeholders", []):
        for lit in p.get("literals", []):
            out.add(lit)
    return out

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("tree")
    ap.add_argument("--manifest", default=str(pathlib.Path(__file__).parent.parent / "placeholders.json"))
    args = ap.parse_args()
    manifest = json.load(open(args.manifest)) if pathlib.Path(args.manifest).exists() else {"placeholders": []}
    covered = covered_literals(manifest)
    # Fold in deliberately-allowed detector hits (non-instance-fact false positives).
    allow = pathlib.Path(args.manifest).parent / "audit_allowlist.json"
    if allow.exists():
        covered |= set(json.load(open(allow)).get("allow", []))

    hits = {}  # literal -> list of "file:line"
    root = pathlib.Path(args.tree)
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = [d for d in dirnames if d not in SKIP_DIRS]
        for name in filenames:
            fp = pathlib.Path(dirpath) / name
            if fp.suffix not in TEXT_EXT and fp.name not in TEXT_NAMES:
                continue
            if fp.name in SKIP_FILES:
                continue
            for i, line in enumerate(fp.read_text(errors="ignore").splitlines(), 1):
                for pat in PATTERNS.values():
                    for m in pat.findall(line):
                        if m.startswith("EXAMPLE"):
                            continue
                        if m in covered: continue
                        hits.setdefault(m, []).append(f"{fp.relative_to(root)}:{i}")

    if not hits:
        print("AUDIT CLEAN: no uncovered instance literals."); return 0
    print(f"UNCOVERED LITERALS ({len(hits)}):")
    for lit, locs in sorted(hits.items(), key=lambda kv: -len(kv[1])):
        print(f"  {lit!r}  ({len(locs)}x)  e.g. {locs[0]}")
    return 1

if __name__ == "__main__":
    sys.exit(main())
