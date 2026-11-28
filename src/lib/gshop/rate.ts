import "server-only";

/**
 * Per-client cap on Google Shopping KSA checks (owner ruling: small safety caps). In memory, with
 * a bounded map: a restart clears it, and the persisted global caps (service.ts) still hold.
 */

type Env = Record<string, string | undefined>;

const HOUR = 3_600_000;
const MAX_KEYS = 2_000;

const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

/** A LAN or local name: loopback, a private IPv4 address, or a single-label / .lan / .local name. */
function isLocalHost(hostname: string): boolean {
  const h = hostname.toLowerCase();
  if (LOOPBACK.has(h) || !h.includes(".") || h.endsWith(".lan") || h.endsWith(".local") || h.endsWith(".home.arpa")) return true;
  const m = /^(\d{1,3})\.(\d{1,3})\.\d{1,3}\.\d{1,3}$/.exec(h);
  if (!m) return false;
  const a = Number(m[1]);
  const b = Number(m[2]);
  return a === 10 || a === 127 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254);
}

function hostnameOf(host: string): string {
  try {
    return new URL(`http://${host}`).hostname;
  } catch {
    return "";
  }
}

/**
 * Who is asking, for the per-client cap. Through the Cloudflare tunnel (a Host listed in APP_HOSTS
 * that is not loopback or LAN) it is CF-Connecting-IP, which Cloudflare sets and a client cannot
 * forge. Otherwise it is "local": App Router handlers do not see the socket address, and
 * X-Forwarded-For (or a CF header) sent by a LAN client is never trusted, so every LAN and
 * loopback client shares one bucket. The global caps in service.ts bound everything anyway.
 */
export function clientKeyOf(req: Request, env: Env = process.env): string {
  const host = (req.headers.get("host") ?? new URL(req.url).host).toLowerCase();
  const listed = new Set(
    (env.APP_HOSTS ?? "")
      .split(",")
      .map((h) => h.trim().toLowerCase())
      .filter(Boolean),
  );
  const name = hostnameOf(host);
  if (!listed.has(host) || !name || isLocalHost(name)) return "local";
  const ip = (req.headers.get("cf-connecting-ip") ?? "").trim();
  return /^[0-9a-f.:]{3,45}$/i.test(ip) ? `cf:${ip.toLowerCase()}` : "tunnel:unknown";
}

export type ClientLimiter = { allowed(key: string, now: number): boolean; record(key: string, now: number): void; clear(): void };

/** At most `max` checks per key per hour; the map never holds more than MAX_KEYS keys. */
export function clientLimiter(max: number): ClientLimiter {
  const hits = new Map<string, number[]>();
  const recent = (key: string, now: number) => (hits.get(key) ?? []).filter((t) => now - t < HOUR && t <= now);
  return {
    allowed: (key, now) => recent(key, now).length < max,
    record(key, now) {
      const list = [...recent(key, now), now];
      hits.delete(key);
      hits.set(key, list);
      while (hits.size > MAX_KEYS) {
        const oldest = hits.keys().next().value;
        if (oldest === undefined) break;
        hits.delete(oldest);
      }
    },
    clear: () => hits.clear(),
  };
}
