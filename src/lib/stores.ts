/**
 * Client-safe store list for the UI. Mirrors the keys and labels of
 * src/sites/registry.ts (server-only); tests/lib/stores.test.ts keeps them in sync.
 */
export const STORES = [
  { id: "aliexpress", label: "AliExpress" },
  { id: "amazon-sa", label: "Amazon KSA" },
  { id: "jarir", label: "Jarir" },
  { id: "noon-sa", label: "noon KSA" },
  { id: "trendyol-sa", label: "Trendyol KSA" },
] as const;

export type StoreId = (typeof STORES)[number]["id"];

const LABELS: Record<string, string> = Object.fromEntries(STORES.map((s) => [s.id, s.label]));

export const storeLabel = (id: string): string => LABELS[id] ?? id;
