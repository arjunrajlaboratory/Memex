# Prompt: ingest letters

**Claude Code users:** invoke `/ingest-letters` instead — same logic, auto-triggered as a skill from natural-language phrasings (`.claude/skills/ingest-letters/SKILL.md`).

**Role:** agent:librarian

## Parameters

One of:
- `{{drive_folder_id}}` — preferred. Google Drive folder ID containing per-recipient subfolders. For the owner's vault, this is `{{LETTERS_DRIVE_ID}}` (the `recommendation_letters` folder).
- `{{drive_folder_name}}` — folder name to search for.
- `{{local_path}}` — absolute local path to a directory with the same per-recipient layout.

Optional:
- `{{cutoff_date}}` (default = 2 years ago) — letters older than this default to `status: archived`.
- `{{current_cycle_year}}` (default = current calendar year) — letters with this year default to `drafting`.

## When to use

Paste this when you have an existing pile of recommendation / cover / nomination letters (typically a Google Drive folder organized by recipient) and want the vault to index them as typed `Letter` notes. This is a one-shot bulk skill — for writing a new letter, use `Agents/Prompts/draft-letter.md` (or `/draft-letter`) instead.

## Prompt

```text
You are `agent:librarian`.

Before doing anything else, read in full:
- `AGENTS.md`
- `_schemas/letter.md`
- `_schemas/person.md` (you may need to surface missing-Person-note recommendations)

Then ingest the letters using the steps below.

---

**Step 1 — Enumerate the source**

If {{drive_folder_id}} is set, use it directly. Otherwise:
- {{drive_folder_name}}: search Drive for `title contains '{{drive_folder_name}}' and
  mimeType = 'application/vnd.google-apps.folder'`. Pick the right one if multiple.
- {{local_path}}: `find {{local_path}} -type f -not -name '.*'`

For Drive: paginate over `parentId = '<folder_id>'` with pageSize=100. For each per-recipient
subfolder, paginate its children. Collect a flat list of
{drive_id, title, parent_folder_name, mime_type, modified_time, created_time}.

`ls Atlas/Letters/` — if any Letter notes already exist, grep their (recipient, program,
cycle_year) tuples so you skip re-ingesting them later.

---

**Step 2 — Classify each file**

Skip non-letter files BEFORE classifying:
- `test_letterhead.docx` — canonical letterhead template, sometimes duplicated into recipient folders during letter generation. NOT a letter; drop silently.
- `PI-Evaluation_*.pdf`, evaluation forms, completed surveys → belong as `related_sources:` on a Letter note, not as standalone Letters.
- Files < 10 KB that aren't a recognizable letter format → likely stubs.

For each remaining file, infer:

- Recipient — from parent folder name. Normalize to a Person Display Name. Match against
  `Atlas/People/<Name>.md`. No match → flag as `needs_person_note`.
- Program — from filename. Recognize: MD, MD-PhD (also MD/PhD, MSTP), a national scholarship, Phi Beta Kappa,
  Dean's Scholar, Hertz, Rhodes, Marshall, NSF GRFP, Fulbright, Soros, Faculty Position, Tenure,
  Promotion, Sabbatical, Award, Reference, Cover Letter. Unrecognized → flag as
  `needs_program_disambiguation`.
- cycle_year — year in filename; fall back to file `created_time` year. Still ambiguous → flag.
- target_category — derive from program (med_school_admission, grad_school_admission,
  grad_school_fellowship, faculty_search, postdoc_fellowship, tenure_promotion, award_nomination,
  etc.). The valid values are in `_schemas/letter.md`.
- status —
  cycle_year >= {{current_cycle_year}} → drafting
  ({{current_cycle_year}} - 2) <= cycle_year < {{current_cycle_year}} → submitted
  older → archived
  (heuristic — user can correct via the review report)
- artifact_kind — from MIME / extension: vnd.google-apps.document → doc; .docx → docx;
  .pdf → pdf; .md → markdown.
- submission_portal — inferable patterns: `_AMCAS_` → AMCAS; `_FolioSystem_` / `_PF_` →
  FolioSystem; else empty.

For Drive files: set both artifact_drive_id and artifact_url.
For local files: set artifact_path.
For files with both: set all three.

---

**Step 3 — Detect duplicates**

A duplicate is two files with the same (recipient, program, cycle_year). Pick the canonical
(prefer Google Docs > .docx; most recent modified_time; higher version number for v1/v2 pattern).
Flag the other(s) in the report. Don't create parallel Letter notes.

---

**Step 4 — Write the Letter notes**

Path: `Atlas/Letters/<Recipient> - <Program> <cycle_year>.md`. Conform to `_schemas/letter.md`.
Run the assembled title through `safe_title` first (see AGENTS.md → "A note's title IS its
filename"): ` / ` → ` and ` (so `MD/PhD` → `MD-PhD` — programs are the live hazard), drop `:` and
the rest of `\ * ? " < > | # ^ [ ]`, collapse spaces. Filename, `title:`, and every `[[...]]` to
the letter must be identical.
Slug for id: `<recipient-kebab>-<program-kebab>-<cycle_year>`.

