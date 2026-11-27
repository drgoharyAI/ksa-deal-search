import { describe, expect, it, vi } from "vitest";
import { MAX_SHARE_LENGTH, MAX_SHARE_QUERY, parseShare, runOnce, shareSearch } from "@/src/lib/share";
import { NO_FILTERS, filtersFromSearch } from "@/src/lib/chips";
import { historyMove, HOME_ENTRY } from "@/src/lib/rerun";
import { copyText } from "@/app/components/CopyLink";

const base = { query: "", sites: ["jarir", "noon-sa"], sort: "price" as const, minPrice: "", maxPrice: "", minRating: "" };

describe("shareable result URLs: serialize and parse", () => {
  const values = { query: "jbl flip 6", sites: ["noon-sa", "jarir"], sort: "deal" as const, minPrice: "100", maxPrice: "", minRating: "4" };
  const chips = { ...NO_FILTERS, stores: ["jarir"], brands: ["jbl"], maxPrice: 500, discounted: true };
  const cmp = ["jarir+123", "noon-sa+N9"];

  it("writes the search, the chips and the compare keys in a fixed order", () => {
    const qs = shareSearch(values, chips, cmp);
    expect(qs).toBe("?q=jbl+flip+6&sites=noon-sa%2Cjarir&sort=deal&min=100&rating=4&store=jarir&brand=jbl&pmax=500&disc=1&cmp=jarir%2B123%2Cnoon-sa%2BN9");
    // The same state always gives the same link.
    expect(shareSearch(values, chips, cmp)).toBe(qs);
  });
  it("round-trips: parse(serialize(state)) is the state", () => {
    const r = parseShare(shareSearch(values, chips, cmp), base);
    expect(r).toEqual({ values, chips, cmp });
  });
  it("round-trips a bare search (no chips, no compare)", () => {
    const qs = shareSearch({ ...base, query: "airpods" });
    expect(qs).toBe("?q=airpods&sites=jarir%2Cnoon-sa&sort=price");
    expect(parseShare(qs, base)).toEqual({ values: { ...base, query: "airpods" }, chips: NO_FILTERS, cmp: [] });
  });
  it("ignores an unknown parameter, and serializing again drops it", () => {
    const r = parseShare("?q=airpods&utm_source=x&evil=%3Cscript%3E&sort=price", base);
    expect(r?.values.query).toBe("airpods");
    expect(r && shareSearch(r.values, r.chips, r.cmp)).toBe("?q=airpods&sites=jarir%2Cnoon-sa&sort=price");
  });
  it("refuses a too-long query, and a query string far longer than any link we write", () => {
    expect(parseShare(`?q=${"a".repeat(MAX_SHARE_QUERY + 1)}`, base)).toBeNull();
    expect(parseShare(`?q=${"a".repeat(MAX_SHARE_QUERY)}`, base)?.values.query).toHaveLength(MAX_SHARE_QUERY);
    expect(parseShare(`?q=ok&pad=${"x".repeat(MAX_SHARE_LENGTH)}`, base)).toBeNull();
  });
  it("drops a too-long or junk value but keeps the rest of the link", () => {
    const r = parseShare(`?q=ok&min=${"9".repeat(20)}&max=-5&cmp=jarir%2B${"x".repeat(200)},noon-sa%2BN1&brand=${"b".repeat(60)},jbl&sites=evil,jarir,jarir`, base);
    expect(r?.values).toMatchObject({ minPrice: "", maxPrice: "", sites: ["jarir"] });
    expect(r?.cmp).toEqual(["noon-sa+N1"]);
    expect(r?.chips.brands).toEqual(["jbl"]);
  });
  it("needs a query: chip or compare keys alone are not a search", () => {
    expect(parseShare("", base)).toBeNull();
    expect(parseShare("?q=%20%20", base)).toBeNull();
    expect(parseShare("?store=jarir&cmp=jarir%2B1", base)).toBeNull();
    // The chips still read on their own, as before.
    expect(filtersFromSearch("?store=jarir").stores).toEqual(["jarir"]);
  });
});

