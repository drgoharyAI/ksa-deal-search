import { NextResponse } from "next/server";
import { runSearch } from "@/src/lib/pipeline";
import { ensureChecker } from "@/src/lib/alerts/service";
import { readSearchInput, recordHistory, withInsights } from "@/src/lib/search-request";

export async function POST(req: Request) {
  const read = await readSearchInput(req);
  if ("response" in read) return read.response;
  const { input } = read;
  ensureChecker();
  const result = await runSearch(input);
  // A search where no store answered (all blocked or failed) is not a successful search.
  if (result.statuses.some((s) => s.status === "ok")) recordHistory(input, result.products);
  return NextResponse.json({ ...result, products: withInsights(result.products) });
}
