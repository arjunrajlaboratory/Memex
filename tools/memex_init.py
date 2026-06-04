#!/usr/bin/env python3
"""Initialize a new Memex instance from the engine template (user-time).

Usage:
  memex_init.py --eng <engine-dir> --target <new-vault-dir> \
     [--packs core,pi] [--answers answers.json | --interview]

Bakes {{TOKENS}} -> answers, copies selected packs + hardened core, scaffolds
folders, installs + wires hooks, assembles the contract. Refuses to write into a
non-empty target unless --force (which overlays, it does not wipe).
"""
import argparse, json, pathlib, re, shutil, subprocess, sys

TOKEN_RE = re.compile(r"\{\{([A-Z0-9_]+)\}\}")

def bake(text, answers):
    """Replace {{TOKEN}} with answers[TOKEN]. Unknown tokens are left INTACT —
    template files legitimately contain note-creation placeholders (e.g.
    {{YYYYMMDD}} in journal.md) that must survive init. Only catalogued instance
    tokens get baked; the derive-time audit guarantees no instance fact remains
    as a raw literal, so pass-through is safe."""
    return TOKEN_RE.sub(lambda m: answers.get(m.group(1), m.group(0)), text)

TEXT_EXTS = {".md",".ts",".tsx",".sh",".json",".plist",".scss",".py",".tex",".sty",".yaml",".yml"}

def bake_file(src, dst, answers):
    dst.parent.mkdir(parents=True, exist_ok=True)
    if src.suffix in TEXT_EXTS:
        dst.write_text(bake(src.read_text(errors="ignore"), answers))
    else:
        shutil.copy2(src, dst)

def bake_tree(src, dst, answers):
    for fp in src.rglob("*"):
        if fp.is_file():
            bake_file(fp, dst / fp.relative_to(src), answers)

SCAFFOLD_DIRS = [
    "Atlas/Areas","Atlas/Projects","Atlas/People","Atlas/Organizations","Atlas/Sources",
    "Atlas/Concepts","Atlas/Decisions","Atlas/Ideas","Atlas/Implementations","Atlas/Trackers",
    "Atlas/Trackers/Digests","Atlas/Efforts","Atlas/Relationships","Atlas/Interactions",
    "Ops/Tasks","Ops/Briefings","Ops/Reviews","Ops/Followups","Ops/Views",
    "Agents/Jobs","Agents/Runs","Agents/Approvals",
    "Raw/sources","Inbox","outputs","Drafts",
]

PORT_TOKENS = {"QUARTZ_PORT", "QUARTZ_WS_PORT"}

def answers_with_defaults(manifest, answers):
    """Ensure every catalogued token has a value; fill ports from their example
    when omitted so the server and the skills agree on the port."""
    out = dict(answers)
    for ph in manifest["placeholders"]:
        if ph["token"] not in out:
            out[ph["token"]] = ph.get("example", "") if ph["token"] in PORT_TOKENS else ""
    return out

