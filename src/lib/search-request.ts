import "server-only";
import { NextResponse } from "next/server";
import { rejectCrossSite } from "@/src/lib/request-guard";
import type { SearchInput } from "@/src/lib/pipeline";
import { parseQuery } from "@/src/lib/query/parse";
import { sites } from "@/src/sites/registry";
import type { SortKey } from "@/src/lib/rank";
import type { Product } from "@/src/lib/types";
import { getDb } from "@/src/lib/db";
import { addSearch, historyEntryFor } from "@/src/lib/history";
import { attachInsights, insightsFor, recordObservations } from "@/src/lib/insights";
import { recordSeen } from "@/src/lib/discover";
import { MAX_JSON_BODY, TOO_LARGE, readJsonCapped } from "@/src/lib/api";

/**
 * Shared by POST /api/search and POST /api/search/stream: the same request guard and input rules,
 * and the same once-per-search records (history, price observations, products seen).
 */

const SORTS: SortKey[] = ["price", "discount", "deal"];
const EMPTY = { error: "Enter something to search for" };
const MAX_QUERY = 200;
const optNum = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : undefined);

/** The search a request asks for, or the error response to send instead. */
export async function readSearchInput(req: Request): Promise<{ input: SearchInput } | { response: Response }> {
  const rejected = rejectCrossSite(req, { json: true });
  if (rejected) return { response: rejected };
  // Read as a stream that stops at the cap: a huge or endless chunked body is never buffered.
  const raw = await readJsonCapped(req, MAX_JSON_BODY);
  if (raw === TOO_LARGE) return { response: NextResponse.json({ error: "The request is too large" }, { status: 413 }) };
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { response: NextResponse.json(EMPTY, { status: 400 }) };
  const body = raw as Record<string, unknown>;
  const query = typeof body?.query === "string" ? body.query : "";
  if (query.length > MAX_QUERY) {
    return { response: NextResponse.json({ error: "Search is too long" }, { status: 400 }) };
  }
  if (!parseQuery(query).terms) return { response: NextResponse.json(EMPTY, { status: 400 }) };

  const ids = Array.isArray(body.sites)
    ? [...new Set(body.sites.filter((s): s is string => typeof s === "string" && Object.hasOwn(sites, s)))].slice(
        0,
        Object.keys(sites).length,
      )
    : [];
  if (!ids.length) return { response: NextResponse.json({ error: "Pick at least one store" }, { status: 400 }) };

  const sort = SORTS.includes(body.sort as SortKey) ? (body.sort as SortKey) : "deal";
  return {
    input: {
      query,
      sites: ids,
      sort,
      minPrice: optNum(body.minPrice),
      maxPrice: optNum(body.maxPrice),
      minRating: optNum(body.minRating),
    },
  };
}

/** Search history is a convenience: a database failure is logged and never fails the search. */
export function recordHistory(input: Parameters<typeof historyEntryFor>[0], products: Product[]) {
  try {
    addSearch(getDb(), historyEntryFor(input, products, Date.now()));
  } catch (e) {
    console.warn("[history] could not record the search", e instanceof Error ? e.message : String(e));
  }
}

/**
 * Deal badges and trends from the observations stored before this search plus the current price.
 * Read-only: the streaming search shows them on every partial result. A database failure is
 * logged and the products come back without insights.
 */
export function readInsights(products: Product[], now = Date.now()): Product[] {
  try {
    return attachInsights(products, insightsFor(getDb(), products, now));
  } catch (e) {
    console.warn("[insights] could not compute deal insights", e instanceof Error ? e.message : String(e));
    return products;
  }
}

/**
 * Records this search's prices and the products seen. Once per search: with its final products,
 * or, for a stream the client left, with the stores answered by then. A database failure is
 * logged and never fails the search.
 */
export function recordProducts(products: Product[], now = Date.now()): void {
  try {
    recordObservations(getDb(), products, now);
  } catch (e) {
    console.warn("[insights] could not record price observations", e instanceof Error ? e.message : String(e));
  }
  try {
    recordSeen(getDb(), products, now);
  } catch (e) {
    console.warn("[discover] could not record the products seen", e instanceof Error ? e.message : String(e));
  }
}

/**
 * Deal badges and trends (readInsights, from the observations stored before this search); then
 * this search's prices and the products seen are recorded (recordProducts).
 */
export function withInsights(products: Product[]): Product[] {
  const now = Date.now();
  const out = readInsights(products, now);
  recordProducts(products, now);
  return out;
}
