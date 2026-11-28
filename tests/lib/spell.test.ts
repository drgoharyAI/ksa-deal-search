import { describe, it, expect } from "vitest";
import { osaDistance, Speller } from "@/src/lib/query/spell";

const vocab = (entries: Record<string, number>) => new Map(Object.entries(entries));

const WORDS = vocab({
  airpods: 50,
  pro: 80,
  jbl: 30,
  flip: 40,
  speaker: 60,
  cordless: 30,
  drill: 25,
  air: 70,
  fryer: 35,
  flyer: 1,
  samsung: 90,
  galaxy: 60,
  tab: 40,
  headphones: 50,
  wireless: 80,
  charger: 40,
  cable: 50,
  under: 10,
  stars: 10,
  play: 20,
  station: 5,
  playstation: 30,
  keyboard: 40,
  mechanical: 20,
  case: 50,
  cast: 3,
  vacuum: 30,
  robot: 20,
});

describe("osaDistance", () => {
  it("counts a transposition as one edit", () => {
    expect(osaDistance("airpdos", "airpods", 2)).toBe(1);
  });

  it("counts insertions, deletions and substitutions", () => {
    expect(osaDistance("fyer", "fryer", 2)).toBe(1);
    expect(osaDistance("flipp", "flip", 2)).toBe(1);
    expect(osaDistance("samsng", "samsung", 2)).toBe(1);
    expect(osaDistance("headphnes", "headphones", 2)).toBe(1);
    expect(osaDistance("hedphnes", "headphones", 2)).toBe(2);
  });

  it("stops past the limit (returns limit + 1)", () => {
    expect(osaDistance("keyboard", "airpods", 2)).toBe(3);
  });
});

describe("Speller.correct", () => {
  const sp = new Speller(WORDS);

  it("fixes a transposed brand word", () => {
    expect(sp.correct("airpdos pro")).toEqual({ query: "airpods pro", changed: true });
  });

  it("fixes the owner's examples", () => {
    expect(sp.correct("jbl flipp 6").query).toBe("jbl flip 6");
    expect(sp.correct("cordles drill").query).toBe("cordless drill");
    expect(sp.correct("air fyer").query).toBe("air fryer");
    expect(sp.correct("samsng galaxy tab").query).toBe("samsung galaxy tab");
  });

  it("allows two edits from 8 characters, one below", () => {
    expect(sp.correct("hedphnes").query).toBe("headphones");
    expect(sp.correct("chrgr").query).toBe("chrgr"); // 5 chars, 2 edits away: left alone
  });

  it("breaks ties by frequency", () => {
    // "fyer" is one edit from both "fryer" (35) and "flyer" (1).
    expect(sp.correct("fyer").query).toBe("fryer");
  });

  it("prefers a candidate with the same first letter", () => {
    // "cike" is one edit from both; "bike" is far more frequent.
    const s = new Speller(vocab({ bike: 100, cake: 1 }));
    expect(s.correct("cike").query).toBe("cake");
  });

  it("never changes a correct query", () => {
    for (const q of ["airpods pro", "jbl flip 6", "cordless drill", "samsung galaxy tab", "robot vacuum"]) {
      expect(sp.correct(q)).toEqual({ query: q, changed: false });
    }
  });

  it("leaves numbers, model codes, short tokens and operators alone", () => {
    const q = "wh1000xm5 s24 jbl tb -cse under 300 >4 stars usb-c 20000mah";
    expect(sp.correct(q)).toEqual({ query: q, changed: false });
  });

  it("leaves a plural or singular of a known word alone", () => {
    expect(sp.correct("chargers cables").changed).toBe(false);
  });

  it("leaves an unknown word with no close match alone", () => {
    expect(sp.correct("zxqvbnm").changed).toBe(false);
  });

  it("leaves non-Latin words alone", () => {
    expect(sp.correct("سماعة airpods").changed).toBe(false);
  });

  it("keeps the shopper's spacing and case on words it does not change", () => {
    expect(sp.correct("JBL  Flipp 6")).toEqual({ query: "JBL  flip 6", changed: true });
  });

  it("joins a split word into a known brand or compound", () => {
    const s = new Speller(WORDS, { joinable: new Set(["airpods", "playstation"]) });
    expect(s.correct("air pods pro").query).toBe("airpods pro");
    expect(s.correct("play station 5").query).toBe("playstation 5");
    // A pair that is not a known compound stays apart.
    expect(s.correct("air fryer").changed).toBe(false);
  });

  it("splits a run-together pair of known words", () => {
    expect(sp.correct("cordlessdrill").query).toBe("cordless drill");
    expect(sp.correct("robotvacuum").query).toBe("robot vacuum");
  });

  it("does not split a known word", () => {
    expect(sp.correct("playstation").changed).toBe(false);
  });

  it("protects listed words even when not frequent", () => {
    const s = new Speller(vocab({ case: 100 }), { protect: new Set(["cast"]) });
    expect(s.correct("cast").changed).toBe(false);
  });

  it("can treat the last word as a prefix (autocomplete)", () => {
    // "airp" is short anyway; "headph" is a prefix of "headphones", not a typo.
    expect(sp.correct("headph", { lastIsPrefix: true }).changed).toBe(false);
    expect(sp.correct("samsng headph", { lastIsPrefix: true }).query).toBe("samsung headph");
  });

  it("corrects a query in well under 5 ms with a 15,000-word vocabulary", () => {
    const big = new Map(WORDS);
    let seed = 7;
    const rnd = () => {
      seed = (Math.imul(seed, 1103515245) + 12345) >>> 0;
      return seed / 2 ** 32;
    };
    while (big.size < 15_000) {
      const len = 4 + Math.floor(rnd() * 8);
      let w = "";
      for (let i = 0; i < len; i++) w += String.fromCharCode(97 + Math.floor(rnd() * 26));
      big.set(w, 1 + Math.floor(rnd() * 5));
    }
    const s = new Speller(big);
    s.correct("warm up");
    const t0 = performance.now();
    const n = 50;
    for (let i = 0; i < n; i++) s.correct("samsng galaxy tabb headphnes cordles");
    expect((performance.now() - t0) / n).toBeLessThan(5);
  });
});
