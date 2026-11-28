import { describe, expect, it } from "vitest";
import { kanbkamDisagrees, kanbkamVerdicts, shortHistory } from "@/src/lib/kanbkam/rules";

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

describe("minimum-history guard (coordinator ruling)", () => {
  const NOW = Date.UTC(2026, 10, 28);
  it("min = max (no recorded change) is a short history: no verdict at all", () => {
    // Live noon N70208041V: min = max = 1898.99, our was-price 2299.
    const h = { min: 1898.99, max: 1898.99, since: null };
    expect(shortHistory(h, NOW)).toBe(true);
    expect(kanbkamVerdicts({ price: 1999, was: 2299 }, h, NOW)).toEqual([]);
    expect(kanbkamVerdicts({ price: 1898.99, was: null }, h, NOW)).toEqual([]);
  });
  it("a 'since' date under 30 days old is a short history", () => {
    expect(shortHistory({ min: 269, max: 659, since: "2026-11-10" }, NOW)).toBe(true);
    expect(kanbkamVerdicts({ price: 269, was: 800 }, { min: 269, max: 659, since: "Nov 10, 2026" }, NOW)).toEqual([]);
  });
  it("an unreadable 'since' date is treated as short (cannot prove 30 days)", () => {
    expect(shortHistory({ min: 269, max: 659, since: "recently" }, NOW)).toBe(true);
  });
  it("a change recorded and a 'since' date 30 days old or more (or none) is meaningful", () => {
    expect(shortHistory({ min: 269, max: 659, since: null }, NOW)).toBe(false);
    expect(shortHistory({ min: 269, max: 659, since: "2026-10-29" }, NOW)).toBe(false);
    expect(shortHistory({ min: 269, max: 659, since: "Mar 14, 2022" }, NOW)).toBe(false);
    expect(shortHistory({ min: 269, max: 659, since: "14/03/2022" }, NOW)).toBe(false);
    expect(kanbkamVerdicts({ price: 269, was: 800 }, { min: 269, max: 659, since: "Mar 14, 2022" }, NOW).map((v) => v.kind)).toEqual(["fake-was", "lowest"]);
  });
});
