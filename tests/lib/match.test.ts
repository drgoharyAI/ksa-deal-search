import { describe, it, expect } from "vitest";
import { tokenize } from "@/src/lib/match/tokenize";
import { scoreRelevance, filterRelevant } from "@/src/lib/match/relevance";
import { isAccessory } from "@/src/lib/match/accessory";
import { dedupe } from "@/src/lib/match/dedupe";
import type { Product } from "@/src/lib/types";

const prod = (title: string, listPrice = 10, id = title): Product => ({
  site: "x",
  id,
  title,
  listPrice,
  origPrice: null,
  discountPct: null,
  currency: "SAR",
  rating: null,
  soldCount: 0,
  image: "",
  url: "",
  detailStatus: "ok",
});

describe("tokenize", () => {
  it("lowercases, keeps hyphenated tokens, drops 1-char tokens", () => {
    expect(tokenize("USB-C Cable, 2 m & a WH-1000XM4!")).toEqual([
      "usb-c",
      "cable",
      "wh-1000xm4",
    ]);
  });
});

describe("scoreRelevance", () => {
  it("scores a full match 1 and a non-match 0", () => {
    expect(scoreRelevance([["anc", "earbuds"]], "Baseus EP10 Pro ANC Earbuds")).toBe(1);
    expect(scoreRelevance([["anc", "earbuds"]], "Garden hose")).toBe(0);
  });
  it("uses the best variant", () => {
    const v = [
      ["anc", "earbuds"],
      ["noise", "cancelling", "earbuds"],
      ["noise", "cancelling", "earphones"],
    ];
    expect(scoreRelevance(v, "Noise Cancelling TWS Earphones")).toBeGreaterThanOrEqual(0.6);
  });
  it("tolerates a typo and prefix", () => {
    expect(scoreRelevance([["earbud"]], "Wireless Earbuds")).toBe(1);
    expect(scoreRelevance([["headph"]], "Wireless Headphones")).toBe(1);
  });
  it("does not typo-match short tokens", () => {
    expect(scoreRelevance([["cab"]], "Cat")).toBe(0);
  });
});

describe("filterRelevant", () => {
  it("keeps relevant products only", () => {
    const ps = [prod("ANC Earbuds Wireless"), prod("Garden hose 10m")];
    expect(filterRelevant(ps, [["anc", "earbuds"]]).map((p) => p.title)).toEqual([
      "ANC Earbuds Wireless",
    ]);
  });
  it("single product perfect match passes threshold", () => {
    const ps = [prod("Baseus EP10 Pro ANC Earbuds Wireless Bluetooth 6.0")];
    expect(filterRelevant(ps, [["anc", "earbuds"]])).toHaveLength(1);
  });
  it("two products, scores stay within 0..1", () => {
    const ps = [prod("ANC Earbuds"), prod("ANC Earbuds Pro")];
    expect(filterRelevant(ps, [["anc", "earbuds"]])).toHaveLength(2);
  });
  it("empty list gives empty list", () => {
    expect(filterRelevant([], [["anc"]])).toEqual([]);
  });
});

describe("isAccessory", () => {
  const q = ["anc", "earbuds"];
  it("passes the real product", () => {
    expect(isAccessory("Baseus EP10 Pro ANC Earbuds Wireless Bluetooth 6.0", q)).toBe(false);
  });
  it("flags case and tips", () => {
    expect(isAccessory("Silicone Case Cover for AirPods Pro", q)).toBe(true);
    expect(isAccessory("Replacement Ear Tips for Earbuds", q)).toBe(true);
  });
  it("flags accessory word followed by 'for' late in title", () => {
    expect(isAccessory("Premium Soft Durable Waterproof Shockproof Slim Case for Earbuds", q)).toBe(true);
  });
  it("is not an accessory when the query asks for one", () => {
    expect(isAccessory("Anker USB-C Cable 2m Braided", ["usb-c", "cable"])).toBe(false);
  });
});

describe("dedupe", () => {
  it("keeps the cheaper of near-identical titles", () => {
    const base = "Baseus EP10 Pro ANC Earbuds Wireless Bluetooth 5.3 Headphones With Mic Touch Control";
    const a = prod(base + " Black", 120, "a");
    const b = prod(base + " White", 100, "b");
    const c = prod("Garden hose 10m", 50, "c");
    expect(dedupe([a, b, c]).map((p) => p.id)).toEqual(["b", "c"]);
  });
  it("empty list gives empty list", () => {
    expect(dedupe([])).toEqual([]);
  });
});
