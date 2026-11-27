import { describe, it, expect } from "vitest";
import fixture from "../fixtures/saco-sa-search.json";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { classify } from "api-anything";
import type { Operation } from "api-anything";
import spec from "../../api-specs/saco-sa.json";
import { availabilityOf, isNoResults, normalizeSearchItem, sanitizeQ, searchCalls } from "@/src/sites/saco-sa/search";

const SKU = "000000000000103346";
const URL1 = `https://www.saco.sa/en/product/black-decker-1800w-air-fryer-af7210-b5-p-${SKU}`;
const card = (over: Record<string, unknown> = {}) => ({
  id: SKU,
  title: "Black+Decker 1800W 8-In-1 Digital Air Fryer 7.2 Liter AF7210-B5",
  price: "249",
  currency: "SAR",
  orig: "399",
  url: URL1,
  image: "https://img.saco.sa/media//catalog/product/w/e/webimage-103346-1.jpg?width=300&format=webp",
  rating: "--rating:4",
  stock: "In stock",
  cart: "Add to cart",
  ...over,
});

describe("sanitizeQ", () => {
  it("keeps only safe chars", () => {
    expect(sanitizeQ("cordless drill 18v")).toBe("cordless drill 18v");
    expect(sanitizeQ("a/b & c")).toBe("a b c");
  });
});

describe("normalizeSearchItem", () => {
  it("maps a discounted card", () => {
    const p = normalizeSearchItem(card())!;
    expect(p).toMatchObject({
      site: "saco-sa",
      id: "103346",
      title: "Black+Decker 1800W 8-In-1 Digital Air Fryer 7.2 Liter AF7210-B5",
      listPrice: 249,
      finalPrice: 249,
      origPrice: 399,
      discountPct: 38,
      currency: "SAR",
      rating: 4,
      soldCount: 0,
      inStock: true,
      url: URL1,
      shipping: null,
      detailStatus: "ok",
    });
    expect(p.image.startsWith("https://img.saco.sa/")).toBe(true);
  });
  it("comma prices; orig not above price -> no discount; rating 0 -> null", () => {
    const p = normalizeSearchItem(card({ price: "1,159", orig: "1,159", rating: "--rating:0" }))!;
    expect(p.listPrice).toBe(1159);
    expect(p.origPrice).toBeNull();
    expect(p.discountPct).toBeNull();
    expect(p.rating).toBeNull();
  });
  it("drops the url's query string", () => {
    expect(normalizeSearchItem(card({ url: `${URL1}?x=1` }))?.url).toBe(URL1);
  });
  it("null without a positive price, a numeric SKU, a matching KSA product url or a title", () => {
    expect(normalizeSearchItem(card({ price: "0" }))).toBeNull();
    expect(normalizeSearchItem(card({ price: "" }))).toBeNull();
    expect(normalizeSearchItem(card({ id: "" }))).toBeNull();
    expect(normalizeSearchItem(card({ id: "abc" }))).toBeNull();
    expect(normalizeSearchItem(card({ url: "https://www.saco.sa/ar/product/x-p-000000000000103346" }))).toBeNull();
    expect(normalizeSearchItem(card({ url: "https://evil.example/en/product/x-p-000000000000103346" }))).toBeNull();
    expect(normalizeSearchItem(card({ url: "https://www.saco.sa/en/product/x-p-000000000000999999" }))).toBeNull();
    expect(normalizeSearchItem(card({ title: " " }))).toBeNull();
    expect(normalizeSearchItem(null)).toBeNull();
  });
  it("another currency than SAR is not used", () => {
    expect(normalizeSearchItem(card({ currency: "USD" }))).toBeNull();
  });
  it("a non-https image is dropped", () => {
    expect(normalizeSearchItem(card({ image: "/statics/x.png" }))?.image).toBe("");
  });
});

