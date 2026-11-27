import { describe, it, expect } from "vitest";
import { createCdpLauncher, type ChromeDeps, type OwnPortFile } from "@/src/sites/chrome/cdp";

function fakeBrowser(closed?: { n: number }) {
  const page = { isClosed: () => false };
  return {
    contexts: () => [{ pages: () => [page], newPage: async () => page }],
    newContext: async () => ({ pages: () => [page], newPage: async () => page }),
    on: () => {},
    newBrowserCDPSession: async () => ({ send: async () => {} }),
    close: async () => {
      if (closed) closed.n++;
    },
  };
}

type Opts = {
  own?: OwnPortFile | null;
  answers: (port: number) => boolean;
  alive?: (pid: number) => boolean;
  /** exit code the spawned Chrome reports right away (null = keeps running) */
  spawnExit?: number | null;
  onSpawn?: () => void;
  spawnDelay?: () => Promise<void>;
  /** user-data-dir the connected Chrome reports (default: this profile) */
  udd?: (port: number) => string | null;
};

function deps(o: Opts) {
  const log = {
    spawned: [] as string[][],
    connected: [] as number[],
    written: [] as OwnPortFile[],
    ownRemoved: 0,
    events: [] as string[],
    killed: [] as number[],
    sleeps: [] as number[],
    disconnects: { n: 0 },
  };
  let lastPort = 0;
  let own = o.own ?? null;
  const d: ChromeDeps = {
    profileDir: "C:/fake/profile",
    findChrome: () => "C:/fake/chrome.exe",
    readActivePort: () => null,
    removeActivePort: () => {},
    readOwnPortFile: () => own,
    writeOwnPortFile: (_dir, f) => {
      own = f;
      log.written.push(f);
    },
    removeOwnPortFile: () => {
      own = null;
      log.ownRemoved++;
    },
    pidAlive: (pid) => (o.alive ? o.alive(pid) : true),
    probe: async (port) => o.answers(port),
    freePort: async () => 51234,
    spawnChrome: (_p, args) => {
      log.spawned.push(args);
      log.events.push("spawn");
      o.onSpawn?.();
      return { pid: 999, exitCode: o.spawnExit ?? null, kill: () => true };
    },
    connect: async (port) => {
      log.connected.push(port);
      lastPort = port;
      if (o.spawnDelay) await o.spawnDelay();
      log.events.push("connected");
      return fakeBrowser(log.disconnects) as never;
    },
    userDataDir: async () => (o.udd ? o.udd(lastPort) : "C:/fake/profile"),
    killPid: (pid) => void log.killed.push(pid),
    sleep: async (ms) => void log.sleeps.push(ms),
  };
  return { d, log, setOwn: (f: OwnPortFile | null) => (own = f) };
}

const launcher = (d: ChromeDeps) => createCdpLauncher({ profileDir: () => d.profileDir, overrides: d });

describe("createCdpLauncher: own port file", () => {
  it("adopts from its own deal-search-port.json when the port answers and the pid is alive", async () => {
    const { d, log } = deps({ own: { port: 40001, pid: 77, startedAt: 1 }, answers: (p) => p === 40001 });
    await launcher(d)();
    expect(log.spawned).toEqual([]);
    expect(log.connected).toEqual([40001]);
  });

  it("stale file (probe fails) -> removed, spawns, file replaced with the new port and pid", async () => {
    const { d, log } = deps({ own: { port: 40001, pid: 77, startedAt: 1 }, answers: (p) => p === 51234 });
    await launcher(d)();
    expect(log.ownRemoved).toBeGreaterThanOrEqual(1);
    expect(log.spawned).toHaveLength(1);
    expect(log.written).toEqual([expect.objectContaining({ port: 51234, pid: 999 })]);
    expect(log.connected).toEqual([51234]);
  });

  it("pid dead -> spawns even if something answers on the old port", async () => {
    const { d, log } = deps({ own: { port: 40001, pid: 77, startedAt: 1 }, answers: () => true, alive: () => false });
    await launcher(d)();
    expect(log.spawned).toHaveLength(1);
    expect(log.connected).toEqual([51234]);
  });

  it("spawned Chrome exits 0 (handed off to a running one) -> re-checks once and adopts it", async () => {
    const h = deps({ answers: (p) => p === 40002, spawnExit: 0 });
    // The orphan that took the hand-off becomes visible only after our spawn.
    h.d.spawnChrome = (_p, args) => {
      h.log.spawned.push(args);
      h.setOwn({ port: 40002, pid: 55, startedAt: 2 });
      return { pid: 999, exitCode: 0, kill: () => true };
    };
    await launcher(h.d)();
    expect(h.log.connected).toEqual([40002]);
  });

  it("spawned Chrome exits 0 and nothing answers -> throws", async () => {
    const { d } = deps({ answers: () => false, spawnExit: 0 });
    await expect(launcher(d)()).rejects.toThrow(/exited early \(code 0\)/);
  });

  it("close() asks Chrome to quit and deletes the port file; kill() too", async () => {
    const a = deps({ answers: (p) => p === 51234 });
    const s = await launcher(a.d)();
    await s.close();
    expect(a.log.ownRemoved).toBeGreaterThanOrEqual(1);
    const b = deps({ answers: (p) => p === 51234 });
    const s2 = await launcher(b.d)();
    const before = b.log.ownRemoved;
    s2.kill?.();
    expect(b.log.ownRemoved).toBe(before + 1);
  });
});

