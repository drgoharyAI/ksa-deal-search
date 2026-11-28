import "server-only";
import type { GshopOffer } from "./validate";

/**
 * SerpApi client for Google Shopping KSA (the default source; scrape.ts is the fallback).
 * Docs, read on 2026-11-28:
 * - https://serpapi.com/google-shopping-api: engine=google_shopping, q, google_domain, gl, hl;
 *   shopping_results[]: title, product_id, immersive_product_page_token, source, price, extracted_price.
 * - https://serpapi.com/google-immersive-product-api: engine=google_immersive_product, page_token,
 *   more_stores=true (up to 13 stores); product_results.stores[]: name, link, title, price,
 *   extracted_price, original_price, extracted_original_price, shipping, shipping_extracted.
 *   gl/hl/google_domain are not documented for it, so they are not sent.
 * - https://serpapi.com/api-status-and-error-codes: 200 OK, 400, 401 (no valid key), 403, 404, 410,
 *   429 (hourly limit, or the account ran out of searches), 500/503; body { "error": "..." };
 *   search_metadata.status Success | Processing | Queued | Error.
 * - https://serpapi.com/account-api: GET https://serpapi.com/account.json, free (not counted);
 *   plan_searches_left, total_searches_left.
 * `location` is documented as city-level and optional; gl=sa + google_domain=google.com.sa set the
 * market, so no location is sent (an unknown location name is an error).
 *
 * The host is fixed (no user-controlled URL). The key goes only into the query string of these
 * requests; it is never logged and is scrubbed from every error message.
 */

const SEARCH = "https://serpapi.com/search.json";
const ACCOUNT = "https://serpapi.com/account.json";
const SERPAPI_TIMEOUT_MS = 20_000;
/** Answers are a few hundred KB; anything past this is refused. */
const MAX_BODY = 3_000_000;

export type SerpOpts = { key: string; fetch?: typeof globalThis.fetch; timeoutMs?: number };

/**
 * exhausted: the account has no searches left this month (switch to the fallback until the month
 * ends); down: timeout, network, 5xx, hourly limit or a failed search (fallback for this check);
 * bad: the key or the request was refused (401/403/400).
 */
export type SerpErrorKind = "exhausted" | "down" | "bad";

export class SerpApiError extends Error {
  readonly kind: SerpErrorKind;
  readonly status: number | null;
  constructor(kind: SerpErrorKind, message: string, status: number | null = null) {
    super(message);
    this.name = "SerpApiError";
    this.kind = kind;
    this.status = status;
  }
}

const scrub = (s: string, key: string) => (key ? s.split(key).join("<key>") : s).slice(0, 300);

function errorKind(status: number, message: string): SerpErrorKind {
  if (/run out of searches|out of searches|no searches left|plan.*(used|exceeded)/i.test(message)) return "exhausted";
  if (status === 401 || status === 403 || status === 400) return "bad";
  return "down";
}

async function getJson(base: string, params: Record<string, string>, opts: SerpOpts): Promise<Record<string, unknown>> {
  const url = `${base}?${new URLSearchParams({ ...params, api_key: opts.key }).toString()}`;
  const doFetch = opts.fetch ?? globalThis.fetch;
  let res: Response;
  try {
    res = await doFetch(url, { signal: AbortSignal.timeout(opts.timeoutMs ?? SERPAPI_TIMEOUT_MS), headers: { accept: "application/json" } });
  } catch (e) {
    const name = e instanceof Error ? e.name : "";
    const msg = name === "TimeoutError" || name === "AbortError" ? "SerpApi timed out" : `SerpApi unreachable: ${e instanceof Error ? e.message : String(e)}`;
    throw new SerpApiError("down", scrub(msg, opts.key));
  }
  const declared = Number(res.headers.get("content-length"));
  let text = "";
  try {
    text = Number.isFinite(declared) && declared > MAX_BODY ? "" : await res.text();
  } catch {
    throw new SerpApiError("down", "SerpApi answer could not be read", res.status);
  }
  if (text.length > MAX_BODY || (Number.isFinite(declared) && declared > MAX_BODY)) throw new SerpApiError("down", "SerpApi answer too large", res.status);
  let body: Record<string, unknown> = {};
  try {
    const v = JSON.parse(text) as unknown;
    if (v && typeof v === "object" && !Array.isArray(v)) body = v as Record<string, unknown>;
  } catch {
    // not JSON: handled by status below
  }
  const error = typeof body.error === "string" ? body.error : "";
  if (!res.ok) throw new SerpApiError(errorKind(res.status, error), scrub(`SerpApi ${res.status}: ${error || "request failed"}`, opts.key), res.status);
  if (!text || !Object.keys(body).length) throw new SerpApiError("down", "SerpApi answer is not JSON", res.status);
  return body;
}

