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
});
