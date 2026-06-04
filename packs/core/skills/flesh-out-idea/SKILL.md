---
name: flesh-out-idea
description: Research an Idea note further — dispatch parallel sub-agents to gather external landscape, vault connections, and system dives, then synthesize as # Research notes + # Proposed first step. Use whenever the user wants to research and develop an idea note further — signaled by phrases like "flesh out this idea", "research this idea", "expand [[X]]", "what should we do about this idea", "go think about this idea", "do some research on [[X]]", "develop this idea more", or by direct invocation like "/flesh-out-idea [[X]]". Operates on notes of `type: idea` in `Atlas/Ideas/`. Dispatches Sonnet sub-agents in parallel to gather raw research (web search for prior art, vault search for adjacent notes and people, a focused dive on any named systems), then synthesizes the findings as Opus (the orchestrator) into the idea's `# Research notes` and `# Proposed first step` body sections. Sets `status: researching`. Does NOT auto-promote the idea to a Task or Project — promotion is always a human call. Use this skill whenever an Idea note has empty Research notes and the user wants to advance it; also use it to refresh stale research on an idea that's been sitting at `status: exploring`.
---

# Flesh out an idea

You are running as **`agent:librarian`** (orchestrator), with **`agent:executor:research`** sub-agents reporting in. Your job: take one Idea note that's currently sparse, gather real research material via parallel Sonnet sub-agents, and synthesize it into the idea's body — without committing the user to anything.

## Why this skill exists

Ideas in this vault start raw — a one-paragraph hunch, an Open-questions list, and not much else. The friction to advance them is real: research is a 30–90 minute chore that's hard to start at the right moment. This skill compresses it to a single invocation. The user goes from "this might be interesting" to "here's what's actually known, here's a concrete first step worth doing" in one pass.

The two-tier model selection is deliberate:

- **Sonnet sub-agents** do the gathering — web searches, vault scans, source pulls. Sonnet is plenty smart for "go find what's out there" and avoids burning Opus tokens on retrieval-heavy work.
- **Opus orchestrator** does the synthesis — weighing what the sub-agents returned, deciding what's signal vs. noise, writing the Research notes and Proposed first step. Synthesis is where judgment matters; that's an Opus job.

## Inputs

- **Idea note path or wikilink** (required) — e.g., `Atlas/Ideas/MCPs for Example U backend services.md` or `[[MCPs for Example U backend services]]`. If the user invokes the skill without specifying, ask which idea before proceeding.
- **Scope hint** (optional) — the user may say "focus on the technical landscape" or "go heavy on the people side." Honor it by adjusting which sub-agents you dispatch and what they look for.

## Step 0 — Read and orient

Read the idea note in full. Pay attention to:

- The `# What's the idea` and `# Why this could be worth doing` sections — these define what the research is *for*.
- The `# Open questions` section — sub-agent prompts should address these explicitly.
- The `tags:`, `project:`, `area:`, `people:` frontmatter — these are the entry points for vault-side and external research.

Also read the schema briefly (`_schemas/idea.md`) so you know exactly which body sections to fill.

If the idea's `# Research notes` is already non-empty (the skill was run before), check the date stamp in the existing section (the "— researched <date> via /flesh-out-idea" footer):

- **Stale (>30 days old):** Offer **refresh mode** — diff the old findings against new ones rather than overwriting. The new sub-agent prompts should explicitly ask "what's changed in this space since <date>" alongside the normal research questions. The synthesized Research notes section keeps a "_What was true at <old-date>_" rolled-up summary at the bottom, followed by a fresh "_What's now true at <today>_" section. This preserves the audit trail of how the landscape evolved.
- **Fresh (<30 days old):** Ask the user whether to **refresh** (rewrite) or **append** before proceeding. Don't burn tokens on a near-duplicate research pass without consent.

## Step 1 — Set status: researching

Update the idea's frontmatter: `status: researching` and `updated: <today>`. This signals to anyone else (or any auditor pass) that work is in flight on this idea.

## Step 2 — Dispatch parallel research sub-agents

Dispatch 2–3 sub-agents in a single message (so they run concurrently). Default mix:

| Sub-agent | Model | Purpose | What it returns |
| --- | --- | --- | --- |
| **External landscape** | `sonnet` | Web-search prior art, competitors, recent academic / industry work in this space. Look for the 3–8 most useful sources. | A bullet list of "what's out there": 5–10 specific projects/tools/papers/teams with one-line characterizations, plus links. Highlights the 2 or 3 most relevant. |
| **Vault connections** | `sonnet` | Scan `Atlas/` for notes that touch this idea — adjacent topics, related projects, sympathetic people, sources already in `Atlas/Sources/`. | A bullet list of vault entities that should connect to this idea, with one-line "why this matters." |
| **System / domain dive** (optional, if the idea names specific systems or domains) | `haiku` or `sonnet` | Focused look at one named system. E.g., for the MCP idea: what does the MCP spec actually require? For the data-pipeline idea: what does the target API's rate-limit model look like in practice? | A short technical brief — 200 words max — on the named system's relevant surface. |

**Sub-agent prompt template:**

