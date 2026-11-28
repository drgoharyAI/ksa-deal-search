import { describe, it, expect } from "vitest";
import { tokenize, tokenizeKeepDigits } from "@/src/lib/match/tokenize";
import { scoreRelevance, filterRelevant, matchesAllTokens } from "@/src/lib/match/relevance";
import { isAccessory, isStrongAccessory, dropAccessories, isForAccessory } from "@/src/lib/match/accessory";
import { dedupe } from "@/src/lib/match/dedupe";
import { specMatches } from "@/src/lib/match/spec";
import { isBookCode, isOtherProduct } from "@/src/lib/match/category";
import { applyBrandPriceRules, hasModelNumber, tierCutoff } from "@/src/lib/match/price";
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
  it("counts two swapped letters as one typo (5+ letters)", () => {
    expect(scoreRelevance([["speakre"]], "JBL Flip 6 Speaker")).toBe(1);
    expect(matchesAllTokens([["airpdos"]], "Apple AirPods 4")).toBe(true);
    expect(scoreRelevance([["paly"]], "Play Mat")).toBe(0); // 4 letters: too short
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
    expect(specMatches("27", "monitor", "24/27/32 Inch Curved Monitor 4K")).toBe(true);
    expect(specMatches("27", "monitor", "Gaming Display 24 27 32 34 Inch")).toBe(true);
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
    // 12e: the part-noun list shrank to "switch"; pads and diffusers are left to the price test.
    expect(isStrongAccessory("Mechanical Keyboard Switches Pack", ["mechanical", "keyboard"], [["mechanical", "keyboard"]])).toBe(false);
    expect(isStrongAccessory("Mechanical Keyboard Switch Red", ["mechanical", "keyboard"], [["mechanical", "keyboard"]])).toBe(true);
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
  it("drops recipe-count books and macro keypads", () => {
    // 12e: the book words (dummies, paperback, hardcover, recipe book) were removed: ISBN codes and
    // the weak-match tier cover them on the dev set.
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
    expect(isAccessory("Ps5 Cooling & Dual Controller Charging Dock", ["controller"])).toBe(true);
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
  it("demotes (never drops) far-below-median items in a brand query without a model number", () => {
    const out = applyBrandPriceRules(watches, ["apple", "watch"]);
    expect(out.map((p) => p.id)).toEqual(["0", "1", "2", "3", "4"]);
    expect(out.filter((p) => p.weakMatch).map((p) => p.id)).toEqual(["0"]);
  });
  it("leaves unbranded queries and small sets alone", () => {
    expect(applyBrandPriceRules(watches, ["smart", "watch"]).some((p) => p.weakMatch)).toBe(false);
    expect(applyBrandPriceRules(watches.slice(0, 3), ["apple", "watch"]).some((p) => p.weakMatch)).toBe(false);
  });
});

describe("round 10 part nouns (12c)", () => {
  it("a part noun right after the product noun needs no accessory-list entry", () => {
    expect(isStrongAccessory("Mechanical keyboard Switch Gateron Yellow 3pin", ["mechanical", "keyboard"], [["mechanical", "keyboard"]])).toBe(true);
    expect(isStrongAccessory("Wireless Controller for PS5 and Switch", ["ps5", "controller"], [["ps5", "controller"]])).toBe(false);
  });
  it("core falls back to the whole title when only a model token is before '&'", () => {
    expect(isAccessory("Ps5 Cooling & Dual Controller Charging Dock", ["ps5", "controller"])).toBe(true);
  });
});

describe("piece-count part listings (12c)", () => {
  it("a piece count plus a part noun is an accessory", () => {
    expect(isStrongAccessory("Dustproof 30PCS Outemu Switch Mechanical Keyboard", ["mechanical", "keyboard"], [["mechanical", "keyboard"]])).toBe(true);
  });
  it("a multi-pack of the product itself is not", () => {
    expect(isStrongAccessory("3PCS 100W USB Type C Cable", ["usb-c", "cable", "100w"], [["usb-c", "cable", "100w"]])).toBe(false);
  });
});

describe("anc aliases (12c)", () => {
  it("call noise reduction (ENC) is not ANC", () => {
    expect(matchesAllTokens([["anc", "earbuds"]], "Lenovo XT88 TWS Earbuds ENC Noise Reduction")).toBe(false);
    expect(matchesAllTokens([["anc", "earbuds"]], "Anker Soundcore R50i NC True Wireless Earbuds")).toBe(true);
  });
});

describe("12d round 1: accessory-category queries, 'replacement' position", () => {
  const wc = [["wireless", "charger", "15w"]];
  it("a charger query keeps chargers described with accessory words", () => {
    const ps = [
      prod("15W Wireless Charger Stand Pad Fast Charging Dock Station For iPhone", 11, "a"),
      prod("Car Phone Holder Wireless Charger 15W Air Vent Mount", 16, "b"),
      prod("Anker 3-in-1 Wireless Charger 15W", 270, "c"),
      prod("Silicone Case for Wireless Charger 15W", 9, "d"),
    ];
    expect(dropAccessories(ps, wc[0], wc).map((p) => p.id)).toEqual(["a", "b", "c"]);
  });
  it("a leading 'For' needs an accessory word the query does not name", () => {
    expect(isForAccessory("For MagSafe Charger for iPhone - 15W Fast Wireless Charging", [["wireless", "charger"]])).toBe(false);
    expect(isForAccessory("For iPhone 16 Silicone Case", [["iphone", "16"]])).toBe(true);
  });
  it("'replacement' marks a part only before the product noun", () => {
    const t = [["electric", "toothbrush"]];
    expect(isStrongAccessory("Replacement Brush Heads for Oral-B Electric Toothbrush", t[0], t)).toBe(true);
    expect(isStrongAccessory("Seago Electric Toothbrush USB Rechargeable 4 Replacement Heads", t[0], t)).toBe(false);
  });
});

describe("12d round 2: product lines name their brand", () => {
  it("an iPad query gets the brand price check (Android clones titled 'iPad Air Pro')", () => {
    const ps = [
      ["2026 iPad Air Pro 11 inch Android 16 Tablet 24GB 2TB", 312], ["Apple iPad Air 11-inch M3 128GB", 2499],
      ["Apple iPad Air 13-inch M3 256GB", 3599], ["Apple iPad Air 11-inch M2 Wi-Fi", 2299], ["Apple iPad Air M3 512GB", 3999],
    ].map(([t, pr], i) => prod(t as string, pr as number, String(i)));
    const out = applyBrandPriceRules(ps, ["ipad", "air"]);
    expect(out.filter((p) => !p.weakMatch).map((p) => p.id)).toEqual(["1", "2", "3", "4"]);
    expect(out.find((p) => p.id === "0")?.weakMatch).toBe(true);
  });
});

describe("12d round 3: fastening and consumable part nouns", () => {
  it("12e: the 12d consumable part nouns are no longer in the list", () => {
    expect(isStrongAccessory("JUE-FISH Coffee Machine Descaler, Descaling Solution", ["coffee", "machine"], [["coffee", "machine"]])).toBe(false);
  });
  it("keeps the product whose features mention them", () => {
    expect(isStrongAccessory("Rotating Electric Toothbrush, 5 Cleaning Modes", ["electric", "toothbrush"], [["electric", "toothbrush"]])).toBe(false);
  });
});

describe("12d round 4: compound words open or closed", () => {
  it("matches a two-word query against the closed compound and back", () => {
    expect(matchesAllTokens([["dash", "cam"]], "70mai Dashcam A800 4K")).toBe(true);
    expect(matchesAllTokens([["air", "fryer"]], "Philips Airfryer XXL 7.3L")).toBe(true);
    expect(matchesAllTokens([["electric", "toothbrush"]], "Oral-B Electric Tooth Brush Pro 3")).toBe(true);
  });
  it("still needs every word", () => {
    expect(matchesAllTokens([["dash", "cam"]], "Action Cam 4K Waterproof")).toBe(false);
  });
});

describe("12d round 5: standard name equivalents; ISBN product codes", () => {
  it("matches abbreviations and equivalent names", () => {
    expect(matchesAllTokens([["dash", "cam"]], "XUSHIDZ 1080P Dash Camera Night Vision")).toBe(true);
    expect(matchesAllTokens([["external", "ssd", "1tb"]], "SanDisk 1TB Portable SSD USB-C")).toBe(true);
    expect(matchesAllTokens([["external", "ssd", "1tb"]], "External 1TB Solid State Drive USB 3.2")).toBe(true);
    expect(matchesAllTokens([["running", "shoes"]], "Men Mesh Running Sneakers Lightweight")).toBe(true);
  });
  it("an ISBN-13 product code is a book unless the query asks for one", () => {
    expect(isBookCode("9789363382367", ["dash", "cam"])).toBe(true);
    expect(isBookCode("9789363382368", ["dash", "cam"])).toBe(false);
    expect(isBookCode("9789363382367", ["dash", "cam", "book"])).toBe(false);
    expect(isBookCode("B0CHX1W1XY", ["dash", "cam"])).toBe(false);
  });
});

describe("12d round 6: 'accessories' as a shop category label", () => {
  const v = [["dash", "cam"]];
  it("is not a candidate well after the product noun", () => {
    expect(isAccessory("2.4 Inch Dashcam Car Camera HD 1080P Dash Cam Recorder Vehicle Accessories", v[0], v)).toBe(false);
  });
  it("still counts right after the product noun or before it", () => {
    expect(isAccessory("Dash Cam Accessories Kit", v[0], v)).toBe(true);
    expect(isAccessory("Accessories for Dash Cam", v[0], v)).toBe(true);
  });
});

describe("brand price tiers (12e)", () => {
  const at = (rows: [string, number, string][]) => rows.map(([t, pr, site], i) => ({ ...prod(t, pr, String(i)), site }));
  const switch2 = at([
    ["Nintendo Switch 2 Game - Metroid Prime 4", 105, "a"], ["Nintendo Switch 2 Amiibo Samus", 119, "b"],
    ["Nintendo Switch2 Ac Adapter", 120, "c"], ["EA Sports FC26 - Nintendo Switch 2", 120, "c"],
    ["Nintendo Switch 2 Donkey Kong Bananza", 293, "b"], ["Nintendo Switch 2 Joy-Con 2 Pair", 350, "b"],
    ["Nintendo Switch 2 Mario Kart World", 323, "c"], ["Nintendo Switch 2 Pro Controller", 339, "d"],
    ["Nintendo Switch 2 Console", 2049, "b"], ["Nintendo Switch 2 Standalone", 2049, "c"],
    ["Nintendo Switch 2 + Mario Kart World Bundle", 2397, "c"], ["Nintendo Switch 2 Console (KSA)", 2299, "b"],
  ]);
  it("keeps only the upper price tier when the ecosystem outnumbers the product", () => {
    expect(applyBrandPriceRules(switch2, ["nintendo", "switch", "2"]).map((p) => p.listPrice)).toEqual([2049, 2049, 2397, 2299]);
  });
  it("no split when the tiers are close (one product line, several models)", () => {
    const phones = at([["iPhone 16 128GB", 2999, "a"], ["iPhone 16 Plus", 3499, "b"], ["iPhone 16 Pro", 4299, "a"], ["iPhone 16 Pro Max", 5199, "c"], ["iPhone 16 256GB", 3399, "b"]]);
    expect(tierCutoff(phones)).toBeNull();
  });
  it("no split when the upper tier is one store", () => {
    const one = switch2.map((p) => (p.listPrice > 1000 ? { ...p, site: "b" } : p));
    expect(tierCutoff(one)).toBeNull();
  });
});

describe("brand + category queries keep the cheapest genuine products (final review C1)", () => {
  const at = (rows: [string, number, string][]) => rows.map(([t, pr, site], i) => ({ ...prod(t, pr, String(i)), site }));
  const jbl = at([
    ["JBL Go 3 Portable Waterproof Speaker", 119, "a"], ["JBL Go 4 Portable Bluetooth Speaker", 149, "b"],
    ["JBL Clip 4 Portable Speaker", 199, "c"], ["JBL Clip 5 Ultra-Portable Speaker", 219, "a"],
    ["JBL Charge 5 Portable Speaker", 899, "b"], ["JBL Charge 5 Wireless Speaker Blue", 929, "c"],
    ["JBL Flip 6 Portable Speaker", 949, "a"], ["JBL Xtreme 4 Speaker", 1799, "b"],
    ["JBL Boombox 3 Speaker", 2299, "c"], ["JBL PartyBox 310 Speaker", 2499, "a"],
  ]);
  const logi = at([
    ["Logitech M170 Wireless Mouse", 45, "a"], ["Logitech M171 Wireless Mouse", 49, "b"],
    ["Logitech M190 Full-Size Wireless Mouse", 59, "c"], ["Logitech Pebble M350 Wireless Mouse", 79, "a"],
    ["Logitech M240 Silent Bluetooth Mouse", 79, "b"], ["Logitech MX Anywhere 3S Mouse", 299, "c"],
    ["Logitech MX Master 3S Wireless Mouse", 399, "a"], ["Logitech MX Master 3S Performance Mouse", 409, "b"],
    ["Logitech G502 X Plus Gaming Mouse", 549, "c"], ["Logitech MX Master 3S for Mac", 429, "a"],
  ]);
  const anker = at([
    ["Anker 313 Power Bank 10000mAh", 69, "a"], ["Anker PowerCore 10000 Power Bank", 79, "b"],
    ["Anker 321 Power Bank 5200mAh", 59, "c"], ["Anker 737 Power Bank 24000mAh 140W", 499, "a"],
    ["Anker Prime Power Bank 26250mAh 300W", 699, "b"], ["Anker 733 Power Bank GaNPrime", 459, "c"],
    ["Anker 548 Power Bank 60000mAh", 549, "a"],
  ]);
  it.each([
    ["jbl speaker", jbl, ["jbl", "speaker"]],
    ["logitech mouse", logi, ["logitech", "mouse"]],
    ["anker power bank", anker, ["anker", "power", "bank"]],
    // A spec number is not a model number (task 18, deferred final-review minor).
    ["anker 10000mah power bank", anker, ["anker", "10000mah", "power", "bank"]],
    ["anker power bank 20 w", anker, ["anker", "power", "bank", "20", "w"]],
    ["jbl speaker 30w", jbl, ["jbl", "speaker", "30w"]],
  ] as const)("%s: every product stays in the results", (_q, set, tokens) => {
    const out = applyBrandPriceRules([...set], [...tokens]);
    expect(out.map((p) => p.id).sort()).toEqual(set.map((p) => p.id).sort());
  });
  it("jbl speaker: the cheap tier is demoted to less likely, not removed", () => {
    const out = applyBrandPriceRules(jbl, ["jbl", "speaker"]);
    const go = out.find((p) => p.title.startsWith("JBL Go 3"));
    expect(go).toBeDefined();
    expect(out.filter((p) => p.listPrice >= 899).every((p) => !p.weakMatch)).toBe(true);
  });
  it("model numbers vs spec numbers (task 18 review: 'a'/'x' suffixes are model suffixes)", () => {
    const tok = (q: string) => q.split(" ");
    for (const q of ["google pixel 9a", "pixel 8a", "nothing phone 2a", "honor 8x", "iphone 16", "samsung galaxy s24", "macbook air m3", "sony wh-1000xm5", "xiaomi 14t", "oneplus 12r", "samsung a55", "sony ps5", "nintendo switch 2"])
      expect(hasModelNumber(tok(q)), q).toBe(true);
    for (const q of ["jbl 2 pack", "lg 65 inch", "anker 10000mah power bank", "anker power bank 20 w", "jbl speaker 30w", "sony 4k tv", "lg 1tb ssd"])
      expect(hasModelNumber(tok(q)), q).toBe(false);
  });
  it("'google pixel 9a' still drops a far-cheaper clone", () => {
    const pixels = at([
      ["Pixel 9a Clone Smartphone", 120, "a"], ["Google Pixel 9a 128GB Obsidian", 1899, "b"],
      ["Google Pixel 9a 256GB Porcelain", 2099, "c"], ["Google Pixel 9a 128GB Iris", 1899, "a"], ["Google Pixel 9a 256GB Peony", 2149, "b"],
    ]);
    expect(applyBrandPriceRules(pixels, ["google", "pixel", "9a"]).map((p) => p.id)).toEqual(["1", "2", "3", "4"]);
  });
  it("a model-number query still drops the far-cheaper ecosystem (clones, games)", () => {
    const watches = at([
      ["Apple Watch Series 10 Clone Smart Watch", 70, "a"], ["Apple Watch Series 10 GPS 42mm", 1599, "b"],
      ["Apple Watch Series 10 GPS 46mm", 1699, "c"], ["Apple Watch Series 10 Cellular", 1999, "a"], ["Apple Watch Series 10 Titanium", 2999, "b"],
    ]);
    expect(applyBrandPriceRules(watches, ["apple", "watch", "series", "10"]).map((p) => p.id)).toEqual(["1", "2", "3", "4"]);
  });
});

describe("single-digit model numbers stay in the query (12e)", () => {
  it("'nintendo switch 2' needs the 2", () => {
    expect(matchesAllTokens([tokenizeKeepDigits("nintendo switch 2")], "Nintendo Switch OLED White")).toBe(false);
    expect(matchesAllTokens([tokenizeKeepDigits("nintendo switch 2")], "Nintendo Switch 2 Console")).toBe(true);
  });
});
