# Prompt: idea research

**Role:** `agent:librarian` (orchestrator) + `agent:executor:research` (sub-agents)

## Parameters

- `{{idea}}` — wikilink or absolute path to the Idea note, e.g. `[[MCPs for Example U backend services]]` or `Atlas/Ideas/MCPs for Example U backend services.md`.
- `{{scope_hint}}` — optional. "Focus on the technical landscape," "go heavy on the people side," etc.

## When to use

When an Idea note has an empty (or stale) `# Research notes` section and you want to advance it to the point where promotion-or-drop is a real decision. Paste this when **not** in Claude Code (where the `/flesh-out-idea` skill auto-triggers).

## Prompt

```text
You are agent:librarian acting as orchestrator with agent:executor:research sub-agents.

Read these before doing anything else:
- AGENTS.md  (the vault contract)
- _schemas/idea.md  (the schema you're filling in)
- {{idea}}  (the Idea note in full — especially # What's the idea, # Why this could be worth doing, # Open questions)

Then carry out the idea-research workflow:

1. Set the Idea's status to `researching` and bump `updated:` to today.
   - If # Research notes is already non-empty:
     * If the existing "— researched <date>" footer is >30 days old, run in REFRESH mode:
       sub-agents explicitly ask "what's changed in this space since <date>"; the
       output keeps an "_What was true at <old-date>_" rolled-up summary followed by
       a fresh "_What's now true at <today>_" section.
     * If <30 days old, ask the user whether to refresh-overwrite or append before
       proceeding.

2. Dispatch 2-3 sub-agents in parallel (a single message with multiple Agent
   calls). Default mix, on Sonnet:
   - External landscape: web-search prior art / competitors / recent work.
     Return 5-10 bullets with one-line characterizations + links. Highlight
     the 2-3 most relevant.
   - Vault connections: scan Atlas/ for notes that touch this idea — adjacent
     topics, related projects, sympathetic people, relevant Sources. Return
     bullets with wikilinks and a one-line "why this matters."
   - (Optional) System / domain dive: focused look at one named system.
     Haiku or Sonnet; 200-word brief on the named system's relevant surface.

   Sub-agent prompt template:
     "You are agent:executor:research, dispatched for /flesh-out-idea.
      Idea: <copy title + # What's the idea>
      Why it matters: <copy # Why this could be worth doing>
      Open questions: <copy # Open questions>
      Your specific job in this run: <external landscape | vault connections | system dive>
      Constraints: markdown bullets only, no preamble, no restatement; primary > secondary
      sources; full [[Wikilink]] form for vault entities; cap at ~400 words.
      Return findings, nothing else."

3. Synthesize the sub-agent returns into {{idea}}'s # Research notes section.
   Target length 200-400 words. Structure:

   # Research notes

   <one-paragraph framing — 3-5 sentences — where this idea fits in the landscape>

   **External landscape**
   - <3-6 bullets: most relevant external work, one-line characterizations + links>

   **Vault connections**
   - <3-6 bullets: existing notes that should link to this idea, with "why">

   **What's now clearer**
   - <2-4 bullets: original Open questions that are now answered or sharpened>

   **What's still unknown**
   - <2-4 bullets: remaining open questions, sharpened versions of originals>

   — researched <today> via idea-research

   Be honest about what was NOT found. Sparse landscape is signal.

4. Write # Proposed first step:

   # Proposed first step

   <one paragraph: a concrete, time-bounded first action. Who, what, by when,
   what success looks like for this step alone (not the whole idea). Should
   be small enough that one person can complete in under a week.>

5. If your synthesis surfaced people / topics / sources that aren't yet in
   the Idea's frontmatter, add them:
   - people: ["[[X]]", ...]
   - related_concepts: ["[[Y]]", ...]
   - sources: ["[[Z]]", ...]
   Do NOT auto-promote (status stays `researching`).

6. Append one line to log.md:
   <datetime> — agent:librarian — update — {{idea}} — research pass; status <prev> → researching; <N> sources surfaced; proposed first step: <one-liner>

7. Report back with a tight summary:

   Fleshed out {{idea}} (status: researching).

   Sub-agent findings:
   - External: <one-line>
   - Vault: <one-line>
   - <system dive line if applicable>

   Proposed first step:
   - <one-line>

   Suggested next moves:
   - Promote? (status: promoted; spawn Task/Effort/Project)
   - Refine further? (re-run with a scope hint)
   - Drop? (status: dropped; write # Why dropped)
```

## Notes

- Claude Code users: invoke `/flesh-out-idea` instead — same logic, just a skill rather than a paste prompt.
- This skill does NOT auto-promote. Promotion (Idea → Task/Effort/Project) is always a human decision; use the `/promote-idea` skill or the manual workflow once you've made the call.
- If the Idea has zero body content beyond a title, stop and have the user fill in `# What's the idea` and `# Why this could be worth doing` first — research without a target is wasted compute.
- The two-tier model split (Sonnet sub-agents → Opus synthesis) is deliberate: sub-agents do retrieval (cheap), the orchestrator does judgment (where Opus earns its keep). If the run feels too expensive, scope to 2 sub-agents instead of 3.
