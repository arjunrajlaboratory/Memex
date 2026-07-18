import { app, BrowserWindow, ipcMain, dialog, shell, protocol } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { spawn } from 'child_process';

import * as vaultLib from './vault';
import { AgentSession } from './agent';

const fsp = fs.promises;
const ENGINE_ROOT = path.resolve(__dirname, '..', '..', '..'); // .../Memex
const CONFIG_PATH = () => path.join(app.getPath('userData'), 'config.json');

interface PersistedConfig { recent?: string[]; last?: string; }

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
let session: AgentSession | null = null;
let watchers: fs.FSWatcher[] = [];
let mdRenderer: ((md: string) => string) | null = null;
// Files dropped on the Dock icon (mac) or taskbar/exe (Windows) before any vault is open;
// flushed into the Inbox once vault:open succeeds.
let pendingDrops: string[] = [];

// Artifacts are served from their own secure origin so their inline scripts run
// (a file:// page's CSP is inherited by srcdoc/blob children; a distinct scheme is not).
protocol.registerSchemesAsPrivileged([
  { scheme: 'artifact', privileges: { standard: true, secure: true, supportFetchAPI: true } },
]);
const artifactStore = new Map<string, string>();      // id -> html
const artifactByContent = new Map<string, string>();  // html -> id (dedup, so re-viewing costs nothing)
let artifactSeq = 0;
function registerArtifact(html: string): string {
  html = html || '';
  const existing = artifactByContent.get(html);
  if (existing && artifactStore.has(existing)) {
    // LRU refresh: re-registering moves the artifact to the back of the eviction queue
    artifactStore.delete(existing);
    artifactStore.set(existing, html);
    return `artifact://memex/${existing}`;
  }
  const id = String(++artifactSeq);
  artifactStore.set(id, html);
  artifactByContent.set(html, id);
  if (artifactStore.size > 200) {
    const oldest = artifactStore.keys().next().value as string;
    const oldHtml = artifactStore.get(oldest);
    artifactStore.delete(oldest);
    if (oldHtml != null && artifactByContent.get(oldHtml) === oldest) artifactByContent.delete(oldHtml);
  }
  return `artifact://memex/${id}`;
}

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
async function buildWikiIndex(vault: string): Promise<Map<string, string>> {
  const idx = new Map<string, string>();
  const roots = ['Atlas', 'Ops', 'Raw', 'Drafts'];
  const walkIdx = async (dir: string, depth: number): Promise<void> => {
    if (depth > 5) return;
    let ents: fs.Dirent[]; try { ents = await fsp.readdir(dir, { withFileTypes: true }); } catch (_) { return; }
    for (const e of ents) {
      if (e.name.startsWith('.') || e.name === 'README.md') continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) { await walkIdx(full, depth + 1); continue; }
      if (!e.name.endsWith('.md')) continue;
      const key = e.name.replace(/\.md$/, '').toLowerCase();
      if (!idx.has(key)) idx.set(key, path.relative(vault, full));
    }
  };
  await Promise.all(roots.map((r) => walkIdx(path.join(vault, r), 0)));
  return idx;
}
function getWikiIndex(): Promise<Map<string, string>> {
  if (!currentVault) return Promise.resolve(new Map());
  if (!wikiIndexPromise) wikiIndexPromise = buildWikiIndex(currentVault);
  return wikiIndexPromise;
}
const escText = (s: unknown) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' } as Record<string, string>)[c]);
const escAttr = (s: unknown) => String(s).replace(/"/g, '&quot;').replace(/</g, '&lt;');

// Turn [[Target]], [[Target|Alias]], [[Target#heading]] into clickable internal
// links when the target resolves to a note, else a plain (unbracketed) label.
async function linkifyWikilinks(md: string): Promise<string> {
  const idx = await getWikiIndex();
  return String(md || '').replace(/\[\[([^\]|#\n]+)(?:#[^\]|\n]+)?(?:\|([^\]\n]+))?\]\]/g, (m, target: string, alias?: string) => {
    const label = (alias || target).trim();
    const rel = idx.get(target.trim().toLowerCase());
    if (rel) return `<a class="wikilink" data-rel="${escAttr(rel)}">${escText(label)}</a>`;
    return `<span class="wikilink dead">${escText(label)}</span>`;
  });
}

// ---------- query filter for custom "query" tabs ----------
type FilterableRow = Partial<TaskRow> & { status?: string; due?: string; tags?: string[] };
function filterRows<T extends FilterableRow>(rows: T[], where: QueryWhere | null | undefined, source: string): T[] {
  const w: QueryWhere = where || {};
  const today = new Date().toISOString().slice(0, 10);
  const plusDays = (n: number) => { const d = new Date(); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };
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

// ---------- markdown -> safe-ish html ----------
async function renderMarkdown(md: string): Promise<string> {
  if (!mdRenderer) {
    const { marked } = await import('marked');
    marked.setOptions({ breaks: true, gfm: true });
    mdRenderer = (s: string) => marked.parse(s) as string;
  }
  const html = mdRenderer(await linkifyWikilinks(md || ''));
  // local/trusted content, but strip obvious script/event-handler injection.
  return String(html)
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/ on\w+="[^"]*"/gi, '')
    .replace(/ on\w+='[^']*'/gi, '');
}

// ---------- window ----------
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
      sandbox: false,
      webviewTag: true,   // <webview> is used for embedded "web" dashboard tabs
    },
  });
  win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
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
function stopWatchers(): void { for (const w of watchers) { try { w.close(); } catch (_) {} } watchers = []; }

