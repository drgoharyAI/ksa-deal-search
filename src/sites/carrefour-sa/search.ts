import type { ParsedQuery, Product } from "@/src/lib/types";
import { sanitizeQ } from "@/src/sites/amazon-sa/search";

export { sanitizeQ };

const num = (v: unknown): number | null => {
  const n = typeof v === "string" && v.trim() !== "" ? Number(v.replace(/,/g, "")) : v;
  return typeof n === "number" && Number.isFinite(n) ? n : null;
};

const URL_PREFIX = "https://www.carrefourksa.com/mafsau/en/";

/** HTML-scrape cards: no image, no rating. Product id is parsed from the /p/<id> url segment. */
export function normalizeSearchItem(raw: unknown): Product | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const price = num(r.price);
  if (price === null || price <= 0) return null;
  const url = typeof r.url === "string" ? r.url : "";
  if (!url.startsWith(URL_PREFIX)) return null;
  const id = /\/p\/(\d+)/.exec(url)?.[1];
  if (!id) return null;

  const orig = num(r.orig);
  const origPrice = orig !== null && orig > price ? orig : null;
  const discountPct = origPrice !== null ? Math.round((1 - price / origPrice) * 100) : null;

  return {
    site: "carrefour-sa",
    id,
    title: typeof r.title === "string" ? r.title : "",
    listPrice: price,
    origPrice,
    discountPct,
    currency: "SAR",
    rating: null,
    soldCount: 0,
    image: "",
    url,
    shipping: null,
    finalPrice: price,
    detailStatus: "ok",
  };
}

/** Call budget: main first page, main price_asc first page, first usable variant first page (<= 3). page is 0-based. */
export function searchCalls(pq: ParsedQuery, variants: string[]) {
  const calls: { op: "search"; args: Record<string, string> }[] = [];
  const q = sanitizeQ(pq.terms);
  if (q) {
    calls.push({ op: "search", args: { q, page: "0", sort: "relevance" } });
    calls.push({ op: "search", args: { q, page: "0", sort: "price_asc" } });
  }
  const v = variants.map(sanitizeQ).find((s) => s && s !== q);
  if (v) calls.push({ op: "search", args: { q: v, page: "0", sort: "relevance" } });
  return calls;
}
