import type { GroupRef } from "@/src/lib/match/group";
import type { Product, SiteStatus } from "@/src/lib/types";

/**
 * Client-safe: the progressive search protocol (POST /api/search/stream) and the page's reducer
 * over it. The response is NDJSON, one event per line:
 *
 *   {"type":"store","store":"jarir","state":"searching"}            one per store, first
 *   {"type":"store","store":"jarir","state":"ok","count":12}         when that store answered
 *   {"type":"results", ...SearchPayload}                             after each store answered
 *   {"type":"done"}                                                  last
 *
 * A "results" event is the whole current view model (ranked, filtered, deduped and grouped over the
 * stores answered so far), in the same shape as the POST /api/search body; the last one equals it.
 * {"type":"error","error":"…"} (a plain message, never internal detail) replaces "done" when the
 * search broke on the server.
 */

/**
 * What a store's line in the status row says:
 * - searching: asked, no answer yet;
 * - ok: answered with `count` listings in the current results;
 * - empty: answered, nothing in the results;
 * - unavailable: refusing us (blocked, rate-limited or backing off); `retryAt` (ms) when known;
 * - failed: the request failed or the answer could not be read.
 */
type StoreState = "searching" | "ok" | "empty" | "unavailable" | "failed";

export type StoreEntry = {
  store: string;
  state: StoreState;
  /** Listings from this store in the current results (ok only). */
  count?: number;
  /** When the store's back-off ends (ms since epoch), when known (unavailable only). */
  retryAt?: number;
  /** Some of the store's requests failed, but others answered (ok and empty only). */
  partial?: true;
};

/** The POST /api/search body. */
export type SearchPayload = {
  products: Product[];
  statuses: SiteStatus[];
  queryTokens?: string[][];
  groups?: GroupRef[];
  groupExtras?: Product[];
  reason?: string;
};

type StoreEvent = { type: "store" } & StoreEntry;
type ResultsEvent = { type: "results" } & SearchPayload;
export type StreamEvent = StoreEvent | ResultsEvent | { type: "done" } | { type: "error"; error: string };

const STATES = new Set<StoreState>(["searching", "ok", "empty", "unavailable", "failed"]);

/** Listings per store in a payload: every card's members, group rows included. */
export function countsOf(payload: Pick<SearchPayload, "products" | "groupExtras">): Record<string, number> {
  const c: Record<string, number> = {};
  for (const p of [...payload.products, ...(payload.groupExtras ?? [])]) c[p.site] = (c[p.site] ?? 0) + 1;
  return c;
}

/** A store's settled state from its pipeline status and its listings in the results. */
export function storeEntryOf(status: SiteStatus, count: number, retryAt?: number): StoreEntry {
  if (status.status === "blocked") return retryAt !== undefined ? { store: status.site, state: "unavailable", retryAt } : { store: status.site, state: "unavailable" };
  if (status.status === "error") return { store: status.site, state: "failed" };
  const base: StoreEntry = count > 0 ? { store: status.site, state: "ok", count } : { store: status.site, state: "empty" };
  return status.message ? { ...base, partial: true } : base;
}

/** One NDJSON line as an event, or null when it is not one this client understands. */
export function parseEvent(line: string): StreamEvent | null {
  let v: unknown;
  try {
    v = JSON.parse(line);
  } catch {
    return null;
  }
  if (!v || typeof v !== "object") return null;
  const e = v as Record<string, unknown>;
  switch (e.type) {
    case "store":
      return typeof e.store === "string" && STATES.has(e.state as StoreState) ? (e as StoreEvent) : null;
    case "results":
      return Array.isArray(e.products) && Array.isArray(e.statuses) ? (e as ResultsEvent) : null;
    case "done":
      return { type: "done" };
    case "error":
      return { type: "error", error: typeof e.error === "string" ? e.error : "The search failed; try again" };
    default:
      return null;
  }
}

/** Splits a growing NDJSON buffer: the complete lines, and the partial line kept for later. */
export function takeLines(buffer: string): { lines: string[]; rest: string } {
  const parts = buffer.split("\n");
  const rest = parts.pop() ?? "";
  return { lines: parts.filter((l) => l.trim() !== ""), rest };
}

