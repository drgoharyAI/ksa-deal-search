import { describe, it, expect, vi, beforeEach } from "vitest";
import amazon from "../fixtures/amazon-sa-search.json";

vi.mock("@/src/lib/aa", () => ({ aaCall: vi.fn() }));

import { aaCall } from "@/src/lib/aa";
import { runSearch } from "@/src/lib/pipeline";
import { isLikelyMatch } from "@/src/lib/rank";
import { sites } from "@/src/sites/registry";
import { callKey, createReplayExec, plannedCalls, querySlug, recordedProducts, type Recording } from "@/src/eval/replay";

const mock = vi.mocked(aaCall);
beforeEach(() => mock.mockReset());

const ok = (data: unknown[]) => ({ ok: true as const, tier: 1, data });

function recordingFor(query: string, store: string, data: unknown[]): Recording {
  return {
    query,
    store,
    recordedAt: "2026-11-27T00:00:00.000Z",
    complete: true,
    calls: plannedCalls(sites[store], query).map((c) => ({ ...c, result: ok(data) })),
  };
}

describe("replay transport", () => {
  it("runSearch with exec replays recorded answers and never touches aaCall", async () => {
    const rec = recordingFor("air fryer", "amazon-sa", amazon.data);
    const { exec, missing } = createReplayExec([rec]);
    let kept: unknown[] = [];
    const r = await runSearch(
      { query: "air fryer", sites: ["amazon-sa"], sort: "price" },
      { exec, onFiltered: (p) => (kept = p) },
    );
    expect(mock).not.toHaveBeenCalled();
    expect(missing).toEqual([]);
    expect(r.statuses).toEqual([{ site: "amazon-sa", status: "ok" }]);
    expect(r.products.length).toBeGreaterThan(0);
    expect(kept.length).toBeGreaterThanOrEqual(r.products.length);
    // Confident tier first, sorted by price (12f); the rest are all less likely matches.
    const split = r.products.findIndex((p) => !isLikelyMatch(p));
    const tiers = split < 0 ? [r.products] : [r.products.slice(0, split), r.products.slice(split)];
    expect(tiers[1]?.every((p) => !isLikelyMatch(p)) ?? true).toBe(true);
    for (const t of tiers.slice(0, 1)) {
      const prices = t.map((p) => p.listPrice);
      expect(prices).toEqual([...prices].sort((a, b) => a - b));
    }
  });

  it("replay matches a live run fed the same answers", async () => {
    const rec = recordingFor("air fryer", "amazon-sa", amazon.data);
    mock.mockResolvedValue(ok(amazon.data));
    const live = await runSearch({ query: "air fryer", sites: ["amazon-sa"], sort: "price" });
    expect(mock).toHaveBeenCalledTimes(2);
    mock.mockClear();
    const replay = await runSearch(
      { query: "air fryer", sites: ["amazon-sa"], sort: "price" },
      { exec: createReplayExec([rec]).exec },
    );
    expect(mock).not.toHaveBeenCalled();
    expect(replay).toEqual(live);
  });

  it("an unrecorded call answers 'not recorded' and is reported as missing", async () => {
    const { exec, missing } = createReplayExec([]);
    const r = await runSearch({ query: "air fryer", sites: ["amazon-sa"], sort: "price" }, { exec });
    expect(mock).not.toHaveBeenCalled();
    expect(r.products).toEqual([]);
    expect(r.statuses[0].status).toBe("error");
    expect(missing.length).toBe(2);
    expect(missing[0]).toEqual({ store: "amazon-sa", op: "search", args: { q: "air fryer", page: "1" } });
  });

  it("a partly recorded store keeps the recorded answers and reports the rest", async () => {
    const rec = recordingFor("air fryer", "amazon-sa", amazon.data);
    rec.calls = rec.calls.slice(0, 1);
    const { exec, missing } = createReplayExec([rec]);
    const r = await runSearch({ query: "air fryer", sites: ["amazon-sa"], sort: "price" }, { exec });
    expect(r.statuses[0]).toEqual({ site: "amazon-sa", status: "ok", message: "1 of 2 requests failed" });
    expect(r.products.length).toBeGreaterThan(0);
    expect(missing.map((m) => m.args.page)).toEqual(["2"]);
  });

  it("recorded blocked answers replay as blocked", async () => {
    const rec: Recording = {
      ...recordingFor("air fryer", "amazon-sa", []),
      calls: plannedCalls(sites["amazon-sa"], "air fryer").map((c) => ({
        ...c,
        result: { ok: false as const, class: "blocked", reason: "captcha" },
      })),
    };
    const r = await runSearch(
      { query: "air fryer", sites: ["amazon-sa"], sort: "price" },
      { exec: createReplayExec([rec]).exec },
    );
    expect(r.statuses[0].status).toBe("blocked");
  });
});

describe("plannedCalls", () => {
  it("records the main term plus the first two synonym variants", () => {
    const calls = plannedCalls(sites["amazon-sa"], "anc earbuds under 300");
    expect(calls.map((c) => c.args.q)).toEqual([
      "anc earbuds",
      "anc earbuds",
      "noise cancelling earbuds",
      "noise canceling earbuds",
    ]);
  });

  it("no synonyms: just the app's own calls", () => {
    expect(plannedCalls(sites["jarir"], "air fryer")).toEqual(
      sites["jarir"].searchCalls({ terms: "air fryer", exclude: [] }, []),
    );
  });

  it("noon ignores variants: two pages of the main term", () => {
    expect(plannedCalls(sites["noon-sa"], "anc earbuds").map((c) => c.args.page)).toEqual(["1", "2"]);
  });
});

describe("helpers", () => {
  it("callKey ignores arg order", () => {
    expect(callKey("search", { q: "a", page: "1" })).toBe(callKey("search", { page: "1", q: "a" }));
    expect(callKey("search", { q: "a", page: "1" })).not.toBe(callKey("search", { q: "a", page: "2" }));
  });

  it("querySlug", () => {
    expect(querySlug("smart watch >4 stars")).toBe("smart-watch-4-stars");
    expect(querySlug("mechanical keyboard -wired")).toBe("mechanical-keyboard-wired");
  });

  it("recordedProducts normalizes and keys by site:id", () => {
    const m = recordedProducts([recordingFor("air fryer", "amazon-sa", amazon.data)], sites);
    expect(m.size).toBeGreaterThan(0);
    const [k, p] = [...m.entries()][0];
    expect(k).toBe(`amazon-sa:${p.id}`);
  });
});
