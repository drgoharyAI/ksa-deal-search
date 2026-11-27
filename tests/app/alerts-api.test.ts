import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "@/src/lib/db";
import type { Product } from "@/src/lib/types";

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

const product: Product = {
  site: "jarir",
  id: "J1",
  title: "AirPods 4",
  listPrice: 499,
  origPrice: null,
  discountPct: null,
  currency: "SAR",
  rating: null,
  soldCount: 0,
  image: "",
  url: "https://www.jarir.com/sa-en/J1",
  finalPrice: 499,
  detailStatus: "ok",
  matchScore: 0.9,
};

vi.mock("@/src/lib/pipeline", () => ({
  runSearch: vi.fn(async () => ({ products: [product], statuses: [{ site: "jarir", status: "ok" }], queryTokens: [] })),
}));

const { openDb } = await import("@/src/lib/db");
const history = await import("@/app/api/history/route");
const watches = await import("@/app/api/watches/route");
const alerts = await import("@/app/api/alerts/route");
const seen = await import("@/app/api/alerts/seen/route");
const testTelegram = await import("@/app/api/alerts/test-telegram/route");
const search = await import("@/app/api/search/route");
const { addEvent } = await import("@/src/lib/alerts/repo");
const { recordSeen } = await import("@/src/lib/discover");
const { addFavourite } = await import("@/src/lib/saved");

