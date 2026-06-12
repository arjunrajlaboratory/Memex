#!/usr/bin/env python3
"""Update an installed Memex vault from a newer engine tree.

The updater deliberately has a deterministic core. It replaces only framework
files that still match the recorded baseline, seeds absent seed files, prunes
untouched files removed upstream, and writes a plan for anything requiring
judgement: local edits, collisions, config/code choices, and likely renames.
"""
from __future__ import annotations

import argparse
import datetime
import difflib
import io
import pathlib
import re
import shutil
import subprocess
import sys
import tarfile
import tempfile
from collections import Counter
from typing import Any

from memex_bake import (
    BakeResult,
    PORT_TOKENS,
    answers_with_defaults,
    bake_engine,
    engine_commit,
    engine_version,
    ensure_gitignore_entries,
    load_engine_layout,
    manifest_files_for_tree,
    normalize_git_mode,
    placeholder_allows_blank,
    read_json,
    sha256_file,
    write_json,
    write_manifest_and_baseline,
)


RENAME_SIMILARITY_THRESHOLD = 0.82
ENGINE_FILE_CLASSES = {"framework", "hybrid"}
DRIVE_RE = re.compile(r"^[A-Za-z]:")


def assert_safe_rel_path(rel: str, origin: str) -> None:
    """Manifest/plan paths are consumed by copy/delete operations against the
    vault. In an LLM-maintained vault those files are agent-writable, so a
    poisoned entry must never escape the vault root."""
    raw = str(rel).replace("\\", "/")
    p = pathlib.PurePosixPath(raw)
    if p.is_absolute() or raw.startswith("~") or DRIVE_RE.match(raw) or ".." in p.parts or not raw.strip():
        raise RuntimeError(f"unsafe path {rel!r} in {origin}; refusing")


def validate_plan_paths(plan: dict[str, Any]) -> None:
    for entry in plan.get("entries", []):
        for key in ("path", "new_path", "archive_path", "aside_path"):
            value = entry.get(key)
            if isinstance(value, str) and value:
                assert_safe_rel_path(value, f"plan entry {key}")
        raw_extra = entry.get("extra_paths", [])
        if isinstance(raw_extra, str):
            raw_extra = [raw_extra]
        for extra in raw_extra:
            if isinstance(extra, str) and extra:
                assert_safe_rel_path(extra, "plan entry extra_paths")


class Disposition:
    UNCHANGED = "unchanged"
    REPLACE_UNTOUCHED = "replace-untouched"
    EDITED = "edited"
    DELETED_LOCAL = "deleted-local"
    NEW = "new"
    COLLISION = "collision"
    REMOVED_UPSTREAM = "removed-upstream"
    REMOVED_UPSTREAM_EDITED = "removed-upstream-edited"
    RENAME_CANDIDATE = "rename-candidate"
    RENAME_COLLISION = "rename-collision"
    SEED_IF_ABSENT = "seed-if-absent"
    SEED_PRESENT = "seed-present"


UNRESOLVED_DISPOSITIONS = {
    Disposition.EDITED,
    Disposition.DELETED_LOCAL,
    Disposition.REMOVED_UPSTREAM_EDITED,
    Disposition.RENAME_CANDIDATE,
    Disposition.RENAME_COLLISION,
    Disposition.COLLISION,
}
SAFE_PATH_DISPOSITIONS = {
    Disposition.REMOVED_UPSTREAM,
    Disposition.SEED_IF_ABSENT,
    Disposition.REPLACE_UNTOUCHED,
    Disposition.NEW,
}
AUTO_APPLIED_DISPOSITIONS = {
    Disposition.UNCHANGED,
    Disposition.SEED_PRESENT,
}
ABORT_UNTRACKED_DISPOSITIONS = {
    Disposition.NEW,
    Disposition.SEED_IF_ABSENT,
}


def rel_files(root: pathlib.Path) -> set[str]:
    if not root.exists():
        return set()
    return {
        path.relative_to(root).as_posix()
        for path in root.rglob("*")
        if path.is_file()
    }


def copy_file(src: pathlib.Path, dst: pathlib.Path) -> None:
    dst.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(src, dst)


def remove_file(path: pathlib.Path) -> None:
    if path.exists() and path.is_file():
        path.unlink()


def parse_set_values(items: list[str] | None) -> dict[str, str]:
    """Parse repeated --set TOKEN=VALUE pairs into a dict."""
    out: dict[str, str] = {}
    for item in items or []:
        if "=" not in item:
            raise RuntimeError(f"--set expects TOKEN=VALUE, got {item!r}")
        key, value = item.split("=", 1)
        out[key.strip()] = value
    return out


def prune_finished_work_dirs(vault_dir: pathlib.Path) -> None:
    """Remove past .memex/update-work/* runs that are complete or dry-run previews,
    so staging trees don't accumulate. Pending runs are kept (a merge may be in
    flight); `abort` removes those explicitly. Work dirs with no inline plan are
    kept because a custom --plan may still point at their staged/version files."""
    base = vault_dir / ".memex/update-work"
    if not base.exists():
        return
    for d in base.iterdir():
        if not d.is_dir():
            continue
        plan = d / "plan.json"
        status = None
        if plan.exists():
            try:
                status = read_json(plan).get("status")
            except (ValueError, OSError):
                status = None
        if status in {"complete", "dry-run"}:
            shutil.rmtree(d, ignore_errors=True)


