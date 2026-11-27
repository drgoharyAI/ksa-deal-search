import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getDb, migrate, openDb, SCHEMA_VERSION, type Db } from "@/src/lib/db";
import {
  attachInsights,
  badgeFor,
  DAY,
  FAKE_REASONS,
  HOUR,
  insightsFor,
  PRUNE_AFTER,
  pruneObservations,
  recordObservations,
  trendFor,
  withCurrent,
  type Observation,
} from "@/src/lib/insights";
import type { Product } from "@/src/lib/types";

// Noon in Riyadh on 2026-11-27 (09:00 UTC), so whole-day offsets land on distinct Saudi days.
const NOW = Date.UTC(2026, 10, 27, 9);
const ago = (days: number, hours = 0) => NOW - days * DAY - hours * HOUR;
const ob = (price: number, at: number, origPrice: number | null = null): Observation => ({ site: "s", productId: "p", price, origPrice, at });
const set = (prices: [number, number][], current: number, orig: number | null = null) =>
  withCurrent(prices.map(([p, d]) => ob(p, ago(d))), { price: current, origPrice: orig }, NOW);
const badge = (obs: Observation[], price: number, origPrice: number | null = null, discountPct: number | null = null, peerMedian: number | null = null) =>
  badgeFor({ price, origPrice, discountPct, obs, peerMedian, now: NOW });

const product = (over: Partial<Product> = {}): Product => ({
  site: "amazon-sa",
  id: "A1",
  title: "Thing",
  listPrice: 100,
  origPrice: null,
  discountPct: null,
  currency: "SAR",
  rating: null,
  soldCount: 0,
  image: "",
  url: "https://a",
  finalPrice: 100,
  detailStatus: "ok",
  ...over,
});

describe("badge rules", () => {
  it("needs at least 3 observations over at least 2 days", () => {
    expect(badge(set([[100, 1]], 80), 80)).toBeUndefined(); // 2 observations
    expect(badge(withCurrent([ob(100, ago(0, 5)), ob(100, ago(0, 3))], { price: 80, origPrice: null }, NOW), 80)).toBeUndefined(); // 1 day
    expect(badge(set([[100, 2], [100, 1]], 80), 80)?.badge).toBe("lowest-30d");
  });
  it("Lowest in 30 days: at or under every price in the window, and not a flat line", () => {
    expect(badge(set([[100, 5], [95, 3]], 95), 95)).toMatchObject({ badge: "lowest-30d", label: "Lowest in 30 days" });
    expect(badge(set([[100, 5], [100, 3]], 100), 100)?.badge).toBe("normal");
    // A lower price older than 30 days does not count.
    expect(badge(set([[50, 40], [100, 5], [100, 3]], 99), 99)?.badge).toBe("lowest-30d");
  });
  it("Below usual price: more than 10% under the 30-day median (and not the lowest)", () => {
    const obs = set([[80, 6], [100, 5], [100, 4], [100, 3]], 89);
    expect(badge(obs, 89)).toMatchObject({ badge: "below-usual", label: "Below usual price" });
    expect(badge(set([[80, 6], [100, 5], [100, 4], [100, 3]], 90), 90)?.badge).toBe("normal"); // exactly 10%
  });
  it("Normal price otherwise", () => {
    expect(badge(set([[90, 5], [100, 4], [110, 3]], 100), 100)).toMatchObject({ badge: "normal", label: "Normal price" });
  });
});

