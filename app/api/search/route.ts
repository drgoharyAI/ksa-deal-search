import { NextResponse } from "next/server";
import { runSearch } from "@/src/lib/pipeline";
import { ensureChecker } from "@/src/lib/alerts/service";
import { readSearchInput, recordHistory, withInsights } from "@/src/lib/search-request";
import { busyResponse, searchGate } from "@/src/lib/search-gate";

export async function POST(req: Request) {
  const read = await readSearchInput(req);
  if ("response" in read) return read.response;
  const { input } = read;
  ensureChecker();
  // At most 4 searches at once and 8 waiting (owner ruling: safety caps); past that, 503.
  const release = await searchGate().acquire("user", req.signal);
  if (!release) return busyResponse();
  let result: Awaited<ReturnType<typeof runSearch>>;
  try {
    // The client going away aborts the store calls still queued (as the streaming search does).
    result = await runSearch(input, { signal: req.signal });
  } finally {
    release();
  }
  // A search where no store answered (all blocked or failed) is not a successful search.
  if (result.statuses.some((s) => s.status === "ok")) recordHistory(input, result.products);
  return NextResponse.json({ ...result, products: withInsights(result.products) });
}
