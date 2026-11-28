import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { migrate, openDb, SCHEMA_VERSION, type Db } from "@/src/lib/db";
import { addSearch, deleteSearchesByQuery, listSearches } from "@/src/lib/history";
import { recordSeen } from "@/src/lib/discover";
import { addFavourite, clearViewed, listFavourites, listViewed, parseSnapshot, recordView, removeFavourite } from "@/src/lib/saved";
import { MAX_SAVED, MAX_VIEWED, snapshotOf } from "@/src/lib/saved-shared";
import type { Product } from "@/src/lib/types";

let dir: string;
let file: string;
let db: Db;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "deal-saved-"));
  file = path.join(dir, "data.db");
  db = openDb(file);
});
afterEach(() => {
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

const tables = (d: Db) => (d.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[]).map((t) => t.name);
const version = (d: Db) => (d.prepare("SELECT version FROM schema_version").get() as { version: number }).version;
const snap = { site: "noon-sa", id: "N1", title: "JBL Flip 6", url: "https://www.noon.com/N1", image: "https://img.example/N1.jpg", price: 399, currency: "SAR", query: "jbl flip 6" };

describe("migration 5 (favourites, recently_viewed)", () => {
  it("upgrades an existing version-4 database with data, keeping every row", () => {
    // A database as version 4 left it: history, observations and seen products.
    addSearch(db, { at: 1, query: "jbl flip 6", sites: ["noon-sa"], sort: "price", filters: {}, resultCount: 3, cheapest: null });
    db.prepare("INSERT INTO observations (site, productId, price, origPrice, at) VALUES ('noon-sa', 'N1', 420, NULL, 5)").run();
    recordSeen(db, [{ site: "noon-sa", id: "N1", title: "JBL Flip 6", listPrice: 420, origPrice: null, discountPct: null, currency: "SAR", rating: null, soldCount: 0, image: "", url: "https://www.noon.com/N1", detailStatus: "ok" }], 5);
    db.exec("DROP TABLE favourites; DROP TABLE recently_viewed; UPDATE schema_version SET version = 4");
    db.close();

    db = openDb(file);
    expect(version(db)).toBe(SCHEMA_VERSION);
    expect(SCHEMA_VERSION).toBe(8);
    expect(tables(db)).toEqual(expect.arrayContaining(["favourites", "recently_viewed", "searches", "observations", "seen_products"]));
    expect(listSearches(db)).toHaveLength(1);
    expect((db.prepare("SELECT count(*) n FROM observations").get() as { n: number }).n).toBe(1);
    expect((db.prepare("SELECT count(*) n FROM seen_products").get() as { n: number }).n).toBe(1);
    expect(addFavourite(db, snap, 10)).toBe("created");
    expect(listFavourites(db)[0]).toMatchObject({ latest: { price: 420, at: 5 } });
  });
  it("is idempotent: running migration 5 again over its own tables keeps their rows", () => {
    addFavourite(db, snap, 10);
    recordView(db, { ...snap, price: 399 }, 11);
    db.prepare("UPDATE schema_version SET version = 4").run();
    migrate(db);
    expect(version(db)).toBe(SCHEMA_VERSION);
    expect(listFavourites(db)).toHaveLength(1);
    expect(listViewed(db)).toHaveLength(1);
  });
});

describe("favourites", () => {
  it("saves once (a second save changes nothing), lists newest first and removes", () => {
    expect(addFavourite(db, snap, 10)).toBe("created");
    expect(addFavourite(db, { ...snap, price: 1, title: "changed" }, 20)).toBe("exists");
    expect(addFavourite(db, { ...snap, id: "N2" }, 30)).toBe("created");
    const list = listFavourites(db);
    expect(list.map((f) => f.id)).toEqual(["N2", "N1"]);
    expect(list[1]).toMatchObject({ price: 399, title: "JBL Flip 6", savedAt: 10, query: "jbl flip 6", latest: null, change: null });
    expect(removeFavourite(db, "noon-sa", "N1")).toBe(true);
    expect(removeFavourite(db, "noon-sa", "N1")).toBe(false);
    expect(listFavourites(db).map((f) => f.id)).toEqual(["N2"]);
  });
  it("shows the latest observed price, and a change only from an observation after saving", () => {
    const obs = db.prepare("INSERT INTO observations (site, productId, price, origPrice, at) VALUES ('noon-sa', 'N1', ?, NULL, ?)");
    obs.run(420, 5);
    addFavourite(db, snap, 10);
    expect(listFavourites(db)[0]).toMatchObject({ latest: { price: 420, at: 5 }, change: null });
    obs.run(359.5, 50);
    expect(listFavourites(db)[0]).toMatchObject({ latest: { price: 359.5, at: 50 }, change: -39.5 });
  });
  it("refuses a new product past MAX_SAVED, but re-saving one already saved still answers exists", () => {
    const ins = db.prepare("INSERT INTO favourites (site, productId, title, url, image, price, currency, query, savedAt) VALUES ('jarir', ?, 't', 'https://x', NULL, 1, 'SAR', NULL, 1)");
    for (let i = 0; i < MAX_SAVED; i++) ins.run(`J${i}`);
    expect(addFavourite(db, snap, 2)).toBe("full");
    expect(addFavourite(db, { ...snap, site: "jarir", id: "J0" }, 2)).toBe("exists");
  });
});

describe("recently viewed", () => {
  it("keeps one row per product (the newest view wins) and the last MAX_VIEWED", () => {
    recordView(db, { ...snap, price: 399 }, 1);
    recordView(db, { ...snap, id: "N2", price: null }, 2);
    recordView(db, { ...snap, price: null, title: "JBL Flip 6 Blue" }, 3);
    const list = listViewed(db);
    expect(list.map((v) => v.id)).toEqual(["N1", "N2"]);
    // A view without a price keeps the price an earlier view recorded.
    expect(list[0]).toMatchObject({ price: 399, title: "JBL Flip 6 Blue", viewedAt: 3 });
    for (let i = 0; i < MAX_VIEWED + 10; i++) recordView(db, { ...snap, id: `X${i}`, price: 5 }, 100 + i);
    const after = listViewed(db, 1000);
    expect(after).toHaveLength(MAX_VIEWED);
    expect(after[0].id).toBe(`X${MAX_VIEWED + 9}`);
    expect(after.some((v) => v.id === "N1")).toBe(false);
    clearViewed(db);
    expect(listViewed(db)).toEqual([]);
  });
});

describe("parseSnapshot", () => {
  const sites = new Set(["noon-sa", "jarir"]);
  const ok = (b: unknown, needPrice = true) => parseSnapshot(b, sites, { needPrice });
  it("accepts a product's snapshot (snapshotOf) and normalises the optional fields", () => {
    const p: Product = { site: "noon-sa", id: "N1", title: "  JBL Flip 6  ", listPrice: 420, finalPrice: 399, origPrice: null, discountPct: null, currency: "", rating: null, soldCount: 0, image: "", url: "https://www.noon.com/N1", detailStatus: "ok" };
    const r = ok({ ...snapshotOf(p), query: "  jbl  " });
    expect(r).toEqual({ ok: true, value: { site: "noon-sa", id: "N1", title: "JBL Flip 6", url: "https://www.noon.com/N1", image: null, price: 399, currency: "SAR", query: "jbl" } });
  });
  it("refuses unknown stores, missing or oversized fields, non-https links and bad prices", () => {
    expect(ok(null)).toMatchObject({ ok: false });
    expect(ok([snap])).toMatchObject({ ok: false });
    expect(ok({ ...snap, site: "evil" })).toEqual({ ok: false, error: "Unknown store" });
    expect(ok({ ...snap, id: "" })).toMatchObject({ ok: false });
    expect(ok({ ...snap, id: "x".repeat(201) })).toMatchObject({ ok: false });
    expect(ok({ ...snap, id: "a\nb" })).toMatchObject({ ok: false });
    expect(ok({ ...snap, title: "x".repeat(1001) })).toMatchObject({ ok: false });
    expect(ok({ ...snap, url: "http://www.noon.com/N1" })).toMatchObject({ ok: false });
    expect(ok({ ...snap, url: "javascript:alert(1)" })).toMatchObject({ ok: false });
    expect(ok({ ...snap, url: `https://x.example/${"a".repeat(2001)}` })).toMatchObject({ ok: false });
    expect(ok({ ...snap, price: 0 })).toMatchObject({ ok: false });
    expect(ok({ ...snap, price: "399" })).toMatchObject({ ok: false });
    expect(ok({ ...snap, price: 1e12 })).toMatchObject({ ok: false });
    expect(ok({ ...snap, price: undefined })).toEqual({ ok: false, error: "A saved product needs its price" });
  });
  it("caps a long title, drops a bad image, currency or query, and lets a view come without a price", () => {
    const r = ok({ ...snap, title: "t".repeat(900), image: "data:image/png;base64,xx", currency: "sar", query: "q".repeat(201) }, false);
    expect(r.ok && r.value).toMatchObject({ image: null, currency: "SAR", query: null });
    expect(r.ok && r.value.title).toHaveLength(300);
    expect(ok({ ...snap, price: undefined }, false)).toMatchObject({ ok: true, value: { price: null } });
  });
});

describe("history: delete one query", () => {
  it("removes every entry of the query however it was spaced or cased", () => {
    for (const q of ["JBL flip 6", " jbl   flip 6 ", "airpods"]) addSearch(db, { at: 1, query: q, sites: ["jarir"], sort: "price", filters: {}, resultCount: 0, cheapest: null });
    expect(deleteSearchesByQuery(db, "jbl flip 6")).toBe(2);
    expect(listSearches(db).map((e) => e.query)).toEqual(["airpods"]);
    expect(deleteSearchesByQuery(db, "   ")).toBe(0);
  });
});

describe("migration 6 (pickupOnly on seen_products and favourites)", () => {
  const cols = (d: Db, t: string) => (d.prepare(`PRAGMA table_info(${t})`).all() as { name: string }[]).map((c) => c.name);
  it("adds the column to both tables, and re-running it changes nothing", () => {
    expect(cols(db, "seen_products")).toContain("pickupOnly");
    expect(cols(db, "favourites")).toContain("pickupOnly");
    db.exec("UPDATE schema_version SET version = 5");
    migrate(db);
    expect(version(db)).toBe(SCHEMA_VERSION);
    expect(cols(db, "favourites").filter((c) => c === "pickupOnly")).toHaveLength(1);
  });
  it("upgrades a version-5 database, keeping its rows (pickupOnly 0)", () => {
    addFavourite(db, snap);
    db.exec("ALTER TABLE favourites DROP COLUMN pickupOnly; ALTER TABLE seen_products DROP COLUMN pickupOnly; UPDATE schema_version SET version = 5");
    migrate(db);
    expect(listFavourites(db)).toMatchObject([{ id: "N1" }]);
    expect(listFavourites(db)[0].pickupOnly).toBeUndefined();
  });
  it("a saved pickup-only product keeps the flag; a later search's state wins", () => {
    const p: Product = { site: "saco-sa", id: "S1", title: "Air fryer", listPrice: 229, origPrice: null, discountPct: null, currency: "SAR", rating: null, soldCount: 0, image: "", url: "https://www.saco.sa/en/product/x-p-000000000000000001", detailStatus: "ok", pickupOnly: true };
    const parsed = parseSnapshot({ ...snapshotOf(p), query: "air fryer" }, new Set(["saco-sa"]), { needPrice: true });
    expect(parsed).toMatchObject({ ok: true, value: { pickupOnly: true } });
    if (!parsed.ok || parsed.value.price === null) throw new Error("parse");
    addFavourite(db, { ...parsed.value, price: parsed.value.price });
    expect(listFavourites(db)[0].pickupOnly).toBe(true);
    recordSeen(db, [{ ...p, pickupOnly: undefined }], Date.now());
    expect(listFavourites(db)[0].pickupOnly).toBeUndefined();
  });
});
