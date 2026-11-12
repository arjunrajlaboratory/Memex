# Briefing review — design and shared contract

Status: implementing (2026-11-12). This file is the contract every part of the feature builds against.

## Goal

The daily briefing surfaces ~100 actionable items. Answering them in chat is slow and error-prone.
The briefing review turns them into one keyboard-first form: per-row action pills, a free-text note,
and a submit step that hands structured answers back to the agent, which applies them.

## Pieces

| Piece | Engine path | Vault path |
| --- | --- | --- |
| Generator / CLI (stdlib-only Python) | `hardened/scripts/briefing_review.py` | `scripts/briefing_review.py` |
| Client app (one JS file, one CSS file, no deps) | `hardened/scripts/briefing_review_app.js`, `briefing_review_app.css` | `scripts/…` |
| Quartz serve routes | `hardened/quartz/quartz/cli/handlers.js` | `quartz/quartz/cli/handlers.js` |
| Skill: emit items + render surface | `packs/core/skills/daily-briefing/SKILL.md` | `.claude/skills/…` |
| Skill: apply answers | `packs/core/skills/apply-review/SKILL.md` (new) | `.claude/skills/…` |
| Memex Desktop bridge | `app/src/…` | — |

`hardened/scripts/` is copied flat (files only) into the vault's `scripts/`, so all three script
files sit side by side and the Python locates the JS/CSS next to itself.

## Data files (all in the vault)

- `Ops/Briefings/<date>.items.json` — structured items, written by daily-briefing next to the `.md`.
- `Inbox/reviews/<date>.json` — the user's answers (written by the server route, or by
  `briefing_review.py save` from a pasted export).
- `Inbox/reviews/<date>.ledger.json` — idempotent apply ledger.
- `outputs/briefing-review/<date>*.html` — generated pages (gitignored).

`Inbox/reviews/` is a system slot like `Inbox/comms/`: never triaged as a capture.

### items.json (`schema: "memex.briefing-items/v1"`)

```json
{
  "schema": "memex.briefing-items/v1",
  "date": "2026-11-12",
  "generated_at": "2026-11-12T07:30:00-05:00",
  "items": [
    {
      "id": "task:Ops/Tasks/Send revised budget to Dana",
      "section": "0",
      "section_title": "State confirmation needed",
      "label": "#3",
      "group": "",
      "kind": "task",
      "target": "Ops/Tasks/Send revised budget to Dana.md",
      "text": "[[Send revised budget to Dana]] — `status: in_progress` (due 2026-11-10).",
      "detail": ["signal: you emailed Dana the draft 2026-11-09"],
      "status": "in_progress",
      "due": "2026-11-10",
      "signal": "you emailed Dana the draft 2026-11-09",
      "threads": ["gmail:18c2f0a1"],
      "sensitivity": "normal",
      "also_in": ["3"],
      "actions": ["do", "done", "defer", "waiting", "rescope", "cancel", "keep"]
    }
  ]
}
```

Rules:

- Required per item: `id`, `section`, `kind`, `text`. Everything else is optional. `actions` defaults
  from `kind`. `text` and `detail` are the briefing's Markdown (wikilinks kept).
- `id` is stable across days: `<kind>:<target without .md>` when the item has a target note;
  otherwise `<kind>:<date>:<section>:<8-hex sha1 of the plain text>`. Ids are unique within a file.
  An item that appears in several sections is emitted once, with the other sections in `also_in`.
- `section` is the briefing section number as a string (`"0"`–`"11"`), or `"asks"` for a
  principal-asks section. `section_title` may include the `###` subsection (`"People — I owe"`).
- Display number `n` is the 1-based index in `items` order; it is never stored in items.json.
- `sensitivity`: `normal | private | sensitive`, inherited from the target note (default `private`
  when unknown).
- Carry-over fields, set by the generator when an item also appeared in an earlier review:
  `carried_from` (date) and `previous` (`{date, action, params, note}`), see Carry-over.

### Kinds and actions

`do` ("Do it" — the agent goes ahead and does the work) is always the first action of every kind.

