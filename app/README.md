# Memex Desktop

A desktop app that installs and drives a [Memex](../README.md) vault: **chat on the left,
artifacts and dashboards on the right**, drop zones for the Inbox, a listing of the Outbox,
and quick buttons for the common flows. It's a friendly front end on top of the same agent
you'd otherwise run from Claude Code in the terminal.

## How it works

The app is a thin, opinionated shell around the **Claude Agent SDK**:

- **The agent is Claude Code, pointed at your vault.** A long-lived multi-turn SDK session
  runs with the vault as its working directory and `settingSources: ['user', 'project']`, so
  it inherits the vault's `CLAUDE.md` / `AGENTS.md`, its `.claude/skills/`, settings, and hooks —
  exactly what you get from `claude` in that folder. Auth comes from your logged-in Claude Code
  CLI (no API key needed).
- **The right panel is driven by the agent.** The app exposes one in-process MCP tool,
  `show_artifact`, so when the agent builds a dashboard, HTML, or a report it pushes it straight
  into the artifact panel. HTML artifacts render in an isolated `artifact://` origin (their own
  scripts run; they can't touch the app).
- **Data panels are read straight from disk.** Tasks, Projects, Ideas, People, Inbox, and Outbox
  are parsed from the vault's Markdown frontmatter locally — instant, free, and always live via
  filesystem watchers. No tokens spent just to browse.
- **Inbox drop zones** copy dropped files (or a typed quick-note) into `Inbox/`; **Outbox** lists
  everything the agent has generated under `outputs/`.
- **New-vault setup** wraps the engine's `bin/memex-init` (the Python installer) behind a form.

```
src/
  main/      main.js (window, IPC, watchers, vault init, artifact:// protocol)
             agent.js (Claude Agent SDK session: streaming, tools, interrupt)
             vault.js (reads tasks/projects/… from the vault's Markdown)
  preload/   preload.js (contextBridge API)
  renderer/  index.html · styles.css · renderer.js (the UI)
```

## Prerequisites

- **Node.js 18+** and npm.
- A **logged-in Claude Code CLI** (`claude` — run `claude` once and sign in). The Agent SDK
  reuses those credentials.
- **Python 3** on PATH (only needed to *create* a new vault; opening an existing one doesn't need it).
- The Memex **engine** — this `app/` folder lives inside the engine repo and finds it automatically.

## Run

```bash
cd app
npm install      # installs Electron + the Agent SDK (first run downloads the Electron binary)
npm start
```

On first launch you'll get the setup screen: **open** an existing vault, or **create** a new one.

## Development

`npm run dev` sets `MEMEX_DEV=1`, which enables a small screenshot/scripting harness used to
iterate on the UI. Two optional env vars:

- `MEMEX_OPEN=/path/to/vault` — auto-open a vault on launch.
- `MEMEX_DEVCTL=/path/to/ctlfile` — a JSON control file the app polls; write
  `{"js":"…","shot":"/path/out.png"}` to run code in the window and/or capture a screenshot.

## Customizing tabs & quick-actions

The right panel's tabs *and* the quick-action chips are user-customizable, the Memex way — as a plain
vault file the agent maintains, `_config/desktop-tabs.json`. You don't edit it by hand: just ask the
agent ("add a CV tab", "add a tab for my p1 tasks", "embed my dashboards", "add a Blockers shortcut")
and it writes the file. The app watches `_config/` and **rebuilds live** — no restart, no refresh.

```json
{
  "tabs": [
    { "id": "cv",       "label": "CV",         "path": "CV" },
    { "id": "priority", "label": "Priority",   "kind": "query", "source": "tasks",
      "where": { "priority": ["p0","p1"], "status": ["next","in_progress","waiting"] } },
    { "id": "board",    "label": "Dashboards", "kind": "web", "url": "http://localhost:8137/" }
  ],
  "chips": [
    { "label": "Blockers", "prompt": "What's blocked right now and why?" }
  ]
}
```

Each tab has a unique lowercase `id` (not a built-in name) and a `label`, plus one of:

- **`path`** — a vault-relative path to a folder (browsable file list) or a single file (rendered).
- **`kind: "query"`** — a live filtered view over a `source` (`tasks`/`projects`/`ideas`/`people`/`sources`)
  with an optional `where` (keys: `status`, `priority`, `project`, `area`, `tag`, `overdue`,
  `dueBefore`, `dueWithinDays`). Renders as rows like the built-in list, with a live count.
- **`kind: "web"`** — embeds a `url` in an isolated `<webview>` (separate process, so full SPA sites
  render). Point it at the vault's Quartz dashboard site (`http://localhost:<QUARTZ_PORT>/…`) or any
  local page; scripts run, and there's a Reload button.

Each `chips` entry is `{ label, prompt }` — a quick-action button (shown after the built-ins) that
sends `prompt` to the chat when clicked. Custom tabs and chips are marked with a small `＋` and behave
like any built-in (back/forward history, live refresh).

## Notes / next steps

- Written in plain JS with no build step (fast to iterate). A TypeScript migration is
  straightforward if the app grows — the SDK and Electron are fully typed and the IPC surface is small.
- Permission mode is `acceptEdits` and tool calls are auto-approved; a future version could surface a
  per-tool approval prompt in the UI via the SDK's `canUseTool` hook (already wired).
