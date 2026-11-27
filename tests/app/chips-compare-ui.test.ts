import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import FilterChips from "@/app/components/FilterChips";
import ResultsLayout from "@/app/components/ResultsLayout";
import { CompareDialog, CompareTray } from "@/app/components/Compare";
import ResultTiers from "@/app/components/ResultTiers";
import { NO_FILTERS, chipContext, facetCounts, priceBounds } from "@/src/lib/chips";
import type { Product } from "@/src/lib/types";
import type { CompareSlot } from "@/src/lib/compare";
import { productKey } from "@/src/lib/specs";

const P = (id: string, o: Partial<Product> = {}): Product => ({
  site: "amazon-sa", id, title: `Item ${id}`, listPrice: 10, origPrice: null, discountPct: null, currency: "SAR",
  rating: null, soldCount: 0, image: "", url: "https://example.com", detailStatus: "ok", ...o,
});
const ps = [
  P("a", { title: "Samsung Galaxy S24 256GB", listPrice: 2000, rating: 4.6, discountPct: 20, origPrice: 2500 }),
  P("b", { title: "Apple iPhone 15 128GB", listPrice: 3000, site: "noon-sa", rating: 4.2 }),
];
const noop = () => {};
const count = (s: string, needle: string) => s.split(needle).length - 1;

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
  it("prices are spoken with the currency", () => {
    expect(out).toContain('aria-valuetext="SAR 2000"');
    expect(out).toContain('aria-valuetext="SAR 3000"');
  });
  it("the layout lists the active filters as removable chips, with clear all, beside the sidebar", () => {
    const lay = renderToStaticMarkup(
      createElement(ResultsLayout, {
        filters: f, onFilters: noop, facets: facetCounts(ps, f, ctx), bounds: priceBounds(ps), currency: "SAR", kept: [],
        sort: "price", onSort: noop, view: "grid", onView: noop, shown: 1, ready: true,
      }, null),
    );
    expect(lay).toContain('aria-label="Active filters"');
    expect(lay).toContain('<span class="achip__label">4+ stars</span>');
    expect(lay).toContain(", remove this filter");
    expect(lay).toContain("Clear all");
    // Server render (no window): the desktop sidebar, so no Filters button.
    expect(lay).toContain('class="rside"');
    expect(lay).not.toContain("rtools__filters");
    expect(lay).toContain('aria-pressed="true">Grid</button>');
  });
  it("names the filters kept from the previous query", () => {
    const k = renderToStaticMarkup(createElement(FilterChips, { filters: f, onChange: noop, facets: facetCounts(ps, f, ctx), bounds: priceBounds(ps), kept: ["rating"] }));
    expect(k).toContain("Filters kept from your last search: rating");
  });
  it("rating and discount chips are pressed buttons", () => {
    expect(out).toMatch(/aria-pressed="true"[^>]*>.*?4\+/);
    expect(out).toContain("Only discounted");
  });
});

