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
| Quartz serve routes | `hardened/quartz/quartz/cli/handlers.js` + `review-routes.js` | `quartz/quartz/cli/…` |
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
- `Inbox/reviews/.lock` — lock file; every read-check-write of the answers file and the ledger
  holds an exclusive lock on it (`fcntl.flock`; `msvcrt.locking` on Windows; unlocked where
  neither works).
- `outputs/briefing-review/<date>*.html` — generated pages (gitignored).
- `outputs/briefing-review/<date>.artifact-map.json` — artifact alias → item id map (local only,
  gitignored via `outputs/**`, never published).

New answers, ledger and alias-map files are created `0600`; rewriting an existing file (including
`annotate` rewriting the briefing) keeps that file's mode.

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
  from `kind`; a custom list must start with `do` and only narrow the kind's own actions (anything
  else is a validation error, so `plan` can always route it). `text` and `detail` are the briefing's Markdown (wikilinks kept).
- `id` is `<kind>:<target without .md>` when the item has a target note (stable across days);
  otherwise `<kind>:<date>:<section>:<8-hex sha1 of plain_text(text)>` (wikilinks kept), which is
  per-day. The daily-briefing skill never computes it by hand: it runs `briefing_review.py id`,
  which the Markdown fallback uses too, and a carried target-less item keeps the id reported by
  `carryover`. Ids are unique within a file.
  An item that appears in several sections is emitted once, with the other sections in `also_in`.
- `section` is the briefing section number as a string (`"0"`–`"11"`), or `"asks"` for a
  principal-asks section. `section_title` may include the `###` subsection (`"People — I owe"`).
- Display number `n` is the 1-based index in `items` order; it is never stored in items.json.
- `sensitivity`: `normal | private | sensitive`, inherited from the target note (default `private`
  when unknown). Redaction never trusts this field alone; see the artifact surface.
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
  "items_hash": "a1b2c3d4",
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

`items_hash` is the first 8 hex of `sha1` of the item ids joined by `\n`, in items order. Every
surface's payload carries it; clients send it with their answers and `save` stores the current
one. Answers are matched by `id`; a different `items_hash` on input only prints a warning.
`superseded` (written by `save`, capped at 500) maps the fingerprint of every answer a *submitted*
file lost to `{id, n, action, params, note, text}`, so `mark --fingerprint` can still describe the
answer that was planned.

Input validation (`save`, both servers): `id` a non-empty string (≤ 1000 chars), `action` a string
or `null`, `params` `null` or an object of scalars (strings ≤ 500 chars), `note` a string or `null`
(≤ 20000 chars). Anything else is a clean validation error (exit 1 / HTTP 400), never a traceback.
An input with no answers never replaces a submitted file unless `save --allow-empty`.

### Text export (clipboard and `sendPrompt`)

```
Briefing review — 2026-11-12 · items a1b2c3d4 (apply with the apply-review skill)

§0 State confirmation needed
- [3] #3 DEFER(2026-11-16) — [[Send revised budget to Dana]] — status: in_progress (due 2026-11-10).
    → ping Dana with the link first
- [7] DO — [[Draft reviewer response]] — …

(41 rows left unanswered — leave as is.)
```

Line grammar: `- [<n>]` + optional ` <label>` + ` <ACTION>` + optional `(<param>)` + ` — ` + item
plain text truncated to ~140 chars (the leading `[[wikilink]]` is always kept whole). The note is on
the next line as `    → <note>` with newlines joined by ` / `. ACTION is the action id upper-cased
(`CREATE_TASK`), or `NOTE`. `[n]` maps back through items.json order. The header's
`· items <hash>` is the `items_hash`; the older header without it still parses. A paged widget
export always has a `Part <i> of <N> — rows <lo>-<hi>.` line under the header, even with no answers.

