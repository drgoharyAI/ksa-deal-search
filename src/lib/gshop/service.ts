import "server-only";
import type { Db } from "@/src/lib/db";
import { HOUR, DAY, ksaDay, recordObservations } from "@/src/lib/insights";
import { sameProduct, titleFeatures } from "@/src/lib/match/group";
import type { Product } from "@/src/lib/types";
import { SerpApiError, cleanQuery, serpAccount, serpImmersive, serpShopping } from "./client";
import { scrapeGoogle, type ScrapePage } from "./scrape";
import { clientLimiter, type ClientLimiter } from "./rate";
import { keepOffers, noData, validateOffers, type GshopOffer, type GshopResult, type GshopSource, type NoDataReason } from "./validate";

/**
 * Google Shopping KSA checks: source order, budgets, back-off, the 24 h cache and single-flight.
 * Order (owner ruling, final): 1. SerpApi while its monthly budget lasts and a key is set;
 * 2. else the owner's Chrome on google.com.sa, unless backed off or over its load limits; 3. else
 * "no data". SerpApi being down (timeout, 5xx, refused) also falls back to Chrome for that check.
 * Never runs on a search: only on demand (POST /api/gshop/validate) or, when GSHOP_AUTO=1, for at
 * most AUTO_DAILY deal-badged products a day.
 */

/** Default monthly SerpApi budget: the free plan's 250, less a margin. */
const DEFAULT_BUDGET = 240;
const MAX_BUDGET = 250;
/** A check spends up to 2 SerpApi searches (shopping + immersive). */
const CALLS_PER_CHECK = 2;
const AUTO_DAILY = 5;
const CACHE_TTL = DAY;
/** A no-match or no-data answer is kept only briefly: one odd answer must not hide a product for a day. */
const NO_MATCH_TTL = 2 * 60 * 60 * 1000;

/** Chrome fallback limits, to protect the owner's home IP. */
export const SCRAPE_LIMITS = {
  PER_HOUR: 20,
  PER_DAY: 100,
  GAP_MS: 15_000,
  BACKOFF_START_MS: 2 * HOUR,
  BACKOFF_CAP_MS: 12 * HOUR,
  MAX_STRIKES: 8,
} as const;

type Env = Record<string, string | undefined>;
export type GshopConfig = { key: string | null; budget: number; auto: boolean; force: GshopSource | null };

export function gshopConfig(env: Env = process.env): GshopConfig {
  const key = env.SERPAPI_KEY?.trim() || null;
  const b = Number(env.GSHOP_MONTHLY_BUDGET);
  const budget = Number.isInteger(b) && b >= 0 && b <= MAX_BUDGET ? b : DEFAULT_BUDGET;
  const auto = env.GSHOP_AUTO === "1" || env.GSHOP_AUTO === "true";
  const s = env.GSHOP_SOURCE?.trim().toLowerCase();
  const force = s === "google" || s === "serpapi" ? s : null;
  return { key, budget, auto, force };
}

export type GshopDeps = {
  db: Db;
  env?: Env;
  now?: () => number;
  fetch?: typeof globalThis.fetch;
  /** Runs `fn` with Google's Chrome page (browser.ts); injected so tests never start Chrome. */
  withPage?: <T>(fn: (page: ScrapePage) => Promise<T>) => Promise<T>;
  sleep?: (ms: number) => Promise<void>;
  /** Longest a Google job may hold the page (default 60 s); then the page is recycled. */
  deadlineMs?: number;
  /** Kills Google's Chrome page so a stuck job ends (browser.ts); injected in tests. */
  recycle?: () => void;
};

/** A Google check (gap wait, page load, panel) never holds the queue longer than this. */
const GOOGLE_DEADLINE_MS = 60_000;

// ---------------- counters and state (gshop_usage, gshop_state) ----------------

const utcMonthKey = (now: number) => `serpapi:${new Date(now).toISOString().slice(0, 7)}`;

/** The plan's renewal date from account.json ("YYYY-MM-DD"), as ms, or null. */
function renewalAt(db: Db): { date: string; at: number } | null {
  const date = getState(db, "serpapi:renewal");
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const at = Date.parse(`${date}T00:00:00Z`);
  return Number.isFinite(at) ? { date, at } : null;
}

/**
 * The SerpApi counting period: up to the plan's renewal date when account.json gave one that is
 * still ahead (the free plan renews on its sign-up day, not on the 1st), else the UTC month.
 */
