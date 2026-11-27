import { describe, it, expect } from "vitest";
import { healthReport } from "@/src/lib/health";

describe("healthReport", () => {
  it("reports ok with version, db ok and whole-second uptime", () => {
    const db = { prepare: (sql: string) => ({ get: () => (sql === "SELECT 1 AS ok" ? { ok: 1 } : undefined) }) };
    expect(healthReport({ db: () => db, version: "0.1.0", uptimeSec: 12.7 })).toEqual({
      ok: true,
      version: "0.1.0",
      db: "ok",
      uptime: 12,
    });
  });
  it("reports db error (and ok false) without the error text", () => {
    const r = healthReport({
      db: () => {
        throw new Error("SQLITE_CANTOPEN /secret/path/data.db");
      },
      version: "0.1.0",
      uptimeSec: 3,
    });
    expect(r).toEqual({ ok: false, version: "0.1.0", db: "error", uptime: 3 });
    expect(JSON.stringify(r)).not.toContain("secret");
  });
  it("treats an unexpected query answer as a db error", () => {
    const db = { prepare: () => ({ get: () => undefined }) };
    expect(healthReport({ db: () => db, version: "x", uptimeSec: 0 }).db).toBe("error");
  });
});
