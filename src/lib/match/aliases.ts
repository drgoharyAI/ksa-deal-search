import synonyms from "@/data/synonyms.json";
import extra from "@/data/match-aliases.json";

/**
 * Equivalent phrases for title matching only (never sent to stores): the query synonym groups
 * plus data/match-aliases.json. A query token in a group is also satisfied by any member phrase.
 */
const GROUPS: string[][] = [...(synonyms as string[][]), ...(extra as string[][])];

/** Alternative phrases (as token lists) for one query token, excluding the token itself. */
export function aliasPhrases(token: string): string[][] {
  const out: string[][] = [];
  for (const g of GROUPS) {
    if (!g.includes(token)) continue;
    for (const m of g) if (m !== token) out.push(m.split(/\s+/));
  }
  return out;
}
