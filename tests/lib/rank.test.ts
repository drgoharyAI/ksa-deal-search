import { describe, it, expect } from "vitest";
import { rank, dealScore, isLikelyMatch, MATCH_THRESHOLD } from "@/src/lib/rank";
import type { Product } from "@/src/lib/types";

const P = (o: Partial<Product>): Product => ({
  site: "aliexpress",
  id: "x",
  title: "t",
  listPrice: 10,
  origPrice: null,
  discountPct: null,
  currency: "SAR",
  rating: null,
  soldCount: 0,
  image: "",
  url: "",
  detailStatus: "ok",
  ...o,
});

describe("rank", () => {
  it("price sorts ascending by finalPrice, falling back to listPrice", () => {
    const a = P({ id: "a", listPrice: 30, finalPrice: 10 });
    const b = P({ id: "b", listPrice: 20 });
    const c = P({ id: "c", listPrice: 5, finalPrice: 25 });
    expect(rank([a, b, c], "price").map((p) => p.id)).toEqual(["a", "b", "c"]);
  });
  it("discount sorts descending, stable on ties", () => {
    const ps = [
      P({ id: "a", discountPct: 10, origPrice: 11.11 }),
      P({ id: "b", discountPct: 50, origPrice: 20.0 }),
      P({ id: "c", discountPct: 10, origPrice: 11.11 }),
      P({ id: "d", discountPct: null }),
      // A store percent with no "was" price, or one the prices contradict, counts as no discount.
      P({ id: "e", discountPct: 70 }),
      P({ id: "f", discountPct: 70, origPrice: 12 }),
    ];
    expect(rank(ps, "discount").map((p) => p.id)).toEqual(["b", "a", "c", "d", "e", "f"]);
  });
  it("deal sorts descending by dealScore and does not mutate input", () => {
    const cheap = P({ id: "cheap", listPrice: 10, discountPct: 60, rating: 4.5, soldCount: 1000 });
    const dear = P({ id: "dear", listPrice: 50, discountPct: 10, rating: 4.5, soldCount: 1000 });
    const input = [dear, cheap];
    expect(rank(input, "deal").map((p) => p.id)).toEqual(["cheap", "dear"]);
    expect(input[0].id).toBe("dear");
  });
});

describe("dealScore", () => {
  it("stays within 0..1", () => {
    const best = P({ listPrice: 10, discountPct: 100, rating: 5, soldCount: 1e9 });
    const worst = P({ listPrice: 50, discountPct: null, rating: null, soldCount: 0 });
    for (const p of [best, worst]) {
      const s = dealScore(p, 10, 50);
      expect(s).toBeGreaterThanOrEqual(0);
      expect(s).toBeLessThanOrEqual(1);
    }
    expect(dealScore(best, 10, 50)).toBeCloseTo(1, 5);
    expect(dealScore(worst, 10, 50)).toBe(0);
  });
  it("handles min === max without NaN", () => {
    expect(Number.isFinite(dealScore(P({ listPrice: 10 }), 10, 10))).toBe(true);
  });
  it("cheaper higher-discount beats pricier at same rating/sales", () => {
    const a = P({ listPrice: 10, discountPct: 60, rating: 4, soldCount: 100 });
    const b = P({ listPrice: 40, discountPct: 10, rating: 4, soldCount: 100 });
    expect(dealScore(a, 10, 40)).toBeGreaterThan(dealScore(b, 10, 40));
  });
});

describe("weak matches (12e)", () => {
  it("rank weak matches after the rest under every sort", () => {
    const ps = [P({ id: "w", listPrice: 1, weakMatch: true }), P({ id: "a", listPrice: 30 }), P({ id: "b", listPrice: 20 })];
    expect(rank(ps, "price").map((p) => p.id)).toEqual(["b", "a", "w"]);
    expect(rank(ps, "deal").map((p) => p.id).at(-1)).toBe("w");
  });
  it("an all-weak list is just sorted", () => {
    const ps = [P({ id: "a", listPrice: 3, weakMatch: true }), P({ id: "b", listPrice: 2, weakMatch: true })];
    expect(rank(ps, "price").map((p) => p.id)).toEqual(["b", "a"]);
  });
});

describe("confidence tiers (12f)", () => {
  const ps = [
    P({ id: "doubt", listPrice: 1, matchScore: MATCH_THRESHOLD - 0.01, discountPct: 90, origPrice: 10.0 }),
    P({ id: "weak", listPrice: 2, matchScore: 0.1, weakMatch: true, discountPct: 80, origPrice: 10.0 }),
    P({ id: "sure", listPrice: 30, matchScore: 0.9, discountPct: 5, origPrice: 31.58 }),
    P({ id: "edge", listPrice: 20, matchScore: MATCH_THRESHOLD, discountPct: 10, origPrice: 22.22 }),
    P({ id: "unscored", listPrice: 25 }),
  ];
  it("price: confident tier by price, then less likely, then weak", () => {
    expect(rank(ps, "price").map((p) => p.id)).toEqual(["edge", "unscored", "sure", "doubt", "weak"]);
  });
  it("discount and deal apply the same tiers", () => {
    expect(rank(ps, "discount").map((p) => p.id)).toEqual(["edge", "sure", "unscored", "doubt", "weak"]);
    expect(rank(ps, "deal").map((p) => p.id).slice(-2)).toEqual(["doubt", "weak"]);
  });
  it("isLikelyMatch: unscored counts as confident unless weak", () => {
    expect(ps.map(isLikelyMatch)).toEqual([false, false, true, true, true]);
  });
  it("an all-doubtful list is just sorted", () => {
    const low = [P({ id: "a", listPrice: 3, matchScore: 0.1 }), P({ id: "b", listPrice: 2, matchScore: 0.2 })];
    expect(rank(low, "price").map((p) => p.id)).toEqual(["b", "a"]);
  });
});
