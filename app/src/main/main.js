'use strict';
const { app, BrowserWindow, ipcMain, dialog, shell, protocol } = require('electron');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const os = require('os');

const vaultLib = require('./vault');
const { AgentSession } = require('./agent');

const fsp = fs.promises;
const ENGINE_ROOT = path.resolve(__dirname, '..', '..', '..'); // .../Memex
const CONFIG_PATH = () => path.join(app.getPath('userData'), 'config.json');

// Node's fs does not expand a leading ~, but the user's placeholder path is ~/…,
// so expand it wherever a user-supplied path enters the main process.
function expandHome(p) {
  if (typeof p !== 'string') return p;
  if (p === '~') return os.homedir();
  if (p.startsWith('~/') || p.startsWith('~\\')) return path.join(os.homedir(), p.slice(2));
  return p;
}

let win = null;
let currentVault = null;
let session = null;
let watchers = [];
let mdRenderer = null;

// Artifacts are served from their own secure origin so their inline scripts run
// (a file:// page's CSP is inherited by srcdoc/blob children; a distinct scheme is not).
protocol.registerSchemesAsPrivileged([
  { scheme: 'artifact', privileges: { standard: true, secure: true, supportFetchAPI: true } },
]);
const artifactStore = new Map();      // id -> html
const artifactByContent = new Map();  // html -> id (dedup, so re-viewing costs nothing)
let artifactSeq = 0;
function registerArtifact(html) {
  html = html || '';
  const existing = artifactByContent.get(html);
  if (existing && artifactStore.has(existing)) return `artifact://memex/${existing}`;
  const id = String(++artifactSeq);
  artifactStore.set(id, html);
  artifactByContent.set(html, id);
  if (artifactStore.size > 200) {
    const oldest = artifactStore.keys().next().value;
    const oldHtml = artifactStore.get(oldest);
    artifactStore.delete(oldest);
    if (artifactByContent.get(oldHtml) === oldest) artifactByContent.delete(oldHtml);
  }
  return `artifact://memex/${id}`;
}

// ---------- small persistent config (recent vaults) ----------
function loadConfig() {
  try { return JSON.parse(fs.readFileSync(CONFIG_PATH(), 'utf8')); } catch (_) { return { recent: [] }; }
}
function saveConfig(cfg) {
  try { fs.mkdirSync(path.dirname(CONFIG_PATH()), { recursive: true }); fs.writeFileSync(CONFIG_PATH(), JSON.stringify(cfg, null, 2)); } catch (_) {}
}
function rememberVault(p) {
  const cfg = loadConfig();
  cfg.recent = [p, ...(cfg.recent || []).filter((x) => x !== p)].slice(0, 8);
  cfg.last = p;
  saveConfig(cfg);
}

