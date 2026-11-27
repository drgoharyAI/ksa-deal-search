import { describe, it, expect } from "vitest";
import { parseQuery } from "@/src/lib/query/parse";
import { expandTerms } from "@/src/lib/query/synonyms";
import { matchTerms } from "@/src/lib/query/filler";
import { tokenizeKeepDigits } from "@/src/lib/match/tokenize";
import { matchesAllTokens } from "@/src/lib/match/relevance";

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

describe("parseQuery edge cases", () => {
  it("does not read 'above 4.5 stars' as a price", () => {
    const pq = parseQuery("earbuds above 4.5 stars");
    expect(pq.minRating).toBe(4.5);
    expect(pq.minPrice).toBeUndefined();
    expect(pq.terms).toBe("earbuds");
  });

  it("leaves unit-suffixed numbers in terms", () => {
    const a = parseQuery("usb-c cable under 2m");
    expect(a.maxPrice).toBeUndefined();
    expect(a.terms).toBe("usb-c cable under 2m");
    const b = parseQuery("charger over 20w");
    expect(b.minPrice).toBeUndefined();
    expect(b.terms).toBe("charger over 20w");
  });

  it("strips currency words and symbols", () => {
    expect(parseQuery("earbuds under 50 sar")).toMatchObject({ terms: "earbuds", maxPrice: 50 });
    expect(parseQuery("earbuds under $50")).toMatchObject({ terms: "earbuds", maxPrice: 50 });
  });

  it("allows a price-only query", () => {
    expect(parseQuery("under 50")).toMatchObject({ terms: "", maxPrice: 50 });
  });
});

describe("parseQuery reversed range (final review M3)", () => {
  it("swaps a range typed high-low", () => {
    const pq = parseQuery("earbuds 300-50");
    expect([pq.minPrice, pq.maxPrice]).toEqual([50, 300]);
    expect(pq.terms).toBe("earbuds");
  });
  it("keeps a range typed low-high", () => {
    expect(parseQuery("earbuds 50-300")).toMatchObject({ minPrice: 50, maxPrice: 300 });
  });
});

describe("matchTerms: filler words are not required title words (final review I1)", () => {
  it("drops intent and filler words", () => {
    expect(matchTerms("best wireless earbuds")).toBe("wireless earbuds");
    expect(matchTerms("cheap new jbl speaker")).toBe("jbl speaker");
    expect(matchTerms("buy the original apple watch")).toBe("apple watch");
    expect(matchTerms("usb-c to lightning cable")).toBe("usb-c lightning cable");
  });
  it("'X for Y' / 'X with Y' reads as 'Y X' so X stays the head noun", () => {
    expect(matchTerms("earbuds for running")).toBe("running earbuds");
    expect(matchTerms("case for iphone 16")).toBe("iphone 16 case");
    expect(matchTerms("best earbuds with mic")).toBe("mic earbuds");
  });
  it("keeps model qualifiers and numbers", () => {
    expect(matchTerms("iphone 16 pro max")).toBe("iphone 16 pro max");
    expect(matchTerms("3 in 1 charger")).toBe("3 in 1 charger");
    expect(matchTerms("macbook air m3")).toBe("macbook air m3");
    expect(matchTerms("new balance running shoes")).toBe("new balance running shoes");
  });
  it("never empties the query", () => {
    expect(matchTerms("the best")).toBe("the best");
    expect(matchTerms("for")).toBe("for");
  });
  it("filler queries now match real titles", () => {
    const tok = (q: string) => [tokenizeKeepDigits(matchTerms(q))];
    expect(matchesAllTokens(tok("earbuds for running"), "Sports Wireless Earbuds Running Headphones IPX7")).toBe(true);
    expect(matchesAllTokens(tok("best wireless earbuds"), "Wireless Earbuds Bluetooth 5.3")).toBe(true);
    expect(matchesAllTokens(tok("best wireless earbuds"), "Wireless Mouse Bluetooth")).toBe(false);
  });
});
