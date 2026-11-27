import { describe, it, expect } from "vitest";
import {
  FAKE_WAS_NOTE, FROM_PRICE_NOTE, MAX_COMPARE, MIXED_CURRENCY_NOTE, NO_HISTORY, compareRows, keysFromSearch, onlyDifferences, readMemory, resolveSelection, sameCurrency, toggleKey,
  withCompareParam, writeMemory,
} from "@/src/lib/compare";
import { productKey } from "@/src/lib/specs";
import type { Product } from "@/src/lib/types";

const P = (id: string, o: Partial<Product> = {}): Product => ({
  site: "amazon-sa", id, title: `Item ${id}`, listPrice: 100, origPrice: null, discountPct: null, currency: "SAR",
  rating: null, soldCount: 0, image: "", url: "", detailStatus: "ok", ...o,
});

const row = (rows: ReturnType<typeof compareRows>, key: string) => rows.find((r) => r.key === key);

describe("compareRows (17c, U4)", () => {
  const a = P("a", { title: "Samsung Galaxy S24 8GB RAM 256GB", listPrice: 2999, origPrice: 3499, discountPct: 14.3, rating: 4.6, deal: { badge: "lowest-30d", label: "Lowest in 30 days" } });
  const b = P("b", { title: "Samsung Galaxy S24 8GB RAM 512GB", listPrice: 2799, finalPrice: 2799, site: "noon-sa", rating: 4.6 });
  const rows = compareRows([a, b]);

  it("the rows in order: store, price, original, discount, rating, brand, specs that have a value, deal check", () => {
    expect(rows.map((r) => r.key)).toEqual(["store", "price", "orig", "discount", "rating", "brand", "storage", "ram", "deal"]);
  });
  it("formats each cell; missing values are null", () => {
    expect(row(rows, "store")!.cells).toEqual(["Amazon KSA", "noon KSA"]);
    expect(row(rows, "price")!.cells).toEqual(["SAR 2,999", "SAR 2,799"]);
    expect(row(rows, "orig")!.cells).toEqual(["SAR 3,499", null]);
    expect(row(rows, "discount")!.cells).toEqual(["−14%", null]);
    expect(row(rows, "discount")!.label).toBe("Store discount");
    expect(row(rows, "rating")!.cells).toEqual(["4.6 of 5", "4.6 of 5"]);
    expect(row(rows, "brand")!.cells).toEqual(["Samsung", "Samsung"]);
    expect(row(rows, "deal")!.cells).toEqual(["Lowest in 30 days", null]);
    expect(row(rows, "storage")!.cells).toEqual(["256 GB", "512 GB"]);
  });
  it("flags rows whose values differ, a missing value counting as different", () => {
    expect(row(rows, "storage")!.differs).toBe(true);
    expect(row(rows, "ram")!.differs).toBe(false);
    expect(row(rows, "rating")!.differs).toBe(false);
    expect(row(rows, "orig")!.differs).toBe(true);
  });
  it("flags each cell that differs from the row's majority value; no majority means all differ", () => {
    const three = compareRows([P("x", { rating: 4 }), P("y", { rating: 4 }), P("z", { rating: 3 })]);
    expect(row(three, "rating")!.diff).toEqual([false, false, true]);
    expect(row(rows, "storage")!.diff).toEqual([true, true]);
    expect(row(rows, "ram")!.diff).toEqual([false, false]);
  });
  it("drops a spec row no product has", () => {
    expect(rows.find((r) => r.key === "wattage")).toBeUndefined();
  });
});

