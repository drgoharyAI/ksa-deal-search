import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { bestCard, detectBlock, googleSearchUrl, panelOffers, parseCardLabel, parsePanelHtml, parseResultsHtml } from "@/src/lib/gshop/scrape-parse";

const fixture = (name: string) => fs.readFileSync(path.join(__dirname, "..", "fixtures", "gshop", name), "utf8");
const RESULTS = fixture("google-results-jbl-flip-6.html");
const TITLE = "JBL Flip 6 Gray Portable Bluetooth Speaker Waterproof Wireless";

describe("parseCardLabel: one results card's aria-label", () => {
  it("reads title, price, was-price and store", () => {
    expect(parseCardLabel("JBL Flip 6 Portable Bluetooth Speaker Waterproof Wireless.  SALE. Current price: SAR 349.00. Was SAR 499. Abdulwahed & more. Rated 4.5 out of 5. 2.9K reviews. Go to product viewer for this item.")).toEqual({
      title: "JBL Flip 6 Portable Bluetooth Speaker Waterproof Wireless",
      price: 349,
      was: 499,
      foreign: null,
      store: "Abdulwahed",
      more: true,
      used: false,
    });
  });
  it("splits a foreign price from the store name glued to it", () => {
    expect(parseCardLabel("JBL Flip 6 Waterproof Portable Bluetooth Speaker.  Current price: SAR 519.86. Foreign price: AED 509Desertcart.ae & more. Rated 4.6 out of 5. 11K reviews. Go to product viewer for this item.")).toMatchObject({ price: 519.86, foreign: "AED 509", store: "Desertcart.ae" });
    expect(parseCardLabel("X.  Current price: SAR 410.69. Foreign price: €100Links. Go to product viewer for this item.")).toMatchObject({ foreign: "€100", store: "Links" });
    expect(parseCardLabel("X.  Current price: SAR 431.34. Foreign price: NGN 156,000Foretec Investment. Go to product viewer for this item.")).toMatchObject({ foreign: "NGN 156,000", store: "Foretec Investment" });
  });
  it("drops the returns note, flags pre-owned, reads thousands", () => {
    expect(parseCardLabel("JBL Flip 6.  Current price: SAR 1,686.00. desertcart.com.sa & more. 14-day returns. Go to product viewer for this item.")).toMatchObject({ price: 1686, store: "desertcart.com.sa", more: true });
    expect(parseCardLabel("Jbl Flip6 Orange.  Current price: SAR 921.99. Pre-owned.eBay - hiyori_global. Go to product viewer for this item.")).toMatchObject({ used: true, store: "eBay - hiyori_global" });
  });
  it("strips bidi marks around Arabic store names", () => {
    expect(parseCardLabel("JBL FLIP6 White.  Current price: SAR 429.00. \u202bالشامل كمبيوتر\u202c\u200e. Rated 4.6 out of 5. 11K reviews. Go to product viewer for this item.")?.store).toBe("الشامل كمبيوتر");
  });
  it("drops Google's tag before the price (SALE, PRICE DROP)", () => {
    expect(parseCardLabel("JBL Flip 6 Waterproof Portable Bluetooth Speaker.  PRICE DROP. Current price: SAR 517.81. Was SAR 641. Desertcart.ae & more. Rated 4.6 out of 5. 11K reviews. Go to product viewer for this item.")).toMatchObject({
      title: "JBL Flip 6 Waterproof Portable Bluetooth Speaker",
      was: 641,
      store: "Desertcart.ae",
    });
  });
  it("gives null for anything else", () => {
    expect(parseCardLabel("Rated 4.6 out of 5")).toBeNull();
    expect(parseCardLabel("X. Current price: USD 10. Go to product viewer for this item.")).toBeNull();
  });
});

describe("parseResultsHtml: the saved google.com.sa page", () => {
  const cards = parseResultsHtml(RESULTS);
  it("finds every product card in page order, with its ids", () => {
    expect(cards).toHaveLength(67);
    expect(cards[0]).toMatchObject({ index: 0, store: "Abdulwahed", price: 349, was: 499, cid: "5053887856104557232", oid: "9022825959567264609" });
    expect(cards.filter((c) => c.foreign).length).toBeGreaterThan(10);
  });
  it("picks the cluster that best matches our title, preferring one with more stores", () => {
    const best = bestCard(cards, TITLE);
    expect(best?.title).toMatch(/JBL Flip 6/);
    expect(best?.more).toBe(true);
    expect(best?.foreign).toBeNull();
  });
});

