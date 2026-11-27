import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openDb, type Db } from "@/src/lib/db";
import { DISCOVER_LIMIT, discover, recordSeen } from "@/src/lib/discover";
import { DAY, HOUR } from "@/src/lib/insights";
import { homeSuggestions } from "@/src/lib/home";
import type { Product } from "@/src/lib/types";

const NOW = Date.UTC(2026, 10, 27, 12);
const P = (o: Partial<Product> = {}): Product => ({
  site: "jarir", id: "J1", title: "AirPods 4", listPrice: 450, origPrice: null, discountPct: null, currency: "SAR",
  rating: null, soldCount: 0, image: "https://img.example/a.jpg", url: "https://jarir.example/J1", detailStatus: "ok", ...o,
});
let db: Db;
const obs = (site: string, id: string, price: number, at: number, origPrice: number | null = null) =>
  db.prepare("INSERT INTO observations (site, productId, price, origPrice, at) VALUES (?, ?, ?, ?, ?)").run(site, id, price, origPrice, at);

beforeEach(() => {
  db = openDb(":memory:");
});
afterEach(() => db.close());

describe("recordSeen", () => {
  it("keeps the title, https link and picture; skips products without an https link or title", () => {
    expect(recordSeen(db, [P(), P({ id: "J2", url: "http://jarir.example/J2" }), P({ id: "J3", title: "  " }), P({ id: "J4", image: "data:x" })], NOW)).toBe(2);
    const rows = db.prepare("SELECT productId, image, lastSeen FROM seen_products ORDER BY productId").all() as { productId: string; image: string | null; lastSeen: number }[];
    expect(rows).toEqual([
      { productId: "J1", image: "https://img.example/a.jpg", lastSeen: NOW },
      { productId: "J4", image: null, lastSeen: NOW },
    ]);
  });
  it("updates on a later sighting and never moves lastSeen back", () => {
    recordSeen(db, [P()], NOW);
    recordSeen(db, [P({ title: "AirPods 4 ANC", fetchedAt: NOW - DAY })], NOW);
    expect(db.prepare("SELECT title, lastSeen FROM seen_products").get()).toEqual({ title: "AirPods 4 ANC", lastSeen: NOW });
  });
  it("drops rows not seen for 180 days", () => {
    recordSeen(db, [P({ id: "old" })], NOW - 200 * DAY);
    recordSeen(db, [P()], NOW);
    expect((db.prepare("SELECT count(*) n FROM seen_products").get() as { n: number }).n).toBe(1);
  });
});

describe("discover", () => {
  it("is empty with no data", () => {
    expect(discover(db, NOW)).toEqual([]);
  });
  it("lists a verified drop: latest price under the highest seen in 30 days", () => {
    recordSeen(db, [P()], NOW);
    obs("jarir", "J1", 500, NOW - 3 * DAY);
    obs("jarir", "J1", 450, NOW);
    const [d] = discover(db, NOW);
    expect(d).toMatchObject({ site: "jarir", id: "J1", title: "AirPods 4", price: 450, previousPrice: 500, dropPct: 10, currency: "SAR", seenAt: NOW });
  });
  it("skips a small drop, a rise, a single observation and products not seen lately", () => {
    recordSeen(db, [P({ id: "small" }), P({ id: "rise" }), P({ id: "one" })], NOW);
    recordSeen(db, [P({ id: "stale" })], NOW - 20 * DAY);
    obs("jarir", "small", 100, NOW - 2 * DAY);
    obs("jarir", "small", 97, NOW);
    obs("jarir", "rise", 100, NOW - 2 * DAY);
    obs("jarir", "rise", 120, NOW);
    obs("jarir", "one", 50, NOW);
    obs("jarir", "stale", 100, NOW - 25 * DAY);
    obs("jarir", "stale", 50, NOW - 20 * DAY);
    expect(discover(db, NOW)).toEqual([]);
  });
  it("ignores a store's claimed discount: only observed prices count", () => {
    recordSeen(db, [P()], NOW);
    obs("jarir", "J1", 450, NOW - 2 * DAY, 900);
    obs("jarir", "J1", 450, NOW, 900);
    expect(discover(db, NOW)).toEqual([]);
  });
  it("sorts by the biggest drop and caps the list", () => {
    const ids = Array.from({ length: DISCOVER_LIMIT + 2 }, (_, i) => `p${i}`);
    recordSeen(db, ids.map((id) => P({ id, url: `https://jarir.example/${id}` })), NOW);
    ids.forEach((id, i) => {
      obs("jarir", id, 100, NOW - 2 * DAY);
      obs("jarir", id, 90 - i, NOW - HOUR);
    });
    const out = discover(db, NOW);
    expect(out).toHaveLength(DISCOVER_LIMIT);
    expect(out[0].id).toBe(ids.at(-1));
    expect(out.map((d) => d.dropPct)).toEqual([...out.map((d) => d.dropPct)].sort((a, b) => (b ?? 0) - (a ?? 0)));
  });
  it("carries a Lowest in 30 days badge from the observations", () => {
    recordSeen(db, [P()], NOW);
    obs("jarir", "J1", 500, NOW - 5 * DAY);
    obs("jarir", "J1", 480, NOW - 3 * DAY);
    obs("jarir", "J1", 400, NOW);
    expect(discover(db, NOW)[0].deal).toEqual({ badge: "lowest-30d", label: "Lowest in 30 days" });
  });
});

describe("homeSuggestions", () => {
  it("popular are queries searched twice or more; recent are the other latest ones; each query once", () => {
    const at = (n: number) => NOW - n * HOUR;
    const out = homeSuggestions([
      { query: "AirPods 4", at: at(1) },
      { query: "kettle", at: at(2) },
      { query: "airpods  4", at: at(3) },
      { query: "Galaxy S24", at: at(4) },
      { query: "galaxy s24", at: at(5) },
      { query: "galaxy s24", at: at(6) },
      { query: "   ", at: at(7) },
    ]);
    expect(out.popular.map((s) => [s.query, s.count])).toEqual([["Galaxy S24", 3], ["AirPods 4", 2]]);
    expect(out.recent.map((s) => s.query)).toEqual(["kettle"]);
  });
  it("is empty for an empty history", () => {
    expect(homeSuggestions([])).toEqual({ popular: [], recent: [] });
  });
});
