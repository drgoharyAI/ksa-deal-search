import brands from "@/data/brands.json";
import type { Product } from "@/src/lib/types";

/**
 * Client-safe brand and key-spec reading from product titles, for the filter chips and the
 * compare table (spec: "Comparison and deal-insight features", items 3 and 4). Pure: no server
 * imports. The small helpers here are deliberately separate from src/lib/match/group.ts, which
 * reads titles for grouping; this module only needs display values.
 */

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
const KNOWN = new Set<string>([...brands, ...Object.keys(BRAND_CANON)]);

/** Leading words that are not a brand ("Original Apple ...", "Wireless Earbuds ..."). */
const GENERIC_LEAD = new Set(
  (
    "original new genuine authentic official hot sale wireless portable smart mini electric professional premium " +
    "upgraded upgrade latest best high ultra super gaming bluetooth usb led digital automatic multifunctional " +
    "multifunction household home kids kid baby car mechanical rechargeable foldable waterproof magnetic fast " +
    "universal men women unisex mens womens for the with global version international brand luxury large small " +
    "cordless handheld stainless adjustable ergonomic compact lightweight heavy quiet noise active true open " +
    "air water travel outdoor office desk kitchen pro max plus classic vintage modern simple cute creative " +
    "hd full tws anc hifi stereo sports sport running fashion cheap quality top renewed refurbished used pack set " +
    "kit lot pcs piece pair dual triple multi auto power heated cooling black white silver gold blue red green pink " +
    "purple gray grey yellow orange beige brown rose cotton case cover screen charger cable phone watch laptop"
  ).split(/\s+/),
);

const LABELS: Record<string, string> = {
  hp: "HP", lg: "LG", jbl: "JBL", msi: "MSI", dji: "DJI", oneplus: "OnePlus", gopro: "GoPro", tcl: "TCL",
  asus: "ASUS", ugreen: "UGREEN",
};

/** The item's own words: the title before "for / compatible with ..." (what it fits). */
const ownPart = (t: string) => t.split(/\b(?:for|compatible|fits?|works with|replacement)\b/i)[0];

