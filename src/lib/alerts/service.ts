import "server-only";
import { getDb } from "@/src/lib/db";
import { runSearch } from "@/src/lib/pipeline";
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

/** Between store fetches: 20 s plus up to 50% jitter, so a cycle never bursts one store. */
const STAGGER_MS = 20_000;
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms + Math.random() * ms * 0.5));

export function getChecker(): Checker {
  if (!g.__dealSearchChecker) {
    g.__dealSearchChecker = createChecker(
      () => ({
        db: getDb(),
        search: (input) => runSearch(input),
        now: Date.now,
        sleep,
        staggerMs: STAGGER_MS,
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
