---
name: ingest-project
description: Ingest a multi-entity project — Area, Organizations, People, Sources, Concepts, Project, Sub-projects, Implementations, Trackers, Tasks — into the vault in topological order with parallel Sonnet/Haiku sub-agents. Use when the user wants to bring a new project, initiative, or related cluster of material into this Memex vault — signaled by phrases like "set up the X project", "ingest this project", "capture all this material as a project", "I'm starting a new initiative", "make a project for the X folder/dropbox", "we just got a pile of stuff from Y and I want to make it into a project". Walks the user through the canonical topological order (Area → Orgs → People → Sources → Concepts → Project → Sub-projects → Implementations → Trackers → Tasks → Followups), prompts for People / Tasks / Trackers that weren't specified up front, and dispatches parallel Sonnet/Haiku sub-agents for batched note-writing so the run stays fast and cheap. Use this skill whenever the work would create more than about three typed notes at once — it is the right hammer for any multi-entity ingest, and prevents the silent failure mode where Project pages get written before their People/Orgs exist (dangling wikilinks) and where Trackers/Tasks are forgotten.
---

# Ingest a new project into the vault

You are running as **`agent:librarian`** for the duration of this skill. The user has a new project worth's of material — possibly in `Inbox/`, possibly described in conversation, possibly already partially captured — and wants it landed cleanly into the vault as a coherent web of typed notes.

This skill is the antidote to the two failure modes that showed up in the ExampleProject and ExampleCo-AI ingests:

1. **Dangling wikilinks** when a Project page is written before its Orgs/People/Sources exist.
2. **Forgotten ancillaries** — Trackers, Tasks, Followups, and `index.md` updates that didn't get spawned because the freeform ingest tracked only the obvious entities.

Follow the steps below. Don't skip the wizard pass even if the user gave you a folder — the wizard fills the gaps in their brief.

## Step 0 — Orient yourself

Read these in full before writing anything:

