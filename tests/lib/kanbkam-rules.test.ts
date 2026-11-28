import { describe, expect, it } from "vitest";
import { kanbkamDisagrees, kanbkamVerdicts } from "@/src/lib/kanbkam/rules";

const hist = { min: 269, max: 659 };

describe("kanbkamVerdicts", () => {
  it("Fake was-price (Kanbkam): the store's was-price is more than 2% above Kanbkam's highest", () => {
    expect(kanbkamVerdicts({ price: 400, was: 700 }, hist).map((v) => v.kind)).toEqual(["fake-was"]);
    expect(kanbkamVerdicts({ price: 400, was: 700 }, hist)[0].label).toBe("Fake was-price (Kanbkam)");
  });
  it("a was-price within 2% of the highest, or none, is not fake", () => {
    expect(kanbkamVerdicts({ price: 400, was: 659 * 1.02 }, hist)).toEqual([]);
    expect(kanbkamVerdicts({ price: 400, was: 659 }, hist)).toEqual([]);
    expect(kanbkamVerdicts({ price: 400, was: null }, hist)).toEqual([]);
  });
  it("Lowest in Kanbkam history: the price is at most 1% above the lowest", () => {
    expect(kanbkamVerdicts({ price: 269, was: null }, hist).map((v) => v.label)).toEqual(["Lowest in Kanbkam history"]);
    expect(kanbkamVerdicts({ price: 269 * 1.01, was: null }, hist).map((v) => v.kind)).toEqual(["lowest"]);
    expect(kanbkamVerdicts({ price: 250, was: null }, hist).map((v) => v.kind)).toEqual(["lowest"]);
  });
  it("Near the lowest: within 5% of the lowest, but not within 1%", () => {
    expect(kanbkamVerdicts({ price: 280, was: null }, hist).map((v) => v.label)).toEqual(["Near the lowest"]);
    expect(kanbkamVerdicts({ price: 269 * 1.05, was: null }, hist).map((v) => v.kind)).toEqual(["near-lowest"]);
    expect(kanbkamVerdicts({ price: 269 * 1.06, was: null }, hist)).toEqual([]);
  });
  it("a fake was-price and a low price can both apply", () => {
    expect(kanbkamVerdicts({ price: 269, was: 800 }, hist).map((v) => v.kind)).toEqual(["fake-was", "lowest"]);
  });
  it("no verdict without sound numbers", () => {
    expect(kanbkamVerdicts({ price: 0, was: null }, hist)).toEqual([]);
    expect(kanbkamVerdicts({ price: 300, was: null }, { min: 0, max: 659 })).toEqual([]);
  });
});

describe("kanbkamDisagrees (Kanbkam never upgrades a deal; both are shown)", () => {
  const v = (price: number, was: number | null) => kanbkamVerdicts({ price, was }, hist);
  it("our fake deal vs Kanbkam's lowest disagree", () => {
    expect(kanbkamDisagrees("fake-deal", v(269, null))).toBe(true);
    expect(kanbkamDisagrees("fake-deal", v(280, null))).toBe(true);
  });
  it("our good deal vs Kanbkam's fake was-price disagree", () => {
    expect(kanbkamDisagrees("lowest-30d", v(400, 800))).toBe(true);
    expect(kanbkamDisagrees("below-usual", v(400, 800))).toBe(true);
  });
  it("agreeing or no badge is not a disagreement", () => {
    expect(kanbkamDisagrees("lowest-30d", v(269, null))).toBe(false);
    expect(kanbkamDisagrees("fake-deal", v(400, 800))).toBe(false);
    expect(kanbkamDisagrees(undefined, v(269, null))).toBe(false);
    expect(kanbkamDisagrees("normal", v(400, null))).toBe(false);
  });
});
