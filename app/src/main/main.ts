import { app, BrowserWindow, ipcMain, dialog, shell, protocol } from 'electron';
import type { IpcMainInvokeEvent } from 'electron';
// Named import, not default: electron-updater is CJS with `__esModule: true`
// and no `default` export, so a default import compiles to an undefined value.
// `autoUpdater` is a lazy getter that constructs on first access, so it must
// stay a property read that happens after app.whenReady.
import { autoUpdater } from 'electron-updater';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { spawn } from 'child_process';

import * as vaultLib from './vault';
import { AgentSession } from './agent';
import { ArtifactStore } from './artifact-store';
import { localDatePlusDays, localDateString } from './date';
import { copyPathsIntoInbox, writeInboxNote } from './inbox';
import { invalidateSearchIndex, searchVault } from './search';
import { clearVaultToolGrants, grantTool, hasToolGrant, type ToolGrantState } from './grants';
import { setVaultModel, vaultModel, type ModelPreferenceState } from './model-preferences';
import { isSafeExternalUrl, isTrustedFileUrl, resolveInside, resolvedStaysInside } from './security';
import { hardenMarkdownRenderer, wikilinkMarkdown } from './markdown';
import { externalNavigationPolicy, installDenyByDefaultPermissions } from './web-policy';
import { VaultTransitionGate } from './vault-transition';
import { classifyVaultChange } from './watch-policy';
import { buildWikiIndex } from './wiki-index';
import { SerialQueue } from './serial-queue';
import { unpackedClaudeBinaryPath } from './claude-binary';
import { acceptanceRecord, loadLegal, needsAcceptance, type LegalDocs, type TermsAcceptance } from './legal';
import {
  CONFIGURABLE_BUILTIN_TAB_IDS,
  isReservedDesktopTabId,
  parseDesktopTabsDocument,
  tabPreferencesFromDocument,
  withTabPreferences,
  writeDesktopTabsDocument,
  type DesktopTabsDocument,
} from './tab-preferences';

const fsp = fs.promises;
// Development runs inside the engine checkout; packaged builds carry the exact
// initializer inputs as an extra resource next to app.asar.
const ENGINE_ROOT = app.isPackaged
  ? path.join(process.resourcesPath, 'engine')
  : path.resolve(__dirname, '..', '..', '..');
const RENDERER_PATH = path.join(__dirname, '..', 'renderer', 'index.html');
// The vault's /update skill resolves its engine via MEMEX_ENGINE_DIR when the
// user doesn't name one. The agent child process inherits this environment, so
// exporting the bundled engine here makes a typed "update memex" work without
// the user knowing where the app keeps its engine. A pre-set value wins — a
// developer pointing at a different engine tree knows better than we do.
if (!process.env.MEMEX_ENGINE_DIR) process.env.MEMEX_ENGINE_DIR = ENGINE_ROOT;
const CONFIG_PATH = () => path.join(app.getPath('userData'), 'config.json');
const LEGAL_DIR = path.join(__dirname, '..', 'legal');

interface PersistedConfig extends ToolGrantState, ModelPreferenceState { recent?: string[]; last?: string; terms?: TermsAcceptance; }

// Node's fs does not expand a leading ~, but the user's placeholder path is ~/…,
// so expand it wherever a user-supplied path enters the main process.
function expandHome(p: string): string {
  if (typeof p !== 'string') return p;
  if (p === '~') return os.homedir();
  if (p.startsWith('~/') || p.startsWith('~\\')) return path.join(os.homedir(), p.slice(2));
  return p;
}

let win: BrowserWindow | null = null;
let currentVault: string | null = null;
const vaultTransition = new VaultTransitionGate();
let session: AgentSession | null = null;
// The CLI's model list is static for a session's lifetime; cache it so the
// renderer's refreshes don't repeat the control round-trip.
let sessionModelsCache: ModelOption[] | null = null;
// Model switches mutate the live session, this.model, and the persisted config
// together; run them one at a time so a rapid flip can't interleave those writes.
const modelSwitchQueue = new SerialQueue();
let watchers: fs.FSWatcher[] = [];
let watcherRestartTimer: ReturnType<typeof setTimeout> | null = null;
let shuttingDown = false;
let mdRenderer: ((md: string) => string) | null = null;
// `undefined` = not yet read, `null` = read and unusable. Cached because the
// documents cannot change without a new build.
let legalDocs: LegalDocs | null | undefined;
function legal(): LegalDocs | null {
  if (legalDocs === undefined) legalDocs = loadLegal(LEGAL_DIR);
  return legalDocs;
}
// The gate is enforced here, not in the renderer: MEMEX_OPEN and any UI bug
// would otherwise sail straight past a purely visual overlay.
function termsAccepted(): boolean {
  return !needsAcceptance(loadConfig().terms, legal()?.manifest || null);
}
// Files dropped on the Dock icon (mac) or taskbar/exe (Windows) before any vault is open;
// flushed into the Inbox once vault:open succeeds.
let pendingDrops: string[] = [];
const inboxCopyQueue = new SerialQueue();

function activeVaultPath(): string | null {
  return vaultTransition.canAccess(currentVault) ? currentVault : null;
}

// Artifacts are served from their own secure origin so their inline scripts run
// (a file:// page's CSP is inherited by srcdoc/blob children; a distinct scheme is not).
protocol.registerSchemesAsPrivileged([
  { scheme: 'artifact', privileges: { standard: true, secure: true, supportFetchAPI: true } },
]);
const artifactStore = new ArtifactStore(200);
const ARTIFACT_TOO_LARGE = '<!doctype html><meta charset="utf-8"><body style="font-family:system-ui;padding:32px;background:#1b1810;color:#efe7d4"><h2>Artifact too large to display</h2><p>Save it as a smaller file or split it into multiple artifacts.</p></body>';
function artifactScope(vault: string): string {
  try { return fs.realpathSync(vault); } catch (_) { return path.resolve(vault); }
}
function registerArtifact(html: string, vault: string): string {
  // The host is the origin for a standard custom scheme. Deduplication is scoped
  // to one canonical vault so identical dashboards cannot share localStorage.
  const scope = artifactScope(vault);
  const id = artifactStore.register(scope, html || '') || artifactStore.register(scope, ARTIFACT_TOO_LARGE);
  if (!id) throw new Error('Artifact size policy is invalid');
  return `artifact://${id}/index.html`;
}

const ARTIFACT_CSP = [
  "default-src 'none'",
  "script-src 'unsafe-inline'",
  "style-src 'unsafe-inline'",
  'img-src data: blob:',
  'font-src data:',
  'media-src data: blob:',
  "connect-src 'none'",
  "frame-src 'none'",
  "form-action 'none'",
  "base-uri 'none'",
].join('; ');

// ---------- small persistent config (recent vaults) ----------
function loadConfig(): PersistedConfig {
  try { return JSON.parse(fs.readFileSync(CONFIG_PATH(), 'utf8')) as PersistedConfig; } catch (_) { return { recent: [] }; }
}
function saveConfig(cfg: PersistedConfig): void {
  try { fs.mkdirSync(path.dirname(CONFIG_PATH()), { recursive: true }); fs.writeFileSync(CONFIG_PATH(), JSON.stringify(cfg, null, 2)); } catch (_) {}
}
function rememberVault(p: string): void {
  const cfg = loadConfig();
  cfg.recent = [p, ...(cfg.recent || []).filter((x) => x !== p)].slice(0, 8);
  cfg.last = p;
  saveConfig(cfg);
}

