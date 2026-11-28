import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { SerpApiError, cleanQuery, currencyOf, serpAccount, serpImmersive, serpShopping } from "@/src/lib/gshop/client";

const KEY = "sk_test_SECRET_1234567890";
const fixture = (name: string) => fs.readFileSync(path.join(__dirname, "..", "fixtures", "gshop", name), "utf8");

type Call = { url: URL; init?: RequestInit };
function stub(answer: (url: URL) => Response | Promise<Response>) {
  const calls: Call[] = [];
  const fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(input instanceof URL ? input.href : typeof input === "string" ? input : input.url);
    calls.push({ url, init });
    return answer(url);
  }) as typeof globalThis.fetch;
  return { fetch, calls };
}
const ok = (body: string) => new Response(body, { status: 200, headers: { "content-type": "application/json" } });

describe("serpShopping (engine=google_shopping)", () => {
  it("asks the fixed host for google.com.sa, Saudi Arabia, English, and parses results", async () => {
    const s = stub(() => ok(fixture("serpapi-shopping-jbl.json")));
    const items = await serpShopping("jbl flip 6", { key: KEY, fetch: s.fetch });
    const u = s.calls[0].url;
    expect(u.origin + u.pathname).toBe("https://serpapi.com/search.json");
    expect(Object.fromEntries(u.searchParams)).toEqual({ engine: "google_shopping", q: "jbl flip 6", google_domain: "google.com.sa", gl: "sa", hl: "en", api_key: KEY });
    expect(items).toHaveLength(2);
    expect(items[1]).toEqual({ title: "JBL Flip 6 Portable Bluetooth Speaker Waterproof Wireless", productId: "5053887856104557232", token: "TOKEN-FLIP6", source: "Abdulwahed", price: 349, currency: "SAR" });
  });
  it("reads Google's 'no results' as an empty list", async () => {
    const s = stub(() => ok(JSON.stringify({ search_metadata: { status: "Success" }, error: "Google hasn't returned any results for this query." })));
    expect(await serpShopping("zzqx", { key: KEY, fetch: s.fetch })).toEqual([]);
  });
});

describe("serpImmersive (engine=google_immersive_product)", () => {
  it("asks for more stores with the page token and maps each store to an offer", async () => {
    const s = stub(() => ok(fixture("serpapi-immersive-jbl.json")));
    const r = await serpImmersive("TOKEN-FLIP6", { key: KEY, fetch: s.fetch });
    expect(Object.fromEntries(s.calls[0].url.searchParams)).toEqual({ engine: "google_immersive_product", page_token: "TOKEN-FLIP6", more_stores: "true", api_key: KEY });
    expect(r.title).toBe("JBL Flip 6 Portable Bluetooth Speaker Waterproof Wireless");
    expect(r.offers).toHaveLength(6);
    expect(r.offers[1]).toEqual({ store: "Jarir Bookstore", title: "JBL Flip 6 Portable Speaker Black", price: 399, currency: "SAR", foreign: false, was: 499, url: "https://www.jarir.com/sa-en/jbl-flip-6-black.html", shipping: 15, from: "serpapi" });
    expect(r.offers[4]).toMatchObject({ store: "eBay", currency: "USD" });
    // foreign reflects the currency and the host: desertcart.ae and ebay.com are not Saudi.
    expect(r.offers.map((o) => [o.store, o.foreign])).toEqual([
      ["Amazon.sa", false],
      ["Jarir Bookstore", false],
      ["Danube", false],
      ["Desertcart.ae", true],
      ["eBay", true],
      ["Abdulwahed", false],
    ]);
  });
});

describe("serpAccount (free, not counted)", () => {
  it("reads the searches left", async () => {
    const s = stub(() => ok(JSON.stringify({ plan_searches_left: 212, total_searches_left: 212, searches_per_month: 250, plan_renewal_date: "2026-12-28", api_key: KEY })));
    expect(await serpAccount({ key: KEY, fetch: s.fetch })).toEqual({ searchesLeft: 212, renewal: "2026-12-28" });
    const none = stub(() => ok(JSON.stringify({ plan_searches_left: 5, plan_renewal_date: null })));
    expect(await serpAccount({ key: KEY, fetch: none.fetch })).toEqual({ searchesLeft: 5, renewal: null });
    expect(s.calls[0].url.origin + s.calls[0].url.pathname).toBe("https://serpapi.com/account.json");
  });
});

