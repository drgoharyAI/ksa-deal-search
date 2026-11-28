import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SCHEMA_VERSION, migrate, openDb, type Db } from "@/src/lib/db";
import { KANBKAM_LIMITS, cachedHistory, kanbkamStatus, lookupHistory, resetKanbkam, type KanbkamDeps } from "@/src/lib/kanbkam/service";

const PAGE = fs.readFileSync(path.join(__dirname, "..", "fixtures", "kanbkam", "amazon-B09HGPKY7Q.html"), "utf8");
const CHALLENGE = fs.readFileSync(path.join(__dirname, "..", "fixtures", "kanbkam", "challenge.html"), "utf8");
const T0 = Date.UTC(2026, 10, 28, 6, 0, 0);
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const ON = { KANBKAM_ENABLED: "1" };

let db: Db;
let t: number;
let fetches: { url: string; at: number }[];
let answer: () => Response;

const asin = (i: number) => `B0TEST${String(i).padStart(4, "0")}`;
function seen(site: string, id: string, price: number, was: number | null = null) {
  db.prepare("INSERT OR REPLACE INTO seen_products (site, productId, title, url, currency, lastSeen) VALUES (?, ?, 'JBL Flip 6', 'https://www.amazon.sa/dp/x', 'SAR', ?)").run(site, id, t);
  db.prepare("INSERT INTO observations (site, productId, price, origPrice, at) VALUES (?, ?, ?, ?, ?)").run(site, id, price, was, t);
}
const deps = (env: Record<string, string> = ON): KanbkamDeps => ({
  db,
  env,
  now: () => t,
  sleep: async (ms: number) => {
    t += ms;
  },
  fetch: (async (url: string) => {
    fetches.push({ url, at: t });
    return answer();
  }) as unknown as typeof fetch,
});
const look = (id: string, client = "local", d = deps()) => lookupHistory(d, { site: "amazon-sa", id, client });

beforeEach(() => {
  db = openDb(":memory:");
  t = T0;
  fetches = [];
  answer = () => new Response(PAGE, { status: 200 });
  resetKanbkam();
  seen("amazon-sa", "B09HGPKY7Q", 269, 399);
});
afterEach(() => db.close());

describe("migration 9 (kanbkam tables)", () => {
  it("is idempotent: running it again on a database that has the tables changes nothing", () => {
    db.prepare("INSERT INTO kanbkam_usage (period, calls) VALUES ('day:x', 3)").run();
    db.prepare("UPDATE schema_version SET version = 8").run();
    migrate(db);
    expect(db.prepare("SELECT version FROM schema_version").get()).toEqual({ version: SCHEMA_VERSION });
    expect(SCHEMA_VERSION).toBe(9);
    expect(db.prepare("SELECT calls FROM kanbkam_usage WHERE period = 'day:x'").get()).toEqual({ calls: 3 });
  });
  it("keeps Kanbkam rows marked as such", () => {
    expect(() => db.prepare("INSERT INTO kanbkam_history (site, productId, source, status, at) VALUES ('amazon-sa', 'B1', 'ours', 'ok', 1)").run()).toThrow();
  });
});

