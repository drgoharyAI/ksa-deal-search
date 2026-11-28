import brands from "@/data/brands.json";
import type { Product } from "@/src/lib/types";
import { isLikelyMatch, rank, type SortKey } from "@/src/lib/rank";
import { normalizeTitle } from "./spec";

/**
 * Same product across stores (spec: "Comparison and deal-insight features", item 1). Rule-based:
 * - a shared model / part code ("WH-1000XM5", "SM-S921B") with no conflict is the same product;
 * - without one: the same brand, no conflict, the same model words (every word one title has and
 *   the other lacks must be generic: a marketing word, a product noun, or common in the result
 *   set), and a token similarity of at least GROUP_THRESHOLD.
 * Conflicts (any one keeps two titles apart): different brands; codes that disagree (none shared,
 * a different first code, a different model word right before or after the shared code, or
 * different article suffixes: "HR2041/10" against "/30", unless only the colour differs); any spec
 * both state that differs (capacity, weight, volume, storage, RAM, wattage, voltage, size,
 * generation, resolution, speed, model number...); storage or RAM, a generation, or a multi-unit
 * pack, stated by one side only; different variant words (pro, plus, max...), condition (renewed,
 * open box, grade B...), language or keyboard layout, bundle, add-ons, watch band, material,
 * connector, gender or size; one side an accessory (case, ear pads, refill, or an item made "for"
 * the other's brand) and the other not.
 * A wrong merge is worse than a missed one, so any doubt keeps the listings apart. Colours may
 * differ: a group lists each member's colour.
 */

/**
 * Minimum token similarity without a shared code: Jaccard weighted by each token's rarity in the
 * result set (IDF), averaged over the group's members. Chosen on the tuning half of the eval.
 */
const GROUP_THRESHOLD = 0.6;

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
const KNOWN_BRANDS = new Set<string>([...brands, ...Object.keys(BRAND_CANON), "blackdecker", "oralb"]);

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
    "forest lime peach plum wine mocha nickel pale matte glossy metallic mist misty blush shadow smoke haze"
  ).split(/\s+/),
);
const COLOR_PAIRS = ["space gray", "space grey", "space black", "rose gold", "jet black", "sky blue", "navy blue", "light blue", "dark blue", "light gray", "dark gray", "dark green", "light pink", "hot pink", "army green"];
// eslint-disable-next-line security/detect-non-literal-regexp -- built from the constant COLOR_PAIRS list above, no input
const COLOR_PAIR_RE = new RegExp(`\\b(?:${COLOR_PAIRS.join("|")})\\b`);

/** Words that name a different model of the same line or a special run. Two titles must carry the same set. */
const VARIANT_WORDS = new Set(
  "pro plus max ultra mini lite se fe air slim edge note neo xl xs gps cellular lte kids prime turbo limited special tkl massage".split(" "),
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
/** Region editions ("Middle East Version", "International Version", "KSA Version"): kept apart. */
const REGIONS: [string, RegExp][] = [
  ["middle-east", /\bmiddle[\s-]*east\b/],
  ["international", /\binternational\s+(?:version|edition)\b|\(international\)/],
  ["global", /\bglobal\s+(?:version|edition|rom)\b/],
  ["uae", /\buae\s+(?:version|edition)\b/],
  ["ksa", /\bksa\s+(?:version|edition)\b/],
  ["china", /\bchin(?:a|ese)\s+(?:version|edition|rom)\b/],
];
const REGION_HINT = /east|international|global|uae|ksa|chin/;
/**
 * Keyboard layout and language ("Arabic Layout", "US Layout", "English/Arabic Keyboard"): the same
 * keyboard, laptop or book in another language is another listing.
 */
const LANG_WORD = "us|uk|ar|en|eng|arabic|english|french|german|spanish|italian|turkish|russian|nordic|qwerty|azerty|qwertz";
const LAYOUT = new RegExp(
  `\\b((?:(?:${LANG_WORD})[\\s/&+,-]*)+)(?:keyboard\\s+|key\\s+)?layout\\b|\\blayout[\\s:(-]*((?:(?:${LANG_WORD})\\b[\\s/&+,-]*)+)`,
  "g",
);
const LANG_FULL = /\b(?:arabic|english)\b/g;
const LANG_HINT = /layout|arabic|english/;
const LANG_CANON: Record<string, string> = { ar: "arabic", en: "english", eng: "english" };
/** "for Apple Watch", "compatible with Dyson V8": the brand the item is made for. */
const FOR_BRAND = /\b(?:for|compatible\s+with|fits?|works\s+with)\s+(?:the\s+|all\s+|most\s+|your\s+|new\s+)?([a-z0-9]+)[^|,;()[\]–]*/g;
const FOR_HINT = /\bfor\b|compatible|\bfits?\b|works with/;
/** Words after which a single letter names the model ("Series X", "EOS R"). */
const LINE_WORDS = new Set("series eos galaxy model type mark class line size".split(" "));
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
  "case cases cover covers protector protectors replacement skin skins sticker stickers keycap keycaps pad pads earpads cushion cushions spare parts accessory accessories sleeve refill refills".split(" "),
);
const ACCESSORY_HINT = /case|cover|protector|replacement|skin|sticker|keycap|pad|cushion|spare|parts|accessor|sleeve|refill/;
/** A clause that adds items: after "with / + / & / and / includes / plus", up to the next separator. */
const ADDON_CLAUSE = /(?:\bwith\b|\binclud(?:es?|ing)\b|\s\+\s|\s&\s|\band\b|\bbundle\b)([^,;|()[\]–]*)/g;
const ADDON_HINT = /with|includ|\+|&|and|bundle/;
/** "&", "+" or "and": the word on its left is joined too ("Mill & Chopper" names two add-ons). */
const CONJUNCTION = /\s+(?:[+&]\s|and\b)/g;
const LAST_WORD = /([a-z]+)$/;
/** Things sold along with the product. */
const ADDON_NOUNS = new Set(
  (
    "camera cameras controller controllers charger chargers case cases bag bags game games card cards stand stands " +
    "headset headsets mouse keyboard pen pens strap straps film films lens lenses battery batteries dock remote remotes " +
    "mic microphone microphones cable cables tripod console consoles " +
    "mill mills chopper choppers grinder grinders jar jars jug jugs blade blades attachment attachments frother " +
    "whisk diffuser concentrator pouch sleeve stylus pencil earbuds headphones tracker gimbal gift voucher " +
    "subscription juicer"
  ).split(/\s+/),
);
const EXTRA_WORDS = new Set("extra additional spare bonus second".split(" "));
const singular = (w: string) => (/(?:ch|sh)es$/.test(w) ? w.slice(0, -2) : w.endsWith("ss") ? w : w.replace(/s$/, ""));
const NOT_ACCESSORY = /\b(?:aluminium|aluminum|titanium|steel|ceramic|charging|magsafe|usb[-\s]?c|lightning|wireless)\s+(?:charging\s+)?case\b/g;

