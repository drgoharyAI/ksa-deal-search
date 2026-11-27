import "server-only";
import { NextResponse } from "next/server";

/** Small JSON helpers shared by the history and alerts routes. */
export const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { "cache-control": "no-store" } });

export const bad = (error: string, status = 400) => json({ error }, status);

/** The body cap for searches, watches and the other small JSON requests (bytes). */
export const MAX_JSON_BODY = 8_192;

export const TOO_LARGE = Symbol("too-large");

/**
 * The request body as text, read as a stream that stops at `max` bytes: past the cap the read is
 * cancelled and TOO_LARGE comes back, so a chunked body (no Content-Length) is never buffered
 * whole. A declared Content-Length over the cap is refused before reading. undefined when the body
 * cannot be read.
 */
export async function readTextCapped(req: Request, max: number): Promise<string | typeof TOO_LARGE | undefined> {
  const declared = Number(req.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > max) return TOO_LARGE;
  if (!req.body) return "";
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > max) {
        void reader.cancel().catch(() => undefined);
        return TOO_LARGE;
      }
      chunks.push(value);
    }
  } catch {
    return undefined;
  } finally {
    reader.releaseLock();
  }
  const all = new Uint8Array(size);
  let at = 0;
  for (const c of chunks) {
    all.set(c, at);
    at += c.byteLength;
  }
  return new TextDecoder().decode(all);
}

/**
 * The JSON body, TOO_LARGE past `max` bytes (readTextCapped: the read stops at the cap), or
 * undefined when it is not JSON.
 */
export async function readJsonCapped(req: Request, max: number = MAX_JSON_BODY): Promise<unknown> {
  const text = await readTextCapped(req, max);
  if (text === TOO_LARGE || text === undefined) return text;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

export const tooLarge = () => bad("The request is too large", 413);

/** A database failure answers 500 with a plain message; the detail goes to the server log only. */
export function dbFailure(e: unknown) {
  console.warn("[db] request failed", e instanceof Error ? e.message : String(e));
  return bad("Could not use the local database", 500);
}
