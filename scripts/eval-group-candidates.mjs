// Proposes cross-store pairs for the grouping gold set (eval/groups-gold.json) from the replayed
// recordings, for a human to review by reading the titles:
// - "code": two stores' items share a model code;
// - "merged": the current grouping puts them together;
// - "near": same brand and similar words, but not merged (recall check);
// - "tricky": same brand and similar words with a spec, variant or code difference.
// Writes eval/dump/group-candidates.tsv. No network.
//
// Usage: node scripts/eval-group-candidates.mjs [--queries "q1|q2"]
import { readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync } from "node:fs";
import path from "node:path";
import { loadEval, root } from "./lib/load-ts.mjs";

const argv = process.argv.slice(2);
const i = argv.indexOf("--queries");
const ev = await loadEval();
const sets = ["queries", "queries-holdout", "queries-holdout2", "queries-holdout3", "queries-holdout4"];
let queries = sets.flatMap((f) => JSON.parse(readFileSync(path.join(root, `eval/${f}.json`), "utf8")));
if (i >= 0) queries = argv[i + 1].split("|").map((q) => q.trim());

const recDir = path.join(root, "eval/recorded");
const storeDirs = readdirSync(recDir).filter((s) => ev.sites[s]);
const warn = console.warn;
console.warn = () => {};
const rows = [];
const jac = (a, b) => {
  let n = 0;
  for (const x of a) if (b.has(x)) n++;
  return n / (a.size + b.size - n || 1);
};
for (const query of queries) {
  const slug = ev.querySlug(query);
  const recordings = storeDirs
    .map((s) => path.join(recDir, s, `${slug}.json`))
    .filter(existsSync)
    .map((f) => JSON.parse(readFileSync(f, "utf8")));
  const { exec } = ev.createReplayExec(recordings);
  let kept = [];
  await ev.runSearch({ query, sites: recordings.map((x) => x.store), sort: "price" }, { exec, onFiltered: (p) => (kept = p) });
  const r = { products: ev.rank(ev.dedupeByStore(kept), "price") };
  const groups = ev.groupProducts(r.products);
  const groupOf = new Map();
  for (const g of groups) for (const p of g.members) groupOf.set(p, g.key);
  const ps = r.products.map((p) => ({ p, f: ev.titleFeatures(p.title) }));
  for (let a = 0; a < ps.length; a++)
    for (let b = a + 1; b < ps.length; b++) {
      const x = ps[a], y = ps[b];
      if (x.p.site === y.p.site) continue;
      const shared = [...x.f.codes].some((c) => y.f.codes.has(c));
      const merged = groupOf.get(x.p) === groupOf.get(y.p);
      const brand = x.f.knownBrand ?? x.f.leadWord;
      const sameBrand = brand && brand === (y.f.knownBrand ?? y.f.leadWord);
      const j = jac(x.f.tokens, y.f.tokens);
      let kind = null;
      if (merged) kind = "merged";
      else if (shared) kind = "code";
      else if (sameBrand && j >= 0.4) kind = ev.sameProduct(x.f, y.f, { threshold: 0 }) ? "near" : "tricky";
      if (!kind) continue;
      rows.push([query, kind, j.toFixed(2), `${x.p.site}:${x.p.id}`, `${y.p.site}:${y.p.id}`, x.p.title.replace(/\s+/g, " "), y.p.title.replace(/\s+/g, " ")].join("\t"));
    }
}
console.warn = warn;
mkdirSync(path.join(root, "eval/dump"), { recursive: true });
writeFileSync(path.join(root, "eval/dump/group-candidates.tsv"), `query\tkind\tjaccard\ta\tb\ttitleA\ttitleB\n${rows.join("\n")}\n`);
const counts = {};
for (const r of rows) {
  const k = r.split("\t")[1];
  counts[k] = (counts[k] ?? 0) + 1;
}
console.log(counts);
process.exit(0);
