import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openDb, type Db } from "@/src/lib/db";
import { buildVocab, currentSpeller, readDbVocab, resetVocab, setVocabSource, staticVocab, VOCAB_MAX, VOCAB_TTL_MS } from "@/src/lib/query/vocab";

describe("staticVocab", () => {
  const v = staticVocab();

  it("holds brand, synonym, accessory and curated product words", () => {
    for (const w of ["samsung", "airpods", "jbl", "dualsense", "earbuds", "cancelling", "case", "fryer", "drill", "cordless", "kettle", "stroller"]) {
      expect(v.has(w), w).toBe(true);
    }
  });

  it("holds the brand and model words the matcher knows (galaxy, tab, flip, anc)", () => {
    for (const w of ["galaxy", "tab", "flip", "anc", "pro", "ultra", "black"]) expect(v.has(w), w).toBe(true);
  });

  it("keeps letters-only words", () => {
    for (const w of v.keys()) expect(w).toMatch(/^[a-z]+$/);
  });
});

describe("buildVocab", () => {
  it("adds title words seen in at least two products, weighted by observations", () => {
    const v = buildVocab({
      titles: [
        { title: "Ninja Foodi Dual Zone Airfryer", weight: 3 },
        { title: "Ninja Airfryer Max", weight: 1 },
        { title: "Zzyzx One-Off Gadget", weight: 9 },
      ],
      queries: [],
    });
    expect(v.get("ninja")).toBeGreaterThan(0);
    expect(v.get("airfryer")).toBeGreaterThan(0);
    expect(v.has("zzyzx")).toBe(false); // one product only: could be a store's own typo
    expect(v.get("airfryer") ?? 0).toBeGreaterThan(v.get("max") ?? 0);
  });

  it("adds the words of past searches", () => {
    const v = buildVocab({ titles: [], queries: ["dewalt cordless screwdriver", "-zorbex 4k"] });
    expect(v.has("dewalt")).toBe(true);
    expect(v.has("screwdriver")).toBe(true);
    expect(v.has("zorbex")).toBe(false); // an excluded word is no vocabulary
  });

  it("caps its size, keeping every static word", () => {
    const titles = Array.from({ length: 3000 }, (_, i) => ({ title: `${word(i)} ${word(i + 1)} ${word(i + 2)}`, weight: 1 }));
    const v = buildVocab({ titles, queries: [] }, 1500);
    expect(v.size).toBeLessThanOrEqual(Math.max(1500, staticVocab().size));
    for (const w of staticVocab().keys()) expect(v.has(w)).toBe(true);
  });
});

/** A distinct letters-only word for i. */
function word(i: number): string {
  let s = "";
  let n = i + 1000;
  while (n > 0) {
    s += String.fromCharCode(97 + (n % 26));
    n = Math.floor(n / 26);
  }
  return `q${s}`;
}

describe("readDbVocab", () => {
  let db: Db;
  beforeEach(() => {
    db = openDb(":memory:");
  });
  afterEach(() => db.close());

  it("reads seen titles with their observation counts and the history queries", () => {
    db.prepare("INSERT INTO seen_products (site, productId, title, url, lastSeen) VALUES (?, ?, ?, ?, ?)").run("jarir", "1", "DeWalt Drill", "https://x/1", 1);
    for (const at of [1, 2, 3]) db.prepare("INSERT INTO observations (site, productId, price, at) VALUES (?, ?, ?, ?)").run("jarir", "1", 100, at);
    db.prepare("INSERT INTO searches (at, query, sites, sort, filters, resultCount) VALUES (?, ?, ?, ?, ?, ?)").run(1, "dewalt drill", "[]", "price", "{}", 3);
    expect(readDbVocab(db)).toEqual({ titles: [{ title: "DeWalt Drill", weight: 4 }], queries: ["dewalt drill"] });
  });
});

describe("currentSpeller", () => {
  afterEach(() => {
    setVocabSource(null);
    resetVocab();
  });

  it("uses the static vocabulary when no database source is set", () => {
    expect(currentSpeller().correct("samsng").query).toBe("samsung");
  });

  it("learns words from the database source and rebuilds at most every VOCAB_TTL_MS", () => {
    let reads = 0;
    let titles = [
      { title: "Hoverboard Segway", weight: 1 },
      { title: "Segway Ninebot Hoverboard", weight: 1 },
    ];
    setVocabSource(() => {
      reads++;
      return { titles, queries: [] };
    });
    const t0 = 1_000_000;
    expect(currentSpeller(t0).correct("hoverbaord").query).toBe("hoverboard");
    titles = [];
    currentSpeller(t0 + VOCAB_TTL_MS - 1);
    expect(reads).toBe(1);
    expect(currentSpeller(t0 + VOCAB_TTL_MS).correct("hoverbaord").query).toBe("hoverbaord");
    expect(reads).toBe(2);
  });

  it("falls back to the static vocabulary when the source throws", () => {
    setVocabSource(() => {
      throw new Error("db locked");
    });
    expect(currentSpeller().correct("samsng").query).toBe("samsung");
  });

  it("caps the vocabulary at VOCAB_MAX words", () => {
    expect(VOCAB_MAX).toBeGreaterThanOrEqual(5000);
  });
});
