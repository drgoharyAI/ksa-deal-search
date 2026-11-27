import type { NewWatch } from "./repo";
import type { WatchStatus } from "./shared";

/** Input checks for the watches API. Pure; `siteIds` is the server's store registry keys. */
type Ok<T> = { ok: true; value: T };
type Err = { ok: false; error: string };

const MAX_QUERY = 200;
const MAX_TARGET = 10_000_000;

const str = (v: unknown, max: number): string | null => (typeof v === "string" && v.trim() && v.length <= max ? v.trim() : null);

export const validTarget = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v > 0 && v <= MAX_TARGET;

const httpUrl = (v: unknown): string | null => {
  if (typeof v !== "string" || v.length > 2000) return null;
  try {
    const u = new URL(v);
    return u.protocol === "https:" || u.protocol === "http:" ? u.toString() : null;
  } catch {
    return null;
  }
};

export type NewWatchInput = NewWatch & { price?: number };

export function parseNewWatch(body: unknown, siteIds: ReadonlySet<string>): Ok<NewWatchInput> | Err {
  if (!body || typeof body !== "object") return { ok: false, error: "Send a watch as a JSON object" };
  const b = body as Record<string, unknown>;
  const query = str(b.query, MAX_QUERY);
  if (!query) return { ok: false, error: "A watch needs the search it came from" };
  if (!validTarget(b.target)) return { ok: false, error: "Enter a target price above 0" };
  const price = typeof b.price === "number" && Number.isFinite(b.price) && b.price > 0 ? b.price : undefined;
  const currency = typeof b.currency === "string" && /^[A-Z]{3}$/.test(b.currency) ? b.currency : "SAR";

  if (b.kind === "product") {
    const site = typeof b.site === "string" && siteIds.has(b.site) ? b.site : null;
    if (!site) return { ok: false, error: "Unknown store" };
    const productId = str(b.productId, 200);
    if (!productId) return { ok: false, error: "A product watch needs the product id" };
    const url = httpUrl(b.url);
    if (!url) return { ok: false, error: "A product watch needs the product link" };
    const title = str(b.title, 500) ?? productId;
    const image = httpUrl(b.image);
    return { ok: true, value: { kind: "product", site, productId, query, sites: [site], target: b.target, title, url, image, currency, price } };
  }
  if (b.kind === "search") {
    const sites = Array.isArray(b.sites) ? [...new Set(b.sites.filter((s): s is string => typeof s === "string" && siteIds.has(s)))] : [];
    if (!sites.length) return { ok: false, error: "Pick at least one store" };
    return { ok: true, value: { kind: "search", site: null, productId: null, query, sites, target: b.target, title: null, url: null, image: null, currency, price } };
  }
  return { ok: false, error: "A watch is a product or a search" };
}

export type WatchUpdate = { id: number; target?: number; status?: WatchStatus };

export function parseWatchUpdate(body: unknown): Ok<WatchUpdate> | Err {
  if (!body || typeof body !== "object") return { ok: false, error: "Send the change as a JSON object" };
  const b = body as Record<string, unknown>;
  const id = parseId(b.id);
  if (id === null) return { ok: false, error: "Unknown watch" };
  const out: WatchUpdate = { id };
  if (b.target !== undefined) {
    if (!validTarget(b.target)) return { ok: false, error: "Enter a target price above 0" };
    out.target = b.target;
  }
  if (b.status !== undefined) {
    if (b.status !== "active" && b.status !== "paused") return { ok: false, error: "Status is active or paused" };
    out.status = b.status;
  }
  if (out.target === undefined && out.status === undefined) return { ok: false, error: "Nothing to change" };
  return { ok: true, value: out };
}

/** A positive integer id from a number or a decimal string, else null. */
export function parseId(v: unknown): number | null {
  const n = typeof v === "number" ? v : typeof v === "string" && /^\d{1,15}$/.test(v) ? Number(v) : NaN;
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}