// ---------- wikilink index (Memex convention: filename stem == title == [[target]]) ----------
// Built asynchronously (and memoized as a promise) so a large vault's file walk never
// blocks the main process. Invalidated by setting wikiIndexPromise = null.
let wikiIndexPromise: Promise<Map<string, string>> | null = null;
function getWikiIndex(): Promise<Map<string, string>> {
  if (!currentVault) return Promise.resolve(new Map());
  if (!wikiIndexPromise) wikiIndexPromise = buildWikiIndex(currentVault);
  return wikiIndexPromise;
}
// Turn [[Target]], [[Target|Alias]], [[Target#heading]] into clickable internal
// links when the target resolves to a note, else a plain (unbracketed) label.
async function linkifyWikilinks(md: string): Promise<string> {
  const idx = await getWikiIndex();
  return String(md || '').replace(/\[\[([^\]|#\n]+)(?:#[^\]|\n]+)?(?:\|([^\]\n]+))?\]\]/g, (m, target: string, alias?: string) => {
    const label = (alias || target).trim();
    const rel = idx.get(target.trim().toLowerCase());
    return wikilinkMarkdown(label, rel);
  });
}

// ---------- query filter for custom "query" tabs ----------
type FilterableRow = Partial<TaskRow> & { status?: string; due?: string; tags?: string[] };
function filterRows<T extends FilterableRow>(rows: T[], where: QueryWhere | null | undefined, source: string): T[] {
  const w: QueryWhere = where || {};
  const now = new Date();
  const today = localDateString(now);
  const plusDays = (n: number) => localDatePlusDays(n, now);
  const done = new Set(['done', 'canceled']);
  const has = (v: unknown): boolean => v != null && v !== '';
  const inList = (arr: unknown, v: unknown) => Array.isArray(arr) && arr.map(String).includes(String(v));
  const sub = (hay: unknown, needle: unknown) => String(hay || '').toLowerCase().includes(String(needle).toLowerCase());
  return rows.filter((r) => {
    if (w.status && !inList(w.status, r.status)) return false;
    if (w.priority && !inList(w.priority, r.priority)) return false;
    if (has(w.project) && !sub(r.project, w.project)) return false;
    if (has(w.area) && !sub(r.area, w.area)) return false;
    if (has(w.owner) && String(r.owner || '') !== String(w.owner)) return false;
    if (has(w.tag) && !(Array.isArray(r.tags) && r.tags.map((x) => String(x).toLowerCase()).includes(String(w.tag).toLowerCase()))) return false;
    if (w.overdue && !(r.due && r.due < today && !done.has(r.status || ''))) return false;
    if (has(w.dueBefore) && !(r.due && r.due < (w.dueBefore as string))) return false;
    if (typeof w.dueWithinDays === 'number' && !(r.due && r.due <= plusDays(w.dueWithinDays))) return false;
    // tasks: hide done/canceled by default unless the query asks for them
    if (source === 'tasks' && w.exclude_done !== false && !w.status && done.has(r.status || '')) return false;
    return true;
  });
}

const BUILTIN_TAB_IDS = new Set<string>(CONFIGURABLE_BUILTIN_TAB_IDS);
const BUILTIN_TAB_PATHS = new Set(['Ops/Tasks', 'Atlas/Projects', 'Atlas/Ideas', 'Atlas/People', 'Inbox', 'outputs']);

// desktop-tabs.json is hand-editable: accept a scalar where the schema wants an
// array (e.g. "status": "next"), else the filter silently matches nothing.
function normalizeWhere(w: unknown): QueryWhere | null {
  if (!w || typeof w !== 'object') return null;
  const out = { ...(w as QueryWhere) } as Record<string, unknown>;
  for (const k of ['status', 'priority']) {
    if (out[k] != null && !Array.isArray(out[k])) out[k] = [String(out[k])];
  }
  return out as QueryWhere;
}

function readDesktopTabsDocument(vault: string, strict = false): DesktopTabsDocument {
  const relative = path.join('_config', 'desktop-tabs.json');
  const file = vaultLib.readFile(vault, relative);
  if (!file || file.kind !== 'text') {
    if (strict && fs.existsSync(path.join(vault, relative))) throw new Error('desktop-tabs.json is not a safe readable file');
    return {};
  }
  try {
    return parseDesktopTabsDocument(file.content || '');
  } catch (error) {
    if (strict) throw error;
    return {};
  }
}

function appConfigFromDocument(vault: string, document: DesktopTabsDocument): AppConfig {
  const out: AppConfig = { tabs: [], chips: [], hiddenTabs: [], folders: [], availableFolders: [] };
  const cfg = document as { tabs?: unknown[]; chips?: unknown[] };
  if (Array.isArray(cfg.tabs)) {
    const seen = new Set<string>();
    out.tabs = cfg.tabs
      .map((t) => {
        const tab = t as Partial<TabDef> & { id?: unknown; label?: unknown };
        if (!tab || !tab.label) return null;
        // no id: derive one from the label rather than silently dropping the tab
        const id = String(tab.id || String(tab.label).toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/(^-+|-+$)/g, ''));
        return id ? { ...tab, id } : null;
      })
      .filter((t): t is Partial<TabDef> & { id: string; label: string } =>
        !!t && !isReservedDesktopTabId(t.id) && !seen.has(t.id) && !!seen.add(t.id))
      .map((t) => {
        const url = t.url ? String(t.url) : '';
        return {
          id: String(t.id),
          label: String(t.label),
          kind: (t.kind || (url ? 'web' : (t.source ? 'query' : 'path'))) as TabDef['kind'],
          path: t.path ? String(t.path) : '',
          url: url && isSafeExternalUrl(url) ? url : '',
          source: t.source ? String(t.source) : '',
          where: normalizeWhere(t.where),
          empty: t.empty ? String(t.empty) : '',
        };
      })
      .slice(0, 12);
  }
  if (Array.isArray(cfg.chips)) {
    out.chips = (cfg.chips as Array<Partial<ChipDef>>)
      .filter((c) => !!(c && c.label && c.prompt))
      .map((c) => ({ label: String(c.label), prompt: String(c.prompt) }))
      .slice(0, 12);
  }

  const representedPaths = new Set(BUILTIN_TAB_PATHS);
  for (const tab of out.tabs) {
    if (tab.kind === 'path' && tab.path) representedPaths.add(tab.path.replace(/\\/g, '/').replace(/^\/+|\/+$/g, ''));
  }
  // Bound renderer work for pathological vaults; the preference format itself is capped lower.
  out.availableFolders = vaultLib.listFolders(vault).filter((folder) => !representedPaths.has(folder)).slice(0, 1000);
  const preferences = tabPreferencesFromDocument(document, [...BUILTIN_TAB_IDS, ...out.tabs.map((tab) => tab.id)], out.availableFolders);
  out.hiddenTabs = preferences.hiddenTabs;
  out.folders = preferences.folders;
  return out;
}

function readAppConfig(vault: string): AppConfig {
  return appConfigFromDocument(vault, readDesktopTabsDocument(vault));
}

// ---------- markdown -> safe html ----------
async function ensureMarkdownRenderer(): Promise<(md: string) => string> {
  if (!mdRenderer) {
    const { marked, Renderer } = await import('marked');
    const renderer = new Renderer();
    hardenMarkdownRenderer(renderer);
    marked.setOptions({ breaks: true, gfm: true, renderer });
    mdRenderer = (s: string) => marked.parse(s) as string;
  }
  return mdRenderer;
}

async function renderMarkdown(md: string): Promise<string> {
  const render = await ensureMarkdownRenderer();
  return render(await linkifyWikilinks(md || ''));
}

// Legal documents contain no wikilinks and are shown before any vault is open,
// so they skip the vault-scoped wikilink pass entirely.
async function renderPlainMarkdown(md: string): Promise<string> {
  const render = await ensureMarkdownRenderer();
  return render(md || '');
}

// ---------- window ----------
function openInSystemBrowser(url: string, source: 'explicit' | 'automatic'): void {
  if (externalNavigationPolicy(source, url) === 'open') void shell.openExternal(url);
}

let artifactNavigationPromptActive = false;
function confirmArtifactNavigation(url: string): void {
  if (artifactNavigationPromptActive || externalNavigationPolicy('explicit', url) !== 'open') return;
  artifactNavigationPromptActive = true;
  const ask = async (): Promise<void> => {
    try {
      if (!win || win.isDestroyed()) return;
      const result = await dialog.showMessageBox(win, {
        type: 'question',
        title: 'Open external link?',
        message: 'An artifact wants to open this link in your browser.',
        detail: url.slice(0, 2000),
        buttons: ['Cancel', 'Open in browser'],
        defaultId: 0,
        cancelId: 0,
        noLink: true,
      });
      if (result.response === 1) openInSystemBrowser(url, 'explicit');
    } finally {
      artifactNavigationPromptActive = false;
    }
  };
  void ask().catch(() => {});
}

function createWindow(): void {
  win = new BrowserWindow({
    width: 1440,
    height: 940,
    minWidth: 960,
    minHeight: 640,
    backgroundColor: '#0f1117',
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 16, y: 18 },
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webviewTag: true,   // <webview> is used for embedded "web" dashboard tabs
    },
  });
  const contents = win.webContents;
  installDenyByDefaultPermissions(contents.session);

  // The preload bridge is intentionally powerful. Never let another origin replace
  // the renderer in this WebContents, and never create an inherited child window.
  contents.on('will-navigate', (event) => {
    if (isTrustedFileUrl(event.url, RENDERER_PATH)) return;
    event.preventDefault();
    openInSystemBrowser(event.url, 'automatic');
  });
  contents.on('will-frame-navigate', (event) => {
    if (event.isMainFrame) return; // the main-frame guard above owns this case
    let sourceIsArtifact = false;
    try {
      if (new URL(event.url).protocol === 'artifact:') return;
      sourceIsArtifact = [event.frame?.url, event.initiator?.url]
        .some((source) => !!source && new URL(source).protocol === 'artifact:');
    } catch (_) {}
    event.preventDefault();
    if (sourceIsArtifact) confirmArtifactNavigation(event.url);
  });
  contents.setWindowOpenHandler(({ url }) => {
    openInSystemBrowser(url, 'automatic');
    return { action: 'deny' };
  });

  // Web tabs are isolated guests, but their configuration is agent-editable. Enforce
  // safe preferences in the main process and accept only ordinary web URLs.
  contents.on('will-attach-webview', (event, webPreferences, params) => {
    if (!isSafeExternalUrl(params.src || '')) {
      event.preventDefault();
      return;
    }
    delete webPreferences.preload;
    webPreferences.nodeIntegration = false;
    webPreferences.contextIsolation = true;
    webPreferences.sandbox = true;
    webPreferences.webSecurity = true;
  });
  contents.on('did-attach-webview', (_event, guest) => {
    guest.setWindowOpenHandler(({ url }) => {
      openInSystemBrowser(url, 'automatic');
      return { action: 'deny' };
    });
    guest.on('will-navigate', (event) => {
      if (!isSafeExternalUrl(event.url)) event.preventDefault();
    });
  });

  void win.loadFile(RENDERER_PATH);
  if (process.env.MEMEX_DEV) setupDevHarness();
}

