// Replays eval/recorded/ through the real pipeline (normalize -> filters -> dedupe -> rank, sort
// "price") with no network, and scores each query against eval/labels/<slug>.json.
// Unlabelled queries print their top 10 instead of metrics. Writes eval/last-run.json.
//
// Usage: node scripts/eval.mjs [--queries "q1|q2"] [--top N]
import { readFileSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { loadEval, root } from "./lib/load-ts.mjs";

const argv = process.argv.slice(2);
const flag = (name) => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
};
const TOP = Number(flag("--top") ?? 10);

const ev = await loadEval();
let queries = JSON.parse(readFileSync(path.join(root, "eval/queries.json"), "utf8"));
if (flag("--queries")) queries = flag("--queries").split("|").map((q) => q.trim());

const recDir = path.join(root, "eval/recorded");
const storeDirs = existsSync(recDir) ? readdirSync(recDir).filter((s) => ev.sites[s]) : [];
const readJson = (f) => JSON.parse(readFileSync(f, "utf8"));
const pct = (x) => (x === null || x === undefined ? "  n/a" : `${(x * 100).toFixed(0).padStart(4)}%`);

// Keep the pipeline's own warnings ("[search] call failed ...") out of the report.
const warn = console.warn;
console.warn = () => {};

const out = { at: new Date().toISOString(), queries: [], overall: null };
const labelled = [];

for (const query of queries) {
  const slug = ev.querySlug(query);
  const recordings = storeDirs
    .map((s) => path.join(recDir, s, `${slug}.json`))
    .filter(existsSync)
    .map(readJson);
  const { exec, missing } = ev.createReplayExec(recordings);
  let kept = [];
  const r = await ev.runSearch(
    { query, sites: recordings.map((x) => x.store), sort: "price" },
    { exec, onFiltered: (p) => (kept = p) },
  );
  const recorded = ev.recordedProducts(recordings, ev.sites);
  const labelFile = path.join(root, "eval/labels", `${slug}.json`);
  const labels = existsSync(labelFile) ? readJson(labelFile).labels : null;

  const pq = ev.parseQuery(query);
  const metrics = labels
    ? ev.computeMetrics({
        results: r.products,
        kept,
        recorded,
        labels,
        constraints: { minPrice: pq.minPrice, maxPrice: pq.maxPrice, minRating: pq.minRating, exclude: pq.exclude },
      })
    : null;
  if (metrics) labelled.push(metrics);

  const top = r.products.slice(0, TOP).map((p) => ({
    key: ev.labelKey(p),
    store: p.site,
    price: p.finalPrice ?? p.listPrice,
    title: p.title,
    label: labels?.[ev.labelKey(p)] ?? null,
  }));
  out.queries.push({
    query,
    slug,
    stores: recordings.map((x) => ({ store: x.store, complete: x.complete, calls: x.calls.length })),
    statuses: r.statuses,
    recordedItems: recorded.size,
    results: r.products.length,
    missingCalls: missing,
    labelled: !!labels,
    metrics,
    top,
  });

  console.log(`\n== ${query}  [${slug}]  recorded ${recorded.size}, results ${r.products.length}`);
  const st = r.statuses.map((s) => `${s.site}:${s.status}${s.message ? ` (${s.message})` : ""}`).join("  ");
  console.log(`   stores: ${st || "none recorded"}`);
  if (missing.length) {
    console.log(`   missing calls (not recorded): ${missing.map((m) => `${m.store} ${JSON.stringify(m.args)}`).join("; ")}`);
  }
  if (metrics) {
    console.log(
      `   results ${r.products.length} (top ${metrics.top})  p@10 ${pct(metrics.precisionAt10)}  acc@10 ${pct(metrics.accessoryAt10)}  wrong@10 ${pct(metrics.wrongModelAt10)}` +
        `  recall ${pct(metrics.recall)} (${metrics.relevantKept}/${metrics.relevantRecorded})` +
        `  cheapest-first ${metrics.cheapestRelevantFirst === null ? "n/a" : metrics.cheapestRelevantFirst ? "yes" : "NO"}` +
        (metrics.unlabeledAt10 ? `  unlabelled@10 ${metrics.unlabeledAt10}` : ""),
    );
  } else {
    console.log("   unlabeled");
  }
  if (!metrics || argv.includes("--show")) {
    top.forEach((t, i) =>
      console.log(`   ${String(i + 1).padStart(2)}. ${t.store.padEnd(11)} ${t.price.toFixed(2).padStart(9)}  ${t.title.slice(0, 90)}${t.label ? `  [${t.label}]` : ""}`),
    );
  }
}

console.warn = warn;
out.overall = labelled.length ? ev.aggregate(labelled) : null;
console.log("\n== overall");
if (out.overall) {
  const o = out.overall;
  console.log(
    `   ${o.queries}/${queries.length} labelled  p@10 ${pct(o.precisionAt10)}  acc@10 ${pct(o.accessoryAt10)}` +
      `  wrong@10 ${pct(o.wrongModelAt10)}  recall ${pct(o.recall)}  cheapest-first ${pct(o.cheapestRelevantFirst)}`,
  );
} else {
  console.log(`   0/${queries.length} labelled: no metrics yet (label files go in eval/labels/<slug>.json)`);
}
writeFileSync(path.join(root, "eval/last-run.json"), JSON.stringify(out, null, 2) + "\n");
console.log("\nwrote eval/last-run.json");
process.exit(0);
