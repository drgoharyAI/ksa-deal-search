import type { SiteAdapter } from "@/src/lib/types";
import * as aliexpress from "./aliexpress/search";
import * as amazonSa from "./amazon-sa/search";
import * as carrefourSa from "./carrefour-sa/search";
import * as extraSa from "./extra-sa/search";
import * as jarir from "./jarir/search";
import * as noonSa from "./noon-sa/search";
import * as sheinSa from "./shein-sa/search";
import * as trendyolSa from "./trendyol-sa/search";

export const sites: Record<string, SiteAdapter> = {
  aliexpress: {
    id: "aliexpress",
    label: "AliExpress",
    searchCalls: aliexpress.searchCalls,
    normalizeSearchItem: aliexpress.normalizeSearchItem,
  },
  "amazon-sa": {
    id: "amazon-sa",
    label: "Amazon KSA",
    searchCalls: amazonSa.searchCalls,
    normalizeSearchItem: amazonSa.normalizeSearchItem,
  },
  jarir: {
    id: "jarir",
    label: "Jarir",
    searchCalls: jarir.searchCalls,
    normalizeSearchItem: jarir.normalizeSearchItem,
  },
  "noon-sa": {
    id: "noon-sa",
    label: "noon KSA",
    searchCalls: noonSa.searchCalls,
    normalizeSearchItem: noonSa.normalizeSearchItem,
    runCall: noonSa.runCall,
    blockedEndsAt: noonSa.runCall.blockedEndsAt,
  },
  "trendyol-sa": {
    id: "trendyol-sa",
    label: "Trendyol KSA",
    searchCalls: trendyolSa.searchCalls,
    normalizeSearchItem: trendyolSa.normalizeSearchItem,
  },
  "extra-sa": {
    id: "extra-sa",
    label: "eXtra",
    searchCalls: extraSa.searchCalls,
    normalizeSearchItem: extraSa.normalizeSearchItem,
  },
  "carrefour-sa": {
    id: "carrefour-sa",
    label: "Carrefour KSA",
    searchCalls: carrefourSa.searchCalls,
    normalizeSearchItem: carrefourSa.normalizeSearchItem,
  },
  "shein-sa": {
    id: "shein-sa",
    label: "SHEIN KSA",
    searchCalls: sheinSa.searchCalls,
    normalizeSearchItem: sheinSa.normalizeSearchItem,
    runCall: sheinSa.runCall,
    blockedEndsAt: sheinSa.runCall.blockedEndsAt,
  },
};