// Dev-only: auto-open a vault and drive the window via a JSON control file so the
// running Electron window can be screenshotted/driven headlessly during iteration.
function setupDevHarness(): void {
  if (!win) return;
  const w = win;
  w.webContents.on('did-finish-load', () => {
    if (process.env.MEMEX_OPEN) {
      w.webContents.executeJavaScript(`window.__dev && window.__dev.open(${JSON.stringify(process.env.MEMEX_OPEN)})`).catch(() => {});
    }
  });
  const ctl = process.env.MEMEX_DEVCTL;
  if (!ctl) return;
  setInterval(async () => {
    if (!fs.existsSync(ctl)) return;
    let cmd: { js?: string; shot?: string };
    try { cmd = JSON.parse(fs.readFileSync(ctl, 'utf8')); } catch (_) { return; }
    try { fs.unlinkSync(ctl); } catch (_) {}
    try {
      if (cmd.js) await w.webContents.executeJavaScript(cmd.js, true);
      if (cmd.shot) { const img = await w.webContents.capturePage(); fs.writeFileSync(cmd.shot, img.toPNG()); }
    } catch (e) { try { fs.writeFileSync(ctl + '.err', String(e)); } catch (_) {} }
    try { fs.writeFileSync(ctl + '.done', String(Date.now())); } catch (_) {}
  }, 150);
}

function emit(channel: string, payload: unknown): void {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
}

// ---------- file watchers ----------
function stopWatchers(): void {
  if (watcherRestartTimer) clearTimeout(watcherRestartTimer);
  watcherRestartTimer = null;
  for (const w of watchers) { try { w.close(); } catch (_) {} }
  watchers = [];
}

function scheduleWatcherRestart(vault: string): void {
  if (shuttingDown || currentVault !== vault || watcherRestartTimer) return;
  watcherRestartTimer = setTimeout(() => {
    watcherRestartTimer = null;
    if (shuttingDown || currentVault !== vault) return;
    if (vaultTransition.active) { scheduleWatcherRestart(vault); return; }
    startWatchers(vault);
  }, 1000);
}

function retainWatcher(watcher: fs.FSWatcher, vault: string): void {
  watcher.on('error', () => {
    try { watcher.close(); } catch (_) {}
    watchers = watchers.filter((candidate) => candidate !== watcher);
    scheduleWatcherRestart(vault);
  });
  watchers.push(watcher);
}

