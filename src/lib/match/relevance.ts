import type { Product } from "@/src/lib/types";
import { tokenize } from "./tokenize";

function withinOneEdit(a: string, b: string): boolean {
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  if (i === a.length || i === b.length) return true; // differ by trailing char only
  if (a.length === b.length) return a.slice(i + 1) === b.slice(i + 1);
  const [s, l] = a.length < b.length ? [a, b] : [b, a];
  return s.slice(i) === l.slice(i + 1);
}

/** Exact token, prefix (query token >= 4 chars), or edit distance <= 1 (query token >= 5 chars). */
export function tokenMatches(q: string, t: string): boolean {
  if (q === t) return true;
  if (q.length >= 4 && t.startsWith(q)) return true;
  return q.length >= 5 && withinOneEdit(q, t);
}

const matchesAny = (q: string, titleTokens: string[]) =>
  titleTokens.some((t) => tokenMatches(q, t));

/**
 * Best over variants of (weighted matched query tokens / weighted query tokens), in 0..1.
 * `idf` weights tokens (default 1 each).
 */
export function scoreRelevance(
  queryTokens: string[][],
  title: string,
  idf?: Map<string, number>,
): number {
  const tt = tokenize(title);
  let best = 0;
  for (const variant of queryTokens) {
    let total = 0;
    let hit = 0;
    for (const q of variant) {
      const w = idf?.get(q) ?? 1;
      total += w;
      if (matchesAny(q, tt)) hit += w;
    }
    if (total > 0) best = Math.max(best, hit / total);
  }
  return best;
}

/** BM25-style idf per query token over the result set; always > 0, so ratios stay in 0..1. */
function buildIdf(titles: string[][], queryTokens: string[][]): Map<string, number> {
  const n = titles.length;
  const idf = new Map<string, number>();
  for (const q of new Set(queryTokens.flat())) {
    const df = titles.filter((tt) => matchesAny(q, tt)).length;
    idf.set(q, Math.log(1 + (n - df + 0.5) / (df + 0.5)));
  }
  return idf;
}

export function filterRelevant(
  products: Product[],
  queryTokens: string[][],
  threshold = 0.6,
): Product[] {
  if (!products.length) return [];
  const idf = buildIdf(products.map((p) => tokenize(p.title)), queryTokens);
  return products.filter((p) => scoreRelevance(queryTokens, p.title, idf) >= threshold);
}
