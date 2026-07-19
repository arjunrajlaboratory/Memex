import * as fs from 'fs';
import * as path from 'path';
import matter from 'gray-matter';

const fsp = fs.promises;

// Folders that hold infra, not knowledge: hidden dirs, schema/template plumbing,
// the Quartz site build, and scripts.
const SKIP_DIRS = new Set(['node_modules', 'quartz', 'scripts']);
const MAX_DEPTH = 5;
const MAX_CONTENT_BYTES = 1_000_000;
const FILE_LIMIT = 8;
const CONTENT_LIMIT = 10;

interface Candidate { rel: string; name: string; ext: string; isMd: boolean; }

async function listCandidates(vault: string): Promise<Candidate[]> {
  const acc: Candidate[] = [];
  const walkDir = async (dir: string, depth: number): Promise<void> => {
    if (depth > MAX_DEPTH) return;
    let ents: fs.Dirent[];
    try { ents = await fsp.readdir(dir, { withFileTypes: true }); } catch (_) { return; }
    for (const e of ents) {
      if (e.name.startsWith('.') || e.name.startsWith('_') || SKIP_DIRS.has(e.name)) continue;
      if (e.name === 'README.md' || e.name.endsWith('.log')) continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) { await walkDir(full, depth + 1); continue; }
      const ext = path.extname(e.name).replace('.', '').toLowerCase();
      acc.push({
        rel: path.relative(vault, full),
        name: e.name.replace(/\.md$/, ''),
        ext,
        isMd: ext === 'md' || ext === 'markdown',
      });
    }
  };
  await walkDir(vault, 0);
  return acc;
}

function scoreName(hay: string, q: string): number {
  const h = hay.toLowerCase();
  if (h === q) return 100;
  if (h.startsWith(q)) return 80;
  // word-boundary match ("cycle 33" in "the-cycle-33-proposal")
  if (new RegExp(`(^|[\\s\\-_./])${q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`).test(h)) return 60;
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
  const q = String(query || '').trim().toLowerCase();
  const out: SearchResults = { query: q, files: [], content: [] };
  if (q.length < 2) return out;

  const candidates = await listCandidates(vault);
  const fileHits: Array<SearchHit & { score: number }> = [];
  const contentHits: SearchHit[] = [];

  for (const c of candidates) {
    let title = c.name;
    let description = '';
    let body = '';
    if (c.isMd) {
      try {
        const stat = await fsp.stat(path.join(vault, c.rel));
        if (stat.size <= MAX_CONTENT_BYTES) {
          const raw = await fsp.readFile(path.join(vault, c.rel), 'utf8');
          const parsed = matter(raw);
          const data = parsed.data || {};
          title = data.title ? String(data.title) : c.name;
          description = [data.description, data.summary, Array.isArray(data.tags) ? data.tags.join(' ') : data.tags]
            .filter(Boolean).map(String).join(' — ');
          body = parsed.content || '';
        }
      } catch (_) { /* unreadable file: fall through to name-only matching */ }
    }

    const score = Math.max(scoreName(c.name, q), scoreName(title, q));
    const descIdx = description.toLowerCase().indexOf(q);
    if (score > 0 || descIdx >= 0) {
      fileHits.push({
        rel: c.rel, title, ext: c.ext,
        snippet: descIdx >= 0 ? snippetAround(description, descIdx, q.length) : '',
        score: Math.max(score, descIdx >= 0 ? 30 : 0),
      });
    } else if (body) {
      const idx = body.toLowerCase().indexOf(q);
      if (idx >= 0 && contentHits.length < CONTENT_LIMIT * 3) {
        contentHits.push({ rel: c.rel, title, ext: c.ext, snippet: snippetAround(body, idx, q.length) });
      }
    }
  }

  fileHits.sort((a, b) => b.score - a.score || a.title.localeCompare(b.title));
  out.files = fileHits.slice(0, FILE_LIMIT).map(({ score: _score, ...hit }) => hit);
  out.content = contentHits.slice(0, CONTENT_LIMIT);
  return out;
}
