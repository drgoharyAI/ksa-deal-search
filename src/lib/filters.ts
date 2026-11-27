import type { Product } from "@/src/lib/types";
import { tokenizeKeepDigits } from "@/src/lib/match/tokenize";

/**
 * The search's per-product filter predicates, shared by the pipeline and the eval metrics so
 * "eligible under the query's own filters" means exactly what the pipeline does.
 */

export type PriceRatingFilters = { minPrice?: number; maxPrice?: number; minRating?: number };

const isNum = (n: number | undefined): n is number => typeof n === "number" && Number.isFinite(n);

export const hasValidPrice = (p: Product): boolean => Number.isFinite(p.listPrice) && p.listPrice > 0;

/**
 * A "-word" exclusion: the word is a whole title word (case-insensitive), a part of a hyphenated
 * one ("pro-max"), or its plural. Never a substring: "-pro" must keep "Waterproof", "-case"
 * must keep "Showcase".
 */
export function isExcluded(p: Product, exclude: string[]): boolean {
  if (!exclude.length) return false;
  const words = new Set(tokenizeKeepDigits(p.title).flatMap((t) => [t, ...t.split("-")]));
  return exclude.some((raw) => {
    const w = raw.toLowerCase();
    return words.has(w) || words.has(`${w}s`) || words.has(`${w}es`);
  });
}

/**
 * Price bounds apply to listPrice. With a rating minimum, a product without a rating passes only
 * when its store is ratingless (gives no rating for any product in this search, e.g. Jarir).
 */
export function passesPriceRating(p: Product, f: PriceRatingFilters, ratingless: Set<string>): boolean {
  if (isNum(f.minPrice) && p.listPrice < f.minPrice) return false;
  if (isNum(f.maxPrice) && p.listPrice > f.maxPrice) return false;
  if (isNum(f.minRating) && p.rating === null) return ratingless.has(p.site);
  if (isNum(f.minRating) && p.rating !== null && p.rating < f.minRating) return false;
  return true;
}

/** Stores whose whole (non-empty) result carries no rating. */
export function ratinglessSites(perSite: { site: string; products: Product[] }[]): Set<string> {
  return new Set(
    perSite.filter((o) => o.products.length && o.products.every((p) => p.rating === null)).map((o) => o.site),
  );
}
