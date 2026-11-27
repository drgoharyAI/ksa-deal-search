/**
 * Single entry the eval scripts (scripts/eval*.mjs) load through Vite's module runner, so every
 * module (registry, aa back-off state, noon browser) is shared within one script run.
 */
export { sites } from "@/src/sites/registry";
export { aaCall } from "@/src/lib/aa";
export { runSearch } from "@/src/lib/pipeline";
export { parseQuery } from "@/src/lib/query/parse";
export { createRunCall } from "@/src/sites/noon-sa/search";
export { withNoonPage, closeNoonBrowser } from "@/src/sites/noon-sa/browser";
export { plannedCalls, callKey, querySlug, createReplayExec, recordedProducts } from "./replay";
export { computeMetrics, aggregate, labelKey } from "./metrics";
