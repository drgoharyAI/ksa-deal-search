import { rejectCrossSite } from "@/src/lib/request-guard";
import { getDb } from "@/src/lib/db";
import { TOO_LARGE, bad, dbFailure, json, readJsonCapped } from "@/src/lib/api";
import { clientKeyOf } from "@/src/lib/gshop/rate";
import { validKanbkamId } from "@/src/lib/kanbkam/links";
import { cachedHistory, kanbkamStatus, lookupHistory, type LookupError } from "@/src/lib/kanbkam/service";

/**
 * Kanbkam price history for one Amazon.sa or noon listing (src/lib/kanbkam/service.ts). Lazy:
 * asked when Details, the compare dialog or a deal's evidence is opened, or for at most 3
 * deal-badged results after a search has rendered. Never part of a search.
 * GET ?site=&id= : the status and the cached history, if any; never fetches.
 * POST { site, id } : looks the listing up (cached 24 h; capped, spaced and backed off).
 * Both pass rejectCrossSite (POST also needs application/json) and the body is read capped.
 */

const MAX_BODY = 1_024;

const STATUS: Record<LookupError, number> = { off: 503, unsupported: 400, unknown: 404, rate: 429, busy: 429, paused: 503, failed: 502 };
const MESSAGES: Record<LookupError, string> = {
  off: "Price history lookups are off",
  unsupported: "Price history is for Amazon.sa and noon listings only",
  unknown: "Search for this product first",
  rate: "Too many price history lookups right now; try again later",
  busy: "Price history lookups are busy; try again in a minute",
  paused: "Price history lookups are paused for a day",
  failed: "Could not load the price history",
};

const valid = (site: unknown, id: unknown): site is string => typeof site === "string" && typeof id === "string" && validKanbkamId(site, id);

// eslint-disable-next-line @typescript-eslint/require-await -- route handlers share one async Promise<Response> shape (callers and tests await every handler)
export async function GET(req: Request) {
  const rejected = rejectCrossSite(req);
  if (rejected) return rejected;
  const params = new URL(req.url).searchParams;
  const site = params.get("site");
  const id = params.get("id");
  if ((site !== null || id !== null) && !valid(site, id)) return bad("Say which listing (?site=&id=)");
  try {
    const deps = { db: getDb() };
    return json({ status: kanbkamStatus(deps), result: site && id ? cachedHistory(deps, site, id) : null });
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
  const { site, id } = body as Record<string, unknown>;
  if (!valid(site, id)) return bad("Say which listing ({ site, id })");
  try {
    const deps = { db: getDb() };
    const answer = await lookupHistory(deps, { site, id: id as string, client: clientKeyOf(req) });
    if (!answer.ok) return json({ error: MESSAGES[answer.error], status: kanbkamStatus(deps) }, STATUS[answer.error]);
    return json({ status: kanbkamStatus(deps), result: answer.result });
  } catch (e) {
    return dbFailure(e);
  }
}
