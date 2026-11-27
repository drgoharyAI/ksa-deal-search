import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { deliverableFirst } from "@/src/lib/availability";
import { runSearch } from "@/src/lib/pipeline";
import { sites } from "@/src/sites/registry";
import { insightsFor, recordObservations } from "@/src/lib/insights";
import { cheapestConfident } from "@/src/lib/alerts/shared";
import { openDb, type Db } from "@/src/lib/db";
import { createWatch, getWatch, listPricePoints } from "@/src/lib/alerts/repo";
import { runCycle, type CheckerDeps } from "@/src/lib/alerts/checker";
import type { SearchResult } from "@/src/lib/pipeline";
import type { Product } from "@/src/lib/types";

/** Owner decision (fix round 1): SACO "Click and pick" listings are kept as branch pickup only. */
const P = (id: string, price: number, extra: Partial<Product> = {}): Product => ({
  site: "amazon-sa", id, title: `Air Fryer ${id}`, listPrice: price, origPrice: null, discountPct: null, currency: "SAR",
  rating: null, soldCount: 0, image: "", url: `https://a.example/${id}`, finalPrice: price, detailStatus: "ok", matchScore: 0.9, ...extra,
});

describe("deliverableFirst (ranking)", () => {
  it("puts pickup-only listings after the deliverable ones of the same match tier, order otherwise kept", () => {
    const ranked = [P("a", 100, { pickupOnly: true }), P("b", 150), P("c", 200), P("d", 50, { matchScore: 0.3 }), P("e", 60, { matchScore: 0.3, pickupOnly: true }), P("f", 70, { matchScore: 0.3 })];
    expect(deliverableFirst(ranked).map((p) => p.id)).toEqual(["b", "c", "a", "d", "f", "e"]);
  });
  it("returns the same array when nothing is pickup-only", () => {
    const ranked = [P("a", 1), P("b", 2)];
    expect(deliverableFirst(ranked)).toBe(ranked);
  });
});

describe("pipeline", () => {
  const TITLES: Record<string, string> = { a: "Philips Air Fryer XL HD9270", b: "Tefal Easy Fry Air Fryer EY501", c: "Ninja Air Fryer AF100" };
  const product = (raw: unknown): Product | null => {
    const r = raw as { id: string; price: number; pickupOnly?: true; inStock?: boolean; noResults?: string };
    if (!r.id) return null;
    return { ...P(r.id, r.price, { title: TITLES[r.id], site: "fake" }), ...(r.pickupOnly && { pickupOnly: true as const }), ...(r.inStock !== undefined && { inStock: r.inStock }) };
  };
  afterEach(() => delete sites.fake);

  it("cheapest-first starts with the cheapest deliverable listing; the cheaper pickup-only one follows", async () => {
    sites.fake = {
      id: "fake", label: "Fake", searchCalls: () => [{ op: "search", args: {} }], normalizeSearchItem: product,
      runCall: async () => ({ ok: true, tier: 1, data: [{ id: "a", price: 100, pickupOnly: true }, { id: "b", price: 300 }, { id: "c", price: 200 }] }),
    };
    const r = await runSearch({ query: "air fryer", sites: ["fake"], sort: "price" });
    expect(r.products.map((p) => p.id)).toEqual(["c", "b", "a"]);
    expect(r.products[2].pickupOnly).toBe(true);
  });

  it("lists the listings dropped as out of stock, so a watch can say so", async () => {
    sites.fake = {
      id: "fake", label: "Fake", searchCalls: () => [{ op: "search", args: {} }], normalizeSearchItem: product,
      runCall: async () => ({ ok: true, tier: 1, data: [{ id: "a", price: 100, inStock: false }, { id: "b", price: 300 }] }),
    };
    const r = await runSearch({ query: "air fryer", sites: ["fake"], sort: "price" });
    expect(r.outOfStock).toEqual([{ site: "fake", id: "a" }]);
    expect(r.products.map((p) => p.id)).toEqual(["b"]);
  });

  it("a store's no-results marker item is skipped: ok with no products, not 'could not be read'", async () => {
    sites.fake = {
      id: "fake", label: "Fake", searchCalls: () => [{ op: "search", args: {} }], normalizeSearchItem: product,
      isNoResults: (raw) => typeof (raw as { noResults?: unknown }).noResults === "string",
      runCall: async () => ({ ok: true, tier: 1, data: [{ noResults: "No results found!" }] }),
    };
    const r = await runSearch({ query: "air fryer", sites: ["fake"], sort: "price" });
    expect(r.statuses).toEqual([{ site: "fake", status: "ok" }]);
    expect(r.products).toEqual([]);
  });
});

