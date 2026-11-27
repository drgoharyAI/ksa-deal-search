import type { Product } from "@/src/lib/types";
import { tokenize, tokenForms, hasDigit } from "./tokenize";

function withinOneEdit(a: string, b: string): boolean {
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  if (i === a.length || i === b.length) return true; // differ by trailing char only
  if (a.length === b.length) return a.slice(i + 1) === b.slice(i + 1);
  const [s, l] = a.length < b.length ? [a, b] : [b, a];
  return s.slice(i) === l.slice(i + 1);
}

/** Exact; else (no digits in either token) prefix (query >= 4 chars) or edit distance <= 1 (query >= 5 chars). */
export function tokenMatches(q: string, t: string): boolean {
  if (q === t) return true;
  if (hasDigit(q) || hasDigit(t)) return false;
  if (q.length >= 4 && t.startsWith(q)) return true;
  return q.length >= 5 && withinOneEdit(q, t);
}

/** Query token matches a title token via any hyphen/join/part form on either side. */
export function formsMatch(q: string, t: string): boolean {
  const tf = tokenForms(t);
  return tokenForms(q).some((qf) => tf.some((x) => tokenMatches(qf, x)));
}

const matchesAny = (q: string, titleTokens: string[]) =>
  titleTokens.some((t) => formsMatch(q, t));

const HEAD_WEIGHT = 2;
const BELOW_THRESHOLD = 0.59;

/**
 * Best over variants of (weighted matched query tokens / weighted query tokens), in 0..1.
 * `idf` weights tokens (default 1 each); the last token (head noun) counts double and
 * a variant whose head noun is missing is capped below the default threshold.
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
    let headHit = true;
    variant.forEach((q, i) => {
      const isHead = i === variant.length - 1;
      const w = (idf?.get(q) ?? 1) * (isHead ? HEAD_WEIGHT : 1);
      total += w;
      const m = matchesAny(q, tt);
      if (m) hit += w;
      if (isHead) headHit = m;
    });
    if (total > 0) {
      const score = hit / total;
      best = Math.max(best, headHit ? score : Math.min(score, BELOW_THRESHOLD));
    }
  }
  return best;
}

/** BM25-style idf per query token over the result set, clamped to [1, 2]. */
function buildIdf(titles: string[][], queryTokens: string[][]): Map<string, number> {
  const n = titles.length;
  const idf = new Map<string, number>();
  for (const q of new Set(queryTokens.flat())) {
    const df = titles.filter((tt) => matchesAny(q, tt)).length;
    const raw = Math.log(1 + (n - df + 0.5) / (df + 0.5));
    idf.set(q, Math.min(2, Math.max(1, raw))); // clamp: rarity must not outweigh the head noun
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
