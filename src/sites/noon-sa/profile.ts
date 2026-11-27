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

/** The old in-repo profile location. */
export const legacyProfileDir = (): string => path.join(/* turbopackIgnore: true */ process.cwd(), ".noon-profile");

export type ProfileFs = {
  exists(p: string): boolean;
  mkdir(p: string): void;
  rename(from: string, to: string): void;
};

const realFs: ProfileFs = {
  exists: (p) => fs.existsSync(p),
  mkdir: (p) => void fs.mkdirSync(p, { recursive: true }),
  rename: (a, b) => fs.renameSync(a, b),
};

/**
 * Picks the profile dir Chrome runs on, moving the old in-repo profile to `target` when it can.
 * Never throws and never loses data:
 * - no old profile: `target`.
 * - target already holds a profile (has `Default`): `target`; the old one is left untouched.
 * - otherwise try to move old -> target. If the move fails (locked by a running Chrome, other
 *   drive) the OLD dir is used for this run and the move is retried on the next start.
 * Call lazily (first launch), never at import time.
 */
export function chooseProfileDir(
  target: string,
  legacy: string = legacyProfileDir(),
  log: (msg: string) => void = (m) => console.warn(m),
  io: ProfileFs = realFs,
): string {
  try {
    if (!io.exists(legacy)) return target;
    if (io.exists(path.join(target, "Default"))) {
      log(`noon profile: both ${target} and ${legacy} exist; using ${target}, ${legacy} left untouched (delete it if unneeded)`);
      return target;
    }
    if (io.exists(target)) {
      log(`noon profile: ${target} has no profile data yet and cannot be replaced by a move; using ${legacy} this run, will retry next start`);
      return legacy;
    }
    io.mkdir(path.dirname(target));
    io.rename(legacy, target);
    return target;
  } catch (e) {
    const err = e as NodeJS.ErrnoException;
    log(
      err.code === "EXDEV"
        ? `noon profile: cross-drive move not supported; using ${legacy}`
        : `noon profile: could not move ${legacy} to ${target} (${err.message}); using ${legacy} this run, will retry next start`,
    );
    return legacy;
  }
}
