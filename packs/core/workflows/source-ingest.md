# Workflow: source ingest

**Role:** `agent:librarian`
**Trigger:** new file in `Raw/sources/` OR explicit user request to ingest a URL
**Output:** a `Source - <Title>.md` in `Atlas/Sources/`, plus updates to relevant wiki pages

## Steps

1. If the input is a URL, fetch it (per allowed_tools) and save the canonical text under `Raw/sources/<YYYY-MM-DD>-<slug>.md`. Do **not** edit the saved raw copy afterward.
2. Create `Atlas/Sources/<Title>.md` from `_templates/source.md`.
3. Read the raw source end-to-end. Fill the source note:
   - `# Summary` (3–6 sentences, your words)
   - `# Key claims` (each a single proposition, attributable)
   - `# Useful patterns`
   - `# Contradictions / caveats` (especially with anything already in the wiki)
4. Identify wiki pages whose state would change because of this source. For each:
   - If `auto_update_wiki: true` on a relevant tracker, edit the page and link back to the source.
   - Otherwise, propose the edit in a needs-review task under `Ops/Tasks/`.
   - Either way, add the page to `# Pages updated` in the source note.
5. Spawn tasks *only* if a concrete action follows. Link new tasks under `# Tasks created`.
6. Update `index.md` if a new project, person, organization, or major topic was introduced.
7. Append to `log.md`:
   `<datetime> — agent:librarian — ingest — [[<Title>]] — <one-sentence summary>`

## Rules

- Set the source's `reliability:` thoughtfully (`high` for primary sources you trust, `low` for hot takes).
- If `reliability: low` or `unknown`, mark derived wiki edits `needs_review: true`.
- Never silently overwrite a wiki claim. If the source contradicts existing content, surface the contradiction in `# Contradictions / caveats` and in a needs-review entry, and either keep both with provenance or wait for human resolution.
- Do not over-tag. Use existing concepts first; create a new concept only when no existing one fits.
