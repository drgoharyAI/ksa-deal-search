import { describe, it, expect } from "vitest";
import { prepareSearch, runSearch, type CallExec } from "@/src/lib/pipeline";
import { sites } from "@/src/sites/registry";

const base = { sites: ["jarir"], sort: "price" as const };

describe("prepareSearch: typo correction", () => {
  it("corrects the query before the store calls", () => {
    const p = prepareSearch({ ...base, query: "airpdos 4 under 600" });
    expect(p.pq.terms).toBe("airpods 4");
    expect(p.pq.maxPrice).toBe(600);
    expect(p.correction).toEqual({ from: "airpdos 4 under 600", to: "airpods 4 under 600" });
    expect(sites.jarir.searchCalls(p.pq, p.variants)[0].args).toEqual(expect.objectContaining({ q: "airpods 4" }));
  });

  it("leaves a correct query alone, with no correction", () => {
    const p = prepareSearch({ ...base, query: "jbl flip 6" });
    expect(p.pq.terms).toBe("jbl flip 6");
    expect(p.correction).toBeUndefined();
  });

  it("does not correct a query longer than the search form allows, fast", () => {
    const query = "samsng ".repeat(1500);
    const t0 = performance.now();
    const p = prepareSearch({ ...base, query });
    expect(performance.now() - t0).toBeLessThan(50); // parse and tokenize included
    expect(p.correction).toBeUndefined();
  });

  it("noCorrect searches the query as typed", () => {
    const p = prepareSearch({ ...base, query: "airpdos 4", noCorrect: true });
    expect(p.pq.terms).toBe("airpdos 4");
    expect(p.correction).toBeUndefined();
  });
});

describe("runSearch: typo correction", () => {
  it("sends the corrected words and reports the correction", async () => {
    const sent: string[] = [];
    const exec: CallExec = async (_a, call) => {
      sent.push(JSON.stringify(call.args));
      return { ok: true, tier: 1, data: [] };
    };
    const r = await runSearch({ ...base, query: "samsng galaxy tab" }, { exec });
    expect(sent.join(" ")).toContain("samsung galaxy tab");
    expect(sent.join(" ")).not.toContain("samsng");
    expect(r.correction).toEqual({ from: "samsng galaxy tab", to: "samsung galaxy tab" });
  });
});
