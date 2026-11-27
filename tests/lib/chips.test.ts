import { describe, it, expect } from "vitest";
import {
  activeCount, activeSummary, chipsForNewQuery, NO_FILTERS, applyFilters, chipContext, facetCounts, filtersFromSearch, isActive, isDiscounted, passes,
  priceBounds, withChipParams, type ChipFilters,
} from "@/src/lib/chips";
import type { Product } from "@/src/lib/types";

const P = (id: string, o: Partial<Product> = {}): Product => ({
  site: "amazon-sa", id, title: `Item ${id}`, listPrice: 100, origPrice: null, discountPct: null, currency: "SAR",
  rating: null, soldCount: 0, image: "", url: "", detailStatus: "ok", ...o,
});

const ps = [
  P("a", { title: "Samsung Galaxy S24", listPrice: 2000, rating: 4.6, discountPct: 20, origPrice: 2500 }),
  P("b", { title: "Samsung Galaxy S23", listPrice: 1500, rating: 4.1, site: "noon-sa" }),
  P("c", { title: "Apple iPhone 15", listPrice: 3000, rating: 3.2, site: "noon-sa", origPrice: 3300 }),
  P("d", { title: "Apple iPhone 14", listPrice: 2500, site: "jarir" }),
  P("e", { title: "Xiaomi Redmi 13", listPrice: 600, finalPrice: 550, rating: 4.8, site: "amazon-sa" }),
];
const ctx = chipContext(ps);
const F = (o: Partial<ChipFilters>): ChipFilters => ({ ...NO_FILTERS, ...o });
const ids = (xs: Product[]) => xs.map((p) => p.id);

describe("isDiscounted (17c)", () => {
  it("a discount percent or an original price above the price", () => {
    expect(isDiscounted(ps[0])).toBe(true);
    expect(isDiscounted(ps[2])).toBe(true);
    expect(isDiscounted(ps[1])).toBe(false);
    expect(isDiscounted(P("x", { discountPct: 0, origPrice: 100 }))).toBe(false);
  });
});

describe("passes / applyFilters", () => {
  it("no filters keeps everything", () => {
    expect(ids(applyFilters(ps, NO_FILTERS, ctx))).toEqual(["a", "b", "c", "d", "e"]);
    expect(isActive(NO_FILTERS)).toBe(false);
  });
  it("stores and brands are any-of within, all-of across", () => {
    expect(ids(applyFilters(ps, F({ stores: ["noon-sa"] }), ctx))).toEqual(["b", "c"]);
    expect(ids(applyFilters(ps, F({ brands: ["apple", "xiaomi"] }), ctx))).toEqual(["c", "d", "e"]);
    expect(ids(applyFilters(ps, F({ stores: ["noon-sa"], brands: ["apple"] }), ctx))).toEqual(["c"]);
  });
  it("price range uses the shown price (finalPrice first), inclusive", () => {
    expect(ids(applyFilters(ps, F({ minPrice: 550, maxPrice: 2000 }), ctx))).toEqual(["a", "b", "e"]);
    expect(ids(applyFilters(ps, F({ maxPrice: 560 }), ctx))).toEqual(["e"]);
  });
  it("min rating; a store that rates nothing in this result set passes", () => {
    expect(ids(applyFilters(ps, F({ minRating: 4.5 }), ctx))).toEqual(["a", "d", "e"]);
    const rated = chipContext(ps.filter((p) => p.site !== "jarir").concat(P("z", { site: "amazon-sa" })));
    expect(passes(P("z", { site: "amazon-sa" }), F({ minRating: 3 }), rated)).toBe(false);
  });
  it("only discounted", () => {
    expect(ids(applyFilters(ps, F({ discounted: true }), ctx))).toEqual(["a", "c"]);
  });
});

