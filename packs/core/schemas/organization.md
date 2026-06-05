# Schema: organization

An **Organization** is a company, lab, school, group, agency, or other named collective.

File path: `Atlas/Organizations/<Name>.md` — run the name through `safe_title` first (see `_schemas/_types.md` → "Filenames and titles"): filename stem = `name:` = every `[[wikilink]]`; no `/ : \ * ? " < > | # ^ [ ]`.

## Frontmatter

```yaml
---
type: organization
id: org-<slug>
name: "<full name>"
aliases: []
status: active            # active | dormant | defunct | archived
relationship_type:
  - collaborator
  - customer
  - vendor
  - employer
  - funder
  - regulator
  - peer-institution
website: ""
location: ""
people:
  - "[[<Name>]]"
projects: []
key_contacts: []
contracts: []
notes_privacy: private
sensitivity: normal
created: YYYY-MM-DD
updated: YYYY-MM-DD
---
```

## Body sections

- `# What they do`
- `# Our relationship`
- `# Key people` — wiki-linked
- `# Active projects together`
- `# History` — short timeline
- `# Open loops`
- `# Risks / opportunities`
- `# Decision-makers`