- `AGENTS.md` (top-level vault contract)
- `CLAUDE.md` (Claude-Code-specific notes)
- `_schemas/_types.md` (the type registry — bookmark this)
- The last ~20 lines of `log.md` (so you don't re-create something that already exists)

Then quickly scan `Atlas/Projects/`, `Atlas/Areas/`, `Atlas/Organizations/`, and `Atlas/People/` directory listings to learn what entities already live in the vault. If the project the user wants to ingest looks like it might already exist, **stop and confirm with the user before proceeding** — almost always the right move is to update the existing page, not create a parallel one.

## Step 1 — Capture intent (the wizard)

Ask the user the questions below **one at a time**, but **only the ones they have not already answered** in their initial message or in attached material. If they handed you a folder of files in `Inbox/`, skim the top-most synthesis doc first so you don't ask things the doc already states.

When you ask, present a sensible default in parentheses and let the user accept it with a one-word answer.

1. **Subject** — One short phrase. This becomes `Project - <Subject>.md`. Run it (and every entity name you mint in this run) through `safe_title` first (see `CLAUDE.md`/`AGENTS.md` → "A note's title IS its filename"): ` / ` → ` and ` (bare `/` → `-`), drop `:` and the rest of `\ * ? " < > | # ^ [ ]`, collapse spaces — so the filename stem and every `[[wikilink]]` to it stay identical.
2. **Area** — Which existing Area does this live under? (Show them the current Areas list.) If none fit, propose a new one with a one-line purpose statement.
3. **Outcome** — What does "done" look like in 1–2 sentences? (If the project is ongoing/maintenance, say `phase: maintaining` and skip a target date.)
4. **Source material** — Where is it? Options: a `Inbox/` folder, a URL, an external repo path, "I'll paste it", or "no material yet — capture the idea only".
5. **Sub-projects** — Is this a single project or a master-with-sub-projects shape? (ExampleProject had 6 sub-projects; ExampleCo-AI had none.)
6. **People** — Who's involved? Ask for each role explicitly so they don't forget anyone:
   - **Stakeholders** (whose interests are served by this — usually includes `[[Me]]`)
   - **Collaborators** (doing the work)
   - **Reviewers** (gates on output)
   - **Decision-makers** (who can change scope)
   - For each, surface whether the Person note already exists. For new People, **delegate to the `ingest-person` skill** later in Step 4.
7. **Organizations** — Which orgs are part of this story? (Employer, partner labs, customers, funders, vendors.) Same existing/new check as People.
8. **Concepts** — Concept pages that aggregate this project with related work. Often inferable from the source material; offer 2–3 candidates and let the user accept/edit.
9. **Trackers to spawn** — What should the vault watch on a cadence to keep this project's wiki pages fresh? Common patterns: GitHub releases, news/mentions, a competitor landscape, a person's activity. Default to 0–2 trackers; suggest, don't push.
10. **Tasks to seed** — What are the next 1–5 concrete next actions for this project? Don't accept "various stuff" — push for specific tasks with owners and (ideally) due dates. If the user resists, prompt: *"I'll create one Task placeholder named '<Subject> — define next actions' due in 7 days; OK?"*
11. **Followups** — Any time-delayed nudges? (E.g., "ping X end of summer".)
12. **Sensitivity** — `normal` (default) | `private` | `sensitive`. Confirm if any of the source material looks confidential.

Restate the full plan back to the user in a tight bullet list before you write anything. Wait for "go" or corrections.

**Include a rough-cost line in the plan restatement** — this is a non-trivial run and the user should know the shape of the bill before saying go. Estimate based on Step 3's model-selection table:

```
Estimated cost: ~<N> Haiku sub-agent calls (Sources/Orgs/Concepts/Followups/Tasks), ~<N> Sonnet sub-agent calls (People/Project/Sub-projects/Trackers), and ~<X> Opus-orchestrator turns on the main thread. Rough: <low-five-figures to mid-five-figures> tokens total. If this looks heavier than expected, say what to cut.
```

The user can opt out, scope down (skip Trackers, skip Concepts), or proceed. Don't dispatch until they've okayed the plan **and** the cost.

## Step 2 — Plan the writes (topological order)

You will write notes in this order so wikilinks resolve as they're created. Do not improvise the order.

```
1. Area                  (1 note, only if new)
2. Organizations         (N notes, parallel)
3. People                (N notes, parallel — delegates to ingest-person)
4. Sources               (N notes, parallel)
5. Concepts                (N notes, parallel)
6. Project (master)      (1 note, sequential)
7. Sub-projects          (N notes, parallel; each links back to master)
8. Implementations       (N notes, parallel, optional)
9. Trackers              (N notes, parallel — delegates to new-tracker wizard)
10. Tasks                (N notes, parallel)
11. Followups            (N notes, parallel)
12. index.md             (1 edit, sequential)
13. log.md               (1 edit, sequential — batched entries by type)
```

Each "(parallel)" group is dispatched to sub-agents in a single message (see Step 3).

## Step 3 — Dispatch sub-agents to write batches

For every group marked "parallel" above, dispatch one sub-agent **per note** in the same message so they run concurrently. Sub-agents only write files; they do not commit, do not modify other groups' files, and do not touch `log.md` or `index.md`. This avoids `.git/index.lock` races (per `CLAUDE.md`'s tool-use conventions).

**Model selection — important.** Token budget matters; not everything needs Opus.

| Sub-agent job | Model | Why |
| --- | --- | --- |
| Reading source material, extracting facts, summarizing | `haiku` | Cheap, fast, plenty smart enough for "read this and tell me the 5 key claims" |
| Writing one Source / Organization / Concept / Followup / Task note from clear inputs | `haiku` | One schema, one template, mechanical fill-in |
| Writing one Person note (Gmail backfill + judgment about cadence/role) | `sonnet` | Needs judgment to interpret Gmail signal — delegates to `ingest-person` skill which sets its own model |
| Writing one Project / Sub-project / Implementation page (rich cross-linking, judgment about outcome/status/why-it-matters) | `sonnet` | These are the synthesis pages — quality matters more than speed |
| Writing one Tracker (cadence, search-strategy, "material change" definition) | `sonnet` | Judgment-heavy; delegates to `new-tracker` wizard logic |
| The orchestrator (this skill, deciding what to dispatch, reconciling outputs) | inherited (typically `opus`) | Don't override the parent model |

