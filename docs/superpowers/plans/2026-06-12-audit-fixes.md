# Audit Fixes, Optimizations & Features Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix all findings from the 2026-06-12 four-agent audit (broken paths, bugs, hardening, optimizations) and implement approved features: audit_refs gate, LOCATION_MAP-driven derive, answer validation/derivation, memex-doctor, permissions.deny, deterministic auto-merge tier.

**Architecture:** The engine has three layers — maintainer tools (`tools/*.py`), vault-installed infra (`hardened/`), and content packs (`packs/`). Fixes follow that layering. `packs/` and `hardened/{hooks,launchd,quartz,settings.json,gitignore}` are **derive-managed** (regenerated from the source vault by `tools/derive.py`); changes there must be recorded in `docs/BACKPORT.md` (Task 17) so the maintainer can port them to the source vault. `hardened/contract/` and (new) `hardened/scripts/` are hand-curated and survive re-derives.

**Tech Stack:** Python 3 stdlib only, bash/zsh, Quartz (TypeScript — config-level edits only).

**Verification commands (used throughout):**
```bash
(cd tools && python3 -m unittest)        # unit tests
tests/test_init.sh                       # init integration
tests/test_update.sh                     # update integration
python3 tools/audit_literals.py ./packs && python3 tools/audit_literals.py ./hardened
```

---

### Task 1: Fix the vacuous test gates (MUST BE FIRST — validates everything after)

**Files:**
- Modify: `tests/test_init.sh:4,11`
- Modify: `tests/test_update.sh:4`

The `no_unbaked` gate in `tests/test_init.sh` is vacuous: the script is zsh, which does not word-split unquoted `$TOKENS`, so the loop runs once over the whole concatenated string. Both test scripts also expand `$TMP` at trap-set time.

- [ ] **Step 1: Fix word splitting + trap quoting in test_init.sh**

Line 4: `TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT`
Line 11: `for t in ${=TOKENS}; do`

- [ ] **Step 2: Add a gate self-test right after the `no_unbaked` definition (after line 14)**

```zsh
# Self-test: the gate must actually fire — guards against the zsh word-splitting
# regression that silently made this gate vacuous.
SELFTEST="$TMP/selftest"; mkdir -p "$SELFTEST"; echo '{{OWNER_NAME}}' > "$SELFTEST/x.md"
if (no_unbaked "$SELFTEST") >/dev/null 2>&1; then
  fail "no_unbaked gate is vacuous (did not flag a planted token)"
fi
rm -rf "$SELFTEST"
```

- [ ] **Step 3: Fix trap quoting in test_update.sh line 4** (same `trap 'rm -rf "$TMP"' EXIT`)

- [ ] **Step 4: Run `tests/test_init.sh` and `tests/test_update.sh`** — both must PASS. If `no_unbaked` now flags real leaks in baked vaults, list them; do NOT silence them (later tasks fix bake bugs; if a leak appears here, note it and continue — Task 17 re-verifies).

- [ ] **Step 5: Commit** `fix(tests): make no_unbaked gate actually iterate tokens under zsh; quote traps`

---

### Task 2: audit_literals.py coverage gaps

**Files:**
- Modify: `tools/audit_literals.py:25,48-52`
- Modify: `audit_allowlist.json`

- [ ] **Step 1: Extend coverage and prune dirs during the walk.** Replace `TEXT_EXT` (line 25) and the walk (lines 47-51):

```python
TEXT_EXT = {".md", ".ts", ".tsx", ".sh", ".json", ".plist", ".py", ".scss", ".tex", ".sty", ".yaml", ".yml"}
TEXT_NAMES = {"gitignore"}  # extensionless text files derive tokenizes
```

```python
    import os
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
                ...  # body unchanged
```

(Move `import os` to the top-level import line.)