const str = (v: unknown) => (typeof v === "string" ? v : "");
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v > 0 ? v : null);

/** A search that ran but found nothing answers 200 with this kind of error. */
const NO_RESULTS = /hasn't returned any results|no results/i;

function failedSearch(body: Record<string, unknown>, key: string): void {
  const meta = body.search_metadata as { status?: unknown } | undefined;
  const error = str(body.error);
  if (error && NO_RESULTS.test(error)) return;
  if (error) throw new SerpApiError(errorKind(200, error), scrub(`SerpApi: ${error}`, key), 200);
  if (meta && str(meta.status) && str(meta.status) !== "Success") throw new SerpApiError("down", `SerpApi search ${str(meta.status)}`, 200);
}

/** ISO code of a Google price text ("SAR 349.00", "349.00 ر.س.", "$80.00"); "?" when it names none. */
export function currencyOf(text: string): string {
  if (/\bSAR\b|ر\.س|﷼/.test(text)) return "SAR";
  const code = /\b([A-Z]{3})\b/.exec(text);
  if (code) return code[1];
  if (text.includes("$")) return "USD";
  if (text.includes("€")) return "EUR";
  if (text.includes("£")) return "GBP";
  return "?";
}

/** A short search phrase from a store title: no brackets or punctuation, the first 7 words. */
export function cleanQuery(title: string): string {
  const noBrackets = title.replace(/\([^)]{0,200}\)|\[[^\]]{0,200}\]/g, " ");
  const head = noBrackets.split(/ [-|–—] |،/)[0];
  return head
    .replace(/[^\p{L}\p{N}\s.+-]/gu, " ")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 7)
    .join(" ")
    .slice(0, 100);
}

export type ShoppingItem = { title: string; productId: string; token: string; source: string; price: number | null; currency: string };

/** Step 1: Google Shopping results for the cleaned title (one billed search). */
export async function serpShopping(q: string, opts: SerpOpts): Promise<ShoppingItem[]> {
  const body = await getJson(SEARCH, { engine: "google_shopping", q, google_domain: "google.com.sa", gl: "sa", hl: "en" }, opts);
  failedSearch(body, opts.key);
  const list = Array.isArray(body.shopping_results) ? (body.shopping_results as Record<string, unknown>[]) : [];
  return list.slice(0, 60).flatMap((r) => {
    const token = str(r.immersive_product_page_token);
    const title = str(r.title);
    if (!token || !title) return [];
    return [{ title, productId: str(r.product_id), token, source: str(r.source), price: num(r.extracted_price), currency: currencyOf(str(r.price)) }];
  });
}

/** Step 2: the stores selling one product, with direct links (one billed search). */
export async function serpImmersive(token: string, opts: SerpOpts): Promise<{ title: string; offers: GshopOffer[] }> {
  const body = await getJson(SEARCH, { engine: "google_immersive_product", page_token: token, more_stores: "true" }, opts);
  failedSearch(body, opts.key);
  const pr = (body.product_results ?? {}) as Record<string, unknown>;
  const title = str(pr.title);
  const stores = Array.isArray(pr.stores) ? (pr.stores as Record<string, unknown>[]) : [];
  const offers = stores.slice(0, 40).flatMap((s): GshopOffer[] => {
    const price = num(s.extracted_price);
    const store = str(s.name).trim();
    if (price === null || !store) return [];
    const shipping = typeof s.shipping_extracted === "number" && Number.isFinite(s.shipping_extracted) ? s.shipping_extracted : undefined;
    return [
      {
        store,
        title: str(s.title) || title,
        price,
        currency: currencyOf(str(s.price)),
        foreign: false,
        was: num(s.extracted_original_price),
        url: str(s.link) || null,
        ...(shipping !== undefined && { shipping }),
        from: "serpapi",
      },
    ];
  });
  return { title, offers };
}

/** Searches left on the account (free call, not counted); null when it does not say. */
export async function serpAccount(opts: SerpOpts): Promise<{ searchesLeft: number | null }> {
  const body = await getJson(ACCOUNT, {}, opts);
  const left = [body.plan_searches_left, body.total_searches_left].find((v) => typeof v === "number" && Number.isFinite(v));
  return { searchesLeft: typeof left === "number" ? left : null };
}
