import "server-only";
import { spawn } from "node:child_process";
import net from "node:net";
import fs from "node:fs";
import path from "node:path";
import type { Browser, Page } from "playwright-core";
import { chooseProfileDir, resolveProfileDir } from "./profile";

/**
 * Owner's installed Google Chrome, started by us with normal flags plus a localhost-only
 * debug port, then attached with Playwright `connectOverCDP`. noon's bot protection blocks
 * `launchPersistentContext` (adds --enable-automation) and headless Chrome, so neither is used.
 * See docs/superpowers/spikes/2026-11-27-noon-sa.md ("Playwright spike").
 */

export type NoonSession = {
  page: Page;
  /** False once Chrome exited or the page closed; the next job then relaunches. */
  isAlive(): boolean;
  close(): Promise<void>;
  /** Synchronous hard stop, used on process exit where async work cannot finish. */
  kill?(): void;
};

export type Launcher = () => Promise<NoonSession>;

export const IDLE_CLOSE_MS = 10 * 60_000;

/**
 * One shared browser: launched lazily on first use, jobs run one at a time (FIFO),
 * closed after `idleMs` without jobs. A throwing job rejects only its own caller.
 */
export function createNoonBrowser(opts: { launch: Launcher; idleMs?: number }) {
  const idleMs = opts.idleMs ?? IDLE_CLOSE_MS;
  let session: NoonSession | null = null;
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

type ChromeProc = { exitCode: number | null; kill(): boolean };

/** Side effects of the launcher, injectable so tests never spawn Chrome or touch the network. */
export type ChromeDeps = {
  profileDir: string;
  findChrome(): string | null;
  /** Port from `<profile>/DevToolsActivePort` (written by Chrome), or null. */
  readActivePort(profileDir: string): number | null;
  removeActivePort(profileDir: string): void;
  /** A currently free TCP port on 127.0.0.1 for Chrome's debug endpoint. */
  freePort(): Promise<number>;
  /** True if `http://127.0.0.1:<port>/json/version` answers. */
  probe(port: number): Promise<boolean>;
  spawnChrome(chromePath: string, args: string[]): ChromeProc;
  connect(port: number): Promise<Browser>;
  sleep(ms: number): Promise<void>;
};

const portFile = (profileDir: string) => path.join(profileDir, "DevToolsActivePort");

/** Chosen once per process, at first launch (never at import): see chooseProfileDir. */
let chosenProfileDir: string | null = null;
const lazyProfileDir = () => (chosenProfileDir ??= chooseProfileDir(resolveProfileDir()));

const realDeps: Omit<ChromeDeps, "profileDir"> = {
  findChrome,
  readActivePort(profileDir) {
    try {
      // First line of DevToolsActivePort is the port; parseInt stops at the line break.
      const port = parseInt(fs.readFileSync(portFile(profileDir), "utf8"), 10);
      return Number.isInteger(port) && port > 0 && port < 65536 ? port : null;
    } catch {
      return null;
    }
  },
  removeActivePort(profileDir) {
    fs.rmSync(portFile(profileDir), { force: true });
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

async function existingPort(d: ChromeDeps): Promise<number | null> {
  const port = d.readActivePort(d.profileDir);
  return port !== null && (await d.probe(port)) ? port : null;
}

async function waitForPort(d: ChromeDeps, proc: ChromeProc, port: number, timeoutMs = 15_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (proc.exitCode !== null) throw new Error(`Chrome exited early (code ${proc.exitCode})`);
    if (await d.probe(port)) return;
    await d.sleep(250);
  }
  throw new Error("Chrome debug port did not open");
}

/**
 * Launcher for the owner's Chrome on the noon profile (see profile.ts). If a Chrome from an earlier
 * run (HMR, crashed node) still holds the profile and its debug port answers, adopt it instead
 * of spawning: a second Chrome on the same profile would only hand off to the first one.
 */
export function createChromeLauncher(overrides: Partial<ChromeDeps> = {}): Launcher {
  return async () => {
    const d: ChromeDeps = { ...realDeps, ...overrides, profileDir: overrides.profileDir ?? lazyProfileDir() };
    let proc: ChromeProc | null = null;
    let port = await existingPort(d);
    if (port === null) {
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
        "about:blank",
      ]);
    }
    const p = proc;
    const killProc = () => {
      if (p && p.exitCode === null) p.kill();
    };

    let browser: Browser | null = null;
    try {
      if (p) await waitForPort(d, p, port!);
      browser = await d.connect(port!);
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
          killProc();
        },
        // An adopted Chrome has no child process here; the next start adopts it again.
        kill: killProc,
      };
    } catch (e) {
      await browser?.close().catch(() => {});
      killProc();
      throw e;
    }
  };
}

export const launchChrome: Launcher = createChromeLauncher();

// ---------------- shared instance ----------------

type NoonBrowser = ReturnType<typeof createNoonBrowser>;
const g = globalThis as typeof globalThis & { __noonBrowser?: NoonBrowser; __noonBrowserExitHook?: boolean };

/**
 * One instance per process, kept on globalThis so Next dev HMR (which re-evaluates this
 * module) reuses the session instead of losing track of the running Chrome.
 */
export function sharedNoonBrowser(): NoonBrowser {
  g.__noonBrowser ??= createNoonBrowser({ launch: launchChrome });
  if (!g.__noonBrowserExitHook) {
    g.__noonBrowserExitHook = true;
    process.once("exit", () => g.__noonBrowser?.killNow());
  }
  return g.__noonBrowser;
}

/** Run `fn` with the shared noon Chrome page; jobs are serialized. */
export function withNoonPage<T>(fn: (page: Page) => Promise<T>): Promise<T> {
  return sharedNoonBrowser().withPage(fn);
}

export function closeNoonBrowser(): Promise<void> {
  return sharedNoonBrowser().close();
}
