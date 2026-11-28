/**
 * Kanbkam price history (spec decision "Kanbkam price history"): which listings may be looked up,
 * and the only URLs ever fetched or linked. Client-safe and pure.
 *
 * Only Amazon.sa (ASIN) and noon (SKU) listings, each by its direct product page
 * https://www.kanbkam.com/sa/en/p-<id> on a fixed host. An id is checked against its store's exact
 * shape before it is put in a URL, so no request can reach another host or another path.
 */

const HOST = "www.kanbkam.com";
const LINK_HOSTS = new Set(["www.kanbkam.com", "kanbkam.com"]);

/** ASIN: 10 upper-case letters or digits. noon SKU (eval/recorded/noon-sa): N + 8 digits + a letter, or Z + 20 hex + Z. */
const ID_SHAPES: Record<string, RegExp> = {
  "amazon-sa": /^[A-Z0-9]{10}$/,
  "noon-sa": /^(?:N\d{8}[A-Z]|Z[0-9A-F]{20}Z)$/,
};

/** The store Kanbkam names on the listing's buy button (data-gtmid "product-buy|<store>|sa|en"). */
export const KANBKAM_STORE: Record<string, string> = { "amazon-sa": "amazon", "noon-sa": "noon" };

export const kanbkamSupported = (site: string): boolean => Object.hasOwn(ID_SHAPES, site);

export function validKanbkamId(site: string, id: string): boolean {
  if (typeof id !== "string" || !kanbkamSupported(site)) return false;
  return ID_SHAPES[site].test(id);
}

/** The product page to fetch, or null when the site or id is not allowed. */
export function kanbkamProductUrl(site: string, id: string): string | null {
  return validKanbkamId(site, id) ? `https://${HOST}/sa/en/p-${id}` : null;
}

/** A link to show: https, Kanbkam's host, the default port, no credentials, a p-<id> product path. */
export function safeKanbkamLink(url: unknown): string | null {
  if (typeof url !== "string" || url.length > 200) return null;
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  if (u.protocol !== "https:" || !LINK_HOSTS.has(u.hostname) || u.port || u.username || u.password || u.search || u.hash) return null;
  if (!/^\/sa\/en\/p-[A-Z0-9]{10,22}$/.test(u.pathname)) return null;
  return u.toString();
}
