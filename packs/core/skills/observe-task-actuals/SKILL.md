---
name: observe-task-actuals
description: For Tasks closed in the period, triangulate actual time spent from observable signals (Gmail send timestamps on linked threads, Google Drive `modifiedTime` on linked docs, git commit ranges on referenced repos, calendar block slips on `scheduled` Tasks) and set `actual_effort:` + `actual_effort_source:` on the Task; for Tasks with no observable signal, surface 3–5 to the user at the weekly review for sparse self-report; then compare estimates vs actuals at the Project/area level. Use when the user wants the effort-actuals observation pass run — signaled by phrases like "how long did tasks really take", "check effort estimates", "where am I underestimating", "compare estimates vs actuals", "observe task actuals", or direct invocation "/observe-task-actuals". Auto-invoked by the weekly-review skill. Writes `actual_effort:` and `actual_effort_source:` directly on closed Tasks (this is the one observer that DOES mutate state — Tasks are immutable post-close anyway, so adding a measured field is safe), produces a comparison table in the open weekly review or a standalone `Ops/Reviews/Observations/Task actuals - <ISO-week>.md`, and prompts the user for self-report on Tasks with no observable signal.
---

# Observe task actuals

You are running as **`agent:auditor`** for this skill, with one narrow exception to the auditor-doesn't-mutate rule: this skill MAY set `actual_effort:` and `actual_effort_source:` on closed Tasks, since those fields are part of the schema specifically for this observer to populate. It does not change any other Task field.

## Why this skill exists

Every Task has `effort:` (the estimate) but nothing captures `actual_effort:`. Without actuals, the estimates are aspirational and never validated. Over a few months of data, the estimate-vs-actual delta is the single most useful signal for calibrating future planning — and the user explicitly asked for it.

The skill avoids forcing per-task self-report by triangulating from observable signals first. Self-report falls back only to Tasks where no signal fired.

## Inputs

- **Window** (optional, default last 7 days). Period of Tasks closed in the window to process.
- **Sparse-prompt limit** (optional, default 5). Max number of Tasks to surface for user self-report in one pass.

## Step 0 — Orient

Read `_schemas/task.md` to confirm the `actual_effort:` and `actual_effort_source:` fields and their allowed values for `actual_effort_source:`:

```
self-report | email-timestamp | doc-mtime | git-log | calendar-block | unknown
```

## Step 1 — Find closed Tasks in window

Grep `Ops/Tasks/*.md` for `status: done` AND `updated:` in the window AND `actual_effort:` empty.

For each such Task, read its frontmatter (especially `created:`, `effort:`, `scheduled_start/end:`, `project:`) and its body sections (`# Inputs`, `# Work log`) to extract signal sources.

## Step 2 — Triangulate observable signals (in order, first hit wins)

For each Task, try signals in this order and stop at the first one that produces a confident estimate:

### 2a. Git commit range (most reliable for code-shaped Tasks)

If the Task's body references a code repo (e.g., a `github.com/{{GITHUB_ORG}}/<repo>` URL in `# Inputs` or `# Work log`), and the repo is locally cloned (`~/code/<repo>`), run:

```bash
cd ~/code/<repo>
git log --since="<task.created>" --until="<task.updated>" --pretty=format:"%aI" --author="$(git config user.email)"
```

If at least one commit lands in the window, derive `actual_effort` as the span between the first and last commit (or, if only one commit, use a conservative 30-minute fudge). Set `actual_effort_source: git-log`.

### 2b. Calendar block (most reliable for time-blocked Tasks)

If the Task had `scheduled_start:` AND `scheduled_end:` AND `status: scheduled` immediately before closing, use the block duration as `actual_effort` — but check the Work log for an "actually went over by X" or "finished early at HH:MM" note, and adjust if present. Set `actual_effort_source: calendar-block`.

### 2c. Doc mod time (reliable for write-shaped Tasks)

If the Task's `# Inputs` or `# Work log` references a Google Doc URL, query the Drive MCP for the file's `modifiedTime` and `createdTime`. The window from `min(createdTime, task.created)` to `modifiedTime` is the working span. Set `actual_effort_source: doc-mtime`.

### 2d. Gmail send timestamp (reliable for email-shaped Tasks)

