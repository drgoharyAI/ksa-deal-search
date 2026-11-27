import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ResultTiers from "@/app/components/ResultTiers";
import type { Product } from "@/src/lib/types";

const P = (id: string, o: Partial<Product> = {}): Product => ({
  site: "aliexpress", id, title: `Item ${id}`, listPrice: 10, origPrice: null, discountPct: null, currency: "SAR",
  rating: null, soldCount: 0, image: "", url: "https://example.com", detailStatus: "ok", ...o,
});

const html = (products: Product[]) => renderToStaticMarkup(createElement(ResultTiers, { products }));
const count = (s: string, needle: string) => s.split(needle).length - 1;

describe("ResultTiers (12f)", () => {
  it("puts a 'Less likely matches' divider between the tiers and labels the doubtful cards", () => {
    const out = html([P("a", { matchScore: 0.9 }), P("b"), P("c", { matchScore: 0.1 }), P("d", { weakMatch: true })]);
    expect(count(out, "Less likely matches")).toBe(1);
    expect(count(out, "Less likely match<")).toBe(2);
    expect(count(out, 'class="grid"')).toBe(2);
    expect(out.indexOf("Item b")).toBeLessThan(out.indexOf("Less likely matches"));
    expect(out.indexOf("Item c")).toBeGreaterThan(out.indexOf("Less likely matches"));
  });
  it("no divider when every result is a confident match", () => {
    const out = html([P("a", { matchScore: 0.9 }), P("b")]);
    expect(out).not.toContain("Less likely");
    expect(count(out, 'class="grid"')).toBe(1);
  });
});
