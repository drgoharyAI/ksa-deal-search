import "server-only";
import { spawn } from "node:child_process";
import net from "node:net";
import fs from "node:fs";
import path from "node:path";
import type { Browser, Page } from "playwright-core";

/**
 * The owner's installed Google Chrome, started by us with normal flags plus a localhost-only
 * debug port, then attached with Playwright `connectOverCDP`. Shared by every store that needs a
 * real browser (noon, SHEIN). Each store gets its OWN Chrome process on its OWN profile directory,
 * so cookies, risk scores and crashes never cross stores.
 * See docs/superpowers/spikes/2026-11-27-noon-sa.md and 2026-11-27-shein-sa.md.
 */

export type ChromeSession = {
  page: Page;
  /** False once Chrome exited or the page closed; the next job then relaunches. */
  isAlive(): boolean;
  close(): Promise<void>;
  /** Synchronous hard stop, used on process exit where async work cannot finish. */
  kill?(): void;
};

export type Launcher = () => Promise<ChromeSession>;

export const IDLE_CLOSE_MS = 10 * 60_000;

/**
 * One browser: launched lazily on first use, jobs run one at a time (FIFO),
 * closed after `idleMs` without jobs. A throwing job rejects only its own caller.
 */
export function createBrowserQueue(opts: { launch: Launcher; idleMs?: number }) {
  const idleMs = opts.idleMs ?? IDLE_CLOSE_MS;
  let session: ChromeSession | null = null;
  let tail: Promise<unknown> = Promise.resolve();
  let pending = 0;
  let idleTimer: ReturnType<typeof setTimeout> | null = null;

  function clearIdle() {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = null;
  }

  async function closeSession() {
    const s = session;
    session = null;
    if (s) await s.close().catch(() => {});
  }

  function armIdle() {
    clearIdle();
    idleTimer = setTimeout(() => {
      idleTimer = null;
      // Queue the close so it never races a job that started meanwhile.
      if (pending === 0) void enqueue(() => closeSession()).catch(() => {});
    }, idleMs);
    idleTimer.unref?.();
  }

  function enqueue<T>(job: () => Promise<T>): Promise<T> {
    const run = tail.then(job);
    tail = run.catch(() => {});
    return run;
  }

  function withPage<T>(fn: (page: Page) => Promise<T>): Promise<T> {
    pending++;
    clearIdle();
    return enqueue(async () => {
      if (session && !session.isAlive()) await closeSession();
      if (!session) session = await opts.launch();
      return fn(session.page);
    }).finally(() => {
      if (--pending === 0) armIdle();
    });
  }

  async function close() {
    clearIdle();
    await enqueue(() => closeSession());
  }

  /** Synchronous best-effort shutdown for process exit. */
  function killNow() {
    clearIdle();
    const s = session;
    session = null;
    if (s?.kill) s.kill();
    else if (s) void s.close().catch(() => {});
  }

  return { withPage, close, killNow };
}

export type BrowserQueue = ReturnType<typeof createBrowserQueue>;

// ---------------- real Chrome launcher ----------------

function chromeCandidates(): string[] {
  const env = process.env;
  const rel = path.join("Google", "Chrome", "Application", "chrome.exe");
  return [env.ProgramFiles, env["ProgramFiles(x86)"], env.LocalAppData ?? env.LOCALAPPDATA]
    .filter((d): d is string => !!d)
    .map((d) => path.join(d, rel));
}

export function findChrome(): string | null {
  for (const p of chromeCandidates()) if (fs.existsSync(p)) return p;
  return null;
}

type ChromeProc = { pid?: number; exitCode: number | null; kill(): boolean };

/** `<profile>/deal-search-port.json`: written by us once a spawned Chrome's debug port answers. */
export type OwnPortFile = { port: number; pid: number; startedAt: number };

