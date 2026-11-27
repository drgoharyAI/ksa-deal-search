import { describe, it, expect } from "vitest";
import fixture from "../fixtures/amazon-sa-search.json";
import { sanitizeQ, normalizeSearchItem, searchCalls } from "@/src/sites/amazon-sa/search";

describe("sanitizeQ", () => {
  it("keeps only safe chars", () => {
    expect(sanitizeQ("usb-c cable 100w")).toBe("usb-c cable 100w");
    expect(sanitizeQ("a/b & c")).toBe("a b c");
    expect(sanitizeQ("¿¿")).toBe("");
  });
});

describe("normalizeSearchItem", () => {
  it("maps a discounted item", () => {
    const p = normalizeSearchItem({
      id: "B1",
      title: "T",
      price: "SAR 1,234.50",
      origPrice: "SAR 2,469.00",
      rating: "4.6 out of 5 stars",
      reviews: "3,714 ratings",
      image: "https://m.media-amazon.com/x.jpg",
    })!;
    expect(p.site).toBe("amazon-sa");
    expect(p.listPrice).toBe(1234.5);
    expect(p.origPrice).toBe(2469);
    expect(p.discountPct).toBe(50);
    expect(p.rating).toBe(4.6);
    expect(p.url).toBe("https://www.amazon.sa/dp/B1");
    expect(p.currency).toBe("SAR");
    expect(p.finalPrice).toBe(1234.5);
    expect(p.shipping).toBeNull();
    expect(p.soldCount).toBe(0);
    expect(p.detailStatus).toBe("ok");
  });
  it("origPrice only when > price", () => {
    const p = normalizeSearchItem({ id: "B1", price: "SAR 10.00", origPrice: "SAR 10.00" })!;
    expect(p.origPrice).toBeNull();
    expect(p.discountPct).toBeNull();
  });
  it("null without id or positive price", () => {
    expect(normalizeSearchItem({ id: "B1", title: "X" })).toBeNull();
    expect(normalizeSearchItem({ id: "B1", price: "SAR 0.00" })).toBeNull();
    expect(normalizeSearchItem({ price: "SAR 5.00" })).toBeNull();
    expect(normalizeSearchItem(null)).toBeNull();
  });
  it("fixture: >=10 normalize, no NaN, KSA url, SAR", () => {
    const items = (fixture as { data: unknown[] }).data;
    const ok = items.map(normalizeSearchItem).filter((p) => p !== null);
    expect(ok.length).toBeGreaterThanOrEqual(10);
    for (const p of ok) {
      for (const v of Object.values(p!)) {
        if (typeof v === "number") expect(Number.isNaN(v)).toBe(false);
      }
      expect(p!.url.startsWith("https://www.amazon.sa/dp/")).toBe(true);
      expect(p!.currency).toBe("SAR");
      expect(p!.image === "" || p!.image.startsWith("https://")).toBe(true);
    }
  });
});

describe("searchCalls", () => {
  it("budget: main p1 + p2, first variant p1 only (max 3, no sort)", () => {
    const calls = searchCalls({ terms: "usb-c cable 100w", exclude: [] }, ["a/b & c", "zzz"]);
    expect(calls).toEqual([
      { op: "search", args: { q: "usb-c cable 100w", page: "1" } },
      { op: "search", args: { q: "usb-c cable 100w", page: "2" } },
      { op: "search", args: { q: "a b c", page: "1" } },
    ]);
  });
  it("skips empty terms", () => {
    expect(searchCalls({ terms: "¿¿", exclude: [] }, ["usb"])).toEqual([
      { op: "search", args: { q: "usb", page: "1" } },
    ]);
  });
});
