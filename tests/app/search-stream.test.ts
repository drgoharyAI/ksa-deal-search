import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fixture from "../fixtures/aliexpress-search.json";
import type { Db } from "@/src/lib/db";
import type { AaResult } from "@/src/lib/aa";
import type { StreamEvent } from "@/src/lib/search-stream";

const state = vi.hoisted(() => ({ db: null as unknown as Db }));

vi.mock("@/src/lib/aa", () => ({ aaCall: vi.fn(), backoffEndsAt: vi.fn(() => undefined) }));
vi.mock("@/src/lib/db", async (orig) => {
  const real = await orig<typeof import("@/src/lib/db")>();
  return { ...real, getDb: () => state.db };
});
vi.mock("@/src/lib/alerts/service", () => ({ ensureChecker: () => {} }));
vi.mock("@/src/lib/discover", async (orig) => {
  const real = await orig<typeof import("@/src/lib/discover")>();
  return { ...real, recordSeen: vi.fn(real.recordSeen) };
});

const { aaCall, backoffEndsAt } = await import("@/src/lib/aa");
const { recordSeen } = await import("@/src/lib/discover");
const { openDb } = await import("@/src/lib/db");
const { sites } = await import("@/src/sites/registry");
const search = await import("@/app/api/search/route");
const stream = await import("@/app/api/search/stream/route");

type RunCall = NonNullable<(typeof sites)[string]["runCall"]>;

const aa = vi.mocked(aaCall);
const ok = (data: unknown[]): AaResult => ({ ok: true, tier: 1, data });

/** A store answering when the test says so; it records the signal each call got. */
function deferredStore(id: string) {
  let release: (r: AaResult) => void = () => {};
  const gate = new Promise<AaResult>((r) => (release = r));
  const signals: (AbortSignal | undefined)[] = [];
  const runCall: RunCall = (_call, opts) => {
    signals.push(opts?.signal);
    return gate;
  };
  sites[id] = {
    id,
    label: id,
    searchCalls: () => [{ op: "search", args: { q: "x" } }],
    runCall,
    normalizeSearchItem: (raw) => {
      const p = sites.aliexpress.normalizeSearchItem(raw);
      return p && { ...p, site: id };
    },
  };
  return { release, signals };
}

const body = (o: Record<string, unknown> = {}) => JSON.stringify({ query: "anc earbuds", sites: ["aliexpress", "slow"], sort: "price", ...o });
const req = (path: string, b = body(), headers: Record<string, string> = {}) =>
  new Request(`http://127.0.0.1:3000${path}`, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: b });

/** Reads NDJSON events until `until` is true (or the stream ends); the reader stays usable. */
async function readEvents(reader: ReadableStreamDefaultReader<Uint8Array>, out: StreamEvent[], until: (e: StreamEvent[]) => boolean) {
  const dec = new TextDecoder();
  let buf = "";
  while (!until(out)) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const lines = buf.split("\n");
    buf = lines.pop() ?? "";
    for (const l of lines) if (l.trim()) out.push(JSON.parse(l) as StreamEvent);
  }
  return out;
}
const tick = () => new Promise((r) => setTimeout(r, 0));
const observations = () => (state.db.prepare("SELECT count(*) n FROM observations").get() as { n: number }).n;
const historyRows = () => (state.db.prepare("SELECT count(*) n FROM searches").get() as { n: number }).n;
const strip = (e: StreamEvent): Record<string, unknown> => {
  const rest: Record<string, unknown> = { ...e };
  delete rest.type;
  return rest;
};

beforeEach(() => {
  state.db = openDb(":memory:");
  aa.mockReset();
  aa.mockImplementation(async () => ok(fixture.data));
  vi.mocked(recordSeen).mockClear();
  vi.mocked(backoffEndsAt).mockReset();
});
afterEach(() => {
  state.db.close();
  delete sites.slow;
  delete sites.walled;
  delete sites.broken;
  vi.restoreAllMocks();
});

