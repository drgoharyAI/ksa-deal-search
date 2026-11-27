import { normQuery, type HistoryEntry } from "./alerts/shared";

/** A query from the user's own history: `count` searches, the last at `at` (ms). */
export type QuerySuggestion = { query: string; count: number; at: number };

const POPULAR = 5;
const RECENT = 6;

/**
 * Home-page suggestions from the search history (newest first, as /api/history returns it):
 * "popular" are queries searched at least twice, most searched first; "recent" are the latest other
 * queries. Each query appears once, spelled as it was last typed.
 */
export function homeSuggestions(entries: Pick<HistoryEntry, "query" | "at">[]): { popular: QuerySuggestion[]; recent: QuerySuggestion[] } {
  const byKey = new Map<string, QuerySuggestion>();
  for (const e of entries) {
    const key = normQuery(e.query);
    if (!key) continue;
    const s = byKey.get(key);
    if (s) {
      s.count += 1;
      if (e.at > s.at) Object.assign(s, { at: e.at, query: e.query.trim() });
    } else byKey.set(key, { query: e.query.trim(), count: 1, at: e.at });
  }
  const all = [...byKey.values()];
  const popular = all
    .filter((s) => s.count >= 2)
    .sort((a, b) => b.count - a.count || b.at - a.at)
    .slice(0, POPULAR);
  const taken = new Set(popular.map((s) => normQuery(s.query)));
  const recent = all
    .filter((s) => !taken.has(normQuery(s.query)))
    .sort((a, b) => b.at - a.at)
    .slice(0, RECENT);
  return { popular, recent };
}
