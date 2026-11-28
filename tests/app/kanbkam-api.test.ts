import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "@/src/lib/db";

const state = vi.hoisted(() => ({ db: null as unknown as Db }));

vi.mock("@/src/lib/db", async (orig) => {
  const real = await orig<typeof import("@/src/lib/db")>();
  return { ...real, getDb: () => state.db };
});

const { openDb } = await import("@/src/lib/db");
const { resetKanbkam } = await import("@/src/lib/kanbkam/service");
const route = await import("@/app/api/kanbkam/route");

const PAGE = fs.readFileSync(path.join(__dirname, "..", "fixtures", "kanbkam", "amazon-B09HGPKY7Q.html"), "utf8");
const BASE = "http://127.0.0.1:3000/api/kanbkam";
const JSON_TYPE = { "content-type": "application/json" };
const post = (body: unknown, headers: Record<string, string> = JSON_TYPE) => new Request(BASE, { method: "POST", headers, body: typeof body === "string" ? body : JSON.stringify(body) });

let fetches: string[];
const saved = { ...process.env };
beforeEach(() => {
  state.db = openDb(":memory:");
  resetKanbkam();
  fetches = [];
  vi.stubGlobal("fetch", async (url: string) => {
    fetches.push(url);
    return new Response(PAGE, { status: 200 });
  });
  process.env.KANBKAM_ENABLED = "1";
  const now = Date.now();
  state.db.prepare("INSERT INTO seen_products (site, productId, title, url, currency, lastSeen) VALUES ('amazon-sa', 'B09HGPKY7Q', 'JBL Flip 6', 'https://www.amazon.sa/dp/B09HGPKY7Q', 'SAR', ?)").run(now);
  state.db.prepare("INSERT INTO observations (site, productId, price, origPrice, at) VALUES ('amazon-sa', 'B09HGPKY7Q', 279, 399, ?)").run(now - 60_000);
});
afterEach(() => {
  state.db.close();
  vi.unstubAllGlobals();
  process.env = { ...saved };
});

describe("/api/kanbkam", () => {
  it("GET answers the status and any cached history without fetching", async () => {
    const r = await route.GET(new Request(`${BASE}?site=amazon-sa&id=B09HGPKY7Q`));
    expect(r.status).toBe(200);
    expect(r.headers.get("cache-control")).toBe("no-store");
    expect(await r.json()).toMatchObject({ status: { enabled: true, backedOffUntil: null }, result: null });
    expect(fetches).toHaveLength(0);
  });
  it("POST looks up a listing seen in a search, then GET has it cached", async () => {
    const r = await route.POST(post({ site: "amazon-sa", id: "B09HGPKY7Q" }));
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ result: { status: "ok", min: 269, max: 659, verdicts: [{ kind: "near-lowest" }] } });
    expect(fetches).toEqual(["https://www.kanbkam.com/sa/en/p-B09HGPKY7Q"]);
    const g = await route.GET(new Request(`${BASE}?site=amazon-sa&id=B09HGPKY7Q`));
    expect(await g.json()).toMatchObject({ result: { status: "ok", min: 269 } });
    expect(fetches).toHaveLength(1);
  });
  it("the kill switch: off answers 503 and fetches nothing", async () => {
    delete process.env.KANBKAM_ENABLED;
    const r = await route.POST(post({ site: "amazon-sa", id: "B09HGPKY7Q" }));
    expect(r.status).toBe(503);
    expect(await r.json()).toMatchObject({ status: { enabled: false } });
    expect(fetches).toHaveLength(0);
  });
  it("other stores, bad ids and injection attempts are refused before any fetch", async () => {
    for (const body of [
      { site: "jarir", id: "B09HGPKY7Q" },
      { site: "amazon-sa", id: "../../admin" },
      { site: "amazon-sa", id: "B09HGPKY7Q/../x" },
      { site: "amazon-sa", id: "https://evil.example" },
      { site: "amazon-sa", id: 5 },
      { site: "__proto__", id: "B09HGPKY7Q" },
    ]) {
      expect((await route.POST(post(body))).status).toBe(400);
    }
    expect((await route.GET(new Request(`${BASE}?site=amazon-sa&id=..%2F..%2Fx`))).status).toBe(400);
    expect(fetches).toHaveLength(0);
  });
  it("a listing never seen in a search is 404", async () => {
    expect((await route.POST(post({ site: "amazon-sa", id: "B0NOTSEEN1" }))).status).toBe(404);
  });
  it("over a cap answers 429 with no fetch", async () => {
    state.db.prepare("INSERT INTO kanbkam_usage (period, calls) VALUES (?, 200)").run(`day:${new Date().toISOString().slice(0, 10)}`);
    const r = await route.POST(post({ site: "amazon-sa", id: "B09HGPKY7Q" }));
    expect(r.status).toBe(429);
    expect(fetches).toHaveLength(0);
  });
  it("rejects cross-site requests, non-JSON bodies and oversized bodies", async () => {
    expect((await route.POST(post({ site: "amazon-sa", id: "B09HGPKY7Q" }, { ...JSON_TYPE, origin: "https://evil.example" }))).status).toBe(403);
    expect((await route.POST(post({ site: "amazon-sa", id: "B09HGPKY7Q" }, { "content-type": "text/plain" }))).status).toBe(415);
    expect((await route.POST(post("x".repeat(5_000)))).status).toBe(413);
    expect(fetches).toHaveLength(0);
  });
});
