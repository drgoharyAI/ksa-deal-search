import type { AaResult } from "@/src/lib/aa";
import type { ParsedQuery, Product } from "@/src/lib/types";
import type { Page } from "playwright-core";
import fs from "node:fs";
import path from "node:path";
import { TtlCache } from "@/src/lib/cache";
import { withSheinPage } from "./browser";
import { resolveSheinProfileDir } from "./profile";

/**
 * SHEIN KSA (ar.shein.com, SAR) via the owner's real Chrome on its own profile (see ./browser.ts).
 * Page 1 data comes from the page's own signed XHR `bff-api/product/get_products_by_keywords`
 * (we only read its response); `window.gbRawData` is the fallback. The storefront is Arabic only,
 * so the English title is the product's URL slug (`goods_url_name`).
 * Mapping and limits: docs/superpowers/spikes/2026-11-27-shein-sa.md.
 *
 * Call budget: SHEIN's risk control redirected to /risk/challenge after about 13 searches in
 * 10 minutes, so each search is ONE page load (main term, page 1, relevance), loads are at least
 * 5 s apart, ok results are cached for 60 min, and a challenge stops all loads for 2 h, doubling
 * per consecutive block up to 12 h (reset by the first ok search). The back-off is kept on
 * globalThis and in <shein-profile>/deal-search-backoff.json, so a dev restart does not lift it.
 * Captchas are never solved.
 */

const ORIGIN = "https://ar.shein.com";
const LOAD_TIMEOUT_MS = 45_000;
const XHR_TIMEOUT_MS = 20_000;
const MIN_GAP_MS = 5_000;
const CACHE_TTL_MS = 60 * 60_000;
const BACKOFF_START_MS = 2 * 3_600_000;
const BACKOFF_CAP_MS = 12 * 3_600_000;
const PRODUCT_PATH_RE = /^\/([^/]+)-p-(\d+)\.html$/;
const CHALLENGE_RE = /\/risk\/challenge|captcha_type=/i;
const XHR_PATH = "/bff-api/product/get_products_by_keywords";

