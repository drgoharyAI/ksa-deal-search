import { describe, expect, it } from "vitest";
import { englishWords } from "@/src/lib/query/dictionary";

describe("englishWords (data/english-words.txt.gz, MIT)", () => {
  it("holds common English words, plural forms included", () => {
    const d = englishWords();
    for (const w of ["shark", "creatine", "vitamin", "cooler", "stove", "scale", "massager", "plug", "flashlight", "cast", "rope", "racket"]) {
      expect(d.has(w), w).toBe(true);
    }
    expect(d.size).toBeGreaterThan(200_000);
  });

  it("holds no common shopping typo", () => {
    const d = englishWords();
    for (const w of ["airpdos", "samsng", "cordles", "fyer", "flipp", "headphnes", "vaccum", "blnder"]) expect(d.has(w), w).toBe(false);
  });

  it("is loaded once", () => {
    expect(englishWords()).toBe(englishWords());
  });
});