def pending_update_plans(vault_dir: pathlib.Path) -> list[pathlib.Path]:
    base = vault_dir / ".memex/update-work"
    if not base.exists():
        return []
    pending: list[pathlib.Path] = []
    for plan in sorted(base.glob("*/plan.json")):
        try:
            status = read_json(plan).get("status")
        except (ValueError, OSError):
            continue
        if status in {"pending", "commit-failed", "applying"}:
            pending.append(plan)
    return pending


def strip_work_heavy(work_dir: pathlib.Path) -> None:
    """Drop the bulky staged tree + per-file version copies once they are no
    longer needed, keeping the small plan.json for review."""
    for sub in ("staged", "versions"):
        shutil.rmtree(work_dir / sub, ignore_errors=True)


def text_for_similarity(path: pathlib.Path) -> str | None:
    if not path.exists() or not path.is_file():
        return None
    data = path.read_bytes()
    if b"\0" in data:
        return None
    try:
        return data.decode("utf-8")
    except UnicodeDecodeError:
        return None


def content_similarity(left: pathlib.Path, right: pathlib.Path) -> float:
    left_text = text_for_similarity(left)
    right_text = text_for_similarity(right)
    if left_text is None or right_text is None:
        if left.exists() and right.exists() and sha256_file(left) == sha256_file(right):
            return 1.0
        return 0.0
    return difflib.SequenceMatcher(None, left_text, right_text).ratio()


def staged_version_path(work_dir: pathlib.Path, bucket: str, rel: str, src: pathlib.Path | None) -> str | None:
    if src is None or not src.exists() or not src.is_file():
        return None
    dst = work_dir / "versions" / bucket / rel
    copy_file(src, dst)
    return dst.as_posix()


def add_version_paths(
    entry: dict[str, Any],
    *,
    work_dir: pathlib.Path,
    baseline_dir: pathlib.Path,
    vault_dir: pathlib.Path,
    staged_dir: pathlib.Path,
    rel: str,
) -> None:
    entry["baseline_path"] = staged_version_path(work_dir, "baseline", rel, baseline_dir / rel)
    entry["current_path"] = staged_version_path(work_dir, "current", rel, vault_dir / rel)
    entry["staged_path"] = staged_version_path(work_dir, "staged", rel, staged_dir / rel)


def run_git(vault_dir: pathlib.Path, args: list[str], *, check: bool = True) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        # quotepath off so non-ASCII paths come back verbatim, not octal-escaped
        ["git", "-c", "core.quotepath=off", *args],
        cwd=str(vault_dir),
        text=True,
        capture_output=True,
        check=check,
    )


def prompt_input(prompt: str) -> str:
    try:
        return input(prompt)
    except EOFError as exc:
        raise RuntimeError(
            "interactive input is unavailable; rerun with --non-interactive, "
            "--set TOKEN=VALUE, or --allow-blank-tokens as appropriate"
        ) from exc


def subprocess_error(exc: subprocess.CalledProcessError) -> str:
    return (exc.stderr or exc.stdout or str(exc)).strip()


def is_git_repo(vault_dir: pathlib.Path) -> bool:
    if not (vault_dir / ".git").exists():
        return False
    try:
        out = run_git(vault_dir, ["rev-parse", "--is-inside-work-tree"])
    except (FileNotFoundError, subprocess.CalledProcessError):
        return False
    return out.stdout.strip() == "true"


def assert_clean_git(vault_dir: pathlib.Path) -> None:
    out = run_git(vault_dir, ["status", "--porcelain", "--untracked-files=all"])
    if out.stdout.strip():
        raise RuntimeError(
            "refusing: git working tree is dirty. Commit or stash local changes before running update."
        )


def dirty_paths(vault_dir: pathlib.Path) -> set[str]:
    out = run_git(vault_dir, ["status", "--porcelain", "--untracked-files=all"], check=False)
    paths: set[str] = set()
    for line in out.stdout.splitlines():
        if not line:
            continue
        path = line[3:]
        if " -> " in path:
            old, new = path.split(" -> ", 1)
            paths.add(old.strip('"'))
            paths.add(new.strip('"'))
        else:
            paths.add(path.strip('"'))
    return paths


def ensure_update_branch(vault_dir: pathlib.Path, version: str) -> str:
    branch = f"engine-update-{version}"
    current = run_git(vault_dir, ["branch", "--show-current"], check=False).stdout.strip()
    if current == branch:
        return branch
    exists = run_git(vault_dir, ["rev-parse", "--verify", f"refs/heads/{branch}"], check=False)
    if exists.returncode == 0:
        raise RuntimeError(
            f"update branch {branch} already exists; switch to it to continue that update "
            "or delete it before preparing from this branch"
        )
    run_git(vault_dir, ["switch", "-c", branch])
    return branch


def untrack_memex_state(vault_dir: pathlib.Path) -> None:
    """.memex/ is gitignored as of engine 0.x, but vaults installed by older
    engines committed .memex/manifest.json (which embeds the user's answers).
    gitignore does not untrack already-tracked files, so the next update would
    leave a permanently dirty worktree. Untrack once; the removal rides the
    update commit."""
    tracked = run_git(vault_dir, ["ls-files", "--", ".memex"], check=False).stdout.strip()
    if tracked:
        run_git(vault_dir, ["rm", "-r", "--cached", "-q", "--", ".memex"], check=False)


