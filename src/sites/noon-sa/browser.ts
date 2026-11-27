import "server-only";
import type { Page } from "playwright-core";
import {
  createBrowserQueue,
  createCdpLauncher,
  type ChromeDeps,
  type ChromeSession,
  type Launcher,
} from "../chrome/cdp";
import { chooseProfileDir, resolveProfileDir } from "./profile";

/**
 * noon's own Chrome (generic launcher and queue: ../chrome/cdp.ts). noon's bot protection blocks
 * `launchPersistentContext` (adds --enable-automation) and headless Chrome, so neither is used.
 * See docs/superpowers/spikes/2026-11-27-noon-sa.md ("Playwright spike").
 */

export { IDLE_CLOSE_MS, findChrome, type ChromeDeps, type Launcher } from "../chrome/cdp";
export type NoonSession = ChromeSession;

/** One shared noon browser: lazy launch, FIFO jobs, idle close (see createBrowserQueue). */
export const createNoonBrowser = createBrowserQueue;

/** Chosen once per process, at first launch (never at import): see chooseProfileDir. */
let chosenProfileDir: string | null = null;
const lazyProfileDir = () => (chosenProfileDir ??= chooseProfileDir(resolveProfileDir()));

/** Launcher for the owner's Chrome on the noon profile (see profile.ts). */
export function createChromeLauncher(overrides: Partial<ChromeDeps> = {}): Launcher {
  return createCdpLauncher({ profileDir: lazyProfileDir, overrides });
}

export const launchChrome: Launcher = createChromeLauncher();

// ---------------- shared instance ----------------

type NoonBrowser = ReturnType<typeof createNoonBrowser>;
const g = globalThis as typeof globalThis & { __noonBrowser?: NoonBrowser; __noonBrowserExitHook?: boolean };

/**
 * One instance per process, kept on globalThis so Next dev HMR (which re-evaluates this
 * module) reuses the session instead of losing track of the running Chrome.
 */
export function sharedNoonBrowser(): NoonBrowser {
  g.__noonBrowser ??= createNoonBrowser({ launch: launchChrome });
  if (!g.__noonBrowserExitHook) {
    g.__noonBrowserExitHook = true;
    process.once("exit", () => g.__noonBrowser?.killNow());
  }
  return g.__noonBrowser;
}

/** Run `fn` with the shared noon Chrome page; jobs are serialized. */
export function withNoonPage<T>(fn: (page: Page) => Promise<T>): Promise<T> {
  return sharedNoonBrowser().withPage(fn);
}

export function closeNoonBrowser(): Promise<void> {
  return sharedNoonBrowser().close();
}
