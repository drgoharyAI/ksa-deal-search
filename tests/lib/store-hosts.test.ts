import { describe, expect, it } from "vitest";
import { STORE_HOST_SITES, hostMatches, storeImage, storeLink } from "@/src/lib/store-hosts";
import { STORES } from "@/src/lib/stores";
import { parseSnapshot } from "@/src/lib/saved";
import { parseNewWatch } from "@/src/lib/alerts/validate";

/** Real links and pictures the adapters emit (src/sites/*) and the recorded answers hold (eval/recorded, tests/fixtures). */
const REAL: Record<string, { links: string[]; images: string[] }> = {
  aliexpress: { links: ["https://www.aliexpress.com/item/1005013701639083.html"], images: ["https://ae-pic-a1.aliexpress-media.com/kf/S912a.jpg", "https://ae01.alicdn.com/kf/x.jpg"] },
  "amazon-sa": { links: ["https://www.amazon.sa/dp/B0CX1"], images: ["https://m.media-amazon.com/images/I/71a.jpg"] },
  jarir: { links: ["https://www.jarir.com/sa-en/jbl-flip-6.html"], images: ["https://ak-asset.jarir.com/akeneo-prod/asset/a.jpg", "https://media-prod-eu-1.mirakl.net/SOURCE/a.jpg"] },
  "noon-sa": { links: ["https://www.noon.com/saudi-en/jbl-flip-6/N1/p/"], images: ["https://f.nooncdn.com/p/v1/a.jpg"] },
  "trendyol-sa": { links: ["https://www.trendyol.sa/jbl/flip-6-p-1"], images: ["https://cdn.dsmcdn.com/ty1/a.jpg"] },
  "extra-sa": { links: ["https://www.extra.com/en-sa/audio/p/100"], images: ["https://media.extra.com/s/aurora/100_a.jpg"] },
  "carrefour-sa": { links: ["https://www.carrefourksa.com/mafsau/en/p/123"], images: [] },
  "saco-sa": { links: ["https://www.saco.sa/en/product/jbl-flip-6-p-123"], images: ["https://img.saco.sa/a.jpg", "https://img.int-saco.com/a.jpg"] },
  "shein-sa": { links: ["https://ar.shein.com/x-p-1.html"], images: ["https://img.ltwebstatic.com/images3/a.jpg"] },
};

describe("store hosts", () => {
  it("has rules for every registered store", () => {
    for (const s of STORES) expect(STORE_HOST_SITES).toContain(s.id);
  });
  it("lets every real link and picture through, for its own store", () => {
    for (const [site, r] of Object.entries(REAL)) {
      for (const u of r.links) expect(storeLink(site, u), u).toBe(u);
      for (const u of r.images) expect(storeImage(site, u), u).toBe(u);
    }
  });
  it("refuses an evil host, a lookalike suffix or prefix, http, javascript: and other schemes", () => {
    for (const u of [
      "https://evil.example/noon",
      "https://www.noon.com.evil.com/saudi-en/x",
      "https://evilnoon.com/x",
      "https://noon.com/x",
      "http://www.noon.com/saudi-en/x",
      "javascript:alert(1)",
      "data:text/html,hi",
      "https://www.noon.com:8443/x",
      "https://user:pw@www.noon.com/x",
      "//www.noon.com/x",
      "",
    ]) expect(storeLink("noon-sa", u), u).toBeNull();
    expect(storeImage("noon-sa", "https://f.nooncdn.com.evil.com/a.jpg")).toBeNull();
    expect(storeImage("noon-sa", "https://evilnooncdn.com/a.jpg")).toBeNull();
    expect(storeImage("noon-sa", "https://tracker.example/pixel.gif")).toBeNull();
    expect(storeImage("noon-sa", "http://f.nooncdn.com/a.jpg")).toBeNull();
  });
  it("ties a host to its own store: another store's host, or an unknown store, fails", () => {
    expect(storeLink("jarir", "https://www.noon.com/saudi-en/x")).toBeNull();
    expect(storeImage("jarir", "https://f.nooncdn.com/a.jpg")).toBeNull();
    expect(storeLink("evil", "https://www.noon.com/x")).toBeNull();
    expect(storeLink("__proto__", "https://www.noon.com/x")).toBeNull();
  });
  it("matches exact hosts and dot-suffixes, never a substring", () => {
    expect(hostMatches("f.nooncdn.com", [".nooncdn.com"])).toBe(true);
    expect(hostMatches("nooncdn.com", [".nooncdn.com"])).toBe(false);
    expect(hostMatches("xnooncdn.com", [".nooncdn.com"])).toBe(false);
    expect(hostMatches("WWW.NOON.COM", ["www.noon.com"])).toBe(true);
    expect(hostMatches("www.noon.com.evil.com", ["www.noon.com"])).toBe(false);
  });
});

