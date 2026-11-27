import { describe, it, expect } from "vitest";
import { productOnlyAfterWith, markWeakMatches } from "@/src/lib/match/structure";
import type { Product } from "@/src/lib/types";

const prod = (title: string): Product => ({
  site: "x", id: title, title, listPrice: 10, origPrice: null, discountPct: null, currency: "SAR",
  rating: null, soldCount: 0, image: "", url: "", detailStatus: "ok",
});

describe("productOnlyAfterWith (12e)", () => {
  const chair = [["gaming", "chair"]];
  it("the product noun only after 'with' is another item", () => {
    expect(productOnlyAfterWith("Gaming Designed Coasters Set of 10, with Pictures of Gamer Mouse, Keyboard & Chair", chair)).toBe(true);
    expect(productOnlyAfterWith("Karaoke Microphone with Built-in Speaker", [["bluetooth", "speaker"]])).toBe(true);
  });
  it("keeps the product sold with extras, and closed compounds", () => {
    expect(productOnlyAfterWith("BESTONE Gaming Chair with Footrest", chair)).toBe(false);
    expect(productOnlyAfterWith("Ergonomic Gaming Chair", chair)).toBe(false);
    expect(productOnlyAfterWith("Philips Airfryer with Grill Pan", [["air", "fryer"]])).toBe(false);
  });
  it("marks instead of dropping", () => {
    const out = markWeakMatches([prod("Coasters with Chair"), prod("Gaming Chair")], chair);
    expect(out.map((p) => !!p.weakMatch)).toEqual([true, false]);
  });
});
