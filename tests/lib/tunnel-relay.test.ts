import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const { TUNNEL_HEADER, fromTunnelRelay, startTunnelRelay, stopTunnelRelay } = await import("@/src/lib/tunnel-relay");
const { clientKeyOf } = await import("@/src/lib/gshop/rate");

let upstream: http.Server | undefined;
afterEach(async () => {
  await stopTunnelRelay();
  await new Promise<void>((r) => (upstream ? upstream.close(() => r()) : r()));
  upstream = undefined;
});

/** An upstream server on a free port; returns its port. */
async function serve(handler: http.RequestListener): Promise<number> {
  upstream = http.createServer(handler);
  await new Promise<void>((r) => upstream!.listen(0, "127.0.0.1", r));
  return (upstream.address() as AddressInfo).port;
}

/** A relay on a free port in front of `target`; returns its port. */
async function relay(target: number): Promise<number> {
  const s = startTunnelRelay(0, target, "127.0.0.1");
  await new Promise<void>((r) => (s.listening ? r() : s.once("listening", () => r())));
  return (s.address() as AddressInfo).port;
}

const asRequest = (headers: http.IncomingHttpHeaders) =>
  new Request("http://x/", { headers: Object.entries(headers).filter(([, v]) => typeof v === "string") as [string, string][] });

describe("tunnel relay", () => {
  it("stamps the secret (replacing any copy a client sends) and keeps Host and CF-Connecting-IP", async () => {
    let seen: http.IncomingHttpHeaders = {};
    const port = await relay(await serve((req, res) => ((seen = req.headers), res.end("ok"))));
    // node:http, because fetch does not let a caller set Host.
    const body = await new Promise<string>((resolve, reject) => {
      const r = http.request({ host: "127.0.0.1", port, path: "/api/health", headers: { host: "search.example.sa", "cf-connecting-ip": "203.0.113.9", [TUNNEL_HEADER]: "00".repeat(32) } }, (res) => {
        let t = "";
        res.on("data", (c: Buffer) => (t += c.toString()));
        res.on("end", () => resolve(t));
      });
      r.on("error", reject);
      r.end();
    });
    expect(body).toBe("ok");
    expect(seen.host).toBe("search.example.sa");
    expect(seen["cf-connecting-ip"]).toBe("203.0.113.9");
    expect(seen[TUNNEL_HEADER]).not.toBe("00".repeat(32));
    // The stamped request is trusted, so its Cloudflare address is the client.
    expect(fromTunnelRelay(asRequest(seen))).toBe(true);
    expect(clientKeyOf(asRequest(seen))).toBe("cf:203.0.113.9");
  });

  it("a LAN request (straight to the server, any headers) is 'local'", async () => {
    await relay(await serve((_q, s) => s.end()));
    const forged = new Request("http://192.168.1.48:3000/api/gshop/validate", { headers: { host: "search.example.sa", "cf-connecting-ip": "1.2.3.4", [TUNNEL_HEADER]: "ab".repeat(32) } });
    expect(fromTunnelRelay(forged)).toBe(false);
    expect(clientKeyOf(forged)).toBe("local");
    expect(clientKeyOf(new Request("http://x/", { headers: { "cf-connecting-ip": "1.2.3.4", [TUNNEL_HEADER]: "short" } }))).toBe("local");
  });

  it("streams: the first line arrives before the upstream ends", async () => {
    let finish: () => void = () => {};
    const port = await relay(
      await serve((_req, res) => {
        res.writeHead(200, { "content-type": "application/x-ndjson" });
        res.write('{"type":"store"}\n');
        finish = () => res.end('{"type":"done"}\n');
      }),
    );
    const res = await fetch(`http://127.0.0.1:${port}/api/search/stream`);
    const reader = res.body!.getReader();
    const first = new TextDecoder().decode((await reader.read()).value);
    expect(first).toContain('"store"');
    finish();
    let rest = "";
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      rest += new TextDecoder().decode(value);
    }
    expect(rest).toContain('"done"');
  });

  it("a client that goes away aborts the upstream request", async () => {
    let upstreamClosed = false;
    const port = await relay(
      await serve((req, res) => {
        res.writeHead(200);
        res.write("x");
        req.on("close", () => (upstreamClosed = true));
        res.on("close", () => (upstreamClosed = true));
      }),
    );
    const ctrl = new AbortController();
    const res = await fetch(`http://127.0.0.1:${port}/slow`, { signal: ctrl.signal });
    await res.body!.getReader().read();
    ctrl.abort();
    await vi.waitFor(() => expect(upstreamClosed).toBe(true), { timeout: 2000 });
  });

  it("answers 502 when the server is down", async () => {
    const port = await relay(1);
    const res = await fetch(`http://127.0.0.1:${port}/`);
    expect(res.status).toBe(502);
  });
});
