# Schema: person

A **Person** note is a durable, queryable profile of a real human. Treat it as your embedded personal CRM.

File path: `Atlas/People/<Display Name>.md`

## Frontmatter

```yaml
---
type: person
id: person-<slug>
name: "<full name>"
aliases: []
status: active            # active | dormant | estranged | deceased | archived
relationship_category:    # one or more
  - collaborator
  - friend
  - advisor
  - mentor
  - mentee
  - family
  - investor
  - customer
  - vendor
  - acquaintance
organization:
  - "[[<Name>]]"
role: ""
location: ""
timezone: ""
email: ""
phone: ""
linkedin: ""
website: ""
preferred_contact_method: email   # email | phone | sms | signal | slack | in-person
contact_cadence: monthly  # weekly | biweekly | monthly | quarterly | yearly | adhoc
last_contact: YYYY-MM-DD
next_touch: YYYY-MM-DD
relationship_strength: medium     # low | medium | high
trust_level: high         # low | medium | high
availability: medium      # low | medium | high
communication_style: ""
capabilities: []          # tags
can_help_with: []         # wiki links to topics
projects: []              # wiki links
active_threads: []
waiting_on: []            # tasks where I'm waiting on this person
i_owe: []                 # tasks/commitments where I owe this person
sensitivity: private
share_with_agents: limited
allowed_agents:
  - planner
  - personal-crm
contains_personal_data: true
created: YYYY-MM-DD
updated: YYYY-MM-DD
---
```

## Body sections

- `# At a glance` — 2 sentences
- `# Current relationship context`
- `# Active threads`
- `# What they can help with`
- `# What I can help them with`
- `# Open loops`
  - `## Waiting on them`
  - `## I owe them`
  - `## Follow-up opportunities`
- `# Project connections`
- `# Conversation history` — wiki links to interactions, most recent first
- `# Preferences` — what they care about, how to communicate
- `# Important personal context` — sensitively-held facts that matter to the relationship
- `# Boundaries / sensitivities` — what not to bring up, what not to share with agents
- `# Last reviewed`

## Rules

- Default `sensitivity: private`. Do not lower without explicit user instruction.
- The auditor flags people whose `last_contact` exceeds `contact_cadence` × 1.5.
- Do not invent personal facts. Every fact under "Important personal context" must trace to an interaction note.
