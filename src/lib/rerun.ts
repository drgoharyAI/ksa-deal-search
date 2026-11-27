import { STORES } from "@/src/lib/stores";
import type { HistoryEntry } from "@/src/lib/alerts/shared";

/**
 * Client-safe: the History page's "Re-run" link and its reading on the search page.
 * Link: /?q=…&sites=a,b&sort=…&min=…&max=…&rating=…&run=1
 */
type Values = { query: string; sites: string[]; sort: "price" | "discount" | "deal"; minPrice: string; maxPrice: string; minRating: string };

const SORT_KEYS = new Set(["price", "discount", "deal"]);
const STORE_IDS = new Set<string>(STORES.map((s) => s.id));

export function rerunHref(e: Pick<HistoryEntry, "query" | "sites" | "sort" | "filters">): string {
  const p = new URLSearchParams({ q: e.query, sites: e.sites.join(","), sort: e.sort });
  if (e.filters.minPrice !== undefined) p.set("min", String(e.filters.minPrice));
  if (e.filters.maxPrice !== undefined) p.set("max", String(e.filters.maxPrice));
  if (e.filters.minRating !== undefined) p.set("rating", String(e.filters.minRating));
  p.set("run", "1");
  return `/?${p.toString()}`;
}

/** The form values a re-run link asks for, or null when the URL carries no query. */
export function valuesFromUrl<V extends Values>(search: string, base: V): { values: V; run: boolean } | null {
  const p = new URLSearchParams(search);
  const q = p.get("q")?.slice(0, 200) ?? "";
  if (!q.trim()) return null;
  const sites = (p.get("sites") ?? "").split(",").filter((s) => STORE_IDS.has(s));
  const sort = p.get("sort") ?? "";
  const num = (k: string) => {
    const v = p.get(k) ?? "";
    return v && Number.isFinite(Number(v)) ? v : "";
  };
  return {
    values: {
      ...base,
      query: q,
      sites: sites.length ? sites : base.sites,
      sort: SORT_KEYS.has(sort) ? (sort as Values["sort"]) : base.sort,
      minPrice: num("min"),
      maxPrice: num("max"),
      minRating: num("rating"),
    },
    run: p.get("run") === "1",
  };
}

/** history.state key the search page sets on the clean "/" entry that "go home" pushed. */
export const HOME_ENTRY = "dealSearchHome";

/**
 * What the search page does on Back or Forward (popstate) within "/":
 * - "home": the entry "go home" pushed: show the clean home (stashing the results shown);
 * - "restore": an entry with chip params while the home shows and earlier results are stashed
 *   (Back after "go home"): bring those results back, with the chips from the URL;
 * - "sync": anything else: the chips follow the URL.
 */
export function historyMove(search: string, state: unknown, s: { stashed: boolean; showingHome: boolean }): "home" | "restore" | "sync" {
  if (state && typeof state === "object" && (state as Record<string, unknown>)[HOME_ENTRY] === true) return "home";
  if (s.showingHome && s.stashed && new URLSearchParams(search).size > 0) return "restore";
  return "sync";
}
