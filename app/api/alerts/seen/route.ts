import { rejectCrossSite } from "@/src/lib/request-guard";
import { getDb } from "@/src/lib/db";
import { markEventsSeen } from "@/src/lib/alerts/repo";
import { bad, dbFailure, json, readJson } from "@/src/lib/api";

/**
 * Marks fired alerts as seen, up to the newest one the Alerts page showed: body { "upTo": id }.
 * An alert that fired after the page loaded stays unread, so the badge cannot miss it.
 */
export async function POST(req: Request) {
  const rejected = rejectCrossSite(req, { json: true });
  if (rejected) return rejected;
  const body = (await readJson(req)) as { upTo?: unknown } | undefined;
  const upTo = body?.upTo;
  if (typeof upTo !== "number" || !Number.isSafeInteger(upTo) || upTo < 0) return bad("Say the newest alert shown (upTo)");
  try {
    markEventsSeen(getDb(), upTo);
    return json({ ok: true });
  } catch (e) {
    return dbFailure(e);
  }
}
