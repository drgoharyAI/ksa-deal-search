import type { ParsedQuery, Product } from "@/src/lib/types";
import { itemId } from "@/src/lib/item-id";
import { sanitizeQ } from "@/src/sites/amazon-sa/search";

export { sanitizeQ };

const num = (v: unknown): number | null => {
  const n = typeof v === "string" && v.trim() !== "" ? Number(v.replace(/,/g, "")) : v;
  return typeof n === "number" && Number.isFinite(n) ? n : null;
};

const URL_PREFIX = "https://www.extra.com/en-sa/";

/** A product link as an absolute URL: a relative "/en-sa/..." path is resolved on www.extra.com. */
function absoluteUrl(v: unknown): string | null {
  if (typeof v !== "string" || !v) return null;
  try {
    return new URL(v, "https://www.extra.com").href;
  } catch {
    return null;
  }
}

/** Compares on `price` (shelf price), never `memberPrice`. Repeats of an id are dropped by the pipeline's site+id dedupe. */
export function normalizeSearchItem(raw: unknown): Product | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const price = num(r.price);
  if (price === null || price <= 0) return null;
  const id = itemId(r.id);
  if (id === null) return null;
  const url = absoluteUrl(r.url);
  if (!url?.startsWith(URL_PREFIX)) return null;

  const orig = num(r.origPrice);
  const origPrice = orig !== null && orig > price ? orig : null;
  const discountPct = origPrice !== null ? Math.round((1 - price / origPrice) * 100) : null;

  const rating = typeof r.rating === "number" && Number.isFinite(r.rating) && r.rating > 0 ? r.rating : null;
  const img = typeof r.image === "string" ? r.image : "";
  return {
    site: "extra-sa",
    id,
    title: typeof r.title === "string" ? r.title : "",
    listPrice: price,
    origPrice,
    discountPct,
    currency: "SAR",
    rating,
    soldCount: 0,
    image: img.startsWith("//") ? `https:${img}` : img,
    url,
    shipping: null,
    finalPrice: price,
    detailStatus: "ok",
  };
}

/** Call budget: main p1, main price-asc p1, first usable variant p1 (<= 3 calls). */
export function searchCalls(pq: ParsedQuery, variants: string[]) {
  const calls: { op: "search"; args: Record<string, string> }[] = [];
  const q = sanitizeQ(pq.terms);
  if (q) {
    calls.push({ op: "search", args: { q, page: "1", sort: "score desc" } });
    calls.push({ op: "search", args: { q, page: "1", sort: "price asc" } });
  }
  const v = variants.map(sanitizeQ).find((s) => s && s !== q);
  if (v) calls.push({ op: "search", args: { q: v, page: "1", sort: "score desc" } });
  return calls;
}
