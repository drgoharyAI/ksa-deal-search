// Grouping check: replays every recorded query (no network), groups the results
// (src/lib/match/group.ts) and scores the grouping against eval/groups-gold.json:
// - merge precision: of the gold pairs placed in one group, the share that are the same product;
// - merge recall: of the gold same pairs, the share placed in one group;
// reported for the tuning and the held-out half separately. Also scores the grouped view (each
// group shown once, at its best member) with the per-query top-10 metrics of scripts/eval.mjs.
//
// Usage: node scripts/eval-groups.mjs [--threshold 0.6]
import { readFileSync, existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { loadEval, root } from "./lib/load-ts.mjs";

const argv = process.argv.slice(2);
const ti = argv.indexOf("--threshold");
const threshold = ti >= 0 ? Number(argv[ti + 1]) : undefined;
const gi = argv.indexOf("--generic");
const genericShare = gi >= 0 ? Number(argv[gi + 1]) : undefined;
const gopts = { ...(threshold === undefined ? {} : { threshold }), ...(genericShare === undefined ? {} : { genericShare }) };
const ev = await loadEval();
const gold = JSON.parse(readFileSync(path.join(root, "eval/groups-gold.json"), "utf8")).queries;
const goldOf = new Map(gold.map((g) => [g.query, g]));
const sets = ["queries", "queries-holdout", "queries-holdout2", "queries-holdout3", "queries-holdout4"];
const queries = sets.flatMap((f) => JSON.parse(readFileSync(path.join(root, `eval/${f}.json`), "utf8")));
const recDir = path.join(root, "eval/recorded");
const storeDirs = readdirSync(recDir).filter((s) => ev.sites[s]);
const pct = (x) => (x === null || Number.isNaN(x) ? "  n/a" : `${(x * 100).toFixed(1)}%`);
const warn = console.warn;
console.warn = () => {};

const tot = { tune: blank(), heldout: blank() };
function blank() {
  return { samePairs: 0, differentPairs: 0, sameMerged: 0, differentMerged: 0, skipped: 0, wrong: [], groups: 0, multi: 0, view: [], flat: [] };
}
for (const [i, query] of queries.entries()) {
  const slug = ev.querySlug(query);
  const recordings = storeDirs.map((s) => path.join(recDir, s, `${slug}.json`)).filter(existsSync).map((f) => JSON.parse(readFileSync(f, "utf8")));
  const { exec } = ev.createReplayExec(recordings);
  let kept = [];
  const r = await ev.runSearch({ query, sites: recordings.map((x) => x.store), sort: "price" }, { exec, onFiltered: (p) => (kept = p) });
  // The pipeline groups listings deduped within each store (src/lib/pipeline.ts); same here.
  const perStore = ev.rank(ev.dedupeByStore(kept), "price");
  const groups = ev.groupProducts(perStore, gopts);
  const g = goldOf.get(query);
  const split = g?.split ?? (i % 2 === 0 ? "tune" : "heldout");
  const t = tot[split];
  t.multi += groups.filter((x) => x.members.length > 1).length;
  if (g) {
    const m = ev.computeGroupMetrics(groups, g);
    for (const k of ["samePairs", "differentPairs", "sameMerged", "differentMerged", "skipped"]) t[k] += m[k];
    const groupOf = new Map(groups.flatMap((x) => x.members.map((p) => [`${p.site}:${p.id}`, x])));
    for (const [a, b] of g.differentKeys) if (groupOf.get(a) && groupOf.get(a) === groupOf.get(b)) t.wrong.push(`${query}: ${a} ~ ${b}`);
  }
  const labelFile = path.join(root, "eval/labels", `${slug}.json`);
  if (existsSync(labelFile)) {
    const labels = JSON.parse(readFileSync(labelFile, "utf8")).labels;
    const recorded = ev.recordedProducts(recordings, ev.sites);
    const pq = ev.parseQuery(query);
    const constraints = { minPrice: pq.minPrice, maxPrice: pq.maxPrice, minRating: pq.minRating, exclude: pq.exclude };
    const view = ev.orderGroups(groups, "price").map((x) => x.best);
    t.view.push(ev.computeMetrics({ results: view, kept, recorded, labels, constraints }));
    t.flat.push(ev.computeMetrics({ results: r.products, kept, recorded, labels, constraints }));
  }
}
// Adversarial pairs (eval/groups-adversarial.json), each grouped inside its recorded result set.
const adv = JSON.parse(readFileSync(path.join(root, "eval/groups-adversarial.json"), "utf8")).pairs;
const padCache = new Map();
const advBad = [];
const advFixed = [];
let advMiss = 0;
for (const x of adv) {
  if (!padCache.has(x.pad)) {
    const slug = ev.querySlug(x.pad);
    const recordings = storeDirs.map((s) => path.join(recDir, s, `${slug}.json`)).filter(existsSync).map((f) => JSON.parse(readFileSync(f, "utf8")));
    const { exec } = ev.createReplayExec(recordings);
    let kept = [];
    await ev.runSearch({ query: x.pad, sites: recordings.map((r) => r.store), sort: "price" }, { exec, onFiltered: (p) => (kept = p) });
    padCache.set(x.pad, ev.dedupeByStore(kept));
  }
  const mk = (site, id, title) => ({ site, id, title, listPrice: 100, finalPrice: 100, origPrice: null, discountPct: null, currency: "SAR", rating: null, soldCount: 0, image: "", url: "", detailStatus: "ok", matchScore: 1 });
  const gs = ev.groupProducts([...padCache.get(x.pad), mk("amazon-sa", "adv-a", x.a), mk("noon-sa", "adv-b", x.b)], gopts);
  const ga = gs.find((g) => g.members.some((m) => m.id === "adv-a"));
  const merged = ga.members.some((m) => m.id === "adv-b");
  // knownMiss: a merge the rules do not make yet (a recall gap), counted apart from failures.
  if (x.knownMiss) merged ? advFixed.push(`${x.a} | ${x.b}`) : advMiss++;
  else if (merged !== (x.expect === "merge")) advBad.push(`${x.expect.toUpperCase()} expected: ${x.a} | ${x.b}`);
}
console.warn = warn;
const advN = adv.filter((x) => !x.knownMiss).length;
console.log(`adversarial pairs ${advN - advBad.length}/${advN} as expected` + (advMiss ? ` (+${advMiss} known recall misses)` : ""));
for (const b of advFixed) console.log(`         now merges, drop knownMiss: ${b}`);
for (const b of advBad) console.log(`         ${b}`);
console.log(`threshold ${threshold ?? "default"}  generic share ${genericShare ?? "default"}`);
for (const [split, t] of Object.entries(tot)) {
  const merged = t.sameMerged + t.differentMerged;
  const v = ev.aggregate(t.view);
  const f = ev.aggregate(t.flat);
  console.log(
    `${split.padEnd(8)} precision ${pct(merged ? t.sameMerged / merged : NaN)} (${t.sameMerged}/${merged})  recall ${pct(t.sameMerged / t.samePairs)} (${t.sameMerged}/${t.samePairs})` +
      `  wrong merges ${t.differentMerged}/${t.differentPairs}  skipped ${t.skipped}  multi-store groups ${t.multi}`,
  );
  console.log(`         flat  p@10 ${pct(f.precisionAt10)} cheapest-first ${pct(f.cheapestRelevantFirst)} | grouped view p@10 ${pct(v.precisionAt10)} acc@10 ${pct(v.accessoryAt10)} wrong@10 ${pct(v.wrongModelAt10)} cheapest-first ${pct(v.cheapestRelevantFirst)}`);
  for (const w of t.wrong) console.log(`         WRONG ${w}`);
}
process.exit(0);
