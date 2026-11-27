import type { Product } from "@/src/lib/types";
import { tokenizeKeepDigits } from "./tokenize";
import { headNoun } from "./accessory";
import { matchesAllTokens, matchesWithAliases } from "./relevance";

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

export function markWeakMatches(products: Product[], variants: string[][]): Product[] {
  return products.map((p) => (isWeakMatch(p.title, variants) ? { ...p, weakMatch: true as const } : p));
}
