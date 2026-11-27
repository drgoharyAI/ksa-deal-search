import { describe, it, expect, vi, afterEach } from "vitest";
import { TtlCache } from "@/src/lib/cache";
import type { AaResult } from "@/src/lib/aa";
import fixture from "../fixtures/noon-sa-search.json";
import {
  sanitizeQ,
  normalizeSearchItem,
  searchCalls,
  createRunCall,
  toRawItems,
  type NoonPage,
} from "@/src/sites/noon-sa/search";

describe("sanitizeQ", () => {
  it("keeps only letters, digits, spaces, hyphens", () => {
    expect(sanitizeQ("usb-c cable 100w")).toBe("usb-c cable 100w");
    expect(sanitizeQ("a/b & c")).toBe("a b c");
    expect(sanitizeQ("¿¿")).toBe("");
  });
});

describe("normalizeSearchItem", () => {
  it("maps every fixture item to Product or null, no NaN, >=10 products", () => {
    const products = fixture.items.map((it) => normalizeSearchItem(it));
    const ok = products.filter((p) => p !== null);
    expect(ok.length).toBeGreaterThanOrEqual(10);
    for (const p of ok) {
      expect(p.site).toBe("noon-sa");
      expect(p.currency).toBe("SAR");
      expect(p.url.startsWith("https://www.noon.com/saudi-en/")).toBe(true);
      expect(p.url).not.toContain("?");
      expect(p.id).toMatch(/^[A-Za-z0-9]+$/);
      expect(p.listPrice).toBeGreaterThan(0);
      expect(p.finalPrice).toBe(p.listPrice);
      expect(p.soldCount).toBe(0);
      expect(p.detailStatus).toBe("ok");
      expect(p.shipping).toBeNull();
      if (p.image) expect(p.image.startsWith("https://")).toBe(true);
      for (const v of [p.listPrice, p.origPrice, p.discountPct, p.rating]) {
        if (v !== null) expect(Number.isNaN(v)).toBe(false);
      }
    }
  });

  it("maps a discounted item; id from /<SKU>/p/, query stripped", () => {
    const p = normalizeSearchItem({
      title: "T",
      price: 199,
      origPrice: 529,
      rating: 4.6,
      reviews: 2300,
      image: "//f.nooncdn.com/x.jpg",
      url: "https://www.noon.com/saudi-en/slug/N70131428V/p/?o=abc&nav_ctx=1",
    })!;
    expect(p.id).toBe("N70131428V");
    expect(p.url).toBe("https://www.noon.com/saudi-en/slug/N70131428V/p/");
    expect(p.listPrice).toBe(199);
    expect(p.origPrice).toBe(529);
    expect(p.discountPct).toBe(62);
    expect(p.rating).toBe(4.6);
    expect(p.image).toBe("https://f.nooncdn.com/x.jpg");
  });

  it("origPrice only when > price; string prices parsed", () => {
    const p = normalizeSearchItem({
      title: "T",
      price: "1,234.50",
      origPrice: "1,234.50",
      url: "https://www.noon.com/saudi-en/x/ABC123/p/",
    })!;
    expect(p.listPrice).toBe(1234.5);
    expect(p.origPrice).toBeNull();
    expect(p.discountPct).toBeNull();
    expect(p.rating).toBeNull();
  });

  it("rejects bad items", () => {
    const url = "https://www.noon.com/saudi-en/x/ABC123/p/";
    expect(normalizeSearchItem(null)).toBeNull();
    expect(normalizeSearchItem({ title: "T", price: 0, url })).toBeNull();
    expect(normalizeSearchItem({ title: "T", price: "abc", url })).toBeNull();
    expect(normalizeSearchItem({ title: "T", price: 10, url: "https://evil.example/saudi-en/x/A1/p/" })).toBeNull();
    expect(normalizeSearchItem({ title: "T", price: 10, url: "https://www.noon.com/uae-en/x/A1/p/" })).toBeNull();
    expect(normalizeSearchItem({ title: "T", price: 10, url: "https://www.noon.com/saudi-en/no-sku" })).toBeNull();
  });
});

