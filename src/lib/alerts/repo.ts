import "server-only";
import type { Db } from "@/src/lib/db";
import type { AlertEvent, PricePoint, Watch, WatchKind, WatchStatus, WatchView } from "./shared";

type WatchRow = Omit<Watch, "sites"> & { sites: string };

const toWatch = (r: WatchRow): Watch => {
  let sites: string[] = [];
  try {
    sites = JSON.parse(r.sites) as string[];
  } catch {
    // keep []
  }
  return { ...r, sites };
};

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
};

export function createWatch(db: Db, w: NewWatch, now: number): number {
  const r = db
    .prepare(
      `INSERT INTO watches (kind, site, productId, query, sites, target, title, url, image, currency, createdAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(w.kind, w.site, w.productId, w.query, JSON.stringify(w.sites), w.target, w.title ?? null, w.url ?? null, w.image ?? null, w.currency || "SAR", now);
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
}>;

const PATCHABLE = new Set(["target", "status", "lastFiredPrice", "lastCheckedAt", "lastPrice", "lastCheckStatus", "title", "url"]);

export function updateWatch(db: Db, id: number, patch: WatchPatch): boolean {
  const keys = Object.keys(patch).filter((k) => PATCHABLE.has(k));
  if (!keys.length) return false;
  const sql = `UPDATE watches SET ${keys.map((k) => `${k} = ?`).join(", ")} WHERE id = ?`;
  const vals = keys.map((k) => (patch as Record<string, string | number | null>)[k]);
  return Number(db.prepare(sql).run(...vals, id).changes) > 0;
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

type EventRow = Omit<AlertEvent, "sent" | "seen"> & { sent: number; seen: number };

export function addEvent(db: Db, e: Omit<AlertEvent, "id" | "seen">): number {
  const r = db
    .prepare("INSERT INTO alert_events (watchId, at, title, site, oldPrice, newPrice, target, currency, url, sent) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
    .run(e.watchId, e.at, e.title, e.site, e.oldPrice, e.newPrice, e.target, e.currency, e.url, e.sent ? 1 : 0);
  return Number(r.lastInsertRowid);
}

export function listEvents(db: Db, limit = 100): AlertEvent[] {
  const rows = db.prepare("SELECT * FROM alert_events ORDER BY at DESC, id DESC LIMIT ?").all(limit) as unknown as EventRow[];
  return rows.map((r) => ({ ...r, sent: !!r.sent, seen: !!r.seen }));
}

export function unreadCount(db: Db): number {
  return (db.prepare("SELECT count(*) n FROM alert_events WHERE seen = 0").get() as { n: number }).n;
}

export function markEventsSeen(db: Db): void {
  db.prepare("UPDATE alert_events SET seen = 1 WHERE seen = 0").run();
}

/**
 * The watch's latest event when its Telegram send failed and is still to be retried: unsent, and
 * no price above `target` was recorded since (a rise re-arms the watch, so a later drop is a new
 * alert).
 */
export function pendingEvent(db: Db, watchId: number, target: number): AlertEvent | null {
  const r = db.prepare("SELECT * FROM alert_events WHERE watchId = ? ORDER BY at DESC, id DESC LIMIT 1").get(watchId) as unknown as EventRow | undefined;
  if (!r || r.sent) return null;
  const rose = db.prepare("SELECT 1 FROM price_points WHERE watchId = ? AND at > ? AND price > ? LIMIT 1").get(watchId, r.at, target);
  return rose ? null : { ...r, sent: false, seen: !!r.seen };
}

export function updateEvent(db: Db, id: number, patch: { newPrice: number; sent: boolean }): void {
  db.prepare("UPDATE alert_events SET newPrice = ?, sent = ? WHERE id = ?").run(patch.newPrice, patch.sent ? 1 : 0, id);
}
