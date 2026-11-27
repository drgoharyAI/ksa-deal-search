import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ResultCard, { verifiedDiscount, wasPrice } from "@/app/components/ResultCard";
import GroupCard from "@/app/components/GroupCard";
import FilterChips from "@/app/components/FilterChips";
import ResultTiers from "@/app/components/ResultTiers";
import { NO_FILTERS, chipContext, facetCounts, priceBounds } from "@/src/lib/chips";
import { allMembers, bestPriceRow, buildUnits, groupRows, viewItems, type GroupItem } from "@/src/lib/view";
import type { Product } from "@/src/lib/types";

const P = (o: Partial<Product> = {}): Product => ({
  site: "amazon-sa", id: "A", title: "Apple AirPods 4", listPrice: 499, origPrice: null, discountPct: null, currency: "SAR",
  rating: null, soldCount: 0, image: "https://m.media-amazon.com/a.jpg", url: "https://www.amazon.sa/dp/A", finalPrice: 499, detailStatus: "ok", ...o,
});
const card = (p: Product, extra: object = {}) => renderToStaticMarkup(createElement(ResultCard, { product: p, ...extra }));
const count = (s: string, needle: string) => s.split(needle).length - 1;

describe("ResultCard variants (U3)", () => {
  it("an image: fixed box, lazy, async decode, width and height set", () => {
    const out = card(P());
    expect(out).toMatch(/<div class="card__media"><img src="https:\/\/m\.media-amazon\.com\/a\.jpg" alt="" width="400" height="400" loading="lazy" decoding="async"/);
    expect(out).not.toContain("No image");
  });
  it("a missing image: a placeholder with the store's mark, no broken <img>", () => {
    const out = card(P({ site: "carrefour-sa", image: "", url: "https://www.carrefourksa.com/mafsau/en/p/1" }));
    expect(out).toContain('<span class="noimg"><img class="store-logo" src="/stores/carrefour-sa.ico"');
    expect(out).toContain("No image");
    expect(out).not.toContain('loading="lazy"');
  });
  it("a long title: the clamped heading keeps the full title in its title attribute", () => {
    const long = "Apple AirPods 4 Wireless Earbuds, Bluetooth Headphones, Personalised Spatial Audio, Sweat and Water Resistant, USB-C Charging Case, H2 Chip";
    const out = card(P({ title: long }));
    expect(out).toContain(`<h3 class="card__title" title="${long}">${long}</h3>`);
    expect(out).toContain(`(opens in a new tab)`);
  });
  it("no rating: no rating line at all (never a zero)", () => {
    const out = card(P());
    expect(out).not.toContain("Rated");
    expect(out).not.toContain("card__meta");
    expect(card(P({ rating: 4.6, soldCount: 1200, site: "aliexpress" }))).toContain("<span>Rated 4.6 of 5</span><span>1,200 sold</span>");
  });
  it("a struck price only when the store gives a higher earlier price", () => {
    expect(card(P())).not.toContain("<s ");
    expect(card(P({ origPrice: 499 }))).not.toContain("<s ");
    expect(card(P({ origPrice: 400 }))).not.toContain("<s ");
    const out = card(P({ origPrice: 649, discountPct: 23 }));
    expect(out).toMatch(/<s class="price__orig">SAR\s649<\/s>/);
    expect(out).toContain("−23%");
  });
  it("a discount shows only when verifiable: a 'was' price backs it and it is not a fake deal", () => {
    expect(verifiedDiscount(P({ discountPct: 20 }))).toBeNull();
    expect(verifiedDiscount(P({ origPrice: 998 }))).toBe(50);
    expect(verifiedDiscount(P({ origPrice: 649, deal: { badge: "fake-deal", label: "Fake deal" } }))).toBeNull();
    expect(wasPrice(P({ origPrice: 649, finalPrice: 700 }))).toBeNull();
    const fake = card(P({ origPrice: 649, discountPct: 23, deal: { badge: "fake-deal", label: "Fake deal", reason: "Never charged" } }));
    expect(fake).not.toContain("−23%");
    expect(fake).toContain("Fake deal");
  });
  it("the primary action names the store and opens it safely in a new tab; no shipping line per card", () => {
    const out = card(P());
    expect(out).toContain('<a class="btn btn--secondary btn--sm card__go" href="https://www.amazon.sa/dp/A" target="_blank" rel="noopener noreferrer">View on Amazon KSA');
    expect(out).not.toContain("Shipping");
    expect(card(P({ url: "http://insecure.example/x" }))).toContain("No store link");
  });
  it("grid, list and the muted 'less likely' variant", () => {
    expect(card(P())).toContain('class="card card--grid"');
    expect(card(P(), { variant: "list" })).toContain('class="card card--list"');
    const doubtful = card(P({ matchScore: 0.1 }));
    expect(doubtful).toContain('class="card card--grid card--muted"');
    expect(doubtful).toContain("Less likely match");
    expect(card(P(), { compareChecked: true, onCompare: () => {} })).toContain("card--selected");
  });
  it("ResultTiers draws list rows in a one-column list", () => {
    const out = renderToStaticMarkup(createElement(ResultTiers, { products: [P(), P({ id: "B" })], view: "list" }));
    expect(out).toContain('<ul class="grid grid--list" role="list">');
    expect(count(out, "card--list")).toBe(2);
  });
});

