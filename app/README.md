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
- **New-vault setup** wraps the bundled engine initializer behind a form.

```
src/
  main/      main.ts (window, IPC, watchers, vault init, artifact:// protocol)
             agent.ts (Claude Agent SDK session: streaming, tools, interrupt)
             vault.ts (reads tasks/projects/… from the vault's Markdown)
  preload/   preload.ts (contextBridge API)
  renderer/  index.html · styles.css · renderer.ts (the UI)
```

## Prerequisites

- **Node.js 18+** and npm.
- A **logged-in Claude Code CLI** (`claude` — run `claude` once and sign in). The Agent SDK
  reuses those credentials.
- **Python 3** on PATH (only needed to *create* a new vault; opening an existing one doesn't need it).
- The Memex **engine** when running from source. Packaged builds include the initializer templates.

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

### Dev does not exercise everything

Some code paths only exist in a packaged app, and shipping them unverified has
bitten this project three times. Anything behind `app.isPackaged`, anything that
spawns a subprocess, and anything importing a CommonJS dependency needs a real
packaged run before release — `npm start` cannot catch those failures:

- Paths that traverse `app.asar` cannot be `spawn`ed (Electron redirects file
  reads into `app.asar.unpacked`, but not the executable given to spawn). See
  `src/main/claude-binary.ts`.
- Default-importing a CJS module that sets `__esModule: true` without a
  `default` export yields `undefined` at runtime (hit with `electron-updater`).

`docs/RELEASING.md` → "Packaged-build gotchas" has the recipe for running and
driving a packaged build, including how to test auto-update.

## Customizing tabs & quick-actions

The right panel starts with a curated set of frequently used tabs. Use the **gear beside the tab bar**
to hide any of those defaults or add any other folder in the vault; choices are stored per vault.

Tabs *and* the quick-action chips are also user-customizable, the Memex way — as a plain
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

The gear stores its choices in the same file under `navigation`, while preserving tabs, chips, and
other settings:

```json
{
  "navigation": {
    "hidden": ["ideas"],
    "folders": ["Atlas/Areas", "Ops/Briefings"]
  }
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

## HTML artifact contract

HTML shown in the artifact panel must be fully self-contained: inline its CSS and JavaScript, use
`data:` URLs for images, and do not depend on CDNs, remote assets, network requests, or embedded
network frames. The app deliberately serves each document from its own `artifact://` origin under a
strict no-network content security policy. Ordinary HTTP(S) links are delegated to the system
browser after a native confirmation. A live page that needs network access belongs in a custom
`kind: "web"` tab instead.

## Notes

- The app is strict TypeScript compiled with `tsc`; renderer HTML/CSS assets are copied into `dist/`.
- Permission mode is `acceptEdits`, so normal vault edits remain fluid. Operations the SDK flags as
  requiring permission (for example shell commands or access outside the vault) show a native
  **Deny / Allow once / Always allow in this vault** dialog and are denied by default. Persistent
  grants match the exact SDK tool name, apply only to the current vault, and can be cleared from the
  vault switcher with **Reset tool approvals for this vault**.
