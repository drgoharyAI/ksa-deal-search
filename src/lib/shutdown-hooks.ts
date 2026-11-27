import "server-only";
import { createShutdown, type ShutdownStep } from "./shutdown";

/**
 * Production signal handling (Docker). Installed only when NEXT_MANUAL_SIG_HANDLE is set (the
 * Docker image sets it), which turns off Next's own SIGTERM/SIGINT handler: that one exits as soon
 * as the HTTP server closes, before Chrome can quit cleanly and flush its profile. Here noon's and
 * SHEIN's Chrome get Browser.close (hard kill after 20 s), the alerts timer stops, then the SQLite
 * handle closes (WAL checkpoint). The existing process "exit" hooks still kill Chrome as a backstop.
 */
type G = typeof globalThis & {
  __dealSearchShutdownHook?: boolean;
  __noonBrowser?: { close(): Promise<void>; killNow(): void };
  __sheinBrowser?: { close(): Promise<void>; killNow(): void };
  __dealSearchChecker?: { stop(): void };
  __dealSearchDb?: { close(): void };
};

export function installShutdownHooks(): void {
  const g = globalThis as G;
  if (!process.env.NEXT_MANUAL_SIG_HANDLE || g.__dealSearchShutdownHook) return;
  g.__dealSearchShutdownHook = true;
  const browser = (name: string, get: () => G["__noonBrowser"]): ShutdownStep => ({
    name,
    close: () => get()?.close(),
    kill: () => get()?.killNow(),
  });
  const run = createShutdown({
    steps: [
      browser("noon Chrome", () => g.__noonBrowser),
      browser("SHEIN Chrome", () => g.__sheinBrowser),
      { name: "alerts checker", close: () => g.__dealSearchChecker?.stop() },
      {
        name: "database",
        after: true,
        close: () => {
          const db = g.__dealSearchDb;
          g.__dealSearchDb = undefined;
          db?.close();
        },
      },
    ],
    timeoutMs: 20_000,
  });
  for (const sig of ["SIGTERM", "SIGINT"] as const) process.on(sig, () => void run(sig));
}
