import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { GshopEvidence, GshopPanel, INFO_CLOSED, SourceInfo, budgetLine, checkedAgo, infoOpen, infoReducer, type InfoEvent } from "@/app/components/GshopCheck";
import type { GshopResult } from "@/src/lib/gshop/validate";
import type { GshopStatus } from "@/src/lib/gshop/service";

const NOW = Date.UTC(2026, 10, 28, 12);
const amazon = { store: "Amazon.sa", domain: "amazon.sa", price: 329, was: null, url: "https://www.amazon.sa/dp/B1" };
const result = (o: Partial<GshopResult>): GshopResult => ({
  verdict: "not-unique",
  label: "Others match this price",
  source: "serpapi",
  checkedAt: NOW - 3 * 3_600_000,
  others: [amazon, { store: "Danube", domain: "danube.sa", price: 449, was: null, url: null }],
  lowest: amazon,
  ...o,
});
const evidence = (r: GshopResult) => renderToStaticMarkup(createElement(GshopEvidence, { result: r, now: NOW }));
const status = (o: { enabled?: boolean; left?: number; canCheck?: boolean; backedOffUntil?: number | null } = {}): GshopStatus => ({
  serpapi: { enabled: o.enabled ?? true, left: o.left ?? 212, budget: 240, exhausted: (o.left ?? 212) < 2 },
  google: { backedOffUntil: o.backedOffUntil ?? null, available: o.backedOffUntil ? false : true },
  auto: false,
  canCheck: o.canCheck ?? true,
});

describe("evidence line", () => {
  it("names the other stores and the lowest, with each store as a small safe link", () => {
    const out = evidence(result({}));
    expect(out).toContain("Google Shopping KSA: 2 other stores, lowest SAR 329 at Amazon.sa");
    expect(out).toContain('href="https://www.amazon.sa/dp/B1" target="_blank" rel="noopener noreferrer nofollow"');
    expect(out).toContain("amazon.sa");
    // A store whose link did not pass the checks: name and price as plain text.
    expect(out).toMatch(/<span class="gshop__store">Danube<\/span>/);
    expect(out).toContain('<span class="gshop__store">Danube</span> <span class="gshop__price">SAR 449</span><span class="gshop__domain"> (danube.sa)</span>');
    expect(out).not.toContain('href="null"');
  });
  it("never links an unsafe URL even if one slips into a result", () => {
    const evil = { store: "Evil", domain: "evil.example", price: 300, was: null, url: "https://evil.example/x" };
    const out = evidence(result({ others: [evil], lowest: evil }));
    expect(out).not.toContain("evil.example/x");
    expect(out).toContain("Evil");
  });
  it("shows each verdict as a quiet badge", () => {
    expect(evidence(result({ verdict: "confirmed", label: "Checked: confirmed lowest" }))).toContain('class="gshop__verdict gshop__verdict--confirmed">Checked: confirmed lowest');
    expect(evidence(result({}))).toContain('class="gshop__verdict gshop__verdict--not-unique">Others match this price');
    expect(evidence(result({ verdict: "fake-was", label: "Was-price not seen elsewhere" }))).toContain("gshop__verdict--fake-was");
    const none = evidence(result({ verdict: "no-data", label: "Not enough data", reason: "few", others: [], lowest: null }));
    expect(none).toContain("Not enough data");
    expect(none).toContain("Too few other Saudi stores found");
    expect(none).not.toContain("other stores, lowest");
  });
  it("keeps the source and the time behind an (i) button, not in the line", () => {
    const out = evidence(result({}));
    expect(out).not.toMatch(/<p class="gshop__line">[^<]*SerpApi/);
    expect(out).toContain('aria-label="Source"');
    const id = /aria-describedby="([^"]+)"/.exec(out)?.[1];
    expect(id).toBeTruthy();
    expect(out).toContain(`id="${id}" role="tooltip"`);
    expect(out).toContain("Google Shopping via SerpApi, checked 3 h ago");
    expect(evidence(result({ source: "google" }))).toContain("Google Shopping (google.com.sa), checked 3 h ago");
  });
});

describe("SourceInfo", () => {
  it("is a real button with a tooltip it describes itself by, hidden until opened", () => {
    const out = renderToStaticMarkup(createElement(SourceInfo, { text: "Google Shopping via SerpApi, checked 1 h ago" }));
    expect(out).toMatch(/^<span class="info"><button type="button" class="info__button" aria-label="Source" aria-describedby="[^"]+" aria-expanded="false">/);
    expect(out).toMatch(/role="tooltip" class="info__note" hidden=""/);
    expect(out).not.toContain(" title=");
  });
});

