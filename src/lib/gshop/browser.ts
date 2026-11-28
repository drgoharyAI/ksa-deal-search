import "server-only";
import os from "node:os";
import path from "node:path";
import type { Page } from "playwright-core";
import { createBrowserQueue, createCdpLauncher, type BrowserQueue } from "@/src/sites/chrome/cdp";
import type { ScrapePage } from "./scrape";

/**
 * Google's own Chrome process on its own profile, through the shared CDP layer (cdp.ts), like
 * SHEIN. Not noon's queue: cdp.ts runs one Chrome per profile so cookies and risk scores never
 * mix, and a Google check (up to ~20 s with the panel) must never hold up a noon search. The
 * profile is kept out of the repo. Idle-closes after 10 min like the others.
 */

type Env = Record<string, string | undefined>;

/** GSHOP_PROFILE_DIR, else %LOCALAPPDATA%\deal-search\gshop-profile, else ~/.deal-search/gshop-profile. */
export function resolveGshopProfileDir(env: Env = process.env, home: string = os.homedir()): string {
  if (env.GSHOP_PROFILE_DIR) return path.resolve(env.GSHOP_PROFILE_DIR);
  if (env.LOCALAPPDATA) return path.join(env.LOCALAPPDATA, "deal-search", "gshop-profile");
  return path.join(home, ".deal-search", "gshop-profile");
}

const LOAD_TIMEOUT_MS = 30_000;
const CARD = '[aria-label$="Go to product viewer for this item."]';

/** Adapts a Playwright page to what scrapeGoogle needs. */
export function playwrightScrapePage(page: Page): ScrapePage {
  return {
    async goto(url) {
      // A page left on Google with its product panel open: start from a blank page, so the search
      // is a fresh navigation and never an in-page one Google's scripts can abort.
      if (page.url() !== "about:blank") await page.goto("about:blank").catch(() => undefined);
      return page.goto(url, { waitUntil: "domcontentloaded", timeout: LOAD_TIMEOUT_MS });
    },
    url: () => page.url(),
    content: () => page.content(),
    async clickCard(index) {
      // The labelled card element is an overlay with no box of its own: a DOM click bubbles to
      // Google's own click handler, where a pointer click times out (live, 2026-11-28).
      const card = page.locator(CARD).nth(index);
      await card.scrollIntoViewIfNeeded({ timeout: 5_000 }).catch(() => undefined);
      await card.evaluate((el) => (el as HTMLElement).click(), undefined, { timeout: 10_000 });
    },
    wait: (ms) => page.waitForTimeout(ms),
  };
}

const g = globalThis as typeof globalThis & { __gshopBrowser?: BrowserQueue; __gshopBrowserExitHook?: boolean };

/** One instance per process, on globalThis so Next dev HMR keeps track of the running Chrome. */
function sharedGshopBrowser(): BrowserQueue {
  g.__gshopBrowser ??= createBrowserQueue({
    launch: createCdpLauncher({ profileDir: () => resolveGshopProfileDir(), extraArgs: ["--lang=en-US", "--window-size=1366,900"] }),
  });
  if (!g.__gshopBrowserExitHook) {
    g.__gshopBrowserExitHook = true;
    process.once("exit", () => g.__gshopBrowser?.killNow());
  }
  return g.__gshopBrowser;
}

/** Kills Google's Chrome now (a job past its deadline); the next job relaunches it. */
export function recycleGshopBrowser(): void {
  sharedGshopBrowser().killNow();
}

/** Run `fn` with Google's Chrome page; jobs are serialized. */
export function withGshopPage<T>(fn: (page: ScrapePage) => Promise<T>): Promise<T> {
  return sharedGshopBrowser().withPage((p) => fn(playwrightScrapePage(p)));
}
