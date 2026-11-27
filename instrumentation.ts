/**
 * Starts the price-alert checker when the server starts (Node runtime only; never in the Edge
 * runtime or during `next build`). API routes also start it lazily, so this is a convenience.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs" || process.env.NEXT_PHASE === "phase-production-build") return;
  const { ensureChecker } = await import("./src/lib/alerts/service");
  ensureChecker();
}
