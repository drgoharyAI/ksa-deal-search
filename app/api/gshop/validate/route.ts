import { rejectCrossSite } from "@/src/lib/request-guard";
import { getDb } from "@/src/lib/db";
import { sites } from "@/src/sites/registry";
import { TOO_LARGE, bad, dbFailure, json, readJsonCapped } from "@/src/lib/api";
import { cachedCheck, checkProduct, gshopStatus, type CheckError } from "@/src/lib/gshop/service";

/**
 * Google Shopping KSA check (src/lib/gshop/service.ts). On demand only, never on a search.
 * GET ?site=&id= : the status (SerpApi checks left, Google back-off) and the cached result, if
 *   any; never fetches.
 * POST { site, id, auto? } : checks one product seen in a search; `auto` marks an automatic
 *   check (GSHOP_AUTO=1, at most 5 a day).
 * Both pass rejectCrossSite (POST also needs application/json) and the body is read capped.
 */

const SITE_IDS = new Set(Object.keys(sites));
const MAX_BODY = 1_024;

const STATUS: Record<CheckError, number> = { unknown: 404, "no-price": 409, "auto-off": 403, "auto-limit": 429 };
const MESSAGES: Record<CheckError, string> = {
  unknown: "Search for this product first",
  "no-price": "No deliverable price is known for this product",
  "auto-off": "Automatic checks are off",
  "auto-limit": "Today's automatic checks are used up",
};

const validId = (id: unknown): id is string => typeof id === "string" && id.length > 0 && id.length <= 200;

// eslint-disable-next-line @typescript-eslint/require-await -- route handlers share one async Promise<Response> shape (callers and tests await every handler)
export async function GET(req: Request) {
  const rejected = rejectCrossSite(req);
  if (rejected) return rejected;
  const params = new URL(req.url).searchParams;
  const site = params.get("site");
  const id = params.get("id");
  if ((site !== null || id !== null) && (!site || !SITE_IDS.has(site) || !validId(id))) return bad("Say which product (?site=&id=)");
  try {
    const deps = { db: getDb() };
    return json({ status: gshopStatus(deps), result: site && id ? cachedCheck(deps, site, id) : null });
  } catch (e) {
    return dbFailure(e);
  }
}

export async function POST(req: Request) {
  const rejected = rejectCrossSite(req, { json: true });
  if (rejected) return rejected;
  const body = await readJsonCapped(req, MAX_BODY);
  if (body === TOO_LARGE) return bad("The request is too large", 413);
  if (!body || typeof body !== "object" || Array.isArray(body)) return bad("Send { site, id }");
  const { site, id, auto } = body as Record<string, unknown>;
  if (typeof site !== "string" || !SITE_IDS.has(site) || !validId(id)) return bad("Say which product ({ site, id })");
  if (auto !== undefined && typeof auto !== "boolean") return bad("auto must be true or false");
  try {
    const deps = { db: getDb() };
    const answer = await checkProduct(deps, { site, id, auto: auto === true });
    if (!answer.ok) return json({ error: MESSAGES[answer.error], status: gshopStatus(deps) }, STATUS[answer.error]);
    return json({ status: gshopStatus(deps), result: answer.result });
  } catch (e) {
    return dbFailure(e);
  }
}
