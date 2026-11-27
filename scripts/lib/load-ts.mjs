// Loads src/eval/node-entry.ts (TypeScript, "@/..." aliases) in plain Node via a Vite module runner.
// The runner stays open for the whole script so lazy imports (playwright-core for noon) work.
import { createServer, createServerModuleRunner } from "vite";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

export async function loadEval() {
  process.chdir(root); // api-anything home (./.aa-home) is relative to the repo
  const server = await createServer({
    root,
    configFile: false,
    logLevel: "error",
    appType: "custom",
    server: { middlewareMode: true, hmr: false, ws: false, watch: null },
    resolve: { alias: { "@": root, "server-only": path.join(root, "tests/stubs-server-only.ts") } },
  });
  const runner = createServerModuleRunner(server.environments.ssr, { hmr: false });
  const mod = await runner.import(path.join(root, "src/eval/node-entry.ts"));
  return { ...mod, close: () => Promise.all([runner.close(), server.close()]) };
}