function startWatchers(vault: string): void {
  stopWatchers();
  // Only the active vault needs a cached search index.
  invalidateSearchIndex();
  const applyChange = (relativePath: string, fallbackArea?: string): void => {
    // fs.watch may deliver an already-queued callback after close(). Do not let
    // an old vault invalidate or refresh the newly selected vault's renderer.
    if (shuttingDown || currentVault !== vault || vaultTransition.active) return;
    const effect = classifyVaultChange(relativePath);
    if (effect.invalidateWiki) wikiIndexPromise = null;
    if (effect.invalidateSearch) invalidateSearchIndex(vault);
    const area = effect.area || fallbackArea;
    if (area) emit('fs:changed', { area });
  };

  // A recursive root watcher covers panels, custom folders, search, and wikilinks
  // without emitting duplicate events from overlapping watchers.
  try {
    const w = fs.watch(vault, { recursive: true }, (_eventType, filename) => {
      applyChange(filename ? String(filename) : '');
    });
    retainWatcher(w, vault);
    return;
  } catch (_) { /* fall back to standard panel folders below */ }

  const targets: Array<[string, string]> = [
    ['Inbox', 'inbox'],
    ['outputs', 'outputs'],
    ['Ops/Tasks', 'tasks'],
    ['Atlas', 'atlas'],
    ['Ops/Briefings', 'briefings'],
    ['_config', 'config'],
  ];
  for (const [rel, area] of targets) {
    const dir = path.join(vault, rel);
    if (!fs.existsSync(dir)) continue;
    try {
      let timer: ReturnType<typeof setTimeout> | null = null;
      const w = fs.watch(dir, { recursive: true }, (_eventType, filename) => {
        if (timer) clearTimeout(timer);
        const changed = filename ? path.join(rel, String(filename)) : rel;
        timer = setTimeout(() => applyChange(changed, area), 250);
      });
      retainWatcher(w, vault);
    } catch (_) {}
  }
}

// ---------- inbox drop (drag & drop zone + files dropped on the app icon) ----------
// Shared by ipcMain 'inbox:drop' and handleIconDrop below — behavior must stay identical
// for both entry points: dedup suffix on collision and isolate per-source failures.
async function copyIntoInbox(paths: string[], vault = activeVaultPath()): Promise<DropResult> {
  if (!vault) return { ok: false };
  try {
    const copied = await copyPathsIntoInbox(vault, paths);
    return copied ? { ok: true, copied } : { ok: false, error: 'The vault Inbox is missing or unsafe' };
  } catch (_) {
    return { ok: false, error: 'Could not copy those files into the Inbox' };
  }
}

function queueInboxCopy(paths: string[], vault: string): Promise<DropResult> {
  return inboxCopyQueue.run(() => copyIntoInbox(paths, vault));
}

async function takePendingDrops(vault: string): Promise<DropResult | undefined> {
  if (!pendingDrops.length) return undefined;
  const drops = pendingDrops.splice(0, pendingDrops.length);
  return queueInboxCopy(drops, vault);
}

async function flushPendingDrops(vault: string): Promise<void> {
  const result = await takePendingDrops(vault);
  if (result && currentVault === vault && !vaultTransition.active) {
    emit('inbox:iconDrop', { copied: result.copied || [], error: result.error });
  }
}

// Files dropped on the Dock icon / taskbar-exe / passed on argv. No vault yet -> queue for
// vault:open to flush; otherwise copy now and tell the renderer.
async function handleIconDrop(paths: string[]): Promise<void> {
  if (!paths || !paths.length) return;
  const vault = activeVaultPath();
  if (!vault) { pendingDrops.push(...paths); return; }
  const res = await queueInboxCopy(paths, vault);
  // A slow copy can finish after the user switches vaults. Never report its
  // result in a different vault's renderer session.
  if (currentVault === vault && !vaultTransition.active) {
    emit('inbox:iconDrop', { copied: res.copied || [], error: res.error });
  }
}

// Recovers files dropped on the taskbar/exe (Windows 'second-instance' argv) or passed at
// launch, without mistaking the dev '.' app-path argument (or the app dir itself) for a drop.
function argvFiles(argv: string[]): string[] {
  const appPath = app.getAppPath();
  return (argv || []).slice(1).filter((a) => {
    if (!a || a.startsWith('-') || a === '.' || a === appPath) return false;
    return path.isAbsolute(a) && fs.existsSync(a);
  });
}

// ---------- agent session ----------
let permissionDialogQueue: Promise<void> = Promise.resolve();

function canAutoAllowVaultTool(vault: string, request: AgentPermissionRequest): boolean {
  if (request.name === 'mcp__ui__show_artifact') return true;
  if (['TodoWrite', 'Agent', 'Task', 'Skill'].includes(request.name)) return true;
  const pathTools = new Set(['Read', 'Write', 'Edit', 'MultiEdit', 'NotebookEdit', 'Glob', 'Grep']);
  if (!pathTools.has(request.name)) return false;
  const candidates = ['file_path', 'path', 'notebook_path']
    .map((key) => request.input[key])
    .filter((value): value is string => typeof value === 'string' && value.length > 0);
  // Glob/Grep default to the session cwd when no path is supplied. File tools must
  // identify the path we are approving.
  if (!candidates.length) return request.name === 'Glob' || request.name === 'Grep';
  return candidates.every((candidate) => {
    const full = resolveInside(vault, expandHome(candidate));
    return !!full && resolvedStaysInside(vault, full);
  });
}

function requestAgentPermission(
  vault: string,
  owningSession: AgentSession,
  request: AgentPermissionRequest,
): Promise<boolean> {
  const isCurrent = (): boolean => session === owningSession && currentVault === vault && !vaultTransition.active;
  if (canAutoAllowVaultTool(vault, request)) return Promise.resolve(isCurrent());
  if (!isCurrent()) return Promise.resolve(false);
  if (hasToolGrant(loadConfig(), vault, request.name)) return Promise.resolve(true);
  const ask = async (): Promise<boolean> => {
    if (!win || win.isDestroyed() || !isCurrent()) return false;
    // A request may have waited behind another dialog that granted the same tool.
    if (hasToolGrant(loadConfig(), vault, request.name)) return true;
    const inputSummary = request.input.command
      ? String(request.input.command)
      : JSON.stringify(request.input, null, 2);
    const detail = [
      `Tool: ${request.name}`,
      `Choosing “Always allow in this vault” grants the exact tool “${request.name}” for “${path.basename(vault)}” only. You can reset this grant from the vault switcher.`,
      request.description,
      request.blockedPath ? `Outside the vault: ${request.blockedPath}` : '',
      request.decisionReason,
      inputSummary,
    ].filter(Boolean).join('\n\n').slice(0, 4000);
    const result = await dialog.showMessageBox(win, {
      type: 'warning',
      title: 'Agent permission',
      message: request.title || request.displayName
        ? `${request.title || request.displayName} (${request.name})`
        : `Allow ${request.name}?`,
      detail,
      buttons: ['Deny', 'Allow once', 'Always allow in this vault'],
      defaultId: 0,
      cancelId: 0,
      noLink: true,
    });
    if (!isCurrent()) return false;
    if (result.response === 2) {
      saveConfig(grantTool(loadConfig(), vault, request.name));
      return true;
    }
    return result.response === 1;
  };

  // Tool calls can request permission concurrently; native dialogs should not.
  const result = permissionDialogQueue.then(ask, ask);
  permissionDialogQueue = result.then(() => undefined, () => undefined);
  return result;
}

// AppleScript string literal: escape backslashes and quotes.
function appleScriptString(s: string): string {
  return '"' + s.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
}

