import type { HistoryEntry } from "@/src/lib/alerts/shared";
import { parseShare, shareSearch } from "@/src/lib/share";
import { withChipParams, type ChipFilters } from "@/src/lib/chips";
import { withCompareParam } from "@/src/lib/compare";

/**
 * Client-safe: the History page's "Re-run" link, and how Back and Forward move on the search page.
 * Link: /?q=…&sites=a,b&sort=…&min=…&max=…&rating=…&run=1 (read by src/lib/share.ts, which runs
 * any results URL that carries a query; `run=1` is kept so links saved earlier still read the same).
 */
export function rerunHref(e: Pick<HistoryEntry, "query" | "sites" | "sort" | "filters">): string {
  const p = new URLSearchParams({ q: e.query, sites: e.sites.join(","), sort: e.sort });
  if (e.filters.minPrice !== undefined) p.set("min", String(e.filters.minPrice));
  if (e.filters.maxPrice !== undefined) p.set("max", String(e.filters.maxPrice));
  if (e.filters.minRating !== undefined) p.set("rating", String(e.filters.minRating));
  p.set("run", "1");
  return `/?${p.toString()}`;
}

type Values = { query: string; sites: string[]; sort: "price" | "discount" | "deal"; minPrice: string; maxPrice: string; minRating: string };

/**
 * The form values a re-run link asks for, or null when the URL carries no query. `run`: the link
 * says run=1 (the page itself now runs any results URL with a query; see src/lib/share.ts).
 */
export function valuesFromUrl<V extends Values>(search: string, base: V): { values: V; run: boolean } | null {
  const shared = parseShare(search, base);
  return shared ? { values: shared.values, run: new URLSearchParams(search).get("run") === "1" } : null;
}

/** history.state key the search page sets on the clean "/" entry that "go home" pushed. */
export const HOME_ENTRY = "dealSearchHome";

/**
 * The search a results URL runs (query, stores, sort and limits; chips and compare keys left out),
 * written the one way shareSearch writes it, or null when the URL carries no search. Two URLs with
 * the same key show the same search.
 */
export function searchKey(search: string): string | null {
  const shared = parseShare(search, { query: "", sites: [], sort: "price", minPrice: "", maxPrice: "", minRating: "" });
  return shared ? shareSearch(shared.values) : null;
}

/**
 * What the search page does on Back or Forward (popstate) within "/":
 * - "home": the entry "go home" pushed: show the clean home (stashing the results shown);
 * - "restore": the results entry of the stashed search (`stash`: its searchKey) while the home
 *   shows (Back after "go home"): bring those results back, with the chips from the URL;
 * - "run": any other results entry (it carries a query) while the home shows: run that search
 *   again, as a shared link would (a stash of another search never stands in for it);
 * - "sync": anything else: the chips follow the URL.
 */
export function historyMove(search: string, state: unknown, s: { stash: string | null; showingHome: boolean }): "home" | "restore" | "run" | "sync" {
  if (state && typeof state === "object" && (state as Record<string, unknown>)[HOME_ENTRY] === true) return "home";
  if (!s.showingHome) return "sync";
  const key = searchKey(search);
  if (key === null) return "sync";
  return s.stash !== null && key === s.stash ? "restore" : "run";
}

/**
 * How the search page writes its URL. A search started from the home (the URL has no query yet)
 * gets a new entry, so Back returns to the home, but only once it has something to show
 * (`committed`: a first result, or the search finished on its own): until then "wait" leaves the
 * home's URL alone, so a search stopped early or failed leaves no entry behind. Anything else
 * (chips, sort, compare, a new query on a results URL) replaces the current entry.
 */
export function urlWrite(current: string, running: boolean, committed: boolean): "push" | "replace" | "wait" {
  if (!running || new URLSearchParams(current).get("q")?.trim()) return "replace";
  return committed ? "push" : "wait";
}

/** The keys of a results URL's search (shareSearch); the chip and compare keys are other modules'. */
const SEARCH_KEYS = ["q", "sites", "sort", "min", "max", "rating", "run"];

/**
 * The URL the search page should show, how to write it, and whether it is a results URL. `form`: the search on screen (null when
 * none). `settled`: that search has ended (finished, failed or stopped). A search that ended with
 * nothing to show (stopped before any product came) counts as none, like no search at all: the URL
 * is the clean "/" with only the chip and compare keys, so a reload or a shared link never runs a
 * search the page is not showing, and chip and sort changes keep writing it.
 */
export function urlPlan(
  current: string,
  s: { form: Values | null; committed: boolean; settled: boolean; chips: ChipFilters; cmp: string[] },
): { search: string; write: "push" | "replace" | "wait"; results: boolean } {
  if (s.form && (s.committed || !s.settled)) {
    return { search: shareSearch(s.form, s.chips, s.cmp), write: urlWrite(current, true, s.committed), results: true };
  }
  const p = new URLSearchParams(current);
  for (const k of SEARCH_KEYS) p.delete(k);
  const rest = p.toString();
  return { search: withCompareParam(withChipParams(rest ? `?${rest}` : "", s.chips), s.cmp), write: "replace", results: false };
}