// ---------- wikilink index (Memex convention: filename stem == title == [[target]]) ----------
// Built asynchronously (and memoized as a promise) so a large vault's file walk never
// blocks the main process. Invalidated by setting wikiIndexPromise = null.
let wikiIndexPromise = null;
async function buildWikiIndex(vault) {
  const idx = new Map();
  const roots = ['Atlas', 'Ops', 'Raw', 'Drafts'];
  const walkIdx = async (dir, depth) => {
    if (depth > 5) return;
    let ents; try { ents = await fsp.readdir(dir, { withFileTypes: true }); } catch (_) { return; }
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
function getWikiIndex() {
  if (!currentVault) return Promise.resolve(new Map());
  if (!wikiIndexPromise) wikiIndexPromise = buildWikiIndex(currentVault);
  return wikiIndexPromise;
}
const escText = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
const escAttr = (s) => String(s).replace(/"/g, '&quot;').replace(/</g, '&lt;');

// Turn [[Target]], [[Target|Alias]], [[Target#heading]] into clickable internal
// links when the target resolves to a note, else a plain (unbracketed) label.
async function linkifyWikilinks(md) {
  const idx = await getWikiIndex();
  return String(md || '').replace(/\[\[([^\]|#\n]+)(?:#[^\]|\n]+)?(?:\|([^\]\n]+))?\]\]/g, (m, target, alias) => {
    const label = (alias || target).trim();
    const rel = idx.get(target.trim().toLowerCase());
    if (rel) return `<a class="wikilink" data-rel="${escAttr(rel)}">${escText(label)}</a>`;
    return `<span class="wikilink dead">${escText(label)}</span>`;
  });
}

// ---------- query filter for custom "query" tabs ----------
function filterRows(rows, where, source) {
  where = where || {};
  const today = new Date().toISOString().slice(0, 10);
  const plusDays = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };
  const done = new Set(['done', 'canceled']);
  const has = (v) => v != null && v !== '';
  const inList = (arr, v) => Array.isArray(arr) && arr.map(String).includes(String(v));
  const sub = (hay, needle) => String(hay || '').toLowerCase().includes(String(needle).toLowerCase());
  return rows.filter((r) => {
    if (where.status && !inList(where.status, r.status)) return false;
    if (where.priority && !inList(where.priority, r.priority)) return false;
    if (has(where.project) && !sub(r.project, where.project)) return false;
    if (has(where.area) && !sub(r.area, where.area)) return false;
    if (has(where.owner) && String(r.owner || '') !== String(where.owner)) return false;
    if (has(where.tag) && !(Array.isArray(r.tags) && r.tags.map((x) => String(x).toLowerCase()).includes(String(where.tag).toLowerCase()))) return false;
    if (where.overdue && !(r.due && r.due < today && !done.has(r.status))) return false;
    if (has(where.dueBefore) && !(r.due && r.due < where.dueBefore)) return false;
    if (typeof where.dueWithinDays === 'number' && !(r.due && r.due <= plusDays(where.dueWithinDays))) return false;
    // tasks: hide done/canceled by default unless the query asks for them
    if (source === 'tasks' && where.exclude_done !== false && !where.status && done.has(r.status)) return false;
    return true;
  });
}

// ---------- markdown -> safe-ish html ----------
async function renderMarkdown(md) {
  if (!mdRenderer) {
    const { marked } = await import('marked');
    marked.setOptions({ breaks: true, gfm: true });
    mdRenderer = marked;
  }
  const html = mdRenderer.parse(await linkifyWikilinks(md || ''));
  // local/trusted content, but strip obvious script/event-handler injection.
  return String(html)
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/ on\w+="[^"]*"/gi, '')
    .replace(/ on\w+='[^']*'/gi, '');
}

// ---------- window ----------
function createWindow() {
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
function setupDevHarness() {
  win.webContents.on('did-finish-load', () => {
    if (process.env.MEMEX_OPEN) {
      win.webContents.executeJavaScript(`window.__dev && window.__dev.open(${JSON.stringify(process.env.MEMEX_OPEN)})`).catch(() => {});
    }
  });
  const ctl = process.env.MEMEX_DEVCTL;
  if (!ctl) return;
  setInterval(async () => {
    if (!fs.existsSync(ctl)) return;
    let cmd; try { cmd = JSON.parse(fs.readFileSync(ctl, 'utf8')); } catch (_) { return; }
    try { fs.unlinkSync(ctl); } catch (_) {}
    try {
      if (cmd.js) await win.webContents.executeJavaScript(cmd.js, true);
      if (cmd.shot) { const img = await win.webContents.capturePage(); fs.writeFileSync(cmd.shot, img.toPNG()); }
    } catch (e) { try { fs.writeFileSync(ctl + '.err', String(e)); } catch (_) {} }
    try { fs.writeFileSync(ctl + '.done', String(Date.now())); } catch (_) {}
  }, 150);
}

function emit(channel, payload) { if (win && !win.isDestroyed()) win.webContents.send(channel, payload); }

// ---------- file watchers ----------
function stopWatchers() { for (const w of watchers) { try { w.close(); } catch (_) {} } watchers = []; }

function startWatchers(vault) {
  stopWatchers();
  const targets = [
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
      let timer = null;
      const w = fs.watch(dir, { recursive: true }, () => {
        clearTimeout(timer);
        wikiIndexPromise = null;   // note added/renamed/removed -> rebuild link index
        timer = setTimeout(() => emit('fs:changed', { area }), 250);
      });
      watchers.push(w);
    } catch (_) {}
  }
}

// ---------- agent session ----------
async function startSession(vault) {
  if (session) { try { await session.stop(); } catch (_) {} session = null; }
  session = new AgentSession({
    cwd: vault,
    onEvent: async (evt) => {
      if (evt.kind === 'assistant_text') {
        emit('agent:event', { ...evt, html: await renderMarkdown(evt.text) });
      } else if (evt.kind === 'artifact') {
        // Resolve inline vs path; render markdown to html here.
        const art = await resolveArtifact(vault, evt);
        emit('agent:event', { kind: 'artifact', artifact: art });
      } else {
        emit('agent:event', evt);
      }
    },
  });
  await session.start();
}

async function resolveArtifact(vault, evt) {
  let { title, format, content, path: rel } = evt;
  let kind = format;
  if (rel && !content) {
    const f = vaultLib.readFile(vault, rel);
    if (f) {
      if (f.kind === 'html') return { title: title || rel, kind: 'html', url: registerArtifact(f.content), rel };
      if (f.kind === 'image') return { title: title || rel, kind: 'image', dataUri: f.dataUri, rel };
      if (f.kind === 'markdown') return { title: title || rel, kind: 'markdown', html: await renderMarkdown(f.content), rel };
      return { title: title || rel, kind: 'text', text: f.content, rel };
    }
  }
  if (kind === 'auto') {
    if (rel && /\.html?$/.test(rel)) kind = 'html';
    else if (content && /^\s*<!doctype|^\s*<html|^\s*<div|^\s*<section|^\s*<table/i.test(content)) kind = 'html';
    else kind = 'markdown';
  }
  if (kind === 'html') return { title, kind: 'html', url: registerArtifact(content || ''), rel };
  return { title, kind: 'markdown', html: await renderMarkdown(content || ''), rel };
}

// ---------- vault creation (wraps python memex-init) ----------
function createVault({ target, answers, packs }) {
  return new Promise((resolve) => {
    const tmp = path.join(os.tmpdir(), `memex-answers-${Date.now()}.json`);
    fs.writeFileSync(tmp, JSON.stringify(answers, null, 2));
    const args = [
      path.join(ENGINE_ROOT, 'tools', 'memex_init.py'),
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
      resolve({ ok: code === 0, code, output: out });
    });
    proc.on('error', (err) => resolve({ ok: false, code: -1, output: String(err) }));
  });
}

// ---------- IPC ----------
function registerIpc() {
  ipcMain.handle('vault:pick', async () => {
    const r = await dialog.showOpenDialog(win, { properties: ['openDirectory', 'createDirectory'] });
    return r.canceled ? null : r.filePaths[0];
  });

  ipcMain.handle('vault:detect', async (_e, p) => {
    const full = expandHome(p);
    return { path: full, isVault: vaultLib.isVault(full) };
  });

  ipcMain.handle('files:pick', async () => {
    const r = await dialog.showOpenDialog(win, { properties: ['openFile', 'multiSelections'] });
    return r.canceled ? [] : r.filePaths;
  });

  ipcMain.handle('vault:recent', async () => {
    const cfg = loadConfig();
    const recent = (cfg.recent || []).filter((p) => vaultLib.isVault(p));
    return { recent, last: cfg.last && vaultLib.isVault(cfg.last) ? cfg.last : null };
  });

  ipcMain.handle('vault:current', async () => (currentVault ? vaultLib.summary(currentVault) : null));

  ipcMain.handle('vault:create', async (_e, opts) => {
    const res = await createVault({ ...opts, target: expandHome(opts.target) });
    return res;
  });

  ipcMain.handle('vault:open', async (_e, p) => {
    const full = expandHome(p);
    if (!vaultLib.isVault(full)) return { ok: false, error: 'Not a Memex vault' };
    currentVault = full;
    wikiIndexPromise = null;
    rememberVault(full);
    startWatchers(full);
    try { await startSession(full); } catch (e) { emit('agent:event', { kind: 'error', message: String(e.message || e) }); }
    return { ok: true, summary: vaultLib.summary(full) };
  });

  ipcMain.handle('data:get', async (_e, kind) => {
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

  ipcMain.handle('data:appConfig', async () => {
    const out = { tabs: [], chips: [] };
    if (!currentVault) return out;
    const builtins = new Set(['dashboard', 'tasks', 'projects', 'ideas', 'people', 'inbox', 'outbox', 'artifact']);
    try {
      const raw = fs.readFileSync(path.join(currentVault, '_config', 'desktop-tabs.json'), 'utf8');
      const cfg = JSON.parse(raw);
      if (Array.isArray(cfg.tabs)) {
        const seen = new Set();
        out.tabs = cfg.tabs
          .map((t) => {
            if (!t || !t.label) return null;
            // no id: derive one from the label rather than silently dropping the tab
            const id = String(t.id || String(t.label).toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/(^-+|-+$)/g, ''));
            return id ? { ...t, id } : null;
          })
          .filter((t) => t && !builtins.has(t.id.toLowerCase()) && !seen.has(t.id) && seen.add(t.id))
          .map((t) => ({
            id: String(t.id),
            label: String(t.label),
            kind: t.kind || (t.url ? 'web' : (t.source ? 'query' : 'path')),
            path: t.path ? String(t.path) : '',
            url: t.url ? String(t.url) : '',
            source: t.source ? String(t.source) : '',
            where: (t.where && typeof t.where === 'object') ? t.where : null,
            empty: t.empty || '',
          }))
          .slice(0, 12);
      }
      if (Array.isArray(cfg.chips)) {
        out.chips = cfg.chips
          .filter((c) => c && c.label && c.prompt)
          .map((c) => ({ label: String(c.label), prompt: String(c.prompt) }))
          .slice(0, 12);
      }
    } catch (_) {}
    return out;
  });

  ipcMain.handle('tab:query', async (_e, def) => {
    if (!currentVault || !def) return { source: 'tasks', rows: [] };
    const source = def.source || 'tasks';
    const loaders = {
      tasks: vaultLib.readTasks, projects: vaultLib.readProjects, ideas: vaultLib.readIdeas,
      people: vaultLib.readPeople, sources: vaultLib.readSources,
    };
    const load = loaders[source] || vaultLib.readTasks;
    return { source, rows: filterRows(load(currentVault), def.where || {}, source) };
  });

  ipcMain.handle('tab:content', async (_e, rel) => {
    if (!currentVault) return { type: 'missing' };
    const full = path.resolve(currentVault, rel);
    if (!vaultLib.within(currentVault, full)) return { type: 'missing' };
    let stat; try { stat = fs.statSync(full); } catch (_) { return { type: 'missing' }; }
    if (stat.isDirectory()) return { type: 'dir', items: vaultLib.listFolder(currentVault, rel) };
    const f = vaultLib.readFile(currentVault, rel);
    if (!f) return { type: 'missing' };
    if (f.kind === 'markdown') return { type: 'file', file: { ...f, html: await renderMarkdown(f.content) } };
    if (f.kind === 'html') return { type: 'file', file: { kind: 'html', url: registerArtifact(f.content), rel } };
    return { type: 'file', file: f };
  });

  ipcMain.handle('note:read', async (_e, rel) => {
    if (!currentVault) return null;
    const f = vaultLib.readFile(currentVault, rel);
    if (!f) return null;
    if (f.kind === 'markdown') return { ...f, html: await renderMarkdown(f.content) };
    if (f.kind === 'html') return { kind: 'html', url: registerArtifact(f.content), rel };
    return f;
  });

  ipcMain.handle('artifact:register', async (_e, html) => registerArtifact(html || ''));

  ipcMain.handle('agent:send', async (_e, text) => {
    if (!session || !session.running) return { ok: false, error: 'No active session' };
    return { ok: session.send(text) };
  });

  ipcMain.handle('agent:interrupt', async () => {
    if (session) await session.interrupt();
    return { ok: true };
  });

  ipcMain.handle('inbox:addNote', async (_e, text) => {
    if (!currentVault) return { ok: false };
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const file = path.join(currentVault, 'Inbox', `note-${stamp}.md`);
    fs.writeFileSync(file, text.endsWith('\n') ? text : text + '\n');
    return { ok: true, rel: path.relative(currentVault, file) };
  });

  ipcMain.handle('inbox:drop', async (_e, paths) => {
    if (!currentVault) return { ok: false };
    const inbox = path.join(currentVault, 'Inbox');
    const copied = [];
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
  });

  ipcMain.handle('shell:open', async (_e, target) => {
    if (/^https?:/.test(target)) return shell.openExternal(target);
    if (currentVault) return shell.openPath(path.resolve(currentVault, target));
    return null;
  });

  ipcMain.handle('shell:reveal', async (_e, rel) => {
    if (!currentVault) return null;
    shell.showItemInFolder(path.resolve(currentVault, rel));
  });
}

app.whenReady().then(() => {
  protocol.handle('artifact', (req) => {
    const id = new URL(req.url).pathname.replace(/^\//, '');
    const html = artifactStore.get(id);
    if (html == null) return new Response('Not found', { status: 404 });
    return new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8' } });
  });
  registerIpc();
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('before-quit', async () => { stopWatchers(); if (session) { try { await session.stop(); } catch (_) {} } });
