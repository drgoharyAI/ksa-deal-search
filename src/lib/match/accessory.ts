import words from "@/data/accessory-words.json";
import { tokenize } from "./tokenize";
import { formsMatch } from "./relevance";

const ACCESSORY = new Set<string>(words);

const isAccessoryWord = (t: string) =>
  ACCESSORY.has(t) || (t.endsWith("s") && ACCESSORY.has(t.slice(0, -1)));

const CONNECTOR = /\b(?:with|includes?|including)\b|[+&]/i;

/**
 * Accessory when, before any "with/+/&/includes", an accessory word is followed by
 * "for"/"compatible", or comes before the first title token matching the query
 * (unless the title still ends in the query's last token, e.g. "Smart Band 9 Fitness Tracker").
 * Never when the query itself names an accessory word.
 */
export function isAccessory(title: string, queryTokens: string[]): boolean {
  const q = queryTokens.map((t) => t.toLowerCase());
  if (q.some(isAccessoryWord)) return false;
  const tt = tokenize(title.split(CONNECTOR)[0]);
  const firstMatch = tt.findIndex((t) => q.some((x) => formsMatch(x, t)));
  const limit = firstMatch === -1 ? Infinity : firstMatch;
  const forIdx = tt.findIndex((t) => t === "for" || t === "compatible");
  const core = forIdx === -1 ? tt : tt.slice(0, forIdx);
  const endsWithQuery = q.length > 0 && core.length > 0 && formsMatch(q[q.length - 1], core[core.length - 1]);
  return tt.some((t, i) => {
    if (!isAccessoryWord(t)) return false;
    if (tt[i + 1] === "for" || tt[i + 1] === "compatible") return true;
    return i < limit && !endsWithQuery;
  });
}
