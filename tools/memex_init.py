#!/usr/bin/env python3
"""Initialize a new Memex instance from the engine template (user-time).

Usage:
  memex_init.py --eng <engine-dir> --target <new-vault-dir> \
     [--packs core,pi] [--answers answers.json | --interview]

Bakes {{TOKENS}} -> answers, copies selected packs + hardened core, scaffolds
folders, installs + wires hooks, assembles the contract. Refuses to write into a
non-empty target unless --force (which overlays, it does not wipe).
"""
import argparse, datetime, json, pathlib, re, shutil, subprocess, sys

TOKEN_RE = re.compile(r"\{\{([A-Z0-9_]+)\}\}")
# Conditional section around OPTIONAL-token prose. {{?TOKEN}}…{{/TOKEN}} keeps its
# span iff the answer is non-blank; {{^TOKEN}}…{{/TOKEN}} iff blank. Non-greedy
# body + DOTALL so a span may cross newlines. Same-token NESTING is unsupported
# (the non-greedy body stops at the first matching {{/TOKEN}}); keep sections flat.
SECTION_RE = re.compile(r"\{\{([?^])([A-Z0-9_]+)\}\}(.*?)\{\{/\2\}\}", re.DOTALL)

# --- Source streams + git mode (behavior answers, NOT {{TOKEN}} placeholders) ---
# These configure the default multi-source loop-closing flow and are read directly
# from the answers dict (key STREAMS / GIT_MODE), so they never enter
# placeholders.json (which stays the audited token catalog).
VALID_STREAMS = ["email", "slack", "calendar"]
DEFAULT_STREAMS = ["email", "slack"]
STREAM_MCP = {
    "email": "claude_ai_Gmail",
    "slack": "claude_ai_Slack",
    "calendar": "claude_ai_Google_Calendar",
}
VALID_GIT_MODES = ["local", "none", "remote"]

def parse_streams(raw):
    """Normalize a STREAMS answer into an ordered, de-duplicated list of valid
    stream names. `None` means 'not answered' (the key was absent) and falls back
    to the default (email + slack). Any other value is taken literally — an
    explicit empty selection stays empty, so the user can opt out of all comms
    scanning; unknown names are dropped. (The daily briefing supports a
    zero-stream config: it just skips the comms pass.)"""
    if raw is None:
        return list(DEFAULT_STREAMS)
    items = raw.split(",") if isinstance(raw, str) else list(raw)
    seen, out = set(), []
    for s in (str(x).strip().lower() for x in items):
        if s in VALID_STREAMS and s not in seen:
            seen.add(s); out.append(s)
    return out

def normalize_git_mode(raw):
    """Coerce a GIT_MODE answer to one of local|none|remote (default local)."""
    m = (raw or "local").strip().lower()
    return m if m in VALID_GIT_MODES else "local"

def sources_config_yaml(streams, git_mode, today):
    """Render the _config/sources.md note for the given enabled streams. Every
    valid stream gets a line (enabled true/false) so the file documents the full
    set; calendar carries mode: minimal."""
    def line(name):
        en = "true" if name in streams else "false"
        extra = ", mode: minimal" if name == "calendar" else ""
        return f"  {name}: {{ enabled: {en}, mcp: {STREAM_MCP[name]}{extra} }}"
    rows = "\n".join(line(s) for s in VALID_STREAMS)
    return f"""---
type: config
scope: sources
git_mode: {git_mode}
updated: {today}
streams:
{rows}
---

# Sources

Which streams the daily loop-closing flow checks. `capture-comms` +
`reconcile-from-comms` run by default at the top of `daily-briefing`; flip an
`enabled:` above to turn a stream on or off — no re-init needed.

- **email** / **slack** — scanned by `capture-comms` (sent + received). Sent
  messages are the strongest loop-*closing* signals.
- **calendar** (`mode: minimal`) — a Task linked to a calendar event whose end-time
  has passed becomes a "confirm close?" item; no attendee / `last_contact` bumping.

If this file is absent, skills fall back to: email + slack enabled, calendar
planning-only.

## Adding a new source (e.g. Notion)
1. Add a `streams.<name>` entry above with its MCP server id.
2. Add a scan block for that MCP to `capture-comms` (Step 3/4).
3. No `reconcile-from-comms` change needed — it reads the same `## Action items` API.
"""

