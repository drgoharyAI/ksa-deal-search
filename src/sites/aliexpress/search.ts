import type { ParsedQuery, Product } from "@/src/lib/types";

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Lowercase, drop non-alphanumerics, join words with "-". "" if nothing usable. */
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
  if (price === null || r.id == null || r.id === "") return null;
  const id = String(r.id);

  const discount = num(r.discount);
  let origPrice = num(r.origPrice);
  if (origPrice === null && discount !== null && discount > 0 && discount < 100) {
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
    currency: typeof r.currency === "string" && r.currency ? r.currency : "SAR",
    rating: num(r.rating),
    soldCount: parseSold(typeof r.sold === "string" ? r.sold : undefined),
    image: img.startsWith("//") ? `https:${img}` : img,
    url: `https://www.aliexpress.com/item/${id}.html`,
    shipping: null,
    finalPrice: price,
    detailStatus: "ok",
  };
}

export function searchCalls(pq: ParsedQuery, variants: string[]) {
  const calls: { op: "search"; args: { q: string; page: string; sort: string } }[] = [];
  for (const term of [pq.terms, ...variants]) {
    const q = slugify(term);
    if (!q) continue;
    calls.push({ op: "search", args: { q, page: "1", sort: "default" } });
    calls.push({ op: "search", args: { q, page: "2", sort: "default" } });
    calls.push({ op: "search", args: { q, page: "1", sort: "price_asc" } });
  }
  return calls;
}
