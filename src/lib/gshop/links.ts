/**
 * Google Shopping KSA evidence: which merchant links may be shown, and which merchants count as
 * Saudi. Client-safe and pure.
 *
 * The store-host allowlist (src/lib/store-hosts.ts) covers our nine stores only. Google lists many
 * more Saudi merchants, so an evidence link is validated by shape instead: https, the default port,
 * no credentials, no punycode label, and a hostname that is a .sa domain or ends with a known Saudi
 * merchant's domain (a dot-suffix match, never a substring). Anything else is shown as the store's
 * name and price in plain text, with no link.
 */

/** Known Saudi merchants outside the .sa TLD (exact host or any subdomain of it). */
const KSA_MERCHANT_DOMAINS = ["amazon.sa", "noon.com", "jarir.com", "extra.com", "carrefourksa.com", "abdulwahed.com", "almanea.sa"] as const;

/** Foreign marketplaces: never Saudi offers, whatever their price says. */
const DENIED_DOMAINS = ["ebay.com", "aliexpress.com", "aliexpress.us", "alibaba.com", "temu.com", "ubuy.com", "amazon.com", "desertcart.ae", "jomla.ae"];
/** Country TLDs of other markets (the last label, or the last two such as co.za). */
const FOREIGN_TLD = /\.(?:ae|za|jo|ng|eg|kw|qa|bh|om|in|pk|uk|au|de|fr|it|es|tr|cn|us|ca)$/;
/** Merchant names (Google's "source") of cross-border sellers. */
const DENIED_NAME_WORDS = ["ebay", "aliexpress", "alibaba", "temu", "ubuy", "catchyjo"];

const MAX_URL = 2000;

function endsWithDomain(host: string, domain: string): boolean {
  return host === domain || host.endsWith(`.${domain}`);
}

/** The host (lower case, no "www.") is a Saudi merchant: .sa, or a known Saudi merchant domain. */
export function isKsaHost(host: string): boolean {
  const h = host.toLowerCase();
  if (DENIED_DOMAINS.some((d) => endsWithDomain(h, d)) || FOREIGN_TLD.test(h)) return false;
  if (h.split(".").some((label) => label.startsWith("xn--"))) return false;
  return h.endsWith(".sa") || KSA_MERCHANT_DOMAINS.some((d) => endsWithDomain(h, d));
}

/** A merchant name or host that is a foreign or cross-border seller. */
export function isDeniedMerchant(name: string): boolean {
  const n = name.trim().toLowerCase();
  if (FOREIGN_TLD.test(n) || DENIED_DOMAINS.some((d) => n === d || n.endsWith(`.${d}`))) return true;
  const words = n.split(/[^a-z0-9.]+/).filter(Boolean);
  return words.some((w) => DENIED_NAME_WORDS.includes(w.split(".")[0]));
}

function parse(url: unknown): URL | null {
  if (typeof url !== "string" || url.length > MAX_URL) return null;
  try {
    return new URL(url);
  } catch {
    return null;
  }
}

/** noon.com serves several countries: only its Saudi storefront counts. */
function rightStorefront(u: URL): boolean {
  if (endsWithDomain(u.hostname, "noon.com")) return u.pathname.toLowerCase().startsWith("/saudi-");
  return true;
}

/** The link when it is safe to draw as a Saudi merchant's page; null otherwise. */
export function safeOfferLink(url: unknown): string | null {
  const u = parse(url);
  if (!u || u.protocol !== "https:" || u.port || u.username || u.password) return null;
  return isKsaHost(u.hostname) && rightStorefront(u) ? u.href : null;
}

/** The merchant's host for display ("amazon.sa"), or null when the URL does not parse. */
export function merchantDomain(url: unknown): string | null {
  const u = parse(url);
  return u && /^https?:$/.test(u.protocol) ? u.hostname.toLowerCase().replace(/^www\./, "") : null;
}

const isGoogleHost = (h: string) => /(?:^|\.)google\.[a-z.]+$/.test(h) || /(?:^|\.)(?:googleadservices|doubleclick|googlesyndication)\.com$/.test(h);

/**
 * The merchant URL behind a link on a Google page: the q or url parameter of a /url redirect, or a
 * direct external link. Ad clicks (/aclk, googleadservices) and other Google pages give null.
 */
export function decodeGoogleHref(href: unknown): string | null {
  if (typeof href !== "string" || href.length > MAX_URL) return null;
  let u: URL;
  try {
    u = new URL(href, "https://www.google.com.sa");
  } catch {
    return null;
  }
  const host = u.hostname.toLowerCase();
  if (isGoogleHost(host)) {
    if (u.pathname !== "/url") return null;
    const target = u.searchParams.get("q") ?? u.searchParams.get("url");
    const t = parse(target);
    return t && /^https?:$/.test(t.protocol) && !isGoogleHost(t.hostname.toLowerCase()) ? t.href : null;
  }
  return /^https?:$/.test(u.protocol) ? u.href : null;
}
