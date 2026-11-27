import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ResultTiers, { RESULTS_STEP } from "@/app/components/ResultTiers";
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
  it("draws the first RESULTS_STEP cards, then offers the rest (scroll or a button)", () => {
    const many = Array.from({ length: RESULTS_STEP + 5 }, (_, i) => P(`m${i}`, { matchScore: 0.9 }));
    const out = html(many);
    expect(count(out, "<article")).toBe(RESULTS_STEP);
    expect(out).toContain("Show more results");
    expect(out).toContain(", 5 not shown yet");
    const few = html(many.slice(0, RESULTS_STEP));
    expect(few).not.toContain("Show more results");
  });
  it("the less likely divider waits until its tier is drawn", () => {
    const many = [...Array.from({ length: RESULTS_STEP }, (_, i) => P(`m${i}`, { matchScore: 0.9 })), P("doubt", { weakMatch: true })];
    const out = html(many);
    expect(out).not.toContain("Less likely matches");
    expect(out).toContain(", 1 not shown yet");
  });
});
