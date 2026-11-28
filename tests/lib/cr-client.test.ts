import { describe, expect, it, vi } from "vitest";
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { HOME_ENTRY, historyMove, searchKey, urlPlan } from "@/src/lib/rerun";
import { shareSearch } from "@/src/lib/share";
import { NO_FILTERS } from "@/src/lib/chips";
import { initStream, liveSummary, parseEvent, reduceStream, stoppedEarlyNotice, storeEntries, type StreamState } from "@/src/lib/search-stream";
import StatusBar, { storeStateText } from "@/app/components/StatusBar";
import { createSaveQueue, mergeSaved } from "@/app/components/Saved";
import { openAfterModeChange } from "@/app/components/ResultsLayout";
import { CheapestLink } from "@/app/history/HistoryView";
import type { Product } from "@/src/lib/types";

const form = (query: string) => ({ query, sites: ["jarir", "noon-sa"], sort: "price" as const, minPrice: "", maxPrice: "", minRating: "" });

describe("Back restores only the stashed search's own entry (code review finding 1)", () => {
  // Entries: "/" (home), ?q=A, "/" (go home), ?q=B. Back from B shows the home and stashes B.
  const urlA = shareSearch(form("airpods"));
  const urlB = shareSearch(form("jbl flip"), { ...NO_FILTERS, stores: ["jarir"] });
  const stash = searchKey(shareSearch(form("jbl flip")));
  it("a second Back, to A's entry, runs A: B's results never stand in for it", () => {
    expect(historyMove(urlA, null, { stash, showingHome: true })).toBe("run");
  });
  it("Forward to B's entry (chips and all) brings B's stashed results back", () => {
    expect(historyMove(urlB, null, { stash, showingHome: true })).toBe("restore");
  });
  it("the key is the search alone: chips, compare keys and key order do not change it", () => {
    expect(searchKey("?sort=price&q=jbl+flip&sites=jarir,noon-sa&store=jarir&cmp=jarir+1")).toBe(stash);
    expect(searchKey("?store=jarir")).toBeNull();
    expect(searchKey(shareSearch({ ...form("jbl flip"), sort: "discount" }))).not.toBe(stash);
  });
  it("the go-home entry still shows the home", () => {
    expect(historyMove("", { [HOME_ENTRY]: true }, { stash, showingHome: false })).toBe("home");
  });
});

describe("urlPlan: the URL never keeps a search the page is not showing (finding 2)", () => {
  const base = { chips: NO_FILTERS, cmp: [] as string[] };
  it("a failure or Stop with nothing to show (no search on screen) writes a clean '/'", () => {
    expect(urlPlan("?q=jbl&sites=jarir&sort=price&min=10", { ...base, form: null, committed: false, settled: false })).toEqual({ search: "", write: "replace", results: false });
  });
  it("keeps the chip and compare keys, drops every search key (old run=1 too)", () => {
    const plan = urlPlan("?q=jbl&sort=price&run=1&rating=4", { form: null, committed: false, settled: false, chips: { ...NO_FILTERS, stores: ["jarir"] }, cmp: ["jarir 1"] });
    expect(plan.search).toBe("?store=jarir&cmp=jarir+1");
  });
  it("a search started from the home waits for its first result (no entry for a failed one)", () => {
    expect(urlPlan("", { ...base, form: form("jbl"), committed: false, settled: false }).write).toBe("wait");
    expect(urlPlan("", { ...base, form: form("jbl"), committed: true, settled: false })).toEqual({ search: shareSearch(form("jbl")), write: "push", results: true });
  });
  it("stopped with zero results: no longer 'wait' forever, chip and sort changes write the URL", () => {
    const plan = urlPlan("", { form: form("jbl"), committed: false, settled: true, chips: { ...NO_FILTERS, minRating: 4 }, cmp: [] });
    expect(plan).toEqual({ search: "?stars=4", write: "replace", results: false });
  });
  it("on a results URL a running search replaces it at once", () => {
    expect(urlPlan("?q=old&sort=price", { ...base, form: form("jbl"), committed: false, settled: false }).write).toBe("replace");
  });
});

const prod = (site: string, id: string): Product => ({
  site, id, title: `Item ${id}`, listPrice: 10, origPrice: null, discountPct: null, currency: "SAR", rating: null, soldCount: 0, image: "", url: "https://x.example/", detailStatus: "ok",
});

describe("a server error after partial results is shown, not dropped (finding 5)", () => {
  const sites = ["jarir", "noon-sa", "extra-sa"];
  const partial = (): StreamState => {
    let s = initStream(sites);
    s = reduceStream(s, { type: "store", store: "jarir", state: "ok", count: 1 });
    s = reduceStream(s, { type: "store", store: "noon-sa", state: "empty" });
    s = reduceStream(s, { type: "results", products: [prod("jarir", "1")], statuses: [] });
    return reduceStream(s, { type: "error", error: "The search failed; try again" });
  };
  it("names how many stores the results came from", () => {
    expect(stoppedEarlyNotice(partial())).toBe("The search stopped early; showing results from 2 of 3 stores.");
  });
  it("says nothing for a stream that ended well, or broke before any results", () => {
    const ok = reduceStream(reduceStream(initStream(sites), { type: "results", products: [], statuses: [] }), { type: "done" });
    expect(stoppedEarlyNotice(ok)).toBeNull();
    expect(stoppedEarlyNotice(reduceStream(initStream(sites), { type: "error", error: "x" }))).toBeNull();
  });
});

