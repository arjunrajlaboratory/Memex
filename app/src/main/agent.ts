// Wraps the Claude Agent SDK as a long-lived, multi-turn session bound to a vault
// directory. The vault's own CLAUDE.md, .claude/skills, settings and hooks are
// loaded via settingSources, so this behaves like Claude Code running in the vault.

// The SDK is ESM-only, so its VALUES are loaded with a dynamic import() (preserved
// by module:node16); its TYPES are erased at compile time, so importing them
// statically is safe and keeps this file honest against SDK upgrades.
import type { ModelInfo, Query, SDKMessage, SDKUserMessage } from '@anthropic-ai/claude-agent-sdk' with { 'resolution-mode': 'import' };

type QueueResult = IteratorResult<SDKUserMessage, undefined>;

/** Minimal push-driven async queue used as the SDK's streaming-input prompt. */
class MessageQueue implements AsyncIterableIterator<SDKUserMessage> {
  private items: SDKUserMessage[] = [];
  private waiters: Array<(r: QueueResult) => void> = [];
  private closed = false;

  push(item: SDKUserMessage): void {
    const w = this.waiters.shift();
    if (w) w({ value: item, done: false });
    else this.items.push(item);
  }
  close(): void {
    this.closed = true;
    for (const w of this.waiters.splice(0)) w({ value: undefined, done: true });
  }
  [Symbol.asyncIterator](): AsyncIterableIterator<SDKUserMessage> { return this; }
  next(): Promise<QueueResult> {
    if (this.items.length) return Promise.resolve({ value: this.items.shift() as SDKUserMessage, done: false });
    if (this.closed) return Promise.resolve({ value: undefined, done: true });
    return new Promise((resolve) => this.waiters.push(resolve));
  }
}

const APPEND_PROMPT = `You are running inside the Memex desktop app. The user sees a chat panel on the left and an artifact panel on the right.

When you produce something visual or browsable — a dashboard, a status board, a table, a chart, a rendered report, or any HTML — call the \`show_artifact\` tool to display it in the right-hand panel instead of dumping a long block into chat. For prose write-ups, markdown is fine.

IN-APP HTML CONTRACT: Any HTML shown as an artifact, whether passed inline or loaded from a vault \`.html\` file, must be a fully self-contained document. Inline all CSS and JavaScript, encode images as \`data:\` URLs, and do not use CDNs, remote fonts/assets, \`fetch\`, XHR, WebSockets, or embedded network frames. Ordinary HTTP(S) links are fine; after confirmation, the desktop app opens them in the system browser. If the user needs a live network page, configure a custom tab with \`"kind":"web"\` and an HTTP(S) \`url\` instead of making it an artifact.

Keep your chat replies short and conversational — a sentence or two saying what you did or found — and put the rich, long, or visual content in an artifact. You can also pass a \`path\` (relative to the vault root) to show an existing file (e.g. a generated dashboard in outputs/ or a note in Atlas/).

This is the user's own Memex vault. Follow AGENTS.md / CLAUDE.md, use the vault's skills, and keep notes schema-conformant.

CUSTOM TABS & CHIPS: The right panel's tabs and the quick-action chips above the message box are user-customizable via the vault file \`_config/desktop-tabs.json\`. When the user asks to add/rename/remove/repoint a tab or add a quick-action, create or edit that file. Preserve the existing \`navigation\` object (the gear menu's per-vault visibility/folder choices), the other tabs and chips, and any unknown fields. Changes apply live — never tell the user to restart or refresh.

Shape: {"tabs":[ ... ], "chips":[ ... ], "navigation":{"hidden":[ ... ], "folders":[ ... ]}}.

Each tab has a short lowercase unique \`id\` (never dashboard/tasks/projects/ideas/people/inbox/outbox/artifact) and a display \`label\`, plus ONE of:
- \`"path"\`: a vault-relative path to a folder (browsable file list) or a single file (rendered). e.g. {"id":"cv","label":"CV","path":"CV"}.
- \`"kind":"query"\` with \`"source"\` (one of tasks/projects/ideas/people/sources) and an optional \`"where"\` filter. \`where\` keys (all optional, ANDed): status (array), priority (array, e.g. ["p0","p1"]), project (substring), area (substring), tag (for ideas), overdue (true), dueBefore ("YYYY-MM-DD"), dueWithinDays (number). e.g. {"id":"due","label":"Due this week","kind":"query","source":"tasks","where":{"status":["next","in_progress","waiting"],"dueWithinDays":7}}.
- \`"kind":"web"\` with \`"url"\`: embeds a page (e.g. the vault's Quartz dashboard site, usually http://localhost:<QUARTZ_PORT>/... — the port is in _config). e.g. {"id":"board","label":"Dashboards","kind":"web","url":"http://localhost:8137/"}.

Each chip has \`"label"\` and \`"prompt"\` (the message sent to you when clicked). e.g. {"label":"Blockers","prompt":"What's blocked right now and why?"}. Custom chips appear after the built-in ones.

ARTIFACT FRESHNESS: The artifact panel is a living surface, not an archive. When the conversation moves on and an earlier artifact no longer matches what the user is working on, replace it with something relevant — prefer refreshing an existing dashboard or report over minting a near-duplicate — or simply leave replies chat-only; the user can close a stale artifact with the × on its tab. Never keep steering the user back to an outdated artifact.

CLAUDE CODE HAND-OFF: Memex is a knowledge tool, not an IDE. When the user starts real software-engineering work on a code repository (multi-file changes, tests, a git repo outside this vault), offer to hand off: call the \`open_in_claude_code\` tool with the repo directory to launch a Claude Code session in their terminal, and keep the vault side (notes, tasks, decisions) here. Small vault-local scripts and one-off snippets are fine to do in place.`;

