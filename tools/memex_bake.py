"""Shared Memex engine baking, layout, and manifest helpers.

This module is intentionally importable by both user-facing scripts:
`memex_init.py` and `memex_update.py`. Keep it free of CLI behavior.
"""
from __future__ import annotations

import datetime
import fnmatch
import hashlib
import json
import pathlib
import re
import shutil
import subprocess
from dataclasses import dataclass, field
from typing import Any


TOKEN_RE = re.compile(r"\{\{([A-Z0-9_]+)\}\}")
# Conditional section around OPTIONAL-token prose. {{?TOKEN}}...{{/TOKEN}} keeps
# its span iff the answer is non-blank; {{^TOKEN}}...{{/TOKEN}} iff blank.
SECTION_RE = re.compile(r"\{\{([?^])([A-Z0-9_]+)\}\}(.*?)\{\{/\2\}\}", re.DOTALL)

TEXT_EXTS = {
    ".md",
    ".ts",
    ".tsx",
    ".sh",
    ".json",
    ".plist",
    ".service",
    ".scss",
    ".py",
    ".tex",
    ".sty",
    ".yaml",
    ".yml",
}

# Source streams + git mode are behavior answers, not {{TOKEN}} placeholders.
VALID_STREAMS = ["email", "slack", "calendar"]
DEFAULT_STREAMS = ["email", "slack"]
STREAM_MCP = {
    "email": "claude_ai_Gmail",
    "slack": "claude_ai_Slack",
    "calendar": "claude_ai_Google_Calendar",
}
VALID_GIT_MODES = ["local", "none", "remote"]
PORT_TOKENS = {"QUARTZ_PORT", "QUARTZ_WS_PORT"}

SCAFFOLD_DIRS = [
    "Atlas/Areas",
    "Atlas/Projects",
    "Atlas/People",
    "Atlas/Organizations",
    "Atlas/Sources",
    "Atlas/Concepts",
    "Atlas/Decisions",
    "Atlas/Ideas",
    "Atlas/Implementations",
    "Atlas/Trackers",
    "Atlas/Trackers/Digests",
    "Atlas/Efforts",
    "Atlas/Relationships",
    "Atlas/Interactions",
    "Ops/Tasks",
    "Ops/Briefings",
    "Ops/Calendars",
    "Ops/Reviews",
    "Ops/Followups",
    "Ops/Views",
    "Agents/Jobs",
    "Agents/Runs",
    "Agents/Approvals",
    "Raw/sources",
    "Inbox",
    "outputs",
    "Drafts",
    "_config",
]

LOCATION_MAP = {
    "skills": ".claude/skills",
    "schemas": "_schemas",
    "templates": "_templates",
    "workflows": "_workflows",
    "prompts": "Agents/Prompts",
    "cv": "CV",
    "scripts": "scripts",
}

# All of .memex/ stays machine-local: the manifest embeds the user's full
# answers dict (name, emails, paths, Drive IDs), and the baseline cache /
# update staging are derived state — none of it should ever be committed
# (in remote git mode a committed manifest would push personal data).
GITIGNORE_LOCAL_ENTRIES = [
    ".memex/",
]


@dataclass
class BakeRecord:
    path: str
    pack: str | None
    source: str | None = None


@dataclass
class BakeResult:
    files: dict[str, BakeRecord] = field(default_factory=dict)

    def record(self, path: pathlib.Path | str, pack: str | None, source: pathlib.Path | str | None = None) -> None:
        posix = path.as_posix() if isinstance(path, pathlib.Path) else str(path).replace("\\", "/")
        source_posix = None
        if source is not None:
            source_posix = source.as_posix() if isinstance(source, pathlib.Path) else str(source).replace("\\", "/")
        self.files[posix] = BakeRecord(path=posix, pack=pack, source=source_posix)


def read_json(path: pathlib.Path) -> Any:
    return json.loads(path.read_text())


def write_json(path: pathlib.Path, payload: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2, sort_keys=True) + "\n")


