/**
 * Rule-based spelling correction for English query words (no LLM, no external service). A word is
 * replaced only by a vocabulary word (src/lib/query/vocab.ts) within a small edit distance, found
 * through a symmetric-delete index (SymSpell's idea): each vocabulary word is stored under the
 * strings left after deleting up to 2 of its letters, so a query word looks up its own deletes
 * instead of being compared with every word.
 *
 * Left alone, always: words with a digit or a symbol (model codes, prices, "usb-c", "-case",
 * ">4"), words of fewer than 4 letters, non-Latin words, English dictionary words, vocabulary
 * words and their plural or singular, and protected words. A word is never split in two; two words
 * join only into a known brand ("air pods"). A correct query is never changed: every eval query
 * and 400+ held-out shopping queries (tests/lib/spell-safety.test.ts).
 */

/** Edits allowed for a query word of `len` letters: 1 from 4 to 7, 2 from 8. */
const maxEdits = (len: number): number => (len >= 8 ? 2 : 1);
/** Words shorter than this are never corrected. */
const MIN_LEN = 4;
/**
 * A change of letters only (no letter added, dropped or swapped) can turn a real word or a name
 * into another word ("shark" / "sharp"): it needs the target seen in at least this many product
 * titles, and 10 times as often as the typed word.
 */
const SUB_MIN_TITLES = 10;
const SUB_MARGIN = 10;
/** Shorter words are never corrected by a letter change alone ("padel" is no typo of "panel"). */
const SUB_MIN_LEN = 6;
/** Words shorter than this are only corrected to a word with the same first letter. */
const SAME_FIRST_BELOW = 6;
/** Longer words are never corrected: their delete sets grow with the square of the length. */
const MAX_WORD = 30;
/** At most this many words of one query are looked up in the index. */
const MAX_FIXES = 12;
/** A longer query (the search form allows 200 characters) is never corrected. */
export const MAX_CORRECT_CHARS = 200;
/** Query syntax words (src/lib/query/parse.ts) that are never corrected. */
const SYNTAX = ["under", "below", "over", "above", "stars", "star", "riyal", "riyals"];

const LETTERS = /^[a-z]+$/;

/**
 * Optimal string alignment distance (Damerau–Levenshtein where a swap of two adjacent letters is
 * one edit), stopping early: any distance above `max` comes back as `max + 1`.
 */
export function osaDistance(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  const n = a.length;
  const m = b.length;
  let prev2: number[] = [];
  let prev = Array.from({ length: m + 1 }, (_, j) => j);
  for (let i = 1; i <= n; i++) {
    const cur = [i];
    let rowMin = i;
    for (let j = 1; j <= m; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let d = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d = Math.min(d, prev2[j - 2] + 1);
      cur.push(d);
      if (d < rowMin) rowMin = d;
    }
    if (rowMin > max) return max + 1;
    prev2 = prev;
    prev = cur;
  }
  return Math.min(prev[m], max + 1);
}

/** Every string left after deleting up to `depth` letters of `w` (w itself included). */
function deletes(w: string, depth: number): Set<string> {
  const out = new Set<string>([w]);
  let frontier = [w];
  for (let d = 0; d < depth; d++) {
    const next: string[] = [];
    for (const s of frontier) {
      for (let i = 0; i < s.length; i++) {
        const del = s.slice(0, i) + s.slice(i + 1);
        if (!out.has(del)) {
          out.add(del);
          next.push(del);
        }
      }
    }
    frontier = next;
  }
  return out;
}

export type SpellerOptions = {
  /** Words never corrected (brand and model words, query syntax), whatever their frequency. */
  protect?: Iterable<string>;
  /** Closed compounds two typed words join into ("air pods" -> "airpods"); vocabulary words only. */
  joinable?: Iterable<string>;
  /** Real words (a large English list, src/lib/query/dictionary.ts): never corrected. */
  dictionary?: { has(w: string): boolean };
  /** Product-title frequency of each word: the evidence a letter change needs. */
  titleFreq?: Map<string, number>;
};

export type Correction = { query: string; changed: boolean };

export class Speller {
  private readonly freq: Map<string, number>;
  private readonly protect: Set<string>;
  private readonly joinable: Set<string>;
  private readonly dictionary: { has(w: string): boolean };
  private readonly titleFreq: Map<string, number>;
  private readonly index = new Map<string, string[]>();
  private sorted: string[] | null = null;

  /** `words`: vocabulary word -> frequency (higher wins a tie). Non-letter entries are ignored. */
  constructor(words: Map<string, number>, opts: SpellerOptions = {}) {
    this.freq = new Map([...words].filter(([w]) => LETTERS.test(w) && w.length <= MAX_WORD));
    this.dictionary = opts.dictionary ?? new Set<string>();
    this.titleFreq = opts.titleFreq ?? new Map<string, number>();
    this.protect = new Set([...(opts.protect ?? []), ...SYNTAX]);
    this.joinable = new Set(opts.joinable ?? []);
    for (const w of this.freq.keys()) {
      // A query word of 8+ letters may be 2 edits away, and so may match a word of 6+ letters.
      for (const del of deletes(w, w.length >= 6 ? 2 : 1)) {
        const list = this.index.get(del);
        if (list) list.push(w);
        else this.index.set(del, [w]);
      }
    }
  }

