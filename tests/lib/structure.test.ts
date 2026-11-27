import { describe, it, expect } from "vitest";
import { productOnlyAfterWith, markWeakMatches, typicality } from "@/src/lib/match/structure";
import type { Product } from "@/src/lib/types";

const prod = (title: string, listPrice = 10): Product => ({
  site: "x", id: title, title, listPrice, origPrice: null, discountPct: null, currency: "SAR",
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

describe("atypical cheap titles (12e)", () => {
  const v = [["baby", "stroller"]];
  const real = Array.from({ length: 60 }, (_, i) =>
    prod(`Brand${i} Lightweight Folding Baby Stroller Travel Canopy ${i % 2 ? "Black" : "Grey"}`, 200 + i * 10),
  );
  it("scores titles by how common their descriptive words are in the search", () => {
    const t = typicality([...real.map((p) => p.title), "Baby Stroller Shaped Party Favors"], v);
    expect(t[0]).toBe(1);
    expect(t.at(-1)).toBeLessThan(0.5);
  });
  it("demotes a cheap atypical title, not an expensive one or a typical cheap one", () => {
    const out = markWeakMatches(
      [...real, prod("Baby Stroller Shaped Party Favors", 15), prod("Baby Stroller Ornament Keychain Gift", 900), prod("Brand Lightweight Folding Baby Stroller", 20)],
      v,
    );
    expect(out.slice(-3).map((p) => !!p.weakMatch)).toEqual([true, false, false]);
  });
  it("needs enough titles to judge", () => {
    expect(markWeakMatches([prod("Baby Stroller Shaped Party Favors", 1), prod("Baby Stroller", 100)], v).some((p) => p.weakMatch)).toBe(false);
  });
});
