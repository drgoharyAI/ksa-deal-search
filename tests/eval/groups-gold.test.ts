import { describe, expect, it, vi } from "vitest";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";

/**
 * The grouping gold sets (eval/groups-gold.json, eval/groups-adversarial.json) in CI, as
 * scripts/eval-groups.mjs scores them: every recorded query is replayed offline and grouped.
 * - gold "different" pairs: never in one group (0 wrong merges);
 * - adversarial pairs: each "apart" pair stays apart and each "merge" pair groups (knownMiss
 *   pairs are recall gaps, not checked);
 * - gold "same" pairs: recall is partial by design (about half), so a floor guards it.
 */

vi.mock("@/src/lib/aa", () => ({ aaCall: vi.fn(() => Promise.reject(new Error("no network in the gold test"))) }));

import { runSearch } from "@/src/lib/pipeline";
import { dedupeByStore } from "@/src/lib/match/dedupe";
import { groupProducts } from "@/src/lib/match/group";
import { rank } from "@/src/lib/rank";
import { createReplayExec, querySlug, type Recording } from "@/src/eval/replay";
import { computeGroupMetrics } from "@/src/eval/groups";
import type { Product } from "@/src/lib/types";
import { sites } from "@/src/sites/registry";

const root = path.resolve(__dirname, "..", "..");
const recDir = path.join(root, "eval/recorded");
const stores = readdirSync(recDir).filter((s) => Object.hasOwn(sites, s));
const readJson = (f: string): unknown => JSON.parse(readFileSync(path.join(root, f), "utf8"));

type Gold = { query: string; split: "tune" | "heldout"; sameKeys: [string, string][]; differentKeys: [string, string][] };
type Adv = { pad: string; expect: "merge" | "apart"; a: string; b: string; knownMiss?: boolean };

const keptCache = new Map<string, Product[]>();

/** The query's recorded listings after the filters, deduped within each store (as the pipeline groups them). */
async function keptFor(query: string): Promise<Product[]> {
  const hit = keptCache.get(query);
  if (hit) return hit;
  const slug = querySlug(query);
  const recordings = stores
    .map((s) => path.join(recDir, s, `${slug}.json`))
    .filter(existsSync)
    .map((f) => JSON.parse(readFileSync(f, "utf8")) as Recording);
  const { exec } = createReplayExec(recordings);
  let kept: Product[] = [];
  await runSearch({ query, sites: recordings.map((r) => r.store), sort: "price" }, { exec, onFiltered: (p) => (kept = p) });
  const out = dedupeByStore(kept);
  keptCache.set(query, out);
  return out;
}

/** Gold same pairs merged today (scripts/eval-groups.mjs: 26 tune + 36 held out). */
const SAME_MERGED_FLOOR = 62;

describe("grouping gold sets", { timeout: 120_000 }, () => {
  it("never merges a gold different pair, and keeps the same-pair merges", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const gold = (readJson("eval/groups-gold.json") as { queries: Gold[] }).queries;
      expect(gold.length).toBeGreaterThan(0);
      const wrong: string[] = [];
      let sameMerged = 0;
      for (const g of gold) {
        const groups = groupProducts(rank(await keptFor(g.query), "price"));
        const m = computeGroupMetrics(groups, g);
        sameMerged += m.sameMerged;
        if (m.differentMerged) {
          const groupOf = new Map<string, string>(groups.flatMap((x) => x.members.map((p): [string, string] => [`${p.site}:${p.id}`, x.key])));
          for (const [a, b] of g.differentKeys) if (groupOf.get(a) && groupOf.get(a) === groupOf.get(b)) wrong.push(`${g.query}: ${a} ~ ${b}`);
        }
      }
      expect(wrong).toEqual([]);
      expect(sameMerged).toBeGreaterThanOrEqual(SAME_MERGED_FLOOR);
    } finally {
      warn.mockRestore();
    }
  });

  it("groups every adversarial pair as labelled", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const pairs = (readJson("eval/groups-adversarial.json") as { pairs: Adv[] }).pairs;
      expect(pairs.length).toBeGreaterThan(0);
      const mk = (site: string, id: string, title: string): Product => ({
        site, id, title, listPrice: 100, finalPrice: 100, origPrice: null, discountPct: null, currency: "SAR",
        rating: null, soldCount: 0, image: "", url: "", detailStatus: "ok", matchScore: 1,
      });
      const bad: string[] = [];
      for (const x of pairs) {
        if (x.knownMiss) continue;
        const pad = await keptFor(x.pad);
        const gs = groupProducts([...pad, mk("amazon-sa", "adv-a", x.a), mk("noon-sa", "adv-b", x.b)]);
        const merged = !!gs.find((g) => g.members.some((m) => m.id === "adv-a"))?.members.some((m) => m.id === "adv-b");
        if (merged !== (x.expect === "merge")) bad.push(`${x.expect}: ${x.a} | ${x.b}`);
      }
      expect(bad).toEqual([]);
    } finally {
      warn.mockRestore();
    }
  });
});
