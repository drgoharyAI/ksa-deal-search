import type { Product } from "@/src/lib/types";

/**
 * The one store-discount rule, shared by the "Only discounted" filter (chips.ts), the "Highest
 * discount" sort (rank.ts), the result cards and the compare table. Pure and client-safe.
 *
 * It is the STORE's discount: the store's own "was" price against its price. We never call it
 * verified; "verified" is kept for our own history-backed badges (lowest in 30 days, below usual).
 */

const priceOf = (p: Product): number => p.finalPrice ?? p.listPrice;

/** A store percent may differ from the one the prices give by this many points (rounding). */
const PCT_TOLERANCE = 2;

/** The price is a "from" price: the store lists its cheapest variant (AliExpress). */
export const isFromPrice = (p: Pick<Product, "site">): boolean => p.site === "aliexpress";

/** The struck "was" price: only a store's own earlier price above the current one, same item, same currency. */
export function wasPrice(p: Product): number | null {
  return p.origPrice !== null && Number.isFinite(p.origPrice) && p.origPrice > priceOf(p) ? p.origPrice : null;
}

/**
 * The percent off we may show: worked out from the store's "was" price and its price, unless our
 * history called the deal fake. When the store also states a percent, it must agree with the
 * prices within PCT_TOLERANCE points, or nothing is shown. No "was" price: null.
 */
export function storeDiscount(p: Product): number | null {
  const was = wasPrice(p);
  if (was === null || p.deal?.badge === "fake-deal") return null;
  const pct = Math.round((1 - priceOf(p) / was) * 100);
  if (p.discountPct !== null && p.discountPct !== undefined && Math.abs(p.discountPct - pct) > PCT_TOLERANCE) return null;
  return pct >= 1 && pct < 100 ? pct : null;
}

/** The product shows a store discount (see storeDiscount). */
export const hasStoreDiscount = (p: Product): boolean => storeDiscount(p) !== null;
