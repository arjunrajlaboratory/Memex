# Workflow: capture triage

**Role:** `agent:capture`
**Trigger:** items present in `Inbox/`
**Output:** typed notes elsewhere in the vault; processed item moved to `Inbox/_filed/YYYY-MM-DD/<original-name>`

## Steps

1. List `Inbox/` (the untracked drop zone — skip its README and skip the `Inbox/_filed/` archive). For each item:
2. Read the item. Classify it into one of:
   - `source` — an article, transcript, screenshot, paper, dataset
   - `task` — a concrete commitment
   - `project_update` — news about an existing project (status, blocker, milestone)
   - `decision` — a recorded choice
   - `effort` — a fuzzy idea, may grow into a project
   - `interaction` — record of a contact with a person
   - `commitment` — a promise made/received
   - `ask` — a request to make of someone
   - `followup` — a tickler for later
   - `journal` — reflective; keep under `Inbox/_journal/YYYY-MM-DD.md` (the canonical schema path; see `_schemas/journal.md` for the open question on whether this should move into Atlas/ or Ops/)
3. Search the vault for existing notes the capture might attach to. Prefer linking/updating over creating.
4. Create or update the typed note per its schema. Fill what you can; leave optional fields empty.
5. Link the new note to related entities (project, area, person, topic).
6. Move the original capture to `Inbox/_filed/YYYY-MM-DD/<original-name>`.
7. Append a line to `log.md`:
   `<datetime> — agent:capture — triage — [[<new or updated note>]] — <one-sentence summary>`
8. If you could not classify with confidence, leave the item at the top level of `Inbox/` (do NOT move into `_filed/`) and add a needs-review entry to today's briefing (or `Ops/Followups/`).

## Decision aid

| Cue in the capture | Probable type |
| --- | --- |
| URL or "I read…" | source |
| Imperative verb directed at you ("send X", "fix Y") | task |
| "X happened" or "moved to Z" tied to a project | project_update |
| "Decided to / will use / chose" | decision |
| "Wondering if… / could we…" | effort |
| "Talked to / met with / called" | interaction |
| "Told X I would / promised" | commitment |
| "Need to ask X for" | ask |
| "Remind me on / by Friday" | followup |
| First-person reflective | journal |

## Rules

- Default sensitivity for `interaction`, `commitment`, `ask` is `private`.
- Never delete the original capture; the `_filed/<date>/` copy is the durable record.
- Do not invent metadata. If a date isn't in the capture, leave it empty.
- For items originating in `Inbox/` (untracked): create the typed output in its tracked destination (`Raw/<subfolder>/` for binaries, `Raw/sources/YYYY-MM-DD-<slug>.md` for raw text, `Atlas/<Type>/` for synthesized wiki content), then MOVE the original from `Inbox/<file>` to `Inbox/_filed/<YYYY-MM-DD>/<file>`. Empty top level of `Inbox/` = "everything's been filed." Unclassifiable items stay at the top level (the agent never moves an uncertain file into `_filed/`).
