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

const { openDb } = await import("@/src/lib/db");
const { recordSeen } = await import("@/src/lib/discover");
const route = await import("@/app/api/discover/route");

const BASE = "http://127.0.0.1:3000";
const get = (headers: Record<string, string> = {}) => new Request(`${BASE}/api/discover`, { headers });

beforeEach(() => {
  state.db = openDb(":memory:");
  state.dbFails = false;
});
afterEach(() => state.db.close());

describe("GET /api/discover", () => {
  it("answers an empty list with no data, uncached", async () => {
    const r = await route.GET(get());
    expect(r.status).toBe(200);
    expect(r.headers.get("cache-control")).toBe("no-store");
    expect(await r.json()).toEqual({ items: [] });
  });
  it("lists a recorded drop", async () => {
    const now = Date.now();
    recordSeen(state.db, [{ site: "noon-sa", id: "N1", title: "Kettle", listPrice: 80, origPrice: null, discountPct: null, currency: "SAR", rating: null, soldCount: 0, image: "", url: "https://noon.example/N1", detailStatus: "ok" }], now);
    const ins = state.db.prepare("INSERT INTO observations (site, productId, price, origPrice, at) VALUES ('noon-sa', 'N1', ?, NULL, ?)");
    ins.run(100, now - 2 * 86_400_000);
    ins.run(80, now - 60_000);
    const d = (await (await route.GET(get())).json()) as { items: { id: string; dropPct: number; price: number }[] };
    expect(d.items).toHaveLength(1);
    expect(d.items[0]).toMatchObject({ id: "N1", price: 80, dropPct: 20 });
  });
  it("refuses cross-site requests", async () => {
    expect((await route.GET(get({ "sec-fetch-site": "cross-site" }))).status).toBe(403);
    expect((await route.GET(get({ origin: "https://evil.example" }))).status).toBe(403);
    expect((await route.GET(new Request("http://evil.example/api/discover"))).status).toBe(403);
  });
  it("a database failure is a plain 500", async () => {
    state.dbFails = true;
    const r = await route.GET(get());
    expect(r.status).toBe(500);
    expect(await r.json()).toEqual({ error: "Could not use the local database" });
  });
});
