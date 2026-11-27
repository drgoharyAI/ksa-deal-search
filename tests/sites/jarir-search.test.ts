import { describe, it, expect } from "vitest";
import fixture from "../fixtures/jarir-search.json";
import { sanitizeQ, normalizeSearchItem, searchCalls } from "@/src/sites/jarir/search";

describe("sanitizeQ", () => {
  it("keeps only safe chars", () => {
    expect(sanitizeQ("usb-c cable 100w")).toBe("usb-c cable 100w");
    expect(sanitizeQ("a/b & c")).toBe("a b c");
  });
});

describe("normalizeSearchItem", () => {
  it("maps a discounted item", () => {
    const p = normalizeSearchItem({
      id: "682538",
      title: "TV",
      price: "1999",
      origPrice: 3999,
      saving: "2000.000000",
      image: "https://ak-asset.jarir.com/a.jpg",
      path: "/samsung-m1e-smart-tv-682538.html",
    })!;
    expect(p.site).toBe("jarir");
    expect(p.listPrice).toBe(1999);
    expect(p.origPrice).toBe(3999);
    expect(p.discountPct).toBe(50);
    expect(p.rating).toBeNull();
    expect(p.url).toBe("https://www.jarir.com/sa-en/samsung-m1e-smart-tv-682538.html");
    expect(p.currency).toBe("SAR");
    expect(p.detailStatus).toBe("ok");
  });
  it("origPrice == price means no discount", () => {
    const p = normalizeSearchItem({ id: "1", price: "25", origPrice: 25, path: "x.html" })!;
    expect(p.origPrice).toBeNull();
    expect(p.discountPct).toBeNull();
  });
  it("null without id or positive price", () => {
    expect(normalizeSearchItem({ id: "1", path: "x.html" })).toBeNull();
    expect(normalizeSearchItem({ id: "1", price: "0", path: "x.html" })).toBeNull();
    expect(normalizeSearchItem({ price: "5", path: "x.html" })).toBeNull();
    expect(normalizeSearchItem(undefined)).toBeNull();
  });
  it("fixture: >=10 normalize, no NaN, KSA url, SAR", () => {
    const items = (fixture as { data: unknown[] }).data;
    const ok = items.map(normalizeSearchItem).filter((p) => p !== null);
    expect(ok.length).toBeGreaterThanOrEqual(10);
    for (const p of ok) {
      for (const v of Object.values(p!)) {
        if (typeof v === "number") expect(Number.isNaN(v)).toBe(false);
      }
      expect(p!.url.startsWith("https://www.jarir.com/sa-en/")).toBe(true);
      expect(p!.currency).toBe("SAR");
      expect(p!.image.startsWith("https://")).toBe(true);
    }
  });
});

describe("searchCalls", () => {
  it("emits 3 calls per term", () => {
    const calls = searchCalls({ terms: "usb-c cable 100w", exclude: [] }, ["a/b & c"]);
    expect(calls).toHaveLength(6);
    expect(calls[0]).toEqual({
      op: "search",
      args: { q: "usb-c cable 100w", page: "1", sort_by: "relevance", sort_order: "descending" },
    });
    expect(calls[2]).toEqual({
      op: "search",
      args: { q: "usb-c cable 100w", page: "1", sort_by: "final_price", sort_order: "ascending" },
    });
    expect(calls[3].args.q).toBe("a b c");
  });
  it("skips empty terms", () => {
    expect(searchCalls({ terms: "¿¿", exclude: [] }, ["usb"])).toHaveLength(3);
  });
});
