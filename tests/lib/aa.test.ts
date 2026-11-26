import { describe, it, expect, vi, beforeEach } from "vitest";

const callMock = vi.fn();
vi.mock("api-anything", () => ({ call: (...a: unknown[]) => callMock(...a) }));

import { aaCall } from "@/src/lib/aa";

const opts = { ttlMs: 60_000, lane: "search" as const };
let n = 0;
const uniq = () => ({ q: `x${n++}` }); // fresh cache key per test

beforeEach(() => callMock.mockReset());

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

  it("passes view.maxChars 200000 to call()", async () => {
    callMock.mockResolvedValue({ ok: true, class: "ok", tier: 1, data: 1 });
    await aaCall("s", "search", uniq(), opts);
    expect(callMock.mock.calls[0][3]).toEqual({ view: { maxChars: 200000 } });
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
