import { rejectCrossSite } from "@/src/lib/request-guard";
import { getDb } from "@/src/lib/db";
import { sites } from "@/src/sites/registry";
import { MAX_BODY, addFavourite, listFavourites, parseSnapshot, removeFavourite } from "@/src/lib/saved";
import { MAX_SAVED } from "@/src/lib/saved-shared";
import { TOO_LARGE, bad, dbFailure, json, readJsonCapped } from "@/src/lib/api";

const SITE_IDS = new Set(Object.keys(sites));

// No route segment config (cacheComponents): reading req.url keeps these handlers dynamic.

/** GET: the saved products, newest first, each with its latest observed price. */
// eslint-disable-next-line @typescript-eslint/require-await -- route handlers share one async Promise<Response> shape (callers and tests await every handler)
export async function GET(req: Request) {
  const rejected = rejectCrossSite(req);
  if (rejected) return rejected;
  try {
    return json({ items: listFavourites(getDb()) });
  } catch (e) {
    return dbFailure(e);
  }
}

/**
 * POST a product snapshot { site, id, title, url, image?, price, currency?, query? } to save it.
 * Saving one already saved changes nothing (200, `existing`); a new one is 201.
 */
export async function POST(req: Request) {
  const rejected = rejectCrossSite(req, { json: true });
  if (rejected) return rejected;
  const body = await readJsonCapped(req, MAX_BODY);
  if (body === TOO_LARGE) return bad("The product is too large to save", 413);
  const parsed = parseSnapshot(body, SITE_IDS, { needPrice: true });
  if (!parsed.ok) return bad(parsed.error);
  try {
    const v = parsed.value;
    const r = addFavourite(getDb(), { ...v, price: v.price as number });
    if (r === "full") return bad(`You can save up to ${MAX_SAVED} products. Remove one to save another.`, 409);
    return json({ ok: true, existing: r === "exists" }, r === "created" ? 201 : 200);
  } catch (e) {
    return dbFailure(e);
  }
}

/** DELETE ?site=<store>&id=<product id> removes a saved product. */
// eslint-disable-next-line @typescript-eslint/require-await -- route handlers share one async Promise<Response> shape (callers and tests await every handler)
export async function DELETE(req: Request) {
  const rejected = rejectCrossSite(req);
  if (rejected) return rejected;
  const params = new URL(req.url).searchParams;
  const site = params.get("site") ?? "";
  const id = params.get("id") ?? "";
  if (!SITE_IDS.has(site) || !id || id.length > 200) return bad("Say which saved product to remove (?site=&id=)");
  try {
    return removeFavourite(getDb(), site, id) ? json({ ok: true }) : bad("That product is not saved", 404);
  } catch (e) {
    return dbFailure(e);
  }
}
