import brands from "@/data/brands.json";
import type { Product } from "@/src/lib/types";
import { isLikelyMatch, rank, type SortKey } from "@/src/lib/rank";
import { normalizeTitle } from "./spec";

/**
 * Same product across stores (spec: "Comparison and deal-insight features", item 1). Rule-based:
 * - a shared model / part code ("WH-1000XM5", "SM-S921B") with no conflict is the same product;
 * - without one: the same brand, no conflict, and a token similarity of at least GROUP_THRESHOLD.
 * Conflicts (any one keeps two titles apart): different brands; codes that disagree (none shared,
 * a different first code, or a different model word right after the shared code); any spec both
 * state that differs (capacity, storage, RAM, wattage, size, generation, resolution, speed, model
 * number...); storage or RAM, or a multi-unit pack, stated by one side only; different variant
 * words (pro, plus, max...), condition (renewed, open box, grade B...), bundle, watch band or
 * material; one side an accessory (case, ear pads, replacement...) and the other not.
 * A wrong merge is worse than a missed one, so any doubt keeps the listings apart. Colours may
 * differ: a group lists each member's colour.
 */

/**
 * Minimum token similarity without a shared code: Jaccard weighted by each token's rarity in the
 * result set (IDF), averaged over the group's members. Chosen on the tuning half of the eval.
 */
export const GROUP_THRESHOLD = 0.6;

const priceOf = (p: Product) => p.finalPrice ?? p.listPrice;
const keyOf = (p: Pick<Product, "site" | "id">) => `${p.site}:${p.id}`;

/** Product-line words that name their brand. */
const BRAND_CANON: Record<string, string> = {
  iphone: "apple",
  ipad: "apple",
  macbook: "apple",
  imac: "apple",
  airpods: "apple",
  playstation: "sony",
  dualsense: "sony",
  xbox: "microsoft",
  pixel: "google",
  thinkpad: "lenovo",
  kindle: "amazon",
  galaxy: "samsung",
};
const KNOWN_BRANDS = new Set<string>([...brands, ...Object.keys(BRAND_CANON), "blackdecker"]);

/** Leading words that are not a brand ("Original Apple ...", "Wireless Earbuds ..."). */
const GENERIC_LEAD = new Set(
  (
    "original new genuine authentic official hot sale wireless portable smart mini electric professional premium " +
    "upgraded upgrade latest best high ultra super gaming bluetooth usb led digital automatic multifunctional " +
    "multifunction household home kids kid baby car mechanical rechargeable foldable waterproof magnetic fast " +
    "universal men women unisex mens womens for the with global version international brand luxury large small " +
    "cordless handheld stainless adjustable ergonomic compact lightweight heavy quiet noise active true open " +
    "air water travel outdoor office desk kitchen mini pro max plus classic vintage modern simple cute creative " +
    "hd full ultra-thin slim tws anc hifi stereo sports sport running fashion cheap quality top hot-selling " +
    "renewed refurbished used pack set kit lot pcs piece pair dual triple multi auto power heated cooling " +
    "replacement hard soft ear"
  ).split(/\s+/),
);

const COLORS = new Set(
  (
    "black white silver gold blue red green pink purple gray grey yellow orange beige brown rose midnight " +
    "starlight graphite titanium natural desert ultramarine teal navy cream ivory lavender mint coral charcoal " +
    "sky violet lilac khaki olive burgundy maroon turquoise cyan magenta champagne bronze copper platinum " +
    "onyx cobalt jade amber sage sand stone obsidian porcelain hazel pearl chroma cosmic galactic volcanic " +
    "camouflage camo sterling nova ice alpine indigo emerald ruby sapphire crimson scarlet arctic frost ocean " +
    "forest lime peach plum wine mocha"
  ).split(/\s+/),
);
const COLOR_PAIRS = ["space gray", "space grey", "space black", "rose gold", "jet black", "sky blue", "navy blue", "light blue", "dark blue", "light gray", "dark gray", "dark green", "light pink", "hot pink", "army green"];
const COLOR_PAIR_RE = new RegExp(`\\b(?:${COLOR_PAIRS.join("|")})\\b`);

/** Words that name a different model of the same line or a special run. Two titles must carry the same set. */
const VARIANT_WORDS = new Set(
  "pro plus max ultra mini lite se fe air slim edge note neo xl xs gps cellular kids prime turbo limited special tkl massage".split(" "),
);
const GLUED_VARIANT = /^((?:[a-z])?\d{1,2})(pro|plus|max|ultra|fe|se|mini|lite)$/;

/** Words that use a variant word for something else: "Ultra HD", "Rapid Air", "Max 4K", "Edge Mop". */
const VARIANT_NOISE =
  /\bultra[\s-]*(?:hd|slim|thin|quiet|light(?:weight)?|wide|fast|soft|clear|compact|long|high|strong|powerful|sharp|portable|low|bass)\b|\bmax(?:imum)?\s*(?:\d|up\s*to|crisp|power|speed)|\bedge\s*(?:mop|light(?:ing)?|brush(?:es)?|cleaning)\b|\b(?:rapid|hot)\s*air\b|\bair\s*(?:fry(?:er|ing)?|purifiers?|circulation|flow|filter|quality|technology|pump|cushion|conditioner)\b|\bairfryer\b|\bpro[\s-]*(?:grade|level|quality)\b/g;

