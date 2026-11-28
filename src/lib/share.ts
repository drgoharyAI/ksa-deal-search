import { STORES } from "@/src/lib/stores";
import { NO_FILTERS, filtersFromSearch, withChipParams, type ChipFilters } from "@/src/lib/chips";
import { keysFromSearch, withCompareParam } from "@/src/lib/compare";

/**
 * Shareable result URLs (UX phase U5). Client-safe and pure. The results page keeps its whole
 * state in the query string: the search (q, sites, sort and the form's price and rating limits),
 * the filter chips (chips.ts) and the compare selection (compare.ts, `cmp=`). Opening such a URL
 * anywhere runs that search once and puts the chips and the selection back.
 *
 *   /?q=jbl+flip+6&sites=noon-sa,jarir&sort=price&min=100&store=jarir&cmp=jarir+123
 *
 * `noCorrect=1`: the query is searched as typed, without typo correction ("Search instead for").
 *
 * The History page's older re-run links (`…&run=1`) read the same way.
 */

type Sort = "price" | "discount" | "deal";
/** The search form's values, as strings (the form's own shape). */
type Values = { query: string; sites: string[]; sort: Sort; minPrice: string; maxPrice: string; minRating: string; noCorrect?: boolean };

/** The longest query a link may carry (the search API refuses longer ones). */
export const MAX_SHARE_QUERY = 200;
/** A query string longer than this is not a link this app wrote: it is ignored, not run. */
export const MAX_SHARE_LENGTH = 4_000;

const SORTS = new Set<Sort>(["price", "discount", "deal"]);
const STORE_IDS = new Set<string>(STORES.map((s) => s.id));

const num = (v: string | null): string => {
  const t = (v ?? "").trim();
  if (!t || t.length > 12) return "";
  const n = Number(t);
  return Number.isFinite(n) && n >= 0 ? t : "";
};

/**
 * The query string ("?…", leading "?" included) of a results URL: the search, then the chips, then
 * the compare keys. Keys in a fixed order, so the same state always gives the same link.
 */
export function shareSearch(v: Values, chips: ChipFilters = NO_FILTERS, cmp: string[] = []): string {
  const p = new URLSearchParams();
  p.set("q", v.query.trim());
  if (v.sites.length) p.set("sites", v.sites.join(","));
  p.set("sort", v.sort);
  for (const [k, val] of [["min", v.minPrice], ["max", v.maxPrice], ["rating", v.minRating]] as const) {
    const n = num(val);
    if (n) p.set(k, n);
  }
  if (v.noCorrect) p.set("noCorrect", "1");
  return withCompareParam(withChipParams(`?${p.toString()}`, chips), cmp);
}

/**
 * The form after an edit: "Search instead" (noCorrect) is for the query it was offered on, so
 * editing the query turns typo correction back on.
 */
export function editedForm<V extends Values>(prev: V, next: V): V {
  return prev.noCorrect && next.query !== prev.query ? { ...next, noCorrect: false } : next;
}

export type SharedSearch<V> = { values: V; chips: ChipFilters; cmp: string[] };

/**
 * The search a results URL asks for, or null when it carries none (no query, an empty or too long
 * one, or a query string far longer than any this app writes). Unknown keys are ignored, as are
 * unknown stores, sorts, bad numbers and malformed chip or compare values; `base` fills the gaps.
 */
export function parseShare<V extends Values>(search: string, base: V): SharedSearch<V> | null {
  if (search.length > MAX_SHARE_LENGTH) return null;
  const p = new URLSearchParams(search);
  const q = p.get("q") ?? "";
  if (!q.trim() || q.length > MAX_SHARE_QUERY) return null;
  const sites = [...new Set((p.get("sites") ?? "").split(",").filter((s) => STORE_IDS.has(s)))];
  const sort = p.get("sort") ?? "";
  return {
    values: {
      ...base,
      query: q.trim(),
      sites: sites.length ? sites : base.sites,
      sort: SORTS.has(sort as Sort) ? (sort as Sort) : base.sort,
      minPrice: num(p.get("min")),
      maxPrice: num(p.get("max")),
      minRating: num(p.get("rating")),
      ...(p.get("noCorrect") === "1" ? { noCorrect: true } : {}),
    },
    chips: filtersFromSearch(search),
    cmp: keysFromSearch(search),
  };
}

/**
 * Runs `fn` once, on the next task, however often the calling effect mounts. React's Strict Mode
 * mounts an effect, cleans it up and mounts it again: the first timer is cleared, the second runs,
 * and `flag` stops any later mount. Returns the cleanup for the effect.
 */
export function runOnce(
  flag: { current: boolean },
  fn: () => void,
  timers: { set: (f: () => void) => unknown; clear: (t: unknown) => void } = {
    set: (f) => setTimeout(f, 0),
    clear: (t) => clearTimeout(t as ReturnType<typeof setTimeout>),
  },
): () => void {
  if (flag.current) return () => {};
  const t = timers.set(() => {
    if (flag.current) return;
    flag.current = true;
    fn();
  });
  return () => timers.clear(t);
}
