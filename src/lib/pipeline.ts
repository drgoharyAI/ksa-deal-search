import { aaCall, type AaResult } from "@/src/lib/aa";
import type { Product, SiteAdapter, SiteStatus } from "@/src/lib/types";
import { parseQuery } from "@/src/lib/query/parse";
import { expandTerms } from "@/src/lib/query/synonyms";
import { tokenize } from "@/src/lib/match/tokenize";
import { filterRelevant } from "@/src/lib/match/relevance";
import { dropAccessories } from "@/src/lib/match/accessory";
import { dedupe } from "@/src/lib/match/dedupe";
import { sites as registry } from "@/src/sites/registry";
import { rank, type SortKey } from "./rank";

export type SearchInput = {
  query: string;
  sites: string[];
  sort: SortKey;
  minPrice?: number;
  maxPrice?: number;
  minRating?: number;
};

export type SearchResult = {
  products: Product[];
  statuses: SiteStatus[];
  queryTokens: string[][];
  reason?: string;
};

export const NO_MATCH_REASON = "No products matched your search and filters";

type Call = { op: string; args: Record<string, string> };

// Failure classes that mean "the store is refusing us" rather than a plain error.
const BLOCKED_CLASSES = new Set(["blocked", "rate_limited", "rate-limited", "ratelimited", "rate_limit"]);

const isNum = (n: number | undefined): n is number => typeof n === "number" && Number.isFinite(n);

async function runSite(
  adapter: SiteAdapter,
  calls: Call[],
): Promise<{ raws: unknown[]; status: SiteStatus }> {
  const exec: (c: Call) => Promise<AaResult> =
    adapter.runCall?.bind(adapter) ??
    ((c) => aaCall(adapter.id, c.op, c.args, { ttlMs: 600_000, lane: "search" }));
  const results = await Promise.all(
    calls.map((c) =>
      exec(c).catch(
        (e): AaResult => ({ ok: false, class: "error", reason: e instanceof Error ? e.message : String(e) }),
      ),
    ),
  );
  const raws: unknown[] = [];
  const failed: Extract<AaResult, { ok: false }>[] = [];
  for (const r of results) {
    if (!r.ok) failed.push(r);
    else if (Array.isArray(r.data)) raws.push(...r.data);
  }
  let status: SiteStatus = { site: adapter.id, status: "ok" };
  if (failed.length && failed.length === results.length) {
    status = {
      site: adapter.id,
      status: failed.some((f) => BLOCKED_CLASSES.has(f.class)) ? "blocked" : "error",
      message: failed[0].reason,
    };
  } else if (failed.length) {
    status = { ...status, message: `${failed.length} of ${results.length} requests failed` };
  }
  return { raws, status };
}

export async function runSearch(input: SearchInput): Promise<SearchResult> {
  const pq = parseQuery(input.query);
  const minPrice = input.minPrice ?? pq.minPrice;
  const maxPrice = input.maxPrice ?? pq.maxPrice;
  const minRating = input.minRating ?? pq.minRating;

  const variants = expandTerms(pq.terms);
  const queryTokens = [tokenize(pq.terms), ...variants.map(tokenize)];

  const adapters = input.sites.map((id) => registry[id]).filter((a): a is SiteAdapter => !!a);
  const outs = await Promise.all(
    adapters.map(async (a) => {
      const { raws, status } = await runSite(a, a.searchCalls(pq, variants));
      const products = raws.map((r) => a.normalizeSearchItem(r)).filter((p): p is Product => !!p);
      return { products, status };
    }),
  );
  const statuses = outs.map((o) => o.status);

  const seen = new Set<string>();
  let products = outs
    .flatMap((o) => o.products)
    .filter((p) => {
      const k = `${p.site}+${p.id}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    })
    .filter((p) => Number.isFinite(p.listPrice) && p.listPrice > 0);

  const exclude = pq.exclude.map((w) => w.toLowerCase());
  if (exclude.length) {
    products = products.filter((p) => {
      const t = p.title.toLowerCase();
      return !exclude.some((w) => t.includes(w));
    });
  }
  products = filterRelevant(products, queryTokens);
  products = dropAccessories(products, queryTokens.flat());
  products = products.filter((p) => {
    if (isNum(minPrice) && p.listPrice < minPrice) return false;
    if (isNum(maxPrice) && p.listPrice > maxPrice) return false;
    if (isNum(minRating) && (p.rating === null || p.rating < minRating)) return false;
    return true;
  });
  products = rank(dedupe(products), input.sort);

  const result: SearchResult = { products, statuses, queryTokens };
  if (!products.length) result.reason = NO_MATCH_REASON;
  return result;
}