/**
 * A true compatibility list: "for / compatible with" followed by devices it fits ("for iPhone 17
 * 16 15 Pro Max", "compatible with PS5, PC"), up to the next separator. Its model and variant
 * words describe the other device. Other "for ..." phrases ("for Home Bedroom, Core 300S Pro",
 * "for Travel - Renewed") stay: their words describe the item.
 */
const COMPAT =
  /\b(?:for|compatible(?:\s+with)?|fits?|works\s+with)\s+(?:the\s+|all\s+|most\s+)?(?:apple\s+|samsung\s+|google\s+)?(?:iphones?|ipads?|macbooks?|mac|imac|samsung|galaxy|android|ios|pcs?|laptops?|computers?|ps[345]|playstation|xbox|nintendo|switch|pixel|xiaomi|huawei|windows|tablets?|smartphones?|phones?|cars?|trucks?|airpods|steam)\b[^|,;()[\]–]*/g;
/** "Upgrade from P40i", "Upgraded from Q7 TF": the older model it replaces. */
const UPGRADE_FROM = /\bupgrad(?:e|ed)\s+(?:from|of|version\s+of)\s+[^|,;()[\]–]*/g;

/** Condition other than new. Two titles must state the same condition (grade included). */
const CONDITIONS: [string, RegExp][] = [
  ["refurbished", /\b(?:renewed|refurbished|reconditioned|remanufactured|refurb)\b/],
  ["used", /\b(?:pre[-\s]?owned|second[-\s]?hand)\b|\bused\b(?!\s+(?:for|to|in|with|by|as|on|at)\b)/],
  ["open-box", /\bopen[-\s]?box(?:ed)?\b/],
  ["like-new", /\blike[-\s]?new\b/],
];
const GRADE = /\bgrade\s*([abc])\b/;
const CONDITION_HINT = /renew|refurb|recondition|remanufactur|used|owned|hand|open|like/;

/**
 * Sold with something else: "+ 2 Pack Film", "with USB Cable", "+ EA FC 25", "& Replacement Filter
 * Bundle". A bundle is another product than the item alone.
 */
const BUNDLE =
  /(?:\s\+\s*|\bwith\s+)(?:\d+\s*(?:x\s*)?(?:pack\s+|pcs?\s+)?)?(?:[a-z0-9-]+\s+){0,2}?(?:film|films|cable|charger|card|bag|strap|game|games|controller|headset)\b|\bbundle\b/;

/** Watch band types: two watches with different bands are different listings ("Milanese" vs "Alpine Loop"). */
const BAND = /\b(alpine|trail|ocean|milanese|sport|link|solo|braided|nike|leather)\s+(?:[a-z]+\s+)?(?:loop|band|bracelet)\b/g;

/**
 * Nouns that make the item an accessory of the product (a subset of data/accessory-words.json
 * without words that also describe products: filter, glass, stand, dock, cable...). Read from the
 * title's own part (before "with" / " + "). "Aluminium Case" on a watch is the watch.
 */
const ACCESSORY_NOUNS = new Set(
  "case cases cover covers protector protectors replacement skin skins sticker stickers keycap keycaps pad pads earpads cushion cushions spare parts accessory accessories sleeve".split(" "),
);
const ACCESSORY_HINT = /case|cover|protector|replacement|skin|sticker|keycap|pad|cushion|spare|parts|accessor|sleeve/;
const NOT_ACCESSORY = /\b(?:aluminium|aluminum|titanium|steel|ceramic|charging|wireless\s+charging)\s+case\b/g;

const STOP = new Set(
  "for with and the of in to by on new original compatible version edition model 2024 2025 2026 a an or".split(" "),
);

/** Spec dimensions read from titles. Values are canonical strings; each dimension is a set. */
type Dim =
  | "mah" | "storage" | "ram" | "watt" | "inch" | "mm" | "hz" | "litre" | "gen" | "res" | "net" | "bt"
  | "count" | "in1" | "dpi" | "kg" | "mp" | "year" | "pa" | "mbs" | "gbps" | "model" | `qty:${string}`;

export type TitleFeatures = {
  /** Canonical brand from data/brands.json (or a product line naming it), else undefined. */
  knownBrand?: string;
  /** A capitalised leading word that may be a brand not in the list. */
  leadWord?: string;
  /** Brand used for matching: knownBrand, else leadWord (groupProducts drops lead words that are product words). */
  brand?: string;
  codes: Set<string>;
  /** The first code in title order. */
  firstCode?: string;
  /** The word right after each code (when a space follows it), colours and stop words skipped. */
  codeNext: Map<string, string>;
  specs: Map<Dim, Set<string>>;
  /** Variant words plus "bundle", "band:<type>" and condition ("cond:refurbished", "cond:grade-b"). */
  variants: Set<string>;
  accessory: boolean;
  /** Words (no colours, no stop words, no digits) plus canonical spec and model tokens. */
  tokens: Set<string>;
  color?: string;
  /** Precomputed for fast comparison. */
  variantKey: string;
  exclusive: string[];
  specVals: Set<string>;
};

