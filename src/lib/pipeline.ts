import { aaCall, type AaResult } from "@/src/lib/aa";
import type { ParsedQuery, Product, SiteAdapter, SiteStatus } from "@/src/lib/types";
import { parseQuery } from "@/src/lib/query/parse";
import { expandTerms } from "@/src/lib/query/synonyms";
import { tokenizeKeepDigits } from "@/src/lib/match/tokenize";
import { filterRelevant } from "@/src/lib/match/relevance";
import { dropAccessories } from "@/src/lib/match/accessory";
import { dedupe } from "@/src/lib/match/dedupe";
import { isBookCode, isOtherProduct } from "@/src/lib/match/category";
import { applyBrandPriceRules } from "@/src/lib/match/price";
import { markWeakMatches } from "@/src/lib/match/structure";
import { scoreMatches } from "@/src/lib/match/confidence";
import { sites as registry } from "@/src/sites/registry";
import { rank, type SortKey } from "./rank";
import { hasValidPrice, isExcluded, passesPriceRating, ratinglessSites } from "./filters";

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

export type Call = { op: string; args: Record<string, string> };

/** Sends one store call. Default: the adapter's own runCall, else api-anything via aaCall. */
export type CallExec = (adapter: SiteAdapter, call: Call) => Promise<AaResult>;

/**
 * Development hooks (eval harness). Production passes none, so behaviour is unchanged:
 * - exec replaces the transport for every store call (e.g. replaying recorded answers);
 * - onFiltered sees the products that passed every filter, before dedupe and ranking.
 */
export type SearchOptions = {
  exec?: CallExec;
  onFiltered?: (products: Product[]) => void;
};

// api-anything classes meaning "the store is refusing us" (vs a plain error).
const BLOCKED_CLASSES = new Set(["blocked", "rate"]);
const AA_BLOCKED_CLASSES = new Set([...BLOCKED_CLASSES, "drift"]);

const MSG_BLOCKED = "Store blocked the request; try again later";
const MSG_FAILED = "Store request failed";

const isNum = (n: number | undefined): n is number => typeof n === "number" && Number.isFinite(n);

async function runSite(
  adapter: SiteAdapter,
  pq: ParsedQuery,
  variants: string[],
  execOverride?: CallExec,
): Promise<{ products: Product[]; status: SiteStatus }> {
  try {
    const calls = adapter.searchCalls(pq, variants);
    const exec: (c: Call) => Promise<AaResult> = execOverride
      ? (c) => execOverride(adapter, c)
      : adapter.runCall?.bind(adapter) ??
      ((c) => aaCall(adapter.id, c.op, c.args, { ttlMs: 600_000, lane: "search" }));
    const results = await Promise.all(
      calls.map((c) =>
        Promise.resolve()
          .then(() => exec(c))
          .catch(
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
    for (const f of failed) console.warn("[search] call failed", adapter.id, f.class, f.reason);

    const products: Product[] = [];
    for (const raw of raws) {
      try {
        const p = adapter.normalizeSearchItem(raw);
        if (p) products.push(p);
      } catch {
        // skip malformed item
      }
    }

    let status: SiteStatus = { site: adapter.id, status: "ok" };
    if (failed.length && failed.length === results.length) {
      // api-anything stores: a runtime drift is almost always an anti-bot page, so "blocked".
      // Custom executors (noon) keep their own drift ("no product cards") as an error.
      const blockedClasses = adapter.runCall ? BLOCKED_CLASSES : AA_BLOCKED_CLASSES;
      const blocked = failed.some((f) => blockedClasses.has(f.class));
      status = {
        site: adapter.id,
        status: blocked ? "blocked" : "error",
        message: blocked ? MSG_BLOCKED : MSG_FAILED,
      };
    } else if (failed.length) {
      status = { ...status, message: `${failed.length} of ${results.length} requests failed` };
    }
    return { products, status };
  } catch (e) {
    console.warn("[search] site failed", adapter.id, e);
    return { products: [], status: { site: adapter.id, status: "error", message: MSG_FAILED } };
  }
}

export async function runSearch(input: SearchInput, opts: SearchOptions = {}): Promise<SearchResult> {
  const pq = parseQuery(input.query);
  const minPrice = input.minPrice ?? pq.minPrice;
  const maxPrice = input.maxPrice ?? pq.maxPrice;
  const minRating = input.minRating ?? pq.minRating;

  const variants = expandTerms(pq.terms);
  // Digits stay even when single ("nintendo switch 2", "airpods 4"): a model number is a hard attribute.
  const queryTokens = [tokenizeKeepDigits(pq.terms), ...variants.map(tokenizeKeepDigits)];

  const adapters = input.sites.map((id) => registry[id]).filter((a): a is SiteAdapter => !!a);
  const outs = await Promise.all(adapters.map((a) => runSite(a, pq, variants, opts.exec)));
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
    .filter(hasValidPrice);

  if (pq.exclude.length) products = products.filter((p) => !isExcluded(p, pq.exclude));
  // Stores whose whole result carries no rating (Jarir never shows one): a rating filter keeps
  // their products, flagged, instead of silently removing the store.
  const ratingless = ratinglessSites(outs.map((o) => ({ site: o.status.site, products: o.products })));

  products = filterRelevant(products, queryTokens);
  products = products.filter((p) => !isBookCode(p.id, queryTokens.flat()) && !isOtherProduct(p.title, queryTokens.flat()));
  products = dropAccessories(products, queryTokens.flat(), queryTokens);
  products = applyBrandPriceRules(products, queryTokens[0]);
  products = products.filter((p) => passesPriceRating(p, { minPrice, maxPrice, minRating }, ratingless));
  if (isNum(minRating)) {
    products = products.map((p) => (p.rating === null && ratingless.has(p.site) ? { ...p, ratingUnavailable: true } : p));
  }
  products = markWeakMatches(products, queryTokens);
  products = scoreMatches(products, queryTokens);
  opts.onFiltered?.(products);
  products = rank(dedupe(products), input.sort);

  const result: SearchResult = { products, statuses, queryTokens };
  if (!products.length) result.reason = NO_MATCH_REASON;
  return result;
}
