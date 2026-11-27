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

/**
 * Where Chrome may be installed, in order: CHROME_PATH (operator override), then the platform's
 * standard Google Chrome locations. Linux covers the official google-chrome-stable .deb used by the
 * Docker image, with Chromium last.
 */
export function chromeCandidates(
  env: Record<string, string | undefined> = process.env,
  platform: NodeJS.Platform = process.platform,
): string[] {
  const own = env.CHROME_PATH?.trim() ? [env.CHROME_PATH.trim()] : [];
  if (platform === "linux") {
    return [
      ...own,
      "/usr/bin/google-chrome-stable",
      "/usr/bin/google-chrome",
      "/opt/google/chrome/chrome",
      "/usr/bin/chromium",
      "/usr/bin/chromium-browser",
    ];
  }
  if (platform === "darwin") return [...own, "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"];
  const rel = path.join("Google", "Chrome", "Application", "chrome.exe");
  return [
    ...own,
    ...[env.ProgramFiles, env["ProgramFiles(x86)"], env.LocalAppData ?? env.LOCALAPPDATA]
      .filter((d): d is string => !!d)
      .map((d) => path.join(d, rel)),
  ];
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
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- Chrome install paths from a fixed list and the operator's CHROME_PATH
  writeOwnPortFile?(profileDir: string, f: OwnPortFile): void;
  removeOwnPortFile?(profileDir: string): void;
  /** True if a process with this pid exists. */
  pidAlive?(pid: number): boolean;
  /**
   * The user-data-dir the connected Chrome runs on, or null if it cannot be read. Proves an adopted
   * Chrome is this store's before it is used or killed.
   */
  userDataDir?(browser: Browser): Promise<string | null>;
  /** Hard-stop a process by pid (only ever called for an adopted Chrome that passed the profile check). */
  killPid?(pid: number): void;
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
      // eslint-disable-next-line security/detect-non-literal-fs-filename -- a file inside the app's own Chrome profile dir
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
      // eslint-disable-next-line security/detect-non-literal-fs-filename -- a file inside the app's own Chrome profile dir
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
      // eslint-disable-next-line security/detect-non-literal-fs-filename -- a file inside the app's own Chrome profile dir
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
  async userDataDir(browser) {
    // Browser.getBrowserCommandLine answers only when Chrome runs with --enable-automation, which
    // we never pass (bot detection), so chrome://version (no network) is the usual source.
    try {
      const cdp = await browser.newBrowserCDPSession();
      const r = (await cdp.send("Browser.getBrowserCommandLine")) as { arguments?: string[] };
      const arg = r.arguments?.find((a) => a.startsWith("--user-data-dir="));
      if (arg) return arg.slice("--user-data-dir=".length);
    } catch {
      // expected without --enable-automation
    }
    const context = browser.contexts()[0];
    if (!context) return null;
    const page = await context.newPage();
    try {
      await page.goto("chrome://version", { timeout: 10_000 });
      const profilePath = (await page.textContent("#profile_path", { timeout: 5_000 }))?.trim();
      // Profile Path is <user-data-dir>/<profile>, e.g. ...\shein-profile\Default.
      return profilePath ? path.dirname(profilePath) : null;
    } catch {
      return null;
    } finally {
      await page.close().catch(() => {});
    }
  },
  killPid(pid) {
    try {
      process.kill(pid);
    } catch {
      // already gone
    }
  },
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
};

type Candidate = { port: number; pid: number | null };

/** Comparable form of a directory path (Windows: case-insensitive, either slash, 8.3 names expanded). */
function normDir(p: string): string {
  let s = p.trim().replace(/^"|"$/g, "");
  try {
    s = fs.realpathSync.native(s);
  } catch {
    // not on disk (tests) or not accessible: compare as given
  }
  s = s.replace(/[\\/]+/g, "/").replace(/\/+$/, "");
  return process.platform === "win32" ? s.toLowerCase() : s;
}

export const sameDir = (a: string, b: string): boolean => normDir(a) === normDir(b);

/**
 * Candidates for a Chrome already running on this profile: our own port file first (the pid is
 * alive and the port answers; if the pid is alive but the port does not answer, probe once more
 * after 2 s), then Chrome's DevToolsActivePort. A stale own file is deleted; `remembered` keeps
 * the record read before deleting it, for the exit-0 re-probe.
 */
