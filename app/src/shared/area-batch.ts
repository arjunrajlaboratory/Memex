/** Tiny browser-global helper used by the plain-script renderer to debounce change areas. */
class AreaBatch {
  private readonly areas = new Set<string>();

  add(area: string): void { if (area) this.areas.add(area); }

  drain(): string[] {
    const values = Array.from(this.areas);
    this.areas.clear();
    return values;
  }

  clear(): void { this.areas.clear(); }
}