def interview(manifest, packs):
    ans = {}
    pi = "pi" in packs
    for ph in manifest["placeholders"]:
        if "[pi pack]" in ph["prompt"] and not pi:
            ans[ph["token"]] = ""    # skip pi questions when pi not selected
            continue
        v = input(f"{ph['prompt']} [{ph.get('example','')}]: ").strip()
        ans[ph["token"]] = v or (ph.get("example","") if ph["token"] in PORT_TOKENS else v)
    return ans

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--eng", required=True)
    ap.add_argument("--target", required=True)
    ap.add_argument("--packs", default="core")
    ap.add_argument("--answers")
    ap.add_argument("--interview", action="store_true")
    ap.add_argument("--force", action="store_true", help="overlay into an existing non-empty target (does not wipe)")
    a = ap.parse_args()
    if not a.interview and not a.answers:
        print("error: supply --answers <file> or --interview"); return 1
    ENG, T = pathlib.Path(a.eng).expanduser(), pathlib.Path(a.target).expanduser()
    packs = [p.strip() for p in a.packs.split(",") if p.strip()]
    manifest = json.load(open(ENG/"placeholders.json"))

    if T.exists() and any(T.iterdir()) and not a.force:
        print(f"refusing: {T} is not empty (use --force to overlay)"); return 1
    T.mkdir(parents=True, exist_ok=True)

    answers = interview(manifest, packs) if a.interview else json.load(open(a.answers))
    answers = answers_with_defaults(manifest, answers)

    # 1. folders
    for d in SCAFFOLD_DIRS: (T/d).mkdir(parents=True, exist_ok=True)
    (T/"Inbox/_filed").mkdir(parents=True, exist_ok=True)

    # 2. packs -> vault locations
    loc = {"skills": ".claude/skills", "schemas": "_schemas", "templates": "_templates",
           "workflows": "_workflows", "prompts": "Agents/Prompts", "cv": "CV", "scripts": "scripts"}
    for pack in packs:
        base = ENG/"packs"/pack
        if not base.exists(): continue
        for kind, dest in loc.items():
            srcd = base/kind
            if srcd.exists(): bake_tree(srcd, T/dest, answers)

    # 3. hardened core: hooks + their settings.json wiring, quartz, launchd
    bake_tree(ENG/"hardened/hooks", T/".claude/hooks", answers)
    if (ENG/"hardened/settings.json").exists():     # wires the hooks — without this they never fire
        bake_file(ENG/"hardened/settings.json", T/".claude/settings.json", answers)
    if (ENG/"hardened/gitignore").exists():         # vault-root .gitignore (Inbox/outputs/node_modules/…)
        bake_file(ENG/"hardened/gitignore", T/".gitignore", answers)
    bake_tree(ENG/"hardened/quartz", T/"quartz", answers)
    # launchd: the serve script goes to scripts/ (its plist + the script's own
    # ../quartz logic assume that location); the plist to scripts/launchd/ named
    # to match its Label (com.memex.quartz.plist).
    ld = ENG/"hardened/launchd"
    if ld.exists():
        for fp in ld.iterdir():
            if fp.is_file():
                if fp.suffix == ".plist":
                    bake_file(fp, T/"scripts/launchd/com.memex.quartz.plist", answers)
                else:
                    bake_file(fp, T/"scripts"/fp.name, answers)

    # 4. contract = base + (pi fragment if selected)
    for base_name, out_name in [("AGENTS.base.md","AGENTS.md"), ("CLAUDE.base.md","CLAUDE.md")]:
        text = bake((ENG/"hardened/contract"/base_name).read_text(), answers)
        if "pi" in packs:
            frag = bake((ENG/"hardened/contract/pi-fragment.md").read_text(), answers)
            text = text.replace("<!-- PI_CONTRACT_FRAGMENT -->", frag)
        else:
            text = text.replace("<!-- PI_CONTRACT_FRAGMENT -->", "")
        (T/out_name).write_text(text)

    # 5. seed files (tracked structure for otherwise-empty/gitignored dirs)
    (T/"log.md").write_text("# log\n")
    (T/"Inbox/README.md").write_text("# Inbox drop zone\n")
    (T/"outputs/README.md").write_text("# Generated artifacts\n\nGitignored content, tracked structure.\n")
    (T/"Drafts/README.md").write_text(
        "# Drafts\n\n"
        "Git-tracked staging area for work-in-progress documents to finalize later — "
        "LLM-written prose, code, reports, anything you want to iterate on across "
        "sessions before it becomes a typed note.\n\n"
        "Text (markdown, code, notes) is committed so drafts are versioned; heavy "
        "binaries (`*.pdf`, `*.docx`, `*.png`, `*.mp4`, `*.zip`, …) are gitignored — "
        "route real binary artifacts to `outputs/` instead.\n\n"
        "Lifecycle: draft here → finalize → promote into a typed `Atlas/` note (or "
        "export the artifact) → archive or delete the draft. This is a workbench, "
        "not a permanent home.\n")
    owner = answers.get("OWNER_NAME", "").strip()
    (T/"index.md").write_text(
        f"# {owner + ' — ' if owner else ''}Memex\n\n"
        "Home page for this vault. Browse the typed-note dashboards at "
        "`/dashboards/`, or read `AGENTS.md` for how agents operate here.\n")

    # 6. git init (a vault is a git repo; remote is the user's choice — local-only by default)
    try:
        if not (T/".git").exists():
            subprocess.run(["git", "init", "-q"], cwd=str(T), check=False)
    except FileNotFoundError:
        pass  # git not installed — the user can init later

    print(f"init: created instance at {T} (packs: {','.join(packs)})")
    return 0

if __name__ == "__main__":
    sys.exit(main())
