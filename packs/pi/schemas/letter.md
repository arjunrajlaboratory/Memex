# Schema: letter

A **Letter** is a deadline-driven written ask on someone's behalf: a letter of recommendation, a cover letter, a nomination blurb, a reference. The actual letter file lives wherever you keep it (typically Google Drive, sometimes local, sometimes both). The Letter note in `Atlas/Letters/` is the **index entry** — it tracks the recipient, the program, the deadline, the submission status, and how to find the file. It does not store the letter body.

File path: `Atlas/Letters/<Recipient> - <Program> <Year>.md` — run the assembled title through `safe_title` first (see `_schemas/_types.md` → "Filenames and titles"): a `MD/PhD` program becomes `MD-PhD`; filename stem = `title:` = every `[[wikilink]]`; no `/ : \ * ? " < > | # ^ [ ]`.

Examples:
- `Atlas/Letters/Jordan Lee - MD 2026.md`
- `Atlas/Letters/Jordan Lee - MD-PhD 2026.md`
- `Atlas/Letters/Robin Park - Faculty Position 2024.md`
- `Atlas/Letters/Dana Soto - National Scholarship 2022.md`

## Frontmatter

```yaml
---
type: letter
id: letter-<slug>
recipient: "[[<Person Display Name>]]"
program: "<MD | MD-PhD | National Scholarship | Phi Beta Kappa | Dean's Scholar | Faculty Position | Tenure | Award | ...>"
cycle_year: 2026                       # the application year, not the year the letter was written
status: drafting                       # drafting | submitted | acknowledged | archived
due: YYYY-MM-DD
submitted: YYYY-MM-DD                  # set when status moves to submitted
submission_portal: ""                  # "FolioSystem: Roe_Jane_MD_2026" | "AMCAS" | "email to xyz@..." | "the undergraduate research office"
institution: ""                        # receiving institution (e.g., "Example Medical Center", "Example University")

# Structured signals that shape the draft and are read by /draft-letter to set tone + emphasis:
target_category: ""                    # undergrad_admission | grad_school_admission | grad_school_fellowship |
                                       # med_school_admission | law_school_admission | postdoc_fellowship |
                                       # faculty_search | tenure_promotion | full_prof_promotion |
                                       # green_card_support | award_nomination
waived_rights: true                    # FERPA — did the candidate waive their right to view? If false, write
                                       # less candidly (assume they may read it). DEFAULT true; verify per letter.
is_lab_member: true                    # true → emphasize research, publications, lab contributions.
                                       # false → emphasize coursework, class performance, classroom citizenship.
skills_tags: []                        # ["independence", "Python", "experimental design", "grant writing", ...] —
                                       # specific qualities to highlight, used for cross-letter consistency.

# At least one of the three refs below MUST be set:
artifact_drive_id: ""                  # Google Drive file ID — canonical (survives Drive renames/moves)
artifact_url: ""                       # Google Drive view URL, or any web URL
artifact_path: ""                      # absolute local filesystem path
artifact_kind: doc                     # doc | docx | pdf | markdown

# Optional cross-refs:
prior_letter: "[[<...>]]"              # the most-relevant prior letter for the same recipient (for /draft-letter seeding)
related_sources: []                    # CV, abstract, transcript, paper they want highlighted — anything used as input
sensitivity: private                   # DEFAULT — letters contain candid evaluation; never publish.
created: YYYY-MM-DD
updated: YYYY-MM-DD
---
```

## Body sections

- `# Positioning` — one paragraph. The angle this letter takes: MD vs MD-PhD framing, research-heavy vs leadership-heavy, what differentiator we lean on. Lets future-you (or `/draft-letter`) understand the slant without re-reading the draft.
- `# Highlights` — bullet list of specific stories, data points, or projects cited in the letter. Useful for cross-letter consistency ("did I already use the scholarship anecdote in the MD letter?").
- `# Weaknesses considered` — optional for rec letters and admissions letters; REQUIRED when the user explicitly asked you to flag weaknesses; STRONGLY RECOMMENDED for `target_category` ∈ {`tenure_promotion`, `full_prof_promotion`, `award_nomination`, `faculty_search`}. Bullet list, one bullet per candidate concern with: (a) the concern in one sentence, (b) how the letter handles it (softened, omitted, framed against context, addressed directly) or whether it was flagged to the user as something they may want to comment on separately. Audit trail for thin-spot reasoning so future-you doesn't have to rebuild the same analysis from scratch next cycle.
- `# Submission notes` — portal quirks (word limit, file format, signature requirements), confirmation receipts, who actually submitted (sometimes the institution submits on the writer's behalf). For letterhead-merged `.docx` artifacts, also record the path to the markdown source (typically `outputs/letters/_src/<...>.md`) so revisions can edit the markdown rather than the `.docx`.
- `# Work log` — append-only. One bullet per material change: drafted, revised after their CV update, submitted, acknowledged.

## Rules

- **`sensitivity: private` is the default and may not be lowered.** Letters contain candid evaluation; they never publish. The privacy filter strips them from the public build.
- **At least one of `artifact_drive_id`, `artifact_url`, `artifact_path` must be set.** A Letter note with no way to find the actual letter is useless. The auditor flags violations.
- **Letter notes are never the source of truth for the letter body.** The Google Doc / .docx is. Never paste the full letter into the note — the note is metadata + reasoning, not content.
- **One Letter per (recipient, program, cycle_year) tuple.** A draft superseded by a revision stays the same note (updated `# Work log`, no new file unless the program itself changes).
- **The librarian must add a backlink** from the recipient's Person note: append to a `# Letters` section (or `letters:` frontmatter list) so a Person page shows everything written for them.
- **Status transitions:**
  - `drafting → submitted`: requires `submitted:` date AND a `# Work log` entry recording the submission.
  - `submitted → acknowledged`: optional; set when you have explicit confirmation from the program (rare).
  - `* → archived`: only after the cycle is fully closed (admit/reject decision made, or the application is withdrawn). The artifact stays in Drive; the note moves to `_archive/Atlas/Letters/`.
- **Editing the artifact:** prefer in-place edits in Drive/local. If the agent generates a revised version it can't write back directly (Drive MCP has no `update_file_content`), it must create a parallel `<title>-v2` file and surface the swap to the user — never silently delete the original.
- **`/draft-letter`** is the canonical author for new Letter notes. Manual creation is allowed but the skill enforces seeding from prior letters in the same recipient's folder.

## Why a typed note (vs. just trusting the Drive folder)

Three things the folder-only setup can't do:
1. **Deadline tracking** — `/run-trackers` and the briefing surface upcoming `due:` dates; overdue `drafting` letters appear on the stale-lens dashboard.
2. **Cross-recipient queryability** — "all letters for MD-PhD this cycle" / "every letter I've written for Riley across programs" via metadata grep, not Drive search.
3. **Person backlink** — the Person note shows the full letter history, which becomes the seed material when the same person asks for another letter two years later.

The Drive folder remains the canonical store of the bytes; the Letter notes are the index that makes the bytes findable, queryable, and auditable.
