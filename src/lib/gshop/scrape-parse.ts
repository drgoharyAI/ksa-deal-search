import { sameProduct, titleFeatures } from "@/src/lib/match/group";
import { decodeGoogleHref } from "./links";
import type { GshopOffer } from "./validate";

/**
 * Pure parsing of google.com.sa Shopping pages (udm=28), for the Chrome fallback (scrape.ts).
 * See the spike: each organic card carries one aria-label "TITLE. [SALE.] Current price: SAR N.
 * [Was SAR N.] [Foreign price: CUR N]STORE[ & more][. N-day returns]. [Rated ...] Go to product
 * viewer for this item." and data-cid / data-gid / data-oid ids. The page has no merchant links:
 * those come from the product panel (panelOffers). String scanning only, no regex backtracking.
 */

const LABEL_END = "Go to product viewer for this item.";
const CURRENT = "Current price: ";

/** The fixed search URL: google.com.sa Shopping, English, Saudi Arabia. */
export function googleSearchUrl(q: string): string {
  return `https://www.google.com.sa/search?${new URLSearchParams({ udm: "28", hl: "en", gl: "sa", q }).toString()}`;
}

/** Bidi controls Google puts around Arabic names. */
const BIDI = new RegExp("[\u200e\u200f\u202a-\u202e\u2066-\u2069]", "g");

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

/** Decodes the HTML entities of an attribute value. */
function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]{1,6}|#\d{1,7}|[a-z]{2,8});/gi, (m, e: string) => {
    if (e[0] === "#") {
      const n = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : m;
    }
    return Object.hasOwn(ENTITIES, e.toLowerCase()) ? ENTITIES[e.toLowerCase()] : m;
  });
}

const clean = (s: string) => s.replace(BIDI, "").replace(/ /g, " ");

