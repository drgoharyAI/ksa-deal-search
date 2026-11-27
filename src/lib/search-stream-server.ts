import "server-only";
import { backoffEndsAt } from "@/src/lib/aa";
import { assembleResults, fetchSite, prepareSearch, type CallExec, type SearchInput, type SiteOutcome } from "@/src/lib/pipeline";
import { countsOf, storeEntryOf, type StreamEvent } from "@/src/lib/search-stream";
import { readInsights, recordHistory, withInsights } from "@/src/lib/search-request";
import type { SiteAdapter } from "@/src/lib/types";

/** The only error text a client sees when the search broke on the server (detail goes to the log). */
const STREAM_FAILED = "The search failed; try again";

/** When a store refusing us takes requests again (ms), when known. */
function retryAtOf(adapter: SiteAdapter): number | undefined {
  return adapter.blockedEndsAt ? adapter.blockedEndsAt() : backoffEndsAt(adapter.id);
}

/**
 * The progressive search (protocol: src/lib/search-stream.ts). Every store is asked at once, as
 * runSearch does; each answer emits that store's line and then the whole view model assembled
 * from the stores answered so far (assembleResults, in the form's store order, so the last one is
 * exactly runSearch's). Deal insights are read for every partial view; history, observations and
 * the products seen are recorded once, with the final view, as POST /api/search does.
 *
 * Once `signal` aborts (the client went away), nothing more is emitted or recorded, and store
 * calls still queued are skipped (fetchSite); calls already sent finish and are cached.
 * Never throws: an unexpected failure emits {"type":"error"} with a plain message.
 */
export async function runSearchStream(
  input: SearchInput,
  deps: { emit: (e: StreamEvent) => void; signal: AbortSignal; exec?: CallExec },
): Promise<void> {
  const { emit, signal } = deps;
  try {
    const prepared = prepareSearch(input);
    const { adapters } = prepared;
    for (const a of adapters) emit({ type: "store", store: a.id, state: "searching" });
    if (!adapters.length) {
      emit({ type: "results", ...assembleResults(input, prepared, []) });
      emit({ type: "done" });
      return;
    }
    const outs: (SiteOutcome | undefined)[] = adapters.map(() => undefined);
    let answered = 0;
    await Promise.all(
      adapters.map(async (adapter, i) => {
        const out = await fetchSite(adapter, prepared, { exec: deps.exec, signal });
        if (signal.aborted) return;
        outs[i] = out;
        answered++;
        const result = assembleResults(input, prepared, outs.filter((o): o is SiteOutcome => o !== undefined));
        const count = countsOf(result)[adapter.id] ?? 0;
        const retryAt = out.status.status === "blocked" && !deps.exec ? retryAtOf(adapter) : undefined;
        emit({ type: "store", ...storeEntryOf(out.status, count, retryAt) });
        if (answered < adapters.length) {
          emit({ type: "results", ...result, products: readInsights(result.products) });
          return;
        }
        // The last store: the same records and body as POST /api/search.
        if (result.statuses.some((s) => s.status === "ok")) recordHistory(input, result.products);
        emit({ type: "results", ...result, products: withInsights(result.products) });
        emit({ type: "done" });
      }),
    );
  } catch (e) {
    console.warn("[search/stream] search failed", e instanceof Error ? e.message : String(e));
    if (!signal.aborted) emit({ type: "error", error: STREAM_FAILED });
  }
}
