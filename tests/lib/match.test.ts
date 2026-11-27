import { describe, it, expect } from "vitest";
import { tokenize } from "@/src/lib/match/tokenize";
import { scoreRelevance, filterRelevant, matchesAllTokens } from "@/src/lib/match/relevance";
import { isAccessory, isStrongAccessory, dropAccessories, isForAccessory } from "@/src/lib/match/accessory";
import { dedupe } from "@/src/lib/match/dedupe";
import { specMatches } from "@/src/lib/match/spec";
import { isOtherProduct } from "@/src/lib/match/category";
import { dropBrandPriceOutliers } from "@/src/lib/match/price";
import type { Product } from "@/src/lib/types";

const prod = (title: string, listPrice = 10, id = title): Product => ({
  site: "x",
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
});

describe("tokenize", () => {
  it("lowercases, keeps hyphenated tokens, drops 1-char tokens", () => {
    expect(tokenize("USB-C Cable, 2 m & a WH-1000XM4!")).toEqual([
      "usb-c",
      "cable",
      "wh-1000xm4",
    ]);
  });
});

describe("scoreRelevance", () => {
  it("scores a full match 1 and a non-match 0", () => {
    expect(scoreRelevance([["anc", "earbuds"]], "Baseus EP10 Pro ANC Earbuds")).toBe(1);
    expect(scoreRelevance([["anc", "earbuds"]], "Garden hose")).toBe(0);
  });
  it("uses the best variant", () => {
    const v = [
      ["anc", "earbuds"],
      ["noise", "cancelling", "earbuds"],
      ["noise", "cancelling", "earphones"],
    ];
    expect(scoreRelevance(v, "Noise Cancelling TWS Earphones")).toBeGreaterThanOrEqual(0.6);
  });
  it("tolerates a typo and prefix", () => {
    expect(scoreRelevance([["earbud"]], "Wireless Earbuds")).toBe(1);
    expect(scoreRelevance([["headph"]], "Wireless Headphones")).toBe(1);
  });
  it("does not typo-match the first letter (iphone != phone)", () => {
    expect(scoreRelevance([["iphone"]], "Mobile Phone Dust Plug")).toBe(0);
    expect(scoreRelevance([["keyboard"]], "Mechanical Keybord")).toBe(1);
  });
  it("does not typo-match short tokens", () => {
    expect(scoreRelevance([["cab"]], "Cat")).toBe(0);
  });
});

describe("filterRelevant", () => {
  it("keeps relevant products only", () => {
    const ps = [prod("ANC Earbuds Wireless"), prod("Garden hose 10m")];
    expect(filterRelevant(ps, [["anc", "earbuds"]]).map((p) => p.title)).toEqual([
      "ANC Earbuds Wireless",
    ]);
  });
  it("single product perfect match passes threshold", () => {
    const ps = [prod("Baseus EP10 Pro ANC Earbuds Wireless Bluetooth 6.0")];
    expect(filterRelevant(ps, [["anc", "earbuds"]])).toHaveLength(1);
  });
  it("two products, scores stay within 0..1", () => {
    const ps = [prod("ANC Earbuds"), prod("ANC Earbuds Pro")];
    expect(filterRelevant(ps, [["anc", "earbuds"]])).toHaveLength(2);
  });
  it("empty list gives empty list", () => {
    expect(filterRelevant([], [["anc"]])).toEqual([]);
  });
});

describe("isAccessory", () => {
  const q = ["anc", "earbuds"];
  it("passes the real product", () => {
    expect(isAccessory("Baseus EP10 Pro ANC Earbuds Wireless Bluetooth 6.0", q)).toBe(false);
  });
  it("flags case and tips", () => {
    expect(isAccessory("Silicone Case Cover for AirPods Pro", q)).toBe(true);
    expect(isAccessory("Replacement Ear Tips for Earbuds", q)).toBe(true);
  });
  it("flags accessory word followed by 'for' late in title", () => {
    expect(isAccessory("Premium Soft Durable Waterproof Shockproof Slim Case for Earbuds", q)).toBe(true);
  });
  it("is not an accessory when the query asks for one", () => {
    expect(isAccessory("Anker USB-C Cable 2m Braided", ["usb-c", "cable"])).toBe(false);
  });
});

describe("dedupe", () => {
  it("keeps the cheaper of near-identical titles", () => {
    const base = "Baseus EP10 Pro ANC Earbuds Wireless Bluetooth 5.3 Headphones With Mic Touch Control";
    const a = prod(base + " Black", 120, "a");
    const b = prod(base + " White", 100, "b");
    const c = prod("Garden hose 10m", 50, "c");
    expect(dedupe([a, b, c]).map((p) => p.id)).toEqual(["b", "c"]);
  });
  it("empty list gives empty list", () => {
    expect(dedupe([])).toEqual([]);
  });
});

