import { describe, it, expect } from "vitest";
import { MAX_CORRECT_CHARS, osaDistance, Speller } from "@/src/lib/query/spell";

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

  it("below 6 letters, only corrects to a word with the same first letter", () => {
    const s = new Speller(vocab({ bike: 100, fryer: 10 }));
    expect(s.correct("nike").changed).toBe(false); // an unknown brand, not a typo of "bike"
    expect(s.correct("fyer").query).toBe("fryer");
  });

  it("prefers a swap that keeps the length over a dropped letter", () => {
    // "iorn" is one swap from "iron" and one deletion from "ion" (frequent in "Li-ion" titles).
    expect(new Speller(vocab({ iron: 5, ion: 80 })).correct("steam iorn").query).toBe("steam iron");
  });

  it("breaks ties by frequency", () => {
    // "fyer" is one edit from both "fryer" (35) and "flyer" (1).
    expect(sp.correct("fyer").query).toBe("fryer");
  });

  it("prefers a candidate with the same first letter", () => {
    // "rater" is one added letter from both; "crater" is far more frequent.
    const s = new Speller(vocab({ crater: 100, rafter: 1 }));
    expect(s.correct("rater").query).toBe("rafter");
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
    // Only into a vocabulary word: "zorb box" stays apart though "zorbbox" is listed.
    expect(new Speller(WORDS, { joinable: new Set(["zorbbox"]) }).correct("zorb box").changed).toBe(false);
    // A pair that is not a known compound stays apart.
    expect(s.correct("air fryer").changed).toBe(false);
  });

  it("never splits a word (\"paperwhite\", \"quietcomfort\" are names)", () => {
    const s = new Speller(vocab({ paper: 50, white: 50, quiet: 20, comfort: 20, cordless: 30, drill: 30 }));
    for (const w of ["paperwhite", "quietcomfort", "cordlessdrill"]) expect(s.correct(w).changed, w).toBe(false);
  });

  it("does not split a known word", () => {
    expect(sp.correct("playstation").changed).toBe(false);
  });

  it("never corrects a dictionary word", () => {
    const s = new Speller(vocab({ sharp: 100, case: 100, plus: 100, cord: 100 }), { dictionary: new Set(["shark", "cast", "plug", "core"]) });
    expect(s.correct("shark cast plug core")).toEqual({ query: "shark cast plug core", changed: false });
  });

  it("substitutes a letter only toward a word clearly frequent in product titles", () => {
    // "vaccum" -> "vacuum" changes one letter: a real word or name could look like that.
    expect(new Speller(vocab({ vacuum: 5 })).correct("vaccum").changed).toBe(false);
    expect(new Speller(vocab({ vacuum: 5 }), { titleFreq: vocab({ vacuum: 3 }) }).correct("vaccum").changed).toBe(false);
    expect(new Speller(vocab({ vacuum: 25 }), { titleFreq: vocab({ vacuum: 20 }) }).correct("vaccum").query).toBe("vacuum");
    // Below 6 letters, never a letter change: "padel" is a sport, not a typo of "panel".
    expect(new Speller(vocab({ panel: 90 }), { titleFreq: vocab({ panel: 90 }) }).correct("padel").changed).toBe(false);
    // Insertions, deletions and swaps need no title evidence.
    expect(new Speller(vocab({ vacuum: 5 })).correct("vacum").query).toBe("vacuum");
  });

  it("leaves a word whose 1-edit candidate is gated, rather than reach a farther word", () => {
    // "sneekers": "sneakers" is a letter change without evidence; "speakers" is 2 edits away.
    const s = new Speller(vocab({ sneakers: 5, speakers: 90 }), { titleFreq: vocab({ speakers: 90 }) });
    expect(s.correct("sneekers").changed).toBe(false);
  });

  it("allows a letter change toward a trusted product word when it is the only one", () => {
    const words = vocab({ laptop: 5, monitor: 5, sneakers: 5, speakers: 90, samsung: 5 });
    const s = new Speller(words, { trusted: new Set(["laptop", "monitor", "sneakers", "samsung"]), titleFreq: vocab({ speakers: 90 }) });
    expect(s.correct("labtop moniter sneekers sansung").query).toBe("laptop monitor sneakers samsung");
    // Two trusted letter changes: ambiguous, left alone.
    const two = new Speller(vocab({ caper: 5, cater: 5 }), { trusted: new Set(["caper", "cater"]) });
    expect(two.correct("cazer").changed).toBe(false);
    // An added letter beats a trusted letter change: "chargr" is "charger", not "charge".
    expect(new Speller(vocab({ charge: 50, charger: 5 }), { trusted: new Set(["charge", "charger"]) }).correct("chargr").query).toBe("charger");
    // Under 5 letters: no.
    expect(new Speller(vocab({ lamp: 5 }), { trusted: new Set(["lamp"]) }).correct("lamb").changed).toBe(false);
  });

  it("prefers a trusted word over a title word at the same distance (store-title poisoning)", () => {
    const s = new Speller(vocab({ samsung: 5, samsnug: 1500 }), { trusted: new Set(["samsung"]) });
    expect(s.correct("samsng tv").query).toBe("samsung tv");
  });

  it("applies the curated misspelling overrides before the dictionary", () => {
    const s = new Speller(vocab({ gaming: 5 }), { dictionary: new Set(["gamming", "mous"]), overrides: new Map([["gamming", "gaming"], ["mous", "mouse"]]) });
    expect(s.correct("gamming mous pad").query).toBe("gaming mouse pad");
  });

  it("keeps a typed plural", () => {
    const s = new Speller(vocab({ earphone: 50, earphones: 5 }), { trusted: new Set(["earphone", "earphones"]) });
    expect(s.correct("earphons").query).toBe("earphones");
    expect(s.correct("earphne").query).toBe("earphone");
    // Only a typed final "s" counts: "earbusd" swaps two letters of "earbuds".
    expect(new Speller(vocab({ earbud: 50, earbuds: 5 })).correct("earbusd").query).toBe("earbuds");
  });

  it("ignores vocabulary words longer than 30 letters", () => {
    const long = "a".repeat(29) + "bc";
    expect(new Speller(vocab({ [long]: 9 })).correct(long.slice(0, 30)).changed).toBe(false);
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

describe("Speller.correct: hostile input", () => {
  const sp = new Speller(WORDS);
  const fast = (q: string) => {
    const t0 = performance.now();
    const r = sp.correct(q);
    return { r, ms: performance.now() - t0 };
  };

  it("leaves a 10,000-character query unchanged, fast", () => {
    const q = "samsng ".repeat(1500).slice(0, 10_000);
    const { r, ms } = fast(q);
    expect(r).toEqual({ query: q, changed: false });
    expect(ms).toBeLessThan(5);
  });

  it("leaves a 200-letter word unchanged, fast", () => {
    const q = "abcdefghijklmnopqrstuvwxy".repeat(8);
    const { r, ms } = fast(q);
    expect(r).toEqual({ query: q, changed: false });
    expect(ms).toBeLessThan(5);
  });

  it("corrects at most 12 words of a query", () => {
    const q = Array.from({ length: 20 }, () => "samsng").join(" ");
    expect(q.length).toBeLessThanOrEqual(MAX_CORRECT_CHARS);
    const out = sp.correct(q).query.split(" ");
    expect(out.filter((w) => w === "samsung")).toHaveLength(12);
  });
});
