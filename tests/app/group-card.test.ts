import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import GroupCard from "@/app/components/GroupCard";
import ResultTiers from "@/app/components/ResultTiers";
import { NO_FILTERS, chipContext } from "@/src/lib/chips";
import { allMembers, buildUnits, httpsUrl, viewItems, type GroupItem } from "@/src/lib/view";
import type { Product } from "@/src/lib/types";

const P = (site: string, id: string, o: Partial<Product> = {}): Product => ({
  site, id, title: "Samsung TV QA65Q60D", listPrice: 100, origPrice: null, discountPct: null, currency: "SAR",
  rating: null, soldCount: 0, image: "", url: `https://${site}.example/${id}`, detailStatus: "ok", ...o,
});
const SITES = ["amazon-sa", "noon-sa", "jarir", "extra-sa", "carrefour-sa", "trendyol-sa"];
const groupOf = (n: number, o: (i: number) => Partial<Product> = () => ({})): GroupItem => {
  const ps = SITES.slice(0, n).map((s, i) => P(s, `p${i}`, { listPrice: 2000 + i * 100, ...o(i) }));
  const units = buildUnits(ps, [{ key: "g", memberKeys: ps.map((p) => `${p.site}:${p.id}`), bestKey: `${ps[0].site}:p0`, colors: { "noon-sa:p1": "black" } }]);
  return viewItems(units, NO_FILTERS, chipContext(allMembers(units)), "price")[0] as GroupItem;
};
const html = (g: GroupItem, extra: object = {}) => renderToStaticMarkup(createElement(GroupCard, { group: g, ...extra }));
const count = (s: string, needle: string) => s.split(needle).length - 1;

describe("httpsUrl (17b2)", () => {
  it("keeps https links only", () => {
    expect(httpsUrl("https://www.noon.com/x")).toBe("https://www.noon.com/x");
    expect(httpsUrl("http://www.noon.com/x")).toBeNull();
    expect(httpsUrl("javascript:alert(1)")).toBeNull();
    expect(httpsUrl("")).toBeNull();
  });
});

describe("GroupCard (17b2)", () => {
  it("leads with the best price and store, and a row per store in a list", () => {
    const out = html(groupOf(3, (i) => (i === 1 ? { discountPct: 12, origPrice: 2400, deal: { badge: "lowest-30d", label: "Lowest in 30 days" } } : {})));
    expect(out).toMatch(/Best price <span class="card__amount">SAR\s2,000<\/span> at/);
    expect(out).toContain("Prices from 3 stores");
    // role="list": list-style none drops list semantics in Safari/VoiceOver (task 18, 17b minor).
    expect(out).toContain('<ul class="gcard__rows" role="list"');
    expect(count(out, '<li class="gcard__row')).toBe(3);
    expect(count(out, "gcard__row--best")).toBe(1);
    expect(out).toContain("−12%");
    expect(out).toContain("Lowest in 30 days");
    expect(out).toContain(">black<");
  });
  it("each row links to its store in a new tab, named for screen readers", () => {
    const out = html(groupOf(2));
    expect(count(out, 'target="_blank" rel="noopener noreferrer"')).toBe(2);
    expect(out).toContain("Go to store<span class=\"visually-hidden\">: Samsung TV QA65Q60D at noon KSA, SAR 2,100 (opens in a new tab)</span>");
  });
  it("a store link that is not https is not linked", () => {
    const out = html(groupOf(2, (i) => (i === 1 ? { url: "http://noon.example/p1" } : {})));
    expect(count(out, "<a ")).toBe(1);
    expect(out).toContain("No store link");
  });
  it("shows four rows, then a '+N more' disclosure", () => {
    const out = html(groupOf(6));
    expect(count(out, '<li class="gcard__row')).toBe(4);
    expect(out).toContain('aria-expanded="false"');
    expect(out).toContain("+2 more");
    expect(html(groupOf(4))).not.toContain("aria-expanded");
  });
  it("Watch and Compare act on the best member", () => {
    const out = html(groupOf(2), { query: "tv", compareChecked: true, onCompare: () => {} });
    expect(count(out, 'type="checkbox"')).toBe(1);
    expect(out).toContain("checked");
    expect(out).toContain("Watch");
  });
  it("ResultTiers shows a group as one wide card beside single cards", () => {
    const g = groupOf(2);
    const out = renderToStaticMarkup(
      createElement(ResultTiers, { items: [g, { kind: "product", key: "x", product: P("jarir", "x", { title: "LG TV" }) }], compare: { isChecked: () => false, onToggle: () => {} } }),
    );
    expect(count(out, 'class="grid__wide"')).toBe(1);
    expect(out).toContain('<ul class="grid" role="list">');
    expect(count(out, 'type="checkbox"')).toBe(2);
  });
});
