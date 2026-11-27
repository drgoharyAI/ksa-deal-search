import { describe, it, expect, vi, beforeEach } from "vitest";

/** Code review round (server): pipeline statuses and aborts. */

vi.mock("@/src/lib/aa", () => ({ aaCall: vi.fn() }));

import { aaCall } from "@/src/lib/aa";
import { MSG_UNSUPPORTED, runSearch } from "@/src/lib/pipeline";
import { sites } from "@/src/sites/registry";

const mock = vi.mocked(aaCall);
beforeEach(() => mock.mockReset());

describe("an Arabic-only query", () => {
  it("reports 'unsupported' (English search terms only), never ok with 0 results, and asks no store", async () => {
    const ids = ["amazon-sa", "jarir", "noon-sa", "saco-sa", "aliexpress"];
    const r = await runSearch({ query: "سماعة لاسلكية", sites: ids, sort: "price" });
    expect(r.statuses).toEqual(ids.map((site) => ({ site, status: "unsupported", message: MSG_UNSUPPORTED })));
    expect(MSG_UNSUPPORTED).toBe("English search terms only");
    expect(mock).not.toHaveBeenCalled();
  });
});

describe("runSearch honours its signal", () => {
  it("passes it to every store call", async () => {
    mock.mockResolvedValue({ ok: true, tier: 1, data: [] });
    const ctrl = new AbortController();
    await runSearch({ query: "airpods", sites: ["jarir", "amazon-sa"], sort: "price" }, { signal: ctrl.signal });
    expect(mock.mock.calls.length).toBeGreaterThan(0);
    for (const c of mock.mock.calls) expect(c[3]).toMatchObject({ signal: ctrl.signal });
  });

  it("a custom executor (noon, SHEIN) gets it too", async () => {
    const runCall = vi.fn(async () => ({ ok: true as const, tier: 1, data: [] }));
    sites.sig = { id: "sig", label: "Sig", searchCalls: () => [{ op: "search", args: {} }], normalizeSearchItem: () => null, runCall };
    try {
      const ctrl = new AbortController();
      await runSearch({ query: "airpods", sites: ["sig"], sort: "price" }, { signal: ctrl.signal });
      expect(runCall).toHaveBeenCalledWith({ op: "search", args: {} }, { signal: ctrl.signal });
    } finally {
      delete sites.sig;
    }
  });
});
