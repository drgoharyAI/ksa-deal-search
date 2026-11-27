import "server-only";
import type { Db } from "./db";
import { storeImage, storeLink } from "./store-hosts";
import { MAX_SAVED, MAX_VIEWED, type ProductSnapshot, type SavedItem, type ViewedItem } from "./saved-shared";

/**
 * Saved products (favourites) and recently viewed products (UX phase U5), kept in SQLite
 * (migration 5). One owner, no accounts: a product is saved once, by (site, productId).
 */

type Ok<T> = { ok: true; value: T };
type Err = { ok: false; error: string };

/** Largest request body the saved and viewed routes read (a snapshot is well under 3 KB). */
export const MAX_BODY = 8_192;
const MAX_ID = 200;
const MAX_TITLE_IN = 1_000;
const MAX_TITLE = 300;
const MAX_URL = 2_000;
const MAX_QUERY = 200;
const MAX_PRICE = 10_000_000;
/** Any control character (an id is printed into links and keys). */
const hasControl = (v: string) => Array.from({ length: v.length }, (_, i) => v.charCodeAt(i)).some((n) => n < 32 || n === 127);

const okPrice = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v > 0 && v <= MAX_PRICE;

export type SavedInput = ProductSnapshot & { query: string | null };
/** A checked snapshot; `price` is null only for a view sent without one. */
export type ParsedSnapshot = Omit<SavedInput, "price"> & { price: number | null };

/**
 * Checks a product snapshot sent by the page. `needPrice`: a save needs the listed price (the
 * change since saving is measured from it); a view may come without one.
 */
export function parseSnapshot(body: unknown, siteIds: ReadonlySet<string>, opts: { needPrice: boolean }): Ok<ParsedSnapshot> | Err {
  if (!body || typeof body !== "object" || Array.isArray(body)) return { ok: false, error: "Send the product as a JSON object" };
  const b = body as Record<string, unknown>;
  const site = typeof b.site === "string" && siteIds.has(b.site) ? b.site : null;
  if (!site) return { ok: false, error: "Unknown store" };
  const id = typeof b.id === "string" ? b.id.trim() : "";
  if (!id || id.length > MAX_ID || hasControl(id)) return { ok: false, error: "A product needs its store id" };
  const title = typeof b.title === "string" ? b.title.trim() : "";
  if (!title || title.length > MAX_TITLE_IN) return { ok: false, error: "A product needs a title" };
  // The store's own page and image CDN only (store-hosts.ts): no lookalike link under its logo.
  const url = typeof b.url === "string" && b.url.length <= MAX_URL ? storeLink(site, b.url) : null;
  if (!url) return { ok: false, error: "A product needs its https link on that store's site" };
  const image = typeof b.image === "string" && b.image && b.image.length <= MAX_URL ? storeImage(site, b.image) : null;
  let price: number | null = null;
  if (b.price !== undefined && b.price !== null) {
    if (!okPrice(b.price)) return { ok: false, error: "The price must be a number above 0" };
    price = b.price;
  }
  if (opts.needPrice && price === null) return { ok: false, error: "A saved product needs its price" };
  const currency = typeof b.currency === "string" && /^[A-Z]{3}$/.test(b.currency) ? b.currency : "SAR";
  const query = typeof b.query === "string" && b.query.trim() && b.query.length <= MAX_QUERY ? b.query.trim() : null;
  return { ok: true, value: { site, id, title: title.slice(0, MAX_TITLE), url, image, price, currency, query } };
}

/* ---------- Favourites ---------- */

type SavedRow = { site: string; productId: string; title: string; url: string; image: string | null; price: number; currency: string; query: string | null; savedAt: number };

/**
 * Saves a product. Saving one already saved changes nothing (its saved price and time stay, so the
 * change since saving keeps its meaning). A new one past MAX_SAVED is refused.
 */
