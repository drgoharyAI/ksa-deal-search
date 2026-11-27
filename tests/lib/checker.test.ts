import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { openDb, type Db } from "@/src/lib/db";
import { createWatch, getWatch, listEvents, listPricePoints, updateWatch } from "@/src/lib/alerts/repo";
import { createChecker, runCycle, type CheckerDeps } from "@/src/lib/alerts/checker";
import type { SearchInput, SearchOptions, SearchResult } from "@/src/lib/pipeline";
import type { Product, SiteStatus } from "@/src/lib/types";

const prod = (site: string, id: string, price: number, extra: Partial<Product> = {}): Product => ({
  site,
  id,
  title: `${site} ${id}`,
  listPrice: price,
  origPrice: null,
  discountPct: null,
  currency: "SAR",
  rating: null,
  soldCount: 0,
  image: "",
  url: `https://${site}.example/${id}`,
  finalPrice: price,
  detailStatus: "ok",
  matchScore: 0.9,
  ...extra,
});

type Answer = { products: Product[]; status?: SiteStatus["status"]; message?: string; listings?: Product[] };

let db: Db;
let answers: Record<string, Answer>;
let calls: SearchInput[];
let notify: ReturnType<typeof vi.fn>;
let sleep: ReturnType<typeof vi.fn>;
let clock: number;

const search = async (input: SearchInput, opts?: Pick<SearchOptions, "onFiltered">): Promise<SearchResult> => {
  calls.push(input);
  const site = input.sites[0];
  const a = answers[site] ?? { products: [] };
  if (a.listings) opts?.onFiltered?.(a.listings);
  const status: SiteStatus = { site, status: a.status ?? "ok", ...(a.message ? { message: a.message } : {}) };
  return { products: a.products, statuses: [status], queryTokens: [] };
};

const deps = (over: Partial<CheckerDeps> = {}): CheckerDeps => ({
  db,
  search,
  now: () => clock,
  sleep: sleep as unknown as CheckerDeps["sleep"],
  notify: notify as unknown as CheckerDeps["notify"],
  staggerMs: 1000,
  ...over,
});

const productWatch = (target = 450, site = "amazon-sa", productId = "B0X", query = "airpods") =>
  createWatch(db, { kind: "product", site, productId, query, sites: [site], target, title: "AirPods", url: "https://a", currency: "SAR" }, 0);

beforeEach(() => {
  db = openDb(":memory:");
  answers = {};
  calls = [];
  clock = 1_000;
  notify = vi.fn(async () => ({ ok: true }));
  sleep = vi.fn(async () => {});
});
afterEach(() => db.close());

