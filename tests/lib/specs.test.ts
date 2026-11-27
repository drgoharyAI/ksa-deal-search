import { describe, it, expect } from "vitest";
import { brandOf, brandLabel, brandsFor, parseSpecs, modelCode } from "@/src/lib/specs";
import type { Product } from "@/src/lib/types";

const P = (id: string, title: string, o: Partial<Product> = {}): Product => ({
  site: "amazon-sa", id, title, listPrice: 10, origPrice: null, discountPct: null, currency: "SAR",
  rating: null, soldCount: 0, image: "", url: "", detailStatus: "ok", ...o,
});

describe("brandOf (17c)", () => {
  it("reads a known brand anywhere in the item's own part", () => {
    expect(brandOf("Original Samsung Galaxy S24 Ultra 256GB")).toBe("samsung");
    expect(brandOf("Sony WH-1000XM5 Wireless Headphones")).toBe("sony");
  });
  it("maps a product line to its brand", () => {
    expect(brandOf("iPhone 16 Pro Max 256GB")).toBe("apple");
    expect(brandOf("PlayStation 5 Slim Console")).toBe("sony");
    expect(brandOf("Galaxy Buds 3")).toBe("samsung");
  });
  it("ignores the brand a part is made for", () => {
    expect(brandOf("Spigen Case for iPhone 16")).toBe("spigen");
    expect(brandOf("Wireless Charger compatible with Samsung")).toBeUndefined();
  });
  it("takes a capitalised lead word, never a generic one", () => {
    expect(brandOf("Baseus 65W GaN Charger")).toBe("baseus");
    expect(brandOf("Wireless Earbuds Bluetooth 5.3")).toBeUndefined();
    expect(brandOf("portable blender")).toBeUndefined();
  });
});

describe("brandLabel", () => {
  it("title-cases, with known spellings", () => {
    expect(brandLabel("samsung")).toBe("Samsung");
    expect(brandLabel("hp")).toBe("HP");
    expect(brandLabel("oneplus")).toBe("OnePlus");
  });
});

describe("brandsFor", () => {
  it("keeps a lead-word brand only when two titles share it; known brands always", () => {
    const ps = [
      P("a", "Baseus 65W Charger"),
      P("b", "Baseus 20W Charger"),
      P("c", "Ugreen Cable"),
      P("d", "Anker 737 Power Bank"),
    ];
    const m = brandsFor(ps);
    expect(m.get("amazon-sa+a")).toBe("baseus");
    expect(m.get("amazon-sa+c")).toBeUndefined();
    expect(m.get("amazon-sa+d")).toBe("anker");
  });
});

describe("parseSpecs (17c)", () => {
  it("storage and RAM, including the 8GB+256GB phone form", () => {
    expect(parseSpecs("Galaxy S24 8GB RAM 256GB")).toMatchObject({ ram: "8 GB", storage: "256 GB" });
    expect(parseSpecs("Redmi Note 13 8GB+256GB")).toMatchObject({ ram: "8 GB", storage: "256 GB" });
    expect(parseSpecs("Samsung T7 SSD 1TB")).toMatchObject({ storage: "1 TB" });
    expect(parseSpecs("Laptop 16GB DDR5 512GB SSD")).toMatchObject({ ram: "16 GB", storage: "512 GB" });
  });
  it("wattage, capacity and screen size", () => {
    expect(parseSpecs("Anker 20,000mAh Power Bank 65W")).toMatchObject({ capacity: "20000 mAh", wattage: "65 W" });
    expect(parseSpecs('LG 27" Monitor')).toMatchObject({ size: "27 in" });
    expect(parseSpecs("Samsung 55-inch TV")).toMatchObject({ size: "55 in" });
    expect(parseSpecs("Blender 1200 Watts")).toMatchObject({ wattage: "1200 W" });
  });
  it("resolution, the highest named", () => {
    expect(parseSpecs("Samsung 55 inch 4K UHD Smart TV").resolution).toBe("4K");
    expect(parseSpecs("Monitor 2560x1440 QHD 165Hz").resolution).toBe("QHD");
    expect(parseSpecs("Webcam 1080p Full HD").resolution).toBe("Full HD");
    expect(parseSpecs("Dash cam 720p").resolution).toBe("HD");
    expect(parseSpecs("TV 8K").resolution).toBe("8K");
  });
  it("model codes, not specs", () => {
    expect(parseSpecs("Sony WH-1000XM5 Headphones").model).toBe("WH-1000XM5");
    expect(parseSpecs("Samsung Galaxy SM-S921B 256GB").model).toBe("SM-S921B");
    expect(parseSpecs("Charger 65W USB-C").model).toBeUndefined();
    expect(parseSpecs("iPhone16 Pro 256GB").model).toBeUndefined();
  });
  it("does not read 2-in-1 as an inch size or a code as a spec", () => {
    expect(parseSpecs("2 in 1 Laptop 14 inch").size).toBe("14 in");
    expect(parseSpecs("Sony WH-1000XM5").wattage).toBeUndefined();
  });
  it("empty when the title names none", () => {
    expect(parseSpecs("Cotton T-shirt")).toEqual({});
  });
});

describe("modelCode", () => {
  it("keeps the code's own spelling, first one only", () => {
    expect(modelCode("Logitech G502 Hero Mouse, model 910-005472")).toBe("G502");
    expect(modelCode("Razer DeathAdder V3 RZ01-04640100")).toBe("RZ01-04640100");
  });
});
