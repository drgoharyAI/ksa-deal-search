import type { Product } from "@/src/lib/types";
import { hasValidPrice, isExcluded, passesPriceRating, ratinglessSites, type PriceRatingFilters } from "@/src/lib/filters";

export type Label = "relevant" | "accessory" | "wrong-model" | "off-topic";

/** eval/labels/<slug>.json. Key = "<site>:<product id>" of the normalized Product. */
export type LabelsFile = { query: string; labels: Record<string, Label> };

export const labelKey = (p: Pick<Product, "site" | "id">): string => `${p.site}:${p.id}`;

/** The query's own filters (from parseQuery), used to decide which relevant items are eligible. */
export type Constraints = PriceRatingFilters & { exclude: string[] };

export type QueryMetrics = {
  /** Size of the top-10 window actually filled (0..10). */
  top: number;
  precisionAt10: number;
  accessoryAt10: number;
  wrongModelAt10: number;
  /** Top-10 items that have no label (should be 0 once labelling is done). */
  unlabeledAt10: number;
  /** Relevant items kept through every filter (before dedupe) / relevant recorded items eligible under the query's own filters. */
  recall: number | null;
  relevantRecorded: number;
  relevantKept: number;
  /** End to end: #1 under the "price" sort is relevant and no eligible relevant recorded item is cheaper. null = none eligible. */
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

/**
 * Eligible = would survive the query's own filters in the pipeline (valid price, -exclude words,
 * price bounds on listPrice, minRating with the ratingless-store rule). Same predicates as
 * src/lib/pipeline.ts; ratingless stores are judged from this query's recorded products.
 */
function eligibleUnder(recorded: Map<string, Product>, c: Constraints): (p: Product) => boolean {
  const bySite = new Map<string, Product[]>();
  for (const p of recorded.values()) bySite.set(p.site, [...(bySite.get(p.site) ?? []), p]);
  const ratingless = ratinglessSites([...bySite].map(([site, products]) => ({ site, products })));
  return (p) => hasValidPrice(p) && !isExcluded(p, c.exclude) && passesPriceRating(p, c, ratingless);
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

  const eligible = eligibleUnder(recorded, constraints);
  const eligibleRelevant = [...recorded.entries()]
    .filter(([k, p]) => labels[k] === "relevant" && eligible(p))
    .map(([, p]) => p);
  const relevantKeys = eligibleRelevant.map(labelKey);
  const keptKeys = new Set(kept.map(labelKey));
  const relevantKept = relevantKeys.filter((k) => keptKeys.has(k)).length;

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
