import { describe, it, expect } from "vitest";
import { NO_FILTERS, chipContext, facetCounts, facetCountsFor, type ChipFilters } from "@/src/lib/chips";
import { allMembers, buildUnits, leadOf, viewItems, type GroupItem } from "@/src/lib/view";
import type { Product } from "@/src/lib/types";

const P = (site: string, id: string, o: Partial<Product> = {}): Product => ({
  site, id, title: `Item ${id}`, listPrice: 100, origPrice: null, discountPct: null, currency: "SAR",
  rating: null, soldCount: 0, image: "", url: "https://example.com", detailStatus: "ok", ...o,
});
const F = (o: Partial<ChipFilters> = {}): ChipFilters => ({ ...NO_FILTERS, ...o });

// One TV at three stores (the noon twin was deduped out of `products`), plus two lone items.
const tvA = P("amazon-sa", "tv1", { title: "Samsung TV QA65Q60D", listPrice: 2400, rating: 4.5, groupKey: "g1" });
const tvN = P("noon-sa", "tv2", { title: "Samsung TV QA65Q60D", listPrice: 2200, discountPct: 10, groupKey: "g1" });
const tvJ = P("jarir", "tv3", { title: "Samsung QLED TV QA65Q60D", listPrice: 2300, groupKey: "g1" });
const lgA = P("amazon-sa", "lg1", { title: "LG TV 65UR8050", listPrice: 2250, rating: 4.1 });
const soA = P("noon-sa", "so1", { title: "Sony TV KD-65X75K", listPrice: 2600, rating: 3 });
const products = [tvA, tvJ, lgA, soA];
const groups = [{ key: "g1", memberKeys: ["noon-sa:tv2", "jarir:tv3", "amazon-sa:tv1"], bestKey: "noon-sa:tv2", colors: {} }];
const extras = [tvN];
const units = buildUnits(products, groups, extras);
const ctx = chipContext(allMembers(units));
const view = (f = F(), sort: "price" | "discount" | "deal" = "price") => viewItems(units, f, ctx, sort);
const ids = (xs: ReturnType<typeof view>) => xs.map((x) => (x.kind === "group" ? `G:${x.rows.map((r) => r.id).join(",")}` : x.product.id));

describe("buildUnits (17b2)", () => {
  it("one unit per group (extras included), the rest one unit each", () => {
    expect(units.map((u) => u.members.map((p) => p.id).sort().join(",")).sort()).toEqual(["lg1", "so1", "tv1,tv2,tv3"]);
    expect(allMembers(units)).toHaveLength(5);
  });
  it("a group with fewer than two known members falls back to single cards", () => {
    const u = buildUnits([tvA, lgA], [{ key: "g1", memberKeys: ["amazon-sa:tv1", "noon-sa:gone"], bestKey: "amazon-sa:tv1", colors: {} }], []);
    expect(u.every((x) => !x.grouped)).toBe(true);
    expect(u).toHaveLength(2);
  });
  it("without groups, every product is its own unit", () => {
    expect(buildUnits(products).map((u) => u.members.length)).toEqual([1, 1, 1, 1]);
  });
});

describe("viewItems (17b2)", () => {
  it("a group is one item, ranked by its best member; rows cheapest first", () => {
    expect(ids(view())).toEqual(["G:tv2,tv3,tv1", "lg1", "so1"]);
    const g = view()[0] as GroupItem;
    expect(g.best.id).toBe("tv2");
    expect(g.storeCount).toBe(3);
    expect(leadOf(g).id).toBe("tv2");
  });
  it("a group passes when any member passes; its price is the cheapest passing member", () => {
    const amazon = view(F({ stores: ["amazon-sa", "jarir"] }));
    expect(ids(amazon)).toEqual(["lg1", "G:tv3,tv1"]);
    expect((amazon[1] as GroupItem).best.id).toBe("tv3");
  });
  it("a group left with one passing member shows as a plain card", () => {
    // Jarir rates nothing, so its listing passes a rating filter (flagged, as before).
    expect(ids(view(F({ minRating: 4 })))).toEqual(["lg1", "G:tv3,tv1"]);
    expect(ids(view(F({ discounted: true })))).toEqual(["tv2"]);
  });
  it("the best member is the cheapest confident one; the sort applies to it", () => {
    const u = buildUnits(
      [P("amazon-sa", "x1", { listPrice: 50, matchScore: 0.1, groupKey: "g" }), P("noon-sa", "x2", { listPrice: 80, groupKey: "g" }), P("jarir", "y", { listPrice: 70 })],
      [{ key: "g", memberKeys: ["amazon-sa:x1", "noon-sa:x2"], bestKey: "noon-sa:x2", colors: {} }],
    );
    const out = viewItems(u, F(), chipContext(allMembers(u)), "price");
    expect(out.map((x) => leadOf(x).id)).toEqual(["y", "x2"]);
    expect((out[1] as GroupItem).rows.map((r) => r.id)).toEqual(["x2", "x1"]);
  });
  it("discount sort ranks a group by its best member's discount", () => {
    expect(ids(view(F(), "discount"))[0]).toBe("G:tv2,tv3,tv1");
  });
});

describe("facet counts with groups (17b2)", () => {
  const units1 = units.map((u) => u.members);
  it("a group counts once in the total and per brand, once per store it is at", () => {
    const f = facetCountsFor(units1, F(), ctx);
    expect(f.total).toBe(3);
    expect(Object.fromEntries(f.stores.map((o) => [o.id, o.count]))).toEqual({ "amazon-sa": 2, "noon-sa": 2, jarir: 1 });
    expect(f.brands.find((b) => b.id === "samsung")?.count).toBe(1);
    expect(f.discounted).toBe(1);
    expect(f.ratings.map((r) => r.count)).toEqual([3, 3, 2, 1]);
  });
  it("counts follow the other filters, member by member", () => {
    const f = facetCountsFor(units1, F({ stores: ["jarir"] }), ctx);
    expect(f.total).toBe(1);
    expect(f.discounted).toBe(0);
    expect(f.brands.find((b) => b.id === "samsung")?.count).toBe(1);
  });
  it("singletons give the same counts as facetCounts", () => {
    const flat = allMembers(units);
    expect(facetCountsFor(flat.map((p) => [p]), F({ minRating: 4 }), ctx)).toEqual(facetCounts(flat, F({ minRating: 4 }), ctx));
  });
});