def sha256_file(path: pathlib.Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def strip_sections(text: str, answers: dict[str, str]) -> str:
    """Resolve {{?TOKEN}}...{{/TOKEN}} / {{^TOKEN}}...{{/TOKEN}} spans.

    Iterates to a fixed point so cross-token nesting like
    {{?A}}...{{?B}}...{{/B}}...{{/A}} resolves inner sections kept by an
    outer pass instead of leaving raw inner markers behind.
    """

    def repl(m: re.Match[str]) -> str:
        sigil, token, body = m.group(1), m.group(2), m.group(3)
        if token not in answers:
            return m.group(0)
        nonblank = str(answers[token]).strip() != ""
        keep = nonblank if sigil == "?" else not nonblank
        return body if keep else ""

    prev = None
    while prev != text:
        prev = text
        text = SECTION_RE.sub(repl, text)
    return text


def normalize_answers(answers: dict[str, Any]) -> dict[str, str]:
    return {k: str(v) for k, v in answers.items() if not isinstance(v, (list, dict))}


def bake(text: str, answers: dict[str, Any], normalized: dict[str, str] | None = None) -> str:
    """Replace catalogued {{TOKEN}}s with answers, preserving unknown tokens."""
    normalized = normalized if normalized is not None else normalize_answers(answers)
    text = strip_sections(text, normalized)
    return TOKEN_RE.sub(lambda m: normalized.get(m.group(1), m.group(0)), text)


def bake_file(src: pathlib.Path, dst: pathlib.Path, answers: dict[str, Any], normalized: dict[str, str] | None = None) -> None:
    dst.parent.mkdir(parents=True, exist_ok=True)
    if src.suffix in TEXT_EXTS:
        dst.write_text(bake(src.read_text(errors="ignore"), answers, normalized))
        shutil.copymode(src, dst)
    else:
        shutil.copy2(src, dst)


def bake_tree(src: pathlib.Path, dst: pathlib.Path, answers: dict[str, Any], result: BakeResult | None = None, pack: str | None = None, normalized: dict[str, str] | None = None) -> None:
    normalized = normalized if normalized is not None else normalize_answers(answers)
    for fp in src.rglob("*"):
        if fp.is_file():
            rel = fp.relative_to(src)
            bake_file(fp, dst / rel, answers, normalized)
            if result is not None:
                result.record(rel, pack, fp)


def parse_streams(raw: Any) -> list[str]:
    """Normalize a STREAMS answer into an ordered, de-duplicated stream list."""
    if raw is None:
        return list(DEFAULT_STREAMS)
    items = raw.split(",") if isinstance(raw, str) else list(raw)
    seen, out = set(), []
    for s in (str(x).strip().lower() for x in items):
        if s in VALID_STREAMS and s not in seen:
            seen.add(s)
            out.append(s)
    return out


def normalize_git_mode(raw: Any) -> str:
    m = (raw or "local").strip().lower()
    return m if m in VALID_GIT_MODES else "local"


def parse_account_list(raw: Any) -> list[str]:
    """Normalize a comma/list answer into ordered, de-duplicated account strings."""
    if raw is None:
        return []
    items = raw.split(",") if isinstance(raw, str) else list(raw)
    seen, out = set(), []
    for item in (str(x).strip() for x in items):
        if item and item not in seen:
            seen.add(item)
            out.append(item)
    return out


def _inline_or_none(value: str) -> str:
    return f"`{value}`" if value else "none listed"


def _yaml_string(value: str) -> str:
    return json.dumps(value)


def _yaml_list(values: list[str]) -> str:
    return "[" + ", ".join(json.dumps(v) for v in values) + "]"


def sources_config_yaml(
    streams: list[str],
    git_mode: str,
    today: str,
    *,
    connected_email: str = "",
    forwarding_email: str = "",
    other_sending_accounts: Any = None,
) -> str:
    def line(name: str) -> str:
        en = "true" if name in streams else "false"
        extra = ", mode: minimal" if name == "calendar" else ""
        return f"  {name}: {{ enabled: {en}, mcp: {STREAM_MCP[name]}{extra} }}"

    connected = str(connected_email or "").strip()
    forwarding = str(forwarding_email or "").strip()
    other_senders = parse_account_list(other_sending_accounts)
    rows = "\n".join(line(s) for s in VALID_STREAMS)
    return f"""---
type: config
scope: sources
git_mode: {git_mode}
updated: {today}
mailboxes:
  gmail_connected: {_yaml_string(connected)}
  forwarding_in: {_yaml_string(forwarding)}
  other_sending_accounts: {_yaml_list(other_senders)}
streams:
{rows}
---

# Sources

Which streams the daily loop-closing flow checks. `capture-comms` +
`reconcile-from-comms` run by default at the top of `daily-briefing`; flip an
`enabled:` above to turn a stream on or off - no re-init needed.

- **email** / **slack** - scanned by `capture-comms` (sent + received). Sent
  messages are the strongest loop-*closing* signals.
- **calendar** (`mode: minimal`) - a Task linked to a calendar event whose end-time
  has passed becomes a "confirm close?" item; no attendee / `last_contact` bumping.

## Email visibility

- **Connected Gmail mailbox:** {_inline_or_none(connected)} - this is the only mailbox
  the Gmail MCP searches.
- **Forwarding-in address:** {_inline_or_none(forwarding)} - received mail may arrive
  in the connected mailbox, but sent mail from this address is invisible unless it was
  also sent through the connected mailbox.
- **Other sending accounts:** {_inline_or_none(", ".join(other_senders))} - sent mail
  from these accounts is invisible to `in:sent` unless those mailboxes are separately
  connected. Treat missing sent-mail evidence for them as inconclusive, not "not sent."

If this file is absent, skills fall back to: email + slack enabled, calendar
planning-only.

## Adding a new source (e.g. Notion)
1. Add a `streams.<name>` entry above with its MCP server id.
2. Add a scan block for that MCP to `capture-comms` (Step 3/4).
3. No `reconcile-from-comms` change needed - it reads the same `## Action items` API.
"""


def answers_with_defaults(manifest: dict[str, Any], answers: dict[str, Any]) -> dict[str, Any]:
    """Ensure every catalogued token has a value.

    Port tokens additionally treat a BLANK answer as unanswered — a blank port
    would otherwise bake `--port ` (empty flag value) into quartz scripts.
    """
    out = dict(answers)
    for ph in manifest["placeholders"]:
        token = ph["token"]
        if token not in out:
            out[token] = ph.get("example", "") if token in PORT_TOKENS else ""
        elif token in PORT_TOKENS and not str(out[token]).strip():
            out[token] = ph.get("example", "")
    return out


def placeholder_allows_blank(placeholder: dict[str, Any]) -> bool:
    if placeholder.get("optional") is True or placeholder.get("allow_blank") is True:
        return True
    prompt = str(placeholder.get("prompt", "")).lower()
    return "or blank" in prompt


def validate_packs(engine_dir: pathlib.Path, packs: list[str]) -> None:
    known = set(read_json(engine_dir / "packs.json")) - {"hardened"}
    unknown = [p for p in packs if p not in known]
    if unknown:
        raise ValueError(
            f"unknown pack(s): {', '.join(unknown)} (known: {', '.join(sorted(known))})"
        )


def engine_version(engine_dir: pathlib.Path) -> str:
    version_path = engine_dir / "VERSION"
    return version_path.read_text().strip() if version_path.exists() else "0.0.0"


def engine_commit(engine_dir: pathlib.Path) -> str | None:
    try:
        out = subprocess.run(
            ["git", "-C", str(engine_dir), "rev-parse", "--short", "HEAD"],
            check=True,
            text=True,
            capture_output=True,
        )
    except (FileNotFoundError, subprocess.CalledProcessError):
        return None
    return out.stdout.strip() or None


def load_engine_layout(engine_dir: pathlib.Path) -> dict[str, Any]:
    return read_json(engine_dir / "engine_layout.json")


def _matches(path: str, pattern: str) -> bool:
    path = path.strip("/")
    pattern = pattern.strip("/")
    if pattern.endswith("/**"):
        prefix = pattern[:-3].rstrip("/")
        return path == prefix or path.startswith(prefix + "/")
    return fnmatch.fnmatchcase(path, pattern)


def classify_path(path: str, layout: dict[str, Any]) -> tuple[str | None, str | None]:
    """Return (class, kind) for a vault-relative path according to engine_layout."""
    path = path.replace("\\", "/").strip("/")
    for pattern in layout.get("seed", []):
        if _matches(path, pattern):
            return "seed", "prose" if pathlib.PurePosixPath(path).suffix == ".md" else "code"
    for pattern in layout.get("hybrid", []):
        if _matches(path, pattern):
            return "hybrid", "code"
    for kind, patterns in layout.get("framework", {}).items():
        for pattern in patterns:
            if _matches(path, pattern):
                return "framework", kind
    for pattern in layout.get("data", []):
        if _matches(path, pattern):
            return "data", None
    return None, None


def ensure_gitignore_entries(vault_dir: pathlib.Path, entries: list[str] | None = None) -> None:
    entries = entries or GITIGNORE_LOCAL_ENTRIES
    gitignore = vault_dir / ".gitignore"
    existing = gitignore.read_text().splitlines() if gitignore.exists() else []
    normalized = {line.strip() for line in existing}
    to_add = [entry for entry in entries if entry not in normalized]
    if not to_add:
        return
    with gitignore.open("a") as f:
        if existing and existing[-1].strip():
            f.write("\n")
        f.write("\n# Memex local state (manifest incl. answers, baseline, update staging)\n")
        for entry in to_add:
            f.write(entry + "\n")


def _write_seed_files(target: pathlib.Path, answers: dict[str, Any], streams: list[str], git_mode: str, today: str, result: BakeResult) -> None:
    seeds: dict[str, str] = {}
    seeds["log.md"] = "# log\n"
    seeds["Inbox/README.md"] = "# Inbox drop zone\n"
    seeds["outputs/README.md"] = "# Generated artifacts\n\nGitignored content, tracked structure.\n"
    seeds["Drafts/README.md"] = (
        "# Drafts\n\n"
        "Git-tracked staging area for work-in-progress documents to finalize later - "
        "LLM-written prose, code, reports, anything you want to iterate on across "
        "sessions before it becomes a typed note.\n\n"
        "Text (markdown, code, notes) is committed so drafts are versioned; heavy "
        "binaries (`*.pdf`, `*.docx`, `*.png`, `*.mp4`, `*.zip`, ...) are gitignored - "
        "route real binary artifacts to `outputs/` instead.\n\n"
        "Lifecycle: draft here -> finalize -> promote into a typed `Atlas/` note (or "
        "export the artifact) -> archive or delete the draft. This is a workbench, "
        "not a permanent home.\n"
    )
    owner = str(answers.get("OWNER_NAME", "")).strip()
    seeds["index.md"] = (
        f"# {owner + ' - ' if owner else ''}Memex\n\n"
        "Home page for this vault. Browse the typed-note dashboards at "
        "`/dashboards/`, or read `AGENTS.md` for how agents operate here.\n"
    )
    seeds["_config/sources.md"] = sources_config_yaml(
        streams,
        git_mode,
        today,
        connected_email=answers.get("OWNER_PRIMARY_EMAIL", ""),
        forwarding_email=answers.get("OWNER_FORWARDING_EMAIL", ""),
        other_sending_accounts=answers.get("OWNER_SENDING_ACCOUNTS", ""),
    )
    seeds["_config/overrides.md"] = (
        "---\n"
        "type: config\n"
        "scope: overrides\n"
        f"updated: {today}\n"
        "---\n\n"
        "# Overrides\n\n"
        "Use this file for local operating preferences that should take precedence "
        "over engine-owned framework defaults. Keep durable customizations here "
        "instead of editing `.claude/skills/`, `_schemas/`, `_templates/`, "
        "`_workflows/`, `Agents/Prompts/`, `scripts/`, or `quartz/` in place.\n"
    )
    # Seeds are write-once: never clobber an existing file (re-running init with
    # --force must not reset log.md / _config/overrides.md). Existing seeds are
    # still recorded so the manifest carries seed entries either way.
    for rel, text in seeds.items():
        path = target / rel
        if not path.exists():
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(text)
        result.record(rel, None, None)


def bake_engine(
    engine_dir: pathlib.Path,
    target: pathlib.Path,
    answers: dict[str, Any],
    packs: list[str],
    *,
    streams: list[str] | None = None,
    git_mode: str | None = None,
    today: str | None = None,
    include_scaffold: bool = False,
    include_seeds: bool = True,
) -> BakeResult:
    """Bake selected packs + hardened engine content into `target`.

    Returns a per-file source map keyed by vault-relative POSIX path.
    """
    result = BakeResult()
    engine_dir = engine_dir.expanduser().resolve()
    target.mkdir(parents=True, exist_ok=True)
    today = today or datetime.date.today().isoformat()
    streams = parse_streams(answers.get("STREAMS")) if streams is None else streams
    git_mode = normalize_git_mode(answers.get("GIT_MODE")) if git_mode is None else git_mode
    normalized = normalize_answers(answers)
    # launchd identity: must be unique PER VAULT PATH, not per display name —
    # two vaults initialized from one answers file share VAULT_NAME, and a
    # shared launchd Label/filename means the second LaunchAgent clobbers the
    # first. CC_PROJECT_SLUG is always path-derived at init; VAULT_NAME is the
    # fallback only for legacy manifests that predate slug derivation.
    launchd_id = (
        str(answers.get("CC_PROJECT_SLUG", "")).strip().lstrip("-")
        or str(answers.get("VAULT_NAME", "")).strip()
    )
    normalized["MEMEX_LAUNCHD_ID"] = launchd_id  # computed, never interviewed

    if include_scaffold:
        for d in SCAFFOLD_DIRS:
            (target / d).mkdir(parents=True, exist_ok=True)
        (target / "Inbox/_filed").mkdir(parents=True, exist_ok=True)

    for pack in packs:
        base = engine_dir / "packs" / pack
        if not base.exists():
            continue
        for section, dest in LOCATION_MAP.items():
            srcd = base / section
            if srcd.exists():
                for fp in srcd.rglob("*"):
                    if fp.is_file():
                        rel = fp.relative_to(srcd)
                        dst = target / dest / rel
                        bake_file(fp, dst, answers, normalized)
                        result.record(dst.relative_to(target), pack, fp)

    hooks = engine_dir / "hardened/hooks"
    if hooks.exists():
        for fp in hooks.rglob("*"):
            if fp.is_file():
                dst = target / ".claude/hooks" / fp.relative_to(hooks)
                bake_file(fp, dst, answers, normalized)
                result.record(dst.relative_to(target), "hardened", fp)

    settings = engine_dir / "hardened/settings.json"
    if settings.exists():
        bake_file(settings, target / ".claude/settings.json", answers, normalized)
        result.record(".claude/settings.json", "hardened", settings)

    gitignore = engine_dir / "hardened/gitignore"
    if gitignore.exists():
        bake_file(gitignore, target / ".gitignore", answers, normalized)
        ensure_gitignore_entries(target)
        result.record(".gitignore", None, gitignore)

    quartz = engine_dir / "hardened/quartz"
    if quartz.exists():
        for fp in quartz.rglob("*"):
            if fp.is_file():
                dst = target / "quartz" / fp.relative_to(quartz)
                bake_file(fp, dst, answers, normalized)
                result.record(dst.relative_to(target), "hardened", fp)

    launchd = engine_dir / "hardened/launchd"
    if launchd.exists():
        for fp in launchd.iterdir():
            if fp.is_file():
                if fp.suffix == ".plist":
                    # Carry the path-derived vault identity in the plist
                    # filename so multiple vaults' launchd agents (incl. the
                    # baked Label) never collide on one machine.
                    plist_name = f"com.memex.quartz.{launchd_id}.plist" if launchd_id else "com.memex.quartz.plist"
                    dst = target / "scripts/launchd" / plist_name
                else:
                    dst = target / "scripts" / fp.name
                bake_file(fp, dst, answers, normalized)
                result.record(dst.relative_to(target), "hardened", fp)

    # Linux/WSL2 durable-serve: the systemd user-service equivalent of the macOS
    # launchd plist above. Hand-curated (like hardened/scripts/), so it's not
    # derived/wiped. The unit filename carries the path-derived vault id so two
    # vaults' services never collide — exactly as the plist filename does.
    systemd = engine_dir / "hardened/systemd"
    if systemd.exists():
        # systemd treats % in directive values (ExecStart=, WorkingDirectory=,
        # Description=, ...) as a unit specifier, so a literal % from a baked
        # value — e.g. a vault under /home/u/100%memex — would make the unit
        # fail to load ("Failed to resolve unit specifiers ... Invalid slot").
        # Double % to %% in the substituted VALUES only; the template's own text
        # is untouched, so any intentional %h/%i specifier an author writes there
        # still survives.
        systemd_normalized = {k: v.replace("%", "%%") for k, v in normalized.items()}
        for fp in systemd.iterdir():
            if fp.is_file():
                if fp.suffix == ".service":
                    unit_name = f"memex-quartz.{launchd_id}.service" if launchd_id else "memex-quartz.service"
                    dst = target / "scripts/systemd" / unit_name
                    bake_file(fp, dst, answers, systemd_normalized)
                else:
                    dst = target / "scripts/systemd" / fp.name
                    bake_file(fp, dst, answers, normalized)
                result.record(dst.relative_to(target), "hardened", fp)

    # Hand-curated vault utilities (memex-doctor.sh etc.) — installed flat
    # into scripts/ alongside serve_quartz.sh.
    extra_scripts = engine_dir / "hardened/scripts"
    if extra_scripts.exists():
        for fp in extra_scripts.iterdir():
            if fp.is_file():
                dst = target / "scripts" / fp.name
                bake_file(fp, dst, answers, normalized)
                result.record(dst.relative_to(target), "hardened", fp)

    for base_name, out_name in [("AGENTS.base.md", "AGENTS.md"), ("CLAUDE.base.md", "CLAUDE.md")]:
        text = bake((engine_dir / "hardened/contract" / base_name).read_text(), answers, normalized)
        if "pi" in packs:
            frag = bake((engine_dir / "hardened/contract/pi-fragment.md").read_text(), answers, normalized)
            text = text.replace("<!-- PI_CONTRACT_FRAGMENT -->", frag)
        else:
            text = text.replace("<!-- PI_CONTRACT_FRAGMENT -->", "")
        (target / out_name).write_text(text)
        result.record(out_name, "hardened", engine_dir / "hardened/contract" / base_name)

    if include_seeds:
        _write_seed_files(target, answers, streams, git_mode, today, result)

    if include_seeds and "pi" in packs:
        registries = {
            "Atlas/Letters/index.md": (
                "---\ntype: config\nscope: letters-registry\n---\n\n# Letters\n\n"
                "Registry/landing page for Letter notes. The canonical letters live in Google Drive\n"
                f"(`recommendation_letters`, folder ID {_inline_or_none(str(answers.get('LETTERS_DRIVE_ID', '')).strip())}); the letterhead\n"
                f"template is Drive ID {_inline_or_none(str(answers.get('LETTERHEAD_TEMPLATE_ID', '')).strip())}.\n\n"
                "Record per-recipient Drive subfolder IDs here as `/ingest-letters` discovers them:\n\n"
                "| Recipient | Drive folder ID |\n| --- | --- |\n"
            ),
            "Atlas/Grants/index.md": (
                "---\ntype: config\nscope: grants-registry\n---\n\n# Grants\n\n"
                "The canonical registry of all Grant notes. One row per grant; `/dashboards/` views build on it.\n\n"
                "| Grant | Status | Mechanism | Due |\n| --- | --- | --- | --- |\n"
            ),
        }
        for rel, text in registries.items():
            path = target / rel
            if not path.exists():
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text(text)
            result.record(rel, "pi", None)

    return result


def manifest_files_for_tree(root: pathlib.Path, source_map: BakeResult, layout: dict[str, Any]) -> dict[str, dict[str, Any]]:
    files: dict[str, dict[str, Any]] = {}
    for rel, record in sorted(source_map.files.items()):
        path = root / rel
        if not path.exists() or not path.is_file():
            continue
        cls, kind = classify_path(rel, layout)
        if cls is None:
            continue
        files[rel] = {
            "sha256": sha256_file(path),
            "class": cls,
            "kind": kind,
            "pack": record.pack,
        }
    return files


def write_manifest_and_baseline(
    *,
    engine_dir: pathlib.Path,
    vault_dir: pathlib.Path,
    staged_dir: pathlib.Path,
    source_map: BakeResult,
    answers: dict[str, Any],
    packs: list[str],
    installed_at: str | None = None,
    files: dict[str, dict[str, Any]] | None = None,
) -> dict[str, Any]:
    """Write `.memex/manifest.json` and refresh baseline from staged framework.

    `files` lets callers that already hashed the staged tree (via
    manifest_files_for_tree) reuse that work instead of rehashing here."""
    layout = load_engine_layout(engine_dir)
    today = datetime.date.today().isoformat()
    manifest_path = vault_dir / ".memex/manifest.json"
    previous = read_json(manifest_path) if manifest_path.exists() else {}
    installed = installed_at or previous.get("installed_at") or today
    if files is None:
        files = manifest_files_for_tree(staged_dir, source_map, layout)
    baseline = vault_dir / ".memex/baseline"
    if baseline.exists():
        shutil.rmtree(baseline)
    baseline.mkdir(parents=True, exist_ok=True)
    for rel, meta in files.items():
        if meta["class"] not in {"framework", "hybrid"}:
            continue
        src = staged_dir / rel
        if src.exists():
            dst = baseline / rel
            dst.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(src, dst)
    payload = {
        "engine_version": engine_version(engine_dir),
        "engine_commit": engine_commit(engine_dir),
        "installed_at": installed,
        "updated_at": today,
        "packs": packs,
        "answers": answers,
        "files": files,
    }
    write_json(manifest_path, payload)
    ensure_gitignore_entries(vault_dir)
    return payload
