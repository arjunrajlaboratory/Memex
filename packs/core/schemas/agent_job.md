# Schema: agent_job

An **Agent Job** is a delegated unit of work prepared for execution by an LLM or other automated agent. It has explicit permissions, acceptance criteria, and a review gate.

File path: `Agents/Jobs/YYYYMMDD-NNN - <slug>.md`

## Frontmatter

```yaml
---
type: agent_job
id: job-YYYYMMDD-NNN
task: "[[<Title>]]"
status: ready             # draft | ready | in_progress | needs_review | approved | done | rejected
agent_type: writing       # planning | research | writing | coding | admin | data-analysis | tracker
agent_role: ""            # specific role name, if any
allowed_tools:
  - read_vault
  - write_output
  - update_task_note
forbidden_tools:
  - email_send
  - calendar_commit
  - delete_files
  - external_purchase
human_approval_required: true
risk_level: low           # low | medium | high
input_paths: []           # files/notes the agent may read
output_paths:             # where output must land
  - "Drafts/..."
constraints: []
expected_output: ""
acceptance_criteria: []
created: YYYY-MM-DD
updated: YYYY-MM-DD
---
```

## Body sections

- `# Objective`
- `# Inputs` — wiki-linked
- `# Constraints`
- `# Expected output`
- `# Acceptance criteria`
- `# Prompt to execute` — the actual prompt to paste into a fresh agent session
- `# Approval gate` — what the human needs to verify before marking done
