import type { Product } from "@/src/lib/types";
import { hasDigit, tokenize, tokenizeKeepDigits } from "./tokenize";
import { headNoun } from "./accessory";
import { formsMatch, matchesAllTokens, matchesWithAliases } from "./relevance";

/**
 * Title-structure signals that an item names the product without being it. The evidence is weaker
 * than the filters' (a real product can be titled this way), so these items are ranked after the
 * rest instead of being dropped: recall stays, and the top of the list is the product itself.
 */

/** Words that end a title's own item and start what comes with it. */
const WITH = /\b(?:with|built[-\s]?in)\b/i;

/**
 * The query's product noun appears only after "with / built-in": the item is something else that
 * comes with the product or shows it ("Karaoke Microphone with Built-in Speaker", "Coasters Set,
 * with Pictures of Mouse, Keyboard & Chair").
 */
export function productOnlyAfterWith(title: string, variants: string[][]): boolean {
  const m = title.match(WITH);
  if (!m || m.index === undefined) return false;
  const before = title.slice(0, m.index);
  const tt = tokenizeKeepDigits(before);
  return !variants.some((v) => {
    const head = headNoun(v);
    if (!head) return true;
    if (matchesWithAliases(head, tt)) return true;
    const j = v.indexOf(head); // closed / open compound with the word before ("Airfryer")
    return j > 0 && matchesAllTokens([v.slice(j - 1, j + 1)], before);
  });
}

export function isWeakMatch(title: string, variants: string[][]): boolean {
  return productOnlyAfterWith(title, variants);
}

/** A title word is common in this search when this share of the matching titles has it. */
const COMMON_SHARE = 0.05;
/** Below this typicality a title reads like another kind of item. */
const ATYPICAL = 0.5;
/** Only the cheap tail is judged: below this fraction of the median price of the matches. */
const CHEAP_RATIO = 0.3;
/** Typicality needs enough titles to say what is common. */
const MIN_TITLES = 20;

/**
 * Typicality of each title within the search's matching titles: the mean, over its descriptive
 * words, of min(1, document frequency / (COMMON_SHARE x titles)). Descriptive words exclude the
 * query's words, words with digits (model codes, sizes) and the title's first word (usually the
 * brand), which are rare by nature. Listings of the product share its vocabulary across stores
 * (lightweight, folding, canopy for a stroller); a blanket, a party favour or a fly screen that
 * names the product is made mostly of words no other title uses.
 */
export function typicality(titles: string[], variants: string[][]): number[] {
  const q = variants.flat();
  const words = titles.map((t) => {
    const tt = tokenize(t);
    return [...new Set(tt.filter((w) => w !== tt[0] && !hasDigit(w) && !q.some((x) => formsMatch(x, w))))];
  });
  const df = new Map<string, number>();
  for (const ws of words) for (const w of ws) df.set(w, (df.get(w) ?? 0) + 1);
  const common = COMMON_SHARE * titles.length;
  return words.map((ws) => (ws.length ? ws.reduce((s, w) => s + Math.min(1, df.get(w)! / common), 0) / ws.length : 1));
}

const median = (xs: number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/**
 * Weak matches: the product noun only after "with", or a cheap title (under CHEAP_RATIO x the
 * median price) whose words are atypical for this search. Ranked after the rest, never dropped.
 */
export function markWeakMatches(products: Product[], variants: string[][]): Product[] {
  const typ = products.length >= MIN_TITLES ? typicality(products.map((p) => p.title), variants) : null;
  const cheap = CHEAP_RATIO * (products.length ? median(products.map((p) => p.listPrice)) : 0);
  return products.map((p, i) =>
    isWeakMatch(p.title, variants) || (typ !== null && typ[i] < ATYPICAL && p.listPrice < cheap)
      ? { ...p, weakMatch: true as const }
      : p,
  );
}
