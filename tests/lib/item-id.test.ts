import { describe, expect, it } from "vitest";
import { itemId } from "@/src/lib/item-id";
import { normalizeSearchItem as aliexpress } from "@/src/sites/aliexpress/search";
import { normalizeSearchItem as amazon } from "@/src/sites/amazon-sa/search";
import { normalizeSearchItem as extra } from "@/src/sites/extra-sa/search";
import { normalizeSearchItem as jarir } from "@/src/sites/jarir/search";
import { normalizeSearchItem as trendyol } from "@/src/sites/trendyol-sa/search";

describe("itemId (task 18: object ids no longer become '[object Object]')", () => {
  it("keeps strings and finite numbers", () => {
    expect(itemId("B0C1")).toBe("B0C1");
    expect(itemId(682538)).toBe("682538");
    expect(itemId(0)).toBe("0");
  });
  it("rejects missing, blank, non-finite and object ids", () => {
    for (const v of [undefined, null, "", "  ", NaN, Infinity, { id: 1 }, [1], true]) expect(itemId(v)).toBeNull();
  });
  it("every API adapter drops an item whose id is an object", () => {
    const items: [(raw: unknown) => unknown, Record<string, unknown>][] = [
      [aliexpress, { title: "Earbuds", price: 50, currency: "SAR" }],
      [amazon, { title: "Earbuds", price: "50", url: "/dp/B0C1" }],
      [extra, { title: "Earbuds", price: 50, url: "https://www.extra.com/en-sa/p/1" }],
      [jarir, { title: "Earbuds", price: "50", path: "earbuds-1" }],
      [trendyol, { title: "Earbuds", price: 50, path: "/earbuds-p-1" }],
    ];
    for (const [normalize, raw] of items) {
      expect(normalize({ ...raw, id: "1" })).not.toBeNull(); // control: a valid id is kept
      expect(normalize({ ...raw, id: { value: "1" } })).toBeNull();
    }
  });
});
