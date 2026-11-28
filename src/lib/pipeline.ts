import { aaCall, type AaResult } from "@/src/lib/aa";
import { cachedAt } from "@/src/lib/cache";
import type { ParsedQuery, Product, SiteAdapter, SiteStatus } from "@/src/lib/types";
import { parseQuery } from "@/src/lib/query/parse";
import { expandTerms } from "@/src/lib/query/synonyms";
import { currentSpeller } from "@/src/lib/query/vocab";
import { matchTerms } from "@/src/lib/query/filler";
import { tokenizeKeepDigits } from "@/src/lib/match/tokenize";
import { filterRelevant } from "@/src/lib/match/relevance";
import { dropAccessories } from "@/src/lib/match/accessory";
import { dedupe, dedupeByStore } from "@/src/lib/match/dedupe";
import { groupProducts, groupRefs, orderGroups, type GroupRef } from "@/src/lib/match/group";
import { isBookCode, isOtherProduct } from "@/src/lib/match/category";
import { applyBrandPriceRules } from "@/src/lib/match/price";
import { markWeakMatches } from "@/src/lib/match/structure";
import { scoreMatches } from "@/src/lib/match/confidence";
import { sites as registry } from "@/src/sites/registry";
import { STORE_HOST_SITES, storeImage, storeLink } from "@/src/lib/store-hosts";
import { rank, type SortKey } from "./rank";
import { hasValidPrice, isExcluded, notOutOfStock, passesPriceRating, ratinglessSites } from "./filters";

export type SearchInput = {
  query: string;
  sites: string[];
  sort: SortKey;
  minPrice?: number;
  maxPrice?: number;
  minRating?: number;
  /** Search the query as typed: no typo correction ("Search instead for ..."). */
  noCorrect?: boolean;
};

/** A typo correction: the query as typed and the query searched. */
export type QueryCorrection = { from: string; to: string };

export type SearchResult = {
  products: Product[];
  statuses: SiteStatus[];
  queryTokens: string[][];
  /** The same product at several stores (src/lib/match/group.ts), in display order; ids only. */
  groups?: GroupRef[];
  /**
   * Group members missing from `products`: `products` stays deduped across stores (one card per
   * look-alike, as before grouping), so a twin at another store is only here, for the group's rows.
   */
  groupExtras?: Product[];
  /** Listings dropped because their store marks them out of stock (site and id), when any. */
  outOfStock?: { site: string; id: string }[];
  /** The query was corrected before the store calls (src/lib/query/spell.ts). */
  correction?: QueryCorrection;
  reason?: string;
};

const NO_MATCH_REASON = "No products matched your search and filters";

export type Call = { op: string; args: Record<string, string> };

/** Sends one store call. Default: the adapter's own runCall, else api-anything via aaCall. */
export type CallExec = (adapter: SiteAdapter, call: Call) => Promise<AaResult>;

/**
 * Development hooks (eval harness). Production passes none, so behaviour is unchanged:
 * - exec replaces the transport for every store call (e.g. replaying recorded answers);
 * - onFiltered sees the products that passed every filter, before dedupe and ranking.
 * `signal` (production too): a caller that went away (the HTTP request closed) skips the store
 * calls still queued, as the streaming search does.
 */
export type SearchOptions = {
  exec?: CallExec;
  onFiltered?: (products: Product[]) => void;
  signal?: AbortSignal;
};

// api-anything classes meaning "the store is refusing us" (vs a plain error).
const BLOCKED_CLASSES = new Set(["blocked", "rate"]);
const AA_BLOCKED_CLASSES = new Set([...BLOCKED_CLASSES, "drift"]);

const MSG_BLOCKED = "Store blocked the request; try again later";
const MSG_FAILED = "Store request failed";
const MSG_UNREADABLE = "Store results could not be read";
export const MSG_UNSUPPORTED = "English search terms only";
/** "input": the store answered "no results" (e.g. Trendyol's 404 past the last page): an empty answer. */
const EMPTY_CLASSES = new Set(["input"]);
/**
 * Store titles are cut to this length before matching. The longest of 22,078 recorded titles is
 * 472 characters; the cap bounds the matcher's regexes (a few are quadratic in the worst case,
 * see docs/QA.md) against a garbage or hostile listing with a huge title.
 */
export const MAX_TITLE = 1000;

/** The host of a URL for a log line ("(not a URL)" otherwise): no path or query. */
const hostOf = (url: unknown): string => {
  try {
    return typeof url === "string" ? new URL(url).hostname.slice(0, 100) : "(not a URL)";
  } catch {
    return "(not a URL)";
  }
};

