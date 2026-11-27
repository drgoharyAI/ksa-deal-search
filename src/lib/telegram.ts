import "server-only";

/**
 * Telegram notifications through the Bot API. The token and chat id come only from the server's
 * environment (.env.local: TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID); the token is never logged, never
 * returned in an error and never sent to the browser.
 */
export type TelegramConfig = { token: string; chatId: string };

export function telegramConfig(env: Record<string, string | undefined> = process.env): TelegramConfig | null {
  const token = env.TELEGRAM_BOT_TOKEN?.trim();
  const chatId = env.TELEGRAM_CHAT_ID?.trim();
  return token && chatId ? { token, chatId } : null;
}

export const escapeHtml = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const money = (n: number, currency: string) =>
  `${currency || "SAR"} ${n.toLocaleString("en-US", { minimumFractionDigits: Number.isInteger(n) ? 0 : 2, maximumFractionDigits: 2 })}`;

export type AlertMessage = {
  title: string;
  store: string;
  oldPrice: number | null;
  newPrice: number;
  target: number;
  currency: string;
  url: string | null;
};

/** The alert text in Telegram's HTML parse mode; every dynamic part is escaped. */
export function formatAlertMessage(m: AlertMessage): string {
  const price =
    m.oldPrice !== null && m.oldPrice !== m.newPrice
      ? `${money(m.oldPrice, m.currency)} → ${money(m.newPrice, m.currency)}`
      : money(m.newPrice, m.currency);
  const lines = [
    `<b>Price alert: ${escapeHtml(m.title)}</b>`,
    `Store: ${escapeHtml(m.store)}`,
    `Price: ${escapeHtml(price)}`,
    `Your target: ${escapeHtml(money(m.target, m.currency))}`,
  ];
  if (m.url && /^https?:\/\//i.test(m.url)) lines.push(`<a href="${escapeHtml(m.url)}">Open in the store</a>`);
  return lines.join("\n");
}

export type SendResult = { ok: true } | { ok: false; error: string; notConfigured?: true };

type SendOpts = { env?: Record<string, string | undefined>; fetch?: typeof fetch; timeoutMs?: number };

/** Sends one message. Missing configuration sends nothing and reports notConfigured. */
export async function sendTelegram(text: string, opts: SendOpts = {}): Promise<SendResult> {
  const cfg = telegramConfig(opts.env);
  if (!cfg) return { ok: false, error: "Telegram is not set up", notConfigured: true };
  const doFetch = opts.fetch ?? fetch;
  const scrub = (s: string) => s.split(cfg.token).join("<token>");
  try {
    const res = await doFetch(`https://api.telegram.org/bot${cfg.token}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: cfg.chatId, text, parse_mode: "HTML", disable_web_page_preview: false }),
      signal: AbortSignal.timeout(opts.timeoutMs ?? 10_000),
    });
    if (res.ok) return { ok: true };
    const body = (await res.json().catch(() => null)) as { description?: string } | null;
    return { ok: false, error: scrub(`Telegram answered ${res.status}${body?.description ? `: ${body.description}` : ""}`) };
  } catch (e) {
    const name = e instanceof Error ? e.name : "";
    if (name === "TimeoutError" || name === "AbortError") return { ok: false, error: "Telegram did not answer within 10 seconds" };
    return { ok: false, error: scrub(`Could not reach Telegram: ${e instanceof Error ? e.message : String(e)}`) };
  }
}
