import { describe, expect, it } from "vitest";
import {
  NO_FILTERS, activeChips, activeCount, activeSummary, applyFilters, chipContext, chipsForNewQuery, facetCounts, filtersFromSearch, isActive,
  isVerifiedDeal, withChipParams, type ChipFilters,
} from "@/src/lib/chips";
import type { Product } from "@/src/lib/types";

const P = (id: string, o: Partial<Product> = {}): Product => ({
  site: "amazon-sa", id, title: `Item ${id}`, listPrice: 100, origPrice: null, discountPct: null, currency: "SAR",
  rating: null, soldCount: 0, image: "", url: "", detailStatus: "ok", ...o,
});
const F = (o: Partial<ChipFilters>): ChipFilters => ({ ...NO_FILTERS, ...o });
const ps = [
  P("low", { deal: { badge: "lowest-30d", label: "Lowest in 30 days" }, rating: 4.5 }),
  P("below", { deal: { badge: "below-usual", label: "Below usual" }, site: "noon-sa" }),
  P("fake", { deal: { badge: "fake-deal", label: "Fake deal" }, origPrice: 300 }),
  P("normal", { deal: { badge: "normal", label: "Usual price" } }),
  P("none", { site: "jarir" }),
];
const ctx = chipContext(ps);
const ids = (xs: Product[]) => xs.map((p) => p.id);

describe("verified deals filter (U3)", () => {
  it("only our history's lows count; a fake or normal badge does not", () => {
    expect(ps.map(isVerifiedDeal)).toEqual([true, true, false, false, false]);
    expect(ids(applyFilters(ps, F({ deals: true }), ctx))).toEqual(["low", "below"]);
  });
  it("counts under the other filters and is active", () => {
    expect(facetCounts(ps, NO_FILTERS, ctx).deals).toBe(2);
    expect(facetCounts(ps, F({ stores: ["noon-sa"] }), ctx).deals).toBe(1);
    expect(isActive(F({ deals: true }))).toBe(true);
    expect(activeCount(F({ deals: true, discounted: true }))).toBe(2);
    expect(activeSummary(F({ deals: true }))).toBe("verified deals");
  });
  it("lives in the URL as deal=1 and round-trips; off writes nothing", () => {
    const qs = withChipParams("?x=1", F({ deals: true, stores: ["jarir"] }));
    expect(qs).toContain("deal=1");
    expect(filtersFromSearch(qs)).toEqual(F({ deals: true, stores: ["jarir"] }));
    expect(filtersFromSearch("?deal=0")).toEqual(NO_FILTERS);
    expect(withChipParams("?deal=1", NO_FILTERS)).toBe("");
  });
  it("a new query keeps it, like rating and discounted, and names it", () => {
    expect(chipsForNewQuery(F({ deals: true, stores: ["jarir"] }), "tv", "phone")).toEqual({ filters: F({ deals: true }), kept: ["deals"] });
  });
});

describe("rated count: the rating filter shows only when ratings exist (U3)", () => {
  it("counts cards with a rated listing, whatever the filters", () => {
    expect(facetCounts(ps, NO_FILTERS, ctx).rated).toBe(1);
    expect(facetCounts(ps, F({ stores: ["jarir"] }), ctx).rated).toBe(1);
    const none = [P("a"), P("b")];
    expect(facetCounts(none, NO_FILTERS, chipContext(none)).rated).toBe(0);
  });
});

describe("activeChips: one removable chip per filter (U3)", () => {
  const f = F({ stores: ["noon-sa", "jarir"], brands: ["apple"], minPrice: 100, maxPrice: 900, minRating: 4, discounted: true, deals: true });
  const chips = activeChips(f);
  it("names each filter in words", () => {
    expect(chips.map((c) => c.label)).toEqual(["noon KSA", "Jarir", "Apple", "SAR 100 to 900", "4+ stars", "Discounted", "Verified deals"]);
    expect(new Set(chips.map((c) => c.key)).size).toBe(chips.length);
  });
  it("each chip's `without` takes off just that one filter", () => {
    const by = (k: string) => chips.find((c) => c.key === k)!.without;
    expect(by("store:jarir").stores).toEqual(["noon-sa"]);
    expect(by("brand:apple").brands).toEqual([]);
    expect(by("price")).not.toHaveProperty("minPrice");
    expect(by("price")).not.toHaveProperty("maxPrice");
    expect(by("rating")).not.toHaveProperty("minRating");
    expect(by("discounted").discounted).toBe(false);
    expect(by("deals")).not.toHaveProperty("deals");
    for (const c of chips) expect(activeCount(c.without)).toBe(activeCount(f) - (c.key === "price" ? 1 : 1));
  });
  it("one-sided price ranges and no filters", () => {
    expect(activeChips(F({ minPrice: 50 }), "SAR")[0].label).toBe("from SAR 50");
    expect(activeChips(F({ maxPrice: 50 }), "SAR")[0].label).toBe("up to SAR 50");
    expect(activeChips(NO_FILTERS)).toEqual([]);
  });
});
