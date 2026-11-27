import type { AaResult } from "./aa";

export type Product = {
  site: string;
  id: string;
  title: string;
  listPrice: number;
  origPrice: number | null;
  discountPct: number | null;
  currency: string;
  rating: number | null;
  /** Set when a rating filter is on but this product's store gives no ratings at all (e.g. Jarir). */
  ratingUnavailable?: true;
  /** Title-structure evidence says this may be another item that names the product; ranked after the rest. */
  weakMatch?: true;
  soldCount: number;
  image: string;
  url: string;
  mainOption?: string;
  shipping?: number | null;
  finalPrice?: number;
  /** No product-detail calls: every product is "ok" and finalPrice = listPrice. */
  detailStatus: "pending" | "ok" | "failed";
};

export type ParsedQuery = {
  terms: string;
  minPrice?: number;
  maxPrice?: number;
  minRating?: number;
  exclude: string[];
};

export type SiteStatus = {
  site: string;
  status: "ok" | "blocked" | "error";
  message?: string;
};

export type RawDetail = unknown;

export type SiteAdapter = {
  id: string;
  label: string;
  searchCalls(
    pq: ParsedQuery,
    variants: string[],
  ): { op: string; args: Record<string, string> }[];
  normalizeSearchItem(raw: unknown): Product | null;
  /** Optional custom executor (e.g. Playwright); default is api-anything via aaCall. */
  runCall?(call: { op: string; args: Record<string, string> }): Promise<AaResult>;
  fetchDetail(p: Product, queryTokens: string[][]): Promise<Product>;
};
