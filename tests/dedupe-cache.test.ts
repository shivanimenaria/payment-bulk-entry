import { describe, it, expect } from "vitest";
import { DedupeCache } from "@/lib/server/dedupe-cache";

function clock(start = 1_000) {
  let t = start;
  return { now: () => t, advance: (ms: number) => (t += ms) };
}

describe("DedupeCache", () => {
  it("serves entries within the TTL and expires them after (2 s window preserved)", () => {
    const c = clock();
    const cache = new DedupeCache<string>(2_000, 10, c.now);
    cache.set("a", "body");
    c.advance(1_999);
    expect(cache.get("a")).toBe("body");
    c.advance(1);
    expect(cache.get("a")).toBeUndefined();
    expect(cache.size).toBe(0); // expired entry deleted on read
  });

  it("sweeps expired entries on write", () => {
    const c = clock();
    const cache = new DedupeCache<string>(2_000, 100, c.now);
    for (let i = 0; i < 50; i++) cache.set(`k${i}`, "v");
    c.advance(2_000);
    cache.set("fresh", "v");
    expect(cache.size).toBe(1);
  });

  it("never exceeds the hard cap, evicting the oldest first", () => {
    const c = clock();
    const cache = new DedupeCache<string>(60_000, 3, c.now);
    for (const k of ["a", "b", "c", "d", "e"]) cache.set(k, k);
    expect(cache.size).toBe(3);
    expect(cache.get("a")).toBeUndefined();
    expect(cache.get("b")).toBeUndefined();
    expect(cache.get("e")).toBe("e");
  });

  it("distinct keys never share a value (rotated cookie = new key)", () => {
    const cache = new DedupeCache<string>(2_000, 10);
    cache.set("cookie-old\n", "old");
    expect(cache.get("cookie-new\n")).toBeUndefined();
  });
});
