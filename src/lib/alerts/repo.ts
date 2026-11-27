import "server-only";
import type { Db } from "@/src/lib/db";
import { normQuery, type AlertEvent, type PricePoint, type Watch, type WatchFilters, type WatchKind, type WatchStatus, type WatchView } from "./shared";

type WatchRow = Omit<Watch, "sites" | "filters"> & { sites: string; filters: string | null };

const parseJson = <T>(s: string | null, fallback: T): T => {
  try {
    return s ? (JSON.parse(s) as T) : fallback;
  } catch {
    return fallback;
  }
};

const toWatch = (r: WatchRow): Watch => ({ ...r, sites: parseJson<string[]>(r.sites, []), filters: parseJson<WatchFilters>(r.filters, {}) });

export type NewWatch = {
  kind: WatchKind;
  site: string | null;
  productId: string | null;
  query: string;
  sites: string[];
  target: number;
  title?: string | null;
  url?: string | null;
  image?: string | null;
  currency?: string;
  filters?: WatchFilters;
};

export function createWatch(db: Db, w: NewWatch, now: number): number {
  const r = db
    .prepare(
      `INSERT INTO watches (kind, site, productId, query, sites, target, title, url, image, currency, createdAt, filters)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(w.kind, w.site, w.productId, w.query, JSON.stringify(w.sites), w.target, w.title ?? null, w.url ?? null, w.image ?? null, w.currency || "SAR", now, JSON.stringify(w.filters ?? {}));
  return Number(r.lastInsertRowid);
}

export function getWatch(db: Db, id: number): Watch | null {
  const r = db.prepare("SELECT * FROM watches WHERE id = ?").get(id) as unknown as WatchRow | undefined;
  return r ? toWatch(r) : null;
}

/** The active product watch on this store product, if any (one watch per product). */
export function findProductWatch(db: Db, site: string, productId: string): Watch | null {
  const r = db.prepare("SELECT * FROM watches WHERE kind = 'product' AND site = ? AND productId = ? ORDER BY id LIMIT 1").get(site, productId) as unknown as WatchRow | undefined;
  return r ? toWatch(r) : null;
}

const sameSet = (a: string[], b: string[]) => a.length === b.length && [...a].sort().join() === [...b].sort().join();

/** An existing search watch with the same query (normalised), stores and target, if any. */
export function findSearchWatch(db: Db, w: { query: string; sites: string[]; target: number }): Watch | null {
  const rows = db.prepare("SELECT * FROM watches WHERE kind = 'search' AND target = ? ORDER BY id").all(w.target) as unknown as WatchRow[];
  const q = normQuery(w.query);
  return rows.map(toWatch).find((x) => normQuery(x.query) === q && sameSet(x.sites, w.sites)) ?? null;
}

export function listWatches(db: Db, opts: { activeOnly?: boolean } = {}): Watch[] {
  const sql = opts.activeOnly ? "SELECT * FROM watches WHERE status = 'active' ORDER BY id" : "SELECT * FROM watches ORDER BY createdAt DESC, id DESC";
  return (db.prepare(sql).all() as unknown as WatchRow[]).map(toWatch);
}

export type WatchPatch = Partial<{
  target: number;
  status: WatchStatus;
  lastFiredPrice: number | null;
  lastCheckedAt: number | null;
  lastPrice: number | null;
  lastCheckStatus: string | null;
  title: string | null;
  url: string | null;
  filters: WatchFilters;
}>;

const PATCHABLE = new Set(["target", "status", "lastFiredPrice", "lastCheckedAt", "lastPrice", "lastCheckStatus", "title", "url", "filters"]);

/**
 * Re-arming (lastFiredPrice set to null: a new target, a resumed watch, a price above the target)
 * also ends any pending Telegram retry, so the next drop is a new alert, never a retry.
 */
export function updateWatch(db: Db, id: number, patch: WatchPatch): boolean {
  const keys = Object.keys(patch).filter((k) => PATCHABLE.has(k));
  if (!keys.length) return false;
  const sql = `UPDATE watches SET ${keys.map((k) => `${k} = ?`).join(", ")} WHERE id = ?`;
  const vals = keys.map((k) => (k === "filters" ? JSON.stringify(patch.filters ?? {}) : (patch as Record<string, string | number | null>)[k]));
  const changed = Number(db.prepare(sql).run(...vals, id).changes) > 0;
  if (changed && "lastFiredPrice" in patch && patch.lastFiredPrice === null) clearRetry(db, id);
  return changed;
}

export function countWatches(db: Db): number {
  return (db.prepare("SELECT count(*) n FROM watches").get() as { n: number }).n;
}

export function deleteWatch(db: Db, id: number): boolean {
  return Number(db.prepare("DELETE FROM watches WHERE id = ?").run(id).changes) > 0;
}

export function addPricePoint(db: Db, watchId: number, p: { at: number; price: number; url?: string | null; title?: string | null }): void {
  db.prepare("INSERT INTO price_points (watchId, at, price, url, title) VALUES (?, ?, ?, ?, ?)").run(watchId, p.at, p.price, p.url ?? null, p.title ?? null);
}

export function listPricePoints(db: Db, watchId: number, limit = 60): PricePoint[] {
  const rows = db
    .prepare("SELECT at, price FROM (SELECT at, price, id FROM price_points WHERE watchId = ? ORDER BY at DESC, id DESC LIMIT ?) ORDER BY at, id")
    .all(watchId, limit) as unknown as PricePoint[];
  return rows.map((r) => ({ at: r.at, price: r.price }));
}

/** Every watch with its lowest recorded price and its latest points (oldest first), for the Alerts page. */
export function listWatchViews(db: Db): WatchView[] {
  const lows = new Map(
    (db.prepare("SELECT watchId, min(price) low FROM price_points GROUP BY watchId").all() as unknown as { watchId: number; low: number }[]).map((r) => [r.watchId, r.low]),
  );
  return listWatches(db).map((w) => ({ ...w, lowest: lows.get(w.id) ?? null, points: listPricePoints(db, w.id) }));
}

type EventRow = Omit<AlertEvent, "sent" | "seen"> & { sent: number; seen: number; retry?: number };

const toEvent = ({ retry: _retry, ...r }: EventRow): AlertEvent => ({ ...r, sent: !!r.sent, seen: !!r.seen });

/** `retry`: the Telegram send failed and the next cycle retries it (pendingEvent finds it). */
export function addEvent(db: Db, e: Omit<AlertEvent, "id" | "seen">, opts: { retry?: boolean } = {}): number {
  const r = db
    .prepare("INSERT INTO alert_events (watchId, at, title, site, oldPrice, newPrice, target, currency, url, sent, retry) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
    .run(e.watchId, e.at, e.title, e.site, e.oldPrice, e.newPrice, e.target, e.currency, e.url, e.sent ? 1 : 0, !e.sent && opts.retry ? 1 : 0);
  return Number(r.lastInsertRowid);
}

export function listEvents(db: Db, limit = 100): AlertEvent[] {
  const rows = db.prepare("SELECT * FROM alert_events ORDER BY at DESC, id DESC LIMIT ?").all(limit) as unknown as EventRow[];
  return rows.map(toEvent);
}

export function unreadCount(db: Db): number {
  return (db.prepare("SELECT count(*) n FROM alert_events WHERE seen = 0").get() as { n: number }).n;
}

/** Marks events up to and including id `upTo` as seen (the newest one the page showed); omitted: all. */
export function markEventsSeen(db: Db, upTo?: number): void {
  if (upTo === undefined) db.prepare("UPDATE alert_events SET seen = 1 WHERE seen = 0").run();
  else db.prepare("UPDATE alert_events SET seen = 1 WHERE seen = 0 AND id <= ?").run(upTo);
}

/**
 * The watch's event whose Telegram send failed and is still to be retried: its explicit retry flag
 * (set only on a failed send that should be retried). Re-arming clears the flag (clearRetry), so a
 * manual re-arm or a rise above the target makes the next drop a new alert.
 */
export function pendingEvent(db: Db, watchId: number): AlertEvent | null {
  const r = db.prepare("SELECT * FROM alert_events WHERE watchId = ? AND retry = 1 AND sent = 0 ORDER BY at DESC, id DESC LIMIT 1").get(watchId) as unknown as EventRow | undefined;
  return r ? toEvent(r) : null;
}

/** Ends the watch's pending retries (re-armed). */
export function clearRetry(db: Db, watchId: number): void {
  db.prepare("UPDATE alert_events SET retry = 0 WHERE watchId = ? AND retry = 1").run(watchId);
}

/** A retried send: the new price, whether it went out, and whether to retry again. */
export function updateEvent(db: Db, id: number, patch: { newPrice: number; sent: boolean; retry?: boolean }): void {
  db.prepare("UPDATE alert_events SET newPrice = ?, sent = ?, retry = ? WHERE id = ?").run(patch.newPrice, patch.sent ? 1 : 0, !patch.sent && patch.retry ? 1 : 0, id);
}

/** Price points are kept this long (owner ruling: safety caps). */
export const PRICE_POINT_DAYS = 180;
/** Alert events kept: the newest this many. */
export const MAX_EVENTS = 1000;

/** Drops price points older than PRICE_POINT_DAYS and alert events beyond the newest MAX_EVENTS. */
export function pruneAlertHistory(db: Db, now: number): void {
  db.prepare("DELETE FROM price_points WHERE at < ?").run(now - PRICE_POINT_DAYS * 86_400_000);
  db.prepare("DELETE FROM alert_events WHERE id NOT IN (SELECT id FROM alert_events ORDER BY at DESC, id DESC LIMIT ?)").run(MAX_EVENTS);
}
