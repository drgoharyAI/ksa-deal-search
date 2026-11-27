import type { AaResult } from "@/src/lib/aa";
import { ABORTED, type ParsedQuery, type Product } from "@/src/lib/types";
import type { Page } from "playwright-core";
import { TtlCache } from "@/src/lib/cache";
import { withNoonPage } from "./browser";

/**
 * noon KSA (saudi-en, SAR) via the owner's real Chrome (see ./browser.ts).
 * Data comes from the server-rendered search page DOM: `[data-qa="plp-product-box"]` cards.
 * Selectors and mapping: docs/superpowers/spikes/2026-11-27-noon-sa.md ("Playwright spike").
 */

const BASE = "https://www.noon.com/saudi-en";
const LOAD_TIMEOUT_MS = 25_000;
const MIN_GAP_MS = 2_000;
const CACHE_TTL_MS = 600_000;
const BLOCK_BACKOFF_MS = 10 * 60_000;
const SKU_RE = /\/([A-Za-z0-9]+)\/p\/?$/;

/** Keep letters, digits, spaces, hyphens; collapse spaces. "" if nothing usable. */
export function sanitizeQ(terms: string): string {
  return terms
    .replace(/[^a-zA-Z0-9 -]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Main term only (noon search is broad; variants would double the page loads).
 * Pages 1 and 2: a price-ascending URL param was not verified in the spike, so sort is "".
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- variants intentionally ignored (see above)
export function searchCalls(pq: ParsedQuery, _variants: string[]) {
  const q = sanitizeQ(pq.terms);
  if (!q) return [];
  return ["1", "2"].map((page) => ({ op: "search" as const, args: { q, page, sort: "" } }));
}

/** Card fields as read from the page DOM (all strings). */
export type NoonCard = {
  href: string | null;
  title: string | null;
  price: string | null;
  origPrice: string | null;
  rating: string | null;
  reviews: string | null;
  image: string | null;
};

/** Shape returned by runCall and stored in tests/fixtures/noon-sa-search.json. */
export type RawNoonItem = {
  id: string | null;
  title: string;
  price: number | null;
  origPrice: number | null;
  currency: string;
  rating: number | null;
  reviews: number | null;
  image: string | null;
  url: string;
};

function num(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v !== "string") return null;
  const m = v.replace(/,/g, "").match(/\d+(?:\.\d+)?/);
  if (!m) return null;
  const n = parseFloat(m[0]);
  return Number.isFinite(n) ? n : null;
}

/** "71.9K" -> 71900, "1.2M" -> 1200000, "845" -> 845 (approximate counts). */
function count(v: string | null): number | null {
  if (v == null) return null;
  const m = v.trim().match(/^([\d.,]+)\s*([KkMm])?$/);
  if (!m) return null;
  const base = parseFloat(m[1].replace(/,/g, ""));
  if (!Number.isFinite(base)) return null;
  const mult = m[2] ? (m[2].toUpperCase() === "K" ? 1e3 : 1e6) : 1;
  return Math.round(base * mult);
}

/** Absolute noon KSA product URL without query/hash, or null if not under /saudi-en/. */
function cleanUrl(href: unknown): string | null {
  if (typeof href !== "string" || !href) return null;
  let u: URL;
  try {
    u = new URL(href, "https://www.noon.com");
  } catch {
    return null;
  }
  if (u.protocol !== "https:" || u.hostname !== "www.noon.com" || !u.pathname.startsWith("/saudi-en/")) return null;
  return `${u.origin}${u.pathname}`;
}

export function toRawItems(cards: NoonCard[]): RawNoonItem[] {
  const out: RawNoonItem[] = [];
  for (const c of cards) {
    const url = cleanUrl(c.href);
    if (!url || !c.title) continue;
    out.push({
      id: url.match(SKU_RE)?.[1] ?? null,
      title: c.title,
      price: num(c.price),
      origPrice: num(c.origPrice),
      currency: "SAR",
      rating: num(c.rating),
      reviews: count(c.reviews),
      image: c.image,
      url,
    });
  }
  return out;
}

export function normalizeSearchItem(raw: unknown): Product | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const url = cleanUrl(r.url);
  const id = url?.match(SKU_RE)?.[1];
  if (!url || !id) return null;
  const n = num(r.price);
  const price = n !== null && n > 0 ? n : null;
  if (price === null) return null;

  const orig = num(r.origPrice);
  const origPrice = orig !== null && orig > price ? orig : null;
  const discountPct = origPrice !== null ? Math.round((1 - price / origPrice) * 100) : null;
  const rating = num(r.rating);

  let image = typeof r.image === "string" ? r.image : "";
  if (image.startsWith("//")) image = `https:${image}`;
  if (!image.startsWith("https://")) image = "";

  return {
    site: "noon-sa",
    id,
    title: typeof r.title === "string" ? r.title : "",
    listPrice: price,
    origPrice,
    discountPct,
    currency: "SAR",
    rating: rating !== null && rating <= 5 ? rating : null,
    soldCount: 0,
    image,
    url,
    shipping: null,
    finalPrice: price,
    detailStatus: "ok",
  };
}

