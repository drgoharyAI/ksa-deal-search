import type { Product } from "@/src/lib/types";
import { rank, type SortKey } from "@/src/lib/rank";
import { passes, type ChipContext, type ChipFilters } from "@/src/lib/chips";
import { productKey } from "@/src/lib/specs";
import type { GroupRef } from "@/src/lib/match/group";

/**
 * The cards the results page shows (spec: "Comparison and deal-insight features", item 1). Pure
 * and client-side: the same product at several stores is one card with a row per store; every
 * other product is its own card. Filter chips, sort and the match tiers apply per card.
 */

/** One card's worth of listings: a cross-store group (grouped) or a single product. */
export type Unit = { key: string; members: Product[]; grouped: boolean; colors: Record<string, string> };

export type SingleItem = { kind: "product"; key: string; product: Product };
export type GroupItem = {
  kind: "group";
  key: string;
  /** The cheapest confident member passing the filters (the cheapest one when none is confident). */
  best: Product;
  /** Members passing the filters, best first, then by price (confident ones before the rest). */
  rows: Product[];
  /** Stores among the rows. */
  storeCount: number;
  /** Colour named by each member's title, by "site:id". */
  colors: Record<string, string>;
};
export type ViewItem = SingleItem | GroupItem;

const refKey = (p: Pick<Product, "site" | "id">) => `${p.site}:${p.id}`;

/**
 * Units from a search response: each group with at least two known members (from `products` or
 * `extras`) is one unit; every product not in such a group is its own unit.
 */
export function buildUnits(products: Product[], groups: GroupRef[] = [], extras: Product[] = []): Unit[] {
  const byKey = new Map<string, Product>();
  for (const p of [...products, ...extras]) if (!byKey.has(refKey(p))) byKey.set(refKey(p), p);
  const used = new Set<Product>();
  const units: Unit[] = [];
  for (const g of groups) {
    const members = [...new Set(g.memberKeys.map((k) => byKey.get(k)).filter((p): p is Product => !!p && !used.has(p)))];
    if (members.length < 2) continue;
    for (const p of members) used.add(p);
    units.push({ key: `group:${g.key}`, members, grouped: true, colors: g.colors ?? {} });
  }
  for (const p of products) if (!used.has(p)) units.push({ key: productKey(p), members: [p], grouped: false, colors: {} });
  return units;
}

/** Every listing in the units (for the chip context and the price slider's bounds). */
export const allMembers = (units: Unit[]): Product[] => units.flatMap((u) => u.members);

/** The product a card leads with: a group's best member, or the product. */
export const leadOf = (item: ViewItem): Product => (item.kind === "group" ? item.best : item.product);

/**
 * The cards to show, in order. A unit shows when any member passes the filters; a group shows
 * only its passing members, and one left with a single member shows as a plain card. Cards are
 * ranked by their lead (rank(): confident matches first, then by the chosen sort).
 */
export function viewItems(units: Unit[], f: ChipFilters, ctx: ChipContext, sort: SortKey): ViewItem[] {
  const byLead = new Map<Product, ViewItem>();
  for (const u of units) {
    const pass = u.members.filter((p) => passes(p, f, ctx));
    if (!pass.length) continue;
    if (!u.grouped || pass.length < 2) {
      byLead.set(pass[0], { kind: "product", key: productKey(pass[0]), product: pass[0] });
      continue;
    }
    const rows = rank(pass, "price");
    byLead.set(rows[0], { kind: "group", key: u.key, best: rows[0], rows, storeCount: new Set(rows.map((p) => p.site)).size, colors: u.colors });
  }
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- the keys passed to rank() are byLead's own keys
  return rank([...byLead.keys()], sort).map((p) => byLead.get(p)!);
}

/** The URL when it is https (store links open in a new tab); null otherwise. */
export function httpsUrl(url: string): string | null {
  try {
    const u = new URL(url);
    return u.protocol === "https:" ? u.href : null;
  } catch {
    return null;
  }
}
