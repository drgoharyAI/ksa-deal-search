import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "@/src/lib/db";

/** Code review round: request body caps, client aborts, and the owner's safety caps. */

const state = vi.hoisted(() => ({ db: null as unknown as Db }));

vi.mock("@/src/lib/db", async (orig) => {
  const real = await orig<typeof import("@/src/lib/db")>();
  return { ...real, getDb: () => state.db };
});

vi.mock("@/src/lib/pipeline", () => ({
  runSearch: vi.fn(async () => ({ products: [], statuses: [{ site: "jarir", status: "ok" }], queryTokens: [] })),
}));

vi.mock("@/src/lib/telegram", async (orig) => {
  const real = await orig<typeof import("@/src/lib/telegram")>();
  return { ...real, sendTelegram: vi.fn(async () => ({ ok: true })) };
});

const { openDb } = await import("@/src/lib/db");
const { runSearch } = await import("@/src/lib/pipeline");
const { sendTelegram } = await import("@/src/lib/telegram");
const { readJsonCapped, TOO_LARGE } = await import("@/src/lib/api");
const { limiters, MAX_WATCHES } = await import("@/src/lib/limits");
const { createSearchGate, searchGate } = await import("@/src/lib/search-gate");
const { createWatch } = await import("@/src/lib/alerts/repo");
const search = await import("@/app/api/search/route");
const stream = await import("@/app/api/search/stream/route");
const watches = await import("@/app/api/watches/route");
const seen = await import("@/app/api/alerts/seen/route");
const testTelegram = await import("@/app/api/alerts/test-telegram/route");

const BASE = "http://127.0.0.1:3000";
const jsonReq = (path: string, method: string, body: unknown) =>
  new Request(`${BASE}${path}`, { method, headers: { "content-type": "application/json" }, body: typeof body === "string" ? body : JSON.stringify(body) });

/** A chunked body (no Content-Length) of `chunks` 1 KB pieces; `pulled` counts what was read. */
function chunked(path: string, chunks: number) {
  const counter = { pulled: 0 };
  const piece = new TextEncoder().encode(`"${"x".repeat(1022)}"`.slice(0, 1024));
  const body = new ReadableStream<Uint8Array>({
    pull(c) {
      if (counter.pulled >= chunks) {
        c.close();
        return;
      }
      counter.pulled += 1;
      c.enqueue(piece);
    },
  });
  const req = new Request(`${BASE}${path}`, { method: "POST", headers: { "content-type": "application/json" }, body, duplex: "half" } as RequestInit);
  return { req, counter };
}

beforeEach(() => {
  state.db = openDb(":memory:");
  limiters.telegramTest.clear();
  limiters.rearm.clear();
  vi.mocked(runSearch).mockClear();
  vi.mocked(sendTelegram).mockClear();
});
afterEach(() => state.db.close());

describe("request bodies are read with a byte cap", () => {
  it("stops reading a chunked body at the cap, never buffering it all", async () => {
    const { req, counter } = chunked("/api/search", 1_000_000);
    expect(await readJsonCapped(req, 8_192)).toBe(TOO_LARGE);
    expect(counter.pulled).toBeLessThan(20);
  });

  it("refuses a declared Content-Length over the cap without reading", async () => {
    const req = new Request(`${BASE}/x`, { method: "POST", headers: { "content-length": "999999" }, body: "{}" });
    expect(await readJsonCapped(req, 8_192)).toBe(TOO_LARGE);
  });

  it("reads a small body, multi-byte text included", async () => {
    expect(await readJsonCapped(jsonReq("/x", "POST", { q: "سماعة" }), 8_192)).toEqual({ q: "سماعة" });
    expect(await readJsonCapped(jsonReq("/x", "POST", "not json"), 8_192)).toBeUndefined();
  });

  it("answers 413 on every JSON route, chunked bodies included", async () => {
    const big = { query: "airpods", sites: ["jarir"], pad: "x".repeat(9_000) };
    expect((await search.POST(jsonReq("/api/search", "POST", big))).status).toBe(413);
    expect((await stream.POST(jsonReq("/api/search/stream", "POST", big))).status).toBe(413);
    expect((await watches.POST(jsonReq("/api/watches", "POST", big))).status).toBe(413);
    expect((await watches.PATCH(jsonReq("/api/watches", "PATCH", big))).status).toBe(413);
    expect((await seen.POST(jsonReq("/api/alerts/seen", "POST", big))).status).toBe(413);
    const { req, counter } = chunked("/api/search", 1_000_000);
    expect((await search.POST(req)).status).toBe(413);
    expect(counter.pulled).toBeLessThan(20);
    expect(runSearch).not.toHaveBeenCalled();
  });
});

describe("POST /api/search passes the request's signal", () => {
  it("so a client that leaves aborts the store calls still queued", async () => {
    const req = jsonReq("/api/search", "POST", { query: "airpods", sites: ["jarir"] });
    expect((await search.POST(req)).status).toBe(200);
    expect(vi.mocked(runSearch).mock.calls[0][1]).toMatchObject({ signal: req.signal });
  });
});

