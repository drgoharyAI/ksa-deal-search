import { describe, it, expect } from "vitest";
import { rejectCrossSite } from "@/src/lib/request-guard";

const req = (url: string, headers: Record<string, string> = {}, method = "GET") =>
  new Request(url, { method, headers, body: method === "POST" ? "{}" : undefined });

describe("rejectCrossSite (final review I2)", () => {
  it("allows same-origin browser requests and local tools without Origin", () => {
    expect(rejectCrossSite(req("http://localhost:3000/api/suggest?q=a"))).toBeNull();
    expect(rejectCrossSite(req("http://127.0.0.1:3000/api/suggest", { "sec-fetch-site": "same-origin", origin: "http://127.0.0.1:3000" }))).toBeNull();
    expect(rejectCrossSite(req("http://localhost:3000/api/suggest", { "sec-fetch-site": "none" }))).toBeNull();
  });
  it("rejects another site by Sec-Fetch-Site (cross-site and same-site, e.g. another localhost port)", () => {
    expect(rejectCrossSite(req("http://localhost:3000/api/suggest", { "sec-fetch-site": "cross-site" }))?.status).toBe(403);
    expect(rejectCrossSite(req("http://localhost:3000/api/suggest", { "sec-fetch-site": "same-site" }))?.status).toBe(403);
  });
  it("rejects a foreign or opaque Origin", () => {
    expect(rejectCrossSite(req("http://localhost:3000/api/suggest", { origin: "https://evil.example" }))?.status).toBe(403);
    expect(rejectCrossSite(req("http://localhost:3000/api/suggest", { origin: "http://localhost:8080" }))?.status).toBe(403);
    expect(rejectCrossSite(req("http://localhost:3000/api/suggest", { origin: "null" }))?.status).toBe(403);
  });
  it("rejects a non-loopback Host (DNS rebinding, LAN access)", () => {
    expect(rejectCrossSite(req("http://evil.example:3000/api/suggest", { origin: "http://evil.example:3000" }))?.status).toBe(403);
    expect(rejectCrossSite(req("http://192.168.1.20:3000/api/suggest"))?.status).toBe(403);
    expect(rejectCrossSite(req("http://[::1]:3000/api/suggest"))).toBeNull();
  });
  it("POST requires Content-Type application/json (no CORS-simple text/plain)", () => {
    expect(rejectCrossSite(req("http://localhost:3000/api/search", { "content-type": "text/plain" }, "POST"), { json: true })?.status).toBe(415);
    expect(rejectCrossSite(req("http://localhost:3000/api/search", { "content-type": "application/json; charset=utf-8" }, "POST"), { json: true })).toBeNull();
  });
});

describe("rejectCrossSite with APP_HOSTS (LAN deployment)", () => {
  const env = { APP_HOSTS: " 192.168.1.48:3000, Deals.LAN ,," };
  it("allows a Host listed in APP_HOSTS, with a same-origin Origin", () => {
    expect(rejectCrossSite(req("http://192.168.1.48:3000/api/suggest"), { env })).toBeNull();
    expect(
      rejectCrossSite(req("http://192.168.1.48:3000/api/suggest", { "sec-fetch-site": "same-origin", origin: "http://192.168.1.48:3000" }), { env }),
    ).toBeNull();
    expect(rejectCrossSite(req("https://deals.lan/api/suggest", { origin: "https://deals.lan" }), { env })).toBeNull();
  });
  it("still allows loopback", () => {
    expect(rejectCrossSite(req("http://localhost:3000/api/suggest"), { env })).toBeNull();
  });
  it("matches host and port exactly", () => {
    expect(rejectCrossSite(req("http://192.168.1.48:8080/api/suggest"), { env })?.status).toBe(403);
    expect(rejectCrossSite(req("http://192.168.1.48/api/suggest"), { env })?.status).toBe(403);
    expect(rejectCrossSite(req("http://deals.lan:3000/api/suggest"), { env })?.status).toBe(403);
    expect(rejectCrossSite(req("http://192.168.1.49:3000/api/suggest"), { env })?.status).toBe(403);
  });
  it("keeps the Origin and Sec-Fetch-Site rules for listed hosts", () => {
    const u = "http://192.168.1.48:3000/api/suggest";
    expect(rejectCrossSite(req(u, { origin: "https://evil.example" }), { env })?.status).toBe(403);
    expect(rejectCrossSite(req(u, { origin: "http://deals.lan" }), { env })?.status).toBe(403);
    expect(rejectCrossSite(req(u, { origin: "null" }), { env })?.status).toBe(403);
    expect(rejectCrossSite(req(u, { "sec-fetch-site": "cross-site" }), { env })?.status).toBe(403);
  });
  it("without APP_HOSTS a LAN Host is rejected (local dev stays loopback-only)", () => {
    expect(rejectCrossSite(req("http://192.168.1.48:3000/api/suggest"), { env: {} })?.status).toBe(403);
  });
  it("reads APP_HOSTS from process.env by default", () => {
    const prev = process.env.APP_HOSTS;
    process.env.APP_HOSTS = "192.168.1.48:3000";
    try {
      expect(rejectCrossSite(req("http://192.168.1.48:3000/api/suggest"))).toBeNull();
    } finally {
      if (prev === undefined) delete process.env.APP_HOSTS;
      else process.env.APP_HOSTS = prev;
    }
  });
});
