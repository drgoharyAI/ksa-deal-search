import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openDb, type Db } from "@/src/lib/db";
import { HOUR, DAY } from "@/src/lib/insights";
import { CHECK_CAPS, checkProduct, gshopConfig, gshopStatus, resetGshopFlights, SCRAPE_LIMITS, type GshopDeps } from "@/src/lib/gshop/service";
import type { ScrapePage } from "@/src/lib/gshop/scrape";

const fixture = (name: string) => fs.readFileSync(path.join(__dirname, "..", "fixtures", "gshop", name), "utf8");
const KEY = "sk_live_SECRET_abcdef";
const T0 = Date.UTC(2026, 10, 28, 9, 0, 0);
const TITLE = "JBL Flip 6 Portable Bluetooth Speaker Waterproof Wireless";

let db: Db;
let now = T0;
let serpCalls: string[] = [];
let accountLeft: number | null = 250;
let renewal: string | null = null;
let serpAnswer: (engine: string) => Response | null = () => null;
let loads: string[] = [];
let sleeps: number[] = [];
let pageMode: "ok" | "captcha" = "ok";

function seed(site = "noon-sa", id = "N1", price = 349, orig: number | null = null) {
  db.prepare("INSERT INTO seen_products (site, productId, title, url, image, currency, lastSeen) VALUES (?, ?, ?, ?, NULL, 'SAR', ?)").run(site, id, TITLE, "https://www.noon.com/saudi-en/N1/p/", now);
  db.prepare("INSERT INTO observations (site, productId, price, origPrice, at) VALUES (?, ?, ?, ?, ?)").run(site, id, price, orig, now - HOUR);
}

const fetchStub = (async (input: RequestInfo | URL) => {
  const u = new URL(input instanceof URL ? input.href : typeof input === "string" ? input : input.url);
  if (u.pathname === "/account.json") return new Response(JSON.stringify({ plan_searches_left: accountLeft, plan_renewal_date: renewal }), { status: 200 });
  const engine = u.searchParams.get("engine") ?? "";
  serpCalls.push(engine);
  const custom = serpAnswer(engine);
  if (custom) return custom;
  return new Response(fixture(engine === "google_shopping" ? "serpapi-shopping-jbl.json" : "serpapi-immersive-jbl.json"), { status: 200 });
}) as typeof fetch;

function fakePage(): ScrapePage {
  let url = "about:blank";
  let clicked = false;
  return {
    async goto(u) {
      loads.push(u);
      url = pageMode === "captcha" ? "https://www.google.com.sa/sorry/index" : u;
    },
    url: () => url,
    content: async () => (pageMode === "captcha" ? fixture("google-sorry.html") : fixture(clicked ? "google-panel-jbl-flip-6.html" : "google-results-jbl-flip-6.html")),
    async clickCard() {
      loads.push("panel");
      clicked = true;
    },
    wait: async () => {},
  };
}

function deps(env: Record<string, string | undefined> = { SERPAPI_KEY: KEY }): GshopDeps {
  return {
    db,
    env,
    now: () => now,
    fetch: fetchStub,
    withPage: (fn) => fn(fakePage()),
    sleep: async (ms) => {
      sleeps.push(ms);
      now += ms;
    },
  };
}

beforeEach(() => {
  db = openDb(":memory:");
  now = T0;
  serpCalls = [];
  loads = [];
  sleeps = [];
  accountLeft = 250;
  renewal = null;
  pageMode = "ok";
  serpAnswer = () => null;
  resetGshopFlights();
  seed();
});
afterEach(() => db.close());

describe("config", () => {
  it("reads the key, the budget (default 240), auto (off by default) and a forced source", () => {
    expect(gshopConfig({})).toEqual({ key: null, budget: 240, auto: false, force: null });
    expect(gshopConfig({ SERPAPI_KEY: " k ", GSHOP_MONTHLY_BUDGET: "100", GSHOP_AUTO: "1", GSHOP_SOURCE: "google" })).toEqual({ key: "k", budget: 100, auto: true, force: "google" });
    expect(gshopConfig({ GSHOP_MONTHLY_BUDGET: "999" }).budget).toBe(240);
    expect(gshopConfig({ GSHOP_MONTHLY_BUDGET: "x" }).budget).toBe(240);
  });
});

