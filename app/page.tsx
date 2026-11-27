"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Product } from "@/src/lib/types";
import { STORES, defaultSites } from "@/src/lib/stores";
import SearchForm, { type ErrorField, type FormValues } from "./components/SearchForm";
import StatusBar from "./components/StatusBar";
import ResultTiers from "./components/ResultTiers";
import AppHeader, { GO_HOME_EVENT } from "./components/AppHeader";
import AppFooter from "./components/AppFooter";
import HomeSuggestions from "./components/HomeSuggestions";
import HomeDiscover from "./components/HomeDiscover";
import Button from "./components/ui/Button";
import EmptyState from "./components/ui/EmptyState";
import ErrorState from "./components/ui/ErrorState";
import { SkeletonCard } from "./components/ui/Skeleton";
import WatchForm, { postWatch } from "./components/WatchForm";
import { cheapestConfident, defaultTarget, priceOf } from "@/src/lib/alerts/shared";
import { HOME_ENTRY, historyMove } from "@/src/lib/rerun";
import { parseShare, runOnce, shareSearch } from "@/src/lib/share";
import CopyLink from "./components/CopyLink";
import RecentlyViewed from "./components/RecentlyViewed";
import { SavedContext, useFavourites } from "./components/Saved";
import { DetailsContext, type DetailsSource } from "./components/CardDetails";
import { relatedListings } from "@/src/lib/match/related";
import ResultsLayout from "./components/ResultsLayout";
import { CompareDialog, CompareTray } from "./components/Compare";
import {
  NO_FILTERS, activeChips, chipContext, chipsForNewQuery, facetCountsFor, filtersFromSearch, isActive, priceBounds,
  withChipParams, type ChipFilters, type KeptChip,
} from "@/src/lib/chips";
import { browserStorage, readView, writeView, type ResultsView } from "@/src/lib/filter-drawer";
import {
  MIN_COMPARE, keysFromSearch, readMemory, resolveSelection, sessionStore, toggleKey, withCompareParam, writeMemory, type CompareMemory,
} from "@/src/lib/compare";
import { productKey } from "@/src/lib/specs";
import { allMembers, buildUnits, viewItems } from "@/src/lib/view";
import type { GroupRef } from "@/src/lib/match/group";
import { GroupOpenContext, type GroupOpen } from "./components/GroupCard";
import {
  initStream, liveSummary, readEvents, reduceStream, settle, stopStream, storeEntries, streamFromPayload, type SearchPayload, type StreamEvent, type StreamState,
} from "@/src/lib/search-stream";

type Filters = { minPrice?: number; maxPrice?: number; minRating?: number };
/**
 * The search on screen: its store row and view model (streamed in), and what it asked for. `form`:
 * the form values it ran with (one object for the run's life, so the URL follows it, not each event).
 */
type Run = { stream: StreamState; query: string; sites: string[]; filters: Filters; form: FormValues };
type Results = {
  products: Product[];
  /** The same product at several stores (ids), and members missing from `products`. */
  groups: GroupRef[];
  groupExtras: Product[];
  reason?: string;
  query: string;
  sites: string[];
  /** The form filters this search ran with; a "Watch this search" keeps them. */
  filters: Filters;
};
/** What "go home" put aside, so Back to the results entry brings them back. */
type Stash = { run: Run; values: FormValues; chips: ChipFilters };
type Phase = "idle" | "loading" | "done" | "error";

const INITIAL: FormValues = {
  query: "",
  sites: defaultSites(),
  sort: "price",
  minPrice: "",
  maxPrice: "",
  minRating: "",
};

const SKELETONS = 8;

/** The compare selection: product keys in the order ticked (kept in the URL), and whether one was refused. */
type CompareState = { keys: string[]; full: boolean };
const NO_COMPARE: CompareState = { keys: [], full: false };

