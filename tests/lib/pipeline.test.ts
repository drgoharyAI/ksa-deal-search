import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fixture from "../fixtures/aliexpress-search.json";

vi.mock("@/src/lib/aa", () => ({ aaCall: vi.fn() }));

import { aaCall } from "@/src/lib/aa";
import { runSearch } from "@/src/lib/pipeline";
import { POST } from "@/app/api/search/route";
import { sites } from "@/src/sites/registry";

const mock = vi.mocked(aaCall);
const okFixture = async () => ({ ok: true as const, tier: 1, data: fixture.data });
const base = { sites: ["aliexpress"], sort: "price" as const };

beforeEach(() => mock.mockReset());

describe("runSearch", () => {
  it("anc earbuds under 50: priced <= 50, no accessories, status ok", async () => {
    mock.mockImplementation(okFixture);
    const r = await runSearch({ ...base, query: "anc earbuds under 50" });
    expect(r.products.length).toBeGreaterThan(0);
    for (const p of r.products) {
      expect(p.listPrice).toBeLessThanOrEqual(50);
      expect(p.title.toLowerCase()).not.toMatch(/\b(case|cover|tips?|pouch)\b/);
    }
    expect(r.statuses).toEqual([{ site: "aliexpress", status: "ok" }]);
    expect(r.queryTokens[0]).toEqual(expect.arrayContaining(["anc"]));
    // sorted ascending by price
    const prices = r.products.map((p) => p.listPrice);
    expect(prices).toEqual([...prices].sort((a, b) => a - b));
    // duplicates across calls collapsed
    const keys = r.products.map((p) => p.site + p.id);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("filler words are not required title words (final review I1)", async () => {
    mock.mockImplementation(okFixture);
    const plain = await runSearch({ ...base, query: "anc earbuds" });
    const filler = await runSearch({ ...base, query: "the best cheap anc earbuds" });
    expect(plain.products.length).toBeGreaterThan(0);
    expect(filler.queryTokens[0]).toEqual(["anc", "earbuds"]);
    expect(filler.products.map((p) => p.id)).toEqual(plain.products.map((p) => p.id));
    // the store still gets the shopper's own words
    expect(String(mock.mock.calls.at(-1)?.[2]?.q ?? JSON.stringify(mock.mock.calls.at(-1)))).toContain("best");
  });

  it("explicit filters override inline ones", async () => {
    mock.mockImplementation(okFixture);
    const r = await runSearch({ ...base, query: "anc earbuds under 50", maxPrice: 20 });
    expect(r.products.length).toBeGreaterThan(0);
    for (const p of r.products) expect(p.listPrice).toBeLessThanOrEqual(20);
  });

  it("all calls blocked -> blocked status, no products, no throw", async () => {
    mock.mockResolvedValue({ ok: false, class: "blocked", reason: "captcha" });
    const r = await runSearch({ ...base, query: "anc earbuds" });
    expect(r.products).toEqual([]);
    expect(r.statuses[0]).toEqual({ site: "aliexpress", status: "blocked", message: "Store blocked the request; try again later" });
  });

  it("all calls rate-limited -> blocked, generic client message, raw reason logged", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    mock.mockResolvedValue({ ok: false, class: "rate", reason: "429 secret-upstream-detail" });
    const r = await runSearch({ ...base, query: "anc earbuds" });
    expect(r.statuses[0]).toEqual({
      site: "aliexpress",
      status: "blocked",
      message: "Store blocked the request; try again later",
    });
    expect(JSON.stringify(r)).not.toContain("secret-upstream-detail");
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("blocked status uses generic message, not the raw reason", async () => {
    mock.mockResolvedValue({ ok: false, class: "blocked", reason: "captcha" });
    const r = await runSearch({ ...base, query: "anc earbuds" });
    expect(r.statuses[0].message).toBe("Store blocked the request; try again later");
  });

  it("a throwing adapter does not sink other sites", async () => {
    mock.mockImplementation(okFixture);
    const bad = {
      id: "bad",
      label: "Bad",
      searchCalls: () => {
        throw new Error("kaboom");
      },
      normalizeSearchItem: () => null,
      fetchDetail: async (p: never) => p,
    };
    sites.bad = bad;
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const r = await runSearch({ ...base, sites: ["bad", "aliexpress"], query: "anc earbuds" });
      expect(r.products.length).toBeGreaterThan(0);
      expect(r.statuses.find((s) => s.site === "bad")).toEqual({
        site: "bad",
        status: "error",
        message: "Store request failed",
      });
      expect(r.statuses.find((s) => s.site === "aliexpress")?.status).toBe("ok");
    } finally {
      delete sites.bad;
      warn.mockRestore();
    }
  });

  it("a sync-throwing runCall and normalize are contained", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    sites.bad2 = {
      id: "bad2",
      label: "Bad2",
      searchCalls: () => [{ op: "search", args: {} }],
      runCall: () => {
        throw new Error("sync");
      },
      normalizeSearchItem: () => null,
      fetchDetail: async (p) => p,
    };
    sites.bad3 = {
      id: "bad3",
      label: "Bad3",
      searchCalls: () => [{ op: "search", args: {} }],
      runCall: async () => ({ ok: true, tier: 1, data: [{}] }),
      normalizeSearchItem: () => {
        throw new Error("norm");
      },
      fetchDetail: async (p) => p,
    };
    try {
      const r = await runSearch({ ...base, sites: ["bad2", "bad3"], query: "anc earbuds" });
      expect(r.statuses.find((s) => s.site === "bad2")?.status).toBe("error");
      // every item failed to normalize: the store's page changed, not "0 results" (final review M2)
      expect(r.statuses.find((s) => s.site === "bad3")?.status).toBe("error");
    } finally {
      delete sites.bad2;
      delete sites.bad3;
      warn.mockRestore();
    }
  });

  it("answered items that all fail to normalize -> error, generic message; empty answer stays ok (final review M2)", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const site = (id: string, data: unknown[]) => ({
      id,
      label: id,
      searchCalls: () => [{ op: "search", args: {} }],
      runCall: async () => ({ ok: true as const, tier: 1, data }),
      normalizeSearchItem: () => null,
      fetchDetail: async (p: never) => p,
    });
    sites.changed = site("changed", [{ name: "x" }, { name: "y" }]);
    sites.empty = site("empty", []);
    try {
      const r = await runSearch({ ...base, sites: ["changed", "empty"], query: "anc earbuds" });
      expect(r.statuses).toEqual([
        { site: "changed", status: "error", message: "Store results could not be read" },
        { site: "empty", status: "ok" },
      ]);
    } finally {
      delete sites.changed;
      delete sites.empty;
      warn.mockRestore();
    }
  });

  it("class input (no results / page past the end) is an empty answer, not a failure (final review M4)", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    mock.mockResolvedValue({ ok: false, class: "input", reason: "HTTP 404" });
    const all = await runSearch({ ...base, query: "anc earbuds" });
    expect(all.statuses[0]).toEqual({ site: "aliexpress", status: "ok" });

    let n = 0;
    mock.mockImplementation(async () => (n++ === 0 ? okFixture() : { ok: false as const, class: "input" as const, reason: "HTTP 404" }));
    const some = await runSearch({ ...base, query: "anc earbuds" });
    expect(some.statuses[0]).toEqual({ site: "aliexpress", status: "ok" });
    expect(some.products.length).toBeGreaterThan(0);

    let k = 0;
    mock.mockImplementation(async () => (k++ === 0 ? { ok: false as const, class: "blocked", reason: "403" } : { ok: false as const, class: "input" as const, reason: "HTTP 404" }));
    const blocked = await runSearch({ ...base, query: "anc earbuds" });
    expect(blocked.statuses[0].status).toBe("blocked");
  });

  it("api-anything store: all calls drift (anti-bot page) -> blocked with generic message", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    mock.mockResolvedValue({ ok: false, class: "drift", reason: "embedded data not found" });
    const r = await runSearch({ ...base, query: "anc earbuds" });
    expect(r.statuses[0]).toEqual({
      site: "aliexpress",
      status: "blocked",
      message: "Store blocked the request; try again later",
    });
    expect(JSON.stringify(r)).not.toContain("embedded data");
  });

  it("custom runCall store (noon): drift stays error", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    sites.driftish = {
      id: "driftish",
      label: "Driftish",
      searchCalls: () => [{ op: "search", args: { q: "x", page: "1" } }],
      runCall: async () => ({ ok: false, class: "drift", reason: "no product cards" }),
      normalizeSearchItem: () => null,
      fetchDetail: async (p) => p,
    };
    try {
      const r = await runSearch({ ...base, sites: ["driftish"], query: "anc earbuds" });
      expect(r.statuses[0]).toEqual({ site: "driftish", status: "error", message: "Store request failed" });
    } finally {
      delete sites.driftish;
    }
  });

  it("all calls plain errors -> error status", async () => {
    mock.mockResolvedValue({ ok: false, class: "error", reason: "boom" });
    const r = await runSearch({ ...base, query: "anc earbuds" });
    expect(r.statuses[0]).toEqual({ site: "aliexpress", status: "error", message: "Store request failed" });
  });

  it("partial failure -> ok with failed count", async () => {
    let n = 0;
    mock.mockImplementation(async () =>
      n++ === 0 ? { ok: false, class: "blocked", reason: "x" } : okFixture(),
    );
    const r = await runSearch({ ...base, query: "anc earbuds" });
    expect(r.products.length).toBeGreaterThan(0);
    expect(r.statuses[0].status).toBe("ok");
    expect(r.statuses[0].message).toMatch(/^1 of \d+ requests failed$/);
  });

  it("everything filtered -> reason", async () => {
    mock.mockImplementation(okFixture);
    const r = await runSearch({ ...base, query: "anc earbuds", minRating: 6 });
    expect(r.products).toEqual([]);
    expect(r.reason).toBe("No products matched your search and filters");
  });

  it("exclude words drop matching titles", async () => {
    mock.mockImplementation(okFixture);
    const all = await runSearch({ ...base, query: "anc earbuds" });
    const r = await runSearch({ ...base, query: "anc earbuds -tws" });
    expect(all.products.some((p) => /tws/i.test(p.title))).toBe(true);
    expect(r.products.some((p) => /tws/i.test(p.title))).toBe(false);
  });

  it("unknown site ids ignored", async () => {
    mock.mockImplementation(okFixture);
    const r = await runSearch({ ...base, sites: ["nope", "aliexpress"], query: "anc earbuds" });
    expect(r.statuses.map((s) => s.site)).toEqual(["aliexpress"]);
  });
});

