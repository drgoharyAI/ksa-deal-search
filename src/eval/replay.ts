import type { AaResult } from "@/src/lib/aa";
import { MAX_TITLE, type Call, type CallExec } from "@/src/lib/pipeline";
import type { Product, SiteAdapter } from "@/src/lib/types";
import { parseQuery } from "@/src/lib/query/parse";
import { expandTerms } from "@/src/lib/query/synonyms";

/** One raw store call as sent through the app's real transport, with its answer. */
type RecordedCall = { op: string; args: Record<string, string>; result: AaResult };

/** eval/recorded/<store>/<slug>.json */
export type Recording = {
  query: string;
  store: string;
  recordedAt: string;
  /** False when any call failed or the store was aborted (blocked/rate/drift) mid-query; re-recorded on resume. */
  complete: boolean;
  calls: RecordedCall[];
};

export type MissingCall = { store: string; op: string; args: Record<string, string> };

/** Stable identity of a call: op plus args with sorted keys. */
export function callKey(op: string, args: Record<string, string>): string {
  const sorted = Object.keys(args)
    .sort()
    .map((k) => [k, args[k]]);
  return `${op} ${JSON.stringify(sorted)}`;
}

/** "Smart watch >4 stars" -> "smart-watch-4-stars". */
export function querySlug(query: string): string {
  return query
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * Calls to record for one store: what the app sends today (main term + first usable variant),
 * plus the calls it would send if the first synonym variant were gone (so the second variant is
 * recorded too). Deduped, app order first.
 */
export function plannedCalls(adapter: Pick<SiteAdapter, "searchCalls">, query: string): Call[] {
  const pq = parseQuery(query);
  const variants = expandTerms(pq.terms);
  const all = [...adapter.searchCalls(pq, variants), ...(variants.length > 1 ? adapter.searchCalls(pq, variants.slice(1)) : [])];
  const seen = new Set<string>();
  return all.filter((c) => {
    const k = callKey(c.op, c.args);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

const NOT_RECORDED: AaResult = { ok: false, class: "error", reason: "not recorded" };

/**
 * A transport for runSearch that answers from recordings only (never the network).
 * A call that was not recorded answers "error: not recorded" and is listed in `missing`.
 */
export function createReplayExec(recordings: Recording[]): { exec: CallExec; missing: MissingCall[] } {
  const byStore = new Map<string, Map<string, AaResult>>();
  for (const rec of recordings) {
    const m = byStore.get(rec.store) ?? new Map<string, AaResult>();
    for (const c of rec.calls) m.set(callKey(c.op, c.args), c.result);
    byStore.set(rec.store, m);
  }
  const missing: MissingCall[] = [];
  const exec: CallExec = (adapter, call) => {
    const hit = byStore.get(adapter.id)?.get(callKey(call.op, call.args));
    if (hit) return Promise.resolve(hit);
    missing.push({ store: adapter.id, op: call.op, args: call.args });
    return Promise.resolve(NOT_RECORDED);
  };
  return { exec, missing };
}

/** Every product the recordings hold, normalized by its store adapter, keyed "<site>:<id>". */
export function recordedProducts(recordings: Recording[], adapters: Record<string, SiteAdapter>): Map<string, Product> {
  const out = new Map<string, Product>();
  for (const rec of recordings) {
    const adapter = adapters[rec.store];
    if (!adapter) continue;
    for (const c of rec.calls) {
      if (!c.result.ok || !Array.isArray(c.result.data)) continue;
      for (const raw of c.result.data) {
        let p: Product | null = null;
        try {
          p = adapter.normalizeSearchItem(raw);
          // The same cut as the pipeline, so labelled products carry the titles the app matches.
          if (p && p.title.length > MAX_TITLE) p.title = p.title.slice(0, MAX_TITLE);
        } catch {
          p = null;
        }
        if (p && !out.has(`${p.site}:${p.id}`)) out.set(`${p.site}:${p.id}`, p);
      }
    }
  }
  return out;
}
