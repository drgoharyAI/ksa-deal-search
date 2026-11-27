import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ResultCard, { dealExplanation, trendChange } from "@/app/components/ResultCard";
import type { Product } from "@/src/lib/types";

const P: Product = {
  site: "amazon-sa", id: "A", title: "Kettle", listPrice: 80, origPrice: null, discountPct: null, currency: "SAR",
  rating: null, soldCount: 0, image: "", url: "https://example.com", finalPrice: 80, detailStatus: "ok",
};
const html = (p: Product) => renderToStaticMarkup(createElement(ResultCard, { product: p }));

describe("deal badge text", () => {
  it("explains each badge, and names the rule behind a fake deal", () => {
    expect(dealExplanation({ badge: "lowest-30d", label: "Lowest in 30 days" })).toBe("Lowest price we've seen in 30 days");
    expect(dealExplanation({ badge: "fake-deal", label: "Fake deal", reason: "Unrealistic 'was' price" })).toBe("Unrealistic 'was' price");
  });
  it("words the weekly change for sight and for screen readers", () => {
    expect(trendChange(-12)).toEqual({ arrow: "↓", spoken: "Down ", text: "12% vs last week" });
    expect(trendChange(5)).toEqual({ arrow: "↑", spoken: "Up ", text: "5% vs last week" });
    expect(trendChange(0).text).toBe("Same as last week");
  });
});

describe("card", () => {
  it("shows nothing extra without enough data", () => {
    const out = html(P);
    expect(out).not.toContain("deal--");
    expect(out).not.toContain("<svg");
  });
  it("shows the badge with its explanation, the sparkline and the change", () => {
    const out = html({ ...P, deal: { badge: "fake-deal", label: "Fake deal", reason: "The 'was' price was never charged" }, trend: { points: [100, 90, 88], changePct7d: -12 } });
    expect(out).toContain('class="deal deal--fake-deal"');
    expect(out).toContain("title=\"The &#x27;was&#x27; price was never charged\"");
    expect(out).toContain('aria-label="Lowest price per day for Kettle, 3 days"');
    expect(out).toContain("12% vs last week");
    expect(out).not.toContain("spark__target");
  });
});
