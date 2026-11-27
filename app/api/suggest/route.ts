import { NextResponse } from "next/server";
import { getSuggestions } from "@/src/lib/suggest";
import { rejectCrossSite } from "@/src/lib/request-guard";

// Node runtime (the default). No route segment config: cacheComponents is on (next.config.ts),
// and a GET that reads req.url is dynamic anyway.

export async function GET(req: Request) {
  const rejected = rejectCrossSite(req);
  if (rejected) return rejected;
  const q = new URL(req.url).searchParams.get("q") ?? "";
  const suggestions = await getSuggestions(q);
  return NextResponse.json({ suggestions }, { headers: { "cache-control": "no-store" } });
}
