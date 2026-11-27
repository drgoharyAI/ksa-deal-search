import { describe, it, expect } from "vitest";
import { groupProducts, sameProduct, titleFeatures } from "@/src/lib/match/group";
import type { Product } from "@/src/lib/types";

const P = (site: string, id: string, title: string): Product => ({
  site,
  id,
  title,
  listPrice: 100,
  origPrice: null,
  discountPct: null,
  currency: "SAR",
  rating: null,
  soldCount: 0,
  image: "",
  url: "",
  detailStatus: "ok",
});

const same = (a: string, b: string) => sameProduct(titleFeatures(a), titleFeatures(b));
const grouped = (a: string, b: string) => groupProducts([P("amazon-sa", "1", a), P("noon-sa", "2", b)]).some((g) => g.members.length === 2);

/** A part or accessory named in one title's name only, also when a code is shared. */
const apart: [string, string][] = [
  ["Samsung 9kg Washing Machine WW90T534DAW", "Samsung 9kg Washer Dryer WW90T534DAW"],
  ["Samsung Front Load Washer 9kg WW90T534DAW", "Samsung Front Load Washer Dryer 9kg WW90T534DAW"],
  ["LG Refrigerator GR-B247SLUV", "LG Refrigerator GR-B247SLUV Water Filter"],
  ["Samsung Refrigerator RS68A8820S9 Side by Side", "Samsung Refrigerator RS68A8820S9 Door Seal Gasket"],
  ["Samsung Refrigerator RS68A8820S9", "Samsung RS68A8820S9 Refrigerator Door Handle"],
  ["Michelin Car Battery 70Ah", "Michelin Car Battery 70Ah Charger"],
  ["Varta Car Battery 12V 70Ah", "Varta Car Battery 12V 70Ah Charger"],
  ["Samsung 65 Inch QLED TV QA65Q60D", "Samsung 65 Inch QLED TV QA65Q60D Wall Mount"],
  ["Samsung 65 Inch QLED TV QA65Q60D", "Samsung 65 Inch QLED TV QA65Q60D Remote"],
  ["Dyson V15 Detect Absolute Cordless Vacuum SV47", "Dyson V15 Detect Absolute Wall Dock SV47"],
  ["Ninja Foodi Dual Zone Air Fryer AF300", "Ninja Foodi Dual Zone Air Fryer AF300 Basket"],
  ["Ninja Foodi Dual Zone Air Fryer AF300", "Ninja AF300 Air Fryer Silicone Liners"],
  ["Philips Sonicare 4100 Toothbrush HX3681", "Philips Sonicare 4100 Toothbrush Heads HX3681"],
  ["Philips Sonicare 4100 Toothbrush HX3681/24", "Philips Sonicare 4100 Toothbrush Heads HX3681/24"],
  ["Bosch Serie 6 Washing Machine WAU28PH9GC", "Bosch WAU28PH9GC Washing Machine Drain Pump"],
  ["Samsung 45W Super Fast Charger EP-T4510", "Samsung 45W Super Fast Charger EP-T4510 Cable"],
  ["Sony Alpha a6400 Mirrorless Camera", "Sony Alpha a6400 Mirrorless Camera Bag"],
  ["Sony a6400 Camera Body", "Sony a6400 Camera Bag"],
  ["Canon EOS R50 Mirrorless Camera RF-S18-45", "Canon EOS R50 Mirrorless Camera Kit RF-S18-45"],
  ["Mobil 1 Fully Synthetic Engine Oil 5W-30 4L", "Mobil 1 Fully Synthetic Engine Oil 5W-40 4L"],
  ["Castrol EDGE 5W30 Engine Oil 4L", "Castrol Magnatec 5W30 Engine Oil 4L"],
];

const merge: [string, string][] = [
  // The part is the product itself on both sides.
  ["Varta Blue Dynamic 12V 60Ah Car Battery D24", "Varta Blue Dynamic D24 60Ah 12V Car Battery"],
  ["Samsung 45W Super Fast Charger EP-T4510", "Samsung EP-T4510 45W Charger, Black"],
  ["Anker 737 Power Bank 24000mAh 140W A1289", "Anker 737 Portable Charger Power Bank 24000mAh A1289"],
  // A part named in a feature list after the name.
  ["Oscar Digital Air Fryer 3 Liter 1200W OAF3LDTB", "Oscar 3 Liter 1200W Digital Air Fryer | Non-Stick Detachable Basket | Cool-Touch Handle | OAF3LDTB"],
  ["Xiaomi P30 E204 Cordless Vacuum Cleaner", "Xiaomi P30 E204 Cordless Vacuum Cleaner, 5-Stage Precision Filter, Brush Nozzle"],
  // Own-part phrases.
  ["Apple AirPods Pro 2 A2968", "Apple AirPods Pro 2 MagSafe Charging Case A2968"],
  // A counted part describes the product.
  ["Philips 1000 Series Airfryer Dual Basket 7.1 L 2450 W NA150/00", "Philips Air Fryer, NA150/00, 7.1L, Black"],
  ["Apple Watch Ultra 2 49mm Titanium Case MX4P3", "Apple Watch Ultra 2 49mm MX4P3"],
  // Recall.
  ["Nikon Z50 Mirrorless Camera Body", "Nikon Z 50 Mirrorless Camera Body"],
  ["Mobil 1 Fully Synthetic Engine Oil 5W-30 4L", "Mobil 1 Fully Synthetic Engine Oil 5W30 4 Liter"],
];

describe("round 5: a part or another appliance type on one side keeps titles apart", () => {
  for (const [a, b] of apart)
    it(`${a} / ${b}`, () => {
      expect(same(a, b)).toBe(false);
      expect(grouped(a, b)).toBe(false);
    });
});

describe("round 5: must still group", () => {
  for (const [a, b] of merge) it(`${a} / ${b}`, () => expect(grouped(a, b)).toBe(true));
});

describe("round 5: features", () => {
  it("reads part nouns from the name, not from feature lists or add-on clauses", () => {
    expect([...titleFeatures("LG Refrigerator GR-B247SLUV Water Filter").parts]).toEqual(["filter"]);
    expect([...titleFeatures("Oscar Air Fryer 3L | Detachable Basket | Cool-Touch Handle").parts]).toEqual([]);
    expect([...titleFeatures("Ninja Blender BN495 with 2 Cups and Lid").parts]).toEqual([]);
  });
  it("reads oil viscosity as a spec, not a code", () => {
    const f = titleFeatures("Mobil 1 5W30 Engine Oil");
    expect([...f.codes]).toEqual([]);
    expect([...f.specs.get("visc")!]).toEqual(["5w30"]);
  });
});