describe("review fixes", () => {
  it("1: every query token is required: drops plain earbuds and headphones", () => {
    const ps = [
      prod("ANC Earbuds A", 1, "a1"), prod("ANC Earbuds B", 1, "a2"),
      ...[1, 2, 3, 4, 5, 6].map((i) => prod(`Earbuds X${i}`, 1, `p${i}`)),
      prod("ANC Over-Ear Headphones Sony", 1, "h"),
      prod("ANC Case Silicone", 1, "c"),
    ];
    const ids = filterRelevant(ps, [["anc", "earbuds"]]).map((p) => p.id);
    expect(ids).not.toContain("h");
    expect(ids).not.toContain("c");
    expect(ids).not.toContain("p1");
    expect(ids).toContain("a1");
  });
  it("12c: alias phrases and stems satisfy a query token (matching only)", () => {
    expect(matchesAllTokens([["anc", "earbuds"]], "TWS Earphones Active Noise Cancellation")).toBe(true);
    expect(matchesAllTokens([["ps5", "controller"]], "Sony DualSense Wireless Controller - White")).toBe(true);
    expect(matchesAllTokens([["ps5", "controller"]], "PlayStation 5 Wireless Gamepad")).toBe(true);
    expect(matchesAllTokens([["gaming", "mouse"]], "2.4GHz Wireless Game Mouse")).toBe(true);
    expect(matchesAllTokens([["apple", "watch"]], "D20 Smart Watch Fitness Tracker")).toBe(false);
    expect(matchesAllTokens([["4k", "monitor"]], "27 inch FHD Monitor")).toBe(false);
  });
  it("2: tokens with digits match exactly only", () => {
    expect(scoreRelevance([["sony", "wh-1000xm4"]], "Sony WH-1000XM5 Wireless Headphones")).toBeLessThan(0.6);
    expect(scoreRelevance([["rtx4070"]], "MSI GeForce RTX4060")).toBeLessThan(0.6);
    expect(scoreRelevance([["sony", "wh-1000xm4"]], "Sony WH-1000XM4 Headphones")).toBe(1);
  });
  it("3: hyphen and split forms match", () => {
    expect(scoreRelevance([["usb", "cable"]], "Anker USB-C to USB-C Cable 100W")).toBeGreaterThanOrEqual(0.6);
    expect(scoreRelevance([["usb-c", "cable"]], "UGREEN USB C Cable")).toBeGreaterThanOrEqual(0.6);
    expect(scoreRelevance([["noise", "cancelling", "earbuds"]], "Noise-Cancelling Earbuds")).toBeGreaterThanOrEqual(0.6);
  });
  it("4: isAccessory is the candidate test; strong needs for/compatible/replacement", () => {
    expect(isAccessory("Soundcore P20i Earbuds with Charging Case", ["anc", "earbuds"])).toBe(false);
    expect(isAccessory("Anker Power Bank with Built-in Cable", ["power", "bank"])).toBe(false);
    expect(isAccessory("iPhone 16 Case", ["iphone", "16"])).toBe(true);
    expect(isAccessory("Anker USB-C Cable", ["usb-c", "cable"])).toBe(false);
    expect(isStrongAccessory("Silicone Case for AirPods Pro 2", ["anc", "earbuds"])).toBe(true);
    expect(isStrongAccessory("Ear Tips Replacement for Galaxy Buds", ["anc", "earbuds"])).toBe(true);
    expect(isStrongAccessory("iPhone 16 Case", ["iphone", "16"])).toBe(false);
  });
  const titles = (ps: Product[]) => ps.map((p) => p.title);
  const set = (rows: [string, number][]) => rows.map(([t, pr], i) => prod(t, pr, String(i)));
  it("C1: dropAccessories iphone", () => {
    const ps = set([
      ["Apple iPhone 16 128GB", 3299], ["Apple iPhone 16 256GB", 3799], ["iPhone 16 Case", 29],
      ["Clear Case iPhone 16", 19], ["ESR iPhone 16 Screen Protector 3 Pack", 35], ["Silicone Case for iPhone 16", 25],
    ]);
    expect(titles(dropAccessories(ps, ["iphone", "16"]))).toEqual(["Apple iPhone 16 128GB", "Apple iPhone 16 256GB"]);
  });
  it("C1: dropAccessories earbuds", () => {
    const ps = set([
      ["Soundcore P20i Earbuds with Charging Case", 99], ["JBL Wave Earbuds", 149],
      ["Earbuds Case Silicone", 15], ["Cable Earbuds Wired", 89],
    ]);
    expect(titles(dropAccessories(ps, ["earbuds"]))).toEqual(["Soundcore P20i Earbuds with Charging Case", "JBL Wave Earbuds", "Cable Earbuds Wired"]);
  });
  it("C1: main products survive when priced like peers", () => {
    const fit = set([["Xiaomi Smart Band 9 Fitness Tracker", 149], ["Huawei Band 9 Fitness Tracker", 179], ["Fitbit Inspire 3 Fitness Tracker", 299]]);
    expect(dropAccessories(fit, ["fitness", "tracker"])).toHaveLength(3);
    const pb = set([["Baseus Power Bank Wireless Charger 10000mAh", 129], ["Anker Power Bank with Built-in Cable", 99], ["Anker 20000mAh Power Bank", 149]]);
    expect(dropAccessories(pb, ["power", "bank"])).toHaveLength(3);
  });
  it("C1: dropAccessories laptop and strong", () => {
    const ps = set([["Lenovo IdeaPad Laptop", 1999], ["HP Laptop 15", 2299], ["Laptop Charger 65W", 79], ["Laptop Stand Aluminium", 59]]);
    expect(titles(dropAccessories(ps, ["laptop"]))).toEqual(["Lenovo IdeaPad Laptop", "HP Laptop 15"]);
    const st = set([["Baseus ANC Earbuds", 100], ["Silicone Case for AirPods Pro 2", 150], ["Ear Tips Replacement for Galaxy Buds", 200]]);
    expect(titles(dropAccessories(st, ["anc", "earbuds"]))).toEqual(["Baseus ANC Earbuds"]);
  });
  it("C1: no non-candidates keeps non-strong candidates", () => {
    const ps = set([["iPhone 16 Case", 29], ["Silicone Case for iPhone 16", 25]]);
    expect(titles(dropAccessories(ps, ["iphone", "16"]))).toEqual(["iPhone 16 Case"]);
  });
  it("R4: one overpriced outlier does not drop real products (no >=4x gap)", () => {
    const ip = set([["iPhone 16 Case Clear", 5000], ["iPhone 16 Case A", 1000], ["iPhone 16 Case B", 1200], ["iPhone 16 Case C", 1800]]);
    expect(dropAccessories(ip, ["iphone", "16"]).map((p) => p.id)).toEqual(["0", "1", "2", "3"]);
    const w = set([
      ["Apple Watch Ultra Titanium Case Band", 5000],
      ["Apple Watch Series 9 Aluminium Case", 1599],
      ["Apple Watch SE Aluminium Case", 899],
    ]);
    expect(dropAccessories(w, ["apple", "watch"]).map((p) => p.id)).toEqual(["0", "1", "2"]);
  });
  it("R3: all-candidate sets drop the cheap side of a >=4x price gap", () => {
    const w = set([
      ["Apple Watch Series 9 GPS 45mm Midnight Aluminium Case with Sport Band", 1599],
      ["Apple Watch SE GPS 40mm Starlight Aluminium Case with Sport Loop", 899],
      ["Apple Watch Band 45mm Silicone", 29], ["Apple Watch Strap Nylon Sport Loop", 39], ["Apple Watch Charger Magnetic", 35],
    ]);
    expect(dropAccessories(w, ["apple", "watch"]).map((p) => p.id)).toEqual(["0", "1"]);
    const f = set([["Xiaomi Smart Band 9 Fitness Tracker", 149], ["Huawei Band 9 Fitness Tracker", 179], ["Fitness Tracker Strap Nylon", 19]]);
    expect(titles(dropAccessories(f, ["fitness", "tracker"]))).toEqual(["Xiaomi Smart Band 9 Fitness Tracker", "Huawei Band 9 Fitness Tracker"]);
    // all cases 19-49 SAR: largest consecutive ratio is 39/29 < 4, so no gap and every case is kept
    const c = set([["iPhone 16 Case A", 19], ["iPhone 16 Case B", 25], ["iPhone 16 Case C", 29], ["iPhone 16 Case D", 39], ["iPhone 16 Case E", 49]]);
    expect(dropAccessories(c, ["iphone", "16"]).map((p) => p.listPrice)).toEqual([19, 25, 29, 39, 49]);
  });
  it("I1: variant words block merging", () => {
    const pairs = [
      ["Samsung Galaxy S24 Plus", "Samsung Galaxy S24 Ultra"],
      ["Apple iPhone 16 Pro", "Apple iPhone 16 Plus"],
      ["Apple Watch Ultra 2", "Apple Watch Series 2"],
      ["Apple Watch Series 9 GPS", "Apple Watch Series 9 Cellular"],
    ];
    for (const [x, y] of pairs) expect(dedupe([prod(x, 1, "a"), prod(y, 2, "b")]), x).toHaveLength(2);
  });
  it("5: dedupe keeps distinct models, merges color variants", () => {
    const t = (m: string) => `Sony ${m} Wireless Noise Cancelling Bluetooth Over Ear Headphones With Mic Black`;
    expect(dedupe([prod(t("WH-1000XM4"), 1, "a"), prod(t("WH-1000XM5"), 2, "b")])).toHaveLength(2);
    const ip = (g: string) => `Apple iPhone 15 Pro Max ${g} Natural Titanium Unlocked Smartphone`;
    expect(dedupe([prod(ip("256GB"), 1, "a"), prod(ip("512GB"), 2, "b")])).toHaveLength(2);
    expect(dedupe([prod("Apple AirPods Pro 2 White", 9, "w"), prod("Apple AirPods Pro 2 Black", 5, "k")]).map((p) => p.id)).toEqual(["k"]);
  });
});

