import { describe, expect, it } from "vitest";
import { rerunHref } from "@/src/lib/rerun";
import { parseShare } from "@/src/lib/share";

const base = { query: "", sites: ["jarir"], sort: "price" as const, minPrice: "", maxPrice: "", minRating: "" };

describe("re-run links (read by the shareable-URL parser)", () => {
  it("round-trips a history entry into form values", () => {
    const href = rerunHref({ query: "airpods 4 & case", sites: ["amazon-sa", "noon-sa"], sort: "deal", filters: { maxPrice: 900, minRating: 4 } });
    const r = parseShare(href.slice(1), base);
    expect(r?.values).toEqual({ query: "airpods 4 & case", sites: ["amazon-sa", "noon-sa"], sort: "deal", minPrice: "", maxPrice: "900", minRating: "4" });
  });
  it("re-runs a search run as typed as typed (noCorrect=1)", () => {
    const href = rerunHref({ query: "airpdos", sites: ["jarir"], sort: "price", filters: { noCorrect: true } });
    expect(parseShare(href.slice(1), base)?.values).toEqual({ ...base, query: "airpdos", noCorrect: true });
  });
  it("ignores unknown stores, sorts and bad numbers, and needs a query", () => {
    expect(parseShare("?sites=jarir", base)).toBeNull();
    expect(parseShare("?q=x&sites=evil&sort=drop&max=abc", base)?.values).toEqual({ ...base, query: "x" });
  });
});

describe("valuesFromUrl (kept for links and callers that read run=1)", () => {
  it("reads the values through the shared parser and says whether run=1 was set", async () => {
    const { valuesFromUrl } = await import("@/src/lib/rerun");
    const href = rerunHref({ query: "kettle", sites: ["jarir"], sort: "price", filters: {} });
    expect(valuesFromUrl(href.slice(1), base)).toEqual({ run: true, values: { ...base, query: "kettle" } });
    expect(valuesFromUrl("?q=kettle", base)?.run).toBe(false);
    expect(valuesFromUrl("?sort=price", base)).toBeNull();
  });
});
