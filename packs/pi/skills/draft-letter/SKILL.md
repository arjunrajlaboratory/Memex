---
name: draft-letter
description: Conversationally draft a new letter of recommendation / cover letter / nomination — ask 3–4 setup questions (target category, FERPA waiver, relationship type, what to emphasize), seed from prior letters for the same recipient (read off the local Google Drive Desktop mount), draft a positioning-aware first version with embedded clarifying questions, refine after the user answers, mail-merge onto letterhead, deliver the final .docx into the recipient's Google Drive folder via the local synced mount, and create the matching Atlas/Letters/<...>.md typed note. Use whenever the user says "draft a letter of rec for X", "write the MD letter for Jordan", "draft Y's national scholarship letter", "start a nomination letter for Z", "write a cover letter for ...", or direct invocation "/draft-letter". For ingesting an EXISTING pile of letters, use /ingest-letters instead. Reads and writes go through the local filesystem (the letters tree is synced via Google Drive Desktop); the Google Drive MCP is a fallback only.
---

# Draft a new letter (conversationally)

You are running as **`agent:executor:writer`** for this skill. The user wants a new written ask drafted: letter of rec, cover letter, nomination, reference. Unlike a one-shot generator, this skill **asks questions, drafts, then asks more questions, then refines** — a `generate -> clarifying_questions -> refine` flow.

## Why this skill exists

Letters of rec are high-context: the seeds are years of prior letters for the same person, the FERPA waiver decides how candid the tone can be, and "are they a lab member or a student in my class" decides whether to emphasize research or coursework. A blank-prompt LLM call gets the structure right but misses these signals. The conversational flow surfaces them up-front, then iterates once after the draft to catch what only becomes visible AFTER reading a first pass.

It also enforces the **don't-paste-letter-body-into-the-vault** invariant from `_schemas/letter.md` — the Drive Doc is the letter; the Letter note is metadata + reasoning.

## Drive access — the local filesystem is canonical (READ THIS FIRST)

The entire `recommendation_letters/` Drive tree is synced to this Mac via Google Drive Desktop. **Always read and write through the local filesystem — not the Google Drive MCP.** The MCP's `create_file` hangs on org-locked permissions (see Step 7c), and its folder operations are unreliable; the local mount has none of those problems, and Google Drive Desktop syncs every change up automatically.

```
LETTERS_ROOT="{{USER_HOME}}/Library/CloudStorage/{{DRIVE_MOUNT}}/My Drive/recommendation_letters"
```

- **Find / list recipient folders** → `ls "$LETTERS_ROOT"` (Step 1), not MCP `search_files`.
- **Read seed letters / CVs / exemplars** → `Read` + `pdftotext` on `$LETTERS_ROOT/...` (Step 3), not MCP `read_file_content`.
- **Create a recipient folder** → `mkdir -p "$LETTERS_ROOT/<Recipient>"` (Step 1), not an MCP folder-create.
- **Deliver the finished letter** → `cp` the merged `.docx` into `$LETTERS_ROOT/<Recipient>/` (Step 7b); the sync daemon pushes it to Drive — no `create_file` needed.
- **File the candidate's supporting materials** → `mv` them into a `<descriptor> materials/` subfolder of `$LETTERS_ROOT/<Recipient>/` (Step 0c); never leave them loose in `Inbox/`.

The Google Drive MCP (`search_files` / `read_file_content` / `create_file`) is now a **fallback only** — use it if the local mount is missing or not yet synced (e.g., on a different machine). The per-folder Drive IDs for that fallback are recorded in `Atlas/Letters/index.md`; the parent `recommendation_letters` folder ID is `{{LETTERS_DRIVE_ID}}`. (Grants/proposals are synced the same way at `.../My Drive/Grants and ideas/` — see [[Grants]] — but that tree is out of scope for this skill.)

## Inputs (minimum)

- **Recipient** (required) — Person Display Name or `[[Wikilink]]`.
- **Program** (required) — "MD", "MD-PhD", "National Scholarship", "Faculty Position", etc. Together with recipient + cycle_year this is the unique key.

Everything else (target_category, waived_rights, is_lab_member, skills_tags, due_date, submission_portal) is collected in Step 2 via the structured Q&A. If recipient or program is missing, ask once and proceed.

## Step 0 — Orient (silent)

Read in parallel:

- `_schemas/letter.md` — the contract you'll write to.
- `Atlas/People/<Recipient>.md` — relationship context, capabilities, important personal context.
- `Atlas/Letters/<Recipient> - *.md` — every existing Letter note for this recipient. Extract `artifact_drive_id`, `target_category`, `waived_rights`, `is_lab_member`, `skills_tags` so you can pre-populate the questions with sensible defaults.
- Last ~10 lines of `log.md`.

