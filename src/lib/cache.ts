export class TtlCache<T> {
  private store = new Map<string, { v: T; exp: number }>();
  private maxEntries: number;

  constructor(
    private ttlMs: number,
    opts: { maxEntries?: number } = {},
  ) {
    this.maxEntries = opts.maxEntries ?? 500;
  }

  get(key: string): T | undefined {
    const e = this.store.get(key);
    if (!e) return undefined;
    if (Date.now() >= e.exp) {
      this.store.delete(key);
      return undefined;
    }
    // Re-insert so Map insertion order tracks recency (LRU).
    this.store.delete(key);
    this.store.set(key, e);
    return e.v;
  }

  clear(): void {
    this.store.clear();
  }

  set(key: string, v: T): void {
    const now = Date.now();
    for (const [k, e] of this.store) if (now >= e.exp) this.store.delete(k);
    this.store.delete(key);
    this.store.set(key, { v, exp: now + this.ttlMs });
    while (this.store.size > this.maxEntries) {
      const oldest = this.store.keys().next().value as string;
      this.store.delete(oldest);
    }
  }
}