export type StreamState = {
  /** The stores asked, in the form's order. */
  order: string[];
  stores: Record<string, StoreEntry>;
  /** The latest view model, or null before the first store answered. */
  results: SearchPayload | null;
  /** "done" arrived (or the stream ended and the rest was settled as failed). */
  done: boolean;
  error?: string;
  /** The user stopped the search (or left it): stores still "searching" never answered. */
  stopped?: true;
};

export function initStream(sites: string[]): StreamState {
  return { order: [...sites], stores: Object.fromEntries(sites.map((s) => [s, { store: s, state: "searching" }])), results: null, done: false };
}

function omitType<T extends { type: string }>(e: T): Omit<T, "type"> {
  const o: Partial<T> = { ...e };
  delete o.type;
  return o as Omit<T, "type">;
}

/** The page's reducer: a store line updates that store, a results event replaces the view model. */
export function reduceStream(s: StreamState, e: StreamEvent): StreamState {
  switch (e.type) {
    case "store": {
      const order = s.order.includes(e.store) ? s.order : [...s.order, e.store];
      return { ...s, order, stores: { ...s.stores, [e.store]: omitType(e) } };
    }
    case "results":
      return { ...s, results: omitType(e) };
    case "done":
      return settle(s);
    case "error":
      return { ...settle(s), error: e.error };
  }
}

/** Ends the stream: a store still "searching" never answered, so it failed. */
export function settle(s: StreamState): StreamState {
  const stores = { ...s.stores };
  for (const id of s.order) if (stores[id]?.state === "searching") stores[id] = { store: id, state: "failed" };
  return { ...s, stores, done: true };
}

/**
 * Ends a search the user stopped (Stop, or "go home" while it ran): what arrived stays, and the
 * stores that had not answered keep their state, shown as "Stopped".
 */
export function stopStream(s: StreamState): StreamState {
  return s.done ? s : { ...s, done: true, stopped: true };
}

/** The settled status row for a plain (non-streamed) /api/search answer. */
export function streamFromPayload(sites: string[], payload: SearchPayload): StreamState {
  const counts = countsOf(payload);
  const stores: Record<string, StoreEntry> = {};
  for (const st of payload.statuses) stores[st.site] = storeEntryOf(st, counts[st.site] ?? 0);
  return settle({ order: [...sites], stores: { ...initStream(sites).stores, ...stores }, results: payload, done: false });
}

/** The status row's entries in order, with ok counts taken from the current results. */
export function storeEntries(s: StreamState): StoreEntry[] {
  const counts = s.results ? countsOf(s.results) : {};
  return s.order.map((id) => {
    const e = s.stores[id] ?? { store: id, state: "searching" as const };
    if (e.state !== "ok" && e.state !== "empty") return e;
    const n = counts[id] ?? 0;
    const base: StoreEntry = n > 0 ? { store: id, state: "ok", count: n } : { store: id, state: "empty" };
    return e.partial ? { ...base, partial: true } : base;
  });
}

const n = (k: number, one: string, many: string) => `${k} ${k === 1 ? one : many}`;

/**
 * The short line a screen reader hears (aria-live polite). It changes only at milestones: the
 * search starts, the first results arrive, and the search ends; never on each store.
 */
export function liveSummary(s: StreamState, resultCount: number): string {
  const entries = storeEntries(s);
  if (!s.done) {
    if (!s.results) return `Searching ${n(entries.length, "store", "stores")}`;
    return "Showing the first results; more stores are still searching";
  }
  const answered = entries.filter((e) => e.state === "ok" || e.state === "empty").length;
  const head = `${n(resultCount, "result", "results")} from ${answered} of ${n(entries.length, "store", "stores")}`;
  if (s.stopped) return `Search stopped; ${head}`;
  const down = entries.length - answered;
  return down ? `${head}; ${down} unavailable or failed` : head;
}

/**
 * Reads an NDJSON response body, calling `onEvent` for each event as it arrives. Lines this client
 * does not understand are skipped. Resolves with the number of events read; rejects when the body
 * fails (or the fetch is aborted) mid-way.
 */
export async function readEvents(body: ReadableStream<Uint8Array>, onEvent: (e: StreamEvent) => void): Promise<number> {
  const reader = body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  let n = 0;
  const take = (lines: string[]) => {
    for (const l of lines) {
      const e = parseEvent(l);
      if (e) {
        n++;
        onEvent(e);
      }
    }
  };
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const { lines, rest } = takeLines(buf);
    buf = rest;
    take(lines);
  }
  take(takeLines(`${buf}${dec.decode()}\n`).lines);
  return n;
}
