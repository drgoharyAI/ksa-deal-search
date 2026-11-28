import { randomBytes, timingSafeEqual } from "node:crypto";
import http from "node:http";

/**
 * Tells tunnel traffic apart from LAN traffic, for the per-client caps.
 *
 * The Cloudflare tunnel reaches the app at app:3000 inside the compose network. That port is this
 * relay: it stamps every request with a secret header and passes it, streaming both ways, to the
 * Next server on 127.0.0.1:<PORT>. The LAN port (192.168.1.48:3000) maps straight to the Next
 * server, so LAN requests never carry the secret, whatever headers a LAN client sends. Only a
 * stamped request may use CF-Connecting-IP as its client identity.
 *
 * The secret is random per process and lives only in memory; it is never logged.
 */

export const TUNNEL_HEADER = "x-tunnel-auth";

type G = typeof globalThis & { __tunnelSecret?: Buffer; __tunnelRelay?: http.Server };
const g = globalThis as G;

/** This process's secret (created on first use). Shared through globalThis with the route bundles. */
function secret(): Buffer {
  return (g.__tunnelSecret ??= randomBytes(32));
}

/** True when the request came through the relay: its header equals the secret (timing-safe). */
export function fromTunnelRelay(req: Request): boolean {
  if (!g.__tunnelSecret) return false;
  const got = req.headers.get(TUNNEL_HEADER);
  if (!got || got.length !== 64) return false;
  const a = Buffer.from(got, "hex");
  return a.length === g.__tunnelSecret.length && timingSafeEqual(a, g.__tunnelSecret);
}

/** Hop-by-hop headers are not forwarded (RFC 9110 7.6.1). */
const HOP = new Set(["connection", "keep-alive", "proxy-connection", "transfer-encoding", "upgrade", "te", "trailer"]);

/**
 * Listens on `listenPort` and relays every request to 127.0.0.1:`targetPort`, adding the secret
 * (any incoming copy is replaced). Bodies are piped, never buffered, so the NDJSON search stream
 * reaches the browser as it is written; a client that goes away aborts the upstream request, so
 * the server sees the disconnect (search slots, store calls).
 */
export function startTunnelRelay(listenPort: number, targetPort: number, host = "0.0.0.0"): http.Server {
  if (g.__tunnelRelay) return g.__tunnelRelay;
  const key = secret().toString("hex");
  const server = http.createServer((req, res) => {
    const headers: http.OutgoingHttpHeaders = {};
    for (const [name, value] of Object.entries(req.headers)) {
      if (value !== undefined && !HOP.has(name) && name !== TUNNEL_HEADER) headers[name] = value;
    }
    headers[TUNNEL_HEADER] = key;
    const up = http.request({ host: "127.0.0.1", port: targetPort, method: req.method, path: req.url, headers }, (upRes) => {
      const out: http.OutgoingHttpHeaders = {};
      for (const [name, value] of Object.entries(upRes.headers)) if (value !== undefined && !HOP.has(name)) out[name] = value;
      res.writeHead(upRes.statusCode ?? 502, out);
      res.flushHeaders();
      upRes.pipe(res);
      upRes.on("error", () => res.destroy());
    });
    up.on("error", () => {
      if (!res.headersSent) res.writeHead(502, { "content-type": "application/json" }).end('{"error":"Unavailable"}');
      else res.destroy();
    });
    // The browser (or Cloudflare) went away: abort the upstream request too.
    res.on("close", () => {
      if (!res.writableFinished) up.destroy();
    });
    req.pipe(up);
  });
  server.listen(listenPort, host);
  g.__tunnelRelay = server;
  return server;
}

/** For tests and shutdown. */
export function stopTunnelRelay(): Promise<void> {
  const s = g.__tunnelRelay;
  g.__tunnelRelay = undefined;
  return new Promise((resolve) => (s ? s.close(() => resolve()) : resolve()));
}
