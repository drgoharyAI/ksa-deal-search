export class TtlCache<T> {
  private store = new Map<string, { v: T; exp: number }>();

  constructor(private ttlMs: number) {}

  get(key: string): T | undefined {
    const e = this.store.get(key);
    if (!e) return undefined;
    if (Date.now() >= e.exp) {
      this.store.delete(key);
      return undefined;
    }
    return e.v;
  }

  set(key: string, v: T): void {
    this.store.set(key, { v, exp: Date.now() + this.ttlMs });
  }
}
