"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Product, SiteStatus } from "@/src/lib/types";
import { defaultSites } from "@/src/lib/stores";
import SearchForm, { type ErrorField, type FormValues } from "./components/SearchForm";
import StatusBar from "./components/StatusBar";
import ResultTiers from "./components/ResultTiers";
import AppHeader from "./components/AppHeader";
import WatchForm, { postWatch } from "./components/WatchForm";
import { cheapestConfident, defaultTarget, priceOf } from "@/src/lib/alerts/shared";
import { valuesFromUrl } from "@/src/lib/rerun";
import FilterChips from "./components/FilterChips";
import { CompareDialog, CompareTray } from "./components/Compare";
import {
  NO_FILTERS, chipContext, chipParamsOnly, chipsForNewQuery, facetCountsFor, filtersFromSearch, isActive, priceBounds,
  withChipParams, type ChipFilters,
} from "@/src/lib/chips";
import { toggleCompare } from "@/src/lib/compare";
import { productKey } from "@/src/lib/specs";
import { allMembers, buildUnits, viewItems } from "@/src/lib/view";
import type { GroupRef } from "@/src/lib/match/group";

type Results = {
  products: Product[];
  /** The same product at several stores (ids), and members missing from `products`. */
  groups: GroupRef[];
  groupExtras: Product[];
  statuses: SiteStatus[];
  reason?: string;
  query: string;
  sites: string[];
  /** The form filters this search ran with; a "Watch this search" keeps them. */
  filters: { minPrice?: number; maxPrice?: number; minRating?: number };
};
type Phase = "idle" | "loading" | "done" | "error";

const INITIAL: FormValues = {
  query: "",
  sites: defaultSites(),
  sort: "price",
  minPrice: "",
  maxPrice: "",
  minRating: "",
};

const SKELETONS = 10;

const NO_COMPARE: { list: Product[]; full: boolean } = { list: [], full: false };

const toNum = (s: string): number | undefined => {
  const t = s.trim();
  if (!t) return undefined;
  const n = Number(t);
  return Number.isFinite(n) ? n : undefined;
};

const fieldFor = (msg: string): ErrorField =>
  msg === "Pick at least one store" ? "sites" : msg === "Enter something to search for" || msg === "Search is too long" ? "query" : "form";

