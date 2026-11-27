"use client";

import { useState, type CSSProperties } from "react";
import type { ChipFilters, Facets } from "@/src/lib/chips";
import { brandLabel } from "@/src/lib/specs";
import Button from "./ui/Button";
import Chip from "./ui/Chip";
import Input from "./ui/Input";
import StoreMark from "./ui/StoreMark";

/** Brands shown before "More brands". */
const TOP_BRANDS = 12;

type Props = {
  filters: ChipFilters;
  onChange: (next: ChipFilters) => void;
  facets: Facets;
  /** Whole-SAR bounds of the current results' prices. */
  bounds: { min: number; max: number } | null;
  currency?: string;
  /** Filters kept from the previous query (rating, discounted, deals), named in a short note. */
  kept?: string[];
  /** Prefix for ids, so two copies of the panel never share one (sidebar and sheet are never both shown). */
  idPrefix?: string;
};

const toggle = (xs: string[], x: string) => (xs.includes(x) ? xs.filter((y) => y !== x) : [...xs, x]);

/** A count after a chip's name; screen readers hear "12 results". */
function Count({ n }: { n: number }) {
  return (
    <span className="fchip__count">
      {n}
      <span className="visually-hidden"> {n === 1 ? "result" : "results"}</span>
    </span>
  );
}

/**
 * The filters over the current results: instant and client-side (no new request). Each option
 * shows how many results it would leave given the other active filters. A group of options shows
 * only when the results carry that data: no rating filter without ratings, no deal filter without
 * a deal our history backs.
 */
