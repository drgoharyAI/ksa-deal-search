"use client";

import { useState, type CSSProperties } from "react";
import { NO_FILTERS, isActive, type ChipFilters, type Facets } from "@/src/lib/chips";
import { storeLabel } from "@/src/lib/stores";
import { brandLabel } from "@/src/lib/specs";
import StoreLogo from "./StoreLogo";

/** Brands shown before "More brands". */
export const TOP_BRANDS = 12;

type Props = {
  filters: ChipFilters;
  onChange: (next: ChipFilters) => void;
  facets: Facets;
  /** Whole-SAR bounds of the current results' prices. */
  bounds: { min: number; max: number } | null;
  currency?: string;
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
 * Quick filters over the current results: instant and client-side (no new request). Each option
 * shows how many results it would leave given the other active filters.
 */
export default function FilterChips({ filters: f, onChange, facets, bounds, currency = "SAR" }: Props) {
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

  return (
    <section className="facets" aria-label="Filter these results">
      {facets.stores.length > 1 && (
        <fieldset className="facet">
          <legend className="facet__legend">Store</legend>
          <div className="facet__options">
            {facets.stores.map((s) => (
              <label key={s.id} className="chip fchip">
                <input type="checkbox" checked={f.stores.includes(s.id)} onChange={() => set({ stores: toggle(f.stores, s.id) })} />
                <StoreLogo id={s.id} size={18} />
                <span className="chip__name">{storeLabel(s.id)}</span>
                <Count n={s.count} />
              </label>
            ))}
          </div>
        </fieldset>
      )}

      {facets.brands.length > 0 && (
        <fieldset className="facet">
          <legend className="facet__legend">Brand</legend>
          <div className="facet__options" id="facet-brands">
            {shownBrands.map((b) => (
              <label key={b.id} className="chip fchip">
                <input type="checkbox" checked={f.brands.includes(b.id)} onChange={() => set({ brands: toggle(f.brands, b.id) })} />
                <span className="chip__name">{brandLabel(b.id)}</span>
                <Count n={b.count} />
              </label>
            ))}
            {(hiddenCount > 0 || moreBrands) && rest.length > 0 && (
              <button type="button" className="btn btn--quiet btn--small" aria-expanded={moreBrands} aria-controls="facet-brands" onClick={() => setMoreBrands(!moreBrands)}>
                {moreBrands ? "Fewer brands" : `More brands (${hiddenCount})`}
              </button>
            )}
          </div>
        </fieldset>
      )}

      {bounds && bounds.max > bounds.min && (
        <fieldset className="facet">
          <legend className="facet__legend">Price, {currency}</legend>
          <div className="facet__options facet__price">
            <div className="range" style={{ "--lo": (lo - bounds.min) / (bounds.max - bounds.min), "--hi": (hi - bounds.min) / (bounds.max - bounds.min) } as CSSProperties}>
              <input type="range" className="range__input" aria-label="Lowest price" min={bounds.min} max={bounds.max} step={1} value={lo} onChange={(e) => setLo(Number(e.target.value))} />
              <input type="range" className="range__input" aria-label="Highest price" min={bounds.min} max={bounds.max} step={1} value={hi} onChange={(e) => setHi(Number(e.target.value))} />
            </div>
            <label className="range__field">
              <span className="label">From</span>
              <input className="input input--compact" type="number" inputMode="decimal" min={0} placeholder={String(bounds.min)} value={f.minPrice ?? ""} onChange={(e) => set({ minPrice: typed(e.target.value) })} />
            </label>
            <label className="range__field">
              <span className="label">To</span>
              <input className="input input--compact" type="number" inputMode="decimal" min={0} placeholder={String(bounds.max)} value={f.maxPrice ?? ""} onChange={(e) => set({ maxPrice: typed(e.target.value) })} />
            </label>
          </div>
        </fieldset>
      )}

      <fieldset className="facet">
        <legend className="facet__legend">Rating</legend>
        <div className="facet__options">
          {facets.ratings.map((r) => (
            <button key={r.min ?? "any"} type="button" className="chip fchip" aria-pressed={f.minRating === r.min} onClick={() => set({ minRating: r.min })}>
              <span className="chip__name">
                {r.min === undefined ? "Any" : `${r.min}+`}
                {r.min !== undefined && <span className="visually-hidden"> stars and up</span>}
              </span>
              <Count n={r.count} />
            </button>
          ))}
        </div>
      </fieldset>

      <div className="facets__actions">
        <button type="button" className="chip fchip" aria-pressed={f.discounted} onClick={() => set({ discounted: !f.discounted })}>
          <span className="chip__name">Only discounted</span>
          <Count n={facets.discounted} />
        </button>
        {isActive(f) && (
          <button type="button" className="btn btn--quiet btn--small" onClick={() => onChange(NO_FILTERS)}>
            Clear all filters
          </button>
        )}
      </div>
    </section>
  );
}
