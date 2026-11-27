// Prototype: SHEIN Saudi (ar.shein.com, SiteUID "ar", currency SAR) search via a real installed Google Chrome
// attached over CDP. Spike 2026-11-27 (task 15). Not wired into the app yet.
// Requires `playwright-core` (or swap the import to "playwright") and Google Chrome.
//
// Why real Chrome: api-anything's browser tier and plain HTTP get redirected to
// https://ar.shein.com/risk/challenge?captcha_type=909 (SHEIN risk control, "anti_crawler_RT").
// The installed Chrome started with normal flags + a FIXED --remote-debugging-port (port 0 makes
// navigator.webdriver true) and attached with connectOverCDP gets real result pages. Nothing is spoofed.
//
// Data source: page 1 -> the page's own XHR GET /bff-api/product/get_products_by_keywords?...&page=1&limit=120
// (signed by the page's JS; we only read the response). Page >1 -> server-rendered `var gbRawData`
// (results.bffProductsInfo.products). About 120 items per page.
//
// Language: the Saudi storefront is Arabic only (bff-api/user/language/list -> []; no English hreflang for SA).
// goods_name is Arabic. The English title is derived from goods_url_name (English URL slug, hyphens -> spaces).
//
// CLI: node shein-sa-search.prototype.mjs "<query>" [page] [--sort <n>] [--profile <dir>] [--port <n>] [--out <file.json>]

import { chromium } from "playwright-core";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const BASE = "https://ar.shein.com";
const DEFAULT_CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";

// Sort values of the `sort` URL param (SHEIN list pages): 0 recommend (default), 9 new arrivals,
// 7 top rated, 10 price low->high, 11 price high->low. 10 was verified in the spike.
export const SHEIN_SORT = { relevance: 0, newest: 9, topRated: 7, priceAsc: 10, priceDesc: 11 };

export class SheinBlockedError extends Error {}

