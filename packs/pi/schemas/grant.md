# Schema: grant

A **Grant** is a funding proposal, fellowship, award, or training grant — submitted, funded, declined, or in preparation. The actual proposal files (research strategy, specific aims, budget, biosketch, narrative) live in the synced Google Drive tree at `Grants and ideas/<folder>/`; the Grant note in `Atlas/Grants/` is the **index entry** — it tracks the title, funder, mechanism, role, status, collaborators, and how to find the folder. It does not store the proposal body.

One note per **logical grant**: resubmissions, renewals, and revisions of the same proposal chain into a single note (via `prior_submission:` + the `# Status & history` section) rather than spawning a new note per cycle. Obvious `… copy` duplicate folders fold into the same note.

File path: `Atlas/Grants/<Short title> - <Mechanism>.md` (cycle-agnostic for chained grants) or `Atlas/Grants/<folder-derived name>.md` (one-off submissions).

Examples:
- `Atlas/Grants/CellModel A - R01.md`
- `Atlas/Grants/CellModel B - R01.md`
- `Atlas/Grants/AnalysisTool - R61 IMAT.md`
- `Atlas/Grants/ExampleCo SBIR.md`

## Frontmatter

```yaml
---
type: grant
id: grant-<slug>
title: "<full proposal title>"          # the real title, NOT the folder name
funder: "NIH"                            # NIH | NSF | HHMI | Simons | CZI | Keck | Gates | ACS | ARPA-H | ...
mechanism: "R01"                         # R01 | R35 | R21 | R33 | R61 | U01 | U19 | U54 | P01 | T32 | F30 | F99 | SBIR | award | pilot | ...
program: ""                              # institute / RFA / sub-program: NCI | NIGMS | NHLBI | IMAT | Pioneer | New Innovator | ...
grant_number: ""                         # e.g. 1R01DK143455-01A1, if known
role: pi                                 # pi | mpi | co-investigator | sponsor | mentor | consultant
status: unknown                          # idea | in_prep | submitted | under_review | funded | active | declined | closed | withdrawn | unknown
submitted:                               # YYYY-MM-DD submission date, if known
period_start:                            # YYYY-MM-DD award start (funded grants)
period_end:                              # YYYY-MM-DD award end
amount: ""                               # total or direct costs, if known
cycle_year: 2025                         # the year used for grouping / the registry
collaborators: []                        # ["[[Name]]", ...] — MPIs, co-Is, key personnel, the lead PI if role != pi
amount_note: ""                          # free text if amount needs context (e.g. "direct only", "Roe subaward")
area: "[[Grants]]"
related_projects: []                     # vault Project notes this grant funds, if any
related_sources: []                      # boilerplate Sources, CV, etc. used as inputs
# Artifact refs — at least one MUST be set (normally the synced Drive folder path):
artifact_path: ""                        # absolute local path to the grant's Drive folder
artifact_drive_id: ""                    # Drive folder ID
artifact_url: ""                         # Drive view URL
prior_submission: "[[<prev cycle Grant note>]]"   # resubmission/renewal chain link (omit if first cycle)
sensitivity: private                     # DEFAULT — unpublished aims + funding status. Lower to `normal` only for publicly-awarded grants.
created: YYYY-MM-DD
updated: YYYY-MM-DD
---
```

## Body sections

- `# Summary / abstract` — the proposal abstract, or a 3–5 sentence summary of the goal and approach. For shell notes (not yet read in depth), write `TBD — not yet extracted` so the gap is explicit.
- `# Aims` — the specific aims as a bullet list, if extracted. Optional for shells.
- `# Collaborators & roles` — who is on the grant and in what role (PI, MPI, co-I, key personnel, sponsor). Mirror the wikilinks in `collaborators:`.
- `# Status & history` — the submission / resubmission / renewal timeline as dated bullets (e.g. `2024-06 submitted`, `2025-01 A1 resubmission`, `2025-?? outcome`). This is where the logical-grant chain lives. Note `status:` reasoning here ("declined — resubmitted as A1", "funded, in no-cost extension").
- `# Materials` — the Drive folder path + the key files in it (research strategy, specific aims, narrative, budget, biosketch used). Point, don't paste.
- `# Notes` — review feedback, scores, why declined, reuse value, anything else worth remembering next cycle.

## Rules

- **`sensitivity: private` is the default.** Grant folders hold unpublished science and funding-outcome information. Lower to `normal` only for grants whose abstract is already public (e.g. an active NIH award listed on RePORTER) and only with the user's awareness. The privacy filter strips `private` notes from the public Quartz build.
- **At least one of `artifact_path`, `artifact_drive_id`, `artifact_url` must be set.** Normally `artifact_path` pointing at the grant's folder on the synced Drive mount (`.../My Drive/Grants and ideas/<folder>`). A Grant note with no way to find the proposal is useless.
- **One note per logical grant.** Resubmissions/renewals chain via `prior_submission:` and `# Status & history`; do not create a separate note per cycle. `… copy` folders fold into the existing note (mention in `# Materials`).
- **Never guess funded vs. declined.** If the folder doesn't make the outcome unambiguous, set `status: unknown` and say so in `# Status & history`. A resubmission folder implies the prior cycle was *declined* — that inference is allowed and should be noted.
- **`title:` is the real proposal title**, extracted from the research strategy / aims / cover letter — not the Drive folder name. For shells where the title hasn't been read, use the best available descriptor and mark it provisional.
- **Collaborator backlinks:** when a `[[Name]]` in `collaborators:` has a Person note, the librarian may add a `# Grants` backlink there. Don't auto-create Person notes — surface them for `/ingest-person`.
- The canonical registry of all Grant notes is `Atlas/Grants/index.md` (categorized + linked). The `[[Grants]]` Area note carries the "recent & live" highlights and points here.

## Why a typed note (vs. just trusting the Drive folder)

Three things the folder-only setup can't do:
1. **Queryability** — "every R01 I've submitted since 2022", "all grants with [[Alex Kim]] as MPI", "what's currently under review" via metadata, not Drive search.
2. **Status + deadline surfacing** — `/run-trackers` and the briefing can surface `under_review` grants awaiting decisions and `in_prep` ones with deadlines.
3. **Reuse memory** — `# Notes` (review feedback, scores, why declined) and `# Status & history` make the next cycle's resubmission far faster than re-reading the folder.

The Drive folder remains the canonical store of the proposal bytes; the Grant notes are the index that makes them findable, queryable, and auditable. Sibling of the `letter` type (which does the same for letters of recommendation).
