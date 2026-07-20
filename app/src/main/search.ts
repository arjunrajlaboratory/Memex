import * as fs from 'fs';
import * as path from 'path';
import matter from 'gray-matter';
import { resolveInside } from './security';

const fsp = fs.promises;

// Folders that hold infra, not knowledge: hidden dirs, schema/template plumbing,
// the Quartz site build, and scripts.
const SKIP_DIRS = new Set(['node_modules', 'quartz', 'scripts']);
const MAX_DEPTH = 5;
const MAX_CONTENT_BYTES = 1_000_000n;
const FILE_LIMIT = 8;
const CONTENT_LIMIT = 10;
export const SEARCH_QUERY_LIMIT = 256;
export const SEARCH_INDEX_TTL_MS = 30_000;
export const SEARCH_INDEX_FILE_LIMIT = 10_000;
export const SEARCH_INDEX_CONTENT_BYTES = 64_000_000;

export class SearchContentBudget {
  private used = 0;
  private readonly limit: number;

  constructor(limit = SEARCH_INDEX_CONTENT_BYTES) {
    this.limit = Number.isSafeInteger(limit) && limit >= 0 ? limit : 0;
  }

  get remainingBytes(): number { return this.limit - this.used; }

  take(bytes: number): boolean {
    if (!Number.isSafeInteger(bytes) || bytes < 0 || this.used + bytes > this.limit) return false;
    this.used += bytes;
    return true;
  }
}

interface Candidate { rel: string; name: string; ext: string; isMd: boolean; }
interface SearchDocument extends Candidate { title: string; description: string; body: string; }

interface CachedSearchIndex { createdAt: number; promise: Promise<SearchDocument[]>; }

const indexCache = new Map<string, CachedSearchIndex>();

async function readUtf8WithinLimit(
  handle: fs.promises.FileHandle,
  budget: SearchContentBudget,
): Promise<string | null> {
  const max = Number(MAX_CONTENT_BYTES);
  const capacity = Math.min(max + 1, budget.remainingBytes);
  if (capacity <= 0) return null;
  const buffer = Buffer.allocUnsafe(capacity);
  let offset = 0;
  while (offset < buffer.length) {
    const { bytesRead } = await handle.read(buffer, offset, buffer.length - offset, offset);
    if (bytesRead === 0) break;
    if (!budget.take(bytesRead)) return null;
    offset += bytesRead;
  }
  // When the global budget, rather than EOF, stopped the read, reject the
  // partial document instead of indexing a truncated body.
  if (capacity < max + 1 && offset === capacity) return null;
  if (offset > max) return null;
  return buffer.subarray(0, offset).toString('utf8');
}

function shouldSkipName(name: string): boolean {
  const lower = name.toLowerCase();
  return name.startsWith('.') || name.startsWith('_') || SKIP_DIRS.has(lower) ||
    lower === 'readme.md' || lower.endsWith('.log');
}

/** Whether a watcher event could change the searchable index. */
export function searchPathAffectsIndex(relativePath: string): boolean {
  const parts = String(relativePath || '').split(/[\\/]+/).filter(Boolean);
  return parts.length === 0 || !parts.some(shouldSkipName);
}

async function listCandidates(vault: string): Promise<Candidate[]> {
  const root = path.resolve(vault);
  const acc: Candidate[] = [];
  let visited = 0;
  const walkDir = async (dir: string, depth: number): Promise<void> => {
    if (depth > MAX_DEPTH || visited >= SEARCH_INDEX_FILE_LIMIT) return;
    let directory: fs.Dir;
    try { directory = await fsp.opendir(dir); } catch (_) { return; }
    try {
      for await (const e of directory) {
        if (visited >= SEARCH_INDEX_FILE_LIMIT) break;
        visited += 1;
        if (shouldSkipName(e.name)) continue;
        const full = path.join(dir, e.name);
        if (e.isDirectory()) { await walkDir(full, depth + 1); continue; }
        // Never index symlinks, sockets, or other special entries. In particular,
        // readFile/stat must not follow a vault symlink into the rest of the machine.
        if (!e.isFile()) continue;
        const ext = path.extname(e.name).replace('.', '').toLowerCase();
        acc.push({
          rel: path.relative(root, full),
          name: e.name.replace(/\.(?:md|markdown)$/i, ''),
          ext,
          isMd: ext === 'md' || ext === 'markdown',
        });
      }
    } finally {
      try { await directory.close(); } catch (_) {}
    }
  };
  await walkDir(root, 0);
  return acc;
}

