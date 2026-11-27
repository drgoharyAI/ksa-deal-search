import "server-only";
import type { Db } from "./db";
import type { DealBadge, DealInsight, PriceTrend, Product } from "./types";
import { deliverable } from "./availability";

/**
 * Price observations and the deal insights built from them (spec: "Comparison and deal-insight
 * features", items 2 and 5). Every search records one observation per product per hour; insights
 * use the observations stored before this search plus the current price. No LLM: plain rules.
 */

export const HOUR = 3_600_000;
export const DAY = 24 * HOUR;
export const PRUNE_AFTER = 180 * DAY;
const WINDOW = 30 * DAY;
/** Days are counted in Saudi time (UTC+3, no daylight saving). */
const KSA_OFFSET = 3 * HOUR;

const MIN_OBSERVATIONS = 3;
const MIN_DAYS = 2;
/** The observations must also span at least this long, so 23:00 and 01:00 do not count as two days. */
const MIN_SPAN = 20 * HOUR;
/** "Below usual price": more than 10% under the 30-day median. */
const BELOW_USUAL = 0.9;
/** Fake deal (a): a discount is claimed, but the price is not below its usual price. */
const USUAL_PRICE = 0.98;
/** Fake deal (a): the "was" price is above every observed price and this far over the median. */
const INFLATED_WAS = 1.15;
/** Fake deal (b), no history: claimed discount, "was" multiple, and the result-set sanity floor. */
const UNREALISTIC_DISCOUNT = 70;
const UNREALISTIC_MULTIPLE = 3;
/** The price must be at least this share of the result set's median to count as "normal range". */
const NORMAL_RANGE_FLOOR = 0.5;
/** Fewer comparable listings than this and (b) never fires. */
const MIN_PEERS = 4;
/** A shown discount: discountPct at or above this, or a "was" price above the price. */
const SHOWN_DISCOUNT = 10;

export type Observation = { site: string; productId: string; price: number; origPrice: number | null; at: number };

const LABELS: Record<DealBadge, string> = {
  "fake-deal": "Fake deal",
  "lowest-30d": "Lowest in 30 days",
  "below-usual": "Below usual price",
  normal: "Normal price",
};

export const FAKE_REASONS = {
  usual: "Discount claimed, but this is its usual price",
  neverCharged: "The 'was' price was never charged",
  unrealistic: "Unrealistic 'was' price",
} as const;

const priceOf = (p: Product) => p.finalPrice ?? p.listPrice;
const valid = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n) && n > 0;
/** The Saudi calendar day (days since the epoch, UTC+3) of a timestamp. */
export const ksaDay = (at: number) => Math.floor((at + KSA_OFFSET) / DAY);

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/**
 * Enough data for a badge or a trend: at least 3 observations on at least 2 Saudi days, with at
 * least 20 hours between the first and the last.
 */
export function hasEnoughData(obs: { at: number }[]): boolean {
  if (obs.length < MIN_OBSERVATIONS || new Set(obs.map((o) => ksaDay(o.at))).size < MIN_DAYS) return false;
  const ats = obs.map((o) => o.at);
  return Math.max(...ats) - Math.min(...ats) >= MIN_SPAN;
}

/**
 * The observation set for one product: stored history minus anything from the last hour (the
 * current search stands for that hour), plus the current price at `now`.
 */
export function withCurrent(history: Observation[], current: { price: number; origPrice: number | null }, now: number, site = "", productId = ""): Observation[] {
  return [
    ...history.filter((o) => o.at <= now - HOUR && o.at >= now - PRUNE_AFTER),
    { site, productId, price: current.price, origPrice: current.origPrice, at: now },
  ].sort((a, b) => a.at - b.at);
}

function showsDiscount(price: number, origPrice: number | null, discountPct: number | null): boolean {
  return (discountPct ?? 0) >= SHOWN_DISCOUNT || (origPrice !== null && origPrice > price);
}

