import "server-only";
import { NextResponse } from "next/server";

/** Small JSON helpers shared by the history and alerts routes. */
export const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { "cache-control": "no-store" } });

export const bad = (error: string, status = 400) => json({ error }, status);

export async function readJson(req: Request): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    return undefined;
  }
}

/** A database failure answers 500 with a plain message; the detail goes to the server log only. */
export function dbFailure(e: unknown) {
  console.warn("[db] request failed", e instanceof Error ? e.message : String(e));
  return bad("Could not use the local database", 500);
}