describe("POST /api/search", () => {
  const post = (body: unknown) =>
    POST(
      new Request("http://localhost:3000/api/search", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      }),
    );

  it("415 for a CORS-simple text/plain body; 403 for a cross-site page (final review I2)", async () => {
    mock.mockImplementation(okFixture);
    const body = JSON.stringify({ query: "anc earbuds", sites: ["aliexpress"], sort: "deal" });
    const plain = await POST(new Request("http://localhost:3000/api/search", { method: "POST", headers: { "content-type": "text/plain" }, body }));
    expect(plain.status).toBe(415);
    const cross = await POST(
      new Request("http://localhost:3000/api/search", {
        method: "POST",
        headers: { "content-type": "application/json", origin: "https://evil.example", "sec-fetch-site": "cross-site" },
        body,
      }),
    );
    expect(cross.status).toBe(403);
    expect(mock).not.toHaveBeenCalled();
  });

  it("400 when terms empty", async () => {
    const res = await post({ query: "under 50", sites: ["aliexpress"], sort: "deal" });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Enter something to search for" });
  });
  it("400 when no valid sites", async () => {
    const res = await post({ query: "earbuds", sites: ["nope"], sort: "deal" });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Pick at least one store" });
  });
  it("dedupes site ids", async () => {
    mock.mockImplementation(okFixture);
    const res = await post({ query: "anc earbuds", sites: ["aliexpress", "aliexpress", "aliexpress"], sort: "deal" });
    expect((await res.json()).statuses).toHaveLength(1);
  });
  it("400 when query too long", async () => {
    const res = await post({ query: "a".repeat(201), sites: ["aliexpress"], sort: "deal" });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Search is too long" });
  });
  it("200 with results", async () => {
    mock.mockImplementation(okFixture);
    const res = await post({ query: "anc earbuds", sites: ["aliexpress"], sort: "deal" });
    expect(res.status).toBe(200);
    expect((await res.json()).products.length).toBeGreaterThan(0);
  });
});