def strip_sections(text, answers):
    """Resolve {{?TOKEN}}…{{/TOKEN}} / {{^TOKEN}}…{{/TOKEN}} conditional spans.

    A `?` span is kept iff answers[TOKEN] is present and non-blank; a `^` span iff
    present and blank. A section whose TOKEN is ABSENT from answers passes through
    verbatim — same rule as bake()'s unknown-token pass-through, so note-creation
    prose is never silently dropped. Kept spans keep their inner text (including
    any {{TOKEN}}); bake()'s plain pass then substitutes it. Run before that pass."""
    def repl(m):
        sigil, token, body = m.group(1), m.group(2), m.group(3)
        if token not in answers:
            return m.group(0)                       # unknown token -> pass through
        nonblank = str(answers[token]).strip() != ""
        keep = nonblank if sigil == "?" else not nonblank
        return body if keep else ""
    return SECTION_RE.sub(repl, text)

def bake(text, answers):
    """Replace {{TOKEN}} with answers[TOKEN]. Unknown tokens are left INTACT —
    template files legitimately contain note-creation placeholders (e.g.
    {{YYYYMMDD}} in journal.md) that must survive init. Only catalogued instance
    tokens get baked; the derive-time audit guarantees no instance fact remains
    as a raw literal, so pass-through is safe.

    Optional-token PROSE is handled first via conditional sections (see
    strip_sections): a blank optional answer drops the whole surrounding clause,
    not just the token — otherwise a blank {{OWNER_FORWARDING_EMAIL}} would bake
    empty `` pairs and dangling words into the new vault."""
    text = strip_sections(text, answers)
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
    "Raw/sources","Inbox","outputs","Drafts","_config",
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
    ans["STREAMS"] = ask_streams()
    ans["GIT_MODE"] = ask_git_mode()
    return ans

def ask_streams():
    """Per-stream y/n for the default loop-closing flow. Email + slack default on."""
    print("\nWhich streams should the daily flow check by default (capture-comms)?")
    chosen = []
    for s in VALID_STREAMS:
        on_by_default = s in DEFAULT_STREAMS
        v = input(f"  Enable {s}? [{'Y/n' if on_by_default else 'y/N'}]: ").strip().lower()
        on = (v in ("y", "yes")) if v else on_by_default
        if on:
            chosen.append(s)
    return chosen  # may be empty — an explicit opt-out of all comms scanning

def ask_git_mode():
    """Privacy-aware version-control mode. local (default) | none | remote."""
    print("\nVersion-control mode for this vault:")
    print("  local  — git, local-only, no remote (recommended; default)")
    print("  none   — no git (no history, no audit trail, no recovery)")
    print("  remote — git + a remote (PRIVACY: reconciled facts leave your machine)")
    return normalize_git_mode(input("  git mode [local]: ").strip().lower())

def print_post_init(streams, git_mode):
    """Print stream-access grant instructions + git-mode guidance/warnings."""
    if streams:
        print("\nEnabled streams: " + ", ".join(streams))
        print("To let Claude read each, connect its MCP connector in your client")
        print("(Claude.ai → Settings → Connectors, or your MCP config):")
        for s in streams:
            print(f"  - {s}: {STREAM_MCP[s]}")
        print("Capture stays empty (never errors) until a stream is connected.")
    if git_mode == "none":
        print("\ngit mode: none — no version history. You lose the audit trail,")
        print("time-travel, and recovery from a bad edit. Run `git init` later to enable.")
    elif git_mode == "remote":
        print("\ngit mode: remote — set up your remote (use a PRIVATE repo):")
        print("  git -C <vault> remote add origin <url>")
        print("  git -C <vault> push -u origin main")
        print("PRIVACY: raw comms under Inbox/ are gitignored and never push, but")
        print("reconciled facts (closed tasks, Person notes, Decisions) DO push;")
        print("`sensitivity: sensitive` notes would sync. Keep the remote private.")

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
    streams = parse_streams(answers.get("STREAMS"))
    git_mode = normalize_git_mode(answers.get("GIT_MODE"))
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
    # sources config: which streams the default loop-closing flow checks
    (T/"_config/sources.md").write_text(
        sources_config_yaml(streams, git_mode, datetime.date.today().isoformat()))

    # 6. git init — conditional on the chosen mode. local (default) and remote both
    #    init a repo (remote adds a remote later, by hand); none skips git entirely.
    if git_mode != "none":
        try:
            if not (T/".git").exists():
                subprocess.run(["git", "init", "-q"], cwd=str(T), check=False)
        except FileNotFoundError:
            pass  # git not installed — the user can init later

    print(f"init: created instance at {T} (packs: {','.join(packs)})")
    print_post_init(streams, git_mode)
    return 0

if __name__ == "__main__":
    sys.exit(main())
