import { describe, expect, it } from "vitest";
import { decodeGoogleHref, isDeniedMerchant, isKsaHost, safeOfferLink, merchantDomain } from "@/src/lib/gshop/links";

describe("safeOfferLink: evidence links to other stores", () => {
  it("keeps https links on .sa hosts and known Saudi merchants", () => {
    expect(safeOfferLink("https://www.amazon.sa/dp/B09TEST")).toBe("https://www.amazon.sa/dp/B09TEST");
    expect(safeOfferLink("https://desertcart.com.sa/products/1")).toBe("https://desertcart.com.sa/products/1");
    expect(safeOfferLink("https://www.danube.sa/en/p/1")).toBe("https://www.danube.sa/en/p/1");
    expect(safeOfferLink("https://www.jarir.com/sa-en/jbl-flip-6.html")).toBe("https://www.jarir.com/sa-en/jbl-flip-6.html");
    expect(safeOfferLink("https://www.noon.com/saudi-en/flip-6/N1/p/")).toBe("https://www.noon.com/saudi-en/flip-6/N1/p/");
  });
  it("drops an evil host, even one that names a Saudi store", () => {
    expect(safeOfferLink("https://evil.example/amazon.sa")).toBeNull();
    expect(safeOfferLink("https://amazon.sa.evil.example/dp/1")).toBeNull();
    expect(safeOfferLink("https://notamazon.sa.evil.com/")).toBeNull();
    expect(safeOfferLink("https://www.amazon.ae/dp/1")).toBeNull();
  });
  it("drops userinfo, http, odd ports and non-web schemes", () => {
    expect(safeOfferLink("https://www.amazon.sa@evil.example/dp/1")).toBeNull();
    expect(safeOfferLink("https://user:pw@www.amazon.sa/dp/1")).toBeNull();
    expect(safeOfferLink("http://www.amazon.sa/dp/1")).toBeNull();
    expect(safeOfferLink("https://www.amazon.sa:8443/dp/1")).toBeNull();
    expect(safeOfferLink("javascript:alert(1)//www.amazon.sa")).toBeNull();
    expect(safeOfferLink("/url?q=https://www.amazon.sa/")).toBeNull();
    expect(safeOfferLink(42)).toBeNull();
    expect(safeOfferLink(`https://www.amazon.sa/${"x".repeat(2100)}`)).toBeNull();
  });
  it("drops punycode lookalikes, even under .sa", () => {
    // "аmazon.sa" with a Cyrillic а: the URL parser turns it into xn--mazon-3ve.sa.
    expect(safeOfferLink("https://аmazon.sa/dp/1")).toBeNull();
    expect(safeOfferLink("https://www.xn--mazon-3ve.sa/dp/1")).toBeNull();
    expect(safeOfferLink("https://xn--80ak6aa92e.com/")).toBeNull();
  });
  it("needs noon's Saudi storefront, not its UAE one", () => {
    expect(safeOfferLink("https://www.noon.com/uae-en/flip-6/N1/p/")).toBeNull();
  });
});

describe("Saudi or foreign store", () => {
  it("allows .sa and the known merchants, denies foreign TLDs and cross-border marketplaces", () => {
    expect(isKsaHost("www.saco.sa")).toBe(true);
    expect(isKsaHost("www.extra.com")).toBe(true);
    expect(isKsaHost("www.carrefourksa.com")).toBe(true);
    expect(isKsaHost("desertcart.ae")).toBe(false);
    expect(isKsaHost("www.desertcart.co.za")).toBe(false);
    expect(isKsaHost("www.ebay.com")).toBe(false);
    expect(isKsaHost("random-shop.com")).toBe(false);
  });
  it("denies merchants by name: eBay, AliExpress, foreign TLD names", () => {
    expect(isDeniedMerchant("eBay - k_item")).toBe(true);
    expect(isDeniedMerchant("Desertcart.ae")).toBe(true);
    expect(isDeniedMerchant("Jomla.ae")).toBe(true);
    expect(isDeniedMerchant("AliExpress")).toBe(true);
    expect(isDeniedMerchant("desertcart.com.sa")).toBe(false);
    expect(isDeniedMerchant("Abdulwahed")).toBe(false);
  });
  it("shows the link's domain without www", () => {
    expect(merchantDomain("https://www.amazon.sa/dp/1")).toBe("amazon.sa");
    expect(merchantDomain("nope")).toBeNull();
  });
});

describe("decodeGoogleHref: merchant URL from a Google link", () => {
  it("reads the q or url parameter of a /url redirect", () => {
    expect(decodeGoogleHref("/url?q=https://www.amazon.sa/dp/B1&sa=U&ved=x")).toBe("https://www.amazon.sa/dp/B1");
    expect(decodeGoogleHref("https://www.google.com.sa/url?url=https%3A%2F%2Fwww.noon.com%2Fsaudi-en%2Fx&rct=j")).toBe("https://www.noon.com/saudi-en/x");
  });
  it("drops ad clicks, other Google pages and relative links", () => {
    expect(decodeGoogleHref("/aclk?sa=l&ai=x&adurl=https://www.amazon.sa/")).toBeNull();
    expect(decodeGoogleHref("https://www.googleadservices.com/pagead/aclk?adurl=https://www.amazon.sa/")).toBeNull();
    expect(decodeGoogleHref("https://support.google.com/googleshopping/answer/9128904")).toBeNull();
    expect(decodeGoogleHref("/search?q=x")).toBeNull();
  });
  it("passes a direct merchant link through", () => {
    expect(decodeGoogleHref("https://www.amazon.sa/dp/B1")).toBe("https://www.amazon.sa/dp/B1");
  });
});
