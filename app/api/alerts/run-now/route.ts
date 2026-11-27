import { rejectCrossSite } from "@/src/lib/request-guard";
import { getChecker } from "@/src/lib/alerts/service";
import { bad, json } from "@/src/lib/api";

/**
 * Development only: runs one checker cycle over every active watch now and answers its report.
 * 404 in production builds. Uses the same lock as the timer, so it never overlaps a cycle.
 */
export async function POST(req: Request) {
  const rejected = rejectCrossSite(req, { json: true });
  if (rejected) return rejected;
  if (process.env.NODE_ENV === "production") return bad("Not found", 404);
  try {
    return json(await getChecker().runNow());
  } catch (e) {
    console.warn("[alerts] run-now failed", e instanceof Error ? e.message : String(e));
    return bad("The check failed", 500);
  }
}
