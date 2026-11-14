# Briefing review — open after the briefing, and a "Today" header

Status: proposal (2026-11-14). Not implemented. Builds on the briefing review contract in
[2026-11-12-briefing-review-design.md](2026-11-12-briefing-review-design.md) and assumes
arjunrajlaboratory/Memex#57 has merged. Nothing here changes that contract until the open questions
are settled and this file moves to "implementing".

## Why

The review form is now the part of the morning the user actually works in. Two follow-ups:

1. **Make it what opens.** Today `daily-briefing` opens the briefing page (Step 5) and then the
   review (Step 5b), so every morning starts with two tabs, and the user reads the briefing before
   reaching the form. The user should choose once whether the review is what opens.
2. **Put the briefing's non-actionable content on top of the form.** The review already holds every
   actionable row (§0, §§3–11). What it lacks is the frame: the Top 3 outcomes, the calendar, what
   is notable today, and a one-paragraph summary. With a "Today" header carrying those, the review
   can stand in for the briefing page. The briefing Markdown stays the source of truth and the
   classic page stays available for anyone who prefers it.

## Part 1 — Open the review after the briefing

### The preference

One key in `_config/overrides.md`, next to `review_surface`:

```
briefing_open: review | both | briefing | none
```

| value | after the briefing is written |
| --- | --- |
| `review` | Open the review form only. The classic briefing is one click away (a link in the Today header and in the chat report). |
| `both` | Open the classic briefing, then the review (today's behaviour). |
| `briefing` | Open the classic briefing only. The review is built and linked in the report, not opened. |
| `none` | Open nothing; report the links. Same as saying "don't open it" every day. |

`review_surface` keeps deciding *where* the review opens (widget, server, page, artifact);
`briefing_open` decides *what* opens. They are independent.

**Absent key = not asked yet.** The skill behaves as `both` (no behaviour change for anyone who
has not answered) and asks once.

Options considered for where the preference lives:

| option | for | against |
| --- | --- | --- |
| **A. `_config/overrides.md` key** (recommended) | Already where `review_surface` lives; vault-scoped, so it follows the vault across Claude Code, Desktop and scheduled runs; user-owned, so `/update` never overwrites it; documented in `CLAUDE.base.md` "Known override keys". | The skill has to write to a user-owned file. |
| B. Memex Desktop setting | Native UI toggle. | Not seen by Claude Code or scheduled runs; two places to look. |
| C. Agent memory / `log.md` | No file edit. | Not durable or inspectable; different per host. |

### Asking once

In Step 6 (report back), when `briefing_open` is absent and the run is interactive, the skill adds
one closing question:

> Want the review form to be what opens after each briefing? It now carries the Top 3, calendar and
> highlights at the top. **review** (recommended) · **both** (today's behaviour) · **briefing** · **none**

On an answer, the skill adds `briefing_open: <value>` to `_config/overrides.md` (appending one line;
creating the file with a frontmatter block if it is missing; never rewriting other lines), appends a
`log.md` line, and confirms in one sentence how to change it later. On no answer, it writes
`briefing_open_asked: <date>` instead, and asks again only after 7 days, so an ignored question does
not reappear every morning. A user can also say "always open the review" at any time; the skill
treats that as an answer.

The question is never asked in a scheduled or headless run (there is nobody to answer), and is not
asked until the Today header (Part 2) ships, since `review` is only a fair default once the form
shows the briefing's frame. If Part 1 ships alone, the question omits the "carries the Top 3" clause
and recommends `both`.

### How each surface opens

Step 5 and Step 5b merge into one "Open" step driven by `briefing_open`:

| host | `review` | `both` | `briefing` / `none` |
| --- | --- | --- | --- |
| **Memex Desktop** (has `show_artifact`, no `show_widget`) | Build the widget surface with `--max-bytes 4000000` and show it with `show_artifact` (one page in practice). | Show the briefing note (`show_artifact` with `path: Ops/Briefings/<date>.md`), then the review last so it is the active panel. | Briefing note only / nothing; review link in chat. |
| **Claude Code with an inline-widget host** | Inline widget page(s). | Quartz briefing page + widget. | Briefing page / nothing. |
| **Quartz up** (`review_surface: server`, or `auto` with no widget host) | `open http://localhost:<port>/review/<date>`. | Briefing page, then `/review/<date>` (opened last so it is the front tab). | Briefing page / nothing. |
| **Neither** (`page` surface) | `open outputs/briefing-review/<date>.html`. | Briefing page + review page. | As above. |
| **`review_surface: artifact`** | Publish the private artifact (redacted, see Part 2), and give the link. | Also open the local briefing page. | Build nothing remote; the artifact is never published without being opened. |
| **Scheduled / headless** | Never open, show, or publish anything. Build the `page` surface (a local file, harmless), check whether Quartz answers, and put exactly one review link in the report and the log: `/review/<date>` when Quartz is up, else the `outputs/…html` path. | Same, plus the briefing link. | Briefing link only. |

A run counts as **headless** when the skill was started by a scheduled task, a `claude -p`
invocation, or any prompt that says it is unattended (the scheduled-task prompts in this repo will
say so explicitly; see open question 4). The existing "don't open it" / "just write the file"
phrases keep meaning `none` for that run without changing the preference.

The briefing Markdown also gains one line under its frontmatter, written in every mode, so the
classic page always links to the form and a headless run's output is reachable from the site:

```
> Review: [answer today's items](/review/<date>) · <N> items, <K> carried
```

(Quartz resolves the absolute path under its `--baseDir`; in Obsidian it is a dead link, which is
acceptable. Alternative: omit the line and rely on the chat report.)

### No review items

An items file with zero items is valid today and the form renders "No reviewable items".

- With the Today header shipped, the form is still the day's dashboard, so `review` still opens it.
  The empty state reads "Nothing to answer today", the Submit and Reset buttons are hidden, the
  progress bar is hidden, and no draft is ever saved (no empty answers file, so carry-over for
  tomorrow correctly skips this day).
- Without the header (Part 1 alone), `review` falls back to opening the classic briefing, and the
  report says "No review items today."
- Headless: report "No review items" and no review link.
- Desktop widget: an empty-items widget is only the header plus a one-line empty state, well inside
  the budget.

## Part 2 — A "Today" header on the review form

### What moves into the header

| briefing section | in the header? | how |
| --- | --- | --- |
| Summary (new) | yes, first | 1–3 sentences the skill writes: the shape of the day. The briefing Markdown gets the same paragraph under the title so both views agree. |
| §1 Top 3 outcomes | yes | Numbered list, wikilinks kept. Each outcome may list the review rows it depends on (`item_ids`); clicking the outcome scrolls to the first of them. |
| §2 Calendar / time map | yes, today only | Compact time column + title + the "come prepared with" line, collapsed to one line per event. The next-7-days tail stays in the classic briefing. |
| §9 "Upcoming meetings" | merged into the calendar | It is skipped by the items parser today and overlaps §2. Today's meetings only. |
| Notable signals | yes | The comms-coverage warning (always first when present, never collapsible), the one "Notable" line from the Step 6 report, the count of carried items, and on the artifact surface the withheld count. At most 5 entries. |
| §12 Starter prompts | no (open question 3) | Long, paste-ready paragraphs. Option: a mouse-only "Copy starter prompt" button per outcome. |
| §13 End-of-day prompts | no | Belong to the evening `shutdown-review`. |
| §0, §§3–11 | no | Already the form's rows. |

### Where the header comes from

| option | for | against |
| --- | --- | --- |
| **A. A read-only `context` block in `items.json`** | Structured, so redaction can work per entry (each calendar event, outcome and signal carries its own `target`/`sensitivity`); deterministic to render; the skill already writes this file in Step 3b from the same synthesis; `validate` can check it. | One more thing for the skill to write; can drift from the Markdown if the agent writes them inconsistently. |
| B. Parse §1/§2 from the briefing Markdown at build time | No skill change; always matches the Markdown. | §1/§2 are free-form prose, so parsing is brittle; no per-entry sensitivity, so on the artifact surface everything is unknown and therefore withheld; the summary has no section to parse. |
| **C. A, with B as the fallback** (recommended) | Best of both: structured when the skill wrote it, still a header for older briefings, hand-written briefings and the Markdown-only path. | Two code paths to test. |

`context` is additive and optional. `validate_items` ignores unknown top-level keys today, so older
engines keep working with newer items files; the schema stays `memex.briefing-items/v1`, and
`items_hash` (ids only) is unchanged. `context` is never part of answers, the text export, `plan`,
`carryover` or the ledger.

```json
{
  "schema": "memex.briefing-items/v1",
  "date": "2026-11-15",
  "context": {
    "summary": "Heavy meeting morning; the afternoon is the only block for the R01 aims page.",
    "summary_sensitivity": "private",
    "outcomes": [
      {"text": "Finish the [[R01 resubmission]] specific aims page", "target": "Atlas/Projects/R01 resubmission.md",
       "item_ids": ["task:Ops/Tasks/Draft specific aims"], "sensitivity": "normal"}
    ],
    "calendar": [
      {"start": "09:00", "end": "09:30", "title": "Lab meeting", "prep": "bring the imaging QC plots",
       "people": ["[[Robin Park]]"], "target": "Ops/Calendars/2026-11-15 Lab meeting.md", "sensitivity": "normal"},
      {"start": "13:00", "end": "14:00", "title": "1:1 with [[Dana Lee]]", "sensitivity": "private"},
      {"all_day": true, "title": "Grant deadline (internal)", "sensitivity": "normal"}
    ],
    "signals": [
      {"kind": "coverage", "text": "Slack did not scan 2026-11-14 18:00–23:59 (rate limit); absence there is inconclusive."},
      {"kind": "notable", "text": "[[Atlas/Projects/Imaging pipeline]] next_review is 9 days overdue.", "sensitivity": "normal"}
    ],
    "source": "items"
  },
  "items": []
}
```

Rules: every entry is optional; `text`, `title`, `prep` and `summary` are Markdown with wikilinks
kept; times are local `HH:MM`; `sensitivity` follows the same inheritance as items (unknown counts as
`private`). The fallback parser sets `"source": "markdown"` and leaves every `sensitivity` unset.
Caps applied by the build (warn on stderr when hit): summary 600 characters, 3 outcomes,
25 calendar entries, 5 signals, 200 characters per `prep`.

### Redaction on the artifact surface

Calendar titles, attendee names and the free-text summary are the most personal things in the
briefing, so the header gets at least the items' protection.

- Each context entry's **effective sensitivity** uses the existing `effective_sensitivity`: the
  strictest of its own `sensitivity`, its `target` note's frontmatter, and every note wikilinked
  from its text, title, prep and `people`. Unknown counts as `private`. A plain-text name (an
  attendee with no person note) cannot be checked, so the skill is told to wikilink people or leave
  them out, and any calendar entry with a non-empty `people` that does not fully resolve is
  `private`.
- Per `--redact` level:

| entry | `private` (default) | `titles` | `sensitive` |
| --- | --- | --- | --- |
| normal calendar entry | in full | in full | in full |
| private calendar entry | **busy block**: time range only, labelled "Busy" | time + the leading wikilink's title, or "(private event)"; no prep, no people | in full |
| sensitive calendar entry | busy block | busy block | busy block |
| outcome | normal shown; private/sensitive dropped and counted | private → leading title only | private shown |
| signal | normal shown; others dropped. The coverage warning has no personal content and is always shown. | as outcomes | as outcomes |
| summary | **dropped** | dropped | shown unless `summary_sensitivity` is `sensitive` |

  Busy blocks keep the time map useful without saying what the time is for. The summary is free
  text that can name anyone without a link, so it is dropped at the two stricter levels whatever its
  stated sensitivity.
- The withheld notice gains the header's count ("2 calendar entries shown as busy, 1 outcome
  withheld").
- `item_ids` on the artifact surface are mapped through the same alias function, and an id whose row
  was withheld is removed.
- Local surfaces (page, server, widget, Desktop) are not redacted, as today.
- The Markdown-fallback header has no sensitivities, so on the artifact surface at the default level
  every entry except the coverage warning is withheld and every event becomes a busy block. That is
  the intended, safe result.

### Widget size budget and pagination

- The header renders on **page 1 only**. Later pages show a one-line stub ("Today: 3 outcomes · 6
  events · see part 1") so a user who opens part 2 first knows where it went.
- `paginate_widget` measures page 1 with the header: `fits(items, page_index)` renders the header
  when the page index is 1. The first section moves to page 2 if it does not fit beside the header,
  and it is split by rows as today if needed. A page holding only the header counts as non-empty.
- If the header alone with the script and styles exceeds `--max-bytes`, the build trims it in this
  order and warns: drop `prep` lines, drop calendar entries after the 10th, drop signals other than
  coverage, shorten the summary. It never fails the build because of the header.
- Expected size: about 2–6 KB of payload on a normal day, against a 200 KB default budget (about 50 KB
  of which is the script and styles) and 4 MB in Desktop, so pagination changes rarely.
- The header is never in the text export, including Part exports, so export parsing is unchanged.

### Markdown fallback

When the items file has no `context` (older briefing, hand-written briefing, or no items file at
all), `build` parses one from the Markdown:

- **Summary**: the first paragraph after the H1 and before `## 0` / `## 1`, if there is one.
- **§1**: each list item becomes an outcome (no `item_ids`).
- **§2**: each list item becomes a calendar entry. A leading `HH:MM`, `HH:MM–HH:MM` or `H:MM am/pm`
  (optionally in bold) becomes `start`/`end`; a line without a time is kept with only `title`; a
  `↳` or indented child becomes `prep`. "Upcoming meetings" under §9 adds today's entries not
  already in §2 (matched by time and title).
- **Signals**: the §0 coverage warning only.
- Gap notes such as "(no calendar data available …)" are shown as one muted line, not as an event.
- `items --write` writes the parsed `context` together with the parsed items; it still never
  overwrites an existing items file.

### Keyboard flow and accessibility

The form is keyboard-first and the header must not change that.

- Nothing in the header is in the tab order: wikilinks get `tabindex="-1"` (as in rows), and any
  button (collapse, copy starter prompt) is mouse-only, with `mousedown` default prevented as for
  pills. The first Tab still lands on row 1's note; Shift-Tab from row 1's note does not enter the
  header.
- The header is a `<section class="rv-today" aria-labelledby="rv-today-h">` with an `<h2>` "Today",
  so screen readers can jump to it by landmark or heading without it costing keyboard users a stop.
- It scrolls with the page (only the existing progress bar is sticky), so it never covers a focused
  row. `scrollIntoView` for a focused row is unchanged.
- `Alt+T` collapses or expands the header (it does not take focus); the collapsed state is remembered
  per surface in localStorage (best effort, silent when unavailable). Collapsed, it is one line:
  "Today · 3 outcomes · 6 events · 1 signal". The coverage warning stays visible when collapsed.
- Clicking an outcome with `item_ids` focuses that row's note, the same as clicking a row.
- The hints line gains `Alt+T today`.

### Keeping the classic briefing

The classic briefing is always written and always reachable:

- `briefing_open: both` or `briefing` (Part 1) keeps it opening every morning.
- The Today header ends with a link, "Open the full briefing" (to `/Ops/Briefings/<date>` on
  server/page surfaces; in Desktop, the vault note; plain text on the artifact surface, which has no
  local links).
- For a user who wants the classic page and finds the header redundant there is an optional second
  key, `review_today: on | off` (default `on`), which hides the header. Recommended only if someone
  asks; `both` users can collapse the header with `Alt+T` and it stays collapsed.

## Changes, by file (when implemented)

- `packs/core/skills/daily-briefing/SKILL.md`: Step 3 writes the summary paragraph and the review
  link line; Step 3b writes `context`; Steps 5/5b merge into one Open step driven by `briefing_open`
  with the host table above; Step 6 asks the one-time question and reports the review link in
  headless runs.
- `packs/core/workflows/daily-briefing.md` and `_schemas/briefing.md`: the summary paragraph and the
  review link line.
- `hardened/contract/CLAUDE.base.md`: document `briefing_open` (and `review_today` if adopted) under
  "Known override keys".
- `hardened/scripts/briefing_review.py`: `validate` checks `context`; `parse_context_markdown`;
  `redact_context` beside `redact_items`; `build_payload` adds `context`; `paginate_widget` is page-aware;
  empty-items mode.
- `hardened/scripts/briefing_review_app.js` / `.css`: `renderToday()` above the body, `Alt+T`,
  empty-state without Submit.
- Desktop `app/src/main/agent.ts` prompt: in `review` mode show only the review; in `both`, show the
  review last.
- Tests: `tools/test_briefing_review.py` (context validation, fallback parsing, redaction table,
  page-1 pagination, trimming), `tests/briefing_review_e2e.mjs` (Tab order skips the header, `Alt+T`,
  empty state).

## Recommendation

1. Ship Part 2 first (the header, with `context` in items.json and the Markdown fallback), with
   `briefing_open` absent meaning `both`, so nothing about what opens changes yet.
2. Then ship Part 1: the `briefing_open` key, the one-time question recommending `review`, the merged
   Open step, and the headless link-only path.
3. Keep `review_today` out until someone asks for it.

## Open questions for the user

1. **Default once asked.** Should the question recommend `review`, or should `review` simply become
   the default for new vaults (with existing vaults asked once)?
2. **Calendar horizon.** Today only, or today plus tomorrow morning (useful when the briefing is read
   the evening before)?
3. **Starter prompts.** Leave §12 out of the header, or add a mouse-only "Copy starter prompt" button
   per outcome?
4. **Headless detection.** Is an explicit marker in scheduled-task prompts ("unattended run") enough,
   or should the skill also treat a missing TTY / `claude -p` as headless?
5. **Busy blocks.** On the artifact surface, are time-only "Busy" blocks for private events
   acceptable, or should private events be hidden entirely (the time itself can be telling)?
6. **The review link line in the briefing Markdown.** Useful on the site, but a dead link in
   Obsidian. Keep it?
7. **Re-asking.** Is "ask again after 7 days if ignored" right, or ask exactly once ever?
