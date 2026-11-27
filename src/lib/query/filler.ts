/**
 * Natural-language filler in a query: words a shopper types ("best", "cheap", "the", "for") that
 * no product title has to contain. Every query word is a required title word in matching
 * (src/lib/match/relevance.ts), so these are taken out of the words used for matching. The store
 * query keeps the shopper's own text: store search engines handle filler themselves.
 */

/** Dropped wherever they appear. Model qualifiers (pro, max, plus, mini, air, go, ultra) are not here. */
const FILLER = new Set([
  "the", "a", "an", "and", "or", "of", "to", "in", "on", "at",
  "best", "cheap", "cheapest", "good", "great", "new", "latest", "original", "genuine", "authentic",
  "deal", "deals", "offer", "offers", "sale", "buy", "find", "need", "want", "some", "please", "my",
]);

/** "X for Y" / "X with Y": Y describes X, so the product noun is the last word before it. */
const LINKS = new Set(["for", "with"]);

/** Filler that is part of a name or a spec and must stay ("new balance", "3 in 1"). */
function isPartOfName(words: string[], i: number): boolean {
  const w = words[i];
  if (w === "new" && words[i + 1] === "balance") return true;
  const digit = (s: string | undefined) => !!s && /^\d+$/.test(s);
  return digit(words[i - 1]) && digit(words[i + 1]); // "3 in 1", "2 and 1"
}

/**
 * The query words matching should require: filler removed, and "X for Y" / "X with Y" rewritten
 * as "Y X" ("earbuds for running" -> "running earbuds", "case for iphone 16" -> "iphone 16 case")
 * so the product noun stays the last (head) word. Returns `terms` unchanged when nothing would be
 * left.
 */
export function matchTerms(terms: string): string {
  const words = terms.toLowerCase().split(/\s+/).filter(Boolean);
  const kept = words.filter((w, i) => !FILLER.has(w) || isPartOfName(words, i));
  const link = kept.findIndex((w) => LINKS.has(w));
  let out = kept;
  if (link >= 0) {
    const core = kept.slice(0, link);
    const extra = kept.slice(link + 1).filter((w) => !LINKS.has(w));
    out = [...extra, ...core];
  }
  return out.length ? out.join(" ") : terms;
}