describe("Compare UI (17c)", () => {
  it("cards get a Compare checkbox only when asked", () => {
    const withCmp = renderToStaticMarkup(createElement(ResultTiers, { products: ps, compare: { isChecked: (p: Product) => p.id === "a", onToggle: noop } }));
    expect(withCmp.split('type="checkbox"').length - 1).toBe(2);
    expect(withCmp).toContain("checked");
    expect(renderToStaticMarkup(createElement(ResultTiers, { products: ps }))).not.toContain("Compare");
  });
  const live = (p: Product): CompareSlot => ({ key: productKey(p), site: p.site, product: p, snap: { title: p.title, image: p.image } });
  const tray = (o: Partial<Parameters<typeof CompareTray>[0]>) =>
    renderToStaticMarkup(createElement(CompareTray, { slots: [], full: false, waiting: false, onRemove: noop, onClear: noop, onOpen: noop, ...o }));
  it("the tray says why one past the limit was refused; Compare stays off under 2", () => {
    const one = tray({ slots: [live(ps[0])] });
    expect(one).toContain("Compare (1)");
    expect(one).toContain("disabled");
    expect(one).toContain("Tick one more product");
    const full = tray({ slots: ps.map(live), full: true });
    expect(full).toContain("up to 4 products");
    expect(full).toContain("tray__note--full");
    expect(tray({ slots: [] })).toContain("hidden");
  });
  it("the tray names each product, removes each one, and offers Clear", () => {
    const out = tray({ slots: ps.map(live) });
    expect(out).toContain("Compare (2)");
    expect(out).not.toContain("disabled");
    expect(count(out, 'class="tray__chip"')).toBe(2);
    expect(out).toContain("Remove<span class=\"visually-hidden\"> Apple iPhone 15 128GB from compare</span>");
    expect(out).toContain(">Clear<");
  });
  it("a ticked product no longer in the results shows as such, is not counted, and keeps its store mark", () => {
    const gone: CompareSlot = { key: "jarir+x9", site: "jarir", product: null, snap: null };
    const out = tray({ slots: [...ps.map(live), gone] });
    expect(out).toContain("No longer in results");
    expect(out).toContain("tray__item--gone");
    expect(out).toContain("Compare (2)");
    expect(out).toContain("1 ticked product is no longer in the results.");
    expect(out).toContain("/stores/jarir.");
    expect(out).toContain("A product from Jarir");
    expect(tray({ slots: [gone], waiting: true })).toContain("Not in results yet");
    expect(tray({ slots: [gone], rerun: { query: "airpods 4", onRun: noop } })).toContain("Search &quot;airpods 4&quot; again");
  });
  it("a shared link opened elsewhere: no dead Compare button, and it says what to do", () => {
    const gone: CompareSlot = { key: "jarir+x9", site: "jarir", product: null, snap: null };
    const out = tray({ slots: [gone] });
    expect(out).toContain("Open the original search to see these products.");
    expect(out).not.toContain("tray__open");
    expect(out).not.toContain("disabled");
    expect(out).toContain(">Clear<");
    // With this tab's memory the search is offered instead, and Compare stays.
    const mem = tray({ slots: [gone], rerun: { query: "q", onRun: noop } });
    expect(mem).not.toContain("Open the original search");
    expect(mem).toContain("tray__open");
  });
  it("the table keeps 'from', marks a fake 'was', and says when there is no price history", () => {
    const ali = P("x", { site: "aliexpress", title: "JBL Flip 6", listPrice: 72, origPrice: 172, deal: { badge: "fake-deal", label: "Fake deal" } });
    const d = renderToStaticMarkup(createElement(CompareDialog, { items: [ali, P("y", { title: "JBL Flip 6 speaker", listPrice: 150 })], open: false, onClose: noop }));
    expect(d).toContain('<span class="cmp__from">from </span><span class="cmp__amount">SAR 72</span>');
    expect(d).not.toContain("cmp__lowest");
    expect(d).toContain("Cheapest is a &quot;from&quot; price, not ranked");
    expect(d).toContain("Not backed by price history");
    expect(d).toContain("No price history yet");
    expect(d).toContain("Store discount");
    expect(d).not.toMatch(/verified/i);
  });
  it("the table marks the lowest price and the rows that differ", () => {
    const d = renderToStaticMarkup(createElement(CompareDialog, { items: ps, open: false, onClose: noop }));
    expect(d).toContain('scope="row"');
    expect(d).toContain("cmp__lowest");
    expect(d).toContain("Lowest price");
    expect(d).toContain("cmp__row--differs");
    expect(d).toMatch(/<td class="cmp__diff/);
    expect(d).toContain("Storage");
  });
  it("the table: full titles, store marks, explicit 'Not listed', a store link per product, no shipping row", () => {
    const d = renderToStaticMarkup(createElement(CompareDialog, { items: ps, open: false, onClose: noop, onRemove: noop }));
    expect(d).toContain("Samsung Galaxy S24 256GB");
    expect(d).toContain("storemark");
    expect(d).toContain('<span class="cmp__none">Not listed</span>');
    expect(d).toContain("<s class=\"cmp__was\">SAR 2,500</s>");
    expect(d).toContain("View on noon KSA");
    expect(d).toContain('target="_blank" rel="noopener noreferrer"');
    expect(d).toContain("Prices exclude shipping.");
    expect(d).not.toMatch(/>Shipping<|Total price/);
    expect(d).toContain("Show only differences");
    expect(count(d, 'class="cmp__remove"')).toBe(2);
  });
  it("mixed currencies: no lowest price, and the price row says why", () => {
    const d = renderToStaticMarkup(createElement(CompareDialog, { items: [ps[0], P("u", { currency: "USD", listPrice: 5 })], open: false, onClose: noop }));
    expect(d).not.toContain("cmp__lowest");
    expect(d).toContain("Different currencies, not compared");
  });
  it("products left out of the table are named", () => {
    const gone: CompareSlot = { key: "jarir+x9", site: "jarir", product: null, snap: { title: "Old kettle", image: "" } };
    const d = renderToStaticMarkup(createElement(CompareDialog, { items: ps, missing: [gone], open: false, onClose: noop }));
    expect(d).toContain("no longer in results");
    expect(d).toContain("Old kettle");
  });
});