describe("the write paths enforce the store hosts", () => {
  const sites = new Set(STORES.map((s) => s.id));
  const snap = { site: "noon-sa", id: "N1", title: "JBL", url: "https://www.noon.com/saudi-en/x/N1/p/", image: "https://f.nooncdn.com/a.jpg", price: 1 };
  it("saved and viewed snapshots: a planted link is refused, a planted picture dropped", () => {
    expect(parseSnapshot(snap, sites, { needPrice: true })).toMatchObject({ ok: true, value: { url: snap.url, image: snap.image } });
    expect(parseSnapshot({ ...snap, url: "https://www.noon.com.evil.com/x" }, sites, { needPrice: true })).toMatchObject({ ok: false });
    expect(parseSnapshot({ ...snap, url: "https://www.jarir.com/sa-en/x" }, sites, { needPrice: true })).toMatchObject({ ok: false });
    expect(parseSnapshot({ ...snap, image: "https://tracker.example/p.gif" }, sites, { needPrice: true })).toMatchObject({ ok: true, value: { image: null } });
  });
  it("product watches (the link reaches Telegram): the same rule", () => {
    const w = { kind: "product", site: "noon-sa", productId: "N1", query: "jbl", target: 10, url: snap.url, image: snap.image, title: "JBL" };
    expect(parseNewWatch(w, sites)).toMatchObject({ ok: true, value: { url: snap.url, image: snap.image } });
    expect(parseNewWatch({ ...w, url: "https://phish.example/noon" }, sites)).toMatchObject({ ok: false });
    expect(parseNewWatch({ ...w, url: "http://www.noon.com/saudi-en/x" }, sites)).toMatchObject({ ok: false });
    expect(parseNewWatch({ ...w, image: "https://tracker.example/p.gif" }, sites)).toMatchObject({ ok: true, value: { image: null } });
  });
});

describe("render time: a stored link or picture off the store's hosts is not drawn", () => {
  it("the home deal strip shows the title without a link, and the placeholder for the picture", async () => {
    const { createElement } = await import("react");
    const { renderToStaticMarkup } = await import("react-dom/server");
    const { DiscoverCard } = await import("@/app/components/HomeDiscover");
    const item = { site: "noon-sa", id: "N1", title: "JBL", url: "https://www.noon.com.evil.com/x", image: "https://tracker.example/p.gif", currency: "SAR", price: 1, previousPrice: null, dropPct: null, seenAt: 1 };
    const out = renderToStaticMarkup(createElement(DiscoverCard, { item }));
    expect(out).not.toContain("evil.com");
    expect(out).not.toContain("tracker.example");
    expect(out).toContain("No image");
    const ok = renderToStaticMarkup(createElement(DiscoverCard, { item: { ...item, url: "https://www.noon.com/saudi-en/x", image: "https://f.nooncdn.com/a.jpg" } }));
    expect(ok).toContain('href="https://www.noon.com/saudi-en/x"');
    expect(ok).toContain('src="https://f.nooncdn.com/a.jpg"');
  });
});