const isNum = (n: number | undefined): n is number => typeof n === "number" && Number.isFinite(n);

/** One store's answer: its products (normalized, unfiltered) and its status. */
export type SiteOutcome = { products: Product[]; status: SiteStatus };

/**
 * Asks one store and normalizes its answer. Never throws. `signal` lets a caller that went away
 * (a closed search stream) skip the store calls still queued; calls already sent finish and are
 * cached as usual. runSearch passes its caller's signal, if any.
 */
export async function fetchSite(
  adapter: SiteAdapter,
  prepared: Pick<PreparedSearch, "pq" | "variants">,
  opts: { exec?: CallExec; signal?: AbortSignal } = {},
): Promise<SiteOutcome> {
  const { pq, variants } = prepared;
  const execOverride = opts.exec;
  const signal = opts.signal;
  try {
    const calls = adapter.searchCalls(pq, variants);
    if (!calls.length && pq.terms.trim()) {
      // The adapter dropped every word (it sends English search terms only): say so, never "ok, 0".
      return { products: [], status: { site: adapter.id, status: "unsupported", message: MSG_UNSUPPORTED } };
    }
    const own = adapter.runCall?.bind(adapter);
    const aaOpts = signal ? { ttlMs: 600_000, lane: "search" as const, signal } : { ttlMs: 600_000, lane: "search" as const };
    const exec: (c: Call) => Promise<AaResult> = execOverride
      ? (c) => execOverride(adapter, c)
      : own
        ? (c) => (signal ? own(c, { signal }) : own(c))
        : (c) => aaCall(adapter.id, c.op, c.args, aaOpts);
    const results = await Promise.all(
      calls.map((c) =>
        Promise.resolve()
          .then(() => exec(c))
          .catch(
            (e: unknown): AaResult => ({ ok: false, class: "error", reason: e instanceof Error ? e.message : String(e) }),
          ),
      ),
    );
    const raws: unknown[] = [];
    // When each raw item's answer came from the store: a cached answer keeps its original time.
    const answeredAt = new Map<unknown, number>();
    const failed: Extract<AaResult, { ok: false }>[] = [];
    for (const r of results) {
      if (r.ok) {
        const at = cachedAt(r);
        if (Array.isArray(r.data)) for (const item of r.data) {
          if (adapter.isNoResults?.(item)) continue;
          raws.push(item);
          if (at !== undefined) answeredAt.set(item, at);
        }
      } else if (EMPTY_CLASSES.has(r.class)) {
        console.warn("[search] call answered no results", adapter.id, r.class, r.reason);
      } else failed.push(r);
    }
    for (const f of failed) console.warn("[search] call failed", adapter.id, f.class, f.reason);

    const products: Product[] = [];
    const hostChecked = STORE_HOST_SITES.includes(adapter.id);
    let offHost = 0;
    let offHostName = "";
    for (const raw of raws) {
      try {
        const p = adapter.normalizeSearchItem(raw);
        if (!p) continue;
        // Store-supplied links and pictures (src/lib/store-hosts.ts): a link must be the store's
        // own https page (else the product is dropped), a picture its own image host (else none).
        // Every registered store has rules (tests/lib/store-hosts.test.ts); a test-only fake has none.
        if (hostChecked) {
          const url = storeLink(adapter.id, p.url);
          if (!url) {
            offHost += 1;
            offHostName ||= hostOf(p.url);
            continue;
          }
          p.url = url;
          p.image = p.image ? (storeImage(adapter.id, p.image) ?? "") : "";
        }
        if (p.title.length > MAX_TITLE) p.title = p.title.slice(0, MAX_TITLE);
        const at = answeredAt.get(raw);
        if (at !== undefined) p.fetchedAt = at;
        products.push(p);
      } catch {
        // skip malformed item
      }
    }

    // One line per store per search: the count and a host, never a URL (it may carry query data).
    if (offHost) console.warn("[search] listings dropped: link off the store's hosts", adapter.id, offHost, offHostName);

    let status: SiteStatus = { site: adapter.id, status: "ok" };
    if (failed.length && !results.some((r) => r.ok)) {
      // api-anything stores: a runtime drift is almost always an anti-bot page, so "blocked".
      // Custom executors (noon) keep their own drift ("no product cards") as an error.
      const blockedClasses = adapter.runCall ? BLOCKED_CLASSES : AA_BLOCKED_CLASSES;
      const blocked = failed.some((f) => blockedClasses.has(f.class));
      status = {
        site: adapter.id,
        status: blocked ? "blocked" : "error",
        message: blocked ? MSG_BLOCKED : MSG_FAILED,
      };
    } else if (raws.length && !products.length) {
      // The store answered items but none could be read: its page or payload changed. "ok, 0
      // results" would read as "nothing matched at this store".
      console.warn("[search] no item could be normalized", adapter.id, raws.length);
      status = { site: adapter.id, status: "error", message: MSG_UNREADABLE };
    } else if (failed.length) {
      status = { ...status, message: `${failed.length} of ${results.length} requests failed` };
    }
    return { products, status };
  } catch (e) {
    console.warn("[search] site failed", adapter.id, e);
    return { products: [], status: { site: adapter.id, status: "error", message: MSG_FAILED } };
  }
}

