import "server-only";
import { TtlCache } from "./cache";
import { currentSpeller } from "./query/vocab";
import { installDbVocab } from "./vocab-db";

installDbVocab();

/**
 * Search suggestions (autocomplete) from the stores' own public suggestion services. No LLM.
 * Sources run in parallel with a short timeout each; a failing source is ignored. Order of the
 * merge is the order of SOURCES (Amazon first, then Jarir).
 */

const MIN_Q = 2;
const MAX_Q = 80;
const MAX_SUGGESTIONS = 8;
const SOURCE_TIMEOUT_MS = 1500;
export const CACHE_TTL_MS = 5 * 60_000;
export const BACKOFF_MS = 10 * 60_000;

type Source = { id: string; url: (q: string) => string; parse: (data: unknown) => string[] };

const AMAZON_SA_MARKETPLACE = "A17E79C6D8DWNP";
// The same public Constructor.io key and client the Jarir search spec (api-specs/jarir.json) uses.
const JARIR_KEY = "key_KcSYfmQTEwRpBnd9"; // gitleaks:allow (public browser key, see above)

const values = (list: unknown, field = "value"): string[] =>
  Array.isArray(list)
    ? list
        .map((x) => (x && typeof x === "object" ? (x as Record<string, unknown>)[field] : undefined))
        .filter((v): v is string => typeof v === "string")
    : [];

const SOURCES: Source[] = [
  {
    id: "amazon-sa",
    url: (q) =>
      "https://completion.amazon.sa/api/2017/suggestions?" +
      new URLSearchParams({
        mid: AMAZON_SA_MARKETPLACE,
        alias: "aps",
        prefix: q,
        lop: "en_AE",
        "site-variant": "desktop",
        "client-info": "amazon-search-ui",
        "suggestion-type": "KEYWORD",
        limit: "11",
      }).toString(),
    parse: (d) => values((d as { suggestions?: unknown })?.suggestions),
  },
  {
    id: "jarir",
    url: (q) =>
      `https://ac.cnstrc.com/autocomplete/${encodeURIComponent(q)}?` +
      new URLSearchParams({
        key: JARIR_KEY,
        c: "cio-fe-web-jarir",
        "num_results_Search Suggestions": String(MAX_SUGGESTIONS),
        num_results_Products: "0",
      }).toString(),
    parse: (d) => values((d as { sections?: Record<string, unknown> })?.sections?.["Search Suggestions"]),
  },
];

/**
 * Trimmed, single-spaced, lower case and typo-corrected (src/lib/query/spell.ts): the cache key and
 * what the sources are sent. The last word may be unfinished, so a word the vocabulary starts with
 * stays as typed.
 */
const normalizeQuery = (q: string): string =>
  currentSpeller().correct(q.trim().replace(/\s+/g, " ").toLowerCase(), { lastIsPrefix: true }).query;

// Latin letters, digits, punctuation, symbols and spaces only: drops Arabic and other scripts.
const LATIN_ONLY = /^[\p{Script=Latin}\p{N}\p{P}\p{S}\s]+$/u;
export const isEnglish = (s: string): boolean => LATIN_ONLY.test(s);

/** Merge in source order, trim, drop non-Latin items, dedupe case-insensitively, cap at `limit`. */
export function mergeSuggestions(lists: string[][], limit = MAX_SUGGESTIONS): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const list of lists) {
    for (const raw of list) {
      const s = raw.trim().replace(/\s+/g, " ");
      if (!s || !isEnglish(s)) continue;
      const key = s.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(s);
      if (out.length >= limit) return out;
    }
  }
  return out;
}

// On globalThis so cache and back-off survive Next.js dev HMR module reloads.
const g = globalThis as typeof globalThis & {
  __suggestCache?: TtlCache<string[]>;
  __suggestBackoff?: Map<string, number>;
  __suggestInflight?: Map<string, Promise<string[]>>;
};
const cache = (g.__suggestCache ??= new TtlCache<string[]>(CACHE_TTL_MS, { maxEntries: 500 }));
const backoffUntil = (g.__suggestBackoff ??= new Map<string, number>());
const inflight = (g.__suggestInflight ??= new Map<string, Promise<string[]>>());

function backingOff(id: string): boolean {
  const until = backoffUntil.get(id);
  if (until === undefined) return false;
  if (Date.now() < until) return true;
  backoffUntil.delete(id);
  return false;
}

/** One source: its list, or null when it failed, timed out or is backing off. */
async function fetchSource(src: Source, q: string): Promise<string[] | null> {
  if (backingOff(src.id)) return null;
  try {
    const res = await fetch(src.url(q), {
      method: "GET",
      headers: { accept: "application/json" },
      credentials: "omit",
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(SOURCE_TIMEOUT_MS),
    });
    if (res.status === 403 || res.status === 429) {
      backoffUntil.set(src.id, Date.now() + BACKOFF_MS);
      return null;
    }
    if (!res.ok) return null;
    return src.parse(await res.json());
  } catch {
    return null;
  }
}

export async function getSuggestions(rawQ: string): Promise<string[]> {
  const q = normalizeQuery(rawQ);
  if (q.length < MIN_Q || q.length > MAX_Q) return [];
  const hit = cache.get(q);
  if (hit) return hit;
  const pending = inflight.get(q);
  if (pending) return pending;

  const p = (async () => {
    const lists = await Promise.all(SOURCES.map((s) => fetchSource(s, q)));
    const merged = mergeSuggestions(lists.map((l) => l ?? []));
    // Cache only when at least one source answered, so an outage is not remembered for 5 min.
    if (lists.some((l) => l !== null)) cache.set(q, merged);
    return merged;
  })();
  inflight.set(q, p);
  const done = () => {
    if (inflight.get(q) === p) inflight.delete(q);
  };
  p.then(done, done);
  return p;
}

/** Test helper: clear cache, in-flight calls and back-off. */
export function resetSuggest(): void {
  cache.clear();
  backoffUntil.clear();
  inflight.clear();
}
