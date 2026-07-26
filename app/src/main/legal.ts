// Terms-acceptance decision logic. Deliberately free of electron imports so the
// whole decision surface is unit-testable: main.ts asks this module, and the gate
// overlay in the renderer is only how the user satisfies the answer.
import * as fs from 'fs';
import * as path from 'path';

export interface LegalManifest { version: string; effective: string; summary: string; }
export interface LegalDocs { manifest: LegalManifest; terms: string; privacy: string; }
export interface TermsAcceptance { version: string; acceptedAt: string; appVersion: string; }

/** Reads a bundled legal directory. Returns null if anything is missing or unusable. */
export function loadLegal(dir: string): LegalDocs | null {
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8')) as Partial<LegalManifest>;
    const version = typeof raw.version === 'string' ? raw.version.trim() : '';
    if (!version) return null;
    const terms = fs.readFileSync(path.join(dir, 'terms.md'), 'utf8');
    const privacy = fs.readFileSync(path.join(dir, 'privacy.md'), 'utf8');
    if (!terms.trim() || !privacy.trim()) return null;
    return {
      manifest: {
        version,
        effective: typeof raw.effective === 'string' ? raw.effective : '',
        summary: typeof raw.summary === 'string' ? raw.summary : '',
      },
      terms,
      privacy,
    };
  } catch (_) {
    return null;
  }
}

/**
 * Fails closed. A missing manifest, an unreadable document, or a record of the
 * wrong shape all mean "show the gate": re-reading the terms is a nuisance,
 * shipping a build that never shows them is not.
 *
 * Plain inequality rather than a semver comparison, so any declared-version
 * change re-prompts — including a rollback.
 */
export function needsAcceptance(accepted: unknown, manifest: LegalManifest | null): boolean {
  if (!manifest || !manifest.version) return true;
  if (!accepted || typeof accepted !== 'object') return true;
  const version = (accepted as { version?: unknown }).version;
  if (typeof version !== 'string' || !version.trim()) return true;
  return version !== manifest.version;
}

export function acceptanceRecord(manifest: LegalManifest, appVersion: string, now: Date): TermsAcceptance {
  return { version: manifest.version, acceptedAt: now.toISOString(), appVersion: String(appVersion || '') };
}
