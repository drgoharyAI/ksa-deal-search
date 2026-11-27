import { describe, expect, it } from "vitest";
import type { Product } from "@/src/lib/types";
import {
  countsOf, initStream, liveSummary, parseEvent, readEvents, reduceStream, settle, stopStream, storeEntries, storeEntryOf, streamFromPayload, takeLines,
  type StreamEvent,
} from "@/src/lib/search-stream";
import { HOME_ENTRY, historyMove } from "@/src/lib/rerun";

const p = (site: string, id: string): Product => ({
  site, id, title: `Item ${id}`, listPrice: 10, origPrice: null, discountPct: null, currency: "SAR", rating: null, soldCount: 0, image: "", url: "https://x.example/", detailStatus: "ok",
});

const run = (events: StreamEvent[], sites = ["jarir", "noon-sa", "amazon-sa"]) => events.reduce(reduceStream, initStream(sites));

describe("reduceStream", () => {
  it("starts with every store searching and no results", () => {
    const s = initStream(["jarir", "noon-sa"]);
    expect(storeEntries(s)).toEqual([
      { store: "jarir", state: "searching" },
      { store: "noon-sa", state: "searching" },
    ]);
    expect(s.results).toBeNull();
    expect(s.done).toBe(false);
  });

  it("a store line updates that store; a results event replaces the view; done settles", () => {
    const s = run([
      { type: "store", store: "jarir", state: "ok", count: 1 },
      { type: "results", products: [p("jarir", "1")], statuses: [{ site: "jarir", status: "ok" }] },
      { type: "store", store: "amazon-sa", state: "unavailable", retryAt: 123 },
      { type: "results", products: [p("jarir", "1")], statuses: [{ site: "jarir", status: "ok" }, { site: "amazon-sa", status: "blocked" }] },
    ]);
    expect(storeEntries(s)).toEqual([
      { store: "jarir", state: "ok", count: 1 },
      { store: "noon-sa", state: "searching" },
      { store: "amazon-sa", state: "unavailable", retryAt: 123 },
    ]);
    expect(s.results?.products).toHaveLength(1);
    expect(s.results).not.toHaveProperty("type");
    const done = reduceStream(s, { type: "done" });
    expect(done.done).toBe(true);
    // A store that never answered has failed.
    expect(storeEntries(done)[1]).toEqual({ store: "noon-sa", state: "failed" });
  });

  it("ok counts follow the current results (a later view can move a listing into a group)", () => {
    const s = run([
      { type: "store", store: "jarir", state: "ok", count: 1 },
      { type: "results", products: [p("jarir", "1")], groupExtras: [p("jarir", "2")], statuses: [] },
    ]);
    expect(storeEntries(s)[0]).toEqual({ store: "jarir", state: "ok", count: 2 });
    const emptied = reduceStream(s, { type: "results", products: [], statuses: [] });
    expect(storeEntries(emptied)[0]).toEqual({ store: "jarir", state: "empty" });
  });

  it("keeps the same results object when only a store line changes (no needless re-render of the grid)", () => {
    const a = run([{ type: "results", products: [p("jarir", "1")], statuses: [] }]);
    const b = reduceStream(a, { type: "store", store: "noon-sa", state: "failed" });
    expect(b.results).toBe(a.results);
  });

  it("an error event ends the stream with its message", () => {
    const s = run([{ type: "error", error: "The search failed; try again" }]);
    expect(s.done).toBe(true);
    expect(s.error).toBe("The search failed; try again");
  });

  it("settle leaves answered stores alone", () => {
    const s = settle(run([{ type: "store", store: "jarir", state: "empty" }]));
    expect(storeEntries(s).map((e) => e.state)).toEqual(["empty", "failed", "failed"]);
  });
});

describe("storeEntryOf and countsOf", () => {
  it("maps pipeline statuses to the five states; partial failures are flagged", () => {
    expect(storeEntryOf({ site: "a", status: "ok" }, 3)).toEqual({ store: "a", state: "ok", count: 3 });
    expect(storeEntryOf({ site: "a", status: "ok" }, 0)).toEqual({ store: "a", state: "empty" });
    expect(storeEntryOf({ site: "a", status: "ok", message: "1 of 2 requests failed" }, 2)).toEqual({ store: "a", state: "ok", count: 2, partial: true });
    expect(storeEntryOf({ site: "a", status: "blocked", message: "x" }, 0, 99)).toEqual({ store: "a", state: "unavailable", retryAt: 99 });
    expect(storeEntryOf({ site: "a", status: "blocked" }, 0)).toEqual({ store: "a", state: "unavailable" });
    expect(storeEntryOf({ site: "a", status: "error", message: "Store request failed" }, 0)).toEqual({ store: "a", state: "failed" });
  });
  it("counts products and group rows per store", () => {
    expect(countsOf({ products: [p("a", "1"), p("b", "2")], groupExtras: [p("a", "3")] })).toEqual({ a: 2, b: 1 });
  });
  it("streamFromPayload: a plain /api/search answer as a settled row", () => {
    const s = streamFromPayload(["a", "b", "c"], { products: [p("a", "1")], statuses: [{ site: "a", status: "ok" }, { site: "b", status: "error" }] });
    expect(s.done).toBe(true);
    expect(storeEntries(s)).toEqual([
      { store: "a", state: "ok", count: 1 },
      { store: "b", state: "failed" },
      { store: "c", state: "failed" },
    ]);
  });
});

