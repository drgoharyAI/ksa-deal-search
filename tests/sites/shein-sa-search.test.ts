import { describe, it, expect, vi, afterEach } from "vitest";
import { TtlCache } from "@/src/lib/cache";
import type { AaResult } from "@/src/lib/aa";
import fixture from "../fixtures/shein-sa-search.json";
import {
  sanitizeQ,
  humanizeSlug,
  normalizeSearchItem,
  searchCalls,
  createRunCall,
  toRawItems,
  type SheinPage,
  type SheinState,
} from "@/src/sites/shein-sa/search";

describe("sanitizeQ", () => {
  it("keeps letters (any script), digits, spaces, hyphens", () => {
    expect(sanitizeQ("summer dress")).toBe("summer dress");
    expect(sanitizeQ("a/b & c")).toBe("a b c");
    expect(sanitizeQ("فستان صيفي")).toBe("فستان صيفي");
    expect(sanitizeQ("¿¿")).toBe("");
  });
});

describe("searchCalls (call budget)", () => {
  it("one call: main term, page 1, relevance; variants ignored", () => {
    const calls = searchCalls({ terms: "summer dress", exclude: [] }, ["summer dresses", "sun dress"]);
    expect(calls).toEqual([{ op: "search", args: { q: "summer dress", page: "1", sort: "" } }]);
  });
  it("no usable term -> no call", () => {
    expect(searchCalls({ terms: "¿¿", exclude: [] }, [])).toEqual([]);
  });
});

describe("humanizeSlug", () => {
  it("dashes to spaces, title-cases words, keeps model codes", () => {
    expect(humanizeSlug("Lenovo-EA166-bluetooth-earbuds")).toBe("Lenovo EA166 Bluetooth Earbuds");
    expect(humanizeSlug("summer--floral-dress-")).toBe("Summer Floral Dress");
  });
  it("strips trailing ids", () => {
    expect(humanizeSlug("Floral-Dress-sw2304123456789")).toBe("Floral Dress");
    expect(humanizeSlug("Floral-Dress-12345678")).toBe("Floral Dress");
    expect(humanizeSlug("Sports-Music-TAT1120")).toBe("Sports Music TAT1120");
  });
  it("empty -> empty", () => {
    expect(humanizeSlug("")).toBe("");
  });
});

describe("normalizeSearchItem", () => {
  it("maps fixture items: KSA url, SAR, English title, no NaN, >=10 products", () => {
    const products = fixture.items.map((it) => normalizeSearchItem(it));
    const ok = products.filter((p) => p !== null);
    expect(ok.length).toBeGreaterThanOrEqual(10);
    for (const p of ok) {
      expect(p.site).toBe("shein-sa");
      expect(p.currency).toBe("SAR");
      expect(p.url.startsWith("https://ar.shein.com/")).toBe(true);
      expect(p.url).toMatch(/-p-\d+\.html$/);
      expect(p.id).toMatch(/^\d+$/);
      expect(p.url.endsWith(`-p-${p.id}.html`)).toBe(true);
      expect(p.title).toMatch(/^[\x20-\x7e]+$/); // English (ASCII) title, not the Arabic one
      expect(p.listPrice).toBeGreaterThan(0);
      expect(p.finalPrice).toBe(p.listPrice);
      expect(p.detailStatus).toBe("ok");
      if (p.origPrice !== null) expect(p.origPrice).toBeGreaterThan(p.listPrice);
      if (p.image) expect(p.image.startsWith("https://")).toBe(true);
      for (const v of [p.listPrice, p.origPrice, p.discountPct, p.rating]) {
        if (v !== null) expect(Number.isNaN(v)).toBe(false);
      }
    }
  });

  it("discount computed from retail; origPrice dropped when not above price", () => {
    const base = { id: "42", price: 25, rating: 4.5, image: "//img.ltwebstatic.com/a.jpg", url: "https://ar.shein.com/Floral-Dress-p-42.html" };
    const p = normalizeSearchItem({ ...base, origPrice: 100 })!;
    expect(p).toMatchObject({ id: "42", title: "Floral Dress", listPrice: 25, origPrice: 100, discountPct: 75, rating: 4.5 });
    expect(p.image).toBe("https://img.ltwebstatic.com/a.jpg");
    expect(normalizeSearchItem({ ...base, origPrice: 25 })!).toMatchObject({ origPrice: null, discountPct: null });
  });

  it("null when id, price or KSA url missing", () => {
    expect(normalizeSearchItem({ price: 5, url: "https://ar.shein.com/X-p-.html" })).toBeNull();
    expect(normalizeSearchItem({ id: "1", price: null, url: "https://ar.shein.com/X-p-1.html" })).toBeNull();
    expect(normalizeSearchItem({ id: "1", price: 5, url: "https://www.shein.com/X-p-1.html" })).toBeNull();
    expect(normalizeSearchItem(null)).toBeNull();
  });
});

