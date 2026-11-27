import { describe, it, expect, vi, beforeEach } from "vitest";
import fixture from "../fixtures/aliexpress-search.json";

vi.mock("@/src/lib/aa", () => ({ aaCall: vi.fn() }));

import { aaCall } from "@/src/lib/aa";
import { runSearch } from "@/src/lib/pipeline";
import { POST } from "@/app/api/search/route";

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
    expect(r.statuses[0]).toEqual({ site: "aliexpress", status: "blocked", message: "captcha" });
  });

  it("all calls plain errors -> error status", async () => {
    mock.mockResolvedValue({ ok: false, class: "error", reason: "boom" });
    const r = await runSearch({ ...base, query: "anc earbuds" });
    expect(r.statuses[0].status).toBe("error");
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
    POST(new Request("http://x/api/search", { method: "POST", body: JSON.stringify(body) }));

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
  it("200 with results", async () => {
    mock.mockImplementation(okFixture);
    const res = await post({ query: "anc earbuds", sites: ["aliexpress"], sort: "deal" });
    expect(res.status).toBe(200);
    expect((await res.json()).products.length).toBeGreaterThan(0);
  });
});