- [ ] **Step 2: Run `python3 tools/audit_literals.py ./packs`.** Expect new hits from `packs/pi/cv/res.sty` (the vendored resume.sty author's contact strings, e.g. `mrd@sun.soe.clarkson.edu`). These are third-party template credits, not instance facts — add each exact reported literal to the `"allow"` array in `audit_allowlist.json`. Re-run until `AUDIT CLEAN` on both `./packs` and `./hardened`. Any hit that IS a real instance fact must be reported, not allowlisted.

- [ ] **Step 3: Commit** `fix(audit): scan .tex/.sty/.yaml/.yml and extensionless gitignore; prune skip-dirs during walk`

---

### Task 3: derive.py — section-driven, scripts support, fail-loud, pruned walks

**Files:**
- Modify: `tools/derive.py`

Fixes the critical data-loss bug (re-derive deletes `packs/pi/scripts/`) and feature 2 (sections driven from one map, unknown keys fail loudly).

- [ ] **Step 1: Replace the per-section plumbing.** Add after `TEXT_EXTS` (and add `os` to imports):

```python
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
```

Rewrite `copy_tree` to prune during the walk:

```python
def copy_tree(src, dst, pairs):
    for dirpath, dirnames, filenames in os.walk(src):
        dirnames[:] = [d for d in dirnames if d not in PRUNE_DIRS]
        for name in filenames:
            fp = pathlib.Path(dirpath) / name
            copy_file(fp, dst / fp.relative_to(src), pairs)
```

Rewrite `planned_sources` pack-section loop:

```python
def planned_sources(packs, SRC):
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
    ...  # hardened block unchanged
```

Rewrite the pack copy loop in `main()` the same way:

```python
    for pack in [k for k in packs if k != "hardened"]:
        cfg = packs[pack]
        for section, value in cfg.items():
            if section == "cv":
                if value:
                    copy_tree(SRC / "CV", ENG / f"packs/{pack}/cv", pairs)
                continue
            kind, resolve = SECTION_SOURCES[section]
            for name in value:
                src = resolve(SRC, name)
                dst = ENG / f"packs/{pack}/{section}" / (name if kind == "tree" else src.name)
                (copy_tree if kind == "tree" else copy_file)(src, dst, pairs)
```

Note `schemas/templates/workflows/prompts` resolve to `<n>.md`, so `src.name` keeps the existing destination filenames. The quartz copy block (lines 131-135) switches to `copy_tree(SRC/"quartz", ENG/"hardened/quartz", pairs)`.

- [ ] **Step 2: Fail loudly on non-UTF-8 text sources.** In `copy_file`, replace `src.read_text(errors="ignore")` with:

```python
        try:
            text = src.read_text(encoding="utf-8")
        except UnicodeDecodeError:
            sys.exit(f"derive: {src} is not valid UTF-8; fix the source file or add its extension to binary handling")
        dst.write_text(bake_out(text, pairs))
```

- [ ] **Step 3: Verify.** No source vault is available here, so verify statically: `python3 -c "import ast; ast.parse(open('tools/derive.py').read())"` and a smoke test that unknown sections die:

```bash
python3 - <<'PY'
import json, pathlib, subprocess, sys, tempfile
eng = pathlib.Path(".").resolve()
with tempfile.TemporaryDirectory() as src:
    packs = json.loads((eng / "packs.json").read_text())
    packs["core"]["bogus_section"] = ["x"]
    with tempfile.TemporaryDirectory() as tmp_eng:
        te = pathlib.Path(tmp_eng)
        (te / "packs.json").write_text(json.dumps(packs))
        (te / "placeholders.json").write_text((eng / "placeholders.json").read_text())
        proc = subprocess.run([sys.executable, str(eng / "tools/derive.py"), "--src", src, "--eng", tmp_eng],
                              capture_output=True, text=True)
        assert proc.returncode != 0 and "bogus_section" in (proc.stdout + proc.stderr), (proc.stdout, proc.stderr)
        assert (te / "packs.json").exists()  # nothing wiped
print("derive unknown-section guard OK")
PY
```

- [ ] **Step 4: Commit** `fix(derive): drive sections from one map incl. scripts; fail loudly on unknown sections and non-UTF-8; prune walks`

---

### Task 4: memex_bake.py — seed safety, gitignore privacy, plist naming, scaffold, pi registries, shared fixes

**Files:**
- Modify: `tools/memex_bake.py`
- Modify: `engine_layout.json`
- Modify: `hardened/gitignore` (derive-managed — record in BACKPORT)
- Test: `tools/test_memex_init.py`

- [ ] **Step 1: Write failing unit tests** (append to `tools/test_memex_init.py`, adapting to its existing style — read it first):

```python
class TestSeedSafety(unittest.TestCase):
    def test_seeds_skip_existing_files(self):
        import tempfile, pathlib
        from memex_bake import _write_seed_files, BakeResult
        with tempfile.TemporaryDirectory() as tmp:
            target = pathlib.Path(tmp)
            (target / "log.md").write_text("# log\nPRECIOUS HISTORY\n")
            _write_seed_files(target, {"OWNER_NAME": "X"}, ["email"], "local", "2026-06-12", BakeResult())
            self.assertIn("PRECIOUS HISTORY", (target / "log.md").read_text())
            self.assertTrue((target / "index.md").exists())  # absent seeds still written

class TestStripSectionsNested(unittest.TestCase):
    def test_cross_token_nesting_resolves(self):
        from memex_bake import strip_sections
        text = "{{?A}}a {{?B}}b{{/B}} c{{/A}}"
        self.assertEqual(strip_sections(text, {"A": "x", "B": ""}), "a  c")
        self.assertEqual(strip_sections(text, {"A": "x", "B": "y"}), "a b c")

class TestAnswersDefaults(unittest.TestCase):
    def test_blank_port_gets_example(self):
        from memex_bake import answers_with_defaults
        manifest = {"placeholders": [{"token": "QUARTZ_PORT", "example": "8181"}]}
        out = answers_with_defaults(manifest, {"QUARTZ_PORT": ""})
        self.assertEqual(out["QUARTZ_PORT"], "8181")
```

Run `(cd tools && python3 -m unittest)` — new tests FAIL.

- [ ] **Step 2: Implement in `memex_bake.py`:**

(a) `_write_seed_files` (line ~400): skip existing files but still record them:

```python
    for rel, text in seeds.items():
        path = target / rel
        if not path.exists():           # seeds are write-once: never clobber log.md
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(text)
        result.record(rel, None, None)
```

(b) `strip_sections`: iterate to a fixed point so a kept outer section's inner sections still resolve:

```python
    prev = None
    while prev != text:
        prev = text
        text = SECTION_RE.sub(repl, text)
    return text
```

(c) `answers_with_defaults`: also fill *blank* port answers:

```python
    for ph in manifest["placeholders"]:
        token = ph["token"]
        if token not in out:
            out[token] = ph.get("example", "") if token in PORT_TOKENS else ""
        elif token in PORT_TOKENS and not str(out[token]).strip():
            out[token] = ph.get("example", "")
```

(d) Privacy: `GITIGNORE_LOCAL_ENTRIES = [".memex/"]` (replaces the two subpaths — the manifest embeds the full answers dict: name, emails, absolute paths, Drive IDs; none of it should be committable/pushable). Keep the helper otherwise unchanged.

(e) `SCAFFOLD_DIRS`: add `"Ops/Calendars"` (skills call it a source of truth; nothing created it).

(f) Plist install name carries the vault name so multiple vaults' LaunchAgents don't collide (bake_engine launchd block, line ~480):

```python
            if fp.suffix == ".plist":
                vault_name = str(answers.get("VAULT_NAME", "")).strip()
                plist_name = f"com.memex.quartz.{vault_name}.plist" if vault_name else "com.memex.quartz.plist"
                dst = target / "scripts/launchd" / plist_name
```

(g) pi registry seeds — append inside `bake_engine` after the `_write_seed_files` call:

```python
    if include_seeds and "pi" in packs:
        registries = {
            "Atlas/Letters/index.md": (
                "---\ntype: config\nscope: letters-registry\n---\n\n# Letters\n\n"
                "Registry/landing page for Letter notes. The canonical letters live in Google Drive\n"
                f"(`recommendation_letters`, folder ID `{answers.get('LETTERS_DRIVE_ID', '')}`); the letterhead\n"
                f"template is Drive ID `{answers.get('LETTERHEAD_TEMPLATE_ID', '')}`.\n\n"
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
```

(h) Bake-normalization optimization — compute the normalized dict once per tree:

```python
def normalize_answers(answers: dict[str, Any]) -> dict[str, str]:
    return {k: str(v) for k, v in answers.items() if not isinstance(v, (list, dict))}

def bake(text: str, answers: dict[str, Any], normalized: dict[str, str] | None = None) -> str:
    normalized = normalized if normalized is not None else normalize_answers(answers)
    text = strip_sections(text, normalized)
    return TOKEN_RE.sub(lambda m: normalized.get(m.group(1), m.group(0)), text)
```

Thread `normalized` through `bake_file(src, dst, answers, normalized=None)` and compute once at the top of `bake_engine` (`normalized = normalize_answers(answers)`), passing it to every `bake_file`/`bake` call inside.

(i) Pack-name validation helper (used by init in Task 5):

```python
def validate_packs(engine_dir: pathlib.Path, packs: list[str]) -> None:
    known = set(read_json(engine_dir / "packs.json")) - {"hardened"}
    unknown = [p for p in packs if p not in known]
    if unknown:
        raise ValueError(
            f"unknown pack(s): {', '.join(unknown)} (known: {', '.join(sorted(known))})"
        )
```

(j) Move `placeholder_allows_blank` from `tools/memex_update.py:383-387` into `memex_bake.py` verbatim; update `memex_update.py` to import it (shared by Task 5's interview).

- [ ] **Step 3: `engine_layout.json`:** add to `"seed"`: `"Atlas/Letters/index.md"`, `"Atlas/Grants/index.md"` (seed patterns are matched before `data`, so updates re-seed them if absent).

- [ ] **Step 4: `hardened/gitignore`:** append:

```
# Claude Code machine-local permission grants — never commit
.claude/settings.local.json

# Memex local state: manifest (contains your answers: name, emails, paths,
# Drive IDs), baseline cache, and update staging. Machine-local by design.
.memex/
```

- [ ] **Step 5: Update existing test expectations.** In `tests/test_init.sh`: lines 64-65 become `grep -q "^\.memex/$" "$TMP/core/.gitignore" || fail ".memex/ should be gitignored"`; line 69 plist path becomes `scripts/launchd/com.memex.quartz.example-vault.plist`; add `[ -f "$TMP/core/Ops/Calendars" ] ...` — actually assert dir: `[ -d "$TMP/core/Ops/Calendars" ] || fail "Ops/Calendars scaffold missing"`; add pi-registry assertions in the pi section:

```zsh
[ -f "$TMP/pi/Atlas/Letters/index.md" ] || fail "pi Letters registry not seeded"
[ -f "$TMP/pi/Atlas/Grants/index.md" ] || fail "pi Grants registry not seeded"
[ ! -e "$TMP/core/Atlas/Letters/index.md" ] || fail "Letters registry leaked into core init"
```

- [ ] **Step 6: Run unit tests + both integration suites.** All PASS.
- [ ] **Step 7: Commit** `fix(bake): write-once seeds, gitignore .memex/ + settings.local.json, per-vault plist name, pi registries, nested sections, scaffold Ops/Calendars`

---

### Task 5: memex_init.py — answer validation & derivation (feature 4), robust loading

**Files:**
- Modify: `tools/memex_init.py`
- Modify: `placeholders.json` (remove FRAMING)
- Modify: `tests/fixtures/answers.core.json`, `answers.pi.json`, `answers.nogit.json`, `tests/test_update.sh:242` (remove FRAMING)
- Test: `tools/test_memex_init.py`

- [ ] **Step 1: Write failing tests** (append to `tools/test_memex_init.py`):

```python
class TestAnswerDerivation(unittest.TestCase):
    def test_vault_path_and_slug_derived_from_target(self):
        import pathlib
        from memex_init import derive_path_answers
        answers = {"VAULT_PATH": "/somewhere/else", "VAULT_NAME": "", "CC_PROJECT_SLUG": ""}
        notes = derive_path_answers(answers, pathlib.Path("/tmp/my.vault"))
        self.assertEqual(answers["VAULT_PATH"], "/tmp/my.vault")
        self.assertEqual(answers["VAULT_NAME"], "my.vault")
        self.assertEqual(answers["CC_PROJECT_SLUG"], "-tmp-my-vault")
        self.assertTrue(any("VAULT_PATH" in n for n in notes))

class TestAnswerValidation(unittest.TestCase):
    def test_blank_required_and_bad_port_reported(self):
        from memex_init import validate_answers
        problems = validate_answers({"OWNER_NAME": "", "OWNER_PRIMARY_EMAIL": "a@b.co",
                                     "TIMEZONE": "UTC", "QUARTZ_PORT": "eight"})
        self.assertTrue(any("OWNER_NAME" in p for p in problems))
        self.assertTrue(any("QUARTZ_PORT" in p for p in problems))
        self.assertFalse(any("OWNER_PRIMARY_EMAIL" in p for p in problems))
```

- [ ] **Step 2: Implement in `memex_init.py`:**

```python
REQUIRED_TOKENS = {"OWNER_NAME", "OWNER_PRIMARY_EMAIL", "TIMEZONE"}


def derive_path_answers(answers: dict, target: pathlib.Path) -> list[str]:
    """Derive VAULT_PATH / VAULT_NAME / CC_PROJECT_SLUG / USER_HOME from --target.
    VAULT_PATH and CC_PROJECT_SLUG MUST agree with where the vault actually lives,
    or the baked launchd plist and skills point at a nonexistent tree."""
    resolved = target.expanduser().resolve()
    notes = []
    supplied = str(answers.get("VAULT_PATH", "")).strip()
    if supplied and pathlib.Path(supplied).expanduser() != resolved:
        notes.append(f"note: VAULT_PATH answer ({supplied}) != --target; using {resolved}")
    answers["VAULT_PATH"] = str(resolved)
    if not str(answers.get("VAULT_NAME", "")).strip():
        answers["VAULT_NAME"] = resolved.name
    slug = str(resolved).replace("/", "-").replace(".", "-")
    supplied_slug = str(answers.get("CC_PROJECT_SLUG", "")).strip()
    if supplied_slug and supplied_slug != slug:
        notes.append(f"note: CC_PROJECT_SLUG answer ({supplied_slug}) != derived; using {slug}")
    answers["CC_PROJECT_SLUG"] = slug
    if not str(answers.get("USER_HOME", "")).strip():
        answers["USER_HOME"] = str(pathlib.Path.home())
    return notes


def validate_answers(answers: dict) -> list[str]:
    problems = []
    for token in sorted(REQUIRED_TOKENS):
        if not str(answers.get(token, "")).strip():
            problems.append(f"{token} must not be blank")
    for token in sorted(PORT_TOKENS):
        value = str(answers.get(token, "")).strip()
        if value and not value.isdigit():
            problems.append(f"{token} must be numeric (got {value!r})")
    return problems
```

(import `PORT_TOKENS` is already there; add `placeholder_allows_blank` to the memex_bake import list.)

Rework `interview()` so displayed defaults are honored:

```python
def interview(manifest: dict, packs: list[str], target: pathlib.Path) -> dict:
    answers = {}
    pi_enabled = "pi" in packs
    resolved = target.expanduser().resolve()
    derived = {
        "VAULT_PATH": str(resolved),
        "VAULT_NAME": resolved.name,
        "CC_PROJECT_SLUG": str(resolved).replace("/", "-").replace(".", "-"),
        "USER_HOME": str(pathlib.Path.home()),
    }
    for placeholder in manifest["placeholders"]:
        token = placeholder["token"]
        if "[pi pack]" in placeholder["prompt"] and not pi_enabled:
            answers[token] = ""
            continue
        optional = placeholder_allows_blank(placeholder)
        if token in PORT_TOKENS:
            default = placeholder.get("example", "")
        elif token in derived:
            default = derived[token]
        else:
            default = ""
        while True:
            shown = default if default else ("blank" if optional else "required")
            value = input(f"{placeholder['prompt']} [{shown}]: ").strip()
            if value:
                answers[token] = value
                break
            if default:
                answers[token] = default
                break
            if optional or token not in REQUIRED_TOKENS:
                answers[token] = ""
                break
            print(f"  {token} is required.")
    answers["STREAMS"] = ask_streams()
    answers["GIT_MODE"] = ask_git_mode()
    return answers
```

Rework `main()`'s middle section (replace lines 129-144):

```python
    engine_dir = pathlib.Path(args.eng).expanduser().resolve()
    target = pathlib.Path(args.target).expanduser()
    packs = [pack.strip() for pack in args.packs.split(",") if pack.strip()]
    try:
        validate_packs(engine_dir, packs)
    except ValueError as exc:
        print(f"error: {exc}")
        return 1
    placeholder_manifest = read_json(engine_dir / "placeholders.json")

    if target.exists() and not target.is_dir():
        print(f"refusing: {target} exists and is not a directory")
        return 1
    if target.exists() and any(target.iterdir()) and not args.force:
        print(f"refusing: {target} is not empty (use --force to overlay)")
        return 1

    if args.interview:
        answers = interview(placeholder_manifest, packs, target)
    else:
        answers_path = pathlib.Path(args.answers).expanduser()
        try:
            answers = json.loads(answers_path.read_text())
        except FileNotFoundError:
            print(f"error: answers file not found: {answers_path}")
            return 1
        except (json.JSONDecodeError, UnicodeDecodeError) as exc:
            print(f"error: cannot parse {answers_path}: {exc}")
            return 1
        if not isinstance(answers, dict):
            print(f"error: {answers_path} must contain a JSON object of TOKEN: value")
            return 1

    for note in derive_path_answers(answers, target):
        print(note)
    problems = validate_answers(answers)
    if problems:
        for problem in problems:
            print(f"error: {problem}")
        print("Nothing was created.")
        return 1

    target.mkdir(parents=True, exist_ok=True)
    streams = parse_streams(answers.get("STREAMS"))
    git_mode = normalize_git_mode(answers.get("GIT_MODE"))
    answers = answers_with_defaults(placeholder_manifest, answers)
    answers["STREAMS"] = streams
    answers["GIT_MODE"] = git_mode
```

(`validate_packs` imported from memex_bake. Note `target.mkdir` now happens AFTER answers load+validation, fixing the side-effects-before-failure bug.)

Git init failure becomes loud (replace lines 165-170):

```python
    if git_mode != "none":
        try:
            if not (target / ".git").exists():
                proc = subprocess.run(["git", "init", "-q"], cwd=str(target), check=False,
                                      capture_output=True, text=True)
                if proc.returncode != 0:
                    print(f"warning: git init failed: {proc.stderr.strip()} — run `git init` in the vault manually")
        except FileNotFoundError:
            print("warning: git not found — vault has no repo despite git mode " + git_mode)
```

Add to `print_post_init` (both git branches print it; put before the `if git_mode` chain):

```python
    print("\nLocal-only state: .memex/ (manifest incl. your answers, baseline cache) is")
    print("gitignored and never leaves this machine.")
```

- [ ] **Step 3: Remove FRAMING** (interviewed but baked into zero files): delete its entry from `placeholders.json`, and the `"FRAMING"` lines from `tests/fixtures/answers.core.json`, `answers.pi.json`, `answers.nogit.json`, and the heredoc plan in `tests/test_update.sh` (~line 242). Verify: `grep -rn FRAMING packs/ hardened/ tools/ tests/` returns nothing.

- [ ] **Step 4: Run unit + integration tests.** test_init.sh fixtures now get `VAULT_PATH` overridden to the real target — confirm the baked plist points at `$TMP/core` (add assertion):

```zsh
grep -q "$TMP/core/scripts/serve_quartz.sh" "$TMP/core/scripts/launchd/com.memex.quartz.example-vault.plist" \
  || fail "plist VAULT_PATH not derived from --target"
```

- [ ] **Step 5: Commit** `feat(init): derive VAULT_PATH/VAULT_NAME/CC_PROJECT_SLUG from --target, validate answers, honor interview defaults, robust answers loading; drop unused FRAMING`

---

### Task 6: memex_update.py hardening batch

**Files:**
- Modify: `tools/memex_update.py`
- Test: `tools/test_memex_update.py`

- [ ] **Step 1: Write failing unit tests** (append to `tools/test_memex_update.py`, matching its style):

```python
class TestSafeRelPath(unittest.TestCase):
    def test_rejects_absolute_and_parent_and_drive(self):
        from memex_update import assert_safe_rel_path
        for bad in ("/etc/passwd", "../escape.md", "a/../../b", "~root/x", "C:/x"):
            with self.assertRaises(RuntimeError):
                assert_safe_rel_path(bad, "test")
        assert_safe_rel_path("Atlas/People/X.md", "test")  # no raise

class TestParseSetValues(unittest.TestCase):
    def test_malformed_item_raises(self):
        from memex_update import parse_set_values
        with self.assertRaises(RuntimeError):
            parse_set_values(["OWNER_TIMEZONE"])
        self.assertEqual(parse_set_values(["A=b=c"]), {"A": "b=c"})
```

- [ ] **Step 2: Implement, in `tools/memex_update.py`:**

(a) Path safety:

```python
import re

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
```

Call sites: in `prepare_update` right after `manifest = read_json(manifest_path)`:

```python
    for rel in manifest.get("files", {}):
        assert_safe_rel_path(rel, ".memex/manifest.json files")
```

(wrap in the existing try/except RuntimeError by moving it inside the `try:` — see (f) below). In `finalize_update` and `abort_update`, right after `plan = read_json(plan_path)`:

```python
    try:
        validate_plan_paths(plan)
    except RuntimeError as exc:
        print(f"error: {exc}")
        return 1
```

(b) `parse_set_values` raises on malformed items:

```python
def parse_set_values(items: list[str] | None) -> dict[str, str]:
    out: dict[str, str] = {}
    for item in items or []:
        if "=" not in item:
            raise RuntimeError(f"--set expects TOKEN=VALUE, got {item!r}")
        key, value = item.split("=", 1)
        out[key.strip()] = value
    return out
```

(c) tar extraction filter (line ~317): `try: tar.extractall(dest, filter="data")` / `except TypeError: tar.extractall(dest)`.

(d) git robustness: `run_git` injects `-c core.quotepath=off` (`["git", "-c", "core.quotepath=off", *args]`); `ensure_update_branch` verifies `f"refs/heads/{branch}"`; the prune prompt (line ~815) uses `prompt_input(...)` instead of `input(...)`.

(e) `finalize_update` refuses an engine that doesn't match the plan (after the dry-run check):

```python
    plan_to = plan.get("engine_to") or {}
    current_commit = engine_commit(engine_dir)
    if plan_to.get("commit") and current_commit and plan_to["commit"] != current_commit:
        print(f"error: engine checkout {current_commit} does not match the plan's engine_to "
              f"{plan_to['commit']}; check out that commit (or re-run prepare)")
        return 1
```

(f) Move the `parse_set_values` call inside `prepare_update`'s `try:` block (so RuntimeError prints cleanly), i.e. lines 734-735 move below `try:`.

(g) Provisional plan before mutation + undo archive. In `prepare_update`: drop the `--plan` argument from the prepare subparser entirely (it defeated the in-progress guard; finalize/abort keep theirs) — `plan_path = work_dir / "plan.json"` always. Then, immediately before `apply_safe_operations`:

```python
        plan_path = work_dir / "plan.json"
        if not args.dry_run:
            write_plan(  # provisional: exists before any vault mutation so a
                plan_path=plan_path,  # crash mid-apply is abortable even without git
                manifest=manifest, answers=answers, packs=packs,
                engine_dir=engine_dir, work_dir=work_dir, entries=entries,
                unresolved=unresolved, added_tokens=added_tokens,
                branch=git_branch, previous_branch=previous_branch,
                status_override="applying",
            )
            apply_safe_operations(entries, vault_dir=vault_dir, staged_dir=staged_dir,
                                  prune_removed=prune_removed, work_dir=work_dir)
```

`write_plan` gains `status_override: str | None = None`; `status = status_override or (...)`. `pending_update_plans` statuses become `{"pending", "commit-failed", "applying"}`. `apply_safe_operations` gains `work_dir` and archives originals before destructive ops:

```python
def apply_safe_operations(entries, *, vault_dir, staged_dir, prune_removed, work_dir):
    for entry in entries:
        rel = entry["path"]
        disposition = entry["disposition"]
        if disposition == Disposition.REPLACE_UNTOUCHED:
            if (vault_dir / rel).exists():      # undo copy: non-git vaults have no
                copy_file(vault_dir / rel, work_dir / "undo" / rel)  # other recovery
            copy_file(staged_dir / rel, vault_dir / rel)
            entry["applied"] = True
        elif disposition == Disposition.REMOVED_UPSTREAM and prune_removed:
            if (vault_dir / rel).exists():
                copy_file(vault_dir / rel, work_dir / "undo" / rel)
            remove_file(vault_dir / rel)
            entry["applied"] = True
        ...  # other branches unchanged
```

(h) `abort_update` untracked-removal no longer requires `applied` (a crash mid-apply leaves `applied: false` in the provisional plan): change the condition at line ~979 to `if entry.get("disposition") in ABORT_UNTRACKED_DISPOSITIONS:` — the `ls-files` + `target.is_file()` checks already make this safe.

(i) Relative `work_dir` in plans (vault moves between prepare/finalize must not dangle): in `write_plan`, `"work_dir": (work_dir.relative_to(vault_dir).as_posix() if work_dir.is_absolute() and work_dir.as_posix().startswith(vault_dir.as_posix()) else work_dir.as_posix())` — simpler: pass `vault_dir` into `write_plan` and store `work_dir.relative_to(vault_dir).as_posix()`. In `finalize_update`/`abort_update` resolve:

```python
    work_dir = plan.get("work_dir")
    if work_dir:
        wd = pathlib.Path(work_dir)
        if not wd.is_absolute():
            wd = vault_dir / wd
        strip_work_heavy(wd)   # (abort: shutil.rmtree(wd, ignore_errors=True))
```

(j) `finalize_command` uses `pathlib.Path(__file__).resolve().as_posix()`.

(k) Classification order fix (lines ~500-503) — locally deleted beats missing baseline:

```python
        if not current.exists():
            disposition = Disposition.DELETED_LOCAL
        elif not baseline.exists():
            disposition = Disposition.EDITED
        else:
            ...
```

- [ ] **Step 3: Run unit tests + `tests/test_update.sh`.** All PASS (test_update.sh doesn't use prepare `--plan`).
- [ ] **Step 4: Commit** `fix(update): path-traversal guards, provisional plan + undo archive, engine-match finalize, quotepath/refs-heads/tar-filter, loud --set errors`

---

### Task 7: memex_update.py optimization batch

**Files:**
- Modify: `tools/memex_update.py`, `tools/memex_bake.py`

- [ ] **Step 1: Share hashing between classify and manifest write.** `write_manifest_and_baseline` gains `files: dict | None = None`; computes `manifest_files_for_tree` only when None. `classify_update` already returns `staged_meta` — in `prepare_update`, capture it (rename `_staged_meta` → `staged_meta`) and pass `files=staged_meta` to the no-unresolved `write_manifest_and_baseline` call. (Finalize keeps recomputing — it re-bakes fresh.)

- [ ] **Step 2: Batch the deleted-path git check in `commit_update`:**

```python
    if paths:
        unignored = filter_unignored(vault_dir, paths)
        existing = [p for p in unignored if (vault_dir / p).exists()]
        missing = [p for p in unignored if not (vault_dir / p).exists()]
        tracked_missing = []
        if missing:
            out = run_git(vault_dir, ["ls-files", "--", *missing], check=False)
            tracked = {line for line in out.stdout.splitlines() if line}
            tracked_missing = [p for p in missing if p in tracked]
        addable = existing + tracked_missing
        if addable:
            run_git(vault_dir, ["add", "--", *addable])
```

- [ ] **Step 3: Rename detection — cache reads, score-sorted greedy matching, size prefilter.** Replace `detect_renames`:

```python
def detect_renames(*, removed_paths, new_paths, old_meta, new_meta, baseline_dir, staged_dir):
    texts: dict[str, str | None] = {}

    def text_of(root, rel):
        key = f"{root}:{rel}"
        if key not in texts:
            texts[key] = text_for_similarity(root / rel)
        return texts[key]

    scored = []
    for old_path in sorted(removed_paths):
        old_suffix = pathlib.PurePosixPath(old_path).suffix
        old_text = text_of(baseline_dir, old_path)
        for new_path in sorted(new_paths):
            if old_suffix and pathlib.PurePosixPath(new_path).suffix != old_suffix:
                continue
            if old_meta[old_path].get("kind") != new_meta[new_path].get("kind"):
                continue
            new_text = text_of(staged_dir, new_path)
            if old_text is None or new_text is None:
                score = content_similarity(baseline_dir / old_path, staged_dir / new_path)
            else:
                if min(len(old_text), len(new_text)) < 0.4 * max(len(old_text), len(new_text), 1):
                    continue  # size prefilter: can't reach the similarity threshold
                score = difflib.SequenceMatcher(None, old_text, new_text).ratio()
            if score >= RENAME_SIMILARITY_THRESHOLD:
                scored.append((score, old_path, new_path))
    scored.sort(key=lambda t: (-t[0], t[1], t[2]))  # best-score-first greedy: an
    used_old: set[str] = set()                       # earlier alphabetical pair can no
    used_new: set[str] = set()                       # longer steal a better later match
    candidates = []
    for score, old_path, new_path in scored:
        if old_path in used_old or new_path in used_new:
            continue
        used_old.add(old_path)
        used_new.add(new_path)
        candidates.append({"old_path": old_path, "new_path": new_path, "similarity": round(score, 4)})
    return candidates
```

- [ ] **Step 4: Run unit + `tests/test_update.sh`.** PASS.
- [ ] **Step 5: Commit** `perf(update): reuse staged hashes, batch git ls-files, cache+rank rename detection`

---

### Task 8: Deterministic auto-merge tier (feature 7)

**Files:**
- Modify: `tools/memex_update.py`
- Test: `tools/test_memex_update.py`, `tests/test_update.sh`

Three deterministic resolutions that shrink the agent-judgement surface: (1) collisions whose vault content is byte-identical to staged; (2) clean 3-way merges of `kind: prose` EDITED files via `git merge-file` (this also auto-keeps local edits when the engine didn't change the file); (3) exact renames (similarity ≈ 1.0, no local edit, no collision).

- [ ] **Step 1: Failing unit test:**

```python
class TestThreeWayMerge(unittest.TestCase):
    def test_clean_and_conflicting(self):
        import tempfile, pathlib
        from memex_update import three_way_merge
        with tempfile.TemporaryDirectory() as tmp:
            d = pathlib.Path(tmp)
            (d / "base").write_text("a\nb\nc\n")
            (d / "current").write_text("a\nb LOCAL\nc\n")
            (d / "staged").write_text("a\nb\nc\nENGINE\n")
            merged = three_way_merge(d / "current", d / "base", d / "staged")
            self.assertIn("b LOCAL", merged)
            self.assertIn("ENGINE", merged)
            (d / "staged2").write_text("a\nb ENGINE\nc\n")
            self.assertIsNone(three_way_merge(d / "current", d / "base", d / "staged2"))
```

- [ ] **Step 2: Implement.** Add:

```python
def three_way_merge(current: pathlib.Path, baseline: pathlib.Path, staged: pathlib.Path) -> str | None:
    """Clean 3-way merge text, or None on conflict / unavailable git."""
    try:
        proc = subprocess.run(
            ["git", "merge-file", "--stdout", str(current), str(baseline), str(staged)],
            capture_output=True, text=True, check=False,
        )
    except FileNotFoundError:
        return None
    if proc.returncode != 0:  # >0: conflicts; <0: error
        return None
    return proc.stdout
```

In `classify_update`:

- EDITED prose entries: after `add_version_paths(...)`, before `unresolved.append(entry)`:

```python
            merged = None
            if (disposition == Disposition.EDITED and meta.get("kind") == "prose"
                    and baseline.exists() and current.exists() and staged.exists()):
                merged = three_way_merge(current, baseline, staged)
            if merged is not None:
                merged_path = work_dir / "merged" / rel
                merged_path.parent.mkdir(parents=True, exist_ok=True)
                merged_path.write_text(merged)
                entry.update({"resolved": True, "resolution": "auto-merged",
                              "merged_path": merged_path.as_posix()})
            else:
                unresolved.append(entry)
```

(restructure the existing `if disposition in {EDITED, DELETED_LOCAL}` block so DELETED_LOCAL still goes straight to unresolved).

- COLLISION entries: before `add_version_paths`:

```python
        if disposition == Disposition.COLLISION:
            staged_hash = meta.get("sha256") or sha256_file(staged_dir / rel)
            if sha256_file(vault_dir / rel) == staged_hash:
                entry.update({"resolved": True, "resolution": "identical-content", "applied": True})
                entries.append(entry)
                continue
```

- RENAME_CANDIDATE entries (in the rename loop): after building `entry`:

```python
        if (disposition == Disposition.RENAME_CANDIDATE and not edited
                and item["similarity"] >= 0.9995):
            entry.update({"resolved": True, "resolution": "auto-rename"})
            entries.append(entry)
            continue   # skip unresolved.append
```

In `apply_safe_operations`, add branches:

```python
        elif disposition == Disposition.EDITED and entry.get("resolution") == "auto-merged":
            copy_file(pathlib.Path(entry["merged_path"]), vault_dir / rel)
            entry["applied"] = True
        elif disposition == Disposition.RENAME_CANDIDATE and entry.get("resolution") == "auto-rename":
            copy_file(staged_dir / entry["new_path"], vault_dir / entry["new_path"])
            if (vault_dir / rel).exists():
                copy_file(vault_dir / rel, work_dir / "undo" / rel)
            remove_file(vault_dir / rel)
            entry["applied"] = True
```

`strip_work_heavy` strips `("staged", "versions", "merged")` (keeps `undo`).

- [ ] **Step 3: Update `tests/test_update.sh` fixtures whose pending-ness relied on trivially-mergeable edits.** The auto-merge tier resolves a local edit when the engine didn't touch the file, so:
  - ABORTVAULT (~line 278): replace the email-skill edit with a **conflicting** edit: `printf '\nUpdate test marker: CONFLICTING LOCAL LINE\n' >> "$ABORTVAULT/.claude/skills/triage-inbox/SKILL.md"` (the NEXT engine appends its own marker to the same file → both sides append at the same location → conflict → pending). Keep the rest of the abort flow.
  - PENDINGVAULT (~line 295): same substitution (edit `triage-inbox/SKILL.md`, not `email/SKILL.md`).
  - Main VAULT: keep the email edit, and add assertions after the update run:

```zsh
grep -q "Local email skill edit that must survive" "$VAULT/.claude/skills/email/SKILL.md" || fail "auto-merge lost the local edit"
python3 - "$PLAN" <<'PY'
import json, pathlib, sys
plan = json.loads(pathlib.Path(sys.argv[1]).read_text())
auto = [e for e in plan["entries"] if e.get("resolution") == "auto-merged"]
assert auto, "expected at least one auto-merged entry (email skill local edit)"
assert all(e["applied"] for e in auto), auto
PY
```

  The main VAULT plan stays pending via the `collision-skill` fixture (differing content — not auto-resolved).

- [ ] **Step 4: Run unit + `tests/test_update.sh`.** PASS.
- [ ] **Step 5: Commit** `feat(update): deterministic auto-merge tier — clean 3-way prose merges, identical-content collisions, exact renames`

---

### Task 9: Hook hardening (derive-managed — record in BACKPORT)

**Files:**
- Modify: `hardened/hooks/log-mutation.sh` (full rewrite below)
- Modify: `hardened/hooks/bump-updated.sh` (full rewrite below)
- Modify: `hardened/hooks/session-start-context.sh`

- [ ] **Step 1: Rewrite `hardened/hooks/log-mutation.sh`** — single python3 invocation (was two), flock + atomic replace (the contract encourages parallel subagent writes; the old read-then-truncate lost lines), portable dedupe (old `date -j` was BSD-only), cheap bash prefilter:

```bash
#!/usr/bin/env bash
# PostToolUse hook: auto-append a placeholder log line for any Edit/Write to a
# typed vault note. The vault's discipline ("every mutation logged") is
# systematically dropped by skill-driven sessions — this hook guarantees
# something gets recorded; the agent rewrites the placeholder with a real
# summary at workflow end.
#
# Deliberately NOT using `set -e` — a hook must never break a session.
# Hook input arrives as JSON on stdin per Claude Code PostToolUse spec.
set -u

REPO_ROOT="$(cd "$(dirname "$0")/../.." 2>/dev/null && pwd)" || exit 0
cd "$REPO_ROOT" || exit 0

hook_input="$(cat 2>/dev/null || true)"
# Cheap prefilter before paying python3 startup: must mention a file_path at all.
case "$hook_input" in *'"file_path"'*) ;; *) exit 0 ;; esac

printf '%s' "$hook_input" | python3 - "$REPO_ROOT" << 'PYEOF'
import datetime, json, os, sys, tempfile

try:
    import fcntl
except ImportError:  # non-POSIX: degrade to unlocked (still atomic via os.replace)
    fcntl = None

root = sys.argv[1]
try:
    payload = json.load(sys.stdin)
except Exception:
    sys.exit(0)
file_path = (payload.get("tool_input") or {}).get("file_path") or ""
if not file_path or file_path.endswith("/log.md"):
    sys.exit(0)
prefix = root.rstrip("/") + "/"
if not file_path.startswith(prefix):       # only this vault's files
    sys.exit(0)
rel = file_path[len(prefix):]
parts = rel.split("/")
typed = rel.endswith(".md") and (
    (parts[0] == "Atlas" and len(parts) >= 3)
    or (parts[0] == "Ops" and len(parts) >= 3
        and parts[1] in {"Tasks", "Followups", "Briefings", "Reviews"})
)
if not typed or any(seg in rel for seg in ("_archive", "Inbox/", "_schemas", "_templates", "_workflows")):
    sys.exit(0)

base = os.path.basename(rel)[:-3]
now = datetime.datetime.now().astimezone()
log_path = os.path.join(root, "log.md")
lock_dir = os.path.join(root, ".memex")
os.makedirs(lock_dir, exist_ok=True)
lock = open(os.path.join(lock_dir, "log.lock"), "w")
if fcntl is not None:
    fcntl.flock(lock, fcntl.LOCK_EX)   # released on process exit
try:
    with open(log_path) as f:
        lines = f.readlines()
except FileNotFoundError:
    sys.exit(0)

# Dedupe: skip if the most recent line for this note is < 60s old (10
# consecutive Edits to one Task must not produce 10 placeholders).
needle = f"[[{base}]]"
for line in lines:
    if needle in line:
        try:
            prev = datetime.datetime.fromisoformat(line.split(" ")[0])
            if 0 <= (now - prev).total_seconds() < 60:
                sys.exit(0)
        except ValueError:
            pass
        break

new = (f"{now.isoformat(timespec='seconds')} — agent:auto — touch — [[{base}]] — "
       "auto-placeholder via PostToolUse hook (Edit/Write); rewrite at end-of-workflow with real summary.\n")
insert_at = len(lines)
for i, line in enumerate(lines):   # newest entries live at the top, after the preamble
    if line.startswith("20") and "T" in line[:11] and "—" in line:
        insert_at = i
        break
if insert_at == len(lines) and lines and not lines[-1].endswith("\n"):
    lines[-1] += "\n"
lines.insert(insert_at, new)

fd, tmp = tempfile.mkstemp(dir=root, prefix=".log.md.")
try:
    with os.fdopen(fd, "w") as f:
        f.writelines(lines)
    os.replace(tmp, log_path)      # atomic: a crash can never truncate the log
except BaseException:
    try:
        os.unlink(tmp)
    except OSError:
        pass
    raise
PYEOF

exit 0
```

- [ ] **Step 2: Rewrite `hardened/hooks/bump-updated.sh`** — drop `set -euo pipefail` (the jq-less fallback's `grep` exit-1 killed the hook), scope to this vault, preserve file mode:

```bash
#!/usr/bin/env bash
# PostToolUse hook: auto-bumps `updated:` in YAML frontmatter of vault notes
# after Edit/Write. Idempotent — safe to fire multiple times in a row.
# Reads tool JSON from stdin per Claude Code PostToolUse semantics.
#
# Deliberately NOT using `set -e`/pipefail — a hook must never break a session
# (the no-match grep in the jq-less fallback exits 1, which pipefail turned
# into a hook failure on every non-file tool call).
set -u

REPO_ROOT="$(cd "$(dirname "$0")/../.." 2>/dev/null && pwd)" || exit 0

input="$(cat 2>/dev/null || true)"

if command -v jq >/dev/null 2>&1; then
  file_path="$(printf '%s' "$input" | jq -r '.tool_input.file_path // empty' 2>/dev/null || true)"
else
  file_path="$(printf '%s' "$input" | grep -oE '"file_path"[[:space:]]*:[[:space:]]*"[^"]*"' 2>/dev/null \
    | head -1 | sed 's/.*:[[:space:]]*"\(.*\)"/\1/' || true)"
fi
[ -z "${file_path:-}" ] && exit 0

# Scope: only this vault (an Edit to another repo's Atlas/ must not be touched),
# only typed notes under tracked folders, never schemas/templates/archive/inbox/raw.
case "$file_path" in "$REPO_ROOT"/*) ;; *) exit 0 ;; esac
case "$file_path" in *.md) ;; *) exit 0 ;; esac
case "$file_path" in */_archive/*|*/Inbox/*|*/_schemas/*|*/_templates/*|*/_workflows/*|*/Raw/*) exit 0 ;; esac
case "$file_path" in
  "$REPO_ROOT"/Atlas/*|"$REPO_ROOT"/Ops/Tasks/*|"$REPO_ROOT"/Ops/Followups/*|"$REPO_ROOT"/Ops/Briefings/*|"$REPO_ROOT"/Ops/Reviews/*) ;;
  *) exit 0 ;;
esac

[ -f "$file_path" ] || exit 0
head -40 "$file_path" 2>/dev/null | grep -q '^updated:' || exit 0

today="$(date +%Y-%m-%d)"
tmp="${file_path}.bump-tmp.$$"

awk -v today="$today" '
  BEGIN { in_fm=0; bumped=0 }
  NR==1 && /^---$/ { in_fm=1; print; next }
  in_fm && /^---$/ { in_fm=0; print; next }
  in_fm && /^updated:/ && !bumped { print "updated: " today; bumped=1; next }
  { print }
' "$file_path" > "$tmp" 2>/dev/null || { rm -f "$tmp"; exit 0; }

# cat-over (not mv): preserves the file's inode and mode. Only swap if
# non-empty and different — preserves the file on an awk hiccup.
if [ -s "$tmp" ] && ! cmp -s "$file_path" "$tmp"; then
  cat "$tmp" > "$file_path"
fi
rm -f "$tmp"
exit 0
```

- [ ] **Step 3: Patch `hardened/hooks/session-start-context.sh`:**
  - Line 15: `echo "=== Memex vault session-start (hook) ==="` (drops the source vault's "LifeOS" brand).
  - Replace the two task-scan blocks (lines 27-37 and 56-69) with one awk pass:

```bash
task_glob="Ops/Tasks/Task*.md"
if ls $task_glob >/dev/null 2>&1; then
  task_scan="$(awk '
    FNR==1 { seen=0 }
    /^status:[[:space:]]*/ && !seen {
      seen=1; s=$2; c[s]++
      if (s == "needs_review") nr[FILENAME]=1
    }
    END {
      for (k in c) printf "count %s %d\n", k, c[k]
      for (f in nr) printf "review %s\n", f
    }
  ' $task_glob 2>/dev/null)"
  echo "Open tasks:"
  for s in next in_progress scheduled waiting needs_review; do
    n="$(printf '%s\n' "$task_scan" | awk -v s="$s" '$1=="count" && $2==s {print $3}')"
    [ -n "${n:-}" ] && printf "  %-14s %s\n" "$s:" "$n"
  done
  echo
fi
```

  and for the needs_review section further down reuse `task_scan`:

```bash
needs_review_files="$(printf '%s\n' "${task_scan:-}" | awk '$1=="review" {print $2}')"
if [ -n "$needs_review_files" ]; then
  echo
  echo "Tasks awaiting your review (needs_review):"
  printf '%s\n' "$needs_review_files" | while read -r f; do
    [ -z "$f" ] && continue
    title="$(awk -F'"' '/^title:/{print $2; exit}' "$f" 2>/dev/null)"
    [ -z "$title" ] && title="$(basename "$f" .md)"
    echo "  - $title"
  done
fi
```

  - Quartz log out of world-writable /tmp (line 75): `mkdir -p outputs` then `( cd quartz && npm run site:serve > "$REPO_ROOT/outputs/quartz-serve.log" 2>&1 & disown ) >/dev/null 2>&1`.

- [ ] **Step 4: Syntax-check all three (`bash -n hardened/hooks/*.sh`) and behavior-test log-mutation concurrency:**

```bash
bash - <<'SH'
set -e
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
mkdir -p "$TMP/v/.claude/hooks" "$TMP/v/Ops/Tasks" "$TMP/v/.memex"
cp hardened/hooks/log-mutation.sh "$TMP/v/.claude/hooks/"
printf '# log\n' > "$TMP/v/log.md"
for i in 1 2 3 4 5 6 7 8 9 10; do
  printf '{"tool_input":{"file_path":"%s"}}' "$TMP/v/Ops/Tasks/Task $i.md" \
    | bash "$TMP/v/.claude/hooks/log-mutation.sh" &
done
wait
n="$(grep -c 'agent:auto' "$TMP/v/log.md")"
[ "$n" = "10" ] || { echo "FAIL: expected 10 log lines, got $n"; exit 1; }
echo "log-mutation concurrency OK"
SH
```

(Note the path with a space — also exercises quoting.) Then run `tests/test_init.sh` (hooks are installed + executable assertions).

- [ ] **Step 5: Commit** `fix(hooks): atomic+locked log-mutation, portable dedupe, vault-scoped mode-preserving bump-updated, Memex branding, single-pass task scan, vault-local quartz log`

---

### Task 10: settings.json — permissions.deny (feature 6) + tighter matcher (derive-managed — BACKPORT)

**Files:**
- Modify: `hardened/settings.json`

- [ ] **Step 1: Replace content:**

```json
{
  "permissions": {
    "deny": [
      "Read(./.env)",
      "Read(./.env.*)",
      "Read(./secrets/**)",
      "Bash(git push --force:*)",
      "Bash(git push -f:*)"
    ]
  },
  "hooks": {
    "SessionStart": [
      {
        "matcher": "startup|resume|clear",
        "hooks": [
          {
            "type": "command",
            "command": "bash \"$CLAUDE_PROJECT_DIR/.claude/hooks/session-start-context.sh\""
          }
        ]
      }
    ],
    "PostToolUse": [
      {
        "matcher": "^(Edit|Write)$",
        "hooks": [
          {
            "type": "command",
            "command": "bash \"$CLAUDE_PROJECT_DIR/.claude/hooks/bump-updated.sh\""
          },
          {
            "type": "command",
            "command": "bash \"$CLAUDE_PROJECT_DIR/.claude/hooks/log-mutation.sh\""
          }
        ]
      }
    ]
  }
}
```

- [ ] **Step 2: Run `tests/test_init.sh`** (its settings assertion checks hook commands only — passes).
- [ ] **Step 3: Commit** `feat(settings): deny .env/secrets reads and force-push; anchor PostToolUse matcher`

---

### Task 11: launchd plist + serve script (derive-managed — BACKPORT)

**Files:**
- Modify: `hardened/launchd/com.you.memex-quartz.plist`
- Modify: `hardened/launchd/serve_quartz.sh` (mode only)

- [ ] **Step 1: Plist** — per-vault label, vault-local log, crash-loop throttle:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.memex.quartz.{{VAULT_NAME}}</string>

  <key>ProgramArguments</key>
  <array>
    <string>/bin/zsh</string>
    <string>{{VAULT_PATH}}/scripts/serve_quartz.sh</string>
  </array>

  <!-- Start at login, and keep it alive: launchd respawns the server within
       seconds if it ever exits (crash, or a sleep/wake that killed it).
       ThrottleInterval prevents a tight crash loop when node_modules is missing. -->
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>ThrottleInterval</key>
  <integer>10</integer>

  <key>WorkingDirectory</key>
  <string>{{VAULT_PATH}}/quartz</string>

  <!-- Vault-local log: /tmp is world-writable (symlink hazard) and one fixed
       path interleaved every vault's output. -->
  <key>StandardOutPath</key>
  <string>{{VAULT_PATH}}/outputs/quartz-serve.log</string>
  <key>StandardErrorPath</key>
  <string>{{VAULT_PATH}}/outputs/quartz-serve.log</string>

  <key>ProcessType</key>
  <string>Background</string>
</dict>
</plist>
```

- [ ] **Step 2:** `chmod 755 hardened/launchd/serve_quartz.sh` (`bake_file` preserves mode; manual `scripts/serve_quartz.sh` runs failed as 644). Add to `tests/test_init.sh` near line 68: change to `[ -x "$TMP/core/scripts/serve_quartz.sh" ] || fail "serve_quartz.sh not executable"`.

- [ ] **Step 3: Run `tests/test_init.sh`** (plist name assertion updated in Task 4). Update the README quickstart line 43-44 if it names the plist file explicitly.
- [ ] **Step 4: Commit** `fix(launchd): per-vault label, vault-local log, throttle; executable serve script`

---

### Task 12: Quartz — localhost bind, publish-safety, port token (derive-managed — BACKPORT)

**Files:**
- Modify: `hardened/quartz/quartz/cli/handlers.js:456-457`
- Modify: `hardened/quartz/quartz.config.ts:17,18-72`
- Modify: `hardened/quartz/package.json:18`

- [ ] **Step 1: handlers.js** — the serve mode runs with `QUARTZ_INCLUDE_PRIVATE=true` under a KeepAlive launchd agent; binding all interfaces exposes the whole vault to the LAN:

```js
    server.listen(argv.port, "127.0.0.1")
    const wss = new WebSocketServer({ host: "127.0.0.1", port: argv.wsPort })
```

- [ ] **Step 2: quartz.config.ts** — `baseUrl: "localhost:{{QUARTZ_PORT}}",` and add to `ignorePatterns` (after the `".claude",` line):

```ts
      ".memex",
      // _config/sources.md carries the owner's email addresses and has no
      // sensitivity: field, so the privacy filter would publish it.
      "_config",
      "_config/**",
```

- [ ] **Step 3: package.json** — `QUARTZ_PUBLIC_BUILD` is read nowhere; the name implied scrubbing it didn't do: `"site:build:public": "npx quartz build -d ..",`

- [ ] **Step 4: Verify** — `grep -rn "QUARTZ_PUBLIC_BUILD" hardened/` returns nothing; `node --check hardened/quartz/quartz/cli/handlers.js` passes; run `tests/test_init.sh`.
- [ ] **Step 5: Commit** `fix(quartz): bind 127.0.0.1, ignore _config/.memex, tokenized baseUrl, drop phantom public-build env`

---

### Task 13: Contract + registry text fixes (hand-curated files — safe to edit directly)

**Files:**
- Modify: `hardened/contract/CLAUDE.base.md`, `hardened/contract/AGENTS.base.md`
- Modify: `packs.json:128-131`
- Modify: `packs/core/schemas/_types.md:18-19` (derive-managed — BACKPORT)
- Modify: `README.md`

Read surrounding context before each edit; line numbers are from the audit.

- [ ] **Step 1: CLAUDE.base.md:**
  - Line 10 (step 4 of "Where to start"): replace the `IMPLEMENTATION_PLAN.md` direction with: ``4. Recent state lives in `log.md` (newest entries at top) and `Ops/Tasks/` — `/session-start` summarizes both.``
  - Line 101: `8080` → `{{QUARTZ_PORT}}`. Lines 139, 147: `8181` → `{{QUARTZ_PORT}}`.
  - Line 151: "Two hooks live in `.claude/hooks/`" → "Three hooks live in `.claude/hooks/`" and ensure the following list/paragraph describes all three (`session-start-context.sh`, `bump-updated.sh`, `log-mutation.sh` — the last auto-appends a placeholder `log.md` line for any Edit/Write to a typed note).
  - Line 169: "ships 19 skills" → "ships 23 skills".
  - Lines 281, 285, 333: remove the `IMPLEMENTATION_PLAN.md` pointers — keep the surrounding guidance but drop "lived in/see IMPLEMENTATION_PLAN.md" clauses (that file never ships; e.g. line 285 → "…the installed version has these quirks. If you author or patch a view file (`*.base`), use the workarounds below.").
- [ ] **Step 2: AGENTS.base.md:**
  - Line 62 (`scripts/` row): replace with `| `scripts/` | Framework | Engine-installed utilities: `serve_quartz.sh`, `launchd/` plist, `memex-doctor.sh`; pi pack adds `merge_letterhead.py` and `build_cv.sh`. |` (match the table's column count).
  - Line 72: "Walks every unfiled item in `Inbox/` + `Inbox/`" → "Walks every unfiled item in `Inbox/`".
  - Line 91: drop the trailing ", and capture triage / source ingest reads from it in addition to `Inbox/`." → end the sentence at "…raw markdown, draft synthesis — and capture triage / source ingest reads from it." Also check lines 40-50 for a duplicated `Inbox/` vault-map row (one says contents tracked, contradicting `.gitignore`) — keep the row matching `.gitignore` reality (folder + README tracked, contents not).
  - Line 160: "generates 12 filterable dashboards (Tasks, … Ideas)" → "generates 14 filterable dashboards (Tasks, Projects, People, Sources, Trackers, Followups, Concepts, Organizations, Decisions, Areas, Ideas, Implementations, Needs-attention, and — with the pi pack — Letters)".
  - Line 167: `8181` → `{{QUARTZ_PORT}}`.
  - Line 200: replace with: ``Append a one-line question to the relevant task note's `# Reviewer notes` section (create it if absent). Never guess at structural decisions.``
- [ ] **Step 3: packs.json** — `"contract": ["AGENTS.md", "CLAUDE.md"]` → `"contract": ["AGENTS.base.md", "CLAUDE.base.md", "pi-fragment.md"]` (decorative-but-wrong; no tool reads it, but it documents hardened/contract/).
- [ ] **Step 4: _types.md lines 18-19** — append to the Purpose cell of both rows: `…in Drive *(pi pack — core-only vaults omit this type)*`.
- [ ] **Step 5: README.md** — "the two discipline hooks" (line ~11) → "the three discipline hooks".
- [ ] **Step 6: Run `tests/test_init.sh`** (contract bake assertions; no_unbaked validates `{{QUARTZ_PORT}}` got baked in contracts). Commit `docs(contract): fix stale counts/ports/file refs; registry annotations`

---

### Task 14: Ship `build_cv.sh` (fixes the broken `/cv-build` skill)

**Files:**
- Create: `packs/pi/scripts/build_cv.sh` (derive-managed dir — BACKPORT)
- Modify: `packs.json:118-120`

- [ ] **Step 1:** First `ls packs/pi/cv/` to learn the variants layout (the skill says drivers live at `CV/variants/<n>.tex`; confirm and adapt the latexmk cwd if the actual layout differs). Then create `packs/pi/scripts/build_cv.sh` (mode 755):

```bash
#!/usr/bin/env bash
# Build a CV variant PDF into outputs/cv/ and (by default) copy it to the
# Google Drive Desktop mount ("Compiled CVs"). Wrapped by the /cv-build skill.
#
# Usage: scripts/build_cv.sh [variant]     (default: full)
# Env:   CV_NO_DRIVE=1   skip the Drive copy
set -euo pipefail

VAULT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
variant="${1:-full}"
driver="$VAULT_ROOT/CV/variants/${variant}.tex"

if [ ! -f "$driver" ]; then
  echo "build_cv: no such variant: $driver" >&2
  echo "available variants:" >&2
  ls "$VAULT_ROOT/CV/variants/"*.tex >&2 2>/dev/null || echo "  (none)" >&2
  exit 1
fi
if ! command -v latexmk >/dev/null 2>&1; then
  echo "build_cv: latexmk not found — install a TeX distribution (e.g. MacTeX / TeX Live)" >&2
  exit 1
fi

date_tag="$(date +%Y-%m-%d)"
out_dir="$VAULT_ROOT/outputs/cv"
build_dir="$(mktemp -d)"
trap 'rm -rf "$build_dir"' EXIT
mkdir -p "$out_dir"

( cd "$VAULT_ROOT/CV/variants" \
  && latexmk -pdf -interaction=nonstopmode -halt-on-error -output-directory="$build_dir" "$driver" ) \
  > "$build_dir/build.log" 2>&1 || { tail -40 "$build_dir/build.log" >&2; exit 1; }

pdf="$build_dir/${variant}.pdf"
[ -f "$pdf" ] || { echo "build_cv: build produced no PDF (see latexmk output)" >&2; exit 1; }
dest="$out_dir/${variant}-${date_tag}.pdf"
cp "$pdf" "$dest"
echo "built: $dest"

if [ "${CV_NO_DRIVE:-0}" != "1" ]; then
  drive_dir="$HOME/Library/CloudStorage/{{DRIVE_MOUNT}}/My Drive/Compiled CVs"
  if [ -d "$drive_dir" ]; then
    cp "$dest" "$drive_dir/{{OWNER_NAME}} CV - ${variant} - ${date_tag}.pdf"
    echo "drive copy: ${drive_dir}/{{OWNER_NAME}} CV - ${variant} - ${date_tag}.pdf"
  else
    echo "build_cv: Drive mount not found (${drive_dir}); skipped Drive copy (CV_NO_DRIVE=1 silences this)" >&2
  fi
fi
```

- [ ] **Step 2:** `packs.json` pi.scripts → `["merge_letterhead.py", "build_cv.sh"]`.
- [ ] **Step 3:** `bash -n packs/pi/scripts/build_cv.sh`; run `tests/test_init.sh` and add a pi assertion: `[ -x "$TMP/pi/scripts/build_cv.sh" ] || fail "build_cv.sh not installed/executable"`. Run `python3 tools/audit_literals.py ./packs` (must stay CLEAN).
- [ ] **Step 4: Commit** `feat(pi): ship scripts/build_cv.sh — /cv-build referenced it but it never existed`

---

### Task 15: tools/audit_refs.py — consistency gate (feature 1)

**Files:**
- Create: `tools/audit_refs.py`
- Modify: `tests/test_init.sh` (run the gate), `README.md` (maintainer section)

- [ ] **Step 1: Create `tools/audit_refs.py`:**

```python
#!/usr/bin/env python3
"""Engine self-consistency gate (companion to audit_literals.py).

Checks, against an engine checkout:
  1. packs.json <-> disk, both directions (entries with no file; files no entry covers)
  2. every {{TOKEN}} used in packs/ + hardened/ is catalogued in placeholders.json
  3. every catalogued placeholder is actually used somewhere
  4. {{?TOKEN}}/{{^TOKEN}}/{{/TOKEN}} section markers balance per file

Usage: audit_refs.py [engine-dir]   ->  exit 0 clean / 1 problems
"""
import json, os, pathlib, re, sys

TEXT_EXT = {".md", ".ts", ".tsx", ".sh", ".json", ".plist", ".py", ".scss", ".tex", ".sty", ".yaml", ".yml"}
TEXT_NAMES = {"gitignore"}
SKIP_DIRS = {".git", "node_modules", "public", ".quartz-cache", "__pycache__", ".venv"}
TOKEN_RE = re.compile(r"\{\{([A-Z0-9_]+)\}\}")
SECTION_RE = re.compile(r"\{\{([?^/])([A-Z0-9_]+)\}\}")
RUNTIME_TOKENS = {"YYYYMMDD"}          # note-template placeholders bake() passes through
# Vendored quartz sources legitimately contain {{...}} (GH Actions, JSX, docs);
# only all-caps snake matches TOKEN_RE, but skip the vendored tree for usage checks.
VENDORED_PREFIX = "hardened/quartz/"

SECTION_LOCATIONS = {"skills", "schemas", "templates", "workflows", "prompts", "scripts"}


def text_files(root: pathlib.Path):
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = [d for d in dirnames if d not in SKIP_DIRS]
        for name in filenames:
            fp = pathlib.Path(dirpath) / name
            if fp.suffix in TEXT_EXT or fp.name in TEXT_NAMES:
                yield fp


def check_packs(eng: pathlib.Path, problems: list[str]) -> None:
    packs = json.loads((eng / "packs.json").read_text())
    covered: set[pathlib.Path] = set()
    for pack, cfg in packs.items():
        if pack == "hardened":
            for hook in cfg.get("hooks", []):
                covered.add(eng / "hardened/hooks" / hook)
            for lf in cfg.get("launchd", []):
                covered.add(eng / "hardened/launchd" / lf)
            for c in cfg.get("contract", []):
                covered.add(eng / "hardened/contract" / c)
            if cfg.get("settings"):
                covered.add(eng / "hardened/settings.json")
            if cfg.get("gitignore"):
                covered.add(eng / "hardened/gitignore")
            continue
        for section, value in cfg.items():
            if section == "cv":
                if value:
                    cv = eng / f"packs/{pack}/cv"
                    if not cv.is_dir():
                        problems.append(f"packs.json {pack}.cv -> missing dir {cv}")
                    else:
                        covered.update(p for p in cv.rglob("*") if p.is_file())
                continue
            if section not in SECTION_LOCATIONS:
                problems.append(f"packs.json {pack}.{section}: unknown section")
                continue
            for name in value:
                if section == "skills":
                    path = eng / f"packs/{pack}/skills" / name
                    if not path.is_dir():
                        problems.append(f"packs.json {pack}.skills:{name} -> missing dir {path}")
                    else:
                        covered.update(p for p in path.rglob("*") if p.is_file())
                else:
                    fname = name if "." in name else f"{name}.md"
                    path = eng / f"packs/{pack}/{section}" / fname
                    if not path.is_file():
                        problems.append(f"packs.json {pack}.{section}:{name} -> missing file {path}")
                    covered.add(path)
    # reverse direction: orphans under packs/, hooks, launchd, contract
    for root in (eng / "packs", eng / "hardened/hooks", eng / "hardened/launchd", eng / "hardened/contract"):
        if not root.exists():
            continue
        for fp in root.rglob("*"):
            if fp.is_file() and fp not in covered:
                problems.append(f"orphan (no packs.json entry installs it): {fp.relative_to(eng)}")


def check_tokens(eng: pathlib.Path, problems: list[str]) -> None:
    catalog = {p["token"] for p in json.loads((eng / "placeholders.json").read_text())["placeholders"]}
    used: set[str] = set()
    for root in (eng / "packs", eng / "hardened"):
        for fp in text_files(root):
            rel = fp.relative_to(eng).as_posix()
            text = fp.read_text(errors="ignore")
            vendored = rel.startswith(VENDORED_PREFIX) and "memexDashboards" not in rel
            for tok in TOKEN_RE.findall(text):
                if tok in catalog:
                    used.add(tok)
                elif tok not in RUNTIME_TOKENS and not vendored:
                    problems.append(f"uncatalogued token {{{{{tok}}}}} in {rel}")
            # section marker balance
            stack: list[str] = []
            for sigil, tok in SECTION_RE.findall(text):
                if sigil in "?^":
                    stack.append(tok)
                elif not stack or stack.pop() != tok:
                    problems.append(f"unbalanced section marker {{{{/{tok}}}}} in {rel}")
                    break
            if stack:
                problems.append(f"unclosed section marker(s) {stack} in {rel}")
    for tok in sorted(catalog - used):
        problems.append(f"placeholder {tok} is catalogued but used nowhere in packs/ or hardened/")


def main() -> int:
    eng = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else ".").resolve()
    problems: list[str] = []
    check_packs(eng, problems)
    check_tokens(eng, problems)
    if not problems:
        print("REFS CLEAN: packs.json, tokens, and section markers are consistent.")
        return 0
    print(f"REF PROBLEMS ({len(problems)}):")
    for p in problems:
        print(f"  {p}")
    return 1


if __name__ == "__main__":
    sys.exit(main())
```

- [ ] **Step 2: Run `python3 tools/audit_refs.py .`** — fix whatever it flags by correcting config or adding to RUNTIME_TOKENS/vendored handling *only when genuinely benign* (e.g. uppercase tokens in vendored quartz docs). Expected to be CLEAN after Tasks 5 (FRAMING removed), 13 (contract entry fixed), 14 (build_cv listed). If it finds real new inconsistencies, fix them.
- [ ] **Step 3:** Add to `tests/test_init.sh` after the TOKENS block: `python3 "$ENG/tools/audit_refs.py" "$ENG" >/dev/null || fail "audit_refs gate"`; add to README maintainer block: `python3 tools/audit_refs.py .                            # must be REFS CLEAN`.
- [ ] **Step 4: Commit** `feat(audit): add audit_refs.py consistency gate (packs.json<->disk, token catalog, section markers)`

---

### Task 16: memex-doctor (feature 5)

**Files:**
- Create: `hardened/scripts/memex-doctor.sh` (NEW hand-curated dir — derive's selective wipe does not touch it; add a comment in derive.py noting this, mirroring the contract/ note)
- Modify: `tools/memex_bake.py` (install it), `tools/derive.py` (comment only), `tests/test_init.sh`

- [ ] **Step 1: Create `hardened/scripts/memex-doctor.sh`:**

```bash
#!/usr/bin/env bash
# memex-doctor: validate this vault's installed wiring. Most hook/serve
# failures are silent by design (hooks must never break a session) — this is
# where they become visible. Run from anywhere inside the vault:
#   scripts/memex-doctor.sh
# Exit: 0 = no FAIL findings (WARNs allowed), 1 = at least one FAIL.
set -u

VAULT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$VAULT_ROOT" || exit 1
fails=0
pass() { printf 'PASS  %s\n' "$1"; }
warn() { printf 'WARN  %s\n' "$1"; }
failf() { printf 'FAIL  %s\n' "$1"; fails=$((fails + 1)); }

echo "memex-doctor: $VAULT_ROOT"

# 1. Hooks present + executable + wired
for h in session-start-context.sh bump-updated.sh log-mutation.sh; do
  if [ ! -f ".claude/hooks/$h" ]; then failf "hook missing: .claude/hooks/$h"
  elif [ ! -x ".claude/hooks/$h" ]; then failf "hook not executable: .claude/hooks/$h (chmod +x it)"
  else pass "hook installed: $h"; fi
  if [ -f ".claude/settings.json" ] && ! grep -q "$h" ".claude/settings.json"; then
    failf "hook not wired in .claude/settings.json: $h"
  fi
done
[ -f ".claude/settings.json" ] || failf ".claude/settings.json missing (hooks not wired)"

# 2. Required tools
for t in python3 git; do
  command -v "$t" >/dev/null 2>&1 && pass "$t available" || failf "$t not found on PATH"
done
command -v jq >/dev/null 2>&1 && pass "jq available" || warn "jq not found (bump-updated falls back to grep parsing)"
command -v node >/dev/null 2>&1 && pass "node available" || warn "node not found (Quartz site cannot serve)"

# 3. Quartz
if [ -d quartz ]; then
  [ -d quartz/node_modules ] && pass "quartz/node_modules installed" \
    || warn "quartz/node_modules missing — run: (cd quartz && npm install)"
  port="{{QUARTZ_PORT}}"
  if command -v lsof >/dev/null 2>&1; then
    if lsof -ti ":$port" >/dev/null 2>&1; then pass "port $port in use (server likely up)"
    else warn "nothing listening on :$port (server not running; SessionStart hook will start it)"; fi
  fi
else
  warn "quartz/ missing — no local site"
fi

# 4. launchd durable-serve (macOS only)
if [ "$(uname)" = "Darwin" ] && command -v launchctl >/dev/null 2>&1; then
  if launchctl list 2>/dev/null | grep -q "com.memex.quartz.{{VAULT_NAME}}"; then
    pass "launchd agent loaded: com.memex.quartz.{{VAULT_NAME}}"
  else
    warn "launchd agent not loaded (optional; see scripts/launchd/ to install)"
  fi
fi

# 5. Engine state
[ -f ".memex/manifest.json" ] && pass ".memex/manifest.json present" \
  || failf ".memex/manifest.json missing — updates will not work (re-run init or the reconcile prompt)"
if [ -f ".gitignore" ] && grep -q "^\.memex/$" .gitignore; then pass ".memex/ gitignored"
else warn ".memex/ not gitignored — your answers (emails, paths) could be committed"; fi
[ -f "log.md" ] && pass "log.md present" || failf "log.md missing (mutation log seed)"

echo
if [ "$fails" -gt 0 ]; then echo "doctor: $fails FAIL finding(s)"; exit 1; fi
echo "doctor: healthy (warnings above, if any, are non-fatal)"
exit 0
```

`chmod 755` it.

- [ ] **Step 2: Install in `bake_engine`** (after the launchd block):

```python
    extra_scripts = engine_dir / "hardened/scripts"
    if extra_scripts.exists():
        for fp in extra_scripts.iterdir():
            if fp.is_file():
                dst = target / "scripts" / fp.name
                bake_file(fp, dst, answers, normalized)
                result.record(dst.relative_to(target), "hardened", fp)
```

`scripts/**` already classifies as framework code in engine_layout.json, so the manifest/update flow handles it with no further change.

- [ ] **Step 3: derive.py comment** — extend the hand-curated NOTE (near line 120) to mention `hardened/scripts/` is also hand-curated and never wiped/derived.
- [ ] **Step 4: test_init.sh** — add: `[ -x "$TMP/core/scripts/memex-doctor.sh" ] || fail "memex-doctor not installed"` and run it: `(cd "$TMP/core" && ./scripts/memex-doctor.sh >/dev/null) || fail "doctor reports FAIL on a fresh vault"`.
- [ ] **Step 5: Run `tests/test_init.sh`; commit** `feat: ship memex-doctor vault diagnostics script`

---

### Task 17: Full verification + backport record + README

**Files:**
- Create: `docs/BACKPORT.md`
- Modify: `README.md` (if not already done in 11/13/15)

- [ ] **Step 1: Run the complete suite and fix any stragglers:**

```bash
(cd tools && python3 -m unittest)
tests/test_init.sh
tests/test_update.sh
python3 tools/audit_literals.py ./packs
python3 tools/audit_literals.py ./hardened
python3 tools/audit_refs.py .
bash -n hardened/hooks/*.sh hardened/scripts/memex-doctor.sh packs/pi/scripts/build_cv.sh
```

- [ ] **Step 2: Write `docs/BACKPORT.md`** listing every derive-managed file changed in this branch (hooks ×3, settings.json, gitignore, quartz handlers.js/config/package.json, plist+serve mode, `packs/pi/scripts/build_cv.sh`, `packs/core/schemas/_types.md`) with one line each on what must be mirrored into the source vault before the next `derive.py` run — otherwise re-derive clobbers these fixes. Note that `derive.py` now fails loudly on unknown sections and handles `scripts`, so the source vault needs `scripts/build_cv.sh` added.

- [ ] **Step 3: Commit** `docs: backport checklist for derive-managed fixes`

---

## Self-Review Notes

- Task 1 must land first (it validates later bake fixes). Tasks 4→5 and 6→7→8 are ordered dependencies. Tasks 9-14 are independent of each other but depend on Task 4's test-expectation updates landing first (plist name). Task 15 depends on 5/13/14 (gate goes clean). Task 16 depends on 4 (normalized bake signature).
- Deliberately NOT done: prepare-time `--plan` is removed rather than guarded (footgun removal); finalize still re-bakes rather than reusing the retained staged tree (correctness over the micro-opt — engine-match check makes it safe but re-bake is simpler); `ensure_gitignore_entries` double call left (idempotent, needed in both call paths); `hardened/quartz/Dockerfile` left as vendored upstream.
- Existing vaults updated to this engine keep their already-tracked `.memex/manifest.json` in git history; the gitignore change protects new installs and stops future commits. Worth a line in BACKPORT.md.