/** Keep letters (any script), digits, spaces, hyphens; collapse spaces. "" if nothing usable. */
export function sanitizeQ(terms: string): string {
  return terms
    .replace(/[^\p{L}\p{N} -]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** One call per search: main term, page 1, relevance (sort is done by the app). */
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- variants intentionally ignored (call budget)
export function searchCalls(pq: ParsedQuery, _variants: string[]) {
  const q = sanitizeQ(pq.terms);
  if (!q) return [];
  return [{ op: "search" as const, args: { q, page: "1", sort: "" } }];
}

const TRAILING_ID_RE = /^(?:\d{5,}|[a-z]{1,3}\d{6,})$/i;

/** "Lenovo-EA166-bluetooth-earbuds-sw2304123456" -> "Lenovo EA166 Bluetooth Earbuds". */
export function humanizeSlug(slug: string): string {
  const words = slug.split("-").filter(Boolean);
  while (words.length > 1 && TRAILING_ID_RE.test(words[words.length - 1])) words.pop();
  return words.map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
}

/** Shape returned by runCall and stored in tests/fixtures/shein-sa-search.json. */
export type RawSheinItem = {
  id: string;
  title: string | null;
  titleAr: string | null;
  price: number | null;
  origPrice: number | null;
  currency: string | null;
  rating: number | null;
  reviews: number | null;
  image: string | null;
  url: string;
};

function num(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v !== "string" || !v) return null;
  const m = v.replace(/,/g, "").match(/\d+(?:\.\d+)?/);
  if (!m) return null;
  const n = parseFloat(m[0]);
  return Number.isFinite(n) ? n : null;
}

const str = (v: unknown): string | null => (typeof v === "string" && v ? v : typeof v === "number" ? String(v) : null);

/** Map SHEIN bff product objects (XHR or gbRawData) to raw items; dedupe by goods_id. */
export function toRawItems(products: unknown[]): RawSheinItem[] {
  const out: RawSheinItem[] = [];
  const seen = new Set<string>();
  for (const x of products) {
    if (!x || typeof x !== "object") continue;
    const g = x as Record<string, unknown>;
    const id = str(g.goods_id);
    const slug = str(g.goods_url_name)?.replace(/^-+|-+$/g, "");
    if (!id || !/^\d+$/.test(id) || !slug || seen.has(id)) continue;
    seen.add(id);
    const sale = (g.salePrice ?? {}) as Record<string, unknown>;
    const retail = (g.retailPrice ?? {}) as Record<string, unknown>;
    const price = num(sale.amount);
    const orig = num(retail.amount);
    const img = str(g.goods_img);
    out.push({
      id,
      title: humanizeSlug(slug) || null,
      titleAr: str(g.goods_name),
      price,
      origPrice: orig !== null && price !== null && orig > price ? orig : null,
      currency: /^SR/.test(str(sale.amountWithSymbol) ?? "") ? "SAR" : null,
      rating: num(g.comment_rank_average),
      reviews: num(g.comment_num),
      image: img ? (img.startsWith("//") ? `https:${img}` : img) : null,
      url: `${ORIGIN}/${encodeURI(slug)}-p-${id}.html`,
    });
  }
  return out;
}

/** Absolute ar.shein.com product URL without query/hash, with its slug and id; null otherwise. */
function parseUrl(href: unknown): { url: string; slug: string; id: string } | null {
  if (typeof href !== "string" || !href) return null;
  let u: URL;
  try {
    u = new URL(href, ORIGIN);
  } catch {
    return null;
  }
  if (u.protocol !== "https:" || u.hostname !== "ar.shein.com") return null;
  const m = u.pathname.match(PRODUCT_PATH_RE);
  if (!m) return null;
  let slug = m[1];
  try {
    slug = decodeURIComponent(slug);
  } catch {
    // keep the raw slug
  }
  return { url: `${u.origin}${u.pathname}`, slug, id: m[2] };
}

export function normalizeSearchItem(raw: unknown): Product | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const parsed = parseUrl(r.url);
  if (!parsed) return null;
  const id = str(r.id) ?? parsed.id;
  if (!/^\d+$/.test(id) || id !== parsed.id) return null;
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
    site: "shein-sa",
    id,
    title: humanizeSlug(parsed.slug) || (typeof r.title === "string" ? r.title : ""),
    listPrice: price,
    origPrice,
    discountPct,
    currency: "SAR",
    rating: rating !== null && rating > 0 && rating <= 5 ? rating : null,
    soldCount: 0,
    image,
    url: parsed.url,
    shipping: null,
    finalPrice: price,
    detailStatus: "ok",
  };
}

// ---------------- page driving ----------------

/** The subset of Playwright's Page this adapter uses (lets tests pass a fake). */
export type SheinPage = Pick<
  Page,
  "goto" | "url" | "waitForResponse" | "waitForLoadState" | "waitForTimeout" | "evaluate" | "context"
>;

class Blocked extends Error {}
/** Page loaded but held no product data (page or payload changed). */
class Drift extends Error {}
/** A queued job found the block back-off active; it made no load. */
class BlockedRecently extends Error {}

function checkBlocked(page: SheinPage, status: number, what: string) {
  if (status === 403 || status === 429) throw new Blocked(`${what}: HTTP ${status}`);
  if (CHALLENGE_RE.test(page.url())) throw new Blocked(`${what}: risk challenge`);
}

