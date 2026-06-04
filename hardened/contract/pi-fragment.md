## Letters / CV / Grants (PI pack)

This fragment is injected at the `<!-- PI_CONTRACT_FRAGMENT -->` marker in
`AGENTS.base.md` and `CLAUDE.base.md` during `memex_init.py` when the PI pack
is selected. It adds all letter-of-recommendation, CV, and grant-related
conventions that are specific to the academic-PI workflow.

---

### Skills (PI pack additions)

The following skills are added on top of the core skill set:

| Skill | Triggers on | What it does |
| --- | --- | --- |
| `ingest-letters` | "ingest my letters folder", "pull my letters of rec into the vault", "index this Drive folder of letters" | Walks the canonical letters Drive folder (`recommendation_letters`, ID `{{LETTERS_DRIVE_ID}}`), classifies each file by `(recipient, program, cycle_year)`, dedupes Doc+docx pairs, writes one `Atlas/Letters/<...>.md` per canonical letter (parallel Haiku sub-agents for >10), and produces a cleanup report at `Ops/Followups/letter-ingest-<date>.md`. Never moves bytes; never auto-creates Person notes (surfaces them for `/ingest-person`). |
| `draft-letter` | "draft a letter of rec for X", "write the MD letter for Jordan", "start a nomination letter" | **Conversational** — 3 setup Q batches (target_category / FERPA waiver / lab-member vs student / what to emphasize), then seeds from prior letters via the local Drive mount, drafts a positioning-aware version, surfaces 2–4 clarifying questions tied to specific paragraphs, refines on the answers, and delivers the final `.docx` to the recipient's synced folder. Letter note carries `# Positioning` + `# Highlights` + `# Clarifying questions answered`. Uses a `generate -> clarify -> refine` flow. |
| `cv-scan` | "scan for CV items", "update my CV", "what's missing from my CV", "any new CV items" | Scans Gmail + Calendar + vault signals for CV-worthy events (talks, papers, awards, service), dedupes against the canonical `CV/*.tex`, and appends paste-ready LaTeX snippets to [[CV candidates]]. Propose-only; never edits the `.tex`. Feeds the [[cv-items]] tracker on a weekly cadence. |
| `cv-build` | "build my CV", "compile the CV", "make the short CV PDF", "generate the NIH CV variant" | Builds a CV variant PDF into `outputs/cv/` via `scripts/build_cv.sh`. Variants are `CV/variants/<name>.tex` drivers (section include/exclude); surfaces the resulting PDF. |

---

### Generated artifacts — letters and CV (`outputs/`)

Additional subdirectory conventions (PI pack only):

- `outputs/letters/<Recipient> - <Program> <Year>.docx` — letterhead-merged `.docx`s produced by `/draft-letter` via `scripts/merge_letterhead.py`. Letter notes' `artifact_path:` field points here.
- `outputs/letters/_template/test_letterhead.docx` — local copy of the canonical letterhead template (canonical lives at Drive ID `{{LETTERHEAD_TEMPLATE_ID}}`, `recommendation_letters/AI training sets/test_letterhead.docx`). Re-synced from Google Drive Desktop by `/draft-letter` when needed.

The pattern: **typed vault notes hold metadata + reasoning; binary artifacts live in `outputs/` locally and in Google Drive canonically.** Don't paste artifact bodies into typed notes — and don't commit binaries to git.

---

### Repo-local scripts — letters

- `scripts/merge_letterhead.py` — stdlib-only mail-merge for the lab letterhead `.docx`. Takes a markdown letter + the canonical template + an output path; replaces the `[body]` placeholder paragraph with letter content while preserving the institutional letterhead + lab logo + signature image + name/titles. Invoked by `/draft-letter` Step 7a as the default path for producing letterhead-formatted output. No `python-docx` dependency (works against PEP 668 environments).

---

### Prompts (PI pack additions)

Additional paste-ready prompts in `Agents/Prompts/`:

| File | Purpose | Invoke when |
| --- | --- | --- |
| `ingest-letters.md` | Bulk-index a Drive folder of recommendation letters | One-time, before /draft-letter is useful |
| `draft-letter.md` | Conversationally draft a new letter of rec / cover / nomination | New letter ask comes in |

---

### Letter note quick reference

**Letter note** (`Atlas/Letters/<Recipient> - <Program> <Year>.md`): the typed note is **metadata only** — the actual letter body lives in Google Drive (`recommendation_letters/<Recipient>/`, folder ID `{{LETTERS_DRIVE_ID}}`) and is referenced via the three-ref artifact pattern (`artifact_drive_id` + `artifact_url` + `artifact_path`, at least one required). Frontmatter carries `target_category`, `waived_rights` (FERPA — affects tone), `is_lab_member` (research vs coursework emphasis), `skills_tags`. Default `sensitivity: private`; never lower. Authored by `/draft-letter`, indexed by `/ingest-letters`, surfaced on `/dashboards/letters`. The folder landing page lives at `Atlas/Letters/index.md`.

---

### Authorized external writes (PI pack additions)

In addition to the core-allowed calendar write:

- `/draft-letter` may write a single finished `.docx` into the recipient's local Google Drive Desktop subfolder under `recommendation_letters/` (Drive ID `{{LETTERS_DRIVE_ID}}` for fallback lookup).
- `cv-build` / `scripts/build_cv.sh` writes the compiled CV PDF to the Google Drive Desktop mount at `My Drive/Compiled CVs/` (as `{{OWNER_NAME}} CV - <variant> - <date>.pdf`) on every build. Local-only builds: `CV_NO_DRIVE=1`. This is a local-filesystem write that Drive Desktop syncs — no MCP call.
- No other Drive writes — `/ingest-letters` is read-only, and the rest of the vault never writes to Drive without explicit per-session opt-in.
