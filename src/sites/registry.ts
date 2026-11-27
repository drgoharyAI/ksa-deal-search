import type { SiteAdapter } from "@/src/lib/types";
import { searchCalls, normalizeSearchItem } from "./aliexpress/search";

export const sites: Record<string, SiteAdapter> = {
  aliexpress: {
    id: "aliexpress",
    label: "AliExpress",
    searchCalls,
    normalizeSearchItem,
    fetchDetail: async (p) => p,
  },
};
