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
  it("no product path: null, never a link to the Jarir home page (final review M6)", () => {
    expect(normalizeSearchItem({ id: "1", title: "TV", price: "1999", path: "" })).toBeNull();
    expect(normalizeSearchItem({ id: "1", title: "TV", price: "1999", path: "/" })).toBeNull();
    expect(normalizeSearchItem({ id: "1", title: "TV", price: "1999" })).toBeNull();
  });
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
      for (const v of Object.values(p)) {
        if (typeof v === "number") expect(Number.isNaN(v)).toBe(false);
      }
      expect(p.url.startsWith("https://www.jarir.com/sa-en/")).toBe(true);
      expect(p.currency).toBe("SAR");
      expect(p.image.startsWith("https://")).toBe(true);
    }
  });
});

describe("searchCalls", () => {
  it("budget: main p1, main price-asc p1, first variant p1 (max 3)", () => {
    const calls = searchCalls({ terms: "usb-c cable 100w", exclude: [] }, ["a/b & c", "zzz"]);
    expect(calls).toEqual([
      {
        op: "search",
        args: { q: "usb-c cable 100w", page: "1", sort_by: "relevance", sort_order: "descending" },
      },
      {
        op: "search",
        args: { q: "usb-c cable 100w", page: "1", sort_by: "final_price", sort_order: "ascending" },
      },
      { op: "search", args: { q: "a b c", page: "1", sort_by: "relevance", sort_order: "descending" } },
    ]);
  });
  it("skips empty terms", () => {
    const calls = searchCalls({ terms: "¿¿", exclude: [] }, ["usb"]);
    expect(calls).toHaveLength(1);
    expect(calls[0].args.q).toBe("usb");
  });
});
