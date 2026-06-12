#!/usr/bin/env python3
"""Engine self-consistency gate (companion to audit_literals.py).

Usage: audit_refs.py [engine-dir]
Checks, against the engine checkout itself:
  1. packs.json <-> disk, both directions: every entry resolves to a real
     file/dir, and every file under packs/ + hardened/{hooks,launchd,contract}
     is covered by some entry (no orphans).
  2. Every {{UPPERCASE_TOKEN}} used in packs/ + hardened/ is catalogued in
     placeholders.json (or a known runtime placeholder). Vendored quartz code
     is exempt from flagging — except the two engine-authored config files.
  3. Reverse: every catalogued placeholder is actually used somewhere
     (catches dead interview questions).
  4. {{?TOK}}/{{^TOK}}/{{/TOK}} section markers balance per file.
Exit 0 with "REFS CLEAN: ..." or list "REF PROBLEMS (n):" and exit 1.
"""
import json, os, pathlib, re, sys

TEXT_EXT = {".md", ".ts", ".tsx", ".sh", ".json", ".plist", ".py", ".scss", ".tex", ".sty", ".yaml", ".yml"}
TEXT_NAMES = {"gitignore", ".gitignore"}
SKIP_DIRS = {".git", "node_modules", "public", ".quartz-cache", "__pycache__", ".venv"}
TOKEN_RE = re.compile(r"\{\{([A-Z0-9_]+)\}\}")
SECTION_RE = re.compile(r"\{\{([?^/])([A-Z0-9_]+)\}\}")
# Note-creation placeholders resolved at vault runtime, not at init —
# plus MEMEX_LAUNCHD_ID, which bake_engine computes from CC_PROJECT_SLUG /
# VAULT_NAME at bake time (never interviewed, so not in placeholders.json).
RUNTIME_TOKENS = {"YYYYMMDD", "MEMEX_LAUNCHD_ID"}
# packs.json sections that are name lists of .md files under packs/<pack>/<section>/.
MD_SECTIONS = ("schemas", "templates", "workflows", "prompts")
QUARTZ = "hardened/quartz"
# Engine-authored files inside the otherwise-vendored quartz tree: their token
# usage IS checked against the catalog (ports baked into serve scripts/config).
QUARTZ_ENGINE_FILES = {f"{QUARTZ}/package.json", f"{QUARTZ}/quartz.config.ts"}

def iter_text_files(root):
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = [d for d in dirnames if d not in SKIP_DIRS]
        for name in sorted(filenames):
            fp = pathlib.Path(dirpath) / name
            if fp.suffix in TEXT_EXT or fp.name in TEXT_NAMES:
                yield fp

def check_packs(eng, problems):
    packs = json.load(open(eng / "packs.json"))
    covered_files, covered_dirs = set(), set()  # engine-relative posix paths

    def want(rel, kind, label):
        p = eng / rel
        ok = p.is_dir() if kind == "dir" else p.is_file()
        if not ok:
            note = f" (exists but is not a {kind})" if p.exists() else ""
            problems.append(f"packs.json {label} -> missing {kind} {rel}{note}")
        (covered_dirs if kind == "dir" else covered_files).add(rel)

    for pack in [k for k in packs if k != "hardened"]:
        for section, value in packs[pack].items():
            if section == "cv":
                if value:
                    want(f"packs/{pack}/cv", "dir", f"{pack}.cv")
            elif section == "skills":
                for n in value:
                    want(f"packs/{pack}/skills/{n}", "dir", f"{pack}.skills:{n}")
            elif section in MD_SECTIONS:
                for n in value:
                    want(f"packs/{pack}/{section}/{n}.md", "file", f"{pack}.{section}:{n}")
            elif section == "scripts":
                for n in value:
                    want(f"packs/{pack}/scripts/{n}", "file", f"{pack}.scripts:{n}")
            else:
                problems.append(f"packs.json {pack}.{section}: unknown section key")

    H = packs.get("hardened", {})
    for n in H.get("hooks", []):     want(f"hardened/hooks/{n}", "file", f"hardened.hooks:{n}")
    for n in H.get("launchd", []):   want(f"hardened/launchd/{n}", "file", f"hardened.launchd:{n}")
    for n in H.get("contract", []):  want(f"hardened/contract/{n}", "file", f"hardened.contract:{n}")
    if H.get("settings"):            want("hardened/settings.json", "file", "hardened.settings")
    if H.get("gitignore"):           want("hardened/gitignore", "file", "hardened.gitignore")
    if H.get("quartz"):              want(QUARTZ, "dir", "hardened.quartz")

    # Reverse: files on disk not covered by any entry are orphans (would be
    # silently dropped at install / clobbered at re-derive without anyone
    # noticing). hardened/scripts/ is hand-curated and exempt — Task 16 adds
    # it; hardened/quartz + settings.json + gitignore are covered wholesale.
    roots = ["packs", "hardened/hooks", "hardened/launchd", "hardened/contract"]
    for r in roots:
        top = eng / r
        if not top.is_dir():
            continue
        for dirpath, dirnames, filenames in os.walk(top):
            dirnames[:] = [d for d in dirnames if d not in SKIP_DIRS]
            for name in sorted(filenames):
                rel = (pathlib.Path(dirpath) / name).relative_to(eng).as_posix()
                if rel in covered_files: continue
                if any(rel.startswith(d + "/") for d in covered_dirs): continue
                problems.append(f"orphan file not covered by packs.json: {rel}")

def check_tokens(eng, problems):
    manifest = json.load(open(eng / "placeholders.json"))
    catalogued = {p["token"] for p in manifest["placeholders"]}
    known = catalogued | RUNTIME_TOKENS
    used = set()
    for root in ("packs", "hardened"):
        for fp in iter_text_files(eng / root):
            rel = fp.relative_to(eng).as_posix()
            text = fp.read_text(errors="ignore")
            toks = set(TOKEN_RE.findall(text))
            marks = SECTION_RE.findall(text)
            used |= toks | {t for _, t in marks}
            # Vendored quartz code may legitimately contain ALL-CAPS {{...}}
            # examples (JSX, docs, GitHub-Actions ${{ ... }}); only the two
            # engine-authored config files inside it are held to the catalog.
            if rel.startswith(QUARTZ + "/") and rel not in QUARTZ_ENGINE_FILES:
                continue
            for t in sorted(toks - known):
                problems.append(f"uncatalogued token {{{{{t}}}}} in {rel}")
            # Section-marker balance (stack parse; bake() needs flat, balanced
            # spans — an unclosed marker bakes the raw marker into the vault).
            stack = []
            for kind, tok in marks:
                if kind in "?^":
                    stack.append(tok)
                elif not stack or stack.pop() != tok:
                    problems.append(f"unbalanced section marker {{{{/{tok}}}}} in {rel}")
                    stack = []
                    break
            for tok in stack:
                problems.append(f"unclosed section marker {{{{?{tok}}}}} in {rel}")
    # Reverse: a catalogued token nothing uses is a dead interview question.
    for t in sorted(catalogued - used):
        problems.append(f"catalogued token {t} is used nowhere in packs/ or hardened/")

def main():
    eng = pathlib.Path(sys.argv[1]) if len(sys.argv) > 1 else pathlib.Path(__file__).parent.parent
    problems = []
    check_packs(eng, problems)
    check_tokens(eng, problems)
    if not problems:
        print("REFS CLEAN: packs.json<->disk, token catalog, and section markers all consistent.")
        return 0
    print(f"REF PROBLEMS ({len(problems)}):")
    for p in problems:
        print(f"  {p}")
    return 1

if __name__ == "__main__":
    sys.exit(main())