describe("auto-run once", () => {
  const fakeTimers = () => {
    const queue = new Map<number, () => void>();
    let n = 0;
    return {
      set: (f: () => void) => (queue.set(++n, f), n),
      clear: (t: unknown) => void queue.delete(t as number),
      flush: () => {
        const fs = [...queue.values()];
        queue.clear();
        fs.forEach((f) => f());
      },
    };
  };
  it("a Strict Mode mount, cleanup and remount runs the search once", () => {
    const t = fakeTimers();
    const flag = { current: false };
    const fn = vi.fn();
    const cleanup = runOnce(flag, fn, t);
    cleanup();
    runOnce(flag, fn, t);
    t.flush();
    expect(fn).toHaveBeenCalledTimes(1);
  });
  it("a later mount (Back to the page in the same component) does not search again", () => {
    const t = fakeTimers();
    const flag = { current: false };
    const fn = vi.fn();
    runOnce(flag, fn, t);
    t.flush();
    runOnce(flag, fn, t);
    t.flush();
    expect(fn).toHaveBeenCalledTimes(1);
  });
  it("two timers that both fire still run once", () => {
    const t = fakeTimers();
    const flag = { current: false };
    const fn = vi.fn();
    runOnce(flag, fn, t);
    runOnce(flag, fn, t);
    t.flush();
    expect(fn).toHaveBeenCalledTimes(1);
  });
  it("with real timers it runs on the next task, not during the effect", async () => {
    const flag = { current: false };
    const fn = vi.fn();
    runOnce(flag, fn);
    expect(fn).not.toHaveBeenCalled();
    await new Promise((r) => setTimeout(r, 5));
    expect(fn).toHaveBeenCalledTimes(1);
  });
});

describe("Back and Forward with results URLs", () => {
  it("Back to a results entry left before any result came runs it again", () => {
    expect(historyMove("?q=airpods&sort=price", null, { stashed: false, showingHome: true })).toBe("run");
  });
  it("with results stashed, the stash comes back instead (no second search)", () => {
    expect(historyMove("?q=airpods&sort=price", null, { stashed: true, showingHome: true })).toBe("restore");
  });
  it("the go-home entry is still home, and a results page only syncs its chips", () => {
    expect(historyMove("", { [HOME_ENTRY]: true }, { stashed: false, showingHome: false })).toBe("home");
    expect(historyMove("?q=airpods", null, { stashed: false, showingHome: false })).toBe("sync");
    expect(historyMove("?store=jarir", null, { stashed: false, showingHome: true })).toBe("sync");
  });
});

describe("Copy link", () => {
  const doc = (ok: boolean | "throws") => {
    const nodes: unknown[] = [];
    const area = { value: "", style: {} as Record<string, string>, setAttribute: vi.fn(), select: vi.fn() };
    return {
      nodes,
      area,
      d: {
        createElement: () => area as unknown as HTMLTextAreaElement,
        body: { appendChild: (n: Node) => nodes.push(n), removeChild: (n: Node) => nodes.splice(nodes.indexOf(n), 1) },
        execCommand: () => {
          if (ok === "throws") throw new Error("no");
          return ok;
        },
      },
    };
  };
  it("uses the Clipboard API when it works", async () => {
    const writeText = vi.fn(() => Promise.resolve());
    expect(await copyText("http://127.0.0.1:3000/?q=x", { writeText }, undefined)).toBe(true);
    expect(writeText).toHaveBeenCalledWith("http://127.0.0.1:3000/?q=x");
  });
  it("falls back to select-and-copy when the Clipboard API refuses, and cleans up", async () => {
    const f = doc(true);
    expect(await copyText("u", { writeText: () => Promise.reject(new Error("denied")) }, f.d)).toBe(true);
    expect(f.area.value).toBe("u");
    expect(f.nodes).toEqual([]);
  });
  it("reports failure when neither way works (the page then shows the link to copy by hand)", async () => {
    expect(await copyText("u", undefined, doc(false).d)).toBe(false);
    expect(await copyText("u", undefined, doc("throws").d)).toBe(false);
    expect(await copyText("u", undefined, undefined)).toBe(false);
  });
});
