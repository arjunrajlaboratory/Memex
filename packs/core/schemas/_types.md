# Type registry

Every typed note in this vault must declare a `type:` field whose value is one of:

| `type` | Folder | Schema | Purpose |
| --- | --- | --- | --- |
| `area` | `Atlas/Areas/` | [[_schemas/area]] | Ongoing domain of life or work |
| `project` | `Atlas/Projects/` | [[_schemas/project]] | Outcome-bearing initiative that can finish |
| `effort` | `Atlas/Efforts/` | [[_schemas/effort]] | Looser thread; may promote to project |
| `idea` | `Atlas/Ideas/` | [[_schemas/idea]] | Pre-commitment seed; may promote to task / effort / project, or be dropped |
| `concept` | `Atlas/Concepts/` | [[_schemas/concept]] | Knowledge page; aggregates sources and projects (a subject you understand) |
| `person` | `Atlas/People/` | [[_schemas/person]] | A real human |
| `organization` | `Atlas/Organizations/` | [[_schemas/organization]] | A company, lab, group |
| `relationship` | `Atlas/Relationships/` | [[_schemas/relationship]] | A person's role in a specific context |
| `decision` | `Atlas/Decisions/` | [[_schemas/decision]] | A decision of record |
| `implementation` | `Atlas/Implementations/` | [[_schemas/implementation]] | A how-it-works writeup |
| `source` | `Atlas/Sources/` | [[_schemas/source]] | A processed external input |
| `letter` | `Atlas/Letters/` | [[_schemas/letter]] | A deadline-driven written ask (rec / cover / nomination); index over the letter file in Drive |
| `grant` | `Atlas/Grants/` | [[_schemas/grant]] | A funding proposal / fellowship / award; index over the proposal folder in Drive |
| `tracker` | `Atlas/Trackers/` | [[_schemas/tracker]] | A living-topic watcher; re-runs on a cadence and files digests |
| `tracker_digest` | `Atlas/Trackers/Digests/` | [[_schemas/tracker_digest]] | A single tracker run output |
| `task` | `Ops/Tasks/` | [[_schemas/task]] | A discrete commitment |
| `briefing` | `Ops/Briefings/` | [[_schemas/briefing]] | A generated operating-state report |
| `review` | `Ops/Reviews/` | [[_schemas/review]] | A periodic review (weekly, monthly) |
| `followup` | `Ops/Followups/` | [[_schemas/followup]] | A scheduled prompt to act later |
| `interaction` | `Atlas/People/` (sibling) | [[_schemas/interaction]] | An event-level record of contact with a person |
| `commitment` | `Atlas/People/` (sibling) | [[_schemas/commitment]] | A promise between you and a person |
| `ask` | `Atlas/People/` (sibling) | [[_schemas/ask]] | A request you could make of a person |
| `journal` | `Inbox/_journal/` | [[_schemas/journal]] | A first-person reflective entry (one file per day) |
| `agent_job` | `Agents/Jobs/` | [[_schemas/agent_job]] | A delegated unit of work |
| `agent_run` | `Agents/Runs/` | [[_schemas/agent_run]] | The log of one agent_job execution |

Sub-folders inside `Atlas/People/` are allowed: e.g. `Atlas/People/Interactions/`, `Atlas/People/Commitments/`, `Atlas/People/Asks/`. The person profile itself sits at `Atlas/People/<Name>.md`.

## Filenames and titles — `safe_title`

Each schema's `File path:` is derived from the note's title/name (`<Title>`, `<Display Name>`, `<Subject>`). The hard invariant tying them together:

```
filename stem  ==  title:  ==  every [[wikilink]] target
```

Because the same string names the file *and* is the wikilink target, a title with a filename-illegal or Quartz-hazardous character drifts: the file saves under a sanitized name while wikilinks keep the raw title and 404. `/` is worst — Quartz parses it as a path separator inside `[[...]]`. So **before** using a title as a filename or wikilink, run `safe_title` and store the result in `title:`:

1. ` / ` (spaced slash) → ` and `; any remaining bare `/` → `-`
2. `:` → drop (collapse the doubled space)
3. drop the rest of the hazardous set: `\ * ? " < > | # ^ [ ]`
4. collapse repeated spaces; trim leading/trailing spaces, dots, and dashes

This is **not** the `id:` slug (a lowercase kebab-case form like `prj-<slug>`) nor the Quartz URL slug (a display transform). It's the one rule every note-creating skill applies so filename, title, and wikilink can never diverge. Full statement + examples live in `CLAUDE.md` / `AGENTS.md` ("A note's title IS its filename"); `_workflows/lint.md` checks #1 and #20 audit for drift.

## Idea vs Effort vs Project vs Task

These four types form a commitment ladder. The decision tree for "which type should this be?":

| Type | Commitment level | Has an outcome? | Has acceptance criteria? | Has a deadline? |
| --- | --- | --- | --- | --- |
| `idea` | **Pre-commitment.** "Worth thinking about." | No | No | No |
| `effort` | **Committed but unscoped.** "I'm pursuing this thread." | Sometimes; fuzzy | No | No |
| `project` | **Committed and outcome-bearing.** "I'm shipping this." | Yes | Yes | Sometimes |
| `task` | **Discrete commitment.** "I will do this specific thing." | Implicit (the task itself) | Yes | Often |

**Pick `idea`** when you'd want to think more before committing — the cost of dropping it is just deleting the page. Ideas don't need anyone else to be aware they exist. Use `/flesh-out-idea` to develop them; promote when ready.

**Pick `effort`** when you've decided to invest time but you can't yet say what "done" looks like. An effort is the right home for a research direction or a theme you're tracking — fuzzier than a project, less ephemeral than an idea. Efforts can sit at `maturity: fuzzy` indefinitely; when the outcome sharpens, promote to a `project` and set the effort to `status: converged`.

**Pick `project`** when you can write a one-paragraph `# Outcome` and at least one acceptance criterion. Projects expect a `# Current status` update at the area's review cadence. Promoting a project to `status: done` requires the outcome to be met.

**Pick `task`** when the work is a single concrete action with a clear "did it / didn't" check. Tasks live inside projects (via the `project:` field); a task without a project is acceptable but usually a smell that the parent project is missing.

**Promotion is one-directional.** Ideas → Tasks / Efforts / Projects (set `promoted_to:` and `status: promoted`). Efforts → Projects (set `superseded_by:` and `status: converged`). You don't demote; instead, archive and start fresh.

## Status vocabularies

Different types use different status vocabularies. Each schema document defines its own. Common ones:

- **Project status:** `active`, `paused`, `waiting`, `archived`, `done`, `dropped`
- **Task status:** `inbox`, `backlog`, `next`, `scheduled`, `in_progress`, `waiting`, `needs_review`, `done`, `canceled`
- **Source status:** `new`, `unprocessed`, `processing`, `processed`, `needs_review`
- **Agent job status:** `draft`, `ready`, `in_progress`, `needs_review`, `approved`, `done`, `rejected`

## Sensitivity vocabulary

`normal`, `private`, `sensitive`. See `_schemas/_privacy.md`.
