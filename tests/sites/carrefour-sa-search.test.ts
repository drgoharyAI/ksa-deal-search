import { describe, it, expect } from "vitest";
import fixture from "../fixtures/carrefour-sa-search.json";
import { sanitizeQ, normalizeSearchItem, searchCalls } from "@/src/sites/carrefour-sa/search";

const U = "https://www.carrefourksa.com/mafsau/en/microwave/samsung-ms32/p/739302?offer=offer_carrefour_&sid=EXPRESS&sellerId=0000";

describe("sanitizeQ", () => {
  it("keeps only safe chars", () => {
    expect(sanitizeQ("a/b & c")).toBe("a b c");
  });
});

describe("normalizeSearchItem", () => {
  it("maps a discounted item with comma strings", () => {
    const p = normalizeSearchItem({ title: "Samsung Microwave", price: "599.00", orig: "1,239.00", disc: "52% OFF", url: U })!;
    expect(p.site).toBe("carrefour-sa");
    expect(p.id).toBe("739302");
    expect(p.listPrice).toBe(599);
    expect(p.finalPrice).toBe(599);
    expect(p.origPrice).toBe(1239);
    expect(p.discountPct).toBe(52);
    expect(p.currency).toBe("SAR");
    expect(p.rating).toBeNull();
    expect(p.image).toBe("");
    expect(p.url).toBe(U);
    expect(p.soldCount).toBe(0);
    expect(p.shipping).toBeNull();
    expect(p.detailStatus).toBe("ok");
  });
  it("parses thousands comma price; no orig -> no discount", () => {
    const p = normalizeSearchItem({ title: "x", price: "2,549.00", url: U })!;
    expect(p.listPrice).toBe(2549);
    expect(p.origPrice).toBeNull();
    expect(p.discountPct).toBeNull();
  });
  it("reads the 'SAR 2,549' card form (task 18, Task 15a minor)", () => {
    const p = normalizeSearchItem({ title: "Microwave", price: "SAR 2,549", orig: "SAR 2,999.00", url: U })!;
    expect(p.listPrice).toBe(2549);
    expect(p.origPrice).toBe(2999);
    expect(normalizeSearchItem({ title: "x", price: "SAR", url: U })).toBeNull();
  });
  it("orig <= price means no discount", () => {
    const p = normalizeSearchItem({ title: "x", price: "10.00", orig: "10.00", disc: "5% OFF", url: U })!;
    expect(p.origPrice).toBeNull();
    expect(p.discountPct).toBeNull();
  });
  it("null without /p/<id>, bad host, or positive price", () => {
    expect(normalizeSearchItem({ price: "5", url: "https://www.carrefourksa.com/mafsau/en/x" })).toBeNull();
    expect(normalizeSearchItem({ price: "5", url: "https://evil.com/mafsau/en/a/p/1" })).toBeNull();
    expect(normalizeSearchItem({ price: "0.00", url: U })).toBeNull();
    expect(normalizeSearchItem({ title: "x", url: U })).toBeNull();
    expect(normalizeSearchItem(undefined)).toBeNull();
  });
  it("fixture: >=10 normalize, no NaN, KSA url, SAR", () => {
    const items = (fixture as { data: unknown[] }).data;
    const ok = items.map(normalizeSearchItem).filter((p) => p !== null);
    expect(ok.length).toBeGreaterThanOrEqual(10);
    for (const p of ok) {
      for (const v of Object.values(p)) if (typeof v === "number") expect(Number.isNaN(v)).toBe(false);
      expect(p.url.startsWith("https://www.carrefourksa.com/mafsau/en/")).toBe(true);
      expect(p.currency).toBe("SAR");
    }
  });
});

describe("searchCalls", () => {
  it("budget: main p0, main price_asc p0, first variant p0 (max 3)", () => {
    const calls = searchCalls({ terms: "milk", exclude: [] }, ["a/b & c", "zzz"]);
    expect(calls).toEqual([
      { op: "search", args: { q: "milk", page: "0", sort: "relevance" } },
      { op: "search", args: { q: "milk", page: "0", sort: "price_asc" } },
      { op: "search", args: { q: "a b c", page: "0", sort: "relevance" } },
    ]);
  });
  it("skips empty terms", () => {
    expect(searchCalls({ terms: "¿¿", exclude: [] }, ["usb"])).toEqual([
      { op: "search", args: { q: "usb", page: "0", sort: "relevance" } },
    ]);
  });
});
