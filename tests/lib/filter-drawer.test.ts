import { describe, expect, it } from "vitest";
import {
  VIEW_KEY, filtersButtonName, outsidePanel, panelMode, parseView, readView, showResultsLabel, trapTab, writeView,
} from "@/src/lib/filter-drawer";

describe("panelMode (U3)", () => {
  it("sidebar from 64rem, a folding panel from 48rem, a bottom sheet below", () => {
    expect(panelMode(true, true)).toBe("sidebar");
    expect(panelMode(false, true)).toBe("panel");
    expect(panelMode(false, false)).toBe("sheet");
  });
});

describe("trapTab: the sheet's focus trap (U3)", () => {
  it("Tab on the last element wraps to the first; Shift+Tab on the first wraps to the last", () => {
    expect(trapTab(5, 4, false)).toBe(0);
    expect(trapTab(5, 0, true)).toBe(4);
  });
  it("leaves the browser to move focus in the middle", () => {
    expect(trapTab(5, 2, false)).toBeNull();
    expect(trapTab(5, 2, true)).toBeNull();
    expect(trapTab(5, 0, false)).toBeNull();
    expect(trapTab(5, 4, true)).toBeNull();
  });
  it("focus outside the sheet comes back in at the nearest end; nothing focusable does nothing", () => {
    expect(trapTab(3, -1, false)).toBe(0);
    expect(trapTab(3, -1, true)).toBe(2);
    expect(trapTab(0, -1, false)).toBeNull();
  });
  it("a single element keeps focus on itself", () => {
    expect(trapTab(1, 0, false)).toBe(0);
    expect(trapTab(1, 0, true)).toBe(0);
  });
});

describe("outsidePanel: a tap on the scrim closes the sheet (U3)", () => {
  const box = { left: 0, right: 375, top: 300, bottom: 812 };
  it("above the panel is the scrim; inside it is not", () => {
    expect(outsidePanel(box, 100, 120)).toBe(true);
    expect(outsidePanel(box, 100, 500)).toBe(false);
    expect(outsidePanel(box, 0, 300)).toBe(false);
  });
});

describe("labels (U3)", () => {
  it("names the Filters button with the active count", () => {
    expect(filtersButtonName(0)).toBe("Filters");
    expect(filtersButtonName(3)).toBe("Filters, 3 on");
  });
  it("the sheet's confirm button says how many results are left", () => {
    expect(showResultsLabel(1)).toBe("Show 1 result");
    expect(showResultsLabel(12)).toBe("Show 12 results");
    expect(showResultsLabel(0)).toBe("No results to show");
  });
});

describe("grid or list preference (U3)", () => {
  it("parses only the two known values, grid by default", () => {
    expect(parseView("list")).toBe("list");
    expect(parseView("grid")).toBe("grid");
    expect(parseView("tiles")).toBe("grid");
    expect(parseView(null)).toBe("grid");
  });
  it("round-trips through storage", () => {
    const m = new Map<string, string>();
    const storage = { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
    writeView(storage, "list");
    expect(m.get(VIEW_KEY)).toBe("list");
    expect(readView(storage)).toBe("list");
  });
  it("blocked storage falls back to grid and never throws", () => {
    const blocked = {
      getItem: () => {
        throw new Error("SecurityError");
      },
      setItem: () => {
        throw new Error("QuotaExceededError");
      },
    };
    expect(readView(blocked)).toBe("grid");
    expect(() => writeView(blocked, "list")).not.toThrow();
    expect(readView(undefined)).toBe("grid");
  });
});