describe("SerpApi first", () => {
  it("runs shopping then immersive, counts both calls, and returns the verdict with its source", async () => {
    const a = await checkProduct(deps(), { site: "noon-sa", id: "N1" });
    expect(serpCalls).toEqual(["google_shopping", "google_immersive_product"]);
    expect(loads).toEqual([]);
    expect(a.ok && a.result.source).toBe("serpapi");
    // Amazon.sa 329 is the lowest of the Saudi offers; ours (noon) is 349: others beat it.
    expect(a.ok && a.result).toMatchObject({ verdict: "not-unique", lowest: { store: "Amazon.sa", price: 329, url: "https://www.amazon.sa/dp/B09TEST" } });
    expect(gshopStatus(deps()).serpapi.left).toBe(238);
  });
  it("records the other stores' offers as observations under gshop:<store>", async () => {
    await checkProduct(deps(), { site: "noon-sa", id: "N1" });
    const rows = db.prepare("SELECT site, productId, price FROM observations WHERE site LIKE 'gshop:%' ORDER BY price").all();
    expect(rows[0]).toEqual({ site: "gshop:amazon.sa", productId: "noon-sa:N1", price: 329 });
  });
  it("caches a product's offers for 24 h, then checks again", async () => {
    await checkProduct(deps(), { site: "noon-sa", id: "N1" });
    now += 23 * HOUR;
    const b = await checkProduct(deps(), { site: "noon-sa", id: "N1" });
    expect(serpCalls).toHaveLength(2);
    expect(b.ok && b.result.checkedAt).toBe(T0);
    now += 2 * HOUR;
    await checkProduct(deps(), { site: "noon-sa", id: "N1" });
    expect(serpCalls).toHaveLength(4);
  });
  it("single-flight: the same product is never fetched twice at once", async () => {
    const [a, b] = await Promise.all([checkProduct(deps(), { site: "noon-sa", id: "N1" }), checkProduct(deps(), { site: "noon-sa", id: "N1" })]);
    expect(serpCalls).toHaveLength(2);
    expect(a).toEqual(b);
  });
  it("no match in the shopping results: one call spent, no immersive call, no data", async () => {
    serpAnswer = (e) => (e === "google_shopping" ? new Response(JSON.stringify({ search_metadata: { status: "Success" }, shopping_results: [] }), { status: 200 }) : null);
    const a = await checkProduct(deps(), { site: "noon-sa", id: "N1" });
    expect(serpCalls).toEqual(["google_shopping"]);
    expect(a.ok && a.result).toMatchObject({ verdict: "no-data", reason: "no-match", source: "serpapi" });
  });
});

describe("live SerpApi recording (jbl flip 6, 2026-11-28)", () => {
  it("amazon.sa's gray Flip 6 at SAR 349: Abdulwahed matches it, so others match this price", async () => {
    db.prepare("INSERT INTO seen_products (site, productId, title, url, currency, lastSeen) VALUES ('amazon-sa', 'B09HGVNLFK', 'JBL Flip 6 Gray Portable Bluetooth Speaker Waterproof Wireless', 'https://www.amazon.sa/dp/B09HGVNLFK', 'SAR', ?)").run(now);
    db.prepare("INSERT INTO observations (site, productId, price, origPrice, at) VALUES ('amazon-sa', 'B09HGVNLFK', 349, NULL, ?)").run(now - HOUR);
    serpAnswer = (e) => new Response(fixture(e === "google_shopping" ? "serpapi-live-shopping-jbl-flip-6.json" : "serpapi-live-immersive-jbl-flip-6.json"), { status: 200 });
    const a = await checkProduct(deps(), { site: "amazon-sa", id: "B09HGVNLFK" });
    expect(a.ok && a.result.verdict).toBe("not-unique");
    const others = a.ok ? a.result.others : [];
    // Amazon.sa is our own store; links.hr, Yoho (Hong Kong), Etoren, Level-Up (AE) and samma3a.com are not Saudi hosts.
    expect(others.map((o) => [o.store, o.price, o.was])).toEqual([["Abdulwahed", 349, 499], ["Carrefour KSA", 499, null], ["Doos.sa", 499, null]]);
    expect(others.every((o) => o.url?.startsWith("https://"))).toBe(true);
  });
});

