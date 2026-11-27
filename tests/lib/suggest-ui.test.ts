import { describe, it, expect } from "vitest";
import {
  addRecent,
  buildOptions,
  comboKey,
  activeIndex,
  optionKey,
  highlightParts,
  matchRecents,
  parseRecents,
  removeRecent,
  MAX_RECENTS,
} from "@/src/lib/suggest-ui";

describe("recent searches", () => {
  it("adds newest first, moves a case-insensitive repeat up, trims, caps at 20", () => {
    let l: string[] = [];
    l = addRecent(l, "  anc  earbuds ");
    l = addRecent(l, "kettle");
    l = addRecent(l, "ANC earbuds");
    expect(l).toEqual(["ANC earbuds", "kettle"]);
    expect(addRecent(l, "   ")).toBe(l);
    for (let i = 0; i < 30; i++) l = addRecent(l, `q${i}`);
    expect(l).toHaveLength(MAX_RECENTS);
    expect(l[0]).toBe("q29");
  });
  it("parses stored JSON defensively", () => {
    expect(parseRecents(null)).toEqual([]);
    expect(parseRecents("not json")).toEqual([]);
    expect(parseRecents('{"a":1}')).toEqual([]);
    expect(parseRecents('["a", 3, " b ", ""]')).toEqual(["a", "b"]);
  });
  it("removes a recent case-insensitively", () => {
    expect(removeRecent(["Kettle", "airpods"], "kettle")).toEqual(["airpods"]);
  });
  it("matches by prefix or word start; empty input shows the 5 newest", () => {
    const l = ["airpods pro", "usb c cable", "apple airtag", "mechanical keyboard", "fair price", "a", "b"];
    expect(matchRecents(l, "")).toEqual(l.slice(0, 5));
    expect(matchRecents(l, "Air")).toEqual(["airpods pro", "apple airtag"]);
    expect(matchRecents(l, "cab")).toEqual(["usb c cable"]);
  });
});

describe("buildOptions", () => {
  it("puts matching recents first, dedupes remote against them, caps at 8", () => {
    const remote = ["airpods pro", "air fryer", "airtag", "a1", "a2", "a3", "a4", "a5", "a6"];
    const out = buildOptions(["AirPods Pro", "kettle"], remote, "air");
    expect(out[0]).toEqual({ value: "AirPods Pro", recent: true });
    expect(out.filter((o) => o.value.toLowerCase() === "airpods pro")).toHaveLength(1);
    expect(out).toHaveLength(8);
    expect(out.slice(1).every((o) => !o.recent)).toBe(true);
  });
  it("shows only recents for empty or 1-char input", () => {
    expect(buildOptions(["kettle"], ["x"], "")).toEqual([{ value: "kettle", recent: true }]);
    expect(buildOptions(["kettle"], ["kx"], "k")).toEqual([{ value: "kettle", recent: true }]);
  });
});

describe("highlightParts", () => {
  it("keeps the typed prefix plain and bolds the rest", () => {
    expect(highlightParts("airpods pro", "Air")).toEqual([
      { text: "air", typed: true },
      { text: "pods pro", typed: false },
    ]);
  });
  it("matches at a word start, then anywhere, else all bold", () => {
    expect(highlightParts("apple airpods", "air")).toEqual([
      { text: "apple ", typed: false },
      { text: "air", typed: true },
      { text: "pods", typed: false },
    ]);
    expect(highlightParts("fair", "air")).toEqual([
      { text: "f", typed: false },
      { text: "air", typed: true },
    ]);
    expect(highlightParts("kettle", "air")).toEqual([{ text: "kettle", typed: false }]);
  });
});

describe("comboKey (keyboard model)", () => {
  const st = (open: boolean, active: number, count = 3) => ({ open, active, count });
  it("ArrowDown/ArrowUp move with wrap and open a closed list", () => {
    expect(comboKey("ArrowDown", st(false, -1))).toEqual({ type: "move", active: 0, open: true });
    expect(comboKey("ArrowDown", st(true, -1))).toEqual({ type: "move", active: 0, open: true });
    expect(comboKey("ArrowDown", st(true, 2))).toEqual({ type: "move", active: 0, open: true });
    expect(comboKey("ArrowUp", st(true, 0))).toEqual({ type: "move", active: 2, open: true });
    expect(comboKey("ArrowUp", st(true, -1))).toEqual({ type: "move", active: 2, open: true });
    expect(comboKey("ArrowDown", st(true, -1, 0))).toEqual({ type: "none" });
  });
  it("Enter selects the highlighted option; otherwise leaves submit to the form", () => {
    expect(comboKey("Enter", st(true, 1))).toEqual({ type: "select", index: 1 });
    expect(comboKey("Enter", st(true, -1))).toEqual({ type: "none" });
    expect(comboKey("Enter", st(false, 1))).toEqual({ type: "none" });
  });
  it("Escape closes (preventing default), Tab closes and lets focus move", () => {
    expect(comboKey("Escape", st(true, 0))).toEqual({ type: "close", preventDefault: true });
    expect(comboKey("Escape", st(false, -1))).toEqual({ type: "none" });
    expect(comboKey("Tab", st(true, 0))).toEqual({ type: "close", preventDefault: false });
  });
  it("Shift+Delete removes the highlighted option; plain Delete edits text", () => {
    expect(comboKey("Delete", st(true, 1), true)).toEqual({ type: "remove", index: 1 });
    expect(comboKey("Delete", st(true, 1))).toEqual({ type: "none" });
  });
});

describe("activeIndex: the highlight follows the option, not its position (final review M7)", () => {
  const opts = (vals: string[]) => vals.map((value) => ({ value, recent: false }));
  it("finds the highlighted option after the list changes", () => {
    const before = opts(["airpods", "air fryer"]);
    const key = optionKey(before[1]);
    expect(activeIndex(opts(["airpods pro", "airpods", "air fryer"]), key)).toBe(2);
  });
  it("is -1 when the highlighted option is gone (Enter then submits the typed text)", () => {
    const key = optionKey(opts(["airpods", "air fryer"])[1]);
    expect(activeIndex(opts(["air purifier", "airtag"]), key)).toBe(-1);
    expect(activeIndex(opts(["airpods"]), null)).toBe(-1);
  });
  it("a recent and a suggestion with the same text are different options", () => {
    expect(optionKey({ value: "airpods", recent: true })).not.toBe(optionKey({ value: "airpods", recent: false }));
  });
});
