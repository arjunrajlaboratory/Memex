# Design: prevent title ↔ filename ↔ wikilink drift

**Issue:** [#5](https://github.com/arjunrajlaboratory/Memex/issues/5) — Note titles with `/` or `:`
silently break wikilink resolution.

**Date:** 2026-06-05

## Problem

Every note-creating skill uses one human-readable string — `<Subject>` / `<Title>` /
`<Name>` — as **both** the on-disk filename stem **and** the wikilink target, with no
sanitization step between them. When that string contains a filesystem-illegal or
Quartz-hazardous character, the filename and the wikilink diverge:

- `/` is illegal in a filename, so the saved file gets a different name than the title; and
  inside `[[...]]` Quartz parses `/` as a **path separator**, so the link resolves to a bogus
  top-level path and 404s.
- `:` is illegal on some filesystems (and reads as a clause separator), so the same drift
  occurs.

A single bad title fans out: the broken wikilink propagates into briefings, interaction notes,
and `log.md`. Nothing enforces `filename == slug(title)`, and `lint` only catches the breakage
after the fact (and doesn't flag the title↔filename mismatch that caused it).

## Goal

One canonical rule, defined once and referenced everywhere, that guarantees:

```
filename stem  ==  title:  ==  every [[wikilink]] target
```

so the only remaining transform a reader/agent must reason about is Quartz's lossless URL
slugification (space → `-`), which is already documented.

Implemented as **prose conventions** — the skills and `lint` are LLM-executed, not code, so the
"canonical function" is a documented rule the agent applies, matching the repo's existing idiom.
No executable code is added (none would be called).

## The canonical rule — `safe_title(title)`

Before a title is used as a filename or wikilink target, sanitize it:

1. ` / ` (spaced slash) → ` and `; any remaining bare `/` → `-`
2. `:` → drop it (and collapse the doubled space it leaves)
3. other filename / Quartz-illegal characters — `\ * ? " < > | # ^ [ ]` — → drop
4. collapse repeated spaces; trim leading/trailing spaces, dots, and dashes

The result is stored **verbatim** in `title:`, used as the filename stem (`<result>.md`), and as
**every** wikilink target `[[<result>]]`. The title that lands in frontmatter is already
filename-safe, so there is nothing left to diverge.

Out of scope (separate, already-correct transforms, left untouched):
- `id: <type>-<slug>` — a lowercase kebab-case slug of the title for the `id:` field.
- The Quartz **URL** slug (space → `-`, ` - ` → `---`, `+` preserved) used only when opening a
  note in the browser.

## Changes

### 1. Canonical rule — single source of truth
- `hardened/contract/CLAUDE.base.md`: add a "Note titles are filenames" subsection defining
  `safe_title`, plus extend the existing **URL slugs** section to name `/` and `:` (and
  `# | ^`) as hazards that a well-formed title never contains.
- `hardened/contract/AGENTS.base.md`: mirror both (it currently has no URL-slug section).
- `packs/core/schemas/_types.md`: add a short "Filenames and titles" convention block (the type
  registry is the natural authority on naming), pointing at the contract docs.

### 2. Wire the rule into every note-creating path
A one-to-two-line pointer at the file-creation step (not a re-derivation of the rule):
- Skills: `create-task`, `capture-decision`, `ingest-source`, `ingest-project`,
  `ingest-person`, `triage-inbox`.
- Prompt: `packs/core/prompts/new-tracker.md`.
- Schemas (one-line `File path:` note): `task`, `decision`, `source`, `project`, `person`,
  `concept`, `tracker`, `idea`, `effort`, `area`, `organization`, `implementation`,
  `commitment`, `ask` — i.e. every schema whose `File path:` is derived from a title/name.

### 3. Strengthen `lint`
- **Check #1 (broken wikilinks):** also flag any `[[...]]` target containing `/ : # | ^` —
  these resolve to bogus paths even when a same-named file exists.
- **New check #20 — Title ↔ filename drift:** for every typed note, the filename stem must equal
  `safe_title(title:)`; flag mismatches as the upstream cause of broken wikilinks. Severity:
  high (it silently breaks links).
- Update count references ("19" → "20") in the files touched: `packs/core/workflows/lint.md`,
  `packs/core/skills/lint/SKILL.md`. Add the new check + the enhanced-wikilink wording to the
  `packs/core/prompts/lint.md` paste mirror.

## Non-goals / noted caveats
- **Pre-existing lint count drift:** `prompts/lint.md` already lists only 15 checks while the
  workflow has 19. Fully resyncing that mirror is out of scope; this PR adds the new check and
  the enhanced wikilink wording and points the prompt at the workflow as canonical.
- **`derive.py` re-derive:** `packs/` is regenerated from a source vault, so the same
  title-safety prose must also be added to the source vault to survive a future re-derive.
  `hardened/contract/` is hand-curated and not clobbered. Called out in the PR description.

## Verification
- `python3 tools/audit_literals.py ./packs` and `./hardened` → AUDIT CLEAN (no instance-fact
  leak introduced).
- `(cd tools && python3 -m unittest)` → `bake()` unit tests still pass.
- `tests/test_init.sh` → full init integration test (core + pi) still passes.
- Manual self-check: grep that no remaining note-creating skill writes `<Subject>.md` /
  `<Title>.md` without a pointer to the canonical rule; the rule text is identical across
  CLAUDE/AGENTS/_types.
