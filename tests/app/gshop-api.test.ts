import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "@/src/lib/db";

const state = vi.hoisted(() => ({ db: null as unknown as Db, loads: 0 }));

vi.mock("@/src/lib/db", async (orig) => {
  const real = await orig<typeof import("@/src/lib/db")>();
  return { ...real, getDb: () => state.db };
});
// Never a real Chrome: the Google fallback gets a page that serves the saved results fixture.
vi.mock("@/src/lib/gshop/browser", () => ({
  withGshopPage: async <T,>(fn: (p: unknown) => Promise<T>) => {
    const html = fs.readFileSync(path.join(__dirname, "..", "fixtures", "gshop", "google-results-jbl-flip-6.html"), "utf8");
    let url = "about:blank";
    return fn({
      goto: async (u: string) => {
        state.loads++;
        url = u;
      },
      url: () => url,
      content: async () => html,
      clickCard: async () => {
        state.loads++;
      },
      wait: async () => {},
    });
  },
}));

const { openDb } = await import("@/src/lib/db");
const { resetGshopFlights } = await import("@/src/lib/gshop/service");
const route = await import("@/app/api/gshop/validate/route");
const { clientKeyOf } = await import("@/src/lib/gshop/rate");

const BASE = "http://127.0.0.1:3000/api/gshop/validate";
const JSON_TYPE = { "content-type": "application/json" };
const post = (body: unknown, headers: Record<string, string> = JSON_TYPE) => new Request(BASE, { method: "POST", headers, body: typeof body === "string" ? body : JSON.stringify(body) });

const saved = { ...process.env };
beforeEach(() => {
  state.db = openDb(":memory:");
  state.loads = 0;
  resetGshopFlights();
  delete process.env.SERPAPI_KEY;
  delete process.env.GSHOP_SOURCE;
  delete process.env.GSHOP_AUTO;
  const now = Date.now();
  state.db.prepare("INSERT INTO seen_products (site, productId, title, url, currency, lastSeen) VALUES ('noon-sa', 'N1', 'JBL Flip 6 Portable Bluetooth Speaker Waterproof Wireless', 'https://www.noon.com/saudi-en/N1/p/', 'SAR', ?)").run(now);
  state.db.prepare("INSERT INTO observations (site, productId, price, origPrice, at) VALUES ('noon-sa', 'N1', 349, NULL, ?)").run(now - 60_000);
});
afterEach(() => {
  state.db.close();
  process.env = { ...saved };
});

