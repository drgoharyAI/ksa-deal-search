import { rejectCrossSite } from "@/src/lib/request-guard";
import { getDb } from "@/src/lib/db";
import { clearSearches, deleteSearch, deleteSearchesByQuery, listSearches } from "@/src/lib/history";
import { parseId } from "@/src/lib/alerts/validate";
import { ensureChecker } from "@/src/lib/alerts/service";
import { bad, dbFailure, json } from "@/src/lib/api";

const MAX_QUERY = 200;

// No route segment config (cacheComponents): reading req.url keeps these handlers dynamic.

// eslint-disable-next-line @typescript-eslint/require-await -- route handlers share one async Promise<Response> shape (callers and tests await every handler)
export async function GET(req: Request) {
  const rejected = rejectCrossSite(req);
  if (rejected) return rejected;
  ensureChecker();
  try {
    return json({ items: listSearches(getDb()) });
  } catch (e) {
    return dbFailure(e);
  }
}

/**
 * DELETE ?id=N removes one entry; DELETE ?q=<query> removes every entry of that query (the home
 * page's "Search again" lists a query once); DELETE ?all=1 clears the history.
 */
// eslint-disable-next-line @typescript-eslint/require-await -- route handlers share one async Promise<Response> shape (callers and tests await every handler)
export async function DELETE(req: Request) {
  const rejected = rejectCrossSite(req);
  if (rejected) return rejected;
  const params = new URL(req.url).searchParams;
  const all = params.get("all") === "1";
  const id = parseId(params.get("id"));
  const q = params.get("q");
  if (q !== null && (!q.trim() || q.length > MAX_QUERY)) return bad("Say which search to delete (?q=, up to 200 characters)");
  if (!all && id === null && q === null) return bad("Say which entry to delete (?id=), which search (?q=) or clear all (?all=1)");
  try {
    const db = getDb();
    if (all) {
      clearSearches(db);
      return json({ ok: true });
    }
    if (q !== null) {
      const removed = deleteSearchesByQuery(db, q);
      return removed ? json({ ok: true, removed }) : bad("No such search", 404);
    }
    return deleteSearch(db, id as number) ? json({ ok: true }) : bad("No such entry", 404);
  } catch (e) {
    return dbFailure(e);
  }
}