const num = (s: string) => String(Number(s));

/** "128/256/512GB" -> "128GB 256GB 512GB" so every listed value carries its unit. */
function expandLists(t: string): string {
  return t.replace(
    /(\d+(?:\.\d+)?(?:\s*(?:gb|tb|w|mah|mm|l|ml))?(?:\s*\/\s*\d+(?:\.\d+)?(?:\s*(?:gb|tb|w|mah|mm|l|ml))?)+)\s*(gb|tb|w|mah|mm|l|ml)(?![a-z])/g,
    (_m, list: string, unit: string) =>
      list
        .split("/")
        .map((x) => `${x.trim().replace(/[a-z]+$/, "")}${unit}`)
        .join(" ") + " ",
  );
}

/** Lowercase, thousands separators gone, "S24+" -> "S24 plus", lists expanded. */
function prepare(title: string): string {
  const t = normalizeTitle(title).replace(/\bblack\s*(?:\+|&|and)\s*decker\b/g, "blackdecker");
  return expandLists(t.replace(/(\b[a-z]+\d+)\+(?![a-z0-9])/g, "$1 plus "));
}

/** The title without compatibility lists and "upgrade from" phrases. */
const ownText = (t: string) => t.replace(COMPAT, " ").replace(UPGRADE_FROM, " ");

/** dim null: cut out as noise (playtime hours, IP rating, latency...), never compared. */
type SpecRule = { dim: Dim | null; re: RegExp; val: (m: RegExpExecArray) => string; hint?: string[] };

/** Counted features ("12 functions", "3 channel"): compared per feature, "qty:function". */
const QTY =
  /(?<![\d.])(\d+)\+?\s*-?\s*(mic|mode|speed|level|button|key|function|program|setting|preset|cup|layer|stage|sensor|channel|port|output|camera|head|attachment|drawer|basket|zone|blade|piece|burner|slice|egg|bar)s?\b/g;

