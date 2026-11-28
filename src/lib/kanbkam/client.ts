import "server-only";
import { KANBKAM_STORE, kanbkamProductUrl } from "./links";

/**
 * Kanbkam price history: one plain HTTP load of a listing's product page and the few text fields
 * read from it (spec decision "Kanbkam price history"). The chart is a base64 PNG and is ignored.
 * Never Kanbkam search: only https://www.kanbkam.com/sa/en/p-<validated id> (links.ts).
 * Pacing, caps, back-off and caching are the service's job (service.ts), not this file's.
 */

export type KanbkamPage = {
  min: number;
  max: number;
  /** Kanbkam's current price for the listing, when shown. */
  current: number | null;
  /** "Recent Price Drop -32.6%" as -32.6 (a rise is positive), when shown. */
  dropPct: number | null;
  /** The store on the buy button ("amazon", "noon"), when shown. */
  store: string | null;
  /** The "since" date as the page writes it, when it shows one. */
  since: string | null;
  title: string | null;
};

export type KanbkamFetch =
  | { kind: "ok"; page: KanbkamPage }
  | { kind: "missing" }
  | { kind: "blocked"; why: "403" | "429" | "challenge" }
  | { kind: "error"; message: string };

const MAX_PAGE = 3_000_000;
const MAX_SECTION = 200_000;
const TIMEOUT_MS = 20_000;
const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

const CHALLENGE = ["challenge-platform", "_cf_chl_opt", "<title>Just a moment", "Attention Required! | Cloudflare", 'id="challenge-running"'];

const num = (s: string | undefined): number | null => {
  if (s === undefined) return null;
  const n = Number(s.replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
};

const decode = (s: string) =>
  s
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();

/** The main product's block: from the product-info section to the similar products, if any. */
function mainSection(html: string): string | null {
  const start = html.indexOf('class="product-info"');
  if (start < 0) return null;
  const end = html.indexOf('class="similar-product', start);
  return html.slice(start, Math.min(end < 0 ? html.length : end, start + MAX_SECTION));
}

// Bounded quantifiers only: a hostile page cannot make these backtrack.
const MIN = /id="min"[^>]{0,200}>\s{0,200}([\d,]{1,12}(?:\.\d{1,4})?)\s{0,200}</;
const MAX = /id="max"[^>]{0,200}>\s{0,200}([\d,]{1,12}(?:\.\d{1,4})?)\s{0,200}</;
const CURRENT = /id="priceNumber"[^>]{0,200}>\s{0,200}([\d,]{1,12}(?:\.\d{1,4})?)\s{0,200}</;
const CHANGE = /Recent Price (Drop|Increase|Raise|Rise)\s{0,20}<\/span>\s{0,400}<span[^>]{0,200}>\s{0,200}([+-]?\d{1,4}(?:\.\d{1,3})?)\s{0,5}%/;
const STORE = /data-gtmid="product-buy\|([a-z]{2,20})\|/;
const SINCE = /\b[Ss]ince\s{1,5}([A-Z][a-z]{2,8}\.? \d{1,2},? \d{4}|\d{4}-\d{2}-\d{2}|\d{1,2}\/\d{1,2}\/\d{4})/;
const TITLE = /<h1[^>]{0,200}>([^<]{1,600})<\/h1>/;

/** The fields of a Kanbkam product page, or null when it shows no sound price history. Pure. */
export function parseKanbkamPage(html: string): KanbkamPage | null {
  const s = mainSection(html);
  if (!s) return null;
  const min = num(MIN.exec(s)?.[1]);
  const max = num(MAX.exec(s)?.[1]);
  if (min === null || max === null || min <= 0 || max <= 0 || min > max) return null;
  const change = CHANGE.exec(s);
  let dropPct = num(change?.[2]);
  if (dropPct !== null && change?.[1] === "Drop" && dropPct > 0) dropPct = -dropPct;
  if (dropPct !== null && change?.[1] !== "Drop" && dropPct < 0) dropPct = -dropPct;
  const current = num(CURRENT.exec(s)?.[1]);
  const title = TITLE.exec(s)?.[1];
  return {
    min,
    max,
    current: current !== null && current > 0 ? current : null,
    dropPct,
    store: STORE.exec(s)?.[1] ?? null,
    since: SINCE.exec(s)?.[1] ?? null,
    title: title ? decode(title) : null,
  };
}

const isChallenge = (html: string) => CHALLENGE.some((m) => html.includes(m));

/** What a response means for this listing. Pure. */
export function classifyKanbkam(site: string, status: number, html: string): KanbkamFetch {
  if (isChallenge(html)) return { kind: "blocked", why: "challenge" };
  if (status === 403) return { kind: "blocked", why: "403" };
  if (status === 429) return { kind: "blocked", why: "429" };
  if (status === 404 || status === 410) return { kind: "missing" };
  if (status !== 200) return { kind: "error", message: `HTTP ${status}` };
  const page = parseKanbkamPage(html);
  // A page for another store's listing (or none) is not this listing's history.
  if (!page || (page.store !== null && page.store !== KANBKAM_STORE[site])) return { kind: "missing" };
  return { kind: "ok", page };
}

type FetchOpts = { fetch?: typeof globalThis.fetch; timeoutMs?: number };

/**
 * A redirect to Kanbkam's own search: what Kanbkam answers for an id it does not know (live check,
 * 2026-11-28: 302 to /sa/en/search/l?q=p). Never followed: Kanbkam search is never loaded.
 */
function redirectsToSearch(location: string | null, base: string): boolean {
  if (!location) return false;
  try {
    const u = new URL(location, base);
    return u.protocol === "https:" && (u.hostname === "www.kanbkam.com" || u.hostname === "kanbkam.com") && u.pathname.startsWith("/sa/en/search");
  } catch {
    return false;
  }
}

/**
 * Loads one listing's product page (exactly one request; a redirect is never followed) and
 * classifies it. Never throws.
 */
export async function fetchKanbkam(site: string, id: string, opts: FetchOpts = {}): Promise<KanbkamFetch> {
  const first = kanbkamProductUrl(site, id);
  if (!first) return { kind: "error", message: "invalid id" };
  const doFetch = opts.fetch ?? globalThis.fetch;
  const init: RequestInit = {
    redirect: "manual",
    signal: AbortSignal.timeout(opts.timeoutMs ?? TIMEOUT_MS),
    headers: { "user-agent": USER_AGENT, accept: "text/html", "accept-language": "en-US,en;q=0.9" },
  };
  try {
    const res = await doFetch(first, init);
    if (res.status >= 300 && res.status < 400) return redirectsToSearch(res.headers.get("location"), first) ? { kind: "missing" } : { kind: "error", message: "redirect" };
    const declared = Number(res.headers.get("content-length"));
    if (Number.isFinite(declared) && declared > MAX_PAGE) return { kind: "error", message: "page too large" };
    const html = await res.text();
    if (html.length > MAX_PAGE) return { kind: "error", message: "page too large" };
    return classifyKanbkam(site, res.status, html);
  } catch (e) {
    return { kind: "error", message: e instanceof Error ? e.message.slice(0, 200) : "error" };
  }
}
