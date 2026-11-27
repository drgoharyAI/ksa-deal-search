import { describe, it, expect } from "vitest";
import fixture from "../fixtures/trendyol-sa-search.json";
import { sanitizeQ, normalizeSearchItem, searchCalls } from "@/src/sites/trendyol-sa/search";

describe("sanitizeQ", () => {
  it("keeps only safe chars", () => {
    expect(sanitizeQ("usb-c cable 100w")).toBe("usb-c cable 100w");
    expect(sanitizeQ("a/b & c")).toBe("a b c");
  });
});

describe("normalizeSearchItem", () => {
  it("maps a discounted item", () => {
    const p = normalizeSearchItem({
      id: 875153539,
      title: "Phone",
      price: "4,179.05",
      origPrice: "4,399",
      discount: "-5%",
      priceNum: 4179.05,
      listPrice: 4399,
      rating: 4.57,
      image: "https://cdn.dsmcdn.com/a.jpg",
      path: "/en/apple/phone-p-875153539?boutiqueId=61&merchantId=1",
    })!;
    expect(p.site).toBe("trendyol-sa");
    expect(p.id).toBe("875153539");
    expect(p.listPrice).toBe(4179.05);
    expect(p.finalPrice).toBe(4179.05);
    expect(p.origPrice).toBe(4399);
    expect(p.discountPct).toBe(5);
    expect(p.rating).toBe(4.57);
    expect(p.url).toBe("https://www.trendyol.sa/en/apple/phone-p-875153539?boutiqueId=61&merchantId=1");
    expect(p.currency).toBe("SAR");
    expect(p.soldCount).toBe(0);
    expect(p.shipping).toBeNull();
    expect(p.detailStatus).toBe("ok");
  });
  it("parses comma price string when priceNum missing; unrated -> null rating", () => {
    const p = normalizeSearchItem({ id: 1, price: "1,299.50", path: "en/x" })!;
    expect(p.listPrice).toBe(1299.5);
    expect(p.rating).toBeNull();
    expect(p.origPrice).toBeNull();
    expect(p.discountPct).toBeNull();
    expect(p.url).toBe("https://www.trendyol.sa/en/x");
  });
  it("origPrice <= price means no discount; ignores disagreeing discount string", () => {
    const p = normalizeSearchItem({ id: 1, price: "25", priceNum: 25, origPrice: "25", discount: "-5%", path: "/en/x" })!;
    expect(p.origPrice).toBeNull();
    expect(p.discountPct).toBeNull();
  });
  it("computes discountPct from parsed prices", () => {
    const p = normalizeSearchItem({ id: 1, priceNum: 50, origPrice: "1,000", discount: "-5%", path: "/en/x" })!;
    expect(p.origPrice).toBe(1000);
    expect(p.discountPct).toBe(95);
  });
  it("null product without path", () => {
    expect(normalizeSearchItem({ id: 1, priceNum: 5 })).toBeNull();
    expect(normalizeSearchItem({ id: 1, priceNum: 5, path: "" })).toBeNull();
  });
  it("null without id or positive price", () => {
    expect(normalizeSearchItem({ id: 1, path: "/en/x" })).toBeNull();
    expect(normalizeSearchItem({ id: 1, priceNum: 0, path: "/en/x" })).toBeNull();
    expect(normalizeSearchItem({ priceNum: 5, path: "/en/x" })).toBeNull();
    expect(normalizeSearchItem(undefined)).toBeNull();
  });
  it("fixture: >=10 normalize, no NaN, KSA url, SAR", () => {
    const items = (fixture as { data: unknown[] }).data;
    const ok = items.map(normalizeSearchItem).filter((p) => p !== null);
    expect(ok.length).toBeGreaterThanOrEqual(10);
    for (const p of ok) {
      for (const v of Object.values(p)) {
        if (typeof v === "number") expect(Number.isNaN(v)).toBe(false);
      }
      expect(p.url.startsWith("https://www.trendyol.sa/en/")).toBe(true);
      expect(p.currency).toBe("SAR");
      expect(p.image.startsWith("https://")).toBe(true);
    }
  });
});

describe("searchCalls", () => {
  it("budget: main p1, main price-asc p1, first variant p1 (max 3)", () => {
    const calls = searchCalls({ terms: "usb-c cable 100w", exclude: [] }, ["a/b & c", "zzz"]);
    expect(calls).toEqual([
      { op: "search", args: { q: "usb-c cable 100w", page: "1", sort: "SCORE" } },
      { op: "search", args: { q: "usb-c cable 100w", page: "1", sort: "PRICE_BY_ASC" } },
      { op: "search", args: { q: "a b c", page: "1", sort: "SCORE" } },
    ]);
  });
  it("skips empty terms", () => {
    expect(searchCalls({ terms: "¿¿", exclude: [] }, ["usb"])).toEqual([
      { op: "search", args: { q: "usb", page: "1", sort: "SCORE" } },
    ]);
  });
});