const goods = (id: string, over: Record<string, unknown> = {}) => ({
  goods_id: id,
  goods_url_name: `Summer-Floral-Dress-${id}0000000`,
  goods_name: "فستان",
  salePrice: { amount: "30.00", amountWithSymbol: "SR30.00" },
  retailPrice: { amount: "60.00" },
  comment_rank_average: "4.8",
  goods_img: "//img.ltwebstatic.com/x.jpg",
  ...over,
});

describe("toRawItems", () => {
  it("maps bff products and dedupes by goods_id", () => {
    const items = toRawItems([goods("11"), goods("12"), goods("11")]);
    expect(items.map((i) => i.id)).toEqual(["11", "12"]);
    expect(items[0]).toMatchObject({
      price: 30,
      origPrice: 60,
      currency: "SAR",
      url: "https://ar.shein.com/Summer-Floral-Dress-110000000-p-11.html",
    });
    expect(normalizeSearchItem(items[0])!.title).toBe("Summer Floral Dress");
  });
});

// ---------------- page driving ----------------

type FakeOpts = {
  status?: number;
  finalUrl?: string;
  xhr?: unknown; // body of get_products_by_keywords; undefined = no XHR seen
  gbRawData?: unknown;
  cookies?: number;
  gotoThrows?: Error;
  loads?: { at: number[] };
};

function fakePage(o: FakeOpts) {
  const visited: string[] = [];
  let current = "about:blank";
  const page = {
    visited,
    async goto(url: string) {
      visited.push(url);
      o.loads?.at.push(Date.now());
      if (o.gotoThrows) throw o.gotoThrows;
      current = url.includes("/pdsearch/") && o.finalUrl ? o.finalUrl : url;
      return { status: () => o.status ?? 200 };
    },
    url: () => current,
    async waitForResponse() {
      if (o.xhr === undefined) throw new Error("Timeout");
      return {
        url: () => "https://ar.shein.com/bff-api/product/get_products_by_keywords?page=1&",
        json: async () => o.xhr,
      };
    },
    async waitForLoadState() {},
    async waitForTimeout() {},
    async evaluate() {
      return o.gbRawData ?? null;
    },
    context: () => ({ cookies: async () => Array.from({ length: o.cookies ?? 3 }, () => ({ name: "c" })) }),
  };
  return page as typeof page & SheinPage;
}

const freshState = (): SheinState => ({ blockedUntil: 0, strikes: 0, lastLoad: 0 });
const okBody = { code: "0", info: { products: [goods("1"), goods("2")], num: 2 } };
const call = { op: "search", args: { q: "summer dress", page: "1", sort: "" } };

function runWith(page: SheinPage, extra: Partial<Parameters<typeof createRunCall>[0]> = {}) {
  return createRunCall({
    withPage: (fn) => fn(page),
    minGapMs: 0,
    state: freshState(),
    cache: new TtlCache<AaResult>(3_600_000),
    ...extra,
  });
}

describe("runCall", () => {
  it("reads page 1 from the page's own XHR; one page load when the profile has cookies", async () => {
    const page = fakePage({ xhr: okBody });
    const r = await runWith(page)(call);
    expect(r).toEqual({
      ok: true,
      tier: 3,
      data: [expect.objectContaining({ id: "1", price: 30 }), expect.objectContaining({ id: "2" })],
    });
    expect(page.visited).toEqual(["https://ar.shein.com/pdsearch/summer%20dress/"]);
  });

  it("fresh profile (no SHEIN cookies): warms up the home page once", async () => {
    const page = fakePage({ xhr: okBody, cookies: 0 });
    const run = runWith(page);
    await run(call);
    await run({ ...call, args: { ...call.args, q: "red dress" } });
    expect(page.visited).toEqual([
      "https://ar.shein.com/",
      "https://ar.shein.com/pdsearch/summer%20dress/",
      "https://ar.shein.com/pdsearch/red%20dress/",
    ]);
  });

  it("falls back to window.gbRawData when the XHR is not seen", async () => {
    const page = fakePage({ gbRawData: { products: [goods("7")], num: 1 } });
    const r = await runWith(page)(call);
    expect(r).toMatchObject({ ok: true, data: [expect.objectContaining({ id: "7" })] });
  });

  it("a real empty result is ok with no items", async () => {
    const r = await runWith(fakePage({ xhr: { code: "0", info: { products: [], num: 0 } } }))(call);
    expect(r).toEqual({ ok: true, tier: 3, data: [] });
  });

  it("no product data and no challenge -> drift", async () => {
    const r = await runWith(fakePage({}))(call);
    expect(r).toMatchObject({ ok: false, class: "drift" });
  });

  it("redirect to /risk/challenge -> blocked", async () => {
    const r = await runWith(fakePage({ finalUrl: "https://ar.shein.com/risk/challenge?captcha_type=909", xhr: okBody }))(call);
    expect(r).toMatchObject({ ok: false, class: "blocked" });
  });

  it("403 / 429 -> blocked", async () => {
    expect(await runWith(fakePage({ status: 403 }))(call)).toMatchObject({ ok: false, class: "blocked" });
    expect(await runWith(fakePage({ status: 429 }))(call)).toMatchObject({ ok: false, class: "blocked" });
  });

  it("navigation error -> error; launcher failure -> error, never throws", async () => {
    expect(await runWith(fakePage({ gotoThrows: new Error("net::ERR_TIMED_OUT") }))(call)).toMatchObject({
      ok: false,
      class: "error",
    });
    const run = createRunCall({
      withPage: async () => {
        throw new Error("Chrome not found");
      },
      minGapMs: 0,
      state: freshState(),
    });
    expect(await run(call)).toEqual({ ok: false, class: "error", reason: "Chrome not found" });
  });

  it("bad args -> error without loading", async () => {
    const page = fakePage({ xhr: okBody });
    const run = runWith(page);
    expect(await run({ op: "search", args: { q: "¿¿", page: "1", sort: "" } })).toMatchObject({ class: "error" });
    expect(await run({ op: "search", args: { q: "x", page: "2", sort: "" } })).toMatchObject({ class: "error" });
    expect(await run({ op: "detail", args: { q: "x", page: "1", sort: "" } })).toMatchObject({ class: "error" });
    expect(page.visited).toEqual([]);
  });
});

