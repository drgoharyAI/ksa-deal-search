import { rejectCrossSite } from "@/src/lib/request-guard";
import { getDb } from "@/src/lib/db";
import { markEventsSeen } from "@/src/lib/alerts/repo";
import { dbFailure, json } from "@/src/lib/api";

/** Marks every fired alert as seen (the Alerts page calls this when it opens). */
export async function POST(req: Request) {
  const rejected = rejectCrossSite(req, { json: true });
  if (rejected) return rejected;
  try {
    markEventsSeen(getDb());
    return json({ ok: true });
  } catch (e) {
    return dbFailure(e);
  }
}