export default function Home() {
  const [values, setValues] = useState<FormValues>(INITIAL);
  const [phase, setPhase] = useState<Phase>("idle");
  const [results, setResults] = useState<Results | null>(null);
  const [pending, setPending] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [errorField, setErrorField] = useState<ErrorField>(null);
  const abortRef = useRef<AbortController | null>(null);
  const [watchOpen, setWatchOpen] = useState(false);
  const [watchSaved, setWatchSaved] = useState(false);
  // Quick filter chips: client-side over the current results, kept in the URL (never a new search).
  const [chips, setChips] = useState<ChipFilters>(NO_FILTERS);
  const [chipsRead, setChipsRead] = useState(false);
  /** Chips carried over from the previous query (rating, discounted); named in a note. */
  const [keptChips, setKeptChips] = useState<("rating" | "discounted")[]>([]);
  // One state, so the toggle below can be one stable function for every (memoized) card.
  const [cmp, setCmp] = useState<{ list: Product[]; full: boolean }>(NO_COMPARE);
  const compareList = cmp.list;
  const compareFull = cmp.full;
  const [compareOpen, setCompareOpen] = useState(false);

  useEffect(() => () => abortRef.current?.abort(), []);

  // A History "Re-run" link: fill the form from the URL, clean the URL, and search once.
  // The chip filters come back from the URL too (a refresh or Back keeps them).
  useEffect(() => {
    const qs = window.location.search;
    // Read once after hydration (the server render has no URL state); not a cascade.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setChips(filtersFromSearch(qs));
    setChipsRead(true);
    const fromUrl = valuesFromUrl(qs, INITIAL);
    if (!fromUrl) return;
    window.history.replaceState(null, "", window.location.pathname + chipParamsOnly(qs));
    setValues(fromUrl.values);
    if (fromUrl.run) void search(undefined, fromUrl.values);
    // Runs once on mount by design.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Chip changes write the URL in place (replaceState: no history entry, no request).
  useEffect(() => {
    if (!chipsRead) return;
    const next = withChipParams(window.location.search, chips);
    if (next !== window.location.search) window.history.replaceState(null, "", window.location.pathname + next);
  }, [chips, chipsRead]);

  // Cards: a cross-store group is one card, every other product one card. Chips narrow the cards
  // (a group passes when any member does), then sort and the match tiers apply; no new request.
  const units = useMemo(() => (results ? buildUnits(results.products, results.groups, results.groupExtras) : []), [results]);
  const all = useMemo(() => allMembers(units), [units]);
  const chipCtx = useMemo(() => chipContext(all), [all]);
  const facets = useMemo(() => facetCountsFor(units.map((u) => u.members), chips, chipCtx), [units, chips, chipCtx]);
  const bounds = useMemo(() => priceBounds(all), [all]);
  const items = useMemo(() => viewItems(units, chips, chipCtx, values.sort), [units, chips, chipCtx, values.sort]);
  const filtering = isActive(chips) && all.length > 0;
  const kept = keptChips.filter((k) => (k === "rating" ? chips.minRating !== undefined : chips.discounted));
  // The live region hears "N of M results" once a change settles (a dragged slider fires many).
  const filterLive = filtering ? `${items.length} of ${units.length} results` : "";
  const [liveFilter, setLiveFilter] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setLiveFilter(filterLive), 400);
    return () => clearTimeout(t);
  }, [filterLive]);
  const compareKeys = useMemo(() => new Set(compareList.map(productKey)), [compareList]);
  const onToggleCompare = useCallback((p: Product) => setCmp((c) => toggleCompare(c.list, p)), []);
  const compare = useMemo(() => ({ isChecked: (p: Product) => compareKeys.has(productKey(p)), onToggle: onToggleCompare }), [compareKeys, onToggleCompare]);
  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    // Every listing shown, group rows included (a twin deduped out of `products` is still a result).
    for (const p of all) c[p.site] = (c[p.site] ?? 0) + 1;
    return c;
  }, [all]);

  const fail = (msg: string) => {
    setError(msg);
    setErrorField(fieldFor(msg));
    setPhase("error");
    setPending(null);
  };

  async function search(query?: string, base: FormValues = values) {
    abortRef.current?.abort();
    abortRef.current = null;
    // A picked suggestion (or a re-run from History) is passed in because the state update has not landed yet.
    const v = query === undefined ? base : { ...base, query };
    if (!v.query.trim()) {
      fail("Enter something to search for");
      return;
    }
    if (!v.sites.length) {
      fail("Pick at least one store");
      return;
    }

    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setError(null);
    setErrorField(null);
    setPhase("loading");
    setPending(v.sites);
    // A new query drops the store, brand and price chips of the old results (not on a History re-run).
    const carried = chipsForNewQuery(chips, results?.query, v.query);
    if (carried.filters !== chips) setChips(carried.filters);
    setKeptChips(carried.kept);

    const body = {
      query: v.query,
      sites: v.sites,
      sort: v.sort,
      minPrice: toNum(v.minPrice),
      maxPrice: toNum(v.maxPrice),
      minRating: toNum(v.minRating),
    };
    try {
      const res = await fetch("/api/search", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
        signal: ctrl.signal,
      });
      const data = (await res.json().catch(() => null)) as (Omit<Results, "query" | "sites" | "filters"> & { error?: string }) | null;
      if (ctrl.signal.aborted) return;
      if (!res.ok || !data || !Array.isArray(data.products)) {
        fail(data?.error ?? "The search failed; try again");
        return;
      }
      setResults({ products: data.products, groups: Array.isArray(data.groups) ? data.groups : [], groupExtras: Array.isArray(data.groupExtras) ? data.groupExtras : [], statuses: data.statuses ?? [], reason: data.reason, query: v.query.trim(), sites: v.sites, filters: { minPrice: body.minPrice, maxPrice: body.maxPrice, minRating: body.minRating } });
      setWatchOpen(false);
      setWatchSaved(false);
      setCmp(NO_COMPARE);
      setPending(null);
      setPhase("done");
    } catch (e) {
      if (ctrl.signal.aborted || (e instanceof DOMException && e.name === "AbortError")) return;
      fail("Could not reach the search server; check it is running and try again");
    } finally {
      if (abortRef.current === ctrl) abortRef.current = null;
    }
  }

  function stop() {
    abortRef.current?.abort();
    abortRef.current = null;
    setPending(null);
    setPhase(results ? "done" : "idle");
  }

  const loading = phase === "loading";
  const cheapest = useMemo(() => (all.length ? cheapestConfident(all) : null), [all]);
  const formError = errorField === "form" ? error : null;

  let live = "";
  if (loading) live = `Searching ${values.sites.length} ${values.sites.length === 1 ? "store" : "stores"}`;
  else if (phase === "error" && error) live = error;
  else if (phase === "done" && results && filtering) live = liveFilter;
  else if (phase === "done" && results) live = items.length ? `${items.length} results` : (results.reason ?? "");

  return (
    <div className="app">
      <AppHeader current="search" />

      <main className="container main">
        <SearchForm
          values={values}
          onChange={setValues}
          onSubmit={(q) => void search(q)}
          onStop={stop}
          loading={loading}
          error={error}
          errorField={errorField}
        />

        <p className="visually-hidden" role="status" aria-live="polite">
          {live}
        </p>

        {formError && (
          <p className="notice notice--error" role="alert">
            {formError}
          </p>
        )}

        <StatusBar pending={loading ? pending : null} statuses={results?.statuses ?? []} counts={counts} />

        <section className="results" aria-labelledby="results-head" aria-busy={loading || undefined}>
          <div className="results__head">
            <h2 id="results-head">
              {loading ? "Searching" : results && filtering ? `${items.length} of ${units.length} results` : results && items.length ? `${items.length} results` : "Results"}
            </h2>
            {!loading && results && items.length > 0 && <p className="results__note">Prices exclude shipping</p>}
            {!loading && results && cheapest && !watchOpen && !watchSaved && (
              <button type="button" className="btn btn--quiet btn--small" onClick={() => setWatchOpen(true)}>
                Watch this search
              </button>
            )}
            {/* Always in the page, so screen readers announce the text when it changes. */}
            <p className={!loading && watchSaved ? "results__note" : "visually-hidden"} role="status">
              {!loading && watchSaved && (
                <>
                  Watching this search. <a href="/alerts">See alerts</a>
                </>
              )}
            </p>
          </div>
          {!loading && results && cheapest && watchOpen && (
            <WatchForm
              label={`Alert me when a match is at or under, ${cheapest.currency || "SAR"}`}
              initial={defaultTarget(priceOf(cheapest))}
              onCancel={() => setWatchOpen(false)}
              onSave={async (target) => {
                const err = await postWatch({ kind: "search", query: results.query, sites: results.sites, target, filters: results.filters });
                if (!err) {
                  setWatchOpen(false);
                  setWatchSaved(true);
                }
                return err;
              }}
            />
          )}

          {!loading && all.length > 0 && <FilterChips filters={chips} onChange={setChips} facets={facets} bounds={bounds} currency={all[0].currency || "SAR"} kept={kept} />}

          {loading ? (
            <ul className="grid" aria-hidden="true">
              {Array.from({ length: SKELETONS }, (_, i) => (
                <li key={i} className="card card--skeleton">
                  <div className="card__media skeleton" />
                  <div className="card__body">
                    <span className="skeleton skeleton--line" />
                    <span className="skeleton skeleton--line skeleton--short" />
                    <span className="skeleton skeleton--price" />
                  </div>
                </li>
              ))}
            </ul>
          ) : results && items.length ? (
            <ResultTiers items={items} query={results.query} compare={compare} />
          ) : results && filtering ? (
            <div className="empty">
              <p className="empty__title">No results match these filters</p>
              <p className="empty__body">Loosen a filter above, or clear them all.</p>
              <div>
                <button type="button" className="btn btn--quiet btn--small" onClick={() => setChips(NO_FILTERS)}>
                  Clear all filters
                </button>
              </div>
            </div>
          ) : results ? (
            <div className="empty">
              <p className="empty__title">{results.reason ?? "No products matched your search and filters"}</p>
              <p className="empty__body">Try fewer words, another store, or looser price and rating filters.</p>
            </div>
          ) : (
            <div className="empty">
              <p className="empty__title">Nothing searched yet</p>
              <p className="empty__body">Type a product above and press Search to compare prices across the stores you picked.</p>
            </div>
          )}
        </section>
      </main>

      <CompareTray
        items={compareList}
        full={compareFull}
        onRemove={(p) => setCmp((c) => ({ list: c.list.filter((x) => productKey(x) !== productKey(p)), full: false }))}
        onClear={() => setCmp(NO_COMPARE)}
        onOpen={() => setCompareOpen(true)}
      />
      <CompareDialog items={compareList} open={compareOpen} onClose={() => setCompareOpen(false)} />
    </div>
  );
}
