import type { Product } from "@/src/lib/types";
import { tokenizeKeepDigits as tokenize, hasDigit } from "./tokenize";

const VARIANT_WORDS = new Set(["pro", "plus", "max", "ultra", "mini", "lite", "se", "fe", "gps", "cellular", "series", "slim", "edge", "note", "air"]);

/** Near-identical: never when a differing token has a digit (model/capacity) or is a variant word (pro/plus/...); else Jaccard >= 0.85
 *  or exactly one differing word per side (color/variant) with >= 3 shared tokens. */
function similar(a: Set<string>, b: Set<string>): boolean {
  const onlyA = [...a].filter((t) => !b.has(t));
  const onlyB = [...b].filter((t) => !a.has(t));
  if ([...onlyA, ...onlyB].some((t) => hasDigit(t) || VARIANT_WORDS.has(t))) return false;
  const inter = a.size - onlyA.length;
  const union = a.size + onlyB.length;
  if (union === 0 || inter / union >= 0.85) return true;
  return onlyA.length === 1 && onlyB.length === 1 && inter >= 3;
}

/** `p` is the better one to keep: deliverable over branch-pickup-only, then the lower listPrice. */
const keepOver = (p: Product, kept: Product): boolean =>
  !p.pickupOnly !== !kept.pickupOnly ? !p.pickupOnly : p.listPrice < kept.listPrice;

/**
 * Merge near-identical titles (token-set Jaccard >= 0.85); keep one per group: a deliverable
 * listing before a branch-pickup-only one, then the lowest listPrice.
 */
export function dedupe(products: Product[]): Product[] {
  const groups: { head: Set<string>; best: Product }[] = [];
  for (const p of products) {
    const set = new Set(tokenize(p.title));
    const g = groups.find((x) => similar(x.head, set));
    if (!g) groups.push({ head: set, best: p });
    else if (keepOver(p, g.best)) g.best = p;
  }
  return groups.map((g) => g.best);
}

/**
 * dedupe within each store only: the same product at two stores stays two listings, so cross-store
 * grouping (src/lib/match/group.ts) can show a price per store. Kept items stay in input order.
 */
export function dedupeByStore(products: Product[]): Product[] {
  const bySite = new Map<string, Product[]>();
  for (const p of products) bySite.set(p.site, [...(bySite.get(p.site) ?? []), p]);
  const kept = new Set([...bySite.values()].flatMap((ps) => dedupe(ps)));
  return products.filter((p) => kept.has(p));
}
