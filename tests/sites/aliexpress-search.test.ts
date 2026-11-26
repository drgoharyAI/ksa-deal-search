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
  it("returns null without price", () => {
    expect(normalizeSearchItem({ id: "1", title: "X" })).toBeNull();
    expect(normalizeSearchItem(null)).toBeNull();
  });
  it("null discountPct/origPrice when both missing", () => {
    const p = normalizeSearchItem({ id: "1", title: "X", price: 5 })!;
    expect(p.discountPct).toBeNull();
    expect(p.origPrice).toBeNull();
  });
  it("fixture: >=50 normalize, no NaN, SAR, aliexpress URLs", () => {
    const items = (fixture as { data: unknown[] }).data;
    const ps = items.map(normalizeSearchItem);
    const ok = ps.filter((p) => p !== null);
    expect(ok.length).toBeGreaterThanOrEqual(50);
    for (const p of ok) {
      for (const v of Object.values(p!)) {
        if (typeof v === "number") expect(Number.isNaN(v)).toBe(false);
      }
      expect(p!.url.startsWith("https://www.aliexpress.com/item/")).toBe(true);
      expect(p!.currency).toBe("SAR");
      expect(p!.image.startsWith("https://")).toBe(true);
    }
  });
});

describe("searchCalls", () => {
  it("emits 3 calls per term", () => {
    const calls = searchCalls({ terms: "anc earbuds", exclude: [] }, [
      "noise cancelling earbuds",
    ]);
    expect(calls).toHaveLength(6);
    expect(calls[0]).toEqual({
      op: "search",
      args: { q: "anc-earbuds", page: "1", sort: "default" },
    });
    expect(calls.filter((c) => c.args.sort === "price_asc")).toHaveLength(2);
    expect(calls.filter((c) => c.args.page === "2")).toHaveLength(2);
  });
  it("skips terms with empty slug", () => {
    expect(searchCalls({ terms: "¿¿", exclude: [] }, ["usb-c"])).toHaveLength(3);
  });
});
