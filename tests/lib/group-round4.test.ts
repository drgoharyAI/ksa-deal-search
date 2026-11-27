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
/** Grouped as a two-store result set (lead-word brands and shared codes resolved). */
const grouped = (a: string, b: string) => groupProducts([P("amazon-sa", "1", a), P("noon-sa", "2", b)]).some((g) => g.members.length === 2);

const apart: [string, string, string][] = [
  // Article suffix after a code.
  ["suffix /10 vs /30", "Philips Plastic Jar Blender 450W, HR2041/10, 1.9 L White", "Philips 3000 Series HR2041/30 Plastic Jar Blender with Mill & Chopper (450W, 1.9L)"],
  ["suffix /30 vs /50", "Philips Blender, Mill & Chopper, 450W, 1.9L White, HR2041/30", "Philips 2-In-1 Electric Blender 1.9 L 450 W HR2041/50 White"],
  ["suffix with other words differing", "Philips Sonicare 1100 Series Electric Toothbrush HX3641/01", "Sonicare Philips 1100 Electric Rechargeable Power Toothbrush, White Grey HX3641/02"],
  ["suffix lists without a common one", "Philips Air Fryer, HD9200/90, Black", "Philips Air fryer Essential 4.1 L 1400 W HD9200/20 / HD9200/21 / HD9200/11 White"],
  // Weight and volume.
  ["grams", "CeraVe Moisturising Cream 340g", "CeraVe Moisturising Cream 454g"],
  ["grams vs kg", "Nido Fortified Milk Powder 900g", "Nido Fortified Milk Powder 1.8kg"],
  ["g vs kg", "Lavazza Qualita Oro Coffee Beans 250g", "Lavazza Qualita Oro Coffee Beans 1kg"],
  ["decimal pounds", "Optimum Nutrition Gold Standard Whey 2.5 lb Chocolate", "Optimum Nutrition Gold Standard Whey 5.5 lb Chocolate"],
  ["ounces", "Davidoff Cool Water EDT 4.2 oz", "Davidoff Cool Water EDT 6.7 oz"],
  ["fluid ounces", "Stanley Quencher Tumbler 30 fl oz Cream", "Stanley Quencher Tumbler 40 fl oz Cream"],
  ["millilitres", "Nivea Soft Cream 200ml", "Nivea Soft Cream 300ml"],
  ["a 5 g pack is not 5G", "Baraka Saffron Threads 5g", "Baraka Saffron Threads 10g"],
  ["milligrams", "Panadol Extra Tablets 500 mg", "Panadol Extra Tablets 650 mg"],
  // Other dimensions.
  ["sensor DPI in thousands", "Logitech G PRO 2 LIGHTSPEED Wireless Gaming Mouse, 44K DPI Sensor", "Logitech G PRO 2 LIGHTSPEED Wireless Gaming Mouse, 32K DPI Sensor"],
  ["bluetooth version spelled out", "Anker Soundcore 2 Portable Speaker, Bluetooth 5, Black", "Anker Soundcore 2 Portable Speaker, Bluetooth Version 6.0, Black"],
  ["voltage", "Bosch Cordless Drill Professional 12V", "Bosch Cordless Drill Professional 18V"],
  ["tons", "Gree Split Air Conditioner 1.5 Ton Inverter", "Gree Split Air Conditioner 2 Ton Inverter"],
  ["karat", "Lazurde Gold Ring 18K", "Lazurde Gold Ring 21K"],
  ["width x length", "IKEA Lohals Rug Jute 160x230 cm", "IKEA Lohals Rug Jute 200x300 cm"],
  ["aperture", "Sigma 35mm f/1.4 Art Lens for Sony", "Sigma 35mm f/1.8 Art Lens for Sony"],
  ["N x size multi-pack", "Colgate Total Toothpaste 75ml", "Colgate Total Toothpaste 3 x 75ml"],
  ["twin pack", "Dettol Hand Wash Original 200ml", "Dettol Hand Wash Original 200ml Twin Pack"],
  ["clothing size letter", "Nike Dri-FIT Running T-Shirt Size M Black", "Nike Dri-FIT Running T-Shirt Size L Black"],
  ["roman numerals after a code", "Sony Cyber-shot DSC-RX100 VII Camera", "Sony Cyber-shot DSC-RX100 III Camera"],
  // Variant families.
  ["keyboard layout", "Logitech MX Keys S Wireless Keyboard Arabic Layout Graphite", "Logitech MX Keys S Wireless Keyboard English Layout Graphite"],
  ["layout short forms", "Keychron K2 Wireless Mechanical Keyboard US Layout", "Keychron K2 Wireless Mechanical Keyboard UK Layout"],
  ["layout on one side", "Apple Magic Keyboard with Touch ID - Arabic", "Apple Magic Keyboard with Touch ID"],
  ["gender", "Adidas Ultraboost Light Running Shoes Men Black", "Adidas Ultraboost Light Running Shoes Women Black"],
  ["connector", "Apple AirPods Pro 2 with MagSafe Charging Case (USB-C)", "Apple AirPods Pro 2 with MagSafe Charging Case (Lightning)"],
  ["sim count", "Samsung Galaxy A55 Dual SIM 256GB 8GB RAM", "Samsung Galaxy A55 Single SIM 256GB 8GB RAM"],
  ["counted feature", "Fun Moment 2-Way Baby Stroller Foldable Lightweight Travel Stroller", "Fun Moment Lightweight and Foldable Travel Stroller for Baby"],
  // Accessory sold alone.
  ["band for the watch", "Apple Watch Ultra 2 49mm Titanium Case Black Trail Loop", "Trail Loop Band for Apple Watch Ultra 2 49mm Black"],
  ["strap for the watch", "Samsung Galaxy Watch7 44mm Green", "Strap for Samsung Galaxy Watch7 44mm Green"],
  ["third-party part with the product's code", "Dyson V8 Absolute Vacuum SV25", "Replacement-grade Battery Pack for Dyson V8 SV25"],
  ["refill", "Dior Sauvage EDP 100ml", "Dior Sauvage EDP 100ml Refill"],
  // Add-ons.
  ["add-on left of a conjunction", "Kenwood Blender BLP15 2L 500W", "Kenwood Blender BLP15, Mill & Chopper, 2L 500W"],
  ["extra add-on", "Braun Blender JB3060 with Extra Jar", "Braun Plastic Jar Blender JB3060"],
  ["lens kit", "Canon EOS R50 Mirrorless Camera with RF-S 18-45mm Lens", "Canon EOS R50 Mirrorless Camera Body Only"],
  ["camera kit word", "Canon EOS R50 Mirrorless Camera", "Canon EOS R50 Mirrorless Camera Kit"],
  ["anything extra", "Tefal Easy Fry EY2018 4.2L", "Tefal Easy Fry EY2018 4.2L with Extra Basket"],
  // Model marks.
  ["a trailing plus on a word", "Braun Series 9 Pro Shaver", "Braun Series 9 Pro+ Shaver"],
  ["a trailing plus on a number", "Michelin Primacy 4 205/55 R16", "Michelin Primacy 4+ 205/55 R16"],
  ["generation on one side only", "Logitech G203 2nd Gen Wired Gaming Mouse 8000 DPI", "Logitech G203 Wired Gaming Mouse 8000 DPI"],
  ["generation against another model number", "Apple AirPods Pro (2nd Generation)", "Apple AirPods Pro 3"],
  ["interface generation", "Lexar SL300 1TB Portable SSD USB 3.2 Gen 2", "Lexar SL300 1TB Portable SSD USB 3.2 Gen 2x2"],
  ["a colour word that is the model", "Philips Hue White Ambiance E27 Bulb", "Philips Hue White and Color Ambiance E27 Bulb"],
  ["cellular", "Samsung Galaxy Tab S9 FE 128GB Wi-Fi", "Samsung Galaxy Tab S9 FE 128GB LTE"],
  ["connector with a shared code", "Apple AirPods Pro 2 MTJV3 USB-C", "Apple AirPods Pro 2 MTJV3 Lightning"],
  ["twin pack with a shared code", "Philips Avent Bottle SCY903 260ml Twin Pack", "Philips Avent Bottle SCY903 260ml"],
];