Body sections start empty except `# Work log`:
- `<today> — Letter note created via /ingest-letters from <source>. status inferred as <status>; verify in the followup report.`

For >10 letters, parallelize via Haiku sub-agents (5–10 letters per batch).

---

**Step 5 — Backlink from each Person note**

For each Person whose letters were ingested, append to their `## Letters` section (create if
missing, before `# Last reviewed`):

```
## Letters
- [[<Recipient> - <Program> <Year>]] — <status>, due <due | "—">
```

If a Person note doesn't exist, do NOT auto-create — surface in the followup report. (The user
should run /ingest-person which does the Gmail backfill.)

---

**Step 6 — Write the needs-review report**

Path: `Ops/Followups/letter-ingest-<today>.md` per `_schemas/followup.md`.

Sections:
- # Letter ingest review — <today>
- ## Letters created (M) — compact wikilink+status table
- ## Needs your attention:
  - ### Unclassifiable filenames (P) — bullets with Drive ID / file path + inferred guesses
  - ### Suspected duplicates (Q) — grouped by tuple, canonical vs dupe
  - ### Missing Person notes (R) — recipient names without matching Atlas/People/ entries
  - ### Status guesses to verify (S) — letters where status was inferred from cycle_year
  - ### Drive folder cleanup candidates (T) — zero-byte files, "draft 1"/"TEMP"/"OLD" naming,
    orphans not in a per-recipient subfolder
- ## Recommended next moves — run /ingest-person for missing recipients, resolve Drive-side
  duplicates, update statuses

---

**Step 7 — Log**

`<datetime> — agent:librarian — bulk-ingest — Atlas/Letters/ — created M Letter notes from <source> (P unclassifiable, Q dupes, R missing persons). Review: Ops/Followups/letter-ingest-<today>.md`

---

**Step 8 — Report back**

Compact:
- M Letter notes created (Drafting: a / Submitted: b / Archived: c)
- Followup report path
- P unclassifiable, Q duplicates, R missing Person notes
- Recommend: run /ingest-person for the R missing recipients (give up to 5 names)
- T Drive cleanup candidates
```

## Notes

- **Idempotent.** Re-runs match on `(recipient, program, cycle_year)` and skip existing Letter notes — only pick up new files since the last run. Useful workflow: ingest first, use the followup report as a cleanup checklist in Drive, then re-run.
- **No byte-level moves.** This skill walks and indexes; it never moves files in Drive or locally. Drive cleanup is on you.
- **No auto-create of Person notes.** The Gmail-backfill move that `/ingest-person` does is heavier than this skill should attempt. Surface the names; the user (or a separate `/ingest-person` run) handles it.
- **`sensitivity: private`** on every Letter note. Don't lower.

## Related

- Skill: `.claude/skills/ingest-letters/SKILL.md`
- Companion paste-prompt: `Agents/Prompts/draft-letter.md`
- Schema: `_schemas/letter.md`
- Target-category semantics: `_schemas/letter.md`
