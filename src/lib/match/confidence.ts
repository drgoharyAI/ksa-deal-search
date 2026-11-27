import type { Product } from "@/src/lib/types";
import { hasDigit, tokenize, tokenizeKeepDigits } from "./tokenize";
import { aliasPhrases } from "./aliases";
import { formsMatch } from "./relevance";

/**
 * Match confidence (0..1) for each product that passed the filters: how surely the title is the
 * queried product rather than another item that names it. Computed from the result set itself,
 * with no vocabulary:
 * - resemblance: the title's wording against the listings that sell at the product's usual price.
 *   Junk that names the product (a makeup sponge for "blender", a privacy screen for a tablet) is
 *   cheap and worded like nothing at the typical price;
 * - phrase: the query's words appear together, in order, as a name, when that is how this
 *   search's listings usually write it ("Standing Desk", not "Desk Organizer, Monitor Stand").
 * Weak matches (12e title structure) are capped. Ranking puts the confident tier
 * (score >= MATCH_THRESHOLD, src/lib/rank.ts) first under every sort.
 */

/** Listings priced at least this fraction of the median price of the matches define the product's usual wording. */
export const REFERENCE_PRICE_RATIO = 0.5;
/** Resemblance needs enough titles to say what the product's listings look like. */
export const MIN_TITLES = 10;
/** Weights of the two signals in matchScore. */
export const RESEMBLANCE_WEIGHT = 0.7;
export const PHRASE_WEIGHT = 0.3;
/** Not naming the query as a phrase costs nothing until this share of the titles do. */
export const PHRASE_USUAL = 0.5;
/** A weak match (12e title structure) never scores above this (below MATCH_THRESHOLD in rank.ts). */
export const WEAK_CAP = 0.3;

const median = (xs: number[]): number => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

type Vec = Map<string, number>;

const dot = (a: Vec, b: Vec): number => {
  let s = 0;
  for (const [k, x] of a) {
    const y = b.get(k);
    if (y) s += x * y;
  }
  return s;
};

const normalize = (v: Vec): Vec => {
  const n = Math.sqrt([...v.values()].reduce((s, x) => s + x * x, 0));
  if (n > 0) for (const [k, x] of v) v.set(k, x / n);
  return v;
};

/**
 * Resemblance of each title to the listings at the product's usual price, in 0..1 (1 = at least as
 * close as the median reference listing): TF-IDF cosine to the centroid of the reference listings
 * (priced >= REFERENCE_PRICE_RATIO x the median price), divided by the median reference cosine.
 * Descriptive words exclude query words and words with digits; a word must occur in 2+ titles to
 * add resemblance, so a title of words no other listing uses scores 0. A title with no descriptive
 * words is a plain product name and scores 1. Null when there are too few titles to judge.
 */
export function resemblance(
  products: Pick<Product, "title" | "listPrice">[],
  variants: string[][],
  refRatio = REFERENCE_PRICE_RATIO,
): number[] | null {
  const n = products.length;
  if (n < MIN_TITLES) return null;
  const q = variants.flat();
  const docs = products.map((p) => [...new Set(tokenize(p.title).filter((w) => !hasDigit(w) && !q.some((x) => formsMatch(x, w))))]);
  const df = new Map<string, number>();
  for (const ws of docs) for (const w of ws) df.set(w, (df.get(w) ?? 0) + 1);
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- df counts every word of docs, so each lookup hits
  const vecs = docs.map((ws) => normalize(new Map(ws.filter((w) => df.get(w)! >= 2).map((w) => [w, Math.log((n + 1) / df.get(w)!)]))));

  const cut = refRatio * median(products.map((p) => p.listPrice));
  const ref = products.map((_, i) => i).filter((i) => products[i].listPrice >= cut);
  const centroid: Vec = new Map();
  for (const i of ref) for (const [k, x] of vecs[i]) centroid.set(k, (centroid.get(k) ?? 0) + x / ref.length);
  normalize(centroid);
  const cos = vecs.map((v) => dot(v, centroid));
  const typical = median(ref.filter((i) => vecs[i].size).map((i) => cos[i]));
  if (!(typical > 0)) return null;
  return vecs.map((_, i) => (docs[i].length ? Math.min(1, cos[i] / typical) : 1));
}

/** Title tokens from i that spell the query words w[k..] contiguously (aliases and closed compounds allowed). */
function spells(tt: string[], i: number, w: string[], k: number): boolean {
  if (k === w.length) return true;
  if (i >= tt.length) return false;
  const q = w[k];
  if (formsMatch(q, tt[i]) && spells(tt, i + 1, w, k + 1)) return true;
  if (k + 1 < w.length && formsMatch(q + w[k + 1], tt[i]) && spells(tt, i + 1, w, k + 2)) return true;
  return aliasPhrases(q).some(
    (ph) => ph.every((x, j) => i + j < tt.length && formsMatch(x, tt[i + j])) && spells(tt, i + ph.length, w, k + 1),
  );
}

/**
 * The query's digit-free words appear together and in order in the title, in some variant
 * ("Portable Standing Desk"; "Airfryer" for "air fryer"). One-word queries always pass.
 */
export function namesAsPhrase(title: string, variants: string[][]): boolean {
  const tt = tokenizeKeepDigits(title);
  return variants.some((v) => {
    const w = v.filter((t) => !hasDigit(t));
    return w.length < 2 || tt.some((_, i) => spells(tt, i, w, 0));
  });
}

/**
 * Phrase credit for each title: 1 when it names the query as a phrase; otherwise less the more
 * usual the phrase is in this search. Where sellers mostly write "Standing Desk", a title that
 * never does ("Desk Organizer, Monitor Stand") is unusual; where the words are commonly spread
 * out ("Noise Cancelling Wired Headphones"), not naming the phrase costs nothing.
 */
export function phraseCredit(products: Pick<Product, "title">[], variants: string[][]): number[] {
  const named = products.map((p) => namesAsPhrase(p.title, variants));
  const rate = named.length ? named.filter(Boolean).length / named.length : 1;
  const penalty = Math.max(0, (rate - PHRASE_USUAL) / (1 - PHRASE_USUAL));
  return named.map((n) => (n ? 1 : 1 - penalty));
}

/** Sets Product.matchScore on every product (see the module comment). */
export function scoreMatches(products: Product[], variants: string[][]): Product[] {
  const res = resemblance(products, variants);
  const phrase = phraseCredit(products, variants);
  return products.map((p, i) => {
    const score = RESEMBLANCE_WEIGHT * (res ? res[i] : 1) + PHRASE_WEIGHT * phrase[i];
    // Not rounded: a score just under MATCH_THRESHOLD must stay under it.
    const matchScore = p.weakMatch ? Math.min(score, WEAK_CAP) : score;
    return { ...p, matchScore };
  });
}
