"use client";

import { useEffect, useState } from "react";
import type { HistoryEntry } from "@/src/lib/alerts/shared";
import { storeLabel } from "@/src/lib/stores";
import { rerunHref } from "@/src/lib/rerun";
import AppHeader from "../components/AppHeader";
import StoreLogo from "../components/StoreLogo";
import When from "../components/When";
import { formatMoney } from "../components/ResultCard";

type State = { phase: "loading" } | { phase: "error"; message: string } | { phase: "ready"; items: HistoryEntry[] };

const plural = (n: number) => `${n} ${n === 1 ? "result" : "results"}`;

export default function HistoryView() {
  const [state, setState] = useState<State>({ phase: "loading" });
  const [notice, setNotice] = useState<string | null>(null);

  async function load() {
    try {
      const r = await fetch("/api/history", { cache: "no-store" });
      const d = (await r.json().catch(() => null)) as { items?: HistoryEntry[]; error?: string } | null;
      if (!r.ok || !d?.items) return setState({ phase: "error", message: d?.error ?? "Could not load the history" });
      setState({ phase: "ready", items: d.items });
    } catch {
      setState({ phase: "error", message: "Could not reach the app server" });
    }
  }

  useEffect(() => {
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
        <div className="page-head">
          <h1 className="page-title">Search history</h1>
          {items.length > 0 && (
            <button
              type="button"
              className="btn btn--quiet btn--small"
              onClick={() => {
                if (window.confirm("Clear the whole search history? This cannot be undone.")) void remove("all=1");
              }}
            >
              Clear all
            </button>
          )}
        </div>
        {notice && (
          <p className="notice notice--error" role="alert">
            {notice}
          </p>
        )}

        {state.phase === "loading" ? (
          <p className="results__note" role="status">
            Loading
          </p>
        ) : state.phase === "error" ? (
          <p className="notice notice--error" role="alert">
            {state.message}
          </p>
        ) : !items.length ? (
          <div className="empty">
            <p className="empty__title">No searches yet</p>
            <p className="empty__body">Each search you run is kept here so you can run it again.</p>
          </div>
        ) : (
          <ul className="rows">
            {items.map((e) => (
              <li key={e.id} className="row">
                <div className="row__main">
                  <p className="row__title">{e.query}</p>
                  <p className="row__meta">
                    <span className="row__logos" aria-label={e.sites.map(storeLabel).join(", ")}>
                      {e.sites.map((s) => (
                        <StoreLogo key={s} id={s} size={18} />
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
                  <a className="btn btn--quiet btn--small" href={rerunHref(e)}>
                    Re-run<span className="visually-hidden"> {e.query}</span>
                  </a>
                  <button type="button" className="btn btn--quiet btn--small" onClick={() => void remove(`id=${e.id}`)}>
                    Delete<span className="visually-hidden"> {e.query}</span>
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </main>
    </div>
  );
}
