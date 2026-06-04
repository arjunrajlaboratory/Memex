---
name: observe-skill-corrections
description: Scan Claude Code session transcripts for corrective user turns ("no", "actually", "shorten", "wrong", "instead", "rewrite") in the 10 turns following each Skill invocation; aggregate weekly to flag which skills the user most often had to correct, so the skill bodies themselves can be tightened. Use when the user wants the skill-correction observation pass run — signaled by phrases like "which skills need tightening", "what got corrected this week", "show me skill failures", "where do skills mis-fire", "observe corrections", or direct invocation "/observe-skill-corrections". Auto-invoked by the weekly-review skill. Reads `~/.claude/projects/{{CC_PROJECT_SLUG}}/*.jsonl` transcripts, groups corrections by (skill_name, week), produces a small ranked table with example correction phrases, writes to the open weekly review or a standalone `Ops/Reviews/Observations/Skill corrections - <ISO-week>.md`. Flag-only — proposes which skills to revise but never edits a skill body.
---

# Observe skill corrections

You are running as **`agent:auditor`** for this skill. Your job: read Claude Code session transcripts, detect user corrections following Skill invocations, and produce a weekly aggregate so the user can tighten the skills whose outputs they most often have to fix.

## Why this skill exists

The user mostly edits markdown via Claude rather than directly. That means every correction shows up in the chat transcript as a user message after a Skill invocation, of the form "no, shorten that", "actually Robin is at Example U", "rewrite section 3", "you got the date wrong." These are the closest thing to a learning signal the system can capture without touching schemas.

Aggregated over a week or month, the pattern is: which skills have the highest correction rate, and what's the correction shape (length, factuality, ordering, tone)? That's the input to deciding which skills need their body tightened or their starter-prompts adjusted.

The skill itself does NOT modify any skill body. It produces the report; the user decides what to revise.

## Inputs

- **Window** (optional, default last 7 days). For weekly review use. For longer scans (monthly review), accept "30d".
- **Min count** (optional, default 2). Skills with fewer than N corrections in the window are not surfaced.

## Step 0 — Orient

Locate the transcripts directory:

```
~/.claude/projects/{{CC_PROJECT_SLUG}}/
```

Each `.jsonl` file is one session. Each line is one event (user message, assistant message, tool use, tool result). The two fields that matter for this skill:

- `type` (`user` | `assistant` | `tool_use` | `tool_result`)
- For `tool_use` of name `Skill`: the `input.skill` field names the invoked skill.
- For `user` messages: the `message.content` (string or list-of-blocks).

## Step 1 — Detect skill invocations + subsequent corrections

Algorithm:

1. List all `.jsonl` files in the project transcripts dir.
2. Filter to those modified within the window.
3. For each file, stream through events. Maintain a sliding context of "last Skill invoked" with a session-id, timestamp, and skill name.
4. When you see a Skill tool_use, record `(session, ts, skill_name)`.
5. For the next ~10 user-message events in the same session (or until the next Skill tool_use or session end), check the user message text against the corrective-phrase regex (case-insensitive, word-boundary):

   ```
   \b(no|actually|wrong|incorrect|shorten|tighten|trim|rewrite|redo|change|instead|fix|not\s+(quite|right))\b
   ```

   PLUS check for explicit edit instructions: `\b(edit|update|replace|delete)\b\s+(the|that|this)?\s*\w+`

6. Each matched user message = 1 correction tagged to the most recent Skill invocation. Record the (skill_name, session, ts, snippet-of-correction-text-up-to-120-chars).

7. Sessions where the user explicitly thanks ("thanks", "great", "perfect") within the 10-turn window count as a "clean" run — record as zero corrections.

## Step 2 — Aggregate

Per skill, compute:

- **Invocations** (N) — count of Skill tool_uses in the window.
- **Corrections** (M) — count of user messages matching the regex within 10 turns of an invocation.
- **Correction rate** — M / N (note: a single invocation can produce multiple corrections; that's fine, it's a ratio not a probability).
- **Example phrases** — up to 3 representative correction snippets, anonymized of any sensitive content.

Sort by absolute correction count descending. Drop skills below `min_count`.

## Step 3 — Format the report

```markdown
## Skill corrections — <window>

| Skill | Invocations | Corrections | Rate | Example phrases |
| --- | --- | --- | --- | --- |
| daily-briefing | 7 | 5 | 0.71 | "shorten section 11"; "wrong, Riley Chen is at Example U"; "trim the calendar block" |
| triage-inbox | 4 | 3 | 0.75 | "no, that's a Journal not a Source"; ... |
| ... | ... | ... | ... | ... |

### Patterns worth noting
- <one-line observation if a pattern is visible — e.g., "daily-briefing corrections cluster in Section 11 (Decisions needed); consider tightening that section's logic.">
- <second observation if a second pattern is visible>

### Proposed skill revisions
- **<skill-name>**: <one-line suggested change, e.g., "tighten Section 11 generation in daily-briefing — drop speculative decisions, list only those with explicit decision-needed flag.">
```

If there are zero corrections above threshold, write: "No skills above correction threshold (`min_count`=N). Clean week."

## Step 4 — Persist the report

Two paths (same convention as the `lint` skill):

- **Open weekly review for this ISO week** — append the `## Skill corrections — <window>` section to `Ops/Reviews/Review - <ISO-week>.md`. Bump `updated:`.
- **No open weekly review** — write a standalone `Ops/Reviews/Observations/Skill corrections - <ISO-week>.md`. Create the `Observations/` subdir if it doesn't exist. Frontmatter: `type: review`, `scope: observation-skill-corrections`, `date: <today>`, `generated_by: agent:auditor`, `sensitivity: private`.

## Step 5 — Log

```
<datetime-with-tz> — agent:auditor — observe — [[<output file>]] — skill-corrections; <N skills above threshold>; top: <skill-name> @ <rate>
```

## What this skill does NOT do

- **Does not edit any skill body.** The report proposes; the user revises.
- **Does not log corrections by content** beyond ~120-char snippets. Sensitive content (names, project details) may end up in the example phrases — keep the snippets short and use the user's judgment on whether to include them in the report.
- **Does not extend to file-diff detection.** Transcript-only. If the user later starts editing markdown directly, this skill will under-count and we'll revisit.
- **Does not correlate across sessions.** Each session is independent. Cross-session patterns are the user's synthesis job (or the weekly review's).

## Model recommendation

`sonnet`. The work is structured grep over jsonl + tabulation. Sonnet handles this well; opus is unnecessary.

## Related

- `weekly-review` — invokes this skill in its `## Learnings` section.
- `observe-manual-patterns` — sibling observer, scans log.md instead of transcripts.
- `log-mutation` — the canonical log-append helper.
