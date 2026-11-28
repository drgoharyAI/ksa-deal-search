import "server-only";
import type { Db } from "@/src/lib/db";
import { clientLimiter, type ClientLimiter } from "@/src/lib/gshop/rate";
import { fetchKanbkam, type KanbkamFetch } from "./client";
import { kanbkamProductUrl, validKanbkamId } from "./links";
import { kanbkamVerdicts, type KanbkamResult } from "./rules";

/**
 * Kanbkam price-history lookups (spec decision "Kanbkam price history (owner request; owner
 * informed of ToS)"), kept minimal and polite:
 * - off unless KANBKAM_ENABLED=1 (the kill switch);
 * - only Amazon.sa and noon listings seen in a search, by their direct product page;
 * - one global queue, at least 10 s between loads (the last load is persisted, so a restart keeps
 *   the gap);
 * - at most 30 lookups an hour and 200 a day overall (persisted), 10 an hour per client (in
 *   memory, the gshop per-client limiter); over a cap: "rate", with no fetch;
 * - a 403, 429 or Cloudflare challenge backs off 24 h (persisted);
 * - each listing cached 24 h, a miss 7 days; one fetch per listing at a time (single-flight).
 * Kanbkam's numbers go to kanbkam_history only, never to our observations or deal badges.
 */

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

export const KANBKAM_LIMITS = {
  GAP_MS: 10_000,
  PER_HOUR: 30,
  PER_DAY: 200,
  PER_CLIENT_HOUR: 10,
  BACKOFF_MS: DAY,
  TTL_OK_MS: DAY,
  TTL_MISSING_MS: 7 * DAY,
  /** Lookups waiting or running at once; more answer "busy" (a full queue is a minute of waiting). */
  MAX_QUEUE: 6,
} as const;

type Env = Record<string, string | undefined>;

export type KanbkamDeps = {
  db: Db;
  env?: Env;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  fetch?: typeof globalThis.fetch;
};

/** A cap from the environment may only lower the default, never raise it. */
function cap(v: string | undefined, max: number): number {
  const n = Number(v);
  return v !== undefined && v.trim() !== "" && Number.isInteger(n) && n >= 0 && n <= max ? n : max;
}

function config(env: Env = process.env) {
  return {
    enabled: env.KANBKAM_ENABLED === "1" || env.KANBKAM_ENABLED === "true",
    perHour: cap(env.KANBKAM_HOURLY_CAP, KANBKAM_LIMITS.PER_HOUR),
    perDay: cap(env.KANBKAM_DAILY_CAP, KANBKAM_LIMITS.PER_DAY),
  };
}

// ---------------- counters and state ----------------

const hourKey = (now: number) => `hour:${new Date(now).toISOString().slice(0, 13)}`;
const dayKey = (now: number) => `day:${new Date(now).toISOString().slice(0, 10)}`;

function used(db: Db, period: string): number {
  const row = db.prepare("SELECT calls FROM kanbkam_usage WHERE period = ?").get(period) as { calls: number } | undefined;
  return row?.calls ?? 0;
}
function count(db: Db, period: string): void {
  db.prepare("INSERT INTO kanbkam_usage (period, calls) VALUES (?, 1) ON CONFLICT (period) DO UPDATE SET calls = calls + 1").run(period);
}
function getState(db: Db, key: string): number {
  const row = db.prepare("SELECT value FROM kanbkam_state WHERE key = ?").get(key) as { value: string } | undefined;
  const n = Number(row?.value ?? 0);
  return Number.isFinite(n) ? n : 0;
}
function setState(db: Db, key: string, value: number): void {
  db.prepare("INSERT INTO kanbkam_state (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value").run(key, String(value));
}

/** The persisted back-off end, never trusted past 24 h from now. */
function backedOffUntil(db: Db, now: number): number | null {
  const until = Math.min(getState(db, "backoffUntil"), now + KANBKAM_LIMITS.BACKOFF_MS);
  return until > now ? until : null;
}

// ---------------- status ----------------

