import type { ParsedQuery, Product } from "@/src/lib/types";
import { sanitizeQ } from "@/src/sites/amazon-sa/search";

export { sanitizeQ };

/**
 * SACO KSA (www.saco.sa/en, SAR) via its server-rendered search page, read by an API Anything
 * HTML recipe (api-specs/saco-sa.json). Each card's add-to-cart button carries the SKU, English
 * name, price and currency; the card shows the struck-out price, a star rating and a stock badge.
 * Spike and mapping: docs/superpowers/spikes/2026-11-27-saco-sa.md.
 */

const URL_PREFIX = "https://www.saco.sa/en/product/";

/** "1,399", "249" or "249.50" -> number; anything else -> null. */
const num = (v: unknown): number | null => {
  const s = typeof v === "string" ? v.replace(/,/g, "").trim() : null;
  const n = s !== null && s !== "" ? Number(s) : v;
  return typeof n === "number" && Number.isFinite(n) ? n : null;
};

/** The card's star style "--rating:4" -> 4; 0 (no reviews) or anything odd -> null. */
function ratingOf(v: unknown): number | null {
  const m = typeof v === "string" ? /--rating:\s*([\d.]+)/.exec(v) : null;
  const n = m ? Number(m[1]) : NaN;
  return Number.isFinite(n) && n > 0 && n <= 5 ? n : null;
}

/**
 * Stock from the card's badge, read with its cart button. "In stock" / "Limited stock" -> true.
 * "Out of stock" (SACO cannot deliver it from the default region; such cards offer only "Click and
 * pick") -> false, unless the same card still says "Add to cart" (a contradiction: unknown).
 * No badge or any other text -> unknown.
 */
export function stockOf(badge: unknown, cart: unknown): boolean | undefined {
  const b = typeof badge === "string" ? badge.trim().toLowerCase() : "";
  if (b === "in stock" || b === "limited stock") return true;
  if (b === "out of stock") return typeof cart === "string" && /^add to cart$/i.test(cart.trim()) ? undefined : false;
  return undefined;
}

export function normalizeSearchItem(raw: unknown): Product | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const price = num(r.price);
  if (price === null || price <= 0) return null;
  // The KSA storefront prices in SAR; a card naming another currency is not used.
  if (r.currency !== undefined && r.currency !== "SAR") return null;
  const sku = typeof r.id === "string" ? r.id.trim() : "";
  if (!/^\d+$/.test(sku)) return null;
  const url = typeof r.url === "string" ? r.url.split(/[?#]/)[0] : "";
  if (!url.startsWith(URL_PREFIX) || !url.endsWith(`-p-${sku}`)) return null;
  const title = typeof r.title === "string" ? r.title.trim() : "";
  if (!title) return null;

  const orig = num(r.orig);
  const origPrice = orig !== null && orig > price ? orig : null;
  const discountPct = origPrice !== null ? Math.round((1 - price / origPrice) * 100) : null;
  const img = typeof r.image === "string" ? r.image : "";
  const inStock = stockOf(r.stock, r.cart);

  return {
    site: "saco-sa",
    id: sku.replace(/^0+(?=\d)/, ""),
    title,
    listPrice: price,
    origPrice,
    discountPct,
    currency: "SAR",
    rating: ratingOf(r.rating),
    soldCount: 0,
    ...(inStock !== undefined && { inStock }),
    image: img.startsWith("https://") ? img : "",
    url,
    shipping: null,
    finalPrice: price,
    detailStatus: "ok",
  };
}

/**
 * Call budget: main term, best match and lowest price (2 calls). No synonym variant: SACO's search
 * matches typos and synonyms itself, and each answer is a ~1.9 MB page.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- variants intentionally ignored (see above)
export function searchCalls(pq: ParsedQuery, _variants: string[]) {
  const q = sanitizeQ(pq.terms);
  if (!q) return [];
  return [
    { op: "search" as const, args: { q, sort: "custom-position", dir: "DESC" } },
    { op: "search" as const, args: { q, sort: "price", dir: "ASC" } },
  ];
}
