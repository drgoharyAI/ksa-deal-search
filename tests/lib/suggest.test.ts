import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { getSuggestions, mergeSuggestions, resetSuggest, isEnglish, BACKOFF_MS, CACHE_TTL_MS } from "@/src/lib/suggest";
import { GET } from "@/app/api/suggest/route";

const amazon = (vals: string[]) => ({ suggestions: vals.map((value) => ({ type: "KEYWORD", value })) });
const jarir = (vals: string[]) => ({ sections: { Products: [], "Search Suggestions": vals.map((value) => ({ value })) } });
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

type Handler = (url: string, init?: RequestInit) => Promise<Response>;
let calls: { url: string; init?: RequestInit }[] = [];
function mockFetch(amz: Handler, jar: Handler) {
  calls = [];
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string, init?: RequestInit) => {
      calls.push({ url, init });
      return url.includes("amazon.sa") ? amz(url, init) : jar(url, init);
    }),
  );
}
const ok =
  (b: unknown): Handler =>
  async () =>
    json(b);
const hang: Handler = (_u, init) =>
  new Promise((_, rej) =>
    init?.signal?.addEventListener("abort", () => rej(new DOMException("timeout", "TimeoutError"))),
  );

beforeEach(() => resetSuggest());
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("mergeSuggestions", () => {
  it("keeps source order, dedupes case-insensitively, trims, drops non-Latin, caps at 8", () => {
    const out = mergeSuggestions([
      [" Air Fryer ", "airpods", "سماعات", "air purifier"],
      ["AIRPODS", "airtag", "a", "b", "c", "d", "e", "f"],
    ]);
    expect(out).toEqual(["Air Fryer", "airpods", "air purifier", "airtag", "a", "b", "c", "d"]);
  });
  it("isEnglish accepts Latin text with digits and symbols only", () => {
    expect(isEnglish("iphone 17 pro max 256gb")).toBe(true);
    expect(isEnglish("usb-c & 100w!")).toBe(true);
    expect(isEnglish("ايفون 17")).toBe(false);
  });
});

describe("getSuggestions / GET /api/suggest", () => {
  it("403 for a cross-site page; no upstream call (final review I2)", async () => {
    const f = vi.spyOn(globalThis, "fetch");
    const res = await GET(new Request("http://localhost:3000/api/suggest?q=air", { headers: { "sec-fetch-site": "cross-site" } }));
    expect(res.status).toBe(403);
    expect(f).not.toHaveBeenCalled();
    f.mockRestore();
  });
  it("merges Amazon first then Jarir, deduped, max 8, via the route; never sends cookies", async () => {
    mockFetch(
      ok(amazon(["air fryer", "airpods", "airpods pro 3", "air purifier", "airpods 5", "apple airpods"])),
      ok(jarir(["airpods", "airtag", "airpods max", "airpods 4"])),
    );
    const res = await GET(new Request("http://localhost/api/suggest?q=%20Air%20"));
    expect(await res.json()).toEqual({
      suggestions: ["air fryer", "airpods", "airpods pro 3", "air purifier", "airpods 5", "apple airpods", "airtag", "airpods max"],
    });
    expect(calls).toHaveLength(2);
    expect(calls[0].url).toContain("prefix=air&");
    expect(calls[1].url).toContain("/autocomplete/air?");
    for (const c of calls) {
      expect(c.init?.credentials).toBe("omit");
      expect(JSON.stringify(c.init?.headers ?? {})).not.toMatch(/cookie/i);
    }
  });

  it("returns [] without calling out for queries under 2 or over 80 chars", async () => {
    mockFetch(ok(amazon(["x"])), ok(jarir(["y"])));
    expect(await getSuggestions(" a ")).toEqual([]);
    expect(await getSuggestions("x".repeat(81))).toEqual([]);
    const res = await GET(new Request("http://localhost/api/suggest"));
    expect(await res.json()).toEqual({ suggestions: [] });
    expect(calls).toHaveLength(0);
  });

  it("ignores a failing source (error status, bad JSON, network error)", async () => {
    mockFetch(async () => json({}, 500), ok(jarir(["airtag"])));
    expect(await getSuggestions("air")).toEqual(["airtag"]);
    resetSuggest();
    mockFetch(ok(amazon(["air fryer"])), async () => new Response("<html>", { status: 200 }));
    expect(await getSuggestions("air")).toEqual(["air fryer"]);
    resetSuggest();
    mockFetch(
      async () => {
        throw new TypeError("fetch failed");
      },
      ok(jarir(["airtag"])),
    );
    expect(await getSuggestions("air")).toEqual(["airtag"]);
  });

  it("times a slow source out at 1.5 s and returns the other", async () => {
    vi.useFakeTimers();
    mockFetch(hang, ok(jarir(["airtag"])));
    const p = getSuggestions("air");
    await vi.advanceTimersByTimeAsync(1500);
    expect(await p).toEqual(["airtag"]);
  });

  it("backs a source off for 10 min after 429 or 403", async () => {
    vi.useFakeTimers();
    mockFetch(async () => json({}, 429), ok(jarir(["airtag"])));
    await getSuggestions("air");
    mockFetch(ok(amazon(["airpods"])), ok(jarir(["airtag"])));
    expect(await getSuggestions("airp")).toEqual(["airtag"]);
    expect(calls.some((c) => c.url.includes("amazon"))).toBe(false);
    vi.advanceTimersByTime(BACKOFF_MS);
    expect(await getSuggestions("airpo")).toEqual(["airpods", "airtag"]);

    resetSuggest();
    mockFetch(ok(amazon(["airpods"])), async () => json({}, 403));
    await getSuggestions("air");
    mockFetch(ok(amazon(["airpods"])), ok(jarir(["airtag"])));
    await getSuggestions("airp");
    expect(calls.some((c) => c.url.includes("cnstrc"))).toBe(false);
  });

  it("caches per normalized query for 5 min; does not cache when every source failed", async () => {
    vi.useFakeTimers();
    mockFetch(ok(amazon(["airpods"])), ok(jarir([])));
    await getSuggestions("AirPods");
    await getSuggestions("  airpods ");
    expect(calls).toHaveLength(2);
    vi.advanceTimersByTime(CACHE_TTL_MS);
    await getSuggestions("airpods");
    expect(calls).toHaveLength(4);

    mockFetch(async () => json({}, 500), async () => json({}, 500));
    expect(await getSuggestions("kettle")).toEqual([]);
    await getSuggestions("kettle");
    expect(calls).toHaveLength(4);
  });

  it("shares one in-flight call for the same normalized query", async () => {
    mockFetch(ok(amazon(["airpods"])), ok(jarir([])));
    const [a, b] = await Promise.all([getSuggestions("air"), getSuggestions("AIR")]);
    expect(a).toEqual(b);
    expect(calls).toHaveLength(2);
  });
});
