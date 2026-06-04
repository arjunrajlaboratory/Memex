# Schema: agent_run

An **Agent Run** is the log of one execution of an agent job: what was done, what was produced, what changed in the vault, and any unresolved questions.

File path: `Agents/Runs/YYYYMMDD-HHMMSS - <job-slug>.md`

## Frontmatter

```yaml
---
type: agent_run
id: run-YYYYMMDDHHMMSS
job: "[[YYYYMMDD-NNN - <slug>]]"
agent_model: ""           # e.g. claude-opus-4-7
agent_role: ""
started_at: YYYY-MM-DDTHH:MM:SS-04:00
ended_at:
status: completed         # in_progress | completed | failed | aborted
outputs:
  - "05_Outputs/..."
notes_modified: []
log_entries_appended: 0
sensitivity: normal       # inherits strictest of inputs
---
```

## Body sections

- `# What was done`
- `# What was produced` — links to outputs
- `# What changed in the vault` — links to modified notes
- `# Unresolved questions` — for the human
- `# Cost / time`
- `# Lessons` — anything to feed back into the prompt or the agent_job

## Rules

- Agent runs are append-only. Do not edit a run after `status: completed`.
- The auditor lints for jobs that have no runs, or runs that never closed out.
