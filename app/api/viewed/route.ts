import { rejectCrossSite } from "@/src/lib/request-guard";
import { getDb } from "@/src/lib/db";
import { sites } from "@/src/sites/registry";
import { MAX_BODY, clearViewed, listViewed, parseSnapshot, recordView } from "@/src/lib/saved";
import { TOO_LARGE, bad, dbFailure, json, readJsonCapped } from "@/src/lib/api";

const SITE_IDS = new Set(Object.keys(sites));

// No route segment config (cacheComponents): reading req.url keeps these handlers dynamic.

/** GET: the products last opened at their store, newest first (at most 50). */
// eslint-disable-next-line @typescript-eslint/require-await -- route handlers share one async Promise<Response> shape (callers and tests await every handler)
export async function GET(req: Request) {
  const rejected = rejectCrossSite(req);
  if (rejected) return rejected;
  try {
    return json({ items: listViewed(getDb()) });
  } catch (e) {
    return dbFailure(e);
  }
}

/**
 * POST a product snapshot { site, id, title, url, image?, price?, currency? } when the user opens
 * it at its store (sent with keepalive, so it lands even as the tab changes). One row per product.
 */
export async function POST(req: Request) {
  const rejected = rejectCrossSite(req, { json: true });
  if (rejected) return rejected;
  const body = await readJsonCapped(req, MAX_BODY);
  if (body === TOO_LARGE) return bad("The product is too large to record", 413);
  const parsed = parseSnapshot(body, SITE_IDS, { needPrice: false });
  if (!parsed.ok) return bad(parsed.error);
  try {
    recordView(getDb(), parsed.value);
    return json({ ok: true });
  } catch (e) {
    return dbFailure(e);
  }
}

/** DELETE ?all=1 clears the recently viewed list. */
// eslint-disable-next-line @typescript-eslint/require-await -- route handlers share one async Promise<Response> shape (callers and tests await every handler)
export async function DELETE(req: Request) {
  const rejected = rejectCrossSite(req);
  if (rejected) return rejected;
  if (new URL(req.url).searchParams.get("all") !== "1") return bad("Say ?all=1 to clear the recently viewed list");
  try {
    clearViewed(getDb());
    return json({ ok: true });
  } catch (e) {
    return dbFailure(e);
  }
}
