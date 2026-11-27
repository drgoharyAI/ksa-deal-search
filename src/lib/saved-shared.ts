import type { Product } from "@/src/lib/types";

/**
 * Client-safe shapes for the saved products (favourites) and the recently viewed strip (UX phase
 * U5). The server keeps both in SQLite (src/lib/saved.ts); the page sends a snapshot of the
 * product as it was listed, because a store page is never fetched again to describe it.
 */

/** What we keep of a product: where it is, what it is called, its picture and its listed price. */
export type ProductSnapshot = {
  site: string;
  id: string;
  title: string;
  url: string;
  image: string | null;
  price: number;
  currency: string;
};

/** A saved product, with the latest price our observations hold for it. */
export type SavedItem = ProductSnapshot & {
  /** The search it was saved from, when known (a price watch needs one). */
  query: string | null;
  savedAt: number;
  /** The latest observed price and when (from any search since or before saving); null without one. */
  latest: { price: number; at: number } | null;
  /** latest.price minus the saved price, when the latest observation came after saving; else null. */
  change: number | null;
};

/** A product opened at its store, newest first. `price` is what it cost when it was opened. */
export type ViewedItem = Omit<ProductSnapshot, "price"> & { price: number | null; viewedAt: number };

export const MAX_SAVED = 500;
export const MAX_VIEWED = 50;

const priceOf = (p: Product) => p.finalPrice ?? p.listPrice;

/** The snapshot of a listed product (the page's side of a save or a view). */
export function snapshotOf(p: Product): ProductSnapshot {
  return { site: p.site, id: p.id, title: p.title, url: p.url, image: p.image || null, price: priceOf(p), currency: p.currency || "SAR" };
}

/** The key a saved or viewed product goes by, the same as the compare key ("noon-sa+N123"). */
export const savedKey = (p: Pick<ProductSnapshot, "site" | "id">): string => `${p.site}+${p.id}`;
