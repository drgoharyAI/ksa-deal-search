import type { DatabaseSync } from "node:sqlite";
import brands from "@/data/brands.json";
import synonyms from "@/data/synonyms.json";
import aliases from "@/data/match-aliases.json";
import accessoryWords from "@/data/accessory-words.json";
import partWords from "@/data/part-words.json";
import otherProductWords from "@/data/other-product-words.json";
import curated from "@/data/vocab-words.json";
import { matcherWords } from "@/src/lib/match/group";
import { Speller } from "./spell";

/**
 * The spelling vocabulary (src/lib/query/spell.ts), built locally, no external service:
 * - static: the data/ word lists (brands, synonyms, aliases, accessory, part and product words),
 *   the matcher's own lists (brands, colours, variant and part words) and a curated list of common
 *   product words (data/vocab-words.json);
 * - learnt: the words of product titles seen in searches (seen_products), each title weighted by
 *   its price observations, and the words of the owner's past searches (history).
 * Kept in memory and rebuilt at most every VOCAB_TTL_MS; at most VOCAB_MAX words (static ones always).
 */

export const VOCAB_TTL_MS = 10 * 60_000;
export const VOCAB_MAX = 15_000;
/** A static word's frequency: above a word seen in a handful of titles, below a common one. */
const STATIC_WEIGHT = 5;
/** A word of a past search counts like this many title sightings. */
const QUERY_WEIGHT = 3;
/** A title word must appear in this many products: a word in one title may be that store's typo. */
const MIN_PRODUCTS = 2;

/** What the database contributes: titles seen (with their weight) and past queries. */
export type DbVocab = { titles: { title: string; weight: number }[]; queries: string[] };

const LETTERS = /^[a-z]{2,}$/;
/** Lower-case letters-only words of a text; "-word" (an excluded word) is skipped. */
const words = (s: string): string[] =>
  s
    .toLowerCase()
    .split(/\s+/)
    .filter((w) => !w.startsWith("-"))
    .flatMap((w) => w.split(/[^a-z]+/))
    .filter((w) => LETTERS.test(w));

let staticCache: Map<string, number> | null = null;

/** The static vocabulary: every word of the data/ lists and the matcher's lists. */
export function staticVocab(): Map<string, number> {
  if (staticCache) return staticCache;
  const phrases = [...brands, ...synonyms.flat(), ...aliases.flat(), ...accessoryWords, ...partWords, ...otherProductWords, ...curated, ...matcherWords()];
  staticCache = new Map(phrases.flatMap(words).map((w) => [w, STATIC_WEIGHT]));
  return staticCache;
}

/** The vocabulary: static words plus the learnt ones, the most frequent first up to `max` words. */
export function buildVocab(db: DbVocab, max = VOCAB_MAX): Map<string, number> {
  const freq = new Map<string, number>();
  const products = new Map<string, number>();
  for (const { title, weight } of db.titles) {
    for (const w of new Set(words(title))) {
      freq.set(w, (freq.get(w) ?? 0) + Math.max(1, weight));
      products.set(w, (products.get(w) ?? 0) + 1);
    }
  }
  for (const [w, n] of products) if (n < MIN_PRODUCTS) freq.delete(w);
  for (const q of db.queries) for (const w of words(q)) freq.set(w, (freq.get(w) ?? 0) + QUERY_WEIGHT);

  const out = new Map(staticVocab());
  for (const [w, f] of out) out.set(w, f + (freq.get(w) ?? 0));
  const learnt = [...freq].filter(([w]) => !out.has(w)).sort((a, b) => b[1] - a[1]);
  for (const [w, f] of learnt) {
    if (out.size >= max) break;
    out.set(w, f);
  }
  return out;
}

/** Titles seen (weight 1 + their price observations) and past queries, read only. */
export function readDbVocab(db: DatabaseSync): DbVocab {
  const titles = db
    .prepare(
      `SELECT s.title AS title, 1 + (SELECT count(*) FROM observations o WHERE o.site = s.site AND o.productId = s.productId) AS weight
       FROM seen_products s ORDER BY s.lastSeen DESC LIMIT 20000`,
    )
    .all() as { title: string; weight: number }[];
  const queries = (db.prepare("SELECT DISTINCT query FROM searches ORDER BY id DESC LIMIT 2000").all() as { query: string }[]).map((r) => r.query);
  return { titles: titles.map((t) => ({ title: t.title, weight: t.weight })), queries };
}

/** Closed compounds two typed words may join into: brand and product-line names ("air pods"). */
function joinable(): Set<string> {
  return new Set([...brands, ...matcherWords().filter((w) => brands.includes(w) || w === "dualsense")].filter((w) => /^[a-z]{5,}$/.test(w)));
}

type State = { speller: Speller; builtAt: number };
// On globalThis so the cache and the source survive Next.js dev module reloads.
const g = globalThis as typeof globalThis & { __vocab?: State | null; __vocabSource?: (() => DbVocab | null) | null };

/** Where the learnt words come from (the app's database); null: static words only. */
export function setVocabSource(source: (() => DbVocab | null) | null): void {
  g.__vocabSource = source;
  g.__vocab = null;
}

/** Test helper: forget the built speller. */
export function resetVocab(): void {
  g.__vocab = null;
}

/** The speller over the current vocabulary, rebuilt when older than VOCAB_TTL_MS. */
export function currentSpeller(now = Date.now()): Speller {
  const s = g.__vocab;
  if (s && now - s.builtAt < VOCAB_TTL_MS) return s.speller;
  let db: DbVocab = { titles: [], queries: [] };
  try {
    db = g.__vocabSource?.() ?? db;
  } catch (e) {
    console.warn("[vocab] could not read the learnt words", e instanceof Error ? e.message : String(e));
  }
  const speller = new Speller(buildVocab(db), { joinable: joinable() });
  g.__vocab = { speller, builtAt: now };
  return speller;
}
