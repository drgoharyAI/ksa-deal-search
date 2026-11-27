import type { HistoryEntry } from "@/src/lib/alerts/shared";
import { parseShare } from "@/src/lib/share";

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
 * What the search page does on Back or Forward (popstate) within "/":
 * - "home": the entry "go home" pushed: show the clean home (stashing the results shown);
 * - "restore": an entry with chip params while the home shows and earlier results are stashed
 *   (Back after "go home"): bring those results back, with the chips from the URL;
 * - "run": a results entry (it carries a query) while the home shows and nothing is stashed (the
 *   search was left before any result came): run that search again, as a shared link would;
 * - "sync": anything else: the chips follow the URL.
 */
export function historyMove(search: string, state: unknown, s: { stashed: boolean; showingHome: boolean }): "home" | "restore" | "run" | "sync" {
  if (state && typeof state === "object" && (state as Record<string, unknown>)[HOME_ENTRY] === true) return "home";
  const params = new URLSearchParams(search);
  if (s.showingHome && s.stashed && params.size > 0) return "restore";
  if (s.showingHome && !s.stashed && params.get("q")?.trim()) return "run";
  return "sync";
}

/**
 * How the search page writes its URL: a search shown over the home (the URL has no query yet)
 * gets a new entry, so Back returns to the home; anything else (chips, sort, compare, a new query
 * on a results URL) replaces the current entry.
 */
export function urlWrite(current: string, showingResults: boolean): "push" | "replace" {
  return showingResults && !new URLSearchParams(current).get("q")?.trim() ? "push" : "replace";
}
