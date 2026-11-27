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
  /** Only listings our price history backs as a deal ("Lowest in 30 days", "Below usual"). Absent means off. */
  deals?: boolean;
};

export const NO_FILTERS: ChipFilters = { stores: [], brands: [], discounted: false };

/** The minimum-rating chips after "Any". */
const RATING_STEPS = [3, 4, 4.5] as const;

type Dim = "stores" | "brands" | "price" | "rating" | "discounted" | "deals";

/** Per result set: each product's brand, and the stores that rate none of their products. */
export type ChipContext = { brands: Map<string, string | undefined>; ratingless: Set<string> };

const priceOf = (p: Product): number => p.finalPrice ?? p.listPrice;

/** Shows a discount: a discount percent, or an original price above the price. */
export const isDiscounted = (p: Product): boolean =>
  (p.discountPct ?? 0) >= 1 || (p.origPrice !== null && p.origPrice > priceOf(p));

/** A deal our own observations back (src/lib/insights.ts); a "fake deal" or "normal" badge is not one. */
export const isVerifiedDeal = (p: Product): boolean => p.deal?.badge === "lowest-30d" || p.deal?.badge === "below-usual";

export function chipContext(products: Product[]): ChipContext {
  const rated = new Set(products.filter((p) => p.rating !== null).map((p) => p.site));
  return { brands: brandsFor(products), ratingless: new Set(products.map((p) => p.site).filter((s) => !rated.has(s))) };
}

export const isActive = (f: ChipFilters): boolean =>
  f.stores.length > 0 || f.brands.length > 0 || f.minPrice !== undefined || f.maxPrice !== undefined ||
  f.minRating !== undefined || f.discounted || !!f.deals;

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
  if (skip !== "deals" && f.deals && !isVerifiedDeal(p)) return false;
  return true;
}

export const applyFilters = (products: Product[], f: ChipFilters, ctx: ChipContext): Product[] =>
  products.filter((p) => passes(p, f, ctx));

type Option = { id: string; count: number };
export type Facets = {
  /** Stores with results (or selected), in the store list's order. */
  stores: Option[];
  /** Brands by their count over all results, then name; selected ones stay even at 0. */
  brands: Option[];
  /** "Any", then each RATING_STEPS minimum (min undefined is "Any"). */
  ratings: { min?: number; count: number }[];
  discounted: number;
  /** Cards with a verified deal, under the other filters. */
  deals: number;
  /** Cards with at least one rated listing, over all results (no rating filter makes sense at 0). */
  rated: number;
  /** Products passing every filter. */
  total: number;
};

/** Live counts: each option counts the products it would show given the other active filters. */
export const facetCounts = (products: Product[], f: ChipFilters, ctx: ChipContext): Facets =>
  facetCountsFor(products.map((p) => [p]), f, ctx);

/**
 * Live counts over units: a unit is one card (a single product, or a cross-store group's members).
 * A unit counts once for an option when any of its members passing the other filters matches it.
 */
