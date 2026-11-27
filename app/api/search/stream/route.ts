import { ensureChecker } from "@/src/lib/alerts/service";
import { readSearchInput } from "@/src/lib/search-request";
import { runSearchStream } from "@/src/lib/search-stream-server";
import type { StreamEvent } from "@/src/lib/search-stream";

/**
 * POST /api/search/stream: the same body, guard and errors as POST /api/search, answered as
 * NDJSON events while the stores answer (protocol: src/lib/search-stream.ts). Input errors are
 * plain JSON with a 4xx status, as on /api/search, before any stream starts.
 */
export async function POST(req: Request) {
  const read = await readSearchInput(req);
  if ("response" in read) return read.response;
  const { input } = read;
  ensureChecker();

  // Aborted when the client goes away: the request's own signal, or the stream cancelled.
  const ctrl = new AbortController();
  const onAbort = () => ctrl.abort();
  if (req.signal.aborted) ctrl.abort();
  else req.signal.addEventListener("abort", onAbort, { once: true });
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const emit = (e: StreamEvent) => {
        if (ctrl.signal.aborted) return;
        try {
          controller.enqueue(encoder.encode(`${JSON.stringify(e)}\n`));
        } catch {
          ctrl.abort(); // the stream is closed: stop work
        }
      };
      void runSearchStream(input, { emit, signal: ctrl.signal }).finally(() => {
        req.signal.removeEventListener("abort", onAbort);
        try {
          controller.close();
        } catch {
          // already closed or cancelled
        }
      });
    },
    cancel() {
      ctrl.abort();
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "application/x-ndjson; charset=utf-8",
      // no-transform: no compression layer may buffer the events; no-store: never cached.
      "cache-control": "no-store, no-transform",
      "x-accel-buffering": "no",
      "x-content-type-options": "nosniff",
    },
  });
}
