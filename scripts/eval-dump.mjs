// Dumps every normalized recorded product for each query to eval/dump/<slug>.tsv
// (key, store, price SAR, title) so products can be labelled per eval/LABELING.md.
//
// Usage: node scripts/eval-dump.mjs [--queries "q1|q2"]
import { readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync } from "node:fs";
import path from "node:path";
import { loadEval, root } from "./lib/load-ts.mjs";

const argv = process.argv.slice(2);
const i = argv.indexOf("--queries");
const ev = await loadEval();
let queries = JSON.parse(readFileSync(path.join(root, "eval/queries.json"), "utf8"));
if (i >= 0) queries = argv[i + 1].split("|").map((q) => q.trim());

const recDir = path.join(root, "eval/recorded");
const outDir = path.join(root, "eval/dump");
mkdirSync(outDir, { recursive: true });
const storeDirs = readdirSync(recDir).filter((s) => ev.sites[s]);

for (const query of queries) {
  const slug = ev.querySlug(query);
  const recordings = storeDirs
    .map((s) => path.join(recDir, s, `${slug}.json`))
    .filter(existsSync)
    .map((f) => JSON.parse(readFileSync(f, "utf8")));
  const products = [...ev.recordedProducts(recordings, ev.sites).values()];
  const rows = products.map((p) =>
    [ev.labelKey(p), p.site, p.listPrice, p.title.replace(/\s+/g, " ")].join("\t"),
  );
  writeFileSync(path.join(outDir, `${slug}.tsv`), `key\tstore\tprice\ttitle\n${rows.join("\n")}\n`);
  console.log(`${slug}: ${rows.length} products`);
}
process.exit(0);