function periodKey(db: Db, now: number): string {
  const r = renewalAt(db);
  return r && now < r.at ? `serpapi:to-${r.date}` : utcMonthKey(now);
}

/** Stores the renewal date; the first time, the UTC month's count carries over to the new period. */
function learnRenewal(db: Db, date: string | null, now: number): void {
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date) || Date.parse(`${date}T00:00:00Z`) <= now) return;
  const before = periodKey(db, now);
  setState(db, "serpapi:renewal", date);
  const after = periodKey(db, now);
  if (after !== before) {
    db.prepare("INSERT INTO gshop_usage (period, calls) VALUES (?, ?) ON CONFLICT (period) DO UPDATE SET calls = MAX(calls, excluded.calls)").run(after, used(db, before));
  }
}
const hourKey = (now: number) => `google-h:${new Date(now).toISOString().slice(0, 13)}`;
const dayKey = (now: number) => `google-d:${new Date(now).toISOString().slice(0, 10)}`;
const autoKey = (now: number) => `auto:${ksaDay(now)}`;

function used(db: Db, period: string): number {
  const row = db.prepare("SELECT calls FROM gshop_usage WHERE period = ?").get(period) as { calls: number } | undefined;
  return row?.calls ?? 0;
}

/** Counts one call unless `period` already reached `max`; true when counted. Atomic. */
function take(db: Db, period: string, max: number): boolean {
  if (max <= 0) return false;
  const r = db
    .prepare("INSERT INTO gshop_usage (period, calls) VALUES (?, 1) ON CONFLICT (period) DO UPDATE SET calls = calls + 1 WHERE calls < ?")
    .run(period, max);
  return Number(r.changes) === 1;
}

/** Marks the month's SerpApi budget as used up (SerpApi said so). */
function markExhausted(db: Db, now: number, budget: number): void {
  db.prepare("INSERT INTO gshop_usage (period, calls) VALUES (?, ?) ON CONFLICT (period) DO UPDATE SET calls = MAX(calls, excluded.calls)").run(periodKey(db, now), budget);
}

function getState(db: Db, key: string): string | null {
  const row = db.prepare("SELECT value FROM gshop_state WHERE key = ?").get(key) as { value: string } | undefined;
  return row?.value ?? null;
}
function setState(db: Db, key: string, value: string): void {
  db.prepare("INSERT INTO gshop_state (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value").run(key, value);
}

type Backoff = { blockedUntil: number; strikes: number };

/** The persisted back-off, never trusted blindly: at most 12 h from now, strikes capped. */
function readBackoff(db: Db, now: number): Backoff {
  try {
    const v = JSON.parse(getState(db, "google:backoff") ?? "null") as Partial<Backoff> | null;
    const until = Number(v?.blockedUntil);
    const strikes = Number(v?.strikes);
    if (!Number.isFinite(until) || !Number.isFinite(strikes)) return { blockedUntil: 0, strikes: 0 };
    return { blockedUntil: Math.min(until, now + SCRAPE_LIMITS.BACKOFF_CAP_MS), strikes: Math.min(Math.max(0, Math.floor(strikes)), SCRAPE_LIMITS.MAX_STRIKES) };
  } catch {
    return { blockedUntil: 0, strikes: 0 };
  }
}

function strike(db: Db, now: number): void {
  const strikes = Math.min(readBackoff(db, now).strikes + 1, SCRAPE_LIMITS.MAX_STRIKES);
  const ms = Math.min(SCRAPE_LIMITS.BACKOFF_START_MS * 2 ** (strikes - 1), SCRAPE_LIMITS.BACKOFF_CAP_MS);
  setState(db, "google:backoff", JSON.stringify({ blockedUntil: now + ms, strikes }));
}

const googleRoom = (db: Db, now: number) => used(db, hourKey(now)) < SCRAPE_LIMITS.PER_HOUR && used(db, dayKey(now)) < SCRAPE_LIMITS.PER_DAY;

// ---------------- status ----------------

export type GshopStatus = {
  serpapi: { enabled: boolean; left: number; budget: number; exhausted: boolean };
  google: { backedOffUntil: number | null; available: boolean };
  auto: boolean;
  /** A check can fetch something now (else it answers "no data"). */
  canCheck: boolean;
};

