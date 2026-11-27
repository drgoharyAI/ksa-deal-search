import { rejectCrossSite } from "@/src/lib/request-guard";
import { getDb } from "@/src/lib/db";
import { listEvents, unreadCount } from "@/src/lib/alerts/repo";
import { telegramConfig } from "@/src/lib/telegram";
import { ensureChecker } from "@/src/lib/alerts/service";
import { dbFailure, json } from "@/src/lib/api";

/** The fired-alert log, the unread count (header badge) and whether Telegram is set up (never the token). */
// eslint-disable-next-line @typescript-eslint/require-await -- route handlers share one async Promise<Response> shape (callers and tests await every handler)
export async function GET(req: Request) {
  const rejected = rejectCrossSite(req);
  if (rejected) return rejected;
  ensureChecker();
  const telegram = { configured: telegramConfig() !== null };
  try {
    const db = getDb();
    return json({ events: listEvents(db), unread: unreadCount(db), telegram });
  } catch (e) {
    return dbFailure(e);
  }
}
