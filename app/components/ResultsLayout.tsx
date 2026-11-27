"use client";

import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { NO_FILTERS, activeChips, activeCount, isActive, type ChipFilters, type Facets } from "@/src/lib/chips";
import type { SortKey } from "@/src/lib/rank";
import {
  FOCUSABLE, MEDIUM_QUERY, WIDE_QUERY, filtersButtonName, outsidePanel, panelMode, showResultsLabel, trapTab, type PanelMode, type ResultsView,
} from "@/src/lib/filter-drawer";
import FilterChips from "./FilterChips";
import { SORTS } from "./SearchForm";
import Badge from "./ui/Badge";
import Button from "./ui/Button";

function subscribe(onChange: () => void) {
  const queries = [window.matchMedia(WIDE_QUERY), window.matchMedia(MEDIUM_QUERY)];
  for (const q of queries) q.addEventListener("change", onChange);
  return () => {
    for (const q of queries) q.removeEventListener("change", onChange);
  };
}
const clientMode = (): PanelMode => panelMode(window.matchMedia(WIDE_QUERY).matches, window.matchMedia(MEDIUM_QUERY).matches);
const serverMode = (): PanelMode => "sidebar";

/** Where the filter panel lives at the current width; follows the window as it resizes. */
function usePanelMode(): PanelMode {
  return useSyncExternalStore(subscribe, clientMode, serverMode);
}

/**
 * The phone's bottom sheet: a modal <dialog>, so the page behind is inert. Tab stays inside it,
 * Esc and a tap on the scrim close it, and focus goes back to the button that opened it.
 */
function FilterSheet({ open, onClose, shown, active, onClear, children }: { open: boolean; onClose: () => void; shown: number; active: boolean; onClear: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const opener = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) {
      opener.current = document.activeElement as HTMLElement | null;
      d.showModal();
    } else if (!open && d.open) d.close();
  }, [open]);

  const close = () => ref.current?.close();
  return (
    <dialog
      ref={ref}
      className="sheet"
      aria-labelledby="sheet-title"
      onClose={() => {
        onClose();
        opener.current?.focus();
      }}
      onClick={(e) => {
        const box = panel.current?.getBoundingClientRect();
        if (e.target === e.currentTarget && box && outsidePanel(box, e.clientX, e.clientY)) close();
      }}
      onKeyDown={(e) => {
        if (e.key !== "Tab" || !ref.current) return;
        const els = [...ref.current.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => el.offsetParent !== null);
        const next = trapTab(els.length, els.indexOf(document.activeElement as HTMLElement), e.shiftKey);
        if (next !== null) {
          e.preventDefault();
          els[next].focus();
        }
      }}
    >
      <div className="sheet__panel" ref={panel}>
        <div className="sheet__head">
          <h2 id="sheet-title" className="sheet__title">
            Filters
          </h2>
          <Button size="sm" variant="ghost" onClick={close}>
            Close
          </Button>
        </div>
        <div className="sheet__body">{children}</div>
        <div className="sheet__foot">
          <Button variant="secondary" onClick={onClear} disabled={!active}>
            Clear all
          </Button>
          <Button variant="primary" onClick={close}>
            {showResultsLabel(shown)}
          </Button>
        </div>
      </div>
    </dialog>
  );
}

type Props = {
  filters: ChipFilters;
  onFilters: (next: ChipFilters) => void;
  facets: Facets;
  bounds: { min: number; max: number } | null;
  currency: string;
  kept: string[];
  sort: SortKey;
  onSort: (s: SortKey) => void;
  view: ResultsView;
  onView: (v: ResultsView) => void;
  /** Cards the filters leave (the sheet's "Show N results"). */
  shown: number;
  /** There are listings to filter; without them the toolbar and panel stay out of the way. */
  ready: boolean;
  /** The cards, skeletons or empty state. */
  children?: ReactNode;
};

/**
 * The results page around the cards: a toolbar (Filters, sort, grid or list), the active filters
 * as removable chips, and the filter panel: a sticky sidebar from 64rem, a panel the Filters button
 * folds open from 48rem, a bottom sheet below that. One copy of the panel is in the page at a time.
 */