export function gshopStatus(deps: GshopDeps): GshopStatus {
  const { db } = deps;
  const now = (deps.now ?? Date.now)();
  const cfg = gshopConfig(deps.env);
  const left = Math.max(0, cfg.budget - used(db, periodKey(db, now)));
  const serpOk = !!cfg.key && left >= CALLS_PER_CHECK && cfg.force !== "google";
  const b = readBackoff(db, now);
  const backedOffUntil = b.blockedUntil > now ? b.blockedUntil : null;
  const googleOk = backedOffUntil === null && googleRoom(db, now) && cfg.force !== "serpapi";
  return {
    serpapi: { enabled: !!cfg.key, left, budget: cfg.budget, exhausted: left < CALLS_PER_CHECK },
    google: { backedOffUntil, available: googleOk },
    auto: cfg.auto,
    canCheck: serpOk || googleOk,
  };
}

// ---------------- the product, the cache ----------------

type OurProduct = { site: string; id: string; title: string; price: number; origPrice: number | null };

const titleKey = (t: string) => t.trim().toLowerCase().replace(/\s+/g, " ").slice(0, 300);

function lookup(db: Db, site: string, id: string): OurProduct | "unknown" | "no-price" {
  const seen = db.prepare("SELECT title FROM seen_products WHERE site = ? AND productId = ?").get(site, id) as { title: string } | undefined;
  if (!seen) return "unknown";
  const obs = db.prepare("SELECT price, origPrice FROM observations WHERE site = ? AND productId = ? ORDER BY at DESC LIMIT 1").get(site, id) as
    | { price: number; origPrice: number | null }
    | undefined;
  if (!obs) return "no-price";
  return { site, id, title: seen.title, price: obs.price, origPrice: obs.origPrice };
}

type Captured = { source: GshopSource; at: number; offers: GshopOffer[]; reason?: NoDataReason };

function cacheGet(db: Db, p: OurProduct, now: number): Captured | null {
  const row = db.prepare("SELECT at, source, payload FROM gshop_cache WHERE site = ? AND productId = ? AND titleKey = ?").get(p.site, p.id, titleKey(p.title)) as
    | { at: number; source: string; payload: string }
    | undefined;
  if (!row || now - row.at >= CACHE_TTL || now < row.at) return null;
  try {
    const v = JSON.parse(row.payload) as { offers?: GshopOffer[]; reason?: NoDataReason };
    if (v.reason && now - row.at >= NO_MATCH_TTL) return null;
    return { source: row.source === "google" ? "google" : "serpapi", at: row.at, offers: Array.isArray(v.offers) ? v.offers : [], ...(v.reason && { reason: v.reason }) };
  } catch {
    return null;
  }
}

function cachePut(db: Db, p: OurProduct, c: Captured): void {
  db.prepare(
    `INSERT INTO gshop_cache (site, productId, titleKey, at, source, payload) VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT (site, productId, titleKey) DO UPDATE SET at = excluded.at, source = excluded.source, payload = excluded.payload`,
  ).run(p.site, p.id, titleKey(p.title), c.at, c.source, JSON.stringify({ offers: c.offers, ...(c.reason && { reason: c.reason }) }));
  db.prepare("DELETE FROM gshop_cache WHERE at < ?").run(c.at - 7 * DAY);
}

function resultOf(p: OurProduct, c: Captured): GshopResult {
  if (c.reason) return noData(c.reason, c.at, c.source);
  return validateOffers(p, c.offers, { checkedAt: c.at, source: c.source });
}

/**
 * The other Saudi stores' offers become price observations under site "gshop:<store domain>",
 * productId "<our site>:<our id>": a cross-store history for our product. insightsFor reads only
 * our own sites' rows, so these never change a deal badge.
 */
function recordOffers(db: Db, p: OurProduct, c: Captured): void {
  const kept = keepOffers(p, c.offers);
  const rows = kept.map(
    (o) =>
      ({
        site: `gshop:${(o.domain ?? o.store.toLowerCase().replace(/\s+/g, "-")).slice(0, 80)}`,
        id: `${p.site}:${p.id}`,
        title: p.title,
        listPrice: o.price,
        finalPrice: o.price,
        origPrice: o.was,
        discountPct: null,
        currency: "SAR",
        rating: null,
        soldCount: 0,
        image: "",
        url: "",
        detailStatus: "ok",
      }) satisfies Product,
  );
  if (rows.length) recordObservations(db, rows, c.at);
}

// ---------------- the sources ----------------

