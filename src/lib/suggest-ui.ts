/**
 * Client-safe, pure helpers for the search-box suggestions: recent searches, the option list,
 * prefix highlighting and the combobox keyboard model. Kept pure so they unit-test without a DOM.
 */

export const RECENTS_KEY = "deal-search:recent-searches";
export const MAX_RECENTS = 20;
const EMPTY_RECENTS_SHOWN = 5;
const TYPED_RECENTS_SHOWN = 3;
const MAX_OPTIONS = 8;
export const MIN_SUGGEST_CHARS = 2;
export const DEBOUNCE_MS = 150;

const clean = (s: string): string => s.trim().replace(/\s+/g, " ");
const norm = (s: string): string => clean(s).toLowerCase();

/** Parse the stored list; anything malformed reads as no recents. */
export function parseRecents(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const v: unknown = JSON.parse(raw);
    if (!Array.isArray(v)) return [];
    return v.filter((x): x is string => typeof x === "string" && clean(x) !== "").map(clean).slice(0, MAX_RECENTS);
  } catch {
    return [];
  }
}

/** Put a submitted query first; a case-insensitive repeat moves up instead of duplicating. */
export function addRecent(list: string[], query: string): string[] {
  const q = clean(query);
  if (!q) return list;
  const key = q.toLowerCase();
  return [q, ...list.filter((x) => x.toLowerCase() !== key)].slice(0, MAX_RECENTS);
}

export function removeRecent(list: string[], query: string): string[] {
  const key = norm(query);
  return list.filter((x) => x.toLowerCase() !== key);
}

/** Recents for the typed text: empty input shows the newest few; otherwise a prefix or word-start match. */
export function matchRecents(list: string[], typed: string, limit?: number): string[] {
  const q = norm(typed);
  if (!q) return list.slice(0, limit ?? EMPTY_RECENTS_SHOWN);
  return list
    .filter((r) => {
      const s = r.toLowerCase();
      return s.startsWith(q) || s.includes(` ${q}`);
    })
    .slice(0, limit ?? TYPED_RECENTS_SHOWN);
}

export type SuggestOption = { value: string; recent: boolean };

/** Matching recents first, then remote suggestions not already shown, capped at MAX_OPTIONS. */
export function buildOptions(recents: string[], remote: string[], typed: string): SuggestOption[] {
  const out: SuggestOption[] = matchRecents(recents, typed).map((value) => ({ value, recent: true }));
  if (norm(typed).length < MIN_SUGGEST_CHARS) return out;
  const seen = new Set(out.map((o) => o.value.toLowerCase()));
  for (const r of remote) {
    if (out.length >= MAX_OPTIONS) break;
    const key = r.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ value: r, recent: false });
  }
  return out.slice(0, MAX_OPTIONS);
}

/**
 * Split a suggestion for Google-style display: the part the user typed stays plain (`typed: true`),
 * the rest is set bold. Matches at the start, else at a word start, else anywhere; no match = all bold.
 */
export function highlightParts(text: string, typed: string): { text: string; typed: boolean }[] {
  const q = norm(typed);
  const s = text.toLowerCase();
  let at = q ? (s.startsWith(q) ? 0 : s.indexOf(` ${q}`)) : -1;
  if (at > 0) at += 1;
  if (at < 0 && q) at = s.indexOf(q);
  if (at < 0) return [{ text, typed: false }];
  const parts = [
    { text: text.slice(0, at), typed: false },
    { text: text.slice(at, at + q.length), typed: true },
    { text: text.slice(at + q.length), typed: false },
  ];
  return parts.filter((p) => p.text !== "");
}

/** Identity of an option across list updates (a recent and a suggestion with the same text differ). */
export const optionKey = (o: SuggestOption): string => `${o.recent ? "r" : "s"}:${o.value}`;

/**
 * Index of the highlighted option in the current list, or -1 when it is no longer there. The
 * highlight is tracked by option, not by position: when suggestions land after an arrow press,
 * Enter must never select an item the user did not highlight.
 */
export function activeIndex(options: SuggestOption[], key: string | null): number {
  return key === null ? -1 : options.findIndex((o) => optionKey(o) === key);
}

export type ComboState = { open: boolean; active: number; count: number };
export type ComboAction =
  | { type: "none" }
  | { type: "move"; active: number; open: true }
  | { type: "select"; index: number }
  | { type: "close"; preventDefault: boolean }
  | { type: "remove"; index: number };

/**
 * The WAI-ARIA combobox keyboard model. Arrows move with wrap (and open a closed list), Enter on a
 * highlighted option selects it (Enter with none highlighted is left to the form: it submits),
 * Escape closes, Tab closes without stopping focus moving on, Shift+Delete removes a recent.
 */
export function comboKey(key: string, st: ComboState, shift = false): ComboAction {
  const { open, active, count } = st;
  switch (key) {
    case "ArrowDown":
      if (!count) return { type: "none" };
      if (!open) return { type: "move", active: 0, open: true };
      return { type: "move", active: active + 1 >= count ? 0 : active + 1, open: true };
    case "ArrowUp":
      if (!count) return { type: "none" };
      if (!open) return { type: "move", active: count - 1, open: true };
      return { type: "move", active: active <= 0 ? count - 1 : active - 1, open: true };
    case "Enter":
      return open && active >= 0 && active < count ? { type: "select", index: active } : { type: "none" };
    case "Escape":
      return open ? { type: "close", preventDefault: true } : { type: "none" };
    case "Tab":
      return open ? { type: "close", preventDefault: false } : { type: "none" };
    case "Delete":
      return shift && open && active >= 0 && active < count ? { type: "remove", index: active } : { type: "none" };
    default:
      return { type: "none" };
  }
}
