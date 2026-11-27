import { describe, it, expect } from "vitest";
import { sites } from "@/src/sites/registry";
import aliexpress from "../fixtures/aliexpress-search.json";
import amazonSa from "../fixtures/amazon-sa-search.json";
import carrefourSa from "../fixtures/carrefour-sa-search.json";
import extraSa from "../fixtures/extra-sa-search.json";
import jarir from "../fixtures/jarir-search.json";
import noonSa from "../fixtures/noon-sa-search.json";
import sheinSa from "../fixtures/shein-sa-search.json";
import trendyolSa from "../fixtures/trendyol-sa-search.json";

/**
 * Stock per store (owner request "drop out-of-stock listings"; evidence in
 * .superpowers/sdd/2026-11-27-deal-search/stock-saco-report.md). A store maps `inStock` only from a
 * field its search answer states; every other store leaves it unset (unknown: kept).
 */
const raw = (f: unknown): unknown[] => {
  const o = f as { data?: unknown[]; items?: unknown[] };
  return o.data ?? o.items ?? [];
};
const normalized = (site: string, f: unknown) =>
  raw(f)
    .map((r) => sites[site].normalizeSearchItem(r))
    .filter((p) => p !== null);

describe("stock: stores whose search answer states nothing reliable leave inStock unset", () => {
  const cases: [string, unknown][] = [
    ["aliexpress", aliexpress],
    ["amazon-sa", amazonSa],
    ["carrefour-sa", carrefourSa],
    ["jarir", jarir],
    ["noon-sa", noonSa],
  ];
  it.each(cases)("%s", (site, f) => {
    const ps = normalized(site, f);
    expect(ps.length).toBeGreaterThan(0);
    for (const p of ps) expect(p).not.toHaveProperty("inStock");
  });
});

describe("stock: stores with a stock field map it", () => {
  it("eXtra: inStockFlag \"true\" -> in stock (the recorded fixture is all in stock)", () => {
    const ps = normalized("extra-sa", extraSa);
    expect(ps.length).toBeGreaterThan(0);
    for (const p of ps) expect(p.inStock).toBe(true);
  });
  it("Trendyol and SHEIN fixtures predate the stock field: unknown, kept", () => {
    for (const [site, f] of [["trendyol-sa", trendyolSa], ["shein-sa", sheinSa]] as const) {
      for (const p of normalized(site, f)) expect(p).not.toHaveProperty("inStock");
    }
  });
});