export type KanbkamStatus = { enabled: boolean; backedOffUntil: number | null; perHour: number; perDay: number };

export function kanbkamStatus(deps: KanbkamDeps): KanbkamStatus {
  const cfg = config(deps.env);
  const now = (deps.now ?? Date.now)();
  return { enabled: cfg.enabled, backedOffUntil: backedOffUntil(deps.db, now), perHour: cfg.perHour, perDay: cfg.perDay };
}

// ---------------- our listing, the cache ----------------

type Ours = { price: number; was: number | null };

function ours(db: Db, site: string, id: string): Ours | null {
  const seen = db.prepare("SELECT 1 AS x FROM seen_products WHERE site = ? AND productId = ?").get(site, id);
  if (!seen) return null;
  const obs = db.prepare("SELECT price, origPrice FROM observations WHERE site = ? AND productId = ? ORDER BY at DESC LIMIT 1").get(site, id) as
    | { price: number; origPrice: number | null }
    | undefined;
  return obs ? { price: obs.price, was: obs.origPrice } : null;
}

type Row = { status: string; minPrice: number | null; maxPrice: number | null; currentPrice: number | null; dropPct: number | null; since: string | null; at: number };

function resultOf(site: string, id: string, row: Row, o: Ours): KanbkamResult {
  const url = kanbkamProductUrl(site, id) ?? "";
  if (row.status !== "ok" || row.minPrice === null || row.maxPrice === null) return { status: "missing", url, checkedAt: row.at };
  const h = { min: row.minPrice, max: row.maxPrice };
  return { status: "ok", ...h, current: row.currentPrice, dropPct: row.dropPct, since: row.since, url, checkedAt: row.at, verdicts: kanbkamVerdicts(o, h) };
}

function cacheGet(db: Db, site: string, id: string, now: number): Row | null {
  const row = db.prepare("SELECT status, minPrice, maxPrice, currentPrice, dropPct, since, at FROM kanbkam_history WHERE site = ? AND productId = ?").get(site, id) as Row | undefined;
  if (!row || now < row.at) return null;
  const ttl = row.status === "ok" ? KANBKAM_LIMITS.TTL_OK_MS : KANBKAM_LIMITS.TTL_MISSING_MS;
  return now - row.at < ttl ? row : null;
}

function cachePut(db: Db, site: string, id: string, f: Extract<KanbkamFetch, { kind: "ok" | "missing" }>, at: number): Row {
  const p = f.kind === "ok" ? f.page : null;
  const row: Row = { status: f.kind, minPrice: p?.min ?? null, maxPrice: p?.max ?? null, currentPrice: p?.current ?? null, dropPct: p?.dropPct ?? null, since: p?.since ?? null, at };
  db.prepare(
    `INSERT INTO kanbkam_history (site, productId, source, status, minPrice, maxPrice, currentPrice, dropPct, since, at)
     VALUES (?, ?, 'kanbkam', ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (site, productId) DO UPDATE SET status = excluded.status, minPrice = excluded.minPrice, maxPrice = excluded.maxPrice,
       currentPrice = excluded.currentPrice, dropPct = excluded.dropPct, since = excluded.since, at = excluded.at`,
  ).run(site, id, row.status, row.minPrice, row.maxPrice, row.currentPrice, row.dropPct, row.since, at);
  db.prepare("DELETE FROM kanbkam_history WHERE at < ?").run(at - 30 * DAY);
  db.prepare("DELETE FROM kanbkam_usage WHERE period < ? AND period LIKE 'day:%'").run(dayKey(at - 7 * DAY));
  db.prepare("DELETE FROM kanbkam_usage WHERE period < ? AND period LIKE 'hour:%'").run(hourKey(at - DAY));
  return row;
}

// ---------------- the lookup ----------------

export type LookupError = "off" | "unsupported" | "unknown" | "rate" | "busy" | "paused" | "failed";
export type LookupAnswer = { ok: true; result: KanbkamResult } | { ok: false; error: LookupError };

