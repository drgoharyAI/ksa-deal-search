// Typo tolerance eval (owner request "make search able to deal with typos"). No network.
// 1. Correction accuracy over eval/queries-typos.json: the typed query, corrected, must equal the
//    intended query.
// 2. False-correction rate: every clean query (eval/queries*.json, and with --db the owner's
//    history) must come back unchanged.
// 3. Replay: each typo query runs through the real pipeline (runSearch corrects it before the store
//    calls, so the recorded calls of the corrected query answer) and is scored against the labels
//    of its intended query, next to the clean query's own scores.
//
// Usage: node scripts/eval-typos.mjs [--db]
// --db adds the learnt words of the local database (opened read-only), as the running app does.
// Without it the vocabulary is the static one (reproducible). Writes nothing.
import { readFileSync, readdirSync, existsSync } from "node:fs";
import path from "node:path";
import { loadEval, root } from "./lib/load-ts.mjs";

const argv = process.argv.slice(2);
const ev = await loadEval();
const readJson = (f) => JSON.parse(readFileSync(f, "utf8"));
const pct = (x) => (x === null || x === undefined ? "  n/a" : `${(x * 100).toFixed(0).padStart(4)}%`);

let history = [];
if (argv.includes("--db")) {
  const file = process.env.DEAL_SEARCH_DB?.trim() || path.join(process.env.LOCALAPPDATA ?? "", "deal-search", "data.db");
  if (existsSync(file)) {
    const { DatabaseSync } = await import("node:sqlite");
    const db = new DatabaseSync(file, { readOnly: true });
    const learnt = ev.readDbVocab(db);
    db.close();
    history = learnt.queries;
    ev.setVocabSource(() => learnt);
    console.log(`vocabulary: static + local database (${learnt.titles.length} titles, ${learnt.queries.length} past queries)`);
  } else console.log(`vocabulary: static (no database at ${file})`);
} else console.log("vocabulary: static (add --db for the local database's learnt words)");
ev.resetVocab();
const speller = ev.currentSpeller();
console.log(`vocabulary size: ${speller.size} words`);

const typos = readJson(path.join(root, "eval/queries-typos.json"));
const clean = readdirSync(path.join(root, "eval"))
  .filter((f) => /^queries(?!-typos).*\.json$/.test(f))
  .flatMap((f) => readJson(path.join(root, "eval", f)));

// 1. Correction accuracy (and time per query).
let right = 0;
let worst = 0;
const wrong = [];
for (const { typo, intended } of typos) {
  const t0 = performance.now();
  const got = speller.correct(typo).query;
  worst = Math.max(worst, performance.now() - t0);
  if (got === intended) right++;
  else wrong.push(`${typo} -> ${got} (wanted ${intended})`);
}
console.log(`\n== correction accuracy: ${right}/${typos.length} (${pct(right / typos.length).trim()}), slowest ${worst.toFixed(2)} ms`);
for (const w of wrong) console.log(`   miss: ${w}`);

// 2. False corrections on clean queries.
const cleanAll = [...new Set([...clean, ...history])];
const falses = cleanAll.filter((q) => speller.correct(q).changed);
console.log(`\n== false corrections: ${falses.length}/${cleanAll.length} clean queries (${pct(falses.length / cleanAll.length).trim()})`);
for (const q of falses) console.log(`   changed: ${q} -> ${speller.correct(q).query}`);

// 3. Replay: typo query vs its clean query, scored on the clean query's labels.
const recDir = path.join(root, "eval/recorded");
const storeDirs = readdirSync(recDir).filter((s) => ev.sites[s]);
const warn = console.warn;
console.warn = () => {};
async function score(query, labelQuery) {
  const pq = ev.parseQuery(query);
  // The stores get the corrected query, so the corrected query's recordings answer.
  const searched = speller.correct(query).query;
  const recordings = storeDirs
    .map((s) => path.join(recDir, s, `${ev.querySlug(searched)}.json`))
    .filter(existsSync)
    .map(readJson);
  const labelFile = path.join(root, "eval/labels", `${ev.querySlug(labelQuery)}.json`);
  if (!existsSync(labelFile)) return null;
  const labels = readJson(labelFile).labels;
  const lrec = storeDirs
    .map((s) => path.join(recDir, s, `${ev.querySlug(labelQuery)}.json`))
    .filter(existsSync)
    .map(readJson);
  const { exec } = ev.createReplayExec(recordings);
  let kept = [];
  const r = await ev.runSearch(
    { query, sites: lrec.map((x) => x.store), sort: "price" },
    { exec, onFiltered: (p) => (kept = p) },
  );
  return ev.computeMetrics({
    results: r.products,
    kept,
    recorded: ev.recordedProducts(lrec, ev.sites),
    labels,
    constraints: { minPrice: pq.minPrice, maxPrice: pq.maxPrice, minRating: pq.minRating, exclude: pq.exclude },
  });
}
const typoM = [];
const cleanM = [];
for (const { typo, intended } of typos) {
  const [t, c] = [await score(typo, intended), await score(intended, intended)];
  if (!t || !c) continue;
  typoM.push(t);
  cleanM.push(c);
  if (t.precisionAt10 !== c.precisionAt10 || t.recall !== c.recall) {
    console.log(`   differs: ${typo}  p@10 ${pct(t.precisionAt10)} vs ${pct(c.precisionAt10)}  recall ${pct(t.recall)} vs ${pct(c.recall)}`);
  }
}
console.warn = warn;
const line = (name, o) =>
  `   ${name.padEnd(6)} ${o.queries} queries  p@10 ${pct(o.precisionAt10)}  recall ${pct(o.recall)}  cheapest-first ${pct(o.cheapestRelevantFirst)}`;
console.log("\n== replay (labels of the intended query)");
console.log(line("typos", ev.aggregate(typoM)));
console.log(line("clean", ev.aggregate(cleanM)));
process.exit(0);