/** Side effects of the launcher, injectable so tests never spawn Chrome or touch the network. */
export type ChromeDeps = {
  profileDir: string;
  findChrome(): string | null;
  /** Port from `<profile>/DevToolsActivePort` (written by Chrome), or null. */
  readActivePort(profileDir: string): number | null;
  removeActivePort(profileDir: string): void;
  /**
   * Our own record of the Chrome on this profile. Chrome does not write DevToolsActivePort when it
   * is started with a fixed --remote-debugging-port, so this file is what lets a restarted node
   * process adopt an orphan Chrome instead of spawning a second one (which hands off and exits).
   */
  readOwnPortFile?(profileDir: string): OwnPortFile | null;
  writeOwnPortFile?(profileDir: string, f: OwnPortFile): void;
  removeOwnPortFile?(profileDir: string): void;
  /** True if a process with this pid exists. */
  pidAlive?(pid: number): boolean;
  /** A currently free TCP port on 127.0.0.1 for Chrome's debug endpoint. */
  freePort(): Promise<number>;
  /** True if `http://127.0.0.1:<port>/json/version` answers. */
  probe(port: number): Promise<boolean>;
  spawnChrome(chromePath: string, args: string[]): ChromeProc;
  connect(port: number): Promise<Browser>;
  sleep(ms: number): Promise<void>;
};

type Deps = Required<ChromeDeps>;

const portFile = (profileDir: string) => path.join(profileDir, "DevToolsActivePort");
const ownPortFile = (profileDir: string) => path.join(profileDir, "deal-search-port.json");
const validPort = (n: unknown): n is number => Number.isInteger(n) && (n as number) > 0 && (n as number) < 65536;

const realDeps: Omit<Deps, "profileDir"> = {
  findChrome,
  readActivePort(profileDir) {
    try {
      // First line of DevToolsActivePort is the port; parseInt stops at the line break.
      const port = parseInt(fs.readFileSync(portFile(profileDir), "utf8"), 10);
      return validPort(port) ? port : null;
    } catch {
      return null;
    }
  },
  removeActivePort(profileDir) {
    fs.rmSync(portFile(profileDir), { force: true });
  },
  readOwnPortFile(profileDir) {
    try {
      const f = JSON.parse(fs.readFileSync(ownPortFile(profileDir), "utf8")) as Partial<OwnPortFile>;
      const pid = f.pid;
      return validPort(f.port) && typeof pid === "number" && Number.isInteger(pid) && pid > 0
        ? { port: f.port, pid, startedAt: Number(f.startedAt) || 0 }
        : null;
    } catch {
      return null;
    }
  },
  writeOwnPortFile(profileDir, f) {
    try {
      fs.writeFileSync(ownPortFile(profileDir), JSON.stringify(f));
    } catch {
      // best effort: without it a later run spawns instead of adopting
    }
  },
  removeOwnPortFile(profileDir) {
    try {
      fs.rmSync(ownPortFile(profileDir), { force: true });
    } catch {
      // best effort
    }
  },
  pidAlive(pid) {
    try {
      process.kill(pid, 0);
      return true;
    } catch (e) {
      // EPERM: the process exists but belongs to another user.
      return (e as NodeJS.ErrnoException).code === "EPERM";
    }
  },
  freePort() {
    return new Promise((resolve, reject) => {
      const srv = net.createServer();
      srv.unref();
      srv.on("error", reject);
      srv.listen(0, "127.0.0.1", () => {
        const addr = srv.address();
        const port = typeof addr === "object" && addr ? addr.port : 0;
        srv.close(() => (port ? resolve(port) : reject(new Error("no free port"))));
      });
    });
  },
  async probe(port) {
    try {
      const r = await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(1000) });
      return r.ok;
    } catch {
      return false;
    }
  },
  spawnChrome(chromePath, args) {
    const proc = spawn(chromePath, args, { stdio: "ignore" });
    proc.on("error", () => {});
    return proc;
  },
  async connect(port) {
    const { chromium } = await import("playwright-core");
    return chromium.connectOverCDP(`http://127.0.0.1:${port}`);
  },
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
};

type Existing = { port: number; pid: number | null };

/**
 * A Chrome already running on this profile: our own port file first (the port answers AND the pid
 * is alive), then Chrome's DevToolsActivePort. A stale own file is deleted.
 */
async function existingChrome(d: Deps): Promise<Existing | null> {
  const own = d.readOwnPortFile(d.profileDir);
  if (own) {
    if (d.pidAlive(own.pid) && (await d.probe(own.port))) return { port: own.port, pid: own.pid };
    d.removeOwnPortFile(d.profileDir);
  }
  const port = d.readActivePort(d.profileDir);
  return port !== null && (await d.probe(port)) ? { port, pid: null } : null;
}

