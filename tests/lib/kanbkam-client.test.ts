import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { classifyKanbkam, fetchKanbkam, parseKanbkamPage } from "@/src/lib/kanbkam/client";
import { kanbkamProductUrl, safeKanbkamLink, validKanbkamId } from "@/src/lib/kanbkam/links";

const fixture = (name: string) => fs.readFileSync(path.join(__dirname, "..", "fixtures", "kanbkam", name), "utf8");

describe("parseKanbkamPage (trimmed pages from the spike)", () => {
  it("reads lowest, highest, current, the recent change, the store and the title", () => {
    const p = parseKanbkamPage(fixture("amazon-B09HGPKY7Q.html"));
    expect(p).toEqual({
      min: 269,
      max: 659,
      current: 269,
      dropPct: -32.6,
      store: "amazon",
      since: null,
      title: expect.stringContaining("JBL Flip 6 Portable IP67") as unknown,
    });
  });
  it("reads a second listing (the p-<id> URL with any slug)", () => {
    const p = parseKanbkamPage(fixture("amazon-B09NCDFTYK.html"));
    expect(p).toMatchObject({ min: 269, max: 499, current: 269, dropPct: -35.3, store: "amazon" });
  });
  it("reads a noon listing (live check page): comma prices and a 'Recent Price Raise'", () => {
    expect(parseKanbkamPage(fixture("noon-N70208041V.html"))).toMatchObject({ min: 1898.99, max: 1898.99, current: 1899, dropPct: 0, store: "noon" });
    const up = fixture("noon-N70208041V.html").replace(">0%<", ">4.2%<");
    expect(parseKanbkamPage(up)).toMatchObject({ dropPct: 4.2 });
  });
  it("reads a 'since' date when the page shows one", () => {
    const html = fixture("amazon-B09HGPKY7Q.html").replace("</ul>", '</ul><p class="tracked">Tracked since Mar 14, 2022</p>');
    expect(parseKanbkamPage(html)).toMatchObject({ since: "Mar 14, 2022" });
  });
  it("reads a price rise as a positive change", () => {
    const html = fixture("amazon-B09HGPKY7Q.html").replace("Recent Price Drop", "Recent Price Increase").replace("-32.6%", "+12.5%");
    expect(parseKanbkamPage(html)).toMatchObject({ dropPct: 12.5 });
  });
  it("reads only the main product, not the similar products below it", () => {
    const html = fixture("amazon-B09HGPKY7Q.html").replace(
      "</section>",
      '</section><section class="similar-product"><span id="min" class="green value">1.00</span><a data-gtmid="product-buy|noon|sa|en"></a></section>',
    );
    expect(parseKanbkamPage(html)).toMatchObject({ min: 269, store: "amazon" });
  });
  it("is null for a page with no price block (not found, challenge)", () => {
    expect(parseKanbkamPage(fixture("not-found.html"))).toBeNull();
    expect(parseKanbkamPage(fixture("challenge.html"))).toBeNull();
    expect(parseKanbkamPage("")).toBeNull();
  });
  it("is null when the numbers make no sense (lowest above highest, zero)", () => {
    const html = fixture("amazon-B09HGPKY7Q.html");
    expect(parseKanbkamPage(html.replace('id="min" class="green value">269.00', 'id="min" class="green value">999.00'))).toBeNull();
    expect(parseKanbkamPage(html.replace('id="max" class="red value">659.00', 'id="max" class="red value">0'))).toBeNull();
  });
  it("stays fast on a huge hostile page", () => {
    const t = performance.now();
    parseKanbkamPage('<section class="product-info">' + "<span id=\"min\" ".repeat(50_000) + " ".repeat(200_000));
    expect(performance.now() - t).toBeLessThan(1000);
  });
});