export default function ResultsLayout({ filters: f, onFilters, facets, bounds, currency, kept, sort, onSort, view, onView, shown, ready, children }: Props) {
  const mode = usePanelMode();
  // Open in the mode it was opened in only: resizing past a breakpoint never pops the sheet open.
  const [openIn, setOpenIn] = useState<PanelMode | null>(null);
  const open = openIn === mode;
  const n = activeCount(f);
  const chips = activeChips(f, currency);

  // The toolbar sticks under the top bar, whose height wraps on a phone: keep --topbar-h true.
  useEffect(() => {
    const bar = document.querySelector<HTMLElement>(".topbar");
    if (!bar || typeof ResizeObserver === "undefined") return;
    const root = document.documentElement;
    const set = () => root.style.setProperty("--topbar-h", `${bar.offsetHeight}px`);
    set();
    const ro = new ResizeObserver(set);
    ro.observe(bar);
    return () => ro.disconnect();
  }, []);

  const panel = <FilterChips filters={f} onChange={onFilters} facets={facets} bounds={bounds} currency={currency} kept={kept} idPrefix={`facet-${mode}`} />;

  return (
    <div className="rlayout" data-mode={mode}>
      {ready && (
        <div className="rtools">
          {mode !== "sidebar" && (
            <Button
              size="sm"
              className="rtools__filters"
              aria-label={filtersButtonName(n)}
              aria-expanded={open}
              aria-controls={mode === "panel" ? "filters-panel" : undefined}
              aria-haspopup={mode === "sheet" ? "dialog" : undefined}
              onClick={() => setOpenIn(open ? null : mode)}
            >
              Filters
              {n > 0 && <Badge tone="count">{n}</Badge>}
            </Button>
          )}
          <label className="rtools__sort">
            <span className="label">Sort</span>
            <select className="input input--compact select" value={sort} onChange={(e) => onSort(e.target.value as SortKey)}>
              {SORTS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
          <div className="seg" role="group" aria-label="Show results as">
            <button type="button" className="seg__btn" aria-pressed={view === "grid"} onClick={() => onView("grid")}>
              Grid
            </button>
            <button type="button" className="seg__btn" aria-pressed={view === "list"} onClick={() => onView("list")}>
              List
            </button>
          </div>
        </div>
      )}

      {ready && chips.length > 0 && (
        <ul className="achips" role="list" aria-label="Active filters">
          {chips.map((c) => (
            <li key={c.key}>
              <button type="button" className="achip" onClick={() => onFilters(c.without)}>
                <span className="achip__label">{c.label}</span>
                <span className="achip__x" aria-hidden="true">
                  ×
                </span>
                <span className="visually-hidden">, remove this filter</span>
              </button>
            </li>
          ))}
          <li>
            <Button size="sm" variant="ghost" onClick={() => onFilters(NO_FILTERS)}>
              Clear all
            </Button>
          </li>
        </ul>
      )}

      {ready && mode === "panel" && (
        <section id="filters-panel" className="fpanel fpanel--inline" aria-label="Filters" hidden={!open}>
          {panel}
        </section>
      )}

      {/* On desktop the sidebar holds its place from the start, so the cards do not jump when it fills. */}
      <div className={mode === "sidebar" ? "rlayout__body rlayout__body--side" : "rlayout__body"}>
        {mode === "sidebar" && (
          <aside className="rside" aria-labelledby="rside-title">
            <div className="rside__head">
              <h3 id="rside-title" className="rside__title">
                Filters
              </h3>
              {ready && isActive(f) && (
                <Button size="sm" variant="ghost" onClick={() => onFilters(NO_FILTERS)}>
                  Clear all
                </Button>
              )}
            </div>
            {ready ? panel : <p className="rside__wait">Filters show once there are results to narrow.</p>}
          </aside>
        )}
        <div className={view === "list" ? "rmain rmain--list" : "rmain"}>{children}</div>
      </div>

      {ready && mode === "sheet" && (
        <FilterSheet open={open} onClose={() => setOpenIn(null)} shown={shown} active={isActive(f)} onClear={() => onFilters(NO_FILTERS)}>
          {panel}
        </FilterSheet>
      )}
    </div>
  );
}
