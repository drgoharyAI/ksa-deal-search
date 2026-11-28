import "server-only";
import type { Db } from "@/src/lib/db";
import type { SearchInput, SearchOptions, SearchResult } from "@/src/lib/pipeline";
import type { Product, SiteStatus } from "@/src/lib/types";
import { storeLabel } from "@/src/lib/stores";
import { isFromPrice } from "@/src/lib/discount";
import type { AlertMessage, SendResult } from "@/src/lib/telegram";
import { addEvent, addPricePoint, getWatch, listWatches, pendingEvent, pruneAlertHistory, updateEvent, updateWatch } from "./repo";
import { passesPriceRating, ratinglessSites } from "@/src/lib/filters";
import { cheapestConfident, normQuery, priceOf, type Watch } from "./shared";

/**
 * The price-alert checker. One cycle:
 * 1. takes the active watches (only those not checked since `dueBefore`, when given), at most
 *    MAX_WATCHES_PER_CYCLE of them, oldest checked first; the rest wait for the next cycle;
 * 2. groups them by (store, query), so each store is fetched at most once per query per cycle,
 *    through the normal pipeline (runSearch), which keeps its caches and back-offs;
 * 3. runs the groups one after another, waiting `staggerMs` between them;
 * 4. per watch, re-read from the database first (a watch deleted or paused meanwhile is skipped,
 *    a new target is used): a product watch takes its own product (store + id) from the store's
 *    listings before the cross-store dedupe, a search watch the cheapest confident match over its
 *    stores ("less likely" and "from" prices never count);
 * 5. fires when the price is at or under the target and the watch is armed (lastFiredPrice is
 *    null). Firing sets lastFiredPrice; a later price above the target clears it again, so a
 *    watch notifies again only after the price rose above the target and fell back.
 * Only a full answer (every store of the watch answered "ok" with no failed request) records a
 * price point and can re-arm the watch: a partial answer may lack the store with the low price
 * and would otherwise re-arm it, so the same drop would alert twice. A partial answer records
 * its status ("partial"); a price at or under the target it shows still fires an armed watch.
 * A blocked or failing store is skipped quietly: the watch keeps its last price.
 * A failed Telegram send (timeout, 5xx; not "not set up") keeps the watch armed and flags the
 * event for retry, so the next cycle retries it and updates the same in-app event. At most
 * MAX_SENDS_PER_CYCLE Telegram sends per cycle; an armed watch past that fires next cycle.
 * Watches are taken oldest-checked first; a watch whose store is at its siteCaps limit waits.
 * One watch failing (e.g. deleted mid-cycle) is logged and the cycle goes on.
 */
export type CheckerDeps = {
  db: Db;
  search: (input: SearchInput, opts?: Pick<SearchOptions, "onFiltered">) => Promise<SearchResult>;
  now: () => number;
  sleep: (ms: number) => Promise<void>;
  notify: (m: AlertMessage) => Promise<SendResult>;
  staggerMs?: number;
  /** Wait before a group for this store; default staggerMs (Chrome-backed stores need longer). */
  gapMs?: (site: string) => number;
  /** At most this many groups for a store per cycle (e.g. SHEIN); the rest wait for the next cycle. */
  siteCaps?: Record<string, number>;
  /** Only watches never checked or last checked before this time (ms). Omitted: every active watch. */
  dueBefore?: number;
};

/** Owner ruling, safety caps: watches processed and Telegram alerts sent per cycle. */
const MAX_WATCHES_PER_CYCLE = 100;
const MAX_SENDS_PER_CYCLE = 20;

export type CycleReport = { checked: number; groups: number; fired: number; retried: number; failedGroups: number; deferred: number };

type Answer = {
  ok: true;
  /** Status "ok" with no failed request. */
  full: boolean;
  /** Deduped across stores (search watches). */
  products: Product[];
  /** Every listing that passed the filters, before the dedupe (product watches). */
  listings: Product[];
  outOfStock: Set<string>;
};
type GroupOutcome = Answer | { ok: false; status: SiteStatus["status"] };

const SEP = "\u0000";

function filterFor(w: Watch, products: Product[]): Product[] {
  const f = w.filters ?? {};
  if (f.minPrice === undefined && f.maxPrice === undefined && f.minRating === undefined) return products;
  const bySite = new Map<string, Product[]>();
  for (const p of products) bySite.set(p.site, [...(bySite.get(p.site) ?? []), p]);
  const ratingless = ratinglessSites([...bySite].map(([site, ps]) => ({ site, products: ps })));
  return products.filter((p) => passesPriceRating(p, f, ratingless));
}

const storesOf = (w: Watch): string[] => (w.kind === "product" ? (w.site ? [w.site] : []) : w.sites);

