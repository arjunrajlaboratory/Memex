# Schema: relationship

A **Relationship** note disambiguates a person's role *in a specific context*. The same person can be a friend, an advisor, and a co-investor; create separate relationship notes when the roles need different next-steps.

File path: `Atlas/Relationships/<Person> - <Context slug>.md`

## Frontmatter

```yaml
---
type: relationship
id: rel-<person-slug>-<context-slug>
person: "[[<Name>]]"
context: "[[<Name>]]"     # or organization, area, topic
relationship_role:
  - technical-reviewer
  - possible-collaborator
status: active            # active | paused | concluded
started: YYYY-MM-DD
ended:
current_state: ""
next_step: "[[<Title>]]"
sensitivity: private
created: YYYY-MM-DD
updated: YYYY-MM-DD
---
```

## Body sections

- `# Why this relationship exists in this context`
- `# Current dynamics`
- `# Open loops`
- `# History`

## Rules

- Use this primitive only when the role-in-context is substantive enough to need its own tracking. For simple cases, keep role information on the person page's `relationship_category:` field.
