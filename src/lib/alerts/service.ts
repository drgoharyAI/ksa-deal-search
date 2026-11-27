import "server-only";
import { getDb } from "@/src/lib/db";
import { runSearch } from "@/src/lib/pipeline";
import { searchGate } from "@/src/lib/search-gate";
import { formatAlertMessage, sendTelegram } from "@/src/lib/telegram";
import { createChecker, type Checker } from "./checker";

/** The app's one checker, kept on globalThis so hot reloads and route modules share it. */
const g = globalThis as unknown as { __dealSearchChecker?: Checker };

const DEFAULT_HOURS = 6;

export function checkIntervalMs(env: Record<string, string | undefined> = process.env): number {
  const h = Number(env.ALERT_CHECK_HOURS);
  const hours = Number.isFinite(h) && h > 0 ? Math.max(h, 0.25) : DEFAULT_HOURS;
  return hours * 3_600_000;
}

/**
 * Between store fetches: 20 s, and at least 60 s before a Chrome-backed store (noon, SHEIN: a real
 * browser page per search); sleep adds up to 50% jitter. SHEIN's risk control also caps it at 8
 * searches per cycle; the rest wait for the next cycle, oldest checked first.
 */
const STAGGER_MS = 20_000;
export const CHROME_GAP_MS = 60_000;
const CHROME_SITES = new Set(["noon-sa", "shein-sa"]);
export const SITE_CAPS: Record<string, number> = { "shein-sa": 8 };
export const gapFor = (site: string): number => (CHROME_SITES.has(site) ? CHROME_GAP_MS : STAGGER_MS);
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms + Math.random() * ms * 0.5));

export function getChecker(): Checker {
  if (!g.__dealSearchChecker) {
    g.__dealSearchChecker = createChecker(
      () => ({
        db: getDb(),
        // The same lanes as the HTTP searches; a checker search waits, never refused.
        search: async (input, opts) => {
          const release = await searchGate().acquire("checker");
          try {
            return await runSearch(input, opts);
          } finally {
            release?.();
          }
        },
        now: Date.now,
        sleep,
        staggerMs: STAGGER_MS,
        gapMs: gapFor,
        siteCaps: SITE_CAPS,
        notify: (m) => sendTelegram(formatAlertMessage(m)),
      }),
      { intervalMs: checkIntervalMs(), firstDelayMs: 60_000 },
    );
  }
  return g.__dealSearchChecker;
}

/** Starts the timer once (first API hit or instrumentation). Never in tests or during a build. */
export function ensureChecker(): void {
  if (process.env.NODE_ENV === "test" || process.env.NEXT_PHASE === "phase-production-build") return;
  try {
    getChecker().start();
  } catch (e) {
    console.warn("[alerts] checker did not start", e instanceof Error ? e.message : String(e));
  }
}
