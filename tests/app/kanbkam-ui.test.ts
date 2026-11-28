import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { HistoryInfo, KanbkamPanel, autoPicks, historyInfoReducer, HISTORY_INFO_CLOSED, historyInfoOpen, type HistoryInfoEvent } from "@/app/components/KanbkamHistory";
import type { KanbkamResult } from "@/src/lib/kanbkam/rules";
import type { KanbkamStatus } from "@/src/lib/kanbkam/service";
import type { Product } from "@/src/lib/types";

const NBSP = " ";
const NOW = Date.UTC(2026, 10, 28, 12);
const ON: KanbkamStatus = { enabled: true, backedOffUntil: null, perHour: 30, perDay: 200 };
const ok = (o: Partial<Extract<KanbkamResult, { status: "ok" }>> = {}): KanbkamResult => ({
  status: "ok",
  min: 269,
  max: 659,
  current: 269,
  dropPct: -32.6,
  since: null,
  url: "https://www.kanbkam.com/sa/en/p-B09HGPKY7Q",
  checkedAt: NOW - 3_600_000,
  verdicts: [],
  ...o,
});
type PanelProps = Parameters<typeof KanbkamPanel>[0];
const panel = (o: Partial<PanelProps>) => renderToStaticMarkup(createElement(KanbkamPanel, { status: ON, result: null, busy: false, error: null, ...o }));

describe("KanbkamPanel states", () => {
  it("off (kill switch): draws nothing", () => {
    expect(panel({ status: { ...ON, enabled: false }, result: ok() })).toBe("");
  });
  it("status not known yet: draws nothing", () => {
    expect(panel({ status: null })).toBe("");
  });
  it("loading: a quiet busy line", () => {
    const out = panel({ busy: true });
    expect(out).toContain("Price history: loading");
    expect(out).toContain('aria-busy="true"');
  });
  it("found: the compact line, lowest and highest", () => {
    const out = panel({ result: ok() });
    expect(out).toContain(`Price history: lowest SAR${NBSP}269, highest SAR${NBSP}659`);
    expect(out).not.toContain("khist__verdict");
  });
  it("adds the verdict badge when one applies", () => {
    const out = panel({ result: ok({ verdicts: [{ kind: "lowest", label: "Lowest in Kanbkam history" }] }) });
    expect(out).toContain('class="khist__verdict khist__verdict--lowest">Lowest in Kanbkam history');
    const fake = panel({ result: ok({ verdicts: [{ kind: "fake-was", label: "Fake was-price (Kanbkam)" }] }) });
    expect(fake).toContain("khist__verdict--fake-was");
  });
  it("shows both when our badge and Kanbkam disagree, and says so", () => {
    const out = panel({ result: ok({ verdicts: [{ kind: "lowest", label: "Lowest in Kanbkam history" }] }), deal: "fake-deal" });
    expect(out).toContain("Lowest in Kanbkam history");
    expect(out).toContain("Our own price history disagrees");
    expect(panel({ result: ok({ verdicts: [{ kind: "lowest", label: "Lowest in Kanbkam history" }] }), deal: "lowest-30d" })).not.toContain("disagrees");
  });
  it("not on Kanbkam: says so plainly", () => {
    expect(panel({ result: { status: "missing", url: "https://www.kanbkam.com/sa/en/p-B09HGPKY7Q", checkedAt: NOW } })).toContain("Price history: none found for this listing");
  });
  it("an error: calm status for caps and pauses, never an alert", () => {
    const out = panel({ error: "Too many price history lookups right now; try again later" });
    expect(out).toContain('role="status"');
    expect(out).toContain("Too many price history lookups");
    expect(out).not.toContain('role="alert"');
  });
  it("keeps the source behind an (i): a link to the Kanbkam page, hidden until opened", () => {
    const out = panel({ result: ok() });
    expect(out).not.toMatch(/<p class="khist__line">[^<]*Kanbkam/);
    expect(out).toContain('aria-label="Source"');
    expect(out).toMatch(/<span id="[^"]+" class="info__note"[^>]*hidden=""><a href="https:\/\/www.kanbkam.com\/sa\/en\/p-B09HGPKY7Q" target="_blank" rel="noopener noreferrer nofollow">History from Kanbkam/);
  });
});

describe("HistoryInfo link safety", () => {
  it("never links anything but an https Kanbkam product page", () => {
    for (const href of ["https://evil.example/sa/en/p-B09HGPKY7Q", "javascript:alert(1)", "http://www.kanbkam.com/sa/en/p-B09HGPKY7Q", "https://www.kanbkam.com.evil.io/sa/en/p-B09HGPKY7Q"]) {
      const out = renderToStaticMarkup(createElement(HistoryInfo, { href }));
      expect(out).not.toContain("<a ");
      expect(out).toContain("History from Kanbkam");
    }
  });
  it("is a real button that controls the note", () => {
    const out = renderToStaticMarkup(createElement(HistoryInfo, { href: "https://www.kanbkam.com/sa/en/p-B09HGPKY7Q" }));
    expect(out).toMatch(/^<span class="info"><button type="button" class="info__button" aria-label="Source" aria-expanded="false" aria-controls="[^"]+">/);
  });
});

describe("the (i) note's state machine (copied from the gshop note, with focus inside the note)", () => {
  const run = (...events: HistoryInfoEvent[]) => events.reduce(historyInfoReducer, HISTORY_INFO_CLOSED);
  it("hover, focus and a tap open it; Esc closes it whatever opened it", () => {
    expect(historyInfoOpen(run("enter"))).toBe(true);
    expect(historyInfoOpen(run("focus"))).toBe(true);
    expect(historyInfoOpen(run("enter", "focus", "click", "leave"))).toBe(true);
    for (const how of [["enter"], ["focus"], ["enter", "focus", "click"]] as HistoryInfoEvent[][]) expect(historyInfoOpen(run(...how, "escape"))).toBe(false);
  });
  it("leaving, blurring, a second tap or a press outside closes it", () => {
    expect(historyInfoOpen(run("enter", "leave"))).toBe(false);
    expect(historyInfoOpen(run("focus", "blur"))).toBe(false);
    expect(historyInfoOpen(run("enter", "focus", "click", "click"))).toBe(false);
    expect(historyInfoOpen(run("enter", "focus", "click", "leave", "outside"))).toBe(false);
  });
});

describe("autoPicks (at most 3 deal-badged Amazon.sa / noon results per search)", () => {
  const p = (site: string, id: string, badge?: "lowest-30d" | "fake-deal" | "normal"): Product =>
    ({ site, id, title: id, listPrice: 1, origPrice: null, discountPct: null, currency: "SAR", rating: null, soldCount: 0, image: "", url: "", detailStatus: "ok", ...(badge && { deal: { badge, label: badge } }) });
  it("takes deal-badged Amazon.sa and noon listings with a valid id, three at most", () => {
    const list = [
      p("jarir", "J1", "lowest-30d"),
      p("amazon-sa", "B000000001"),
      p("amazon-sa", "B000000002", "normal"),
      p("amazon-sa", "B000000003", "lowest-30d"),
      p("noon-sa", "N70208041V", "fake-deal"),
      p("amazon-sa", "bad-id", "lowest-30d"),
      p("amazon-sa", "B000000004", "lowest-30d"),
      p("noon-sa", "N70208042V", "lowest-30d"),
    ];
    expect(autoPicks(list).map((x) => x.id)).toEqual(["B000000003", "N70208041V", "B000000004"]);
  });
});