describe("the (i) note's state machine (review round 1)", () => {
  const run = (...events: InfoEvent[]) => events.reduce(infoReducer, INFO_CLOSED);
  it("hover opens, leaving closes", () => {
    expect(infoOpen(run("enter"))).toBe(true);
    expect(infoOpen(run("enter", "leave"))).toBe(false);
  });
  it("keyboard focus opens, blur closes", () => {
    expect(infoOpen(run("focus"))).toBe(true);
    expect(infoOpen(run("focus", "blur"))).toBe(false);
  });
  it("a tap (enter + focus + click) opens and stays open; a second tap closes", () => {
    expect(infoOpen(run("enter", "focus", "click"))).toBe(true);
    expect(infoOpen(run("enter", "focus", "click", "click"))).toBe(false);
  });
  it("a mouse click pins it: leaving does not close it, a second click does", () => {
    expect(infoOpen(run("enter", "focus", "click", "leave"))).toBe(true);
    expect(infoOpen(run("enter", "focus", "click", "leave", "enter", "click"))).toBe(false);
  });
  it("Esc closes it whatever opened it, until the pointer or focus comes back", () => {
    for (const how of [["enter"], ["focus"], ["enter", "focus", "click"]] as InfoEvent[][]) expect(infoOpen(run(...how, "escape"))).toBe(false);
    expect(infoOpen(run("enter", "escape", "leave", "enter"))).toBe(true);
  });
  it("closed by a click, it stays closed while the button keeps focus, even as the pointer leaves (browser run)", () => {
    expect(infoOpen(run("enter", "focus", "click", "click", "leave"))).toBe(false);
    expect(infoOpen(run("enter", "focus", "click", "click", "leave", "blur", "focus"))).toBe(true);
  });
  it("keyboard focus opens it again right after a press outside, even before the pointer's leave fires (browser run)", () => {
    expect(infoOpen(run("enter", "focus", "click", "click", "outside", "blur", "focus"))).toBe(true);
  });
  it("Esc then Tab away, with the pointer still leaving, stays closed (browser run)", () => {
    expect(infoOpen(run("enter", "focus", "escape", "blur"))).toBe(false);
  });
  it("a press outside closes a pinned note", () => {
    expect(infoOpen(run("enter", "focus", "click", "leave", "outside"))).toBe(false);
  });
});

describe("check panel", () => {
  const panel = (s: GshopStatus | null, r: GshopResult | null = null, extra: { busy?: boolean; error?: string } = {}) =>
    renderToStaticMarkup(createElement(GshopPanel, { status: s, result: r, busy: extra.busy ?? false, error: extra.error ?? null, onCheck: () => {}, now: NOW }));
  it("shows the button and the SerpApi checks left", () => {
    const out = panel(status());
    expect(out).toContain(">Check other stores</button>");
    expect(out).toContain("212 SerpApi checks left this month");
  });
  it("at the SerpApi limit says Google is used directly", () => {
    expect(panel(status({ left: 0 }))).toContain("SerpApi limit reached; using Google directly");
  });
  it("without a key, says so as plain text and still checks through Google", () => {
    const out = panel(status({ enabled: false, left: 240 }));
    expect(out).toContain("Add SERPAPI_KEY to enable SerpApi");
    expect(out).not.toMatch(/<a [^>]*SERPAPI/);
    expect(out).toMatch(/<button[^>]*>Check other stores<\/button>/);
    expect(out).not.toMatch(/<button[^>]*disabled[^>]*>Check other stores/);
  });
  it("disables the button with an explanation when nothing can be fetched", () => {
    const out = panel(status({ left: 0, canCheck: false, backedOffUntil: NOW + 7_200_000 }));
    expect(out).toMatch(/<button[^>]*disabled=""[^>]*aria-describedby="[^"]+"[^>]*>Check other stores<\/button>/);
    expect(out).toContain("Google asked for a CAPTCHA; checks pause until");
  });
  it("shows the result under the button once checked", () => {
    expect(panel(status(), result({}))).toContain("Google Shopping KSA: 2 other stores");
    expect(panel(status(), null, { busy: true })).toContain('aria-busy="true"');
    expect(panel(status(), null, { error: "Search for this product first" })).toContain("Search for this product first");
  });
  it("says 'too many checks' calmly: a status note, not an alert", () => {
    const out = renderToStaticMarkup(createElement(GshopPanel, { status: status(), result: null, busy: false, error: "Too many checks right now; try again later", calm: true, onCheck: () => {}, now: NOW }));
    expect(out).toContain('<p class="details__note" role="status">Too many checks right now; try again later</p>');
    expect(out).not.toContain('role="alert"');
  });
  it("words the budget and the time", () => {
    expect(budgetLine(status({ left: 1 }))).toBe("SerpApi limit reached; using Google directly");
    expect(checkedAgo(NOW - 30_000, NOW)).toBe("just now");
    expect(checkedAgo(NOW - 5 * 60_000, NOW)).toBe("5 min ago");
    expect(checkedAgo(NOW - 3 * 3_600_000, NOW)).toBe("3 h ago");
    expect(checkedAgo(NOW - 50 * 3_600_000, NOW)).toBe("2 d ago");
  });
});