// ---------------- page driving ----------------

/** The subset of Playwright's Page this adapter uses (lets tests pass a fake). */
export type NoonPage = Pick<
  Page,
  "goto" | "waitForLoadState" | "waitForTimeout" | "title" | "waitForFunction" | "$" | "$$eval"
>;

class Blocked extends Error {}
/** Page loaded but did not look like a noon results page (selector drift / interstitial). */
class Drift extends Error {}
/** A queued job found the block back-off active; it made no load. */
class BlockedRecently extends Error {}
/** The caller went away while this load waited for the browser. */
class Aborted extends Error {}

const CARD_SEL = '[data-qa="plp-product-box"]';
const CHALLENGE_SEL = 'iframe[src*="captcha"], #sec-if-cpt-container, [id*="captcha"]';

function checkStatus(status: number, what: string) {
  if (status === 403 || status === 429) throw new Blocked(`${what}: HTTP ${status}`);
}

/** First use per page: visit the home page so Akamai's sensor sets cookies. */
async function warmUp(page: NoonPage) {
  const resp = await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded", timeout: LOAD_TIMEOUT_MS });
  checkStatus(resp?.status() ?? 0, "home");
  // The first response may be a small interstitial that reloads itself.
  await page.waitForLoadState("load", { timeout: LOAD_TIMEOUT_MS }).catch(() => {});
  await page.waitForTimeout(4_000);
  if (/access denied/i.test(await page.title())) throw new Blocked("home: Access Denied");
}

/** Load one search URL on `page` and extract its cards. Throws on block/navigation errors. */
async function loadSearch(page: NoonPage, url: string): Promise<RawNoonItem[]> {
  const resp = await page.goto(url, { waitUntil: "domcontentloaded", timeout: LOAD_TIMEOUT_MS });
  checkStatus(resp?.status() ?? 0, "search");
  let outcome: unknown = "timeout";
  try {
    const h = await page.waitForFunction(
      (sel: string) =>
        document.querySelector(sel) ? "ok" : /access denied/i.test(document.title) ? "denied" : false,
      CARD_SEL,
      { timeout: LOAD_TIMEOUT_MS },
    );
    outcome = await h.jsonValue();
  } catch {
    // no cards and no denial within the timeout
  }
  if (outcome === "denied") throw new Blocked("search: Access Denied");
  if (outcome !== "ok") {
    if (await page.$(CHALLENGE_SEL)) throw new Blocked("challenge shown");
    // No verified "no results" marker exists (spike), so missing cards means the page or the
    // selectors changed (or an interstitial never resolved): report breakage, not an empty list.
    throw new Drift("no product cards");
  }
  // Playwright $$eval: runs the extractor inside the page on the matched cards (no string eval).
  // Keep the callback free of named inner functions: some TS transpilers (esbuild keepNames)
  // wrap them in a `__name` helper that does not exist inside the page.
  const cards: NoonCard[] = await page.$$eval(CARD_SEL, (boxes) =>
    boxes.map((box) => {
      const a = box.querySelector("a[href]");
      const nameEl = box.querySelector('[data-qa="plp-product-box-name"]');
      const priceBox = box.querySelector('[data-qa="plp-product-box-price"]');
      const img = box.querySelector('img[class*="productImage"]');
      return {
        href: a ? a.getAttribute("href") : null,
        title: nameEl ? nameEl.getAttribute("title") || nameEl.textContent?.trim() || null : null,
        price: priceBox?.querySelector('[class*="sellingPrice"] [class*="amount"]')?.textContent?.trim() || null,
        origPrice: priceBox?.querySelector('[class*="oldPrice"]')?.textContent?.trim() || null,
        rating: box.querySelector('[class*="textCtr"]')?.textContent?.trim() || null,
        reviews: box.querySelector('[class*="countCtr"] span')?.textContent?.trim() || null,
        image: img ? img.getAttribute("src") : null,
      };
    }),
  );
  const items = toRawItems(cards);
  if (!items.some((i) => i.price !== null)) throw new Drift("product cards without prices");
  return items;
}