/** Order matters: each match is cut out of the title before the next rule and the model numbers. */
const SPEC_RULES: SpecRule[] = [
  { hint: ["in"], dim: "in1", re: /(?<![\d.])(\d+)\s*-?\s*in\s*-?\s*1\b/g, val: (m) => m[1] },
  { hint: ["ram", "memory", "ddr"], dim: "ram", re: /(?<![\d.])(\d+)\s*gb\s*(?:of\s*)?(?:ram|memory|lpddr\d*x?|ddr\d*)\b/g, val: (m) => m[1] },
  { dim: "ram", re: /\bram\s*:?\s*(\d+)\s*gb\b/g, val: (m) => m[1] },
  { hint: ["mb"], dim: "mbs", re: /(?<![\d.])(\d+)\s*(?:mb\s*\/\s*s|mbps|mb\s*per\s*s)/g, val: (m) => m[1] },
  { hint: ["gb"], dim: "gbps", re: /(?<![\d.])(\d+)\s*(?:gb\s*\/\s*s|gbps)/g, val: (m) => m[1] },
  { hint: ["gb", "tb"], dim: "storage", re: /(?<![\d.])(\d+(?:\.\d+)?)\s*(gb|tb)(?![a-z])/g, val: (m) => num(String(Number(m[1]) * (m[2] === "tb" ? 1024 : 1))) },
  { hint: ["mah"], dim: "mah", re: /(?<![\d.])(\d+(?:\.\d+)?)\s*mah\b/g, val: (m) => num(m[1]) },
  { hint: ["w"], dim: "watt", re: /(?<![\d.])(\d+(?:\.\d+)?)\s*(?:w|watts?)(?![a-z])/g, val: (m) => num(m[1]) },
  { hint: ['"', "in", "”", "''"], dim: "inch", re: /(?<![\d.])(\d+(?:\.\d+)?)\s*(?:"|''|”|-?\s*inch(?:es)?\b|in\b)/g, val: (m) => num(m[1]) },
  { hint: ["mm"], dim: "mm", re: /(?<![\d.])(\d+(?:\.\d+)?)\s*mm\b/g, val: (m) => num(m[1]) },
  { hint: ["hz"], dim: "hz", re: /(?<![\d.])(\d+)\s*hz\b/g, val: (m) => m[1] },
  { hint: ["ml"], dim: "litre", re: /(?<![\d.])(\d+(?:\.\d+)?)\s*ml\b/g, val: (m) => num(String(Number(m[1]) / 1000)) },
  { hint: ["l"], dim: "litre", re: /(?<![\d.])(\d+(?:\.\d+)?)\s*(?:l|lt|ltr|liters?|litres?)\b/g, val: (m) => num(m[1]) },
  { hint: ["gen"], dim: "gen", re: /(?<![\d.])(\d+)(?:st|nd|rd|th)?\s*-?\s*gen(?:eration)?\b/g, val: (m) => m[1] },
  { dim: "gen", re: /\bgen(?:eration)?\s*-?\s*(\d+)\b/g, val: (m) => m[1] },
  { hint: ["k"], dim: "res", re: /(?<![\d.])([248])k\b/g, val: (m) => ({ "2": "1440", "4": "2160", "8": "4320" })[m[1]]! },
  { hint: ["p"], dim: "res", re: /(?<![\d.])(720|1080|1440|2160)p\b/g, val: (m) => m[1] },
  { dim: "res", re: /\b(fhd|qhd|uhd)\b/g, val: (m) => ({ fhd: "1080", qhd: "1440", uhd: "2160" })[m[1]]! },
  { hint: ["g"], dim: "net", re: /(?<![\d.])([345])g\b/g, val: (m) => m[1] },
  { hint: ["bluetooth", "bt"], dim: "bt", re: /\b(?:bluetooth|bt)\s*v?\s*(\d(?:\.\d)?)\b/g, val: (m) => num(m[1]) },
  { hint: ["pc", "piece", "pack", "pk", "count", "ct"], dim: "count", re: /(?<![\d.])(\d+)\s*(?:pcs|pieces?|pack|pk|count|ct)\b/g, val: (m) => m[1] },
  { dim: "count", re: /\b(?:pack|set)\s*of\s*(\d+)\b/g, val: (m) => m[1] },
  { hint: ["dpi"], dim: "dpi", re: /(?<![\d.])(\d+)\s*dpi\b/g, val: (m) => m[1] },
  { hint: ["kg"], dim: "kg", re: /(?<![\d.])(\d+(?:\.\d+)?)\s*kg\b/g, val: (m) => num(m[1]) },
  { hint: ["mp"], dim: "mp", re: /(?<![\d.])(\d+(?:\.\d+)?)\s*mp\b/g, val: (m) => num(m[1]) },
  { hint: ["20"], dim: "year", re: /(?<![\d.])(20[12]\d)(?![\d.])/g, val: (m) => m[1] },
  { hint: ["pa"], dim: "pa", re: /(?<![\d.])(\d+)\s*pa\b/g, val: (m) => m[1] },
  { dim: null, re: /(?<![\d.])\d+(?:\.\d+)?\s*-?\s*(?:h|hrs?|hours?|years?|yrs?|months?|days?|mins?|minutes?)\b/g, val: () => "" },
  { dim: null, re: /\bipx?\s*\d+\b/g, val: () => "" },
  { dim: null, re: /(?<![\d.])\d+(?:\.\d+)?\s*(?:db|ms|d|g\/min|rpm|cm|m|kpa|v|a|°)(?![a-z])/g, val: () => "" },
  { dim: null, re: /\b\d{2,4}\s*[x×*]\s*\d{2,4}\b/g, val: () => "" },
  { hint: ["k"], dim: null, re: /(?<![\d.])\d+(?:\.\d+)?k\b/g, val: () => "" },
  { dim: null, re: /\bqi\s*\d\b/g, val: () => "" },
];

/** Component codes (mouse and camera sensors) name a part many models share, not a model. */
const COMPONENT_CODE = /^(?:paw|pmw|imx|ov)\d+/;

/** Normalized tokens with digits that are specs, not model codes ("100w", "bt5.3", "ipx7"). */
const SPEC_TOKEN =
  /^(?:\d+(?:\.\d+)?(?:mah|gb|tb|mb|w|watts?|inch|inches|in|mm|cm|m|hz|khz|ghz|mhz|l|ml|lt|ltr|k|p|g|v|a|kg|mp|pcs|pc|pack|pk|x|nm|st|nd|rd|th|fps|ms|db|rpm|pa|kpa|oz|lb|lbs|h|hrs|min|s|d|bit|core|cores|ft|dpi|kw|ah|wh|n|c|f|t|e|fe)|(?:gen|wifi|bt|ble|usb|ip|ipx|ddr|lpddr|gddr|pcie|hdmi|qi|type|cat|series|ver|pd|qc|uhs|class|level|vol)\d+(?:\.\d+)?[a-z]?|v\d{1,2}(?:\.\d)?|\d+(?:\.\d+)?(?:x\d+(?:\.\d+)?)+[a-z]*|(?:hdr|pm|spo|win|rj|gen\d+x)\d+(?:\.\d+)?|\d+in\d+|\d+(?:gbps|mbps|kbps)|\d+[a-z]{3,})$/;

const isCode = (t: string, n: string) =>
  /\d/.test(t) &&
  /[a-z]/.test(t) &&
  n.length >= 4 &&
  !SPEC_TOKEN.test(t) &&
  !SPEC_TOKEN.test(n) &&
  !COMPONENT_CODE.test(n) &&
  // A line name or variant glued to its number: "iphone16", "airpods4", "air5", "16pro", "s24ultra".
  !/^(?:[a-z]{4,}\d+|(?:air|pro|max|mini)\d{1,2})$/.test(n) &&
  !GLUED_VARIANT.test(n);

/** Codes in title order, each with the word right after it (when only a space separates them). */
function scanCodes(prepared: string): { codes: string[]; next: Map<string, string> } {
  const parts = prepared.split(/([^a-z0-9.\-]+)/);
  const codes: string[] = [];
  const next = new Map<string, string>();
  for (let i = 0; i < parts.length; i += 2) {
    const t = parts[i].replace(/^[.\-]+|[.\-]+$/g, "");
    const n = t.replace(/[-.]/g, "");
    if (!isCode(t, n)) continue;
    const c = n.toUpperCase();
    if (!codes.includes(c)) codes.push(c);
    if (next.has(c)) continue;
    // The next word, colours and stop words skipped, only across plain spaces.
    for (let j = i + 2; j < parts.length && /^\s+$/.test(parts[j - 1]); j += 2) {
      const w = parts[j].replace(/^[.\-]+|[.\-]+$/g, "");
      if (!w || COLORS.has(w) || STOP.has(w)) continue;
      next.set(c, w);
      break;
    }
  }
  return { codes, next };
}

/** Model / part codes: tokens with letters and digits, 4+ characters without hyphens, not specs. */
export function modelCodes(title: string): string[] {
  return scanCodes(prepare(title)).codes;
}

/** Variant words of a title (pro, plus, max, ...). */
export function variantWords(title: string): Set<string> {
  return new Set(words(ownText(prepare(title)).replace(VARIANT_NOISE, " ")).filter((w) => VARIANT_WORDS.has(w)));
}

/** The title's colour ("black", "space gray"), if it names one. */
export function colorOf(title: string): string | undefined {
  const t = normalizeTitle(title);
  const pair = t.match(COLOR_PAIR_RE);
  if (pair) return pair[0];
  return words(t).find((w) => COLORS.has(w));
}

/** Word tokens: letters and digits, dots kept inside numbers; "iphone16" -> "iphone", "16". */
function words(t: string): string[] {
  const out: string[] = [];
  for (let w of t.split(WORD_SPLIT)) {
    if (w.startsWith(".") || w.endsWith(".")) w = w.replace(/^\.+|\.+$/g, "");
    if (!w) continue;
    if (!HAS_DIGIT.test(w)) {
      out.push(w);
      continue;
    }
    if (/^ps\d$/.test(w)) {
      out.push("playstation", w.slice(2));
      continue;
    }
    const m = w.match(GLUED_LINE) ?? w.match(GLUED_VARIANT);
    if (m) out.push(m[1], m[2]);
    else out.push(w);
  }
  return out;
}
const WORD_SPLIT = /[^a-z0-9.\p{L}]+/u;
const HAS_DIGIT = /\d/;
const GLUED_LINE = /^([a-z]{4,}|air|pro|max|mini)(\d{1,2})$/;

/** Word families where two titles naming different members are different products. */
const EXCLUSIVE: Set<string>[] = [
  "fabric leather mesh velvet",
  "glass plastic stainless steel metal aluminium aluminum wood bamboo",
  "wired wireless cordless corded",
  "digital mechanical manual analog",
].map((g) => new Set(g.split(" ")));

export function titleFeatures(title: string): TitleFeatures {
  const prepared = prepare(title);
  const { codes: codeList, next: codeNext } = scanCodes(prepared);
  const codes = new Set(codeList);
  const specs = new Map<Dim, Set<string>>();
  const add = (d: Dim, v: string) => {
    let s = specs.get(d);
    if (!s) specs.set(d, (s = new Set()));
    s.add(v);
  };
  // Cut codes out first so their digits are not read as specs ("WH-1000XM5" is not 1000 of anything).
  let rest = !codes.size
    ? prepared
    : prepared
    .split(/(\s+)/)
    .map((w) => {
      const n = w.replace(/^[.\-,;:()[\]]+|[.\-,;:()[\]]+$/g, "").replace(/[-.]/g, "").toUpperCase();
      return codes.has(n) ? " " : w;
    })
    .join("");
  for (const r of SPEC_RULES) {
    // hint: substrings a match needs; a cheap skip for titles without them.
    if (r.hint && !r.hint.some((h) => rest.includes(h))) continue;
    rest = rest.replace(r.re, (...args) => {
      const m = args.slice(0, -2) as unknown as RegExpExecArray;
      if (r.dim) add(r.dim, r.val(m));
      return " ";
    });
  }
  rest = rest.replace(QTY, (_m, n: string, what: string) => {
    add(`qty:${what}`, n);
    return " ";
  });
  const ws = words(rest);
  const own = ownText(rest);
  // Bare numbers and short letter+digit tokens ("16", "s24", "m3", "16e"), compatibility lists
  // left out: the model number. Decimals ("2.0") and long digit runs (SKUs) are not.
  for (const w of words(own)) if (/\d/.test(w) && !/^\d+\.\d+$/.test(w) && !/^\d{6,}$/.test(w)) add("model", w);

  const variants = new Set(words(own.replace(VARIANT_NOISE, " ")).filter((w) => VARIANT_WORDS.has(w)));
  if (BUNDLE.test(prepared)) variants.add("bundle");
  for (const m of prepared.matchAll(BAND)) variants.add(`band:${m[1]}`);
  if (CONDITION_HINT.test(prepared)) for (const [name, re] of CONDITIONS) if (re.test(prepared)) variants.add(`cond:${name}`);
  const grade = prepared.match(GRADE);
  if (grade) variants.add(`cond:grade-${grade[1]}`);

  const core = prepared.split(/\b(?:with|includes?|including)\b|\s[+&]\s/)[0].replace(NOT_ACCESSORY, " ");
  const accessory = ACCESSORY_HINT.test(core) && words(core).some((w) => ACCESSORY_NOUNS.has(w));

  const plain = ws.filter((w) => !/\d/.test(w));
  const pair = prepared.match(COLOR_PAIR_RE);
  const color = pair ? pair[0] : ws.find((w) => COLORS.has(w));
  const colorWords = new Set(color ? color.split(" ") : []);
  const tokens = new Set<string>();
  for (const w of plain) if (w.length > 1 && !STOP.has(w) && !COLORS.has(w) && !colorWords.has(w)) tokens.add(w);
  for (const [d, vs] of specs) for (const v of vs) tokens.add(`${d}:${v}`);
  for (const c of codes) tokens.add(`code:${c}`);

  // The item's own brand, compatibility lists left out (a PS5 controller by KISSUN).
  const known = own.split(/[^a-z0-9\p{L}]+/u).find((w) => KNOWN_BRANDS.has(w));
  const knownBrand = known ? (BRAND_CANON[known] ?? known) : undefined;
  const first = title.trim().split(/[^\p{L}\p{N}&'-]+/u).find(Boolean) ?? "";
  const leadWord =
    /^\p{Lu}[\p{L}&'-]{2,}$/u.test(first) && !first.toLowerCase().split("-").some((w) => GENERIC_LEAD.has(w) || COLORS.has(w))
      ? first.toLowerCase()
      : undefined;

  const specVals = new Set([...specs].filter(([d]) => d !== "model").flatMap(([, v]) => [...v]));
  const fam: string[][] = EXCLUSIVE.map(() => []);
  for (const t of tokens) for (let i = 0; i < EXCLUSIVE.length; i++) if (EXCLUSIVE[i].has(t)) fam[i].push(t);
  const exclusive = fam.map((x) => x.sort().join(" "));
  return {
    knownBrand,
    leadWord,
    brand: knownBrand ?? leadWord,
    codes,
    firstCode: codeList[0],
    codeNext,
    specs,
    variants,
    accessory,
    tokens,
    color,
    variantKey: [...variants].sort().join(" "),
    exclusive,
    specVals,
  };
}

/** Dimensions where a value stated by one title only is still a conflict. */
const ONE_SIDED: Dim[] = ["storage", "ram"];

/**
 * Some spec both titles state differs (any dimension, model number included); storage or RAM
 * stated by one side only; a pack of more than one on one side only. A bare model number the
 * other title states as a spec ("Watch 44" vs "44mm") is no conflict.
 */
export function specConflict(a: TitleFeatures, b: TitleFeatures): boolean {
  for (const d of ONE_SIDED) if (a.specs.has(d) !== b.specs.has(d)) return true;
  if (multiPack(a) !== multiPack(b)) return true;
  for (const [d, va] of a.specs) {
    const vb = b.specs.get(d);
    if (!vb) continue;
    if (d === "model") {
      const x = modelOnly(va, b);
      const y = modelOnly(vb, a);
      if (x.size && y.size && !setsEqual(x, y)) return true;
    } else if (!setsEqual(va, vb)) return true;
  }
  return false;
}

const multiPack = (f: TitleFeatures) => [...(f.specs.get("count") ?? [])].some((v) => Number(v) > 1);

/** Model numbers minus values the other title states as a spec. */
function modelOnly(model: Set<string>, other: TitleFeatures): Set<string> {
  let out: Set<string> | null = null;
  for (const m of model)
    if (other.specVals.has(m)) {
      out ??= new Set(model);
      out.delete(m);
    }
  return out ?? model;
}

const setsEqual = (a: Set<string>, b: Set<string>) => {
  if (a.size !== b.size) return false;
  for (const x of a) if (!b.has(x)) return false;
  return true;
};

/** Token weight: rarer tokens in the result set weigh more (a differing "Access" or "Fortnite" counts). */
export type Weight = (token: string) => number;

/** Weighted Jaccard; plain Jaccard without weights. */
function jaccard(a: Set<string>, b: Set<string>, w: Weight = () => 1): number {
  let inter = 0;
  let union = 0;
  for (const x of a) {
    const wx = w(x);
    union += wx;
    if (b.has(x)) inter += wx;
  }
  for (const x of b) if (!a.has(x)) union += w(x);
  return union ? inter / union : 0;
}

/** Inverse document frequency over the result set's titles: log(1 + N / df), precomputed. */
function idfWeights(fs: TitleFeatures[]): Weight {
  const df = new Map<string, number>();
  for (const f of fs) for (const t of f.tokens) df.set(t, (df.get(t) ?? 0) + 1);
  const n = fs.length;
  const w = new Map<string, number>();
  for (const [t, d] of df) w.set(t, Math.log(1 + n / d));
  const unseen = Math.log(1 + n);
  return (t) => w.get(t) ?? unseen;
}

/** A word right after a code that names a model ("G502 X", "G502 Hero", "M550 Max"). */
const tightWord = (w: string) => VARIANT_WORDS.has(w) || w.length <= 2 || /\d/.test(w) || w === "hero";

function sharesCode(a: TitleFeatures, b: TitleFeatures): boolean {
  for (const c of a.codes) if (b.codes.has(c)) return true;
  return false;
}

/** Codes disagree: none shared, different first codes, or a different model word right after a shared code. */
function codeConflict(a: TitleFeatures, b: TitleFeatures): boolean {
  if (!a.codes.size || !b.codes.size) return false;
  if (!sharesCode(a, b) || a.firstCode !== b.firstCode) return true;
  for (const c of a.codes) {
    if (!b.codes.has(c)) continue;
    const x = a.codeNext.get(c);
    const y = b.codeNext.get(c);
    if (x !== y && ((x !== undefined && tightWord(x)) || (y !== undefined && tightWord(y)))) return true;
  }
  return false;
}

/** Hard evidence of different products (see the module comment). */
function conflicts(a: TitleFeatures, b: TitleFeatures): boolean {
  if (a.brand && b.brand && a.brand !== b.brand) return true;
  if (a.knownBrand && b.knownBrand && a.knownBrand !== b.knownBrand) return true;
  if (a.variantKey !== b.variantKey || a.accessory !== b.accessory) return true;
  for (let i = 0; i < a.exclusive.length; i++) if (a.exclusive[i] && b.exclusive[i] && a.exclusive[i] !== b.exclusive[i]) return true;
  if (codeConflict(a, b)) return true;
  return specConflict(a, b);
}

export type MatchOptions = { threshold?: number; weight?: Weight };

/** Two titles are the same product (see the module comment). */
export function sameProduct(a: TitleFeatures, b: TitleFeatures, opts: MatchOptions = {}): boolean {
  if (conflicts(a, b)) return false;
  if (sharesCode(a, b)) return true;
  return !!a.brand && a.brand === b.brand && jaccard(a.tokens, b.tokens, opts.weight) >= (opts.threshold ?? GROUP_THRESHOLD);
}

export type ProductGroup = {
  key: string;
  /** Every member, cheapest first (so each store's cheapest listing comes before its others). */
  members: Product[];
  /** The cheapest confident member (the cheapest member when none is confident). */
  best: Product;
  /** Stores in the group, by their cheapest price. */
  stores: string[];
  /** Colour named by each member's title, by "site:id". */
  colors: Record<string, string>;
};

/** Search-response form of a group (ids only). */
export type GroupRef = { key: string; memberKeys: string[]; bestKey: string; colors: Record<string, string> };

const tierOf = (p: Product) => (isLikelyMatch(p) ? 0 : p.weakMatch ? 2 : 1);

type Item = { p: Product; f: TitleFeatures; k: string };
/** uniq: one member per distinct title (identical titles need one comparison). */
type Cluster = { items: Item[]; uniq: Item[]; titles: Set<string>; brand?: string };

/** Members a newcomer's similarity is averaged over (the cluster's first, i.e. best-tier cheapest). */
const SIM_SAMPLE = 12;

/**
 * How well a title fits a cluster: 0 when it conflicts with any member; otherwise its mean
 * similarity to the members (average linkage, so a cluster cannot drift member by member), plus 1
 * when it shares a code with a member. Without a shared code it needs the cluster's brand and the
 * threshold.
 */
function fit(f: TitleFeatures, c: Cluster, threshold: number, w: Weight): number {
  let code = false;
  for (const m of c.uniq) {
    if (conflicts(f, m.f)) return 0;
    if (!code && sharesCode(f, m.f)) code = true;
  }
  if (!code && (!f.brand || c.brand !== f.brand || c.uniq.some((m) => m.f.brand !== f.brand))) return 0;
  const sample = c.uniq.length > SIM_SAMPLE ? c.uniq.slice(0, SIM_SAMPLE) : c.uniq;
  const mean = sample.reduce((s, m) => s + jaccard(f.tokens, m.f.tokens, w), 0) / sample.length;
  if (code) return 1 + mean;
  return mean >= threshold ? mean : 0;
}

/**
 * Groups the same product across stores. Every product lands in exactly one group; a group with
 * one store is split back into single-product groups (same-store look-alikes are dedupe's job).
 * A product joins the cluster it fits best (see fit). Only clusters sharing its brand or one of
 * its codes are candidates (a match needs one or the other), which keeps this near linear.
 * Products are taken by tier, price and key, so the result does not depend on input order.
 */
export function groupProducts(products: Product[], opts: MatchOptions = {}): ProductGroup[] {
  const items: Item[] = products
    .map((p) => ({ p, f: cachedFeatures(p.title), k: keyOf(p) }))
    .sort((x, y) => tierOf(x.p) - tierOf(y.p) || priceOf(x.p) - priceOf(y.p) || (x.k < y.k ? -1 : x.k > y.k ? 1 : 0));
  const fs = items.map((i) => i.f);
  resolveLeadBrands(fs);
  dropSharedCodes(fs);
  const w = opts.weight ?? idfWeights(fs);
  const threshold = opts.threshold ?? GROUP_THRESHOLD;

  const clusters: Cluster[] = [];
  const byBrand = new Map<string, Cluster[]>();
  const byCode = new Map<string, Set<Cluster>>();
  for (const it of items) {
    const cands = new Set<Cluster>(it.f.brand ? byBrand.get(it.f.brand) : undefined);
    for (const c of it.f.codes) for (const cl of byCode.get(c) ?? []) cands.add(cl);
    let best: Cluster | null = null;
    let bestSim = 0;
    for (const c of cands) {
      const sim = fit(it.f, c, threshold, w);
      if (sim > bestSim) {
        bestSim = sim;
        best = c;
      }
    }
    if (!best) {
      best = { items: [], uniq: [], titles: new Set(), brand: it.f.brand };
      clusters.push(best);
    }
    best.items.push(it);
    if (!best.titles.has(it.p.title)) {
      best.titles.add(it.p.title);
      best.uniq.push(it);
    }
    if (it.f.brand && !(byBrand.get(it.f.brand) ?? []).includes(best)) byBrand.set(it.f.brand, [...(byBrand.get(it.f.brand) ?? []), best]);
    for (const c of it.f.codes) byCode.set(c, (byCode.get(c) ?? new Set()).add(best));
  }

  const out: ProductGroup[] = [];
  for (const c of clusters) {
    const parts = new Set(c.items.map((x) => x.p.site)).size > 1 ? [c.items] : c.items.map((x) => [x]);
    for (const part of parts) out.push(makeGroup(part));
  }
  return out;
}

/** Features by title, shared across searches (titles repeat: re-searches, alerts, duplicates). */
const featureCache = new Map<string, TitleFeatures>();
const FEATURE_CACHE_MAX = 5000;

/** A copy groupProducts may change (brand, codes and tokens are adjusted per result set). */
function cachedFeatures(title: string): TitleFeatures {
  let f = featureCache.get(title);
  if (!f) {
    f = titleFeatures(title);
    if (featureCache.size >= FEATURE_CACHE_MAX) featureCache.delete(featureCache.keys().next().value as string);
    featureCache.set(title, f);
  }
  return { ...f, codes: new Set(f.codes), tokens: new Set(f.tokens) };
}

function makeGroup(items: Item[]): ProductGroup {
  const sorted = [...items].sort((x, y) => priceOf(x.p) - priceOf(y.p) || (x.k < y.k ? -1 : x.k > y.k ? 1 : 0));
  const members = sorted.map((x) => x.p);
  const best = members.find(isLikelyMatch) ?? members[0];
  const colors: Record<string, string> = {};
  for (const x of sorted) if (x.f.color) colors[x.k] = x.f.color;
  return {
    key: `g:${sorted.map((x) => x.k).sort()[0]}`,
    members,
    best,
    stores: [...new Set(members.map((p) => p.site))],
    colors,
  };
}

/**
 * A capitalised leading word counts as a brand only when this result set uses it mostly as a
 * leading word: a brand leads its titles ("Philips Air Fryer"), a product word mostly does not
 * ("Fryer" in "Philips Air Fryer"). Clears `brand` for lead words that fail.
 */
function resolveLeadBrands(fs: TitleFeatures[]): void {
  const lead = new Map<string, number>();
  const inner = new Map<string, number>();
  for (const f of fs) if (f.leadWord) lead.set(f.leadWord, (lead.get(f.leadWord) ?? 0) + 1);
  for (const f of fs) for (const w of f.tokens) if (lead.has(w) && w !== f.leadWord) inner.set(w, (inner.get(w) ?? 0) + 1);
  for (const f of fs) {
    if (f.knownBrand || !f.leadWord) continue;
    f.brand = (lead.get(f.leadWord) ?? 0) >= (inner.get(f.leadWord) ?? 0) ? f.leadWord : undefined;
  }
}

/**
 * A code that titles of two or more brands carry names something they share (a sensor, a
 * compatible model), not their own model: it is no evidence here.
 */
function dropSharedCodes(fs: TitleFeatures[]): void {
  const brandsOf = new Map<string, Set<string>>();
  for (const f of fs) {
    if (!f.brand) continue;
    for (const c of f.codes) brandsOf.set(c, (brandsOf.get(c) ?? new Set()).add(f.brand));
  }
  for (const f of fs) {
    let changed = false;
    for (const c of [...f.codes])
      if ((brandsOf.get(c)?.size ?? 0) > 1) {
        f.codes.delete(c);
        f.tokens.delete(`code:${c}`);
        changed = true;
      }
    if (changed) f.firstCode = [...f.codes][0];
  }
}

/**
 * Display order of groups under a sort: each group stands at its best member under that sort
 * (confident members first, as in rank), and members stay cheapest first. Pure and client-safe.
 */
export function orderGroups(groups: ProductGroup[], sort: SortKey): ProductGroup[] {
  const lead = new Map<Product, ProductGroup>();
  for (const g of groups) lead.set(rank(g.members, sort)[0], g);
  return rank([...lead.keys()], sort).map((p) => lead.get(p)!);
}

/** Multi-store groups as ids only, for the search response. */
export function groupRefs(groups: ProductGroup[]): GroupRef[] {
  return groups
    .filter((g) => g.members.length > 1)
    .map((g) => ({ key: g.key, memberKeys: g.members.map(keyOf), bestKey: keyOf(g.best), colors: g.colors }));
}