async function buildSearchIndex(vault: string): Promise<SearchDocument[]> {
  const root = path.resolve(vault);
  let realRoot: string;
  try { realRoot = await fsp.realpath(root); } catch (_) { return []; }
  const candidates = await listCandidates(root);
  const documents: SearchDocument[] = [];
  const contentBudget = new SearchContentBudget();

  for (const c of candidates) {
    let title = c.name;
    let description = '';
    let body = '';
    if (c.isMd) {
      const full = path.resolve(root, c.rel);
      let handle: fs.promises.FileHandle | null = null;
      try {
        // Open once and use that handle for the size check and read. O_NOFOLLOW
        // rejects a final-component symlink on platforms that expose the flag.
        const noFollow = process.platform === 'win32' ? 0 : (fs.constants.O_NOFOLLOW || 0);
        handle = await fsp.open(full, fs.constants.O_RDONLY | noFollow);
        const stat = await handle.stat({ bigint: true });
        if (!stat.isFile()) continue;
        const realFull = await fsp.realpath(full);
        if (!resolveInside(realRoot, realFull)) continue;
        // realpath() is still a pathname lookup, so ensure it names the same
        // filesystem object as the already-open handle before trusting it.
        const pathStat = await fsp.stat(realFull, { bigint: true });
        if (stat.dev !== pathStat.dev || stat.ino !== pathStat.ino) continue;
        if (stat.size <= MAX_CONTENT_BYTES) {
          const raw = await readUtf8WithinLimit(handle, contentBudget);
          if (raw != null) {
            const parsed = matter(raw);
            const data = parsed.data || {};
            title = data.title ? String(data.title) : c.name;
            description = [data.description, data.summary, Array.isArray(data.tags) ? data.tags.join(' ') : data.tags]
              .filter(Boolean).map(String).join(' — ');
            body = parsed.content || '';
          }
        }
      } catch (_) { /* unreadable regular file: retain its filename-only entry */ }
      finally { if (handle) await handle.close().catch(() => {}); }
    }
    documents.push({ ...c, title, description, body });
  }
  return documents;
}

async function getSearchIndex(vault: string): Promise<SearchDocument[]> {
  const key = path.resolve(vault);
  const now = Date.now();
  let cached = indexCache.get(key);
  if (!cached || now - cached.createdAt >= SEARCH_INDEX_TTL_MS) {
    const promise = buildSearchIndex(key);
    cached = { createdAt: now, promise };
    indexCache.set(key, cached);
    void promise.catch(() => { if (indexCache.get(key) === cached) indexCache.delete(key); });
  }
  return cached.promise;
}

/** Drop one vault's cached index, or every index when switching vaults. */
export function invalidateSearchIndex(vault?: string): void {
  if (vault) indexCache.delete(path.resolve(vault));
  else indexCache.clear();
}

function scoreName(hay: string, q: string, boundaryMatcher: RegExp): number {
  const h = hay.toLowerCase();
  if (h === q) return 100;
  if (h.startsWith(q)) return 80;
  // word-boundary match ("cycle 33" in "the-cycle-33-proposal")
  if (boundaryMatcher.test(h)) return 60;
  if (h.includes(q)) return 40;
  return 0;
}

function snippetAround(body: string, idx: number, qLen: number): string {
  const start = Math.max(0, idx - 60);
  const end = Math.min(body.length, idx + qLen + 60);
  const raw = body.slice(start, end).replace(/\s+/g, ' ').trim();
  return (start > 0 ? '…' : '') + raw + (end < body.length ? '…' : '');
}

/**
 * Two-tier vault search. Tier 1 matches filenames, frontmatter titles, and
 * description-like fields; tier 2 scans markdown bodies for the query and
 * returns a snippet around the first hit. Both tiers are capped and ranked.
 */
export async function searchVault(vault: string, query: string): Promise<SearchResults> {
  const q = String(query || '').trim().slice(0, SEARCH_QUERY_LIMIT).toLowerCase();
  const out: SearchResults = { query: q, files: [], content: [] };
  if (q.length < 2) return out;

  const documents = await getSearchIndex(vault);
  const escapedQuery = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const boundaryMatcher = new RegExp(`(^|[\\s\\-_./])${escapedQuery}`);
  const fileHits: Array<SearchHit & { score: number }> = [];
  const contentHits: SearchHit[] = [];

  for (const doc of documents) {
    const score = Math.max(scoreName(doc.name, q, boundaryMatcher), scoreName(doc.title, q, boundaryMatcher));
    const descIdx = doc.description.toLowerCase().indexOf(q);
    if (score > 0 || descIdx >= 0) {
      fileHits.push({
        rel: doc.rel, title: doc.title, ext: doc.ext,
        snippet: descIdx >= 0 ? snippetAround(doc.description, descIdx, q.length) : '',
        score: Math.max(score, descIdx >= 0 ? 30 : 0),
      });
    } else if (doc.body) {
      const idx = doc.body.toLowerCase().indexOf(q);
      if (idx >= 0 && contentHits.length < CONTENT_LIMIT * 3) {
        contentHits.push({
          rel: doc.rel,
          title: doc.title,
          ext: doc.ext,
          snippet: snippetAround(doc.body, idx, q.length),
        });
      }
    }
  }

  fileHits.sort((a, b) => b.score - a.score || a.title.localeCompare(b.title));
  out.files = fileHits.slice(0, FILE_LIMIT).map(({ score: _score, ...hit }) => hit);
  out.content = contentHits.slice(0, CONTENT_LIMIT);
  return out;
}
