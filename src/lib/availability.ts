import type { Product } from "@/src/lib/types";
import { isLikelyMatch } from "@/src/lib/rank";

/** The match tier rank() orders by: confident, less likely, weak. */
const tierOf = (p: Product): number => (isLikelyMatch(p) ? 0 : p.weakMatch ? 2 : 1);

/**
 * Moves branch-pickup-only listings after the deliverable ones of their match tier, keeping every
 * other order (stable). Applied to rank()'s output, so the cheapest-first list starts with the
 * cheapest deliverable listing. Nothing moves when no listing is pickup-only.
 */
export function deliverableFirst(ranked: Product[]): Product[] {
  if (!ranked.some((p) => p.pickupOnly)) return ranked;
  const out: Product[] = [];
  for (const tier of [0, 1, 2]) {
    const inTier = ranked.filter((p) => tierOf(p) === tier);
    out.push(...inTier.filter((p) => !p.pickupOnly), ...inTier.filter((p) => p.pickupOnly));
  }
  return out;
}

/** Listings a deal badge or a price alert may use: deliverable ones (not branch-pickup-only). */
export const deliverable = (p: Product): boolean => !p.pickupOnly;
