import * as fs from 'fs';
import * as path from 'path';
import { pathType } from './vault';

const fsp = fs.promises;
const WIKI_ROOTS = ['Atlas', 'Ops', 'Raw', 'Drafts'];
const MAX_DEPTH = 5;
export const WIKI_INDEX_ENTRY_LIMIT = 50_000;

/** Build a bounded filename-stem index without following vault symlinks. */
export async function buildWikiIndex(
  vault: string,
  entryLimit = WIKI_INDEX_ENTRY_LIMIT,
): Promise<Map<string, string>> {
  const idx = new Map<string, string>();
  const root = path.resolve(vault);
  const limit = Number.isFinite(entryLimit) ? Math.max(0, Math.floor(entryLimit)) : 0;
  let visited = 0;

  const walk = async (relDir: string, depth: number): Promise<void> => {
    if (depth > MAX_DEPTH || visited >= limit || pathType(root, relDir) !== 'directory') return;
    let directory: fs.Dir;
    try { directory = await fsp.opendir(path.join(root, relDir)); }
    catch (_) { return; }
    try {
      for await (const entry of directory) {
        if (visited >= limit) return;
        visited += 1;
        if (entry.name.startsWith('.') || entry.name === 'README.md') continue;
        const rel = path.join(relDir, entry.name);
        if (entry.isDirectory()) {
          await walk(rel, depth + 1);
          continue;
        }
        if (!entry.isFile() || !entry.name.endsWith('.md') || pathType(root, rel) !== 'file') continue;
        const key = entry.name.replace(/\.md$/, '').toLowerCase();
        if (!idx.has(key)) idx.set(key, rel);
      }
    } finally {
      try { await directory.close(); } catch (_) {}
    }
  };

  for (const wikiRoot of WIKI_ROOTS) {
    if (visited >= limit) break;
    await walk(wikiRoot, 0);
  }
  return idx;
}
