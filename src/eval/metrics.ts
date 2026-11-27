import type { Product } from "@/src/lib/types";

export type Label = "relevant" | "accessory" | "wrong-model" | "off-topic";

/** eval/labels/<slug>.json. Key = "<site>:<product id>" of the normalized Product. */
export type LabelsFile = { query: string; labels: Record<string, Label> };

export const labelKey = (p: Pick<Product, "site" | "id">): string => `${p.site}:${p.id}`;

/** The query's own filters (from parseQuery), used to decide which relevant items are eligible. */
export type Constraints = { minPrice?: number; maxPrice?: number; minRating?: number; exclude: string[] };

export type QueryMetrics = {
  /** Size of the top-10 window actually filled (0..10). */
  top: number;
  precisionAt10: number;
  accessoryAt10: number;
  wrongModelAt10: number;
  /** Top-10 items that have no label (should be 0 once labelling is done). */
  unlabeledAt10: number;
  /** Relevant recorded items that pass every filter (before dedupe) / relevant recorded items. */
  recall: number | null;
  relevantRecorded: number;
  relevantKept: number;
  /** #1 under the "price" sort is relevant and no eligible relevant item is cheaper. null = no eligible relevant item. */
  cheapestRelevantFirst: boolean | null;
};

export type OverallMetrics = {
  queries: number;
  precisionAt10: number;
  accessoryAt10: number;
  wrongModelAt10: number;
  recall: number | null;
  cheapestRelevantFirst: number | null;
};

const priceOf = (p: Product) => p.finalPrice ?? p.listPrice;
const isNum = (n: number | undefined): n is number => typeof n === "number" && Number.isFinite(n);

function eligible(p: Product, c: Constraints): boolean {
  const price = priceOf(p);
  if (isNum(c.minPrice) && price < c.minPrice) return false;
  if (isNum(c.maxPrice) && price > c.maxPrice) return false;
  if (isNum(c.minRating) && p.rating !== null && p.rating < c.minRating) return false;
  const t = p.title.toLowerCase();
  return !c.exclude.some((w) => t.includes(w.toLowerCase()));
}

/**
 * Metrics for one query.
 * - results: final pipeline output under sort "price";
 * - kept: products that passed every filter, before dedupe (for recall);
 * - recorded: every normalized recorded product, keyed "<site>:<id>";
 * - labels: the query's labels.
 */
export function computeMetrics(args: {
  results: Product[];
  kept: Product[];
  recorded: Map<string, Product>;
  labels: Record<string, Label>;
  constraints: Constraints;
}): QueryMetrics {
  const { results, kept, recorded, labels, constraints } = args;
  const top10 = results.slice(0, 10);
  const count = (l: Label) => top10.filter((p) => labels[labelKey(p)] === l).length;
  const share = (n: number) => (top10.length ? n / top10.length : 0);

  const relevantKeys = [...recorded.keys()].filter((k) => labels[k] === "relevant");
  const keptKeys = new Set(kept.map(labelKey));
  const relevantKept = relevantKeys.filter((k) => keptKeys.has(k)).length;

  const eligibleRelevant = relevantKeys.map((k) => recorded.get(k)!).filter((p) => eligible(p, constraints));
  let cheapestRelevantFirst: boolean | null = null;
  if (eligibleRelevant.length) {
    const cheapest = Math.min(...eligibleRelevant.map(priceOf));
    const first = results[0];
    cheapestRelevantFirst = !!first && labels[labelKey(first)] === "relevant" && priceOf(first) <= cheapest + 0.005;
  }

  return {
    top: top10.length,
    precisionAt10: share(count("relevant")),
    accessoryAt10: share(count("accessory")),
    wrongModelAt10: share(count("wrong-model")),
    unlabeledAt10: top10.filter((p) => !(labelKey(p) in labels)).length,
    recall: relevantKeys.length ? relevantKept / relevantKeys.length : null,
    relevantRecorded: relevantKeys.length,
    relevantKept,
    cheapestRelevantFirst,
  };
}

const mean = (xs: number[]): number | null => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

/** Macro averages over labelled queries; null-valued recall / cheapest-first entries are skipped. */
export function aggregate(list: QueryMetrics[]): OverallMetrics {
  const cheapest = list.map((m) => m.cheapestRelevantFirst).filter((b): b is boolean => b !== null);
  return {
    queries: list.length,
    precisionAt10: mean(list.map((m) => m.precisionAt10)) ?? 0,
    accessoryAt10: mean(list.map((m) => m.accessoryAt10)) ?? 0,
    wrongModelAt10: mean(list.map((m) => m.wrongModelAt10)) ?? 0,
    recall: mean(list.map((m) => m.recall).filter((r): r is number => r !== null)),
    cheapestRelevantFirst: mean(cheapest.map((b) => (b ? 1 : 0))),
  };
}