describe("classifyKanbkam", () => {
  const ok = fixture("amazon-B09HGPKY7Q.html");
  it("a 200 product page for the right store is ok", () => {
    expect(classifyKanbkam("amazon-sa", 200, ok)).toMatchObject({ kind: "ok", page: { min: 269 } });
  });
  it("a page for another store's listing is not this listing: missing", () => {
    expect(classifyKanbkam("noon-sa", 200, ok)).toEqual({ kind: "missing" });
  });
  it("404, 410 or a 200 page without a product is missing", () => {
    expect(classifyKanbkam("amazon-sa", 404, "")).toEqual({ kind: "missing" });
    expect(classifyKanbkam("amazon-sa", 410, "")).toEqual({ kind: "missing" });
    expect(classifyKanbkam("amazon-sa", 200, fixture("not-found.html"))).toEqual({ kind: "missing" });
  });
  it("403, 429 and a Cloudflare challenge page (whatever its status, 503 included) are a block", () => {
    expect(classifyKanbkam("amazon-sa", 403, "")).toEqual({ kind: "blocked", why: "403" });
    expect(classifyKanbkam("amazon-sa", 429, "")).toEqual({ kind: "blocked", why: "429" });
    expect(classifyKanbkam("amazon-sa", 503, fixture("challenge.html"))).toEqual({ kind: "blocked", why: "challenge" });
    expect(classifyKanbkam("amazon-sa", 200, fixture("challenge.html"))).toEqual({ kind: "blocked", why: "challenge" });
  });
  it("other server errors are an error, not a block", () => {
    expect(classifyKanbkam("amazon-sa", 500, "oops")).toEqual({ kind: "error", message: "HTTP 500" });
  });
});

describe("ids and links", () => {
  it("accepts an ASIN for amazon-sa and a noon SKU (both recorded shapes) for noon-sa", () => {
    expect(validKanbkamId("amazon-sa", "B09HGPKY7Q")).toBe(true);
    expect(validKanbkamId("noon-sa", "N70208041V")).toBe(true);
    expect(validKanbkamId("noon-sa", "ZE21165BE194EB7F1D580Z")).toBe(true);
  });
  it("refuses other stores, other shapes and injection attempts", () => {
    for (const id of [
      "b09hgpky7q",
      "B09HGPKY7",
      "B09HGPKY7QX",
      "../../etc/x",
      "B09HGPKY7Q/../../admin",
      "B09HGPKY7Q?x=1",
      "B09HGPKY7Q#a",
      "B09HG%2FKY7",
      "B09HGPKY7Q\n",
      " B09HGPKY7Q",
      "@evil.com/a",
      "//evil.com",
      "",
    ]) {
      expect(validKanbkamId("amazon-sa", id)).toBe(false);
    }
    expect(validKanbkamId("noon-sa", "N7020804V")).toBe(false);
    expect(validKanbkamId("noon-sa", "Z21165BE194EB7F1D580Z")).toBe(false);
    expect(validKanbkamId("noon-sa", "Zg21165BE194EB7F1D580Z")).toBe(false);
    expect(validKanbkamId("jarir", "B09HGPKY7Q")).toBe(false);
    expect(validKanbkamId("__proto__", "B09HGPKY7Q")).toBe(false);
    expect(validKanbkamId("amazon-sa", 42 as unknown as string)).toBe(false);
  });
  it("builds only the fixed-host product URL", () => {
    expect(kanbkamProductUrl("amazon-sa", "B09HGPKY7Q")).toBe("https://www.kanbkam.com/sa/en/p-B09HGPKY7Q");
    expect(kanbkamProductUrl("amazon-sa", "../x")).toBeNull();
    expect(kanbkamProductUrl("jarir", "B09HGPKY7Q")).toBeNull();
  });
  it("links only to https Kanbkam product pages", () => {
    expect(safeKanbkamLink("https://www.kanbkam.com/sa/en/p-B09HGPKY7Q")).toBe("https://www.kanbkam.com/sa/en/p-B09HGPKY7Q");
    expect(safeKanbkamLink("https://kanbkam.com/sa/en/p-N70208041V")).toBe("https://kanbkam.com/sa/en/p-N70208041V");
    for (const u of [
      "http://www.kanbkam.com/sa/en/p-B09HGPKY7Q",
      "https://www.kanbkam.com.evil.com/sa/en/p-B09HGPKY7Q",
      "https://evilkanbkam.com/sa/en/p-B09HGPKY7Q",
      "https://user:pw@www.kanbkam.com/sa/en/p-B09HGPKY7Q",
      "https://www.kanbkam.com:8443/sa/en/p-B09HGPKY7Q",
      "https://www.kanbkam.com/sa/en/search?q=x",
      "javascript:alert(1)",
      "//www.kanbkam.com/sa/en/p-B09HGPKY7Q",
      null,
    ]) {
      expect(safeKanbkamLink(u)).toBeNull();
    }
  });
});

