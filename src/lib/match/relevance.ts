import type { Product } from "@/src/lib/types";
import { tokenize, tokenizeKeepDigits, tokenForms, hasDigit } from "./tokenize";
import { aliasPhrases } from "./aliases";
import { specMatches } from "./spec";

function withinOneEdit(a: string, b: string): boolean {
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  if (i === a.length || i === b.length) return true; // differ by trailing char only
  if (a.length === b.length) return a.slice(i + 1) === b.slice(i + 1);
  const [s, l] = a.length < b.length ? [a, b] : [b, a];
  return s.slice(i) === l.slice(i + 1);
}

/** Light English stem: drops one common inflection suffix (gaming/gamer/games -> gam). */
function stem(t: string): string {
  const m = t.match(/^(.{3,}?)(?:ation|ing|ers|er|es|ed|s|e)$/);
  const s = m ? m[1] : t;
  return s.replace(/([a-z])$/, "$1"); // cancell -> cancel
}

/** Exact; else (no digits in either token) same stem, prefix (query >= 4 chars) or edit distance <= 1 after the first letter (query >= 5 chars). */
function tokenMatches(q: string, t: string): boolean {
  if (q === t) return true;
  if (hasDigit(q) || hasDigit(t)) return false;
  if (q.length >= 4 && t.startsWith(q)) return true;
  if (q.length >= 4 && t.length >= 4 && stem(q) === stem(t)) return true;
  return q.length >= 5 && q[0] === t[0] && withinOneEdit(q, t); // typos rarely hit the first letter (iphone != phone)
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
  const tt = tokenizeKeepDigits(title);
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

/** The token, or every word of one of its alias phrases, appears in the title. */
export function matchesWithAliases(q: string, tt: string[]): boolean {
  return matchesAny(q, tt) || aliasMatches(q, tt);
}

/** Every word of one of the token's alias phrases appears in the title. */
function aliasMatches(q: string, tt: string[]): boolean {
  return aliasPhrases(q).some((ph) => ph.every((w) => matchesAny(w, tt)));
}

/** Query tokens a variant may leave unmatched: none up to 3 tokens, one non-head token from 4. */
const allowedMisses = (n: number) => (n >= 4 ? 1 : 0);

/**
 * True when some variant matches every query token (all but one non-head token for long queries).
 * Shoppers type the words they need: a missing brand ("apple watch" -> generic watch) or qualifier
 * ("4k monitor" -> FHD monitor) is a different product.
 */
export function matchesAllTokens(queryTokens: string[][], title: string): boolean {
  const tt = tokenizeKeepDigits(title);
  // Compound words are written open or closed: "dash cam" = "Dashcam", "toothbrush" = "Tooth Brush".
  const joinedTitle = tt.slice(1).map((t, k) => tt[k] + t);
  const closed = (a: string | undefined, b: string | undefined) =>
    !!a && !!b && !hasDigit(a) && !hasDigit(b) && matchesAny(a + b, tt);
  return queryTokens.some((variant) => {
    if (!variant.length) return false;
    const misses = variant.filter((q, i) =>
      hasDigit(q)
        ? !specMatches(q, variant[i - 1], title) && !aliasMatches(q, tt)
        : !matchesWithAliases(q, tt) &&
          !closed(variant[i - 1], q) &&
          !closed(q, variant[i + 1]) &&
          !(q.length >= 6 && joinedTitle.includes(q)),
    );
    if (misses.length > allowedMisses(variant.length)) return false;
    return !misses.includes(variant[variant.length - 1]);
  });
}

export function filterRelevant(
  products: Product[],
  queryTokens: string[][],
  threshold = 0.6,
): Product[] {
  if (!products.length) return [];
  const idf = buildIdf(products.map((p) => tokenize(p.title)), queryTokens);
  return products.filter(
    (p) => matchesAllTokens(queryTokens, p.title) && (queryTokens.some((v) => v.length < 4) || scoreRelevance(queryTokens, p.title, idf) >= threshold),
  );
}