export function facetCountsFor(units: Product[][], f: ChipFilters, ctx: ChipContext): Facets {
  // Each unit's members passing every filter except `d`; units with none drop out.
  const others = (d?: Dim) => units.map((u) => u.filter((p) => passes(p, f, ctx, d))).filter((u) => u.length > 0);
  const brandOf = (p: Product) => ctx.brands.get(productKey(p));
  const each = (us: Product[][], key: (p: Product) => string | undefined) =>
    tally(us.flatMap((u) => [...new Set(u.map(key).filter((k): k is string => !!k))]));

  const order = new Map<string, number>(STORES.map((s, i) => [s.id, i]));
  const storeIds = [...new Set([...units.flat().map((p) => p.site), ...f.stores])].sort(
    (a, b) => (order.get(a) ?? 99) - (order.get(b) ?? 99) || a.localeCompare(b),
  );
  const byStore = each(others("stores"), (p) => p.site);

  const overall = each(units, brandOf);
  const brandIds = [...new Set([...overall.keys(), ...f.brands])].sort(
    (a, b) => (overall.get(b) ?? 0) - (overall.get(a) ?? 0) || a.localeCompare(b),
  );
  const byBrand = each(others("brands"), brandOf);

  const forRating = others("rating");
  const ratings = [undefined, ...RATING_STEPS].map((min) => ({
    min,
    count: min === undefined ? forRating.length : forRating.filter((u) => u.some((p) => passes(p, { ...NO_FILTERS, minRating: min }, ctx))).length,
  }));

  return {
    stores: storeIds.map((id) => ({ id, count: byStore.get(id) ?? 0 })),
    brands: brandIds.map((id) => ({ id, count: byBrand.get(id) ?? 0 })),
    ratings,
    discounted: others("discounted").filter((u) => u.some(isDiscounted)).length,
    deals: others("deals").filter((u) => u.some(isVerifiedDeal)).length,
    rated: units.filter((u) => u.some((p) => p.rating !== null)).length,
    total: others().length,
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
const KEYS = ["store", "brand", "pmin", "pmax", "stars", "disc", "deal"] as const;
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
  if (p.get("deal") === "1") out.deals = true;
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
  if (f.deals) p.set("deal", "1");
  const s = p.toString();
  return s ? `?${s}` : "";
}

/** Only the chip keys of `search` (drops a re-run link's own keys once it has been read). */
export function chipParamsOnly(search: string): string {
  return withChipParams("", filtersFromSearch(search));
}

/** Query-independent filters a new query keeps (named in a note). */
export type KeptChip = "rating" | "discounted" | "deals";

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
): { filters: ChipFilters; kept: KeptChip[] } {
  if (prevQuery === undefined || prevQuery.trim().toLowerCase() === nextQuery.trim().toLowerCase()) return { filters: f, kept: [] };
  const filters: ChipFilters = { ...NO_FILTERS, discounted: f.discounted };
  if (f.minRating !== undefined) filters.minRating = f.minRating;
  if (f.deals) filters.deals = true;
  const kept: KeptChip[] = [];
  if (f.minRating !== undefined) kept.push("rating");
  if (f.discounted) kept.push("discounted");
  if (f.deals) kept.push("deals");
  return { filters, kept };
}

/** How many filters are on: each store and brand, plus price, rating and discounted. */
export const activeCount = (f: ChipFilters): number =>
  f.stores.length + f.brands.length + (f.minPrice !== undefined || f.maxPrice !== undefined ? 1 : 0) +
  (f.minRating !== undefined ? 1 : 0) + (f.discounted ? 1 : 0) + (f.deals ? 1 : 0);

const amt = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 2 });

/** The active filters in words, for the folded filter bar ("noon KSA, Apple, from SAR 500"). */
export function activeSummary(f: ChipFilters, currency = "SAR"): string {
  const parts: string[] = [...f.stores.map(storeLabel), ...f.brands.map(brandLabel)];
  const price = priceWords(f, currency);
  if (price) parts.push(price);
  if (f.minRating !== undefined) parts.push(`${f.minRating}+ stars`);
  if (f.discounted) parts.push("discounted");
  if (f.deals) parts.push("verified deals");
  return parts.join(", ");
}

function priceWords(f: ChipFilters, currency: string): string | null {
  if (f.minPrice !== undefined && f.maxPrice !== undefined) return `${currency} ${amt(f.minPrice)} to ${amt(f.maxPrice)}`;
  if (f.minPrice !== undefined) return `from ${currency} ${amt(f.minPrice)}`;
  if (f.maxPrice !== undefined) return `up to ${currency} ${amt(f.maxPrice)}`;
  return null;
}

/** One removable chip per active filter: its words, and the filters with just that one taken off. */
export type ActiveChip = { key: string; label: string; without: ChipFilters };

export function activeChips(f: ChipFilters, currency = "SAR"): ActiveChip[] {
  const out: ActiveChip[] = [];
  for (const s of f.stores) out.push({ key: `store:${s}`, label: storeLabel(s), without: { ...f, stores: f.stores.filter((x) => x !== s) } });
  for (const b of f.brands) out.push({ key: `brand:${b}`, label: brandLabel(b), without: { ...f, brands: f.brands.filter((x) => x !== b) } });
  const price = priceWords(f, currency);
  if (price) {
    const without = { ...f };
    delete without.minPrice;
    delete without.maxPrice;
    out.push({ key: "price", label: price, without });
  }
  if (f.minRating !== undefined) {
    const without = { ...f };
    delete without.minRating;
    out.push({ key: "rating", label: `${f.minRating}+ stars`, without });
  }
  if (f.discounted) out.push({ key: "discounted", label: "Discounted", without: { ...f, discounted: false } });
  if (f.deals) {
    const without = { ...f };
    delete without.deals;
    out.push({ key: "deals", label: "Verified deals", without });
  }
  return out;
}
