import groups from "@/data/synonyms.json";

const SYNONYMS: string[][] = groups;

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function memberRegExp(member: string): RegExp {
  // eslint-disable-next-line security/detect-non-literal-regexp -- member is a data/synonyms.json entry passed through escapeRegExp
  return new RegExp(`(?<![\\w-])${escapeRegExp(member)}(?![\\w-])`);
}

function findMatch(terms: string): { group: string[]; member: string } | null {
  // First group (file order) with a hit wins; within it, the longest member.
  for (const group of SYNONYMS) {
    const hits = group.filter((m) => memberRegExp(m).test(terms));
    if (hits.length) {
      hits.sort((a, b) => b.length - a.length);
      return { group, member: hits[0] };
    }
  }
  return null;
}

/** Up to `max` variants of `terms`, each different from `terms` and from each other. */
export function expandTerms(terms: string, max = 2): string[] {
  const lower = terms.toLowerCase();
  const match = findMatch(lower);
  if (!match) return [];
  const re = memberRegExp(match.member);
  const out: string[] = [];
  for (const alt of match.group) {
    if (alt === match.member) continue;
    const variant = lower.replace(re, alt);
    if (variant !== terms && !out.includes(variant)) out.push(variant);
    if (out.length >= max) break;
  }
  return out;
}