async function fetchGroup(deps: CheckerDeps, g: { site: string; query: string }): Promise<GroupOutcome> {
  try {
    let listings: Product[] | null = null;
    const r = await deps.search({ query: g.query, sites: [g.site], sort: "price" }, { onFiltered: (ps) => (listings = ps) });
    const st = r.statuses.find((s) => s.site === g.site);
    if (st && st.status !== "ok") return { ok: false, status: st.status };
    return {
      ok: true,
      full: !!st && !st.message,
      products: r.products,
      listings: listings ?? r.products,
      outOfStock: new Set((r.outOfStock ?? []).map((o) => `${o.site}${SEP}${o.id}`)),
    };
  } catch (e) {
    console.warn("[alerts] check failed", g.site, e instanceof Error ? e.message : String(e));
    return { ok: false, status: "error" };
  }
}

type Counters = { fired: number; retried: number; sends: number };

/** One watch against the cycle's answers, re-read first. False when it is gone or paused. */
async function processWatch(deps: CheckerDeps, id: number, outcomes: Map<string, GroupOutcome>, c: Counters): Promise<boolean> {
  const { db } = deps;
  const w = getWatch(db, id);
  if (!w || w.status !== "active") return false; // deleted or paused since the cycle began
  const now = deps.now();
  const stores = storesOf(w);
  const outs = stores.map((site) => outcomes.get(`${site}${SEP}${normQuery(w.query)}`)).filter((o): o is GroupOutcome => !!o);
  const answered = outs.filter((o): o is Answer => o.ok);
  if (!answered.length) {
    const blocked = outs.some((o) => !o.ok && o.status === "blocked");
    updateWatch(db, w.id, { lastCheckedAt: now, lastCheckStatus: blocked ? "blocked" : "error" });
    return true;
  }
  const full = stores.length > 0 && answered.length === stores.length && answered.every((o) => o.full);
  const hit =
    w.kind === "product"
      ? (answered.flatMap((o) => o.listings).find((p) => p.site === w.site && p.id === w.productId) ?? null)
      : cheapestConfident(filterFor(w, answered.flatMap((o) => o.products))); // the search form's filters, applied to each store's answer
  if (!hit) {
    // A watched product its store now marks out of stock says so, rather than "not found".
    const gone = w.kind === "product" && answered.some((o) => o.outOfStock.has(`${w.site}${SEP}${w.productId}`));
    const status = !full ? "partial" : gone ? "out of stock" : w.kind === "product" ? "not found" : "no match";
    updateWatch(db, w.id, { lastCheckedAt: now, lastCheckStatus: status });
    return true;
  }
  if (hit.pickupOnly) {
    // Branch pickup only: not a deliverable price, so no price point and no alert.
    updateWatch(db, w.id, { lastCheckedAt: now, lastCheckStatus: "pickup only" });
    return true;
  }

  const price = priceOf(hit);
  const patch: Parameters<typeof updateWatch>[2] = { lastCheckedAt: now, lastCheckStatus: full ? "ok" : "partial" };
  if (full) {
    addPricePoint(db, w.id, { at: now, price, url: hit.url, title: hit.title });
    patch.lastPrice = price;
    if (w.kind === "product") {
      patch.title = hit.title;
      patch.url = hit.url;
    }
  }

  if (price > w.target) {
    // Re-armed only on a full answer: a partial one may lack the store that has the low price.
    if (full) patch.lastFiredPrice = null;
  } else if (w.lastFiredPrice === null && c.sends < MAX_SENDS_PER_CYCLE) {
    const msg: AlertMessage = {
      title: hit.title,
      store: storeLabel(hit.site),
      oldPrice: w.lastPrice,
      newPrice: price,
      target: w.target,
      currency: hit.currency || w.currency,
      url: hit.url,
      ...(isFromPrice(hit) ? { from: true } : {}),
    };
    let sent = false;
    let retry = false;
    c.sends += 1;
    try {
      const r = await deps.notify(msg);
      sent = r.ok;
      retry = !r.ok && !r.notConfigured;
    } catch {
      retry = true;
    }
    const pending = pendingEvent(db, w.id);
    if (pending) {
      updateEvent(db, pending.id, { newPrice: price, sent, retry });
      c.retried += 1;
    } else {
      addEvent(db, { watchId: w.id, at: now, title: hit.title, site: hit.site, oldPrice: w.lastPrice, newPrice: price, target: w.target, currency: msg.currency, url: hit.url, sent }, { retry });
      c.fired += 1;
    }
    if (!retry) patch.lastFiredPrice = price; // a failed send stays armed and retries next cycle
  }
  updateWatch(db, w.id, patch);
  return true;
}

