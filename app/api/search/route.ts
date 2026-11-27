import { NextResponse } from "next/server";
import { rejectCrossSite } from "@/src/lib/request-guard";
import { runSearch } from "@/src/lib/pipeline";
import { parseQuery } from "@/src/lib/query/parse";
import { sites } from "@/src/sites/registry";
import type { SortKey } from "@/src/lib/rank";
import type { Product } from "@/src/lib/types";
import { getDb } from "@/src/lib/db";
import { addSearch, historyEntryFor } from "@/src/lib/history";
import { ensureChecker } from "@/src/lib/alerts/service";

const SORTS: SortKey[] = ["price", "discount", "deal"];
const EMPTY = { error: "Enter something to search for" };
const MAX_QUERY = 200;
const optNum = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : undefined);

export async function POST(req: Request) {
  const rejected = rejectCrossSite(req, { json: true });
  if (rejected) return rejected;
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json(EMPTY, { status: 400 });
  }
  const query = typeof body?.query === "string" ? body.query : "";
  if (query.length > MAX_QUERY) {
    return NextResponse.json({ error: "Search is too long" }, { status: 400 });
  }
  if (!parseQuery(query).terms) return NextResponse.json(EMPTY, { status: 400 });

  const ids = Array.isArray(body.sites)
    ? [...new Set(body.sites.filter((s): s is string => typeof s === "string" && Object.hasOwn(sites, s)))].slice(
        0,
        Object.keys(sites).length,
      )
    : [];
  if (!ids.length) return NextResponse.json({ error: "Pick at least one store" }, { status: 400 });

  const sort = SORTS.includes(body.sort as SortKey) ? (body.sort as SortKey) : "deal";
  ensureChecker();
  const input = {
    query,
    sites: ids,
    sort,
    minPrice: optNum(body.minPrice),
    maxPrice: optNum(body.maxPrice),
    minRating: optNum(body.minRating),
  };
  const result = await runSearch(input);
  recordHistory(input, result.products);
  return NextResponse.json(result);
}

/** Search history is a convenience: a database failure is logged and never fails the search. */
function recordHistory(input: Parameters<typeof historyEntryFor>[0], products: Product[]) {
  try {
    addSearch(getDb(), historyEntryFor(input, products, Date.now()));
  } catch (e) {
    console.warn("[history] could not record the search", e instanceof Error ? e.message : String(e));
  }
}