describe("runCycle: product watch", () => {
  it("fires at or below the target, records a price point and the event", async () => {
    const id = productWatch(450);
    updateWatch(db, id, { lastPrice: 500 });
    answers["amazon-sa"] = { products: [prod("amazon-sa", "B0X", 450)] };
    const r = await runCycle(deps());
    expect(r).toMatchObject({ checked: 1, fired: 1, groups: 1 });
    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify.mock.calls[0][0]).toMatchObject({ title: "amazon-sa B0X", store: "Amazon KSA", oldPrice: 500, newPrice: 450, target: 450, url: "https://amazon-sa.example/B0X" });
    expect(listPricePoints(db, id)).toEqual([{ at: 1_000, price: 450 }]);
    expect(getWatch(db, id)).toMatchObject({ lastFiredPrice: 450, lastPrice: 450, lastCheckedAt: 1_000, lastCheckStatus: "ok" });
    expect(listEvents(db)[0]).toMatchObject({ watchId: id, newPrice: 450, oldPrice: 500, sent: true, seen: false });
  });

  it("does not fire again while the price stays at or under the target", async () => {
    productWatch(450);
    answers["amazon-sa"] = { products: [prod("amazon-sa", "B0X", 440)] };
    await runCycle(deps());
    answers["amazon-sa"] = { products: [prod("amazon-sa", "B0X", 420)] };
    clock = 2_000;
    const r = await runCycle(deps());
    expect(r.fired).toBe(0);
    expect(notify).toHaveBeenCalledTimes(1);
    expect(listEvents(db)).toHaveLength(1);
  });

  it("fires again only after the price rose above the target and fell back", async () => {
    const id = productWatch(450);
    const at = async (price: number) => {
      answers["amazon-sa"] = { products: [prod("amazon-sa", "B0X", price)] };
      clock += 1_000;
      return runCycle(deps());
    };
    expect((await at(440)).fired).toBe(1);
    expect((await at(460)).fired).toBe(0);
    expect(getWatch(db, id)?.lastFiredPrice).toBeNull();
    expect((await at(445)).fired).toBe(1);
    expect(notify).toHaveBeenCalledTimes(2);
    expect(notify.mock.calls[1][0]).toMatchObject({ oldPrice: 460, newPrice: 445 });
  });

  it("matches the product by store and id, never a cheaper neighbour", async () => {
    const id = productWatch(450);
    answers["amazon-sa"] = { products: [prod("amazon-sa", "OTHER", 100), prod("amazon-sa", "B0X", 480)] };
    const r = await runCycle(deps());
    expect(r.fired).toBe(0);
    expect(listPricePoints(db, id).map((p) => p.price)).toEqual([480]);
  });

  it("records a missing product without a price point", async () => {
    const id = productWatch(450);
    answers["amazon-sa"] = { products: [prod("amazon-sa", "OTHER", 100)] };
    await runCycle(deps());
    expect(listPricePoints(db, id)).toEqual([]);
    expect(getWatch(db, id)).toMatchObject({ lastCheckStatus: "not found", lastCheckedAt: 1_000 });
  });

  it("skips a blocked store quietly and a search that throws", async () => {
    const id = productWatch(450);
    answers["amazon-sa"] = { products: [], status: "blocked" };
    const r = await runCycle(deps());
    expect(r.fired).toBe(0);
    expect(listPricePoints(db, id)).toEqual([]);
    expect(getWatch(db, id)?.lastCheckStatus).toBe("blocked");
    const r2 = await runCycle(deps({ search: async () => { throw new Error("boom"); } }));
    expect(r2.fired).toBe(0);
    expect(getWatch(db, id)?.lastCheckStatus).toBe("error");
  });

  it("ignores paused watches and, with dueBefore, recently checked ones", async () => {
    const a = productWatch(450);
    const b = productWatch(450, "jarir", "J1");
    updateWatch(db, a, { status: "paused" });
    updateWatch(db, b, { lastCheckedAt: 900 });
    expect((await runCycle(deps({ dueBefore: 500 }))).checked).toBe(0);
    expect(calls).toHaveLength(0);
    expect((await runCycle(deps({ dueBefore: 950 }))).checked).toBe(1);
  });

  it("keeps the cycle going when the notification fails", async () => {
    productWatch(450);
    notify.mockResolvedValueOnce({ ok: false, error: "Telegram is not set up", notConfigured: true });
    answers["amazon-sa"] = { products: [prod("amazon-sa", "B0X", 400)] };
    const r = await runCycle(deps());
    expect(r.fired).toBe(1);
    expect(listEvents(db)[0].sent).toBe(false);
  });
});

