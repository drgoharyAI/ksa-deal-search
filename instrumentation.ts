/**
 * Starts the price-alert checker when the server starts (Node runtime only; never in the Edge
 * runtime or during `next build`). API routes also start it lazily, so this is a convenience.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs" || process.env.NEXT_PHASE === "phase-production-build") return;
  const { installShutdownHooks } = await import("./src/lib/shutdown-hooks");
  installShutdownHooks(); // Docker only (NEXT_MANUAL_SIG_HANDLE): closes Chrome and the DB on SIGTERM
  const { ensureChecker } = await import("./src/lib/alerts/service");
  ensureChecker();
}
