/**
 * A store item id as a string, or null when the store sent none we can use. Only non-empty
 * strings and finite numbers count: an object or array id (a payload shape change) would
 * otherwise stringify to "[object Object]" and give every item the same id, so the pipeline's
 * site+id dedupe would collapse them into one.
 */
export function itemId(v: unknown): string | null {
  if (typeof v === "string") return v.trim() === "" ? null : v;
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  return null;
}
