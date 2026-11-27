import type { ParsedQuery, Product } from "@/src/lib/types";
import { sanitizeQ } from "@/src/sites/amazon-sa/search";

export { sanitizeQ };

const num = (v: unknown): number | null => {
  const n = typeof v === "string" && v.trim() !== "" ? Number(v) : v;
  return typeof n === "number" && Number.isFinite(n) ? n : null;
};

export function normalizeSearchItem(raw: unknown): Product | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const price = num(r.price);
  if (price === null || price <= 0 || r.id == null || r.id === "") return null;
  const id = String(r.id);

  const orig = num(r.origPrice);
  const origPrice = orig !== null && orig > price ? orig : null;
  let discountPct: number | null = null;
  if (origPrice !== null) discountPct = Math.round((1 - price / origPrice) * 100);

  const path = typeof r.path === "string" ? r.path.replace(/^\/+/, "") : "";
  const img = typeof r.image === "string" ? r.image : "";
  return {
    site: "jarir",
    id,
    title: typeof r.title === "string" ? r.title : "",
    listPrice: price,
    origPrice,
    discountPct,
    currency: "SAR",
    rating: null,
    soldCount: 0,
    image: img.startsWith("//") ? `https:${img}` : img,
    url: `https://www.jarir.com/sa-en/${path}`,
    shipping: null,
    finalPrice: price,
    detailStatus: "ok",
  };
}

/** Call budget: main p1, main price-asc p1, first usable variant p1 (<= 3 calls). */
export function searchCalls(pq: ParsedQuery, variants: string[]) {
  const calls: { op: "search"; args: Record<string, string> }[] = [];
  const rel = { sort_by: "relevance", sort_order: "descending" };
  const q = sanitizeQ(pq.terms);
  if (q) {
    calls.push({ op: "search", args: { q, page: "1", ...rel } });
    calls.push({ op: "search", args: { q, page: "1", sort_by: "final_price", sort_order: "ascending" } });
  }
  const v = variants.map(sanitizeQ).find((s) => s && s !== q);
  if (v) calls.push({ op: "search", args: { q: v, page: "1", ...rel } });
  return calls;
}
