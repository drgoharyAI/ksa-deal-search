import { describe, expect, it } from "vitest";
import type { Product } from "@/src/lib/types";
import { rank } from "@/src/lib/rank";
import { bestPriceRow, groupRows } from "@/src/lib/view";
import { cheapestConfident } from "@/src/lib/alerts/shared";

/** Code review round (server): "from" prices (AliExpress, the cheapest variant) never pass as fixed prices. */

const P = (site: string, id: string, price: number, extra: Partial<Product> = {}): Product => ({
  site,
  id,
  title: `${site} ${id}`,
  listPrice: price,
  finalPrice: price,
  origPrice: null,
  discountPct: null,
  currency: "SAR",
  rating: null,
  soldCount: 0,
  image: "",
  url: `https://example.com/${id}`,
  detailStatus: "ok",
  matchScore: 0.9,
  ...extra,
});

describe('"from" prices', () => {
  const from20 = P("aliexpress", "a", 20);
  const jarir90 = P("jarir", "j", 90);
  const noon95 = P("noon-sa", "n", 95);

  it("the price sort puts them after the fixed prices of their tier, before pickup-only", () => {
    const pickup = P("saco-sa", "s", 10, { pickupOnly: true });
    const doubtful = P("amazon-sa", "d", 5, { matchScore: 0.1 });
    expect(rank([from20, pickup, noon95, doubtful, jarir90], "price").map((p) => p.id)).toEqual(["j", "n", "a", "s", "d"]);
  });

  it("other sorts are unchanged", () => {
    expect(rank([jarir90, from20], "discount").map((p) => p.id)).toEqual(["j", "a"]);
  });

  it("never take the group's best price", () => {
    const rows = groupRows([from20, noon95, jarir90]);
    expect(rows.map((p) => p.id)).toEqual(["j", "n", "a"]);
    expect(bestPriceRow(rows)?.id).toBe("j");
    // a from price alongside one fixed price: nothing to compare the fixed one with
    expect(bestPriceRow(groupRows([from20, jarir90]))).toBeNull();
  });

  it("are never the cheapest confident match (History, search alerts)", () => {
    expect(cheapestConfident([from20, jarir90, noon95])?.id).toBe("j");
    expect(cheapestConfident([from20])).toBeNull();
  });
});
