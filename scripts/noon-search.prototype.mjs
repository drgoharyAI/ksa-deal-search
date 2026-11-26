// Prototype: noon.com Saudi (saudi-en, SAR) search via a real installed Google Chrome driven by Playwright.
// Spike 2026-11-27 (task 10b3). Not wired into the app yet. Requires the `playwright` package and Google Chrome.
//
// Why CDP-attach instead of chromium.launchPersistentContext({channel:"chrome"}):
//   launchPersistentContext starts Chrome with --enable-automation (navigator.webdriver = true) and
//   noon's Akamai Bot Manager answered every page with "Access Denied" 403. Starting the installed Chrome
//   ourselves with normal flags (plus --remote-debugging-port) and attaching with connectOverCDP passed
//   the Akamai sensor and returned real search pages. No fingerprint values are spoofed.
//
// Data source: server-rendered search page DOM (data-qa="plp-product-box" cards). No client-side search JSON
// API is called on first render. currency comes from the page's OnlineStore ld+json ("currency":"SAR").
//
// CLI: node scripts/noon-search.prototype.mjs "<query>" [page] [--headless|--offscreen] [--profile <dir>] [--out <file.json>]

import { chromium } from "playwright";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const BASE = "https://www.noon.com/saudi-en";
const DEFAULT_CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";

/** Start the installed Chrome and attach Playwright over CDP. Returns a session for noonSearch(). */
export async function openNoonBrowser({
  headless = false,
  offscreen = false, // headed Chrome with its window parked off-screen (headless is blocked by Akamai)
  profileDir = path.join(os.tmpdir(), "noon-sa-chrome-profile"),
  port = 9333,
  chromePath = process.env.CHROME_PATH || DEFAULT_CHROME,
} = {}) {
  const args = [
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profileDir}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--lang=en-US",
    "--window-size=1366,900",
    ...(headless ? ["--headless=new"] : []),
    ...(offscreen && !headless ? ["--window-position=-32000,-32000"] : []),
    "about:blank",
  ];
  const proc = spawn(chromePath, args, { stdio: "ignore" });
  let browser;
  for (let i = 0; i < 60 && !browser; i++) {
    try {
      browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
    } catch {
      await sleep(250);
    }
  }
  if (!browser) {
    proc.kill();
    throw new Error("could not attach to Chrome over CDP");
  }
  const context = browser.contexts()[0];
  const page = context.pages()[0] || (await context.newPage());
  return { browser, context, page, proc, warmed: false };
}

export async function closeNoonBrowser(session) {
  await session.browser.close().catch(() => {});
  session.proc.kill();
}

