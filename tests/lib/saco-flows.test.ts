import { describe, it, expect } from "vitest";
import { STORES, defaultSites, storeLabel } from "@/src/lib/stores";
import { sites } from "@/src/sites/registry";
import { readSearchInput } from "@/src/lib/search-request";
import { parseNewWatch } from "@/src/lib/alerts/validate";
import { rerunHref, valuesFromUrl } from "@/src/lib/rerun";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ResultCard from "@/app/components/ResultCard";
import type { Product } from "@/src/lib/types";

/** SACO (owner request): one registry entry reaches the search, chips/order, history and watch flows. */
describe("SACO store wiring", () => {
  const SITE_IDS = new Set(Object.keys(sites));

  it("is a registered, default-on store with its own logo, after Carrefour", () => {
    expect(sites["saco-sa"]).toMatchObject({ id: "saco-sa", label: "SACO" });
    const ids = STORES.map((s) => s.id);
    expect(ids.indexOf("saco-sa")).toBe(ids.indexOf("carrefour-sa") + 1);
    expect(STORES.find((s) => s.id === "saco-sa")).toMatchObject({ logo: "/stores/saco-sa.ico", defaultSelected: true });
    expect(defaultSites()).toContain("saco-sa");
    expect(storeLabel("saco-sa")).toBe("SACO");
  });

  it("the search API accepts it", async () => {
    const req = new Request("http://localhost:3000/api/search", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ query: "cordless drill", sites: ["saco-sa", "jarir"] }),
    });
    const r = await readSearchInput(req);
    expect("input" in r && r.input.sites).toEqual(["saco-sa", "jarir"]);
  });

  it("product and search watches accept it", () => {
    const product = parseNewWatch(
      { kind: "product", site: "saco-sa", productId: "103346", query: "air fryer", target: 230, url: "https://www.saco.sa/en/product/x-p-000000000000103346" },
      SITE_IDS,
    );
    expect(product).toMatchObject({ ok: true, value: { site: "saco-sa", sites: ["saco-sa"] } });
    const search = parseNewWatch({ kind: "search", query: "air fryer", sites: ["saco-sa"], target: 300 }, SITE_IDS);
    expect(search).toMatchObject({ ok: true, value: { sites: ["saco-sa"] } });
  });

  it("a branch-pickup-only listing cannot be watched (no Watch button, and the API refuses it)", () => {
    const p: Product = {
      site: "saco-sa", id: "103346", title: "Air fryer 4L", listPrice: 229, origPrice: null, discountPct: null, currency: "SAR", rating: null, soldCount: 0,
      image: "", url: "https://www.saco.sa/en/product/x-p-000000000000103346", finalPrice: 229, detailStatus: "ok", pickupOnly: true,
    };
    const pickup = renderToStaticMarkup(createElement(ResultCard, { product: p, query: "air fryer" }));
    expect(pickup).toContain("Branch pickup only");
    expect(pickup).not.toContain("card__watchbtn");
    const deliverable: Product = { ...p, pickupOnly: undefined };
    expect(renderToStaticMarkup(createElement(ResultCard, { product: deliverable, query: "air fryer" }))).toContain("card__watchbtn");
    const body = { kind: "product", site: "saco-sa", productId: "103346", query: "air fryer", target: 200, url: p.url };
    expect(parseNewWatch({ ...body, pickupOnly: true }, SITE_IDS)).toMatchObject({ ok: false });
    expect(parseNewWatch(body, SITE_IDS)).toMatchObject({ ok: true });
  });

  it("a history re-run keeps it", () => {
    const base = { query: "", sites: ["jarir"], sort: "price" as const, minPrice: "", maxPrice: "", minRating: "" };
    const href = rerunHref({ query: "air fryer", sites: ["saco-sa", "extra-sa"], sort: "price", filters: {} });
    expect(valuesFromUrl(href.slice(1), base)?.values.sites).toEqual(["saco-sa", "extra-sa"]);
  });
});