async function findCandidate(d: Deps): Promise<{ found: Candidate | null; remembered: Candidate | null }> {
  const own = d.readOwnPortFile(d.profileDir);
  let remembered: Candidate | null = null;
  if (own) {
    remembered = { port: own.port, pid: own.pid };
    if (d.pidAlive(own.pid)) {
      if (await d.probe(own.port)) return { found: remembered, remembered };
      await d.sleep(2_000);
      if (await d.probe(own.port)) return { found: remembered, remembered };
    }
    d.removeOwnPortFile(d.profileDir);
  }
  const port = d.readActivePort(d.profileDir);
  if (port !== null && (await d.probe(port))) return { found: { port, pid: null }, remembered };
  return { found: null, remembered };
}

/**
 * Connect to a candidate and PROVE it runs on this store's profile (its user-data-dir). Only a
 * proven Chrome is used, and only a proven pid may ever be killed. Otherwise disconnect, null.
 */
async function tryAdopt(d: Deps, c: Candidate): Promise<{ browser: Browser; port: number; pid: number | null } | null> {
  let browser: Browser;
  try {
    browser = await d.connect(c.port);
  } catch {
    return null;
  }
  const udd = await d.userDataDir(browser).catch(() => null);
  if (udd && sameDir(udd, d.profileDir)) {
    return { browser, port: c.port, pid: c.pid !== null && d.pidAlive(c.pid) ? c.pid : null };
  }
  await browser.close().catch(() => {}); // connectOverCDP: disconnects only, never closes their Chrome
  return null;
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

/**
 * One launch at a time across all stores (no race on free ports or on a profile being started).
 * The lock lives on globalThis so a module re-evaluated by HMR shares it.
 */
const gl = globalThis as typeof globalThis & { __dealSearchLaunchLock?: Promise<unknown> };
gl.__dealSearchLaunchLock ??= Promise.resolve();
function serialized<T>(job: () => Promise<T>): Promise<T> {
  const run = (gl.__dealSearchLaunchLock ?? Promise.resolve()).then(job);
  gl.__dealSearchLaunchLock = run.catch(() => {});
  return run;
}

/**
 * Launcher for the owner's Chrome on one store's profile. `profileDir` is called at launch time
 * (never at import), so a store can choose or migrate its profile lazily. If a Chrome from an
 * earlier run (HMR, crashed or killed node) still holds the profile, answers, and proves it runs
 * on this profile, adopt it instead of spawning: a second Chrome on the same profile would only
 * hand off to it. Launches of all stores are serialized.
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
      const first = await findCandidate(d);
      let adopted = first.found ? await tryAdopt(d, first.found) : null;
      // A record that answers but is not provably ours is stale.
      if (first.found && !adopted && first.found.pid !== null) d.removeOwnPortFile(d.profileDir);

      let proc: ChromeProc | null = null;
      let childPort = 0;
      let browser: Browser | null = adopted?.browser ?? null;
      if (!adopted) {
        const chromePath = d.findChrome();
        if (!chromePath) throw new Error("Chrome not found");
        d.removeActivePort(d.profileDir); // stale file from a dead Chrome
        // An explicit port, never 0: Chrome 158 started with --remote-debugging-port=0 reports
        // navigator.webdriver === true (checked 2026-11-27), and noon's Akamai then answers 403
        // "Access Denied". With a fixed port it is false, as with a normal launch.
        const port = await d.freePort();
        const child = d.spawnChrome(chromePath, [
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
          await waitForPort(d, child, port);
          if (child.pid) d.writeOwnPortFile(d.profileDir, { port, pid: child.pid, startedAt: Date.now() });
          proc = child;
          childPort = port;
        } catch (e) {
          // Exit code 0 right after spawn: another Chrome already holds this profile and took the
          // hand-off. Adopt it if it answers now and proves it is ours, else fail.
          if (child.exitCode !== 0) {
            if (child.exitCode === null) child.kill();
            throw e;
          }
          const again = await findCandidate(d);
          const remembered = first.remembered ?? again.remembered;
          const c = again.found ?? (remembered && (await d.probe(remembered.port)) ? remembered : null);
          adopted = c ? await tryAdopt(d, c) : null;
          if (!adopted) throw e;
          browser = adopted.browser;
        }
      }

      const p = proc;
      const adoptedPid = adopted?.pid ?? null;
      const stopChild = () => {
        if (p && p.exitCode === null) p.kill();
      };
      /** Synchronous hard stop: our child, or an adopted Chrome whose pid passed the profile check. */
      const killNow = () => {
        if (p) stopChild();
        else if (adoptedPid !== null) d.killPid(adoptedPid);
        d.removeOwnPortFile(d.profileDir);
      };

      try {
        if (!browser) browser = await d.connect(childPort);
        const b = browser;
        const context = b.contexts()[0] ?? (await b.newContext());
        const page = context.pages()[0] ?? (await context.newPage());
        let connected = true;
        b.on("disconnected", () => (connected = false));
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
