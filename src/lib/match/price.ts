import brands from "@/data/brands.json";
import type { Product } from "@/src/lib/types";

const BRANDS = new Set<string>(brands);

/** In a brand query, an item below this fraction of the median price is a clone or a part. */
const BRAND_PRICE_RATIO = 0.25;

const median = (xs: number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/** True when the query names a known brand ("apple watch", "samsung galaxy s24"). */
const namesBrand = (queryTokens: string[]) => queryTokens.some((t) => BRANDS.has(t.toLowerCase()));

/**
 * Brand queries only: price evidence against items priced far below the matching items.
 * - Below BRAND_PRICE_RATIO x the median price, or in the lower group of a TIER_RATIO price split
 *   (tierCutoff), an item may be a clone ("Apple Watch Series 10 Smart Watch" at 70 SAR), a part
 *   or the ecosystem around a product (games and adapters titled with the console's name).
 * - With a model number in the query ("iphone 16", "nintendo switch 2"), every genuine listing is
 *   that one model, so such items are dropped.
 * - Without one ("jbl speaker", "logitech mouse"), the brand's own cheap line (JBL Go, Logitech
 *   M170) is a real product at a real low price, so such items are only demoted (weakMatch, shown
 *   under "Less likely matches"): never removed.
 * Needs a few items so the median means something.
 */
export function applyBrandPriceRules(products: Product[], queryTokens: string[], minItems = 5): Product[] {
  if (!namesBrand(queryTokens) || products.length < minItems) return products;
  const cutoff = BRAND_PRICE_RATIO * median(products.map((p) => p.listPrice));
  const above = products.filter((p) => p.listPrice >= cutoff);
  const tier = tierCutoff(above);
  const floor = tier === null ? cutoff : Math.max(cutoff, tier);
  if (queryTokens.some((t) => /\d/.test(t))) return products.filter((p) => p.listPrice >= floor);
  return products.map((p) => (p.listPrice < floor ? { ...p, weakMatch: true as const } : p));
}

/** Two price tiers this far apart (ratio of their geometric means) are different kinds of item. */
const TIER_RATIO = 4;

/**
 * Price structure of a brand query's matches: the best two-group split of log prices. When the
 * upper group sells at TIER_RATIO x the lower one and is a real market (3+ items, 2+ stores), the
 * lower group is the ecosystem around the product (games, controllers, adapters titled with the
 * console's name) and the upper group is the product. The median rule misses this case because
 * those items outnumber the product. Returns the lowest upper-group price, or null.
 */
export function tierCutoff(products: Product[]): number | null {
  const items = products
    .filter((p) => Number.isFinite(p.listPrice) && p.listPrice > 0)
    .map((p) => ({ x: Math.log(p.listPrice), price: p.listPrice, site: p.site }))
    .sort((a, b) => a.x - b.x);
  const n = items.length;
  if (n < 5) return null;
  const pre = [0];
  const pre2 = [0];
  for (const { x } of items) {
    pre.push(pre[pre.length - 1] + x);
    pre2.push(pre2[pre2.length - 1] + x * x);
  }
  const sse = (i: number, j: number) => {
    const s = pre[j] - pre[i];
    return pre2[j] - pre2[i] - (s * s) / (j - i);
  };
  let best = -1;
  let bestErr = Infinity;
  for (let i = 1; i < n; i++) {
    const e = sse(0, i) + sse(i, n);
    if (e < bestErr) {
      bestErr = e;
      best = i;
    }
  }
  const lo = pre[best] / best;
  const hi = (pre[n] - pre[best]) / (n - best);
  const upper = items.slice(best);
  if (Math.exp(hi - lo) < TIER_RATIO || upper.length < 3 || new Set(upper.map((u) => u.site)).size < 2) return null;
  return items[best].price;
}
