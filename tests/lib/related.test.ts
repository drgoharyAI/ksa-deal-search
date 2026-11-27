import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { RELATED_LIMIT, relatedListings } from "@/src/lib/match/related";
import CardDetails, { DetailsBody, DetailsContext, detailRows, type DetailsSource } from "@/app/components/CardDetails";
import type { Product } from "@/src/lib/types";

const P = (site: string, id: string, title: string, price: number, o: Partial<Product> = {}): Product => ({
  site, id, title, listPrice: price, origPrice: null, discountPct: null, currency: "SAR", rating: null, soldCount: 0,
  image: "", url: `https://shop.example/${id}`, detailStatus: "ok", ...o,
});

const target = P("noon-sa", "N1", "JBL Flip 6 Portable Bluetooth Speaker Black", 399);
const pool = [
  target,
  P("jarir", "J1", "JBL Flip 6 Portable Waterproof Speaker - Blue", 429),
  P("amazon-sa", "A1", "JBL Flip 5 Bluetooth Speaker", 299),
  P("extra-sa", "X1", "Hard Case for JBL Flip 6 Speaker", 59),
  P("noon-sa", "N2", "Sony SRS-XB13 Bluetooth Speaker", 199),
  P("jarir", "J2", "Apple iPhone 15 128GB", 3299),
  // The same title twice at one store: offered once.
  P("amazon-sa", "A2", "JBL Flip 5 Bluetooth Speaker", 310),
];
const keys = (ps: Product[]) => ps.map((p) => `${p.site}+${p.id}`);

describe("related products: from the current result set only", () => {
  it("offers close listings, closest first, never the product itself", () => {
    expect(keys(relatedListings(target, pool))).toEqual(["jarir+J1", "amazon-sa+A1"]);
  });
  it("never offers an accessory for an item, another known brand, or an unrelated product", () => {
    const out = keys(relatedListings(target, pool));
    expect(out).not.toContain("extra-sa+X1");
    expect(out).not.toContain("noon-sa+N2");
    expect(out).not.toContain("jarir+J2");
  });
  it("puts the same product at another store first (shared model code)", () => {
    const sony = P("noon-sa", "S1", "Sony WH-1000XM5 Wireless Noise Cancelling Headphones Black", 1299);
    const out = relatedListings(sony, [
      sony,
      P("jarir", "S2", "Sony WH-1000XM4 Wireless Noise Cancelling Headphones Black", 899),
      P("amazon-sa", "S3", "Sony WH-1000XM5 Headphones, Silver", 1349),
    ]);
    expect(keys(out)[0]).toBe("amazon-sa+S3");
  });
  it("leaves out the card's own group rows, and caps the list", () => {
    expect(keys(relatedListings(target, pool, { exclude: new Set(["jarir+J1"]) }))).toEqual(["amazon-sa+A1"]);
    const many = Array.from({ length: 10 }, (_, i) => P("amazon-sa", `F${i}`, `JBL Flip 6 Portable Bluetooth Speaker Black edition ${i}`, 400 + i));
    expect(relatedListings(target, [target, ...many])).toHaveLength(RELATED_LIMIT);
    expect(relatedListings(target, [target, ...many], { limit: 2 })).toHaveLength(2);
  });
  it("is empty when nothing is like it (the section then hides)", () => {
    expect(relatedListings(target, [target, pool[5]])).toEqual([]);
  });
});

describe("card details disclosure", () => {
  const source = (related: Product[]): DetailsSource => ({ related: () => related, brand: () => "jbl" });
  const render = (p: Product, related: Product[] = []) =>
    renderToStaticMarkup(createElement(DetailsContext, { value: source(related) }, createElement(CardDetails, { product: p })));
  it("is a button with aria-expanded and aria-controls naming the panel, closed at first", () => {
    const out = render(target);
    const id = /aria-controls="([^"]+)"/.exec(out)?.[1];
    expect(out).toContain('aria-expanded="false"');
    expect(id).toBeTruthy();
    expect(out).toContain(`id="${id}" class="details__panel" hidden=""`);
    expect(out).toContain("Details<span class=\"visually-hidden\"> for JBL Flip 6");
  });
  it("lists the brand and only the specs the title states", () => {
    expect(detailRows(P("jarir", "J9", "Samsung Galaxy S24 Ultra 12GB RAM 256GB 6.8 inch", 4999), "samsung")).toEqual([
      { label: "Brand", value: "Samsung" },
      { label: "Storage", value: "256 GB" },
      { label: "RAM", value: "12 GB" },
      { label: "Screen or size", value: "6.8 in" },
    ]);
    expect(detailRows(P("jarir", "J9", "Kettle", 99))).toEqual([]);
  });
  it("open: full title, specs, price history or its absence, the store link, and related only when there are some", () => {
    const body = (p: Product, related: Product[]) => renderToStaticMarkup(createElement(DetailsBody, { p, source: source(related) }));
    const none = body(target, []);
    expect(none).toContain("Full title");
    expect(none).toContain("JBL Flip 6 Portable Bluetooth Speaker Black");
    expect(none).toContain("<dt>Brand</dt><dd>JBL</dd>");
    expect(none).toContain("No price history yet");
    expect(none).toContain('href="https://shop.example/N1"');
    expect(none).toContain("View on noon KSA");
    expect(none).not.toContain("Other listings like this");
    const withHistory = body({ ...target, trend: { points: [{ day: 0, price: 450 }, { day: 29, price: 399 }], changePct7d: -5 }, deal: { badge: "lowest-30d", label: "Lowest in 30 days" } }, [pool[2]]);
    expect(withHistory).not.toContain("No price history yet");
    expect(withHistory).toContain("Lowest in 30 days");
    expect(withHistory).toContain("<svg");
    expect(withHistory).toContain("Other listings like this");
    expect(withHistory).toContain("JBL Flip 5 Bluetooth Speaker");
    expect(withHistory).toContain("SAR 299");
  });
});
