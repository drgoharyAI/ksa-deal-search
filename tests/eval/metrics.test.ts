import { describe, it, expect } from "vitest";
import { aggregate, computeMetrics, labelKey, type Label } from "@/src/eval/metrics";
import type { Product } from "@/src/lib/types";

const prod = (id: string, price: number, extra: Partial<Product> = {}): Product => ({
  site: "s",
  id,
  title: `item ${id}`,
  listPrice: price,
  origPrice: null,
  discountPct: null,
  currency: "SAR",
  rating: null,
  soldCount: 0,
  image: "",
  url: "",
  finalPrice: price,
  detailStatus: "ok",
  ...extra,
});

const mapOf = (ps: Product[]) => new Map(ps.map((p) => [labelKey(p), p]));
const none = { exclude: [] as string[] };

describe("computeMetrics", () => {
  const a = prod("a", 10);
  const b = prod("b", 20);
  const c = prod("c", 30);
  const d = prod("d", 5);
  const labels: Record<string, Label> = { "s:a": "relevant", "s:b": "accessory", "s:c": "wrong-model", "s:d": "relevant" };

  it("top-10 shares, recall and cheapest-first", () => {
    const m = computeMetrics({ results: [a, b, c], kept: [a, b, c], recorded: mapOf([a, b, c, d]), labels, constraints: none });
    expect(m.top).toBe(3);
    expect(m.precisionAt10).toBeCloseTo(1 / 3);
    expect(m.accessoryAt10).toBeCloseTo(1 / 3);
    expect(m.wrongModelAt10).toBeCloseTo(1 / 3);
    expect(m.recall).toBe(0.5); // d (relevant) was dropped
    expect(m.relevantRecorded).toBe(2);
    expect(m.relevantKept).toBe(1);
    expect(m.cheapestRelevantFirst).toBe(false); // d at 5 is cheaper than a at 10
    expect(m.unlabeledAt10).toBe(0);
  });

  it("cheapest-first true when #1 is the cheapest eligible relevant item", () => {
    const m = computeMetrics({ results: [d, a], kept: [d, a], recorded: mapOf([a, d]), labels, constraints: none });
    expect(m.cheapestRelevantFirst).toBe(true);
    expect(m.recall).toBe(1);
  });

  it("recall counts items kept before dedupe, not only the final list", () => {
    const m = computeMetrics({ results: [a], kept: [a, d], recorded: mapOf([a, d]), labels, constraints: none });
    expect(m.recall).toBe(1);
  });

  it("items outside the query's own filters are not eligible for cheapest-first", () => {
    const m = computeMetrics({ results: [a], kept: [a], recorded: mapOf([a, d]), labels, constraints: { minPrice: 8, exclude: [] } });
    expect(m.cheapestRelevantFirst).toBe(true);
    const ex = computeMetrics({
      results: [a],
      kept: [a],
      recorded: mapOf([a, prod("d", 5, { title: "Wired thing" })]),
      labels,
      constraints: { exclude: ["wired"] },
    });
    expect(ex.cheapestRelevantFirst).toBe(true);
    const a45 = prod("a", 10, { rating: 4.5 });
    const rated = computeMetrics({
      results: [a45],
      kept: [a45],
      recorded: mapOf([a45, prod("d", 5, { rating: 3 })]),
      labels,
      constraints: { minRating: 4, exclude: [] },
    });
    expect(rated.cheapestRelevantFirst).toBe(true);
  });

  it("recall's denominator is only relevant items eligible under the query's own filters", () => {
    const pricey = prod("p", 899);
    const l: Record<string, Label> = { "s:a": "relevant", "s:p": "relevant" };
    const m = computeMetrics({ results: [a], kept: [a], recorded: mapOf([a, pricey]), labels: l, constraints: { maxPrice: 300, exclude: [] } });
    expect(m.relevantRecorded).toBe(1);
    expect(m.recall).toBe(1);
    const ex = computeMetrics({
      results: [a],
      kept: [a],
      recorded: mapOf([a, prod("w", 5, { title: "Wired thing" })]),
      labels: { "s:a": "relevant", "s:w": "relevant" },
      constraints: { exclude: ["WIRED"] },
    });
    expect(ex.recall).toBe(1);
  });

  it("price bounds use listPrice like the pipeline, not finalPrice", () => {
    const shipped = prod("f", 290, { finalPrice: 310 });
    const m = computeMetrics({ results: [shipped], kept: [shipped], recorded: mapOf([shipped]), labels: { "s:f": "relevant" }, constraints: { maxPrice: 300, exclude: [] } });
    expect(m.relevantRecorded).toBe(1);
  });

  it("minRating: a null-rated item from a rated store is ineligible", () => {
    const rated = prod("r", 50, { site: "amz", rating: 4.5 });
    const unrated = prod("u", 5, { site: "amz", rating: null });
    const l: Record<string, Label> = { "amz:r": "relevant", "amz:u": "relevant" };
    const m = computeMetrics({ results: [rated], kept: [rated], recorded: mapOf([rated, unrated]), labels: l, constraints: { minRating: 4, exclude: [] } });
    expect(m.relevantRecorded).toBe(1);
    expect(m.recall).toBe(1);
    expect(m.cheapestRelevantFirst).toBe(true);
  });

  it("minRating: a null-rated item from a ratingless store is eligible", () => {
    const rated = prod("r", 50, { site: "amz", rating: 4.5 });
    const jarir = prod("j", 5, { site: "jarir", rating: null });
    const l: Record<string, Label> = { "amz:r": "relevant", "jarir:j": "relevant" };
    const m = computeMetrics({ results: [rated], kept: [rated], recorded: mapOf([rated, jarir]), labels: l, constraints: { minRating: 4, exclude: [] } });
    expect(m.relevantRecorded).toBe(2);
    expect(m.recall).toBe(0.5);
    expect(m.cheapestRelevantFirst).toBe(false);
  });

  it("an irrelevant #1 fails cheapest-first", () => {
    const m = computeMetrics({ results: [b, a], kept: [b, a], recorded: mapOf([a, b]), labels, constraints: none });
    expect(m.cheapestRelevantFirst).toBe(false);
  });

  it("only the first 10 count; unlabelled items are counted separately", () => {
    const many = Array.from({ length: 12 }, (_, i) => prod(`x${i}`, i + 1));
    const l: Record<string, Label> = Object.fromEntries(many.slice(0, 5).map((p) => [labelKey(p), "relevant"]));
    const m = computeMetrics({ results: many, kept: many, recorded: mapOf(many), labels: l, constraints: none });
    expect(m.top).toBe(10);
    expect(m.precisionAt10).toBe(0.5);
    expect(m.unlabeledAt10).toBe(5);
  });

  it("empty results: zero shares, null recall/cheapest when nothing relevant was recorded", () => {
    const m = computeMetrics({ results: [], kept: [], recorded: new Map(), labels: {}, constraints: none });
    expect(m).toMatchObject({ top: 0, precisionAt10: 0, accessoryAt10: 0, wrongModelAt10: 0, recall: null, cheapestRelevantFirst: null });
  });
});

