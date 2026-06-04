---
name: cv-scan
description: Scan Gmail + Google Calendar (and recent vault signals) for CV-worthy events — invited talks, accepted/published papers, awards, editorial/review/departmental service — dedupe against the existing CV/*.tex, and append paste-ready LaTeX snippets to the CV candidates staging queue. Use whenever the user wants to refresh CV additions — signaled by "scan for CV items", "any new CV items", "update my CV", "what's missing from my CV", "run the CV scan", "/cv-scan", or when the weekly run-trackers pass hits the [[cv-items]] tracker. Read-only against Gmail/Calendar and the .tex files; writes ONLY Ops/Followups/CV candidates.md and log.md. Never sends email, never edits the .tex.
---

# cv-scan

Weekly capture worker for the CV ([[CV]]). Detects CV-worthy events and stages paste-ready
LaTeX snippets in [[CV candidates]] for the user to fold into the canonical LaTeX by hand.

## Hard rules

- **Propose only.** Never edit any `CV/*.tex` file. Output goes to
  `Ops/Followups/CV candidates.md` only (plus one `log.md` line).
- **Read-only** against Gmail and Calendar. Never send, draft, or label email.
- **Dedupe before proposing.** An item already present in the relevant `.tex` is dropped.
- **Real, not tentative.** Talks must be delivered or firmly scheduled; papers accepted or
  published; awards conferred; service appointments confirmed. Tentative invitations go to the
  "Low-confidence / FYI" bucket, not the main list.

## Steps

1. **Load the inventory.** Read `Atlas/Areas/CV.md` → the "Section inventory" table for each
   section's file and exact new-item LaTeX format.

2. **Build the dedupe set.** Read each auto/semi section file under `CV/`
   (`invited_talks.tex`, `publications.tex`, `review_service.tex`, `departmental_service.tex`,
   `supervision.tex`, and the Awards tabular in `_core.tex`). Extract the existing entries
   (venues+dates for talks, titles/DOIs for papers, etc.) into a dedupe set.

   Also read the **lab website publications** at `{{LAB_WEBSITE_PATH}}/src/content/publications/*.md`
   (the Example Lab site; `{{LAB_WEBSITE_PATH}}` is configured per-vault). Each file has YAML frontmatter with
   `title`, `authors`, `journal`, `year`, `type`, optional `status` (e.g. `accepted`), and
   `links` (journal/biorxiv/doi). This is the **authoritative source for author lists and full
   citations** — far cleaner than email. Use it both to dedupe (skip papers already in
   `publications.tex`) and as a primary publications signal in its own right.

3. **Determine the scan window.** Read the last `## <date> scan` block in
   `Ops/Followups/CV candidates.md`; the window is (that date → today). If none, use the last
   30 days. Also read `[[cv-items]]` `last_checked` as a cross-check.

4. **Scan Gmail** (broad-search technique — see memory `feedback_gmail_search_technique`; search
   both directions, `in:anywhere`, wide dates, then narrow). Per section:
   - **Publications:** "manuscript accepted", "your paper", "proofs", "published online",
     journal domains, bioRxiv DOI-assigned mails.
   - **Invited talks:** "invitation to speak", "seminar invitation", "honorarium", "your
     visit", "host", thank-you-for-speaking notes.
   - **Awards:** "pleased to inform", "congratulations", "award", "honoree", "elected".
   - **Service:** "invitation to review", "editorial board", "study section", "program
     committee", "associate editor".

5. **Scan Calendar.** List events in the window. Flag as invited-talk candidates: events whose
   location is another institution, or titled seminar / colloquium / lecture / "talk at",
   especially when the user is traveling.

6. **Scan vault + lab-website signals.**
   - **Lab website** (`{{LAB_WEBSITE_PATH}}/src/content/publications/*.md`): any publication entry
     whose `title`/DOI is not yet in `publications.tex` is a publications candidate. Entries
     with `status: accepted` (or a live `links.journal`) are real; preprints
     (`type: preprint` / only a `biorxiv` link) go to the FYI bucket until accepted. The
     website is also where you pull the **full author list + journal/year** for any paper
     surfaced by the email scan.
   - **Grants** (`Atlas/Grants/*.md`): notes whose `status:` recently became `funded` →
     awards/funding candidates.
   - **People**: new mentee Person notes (`relationship_category` includes `mentee`) →
     supervision candidates.

7. **Dedupe + score.** Drop anything already in the dedupe set (Step 2). Assign confidence:
   *high* (clear, real, well-formed), *medium* (real but needs an edit — e.g. missing talk
   title), *low* (tentative / ambiguous → FYI bucket).

8. **Format snippets.** For each surviving candidate, render the exact LaTeX for its section
   (from the Step 1 inventory). For publications, prefer the **lab website** frontmatter for the
   author list + title; for a published paper, complete the citation (volume/issue/article no.)
   from Crossref (`https://api.crossref.org/works/<DOI>`) when the journal page is paywalled.
   Use `TBD — <field>?` for genuinely unknown fields rather than guessing (e.g. an unknown talk
   title); never fabricate an author list.

9. **Append to the staging queue.** Append one dated block to
   `Ops/Followups/CV candidates.md`:
   ```markdown
   ## <today> scan (covers <window-start> → <today>)

   ### <Section name>
   - [ ] **<short label> — <date>**
         `<paste-ready LaTeX snippet>`
         ↳ provenance: <calendar event / Gmail thread subject>
         ↳ confidence: <high|medium> · paste into `CV/<file>.tex`

   ### Low-confidence / FYI
   - [ ] **<label>** ↳ <why uncertain> ↳ <provenance>
   ```
   Update the note's "Last scan window:" line.

10. **Update the tracker.** Set `[[cv-items]]` `last_checked: <today>`,
    `next_check: <today + 7d>`. If the run found nothing material, increment `miss_count`,
    else reset to 0. Also bump the [[CV candidates]] followup's `surface_on` to the new
    `next_check`.

11. **Log.** Append to `log.md`:
    `<datetime> — actor:me — scan — [[CV candidates]] — cv-scan: <N> candidates (<H> high, <M> med, <L> fyi)`

## What this skill never does

- Edit any `.tex`. Send/draft email. Create Person notes (surface them for `/ingest-person`).
- Mark CV items "done" — the user checks the boxes after pasting.
