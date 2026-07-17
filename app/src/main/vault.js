'use strict';
// Reads structured data out of a Memex vault directly from the filesystem, so the
// UI's data panels (Tasks, Projects, Inbox, Outbox, ...) are instant and free.

const fs = require('fs');
const path = require('path');
const matter = require('gray-matter');

// True only when `full` is the base dir itself or genuinely inside it — startsWith
// alone would also match a sibling like `<base>-secret`.
function within(base, full) {
  const b = path.resolve(base);
  const f = path.resolve(full);
  return f === b || f.startsWith(b + path.sep);
}

function isVault(dir) {
  if (!dir) return false;
  try {
    return (
      fs.existsSync(path.join(dir, 'AGENTS.md')) &&
      fs.existsSync(path.join(dir, 'Atlas')) &&
      fs.existsSync(path.join(dir, 'Ops'))
    );
  } catch (_) { return false; }
}

function safeList(dir) {
  try { return fs.readdirSync(dir, { withFileTypes: true }); } catch (_) { return []; }
}

function readNoteFile(file) {
  try {
    const raw = fs.readFileSync(file, 'utf8');
    const { data, content } = matter(raw);
    return { data: data || {}, body: content || '', raw };
  } catch (_) { return { data: {}, body: '', raw: '' }; }
}

function clean(v) {
  if (v == null) return '';
  if (Array.isArray(v)) return v;
  return String(v).replace(/^\[\[|\]\]$/g, '');
}

// YAML auto-parses unquoted `2026-07-18` into a Date; render dates as YYYY-MM-DD.
function dstr(v) {
  if (v == null || v === '') return '';
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  const s = String(v);
  const m = s.match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : s;
}

function collection(vault, subdir, mapper) {
  const dir = path.join(vault, subdir);
  const out = [];
  for (const ent of safeList(dir)) {
    if (!ent.isFile() || !ent.name.endsWith('.md')) continue;
    if (ent.name === 'README.md') continue;
    const file = path.join(dir, ent.name);
    const { data, body } = readNoteFile(file);
    const stat = fs.statSync(file);
    out.push(mapper({
      name: ent.name.replace(/\.md$/, ''),
      rel: path.relative(vault, file),
      data, body, mtime: stat.mtimeMs,
    }));
  }
  return out;
}

const TASK_STATUS_ORDER = {
  in_progress: 0, next: 1, waiting: 2, needs_review: 3, scheduled: 4,
  backlog: 5, inbox: 6, done: 7, canceled: 8,
};

function readTasks(vault) {
  const tasks = collection(vault, 'Ops/Tasks', ({ name, rel, data }) => ({
    name, rel,
    title: data.title || name,
    status: data.status || 'next',
    priority: data.priority || 'p2',
    importance: data.importance,
    urgency: data.urgency,
    project: clean(data.project),
    area: clean(data.area),
    due: dstr(data.due),
    effort: data.effort || '',
    owner: data.owner || 'me',
  }));
  tasks.sort((a, b) => {
    const sa = TASK_STATUS_ORDER[a.status] ?? 5;
    const sb = TASK_STATUS_ORDER[b.status] ?? 5;
    if (sa !== sb) return sa - sb;
    return String(a.priority).localeCompare(String(b.priority));
  });
  return tasks;
}

function readProjects(vault) {
  const items = collection(vault, 'Atlas/Projects', ({ name, rel, data }) => ({
    name, rel,
    title: name,
    status: data.status || 'active',
    phase: data.phase || '',
    area: clean(data.area),
    importance: data.importance,
    urgency: data.urgency,
    target_date: dstr(data.target_date),
    updated: dstr(data.updated),
  }));
  items.sort((a, b) => (b.importance || 0) - (a.importance || 0));
  return items;
}

function readIdeas(vault) {
  return collection(vault, 'Atlas/Ideas', ({ name, rel, data }) => ({
    name, rel,
    title: data.title || name,
    status: data.status || 'raw',
    priority: data.priority || 'unranked',
    effort: data.effort_estimate || '',
    tags: Array.isArray(data.tags) ? data.tags : [],
    project: clean(data.project),
  }));
}

function readPeople(vault) {
  return collection(vault, 'Atlas/People', ({ name, rel, data }) => ({
    name, rel,
    title: data.name || name,
    role: data.role || '',
    org: Array.isArray(data.organization) ? data.organization.map(clean).join(', ') : clean(data.organization),
    strength: data.relationship_strength || '',
    email: data.email || '',
  }));
}

