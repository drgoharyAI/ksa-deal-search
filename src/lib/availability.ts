import type { Product } from "@/src/lib/types";

/**
 * Listings a deal badge or a price alert may use: deliverable ones, not branch-pickup-only. (Their
 * order after deliverable listings is rank()'s, in src/lib/rank.ts.)
 */
export const deliverable = (p: Product): boolean => !p.pickupOnly;
