/**
 * Client-safe store list for the UI. Mirrors the keys and labels (logo: file under public/stores) of
 * src/sites/registry.ts (server-only); tests/lib/stores.test.ts keeps them in sync.
 */
export const STORES = [
  { id: "aliexpress", label: "AliExpress", logo: "/stores/aliexpress.ico" },
  { id: "amazon-sa", label: "Amazon KSA", logo: "/stores/amazon-sa.ico" },
  { id: "jarir", label: "Jarir", logo: "/stores/jarir.svg" },
  { id: "noon-sa", label: "noon KSA", logo: "/stores/noon-sa.ico" },
  { id: "trendyol-sa", label: "Trendyol KSA", logo: "/stores/trendyol-sa.png" },
] as const;

export type StoreId = (typeof STORES)[number]["id"];

const LABELS: Record<string, string> = Object.fromEntries(STORES.map((s) => [s.id, s.label]));

export const storeLabel = (id: string): string => LABELS[id] ?? id;
