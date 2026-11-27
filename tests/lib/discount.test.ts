import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { hasVerifiedDiscount, verifiedDiscount, wasPrice } from "@/src/lib/discount";
import { isDiscounted } from "@/src/lib/chips";
import { compareRows } from "@/src/lib/compare";
import { rank } from "@/src/lib/rank";
import SearchForm, { SORTS } from "@/app/components/SearchForm";
import ResultCard from "@/app/components/ResultCard";
import type { Product } from "@/src/lib/types";

const P = (id: string, o: Partial<Product> = {}): Product => ({
  site: "amazon-sa", id, title: `Item ${id}`, listPrice: 100, origPrice: null, discountPct: null, currency: "SAR",
  rating: null, soldCount: 0, image: "", url: "https://example.com/x", detailStatus: "ok", ...o,
});

describe("one verifiable-discount rule (U4 carry-over b)", () => {
  const cases: [string, Product, boolean][] = [
    ["a store 'was' price above the price", P("a", { origPrice: 125 }), true],
    ["a store percent backed by a 'was' price", P("b", { origPrice: 125, discountPct: 20 }), true],
    ["a store percent with no 'was' price", P("c", { discountPct: 20 }), false],
    ["a 'was' price equal to the price", P("d", { origPrice: 100 }), false],
    ["a 'was' price the history calls a fake deal", P("e", { origPrice: 150, deal: { badge: "fake-deal", label: "Fake deal" } }), false],
    ["a 'was' price under 1% above", P("f", { listPrice: 1000, origPrice: 1004 }), false],
  ];
  for (const [name, p, yes] of cases) {
    it(`${name}: ${yes ? "verified" : "not verified"} by the filter, the card and compare alike`, () => {
      expect(hasVerifiedDiscount(p)).toBe(yes);
      expect(isDiscounted(p)).toBe(yes);
      const card = renderToStaticMarkup(createElement(ResultCard, { product: p }));
      expect(card.includes("price__off")).toBe(yes);
      const discount = compareRows([p, P("z")]).find((r) => r.key === "discount")!;
      expect(discount.cells[0] !== null).toBe(yes);
    });
  }
  it("the percent: the store's own when backed, else worked out from the 'was' price", () => {
    expect(verifiedDiscount(P("a", { origPrice: 125 }))).toBe(20);
    expect(verifiedDiscount(P("b", { origPrice: 125, discountPct: 18 }))).toBe(18);
    expect(wasPrice(P("c", { origPrice: 90 }))).toBeNull();
  });
});

describe("the default sort's label (U4 carry-over a)", () => {
  it("says it ranks by match first, then price", () => {
    expect(SORTS.find((s) => s.value === "price")!.label).toBe("Best match, then price");
    expect(SORTS.map((s) => s.label)).not.toContain("Lowest price");
  });
  it("the home form shows the same label", () => {
    const form = renderToStaticMarkup(
      createElement(SearchForm, {
        values: { query: "", sites: ["jarir"], sort: "price", minPrice: "", maxPrice: "", minRating: "" },
        onChange: () => {}, onSubmit: () => {}, onStop: () => {}, loading: false, error: null, errorField: null,
      }),
    );
    expect(form).toContain('<option value="price" selected="">Best match, then price</option>');
  });
  it("the ranking itself is unchanged: confident matches first, then by price", () => {
    const out = rank([P("x", { listPrice: 10, matchScore: 0.2 }), P("y", { listPrice: 50 }), P("z", { listPrice: 30 })], "price");
    expect(out.map((p) => p.id)).toEqual(["z", "y", "x"]);
  });
});
