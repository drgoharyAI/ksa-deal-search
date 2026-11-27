import { describe, expect, it, vi } from "vitest";
import { escapeHtml, formatAlertMessage, sendTelegram, telegramConfig } from "@/src/lib/telegram";

const ENV = { TELEGRAM_BOT_TOKEN: "123:SECRET", TELEGRAM_CHAT_ID: "42" };

describe("telegram formatting", () => {
  it("escapes HTML in every dynamic part", () => {
    expect(escapeHtml(`a<b>&"c"`)).toBe("a&lt;b&gt;&amp;&quot;c&quot;");
    const text = formatAlertMessage({
      title: "Kids <script> & \"toys\"",
      store: "Amazon KSA",
      oldPrice: 500,
      newPrice: 449.5,
      target: 450,
      currency: "SAR",
      url: "https://amazon.sa/dp/B0?x=1&y=\"2\"",
    });
    expect(text).toContain("<b>Price alert: Kids &lt;script&gt; &amp; &quot;toys&quot;</b>");
    expect(text).toContain("Store: Amazon KSA");
    expect(text).toContain("Price: SAR 500 → SAR 449.50");
    expect(text).toContain("Your target: SAR 450");
    expect(text).toContain('<a href="https://amazon.sa/dp/B0?x=1&amp;y=&quot;2&quot;">Open in the store</a>');
  });
  it("shows one price when there is no old price and drops a non-http link", () => {
    const text = formatAlertMessage({ title: "T", store: "Jarir", oldPrice: null, newPrice: 10, target: 12, currency: "SAR", url: "javascript:alert(1)" });
    expect(text).toContain("Price: SAR 10");
    expect(text).not.toContain("→");
    expect(text).not.toContain("href");
  });
});

describe("sendTelegram", () => {
  it("reads config only when both env values are set", () => {
    expect(telegramConfig({})).toBeNull();
    expect(telegramConfig({ TELEGRAM_BOT_TOKEN: "x" })).toBeNull();
    expect(telegramConfig(ENV)).toEqual({ token: "123:SECRET", chatId: "42" });
  });
  it("sends nothing when not configured", async () => {
    const f = vi.fn();
    const r = await sendTelegram("hi", { env: {}, fetch: f as unknown as typeof fetch });
    expect(r).toEqual({ ok: false, error: "Telegram is not set up", notConfigured: true });
    expect(f).not.toHaveBeenCalled();
  });
  it("posts chat_id, text, HTML parse mode and link preview on", async () => {
    const f = vi.fn(async () => new Response("{}", { status: 200 }));
    const r = await sendTelegram("<b>x</b>", { env: ENV, fetch: f as unknown as typeof fetch });
    expect(r).toEqual({ ok: true });
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.telegram.org/bot123:SECRET/sendMessage");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({ chat_id: "42", text: "<b>x</b>", parse_mode: "HTML", disable_web_page_preview: false });
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });
  it("never puts the token in an error", async () => {
    const fail = vi.fn(async () => {
      throw new Error("connect failed to https://api.telegram.org/bot123:SECRET/sendMessage");
    });
    const r = await sendTelegram("x", { env: ENV, fetch: fail as unknown as typeof fetch });
    expect(r.ok).toBe(false);
    expect(JSON.stringify(r)).not.toContain("SECRET");
    const bad = vi.fn(async () => new Response(JSON.stringify({ description: "Unauthorized 123:SECRET" }), { status: 401 }));
    const r2 = await sendTelegram("x", { env: ENV, fetch: bad as unknown as typeof fetch });
    expect(r2).toMatchObject({ ok: false });
    expect(JSON.stringify(r2)).not.toContain("SECRET");
    expect(JSON.stringify(r2)).toContain("401");
  });
  it("reports a timeout", async () => {
    const slow = vi.fn((_u: string, init: RequestInit) => new Promise<Response>((_, rej) => init.signal?.addEventListener("abort", () => rej(init.signal?.reason))));
    const r = await sendTelegram("x", { env: ENV, fetch: slow as unknown as typeof fetch, timeoutMs: 20 });
    expect(r).toEqual({ ok: false, error: "Telegram did not answer within 10 seconds" });
  });
});