describe("POST /api/search/stream", () => {
  it("streams searching lines, then each store's line and the view, then done; records once", async () => {
    const slow = deferredStore("slow");
    const res = await stream.POST(req("/api/search/stream"));
    expect(res.headers.get("content-type")).toBe("application/x-ndjson; charset=utf-8");
    const reader = res.body!.getReader();
    const events: StreamEvent[] = [];
    await readEvents(reader, events, (e) => e.some((x) => x.type === "results"));
    expect(events.slice(0, 2)).toEqual([
      { type: "store", store: "aliexpress", state: "searching" },
      { type: "store", store: "slow", state: "searching" },
    ]);
    // AliExpress answered first: its line, then a view with its listings only.
    const first = events[2] as Extract<StreamEvent, { type: "store" }>;
    expect(first).toMatchObject({ type: "store", store: "aliexpress", state: "ok" });
    expect(first.count).toBeGreaterThan(0);
    const partial = events[3] as Extract<StreamEvent, { type: "results" }>;
    expect(partial.type).toBe("results");
    expect(partial.statuses).toEqual([{ site: "aliexpress", status: "ok" }]);
    expect(new Set(partial.products.map((p) => p.site))).toEqual(new Set(["aliexpress"]));
    // Nothing recorded before the last store answered.
    expect(historyRows()).toBe(0);
    expect(recordSeen).not.toHaveBeenCalled();

    slow.release(ok(fixture.data.slice(0, 5)));
    await readEvents(reader, events, () => false);
    expect(events.map((e) => (e.type === "store" ? `${e.store}:${e.state}` : e.type))).toEqual([
      "aliexpress:searching",
      "slow:searching",
      "aliexpress:ok",
      "results",
      "slow:ok",
      "results",
      "done",
    ]);
    expect(historyRows()).toBe(1);
    expect(recordSeen).toHaveBeenCalledTimes(1);
  });

  it("the final results event equals what POST /api/search returns for the same input", async () => {
    deferredStore("slow").release(ok(fixture.data.slice(3, 12)));
    const plain = (await (await search.POST(req("/api/search"))).json()) as Record<string, unknown>;

    state.db.close();
    state.db = openDb(":memory:"); // the same database state as the plain search had
    const res = await stream.POST(req("/api/search/stream"));
    const events = await readEvents(res.body!.getReader(), [], () => false);
    const finals = events.filter((e) => e.type === "results");
    expect(events.at(-1)).toEqual({ type: "done" });
    expect(JSON.parse(JSON.stringify(strip(finals.at(-1)!)))).toEqual(plain);
    expect((plain.products as unknown[]).length).toBeGreaterThan(0);
  });

  it("client abort: no more events, no history, the answered stores' prices recorded once; the waiting call sees the abort", async () => {
    const slow = deferredStore("slow");
    const res = await stream.POST(req("/api/search/stream"));
    const reader = res.body!.getReader();
    await readEvents(reader, [], (e) => e.some((x) => x.type === "results"));
    expect(slow.signals[0]?.aborted).toBe(false);
    expect(observations()).toBe(0);
    await reader.cancel();
    expect(slow.signals[0]?.aborted).toBe(true);
    // Recorded at the abort, for AliExpress only (the store answered by then).
    expect(recordSeen).toHaveBeenCalledTimes(1);
    const seen = vi.mocked(recordSeen).mock.calls[0][1];
    expect(seen.length).toBeGreaterThan(0);
    expect(new Set(seen.map((p) => p.site))).toEqual(new Set(["aliexpress"]));
    expect(observations()).toBe(seen.length);
    slow.release(ok(fixture.data));
    await tick();
    await tick();
    expect(historyRows()).toBe(0);
    expect(recordSeen).toHaveBeenCalledTimes(1);
    expect(observations()).toBe(seen.length);
  });

  it("an abort before any store answered records nothing", async () => {
    const slow = deferredStore("slow");
    const res = await stream.POST(req("/api/search/stream", body({ sites: ["slow"] })));
    const reader = res.body!.getReader();
    await readEvents(reader, [], (e) => e.length > 0);
    await reader.cancel();
    slow.release(ok(fixture.data));
    await tick();
    expect(recordSeen).not.toHaveBeenCalled();
    expect(observations()).toBe(0);
    expect(historyRows()).toBe(0);
  });

  it("after a failure in the assemble step: one plain error event, and nothing recorded later", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const slow = deferredStore("slow");
    // A listing whose title is not text passes normalization but breaks matching.
    sites.broken = {
      id: "broken",
      label: "Broken",
      searchCalls: () => [{ op: "search", args: {} }],
      runCall: async () => ok([{}]),
      normalizeSearchItem: () => ({ ...(sites.aliexpress.normalizeSearchItem(fixture.data[0]) as object), site: "broken", title: { length: 1 } }) as never,
    };
    aa.mockImplementation(() => new Promise(() => {})); // AliExpress never answers
    const res = await stream.POST(req("/api/search/stream", body({ sites: ["aliexpress", "broken", "slow"] })));
    const reader = res.body!.getReader();
    const events = await readEvents(reader, [], (e) => e.some((x) => x.type === "error"));
    expect(events.at(-1)).toEqual({ type: "error", error: "The search failed; try again" });
    expect(JSON.stringify(events)).not.toMatch(/toLowerCase|TypeError/);
    slow.release(ok(fixture.data));
    await tick();
    await tick();
    expect(historyRows()).toBe(0);
    expect(recordSeen).not.toHaveBeenCalled();
    expect(observations()).toBe(0);
    expect(warn).toHaveBeenCalledWith("[search/stream] search failed", expect.any(String));
  });

  it("maps store failures to unavailable (with the retry time) and failed, without internal text", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const until = Date.now() + 60_000;
    sites.walled = {
      id: "walled",
      label: "Walled",
      searchCalls: () => [{ op: "search", args: {} }],
      runCall: async () => ({ ok: false, class: "blocked", reason: "challenge page at /internal/secret" }),
      blockedEndsAt: () => until,
      normalizeSearchItem: () => null,
    };
    sites.broken = {
      id: "broken",
      label: "Broken",
      searchCalls: () => [{ op: "search", args: {} }],
      runCall: async () => {
        throw new Error("ECONNRESET at C:\\secret\\path");
      },
      normalizeSearchItem: () => null,
    };
    aa.mockResolvedValue({ ok: false, class: "rate", reason: "HTTP 429 secret-token" });
    vi.mocked(backoffEndsAt).mockReturnValue(until + 5);

    const res = await stream.POST(req("/api/search/stream", body({ sites: ["aliexpress", "walled", "broken"] })));
    const text = await res.text();
    const events = text.trim().split("\n").map((l) => JSON.parse(l) as StreamEvent);
    const lines = events.filter((e): e is Extract<StreamEvent, { type: "store" }> => e.type === "store" && e.state !== "searching");
    expect(Object.fromEntries(lines.map((e) => [e.store, e]))).toEqual({
      aliexpress: { type: "store", store: "aliexpress", state: "unavailable", retryAt: until + 5 },
      walled: { type: "store", store: "walled", state: "unavailable", retryAt: until },
      broken: { type: "store", store: "broken", state: "failed" },
    });
    expect(text).not.toMatch(/secret|ECONNRESET|HTTP 429/); // not a bare 429: retryAt is a number
    expect(events.at(-1)).toEqual({ type: "done" });
    expect(historyRows()).toBe(0); // no store answered: not a successful search
  });

  it("keeps the /api/search guard and input errors (plain JSON, before any stream)", async () => {
    const cross = await stream.POST(req("/api/search/stream", body(), { origin: "https://evil.example" }));
    expect(cross.status).toBe(403);
    const empty = await stream.POST(req("/api/search/stream", body({ query: "  " })));
    expect(empty.status).toBe(400);
    expect(await empty.json()).toEqual({ error: "Enter something to search for" });
    const none = await stream.POST(req("/api/search/stream", body({ sites: ["constructor"] })));
    expect(await none.json()).toEqual({ error: "Pick at least one store" });
    const type = await stream.POST(new Request("http://127.0.0.1:3000/api/search/stream", { method: "POST", headers: { "content-type": "text/plain" }, body: body() }));
    expect(type.status).toBe(415);
    expect(aa).not.toHaveBeenCalled();
  });
});
