import { describe, expect, it } from "vitest";
import { rerunHref, valuesFromUrl } from "@/src/lib/rerun";

const base = { query: "", sites: ["jarir"], sort: "price" as const, minPrice: "", maxPrice: "", minRating: "" };

describe("re-run links", () => {
  it("round-trips a history entry into form values", () => {
    const href = rerunHref({ query: "airpods 4 & case", sites: ["amazon-sa", "noon-sa"], sort: "deal", filters: { maxPrice: 900, minRating: 4 } });
    const r = valuesFromUrl(href.slice(1), base);
    expect(r).toEqual({ run: true, values: { query: "airpods 4 & case", sites: ["amazon-sa", "noon-sa"], sort: "deal", minPrice: "", maxPrice: "900", minRating: "4" } });
  });
  it("ignores unknown stores, sorts and bad numbers, and needs a query", () => {
    expect(valuesFromUrl("?sites=jarir", base)).toBeNull();
    expect(valuesFromUrl("?q=x&sites=evil&sort=drop&max=abc", base)).toEqual({ run: false, values: { ...base, query: "x" } });
  });
});
