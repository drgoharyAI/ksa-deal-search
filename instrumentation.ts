/**
 * Starts the price-alert checker when the server starts (Node runtime only; never in the Edge
 * runtime or during `next build`). API routes also start it lazily, so this is a convenience.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs" || process.env.NEXT_PHASE === "phase-production-build") return;
  const { installShutdownHooks } = await import("./src/lib/shutdown-hooks");
  installShutdownHooks(); // Docker only (NEXT_MANUAL_SIG_HANDLE): closes Chrome and the DB on SIGTERM
  // Docker only: the Cloudflare tunnel's port (app:3000) is a relay that marks tunnel traffic.
  const relayPort = Number(process.env.TUNNEL_RELAY_PORT);
  const appPort = Number(process.env.PORT);
  if (Number.isInteger(relayPort) && relayPort > 0 && Number.isInteger(appPort) && appPort > 0 && relayPort !== appPort) {
    const { startTunnelRelay } = await import("./src/lib/tunnel-relay");
    startTunnelRelay(relayPort, appPort);
  }
  const { ensureChecker } = await import("./src/lib/alerts/service");
  ensureChecker();
  // The spelling vocabulary and its English word list (0.2 s to read), off the first search's path.
  const { installDbVocab } = await import("./src/lib/vocab-db");
  installDbVocab();
  setTimeout(() => {
    void import("./src/lib/query/vocab").then((m) => m.currentSpeller());
  }, 0);
}