  get size(): number {
    return this.freq.size;
  }

  /** A known word: in the vocabulary or protected. */
  private known(w: string): boolean {
    return this.freq.has(w) || this.protect.has(w) || this.joinable.has(w);
  }

  /** Known, or the plural or singular of a known word ("chargers", "glass"). */
  private knownForm(w: string): boolean {
    if (this.known(w) || this.dictionary.has(w)) return true;
    // Not for a word ending in "s": "cordles" is a typo of "cordless", not its singular.
    if (!w.endsWith("s") && (this.known(`${w}s`) || this.known(`${w}es`))) return true;
    if (w.endsWith("es") && this.known(w.slice(0, -2))) return true;
    return w.endsWith("s") && this.known(w.slice(0, -1));
  }

  /** Some vocabulary word starts with `p` (an unfinished word while typing). */
  private isPrefix(p: string): boolean {
    this.sorted ??= [...this.freq.keys(), ...this.protect, ...this.joinable].sort();
    const s = this.sorted;
    let lo = 0;
    let hi = s.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (s[mid] < p) lo = mid + 1;
      else hi = mid;
    }
    return lo < s.length && s[lo].startsWith(p);
  }

  /** The closest vocabulary word: fewest edits, then the same first letter, then the same length, then the most frequent. */
  private closest(w: string): string | null {
    const max = maxEdits(w.length);
    const seen = new Set<string>();
    let best: { w: string; d: number; first: number; len: number; f: number } | null = null;
    for (const del of deletes(w, max)) {
      for (const cand of this.index.get(del) ?? []) {
        if (seen.has(cand)) continue;
        seen.add(cand);
        const d = osaDistance(w, cand, max);
        if (d > max || (this.lettersChanged(w, cand, d) && !this.titleBacked(w, cand))) continue;
        const first = cand[0] === w[0] ? 1 : 0;
        // A short word with another first letter is more often a name we do not know ("nike").
        if (!first && w.length < SAME_FIRST_BELOW) continue;
        const f = this.freq.get(cand) ?? 0;
        const len = cand.length === w.length ? 1 : 0;
        const rank = (b: NonNullable<typeof best>) => b.d - d || first - b.first || len - b.len || f - b.f;
        if (!best || rank(best) > 0) {
          best = { w: cand, d, first, len, f };
        }
      }
    }
    return best?.w ?? null;
  }

  /** Only letters changed: same length and as many differing positions as edits (no swap). */
  private lettersChanged(w: string, cand: string, d: number): boolean {
    if (w.length !== cand.length) return false;
    let diff = 0;
    for (let i = 0; i < w.length; i++) if (w[i] !== cand[i]) diff++;
    return diff === d;
  }

  /** The target is clearly more frequent in product titles than the typed word (6+ letters only). */
  private titleBacked(w: string, cand: string): boolean {
    if (w.length < SUB_MIN_LEN) return false;
    const t = this.titleFreq.get(cand) ?? 0;
    return t >= SUB_MIN_TITLES && t >= SUB_MARGIN * (this.titleFreq.get(w) ?? 0);
  }

  /** The correction for one lower-case word, or null to keep it. */
  private fix(w: string, prefix: boolean, budget: { left: number }): string | null {
    if (w.length < MIN_LEN || w.length > MAX_WORD || !LETTERS.test(w) || this.knownForm(w)) return null;
    if (prefix && this.isPrefix(w)) return null;
    if (budget.left <= 0) return null;
    budget.left--;
    return this.closest(w);
  }

  /**
   * The query with misspelt words replaced. Untouched words keep the shopper's case and spacing.
   * `lastIsPrefix`: the last word may be unfinished (autocomplete), so a word it starts is no typo.
   */
  correct(query: string, opts: { lastIsPrefix?: boolean } = {}): Correction {
    // Bounded work whatever the caller sends: long queries are left as they are.
    if (query.length > MAX_CORRECT_CHARS) return { query, changed: false };
    const budget = { left: MAX_FIXES };
    const toks = [...query.matchAll(/\S+/g)].map((m) => ({ text: m[0], at: m.index ?? 0 }));
    const out: { text: string; at: number; end: number }[] = [];
    for (let i = 0; i < toks.length; i++) {
      const t = toks[i];
      const lower = t.text.toLowerCase();
      const next = toks[i + 1];
      const joined = next ? lower + next.text.toLowerCase() : "";
      // Not when the pair ends the query while typing: "air p" may become "air pods".
      const joinAllowed = !(opts.lastIsPrefix && i + 1 === toks.length - 1);
      if (next && joinAllowed && LETTERS.test(joined) && this.joinable.has(joined) && this.freq.has(joined) && !this.freq.has(`${lower} ${next.text.toLowerCase()}`)) {
        out.push({ text: joined, at: t.at, end: next.at + next.text.length });
        i++;
        continue;
      }
      const fixed = this.fix(lower, !!opts.lastIsPrefix && i === toks.length - 1, budget);
      out.push({ text: fixed ?? t.text, at: t.at, end: t.at + t.text.length });
    }
    let s = "";
    let pos = 0;
    for (const o of out) {
      s += query.slice(pos, o.at) + o.text;
      pos = o.end;
    }
    s += query.slice(pos);
    return { query: s, changed: s !== query };
  }
}
