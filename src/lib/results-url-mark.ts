/**
 * Client-safe. A results URL (a shared link, a reload, a History re-run) would first paint the
 * prerendered home and then collapse it into the results layout: a large layout shift. An inline
 * script in app/layout.tsx marks <html> before first paint when the URL carries a query; CSS keeps
 * the home hidden while the mark is on (with a 4s fallback); the search page clears the mark.
 */
export const RESULTS_URL_ATTR = "data-results-url";

/** The inline script: plain ES5, no imports, never throws. */
export const RESULTS_URL_MARK_SCRIPT = `try{if((new URLSearchParams(location.search).get('q')||'').trim())document.documentElement.setAttribute('${RESULTS_URL_ATTR}','')}catch(e){}`;

/** The search page shows itself from here: a search started, or results (or an error) are on screen. */
export function shouldClearMark(phase: "idle" | "loading" | "done" | "error", home: boolean): boolean {
  return phase !== "idle" || !home;
}

export function clearResultsUrlMark(root: Pick<Element, "removeAttribute"> = document.documentElement): void {
  root.removeAttribute(RESULTS_URL_ATTR);
}
