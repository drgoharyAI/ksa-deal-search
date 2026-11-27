import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "@/src/lib/db";
import type { Product } from "@/src/lib/types";

const state = vi.hoisted(() => ({ db: null as unknown as Db, dbFails: false }));

vi.mock("@/src/lib/db", async (orig) => {
  const real = await orig<typeof import("@/src/lib/db")>();
  return {
    ...real,
    getDb: () => {
      if (state.dbFails) throw new Error("disk I/O error");
      return state.db;
    },
  };
});
vi.mock("@/src/lib/alerts/service", () => ({ ensureChecker: () => {} }));

const product: Product = {
  site: "amazon-sa",
  id: "B0X",
  title: "Kettle",
  listPrice: 80,
  origPrice: null,
  discountPct: null,
  currency: "SAR",
  rating: null,
  soldCount: 0,
  image: "",
  url: "https://amazon.example/B0X",
  finalPrice: 80,
  detailStatus: "ok",
  matchScore: 0.9,
};

vi.mock("@/src/lib/pipeline", () => ({
  runSearch: vi.fn(async () => ({ products: [product], statuses: [{ site: "amazon-sa", status: "ok" }], queryTokens: [] })),
}));

const { openDb } = await import("@/src/lib/db");
const { DAY } = await import("@/src/lib/insights");
const search = await import("@/app/api/search/route");

const req = () =>
  new Request("http://127.0.0.1:3000/api/search", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ query: "kettle", sites: ["amazon-sa"] }),
  });
const count = () => (state.db.prepare("SELECT count(*) n FROM observations").get() as { n: number }).n;

beforeEach(() => {
  state.db = openDb(":memory:");
  state.dbFails = false;
});
afterEach(() => state.db.close());

describe("/api/search deal insights", () => {
  it("records observations and shows no badge on a first search", async () => {
    const r = await search.POST(req());
    const body = (await r.json()) as { products: Product[] };
    expect(body.products[0]).not.toHaveProperty("deal");
    expect(body.products[0]).not.toHaveProperty("trend");
    expect(count()).toBe(1);
    await search.POST(req());
    expect(count()).toBe(1); // same hour
  });
  it("attaches the badge and trend once there is enough history", async () => {
    const ins = state.db.prepare("INSERT INTO observations (site, productId, price, origPrice, at) VALUES ('amazon-sa', 'B0X', 100, NULL, ?)");
    ins.run(Date.now() - 3 * DAY);
    ins.run(Date.now() - 2 * DAY);
    const body = (await (await search.POST(req())).json()) as { products: Product[] };
    expect(body.products[0].deal).toEqual({ badge: "lowest-30d", label: "Lowest in 30 days" });
    expect(body.products[0].trend?.points).toEqual([100, 100, 80]);
  });
  it("still answers the search when the database fails", async () => {
    state.dbFails = true;
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const r = await search.POST(req());
    expect(r.status).toBe(200);
    expect(((await r.json()) as { products: Product[] }).products).toEqual([product]);
    expect(warn).toHaveBeenCalledWith("[insights] could not compute deal insights", "disk I/O error");
    expect(warn).toHaveBeenCalledWith("[insights] could not record price observations", "disk I/O error");
    warn.mockRestore();
  });
});