def filter_unignored(vault_dir: pathlib.Path, paths: set[str] | list[str]) -> list[str]:
    """Drop paths matched by .gitignore. An explicit `git add <ignored-path>`
    errors out, and some shipped framework files are gitignored (e.g. the Quartz
    build artifact `quartz/tsconfig.tsbuildinfo`, `quartz/.gitignore`); they live
    in the worktree but must never be staged."""
    items = sorted(paths)
    if not items:
        return []
    proc = run_git(vault_dir, ["check-ignore", "--", *items], check=False)
    ignored = {line for line in proc.stdout.splitlines() if line}
    return [p for p in items if p not in ignored]


def commit_update(vault_dir: pathlib.Path, version: str, paths: set[str] | None = None) -> bool:
    if paths:
        addable = []
        for path in filter_unignored(vault_dir, paths):
            if (vault_dir / path).exists() or run_git(vault_dir, ["ls-files", "--error-unmatch", "--", path], check=False).returncode == 0:
                addable.append(path)
        if addable:
            run_git(vault_dir, ["add", "--", *addable])
    else:
        run_git(vault_dir, ["add", "."])
    diff = run_git(vault_dir, ["diff", "--cached", "--quiet"], check=False)
    if diff.returncode == 0:
        return False
    run_git(vault_dir, ["commit", "-m", f"Update Memex engine to {version}"])
    return True


def extract_engine_commit(engine_dir: pathlib.Path, commit: str, dest: pathlib.Path) -> pathlib.Path:
    archive = subprocess.run(
        ["git", "-C", str(engine_dir), "archive", "--format=tar", commit],
        capture_output=True,
        check=False,
    )
    if archive.returncode != 0:
        stderr = archive.stderr.decode(errors="ignore").strip()
        raise RuntimeError(f"cannot reconstruct baseline from engine commit {commit}: {stderr}")
    dest.mkdir(parents=True, exist_ok=True)
    with tarfile.open(fileobj=io.BytesIO(archive.stdout), mode="r:") as tar:
        try:
            tar.extractall(dest, filter="data")
        except TypeError:  # Python < 3.12 has no filter= parameter
            tar.extractall(dest)
    return dest


def ensure_baseline(
    *,
    engine_dir: pathlib.Path,
    vault_dir: pathlib.Path,
    manifest: dict[str, Any],
    work_dir: pathlib.Path,
) -> pathlib.Path:
    baseline_dir = vault_dir / ".memex/baseline"
    if rel_files(baseline_dir):
        return baseline_dir

    old_commit = manifest.get("engine_commit")
    if not old_commit:
        raise RuntimeError(
            "baseline cache is missing and manifest has no engine_commit to reconstruct it"
        )
    old_engine = extract_engine_commit(engine_dir, old_commit, work_dir / "old-engine")
    reconstructed = work_dir / "reconstructed-baseline"
    bake_engine(
        old_engine,
        reconstructed,
        manifest.get("answers", {}),
        manifest.get("packs", ["core"]),
        include_scaffold=False,
        include_seeds=True,
    )
    return reconstructed


def fill_new_answers(
    placeholder_manifest: dict[str, Any],
    answers: dict[str, Any],
    *,
    interactive: bool,
    allow_blank_tokens: bool = False,
) -> tuple[dict[str, Any], list[str]]:
    updated = dict(answers)
    added: list[str] = []
    for placeholder in placeholder_manifest["placeholders"]:
        token = placeholder["token"]
        if token in updated:
            continue
        added.append(token)
        if interactive:
            default = placeholder.get("example", "")
            value = prompt_input(f"{placeholder['prompt']} [{default}]: ").strip()
            if value:
                updated[token] = value
            elif token in PORT_TOKENS:
                updated[token] = default
            elif placeholder_allows_blank(placeholder) or allow_blank_tokens:
                updated[token] = ""
            else:
                raise RuntimeError(
                    f"new token {token} needs a value. Re-run with --set {token}=VALUE "
                    "or --allow-blank-tokens to accept a blank."
                )
        else:
            updated[token] = placeholder.get("example", "") if token in PORT_TOKENS else ""
    return answers_with_defaults(placeholder_manifest, updated), added


def missing_required_tokens(placeholder_manifest: dict[str, Any], added_tokens: list[str]) -> list[str]:
    placeholders = {placeholder["token"]: placeholder for placeholder in placeholder_manifest["placeholders"]}
    return [
        token
        for token in added_tokens
        if token not in PORT_TOKENS and not placeholder_allows_blank(placeholders.get(token, {}))
    ]


def detect_renames(
    *,
    removed_paths: set[str],
    new_paths: set[str],
    old_meta: dict[str, dict[str, Any]],
    new_meta: dict[str, dict[str, Any]],
    baseline_dir: pathlib.Path,
    staged_dir: pathlib.Path,
) -> list[dict[str, Any]]:
    candidates: list[dict[str, Any]] = []
    used_removed: set[str] = set()
    used_new: set[str] = set()
    for old_path in sorted(removed_paths):
        old_suffix = pathlib.PurePosixPath(old_path).suffix
        best: tuple[float, str] | None = None
        for new_path in sorted(new_paths - used_new):
            if old_suffix and pathlib.PurePosixPath(new_path).suffix != old_suffix:
                continue
            if old_meta[old_path].get("kind") != new_meta[new_path].get("kind"):
                continue
            score = content_similarity(baseline_dir / old_path, staged_dir / new_path)
            if best is None or score > best[0]:
                best = (score, new_path)
        if best and best[0] >= RENAME_SIMILARITY_THRESHOLD:
            used_removed.add(old_path)
            used_new.add(best[1])
            candidates.append({"old_path": old_path, "new_path": best[1], "similarity": round(best[0], 4)})
    return candidates