When you call the Agent tool, set `model: "haiku"` or `model: "sonnet"` explicitly in the args. Inheritance is fine for the main thread but **the wins from cheap sub-agents only materialize if you set the model on each Agent call**.

Each sub-agent prompt should follow this template (adapt fields):

```
You are agent:librarian writing ONE note for the Memex vault at {{VAULT_PATH}}.

Read FIRST:
- _schemas/<type>.md (full)
- AGENTS.md § "Core principles" (so you don't violate raw-immutable / log-every-mutation)

Write the note at: <full path>   # the orchestrator already ran the title through safe_title — use this filename verbatim

Inputs:
- Title: <… — already safe_title'd: no `/ : \ * ? " < > | # ^ [ ]`; matches the filename stem exactly>
- Frontmatter values to set: <…>
- Body section content: <…>
- Wikilinks to include (already-existing notes): <list>
- Wikilinks to forward-reference (not-yet-existing in this run): <list — write them anyway, they'll resolve once the later batch lands>

Constraints:
- The filename stem, the `title:` value, and every `[[wikilink]]` pointing at this note must be identical — write the title verbatim, don't re-sanitize or re-style it.
- Do not modify any file other than the one you are writing.
- Do not touch log.md or index.md (the orchestrator handles those).
- Set `created:` and `updated:` to today's date (the orchestrator will pass it).
- If you cannot infer a field, leave it empty rather than inventing.
- Do not commit.

Return the path you wrote and a one-line summary of what's in it.
```

After a parallel batch returns, **read each written file** (just frontmatter, in parallel) to verify the writes happened. If a sub-agent failed, retry just that one before moving on.

## Step 4 — People are special: delegate to `ingest-person`

For every new Person identified in Step 1, invoke the `ingest-person` skill (or replicate its Gmail-backfill move) rather than writing the Person note inline. The `ingest-person` skill knows to search Gmail for prior threads, infer role from signatures, set `last_contact`, and seed `# Conversation history`. The user has a standing preference (recorded in memory: `feedback_enrich_people_from_gmail`) that Person notes get backfilled from Gmail — honor it.

If you batch several new People in parallel, dispatch each as its own sub-agent invoking the skill, all in the same message.

## Step 5 — Trackers are special: delegate to `new-tracker` wizard

If Step 1.9 surfaced trackers to spawn, **after the Project + Sub-projects exist** (so `update_targets:` can link to real notes), run the new-tracker wizard once per tracker. The wizard lives at `Agents/Prompts/new-tracker.md`. Either:

- Invoke it inline yourself (you have all the answers from Step 1).
- Or, if the user wants to be in the loop, hand back to them with a ready-to-paste invocation.

Do not skip this step silently. The ExampleProject ingest had to retroactively spawn 4 trackers; baking it into the ingest is cheaper.

## Step 6 — Logging convention

A single ingest creates many files. The log gets one entry per **batch by type**, not one per file. So an ExampleProject-shaped ingest produces ~10 log lines, not 35.

