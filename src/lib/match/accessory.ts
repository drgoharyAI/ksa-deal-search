import words from "@/data/accessory-words.json";
import type { Product } from "@/src/lib/types";
import { tokenize } from "./tokenize";
import { formsMatch } from "./relevance";

const ACCESSORY = new Set<string>(words);
const CONNECTOR = /\b(?:with|includes?|including)\b|[+&]/i;

/** A candidate accessory is priced below this fraction of the median non-candidate price. */
const PRICE_RATIO = 0.4;

/** With no non-candidates, a jump of at least this ratio between consecutive candidate prices splits accessories from products. */
export const GAP_RATIO = 4;

const isAccessoryWord = (t: string) =>
  ACCESSORY.has(t) || (t.endsWith("s") && ACCESSORY.has(t.slice(0, -1)));

/** Title tokens before any "with / + / & / includes / including". */
function coreTokens(title: string): string[] {
  return tokenize(title.split(CONNECTOR)[0]);
}

/** Accessory words in the title core that the query does not ask for. */
function foreignAccessoryIdx(title: string, queryTokens: string[]): { tt: string[]; idx: number[] } {
  const q = queryTokens.map((t) => t.toLowerCase());
  const tt = coreTokens(title);
  const idx: number[] = [];
  tt.forEach((t, i) => {
    if (isAccessoryWord(t) && !q.some((x) => formsMatch(x, t))) idx.push(i);
  });
  return { tt, idx };
}

/** Candidate: the title core holds an accessory word the query does not name. Price decides the rest. */
export function isAccessory(title: string, queryTokens: string[]): boolean {
  return foreignAccessoryIdx(title, queryTokens).idx.length > 0;
}

/** Strong: such a word directly followed by "for"/"compatible", or "replacement" (not in the query). */
export function isStrongAccessory(title: string, queryTokens: string[]): boolean {
  const { tt, idx } = foreignAccessoryIdx(title, queryTokens);
  return idx.some((i) => tt[i] === "replacement" || tt[i + 1] === "for" || tt[i + 1] === "compatible");
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** Price just above the widest jump between consecutive valid prices, if that jump is >= GAP_RATIO; else null. */
function gapCutoff(prices: number[]): number | null {
  const s = prices.filter((x) => Number.isFinite(x) && x > 0).sort((a, b) => a - b);
  let best = 1;
  let hi: number | null = null;
  for (let i = 1; i < s.length; i++) {
    const r = s[i] / s[i - 1];
    if (r > best) {
      best = r;
      hi = s[i];
    }
  }
  return best >= GAP_RATIO ? hi : null;
}

/**
 * Drop strong accessories. Then drop candidates priced far below the non-candidates' median.
 * With no non-candidates, drop only the candidates below a >= GAP_RATIO price gap, if one exists.
 */
export function dropAccessories(products: Product[], queryTokens: string[]): Product[] {
  const live = products.filter((p) => !isStrongAccessory(p.title, queryTokens));
  const mains = live.filter((p) => !isAccessory(p.title, queryTokens));
  if (!live.length) return live;
  if (mains.length) {
    const cutoff = PRICE_RATIO * median(mains.map((p) => p.listPrice));
    return live.filter((p) => !isAccessory(p.title, queryTokens) || p.listPrice >= cutoff);
  }
  // No clear main product (their own titles may hold "case"/"band"): split only at a wide price gap.
  const cutoff = gapCutoff(live.map((p) => p.listPrice));
  return cutoff === null ? live : live.filter((p) => p.listPrice >= cutoff);
}