/** Only for a fresh profile (no SHEIN cookies yet): one home visit so the site sets its cookies. */
async function warmUpIfNeeded(page: SheinPage, gap: () => Promise<void>) {
  const cookies = await page
    .context()
    .cookies(ORIGIN)
    .catch(() => []);
  if (cookies.length) return;
  await gap();
  const resp = await page.goto(`${ORIGIN}/`, { waitUntil: "domcontentloaded", timeout: LOAD_TIMEOUT_MS });
  checkBlocked(page, resp?.status() ?? 0, "home");
  await page.waitForLoadState("load", { timeout: LOAD_TIMEOUT_MS }).catch(() => {});
  await page.waitForTimeout(3_000);
  checkBlocked(page, 200, "home");
}

type BffInfo = { products?: unknown; num?: unknown };

/** Load page 1 of a search on `page` and read its products. Throws on block/navigation errors. */
export async function loadSearch(page: SheinPage, url: string): Promise<RawSheinItem[]> {
  // Listen before navigating: the page's own JS makes the signed XHR right after load.
  const xhr = page
    .waitForResponse((r) => r.url().includes(XHR_PATH) && r.url().includes("page=1&"), { timeout: XHR_TIMEOUT_MS })
    .catch(() => null);
  const resp = await page.goto(url, { waitUntil: "domcontentloaded", timeout: LOAD_TIMEOUT_MS });
  checkBlocked(page, resp?.status() ?? 0, "search");

  let info: BffInfo | null = null;
  const r = await xhr;
  if (r) {
    const body = (await r.json().catch(() => null)) as { code?: unknown; info?: BffInfo } | null;
    if (body && String(body.code) === "0" && body.info) info = body.info;
  }
  checkBlocked(page, 200, "search");
  if (!info) {
    info = (await page
      .evaluate(() => {
        const w = window as unknown as { gbRawData?: { results?: { bffProductsInfo?: unknown } } };
        return w.gbRawData?.results?.bffProductsInfo ?? null;
      })
      .catch(() => null)) as BffInfo | null;
  }
  checkBlocked(page, 200, "search");
  if (!info || !Array.isArray(info.products)) throw new Drift("no product data");
  const items = toRawItems(info.products);
  if (info.products.length && !items.some((i) => i.price !== null)) throw new Drift("products without prices");
  return items;
}

/** Rate-limit and back-off state. Kept on globalThis in the app so HMR never resets a back-off. */
export type SheinState = { blockedUntil: number; strikes: number; lastLoad: number };

/** The persisted part of the back-off. */
export type Backoff = { blockedUntil: number; strikes: number };
export type BackoffStore = { load(): Backoff | null; save(v: Backoff): void };

/** Path of the persisted back-off (resolved on use, never at import). */
export const backoffFile = (): string => path.join(resolveSheinProfileDir(), "deal-search-backoff.json");

const fileStore: BackoffStore = {
  load() {
    try {
      const v = JSON.parse(fs.readFileSync(backoffFile(), "utf8")) as Partial<Backoff>;
      const blockedUntil = Number(v.blockedUntil);
      const strikes = Number(v.strikes);
      return Number.isFinite(blockedUntil) && Number.isInteger(strikes) && strikes >= 0 ? { blockedUntil, strikes } : null;
    } catch {
      return null;
    }
  },
  save(v) {
    try {
      fs.mkdirSync(path.dirname(backoffFile()), { recursive: true });
      fs.writeFileSync(backoffFile(), JSON.stringify(v));
    } catch {
      // best effort: the in-memory back-off still applies
    }
  },
};
const noStore: BackoffStore = { load: () => null, save: () => {} };

const g = globalThis as typeof globalThis & { __sheinSaState?: SheinState; __sheinSaCache?: TtlCache<AaResult> };
export function sheinState(): SheinState {
  const s = (g.__sheinSaState ??= { blockedUntil: 0, strikes: 0, lastLoad: 0 });
  // An object left on globalThis by an older module version (HMR) may lack `strikes`.
  if (!Number.isInteger(s.strikes)) s.strikes = 0;
  return s;
}
/** States that already merged the persisted back-off (once each, on first call). */
const loadedStates = new WeakSet<SheinState>();
const sheinCache = (): TtlCache<AaResult> => (g.__sheinSaCache ??= new TtlCache<AaResult>(CACHE_TTL_MS));