describe("runCall cache and spacing", () => {
  afterEach(() => vi.useRealTimers());

  it("ok results cached for 60 min by default: identical call -> one load; expires after", async () => {
    vi.useFakeTimers();
    const page = fakePage({ xhr: okBody });
    const run = createRunCall({ withPage: (fn) => fn(page), minGapMs: 0, state: freshState() });
    const a = await run(call);
    await vi.advanceTimersByTimeAsync(59 * 60_000);
    expect(await run(call)).toEqual(a);
    expect(page.visited).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(2 * 60_000);
    await run(call);
    expect(page.visited).toHaveLength(2);
  });

  it("drift is never cached", async () => {
    const page = fakePage({});
    const run = runWith(page);
    await run(call);
    await run(call);
    expect(page.visited).toHaveLength(2);
  });

  it("loads are at least 5 s apart by default", async () => {
    vi.useFakeTimers();
    const loads = { at: [] as number[] };
    const page = fakePage({ xhr: okBody, loads });
    const run = createRunCall({ withPage: (fn) => fn(page), state: freshState(), cache: new TtlCache<AaResult>(1) });
    await run(call);
    const second = run({ ...call, args: { ...call.args, q: "red dress" } });
    await vi.advanceTimersByTimeAsync(6_000);
    await second;
    expect(loads.at).toHaveLength(2);
    expect(loads.at[1] - loads.at[0]).toBeGreaterThanOrEqual(5_000);
  });
});

