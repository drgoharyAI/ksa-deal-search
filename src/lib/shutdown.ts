/**
 * Graceful stop on SIGTERM/SIGINT (docker compose stop: 30 s grace period). Steps without `after`
 * run in parallel (the store Chrome browsers, the alerts timer); `after` steps run once those are
 * done (the database). Each step gets `timeoutMs`; a step that does not finish in time is
 * hard-stopped with its `kill`. A failing step never blocks the others. Runs once, then exits 0.
 */
export type ShutdownStep = { name: string; close: () => Promise<void> | void; kill?: () => void; after?: boolean };

export function createShutdown(opts: {
  steps: ShutdownStep[];
  timeoutMs?: number;
  exit?: (code: number) => void;
  log?: (msg: string) => void;
}): (signal: string) => Promise<void> {
  const timeoutMs = opts.timeoutMs ?? 20_000;
  const exit = opts.exit ?? ((code: number) => process.exit(code));
  const log = opts.log ?? ((m: string) => console.log(m));
  let running: Promise<void> | null = null;

  async function runStep(step: ShutdownStep): Promise<void> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timedOut = new Promise<"timeout">((resolve) => {
      timer = setTimeout(() => resolve("timeout"), timeoutMs);
    });
    try {
      const r = await Promise.race([Promise.resolve().then(step.close).then(() => "done" as const), timedOut]);
      if (r === "timeout") {
        log(`[shutdown] ${step.name}: did not stop within ${timeoutMs} ms, killing`);
        step.kill?.();
      }
    } catch (e) {
      log(`[shutdown] ${step.name}: ${e instanceof Error ? e.message : String(e)}`);
      try {
        step.kill?.();
      } catch {
        // best effort
      }
    } finally {
      clearTimeout(timer);
    }
  }

  return (signal) => {
    running ??= (async () => {
      log(`[shutdown] ${signal}: closing`);
      await Promise.all(opts.steps.filter((s) => !s.after).map(runStep));
      for (const s of opts.steps.filter((x) => x.after)) await runStep(s);
      log("[shutdown] done");
      exit(0);
    })();
    return running;
  };
}
