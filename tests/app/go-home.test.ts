import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import AppHeader, { GO_HOME_EVENT, goHome } from "@/app/components/AppHeader";

const click = (o: Partial<{ button: number; metaKey: boolean; ctrlKey: boolean; shiftKey: boolean; altKey: boolean }> = {}) => ({
  button: 0, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, defaultPrevented: false, preventDefault: vi.fn(), ...o,
});
const fakeWindow = (pathname: string, search = "", hash = "") => {
  const events: string[] = [];
  return {
    events,
    location: { pathname, search, hash },
    history: { pushState: vi.fn() },
    dispatchEvent: (e: Event) => events.push(e.type) > 0,
  };
};

describe("goHome: the wordmark and Search link on the home page", () => {
  it("on / with results and chip params: stops the soft navigation, cleans the URL, resets Home", () => {
    const e = click();
    const w = fakeWindow("/", "?store=jarir&rating=4");
    goHome(e, w);
    expect(e.preventDefault).toHaveBeenCalled();
    expect(w.history.pushState).toHaveBeenCalledWith(null, "", "/");
    expect(w.events).toEqual([GO_HOME_EVENT]);
  });
  it("on a clean / it still resets Home, without a new history entry", () => {
    const w = fakeWindow("/");
    goHome(click(), w);
    expect(w.history.pushState).not.toHaveBeenCalled();
    expect(w.events).toEqual([GO_HOME_EVENT]);
  });
  it("from /history or /alerts the link navigates as usual (Home mounts clean)", () => {
    for (const path of ["/history", "/alerts"]) {
      const e = click();
      const w = fakeWindow(path);
      goHome(e, w);
      expect(e.preventDefault).not.toHaveBeenCalled();
      expect(w.events).toEqual([]);
    }
  });
  it("leaves new-tab and modified clicks to the browser", () => {
    for (const o of [{ ctrlKey: true }, { metaKey: true }, { shiftKey: true }, { altKey: true }, { button: 1 }]) {
      const e = click(o);
      const w = fakeWindow("/", "?q=x");
      goHome(e, w);
      expect(e.preventDefault).not.toHaveBeenCalled();
      expect(w.events).toEqual([]);
    }
  });
  it("both home links point at /", () => {
    const out = renderToStaticMarkup(createElement(AppHeader, { current: "search" }));
    expect(out).toContain('<a class="wordmark" aria-label="Deal search, home" href="/">Deal search</a>');
    expect(out).toContain('<a class="nav__link" aria-current="page" href="/">Search</a>');
  });
});
