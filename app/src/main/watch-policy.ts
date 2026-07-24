import * as path from 'path';
import { searchPathAffectsIndex } from './search';
import { isSyncArtifact } from './sync-artifacts';

export interface VaultChangeEffect {
  area: string | null;
  invalidateSearch: boolean;
  invalidateWiki: boolean;
}

const WIKI_ROOTS = new Set(['Atlas', 'Ops', 'Raw', 'Drafts']);

/** Classify one recursive root-watcher event for every cache and renderer consumer. */
export function classifyVaultChange(relativePath: string): VaultChangeEffect {
  const normalized = String(relativePath || '').replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
  const parts = normalized.split('/').filter(Boolean);
  // Sync-service noise must not trigger renderer refreshes or cache invalidation.
  if (parts.length && isSyncArtifact(parts[parts.length - 1])) {
    return { area: null, invalidateSearch: false, invalidateWiki: false };
  }
  const first = parts[0] || '';
  let area: string | null = null;
  if (first === '_config') area = 'config';
  else if (first === 'Inbox') area = 'inbox';
  else if (first === 'outputs') area = 'outputs';
  else if (first === 'Atlas') area = 'atlas';
  else if (parts[0] === 'Ops' && parts[1] === 'Tasks') area = 'tasks';
  else if (parts[0] === 'Ops' && parts[1] === 'Briefings') area = 'briefings';
  else if (!first || searchPathAffectsIndex(normalized)) area = 'custom';

  const ext = path.extname(parts[parts.length - 1] || '').toLowerCase();
  const invalidateWiki = parts.length === 0 || (WIKI_ROOTS.has(first) &&
    (parts.length === 1 || ext === '.md' || ext === '.markdown'));
  return {
    area,
    invalidateSearch: searchPathAffectsIndex(normalized),
    invalidateWiki,
  };
}
