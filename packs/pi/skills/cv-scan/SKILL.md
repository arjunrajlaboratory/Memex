---
name: cv-scan
description: Scan Gmail + Google Calendar (and recent vault signals) for CV-worthy events — invited talks, accepted/published papers, awards, editorial/review/departmental service — dedupe against the existing CV/*.tex, and append paste-ready LaTeX snippets to the CV candidates staging queue. Use whenever the user wants to refresh CV additions — signaled by "scan for CV items", "any new CV items", "update my CV", "what's missing from my CV", "run the CV scan", "/cv-scan", or when the weekly run-trackers pass hits the [[cv-items]] tracker. Read-only against Gmail/Calendar and the .tex files; writes ONLY Ops/Followups/CV candidates.md, a Tracker Digest, log.md, run bookkeeping and # History on the [[cv-items]] tracker, and the followup's surface_on. Never sends email, never edits the .tex.
---

# cv-scan

Weekly capture worker for the CV ([[CV]]). Detects CV-worthy events and stages paste-ready
LaTeX snippets in [[CV candidates]] for the user to fold into the canonical LaTeX by hand.

## Hard rules

- **Propose only.** Never edit any `CV/*.tex` file. Allowed writes are
  `Ops/Followups/CV candidates.md`, the run's Tracker Digest, `[[cv-items]]`
  bookkeeping and `# History`, the [[CV candidates]] followup's `surface_on`, and one
  `log.md` line.
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

3. **Determine the scan window.** Resolve today's expected digest and inspect it, `[[cv-items]]`
   `last_digest`, `# History`, `log.md`, and every planned output. A same-day run is completed only
   when the digest has `status: complete` and `plan_status: complete`, `verified_outputs`
   exactly equals `planned_outputs` in the same order, every target verifies, both tracker
   references exist, and `log.md` has the matching digest-linked
   `agent:tracker` line; then stop and report "already ran today." A force request does not bypass
   this guard. Treat a legacy `status: complete` digest with no `plan_status` as completed only
   when both tracker references and the digest-linked `agent:tracker` log line verify; skip it
   without mutation and surface that outputs cannot be re-verified. If any `status: complete`
   digest is missing required output/reference evidence, do not reapply outputs, repair
   references, rescan, or rewrite it; surface drifted-complete manual integrity review. If a
   `status: partial` or `failed` digest has `plan_status: complete`, process it before
   cadence/status filtering—even when only the final status transition is missing—and treat the
   snapshot as authoritative:
   skip Steps 4–8, require `verified_outputs` to be an ordered prefix of `planned_outputs`, and
   resume at the first incomplete write. A duplicate, unplanned descriptor, or non-prefix order
   requires manual integrity review. If a partial or failed digest has
   `plan_status: building`, every progress mirror (`verified_outputs`, the output arrays, and
   `# What I changed`) empty, and no downstream
   write/reference, re-run only the read-only
   Steps 4–8, finish that same digest's plan, and set `plan_status: complete`. If an incomplete
   digest has no `plan_status`; the digest is missing while a same-day
   write/reference exists; or `plan_status: building` has any nonempty progress field, write, or
   reference, do not rescan, reconstruct, or mutate anything; surface manual recovery.
   A run is fresh only when the digest is absent and no same-day artifact/reference exists.
   Never overwrite a completed digest or create a second same-day digest. For a fresh or
   safe-to-re-plan run, reuse the scan window already recorded in the building digest when present;
   otherwise read the last `## <date> scan` block in `Ops/Followups/CV candidates.md` and use that
   date → today. If none, use the last 30 days. Also read `[[cv-items]]` `last_checked` as a
   cross-check.

   Log references to the digest that are all exact generic `agent:auto` PostToolUse placeholders
   are transaction-internal bookkeeping, not downstream writes or completion references, and do
   not count when classifying recovery. The shipped `log-mutation` hook excludes
   `Atlas/Trackers/Digests/`; ignore legacy placeholders only when every matching line has the exact
   generic auto-placeholder format. Any non-placeholder log line or other reference still counts.

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

9. **Create or resume the partial tracker digest.** Before changing the staging queue, followup,
   tracker, History, or log, write
   `Atlas/Trackers/Digests/Tracker Digest - cv-items - <today>.md` with `status: partial` and
   `plan_status: building`,
   conforming to `_schemas/tracker_digest.md` and including `material: false` runs. Record the
   `pre_run_miss_count`, `pre_run_next_check`, `planned_miss_count`, `planned_next_check`, and
   ordered `planned_outputs` descriptors for the exact intended dated
   block, exact `Last scan window: <window-start> → <today>` line, `surface_on` value, tracker-field
   bundle, History bullet, and log line. Each descriptor names a stable target and exact expected
   content or field values so recovery can verify it instead of repeating it. Initialize every
   progress mirror (`verified_outputs`, the output arrays, and `# What I changed`) empty. Count all
   fresh, deduped candidates in `items_found`; count high- and medium-confidence candidates in
   `items_material`. Populate every required body section:
   - `# What I looked at` — scan window and Gmail, Calendar, lab-website, and vault signals checked.
   - `# What's new` — every fresh, deduped candidate, including low-confidence items.
   - `# What's material` — high- and medium-confidence candidates staged for the CV.
   - `# What I changed` — starts empty; add the dated block, scan-window line, and `surface_on`
     only as each target verifies.
   - `# What needs review` — the low-confidence / FYI candidates.
   - `# Next-run recommendations` — useful query, source, or cadence adjustments.
   Set `plan_status: complete` as the final planning write before Step 10; never infer plan
   completion from whether any section is empty. Afterward, keep the discovery/materiality
   snapshot, bookkeeping, and `planned_outputs` immutable. Process the descriptors in execution
   order; `verified_outputs` may only be an append-only ordered prefix containing identical
   descriptors.

10. **Append to the staging queue idempotently.** Check whether the exact dated block already
    exists in `Ops/Followups/CV candidates.md`. Verify it instead of duplicating it; otherwise
    append it once. After the exact block verifies, update the matching digest progress fields,
    then append its identical planned descriptor to `verified_outputs` if absent as the last
    per-output digest write:
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
   Verify the exact planned `Last scan window: <window-start> → <today>` line instead of repeating
   it; otherwise update it once. After it verifies, update the matching digest progress fields,
   then append its identical planned descriptor to `verified_outputs` if absent as the last
   per-output digest write.

11. **Update the tracker and its history idempotently.** Set `[[cv-items]]` `last_checked: <today>`,
    `next_check: <today + 7d>`, `last_digest: [[Tracker Digest - cv-items - <today>]]`,
    and `updated: <today>`. If the run found nothing material, set `miss_count` to the pre-run
    value recorded in the partial digest plus one; otherwise reset it to 0. On recovery, reuse
    that result instead of incrementing again. If `miss_count >= 5`, set `status: needs_review`.
    Also set the [[CV candidates]] followup's `surface_on` to the new `next_check`, verifying an
    already-applied value rather than repeating work. After each complete planned field bundle
    verifies, append its identical descriptor to `verified_outputs` if absent.

    `last_digest` is state; `# History` is provenance. Append one bullet linking to the
    digest—one line per run, including `material: false` runs. On recovery, verify the existing
    bullet with this digest link instead of duplicating it:
    `- <today> — Run. material=<bool>, <N> items (<H+M> material). <headline, or "nothing material">. Staged <N> candidates in [[CV candidates]]. → [[Tracker Digest - cv-items - <today>]].`
    After the exact planned bullet verifies, append its identical descriptor to
    `verified_outputs` if absent.

12. **Log.** Append to `log.md`, or verify the matching digest-linked `agent:tracker` line instead
    of appending it twice on recovery:
    `<datetime> — agent:tracker — scan — [[CV candidates]] — cv-scan: <N> candidates (<H> high, <M> med, <L> fyi); [[Tracker Digest - cv-items - <today>]] created`
    After the exact planned line verifies, append its identical descriptor to `verified_outputs`
    if absent.

13. **Finalize the digest.** Verify the immutable planning snapshot, `verified_outputs` exactly
    equals `planned_outputs` in the same order, the dated staging block, exact `Last scan window:`
    line, `surface_on`, tracker fields, digest-linked History bullet, and matching log line. Only then set the digest to
    `status: complete` as the final write. Otherwise leave it `partial` (or mark it `failed` with
    the reason) for recovery. A completed digest is immutable; missing evidence is
    drifted-complete manual review, never automatic repair.

## What this skill never does

- Edit any `.tex`. Send/draft email. Create Person notes (surface them for `/ingest-person`).
- Mark CV items "done" — the user checks the boxes after pasting.