type Fetched = Captured | { none: NoDataReason };

async function viaSerpApi(deps: GshopDeps, cfg: GshopConfig, p: OurProduct, now: number): Promise<Fetched | "fallback"> {
  const { db } = deps;
  const key = cfg.key as string;
  const opts = { key, fetch: deps.fetch };
  if (cfg.budget - used(db, periodKey(db, now)) < CALLS_PER_CHECK) return "fallback";
  try {
    const acct = await serpAccount(opts);
    learnRenewal(db, acct.renewal, now);
    if (acct.searchesLeft !== null && acct.searchesLeft < CALLS_PER_CHECK) {
      markExhausted(db, now, cfg.budget);
      return "fallback";
    }
  } catch {
    // The free account call failing says nothing about the searches: go on.
  }
  try {
    if (!take(db, periodKey(db, now), cfg.budget)) return "fallback";
    const items = await serpShopping(cleanQuery(p.title), opts);
    const ours = titleFeatures(p.title);
    const best = items.find((i) => sameProduct(ours, titleFeatures(i.title)));
    if (!best) return { source: "serpapi", at: now, offers: [], reason: "no-match" };
    if (!take(db, periodKey(db, now), cfg.budget)) return "fallback";
    const r = await serpImmersive(best.token, opts);
    return { source: "serpapi", at: now, offers: r.offers };
  } catch (e) {
    if (e instanceof SerpApiError && e.kind === "exhausted") markExhausted(db, now, cfg.budget);
    // The message is already scrubbed of the key (client.ts).
    console.warn("[gshop] SerpApi failed, falling back to Google", e instanceof Error ? e.message : "error");
    return "fallback";
  }
}

async function viaGoogle(deps: GshopDeps, p: OurProduct): Promise<Fetched> {
  const { db } = deps;
  const clock = deps.now ?? Date.now;
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const withPage = deps.withPage ?? (await import("./browser")).withGshopPage;
  const start = clock();
  if (readBackoff(db, start).blockedUntil > start) return { none: "blocked" };
  const count = (t: number) => {
    take(db, hourKey(t), SCRAPE_LIMITS.PER_HOUR);
    take(db, dayKey(t), SCRAPE_LIMITS.PER_DAY);
  };
  const gates = {
    async beforeLoad() {
      if (!googleRoom(db, clock())) return false;
      const last = Number(getState(db, "google:lastLoad") ?? 0);
      const wait = last + SCRAPE_LIMITS.GAP_MS - clock();
      if (wait > 0) await sleep(Math.min(wait, SCRAPE_LIMITS.GAP_MS));
      const t = clock();
      if (!googleRoom(db, t)) return false;
      count(t);
      setState(db, "google:lastLoad", String(t));
      return true;
    },
    // The panel is a click on the loaded page, not a page load: counted, not spaced.
    beforePanel() {
      const t = clock();
      if (!googleRoom(db, t)) return Promise.resolve(false);
      count(t);
      setState(db, "google:lastLoad", String(t));
      return Promise.resolve(true);
    },
  };
  let out;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const deadline = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        // Recycle the page: the stuck job's next page call throws, so the queue moves on.
        void (async () => (deps.recycle ?? (await import("./browser")).recycleGshopBrowser)())().catch(() => undefined);
        reject(new Error("Google check passed its deadline"));
      }, deps.deadlineMs ?? GOOGLE_DEADLINE_MS);
    });
    out = await Promise.race([withPage((page) => scrapeGoogle(p.title, page, gates)), deadline]);
  } catch (e) {
    console.warn("[gshop] Google check failed", e instanceof Error ? e.message.slice(0, 200) : "error");
    return { none: "error" };
  } finally {
    clearTimeout(timer);
  }
  const now = clock();
  if (out.kind === "skipped") return { none: "budget" };
  if (out.kind === "blocked") {
    strike(db, now);
    console.warn(`[gshop] Google ${out.reason}: backing off`);
    return { none: "blocked" };
  }
  if (out.kind === "error") {
    console.warn("[gshop] Google check failed", out.message);
    return { none: "error" };
  }
  setState(db, "google:backoff", JSON.stringify({ blockedUntil: 0, strikes: 0 }));
  return { source: "google", at: now, offers: out.offers };
}