/**
 * Parts and accessories sold for a product. One in a title's name that the other title does not
 * mention at all makes it another item, also with a shared code ("TV QA65Q60D" / "TV QA65Q60D Wall
 * Mount"). The name is the title up to its first separator or "with / for / +" clause, so feature
 * lists ("..., Detachable Basket, Cool-Touch Handle") and add-on clauses do not count.
 */
const PART_NOUNS = new Set(
  (
    "mount mounts bracket brackets remote remotes filter filters gasket gaskets seal seals head heads basket baskets " +
    "liner liners pump pumps dock docks bag bags charger chargers cable cables cord hose hoses kit kits legs handle " +
    "handles battery batteries case cases cover covers strap straps stand stands adapter adapters adaptor blade " +
    "blades brush brushes cartridge cartridges lid lids tray trays shelf shelves knob knobs belt belts housing " +
    "nozzle nozzles tips eartips"
  ).split(/\s+/),
);
const PART_HINT = /mount|bracket|remote|filter|gasket|seal|head|basket|liner|pump|dock|bag|charger|cable|cord|hose|kit|legs|handle|batter|case|cover|strap|stand|adapt|blade|brush|cartridge|lid|tray|shel|knob|belt|housing|nozzle|tips/;
const NAME_END = /[,|;(\[–]|\s-\s|\b(?:with|includes?|including|for)\b|\s[+&]\s/;
/** Product names made of a part noun: a power bank is a "portable charger" or "battery pack". */
const OWN_PRODUCT = /\b(?:portable|wireless|fast|wall|car|usb(?:[\s-]?c)?|travel)\s+chargers?\b|\bbattery\s+packs?\b|\bbuilding\s+kits?\b/g;
const COUNT_WORDS = new Set("single dual double twin triple quad multi".split(" "));
/** A washer with a dryer in one machine. */
const WASHER_DRYER = /\bwash(?:er|ing\s+machine)?[\s/&-]*(?:and\s+)?dryer\b/;

const STOP = new Set(
  "for with and the of in to by on new original compatible version edition model 2024 2025 2026 a an or".split(" "),
);

/** Spec dimensions read from titles. Values are canonical strings; each dimension is a set. */
type Dim =
  | "mah" | "storage" | "ram" | "watt" | "inch" | "mm" | "hz" | "litre" | "gen" | "res" | "net" | "bt"
  | "count" | "pieces" | "dims" | "dec" | "ifgen" | "visc" | "in1" | "dpi" | "wt" | "oz" | "k" | "mp" | "year" | "pa" | "mbs" | "gbps" | "len" | "model"
  | `qty:${string}` | `u:${string}`;

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
  /** The word right before each code, raw. */
  codePrevRaw: Map<string, string>;
  /** The word right before each code when it is a model word (not generic, not the brand). */
  codePrev?: Map<string, string>;
  /** Add-on nouns in "with / + / & / and / includes / bundle" clauses ("... and Camera"). */
  addons: Set<string>;
  /** Part and accessory nouns in the title's name ("... GR-B247SLUV Water Filter": filter), see PART_NOUNS. */
  parts: Set<string>;
  /** The "/NN" suffixes written after each code ("HR2041/10" -> HR2041: {10}): the exact article. */
  codeSfx: ReadonlyMap<string, Set<string>>;
  /** The brand this item is made for ("Trail Loop Band for Apple Watch"), when it names no brand of its own. */
  forBrand?: string;
  specs: Map<Dim, Set<string>>;
  /** Variant words plus "bundle", "band:<type>" and condition ("cond:refurbished", "cond:grade-b"). */
  variants: Set<string>;
  accessory: boolean;
  /** Words (no colours, no stop words, no digits) plus canonical spec and model tokens. */
  tokens: Set<string>;
  /** The words alone (no specs, codes or model numbers). */
  plainWords: Set<string>;
  /** Words that are not generic in the result set, sorted and joined (set by groupProducts). */
  sig?: string;
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

/** Lowercase, thousands separators gone, "S24+" -> "S24 plus", lists expanded, spellings unified. */
function prepare(title: string): string {
  let t = normalizeTitle(title)
    .replace(/\bblack\s*(?:\+|&|and)\s*decker\b/g, "blackdecker")
    .replace(/\boral[\s-]b\b/g, "oralb");
  if (t.includes("/"))
    t = t
      // A code's article suffix ("HR3030/01", "NA350/09 / NA350/00") is read apart (codeSuffixes).
      .replace(CODE_SUFFIX, "$1")
      // Tyre sizes written glued or spaced: "225/45R17" = "225/45 R17".
      .replace(/(\d{3})\s*\/\s*(\d{2})\s*(z?r)\s*(\d{2})\b/g, "$1/$2 $3$4");
  t = t.replace(SPELLING, (w) => SPELLING_MAP[w]);
  // Oil viscosity in one form, read as a spec: "5W30" = "5W-30".
  if (VISCOSITY_HINT.test(t)) t = t.replace(VISCOSITY, "$1w-$2");
  // A brand's model letter written apart from its number: "Nikon Z 50" = "Nikon Z50".
  if (LETTER_NUMBER.test(t)) t = t.replace(LETTER_NUMBER_G, (m, brand: string, letter: string, n: string) => (KNOWN_BRANDS.has(brand) ? `${brand} ${letter}${n}` : m));
  // A trailing "+" names the bigger model: "S24+", "Pro+", "Primacy 4+" (not "8+256GB", "Wi-Fi + Cellular").
  if (t.includes("+")) t = t.replace(/(\b[a-z0-9]+)\+(?![a-z0-9+])/g, "$1 plus ");
  return expandLists(t);
}

const VISCOSITY_HINT = /\dw-?\d\d/;
const VISCOSITY = /(?<![a-z\d.])(\d{1,2})w-?(16|20|30|40|50|60)(?!\w)/g;
const LETTER_NUMBER = /\s[a-z]\s\d{2,4}\b/;
const LETTER_NUMBER_G = /\b([a-z]+)\s([a-z])\s(\d{2,4})\b/g;
const CODE_SUFFIX = /\b([a-z]{1,4}-?\d{3,}[a-z]*)((?:\/\d{1,3})+)(?![\w/])/g;

const NO_SUFFIXES: ReadonlyMap<string, Set<string>> = new Map();

/** The "/NN" suffixes after each code: "NA150/00/09" -> NA150: {00, 09}. */
function codeSuffixes(title: string): ReadonlyMap<string, Set<string>> {
  if (!title.includes("/")) return NO_SUFFIXES;
  const out = new Map<string, Set<string>>();
  for (const m of normalizeTitle(title).matchAll(CODE_SUFFIX)) {
    const c = m[1].replace(/-/g, "").toUpperCase();
    const set = out.get(c) ?? new Set<string>();
    for (const x of m[2].split("/")) if (x) set.add(x);
    out.set(c, set);
  }
  return out;
}

/** British / US spellings, spelled-out names and their short forms read as one word. */
const SPELLING_MAP: Record<string, string> = {
  aluminum: "aluminium",
  colour: "color",
  grey: "gray",
  litre: "liter",
  litres: "liters",
  metre: "meter",
  metres: "meters",
  cancelling: "canceling",
  cancellation: "canceling",
  noisecancelling: "noise canceling",
  "eau de parfum": "edp",
  "eau de toilette": "edt",
  "eau de cologne": "edc",
  tyre: "tire",
  tyres: "tire",
  tires: "tire",
  mens: "men",
  "men's": "men",
  "men’s": "men",
  womens: "women",
  "women's": "women",
  "women’s": "women",
  ladies: "women",
};
// eslint-disable-next-line security/detect-non-literal-regexp -- built from the constant SPELLING_MAP keys above, no input
const SPELLING = new RegExp(`\\b(?:${Object.keys(SPELLING_MAP).join("|")})\\b`, "g");

/** The title without compatibility lists and "upgrade from" phrases. */
const ownText = (t: string) => t.replace(COMPAT, " ").replace(UPGRADE_FROM, " ");

/** dim null: cut out as noise (playtime hours, IP rating, latency...), never compared. */
type SpecRule = { dim: Dim | null; re: RegExp; val: (m: RegExpExecArray) => string; hint?: string[] };

/** Counted features ("12 functions", "3 channel"): compared per feature, "qty:function". */
const QTY =
  /(?<![\d.])(\d+)\+?\s*(?:-\s*)?(mic|mode|speed|level|button|key|function|program|setting|preset|cup|layer|stage|sensor|channel|port|output|camera|head|attachment|drawer|basket|zone|blade|piece|burner|slice|egg|bar)s?\b/g;

/** Order matters: each match is cut out of the title before the next rule and the model numbers. */
const SPEC_RULES: SpecRule[] = [
  { hint: ["in"], dim: "in1", re: /(?<![\d.])(\d+)\s*(?:-\s*)?in\s*(?:-\s*)?1\b/g, val: (m) => m[1] },
  { hint: ["ram", "memory", "ddr"], dim: "ram", re: /(?<![\d.])(\d+)\s*gb\s*(?:of\s*)?(?:ram|memory|lpddr\d*x?|ddr\d*)\b/g, val: (m) => m[1] },
  { hint: ["ram"], dim: "ram", re: /\bram\s*:?\s*(\d+)\s*gb\b/g, val: (m) => m[1] },
  { hint: ["w-"], dim: "visc", re: /(?<![a-z\d.])(\d{1,2})w-(\d\d)(?!\w)/g, val: (m) => `${m[1]}w${m[2]}` },
  // An interface generation ("PCIe Gen4", "USB 3.2 Gen 2" against "Gen 2x2") is not the product's.
  { hint: ["gen"], dim: "ifgen", re: /\b(?:pcie?|pci[\s-]express|usb|nvme|thunderbolt)\s*(?:\d(?:\.\d)?\s*)?gen\s*(\d(?:x\d)?)\b/g, val: (m) => m[1] },
  { hint: ["gen"], dim: "gen", re: /(?<![\d.])(\d+)(?:st|nd|rd|th)?\s*(?:-\s*)?gen(?:eration)?\b/g, val: (m) => m[1] },
  { hint: ["gen"], dim: "gen", re: /\bgen(?:eration)?\s*(?:-\s*)?(\d+)\b/g, val: (m) => m[1] },
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- the regex only matches fhd|qhd|uhd, all keys of the map
  { hint: ["hd"], dim: "res", re: /\b(fhd|qhd|uhd)\b/g, val: (m) => ({ fhd: "1080", qhd: "1440", uhd: "2160" })[m[1]]! },
  { hint: ["bluetooth", "bt"], dim: "bt", re: /\b(?:bluetooth|bt)\s*(?:version\s*|ver\.?\s*|v\.?\s*)?(\d(?:\.\d)?)\b/g, val: (m) => num(m[1]) },
  { hint: ["dpi"], dim: "dpi", re: /(?<![\d.])(\d+(?:\.\d+)?)\s*k\s*dpi\b/g, val: (m) => String(Math.round(Number(m[1]) * 1000)) },
  { hint: ["mah"], dim: "mah", re: /(?<![\d.])(\d+(?:\.\d+)?)\s*k\s*mah\b/g, val: (m) => String(Math.round(Number(m[1]) * 1000)) },
  // A voltage range ("100-240V") is the mains input, not a model voltage.
  { hint: ["0v", "0 v", "volt"], dim: null, re: /(?<![\d.])\d{2,3}\s*(?:-|~|to)\s*\d{2,3}\s*v(?:olts?)?(?![a-z0-9])/g, val: () => "" },
  { hint: [" of"], dim: "count", re: /\b(?:pack|set)\s*of\s*(\d+)\b/g, val: (m) => m[1] },
  { hint: ["pack"], dim: "count", re: /\b(twin|double|dual|duo|triple)[\s-]*pack\b/g, val: (m) => (m[1] === "triple" ? "3" : "2") },
  // "3 x 75ml", "6x330 ml": several units of a size (the size stays in the title for its own rule).
  { hint: ["x"], dim: "count", re: /(?<![\d.a-z])(\d{1,2})\s?x\s?(?=\d+(?:\.\d+)?\s?(?:ml|cl|l|g|kg|oz|mg)\b)/g, val: (m) => m[1] },
  { hint: ["20"], dim: "year", re: /(?<![\d.])(20[12]\d)(?![\d.])/g, val: (m) => m[1] },
  { hint: ["ip"], dim: null, re: /\bipx?\s*\d+\b/g, val: () => "" },
  // Width x length ("160x230 cm", "1920 x 1080"); a third number (depth) is left out.
  {
    hint: ["x", "*", "×"],
    dim: "dims",
    re: /(?<![\d.])(\d{2,4})\s*[x×*]\s*(\d{2,4})(?:\s*[x×*]\s*\d{1,4})?(?![\d.])/g,
    val: (m) => `${m[1]}x${m[2]}`,
  },
  { hint: ["qi"], dim: null, re: /\bqi\s*\d\b/g, val: () => "" },
];

/** A number with its unit ("20000mAh", "27-inch", "2 m", "6ft"), read in one pass; see unitSpec. */
const NUM_UNIT =
  /(?<![\d.])(\d+(?:\.\d+)?)\s*(?:-\s*)?(mb\s*\/\s*s|gb\s*\/\s*s|mbps|gbps|mah|gb|tb|watts?|w|fl\.?\s*oz|oz|ounces?|lbs?|pounds?|mg|kgs?|grams?|volts?|tons?|btu|hp|cc|inch(?:es)?|in|"|''|”|mm|cm|meters?|metres?|m|ft|feet|foot|hz|ml|liters?|litres?|ltr|lt|l|k|p|g|pcs|pc|pieces?|pack|pk|count|ct|dpi|mp|pa|hours?|hrs?|h|years?|yrs?|months?|days?|minutes?|mins?|db|ms|d|rpm|kpa|v|a|°)(?![a-z0-9²³])/g;

/** Weight in grams to 3 significant digits (1.8 kg = 1800 g, 5 lb = 2270 g = 2.27 kg). */
const grams = (g: number) => String(Number(g.toPrecision(3)));

/** Length in metres, to 0.1 m (6 ft = 1.8 m = 180 cm). */
const metres = (n: number) => (Math.round(n * 10) / 10).toFixed(1);

/** The dimension and value of a number + unit, or null for noise (hours, dB, latency...). */
function unitSpec(n: string, unit: string): [Dim, string] | null {
  const x = Number(n);
  const u = unit.replace(/\s+/g, "");
  if (u === "mb/s" || u === "mbps") return ["mbs", n];
  if (u === "gb/s" || u === "gbps") return ["gbps", n];
  if (u === "mah") return ["mah", num(n)];
  if (u === "gb") return ["storage", num(n)];
  if (u === "tb") return ["storage", String(x * 1024)];
  if (u === "w" || u.startsWith("watt")) return ["watt", num(n)];
  if (u.startsWith("inch") || u === "in" || u === '"' || u === "''" || u === "”") return ["inch", num(n)];
  if (u === "mm") return ["mm", num(n)];
  if (u === "cm") return ["len", metres(x / 100)];
  if (u === "m" || u.startsWith("meter") || u.startsWith("metre")) return ["len", metres(x)];
  if (u === "ft" || u === "feet" || u === "foot") return ["len", metres(x * 0.3048)];
  if (u === "hz") return ["hz", n];
  if (u === "ml") return ["litre", num(String(x / 1000))];
  if (u === "l" || u === "lt" || u === "ltr" || u.startsWith("liter") || u.startsWith("litre")) return ["litre", num(n)];
  if (u === "k") return n === "2" || n === "4" || n === "8" ? ["res", ({ "2": "1440", "4": "2160", "8": "4320" } as Record<string, string>)[n]] : ["k", num(n)];
  if (u === "p") return ["720", "1080", "1440", "2160"].includes(n) ? ["res", n] : null;
  // "5G" reads as the network; specConflict sets it against a weight ("Saffron 5g" against "10g").
  if (u === "g") return n === "3" || n === "4" || n === "5" ? ["net", n] : n === "2.4" || n === "5.8" ? null : ["wt", grams(x)];
  if (u.startsWith("gram")) return ["wt", grams(x)];
  if (u === "mg") return ["wt", grams(x / 1000)];
  if (u === "lb" || u === "lbs" || u.startsWith("pound")) return ["wt", grams(x * 453.592)];
  // Ounces may be weight or volume (fl oz): compared with ounces only.
  if (u.endsWith("oz") || u.startsWith("ounce")) return ["oz", num(n)];
  if (u.startsWith("volt") || u === "v") return ["u:v", num(n)];
  if (u.startsWith("ton") || u === "btu" || u === "hp" || u === "cc") return [`u:${u.replace(/s$/, "")}`, num(n)];
  if (u === "pcs" || u === "pc" || u.startsWith("piece") || u === "pack" || u === "pk" || u === "count" || u === "ct") return ["count", n];
  if (u === "dpi") return ["dpi", n];
  if (u === "kg" || u === "kgs") return ["wt", grams(x * 1000)];
  if (u === "mp") return ["mp", num(n)];
  if (u === "pa") return ["pa", n];
  return null;
}

/** From this many pieces a count describes what a set holds ("544 Pieces"), not a multi-pack. */
const CONTENTS_MIN = 20;

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
/**
 * A code made of a number and a spec unit ("120-LI", "18V-55"): a whole range shares it (Bosch GSR
 * and GSB 120-LI), so it is no model evidence on its own. It is read as a model number instead.
 */
const SPEC_LIKE_CODE = /^(?:\d+(?:\.\d+)?(?:v|w|wh|ah|mah)?-(?:li|ion|\d+(?:\.\d+)?(?:v|w|wh|ah|mah)?)|\d+(?:\.\d+)?(?:v|w|wh|ah)-[a-z0-9]+)$/;

function scanCodes(prepared: string): { codes: string[]; next: Map<string, string>; prev: Map<string, string> } {
  const parts = prepared.split(/([^a-z0-9.\-]+)/);
  const codes: string[] = [];
  const next = new Map<string, string>();
  const prev = new Map<string, string>();
  for (let i = 0; i < parts.length; i += 2) {
    const t = parts[i].replace(/^[.\-]+|[.\-]+$/g, "");
    const n = t.replace(/[-.]/g, "");
    if (!isCode(t, n) || SPEC_LIKE_CODE.test(t)) continue;
    const c = n.toUpperCase();
    if (!codes.includes(c)) codes.push(c);
    if (next.has(c)) continue;
    // The previous word ("GSR" in "GSR 120-LI", "Galaxy" in "Galaxy A55"), only across a plain space.
    if (i >= 2 && /^\s+$/.test(parts[i - 1])) {
      const w = parts[i - 2].replace(/^[.\-]+|[.\-]+$/g, "");
      if (w && !COLORS.has(w) && !STOP.has(w)) prev.set(c, w);
    }
    // The next word, colours and stop words skipped, only across plain spaces.
    for (let j = i + 2; j < parts.length && /^\s+$/.test(parts[j - 1]); j += 2) {
      const w = parts[j].replace(/^[.\-]+|[.\-]+$/g, "");
      if (!w || COLORS.has(w) || STOP.has(w) || SPEC_TOKEN.test(w)) continue;
      next.set(c, w);
      break;
    }
  }
  return { codes, next, prev };
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
  for (let w of t.split(ASCII.test(t) ? WORD_SPLIT_ASCII : WORD_SPLIT)) {
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
const WORD_SPLIT_ASCII = /[^a-z0-9.]+/;
/** Plain ASCII text: the faster non-Unicode splits apply. */
const ASCII = /^[\x00-\x7f]*$/;
const HAS_DIGIT = /\d/;
const GLUED_LINE = /^([a-z]{4,}|air|pro|max|mini)(\d{1,2})$/;

const CONNECTOR = /\blightning\b|\b(?:usb|type)[\s-]?c\b|\bmicro[\s-]?usb\b/g;
const SIM_COUNT = /\b(single|dual)[\s-]*sim\b/;
const CONNECTOR_HINT = /lightning|usb|type/;
const NUM_COMPOUND = /(?<![\w.-])(\d+)-([a-z]{3,})\b/g;

/** Word families where two titles naming different members are different products. */
const EXCLUSIVE: Set<string>[] = [
  "fabric leather mesh velvet",
  "glass plastic stainless steel metal aluminium aluminum wood bamboo",
  "wired wireless cordless corded",
  "digital mechanical manual analog",
  "men women boys girls unisex",
  "small medium large",
  "single double twin queen king",
  "hardcover paperback audiobook",
  "indoor outdoor",
  "left right",
].map((g) => new Set(g.split(" ")));
/** Each family word's family (a word belongs to one). */
const EXCLUSIVE_OF = new Map(EXCLUSIVE.flatMap((g, i) => [...g].map((w) => [w, i] as const)));

/** The connectors a title names ("usbc", "lightning usbc"): "USB-C" and "Lightning" models differ. */
function connectors(prepared: string): string {
  const found = new Set<string>();
  for (const m of prepared.matchAll(CONNECTOR)) found.add(m[0][0] === "l" ? "lightning" : m[0][0] === "m" ? "micro" : "usbc");
  return [...found].sort().join(" ");
}

export function titleFeatures(title: string): TitleFeatures {
  const prepared = prepare(title);
  const { codes: codeList, next: codeNext, prev: codePrevRaw } = scanCodes(prepared);
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
  rest = rest.replace(NUM_UNIT, (_m, n: string, unit: string) => {
    const spec = unitSpec(n, unit);
    if (spec) {
      add(spec[0], spec[1]);
      // A set's contents ("544 Pieces"), as opposed to a pack of several units.
      if (spec[0] === "count" && unit.startsWith("p") && unit !== "pack" && unit !== "pk" && Number(n) >= CONTENTS_MIN) add("pieces", n);
    }
    return " ";
  });
  // "256GB 12GB" with no RAM named: the smaller is RAM.
  const storage = specs.get("storage");
  if (!specs.has("ram") && storage?.size === 2) {
    const [lo, hi] = [...storage].map(Number).sort((x, y) => x - y);
    if (lo <= 32 && hi >= 64) {
      storage.delete(String(lo));
      add("ram", String(lo));
    }
  }
  rest = rest.replace(QTY, (_m, n: string, what: string) => {
    add(`qty:${what}`, n);
    return " ";
  });
  const ws = words(rest);
  const own = ownText(rest);
  // Bare numbers and short letter+digit tokens ("16", "s24", "m3", "16e"), compatibility lists
  // left out: the model number. Decimals ("2.0") and long digit runs (SKUs) are not.
  const ownWords = words(own);
  // A bare decimal ("f/1.8", "TruEdge 2.0") is compared apart, see specConflict.
  for (const w of ownWords) {
    if (!HAS_DIGIT.test(w)) continue;
    if (/^\d+\.\d+$/.test(w)) add("dec", num(w));
    else if (!/^\d{6,}$/.test(w)) add("model", w);
  }

  const quiet = own.replace(VARIANT_NOISE, " ");
  const variants = new Set((quiet === own ? ownWords : words(quiet)).filter((w) => VARIANT_WORDS.has(w)));
  if (BUNDLE.test(prepared)) variants.add("bundle");
  for (const m of prepared.matchAll(BAND)) variants.add(`band:${m[1]}`);
  if (CONDITION_HINT.test(prepared)) for (const [name, re] of CONDITIONS) if (re.test(prepared)) variants.add(`cond:${name}`);
  if (/\brenewed\s+premium\b/.test(prepared)) variants.add("cond:renewed-premium");
  const edition = prepared.match(/\b(digital|disc)\s+edition\b/);
  if (edition) variants.add(`edition:${edition[1]}`);
  if (REGION_HINT.test(prepared)) for (const [name, re] of REGIONS) if (re.test(prepared)) variants.add(`region:${name}`);
  const grade = prepared.match(GRADE);
  if (grade) variants.add(`cond:grade-${grade[1]}`);
  if (LANG_HINT.test(prepared)) {
    const langs = new Set<string>(prepared.match(LANG_FULL) ?? []);
    for (const m of prepared.matchAll(LAYOUT)) for (const w of (m[1] ?? m[2]).split(/[^a-z]+/)) if (w) langs.add(LANG_CANON[w] ?? w);
    for (const l of langs) variants.add(`lang:${l}`);
  }

  const parts = new Set<string>();
  if (PART_HINT.test(prepared)) {
    const text = (prepared.includes("case") ? prepared.replace(NOT_ACCESSORY, " ") : prepared).replace(OWN_PRODUCT, " ");
    const end = NAME_END.exec(text);
    const name = end ? text.slice(0, end.index) : text;
    const nameWords = words(name);
    // A code ending the name, then a separator ("TV QA65Q60D - Wall Mount"): the next segment's
    // first words still name the item. Not after a "with / for / +" clause (add-ons, see addons).
    if (end && !/[a-z+&]/.test(end[0])) {
      const last = name.trim().split(/[^a-z0-9.\-/]+/).pop() ?? "";
      const code = last.split("/")[0].replace(/^[.\-]+|[.\-]+$/g, "").replace(/[-.]/g, "").toUpperCase();
      if (code && codes.has(code)) nameWords.push(...words(text.slice(end.index + end[0].length).split(NAME_END)[0]).slice(0, 3));
    }
    // A counted part describes the product ("Dual Basket Airfryer", "2 Drawer", "3 Heads").
    for (let i = 0; i < nameWords.length; i++)
      if (PART_NOUNS.has(nameWords[i]) && !(i > 0 && (COUNT_WORDS.has(nameWords[i - 1]) || /^\d+$/.test(nameWords[i - 1])))) parts.add(singular(nameWords[i]));
  }
  if (prepared.includes("dryer") && WASHER_DRYER.test(prepared)) variants.add("type:washer-dryer");
  const core = prepared.split(/\b(?:with|includes?|including)\b|\s[+&]\s/)[0].replace(NOT_ACCESSORY, " ");
  const accessory = ACCESSORY_HINT.test(core) && words(core).some((w) => ACCESSORY_NOUNS.has(w));
  // Nouns in add-on clauses: "Console Bundle with Mario Kart World and Nintendo Switch 2 Camera".
  const addons = new Set<string>();
  if (ADDON_HINT.test(prepared)) {
    const text = prepared.includes("case") ? prepared.replace(NOT_ACCESSORY, " ") : prepared;
    for (const m of text.matchAll(ADDON_CLAUSE)) {
      let extra = false;
      for (const w of words(m[1])) {
        // "with Extra Jar": one more than the product has, which a plain "Jar" elsewhere does not cover.
        if (EXTRA_WORDS.has(w)) extra = true;
        else if (extra && !STOP.has(w) && !HAS_DIGIT.test(w)) {
          // Whatever comes extra is an add-on ("with Extra Basket").
          addons.add(`extra ${singular(w)}`);
          extra = false;
        } else if (ADDON_NOUNS.has(w)) addons.add(singular(w));
      }
    }
    // The left word of a conjunction too ("Blender, Mill & Chopper"), unless it is the product itself
    // (nothing but its name before it: "Philips Blender & Mill").
    for (const m of text.matchAll(CONJUNCTION)) {
      const before = text.slice(0, m.index);
      const left = before.match(LAST_WORD)?.[1];
      if (left && ADDON_NOUNS.has(left) && /[,;|(\[–&+]|\band\b|\bwith\b/.test(before.slice(0, -left.length))) addons.add(singular(left));
    }
  }

  const plain = ws.filter((w) => !/\d/.test(w));
  // A single letter after a line word is a model designator ("Series X", "EOS R", "Galaxy Z").
  for (let i = 1; i < ws.length; i++) if (ws[i].length === 1 && /[a-z]/.test(ws[i]) && LINE_WORDS.has(ws[i - 1])) add("model", ws[i]);
  const pair = prepared.match(COLOR_PAIR_RE);
  const color = pair ? pair[0] : ws.find((w) => COLORS.has(w));
  const colorWords = new Set(color ? color.split(" ") : []);
  const tokens = new Set<string>();
  const keep = (w: string) => w.length > 1 && !/\d/.test(w) && !STOP.has(w) && !COLORS.has(w) && !colorWords.has(w);
  for (const w of plain) if (keep(w)) tokens.add(w);
  // Model words come from the item's own text (not "for iPhone 17 Pro Max").
  const plainWords = new Set(ownWords.filter((w) => keep(w) && !KNOWN_BRANDS.has(w)));
  // A counted feature no rule above read ("2-Way", "4-Wheel"): a model word, so a title without it differs.
  if (own.includes("-")) for (const m of own.matchAll(NUM_COMPOUND)) plainWords.add(`${m[1]}-${m[2]}`);
  // Model number and generation share one token form ("Pro 2" = "Pro (2nd Generation)").
  for (const [d, vs] of specs) if (d !== "dec") for (const v of vs) tokens.add(`${d === "gen" ? "model" : d}:${v}`);
  for (const c of codes) tokens.add(`code:${c}`);

  // The item's own brand, compatibility lists left out (a PS5 controller by KISSUN).
  // Raw words ("ps5" is no brand; words() would read it as "playstation").
  // A brand named only in a "for <brand> ..." clause is the brand the item fits, not its own.
  let forWord: string | undefined;
  let ownBrandText = own;
  if (FOR_HINT.test(prepared)) {
    for (const m of prepared.matchAll(FOR_BRAND)) if (KNOWN_BRANDS.has(m[1])) forWord ??= m[1];
    if (forWord) ownBrandText = own.replace(FOR_BRAND, (m0, w: string) => (KNOWN_BRANDS.has(w) ? " " : m0));
  }
  const known = ownBrandText.split(ASCII.test(ownBrandText) ? /[^a-z0-9]+/ : /[^a-z0-9\p{L}]+/u).find((w) => KNOWN_BRANDS.has(w));
  const knownBrand = known ? (BRAND_CANON[known] ?? known) : undefined;
  const forBrand = !known && forWord ? (BRAND_CANON[forWord] ?? forWord) : undefined;
  const first = (ASCII.test(title) ? title.trim().split(/[^A-Za-z0-9&'-]+/) : title.trim().split(/[^\p{L}\p{N}&'-]+/u)).find(Boolean) ?? "";
  const leadWord =
    /^\p{Lu}[\p{L}&'-]{2,}$/u.test(first) && !first.toLowerCase().split("-").some((w) => GENERIC_LEAD.has(w) || COLORS.has(w))
      ? first.toLowerCase()
      : undefined;

  const specVals = new Set([...specs].filter(([d]) => d !== "model" && d !== "dec").flatMap(([, v]) => [...v]));
  const fam: string[][] = EXCLUSIVE.map(() => []);
  for (const t of tokens) {
    const i = EXCLUSIVE_OF.get(t);
    if (i !== undefined) fam[i].push(t);
  }
  const exclusive = fam.map((x) => (x.length > 1 ? x.sort().join(" ") : (x[0] ?? "")));
  // Two more families read from phrases: the SIM count and the connector.
  const sim = prepared.includes("sim") ? prepared.match(SIM_COUNT) : null;
  exclusive.push(sim ? sim[1] : "", CONNECTOR_HINT.test(prepared) ? connectors(prepared) : "");
  return {
    knownBrand,
    leadWord,
    brand: knownBrand ?? leadWord,
    codes,
    firstCode: codeList[0],
    codeNext,
    codePrevRaw,
    addons,
    parts,
    codeSfx: codeSuffixes(title),
    forBrand,
    specs,
    variants,
    accessory,
    tokens,
    plainWords,
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
  // "5g" read as a network on one side and a weight in grams on the other: a 5 g pack against 10 g.
  if (netVsWeight(a, b) || netVsWeight(b, a)) return true;
  if (genMissing(a, b) || genMissing(b, a)) return true;
  const ma = multiPack(a);
  if (ma !== multiPack(b) && !(contentsOnly(ma ? a : b) && sharesId(a, b))) return true;
  for (const [d, va] of a.specs) {
    const vb = b.specs.get(d);
    if (!vb) continue;
    if (d === "model") {
      const x = modelOnly(va, b);
      const y = modelOnly(vb, a);
      if (x.size && y.size && !setsEqual(x, y)) return true;
    } else if (d === "dec") {
      // Titles list different version numbers ("TruEdge 2.0, ZeroTangle 3.0" / "ZeroTangle 3.0"):
      // a conflict only when each has one the other lacks ("f/1.4" / "f/1.8").
      if (!subset(va, vb) && !subset(vb, va)) return true;
    } else if (!setsEqual(va, vb)) return true;
  }
  return false;
}

const netVsWeight = (a: TitleFeatures, b: TitleFeatures) =>
  a.specs.has("net") && !a.specs.has("wt") && b.specs.has("wt") && !b.specs.has("net");

/**
 * `a` names a generation and `b` none: `b` must carry that number as its model number ("AirPods
 * Pro (2nd Generation)" / "AirPods Pro 2"), else it is another or an unknown generation.
 */
function genMissing(a: TitleFeatures, b: TitleFeatures): boolean {
  const gen = a.specs.get("gen");
  if (!gen || b.specs.has("gen")) return false;
  const model = b.specs.get("model");
  for (const g of gen) if (!model?.has(g)) return true;
  return false;
}

const multiPack = (f: TitleFeatures) => [...(f.specs.get("count") ?? [])].some((v) => Number(v) > 1);

/** Every count over one is a set's contents ("544 Pieces"), none a multi-pack. */
function contentsOnly(f: TitleFeatures): boolean {
  const pieces = f.specs.get("pieces");
  if (!pieces) return false;
  for (const v of f.specs.get("count") ?? []) if (Number(v) > 1 && !pieces.has(v)) return false;
  return true;
}

/** The same code, or the same model number of 4+ digits ("LEGO 42138"). */
function sharesId(a: TitleFeatures, b: TitleFeatures): boolean {
  if (sharesCode(a, b)) return true;
  const mb = b.specs.get("model");
  if (mb) for (const m of a.specs.get("model") ?? []) if (/^\d{4,}$/.test(m) && mb.has(m)) return true;
  return false;
}

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

const subset = (a: Set<string>, b: Set<string>) => {
  for (const x of a) if (!b.has(x)) return false;
  return true;
};

const setsEqual = (a: Set<string>, b: Set<string>) => {
  if (a.size !== b.size) return false;
  for (const x of a) if (!b.has(x)) return false;
  return true;
};

/** Token weight: rarer tokens in the result set weigh more (a differing "Access" or "Fortnite" counts). */
type Weight = (token: string) => number;

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

/** Plain token similarity of two titles (Jaccard over their words, spec and model tokens), 0..1. */
export const tokenSimilarity = (a: TitleFeatures, b: TitleFeatures): number => jaccard(a.tokens, b.tokens);

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

/**
 * A word right after a code that names a model ("G502 X", "G502 Hero", "M550 Max"). A variant word
 * counts only where the title uses it as one ("Air" in "AF100ME Air Fryer" does not).
 */
const tightWord = (w: string, f: TitleFeatures) =>
  (VARIANT_WORDS.has(w) && f.variants.has(w)) || w.length <= 2 || /\d/.test(w) || w === "hero" || ROMAN.test(w);

const ROMAN = /^(?:i{1,3}|iv|vi{0,3}|ix|x)$/;

function sharesCode(a: TitleFeatures, b: TitleFeatures): boolean {
  for (const c of a.codes) if (b.codes.has(c)) return true;
  return false;
}

/** Codes disagree: none shared, different first codes, or a different model word right after a shared code. */
function codeConflict(a: TitleFeatures, b: TitleFeatures): boolean {
  if (!a.codes.size || !b.codes.size) return false;
  // Different first codes, unless both carry the same codes in another order ("Archer AX55 AX3000").
  if (!sharesCode(a, b) || (a.firstCode !== b.firstCode && !setsEqual(a.codes, b.codes))) return true;
  for (const c of a.codes) {
    if (!b.codes.has(c)) continue;
    // Different article suffixes ("HR2041/10" against "/30") are different articles: only a
    // colour may differ, so everything else in the two titles must be the same.
    if (sfxMatch(a, b, c) === false && !setsEqual(a.tokens, b.tokens)) return true;
    const x = nextWord(a, b, c);
    const y = nextWord(b, a, c);
    if (x !== y && ((x !== undefined && tightWord(x, a)) || (y !== undefined && tightWord(y, b)))) return true;
    const pa = (a.codePrev ?? staticPrev(a)).get(c);
    const pb = (b.codePrev ?? staticPrev(b)).get(c);
    // Different words before the code, unless each title has the other's word too ("3000 Series HR3030" / "Series ... Steamer HR3030").
    if (pa !== undefined && pb !== undefined && pa !== pb && !(a.tokens.has(pb) && b.tokens.has(pa))) return true;
  }
  return false;
}

/** The word after a code, unless the other title carries it too as a code or model number ("AX55 AX3000", "GT500 42138"). */
function nextWord(f: TitleFeatures, other: TitleFeatures, c: string): string | undefined {
  const w = f.codeNext.get(c);
  if (w === undefined || !HAS_DIGIT.test(w)) return w;
  // Its own spec value ("... 30000 DPI") is no model word either.
  return f.specVals.has(w) || other.specs.get("model")?.has(w) || other.codes.has(w.replace(/[-.]/g, "").toUpperCase()) ? undefined : w;
}

/** A shared code's suffixes: true when one is common, false when both state some and none is, else undefined. */
function sfxMatch(a: TitleFeatures, b: TitleFeatures, c: string): boolean | undefined {
  const x = a.codeSfx.get(c);
  const y = b.codeSfx.get(c);
  if (!x || !y) return undefined;
  for (const s of x) if (y.has(s)) return true;
  return false;
}

/** A part noun in `a`'s name that `b` names nowhere. */
function partMissing(a: TitleFeatures, b: TitleFeatures): boolean {
  for (const x of a.parts) if (!b.tokens.has(x) && !b.tokens.has(`${x}s`) && !b.tokens.has(`${x}es`) && !(x === "battery" && b.tokens.has("batteries")) && !(x === "shelf" && b.tokens.has("shelves"))) return true;
  return false;
}

/** An add-on of `a` that `b` neither lists as an add-on nor names anywhere ("with Plastic Jar" / "1.5L Plastic Jar"). */
function addonMissing(a: TitleFeatures, b: TitleFeatures): boolean {
  for (const x of a.addons) if (!b.addons.has(x) && !b.tokens.has(x) && !b.tokens.has(`${x}s`) && !b.tokens.has(`${x}es`)) return true;
  return false;
}

/** The same full article number ("HR2041/30" on both sides). */
function sameArticle(a: TitleFeatures, b: TitleFeatures): boolean {
  for (const c of a.codeSfx.keys()) if (a.codes.has(c) && b.codes.has(c) && sfxMatch(a, b, c)) return true;
  return false;
}

/** Previous words that are model words, judged without a result set (static generic list only). */
function staticPrev(f: TitleFeatures): Map<string, string> {
  return modelPrev(f, isStaticGeneric);
}

function modelPrev(f: TitleFeatures, generic: (w: string) => boolean): Map<string, string> {
  const out = new Map<string, string>();
  for (const [c, w] of f.codePrevRaw) if (w.length >= 3 && !generic(w) && w !== f.brand && !KNOWN_BRANDS.has(w) && !/\d/.test(w)) out.set(c, w);
  return out;
}

/** Hard evidence of different products (see the module comment). */
function conflicts(a: TitleFeatures, b: TitleFeatures): boolean {
  if (a.brand && b.brand && a.brand !== b.brand) return true;
  if (a.knownBrand && b.knownBrand && a.knownBrand !== b.knownBrand) return true;
  if (a.variantKey !== b.variantKey || a.accessory !== b.accessory) return true;
  if (partMissing(a, b) || partMissing(b, a)) return true;
  if ((a.forBrand && a.forBrand === b.knownBrand) || (b.forBrand && b.forBrand === a.knownBrand)) return true;
  // The same article number is the same box, however each store lists what is in it.
  if ((addonMissing(a, b) || addonMissing(b, a)) && !sameArticle(a, b)) return true;
  for (let i = 0; i < a.exclusive.length; i++) if (a.exclusive[i] && b.exclusive[i] && a.exclusive[i] !== b.exclusive[i]) return true;
  if (codeConflict(a, b)) return true;
  return specConflict(a, b);
}

export type MatchOptions = { threshold?: number; weight?: Weight; genericShare?: number };

/** Two titles are the same product (see the module comment). */
export function sameProduct(a: TitleFeatures, b: TitleFeatures, opts: MatchOptions = {}): boolean {
  if (conflicts(a, b)) return false;
  if (sharesCode(a, b)) return true;
  return (
    !!a.brand &&
    a.brand === b.brand &&
    (a.sig ?? signature(a.plainWords, isStaticGeneric)) === (b.sig ?? signature(b.plainWords, isStaticGeneric)) &&
    jaccard(a.tokens, b.tokens, opts.weight) >= (opts.threshold ?? GROUP_THRESHOLD)
  );
}

/**
 * Words that say nothing about which model it is: marketing words and product nouns. Any other word
 * one title has and the other lacks names a different model ("Fold" / "Flip", "Detect Absolute",
 * "Digital Edition", "Classic", "with Clock"), so without a shared code the titles must carry the
 * same such words. Words common in the result set (GENERIC_SHARE of its titles) count as generic.
 */
const STATIC_GENERIC = new Set(
  (
    "wireless bluetooth new original genuine official authentic portable smart charging charge fast latest premium " +
    "edition console device unit product system tool quality professional powerful durable lightweight " +
    "headphones headphone headset earbuds earphones earphone buds speaker speakers camera phone smartphone mobile " +
    "cellphone tablet laptop notebook watch smartwatch perfume fragrance tire controller gamepad mouse keyboard monitor display screen cable " +
    "cord charger adapter vacuum cleaner purifier fryer kettle blender machine maker iron dryer hairdryer chair desk " +
    "lamp bottle backpack bag shoes sneakers stroller toothbrush electric version warranty year years generation " +
    "black usb type genuine brand hot sale best top high super ultra-thin certified compatible sealed box " +
    "storage performance rechargeable liter liters capacity size power battery cordless aluminium material " +
    "style design function functions technology tech support home office travel daily"
  ).split(/\s+/),
);
const isStaticGeneric = (w: string) => STATIC_GENERIC.has(w);

/** Feature words that name a different model even when common in the result set (a footrest, ANC, a clock). */
const FEATURE_WORDS = new Set("footrest footstool clock anc noise cancellation cancelling canceling heated heater".split(" "));

/** Share of the result set's titles from which a word counts as generic (tuned on the eval's tune half). */
const GENERIC_SHARE = 0.02;

function signature(words: Set<string>, generic: (w: string) => boolean): string {
  return [...words].filter((w) => !generic(w)).sort().join(" ");
}

export type ProductGroup = {
  key: string;
  /** Every member, cheapest first (so each store's cheapest listing comes before its others). */
  members: Product[];
  /** The cheapest confident deliverable member (else the cheapest confident, else the cheapest). */
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
  if (!code && (!f.brand || c.brand !== f.brand || c.uniq.some((m) => m.f.brand !== f.brand || m.f.sig !== f.sig))) return 0;
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
  const df = new Map<string, number>();
  for (const f of fs) for (const t of f.plainWords) df.set(t, (df.get(t) ?? 0) + 1);
  const common = Math.max(3, (opts.genericShare ?? GENERIC_SHARE) * fs.length);
  const generic = (t: string) => STATIC_GENERIC.has(t) || (!FEATURE_WORDS.has(t) && (df.get(t) ?? 0) >= common);
  for (const f of fs) {
    f.sig = signature(f.plainWords, generic);
    f.codePrev = modelPrev(f, generic);
  }

  const clusters: Cluster[] = [];
  // Without a shared code a match needs the same brand, the same model words and no conflicting
  // model number: index by brand + words, then by model number ("" = none stated, fits any).
  const byBrand = new Map<string, Map<string, Cluster[]>>();
  const byCode = new Map<string, Set<Cluster>>();
  for (const it of items) {
    const bk = it.f.brand ? `${it.f.brand}|${it.f.sig}` : undefined;
    const mk = modelKey(it.f);
    const cands = new Set<Cluster>();
    const byModel = bk ? byBrand.get(bk) : undefined;
    if (byModel) {
      if (mk) for (const k of [mk, ""]) for (const c of byModel.get(k) ?? []) cands.add(c);
      else for (const cs of byModel.values()) for (const c of cs) cands.add(c);
    }
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
    if (bk) {
      const m = byBrand.get(bk) ?? new Map<string, Cluster[]>();
      byBrand.set(bk, m);
      const list = m.get(mk) ?? [];
      if (!list.includes(best)) m.set(mk, [...list, best]);
    }
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
  return { ...f, codes: new Set(f.codes), tokens: new Set(f.tokens), sig: undefined, codePrev: undefined };
}

/** The model numbers as an index key; "" when none. */
const modelKey = (f: TitleFeatures) => [...(f.specs.get("model") ?? [])].sort().join(" ");

function makeGroup(items: Item[]): ProductGroup {
  const sorted = [...items].sort((x, y) => priceOf(x.p) - priceOf(y.p) || (x.k < y.k ? -1 : x.k > y.k ? 1 : 0));
  const members = sorted.map((x) => x.p);
  const best = members.find((p) => isLikelyMatch(p) && !p.pickupOnly) ?? members.find(isLikelyMatch) ?? members[0];
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
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- the keys passed to rank() are lead's own keys
  return rank([...lead.keys()], sort).map((p) => lead.get(p)!);
}

/** Multi-store groups as ids only, for the search response. */
export function groupRefs(groups: ProductGroup[]): GroupRef[] {
  return groups
    .filter((g) => g.members.length > 1)
    .map((g) => ({ key: g.key, memberKeys: g.members.map(keyOf), bestKey: keyOf(g.best), colors: g.colors }));
}

/**
 * Every word the matcher's own lists know (brands, product lines, colours, variant, accessory,
 * part and add-on words): the spelling vocabulary keeps them (src/lib/query/vocab.ts).
 */
export function matcherWords(): string[] {
  return [
    ...KNOWN_BRANDS, ...GENERIC_LEAD, ...COLORS, ...VARIANT_WORDS, ...ACCESSORY_NOUNS, ...ADDON_NOUNS,
    ...PART_NOUNS, ...LINE_WORDS, ...COUNT_WORDS, ...EXTRA_WORDS,
  ];
}
