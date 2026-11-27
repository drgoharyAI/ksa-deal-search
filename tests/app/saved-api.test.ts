import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "@/src/lib/db";

const state = vi.hoisted(() => ({ db: null as unknown as Db, dbFails: false }));

vi.mock("@/src/lib/db", async (orig) => {
  const real = await orig<typeof import("@/src/lib/db")>();
  return {
    ...real,
    getDb: () => {
      if (state.dbFails) throw new Error("disk I/O error");
      return state.db;
    },
  };
});
vi.mock("@/src/lib/alerts/service", () => ({ ensureChecker: () => {} }));

const { openDb } = await import("@/src/lib/db");
const { addSearch, listSearches } = await import("@/src/lib/history");
const { MAX_VIEWED } = await import("@/src/lib/saved-shared");
const favourites = await import("@/app/api/favourites/route");
const viewed = await import("@/app/api/viewed/route");
const history = await import("@/app/api/history/route");

const BASE = "http://127.0.0.1:3000";
const JSON_TYPE = { "content-type": "application/json" };
const snap = { site: "noon-sa", id: "N1", title: "JBL Flip 6", url: "https://www.noon.com/N1", image: "https://img.example/N1.jpg", price: 399, currency: "SAR", query: "jbl flip 6" };

const post = (path: string, body: unknown, headers: Record<string, string> = JSON_TYPE) =>
  new Request(`${BASE}${path}`, { method: "POST", headers, body: typeof body === "string" ? body : JSON.stringify(body) });
const get = (path: string, headers: Record<string, string> = {}) => new Request(`${BASE}${path}`, { headers });
const del = (path: string, headers: Record<string, string> = {}) => new Request(`${BASE}${path}`, { method: "DELETE", headers });

beforeEach(() => {
  state.db = openDb(":memory:");
  state.dbFails = false;
});
afterEach(() => state.db.close());

describe("/api/favourites", () => {
  it("saves (201), dedupes a second save (200, existing), lists and removes", async () => {
    expect((await favourites.POST(post("/api/favourites", snap))).status).toBe(201);
    const again = await favourites.POST(post("/api/favourites", { ...snap, price: 1 }));
    expect(again.status).toBe(200);
    expect(await again.json()).toEqual({ ok: true, existing: true });
    const list = await favourites.GET(get("/api/favourites"));
    expect(list.headers.get("cache-control")).toBe("no-store");
    const d = (await list.json()) as { items: { id: string; price: number }[] };
    expect(d.items).toHaveLength(1);
    expect(d.items[0]).toMatchObject({ id: "N1", price: 399 });
    expect((await favourites.DELETE(del("/api/favourites?site=noon-sa&id=N1"))).status).toBe(200);
    expect((await favourites.DELETE(del("/api/favourites?site=noon-sa&id=N1"))).status).toBe(404);
  });
  it("validates the body and the delete parameters", async () => {
    expect((await favourites.POST(post("/api/favourites", { ...snap, site: "evil" }))).status).toBe(400);
    expect((await favourites.POST(post("/api/favourites", { ...snap, url: "http://x.example" }))).status).toBe(400);
    expect((await favourites.POST(post("/api/favourites", { ...snap, price: undefined }))).status).toBe(400);
    expect((await favourites.POST(post("/api/favourites", "not json"))).status).toBe(400);
    expect((await favourites.DELETE(del("/api/favourites?site=evil&id=N1"))).status).toBe(400);
    expect((await favourites.DELETE(del("/api/favourites?site=noon-sa"))).status).toBe(400);
  });
  it("caps the body size (413) by Content-Length and by what is read", async () => {
    const big = { ...snap, title: "x".repeat(9000) };
    expect((await favourites.POST(post("/api/favourites", big))).status).toBe(413);
    expect((await favourites.POST(post("/api/favourites", snap, { ...JSON_TYPE, "content-length": "999999" }))).status).toBe(413);
  });
  it("refuses a 501st product (409)", async () => {
    const ins = state.db.prepare("INSERT INTO favourites (site, productId, title, url, image, price, currency, query, savedAt) VALUES ('jarir', ?, 't', 'https://x', NULL, 1, 'SAR', NULL, 1)");
    for (let i = 0; i < 500; i++) ins.run(`J${i}`);
    const r = await favourites.POST(post("/api/favourites", snap));
    expect(r.status).toBe(409);
    expect(((await r.json()) as { error: string }).error).toMatch(/up to 500/);
  });
  it("refuses cross-site requests and a non-JSON content type", async () => {
    expect((await favourites.GET(get("/api/favourites", { "sec-fetch-site": "cross-site" }))).status).toBe(403);
    expect((await favourites.POST(post("/api/favourites", snap, { ...JSON_TYPE, origin: "https://evil.example" }))).status).toBe(403);
    expect((await favourites.POST(post("/api/favourites", snap, { "content-type": "text/plain" }))).status).toBe(415);
    expect((await favourites.DELETE(del("/api/favourites?site=noon-sa&id=N1", { "sec-fetch-site": "cross-site" }))).status).toBe(403);
    expect((await favourites.GET(new Request("http://evil.example/api/favourites"))).status).toBe(403);
  });
  it("a database failure is a plain 500", async () => {
    state.dbFails = true;
    expect((await favourites.GET(get("/api/favourites"))).status).toBe(500);
    expect((await favourites.POST(post("/api/favourites", snap))).status).toBe(500);
  });
});

