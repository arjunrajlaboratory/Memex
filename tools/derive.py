#!/usr/bin/env python3
"""Derive the engine template from a source vault. Maintainer-time, one direction.

Usage: derive.py --src ~/code/your-source-vault [--eng .]
Rebuilds packs/ and hardened/ from packs.json, swapping literals->{{TOKENS}}.
Never writes to --src.
"""
import argparse, json, os, pathlib, shutil, sys

def load(p):
    with open(p) as fh:
        return json.load(fh)

def replacements(manifest):
    # (literal -> token) pairs, longest literal first so substrings don't pre-empt.
    pairs = []
    for ph in manifest["placeholders"]:
        for lit in ph["literals"]:
            pairs.append((lit, "{{" + ph["token"] + "}}"))
    return sorted(pairs, key=lambda kv: -len(kv[0]))

def bake_out(text, pairs):
    for lit, tok in pairs:
        text = text.replace(lit, tok)
    return text

# Text formats get literal->token substitution; everything else is copied as
# bytes (letterhead .docx, images, fonts). ADD new text formats here — omitting
# a text format causes its literals to leak un-tokenised into the template. The
# Task-5 template audit is the backstop that would catch such a leak.
TEXT_EXTS = {".md", ".ts", ".tsx", ".sh", ".json", ".plist", ".scss", ".py", ".tex", ".sty", ".yaml", ".yml"}

# One source-resolver per packs.json section. derive and memex_bake's
# LOCATION_MAP must stay in lockstep: every key here is installed by init via
# LOCATION_MAP, and an unknown packs.json key is a hard error (a silently
# skipped section is how pi/scripts got wiped by the rmtree below).
SECTION_SOURCES = {
    "skills":    ("tree", lambda SRC, n: SRC / ".claude/skills" / n),
    "schemas":   ("file", lambda SRC, n: SRC / "_schemas" / f"{n}.md"),
    "templates": ("file", lambda SRC, n: SRC / "_templates" / f"{n}.md"),
    "workflows": ("file", lambda SRC, n: SRC / "_workflows" / f"{n}.md"),
    "prompts":   ("file", lambda SRC, n: SRC / "Agents/Prompts" / f"{n}.md"),
    "scripts":   ("file", lambda SRC, n: SRC / "scripts" / n),
}
PRUNE_DIRS = {"__pycache__", ".git", "node_modules", "public", ".quartz-cache"}

def copy_file(src, dst, pairs):
    dst.parent.mkdir(parents=True, exist_ok=True)
    if src.suffix in TEXT_EXTS:
        try:
            text = src.read_text(encoding="utf-8")
        except UnicodeDecodeError:
            sys.exit(f"derive: {src} is not valid UTF-8; fix the source file or add its extension to binary handling")
        dst.write_text(bake_out(text, pairs))
        shutil.copymode(src, dst)
    else:
        shutil.copy2(src, dst)  # binaries copied as-is

def copy_tree(src, dst, pairs):
    for dirpath, dirnames, filenames in os.walk(src):
        dirnames[:] = [d for d in dirnames if d not in PRUNE_DIRS]
        for name in filenames:
            fp = pathlib.Path(dirpath) / name
            copy_file(fp, dst / fp.relative_to(src), pairs)