describe("specMatches (12c)", () => {
  it("bare model number must follow its word and not be a suffixed model", () => {
    expect(specMatches("16", "iphone", "Apple iPhone 16 Pro (128 GB)")).toBe(true);
    expect(specMatches("16", "iphone", "Original iPhone16 128GB")).toBe(true);
    expect(specMatches("16", "iphone", "Apple iPhone 16e 128GB")).toBe(false);
    expect(specMatches("16", "iphone", "Used iPhone 16 e 5G")).toBe(false);
    expect(specMatches("16", "iphone", "Apple iPhone 6 16/32/64GB")).toBe(false);
  });
  it("bare number as a screen size", () => {
    expect(specMatches("27", "monitor", "Z-Edge 27-inch Gaming Monitor 4K")).toBe(true);
    expect(specMatches("27", "monitor", 'AOC 27" 4K Monitor')).toBe(true);
    expect(specMatches("27", "monitor", "4K Monitor 32 inch, 2 x 27W speakers")).toBe(false);
  });
  it("number + unit, spaced or with thousands separator", () => {
    expect(specMatches("20000mah", "bank", "KA35 Power Bank with 20,000mAh Capacity")).toBe(true);
    expect(specMatches("20000mah", "bank", "Power Bank 20000 mAh")).toBe(true);
    expect(specMatches("20000mah", "bank", "Power Bank 120000mAh")).toBe(false);
    expect(specMatches("4k", "", "Monitor 4K170Hz")).toBe(true);
  });
  it("letters + digits model rejects other generations and FE", () => {
    expect(specMatches("s24", "galaxy", "Samsung Galaxy S24+ 256GB")).toBe(true);
    expect(specMatches("s24", "galaxy", "Samsung Galaxy S24 FE 128GB")).toBe(false);
    expect(specMatches("s24", "galaxy", "Samsung Galaxy S245")).toBe(false);
  });
});