type Shared = { flights: Map<string, Promise<LookupAnswer>>; clients: ClientLimiter; tail: Promise<unknown>; pending: number };
const g = globalThis as typeof globalThis & { __kanbkam?: Shared };
const shared = (): Shared => (g.__kanbkam ??= { flights: new Map(), clients: clientLimiter(KANBKAM_LIMITS.PER_CLIENT_HOUR), tail: Promise.resolve(), pending: 0 });

/** For tests: forget in-flight lookups, the queue and the per-client counts (the persisted state stays). */
export function resetKanbkam(): void {
  g.__kanbkam = undefined;
}

/** Runs `job` after every job queued before it: one load at a time, globally. */
function enqueue<T>(job: () => Promise<T>): Promise<T> {
  const s = shared();
  s.pending += 1;
  const run = s.tail.then(job, job).finally(() => {
    s.pending -= 1;
  });
  s.tail = run.catch(() => undefined);
  return run;
}

/** The cached history for a listing, or null (never fetches). */
export function cachedHistory(deps: KanbkamDeps, site: string, id: string): KanbkamResult | null {
  if (!validKanbkamId(site, id)) return null;
  const o = ours(deps.db, site, id);
  if (!o) return null;
  const row = cacheGet(deps.db, site, id, (deps.now ?? Date.now)());
  return row ? resultOf(site, id, row, o) : null;
}

/**
 * Looks up one listing seen in a search. Every check that can refuse runs before anything is
 * queued, so a refused caller costs Kanbkam nothing; a cached or in-flight listing is free.
 */
export function lookupHistory(deps: KanbkamDeps, req: { site: string; id: string; client?: string }): Promise<LookupAnswer> {
  const { db } = deps;
  const clock = deps.now ?? Date.now;
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const no = (error: LookupError) => Promise.resolve<LookupAnswer>({ ok: false, error });
  const cfg = config(deps.env);
  if (!cfg.enabled) return no("off");
  const { site, id } = req;
  if (!validKanbkamId(site, id)) return no("unsupported");
  const o = ours(db, site, id);
  if (!o) return no("unknown");
  const now = clock();
  const cached = cacheGet(db, site, id, now);
  if (cached) return Promise.resolve({ ok: true, result: resultOf(site, id, cached, o) });
  const s = shared();
  const k = `${site}\u0000${id}`;
  const running = s.flights.get(k);
  if (running) return running;
  if (backedOffUntil(db, now) !== null) return no("paused");
  const client = req.client ?? "local";
  if (used(db, hourKey(now)) >= cfg.perHour || used(db, dayKey(now)) >= cfg.perDay || !s.clients.allowed(client, now)) return no("rate");
  if (s.pending >= KANBKAM_LIMITS.MAX_QUEUE) return no("busy");
  count(db, hourKey(now));
  count(db, dayKey(now));
  s.clients.record(client, now);
  const run = enqueue(async (): Promise<LookupAnswer> => {
    // Another job may have been blocked while this one waited.
    if (backedOffUntil(db, clock()) !== null) return { ok: false, error: "paused" };
    const wait = getState(db, "lastLoad") + KANBKAM_LIMITS.GAP_MS - clock();
    if (wait > 0) await sleep(Math.min(wait, KANBKAM_LIMITS.GAP_MS));
    setState(db, "lastLoad", clock());
    const f = await fetchKanbkam(site, id, { fetch: deps.fetch });
    const at = clock();
    if (f.kind === "blocked") {
      setState(db, "backoffUntil", at + KANBKAM_LIMITS.BACKOFF_MS);
      console.warn(`[kanbkam] ${f.why}: backing off 24 h`);
      return { ok: false, error: "paused" };
    }
    if (f.kind === "error") {
      console.warn("[kanbkam] lookup failed", f.message);
      return { ok: false, error: "failed" };
    }
    return { ok: true, result: resultOf(site, id, cachePut(db, site, id, f, at), ours(db, site, id) ?? o) };
  }).finally(() => s.flights.delete(k));
  s.flights.set(k, run);
  return run;
}
