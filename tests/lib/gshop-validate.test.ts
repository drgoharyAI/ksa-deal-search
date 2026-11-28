import { describe, expect, it } from "vitest";
import { THRESHOLDS, VERDICT_LABELS, keepOffers, validateOffers, verdictFor, type GshopOffer } from "@/src/lib/gshop/validate";

const TITLE = "JBL Flip 6 Portable Bluetooth Speaker Waterproof Wireless";
const our = { site: "amazon-sa", title: TITLE, price: 349, origPrice: null as number | null };
const offer = (o: Partial<GshopOffer>): GshopOffer => ({ store: "Saeel", title: TITLE, price: 400, currency: "SAR", foreign: false, was: null, url: null, from: "grid", ...o });
const others = (...prices: number[]) => prices.map((price, i) => ({ store: `Store ${i}`, domain: null, price, was: null, url: null }));

describe("thresholds", () => {
  it("are the documented constants", () => {
    expect(THRESHOLDS).toEqual({ CONFIRMED_MARGIN: 0.98, NOT_UNIQUE: 0.98, FAKE_WAS: 1.05, MIN_CONFIRMED: 2, MIN_NOT_UNIQUE: 1, MIN_FAKE_WAS: 3, SAME_WAS: 0.01 });
  });
});

describe("verdictFor", () => {
  it("confirmed deal: lowest by 2% or more under at least 2 other Saudi offers", () => {
    // 0.98 x 310 = 303.8
    expect(verdictFor({ price: 300, origPrice: null }, others(310, 400)).verdict).toBe("confirmed");
    expect(verdictFor({ price: 305, origPrice: null }, others(310, 400)).verdict).toBe("not-unique");
  });
  it("confirmed at exactly a 2% margin, not below 2 offers", () => {
    expect(verdictFor({ price: 294, origPrice: null }, others(300, 400)).verdict).toBe("confirmed");
    expect(verdictFor({ price: 290, origPrice: null }, others(300)).verdict).toBe("no-data");
  });
  it("not unique: others match or beat the price (one offer is enough)", () => {
    expect(verdictFor({ price: 349, origPrice: null }, others(349)).verdict).toBe("not-unique");
    expect(verdictFor({ price: 349, origPrice: null }, others(340, 500)).verdict).toBe("not-unique");
    expect(verdictFor({ price: 295, origPrice: null }, others(300, 400)).verdict).toBe("not-unique");
  });
  it("fake was-price: the was-price is over 1.05x every other current price, with 3 offers", () => {
    expect(verdictFor({ price: 349, origPrice: 599 }, others(349, 399, 499)).verdict).toBe("fake-was");
    // Only 2 offers: not enough to call it fake (the price rules decide instead).
    expect(verdictFor({ price: 349, origPrice: 599 }, others(399, 499)).verdict).toBe("confirmed");
    // 1.05 x 499 = 523.95: a was-price of 520 is not flagged.
    expect(verdictFor({ price: 349, origPrice: 520 }, others(349, 399, 499)).verdict).toBe("not-unique");
  });
  it("another store showing the same was-price makes it real", () => {
    const o = [...others(349, 399), { store: "Abdulwahed", domain: null, price: 450, was: 599, url: null }];
    expect(verdictFor({ price: 349, origPrice: 599 }, o).verdict).toBe("not-unique");
  });
  it("no data with no offers", () => {
    expect(verdictFor({ price: 349, origPrice: null }, []).verdict).toBe("no-data");
  });
});