describe("isForAccessory (12c)", () => {
  const v = (...xs: string[][]) => xs;
  it("flags items made for the queried product", () => {
    expect(isForAccessory("Tempered glass camera protection for iPhone 16 plus", v(["iphone", "16"]))).toBe(true);
    expect(isForAccessory("Compatible with Samsung Galaxy S24 Ultra Case", v(["samsung", "galaxy", "s24"]))).toBe(true);
    expect(isForAccessory("2pcs For PS3 PS4 PS5 Game Controllers Thumb Silicone Grips", v(["ps5", "controller"]))).toBe(true);
  });
  it("keeps the product itself, use phrases and 'For'-prefixed seller titles", () => {
    expect(isForAccessory("Sony DualSense Controller, Wireless, for PlayStation 5", v(["ps5", "controller"]))).toBe(false);
    expect(isForAccessory("Game Monitor 144Hz Suitable for E-sports, 4K", v(["4k", "monitor"]))).toBe(false);
    expect(isForAccessory("Suitable for E-sports Players, Game Monitor 4K", v(["4k", "monitor"]))).toBe(false);
    expect(isForAccessory("For Wet Dry Robot Vacuum Cleaner Auto Recharge", v(["robot", "vacuum"]))).toBe(false);
    expect(isForAccessory("Apple iPhone 16 128GB", v(["iphone", "16"]))).toBe(false);
  });
  it("dropAccessories removes them whatever their price", () => {
    const ps = [prod("Apple iPhone 16 128GB", 3299, "a"), prod("Silicone grip for iPhone 16", 3000, "b")];
    expect(dropAccessories(ps, ["iphone", "16"], [["iphone", "16"]]).map((p) => p.id)).toEqual(["a"]);
  });
});

