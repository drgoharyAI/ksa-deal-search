import { rejectCrossSite } from "@/src/lib/request-guard";
import { getDb } from "@/src/lib/db";
import { sites } from "@/src/sites/registry";
import { addPricePoint, createWatch, deleteWatch, findProductWatch, findSearchWatch, getWatch, listWatchViews, updateWatch } from "@/src/lib/alerts/repo";
import { parseId, parseNewWatch, parseWatchUpdate } from "@/src/lib/alerts/validate";
import { ensureChecker } from "@/src/lib/alerts/service";
import { bad, dbFailure, json, readJson } from "@/src/lib/api";

const SITE_IDS = new Set(Object.keys(sites));

// eslint-disable-next-line @typescript-eslint/require-await -- route handlers share one async Promise<Response> shape (callers and tests await every handler)
export async function GET(req: Request) {
  const rejected = rejectCrossSite(req);
  if (rejected) return rejected;
  ensureChecker();
  try {
    return json({ watches: listWatchViews(getDb()) });
  } catch (e) {
    return dbFailure(e);
  }
}

/**
 * Creates a watch. A second product watch on the same store product updates the first one (new
 * target, active, re-armed); a search watch with the same query (normalised), stores and target
 * updates the existing one (its filters, active, re-armed). No duplicates either way.
 */
export async function POST(req: Request) {
  const rejected = rejectCrossSite(req, { json: true });
  if (rejected) return rejected;
  const parsed = parseNewWatch(await readJson(req), SITE_IDS);
  if (!parsed.ok) return bad(parsed.error);
  const w = parsed.value;
  ensureChecker();
  try {
    const db = getDb();
    const now = Date.now();
    const existing =
      w.kind === "product" ? findProductWatch(db, w.site as string, w.productId as string) : findSearchWatch(db, w);
    if (existing) {
      updateWatch(db, existing.id, {
        target: w.target,
        status: "active",
        lastFiredPrice: null,
        ...(w.kind === "search" ? { filters: w.filters ?? {} } : {}),
      });
      return json({ watch: getWatch(db, existing.id), updated: true });
    }
    const id = createWatch(db, w, now);
    if (w.price !== undefined) {
      addPricePoint(db, id, { at: now, price: w.price, url: w.url, title: w.title });
      updateWatch(db, id, { lastPrice: w.price });
    }
    return json({ watch: getWatch(db, id) }, 201);
  } catch (e) {
    return dbFailure(e);
  }
}

/** Changes the target (re-arms the alert) and/or pauses or resumes a watch. */
export async function PATCH(req: Request) {
  const rejected = rejectCrossSite(req, { json: true });
  if (rejected) return rejected;
  const parsed = parseWatchUpdate(await readJson(req));
  if (!parsed.ok) return bad(parsed.error);
  const { id, target, status } = parsed.value;
  try {
    const db = getDb();
    if (!getWatch(db, id)) return bad("No such watch", 404);
    updateWatch(db, id, {
      ...(target !== undefined ? { target, lastFiredPrice: null } : {}),
      ...(status !== undefined ? { status } : {}),
    });
    return json({ watch: getWatch(db, id) });
  } catch (e) {
    return dbFailure(e);
  }
}

// eslint-disable-next-line @typescript-eslint/require-await -- route handlers share one async Promise<Response> shape (callers and tests await every handler)
export async function DELETE(req: Request) {
  const rejected = rejectCrossSite(req);
  if (rejected) return rejected;
  const id = parseId(new URL(req.url).searchParams.get("id"));
  if (id === null) return bad("Say which watch to delete (?id=)");
  try {
    return deleteWatch(getDb(), id) ? json({ ok: true }) : bad("No such watch", 404);
  } catch (e) {
    return dbFailure(e);
  }
}