/** Claimed discount in percent: the store's discountPct, else derived from the "was" price. */
function claimedPct(price: number, origPrice: number | null, discountPct: number | null): number {
  if (valid(discountPct)) return discountPct;
  return origPrice !== null && origPrice > price ? ((origPrice - price) / origPrice) * 100 : 0;
}

export type BadgeInput = {
  price: number;
  origPrice: number | null;
  discountPct: number | null;
  /** All observations, current included (see withCurrent). */
  obs: Observation[];
  /** Median price of the comparable listings in this result set; null when there are too few. */
  peerMedian: number | null;
  now: number;
};

/** The deal badge, or undefined. Priority: Fake deal > Lowest in 30 days > Below usual > Normal. */
export function badgeFor(i: BadgeInput): DealInsight | undefined {
  const { price, origPrice, discountPct } = i;
  const discounted = showsDiscount(price, origPrice, discountPct);
  const recent = i.obs.filter((o) => o.at >= i.now - WINDOW);
  const enough = hasEnoughData(recent);
  const fake = (reason: string): DealInsight => ({ badge: "fake-deal", label: LABELS["fake-deal"], reason });

  if (enough) {
    const prices = recent.map((o) => o.price);
    const med = median(prices);
    if (discounted) {
      if (origPrice !== null && origPrice > Math.max(...i.obs.map((o) => o.price)) && origPrice >= INFLATED_WAS * med) {
        return fake(FAKE_REASONS.neverCharged);
      }
      if (price >= USUAL_PRICE * med) return fake(FAKE_REASONS.usual);
    }
  }
  if (!enough) {
    // (b) only stands in for missing history; with history, the rules above decide.
    return discounted && unrealisticWas(price, origPrice, discountPct, i.peerMedian) ? fake(FAKE_REASONS.unrealistic) : undefined;
  }

  const prices = recent.map((o) => o.price);
  const med = median(prices);
  if (price <= Math.min(...prices) && price < Math.max(...prices)) return { badge: "lowest-30d", label: LABELS["lowest-30d"] };
  if (price < BELOW_USUAL * med) return { badge: "below-usual", label: LABELS["below-usual"] };
  return { badge: "normal", label: LABELS.normal };
}

/**
 * Fake deal (b), no history needed. Conservative: a claimed discount of at least 70%, a "was"
 * price at least 3x the price, and a price that sits in the result set's normal range. A price
 * far under the other listings is treated as genuine clearance and never flagged.
 */
function unrealisticWas(price: number, origPrice: number | null, discountPct: number | null, peerMedian: number | null): boolean {
  if (origPrice === null || peerMedian === null) return false;
  if (claimedPct(price, origPrice, discountPct) < UNREALISTIC_DISCOUNT) return false;
  if (origPrice < UNREALISTIC_MULTIPLE * price) return false;
  return price >= NORMAL_RANGE_FLOOR * peerMedian;
}

/**
 * Daily minimum over the last 30 days, oldest first, each point placed on its day (0 = 29 days
 * ago, 29 = today) so gaps show; today's point is the current price. Plus the change against
 * about a week ago.
 */
export function trendFor(obs: Observation[], price: number, now: number): PriceTrend | undefined {
  const recent = obs.filter((o) => o.at >= now - WINDOW);
  if (!hasEnoughData(recent)) return undefined;
  const today = ksaDay(now);
  const byDay = new Map<number, number>();
  for (const o of recent) {
    const d = ksaDay(o.at);
    if (d !== today) byDay.set(d, Math.min(byDay.get(d) ?? Infinity, o.price));
  }
  byDay.set(today, price);
  const first = today - (WINDOW / DAY - 1);
  const points = [...byDay.entries()]
    .filter(([d]) => d >= first)
    .sort((a, b) => a[0] - b[0])
    .map(([d, p]) => ({ day: d - first, price: p }));
  // "Last week": the latest observation 7 to 14 days old.
  const ref = recent.filter((o) => o.at <= now - 7 * DAY && o.at >= now - 14 * DAY).at(-1);
  const trend: PriceTrend = { points };
  if (ref) trend.changePct7d = Math.round(((price - ref.price) / ref.price) * 100);
  return trend;
}

