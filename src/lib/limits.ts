import "server-only";

/**
 * Owner ruling: safety caps. The app is public and has no login; these small caps protect the
 * owner's server, Telegram bot and stores. Normal personal use never reaches them. All in memory:
 * a restart clears them.
 */

/** Saved price watches, at most. */
export const MAX_WATCHES = 100;
/** Telegram test messages: one per this window. */
const TELEGRAM_TEST_WINDOW_MS = 60_000;
/** A watch re-armed (a new target, or POST on an existing watch): REARM_MAX times per watch per this window. */
const REARM_WINDOW_MS = 60_000;
const REARM_MAX = 5;

export type WindowLimiter = {
  /** True when `key` has used fewer than its `max` actions in the window. */
  allowed(key: string, now?: number): boolean;
  /** Counts one action for `key` (after it happened). */
  record(key: string, now?: number): void;
  /** allowed, then record: for an action that must be held before it starts (a Telegram send). */
  take(key: string, now?: number): boolean;
  /** Frees the latest action of `key` (it did not happen after all). */
  release(key: string): void;
  clear(): void;
};

/** At most `max` actions per key per `ms`. Old entries are dropped, so the map stays small. */
function windowLimiter(ms: number, max = 1): WindowLimiter {
  const hits = new Map<string, number[]>();
  const recent = (key: string, now: number) => (hits.get(key) ?? []).filter((t) => now - t < ms);
  const api: WindowLimiter = {
    allowed(key, now = Date.now()) {
      return recent(key, now).length < max;
    },
    record(key, now = Date.now()) {
      if (hits.size >= 1000) for (const k of [...hits.keys()]) if (!recent(k, now).length) hits.delete(k);
      hits.set(key, [...recent(key, now), now]);
    },
    take(key, now = Date.now()) {
      if (!api.allowed(key, now)) return false;
      api.record(key, now);
      return true;
    },
    release(key) {
      const list = hits.get(key);
      if (list?.length) list.pop();
    },
    clear() {
      hits.clear();
    },
  };
  return api;
}

const g = globalThis as unknown as { __dealSearchLimits?: { telegramTest: WindowLimiter; rearm: WindowLimiter } };
/** Shared across route modules and hot reloads. */
export const limiters = (g.__dealSearchLimits ??= {
  telegramTest: windowLimiter(TELEGRAM_TEST_WINDOW_MS),
  rearm: windowLimiter(REARM_WINDOW_MS, REARM_MAX),
});
