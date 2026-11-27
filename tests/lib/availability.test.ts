import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { rank } from "@/src/lib/rank";
import { groupRows } from "@/src/lib/view";
import { orderGroups, type ProductGroup } from "@/src/lib/match/group";
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

describe("rank(): deliverable before branch-pickup-only within each match tier", () => {
  const items = () => [
    P("a", 100, { pickupOnly: true, origPrice: 400, discountPct: 75, rating: 5 }),
    P("b", 150, { origPrice: 200, discountPct: 25 }),
    P("c", 200),
    P("d", 50, { matchScore: 0.3 }),
    P("e", 60, { matchScore: 0.3, pickupOnly: true }),
    P("f", 70, { matchScore: 0.3 }),
    P("w", 10, { weakMatch: true, pickupOnly: true }),
    P("x", 20, { weakMatch: true }),
  ];
  it.each(["price", "discount", "deal"] as const)("sort %s", (sort) => {
    const ids = rank(items(), sort).map((p) => p.id);
    const pos = (id: string) => ids.indexOf(id);
    // tiers stay in order, and in each tier every deliverable listing precedes every pickup-only one
    expect(Math.max(pos("a"), pos("b"), pos("c"))).toBeLessThan(Math.min(pos("d"), pos("e"), pos("f")));
    expect(Math.max(pos("b"), pos("c"))).toBeLessThan(pos("a"));
    expect(Math.max(pos("d"), pos("f"))).toBeLessThan(pos("e"));
    expect(pos("x")).toBeLessThan(pos("w"));
  });
  it("price: the cheapest deliverable listing comes first, the cheaper pickup-only one after the deliverable ones", () => {
    expect(rank(items(), "price").map((p) => p.id)).toEqual(["b", "c", "a", "d", "f", "e", "x", "w"]);
  });
  it("leaves the order alone when nothing is pickup-only", () => {
    const ps = [P("b", 200), P("a", 100)];
    expect(rank(ps, "price").map((p) => p.id)).toEqual(["a", "b"]);
  });
  it("a group's lead and its rows follow it: the deliverable member leads", () => {
    const pickup = P("p", 100, { site: "saco-sa", pickupOnly: true });
    const ship = P("s", 120, { site: "noon-sa" });
    const other = P("o", 110, { site: "jarir", title: "Other Fryer" });
    const g1 = { key: "g1", members: [pickup, ship] } as unknown as ProductGroup;
    const g2 = { key: "g2", members: [other] } as unknown as ProductGroup;
    expect(groupRows([pickup, ship]).map((p) => p.id)).toEqual(["s", "p"]);
    // g1 stands at its deliverable 120, after g2's 110 (not at the pickup-only 100)
    expect(orderGroups([g1, g2], "price").map((g) => g.key)).toEqual(["g2", "g1"]);
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