/** Visit the home page once so Akamai's sensor runs and sets its cookies before the first search. */
async function warmUp(session) {
  const { page } = session;
  await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded", timeout: 60000 });
  // The first response can be Akamai's 2.6 KB interstitial, which reloads itself after the sensor posts.
  await page.waitForLoadState("load", { timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(4000);
  const title = await page.title();
  if (/access denied/i.test(title)) throw new NoonBlockedError("home: Access Denied");
  session.warmed = true;
}

export class NoonBlockedError extends Error {}

/**
 * Search noon KSA. Returns { items: [{id,title,price,origPrice,currency,rating,reviews,image,url}], meta }.
 * One page navigation per call. Reuse the same session for later calls (warm cookies).
 */
export async function noonSearch(q, pageNo = 1, session) {
  if (!session.warmed) await warmUp(session);
  const { page } = session;
  const url = `${BASE}/search/?q=${encodeURIComponent(q)}&page=${pageNo}`;
  const t0 = Date.now();
  const resp = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
  const status = resp ? resp.status() : 0;
  // Akamai interstitial: a tiny page that reloads itself. Wait for product cards or a block signal.
  const outcome = await Promise.race([
    page.waitForSelector('[data-qa="plp-product-box"]', { timeout: 25000 }).then(() => "ok"),
    page.waitForFunction(() => /access denied/i.test(document.title), null, { timeout: 25000 }).then(() => "denied"),
  ]).catch(() => "timeout");
  if (outcome === "denied") throw new NoonBlockedError(`Access Denied (HTTP ${status})`);
  if (outcome === "timeout") {
    const captcha = await page.$('iframe[src*="captcha"], #sec-if-cpt-container, [id*="captcha"]');
    if (captcha) throw new NoonBlockedError("challenge/CAPTCHA shown");
    return { items: [], meta: { url, status, ms: Date.now() - t0, note: "no product cards (empty result?)" } };
  }

  const raw = await page.$$eval('[data-qa="plp-product-box"]', (boxes) =>
    boxes.map((box) => {
      const a = box.querySelector("a[href]");
      const txt = (sel) => box.querySelector(sel)?.textContent?.trim() || null;
      const nameEl = box.querySelector('[data-qa="plp-product-box-name"]');
      const priceBox = box.querySelector('[data-qa="plp-product-box-price"]');
      const img = box.querySelector('img[class*="productImage"]');
      return {
        href: a ? a.getAttribute("href") : null,
        title: nameEl ? nameEl.getAttribute("title") || nameEl.textContent.trim() : null,
        price: priceBox?.querySelector('[class*="sellingPrice"] [class*="amount"]')?.textContent?.trim() || null,
        origPrice: priceBox?.querySelector('[class*="oldPrice"]')?.textContent?.trim() || null,
        rating: txt('[class*="textCtr"]'),
        reviews: txt('[class*="countCtr"] span'),
        image: img ? img.getAttribute("src") : null,
      };
    })
  );
  const currency = await page.evaluate(() => {
    for (const s of document.querySelectorAll('script[type="application/ld+json"]')) {
      const m = s.textContent.match(/"currency"\s*:\s*"([A-Z]{3})"/);
      if (m) return m[1];
    }
    return null;
  });

  const items = raw
    .filter((r) => r.href && r.title)
    .map((r) => {
      const abs = new URL(r.href, "https://www.noon.com").toString();
      const clean = abs.split("?")[0];
      const sku = (clean.match(/\/([A-Z0-9]+)\/p\/?$/) || [])[1] || null;
      return {
        id: sku,
        title: r.title,
        price: num(r.price),
        origPrice: num(r.origPrice),
        currency: currency || "SAR",
        rating: num(r.rating),
        reviews: count(r.reviews),
        image: r.image,
        url: clean,
      };
    });
  return { items, meta: { url, status, ms: Date.now() - t0, currencySource: currency ? "ld+json" : "default" } };
}

function num(s) {
  if (s == null) return null;
  const n = parseFloat(String(s).replace(/[^0-9.]/g, ""));
  return Number.isFinite(n) ? n : null;
}
// "71.9K" -> 71900, "1.2M" -> 1200000, "845" -> 845
function count(s) {
  if (s == null) return null;
  const m = String(s).trim().match(/^([\d.,]+)\s*([KkMm])?$/);
  if (!m) return null;
  const base = parseFloat(m[1].replace(/,/g, ""));
  const mult = m[2] ? (m[2].toUpperCase() === "K" ? 1e3 : 1e6) : 1;
  return Math.round(base * mult);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- tiny CLI ----
if (import.meta.url === `file:///${process.argv[1].replace(/\\/g, "/")}` || process.argv[1]?.endsWith("noon-search.prototype.mjs")) {
  const argv = process.argv.slice(2);
  const flag = (n) => argv.includes(n);
  const opt = (n) => (argv.includes(n) ? argv[argv.indexOf(n) + 1] : undefined);
  const pos = argv.filter((a, i) => !a.startsWith("--") && !["--profile", "--out"].includes(argv[i - 1]));
  const q = pos[0] || "wireless earbuds";
  const pageNo = Number(pos[1] || 1);
  const session = await openNoonBrowser({ headless: flag("--headless"), offscreen: flag("--offscreen"), profileDir: opt("--profile") });
  try {
    const res = await noonSearch(q, pageNo, session);
    const out = opt("--out");
    if (out) fs.writeFileSync(out, JSON.stringify(res, null, 2));
    console.log(JSON.stringify({ q, page: pageNo, n: res.items.length, ms: res.meta.ms, first: res.items[0] }, null, 2));
  } finally {
    await closeNoonBrowser(session);
  }
}
