import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { openDb, type Db } from "@/src/lib/db";
import { createWatch, getWatch, listEvents, listPricePoints, updateWatch } from "@/src/lib/alerts/repo";
import { createChecker, runCycle, type CheckerDeps } from "@/src/lib/alerts/checker";
import type { SearchInput, SearchResult } from "@/src/lib/pipeline";
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

type Answer = { products: Product[]; status?: SiteStatus["status"] };

let db: Db;
let answers: Record<string, Answer>;
let calls: SearchInput[];
let notify: ReturnType<typeof vi.fn>;
let sleep: ReturnType<typeof vi.fn>;
let clock: number;

const search = async (input: SearchInput): Promise<SearchResult> => {
  calls.push(input);
  const site = input.sites[0];
  const a = answers[site] ?? { products: [] };
  return { products: a.products, statuses: [{ site, status: a.status ?? "ok" }], queryTokens: [] };
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

  it("uses the stores that answered when another is blocked", async () => {
    const id = createWatch(db, { kind: "search", site: null, productId: null, query: "airpods", sites: ["amazon-sa", "jarir"], target: 450 }, 0);
    answers["amazon-sa"] = { products: [], status: "blocked" };
    answers["jarir"] = { products: [prod("jarir", "J", 470)] };
    await runCycle(deps());
    expect(listPricePoints(db, id).map((p) => p.price)).toEqual([470]);
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