def classify_update(
    *,
    manifest: dict[str, Any],
    layout: dict[str, Any],
    baseline_dir: pathlib.Path,
    vault_dir: pathlib.Path,
    staged_dir: pathlib.Path,
    source_map: BakeResult,
    work_dir: pathlib.Path,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]], dict[str, dict[str, Any]]]:
    staged_meta = manifest_files_for_tree(staged_dir, source_map, layout)
    old_fw = {
        rel: meta
        for rel, meta in manifest.get("files", {}).items()
        if meta.get("class") in ENGINE_FILE_CLASSES
    }
    new_fw = {
        rel: meta
        for rel, meta in staged_meta.items()
        if meta.get("class") in ENGINE_FILE_CLASSES
    }
    old_paths = set(old_fw)
    new_paths = set(new_fw)
    removed_paths = old_paths - new_paths
    brand_new_paths = new_paths - old_paths

    rename_candidates = detect_renames(
        removed_paths=removed_paths,
        new_paths=brand_new_paths,
        old_meta=old_fw,
        new_meta=new_fw,
        baseline_dir=baseline_dir,
        staged_dir=staged_dir,
    )
    renamed_old = {item["old_path"] for item in rename_candidates}
    renamed_new = {item["new_path"] for item in rename_candidates}

    entries: list[dict[str, Any]] = []
    unresolved: list[dict[str, Any]] = []

    for item in rename_candidates:
        old_path, new_path = item["old_path"], item["new_path"]
        current_path = vault_dir / old_path
        new_current_path = vault_dir / new_path
        old_hash = old_fw[old_path].get("sha256")
        edited = bool(current_path.exists() and old_hash and sha256_file(current_path) != old_hash)
        disposition = Disposition.RENAME_COLLISION if new_current_path.exists() else Disposition.RENAME_CANDIDATE
        entry = {
            "disposition": disposition,
            "path": old_path,
            "new_path": new_path,
            "class": new_fw[new_path].get("class", old_fw[old_path].get("class")),
            "kind": old_fw[old_path].get("kind"),
            "pack": old_fw[old_path].get("pack"),
            "similarity": item["similarity"],
            "edited": edited,
            "applied": False,
        }
        entry["baseline_path"] = staged_version_path(work_dir, "baseline", old_path, baseline_dir / old_path)
        entry["current_path"] = staged_version_path(work_dir, "current", old_path, current_path)
        entry["staged_path"] = staged_version_path(work_dir, "staged", new_path, staged_dir / new_path)
        if disposition == Disposition.RENAME_COLLISION:
            entry["collision_path"] = staged_version_path(work_dir, "collision", new_path, new_current_path)
        entries.append(entry)
        unresolved.append(entry)

    for rel in sorted(old_paths & new_paths):
        current = vault_dir / rel
        baseline = baseline_dir / rel
        staged = staged_dir / rel
        meta = old_fw[rel]
        # Order matters: a locally-deleted file with a missing baseline is still
        # DELETED_LOCAL, not EDITED (there is no current content to have edited).
        if not current.exists():
            disposition = Disposition.DELETED_LOCAL
        elif not baseline.exists():
            disposition = Disposition.EDITED
        else:
            current_hash = sha256_file(current)
            baseline_hash = meta.get("sha256") or sha256_file(baseline)
            staged_hash = new_fw[rel].get("sha256") or sha256_file(staged)
            if current_hash == baseline_hash:
                disposition = Disposition.UNCHANGED if current_hash == staged_hash else Disposition.REPLACE_UNTOUCHED
            else:
                disposition = Disposition.EDITED

        entry = {
            "disposition": disposition,
            "path": rel,
            "class": new_fw[rel].get("class", meta.get("class")),
            "kind": meta.get("kind"),
            "pack": meta.get("pack"),
            "applied": False,
        }
        if disposition in {Disposition.EDITED, Disposition.DELETED_LOCAL}:
            add_version_paths(
                entry,
                work_dir=work_dir,
                baseline_dir=baseline_dir,
                vault_dir=vault_dir,
                staged_dir=staged_dir,
                rel=rel,
            )
            unresolved.append(entry)
        entries.append(entry)

    for rel in sorted(brand_new_paths - renamed_new):
        meta = new_fw[rel]
        disposition = Disposition.COLLISION if (vault_dir / rel).exists() else Disposition.NEW
        entry = {
            "disposition": disposition,
            "path": rel,
            "class": meta.get("class"),
            "kind": meta.get("kind"),
            "pack": meta.get("pack"),
            "applied": False,
        }
        if disposition == Disposition.COLLISION:
            add_version_paths(
                entry,
                work_dir=work_dir,
                baseline_dir=baseline_dir,
                vault_dir=vault_dir,
                staged_dir=staged_dir,
                rel=rel,
            )
            unresolved.append(entry)
        entries.append(entry)

    for rel in sorted(removed_paths - renamed_old):
        current = vault_dir / rel
        meta = old_fw[rel]
        old_hash = meta.get("sha256")
        edited = bool(current.exists() and old_hash and sha256_file(current) != old_hash)
        disposition = Disposition.REMOVED_UPSTREAM_EDITED if edited else Disposition.REMOVED_UPSTREAM
        entry = {
            "disposition": disposition,
            "path": rel,
            "class": meta.get("class"),
            "kind": meta.get("kind"),
            "pack": meta.get("pack"),
            "applied": False,
        }
        if disposition == Disposition.REMOVED_UPSTREAM_EDITED:
            entry["baseline_path"] = staged_version_path(work_dir, "baseline", rel, baseline_dir / rel)
            entry["current_path"] = staged_version_path(work_dir, "current", rel, current)
            entry["staged_path"] = None
            unresolved.append(entry)
        entries.append(entry)

    for rel, meta in sorted(staged_meta.items()):
        if meta.get("class") != "seed":
            continue
        disposition = Disposition.SEED_PRESENT if (vault_dir / rel).exists() else Disposition.SEED_IF_ABSENT
        entries.append(
            {
                "disposition": disposition,
                "path": rel,
                "class": "seed",
                "kind": meta.get("kind"),
                "pack": meta.get("pack"),
                "applied": False,
            }
        )

    return entries, unresolved, staged_meta


