import { describe, it, expect, vi } from "vitest";
import type { ChromeDeps } from "@/src/sites/chrome/cdp";
import { createSheinLauncher } from "@/src/sites/shein-sa/browser";

function deps() {
  const spawned: string[][] = [];
  const page = { isClosed: () => false };
  const browser = {
    contexts: () => [{ pages: () => [page], newPage: async () => page }],
    newContext: async () => ({ pages: () => [page], newPage: async () => page }),
    on: () => {},
    newBrowserCDPSession: async () => ({ send: async () => {} }),
    close: async () => {},
  };
  let portFile: number | null = null;
  const d: Omit<ChromeDeps, "profileDir"> = {
    findChrome: () => "C:/fake/chrome.exe",
    readActivePort: () => portFile,
    removeActivePort: () => {
      portFile = null;
    },
    probe: async (port) => port === 52000,
    freePort: async () => 52000,
    spawnChrome: (_p, args) => {
      spawned.push(args);
      portFile = 52000;
      return { exitCode: null, kill: () => true };
    },
    connect: async () => browser as never,
    sleep: async () => {},
  };
  return { d, spawned };
}

describe("createSheinLauncher", () => {
  it("spawns its own Chrome on the SHEIN profile, fixed non-zero port, localhost, off-screen", async () => {
    const { d, spawned } = deps();
    await createSheinLauncher({ ...d, profileDir: "C:/la/deal-search/shein-profile" })();
    const args = spawned[0];
    expect(args).toContain("--user-data-dir=C:/la/deal-search/shein-profile");
    expect(args).toContain("--remote-debugging-port=52000");
    expect(args).not.toContain("--remote-debugging-port=0");
    expect(args).toContain("--remote-debugging-address=127.0.0.1");
    expect(args).toContain("--window-position=-32000,-32000");
  });

  it("resolves the profile lazily from SHEIN_PROFILE_DIR at launch time", async () => {
    const { d, spawned } = deps();
    vi.stubEnv("SHEIN_PROFILE_DIR", "C:/custom/shein");
    try {
      const launch = createSheinLauncher(d);
      await launch();
    } finally {
      vi.unstubAllEnvs();
    }
    expect(spawned[0].some((a) => a.startsWith("--user-data-dir=") && a.includes("custom") && a.endsWith("shein"))).toBe(true);
  });
});

describe("shared SHEIN browser", () => {
  it("is a globalThis singleton separate from noon's, surviving re-import (HMR)", async () => {
    const before = process.listenerCount("exit");
    vi.resetModules();
    const a = await import("@/src/sites/shein-sa/browser");
    vi.resetModules();
    const b = await import("@/src/sites/shein-sa/browser");
    const noon = await import("@/src/sites/noon-sa/browser");
    expect(a.sharedSheinBrowser()).toBe(b.sharedSheinBrowser());
    expect(a.sharedSheinBrowser()).not.toBe(noon.sharedNoonBrowser());
    expect(process.listenerCount("exit") - before).toBeLessThanOrEqual(2);
  });
});