/** The same search words (trimmed, any case). */
const sameQuery = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

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
  const [run, setRun] = useState<Run | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [errorField, setErrorField] = useState<ErrorField>(null);
  const abortRef = useRef<AbortController | null>(null);
  const [watchOpen, setWatchOpen] = useState(false);
  const [watchSaved, setWatchSaved] = useState(false);
  // Quick filter chips: client-side over the current results, kept in the URL (never a new search).
  const [chips, setChips] = useState<ChipFilters>(NO_FILTERS);
  const [chipsRead, setChipsRead] = useState(false);
  /** Chips carried over from the previous query (rating, discounted); named in a note. */
  const [keptChips, setKeptChips] = useState<KeptChip[]>([]);
  // Grid cards or list rows, remembered per browser. Results never render on the server, so
  // reading storage in the initializer cannot cause a hydration mismatch.
  const [view, setView] = useState<ResultsView>(() => readView(browserStorage()));
  const changeView = useCallback((v: ResultsView) => {
    setView(v);
    writeView(browserStorage(), v);
  }, []);
  // One state, so the toggle below can be one stable function for every (memoized) card. The keys
  // live in the URL (`cmp=`), so a reload, Back or a shared link keeps them; `memory` (this tab's
  // sessionStorage) names the products and their search after a reload.
  const [cmp, setCmp] = useState<CompareState>(NO_COMPARE);
  const [memory, setMemory] = useState<CompareMemory | null>(null);
  const [compareOpen, setCompareOpen] = useState(false);
  // Groups the user opened, by row key: kept while a streamed search reshapes the cards.
  const [openRows, setOpenRows] = useState<ReadonlySet<string>>(() => new Set());
  const groupOpen = useMemo<GroupOpen>(
    () => ({
      isOpen: (keys) => keys.some((k) => openRows.has(k)),
      setOpen: (keys, open) =>
        setOpenRows((cur) => {
          const next = new Set(cur);
          for (const k of keys) {
            if (open) next.add(k);
            else next.delete(k);
          }
          return next;
        }),
    }),
    [openRows],
  );
  // Saved products (hearts on cards, group rows and the compare table), kept in SQLite.
  const favourites = useFavourites();
  const stashRef = useRef<Stash | null>(null);
  const [formKey, setFormKey] = useState(0);

  useEffect(() => () => abortRef.current?.abort(), []);

  // The view model of the search on screen: the latest streamed (or plain) results. A run's
  // query, sites and filters are fixed, so the payload is the only thing that changes.
  const payload = run?.stream.results ?? null;
  const results = useMemo<Results | null>(
    () =>
      run && payload
        ? {
            products: payload.products,
            groups: Array.isArray(payload.groups) ? payload.groups : [],
            groupExtras: Array.isArray(payload.groupExtras) ? payload.groupExtras : [],
            reason: payload.reason,
            query: run.query,
            sites: run.sites,
            filters: run.filters,
          }
        : null,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [payload],
  );

  // A clean home: no search, no results, a fresh form. `stash` keeps the results for Back.
  const resetHome = (stash: boolean) => {
    abortRef.current?.abort();
    abortRef.current = null;
    // A search still running is stopped first: Back must not bring back stores "Searching" forever.
    stashRef.current = stash && run?.stream.results ? { run: { ...run, stream: stopStream(run.stream) }, values, chips } : null;
    setValues(INITIAL);
    setPhase("idle");
    setRun(null);
    setError(null);
    setErrorField(null);
    setWatchOpen(false);
    setWatchSaved(false);
    setChips(NO_FILTERS);
    setKeptChips([]);
    setCmp(NO_COMPARE);
    setCompareOpen(false);
    setOpenRows(new Set());
    setFormKey((k) => k + 1);
    window.scrollTo(0, 0);
  };

  // Back or Forward within "/": the page follows the URL (the chips, and the results "go home"
  // left behind). The listeners below read the latest render through this ref.
  const showingHome = !run;
  const onHistory = useRef<{ home: () => void; pop: () => void }>({ home: () => {}, pop: () => {} });
  useEffect(() => {
    onHistory.current = {
      // The wordmark or Search link clicked on this page: back to a clean home (AppHeader already
      // put "/" in the URL). The form remounts (key), so its query, stores and options start
      // over. When chips were on, AppHeader pushed a new "/" entry: it is marked, so Back and
      // Forward can tell it from the results entry.
      home: () => {
        // A results URL (it carries the query) or chip params: AppHeader pushed a new "/" entry.
        if (run || withCompareParam(withChipParams("", chips), cmp.keys) !== "") window.history.replaceState({ ...(window.history.state as object | null), [HOME_ENTRY]: true }, "", "/");
        resetHome(true);
      },
      pop: () => {
        const qs = window.location.search;
        const move = historyMove(qs, window.history.state, { stashed: !!stashRef.current, showingHome });
        if (move === "home") {
          if (!showingHome) resetHome(true);
          return;
        }
        if (move === "run") {
          // Back to a search left before any result came: run it again, as its shared link would.
          const shared = parseShare(qs, INITIAL);
          if (shared) {
            setChips(shared.chips);
            setCmp({ keys: shared.cmp, full: false });
            setValues(shared.values);
            void search(undefined, shared.values);
          }
          return;
        }
        const s = stashRef.current;
        if (move === "restore" && s) {
          stashRef.current = null;
          setValues(s.values);
          setRun(s.run);
          setPhase("done");
        }
        setChips(filtersFromSearch(qs));
        setCmp({ keys: keysFromSearch(qs), full: false });
      },
    };
  });
  useEffect(() => {
    const home = () => onHistory.current.home();
    const pop = () => onHistory.current.pop();
    window.addEventListener(GO_HOME_EVENT, home);
    window.addEventListener("popstate", pop);
    return () => {
      window.removeEventListener(GO_HOME_EVENT, home);
      window.removeEventListener("popstate", pop);
    };
  }, []);

  // A results URL (a shared link, a reload, a History "Re-run" link): fill the form from it, put
  // the chips and the compare selection back, and run that search once. runOnce defers the run to
  // the next task, so React's Strict Mode double mount (dev) still searches once.
  const autoRan = useRef(false);
  useEffect(() => {
    const qs = window.location.search;
    // Read once after hydration (the server render has no URL state); not a cascade.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setChips(filtersFromSearch(qs));
    const keys = keysFromSearch(qs);
    setCmp({ keys, full: false });
    setMemory(keys.length ? readMemory(sessionStore()) : null);
    setChipsRead(true);
    const shared = parseShare(qs, INITIAL);
    if (!shared) return;
    // The link in its own words: unknown keys and the old "run=1" dropped.
    window.history.replaceState(window.history.state, "", window.location.pathname + shareSearch(shared.values, shared.chips, shared.cmp));
    setValues(shared.values);
    return runOnce(autoRan, () => void search(undefined, shared.values));
    // Runs once on mount by design.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The URL follows the page in place (replaceState: no history entry, no request): with a search
  // on screen it is the whole shareable link (query, stores, sort, limits, chips, compare);
  // without one, only the chip and compare keys.
  const runForm = run?.form;
  useEffect(() => {
    if (!chipsRead) return;
    const next = runForm
      ? shareSearch({ ...runForm, sort: values.sort }, chips, cmp.keys)
      : withCompareParam(withChipParams(window.location.search, chips), cmp.keys);
    if (next === window.location.search) return;
    // A results entry is never the marked "go home" entry, even when a search replaced that entry.
    const state = Object.entries((window.history.state as Record<string, unknown> | null) ?? {}).filter(([k]) => !runForm || k !== HOME_ENTRY);
    window.history.replaceState(Object.fromEntries(state), "", window.location.pathname + next);
  }, [chips, cmp.keys, chipsRead, runForm, values.sort]);

  // Cards: a cross-store group is one card, every other product one card. Chips narrow the cards
  // (a group passes when any member does), then sort and the match tiers apply; no new request.
  const units = useMemo(() => (results ? buildUnits(results.products, results.groups, results.groupExtras) : []), [results]);
  const all = useMemo(() => allMembers(units), [units]);
  const chipCtx = useMemo(() => chipContext(all), [all]);
  const facets = useMemo(() => facetCountsFor(units.map((u) => u.members), chips, chipCtx), [units, chips, chipCtx]);
  const bounds = useMemo(() => priceBounds(all), [all]);
  // An expanded card's "Other listings like this" and brand, from the results on screen only.
  const details = useMemo<DetailsSource>(
    () => ({
      related: (p, exclude) => relatedListings(p, all, { exclude: new Set(exclude) }),
      brand: (p) => chipCtx.brands.get(productKey(p)),
    }),
    [all, chipCtx],
  );
  const items = useMemo(() => viewItems(units, chips, chipCtx, values.sort), [units, chips, chipCtx, values.sort]);
  const filtering = isActive(chips) && all.length > 0;
  const kept = keptChips.filter((k) => (k === "rating" ? chips.minRating !== undefined : k === "deals" ? !!chips.deals : chips.discounted));
  // The live region hears "N of M results" once a change settles (a dragged slider fires many).
  const filterLive = filtering ? `${items.length} of ${units.length} results` : "";
  const [liveFilter, setLiveFilter] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setLiveFilter(filterLive), 400);
    return () => clearTimeout(t);
  }, [filterLive]);
  // The ticked products, resolved against every result (filtered-out ones included, so a filter
  // never drops them); a key the results do not have stays as a "no longer in results" slot.
  const byKey = useMemo(() => new Map(all.map((p) => [productKey(p), p])), [all]);
  const slots = useMemo(() => resolveSelection(cmp.keys, byKey, memory?.snaps), [cmp.keys, byKey, memory]);
  const compareItems = useMemo(() => slots.flatMap((s) => (s.product ? [s.product] : [])), [slots]);
  const compareMissing = useMemo(() => slots.filter((s) => !s.product), [slots]);
  // This tab remembers the search and each ticked product, to name them after a reload.
  useEffect(() => {
    if (!chipsRead) return;
    if (!cmp.keys.length) {
      writeMemory(sessionStore(), null);
      return;
    }
    const snaps = Object.fromEntries(slots.flatMap((s) => (s.snap ? [[s.key, s.snap]] : [])));
    writeMemory(sessionStore(), { query: results?.query ?? memory?.query ?? "", sites: results?.sites ?? memory?.sites ?? [], snaps });
  }, [slots, cmp.keys, results, memory, chipsRead]);
  const compareKeys = useMemo(() => new Set(cmp.keys), [cmp.keys]);
  const onToggleCompare = useCallback((p: Product) => setCmp((c) => toggleKey(c.keys, productKey(p))), []);
  const removeCompare = useCallback((key: string) => setCmp((c) => ({ keys: c.keys.filter((k) => k !== key), full: false })), []);
  const compare = useMemo(() => ({ isChecked: (p: Product) => compareKeys.has(productKey(p)), onToggle: onToggleCompare }), [compareKeys, onToggleCompare]);
  const stores = useMemo(() => (run ? storeEntries(run.stream) : []), [run]);

  const fail = (msg: string) => {
    setError(msg);
    setErrorField(fieldFor(msg));
    setPhase("error");
    setRun(null);
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
    stashRef.current = null;
    // A new query drops the store, brand and price chips of the old results (not on a History re-run).
    const carried = chipsForNewQuery(chips, results?.query, v.query);
    if (carried.filters !== chips) setChips(carried.filters);
    setKeptChips(carried.kept);
    setWatchOpen(false);
    setWatchSaved(false);
    // A different query starts a fresh comparison; the same one (or a reload's re-run) keeps it.
    const from = results?.query ?? memory?.query;
    if (from !== undefined && !sameQuery(from, v.query)) {
      setCmp(NO_COMPARE);
      setMemory(null);
    }
    setCompareOpen(false);
    setOpenRows(new Set());

    const body = {
      query: v.query,
      sites: v.sites,
      sort: v.sort,
      minPrice: toNum(v.minPrice),
      maxPrice: toNum(v.maxPrice),
      minRating: toNum(v.minRating),
    };
    const meta = { query: v.query.trim(), sites: v.sites, filters: { minPrice: body.minPrice, maxPrice: body.maxPrice, minRating: body.minRating }, form: { ...v, query: v.query.trim() } };
    setRun({ ...meta, stream: initStream(v.sites) });
    const request = (url: string) =>
      fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal: ctrl.signal });
    const aborted = (e?: unknown) => ctrl.signal.aborted || (e instanceof DOMException && e.name === "AbortError");

    // The whole answer at once (POST /api/search): used when streaming is not available.
    async function plain() {
      try {
        const res = await request("/api/search");
        const data = (await res.json().catch(() => null)) as (SearchPayload & { error?: string }) | null;
        if (ctrl.signal.aborted) return;
        if (!res.ok || !data || !Array.isArray(data.products)) {
          fail(data?.error ?? "The search failed; try again");
          return;
        }
        setRun({ ...meta, stream: streamFromPayload(v.sites, { ...data, statuses: data.statuses ?? [] }) });
        setPhase("done");
      } catch (e) {
        if (aborted(e)) return;
        fail("Could not reach the search server; check it is running and try again");
      }
    }

    let events = 0;
    let gotResults = false;
    let streamError: string | null = null;
    const apply = (e: StreamEvent) => {
      if (ctrl.signal.aborted) return;
      events++;
      if (e.type === "results") gotResults = true;
      if (e.type === "error") streamError = e.error;
      setRun((r) => (r ? { ...r, stream: reduceStream(r.stream, e) } : r));
    };
    try {
      let res: Response;
      try {
        res = await request("/api/search/stream");
      } catch (e) {
        if (aborted(e)) return;
        await plain(); // the stream endpoint could not be reached: try the plain one
        return;
      }
      if (ctrl.signal.aborted) return;
      const type = res.headers.get("content-type") ?? "";
      if (!res.ok || !type.includes("ndjson") || !res.body) {
        // An input error answers JSON with a message, as /api/search would: show it.
        const data = (await res.json().catch(() => null)) as { error?: string } | null;
        if (ctrl.signal.aborted) return;
        if (res.status >= 400 && res.status < 500 && typeof data?.error === "string") fail(data.error);
        else await plain();
        return;
      }
      try {
        await readEvents(res.body, apply);
      } catch (e) {
        if (aborted(e)) return;
        // Broken before any event: try the plain endpoint. Broken mid-way: keep what arrived;
        // the stores that had not answered are settled as failed below.
      }
      if (ctrl.signal.aborted) return;
      if (events === 0) {
        await plain();
        return;
      }
      if (streamError !== null && !gotResults) {
        fail(streamError);
        return;
      }
      if (!gotResults) {
        // Store lines but never a view (the stream broke early): ask the plain endpoint.
        await plain();
        return;
      }
      setRun((r) => (r && !r.stream.done ? { ...r, stream: settle(r.stream) } : r));
      setPhase("done");
    } finally {
      if (abortRef.current === ctrl) abortRef.current = null;
    }
  }

  /** Search again with some form values changed (an empty state's "search all stores"). */
  function searchWith(patch: Partial<FormValues>) {
    const v = { ...values, ...patch };
    setValues(v);
    void search(undefined, v);
  }

  function stop() {
    abortRef.current?.abort();
    abortRef.current = null;
    // The results so far stay; with none yet, back to the home.
    setRun((r) => (r?.stream.results ? { ...r, stream: stopStream(r.stream) } : null));
    setPhase(run?.stream.results ? "done" : "idle");
  }

  const loading = phase === "loading";
  // Before the first search the page is the home: brand line, search, suggestions and discovery.
  const home = !loading && !results;
  // Searching with nothing to show yet: the skeleton grid holds the space.
  const waiting = loading && all.length === 0;
  const cheapest = useMemo(() => (all.length ? cheapestConfident(all) : null), [all]);
  const formError = errorField === "form" ? error : null;
  const currency = all[0]?.currency || "SAR";
  // Store coverage for the header: answered so far while searching, then stores with results.
  const answered = stores.filter((e) => e.state !== "searching").length;
  const withResults = stores.filter((e) => e.state === "ok").length;
  const coverage = !stores.length ? "" : loading ? `${answered} of ${stores.length} stores answered` : `Results from ${withResults} of ${stores.length} ${stores.length === 1 ? "store" : "stores"}`;
  const lastChip = activeChips(chips, currency).at(-1);
  const formLimits = !!(run && (run.filters.minPrice !== undefined || run.filters.maxPrice !== undefined || run.filters.minRating !== undefined));

  // A short summary at milestones (start, first results, end), never a line per store.
  let live = "";
  if (loading) live = run ? liveSummary(run.stream, items.length) : "";
  else if (phase === "error" && error) live = error;
  else if (phase === "done" && results && filtering) live = liveFilter;
  else if (phase === "done" && results && run) live = items.length ? liveSummary(run.stream, items.length) : (results.reason ?? "");

  return (
    <SavedContext value={favourites}>
      <div className="app">
        <AppHeader current="search" />

        <main className={home ? "container main main--home" : "container main"}>
          {home ? (
            <div className="home-intro">
              <h1 className="home-intro__title">{`One search across ${STORES.length} Saudi stores`}</h1>
              <p className="home-intro__lead">Listed prices side by side, with deals marked only when the price history backs them.</p>
            </div>
          ) : (
            <h1 className="visually-hidden">Deal search</h1>
          )}
          <SearchForm
            key={formKey}
            values={values}
            onChange={setValues}
            onSubmit={(q) => void search(q)}
            onStop={stop}
            loading={loading}
            error={error}
            errorField={errorField}
            compact={!home}
          />

          <p className="visually-hidden" role="status" aria-live="polite">
            {live}
          </p>

          {formError && <ErrorState message={formError} onRetry={() => void search()} retryLabel="Search again" />}

          <StatusBar stores={stores} stopped={!!run?.stream.stopped} />

          {home && (
            <>
              <HomeSuggestions
                onPick={(q) => {
                  setValues((v) => ({ ...v, query: q }));
                  void search(q);
                }}
              />
              <RecentlyViewed />
              <HomeDiscover />
            </>
          )}

          {!home && (
            <section className="results" aria-labelledby="results-head" aria-busy={loading || undefined}>
              <div className="results__head">
                <div className="results__title">
                  <h2 id="results-head">
                    {waiting ? "Searching" : results && filtering ? `${items.length} of ${units.length} results` : results && items.length ? `${items.length} ${items.length === 1 ? "result" : "results"}${loading ? " so far" : ""}` : "Results"}
                  </h2>
                  <p className="results__note">
                    {coverage}
                    {results && items.length > 0 && <span className="results__ship">Prices exclude shipping</span>}
                  </p>
                </div>
                <div className="results__actions">
                  {results && <CopyLink />}
                  {!loading && results && cheapest && !watchOpen && !watchSaved && (
                    <Button size="sm" onClick={() => setWatchOpen(true)}>
                      Watch this search
                    </Button>
                  )}
                </div>
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

              <ResultsLayout
                filters={chips}
                onFilters={setChips}
                facets={facets}
                bounds={bounds}
                currency={currency}
                kept={kept}
                sort={values.sort}
                onSort={(sort) => setValues((v) => ({ ...v, sort }))}
                view={view}
                onView={changeView}
                shown={items.length}
                ready={all.length > 0}
              >
                {waiting ? (
                  <ul className={view === "list" ? "grid grid--list" : "grid"} aria-hidden="true">
                    {Array.from({ length: SKELETONS }, (_, i) => (
                      <li key={i}>
                        <SkeletonCard variant={view} />
                      </li>
                    ))}
                  </ul>
                ) : results && items.length ? (
                  <GroupOpenContext value={groupOpen}>
                    <DetailsContext value={details}>
                      <ResultTiers items={items} query={results.query} compare={compare} view={view} />
                    </DetailsContext>
                  </GroupOpenContext>
                ) : results && filtering ? (
                  <EmptyState
                    title="No results match these filters"
                    body={`${units.length} ${units.length === 1 ? "result is" : "results are"} hidden by the filters. Remove one, or clear them all.`}
                    action={
                      <div className="empty__actions">
                        {lastChip && (
                          <Button size="sm" variant="secondary" onClick={() => setChips(lastChip.without)}>
                            {`Remove "${lastChip.label}"`}
                          </Button>
                        )}
                        <Button size="sm" variant="ghost" onClick={() => setChips(NO_FILTERS)}>
                          Clear all filters
                        </Button>
                      </div>
                    }
                  />
                ) : results && !loading ? (
                  <EmptyState
                    title={results.reason ?? "No products matched your search"}
                    body="Try fewer words, or search more stores."
                    action={
                      (results.sites.length < STORES.length || formLimits) && (
                        <div className="empty__actions">
                          {results.sites.length < STORES.length && (
                            <Button size="sm" variant="secondary" onClick={() => searchWith({ sites: STORES.map((st) => st.id) })}>
                              {`Search all ${STORES.length} stores`}
                            </Button>
                          )}
                          {formLimits && (
                            <Button size="sm" variant="ghost" onClick={() => searchWith({ minPrice: "", maxPrice: "", minRating: "" })}>
                              Search without price and rating limits
                            </Button>
                          )}
                        </div>
                      )
                    }
                  />
                ) : null}
              </ResultsLayout>
            </section>
          )}
        </main>
        <AppFooter />

        <CompareTray
          slots={slots}
          full={cmp.full}
          waiting={loading}
          searched={!!run}
          onRemove={removeCompare}
          onClear={() => setCmp(NO_COMPARE)}
          onOpen={() => setCompareOpen(true)}
          rerun={
            !results && !loading && memory?.query && compareMissing.length > 0
              ? { query: memory.query, onRun: () => searchWith({ query: memory.query, ...(memory.sites.length ? { sites: memory.sites } : {}) }) }
              : undefined
          }
        />
        <CompareDialog
          items={compareItems}
          missing={compareMissing}
          open={compareOpen && compareItems.length >= MIN_COMPARE}
          onClose={() => setCompareOpen(false)}
          onRemove={removeCompare}
          brands={chipCtx.brands}
        />
      </div>
    </SavedContext>
  );
}