describe("errors", () => {
  it("never leaks the key: not in the message, not in the cause", async () => {
    const s = stub(() => new Response(JSON.stringify({ error: `Invalid API key. Your API key should be here: ${KEY}` }), { status: 401 }));
    const e = (await serpShopping("x", { key: KEY, fetch: s.fetch }).catch((x: unknown) => x)) as SerpApiError;
    expect(e).toBeInstanceOf(SerpApiError);
    expect(e.kind).toBe("bad");
    expect(e.message).not.toContain(KEY);
    expect(String(e.stack)).not.toContain(KEY);
    expect(JSON.stringify(e)).not.toContain(KEY);
  });
  it("redacts the key from network errors (which may quote the URL)", async () => {
    const s = stub(() => {
      throw new TypeError(`fetch failed for https://serpapi.com/search.json?api_key=${KEY}`);
    });
    const e = (await serpShopping("x", { key: KEY, fetch: s.fetch }).catch((x: unknown) => x)) as SerpApiError;
    expect(e.kind).toBe("down");
    expect(e.message).not.toContain(KEY);
  });
  it("tells 'out of searches' (429 or 200 error) from an hourly limit or an outage", async () => {
    const out = stub(() => new Response(JSON.stringify({ error: "Your account has run out of searches." }), { status: 429 }));
    expect(((await serpShopping("x", { key: KEY, fetch: out.fetch }).catch((x: unknown) => x)) as SerpApiError).kind).toBe("exhausted");
    const hourly = stub(() => new Response(JSON.stringify({ error: "Your account has exceeded the hourly searches limit." }), { status: 429 }));
    expect(((await serpShopping("x", { key: KEY, fetch: hourly.fetch }).catch((x: unknown) => x)) as SerpApiError).kind).toBe("down");
    const down = stub(() => new Response("oops", { status: 503 }));
    expect(((await serpShopping("x", { key: KEY, fetch: down.fetch }).catch((x: unknown) => x)) as SerpApiError).kind).toBe("down");
    const failed = stub(() => ok(JSON.stringify({ search_metadata: { status: "Error" }, error: "Proxy timeout" })));
    expect(((await serpShopping("x", { key: KEY, fetch: failed.fetch }).catch((x: unknown) => x)) as SerpApiError).kind).toBe("down");
  });
  it("times out a slow answer", async () => {
    const s = stub(
      (url) =>
        new Promise<Response>((_, reject) => {
          expect(url.hostname).toBe("serpapi.com");
          setTimeout(() => reject(new DOMException("The operation was aborted.", "TimeoutError")), 5);
        }),
    );
    const slow = (async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(init?.signal).toBeInstanceOf(AbortSignal);
      return s.fetch(input, init);
    }) as typeof globalThis.fetch;
    const e = (await serpShopping("x", { key: KEY, fetch: slow, timeoutMs: 1 }).catch((x: unknown) => x)) as SerpApiError;
    expect(e.kind).toBe("down");
    expect(e.message).toMatch(/timed out|abort/i);
  });
  it("refuses an oversized answer", async () => {
    const s = stub(() => ok(`{"x":"${"a".repeat(3_200_000)}"}`));
    expect(((await serpShopping("x", { key: KEY, fetch: s.fetch }).catch((x: unknown) => x)) as SerpApiError).kind).toBe("down");
  });
});

describe("helpers", () => {
  it("cleanQuery keeps the product's name up to its model number, not colours or marketing words (live, 2026-11-28)", () => {
    // The 7-word query "JBL Flip 6 Gray Portable Bluetooth Speaker" got 40 unrelated speakers from Google.
    expect(cleanQuery("JBL Flip 6 Gray Portable Bluetooth Speaker Waterproof Wireless")).toBe("JBL Flip 6");
    expect(cleanQuery("JBL Flip 6 Portable Bluetooth Speaker, Waterproof (IP67), Black - 12 Hours Playtime")).toBe("JBL Flip 6");
    expect(cleanQuery("Apple iPhone 15 Pro Max 256GB Natural Titanium")).toBe("Apple iPhone 15 Pro Max");
    expect(cleanQuery("Samsung Galaxy S24 Ultra, 512GB, Titanium Black")).toBe("Samsung Galaxy S24 Ultra");
    expect(cleanQuery("Philips Essential Airfryer XL HD9270/91")).toBe("Philips Essential Airfryer XL HD9270/91");
    expect(cleanQuery("Philips Essential Airfryer Black Large Capacity Rapid Air")).toBe("Philips Essential Airfryer Black");
    expect(cleanQuery("  ")).toBe("");
  });
  it("cleanQuery never takes a size, a unit or a pack count for the model number (review)", () => {
    // A real model code wins: letters with digits.
    expect(cleanQuery("Samsung 65 inch QLED 4K Q60D Smart TV")).toBe("Samsung 65 inch QLED 4K Q60D");
    expect(cleanQuery("Tefal 1.7L Electric Kettle KO8501 Stainless Steel")).toBe("Tefal 1.7L Electric Kettle KO8501");
    expect(cleanQuery("Sony WH-1000XM5 Wireless Noise Cancelling Headphones, Black")).toBe("Sony WH-1000XM5");
    // No model code: the first words, sizes kept, so the query stays one product.
    expect(cleanQuery("Samsung 65 inch QLED Smart TV")).toBe("Samsung 65 inch QLED");
    expect(cleanQuery("Tefal 1.7L Electric Kettle")).toBe("Tefal 1.7L Electric Kettle");
    expect(cleanQuery("2 Pack Anker USB-C Charging Cable")).toBe("2 Pack Anker USB-C");
    // A bare series number is the model unless a unit follows it.
    expect(cleanQuery("Apple iPhone 16 Pro 256GB Desert Titanium")).toBe("Apple iPhone 16 Pro");
    expect(cleanQuery("iPhone 16 Pro 256GB")).toBe("iPhone 16 Pro");
    expect(cleanQuery("Apple AirPods 4 with Active Noise Cancellation")).toBe("Apple AirPods 4");
    expect(cleanQuery("Anker Power Bank 20000mAh 22.5W Fast Charging")).toBe("Anker Power Bank 20000mAh");
  });
  it("currencyOf reads SAR and other currencies from Google's price text", () => {
    expect(currencyOf("SAR 349.00")).toBe("SAR");
    expect(currencyOf("349.00 ر.س.\u200f")).toBe("SAR");
    expect(currencyOf("$80.00")).toBe("USD");
    expect(currencyOf("AED 509")).toBe("AED");
    expect(currencyOf("349")).toBe("?");
  });
});