**Also: broad Gmail sweep on the recipient's name standalone.** Don't just search letter-related keywords — search the bare name and email in both directions, e.g. `"Recipient Name"` and `(from:<recipient-email> OR to:<recipient-email>)`. The goal is to surface prior relationship context the user may not mention up front before you draft the relationship paragraph. Cheap to run, expensive to skip.

If the Person note doesn't exist:
- **For `target_category` ∈ {rec_letter, undergrad_admission, grad_school_admission, grad_school_fellowship, med_school_admission, law_school_admission, postdoc_fellowship} → BLOCKING.** Stop and recommend `/ingest-person`. The draft would be context-free; the Person note holds the relationship history these letters live and die on.
- **For `target_category` ∈ {tenure_promotion, full_prof_promotion, faculty_search, award_nomination, green_card_support} → SOFT.** The candidate's CV + research/teaching/service statements are the authoritative source for these letters, not your relationship history. Proceed without a Person note, but flag at the end that the user may want to run `/ingest-person` after the letter is sent (the Gmail sweep above will have surfaced what should go in it).

If you don't yet know `target_category` (Step 2 hasn't run), default to BLOCKING and ask the user one early clarifying question to disambiguate before continuing.

If a Letter note already exists for the same `(recipient, program, cycle_year)`, **switch to the Update path (Step 8)** rather than creating a parallel one.

### Step 0b — Materials check (avoid the Gmail-attachment trap)

If the user mentions "the materials are in my email" or you find that the request thread has attachments (CV, dossier, statements, supporting docs):

**The Gmail MCP does not expose attachment-download.** `search_threads` and `get_thread` return attachment metadata (filename, mimeType, attachmentId) but there is no `download_attachment` or `get_attachment_content` tool. You cannot fetch the bytes.

**Fix:** at the START of the skill — before drafting, before clarifying questions — ask the user to drop the materials into `Inbox/`:

> "I can see the CV + dossier are attached to <sender>'s email on <date>. The Gmail MCP can't fetch attachment bytes — could you drop them into `Inbox/` (or paste the text directly)? I'll wait."

Then read them via `pdftotext -layout` (PDFs) or `Read` (markdown / .docx via the unzip-and-strip-XML trick). Don't try to invent the contents, don't ship a half-blind draft, and don't burn turns "trying" the Drive MCP on files that aren't in Drive yet. Once you've read them, file them into the recipient's folder per Step 0c — don't leave them loose in `Inbox/`.

### Step 0c — File the candidate's materials into the recipient's folder

