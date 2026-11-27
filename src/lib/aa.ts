import "server-only";
import { call } from "api-anything";
import pLimit from "p-limit";
import { TtlCache } from "./cache";

export type AaResult =
  | { ok: true; tier: number; data: unknown }
  | { ok: false; class: string; reason: string };

// Server-only, local-only, always.
process.env.API_ANYTHING_LOCAL_ONLY ??= "1";
process.env.API_ANYTHING_HOME ??= "./.aa-home";

/**
 * Runtime calls never heal, re-learn or escalate. All four api-anything stores were learned at
 * tier 1 (plain HTTP), so:
 * - maxTier 1: no browser at all, so no recapture and no cookie refresh;
 * - callOnly: installed ops only; no rescan/recapture/heal, no registry or background traffic,
 *   no stale marks written, and a drift is returned as-is (no second "same request once more").
 *   api-anything's own cool-down after blocked/rate still applies.
 */
const CALL_OPTIONS = { view: { maxChars: 200000 }, maxTier: 1, callOnly: true } as const;

const MAX_RETRIES = 2;

/**
 * After a store answers blocked or rate, send it nothing for this long. A drift (at runtime usually
 * an anti-bot page) backs off too, unless the store answered ok within DRIFT_OK_GRACE_MS: then the
 * drift is one odd page (e.g. a niche synonym query), not a block.
 */
export const BACKOFF_MS = 10 * 60_000;
const DRIFT_OK_GRACE_MS = 60_000;
const BACKOFF_CLASSES = new Set(["blocked", "rate"]);
// On globalThis so the back-off survives Next.js dev HMR module reloads.
const g = globalThis as typeof globalThis & {
  __aaBackoffUntil?: Map<string, number>;
  __aaLastOkAt?: Map<string, number>;
  __aaDriftBackoff?: Set<string>;
};
const backoffUntil = (g.__aaBackoffUntil ??= new Map<string, number>());
const lastOkAt = (g.__aaLastOkAt ??= new Map<string, number>());
/** Stores whose current back-off came from a drift only: a later ok answer (same search) lifts it. */
const driftBackoff = (g.__aaDriftBackoff ??= new Set<string>());

function recordOk(site: string): void {
  lastOkAt.set(site, Date.now());
  if (driftBackoff.delete(site)) backoffUntil.delete(site);
}

function recordFailure(site: string, cls: string): void {
  if (BACKOFF_CLASSES.has(cls)) {
    // blocked/rate: never lifted by an ok, even if a drift set the back-off first.
    driftBackoff.delete(site);
    backoffUntil.set(site, Date.now() + BACKOFF_MS);
    return;
  }
  if (cls !== "drift") return;
  const ok = lastOkAt.get(site);
  if (ok !== undefined && Date.now() - ok < DRIFT_OK_GRACE_MS) return;
  // Do not turn an active blocked/rate back-off into a liftable one.
  if (backingOff(site) && !driftBackoff.has(site)) return;
  driftBackoff.add(site);
  backoffUntil.set(site, Date.now() + BACKOFF_MS);
}

function backingOff(site: string): AaResult | null {
  const until = backoffUntil.get(site);
  if (until === undefined) return null;
  if (Date.now() >= until) {
    backoffUntil.delete(site);
    return null;
  }
  return { ok: false, class: "blocked", reason: `backing off until ${new Date(until).toISOString()}` };
}

/** Test helper: clear every store's back-off. */
export function resetBackoff(): void {
  backoffUntil.clear();
  lastOkAt.clear();
  driftBackoff.clear();
}

const limits = { search: pLimit(3), detail: pLimit(2) };
const caches = new Map<number, TtlCache<AaResult>>();
const inflight = new Map<string, Promise<AaResult>>();

function cacheFor(ttlMs: number): TtlCache<AaResult> {
  let c = caches.get(ttlMs);
  if (!c) caches.set(ttlMs, (c = new TtlCache<AaResult>(ttlMs)));
  return c;
}

async function callOnce(
  site: string,
  op: string,
  args: Record<string, string>,
): Promise<{ result: AaResult; retrySafe: boolean }> {
  try {
    const r = await call(site, op, args, CALL_OPTIONS);
    if (r.ok) return { result: { ok: true, tier: r.tier ?? 1, data: r.data }, retrySafe: false };
    return {
      result: { ok: false, class: r.class, reason: r.reason ?? "" },
      // Only plain errors that api-anything marks retry-safe; never blocked/rate/auth.
      retrySafe: r.class === "error" && r.retry === "safe",
    };
  } catch (e) {
    return {
      result: { ok: false, class: "error", reason: e instanceof Error ? e.message : String(e) },
      retrySafe: false,
    };
  }
}

export async function aaCall(
  site: string,
  op: string,
  args: Record<string, string>,
  opts: { ttlMs: number; lane: "search" | "detail" },
): Promise<AaResult> {
  const cache = cacheFor(opts.ttlMs);
  const key = `${site}/${op}/${JSON.stringify(args)}`;
  const hit = cache.get(key);
  // Cached hits intentionally do not refresh lastOkAt: they say nothing about the store right now.
  if (hit) return hit;

  const pending = inflight.get(key);
  if (pending) return pending;

  const held = backingOff(site);
  if (held) return held;

  const p = limits[opts.lane](async () => {
    // Re-check in the queue: a call queued behind one that got blocked must not send.
    const heldNow = backingOff(site);
    if (heldNow) return heldNow;
    let out = await callOnce(site, op, args);
    for (let i = 0; i < MAX_RETRIES && !out.result.ok && out.retrySafe; i++) {
      out = await callOnce(site, op, args);
    }
    if (out.result.ok) {
      cache.set(key, out.result);
      recordOk(site);
    } else recordFailure(site, out.result.class);
    return out.result;
  });
  inflight.set(key, p);
  const done = () => {
    if (inflight.get(key) === p) inflight.delete(key);
  };
  p.then(done, done);
  return p;
}
