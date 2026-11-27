import type { Product } from "@/src/lib/types";
import { storeLabel } from "@/src/lib/stores";
import { SPEC_ROWS, parseSpecs, productKey } from "@/src/lib/specs";

/**
 * Side-by-side compare (spec: "Comparison and deal-insight features", item 4). Pure and
 * client-safe: builds the table rows and their difference flags; the page renders them.
 */

export const MAX_COMPARE = 4;
export const MIN_COMPARE = 2;

const NBSP = " ";
const priceOf = (p: Product) => p.finalPrice ?? p.listPrice;

/** "SAR 2,999" (no-break space), two decimals only when the amount has cents. */
function money(n: number, currency = "SAR"): string {
  const digits = Number.isInteger(n) ? 0 : 2;
  return `${currency || "SAR"}${NBSP}${n.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: 2 })}`;
}

export type CompareRow = {
  key: string;
  label: string;
  /** One per product; null: not given. */
  cells: (string | null)[];
  /** The products do not all show the same value (a missing one counts as different). */
  differs: boolean;
  /** Per cell: differs from the row's majority value (no single majority: every cell differs). */
  diff: boolean[];
  /** Price row only: the cheapest product(s); absent when all prices match or currencies differ. */
  lowest?: boolean[];
};

const differs = (cells: (string | null)[]) => new Set(cells.map((c) => c ?? "")).size > 1;

/** Per-cell difference from the row's majority value; a tie for the majority flags every cell. */
function cellDiffs(cells: (string | null)[]): boolean[] {
  const n = new Map<string, number>();
  for (const c of cells) n.set(c ?? "", (n.get(c ?? "") ?? 0) + 1);
  const top = Math.max(...n.values());
  const majority = [...n].filter(([, k]) => k === top);
  if (majority.length > 1) return cells.map(() => true);
  return cells.map((c) => (c ?? "") !== majority[0][0]);
}

const row = (key: string, label: string, cells: (string | null)[]): CompareRow => ({
  key, label, cells, differs: differs(cells), diff: cellDiffs(cells),
});

export function compareRows(products: Product[]): CompareRow[] {
  const prices = products.map(priceOf);
  const min = Math.min(...prices);
  const fixed: { key: string; label: string; cell: (p: Product) => string | null }[] = [
    { key: "store", label: "Store", cell: (p) => storeLabel(p.site) },
    { key: "price", label: "Price", cell: (p) => money(priceOf(p), p.currency) },
    { key: "orig", label: "Original price", cell: (p) => (p.origPrice !== null && p.origPrice > priceOf(p) ? money(p.origPrice, p.currency) : null) },
    { key: "discount", label: "Discount", cell: (p) => (p.discountPct && Math.round(p.discountPct) > 0 ? `−${Math.round(p.discountPct)}%` : null) },
    { key: "rating", label: "Rating", cell: (p) => (p.rating !== null ? `${p.rating.toFixed(1)} of 5` : null) },
    { key: "deal", label: "Deal check", cell: (p) => p.deal?.label ?? null },
  ];
  const rows: CompareRow[] = fixed.map((r) => {
    const cells = products.map(r.cell);
    return row(r.key, r.label, cells);
  });
  const oneCurrency = new Set(products.map((p) => p.currency || "SAR")).size === 1;
  if (oneCurrency && new Set(prices).size > 1) rows[1].lowest = prices.map((x) => x === min);

  const specs = products.map((p) => parseSpecs(p.title));
  for (const s of SPEC_ROWS) {
    const cells = specs.map((x) => x[s.key] ?? null);
    if (cells.some((c) => c !== null)) rows.push(row(s.key, s.label, cells));
  }
  return rows;
}

/** Tick or untick a product; a fifth is refused (`full`) and the list is returned unchanged. */
export function toggleCompare(list: Product[], p: Product): { list: Product[]; full: boolean } {
  const k = productKey(p);
  if (list.some((x) => productKey(x) === k)) return { list: list.filter((x) => productKey(x) !== k), full: false };
  if (list.length >= MAX_COMPARE) return { list, full: true };
  return { list: [...list, p], full: false };
}
