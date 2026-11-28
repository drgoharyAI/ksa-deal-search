import "server-only";
import type { Db } from "@/src/lib/db";
import type { Product } from "@/src/lib/types";
import { isFromPrice } from "@/src/lib/discount";
import { cheapestConfident, normQuery, priceOf, type CheapestMatch, type HistoryEntry } from "@/src/lib/alerts/shared";

export const MAX_HISTORY = 500;

type Row = {
  id: number;
  at: number;
  query: string;
  sites: string;
  sort: string;
  filters: string;
  resultCount: number;
  cheapest: string | null;
};

const parse = <T>(s: string | null, fallback: T): T => {
  if (!s) return fallback;
  try {
    return JSON.parse(s) as T;
  } catch {
    return fallback;
  }
};

const toEntry = (r: Row): HistoryEntry => ({
  id: r.id,
  at: r.at,
  query: r.query,
  sites: parse<string[]>(r.sites, []),
  sort: r.sort,
  filters: parse(r.filters, {}),
  resultCount: r.resultCount,
  cheapest: parse<CheapestMatch | null>(r.cheapest, null),
});

/** Records one search and drops the oldest entries past MAX_HISTORY. Returns the new id. */
export function addSearch(db: Db, e: Omit<HistoryEntry, "id">): number {
  const r = db
    .prepare("INSERT INTO searches (at, query, sites, sort, filters, resultCount, cheapest) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .run(e.at, e.query, JSON.stringify(e.sites), e.sort, JSON.stringify(e.filters), e.resultCount, e.cheapest ? JSON.stringify(e.cheapest) : null);
  db.prepare("DELETE FROM searches WHERE id NOT IN (SELECT id FROM searches ORDER BY at DESC, id DESC LIMIT ?)").run(MAX_HISTORY);
  return Number(r.lastInsertRowid);
}

export function listSearches(db: Db, limit = 200): HistoryEntry[] {
  const rows = db.prepare("SELECT * FROM searches ORDER BY at DESC, id DESC LIMIT ?").all(limit) as unknown as Row[];
  return rows.map(toEntry);
}

export function deleteSearch(db: Db, id: number): boolean {
  return Number(db.prepare("DELETE FROM searches WHERE id = ?").run(id).changes) > 0;
}

/**
 * Removes every entry of one query (trimmed, single-spaced, any case: the way the home page's
 * "Search again" lists it once). Returns how many entries went.
 */
export function deleteSearchesByQuery(db: Db, query: string): number {
  const key = normQuery(query);
  if (!key) return 0;
  const rows = db.prepare("SELECT id, query FROM searches").all() as unknown as { id: number; query: string }[];
  const ids = rows.filter((r) => normQuery(r.query) === key).map((r) => r.id);
  const del = db.prepare("DELETE FROM searches WHERE id = ?");
  db.exec("BEGIN");
  try {
    for (const id of ids) del.run(id);
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
  return ids.length;
}

export function clearSearches(db: Db): void {
  db.prepare("DELETE FROM searches").run();
}

/** The history row for one finished search: its inputs, result count and cheapest confident match. */
export function historyEntryFor(
  input: { query: string; sites: string[]; sort: string; minPrice?: number; maxPrice?: number; minRating?: number; noCorrect?: boolean },
  products: Product[],
  at: number,
): Omit<HistoryEntry, "id"> {
  const best = cheapestConfident(products);
  const filters: HistoryEntry["filters"] = {};
  if (input.minPrice !== undefined) filters.minPrice = input.minPrice;
  if (input.maxPrice !== undefined) filters.maxPrice = input.maxPrice;
  if (input.minRating !== undefined) filters.minRating = input.minRating;
  if (input.noCorrect) filters.noCorrect = true; // run as typed: the vocabulary does not learn it
  return {
    at,
    query: input.query.trim(),
    sites: input.sites,
    sort: input.sort,
    filters,
    resultCount: products.length,
    cheapest: best
      ? { title: best.title, site: best.site, price: priceOf(best), currency: best.currency || "SAR", url: best.url, ...(isFromPrice(best) ? { from: true as const } : {}) }
      : null,
  };
}