type WithPage = <T>(fn: (page: SheinPage) => Promise<T>) => Promise<T>;

/**
 * Build a runCall over a page provider. Loads are serialized by the provider and spaced at least
 * `minGapMs` apart (warm-up included). Ok results are cached for 60 min (keyed q|page). After a
 * block (challenge, 403/429), every call fails fast without loading: 2 h, doubling per consecutive
 * block, capped at 12 h; the first ok search resets it. Never throws.
 * `persist` defaults to the file in the SHEIN profile when `state` is the global one, else to none.
 */
export function createRunCall(deps: {
  withPage: WithPage;
  minGapMs?: number;
  cache?: TtlCache<AaResult>;
  state?: SheinState;
  persist?: BackoffStore;
}) {
  const minGap = deps.minGapMs ?? MIN_GAP_MS;
  const cache = deps.cache ?? new TtlCache<AaResult>(CACHE_TTL_MS);
  const state = deps.state ?? sheinState();
  const store = deps.persist ?? (deps.state ? noStore : fileStore);
  const save = () => store.save({ blockedUntil: state.blockedUntil, strikes: state.strikes });
  function loadPersisted() {
    if (loadedStates.has(state)) return;
    loadedStates.add(state);
    const v = store.load();
    if (v && v.blockedUntil > state.blockedUntil) {
      state.blockedUntil = v.blockedUntil;
      state.strikes = Math.max(state.strikes, v.strikes);
    }
  }
  const warmed = new WeakSet<object>();
  const recentlyBlocked = () => Date.now() < state.blockedUntil;
  const BLOCKED_RECENTLY: AaResult = { ok: false, class: "blocked", reason: "SHEIN blocked recently" };

  async function gap() {
    const wait = state.lastLoad + minGap - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    state.lastLoad = Date.now();
  }

  return async function runCall(call: { op: string; args: Record<string, string> }): Promise<AaResult> {
    const q = sanitizeQ(call.args?.q ?? "");
    const pageNo = call.args?.page ?? "1";
    if (call.op !== "search" || !q || pageNo !== "1") {
      return { ok: false, class: "error", reason: "invalid SHEIN search call" };
    }
    const key = `${q}|${pageNo}`;
    const hit = cache.get(key);
    if (hit) return hit;
    loadPersisted();
    if (recentlyBlocked()) return BLOCKED_RECENTLY;
    const url = `${ORIGIN}/pdsearch/${encodeURIComponent(q)}/`;
    try {
      const items = await deps.withPage(async (page) => {
        // Re-check inside the queue: a call queued behind a blocked one must not load.
        if (recentlyBlocked()) throw new BlockedRecently();
        if (!warmed.has(page)) {
          await warmUpIfNeeded(page, gap);
          warmed.add(page);
        }
        await gap();
        return loadSearch(page, url);
      });
      const ok: AaResult = { ok: true, tier: 3, data: items };
      cache.set(key, ok);
      if (state.strikes) {
        state.strikes = 0;
        save();
      }
      return ok;
    } catch (e) {
      if (e instanceof BlockedRecently) return BLOCKED_RECENTLY;
      const reason = e instanceof Error ? e.message : String(e);
      if (e instanceof Blocked) {
        state.strikes++;
        state.blockedUntil = Date.now() + Math.min(BACKOFF_START_MS * 2 ** (state.strikes - 1), BACKOFF_CAP_MS);
        save();
        return { ok: false, class: "blocked", reason };
      }
      return { ok: false, class: e instanceof Drift ? "drift" : "error", reason };
    }
  };
}

/** Adapter entry point: drives the shared SHEIN Chrome page (server-only). */
export const runCall = createRunCall({ withPage: withSheinPage, cache: sheinCache() });
