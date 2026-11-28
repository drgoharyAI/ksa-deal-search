import fs from "node:fs";
import path from "node:path";
import { gunzipSync } from "node:zlib";

/**
 * A large English word list: a word in it is a real word, never a typo to correct
 * (src/lib/query/spell.ts). data/english-words.txt.gz is the letters-only part of the npm package
 * an-array-of-english-words 2.0.0 (MIT, data/english-words.LICENSE): 274,937 words, 0.7 MB
 * gzipped (3.2 MB as JSON). Read lazily, once, on the first correction (about 0.2 s); the server
 * warms it at start (instrumentation.ts), off the request path.
 */
let words: Set<string> | null = null;

export function englishWords(): Set<string> {
  if (words) return words;
  const file = path.join(process.cwd(), "data", "english-words.txt.gz");
  words = new Set(gunzipSync(fs.readFileSync(file)).toString("utf8").split("\n"));
  return words;
}
