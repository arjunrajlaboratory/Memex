---
name: ingest-source
description: Ingest one external source — article, paper, URL, PDF, transcript, screenshot, or dataset — into the vault as a Source note per _schemas/source.md, updating affected wiki pages and seeding follow-on Tasks. Use whenever the user wants to bring one external source — article, paper, URL, PDF, transcript, screenshot, dataset — into the Memex vault. Signaled by phrases like "ingest this article", "pull this URL into the vault", "add this source", "process this PDF", "summarize this and link it in", "what would you do with this article", or direct invocation "/ingest-source <url-or-path>". Acquires the raw file (fetch if URL, copy if dropbox, leave alone if already in Raw/), creates Atlas/Sources/<Title>.md per _schemas/source.md, fills body sections (Summary, Key claims, Useful patterns, Contradictions, Pages updated), updates affected wiki pages (or proposes needs_review tasks for them), seeds any concrete follow-on Tasks, and appends to log.md. Use this skill for any single-source ingest — for multi-entity / whole-project ingests, use /ingest-project instead.
---

# Ingest a source into the vault

You are running as **`agent:librarian`** for this skill. The user has one external piece of material — an article, a paper, a URL, a PDF, a transcript, a screenshot, a dataset — and wants it landed in the vault as a Source note, with any downstream wiki pages updated.

## Why this skill exists

Sources are the **raw evidence layer**. Every claim in the wiki should be backed by a Source — that's the whole reason `Raw/` exists and is immutable. The friction of doing this by hand is real: you have to fetch, save without modifying, write a summary, extract claims, hunt for affected pages, update them, log. This skill compresses it.

It also enforces the **don't-modify-raw** invariant and the **surface-contradictions** rule that are easy to skip when ingesting manually.

## Inputs

- **One of:**
  - `{{url}}` — a public URL to fetch
  - `{{source_path}}` — a path to a file already on disk (under `Inbox/`, `Raw/sources/`, or anywhere)
- **Optional context** — the user may say "this is the third ExampleCo piece" or "this is for the data pipeline project" to steer related-concepts / related-projects.

If neither is given, ask which one before proceeding.

## Step 0 — Orient

Read these before touching files:

