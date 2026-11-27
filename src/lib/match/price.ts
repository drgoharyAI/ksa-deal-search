import brands from "@/data/brands.json";
import type { Product } from "@/src/lib/types";

const BRANDS = new Set<string>(brands);

/** In a brand query, an item below this fraction of the median price is a clone or a part. */
export const BRAND_PRICE_RATIO = 0.25;

const median = (xs: number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/** True when the query names a known brand ("apple watch", "samsung galaxy s24"). */
export const namesBrand = (queryTokens: string[]) => queryTokens.some((t) => BRANDS.has(t.toLowerCase()));

/**
 * Brand queries only: drop items priced far below the median of the matching items. Unbranded
 * marketplace categories (robot vacuums, smart watches) legitimately span 5 to 5,000 SAR, but a
 * genuine branded product does not sell at a quarter of its usual price: such titles are clones
 * ("Apple Watch Series 10 Smart Watch" at 70 SAR) or parts that slipped past the word rules.
 * Needs a few items so the median means something.
 */
export function dropBrandPriceOutliers(products: Product[], queryTokens: string[], minItems = 5): Product[] {
  if (!namesBrand(queryTokens) || products.length < minItems) return products;
  const cutoff = BRAND_PRICE_RATIO * median(products.map((p) => p.listPrice));
  return products.filter((p) => p.listPrice >= cutoff);
}
