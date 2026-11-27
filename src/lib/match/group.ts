import brands from "@/data/brands.json";
import type { Product } from "@/src/lib/types";
import { isLikelyMatch, rank, type SortKey } from "@/src/lib/rank";
import { normalizeTitle } from "./spec";

/**
 * Same product across stores (spec: "Comparison and deal-insight features", item 1). Rule-based:
 * - a shared model / part code ("WH-1000XM5", "SM-S921B") with the same brand and no conflicting
 *   spec is the same product;
 * - without one: the same brand, every spec both titles state agrees (capacity, storage, RAM,
 *   wattage, size, generation, resolution, model number...), the same variant words (pro, plus,
 *   max...) and a token similarity of at least GROUP_THRESHOLD.
 * A wrong merge is worse than a missed one, so any doubt keeps the listings apart. Colours may
 * differ: a group lists each member's colour.
 */

/** Token Jaccard needed without a shared model code (tuned on half of the eval queries). */
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
    "renewed refurbished used pack set kit lot pcs piece pair dual triple multi auto power heated cooling"
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

/**
 * Words that name a different model of the same line, a different condition (renewed) or a
 * special run (limited edition). Two titles must carry the same set.
 */
const VARIANT_WORDS = new Set(
  ("pro plus max ultra mini lite se fe air slim edge note neo xl xs gps cellular kids prime turbo " +
    "renewed refurbished used limited special tkl bundle massage").split(" "),
);
const GLUED_VARIANT = /^((?:[a-z])?\d{1,2})(pro|plus|max|ultra|fe|se|mini|lite)$/;

const STOP = new Set(
  "for with and the of in to by on new original compatible version edition model 2024 2025 2026 a an or".split(" "),
);

/** Spec dimensions read from titles. Values are canonical strings; each dimension is a set. */
type Dim =
  | "mah" | "storage" | "ram" | "watt" | "inch" | "mm" | "hz" | "litre" | "gen" | "res" | "net" | "bt"
  | "count" | "in1" | "dpi" | "kg" | "mp" | "year" | "pa" | "model" | `qty:${string}`;