function startWatchers(vault: string): void {
  stopWatchers();
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
      const w = fs.watch(dir, { recursive: true }, () => {
        if (timer) clearTimeout(timer);
        wikiIndexPromise = null;   // note added/renamed/removed -> rebuild link index
        timer = setTimeout(() => emit('fs:changed', { area }), 250);
      });
      watchers.push(w);
    } catch (_) {}
  }
}

// ---------- inbox drop (drag & drop zone + files dropped on the app icon) ----------
// Shared by ipcMain 'inbox:drop' and handleIconDrop below — behavior must stay identical
// for both entry points: dedup suffix on name collision, cpSync for dirs, silent per-file catch.
function copyIntoInbox(paths: string[]): DropResult {
  if (!currentVault) return { ok: false };
  const inbox = path.join(currentVault, 'Inbox');
  const copied: string[] = [];
  for (const src of paths || []) {
    try {
      const base = path.basename(src);
      let dest = path.join(inbox, base);
      let i = 1;
      while (fs.existsSync(dest)) {
        const ext = path.extname(base); const stem = base.slice(0, base.length - ext.length);
        dest = path.join(inbox, `${stem}-${i}${ext}`); i++;
      }
      const stat = fs.statSync(src);
      if (stat.isDirectory()) fs.cpSync(src, dest, { recursive: true });
      else fs.copyFileSync(src, dest);
      copied.push(path.basename(dest));
    } catch (_) {}
  }
  return { ok: true, copied };
}

