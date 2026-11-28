import { conflicts, sameProduct, titleFeatures } from "@/src/lib/match/group";
import { storeLink } from "@/src/lib/store-hosts";
import { isDeniedMerchant, isKsaUrl, merchantDomain, safeOfferLink } from "./links";

/**
 * Google Shopping KSA as an independent check of our deal badges (owner request; spec decision
 * "Google Shopping KSA validator"). Pure and rule-based, no AI: other Saudi stores' current offers
 * for the same product say whether our price is really the lowest and whether a "was" price was
 * ever charged elsewhere. Client-safe.
 */

/** One offer as captured from Google Shopping, before any filtering. */
export type GshopOffer = {
  /** The merchant's name as Google shows it ("Amazon.sa", "Abdulwahed"). */
  store: string;
  title: string;
  /** The price Google shows, in `currency`. */
  price: number;
  currency: string;
  /** Google showed a foreign price next to it: a cross-border seller, converted to SAR. */
  foreign: boolean;
  was: number | null;
  /** The merchant link as captured (not yet validated), or null. */
  url: string | null;
  /** The merchant's own site when Google shows it without an offer link (the panel's favicon URL). */
  site?: string | null;
  /** Pre-owned or refurbished. */
  used?: boolean;
  /** Delivery cost when the source states it (SerpApi shipping_extracted). */
  shipping?: number;
  /** grid: the results page (no link, Google's own domestic/foreign label); panel: the product panel; serpapi: the API. */
  from: "grid" | "panel" | "serpapi";
};

/** A kept offer, ready to show: `url` is set only when it passed safeOfferLink. */
export type EvidenceOffer = { store: string; domain: string | null; price: number; was: number | null; url: string | null };

export type Verdict = "confirmed" | "not-unique" | "fake-was" | "no-data";
export type NoDataReason = "few" | "no-match" | "budget" | "blocked" | "error" | "off";
export type GshopSource = "serpapi" | "google";

export type GshopResult = {
  verdict: Verdict;
  label: string;
  /** Set on "no-data". */
  reason?: NoDataReason;
  /** Where the offers came from; null when nothing was fetched. */
  source: GshopSource | null;
  checkedAt: number;
  /** Other Saudi stores' offers of the same product, cheapest first. */
  others: EvidenceOffer[];
  lowest: EvidenceOffer | null;
};

/** The rule constants (tests pin them). */
export const THRESHOLDS = {
  /** Confirmed deal: our price is at most this share of the lowest other Saudi price (2% under or more). */
  CONFIRMED_MARGIN: 0.98,
  /** Not unique: our price is over this share of the lowest other Saudi price. */
  NOT_UNIQUE: 0.98,
  /** Fake was-price: the was-price is over this multiple of the highest other current Saudi price. */
  FAKE_WAS: 1.05,
  MIN_CONFIRMED: 2,
  MIN_NOT_UNIQUE: 1,
  MIN_FAKE_WAS: 3,
  /** Another store's was-price within this share of ours makes ours real. */
  SAME_WAS: 0.01,
} as const;

export const VERDICT_LABELS: Record<Verdict, string> = {
  confirmed: "Checked: confirmed lowest",
  "not-unique": "Others match this price",
  "fake-was": "Was-price not seen elsewhere",
  "no-data": "Not enough data",
};

export const SOURCE_LABELS: Record<GshopSource, string> = {
  serpapi: "Google Shopping via SerpApi",
  google: "Google Shopping (google.com.sa)",
};

/**
 * Merchants that sell only in Saudi Arabia, known by name (Google's "source"), lower case. Chains
 * that also sell in other countries (noon, Carrefour, LuLu, Sharaf DG, Jarir, eXtra, Virgin
 * Megastore, Amazon) are not here: by name alone they count only with a Saudi marker.
 */
const KSA_ONLY_NAMES = new Set(["abdulwahed", "saeel", "danube", "mazeed", "almanea", "saco", "panda", "bindawood"]);
/** A Saudi marker in a store name: ".sa", "KSA", "Saudi" or "السعودية". */
const KSA_MARKER = /\.sa$|\bksa\b|\bsaudi\b|السعودية/;

/** Our own stores as Google names them: their offers are not "other stores". */
const OUR_NAMES: Record<string, RegExp> = {
  "amazon-sa": /^amazon(?:\.sa)?$/,
  "noon-sa": /^noon(?:\.com)?$/,
  jarir: /^jarir(?: bookstore)?$/,
  "extra-sa": /^extra(?:\.com)?$/,
  "carrefour-sa": /^carrefour(?: ksa)?$/,
  "saco-sa": /^saco$/,
  "shein-sa": /^shein$/,
  "trendyol-sa": /^trendyol$/,
  aliexpress: /^aliexpress$/,
};

