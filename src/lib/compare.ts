import type { Product } from "@/src/lib/types";
import { STORES, storeLabel } from "@/src/lib/stores";
import { SPEC_ROWS, brandLabel, brandsFor, parseSpecs, productKey } from "@/src/lib/specs";
import { isFromPrice, storeDiscount, wasPrice } from "@/src/lib/discount";

/**
 * Side-by-side compare (spec: "Comparison and deal-insight features", item 4; UX phase U4). Pure
 * and client-safe: the table rows with their difference flags, and the selection kept in the URL.
 * Every cell comes from what a store listed or from our own price history; a value nobody gave
 * is null (the page says "Not listed"), never 0 or a blank.
 */

export const MAX_COMPARE = 4;
export const MIN_COMPARE = 2;

const NBSP = " ";
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
  /**
   * Price row only: the cheapest fixed price(s), "from" prices left out; absent when currencies
   * differ, fewer than two fixed prices remain, or they are all the same.
   */
  lowest?: boolean[];
  /** Price row only: the price is a "from" price (the store's cheapest variant). */
  from?: boolean[];
  /** A line under the row's label, such as why no lowest price is marked. */
  note?: string;
  /** Per cell: a short line under the value (a fake-deal "was" price), or null. */
  cellNotes?: (string | null)[];
  /** What an empty cell says, when "Not listed" would be wrong (no price history yet). */
  empty?: string;
};

/** Shown in the price row when the cheapest price is a "from" price, which is never ranked. */
export const FROM_PRICE_NOTE = 'Cheapest is a "from" price, not ranked';
/** Under a struck "was" price our history calls a fake deal. */
export const FAKE_WAS_NOTE = "Not backed by price history";
/** The deal-check cell of a product we hold no price history for. */
export const NO_HISTORY = "No price history yet";

/** Shown in the price row when the products are priced in more than one currency. */
export const MIXED_CURRENCY_NOTE = "Different currencies, not compared";

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

/** Every product is priced in one currency (an empty currency is the stores' SAR). */
export const sameCurrency = (products: Product[]): boolean => new Set(products.map((p) => p.currency || "SAR")).size <= 1;

/** The 7-day change in words, or how many days of prices we hold; null without a trend. */
function trendCell(p: Product): string | null {
  const t = p.trend;
  if (!t || t.points.length < 2) return null;
  const pct = t.changePct7d;
  if (pct === undefined) return `${t.points[t.points.length - 1].day - t.points[0].day + 1} days of prices`;
  if (pct === 0) return "Same as last week";
  return `${pct < 0 ? "Down" : "Up"} ${Math.abs(pct)}% vs last week`;
}

/**
 * The table rows, in order: store, price, original price, store discount, rating, sold (only
 * when a store gave a count), brand, the title specs that any product has (aligned by spec key),
 * deal check, and price trend (only when our history has one). `brands`: each product's brand
 * over the whole result set (chips.ts), which reads lead words better than the compared few.
 */
export function compareRows(products: Product[], opts: { brands?: ReadonlyMap<string, string | undefined> } = {}): CompareRow[] {
  const brands = opts.brands ?? brandsFor(products);
  const prices = products.map(priceOf);
  const from = products.map(isFromPrice);
  const price = row("price", "Price", products.map((p, i) => `${from[i] ? "from " : ""}${money(priceOf(p), p.currency)}`));
  if (from.some(Boolean)) price.from = from;
  if (!sameCurrency(products)) price.note = MIXED_CURRENCY_NOTE;
  else {
    // "Lowest price" is a like-for-like claim: only fixed prices take part. A "from" price is the
    // store's cheapest variant, so ranking it against a fixed price would overstate the saving.
    const fixed = prices.filter((_, i) => !from[i]);
    const minFixed = Math.min(...fixed);
    if (fixed.length > 1 && new Set(fixed).size > 1) price.lowest = prices.map((x, i) => !from[i] && x === minFixed);
    if (from.some(Boolean) && Math.min(...prices.filter((_, i) => from[i])) < (fixed.length ? minFixed : Infinity)) price.note = FROM_PRICE_NOTE;
  }
  const orig = row("orig", "Original price", products.map((p) => {
    const was = wasPrice(p);
    return was === null ? null : money(was, p.currency);
  }));
  const fakeWas = products.map((p, i) => (orig.cells[i] !== null && p.deal?.badge === "fake-deal" ? FAKE_WAS_NOTE : null));
  if (fakeWas.some((n) => n !== null)) orig.cellNotes = fakeWas;
  const rows: CompareRow[] = [
    row("store", "Store", products.map((p) => storeLabel(p.site))),
    price,
    orig,
    row("discount", "Store discount", products.map((p) => {
      const d = storeDiscount(p);
      return d === null ? null : `−${Math.round(d)}%`;
    })),
    row("rating", "Rating", products.map((p) => (p.rating !== null ? `${p.rating.toFixed(1)} of 5` : null))),
  ];
  // Only AliExpress gives a sold count, and its 0 cannot be told from "not given": show counts above 0.
  if (products.some((p) => p.soldCount > 0)) {
    rows.push(row("sold", "Sold", products.map((p) => (p.soldCount > 0 ? `${p.soldCount.toLocaleString("en-US")} sold` : null))));
  }
  rows.push(row("brand", "Brand", products.map((p) => {
    const b = brands.get(productKey(p));
    return b ? brandLabel(b) : null;
  })));

  const specs = products.map((p) => parseSpecs(p.title));
  for (const s of SPEC_ROWS) {
    const cells = specs.map((x) => x[s.key] ?? null);
    if (cells.some((c) => c !== null)) rows.push(row(s.key, s.label, cells));
  }

  rows.push({ ...row("deal", "Deal check", products.map((p) => p.deal?.label ?? null)), empty: NO_HISTORY });
  const trends = products.map(trendCell);
  if (trends.some((t) => t !== null)) rows.push(row("trend", "Price trend", trends));
  return rows;
}

