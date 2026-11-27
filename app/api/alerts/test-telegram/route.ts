import { rejectCrossSite } from "@/src/lib/request-guard";
import { sendTelegram } from "@/src/lib/telegram";
import { bad, json } from "@/src/lib/api";
import { limiters } from "@/src/lib/limits";

const TEXT = "<b>Deal search</b>\nTest message: price alerts will arrive in this chat.";

/**
 * Sends one test message. Not configured: 400 with a setup hint; the token never leaves the server.
 * At most one send a minute: inside the window, 429 and nothing is sent.
 */
export async function POST(req: Request) {
  const rejected = rejectCrossSite(req, { json: true });
  if (rejected) return rejected;
  // One test message a minute (owner ruling: safety caps).
  if (!limiters.telegramTest.take("test")) return bad("Wait a minute before sending another test", 429);
  const r = await sendTelegram(TEXT);
  if (r.ok) return json({ ok: true });
  if (r.notConfigured) {
    limiters.telegramTest.release("test"); // nothing was sent
    return bad("Telegram is not set up: add TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID to .env.local and restart the app");
  }
  return bad(r.error, 502);
}
