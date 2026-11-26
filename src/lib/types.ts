export type Product = {
  site: string;
  id: string;
  title: string;
  listPrice: number;
  origPrice: number | null;
  discountPct: number | null;
  currency: string;
  rating: number | null;
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
  fetchDetail(p: Product, queryTokens: string[][]): Promise<Product>;
};