async function waitForPort(d: Deps, proc: ChromeProc, port: number, timeoutMs = 15_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (proc.exitCode !== null) throw new Error(`Chrome exited early (code ${proc.exitCode})`);
    if (await d.probe(port)) return;
    await d.sleep(250);
  }
  throw new Error("Chrome debug port did not open");
}

/** One launch at a time across all stores: no race on free ports or on a profile being started. */
let launchLock: Promise<unknown> = Promise.resolve();
function serialized<T>(job: () => Promise<T>): Promise<T> {
  const run = launchLock.then(job);
  launchLock = run.catch(() => {});
  return run;
}

/**
 * Launcher for the owner's Chrome on one store's profile. `profileDir` is called at launch time
 * (never at import), so a store can choose or migrate its profile lazily. If a Chrome from an
 * earlier run (HMR, crashed or killed node) still holds the profile and its debug port answers,
 * adopt it instead of spawning: a second Chrome on the same profile would only hand off to it.
 * Launches of all stores are serialized.
 */
export function createCdpLauncher(opts: {
  profileDir: () => string;
  extraArgs?: string[];
  overrides?: Partial<ChromeDeps>;
}): Launcher {
  const overrides = opts.overrides ?? {};
  return () =>
    serialized(async () => {
      const d = { ...realDeps, ...overrides, profileDir: overrides.profileDir ?? opts.profileDir() } as Deps;
      let proc: ChromeProc | null = null;
      let existing = await existingChrome(d);
      let port: number;
      if (existing) {
        port = existing.port;
      } else {
        const chromePath = d.findChrome();
        if (!chromePath) throw new Error("Chrome not found");
        d.removeActivePort(d.profileDir); // stale file from a dead Chrome
        // An explicit port, never 0: Chrome 158 started with --remote-debugging-port=0 reports
        // navigator.webdriver === true (checked 2026-11-27), and noon's Akamai then answers 403
        // "Access Denied". With a fixed port it is false, as with a normal launch.
        port = await d.freePort();
        proc = d.spawnChrome(chromePath, [
          `--remote-debugging-port=${port}`,
          "--remote-debugging-address=127.0.0.1",
          `--user-data-dir=${d.profileDir}`,
          "--window-position=-32000,-32000",
          "--no-first-run",
          "--no-default-browser-check",
          ...(opts.extraArgs ?? []),
          "about:blank",
        ]);
        try {
          await waitForPort(d, proc, port);
          if (proc.pid) d.writeOwnPortFile(d.profileDir, { port, pid: proc.pid, startedAt: Date.now() });
        } catch (e) {
          // Exit code 0 right after spawn: another Chrome already holds this profile and took the
          // hand-off. Adopt it if it answers now, else fail.
          if (proc.exitCode !== 0) {
            if (proc.exitCode === null) proc.kill();
            throw e;
          }
          existing = await existingChrome(d);
          if (!existing) throw e;
          proc = null;
          port = existing.port;
        }
      }
      const p = proc;
      const adoptedPid = existing?.pid ?? null;
      const stopChild = () => {
        if (p && p.exitCode === null) p.kill();
      };
      /** Synchronous hard stop: our child, or the adopted Chrome by its recorded pid. */
      const killNow = () => {
        if (p) stopChild();
        else if (adoptedPid !== null) {
          try {
            process.kill(adoptedPid);
          } catch {
            // already gone
          }
        }
        d.removeOwnPortFile(d.profileDir);
      };

      let browser: Browser | null = null;
      try {
        browser = await d.connect(port);
        const context = browser.contexts()[0] ?? (await browser.newContext());
        const page = context.pages()[0] ?? (await context.newPage());
        let connected = true;
        browser.on("disconnected", () => (connected = false));
        const b = browser;
        return {
          page,
          isAlive: () => connected && (!p || p.exitCode === null) && !page.isClosed(),
          close: async () => {
            try {
              // connectOverCDP's browser.close() only disconnects; ask Chrome itself to quit.
              const cdp = await b.newBrowserCDPSession();
              await cdp.send("Browser.close");
            } catch {
              // already gone
            }
            await b.close().catch(() => {});
            stopChild();
            d.removeOwnPortFile(d.profileDir);
          },
          kill: killNow,
        };
      } catch (e) {
        await browser?.close().catch(() => {});
        if (p) {
          stopChild();
          d.removeOwnPortFile(d.profileDir);
        }
        throw e;
      }
    });
}
