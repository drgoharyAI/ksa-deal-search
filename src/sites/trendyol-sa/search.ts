import type { ParsedQuery, Product } from "@/src/lib/types";
import { sanitizeQ } from "@/src/sites/amazon-sa/search";

export { sanitizeQ };

const num = (v: unknown): number | null => {
  const n = typeof v === "string" && v.trim() !== "" ? Number(v.replace(/,/g, "")) : v;
  return typeof n === "number" && Number.isFinite(n) ? n : null;
};

export function normalizeSearchItem(raw: unknown): Product | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const price = num(r.priceNum) ?? num(r.price);
  if (price === null || price <= 0 || r.id == null || r.id === "") return null;
  const id = String(r.id);

  const path = typeof r.path === "string" ? r.path.replace(/^\/+/, "") : "";
  if (!path) return null;

  const orig = num(r.origPrice);
  const origPrice = orig !== null && orig > price ? orig : null;
  const discountPct = origPrice !== null ? Math.round((1 - price / origPrice) * 100) : null;

  const rating = typeof r.rating === "number" && Number.isFinite(r.rating) ? r.rating : null;
  const img = typeof r.image === "string" ? r.image : "";
  return {
    site: "trendyol-sa",
    id,
    title: typeof r.title === "string" ? r.title : "",
    listPrice: price,
    origPrice,
    discountPct,
    currency: "SAR",
    rating,
    soldCount: 0,
    image: img.startsWith("//") ? `https:${img}` : img,
    url: `https://www.trendyol.sa/${path}`,
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
    calls.push({ op: "search", args: { q, page: "1", sort: "SCORE" } });
    calls.push({ op: "search", args: { q, page: "1", sort: "PRICE_BY_ASC" } });
  }
  const v = variants.map(sanitizeQ).find((s) => s && s !== q);
  if (v) calls.push({ op: "search", args: { q: v, page: "1", sort: "SCORE" } });
  return calls;
}
