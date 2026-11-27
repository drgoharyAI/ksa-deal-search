import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getDb, migrate, openDb, SCHEMA_VERSION, type Db } from "@/src/lib/db";
import {
  attachInsights,
  badgeFor,
  DAY,
  FAKE_REASONS,
  HOUR,
  hasEnoughData,
  insightsFor,
  ksaDay,
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
    expect(trendFor(obs, 95, NOW)?.points).toEqual([{ day: 26, price: 105 }, { day: 27, price: 100 }, { day: 29, price: 95 }]);
  });
  it("computes the change against the latest observation 7 to 14 days old", () => {
    const obs = set([[100, 10], [100, 8], [90, 3]], 88);
    expect(trendFor(obs, 88, NOW)?.changePct7d).toBe(-12);
    expect(trendFor(set([[100, 5], [90, 3]], 88), 88, NOW)).toEqual({ points: [{ day: 24, price: 100 }, { day: 26, price: 90 }, { day: 29, price: 88 }] });
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
    expect(out?.trend?.points).toEqual([{ day: 26, price: 100 }, { day: 27, price: 100 }, { day: 29, price: 80 }]);
    const [annotated] = attachInsights([p], insightsFor(db, [p], NOW));
    expect(annotated).toMatchObject({ deal: { label: "Lowest in 30 days" }, trend: { points: [{ day: 26, price: 100 }, { day: 27, price: 100 }, { day: 29, price: 80 }] } });
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

/**
 * A database exactly at the Task 16 schema (version 1): the Task 16 tables as created then,
 * built from a migrated database's SQL with later columns on watches taken out.
 */
function v1Db(): Db {
  const src = openDb(":memory:");
  const sql = (
    src
      .prepare("SELECT sql FROM sqlite_master WHERE sql IS NOT NULL AND tbl_name IN ('searches', 'watches', 'price_points', 'alert_events') ORDER BY rowid")
      .all() as { sql: string }[]
  ).map((r) => r.sql.replace(/,\s*filters TEXT NOT NULL DEFAULT '\{\}'/, ""));
  src.close();
  const db = openDb(":memory:");
  for (const t of ["seen_products", "observations", "alert_events", "price_points", "watches", "searches"]) db.exec(`DROP TABLE IF EXISTS ${t}`);
  for (const q of sql) db.exec(q);
  db.prepare("UPDATE schema_version SET version = 1").run();
  return db;
}

describe("migration", () => {
  it("upgrades a database at the Task 16 schema (version 1) and keeps its data", () => {
    const db = v1Db();
    db.prepare("INSERT INTO searches (at, query, sites, sort, filters, resultCount) VALUES (1, 'q', '[]', 'price', '{}', 0)").run();
    migrate(db);
    expect((db.prepare("SELECT version FROM schema_version").get() as { version: number }).version).toBe(SCHEMA_VERSION);
    expect(SCHEMA_VERSION).toBeGreaterThanOrEqual(2);
    expect((db.prepare("SELECT count(*) n FROM searches").get() as { n: number }).n).toBe(1);
    const idx = db.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'observations'").all() as { name: string }[];
    expect(idx.map((i) => i.name)).toContain("observations_item");
    db.close();
  });
  it("upgrades a database at version 2 (observations, no later columns) and keeps its observations", () => {
    const db = v1Db();
    db.exec(`CREATE TABLE observations (id INTEGER PRIMARY KEY, site TEXT NOT NULL, productId TEXT NOT NULL, price REAL NOT NULL, origPrice REAL, at INTEGER NOT NULL);
      CREATE INDEX observations_item ON observations(site, productId, at);
      CREATE INDEX observations_at ON observations(at);`);
    db.prepare("UPDATE schema_version SET version = 2").run();
    db.prepare("INSERT INTO observations (site, productId, price, origPrice, at) VALUES ('s', 'p', 9, NULL, 1)").run();
    migrate(db);
    expect((db.prepare("SELECT version FROM schema_version").get() as { version: number }).version).toBe(SCHEMA_VERSION);
    expect((db.prepare("SELECT count(*) n FROM observations").get() as { n: number }).n).toBe(1);
    db.close();
  });
  it("migrates a shared handle opened before the upgrade (dev hot reload)", () => {
    const db = v1Db();
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

describe("review fixes", () => {
  it("Saudi days: 20:00 and 22:00 UTC fall on different Saudi days", () => {
    const a = Date.UTC(2026, 10, 26, 20);
    const b = Date.UTC(2026, 10, 26, 22);
    expect(ksaDay(b)).toBe(ksaDay(a) + 1);
    expect(ksaDay(Date.UTC(2026, 10, 26, 1))).toBe(ksaDay(a));
  });
  it("two Saudi days are not enough without 20 hours between the first and last observation", () => {
    const a = Date.UTC(2026, 10, 26, 20);
    expect(hasEnoughData([{ at: a }, { at: a + HOUR }, { at: a + 2 * HOUR }])).toBe(false);
    expect(hasEnoughData([{ at: a }, { at: a + HOUR }, { at: a + 20 * HOUR - 1 }])).toBe(false);
    expect(hasEnoughData([{ at: a }, { at: a + HOUR }, { at: a + 20 * HOUR }])).toBe(true);
    const at = Date.UTC(2026, 10, 26, 23);
    const obs = withCurrent([ob(100, a), ob(100, a + HOUR)], { price: 80, origPrice: null }, at);
    expect(badgeFor({ price: 80, origPrice: null, discountPct: null, obs, peerMedian: null, now: at })).toBeUndefined();
  });
  it("today's sparkline point is the current price, even when earlier today was lower", () => {
    const obs = withCurrent([ob(100, ago(3)), ob(70, NOW - 3 * HOUR)], { price: 90, origPrice: null }, NOW);
    expect(trendFor(obs, 90, NOW)?.points).toEqual([{ day: 26, price: 100 }, { day: 29, price: 90 }]);
  });
  it("points sit on their day, so gaps between days stay visible", () => {
    const t = trendFor(set([[120, 20], [110, 19], [100, 4]], 95), 95, NOW);
    expect(t?.points.map((p) => p.day)).toEqual([9, 10, 25, 29]);
  });
  it("records a cached answer at its original time, so the hourly dedupe drops a repeat", () => {
    const db = openDb(":memory:");
    const fetched = NOW - 50 * 60_000;
    expect(recordObservations(db, [product({ fetchedAt: fetched })], fetched)).toBe(1);
    // 70 minutes after the first sighting, the same cached answer is served again.
    expect(recordObservations(db, [product({ fetchedAt: fetched })], NOW + 20 * 60_000)).toBe(0);
    // A fresh answer at that time is a new sighting.
    expect(recordObservations(db, [product({ fetchedAt: NOW + 20 * 60_000 })], NOW + 20 * 60_000)).toBe(1);
    // A cached answer first seen now is stored with its cache time, never in the future.
    expect(recordObservations(db, [product({ id: "B", fetchedAt: NOW - 5 * 60_000 })], NOW)).toBe(1);
    expect(db.prepare("SELECT at FROM observations WHERE productId = 'B'").get()).toEqual({ at: NOW - 5 * 60_000 });
    expect(recordObservations(db, [product({ id: "C", fetchedAt: NOW + HOUR })], NOW)).toBe(1);
    expect(db.prepare("SELECT at FROM observations WHERE productId = 'C'").get()).toEqual({ at: NOW });
    db.close();
  });
});

describe("boundaries", () => {
  const none = set([], 100);
  const b = (orig: number, pct: number | null, peer: number | null) => badge(none, 100, orig, pct, peer)?.reason;
  it("no-history rule fires at exactly 70%, exactly 3x and exactly 0.5x the peer median", () => {
    expect(b(300, 70, 200)).toBe(FAKE_REASONS.unrealistic);
    expect(b(300, 69.9, 200)).toBeUndefined();
    expect(b(299.99, 70, 200)).toBeUndefined();
    expect(b(300, 70, 200.01)).toBeUndefined();
    // Without a store discountPct, the discount comes from the "was" price (300 -> 100 is 66.7%).
    expect(b(300, null, 150)).toBeUndefined();
    expect(b(400, null, 150)).toBe(FAKE_REASONS.unrealistic);
  });
  it("usual-price rule fires at exactly 98% of the median and not below it", () => {
    const hist: [number, number][] = [[100, 5], [100, 4]];
    expect(badge(set(hist, 98, 105), 98, 105, null)?.reason).toBe(FAKE_REASONS.usual);
    expect(badge(set(hist, 97.9, 105), 97.9, 105, null)?.badge).not.toBe("fake-deal");
  });
  describe("peers in the result set", () => {
    let db: Db;
    beforeEach(() => (db = openDb(":memory:")));
    afterEach(() => db.close());
    const fake = product({ id: "F", finalPrice: 100, listPrice: 100, origPrice: 500, discountPct: 80 });
    const peer = (i: number, over: Partial<Product> = {}) => product({ id: `P${i}`, finalPrice: 110, listPrice: 110, ...over });
    const reason = (ps: Product[]) => insightsFor(db, ps, NOW).get("amazon-sa\u0000F")?.deal?.reason;
    it("needs at least 4 confident listings", () => {
      expect(reason([peer(1), peer(2), peer(3), fake])).toBe(FAKE_REASONS.unrealistic);
      expect(reason([peer(1), peer(2), fake])).toBeUndefined();
    });
    it("leaves out weak and low-confidence matches", () => {
      expect(reason([peer(1), peer(2), peer(3, { weakMatch: true }), fake])).toBeUndefined();
      expect(reason([peer(1), peer(2), peer(3, { matchScore: 0.3 }), fake])).toBeUndefined();
    });
  });
});
