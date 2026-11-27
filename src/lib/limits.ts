import "server-only";

/**
 * Owner ruling: safety caps. The app is public and has no login; these small caps protect the
 * owner's server, Telegram bot and stores. Normal personal use never reaches them. All in memory:
 * a restart clears them.
 */

/** Saved price watches, at most. */
export const MAX_WATCHES = 100;
/** Telegram test messages: one per this window. */
export const TELEGRAM_TEST_WINDOW_MS = 60_000;
/** A watch re-armed through PATCH (a new target): once per watch per this window. */
export const REARM_WINDOW_MS = 60_000;

export type WindowLimiter = {
  /** True (and the window starts) when `key` is free; false inside its window. */
  take(key: string, now?: number): boolean;
  /** Frees `key` again (the action did not happen after all). */
  release(key: string): void;
  clear(): void;
};

/** One action per key per `ms`. Entries past their window are dropped, so the map stays small. */
export function windowLimiter(ms: number): WindowLimiter {
  const last = new Map<string, number>();
  return {
    take(key, now = Date.now()) {
      const t = last.get(key);
      if (t !== undefined && now - t < ms) return false;
      if (last.size >= 1000) for (const [k, at] of last) if (now - at >= ms) last.delete(k);
      last.set(key, now);
      return true;
    },
    release(key) {
      last.delete(key);
    },
    clear() {
      last.clear();
    },
  };
}

const g = globalThis as unknown as { __dealSearchLimits?: { telegramTest: WindowLimiter; rearm: WindowLimiter } };
/** Shared across route modules and hot reloads. */
export const limiters = (g.__dealSearchLimits ??= {
  telegramTest: windowLimiter(TELEGRAM_TEST_WINDOW_MS),
  rearm: windowLimiter(REARM_WINDOW_MS),
});
