import type { ProductGroup } from "@/src/lib/match/group";
import { labelKey } from "./metrics";

/**
 * eval/groups-gold.json: per query, reviewed cross-store pairs ("site:id" keys) that are the same
 * product or tricky different products (same brand, another model, capacity or generation).
 */
export type GroupGoldQuery = { query: string; split: "tune" | "heldout"; sameKeys: [string, string][]; differentKeys: [string, string][] };

export type GroupPairCounts = {
  /** Gold pairs with both items in the results (pairs with an item filtered out are skipped). */
  samePairs: number;
  differentPairs: number;
  /** Same pairs placed in one group. */
  sameMerged: number;
  /** Different pairs wrongly placed in one group. */
  differentMerged: number;
  /** Different pairs skipped because an item was not in the results. */
  skipped: number;
};

/** Pair counts for one query: which gold pairs the grouping put together. */
export function computeGroupMetrics(groups: ProductGroup[], gold: GroupGoldQuery): GroupPairCounts {
  const groupOf = new Map<string, string>();
  for (const g of groups) for (const p of g.members) groupOf.set(labelKey(p), g.key);
  const out: GroupPairCounts = { samePairs: 0, differentPairs: 0, sameMerged: 0, differentMerged: 0, skipped: 0 };
  const judge = (pairs: [string, string][], kind: "same" | "different") => {
    for (const [a, b] of pairs) {
      const ga = groupOf.get(a);
      const gb = groupOf.get(b);
      if (!ga || !gb) {
        out.skipped++;
        continue;
      }
      if (kind === "same") {
        out.samePairs++;
        if (ga === gb) out.sameMerged++;
      } else {
        out.differentPairs++;
        if (ga === gb) out.differentMerged++;
      }
    }
  };
  judge(gold.sameKeys, "same");
  judge(gold.differentKeys, "different");
  return out;
}