describe("live production check (2026-11-28): a long query brought unrelated results", () => {
  it("asks Google Shopping for the product's name and model only (\"JBL Flip 6\"), not the long title", async () => {
    db.prepare("INSERT INTO seen_products (site, productId, title, url, currency, lastSeen) VALUES ('amazon-sa', 'B09HGVNLFK', 'JBL Flip 6 Gray Portable Bluetooth Speaker Waterproof Wireless', 'https://www.amazon.sa/dp/B09HGVNLFK', 'SAR', ?)").run(now);
    db.prepare("INSERT INTO observations (site, productId, price, origPrice, at) VALUES ('amazon-sa', 'B09HGVNLFK', 349, NULL, ?)").run(now - HOUR);
    const queries: string[] = [];
    const recording = (async (input: RequestInfo | URL) => {
      const u = new URL(input instanceof URL ? input.href : typeof input === "string" ? input : input.url);
      if (u.pathname === "/account.json") return new Response(JSON.stringify({ plan_searches_left: 239 }));
      const engine = u.searchParams.get("engine");
      if (engine === "google_shopping") queries.push(u.searchParams.get("q") ?? "");
      return new Response(fixture(engine === "google_shopping" ? "serpapi-live-shopping-jbl-flip-6.json" : "serpapi-live-immersive-jbl-flip-6.json"));
    }) as typeof fetch;
    const a = await checkProduct({ ...deps(), fetch: recording }, { site: "amazon-sa", id: "B09HGVNLFK" });
    expect(queries).toEqual(["JBL Flip 6"]);
    expect(a.ok && a.result.verdict).toBe("not-unique");
  });
  it("the recorded unrelated answer itself has no match: no immersive call, no data (as seen in production)", async () => {
    db.prepare("INSERT INTO seen_products (site, productId, title, url, currency, lastSeen) VALUES ('amazon-sa', 'B09HGVNLFK', 'JBL Flip 6 Gray Portable Bluetooth Speaker Waterproof Wireless', 'https://www.amazon.sa/dp/B09HGVNLFK', 'SAR', ?)").run(now);
    db.prepare("INSERT INTO observations (site, productId, price, origPrice, at) VALUES ('amazon-sa', 'B09HGVNLFK', 349, NULL, ?)").run(now - HOUR);
    serpAnswer = (e) => (e === "google_shopping" ? new Response(fixture("serpapi-live-shopping-long-query-noise.json")) : null);
    const a = await checkProduct(deps(), { site: "amazon-sa", id: "B09HGVNLFK" });
    expect(serpCalls).toEqual(["google_shopping"]);
    expect(a.ok && a.result).toMatchObject({ verdict: "no-data", reason: "no-match", source: "serpapi" });
  });
});

