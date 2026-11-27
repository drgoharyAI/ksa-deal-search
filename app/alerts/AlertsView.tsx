"use client";

import { useEffect, useState } from "react";
import type { AlertEvent, WatchView } from "@/src/lib/alerts/shared";
import { storeLabel } from "@/src/lib/stores";
import AppHeader, { ALERTS_SEEN_EVENT } from "../components/AppHeader";
import StoreLogo from "../components/StoreLogo";
import Sparkline from "../components/Sparkline";
import WatchForm from "../components/WatchForm";
import When from "../components/When";
import { formatMoney } from "../components/ResultCard";

type Data = { watches: WatchView[]; events: AlertEvent[]; telegram: { configured: boolean } };
type State = { phase: "loading" } | { phase: "error"; message: string } | ({ phase: "ready" } & Data);

const JSON_HEADERS = { "content-type": "application/json" };

const CHECK_TEXT: Record<string, string> = {
  blocked: "store blocked the last check",
  error: "last check failed",
  "not found": "not in the store's results last time",
  "no match": "no confident match last time",
};

async function getJson<T>(url: string): Promise<T> {
  const r = await fetch(url, { cache: "no-store" });
  const d = (await r.json().catch(() => null)) as (T & { error?: string }) | null;
  if (!r.ok || !d) throw new Error(d?.error ?? "Could not load the alerts");
  return d;
}