describe("/api/viewed", () => {
  it("records views (one per product, newest first), keeps the last 50 and clears", async () => {
    expect((await viewed.POST(post("/api/viewed", snap))).status).toBe(200);
    expect((await viewed.POST(post("/api/viewed", { ...snap, id: "N2", price: undefined }))).status).toBe(200);
    expect((await viewed.POST(post("/api/viewed", snap))).status).toBe(200);
    let d = (await (await viewed.GET(get("/api/viewed"))).json()) as { items: { id: string }[] };
    expect(d.items.map((v) => v.id)).toEqual(["N1", "N2"]);
    for (let i = 0; i < MAX_VIEWED + 5; i++) await viewed.POST(post("/api/viewed", { ...snap, id: `X${i}` }));
    d = (await (await viewed.GET(get("/api/viewed"))).json()) as { items: { id: string }[] };
    expect(d.items).toHaveLength(MAX_VIEWED);
    expect((await viewed.DELETE(del("/api/viewed"))).status).toBe(400);
    expect((await viewed.DELETE(del("/api/viewed?all=1"))).status).toBe(200);
    d = (await (await viewed.GET(get("/api/viewed"))).json()) as { items: { id: string }[] };
    expect(d.items).toEqual([]);
  });
  it("validates, caps the body and guards like the other routes", async () => {
    expect((await viewed.POST(post("/api/viewed", { ...snap, id: "" }))).status).toBe(400);
    expect((await viewed.POST(post("/api/viewed", { ...snap, title: "y".repeat(9000) }))).status).toBe(413);
    expect((await viewed.POST(post("/api/viewed", snap, { "content-type": "text/plain" }))).status).toBe(415);
    expect((await viewed.POST(post("/api/viewed", snap, { ...JSON_TYPE, "sec-fetch-site": "cross-site" }))).status).toBe(403);
    expect((await viewed.DELETE(del("/api/viewed?all=1", { origin: "https://evil.example" }))).status).toBe(403);
  });
});

describe("/api/history DELETE ?q=", () => {
  it("removes every entry of one query, and checks the parameter", async () => {
    for (const q of ["JBL Flip 6", "jbl flip 6", "airpods"]) addSearch(state.db, { at: 1, query: q, sites: ["jarir"], sort: "price", filters: {}, resultCount: 0, cheapest: null });
    const r = await history.DELETE(del(`/api/history?q=${encodeURIComponent(" jbl  FLIP 6")}`));
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ ok: true, removed: 2 });
    expect(listSearches(state.db).map((e) => e.query)).toEqual(["airpods"]);
    expect((await history.DELETE(del("/api/history?q=nothing"))).status).toBe(404);
    expect((await history.DELETE(del("/api/history?q=%20"))).status).toBe(400);
    expect((await history.DELETE(del(`/api/history?q=${"x".repeat(201)}`))).status).toBe(400);
    expect((await history.DELETE(del("/api/history?q=airpods", { "sec-fetch-site": "cross-site" }))).status).toBe(403);
  });
});