If the Task's `# Work log` or `# Outputs` references a Gmail thread (a Gmail URL or "sent email to X"), query Gmail MCP for the thread's last sent message from the user. The span from `task.created` to the send time, capped at 4 hours (anything longer suggests the email wasn't the bottleneck), is the actual_effort. Set `actual_effort_source: email-timestamp`.

### 2e. Unknown

If no signal fires, set nothing on the Task and add it to the **sparse-prompt queue**.

## Step 3 — Write actuals into Tasks

For each Task where a signal fired:

1. Set `actual_effort:` to the derived duration (round to the nearest schema-allowed value: 5m, 15m, 25m, 45m, 1h, 2h, 4h, 1d). Use the longer human-readable form if a schema-allowed value doesn't exist (e.g., `3h`).
2. Set `actual_effort_source:` to the signal name.
3. Bump `updated:` (the hook will catch it too).
4. Do NOT modify any other field. Do NOT add a Work log entry.

## Step 4 — Sparse self-report at the weekly review

Take the first `<sparse-prompt limit>` Tasks from the unknown-signal queue. Present to the user:

```
A few Tasks closed this week had no observable time signal. Rough actual times?

1. [[X]] — estimated <effort>. Actual? (e.g., 30m, 1h, 2h)
2. [[Y]] — estimated <effort>. Actual?
...
```

Accept "skip" for any individual Task (sets `actual_effort_source: unknown` permanently — won't re-prompt). For each answered Task, set `actual_effort:` and `actual_effort_source: self-report`.

## Step 4.5 — Letter submission detection (extension)

In addition to Task time-actuals, this skill also scans **Letter notes** at `status: drafting` for evidence the user submitted off-vault. The signal sources are deliberately broad — the user submits letters via two distinct channels and both produce Gmail-detectable artifacts:

1. **Outbound email send** (e.g., Alex Kim tenure letter → emailed to the department chair): the user sends the `.docx` to a named recipient.
2. **Inbound portal confirmation receipt** (e.g., Jordan Lee fellowship → GrantPortal, Sam Carter → FolioSystem): the portal sends a "Your letter has been received" email after upload.

Both count. Scanning both catches the cases that any single channel misses.

### 4.5a — Find Letters that need detection

Grep `Atlas/Letters/*.md` for `status: drafting` AND (`due <= today + 14` OR `due` is empty). Process each.

### 4.5b — Outbound-email signal (the user sent the letter)

For each Letter, extract:
- `submission_portal:` — if it contains an email address (e.g., `"Email to the department chair (chair@example.edu) ..."`), use that email.
- Recipient's email from `Atlas/People/<Recipient>.md` `email:` field (fallback — the user sometimes copies the recipient on the submission email).

Search sent Gmail in the last 30 days for messages TO any of the extracted addresses with subject or body mentioning the recipient's name or the program name. If a hit lands, capture (a) the Gmail message ID, (b) the send timestamp, (c) the recipient address. Propose `status: drafting → submitted`, `submitted: <send-timestamp date>`.

### 4.5c — Inbound-confirmation signal (the portal acknowledged the upload)

For each Letter, extract:
- `submission_portal:` — if it contains a portal name (GrantPortal / FolioSystem / ExamplePortal / the undergraduate research office / etc.), map to the portal's confirmation-email sender domain via this table:

| Portal | Confirmation sender |
| --- | --- |
| GrantPortal | `@grantportal.example.com`, `@example-grants.com` |
| FolioSystem | `@foliosystem.example.com`, `help@example.com` |
| ExamplePortal | `@exampleportal.example.org`, `service@example.org` |
| the undergraduate research office (Example U) | `@example.edu` from the undergraduate research office address |

Search inbox in the last 30 days for messages FROM any of these domains AND containing the recipient's full name OR the cycle year. If a hit lands, capture (a) the Gmail message ID, (b) the receipt timestamp, (c) the sender address. Propose `status: drafting → submitted`, `submitted: <receipt-timestamp date - 1>` (the portal usually confirms shortly after upload; lean conservative by 1 day if the portal-confirmation timestamp is late in the day).

### 4.5d — Conflict resolution

If both 4.5b and 4.5c fire for the same Letter, use the *earlier* timestamp as `submitted:` (the user submitted, then the portal confirmed). If they disagree by more than 48h, surface both to the user and ask which is the canonical submission moment.

### 4.5e — Apply (or propose)

For each Letter where a signal fired:

1. Set `status: submitted` AND `submitted: <date>`.
2. Append a `# Work log` entry: `<date> — submitted via <channel>; detected by /observe-task-actuals from <gmail signal> (Gmail message id: <id>). Status drafting → submitted.`
3. Update the Person note's `## Letters` line to reflect the new status.
4. Close the paired submission Followup at `Ops/Followups/Submit <Recipient> - <Program> <Year>.md` — set `status: acted_on`, append a `# What happened` entry.
5. Log the closure.

If running in **propose-only mode** (default for any auto-invocation, override possible by user when running interactively), don't apply directly — surface a chat prompt: "Detected <signal> suggesting [[<Letter>]] was submitted on <date>. Confirm and I'll close it." Apply only on yes.

### 4.5f — Coverage notes

- Portal confirmations sometimes go to spam or are filtered into a "Notifications" Gmail label. The Gmail MCP only searches the All-Mail scope by default, so this should catch them — but if a Letter has `due` 30+ days past with no signal, escalate to the user as a possible portal-spam-filter case.
- Tenure / promotion letters often go via email *only* (no portal); 4.5b is the canonical signal for those. Fellowship and admissions letters often go via portal *only*; 4.5c is the canonical signal.
- Email-only-submitted letters might never get a portal-confirmation; that's expected, not a bug. Don't loop waiting for 4.5c if 4.5b already fired.

## Step 5 — Produce the comparison report

After writing actuals, aggregate by Project and Area:

```markdown
## Task actuals — <window>

### Per-project estimate vs actual

| Project | Tasks closed | Total estimated | Total actual | Delta | Average ratio |
| --- | --- | --- | --- | --- | --- |
| [[X]] | 5 | 4h | 7h | +3h | 1.75x |
| [[Y]] | 3 | 6h | 5h | -1h | 0.83x |

### Per-area estimate vs actual

| Area | Tasks closed | Total estimated | Total actual | Delta | Average ratio |
| --- | --- | --- | --- | --- | --- |
| [[X]] | 8 | 10h | 12h | +2h | 1.2x |

### Notable outliers
- **[[X]]** — estimated 45m, actual 3h. Source: git-log. Likely cause (1-line hypothesis if obvious from body, else "?").

### Coverage
- Triangulated: <N>
- Self-report: <N>
- Unknown (no signal, not prompted): <N>
```

## Step 6 — Persist the report

Two paths:

- **Open weekly review for this ISO week** — append the `## Task actuals — <window>` section.
- **No open weekly review** — write a standalone `Ops/Reviews/Observations/Task actuals - <ISO-week>.md`. Frontmatter: `type: review`, `scope: observation-task-actuals`, `date: <today>`, `generated_by: agent:auditor`, `sensitivity: private`.

## Step 7 — Log

```
<datetime-with-tz> — agent:auditor — observe — [[<output file>]] — task-actuals; <N actuals written>; <N self-report>; biggest delta: [[X]] (<estimated> -> <actual>)
```

Note: the per-Task `actual_effort:` writes do NOT each get their own log line — they're a single observer pass. If a sceptical reader wants per-Task provenance, the `actual_effort_source:` field tells them.

## What this skill does NOT do

- **Does not modify any field on the Task other than `actual_effort:`, `actual_effort_source:`, and `updated:`.** Tasks are immutable post-close; this is the one exception, scoped to two new fields.
- **Does not infer actuals from unreliable signals.** If the signal is ambiguous (e.g., a code commit that might be unrelated), prefer falling through to the unknown queue rather than guessing.
- **Does not back-fill historical Tasks.** This pass operates only on Tasks closed in the window. The user can run it manually with a longer window once to seed history, but the default weekly cadence is forward-going only.
- **Does not retroactively change any closed Project's planning estimates.** The report informs future planning; existing estimates stand.

## Model recommendation

`sonnet` for the signal triangulation (mostly structured tool calls + regex). The aggregation/report writing is also mechanical. Opus is unnecessary unless the user later asks for cross-period synthesis.

## Related

- `_schemas/task.md` — defines `actual_effort:` and `actual_effort_source:`.
- `weekly-review` — invokes this skill in its `## Learnings` section.
- `close-task` — upstream skill that closes Tasks with empty `actual_effort:`.
- `log-mutation` — the canonical log-append helper.
