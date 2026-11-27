import type { Product } from "@/src/lib/types";
import { STORES } from "@/src/lib/stores";
import { brandLabel, brandsFor, productKey } from "@/src/lib/specs";
import { storeLabel } from "@/src/lib/stores";

/**
 * Quick filter chips (spec: "Comparison and deal-insight features", item 3). Client-side and
 * pure: they narrow the current results with no new request; rank() and the match tiers apply to
 * what is left. Within a dimension the options are any-of; across dimensions all must hold.
 */

export type ChipFilters = {
  stores: string[];
  brands: string[];
  minPrice?: number;
  maxPrice?: number;
  minRating?: number;
  discounted: boolean;
};

export const NO_FILTERS: ChipFilters = { stores: [], brands: [], discounted: false };

/** The minimum-rating chips after "Any". */
export const RATING_STEPS = [3, 4, 4.5] as const;

type Dim = "stores" | "brands" | "price" | "rating" | "discounted";

/** Per result set: each product's brand, and the stores that rate none of their products. */
export type ChipContext = { brands: Map<string, string | undefined>; ratingless: Set<string> };

export const priceOf = (p: Product): number => p.finalPrice ?? p.listPrice;

/** Shows a discount: a discount percent, or an original price above the price. */
export const isDiscounted = (p: Product): boolean =>
  (p.discountPct ?? 0) >= 1 || (p.origPrice !== null && p.origPrice > priceOf(p));

export function chipContext(products: Product[]): ChipContext {
  const rated = new Set(products.filter((p) => p.rating !== null).map((p) => p.site));
  return { brands: brandsFor(products), ratingless: new Set(products.map((p) => p.site).filter((s) => !rated.has(s))) };
}

export const isActive = (f: ChipFilters): boolean =>
  f.stores.length > 0 || f.brands.length > 0 || f.minPrice !== undefined || f.maxPrice !== undefined ||
  f.minRating !== undefined || f.discounted;

/** The product passes every filter, except the dimension `skip` (for that dimension's counts). */
export function passes(p: Product, f: ChipFilters, ctx: ChipContext, skip?: Dim): boolean {
  if (skip !== "stores" && f.stores.length && !f.stores.includes(p.site)) return false;
  if (skip !== "brands" && f.brands.length) {
    const b = ctx.brands.get(productKey(p));
    if (!b || !f.brands.includes(b)) return false;
  }
  if (skip !== "price") {
    const price = priceOf(p);
    if (f.minPrice !== undefined && price < f.minPrice) return false;
    if (f.maxPrice !== undefined && price > f.maxPrice) return false;
  }
  if (skip !== "rating" && f.minRating !== undefined) {
    if (p.rating === null) {
      if (!ctx.ratingless.has(p.site)) return false;
    } else if (p.rating < f.minRating) return false;
  }
  if (skip !== "discounted" && f.discounted && !isDiscounted(p)) return false;
  return true;
}

export const applyFilters = (products: Product[], f: ChipFilters, ctx: ChipContext): Product[] =>
  products.filter((p) => passes(p, f, ctx));

export type Option = { id: string; count: number };
export type Facets = {
  /** Stores with results (or selected), in the store list's order. */
  stores: Option[];
  /** Brands by their count over all results, then name; selected ones stay even at 0. */
  brands: Option[];
  /** "Any", then each RATING_STEPS minimum (min undefined is "Any"). */
  ratings: { min?: number; count: number }[];
  discounted: number;
  /** Products passing every filter. */
  total: number;
};

/** Live counts: each option counts the products it would show given the other active filters. */
export function facetCounts(products: Product[], f: ChipFilters, ctx: ChipContext): Facets {
  const others = (d: Dim) => products.filter((p) => passes(p, f, ctx, d));

  const order = new Map<string, number>(STORES.map((s, i) => [s.id, i]));
  const storeIds = [...new Set([...products.map((p) => p.site), ...f.stores])].sort(
    (a, b) => (order.get(a) ?? 99) - (order.get(b) ?? 99) || a.localeCompare(b),
  );
  const byStore = tally(others("stores").map((p) => p.site));

  const overall = tally(products.map((p) => ctx.brands.get(productKey(p))).filter((b): b is string => !!b));
  const brandIds = [...new Set([...overall.keys(), ...f.brands])].sort(
    (a, b) => (overall.get(b) ?? 0) - (overall.get(a) ?? 0) || a.localeCompare(b),
  );
  const byBrand = tally(others("brands").map((p) => ctx.brands.get(productKey(p))).filter((b): b is string => !!b));

  const forRating = others("rating");
  const ratings = [undefined, ...RATING_STEPS].map((min) => ({
    min,
    count: min === undefined ? forRating.length : forRating.filter((p) => passes(p, { ...NO_FILTERS, minRating: min }, ctx)).length,
  }));

  return {
    stores: storeIds.map((id) => ({ id, count: byStore.get(id) ?? 0 })),
    brands: brandIds.map((id) => ({ id, count: byBrand.get(id) ?? 0 })),
    ratings,
    discounted: others("discounted").filter(isDiscounted).length,
    total: products.filter((p) => passes(p, f, ctx)).length,
  };
}