describe("lookupHistory", () => {
  it("is off unless KANBKAM_ENABLED=1 (kill switch), with no fetch", async () => {
    expect(await look("B09HGPKY7Q", "local", deps({}))).toEqual({ ok: false, error: "off" });
    expect(await look("B09HGPKY7Q", "local", deps({ KANBKAM_ENABLED: "0" }))).toEqual({ ok: false, error: "off" });
    expect(kanbkamStatus(deps({})).enabled).toBe(false);
    expect(fetches).toHaveLength(0);
  });
  it("refuses other stores and malformed ids before anything else", async () => {
    expect(await lookupHistory(deps(), { site: "jarir", id: "B09HGPKY7Q" })).toEqual({ ok: false, error: "unsupported" });
    expect(await look("../../x")).toEqual({ ok: false, error: "unsupported" });
    expect(fetches).toHaveLength(0);
  });
  it("only looks up a listing seen in a search", async () => {
    expect(await look("B0NOTSEEN1")).toEqual({ ok: false, error: "unknown" });
    expect(fetches).toHaveLength(0);
  });
  it("fetches the listing's page, answers its history and our verdicts, in its own table", async () => {
    const obsBefore = db.prepare("SELECT count(*) AS n FROM observations").get() as { n: number };
    const r = await look("B09HGPKY7Q");
    expect(r).toEqual({
      ok: true,
      result: {
        status: "ok",
        min: 269,
        max: 659,
        current: 269,
        dropPct: -32.6,
        since: null,
        url: "https://www.kanbkam.com/sa/en/p-B09HGPKY7Q",
        checkedAt: T0,
        verdicts: [{ kind: "lowest", label: "Lowest in Kanbkam history" }],
        short: false,
      },
    });
    expect(fetches.map((f) => f.url)).toEqual(["https://www.kanbkam.com/sa/en/p-B09HGPKY7Q"]);
    const row = db.prepare("SELECT source, status, minPrice, maxPrice FROM kanbkam_history WHERE site = 'amazon-sa' AND productId = 'B09HGPKY7Q'").get();
    expect(row).toEqual({ source: "kanbkam", status: "ok", minPrice: 269, maxPrice: 659 });
    // Never mixed into our own observations.
    expect(db.prepare("SELECT count(*) AS n FROM observations").get()).toEqual(obsBefore);
  });
  it("judges our latest price, not the body of the request", async () => {
    seen("amazon-sa", "B09HGPKY7Q", 400, 700);
    const r = await look("B09HGPKY7Q");
    expect(r.ok && r.result.status === "ok" && r.result.verdicts.map((v) => v.kind)).toEqual(["fake-was"]);
  });
  it("caches a listing for 24 h", async () => {
    await look("B09HGPKY7Q");
    t += DAY - 1;
    expect((await look("B09HGPKY7Q")).ok).toBe(true);
    expect(cachedHistory(deps(), "amazon-sa", "B09HGPKY7Q")).toMatchObject({ status: "ok", min: 269 });
    expect(fetches).toHaveLength(1);
    t += 1;
    expect(cachedHistory(deps(), "amazon-sa", "B09HGPKY7Q")).toBeNull();
    await look("B09HGPKY7Q");
    expect(fetches).toHaveLength(2);
  });
  it("caches a miss for 7 days", async () => {
    answer = () => new Response("", { status: 404 });
    expect(await look("B09HGPKY7Q")).toEqual({ ok: true, result: { status: "missing", url: "https://www.kanbkam.com/sa/en/p-B09HGPKY7Q", checkedAt: T0 } });
    t += 7 * DAY - 1;
    expect((await look("B09HGPKY7Q")).ok).toBe(true);
    expect(fetches).toHaveLength(1);
    t += 1;
    await look("B09HGPKY7Q");
    expect(fetches).toHaveLength(2);
  });
  it("single-flight: two asks for one listing make one fetch", async () => {
    const [a, b] = await Promise.all([look("B09HGPKY7Q"), look("B09HGPKY7Q", "cf:1.2.3.4")]);
    expect(a).toEqual(b);
    expect(fetches).toHaveLength(1);
  });
  it("spaces every load at least 10 s apart, globally, through one queue", async () => {
    for (let i = 1; i <= 3; i++) seen("amazon-sa", asin(i), 300);
    await Promise.all([1, 2, 3].map((i) => look(asin(i), `cf:10.0.0.${i}`)));
    const at = fetches.map((f) => f.at);
    expect(at).toHaveLength(3);
    for (let i = 1; i < at.length; i++) expect(at[i] - at[i - 1]).toBeGreaterThanOrEqual(KANBKAM_LIMITS.GAP_MS);
  });
  it("keeps the spacing across a restart (the last load is persisted)", async () => {
    seen("amazon-sa", asin(1), 300);
    await look("B09HGPKY7Q");
    resetKanbkam();
    t += 2_000;
    await look(asin(1));
    expect(fetches[1].at - fetches[0].at).toBe(KANBKAM_LIMITS.GAP_MS);
  });
  it("a client over 10 lookups an hour gets 'rate' with no fetch", async () => {
    for (let i = 1; i <= 11; i++) seen("amazon-sa", asin(i), 300);
    for (let i = 1; i <= 10; i++) expect((await look(asin(i), "cf:9.9.9.9")).ok).toBe(true);
    expect(await look(asin(11), "cf:9.9.9.9")).toEqual({ ok: false, error: "rate" });
    expect(fetches).toHaveLength(10);
    // Another client still has room; cached listings stay free for everyone.
    expect((await look(asin(11), "cf:8.8.8.8")).ok).toBe(true);
    expect((await look(asin(1), "cf:9.9.9.9")).ok).toBe(true);
    expect(fetches).toHaveLength(11);
  });
  it("at most 30 lookups an hour overall", async () => {
    for (let i = 1; i <= 31; i++) seen("amazon-sa", asin(i), 300);
    for (let i = 1; i <= 30; i++) expect((await look(asin(i), `cf:10.0.${i}.1`)).ok).toBe(true);
    expect(await look(asin(31), "cf:10.1.1.1")).toEqual({ ok: false, error: "rate" });
    expect(fetches).toHaveLength(30);
  });
  it("at most 200 lookups a day overall (persisted)", async () => {
    db.prepare("INSERT INTO kanbkam_usage (period, calls) VALUES (?, 200)").run(`day:${new Date(t).toISOString().slice(0, 10)}`);
    expect(await look("B09HGPKY7Q")).toEqual({ ok: false, error: "rate" });
    expect(fetches).toHaveLength(0);
  });
  it("a lower cap from the environment applies; a higher one does not", async () => {
    for (let i = 1; i <= 3; i++) seen("amazon-sa", asin(i), 300);
    const env = { ...ON, KANBKAM_HOURLY_CAP: "2", KANBKAM_DAILY_CAP: "9999" };
    expect((await look(asin(1), "a", deps(env))).ok).toBe(true);
    expect((await look(asin(2), "b", deps(env))).ok).toBe(true);
    expect(await look(asin(3), "c", deps(env))).toEqual({ ok: false, error: "rate" });
    expect(kanbkamStatus(deps(env))).toMatchObject({ perHour: 2, perDay: 200 });
  });
  for (const [what, res] of [
    ["403", () => new Response("", { status: 403 })],
    ["429", () => new Response("", { status: 429 })],
    ["a challenge", () => new Response(CHALLENGE, { status: 503 })],
  ] as const) {
    it(`on ${what}, backs off 24 h (persisted) and fetches nothing meanwhile`, async () => {
      answer = res;
      seen("amazon-sa", asin(1), 300);
      expect(await look("B09HGPKY7Q")).toEqual({ ok: false, error: "paused" });
      expect(kanbkamStatus(deps()).backedOffUntil).toBe(T0 + DAY);
      resetKanbkam();
      t += DAY - 1;
      expect(await look(asin(1))).toEqual({ ok: false, error: "paused" });
      expect(fetches).toHaveLength(1);
      answer = () => new Response(PAGE, { status: 200 });
      t += 1;
      expect((await look(asin(1))).ok).toBe(true);
      expect(fetches).toHaveLength(2);
    });
  }
  it("a server error or timeout fails this lookup only: not cached, no back-off", async () => {
    answer = () => new Response("oops", { status: 500 });
    expect(await look("B09HGPKY7Q")).toEqual({ ok: false, error: "failed" });
    expect(kanbkamStatus(deps()).backedOffUntil).toBeNull();
    answer = () => new Response(PAGE, { status: 200 });
    expect((await look("B09HGPKY7Q")).ok).toBe(true);
    expect(fetches).toHaveLength(2);
  });
  it("a full queue answers 'busy' with no fetch", async () => {
    const n = KANBKAM_LIMITS.MAX_QUEUE + 1;
    for (let i = 1; i <= n; i++) seen("amazon-sa", asin(i), 300);
    const all = await Promise.all(Array.from({ length: n }, (_, i) => look(asin(i + 1), `cf:10.2.${i}.1`)));
    expect(all.filter((r) => !r.ok)).toEqual([{ ok: false, error: "busy" }]);
    expect(fetches).toHaveLength(KANBKAM_LIMITS.MAX_QUEUE);
  });
  it("live noon N70208041V (min = max = 1898.99, our was-price 2299): short history, no fake verdict", async () => {
    seen("noon-sa", "N70208041V", 1999, 2299);
    answer = () => new Response(fs.readFileSync(path.join(__dirname, "..", "fixtures", "kanbkam", "noon-N70208041V.html"), "utf8"), { status: 200 });
    const r = await lookupHistory(deps(), { site: "noon-sa", id: "N70208041V" });
    expect(r).toMatchObject({ ok: true, result: { status: "ok", min: 1898.99, max: 1898.99, short: true, verdicts: [] } });
  });
  it("looks up a noon listing by its SKU", async () => {
    seen("noon-sa", "N70208041V", 1999, 2299);
    answer = () => new Response(PAGE.replace("product-buy|amazon|", "product-buy|noon|"), { status: 200 });
    const r = await lookupHistory(deps(), { site: "noon-sa", id: "N70208041V" });
    expect(r).toMatchObject({ ok: true, result: { status: "ok", url: "https://www.kanbkam.com/sa/en/p-N70208041V" } });
  });
});
