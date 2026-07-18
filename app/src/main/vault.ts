// Reads structured data out of a Memex vault directly from the filesystem, so the
// UI's data panels (Tasks, Projects, Inbox, Outbox, ...) are instant and free.

import * as fs from 'fs';
import * as path from 'path';
import matter from 'gray-matter';

interface NoteData { [key: string]: unknown; }
interface NoteFile { data: NoteData; body: string; raw: string; }
interface CollectionEntry { name: string; rel: string; data: NoteData; body: string; mtime: number; }

// True only when `full` is the base dir itself or genuinely inside it — startsWith
// alone would also match a sibling like `<base>-secret`.
export function within(base: string, full: string): boolean {
  const b = path.resolve(base);
  const f = path.resolve(full);
  return f === b || f.startsWith(b + path.sep);
}

export function isVault(dir: string | null | undefined): boolean {
  if (!dir) return false;
  try {
    return (
      fs.existsSync(path.join(dir, 'AGENTS.md')) &&
      fs.existsSync(path.join(dir, 'Atlas')) &&
      fs.existsSync(path.join(dir, 'Ops'))
    );
  } catch (_) { return false; }
}

function safeList(dir: string): fs.Dirent[] {
  try { return fs.readdirSync(dir, { withFileTypes: true }); } catch (_) { return []; }
}

function readNoteFile(file: string): NoteFile {
  try {
    const raw = fs.readFileSync(file, 'utf8');
    const { data, content } = matter(raw);
    return { data: data || {}, body: content || '', raw };
  } catch (_) { return { data: {}, body: '', raw: '' }; }
}

function clean(v: unknown): string {
  if (v == null) return '';
  if (Array.isArray(v)) return v.map((x) => clean(x)).join(', ');
  return String(v).replace(/^\[\[|\]\]$/g, '');
}

// YAML auto-parses unquoted `2026-07-18` into a Date; render dates as YYYY-MM-DD.
function dstr(v: unknown): string {
  if (v == null || v === '') return '';
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  const s = String(v);
  const m = s.match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : s;
}

function collection<T>(vault: string, subdir: string, mapper: (e: CollectionEntry) => T): T[] {
  const dir = path.join(vault, subdir);
  const out: T[] = [];
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

const TASK_STATUS_ORDER: Record<string, number> = {
  in_progress: 0, next: 1, waiting: 2, needs_review: 3, scheduled: 4,
  backlog: 5, inbox: 6, done: 7, canceled: 8,
};

const str = (v: unknown, dflt = ''): string => (v == null || v === '' ? dflt : String(v));
// YAML authors often quote numbers ("importance: \"9\"") — coerce numeric strings
// so sorting doesn't silently drop them.
const num = (v: unknown): number | undefined => {
  if (typeof v === 'number') return Number.isFinite(v) ? v : undefined;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v);
    return Number.isFinite(n) ? n : undefined;
  }
  return undefined;
};

export function readTasks(vault: string): TaskRow[] {
  const tasks = collection<TaskRow>(vault, 'Ops/Tasks', ({ name, rel, data }) => ({
    name, rel,
    title: str(data.title, name),
    status: str(data.status, 'next'),
    priority: str(data.priority, 'p2'),
    importance: num(data.importance),
    urgency: num(data.urgency),
    project: clean(data.project),
    area: clean(data.area),
    due: dstr(data.due),
    effort: str(data.effort),
    owner: str(data.owner, 'me'),
  }));
  tasks.sort((a, b) => {
    const sa = TASK_STATUS_ORDER[a.status] ?? 5;
    const sb = TASK_STATUS_ORDER[b.status] ?? 5;
    if (sa !== sb) return sa - sb;
    return String(a.priority).localeCompare(String(b.priority));
  });
  return tasks;
}