describe("keepOffers: Saudi offers of the same product only", () => {
  it("drops foreign-priced, non-SAR, denied, used and our own store's offers", () => {
    const kept = keepOffers(our, [
      offer({ store: "Abdulwahed", price: 349, was: 499 }),
      offer({ store: "CatchyJo", price: 682.46, foreign: true }),
      offer({ store: "Links", price: 410.69, currency: "EUR" }),
      offer({ store: "eBay - k_item", price: 480 }),
      offer({ store: "Desertcart.ae", price: 519.86 }),
      offer({ store: "eBay", price: 300, used: true }),
      offer({ store: "Amazon.sa", price: 349 }),
      offer({ store: "Amazon", price: 340, url: "https://www.amazon.sa/dp/B1", from: "panel" }),
    ]);
    expect(kept.map((k) => k.store)).toEqual(["Abdulwahed"]);
  });
  it("drops bundles and other models (Flip 7 never matches Flip 6)", () => {
    const kept = keepOffers(our, [
      offer({ store: "Danube", price: 499, title: "JBL Flip 6 Waterproof Portable Bluetooth Speaker" }),
      offer({ store: "Saeel", price: 299, title: "JBL Flip 7 Portable Bluetooth Speaker Waterproof Wireless" }),
      offer({ store: "desertcart.com.sa", price: 774, title: "JBL Flip 6 + Bundle with Case Logic Braided USB Type-C Charge & Sync" }),
      offer({ store: "Mazeed", price: 900, title: "JBL FLIP 6 Waterproof Portable Bluetooth Speaker Bundle - Blue (Pack of 2)" }),
    ]);
    expect(kept.map((k) => k.store)).toEqual(["Danube"]);
  });
  it("needs a Saudi host or a known name for an API offer with a link, and keeps only a safe link", () => {
    const kept = keepOffers(our, [
      offer({ store: "Jarir", price: 399, url: "https://www.jarir.com/sa-en/flip6.html", from: "serpapi" }),
      offer({ store: "Some shop", price: 380, url: "https://some-shop.com/flip6", from: "serpapi" }),
      offer({ store: "eXtra", price: 389, url: "http://www.extra.com/en-sa/flip6", from: "serpapi" }),
    ]);
    expect(kept).toEqual([
      { store: "eXtra", domain: "extra.com", price: 389, was: null, url: null },
      { store: "Jarir", domain: "jarir.com", price: 399, was: null, url: "https://www.jarir.com/sa-en/flip6.html" },
    ]);
  });
  it("an offer inside Google's product cluster (API or panel) only needs no conflict: short or Arabic store titles stay", () => {
    const gray = { site: "amazon-sa", title: "JBL Flip 6 Gray Portable Bluetooth Speaker Waterproof Wireless" };
    const kept = keepOffers(gray, [
      // Recorded live from SerpApi (2026-11-28): Google's cluster for the gray Flip 6.
      offer({ store: "Abdulwahed", title: "JBL Flip 6 Speaker (JBLFLIP6GREY)", price: 349, was: 499, url: "https://www.abdulwahed.com/en/product/jbl-flip-6-speaker-jblflip6grey-p-1089301", from: "serpapi" }),
      offer({ store: "Carrefour KSA", title: "JBL Flip 6, Portable Bluetooth Speaker - Grey", price: 499, url: "https://www.carrefourksa.com/mafsau/en/bluetooth-speakers/jbl-speaker-bt-port-flip-6-grey/p/720889", from: "serpapi" }),
      offer({ store: "Doos.sa", title: "سماعة JBL Flip 6", price: 499, url: "https://doos.sa/en/market/product/1", from: "serpapi" }),
      offer({ store: "Saeel", title: "JBL Flip 7 Portable Speaker", price: 299, url: "https://www.saeel.sa/p/flip-7", from: "serpapi" }),
      offer({ store: "danube", title: "JBL Flip 6 + Case Logic Braided USB Type-C Charge & Sync bundle", price: 399, url: "https://www.danube.sa/p/1", from: "panel" }),
    ]);
    expect(kept.map((k) => k.store)).toEqual(["Abdulwahed", "Carrefour KSA", "Doos.sa"]);
  });
  it("a link or site must be a Saudi host, whatever the store's name (review round 1)", () => {
    const kept = keepOffers(our, [
      offer({ store: "Sharaf DG", price: 300, url: "https://uae.sharafdg.com/product/jbl-flip-6/", from: "serpapi" }),
      offer({ store: "Carrefour", price: 310, url: "https://www.carrefouruae.com/mafuae/en/p/1", from: "serpapi" }),
      offer({ store: "LuLu Hypermarket", price: 320, site: "https://www.luluhypermarket.com", from: "panel" }),
      offer({ store: "noon", price: 330, site: "https://www.noon.com", from: "panel" }),
      offer({ store: "Carrefour KSA", price: 399, url: "https://www.carrefourksa.com/mafsau/en/p/1", from: "serpapi" }),
    ]);
    expect(kept.map((k) => k.store)).toEqual(["Carrefour KSA"]);
  });
  it("with no link (the Google grid), the name must be Saudi-only or carry a Saudi marker", () => {
    const kept = keepOffers(our, [
      offer({ store: "noon", price: 300 }),
      offer({ store: "LuLu Hypermarket", price: 301 }),
      offer({ store: "Sharaf DG", price: 302 }),
      offer({ store: "Jarir Bookstore", price: 303 }),
      offer({ store: "Some Shop", price: 304 }),
      offer({ store: "Carrefour KSA", price: 399 }),
      offer({ store: "Saeel", price: 400 }),
      offer({ store: "desertcart.com.sa", price: 401 }),
    ]);
    expect(kept.map((k) => k.store)).toEqual(["Carrefour KSA", "Saeel", "desertcart.com.sa"]);
  });
  it("keeps one offer per store, its lowest, sorted by price", () => {
    const kept = keepOffers(our, [offer({ store: "Saeel", price: 499 }), offer({ store: "saeel", price: 479 }), offer({ store: "Danube", price: 450 })]);
    expect(kept.map((k) => [k.store, k.price])).toEqual([["Danube", 450], ["saeel", 479]]);
  });
});

describe("validateOffers", () => {
  it("builds the evidence: verdict, label, lowest other store and the source", () => {
    const r = validateOffers(our, [offer({ store: "Danube", price: 499 }), offer({ store: "Abdulwahed", price: 349, was: 499 })], { checkedAt: 1000, source: "google" });
    expect(r).toMatchObject({ verdict: "not-unique", label: VERDICT_LABELS["not-unique"], checkedAt: 1000, source: "google" });
    expect(r.lowest).toMatchObject({ store: "Abdulwahed", price: 349 });
    expect(r.others).toHaveLength(2);
  });
  it("says why there is no data", () => {
    expect(validateOffers(our, [], { checkedAt: 1, source: "serpapi" })).toMatchObject({ verdict: "no-data", reason: "few" });
  });
});
