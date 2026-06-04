# Schema: ask

An **Ask** is a request you *could* make of a person — not yet made. Separating "what I want from someone" from "the task of sending the message" prevents asks from getting stuck in the inbox.

File path: `Atlas/People/Asks/<slug>.md`

## Frontmatter

```yaml
---
type: ask
id: ask-YYYYMMDD-<slug>
status: draft             # draft | ready | sent | answered | withdrawn | declined
person:
  - "[[<Name>]]"
project: "[[<Name>]]"
related_task: "[[<Title>]]"
ask_type: feedback        # feedback | intro | favor | advice | review | help | resource | endorsement
importance: 3             # 1–5
effort_for_them: low      # low | medium | high
relationship_sensitivity: low   # low | medium | high (how much this could strain the relationship)
draft_message_created: false
sent_on:
answered_on:
sensitivity: private
created: YYYY-MM-DD
updated: YYYY-MM-DD
---
```

## Body sections

- `# What I want`
- `# Why this person`
- `# Why now`
- `# Suggested message` — a paste-ready draft
- `# Context to include`
- `# Follow-up plan` — what to do if no response by when

## Rules

- An ask in `status: ready` becomes a task in the agent queue with a `Send <ask>` action.
- An ask in `status: sent` should have a follow-up task scheduled.
- The auditor flags asks stuck in `draft` for more than 30 days.
