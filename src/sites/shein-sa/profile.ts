import os from "node:os";
import path from "node:path";

type Env = Record<string, string | undefined>;

/**
 * Where SHEIN's own Chrome profile lives: separate from noon's so cookies and SHEIN's risk score
 * never mix with another store. Kept OUT of the repo (a live profile breaks `next build`).
 * Order: SHEIN_PROFILE_DIR, then %LOCALAPPDATA%\deal-search\shein-profile, then ~/.deal-search/shein-profile.
 * Chrome creates the directory on first launch.
 */
export function resolveSheinProfileDir(env: Env = process.env, home: string = os.homedir()): string {
  if (env.SHEIN_PROFILE_DIR) return path.resolve(env.SHEIN_PROFILE_DIR);
  if (env.LOCALAPPDATA) return path.join(env.LOCALAPPDATA, "deal-search", "shein-profile");
  return path.join(home, ".deal-search", "shein-profile");
}
