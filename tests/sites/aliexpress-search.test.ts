import { describe, it, expect } from "vitest";
import fixture from "../fixtures/aliexpress-search.json";
import {
  slugify,
  parseSold,
  normalizeSearchItem,
  searchCalls,
} from "@/src/sites/aliexpress/search";

describe("slugify", () => {
  it("strips punctuation and joins with dashes", () => {
    expect(slugify('ANC  Earbuds / Pro & "Max"')).toBe("anc-earbuds-pro-max");
    expect(slugify("usb-c cable")).toBe("usb-c-cable");
    expect(slugify("¿¿")).toBe("");
  });
});

describe("parseSold", () => {
  it("parses counts", () => {
    expect(parseSold("10,000+ sold")).toBe(10000);
    expect(parseSold("3K+ sold")).toBe(3000);
    expect(parseSold("1.2K sold")).toBe(1200);
    expect(parseSold("121 sold")).toBe(121);
  });
  it("returns 0 for missing or odd values, never NaN", () => {
    expect(parseSold(undefined)).toBe(0);
    expect(parseSold("")).toBe(0);
    expect(parseSold("abc")).toBe(0);
    expect(parseSold(null as unknown as string)).toBe(0);
    expect(parseSold(42 as unknown as string)).toBe(0);
  });
});

describe("normalizeSearchItem", () => {
  it("derives origPrice from discount and fixes image/url", () => {
    const p = normalizeSearchItem({
      id: "1",
      title: "X",
      price: 7.91,
      currency: "SAR",
      discount: 80,
      image: "//a/b.jpg",
    })!;
    expect(p.site).toBe("aliexpress");
    expect(p.origPrice).toBeCloseTo(39.55, 2);
    expect(p.image).toBe("https://a/b.jpg");
    expect(p.url).toBe("https://www.aliexpress.com/item/1.html");
    expect(p.detailStatus).toBe("ok");
    expect(p.finalPrice).toBe(7.91);
    expect(p.shipping).toBeNull();
    expect(p.soldCount).toBe(0);
    expect(p.rating).toBeNull();
    expect(p.discountPct).toBe(80);
  });
  it("keeps SAR prices only: another currency or none is dropped", () => {
    expect(normalizeSearchItem({ id: "1", title: "X", price: 5, currency: "USD" })).toBeNull();
    expect(normalizeSearchItem({ id: "1", title: "X", price: 5 })).toBeNull();
    expect(normalizeSearchItem({ id: "1", title: "X", price: 5, currency: "SAR" })?.currency).toBe("SAR");
  });
  it("returns null without price", () => {
    expect(normalizeSearchItem({ id: "1", title: "X" })).toBeNull();
    expect(normalizeSearchItem(null)).toBeNull();
  });
  it("null discountPct/origPrice when both missing", () => {
    const p = normalizeSearchItem({ id: "1", title: "X", price: 5, currency: "SAR" })!;
    expect(p.discountPct).toBeNull();
    expect(p.origPrice).toBeNull();
  });
  it("discount outside 0-100 % or a 'was' price not above the price is dropped (task 18, Task 4 minor)", () => {
    for (const discount of [0, -5, 100, 150]) {
      const p = normalizeSearchItem({ id: "1", title: "X", price: 50, currency: "SAR", discount })!;
      expect(p.discountPct).toBeNull();
      expect(p.origPrice).toBeNull();
    }
    expect(normalizeSearchItem({ id: "1", title: "X", price: 50, currency: "SAR", origPrice: 50 })!.origPrice).toBeNull();
    expect(normalizeSearchItem({ id: "1", title: "X", price: 50, currency: "SAR", origPrice: 40 })!.origPrice).toBeNull();
    expect(normalizeSearchItem({ id: "1", title: "X", price: 50, currency: "SAR", origPrice: 80 })!.origPrice).toBe(80);
  });
  it("fixture: >=50 normalize, no NaN, SAR, aliexpress URLs", () => {
    const items = (fixture as { data: unknown[] }).data;
    const ps = items.map(normalizeSearchItem);
    const ok = ps.filter((p) => p !== null);
    expect(ok.length).toBeGreaterThanOrEqual(50);
    for (const p of ok) {
      for (const v of Object.values(p)) {
        if (typeof v === "number") expect(Number.isNaN(v)).toBe(false);
      }
      expect(p.url.startsWith("https://www.aliexpress.com/item/")).toBe(true);
      expect(p.currency).toBe("SAR");
      expect(p.image.startsWith("https://")).toBe(true);
    }
  });
});

describe("searchCalls", () => {
  it("budget: main p1, main price_asc p1, first variant p1 (max 3)", () => {
    const calls = searchCalls({ terms: "anc earbuds", exclude: [] }, [
      "noise cancelling earbuds",
      "wireless earbuds",
    ]);
    expect(calls).toEqual([
      { op: "search", args: { q: "anc-earbuds", page: "1", sort: "default" } },
      { op: "search", args: { q: "anc-earbuds", page: "1", sort: "price_asc" } },
      { op: "search", args: { q: "noise-cancelling-earbuds", page: "1", sort: "default" } },
    ]);
  });
  it("no variants -> 2 calls; never page 2", () => {
    const calls = searchCalls({ terms: "anc earbuds", exclude: [] }, []);
    expect(calls).toHaveLength(2);
    expect(calls.every((c) => c.args.page === "1")).toBe(true);
  });
  it("skips terms with empty slug; uses the first usable variant", () => {
    expect(searchCalls({ terms: "¿¿", exclude: [] }, ["¿", "usb-c"])).toEqual([
      { op: "search", args: { q: "usb-c", page: "1", sort: "default" } },
    ]);
  });
});