export class AgentSession {
  private cwd: string;
  private onEvent: (evt: AgentEvent) => void;
  private requestPermission: (request: AgentPermissionRequest) => Promise<boolean>;
  private openInClaudeCode: (dirPath: string) => Promise<{ ok: boolean; message: string }>;
  private claudeExecutable: string | undefined;
  private model: string | undefined;
  private queue = new MessageQueue();
  private query: Query | null = null;
  running = false;
  busy = false;

  constructor({
    cwd,
    onEvent,
    requestPermission,
    openInClaudeCode,
    claudeExecutable,
    model,
  }: {
    cwd: string;
    onEvent: (evt: AgentEvent) => void;
    requestPermission?: (request: AgentPermissionRequest) => Promise<boolean>;
    openInClaudeCode?: (dirPath: string) => Promise<{ ok: boolean; message: string }>;
    // Absolute path to the bundled `claude` binary. The host supplies this in
    // packaged builds, where the SDK's own resolution points into app.asar.
    claudeExecutable?: string;
    // Model alias or id to run on. Omitted = whatever the SDK inherits from the
    // user's Claude Code configuration, which was the only behaviour before the
    // in-app picker existed.
    model?: string;
  }) {
    this.cwd = cwd;
    this.onEvent = onEvent || (() => {});
    // Fail closed if a host ever constructs a session without a permission UI.
    this.requestPermission = requestPermission || (async () => false);
    // Fail closed if a host does not supply a launcher.
    this.openInClaudeCode = openInClaudeCode || (async () => ({ ok: false, message: 'Claude Code hand-off is not available in this host.' }));
    this.claudeExecutable = claudeExecutable;
    this.model = model;
  }

  async start(): Promise<void> {
    const sdk = await import('@anthropic-ai/claude-agent-sdk');
    const { query, tool, createSdkMcpServer } = sdk;
    const { z } = await import('zod');

    const showArtifact = tool(
      'show_artifact',
      'Display content in the app\'s right-hand artifact panel. Use for dashboards, HTML, tables, charts, or rendered reports. Provide either inline `content`, or a `path` (relative to the vault root) to an existing file.',
      {
        title: z.string().describe('Short title shown above the artifact'),
        format: z.enum(['html', 'markdown', 'auto']).default('auto')
          .describe('How to render inline content. "auto" infers from a path extension.'),
        content: z.string().optional().describe('Inline content (HTML or markdown). Omit if using path.'),
        path: z.string().optional().describe('Vault-relative path to an existing file to display.'),
      },
      async (args) => {
        this.onEvent({ kind: 'artifact', ...args });
        return { content: [{ type: 'text' as const, text: `Displayed "${args.title}" in the artifact panel.` }] };
      },
      { annotations: { readOnlyHint: true } }
    );

    const openInClaudeCode = tool(
      'open_in_claude_code',
      'Hand off to Claude Code: open the user\'s terminal running the `claude` CLI in a project directory. Use when the user wants to do real software-engineering work on a code repository.',
      {
        path: z.string().describe('Directory to open (absolute, or ~/... relative to the user home)'),
      },
      async (args) => {
        const res = await this.openInClaudeCode(args.path);
        return { content: [{ type: 'text' as const, text: res.message }], isError: res.ok ? undefined : true };
      }
    );

    const uiServer = createSdkMcpServer({ name: 'ui', version: '1.0.0', tools: [showArtifact, openInClaudeCode] });

    this.query = query({
      prompt: this.queue,
      options: {
        cwd: this.cwd,
        ...(this.claudeExecutable ? { pathToClaudeCodeExecutable: this.claudeExecutable } : {}),
        ...(this.model ? { model: this.model } : {}),
        settingSources: ['user', 'project'],
        systemPrompt: { type: 'preset', preset: 'claude_code', append: APPEND_PROMPT },
        permissionMode: 'acceptEdits',
        includePartialMessages: true,
        maxTurns: 100,
        mcpServers: { ui: uiServer },
        canUseTool: async (name: string, input: Record<string, unknown>, options) => {
          this.onEvent({ kind: 'permission', name });
          const allowed = await this.requestPermission({
            name,
            input,
            title: options.title,
            displayName: options.displayName,
            description: options.description,
            decisionReason: options.decisionReason,
            blockedPath: options.blockedPath,
          });
          if (options.signal.aborted) {
            return { behavior: 'deny' as const, message: 'This operation was canceled before permission was granted.' };
          }
          if (!allowed) {
            return { behavior: 'deny' as const, message: 'The user denied this operation.' };
          }
          // The host owns persistent per-vault grants; do not apply the SDK's
          // suggested permission updates as a separate, broader policy layer.
          return { behavior: 'allow' as const, updatedInput: input };
        },
      },
    });

    this.running = true;
    this._consume().catch((err: unknown) => {
      this.onEvent({ kind: 'error', message: String((err as Error)?.message || err) });
      this.running = false;
    });
  }

