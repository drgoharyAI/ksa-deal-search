import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const callMock = vi.fn();
vi.mock("api-anything", () => ({ call: (...a: unknown[]) => callMock(...a) }));

import { aaCall, resetBackoff, BACKOFF_MS } from "@/src/lib/aa";

const opts = { ttlMs: 60_000, lane: "search" as const };
let n = 0;
const uniq = () => ({ q: `x${n++}` }); // fresh cache key per test

beforeEach(() => {
  callMock.mockReset();
  resetBackoff();
});

describe("aaCall", () => {
  it("caches ok results", async () => {
    callMock.mockResolvedValue({ ok: true, class: "ok", tier: 1, data: { items: [1] } });
    const args = uniq();
    const a = await aaCall("s", "search", args, opts);
    const b = await aaCall("s", "search", args, opts);
    expect(a).toEqual({ ok: true, tier: 1, data: { items: [1] } });
    expect(b).toEqual(a);
    expect(callMock).toHaveBeenCalledTimes(1);
  });

  it("passes view.maxChars 200000, maxTier 1 and callOnly (no runtime heal) to call()", async () => {
    callMock.mockResolvedValue({ ok: true, class: "ok", tier: 1, data: 1 });
    await aaCall("s", "search", uniq(), opts);
    expect(callMock.mock.calls[0][3]).toEqual({
      view: { maxChars: 200000 },
      maxTier: 1,
      callOnly: true,
    });
  });

  it("does not retry drift (anti-bot page) and returns its class", async () => {
    callMock.mockResolvedValue({ ok: false, class: "drift", reason: "embedded data not found", retry: "no" });
    const r = await aaCall("s", "search", uniq(), opts);
    expect(r).toEqual({ ok: false, class: "drift", reason: "embedded data not found" });
    expect(callMock).toHaveBeenCalledTimes(1);
  });

  it("does not cache failures", async () => {
    callMock.mockResolvedValue({ ok: false, class: "error", reason: "boom", retry: "no" });
    const args = uniq();
    const a = await aaCall("s", "search", args, opts);
    await aaCall("s", "search", args, opts);
    expect(a).toEqual({ ok: false, class: "error", reason: "boom" });
    expect(callMock).toHaveBeenCalledTimes(2);
  });

  it("returns {ok:false, class:'blocked'} unchanged and does not retry it", async () => {
    callMock.mockResolvedValue({ ok: false, class: "blocked", reason: "captcha", retry: "safe" });
    const r = await aaCall("s", "search", uniq(), opts);
    expect(r).toEqual({ ok: false, class: "blocked", reason: "captcha" });
    expect(callMock).toHaveBeenCalledTimes(1);
  });

  it("does not retry rate-limit class", async () => {
    callMock.mockResolvedValue({ ok: false, class: "rate", reason: "slow", retry: "after_wait" });
    const r = await aaCall("s", "search", uniq(), opts);
    expect(r).toMatchObject({ ok: false, class: "rate" });
    expect(callMock).toHaveBeenCalledTimes(1);
  });

  it("retries retry-safe errors, then succeeds", async () => {
    callMock
      .mockResolvedValueOnce({ ok: false, class: "error", reason: "5xx", retry: "safe" })
      .mockResolvedValueOnce({ ok: false, class: "error", reason: "5xx", retry: "safe" })
      .mockResolvedValueOnce({ ok: true, class: "ok", tier: 1, data: "yes" });
    const r = await aaCall("s", "search", uniq(), opts);
    expect(r).toEqual({ ok: true, tier: 1, data: "yes" });
    expect(callMock).toHaveBeenCalledTimes(3);
  });

  it("gives up after 2 retries", async () => {
    callMock.mockResolvedValue({ ok: false, class: "error", reason: "5xx", retry: "safe" });
    const r = await aaCall("s", "search", uniq(), opts);
    expect(r.ok).toBe(false);
    expect(callMock).toHaveBeenCalledTimes(3);
  });
});

describe("aaCall in-flight sharing", () => {
  it("concurrent identical calls make one upstream call", async () => {
    callMock.mockImplementation(
      () => new Promise((r) => setTimeout(() => r({ ok: true, class: "ok", tier: 1, data: 7 }), 20)),
    );
    const args = uniq();
    const [a, b] = await Promise.all([
      aaCall("s", "search", args, opts),
      aaCall("s", "search", args, opts),
    ]);
    expect(a).toEqual(b);
    expect(callMock).toHaveBeenCalledTimes(1);
  });
});

describe("aaCall per-store back-off", () => {
  afterEach(() => vi.useRealTimers());

  it.each(["blocked", "rate", "drift"])("after %s, skips the store for 10 minutes", async (cls) => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-27T10:00:00Z"));
    callMock.mockResolvedValueOnce({ ok: false, class: cls, reason: "anti-bot", retry: "no" });
    await aaCall("bk", "search", uniq(), opts);
    expect(callMock).toHaveBeenCalledTimes(1);

    callMock.mockResolvedValue({ ok: true, class: "ok", tier: 1, data: 1 });
    const r = await aaCall("bk", "search", uniq(), opts);
    expect(r).toMatchObject({ ok: false, class: "blocked" });
    expect(callMock).toHaveBeenCalledTimes(1); // nothing sent

    // other stores are unaffected
    expect(await aaCall("other", "search", uniq(), opts)).toMatchObject({ ok: true });
    expect(callMock).toHaveBeenCalledTimes(2);

    vi.advanceTimersByTime(BACKOFF_MS - 1);
    expect(await aaCall("bk", "search", uniq(), opts)).toMatchObject({ ok: false, class: "blocked" });
    expect(callMock).toHaveBeenCalledTimes(2);

    vi.advanceTimersByTime(1);
    expect(await aaCall("bk", "search", uniq(), opts)).toMatchObject({ ok: true });
    expect(callMock).toHaveBeenCalledTimes(3);
  });

  it("is 10 minutes", () => {
    expect(BACKOFF_MS).toBe(10 * 60_000);
  });

  it("plain errors do not back off", async () => {
    callMock.mockResolvedValueOnce({ ok: false, class: "error", reason: "ECONNRESET", retry: "no" });
    await aaCall("bk2", "search", uniq(), opts);
    callMock.mockResolvedValue({ ok: true, class: "ok", tier: 1, data: 1 });
    expect(await aaCall("bk2", "search", uniq(), opts)).toMatchObject({ ok: true });
  });

  it("still serves cached answers during back-off", async () => {
    const args = uniq();
    callMock.mockResolvedValueOnce({ ok: true, class: "ok", tier: 1, data: "cached" });
    await aaCall("bk3", "search", args, opts);
    callMock.mockResolvedValueOnce({ ok: false, class: "blocked", reason: "captcha", retry: "no" });
    await aaCall("bk3", "search", uniq(), opts);
    expect(await aaCall("bk3", "search", args, opts)).toEqual({ ok: true, tier: 1, data: "cached" });
    expect(callMock).toHaveBeenCalledTimes(2);
  });

  it("keeps state on globalThis (survives module reload)", async () => {
    callMock.mockResolvedValueOnce({ ok: false, class: "blocked", reason: "captcha", retry: "no" });
    await aaCall("bk4", "search", uniq(), opts);
    vi.resetModules();
    const fresh = await import("@/src/lib/aa");
    callMock.mockResolvedValue({ ok: true, class: "ok", tier: 1, data: 1 });
    expect(await fresh.aaCall("bk4", "search", uniq(), opts)).toMatchObject({ ok: false, class: "blocked" });
    expect(callMock).toHaveBeenCalledTimes(1);
  });
});