type WithPage = <T>(fn: (page: NoonPage) => Promise<T>) => Promise<T>;

/**
 * Build a runCall over a page provider. Loads are serialized by the provider and spaced
 * at least `minGapMs` apart (warm-up included). Ok results are cached for 10 min (keyed q|page).
 * After any block, every call fails fast for 10 min without loading a page. Never throws.
 */
export function createRunCall(deps: {
  withPage: WithPage;
  minGapMs?: number;
  cache?: TtlCache<AaResult>;
}) {
  const minGap = deps.minGapMs ?? MIN_GAP_MS;
  const cache = deps.cache ?? new TtlCache<AaResult>(CACHE_TTL_MS);
  const warmed = new WeakSet<object>();
  let lastLoad = 0;
  let blockedUntil = 0;
  const recentlyBlocked = () => Date.now() < blockedUntil;
  const BLOCKED_RECENTLY: AaResult = { ok: false, class: "blocked", reason: "noon blocked recently" };

  async function gap() {
    const wait = lastLoad + minGap - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    lastLoad = Date.now();
  }

  async function runCall(call: { op: string; args: Record<string, string> }, opts: { signal?: AbortSignal } = {}): Promise<AaResult> {
    const q = sanitizeQ(call.args?.q ?? "");
    const pageNo = call.args?.page ?? "1";
    if (call.op !== "search" || !q || !/^[1-9]\d?$/.test(pageNo)) {
      return { ok: false, class: "error", reason: "invalid noon search call" };
    }
    const key = `${q}|${pageNo}`;
    const hit = cache.get(key);
    if (hit) return hit;
    if (recentlyBlocked()) return BLOCKED_RECENTLY;
    const url = `${BASE}/search/?q=${encodeURIComponent(q)}&page=${pageNo}`;
    try {
      const items = await deps.withPage(async (page) => {
        // Re-check inside the queue: a call queued behind a blocked one must not load, and a call
        // whose search was cancelled while it waited does not load at all.
        if (opts.signal?.aborted) throw new Aborted();
        if (recentlyBlocked()) throw new BlockedRecently();
        if (!warmed.has(page)) {
          await gap();
          await warmUp(page);
          warmed.add(page);
        }
        await gap();
        return loadSearch(page, url);
      });
      const ok: AaResult = { ok: true, tier: 3, data: items };
      cache.set(key, ok);
      return ok;
    } catch (e) {
      if (e instanceof BlockedRecently) return BLOCKED_RECENTLY;
      if (e instanceof Aborted) return { ok: false, class: ABORTED, reason: "the search was cancelled" };
      const reason = e instanceof Error ? e.message : String(e);
      if (e instanceof Blocked) {
        blockedUntil = Date.now() + BLOCK_BACKOFF_MS;
        return { ok: false, class: "blocked", reason };
      }
      return { ok: false, class: e instanceof Drift ? "drift" : "error", reason };
    }
  }
  /** When the current block ends (ms), or undefined when noon is not blocked. */
  const blockedEndsAt = (): number | undefined => (recentlyBlocked() ? blockedUntil : undefined);
  return Object.assign(runCall, { blockedEndsAt });
}

/** Adapter entry point: drives the shared real-Chrome page (server-only). */
export const runCall = createRunCall({ withPage: withNoonPage });
