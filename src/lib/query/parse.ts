import type { ParsedQuery } from "@/src/lib/types";

const NUM = "(\\d+(?:\\.\\d+)?)";

/** Removes the first match of `re` from `s`, returning the match and the rest. */
function take(s: string, re: RegExp): { m: RegExpMatchArray | null; rest: string } {
  const m = s.match(re);
  if (!m || m.index === undefined) return { m: null, rest: s };
  return { m, rest: s.slice(0, m.index) + " " + s.slice(m.index + m[0].length) };
}

export function parseQuery(input: string): ParsedQuery {
  let s = ` ${input.toLowerCase()} `;
  const pq: ParsedQuery = { terms: "", exclude: [] };

  // Rating first so ">4.5 stars" is not read as a price.
  let r = take(s, new RegExp(`(?:>\\s*${NUM}|${NUM}\\s*\\+)\\s*stars?\\b`));
  if (r.m) {
    pq.minRating = parseFloat(r.m[1] ?? r.m[2]);
    s = r.rest;
  }

  r = take(s, new RegExp(`(?<![\\w.-])${NUM}\\s*-\\s*${NUM}(?![\\w.-])`));
  if (r.m) {
    pq.minPrice = parseFloat(r.m[1]);
    pq.maxPrice = parseFloat(r.m[2]);
    s = r.rest;
  }

  r = take(s, new RegExp(`(?:\\b(?:under|below)\\s+|<\\s*)${NUM}`));
  if (r.m) {
    pq.maxPrice = parseFloat(r.m[1]);
    s = r.rest;
  }

  r = take(s, new RegExp(`(?:\\b(?:over|above)\\s+|>\\s*)${NUM}(?!\\s*stars?\\b)`));
  if (r.m) {
    pq.minPrice = parseFloat(r.m[1]);
    s = r.rest;
  }

  s = s.replace(/(?<=\s)-([^\s-]\S*)/g, (_, w: string) => {
    pq.exclude.push(w);
    return " ";
  });

  pq.terms = s.replace(/\s+/g, " ").trim();
  return pq;
}
