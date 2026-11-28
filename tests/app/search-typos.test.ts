import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "@/src/lib/db";
import type { SearchInput } from "@/src/lib/pipeline";

const state = vi.hoisted(() => ({ db: null as unknown as Db, inputs: [] as SearchInput[] }));

vi.mock("@/src/lib/db", async (orig) => {
  const real = await orig<typeof import("@/src/lib/db")>();
  return { ...real, getDb: () => state.db };
});
vi.mock("@/src/lib/alerts/service", () => ({ ensureChecker: () => {} }));
vi.mock("@/src/lib/pipeline", () => ({
  runSearch: vi.fn(async (input: SearchInput) => {
    state.inputs.push(input);
    return {
      products: [],
      statuses: [{ site: "jarir", status: "ok" }],
      queryTokens: [],
      ...(input.noCorrect ? {} : { correction: { from: input.query, to: "airpods 4" } }),
    };
  }),
}));

const { openDb } = await import("@/src/lib/db");
const search = await import("@/app/api/search/route");

const req = (body: Record<string, unknown>) =>
  new Request("http://127.0.0.1:3000/api/search", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ sites: ["jarir"], ...body }),
  });
const history = () => (state.db.prepare("SELECT query FROM searches ORDER BY id").all() as { query: string }[]).map((r) => r.query);

beforeEach(() => {
  state.db = openDb(":memory:");
  state.inputs = [];
});
afterEach(() => state.db.close());

describe("/api/search typo correction", () => {
  it("answers the correction and records the corrected query in history", async () => {
    const body = (await (await search.POST(req({ query: "airpdos 4" }))).json()) as { correction?: unknown };
    expect(body.correction).toEqual({ from: "airpdos 4", to: "airpods 4" });
    expect(state.inputs[0].noCorrect).toBeFalsy();
    expect(history()).toEqual(["airpods 4"]);
  });

  it("noCorrect: true searches and records the query as typed", async () => {
    const body = (await (await search.POST(req({ query: "airpdos 4", noCorrect: true }))).json()) as { correction?: unknown };
    expect(state.inputs[0].noCorrect).toBe(true);
    expect(body.correction).toBeUndefined();
    expect(history()).toEqual(["airpdos 4"]);
  });

  it("only a true boolean turns correction off", async () => {
    await search.POST(req({ query: "airpdos 4", noCorrect: "1" }));
    expect(state.inputs[0].noCorrect).toBeFalsy();
  });
});
