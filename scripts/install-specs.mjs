// Copies api-specs/*.json into api-anything's sites dir and seeds the AliExpress
// KSA/English cookie. Idempotent. Cookie seeding failures only warn.
import { readFileSync, existsSync, mkdirSync, copyFileSync, readdirSync, writeFileSync, rmSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// Minimal .env.local reader (no deps); real env vars win.
const envFile = join(root, ".env.local");
if (existsSync(envFile)) {
  for (const line of readFileSync(envFile, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!m || line.trim().startsWith("#")) continue;
    const v = m[2].replace(/^(['"])(.*)\1$/, "$2");
    if (process.env[m[1]] === undefined) process.env[m[1]] = v;
  }
}
process.env.API_ANYTHING_LOCAL_ONLY ??= "1";
process.env.API_ANYTHING_HOME ??= "./.aa-home";
const home = resolve(root, process.env.API_ANYTHING_HOME);
process.env.API_ANYTHING_HOME = home;

// 1. specs
const sitesDir = join(home, "sites");
mkdirSync(sitesDir, { recursive: true });
const specDir = join(root, "api-specs");
const specs = readdirSync(specDir).filter((f) => f.endsWith(".json"));
for (const f of specs) copyFileSync(join(specDir, f), join(sitesDir, f));
console.log(`install-specs: copied ${specs.length} spec(s) to ${sitesDir}`);

// 2. AliExpress KSA / English / SAR cookie
const tmp = join(tmpdir(), `aliexpress-cookies-${process.pid}.json`);
try {
  const expires = Math.floor(Date.now() / 1000) + 365 * 24 * 3600;
  writeFileSync(
    tmp,
    JSON.stringify([
      {
        name: "aep_usuc_f",
        value: "site=glo&c_tp=SAR&region=SA&b_locale=en_US",
        domain: ".aliexpress.com",
        path: "/",
        expires,
        httpOnly: false,
        secure: true,
      },
    ]),
  );
  const cli = join(root, "node_modules", "api-anything", "dist", "cli.js");
  const r = spawnSync(process.execPath, [cli, "login", "aliexpress", "--cookies", tmp], {
    cwd: root,
    env: process.env,
    encoding: "utf8",
    timeout: 60_000,
  });
  if (r.status === 0) console.log("install-specs: aliexpress KSA/English cookie set");
  else console.warn(`install-specs: WARNING aliexpress cookie login failed (exit ${r.status}): ${(r.stderr || r.stdout || r.error || "").toString().trim().slice(0, 300)}`);
} catch (e) {
  console.warn(`install-specs: WARNING aliexpress cookie login failed: ${e?.message ?? e}`);
} finally {
  try { rmSync(tmp, { force: true }); } catch {}
}
process.exit(0);