describe("NDJSON reading", () => {
  it("takeLines keeps the partial last line", () => {
    expect(takeLines('{"a":1}\n\n{"b"')).toEqual({ lines: ['{"a":1}'], rest: '{"b"' });
  });
  it("parseEvent accepts the protocol and skips the rest", () => {
    expect(parseEvent('{"type":"done"}')).toEqual({ type: "done" });
    expect(parseEvent('{"type":"store","store":"a","state":"ok","count":2}')).toEqual({ type: "store", store: "a", state: "ok", count: 2 });
    // A state name this client does not know yet is kept (the status row labels it); junk is not.
    expect(parseEvent('{"type":"store","store":"a","state":"arabic-only"}')).toEqual({ type: "store", store: "a", state: "arabic-only" });
    expect(parseEvent('{"type":"store","store":"a","state":"<b>x</b>"}')).toBeNull();
    expect(parseEvent('{"type":"store","store":"a","state":42}')).toBeNull();
    expect(parseEvent('{"type":"results","products":"x"}')).toBeNull();
    expect(parseEvent("not json")).toBeNull();
    expect(parseEvent('{"type":"error"}')).toEqual({ type: "error", error: "The search failed; try again" });
  });
  it("readEvents splits events across chunk boundaries, in order", async () => {
    const text = '{"type":"store","store":"a","state":"searching"}\n{"type":"res' + 'ults","products":[],"statuses":[]}\n{"type":"done"}';
    const enc = new TextEncoder();
    const chunks = [text.slice(0, 20), text.slice(20, 61), text.slice(61)];
    const body = new ReadableStream<Uint8Array>({
      start(c) {
        for (const ch of chunks) c.enqueue(enc.encode(ch));
        c.close();
      },
    });
    const seen: string[] = [];
    expect(await readEvents(body, (e) => seen.push(e.type))).toBe(3);
    expect(seen).toEqual(["store", "results", "done"]);
  });
});

describe("liveSummary: milestones only", () => {
  it("says the same thing while stores answer, then one summary at the end", () => {
    const start = initStream(["a", "b", "c"]);
    expect(liveSummary(start, 0)).toBe("Searching 3 stores");
    const first = reduceStream(reduceStream(start, { type: "store", store: "a", state: "ok", count: 1 }), { type: "results", products: [p("a", "1")], statuses: [] });
    const second = reduceStream(reduceStream(first, { type: "store", store: "b", state: "failed" }), { type: "results", products: [p("a", "1")], statuses: [] });
    expect(liveSummary(first, 1)).toBe(liveSummary(second, 1));
    const done = reduceStream(second, { type: "done" });
    expect(liveSummary(done, 1)).toBe("1 result from 1 of 3 stores; 2 unavailable or failed");
  });
});

describe("historyMove: Back and Forward on the search page", () => {
  const key = "?q=jbl&sites=jarir&sort=price";
  it("the marked home entry shows the home", () => {
    expect(historyMove("", { [HOME_ENTRY]: true, __NA: true }, { stash: key, showingHome: false })).toBe("home");
  });
  it("Back to the stashed search's results entry, chips and all, restores the stashed results", () => {
    expect(historyMove(`${key}&store=jarir`, { __NA: true }, { stash: key, showingHome: true })).toBe("restore");
  });
  it("otherwise the chips follow the URL", () => {
    expect(historyMove("?store=jarir", null, { stash: null, showingHome: true })).toBe("sync");
    expect(historyMove("?store=jarir", null, { stash: key, showingHome: false })).toBe("sync");
    expect(historyMove("", null, { stash: key, showingHome: true })).toBe("sync");
    expect(historyMove("?store=jarir", null, { stash: key, showingHome: true })).toBe("sync");
  });
});

describe("stopStream: Stop, or go home while a search runs (fix round 1)", () => {
  it("ends the stream; stores that had not answered stay unanswered and are marked stopped", () => {
    const running = run([
      { type: "store", store: "jarir", state: "ok", count: 1 },
      { type: "results", products: [p("jarir", "1")], statuses: [{ site: "jarir", status: "ok" }] },
    ]);
    const stopped = stopStream(running);
    expect(stopped.done).toBe(true);
    expect(stopped.stopped).toBe(true);
    expect(storeEntries(stopped).map((e) => e.state)).toEqual(["ok", "searching", "searching"]);
    expect(stopped.results).toBe(running.results);
    // A finished search is left as it is.
    const done = reduceStream(running, { type: "done" });
    expect(stopStream(done)).toBe(done);
  });
  it("the live region says the search was stopped, not that stores are still searching", () => {
    const s = stopStream(run([{ type: "store", store: "jarir", state: "ok", count: 1 }, { type: "results", products: [p("jarir", "1")], statuses: [] }]));
    expect(liveSummary(s, 1)).toBe("Search stopped; 1 result from 1 of 3 stores");
  });
});
