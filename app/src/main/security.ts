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