describe("toRawItems", () => {
  it("makes hrefs absolute, strips query, parses numbers and review counts", () => {
    const items = toRawItems([
      {
        href: "/saudi-en/slug/N1A/p/?o=1",
        title: "T",
        price: "72",
        origPrice: "189",
        rating: "4.5",
        reviews: "71.9K",
        image: "https://f.nooncdn.com/a.jpg",
      },
      { href: null, title: "x", price: "1", origPrice: null, rating: null, reviews: null, image: null },
    ]);
    expect(items).toEqual([
      {
        id: "N1A",
        title: "T",
        price: 72,
        origPrice: 189,
        currency: "SAR",
        rating: 4.5,
        reviews: 71900,
        image: "https://f.nooncdn.com/a.jpg",
        url: "https://www.noon.com/saudi-en/slug/N1A/p/",
      },
    ]);
  });
});

describe("searchCalls", () => {
  it("main term only, page 1 and 2", () => {
    const calls = searchCalls({ terms: "usb c cable", exclude: [] }, ["usb-c cord", "type c cable"]);
    expect(calls).toEqual([
      { op: "search", args: { q: "usb c cable", page: "1", sort: "" } },
      { op: "search", args: { q: "usb c cable", page: "2", sort: "" } },
    ]);
  });
  it("sanitizes; empty -> []", () => {
    expect(searchCalls({ terms: "a/b & c", exclude: [] }, [])[0].args.q).toBe("a b c");
    expect(searchCalls({ terms: "¿¿", exclude: [] }, ["ok"])).toEqual([]);
  });
});

type FakeOpts = {
  status?: number;
  outcome?: "ok" | "denied" | "timeout";
  gotos?: { n: number };
  captcha?: boolean;
  gotoThrows?: Error;
  cards?: unknown[];
};

function fakePage(o: FakeOpts) {
  const visited: string[] = [];
  const page = {
    visited,
    async goto(url: string) {
      visited.push(url);
      if (o.gotos) o.gotos.n++;
      if (o.gotoThrows) throw o.gotoThrows;
      return { status: () => o.status ?? 200 };
    },
    async waitForLoadState() {},
    async waitForTimeout() {},
    async title() {
      return o.outcome === "denied" ? "Access Denied" : "noon";
    },
    async waitForFunction() {
      if ((o.outcome ?? "ok") === "timeout") throw new Error("Timeout 25000ms exceeded");
      return { jsonValue: async () => o.outcome ?? "ok" };
    },
    async $() {
      return o.captcha ? {} : null;
    },
    async $$eval() {
      return o.cards ?? [];
    },
  };
  return page as typeof page & NoonPage;
}

function runCallWith(page: NoonPage) {
  return createRunCall({ withPage: (fn) => fn(page), minGapMs: 0 });
}

const call = { op: "search", args: { q: "usb c cable", page: "1", sort: "" } };

describe("runCall", () => {
  it("returns tier 3 items on success; warms up the home page once", async () => {
    const page = fakePage({
      cards: [
        { href: "/saudi-en/a/N1/p/", title: "A", price: "10", origPrice: null, rating: null, reviews: null, image: null },
      ],
    });
    const run = runCallWith(page);
    const r = await run(call);
    expect(r).toEqual({ ok: true, tier: 3, data: [expect.objectContaining({ id: "N1", price: 10 })] });
    await run({ ...call, args: { ...call.args, page: "2" } });
    expect(page.visited).toEqual([
      "https://www.noon.com/saudi-en/",
      "https://www.noon.com/saudi-en/search/?q=usb%20c%20cable&page=1",
      "https://www.noon.com/saudi-en/search/?q=usb%20c%20cable&page=2",
    ]);
  });

  it("a call whose search was cancelled while it waited loads nothing and is not cached (U2)", async () => {
    const page = fakePage({ cards: [{ href: "/saudi-en/a/N1/p/", title: "A", price: "10", origPrice: null, rating: null, reviews: null, image: null }] });
    const run = runCallWith(page);
    const ctrl = new AbortController();
    ctrl.abort();
    expect(await run(call, { signal: ctrl.signal })).toMatchObject({ ok: false, class: "aborted" });
    expect(page.visited).toEqual([]);
    expect(await run(call)).toMatchObject({ ok: true });
  });

  it("blockedEndsAt: the end of the current block, else undefined (U2)", async () => {
    const run = runCallWith(fakePage({ status: 403 }));
    expect(run.blockedEndsAt()).toBeUndefined();
    await run(call);
    expect(run.blockedEndsAt()).toBeGreaterThan(Date.now());
  });

  it("403 -> blocked", async () => {
    const r = await runCallWith(fakePage({ status: 403 }))(call);
    expect(r).toMatchObject({ ok: false, class: "blocked" });
  });

  it("Access Denied title -> blocked", async () => {
    const r = await runCallWith(fakePage({ outcome: "denied" }))(call);
    expect(r).toMatchObject({ ok: false, class: "blocked" });
  });

  it("challenge shown -> blocked", async () => {
    const r = await runCallWith(fakePage({ outcome: "timeout", captcha: true }))(call);
    expect(r).toMatchObject({ ok: false, class: "blocked" });
  });

  it("thrown navigation error -> error", async () => {
    const r = await runCallWith(fakePage({ gotoThrows: new Error("net::ERR_TIMED_OUT") }))(call);
    expect(r).toMatchObject({ ok: false, class: "error" });
  });

  it("launcher failure (Chrome not found) -> error, never throws", async () => {
    const run = createRunCall({
      withPage: async () => {
        throw new Error("Chrome not found");
      },
      minGapMs: 0,
    });
    expect(await run(call)).toEqual({ ok: false, class: "error", reason: "Chrome not found" });
  });

  it("bad args -> error without loading", async () => {
    const page = fakePage({});
    const run = runCallWith(page);
    expect(await run({ op: "search", args: { q: "¿¿", page: "1", sort: "" } })).toMatchObject({ ok: false, class: "error" });
    expect(await run({ op: "search", args: { q: "x", page: "abc", sort: "" } })).toMatchObject({ ok: false, class: "error" });
    expect(await run({ op: "detail", args: { q: "x", page: "1", sort: "" } })).toMatchObject({ ok: false, class: "error" });
    expect(page.visited).toEqual([]);
  });
});