| kind | actions (in pill order) |
| --- | --- |
| `task` | do, done, defer, waiting, rescope, cancel, keep |
| `proposal` | do, create_task, skip |
| `person` | do, touched, push, agenda, keep |
| `project` | do, bump, pause, drop, keep |
| `capture` | do, file, ingest, dismiss |
| `tracker` | do, defer, dismiss, keep |
| `followup` | do, done, defer, create_task, drop |
| `decision` | do, decide, defer, create_task, drop |
| `job` | do, skip, keep |
| `item` (Markdown fallback, unknown kind) | do, done, defer, create_task, drop, keep |

Action registry (label, parameter, colour group):

| action | label | param | meaning for apply |
| --- | --- | --- | --- |
| `do` | Do it | — | agent performs the work now; outbound messages stay drafts; never self-closes |
| `done` | Done | — | close via close-task (task) / mark acted_on (followup) |
| `defer` | Defer | `date` | move due/scheduled/surface/next_check date |
| `waiting` | Waiting | `who` | status waiting, record on whom |
| `rescope` | Re-scope | — | note says how; agent edits the task |
| `cancel` | Cancel | — | close-task as canceled |
| `keep` | Keep | — | no change; carries over |
| `create_task` | Make task | `title` (prefilled from item) | create-task |
| `skip` | Skip | — | decline the proposal |
| `touched` | Touched | — | bump last_contact, recompute next_touch |
| `push` | Push | `date` | set next_touch |
| `agenda` | Agenda | — | add to the person's next meeting agenda |
| `bump` | Bump review | `date` | set next_review |
| `pause` | Pause | — | project status paused |
| `drop` | Drop | — | drop / archive |
| `file` | File | — | triage-inbox files it |
| `ingest` | Ingest | — | ingest-source |
| `dismiss` | Dismiss | — | discard |
| `decide` | Decide | — | note carries the decision → capture-decision |

`date` params accept ISO dates and shortcuts (`today`, `tom`/`tomorrow`, `mon`…`sun` = next such
weekday strictly after the briefing date, `+3d`, `+2w`, `eow`, `eom`, `11/20`, `nov 20`). The client
resolves a shortcut to ISO on blur and shows the resolved date; the Python `save` path resolves again
relative to the review date, and rejects nothing (an unparseable value is kept verbatim in
`params.date_raw` for the agent to interpret).

### Answers file (`schema: "memex.briefing-review/v1"`)

```json
{
  "schema": "memex.briefing-review/v1",
  "date": "2026-11-12",
  "submitted_at": "2026-11-12T08:05:11-05:00",
  "surface": "server",
  "submitted": true,
  "answers": [
    {
      "id": "task:Ops/Tasks/Send revised budget to Dana",
      "n": 3,
      "action": "defer",
      "params": {"date": "2026-11-16"},
      "note": "ping Dana with the link first",
      "kind": "task",
      "target": "Ops/Tasks/Send revised budget to Dana.md",
      "text": "[[Send revised budget to Dana]] — status: in_progress (due 2026-11-10)."
    }
  ],
  "unanswered": ["person:Atlas/People/Robin Park"]
}
```

`action` may be `null` when only a note was typed (exported as `NOTE`). `submitted: false` marks an
autosaved draft (server surface saves drafts as you type; apply ignores drafts unless told).
Unanswered rows mean "leave as is".

### Text export (clipboard and `sendPrompt`)

```
Briefing review — 2026-11-12 (apply with the apply-review skill)

§0 State confirmation needed
- [3] #3 DEFER(2026-11-16) — [[Send revised budget to Dana]] — status: in_progress (due 2026-11-10).
    → ping Dana with the link first
- [7] DO — [[Draft reviewer response]] — …

(41 rows left unanswered — leave as is.)
```

Line grammar: `- [<n>]` + optional ` <label>` + ` <ACTION>` + optional `(<param>)` + ` — ` + item
plain text truncated to ~140 chars (the leading `[[wikilink]]` is always kept whole). The note is on
the next line as `    → <note>` with newlines joined by ` / `. ACTION is the action id upper-cased
(`CREATE_TASK`), or `NOTE`. `[n]` maps back through items.json order.

## CLI contract — `python3 scripts/briefing_review.py <command>`