/** "349.00" / "1,686.00" -> number, or null. */
function amount(s: string): number | null {
  const n = Number(s.replace(/,/g, ""));
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** Reads "SAR 349.00. " at the start of `s`: the amount and the rest. */
function readSar(s: string): { value: number; rest: string } | null {
  const m = /^SAR ?([\d,]{1,12}(?:\.\d{1,2})?)\.? ?/.exec(s);
  const value = m ? amount(m[1]) : null;
  return m && value !== null ? { value, rest: s.slice(m[0].length) } : null;
}

export type CardLabel = { title: string; price: number; was: number | null; foreign: string | null; store: string; more: boolean; used: boolean };

/** One card's main aria-label (already entity-decoded), or null when it is not one. */
export function parseCardLabel(label: string): CardLabel | null {
  const s = clean(label).trim();
  if (!s.endsWith(LABEL_END)) return null;
  const at = s.indexOf(CURRENT);
  if (at < 0) return null;
  let title = s.slice(0, at).trim();
  // Google's tag before the price ("SALE.", "PRICE DROP."): an upper-case last sentence.
  const tag = /\. {1,3}[A-Z][A-Z ]{1,20}\.$/.exec(title);
  if (tag) title = title.slice(0, tag.index + 1).trim();
  if (title.endsWith(".")) title = title.slice(0, -1).trim();
  const cur = readSar(s.slice(at + CURRENT.length));
  if (!cur) return null;
  let rest = cur.rest.trimStart();
  let was: number | null = null;
  if (rest.startsWith("Was ")) {
    const w = readSar(rest.slice(4));
    if (w) {
      was = w.value;
      rest = w.rest.trimStart();
    }
  }
  let foreign: string | null = null;
  if (rest.startsWith("Foreign price: ")) {
    const m = /^(?:[A-Z]{3} |[€$£])[\d,]{1,12}(?:\.\d{1,2})?/.exec(rest.slice(15));
    if (m) {
      foreign = m[0];
      rest = rest.slice(15 + m[0].length);
    }
  }
  // The store runs up to the rating, or up to the end label.
  const rated = rest.indexOf(". Rated ");
  let store = (rated >= 0 ? rest.slice(0, rated) : rest.slice(0, rest.length - LABEL_END.length)).trim();
  if (store.endsWith(".")) store = store.slice(0, -1).trim();
  const returns = /\. \d{1,3}-day returns$/.exec(store);
  if (returns) store = store.slice(0, returns.index).trim();
  const more = store.endsWith(" & more");
  if (more) store = store.slice(0, -7).trim();
  const used = /^(?:Pre-owned|Used|Refurbished)\./i.test(store);
  if (used) store = store.slice(store.indexOf(".") + 1).trim();
  if (!title || !store) return null;
  return { title, price: cur.value, was, foreign, store, more, used };
}

export type Card = CardLabel & { index: number; cid: string | null; gid: string | null; oid: string | null };

function lastAttr(segment: string, name: string): string | null {
  const key = `${name}="`;
  const i = segment.lastIndexOf(key);
  if (i < 0) return null;
  const end = segment.indexOf('"', i + key.length);
  const v = end < 0 ? "" : segment.slice(i + key.length, end);
  return /^\d{1,30}$/.test(v) ? v : null;
}

/**
 * Every product card of a results page, in page order (`index` is the n-th "Go to product viewer"
 * label, for clicking it). Ids come from the attributes between the previous card's label and this one.
 */
export function parseResultsHtml(html: string): Card[] {
  const cards: Card[] = [];
  let prevEnd = 0;
  let from = 0;
  let n = 0;
  for (;;) {
    const end = html.indexOf(`${LABEL_END}"`, from);
    if (end < 0) break;
    const start = html.lastIndexOf('aria-label="', end);
    from = end + LABEL_END.length;
    if (start < 0 || start < prevEnd) continue;
    const label = parseCardLabel(decodeEntities(html.slice(start + 12, end + LABEL_END.length)));
    const seg = html.slice(prevEnd, start);
    prevEnd = from;
    const index = n++;
    if (label) cards.push({ ...label, index, cid: lastAttr(seg, "data-cid"), gid: lastAttr(seg, "data-gid"), oid: lastAttr(seg, "data-oid") });
  }
  return cards;
}

/** The grid cards as offers (no links). */
export function cardOffers(cards: Card[]): GshopOffer[] {
  return cards.map((c) => ({
    store: c.store,
    title: c.title,
    price: c.price,
    currency: "SAR",
    foreign: c.foreign !== null,
    was: c.was,
    url: null,
    ...(c.used && { used: true }),
    from: "grid" as const,
  }));
}

/**
 * The card whose product panel to open: a domestic, new card of the same product, preferring a
 * cluster with more stores ("& more"), then page order.
 */
export function bestCard(cards: Card[], title: string): Card | null {
  const ours = titleFeatures(title);
  const same = cards.filter((c) => c.foreign === null && !c.used && sameProduct(ours, titleFeatures(c.title)));
  return same.find((c) => c.more) ?? same[0] ?? null;
}

export type BlockReason = "captcha" | "consent" | "empty";

/** A Google URL that is a CAPTCHA (/sorry/) or consent page, or null. Garbage counts as empty. */
export function blockedUrl(url: string): BlockReason | null {
  try {
    const u = new URL(url);
    if (u.pathname.startsWith("/sorry/")) return "captcha";
    return u.hostname.toLowerCase().startsWith("consent.") ? "consent" : null;
  } catch {
    return "empty";
  }
}

/** Why a loaded page is not a results page, or null when it is one (or a genuine "no results"). */
export function detectBlock(page: { url: string; html: string }): BlockReason | null {
  const byUrl = blockedUrl(page.url);
  if (byUrl) return byUrl;
  const h = page.html;
  if (/unusual traffic|g-recaptcha|recaptcha\/api/i.test(h)) return "captcha";
  if (h.includes("Before you continue to Google") || h.includes("consent.google.com")) return "consent";
  if (h.includes(LABEL_END)) return null;
  if (/did not match any/i.test(h)) return null;
  return "empty";
}

/**
 * One store row of the opened product panel: Google's store name (data-report-feedback-about-
 * context), the row's link (an opaque /goto redirect on the live page), the merchant's site from
 * its favicon URL, and the row's text lines.
 */
export type PanelRow = { store: string; href: string; site: string | null; lines: string[] };

const STORE_ATTR = 'data-report-feedback-about-context="';

function attrIn(tag: string, name: string): string | null {
  const key = ` ${name}="`;
  const i = tag.indexOf(key);
  if (i < 0) return null;
  const end = tag.indexOf('"', i + key.length);
  return end < 0 ? null : decodeEntities(tag.slice(i + key.length, end));
}

/** The text lines of an HTML fragment: each tag is a line break. */
function textLines(fragment: string): string[] {
  return decodeEntities(fragment.replace(/<[^>]{0,2000}>/g, "\n"))
    .split("\n")
    .map((x) => clean(x).trim())
    .filter(Boolean);
}

/** The store rows of a page with the product panel open (sponsored units have no store attribute). */
export function parsePanelHtml(html: string): PanelRow[] {
  const rows: PanelRow[] = [];
  let from = 0;
  while (rows.length < 40) {
    const at = html.indexOf(STORE_ATTR, from);
    if (at < 0) break;
    from = at + STORE_ATTR.length;
    const a = html.lastIndexOf("<a ", at);
    const end = html.indexOf("</a>", at);
    if (a < 0 || end < 0) continue;
    const openEnd = html.indexOf(">", a);
    const href = attrIn(html.slice(a, openEnd + 1), "href") ?? "";
    const store = decodeEntities(html.slice(from, html.indexOf('"', from))).trim();
    const fav = /faviconV2\?url=(https?:\/\/[^&"]{1,200})/.exec(html.slice(a, at));
    const lines = textLines(html.slice(openEnd + 1, end));
    if (store) rows.push({ store, href, site: fav ? decodeEntities(fav[1]) : null, lines });
  }
  return rows;
}

const NOT_TITLE = /^(?:sale|in stock|out of stock|free|·|\d{1,3}-day returns|free delivery|delivery|best price)/i;

/**
 * Panel rows as offers. The live rows link through an opaque /goto redirect, so `url` is set only
 * for a decodable /url?q= link (ad clicks give null); `site` keeps the merchant's own site for the
 * Saudi-store check and the domain shown. A "(AED 399.00)" line is Google's foreign price.
 */
export function panelOffers(rows: PanelRow[], productTitle: string): GshopOffer[] {
  const out: GshopOffer[] = [];
  for (const r of rows) {
    const prices = r.lines.flatMap((x) => {
      const v = readSar(x.startsWith("Was ") ? x.slice(4) : x);
      return v ? [v.value] : [];
    });
    if (!prices.length) continue;
    const price = prices[0];
    const was = prices.slice(1).find((p) => p > price) ?? null;
    const foreign = r.lines.some((x) => /^\((?:[A-Z]{3} |[€$£])[\d,]{1,12}(?:\.\d{1,2})?\)$/.test(x));
    const title =
      r.lines.find((x) => x !== r.store && !readSar(x) && !x.startsWith("Was ") && !x.startsWith("(") && !NOT_TITLE.test(x) && x.split(" ").length >= 2) ?? productTitle;
    out.push({ store: r.store, title, price, currency: "SAR", foreign, was, url: decodeGoogleHref(r.href), site: r.site, from: "panel" });
  }
  return out;
}
