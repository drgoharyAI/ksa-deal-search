import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { cardTitle, normalizeSearchItem } from "@/src/sites/amazon-sa/search";
import { runSearch } from "@/src/lib/pipeline";
import type { ResponseSpec } from "api-anything";

/**
 * Live regression (2026-11-28): amazon.sa cards now hold the brand alone in a first h2 ("JBL") and
 * the product name, without the brand, in h2.a-text-normal. The spec read the first h2, so every
 * title was "JBL" and "jbl flip 6" kept nothing. Fixture: the first 8 cards of the live page.
 */

const root = path.resolve(__dirname, "..", "..");
const html = readFileSync(path.join(root, "tests/fixtures/amazon-sa-jbl-flip-6-2026-11-28.html"), "utf8");

function responseSpec(): ResponseSpec {
  const find = (o: unknown): ResponseSpec | undefined => {
    if (!o || typeof o !== "object") return undefined;
    const r = (o as { response?: ResponseSpec }).response;
    if (r?.html) return r;
    for (const v of Object.values(o)) {
      const hit = find(v);
      if (hit) return hit;
    }
    return undefined;
  };
  const spec = find(JSON.parse(readFileSync(path.join(root, "api-specs/amazon-sa.json"), "utf8")));
  if (!spec) throw new Error("no html response in api-specs/amazon-sa.json");
  return spec;
}

async function extracted(): Promise<Record<string, unknown>[]> {
  const mod = (await import(pathToFileURL(path.join(root, "node_modules/api-anything/dist/extract.js")).href)) as {
    extract: (res: ResponseSpec, body: string, base?: string) => unknown;
  };
  return mod.extract(responseSpec(), html, "https://www.amazon.sa/s") as Record<string, unknown>[];
}

describe("amazon.sa brand-split cards", () => {
  it("the spec reads the product name and the brand, not the brand alone", async () => {
    const items = await extracted();
    expect(items).toHaveLength(8);
    expect(items[0]).toMatchObject({ id: "B09NCDJGYY", brand: "JBL" });
    expect(String(items[0].title)).toMatch(/^Flip 6 Bluetooth Box/);
  });

  it("the title puts the brand back in front", async () => {
    const titles = (await extracted()).map((i) => normalizeSearchItem(i)?.title).filter(Boolean);
    expect(titles[0]).toMatch(/^JBL Flip 6 Bluetooth Box/);
    expect(titles.every((t) => t !== "JBL")).toBe(true);
  });

  it('"jbl flip 6" keeps Amazon listings again', async () => {
    const data = await extracted();
    const r = await runSearch(
      { query: "jbl flip 6", sites: ["amazon-sa"], sort: "price" },
      { exec: () => Promise.resolve({ ok: true, tier: 1, data }) },
    );
    expect(r.products.length).toBeGreaterThan(0);
    expect(r.products.every((p) => /jbl flip 6/i.test(p.title))).toBe(true);
  });

  it("cardTitle: brand only when the name does not start with it; old one-h2 cards unchanged", () => {
    expect(cardTitle({ title: "Flip 6 Speaker", brand: "JBL", titleAny: "JBL" })).toBe("JBL Flip 6 Speaker");
    expect(cardTitle({ title: "JBL Flip 6 Speaker", brand: "JBL" })).toBe("JBL Flip 6 Speaker");
    expect(cardTitle({ title: "Apple AirPods 4" })).toBe("Apple AirPods 4");
    expect(cardTitle({ titleAny: "Apple AirPods 4" })).toBe("Apple AirPods 4");
    expect(cardTitle({ brand: "JBL", titleAny: "JBL" })).toBe("JBL");
  });
});
