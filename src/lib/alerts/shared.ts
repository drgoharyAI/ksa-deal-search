import type { Product } from "@/src/lib/types";
import { isLikelyMatch } from "@/src/lib/rank";

/** Client-safe shapes and helpers for history and price alerts (no server imports). */

export type CheapestMatch = { title: string; site: string; price: number; currency: string; url: string };

export type HistoryEntry = {
  id: number;
  at: number;
  query: string;
  sites: string[];
  sort: string;
  filters: { minPrice?: number; maxPrice?: number; minRating?: number };
  resultCount: number;
  cheapest: CheapestMatch | null;
};

export type WatchKind = "product" | "search";

/** A search watch's price and rating filters, as on the search form. */
export type WatchFilters = { minPrice?: number; maxPrice?: number; minRating?: number };

/** Query key for grouping and duplicate checks: trimmed, single-spaced, lower case. */
export const normQuery = (q: string): string => q.trim().replace(/\s+/g, " ").toLowerCase();
export type WatchStatus = "active" | "paused";

export type Watch = {
  id: number;
  kind: WatchKind;
  site: string | null;
  productId: string | null;
  query: string;
  sites: string[];
  target: number;
  status: WatchStatus;
  lastFiredPrice: number | null;
  title: string | null;
  url: string | null;
  image: string | null;
  currency: string;
  createdAt: number;
  lastCheckedAt: number | null;
  lastPrice: number | null;
  lastCheckStatus: string | null;
  filters: WatchFilters;
};

export type PricePoint = { at: number; price: number };

export type WatchView = Watch & { lowest: number | null; points: PricePoint[] };

export type AlertEvent = {
  id: number;
  watchId: number | null;
  at: number;
  title: string;
  site: string;
  oldPrice: number | null;
  newPrice: number;
  target: number;
  currency: string;
  url: string | null;
  sent: boolean;
  seen: boolean;
};

export const priceOf = (p: Product): number => p.finalPrice ?? p.listPrice;

/** Default alert target: 5% under the price, to the halala. */
export const defaultTarget = (price: number): number => Math.round(price * 0.95 * 100) / 100;

/**
 * The cheapest confident, deliverable match, or null. "Less likely" matches and branch-pickup-only
 * listings never count (no alert fires on them, history does not call them the cheapest).
 */
export function cheapestConfident(products: Product[]): Product | null {
  let best: Product | null = null;
  for (const p of products) {
    if (!isLikelyMatch(p) || p.pickupOnly) continue;
    if (!best || priceOf(p) < priceOf(best)) best = p;
  }
  return best;
}
