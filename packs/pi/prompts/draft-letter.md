# Prompt: draft letter

**Claude Code users:** invoke `/draft-letter` instead — same logic, auto-triggered as a skill from natural-language phrasings (`.claude/skills/draft-letter/SKILL.md`).

**Role:** agent:executor:writer

## Parameters

- `{{recipient}}` — Person Display Name (matches `Atlas/People/<Recipient>.md`).
- `{{program}}` — "MD", "MD-PhD", "National Scholarship", "Faculty Position", "Cover Letter for X postdoc", etc.
- `{{cycle_year}}` (optional, default = current year) — the application cycle.
- `{{due}}` (optional) — deadline as YYYY-MM-DD.
- `{{submission_portal}}` (optional) — "FolioSystem", "AMCAS", "email to X", etc.

If `{{recipient}}` or `{{program}}` is missing, ask once and proceed.

## When to use

Paste this when you want to draft a new letter of recommendation, cover letter, nomination, or reference. For ingesting an existing pile of letters from Google Drive, use `Agents/Prompts/ingest-letters.md` (or `/ingest-letters`) instead. For revisions of an already-drafted letter, this prompt creates a parallel v2 doc since the Drive MCP has no `update_file_content`.

## Prompt

```text
You are `agent:executor:writer`.

Before doing anything else, read in full:
- `AGENTS.md`
- `_schemas/letter.md`
- `Atlas/People/{{recipient}}.md` (the Person note — relationship context, capabilities)
- Every existing Letter note for this recipient under `Atlas/Letters/{{recipient}} - *.md`
  (capture their `target_category`, `waived_rights`, `is_lab_member`, `skills_tags`, `artifact_drive_id` —
   you'll use them to pre-populate defaults and to seed from prior letters)

If the Person note doesn't exist, STOP and tell the user to run /ingest-person for {{recipient}} first.
If a Letter note already exists for (recipient={{recipient}}, program={{program}}, cycle_year={{cycle_year}}),
switch to the Revision path at Step 7.

This is a CONVERSATIONAL skill — you ask questions, draft, ask more questions, refine. Use a
generate -> clarifying_questions -> refine flow.

---

**Step 1 — Find the recipient's Drive folder**

Search Drive for: `title contains '{{recipient}}' and mimeType = 'application/vnd.google-apps.folder'`.
Confirm if multiple matches. If none, create one as a child of the `recommendation_letters` folder
(Drive ID {{LETTERS_DRIVE_ID}}). Stash the folder ID.

---

**Step 2 — Setup questions (BEFORE drafting)**

Ask the user 3 question batches:

(a) "What kind of letter is this?" — show 3 most likely target_category values for {{program}} +
    Other. Map to the enum in `_schemas/letter.md`.

(b) Two questions in one batch:
    Q1: "Did the candidate waive their FERPA right to view this letter?"
        — Yes → write candidly (default); No → measured, no comparative ranking.
    Q2: "Relationship?" — Lab member (emphasize research) / Student (emphasize coursework) / Other.

(c) Open-ended in chat:
    "What should this letter emphasize? Give me 3–6 specific things (skills, stories, accomplishments).
     What's the single most important differentiator? Anything you deliberately want to NOT mention?"

Parse (c) into `skills_tags:` (3–6 items) + a "don't mention" list (keep in Positioning).

If {{due}} or {{submission_portal}} missing, also ask the deadline + portal.

---

**Step 3 — Read seed letters**

Identify the most recent prior letter for this recipient (highest cycle_year, then submitted date).
Read its body via the Drive MCP `read_file_content(fileId: ...)`. Also pull the recipient's CV /
personal statement / abstract if linked in the Letter note's `related_sources` or sitting in the
Drive folder. For >3 prior letters, read the most-recent 2 in full + just the opening of others.

Zero prior letters is fine — note it in the report and draft from the Person note + the Step-2 answers.

---

**Step 4 — Position + draft**

Write a 3–5 sentence positioning paragraph: angle for THIS target_category, differentiator we lean
on (from the user's "single most important thing"), what gets less airtime than prior letters,
what we're deliberately NOT mentioning. (Goes into the Letter note's `# Positioning` section; NOT
in the letter body.)

Then draft the letter as markdown. Length + structure mirror prior letters. Honor `waived_rights`:
true → candid, can name weaknesses constructively, can compare to peer set;
false → measured, no comparative ranking, no weakness commentary.
Honor `is_lab_member`:
true → research depth, methods, ownership, publications, presentations;
false → coursework, problem sets, class discussion, office-hours.

Don't invent stories. Every concrete claim traces to: a prior letter, the Person note's
`# Important personal context`, an Interaction, the user's Step-2 answers, or attached CV.

---

**Step 5 — Generate clarifying questions (BEFORE pushing to Drive)**

After drafting, surface 2–4 clarifying questions — each tied to a specific paragraph or claim.
Format: id / question / why I'm asking (one sentence) / relevant section.

Show the user the draft, then surface the clarifying questions. WAIT for answers.

---

**Step 6 — Refine + confirm push**

Refine the draft using the user's answers — change only the paragraphs the questions targeted.
If an answer reveals a deeper positioning issue, propose a revised positioning paragraph and ask
for green light before redrafting.

Show the final version. Ask: "Push to Drive?" Wait for explicit yes.

---

**Step 7 — Mail-merge letterhead + push to Drive (with fallback for permission blocks)**

Default output: letterhead-merged Word .docx (user wants signed/letterhead version for submission).