describe("runCycle: search watch", () => {
  it("uses the cheapest confident match and ignores less likely and weak ones", async () => {
    const id = createWatch(db, { kind: "search", site: null, productId: null, query: "airpods", sites: ["amazon-sa", "jarir"], target: 450 }, 0);
    answers["amazon-sa"] = { products: [prod("amazon-sa", "CHEAP", 100, { matchScore: 0.3 }), prod("amazon-sa", "A", 500)] };
    answers["jarir"] = { products: [prod("jarir", "W", 90, { weakMatch: true }), prod("jarir", "J", 470)] };
    expect((await runCycle(deps())).fired).toBe(0);
    expect(listPricePoints(db, id).map((p) => p.price)).toEqual([470]);
    answers["jarir"] = { products: [prod("jarir", "J", 449)] };
    const r = await runCycle(deps());
    expect(r.fired).toBe(1);
    expect(notify.mock.calls[0][0]).toMatchObject({ title: "jarir J", store: "Jarir", newPrice: 449, oldPrice: 470 });
  });

  it("a partial answer (another store blocked) records its status, no price point", async () => {
    const id = createWatch(db, { kind: "search", site: null, productId: null, query: "airpods", sites: ["amazon-sa", "jarir"], target: 450 }, 0);
    answers["amazon-sa"] = { products: [], status: "blocked" };
    answers["jarir"] = { products: [prod("jarir", "J", 470)] };
    await runCycle(deps());
    expect(listPricePoints(db, id)).toEqual([]);
    expect(getWatch(db, id)?.lastCheckStatus).toBe("partial");
  });
});

describe("runCycle: grouping and staggering", () => {
  it("fetches each store once per query per cycle and waits between fetches", async () => {
    productWatch(450, "amazon-sa", "B0X", "AirPods");
    productWatch(450, "amazon-sa", "B0Y", "airpods  ");
    createWatch(db, { kind: "search", site: null, productId: null, query: "airpods", sites: ["amazon-sa", "jarir"], target: 450 }, 0);
    productWatch(450, "jarir", "J1", "ps5");
    answers["amazon-sa"] = { products: [prod("amazon-sa", "B0X", 500), prod("amazon-sa", "B0Y", 600)] };
    const r = await runCycle(deps());
    expect(r.groups).toBe(3);
    expect(calls.map((c) => `${c.sites.join()}|${c.query}`).sort()).toEqual(["amazon-sa|AirPods", "jarir|airpods", "jarir|ps5"]);
    expect(calls.every((c) => c.sites.length === 1 && c.sort === "price")).toBe(true);
    expect(sleep).toHaveBeenCalledTimes(2);
    expect(r.checked).toBe(4);
  });
});

