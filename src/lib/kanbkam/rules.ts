import type { DealBadge } from "@/src/lib/types";

/**
 * Rule-based verdicts from a listing's Kanbkam price history (spec decision "Kanbkam price
 * history"). Client-safe and pure. Kanbkam's numbers live in their own table and never feed our
 * own observations or deal badges: a verdict is shown next to our badge, never instead of it.
 */

type KanbkamVerdictKind = "fake-was" | "lowest" | "near-lowest";
export type KanbkamVerdict = { kind: KanbkamVerdictKind; label: string };

/** What a lookup answers: the listing's history, or that Kanbkam has none for it. */
export type KanbkamResult =
  | {
      status: "ok";
      min: number;
      max: number;
      current: number | null;
      dropPct: number | null;
      since: string | null;
      url: string;
      checkedAt: number;
      verdicts: KanbkamVerdict[];
    }
  | { status: "missing"; url: string; checkedAt: number };

/** The store's "was" price above Kanbkam's highest-ever by more than this is fake. */
const FAKE_WAS_MARGIN = 1.02;
const LOWEST_MARGIN = 1.01;
const NEAR_MARGIN = 1.05;

const VERDICT_LABELS: Record<KanbkamVerdictKind, string> = {
  "fake-was": "Fake was-price (Kanbkam)",
  lowest: "Lowest in Kanbkam history",
  "near-lowest": "Near the lowest",
};

const verdict = (kind: KanbkamVerdictKind): KanbkamVerdict => ({ kind, label: VERDICT_LABELS[kind] });

/** The verdicts for our listing's current price and was-price against Kanbkam's lowest and highest. */
export function kanbkamVerdicts(ours: { price: number; was: number | null }, h: { min: number; max: number }): KanbkamVerdict[] {
  if (!(ours.price > 0) || !(h.min > 0) || !(h.max >= h.min)) return [];
  const out: KanbkamVerdict[] = [];
  if (ours.was !== null && ours.was > h.max * FAKE_WAS_MARGIN) out.push(verdict("fake-was"));
  if (ours.price <= h.min * LOWEST_MARGIN) out.push(verdict("lowest"));
  else if (ours.price <= h.min * NEAR_MARGIN) out.push(verdict("near-lowest"));
  return out;
}

const GOOD: ReadonlySet<DealBadge> = new Set(["lowest-30d", "below-usual"]);

/** Our own deal badge and Kanbkam's verdicts point opposite ways (both stay shown, ours unchanged). */
export function kanbkamDisagrees(badge: DealBadge | undefined, verdicts: KanbkamVerdict[]): boolean {
  if (badge === "fake-deal") return verdicts.some((v) => v.kind === "lowest" || v.kind === "near-lowest");
  if (badge && GOOD.has(badge)) return verdicts.some((v) => v.kind === "fake-was");
  return false;
}