const merge: [string, string, string][] = [
  ["suffix against the bare code", "Philips Garment Steamer 3000 Series HR3030/01", "Philips 3000 Series Garment Steamer HR3030"],
  ["the same suffix", "Philips Blender & Mill, 450W, 1.9L, White, HR2041/10", "Philips 3000 Series Blender 1.9 L 450 W HR2041/10 White"],
  ["different suffix, only the colour differs", "Philips Essential Airfryer HD9200/90 Black", "Philips Essential Airfryer HD9200/20 White"],
  ["a suffix list sharing one", "Philips Dual Basket Airfryer 9 L 2750 W NA350/09 / NA350/00 Black", "Philips Dual Basket Airfryer 9L 2750W Black NA350/00"],
  ["kg = g", "Nido Fortified Milk Powder 1.8kg", "Nido Fortified Milk Powder 1800g"],
  ["lb = kg", "Optimum Nutrition Gold Standard Whey 5 lb Chocolate", "Optimum Nutrition Gold Standard Whey 2.27 kg Chocolate"],
  ["litres = millilitres", "Stanley Classic Vacuum Bottle 1L Green", "Stanley Classic Vacuum Bottle 1000ml Green"],
  ["K DPI = DPI", "Razer DeathAdder V3 Pro Mouse RZ01-04630100 30K DPI", "Razer DeathAdder V3 Pro Mouse RZ01-04630100 30000 DPI"],
  ["perfume short forms", "Dior Sauvage Eau de Parfum 100ml", "Dior Sauvage EDP 100 ml Perfume"],
  ["tyre size spacing", "Michelin Pilot Sport 4 225/45 R17 94Y", "Michelin 225/45R17 94Y Pilot Sport 4 Tyre"],
  ["codes in another order", "TP-Link Archer AX55 AX3000 Wi-Fi 6 Router", "TP-Link AX3000 Dual Band Gigabit Wi-Fi 6 Router Archer AX55"],
  ["piece count of a set", "LEGO Technic Ford Mustang Shelby GT500 42138", "LEGO 42138 Technic Ford Mustang Shelby GT500 Building Kit (544 Pieces)"],
  ["the code repeated", "Oscar Digital Air Fryer 3 Liter 1200W OAF3LDTB", "Oscar 3 Liter 1200W Digital Air Fryer Black OAF3LDTB OAF3LDTB"],
  ["an add-on the other names elsewhere", "Nikai Blender 1.5L with Grinder, Blender with Plastic Jar - NB1600TX", "Nikai 600W Blender with Grinder, 1.5L Plastic Jar NB1600TX"],
  ["wireless band is no weight", "Logitech M185 Wireless Mouse 2.4G Grey 75g", "Logitech M185 Wireless Mouse 2.4GHz Grey 75g"],
  ["mains voltage range", "Braun Series 3 Shaver 300s 100-240V", "Braun Series 3 Shaver 300s 220V"],
  ["own brand before the for-clause", "Anker 735 Charger Nano II 65W for iPhone", "Anker 735 Charger Nano II 65W"],
  ["generation as the model number", "Apple AirPods Pro (2nd Generation) White", "Apple AirPods Pro 2 White"],
  ["interface generation on one side", "Samsung 990 PRO 2TB PCIe 4.0 NVMe M.2 SSD MZ-V9P2T0BW", "Samsung 990 Pro NVMe M.2 SSD 2TB, PCIe Gen4, MZ-V9P2T0BW"],
  ["a spec after the code", "Krups Coffee Machine SA403BM0", "Krups Coffee Machine SA403BM0 1.8 L 1370 W SA403BM0 Grey"],
  ["versions listed by one side", "Ecovacs Deebot T50S Robot Vacuum, TruEdge 2.0, ZeroTangle 3.0", "Ecovacs Deebot T50S Robot Vacuum, ZeroTangle 3.0"],
];

