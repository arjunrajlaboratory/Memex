import * as fs from 'fs';
import * as path from 'path';
import { pathToFileURL } from 'url';

/** Only ordinary web URLs may leave the privileged renderer. */
export function isSafeExternalUrl(raw: string): boolean {
  try {
    const url = new URL(raw);
    return (url.protocol === 'https:' || url.protocol === 'http:') && !!url.hostname;
  } catch (_) {
    return false;
  }
}

/** Match the exact renderer file, ignoring only its query/hash decoration. */
export function isTrustedFileUrl(raw: string, expectedFile: string): boolean {
  try {
    const actual = new URL(raw);
    actual.hash = '';
    actual.search = '';
    return actual.href === pathToFileURL(expectedFile).href;
  } catch (_) {
    return false;
  }
}

/** Resolve a user-facing relative path without allowing it to leave its base. */
export function resolveInside(base: string, target: string): string | null {
  if (typeof target !== 'string' || !target) return null;
  const root = path.resolve(base);
  const full = path.resolve(root, target);
  const rel = path.relative(root, full);
  if (rel === '') return full;
  if (path.isAbsolute(rel) || rel === '..' || rel.startsWith('..' + path.sep)) return null;
  return full;
}

/**
 * Verify a previously resolved absolute path stays inside its base, including when
 * the nearest existing ancestor is a symlink. Resolution and validation use the
 * exact same value so callers cannot accidentally validate a different spelling.
 */
export function resolvedStaysInside(base: string, resolved: string): boolean {
  if (!path.isAbsolute(resolved)) return false;
  const root = path.resolve(base);
  const full = path.resolve(resolved);
  const rel = path.relative(root, full);
  if (path.isAbsolute(rel) || rel === '..' || rel.startsWith('..' + path.sep)) return false;

  try {
    let existing = full;
    while (!fs.existsSync(existing)) {
      const parent = path.dirname(existing);
      if (parent === existing) return false;
      existing = parent;
    }
    const realRoot = fs.realpathSync(root);
    const realExisting = fs.realpathSync(existing);
    const realRel = path.relative(realRoot, realExisting);
    return !path.isAbsolute(realRel) && realRel !== '..' && !realRel.startsWith('..' + path.sep);
  } catch (_) {
    return false;
  }
}
