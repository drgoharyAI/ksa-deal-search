import { describe, expect, it } from "vitest";
import { parseSpecs } from "@/src/lib/specs";
import { titleFeatures } from "@/src/lib/match/group";

// Task 18 (eslint-plugin-security detect-unsafe-regex, confirmed by recheck): "\s*-?\s*" let two
// whitespace runs split the same spaces, so a number followed by a long run of whitespace took
// quadratic time. Rewritten as the equivalent "\s*(?:-\s*)?".
describe("unit/size regexes stay linear on long whitespace runs", () => {
  const nasty = "0" + "\t".repeat(40_000) + "x";
  it("parseSpecs", () => {
    const t = performance.now();
    parseSpecs(nasty);
    expect(performance.now() - t).toBeLessThan(1000);
  });
  it("titleFeatures", () => {
    const t = performance.now();
    titleFeatures(nasty);
    expect(performance.now() - t).toBeLessThan(1000);
  });
  it("same readings as before for normal titles", () => {
    expect(parseSpecs('Monitor 27 - inch 4K').size).toBe("27 in");
    expect(parseSpecs("Monitor 27-inch").size).toBe("27 in");
    expect(parseSpecs("2 - in - 1 Laptop 14 inch").size).toBe("14 in");
  });
});