// Files dropped on the Dock icon / taskbar-exe / passed on argv. No vault yet -> queue for
// vault:open to flush; otherwise copy now and tell the renderer.
function handleIconDrop(paths: string[]): void {
  if (!paths || !paths.length) return;
  if (!currentVault) { pendingDrops.push(...paths); return; }
  const res = copyIntoInbox(paths);
  emit('inbox:iconDrop', { copied: res.copied || [] });
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
async function startSession(vault: string): Promise<void> {
  if (session) { try { await session.stop(); } catch (_) {} session = null; }
  const handleEvent = async (evt: AgentEvent): Promise<void> => {
    if (evt.kind === 'assistant_text') {
      emit('agent:event', { ...evt, html: await renderMarkdown(evt.text) });
    } else if (evt.kind === 'artifact') {
      // Resolve inline vs path; render markdown to html here.
      const art = await resolveArtifact(vault, evt);
      emit('agent:event', { kind: 'artifact', artifact: art });
    } else {
      emit('agent:event', evt);
    }
  };
  // Some handlers await (markdown render), others don't — a promise chain keeps
  // events reaching the renderer in emission order, else a tool_use/result can
  // overtake its preceding assistant_text and duplicate the chat bubble.
  let chain: Promise<void> = Promise.resolve();
  session = new AgentSession({
    cwd: vault,
    onEvent: (evt: AgentEvent) => { chain = chain.then(() => handleEvent(evt)).catch(() => {}); },
  });
  await session.start();
}

async function resolveArtifact(vault: string, evt: Extract<AgentEvent, { kind: 'artifact' }>): Promise<ArtifactView> {
  const { title, format, content, path: rel } = evt;
  let kind = format;
  if (rel && !content) {
    const f = vaultLib.readFile(vault, rel);
    if (f) {
      if (f.kind === 'html') return { title: title || rel, kind: 'html', url: registerArtifact(f.content || ''), rel };
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
  if (kind === 'html') return { title, kind: 'html', url: registerArtifact(content || ''), rel };
  return { title, kind: 'markdown', html: await renderMarkdown(content || ''), rel };
}

// ---------- vault creation (wraps python memex-init) ----------
function createVault({ target, answers, packs }: { target: string; answers: Record<string, string>; packs: string }): Promise<CreateVaultResult> {
  return new Promise((resolve) => {
    const initScript = path.join(ENGINE_ROOT, 'tools', 'memex_init.py');
    // Packaged apps ship dist/ inside an asar — the engine's tools/ dir isn't there.
    if (!fs.existsSync(initScript)) {
      resolve({ ok: false, code: -1, output: 'Vault creation requires the Memex engine repo (tools/memex_init.py not found). Clone github.com/arjunrajlaboratory/Memex and run the app from app/ inside it, or open an existing vault.' });
      return;
    }
    const tmp = path.join(os.tmpdir(), `memex-answers-${Date.now()}.json`);
    fs.writeFileSync(tmp, JSON.stringify(answers, null, 2));
    const args = [
      initScript,
      '--eng', ENGINE_ROOT,
      '--target', target,
      '--packs', packs || 'core',
      '--answers', tmp,
    ];
    emit('setup:progress', { line: `python3 ${args.join(' ')}` });
    const proc = spawn('python3', args, { cwd: ENGINE_ROOT });
    let out = '';
    proc.stdout.on('data', (d) => { out += d; emit('setup:progress', { line: d.toString() }); });
    proc.stderr.on('data', (d) => { out += d; emit('setup:progress', { line: d.toString() }); });
    proc.on('close', (code) => {
      try { fs.unlinkSync(tmp); } catch (_) {}
      resolve({ ok: code === 0, code: code ?? -1, output: out });
    });
    proc.on('error', (err) => resolve({ ok: false, code: -1, output: String(err) }));
  });
}

// ---------- IPC ----------
function registerIpc(): void {
  ipcMain.handle('vault:pick', async () => {
    if (!win) return null;
    const r = await dialog.showOpenDialog(win, { properties: ['openDirectory', 'createDirectory'] });
    return r.canceled ? null : r.filePaths[0];
  });

  ipcMain.handle('vault:detect', async (_e, p: string) => {
    const full = expandHome(p);
    return { path: full, isVault: vaultLib.isVault(full) };
  });

  ipcMain.handle('files:pick', async () => {
    if (!win) return [];
    const r = await dialog.showOpenDialog(win, { properties: ['openFile', 'multiSelections'] });
    return r.canceled ? [] : r.filePaths;
  });

  ipcMain.handle('vault:recent', async () => {
    const cfg = loadConfig();
    const recent = (cfg.recent || []).filter((p) => vaultLib.isVault(p));
    return { recent, last: cfg.last && vaultLib.isVault(cfg.last) ? cfg.last : null };
  });

  ipcMain.handle('vault:current', async () => (currentVault ? vaultLib.summary(currentVault) : null));

  ipcMain.handle('vault:create', async (_e, opts: { target: string; answers: Record<string, string>; packs: string }) => {
    const res = await createVault({ ...opts, target: expandHome(opts.target) });
    return res;
  });

  ipcMain.handle('vault:open', async (_e, p: string) => {
    const full = expandHome(p);
    if (!vaultLib.isVault(full)) return { ok: false, error: 'Not a Memex vault' };
    currentVault = full;
    wikiIndexPromise = null;
    rememberVault(full);
    startWatchers(full);
    try { await startSession(full); } catch (e) { emit('agent:event', { kind: 'error', message: String((e as Error)?.message || e) }); }
    if (pendingDrops.length) {
      const drops = pendingDrops; pendingDrops = [];
      const res = copyIntoInbox(drops);
      emit('inbox:iconDrop', { copied: res.copied || [] });
    }
    return { ok: true, summary: vaultLib.summary(full) };
  });

  ipcMain.handle('data:get', async (_e, kind: DataKind) => {
    if (!currentVault) return null;
    switch (kind) {
      case 'summary': return vaultLib.summary(currentVault);
      case 'tasks': return vaultLib.readTasks(currentVault);
      case 'projects': return vaultLib.readProjects(currentVault);
      case 'ideas': return vaultLib.readIdeas(currentVault);
      case 'people': return vaultLib.readPeople(currentVault);
      case 'sources': return vaultLib.readSources(currentVault);
      case 'inbox': return vaultLib.readInbox(currentVault);
      case 'outputs': return vaultLib.readOutputs(currentVault);
      case 'briefing': return vaultLib.latestBriefing(currentVault);
      default: return null;
    }
  });

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

  ipcMain.handle('data:appConfig', async (): Promise<AppConfig> => {
    const out: AppConfig = { tabs: [], chips: [] };
    if (!currentVault) return out;
    const builtins = new Set(['dashboard', 'tasks', 'projects', 'ideas', 'people', 'inbox', 'outbox', 'artifact']);
    try {
      const raw = fs.readFileSync(path.join(currentVault, '_config', 'desktop-tabs.json'), 'utf8');
      const cfg = JSON.parse(raw) as { tabs?: unknown[]; chips?: unknown[] };
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
            !!t && !builtins.has(t.id.toLowerCase()) && !seen.has(t.id) && !!seen.add(t.id))
          .map((t) => ({
            id: String(t.id),
            label: String(t.label),
            kind: (t.kind || (t.url ? 'web' : (t.source ? 'query' : 'path'))) as TabDef['kind'],
            path: t.path ? String(t.path) : '',
            url: t.url ? String(t.url) : '',
            source: t.source ? String(t.source) : '',
            where: normalizeWhere(t.where),
            empty: t.empty ? String(t.empty) : '',
          }))
          .slice(0, 12);
      }
      if (Array.isArray(cfg.chips)) {
        out.chips = (cfg.chips as Array<Partial<ChipDef>>)
          .filter((c) => !!(c && c.label && c.prompt))
          .map((c) => ({ label: String(c.label), prompt: String(c.prompt) }))
          .slice(0, 12);
      }
    } catch (_) {}
    return out;
  });

  ipcMain.handle('tab:query', async (_e, def: TabDef | null): Promise<TabQueryResult> => {
    if (!currentVault || !def) return { source: 'tasks', rows: [] };
    const source = def.source || 'tasks';
    const loaders: Record<string, (v: string) => DataRow[]> = {
      tasks: vaultLib.readTasks, projects: vaultLib.readProjects, ideas: vaultLib.readIdeas,
      people: vaultLib.readPeople, sources: vaultLib.readSources,
    };
    const load = loaders[source] || vaultLib.readTasks;
    return { source, rows: filterRows(load(currentVault), def.where || {}, source) };
  });

  ipcMain.handle('tab:content', async (_e, rel: string): Promise<TabContentResult> => {
    if (!currentVault) return { type: 'missing' };
    const full = path.resolve(currentVault, rel);
    if (!vaultLib.within(currentVault, full)) return { type: 'missing' };
    let stat: fs.Stats; try { stat = fs.statSync(full); } catch (_) { return { type: 'missing' }; }
    if (stat.isDirectory()) return { type: 'dir', items: vaultLib.listFolder(currentVault, rel) };
    const f = vaultLib.readFile(currentVault, rel);
    if (!f) return { type: 'missing' };
    if (f.kind === 'markdown') return { type: 'file', file: { ...f, html: await renderMarkdown(f.content || '') } };
    if (f.kind === 'html') return { type: 'file', file: { kind: 'html', url: registerArtifact(f.content || ''), rel } };
    return { type: 'file', file: f };
  });

  ipcMain.handle('note:read', async (_e, rel: string): Promise<VaultFile | null> => {
    if (!currentVault) return null;
    const f = vaultLib.readFile(currentVault, rel);
    if (!f) return null;
    if (f.kind === 'markdown') return { ...f, html: await renderMarkdown(f.content || '') };
    if (f.kind === 'html') return { kind: 'html', url: registerArtifact(f.content || ''), rel };
    return f;
  });

  ipcMain.handle('artifact:register', async (_e, html: string) => registerArtifact(html || ''));

  ipcMain.handle('agent:send', async (_e, text: string) => {
    if (!session || !session.running) return { ok: false, error: 'No active session' };
    return { ok: session.send(text) };
  });

  ipcMain.handle('agent:interrupt', async () => {
    if (session) await session.interrupt();
    return { ok: true };
  });

  ipcMain.handle('inbox:addNote', async (_e, text: string) => {
    if (!currentVault) return { ok: false };
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    // the stamp has second precision — suffix on collision so rapid notes never overwrite
    let file = path.join(currentVault, 'Inbox', `note-${stamp}.md`);
    for (let i = 1; fs.existsSync(file); i++) file = path.join(currentVault, 'Inbox', `note-${stamp}-${i}.md`);
    fs.writeFileSync(file, text.endsWith('\n') ? text : text + '\n');
    return { ok: true, rel: path.relative(currentVault, file) };
  });

  ipcMain.handle('inbox:drop', async (_e, paths: string[]) => copyIntoInbox(paths));

  ipcMain.handle('shell:open', async (_e, target: string) => {
    if (/^https?:/.test(target)) return shell.openExternal(target);
    if (currentVault) return shell.openPath(path.resolve(currentVault, target));
    return null;
  });

  ipcMain.handle('shell:reveal', async (_e, rel: string) => {
    if (!currentVault) return null;
    shell.showItemInFolder(path.resolve(currentVault, rel));
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
    protocol.handle('artifact', (req) => {
      const id = new URL(req.url).pathname.replace(/^\//, '');
      const html = artifactStore.get(id);
      if (html == null) {
        // Evicted from the cache (panel history can outlive the 200-entry store) —
        // show a themed explanation instead of a bare "Not found".
        const gone = '<!doctype html><meta charset="utf-8"><body style="margin:0;display:grid;place-items:center;min-height:100vh;font-family:ui-sans-serif,system-ui,sans-serif;background:#1b1810;color:#bcb096"><div style="text-align:center;max-width:420px;padding:24px"><div style="font-size:36px;color:#e0a54a">✦</div><h2 style="color:#efe7d4;font-weight:600;margin:12px 0 8px">This artifact has expired</h2><p style="line-height:1.6;font-size:14px">Older artifacts are dropped from the cache as new ones arrive. Ask the agent to show it again, or open the source file from the Outbox.</p></div></body>';
        return new Response(gone, { status: 404, headers: { 'content-type': 'text/html; charset=utf-8' } });
      }
      // LRU refresh on view so revisited artifacts aren't the first evicted
      artifactStore.delete(id);
      artifactStore.set(id, html);
      return new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8' } });
    });
    registerIpc();
    createWindow();
    handleIconDrop(argvFiles(process.argv));
    app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
  });

  app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
  app.on('before-quit', async () => { stopWatchers(); if (session) { try { await session.stop(); } catch (_) {} } });
}