export function readProjects(vault: string): ProjectRow[] {
  const items = collection<ProjectRow>(vault, 'Atlas/Projects', ({ name, rel, data }) => ({
    name, rel,
    title: name,
    status: str(data.status, 'active'),
    phase: str(data.phase),
    area: clean(data.area),
    importance: num(data.importance),
    urgency: num(data.urgency),
    target_date: dstr(data.target_date),
    updated: dstr(data.updated),
  }));
  items.sort((a, b) => (b.importance || 0) - (a.importance || 0));
  return items;
}

export function readIdeas(vault: string): IdeaRow[] {
  return collection<IdeaRow>(vault, 'Atlas/Ideas', ({ name, rel, data }) => ({
    name, rel,
    title: str(data.title, name),
    status: str(data.status, 'raw'),
    priority: str(data.priority, 'unranked'),
    effort: str(data.effort_estimate),
    tags: Array.isArray(data.tags) ? data.tags.map(String) : [],
    project: clean(data.project),
  }));
}

export function readPeople(vault: string): PersonRow[] {
  return collection<PersonRow>(vault, 'Atlas/People', ({ name, rel, data }) => ({
    name, rel,
    title: str(data.name, name),
    role: str(data.role),
    org: clean(data.organization),
    strength: str(data.relationship_strength),
    email: str(data.email),
  }));
}

export function readSources(vault: string): SourceRow[] {
  return collection<SourceRow>(vault, 'Atlas/Sources', ({ name, rel, data }) => ({
    name, rel,
    title: name,
    kind: str(data.source_kind),
    status: str(data.status, 'new'),
    author: str(data.author),
    url: str(data.url),
  }));
}

export function readInbox(vault: string): FileEntry[] {
  const dir = path.join(vault, 'Inbox');
  const out: FileEntry[] = [];
  for (const ent of safeList(dir)) {
    if (ent.name === 'README.md' || ent.name.startsWith('.') || ent.name === '_filed') continue;
    const file = path.join(dir, ent.name);
    let stat: fs.Stats; try { stat = fs.statSync(file); } catch (_) { continue; }
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

function walk(dir: string, base: string, acc: FileEntry[], depth: number): void {
  if (depth > 4) return;
  for (const ent of safeList(dir)) {
    if (ent.name.startsWith('.') || ent.name === 'README.md') continue;
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) { walk(full, base, acc, depth + 1); continue; }
    if (ent.name.endsWith('.log')) continue;   // infra noise (e.g. quartz-serve.log)
    let stat: fs.Stats; try { stat = fs.statSync(full); } catch (_) { continue; }
    acc.push({
      name: ent.name,
      rel: path.relative(base, full),
      size: stat.size,
      mtime: stat.mtimeMs,
      ext: path.extname(ent.name).replace('.', '').toLowerCase(),
    });
  }
}

export function readOutputs(vault: string): FileEntry[] {
  const dir = path.join(vault, 'outputs');
  const acc: FileEntry[] = [];
  walk(dir, vault, acc, 0);
  acc.sort((a, b) => b.mtime - a.mtime);
  return acc;
}

export function listFolder(vault: string, relDir: string): FileEntry[] {
  const dir = path.resolve(vault, relDir);
  if (!within(vault, dir)) return [];
  const acc: FileEntry[] = [];
  walk(dir, vault, acc, 0);
  acc.sort((a, b) => b.mtime - a.mtime);
  return acc;
}

export function latestBriefing(vault: string): BriefingInfo | null {
  const dir = path.join(vault, 'Ops/Briefings');
  const files = safeList(dir).filter((e) => e.isFile() && e.name.endsWith('.md')).map((e) => e.name).sort();
  if (!files.length) return null;
  const name = files[files.length - 1];
  const rel = path.join('Ops/Briefings', name);
  const { body, raw } = readNoteFile(path.join(vault, rel));
  return { name, rel, body, raw };
}

export function summary(vault: string): VaultSummary {
  const tasks = readTasks(vault);
  const byStatus: Record<string, number> = {};
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
export function readFile(vault: string, rel: string): VaultFile | null {
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
