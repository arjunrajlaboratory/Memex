#!/usr/bin/env python3
"""Initialize a new Memex instance from the engine template (user-time).

Usage:
  memex_init.py --eng <engine-dir> --target <new-vault-dir> \
     [--packs core,pi] [--answers answers.json | --interview]

Bakes {{TOKENS}} -> answers, copies selected packs + hardened core, scaffolds
folders, installs + wires hooks, assembles the contract, and records the engine
manifest/baseline used by future updates. Refuses to write into a non-empty
target unless --force (which overlays, it does not wipe).
"""
from __future__ import annotations

import argparse
import json
import pathlib
import subprocess
import sys

from memex_bake import (
    DEFAULT_STREAMS,
    PORT_TOKENS,
    STREAM_MCP,
    VALID_STREAMS,
    answers_with_defaults,
    bake,
    bake_engine,
    normalize_git_mode,
    parse_account_list,
    parse_streams,
    read_json,
    sources_config_yaml,
    strip_sections,
    write_manifest_and_baseline,
)

# Re-exported for the existing unittest module.
__all__ = [
    "bake",
    "strip_sections",
    "parse_account_list",
    "parse_streams",
    "normalize_git_mode",
    "sources_config_yaml",
    "DEFAULT_STREAMS",
]


def ask_streams() -> list[str]:
    """Per-stream y/n for the default loop-closing flow."""
    print("\nWhich streams should the daily flow check by default (capture-comms)?")
    chosen = []
    for stream in VALID_STREAMS:
        on_by_default = stream in DEFAULT_STREAMS
        prompt = "Y/n" if on_by_default else "y/N"
        value = input(f"  Enable {stream}? [{prompt}]: ").strip().lower()
        enabled = (value in ("y", "yes")) if value else on_by_default
        if enabled:
            chosen.append(stream)
    return chosen


def ask_git_mode() -> str:
    """Privacy-aware version-control mode. local (default) | none | remote."""
    print("\nVersion-control mode for this vault:")
    print("  local  - git, local-only, no remote (recommended; default)")
    print("  none   - no git (no history, no audit trail, no recovery)")
    print("  remote - git + a remote (PRIVACY: reconciled facts leave your machine)")
    return normalize_git_mode(input("  git mode [local]: ").strip().lower())


def interview(manifest: dict, packs: list[str]) -> dict:
    answers = {}
    pi_enabled = "pi" in packs
    for placeholder in manifest["placeholders"]:
        if "[pi pack]" in placeholder["prompt"] and not pi_enabled:
            answers[placeholder["token"]] = ""
            continue
        default = placeholder.get("example", "")
        value = input(f"{placeholder['prompt']} [{default}]: ").strip()
        answers[placeholder["token"]] = value or (
            default if placeholder["token"] in PORT_TOKENS else value
        )
    answers["STREAMS"] = ask_streams()
    answers["GIT_MODE"] = ask_git_mode()
    return answers


def print_post_init(streams: list[str], git_mode: str) -> None:
    """Print stream-access grant instructions + git-mode guidance/warnings."""
    if streams:
        print("\nEnabled streams: " + ", ".join(streams))
        print("To let Claude read each, connect its MCP connector in your client")
        print("(Claude.ai -> Settings -> Connectors, or your MCP config):")
        for stream in streams:
            print(f"  - {stream}: {STREAM_MCP[stream]}")
        print("Capture stays empty (never errors) until a stream is connected.")
    if git_mode == "none":
        print("\ngit mode: none - no version history. You lose the audit trail,")
        print("time-travel, and recovery from a bad edit. Run `git init` later to enable.")
    elif git_mode == "remote":
        print("\ngit mode: remote - set up your remote (use a PRIVATE repo):")
        print("  git -C <vault> remote add origin <url>")
        print("  git -C <vault> push -u origin main")
        print("PRIVACY: raw comms under Inbox/ are gitignored and never push, but")
        print("reconciled facts (closed tasks, Person notes, Decisions) DO push;")
        print("`sensitivity: sensitive` notes would sync. Keep the remote private.")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--eng", required=True)
    parser.add_argument("--target", required=True)
    parser.add_argument("--packs", default="core")
    parser.add_argument("--answers")
    parser.add_argument("--interview", action="store_true")
    parser.add_argument(
        "--force",
        action="store_true",
        help="overlay into an existing non-empty target (does not wipe)",
    )
    args = parser.parse_args()

    if not args.interview and not args.answers:
        print("error: supply --answers <file> or --interview")
        return 1

    engine_dir = pathlib.Path(args.eng).expanduser().resolve()
    target = pathlib.Path(args.target).expanduser()
    packs = [pack.strip() for pack in args.packs.split(",") if pack.strip()]
    placeholder_manifest = read_json(engine_dir / "placeholders.json")

    if target.exists() and any(target.iterdir()) and not args.force:
        print(f"refusing: {target} is not empty (use --force to overlay)")
        return 1
    target.mkdir(parents=True, exist_ok=True)

    answers = interview(placeholder_manifest, packs) if args.interview else json.load(open(args.answers))
    streams = parse_streams(answers.get("STREAMS"))
    git_mode = normalize_git_mode(answers.get("GIT_MODE"))
    answers = answers_with_defaults(placeholder_manifest, answers)
    answers["STREAMS"] = streams
    answers["GIT_MODE"] = git_mode

    source_map = bake_engine(
        engine_dir,
        target,
        answers,
        packs,
        streams=streams,
        git_mode=git_mode,
        include_scaffold=True,
        include_seeds=True,
    )
    write_manifest_and_baseline(
        engine_dir=engine_dir,
        vault_dir=target,
        staged_dir=target,
        source_map=source_map,
        answers=answers,
        packs=packs,
    )

    if git_mode != "none":
        try:
            if not (target / ".git").exists():
                subprocess.run(["git", "init", "-q"], cwd=str(target), check=False)
        except FileNotFoundError:
            pass

    print(f"init: created instance at {target} (packs: {','.join(packs)})")
    print_post_init(streams, git_mode)
    return 0


if __name__ == "__main__":
    sys.exit(main())