def unresolved_plan_entries(plan: dict[str, Any]) -> list[dict[str, Any]]:
    return [
        entry
        for entry in plan.get("entries", [])
        if entry.get("disposition") in UNRESOLVED_DISPOSITIONS and not entry.get("resolved")
    ]


def plan_update_paths(plan: dict[str, Any]) -> set[str]:
    paths = {".memex/manifest.json", ".gitignore"}
    for entry in plan.get("entries", []):
        disposition = entry.get("disposition")
        path = entry.get("path")
        new_path = entry.get("new_path")
        if path and (
            entry.get("applied")
            or entry.get("resolved")
            or disposition in SAFE_PATH_DISPOSITIONS
        ):
            paths.add(path)
        if new_path and (entry.get("resolved") or disposition in {Disposition.RENAME_CANDIDATE, Disposition.RENAME_COLLISION}):
            paths.add(new_path)
        for key in ("archive_path", "aside_path"):
            extra = entry.get(key)
            if isinstance(extra, str) and extra:
                paths.add(extra)
        raw_extra = entry.get("extra_paths", [])
        if isinstance(raw_extra, str):
            raw_extra = [raw_extra]
        for extra in raw_extra:
            if isinstance(extra, str) and extra:
                paths.add(extra)
    return paths


def assert_only_plan_paths_dirty(vault_dir: pathlib.Path, plan: dict[str, Any]) -> None:
    allowed = plan_update_paths(plan)
    dirty = dirty_paths(vault_dir)
    # .memex/ is engine state and always update-owned; older vaults may have
    # tracked files there whose staged removal (untrack_memex_state) shows dirty.
    unexpected = sorted(
        path for path in dirty if path not in allowed and not path.startswith(".memex/")
    )
    if unexpected:
        preview = ", ".join(unexpected[:5])
        suffix = "" if len(unexpected) <= 5 else f", ... and {len(unexpected) - 5} more"
        raise RuntimeError(
            "refusing: non-update changes are present before finalize: "
            f"{preview}{suffix}. Commit or stash them separately."
        )


def apply_safe_operations(
    entries: list[dict[str, Any]],
    *,
    vault_dir: pathlib.Path,
    staged_dir: pathlib.Path,
    work_dir: pathlib.Path,
    prune_removed: bool,
) -> None:
    for entry in entries:
        rel = entry["path"]
        disposition = entry["disposition"]
        if disposition == Disposition.REPLACE_UNTOUCHED:
            # Archive the original first: non-git vaults have no other recovery.
            if (vault_dir / rel).exists():
                copy_file(vault_dir / rel, work_dir / "undo" / rel)
            copy_file(staged_dir / rel, vault_dir / rel)
            entry["applied"] = True
        elif disposition == Disposition.NEW:
            copy_file(staged_dir / rel, vault_dir / rel)
            entry["applied"] = True
        elif disposition == Disposition.SEED_IF_ABSENT:
            if not (vault_dir / rel).exists():
                copy_file(staged_dir / rel, vault_dir / rel)
                entry["applied"] = True
        elif disposition == Disposition.REMOVED_UPSTREAM and prune_removed:
            # Archive the original first: non-git vaults have no other recovery.
            if (vault_dir / rel).exists():
                copy_file(vault_dir / rel, work_dir / "undo" / rel)
            remove_file(vault_dir / rel)
            entry["applied"] = True
        elif disposition in AUTO_APPLIED_DISPOSITIONS:
            entry["applied"] = True
    ensure_gitignore_entries(vault_dir)


def summarize(entries: list[dict[str, Any]], unresolved: list[dict[str, Any]]) -> dict[str, Any]:
    counts = Counter(entry["disposition"] for entry in entries)
    applied = sum(1 for entry in entries if entry.get("applied"))
    return {
        "counts": dict(sorted(counts.items())),
        "applied": applied,
        "unresolved": len(unresolved),
    }