describe("part nouns after the product noun (12c)", () => {
  it("is strong when a part noun follows the product noun", () => {
    expect(isStrongAccessory("Textured Gaming Mouse Pad", ["gaming", "mouse"], [["gaming", "mouse"]])).toBe(true);
    expect(isStrongAccessory("Hair Dryer Folding Diffuser Blue", ["hair", "dryer"], [["hair", "dryer"]])).toBe(true);
  });
  it("is not strong for a category word (bag, charger) or a far part noun", () => {
    expect(isStrongAccessory("Backpack Laptop Bag 15.6 Inch", ["laptop", "backpack"], [["laptop", "backpack"]])).toBe(false);
    expect(isStrongAccessory("RAVPower Power Bank Charger 20000 mAh", ["power", "bank"], [["power", "bank"]])).toBe(false);
    expect(isStrongAccessory("Apple Watch Series 9 GPS Sport Band", ["apple", "watch"], [["apple", "watch"]])).toBe(false);
  });
});

describe("title core (12c)", () => {
  it("a model '+' is not a connector: 'S24+ Case' is a case", () => {
    expect(isAccessory("Samsung Galaxy S24+ Case, Premium Leather", ["samsung", "galaxy", "s24"])).toBe(true);
    expect(isAccessory("Galaxy Buds + Case", ["galaxy", "buds"])).toBe(false);
  });
});

describe("isOtherProduct (12c)", () => {
  it("drops books about the product and macro keypads", () => {
    expect(isOtherProduct("Apple Watch for Dummies, 2nd Edition", ["apple", "watch"])).toBe(true);
    expect(isOtherProduct('The "I Love My Air Fryer" 5-Ingredient Recipe Book', ["air", "fryer"])).toBe(true);
    expect(isOtherProduct("Paleo Cooking with Your Air Fryer - 75 Recipes", ["air", "fryer"])).toBe(true);
    expect(isOtherProduct("OSU Mini Keypad 2 Key Mechanical Keyboard", ["mechanical", "keyboard"])).toBe(true);
    expect(isOtherProduct("RGB 3 Keys Macro Mechanical Keyboard", ["mechanical", "keyboard"])).toBe(true);
  });
  it("keeps the product itself", () => {
    expect(isOtherProduct("Kenwood Air Fryer 7L with Max Crisp, Recipe Book", ["air", "fryer"])).toBe(false);
    expect(isOtherProduct("AJAZZ NK61 Mechanical Keyboard 61 Keys", ["mechanical", "keyboard"])).toBe(false);
    expect(isOtherProduct("Wireless Gaming Mouse 6 Keys", ["gaming", "mouse"])).toBe(false);
  });
});

describe("title core needs a query word (12c)", () => {
  it("uses the whole title when the part before '&' names no query word", () => {
    expect(isAccessory("Ps5 Cooling & Dual Controller Charging Station", ["controller"])).toBe(true);
  });
  it("'built-in' starts the add-on part", () => {
    expect(isAccessory("20000mAh Power Bank built-in 4 charging cables", ["power", "bank", "20000mah"])).toBe(false);
  });
});

describe("dropBrandPriceOutliers (12c)", () => {
  const set = (rows: [string, number][]) => rows.map(([t, pr], i) => prod(t, pr, String(i)));
  const watches = set([
    ["Apple Watch Series 10 Smart Watch Clone", 70], ["Apple Watch SE 3 GPS 40mm", 899],
    ["Apple Watch Series 11 GPS 42mm", 1599], ["Apple Watch Ultra 3", 3299], ["Apple Watch SE 3 GPS 44mm", 999],
  ]);
  it("drops far-below-median items in a brand query", () => {
    expect(dropBrandPriceOutliers(watches, ["apple", "watch"]).map((p) => p.id)).toEqual(["1", "2", "3", "4"]);
  });
  it("leaves unbranded queries and small sets alone", () => {
    expect(dropBrandPriceOutliers(watches, ["smart", "watch"])).toHaveLength(5);
    expect(dropBrandPriceOutliers(watches.slice(0, 3), ["apple", "watch"])).toHaveLength(3);
  });
});