  private async _consume(): Promise<void> {
    if (!this.query) return;
    for await (const msg of this.query) {
      try { this._handle(msg); } catch (e) { /* keep the loop alive */ }
    }
    this.running = false;
  }

  private _handle(msg: SDKMessage): void {
    switch (msg.type) {
      case 'system':
        if (msg.subtype === 'init') {
          // When a model override is active, init reports the override — not the
          // configuration default the picker's "default" entry falls back to —
          // so only pass the model on as the inherited one when nothing was set.
          this.onEvent({ kind: 'session', sessionId: msg.session_id, tools: msg.tools, model: this.model ? undefined : msg.model });
        }
        break;

      case 'stream_event': {
        const ev = msg.event;
        if (ev.type === 'content_block_delta') {
          if (ev.delta.type === 'text_delta' && ev.delta.text) {
            this.onEvent({ kind: 'assistant_delta', text: ev.delta.text });
          } else if (ev.delta.type === 'thinking_delta' && ev.delta.thinking) {
            this.onEvent({ kind: 'thinking_delta', text: ev.delta.thinking });
          }
        } else if (ev.type === 'content_block_start' && ev.content_block.type === 'tool_use') {
          this.onEvent({ kind: 'tool_start', name: ev.content_block.name, id: ev.content_block.id });
        }
        break;
      }

      case 'assistant': {
        for (const b of msg.message.content) {
          if (b.type === 'text' && b.text != null) {
            this.onEvent({ kind: 'assistant_text', text: b.text });
          } else if (b.type === 'tool_use') {
            this.onEvent({ kind: 'tool_use', id: b.id, name: b.name, input: b.input as Record<string, unknown> });
          }
        }
        break;
      }

      case 'user': {
        // Tool results are delivered back as user messages carrying tool_result blocks.
        const content = msg.message.content;
        if (Array.isArray(content)) {
          for (const b of content) {
            if (typeof b !== 'string' && b.type === 'tool_result') {
              this.onEvent({
                kind: 'tool_result',
                id: b.tool_use_id,
                text: normalizeResult(b.content),
                isError: !!b.is_error,
              });
            }
          }
        }
        break;
      }

      case 'result': {
        this.busy = false;
        this.onEvent({
          kind: 'result',
          subtype: msg.subtype,
          result: msg.subtype === 'success' ? msg.result : undefined,
          usage: msg.usage,
          costUsd: msg.total_cost_usd,
          durationMs: msg.duration_ms,
          numTurns: msg.num_turns,
        });
        break;
      }
      default:
        break;
    }
  }

  send(text: string): boolean {
    if (!this.running) return false;
    this.busy = true;
    this.onEvent({ kind: 'turn_start' });
    this.queue.push({ type: 'user', message: { role: 'user', content: text }, parent_tool_use_id: null });
    return true;
  }

  /** Switch the model for subsequent turns; undefined returns to the inherited default. */
  async setModel(model?: string): Promise<void> {
    if (!this.query || !this.running) throw new Error('No active session');
    await this.query.setModel(model);
    this.model = model;
  }

  /** The models the underlying CLI reports as selectable, mapped for the renderer. */
  async supportedModels(): Promise<ModelOption[]> {
    if (!this.query || !this.running) return [];
    const models: ModelInfo[] = await this.query.supportedModels();
    return models.map((m) => ({
      value: m.value,
      label: m.displayName || m.value,
      description: m.description || undefined,
    }));
  }

  async interrupt(): Promise<void> {
    if (this.query && this.running) {
      try { await this.query.interrupt?.(); } catch (_) {}
    }
    this.busy = false;
  }

  async stop(): Promise<void> {
    this.queue.close();
    try { if (this.query && this.query.interrupt) await this.query.interrupt(); } catch (_) {}
    this.running = false;
  }
}

function normalizeResult(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    // optional chaining: a malformed null/primitive element must not throw here —
    // a throw would be swallowed upstream and leave the tool card spinning forever
    return content.map((c) => (typeof c === 'string' ? c : String((c as { text?: unknown })?.text ?? ''))).join('\n');
  }
  return '';
}
