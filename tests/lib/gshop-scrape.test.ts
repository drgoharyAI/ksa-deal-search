import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { scrapeGoogle, type ScrapePage } from "@/src/lib/gshop/scrape";

const fixture = (name: string) => fs.readFileSync(path.join(__dirname, "..", "fixtures", "gshop", name), "utf8");
const TITLE = "JBL Flip 6 Portable Bluetooth Speaker, Waterproof, Black";

type Opts = { html?: string; url?: string; panelHtml?: string; gotoThrows?: Error; afterClickUrl?: string; clickThrows?: Error };
function fakePage(o: Opts) {
  const log: string[] = [];
  let url = "about:blank";
  let clicked = false;
  const page: ScrapePage = {
    async goto(u: string) {
      log.push(`goto ${u}`);
      if (o.gotoThrows) throw o.gotoThrows;
      url = o.url ?? u;
      return null;
    },
    url: () => url,
    content: async () => (clicked && o.panelHtml ? o.panelHtml : (o.html ?? "")),
    async clickCard(index: number) {
      log.push(`click ${index}`);
      if (o.clickThrows) throw o.clickThrows;
      clicked = true;
      if (o.afterClickUrl) url = o.afterClickUrl;
    },
    wait: async () => {},
  };
  return { page, log };
}

const allow = async () => true;

describe("scrapeGoogle", () => {
  it("loads the fixed google.com.sa search, reads the grid, opens the best card's panel for links", async () => {
    const { page, log } = fakePage({
      html: fixture("google-results-jbl-flip-6.html"),
      panelHtml: fixture("google-panel-jbl-flip-6.html"),
    });
    const r = await scrapeGoogle(TITLE, page, { beforeLoad: allow, beforePanel: allow });
    expect(log[0]).toBe("goto https://www.google.com.sa/search?udm=28&hl=en&gl=sa&q=JBL+Flip+6+Portable+Bluetooth+Speaker+Waterproof");
    expect(log[1]).toMatch(/^click \d+$/);
    expect(r.kind).toBe("ok");
    if (r.kind !== "ok") return;
    expect(r.loads).toBe(2);
    expect(r.offers.filter((x) => x.from === "grid").length).toBe(67);
    expect(r.panel).toBe(true);
    expect(r.offers.filter((x) => x.from === "panel").map((x) => [x.store, x.price, x.was, x.site])).toEqual([
      ["Amazon.sa", 349, null, "https://www.amazon.sa"],
      ["Abdulwahed", 349, 499, "https://www.abdulwahed.com"],
      ["Samma3a.com", 407.51, null, "https://www.samma3a.com"],
    ]);
  });
  it("reports a CAPTCHA without opening any panel", async () => {
    const { page, log } = fakePage({ html: fixture("google-sorry.html"), url: "https://www.google.com.sa/sorry/index?continue=x" });
    const r = await scrapeGoogle(TITLE, page, { beforeLoad: allow, beforePanel: allow });
    expect(r).toEqual({ kind: "blocked", reason: "captcha", loads: 1 });
    expect(log).toHaveLength(1);
  });
  it("a timed-out or empty page is an error, never a block (no back-off)", async () => {
    const { page } = fakePage({ gotoThrows: Object.assign(new Error("Timeout 30000ms exceeded"), { name: "TimeoutError" }) });
    expect(await scrapeGoogle(TITLE, page, { beforeLoad: allow, beforePanel: allow })).toMatchObject({ kind: "error", loads: 1 });
    const empty = fakePage({ html: "<html><body></body></html>" });
    expect(await scrapeGoogle(TITLE, empty.page, { beforeLoad: allow, beforePanel: allow })).toMatchObject({ kind: "error", message: "empty page", loads: 1 });
  });
  it("does not load when the scrape budget says no, and skips the panel when it is spent", async () => {
    const a = fakePage({ html: fixture("google-results-jbl-flip-6.html") });
    expect(await scrapeGoogle(TITLE, a.page, { beforeLoad: async () => false, beforePanel: allow })).toEqual({ kind: "skipped", loads: 0 });
    expect(a.log).toHaveLength(0);
    const b = fakePage({ html: fixture("google-results-jbl-flip-6.html") });
    const r = await scrapeGoogle(TITLE, b.page, { beforeLoad: allow, beforePanel: async () => false });
    expect(r).toMatchObject({ kind: "ok", loads: 1 });
    expect(b.log).toHaveLength(1);
  });
  it("a CAPTCHA after the panel click is still a block", async () => {
    const { page } = fakePage({ html: fixture("google-results-jbl-flip-6.html"), afterClickUrl: "https://www.google.com.sa/sorry/index" });
    expect(await scrapeGoogle(TITLE, page, { beforeLoad: allow, beforePanel: allow })).toEqual({ kind: "blocked", reason: "captcha", loads: 2 });
  });
  it("a panel that will not open keeps the grid offers and is not a block (live, 2026-11-28)", async () => {
    const { page } = fakePage({ html: fixture("google-results-jbl-flip-6.html"), clickThrows: Object.assign(new Error("locator.click: Timeout 10000ms exceeded"), { name: "TimeoutError" }) });
    const r = await scrapeGoogle(TITLE, page, { beforeLoad: allow, beforePanel: allow });
    expect(r).toMatchObject({ kind: "ok", loads: 2, panel: false });
  });
});