- `_schemas/source.md` (the schema you'll write to)
- The last ~10 lines of `log.md` (so you don't duplicate a source already ingested today)
- Skim `Atlas/Sources/` for naming conventions and existing entries

If you can already tell from the title / URL that this source is in the vault, **stop and confirm with the user** — almost always the right move is to update the existing Source note, not create a parallel one.

## Step 1 — Acquire the raw file

The raw file is **immutable** once it lands in `Raw/`. Never edit it afterward.

| Where the input lives | What to do |
| --- | --- |
| `{{url}}` set | Fetch the page. Prefer raw-text endpoints over rendered HTML (`gist.githubusercontent.com/.../raw/...` for Gists, `?plain=1` for GitHub blobs, `/abs/` vs `/pdf/` for arXiv). Save canonical plain text (or PDF binary) to `Raw/sources/<YYYY-MM-DD>-<slug>.{md,pdf,...}`. |
| `{{source_path}}` under `Raw/sources/` | Use directly. Do not modify. |
| `{{source_path}}` under `Inbox/` | For binaries: COPY into `Raw/sources/<YYYY-MM-DD>-<slug>.<ext>`. For markdown/text: paste content into `Raw/sources/<YYYY-MM-DD>-<slug>.md` with a header comment recording original `Inbox/` filename + capture date. |
| `{{source_path}}` elsewhere | Same copy-into-`Raw/` move. Header comment recording origin path. |

For `Inbox/` items: **after the typed Source note is in place** (Step 2), MOVE the original from `Inbox/<file>` → `Inbox/_filed/<today>/<file>`. Run `mkdir -p Inbox/_filed/<today>` once at the start of the run. The empty top level of `Inbox/` (minus `README.md` and `_filed/`) is the "everything filed" signal.

If you cannot classify a `Inbox/` file with confidence (it's not obviously a source), **leave it at the top level** of `Inbox/` and write a Followup explaining what's unclear — don't force-classify.

## Step 2 — Create the Source note

Create `Atlas/Sources/<Title>.md` per `_schemas/source.md`. **First run `<Title>` through `safe_title` (see `CLAUDE.md` / `AGENTS.md` → "A note's title IS its filename"): ` / ` → ` and ` (bare `/` → `-`), drop `:` and the rest of `\ * ? " < > | # ^ [ ]`, collapse/trim spaces.** That sanitized string is the filename stem and the target of every `[[<Title>]]` wikilink you write into downstream pages — identical, or the link 404s in Quartz (Source has no `title:` field; the filename is the canonical name, and article titles routinely carry `:` and `/`, so this is the common case for Sources). Fill every frontmatter field you can infer; leave optional fields empty rather than inventing.

Critical fields:

- `source_kind:` — `article | paper | book | transcript | video | podcast | screenshot | dataset | email | meeting_notes | conversation`. Match the actual artifact.
- `raw_path:` — path to the file in `Raw/`.
- `url:` — public URL if there is one.
- `reliability:` — `high` for trusted primary sources (peer-reviewed paper, official org statement, your own meeting notes); `medium` for reasonable secondary (well-edited publication, decent technical blog); `low` for opinion or unverified content; `unknown` when you can't judge. **Be honest.** If `low` / `unknown`, any wiki claims derived from this source get `needs_review: true`.
- `related_concepts:`, `related_projects:`, `people_mentioned:` — use full wikilink form `"[[Foo]]"`.

## Step 3 — Read the raw end-to-end and fill the body

Body sections per the schema:

- `# Summary` — 3–6 sentences in your own words. Not a paste of the abstract.
- `# Key claims` — one proposition per bullet, each attributable. Cite location if useful (page, section, timestamp).
- `# Useful patterns` — reusable techniques or frames the source surfaces.
- `# Contradictions / caveats` — especially against existing wiki content. This is the single most important section for keeping the vault honest.
- `# Pages updated` — filled in Step 4.
- `# Tasks created` — filled in Step 5.
- `# Direct quotes` — only if needed; cite location.

## Step 4 — Update the wiki

Identify every wiki page whose state would change because of this source. Common candidates:

- `Atlas/Concepts/` — a concept the source advances or contradicts.
- `Atlas/Projects/` — a project the source has implications for.
- `Atlas/People/` — a person whose role/work is illuminated.
- `Atlas/Decisions/` — a decision the source bears on.

For each affected page:

- If the change is mechanical (add a wikilink to this source in `sources:`, append a one-line summary to a `# Notes` section), **make the edit directly** and add the link back to this Source note from the affected page.
- If the change is substantive (rewriting a claim, changing a project's status, contradicting an existing wiki claim), **propose the edit as a needs_review Task** under `Ops/Tasks/`. Don't silently overwrite.

List every page touched (whether edited directly or proposed-as-task) under `# Pages updated` in the Source note.

If `reliability: low` or `unknown`, **set `needs_review: true` on every derived wiki claim**, not just contested ones.

## Step 5 — Spawn tasks (sparingly)

Create Tasks only for **concrete follow-on actions** — "ping X about this", "read the cited paper", "check whether our claim Y is still right." Don't create one task per claim — that's noise. Link any spawned task under `# Tasks created` in the Source note.

## Step 6 — Update index and log

- If the source introduces a new project, person, organization, or major topic, add an entry to `index.md`.
- Append one line to `log.md`:
  ```
  <datetime> — agent:librarian — ingest — [[<Title>]] — <one-sentence summary; include reliability if not high>
  ```

## Step 7 — Open in browser via Quartz (default)

The artifact is the new Source note at `Atlas/Sources/<title>.md`. The user reads it in the browser. Run:

```bash
if ! lsof -ti :{{QUARTZ_PORT}} >/dev/null 2>&1; then
  ( cd {{VAULT_PATH}}/quartz && npm run site:serve > {{VAULT_PATH}}/outputs/quartz-serve.log 2>&1 & disown )
  for i in 1 2 3 4 5 6 7 8 9 10; do sleep 1; lsof -ti :{{QUARTZ_PORT}} >/dev/null 2>&1 && break; done
fi
open "http://localhost:{{QUARTZ_PORT}}/Atlas/Sources/<title>"
```

Skip only if the user explicitly said "don't open" or "just write the file." See memory `feedback_open_artifacts_in_browser`.

## Step 8 — Report back

```
Ingested [[<Title>]] (reliability: <high|medium|low|unknown>).

Raw: Raw/sources/<YYYY-MM-DD>-<slug>.<ext>
Key claims: <N>
Pages updated: <N>  (directly: <X> | proposed as needs_review: <Y>)
Tasks created: <N>

Notable:
- <one bullet on the most consequential claim or contradiction>
- <one bullet on the most significant downstream effect>
```

## What this skill does NOT do

- **Does not modify the raw file** after copying into `Raw/`. Treat it as evidence.
- **Does not silently overwrite** existing wiki claims. Surface contradictions in `# Contradictions / caveats` and propose the edit as a needs_review Task.
- **Does not lower a note's sensitivity.** If the affected page is `sensitivity: private`, your derived edits are also `private`.
- **Does not ingest more than one source.** For batch ingests (a folder of papers), invoke this skill N times — easier to track than a single mega-run.

## Model recommendation

- Inherit `opus` for the orchestrator (you). The judgment about contradictions, reliability, and downstream effects is where Opus earns its keep.
- For body-writing of the Source note itself (Summary, Key claims), this is straightforward enough that you can do it inline; no sub-agents needed.
- If the source is very long (a 60-page paper, a 2-hour transcript), dispatch a `sonnet` sub-agent to do the first read-and-extract pass, then synthesize the body yourself.

## Related

- `_schemas/source.md` — the schema you're writing to.
- `_workflows/source-ingest.md` — the full long-form workflow this skill is a Claude-Code-native version of.
- `Agents/Prompts/ingest-source.md` — the paste-able prompt equivalent (use this in non-Claude-Code environments).
- `ingest-project` skill — for multi-source / multi-entity ingest (project + people + topics + sources at once).
- `triage-inbox` skill — when the source came in via `Inbox/` along with other captures.