describe("live production check (2026-11-28, 09:39 UTC): SerpApi answered from a non-Saudi location", () => {
  it("a no-match is kept only 2 h, then the product is checked again (a real answer keeps 24 h)", async () => {
    serpAnswer = (e) => (e === "google_shopping" ? new Response(JSON.stringify({ search_metadata: { status: "Success" }, shopping_results: [] }), { status: 200 }) : null);
    await checkProduct(deps(), { site: "noon-sa", id: "N1" });
    now += HOUR;
    await checkProduct(deps(), { site: "noon-sa", id: "N1" });
    expect(serpCalls).toEqual(["google_shopping"]);
    now += HOUR + 1;
    await checkProduct(deps(), { site: "noon-sa", id: "N1" });
    expect(serpCalls).toEqual(["google_shopping", "google_shopping"]);
  });
  it("pinned to Riyadh, the same query finds the Flip 6 (21 of 40 results) and the check reaches the store offers", async () => {
    db.prepare("INSERT INTO seen_products (site, productId, title, url, currency, lastSeen) VALUES ('amazon-sa', 'B09HGVNLFK', 'JBL Flip 6 Gray Portable Bluetooth Speaker Waterproof Wireless', 'https://www.amazon.sa/dp/B09HGVNLFK', 'SAR', ?)").run(now);
    db.prepare("INSERT INTO observations (site, productId, price, origPrice, at) VALUES ('amazon-sa', 'B09HGVNLFK', 349, NULL, ?)").run(now - HOUR);
    serpAnswer = (e) => new Response(fixture(e === "google_shopping" ? "serpapi-live-shopping-riyadh-jbl-flip-6.json" : "serpapi-live-immersive-jbl-flip-6.json"), { status: 200 });
    const a = await checkProduct(deps(), { site: "amazon-sa", id: "B09HGVNLFK" });
    expect(serpCalls).toEqual(["google_shopping", "google_immersive_product"]);
    expect(a.ok && a.result.verdict).toBe("not-unique");
  });
});

describe("live Google recording (jbl flip 6, 2026-11-28)", () => {
  it("the Chrome path on the recorded page and panel: Abdulwahed at SAR 349 matches amazon.sa's price", async () => {
    db.prepare("INSERT INTO seen_products (site, productId, title, url, currency, lastSeen) VALUES ('amazon-sa', 'B09HGVNLFK', 'JBL Flip 6 Gray Portable Bluetooth Speaker Waterproof Wireless', 'https://www.amazon.sa/dp/B09HGVNLFK', 'SAR', ?)").run(now);
    db.prepare("INSERT INTO observations (site, productId, price, origPrice, at) VALUES ('amazon-sa', 'B09HGVNLFK', 349, NULL, ?)").run(now - HOUR);
    let clicked = false;
    let url = "about:blank";
    const page: ScrapePage = {
      goto: async (u) => {
        url = u;
      },
      url: () => url,
      content: async () => fixture(clicked ? "google-panel-jbl-flip-6.html" : "google-results-live-jbl-flip-6-gray.html"),
      clickCard: async () => {
        clicked = true;
      },
      wait: async () => {},
    };
    const a = await checkProduct({ ...deps({}), withPage: (fn) => fn(page) }, { site: "amazon-sa", id: "B09HGVNLFK" });
    expect(a.ok && a.result).toMatchObject({ verdict: "not-unique", source: "google" });
    const others = a.ok ? a.result.others : [];
    // Amazon.sa is ours; Samma3a.com shows a foreign (AED) price; the panel rows carry no direct link.
    expect(others.find((o) => o.store === "Abdulwahed")).toEqual({ store: "Abdulwahed", domain: "abdulwahed.com", price: 349, was: 499, url: null });
    expect(others.some((o) => o.store === "Samma3a.com" || o.store === "Amazon.sa")).toBe(false);
  });
});

