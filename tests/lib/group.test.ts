import { describe, it, expect } from "vitest";
import {
  colorOf,
  groupProducts,
  groupRefs,
  modelCodes,
  orderGroups,
  sameProduct,
  specConflict,
  titleFeatures,
  variantWords,
} from "@/src/lib/match/group";
import { dedupeByStore } from "@/src/lib/match/dedupe";
import type { Product } from "@/src/lib/types";

const P = (site: string, id: string, title: string, listPrice: number, o: Partial<Product> = {}): Product => ({
  site,
  id,
  title,
  listPrice,
  origPrice: null,
  discountPct: null,
  currency: "SAR",
  rating: null,
  soldCount: 0,
  image: "",
  url: "",
  detailStatus: "ok",
  ...o,
});

const same = (a: string, b: string) => sameProduct(titleFeatures(a), titleFeatures(b));

describe("modelCodes", () => {
  it("finds part codes, normalized without hyphens and upper-cased", () => {
    expect(modelCodes("Sony WH-1000XM5 Wireless Headphones")).toEqual(["WH1000XM5"]);
    expect(modelCodes("Samsung Galaxy S24 SM-S921B 256GB")).toContain("SMS921B");
    expect(modelCodes("Original iPhone 16 A3081 A18")).toEqual(["A3081"]);
  });
  it("ignores pure specs and short tokens", () => {
    for (const t of ["Anker 100W USB-C cable", "Power bank 20000mAh 22.5W", "Monitor 27inch 4K 144Hz", "iPhone 16 5G 256GB", "Phone 8GB RAM 1TB", "Gen2 earbuds IPX7 BT5.3 WiFi6"])
      expect(modelCodes(t), t).toEqual([]);
    expect(modelCodes("Galaxy S24 M3 PS5")).toEqual([]);
  });
  it("does not treat a line name glued to its number as a code", () => {
    expect(modelCodes("Apple iphone16 airpods4 series10")).toEqual([]);
  });
});

describe("specConflict", () => {
  it("any shared spec dimension that differs is a conflict", () => {
    const f = (t: string) => titleFeatures(t);
    expect(specConflict(f("Power Bank 20000mAh"), f("Power Bank 10000mAh"))).toBe(true);
    expect(specConflict(f("iPhone 16 256GB"), f("iPhone 16 512GB"))).toBe(true);
    expect(specConflict(f("Charger 65W"), f("Charger 100W"))).toBe(true);
    expect(specConflict(f("Monitor 27 inch"), f("Monitor 32 inch"))).toBe(true);
    expect(specConflict(f("Echo Dot 5th Gen"), f("Echo Dot 4th Gen"))).toBe(true);
    expect(specConflict(f("Monitor 4K"), f("Monitor 1080p"))).toBe(true);
    expect(specConflict(f("Apple Watch Series 10 42mm"), f("Apple Watch Series 10 46mm"))).toBe(true);
    expect(specConflict(f("Air Fryer 5.5L"), f("Air Fryer 4 L"))).toBe(true);
  });
  it("a spec on one side only, or the same spec written differently, is no conflict", () => {
    const f = (t: string) => titleFeatures(t);
    expect(specConflict(f("Power Bank 20,000 mAh 22.5W"), f("Power Bank 20000mAh"))).toBe(false);
    expect(specConflict(f("iPhone 16 128 GB 5G"), f("iPhone 16 128GB"))).toBe(false);
    expect(specConflict(f("Monitor 27-inch"), f('Monitor 27"'))).toBe(false);
  });
  it("model numbers (bare and short codes) must agree", () => {
    const f = (t: string) => titleFeatures(t);
    expect(specConflict(f("Apple iPhone 16 128GB"), f("Apple iPhone 15 128GB"))).toBe(true);
    expect(specConflict(f("Apple iPhone 16e 128GB"), f("Apple iPhone 16 128GB"))).toBe(true);
    expect(specConflict(f("MacBook Air M3 13"), f("MacBook Air M2 13"))).toBe(true);
    expect(specConflict(f("Apple iphone16 128GB"), f("Apple iPhone 16 128GB"))).toBe(false);
  });
  it("RAM and storage are separate dimensions", () => {
    const f = (t: string) => titleFeatures(t);
    expect(specConflict(f("Galaxy S24 8GB RAM 256GB"), f("Galaxy S24 256GB"))).toBe(false);
    expect(specConflict(f("Galaxy S24 8GB RAM 256GB"), f("Galaxy S24 12GB RAM 256GB"))).toBe(true);
  });
});

describe("variantWords", () => {
  it("collects pro/plus/max/ultra/... including a glued +", () => {
    expect([...variantWords("iPhone 16 Pro Max")].sort()).toEqual(["max", "pro"]);
    expect([...variantWords("Galaxy S24+ 256GB")]).toEqual(["plus"]);
    expect([...variantWords("Galaxy S24 256GB")]).toEqual([]);
  });
  it("different variant sets never merge", () => {
    expect(same("Apple iPhone 16 Pro 256GB Black", "Apple iPhone 16 256GB Black")).toBe(false);
    expect(same("Samsung Galaxy S24 Ultra 256GB", "Samsung Galaxy S24 256GB")).toBe(false);
    expect(same("Apple AirPods Pro 2", "Apple AirPods 2")).toBe(false);
  });
});