const G = (site: string, id: string, o: Partial<Product> = {}): Product => P({ site, id, url: `https://${site}.example/${id}`, groupKey: "g", ...o });
const group = (ps: Product[]): GroupItem => {
  const units = buildUnits(ps, [{ key: "g", memberKeys: ps.map((p) => `${p.site}:${p.id}`), bestKey: `${ps[0].site}:${ps[0].id}`, colors: {} }]);
  return viewItems(units, NO_FILTERS, chipContext(allMembers(units)), "price")[0] as GroupItem;
};

describe("group best price (U3)", () => {
  it("the lowest same-currency price is the best, in the accent", () => {
    const g = group([G("noon-sa", "n", { listPrice: 520, finalPrice: 520 }), G("jarir", "j", { listPrice: 499, finalPrice: 499 }), G("extra-sa", "x", { listPrice: 549, finalPrice: 549 })]);
    expect(g.bestPrice?.id).toBe("j");
    const out = renderToStaticMarkup(createElement(GroupCard, { group: g }));
    expect(out).toMatch(/Best price <span class="card__amount">SAR\s499<\/span>/);
    expect(count(out, "gcard__row--best")).toBe(1);
    expect(count(out, ">Best price<")).toBe(1);
  });
  it("prices in another currency are never compared: they rank after, and do not take the best", () => {
    const rows = groupRows([G("aliexpress", "u", { listPrice: 120, finalPrice: 120, currency: "USD" }), G("noon-sa", "n", { listPrice: 520, finalPrice: 520 }), G("jarir", "j", { listPrice: 499, finalPrice: 499 })]);
    expect(rows.map((p) => p.id)).toEqual(["j", "n", "u"]);
    expect(bestPriceRow(rows)?.id).toBe("j");
  });
  it("no best price when no other row shares the lead's currency", () => {
    const rows = [G("jarir", "j", { listPrice: 499, finalPrice: 499 }), G("aliexpress", "u", { listPrice: 120, finalPrice: 120, currency: "USD" })];
    expect(bestPriceRow(rows)).toBeNull();
    const g = group(rows);
    const out = renderToStaticMarkup(createElement(GroupCard, { group: g }));
    expect(out).toContain("Listed at");
    expect(out).not.toContain("gcard__row--best");
    expect(out).not.toContain(">Best price<");
  });
  it("no best price when a cheaper same-currency row is a less likely match", () => {
    const rows = [G("noon-sa", "n", { listPrice: 520, finalPrice: 520 }), G("jarir", "j", { listPrice: 300, finalPrice: 300, matchScore: 0.1 })];
    expect(groupRows(rows).map((p) => p.id)).toEqual(["n", "j"]);
    expect(bestPriceRow(groupRows(rows))).toBeNull();
  });
  it("one picture for the group: the next member's when the lead has none; no per-card shipping line", () => {
    const g = group([G("carrefour-sa", "c", { image: "", listPrice: 400, finalPrice: 400 }), G("jarir", "j", { listPrice: 450, finalPrice: 450, image: "https://j.example/i.jpg" })]);
    const out = renderToStaticMarkup(createElement(GroupCard, { group: g }));
    expect(count(out, 'src="https://j.example/i.jpg"')).toBe(1);
    expect(out).not.toContain("Shipping");
  });
});

describe("FilterChips shows only filters the data supports (U3)", () => {
  const render = (ps: Product[]) =>
    renderToStaticMarkup(createElement(FilterChips, { filters: NO_FILTERS, onChange: () => {}, facets: facetCounts(ps, NO_FILTERS, chipContext(ps)), bounds: priceBounds(ps) }));
  it("no ratings, no discounts, no deals: no rating or deal groups", () => {
    const out = render([P({ id: "a", site: "jarir" }), P({ id: "b", site: "carrefour-sa", listPrice: 600, finalPrice: 600 })]);
    expect(out).not.toContain("Minimum rating");
    expect(out).not.toContain("Only discounted");
    expect(out).not.toContain("Verified deals");
    expect(out).toContain("Store");
    expect(out).toContain("Price, SAR");
  });
  it("with them: the rating, discount and verified-deal options, with counts", () => {
    const out = render([
      P({ id: "a", rating: 4.7, origPrice: 600 }),
      P({ id: "b", site: "noon-sa", deal: { badge: "lowest-30d", label: "Lowest in 30 days" }, listPrice: 300, finalPrice: 300 }),
    ]);
    expect(out).toContain("Minimum rating");
    expect(out).toContain("Only discounted");
    expect(out).toContain("Verified deals");
  });
});
