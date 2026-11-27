/**
 * Spec and model-number matching for query tokens that contain digits. Works on the raw title so
 * spacing, hyphens and thousands separators do not matter ("20,000 mAh" = "20000mah",
 * "27-inch" = "27"), and rejects a different model that merely shares the number.
 */

/** Words that, right after a model number, name a different (cheaper) model: "16e", "S24 FE". */
const MODEL_SUFFIX = "(?:e|fe|lite)";
// "\s*(?:-\s*)?", never "\s*-?\s*": two whitespace runs could split the same spaces (quadratic).
const NOT_SUFFIXED = `(?!\\d)(?!\\s*(?:-\\s*)?${MODEL_SUFFIX}(?![a-z0-9]))`;
/** Screen-size units after a bare number: 27", 27'', 27-inch, 27 in. */
const INCH = `(?:\\s*(?:"|''|”|inch(?:es)?\\b|-inch\\b|in\\b))`;

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Lowercase, thousands separators removed ("20,000" -> "20000"). */
export function normalizeTitle(title: string): string {
  return title.toLowerCase().replace(/(\d),(?=\d{3}(?!\d))/g, "$1");
}

/** Compiled patterns kept; the least recently used goes first (the sources hold query tokens). */
export const RE_CACHE_MAX = 500;
const cache = new Map<string, RegExp>();
function re(src: string): RegExp {
  let r = cache.get(src);
  if (r) {
    cache.delete(src); // re-inserted below as the most recently used
  } else {
    // eslint-disable-next-line security/detect-non-literal-regexp -- built from the shopper's query tokens, each escaped (esc), around fixed patterns; kept in a bounded LRU cache
    r = new RegExp(src);
    if (cache.size >= RE_CACHE_MAX) cache.delete(cache.keys().next().value as string);
  }
  cache.set(src, r);
  return r;
}

/** How many patterns are cached now (tests). */
export const reCacheSize = (): number => cache.size;

/**
 * A query token with digits matches the title:
 * - bare number after a word ("iphone 16"): directly after that word ("iPhone 16", "iphone16",
 *   not "iPhone 16e" or "iPhone 6 16GB"), or as a screen size ("27 inch", 27");
 * - number + unit ("100w", "20000mah", "4k"): the number with that unit, spaced or not;
 * - letters + number ("s24", "rtx4070"): that model, not followed by another digit or "fe"/"e".
 */
export function specMatches(q: string, prev: string | undefined, title: string): boolean {
  const t = normalizeTitle(title);
  if (/^\d+(?:\.\d+)?$/.test(q)) {
    const n = esc(q);
    // A size list counts too: "24/27/32 Inch", "24 27 32 34 Inch".
    const sized = re(`(?<![\\d.])${n}(?:\\s*[/,]?\\s*\\d{2}(?:\\.\\d)?)*${INCH}`).test(t);
    if (!prev || /\d/.test(prev)) return sized || re(`(?<![\\w.])${n}(?![\\w.])`).test(t);
    return sized || re(`(?<![a-z0-9])${esc(prev)}\\s*(?:-\\s*)?${n}${NOT_SUFFIXED}`).test(t);
  }
  const unit = q.match(/^(\d+(?:\.\d+)?)([a-z]+)$/);
  if (unit) return re(`(?<![\\d.])${esc(unit[1])}\\s*(?:-\\s*)?${esc(unit[2])}(?![a-z])`).test(t);
  return re(`(?<![a-z0-9])${esc(q)}${NOT_SUFFIXED}`).test(t);
}
