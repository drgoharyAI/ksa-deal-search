import type { Product } from "@/src/lib/types";
import { isFromPrice, storeDiscount } from "@/src/lib/discount";

export type SortKey = "price" | "discount" | "deal";

const priceOf = (p: Product) => p.finalPrice ?? p.listPrice;

/** Products whose matchScore (src/lib/match/confidence.ts) reaches this form the confident tier. */
export const MATCH_THRESHOLD = 0.6;

/**
 * Confident match: not a weak match, and a matchScore (when the pipeline set one) at or above
 * MATCH_THRESHOLD. Products without a score count as confident unless weak.
 */
export const isLikelyMatch = (p: Product): boolean =>
  !p.weakMatch && (p.matchScore === undefined || p.matchScore >= MATCH_THRESHOLD);

export function dealScore(p: Product, minPrice: number, maxPrice: number): number {
  const range = maxPrice - minPrice || 1;
  const price = 1 - (priceOf(p) - minPrice) / range;
  // The shared store-discount rule (discount.ts): a bare or contradicted store percent counts as 0.
  const discount = (storeDiscount(p) ?? 0) / 100;
  const rating = (p.rating ?? 0) / 5;
  const sold = Math.min(1, Math.log10(p.soldCount + 1) / 5);
  return 0.4 * price + 0.3 * discount + 0.2 * rating + 0.1 * sold;
}

/**
 * Tiered and stable (Array.prototype.sort is stable); never mutates the input. Confident matches
 * come first, then the less likely ones (low matchScore), then weak matches; each tier is sorted
 * by the chosen key, deliverable listings before branch-pickup-only ones (so cheapest-first starts
 * with the cheapest deliverable listing). In the price sort, "from" prices (isFromPrice: a store's
 * cheapest variant) come after the fixed prices of their part, so they never pass as the cheapest.
 * Pure and client-safe: the UI re-ranks with it when the sort changes, and a group's lead row is
 * its first member under it.
 */
export function rank(products: Product[], sort: SortKey): Product[] {
  const confident = products.filter(isLikelyMatch);
  const doubtful = products.filter((p) => !isLikelyMatch(p) && !p.weakMatch);
  const weak = products.filter((p) => p.weakMatch);
  const fixedFirst = (part: Product[]): Product[] =>
    sort === "price"
      ? [...sortTier(part.filter((p) => !isFromPrice(p)), sort), ...sortTier(part.filter(isFromPrice), sort)]
      : sortTier(part, sort);
  return [confident, doubtful, weak].flatMap((tier) => [
    ...fixedFirst(tier.filter((p) => !p.pickupOnly)),
    ...fixedFirst(tier.filter((p) => p.pickupOnly)),
  ]);
}

const sortTier = (tier: Product[], sort: SortKey): Product[] => (tier.length ? sortBy(tier, sort) : []);

function sortBy(products: Product[], sort: SortKey): Product[] {
  const out = [...products];
  if (sort === "price") return out.sort((a, b) => priceOf(a) - priceOf(b));
  // The shared store-discount rule (discount.ts): a bare or contradicted store percent counts as 0.
  if (sort === "discount") return out.sort((a, b) => (storeDiscount(b) ?? 0) - (storeDiscount(a) ?? 0));
  const prices = out.map(priceOf);
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const score = new Map(out.map((p) => [p, dealScore(p, min, max)]));
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- score has an entry for every item of out (built from out above)
  return out.sort((a, b) => score.get(b)! - score.get(a)!);
}