Append entries in chronological order at the top of `log.md` (newest first, per the file's convention). Use this shape:

```
<datetime> — agent:librarian — create — [[<name>]] — new area for <project> ingest
<datetime> — agent:librarian — create — 3 Organizations: [[Org - A]], [[Org - B]], [[Org - C]] — anchors for <project>
<datetime> — agent:librarian — create — 5 People: [[X]] … — collaborators/stakeholders for <project>; <N> backfilled from Gmail
<datetime> — agent:librarian — ingest — 4 Sources from Inbox/ — <one-line summary>
<datetime> — agent:librarian — create — 3 Concepts: [[A]], [[B]], [[C]]
<datetime> — agent:librarian — create — [[<name>]] (master) + N sub-projects + <M> tasks + <K> trackers — <one-sentence framing>
<datetime> — agent:librarian — create — N Tasks: <top 2-3 titles> + <N-2> more — seed next-actions for [[<name>]]
<datetime> — agent:librarian — update — [[index]] — added <project>, <area>, <key people>
```

This makes future log scans (and weekly reviews) readable. Per-file granularity is reconstructible from `git log` if anyone needs it.

## Step 7 — Update `index.md`

If you introduced a new Area, a new master Project, key People, or a major new Concept cluster, update `index.md`. This is a hard gate — do not finish the ingest without checking.

## Step 8 — Mark for review, don't close

Per `AGENTS.md`: **never mark your own work `done`**. Set the master Project's `status: active` (or `paused` / `waiting` as appropriate) but leave all spawned Tasks at `status: next` or `status: needs_review` so the user closes them.

## Step 9 — Open in browser via Quartz (default)

The primary artifact is the new Project page at `Atlas/Projects/<name>.md`. The user reads it in the browser (the page links naturally to the new People, Sources, Trackers, Tasks etc. spawned by the ingest). Run:

```bash
if ! lsof -ti :{{QUARTZ_PORT}} >/dev/null 2>&1; then
  ( cd {{VAULT_PATH}}/quartz && npm run site:serve > {{VAULT_PATH}}/outputs/quartz-serve.log 2>&1 & disown )
  for i in 1 2 3 4 5 6 7 8 9 10; do sleep 1; lsof -ti :{{QUARTZ_PORT}} >/dev/null 2>&1 && break; done
fi
open "http://localhost:{{QUARTZ_PORT}}/Atlas/Projects/<name>"
```

Open only the Project page, not every spawned note — opening 10+ tabs is noise. The user navigates from the Project page. Skip only if the user explicitly said "don't open" or "just write the file." See memory `feedback_open_artifacts_in_browser`.

## Step 10 — Report back

End with a compact summary for the user:

```
Ingest complete.

Created:
- Area: [[…]] (new | existing)
- Project: [[…]] + N sub-projects
- People: N (M backfilled from Gmail)
- Orgs: N
- Sources: N
- Concepts: N
- Trackers: N (cadences: …)
- Tasks: N seeded as next-actions
- Followups: N
- index.md updated: yes/no

Suggested next steps:
1. <highest-priority Task>
2. Run first pass of <Tracker>
3. Review needs_review items: <count>
```

## Anti-patterns to avoid

- **Writing the Project page first.** Wikilinks dangle. Stick to the topological order.
- **Asking the user every question even when material is in front of you.** Read first, ask only for gaps.
- **Sequential sub-agent dispatch.** If you dispatch 5 People notes one after another, you've lost the latency win. Dispatch them in a single message.
- **Defaulting everything to Opus.** Reading a markdown file and filling a 12-field frontmatter is a Haiku job. Save Opus for the orchestrator.
- **One mega log line.** Use the batched convention above.
- **Silent skip of trackers and index.md.** These are the most-forgotten parts of an ingest. Treat them as gates, not afterthoughts.
- **Marking your own work done.** Set `needs_review` and hand back.

## Related skills and prompts

- [`ingest-person`](../ingest-person/SKILL.md) — for each new Person identified
- [`session-start`](../session-start/SKILL.md) — run before this skill if it's been a while since the last session
- `Agents/Prompts/ingest-source.md` — for one-off source ingest outside a project context
- `Agents/Prompts/new-tracker.md` — wizard for spawning trackers in Step 5
- `Agents/Prompts/triage-inbox.md` — for `Inbox/` items that aren't part of a coherent project ingest