const nameKey = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");
const valid = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n) && n > 0;

function isOurStore(site: string, o: GshopOffer): boolean {
  if (o.url && storeLink(site, o.url)) return true;
  const re = Object.hasOwn(OUR_NAMES, site) ? OUR_NAMES[site] : null;
  return !!re && re.test(nameKey(o.store));
}

/**
 * A Saudi offer: SAR, not cross-border, not denied, new. With a link (or the merchant's site) the
 * host decides: a .sa host or a known Saudi store host (noon only on /saudi-), whatever the name.
 * With no link (the Google grid) the name must be a Saudi-only store or carry a Saudi marker.
 */
function isKsaOffer(o: GshopOffer): boolean {
  if (o.currency !== "SAR" || o.foreign || o.used || !valid(o.price) || isDeniedMerchant(o.store)) return false;
  const where = merchantDomain(o.url) ? o.url : merchantDomain(o.site) ? o.site : null;
  if (where) return isKsaUrl(where);
  const name = nameKey(o.store);
  return KSA_ONLY_NAMES.has(name) || KSA_MARKER.test(name);
}

/** Other Saudi stores' offers of our product: one per store (its lowest), cheapest first. */
export function keepOffers(our: { site: string; title: string }, offers: GshopOffer[]): EvidenceOffer[] {
  const ours = titleFeatures(our.title);
  const best = new Map<string, EvidenceOffer>();
  for (const o of offers) {
    if (!isKsaOffer(o) || isOurStore(our.site, o)) continue;
    // A grid card is its own listing: it must be the same product. An API or panel offer is a store
    // inside Google's product cluster, already matched to ours: it only must not conflict (a bundle,
    // a pack, another model). Its title is often short or in Arabic.
    const f = titleFeatures(o.title);
    if (o.from === "grid" ? !sameProduct(ours, f) : conflicts(ours, f)) continue;
    const k = nameKey(o.store);
    const prev = best.get(k);
    if (prev && prev.price <= o.price) continue;
    best.set(k, { store: o.store.trim(), domain: merchantDomain(o.url) ?? merchantDomain(o.site), price: o.price, was: valid(o.was) ? o.was : null, url: safeOfferLink(o.url) });
  }
  return [...best.values()].sort((a, b) => a.price - b.price || a.store.localeCompare(b.store));
}

/** The verdict for our price against the other Saudi offers (see THRESHOLDS). */
export function verdictFor(our: { price: number; origPrice: number | null }, others: EvidenceOffer[]): { verdict: Verdict; reason?: NoDataReason } {
  const T = THRESHOLDS;
  const n = others.length;
  if (!n) return { verdict: "no-data", reason: "few" };
  const prices = others.map((o) => o.price);
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const w = our.origPrice;
  if (valid(w) && w > our.price && n >= T.MIN_FAKE_WAS && w > T.FAKE_WAS * max) {
    const seenElsewhere = others.some((o) => o.was !== null && Math.abs(o.was - w) <= T.SAME_WAS * w);
    if (!seenElsewhere) return { verdict: "fake-was" };
  }
  if (n >= T.MIN_CONFIRMED && our.price <= T.CONFIRMED_MARGIN * min) return { verdict: "confirmed" };
  if (n >= T.MIN_NOT_UNIQUE && our.price > T.NOT_UNIQUE * min) return { verdict: "not-unique" };
  return { verdict: "no-data", reason: "few" };
}

/** A "no data" result (nothing fetched, or nothing usable). */
export function noData(reason: NoDataReason, checkedAt: number, source: GshopSource | null = null): GshopResult {
  return { verdict: "no-data", label: VERDICT_LABELS["no-data"], reason, source, checkedAt, others: [], lowest: null };
}

/** The full result for our product from the captured offers. */
export function validateOffers(
  our: { site: string; title: string; price: number; origPrice: number | null },
  offers: GshopOffer[],
  meta: { checkedAt: number; source: GshopSource },
): GshopResult {
  const others = keepOffers(our, offers);
  const v = verdictFor(our, others);
  return {
    verdict: v.verdict,
    label: VERDICT_LABELS[v.verdict],
    ...(v.reason && { reason: v.reason }),
    source: meta.source,
    checkedAt: meta.checkedAt,
    others,
    lowest: others[0] ?? null,
  };
}
