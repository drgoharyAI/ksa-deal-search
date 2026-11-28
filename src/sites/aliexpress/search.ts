import type { ParsedQuery, Product } from "@/src/lib/types";
import { itemId } from "@/src/lib/item-id";

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Lowercase, drop non-alphanumerics, join words with "-". "" if nothing usable. */
/**
 * Product link that opens on the Saudi storefront: AliExpress reads these two parameters and sets
 * its region cookie to ship-to SA and currency SAR (checked live: aep_usuc_f=...c_tp=SAR&region=SA),
 * whatever region the visitor's browser had before. Without them the page shows the visitor's last
 * region, so prices and shipping may not be the KSA ones.
 */
const KSA_PARAMS = "_randl_currency=SAR&_randl_shipto=SA";
export const itemUrl = (id: string): string => `https://www.aliexpress.com/item/${id}.html?${KSA_PARAMS}`;

export function slugify(terms: string): string {
  return terms
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** "10,000+ sold" -> 10000, "1.2K sold" -> 1200. Missing/odd -> 0 (never NaN). */
export function parseSold(s: string | undefined): number {
  if (typeof s !== "string") return 0;
  const m = s.replace(/,/g, "").match(/(\d+(?:\.\d+)?)\s*([km])?/i);
  if (!m) return 0;
  const mult = { k: 1e3, m: 1e6 }[(m[2] ?? "").toLowerCase()] ?? 1;
  const n = Math.round(parseFloat(m[1]) * mult);
  return Number.isFinite(n) ? n : 0;
}

const num = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : null;

export function normalizeSearchItem(raw: unknown): Product | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const price = num(r.price);
  if (price === null) return null;
  // KSA/SAR only: a price in another currency (or none stated) is not used.
  if (r.currency !== "SAR") return null;
  const id = itemId(r.id);
  if (id === null) return null;

  // A discount outside 0-100 % or a "was" price at or under the price is store noise, not a deal.
  const rawDiscount = num(r.discount);
  const discount = rawDiscount !== null && rawDiscount > 0 && rawDiscount < 100 ? rawDiscount : null;
  const rawOrig = num(r.origPrice);
  let origPrice = rawOrig !== null && rawOrig > price ? rawOrig : null;
  if (origPrice === null && discount !== null) {
    origPrice = round2(price / (1 - discount / 100));
  }

  const img = typeof r.image === "string" ? r.image : "";
  return {
    site: "aliexpress",
    id,
    title: typeof r.title === "string" ? r.title : "",
    listPrice: price,
    origPrice,
    discountPct: discount,
    currency: "SAR",
    rating: num(r.rating),
    soldCount: parseSold(typeof r.sold === "string" ? r.sold : undefined),
    image: img.startsWith("//") ? `https:${img}` : img,
    url: itemUrl(id),
    shipping: null,
    finalPrice: price,
    detailStatus: "ok",
  };
}

/** Call budget: main p1, main price-asc p1, first usable variant p1 (<= 3 calls). */
export function searchCalls(pq: ParsedQuery, variants: string[]) {
  const calls: { op: "search"; args: { q: string; page: string; sort: string } }[] = [];
  const q = slugify(pq.terms);
  if (q) {
    calls.push({ op: "search", args: { q, page: "1", sort: "default" } });
    calls.push({ op: "search", args: { q, page: "1", sort: "price_asc" } });
  }
  const v = variants.map(slugify).find((s) => s && s !== q);
  if (v) calls.push({ op: "search", args: { q: v, page: "1", sort: "default" } });
  return calls;
}
