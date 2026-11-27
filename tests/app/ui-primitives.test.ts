import { describe, expect, it } from "vitest";
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import Button from "@/app/components/ui/Button";
import Input from "@/app/components/ui/Input";
import Chip from "@/app/components/ui/Chip";
import Badge from "@/app/components/ui/Badge";
import StoreMark from "@/app/components/ui/StoreMark";
import Price from "@/app/components/ui/Price";
import Skeleton, { SkeletonCard } from "@/app/components/ui/Skeleton";
import EmptyState from "@/app/components/ui/EmptyState";
import ErrorState from "@/app/components/ui/ErrorState";
import SectionHeader from "@/app/components/ui/SectionHeader";
import AppFooter from "@/app/components/AppFooter";
import { DiscoverCard } from "@/app/components/HomeDiscover";

// Prices use a no-break space between the currency and the figure; compare with a plain one.
const html = (el: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(el).replace(/ /g, " ");
const noop = () => {};

describe("Button", () => {
  it("renders each variant and size as a type=button by default", () => {
    for (const variant of ["primary", "secondary", "ghost", "destructive"] as const) {
      const out = html(h(Button, { variant, size: "sm", children: "Go" }));
      expect(out).toContain(`class="btn btn--${variant} btn--sm"`);
      expect(out).toContain('type="button"');
    }
    expect(html(h(Button, { children: "Go" }))).toContain('class="btn btn--secondary btn--md"');
  });
  it("loading keeps the label, disables it and sets aria-busy", () => {
    const out = html(h(Button, { loading: true, variant: "primary", children: "Searching" }));
    expect(out).toContain("disabled");
    expect(out).toContain('aria-busy="true"');
    expect(out).toContain('class="btn__spinner" aria-hidden="true"');
    expect(out).toContain("Searching");
    expect(html(h(Button, { children: "Go" }))).not.toContain("aria-busy");
  });
  it("disabled without loading has no spinner", () => {
    const out = html(h(Button, { disabled: true, children: "Compare (1)" }));
    expect(out).toContain("disabled");
    expect(out).not.toContain("btn__spinner");
  });
  it("with href renders a link; external opens a new tab safely", () => {
    expect(html(h(Button, { href: "/history", children: "History" }))).toMatch(/^<a class="btn btn--secondary btn--md" href="\/history">/);
    expect(html(h(Button, { href: "https://x.example/", external: true, children: "Go" }))).toContain('target="_blank" rel="noopener noreferrer"');
  });
});

describe("Input and Chip", () => {
  it("Input: compact size and aria-invalid only when invalid", () => {
    expect(html(h(Input, { id: "a", size: "compact" }))).toBe('<input class="input input--compact" id="a"/>');
    expect(html(h(Input, { invalid: true }))).toContain('aria-invalid="true"');
  });
  it("Chip checkbox wraps a real checkbox in its label", () => {
    const out = html(h(Chip, { kind: "checkbox", checked: true, onChange: noop, name: "sites", value: "jarir", children: "Jarir" }));
    expect(out).toMatch(/^<label class="chip"><input type="checkbox" name="sites" checked="" value="jarir"\/>/);
    expect(out).toContain("Jarir</label>");
  });
  it("Chip toggle is a button with aria-pressed", () => {
    expect(html(h(Chip, { kind: "toggle", pressed: true, onToggle: noop, children: "4+" }))).toBe('<button type="button" class="chip" aria-pressed="true">4+</button>');
    expect(html(h(Chip, { kind: "toggle", pressed: false, onToggle: noop, children: "Any" }))).toContain('aria-pressed="false"');
  });
});

describe("Badge and StoreMark", () => {
  it("Badge tones", () => {
    expect(html(h(Badge, { children: "Normal price" }))).toBe('<span class="badge badge--neutral">Normal price</span>');
    expect(html(h(Badge, { tone: "count", children: 3 }))).toContain("badge--count");
  });
  it("StoreMark full shows the logo and name; compact keeps the name for screen readers", () => {
    const full = html(h(StoreMark, { id: "amazon-sa" }));
    expect(full).toContain('src="/stores/amazon-sa.ico"');
    expect(full).toContain('<span class="storemark__name">Amazon KSA</span>');
    const compact = html(h(StoreMark, { id: "noon-sa", variant: "compact" }));
    expect(compact).toContain('title="noon KSA"');
    expect(compact).toContain('<span class="visually-hidden">noon KSA</span>');
  });
});

describe("Price", () => {
  it("shows the current price, a struck higher original, and the store's discount, said to be the store's", () => {
    const out = html(h(Price, { amount: 899, currency: "SAR", original: 999, discountPct: 10, discountFrom: "store" }));
    expect(out).toContain("off the store&#x27;s was price");
    expect(out).not.toMatch(/verified/i);
    expect(html(h(Price, { amount: 899, currency: "SAR", original: 999, discountPct: 10, discountFrom: "history" }))).toContain("below the highest price we&#x27;ve seen");
    expect(out).toContain('<span class="price__amount">SAR 899</span>');
    expect(out).toContain('<span class="price__was"><span class="visually-hidden">was </span><s class="price__orig">SAR 999</s></span>');
    expect(out).toContain("−10%");
  });
  it("hides a discount with no source and an original that is not higher", () => {
    const out = html(h(Price, { amount: 899, currency: "SAR", original: 800, discountPct: 50 }));
    expect(out).not.toContain("price__orig");
    expect(out).not.toContain("price__off");
  });
  it("keeps the item's own currency", () => {
    expect(html(h(Price, { amount: 12.5, currency: "USD", original: 20 }))).toContain("USD 12.50");
    expect(html(h(Price, { amount: 5, currency: "", from: true }))).toContain('<span class="price__from">from</span><span class="price__amount">SAR 5</span>');
  });
});

describe("Skeleton, EmptyState, ErrorState, SectionHeader, footer", () => {
  it("Skeletons are hidden from screen readers", () => {
    expect(html(h(Skeleton, { variant: "price" }))).toBe('<span class="skeleton skeleton--price" aria-hidden="true"></span>');
    expect(html(h(SkeletonCard))).toContain('class="card card--grid card--skeleton" aria-hidden="true"');
    expect(html(h(SkeletonCard, { variant: "list" }))).toContain('class="card card--list card--skeleton" aria-hidden="true"');
  });
  it("EmptyState renders title, body and action", () => {
    const out = html(h(EmptyState, { title: "No searches yet", body: "Run one.", action: h(Button, { href: "/", children: "Search" }) }));
    expect(out).toContain('<p class="empty__title">No searches yet</p>');
    expect(out).toContain('<p class="empty__body">Run one.</p>');
    expect(out).toContain('class="empty__action"');
  });
  it("ErrorState is an alert, with a retry only when given", () => {
    expect(html(h(ErrorState, { message: "Could not load" }))).toBe('<div class="notice notice--error" role="alert"><p>Could not load</p></div>');
    expect(html(h(ErrorState, { message: "x", onRetry: noop }))).toContain("Try again");
  });
  it("SectionHeader renders the heading level, id, note and actions", () => {
    const out = html(h(SectionHeader, { as: "h1", id: "t", title: "Search history", note: "Kept here.", actions: h(Button, { children: "Clear all" }) }));
    expect(out).toContain('<h1 id="t" class="section-head__title">Search history</h1>');
    expect(out).toContain("section-head--page");
    expect(out).toContain("Kept here.");
    expect(out).toContain("Clear all");
    expect(html(h(SectionHeader, { title: "Watching" }))).toContain("<h2");
  });
  it("the footer carries the one-line data note", () => {
    expect(html(h(AppFooter))).toContain("Prices from the stores&#x27; own sites; listed price, shipping not included.");
  });
});

describe("DiscoverCard", () => {
  const item = {
    site: "jarir", id: "J1", title: "سماعات AirPods 4", url: "https://www.jarir.com/sa-en/J1", image: null, currency: "SAR",
    price: 450, previousPrice: 500, dropPct: 10, deal: { badge: "lowest-30d" as const, label: "Lowest in 30 days" }, seenAt: Date.now(),
  };
  it("shows the store, the title link, the drop against the highest seen price, and the badge", () => {
    const out = html(h(DiscoverCard, { item }));
    expect(out).toContain("Jarir");
    expect(out).toContain('href="https://www.jarir.com/sa-en/J1" target="_blank" rel="noopener noreferrer" dir="auto"');
    // Visible: the struck price is our own observation, not the store's "was" price.
    expect(out).toContain('<span class="price__was-label">highest seen </span><s class="price__orig">SAR 500</s>');
    expect(out).toContain("−10%");
    expect(out).toContain("Lowest in 30 days");
    expect(out).toContain("No image");
  });
  it("without a drop shows the price alone", () => {
    const out = html(h(DiscoverCard, { item: { ...item, previousPrice: null, dropPct: null, deal: undefined } }));
    expect(out).not.toContain("price__orig");
    expect(out).not.toContain("price__off");
    expect(out).not.toContain("badge");
  });
});

describe("StatusBar (U2 live store row)", async () => {
  const { default: StatusBar, storeStateText } = await import("@/app/components/StatusBar");
  const at = Date.UTC(2026, 10, 27, 11, 30);
  const fmt = () => "14:30";
  it("renders each state in words, with a count only when given", () => {
    const out = html(
      h(StatusBar, {
        formatTime: fmt,
        stores: [
          { store: "jarir", state: "searching" },
          { store: "amazon-sa", state: "ok", count: 12 },
          { store: "noon-sa", state: "ok", count: 1, partial: true },
          { store: "extra-sa", state: "empty" },
          { store: "shein-sa", state: "unavailable", retryAt: at },
          { store: "trendyol-sa", state: "unavailable" },
          { store: "carrefour-sa", state: "failed" },
        ],
      }),
    );
    expect(out).toContain('<ul class="storestatus" aria-label="Store status">');
    expect(out).toContain('class="storestatus__item storestatus__item--searching"');
    expect(out).toContain('<span class="storestatus__pulse" aria-hidden="true"></span>');
    expect(out.match(/storestatus__pulse/g)).toHaveLength(1);
    expect(out).toContain(">Searching<");
    expect(out).toContain(">12 results<");
    expect(out).toContain('1 result</span><span class="storestatus__detail">some pages failed</span>');
    expect(out).toContain(">No results<");
    expect(out).toContain('<span class="storestatus__label">Unavailable</span><span class="storestatus__detail">try after 14:30</span>');
    expect(out).toContain('<span class="visually-hidden">Temporarily unavailable, try after 14:30</span>');
    expect(out).toContain('class="storestatus__item storestatus__item--unavailable" title="SHEIN KSA: Temporarily unavailable, try after 14:30"><span class="storemark storemark--full">');
    expect(out).toContain(">Failed<");
    expect(out).not.toMatch(/%|progress/);
    // Each store keeps its mark.
    expect(out.match(/storemark--full/g)).toHaveLength(7);
    // Not a live region itself: the page announces a summary.
    expect(out).not.toContain("aria-live");
  });
  it("a stopped search says Stopped for stores that had not answered", () => {
    const out = html(h(StatusBar, { stores: [{ store: "jarir", state: "searching" }], stopped: true }));
    expect(out).toContain("storestatus__item--stopped");
    expect(out).toContain(">Stopped<");
    expect(out).not.toContain("storestatus__pulse");
  });
  it("a search stashed by go-home and restored by Back shows Stopped, never Searching (fix round 1)", async () => {
    const { initStream, reduceStream, stopStream, storeEntries } = await import("@/src/lib/search-stream");
    const running = reduceStream(initStream(["jarir", "noon-sa"]), { type: "store", store: "jarir", state: "empty" });
    const restored = stopStream(running);
    const out = html(h(StatusBar, { stores: storeEntries(restored), stopped: !!restored.stopped }));
    expect(out).toContain(">Stopped<");
    expect(out).not.toContain(">Searching<");
    expect(out).not.toContain("storestatus__pulse");
  });
  it("renders nothing without stores; an ok without a count never invents one", () => {
    expect(html(h(StatusBar, { stores: [] }))).toBe("");
    expect(storeStateText({ store: "a", state: "ok" }).text).toBe("Answered");
  });
});