describe("facetCounts (17c)", () => {
  it("each option counts under the other filters, not its own", () => {
    const f = facetCounts(ps, F({ stores: ["noon-sa"], discounted: true }), ctx);
    // Store counts ignore the store filter but keep "only discounted".
    expect(f.stores).toEqual([
      { id: "amazon-sa", count: 1 },
      { id: "jarir", count: 0 },
      { id: "noon-sa", count: 1 },
    ]);
    // Discount count ignores itself but keeps the store filter.
    expect(f.discounted).toBe(1);
    expect(f.brands).toEqual([
      { id: "apple", count: 1 },
      { id: "samsung", count: 0 },
      { id: "xiaomi", count: 0 },
    ]);
    expect(f.ratings.map((r) => r.count)).toEqual([1, 1, 0, 0]);
    expect(f.total).toBe(1);
  });
  it("brands sort by their count over all results, then name; a selected missing option stays", () => {
    const f = facetCounts(ps, F({ brands: ["sony"] }), ctx);
    expect(f.brands.map((b) => b.id)).toEqual(["apple", "samsung", "xiaomi", "sony"]);
    expect(f.brands.find((b) => b.id === "sony")!.count).toBe(0);
  });
  it("stores follow the store list order", () => {
    expect(facetCounts(ps, NO_FILTERS, ctx).stores.map((s) => s.id)).toEqual(["amazon-sa", "jarir", "noon-sa"]);
  });
});

describe("priceBounds", () => {
  it("floor and ceiling of the shown prices; null when empty", () => {
    expect(priceBounds([P("a", { listPrice: 10.4 }), P("b", { listPrice: 99.2 })])).toEqual({ min: 10, max: 100 });
    expect(priceBounds([])).toBeNull();
  });
});

describe("URL state", () => {
  it("round-trips the filters and keeps other params", () => {
    const f = F({ stores: ["noon-sa", "jarir"], brands: ["apple"], minPrice: 100, maxPrice: 900, minRating: 4.5, discounted: true });
    const qs = withChipParams("?x=1&brand=old", f);
    expect(qs).toContain("x=1");
    expect(filtersFromSearch(qs)).toEqual(f);
  });
  it("drops unknown stores, bad numbers and odd ratings", () => {
    expect(filtersFromSearch("?store=nope,jarir&pmin=abc&pmax=-5&stars=2&disc=0")).toEqual(F({ stores: ["jarir"] }));
  });
  it("no filters writes no chip params", () => {
    expect(withChipParams("?store=jarir", NO_FILTERS)).toBe("");
  });
});

describe("chipsForNewQuery (17c fix I1)", () => {
  const f = F({ stores: ["jarir"], brands: ["apple"], minPrice: 5000, maxPrice: 9000, minRating: 4, discounted: true });
  it("a different query drops store, brand and price; keeps rating and discounted, and says so", () => {
    expect(chipsForNewQuery(f, "laptop", " phone case ")).toEqual({ filters: F({ minRating: 4, discounted: true }), kept: ["rating", "discounted"] });
    expect(chipsForNewQuery(F({ brands: ["apple"] }), "laptop", "phone")).toEqual({ filters: NO_FILTERS, kept: [] });
  });
  it("the same query (trimmed, any case) keeps everything", () => {
    expect(chipsForNewQuery(f, "Laptop", " laptop ")).toEqual({ filters: f, kept: [] });
  });
  it("no earlier results (a History re-run or first search) keeps the URL's filters", () => {
    expect(chipsForNewQuery(f, undefined, "phone")).toEqual({ filters: f, kept: [] });
  });
});

describe("activeCount / activeSummary (17c fix M4)", () => {
  it("counts and names the active filters", () => {
    const f = F({ stores: ["noon-sa"], brands: ["apple", "hp"], minPrice: 500, minRating: 4.5, discounted: true });
    expect(activeCount(f)).toBe(6);
    expect(activeSummary(f)).toBe("noon KSA, Apple, HP, from SAR 500, 4.5+ stars, discounted");
    expect(activeSummary(F({ minPrice: 100, maxPrice: 2000 }))).toBe("SAR 100 to 2,000");
    expect(activeSummary(F({ maxPrice: 2000 }))).toBe("up to SAR 2,000");
    expect(activeSummary(NO_FILTERS)).toBe("");
    expect(activeCount(NO_FILTERS)).toBe(0);
  });
});
