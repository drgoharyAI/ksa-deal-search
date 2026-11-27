import type { SiteAdapter } from "@/src/lib/types";
import * as aliexpress from "./aliexpress/search";
import * as amazonSa from "./amazon-sa/search";
import * as jarir from "./jarir/search";
import * as noonSa from "./noon-sa/search";
import * as trendyolSa from "./trendyol-sa/search";

export const sites: Record<string, SiteAdapter> = {
  aliexpress: {
    id: "aliexpress",
    label: "AliExpress",
    searchCalls: aliexpress.searchCalls,
    normalizeSearchItem: aliexpress.normalizeSearchItem,
    fetchDetail: async (p) => p,
  },
  "amazon-sa": {
    id: "amazon-sa",
    label: "Amazon KSA",
    searchCalls: amazonSa.searchCalls,
    normalizeSearchItem: amazonSa.normalizeSearchItem,
    fetchDetail: async (p) => p,
  },
  jarir: {
    id: "jarir",
    label: "Jarir",
    searchCalls: jarir.searchCalls,
    normalizeSearchItem: jarir.normalizeSearchItem,
    fetchDetail: async (p) => p,
  },
  "noon-sa": {
    id: "noon-sa",
    label: "noon KSA",
    searchCalls: noonSa.searchCalls,
    normalizeSearchItem: noonSa.normalizeSearchItem,
    runCall: noonSa.runCall,
    fetchDetail: async (p) => p,
  },
  "trendyol-sa": {
    id: "trendyol-sa",
    label: "Trendyol KSA",
    searchCalls: trendyolSa.searchCalls,
    normalizeSearchItem: trendyolSa.normalizeSearchItem,
    fetchDetail: async (p) => p,
  },
};