function readSources(vault) {
  return collection(vault, 'Atlas/Sources', ({ name, rel, data }) => ({
    name, rel,
    title: name,
    kind: data.source_kind || '',
    status: data.status || 'new',
    author: data.author || '',
    url: data.url || '',
  }));
}

function readInbox(vault) {
  const dir = path.join(vault, 'Inbox');
  const out = [];
  for (const ent of safeList(dir)) {
    if (ent.name === 'README.md' || ent.name.startsWith('.') || ent.name === '_filed') continue;
    const file = path.join(dir, ent.name);
    let stat; try { stat = fs.statSync(file); } catch (_) { continue; }
    out.push({
      name: ent.name,
      rel: path.relative(vault, file),
      isDir: ent.isDirectory(),
      size: stat.size,
      mtime: stat.mtimeMs,
      ext: path.extname(ent.name).replace('.', '').toLowerCase(),
    });
  }
  out.sort((a, b) => b.mtime - a.mtime);
  return out;
}

function walk(dir, base, acc, depth) {
  if (depth > 4) return;
  for (const ent of safeList(dir)) {
    if (ent.name.startsWith('.') || ent.name === 'README.md') continue;
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) { walk(full, base, acc, depth + 1); continue; }
    if (ent.name.endsWith('.log')) continue;   // infra noise (e.g. quartz-serve.log)
    let stat; try { stat = fs.statSync(full); } catch (_) { continue; }
    acc.push({
      name: ent.name,
      rel: path.relative(base, full),
      size: stat.size,
      mtime: stat.mtimeMs,
      ext: path.extname(ent.name).replace('.', '').toLowerCase(),
    });
  }
}

function readOutputs(vault) {
  const dir = path.join(vault, 'outputs');
  const acc = [];
  walk(dir, vault, acc, 0);
  acc.sort((a, b) => b.mtime - a.mtime);
  return acc;
}

function listFolder(vault, relDir) {
  const dir = path.resolve(vault, relDir);
  if (!within(vault, dir)) return [];
  const acc = [];
  walk(dir, vault, acc, 0);
  acc.sort((a, b) => b.mtime - a.mtime);
  return acc;
}

function latestBriefing(vault) {
  const dir = path.join(vault, 'Ops/Briefings');
  const files = safeList(dir).filter((e) => e.isFile() && e.name.endsWith('.md')).map((e) => e.name).sort();
  if (!files.length) return null;
  const name = files[files.length - 1];
  const rel = path.join('Ops/Briefings', name);
  const { body, raw } = readNoteFile(path.join(vault, rel));
  return { name, rel, body, raw };
}

function summary(vault) {
  const tasks = readTasks(vault);
  const byStatus = {};
  for (const t of tasks) byStatus[t.status] = (byStatus[t.status] || 0) + 1;
  return {
    name: path.basename(vault),
    path: vault,
    counts: {
      tasks: tasks.length,
      openTasks: tasks.filter((t) => !['done', 'canceled'].includes(t.status)).length,
      projects: readProjects(vault).filter((p) => p.status === 'active').length,
      ideas: readIdeas(vault).length,
      people: readPeople(vault).length,
      sources: readSources(vault).length,
      inbox: readInbox(vault).length,
      outputs: readOutputs(vault).length,
    },
    tasksByStatus: byStatus,
  };
}

// Read an arbitrary vault note/file for the artifact viewer.
function readFile(vault, rel) {
  const full = path.resolve(vault, rel);
  if (!within(vault, full)) return null; // no escaping the vault
  try {
    const ext = path.extname(full).toLowerCase();
    if (['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg'].includes(ext)) {
      const b64 = fs.readFileSync(full).toString('base64');
      const mime = ext === '.svg' ? 'image/svg+xml' : `image/${ext.replace('.', '').replace('jpg', 'jpeg')}`;
      return { kind: 'image', dataUri: `data:${mime};base64,${b64}`, rel };
    }
    const raw = fs.readFileSync(full, 'utf8');
    if (ext === '.html' || ext === '.htm') return { kind: 'html', content: raw, rel };
    if (ext === '.md' || ext === '.markdown') {
      const { content } = matter(raw);
      return { kind: 'markdown', content, raw, rel };
    }
    return { kind: 'text', content: raw, rel };
  } catch (_) { return null; }
}

module.exports = {
  isVault, within, summary, readTasks, readProjects, readIdeas, readPeople,
  readSources, readInbox, readOutputs, latestBriefing, readFile, listFolder,
};
