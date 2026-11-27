import { connection } from "next/server";
import { getDb } from "@/src/lib/db";
import { healthReport } from "@/src/lib/health";
import pkg from "@/package.json";

/**
 * GET /api/health: unauthenticated liveness for Docker's healthcheck and LAN monitoring.
 * No request guard (it returns no data and starts no store traffic). 503 when the DB fails.
 */
export async function GET() {
  await connection(); // request time, never prerendered at build
  const report = healthReport({ db: getDb, version: pkg.version, uptimeSec: process.uptime() });
  return Response.json(report, { status: report.ok ? 200 : 503, headers: { "cache-control": "no-store" } });
}
