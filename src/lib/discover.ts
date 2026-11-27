import "server-only";
import type { Db } from "./db";
import type { DealInsight, Product } from "./types";
import { DAY, PRUNE_AFTER, badgeFor, type Observation } from "./insights";
import { httpsUrl } from "./view";

/**
 * "Recently seen deals" on the home page, from this app's own database only (no store traffic):
 * products seen in a search during the last two weeks whose price our observations show has dropped,
 * or that carry a "Lowest in 30 days" / "Below usual price" badge from the same observations.
 * A claimed store discount alone never qualifies, and a "Fake deal" never shows.
 */

export type DiscoverItem = {
  site: string;
  id: string;
  title: string;
  url: string;
  image: string | null;
  currency: string;
  /** The latest observed price. */
  price: number;
  /** The highest price we observed for it in the 30 days before the latest one; null without a drop. */
  previousPrice: number | null;
  /** Whole percent under previousPrice; null without a drop. */
  dropPct: number | null;
  deal?: DealInsight;
  /** When we last saw it (ms). */
  seenAt: number;
};

export const DISCOVER_LIMIT = 8;
/** Only products seen this recently. */
const RECENT = 14 * DAY;
/** The window the drop and the badge are judged over. */
const WINDOW = 30 * DAY;
/** A drop smaller than this (percent) is noise, not a deal. */
const MIN_DROP = 5;
/** Candidates read from seen_products before the observation checks. */
const SCAN = 400;
const GOOD: DealInsight["badge"][] = ["lowest-30d", "below-usual"];

const valid = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n) && n > 0;

/** Upserts the title, https link and picture of each product a search returned. */
export function recordSeen(db: Db, products: Product[], now = Date.now()): number {
  const upsert = db.prepare(
    `INSERT INTO seen_products (site, productId, title, url, image, currency, lastSeen) VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (site, productId) DO UPDATE SET title = excluded.title, url = excluded.url, image = excluded.image,
       currency = excluded.currency, lastSeen = MAX(lastSeen, excluded.lastSeen)`,
  );
  let n = 0;
  db.exec("BEGIN");
  try {
    for (const p of products) {
      const url = httpsUrl(p.url);
      const title = p.title?.trim();
      if (!p.id || !url || !title) continue;
      const image = p.image ? httpsUrl(p.image) : null;
      const at = valid(p.fetchedAt) ? Math.min(p.fetchedAt, now) : now;
      n += Number(upsert.run(p.site, p.id, title.slice(0, 300), url, image, p.currency || "SAR", at).changes);
    }
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
  db.prepare("DELETE FROM seen_products WHERE lastSeen < ?").run(now - PRUNE_AFTER);
  return n;
}

type SeenRow = { site: string; productId: string; title: string; url: string; image: string | null; currency: string; lastSeen: number };

/** Up to `limit` recently seen products with a verified drop or a good deal badge, biggest drop first. */
export function discover(db: Db, now = Date.now(), limit = DISCOVER_LIMIT): DiscoverItem[] {
  const seen = db
    .prepare("SELECT site, productId, title, url, image, currency, lastSeen FROM seen_products WHERE lastSeen >= ? ORDER BY lastSeen DESC LIMIT ?")
    .all(now - RECENT, SCAN) as unknown as SeenRow[];
  const obsStmt = db.prepare("SELECT site, productId, price, origPrice, at FROM observations WHERE site = ? AND productId = ? AND at >= ? ORDER BY at");
  const out: DiscoverItem[] = [];
  for (const s of seen) {
    const obs = (obsStmt.all(s.site, s.productId, now - WINDOW) as unknown as Observation[]).filter((o) => valid(o.price));
    if (obs.length < 2) continue;
    const latest = obs[obs.length - 1];
    const before = Math.max(...obs.slice(0, -1).map((o) => o.price));
    const drop = before > latest.price ? Math.round(((before - latest.price) / before) * 100) : 0;
    const deal = badgeFor({ price: latest.price, origPrice: latest.origPrice, discountPct: null, obs, peerMedian: null, now: latest.at });
    if (deal?.badge === "fake-deal") continue;
    const good = deal && GOOD.includes(deal.badge) ? deal : undefined;
    if (drop < MIN_DROP && !good) continue;
    out.push({
      site: s.site,
      id: s.productId,
      title: s.title,
      url: s.url,
      image: s.image,
      currency: s.currency,
      price: latest.price,
      previousPrice: drop >= MIN_DROP ? before : null,
      dropPct: drop >= MIN_DROP ? drop : null,
      ...(good && { deal: good }),
      seenAt: s.lastSeen,
    });
  }
  return out.sort((a, b) => (b.dropPct ?? 0) - (a.dropPct ?? 0) || b.seenAt - a.seenAt).slice(0, limit);
}