describe("runSearch ratings (minRating)", () => {
  const prod = (site: string, id: string, rating: number | null) => ({
    site,
    id,
    title: `ANC earbuds model ${id}`,
    listPrice: 100 + Number(id),
    origPrice: null,
    discountPct: null,
    currency: "SAR",
    rating,
    soldCount: 0,
    image: "",
    url: `https://example.com/${site}/${id}`,
    finalPrice: 100 + Number(id),
    detailStatus: "ok" as const,
  });
  const fakeSite = (id: string, items: ReturnType<typeof prod>[]) => ({
    id,
    label: id,
    searchCalls: () => [{ op: "search", args: { q: "anc earbuds", page: "1" } }],
    runCall: async () => ({ ok: true as const, tier: 1, data: items }),
    normalizeSearchItem: (raw: unknown) => raw as ReturnType<typeof prod>,
    fetchDetail: async (p: never) => p,
  });

  beforeEach(() => {
    sites.norating = fakeSite("norating", [prod("norating", "1", null), prod("norating", "2", null)]);
    sites.rated = fakeSite("rated", [prod("rated", "3", 4.5), prod("rated", "4", 3), prod("rated", "5", null)]);
  });
  afterEach(() => {
    delete sites.norating;
    delete sites.rated;
  });

  it("keeps and flags products of a store that never provides ratings", async () => {
    const r = await runSearch({ sites: ["norating", "rated"], sort: "price", query: "anc earbuds", minRating: 4 });
    const ids = r.products.map((p) => `${p.site}/${p.id}`).sort();
    expect(ids).toEqual(["norating/1", "norating/2", "rated/3"]);
    for (const p of r.products.filter((x) => x.site === "norating")) expect(p.ratingUnavailable).toBe(true);
    expect(r.products.find((p) => p.site === "rated")?.ratingUnavailable).toBeUndefined();
  });

  it("without minRating, nothing is flagged and nothing dropped for rating", async () => {
    const r = await runSearch({ sites: ["norating", "rated"], sort: "price", query: "anc earbuds" });
    expect(r.products).toHaveLength(5);
    expect(r.products.some((p) => p.ratingUnavailable)).toBe(false);
  });
});