describe("monthly budget", () => {
  it("hard-stops SerpApi at the budget and falls back to Google directly", async () => {
    const env = { SERPAPI_KEY: KEY, GSHOP_MONTHLY_BUDGET: "3" };
    await checkProduct(deps(env), { site: "noon-sa", id: "N1" });
    seed("noon-sa", "N2");
    const b = await checkProduct(deps(env), { site: "noon-sa", id: "N2" });
    // 2 used, 1 left: a check needs 2, so SerpApi is not called again.
    expect(serpCalls).toHaveLength(2);
    expect(b.ok && b.result.source).toBe("google");
    expect(gshopStatus(deps(env)).serpapi).toEqual({ enabled: true, left: 1, budget: 3, exhausted: true });
  });
  it("rolls over each calendar month", async () => {
    const env = { SERPAPI_KEY: KEY, GSHOP_MONTHLY_BUDGET: "2" };
    await checkProduct(deps(env), { site: "noon-sa", id: "N1" });
    expect(gshopStatus(deps(env)).serpapi.left).toBe(0);
    now = Date.UTC(2026, 11, 1, 0, 0, 1);
    expect(gshopStatus(deps(env)).serpapi.left).toBe(2);
  });
  it("counts per SerpApi plan period when account.json gives the renewal date, else per UTC month", async () => {
    renewal = "2026-12-28";
    await checkProduct(deps(), { site: "noon-sa", id: "N1" });
    expect(gshopStatus(deps()).serpapi.left).toBe(238);
    // A new UTC month is not a new SerpApi period: the plan renews on the 28th.
    now = Date.UTC(2026, 11, 2);
    expect(gshopStatus(deps()).serpapi.left).toBe(238);
    // Past the renewal date the count starts again.
    now = Date.UTC(2026, 11, 28, 1);
    expect(gshopStatus(deps()).serpapi.left).toBe(240);
  });
  it("trusts SerpApi's own count: plan_searches_left 0 means exhausted for the month", async () => {
    accountLeft = 0;
    const a = await checkProduct(deps(), { site: "noon-sa", id: "N1" });
    expect(serpCalls).toEqual([]);
    expect(a.ok && a.result.source).toBe("google");
    expect(gshopStatus(deps()).serpapi.left).toBe(0);
  });
  it("a 429 'run out of searches' marks the month exhausted; a 503 only falls back once", async () => {
    serpAnswer = () => new Response(JSON.stringify({ error: "Your account has run out of searches." }), { status: 429 });
    const a = await checkProduct(deps(), { site: "noon-sa", id: "N1" });
    expect(a.ok && a.result.source).toBe("google");
    expect(gshopStatus(deps()).serpapi.left).toBe(0);

    db.exec("DELETE FROM gshop_usage; DELETE FROM gshop_cache; DELETE FROM gshop_state");
    serpCalls = [];
    now += 60_000;
    serpAnswer = () => new Response("down", { status: 503 });
    const b = await checkProduct(deps(), { site: "noon-sa", id: "N1" });
    expect(b.ok && b.result.source).toBe("google");
    expect(gshopStatus(deps()).serpapi.left).toBe(239);
  });
  it("starts at Google directly without a key", async () => {
    const a = await checkProduct(deps({}), { site: "noon-sa", id: "N1" });
    expect(serpCalls).toEqual([]);
    expect(loads[0]).toMatch(/^https:\/\/www\.google\.com\.sa\/search\?udm=28/);
    expect(loads[1]).toBe("panel");
    expect(a.ok && a.result).toMatchObject({ source: "google", verdict: "not-unique" });
    expect(gshopStatus(deps({})).serpapi.enabled).toBe(false);
  });
});

