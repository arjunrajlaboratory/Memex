# Prompt template: task starter

**Role:** the user (with optional LLM assist)

## Parameters

- `{{task_id}}` — e.g. `task-20260517-007`  
- `{{task_link}}` — e.g. `[[Generate first daily briefing]]`

Provide one or the other; the prompt handles both.

## When to use

Opening a work session when you want a focused first 25 minutes on a specific task and need to quickly orient yourself before diving in.

## Prompt

```
Read [[{{task_link}}]] (or find the task by `id: {{task_id}}` under `Ops/Tasks/`).

Also read: the linked project page, any linked source notes, any linked decision
notes, and recent `log.md` entries for the project.

Produce the following six items (one short paragraph each, or terse bullets):

1. **Goal** — the objective of this task in one sentence.
2. **Next physical action** — the single most concrete thing to do first.
3. **Minimum useful output** — what a successful 25-minute session produces.
4. **Key context** — the one or two things most important to keep in mind while working.
5. **25-minute plan** — a suggested time-boxed sequence of steps.
6. **Blockers / open decisions** — anything that must be resolved before or during the session.

End your response with a single starter sentence I can paste back to you to begin the actual work.
```

## Notes

**Distinguish from `_agent-handoff.md`:** this template is for *you* working on the task with LLM assistance in an interactive session. The handoff template is for delegating the task to an agent for unattended execution — it requires `agent_eligible: true` and fully populated acceptance criteria per the task schema.
