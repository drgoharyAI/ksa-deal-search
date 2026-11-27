import { describe, expect, it } from "vitest";
import type { Product } from "@/src/lib/types";
import { dedupe } from "@/src/lib/match/dedupe";
import { groupProducts } from "@/src/lib/match/group";

/** Code review round (server): a deliverable twin is kept over a branch-pickup-only one. */

const P = (site: string, id: string, title: string, price: number, extra: Partial<Product> = {}): Product => ({
  site,
  id,
  title,
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

describe("dedupe keeps a deliverable listing", () => {
  const title = "Philips Essential Air Fryer HD9200 4.1L Black";
  it("over a cheaper pickup-only twin", () => {
    const saco = P("saco-sa", "s", title, 199, { pickupOnly: true });
    const jarir = P("jarir", "j", title, 229);
    expect(dedupe([saco, jarir]).map((p) => p.id)).toEqual(["j"]);
    expect(dedupe([jarir, saco]).map((p) => p.id)).toEqual(["j"]);
  });
  it("and still the cheapest among deliverable ones", () => {
    expect(dedupe([P("jarir", "j", title, 229), P("noon-sa", "n", title, 219)]).map((p) => p.id)).toEqual(["n"]);
  });
  it("a group's best member is deliverable first", () => {
    const [g] = groupProducts([P("saco-sa", "s", title, 199, { pickupOnly: true }), P("jarir", "j", title, 229)]);
    expect(g.members.map((p) => p.id)).toEqual(["s", "j"]);
    expect(g.best.id).toBe("j");
  });
});