describe("Google fallback protections", () => {
  it("a CAPTCHA gives no data and backs off 2 h, doubling to a 12 h cap, persisted in the DB", async () => {
    pageMode = "captcha";
    const a = await checkProduct(deps({}), { site: "noon-sa", id: "N1" });
    expect(a.ok && a.result).toMatchObject({ verdict: "no-data", reason: "blocked" });
    expect(gshopStatus(deps({})).google.backedOffUntil).toBe(now + 2 * HOUR);
    // While backed off: no page load at all.
    loads = [];
    await checkProduct(deps({}), { site: "noon-sa", id: "N1" });
    expect(loads).toEqual([]);
    const strikes: number[] = [];
    for (let i = 0; i < 4; i++) {
      now = (gshopStatus(deps({})).google.backedOffUntil ?? now) + 1;
      await checkProduct(deps({}), { site: "noon-sa", id: "N1" });
      strikes.push(((gshopStatus(deps({})).google.backedOffUntil ?? 0) - now) / HOUR);
    }
    expect(strikes).toEqual([4, 8, 12, 12]);
    // The first good page resets it.
    pageMode = "ok";
    now = (gshopStatus(deps({})).google.backedOffUntil ?? now) + 1;
    await checkProduct(deps({}), { site: "noon-sa", id: "N1" });
    expect(gshopStatus(deps({})).google.backedOffUntil).toBeNull();
  });
  it("an empty page is no CAPTCHA: no data, and no back-off", async () => {
    const a = await checkProduct({ ...deps({}), withPage: (fn) => fn({ ...fakePage(), content: async () => "<html><body></body></html>" }) }, { site: "noon-sa", id: "N1" });
    expect(a.ok && a.result).toMatchObject({ verdict: "no-data", reason: "error" });
    expect(gshopStatus(deps({})).google.backedOffUntil).toBeNull();
  });
  it("a Google job past its deadline recycles the page, answers no data and frees the single-flight", async () => {
    let recycled = 0;
    const stuck = { ...deps({}), deadlineMs: 20, recycle: () => {
        recycled++;
      }, withPage: () => new Promise<never>(() => {}) };
    const a = await checkProduct(stuck, { site: "noon-sa", id: "N1" });
    expect(a.ok && a.result).toMatchObject({ verdict: "no-data", reason: "error" });
    expect(recycled).toBe(1);
    expect(gshopStatus(deps({})).google.backedOffUntil).toBeNull();
    // The flight is free again: the next check runs.
    const b = await checkProduct(deps({}), { site: "noon-sa", id: "N1" });
    expect(b.ok && b.result.source).toBe("google");
  });
  it("a hand-edited back-off is clamped to 12 h", () => {
    db.prepare("INSERT INTO gshop_state (key, value) VALUES ('google:backoff', ?)").run(JSON.stringify({ blockedUntil: now + 30 * DAY, strikes: 99 }));
    expect(gshopStatus(deps({})).google.backedOffUntil).toBe(now + 12 * HOUR);
  });
  it("keeps Google loads at least 15 s apart", async () => {
    await checkProduct(deps({}), { site: "noon-sa", id: "N1" });
    seed("noon-sa", "N2");
    now += 2_000;
    await checkProduct(deps({}), { site: "noon-sa", id: "N2" });
    expect(sleeps).toEqual([SCRAPE_LIMITS.GAP_MS - 2_000]);
  });
  it("stops at 20 Google loads an hour and 100 a day", async () => {
    expect(SCRAPE_LIMITS).toMatchObject({ PER_HOUR: 20, PER_DAY: 100, GAP_MS: 15_000 });
    const hour = new Date(now).toISOString().slice(0, 13);
    db.prepare("INSERT INTO gshop_usage (period, calls) VALUES (?, 20)").run(`google-h:${hour}`);
    const a = await checkProduct(deps({}), { site: "noon-sa", id: "N1" });
    expect(loads).toEqual([]);
    expect(a.ok && a.result).toMatchObject({ verdict: "no-data", reason: "budget" });
    db.exec("DELETE FROM gshop_usage");
    db.prepare("INSERT INTO gshop_usage (period, calls) VALUES (?, 100)").run(`google-d:${hour.slice(0, 10)}`);
    await checkProduct(deps({}), { site: "noon-sa", id: "N1" });
    expect(loads).toEqual([]);
  });
  it("no data when both sources are out", async () => {
    const env = { SERPAPI_KEY: KEY, GSHOP_MONTHLY_BUDGET: "1", GSHOP_SOURCE: "serpapi" };
    const a = await checkProduct(deps(env), { site: "noon-sa", id: "N1" });
    expect(serpCalls).toEqual([]);
    expect(loads).toEqual([]);
    expect(a.ok && a.result).toMatchObject({ verdict: "no-data", reason: "budget", source: null });
  });
  it("GSHOP_SOURCE=google skips SerpApi even with a key", async () => {
    const a = await checkProduct(deps({ SERPAPI_KEY: KEY, GSHOP_SOURCE: "google" }), { site: "noon-sa", id: "N1" });
    expect(serpCalls).toEqual([]);
    expect(a.ok && a.result.source).toBe("google");
  });
});