/** What every store call and the assemble step share: the parsed query and the stores to ask. */
export type PreparedSearch = {
  pq: ParsedQuery;
  variants: string[];
  queryTokens: string[][];
  adapters: SiteAdapter[];
  /** Set when the query was corrected: the stores get the corrected query. */
  correction?: QueryCorrection;
};

export function prepareSearch(input: SearchInput): PreparedSearch {
  // Typos are fixed before anything else, so the stores, the matcher and the recordings (eval
  // replay) all see the corrected words. English words only; operators and model codes stay.
  const fixed = input.noCorrect ? null : currentSpeller().correct(input.query);
  const correction = fixed?.changed ? { from: input.query, to: fixed.query } : undefined;
  const pq = parseQuery(correction ? correction.to : input.query);
  const variants = expandTerms(pq.terms);
  // Digits stay even when single ("nintendo switch 2", "airpods 4"): a model number is a hard attribute.
  // Filler ("best", "cheap", "for") is not a required title word; stores still get the raw words.
  const queryTokens = [pq.terms, ...variants].map((t) => tokenizeKeepDigits(matchTerms(t)));

  // Own keys only: "constructor" or "__proto__" must not resolve to an Object.prototype member
  // (the search route filters ids too, but the alert checker calls this with stored ids).
  const adapters = input.sites
    .map((id) => (Object.hasOwn(registry, id) ? registry[id] : undefined))
    .filter((a): a is SiteAdapter => a !== undefined);
  return correction ? { pq, variants, queryTokens, adapters, correction } : { pq, variants, queryTokens, adapters };
}

export async function runSearch(input: SearchInput, opts: SearchOptions = {}): Promise<SearchResult> {
  const prepared = prepareSearch(input);
  const outs = await Promise.all(prepared.adapters.map((a) => fetchSite(a, prepared, { exec: opts.exec, signal: opts.signal })));
  return assembleResults(input, prepared, outs, opts);
}

/**
 * The pure step after the store calls: filters, relevance, dedupe, ranking and grouping over the
 * stores' outcomes, in the order given (pass them in the order of `prepared.adapters`). The
 * streaming search calls it with the stores answered so far; with every store it is runSearch.
 */
export function assembleResults(
  input: SearchInput,
  prepared: Pick<PreparedSearch, "pq" | "queryTokens" | "correction">,
  outs: SiteOutcome[],
  opts: Pick<SearchOptions, "onFiltered"> = {},
): SearchResult {
  const { pq, queryTokens } = prepared;
  const minPrice = input.minPrice ?? pq.minPrice;
  const maxPrice = input.maxPrice ?? pq.maxPrice;
  const minRating = input.minRating ?? pq.minRating;
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
  const outOfStock = products.filter((p) => !notOutOfStock(p)).map((p) => ({ site: p.site, id: p.id }));
  products = products.filter(notOutOfStock);

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
  // Groups come from listings deduped within each store only, so each store keeps its row; the
  // product list stays deduped across stores until the grouped card shows the groups.
  const perStore = rank(dedupeByStore(products), input.sort);
  products = rank(dedupe(products), input.sort);
  const groups = orderGroups(groupProducts(perStore), input.sort).filter((g) => g.members.length > 1);
  const groupOf = new Map(groups.flatMap((g) => g.members.map((p) => [p, g.key] as const)));
  const listed = new Set(products);
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- p is a member of groups, and groupOf maps every group member
  const groupExtras = groups.flatMap((g) => g.members.filter((p) => !listed.has(p))).map((p) => ({ ...p, groupKey: groupOf.get(p)! }));
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- guarded by groupOf.has(p) in the same expression
  products = products.map((p) => (groupOf.has(p) ? { ...p, groupKey: groupOf.get(p)! } : p));

  const result: SearchResult = { products, statuses, queryTokens, groups: groupRefs(groups), groupExtras };
  if (outOfStock.length) result.outOfStock = outOfStock;
  if (prepared.correction) result.correction = prepared.correction;
  if (!products.length) result.reason = NO_MATCH_REASON;
  return result;
}
