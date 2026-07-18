// Ambient shared types for Memex Desktop. Global on purpose (no imports/exports):
// the renderer is a plain <script> (not a module), so everything it shares with the
// main process must be visible without an import.

// ---------- vault data rows ----------
interface TaskRow {
  name: string; rel: string; title: string; status: string; priority: string;
  importance?: number; urgency?: number; project: string; area: string;
  due: string; effort: string; owner: string;
}
interface ProjectRow {
  name: string; rel: string; title: string; status: string; phase: string;
  area: string; importance?: number; urgency?: number; target_date: string; updated: string;
}
interface IdeaRow {
  name: string; rel: string; title: string; status: string; priority: string;
  effort: string; tags: string[]; project: string;
}
interface PersonRow {
  name: string; rel: string; title: string; role: string; org: string;
  strength: string; email: string;
}
interface SourceRow {
  name: string; rel: string; title: string; kind: string; status: string;
  author: string; url: string;
}
type DataRow = TaskRow | ProjectRow | IdeaRow | PersonRow | SourceRow;

interface FileEntry {
  name: string; rel: string; size: number; mtime: number; ext: string; isDir?: boolean;
}

interface BriefingInfo { name: string; rel: string; body: string; raw: string; }

interface VaultSummary {
  name: string;
  path: string;
  counts: {
    tasks: number; openTasks: number; projects: number; ideas: number;
    people: number; sources: number; inbox: number; outputs: number;
  };
  tasksByStatus: Record<string, number>;
}

// A vault file read for display. Exactly one shape per `kind`.
interface VaultFile {
  kind: 'markdown' | 'html' | 'image' | 'text';
  content?: string;
  raw?: string;
  rel: string;
  dataUri?: string;   // image
  html?: string;      // markdown, rendered by the main process
  url?: string;       // html, served from the artifact:// origin
}

// ---------- custom tabs / chips (_config/desktop-tabs.json) ----------
type QuerySource = 'tasks' | 'projects' | 'ideas' | 'people' | 'sources';

interface QueryWhere {
  status?: string[]; priority?: string[]; project?: string; area?: string;
  owner?: string; tag?: string; overdue?: boolean; dueBefore?: string;
  dueWithinDays?: number; exclude_done?: boolean;
}

interface TabDef {
  id: string; label: string;
  kind: 'path' | 'query' | 'web';
  path: string; url: string; source: string;
  where: QueryWhere | null;
  empty: string;
}
interface ChipDef { label: string; prompt: string; }
interface AppConfig { tabs: TabDef[]; chips: ChipDef[]; }

// ---------- artifacts ----------
interface ArtifactView {
  title?: string;
  kind: 'html' | 'markdown' | 'image' | 'text';
  url?: string;       // html (artifact:// origin)
  html?: string;      // markdown
  text?: string;      // text fallback
  dataUri?: string;   // image
  rel?: string;       // vault-relative source file, when there is one
}

// ---------- agent events (main -> renderer) ----------
interface AgentEvent {
  kind: 'session' | 'turn_start' | 'assistant_delta' | 'thinking_delta' | 'assistant_text'
    | 'tool_start' | 'tool_use' | 'tool_result' | 'artifact' | 'permission' | 'result' | 'error';
  // session
  sessionId?: string; tools?: string[]; model?: string;
  // streaming / text
  text?: string; html?: string;
  // tools
  id?: string; name?: string; input?: Record<string, unknown>; isError?: boolean;
  // artifact (resolved for the renderer)
  artifact?: ArtifactView;
  // artifact (raw, from the show_artifact tool in the agent process)
  title?: string; format?: 'html' | 'markdown' | 'auto'; content?: string; path?: string;
  // result
  subtype?: string; result?: string; usage?: { input_tokens?: number; output_tokens?: number };
  costUsd?: number; durationMs?: number; numTurns?: number;
  // error
  message?: string;
}

// ---------- IPC payloads ----------
interface TabContentResult {
  type: 'dir' | 'file' | 'missing';
  items?: FileEntry[];
  file?: VaultFile;
}
interface TabQueryResult { source: string; rows: DataRow[]; }
interface OpenVaultResult { ok: boolean; error?: string; summary?: VaultSummary; }
interface CreateVaultResult { ok: boolean; code: number; output: string; }
interface DropResult { ok: boolean; copied?: string[]; }
interface SendResult { ok: boolean; error?: string; }

type DataKind = 'summary' | 'tasks' | 'projects' | 'ideas' | 'people' | 'sources'
  | 'inbox' | 'outputs' | 'briefing';

// ---------- the preload bridge (window.memex) ----------
interface MemexApi {
  pickDirectory(): Promise<string | null>;
  pickFiles(): Promise<string[]>;
  detectVault(p: string): Promise<{ path: string; isVault: boolean }>;
  createVault(opts: { target: string; answers: Record<string, string>; packs: string }): Promise<CreateVaultResult>;
  openVault(p: string): Promise<OpenVaultResult>;
  recentVaults(): Promise<{ recent: string[]; last: string | null }>;
  currentVault(): Promise<VaultSummary | null>;

  data(kind: 'summary'): Promise<VaultSummary | null>;
  data(kind: 'briefing'): Promise<BriefingInfo | null>;
  data(kind: 'inbox' | 'outputs'): Promise<FileEntry[] | null>;
  data(kind: DataKind): Promise<unknown>;
  appConfig(): Promise<AppConfig | null>;
  tabContent(p: string): Promise<TabContentResult>;
  tabQuery(def: TabDef): Promise<TabQueryResult>;
  readNote(rel: string): Promise<VaultFile | null>;
  registerArtifact(html: string): Promise<string>;

  sendMessage(text: string): Promise<SendResult>;
  interrupt(): Promise<{ ok: boolean }>;
  runPrompt(text: string): Promise<SendResult>;

  addInboxNote(text: string): Promise<{ ok: boolean; rel?: string }>;
  dropIntoInbox(paths: string[]): Promise<DropResult>;
  getPathForFile(file: File): string;
  openExternal(target: string): Promise<void>;
  revealPath(rel: string): Promise<void>;

  onAgentEvent(cb: (evt: AgentEvent) => void): () => void;
  onFsChanged(cb: (evt: { area: string }) => void): () => void;
  onSetupProgress(cb: (evt: { line: string }) => void): () => void;
}

// Electron's <webview> from the renderer's point of view (just what we use).
interface WebviewTag extends HTMLElement {
  src: string;
  reload(): void;
  addEventListener(type: 'did-fail-load', listener: (e: { errorCode: number; errorDescription: string; isMainFrame: boolean }) => void): void;
  addEventListener(type: string, listener: EventListenerOrEventListenerObject, options?: boolean | AddEventListenerOptions): void;
}

interface Window {
  memex: MemexApi;
  __dev: {
    open: (p: string) => void | Promise<void>;
    tab: (t: string) => void;
    send: (t?: string) => void | Promise<void>;
    artifact: (a: ArtifactView) => void;
    note: (rel: string, title?: string) => void | Promise<void>;
  };
}