export async function runCycle(deps: CheckerDeps): Promise<CycleReport> {
  const { db } = deps;
  const all = listWatches(db, { activeOnly: true })
    .filter((w) => deps.dueBefore === undefined || w.lastCheckedAt === null || w.lastCheckedAt < deps.dueBefore)
    .sort((a, b) => (a.lastCheckedAt ?? -Infinity) - (b.lastCheckedAt ?? -Infinity) || a.id - b.id);
  const due = all.slice(0, MAX_WATCHES_PER_CYCLE);

  const groups = new Map<string, { site: string; query: string }>();
  const perSite = new Map<string, number>();
  const watches: Watch[] = [];
  let deferred = all.length - due.length;
  for (const w of due) {
    const fresh = storesOf(w)
      .map((site) => ({ site, key: `${site}${SEP}${normQuery(w.query)}` }))
      .filter((g) => !groups.has(g.key));
    const over = fresh.some((g) => {
      const cap = deps.siteCaps?.[g.site];
      return cap !== undefined && (perSite.get(g.site) ?? 0) + fresh.filter((f) => f.site === g.site).length > cap;
    });
    if (over) {
      deferred += 1; // checked next cycle; still due, and first in line as the oldest checked
      continue;
    }
    for (const g of fresh) {
      groups.set(g.key, { site: g.site, query: w.query.trim() });
      perSite.set(g.site, (perSite.get(g.site) ?? 0) + 1);
    }
    watches.push(w);
  }

  const outcomes = new Map<string, GroupOutcome>();
  let first = true;
  let failedGroups = 0;
  for (const [key, g] of groups) {
    if (!first) await deps.sleep(deps.gapMs ? deps.gapMs(g.site) : (deps.staggerMs ?? 0));
    first = false;
    const outcome = await fetchGroup(deps, g);
    if (!outcome.ok) failedGroups += 1;
    outcomes.set(key, outcome);
  }

  const c: Counters = { fired: 0, retried: 0, sends: 0 };
  let checked = 0;
  for (const w of watches) {
    try {
      if (await processWatch(deps, w.id, outcomes, c)) checked += 1;
    } catch (e) {
      // e.g. "constraint failed" for a watch deleted between its re-read and a write
      console.warn("[alerts] watch check failed", w.id, e instanceof Error ? e.message : String(e));
    }
  }
  try {
    pruneAlertHistory(db, deps.now());
  } catch (e) {
    console.warn("[alerts] prune failed", e instanceof Error ? e.message : String(e));
  }

  return { checked, groups: groups.size, fired: c.fired, retried: c.retried, failedGroups, deferred };
}

/** setTimeout's largest delay; a longer one fires at once (Node clamps it to 1 ms). */
const MAX_TIMER_MS = 2 ** 31 - 1;

export type Checker = {
  readonly running: boolean;
  /** Runs one cycle now (every active watch); { skipped: true } when a cycle is already running. */
  runNow(opts?: { onlyDue?: boolean }): Promise<CycleReport | { skipped: true }>;
  start(): void;
  stop(): void;
};

/**
 * Wraps runCycle with a lock (never two cycles at once) and a timer. The timer's cycles only
 * check watches that are due (not checked within ~90% of the interval), so a restarted server
 * does not refetch everything at once.
 */
export function createChecker(
  makeDeps: () => CheckerDeps,
  opts: { intervalMs: number; firstDelayMs?: number },
): Checker {
  let running = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let started = false;

  const runNow: Checker["runNow"] = async ({ onlyDue = false } = {}) => {
    if (running) return { skipped: true };
    running = true;
    try {
      const deps = makeDeps();
      return await runCycle(onlyDue ? { ...deps, dueBefore: deps.now() - opts.intervalMs * 0.9 } : deps);
    } finally {
      running = false;
    }
  };

  // A wait longer than MAX_TIMER_MS is chained in steps: one setTimeout that long fires at once.
  const wait = (ms: number, then: () => void) => {
    const step = Math.min(Math.max(0, ms), MAX_TIMER_MS);
    timer = setTimeout(() => (ms > step ? wait(ms - step, then) : then()), step);
    (timer as { unref?: () => void }).unref?.();
  };

  const schedule = (ms: number) => {
    const cycle = async () => {
      try {
        await runNow({ onlyDue: true });
      } catch (e) {
        console.warn("[alerts] cycle failed", e instanceof Error ? e.message : String(e));
      }
      if (started) schedule(opts.intervalMs);
    };
    wait(ms, () => void cycle());
  };

  return {
    get running() {
      return running;
    },
    runNow,
    start() {
      if (started) return;
      started = true;
      schedule(opts.firstDelayMs ?? 60_000);
    },
    stop() {
      started = false;
      if (timer) clearTimeout(timer);
      timer = null;
    },
  };
}
