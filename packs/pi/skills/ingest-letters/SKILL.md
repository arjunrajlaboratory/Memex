---
name: ingest-letters
description: Walk a Google Drive folder (or local directory) full of recommendation/cover/nomination letters and create one Atlas/Letters/<...>.md typed note per letter per _schemas/letter.md, plus a needs-review report at Ops/Followups/letter-ingest-<date>.md surfacing unclassifiable items and suspected dupes. Use whenever the user says "ingest my letters folder", "pull my letters of rec into the vault", "index this Drive folder of letters", "/ingest-letters", or after a one-time `letters_of_recommendation/` migration. One-shot bulk ingest — for writing a NEW letter, use /draft-letter instead.
---

# Ingest a folder of letters into the vault

You are running as **`agent:librarian`** for this skill. The user has an existing pile of recommendation / cover / nomination letters — typically in a Google Drive folder, sometimes locally — and wants the vault to know about them. Your job: walk the pile, create one `Letter` note per letter, and produce a cleanup report.

## Why this skill exists

The user's letters are already organized one-folder-per-recipient (the structure they like). What they don't have is queryability: "show me all letters due in May," "what programs did I write for Jordan across years," "are there overdue `drafting` letters." A typed `Letter` note unlocks that, but writing them by hand for an N-recipient archive is the kind of mechanical work that doesn't get done. This skill does it.

It also enforces the **don't-store-the-letter-body** invariant (the note is metadata only; the file stays in Drive) and surfaces a **cleanup report** the user can act on to tidy the Drive folder itself.

## Inputs

One of:
- **`{{drive_folder_id}}`** — the Google Drive folder ID containing the per-recipient subfolders. Preferred.
- **`{{drive_folder_name}}`** — the folder name (e.g., "letters_of_recommendation"). The skill will `search_files` to find it.
- **`{{local_path}}`** — an absolute local path to a directory with the same per-recipient subfolder layout.

Optional:
- **`{{cutoff_date}}`** — letters submitted before this date default to `status: archived` (or `submitted`, if you have a way to tell). Default: 2 years ago.
- **`{{current_cycle_year}}`** — letters whose filename year matches this default to `status: drafting`. Default: current calendar year.

If none of the input forms is given, ask which one before proceeding.

## Step 0 — Orient

Read these before any writes:

- `_schemas/letter.md` — the contract for what you're about to produce.
- `_schemas/person.md` — you may need to surface "missing Person notes" recommendations.
- Last ~10 lines of `log.md`.
- `ls Atlas/Letters/` — see what already exists. If the directory doesn't exist, create it.
- `grep -l '^type: letter' Atlas/Letters/*.md 2>/dev/null` — identify any existing Letter notes (so you don't duplicate).

## Step 1 — Enumerate the source

### Drive path

If `drive_folder_id` is set, use it directly. Otherwise:

```
mcp__claude_ai_Google_Drive__search_files(
  query: "title contains '<drive_folder_name>' and mimeType = 'application/vnd.google-apps.folder'"
)
```

Pick the right folder if multiple. With the folder ID, walk its children:

```
mcp__claude_ai_Google_Drive__search_files(
  query: "parentId = '<folder_id>'",
  pageSize: 100
)
```

For each per-recipient subfolder, paginate over its children. Collect a flat list of `{drive_id, title, parent_folder_name, mime_type, modified_time, created_time}`.

### Local path

If `local_path` is set, `find "$local_path" -type f -not -name '.*'` and collect equivalent metadata.

## Step 2 — Classify each file

**Skip non-letter files** before classifying. These are NOT letters and should be excluded from the Letter-note write loop (but flagged in the Drive-cleanup section of the followup report if they look orphaned):
- `test_letterhead.docx` — the canonical letterhead template (see `Atlas/Letters/index.md`). It is sometimes copied into recipient folders during letter generation; it's the template, not a letter. Drop silently.
- `PI-Evaluation_*.pdf`, evaluation forms, completed surveys, and similar supporting documents. These belong in the Letter note's `related_sources:` (cross-reference at most), not as standalone Letter notes.
- Any file < 10 KB that isn't a recognizable letter format (likely a stub / artifact).

For each remaining file, infer:

| Field | How |
| --- | --- |
| **Recipient** | Parent folder name. Normalize to a Person Display Name. Match against `Atlas/People/<Name>.md`. No match → flag as `needs_person_note`. |
| **Program** | Filename pattern. Common shapes: `<Last>_<First>_<Program>_<Year>.{docx,pdf}`, `<Program>_<Year>_<Recipient>.docx`, `<Recipient> - <Program> <Year>.docx`. Recognize: MD, MD-PhD, MD/PhD (→ MD-PhD), MSTP (→ MD-PhD), a national scholarship, Phi Beta Kappa, Dean's Scholar, Hertz, Rhodes, Marshall, NSF GRFP, Fulbright, Soros, Faculty Position, Tenure, Promotion, Sabbatical, Award, Reference, Cover Letter. Unrecognized → flag as `needs_program_disambiguation`. |
| **cycle_year** | Year in filename. If absent, fall back to file `created_time` year. If still ambiguous → flag. |
| **status** | `cycle_year >= current_cycle_year` → `drafting`. `current_cycle_year - 2 <= cycle_year < current_cycle_year` → `submitted`. Older → `archived`. The Drive folder doesn't truly know if it was submitted — these defaults are heuristics. The user can correct in the review report. |
| **artifact_kind** | From MIME / extension: `application/vnd.google-apps.document` → `doc`; `.docx` → `docx`; `.pdf` → `pdf`; `.md` → `markdown`. |
| **submission_portal** | Inferable patterns: `_AMCAS_` → AMCAS; `_FolioSystem_` or `_PF_` → FolioSystem; filename hint of email. Else empty — the user fills in later. |

For Drive files, set both `artifact_drive_id` and `artifact_url` (`https://docs.google.com/document/d/<id>/edit` for Docs, `https://drive.google.com/file/d/<id>/view` otherwise).
For local files, set `artifact_path` (absolute path).
For files with both (a local copy of a Drive doc), set all three.

## Step 3 — Detect duplicates

A **duplicate** is two files with the same `(recipient, program, cycle_year)`. Common causes: a Drive-Doc + an exported `.docx`; v1 + v2; mistakenly re-uploaded. Don't create two Letter notes for these — pick the canonical and flag the other in the report.

**Picking canonical:** prefer Google Docs (live) over `.docx` (export); prefer the most recently `modified_time`; if it's a `v1`/`v2` naming pattern, prefer the higher version.

## Step 4 — Write the Letter notes (parallelize)

For each canonical letter (one per `(recipient, program, cycle_year)`):

Path: `Atlas/Letters/<Recipient> - <Program> <cycle_year>.md`

Slug for `id:` is `<recipient-kebab>-<program-kebab>-<cycle_year>`.

Fill the schema per `_schemas/letter.md`. Body sections start empty except `# Work log`:

```
- <today> — Letter note created via /ingest-letters from <drive folder name | local path>. status inferred as <status>; verify in the followup report.
```

**Dispatch in parallel.** For >10 letters, fan out via Haiku sub-agents (mechanical schema fill is well within Haiku's range). 5–10 letters per sub-agent batch. Wait for all writes, then continue.

## Step 5 — Backlink from each Person note

For each Person whose letters were ingested, append the new Letter wikilinks to the Person note. Convention:

```markdown
## Letters
- [[<Recipient> - <Program> <Year>]] — <status>, due <due | "—">
```

If the Person note doesn't have a `## Letters` section, create one near the bottom (before `# Last reviewed`). If a Person note doesn't exist at all, **do not auto-create it** — surface it in the followup report instead (a Person note needs the Gmail backfill move that `/ingest-person` does, which is heavier than this skill should attempt).

## Step 6 — Write the needs-review report

Path: `Ops/Followups/letter-ingest-<today>.md`. This is a `followup` typed note per `_schemas/followup.md`.

Body structure:

```markdown
# Letter ingest review — <today>

Ingested N letters from <source>. Created M Letter notes (N−dupes). All defaults are guesses — these are the cases that need your eyes.

## Letters created (M)
<a compact wikilink-and-status table>

## Needs your attention

### Unclassifiable filenames (P)
<bulleted list with the Drive ID / file path + inferred guesses + ask: what is this?>

### Suspected duplicates (Q)
<grouped by (recipient, program, year), showing canonical + dupe(s); ask: keep both? merge in Drive? archive dupe?>

### Missing Person notes (R)
<list of recipient names that didn't match Atlas/People/. Recommend running /ingest-person for each.>

### Status guesses to verify (S)
<list of letters where status was inferred from cycle_year heuristic. Spot-check: any "archived" that's actually still drafting? Any "submitted" without a confirmation?>

### Drive folder cleanup candidates (T)
<zero-byte files, "draft 1"/"TEMP"/"OLD" naming, orphaned files not in a per-recipient subfolder. Ask: archive in Drive?>

## Recommended next moves
- Run `/ingest-person` for the R missing Person notes (parallel-safe).
- Resolve duplicates in Drive (the vault won't touch your files).
- Update the status of any letter flagged above.
```

This report is the cleanup lever — the user reads it once, makes Drive-side edits, and optionally re-runs the skill.

## Step 7 — Log the ingest

One canonical line to `log.md`:

```
<datetime> — agent:librarian — bulk-ingest — Atlas/Letters/ — created M Letter notes from <source> (P unclassifiable, Q dupes, R missing persons). Review: Ops/Followups/letter-ingest-<today>.md
```

## Step 8 — Open the report in browser

```bash
if ! lsof -ti :{{QUARTZ_PORT}} >/dev/null 2>&1; then
  ( cd {{VAULT_PATH}}/quartz && npm run site:serve > /tmp/quartz-serve.log 2>&1 & disown )
  for i in 1 2 3 4 5 6 7 8 9 10; do sleep 1; lsof -ti :{{QUARTZ_PORT}} >/dev/null 2>&1 && break; done
fi
open "http://localhost:{{QUARTZ_PORT}}/Ops/Followups/letter-ingest-<today>"
```

## Step 9 — Report back

```
Ingested M Letter notes from <source>.

Atlas/Letters/  +M
- Drafting:  <a>
- Submitted: <b>
- Archived:  <c>

Followup report: [[letter-ingest-<today>]]
- <P> unclassifiable
- <Q> suspected duplicates
- <R> missing Person notes — recommend /ingest-person for: <up to 5 names>
- <T> Drive folder cleanup candidates

Next: open the followup report, resolve the flagged items, and (if you want) re-run /ingest-letters to pick up Drive renames.
```

## What this skill does NOT do

- **Does not delete or move files in Drive or locally.** The user owns the folder; the vault indexes it.
- **Does not modify the letter body.** Letter notes are metadata only.
- **Does not auto-create Person notes.** Missing recipients are surfaced for `/ingest-person`, which has the Gmail-backfill move this skill shouldn't recurse into.
- **Does not lower sensitivity.** Every Letter note is `sensitivity: private` by default. The privacy filter strips them from public builds.
- **Does not draft new letters.** That's `/draft-letter`.
- **Does not re-ingest letters that already have a Letter note** (matched by `(recipient, program, cycle_year)`). Re-runs are idempotent — they only pick up new files since the last run.

## Model recommendation

- Orchestrator (you): **opus**. The classification heuristics are noisy and the dedupe / "is this really the same letter or a different program" judgment matters.
- Sub-agents that write the Letter notes in parallel: **haiku**. Pure schema fill with the classification already done.
- Sub-agents that read file contents (if you can't tell program/year from the filename and need to peek): **sonnet**. Reading the first page or two of a Drive doc/PDF and pulling fields is judgment-light enough for Sonnet but error-prone enough that Haiku stumbles.

## Related

- `_schemas/letter.md` — the schema you're writing to.
- `/draft-letter` — the canonical author for NEW letters (this skill is for ingesting existing ones).
- `/ingest-person` — call this for missing recipients surfaced in the followup report.
- `mcp__claude_ai_Google_Drive__*` — the Drive tools this skill uses to walk the folder.
