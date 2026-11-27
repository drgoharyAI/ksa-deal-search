import type { Product } from "@/src/lib/types";

/**
 * The one "verifiable discount" rule, shared by the "Only discounted" filter (chips.ts), the
 * result cards and the compare table. Pure and client-safe.
 */

const priceOf = (p: Product): number => p.finalPrice ?? p.listPrice;

/** The struck "was" price: only a store's own earlier price above the current one, same item, same currency. */
export function wasPrice(p: Product): number | null {
  return p.origPrice !== null && Number.isFinite(p.origPrice) && p.origPrice > priceOf(p) ? p.origPrice : null;
}

/**
 * The percent off we may show: the store's "was" price backs it, and our own history has not
 * called the deal fake. The store's own percent wins; otherwise it is worked out from the "was".
 * A store percent with no "was" price is not verifiable, so it gives null.
 */
export function verifiedDiscount(p: Product): number | null {
  const was = wasPrice(p);
  if (was === null || p.deal?.badge === "fake-deal") return null;
  const pct = p.discountPct ?? Math.round((1 - priceOf(p) / was) * 100);
  return pct >= 1 && pct < 100 ? pct : null;
}

/** The product shows a discount we can back (see verifiedDiscount). */
export const hasVerifiedDiscount = (p: Product): boolean => verifiedDiscount(p) !== null;
