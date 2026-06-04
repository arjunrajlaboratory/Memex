# Prompt: new tracker wizard

**Role:** agent:librarian (proposing) + user (deciding)

## When to use

You've noticed a topic, person, project, or organization you want to stay current on — and you want the vault to do the watching automatically on a cadence. Use this prompt to walk through all the decisions before any file is written.

## Prompt

```text
You are `agent:librarian` running the new-tracker wizard.

Ask the user each question below **one at a time**, waiting for their answer before
continuing. Do not batch questions. Confirm each answer before moving on.

1. **Subject** — What one short phrase describes what we're tracking?
   (This becomes the file title: `Tracker - <Subject>.md`.)

2. **Watches** — Which wiki pages does this tracker keep fresh?
   List at least one. Valid types: Concept / Project / Source / Person / Organization.

3. **Cadence** — How often should the tracker run?
   Options: daily / weekly / biweekly / monthly / quarterly / event-driven / adhoc.
   Don't default to weekly — ask what the subject's actual change velocity is, then
   suggest a cadence that matches it. If the user is unsure, offer two options and
   explain the trade-offs.

4. **Search strategy** — How should the tracker look for new information?
   Options: web / rss / github_releases / arxiv / newsletter / manual_prompt / mcp_tool.
   More than one is fine.

5. **Queries and/or sources_to_revisit** — What concrete search strings and URLs
   should the tracker use? Ask for at least one of each that applies.

6. **Domains to prefer / exclude** — Are there domains that should be trusted
   preferentially, or ignored? (Optional — press Enter to skip.)

7. **Freshness window days** — Only surface items newer than this many days on
   each run. Default 30. Is that right, or should it be wider/narrower given the
   cadence chosen?

8. **Update targets** — When something material lands, which wiki pages should be
   considered for edits? (Usually a subset of `watches:`.)

9. **Auto-update wiki** — Should the librarian edit `update_targets` automatically,
   or always queue a human-review task first? Default: false (human review).

10. **Reliability floor** — Minimum source reliability to act on.
    Options: high / medium / low. Default: medium.

11. **Sensitivity** — Use `sensitive` only if this tracker touches health, finance,
    or legal data (forces `manual_prompt` or vetted MCP tools only). Default: normal.

12. **Forbidden actions** — Any actions beyond the defaults (`send_external_email`,
    `make_purchases`) to add to `forbidden_actions:`? (Optional.)

13. **What "material change" means** — Write one paragraph that a future agent can
    use as a precise criterion. What counts as worth a digest entry? What doesn't?

---

Once you have all answers, do the following:

**A — Write the tracker file**
Create `Atlas/Trackers/<Subject>.md` using `_templates/tracker.md` as
the starting frame and `_schemas/tracker.md` for field semantics. Populate every
field collected above. Set:
- `last_checked:` today's date
- `next_check:` today + one cadence interval
- `miss_count: 0`
- `last_digest:` (empty)
- `created:` and `updated:` today

Fill the body sections:
- `# Subject` — 2–3 sentences expanding on the subject phrase
- `# Why this matters` — what decisions or projects depend on staying current
- `# What "material change" means` — paste the user's answer from step 13
- `# Search recipe` — numbered steps using the queries/sources from steps 4–5
- `# Update rules` — how to revise `update_targets` when something material lands
- `# History` — single bullet: `- <today> — tracker created`

**B — Append to log**
Append one line to `log.md`:
`<datetime> — agent:librarian — new-tracker — [[<Subject>]] — tracker created`

**C — Suggest first run**
End with a ready-to-paste invocation:
`Run tracker: [[<Subject>]]` (or the equivalent `run-trackers` prompt
parameterized to this tracker's `id:`).
```

## Notes

Pick a slow cadence first. A monthly tracker you actually read is worth more than a weekly one you mute. Trackers are cheap to create and expensive to maintain — start sparse, speed up only when you feel the gap.