describe("aggregate", () => {
  it("macro-averages and skips nulls", () => {
    const base = { top: 10, unlabeledAt10: 0, relevantRecorded: 1, relevantKept: 1 };
    const o = aggregate([
      { ...base, precisionAt10: 1, accessoryAt10: 0, wrongModelAt10: 0, recall: 1, cheapestRelevantFirst: true },
      { ...base, precisionAt10: 0.5, accessoryAt10: 0.2, wrongModelAt10: 0.1, recall: null, cheapestRelevantFirst: false },
      { ...base, precisionAt10: 0, accessoryAt10: 0, wrongModelAt10: 0.2, recall: 0.5, cheapestRelevantFirst: null },
    ]);
    expect(o.queries).toBe(3);
    expect(o.precisionAt10).toBeCloseTo(0.5);
    expect(o.accessoryAt10).toBeCloseTo(0.2 / 3);
    expect(o.wrongModelAt10).toBeCloseTo(0.1);
    expect(o.recall).toBeCloseTo(0.75);
    expect(o.cheapestRelevantFirst).toBe(0.5);
  });

  it("no queries", () => {
    expect(aggregate([])).toEqual({ queries: 0, precisionAt10: 0, accessoryAt10: 0, wrongModelAt10: 0, recall: null, cheapestRelevantFirst: null });
  });
});
