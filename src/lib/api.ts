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

/**
 * The JSON body, or "too-large" past `max` characters (checked against Content-Length first, then
 * the text read), or undefined when it is not JSON.
 */
export async function readJsonCapped(req: Request, max: number): Promise<unknown> {
  const declared = Number(req.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > max) return TOO_LARGE;
  let text: string;
  try {
    text = await req.text();
  } catch {
    return undefined;
  }
  if (text.length > max) return TOO_LARGE;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

export const TOO_LARGE = Symbol("too-large");

/** A database failure answers 500 with a plain message; the detail goes to the server log only. */
export function dbFailure(e: unknown) {
  console.warn("[db] request failed", e instanceof Error ? e.message : String(e));
  return bad("Could not use the local database", 500);
}