// Launch a terminal running `claude` in dirPath. The permission dialog (this
// tool is never auto-allowed) is the user's confirmation step. A relative path
// resolves against the vault, not the main-process cwd (which is unpredictable
// for a packaged app), so a bare repo name lands somewhere meaningful.
async function launchClaudeCode(dirPath: string, vault: string): Promise<{ ok: boolean; message: string }> {
  const expanded = expandHome(String(dirPath || ''));
  const full = path.isAbsolute(expanded) ? path.resolve(expanded) : path.resolve(vault, expanded);
  let stat: fs.Stats;
  try { stat = fs.statSync(full); } catch (_) {
    return { ok: false, message: `Directory not found: ${full}` };
  }
  if (!stat.isDirectory()) return { ok: false, message: `Not a directory: ${full}` };
  try {
    if (process.platform === 'darwin') {
      const script = `tell application "Terminal"\n  do script "cd " & quoted form of ${appleScriptString(full)} & " && claude"\n  activate\nend tell`;
      spawn('osascript', ['-e', script], { detached: true, stdio: 'ignore' }).unref();
    } else if (process.platform === 'win32') {
      spawn('cmd', ['/c', 'start', 'cmd', '/k', 'claude'], { cwd: full, detached: true, stdio: 'ignore' }).unref();
    } else {
      spawn('x-terminal-emulator', ['-e', 'claude'], { cwd: full, detached: true, stdio: 'ignore' }).unref();
    }
  } catch (err) {
    return { ok: false, message: `Could not open a terminal: ${String((err as Error)?.message || err)}` };
  }
  // We spawned the terminal, but can't confirm `claude` resolves on its PATH —
  // don't assert a running session, describe the action honestly instead.
  return { ok: true, message: `Opening a terminal in ${full} to run Claude Code. Tell the user a terminal window is opening; if the \`claude\` command isn't found there, the Claude Code CLI needs to be installed.` };
}

// ---------- auto-update ----------
// Updates come from the `latest-*.yml` feed the release workflow publishes
// alongside the installers on GitHub Releases. The startup check downloads in
// the background and applies on the next quit; `update:check` runs the same
// flow on demand for the button in the vault switcher, which can then offer
// "Restart to update" via `update:install`.
let updateDownloadedVersion: string | null = null;
let updateCheckInFlight: Promise<UpdateStatus> | null = null;

function initAutoUpdater(): void {
  // Dev builds have no feed to read: electron-updater throws looking for
  // dev-app-update.yml. Only packaged apps can update.
  if (!app.isPackaged) return;
  // A failed update check must stay invisible — it is not something the user
  // asked for or can act on. An unhandled 'error' event would otherwise be
  // thrown. Linux .deb installs land here too: electron-updater only supports
  // AppImage on Linux. (A *manual* check is different: the user asked, so
  // checkForUpdatesNow reports its own errors through the invoke result.)
  // The push below is not a visibility change: the renderer ignores it unless
  // the button is already showing download progress — its one job is to
  // un-stick a button that a failed background download would otherwise leave
  // disabled at "Downloading…" forever.
  autoUpdater.on('error', (err: Error) => {
    console.error('auto-update check failed:', err?.message || err);
    emit('update:status', { state: 'error', message: String(err?.message || err) });
  });
  // Track what any check — startup or manual — has fetched, so the manual
  // path can answer "ready" instantly instead of re-downloading, and the
  // button lights up even when the silent startup check did the work.
  autoUpdater.on('update-downloaded', (info) => {
    updateDownloadedVersion = info?.version || '';
    emit('update:status', { state: 'ready', version: updateDownloadedVersion });
  });
  autoUpdater.on('download-progress', (p) => {
    emit('update:status', { state: 'downloading', percent: Math.round(p?.percent || 0) });
  });
  autoUpdater.checkForUpdatesAndNotify().catch(() => {});
}

// The user-initiated check. Resolves only once the answer is final: a found
// update is downloaded before this returns, so a `ready` result always means
// quitAndInstall can act on it. Interim progress goes out as update:status
// pushes from the listeners above.
async function checkForUpdatesNow(): Promise<UpdateStatus> {
  if (!app.isPackaged) {
    return { state: 'unsupported', message: 'Dev build — updates only apply to the packaged app.' };
  }
  if (updateDownloadedVersion !== null) return { state: 'ready', version: updateDownloadedVersion };
  if (updateCheckInFlight) return updateCheckInFlight;
  updateCheckInFlight = (async (): Promise<UpdateStatus> => {
    try {
      const result = await autoUpdater.checkForUpdates();
      if (!result || !result.isUpdateAvailable) return { state: 'uptodate', version: app.getVersion() };
      const version = result.updateInfo?.version || '';
      emit('update:status', { state: 'downloading', version });
      if (result.downloadPromise) await result.downloadPromise;
      updateDownloadedVersion = version;
      return { state: 'ready', version };
    } catch (err) {
      // Reaches here for offline checks and for installs with no update
      // channel (e.g. Linux .deb — electron-updater only supports AppImage).
      return { state: 'error', message: String((err as Error)?.message || err) };
    } finally {
      updateCheckInFlight = null;
    }
  })();
  return updateCheckInFlight;
}

// ---------- vault engine updates ----------
// Distinct from the app auto-update above. The app bundles an engine tree
// (ENGINE_ROOT), and each vault records the engine version it was baked from
// in .memex/manifest.json — so an app update routinely leaves an open vault
// trailing the engine it ships. This check surfaces that gap. The upgrade
// itself is NOT a blind script run: it's the vault's own /update skill driven
// through the agent, which performs the deterministic memex-update prepare
// step and then resolves the judgement calls (3-way merges, collisions,
// renames) with the user in chat.
function checkVaultUpdate(): VaultUpdateStatus {
  const vault = activeVaultPath();
  if (!vault) return { state: 'no-vault' };
  let engineVersion = '';
  try { engineVersion = fs.readFileSync(path.join(ENGINE_ROOT, 'VERSION'), 'utf8').trim(); } catch (_) {}
  if (!engineVersion) return { state: 'error', message: 'The bundled engine has no readable VERSION file.' };
  let vaultVersion = '';
  try {
    const manifest = JSON.parse(fs.readFileSync(path.join(vault, '.memex', 'manifest.json'), 'utf8')) as { engine_version?: unknown };
    if (typeof manifest.engine_version === 'string') vaultVersion = manifest.engine_version.trim();
  } catch (_) {
    // Missing/unreadable manifest: the vault predates update tracking; the
    // normal update path would refuse it, so don't offer a button that fails.
    return { state: 'untracked', engineVersion };
  }
  if (!vaultVersion) return { state: 'untracked', engineVersion };
  return {
    state: compareDottedVersions(engineVersion, vaultVersion) > 0 ? 'available' : 'current',
    vaultVersion,
    engineVersion,
    enginePath: ENGINE_ROOT,
  };
}

// Plain dotted-integer compare (engine VERSION is n.n.n). Anything unparseable
// falls back to string equality — an exotic version only ever reads "current",
// never a spurious upgrade offer.
function compareDottedVersions(a: string, b: string): number {
  const pa = a.split('.').map((n) => parseInt(n, 10));
  const pb = b.split('.').map((n) => parseInt(n, 10));
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] ?? 0;
    const y = pb[i] ?? 0;
    if (Number.isNaN(x) || Number.isNaN(y)) return 0;
    if (x !== y) return x - y;
  }
  return 0;
}

// Returns undefined in dev, where the SDK resolves its own binary correctly.
// See claude-binary.ts for why packaged builds need this.
function bundledClaudeExecutable(): string | undefined {
  if (!app.isPackaged) return undefined;
  const unpacked = unpackedClaudeBinaryPath(process.resourcesPath, process.platform, process.arch);
  if (fs.existsSync(unpacked)) return unpacked;
  // Fall through to the SDK's own resolution rather than forcing a bad path:
  // its error message names the platform it looked for, which is more useful.
  console.error('bundled claude binary not found at', unpacked);
  return undefined;
}