Canonical letterhead: `recommendation_letters/AI training sets/test_letterhead.docx`
(Drive ID `{{LETTERHEAD_TEMPLATE_ID}}`, locally at
`~/Library/CloudStorage/{{DRIVE_MOUNT}}/My Drive/recommendation_letters/AI training sets/test_letterhead.docx`).
Do NOT use any per-recipient `test_letterhead.docx` copies — those are sample uses, not the canonical template.

Vault ships `scripts/merge_letterhead.py` (stdlib-only) which replaces the template's `[body]`
placeholder with the letter's date + Re: + body paragraphs, preserving letterhead + lab logo +
signature image + name/titles.

Steps:
1. Write markdown to /tmp/{{recipient-slug}}-{{program}}-{{cycle_year}}.md.
2. Ensure local template copy at outputs/letters/_template/test_letterhead.docx (cp from Drive-Desktop path if missing).
3. `python3 scripts/merge_letterhead.py --template outputs/letters/_template/test_letterhead.docx --letter /tmp/X.md --output "outputs/letters/{{recipient}} - {{program}} {{cycle_year}}.docx"`
4. Push the resulting .docx to Drive: `create_file(title: ..., base64Content: <base64 of output>, contentMimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", disableConversionToGoogleType: true, parentId: <recipient folder ID>)`. Capture `id` + `webViewLink`.

Alternative for iteration only: push as a Google Doc first via textContent (text/plain auto-converts),
revise in browser, then re-run the merge once final. The letterhead .docx is the actual deliverable.

GOTCHA — silent hang at create_file: tool is often marked "Needs approval" + org-policy-locked in
Claude.ai Connectors UI, AND `~/.claude/settings.json` may have `"skipAutoPermissionPrompt": true`
suppressing the dialog. Net result: hangs forever, no error. If create_file hasn't returned in 30s,
DO NOT retry. Fallback: the merged .docx is already at outputs/letters/<...>.docx — send via
SendUserFile, user uploads to Drive manually + pastes Drive IDs back, you Edit the Letter note's
artifact fields after. Pre-emptive: if you see `skipAutoPermissionPrompt: true` early, default to fallback.

REVISION PATH: if a Letter note already exists for the same tuple, do NOT overwrite. Either
(a) create a parallel "{{recipient}} - {{program}} {{cycle_year}} - v2" doc for the user to
reconcile in Drive, or (b) print the revised body to chat for the user to paste. Default to (b)
for surgical edits, (a) for material rewrites. Ask if unclear.

---

**Step 8 — Create / update the Letter note**

Path: `Atlas/Letters/{{recipient}} - {{program}} {{cycle_year}}.md`. Conform to `_schemas/letter.md`.

Frontmatter from the conversational answers:
- recipient, program, cycle_year, due, submission_portal, institution
- target_category (Step 2a)
- waived_rights (Step 2b Q1)
- is_lab_member (Step 2b Q2)
- skills_tags (Step 2c)
- status: drafting
- artifact_drive_id, artifact_url, artifact_kind: doc (Step 7)
- prior_letter (most recent prior, if any)
- sensitivity: private (DEFAULT; never lower)

Body sections:
- `# Positioning` — Step 4's positioning + the "don't mention" list.
- `# Highlights` — bullet list of specific stories / data points cited.
- `# Clarifying questions answered` — the Q&A from Steps 5–6 (audit trail).
- `# Submission notes` — portal, format, word limit.
- `# Work log` — single creation line dated today.

---

**Step 9 — Backlink + log (REQUIRED on every new-create AND status-change revision)**

Append to the Person note's `## Letters` section (create if missing, before `# Last reviewed`):
`- [[{{recipient}} - {{program}} {{cycle_year}}]] — <status>, due {{due}}`

On revisions that change status (e.g., drafting → submitted), UPDATE the existing line in-place
rather than appending a duplicate — don't leave a stale "drafting" annotation pointing at a letter
that's already been submitted.

If the Person note doesn't exist, abort and recommend /ingest-person first.

For on-letterhead output: the default Step 7 push is a plain Google Doc. If the user asks for an
on-letterhead version (portal requires signed .docx/PDF), the canonical letterhead template is
`test_letterhead.docx` (Drive ID `{{LETTERHEAD_TEMPLATE_ID}}` — see Atlas/Letters/index.md).
The Drive MCP can't mail-merge `[body]` into a .docx. Prefer the local
`scripts/merge_letterhead.py` path; if that is unavailable, copy the template into the
recipient's folder and tell the user to paste the body manually.

Append to log.md:
`<datetime> — agent:executor:writer — draft — [[{{recipient}} - {{program}} {{cycle_year}}]] — Pushed Google Doc <id>; seeded from <N> prior letters; <M> clarifying questions resolved.`

---

**Step 10 — Report back**

Compact: target_category, waived_rights, is_lab_member, skills, seed-letter count, clarifying-Q count, Drive URL, next step.
```

## Notes

- **Sensitivity is non-negotiable.** Letter notes are `sensitivity: private`. Never paste the letter body into the note — only metadata + reasoning. The Drive Doc is canonical.
- **Don't write across the waiver boundary.** If `waived_rights: false`, no comparative ranking, no weakness commentary, no patient/student health info — even if the user asks for it. Push back and offer a separate candid version they can keep private.
- **Always run the clarifying-questions beat.** Even for "quick" letters. Set the bar low (2 questions minimum) but always do it — the second round of questions catches more than the first.
- **No fabrication.** Every concrete claim in the letter body traces to a real source (prior letter, Person note, Interaction, user-supplied content, attached CV). If you don't have a source, ask the user before writing the claim.

## Related

- Skill: `.claude/skills/draft-letter/SKILL.md`
- Companion paste-prompt: `Agents/Prompts/ingest-letters.md`
- Schema: `_schemas/letter.md`
- Target-category semantics: `_schemas/letter.md`
