import { describe, expect, it } from "vitest";
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { StoreTitleLink } from "@/app/alerts/AlertsView";

/** Alerts page titles: a stored link is drawn only when it is the watch's own store's page. */
describe("StoreTitleLink (Alerts page)", () => {
  const html = (site: string | null, url: string | null) => renderToStaticMarkup(h(StoreTitleLink, { site, url, children: "AirPods 4" }));

  it("links a product watch or alert to its own store's https page", () => {
    const out = html("jarir", "https://www.jarir.com/sa-en/J1");
    expect(out).toContain('<a href="https://www.jarir.com/sa-en/J1" target="_blank" rel="noopener noreferrer">AirPods 4');
    expect(out).toContain("(opens in a new tab)");
    expect(html("saco-sa", "https://www.saco.sa/en/product/x-p-000000000000103346")).toContain('href="https://www.saco.sa/en/product/x-p-000000000000103346"');
  });

  it("draws no link for a lookalike, another store's or a non-https url, or a search watch", () => {
    for (const [site, url] of [
      ["jarir", "https://www.jarir.com.evil.example/J1"],
      ["jarir", "https://www.noon.com/saudi-en/x/p/"],
      ["jarir", "http://www.jarir.com/sa-en/J1"],
      ["jarir", "javascript:alert(1)"],
      ["jarir", null],
      [null, "https://www.jarir.com/sa-en/J1"],
      ["nope", "https://www.jarir.com/sa-en/J1"],
    ] as const) {
      const out = html(site, url);
      expect(out).toBe("AirPods 4");
      expect(out).not.toContain("<a");
    }
  });
});
