import { describe, expect, it, vi } from "vitest";
import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ResultCard from "@/app/components/ResultCard";
import GroupCard from "@/app/components/GroupCard";
import AppHeader from "@/app/components/AppHeader";
import { CompareDialog, CompareTray } from "@/app/components/Compare";
import { SaveToggle, SavedContext, recordView, sendSave, type SavedApi } from "@/app/components/Saved";
import { changeText } from "@/app/saved/SavedView";
import type { CompareSlot } from "@/src/lib/compare";
import type { GroupItem } from "@/src/lib/view";
import type { Product } from "@/src/lib/types";

const P = (id: string, o: Partial<Product> = {}): Product => ({
  site: "noon-sa", id, title: `JBL Flip 6 ${id}`, listPrice: 399, origPrice: null, discountPct: null, currency: "SAR",
  rating: null, soldCount: 0, image: "https://img.example/a.jpg", url: `https://www.noon.com/${id}`, detailStatus: "ok", ...o,
});

const api = (saved: string[] = []): SavedApi => ({ isSaved: (k) => saved.includes(k), toggle: () => Promise.resolve(null) });
const withSaved = (node: ReactNode, saved: string[] = []) => renderToStaticMarkup(createElement(SavedContext, { value: api(saved) }, node));

describe("Save toggle (favourites)", () => {
  it("is a 44px button with aria-pressed, the visible state in words, and that text first in its name", () => {
    const hidden = (t: string) => `<span class="visually-hidden"> ${t}</span></button>`;
    const off = withSaved(createElement(SaveToggle, { product: P("N1") }));
    expect(off).toContain('aria-pressed="false"');
    expect(off).not.toContain("aria-label");
    expect(off).toContain(`>Save${hidden("JBL Flip 6 N1")}`);
    const on = withSaved(createElement(SaveToggle, { product: P("N1") }), ["noon-sa+N1"]);
    expect(on).toContain('aria-pressed="true"');
    expect(on).toContain(`>Saved${hidden("JBL Flip 6 N1")}`);
  });
  it("renders nothing without the saved store (no dead button)", () => {
    expect(renderToStaticMarkup(createElement(SaveToggle, { product: P("N1") }))).toBe("");
  });
  it("sits on result cards, on every group row and in the compare table", () => {
    expect(withSaved(createElement(ResultCard, { product: P("N1"), query: "jbl" }))).toContain("save__btn");
    const rows = [P("N1"), P("J1", { site: "jarir", url: "https://www.jarir.com/J1" })];
    const g: GroupItem = { kind: "group", key: "g", best: rows[0], rows, bestPrice: rows[0], storeCount: 2, colors: {} };
    const group = withSaved(createElement(GroupCard, { group: g, query: "jbl" }), ["jarir+J1"]);
    expect(group.split("save__btn").length - 1).toBe(2);
    expect(group).toContain('<span class="visually-hidden"> JBL Flip 6 J1 at Jarir</span>');
    const dialog = withSaved(createElement(CompareDialog, { items: rows, open: false, onClose: () => {} }));
    expect(dialog.split("cmp__save").length - 1).toBe(2);
  });
});

describe("store links record a view", () => {
  it("recordView posts the snapshot as JSON with keepalive, and never throws", () => {
    const send = vi.fn(() => Promise.resolve(new Response("{}")));
    recordView(P("N1", { finalPrice: 350 }), send);
    const [url, init] = send.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/viewed");
    expect(init).toMatchObject({ method: "POST", keepalive: true, headers: { "content-type": "application/json" } });
    expect(JSON.parse(init.body as string)).toEqual({ site: "noon-sa", id: "N1", title: "JBL Flip 6 N1", url: "https://www.noon.com/N1", image: "https://img.example/a.jpg", price: 350, currency: "SAR" });
    expect(() => recordView(P("N1"), () => { throw new Error("offline"); })).not.toThrow();
  });
});

describe("sendSave", () => {
  const snap = { site: "noon-sa", id: "N 1", title: "t", url: "https://x.example", image: null, price: 1, currency: "SAR" };
  it("saves with a JSON POST and removes with DELETE ?site=&id=", async () => {
    const send = vi.fn(() => Promise.resolve(new Response("{}", { status: 201 })));
    expect(await sendSave(snap, true, send as unknown as typeof fetch)).toBeNull();
    expect((send.mock.calls[0] as unknown as [string, RequestInit])[1]).toMatchObject({ method: "POST" });
    expect(await sendSave(snap, false, send as unknown as typeof fetch)).toBeNull();
    expect((send.mock.calls[1] as unknown as [string])[0]).toBe("/api/favourites?site=noon-sa&id=N+1");
  });
  it("passes the server's message back (the toggle is undone), and a 404 on remove is fine", async () => {
    const full = vi.fn(() => Promise.resolve(Response.json({ error: "You can save up to 500 products." }, { status: 409 })));
    expect(await sendSave(snap, true, full as unknown as typeof fetch)).toBe("You can save up to 500 products.");
    const gone = vi.fn(() => Promise.resolve(new Response("{}", { status: 404 })));
    expect(await sendSave(snap, false, gone as unknown as typeof fetch)).toBeNull();
    const down = vi.fn(() => Promise.reject(new Error("offline")));
    expect(await sendSave(snap, true, down as unknown as typeof fetch)).toBe("Could not reach the app server");
  });
});

describe("/saved", () => {
  it("says the change since saving in words, only when there is one", () => {
    expect(changeText({ change: null, currency: "SAR" })).toBeNull();
    expect(changeText({ change: -39.5, currency: "SAR" })).toBe("Down SAR 39.50 since you saved it");
    expect(changeText({ change: 20, currency: "SAR" })).toBe("Up SAR 20 since you saved it");
    expect(changeText({ change: 0, currency: "SAR" })).toBe("Same price as when you saved it");
  });
  it("is in the header nav, after Search", () => {
    const out = renderToStaticMarkup(createElement(AppHeader, { current: "saved" }));
    expect(out).toContain('<a class="nav__link" aria-current="page" href="/saved">Saved</a>');
    expect(out.indexOf('href="/saved"')).toBeGreaterThan(out.indexOf('>Search</a>'));
  });
});

describe("compare tray with a results URL", () => {
  const gone: CompareSlot = { key: "jarir+x9", site: "jarir", product: null, snap: null };
  const tray = (o: Partial<Parameters<typeof CompareTray>[0]>) =>
    renderToStaticMarkup(createElement(CompareTray, { slots: [], full: false, waiting: false, onRemove: () => {}, onClear: () => {}, onOpen: () => {}, ...o }));
  it("never sends a shared link to 'Open the original search' once its search is on screen", () => {
    const out = tray({ slots: [gone], searched: true });
    expect(out).not.toContain("Open the original search");
    expect(out).toContain("1 ticked product is no longer in the results.");
    // An older link with only cmp= (no query) still says what to do.
    expect(tray({ slots: [gone] })).toContain("Open the original search to see these products.");
  });
});