describe("safety caps on checks (review round 1)", () => {
  const seedMany = (n: number) => {
    for (let i = 0; i < n; i++) seed("noon-sa", `M${i}`);
  };
  it("are 30 checks an hour and 100 a day overall, 10 an hour per client", () => {
    expect(CHECK_CAPS).toEqual({ PER_HOUR: 30, PER_DAY: 100, PER_CLIENT_HOUR: 10 });
  });
  it("stops one client at 10 an hour, with no SerpApi call past the cap; cache hits stay free", async () => {
    seedMany(12);
    for (let i = 0; i < 10; i++) expect((await checkProduct(deps(), { site: "noon-sa", id: `M${i}`, client: "cf:203.0.113.9" })).ok).toBe(true);
    const calls = serpCalls.length;
    expect(await checkProduct(deps(), { site: "noon-sa", id: "M10", client: "cf:203.0.113.9" })).toEqual({ ok: false, error: "rate" });
    expect(serpCalls).toHaveLength(calls);
    // A cached product costs nothing and is still answered.
    expect((await checkProduct(deps(), { site: "noon-sa", id: "M0", client: "cf:203.0.113.9" })).ok).toBe(true);
    // Another client still has room.
    expect((await checkProduct(deps(), { site: "noon-sa", id: "M11", client: "cf:198.51.100.7" })).ok).toBe(true);
  });
  it("an attacker rotating client addresses stops at 30 an hour and 100 a day; the budget is not drained", { timeout: 30_000 }, async () => {
    seedMany(150);
    let refused = 0;
    for (let i = 0; i < 150; i++) {
      const a = await checkProduct(deps(), { site: "noon-sa", id: `M${i}`, client: `cf:10.0.${i}.1` });
      if (!a.ok) refused++;
    }
    expect(refused).toBe(120);
    expect(serpCalls).toHaveLength(60);
    expect(gshopStatus(deps()).serpapi.left).toBe(180);
    // Next hours: the day cap (100) holds.
    for (let h = 1; h <= 4; h++) {
      now += HOUR;
      for (let i = 0; i < 40; i++) {
        seed("noon-sa", `H${h}-${i}`);
        await checkProduct(deps(), { site: "noon-sa", id: `H${h}-${i}`, client: `cf:10.1.${h}.${i}` });
      }
    }
    expect(serpCalls).toHaveLength(200);
    expect(gshopStatus(deps()).serpapi.left).toBe(40);
  });
  it("automatic checks count toward the same caps", async () => {
    const env = { SERPAPI_KEY: KEY, GSHOP_AUTO: "1" };
    const hour = new Date(now).toISOString().slice(0, 13);
    db.prepare("INSERT INTO gshop_usage (period, calls) VALUES (?, 30)").run(`checks-h:${hour}`);
    expect(await checkProduct(deps(env), { site: "noon-sa", id: "N1", auto: true })).toEqual({ ok: false, error: "rate" });
    expect(serpCalls).toEqual([]);
  });
});

describe("requests", () => {
  it("refuses a product never seen in a search, and one with no price", async () => {
    expect(await checkProduct(deps(), { site: "noon-sa", id: "NOPE" })).toMatchObject({ ok: false, error: "unknown" });
    db.prepare("INSERT INTO seen_products (site, productId, title, url, currency, lastSeen) VALUES ('noon-sa', 'P', 'X', 'https://www.noon.com/saudi-en/P', 'SAR', ?)").run(now);
    expect(await checkProduct(deps(), { site: "noon-sa", id: "P" })).toMatchObject({ ok: false, error: "no-price" });
    expect(serpCalls).toEqual([]);
  });
  it("automatic checks: off by default, at most 5 a day when on", async () => {
    expect(await checkProduct(deps(), { site: "noon-sa", id: "N1", auto: true })).toMatchObject({ ok: false, error: "auto-off" });
    const env = { SERPAPI_KEY: KEY, GSHOP_AUTO: "1" };
    for (let i = 2; i <= 6; i++) seed("noon-sa", `N${i}`);
    for (let i = 2; i <= 6; i++) expect((await checkProduct(deps(env), { site: "noon-sa", id: `N${i}`, auto: true })).ok).toBe(true);
    seed("noon-sa", "N7");
    expect(await checkProduct(deps(env), { site: "noon-sa", id: "N7", auto: true })).toMatchObject({ ok: false, error: "auto-limit" });
  });
});
