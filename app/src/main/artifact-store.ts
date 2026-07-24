import { randomUUID } from 'crypto';

export const MAX_ARTIFACT_BYTES = 5_000_000;
export const MAX_ARTIFACT_TOTAL_BYTES = 50_000_000;

interface ArtifactRecord {
  scope: string;
  html: string;
  bytes: number;
}

/** Bounded artifact LRU whose content deduplication never crosses vault scopes. */
export class ArtifactStore {
  private readonly records = new Map<string, ArtifactRecord>();
  private readonly idsByScope = new Map<string, Map<string, string>>();
  private totalBytes = 0;

  constructor(
    private readonly limit = 200,
    private readonly makeId: () => string = randomUUID,
    private readonly maxBytes = MAX_ARTIFACT_BYTES,
    private readonly maxTotalBytes = MAX_ARTIFACT_TOTAL_BYTES,
  ) {}

  register(scope: string, html: string): string | null {
    const normalizedScope = String(scope || 'unscoped');
    const normalizedHtml = String(html || '');
    const bytes = Buffer.byteLength(normalizedHtml, 'utf8');
    if (bytes > this.maxBytes || bytes > this.maxTotalBytes) return null;
    let scoped = this.idsByScope.get(normalizedScope);
    if (!scoped) {
      scoped = new Map();
      this.idsByScope.set(normalizedScope, scoped);
    }
    const existing = scoped.get(normalizedHtml);
    if (existing && this.records.has(existing)) {
      const record = this.records.get(existing) as ArtifactRecord;
      this.records.delete(existing);
      this.records.set(existing, record);
      return existing;
    }

    const id = this.makeId();
    this.records.set(id, { scope: normalizedScope, html: normalizedHtml, bytes });
    this.totalBytes += bytes;
    scoped.set(normalizedHtml, id);
    while (this.records.size > Math.max(1, this.limit) || this.totalBytes > this.maxTotalBytes) this.evictOldest();
    return id;
  }

  get(id: string): string | null {
    const record = this.records.get(id);
    if (!record) return null;
    this.records.delete(id);
    this.records.set(id, record);
    return record.html;
  }

  private evictOldest(): void {
    const oldest = this.records.keys().next().value as string | undefined;
    if (!oldest) return;
    const record = this.records.get(oldest);
    this.records.delete(oldest);
    if (!record) return;
    this.totalBytes -= record.bytes;
    const scoped = this.idsByScope.get(record.scope);
    if (scoped?.get(record.html) === oldest) scoped.delete(record.html);
    if (scoped && scoped.size === 0) this.idsByScope.delete(record.scope);
  }
}