describe("lowest price: same currency only", () => {
  it("marks the lowest price, ties included, when every price is in one currency", () => {
    const rows = compareRows([P("x", { listPrice: 300 }), P("y", { listPrice: 250 })]);
    expect(row(rows, "price")!.lowest).toEqual([false, true]);
    expect(row(rows, "price")!.note).toBeUndefined();
    expect(row(compareRows([P("x"), P("y"), P("z", { listPrice: 200 })]), "price")!.lowest).toEqual([true, true, false]);
  });
  it("an empty currency is the stores' SAR", () => {
    expect(sameCurrency([P("x"), P("y", { currency: "" })])).toBe(true);
    expect(row(compareRows([P("x", { listPrice: 90 }), P("y", { currency: "" })]), "price")!.lowest).toEqual([true, false]);
  });
  it("mixed currencies: nothing is marked and the row says they are not compared", () => {
    const rows = compareRows([P("x", { listPrice: 300 }), P("y", { listPrice: 50, currency: "USD" })]);
    expect(row(rows, "price")!.lowest).toBeUndefined();
    expect(row(rows, "price")!.note).toBe(MIXED_CURRENCY_NOTE);
    expect(sameCurrency([P("x"), P("y", { currency: "USD" })])).toBe(false);
  });
  it("no 'lowest' when every price is the same", () => {
    expect(row(compareRows([P("x"), P("y")]), "price")!.lowest).toBeUndefined();
  });
});

describe("missing is not zero", () => {
  it("a value no store gave is null; a real zero stays a value", () => {
    const rows = compareRows([P("x", { title: "kettle", rating: 0, listPrice: 0 }), P("y", { title: "toaster", rating: null })]);
    expect(row(rows, "rating")!.cells).toEqual(["0.0 of 5", null]);
    expect(row(rows, "price")!.cells[0]).toBe("SAR 0");
    expect(row(rows, "orig")!.cells).toEqual([null, null]);
    expect(row(rows, "brand")!.cells).toEqual([null, null]);
  });
  it("a sold row only when a store gave a count; others say nothing, not 0", () => {
    expect(row(compareRows([P("x"), P("y")]), "sold")).toBeUndefined();
    const rows = compareRows([P("x", { site: "aliexpress", soldCount: 1200 }), P("y")]);
    expect(row(rows, "sold")!.cells).toEqual(["1,200 sold", null]);
  });
  it("a trend row only when our history has one", () => {
    expect(row(compareRows([P("x"), P("y")]), "trend")).toBeUndefined();
    const t = { points: [{ day: 20, price: 120 }, { day: 29, price: 100 }], changePct7d: -12 };
    const rows = compareRows([P("x", { trend: t }), P("y", { trend: { points: t.points } })]);
    expect(row(rows, "trend")!.cells).toEqual(["Down 12% vs last week", "10 days of prices"]);
  });
  it("a fake deal's 'was' price is shown struck, but its discount is not verified", () => {
    const rows = compareRows([P("x", { origPrice: 150, deal: { badge: "fake-deal", label: "Fake deal" } }), P("y")]);
    expect(row(rows, "orig")!.cells[0]).toBe("SAR 150");
    expect(row(rows, "discount")!.cells[0]).toBeNull();
    expect(row(rows, "deal")!.cells[0]).toBe("Fake deal");
  });
});

describe("spec alignment and brand", () => {
  it("specs line up by key, whatever order the titles give them in", () => {
    const rows = compareRows([P("x", { title: "Laptop 16GB RAM 512GB SSD" }), P("y", { title: "Laptop 1TB SSD" }), P("z", { title: "Laptop 8GB RAM" })]);
    expect(row(rows, "ram")!.cells).toEqual(["16 GB", null, "8 GB"]);
    expect(row(rows, "storage")!.cells).toEqual(["512 GB", "1 TB", null]);
  });
  it("the brand map from the whole result set wins over the compared few", () => {
    const x = P("x", { title: "Soundcore Liberty 4" });
    const y = P("y", { title: "Other earbuds" });
    expect(row(compareRows([x, y]), "brand")!.cells).toEqual([null, null]);
    const brands = new Map([[productKey(x), "soundcore"], [productKey(y), undefined]]);
    expect(row(compareRows([x, y], { brands }), "brand")!.cells).toEqual(["Soundcore", null]);
  });
});