async function fetchOffers(deps: GshopDeps, p: OurProduct): Promise<Fetched> {
  const cfg = gshopConfig(deps.env);
  const now = (deps.now ?? Date.now)();
  if (cfg.key && cfg.force !== "google") {
    const r = await viaSerpApi(deps, cfg, p, now);
    if (r !== "fallback") return r;
  }
  if (cfg.force === "serpapi") return { none: "budget" };
  if (!googleRoom(deps.db, now)) return { none: "budget" };
  return viaGoogle(deps, p);
}

// ---------------- the check ----------------

export type CheckError = "unknown" | "no-price" | "auto-off" | "auto-limit" | "rate";
export type CheckAnswer = { ok: true; result: GshopResult } | { ok: false; error: CheckError };

/**
 * Safety caps on checks that would call SerpApi or Google (owner ruling: small safety caps), so
 * nobody can drain the SerpApi month or push the app onto Google from the owner's IP. Overall caps
 * are persisted in SQLite (UTC hour and day); the per-client cap is in memory (rate.ts). Manual and
 * automatic checks count alike; cache hits and joined in-flight checks are free.
 */
export const CHECK_CAPS = { PER_HOUR: 30, PER_DAY: 100, PER_CLIENT_HOUR: 10 } as const;
const checksHourKey = (now: number) => `checks-h:${new Date(now).toISOString().slice(0, 13)}`;
const checksDayKey = (now: number) => `checks-d:${new Date(now).toISOString().slice(0, 10)}`;

const g = globalThis as typeof globalThis & { __gshopFlights?: Map<string, Promise<CheckAnswer>>; __gshopClients?: ClientLimiter };
const flights = () => (g.__gshopFlights ??= new Map<string, Promise<CheckAnswer>>());
const clients = () => (g.__gshopClients ??= clientLimiter(CHECK_CAPS.PER_CLIENT_HOUR));

/** For tests: forget in-flight checks and the per-client counts. */
export function resetGshopFlights(): void {
  flights().clear();
  clients().clear();
}

/** The cached result for a product, or null (never fetches). */
export function cachedCheck(deps: GshopDeps, site: string, id: string): GshopResult | null {
  const p = lookup(deps.db, site, id);
  if (typeof p === "string") return null;
  const c = cacheGet(deps.db, p, (deps.now ?? Date.now)());
  return c ? resultOf(p, c) : null;
}

/**
 * Checks one product seen in a search (title from seen_products, price from its latest
 * observation: the request body is never trusted for either). Cached 24 h; one fetch per product
 * at a time.
 */
export async function checkProduct(deps: GshopDeps, req: { site: string; id: string; auto?: boolean; client?: string }): Promise<CheckAnswer> {
  const { db } = deps;
  const now = (deps.now ?? Date.now)();
  const p = lookup(db, req.site, req.id);
  if (p === "unknown" || p === "no-price") return { ok: false, error: p };
  const cached = cacheGet(db, p, now);
  if (cached) return { ok: true, result: resultOf(p, cached) };
  const k = `${p.site}\u0000${p.id}`;
  const running = flights().get(k);
  if (running) return running;
  if (req.auto && !gshopConfig(deps.env).auto) return { ok: false, error: "auto-off" };
  // Nothing can be fetched (SerpApi out, Google backed off or at its limits): answer for free.
  const st = gshopStatus(deps);
  if (!st.canCheck) return { ok: true, result: noData(st.google.backedOffUntil ? "blocked" : "budget", now) };
  const client = req.client ?? "local";
  const room = used(db, checksHourKey(now)) < CHECK_CAPS.PER_HOUR && used(db, checksDayKey(now)) < CHECK_CAPS.PER_DAY && clients().allowed(client, now);
  if (!room) return { ok: false, error: "rate" };
  if (req.auto && !take(db, autoKey(now), AUTO_DAILY)) return { ok: false, error: "auto-limit" };
  take(db, checksHourKey(now), CHECK_CAPS.PER_HOUR);
  take(db, checksDayKey(now), CHECK_CAPS.PER_DAY);
  clients().record(client, now);
  const run = (async (): Promise<CheckAnswer> => {
    const f = await fetchOffers(deps, p);
    if ("none" in f) return { ok: true, result: noData(f.none, (deps.now ?? Date.now)()) };
    cachePut(db, p, f);
    if (!f.reason) recordOffers(db, p, f);
    return { ok: true, result: resultOf(p, f) };
  })().finally(() => flights().delete(k));
  flights().set(k, run);
  return run;
}
