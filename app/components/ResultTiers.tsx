"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Product } from "@/src/lib/types";
import { isLikelyMatch } from "@/src/lib/rank";
import { leadOf, type ViewItem } from "@/src/lib/view";
import { productKey } from "@/src/lib/specs";
import ResultCard, { type CardVariant } from "./ResultCard";
import GroupCard from "./GroupCard";
import Button from "./ui/Button";
import { GshopAuto } from "./GshopCheck";

/** Cards drawn per step: a search can return 400+ cards, too many to mount at once on a phone. */
export const RESULTS_STEP = 48;

/**
 * Compare checkboxes on the cards: which products are ticked, and the toggle. Pass a stable
 * `onToggle` (it is handed to the memoized cards as is).
 */
export type CompareProps = { isChecked: (p: Product) => boolean; onToggle: (p: Product) => void };

type GridProps = { items: ViewItem[]; query?: string; compare?: CompareProps; view?: CardVariant };

function Grid({ items, query, compare, view = "grid" }: GridProps) {
  return (
    <ul className={view === "list" ? "grid grid--list" : "grid"} role="list">
      {items.map((it) => {
        const lead = leadOf(it);
        const cmp = compare && { compareChecked: compare.isChecked(lead), onCompare: compare.onToggle };
        return it.kind === "group" ? (
          <li key={it.key} className="grid__wide">
            <GroupCard group={it} query={query} {...cmp} comparedRows={compare && it.rows.filter(compare.isChecked).map(productKey).join(" ")} />
          </li>
        ) : (
          <li key={it.key}>
            <ResultCard product={it.product} query={query} variant={view} {...cmp} />
          </li>
        );
      })}
    </ul>
  );
}

const single = (p: Product): ViewItem => ({ kind: "product", key: `${p.site}+${p.id}`, product: p });

/**
 * Ranked results (rank() puts confident matches first). The less likely matches after them get
 * their own heading, so a cheaper doubtful item never reads as the best deal. `items` (cards,
 * cross-store groups included) wins over `products` (one card each).
 *
 * The cards are drawn RESULTS_STEP at a time: more follow as the reader scrolls near the end (an
 * IntersectionObserver), and "Show more results" does the same for keyboard and screen readers:
 * focus moves to the first new card and "Showing N of M results" is announced. `limit` and
 * `onLimit` let the page own the count (kept with results restored by Back or Forward).
 */
export default function ResultTiers({ products, items: given, query, compare, view, limit: owned, onLimit }: { products?: Product[]; items?: ViewItem[]; query?: string; compare?: CompareProps; view?: CardVariant; limit?: number; onLimit?: (n: number) => void }) {
  const all = given ?? (products ?? []).map(single);
  const [local, setLocal] = useState(RESULTS_STEP);
  const limit = owned ?? local;
  const latest = useRef(limit);
  useEffect(() => {
    latest.current = limit;
  }, [limit]);
  const grow = useCallback(() => {
    const next = latest.current + RESULTS_STEP;
    latest.current = next;
    if (onLimit) onLimit(next);
    else setLocal(next);
  }, [onLimit]);
  const items = all.length > limit ? all.slice(0, limit) : all;
  // Single-product cards on screen, for the optional automatic Google Shopping checks.
  const singles = useMemo(() => items.flatMap((i) => (i.kind === "product" ? [i.product] : [])), [items]);
  const more = all.length - items.length;
  const hasMore = more > 0;
  const sentinel = useRef<HTMLDivElement>(null);
  const root = useRef<HTMLDivElement>(null);
  // "Show more" pressed: the index of the first new card, focused once it is drawn.
  const focusFrom = useRef<number | null>(null);
  const [announce, setAnnounce] = useState("");
  useEffect(() => {
    const el = sentinel.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    // Re-observed after each step, so a tall screen keeps filling until the end is out of reach.
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) grow();
    }, { rootMargin: "1200px 0px" });
    io.observe(el);
    return () => io.disconnect();
  }, [limit, hasMore, grow]);
  // After every render: once the first new card is in the page, focus its first control.
  useEffect(() => {
    const from = focusFrom.current;
    if (from === null) return;
    const card = root.current?.querySelectorAll<HTMLElement>(".grid > li")[from];
    if (!card) return;
    focusFrom.current = null;
    card.querySelector<HTMLElement>("a[href]:not([tabindex='-1']), button, input")?.focus();
  });

  const split = all.findIndex((it) => !isLikelyMatch(leadOf(it)));
  const footer = hasMore ? (
    <div ref={sentinel} className="results__more">
      <Button
        variant="secondary"
        onClick={() => {
          // The cards in the page now (a scroll may have drawn more than this render knows).
          focusFrom.current = root.current?.querySelectorAll(".grid > li").length ?? items.length;
          setAnnounce(`Showing ${Math.min(all.length, items.length + RESULTS_STEP)} of ${all.length} results`);
          grow();
        }}
      >
        Show more results<span className="visually-hidden">, {more} not shown yet</span>
      </Button>
    </div>
  ) : null;
  const status = (
    <p className="visually-hidden" role="status">
      {announce}
    </p>
  );
  const tiers =
    split < 0 || split >= items.length ? (
      <Grid items={items} query={query} compare={compare} view={view} />
    ) : (
      <>
        {split > 0 && <Grid items={items.slice(0, split)} query={query} compare={compare} view={view} />}
        <div className="results__divider">
          <h3>Less likely matches</h3>
          <p className="results__note">These name your search but may be a different item, a part or an accessory.</p>
        </div>
        <Grid items={items.slice(split)} query={query} compare={compare} view={view} />
      </>
    );
  return (
    <div ref={root} className="rtiers">
      <GshopAuto products={singles} />
      {tiers}
      {footer}
      {status}
    </div>
  );
}