describe("store status: short two-line cells, unknown states drawn gracefully (findings 8, 9)", () => {
  const html = (stores: Parameters<typeof StatusBar>[0]["stores"]) => renderToStaticMarkup(h(StatusBar, { stores, formatTime: () => "14:30" }));
  it("unavailable: a short label, the detail on line 2, the whole wording kept", () => {
    expect(storeStateText({ store: "jarir", state: "unavailable", retryAt: 1 }, false, () => "14:30")).toEqual({
      text: "Unavailable", detail: "try after 14:30", full: "Temporarily unavailable, try after 14:30",
    });
  });
  it("a state this client does not know: a label from its name, styled as 'other', counted as not answered", () => {
    const e = parseEvent('{"type":"store","store":"jarir","state":"arabic-only"}');
    expect(e).not.toBeNull();
    const s = reduceStream(initStream(["jarir"]), e!);
    const [entry] = storeEntries(s);
    expect(storeStateText(entry).text).toBe("Arabic only");
    const out = html([entry]);
    expect(out).toContain("storestatus__item--other");
    expect(out).toContain('title="Jarir: Arabic only"');
    expect(out).not.toContain("storestatus__pulse");
    expect(liveSummary(reduceStream(s, { type: "done" }), 0)).toBe("0 results from 0 of 1 store; 1 unavailable or failed");
  });
  it("visible lines are hidden from screen readers, which hear the full text once", () => {
    const out = html([{ store: "jarir", state: "unavailable", retryAt: 1 }]);
    expect(out).toContain('<span class="storestatus__state" aria-hidden="true">');
    expect(out).toContain('<span class="visually-hidden">Temporarily unavailable, try after 14:30</span>');
  });
});

describe("favourites: the first list merges with toggles in flight; toggles run in order (finding 4)", () => {
  it("mergeSaved lays this page's toggles over the server's list", () => {
    const local = new Map([["jarir:1", false], ["noon-sa:2", true]]);
    expect([...mergeSaved(["jarir:1", "extra-sa:3"], local)].sort()).toEqual(["extra-sa:3", "noon-sa:2"]);
    expect([...mergeSaved(["a"], new Map())]).toEqual(["a"]);
  });
  it("a quick save then unsave reaches the server in that order, and the list still says unsaved", async () => {
    const q = createSaveQueue();
    const calls: string[] = [];
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const post = vi.fn(async () => {
      calls.push("POST start");
      await gate;
      calls.push("POST end");
      return null;
    });
    const del = vi.fn(async () => {
      calls.push("DELETE");
      return null;
    });
    const a = q.run("jarir:1", true, post, () => {});
    const b = q.run("jarir:1", false, del, () => {});
    await Promise.resolve();
    // The list fetched meanwhile (it still has the product) is overridden by the latest wish.
    expect(mergeSaved(["jarir:1"], q.local).has("jarir:1")).toBe(false);
    expect(del).not.toHaveBeenCalled();
    release();
    await Promise.all([a, b]);
    expect(calls).toEqual(["POST start", "POST end", "DELETE"]);
    expect(mergeSaved(["jarir:1"], q.local).has("jarir:1")).toBe(false);
  });
  it("a failure is reverted only when it was the latest toggle", async () => {
    const q = createSaveQueue();
    const reverts: string[] = [];
    const first = q.run("k", true, async () => "Could not save; try again", () => reverts.push("first"));
    const second = q.run("k", false, async () => null, () => reverts.push("second"));
    expect(await first).toBe("Could not save; try again");
    expect(await second).toBeNull();
    expect(reverts).toEqual([]);
    const third = q.run("k", true, async () => "nope", () => reverts.push("third"));
    expect(await third).toBe("nope");
    expect(reverts).toEqual(["third"]);
    expect(q.local.get("k")).toBe(false);
  });
});

describe("filter sheet: a mode change closes it for good (finding 6)", () => {
  it("rotating sheet -> panel -> sheet never brings the sheet back", () => {
    const afterRotate = openAfterModeChange("sheet", "sheet", "panel");
    expect(afterRotate).toBeNull();
    expect(openAfterModeChange(afterRotate, "panel", "sheet")).toBeNull();
  });
  it("no change keeps it as it is", () => {
    expect(openAfterModeChange("sheet", "sheet", "sheet")).toBe("sheet");
  });
});