describe("call budget", () => {
  it("every store makes at most 3 calls per search, even with 2 variants", () => {
    const pq = { terms: "usb c cable", exclude: [] };
    for (const id of ["aliexpress", "amazon-sa", "jarir", "noon-sa", "trendyol-sa"]) {
      const calls = sites[id].searchCalls(pq, ["usb-c cord", "type c cable"]);
      expect(calls.length, id).toBeGreaterThan(0);
      expect(calls.length, id).toBeLessThanOrEqual(3);
    }
  });
});

describe("answer time (fetchedAt) for price observations", () => {
  it("stamps products from a cached answer with the time it was cached", async () => {
    const { TtlCache } = await import("@/src/lib/cache");
    const cache = new TtlCache<{ ok: true; tier: number; data: unknown }>(2 * 3_600_000);
    const answer = { ok: true as const, tier: 1, data: fixture.data };
    const at = Date.now() - 50 * 60_000;
    const clock = vi.spyOn(Date, "now").mockReturnValue(at);
    cache.set("k", answer);
    clock.mockRestore();
    mock.mockImplementation(async () => cache.get("k")!);
    const r = await runSearch({ ...base, query: "anc earbuds" });
    expect(r.products.length).toBeGreaterThan(0);
    for (const p of r.products) expect(p.fetchedAt).toBe(at);
  });
  it("leaves fetchedAt unset for an answer that never went through a cache", async () => {
    mock.mockImplementation(okFixture);
    const r = await runSearch({ ...base, query: "anc earbuds" });
    expect(r.products.every((p) => p.fetchedAt === undefined)).toBe(true);
  });
});

describe("runSearch cross-store groups", () => {
  it("keeps the same product at two stores as two listings, grouped by key", async () => {
    const site = (id: string, title: string, price: number) => ({
      id,
      label: id,
      searchCalls: () => [{ op: "search", args: {} }],
      runCall: async () => ({ ok: true as const, tier: 1, data: [{}] }),
      normalizeSearchItem: () => ({
        site: id, id: "1", title, listPrice: price, origPrice: null, discountPct: null, currency: "SAR",
        rating: null, soldCount: 0, image: "", url: `https://${id}.example/1`, detailStatus: "ok" as const,
      }),
      fetchDetail: async (p: never) => p,
    });
    sites.g1 = site("g1", "Sony WH-1000XM5 Wireless Noise Cancelling Headphones Black", 1200);
    sites.g2 = site("g2", "Sony WH1000XM5 Wireless Noise Cancelling Headphones Silver", 1100);
    try {
      const r = await runSearch({ ...base, sites: ["g1", "g2"], query: "sony headphones" });
      expect(r.products.map((p) => p.site)).toEqual(["g2", "g1"]);
      expect(r.groups).toEqual([
        { key: "g:g1:1", memberKeys: ["g2:1", "g1:1"], bestKey: "g2:1", colors: { "g2:1": "silver", "g1:1": "black" } },
      ]);
      expect(r.products.every((p) => p.groupKey === "g:g1:1")).toBe(true);
    } finally {
      delete sites.g1;
      delete sites.g2;
    }
  });
});
