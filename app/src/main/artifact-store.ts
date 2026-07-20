import { randomUUID } from 'crypto';

interface ArtifactRecord {
  scope: string;
  html: string;
}

/** Bounded artifact LRU whose content deduplication never crosses vault scopes. */
export class ArtifactStore {
  private readonly records = new Map<string, ArtifactRecord>();
  private readonly idsByScope = new Map<string, Map<string, string>>();

  constructor(
    private readonly limit = 200,
    private readonly makeId: () => string = randomUUID,
  ) {}

  register(scope: string, html: string): string {
    const normalizedScope = String(scope || 'unscoped');
    const normalizedHtml = String(html || '');
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
    this.records.set(id, { scope: normalizedScope, html: normalizedHtml });
    scoped.set(normalizedHtml, id);
    while (this.records.size > Math.max(1, this.limit)) this.evictOldest();
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
    const scoped = this.idsByScope.get(record.scope);
    if (scoped?.get(record.html) === oldest) scoped.delete(record.html);
    if (scoped && scoped.size === 0) this.idsByScope.delete(record.scope);
  }
}
