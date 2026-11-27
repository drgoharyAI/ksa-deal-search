import { describe, it, expect } from "vitest";
import { resemblance, scoreMatches, namesAsPhrase, phraseCredit, MIN_TITLES, PHRASE_USUAL } from "@/src/lib/match/confidence";
import { rank, isLikelyMatch, MATCH_THRESHOLD } from "@/src/lib/rank";
import type { Product } from "@/src/lib/types";

const prod = (title: string, listPrice = 10, o: Partial<Product> = {}): Product => ({
  site: "x", id: title, title, listPrice, origPrice: null, discountPct: null, currency: "SAR",
  rating: null, soldCount: 0, image: "", url: "", detailStatus: "ok", ...o,
});

const v = [["blender"]];
// The product's listings at its usual price share their wording.
const real = Array.from({ length: 30 }, (_, i) =>
  prod(`Brand${i} Countertop Blender ${i % 2 ? "Glass Jar" : "Smoothie Jar"} ${i % 3 ? "1000W Motor" : "Ice Crusher"} Kitchen`, 150 + i * 10),
);
const sponge = prod("Beauty Blender Makeup Sponge Foundation", 5);
const cheapReal = prod("Mini Countertop Blender Smoothie Jar Kitchen", 20);

describe("resemblance (12f)", () => {
  it("scores titles worded like the listings at the usual price high, others low", () => {
    const r = resemblance([...real, sponge, cheapReal], v)!;
    expect(Math.min(...r.slice(0, real.length))).toBeGreaterThan(0.6);
    expect(r.at(-1)).toBeGreaterThan(0.6); // cheap, but worded like the product
    expect(r.at(-2)).toBeLessThan(0.2); // the makeup sponge
  });
  it("a plain product name (no descriptive words) is neutral", () => {
    const r = resemblance([...real, prod("Blender", 30)], v)!;
    expect(r.at(-1)).toBe(1);
  });
  it("needs enough titles", () => {
    expect(resemblance(real.slice(0, MIN_TITLES - 1), v)).toBeNull();
  });
});

describe("phrase (12f)", () => {
  const desk = [["standing", "desk"]];
  it("namesAsPhrase: the query words together and in order, compounds and aliases allowed", () => {
    expect(namesAsPhrase("Portable Standing Desk Height Adjustable", desk)).toBe(true);
    expect(namesAsPhrase("Desk Organizer, Monitor Stand, Black", desk)).toBe(false);
    expect(namesAsPhrase("Philips Airfryer XL", [["air", "fryer"]])).toBe(true);
    expect(namesAsPhrase("TWS Earbuds Noise Cancelling Earbuds", [["anc", "earbuds"]])).toBe(true);
    expect(namesAsPhrase("Hand Blender 500W", v)).toBe(true); // one-word query
  });
  it("phraseCredit: not naming the phrase costs more the more usual the phrase is", () => {
    const usual = [...Array.from({ length: 9 }, () => prod("Electric Standing Desk")), prod("Desk Organizer Monitor Stand")];
    expect(phraseCredit(usual, desk).at(-1)).toBeCloseTo(1 - (0.9 - PHRASE_USUAL) / (1 - PHRASE_USUAL), 5);
    expect(phraseCredit(usual, desk)[0]).toBe(1);
    const spread = [prod("Electric Standing Desk"), ...Array.from({ length: 3 }, () => prod("Desk Adjustable Standing"))];
    expect(phraseCredit(spread, desk).every((c) => c === 1)).toBe(true);
  });
});

describe("scoreMatches (12f)", () => {
  it("sets matchScore in 0..1 and caps weak matches below the threshold", () => {
    const out = scoreMatches([...real, sponge, prod("Countertop Blender Glass Jar Kitchen", 100, { weakMatch: true })], v);
    for (const p of out) {
      expect(p.matchScore).toBeGreaterThanOrEqual(0);
      expect(p.matchScore).toBeLessThanOrEqual(1);
    }
    expect(out.at(-1)!.matchScore).toBeLessThan(MATCH_THRESHOLD);
    expect(isLikelyMatch(out.at(-2)!)).toBe(false); // sponge
    expect(isLikelyMatch(out[0])).toBe(true);
  });
  it("small result sets are not judged", () => {
    const out = scoreMatches([sponge, cheapReal], v);
    expect(out.every(isLikelyMatch)).toBe(true);
  });
  it("end to end: the cheapest confident match ranks first, the cheaper sponge after the tier", () => {
    const ranked = rank(scoreMatches([...real, sponge, cheapReal], v), "price");
    expect(ranked[0].title).toBe(cheapReal.title);
    expect(ranked.at(-1)!.title).toBe(sponge.title);
  });
});
