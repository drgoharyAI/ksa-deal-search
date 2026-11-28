import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { dbPath } from "@/src/lib/db";
import { buildVocab, readDbVocab, staticVocab } from "@/src/lib/query/vocab";
import { Speller } from "@/src/lib/query/spell";
import { matcherWords } from "@/src/lib/match/group";
import brands from "@/data/brands.json";

/**
 * Correction must never change a correct query: every eval query (eval/queries*.json) and every
 * query in the owner's history (the local database, opened read-only, when present).
 */
const root = path.resolve(__dirname, "../..");
const evalQueries = fs
  .readdirSync(path.join(root, "eval"))
  .filter((f) => /^queries(?!-typos).*\.json$/.test(f))
  .flatMap((f) => JSON.parse(fs.readFileSync(path.join(root, "eval", f), "utf8")) as string[]);

const joinable = new Set(brands.filter((b) => b.length >= 5));
const staticSpeller = new Speller(staticVocab(), { joinable });

/** The owner's database, read-only, or null when there is none on this machine. */
function ownerDb() {
  const file = dbPath();
  if (!fs.existsSync(file)) return null;
  const { DatabaseSync } = process.getBuiltinModule("node:sqlite");
  try {
    return new DatabaseSync(file, { readOnly: true });
  } catch {
    return null;
  }
}

const changed = (sp: Speller, qs: string[]) => qs.filter((q) => sp.correct(q).changed).map((q) => `${q} -> ${sp.correct(q).query}`);

describe("false corrections", () => {
  it("has every eval query", () => {
    expect(evalQueries.length).toBeGreaterThanOrEqual(40);
  });

  it("changes no eval query (static vocabulary)", () => {
    expect(changed(staticSpeller, evalQueries)).toEqual([]);
  });

  it("changes no eval or history query with the owner's learnt vocabulary", () => {
    const db = ownerDb();
    if (!db) return; // no local database: nothing more to check
    try {
      const learnt = readDbVocab(db);
      const sp = new Speller(buildVocab(learnt), { joinable });
      expect(changed(sp, [...evalQueries, ...learnt.queries])).toEqual([]);
      expect(changed(staticSpeller, learnt.queries)).toEqual([]);
    } finally {
      db.close();
    }
  });

  it("knows brand and model words", () => {
    for (const w of ["galaxy", "tab", "flip", "anc", "buds", "pro", "ultra", ...brands]) {
      expect(staticSpeller.correct(w).changed, w).toBe(false);
    }
    for (const w of matcherWords()) expect(staticSpeller.correct(w).changed, w).toBe(false);
  });
});
