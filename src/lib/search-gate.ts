import "server-only";

/**
 * Owner ruling: safety caps. At most MAX_RUNNING searches run at once (the HTTP searches and the
 * alert checker's share these lanes); up to MAX_WAITING HTTP searches wait for a lane, first come
 * first served. Past that an HTTP search is refused (the routes answer 503 BUSY with Retry-After).
 * A checker search is never refused: it waits in the same line, so it is never starved.
 */
export const MAX_RUNNING = 4;
export const MAX_WAITING = 8;
export const BUSY = { error: "Busy, try again in a moment" } as const;
export const RETRY_AFTER_S = 5;

export type Release = () => void;
type Waiter = { kind: "user" | "checker"; grant: (r: Release) => void };

export type SearchGate = {
  /**
   * A lane: the release function once one is free, or null at once when the line is full (user
   * searches only). `signal`: a user who left while waiting gives up the place (resolves null).
   */
  acquire(kind: "user" | "checker", signal?: AbortSignal): Promise<Release | null>;
  readonly running: number;
  readonly waiting: number;
};

export function createSearchGate(maxRunning = MAX_RUNNING, maxWaiting = MAX_WAITING): SearchGate {
  let running = 0;
  const line: Waiter[] = [];

  const releaser = (): Release => {
    let done = false;
    return () => {
      if (done) return;
      done = true;
      const next = line.shift();
      if (next) next.grant(releaser()); // the lane passes straight on: running stays the same
      else running -= 1;
    };
  };

  return {
    acquire(kind, signal) {
      if (signal?.aborted) return Promise.resolve(null);
      if (running < maxRunning) {
        running += 1;
        return Promise.resolve(releaser());
      }
      if (kind === "user" && line.filter((w) => w.kind === "user").length >= maxWaiting) return Promise.resolve(null);
      return new Promise((resolve) => {
        const w: Waiter = {
          kind,
          grant: (r) => {
            signal?.removeEventListener("abort", onAbort);
            resolve(r);
          },
        };
        const onAbort = () => {
          const i = line.indexOf(w);
          if (i >= 0) line.splice(i, 1);
          resolve(null);
        };
        signal?.addEventListener("abort", onAbort, { once: true });
        line.push(w);
      });
    },
    get running() {
      return running;
    },
    get waiting() {
      return line.length;
    },
  };
}

const g = globalThis as unknown as { __dealSearchGate?: SearchGate };
/** The app's one gate, shared by the search routes and the alert checker. */
export const searchGate = (): SearchGate => (g.__dealSearchGate ??= createSearchGate());

/** The 503 an HTTP search gets when the line is full. */
export const busyResponse = () =>
  Response.json(BUSY, { status: 503, headers: { "retry-after": String(RETRY_AFTER_S), "cache-control": "no-store" } });
