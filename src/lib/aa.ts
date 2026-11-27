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

const MAX_RETRIES = 2;
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
    const r = await call(site, op, args, { view: { maxChars: 200000 } });
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
  if (hit) return hit;

  const pending = inflight.get(key);
  if (pending) return pending;

  const p = limits[opts.lane](async () => {
    let out = await callOnce(site, op, args);
    for (let i = 0; i < MAX_RETRIES && !out.result.ok && out.retrySafe; i++) {
      out = await callOnce(site, op, args);
    }
    if (out.result.ok) cache.set(key, out.result);
    return out.result;
  });
  inflight.set(key, p);
  const done = () => void (inflight.get(key) === p && inflight.delete(key));
  p.then(done, done);
  return p;
}
