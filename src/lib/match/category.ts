import words from "@/data/other-product-words.json";
import { tokenize } from "./tokenize";

/**
 * Different-category items that share the query's words: books about the product ("Apple Watch
 * for Dummies", "Air Fryer Recipe Book", "75 Recipes") and macro keypads sold as "mechanical
 * keyboard". Checked on the title core (before "with"), so "Air Fryer with Recipe Book" stays.
 */
const PHRASES: string[][] = words.map((w) => w.split(/\s+/));
const RECIPE_COUNT = /\b\d+\+?\s*recipes\b/i;
/** A "keyboard" with under ten keys is a macro keypad ("3 Keys Macro Keyboard", "One-key"). */
const FEW_KEYS = /\b(?:[1-9]|one|two|three)\s*(?:-\s*)?keys?\b/i;
const CORE_END = /\b(?:with|includes?|including)\b/i;

export function isOtherProduct(title: string, queryTokens: string[]): boolean {
  const q = new Set(queryTokens.map((t) => t.toLowerCase()));
  const core = title.split(CORE_END)[0];
  if (RECIPE_COUNT.test(title)) return true;
  if (/keyboard/i.test(core) && FEW_KEYS.test(core)) return true;
  const tt = tokenize(core);
  return PHRASES.some(
    (ph) => !ph.every((w) => q.has(w)) && tt.some((_, i) => ph.every((w, k) => tt[i + k] === w)),
  );
}

/**
 * A product code that is a valid ISBN-13 (978/979 prefix, check digit) is a book, whatever its
 * title says ("Dash Cameras Explained"). Shoppers asking for a book say so.
 */
export function isBookCode(id: string, queryTokens: string[]): boolean {
  if (!/^97[89]\d{10}$/.test(id) || queryTokens.some((t) => /^(?:books?|novels?)$/i.test(t))) return false;
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += Number(id[i]) * (i % 2 ? 3 : 1);
  return (10 - (sum % 10)) % 10 === Number(id[12]);
}