export type TitleFeatures = {
  /** Canonical brand from data/brands.json (or a product line naming it), else undefined. */
  knownBrand?: string;
  /** A capitalised leading word that may be a brand not in the list (validated per result set). */
  leadWord?: string;
  /** Brand used for matching: knownBrand, or a validated leadWord (set by groupProducts). */
  brand?: string;
  codes: Set<string>;
  specs: Map<Dim, Set<string>>;
  variants: Set<string>;
  /** Words (no colours, no stop words, no digits) plus canonical spec and model tokens. */
  tokens: Set<string>;
  color?: string;
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

/** dim null: cut out as noise (playtime hours, IP rating, latency...), never compared. */
type SpecRule = { dim: Dim | null; re: RegExp; val: (m: RegExpExecArray) => string };

/** Counted features ("12 functions", "3 channel"): compared per feature, "qty:function". */
const QTY =
  /(?<![\d.])(\d+)\+?\s*-?\s*(mic|mode|speed|level|button|key|function|program|setting|preset|cup|layer|stage|sensor|channel|port|output|camera|head|attachment|drawer|basket|zone|blade|piece|burner|slice|egg|bar)s?\b/g;

/** Order matters: each match is cut out of the title before the next rule and the model numbers. */
const SPEC_RULES: SpecRule[] = [
  { dim: "in1", re: /(?<![\d.])(\d+)\s*-?\s*in\s*-?\s*1\b/g, val: (m) => m[1] },
  { dim: "ram", re: /(?<![\d.])(\d+)\s*gb\s*(?:of\s*)?(?:ram|memory|lpddr\d*x?|ddr\d*)\b/g, val: (m) => m[1] },
  { dim: "ram", re: /\bram\s*:?\s*(\d+)\s*gb\b/g, val: (m) => m[1] },
  { dim: "storage", re: /(?<![\d.])(\d+(?:\.\d+)?)\s*(gb|tb)(?![a-z])/g, val: (m) => num(String(Number(m[1]) * (m[2] === "tb" ? 1024 : 1))) },
  { dim: "mah", re: /(?<![\d.])(\d+(?:\.\d+)?)\s*mah\b/g, val: (m) => num(m[1]) },
  { dim: "watt", re: /(?<![\d.])(\d+(?:\.\d+)?)\s*(?:w|watts?)(?![a-z])/g, val: (m) => num(m[1]) },
  { dim: "inch", re: /(?<![\d.])(\d+(?:\.\d+)?)\s*(?:"|''|”|-?\s*inch(?:es)?\b|in\b)/g, val: (m) => num(m[1]) },
  { dim: "mm", re: /(?<![\d.])(\d+(?:\.\d+)?)\s*mm\b/g, val: (m) => num(m[1]) },
  { dim: "hz", re: /(?<![\d.])(\d+)\s*hz\b/g, val: (m) => m[1] },
  { dim: "litre", re: /(?<![\d.])(\d+(?:\.\d+)?)\s*ml\b/g, val: (m) => num(String(Number(m[1]) / 1000)) },
  { dim: "litre", re: /(?<![\d.])(\d+(?:\.\d+)?)\s*(?:l|lt|ltr|liters?|litres?)\b/g, val: (m) => num(m[1]) },
  { dim: "gen", re: /(?<![\d.])(\d+)(?:st|nd|rd|th)?\s*-?\s*gen(?:eration)?\b/g, val: (m) => m[1] },
  { dim: "gen", re: /\bgen(?:eration)?\s*-?\s*(\d+)\b/g, val: (m) => m[1] },
  { dim: "res", re: /(?<![\d.])([248])k\b/g, val: (m) => ({ "2": "1440", "4": "2160", "8": "4320" })[m[1]]! },
  { dim: "res", re: /(?<![\d.])(720|1080|1440|2160)p\b/g, val: (m) => m[1] },
  { dim: "res", re: /\b(fhd|qhd|uhd)\b/g, val: (m) => ({ fhd: "1080", qhd: "1440", uhd: "2160" })[m[1]]! },
  { dim: "net", re: /(?<![\d.])([345])g\b/g, val: (m) => m[1] },
  { dim: "bt", re: /\b(?:bluetooth|bt)\s*v?\s*(\d(?:\.\d)?)\b/g, val: (m) => num(m[1]) },
  { dim: "count", re: /(?<![\d.])(\d+)\s*(?:pcs|pieces?|pack|pk|count|ct)\b/g, val: (m) => m[1] },
  { dim: "count", re: /\b(?:pack|set)\s*of\s*(\d+)\b/g, val: (m) => m[1] },
  { dim: "dpi", re: /(?<![\d.])(\d+)\s*dpi\b/g, val: (m) => m[1] },
  { dim: "kg", re: /(?<![\d.])(\d+(?:\.\d+)?)\s*kg\b/g, val: (m) => num(m[1]) },
  { dim: "mp", re: /(?<![\d.])(\d+(?:\.\d+)?)\s*mp\b/g, val: (m) => num(m[1]) },
  { dim: "year", re: /(?<![\d.])(20[12]\d)(?![\d.])/g, val: (m) => m[1] },
  { dim: "pa", re: /(?<![\d.])(\d+)\s*pa\b/g, val: (m) => m[1] },
  { dim: null, re: /(?<![\d.])\d+(?:\.\d+)?\s*-?\s*(?:h|hrs?|hours?|years?|yrs?|months?|days?|mins?|minutes?)\b/g, val: () => "" },
  { dim: null, re: /\bipx?\s*\d+\b/g, val: () => "" },
  { dim: null, re: /(?<![\d.])\d+(?:\.\d+)?\s*(?:db|ms|d|mbps|gbps|mb\/s|gb\/s|g\/min|rpm|cm|m|kpa|v|a|°)(?![a-z])/g, val: () => "" },
  { dim: null, re: /\b\d{2,4}\s*[x×*]\s*\d{2,4}\b/g, val: () => "" },
  { dim: null, re: /(?<![\d.])\d+(?:\.\d+)?k\b/g, val: () => "" },
  { dim: null, re: /\bqi\s*\d\b/g, val: () => "" },
];

/** Component codes (mouse and camera sensors) name a part many models share, not a model. */
const COMPONENT_CODE = /^(?:paw|pmw|imx|ov)\d+/;

/**
 * Sold with something else: "+ 2 Pack Film", "with USB Cable", "+ Case". A bundle is another
 * product than the item alone.
 */
const BUNDLE =
  /(?:\s\+\s*|\bwith\s+)(?:\d+\s*(?:x\s*)?(?:pack\s+|pcs?\s+)?)?(?:[a-z0-9-]+\s+){0,2}?(?:film|films|cable|charger|card|bag|strap|game|games|controller|headset)\b/;

/** Normalized tokens with digits that are specs, not model codes ("100w", "bt5.3", "ipx7"). */
const SPEC_TOKEN =
  /^(?:\d+(?:\.\d+)?(?:mah|gb|tb|mb|w|watts?|inch|inches|in|mm|cm|m|hz|khz|ghz|mhz|l|ml|lt|ltr|k|p|g|v|a|kg|mp|pcs|pc|pack|pk|x|nm|st|nd|rd|th|fps|ms|db|rpm|pa|kpa|oz|lb|lbs|h|hrs|min|s|d|bit|core|cores|ft|dpi|kw|ah|wh|n|c|f|t|e|fe)|(?:gen|wifi|bt|ble|usb|ip|ipx|ddr|lpddr|gddr|pcie|hdmi|qi|type|cat|series|ver|pd|qc|uhs|class|level|vol)\d+(?:\.\d+)?[a-z]?|v\d{1,2}(?:\.\d)?|\d+(?:\.\d+)?(?:x\d+(?:\.\d+)?)+[a-z]*|(?:hdr|pm|spo|win|rj|gen\d+x)\d+(?:\.\d+)?|\d+in\d+|\d+(?:gbps|mbps|kbps)|\d+[a-z]{3,})$/;

/** Model / part codes: tokens with letters and digits, 4+ characters without hyphens, not specs. */
export function modelCodes(title: string): string[] {
  const out = new Set<string>();
  for (const raw of prepare(title).split(/[^a-z0-9.\-]+/)) {
    const t = raw.replace(/^[.\-]+|[.\-]+$/g, "");
    if (!/\d/.test(t) || !/[a-z]/.test(t)) continue;
    const n = t.replace(/[-.]/g, "");
    if (n.length < 4 || SPEC_TOKEN.test(t) || SPEC_TOKEN.test(n) || COMPONENT_CODE.test(n)) continue;
    // A line name or variant glued to its number: "iphone16", "airpods4", "air5", "16pro", "s24ultra".
    if (/^(?:[a-z]{4,}\d+|(?:air|pro|max|mini)\d{1,2})$/.test(n) || GLUED_VARIANT.test(n)) continue;
    out.add(n.toUpperCase());
  }
  return [...out];
}

/** Variant words of a title (pro, plus, max, ...). */
export function variantWords(title: string): Set<string> {
  return new Set(words(prepare(title)).filter((w) => VARIANT_WORDS.has(w)));
}

/** The title's colour ("black", "space gray"), if it names one. */
export function colorOf(title: string): string | undefined {
  const t = normalizeTitle(title);
  for (const pair of COLOR_PAIRS) if (new RegExp(`\\b${pair}\\b`).test(t)) return pair;
  return words(t).find((w) => COLORS.has(w));
}

/** Word tokens: letters and digits, dots kept inside numbers; "iphone16" -> "iphone", "16". */
function words(t: string): string[] {
  return t
    .split(/[^a-z0-9.\p{L}]+/u)
    .map((w) => w.replace(/^\.+|\.+$/g, ""))
    .filter(Boolean)
    .flatMap((w) => {
      if (/^ps\d$/.test(w)) return ["playstation", w.slice(2)];
      const m = w.match(/^([a-z]{4,}|air|pro|max|mini)(\d{1,2})$/) ?? w.match(GLUED_VARIANT);
      return m ? [m[1], m[2]] : [w];
    });
}

export function titleFeatures(title: string): TitleFeatures {
  const prepared = prepare(title);
  const codes = new Set(modelCodes(title));
  const specs = new Map<Dim, Set<string>>();
  const add = (d: Dim, v: string) => {
    let s = specs.get(d);
    if (!s) specs.set(d, (s = new Set()));
    s.add(v);
  };
  // Cut codes out first so their digits are not read as specs ("WH-1000XM5" is not 1000 of anything).
  let rest = prepared
    .split(/(\s+)/)
    .map((w) => {
      const n = w.replace(/^[.\-,;:()[\]]+|[.\-,;:()[\]]+$/g, "").replace(/[-.]/g, "").toUpperCase();
      return codes.has(n) ? " " : w;
    })
    .join("");
  for (const r of SPEC_RULES) {
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
  // Bare numbers and short letter+digit tokens ("16", "s24", "m3", "16e") of the item's own part
  // (not the "for iPhone 17 16 15" list): the model number. Decimals ("2.0") and long digit runs
  // (SKUs) are not.
  for (const w of words(ownPart(rest)))
    if (/\d/.test(w) && !/^\d+\.\d+$/.test(w) && !/^\d{6,}$/.test(w)) add("model", w);

  const plain = ws.filter((w) => !/\d/.test(w));
  const variants = new Set(words(ownPart(rest).replace(VARIANT_NOISE, " ")).filter((w) => VARIANT_WORDS.has(w)));
  if (BUNDLE.test(prepared)) variants.add("bundle");
  const color = colorOf(title);
  const colorWords = new Set(color ? color.split(" ") : []);
  const tokens = new Set<string>();
  for (const w of plain) if (w.length > 1 && !STOP.has(w) && !COLORS.has(w) && !colorWords.has(w)) tokens.add(w);
  for (const [d, vs] of specs) for (const v of vs) tokens.add(`${d}:${v}`);
  for (const c of codes) tokens.add(`code:${c}`);

  // The item's own brand is named before "for / compatible with ..." (a PS5 controller by KISSUN).
  const own = ownPart(prepared);
  const known = own.split(/[^a-z0-9\p{L}]+/u).find((w) => KNOWN_BRANDS.has(w));
  const knownBrand = known ? (BRAND_CANON[known] ?? known) : undefined;
  const first = title.trim().split(/[^\p{L}\p{N}&'-]+/u).find(Boolean) ?? "";
  const leadWord =
    /^\p{Lu}[\p{L}&'-]{2,}$/u.test(first) && !first.toLowerCase().split("-").some((w) => GENERIC_LEAD.has(w) || COLORS.has(w))
      ? first.toLowerCase()
      : undefined;
  return { knownBrand, leadWord, brand: knownBrand, codes, specs, variants, tokens, color };
}

/** The item's own words: the title before "for / compatible with ..." (what it fits). */
function ownPart(t: string): string {
  return t.split(/\b(?:for|compatible|fits?|works with|replacement|upgrade from|upgraded from)\b/)[0];
}

/** Words that use a variant word for something else: "Ultra HD", "Rapid Air", "Max 4K", "Edge Mop". */
const VARIANT_NOISE =
  /\bultra[\s-]*(?:hd|slim|thin|quiet|light(?:weight)?|wide|fast|soft|clear|compact|long|high|strong|powerful|sharp|portable|low|bass)\b|\bmax(?:imum)?\s*(?:\d|up\s*to|crisp|power|speed)|\bedge\s*(?:mop|light(?:ing)?|brush(?:es)?|cleaning)\b|\b(?:rapid|hot)\s*air\b|\bair\s*(?:fry(?:er|ing)?|purifiers?|circulation|flow|filter|quality|technology|pump|cushion|conditioner)\b|\bairfryer\b|\bpro[\s-]*(?:grade|level|quality)\b/g;

/**
 * Some spec both titles state differs (any dimension, model number included). A bare model
 * number the other title states as a spec ("Watch 44" vs "44mm") is no conflict.
 */
export function specConflict(a: TitleFeatures, b: TitleFeatures): boolean {
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

/** Model numbers minus values the other title states as a spec. */
function modelOnly(model: Set<string>, other: TitleFeatures): Set<string> {
  const specVals = new Set([...other.specs].filter(([d]) => d !== "model").flatMap(([, v]) => [...v]));
  return new Set([...model].filter((m) => !specVals.has(m)));
}

const setsEqual = (a: Set<string>, b: Set<string>) => a.size === b.size && [...a].every((x) => b.has(x));

/** Token weight: rarer tokens in the result set weigh more (a differing "Access" or "Fortnite" counts). */
export type Weight = (token: string) => number;

/** Weighted Jaccard; plain Jaccard without weights. */
function jaccard(a: Set<string>, b: Set<string>, w: Weight = () => 1): number {
  let inter = 0;
  let union = 0;
  for (const x of a) {
    union += w(x);
    if (b.has(x)) inter += w(x);
  }
  for (const x of b) if (!a.has(x)) union += w(x);
  return union ? inter / union : 0;
}

/** Inverse document frequency over the result set's titles: log(1 + N / df). */
function idfWeights(fs: TitleFeatures[]): Weight {
  const df = new Map<string, number>();
  for (const f of fs) for (const t of f.tokens) df.set(t, (df.get(t) ?? 0) + 1);
  const n = fs.length;
  return (t) => Math.log(1 + n / (df.get(t) ?? 1));
}

/** Hard evidence of different products: brands, codes, specs or variant words disagree. */
function conflicts(a: TitleFeatures, b: TitleFeatures): boolean {
  if (a.knownBrand && b.knownBrand && a.knownBrand !== b.knownBrand) return true;
  if (a.brand && b.brand && a.brand !== b.brand) return true;
  if (a.codes.size && b.codes.size && !sharesCode(a, b)) return true;
  if (!setsEqual(a.variants, b.variants)) return true;
  if (EXCLUSIVE.some((g) => exclusiveConflict(a.tokens, b.tokens, g))) return true;
  return specConflict(a, b);
}

/** Word families where two titles naming different members are different products. */
const EXCLUSIVE: Set<string>[] = [
  "fabric leather mesh velvet",
  "glass plastic stainless steel metal aluminium aluminum wood bamboo",
  "wired wireless cordless corded",
  "digital mechanical manual analog",
].map((g) => new Set(g.split(" ")));

function exclusiveConflict(a: Set<string>, b: Set<string>, g: Set<string>): boolean {
  const x = new Set([...a].filter((t) => g.has(t)));
  const y = new Set([...b].filter((t) => g.has(t)));
  return x.size > 0 && y.size > 0 && !setsEqual(x, y);
}

export type MatchOptions = { threshold?: number; weight?: Weight };

function sharesCode(a: TitleFeatures, b: TitleFeatures): boolean {
  return [...a.codes].some((c) => b.codes.has(c));
}

/** Two titles are the same product (see the module comment). */
export function sameProduct(a: TitleFeatures, b: TitleFeatures, opts: MatchOptions = {}): boolean {
  if (conflicts(a, b)) return false;
  if (sharesCode(a, b)) return true;
  return !!a.brand && a.brand === b.brand && jaccard(a.tokens, b.tokens, opts.weight) >= (opts.threshold ?? GROUP_THRESHOLD);
}

/**
 * How well a title fits a group: 0 when it conflicts with any member; otherwise its mean similarity
 * to the members (average linkage, so a group cannot drift member by member), plus 1 when it shares
 * a code with a member. Without a shared code it needs the members' brand and the threshold.
 */
function fit(f: TitleFeatures, members: TitleFeatures[], opts: MatchOptions): number {
  if (members.some((m) => conflicts(f, m))) return 0;
  const mean = members.reduce((s, m) => s + jaccard(f.tokens, m.tokens, opts.weight), 0) / members.length;
  if (members.some((m) => sharesCode(f, m))) return 1 + mean;
  if (!f.brand || members.some((m) => m.brand !== f.brand)) return 0;
  return mean >= (opts.threshold ?? GROUP_THRESHOLD) ? mean : 0;
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

/**
 * Groups the same product across stores. Every product lands in exactly one group; a group with
 * one store is split back into single-product groups (same-store look-alikes are dedupe's job).
 * A product joins the group it fits best (see fit: no conflict with any member, and a shared code
 * or a mean token similarity, weighted by rarity in this result set, of at least the threshold). Products are taken by tier, price and key, so
 * the result does not depend on input order.
 */
export function groupProducts(products: Product[], opts: MatchOptions = {}): ProductGroup[] {
  const items = products
    .map((p) => ({ p, f: titleFeatures(p.title), k: keyOf(p) }))
    .sort((x, y) => tierOf(x.p) - tierOf(y.p) || priceOf(x.p) - priceOf(y.p) || (x.k < y.k ? -1 : x.k > y.k ? 1 : 0));
  resolveLeadBrands(items.map((i) => i.f));
  dropSharedCodes(items.map((i) => i.f));
  const o: MatchOptions = { ...opts, weight: opts.weight ?? idfWeights(items.map((i) => i.f)) };

  const clusters: (typeof items)[] = [];
  for (const it of items) {
    let best: (typeof items) | null = null;
    let bestSim = 0;
    for (const c of clusters) {
      const sim = fit(it.f, c.map((m) => m.f), o);
      if (sim > bestSim) {
        bestSim = sim;
        best = c;
      }
    }
    if (best) best.push(it);
    else clusters.push([it]);
  }

  const out: ProductGroup[] = [];
  for (const c of clusters) {
    const parts = new Set(c.map((x) => x.p.site)).size > 1 ? [c] : c.map((x) => [x]);
    for (const part of parts) out.push(makeGroup(part));
  }
  return out;
}

function makeGroup(items: { p: Product; f: TitleFeatures; k: string }[]): ProductGroup {
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
 * ("Fryer" in "Philips Air Fryer"). Sets `brand` for titles without a known brand.
 */
function resolveLeadBrands(fs: TitleFeatures[]): void {
  const lead = new Map<string, number>();
  const inner = new Map<string, number>();
  for (const f of fs) if (f.leadWord) lead.set(f.leadWord, (lead.get(f.leadWord) ?? 0) + 1);
  for (const f of fs) for (const w of f.tokens) if (lead.has(w) && w !== f.leadWord) inner.set(w, (inner.get(w) ?? 0) + 1);
  for (const f of fs) {
    if (f.knownBrand || !f.leadWord) continue;
    if ((lead.get(f.leadWord) ?? 0) >= (inner.get(f.leadWord) ?? 0)) f.brand = f.leadWord;
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
  for (const f of fs)
    for (const c of f.codes)
      if ((brandsOf.get(c)?.size ?? 0) > 1) {
        f.codes.delete(c);
        f.tokens.delete(`code:${c}`);
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
