import { rejectCrossSite } from "@/src/lib/request-guard";
import { getDb } from "@/src/lib/db";
import { discover } from "@/src/lib/discover";
import { dbFailure, json } from "@/src/lib/api";

// No route segment config (cacheComponents): reading req.url keeps this handler dynamic.

/**
 * GET: up to 8 recently seen products with a price drop or a good deal badge, from the local
 * observations only. Read-only, and it never contacts a store (no alert checker either).
 */
// eslint-disable-next-line @typescript-eslint/require-await -- route handlers share one async Promise<Response> shape (callers and tests await every handler)
export async function GET(req: Request) {
  const rejected = rejectCrossSite(req);
  if (rejected) return rejected;
  try {
    return json({ items: discover(getDb()) });
  } catch (e) {
    return dbFailure(e);
  }
}
