import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect } from "vitest";
import { STORES, defaultSites, storeLabel } from "@/src/lib/stores";
import { sites } from "@/src/sites/registry";

describe("STORES (client-safe store list)", () => {
  it("has exactly the registry's ids, in order", () => {
    expect(STORES.map((s) => s.id)).toEqual(Object.keys(sites));
  });

  it("uses the registry's labels", () => {
    for (const s of STORES) expect(s.label).toBe(sites[s.id].label);
  });

  it("gives every store a logo file that exists under public/stores", () => {
    for (const s of STORES) {
      expect(s.logo).toMatch(/^\/stores\/[a-z-]+\.(svg|png|ico)$/);
      expect(existsSync(join(process.cwd(), "public", s.logo)), s.id).toBe(true);
    }
  });

  it("SHEIN starts unchecked; every other store starts checked", () => {
    for (const s of STORES) expect(s.defaultSelected, s.id).toBe(s.id !== "shein-sa");
    expect(defaultSites()).toEqual(STORES.filter((s) => s.id !== "shein-sa").map((s) => s.id));
  });

  it("SHEIN carries the rate-limit helper note", () => {
    expect(STORES.find((s) => s.id === "shein-sa")?.note).toBe("Slower; may be rate-limited");
  });

  it("storeLabel falls back to the id for an unknown store", () => {
    expect(storeLabel("noon-sa")).toBe("noon KSA");
    expect(storeLabel("nope")).toBe("nope");
  });
});
