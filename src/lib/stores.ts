/**
 * Client-safe store list for the UI. Mirrors the keys and labels (logo: file under public/stores) of
 * src/sites/registry.ts (server-only); tests/lib/stores.test.ts keeps them in sync.
 * defaultSelected: checked when the page opens. note: short helper text shown by the checkbox.
 */
type Store = { id: string; label: string; logo: string; defaultSelected: boolean; note?: string };

export const STORES = [
  { id: "aliexpress", label: "AliExpress", logo: "/stores/aliexpress.ico", defaultSelected: true },
  { id: "amazon-sa", label: "Amazon KSA", logo: "/stores/amazon-sa.ico", defaultSelected: true },
  { id: "jarir", label: "Jarir", logo: "/stores/jarir.svg", defaultSelected: true },
  { id: "noon-sa", label: "noon KSA", logo: "/stores/noon-sa.ico", defaultSelected: true },
  { id: "trendyol-sa", label: "Trendyol KSA", logo: "/stores/trendyol-sa.png", defaultSelected: true },
  { id: "extra-sa", label: "eXtra", logo: "/stores/extra-sa.ico", defaultSelected: true },
  { id: "carrefour-sa", label: "Carrefour KSA", logo: "/stores/carrefour-sa.ico", defaultSelected: true },
  // Off by default: real Chrome, one search per 5 s at most, and SHEIN's risk control may block it.
  {
    id: "shein-sa",
    label: "SHEIN KSA",
    logo: "/stores/shein-sa.ico",
    defaultSelected: false,
    note: "Slower; may be rate-limited",
  },
] as const satisfies readonly Store[];

/** Store ids checked when the page opens. */
export const defaultSites = (): string[] => STORES.filter((s) => s.defaultSelected).map((s) => s.id);

const LABELS: Record<string, string> = Object.fromEntries(STORES.map((s) => [s.id, s.label]));

export const storeLabel = (id: string): string => LABELS[id] ?? id;