export default function FilterChips({ filters: f, onChange, facets, bounds, currency = "SAR", kept = [], idPrefix = "facet" }: Props) {
  const [moreBrands, setMoreBrands] = useState(false);
  const set = (patch: Partial<ChipFilters>) => onChange({ ...f, ...patch });

  const top = facets.brands.slice(0, TOP_BRANDS);
  const rest = facets.brands.slice(TOP_BRANDS);
  // A selected brand past the top 12 stays visible while the list is folded.
  const shownBrands = moreBrands ? facets.brands : [...top, ...rest.filter((b) => f.brands.includes(b.id))];
  const hiddenCount = facets.brands.length - shownBrands.length;

  const lo = Math.max(bounds?.min ?? 0, Math.min(f.minPrice ?? bounds?.min ?? 0, bounds?.max ?? 0));
  const hi = Math.min(bounds?.max ?? 0, Math.max(f.maxPrice ?? bounds?.max ?? 0, bounds?.min ?? 0));
  const setLo = (v: number) => set({ minPrice: bounds && v <= bounds.min ? undefined : Math.min(v, hi) });
  const setHi = (v: number) => set({ maxPrice: bounds && v >= bounds.max ? undefined : Math.max(v, lo) });
  const typed = (s: string): number | undefined => {
    const n = s.trim() === "" ? NaN : Number(s);
    return Number.isFinite(n) && n >= 0 ? n : undefined;
  };

  const showRating = facets.rated > 0 || f.minRating !== undefined;
  const showDiscounted = facets.discounted > 0 || f.discounted;
  const showDeals = facets.deals > 0 || !!f.deals;

  return (
    <div className="facets">
      {kept.length > 0 && <p className="facets__note">Filters kept from your last search: {kept.join(", ")}</p>}

      {facets.stores.length > 1 && (
        <fieldset className="facet">
          <legend className="facet__legend">Store</legend>
          <div className="facet__options facet__options--stack">
            {facets.stores.map((s) => (
              <Chip key={s.id} kind="checkbox" className="fchip" checked={f.stores.includes(s.id)} onChange={() => set({ stores: toggle(f.stores, s.id) })}>
                <StoreMark id={s.id} size={18} />
                <Count n={s.count} />
              </Chip>
            ))}
          </div>
        </fieldset>
      )}

      {bounds && bounds.max > bounds.min && (
        <fieldset className="facet">
          <legend className="facet__legend">Price, {currency}</legend>
          <div className="facet__price">
            <div className="range" style={{ "--lo": (lo - bounds.min) / (bounds.max - bounds.min), "--hi": (hi - bounds.min) / (bounds.max - bounds.min) } as CSSProperties}>
              <input
                type="range"
                className="range__input"
                // Thumbs meeting mid-range: the low one goes on top so it can still be dragged down.
                style={lo >= hi - 1 && hi > bounds.min ? { zIndex: 2 } : undefined}
                aria-valuetext={`${currency} ${lo}`}
                aria-label="Lowest price"
                min={bounds.min}
                max={bounds.max}
                step={1}
                value={lo}
                onChange={(e) => setLo(Number(e.target.value))}
              />
              <input type="range" className="range__input" aria-valuetext={`${currency} ${hi}`} aria-label="Highest price" min={bounds.min} max={bounds.max} step={1} value={hi} onChange={(e) => setHi(Number(e.target.value))} />
            </div>
            <div className="range__fields">
              <label className="range__field">
                <span className="label">From</span>
                <Input size="compact" type="number" inputMode="decimal" min={0} placeholder={String(bounds.min)} value={f.minPrice ?? ""} onChange={(e) => set({ minPrice: typed(e.target.value) })} />
              </label>
              <label className="range__field">
                <span className="label">To</span>
                <Input size="compact" type="number" inputMode="decimal" min={0} placeholder={String(bounds.max)} value={f.maxPrice ?? ""} onChange={(e) => set({ maxPrice: typed(e.target.value) })} />
              </label>
            </div>
          </div>
        </fieldset>
      )}

      {showRating && (
        <fieldset className="facet">
          <legend className="facet__legend">Minimum rating</legend>
          <div className="facet__options">
            {facets.ratings.map((r) => (
              <Chip key={r.min ?? "any"} kind="toggle" className="fchip" pressed={f.minRating === r.min} onToggle={() => set({ minRating: r.min })}>
                <span className="chip__name">
                  {r.min === undefined ? "Any" : `${r.min}+`}
                  {r.min !== undefined && <span className="visually-hidden"> stars and up</span>}
                </span>
                <Count n={r.count} />
              </Chip>
            ))}
          </div>
        </fieldset>
      )}

      {(showDiscounted || showDeals) && (
        <fieldset className="facet">
          <legend className="facet__legend">Deals</legend>
          <div className="facet__options facet__options--stack">
            {showDiscounted && (
              <Chip kind="toggle" className="fchip" pressed={f.discounted} onToggle={() => set({ discounted: !f.discounted })}>
                <span className="chip__name">Only discounted</span>
                <Count n={facets.discounted} />
              </Chip>
            )}
            {showDeals && (
              <Chip kind="toggle" className="fchip" pressed={!!f.deals} onToggle={() => set({ deals: !f.deals })}>
                <span className="chip__name">
                  Verified deals
                  <span className="visually-hidden">, lowest in 30 days or below the usual price, from our price history</span>
                </span>
                <Count n={facets.deals} />
              </Chip>
            )}
          </div>
        </fieldset>
      )}

      {facets.brands.length > 0 && (
        <fieldset className="facet">
          <legend className="facet__legend">Brand</legend>
          <div className="facet__options" id={`${idPrefix}-brands`}>
            {shownBrands.map((b) => (
              <Chip key={b.id} kind="checkbox" className="fchip" checked={f.brands.includes(b.id)} onChange={() => set({ brands: toggle(f.brands, b.id) })}>
                <span className="chip__name">{brandLabel(b.id)}</span>
                <Count n={b.count} />
              </Chip>
            ))}
            {(hiddenCount > 0 || moreBrands) && rest.length > 0 && (
              <Button size="sm" variant="ghost" aria-expanded={moreBrands} aria-controls={`${idPrefix}-brands`} onClick={() => setMoreBrands(!moreBrands)}>
                {moreBrands ? "Fewer brands" : `More brands (${hiddenCount})`}
              </Button>
            )}
          </div>
        </fieldset>
      )}
    </div>
  );
}