def write_plan(
    *,
    plan_path: pathlib.Path,
    manifest: dict[str, Any],
    answers: dict[str, Any],
    packs: list[str],
    engine_dir: pathlib.Path,
    vault_dir: pathlib.Path,
    work_dir: pathlib.Path,
    entries: list[dict[str, Any]],
    unresolved: list[dict[str, Any]],
    added_tokens: list[str],
    branch: str | None,
    previous_branch: str | None = None,
    dry_run: bool = False,
    status_override: str | None = None,
) -> dict[str, Any]:
    status = status_override or ("dry-run" if dry_run else ("pending" if unresolved else "complete"))
    payload = {
        "status": status,
        "dry_run": dry_run,
        "created_at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        "previous_branch": previous_branch,
        "engine_from": {
            "version": manifest.get("engine_version"),
            "commit": manifest.get("engine_commit"),
        },
        "engine_to": {
            "version": engine_version(engine_dir),
            "commit": engine_commit(engine_dir),
        },
        "packs": packs,
        "answers": answers,
        "added_tokens": added_tokens,
        "branch": branch,
        # Stored vault-relative so the plan survives a vault move (work_dir is
        # always under the vault).
        "work_dir": work_dir.relative_to(vault_dir).as_posix(),
        "entries": entries,
        "summary": summarize(entries, unresolved),
        "finalize_command": f"python3 {pathlib.Path(__file__).resolve().as_posix()} finalize --eng {engine_dir.as_posix()} --vault <vault> --plan {plan_path.as_posix()}",
    }
    write_json(plan_path, payload)
    return payload


def prepare_update(args: argparse.Namespace) -> int:
    engine_dir = pathlib.Path(args.eng).expanduser().resolve()
    vault_dir = pathlib.Path(args.vault).expanduser().resolve()
    manifest_path = vault_dir / ".memex/manifest.json"
    if not manifest_path.exists():
        print(f"error: {vault_dir} has no .memex/manifest.json; run init or the reconciliation prompt first")
        return 1

    manifest = read_json(manifest_path)
    try:
        for rel in manifest.get("files", {}):
            assert_safe_rel_path(rel, ".memex/manifest.json files")
        packs = manifest.get("packs", ["core"])
        placeholder_manifest = read_json(engine_dir / "placeholders.json")
        base_answers = dict(manifest.get("answers", {}))
        base_answers.update(parse_set_values(getattr(args, "set_values", [])))
        answers, added_tokens = fill_new_answers(
            placeholder_manifest,
            base_answers,
            interactive=not args.non_interactive,
            allow_blank_tokens=args.allow_blank_tokens,
        )
        answers["GIT_MODE"] = normalize_git_mode(answers.get("GIT_MODE"))

        # New non-port tokens the engine added but we have no value for would bake
        # blank into framework files. Refuse fast (before mutating anything) so the
        # caller can re-run with --set TOKEN=VALUE. Ports carry a safe example
        # default; --dry-run still previews; --allow-blank-tokens opts into blanks.
        missing_tokens = missing_required_tokens(placeholder_manifest, added_tokens)
        if missing_tokens and args.non_interactive and not args.allow_blank_tokens and not args.dry_run:
            print(
                "error: the newer engine added token(s) with no value: "
                + ", ".join(missing_tokens)
                + ". Re-run with --set TOKEN=VALUE for each (or --allow-blank-tokens "
                "to accept blanks). Nothing was changed."
            )
            return 2
        if added_tokens and args.non_interactive:
            print("note: new engine token(s) seen: " + ", ".join(added_tokens))

        prune_finished_work_dirs(vault_dir)
        pending = pending_update_plans(vault_dir)
        if pending:
            raise RuntimeError(
                "an update is already in progress; finalize or abort "
                f"{pending[0]} before preparing another update"
            )

        version = engine_version(engine_dir)
        git_branch: str | None = None
        previous_branch: str | None = None
        git_on = answers["GIT_MODE"] != "none" and is_git_repo(vault_dir)
        if git_on and not args.no_git_branch:
            current_branch = run_git(vault_dir, ["branch", "--show-current"], check=False).stdout.strip() or None
            if not args.dry_run:
                assert_clean_git(vault_dir)
            update_branch = f"engine-update-{version}"
            previous_branch = None if current_branch == update_branch else current_branch
        if git_on and not args.no_git_branch and not args.dry_run:
            git_branch = ensure_update_branch(vault_dir, version)
            untrack_memex_state(vault_dir)

        now = datetime.datetime.now().strftime("%Y%m%d-%H%M%S")
        work_dir = vault_dir / ".memex/update-work" / f"{version}-{now}"
        staged_dir = work_dir / "staged"
        source_map = bake_engine(
            engine_dir,
            staged_dir,
            answers,
            packs,
            include_scaffold=False,
            include_seeds=True,
        )

        baseline_dir = ensure_baseline(
            engine_dir=engine_dir,
            vault_dir=vault_dir,
            manifest=manifest,
            work_dir=work_dir,
        )
        layout = load_engine_layout(engine_dir)
        entries, unresolved, _staged_meta = classify_update(
            manifest=manifest,
            layout=layout,
            baseline_dir=baseline_dir,
            vault_dir=vault_dir,
            staged_dir=staged_dir,
            source_map=source_map,
            work_dir=work_dir,
        )

        prune_removed = args.non_interactive or args.yes_prune
        if not prune_removed:
            removed_count = sum(1 for entry in entries if entry["disposition"] == Disposition.REMOVED_UPSTREAM)
            if removed_count:
                value = prompt_input(f"Prune {removed_count} untouched files removed upstream? [y/N]: ").strip().lower()
                prune_removed = value in {"y", "yes"}

        plan_path = work_dir / "plan.json"
        if not args.dry_run:
            # Write a provisional plan before touching the vault: a crash
            # mid-apply must leave a plan on disk (it carries the undo/work
            # paths and keeps the pending-update guard armed).
            write_plan(
                plan_path=plan_path,
                manifest=manifest,
                answers=answers,
                packs=packs,
                engine_dir=engine_dir,
                vault_dir=vault_dir,
                work_dir=work_dir,
                entries=entries,
                unresolved=unresolved,
                added_tokens=added_tokens,
                branch=git_branch,
                previous_branch=previous_branch,
                dry_run=False,
                status_override="applying",
            )
            apply_safe_operations(
                entries,
                vault_dir=vault_dir,
                staged_dir=staged_dir,
                work_dir=work_dir,
                prune_removed=prune_removed,
            )

        plan = write_plan(
            plan_path=plan_path,
            manifest=manifest,
            answers=answers,
            packs=packs,
            engine_dir=engine_dir,
            vault_dir=vault_dir,
            work_dir=work_dir,
            entries=entries,
            unresolved=unresolved,
            added_tokens=added_tokens,
            branch=git_branch,
            previous_branch=previous_branch,
            dry_run=args.dry_run,
        )

        if not unresolved and not args.dry_run:
            write_manifest_and_baseline(
                engine_dir=engine_dir,
                vault_dir=vault_dir,
                staged_dir=staged_dir,
                source_map=source_map,
                answers=answers,
                packs=packs,
            )
            if git_on and not args.no_git_branch:
                try:
                    commit_update(vault_dir, version, plan_update_paths(plan))
                except subprocess.CalledProcessError as exc:
                    error = exc.stderr.strip() or str(exc)
                    plan["status"] = "commit-failed"
                    plan["commit_error"] = error
                    write_json(plan_path, plan)
                    print(error)
                    return 1
            plan["status"] = "complete"
            write_json(plan_path, plan)
            strip_work_heavy(work_dir)
        elif args.dry_run:
            strip_work_heavy(work_dir)

        summary = plan["summary"]
        print(
            "update: "
            f"{manifest.get('engine_version', 'unknown')} -> {version}; "
            f"applied {summary['applied']} safe dispositions; "
            f"{summary['unresolved']} unresolved; plan {plan_path}"
        )
        return 0
    except RuntimeError as exc:
        print(f"error: {exc}")
        return 1
    except subprocess.CalledProcessError as exc:
        print(f"error: {subprocess_error(exc)}")
        return 1


