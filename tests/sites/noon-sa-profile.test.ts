import { describe, it, expect, vi, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { chooseProfileDir, resolveProfileDir } from "@/src/sites/noon-sa/profile";
import { createChromeLauncher } from "@/src/sites/noon-sa/browser";

describe("resolveProfileDir", () => {
  it("prefers NOON_PROFILE_DIR", () => {
    expect(resolveProfileDir({ NOON_PROFILE_DIR: "/x/p", LOCALAPPDATA: "/la" }, "/h")).toBe(path.resolve("/x/p"));
  });
  it("uses LOCALAPPDATA", () => {
    expect(resolveProfileDir({ LOCALAPPDATA: "/la" }, "/h")).toBe(path.join("/la", "deal-search", "noon-profile"));
  });
  it("falls back to the home directory", () => {
    expect(resolveProfileDir({}, "/h")).toBe(path.join("/h", ".deal-search", "noon-profile"));
  });
});

describe("chooseProfileDir", () => {
  const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "noon-prof-"));
  const mk = () => {
    const root = tmp();
    const legacy = path.join(root, "old");
    fs.mkdirSync(path.join(legacy, "Default"), { recursive: true });
    fs.writeFileSync(path.join(legacy, "Default", "f"), "1");
    return { root, legacy, target: path.join(root, "a", "new"), logs: [] as string[] };
  };

  it("moves the old profile when the new one is absent", () => {
    const { legacy, target, logs } = mk();
    expect(chooseProfileDir(target, legacy, (m) => logs.push(m))).toBe(target);
    expect(fs.existsSync(path.join(target, "Default", "f"))).toBe(true);
    expect(fs.existsSync(legacy)).toBe(false);
    expect(logs).toEqual([]);
  });
  it("uses the target when there is no old profile", () => {
    const root = tmp();
    const target = path.join(root, "new");
    expect(chooseProfileDir(target, path.join(root, "none"), () => {})).toBe(target);
    expect(fs.existsSync(target)).toBe(false);
  });
  it("uses the old dir this run when the rename fails (locked)", () => {
    const { legacy, target, logs } = mk();
    const io = { exists: (p: string) => fs.existsSync(p), mkdir: () => {}, rename: () => { throw Object.assign(new Error("EBUSY"), { code: "EBUSY" }); } };
    expect(chooseProfileDir(target, legacy, (m) => logs.push(m), io)).toBe(legacy);
    expect(logs[0]).toMatch(/using .*old this run, will retry next start/);
    expect(fs.existsSync(legacy)).toBe(true);
  });
  it("uses the old dir on a cross-drive move (EXDEV) and says so", () => {
    const { legacy, target, logs } = mk();
    const io = { exists: (p: string) => fs.existsSync(p), mkdir: () => {}, rename: () => { throw Object.assign(new Error("x"), { code: "EXDEV" }); } };
    expect(chooseProfileDir(target, legacy, (m) => logs.push(m), io)).toBe(legacy);
    expect(logs[0]).toMatch(/cross-drive move not supported; using /);
  });
  it("uses the old dir when the target exists but is fresh (no Default)", () => {
    const { legacy, target, logs } = mk();
    fs.mkdirSync(target, { recursive: true });
    expect(chooseProfileDir(target, legacy, (m) => logs.push(m))).toBe(legacy);
    expect(logs[0]).toMatch(/will retry next start/);
  });
  it("keeps a target that has profile data and leaves the old dir untouched", () => {
    const { legacy, target, logs } = mk();
    fs.mkdirSync(path.join(target, "Default"), { recursive: true });
    expect(chooseProfileDir(target, legacy, (m) => logs.push(m))).toBe(target);
    expect(fs.existsSync(path.join(legacy, "Default", "f"))).toBe(true);
    expect(logs[0]).toMatch(/left untouched/);
  });
});

describe("browser.ts side effects", () => {
  afterEach(() => vi.restoreAllMocks());

  it("importing it performs no fs calls", async () => {
    const spies = (["existsSync", "mkdirSync", "renameSync", "readFileSync", "rmSync", "statSync", "readdirSync"] as const).map((k) =>
      vi.spyOn(fs, k),
    );
    vi.resetModules();
    await import("@/src/sites/noon-sa/browser");
    for (const s of spies) expect(s).not.toHaveBeenCalled();
  });

  it("adopts a Chrome whose DevToolsActivePort is in the chosen profile dir", async () => {
    const dir = "C:/legacy/.noon-profile";
    const read = vi.fn((d: string) => (d === dir ? 9222 : null));
    const spawned: string[][] = [];
    const page = { on: () => {}, isClosed: () => false, close: async () => {} };
    const launch = createChromeLauncher({
      profileDir: dir,
      readActivePort: read,
      probe: async () => true,
      userDataDir: async () => dir, // adoption proves the profile (src/sites/chrome/cdp.ts)
      spawnChrome: (_p, a) => (spawned.push(a), { exitCode: null, kill: () => true }),
      connect: async () =>
        ({ contexts: () => [{ pages: () => [page], newPage: async () => page }], newContext: async () => ({}), on: () => {}, newBrowserCDPSession: async () => ({ send: async () => {} }), close: async () => {}, isConnected: () => true }) as never,
    });
    await launch().catch(() => {});
    expect(read).toHaveBeenCalledWith(dir);
    expect(spawned).toEqual([]);
  });
});
