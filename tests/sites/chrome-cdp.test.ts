import { describe, it, expect } from "vitest";
import { createCdpLauncher, type ChromeDeps, type OwnPortFile } from "@/src/sites/chrome/cdp";

function fakeBrowser() {
  const page = { isClosed: () => false };
  return {
    contexts: () => [{ pages: () => [page], newPage: async () => page }],
    newContext: async () => ({ pages: () => [page], newPage: async () => page }),
    on: () => {},
    newBrowserCDPSession: async () => ({ send: async () => {} }),
    close: async () => {},
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
};

function deps(o: Opts) {
  const log = {
    spawned: [] as string[][],
    connected: [] as number[],
    written: [] as OwnPortFile[],
    ownRemoved: 0,
    events: [] as string[],
  };
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
      if (o.spawnDelay) await o.spawnDelay();
      log.events.push("connected");
      return fakeBrowser() as never;
    },
    sleep: async () => {},
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