function tally(xs: string[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const x of xs) m.set(x, (m.get(x) ?? 0) + 1);
  return m;
}

/** Whole-SAR bounds of the shown prices, for the price slider; null without products. */
export function priceBounds(products: Product[]): { min: number; max: number } | null {
  if (!products.length) return null;
  const prices = products.map(priceOf);
  return { min: Math.floor(Math.min(...prices)), max: Math.ceil(Math.max(...prices)) };
}

/** Query-string keys the chips own; other keys (a History re-run link) are left alone. */
const KEYS = ["store", "brand", "pmin", "pmax", "stars", "disc"] as const;
const STORE_IDS = new Set<string>(STORES.map((s) => s.id));

export function filtersFromSearch(search: string): ChipFilters {
  const p = new URLSearchParams(search);
  const list = (k: string) => (p.get(k) ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const amount = (k: string) => {
    const v = p.get(k);
    const n = v === null || v.trim() === "" ? NaN : Number(v);
    return Number.isFinite(n) && n >= 0 ? n : undefined;
  };
  const stars = Number(p.get("stars"));
  const out: ChipFilters = {
    stores: list("store").filter((s) => STORE_IDS.has(s)),
    brands: list("brand").map((b) => b.toLowerCase()).filter((b) => /^[\p{L}\p{N}&'-]{1,40}$/u.test(b)).slice(0, 50),
    discounted: p.get("disc") === "1",
  };
  const min = amount("pmin");
  const max = amount("pmax");
  if (min !== undefined) out.minPrice = min;
  if (max !== undefined) out.maxPrice = max;
  if ((RATING_STEPS as readonly number[]).includes(stars)) out.minRating = stars;
  return out;
}

/** `search` with the chip keys replaced by `f`'s ("" when nothing is left), leading "?" included. */
export function withChipParams(search: string, f: ChipFilters): string {
  const p = new URLSearchParams(search);
  for (const k of KEYS) p.delete(k);
  if (f.stores.length) p.set("store", f.stores.join(","));
  if (f.brands.length) p.set("brand", f.brands.join(","));
  if (f.minPrice !== undefined) p.set("pmin", String(f.minPrice));
  if (f.maxPrice !== undefined) p.set("pmax", String(f.maxPrice));
  if (f.minRating !== undefined) p.set("stars", String(f.minRating));
  if (f.discounted) p.set("disc", "1");
  const s = p.toString();
  return s ? `?${s}` : "";
}

/** Only the chip keys of `search` (drops a re-run link's own keys once it has been read). */
export function chipParamsOnly(search: string): string {
  return withChipParams("", filtersFromSearch(search));
}

/**
 * Chips for a search about to run. A different query (trimmed, any case) drops the store, brand
 * and price chips, which belong to the old results, and keeps rating and "only discounted"
 * (`kept` names those still on). Without earlier results (first search, a History re-run) the
 * filters stay as they are, so ones read from the URL survive.
 */
export function chipsForNewQuery(
  f: ChipFilters,
  prevQuery: string | undefined,
  nextQuery: string,
): { filters: ChipFilters; kept: ("rating" | "discounted")[] } {
  if (prevQuery === undefined || prevQuery.trim().toLowerCase() === nextQuery.trim().toLowerCase()) return { filters: f, kept: [] };
  const filters: ChipFilters = { ...NO_FILTERS, discounted: f.discounted };
  if (f.minRating !== undefined) filters.minRating = f.minRating;
  const kept: ("rating" | "discounted")[] = [];
  if (f.minRating !== undefined) kept.push("rating");
  if (f.discounted) kept.push("discounted");
  return { filters, kept };
}

/** How many filters are on: each store and brand, plus price, rating and discounted. */
export const activeCount = (f: ChipFilters): number =>
  f.stores.length + f.brands.length + (f.minPrice !== undefined || f.maxPrice !== undefined ? 1 : 0) +
  (f.minRating !== undefined ? 1 : 0) + (f.discounted ? 1 : 0);

const amt = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 2 });

/** The active filters in words, for the folded filter bar ("noon KSA, Apple, from SAR 500"). */
export function activeSummary(f: ChipFilters, currency = "SAR"): string {
  const parts: string[] = [...f.stores.map(storeLabel), ...f.brands.map(brandLabel)];
  if (f.minPrice !== undefined && f.maxPrice !== undefined) parts.push(`${currency} ${amt(f.minPrice)} to ${amt(f.maxPrice)}`);
  else if (f.minPrice !== undefined) parts.push(`from ${currency} ${amt(f.minPrice)}`);
  else if (f.maxPrice !== undefined) parts.push(`up to ${currency} ${amt(f.maxPrice)}`);
  if (f.minRating !== undefined) parts.push(`${f.minRating}+ stars`);
  if (f.discounted) parts.push("discounted");
  return parts.join(", ");
}