describe("/api/gshop/validate", () => {
  it("GET answers the status without fetching anything", async () => {
    const r = await route.GET(new Request(`${BASE}?site=noon-sa&id=N1`));
    expect(r.status).toBe(200);
    expect(r.headers.get("cache-control")).toBe("no-store");
    const d = (await r.json()) as { status: { serpapi: { enabled: boolean; left: number } }; result: unknown };
    expect(d.status.serpapi).toMatchObject({ enabled: false, left: 240 });
    expect(d.result).toBeNull();
    expect(state.loads).toBe(0);
  });
  it("POST checks a product seen in a search (no key: Google directly) and caches it", async () => {
    const r = await route.POST(post({ site: "noon-sa", id: "N1" }));
    expect(r.status).toBe(200);
    const d = (await r.json()) as { result: { verdict: string; source: string } };
    expect(d.result).toMatchObject({ verdict: "not-unique", source: "google" });
    expect(state.loads).toBe(2);
    const g = (await (await route.GET(new Request(`${BASE}?site=noon-sa&id=N1`))).json()) as { result: { verdict: string } };
    expect(g.result.verdict).toBe("not-unique");
  });
  it("rejects cross-site requests, non-JSON bodies and oversized bodies", async () => {
    expect((await route.POST(post({ site: "noon-sa", id: "N1" }, { ...JSON_TYPE, origin: "https://evil.example" }))).status).toBe(403);
    expect((await route.POST(post({ site: "noon-sa", id: "N1" }, { ...JSON_TYPE, "sec-fetch-site": "cross-site" }))).status).toBe(403);
    expect((await route.POST(post({ site: "noon-sa", id: "N1" }, { "content-type": "text/plain" }))).status).toBe(415);
    expect((await route.POST(post({ site: "noon-sa", id: "x".repeat(5000) }))).status).toBe(413);
    expect((await route.GET(new Request(BASE, { headers: { origin: "https://evil.example" } }))).status).toBe(403);
    expect(state.loads).toBe(0);
  });
  it("validates the body", async () => {
    expect((await route.POST(post("not json"))).status).toBe(400);
    expect((await route.POST(post({ site: "evil", id: "N1" }))).status).toBe(400);
    expect((await route.POST(post({ site: "noon-sa", id: "" }))).status).toBe(400);
    expect((await route.POST(post({ site: "noon-sa", id: 5 }))).status).toBe(400);
    expect((await route.POST(post({ site: "noon-sa", id: "N1", auto: "yes" }))).status).toBe(400);
    expect((await route.GET(new Request(`${BASE}?site=evil&id=N1`))).status).toBe(400);
  });
  it("answers 429 past the per-client cap, with no Google call; the tunnel's CF-Connecting-IP is the client", async () => {
    process.env.APP_HOSTS = "deals.example.com";
    for (let i = 0; i < 12; i++) {
      state.db.prepare("INSERT INTO seen_products (site, productId, title, url, currency, lastSeen) VALUES ('noon-sa', ?, 'JBL Flip 6 Portable Bluetooth Speaker Waterproof Wireless', 'https://www.noon.com/saudi-en/x/p/', 'SAR', ?)").run(`R${i}`, Date.now());
      state.db.prepare("INSERT INTO observations (site, productId, price, origPrice, at) VALUES ('noon-sa', ?, 349, NULL, ?)").run(`R${i}`, Date.now() - 60_000);
    }
    const tunnel = (id: string, ip: string) =>
      new Request("https://deals.example.com/api/gshop/validate", { method: "POST", headers: { ...JSON_TYPE, host: "deals.example.com", "cf-connecting-ip": ip }, body: JSON.stringify({ site: "noon-sa", id }) });
    // Not stamped by the tunnel relay: even a tunnel Host with CF-Connecting-IP is "local"
    // (tests/lib/tunnel-relay.test.ts covers the stamped case).
    expect(clientKeyOf(tunnel("x", "203.0.113.5"))).toBe("local");
    expect(clientKeyOf(new Request(BASE, { headers: { "x-forwarded-for": "1.2.3.4", "cf-connecting-ip": "5.6.7.8" } }))).toBe("local");
    // SerpApi answers from the documented fixtures (no live call, no Chrome).
    process.env.SERPAPI_KEY = "test-key";
    let serp = 0;
    vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
      const u = new URL(input instanceof URL ? input.href : typeof input === "string" ? input : input.url);
      if (u.pathname === "/account.json") return new Response(JSON.stringify({ plan_searches_left: 250 }));
      serp++;
      const name = u.searchParams.get("engine") === "google_shopping" ? "serpapi-shopping-jbl.json" : "serpapi-immersive-jbl.json";
      return new Response(fs.readFileSync(path.join(__dirname, "..", "fixtures", "gshop", name), "utf8"));
    });
    try {
      for (let i = 0; i < 10; i++) expect((await route.POST(tunnel(`R${i}`, "203.0.113.5"))).status).toBe(200);
      expect(serp).toBe(20);
      const r = await route.POST(tunnel("R10", "203.0.113.5"));
      expect(r.status).toBe(429);
      expect(await r.json()).toMatchObject({ error: "Too many checks right now; try again later" });
      expect(serp).toBe(20);
      expect(state.loads).toBe(0);
    } finally {
      vi.unstubAllGlobals();
    }
  });
  it("refuses a product never seen, and automatic checks while they are off", async () => {
    expect((await route.POST(post({ site: "noon-sa", id: "NOPE" }))).status).toBe(404);
    expect((await route.POST(post({ site: "noon-sa", id: "N1", auto: true }))).status).toBe(403);
    expect(state.loads).toBe(0);
  });
});
