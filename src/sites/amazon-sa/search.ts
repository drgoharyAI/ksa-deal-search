import type { ParsedQuery, Product } from "@/src/lib/types";
import { itemId } from "@/src/lib/item-id";

/** Keep letters, digits, spaces, hyphens; collapse spaces. "" if nothing usable. */
export function sanitizeQ(terms: string): string {
  return terms
    .replace(/[^a-zA-Z0-9 -]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** "SAR 1,234.50" -> 1234.5; anything unparseable -> null. */
function parseMoney(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v !== "string") return null;
  const m = v.replace(/,/g, "").match(/\d+(?:\.\d+)?/);
  if (!m) return null;
  const n = parseFloat(m[0]);
  return Number.isFinite(n) ? n : null;
}

function parseLeadingNumber(v: unknown): number | null {
  if (typeof v !== "string") return null;
  const m = v.replace(/,/g, "").match(/\d+(?:\.\d+)?/);
  if (!m) return null;
  const n = parseFloat(m[0]);
  return Number.isFinite(n) ? n : null;
}

const text = (v: unknown): string => (typeof v === "string" ? v.replace(/\s+/g, " ").trim() : "");

/**
 * The card's title. Since late 2026 Amazon puts the brand alone in a first h2 ("JBL") and the
 * product name, without the brand, in a second h2.a-text-normal ("Flip 6 Bluetooth Box ...").
 * The spec reads both (api-specs/amazon-sa.json); the brand is put back in front unless the name
 * already starts with it. `titleAny` (the first h2) is the fallback for a card with neither.
 */
export function cardTitle(r: Record<string, unknown>): string {
  const name = text(r.title) || text(r.titleAny);
  const brand = text(r.brand);
  if (!brand || !name || brand === name || name.toLowerCase().startsWith(brand.toLowerCase())) return name;
  return `${brand} ${name}`;
}

export function normalizeSearchItem(raw: unknown): Product | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const price = parseMoney(r.price);
  if (price === null || price <= 0) return null;
  const id = itemId(r.id);
  if (id === null) return null;

  const orig = parseMoney(r.origPrice);
  const origPrice = orig !== null && orig > price ? orig : null;
  const discountPct = origPrice !== null ? Math.round((1 - price / origPrice) * 100) : null;

  const img = typeof r.image === "string" ? r.image : "";
  return {
    site: "amazon-sa",
    id,
    title: cardTitle(r),
    listPrice: price,
    origPrice,
    discountPct,
    currency: "SAR",
    rating: parseLeadingNumber(r.rating),
    soldCount: 0,
    image: img.startsWith("//") ? `https:${img}` : img,
    url: `https://www.amazon.sa/dp/${id}`,
    shipping: null,
    finalPrice: price,
    detailStatus: "ok",
  };
}

/** Call budget (no sort on Amazon): main p1 + p2, first usable variant p1 (<= 3 calls). */
export function searchCalls(pq: ParsedQuery, variants: string[]) {
  const calls: { op: "search"; args: { q: string; page: string } }[] = [];
  const q = sanitizeQ(pq.terms);
  if (q) {
    calls.push({ op: "search", args: { q, page: "1" } });
    calls.push({ op: "search", args: { q, page: "2" } });
  }
  const v = variants.map(sanitizeQ).find((s) => s && s !== q);
  if (v) calls.push({ op: "search", args: { q: v, page: "1" } });
  return calls;
}