`save --from-export` verifies every row against `items[n-1]`: same label, and the row's text
(normalized: whitespace collapsed, case folded, the `…` dropped) is a prefix of the item's plain
text (first 60 characters compared; a `--redact titles` row's `[[Title]]` also matches). If any
row fails, every row is re-matched by label + text among all items; when each row matches exactly
one distinct item the save proceeds and says so on stderr (a Part export then replaces only those
rows' answers). Otherwise it exits 1, lists the unmatched rows, and writes nothing.

## CLI contract — `python3 scripts/briefing_review.py <command>`

Vault root = parent of the script's directory, overridable with `--vault <path>` (global option) or
`MEMEX_VAULT`. `<date>` is optional everywhere and defaults to the latest daily briefing.

| command | behaviour |
| --- | --- |
| `id --kind K --section S [--date D] [--target PATH] --text "…"` | Print the item id (the same function the Markdown fallback uses). `--date` defaults to the latest briefing, else today. |
| `items [date] [--write]` | Print the normalized items JSON. Uses `Ops/Briefings/<date>.items.json` when present, else parses the Markdown (fallback, `kind` inferred from the wikilink target folder, else `item`). `--write` saves the fallback result as `<date>.items.json` (never overwrites an existing one). |
| `validate [date\|path]` | Validate an items.json; exit 1 and print problems on failure. |
| `build [date] [--surface page\|server\|widget\|artifact] [--out PATH] [--stdout] [--site URL] [--max-bytes N] [--redact private\|titles\|sensitive\|none]` | Generate the review UI. Default surface `page`. Prints the written path(s), one per line. See Surfaces. |
| `serve [--port N] [--host 127.0.0.1\|localhost\|::1]` | Stdlib HTTP server with the same routes as the Quartz serve handler (for vaults not running Quartz). Loopback only; `::1` binds IPv6 (a clean exit 1/2 where IPv6 is unavailable). |
| `save [date] [--from-export] [--surface NAME] [--draft] [--allow-empty]` | Read stdin (answers JSON, or with `--from-export` the text export) → validate against the items (export rows verified, see Text export) → write `Inbox/reviews/<date>.json` atomically under the reviews lock. Prints the path. With `--from-export` and no date, the date comes from the export header. With `--surface artifact` (or a JSON `surface: "artifact"`), artifact aliases are mapped back to ids. |
| `plan [date] [--json] [--include-draft]` | Print the apply plan: every answer not yet in the ledger, with its routing (see Apply) and `fingerprint`. |
| `mark [date] <id> --result applied\|skipped\|failed\|drafted [--summary TEXT] [--fingerprint FP]` | Record one answer in the ledger. `FP` is the plan entry's fingerprint and is what gets stored, even when the file's answer changed since `plan` (a note is printed; the changed answer re-plans). Without it, the current answer's fingerprint is stored and a warning printed. |
| `annotate [date]` | Rewrite the managed `Review resolved` block in the briefing's §0 from the ledger (idempotent; creates §0 heading only if it exists already, otherwise appends a `## Review resolved` section at the end). |
| `carryover [date] [--json] [--include-draft]` | For the review of `<date>`: list the items the next briefing must carry — unanswered, `keep`, and `defer`/`push`/`bump` whose date is on/before the next day, plus deferrals from earlier reviews (up to 90 days back) that come due now (see Carry-over) — plus every answer, for pre-fill. Exit 1 when there was no review: no items file (never the Markdown fallback), no answers file, or only a draft (unless `--include-draft`). |

Exit codes: 0 ok, 1 validation / not found, 2 usage.

### Server routes (identical in Quartz `site:serve` and `briefing_review.py serve`)

- `GET /review` and `GET /review/` → 302 to `/review/<latest date>`.
- `GET /review/<date>` → the `server`-surface page, built fresh on each request
  (`build <date> --surface server --stdout`). Under Quartz `--baseDir /x` every route sits under `/x`;
  the client derives the API prefix from its own path (`<prefix>/review/<date>` → `<prefix>/api/review/<date>`).
- `GET /api/review/<date>` → the stored answers JSON, or `404`.
- `POST /api/review/<date>` → body = answers JSON (≤ 2 MB), piped to `save <date> --surface server`
  (`?draft=1` adds `--draft`). `200 {"ok":true,"path":…}` or `400 {"ok":false,"error":…}`. Saves for
  one date run one at a time in arrival order (a per-date promise chain in Quartz, a lock in
  `serve`, and the script's file lock across processes). Error text is short: no tracebacks, no
  absolute paths (Quartz sends only the last stderr line, capped at 300 chars; `serve` makes vault
  paths relative); an unexpected failure is a `500 {"ok":false,"error":"internal error"}`.
- Loopback only; `POST` requires `Content-Type: application/json` and, when an `Origin` header is
  present, an origin whose host is `localhost` or `127.0.0.1` (and `::1` for `serve --host ::1`)
  (CSRF guard). `<date>` must match
  `^\d{4}-\d{2}-\d{2}$`.

The Quartz handler shells out to `python3 <vault>/scripts/briefing_review.py` (vault = `argv.directory`
resolved); it never emits a static review page, so nothing reaches a public build.

## Client app

One implementation (`briefing_review_app.js` + `.css`) inlined into every surface. The page provides
`window.__REVIEW__ = {date, items_hash, items, actions, kinds, surface, site, previous, withheld,
page, pages, rows}` (`rows` = `[first n, last n]` of a widget page).

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
| `server` | localStorage + debounced `POST …?draft=1`; initial state from `GET /api/review/<date>` | `POST /api/review/<date>` through the same one-at-a-time write queue as drafts; submitting cancels a pending draft, and no draft is sent once the review is submitted; an edit made while the submit is in flight leaves the form unsent ("Submit again"); clipboard stays as a secondary button |
| `widget` | localStorage (best effort) | `sendPrompt(export)` when the host provides it; else, when framed (Memex Desktop), `window.parent.postMessage({type:"memex:sendPrompt", text}, "*")` and wait up to 1.5 s for `{type:"memex:sendPrompt:ack", ok}` from the parent — `ok:true` says the answers are in the message box and still need Enter (`staged:false`: behind the app's Insert button); `ok:false` or no ack shows the export panel + clipboard with "Couldn't hand the answers to the app — copy them instead"; clipboard as the last fallback |
| `artifact` | `db` doc `reviews/<date>` (debounced, one write at a time) | same doc with `submitted: true` |

### Surfaces

- **page** — `outputs/briefing-review/<date>.html`, self-contained, opens from `file://`.
- **server** — same document, served at `/review/<date>`.
- **widget** — an HTML *fragment* (`<style>…</style><div id="review-root"></div><script>…</script>`,
  no doctype/html/head/body) for a host that renders inline HTML widgets and exposes
  `sendPrompt(text)`. Compact layout. If the fragment exceeds `--max-bytes` (default 200000; pass
  the host's real limit when known — about 50 KB of each page is the inlined script and styles,
  compacted by dropping indentation, blank lines and whole-line comments) it is split by section
  into `…widget.1.html`, `…widget.2.html`, …; a section too big for a page is split by rows. Pages
  are never empty; a single row over the budget gets a page of its own with a warning on stderr.
  Each page submits its own rows.
- **artifact** — page content (title and style first, no doctype/html/head/body; the publisher adds them) for a private claude.ai Artifact with `capabilities: {db: {}, user: {}}`.
  Sensitivity gate (`--redact`, default `private`). Each item's effective sensitivity is the
  strictest of its own `sensitivity`, its target note's frontmatter `sensitivity`, and that of every
  note wikilinked from its text/detail that resolves; anything unknown (no value, a missing target
  note) counts as `private`. Levels, strictest first:
  - `private` (default): `sensitive` and `private` items are dropped (local-only), counted in the
    page's "withheld" notice.
  - `titles`: `sensitive` dropped; `private` items stay as answerable title-only rows — text is the
    leading `[[wikilink]]` title (or `(private item)`), `section_title` only the top-level section,
    `group` blank, and no `target`, `detail`, `signal`, `threads`, `status`, `due`, `previous.note`
    (nor `previous.params` other than a date) or link entries.
  - `sensitive`: `sensitive` dropped; `private` items kept whole.
  - `none`: refused for this surface.
  Every item's `id` on this surface is an opaque alias, `a:` + 12 hex of `sha1(date + "\n" + id)`, so
  note titles never leave the machine through ids; the build writes the alias map locally and
  `save --surface artifact` maps aliases back (real ids are accepted too). Wikilinks render as
  plain text (no localhost links).

On the other surfaces a wikilink links to `<site>/<slug>`, with the slug built as Quartz's `sluggify`
does (whitespace → `-`, `&` → `-and-`, `%` → `-percent`, `?` and `#` dropped).

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

Ledger shape: `{"schema":"memex.briefing-review-ledger/v1","date":…,"entries":{"<id>":{"fingerprint":…,"result":…,"summary":…,"at":…,"n":…,"action":…,"params":…,"note":…,"text":…}}}`.
`fingerprint` is the planned answer's (`mark --fingerprint`); `n`/`action`/`params`/`note`/`text`
describe that applied answer, and `annotate` renders them (older entries without them fall back to
the answers file).

## Carry-over

The next daily briefing runs `carryover <previous date>` during input gathering; exit 1 (no items
file, no answers, or only a draft) means there is nothing to carry and the step is skipped. Unanswered items,
`keep`, and due `defer` items are carried into the matching sections with `carried_from`; each item's
`previous` answer is attached so the review page can pre-fill the chip.

A deferral to a date after the next day is not carried at first. Each later `carryover` also scans the
submitted reviews of the previous 90 days for such deferrals: one whose date is now on/before the next
day is carried with `carried_from` = the review that deferred it, unless the item has appeared in any
items file since that review (it was resurfaced, or is still tracked and answered there). This is what
brings back a target-less item, which has no note whose own dates would resurface it. A day with no
submitted review skips carry-over; a matured deferral is picked up by the next review's carry-over. Items whose answer was
applied (`done`, `cancel`, `drop`, `dismiss`, `skip`, `create_task`, …) are not carried.

## Memex Desktop prompt bridge

The renderer accepts `memex:sendPrompt` only from an artifact iframe it created, and only when that
frame is `document.activeElement` or the page has a fresh user activation
(`navigator.userActivation.isActive`), at most once per frame every 3 s. An empty composer gets the
text (focused, caret at the end, "press Enter to send"); a non-empty draft is never touched — a
notice with an **Insert** button holds the text instead. Every message is answered with
`{type:"memex:sendPrompt:ack", ok, staged?, error?}`. The pure logic lives in
`app/src/shared/prompt-bridge.ts` (`parsePromptBridgeMessage`, `checkPromptBridgeGate`,
`promptBridgeStageMode`, `mergePromptIntoDraft`).

## Not in this pass

MCP App surface (a Memex MCP server exposing the review UI as an MCP Apps resource and `apply` as a
tool). The CLI is the seam it would wrap.
