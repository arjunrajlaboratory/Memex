# Prompt: shutdown review

**Role:** the user (with LLM scribe assist)

## When to use

End of day, before context-switching out of the vault. Run this once the last task of the day is wrapped or abandoned — not mid-session.

## Prompt

```
Open today's briefing at Ops/Briefings/<today>.md.

Look at section "## 1. Top 3 outcomes for today". For each outcome:
- Did it happen? (yes / partial / no)
- What blocked it, or what unblocked it?

Then work through these five questions. Answer each concretely; link every file, task, project, or person you mention.

1. What got done today — by linked file?
   List every task closed, every note created or materially updated, every decision recorded.

2. What changed in the graph today that the librarian should know about?
   New entities (tasks, projects, people, topics, sources), status changes, decisions made,
   relationships added. Flag anything the librarian should propagate.

3. What needs to be rescheduled — to tomorrow, this week, or further out?
   For each item, suggest the new date and note why it slipped.

4. What did I learn today that should be captured?
   Anything that belongs in a Decision note, a Learning note, or a topic page.
   Draft the note title and one-line summary; the librarian can expand it.

5. What should tomorrow's briefing know?
   Surprises, mood, energy level, unresolved open questions, anything the planner
   needs before generating tomorrow's briefing.

Produce a document with this structure:

# Shutdown notes — <today>

## Top 3 outcomes: actuals
...

## 1. What got done
...

## 2. Graph changes for the librarian
...

## 3. Rescheduled items
...

## 4. Learnings to capture
...

## 5. Notes for tomorrow's briefing
...

Then:
- Append the full document to today's briefing file under a new "## Shutdown notes" section
  (or save it as Ops/Briefings/<today>-shutdown.md if the briefing is already long).
- For every task mentioned in section 1 or 3: open its note and append a "# Work log" entry
  dated today with one line summarising what happened.
- Append one line to log.md:
    <datetime> — me — review — [[<today>'s briefing]] — end-of-day shutdown
```

## Notes

Keep the session to 10–15 minutes. The goal is a clean handoff to tomorrow's planner, not exhaustive journaling. If a question takes more than two minutes, write a stub and move on — the librarian can fill gaps later.
