import words from "@/data/accessory-words.json";
import partWords from "@/data/part-words.json";
import type { Product } from "@/src/lib/types";
import { tokenize } from "./tokenize";
import { formsMatch, matchesWithAliases } from "./relevance";
import { tokenizeKeepDigits, hasDigit } from "./tokenize";

const ACCESSORY = new Set<string>(words);
/** Part nouns that, right after the product noun, name a part of it ("Mouse Pad", "Watch Band"). */
const PART = new Set<string>(partWords);
const CONNECTOR = /\b(?:with|includes?|including|built[-\s]?in)\b|\s[+&]\s/i; // "S24+" is a model, " + " joins items

/** A candidate accessory is priced below this fraction of the median non-candidate price. */
const PRICE_RATIO = 0.4;

/** With no non-candidates, a jump of at least this ratio between consecutive candidate prices splits accessories from products. */
export const GAP_RATIO = 4;

const isAccessoryWord = (t: string) =>
  ACCESSORY.has(t) || (t.endsWith("s") && ACCESSORY.has(t.slice(0, -1)));

/**
 * Title tokens before any "with / + / & / includes / including / built-in". When that part names
 * no query word ("Ps5 Cooling & Dual Controller Charging Station"), the whole title is used.
 */
function coreTokens(title: string, queryTokens: string[] = []): string[] {
  const core = tokenize(title.split(CONNECTOR)[0]);
  if (!queryTokens.length || core.some((t) => queryTokens.some((q) => formsMatch(q, t)))) return core;
  return tokenize(title);
}

/** Accessory words in the title core that the query does not ask for. */
function foreignAccessoryIdx(title: string, queryTokens: string[]): { tt: string[]; idx: number[] } {
  const q = queryTokens.map((t) => t.toLowerCase());
  const tt = coreTokens(title, q);
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

/**
 * Strong: such a word directly followed by "for"/"compatible", or "replacement" (not in the
 * query);
 * or a part noun (data/part-words.json) of them within two tokens after the query's product noun
 * ("Gaming Mouse Pad", "Hair Dryer Folding Diffuser", "Apple Watch Band").
 */
export function isStrongAccessory(title: string, queryTokens: string[], variants: string[][] = []): boolean {
  const { tt, idx } = foreignAccessoryIdx(title, queryTokens);
  if (!idx.length) return false;
  if (idx.some((i) => tt[i] === "replacement" || tt[i + 1] === "for" || tt[i + 1] === "compatible")) return true;
  return variants.some((v) => {
    const head = headNoun(v);
    const j = head ? tt.findIndex((t) => formsMatch(head, t)) : -1;
    return j >= 0 && idx.some((i) => (i === j + 1 || i === j + 2) && PART.has(tt[i]));
  });
}

const FOR_WORDS = new Set(["for", "compatible", "fits", "fit"]);
/** "suitable for school" describes use, not the product the item is made for. */
const USE_WORDS = new Set(["suitable", "ideal", "perfect", "great", "good", "best"]);

/** The product noun of a query variant: its last token without digits (else its last token). */
export function headNoun(variant: string[]): string | undefined {
  return [...variant].reverse().find((t) => !hasDigit(t)) ?? variant[variant.length - 1];
}

/**
 * "Tempered glass for iPhone 16", "Compatible with Galaxy S24 Case", "Thumb grips for PS5
 * controller": the query's product noun first appears after "for"/"compatible", so the item is
 * made for the queried product rather than being it. Checked against every query variant.
 */
export function isForAccessory(title: string, variants: string[][]): boolean {
  const tt = tokenizeKeepDigits(title);
  const f = tt.findIndex((t, i) => FOR_WORDS.has(t) && !USE_WORDS.has(tt[i - 1]));
  if (f < 0) return false;
  // Some sellers open every title with "For ...": then it takes an accessory word as well.
  if (f === 0 && !tt.some((t) => isAccessoryWord(t))) return false;
  const before = tt.slice(0, f);
  return variants.every((v) => {
    const head = headNoun(v);
    return !!head && !matchesWithAliases(head, before);
  });
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
export function dropAccessories(products: Product[], queryTokens: string[], variants: string[][] = [queryTokens]): Product[] {
  const live = products.filter(
    (p) => !isStrongAccessory(p.title, queryTokens, variants) && !isForAccessory(p.title, variants),
  );
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