def planned_sources(packs, SRC):
    """Every source path derive will read, as (label, Path). Used for a pre-flight
    existence check BEFORE the destructive wipe, so a bad packs.json entry fails
    loudly (naming the offending entry) without leaving a half-built template."""
    out = []
    for pack in [k for k in packs if k != "hardened"]:
        cfg = packs[pack]
        for section, value in cfg.items():
            if section == "cv":
                if value:
                    out.append((f"{pack}.cv", SRC / "CV"))
                continue
            if section not in SECTION_SOURCES:
                sys.exit(f"derive: packs.json section {pack}.{section} is not implemented "
                         f"(known: {', '.join(sorted(SECTION_SOURCES))}, cv); nothing was changed")
            _, resolve = SECTION_SOURCES[section]
            for name in value:
                out.append((f"{pack}.{section}:{name}", resolve(SRC, name)))
    H = packs["hardened"]
    for hook in H.get("hooks", []):        out.append((f"hardened.hook:{hook}", SRC/".claude/hooks"/hook))
    for lf in H.get("launchd", []):
        out.append((f"hardened.launchd:{lf}", SRC/"scripts/launchd"/lf if lf.endswith(".plist") else SRC/"scripts"/lf))
    if H.get("quartz"):                    out.append(("hardened.quartz", SRC/"quartz"))
    if H.get("settings"):                  out.append(("hardened.settings", SRC/".claude/settings.json"))
    if H.get("gitignore"):                 out.append(("hardened.gitignore", SRC/".gitignore"))
    return out

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--src", required=True)
    ap.add_argument("--eng", default=".")
    a = ap.parse_args()
    SRC, ENG = pathlib.Path(a.src).expanduser(), pathlib.Path(a.eng).expanduser()
    if SRC.resolve() == ENG.resolve():
        sys.exit("derive: --src and --eng must be different directories")
    packs = load(ENG / "packs.json")
    pairs = replacements(load(ENG / "placeholders.json"))
    # Optional scrub map: plain from->to replacements for third-party PII and
    # institution strings that appear in skill EXAMPLES (not owner instance-facts,
    # so not interview-prompted placeholders) — keeps the shipped template clean.
    scrub_path = ENG / "scrub.json"
    if scrub_path.exists():
        for e in load(scrub_path).get("scrub", []):
            pairs.append((e["from"], e["to"]))
    pairs.sort(key=lambda kv: -len(kv[0]))  # longest-first so substrings don't pre-empt

    # Pre-flight: every listed source must exist BEFORE we destroy the output,
    # so a typo'd packs.json entry can't leave packs/ half-wiped.
    missing = [(label, str(p)) for label, p in planned_sources(packs, SRC) if not p.exists()]
    if missing:
        for label, p in missing:
            print(f"derive: MISSING source {label} -> {p}", file=sys.stderr)
        sys.exit(f"derive: {len(missing)} source(s) missing — fix packs.json; nothing was changed")

    # Wipe only what derive regenerates. packs/ is fully derived. Under hardened/,
    # the hooks/launchd/quartz dirs + settings.json/gitignore files are derived —
    # but hardened/contract/ is HAND-CURATED (Task 6) and must survive re-derives.
    shutil.rmtree(ENG / "packs", ignore_errors=True)
    for sub in ("hooks", "launchd", "quartz"):
        shutil.rmtree(ENG / "hardened" / sub, ignore_errors=True)
    for f in ("settings.json", "gitignore"):
        (ENG / "hardened" / f).unlink(missing_ok=True)

    for pack in [k for k in packs if k != "hardened"]:
        cfg = packs[pack]
        for section, value in cfg.items():
            if section == "cv":
                if value:
                    copy_tree(SRC / "CV", ENG / f"packs/{pack}/cv", pairs)
                continue
            # planned_sources() already rejected unknown sections pre-wipe.
            kind, resolve = SECTION_SOURCES[section]
            for name in value:
                src = resolve(SRC, name)
                dst = ENG / f"packs/{pack}/{section}" / (name if kind == "tree" else src.name)
                (copy_tree if kind == "tree" else copy_file)(src, dst, pairs)

    H = packs["hardened"]
    # NOTE: hardened/contract/ is intentionally NOT derived or wiped here. All
    # three contract pieces — AGENTS.base.md, CLAUDE.base.md, and pi-fragment.md
    # — are HAND-CURATED (Task 6). They live under hardened/contract/ precisely
    # because the selective wipe above never touches that dir, so re-deriving
    # preserves the curation. (Earlier they were split between hardened/ and
    # packs/pi/, but packs/ is fully wiped on derive, which deleted the fragment.)
    for hook in H["hooks"]:
        copy_file(SRC/".claude/hooks"/hook, ENG/"hardened/hooks"/hook, pairs)
    for lf in H.get("launchd", []):
        src = SRC/"scripts/launchd"/lf if lf.endswith(".plist") else SRC/"scripts"/lf
        copy_file(src, ENG/"hardened/launchd"/lf, pairs)
    if H.get("quartz"):
        # copy quartz source; copy_tree prunes node_modules/public/cache (huge, regenerated)
        copy_tree(SRC/"quartz", ENG/"hardened/quartz", pairs)
    # Vault-level files that wire hooks + git-ignore. Stored WITHOUT a leading dot
    # (gitignore, not .gitignore) so they don't act on the engine repo itself;
    # memex_init places them at <vault>/.claude/settings.json and <vault>/.gitignore.
    if H.get("settings"):
        copy_file(SRC/".claude/settings.json", ENG/"hardened/settings.json", pairs)
    if H.get("gitignore"):
        copy_file(SRC/".gitignore", ENG/"hardened/gitignore", pairs)
    print("derive: done")

if __name__ == "__main__":
    sys.exit(main())