describe("availabilityOf (SACO card badge + cart button), explicit signals only", () => {
  it("In stock and Limited stock with Add to cart are in stock", () => {
    expect(availabilityOf("In stock", "Add to cart")).toBe("in-stock");
    expect(availabilityOf("Limited stock", "Add to cart")).toBe("in-stock");
    expect(normalizeSearchItem(card())).toMatchObject({ inStock: true });
    expect(normalizeSearchItem(card())).not.toHaveProperty("pickupOnly");
  });
  it("Click and pick (badge Out of stock, or none) is branch pickup only: kept, not out of stock", () => {
    expect(availabilityOf("Out of stock", "Click and pick")).toBe("pickup-only");
    expect(availabilityOf(undefined, "Click and pick")).toBe("pickup-only");
    const p = normalizeSearchItem(card({ stock: "Out of stock", cart: "Click and pick" }))!;
    expect(p.pickupOnly).toBe(true);
    expect(p).not.toHaveProperty("inStock");
  });
  it("anything else is unknown: Out of stock with no button or Add to cart, a contradiction, no badge", () => {
    expect(availabilityOf("Out of stock", undefined)).toBeUndefined();
    expect(availabilityOf("Out of stock", "Add to cart")).toBeUndefined();
    expect(availabilityOf("In stock", "Click and pick")).toBeUndefined();
    expect(availabilityOf(undefined, "Add to cart")).toBeUndefined();
    expect(availabilityOf("Ships in 3 days", undefined)).toBeUndefined();
    for (const over of [{ stock: undefined }, { stock: "Out of stock", cart: undefined }]) {
      const p = normalizeSearchItem(card(over))!;
      expect(p).not.toHaveProperty("inStock");
      expect(p).not.toHaveProperty("pickupOnly");
    }
  });
});

describe("SKUs", () => {
  it("accepts a lettered SKU; its product url ends with it lower-cased; the id keeps it whole", () => {
    const p = normalizeSearchItem(
      card({ id: "S0000002030", title: "Homix 2600W Automatic Electronic Garment Steam Press White", url: "https://www.saco.sa/en/product/homix-2600w-automatic-electronic-garment-steam-press-white-p-s0000002030" }),
    );
    expect(p?.id).toBe("S0000002030");
  });
  it("still rejects a SKU with other characters, or a url for another SKU", () => {
    expect(normalizeSearchItem(card({ id: "S-1", url: "https://www.saco.sa/en/product/x-p-s-1" }))).toBeNull();
    expect(normalizeSearchItem(card({ id: "S0000002030", url: "https://www.saco.sa/en/product/x-p-s0000002031" }))).toBeNull();
  });
});

describe("fixture (live call saco-sa search q=air fryer, 2026-11-27)", () => {
  it(">= 40 cards normalize: SAR, KSA English product urls, no NaN, ids unique", () => {
    const ps = (fixture as { data: unknown[] }).data.map(normalizeSearchItem).filter((p) => p !== null);
    expect(ps.length).toBeGreaterThanOrEqual(40);
    for (const p of ps) {
      expect(p.currency).toBe("SAR");
      expect(p.url.startsWith("https://www.saco.sa/en/product/")).toBe(true);
      for (const v of [p.listPrice, p.origPrice, p.discountPct, p.rating]) if (v !== null) expect(Number.isNaN(v)).toBe(false);
    }
    expect(new Set(ps.map((p) => p.id)).size).toBe(ps.length);
  });
});

describe("searchCalls", () => {
  it("budget: best match and lowest price for the main term (2 calls, no variant)", () => {
    expect(searchCalls({ terms: "cordless drill", exclude: [] }, ["drill driver"])).toEqual([
      { op: "search", args: { q: "cordless drill", sort: "custom-position", dir: "DESC" } },
      { op: "search", args: { q: "cordless drill", sort: "price", dir: "ASC" } },
    ]);
  });
  it("skips empty terms", () => {
    expect(searchCalls({ terms: "¿¿", exclude: [] }, ["drill"])).toEqual([]);
  });
});

describe("no-results page (live answer for q=zxqvbnmplk, 2026-11-27)", () => {
  const body = readFileSync(join(process.cwd(), "tests/fixtures/saco-sa-empty.html"), "utf8");
  const op = (spec as unknown as { operations: Operation[] }).operations[0];
  const observed = { status: 200, headers: { "content-type": "text/html; charset=utf-8" }, body, url: "https://www.saco.sa/en/products-search?q=zxqvbnmplk" };
  it("the recipe reads it as ok (the page's sign-in strings would otherwise make it auth, and no item drift)", () => {
    expect(classify(op, observed).class).toBe("ok");
    const bare = structuredClone(op);
    bare.response.html!.items = bare.response.html!.items.split(", div:has")[0];
    expect(classify(bare, observed).class).not.toBe("ok");
  });
  it("its only item is the No results marker, which the pipeline skips: an empty answer", () => {
    expect(isNoResults({ noResults: "No results found!" })).toBe(true);
    expect(isNoResults(card())).toBe(false);
    expect(isNoResults({ noResults: "", id: "1" })).toBe(false);
    expect(normalizeSearchItem({ noResults: "No results found!" })).toBeNull();
  });
});
