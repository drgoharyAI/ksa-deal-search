"use client";

import { useState } from "react";
import type { SortKey } from "@/src/lib/rank";
import { STORES } from "@/src/lib/stores";
import QueryCombobox from "./QueryCombobox";
import Button from "./ui/Button";
import Chip from "./ui/Chip";
import Input from "./ui/Input";
import StoreMark from "./ui/StoreMark";

export type FormValues = {
  query: string;
  sites: string[];
  sort: SortKey;
  minPrice: string;
  maxPrice: string;
  minRating: string;
};

export type ErrorField = "query" | "sites" | "form" | null;

export const SORTS: { value: SortKey; label: string }[] = [
  { value: "price", label: "Lowest price" },
  { value: "discount", label: "Highest discount" },
  { value: "deal", label: "Best deal" },
];

/** Helper line for the real-browser stores (each loads pages in Chrome). */
function slowNote(sites: string[]): string {
  const slow = [sites.includes("noon-sa") && "noon", sites.includes("shein-sa") && "SHEIN"].filter(Boolean);
  return slow.length ? `With ${slow.join(" and ")} a search takes 10 to 25 seconds.` : "";
}

type Props = {
  values: FormValues;
  onChange: (next: FormValues) => void;
  /** Run the search; `query` overrides values.query (a picked suggestion not yet in state). */
  onSubmit: (query?: string) => void;
  onStop: () => void;
  loading: boolean;
  error: string | null;
  errorField: ErrorField;
  /**
   * The results page's compact header: the query stays editable in place; stores, price and rating
   * fold behind one line, and the sort moves to the results toolbar.
   */
  compact?: boolean;
};

export default function SearchForm({ values, onChange, onSubmit, onStop, loading, error, errorField, compact = false }: Props) {
  const set = <K extends keyof FormValues>(key: K, v: FormValues[K]) => onChange({ ...values, [key]: v });
  const toggleSite = (id: string, on: boolean) =>
    set(
      "sites",
      STORES.map((s) => s.id).filter((s) => (s === id ? on : values.sites.includes(s))),
    );
  const queryError = errorField === "query" ? error : null;
  const sitesError = errorField === "sites" ? error : null;
  // Controlled through onToggle. The options also open by themselves when one becomes set (a
  // History re-run), so a value is never hidden; adjusted during render, not in an effect.
  const optionsSet = values.sort !== "price" || !!values.minPrice || !!values.maxPrice || !!values.minRating;
  const [optionsOpen, setOptionsOpen] = useState(optionsSet);
  const [wasSet, setWasSet] = useState(optionsSet);
  if (optionsSet !== wasSet) {
    setWasSet(optionsSet);
    if (optionsSet) setOptionsOpen(true);
  }
  const [moreOpen, setMoreOpen] = useState(false);

  const storesField = (
    <fieldset className="stores" aria-describedby="stores-help" aria-invalid={sitesError ? true : undefined}>
      <legend className="label">
        Stores <span className="stores__count">{`${values.sites.length} of ${STORES.length} on`}</span>
      </legend>
      <div className="stores__list">
        {STORES.map((s) => (
          <Chip
            key={s.id}
            kind="checkbox"
            className="chip--store"
            name="sites"
            value={s.id}
            checked={values.sites.includes(s.id)}
            onChange={(on) => toggleSite(s.id, on)}
            describedBy={"note" in s ? `store-note-${s.id}` : undefined}
          >
            <StoreMark id={s.id} size={22} />
            {"note" in s && (
              <span id={`store-note-${s.id}`} className="chip__note">
                {s.note}
              </span>
            )}
          </Chip>
        ))}
      </div>
      <p id="stores-help" className={sitesError ? "helper helper--error" : "helper"}>
        {sitesError ?? slowNote(values.sites)}
      </p>
    </fieldset>
  );

  const priceRatingFields = (
    <>
      <div className="field">
        <label htmlFor="min-price" className="label">
          Min price, SAR
        </label>
        <Input id="min-price" name="minPrice" type="number" inputMode="decimal" min={0} step="any" autoComplete="off" value={values.minPrice} onChange={(e) => set("minPrice", e.target.value)} />
      </div>
      <div className="field">
        <label htmlFor="max-price" className="label">
          Max price, SAR
        </label>
        <Input id="max-price" name="maxPrice" type="number" inputMode="decimal" min={0} step="any" autoComplete="off" value={values.maxPrice} onChange={(e) => set("maxPrice", e.target.value)} />
      </div>
      <div className="field">
        <label htmlFor="min-rating" className="label">
          Min rating, 0 to 5
        </label>
        <Input id="min-rating" name="minRating" type="number" inputMode="decimal" min={0} max={5} step={0.1} autoComplete="off" value={values.minRating} onChange={(e) => set("minRating", e.target.value)} />
      </div>
    </>
  );

  return (
    <form
      className={compact ? "search search--compact" : "search"}
      aria-label="Search the stores"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit();
      }}
    >
      <div className="field field--query">
        <label htmlFor="q" className={compact ? "visually-hidden" : "label"}>
          What are you looking for?
        </label>
        <div className="search__row">
          <QueryCombobox
            value={values.query}
            onChange={(q) => set("query", q)}
            onSubmit={onSubmit}
            loading={loading}
            invalid={!!queryError}
            describedBy="q-help"
          />
          <Button type="submit" variant="primary" size="lg" loading={loading}>
            {loading ? "Searching" : "Search"}
          </Button>
          {loading && (
            <Button variant="secondary" size="lg" onClick={onStop}>
              Stop
            </Button>
          )}
        </div>
        <p id="q-help" className={queryError ? "helper helper--error" : "helper"}>
          {queryError ??
            (compact ? null : (
              <>
                Filters work in the query too: <code>under 300</code>, <code>-case</code>, <code>&gt;4 stars</code>.
              </>
            ))}
        </p>
      </div>

      {compact ? (
        <details className="options options--compact" open={moreOpen || !!sitesError} onToggle={(e) => setMoreOpen(e.currentTarget.open)}>
          <summary className="options__toggle">
            Stores and search options{" "}
            <span className="stores__count">
              {`${values.sites.length} of ${STORES.length} stores on${values.minPrice || values.maxPrice || values.minRating ? ", price or rating set" : ""}`}
            </span>
          </summary>
          <div className="options__body">
            {storesField}
            <div className="filters filters--compact">{priceRatingFields}</div>
            <p className="helper">Changes here apply when you search again.</p>
          </div>
        </details>
      ) : (
        <>
          {storesField}
          <details className="options" open={optionsOpen} onToggle={(e) => setOptionsOpen(e.currentTarget.open)}>
            <summary className="options__toggle">Sort, price and rating</summary>
            <div className="filters">
              <div className="field">
                <label htmlFor="sort" className="label">
                  Sort by
                </label>
                <select id="sort" name="sort" className="input select" value={values.sort} onChange={(e) => set("sort", e.target.value as SortKey)}>
                  {SORTS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </div>
              {priceRatingFields}
            </div>
          </details>
        </>
      )}
    </form>
  );
}