async function startSession(vault: string): Promise<void> {
  if (session) { try { await session.stop(); } catch (_) {} session = null; }
  sessionModelsCache = null;
  let nextSession: AgentSession;
  const isCurrent = () => session === nextSession && currentVault === vault;
  const handleEvent = async (evt: AgentEvent): Promise<void> => {
    if (!isCurrent()) return;
    if (evt.kind === 'assistant_text') {
      const html = await renderMarkdown(evt.text);
      if (isCurrent()) emit('agent:event', { ...evt, html });
    } else if (evt.kind === 'artifact') {
      // Resolve inline vs path; render markdown to html here.
      const art = await resolveArtifact(vault, evt);
      if (isCurrent()) emit('agent:event', { kind: 'artifact', artifact: art });
    } else {
      emit('agent:event', evt);
    }
  };
  // Some handlers await (markdown render), others don't — a promise chain keeps
  // events reaching the renderer in emission order, else a tool_use/result can
  // overtake its preceding assistant_text and duplicate the chat bubble.
  let chain: Promise<void> = Promise.resolve();
  nextSession = new AgentSession({
    cwd: vault,
    onEvent: (evt: AgentEvent) => { chain = chain.then(() => handleEvent(evt)).catch(() => {}); },
    requestPermission: (request) => requestAgentPermission(vault, nextSession, request),
    openInClaudeCode: (dirPath: string) => launchClaudeCode(dirPath, vault),
    claudeExecutable: bundledClaudeExecutable(),
    // Like tool grants, the choice lives in the app's own config keyed by vault
    // path — not in the agent-writable vault — and defaults to inheriting
    // whatever the user's Claude Code configuration says.
    model: vaultModel(loadConfig(), vault) ?? undefined,
  });
  session = nextSession;
  try {
    await nextSession.start();
  } catch (error) {
    if (session === nextSession) session = null;
    try { await nextSession.stop(); } catch (_) {}
    throw error;
  }
}

async function resolveArtifact(vault: string, evt: Extract<AgentEvent, { kind: 'artifact' }>): Promise<ArtifactView> {
  const { title, format, content, path: rel } = evt;
  let kind = format;
  if (rel && !content) {
    const f = vaultLib.readFile(vault, rel);
    if (f) {
      if (f.kind === 'html') return { title: title || rel, kind: 'html', url: registerArtifact(f.content || '', vault), rel };
      if (f.kind === 'image') return { title: title || rel, kind: 'image', dataUri: f.dataUri, rel };
      if (f.kind === 'markdown') return { title: title || rel, kind: 'markdown', html: await renderMarkdown(f.content || ''), rel };
      return { title: title || rel, kind: 'text', text: f.content, rel };
    }
  }
  if (kind === 'auto' || kind == null) {
    if (rel && /\.html?$/.test(rel)) kind = 'html';
    else if (content && /^\s*<!doctype|^\s*<html|^\s*<div|^\s*<section|^\s*<table/i.test(content)) kind = 'html';
    else kind = 'markdown';
  }
  if (kind === 'html') return { title, kind: 'html', url: registerArtifact(content || '', vault), rel };
  return { title, kind: 'markdown', html: await renderMarkdown(content || ''), rel };
}

// ---------- vault creation (wraps python memex-init) ----------
function createVault({ target, answers, packs }: { target: string; answers: Record<string, string>; packs: string }): Promise<CreateVaultResult> {
  return new Promise((resolve) => {
    const initScript = path.join(ENGINE_ROOT, 'tools', 'memex_init.py');
    if (!fs.existsSync(initScript)) {
      resolve({ ok: false, code: -1, output: 'The bundled Memex initializer is missing. Reinstall the app, or open an existing vault.' });
      return;
    }
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'memex-init-'));
    const tmp = path.join(tmpDir, 'answers.json');
    fs.writeFileSync(tmp, JSON.stringify(answers, null, 2), { mode: 0o600 });
    const args = [
      initScript,
      '--eng', ENGINE_ROOT,
      '--target', target,
      '--packs', packs || 'core',
      '--answers', tmp,
    ];
    let out = '';
    let settled = false;
    const finish = (result: CreateVaultResult) => {
      if (settled) return;
      settled = true;
      try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {}
      resolve(result);
    };
    const candidates = process.platform === 'win32'
      ? [{ command: 'py', prefix: ['-3'] }, { command: 'python', prefix: [] }, { command: 'python3', prefix: [] }]
      : [{ command: 'python3', prefix: [] }, { command: 'python', prefix: [] }];
    const launch = (index: number): void => {
      const candidate = candidates[index];
      if (!candidate) {
        finish({ ok: false, code: -1, output: out || 'Python 3 was not found on PATH.' });
        return;
      }
      const procArgs = [...candidate.prefix, ...args];
      emit('setup:progress', { line: `${candidate.command} ${procArgs.join(' ')}\n` });
      const proc = spawn(candidate.command, procArgs, { cwd: ENGINE_ROOT });
      let missingExecutable = false;
      proc.stdout.on('data', (d) => { out += d; emit('setup:progress', { line: d.toString() }); });
      proc.stderr.on('data', (d) => { out += d; emit('setup:progress', { line: d.toString() }); });
      proc.on('error', (err: NodeJS.ErrnoException) => {
        if (err.code === 'ENOENT') {
          missingExecutable = true;
          launch(index + 1);
        } else {
          finish({ ok: false, code: -1, output: out + String(err) });
        }
      });
      proc.on('close', (code) => {
        if (!missingExecutable) finish({ ok: code === 0, code: code ?? -1, output: out });
      });
    };
    launch(0);
  });
}

// ---------- IPC ----------
function isTrustedIpcSender(event: IpcMainInvokeEvent): boolean {
  if (!win || win.isDestroyed() || event.sender !== win.webContents) return false;
  const senderUrl = event.senderFrame?.url || event.sender.getURL();
  return isTrustedFileUrl(senderUrl, RENDERER_PATH);
}

type IpcHandler = (event: IpcMainInvokeEvent, ...args: any[]) => any;