const priced = [{ href: "/saudi-en/a/N1/p/", title: "A", price: "10", origPrice: null, rating: null, reviews: null, image: null }];

describe("runCall cache", () => {
  it("identical call twice -> one search page load (ok results cached)", async () => {
    const page = fakePage({ cards: priced });
    const run = createRunCall({ withPage: (fn) => fn(page), minGapMs: 0, cache: new TtlCache<AaResult>(600_000) });
    const a = await run(call);
    const b = await run(call);
    expect(b).toEqual(a);
    expect(page.visited.filter((u) => u.includes("/search/"))).toHaveLength(1);
  });

  it("drift is never cached", async () => {
    const page = fakePage({ outcome: "timeout" });
    const run = runCallWith(page);
    await run(call);
    await run(call);
    expect(page.visited.filter((u) => u.includes("/search/"))).toHaveLength(2);
  });
});

describe("runCall drift", () => {
  it("no cards and no challenge -> drift", async () => {
    const r = await runCallWith(fakePage({ outcome: "timeout" }))(call);
    expect(r).toEqual({ ok: false, class: "drift", reason: "no product cards" });
  });

  it("cards present but none with a price -> drift", async () => {
    const r = await runCallWith(
      fakePage({ cards: [{ ...priced[0], price: null }] }),
    )(call);
    expect(r).toMatchObject({ ok: false, class: "drift" });
  });
});

describe("runCall blocked short-circuit", () => {
  afterEach(() => vi.useRealTimers());

  it("after a block, later calls (even queued ones) make no load for 10 min", async () => {
    vi.useFakeTimers();
    const gotos = { n: 0 };
    const page = fakePage({ status: 403, gotos });
    // Serializing fake provider, like the real browser queue.
    let tail: Promise<unknown> = Promise.resolve();
    const withPage = <T,>(fn: (p: NoonPage) => Promise<T>): Promise<T> => {
      const r = tail.then(() => fn(page));
      tail = r.catch(() => {});
      return r;
    };
    const run = createRunCall({ withPage, minGapMs: 0 });
    const p2 = { ...call, args: { ...call.args, page: "2" } };
    const [r1, r2] = await Promise.all([run(call), run(p2)]);
    expect(r1).toMatchObject({ ok: false, class: "blocked" });
    expect(r2).toEqual({ ok: false, class: "blocked", reason: "noon blocked recently" });
    expect(gotos.n).toBe(1);

    await vi.advanceTimersByTimeAsync(9 * 60_000);
    expect(await run(p2)).toEqual({ ok: false, class: "blocked", reason: "noon blocked recently" });
    expect(gotos.n).toBe(1);

    await vi.advanceTimersByTimeAsync(60_000 + 10);
    await run(p2);
    expect(gotos.n).toBeGreaterThan(1);
  });
});