describe("show only differences", () => {
  it("keeps only the rows whose values are not all the same", () => {
    const rows = compareRows([P("x", { title: "Phone 8GB RAM 256GB", rating: 4.5 }), P("y", { title: "Phone 8GB RAM 512GB", rating: 4.5, listPrice: 120 })]);
    const diff = onlyDifferences(rows).map((r) => r.key);
    expect(diff).toEqual(["price", "storage"]);
    expect(diff).not.toContain("ram");
    expect(diff).not.toContain("rating");
    expect(rows.length).toBeGreaterThan(diff.length);
  });
  it("a value missing on one side counts as a difference", () => {
    expect(onlyDifferences(compareRows([P("x", { rating: 4 }), P("y")])).map((r) => r.key)).toContain("rating");
  });
});

describe("the selection: max items", () => {
  it("adds, removes, and refuses one past the limit", () => {
    let keys: string[] = [];
    for (const id of ["a", "b", "c", "d"]) keys = toggleKey(keys, productKey(P(id))).keys;
    expect(keys).toHaveLength(MAX_COMPARE);
    const full = toggleKey(keys, "amazon-sa+e");
    expect(full.full).toBe(true);
    expect(full.keys).toBe(keys);
    expect(toggleKey(keys, "amazon-sa+b")).toEqual({ keys: ["amazon-sa+a", "amazon-sa+c", "amazon-sa+d"], full: false });
  });
  it("unticking at the limit is never refused", () => {
    const keys = ["amazon-sa+a", "amazon-sa+b", "amazon-sa+c", "amazon-sa+d"];
    expect(toggleKey(keys, "amazon-sa+a").full).toBe(false);
  });
});

describe("the selection in the URL", () => {
  it("round-trips keys through cmp=, keeping the other params", () => {
    const keys = ["noon-sa+N53432", "aliexpress+1005006"];
    const qs = withCompareParam("?store=jarir&disc=1", keys);
    expect(qs).toContain("store=jarir");
    expect(qs).toContain("disc=1");
    expect(keysFromSearch(qs)).toEqual(keys);
    expect(withCompareParam(qs, [])).toBe("?store=jarir&disc=1");
    expect(withCompareParam("", [])).toBe("");
  });
  it("reads a hand-typed '+' (a space once decoded)", () => {
    expect(keysFromSearch("?cmp=jarir+123,amazon-sa%2BB0X")).toEqual(["jarir+123", "amazon-sa+B0X"]);
  });
  it("drops unknown stores, empty or malformed keys and repeats; caps at the limit", () => {
    expect(keysFromSearch("?cmp=evil+1,jarir+,+5,nokey,jarir%2B1,jarir%2B1")).toEqual(["jarir+1"]);
    expect(keysFromSearch(`?cmp=jarir%2B${"x".repeat(200)}`)).toEqual([]);
    expect(keysFromSearch("?cmp=jarir%2B1,jarir%2B2,jarir%2B3,jarir%2B4,jarir%2B5")).toHaveLength(MAX_COMPARE);
    expect(keysFromSearch("?q=x")).toEqual([]);
  });
  it("a known key the results no longer have stays, marked missing, never dropped", () => {
    const live = P("a");
    const byKey = new Map([[productKey(live), live]]);
    const slots = resolveSelection(["amazon-sa+a", "noon-sa+gone", "jarir+old"], byKey, { "jarir+old": { title: "Old kettle", image: "https://x/i.jpg" } });
    expect(slots.map((s) => [s.key, s.site, s.product?.id ?? null])).toEqual([
      ["amazon-sa+a", "amazon-sa", "a"],
      ["noon-sa+gone", "noon-sa", null],
      ["jarir+old", "jarir", null],
    ]);
    expect(slots[1].snap).toBeNull();
    expect(slots[2].snap).toEqual({ title: "Old kettle", image: "https://x/i.jpg" });
    expect(slots[0].snap?.title).toBe("Item a");
  });
});