describe("colorOf", () => {
  it("names the colour, two-word colours included", () => {
    expect(colorOf("Apple iPhone 16 128GB Black")).toBe("black");
    expect(colorOf("MacBook Air Space Gray")).toBe("space gray");
    expect(colorOf("Sony WH-1000XM5")).toBeUndefined();
  });
  it("colour differences still merge", () => {
    expect(same("Apple iPhone 16 128GB Black 5G", "Apple iPhone 16 128GB Ultramarine 5G")).toBe(true);
  });
});

describe("sameProduct", () => {
  it("a shared model code with the same brand and no conflict merges, whatever the wording", () => {
    expect(same("Sony WH-1000XM5 Wireless Noise Cancelling Headphones, Black", "Sony WH1000XM5 Over-Ear Bluetooth Headset Silver")).toBe(true);
  });
  it("a shared code with a spec conflict, or different codes, never merges", () => {
    expect(same("Anker A1289 Power Bank 20000mAh", "Anker A1289 Power Bank 10000mAh")).toBe(false);
    expect(same("Sony WH-1000XM5 Wireless Headphones Black", "Sony WH-1000XM4 Wireless Headphones Black")).toBe(false);
  });
  it("different known brands never merge", () => {
    expect(same("Anker PowerCore 20000mAh Power Bank A1384", "Xiaomi PowerCore 20000mAh Power Bank A1384")).toBe(false);
  });
  it("without a code: same brand, no conflict and similar words merge", () => {
    expect(same("Philips Air Fryer Essential XL 6.2L Black", "Philips Essential Air Fryer XL 6.2L")).toBe(true);
  });
  it("without a code: weak word overlap stays separate", () => {
    expect(same("Philips Air Fryer 6.2L", "Philips Hair Dryer Ionic 2100W Travel Compact")).toBe(false);
  });
  it("without a code: no brand on either side stays separate", () => {
    expect(same("Wireless Earbuds Bluetooth 5.3 ANC", "Wireless Earbuds Bluetooth 5.3 ANC Black")).toBe(false);
  });
  it("the similarity threshold decides borderline pairs", () => {
    const a = titleFeatures("Philips Air Fryer XL 6.2L Black Digital");
    const b = titleFeatures("Philips Air Fryer XL 6.2L Rapid Air Technology Healthy");
    expect(sameProduct(a, b, { threshold: 0.3 })).toBe(true);
    expect(sameProduct(a, b, { threshold: 0.9 })).toBe(false);
  });
});

describe("rules found on the recorded searches", () => {
  it("the brand is the item's own, not the one it is for", () => {
    expect(titleFeatures("KISSUN PS5 Controller Wireless, Compatible with PS5 Controller").knownBrand).toBeUndefined();
    expect(same("KISSUN Wireless Controller for PS5 with RGB Lighting", "JYELUK Wireless Controller for PS5 with RGB Lighting")).toBe(false);
  });
  it("sensor codes and number+word tokens are not model codes", () => {
    expect(modelCodes("ATTACK SHARK X11 Gaming Mouse PAW3311 Sensor 6-Axis 2-in-1 #1USA 3-Speed")).toEqual([]);
  });
  it("a bundle is another product than the item alone", () => {
    expect(same("Fujifilm Instax Mini 12 Instant Camera Clay White", "Fujifilm Instax Mini 12 Instant Camera Clay White + 2 Pack Film")).toBe(false);
  });
  it("renewed, limited edition and TKL are variants", () => {
    expect(same("Apple iPhone 16 128GB Pink", "Apple iPhone 16 128GB Pink (Renewed)")).toBe(false);
    expect(same("Logitech G413 SE Mechanical Gaming Keyboard", "Logitech G413 TKL SE Mechanical Gaming Keyboard")).toBe(false);
  });
  it("different materials or massage never merge", () => {
    expect(same("GTPLAYER Ergonomic Gaming Chair PU Leather Footrest", "GTPLAYER Ergonomic Gaming Chair Fabric Footrest")).toBe(false);
    expect(same("GTPLAYER Ergonomic Gaming Chair PU Leather Footrest", "GTPLAYER Ergonomic Gaming Chair Massage PU Leather Footrest")).toBe(false);
  });
  it("variant words used for something else do not count", () => {
    expect([...titleFeatures("BenQ 27 Monitor 4K Ultra HD").variants]).toEqual([]);
    expect([...titleFeatures("Belkin Charging Stand for iPhone 16 Pro Max").variants]).toEqual([]);
  });
  it("a bare number the other title states as a spec is no conflict; playtime hours are noise", () => {
    expect(specConflict(titleFeatures("Apple Watch SE 3 44 GPS"), titleFeatures("Apple Watch SE 3 GPS 44mm"))).toBe(false);
    expect(specConflict(titleFeatures("QCY T13 ANC Earbuds 30H Playtime IPX5"), titleFeatures("QCY T13 ANC Earbuds"))).toBe(false);
    expect(specConflict(titleFeatures("Brand Machine 12 Functions"), titleFeatures("Brand Machine 9 Functions"))).toBe(true);
  });
  it("a code two brands share is no evidence", () => {
    const a = P("amazon-sa", "a", "AJAZZ AJ159 Wireless Gaming Mouse ZX3950", 100);
    const b = P("noon-sa", "b", "Waizowl Triaina Wireless Gaming Mouse ZX3950", 100);
    expect(groupProducts([a, b]).every((g) => g.members.length === 1)).toBe(true);
  });
});

