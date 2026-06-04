# Privacy & agent-sharing rules

Every note carries a `sensitivity` field and optionally `share_with_agents`, `allowed_agents`, `forbidden_agents`, `contains_personal_data`.

## Levels

| Level | Meaning | Default agent behavior |
| --- | --- | --- |
| `normal` | Default. Shareable across local agents. | Read/write/quote freely. |
| `private` | Personal context, internal stakes, draft messages. | Read OK; do **not** quote in generated outputs (briefings excepted) or send to external services. |
| `sensitive` | Health, finances, legal, intimate relationships, contested matters. | Do **not** include in generated summaries unless the user explicitly references the note. Never send to external APIs. Never include verbatim in agent run logs. |

## Defaults

- `Person`, `Interaction`, `Commitment`, `Ask`, `Relationship`: default `private`.
- Anything mentioning health, finances, or legal: default `sensitive`.
- Briefings and reviews: inherit the strictest sensitivity of any referenced note.

## How agents enforce

Before quoting or sending content from a note, agents check `sensitivity` and `share_with_agents`. If `share_with_agents: limited` and the current agent role is not in `allowed_agents`, the agent must summarize at one level of abstraction higher (e.g. "a personal commitment" instead of "promised X to Y by Friday").
