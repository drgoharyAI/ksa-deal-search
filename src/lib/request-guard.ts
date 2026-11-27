import { NextResponse } from "next/server";

/**
 * The API is for this app's own page on this machine. Every search sends store traffic from the
 * owner's IP (and may start the owner's Chrome for noon), so another web page or another device
 * must not be able to trigger one:
 * - Host must be loopback, or listed in APP_HOSTS (comma-separated host[:port], matched exactly,
 *   e.g. "192.168.1.48:3000,deals.lan" on the LAN server): blocks DNS rebinding (evil.example
 *   resolving to 127.0.0.1) and any host the operator did not list;
 * - Sec-Fetch-Site, when the browser sends it, must be "same-origin" or "none" (typed URL);
 * - Origin, when present, must be this request's own origin on an allowed host ("null" is rejected);
 * - with `json`, the body must be declared application/json: a cross-site form or a no-cors
 *   fetch can only send CORS-simple types such as text/plain without a preflight.
 * Local tools (curl, scripts) send no Origin or Sec-Fetch-Site and pass.
 * Returns the error response to send, or null when the request may proceed.
 */
const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]"]);
const SAME = new Set(["same-origin", "none"]);

type Env = Record<string, string | undefined>;

/** APP_HOSTS entries, lower-cased host[:port] strings; empty when unset (local dev: loopback only). */
function appHosts(env: Env): Set<string> {
  return new Set(
    (env.APP_HOSTS ?? "")
      .split(",")
      .map((h) => h.trim().toLowerCase())
      .filter(Boolean),
  );
}

const forbidden = () => NextResponse.json({ error: "Cross-site requests are not allowed" }, { status: 403 });

function hostnameOf(host: string): string {
  try {
    return new URL(`http://${host}`).hostname;
  } catch {
    return "";
  }
}

export function rejectCrossSite(req: Request, opts: { json?: boolean; env?: Env } = {}): NextResponse | null {
  const url = new URL(req.url);
  const host = req.headers.get("host") ?? url.host;
  const listed = appHosts(opts.env ?? process.env);
  const allowed = (h: string) => LOOPBACK.has(hostnameOf(h)) || listed.has(h.toLowerCase());
  if (!allowed(host)) return forbidden();

  const site = req.headers.get("sec-fetch-site");
  if (site !== null && !SAME.has(site)) return forbidden();

  const origin = req.headers.get("origin");
  if (origin !== null) {
    let o: URL | null = null;
    try {
      o = new URL(origin);
    } catch {
      // "null" or garbage
    }
    if (!o || o.host !== host.toLowerCase() || !allowed(o.host)) return forbidden();
  }

  if (opts.json) {
    const type = (req.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
    if (type !== "application/json") {
      return NextResponse.json({ error: "Send the search as application/json" }, { status: 415 });
    }
  }
  return null;
}