Vault root = parent of the script's directory, overridable with `--vault <path>` (global option) or
`MEMEX_VAULT`. `<date>` is optional everywhere and defaults to the latest daily briefing.

| command | behaviour |
| --- | --- |
| `items [date] [--write]` | Print the normalized items JSON. Uses `Ops/Briefings/<date>.items.json` when present, else parses the Markdown (fallback, `kind` inferred from the wikilink target folder, else `item`). `--write` saves the fallback result as `<date>.items.json` (never overwrites an existing one). |
| `validate [date\|path]` | Validate an items.json; exit 1 and print problems on failure. |
| `build [date] [--surface page\|server\|widget\|artifact] [--out PATH] [--stdout] [--site URL] [--max-bytes N] [--redact private\|sensitive\|none]` | Generate the review UI. Default surface `page`. Prints the written path(s), one per line. See Surfaces. |
| `serve [--port N] [--host 127.0.0.1]` | Stdlib HTTP server with the same routes as the Quartz serve handler (for vaults not running Quartz). Loopback only. |
| `save [date] [--from-export] [--surface NAME] [--draft]` | Read stdin (answers JSON, or with `--from-export` the text export) → validate against the items → write `Inbox/reviews/<date>.json` atomically. Prints the path. With `--from-export` and no date, the date comes from the export header. |
| `plan [date] [--json] [--include-draft]` | Print the apply plan: every answer not yet in the ledger, with its routing (see Apply). |
| `mark [date] <id> --result applied\|skipped\|failed\|drafted [--summary TEXT]` | Record one answer in the ledger. |
| `annotate [date]` | Rewrite the managed `Review resolved` block in the briefing's §0 from the ledger (idempotent; creates §0 heading only if it exists already, otherwise appends a `## Review resolved` section at the end). |
| `carryover [date] [--json]` | For the review of `<date>`: list the items the next briefing must carry — unanswered, `keep`, and `defer` whose date is on/before the next day — plus every answer, for pre-fill. |

Exit codes: 0 ok, 1 validation / not found, 2 usage.

### Server routes (identical in Quartz `site:serve` and `briefing_review.py serve`)

- `GET /review` and `GET /review/` → 302 to `/review/<latest date>`.
- `GET /review/<date>` → the `server`-surface page, built fresh on each request
  (`build <date> --surface server --stdout`).
- `GET /api/review/<date>` → the stored answers JSON, or `404`.
- `POST /api/review/<date>` → body = answers JSON (≤ 2 MB), piped to `save <date> --surface server`
  (`?draft=1` adds `--draft`). `200 {"ok":true,"path":…}` or `400 {"ok":false,"error":…}`.
- Loopback only; `POST` requires `Content-Type: application/json` and, when an `Origin` header is
  present, an origin whose host is `localhost` or `127.0.0.1` (CSRF guard). `<date>` must match
  `^\d{4}-\d{2}-\d{2}$`.

The Quartz handler shells out to `python3 <vault>/scripts/briefing_review.py` (vault = `argv.directory`
resolved); it never emits a static review page, so nothing reaches a public build.

## Client app

One implementation (`briefing_review_app.js` + `.css`) inlined into every surface. The page provides
`window.__REVIEW__ = {date, items, actions, kinds, surface, site, previous, page, pages}`.

Kept from the prototype: keyboard-first (Tab / Shift-Tab move between rows' note fields only; links
and pills are out of the tab order), focused-row highlight, answered rows get a coloured left border,
clicking a selected pill clears it, auto-growing note field, section headings and group labels,
`also in §3` tag, answered counter, dark mode, works over `file://`, storage failures are silent.

New:

- Pills come from the row's `actions`. `Alt+1…9` picks the row's Nth pill (`Alt+1` is always
  "Do it"), `Alt+0` clears. The focused row shows the digit on each pill.
- Actions with a param reveal a small inline input next to the pills (date / who / title); choosing
  the pill focuses it, Enter or Tab returns to the note. `create_task` prefills the title from the
  item's leading wikilink or first words.
- Yesterday's answer for a carried item is shown as a muted chip (`yesterday: DEFER → Mon`); one
  click (or `Alt+R`) re-applies it.
