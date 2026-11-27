import { describe, it, expect } from "vitest";
import { MAX_COMPARE, compareRows, toggleCompare } from "@/src/lib/compare";
import type { Product } from "@/src/lib/types";

const P = (id: string, o: Partial<Product> = {}): Product => ({
  site: "amazon-sa", id, title: `Item ${id}`, listPrice: 100, origPrice: null, discountPct: null, currency: "SAR",
  rating: null, soldCount: 0, image: "", url: "", detailStatus: "ok", ...o,
});

const row = (rows: ReturnType<typeof compareRows>, key: string) => rows.find((r) => r.key === key);

describe("compareRows (17c)", () => {
  const a = P("a", { title: "Samsung Galaxy S24 8GB RAM 256GB", listPrice: 2999, origPrice: 3499, discountPct: 14.3, rating: 4.6, deal: { badge: "lowest-30d", label: "Lowest in 30 days" } });
  const b = P("b", { title: "Samsung Galaxy S24 8GB RAM 512GB", listPrice: 2799, finalPrice: 2799, site: "noon-sa", rating: 4.6 });
  const rows = compareRows([a, b]);

  it("the fixed rows in order, then spec rows that have a value", () => {
    expect(rows.map((r) => r.key)).toEqual(["store", "price", "orig", "discount", "rating", "deal", "storage", "ram"]);
  });
  it("formats each cell; missing values are null", () => {
    expect(row(rows, "store")!.cells).toEqual(["Amazon KSA", "noon KSA"]);
    expect(row(rows, "price")!.cells).toEqual(["SAR 2,999", "SAR 2,799"]);
    expect(row(rows, "orig")!.cells).toEqual(["SAR 3,499", null]);
    expect(row(rows, "discount")!.cells).toEqual(["−14%", null]);
    expect(row(rows, "rating")!.cells).toEqual(["4.6 of 5", "4.6 of 5"]);
    expect(row(rows, "deal")!.cells).toEqual(["Lowest in 30 days", null]);
    expect(row(rows, "storage")!.cells).toEqual(["256 GB", "512 GB"]);
  });
  it("flags rows whose values differ, a missing value counting as different", () => {
    expect(row(rows, "storage")!.differs).toBe(true);
    expect(row(rows, "ram")!.differs).toBe(false);
    expect(row(rows, "rating")!.differs).toBe(false);
    expect(row(rows, "orig")!.differs).toBe(true);
  });
  it("marks the lowest price, ties included", () => {
    expect(row(rows, "price")!.lowest).toEqual([false, true]);
    expect(row(compareRows([P("x"), P("y"), P("z", { listPrice: 200 })]), "price")!.lowest).toEqual([true, true, false]);
  });
  it("drops a spec row no product has", () => {
    expect(rows.find((r) => r.key === "wattage")).toBeUndefined();
  });
});

describe("toggleCompare", () => {
  it("adds, removes, and refuses a fifth", () => {
    let list: Product[] = [];
    for (const id of ["a", "b", "c", "d"]) list = toggleCompare(list, P(id)).list;
    expect(list).toHaveLength(MAX_COMPARE);
    const full = toggleCompare(list, P("e"));
    expect(full.full).toBe(true);
    expect(full.list).toBe(list);
    expect(toggleCompare(list, P("b")).list.map((p) => p.id)).toEqual(["a", "c", "d"]);
  });
});