describe("Fake deal", () => {
  it("(a) usual price: a discount is shown but the price is not below the 30-day median", () => {
    const obs = set([[100, 5], [100, 4]], 99, 110); // "was" under 15% over the median
    expect(badge(obs, 99, 110, 10)).toEqual({ badge: "fake-deal", label: "Fake deal", reason: FAKE_REASONS.usual });
    // A discountPct alone (no "was" price) counts as a shown discount too.
    expect(badge(set([[100, 5], [100, 4]], 100), 100, null, 20)?.reason).toBe(FAKE_REASONS.usual);
  });
  it("(a) never charged: the 'was' price is above every observed price and >= 15% over the median", () => {
    // Price is below the median (genuine-looking discount) but the "was" was never seen.
    const obs = set([[100, 6], [100, 5], [100, 4]], 85, 115);
    expect(badge(obs, 85, 115)).toMatchObject({ badge: "fake-deal", reason: FAKE_REASONS.neverCharged });
    // 114 is under 15% over the median: no fake deal, the drop stands.
    expect(badge(set([[100, 6], [100, 5], [100, 4]], 85, 114), 85, 114)?.badge).toBe("lowest-30d");
    // A "was" price we did observe is not inflated.
    const seen = withCurrent([ob(130, ago(20)), ob(100, ago(6)), ob(100, ago(5))], { price: 85, origPrice: 130 }, NOW);
    expect(badge(seen, 85, 130)?.badge).toBe("lowest-30d");
  });
  it("does not fire on a genuine discount below the median", () => {
    const obs = set([[120, 6], [120, 5], [120, 4]], 100, 120);
    expect(badge(obs, 100, 120, 17)?.badge).toBe("lowest-30d");
  });
  it("(b) unrealistic 'was' price, without history, when the price is in the result set's normal range", () => {
    expect(badge(set([], 100), 100, 400, 75, 120)).toMatchObject({ badge: "fake-deal", reason: FAKE_REASONS.unrealistic });
  });
  it("(b) stays quiet on clearance, modest discounts, and too few peers", () => {
    expect(badge(set([], 40), 40, 400, 90, 120)).toBeUndefined(); // far under the other listings
    expect(badge(set([], 100), 100, 120, 17, 120)).toBeUndefined(); // modest discount, no history
    expect(badge(set([], 100), 100, 280, 64, 120)).toBeUndefined(); // under 70% and under 3x
    expect(badge(set([], 100), 100, 400, 75, null)).toBeUndefined(); // no peer median
  });
  it("(b) does not override history that shows a real drop", () => {
    const obs = set([[400, 6], [400, 5], [400, 4]], 100, 400);
    expect(badge(obs, 100, 400, 75, 120)?.badge).toBe("lowest-30d");
  });
  it("wins over Lowest in 30 days", () => {
    // 99 is the lowest, but a discount is shown at the usual price.
    expect(badge(set([[100, 5], [100, 4]], 99, 140), 99, 140)?.badge).toBe("fake-deal");
  });
});

describe("trend", () => {
  it("is the daily minimum over the last 30 days, oldest first", () => {
    const obs = withCurrent([ob(200, ago(40)), ob(110, ago(3, 2)), ob(105, ago(3, 1)), ob(100, ago(2))], { price: 95, origPrice: null }, NOW);
    expect(trendFor(obs, 95, NOW)?.points).toEqual([105, 100, 95]);
  });
  it("computes the change against the latest observation 7 to 14 days old", () => {
    const obs = set([[100, 10], [100, 8], [90, 3]], 88);
    expect(trendFor(obs, 88, NOW)?.changePct7d).toBe(-12);
    expect(trendFor(set([[100, 5], [90, 3]], 88), 88, NOW)).toEqual({ points: [100, 90, 88] });
  });
  it("is absent without enough data", () => {
    expect(trendFor(set([[100, 1]], 90), 90, NOW)).toBeUndefined();
  });
});