- `Cmd/Ctrl+Enter` submits.

State: `{[id]: {action, params, note}}`, keyed by item id. Storage and submit depend on the surface:

| surface | draft storage | submit |
| --- | --- | --- |
| `page` | localStorage | clipboard export (shown in a panel) |
| `server` | localStorage + debounced `POST …?draft=1`; initial state from `GET /api/review/<date>` | `POST /api/review/<date>`; clipboard stays as a secondary button |
| `widget` | localStorage (best effort) | `sendPrompt(export)` when the host provides it; else `window.parent.postMessage({type:"memex:sendPrompt", text}, "*")` when framed (Memex Desktop); clipboard as the last fallback |
| `artifact` | `db` doc `reviews/<date>` (debounced, one write at a time) | same doc with `submitted: true` |

### Surfaces

- **page** — `outputs/briefing-review/<date>.html`, self-contained, opens from `file://`.
- **server** — same document, served at `/review/<date>`.
- **widget** — an HTML *fragment* (`<style>…</style><div id="review-root"></div><script>…</script>`,
  no doctype/html/head/body) for a host that renders inline HTML widgets and exposes
  `sendPrompt(text)`. Compact layout. If the fragment exceeds `--max-bytes` (default 60000) it is
  split by section into `…widget.1.html`, `…widget.2.html`, …; each page submits its own rows.
- **artifact** — a full page for a private claude.ai Artifact with `capabilities: {db: {}, user: {}}`.
  Sensitivity gate (`--redact`, default `private`): `sensitive` items are always dropped from the
  payload; with `--redact private`, `private` items keep only their leading wikilink title, section
  and pills (no signal, detail, status prose); `--redact sensitive` keeps private text; `none` is
  refused for this surface. The page shows how many items were withheld as local-only. Wikilinks
  render as plain text (no localhost links).

The preferred surface is a vault preference in `_config/overrides.md`:
`review_surface: auto | widget | server | page | artifact` (default `auto` = widget when the session
has an inline-widget tool, else server when the Quartz site is up, else page).

## Apply (`apply-review` skill)

Input: `Inbox/reviews/<date>.json` (a pasted export is first converted with `save --from-export`).
`plan` yields, per unapplied answer, a route:

| kind / action | route |
| --- | --- |
| task `done` / `cancel` | close-task |
| task `defer` / `waiting` / `rescope`; person `touched` / `push`; project `bump` / `pause` / `drop`; followup `done` / `defer` / `drop`; tracker `defer` | direct frontmatter edit by the owning convention, plus a log line |
| any `create_task` | create-task |
| person `agenda` | meeting-agenda if installed, else append to the person's agenda section |
| capture `file` → triage-inbox · `ingest` → ingest-source · `dismiss` → move to `Inbox/_filed/dismissed/` |
| tracker `do` | run-trackers |
| decision `decide` | capture-decision |
| any `do`, and any note that is not a pure status change | agent executes / routes it (`route: "agent"`) |
| `keep`, `skip` | no-op, recorded in the ledger |

Hard rules: outbound messages are always drafts; the user's `done` answer is what authorizes a close
(a `do` never self-closes — it ends at `needs_review` with a work-log entry); `sensitive` items are
never sent to an external service; every applied answer is recorded with `mark`; re-running is safe
because `plan` skips ledger entries whose answer fingerprint (`sha1(id|action|params|note)`) is
unchanged. After applying, `annotate` records what was resolved in the briefing's §0.

Ledger shape: `{"schema":"memex.briefing-review-ledger/v1","date":…,"entries":{"<id>":{"fingerprint":…,"result":…,"summary":…,"at":…}}}`.

## Carry-over

The next daily briefing runs `carryover <previous date>` during input gathering. Unanswered items,
`keep`, and due `defer` items are carried into the matching sections with `carried_from`; each item's
`previous` answer is attached so the review page can pre-fill the chip. Items whose answer was
applied (`done`, `cancel`, `drop`, `dismiss`, `skip`, `create_task`, …) are not carried.

## Not in this pass

MCP App surface (a Memex MCP server exposing the review UI as an MCP Apps resource and `apply` as a
tool). The CLI is the seam it would wrap.
