import type { AaResult } from "./aa";

export type Product = {
  site: string;
  id: string;
  title: string;
  listPrice: number;
  origPrice: number | null;
  discountPct: number | null;
  currency: string;
  rating: number | null;
  /** Set when a rating filter is on but this product's store gives no ratings at all (e.g. Jarir). */
  ratingUnavailable?: true;
  /** Title-structure evidence says this may be another item that names the product; ranked after the rest. */
  weakMatch?: true;
  /** Match confidence 0..1 from the result set (src/lib/match/confidence.ts); below MATCH_THRESHOLD ranks as "less likely". */
  matchScore?: number;
  soldCount: number;
  image: string;
  url: string;
  shipping?: number | null;
  finalPrice?: number;
  /** Deal badge from local price observations (src/lib/insights.ts); absent without enough data. */
  deal?: DealInsight;
  /** Price trend from local price observations; absent without enough data. */
  trend?: PriceTrend;
  /** Set on members of a multi-store group (src/lib/match/group.ts): the group's key. */
  groupKey?: string;
  /** When the store gave this answer (ms); for a cached answer, when it was cached. Set by the pipeline. */
  fetchedAt?: number;
  /** No product-detail calls: every product is "ok" and finalPrice = listPrice. */
  detailStatus: "pending" | "ok" | "failed";
};

export type DealBadge = "fake-deal" | "lowest-30d" | "below-usual" | "normal";

/** `reason`: set on "fake-deal", saying which rule fired. */
export type DealInsight = { badge: DealBadge; label: string; reason?: string };

/**
 * `points`: lowest price per Saudi day over the last 30 days, oldest first; `day` 0 is 29 days ago
 * and 29 is today (today's point is the current price). `changePct7d`: vs about a week ago.
 */
export type PriceTrend = { points: { day: number; price: number }[]; changePct7d?: number };

export type ParsedQuery = {
  terms: string;
  minPrice?: number;
  maxPrice?: number;
  minRating?: number;
  exclude: string[];
};

export type SiteStatus = {
  site: string;
  status: "ok" | "blocked" | "error";
  message?: string;
};

export type SiteAdapter = {
  id: string;
  label: string;
  searchCalls(
    pq: ParsedQuery,
    variants: string[],
  ): { op: string; args: Record<string, string> }[];
  normalizeSearchItem(raw: unknown): Product | null;
  /** Optional custom executor (e.g. Playwright); default is api-anything via aaCall. */
  runCall?(call: { op: string; args: Record<string, string> }): Promise<AaResult>;
};