function registerIpc(): void {
  const handle = (channel: string, listener: IpcHandler): void => {
    ipcMain.handle(channel, (event, ...args) => {
      if (!isTrustedIpcSender(event)) throw new Error('IPC request rejected: untrusted renderer');
      return listener(event, ...args);
    });
  };

  handle('vault:pick', async () => {
    if (!win) return null;
    const r = await dialog.showOpenDialog(win, { properties: ['openDirectory', 'createDirectory'] });
    return r.canceled ? null : r.filePaths[0];
  });

  handle('legal:state', async (): Promise<LegalState> => {
    const docs = legal();
    if (!docs) {
      // Fail closed and say so, rather than silently letting the user through.
      return {
        needsAcceptance: true, version: '', effective: '', summary: '',
        terms: '<p>The Terms of Use could not be loaded, so Memex cannot continue. Please reinstall the app.</p>',
        privacy: '<p>The Privacy Notice could not be loaded, so Memex cannot continue. Please reinstall the app.</p>',
      };
    }
    const cfg = loadConfig();
    return {
      needsAcceptance: needsAcceptance(cfg.terms, docs.manifest),
      version: docs.manifest.version,
      effective: docs.manifest.effective,
      // "What changed" is meaningless on a first run — only show it to someone
      // who accepted an earlier version.
      summary: cfg.terms ? docs.manifest.summary : '',
      terms: await renderPlainMarkdown(docs.terms),
      privacy: await renderPlainMarkdown(docs.privacy),
    };
  });

  handle('legal:accept', async () => {
    const docs = legal();
    if (!docs) return { ok: false };
    const cfg = loadConfig();
    cfg.terms = acceptanceRecord(docs.manifest, app.getVersion(), new Date());
    saveConfig(cfg);
    // saveConfig swallows write errors, so re-read from disk and ask the same
    // question the vault guards ask. Claiming success on an unwritable config
    // would close the gate while vault:open and vault:create keep refusing,
    // and review mode hides the consent controls — the user would be stuck
    // until they restarted.
    return { ok: termsAccepted() };
  });

  handle('app:quit', async () => { app.quit(); });

  handle('vault:detect', async (_e, p: string) => {
    const full = expandHome(p);
    return { path: full, isVault: vaultLib.isVault(full) };
  });

  handle('files:pick', async () => {
    if (!win) return [];
    const r = await dialog.showOpenDialog(win, { properties: ['openFile', 'multiSelections'] });
    return r.canceled ? [] : r.filePaths;
  });

  handle('vault:recent', async () => {
    const cfg = loadConfig();
    const recent = (cfg.recent || []).filter((p) => vaultLib.isVault(p));
    return { recent, last: cfg.last && vaultLib.isVault(cfg.last) ? cfg.last : null };
  });

  handle('vault:current', async () => {
    const vault = activeVaultPath();
    return vault ? vaultLib.summary(vault) : null;
  });

  handle('vault:search', async (_e, q: string): Promise<SearchResults> => {
    const vault = activeVaultPath();
    if (!vault) return { query: '', files: [], content: [] };
    return searchVault(vault, String(q ?? ''));
  });

  // Surfaced in the vault switcher so the running version is visible without
  // digging through Info.plist — which is also how you confirm an auto-update
  // actually applied.
  handle('app:version', async () => app.getVersion());

  handle('update:check', async () => checkForUpdatesNow());

  handle('vault:updateCheck', async () => checkVaultUpdate());

  handle('update:install', async () => {
    if (updateDownloadedVersion === null) return { ok: false };
    // Quit after the invoke resolves, so the renderer isn't left awaiting a
    // reply from a window that's already gone.
    setImmediate(() => autoUpdater.quitAndInstall());
    return { ok: true };
  });

  handle('permissions:reset', async () => {
    const vault = activeVaultPath();
    if (!vault) return { ok: false };
    saveConfig(clearVaultToolGrants(loadConfig(), vault));
    return { ok: true };
  });

  handle('vault:create', async (_e, opts: { target: string; answers: Record<string, string>; packs: string }) => {
    if (!termsAccepted()) return { ok: false, code: -1, output: 'Please accept the Terms of Use to continue.' };
    const res = await createVault({ ...opts, target: expandHome(opts.target) });
    return res;
  });

  handle('vault:open', async (_e, p: string) => {
    if (!termsAccepted()) return { ok: false, error: 'Please accept the Terms of Use to continue' };
    const full = expandHome(p);
    if (!vaultLib.isVault(full)) return { ok: false, error: 'Not a Memex vault' };
    let summary: VaultSummary;
    try { summary = vaultLib.summary(full); }
    catch (_) { return { ok: false, error: 'Could not read this Memex vault' }; }
    if (!vaultTransition.begin()) return { ok: false, error: 'Another vault is already opening' };
    try {
      currentVault = full;
      wikiIndexPromise = null;
      rememberVault(full);
      startWatchers(full);
      let warning: string | undefined;
      let pendingDrop: DropResult | undefined;
      try { await startSession(full); }
      catch (e) { warning = 'Agent session failed to start: ' + String((e as Error)?.message || e); }
      pendingDrop = await takePendingDrops(full);
      return { ok: true, summary, warning, pendingDrop };
    } finally {
      vaultTransition.finish();
      // An OS drop can arrive after the in-transition drain above. Once access
      // reopens, flush that tail rather than leaving it for the next vault open.
      if (currentVault === full && pendingDrops.length) void flushPendingDrops(full);
    }
  });

  handle('data:get', async (_e, kind: DataKind) => {
    const vault = activeVaultPath();
    if (!vault) return null;
    switch (kind) {
      case 'summary': return vaultLib.summary(vault);
      case 'tasks': return vaultLib.readTasks(vault);
      case 'projects': return vaultLib.readProjects(vault);
      case 'ideas': return vaultLib.readIdeas(vault);
      case 'people': return vaultLib.readPeople(vault);
      case 'sources': return vaultLib.readSources(vault);
      case 'inbox': return vaultLib.readInbox(vault);
      case 'outputs': return vaultLib.readOutputs(vault);
      case 'briefing': return vaultLib.latestBriefing(vault);
      default: return null;
    }
  });

  handle('data:appConfig', async (): Promise<AppConfig> => {
    const vault = activeVaultPath();
    return vault ? readAppConfig(vault) : { tabs: [], chips: [], hiddenTabs: [], folders: [], availableFolders: [] };
  });

  handle('tabs:updatePreferences', async (_e, input: TabPreferenceUpdate): Promise<AppConfig> => {
    const vault = activeVaultPath();
    if (!vault) throw new Error('No vault is open');
    const currentDocument = readDesktopTabsDocument(vault, true);
    const current = appConfigFromDocument(vault, currentDocument);
    const nextDocument = withTabPreferences(
      currentDocument,
      input,
      [...BUILTIN_TAB_IDS, ...current.tabs.map((tab) => tab.id)],
      current.availableFolders,
    );
    const createdConfigDirectory = writeDesktopTabsDocument(vault, nextDocument);
    // On platforms without recursive root watching, a missing _config directory
    // was skipped when the vault opened. Attach the fallback watcher now that the
    // picker created it so later agent/manual edits still rebuild the tab bar live.
    if (createdConfigDirectory) startWatchers(vault);
    return appConfigFromDocument(vault, nextDocument);
  });

  handle('tab:query', async (_e, def: TabDef | null): Promise<TabQueryResult> => {
    const vault = activeVaultPath();
    if (!vault || !def) return { source: 'tasks', rows: [] };
    const source = def.source || 'tasks';
    const loaders: Record<string, (v: string) => DataRow[]> = {
      tasks: vaultLib.readTasks, projects: vaultLib.readProjects, ideas: vaultLib.readIdeas,
      people: vaultLib.readPeople, sources: vaultLib.readSources,
    };
    const load = loaders[source] || vaultLib.readTasks;
    return { source, rows: filterRows(load(vault), def.where || {}, source) };
  });

  handle('tab:content', async (_e, rel: string): Promise<TabContentResult> => {
    const vault = activeVaultPath();
    if (!vault) return { type: 'missing' };
    const type = vaultLib.pathType(vault, rel);
    if (type === 'directory') return { type: 'dir', items: vaultLib.listFolder(vault, rel) };
    if (type !== 'file') return { type: 'missing' };
    const f = vaultLib.readFile(vault, rel);
    if (!f) return { type: 'missing' };
    if (f.kind === 'markdown') return { type: 'file', file: { ...f, html: await renderMarkdown(f.content || '') } };
    if (f.kind === 'html') return { type: 'file', file: { kind: 'html', url: registerArtifact(f.content || '', vault), rel } };
    return { type: 'file', file: f };
  });

  handle('note:read', async (_e, rel: string): Promise<VaultFile | null> => {
    const vault = activeVaultPath();
    if (!vault) return null;
    const f = vaultLib.readFile(vault, rel);
    if (!f) return null;
    if (f.kind === 'markdown') return { ...f, html: await renderMarkdown(f.content || '') };
    if (f.kind === 'html') return { kind: 'html', url: registerArtifact(f.content || '', vault), rel };
    return f;
  });

  handle('artifact:register', async (_e, html: string) => {
    const vault = activeVaultPath();
    return vault ? registerArtifact(html || '', vault) : '';
  });

  handle('agent:send', async (_e, text: string) => {
    if (!activeVaultPath()) return { ok: false, error: 'Vault is switching' };
    if (!session || !session.running) return { ok: false, error: 'No active session' };
    return { ok: session.send(text) };
  });

  handle('agent:interrupt', async () => {
    if (!activeVaultPath()) return { ok: false };
    if (session) await session.interrupt();
    return { ok: true };
  });

  handle('agent:models', async (): Promise<ModelState> => {
    const vault = activeVaultPath();
    if (!vault) return { models: [], selected: null, inherited: null };
    // Selected and inherited are reported even when the session is down (e.g. a
    // persisted model the CLI refused killed it) — the picker must stay visible
    // so the user can change the preference and recover.
    const selected = vaultModel(loadConfig(), vault);
    const inherited = session ? session.inheritedModel : null;
    if (!session || !session.running) return { models: [], selected, inherited };
    if (!sessionModelsCache || !sessionModelsCache.length) {
      try { sessionModelsCache = await session.supportedModels(); } catch (_) {}
    }
    return { models: sessionModelsCache || [], selected, inherited };
  });

  handle('agent:setModel', (_e, model: string | null, expectedVault: string): Promise<SendResult> => modelSwitchQueue.run(async (): Promise<SendResult> => {
    const vault = activeVaultPath();
    if (!vault) return { ok: false, error: 'Vault is switching' };
    // The renderer names the vault it was showing; a change event that raced a
    // vault switch must not write another vault's preference.
    if (expectedVault && expectedVault !== vault) return { ok: false, error: 'Vault changed before the model switch applied' };
    const normalized = typeof model === 'string' && model.trim() ? model.trim() : null;
    if (!session || !session.running) {
      // No live session to switch — most likely a persisted model the CLI
      // refused at startup. Persist the new choice and restart on it, so the
      // picker is the recovery path rather than hand-editing config.json.
      saveConfig(setVaultModel(loadConfig(), vault, normalized));
      try { await startSession(vault); }
      catch (e) { return { ok: false, error: 'Saved, but the session could not restart: ' + String((e as Error)?.message || e) }; }
      return { ok: true };
    }
    try { await session.setModel(normalized ?? undefined); }
    catch (e) { return { ok: false, error: String((e as Error)?.message || e) }; }
    // Persist only after the live switch succeeded, so the stored preference
    // never names a model the CLI refused.
    saveConfig(setVaultModel(loadConfig(), vault, normalized));
    // The CLI's list includes the session's configured custom model (when one is
    // set), so a switch can change it — refetch on the next refresh.
    sessionModelsCache = null;
    return { ok: true };
  }));

  handle('inbox:addNote', async (_e, text: string) => {
    const vault = activeVaultPath();
    if (!vault) return { ok: false };
    const rel = writeInboxNote(vault, String(text ?? ''));
    return rel
      ? { ok: true, rel }
      : { ok: false, error: 'Could not write to this vault\'s Inbox' };
  });

  handle('inbox:drop', async (_e, paths: string[]) => {
    const vault = activeVaultPath();
    return vault ? queueInboxCopy(paths, vault) : { ok: false };
  });

  handle('shell:open', async (_e, target: string) => {
    if (externalNavigationPolicy('explicit', target) === 'open') return shell.openExternal(target);
    const vault = activeVaultPath();
    if (vault) {
      const full = resolveInside(vault, expandHome(target));
      if (full && resolvedStaysInside(vault, full)) return shell.openPath(full);
    }
    return null;
  });

  handle('shell:reveal', async (_e, rel: string) => {
    const vault = activeVaultPath();
    if (!vault) return null;
    const full = resolveInside(vault, expandHome(rel));
    if (full && resolvedStaysInside(vault, full)) shell.showItemInFolder(full);
    return null;
  });
}