describe("runCall back-off", () => {
  afterEach(() => vi.useRealTimers());

  it("after a challenge, calls (even queued ones) make no load for 2 h", async () => {
    vi.useFakeTimers();
    const page = fakePage({ finalUrl: "https://ar.shein.com/risk/challenge?captcha_type=909" });
    let tail: Promise<unknown> = Promise.resolve();
    const withPage = <T,>(fn: (p: SheinPage) => Promise<T>): Promise<T> => {
      const r = tail.then(() => fn(page));
      tail = r.catch(() => {});
      return r;
    };
    const run = createRunCall({ withPage, minGapMs: 0, state: freshState() });
    const other = { ...call, args: { ...call.args, q: "red dress" } };
    const [r1, r2] = await Promise.all([run(call), run(other)]);
    expect(r1).toMatchObject({ ok: false, class: "blocked" });
    expect(r2).toEqual({ ok: false, class: "blocked", reason: "SHEIN blocked recently" });
    expect(page.visited).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(119 * 60_000);
    expect(await run(other)).toMatchObject({ class: "blocked", reason: "SHEIN blocked recently" });
    expect(page.visited).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(60_000 + 10);
    await run(other);
    expect(page.visited).toHaveLength(2);
  });

  it("back-off doubles per consecutive strike (2 h, 4 h, 8 h), caps at 12 h, resets on the first ok", async () => {
    vi.useFakeTimers();
    const H = 3_600_000;
    const o: FakeOpts = { finalUrl: "https://ar.shein.com/risk/challenge?captcha_type=909", xhr: okBody };
    const page = fakePage(o);
    const state = freshState();
    const saved: { blockedUntil: number; strikes: number }[] = [];
    const run = createRunCall({
      withPage: (fn) => fn(page),
      minGapMs: 0,
      state,
      persist: { load: () => null, save: (v) => saved.push({ ...v }) },
    });
    const q = (n: number) => ({ ...call, args: { ...call.args, q: `dress ${n}` } });
    const strike = async (n: number) => {
      const t0 = Date.now();
      expect(await run(q(n))).toMatchObject({ class: "blocked" });
      return state.blockedUntil - t0;
    };
    expect(await strike(1)).toBe(2 * H);
    await vi.advanceTimersByTimeAsync(2 * H);
    expect(await strike(2)).toBe(4 * H);
    await vi.advanceTimersByTimeAsync(4 * H);
    expect(await strike(3)).toBe(8 * H);
    await vi.advanceTimersByTimeAsync(8 * H);
    expect(await strike(4)).toBe(12 * H);
    await vi.advanceTimersByTimeAsync(12 * H);
    expect(await strike(5)).toBe(12 * H);
    expect(saved.at(-1)).toEqual({ blockedUntil: state.blockedUntil, strikes: 5 });

    await vi.advanceTimersByTimeAsync(12 * H);
    o.finalUrl = undefined;
    expect(await run(q(6))).toMatchObject({ ok: true });
    expect(state.strikes).toBe(0);
    expect(saved.at(-1)).toMatchObject({ strikes: 0 });
    o.finalUrl = "https://ar.shein.com/risk/challenge?captcha_type=909";
    expect(await strike(7)).toBe(2 * H);
  });

  it("a persisted back-off is honored by a fresh state (module reload / dev restart)", async () => {
    const store: { v: { blockedUntil: number; strikes: number } | null } = { v: null };
    const persist = { load: () => store.v, save: (v: { blockedUntil: number; strikes: number }) => (store.v = { ...v }) };
    const blockedPage = fakePage({ finalUrl: "https://ar.shein.com/risk/challenge?captcha_type=909" });
    await createRunCall({ withPage: (fn) => fn(blockedPage), minGapMs: 0, state: freshState(), persist })(call);
    expect(store.v).toMatchObject({ strikes: 1 });

    const page = fakePage({ xhr: okBody });
    const state = freshState(); // as after a restart: nothing in memory
    const r = await createRunCall({ withPage: (fn) => fn(page), minGapMs: 0, state, persist })(call);
    expect(r).toMatchObject({ class: "blocked", reason: "SHEIN blocked recently" });
    expect(page.visited).toEqual([]);
    expect(state.strikes).toBe(1);
  });

  it("a persisted back-off is clamped on load (<= now + 12 h, strikes <= 8); non-finite ignored", async () => {
    const H = 3_600_000;
    const page = fakePage({ xhr: okBody });
    const state = freshState();
    const persist = { load: () => ({ blockedUntil: Date.now() + 1000 * H, strikes: 50 }), save: () => {} };
    const r = await createRunCall({ withPage: (fn) => fn(page), minGapMs: 0, state, persist })(call);
    expect(r).toMatchObject({ class: "blocked" });
    expect(state.blockedUntil).toBeLessThanOrEqual(Date.now() + 12 * H);
    expect(state.strikes).toBe(8);

    for (const bad of [Infinity, NaN]) {
      const st = freshState();
      const p2 = fakePage({ xhr: okBody });
      const r2 = await createRunCall({
        withPage: (fn) => fn(p2),
        minGapMs: 0,
        state: st,
        persist: { load: () => ({ blockedUntil: bad, strikes: 3 }), save: () => {} },
      })(call);
      expect(r2).toMatchObject({ ok: true });
      expect(st.blockedUntil).toBe(0);
    }
  });

  it("the default persistence file lives in the SHEIN profile dir", async () => {
    const { backoffFile } = await import("@/src/sites/shein-sa/search");
    vi.stubEnv("SHEIN_PROFILE_DIR", "C:/x/shein");
    try {
      expect(backoffFile().replace(/\\/g, "/")).toMatch(/x\/shein\/deal-search-backoff\.json$/);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("back-off lives in the injected state object (globalThis in the app), not the closure", async () => {
    const state = freshState();
    state.blockedUntil = Date.now() + 60_000;
    const page = fakePage({ xhr: okBody });
    const r = await createRunCall({ withPage: (fn) => fn(page), minGapMs: 0, state })(call);
    expect(r).toMatchObject({ class: "blocked" });
    expect(page.visited).toEqual([]);
  });

  it("the default state is a globalThis singleton (survives HMR)", async () => {
    vi.resetModules();
    const a = await import("@/src/sites/shein-sa/search");
    vi.resetModules();
    const b = await import("@/src/sites/shein-sa/search");
    expect(a.sheinState()).toBe(b.sheinState());
  });
});
