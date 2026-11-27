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