describe("detectBlock: CAPTCHA, consent and empty pages", () => {
  const ok = { url: "https://www.google.com.sa/search?udm=28&q=jbl", html: RESULTS };
  it("passes a normal results page and a real no-results page", () => {
    expect(detectBlock(ok)).toBeNull();
    expect(detectBlock({ url: ok.url, html: fixture("google-no-results.html") })).toBeNull();
  });
  it("flags /sorry/, unusual traffic, a reCAPTCHA iframe, a consent wall and an empty page", () => {
    expect(detectBlock({ url: "https://www.google.com.sa/sorry/index?continue=x", html: "" })).toBe("captcha");
    expect(detectBlock({ url: ok.url, html: fixture("google-sorry.html") })).toBe("captcha");
    expect(detectBlock({ url: ok.url, html: fixture("google-recaptcha-iframe.html") })).toBe("captcha");
    expect(detectBlock({ url: "https://consent.google.com/m?continue=x", html: fixture("google-consent.html") })).toBe("consent");
    expect(detectBlock({ url: ok.url, html: fixture("google-consent.html") })).toBe("consent");
    expect(detectBlock({ url: ok.url, html: "<html><body></body></html>" })).toBe("empty");
  });
});

describe("the opened product panel (live page, 2026-11-28)", () => {
  const PANEL = fixture("google-panel-jbl-flip-6.html");
  it("reads each store row, not the sponsored units", () => {
    const rows = parsePanelHtml(PANEL);
    expect(rows.map((r) => [r.store, r.site])).toEqual([
      ["Amazon.sa", "https://www.amazon.sa"],
      ["Abdulwahed", "https://www.abdulwahed.com"],
      ["Samma3a.com", "https://www.samma3a.com"],
    ]);
    expect(rows[1].href.startsWith("/goto?url=")).toBe(true);
  });
  it("turns rows into offers: price, was-price, foreign price, the store's domain, no opaque Google link", () => {
    const offers = panelOffers(parsePanelHtml(PANEL), TITLE);
    expect(offers).toEqual([
      { store: "Amazon.sa", title: "JBL Flip 6 Gray Portable Bluetooth Speaker Waterproof Wireless", price: 349, currency: "SAR", foreign: false, was: null, url: null, site: "https://www.amazon.sa", from: "panel" },
      { store: "Abdulwahed", title: "JBL Flip 6 Speaker (JBLFLIP6GREY)", price: 349, currency: "SAR", foreign: false, was: 499, url: null, site: "https://www.abdulwahed.com", from: "panel" },
      { store: "Samma3a.com", title: "JBL Flip 6 Portable Waterproof Wireless Speaker - Grey", price: 407.51, currency: "SAR", foreign: true, was: null, url: null, site: "https://www.samma3a.com", from: "panel" },
    ]);
  });
  it("keeps a decodable /url?q= merchant link, and never an ad click", () => {
    const rows = [
      { store: "Jarir", href: "/url?q=https://www.jarir.com/sa-en/flip6.html&sa=U", site: null, lines: ["Jarir", "SAR 399.00", "Was SAR 499.00", "JBL Flip 6 Speaker"] },
      { store: "Saeel", href: "/aclk?sa=l&adurl=https://www.saeel.sa/x", site: "https://www.saeel.sa", lines: ["Saeel", "SAR 274.00"] },
      { store: "Danube", href: "/goto?url=X", site: null, lines: ["Danube", "no price"] },
    ];
    expect(panelOffers(rows, TITLE)).toEqual([
      { store: "Jarir", title: "JBL Flip 6 Speaker", price: 399, currency: "SAR", foreign: false, was: 499, url: "https://www.jarir.com/sa-en/flip6.html", site: null, from: "panel" },
      { store: "Saeel", title: TITLE, price: 274, currency: "SAR", foreign: false, was: null, url: null, site: "https://www.saeel.sa", from: "panel" },
    ]);
  });
});

describe("googleSearchUrl", () => {
  it("is the fixed google.com.sa shopping search", () => {
    expect(googleSearchUrl("jbl flip 6")).toBe("https://www.google.com.sa/search?udm=28&hl=en&gl=sa&q=jbl+flip+6");
  });
});
