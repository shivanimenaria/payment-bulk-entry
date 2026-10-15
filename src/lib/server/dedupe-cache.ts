import "server-only";

// Tiny TTL cache for collapsing request bursts (e.g. /api/auth/me).
// - Expired entries are deleted on read, and swept on write — no timers.
// - Hard size cap: once full, the oldest entries are evicted (Map keeps
//   insertion order), so memory is bounded no matter how many distinct keys
//   (cookie values) arrive.
export class DedupeCache<V> {
  private entries = new Map<string, { value: V; expiresAt: number }>();

  constructor(
    private readonly ttlMs: number,
    private readonly maxEntries: number,
    private readonly now: () => number = Date.now,
  ) {}

  get(key: string): V | undefined {
    const hit = this.entries.get(key);
    if (!hit) return undefined;
    if (hit.expiresAt <= this.now()) {
      this.entries.delete(key);
      return undefined;
    }
    return hit.value;
  }

  set(key: string, value: V): void {
    const now = this.now();
    this.entries.forEach((e, k) => {
      if (e.expiresAt <= now) this.entries.delete(k);
    });
    this.entries.delete(key); // re-insert so it counts as newest
    while (this.entries.size >= this.maxEntries) {
      const oldest = this.entries.keys().next().value as string;
      this.entries.delete(oldest);
    }
    this.entries.set(key, { value, expiresAt: now + this.ttlMs });
  }

  get size(): number {
    return this.entries.size;
  }
}