describe("History: the cheapest match links only to its own store (finding 7)", () => {
  it("an allowed store page is a link; anything else is plain text", () => {
    const ok = renderToStaticMarkup(h(CheapestLink, { cheapest: { site: "jarir", url: "https://www.jarir.com/p/1", title: "JBL" } }));
    expect(ok).toContain('href="https://www.jarir.com/p/1"');
    for (const url of ["https://evil.example/p", "javascript:alert(1)", "http://www.jarir.com/p/1"]) {
      const out = renderToStaticMarkup(h(CheapestLink, { cheapest: { site: "jarir", url, title: "JBL" } }));
      expect(out).not.toContain("href");
      expect(out).toContain("JBL");
    }
  });
});

describe("English-only stores: the 'unsupported' status (follow-up 1)", async () => {
  const { storeEntryOf, allUnsupported, ENGLISH_ONLY_EMPTY, streamFromPayload } = await import("@/src/lib/search-stream");
  it("maps to its own state, labelled 'English only' with the server's detail", () => {
    const e = storeEntryOf({ site: "jarir", status: "unsupported", message: "English search terms only" }, 0);
    expect(e).toEqual({ store: "jarir", state: "unsupported" });
    expect(storeStateText(e)).toEqual({ text: "English only", detail: "English search terms only", full: "English only, English search terms only" });
    expect(renderToStaticMarkup(h(StatusBar, { stores: [e] }))).toContain("storestatus__item--unsupported");
  });
  it("every store unsupported: the English-only empty state, not 'No products matched'", () => {
    const statuses = ["jarir", "noon-sa"].map((site) => ({ site, status: "unsupported" as const, message: "English search terms only" }));
    const s = streamFromPayload(["jarir", "noon-sa"], { products: [], statuses });
    expect(allUnsupported(s)).toBe(true);
    expect(ENGLISH_ONLY_EMPTY.title).toBe("Search in English, e.g. 'wireless earbuds'");
    expect(liveSummary(s, 0)).toBe(ENGLISH_ONLY_EMPTY.title);
    const mixed = streamFromPayload(["jarir", "noon-sa"], { products: [], statuses: [statuses[0], { site: "noon-sa", status: "ok" }] });
    expect(allUnsupported(mixed)).toBe(false);
  });
});

describe("safety caps are shown kindly (follow-up 2)", async () => {
  const { responseError } = await import("@/app/components/ui/ErrorState");
  const { searchRefusal } = await import("@/src/lib/search-stream");
  const { postWatch } = await import("@/app/components/WatchForm");
  const { sendSave } = await import("@/app/components/Saved");
  const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  it("uses the server's error string for every cap", async () => {
    const caps: [number, string][] = [
      [503, "Busy, try again in a moment"],
      [429, "Wait a minute before sending another test"],
      [409, "You can keep up to 100 price alerts. Delete one to add another."],
      [429, "Wait a minute before changing this alert again"],
      [413, "The request is too large"],
    ];
    for (const [status, error] of caps) expect(await responseError(json(status, { error }), "fallback")).toBe(error);
  });
  it("falls back to words for the status when the body is not JSON, else the caller's text", async () => {
    expect(await responseError(new Response("<html>", { status: 503 }), "x")).toBe("Busy, try again in a moment");
    expect(await responseError(new Response("", { status: 413 }), "x")).toBe("The request is too large");
    expect(await responseError(new Response("", { status: 500 }), "The search failed")).toBe("The search failed");
  });
  it("a busy (503) or refused search is shown, never retried on /api/search; a 502 still falls back", () => {
    expect(searchRefusal(503)).toBe(true);
    expect(searchRefusal(413)).toBe(true);
    expect(searchRefusal(429)).toBe(true);
    expect(searchRefusal(502)).toBe(false);
    expect(searchRefusal(500)).toBe(false);
  });
  it("watch POST and save pass the cap message through", async () => {
    const real = globalThis.fetch;
    globalThis.fetch = vi.fn(async () => json(409, { error: "You can keep up to 100 price alerts. Delete one to add another." }));
    try {
      expect(await postWatch({ kind: "search" })).toBe("You can keep up to 100 price alerts. Delete one to add another.");
    } finally {
      globalThis.fetch = real;
    }
    const send = vi.fn(async () => json(413, { error: "The request is too large" })) as unknown as typeof fetch;
    expect(await sendSave({ site: "jarir", id: "1", title: "t", price: 1, currency: "SAR", url: "https://www.jarir.com/1", image: "" }, true, send)).toBe("The request is too large");
  });
});

describe("History: a 'from' cheapest price says so (follow-up 3)", async () => {
  const { CheapestPrice } = await import("@/app/history/HistoryView");
  it("prefixes 'from' only when the stored match is a from price", () => {
    const from = renderToStaticMarkup(h(CheapestPrice, { cheapest: { price: 99, currency: "SAR", from: true } }));
    const fixed = renderToStaticMarkup(h(CheapestPrice, { cheapest: { price: 99, currency: "SAR" } }));
    expect(from).toMatch(/>from .*99/);
    expect(fixed).not.toContain("from");
    expect(fixed).toContain("99");
  });
});
