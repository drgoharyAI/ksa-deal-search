import { describe, expect, it } from "vitest";
import { parseNewWatch } from "@/src/lib/alerts/validate";
import { historyEntryFor } from "@/src/lib/history";

const SITES = new Set(["jarir"]);

describe("noCorrect on watches and history", () => {
  it("a search watch keeps noCorrect: true from its filters", () => {
    const r = parseNewWatch({ kind: "search", query: "airpdos", sites: ["jarir"], target: 300, filters: { noCorrect: true } }, SITES);
    expect(r.ok && r.value.filters).toEqual({ noCorrect: true });
  });

  it("only a true boolean counts", () => {
    const r = parseNewWatch({ kind: "search", query: "airpdos", sites: ["jarir"], target: 300, filters: { noCorrect: "yes", maxPrice: 5 } }, SITES);
    expect(r.ok && r.value.filters).toEqual({ maxPrice: 5 });
  });

  it("a history row of a search run as typed says so", () => {
    expect(historyEntryFor({ query: "airpdos", sites: ["jarir"], sort: "price", noCorrect: true }, [], 1).filters).toEqual({ noCorrect: true });
    expect(historyEntryFor({ query: "airpods", sites: ["jarir"], sort: "price" }, [], 1).filters).toEqual({});
  });
});
