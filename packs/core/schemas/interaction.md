# Schema: interaction

An **Interaction** is the event-level record of one contact with a person: a call, meeting, coffee, message exchange, email thread. The person profile is the durable summary; interactions are the timeline.

File path: `Atlas/People/Interactions/<Person Name> - YYYY-MM-DD.md` — use the Person's `safe_title` name (see `_schemas/_types.md` → "Filenames and titles"): the `<Person Name>` component must match the Person note's filename/`[[wikilink]]` exactly; no `/ : \ * ? " < > | # ^ [ ]`.

## Frontmatter

```yaml
---
type: interaction
id: int-YYYYMMDD-<person-slug>
person:
  - "[[<Name>]]"
date: YYYY-MM-DD
duration: 30m
interaction_type: call    # call | meeting | coffee | meal | message | email | dm | conference | event | passing
medium: phone             # phone | video | in_person | email | slack | sms | signal
project:
  - "[[<Name>]]"
topics:
  - "[[<Name>]]"
summary: "<one-sentence summary>"
followups_created: []
commitments_made: []
sensitivity: private
created: YYYY-MM-DD
updated: YYYY-MM-DD
---
```

## Body sections

- `# Summary`
- `# Key points` — what mattered
- `# Things they said` — quotes if accurate; paraphrases otherwise
- `# Things I promised` — links to commitments
- `# Things they promised`
- `# Follow-ups` — links to tasks/asks/commitments created
- `# Relationship notes` — anything that should update the person profile
- `# Project updates` — anything that should update a project page
- `# Raw notes` — your scrappy notes from the conversation

## Rules

- After creating an interaction, the librarian agent updates the linked person's `last_contact:` and recomputes `next_touch:` based on `contact_cadence:`.
- Commitments mentioned in `# Things I promised` / `# Things they promised` must spawn Commitment notes.
- Default `sensitivity: private`.
