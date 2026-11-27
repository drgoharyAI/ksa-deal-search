/**
 * Which hosts a store's product links and pictures may point at. Client-safe and pure.
 *
 * The app has no login, so its write APIs (saved products, recently viewed, watches) take any body
 * a local client sends. A stored link is drawn under a store's logo and may reach Telegram, so it
 * must be that store's own page, and a stored picture must come from that store's own image CDN:
 * never a lookalike page or a tracking pixel.
 *
 * Derived from the adapters (src/sites/<store>/search.ts build the links) and the recorded answers
 * (eval/recorded, tests/fixtures) for the image CDNs. A rule is an exact host ("www.noon.com"), or
 * a dot-suffix (".nooncdn.com") that matches any subdomain of it. Never a substring match.
 */

type Rules = { links: readonly string[]; images: readonly string[] };

const HOSTS: Readonly<Record<string, Rules>> = {
  aliexpress: { links: ["www.aliexpress.com", "aliexpress.com"], images: [".aliexpress-media.com", ".alicdn.com"] },
  "amazon-sa": { links: ["www.amazon.sa", "amazon.sa"], images: [".media-amazon.com", ".ssl-images-amazon.com"] },
  jarir: { links: ["www.jarir.com"], images: [".jarir.com", ".mirakl.net"] },
  "noon-sa": { links: ["www.noon.com"], images: [".nooncdn.com"] },
  "trendyol-sa": { links: ["www.trendyol.sa"], images: [".dsmcdn.com"] },
  "extra-sa": { links: ["www.extra.com"], images: ["media.extra.com"] },
  "carrefour-sa": { links: ["www.carrefourksa.com"], images: [".carrefourksa.com"] },
  "saco-sa": { links: ["www.saco.sa"], images: ["img.saco.sa", "img.int-saco.com"] },
  "shein-sa": { links: ["ar.shein.com"], images: [".ltwebstatic.com"] },
};

/** `host` equals an exact rule, or ends with a dot-suffix rule. Lower case, no port. */
export function hostMatches(host: string, rules: readonly string[]): boolean {
  const h = host.toLowerCase();
  return rules.some((r) => (r.startsWith(".") ? h.endsWith(r) && h.length > r.length : h === r));
}

function check(site: string, url: unknown, kind: keyof Rules): string | null {
  const rules = Object.hasOwn(HOSTS, site) ? HOSTS[site][kind] : null;
  if (!rules || typeof url !== "string" || url.length > 2000) return null;
  try {
    const u = new URL(url);
    // https only, the default port, no credentials in the URL.
    if (u.protocol !== "https:" || u.port || u.username || u.password) return null;
    return hostMatches(u.hostname, rules) ? u.href : null;
  } catch {
    return null;
  }
}

/** The link when it is an https page on `site`'s own host; null otherwise. */
export const storeLink = (site: string, url: unknown): string | null => check(site, url, "links");

/** The picture URL when it is https on one of `site`'s image hosts; null otherwise. */
export const storeImage = (site: string, url: unknown): string | null => check(site, url, "images");

/** The stores with rules (for tests: every registered store must have one). */
export const STORE_HOST_SITES = Object.keys(HOSTS);