describe("safety caps", () => {
  it("test-telegram sends at most once a minute", async () => {
    const r1 = await testTelegram.POST(jsonReq("/api/alerts/test-telegram", "POST", {}));
    expect(r1.status).toBe(200);
    const r2 = await testTelegram.POST(jsonReq("/api/alerts/test-telegram", "POST", {}));
    expect(r2.status).toBe(429);
    expect(await r2.json()).toEqual({ error: "Wait a minute before sending another test" });
    expect(sendTelegram).toHaveBeenCalledTimes(1);
  });

  it("keeps at most 100 watches", async () => {
    for (let i = 0; i < MAX_WATCHES; i++) createWatch(state.db, { kind: "search", site: null, productId: null, query: `q${i}`, sites: ["jarir"], target: 10 }, 0);
    const r = await watches.POST(jsonReq("/api/watches", "POST", { kind: "search", query: "new", sites: ["jarir"], target: 10 }));
    expect(r.status).toBe(409);
    expect(((await r.json()) as { error: string }).error).toContain("100");
  });

  it("re-arms a watch through PATCH at most once a minute", async () => {
    const id = createWatch(state.db, { kind: "search", site: null, productId: null, query: "q", sites: ["jarir"], target: 10 }, 0);
    expect((await watches.PATCH(jsonReq("/api/watches", "PATCH", { id, target: 9 }))).status).toBe(200);
    const r = await watches.PATCH(jsonReq("/api/watches", "PATCH", { id, target: 8 }));
    expect(r.status).toBe(429);
    expect(await r.json()).toEqual({ error: "Wait a minute before changing this alert again" });
    // pausing is not a re-arm
    expect((await watches.PATCH(jsonReq("/api/watches", "PATCH", { id, status: "paused" }))).status).toBe(200);
  });

  it("re-arms an existing watch through POST at most once a minute too", async () => {
    const body = { kind: "search", query: "q", sites: ["jarir"], target: 10 };
    expect((await watches.POST(jsonReq("/api/watches", "POST", body))).status).toBe(201);
    expect((await watches.POST(jsonReq("/api/watches", "POST", body))).status).toBe(200);
    const r = await watches.POST(jsonReq("/api/watches", "POST", body));
    expect(r.status).toBe(429);
    expect(await r.json()).toEqual({ error: "Wait a minute before changing this alert again" });
  });

  it("answers 503 with Retry-After when every lane and the line are full", async () => {
    const gate = searchGate();
    const held = await Promise.all(Array.from({ length: 4 }, () => gate.acquire("user")));
    const waiting = Array.from({ length: 8 }, () => gate.acquire("user"));
    try {
      for (const r of [
        await search.POST(jsonReq("/api/search", "POST", { query: "airpods", sites: ["jarir"] })),
        await stream.POST(jsonReq("/api/search/stream", "POST", { query: "airpods", sites: ["jarir"] })),
      ]) {
        expect(r.status).toBe(503);
        expect(r.headers.get("retry-after")).toBe("5");
        expect(await r.json()).toEqual({ error: "Busy, try again in a moment" });
      }
    } finally {
      for (const h of held) h?.();
      for (const w of waiting) (await w)?.(); // each release hands its lane to the next waiter
    }
    expect(gate.running).toBe(0);
  });
});

describe("search gate", () => {
  it("runs 4 at once, queues 8 users first come first served, refuses the rest", async () => {
    const gate = createSearchGate(4, 8);
    const lanes = await Promise.all(Array.from({ length: 4 }, () => gate.acquire("user")));
    const order: number[] = [];
    const queued = Array.from({ length: 8 }, (_, i) => gate.acquire("user").then((r) => (order.push(i), r)));
    expect(await gate.acquire("user")).toBeNull();
    expect(gate.waiting).toBe(8);
    for (const l of lanes) l?.();
    const granted = await Promise.all(queued.slice(0, 4));
    expect(order).toEqual([0, 1, 2, 3]);
    expect(gate.running).toBe(4);
    for (const g of granted) g?.();
    for (const g of await Promise.all(queued.slice(4))) g?.();
    expect(gate.running).toBe(0);
  });

  it("a checker search is never refused and is not starved", async () => {
    const gate = createSearchGate(1, 1);
    const lane = await gate.acquire("user");
    const user = gate.acquire("user");
    const checker = gate.acquire("checker");
    expect(await gate.acquire("user")).toBeNull();
    lane?.();
    (await user)?.();
    const c = await checker;
    expect(c).not.toBeNull();
    c?.();
    expect(gate.running).toBe(0);
  });

  it("a user who leaves while waiting gives up the place", async () => {
    const gate = createSearchGate(1, 1);
    const lane = await gate.acquire("user");
    const ctrl = new AbortController();
    const waiting = gate.acquire("user", ctrl.signal);
    ctrl.abort();
    expect(await waiting).toBeNull();
    expect(gate.waiting).toBe(0);
    lane?.();
    expect(gate.running).toBe(0);
  });
});