const key = (site: string, id: string) => `${site}\u0000${id}`;

/** Median price of the result set's confident listings, or null when there are too few. */
function peerMedianOf(products: Product[]): number | null {
  const prices = products.filter((p) => !p.weakMatch && (p.matchScore ?? 1) >= 0.5).map(priceOf).filter(valid);
  return prices.length >= MIN_PEERS ? median(prices) : null;
}

/** Insights per product (keyed by site + id), from observations stored before `now`. */
export function insightsFor(db: Db, products: Product[], now = Date.now()): Map<string, { deal?: DealInsight; trend?: PriceTrend }> {
  const stmt = db.prepare(
    "SELECT site, productId, price, origPrice, at FROM observations WHERE site = ? AND productId = ? AND at >= ? ORDER BY at",
  );
  // Branch-pickup-only listings get no badge or trend and are not peers of the others.
  const shown = products.filter(deliverable);
  const peerMedian = peerMedianOf(shown);
  const out = new Map<string, { deal?: DealInsight; trend?: PriceTrend }>();
  for (const p of shown) {
    const price = priceOf(p);
    if (!valid(price) || out.has(key(p.site, p.id))) continue;
    const history = stmt.all(p.site, p.id, now - PRUNE_AFTER) as Observation[];
    const obs = withCurrent(history, { price, origPrice: p.origPrice }, now, p.site, p.id);
    const deal = badgeFor({ price, origPrice: p.origPrice, discountPct: p.discountPct, obs, peerMedian, now });
    const trend = trendFor(obs, price, now);
    if (deal || trend) out.set(key(p.site, p.id), { ...(deal && { deal }), ...(trend && { trend }) });
  }
  return out;
}

/** Copies of the products with `deal` and `trend` attached where there is enough to say. */
export function attachInsights(products: Product[], insights: Map<string, { deal?: DealInsight; trend?: PriceTrend }>): Product[] {
  return products.map((p) => {
    const i = insights.get(key(p.site, p.id));
    return i ? { ...p, ...i } : p;
  });
}

const lastPrune = new WeakMap<Db, number>();

/** Deletes observations older than 180 days. */
export function pruneObservations(db: Db, now = Date.now()): number {
  lastPrune.set(db, now);
  return Number(db.prepare("DELETE FROM observations WHERE at < ?").run(now - PRUNE_AFTER).changes);
}

/**
 * Records one observation per product, in one transaction, skipping any product already observed
 * within the hour before its answer time (`fetchedAt`, else now). Prunes old rows at most once an hour.
 */
export function recordObservations(db: Db, products: Product[], now = Date.now()): number {
  const insert = db.prepare(
    `INSERT INTO observations (site, productId, price, origPrice, at)
     SELECT ?, ?, ?, ?, ? WHERE NOT EXISTS
       (SELECT 1 FROM observations WHERE site = ? AND productId = ? AND at > ?)`,
  );
  let added = 0;
  db.exec("BEGIN");
  try {
    const seen = new Set<string>();
    for (const p of products) {
      const price = priceOf(p);
      const k = key(p.site, p.id);
      // A branch-pickup-only price is not a deliverable price: it is not part of the history.
      if (!valid(price) || !p.id || seen.has(k) || p.pickupOnly) continue;
      seen.add(k);
      const orig = valid(p.origPrice) ? p.origPrice : null;
      // A cached store answer is stamped with when the store gave it, so the hourly dedupe drops
      // a repeat of an answer already recorded instead of logging it as a new sighting.
      const at = valid(p.fetchedAt) ? Math.min(p.fetchedAt, now) : now;
      added += Number(insert.run(p.site, p.id, price, orig, at, p.site, p.id, at - HOUR).changes);
    }
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
  if (now - (lastPrune.get(db) ?? -Infinity) >= HOUR) pruneObservations(db, now);
  return added;
}
