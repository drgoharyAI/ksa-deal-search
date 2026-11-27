import { describe, it, expect } from "vitest";
import fixture from "../fixtures/extra-sa-search.json";
import { sanitizeQ, normalizeSearchItem, searchCalls } from "@/src/sites/extra-sa/search";

const URL1 = "https://www.extra.com/en-sa/cat/slug/p/100478407";

describe("sanitizeQ", () => {
  it("keeps only safe chars", () => {
    expect(sanitizeQ("usb-c cable 100w")).toBe("usb-c cable 100w");
    expect(sanitizeQ("a/b & c")).toBe("a b c");
  });
});

describe("normalizeSearchItem", () => {
  it("maps a discounted item; compares on price, not memberPrice", () => {
    const p = normalizeSearchItem({
      id: "100478407", title: "Earbuds", price: 119, origPrice: 189, discount: 37.03, currency: "SAR",
      rating: 4.2, reviews: 7, image: "https://media.extra.com/a.jpg", url: URL1, memberPrice: 100,
    })!;
    expect(p.site).toBe("extra-sa");
    expect(p.id).toBe("100478407");
    expect(p.listPrice).toBe(119);
    expect(p.finalPrice).toBe(119);
    expect(p.origPrice).toBe(189);
    expect(p.discountPct).toBe(37);
    expect(p.rating).toBe(4.2);
    expect(p.currency).toBe("SAR");
    expect(p.url).toBe(URL1);
    expect(p.image).toBe("https://media.extra.com/a.jpg");
    expect(p.soldCount).toBe(0);
    expect(p.shipping).toBeNull();
    expect(p.detailStatus).toBe("ok");
  });
  it("origPrice <= price: no discount even if discount field says so; rating 0 -> null", () => {
    const p = normalizeSearchItem({ id: "1", price: 249, origPrice: 249, discount: 12, rating: 0, url: URL1 })!;
    expect(p.origPrice).toBeNull();
    expect(p.discountPct).toBeNull();
    expect(p.rating).toBeNull();
  });
  it("null without id, url or positive price; rejects non-extra url", () => {
    expect(normalizeSearchItem({ id: "1", price: 5 })).toBeNull();
    expect(normalizeSearchItem({ id: "1", price: 0, url: URL1 })).toBeNull();
    expect(normalizeSearchItem({ price: 5, url: URL1 })).toBeNull();
    expect(normalizeSearchItem({ id: "1", price: 5, url: "https://evil.com/en-sa/x" })).toBeNull();
    expect(normalizeSearchItem(undefined)).toBeNull();
  });
  it("fixture: >=10 normalize, no NaN, KSA url, SAR", () => {
    const items = (fixture as { data: unknown[] }).data;
    const ok = items.map(normalizeSearchItem).filter((p) => p !== null);
    expect(ok.length).toBeGreaterThanOrEqual(10);
    for (const p of ok) {
      for (const v of Object.values(p)) if (typeof v === "number") expect(Number.isNaN(v)).toBe(false);
      expect(p.url.startsWith("https://www.extra.com/en-sa/")).toBe(true);
      expect(p.currency).toBe("SAR");
    }
  });
});

describe("searchCalls", () => {
  it("budget: main p1, main price-asc p1, first variant p1 (max 3)", () => {
    const calls = searchCalls({ terms: "usb-c cable 100w", exclude: [] }, ["a/b & c", "zzz"]);
    expect(calls).toEqual([
      { op: "search", args: { q: "usb-c cable 100w", page: "1", sort: "score desc" } },
      { op: "search", args: { q: "usb-c cable 100w", page: "1", sort: "price asc" } },
      { op: "search", args: { q: "a b c", page: "1", sort: "score desc" } },
    ]);
  });
  it("skips empty terms", () => {
    expect(searchCalls({ terms: "¿¿", exclude: [] }, ["usb"])).toEqual([
      { op: "search", args: { q: "usb", page: "1", sort: "score desc" } },
    ]);
  });
});
