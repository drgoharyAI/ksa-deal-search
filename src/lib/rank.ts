import type { Product } from "@/src/lib/types";

export type SortKey = "price" | "discount" | "deal";

const priceOf = (p: Product) => p.finalPrice ?? p.listPrice;

export function dealScore(p: Product, minPrice: number, maxPrice: number): number {
  const range = maxPrice - minPrice || 1;
  const price = 1 - (priceOf(p) - minPrice) / range;
  const discount = (p.discountPct ?? 0) / 100;
  const rating = (p.rating ?? 0) / 5;
  const sold = Math.min(1, Math.log10(p.soldCount + 1) / 5);
  return 0.4 * price + 0.3 * discount + 0.2 * rating + 0.1 * sold;
}

/** Stable (Array.prototype.sort is stable); never mutates the input. */
export function rank(products: Product[], sort: SortKey): Product[] {
  const out = [...products];
  if (sort === "price") return out.sort((a, b) => priceOf(a) - priceOf(b));
  if (sort === "discount") return out.sort((a, b) => (b.discountPct ?? 0) - (a.discountPct ?? 0));
  const prices = out.map(priceOf);
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const score = new Map(out.map((p) => [p, dealScore(p, min, max)]));
  return out.sort((a, b) => score.get(b)! - score.get(a)!);
}
