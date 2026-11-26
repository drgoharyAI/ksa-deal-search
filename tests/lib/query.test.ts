import { describe, it, expect } from "vitest";
import { parseQuery } from "@/src/lib/query/parse";
import { expandTerms } from "@/src/lib/query/synonyms";

describe("parseQuery", () => {
  it("parses 'under N'", () => {
    expect(parseQuery("anc earbuds under 50")).toEqual({
      terms: "anc earbuds",
      maxPrice: 50,
      exclude: [],
    });
  });

  it("parses range, rating and exclude", () => {
    expect(parseQuery("keyboard 100-250 >4.5 stars -wired")).toEqual({
      terms: "keyboard",
      minPrice: 100,
      maxPrice: 250,
      minRating: 4.5,
      exclude: ["wired"],
    });
  });

  it("parses <N and ignores hyphen inside a word", () => {
    expect(parseQuery("<30 usb-c cable")).toEqual({
      terms: "usb-c cable",
      maxPrice: 30,
      exclude: [],
    });
  });

  it("parses 'over N' as minPrice", () => {
    const pq = parseQuery("over 20 power bank");
    expect(pq.minPrice).toBe(20);
    expect(pq.terms).toBe("power bank");
  });

  it("parses 'N+ stars'", () => {
    const pq = parseQuery("mouse 4+ stars");
    expect(pq.minRating).toBe(4);
    expect(pq.terms).toBe("mouse");
  });

  it("returns empty terms for blank input", () => {
    expect(parseQuery("   ").terms).toBe("");
  });
});

describe("expandTerms", () => {
  it("expands synonyms, max 2, no duplicates of input", () => {
    const out = expandTerms("anc earbuds");
    expect(out).toContain("noise cancelling earbuds");
    expect(out.length).toBeLessThanOrEqual(2);
    expect(out).not.toContain("anc earbuds");
    expect(new Set(out).size).toBe(out.length);
  });

  it("returns [] when nothing matches", () => {
    expect(expandTerms("laptop stand")).toEqual([]);
  });

  it("prefers longest match", () => {
    expect(expandTerms("wireless earphones", 5)).not.toContain("wireless wireless earphones");
  });
});