/** Canonical lowercase brand of a title: a known brand (or line naming one), else a capitalised lead word. */
export function brandOf(title: string): string | undefined {
  const own = ownPart(title).toLowerCase();
  const known = own.split(/[^a-z0-9\p{L}]+/u).find((w) => KNOWN.has(w));
  if (known) return BRAND_CANON[known] ?? known;
  const first = title.trim().split(/[^\p{L}\p{N}&'-]+/u).find(Boolean) ?? "";
  if (!/^\p{Lu}[\p{L}&'-]{2,}$/u.test(first)) return undefined;
  const lower = first.toLowerCase();
  return lower.split("-").some((w) => GENERIC_LEAD.has(w)) ? undefined : lower;
}

/** Display name of a canonical brand. */
export function brandLabel(b: string): string {
  return LABELS[b] ?? b.charAt(0).toUpperCase() + b.slice(1);
}

export const productKey = (p: Pick<Product, "site" | "id">): string => `${p.site}+${p.id}`;

/**
 * Brand per product (key: productKey). A known brand always counts; a lead word counts only when
 * at least two titles in the set share it, so one odd first word does not become a chip.
 */
export function brandsFor(products: Product[]): Map<string, string | undefined> {
  const raw = products.map((p) => ({ k: productKey(p), b: brandOf(p.title), known: isKnownBrand(p.title) }));
  const lead = new Map<string, number>();
  for (const r of raw) if (r.b && !r.known) lead.set(r.b, (lead.get(r.b) ?? 0) + 1);
  return new Map(raw.map((r) => [r.k, r.b && (r.known || (lead.get(r.b) ?? 0) >= 2) ? r.b : undefined]));
}

const isKnownBrand = (title: string) => ownPart(title).toLowerCase().split(/[^a-z0-9\p{L}]+/u).some((w) => KNOWN.has(w));

/** Key specs read from a title, as display strings. Absent keys: the title does not say. */
export type Specs = {
  storage?: string;
  ram?: string;
  wattage?: string;
  capacity?: string;
  size?: string;
  resolution?: string;
  model?: string;
};

export const SPEC_ROWS: { key: keyof Specs; label: string }[] = [
  { key: "model", label: "Model" },
  { key: "storage", label: "Storage" },
  { key: "ram", label: "RAM" },
  { key: "size", label: "Screen or size" },
  { key: "resolution", label: "Resolution" },
  { key: "wattage", label: "Wattage" },
  { key: "capacity", label: "Battery capacity" },
];

/** Normalized tokens with digits that are specs or line names, not model codes ("100w", "bt5.3", "usb-c"). */
const SPEC_TOKEN =
  /^(?:\d+(?:\.\d+)?(?:mah|gb|tb|mb|w|watts?|inch|inches|in|mm|cm|m|hz|khz|ghz|mhz|l|ml|lt|ltr|k|p|g|v|a|kg|mp|pcs|pc|pack|pk|x|nm|st|nd|rd|th|fps|ms|db|rpm|pa|kpa|oz|lb|lbs|h|hrs|min|s|d|bit|core|cores|ft|dpi|kw|ah|wh|n|c|f|t|e|fe)|(?:gen|wifi|bt|ble|usb|ip|ipx|ddr|lpddr|gddr|pcie|hdmi|qi|type|cat|series|ver|pd|qc|uhs|class|level|vol)\d+(?:\.\d+)?[a-z]?|v\d{1,2}(?:\.\d)?|\d+(?:\.\d+)?(?:x\d+(?:\.\d+)?)+[a-z]*|(?:hdr|pm|spo|win|rj)\d+(?:\.\d+)?|\d+in\d+|\d+(?:gbps|mbps|kbps)|\d+[a-z]{3,})$/;
/** Component codes (sensors) name a part many models share. */
const COMPONENT_CODE = /^(?:paw|pmw|imx|ov)\d+/;
const GLUED_LINE = /^(?:[a-z]{4,}\d+|(?:air|pro|max|mini)\d{1,2}|(?:[a-z])?\d{1,2}(?:pro|plus|max|ultra|fe|se|mini|lite))$/;

/** The first model / part code in the title, in its own spelling ("WH-1000XM5", "SM-S921B"). */
export function modelCode(title: string): string | undefined {
  for (const raw of title.split(/[^A-Za-z0-9.\-]+/)) {
    const t = raw.replace(/^[.\-]+|[.\-]+$/g, "");
    const lower = t.toLowerCase();
    if (!/\d/.test(t) || !/[a-z]/i.test(t)) continue;
    const n = lower.replace(/[-.]/g, "");
    if (n.length < 4 || SPEC_TOKEN.test(lower) || SPEC_TOKEN.test(n) || COMPONENT_CODE.test(n) || GLUED_LINE.test(n)) continue;
    return t.toUpperCase();
  }
  return undefined;
}

const fmt = (n: number) => String(Number(n.toFixed(2)));
const gb = (n: number, unit: string) => (unit === "tb" ? `${fmt(n)} TB` : n >= 1024 && n % 1024 === 0 ? `${n / 1024} TB` : `${fmt(n)} GB`);

/** Resolutions, highest first; the first one a title names wins. */
const RESOLUTIONS: [RegExp, string][] = [
  [/(?<![\d.])8k\b|\b4320p\b/, "8K"],
  [/(?<![\d.])4k\b|\b2160p\b|\buhd\b|\bultra\s*hd\b|\b3840\s*[x×*]\s*2160\b/, "4K"],
  [/(?<![\d.])2k\b|\b1440p\b|\bqhd\b|\b2560\s*[x×*]\s*1440\b/, "QHD"],
  [/\b1080p\b|\bfhd\b|\bfull\s*hd\b|\b1920\s*[x×*]\s*1080\b/, "Full HD"],
  [/\b720p\b|\bhd\b/, "HD"],
];

/** Key specs from a title: storage, RAM, wattage, capacity, size, resolution, model code. */
export function parseSpecs(title: string): Specs {
  const out: Specs = {};
  const model = modelCode(title);
  // Lowercase, thousands separators gone, the model code cut out so its digits are not specs.
  let t = title.toLowerCase().replace(/(\d),(?=\d{3}(?!\d))/g, "$1");
  if (model) t = t.split(model.toLowerCase()).join(" ");
  const cut = (re: RegExp, f: (m: RegExpExecArray) => void) => {
    t = t.replace(re, (...args) => {
      f(args.slice(0, -2) as unknown as RegExpExecArray);
      return " ";
    });
  };
  const first = (k: keyof Specs, v: string) => {
    if (out[k] === undefined) out[k] = v;
  };

  cut(/(?<![\d.])\d+\s*(?:-\s*)?in\s*(?:-\s*)?1\b/g, () => {});
  // "8GB+256GB", "12/512GB": RAM then storage.
  cut(/(?<![\d.])(\d{1,2})\s*(?:gb\s*)?[+/]\s*(\d{2,4})\s*(gb|tb)(?![a-z])/g, (m) => {
    first("ram", `${m[1]} GB`);
    first("storage", gb(Number(m[2]), m[3]));
  });
  cut(/(?<![\d.])(\d+)\s*gb\s*(?:of\s*)?(?:ram|memory|lpddr\d*x?|ddr\d*)\b/g, (m) => first("ram", `${m[1]} GB`));
  cut(/\bram\s*:?\s*(\d+)\s*gb\b/g, (m) => first("ram", `${m[1]} GB`));
  cut(/(?<![\d.])(\d+(?:\.\d+)?)\s*(gb|tb)(?![a-z])/g, (m) => first("storage", gb(Number(m[1]), m[2])));
  cut(/(?<![\d.])(\d+(?:\.\d+)?)\s*mah\b/g, (m) => first("capacity", `${fmt(Number(m[1]))} mAh`));
  cut(/(?<![\d.])(\d+(?:\.\d+)?)\s*(?:w|watts?)(?![a-z])/g, (m) => first("wattage", `${fmt(Number(m[1]))} W`));
  cut(/(?<![\d.])(\d+(?:\.\d+)?)\s*(?:"|''|”|(?:-\s*)?inch(?:es)?\b|in\b)/g, (m) => first("size", `${fmt(Number(m[1]))} in`));
  for (const [re, label] of RESOLUTIONS)
    if (re.test(t)) {
      out.resolution = label;
      break;
    }
  if (model) out.model = model;
  return out;
}
