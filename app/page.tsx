"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { rank } from "@/src/lib/rank";
import type { Product, SiteStatus } from "@/src/lib/types";
import { defaultSites } from "@/src/lib/stores";
import SearchForm, { type ErrorField, type FormValues } from "./components/SearchForm";
import StatusBar from "./components/StatusBar";
import ResultTiers from "./components/ResultTiers";
import AppHeader from "./components/AppHeader";
import WatchForm, { postWatch } from "./components/WatchForm";
import { cheapestConfident, defaultTarget, priceOf } from "@/src/lib/alerts/shared";
import { valuesFromUrl } from "@/src/lib/rerun";

type Results = { products: Product[]; statuses: SiteStatus[]; reason?: string; query: string; sites: string[] };
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

  useEffect(() => () => abortRef.current?.abort(), []);

  // A History "Re-run" link: fill the form from the URL, clean the URL, and search once.
  useEffect(() => {
    const fromUrl = valuesFromUrl(window.location.search, INITIAL);
    if (!fromUrl) return;
    window.history.replaceState(null, "", window.location.pathname);
    setValues(fromUrl.values);
    if (fromUrl.run) void search(undefined, fromUrl.values);
    // Runs once on mount by design.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Sort changes re-rank the current results in place; no new request.
  const products = useMemo(() => (results ? rank(results.products, values.sort) : []), [results, values.sort]);
  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const p of results?.products ?? []) c[p.site] = (c[p.site] ?? 0) + 1;
    return c;
  }, [results]);

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
    if (!v.query.trim()) return fail("Enter something to search for");
    if (!v.sites.length) return fail("Pick at least one store");

    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setError(null);
    setErrorField(null);
    setPhase("loading");
    setPending(v.sites);

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
      const data = (await res.json().catch(() => null)) as (Results & { error?: string }) | null;
      if (ctrl.signal.aborted) return;
      if (!res.ok || !data || !Array.isArray(data.products)) {
        return fail(data?.error ?? "The search failed; try again");
      }
      setResults({ products: data.products, statuses: data.statuses ?? [], reason: data.reason, query: v.query.trim(), sites: v.sites });
      setWatchOpen(false);
      setWatchSaved(false);
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
  const cheapest = useMemo(() => (results ? cheapestConfident(results.products) : null), [results]);
  const formError = errorField === "form" ? error : null;

  let live = "";
  if (loading) live = `Searching ${values.sites.length} ${values.sites.length === 1 ? "store" : "stores"}`;
  else if (phase === "error" && error) live = error;
  else if (phase === "done" && results) live = products.length ? `${products.length} results` : (results.reason ?? "");

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
            <h2 id="results-head">{loading ? "Searching" : results && products.length ? `${products.length} results` : "Results"}</h2>
            {!loading && results && products.length > 0 && <p className="results__note">Prices exclude shipping</p>}
            {!loading && results && cheapest && !watchOpen && !watchSaved && (
              <button type="button" className="btn btn--quiet btn--small" onClick={() => setWatchOpen(true)}>
                Watch this search
              </button>
            )}
            {!loading && watchSaved && (
              <p className="results__note" role="status">
                Watching this search. <a href="/alerts">See alerts</a>
              </p>
            )}
          </div>
          {!loading && results && cheapest && watchOpen && (
            <WatchForm
              label={`Alert me when a match is at or under, ${cheapest.currency || "SAR"}`}
              initial={defaultTarget(priceOf(cheapest))}
              onCancel={() => setWatchOpen(false)}
              onSave={async (target) => {
                const err = await postWatch({ kind: "search", query: results.query, sites: results.sites, target });
                if (!err) {
                  setWatchOpen(false);
                  setWatchSaved(true);
                }
                return err;
              }}
            />
          )}

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
          ) : results && products.length ? (
            <ResultTiers products={products} query={results.query} />
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
    </div>
  );
}