```
You are agent:executor:research, dispatched by /flesh-out-idea.

The idea: <copy the idea's title and # What's the idea section>
Why it matters: <copy the # Why this could be worth doing section>
Open questions to address: <copy the # Open questions list>

Your specific job in this run: <external landscape | vault connections | system dive>
Your instructions: <see the table above>

Constraints:
- Return findings in markdown bullet form; no preamble, no summary, just the bullets.
- Skip filler / hype / restatement of the idea.
- For external sources, prefer primary material over secondary; flag uncertainty explicitly.
- For vault entities, use full wikilink form: [[Note Name]].
- Cap your output at ~400 words. If you have more to say, pick the top items.

Return your findings, nothing else.
```

While sub-agents run, you can pre-skim the idea's `project:` / `area:` parent notes for context you'll need at synthesis time. Don't twiddle thumbs — but don't dispatch more sub-agents than you need either.

## Step 3 — Synthesize (Opus, you)

When all sub-agents return, write the idea's `# Research notes` section. Target length: **200–400 words**. Structure:

```markdown
# Research notes

_<one-paragraph framing of where this idea fits in the existing landscape — 3–5 sentences>_

**External landscape**

- _<3–6 bullets: the most relevant external work, with one-line characterizations and links>_

**Vault connections**

- _<3–6 bullets: existing notes that should be linked to this idea, with "why">_

**What's now clearer**

- _<2–4 bullets: which of the original Open questions are now answered or have a sharper framing>_

**What's still unknown**

- _<2–4 bullets: the open questions that remain, possibly newly-sharpened versions of the original ones>_

— researched <date> via /flesh-out-idea
```

Be honest about what the sub-agents *didn't* find. If the external landscape is sparse, say so — that's signal in itself.

Also write the idea's `# Proposed first step` section:

```markdown
# Proposed first step

_<one paragraph: a concrete, time-bounded first action that would advance the idea. Include who, what, by when, and what success looks like for this step alone (not the whole idea).>_
```

The first step should be **small enough that one person can do it in under a week**. It's an experiment, not a project plan.

## Step 4 — Update the idea note

Apply the edits — replace the placeholder content under `# Research notes` and `# Proposed first step`. Update `updated:` to today. Leave `status: researching` (do NOT promote).

If your synthesis surfaced people who should be on the idea but aren't in `people:` yet, add them to the frontmatter. Same for `related_concepts:` and `sources:`.

## Step 5 — Log the mutation

Append to `log.md`:

```
<datetime> — agent:librarian — update — [[<Name>]] — flesh-out research pass; status raw → researching; <N> sources surfaced; proposed first step: <one-liner>
```

## Step 6 — Open in browser via Quartz (default)

The artifact is the updated Idea note at `Atlas/Ideas/<title>.md` (now populated with `# Research notes` + `# Proposed first step`). The user reads it in the browser. Run:

```bash
if ! lsof -ti :{{QUARTZ_PORT}} >/dev/null 2>&1; then
  ( cd {{VAULT_PATH}}/quartz && npm run site:serve > /tmp/quartz-serve.log 2>&1 & disown )
  for i in 1 2 3 4 5 6 7 8 9 10; do sleep 1; lsof -ti :{{QUARTZ_PORT}} >/dev/null 2>&1 && break; done
fi
open "http://localhost:{{QUARTZ_PORT}}/Atlas/Ideas/<title>"
```

Skip only if the user explicitly said "don't open" or "just write the file." See memory `feedback_open_artifacts_in_browser`.

## Step 7 — Report back

Tight summary for the user:

```
Fleshed out [[<Name>]] (status: researching).

What sub-agents found:
- External: <one-line summary of external landscape>
- Vault: <one-line summary of vault connections>
- <system dive line if applicable>

Synthesis:
- <one-line characterization of where this idea now sits>

Proposed first step:
- <one-line restatement of the first step>

Suggested next moves:
- Promote? (status: promoted, spawn [[X]] or [[Y]])
- Refine further? (re-run /flesh-out-idea with a scope hint)
- Drop? (status: dropped, write Why dropped)
```

## What this skill does NOT do

- **Does not promote** the idea to a Task / Effort / Project. Promotion is a human call. Hand back; don't decide.
- **Does not auto-create Person / Concept / Source notes** even if it would be helpful. Surface them as suggestions in the report; the user can run `/ingest-person` or `/ingest-source` separately.
- **Does not over-research.** 2–3 sub-agents, 200–400 word synthesis, one concrete first step. If you find yourself dispatching a 4th sub-agent or writing >500 words, stop — that's a sign the idea is mature enough to promote, not research further.

## Model recommendation when this skill is the sub-agent

If a parent skill dispatches you as a sub-agent (e.g. an `ingest-project` that wants to auto-flesh-out a seed idea created during ingest), run on `opus` — you're doing the synthesis, which is the judgment-heavy part. The sub-sub-agents you dispatch from inside this skill should still be Sonnet.

## Related

- `_schemas/idea.md` — the schema this skill operates on.
- `[[AI for Faculty Efficiency at Example U]]` — currently the area with the most active idea seeds.
- `Agents/Prompts/ingest-source.md` — when fleshing-out turns up a source worth pulling into `Raw/` and `Atlas/Sources/`.
