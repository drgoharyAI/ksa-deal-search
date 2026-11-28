import "server-only";
import { fromTunnelRelay } from "@/src/lib/tunnel-relay";

/**
 * Per-client cap on Google Shopping KSA checks (owner ruling: small safety caps). In memory, with
 * a bounded map: a restart clears it, and the persisted global caps (service.ts) still hold.
 */

const HOUR = 3_600_000;
const MAX_KEYS = 2_000;

/**
 * Who is asking, for the per-client caps. A request stamped by the tunnel relay (see
 * tunnel-relay.ts: only the Cloudflare tunnel reaches it) is CF-Connecting-IP, which Cloudflare
 * sets. Everything else is "local": App Router handlers do not see the socket address, and a
 * header sent from the LAN (X-Forwarded-For, CF-Connecting-IP, a tunnel Host) is never trusted,
 * so every LAN and loopback client shares one bucket. The global caps bound everything anyway.
 */
export function clientKeyOf(req: Request): string {
  if (!fromTunnelRelay(req)) return "local";
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
