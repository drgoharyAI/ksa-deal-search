import "server-only";
import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import type { Browser, Page } from "playwright-core";

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

function freePort(): Promise<number> {
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
}

async function waitForDebugPort(port: number, proc: ChildProcess, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (proc.exitCode !== null) throw new Error(`Chrome exited early (code ${proc.exitCode})`);
    try {
      const r = await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(1000) });
      if (r.ok) return;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error("Chrome debug port did not open");
}

export async function launchChrome(): Promise<NoonSession> {
  const chromePath = findChrome();
  if (!chromePath) throw new Error("Chrome not found");
  const port = await freePort();
  const profileDir = path.join(process.cwd(), ".noon-profile");
  const proc = spawn(
    chromePath,
    [
      `--remote-debugging-port=${port}`,
      "--remote-debugging-address=127.0.0.1",
      `--user-data-dir=${profileDir}`,
      "--window-position=-32000,-32000",
      "--no-first-run",
      "--no-default-browser-check",
      "about:blank",
    ],
    { stdio: "ignore" },
  );
  proc.on("error", () => {});

  let browser: Browser | null = null;
  try {
    await waitForDebugPort(port, proc);
    const { chromium } = await import("playwright-core");
    browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
    const context = browser.contexts()[0] ?? (await browser.newContext());
    const page = context.pages()[0] ?? (await context.newPage());
    let connected = true;
    browser.on("disconnected", () => (connected = false));
    const b = browser;
    return {
      page,
      isAlive: () => connected && proc.exitCode === null && !page.isClosed(),
      close: async () => {
        try {
          // connectOverCDP's browser.close() only disconnects; ask Chrome itself to quit.
          const cdp = await b.newBrowserCDPSession();
          await cdp.send("Browser.close");
        } catch {
          // already gone
        }
        await b.close().catch(() => {});
        if (proc.exitCode === null) proc.kill();
      },
      kill: () => {
        if (proc.exitCode === null) proc.kill();
      },
    };
  } catch (e) {
    await browser?.close().catch(() => {});
    if (proc.exitCode === null) proc.kill();
    throw e;
  }
}

// ---------------- shared instance ----------------

const shared = createNoonBrowser({ launch: launchChrome });
process.once("exit", () => shared.killNow());

/** Run `fn` with the shared noon Chrome page; jobs are serialized. */
export function withNoonPage<T>(fn: (page: Page) => Promise<T>): Promise<T> {
  return shared.withPage(fn);
}

export function closeNoonBrowser(): Promise<void> {
  return shared.close();
}
