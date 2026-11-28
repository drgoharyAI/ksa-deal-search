import "server-only";
import type { GshopOffer } from "./validate";
import { isKsaUrl } from "./links";

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
 * `location` pins the search to Riyadh (a canonical name from https://serpapi.com/locations.json).
 * Without it the same query was answered from SerpApi's varying proxy locations: on 2026-11-28
 * "JBL Flip 6" gave 8 Flip 6 offers at 01:56 UTC and 40 unrelated speakers (no Flip 6) at 02:59
 * and 09:39; with the location it gave 21 Flip 6 offers (Amazon.sa, noon, LuLu, Doos.sa).
 *
 * The host is fixed (no user-controlled URL). The key goes only into the query string of these
 * requests; it is never logged and is scrubbed from every error message.
 */

const SEARCH = "https://serpapi.com/search.json";
const SERP_LOCATION = "Riyadh,Riyadh Province,Saudi Arabia";
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

/** Words after a model number that still name the model ("iPhone 15 Pro Max", "Galaxy S24 Ultra"). */
const MODEL_QUALIFIERS = new Set(["pro", "max", "plus", "ultra", "mini", "lite", "se", "fe", "air", "neo", "xl", "xxl", "slim", "edge"]);

/** A size, a unit or a count: "65", "1.7L", "256GB", "4K", "20W", "20000mAh", "3rd". Never a model number. */
const UNIT_TOKEN = /^\d+(?:[.,]\d+)?(?:gb|tb|mb|l|ml|cl|cm|mm|m|w|kw|mah|hz|khz|k|inch|in|"|v|kg|g|pcs|pc|x|st|nd|rd|th)?$/i;
/** Words that make the number before them a size or a count ("65 inch", "2 pack"). */
const UNIT_WORDS = new Set(["inch", "inches", "in", "pack", "pcs", "pieces", "piece", "x", "gb", "tb", "w", "l", "ml", "mm", "cm", "m", "mah", "hours", "hour", "hrs", "liter", "liters", "litre", "litres", "years", "year", "ft", "kg", "g"]);
/** A model code: letters and digits together ("Q60D", "KO8501", "WH-1000XM5", "S24"), not a unit. */
const isModelCode = (w: string) => /[a-z]/i.test(w) && /\d/.test(w) && !UNIT_TOKEN.test(w);
const isBareNumber = (w: string) => /^\d{1,4}$/.test(w);

/**
 * The search phrase for a store title: the product's name up to its model, plus model words right
 * after it ("Pro Max"); colours, sizes and marketing words after it are left out. The model is a
 * model code (letters with digits) when there is one, else a bare series number that is not a size
 * or count ("Flip 6", "iPhone 16", but not "65 inch" or "2 Pack"). Without either, the first 4
 * words, sizes kept. Live 2026-11-28: the 7-word "JBL Flip 6 Gray Portable Bluetooth Speaker"
 * brought Google Shopping 40 unrelated speakers and no Flip 6.
 */
export function cleanQuery(title: string): string {
  const noBrackets = title.replace(/\([^)]{0,200}\)|\[[^\]]{0,200}\]/g, " ");
  const head = noBrackets.split(/ [-|–—] |،|,/)[0];
  const words = head
    .replace(/[^\p{L}\p{N}\s.+/"-]/gu, " ")
    .split(/\s+/)
    .filter(Boolean);
  const unitAfter = (i: number) => i + 1 < words.length && UNIT_WORDS.has(words[i + 1].toLowerCase());
  let model = words.slice(0, 8).findIndex(isModelCode);
  if (model < 0) model = words.slice(0, 6).findIndex((w, i) => i > 0 && isBareNumber(w) && !unitAfter(i));
  if (model < 0) return words.slice(0, 4).join(" ").slice(0, 100);
  const out = model < 6 ? words.slice(0, model + 1) : [words[0], words[model]];
  for (let i = model + 1; i < words.length && out.length < 6 && MODEL_QUALIFIERS.has(words[i].toLowerCase()); i++) out.push(words[i]);
  return out.join(" ").slice(0, 100);
}

export type ShoppingItem = { title: string; productId: string; token: string; source: string; price: number | null; currency: string };

/** Step 1: Google Shopping results for the cleaned title (one billed search). */
export async function serpShopping(q: string, opts: SerpOpts): Promise<ShoppingItem[]> {
  const body = await getJson(SEARCH, { engine: "google_shopping", q, google_domain: "google.com.sa", gl: "sa", hl: "en", location: SERP_LOCATION }, opts);
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
    const currency = currencyOf(str(s.price));
    const link = str(s.link) || null;
    const shipping = typeof s.shipping_extracted === "number" && Number.isFinite(s.shipping_extracted) ? s.shipping_extracted : undefined;
    return [
      {
        store,
        title: str(s.title) || title,
        price,
        currency,
        // Not a Saudi offer: priced in another currency, or sold from a non-Saudi host.
        foreign: currency !== "SAR" || (link !== null && !isKsaUrl(link)),
        was: num(s.extracted_original_price),
        url: link,
        ...(shipping !== undefined && { shipping }),
        from: "serpapi",
      },
    ];
  });
  return { title, offers };
}

/** Searches left on the account and the plan's renewal date (free call, not counted); null when it does not say. */
export async function serpAccount(opts: SerpOpts): Promise<{ searchesLeft: number | null; renewal: string | null }> {
  const body = await getJson(ACCOUNT, {}, opts);
  const left = [body.plan_searches_left, body.total_searches_left].find((v) => typeof v === "number" && Number.isFinite(v));
  const renewal = str(body.plan_renewal_date);
  return { searchesLeft: typeof left === "number" ? left : null, renewal: /^\d{4}-\d{2}-\d{2}$/.test(renewal) ? renewal : null };
}