// macOS: dropping a file on the Dock icon fires 'open-file', even when it launches the app —
// must be registered before whenReady to catch launch-time drops.
app.on('open-file', (e, p) => { e.preventDefault(); handleIconDrop([p]); });

// Windows/Linux: a file dropped on the taskbar icon/exe launches a *second* process; forward
// its argv to the running instance instead of opening a second window.
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', (_e, argv) => {
    if (win) { if (win.isMinimized()) win.restore(); win.focus(); }
    handleIconDrop(argvFiles(argv));
  });

  app.whenReady().then(() => {
    // Packaged builds get the icon from the bundle; in dev the window runs inside the
    // stock Electron binary, so brand the macOS Dock at runtime.
    if (!app.isPackaged && process.platform === 'darwin') {
      try { app.dock?.setIcon(path.join(__dirname, '..', '..', 'build', 'icon.png')); } catch (_) {}
    }
    protocol.handle('artifact', (req) => {
      const url = new URL(req.url);
      const id = url.hostname;
      if (url.pathname !== '/index.html') return new Response('Not found', { status: 404 });
      const html = artifactStore.get(id);
      const headers = {
        'content-type': 'text/html; charset=utf-8',
        'content-security-policy': ARTIFACT_CSP,
        'referrer-policy': 'no-referrer',
        'x-content-type-options': 'nosniff',
      };
      if (html == null) {
        // Evicted from the cache (panel history can outlive the 200-entry store) —
        // show a themed explanation instead of a bare "Not found".
        const gone = '<!doctype html><meta charset="utf-8"><body style="margin:0;display:grid;place-items:center;min-height:100vh;font-family:ui-sans-serif,system-ui,sans-serif;background:#1b1810;color:#bcb096"><div style="text-align:center;max-width:420px;padding:24px"><div style="font-size:36px;color:#e0a54a">✦</div><h2 style="color:#efe7d4;font-weight:600;margin:12px 0 8px">This artifact has expired</h2><p style="line-height:1.6;font-size:14px">Older artifacts are dropped from the cache as new ones arrive. Ask the agent to show it again, or open the source file from the Outbox.</p></div></body>';
        return new Response(gone, { status: 404, headers });
      }
      return new Response(html, { headers });
    });
    registerIpc();
    createWindow();
    initAutoUpdater();
    handleIconDrop(argvFiles(process.argv));
    app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
  });

  app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });

  let quitCleanup: 'idle' | 'stopping' | 'complete' = 'idle';
  app.on('before-quit', (event) => {
    shuttingDown = true;
    stopWatchers();
    if (quitCleanup === 'complete') return;
    if (quitCleanup === 'stopping') { event.preventDefault(); return; }
    if (!session) { quitCleanup = 'complete'; return; }

    event.preventDefault();
    quitCleanup = 'stopping';
    const closingSession = session;
    session = null;
    const timeout = new Promise<void>((resolve) => setTimeout(resolve, 3000));
    void Promise.race([closingSession.stop(), timeout])
      .catch(() => {})
      .finally(() => {
        quitCleanup = 'complete';
        app.quit();
      });
  });
}
