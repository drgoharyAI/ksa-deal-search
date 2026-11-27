import { describe, it, expect } from "vitest";
import { hasValidPrice, isExcluded, passesPriceRating, ratinglessSites } from "@/src/lib/filters";
import type { Product } from "@/src/lib/types";

const prod = (extra: Partial<Product> = {}): Product => ({
  site: "s",
  id: "1",
  title: "Some Item",
  listPrice: 100,
  origPrice: null,
  discountPct: null,
  currency: "SAR",
  rating: 4.5,
  soldCount: 0,
  image: "",
  url: "",
  finalPrice: 100,
  detailStatus: "ok",
  ...extra,
});

describe("shared product filters", () => {
  it("hasValidPrice: finite and > 0", () => {
    expect(hasValidPrice(prod())).toBe(true);
    expect(hasValidPrice(prod({ listPrice: 0 }))).toBe(false);
    expect(hasValidPrice(prod({ listPrice: NaN }))).toBe(false);
  });

  it("isExcluded: case-insensitive substring of the title", () => {
    expect(isExcluded(prod({ title: "Wired Keyboard" }), ["wired"])).toBe(true);
    expect(isExcluded(prod({ title: "Wireless Keyboard" }), ["WIRED"])).toBe(false);
    expect(isExcluded(prod(), [])).toBe(false);
  });

  it("passesPriceRating: bounds on listPrice, not finalPrice", () => {
    const p = prod({ listPrice: 100, finalPrice: 50 });
    expect(passesPriceRating(p, { maxPrice: 80 }, new Set())).toBe(false);
    expect(passesPriceRating(p, { minPrice: 90, maxPrice: 100 }, new Set())).toBe(true);
  });

  it("passesPriceRating: minRating, null rating only for ratingless stores", () => {
    expect(passesPriceRating(prod({ rating: 3.9 }), { minRating: 4 }, new Set())).toBe(false);
    expect(passesPriceRating(prod({ rating: 4 }), { minRating: 4 }, new Set())).toBe(true);
    expect(passesPriceRating(prod({ rating: null }), { minRating: 4 }, new Set())).toBe(false);
    expect(passesPriceRating(prod({ rating: null }), { minRating: 4 }, new Set(["s"]))).toBe(true);
    expect(passesPriceRating(prod({ rating: null }), {}, new Set())).toBe(true);
  });

  it("ratinglessSites: stores whose every product has no rating", () => {
    const set = ratinglessSites([
      { site: "jarir", products: [prod({ site: "jarir", rating: null }), prod({ site: "jarir", rating: null })] },
      { site: "amazon", products: [prod({ site: "amazon", rating: null }), prod({ site: "amazon", rating: 4 })] },
      { site: "empty", products: [] },
    ]);
    expect([...set]).toEqual(["jarir"]);
  });
});