describe("this tab's memory (sessionStorage)", () => {
  const store = () => {
    const m = new Map<string, string>();
    return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) } as unknown as Storage;
  };
  it("writes and reads the query, stores and snaps; clears to null", () => {
    const s = store();
    writeMemory(s, { query: "airpods 4", sites: ["jarir", "nope"], snaps: { "jarir+1": { title: "AirPods 4", image: "" } } });
    expect(readMemory(s)).toEqual({ query: "airpods 4", sites: ["jarir"], snaps: { "jarir+1": { title: "AirPods 4", image: "" } } });
    writeMemory(s, null);
    expect(readMemory(s)).toBeNull();
  });
  it("ignores junk and missing storage", () => {
    const s = store();
    s.setItem("deal-search:compare", "{not json");
    expect(readMemory(s)).toBeNull();
    s.setItem("deal-search:compare", JSON.stringify({ query: 1 }));
    expect(readMemory(s)).toBeNull();
    expect(readMemory(undefined)).toBeNull();
    expect(() => writeMemory(undefined, null)).not.toThrow();
  });
});

describe('"from" prices (fix round 1)', () => {
  const ali = (id: string, price: number) => P(id, { site: "aliexpress", listPrice: price });
  it('keeps "from" in the price cell', () => {
    const r = row(compareRows([ali("x", 72.39), P("y", { listPrice: 150 })]), "price")!;
    expect(r.cells).toEqual(["from SAR 72.39", "SAR 150"]);
    expect(r.from).toEqual([true, false]);
  });
  it('never marks a "from" price lowest against a fixed one, and says why when it is the cheapest', () => {
    const r = row(compareRows([ali("x", 72), P("y", { listPrice: 150 }), P("z", { listPrice: 120, site: "noon-sa" })]), "price")!;
    expect(r.lowest).toEqual([false, false, true]);
    expect(r.note).toBe(FROM_PRICE_NOTE);
  });
  it('one fixed price against "from" prices: nothing is marked lowest', () => {
    const r = row(compareRows([ali("x", 72), ali("w", 80), P("y", { listPrice: 150 })]), "price")!;
    expect(r.lowest).toBeUndefined();
    expect(r.note).toBe(FROM_PRICE_NOTE);
  });
  it('a fixed price cheaper than every "from" price is marked, with no note', () => {
    const r = row(compareRows([ali("x", 200), P("y", { listPrice: 150 }), P("z", { listPrice: 120, site: "noon-sa" })]), "price")!;
    expect(r.lowest).toEqual([false, false, true]);
    expect(r.note).toBeUndefined();
  });
  it("mixed currencies still win: nothing is marked", () => {
    const r = row(compareRows([ali("x", 20), P("y", { listPrice: 150 }), P("z", { listPrice: 50, currency: "USD" })]), "price")!;
    expect(r.lowest).toBeUndefined();
    expect(r.note).toBe(MIXED_CURRENCY_NOTE);
  });
});

describe("deal check and fake 'was' notes (fix round 1)", () => {
  it('no history reads "No price history yet", not "Not listed"', () => {
    const r = row(compareRows([P("x"), P("y", { deal: { badge: "normal", label: "Usual price" } })]), "deal")!;
    expect(r.cells).toEqual([null, "Usual price"]);
    expect(r.empty).toBe(NO_HISTORY);
  });
  it("a fake-deal 'was' price carries a note; others none", () => {
    const r = row(compareRows([P("x", { origPrice: 150, deal: { badge: "fake-deal", label: "Fake deal" } }), P("y", { origPrice: 120 })]), "orig")!;
    expect(r.cellNotes).toEqual([FAKE_WAS_NOTE, null]);
    expect(row(compareRows([P("x", { origPrice: 150 }), P("y")]), "orig")!.cellNotes).toBeUndefined();
  });
});
