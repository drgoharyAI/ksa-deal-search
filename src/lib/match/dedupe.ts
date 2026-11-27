import type { Product } from "@/src/lib/types";
import { tokenizeKeepDigits as tokenize, hasDigit } from "./tokenize";

/** Near-identical: never when a differing token has a digit (model/capacity); else Jaccard >= 0.85
 *  or exactly one differing word per side (color/variant) with >= 3 shared tokens. */
function similar(a: Set<string>, b: Set<string>): boolean {
  const onlyA = [...a].filter((t) => !b.has(t));
  const onlyB = [...b].filter((t) => !a.has(t));
  if ([...onlyA, ...onlyB].some(hasDigit)) return false;
  const inter = a.size - onlyA.length;
  const union = a.size + onlyB.length;
  if (union === 0 || inter / union >= 0.85) return true;
  return onlyA.length === 1 && onlyB.length === 1 && inter >= 3;
}

/** Merge near-identical titles (token-set Jaccard >= 0.85); keep the lowest listPrice per group. */
export function dedupe(products: Product[]): Product[] {
  const groups: { head: Set<string>; best: Product }[] = [];
  for (const p of products) {
    const set = new Set(tokenize(p.title));
    const g = groups.find((x) => similar(x.head, set));
    if (!g) groups.push({ head: set, best: p });
    else if (p.listPrice < g.best.listPrice) g.best = p;
  }
  return groups.map((g) => g.best);
}
