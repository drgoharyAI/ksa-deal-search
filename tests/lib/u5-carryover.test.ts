import { describe, expect, it } from "vitest";
import { dealScore, rank } from "@/src/lib/rank";
import { takeRefocus } from "@/app/components/Compare";
import type { Product } from "@/src/lib/types";

const P = (o: Partial<Product>): Product => ({
  site: "noon-sa", id: "x", title: "t", listPrice: 100, origPrice: null, discountPct: null, currency: "SAR",
  rating: null, soldCount: 0, image: "", url: "", detailStatus: "ok", ...o,
});

describe("U4 carry-over (b): dealScore uses the shared store-discount rule", () => {
  it("a bare store percent (no was price) adds nothing", () => {
    expect(dealScore(P({ discountPct: 60 }), 100, 100)).toBeCloseTo(dealScore(P({}), 100, 100), 10);
  });
  it("a percent the prices contradict adds nothing; one they back counts", () => {
    const contradicted = P({ discountPct: 60, origPrice: 110 });
    const backed = P({ discountPct: 50, origPrice: 200 });
    expect(dealScore(contradicted, 100, 100)).toBeCloseTo(dealScore(P({}), 100, 100), 10);
    expect(dealScore(backed, 100, 100) - dealScore(P({}), 100, 100)).toBeCloseTo(0.3 * 0.5, 10);
  });
  it("a fake-deal was price adds nothing", () => {
    const fake = P({ discountPct: 50, origPrice: 200, deal: { badge: "fake-deal", label: "Fake deal" } });
    expect(dealScore(fake, 100, 100)).toBeCloseTo(dealScore(P({}), 100, 100), 10);
  });
  it("the deal sort no longer rewards a bare percent", () => {
    const bare = P({ id: "bare", discountPct: 90 });
    const real = P({ id: "real", discountPct: 20, origPrice: 125 });
    expect(rank([bare, real], "deal").map((p) => p.id)).toEqual(["real", "bare"]);
  });
});

describe("U4 carry-over (a): the compare dialog's refocus is cleared even while closed", () => {
  it("open: returns the column once, then nothing", () => {
    const ref = { current: 2 as number | null };
    expect(takeRefocus(ref, true)).toBe(2);
    expect(ref.current).toBeNull();
    expect(takeRefocus(ref, true)).toBeNull();
  });
  it("closed: clears the stale column so a reopen does not jump to an old Remove", () => {
    const ref = { current: 1 as number | null };
    expect(takeRefocus(ref, false)).toBeNull();
    expect(ref.current).toBeNull();
    expect(takeRefocus(ref, true)).toBeNull();
  });
});
