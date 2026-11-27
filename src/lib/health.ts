/**
 * The body of GET /api/health: liveness for Docker's healthcheck and LAN monitoring. It carries no
 * data and no secrets: the app version, whether the database answers a trivial query, and the
 * process uptime in whole seconds. A database error is reported as "error" without its text
 * (the text can hold file paths).
 */
export type HealthReport = { ok: boolean; version: string; db: "ok" | "error"; uptime: number };

type HealthDb = { prepare(sql: string): { get(): unknown } };

export function healthReport(deps: { db: () => HealthDb; version: string; uptimeSec: number }): HealthReport {
  let db: HealthReport["db"] = "error";
  try {
    const row = deps.db().prepare("SELECT 1 AS ok").get() as { ok?: unknown } | undefined;
    if (row?.ok === 1) db = "ok";
  } catch {
    // reported as "error"
  }
  return { ok: db === "ok", version: deps.version, db, uptime: Math.floor(deps.uptimeSec) };
}