describe("insights", () => {
  let db: Db;
  beforeEach(() => (db = openDb(":memory:")));
  afterEach(() => db.close());
  const NOW = Date.UTC(2026, 10, 27, 12);

  it("a pickup-only listing gets no badge or trend, is not a peer, and is not recorded", () => {
    const peers = [120, 110, 100, 130].map((price, i) => P(`P${i}`, price));
    const fake = P("F", 100, { origPrice: 500, discountPct: 80, pickupOnly: true });
    const out = insightsFor(db, [...peers, fake], NOW);
    expect(out.has("amazon-sa\u0000F")).toBe(false);
    expect(recordObservations(db, [fake], NOW)).toBe(0);
    expect(recordObservations(db, [P("D", 100)], NOW)).toBe(1);
  });
  it("pickup-only listings do not form the result-set peer price of the others", () => {
    const pickups = [120, 110, 100, 130].map((price, i) => P(`P${i}`, price, { pickupOnly: true }));
    const fake = P("F", 100, { origPrice: 500, discountPct: 80 });
    expect(insightsFor(db, [...pickups, fake], NOW).get("amazon-sa\u0000F")?.deal).toBeUndefined();
  });
});

describe("alerts", () => {
  let db: Db;
  let answer: SearchResult;
  const notify = vi.fn<(msg: unknown) => Promise<{ ok: boolean }>>(async () => ({ ok: true }));
  const deps = (): CheckerDeps => ({
    db, search: async () => answer, now: () => 1_000, sleep: async () => {}, notify: notify as unknown as CheckerDeps["notify"], staggerMs: 0,
  });
  beforeEach(() => {
    db = openDb(":memory:");
    notify.mockClear();
  });
  afterEach(() => db.close());
  const ok = (products: Product[], outOfStock?: { site: string; id: string }[]): SearchResult => ({
    products, statuses: [{ site: "amazon-sa", status: "ok" }], queryTokens: [], ...(outOfStock && { outOfStock }),
  });
  const productWatch = () =>
    createWatch(db, { kind: "product", site: "amazon-sa", productId: "X", query: "air fryer", sites: ["amazon-sa"], target: 500, title: "X", url: "https://a", currency: "SAR" }, 0);

  it("cheapestConfident skips pickup-only listings", () => {
    expect(cheapestConfident([P("a", 10, { pickupOnly: true }), P("b", 20)])?.id).toBe("b");
    expect(cheapestConfident([P("a", 10, { pickupOnly: true })])).toBeNull();
  });
  it("a watched product its store now marks out of stock reports 'out of stock', not 'not found'", async () => {
    const id = productWatch();
    answer = ok([], [{ site: "amazon-sa", id: "X" }]);
    await runCycle(deps());
    expect(getWatch(db, id)?.lastCheckStatus).toBe("out of stock");
    answer = ok([]);
    await runCycle(deps());
    expect(getWatch(db, id)?.lastCheckStatus).toBe("not found");
  });
  it("a watched product that is pickup-only never fires and records no price", async () => {
    const id = productWatch();
    answer = ok([P("X", 100, { pickupOnly: true })]);
    const r = await runCycle(deps());
    expect(r.fired).toBe(0);
    expect(notify).not.toHaveBeenCalled();
    expect(listPricePoints(db, id)).toEqual([]);
    expect(getWatch(db, id)?.lastCheckStatus).toBe("pickup only");
  });
  it("a search watch fires on a deliverable listing only", async () => {
    createWatch(db, { kind: "search", site: null, productId: null, query: "air fryer", sites: ["amazon-sa"], target: 500 }, 0);
    answer = ok([P("cheap", 100, { pickupOnly: true })]);
    expect((await runCycle(deps())).fired).toBe(0);
    answer = ok([P("cheap", 100, { pickupOnly: true }), P("ok", 400)]);
    expect((await runCycle(deps())).fired).toBe(1);
    expect(notify.mock.calls[0][0]).toMatchObject({ newPrice: 400 });
  });
});