describe("createChecker", () => {
  it("never runs two cycles at once", async () => {
    productWatch(450);
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const slow = async (input: SearchInput) => {
      await gate;
      return search(input);
    };
    const c = createChecker(() => deps({ search: slow }), { intervalMs: 60_000 });
    const first = c.runNow();
    const second = await c.runNow();
    expect(second).toEqual({ skipped: true });
    release();
    expect(await first).toMatchObject({ checked: 1 });
    expect(c.running).toBe(false);
  });

  it("start schedules cycles on a timer and stop clears it", async () => {
    vi.useFakeTimers();
    try {
      productWatch(450);
      const c = createChecker(() => deps({ now: () => Date.now() }), { intervalMs: 10_000, firstDelayMs: 1_000 });
      c.start();
      c.start(); // idempotent
      expect(calls).toHaveLength(0);
      await vi.advanceTimersByTimeAsync(1_000);
      expect(calls).toHaveLength(1);
      await vi.advanceTimersByTimeAsync(10_000);
      expect(calls).toHaveLength(2);
      c.stop();
      await vi.advanceTimersByTimeAsync(30_000);
      expect(calls).toHaveLength(2);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("runCycle: failed Telegram sends", () => {
  it("keeps the watch armed after a failed send and retries without a duplicate event", async () => {
    const id = productWatch(450);
    answers["amazon-sa"] = { products: [prod("amazon-sa", "B0X", 440)] };
    notify.mockResolvedValueOnce({ ok: false, error: "Telegram did not answer within 10 seconds" });
    expect((await runCycle(deps())).fired).toBe(1);
    expect(getWatch(db, id)?.lastFiredPrice).toBeNull();
    expect(listEvents(db)).toEqual([expect.objectContaining({ sent: false, newPrice: 440 })]);

    answers["amazon-sa"] = { products: [prod("amazon-sa", "B0X", 430)] };
    clock = 2_000;
    const r = await runCycle(deps());
    expect(r).toMatchObject({ fired: 0, retried: 1 });
    expect(notify).toHaveBeenCalledTimes(2);
    expect(listEvents(db)).toEqual([expect.objectContaining({ sent: true, newPrice: 430 })]);
    expect(getWatch(db, id)?.lastFiredPrice).toBe(430);
  });

  it("treats a throwing notify as a failed send", async () => {
    const id = productWatch(450);
    notify.mockRejectedValueOnce(new Error("boom"));
    answers["amazon-sa"] = { products: [prod("amazon-sa", "B0X", 440)] };
    await runCycle(deps());
    expect(getWatch(db, id)?.lastFiredPrice).toBeNull();
  });

  it("disarms when Telegram is not set up (the alert shows in the app only)", async () => {
    const id = productWatch(450);
    notify.mockResolvedValue({ ok: false, error: "Telegram is not set up", notConfigured: true });
    answers["amazon-sa"] = { products: [prod("amazon-sa", "B0X", 440)] };
    await runCycle(deps());
    expect(getWatch(db, id)?.lastFiredPrice).toBe(440);
    clock = 2_000;
    expect((await runCycle(deps())).fired).toBe(0);
    expect(notify).toHaveBeenCalledTimes(1);
  });

  it("a rise above the target after a failed send makes the next drop a new event", async () => {
    productWatch(450);
    notify.mockResolvedValueOnce({ ok: false, error: "Telegram answered 502" });
    const at = async (price: number) => {
      answers["amazon-sa"] = { products: [prod("amazon-sa", "B0X", price)] };
      clock += 1_000;
      return runCycle(deps());
    };
    await at(440);
    await at(470);
    expect((await at(445)).fired).toBe(1);
    expect(listEvents(db).map((e) => [e.newPrice, e.sent])).toEqual([[445, true], [440, false]]);
  });
});

describe("runCycle: Chrome-backed stores", () => {
  it("waits the store's own gap before its group", async () => {
    productWatch(450, "amazon-sa", "A", "a");
    productWatch(450, "noon-sa", "N", "b");
    productWatch(450, "jarir", "J", "c");
    await runCycle(deps({ gapMs: (site) => (site === "noon-sa" ? 60_000 : 1_000) }));
    expect(sleep.mock.calls.map((c) => c[0])).toEqual([60_000, 1_000]);
  });

  it("caps groups per store per cycle and defers the rest, oldest checked first", async () => {
    const ids = [1, 2, 3, 4].map((i) => productWatch(450, "shein-sa", `S${i}`, `q${i}`));
    updateWatch(db, ids[0], { lastCheckedAt: 500 });
    updateWatch(db, ids[1], { lastCheckedAt: 100 });
    const r = await runCycle(deps({ siteCaps: { "shein-sa": 2 } }));
    expect(r).toMatchObject({ groups: 2, checked: 2, deferred: 2 });
    // never checked (ids 2, 3) come first
    expect(calls.map((c) => c.query).sort()).toEqual(["q3", "q4"]);
    expect(getWatch(db, ids[0])?.lastCheckedAt).toBe(500);
    calls = [];
    clock = 2_000;
    await runCycle(deps({ siteCaps: { "shein-sa": 2 } }));
    expect(calls.map((c) => c.query)).toEqual(["q2", "q1"]);
  });
});

describe("runCycle: search watch filters", () => {
  it("applies the stored min price, max price and min rating", async () => {
    const id = createWatch(db, { kind: "search", site: null, productId: null, query: "airpods", sites: ["amazon-sa"], target: 450, filters: { minPrice: 200, maxPrice: 600, minRating: 4 } }, 0);
    expect(getWatch(db, id)?.filters).toEqual({ minPrice: 200, maxPrice: 600, minRating: 4 });
    answers["amazon-sa"] = {
      products: [
        prod("amazon-sa", "CASE", 50, { rating: 4.5 }), // under the min price
        prod("amazon-sa", "LOW", 300, { rating: 3 }), // under the min rating
        prod("amazon-sa", "PRO", 900, { rating: 5 }), // over the max price
        prod("amazon-sa", "OK", 480, { rating: 4.2 }),
      ],
    };
    await runCycle(deps());
    expect(listPricePoints(db, id).map((p) => p.price)).toEqual([480]);
  });
});

describe("code review round: alert checker", () => {
  const searchWatch = (target: number, sites = ["noon-sa", "amazon-sa"]) =>
    createWatch(db, { kind: "search", site: null, productId: null, query: "airpods", sites, target }, 0);
  const tick = () => {
    clock += 1_000;
    return runCycle(deps());
  };

  it("a partial answer never re-arms: the same drop does not alert twice", async () => {
    const id = searchWatch(100);
    answers["noon-sa"] = { products: [prod("noon-sa", "N", 95)] };
    answers["amazon-sa"] = { products: [prod("amazon-sa", "A", 130)] };
    expect((await tick()).fired).toBe(1);
    // noon blocked, amazon 120: the cheap store is missing, so not a rise above the target
    answers["noon-sa"] = { products: [], status: "blocked" };
    answers["amazon-sa"] = { products: [prod("amazon-sa", "A", 120)] };
    expect((await tick()).fired).toBe(0);
    expect(getWatch(db, id)).toMatchObject({ lastFiredPrice: 95, lastCheckStatus: "partial" });
    answers["noon-sa"] = { products: [prod("noon-sa", "N", 95)] };
    expect((await tick()).fired).toBe(0);
    expect(notify).toHaveBeenCalledTimes(1);
    expect(listPricePoints(db, id).map((p) => p.price)).toEqual([95, 95]);
  });

  it("a store answer with failed requests is partial too", async () => {
    const id = productWatch(450);
    answers["amazon-sa"] = { products: [prod("amazon-sa", "B0X", 440)] };
    await tick();
    answers["amazon-sa"] = { products: [prod("amazon-sa", "B0X", 500)], message: "1 of 3 requests failed" };
    await tick();
    expect(getWatch(db, id)).toMatchObject({ lastFiredPrice: 440, lastCheckStatus: "partial", lastPrice: 440 });
    answers["amazon-sa"] = { products: [prod("amazon-sa", "B0X", 500)] };
    await tick();
    expect(getWatch(db, id)?.lastFiredPrice).toBeNull();
  });

  it("re-reads each watch: a deleted one is skipped, a paused one too, a new target is used", async () => {
    const a = productWatch(450, "amazon-sa", "A1");
    const b = productWatch(450, "amazon-sa", "B1");
    const c = productWatch(450, "amazon-sa", "C1");
    answers["amazon-sa"] = { products: [prod("amazon-sa", "A1", 400), prod("amazon-sa", "B1", 400), prod("amazon-sa", "C1", 400)] };
    const slow = async (input: SearchInput, opts?: Pick<SearchOptions, "onFiltered">) => {
      const r = await search(input, opts);
      db.prepare("DELETE FROM watches WHERE id = ?").run(a);
      updateWatch(db, b, { status: "paused" });
      updateWatch(db, c, { target: 300 });
      return r;
    };
    const r = await runCycle(deps({ search: slow }));
    expect(r).toMatchObject({ checked: 1, fired: 0 });
    expect(notify).not.toHaveBeenCalled();
    expect(getWatch(db, b)?.lastCheckedAt).toBeNull();
    expect(getWatch(db, c)).toMatchObject({ lastPrice: 400, lastFiredPrice: null });
  });

  it("one watch failing does not abort the cycle", async () => {
    const a = productWatch(450, "amazon-sa", "A1");
    const b = productWatch(450, "amazon-sa", "B1");
    answers["amazon-sa"] = { products: [prod("amazon-sa", "A1", 400), prod("amazon-sa", "B1", 400)] };
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    let first = true;
    const deleting: CheckerDeps["notify"] = async () => {
      if (first) db.prepare("DELETE FROM watches WHERE id = ?").run(a); // the event insert then fails its foreign key
      first = false;
      return { ok: true };
    };
    try {
      await runCycle(deps({ notify: deleting }));
    } finally {
      warn.mockRestore();
    }
    expect(getWatch(db, b)).toMatchObject({ lastFiredPrice: 400 });
  });

  it("a product watch finds its product even when the dedupe kept a cheaper look-alike", async () => {
    const id = productWatch(450, "amazon-sa", "B0X");
    const cheap = prod("amazon-sa", "TWIN", 300, { title: "amazon-sa B0X" });
    answers["amazon-sa"] = { products: [cheap], listings: [cheap, prod("amazon-sa", "B0X", 440)] };
    expect((await tick()).fired).toBe(1);
    expect(listPricePoints(db, id).map((p) => p.price)).toEqual([440]);
  });

  it("a manual re-arm after a sent alert is a new event, never a retry", async () => {
    const id = productWatch(450);
    answers["amazon-sa"] = { products: [prod("amazon-sa", "B0X", 440)] };
    notify.mockResolvedValueOnce({ ok: false, error: "Telegram is not set up", notConfigured: true });
    await tick(); // unsent, not to be retried
    updateWatch(db, id, { target: 445, lastFiredPrice: null }); // the owner changes the target
    const r = await tick();
    expect(r).toMatchObject({ fired: 1, retried: 0 });
    expect(listEvents(db)).toHaveLength(2);
  });

  it("re-arming ends a pending retry", async () => {
    const id = productWatch(450);
    answers["amazon-sa"] = { products: [prod("amazon-sa", "B0X", 440)] };
    notify.mockResolvedValueOnce({ ok: false, error: "Telegram answered 502" });
    await tick();
    updateWatch(db, id, { target: 445, lastFiredPrice: null });
    expect((await tick())).toMatchObject({ fired: 1, retried: 0 });
    expect(listEvents(db).map((e) => e.sent)).toEqual([true, false]);
  });

  it("checks at most 100 watches and sends at most 20 alerts per cycle", async () => {
    const ids = Array.from({ length: 105 }, (_, i) => productWatch(450, "amazon-sa", `P${i}`));
    answers["amazon-sa"] = { products: ids.map((_, i) => prod("amazon-sa", `P${i}`, 400)) };
    const r = await tick();
    expect(r).toMatchObject({ checked: 100, deferred: 5, fired: 20 });
    expect(notify).toHaveBeenCalledTimes(20);
    // the armed rest fire on later cycles
    const r2 = await tick();
    expect(r2.fired).toBe(20);
  });

  it("prunes price points older than 180 days and events past the newest 1000", async () => {
    const id = productWatch(450);
    clock = 200 * 86_400_000;
    db.prepare("INSERT INTO price_points (watchId, at, price) VALUES (?, ?, ?)").run(id, 1, 500);
    const ins = db.prepare("INSERT INTO alert_events (watchId, at, title, site, newPrice, target) VALUES (?, ?, 't', 'amazon-sa', 1, 1)");
    for (let i = 0; i < 1005; i++) ins.run(id, i);
    answers["amazon-sa"] = { products: [prod("amazon-sa", "B0X", 500)] };
    await runCycle(deps());
    expect(listPricePoints(db, id).map((p) => p.price)).toEqual([500]);
    expect((db.prepare("SELECT count(*) n FROM alert_events").get() as { n: number }).n).toBe(1000);
  });

  it("chains timers longer than setTimeout's limit", async () => {
    vi.useFakeTimers();
    const spy = vi.spyOn(globalThis, "setTimeout");
    try {
      productWatch(450);
      const c = createChecker(() => deps({ now: () => Date.now() }), { intervalMs: 30 * 86_400_000, firstDelayMs: 2 ** 31 + 5_000 });
      c.start();
      await vi.advanceTimersByTimeAsync(10_000);
      expect(calls).toHaveLength(0);
      await vi.advanceTimersByTimeAsync(2 ** 31);
      expect(calls).toHaveLength(1);
      expect(spy.mock.calls.every((call) => (call[1] ?? 0) <= 2 ** 31 - 1)).toBe(true);
      c.stop();
    } finally {
      spy.mockRestore();
      vi.useRealTimers();
    }
  });
});