Supporting materials (CV, dossier, research/teaching/service statements, selected publications, the committee's request letter) belong **inside the recipient's letter folder, in a descriptively-named subfolder** — never left loose in `Inbox/`. This keeps each recipient's folder self-contained and matches the user's filing convention.

- **Name the subfolder for the program/category:** `tenure materials/`, `MD application materials/`, `scholarship materials/`, `faculty-search materials/`, etc.
- **Wherever the materials came from** — an `Inbox/` drop (Step 0b), a Dropbox/Drive link you downloaded, or a handed-over folder — once you've read them, move them into the subfolder (create the recipient folder first if needed, Step 1):

```bash
mkdir -p "$LETTERS_ROOT/<Recipient>/<descriptor> materials"
mv Inbox/<staged-materials>/* "$LETTERS_ROOT/<Recipient>/<descriptor> materials/"
```

- If you staged downloads under `Inbox/` only to read them, **clear the staging copy after the move** so the `Inbox/` top level stays clean (its empty-top-level is a vault health signal).
- Record the subfolder path in the Letter note's `related_sources` (Step 9), so the materials are findable next cycle.
- Watch for name collisions: a folder named for the candidate's *last name* may already hold a *different* person. When ambiguous, use the full display name and confirm.

## Step 1 — Find (or create) the recipient's folder — locally

One folder per recipient under `$LETTERS_ROOT`. Find it on the local mount:

```bash
ls -d "$LETTERS_ROOT/"*<Recipient>* 2>/dev/null
```

- **One match** → that's the recipient folder; stash the path.
- **Multiple matches** (common with first-name-only folders) → confirm with the user which one.
- **No match** → create it: `mkdir -p "$LETTERS_ROOT/<Recipient>"`. Google Drive Desktop syncs the new folder up automatically.

Any supporting materials for this letter live in a `<descriptor> materials/` subfolder *inside* this recipient folder (see Step 0c), alongside the delivered `.docx`.

(Fallback only, if the local mount is unavailable: MCP `search_files(query: "title contains '<Recipient>' and mimeType = 'application/vnd.google-apps.folder'")`, then `create_file` with `contentMimeType: "application/vnd.google-apps.folder"` under parent `{{LETTERS_DRIVE_ID}}`.)

## Step 2 — Setup questions (conversational, BEFORE drafting)

Use `AskUserQuestion` for the structured ones (radio-style), then a single chat prompt for the open-ended skills/emphasis. Pre-fill defaults from the most recent prior Letter note for this recipient if one exists.

**Question batch 1 — Target category** (one question, 4 options):

```
Q: "What kind of letter is this?"
Options:
  - <most likely from program string, e.g., "Medical school (med_school_admission)">
  - <next most likely, e.g., "MD-PhD admission (grad_school_admission)">
  - <a third common one for this recipient based on prior letters>
  - Other  (auto-added)
```

The 11 valid `target_category` values are in `_schemas/letter.md`. Show the human-readable label; map back to the enum in the frontmatter.

**Question batch 2 — Tone + relationship** (two questions in one AskUserQuestion call):

```
Q1: "Did the candidate waive their right to view this letter (FERPA)?"
Options:
  - Yes — write candidly  (Recommended; default for most letters)
  - No — assume they may read it (be measured)

Q2: "What's the relationship?"
Options:
  - Lab member — emphasize research, publications, contributions  (Recommended for: postdocs, grad students, undergrad researchers)
  - Student — emphasize coursework, class performance, citizenship
  - Other professional relationship (collaborator, mentee outside the lab, etc.)
```

**Question batch 3 — Emphasis (open-ended chat prompt)**:

After the structured Q&A, ask in chat:

> What should this letter emphasize? Give me 3–6 specific things (skills, stories, accomplishments) you want highlighted. If there's a single most important thing — the differentiator — call it out.
>
> Anything to deliberately NOT mention? (e.g., a gap year you don't want to draw attention to, a project that didn't work out, a collaboration that ended badly.)

Parse the response into `skills_tags:` (the 3–6 items) and a "don't mention" list (kept in `# Positioning`).

**Question batch 4 — Logistics (if not already known)**:

If `due_date` and `submission_portal` weren't given at invocation, ask:

> What's the deadline, and how is it submitted? (FolioSystem / AMCAS / email to X / etc.)

## Step 3 — Read the seed letters — locally

The most useful seed is the most recent prior letter for the same recipient. List the recipient's folder (newest first) and identify candidates:

```bash
ls -lt "$LETTERS_ROOT/<Recipient>/"
```

Read the bodies from the local mount:
- `.pdf` → `pdftotext -layout "$LETTERS_ROOT/<Recipient>/<file>.pdf" -` (writes to stdout).
- `.docx` → `Read` (or the unzip-and-strip-XML trick if `Read` returns binary).
- `.md` / `.txt` → `Read`.
- **`.gdoc` → NOT the body.** A `.gdoc` is a tiny JSON pointer holding a `doc_id`; the document content lives Drive-side only. Read the JSON, then fall back to MCP `read_file_content(fileId: <doc_id>)` for that one file.

Also pull:
- The recipient's CV / personal statement / abstract if it's sitting in the folder.
- One older letter for cross-year diff if framings have changed materially.

**Token discipline:** for >3 prior letters, read the most recent 2 in full and just the opening paragraph of older ones.

If zero prior letters, draft from scratch using the Person note + the setup answers. Note this explicitly in the report.

(Fallback only, if the local mount is unavailable: MCP `read_file_content(fileId: <prior letter drive_id>)`.)

### Tier-calibration exemplars: the AI training sets folder

The user maintains a **hand-curated corpus of exemplar letters** at `$LETTERS_ROOT/AI training sets/` (Drive folder id **`EXAMPLEtraining0sets0folder0id000`**, for MCP fallback), organized by letter type. This is the same folder that holds `test_letterhead.docx` (the canonical letterhead template) — i.e., it's the user's curated reference corpus for both letterhead and voice/tone. Each subfolder spans a range of strength tiers within its category, so you can read an exemplar that matches the strength you're actually reaching for.

**Precedence rule (user-stated):** prior letters for the same recipient outrank the AI-training-sets exemplars. Use the training-set exemplars to (a) tier-calibrate when reaching for an unusual strength tier, (b) seed from scratch when there are zero prior letters, or (c) cross-check voice when drafting a letter type you haven't done recently. **Do not let the exemplars override the recipient-specific prior-letter voice unless the user explicitly notes otherwise.**

**`target_category` → subfolder mapping:**

| `target_category` | Subfolder name | Folder ID | Notes on the corpus |
|---|---|---|---|
| `postdoc_fellowship` | Postdoc fellowships | `EXAMPLEpostdoc0fellowship0folder0` | Example exemplar. Voice: warm, specific, concrete examples of efficiency + collaboration. |
| `full_prof_promotion` | Full Professor | `EXAMPLEfull0prof0promotion0folder` | Example exemplar. Voice: "strongest recommendation," "absolutely top notch," scientific anchors with concrete asides. |
| `tenure_promotion` | Tenure letters | `EXAMPLEtenure0promotion0folder000` | Example exemplars spanning the strength range. Use brevity-apology when actually time-pressed; don't insert it gratuitously. |
| `award_nomination` (junior faculty), `faculty_search` (when applied to a junior PI) | Junior faculty awards | `EXAMPLEjunior0faculty0award0folder` | Example corpus for cross-award framing variation — same person, multiple program angles. |
| `grad_school_admission`, `grad_school_fellowship`, `med_school_admission`, `undergrad_admission` | Grad school letters and fellowships | `EXAMPLEgrad0school0letters0folder0` | Example exemplars across the full strength range. When the user picks a strength tier, pick the matching exemplar — don't default to the strongest one. |
| MD-PhD F30 sponsor statement *only* (NIH sponsor template, not a rec letter) | F30 sponsor statements | `EXAMPLEf300sponsor0statement0fold` | Different doc type than a rec letter. Use only if the user is asking for an F30 sponsor statement specifically; the structure is research-support-table + sponsored-trainees list + training plan, not the rec-letter shape. |

For `green_card_support`, `law_school_admission`, and other categories with no matching subfolder, fall back to the closest analog (e.g., `green_card_support` → tenure exemplars for tone of a faculty-level endorsement; `law_school_admission` → grad-school subfolder for tone of a measured admissions letter) and note the substitution in the positioning paragraph.

**When + how to read exemplars:**

1. **Default for letter types with prior recipient letters**: skip the training-set sweep. The recipient's own prior letter is the canonical voice source.
2. **Default for letter types without prior recipient letters (or first time writing for this `target_category` in 12+ months)**: read **1–2 exemplars** from the matching subfolder, picked to match the strength tier the user has reached for in Step 2's setup answers. For ranges like the tenure or grad-school subfolders, choose deliberately — top exemplar (strongest tier) for "strongest possible," middle exemplar (strong tier) for "strong," bottom exemplar (measured tier) for "measured."
3. **Token discipline**: 1–2 exemplars only, even if the subfolder has 5. Reading all of them wastes context and homogenizes the draft.
4. **Read in parallel** with the recipient's own prior letters (Step 3 main path) when both apply.

Read these locally too: the subfolders live at `$LETTERS_ROOT/AI training sets/<Subfolder name>/`. `ls` the subfolder, then `Read` / `pdftotext` the exemplar — same local-first pattern as the prior-letter reads. (Fallback only: MCP `read_file_content` on the file ID from `search_files(query: "parentId = '<subfolder ID>'")`.)

## Step 4 — Position + draft

Write a short **positioning** paragraph (3–5 sentences) capturing:
- The angle this letter takes for THIS specific program + target_category.
- The differentiator we lean on (from the user's "single most important thing" answer).
- What gets less airtime than in prior letters (and why).
- What we're deliberately NOT mentioning (from question batch 3).

Then draft the letter as markdown / plain text. Length and structure mirror prior letters' conventions for this user. **Honor `waived_rights`**:
- `true` → can be candid, can name weaknesses constructively, can compare to peer set.
- `false` → measured, no comparative ranking, no weakness commentary, no patient/student health info.

**Honor `is_lab_member`**:
- `true` → research depth, methods, ownership of projects, publications, presentations, grant contributions.
- `false` → classroom performance, problem set / exam quality, class discussion, office-hours conduct, written work.

Don't invent stories. Every concrete claim traces to: a prior letter for this recipient, the Person note's `# Important personal context`, an Interaction, or the user's answers in Step 2.

### Voice calibration

The user's letter voice is **declarative and unhedged at the actual strength of the case**. Drafts get mis-calibrated in two opposite directions — overshoot (reach for letter-of-rec-corpus superlatives for a measured case) and undershoot (hedge a strong case with "I find" / "begun to" / "more modest than X"). Both fail the same way: the voice stops matching what the user actually thinks. The rules below are the concrete patterns the user has corrected at least once.

1. **Never lead with what something *isn't*.** "Not flashy, but careful" is backhanded even with the recovery clause — the audience has already absorbed "not flashy" by the time the "but" arrives. Substitute the positive property directly. A draft that opened "Their work is not the most theoretical, but it is impeccably executed" reads better as "Their work is impeccably executed, with a consistent emphasis on rigor."

2. **Calibrate the top-line to the actual case, not to genre defaults.** Honest-positive cases get "enthusiastically recommend" + "solid, thoughtful." Strong cases get "without reservation" + "outstanding." Reserve the superlatives for when they're earned. For a solid-but-not-exceptional applicant, a draft reaching for "without reservation / outstanding clinician / the quality I most want in a future colleague" should pull back to "enthusiastically recommend / capable, conscientious / a fine clinician." The corpus pressure on rec-letter prose pushes toward superlatives — resist it unless the case actually merits them; reserve "highest possible endorsement" for genuinely top-tier candidates (major-scholarship context, first-author-level work).

3. **Reduce em-dash density.** Two em-dash parentheticals per paragraph reads as breathless. Default to commas, or to separate sentences, for most parenthetical asides. A draft line "we have overlapped at conferences—though never as direct collaborators—for many years" collapses to "we have overlapped at conferences for many years, though never as direct collaborators." One comma replaces the parenthetical and the sentence breathes. Long em-dashed lists (e.g., around a string of journal names) read better as a comma series.

4. **Prefer present-perfect over simple present for accomplishments.** "She has brought deep methodological expertise" reads more like the writer's voice than "she brings deep methodological expertise." Small, cumulative across a letter — prefer "in which she has led…" over "where she leads…". Apply present-perfect as the default tense for completed bodies of work.

## Step 5 — Generate clarifying questions BEFORE pushing

After drafting, surface 2–4 **clarifying questions** the user should answer before the letter is ready to push. Each question targets a specific paragraph or claim — not generic "anything else?" filler.

Format each as:
- **id**: short slug
- **question**: the actual question
- **why I'm asking**: 1 sentence — what changes in the letter depending on the answer
- **relevant section**: which paragraph it affects

Example:
```
1. id: leadership_anecdote
   question: "Did Jordan actually lead the journal club, or just attend regularly?"
   why: "Paragraph 2 currently says 'led' — if it was more 'attended', I should soften."
   relevant section: Body paragraph 2 (leadership)

2. id: paper_status
   question: "Is the eLife paper accepted, in revision, or submitted?"
   why: "The closing paragraph says 'forthcoming' — needs the exact stage."
   relevant section: Closing

3. id: differentiation
   question: "Among the ~5 MD-PhD applicants you'll write for this cycle, where does Jordan rank?"
   why: "If top-1 or top-2, the closing line should say so. Currently it's measured."
   relevant section: Closing — final sentence
```

**Display the draft to the user**, then surface the clarifying questions immediately below. Wait for answers before pushing to Drive.

## Step 6 — Refine using the answers

User answers the clarifying questions. Refine the draft in-place — change only the paragraphs the questions targeted, don't rewrite from scratch (preserves the user's prior intent). If an answer surfaces a deeper issue ("actually I wouldn't recommend them at the top level — they're more middle-of-pack"), re-positioning may be needed; in that case, propose a revised positioning paragraph and ask for the green light before redrafting.

After the refine pass, show the user the final version one more time. Ask: **"Push to Drive?"** Wait for explicit yes.

## Step 7 — Mail-merge letterhead + deliver via the synced mount

### 7a. Build the letterhead-merged `.docx` (DEFAULT — this is what the user wants)

The canonical letterhead template is [[Letterhead - Example Lab]] — `test_letterhead.docx`, Drive ID `{{LETTERHEAD_TEMPLATE_ID}}`, at `recommendation_letters/AI training sets/test_letterhead.docx` in Drive (locally synced via Google Drive Desktop at `~/Library/CloudStorage/{{DRIVE_MOUNT}}/My Drive/recommendation_letters/AI training sets/test_letterhead.docx`).

**Do not use any per-recipient subfolder copy of `test_letterhead.docx`** — those are prior sample uses, not the canonical template, and have already had their `[body]` placeholder consumed.

The vault ships a stdlib-only merge script at `scripts/merge_letterhead.py` that replaces the `[body]` placeholder with the letter's date + Re: + body paragraphs while preserving the institutional letterhead, lab logo, signature image, and name/titles block intact.

Steps:

1. Write the letter markdown body to `outputs/letters/_src/<Recipient> - <Program> <Year>.md` — NOT `/tmp/`. (Include the institutional header at top and the closing signature block — the merge script's parser strips them if present, since the template provides both.) `outputs/letters/_src/` is gitignored alongside the rest of `outputs/`, but unlike `/tmp/` it survives reboots and lives next to the artifact it generated; the next time you need to revise, regenerate, or v2 the letter, the markdown source is right there. `mkdir -p outputs/letters/_src` once if the folder is missing.
2. Ensure a local copy of the canonical template exists at `outputs/letters/_template/test_letterhead.docx`. If not: `cp "$LETTERS_ROOT/AI training sets/test_letterhead.docx" outputs/letters/_template/` (with `LETTERS_ROOT` exported per the Drive-access section — the tilde does **not** expand inside quotes, so use the variable or the full absolute path).
3. Run the merge: `python3 scripts/merge_letterhead.py --template outputs/letters/_template/test_letterhead.docx --letter "outputs/letters/_src/<Recipient> - <Program> <Year>.md" --output "outputs/letters/<Recipient> - <Program> <Year>.docx"`.
4. Output lands at `outputs/letters/<Recipient> - <Program> <Year>.docx` (~57 KB; `outputs/` is gitignored except for its `README.md`). This is the file the user wants.

### 7b. Deliver the letter — copy into the synced Drive folder (DEFAULT)

Copy the merged `.docx` straight into the recipient's local folder. Google Drive Desktop syncs it up — no MCP, no permission prompts, no hang:

```bash
cp "outputs/letters/<Recipient> - <Program> <Year>.docx" "$LETTERS_ROOT/<Recipient>/"
```

The synced path **is** the canonical Drive location. On the Letter note (Step 9) set:
- `artifact_path: "$LETTERS_ROOT/<Recipient>/<Recipient> - <Program> <Year>.docx"` — the real, absolute, expanded path.
- `artifact_kind: docx`

`artifact_path` alone satisfies the three-ref requirement in `_schemas/letter.md`. If the user later wants the shareable Drive link, grab it from the Drive UI (or look it up via MCP `search_files`) and backfill `artifact_drive_id` + `artifact_url` on the note.

Iterating? Edit the markdown source at `outputs/letters/_src/<...>.md`, re-run the merge (Step 7a), and re-`cp` over the synced file. Drive keeps version history, so overwriting is safe.

### 7c. Fallbacks (only if the local mount is unavailable)

If `$LETTERS_ROOT` isn't mounted/synced on this machine (different Mac, sync paused):

1. **`SendUserFile` (always works, recommended):** the `.docx` is already at `outputs/letters/<...>.docx` from Step 7a — send it to the user. They drop it into Drive themselves (~10 s) and paste the Drive ID back; you backfill `artifact_drive_id` + `artifact_url`. (The user usually wants a local `.docx` for FolioSystem submission anyway.)
2. **MCP `create_file` (last resort — frequently hangs):** `create_file`/`copy_file` are often org-policy-locked to "Needs approval" while `"skipAutoPermissionPrompt": true` suppresses the dialog, so the call waits for an approval that's never asked and hangs forever — no error, no timeout. If it hasn't returned in ~30 s, do **NOT** retry; fall back to `SendUserFile`. Diagnose with `cat ~/.claude/settings.json | grep skipAutoPermissionPrompt` (if `true`, that's the cause).

   ```
   mcp__claude_ai_Google_Drive__create_file(
       title: "<Recipient> - <Program> <Year>",
       base64Content: <base64 of the .docx — `base64 -i ... | tr -d '\n'`>,
       contentMimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
       disableConversionToGoogleType: true,
       parentId: "<recipient folder Drive ID from Atlas/Letters/index.md>"
   )
   ```
   On success, capture `id` (= `artifact_drive_id`) + `webViewLink` (= `artifact_url`) for Step 9.

## Step 8 — Update path (revising a draft that already exists)

If Step 0 found an existing Letter note for the same `(recipient, program, cycle_year)`:

With the local mount, a revision is just **re-merge and re-copy** — edit the markdown source at `outputs/letters/_src/<Recipient> - <Program> <Year>.md`, re-run `scripts/merge_letterhead.py` (Step 7a), and `cp` the new `.docx` over the synced file at `$LETTERS_ROOT/<Recipient>/`. Google Drive keeps its own version history, so overwriting is safe and `artifact_path` stays stable.

- **Surgical edits** ("add Grant's latest paper") → re-merge + overwrite in place. Add a `# Work log` entry noting what changed.
- **Material rewrites** ("redo the positioning for the MD-PhD angle") → re-merge to `<Recipient> - <Program> <Year> - v2.docx` alongside the original so the user can compare, then let them pick. Add a v2 `# Work log` entry.

(MCP-fallback note: the Drive MCP has no update-in-place for a Doc's content — which is the whole reason the local-mount overwrite path is preferred.)

For revisions, still run the **clarifying-questions** beat (Step 5) — even small edits often surface a question the user hadn't thought of.

**Person-note backlink also updates on revision** — Step 10 still runs. If the revision changed status (e.g., draft → submitted), the existing `## Letters` line on the Person note must be updated to reflect the new status; don't leave a stale `drafting` annotation pointing at a letter that's already gone out.

Never delete or overwrite the prior Drive file via the MCP.

## Step 8.5 — Letterhead output is already the default (Step 7a)

Letterhead formatting is no longer a separate ask: **Step 7a always mail-merges onto the canonical letterhead** via `scripts/merge_letterhead.py`, producing a signed-letterhead `.docx` ready for portal submission. Nothing extra to do here for the normal flow.

If the user has another drafting app outside the vault, treat its export as an input artifact and still prefer the local `scripts/merge_letterhead.py` path for the final letterhead `.docx`.

## Step 9 — Create / update the Letter note

Path: `Atlas/Letters/<Recipient> - <Program> <Year>.md`. Conform to `_schemas/letter.md`.

Critical frontmatter to populate from the conversational answers:
- `recipient`, `program`, `cycle_year`, `due`, `submission_portal`, `institution`
- `target_category` — the enum value from Q1
- `waived_rights` — from Q2.1
- `is_lab_member` — from Q2.2
- `skills_tags` — the 3–6 items from question batch 3
- `status: drafting`
- `artifact_path` (the synced `$LETTERS_ROOT/<Recipient>/...docx` path, expanded) + `artifact_kind: docx` — from Step 7b. Backfill `artifact_drive_id` + `artifact_url` later only if the user wants the share link (or you took the MCP fallback).
- `prior_letter: "[[<most recent prior Letter note>]]"` if any
- `sensitivity: private` (default; never lower)

Body sections:
- `# Positioning` — the 3–5 sentences from Step 4, plus the explicit "deliberately NOT mentioning" list (1–3 bullets).
- `# Highlights` — bullet list: specific stories, data points, projects this letter cites. Lets future-you (or next cycle's `/draft-letter`) cross-check.
- `# Weaknesses considered` — REQUIRED when the user explicitly asked you to flag weaknesses (e.g., "flag any weaknesses I might need to comment on"), and STRONGLY RECOMMENDED for tenure / promotion / award-nomination letters even when not asked. Bullet list, one bullet per candidate concern. Each bullet: (a) the concern in one sentence, (b) how you addressed it in the letter — softened, omitted, framed against context, addressed directly — or whether you flagged it to the user as something they may want to comment on separately. This is the audit trail for why the letter says what it says about thin spots; the next time you write for this person, future-you reads this first.
- `# Clarifying questions answered` — list each question + the user's answer. Audit trail for why the letter says what it says.
- `# Submission notes` — portal, format, word limit, who actually submits. ALSO include the path to the markdown source: `Letter source: outputs/letters/_src/<Recipient> - <Program> <Year>.md` so future revisions/regenerations can edit the markdown rather than the .docx.
- `# Work log`:
  ```
  - <today> — drafted via /draft-letter (conversational). Seed letters: [[<prior 1>]], [[<prior 2>]]. Setup answers: target_category=<x>, waived_rights=<y>, is_lab_member=<z>. Clarifying questions: <N>. Delivered .docx into the synced Drive folder: <artifact_path>.
  ```

## Step 9.5 — Create submission-tracking Followup (close-loop gate)

Letters live at `status: drafting` until the user submits — but submission happens off-vault (email send, portal upload) with no signal back to the vault. Without a tickler, Letter notes silently rot at `drafting` past their deadline. The fix is a paired Followup that surfaces in the briefing 2 days before the deadline.

Create `Ops/Followups/Submit <Recipient> - <Program> <Year>.md`:

```yaml
---
type: followup
id: fup-submit-<recipient-slug>-<program-slug>-<cycle-year>
status: pending
surface_on: <max(due - 2, today + 1)>   # 2 days before deadline, but never earlier than tomorrow
about: "[[<Recipient> - <Program> <Year>]]"
reason: "Confirm the <program> letter for <recipient> has been submitted to <submission_portal>. Vault state moves drafting → submitted only when the user signals; this is the tickler."
suggested_action: |
  If submitted:
    1. Edit `Atlas/Letters/<Recipient> - <Program> <Year>.md` — set `status: submitted` + `submitted: <YYYY-MM-DD>`.
    2. Append a `# Work log` entry recording the submission timestamp + channel.
    3. Update the Person note's `## Letters` line to reflect the new status.
    4. Mark this followup `status: acted_on` and log the closure.
  If not yet submitted: nudge surface_on out by 1 day; if past due, escalate by adding a § 0 line to today's briefing.
sensitivity: private
created: <today>
updated: <today>
---

# Why I want to remember this

<2–3 sentences naming what the user needs to do at the portal/email, and what blocks if the letter doesn't go.>

# Context

- Recipient: [[<Recipient>]]
- Program: <Program>
- Cycle year: <year>
- Submission portal: <submission_portal value>
- Deadline: <due>
- Artifact: <artifact_path or artifact_url>
```

If `due:` is unknown (rare — usually surfaced in Step 2), set `surface_on: <today + 7>` and add an `# Open questions` section noting "deadline unknown — ask user."

`observe-task-actuals` will also try to auto-detect the submission from Gmail (sent-to portal email + inbound portal-confirmation receipts); if it succeeds, it proposes the status change directly and the Followup closes as `acted_on` automatically. The Followup is the human-readable safety net for when the Gmail signal doesn't fire (FolioSystem / GrantPortal confirmations may not land cleanly in inbox-search results).

## Step 10 — Backlink from the Person note (REQUIRED — never skip)

The Person note is the human-readable index of every letter for a recipient. **Every new-create AND every status-change revision runs this step.** Append to the Person note's `## Letters` section (create if missing, near the bottom before `# Last reviewed`):

```markdown
- [[<Recipient> - <Program> <Year>]] — <status>, due <date>
```

On revisions that change the letter's status (e.g., `drafting → submitted`), update the existing line in-place to reflect the new status — don't leave a stale `drafting` annotation pointing at a letter that's already been submitted. If the existing line is identical, you can skip; if any field on the line differs, update it.

If the Person note doesn't exist (an edge case — Step 0 should have caught this), abort the step and flag the user to run `/ingest-person` before continuing.

## Step 11 — Log

```
<datetime> — agent:executor:writer — draft — [[<Recipient> - <Program> <Year>]] — Delivered .docx into the synced Drive folder (<artifact_path>); seeded from <N> prior letter(s); <M> clarifying questions resolved. target_category=<x>, waived_rights=<y>, is_lab_member=<z>.
```

## Step 12 — Open in browser

Open the finished `.docx` directly (that's what the user wants to see):

```bash
open "$LETTERS_ROOT/<Recipient>/<Recipient> - <Program> <Year>.docx"
```

(If you took the MCP fallback and have an `artifact_url`, `open "<artifact_url>"` instead.)

And the Letter note in local Quartz so they can verify the metadata capture:

```bash
if ! lsof -ti :{{QUARTZ_PORT}} >/dev/null 2>&1; then
  ( cd {{VAULT_PATH}}/quartz && npm run site:serve > /tmp/quartz-serve.log 2>&1 & disown )
  for i in 1 2 3 4 5 6 7 8 9 10; do sleep 1; lsof -ti :{{QUARTZ_PORT}} >/dev/null 2>&1 && break; done
fi
open "http://localhost:{{QUARTZ_PORT}}/Atlas/Letters/<Recipient> - <Program> <Year>"
```

## Step 13 — Report back

```
Drafted [[<Recipient> - <Program> <Year>]] (status: drafting, due: <date>).

Setup:
- target_category: <x>
- waived_rights: <y>  (tone: <candid | measured>)
- is_lab_member: <z>  (emphasis: <research | coursework>)
- skills emphasized: <3–6 tags>

Seed letters: <N> read (most-recent: [[<prior>]])
Clarifying questions: <M> asked, all answered.
Positioning: <one-line summary>

Letter (.docx): <artifact_path>  (synced to Drive automatically)

Next:
- Open the doc, do a final read-through.
- Submit via <submission_portal> when ready.
- Submission tracker Followup created at `Ops/Followups/Submit <Recipient> - <Program> <Year>.md`, will surface in the briefing 2 days before deadline. /observe-task-actuals also scans Gmail for the send + portal-confirmation receipts and will propose the status change automatically if it sees either signal.
```

## What this skill does NOT do

- **Does not paste the letter body into the Letter note.** Drive Doc is canonical; the note is metadata + reasoning.
- **Does not skip the clarifying-questions beat.** Even a "quick" letter benefits from one round. Set the bar low (2 questions minimum) but always do it.
- **Does not auto-submit.** Status stays `drafting` until the user explicitly closes.
- **Does not destroy prior versions.** Revisions overwrite the synced `.docx` (Drive keeps version history) or write a parallel `- v2.docx`; material rewrites always go to v2 so the original survives.
- **Does not lower sensitivity.** Letter notes are `sensitivity: private`. Privacy filter strips them from public build.
- **Does not invent stories.** Every claim traces to: a prior letter, the Person note's `# Important personal context`, an Interaction, the user's Step-2 answers, or attached CV / personal statement. No fabrication.
- **Does not write across the waiver boundary.** If `waived_rights: false`, no comparative ranking, no weakness commentary, no patient/student health info — even if the user asks for it. Push back and offer to redraft the candid version separately (which the user can keep private, but the on-the-record letter stays measured).

## Model recommendation

**Opus.** Letter drafting is judgment-heavy: identifying what to lift from prior letters, recognizing what to drop, asking the right clarifying questions. Sonnet starts hallucinating specifics; Haiku produces generic prose. The Drive-read step (Step 3) could fan out to Sonnet sub-agents if there are 4+ prior letters and they're long; the synthesis stays on Opus.

## Related

- `_schemas/letter.md` — the schema you're writing to, and source of the `target_category`, `waived_rights`, and `is_lab_member` semantics.
- `Agents/Prompts/draft-letter.md` — the paste-able prompt equivalent.
- `/ingest-letters` — for one-time bulk ingest of existing letters.
- `/ingest-person` — call first if the recipient has no Person note.
- `mcp__claude_ai_Google_Drive__create_file` / `read_file_content` / `search_files` — Drive tools.
