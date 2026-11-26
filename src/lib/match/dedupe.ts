import type { Product } from "@/src/lib/types";
import { tokenize } from "./tokenize";

function jaccard(a: Set<string>, b: Set<string>): number {
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  const union = a.size + b.size - inter;
  return union === 0 ? 1 : inter / union;
}

/** Merge near-identical titles (token-set Jaccard >= 0.85); keep the lowest listPrice per group. */
export function dedupe(products: Product[]): Product[] {
  const groups: { head: Set<string>; best: Product }[] = [];
  for (const p of products) {
    const set = new Set(tokenize(p.title));
    const g = groups.find((x) => jaccard(x.head, set) >= 0.85);
    if (!g) groups.push({ head: set, best: p });
    else if (p.listPrice < g.best.listPrice) g.best = p;
  }
  return groups.map((g) => g.best);
}
