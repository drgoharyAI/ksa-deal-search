import "server-only";
import { cleanQuery } from "./client";
import { bestCard, blockedUrl, cardOffers, detectBlock, googleSearchUrl, panelOffers, parsePanelHtml, parseResultsHtml, type BlockReason } from "./scrape-parse";
import type { GshopOffer } from "./validate";

/**
 * The Chrome fallback: google.com.sa Shopping in the owner's real Chrome (its own profile and
 * queue, browser.ts), used only when SerpApi has no searches left, is down, or has no key.
 * At most 2 Google requests per validation: the results page, then one click on the best
 * card to open its product panel, the only place with merchant links. Captchas are never solved:
 * a block is reported and the caller backs off (service.ts).
 */

/** What the scrape needs from a browser page (browser.ts adapts Playwright's Page). */
export type ScrapePage = {
  goto(url: string): Promise<unknown>;
  url(): string;
  content(): Promise<string>;
  /** Clicks the n-th "Go to product viewer" card of the results page (opens its product panel). */
  clickCard(index: number): Promise<void>;
  wait(ms: number): Promise<void>;
};

export type ScrapeOutcome =
  | { kind: "ok"; offers: GshopOffer[]; loads: number; panel: boolean }
  | { kind: "blocked"; reason: Exclude<BlockReason, "empty">; loads: number }
  | { kind: "skipped"; loads: 0 }
  | { kind: "error"; message: string; loads: number };

export type ScrapeGates = {
  /** Reserve one Google page load (budget, spacing); false = do not load. */
  beforeLoad(): Promise<boolean>;
  /** Reserve the panel request; false = keep the grid offers only. */
  beforePanel(): Promise<boolean>;
};

/** Time for the page's scripts to draw the grid, and for the panel to load its offers. */
const RENDER_MS = 1_500;
const PANEL_MS = 3_500;

const isTimeout = (e: unknown) => e instanceof Error && (e.name === "TimeoutError" || /timeout/i.test(e.message));

/** Never throws. */
export async function scrapeGoogle(title: string, page: ScrapePage, gates: ScrapeGates): Promise<ScrapeOutcome> {
  const q = cleanQuery(title);
  if (!q || !(await gates.beforeLoad())) return { kind: "skipped", loads: 0 };
  let loads = 1;
  try {
    await page.goto(googleSearchUrl(q));
    await page.wait(RENDER_MS);
    const html = await page.content();
    const block = detectBlock({ url: page.url(), html });
    // Only a real CAPTCHA, /sorry/ or consent page is a block (and starts the back-off). An empty
    // page is an error for this check only.
    if (block === "empty") return { kind: "error", message: "empty page", loads };
    if (block) return { kind: "blocked", reason: block, loads };
    const cards = parseResultsHtml(html);
    const offers = cardOffers(cards);
    const best = bestCard(cards, title);
    if (!best || !(await gates.beforePanel())) return { kind: "ok", offers, loads, panel: false };
    loads = 2;
    // The panel only adds links: if it will not open, the grid offers stand and it is no block.
    try {
      await page.clickCard(best.index);
      await page.wait(PANEL_MS);
    } catch (e) {
      const after = blockedUrl(page.url());
      if (after && after !== "empty") return { kind: "blocked", reason: after, loads };
      console.warn("[gshop] product panel did not open", e instanceof Error ? e.message.slice(0, 120) : "error");
      return { kind: "ok", offers, loads, panel: false };
    }
    const after = blockedUrl(page.url());
    if (after && after !== "empty") return { kind: "blocked", reason: after, loads };
    const panel = parsePanelHtml(await page.content());
    return { kind: "ok", offers: [...offers, ...panelOffers(panel, best.title)], loads, panel: panel.length > 0 };
  } catch (e) {
    // A timeout is a slow network or page, not a CAPTCHA: an error, never a back-off.
    if (isTimeout(e)) return { kind: "error", message: "timed out", loads };
    return { kind: "error", message: e instanceof Error ? e.message.slice(0, 200) : "scrape failed", loads };
  }
}
