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

describe("spec matching (match/spec.ts)", () => {
  it("stays linear on long whitespace runs", async () => {
    const { specMatches } = await import("@/src/lib/match/spec");
    const nasty = "iphone 16" + " ".repeat(40_000) + "x";
    const unit = "20000" + "\t".repeat(40_000) + "x";
    const t = performance.now();
    specMatches("16", "iphone", nasty);
    specMatches("20000mah", undefined, unit);
    specMatches("s24", undefined, "s24" + " ".repeat(40_000) + "-");
    expect(performance.now() - t).toBeLessThan(1000);
  });
  it("same readings as before", async () => {
    const { specMatches } = await import("@/src/lib/match/spec");
    expect(specMatches("16", "iphone", "Apple iPhone 16 128GB")).toBe(true);
    expect(specMatches("16", "iphone", "Apple iPhone - 16 Pro")).toBe(true);
    expect(specMatches("16", "iphone", "Apple iPhone 16e")).toBe(false);
    expect(specMatches("16", "iphone", "Apple iPhone 16 - e")).toBe(false);
    expect(specMatches("s24", undefined, "Galaxy S24 FE")).toBe(false);
    expect(specMatches("s24", undefined, "Galaxy S24 - Ultra")).toBe(true);
    expect(specMatches("20000mah", undefined, "Power bank 20,000 - mAh")).toBe(true);
  });
  it("keeps at most RE_CACHE_MAX compiled patterns", async () => {
    const { specMatches, reCacheSize, RE_CACHE_MAX } = await import("@/src/lib/match/spec");
    for (let i = 0; i < RE_CACHE_MAX * 3; i++) specMatches(`x${i}`, undefined, "title");
    expect(reCacheSize()).toBe(RE_CACHE_MAX);
  });
});