def finalize_update(args: argparse.Namespace) -> int:
    engine_dir = pathlib.Path(args.eng).expanduser().resolve()
    vault_dir = pathlib.Path(args.vault).expanduser().resolve()
    plan_path = pathlib.Path(args.plan).expanduser().resolve()
    if not plan_path.exists():
        print(f"error: plan not found: {plan_path}")
        return 1
    plan = read_json(plan_path)
    try:
        validate_plan_paths(plan)
    except RuntimeError as exc:
        print(f"error: {exc}")
        return 1
    if plan.get("dry_run") or plan.get("status") == "dry-run":
        print("error: cannot finalize a dry-run plan; rerun prepare without --dry-run")
        return 1
    # The plan's entries were reviewed against a specific engine tree; a moved
    # or since-pulled engine checkout would rewrite manifest/baseline for
    # content the user never saw.
    plan_to = plan.get("engine_to") or {}
    current_commit = engine_commit(engine_dir)
    if plan_to.get("commit") and current_commit and plan_to["commit"] != current_commit:
        print(f"error: engine checkout {current_commit} does not match the plan's engine_to "
              f"{plan_to['commit']}; check out that commit (or re-run prepare)")
        return 1
    answers = plan.get("answers", {})
    packs = plan.get("packs", ["core"])
    version = engine_version(engine_dir)
    unresolved = unresolved_plan_entries(plan)
    if unresolved:
        print(
            "error: plan still has unresolved entries: "
            + ", ".join(entry.get("path", "<unknown>") for entry in unresolved[:5])
        )
        return 1

    git_on = normalize_git_mode(answers.get("GIT_MODE")) != "none" and is_git_repo(vault_dir)
    if git_on and not args.no_git_commit:
        try:
            assert_only_plan_paths_dirty(vault_dir, plan)
        except RuntimeError as exc:
            print(f"error: {exc}")
            return 1

    with tempfile.TemporaryDirectory(prefix="memex-finalize-") as tmp:
        staged_dir = pathlib.Path(tmp) / "staged"
        source_map = bake_engine(
            engine_dir,
            staged_dir,
            answers,
            packs,
            include_scaffold=False,
            include_seeds=True,
        )
        write_manifest_and_baseline(
            engine_dir=engine_dir,
            vault_dir=vault_dir,
            staged_dir=staged_dir,
            source_map=source_map,
            answers=answers,
            packs=packs,
        )

    committed = False
    if git_on and not args.no_git_commit:
        try:
            committed = commit_update(vault_dir, version, plan_update_paths(plan))
        except subprocess.CalledProcessError as exc:
            print(exc.stderr.strip() or str(exc))
            return 1

    plan["status"] = "complete"
    plan["finalized_at"] = datetime.datetime.now(datetime.timezone.utc).isoformat()
    plan["committed"] = committed
    write_json(plan_path, plan)
    work_dir = plan.get("work_dir")
    if work_dir:
        wd = pathlib.Path(work_dir)
        wd = vault_dir / wd if not wd.is_absolute() else wd  # old plans stored absolute
        # work_dir lives under the vault by construction; never clean elsewhere
        # (the plan file is agent-writable).
        if wd.resolve().is_relative_to(vault_dir):
            strip_work_heavy(wd)
    print(f"finalize: manifest and baseline refreshed for engine {version}")
    return 0