describe("fetchKanbkam", () => {
  const html = fixture("amazon-B09HGPKY7Q.html");
  it("asks only the fixed host for the validated id, with a timeout, and parses the answer", async () => {
    const seen: { url: string; init?: RequestInit }[] = [];
    const fake = (async (url: string, init?: RequestInit) => {
      seen.push({ url, init });
      return new Response(html, { status: 200 });
    }) as unknown as typeof fetch;
    const r = await fetchKanbkam("amazon-sa", "B09HGPKY7Q", { fetch: fake });
    expect(r).toMatchObject({ kind: "ok", page: { max: 659 } });
    expect(seen).toHaveLength(1);
    expect(seen[0].url).toBe("https://www.kanbkam.com/sa/en/p-B09HGPKY7Q");
    expect(seen[0].init?.signal).toBeInstanceOf(AbortSignal);
    expect(seen[0].init?.redirect).toBe("manual");
  });
  it("never fetches an invalid id", async () => {
    let calls = 0;
    const fake = (async () => {
      calls++;
      return new Response(html);
    }) as unknown as typeof fetch;
    expect(await fetchKanbkam("amazon-sa", "../admin", { fetch: fake })).toEqual({ kind: "error", message: "invalid id" });
    expect(calls).toBe(0);
  });
  it("never follows a redirect: Kanbkam's redirect to its search (live check, unknown id) is a miss", async () => {
    const urls: string[] = [];
    const hop = (to: string) =>
      (async (url: string) => {
        urls.push(url);
        return new Response(null, { status: 302, headers: { location: to } });
      }) as unknown as typeof fetch;
    expect(await fetchKanbkam("amazon-sa", "B000000000", { fetch: hop("https://www.kanbkam.com/sa/en/search/l?q=p") })).toEqual({ kind: "missing" });
    expect(await fetchKanbkam("amazon-sa", "B000000000", { fetch: hop("/sa/en/search/l?q=p") })).toEqual({ kind: "missing" });
    expect(await fetchKanbkam("amazon-sa", "B09HGPKY7Q", { fetch: hop("/sa/en/jbl-flip-6-B09HGPKY7Q") })).toEqual({ kind: "error", message: "redirect" });
    expect(await fetchKanbkam("amazon-sa", "B09HGPKY7Q", { fetch: hop("https://evil.example/sa/en/search/x") })).toEqual({ kind: "error", message: "redirect" });
    expect(urls).toHaveLength(4);
  });
  it("a network failure or timeout is an error", async () => {
    const fail = (async () => {
      throw new Error("timeout");
    }) as unknown as typeof fetch;
    expect(await fetchKanbkam("amazon-sa", "B09HGPKY7Q", { fetch: fail })).toEqual({ kind: "error", message: "timeout" });
  });
  it("refuses an oversized page", async () => {
    const big = (async () => new Response("x".repeat(3_000_001), { status: 200 })) as unknown as typeof fetch;
    expect(await fetchKanbkam("amazon-sa", "B09HGPKY7Q", { fetch: big })).toEqual({ kind: "error", message: "page too large" });
  });
});
