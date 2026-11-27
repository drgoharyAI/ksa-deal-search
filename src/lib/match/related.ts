import type { Product } from "@/src/lib/types";
import { isLikelyMatch } from "@/src/lib/rank";
import { sameProduct, titleFeatures, tokenSimilarity, type TitleFeatures } from "./group";

/**
 * "Other listings like this" (UX phase U5): picked from the results already on screen with the
 * grouping rules (group.ts), never a new store call. Pure and client-safe.
 * - The same product at another store (sameProduct: a shared code, or the same brand and model
 *   words) comes first.
 * - Then close relatives (another size or colour, the next model): token similarity of at least
 *   RELATED_MIN, the same known brand when both titles name one, and both items or both
 *   accessories (a case is never "like" the phone).
 * Ties go to confident matches, then the lower price. Listings in `exclude` (the card's own group
 * rows) are left out, and so is a second listing of the same title at the same store.
 */
export const RELATED_LIMIT = 4;
const RELATED_MIN = 0.4;

const priceOf = (p: Product) => p.finalPrice ?? p.listPrice;
const keyOf = (p: Pick<Product, "site" | "id">) => `${p.site}+${p.id}`;

export function relatedListings(target: Product, pool: Product[], opts: { exclude?: ReadonlySet<string>; limit?: number } = {}): Product[] {
  const cache = new Map<string, TitleFeatures>();
  const features = (title: string) => {
    let f = cache.get(title);
    if (!f) cache.set(title, (f = titleFeatures(title)));
    return f;
  };
  const self = keyOf(target);
  const f = features(target.title);
  const scored: { p: Product; score: number }[] = [];
  const seen = new Set<string>([`${target.site}|${target.title.trim().toLowerCase()}`]);
  for (const p of pool) {
    const key = keyOf(p);
    if (key === self || opts.exclude?.has(key)) continue;
    const g = features(p.title);
    if (f.accessory !== g.accessory) continue;
    if (f.knownBrand && g.knownBrand && f.knownBrand !== g.knownBrand) continue;
    const sim = tokenSimilarity(f, g);
    const score = sameProduct(f, g) ? 1 + sim : sim >= RELATED_MIN ? sim : 0;
    if (score === 0) continue;
    const dupe = `${p.site}|${p.title.trim().toLowerCase()}`;
    if (seen.has(dupe)) continue;
    seen.add(dupe);
    scored.push({ p, score });
  }
  return scored
    .sort(
      (a, b) =>
        b.score - a.score ||
        Number(isLikelyMatch(b.p)) - Number(isLikelyMatch(a.p)) ||
        priceOf(a.p) - priceOf(b.p) ||
        (keyOf(a.p) < keyOf(b.p) ? -1 : 1),
    )
    .slice(0, opts.limit ?? RELATED_LIMIT)
    .map((x) => x.p);
}