def abort_update(args: argparse.Namespace) -> int:
    """Abandon an in-progress update: revert the safe ops applied to the worktree,
    drop the engine-update branch if it has no commits, and return to the branch
    the update started from. Scoped to the plan's paths so unrelated work is safe."""
    vault_dir = pathlib.Path(args.vault).expanduser().resolve()
    plan_path = pathlib.Path(args.plan).expanduser().resolve()
    if not plan_path.exists():
        print(f"error: plan not found: {plan_path}")
        return 1
    plan = read_json(plan_path)
    try:
        validate_plan_paths(plan)
    except RuntimeError as exc:
        print(f"error: {exc}")
        return 1
    if not is_git_repo(vault_dir):
        print("abort: not a git repo; remove update changes manually if needed.")
        return 1
    paths = plan_update_paths(plan)
    branch = plan.get("branch")
    previous = plan.get("previous_branch")

    # Revert tracked files the update modified/deleted back to their committed state.
    tracked = [
        line
        for line in run_git(vault_dir, ["ls-files", "--", *sorted(paths)], check=False).stdout.splitlines()
        if line
    ]
    if tracked:
        run_git(vault_dir, ["restore", "--source=HEAD", "--staged", "--worktree", "--", *tracked], check=False)

    # Remove untracked files the update added (new framework files, freshly
    # seeded files). Not gated on applied=True: a crash mid-apply leaves the
    # provisional plan with applied=False; the ls-files + is_file checks below
    # keep this safe for files the update never actually created.
    for entry in plan.get("entries", []):
        if entry.get("disposition") in ABORT_UNTRACKED_DISPOSITIONS:
            rel = entry.get("path")
            if not rel:
                continue
            in_index = run_git(vault_dir, ["ls-files", "--error-unmatch", "--", rel], check=False)
            target = vault_dir / rel
            if in_index.returncode != 0 and target.is_file():
                target.unlink()

    current = run_git(vault_dir, ["branch", "--show-current"], check=False).stdout.strip()
    returned_to = current or previous or "<unknown>"
    if branch and current == branch:
        if previous and previous != branch:
            switched = run_git(vault_dir, ["switch", previous], check=False)
            if switched.returncode == 0:
                unique = run_git(vault_dir, ["rev-list", f"{previous}..{branch}"], check=False).stdout.strip()
                if not unique:
                    run_git(vault_dir, ["branch", "-D", branch], check=False)
            else:
                returned_to = current
        else:
            returned_to = current

    work_dir = plan.get("work_dir")
    if work_dir:
        wd = pathlib.Path(work_dir)
        wd = vault_dir / wd if not wd.is_absolute() else wd  # old plans stored absolute
        # work_dir lives under the vault by construction; never delete elsewhere
        # (the plan file is agent-writable).
        if wd.resolve().is_relative_to(vault_dir):
            shutil.rmtree(wd, ignore_errors=True)
    if branch and returned_to == branch:
        print(f"abort: reverted update changes; stayed on {branch} (no previous branch recorded)")
    else:
        print(f"abort: reverted update changes; returned to {returned_to}")
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser()
    subparsers = parser.add_subparsers(dest="command")

    prepare = subparsers.add_parser("prepare")
    prepare.add_argument("--eng", required=True)
    prepare.add_argument("--vault", default=".")
    prepare.add_argument("--non-interactive", action="store_true")
    prepare.add_argument("--yes-prune", action="store_true")
    prepare.add_argument("--dry-run", action="store_true")
    prepare.add_argument("--no-git-branch", action="store_true")
    prepare.add_argument(
        "--set",
        action="append",
        default=[],
        dest="set_values",
        metavar="TOKEN=VALUE",
        help="supply a value for a token the newer engine added (repeatable)",
    )
    prepare.add_argument(
        "--allow-blank-tokens",
        action="store_true",
        help="accept blank values for newly added tokens instead of refusing",
    )

    finalize = subparsers.add_parser("finalize")
    finalize.add_argument("--eng", required=True)
    finalize.add_argument("--vault", default=".")
    finalize.add_argument("--plan", required=True)
    finalize.add_argument("--no-git-commit", action="store_true")

    abort = subparsers.add_parser("abort")
    abort.add_argument("--eng")
    abort.add_argument("--vault", default=".")
    abort.add_argument("--plan", required=True)
    return parser


def main() -> int:
    parser = build_parser()
    argv = sys.argv[1:]
    if argv and argv[0] not in {"prepare", "finalize", "abort", "-h", "--help"}:
        argv = ["prepare", *argv]
    args = parser.parse_args(argv)
    if args.command == "prepare":
        return prepare_update(args)
    if args.command == "finalize":
        return finalize_update(args)
    if args.command == "abort":
        return abort_update(args)
    parser.print_help()
    return 1


if __name__ == "__main__":
    sys.exit(main())
