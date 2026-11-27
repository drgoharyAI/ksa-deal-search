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
    title: typeof r.title === "string" ? r.title : "",
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
