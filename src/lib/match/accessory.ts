import words from "@/data/accessory-words.json";
import { tokenize } from "./tokenize";

const ACCESSORY = new Set<string>(words);

const isAccessoryWord = (t: string) =>
  ACCESSORY.has(t) || (t.endsWith("s") && ACCESSORY.has(t.slice(0, -1)));

/** Accessory word in the first 6 title tokens, or right before "for", unless the query asks for one. */
export function isAccessory(title: string, queryTokens: string[]): boolean {
  if (queryTokens.some((q) => isAccessoryWord(q.toLowerCase()))) return false;
  const tt = tokenize(title);
  return tt.some(
    (t, i) => isAccessoryWord(t) && (i < 6 || tt[i + 1] === "for"),
  );
}