export default function AlertsView() {
  const [state, setState] = useState<State>({ phase: "loading" });
  const [editing, setEditing] = useState<number | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [test, setTest] = useState<{ busy: boolean; text: string | null; ok: boolean }>({ busy: false, text: null, ok: false });

  async function load(): Promise<Data | null> {
    try {
      const [w, a] = await Promise.all([
        getJson<{ watches: WatchView[] }>("/api/watches"),
        getJson<{ events: AlertEvent[]; telegram: { configured: boolean } }>("/api/alerts"),
      ]);
      const data = { watches: w.watches, events: a.events, telegram: a.telegram };
      setState({ phase: "ready", ...data });
      return data;
    } catch (e) {
      setState({ phase: "error", message: e instanceof Error ? e.message : "Could not reach the app server" });
      return null;
    }
  }

  useEffect(() => {
    // Only the alerts this page shows are marked seen: one that fires meanwhile stays unread.
    void load().then((data) => {
      if (!data?.events.length) return;
      const upTo = Math.max(...data.events.map((e) => e.id));
      fetch("/api/alerts/seen", { method: "POST", headers: JSON_HEADERS, body: JSON.stringify({ upTo }) })
        .then((r) => {
          if (r.ok) window.dispatchEvent(new Event(ALERTS_SEEN_EVENT));
        })
        .catch(() => {});
    });
  }, []);

  async function change(method: "PATCH" | "DELETE", body: Record<string, unknown>): Promise<string | null> {
    try {
      const r =
        method === "DELETE"
          ? await fetch(`/api/watches?id=${body.id}`, { method })
          : await fetch("/api/watches", { method, headers: JSON_HEADERS, body: JSON.stringify(body) });
      if (!r.ok) {
        const d = (await r.json().catch(() => null)) as { error?: string } | null;
        return d?.error ?? "Could not save the change";
      }
      await load();
      return null;
    } catch {
      return "Could not reach the app server";
    }
  }

  async function sendTest() {
    setTest({ busy: true, text: null, ok: false });
    try {
      const r = await fetch("/api/alerts/test-telegram", { method: "POST", headers: JSON_HEADERS, body: "{}" });
      const d = (await r.json().catch(() => null)) as { error?: string } | null;
      setTest({ busy: false, ok: r.ok, text: r.ok ? "Sent. Check your Telegram chat." : (d?.error ?? "The test message failed") });
    } catch {
      setTest({ busy: false, ok: false, text: "Could not reach the app server" });
    }
  }

  const ready = state.phase === "ready" ? state : null;

  return (
    <div className="app">
      <AppHeader current="alerts" />
      <main className="container main">
        <div className="page-head">
          <h1 className="page-title">Price alerts</h1>
        </div>
        {notice && (
          <p className="notice notice--error" role="alert">
            {notice}
          </p>
        )}

        {state.phase === "loading" && (
          <p className="results__note" role="status">
            Loading
          </p>
        )}
        {state.phase === "error" && (
          <p className="notice notice--error" role="alert">
            {state.message}
          </p>
        )}

        {ready && (
          <>
            <section className="panel" aria-labelledby="tg-head">
              <h2 id="tg-head" className="panel__title">
                Telegram
              </h2>
              {ready.telegram.configured ? (
                <p className="panel__body">Set up. Alerts are sent to your chat.</p>
              ) : (
                <p className="panel__body">
                  Not set up, so alerts only show here. Add <code>TELEGRAM_BOT_TOKEN</code> and <code>TELEGRAM_CHAT_ID</code> to{" "}
                  <code>.env.local</code> and restart the app; the README has the steps.
                </p>
              )}
              <div className="panel__actions">
                <button type="button" className="btn btn--quiet btn--small" onClick={() => void sendTest()} disabled={test.busy} aria-busy={test.busy || undefined}>
                  Send test message
                </button>
                {test.text && (
                  <p className={test.ok ? "helper" : "helper helper--error"} role="status">
                    {test.text}
                  </p>
                )}
              </div>
            </section>

            <section className="results" aria-labelledby="watch-head">
              <h2 id="watch-head" className="section-title">
                Watching
              </h2>
              {!ready.watches.length ? (
                <div className="empty">
                  <p className="empty__title">Nothing watched yet</p>
                  <p className="empty__body">Press Watch on a result, or Watch this search above the results.</p>
                </div>
              ) : (
                <ul className="rows">
                  {ready.watches.map((w) => {
                    const name = w.kind === "product" ? (w.title ?? w.query) : `Search: ${w.query}`;
                    const store = w.kind === "product" && w.site ? w.site : null;
                    return (
                      <li key={w.id} className={w.status === "paused" ? "row row--paused" : "row"}>
                        <div className="row__main">
                          <p className="row__title">
                            {w.url ? (
                              <a href={w.url} target="_blank" rel="noopener noreferrer">
                                {name}
                                <span className="visually-hidden"> (opens in a new tab)</span>
                              </a>
                            ) : (
                              name
                            )}
                          </p>
                          <p className="row__meta">
                            {store ? (
                              <span className="row__store">
                                <StoreLogo id={store} size={18} />
                                {storeLabel(store)}
                              </span>
                            ) : (
                              <span className="row__logos" aria-label={w.sites.map(storeLabel).join(", ")}>
                                {w.sites.map((s) => (
                                  <StoreLogo key={s} id={s} size={18} />
                                ))}
                              </span>
                            )}
                            {w.status === "paused" && <span className="row__flag">Paused</span>}
                          </p>
                          <dl className="facts">
                            <div>
                              <dt>Target</dt>
                              <dd>{formatMoney(w.target, w.currency)}</dd>
                            </div>
                            <div>
                              <dt>Current</dt>
                              <dd>{w.lastPrice !== null ? formatMoney(w.lastPrice, w.currency) : "Not checked"}</dd>
                            </div>
                            <div>
                              <dt>Lowest</dt>
                              <dd>{w.lowest !== null ? formatMoney(w.lowest, w.currency) : "None yet"}</dd>
                            </div>
                            <div>
                              <dt>Last checked</dt>
                              <dd>
                                {w.lastCheckedAt !== null ? <When at={w.lastCheckedAt} /> : "Not yet"}
                                {w.lastCheckStatus && CHECK_TEXT[w.lastCheckStatus] && <span className="facts__note">, {CHECK_TEXT[w.lastCheckStatus]}</span>}
                              </dd>
                            </div>
                          </dl>
                          <Sparkline points={w.points} target={w.target} label={`Price history of ${name}, ${w.points.length} checks`} />
                          {editing === w.id && (
                            <WatchForm
                              label={`New target, ${w.currency}`}
                              initial={w.target}
                              onCancel={() => setEditing(null)}
                              onSave={async (target) => {
                                const err = await change("PATCH", { id: w.id, target });
                                if (!err) setEditing(null);
                                return err;
                              }}
                            />
                          )}
                        </div>
                        <div className="row__actions">
                          {editing !== w.id && (
                            <button type="button" className="btn btn--quiet btn--small" onClick={() => setEditing(w.id)}>
                              Edit target<span className="visually-hidden"> for {name}</span>
                            </button>
                          )}
                          <button
                            type="button"
                            className="btn btn--quiet btn--small"
                            onClick={async () => setNotice(await change("PATCH", { id: w.id, status: w.status === "active" ? "paused" : "active" }))}
                          >
                            {w.status === "active" ? "Pause" : "Resume"}
                            <span className="visually-hidden"> {name}</span>
                          </button>
                          <button
                            type="button"
                            className="btn btn--quiet btn--small"
                            onClick={async () => {
                              if (window.confirm(`Stop watching "${name}"?`)) setNotice(await change("DELETE", { id: w.id }));
                            }}
                          >
                            Delete<span className="visually-hidden"> {name}</span>
                          </button>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>

            <section className="results" aria-labelledby="log-head">
              <h2 id="log-head" className="section-title">
                Fired alerts
              </h2>
              {!ready.events.length ? (
                <p className="results__note">No alert has fired yet.</p>
              ) : (
                <ul className="rows">
                  {ready.events.map((e) => (
                    <li key={e.id} className="row">
                      <div className="row__main">
                        <p className="row__title">
                          {e.url ? (
                            <a href={e.url} target="_blank" rel="noopener noreferrer">
                              {e.title}
                              <span className="visually-hidden"> (opens in a new tab)</span>
                            </a>
                          ) : (
                            e.title
                          )}
                        </p>
                        <p className="row__meta">
                          <span className="row__store">
                            <StoreLogo id={e.site} size={18} />
                            {storeLabel(e.site)}
                          </span>
                          <When at={e.at} />
                          <span>{e.sent ? "Sent to Telegram" : "Shown here only"}</span>
                        </p>
                        <p className="row__detail">
                          {e.oldPrice !== null && e.oldPrice !== e.newPrice ? <>Was {formatMoney(e.oldPrice, e.currency)}, now </> : <>Now </>}
                          <strong className="row__price">{formatMoney(e.newPrice, e.currency)}</strong>, target {formatMoney(e.target, e.currency)}
                        </p>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </>
        )}
      </main>
    </div>
  );
}
