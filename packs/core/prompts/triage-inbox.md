# Prompt: triage inbox

**Claude Code users:** invoke `/triage-inbox` instead — same logic, auto-triggered as a skill from natural-language phrasings (`.claude/skills/triage-inbox/SKILL.md`).

**Role:** agent:capture

## When to use

Paste this prompt at the start of a session when there are unprocessed items in
`Inbox/` that need to be classified and routed into the vault.

## Prompt

```text
You are `agent:capture`.

Before doing anything else, read the following files in full:
- `AGENTS.md`
- `_workflows/capture-triage.md`

Then carry out the capture-triage workflow:

1. List every file under `Inbox/` (untracked drop zone — skip
   `Inbox/README.md` and skip everything under `Inbox/_filed/`).
   Process them one at a time.

   **`Inbox/` handling:** this folder is gitignored. For each file:
   - **Binaries (pdf, docx, png, jpg, mp3, mp4, csv, xlsx, etc.)** —
     COPY into the appropriate `Raw/<subfolder>/` path with a
     `YYYY-MM-DD-<slug>.<ext>` filename (tracked). Then create the
     corresponding typed note (Source for articles/papers, etc.).
   - **Markdown / plain text files** — if the file is a *raw capture*
     (paste of an article, transcript chunk, etc.), create
     `Raw/sources/YYYY-MM-DD-<slug>.md` with a header comment
     recording the original `Inbox/` filename + capture date, then
     paste the content. If the file is *synthesized wiki content*
     (a draft Concept page, a draft Project note, a finished decision),
     create `Atlas/<Type>/<Display Name>.md` after
     reconciling its frontmatter against the relevant schema in
     `_schemas/`.
   - **After the typed output is in place**, MOVE the original from
     `Inbox/<file>` to `Inbox/_filed/<today>/<file>`. The empty
     top level of `Inbox/` (minus README + `_filed/`) is the
     "everything filed" signal. Use `mkdir -p Inbox/_filed/<today>`
     once at the start of the run.
   - **If you cannot classify a `Inbox/` file with confidence**,
     leave it in place at the top level (do NOT move into `_filed/`)
     and add a followup entry in `Ops/Followups/` noting what's
     unclear. The file's continued presence at the top level signals
     it still needs human triage.

2. For each item:
   a. Read the item content.
   b. Classify it using the decision aid in `_workflows/capture-triage.md`
      (source, task, project_update, decision, effort, interaction, commitment,
      ask, followup, or journal).
   c. Search the vault for existing notes it might attach to. Prefer linking
      or updating an existing note over creating a new one.
   d. Create or update the appropriate typed note, filling in all fields you
      can infer; leave optional fields empty rather than inventing metadata.
      When you mint a filename from a title/subject, run it through `safe_title`
      first (see AGENTS.md → "A note's title IS its filename"): ` / ` → ` and `
      (bare `/` → `-`), drop `:` and the rest of `\ * ? " < > | # ^ [ ]`, collapse
      spaces — the filename stem and every `[[wikilink]]` must be the one identical string.
   e. Link the note to related projects, areas, people, and topics.
   f. Move the original capture to
      `Inbox/_filed/YYYY-MM-DD/<original-filename>`.
   g. Append one line to `log.md`:
      `<datetime> — agent:capture — triage — [[<note>]] — <one-sentence summary>`

3. Privacy rules:
   - Read `_schemas/_privacy.md` before writing any People-related note.
   - Default sensitivity for `interaction`, `commitment`, and `ask` items is
     `private`. Do not lower a note's sensitivity without explicit user
     instruction.

4. When you cannot classify an item with confidence, leave it at
   the top level of `Inbox/` (do NOT move into `_filed/`) and create
   a followup entry in `Ops/Followups/` noting what is unclear.

5. When all items have been processed, output a short summary:
   - How many items were triaged and their types.
   - Any items left in `unprocessed/` and why.
```

## Notes

When in doubt about an item's type or destination, leave it in `unprocessed/`
rather than forcing a classification — over-triaging creates more noise than it
resolves.
