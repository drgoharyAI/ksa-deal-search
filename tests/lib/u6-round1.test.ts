import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { initStream, liveSummary, reduceStream, showStoppedEmpty, STOPPED_EMPTY, stopStream } from "@/src/lib/search-stream";
import { clearResultsUrlMark, RESULTS_URL_ATTR, RESULTS_URL_MARK_SCRIPT, shouldClearMark } from "@/src/lib/results-url-mark";
import ResultTiers, { RESULTS_STEP } from "@/app/components/ResultTiers";
import type { Product } from "@/src/lib/types";

describe("Stop before any store found a result (U6 round 1)", () => {
  const sites = ["jarir", "noon-sa", "saco-sa"];
  it("shows the stopped empty state, not 'No products matched'", () => {
    // noon answered "unavailable" (an empty results payload), then the user pressed Stop.
    const blocked = reduceStream(initStream(sites), { type: "store", store: "noon-sa", state: "unavailable" });
    const withEmpty = reduceStream(blocked, { type: "results", products: [], statuses: [], reason: "No products matched your search and filters" });
    const stopped = stopStream(withEmpty);
    expect(showStoppedEmpty(stopped, 0)).toBe(true);
    expect(STOPPED_EMPTY.title).toBe("The search was stopped before any results came");
    expect(liveSummary(stopped, 0)).toBe("Search stopped; 0 results from 0 of 3 stores");
  });
  it("not after a search that finished on its own, nor once a product came", () => {
    const done = reduceStream(reduceStream(initStream(sites), { type: "results", products: [], statuses: [] }), { type: "done" });
    expect(showStoppedEmpty(done, 0)).toBe(false);
    expect(showStoppedEmpty(stopStream(initStream(sites)), 3)).toBe(false);
  });
});

describe("the pre-paint results-URL mark", () => {
  const runScript = (search: string) => {
    const attrs = new Map<string, string>();
    const documentElement = { setAttribute: (k: string, v: string) => attrs.set(k, v), removeAttribute: (k: string) => attrs.delete(k) };
    // The script reads the globals `location` and `document`; give it stand-ins.
    // eslint-disable-next-line @typescript-eslint/no-implied-eval -- the exact inline script app/layout.tsx ships
    const script = new Function("location", "document", RESULTS_URL_MARK_SCRIPT) as (loc: { search: string }, doc: { documentElement: typeof documentElement }) => void;
    script({ search }, { documentElement });
    return { attrs, documentElement };
  };
  it("marks <html> only for a URL with a non-blank query", () => {
    expect(runScript("?q=air+fryer&sort=price").attrs.has(RESULTS_URL_ATTR)).toBe(true);
    expect(runScript("").attrs.has(RESULTS_URL_ATTR)).toBe(false);
    expect(runScript("?q=%20&store=jarir").attrs.has(RESULTS_URL_ATTR)).toBe(false);
  });
  it("is cleared once a search starts or results show, and kept on the idle home", () => {
    expect(shouldClearMark("idle", true)).toBe(false);
    expect(shouldClearMark("loading", false)).toBe(true);
    expect(shouldClearMark("error", true)).toBe(true);
    expect(shouldClearMark("done", false)).toBe(true);
    const { attrs, documentElement } = runScript("?q=jbl");
    clearResultsUrlMark(documentElement);
    expect(attrs.has(RESULTS_URL_ATTR)).toBe(false);
  });
});

describe("ResultTiers: the page can own the shown-card count (Back and Forward restore it)", () => {
  const P = (id: string): Product => ({
    site: "aliexpress", id, title: `Item ${id}`, listPrice: 10, origPrice: null, discountPct: null, currency: "SAR",
    rating: null, soldCount: 0, image: "", url: "https://example.com", detailStatus: "ok", matchScore: 0.9,
  });
  const many = Array.from({ length: RESULTS_STEP * 3 }, (_, i) => P(`m${i}`));
  it("draws `limit` cards when given, and keeps a polite status region for 'Showing N of M'", () => {
    const out = renderToStaticMarkup(createElement(ResultTiers, { products: many, limit: RESULTS_STEP * 2, onLimit: () => {} }));
    expect(out.split("<article").length - 1).toBe(RESULTS_STEP * 2);
    expect(out).toContain(`, ${RESULTS_STEP} not shown yet`);
    expect(out).toContain('<p class="visually-hidden" role="status"></p>');
  });
});