/** "Show only differences": the rows whose values are not all the same. */
export const onlyDifferences = (rows: CompareRow[]): CompareRow[] => rows.filter((r) => r.differs);

/* ---------- The selection: product keys, kept in the URL ---------- */

/** Query-string key of the compare selection: `cmp=<site>+<id>,<site>+<id>`. */
const CMP_PARAM = "cmp";
const STORE_IDS = new Set<string>(STORES.map((s) => s.id));
/** Longest product id we keep from a URL (store ids are far shorter; this only bounds a pasted link). */
const MAX_ID = 160;

/** The store id of a product key ("noon-sa+N123" gives "noon-sa"). */
const keySite = (key: string): string => key.slice(0, key.indexOf("+"));

/**
 * The selection in a URL's query: known stores only, no repeats, at most MAX_COMPARE. A raw "+"
 * typed into a link reads back as a space, so a key without "+" takes its first space as one.
 */
export function keysFromSearch(search: string): string[] {
  const raw = new URLSearchParams(search).get(CMP_PARAM) ?? "";
  const out: string[] = [];
  for (const part of raw.split(",")) {
    const t = part.trim();
    const k = t.includes("+") ? t : t.replace(" ", "+");
    const plus = k.indexOf("+");
    if (plus < 1) continue;
    const id = k.slice(plus + 1);
    if (!STORE_IDS.has(k.slice(0, plus)) || !id || id.length > MAX_ID || /\s/.test(id)) continue;
    if (!out.includes(k)) out.push(k);
    if (out.length === MAX_COMPARE) break;
  }
  return out;
}

/** `search` with the compare key replaced by `keys` ("" when nothing is left), leading "?" included. */
export function withCompareParam(search: string, keys: string[]): string {
  const p = new URLSearchParams(search);
  p.delete(CMP_PARAM);
  if (keys.length) p.set(CMP_PARAM, keys.join(","));
  const s = p.toString();
  return s ? `?${s}` : "";
}

/** Tick or untick a product key; a key past MAX_COMPARE is refused (`full`) and `keys` is returned as is. */
export function toggleKey(keys: string[], key: string): { keys: string[]; full: boolean } {
  if (keys.includes(key)) return { keys: keys.filter((k) => k !== key), full: false };
  if (keys.length >= MAX_COMPARE) return { keys, full: true };
  return { keys: [...keys, key], full: false };
}

/** What the tray remembers of a ticked product, to name it once it has left the results. */
export type CompareSnap = { title: string; image: string };

/**
 * One ticked product: the live listing when the current results have it, else null (it is shown
 * as "no longer in results", never dropped). `snap`: its title and picture from earlier, if known.
 */
export type CompareSlot = { key: string; site: string; product: Product | null; snap: CompareSnap | null };

export function resolveSelection(keys: string[], byKey: ReadonlyMap<string, Product>, snaps: Readonly<Record<string, CompareSnap>> = {}): CompareSlot[] {
  return keys.map((key) => {
    const product = byKey.get(key) ?? null;
    return { key, site: keySite(key), product, snap: product ? { title: product.title, image: product.image } : (snaps[key] ?? null) };
  });
}

/* ---------- This tab's memory of the selection (sessionStorage) ---------- */

/**
 * The search the selection came from and what each ticked product looked like. The keys travel in
 * the URL; this only lets the tray name products after a reload and offer to run that search again.
 */
export type CompareMemory = { query: string; sites: string[]; snaps: Record<string, CompareSnap> };

const MEMORY_KEY = "deal-search:compare";

export function sessionStore(): Storage | undefined {
  try {
    return typeof window === "undefined" ? undefined : window.sessionStorage;
  } catch {
    return undefined;
  }
}

export function readMemory(store: Storage | undefined): CompareMemory | null {
  try {
    const v = JSON.parse(store?.getItem(MEMORY_KEY) ?? "null") as unknown;
    if (!v || typeof v !== "object") return null;
    const m = v as Partial<CompareMemory>;
    if (typeof m.query !== "string" || !Array.isArray(m.sites) || !m.snaps || typeof m.snaps !== "object") return null;
    const snaps: Record<string, CompareSnap> = {};
    for (const [k, s] of Object.entries(m.snaps)) {
      if (s && typeof s.title === "string" && typeof s.image === "string") snaps[k] = { title: s.title.slice(0, 300), image: s.image.slice(0, 1000) };
    }
    return { query: m.query.slice(0, 200), sites: m.sites.filter((s): s is string => typeof s === "string" && STORE_IDS.has(s)), snaps };
  } catch {
    return null;
  }
}

export function writeMemory(store: Storage | undefined, m: CompareMemory | null): void {
  try {
    if (!m) store?.removeItem(MEMORY_KEY);
    else store?.setItem(MEMORY_KEY, JSON.stringify(m));
  } catch {
    // Storage full or blocked: the URL still holds the selection.
  }
}
