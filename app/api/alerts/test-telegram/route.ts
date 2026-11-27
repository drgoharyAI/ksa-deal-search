import { rejectCrossSite } from "@/src/lib/request-guard";
import { sendTelegram } from "@/src/lib/telegram";
import { bad, json } from "@/src/lib/api";

const TEXT = "<b>Deal search</b>\nTest message: price alerts will arrive in this chat.";

/** Sends one test message. Not configured: 400 with a setup hint; the token never leaves the server. */
export async function POST(req: Request) {
  const rejected = rejectCrossSite(req, { json: true });
  if (rejected) return rejected;
  const r = await sendTelegram(TEXT);
  if (r.ok) return json({ ok: true });
  if (r.notConfigured) return bad("Telegram is not set up: add TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID to .env.local and restart the app");
  return bad(r.error, 502);
}
