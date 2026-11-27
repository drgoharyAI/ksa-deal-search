import { NextResponse } from "next/server";

/**
 * The API is for this app's own page on this machine. Every search sends store traffic from the
 * owner's IP (and may start the owner's Chrome for noon), so another web page or another device
 * must not be able to trigger one:
 * - Host must be loopback: blocks LAN access and DNS rebinding (evil.example resolving to 127.0.0.1);
 * - Sec-Fetch-Site, when the browser sends it, must be "same-origin" or "none" (typed URL);
 * - Origin, when present, must be this request's own origin ("null" is rejected);
 * - with `json`, the body must be declared application/json: a cross-site form or a no-cors
 *   fetch can only send CORS-simple types such as text/plain without a preflight.
 * Local tools (curl, scripts) send no Origin or Sec-Fetch-Site and pass.
 * Returns the error response to send, or null when the request may proceed.
 */
const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]"]);
const SAME = new Set(["same-origin", "none"]);

const forbidden = () => NextResponse.json({ error: "Cross-site requests are not allowed" }, { status: 403 });

function hostnameOf(host: string): string {
  try {
    return new URL(`http://${host}`).hostname;
  } catch {
    return "";
  }
}

export function rejectCrossSite(req: Request, opts: { json?: boolean } = {}): NextResponse | null {
  const url = new URL(req.url);
  const host = req.headers.get("host") ?? url.host;
  if (!LOOPBACK.has(hostnameOf(host))) return forbidden();

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
    if (!o || o.host !== host || !LOOPBACK.has(o.hostname)) return forbidden();
  }

  if (opts.json) {
    const type = (req.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
    if (type !== "application/json") {
      return NextResponse.json({ error: "Send the search as application/json" }, { status: 415 });
    }
  }
  return null;
}