describe("round 4: must stay apart", () => {
  for (const [name, a, b] of apart)
    it(name, () => {
      expect(same(a, b)).toBe(false);
      expect(grouped(a, b)).toBe(false);
    });
});

describe("round 4: must group", () => {
  for (const [name, a, b] of merge) it(name, () => expect(grouped(a, b)).toBe(true));
});

describe("round 4: features", () => {
  it("reads weights in grams to three digits", () => {
    expect([...titleFeatures("Whey 5 lb").specs.get("wt")!]).toEqual(["2270"]);
    expect([...titleFeatures("Whey 2.27 kg").specs.get("wt")!]).toEqual(["2270"]);
    expect([...titleFeatures("Cream 454 g").specs.get("wt")!]).toEqual(["454"]);
  });
  it("keeps a code's suffixes", () => {
    const f = titleFeatures("Philips Airfryer NA150/00/09 black");
    expect([...f.codes]).toEqual(["NA150"]);
    expect([...f.codeSfx.get("NA150")!]).toEqual(["00", "09"]);
  });
  it("reads the brand an item is made for", () => {
    expect(titleFeatures("Trail Loop Band for Apple Watch Ultra 2").forBrand).toBe("apple");
    expect(titleFeatures("Trail Loop Band for Apple Watch Ultra 2").knownBrand).toBeUndefined();
    expect(titleFeatures("Apple Watch Ultra 2 for Men").forBrand).toBeUndefined();
  });
  it("does not read a set's piece count as a multi-pack when the model number is shared", () => {
    expect(grouped("LEGO Star Wars Millennium Falcon 75257", "LEGO Star Wars Millennium Falcon 75257 (1351 Pieces)")).toBe(true);
    expect(grouped("Zwilling Pro 5-Piece Knife Block Set", "Zwilling Pro 7-Piece Knife Block Set")).toBe(false);
    expect(grouped("Duracell AA Batteries LR6", "Duracell AA Batteries LR6 24 pcs")).toBe(false);
  });
});