describe("groupProducts", () => {
  const amz = P("amazon-sa", "1", "Sony WH-1000XM5 Wireless Headphones Black", 1200);
  const noon = P("noon-sa", "2", "Sony WH1000XM5 Noise Cancelling Headphones Silver", 1100);
  const jarir = P("jarir", "3", "Sony WH-1000XM5 Headphones", 1150);
  const other = P("noon-sa", "4", "Sony WH-1000XM4 Wireless Headphones Black", 800);

  it("groups the same product across stores; best is the cheapest; stores listed by price", () => {
    const gs = groupProducts([amz, noon, jarir, other]);
    const g = gs.find((x) => x.members.length > 1)!;
    expect(g.members.map((p) => p.id)).toEqual(["2", "3", "1"]);
    expect(g.best.id).toBe("2");
    expect(g.stores).toEqual(["noon-sa", "jarir", "amazon-sa"]);
    expect(gs.find((x) => x.members.some((p) => p.id === "4"))!.members).toHaveLength(1);
  });
  it("a group needs two stores: same-store look-alikes stay separate cards", () => {
    const a = P("noon-sa", "a", "Sony WH-1000XM5 Black", 1000);
    const b = P("noon-sa", "b", "Sony WH-1000XM5 Silver", 1100);
    expect(groupProducts([a, b]).every((g) => g.members.length === 1)).toBe(true);
  });
  it("a member must not conflict with any member already in the group (no chaining)", () => {
    const a = P("amazon-sa", "a", "Anker Power Bank 20000mAh A1384", 100);
    const b = P("noon-sa", "b", "Anker Power Bank A1384 22.5W", 110);
    const c = P("jarir", "c", "Anker Power Bank 10000mAh A1384 22.5W", 90);
    const gs = groupProducts([a, b, c]);
    const ga = gs.find((g) => g.members.some((p) => p.id === "a"))!;
    expect(ga.members.some((p) => p.id === "c")).toBe(false);
  });
  it("best is the cheapest confident member, even when a less likely one is cheaper", () => {
    const a = P("amazon-sa", "a", "Sony WH-1000XM5 Headphones", 1200);
    const b = P("noon-sa", "b", "Sony WH-1000XM5 Headphones Black", 900, { matchScore: 0.2 });
    const g = groupProducts([a, b]).find((x) => x.members.length === 2)!;
    expect(g.best.id).toBe("a");
    expect(g.members.map((p) => p.id)).toEqual(["b", "a"]);
  });
  it("is deterministic: the group key does not depend on input order", () => {
    const k1 = groupProducts([amz, noon, jarir]).find((g) => g.members.length > 1)!.key;
    const k2 = groupProducts([jarir, amz, noon]).find((g) => g.members.length > 1)!.key;
    expect(k1).toBe(k2);
  });
});

describe("orderGroups and groupRefs", () => {
  const a1 = P("amazon-sa", "a1", "Sony WH-1000XM5 Headphones", 1200, { discountPct: 5 });
  const a2 = P("noon-sa", "a2", "Sony WH-1000XM5 Headphones Black", 1000, { discountPct: 0 });
  const b = P("jarir", "b", "JBL Tune 520BT Headphones", 1100, { discountPct: 30 });
  const weak = P("noon-sa", "w", "JBL Tune 720BT Headphones", 50, { weakMatch: true });

  it("ranks groups by their best confident member under the active sort", () => {
    const gs = groupProducts([a1, a2, b, weak]);
    expect(orderGroups(gs, "price").map((g) => g.best.id)).toEqual(["a2", "b", "w"]);
    expect(orderGroups(gs, "discount").map((g) => g.members[0].id)).toEqual(["b", "a2", "w"]);
  });
  it("refs carry ids only: key, member keys by price, best key, colours", () => {
    const refs = groupRefs(groupProducts([a1, a2, b]));
    expect(refs).toEqual([
      { key: expect.any(String), memberKeys: ["noon-sa:a2", "amazon-sa:a1"], bestKey: "noon-sa:a2", colors: { "noon-sa:a2": "black" } },
    ]);
  });
});

describe("dedupeByStore", () => {
  it("merges near-identical titles within a store only", () => {
    const a = P("noon-sa", "a", "Sony WH-1000XM5 Headphones Black", 1000);
    const b = P("noon-sa", "b", "Sony WH-1000XM5 Headphones White", 900);
    const c = P("amazon-sa", "c", "Sony WH-1000XM5 Headphones Black", 1200);
    expect(dedupeByStore([a, b, c]).map((p) => p.id)).toEqual(["b", "c"]);
  });
});
