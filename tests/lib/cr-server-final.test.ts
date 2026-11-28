import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

/** Code review round (server), verification fixes. */

vi.mock("@/src/lib/aa", () => ({ aaCall: vi.fn() }));

import { aaCall } from "@/src/lib/aa";
import { fetchSite, prepareSearch } from "@/src/lib/pipeline";
import { sites } from "@/src/sites/registry";
import { NO_RESULTS_RE } from "@/src/sites/noon-sa/search";
import { createSaveQueue, mergeSaved } from "@/app/components/Saved";
import GroupCard from "@/app/components/GroupCard";
import type { GroupItem } from "@/src/lib/view";
import type { Product } from "@/src/lib/types";
import { migrate, openDb, SCHEMA_VERSION } from "@/src/lib/db";

describe("noon's no-results text", () => {
  // eslint-disable-next-line security/detect-non-literal-regexp -- the adapter's constant
  const re = new RegExp(NO_RESULTS_RE, "i");
  it("matches a bare 0 and noon's phrases, never a count that ends in 0", () => {
    expect(re.test("Showing 1,240 results for “airpods”")).toBe(false);
    expect(re.test("10 results for airpods")).toBe(false);
    expect(re.test("1.0 results for x")).toBe(false);
    expect(re.test("0 results for “zzqx”")).toBe(true);
    expect(re.test("Showing 0 results for zzqx")).toBe(true);
    expect(re.test("Sorry, we couldn’t find any results for “zzqx”")).toBe(true);
    expect(re.test("No results found")).toBe(true);
  });
});

const P = (site: string, id: string, price: number): Product => ({
  site, id, title: "Apple AirPods Pro 2", listPrice: price, finalPrice: price, origPrice: null, discountPct: null, currency: "SAR",
  rating: null, soldCount: 0, image: "", url: `https://${site}.example/${id}`, detailStatus: "ok", matchScore: 0.9,
});
const headOf = (g: GroupItem) => /<p class="gcard__best">(.*?)<\/p>/.exec(renderToStaticMarkup(createElement(GroupCard, { group: g })))?.[1] ?? "";

describe("GroupCard header", () => {
  it("shows the Best price row's price and store, never a from price beside it", () => {
    const ali = P("aliexpress", "a", 20);
    const jarir = P("jarir", "j", 90);
    const head = headOf({ kind: "group", key: "g", best: ali, rows: [ali, jarir, P("noon-sa", "n", 95)], bestPrice: jarir, storeCount: 3, colors: {} });
    expect(head).toMatch(/Best price .*SAR\s90/);
    expect(head).toContain("Jarir");
    expect(head).not.toContain("from");
  });
  it("without a best price, a from lead says from", () => {
    const ali = P("aliexpress", "a", 20);
    const head = headOf({ kind: "group", key: "g", best: ali, rows: [ali, P("jarir", "j", 90)], bestPrice: null, storeCount: 2, colors: {} });
    expect(head).toMatch(/Listed at .*from .*SAR\s20/);
  });
});

describe("save queue reverts to the server's last confirmed state", () => {
  it("a POST then a DELETE that both fail leave it unsaved", async () => {
    const q = createSaveQueue();
    const reverts: boolean[] = [];
    const a = q.run("k", true, () => Promise.resolve("Could not save"), (s) => reverts.push(s));
    const b = q.run("k", false, () => Promise.resolve("Could not unsave"), (s) => reverts.push(s));
    await Promise.all([a, b]);
    expect(reverts).toEqual([false]);
    expect(mergeSaved([], q.local).has("k")).toBe(false);
  });
  it("after a confirmed save, a failed unsave reverts to saved", async () => {
    const q = createSaveQueue();
    const reverts: boolean[] = [];
    await q.run("k", true, () => Promise.resolve(null), (s) => reverts.push(s));
    await q.run("k", false, () => Promise.resolve("nope"), (s) => reverts.push(s));
    expect(reverts).toEqual([true]);
  });
});

describe("migration 7 flags a pre-upgrade failed send for retry", () => {
  it("an armed watch's unsent latest event gets retry = 1; others stay 0", () => {
    const db = openDb(":memory:");
    try {
      const w = (lastFired: number | null) =>
        Number(db.prepare("INSERT INTO watches (kind, query, sites, target, createdAt, lastFiredPrice) VALUES ('search', 'q', '[]', 10, 0, ?)").run(lastFired).lastInsertRowid);
      const ev = (watchId: number, sent: number) =>
        Number(db.prepare("INSERT INTO alert_events (watchId, at, title, site, newPrice, target, sent) VALUES (?, 1, 't', 'jarir', 9, 10, ?)").run(watchId, sent).lastInsertRowid);
      const armed = w(null);
      const old = ev(armed, 0);
      const latest = ev(armed, 0);
      const disarmed = ev(w(9), 0);
      const sentOk = ev(w(null), 1);
      db.prepare("UPDATE alert_events SET retry = 0").run();
      db.prepare("UPDATE schema_version SET version = 6").run();
      migrate(db);
      expect((db.prepare("SELECT version FROM schema_version").get() as { version: number }).version).toBe(SCHEMA_VERSION);
      const retry = (id: number) => (db.prepare("SELECT retry FROM alert_events WHERE id = ?").get(id) as { retry: number }).retry;
      expect([retry(old), retry(latest), retry(disarmed), retry(sentOk)]).toEqual([0, 1, 0, 0]);
    } finally {
      db.close();
    }
  });
});

describe("listings dropped by the store-host check are logged", () => {
  it("one line per store with the count and a host, never the URL", async () => {
    const orig = sites.jarir.normalizeSearchItem;
    sites.jarir.normalizeSearchItem = (raw) => {
      const p = orig(raw);
      return p ? { ...p, url: "https://evil.example/x?q=secret" } : p;
    };
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      vi.mocked(aaCall).mockResolvedValue({ ok: true, tier: 1, data: [{ id: "1", title: "AirPods", price: "900", path: "a-1" }, { id: "2", title: "AirPods", price: "950", path: "a-2" }] });
      await fetchSite(sites.jarir, prepareSearch({ query: "airpods", sites: ["jarir"], sort: "price" }));
      const lines = warn.mock.calls.filter((c) => String(c[0]).includes("link off the store's hosts"));
      expect(lines).toHaveLength(1);
      expect(lines[0].slice(1)).toEqual(["jarir", expect.any(Number), "evil.example"]);
      expect(JSON.stringify(lines)).not.toContain("secret");
    } finally {
      warn.mockRestore();
      sites.jarir.normalizeSearchItem = orig;
    }
  });
});
