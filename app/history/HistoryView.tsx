"use client";

import { useEffect, useState } from "react";
import type { HistoryEntry } from "@/src/lib/alerts/shared";
import { storeLabel } from "@/src/lib/stores";
import { rerunHref } from "@/src/lib/rerun";
import AppHeader from "../components/AppHeader";
import AppFooter from "../components/AppFooter";
import Button from "../components/ui/Button";
import EmptyState from "../components/ui/EmptyState";
import ErrorState from "../components/ui/ErrorState";
import SectionHeader from "../components/ui/SectionHeader";
import StoreMark from "../components/ui/StoreMark";
import When from "../components/When";
import { formatMoney } from "@/src/lib/money";

type State = { phase: "loading" } | { phase: "error"; message: string } | { phase: "ready"; items: HistoryEntry[] };

const plural = (n: number) => `${n} ${n === 1 ? "result" : "results"}`;

export default function HistoryView() {
  const [state, setState] = useState<State>({ phase: "loading" });
  const [notice, setNotice] = useState<string | null>(null);

  async function load() {
    try {
      const r = await fetch("/api/history", { cache: "no-store" });
      const d = (await r.json().catch(() => null)) as { items?: HistoryEntry[]; error?: string } | null;
      if (!r.ok || !d?.items) {
        setState({ phase: "error", message: d?.error ?? "Could not load the history" });
        return;
      }
      setState({ phase: "ready", items: d.items });
    } catch {
      setState({ phase: "error", message: "Could not reach the app server" });
    }
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- load() sets state only after its awaited fetch, never synchronously
    void load();
  }, []);

  async function remove(query: string) {
    const r = await fetch(`/api/history?${query}`, { method: "DELETE" }).catch(() => null);
    if (!r?.ok) setNotice("Could not delete; try again");
    else setNotice(null);
    await load();
  }

  const items = state.phase === "ready" ? state.items : [];

  return (
    <div className="app">
      <AppHeader current="history" />
      <main className="container main">
        <SectionHeader
          as="h1"
          title="Search history"
          note="Every search run here is kept by this app on its server, for anyone who can open it, so it can be run again."
          actions={
            items.length > 0 && (
              <Button
                size="sm"
                variant="destructive"
                onClick={() => {
                  if (window.confirm("Clear the whole search history? This cannot be undone.")) void remove("all=1");
                }}
              >
                Clear all
              </Button>
            )
          }
        />
        {notice && <ErrorState message={notice} />}

        {state.phase === "loading" ? (
          <p className="results__note" role="status">
            Loading
          </p>
        ) : state.phase === "error" ? (
          <ErrorState message={state.message} onRetry={() => void load()} />
        ) : !items.length ? (
          <EmptyState
            title="No searches yet"
            body="Each search you run is kept here so you can run it again."
            action={
              <Button href="/" size="sm" variant="primary">
                Search the stores
              </Button>
            }
          />
        ) : (
          <ul className="rows">
            {items.map((e) => (
              <li key={e.id} className="row">
                <div className="row__main">
                  <p className="row__title" dir="auto">{e.query}</p>
                  <p className="row__meta">
                    <span className="row__logos">
                      {e.sites.map((s) => (
                        <StoreMark key={s} id={s} variant="compact" size={18} />
                      ))}
                    </span>
                    <When at={e.at} />
                    <span>{plural(e.resultCount)}</span>
                  </p>
                  {e.cheapest && (
                    <p className="row__detail">
                      Cheapest match{" "}
                      <a href={e.cheapest.url} target="_blank" rel="noopener noreferrer">
                        {e.cheapest.title}
                        <span className="visually-hidden"> (opens in a new tab)</span>
                      </a>{" "}
                      at {storeLabel(e.cheapest.site)}, <strong className="row__price">{formatMoney(e.cheapest.price, e.cheapest.currency)}</strong>
                    </p>
                  )}
                </div>
                <div className="row__actions">
                  <Button size="sm" href={rerunHref(e)}>
                    Re-run<span className="visually-hidden"> {e.query}</span>
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => void remove(`id=${e.id}`)}>
                    Delete<span className="visually-hidden"> {e.query}</span>
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </main>
      <AppFooter />
    </div>
  );
}
