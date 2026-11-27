import { describe, it, expect, vi, afterEach } from "vitest";
import { TtlCache } from "@/src/lib/cache";

afterEach(() => vi.useRealTimers());

describe("TtlCache", () => {
  it("returns value before ttl and undefined after", () => {
    vi.useFakeTimers();
    const c = new TtlCache<number>(1000);
    c.set("a", 1);
    expect(c.get("a")).toBe(1);
    vi.advanceTimersByTime(999);
    expect(c.get("a")).toBe(1);
    vi.advanceTimersByTime(2);
    expect(c.get("a")).toBeUndefined();
  });

  it("evicts least-recently-used entry at cap", () => {
    const c = new TtlCache<number>(1000, { maxEntries: 2 });
    c.set("a", 1);
    c.set("b", 2);
    c.get("a"); // a is now most recent
    c.set("c", 3);
    expect(c.get("b")).toBeUndefined();
    expect(c.get("a")).toBe(1);
    expect(c.get("c")).toBe(3);
  });

  it("drops expired entries on set", () => {
    vi.useFakeTimers();
    const c = new TtlCache<number>(1000, { maxEntries: 2 });
    c.set("a", 1);
    vi.advanceTimersByTime(1001);
    c.set("b", 2);
    c.set("c", 3);
    expect(c.get("b")).toBe(2);
    expect(c.get("c")).toBe(3);
  });
});