export async function openSheinBrowser({
  profileDir = path.join(os.tmpdir(), "shein-sa-chrome-profile"),
  port = 9343, // fixed, free port. Never 0.
  offscreen = true, // headed window parked off-screen
  chromePath = process.env.CHROME_PATH || DEFAULT_CHROME,
} = {}) {
  const args = [
    `--remote-debugging-port=${port}`,
    "--remote-debugging-address=127.0.0.1",
    `--user-data-dir=${profileDir}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--lang=en-US",
    "--window-size=1366,900",
    ...(offscreen ? ["--window-position=-32000,-32000"] : []),
    "about:blank",
  ];
  // nosemgrep: javascript.lang.security.detect-child-process.detect-child-process -- Chrome from a fixed install list or the operator's CHROME_PATH, argv array, no shell
  const proc = spawn(chromePath, args, { stdio: "ignore" });
  let browser;
  for (let i = 0; i < 80 && !browser; i++) {
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
  return { browser, context, page, proc, profileDir, warmed: false };
}

export async function closeSheinBrowser(session) {
  await session.browser.close().catch(() => {});
  session.proc.kill();
}

function isChallenge(url) {
  return /\/risk\/challenge|captcha_type=/i.test(url);
}

async function warmUp(session) {
  const { page } = session;
  await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForLoadState("load", { timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(3000);
  if (isChallenge(page.url())) throw new SheinBlockedError(`home: risk challenge (${page.url()})`);
  session.warmed = true;
}

/**
 * Search SHEIN KSA. Returns { items, meta }. One page navigation per call; reuse the session.
 * items: [{id,title,titleAr,price,origPrice,discount,currency,rating,reviews,image,url}]
 */
export async function sheinSearch(q, pageNo = 1, session, { sort, warm = true } = {}) {
  if (warm && !session.warmed) await warmUp(session);
  const { page } = session;
  const qs = new URLSearchParams();
  if (pageNo > 1) qs.set("page", String(pageNo));
  if (sort != null && Number(sort) !== 0) qs.set("sort", String(sort));
  const url = `${BASE}/pdsearch/${encodeURIComponent(q)}/${qs.toString() ? "?" + qs : ""}`;
  const t0 = Date.now();
  // Page 1: the server renders only ~20 items; the page JS then calls get_products_by_keywords (page=1,
  // limit=120), signed with x-gw-auth/armortoken headers. We read that response (replaying it ourselves
  // fails with code 836100). Page >1: the server renders all ~120 items into `var gbRawData`
  // (results.bffProductsInfo) and no XHR is made, so we read the global.
  const apiResp =
    pageNo === 1
      ? page
          .waitForResponse((r) => r.url().includes("/bff-api/product/get_products_by_keywords") && r.url().includes("page=1&"), {
            timeout: 30000,
          })
          .catch(() => null)
      : null;
  const resp = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
  const status = resp ? resp.status() : 0;
  if (isChallenge(page.url())) throw new SheinBlockedError(`risk challenge (${page.url()})`);
  let info = null;
  let source = null;
  const r = apiResp ? await apiResp : null;
  if (r) {
    const body = await r.json().catch(() => null);
    if (body && String(body.code) === "0") {
      info = body.info;
      source = "xhr";
    }
  }
  if (!info) {
    info = await page.evaluate(() => window.gbRawData?.results?.bffProductsInfo || null).catch(() => null);
    source = info ? "gbRawData" : null;
  }
  if (!info) {
    if (isChallenge(page.url())) throw new SheinBlockedError(`risk challenge (${page.url()})`);
    return { items: [], meta: { url, status, ms: Date.now() - t0, note: "no product data found" } };
  }
  const items = (info.products || []).map(toItem);
  return { items, meta: { url, status, ms: Date.now() - t0, source, total: Number(info.num) || null } };
}

function toItem(g) {
  const slug = String(g.goods_url_name || "").replace(/^-+|-+$/g, "");
  const price = num(g.salePrice?.amount);
  const retail = num(g.retailPrice?.amount);
  const sym = g.salePrice?.amountWithSymbol || "";
  return {
    id: String(g.goods_id),
    title: slug.replace(/-+/g, " ").trim() || null, // English, from the URL slug
    titleAr: g.goods_name || null, // storefront title (Arabic)
    price,
    origPrice: retail != null && price != null && retail > price ? retail : null,
    discount: Number(g.unit_discount) || null, // percent off retail, as shown on the card
    currency: /^SR/.test(sym) ? "SAR" : null,
    rating: num(g.comment_rank_average),
    reviews: g.comment_num != null ? Number(g.comment_num) : null, // capped/rounded by SHEIN ("1000+")
    image: g.goods_img ? (g.goods_img.startsWith("//") ? "https:" + g.goods_img : g.goods_img) : null,
    url: `${BASE}/${g.goods_url_name}-p-${g.goods_id}.html`,
  };
}

function num(s) {
  if (s == null || s === "") return null;
  const n = parseFloat(String(s).replace(/[^0-9.]/g, ""));
  return Number.isFinite(n) ? n : null;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- tiny CLI ----
if (process.argv[1]?.endsWith("shein-sa-search.prototype.mjs")) {
  const argv = process.argv.slice(2);
  const opt = (n) => (argv.includes(n) ? argv[argv.indexOf(n) + 1] : undefined);
  const pos = argv.filter((a, i) => !a.startsWith("--") && !["--profile", "--out", "--sort", "--port"].includes(argv[i - 1]));
  const q = pos[0] || "wireless earbuds";
  const pageNo = Number(pos[1] || 1);
  const session = await openSheinBrowser({ profileDir: opt("--profile"), port: Number(opt("--port") || 9343) });
  try {
    const res = await sheinSearch(q, pageNo, session, { sort: opt("--sort") });
    const out = opt("--out");
    if (out) fs.writeFileSync(out, JSON.stringify(res, null, 2));
    console.log(JSON.stringify({ q, page: pageNo, n: res.items.length, ms: res.meta.ms, first: res.items[0] }, null, 2));
  } finally {
    await closeSheinBrowser(session);
  }
}
