import type { Product } from "@/src/lib/types";
import { isLikelyMatch } from "@/src/lib/rank";
import { isFromPrice } from "@/src/lib/discount";

/** Client-safe shapes and helpers for history and price alerts (no server imports). */

/** `from`: a "from" price (isFromPrice), shown as "from SAR X"; only when no fixed price matched. */
export type CheapestMatch = { title: string; site: string; price: number; currency: string; url: string; from?: true };

export type HistoryEntry = {
  id: number;
  at: number;
  query: string;
  sites: string[];
  sort: string;
  /** noCorrect: the search ran as typed ("Search instead"), without typo correction. */
  filters: { minPrice?: number; maxPrice?: number; minRating?: number; noCorrect?: true };
  resultCount: number;
  cheapest: CheapestMatch | null;
};

export type WatchKind = "product" | "search";

/**
 * A search watch's price and rating filters, as on the search form. `noCorrect`: the watch was saved
 * from a search run as typed ("Search instead"), so its checks skip typo correction too.
 */
export type WatchFilters = { minPrice?: number; maxPrice?: number; minRating?: number; noCorrect?: true };

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
 * listings never count. A fixed price always wins: a "from" price (isFromPrice: a store's cheapest
 * variant) counts only when no fixed price matched, and callers label it "from" (isFromPrice).
 */
export function cheapestConfident(products: Product[]): Product | null {
  let fixed: Product | null = null;
  let from: Product | null = null;
  for (const p of products) {
    if (!isLikelyMatch(p) || p.pickupOnly) continue;
    if (isFromPrice(p)) {
      if (!from || priceOf(p) < priceOf(from)) from = p;
    } else if (!fixed || priceOf(p) < priceOf(fixed)) fixed = p;
  }
  return fixed ?? from;
}
