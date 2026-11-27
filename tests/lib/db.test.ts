import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { dbPath, migrate, openDb, SCHEMA_VERSION, type Db } from "@/src/lib/db";
import { addSearch, clearSearches, deleteSearch, listSearches, MAX_HISTORY } from "@/src/lib/history";
import {
  addEvent,
  addPricePoint,
  createWatch,
  deleteWatch,
  getWatch,
  listEvents,
  listWatchViews,
  listWatches,
  markEventsSeen,
  unreadCount,
  updateWatch,
} from "@/src/lib/alerts/repo";

let dir: string;
let db: Db;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "deal-db-"));
  db = openDb(path.join(dir, "nested", "data.db"));
});
afterEach(() => {
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("dbPath", () => {
  it("uses DEAL_SEARCH_DB, else LOCALAPPDATA, else the home folder", () => {
    expect(dbPath({ DEAL_SEARCH_DB: "C:/x/y.db" })).toBe(path.resolve("C:/x/y.db"));
    expect(dbPath({ LOCALAPPDATA: "C:/L" })).toBe(path.join("C:/L", "deal-search", "data.db"));
    expect(dbPath({})).toBe(path.join(os.homedir(), ".local", "share", "deal-search", "data.db"));
  });
});

describe("migrations", () => {
  it("creates the folder and file, records the schema version, and is idempotent", () => {
    expect(fs.existsSync(path.join(dir, "nested", "data.db"))).toBe(true);
    const v = () => (db.prepare("SELECT version FROM schema_version").get() as { version: number }).version;
    expect(v()).toBe(SCHEMA_VERSION);
    migrate(db);
    expect(v()).toBe(SCHEMA_VERSION);
    expect((db.prepare("SELECT count(*) n FROM schema_version").get() as { n: number }).n).toBe(1);
    const tables = (db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[]).map((t) => t.name);
    expect(tables).toEqual(expect.arrayContaining(["searches", "watches", "price_points", "alert_events"]));
  });
  it("reopening an existing file keeps its data", () => {
    addSearch(db, { at: 1, query: "q", sites: ["jarir"], sort: "price", filters: {}, resultCount: 0, cheapest: null });
    db.close();
    db = openDb(path.join(dir, "nested", "data.db"));
    expect(listSearches(db)).toHaveLength(1);
  });
});

describe("history", () => {
  it("adds, lists newest first, deletes one and clears all", () => {
    const a = addSearch(db, { at: 10, query: "airpods", sites: ["jarir"], sort: "price", filters: { maxPrice: 900 }, resultCount: 3, cheapest: { title: "AirPods 4", site: "jarir", price: 499, currency: "SAR", url: "https://x" } });
    addSearch(db, { at: 20, query: "ps5", sites: ["noon-sa", "jarir"], sort: "deal", filters: {}, resultCount: 0, cheapest: null });
    const list = listSearches(db);
    expect(list.map((e) => e.query)).toEqual(["ps5", "airpods"]);
    expect(list[1]).toMatchObject({ sites: ["jarir"], filters: { maxPrice: 900 }, cheapest: { price: 499 } });
    expect(deleteSearch(db, a)).toBe(true);
    expect(deleteSearch(db, a)).toBe(false);
    expect(listSearches(db)).toHaveLength(1);
    clearSearches(db);
    expect(listSearches(db)).toHaveLength(0);
  });
  it("keeps at most MAX_HISTORY entries", () => {
    for (let i = 0; i < MAX_HISTORY + 5; i++) addSearch(db, { at: i, query: `q${i}`, sites: ["jarir"], sort: "price", filters: {}, resultCount: 0, cheapest: null });
    const list = listSearches(db, 10_000);
    expect(list).toHaveLength(MAX_HISTORY);
    expect(list.at(-1)?.query).toBe("q5");
  });
});

describe("watches, price points and events", () => {
  const product = { kind: "product" as const, site: "amazon-sa", productId: "B0X", query: "airpods", sites: ["amazon-sa"], target: 450, title: "AirPods", url: "https://a", image: "", currency: "SAR" };

  it("creates, reads, updates and deletes a watch (points cascade, events keep)", () => {
    const id = createWatch(db, product, 100);
    expect(getWatch(db, id)).toMatchObject({ id, kind: "product", status: "active", lastFiredPrice: null, sites: ["amazon-sa"], createdAt: 100 });
    addPricePoint(db, id, { at: 101, price: 500, url: "https://a", title: "AirPods" });
    addPricePoint(db, id, { at: 102, price: 470 });
    updateWatch(db, id, { status: "paused", target: 440, lastPrice: 470, lastCheckedAt: 102 });
    const v = listWatchViews(db)[0];
    expect(v).toMatchObject({ status: "paused", target: 440, lastPrice: 470, lowest: 470 });
    expect(v.points.map((p) => p.price)).toEqual([500, 470]);
    addEvent(db, { watchId: id, at: 103, title: "AirPods", site: "amazon-sa", oldPrice: 500, newPrice: 430, target: 440, currency: "SAR", url: "https://a", sent: false });
    expect(unreadCount(db)).toBe(1);
    markEventsSeen(db);
    expect(unreadCount(db)).toBe(0);
    expect(deleteWatch(db, id)).toBe(true);
    expect(getWatch(db, id)).toBeNull();
    expect((db.prepare("SELECT count(*) n FROM price_points").get() as { n: number }).n).toBe(0);
    expect(listEvents(db)[0]).toMatchObject({ watchId: null, newPrice: 430, sent: false, seen: true });
  });
  it("lists only active watches when asked", () => {
    const a = createWatch(db, product, 1);
    createWatch(db, { ...product, kind: "search", site: null, productId: null, sites: ["jarir", "noon-sa"] }, 2);
    updateWatch(db, a, { status: "paused" });
    expect(listWatches(db, { activeOnly: true }).map((w) => w.kind)).toEqual(["search"]);
    expect(listWatches(db)).toHaveLength(2);
  });
});

describe("migration 7 (alert_events.retry)", () => {
  it("adds the retry flag and is idempotent when the column is already there", () => {
    const d = openDb(":memory:");
    try {
      const cols = () => (d.prepare("PRAGMA table_info(alert_events)").all() as { name: string }[]).map((c) => c.name);
      expect(cols()).toContain("retry");
      d.prepare("UPDATE schema_version SET version = 6").run();
      migrate(d);
      expect((d.prepare("SELECT version FROM schema_version").get() as { version: number }).version).toBe(SCHEMA_VERSION);
      expect(cols().filter((c) => c === "retry")).toHaveLength(1);
    } finally {
      d.close();
    }
  });
});
