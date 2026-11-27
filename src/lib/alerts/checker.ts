import "server-only";
import type { Db } from "@/src/lib/db";
import type { SearchInput, SearchResult } from "@/src/lib/pipeline";
import type { Product } from "@/src/lib/types";
import { storeLabel } from "@/src/lib/stores";
import type { AlertMessage, SendResult } from "@/src/lib/telegram";
import { addEvent, addPricePoint, listWatches, pendingEvent, updateEvent, updateWatch } from "./repo";
import { passesPriceRating, ratinglessSites } from "@/src/lib/filters";
import { cheapestConfident, normQuery, priceOf, type Watch } from "./shared";

/**
 * The price-alert checker. One cycle:
 * 1. takes the active watches (only those not checked since `dueBefore`, when given);
 * 2. groups them by (store, query), so each store is fetched at most once per query per cycle,
 *    through the normal pipeline (runSearch), which keeps its caches and back-offs;
 * 3. runs the groups one after another, waiting `staggerMs` between them;
 * 4. per watch: a product watch takes its own product (store + id) from the results, a search
 *    watch the cheapest confident match over its stores ("less likely" never counts). The price
 *    is stored as a price point;
 * 5. fires when the price is at or under the target and the watch is armed (lastFiredPrice is
 *    null). Firing sets lastFiredPrice; a later price above the target clears it again, so a
 *    watch notifies again only after the price rose above the target and fell back.
 * A blocked or failing store is skipped quietly: the watch keeps its last price.
 * A failed Telegram send (timeout, 5xx; not "not set up") keeps the watch armed so the next cycle
 * retries it; the retry updates the same in-app event instead of adding another.
 * Watches are taken oldest-checked first; a watch whose store is at its siteCaps limit waits.
 */
export type CheckerDeps = {
  db: Db;
  search: (input: SearchInput) => Promise<SearchResult>;
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

export type CycleReport = { checked: number; groups: number; fired: number; retried: number; failedGroups: number; deferred: number };

type GroupOutcome = { ok: true; products: Product[] } | { ok: false; status: "blocked" | "error" };

export { normQuery };

function filterFor(w: Watch, products: Product[]): Product[] {
  const f = w.filters ?? {};
  if (f.minPrice === undefined && f.maxPrice === undefined && f.minRating === undefined) return products;
  const bySite = new Map<string, Product[]>();
  for (const p of products) bySite.set(p.site, [...(bySite.get(p.site) ?? []), p]);
  const ratingless = ratinglessSites([...bySite].map(([site, ps]) => ({ site, products: ps })));
  return products.filter((p) => passesPriceRating(p, f, ratingless));
}

const storesOf = (w: Watch): string[] => (w.kind === "product" ? (w.site ? [w.site] : []) : w.sites);

export async function runCycle(deps: CheckerDeps): Promise<CycleReport> {
  const { db } = deps;
  const due = listWatches(db, { activeOnly: true })
    .filter((w) => deps.dueBefore === undefined || w.lastCheckedAt === null || w.lastCheckedAt < deps.dueBefore)
    .sort((a, b) => (a.lastCheckedAt ?? -Infinity) - (b.lastCheckedAt ?? -Infinity) || a.id - b.id);

  const groups = new Map<string, { site: string; query: string }>();
  const perSite = new Map<string, number>();
  const watches: Watch[] = [];
  let deferred = 0;
  for (const w of due) {
    const fresh = storesOf(w)
      .map((site) => ({ site, key: `${site}\u0000${normQuery(w.query)}` }))
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
    let outcome: GroupOutcome;
    try {
      const r = await deps.search({ query: g.query, sites: [g.site], sort: "price" });
      const st = r.statuses.find((s) => s.site === g.site);
      outcome = st && st.status !== "ok" ? { ok: false, status: st.status } : { ok: true, products: r.products };
    } catch (e) {
      console.warn("[alerts] check failed", g.site, e instanceof Error ? e.message : String(e));
      outcome = { ok: false, status: "error" };
    }
    if (!outcome.ok) failedGroups += 1;
    outcomes.set(key, outcome);
  }

  let fired = 0;
  let retried = 0;
  for (const w of watches) {
    const now = deps.now();
    const outs = storesOf(w).map((site) => outcomes.get(`${site}\u0000${normQuery(w.query)}`)).filter((o): o is GroupOutcome => !!o);
    const answered = outs.filter((o): o is Extract<GroupOutcome, { ok: true }> => o.ok);
    if (!answered.length) {
      const blocked = outs.some((o) => !o.ok && o.status === "blocked");
      updateWatch(db, w.id, { lastCheckedAt: now, lastCheckStatus: blocked ? "blocked" : "error" });
      continue;
    }
    const products = answered.flatMap((o) => o.products);
    const hit =
      w.kind === "product"
        ? (products.find((p) => p.site === w.site && p.id === w.productId) ?? null)
        : cheapestConfident(filterFor(w, products)); // the search form's filters, applied to each store's answer
    if (!hit) {
      updateWatch(db, w.id, { lastCheckedAt: now, lastCheckStatus: w.kind === "product" ? "not found" : "no match" });
      continue;
    }

    const price = priceOf(hit);
    addPricePoint(db, w.id, { at: now, price, url: hit.url, title: hit.title });
    const patch: Parameters<typeof updateWatch>[2] = { lastCheckedAt: now, lastPrice: price, lastCheckStatus: "ok" };
    if (w.kind === "product") {
      patch.title = hit.title;
      patch.url = hit.url;
    }

    if (price > w.target) {
      patch.lastFiredPrice = null; // re-armed: the next drop to the target notifies again
    } else if (w.lastFiredPrice === null) {
      const msg: AlertMessage = {
        title: hit.title,
        store: storeLabel(hit.site),
        oldPrice: w.lastPrice,
        newPrice: price,
        target: w.target,
        currency: hit.currency || w.currency,
        url: hit.url,
      };
      let sent = false;
      let retry = false;
      try {
        const r = await deps.notify(msg);
        sent = r.ok;
        retry = !r.ok && !r.notConfigured;
      } catch {
        retry = true;
      }
      const pending = pendingEvent(db, w.id, w.target);
      if (pending) {
        updateEvent(db, pending.id, { newPrice: price, sent });
        retried += 1;
      } else {
        addEvent(db, { watchId: w.id, at: now, title: hit.title, site: hit.site, oldPrice: w.lastPrice, newPrice: price, target: w.target, currency: msg.currency, url: hit.url, sent });
        fired += 1;
      }
      if (!retry) patch.lastFiredPrice = price; // a failed send stays armed and retries next cycle
    }
    updateWatch(db, w.id, patch);
  }

  return { checked: watches.length, groups: groups.size, fired, retried, failedGroups, deferred };
}

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

  const schedule = (ms: number) => {
    timer = setTimeout(async () => {
      try {
        await runNow({ onlyDue: true });
      } catch (e) {
        console.warn("[alerts] cycle failed", e instanceof Error ? e.message : String(e));
      }
      if (started) schedule(opts.intervalMs);
    }, ms);
    (timer as { unref?: () => void }).unref?.();
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