const BASE = "http://127.0.0.1:3000";
const jsonReq = (path: string, method: string, body: unknown, headers: Record<string, string> = {}) =>
  new Request(`${BASE}${path}`, { method, headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
const plain = (path: string, method = "GET", headers: Record<string, string> = {}) => new Request(`${BASE}${path}`, { method, headers });

const productBody = { kind: "product", site: "jarir", productId: "J1", query: "airpods 4", target: 470, title: "AirPods 4", url: "https://www.jarir.com/sa-en/J1", price: 499 };

beforeEach(() => {
  state.db = openDb(":memory:");
  state.dbFails = false;
  vi.unstubAllEnvs();
});
afterEach(() => state.db.close());

describe("request guard on every new route", () => {
  it("rejects cross-site requests and non-JSON bodies", async () => {
    const evil = { origin: "https://evil.example", "sec-fetch-site": "cross-site" };
    expect((await history.GET(plain("/api/history", "GET", evil))).status).toBe(403);
    expect((await history.DELETE(plain("/api/history?all=1", "DELETE", evil))).status).toBe(403);
    expect((await watches.GET(plain("/api/watches", "GET", evil))).status).toBe(403);
    expect((await watches.POST(jsonReq("/api/watches", "POST", productBody, evil))).status).toBe(403);
    expect((await watches.PATCH(jsonReq("/api/watches", "PATCH", { id: 1, target: 1 }, evil))).status).toBe(403);
    expect((await watches.DELETE(plain("/api/watches?id=1", "DELETE", evil))).status).toBe(403);
    expect((await alerts.GET(plain("/api/alerts", "GET", evil))).status).toBe(403);
    expect((await testTelegram.POST(jsonReq("/api/alerts/test-telegram", "POST", {}, evil))).status).toBe(403);
    const textPlain = new Request(`${BASE}/api/watches`, { method: "POST", headers: { "content-type": "text/plain" }, body: JSON.stringify(productBody) });
    expect((await watches.POST(textPlain)).status).toBe(415);
    expect((await seen.POST(plain("/api/alerts/seen", "POST"))).status).toBe(415);
  });
});

describe("/api/watches", () => {
  it("validates input", async () => {
    const bad = async (body: unknown) => (await watches.POST(jsonReq("/api/watches", "POST", body))).status;
    expect(await bad({ ...productBody, site: "ebay" })).toBe(400);
    expect(await bad({ ...productBody, target: -1 })).toBe(400);
    expect(await bad({ ...productBody, target: "5" })).toBe(400);
    expect(await bad({ ...productBody, url: "javascript:alert(1)" })).toBe(400);
    expect(await bad({ ...productBody, productId: "" })).toBe(400);
    expect(await bad({ ...productBody, query: "x".repeat(201) })).toBe(400);
    expect(await bad({ kind: "search", query: "airpods", sites: ["nope"], target: 100 })).toBe(400);
    expect(await bad({ kind: "other", query: "airpods", target: 100 })).toBe(400);
    expect(await bad("nope")).toBe(400);
    expect((await watches.PATCH(jsonReq("/api/watches", "PATCH", { id: 1 }))).status).toBe(400);
    expect((await watches.PATCH(jsonReq("/api/watches", "PATCH", { id: 1, status: "gone" }))).status).toBe(400);
    expect((await watches.DELETE(plain("/api/watches?id=abc", "DELETE"))).status).toBe(400);
  });

  it("creates, lists, edits, pauses and deletes watches", async () => {
    const r = await watches.POST(jsonReq("/api/watches", "POST", productBody));
    expect(r.status).toBe(201);
    const { watch } = (await r.json()) as { watch: { id: number } };
    const again = await watches.POST(jsonReq("/api/watches", "POST", { ...productBody, target: 460 }));
    expect(again.status).toBe(200);
    expect(await again.json()).toMatchObject({ updated: true, watch: { id: watch.id, target: 460 } });
    const s = await watches.POST(jsonReq("/api/watches", "POST", { kind: "search", query: "airpods 4", sites: ["jarir", "jarir", "noon-sa"], target: 480 }));
    expect(await s.json()).toMatchObject({ watch: { kind: "search", sites: ["jarir", "noon-sa"] } });

    const list = (await (await watches.GET(plain("/api/watches"))).json()) as { watches: { id: number; lowest: number | null; points: unknown[] }[] };
    expect(list.watches).toHaveLength(2);
    expect(list.watches.find((w) => w.id === watch.id)).toMatchObject({ lowest: 499, lastPrice: 499, points: [{ price: 499 }] });

    const p = await watches.PATCH(jsonReq("/api/watches", "PATCH", { id: watch.id, status: "paused", target: 450 }));
    expect(await p.json()).toMatchObject({ watch: { status: "paused", target: 450, lastFiredPrice: null } });
    expect((await watches.PATCH(jsonReq("/api/watches", "PATCH", { id: 999, status: "paused" }))).status).toBe(404);
    expect((await watches.DELETE(plain(`/api/watches?id=${watch.id}`, "DELETE"))).status).toBe(200);
    expect((await watches.DELETE(plain(`/api/watches?id=${watch.id}`, "DELETE"))).status).toBe(404);
  });

  it("stores a search watch's filters and never duplicates the same search watch", async () => {
    const body = { kind: "search", query: "AirPods 4", sites: ["jarir", "noon-sa"], target: 480, filters: { minPrice: 100, minRating: 4 } };
    const first = await watches.POST(jsonReq("/api/watches", "POST", body));
    expect(first.status).toBe(201);
    const { watch } = (await first.json()) as { watch: { id: number; filters: unknown } };
    expect(watch.filters).toEqual({ minPrice: 100, minRating: 4 });
    const again = await watches.POST(jsonReq("/api/watches", "POST", { ...body, query: "  airpods   4 ", sites: ["noon-sa", "jarir"], filters: { maxPrice: 900 } }));
    expect(again.status).toBe(200);
    expect(await again.json()).toMatchObject({ updated: true, watch: { id: watch.id, filters: { maxPrice: 900 } } });
    const other = await watches.POST(jsonReq("/api/watches", "POST", { ...body, target: 470 }));
    expect(other.status).toBe(201);
    const list = (await (await watches.GET(plain("/api/watches"))).json()) as { watches: unknown[] };
    expect(list.watches).toHaveLength(2);
    expect((await watches.POST(jsonReq("/api/watches", "POST", { ...body, filters: { minRating: 9 } }))).status).toBe(400);
    expect((await watches.POST(jsonReq("/api/watches", "POST", { ...body, filters: { minPrice: "5" } }))).status).toBe(400);
  });

  it("answers 500 with a plain message when the database fails", async () => {
    state.dbFails = true;
    const r = await watches.GET(plain("/api/watches"));
    expect(r.status).toBe(500);
    expect(await r.json()).toEqual({ error: "Could not use the local database" });
  });
});

describe("/api/search records history", () => {
  const body = { query: "airpods 4", sites: ["jarir"], sort: "price", maxPrice: 900 };
  it("adds an entry with the cheapest confident match", async () => {
    const r = await search.POST(jsonReq("/api/search", "POST", body));
    expect(r.status).toBe(200);
    const h = (await (await history.GET(plain("/api/history"))).json()) as { items: unknown[] };
    expect(h.items).toEqual([
      expect.objectContaining({ query: "airpods 4", sites: ["jarir"], sort: "price", filters: { maxPrice: 900 }, resultCount: 1, cheapest: expect.objectContaining({ price: 499, site: "jarir" }) }),
    ]);
  });
  it("records nothing when no store answered ok", async () => {
    const { runSearch } = await import("@/src/lib/pipeline");
    vi.mocked(runSearch).mockResolvedValueOnce({ products: [], statuses: [{ site: "jarir", status: "blocked" }], queryTokens: [] });
    const r = await search.POST(jsonReq("/api/search", "POST", body));
    expect(r.status).toBe(200);
    expect(((await (await history.GET(plain("/api/history"))).json()) as { items: unknown[] }).items).toHaveLength(0);
  });
  it("still answers the search when the database fails", async () => {
    state.dbFails = true;
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const r = await search.POST(jsonReq("/api/search", "POST", body));
    expect(r.status).toBe(200);
    expect(((await r.json()) as { products: unknown[] }).products).toHaveLength(1);
    expect(warn).toHaveBeenCalledWith("[history] could not record the search", "disk I/O error");
    warn.mockRestore();
  });
});

describe("/api/history", () => {
  it("deletes one entry or clears all, and validates", async () => {
    await search.POST(jsonReq("/api/search", "POST", { query: "a", sites: ["jarir"] }));
    await search.POST(jsonReq("/api/search", "POST", { query: "b", sites: ["jarir"] }));
    const items = ((await (await history.GET(plain("/api/history"))).json()) as { items: { id: number }[] }).items;
    expect((await history.DELETE(plain("/api/history", "DELETE"))).status).toBe(400);
    expect((await history.DELETE(plain(`/api/history?id=${items[0].id}`, "DELETE"))).status).toBe(200);
    expect((await history.DELETE(plain(`/api/history?id=${items[0].id}`, "DELETE"))).status).toBe(404);
    expect((await history.DELETE(plain("/api/history?all=1", "DELETE"))).status).toBe(200);
    expect(((await (await history.GET(plain("/api/history"))).json()) as { items: unknown[] }).items).toHaveLength(0);
  });
});

describe("/api/alerts", () => {
  it("reports events, unread count and Telegram status without the token", async () => {
    vi.stubEnv("TELEGRAM_BOT_TOKEN", "123:SECRET");
    vi.stubEnv("TELEGRAM_CHAT_ID", "42");
    addEvent(state.db, { watchId: null, at: 1, title: "T", site: "jarir", oldPrice: 500, newPrice: 400, target: 450, currency: "SAR", url: null, sent: true });
    const r = await alerts.GET(plain("/api/alerts"));
    const text = await r.text();
    expect(text).not.toContain("SECRET");
    expect(JSON.parse(text)).toMatchObject({ unread: 1, telegram: { configured: true }, events: [{ newPrice: 400 }] });
    const first = addEvent(state.db, { watchId: null, at: 1, title: "T", site: "jarir", oldPrice: 500, newPrice: 400, target: 450, currency: "SAR", url: null, sent: true }) - 1;
    expect((await seen.POST(jsonReq("/api/alerts/seen", "POST", {}))).status).toBe(400);
    expect((await seen.POST(jsonReq("/api/alerts/seen", "POST", { upTo: -1 }))).status).toBe(400);
    expect((await seen.POST(jsonReq("/api/alerts/seen", "POST", { upTo: "1" }))).status).toBe(400);
    // The page showed only the first alert; the second fired after it loaded and stays unread.
    expect((await seen.POST(jsonReq("/api/alerts/seen", "POST", { upTo: first }))).status).toBe(200);
    expect(((await (await alerts.GET(plain("/api/alerts"))).json()) as { unread: number }).unread).toBe(1);
  });
  it("test-telegram answers a setup hint when not configured", async () => {
    vi.stubEnv("TELEGRAM_BOT_TOKEN", "");
    vi.stubEnv("TELEGRAM_CHAT_ID", "");
    const r = await testTelegram.POST(jsonReq("/api/alerts/test-telegram", "POST", {}));
    expect(r.status).toBe(400);
    expect(((await r.json()) as { error: string }).error).toContain("TELEGRAM_BOT_TOKEN");
  });
});

describe("product watches on branch-pickup-only listings (SACO)", () => {
  const sacoUrl = "https://www.saco.sa/en/product/x-p-000000000000103346";
  const saco: Product = { ...product, site: "saco-sa", id: "103346", title: "Air fryer 4L", url: sacoUrl, pickupOnly: true };
  const body = { kind: "product", site: "saco-sa", productId: "103346", query: "air fryer", target: 200, title: "Air fryer 4L", url: sacoUrl, price: 229 };

  it("refuses one the latest search listed as pickup only, even when the page does not say so", async () => {
    recordSeen(state.db, [saco], 10);
    const r = await watches.POST(jsonReq("/api/watches", "POST", body));
    expect(r.status).toBe(400);
    expect(((await r.json()) as { error: string }).error).toContain("pickup");
  });
  it("accepts it once a later search lists it as deliverable", async () => {
    recordSeen(state.db, [saco], 10);
    recordSeen(state.db, [{ ...saco, pickupOnly: undefined }], 20);
    expect((await watches.POST(jsonReq("/api/watches", "POST", body))).status).toBe(201);
  });
  it("an older search does not overwrite a newer state", async () => {
    recordSeen(state.db, [saco], 20);
    recordSeen(state.db, [{ ...saco, pickupOnly: undefined }], 10);
    expect((await watches.POST(jsonReq("/api/watches", "POST", body))).status).toBe(400);
  });
  it("falls back to the saved snapshot when no search has listed it", async () => {
    addFavourite(state.db, { site: "saco-sa", id: "103346", title: "Air fryer 4L", url: sacoUrl, image: null, price: 229, currency: "SAR", query: "air fryer", pickupOnly: true });
    expect((await watches.POST(jsonReq("/api/watches", "POST", body))).status).toBe(400);
  });
  it("an unknown product is still accepted (nothing says it is pickup only)", async () => {
    expect((await watches.POST(jsonReq("/api/watches", "POST", body))).status).toBe(201);
  });
});