describe("createCdpLauncher: adoption proves the Chrome is ours", () => {
  it("wrong user-data-dir -> not adopted (disconnected, record deleted), spawns, kills nothing", async () => {
    const { d, log } = deps({
      own: { port: 40001, pid: 77, startedAt: 1 },
      answers: () => true,
      udd: (port) => (port === 40001 ? "C:/someone/else" : "C:/fake/profile"),
    });
    const s = await launcher(d)();
    expect(log.connected).toEqual([40001, 51234]);
    expect(log.disconnects.n).toBe(1);
    expect(log.ownRemoved).toBeGreaterThanOrEqual(1);
    expect(log.spawned).toHaveLength(1);
    expect(log.killed).toEqual([]);
    s.kill?.();
    expect(log.killed).toEqual([]); // our own child is stopped through its handle, not by pid
  });

  it("unreadable user-data-dir -> not adopted", async () => {
    const { d, log } = deps({
      own: { port: 40001, pid: 77, startedAt: 1 },
      answers: () => true,
      udd: (p) => (p === 40001 ? null : "C:/fake/profile"),
    });
    await launcher(d)();
    expect(log.spawned).toHaveLength(1);
    expect(log.killed).toEqual([]);
  });

  it("matching user-data-dir (case and slashes differ) -> adopted; kill() stops that pid via the dep", async () => {
    const { d, log } = deps({
      own: { port: 40001, pid: 77, startedAt: 1 },
      answers: (p) => p === 40001,
      udd: () => (process.platform === "win32" ? "c:\\FAKE\\profile\\" : "C:/fake/profile/"),
    });
    const s = await launcher(d)();
    expect(log.spawned).toEqual([]);
    expect(log.connected).toEqual([40001]);
    s.kill?.();
    expect(log.killed).toEqual([77]);
  });

  it("DevToolsActivePort adoption (no pid) never kills by pid", async () => {
    const { d, log } = deps({ answers: (p) => p === 40005 });
    d.readActivePort = () => 40005;
    const s = await launcher(d)();
    expect(log.connected).toEqual([40005]);
    s.kill?.();
    expect(log.killed).toEqual([]);
  });
});

describe("createCdpLauncher: re-probing", () => {
  it("pid alive but probe failed -> waits 2 s and probes once more before deleting the record", async () => {
    let probes = 0;
    const { d, log } = deps({ own: { port: 40001, pid: 77, startedAt: 1 }, answers: () => false });
    d.probe = async (port) => port === 40001 && ++probes >= 2;
    await launcher(d)();
    expect(log.sleeps).toContain(2_000);
    expect(log.spawned).toEqual([]);
    expect(log.ownRemoved).toBe(0);
    expect(log.connected).toEqual([40001]);
  });

  it("early exit 0 -> re-probes the remembered port (record already deleted) and adopts it", async () => {
    let up = false;
    const h = deps({
      own: { port: 40001, pid: 77, startedAt: 1 },
      answers: (p) => up && p === 40001,
      spawnExit: 0,
      onSpawn: () => (up = true),
    });
    await launcher(h.d)();
    expect(h.log.ownRemoved).toBeGreaterThanOrEqual(1);
    expect(h.log.spawned).toHaveLength(1);
    expect(h.log.connected).toEqual([40001]);
  });

  it("early exit 0, remembered port answers but is another profile -> throws, kills nothing", async () => {
    let up = false;
    const h = deps({
      own: { port: 40001, pid: 77, startedAt: 1 },
      answers: (p) => up && p === 40001,
      spawnExit: 0,
      onSpawn: () => (up = true),
      udd: () => "C:/other",
    });
    await expect(launcher(h.d)()).rejects.toThrow(/exited early \(code 0\)/);
    expect(h.log.killed).toEqual([]);
  });
});

describe("createCdpLauncher: launch lock", () => {
  it("is shared on globalThis and released after a throwing launch", async () => {
    expect((globalThis as { __dealSearchLaunchLock?: unknown }).__dealSearchLaunchLock).toBeDefined();
    const bad = deps({ answers: () => false });
    bad.d.findChrome = () => null;
    await expect(launcher(bad.d)()).rejects.toThrow("Chrome not found");
    const good = deps({ answers: (p) => p === 51234 });
    await expect(launcher(good.d)()).resolves.toBeTruthy();
  });
});

describe("createCdpLauncher: launches are serialized", () => {
  it("two stores launching at once never interleave (no shared free-port race)", async () => {
    const events: string[] = [];
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const a = deps({ answers: () => true, spawnDelay: () => gate });
    const b = deps({ answers: () => true });
    a.d.profileDir = "C:/fake/a";
    b.d.profileDir = "C:/fake/b";
    const wrap = (h: ReturnType<typeof deps>, tag: string) => {
      const spawn = h.d.spawnChrome;
      h.d.spawnChrome = (p, args) => {
        events.push(`${tag} spawn`);
        return spawn(p, args);
      };
      const connect = h.d.connect;
      h.d.connect = async (port) => {
        const br = await connect(port);
        events.push(`${tag} connected`);
        return br;
      };
      // Answers only after the spawn, so each launcher spawns.
      let spawned = false;
      const s2 = h.d.spawnChrome;
      h.d.spawnChrome = (p, args) => ((spawned = true), s2(p, args));
      h.d.probe = async () => spawned;
    };
    wrap(a, "a");
    wrap(b, "b");
    const pa = launcher(a.d)();
    const pb = launcher(b.d)();
    for (let i = 0; i < 10; i++) await new Promise((r) => setImmediate(r));
    expect(events).toEqual(["a spawn"]);
    release();
    await Promise.all([pa, pb]);
    expect(events).toEqual(["a spawn", "a connected", "b spawn", "b connected"]);
  });
});
