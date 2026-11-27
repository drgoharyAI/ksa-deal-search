import fs from "node:fs";
import os from "node:os";
import path from "node:path";

type Env = Record<string, string | undefined>;

/**
 * Where noon's Chrome profile lives. Kept OUT of the repo: a live Chrome profile in the project
 * root holds file locks that break `next build` (Turbopack scans the project tree).
 * Order: NOON_PROFILE_DIR, then %LOCALAPPDATA%\deal-search\noon-profile, then ~/.deal-search/noon-profile.
 */
export function resolveProfileDir(env: Env = process.env, home: string = os.homedir()): string {
  if (env.NOON_PROFILE_DIR) return path.resolve(env.NOON_PROFILE_DIR);
  if (env.LOCALAPPDATA) return path.join(env.LOCALAPPDATA, "deal-search", "noon-profile");
  return path.join(home, ".deal-search", "noon-profile");
}

/**
 * One-time move of the old in-repo profile to `target`. Never throws: if the old profile is
 * locked (Chrome still running on it) the rename fails, we log, start fresh, and the old dir is
 * moved on a later start once it is no longer in use.
 */
export function migrateLegacyProfile(
  target: string,
  legacy: string = path.join(/* turbopackIgnore: true */ process.cwd(), ".noon-profile"),
  log: (msg: string) => void = (m) => console.warn(m),
): "moved" | "skipped" | "failed" {
  try {
    if (!fs.existsSync(legacy) || fs.existsSync(target)) return "skipped";
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.renameSync(legacy, target);
    return "moved";
  } catch (e) {
    log(`noon profile: could not move ${legacy} to ${target} (${(e as Error).message}); starting fresh, will retry next start`);
    return "failed";
  }
}
