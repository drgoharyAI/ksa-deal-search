import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import FilterChips from "@/app/components/FilterChips";
import { CompareDialog, CompareTray } from "@/app/components/Compare";
import ResultTiers from "@/app/components/ResultTiers";
import { NO_FILTERS, chipContext, facetCounts, priceBounds } from "@/src/lib/chips";
import type { Product } from "@/src/lib/types";

const P = (id: string, o: Partial<Product> = {}): Product => ({
  site: "amazon-sa", id, title: `Item ${id}`, listPrice: 10, origPrice: null, discountPct: null, currency: "SAR",
  rating: null, soldCount: 0, image: "", url: "https://example.com", detailStatus: "ok", ...o,
});
const ps = [
  P("a", { title: "Samsung Galaxy S24 256GB", listPrice: 2000, rating: 4.6, discountPct: 20 }),
  P("b", { title: "Apple iPhone 15 128GB", listPrice: 3000, site: "noon-sa", rating: 4.2 }),
];
const noop = () => {};

describe("FilterChips (17c)", () => {
  const f = { ...NO_FILTERS, minRating: 4 };
  const ctx = chipContext(ps);
  const out = renderToStaticMarkup(createElement(FilterChips, { filters: f, onChange: noop, facets: facetCounts(ps, f, ctx), bounds: priceBounds(ps) }));
  it("groups options in fieldsets with counts", () => {
    expect(out).toContain("<legend");
    expect(out).toContain("Amazon KSA");
    expect(out).toContain("Samsung");
    expect(out).toContain('aria-label="Lowest price"');
    expect(out).toContain('aria-label="Highest price"');
  });
  it("a folded-bar toggle with the active count and summary; prices spoken with the currency", () => {
    expect(out).toContain('aria-expanded="false"');
    expect(out).toContain("Filters (1 active)");
    expect(out).toContain("4+ stars");
    expect(out).toContain('aria-valuetext="SAR 2000"');
    expect(out).toContain('aria-valuetext="SAR 3000"');
  });
  it("names the filters kept from the previous query", () => {
    const k = renderToStaticMarkup(createElement(FilterChips, { filters: f, onChange: noop, facets: facetCounts(ps, f, ctx), bounds: priceBounds(ps), kept: ["rating"] }));
    expect(k).toContain("Filters kept: rating");
  });
  it("rating and discount chips are pressed buttons", () => {
    expect(out).toMatch(/aria-pressed="true"[^>]*>.*?4\+/);
    expect(out).toContain("Only discounted");
    expect(out).toContain("Clear all filters");
  });
});

describe("Compare UI (17c)", () => {
  it("cards get a Compare checkbox only when asked", () => {
    const withCmp = renderToStaticMarkup(createElement(ResultTiers, { products: ps, compare: { isChecked: (p: Product) => p.id === "a", onToggle: noop } }));
    expect(withCmp.split('type="checkbox"').length - 1).toBe(2);
    expect(withCmp).toContain("checked");
    expect(renderToStaticMarkup(createElement(ResultTiers, { products: ps }))).not.toContain("Compare");
  });
  it("the tray says why a fifth was refused; Compare stays off under 2", () => {
    const tray = renderToStaticMarkup(createElement(CompareTray, { items: [ps[0]], full: false, onRemove: noop, onClear: noop, onOpen: noop }));
    expect(tray).toContain("Compare (1)");
    expect(tray).toContain("disabled");
    expect(tray).toContain("Tick one more product");
    const full = renderToStaticMarkup(createElement(CompareTray, { items: ps, full: true, onRemove: noop, onClear: noop, onOpen: noop }));
    expect(full).toContain("up to 4 products");
  });
  it("the table marks the lowest price and the rows that differ", () => {
    const d = renderToStaticMarkup(createElement(CompareDialog, { items: ps, open: false, onClose: noop }));
    expect(d).toContain('scope="row"');
    expect(d).toContain("cmp__lowest");
    expect(d).toContain("Lowest");
    expect(d).toContain("cmp__row--differs");
    expect(d).toMatch(/<td class="cmp__diff/);
    expect(d).toContain("Storage");
  });
});
