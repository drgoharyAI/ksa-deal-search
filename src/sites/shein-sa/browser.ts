import "server-only";
import type { Page } from "playwright-core";
import { createBrowserQueue, createCdpLauncher, type BrowserQueue, type ChromeDeps, type Launcher } from "../chrome/cdp";
import { resolveSheinProfileDir } from "./profile";

/**
 * SHEIN's own Chrome process on its own profile (generic launcher and queue: ../chrome/cdp.ts).
 * api-anything and plain HTTP are redirected to /risk/challenge; the installed Chrome with a fixed
 * debug port gets real result pages. See docs/superpowers/spikes/2026-11-27-shein-sa.md.
 */

const SHEIN_ARGS = ["--lang=en-US", "--window-size=1366,900"];

/** Launcher for the SHEIN profile; the profile path is resolved at launch time, never at import. */
export function createSheinLauncher(overrides: Partial<ChromeDeps> = {}): Launcher {
  return createCdpLauncher({ profileDir: () => resolveSheinProfileDir(), extraArgs: SHEIN_ARGS, overrides });
}

const g = globalThis as typeof globalThis & { __sheinBrowser?: BrowserQueue; __sheinBrowserExitHook?: boolean };

/** One instance per process, on globalThis so Next dev HMR keeps track of the running Chrome. */
export function sharedSheinBrowser(): BrowserQueue {
  g.__sheinBrowser ??= createBrowserQueue({ launch: createSheinLauncher() });
  if (!g.__sheinBrowserExitHook) {
    g.__sheinBrowserExitHook = true;
    process.once("exit", () => g.__sheinBrowser?.killNow());
  }
  return g.__sheinBrowser;
}

/** Run `fn` with the shared SHEIN Chrome page; jobs are serialized. Idle-closes after 10 min. */
export function withSheinPage<T>(fn: (page: Page) => Promise<T>): Promise<T> {
  return sharedSheinBrowser().withPage(fn);
}