export function addFavourite(db: Db, s: SavedInput, now = Date.now()): "created" | "exists" | "full" {
  const has = db.prepare("SELECT 1 FROM favourites WHERE site = ? AND productId = ?").get(s.site, s.id);
  if (has) return "exists";
  const n = (db.prepare("SELECT count(*) n FROM favourites").get() as { n: number }).n;
  if (n >= MAX_SAVED) return "full";
  db.prepare("INSERT INTO favourites (site, productId, title, url, image, price, currency, query, savedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
    .run(s.site, s.id, s.title, s.url, s.image, s.price, s.currency, s.query, now);
  return "created";
}

export function removeFavourite(db: Db, site: string, id: string): boolean {
  return Number(db.prepare("DELETE FROM favourites WHERE site = ? AND productId = ?").run(site, id).changes) > 0;
}

/** Saved products, newest first, each with the latest price our observations hold for it. */
export function listFavourites(db: Db): SavedItem[] {
  // One query: each saved product with its newest observation (a window over its observations).
  const rows = db
    .prepare(
      `SELECT f.*, o.price AS obsPrice, o.at AS obsAt
       FROM favourites f
       LEFT JOIN (
         SELECT site, productId, price, at,
                ROW_NUMBER() OVER (PARTITION BY site, productId ORDER BY at DESC, id DESC) AS n
         FROM observations
         WHERE (site, productId) IN (SELECT site, productId FROM favourites)
       ) o ON o.site = f.site AND o.productId = f.productId AND o.n = 1
       ORDER BY f.savedAt DESC, f.rowid DESC`,
    )
    .all() as unknown as (SavedRow & { obsPrice: number | null; obsAt: number | null })[];
  return rows.map((r) => {
    const obs = r.obsPrice !== null && r.obsAt !== null && Number.isFinite(r.obsPrice) && r.obsPrice > 0 ? { price: r.obsPrice, at: r.obsAt } : null;
    // A change only from a price observed after saving, so the figure means "since you saved it".
    const change = obs && obs.at > r.savedAt ? Math.round((obs.price - r.price) * 100) / 100 : null;
    return { site: r.site, id: r.productId, title: r.title, url: r.url, image: r.image, price: r.price, currency: r.currency, query: r.query, savedAt: r.savedAt, latest: obs, change };
  });
}

/* ---------- Recently viewed ---------- */

type ViewedRow = { site: string; productId: string; title: string; url: string; image: string | null; price: number | null; currency: string; viewedAt: number };

/** Records a product opened at its store: one row per product (the newest view wins), the last MAX_VIEWED kept. */
export function recordView(db: Db, s: Omit<ParsedSnapshot, "query">, now = Date.now()): void {
  db.exec("BEGIN");
  try {
    // Two views in the same millisecond still list the later one first.
    const top = (db.prepare("SELECT MAX(viewedAt) m FROM recently_viewed").get() as { m: number | null }).m ?? 0;
    const at = Math.max(now, top + 1);
    db.prepare(
      `INSERT INTO recently_viewed (site, productId, title, url, image, price, currency, viewedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (site, productId) DO UPDATE SET title = excluded.title, url = excluded.url, image = excluded.image,
         price = COALESCE(excluded.price, price), currency = excluded.currency, viewedAt = MAX(viewedAt, excluded.viewedAt)`,
    ).run(s.site, s.id, s.title, s.url, s.image, s.price, s.currency, at);
    db.prepare("DELETE FROM recently_viewed WHERE rowid NOT IN (SELECT rowid FROM recently_viewed ORDER BY viewedAt DESC, rowid DESC LIMIT ?)").run(MAX_VIEWED);
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}

export function listViewed(db: Db, limit = MAX_VIEWED): ViewedItem[] {
  const rows = db.prepare("SELECT * FROM recently_viewed ORDER BY viewedAt DESC, rowid DESC LIMIT ?").all(limit) as unknown as ViewedRow[];
  return rows.map((r) => ({ site: r.site, id: r.productId, title: r.title, url: r.url, image: r.image, price: r.price, currency: r.currency, viewedAt: r.viewedAt }));
}

export function clearViewed(db: Db): void {
  db.prepare("DELETE FROM recently_viewed").run();
}
