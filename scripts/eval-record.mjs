// Records each eval query's raw store calls once (eval/recorded/<store>/<slug>.json) so tuning
// replays them offline. Gentle by design:
// - one request at a time; >= 3 s between requests to the same store, >= 5 s between noon loads;
// - resumable: a complete recording (every call answered ok) is skipped unless --force;
// - a store that answers blocked / rate / drift is dropped for the rest of the run (never retried);
//   the app's own back-off (aaCall, noon runCall) still applies underneath.
//
// Usage: node scripts/eval-record.mjs [--stores a,b] [--queries "q1|q2"] [--force]
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { loadEval, root } from "./lib/load-ts.mjs";

const STORE_GAP_MS = 3_000;
const NOON_GAP_MS = 5_000;
const ABORT_CLASSES = new Set(["blocked", "rate", "drift"]);

const argv = process.argv.slice(2);
const flag = (name) => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
};
const force = argv.includes("--force");

const ev = await loadEval();
const allStores = Object.keys(ev.sites);
const stores = flag("--stores") ? flag("--stores").split(",").map((s) => s.trim()) : allStores;
for (const s of stores) if (!ev.sites[s]) throw new Error(`unknown store ${s}`);
let queries = JSON.parse(readFileSync(path.join(root, "eval/queries.json"), "utf8"));
if (flag("--queries")) queries = flag("--queries").split("|").map((q) => q.trim());

// noon: own runCall instance with a 5 s gap between page loads (warm-up included).
const noonRunCall = ev.createRunCall({ withPage: ev.withNoonPage, minGapMs: NOON_GAP_MS });
const lastAt = new Map();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function send(store, call) {
  const gap = store === "noon-sa" ? NOON_GAP_MS : STORE_GAP_MS;
  const wait = (lastAt.get(store) ?? 0) + gap - Date.now();
  if (wait > 0) await sleep(wait);
  try {
    return store === "noon-sa"
      ? await noonRunCall(call)
      : await ev.aaCall(store, call.op, call.args, { ttlMs: 600_000, lane: "search" });
  } catch (e) {
    return { ok: false, class: "error", reason: e instanceof Error ? e.message : String(e) };
  } finally {
    lastAt.set(store, Date.now());
  }
}

const aborted = new Map(); // store -> reason
const rows = []; // summary
let requests = 0;

try {
  for (const query of queries) {
    const slug = ev.querySlug(query);
    for (const store of stores) {
      const file = path.join(root, "eval/recorded", store, `${slug}.json`);
      if (!force && existsSync(file)) {
        const prev = JSON.parse(readFileSync(file, "utf8"));
        if (prev.complete) {
          rows.push({ store, query, status: "skip (recorded)", calls: prev.calls.length, items: countItems(prev.calls) });
          continue;
        }
      }
      if (aborted.has(store)) {
        rows.push({ store, query, status: `not run (${aborted.get(store)})`, calls: 0, items: 0 });
        continue;
      }
      const planned = ev.plannedCalls(ev.sites[store], query);
      const calls = [];
      let stop = null;
      for (const call of planned) {
        const result = await send(store, call);
        requests++;
        calls.push({ op: call.op, args: call.args, result });
        const n = result.ok && Array.isArray(result.data) ? result.data.length : 0;
        console.log(`${store.padEnd(12)} ${query.padEnd(28)} ${JSON.stringify(call.args)} -> ${result.ok ? `ok ${n}` : `${result.class}: ${String(result.reason).slice(0, 80)}`}`);
        if (!result.ok && ABORT_CLASSES.has(result.class)) {
          stop = result.class;
          break;
        }
      }
      if (stop) aborted.set(store, `aborted after ${stop}`);
      // Incomplete (aborted or any failed call) recordings are re-recorded by the next run.
      const rec = { query, store, recordedAt: new Date().toISOString(), complete: !stop && calls.every((c) => c.result.ok), calls };
      mkdirSync(path.dirname(file), { recursive: true });
      writeFileSync(file, JSON.stringify(rec));
      const failed = calls.filter((c) => !c.result.ok).map((c) => c.result.class);
      rows.push({
        store,
        query,
        status: stop ? `ABORTED (${stop})` : failed.length ? `ok, ${failed.length} failed (${failed.join(",")})` : "ok",
        calls: calls.length,
        items: countItems(calls),
      });
    }
  }
} finally {
  if (stores.includes("noon-sa")) await ev.closeNoonBrowser().catch(() => {});
}

function countItems(calls) {
  return calls.reduce((n, c) => n + (c.result.ok && Array.isArray(c.result.data) ? c.result.data.length : 0), 0);
}

console.log("\nstore         status                         calls  items  query");
for (const r of rows) {
  console.log(`${r.store.padEnd(13)} ${r.status.padEnd(30)} ${String(r.calls).padStart(5)} ${String(r.items).padStart(6)}  ${r.query}`);
}
console.log(`\nrequests sent: ${requests}`);
for (const [s, why] of aborted) console.log(`store ${s}: ${why}`);
process.exit(0);