describe("observations in the database", () => {
  let db: Db;
  beforeEach(() => (db = openDb(":memory:")));
  afterEach(() => db.close());
  const count = () => (db.prepare("SELECT count(*) n FROM observations").get() as { n: number }).n;

  it("records one per product per hour, in one batch", () => {
    const ps = [product(), product({ id: "A2", origPrice: 150, finalPrice: 90, listPrice: 90 }), product()];
    expect(recordObservations(db, ps, NOW)).toBe(2);
    expect(recordObservations(db, ps, NOW + 30 * 60_000)).toBe(0);
    expect(recordObservations(db, ps, NOW + HOUR + 1)).toBe(2);
    expect(count()).toBe(4);
    expect(db.prepare("SELECT origPrice FROM observations WHERE productId = 'A2' LIMIT 1").get()).toEqual({ origPrice: 150 });
  });
  it("skips products without a valid price", () => {
    expect(recordObservations(db, [product({ finalPrice: 0, listPrice: 0 })], NOW)).toBe(0);
  });
  it("prunes rows older than 180 days, at most once an hour", () => {
    const old = db.prepare("INSERT INTO observations (site, productId, price, origPrice, at) VALUES ('s', 'p', 1, NULL, ?)");
    old.run(NOW - PRUNE_AFTER - 1);
    recordObservations(db, [product()], NOW);
    expect(count()).toBe(1);
    old.run(NOW - PRUNE_AFTER - 1);
    recordObservations(db, [product({ id: "B" })], NOW + 10 * 60_000); // within the hour: no prune
    expect(count()).toBe(3);
    recordObservations(db, [product({ id: "C" })], NOW + HOUR);
    expect(count()).toBe(3);
    expect(pruneObservations(db, NOW)).toBe(0);
  });
  it("insights use earlier observations plus the current price, not the current hour twice", () => {
    const p = product({ finalPrice: 80, listPrice: 80 });
    recordObservations(db, [product()], ago(3));
    recordObservations(db, [product()], ago(2));
    // An observation 20 minutes ago at 100 is replaced by the current 80.
    recordObservations(db, [product()], NOW - 20 * 60_000);
    const out = insightsFor(db, [p], NOW).get("amazon-sa\u0000A1");
    expect(out?.deal?.badge).toBe("lowest-30d");
    expect(out?.trend?.points).toEqual([100, 100, 80]);
    const [annotated] = attachInsights([p], insightsFor(db, [p], NOW));
    expect(annotated).toMatchObject({ deal: { label: "Lowest in 30 days" }, trend: { points: [100, 100, 80] } });
  });
  it("gives nothing on a first sighting", () => {
    expect(insightsFor(db, [product()], NOW).size).toBe(0);
    expect(attachInsights([product()], new Map())[0]).not.toHaveProperty("deal");
  });
  it("flags an unrealistic 'was' price on the first search when the result set backs it", () => {
    const peers = [120, 110, 100, 130].map((price, i) => product({ id: `P${i}`, finalPrice: price, listPrice: price }));
    const fake = product({ id: "F", finalPrice: 100, listPrice: 100, origPrice: 500, discountPct: 80 });
    expect(insightsFor(db, [...peers, fake], NOW).get("amazon-sa\u0000F")?.deal?.reason).toBe(FAKE_REASONS.unrealistic);
  });
});

describe("migration", () => {
  it("upgrades a database at the Task 16 schema (version 1) and keeps its data", () => {
    const db = openDb(":memory:");
    db.exec("DROP TABLE observations");
    db.prepare("UPDATE schema_version SET version = 1").run();
    db.prepare("INSERT INTO searches (at, query, sites, sort, filters, resultCount) VALUES (1, 'q', '[]', 'price', '{}', 0)").run();
    migrate(db);
    expect((db.prepare("SELECT version FROM schema_version").get() as { version: number }).version).toBe(SCHEMA_VERSION);
    expect(SCHEMA_VERSION).toBe(2);
    expect((db.prepare("SELECT count(*) n FROM searches").get() as { n: number }).n).toBe(1);
    const idx = db.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'observations'").all() as { name: string }[];
    expect(idx.map((i) => i.name)).toContain("observations_item");
    db.close();
  });
  it("migrates a shared handle opened before the upgrade (dev hot reload)", () => {
    const db = openDb(":memory:");
    db.exec("DROP TABLE observations");
    db.prepare("UPDATE schema_version SET version = 1").run();
    const g = globalThis as unknown as { __dealSearchDb?: Db; __dealSearchDbSchema?: number };
    const saved = { db: g.__dealSearchDb, v: g.__dealSearchDbSchema };
    g.__dealSearchDb = db;
    g.__dealSearchDbSchema = 1;
    try {
      expect(getDb()).toBe(db);
      expect(recordObservations(db, [product()], NOW)).toBe(1);
    } finally {
      g.__dealSearchDb = saved.db;
      g.__dealSearchDbSchema = saved.v;
      db.close();
    }
  });
});
