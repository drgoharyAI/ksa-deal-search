import { describe, it, expect } from "vitest";
import { STORES, storeLabel } from "@/src/lib/stores";
import { sites } from "@/src/sites/registry";

describe("STORES (client-safe store list)", () => {
  it("has exactly the registry's ids, in order", () => {
    expect(STORES.map((s) => s.id)).toEqual(Object.keys(sites));
  });

  it("uses the registry's labels", () => {
    for (const s of STORES) expect(s.label).toBe(sites[s.id].label);
  });

  it("storeLabel falls back to the id for an unknown store", () => {
    expect(storeLabel("noon-sa")).toBe("noon KSA");
    expect(storeLabel("nope")).toBe("nope");
  });
});
