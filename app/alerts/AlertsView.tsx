"use client";

import { useEffect, useState } from "react";
import type { AlertEvent, WatchView } from "@/src/lib/alerts/shared";
import AppHeader, { ALERTS_SEEN_EVENT } from "../components/AppHeader";
import AppFooter from "../components/AppFooter";
import Button from "../components/ui/Button";
import EmptyState from "../components/ui/EmptyState";
import ErrorState from "../components/ui/ErrorState";
import SectionHeader from "../components/ui/SectionHeader";
import StoreMark from "../components/ui/StoreMark";
import Sparkline from "../components/Sparkline";
import WatchForm from "../components/WatchForm";
import When from "../components/When";
import { formatMoney } from "@/src/lib/money";

type Data = { watches: WatchView[]; events: AlertEvent[]; telegram: { configured: boolean } };
type State = { phase: "loading" } | { phase: "error"; message: string } | ({ phase: "ready" } & Data);

const JSON_HEADERS = { "content-type": "application/json" };

const CHECK_TEXT: Record<string, string> = {
  blocked: "store blocked the last check",
  error: "last check failed",
  "not found": "not in the store's results last time",
  "no match": "no confident match last time",
  "out of stock": "out of stock at the store last time",
  "pickup only": "branch pickup only last time, so no alert",
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
    // eslint-disable-next-line react-hooks/set-state-in-effect -- load() sets state only after its awaited fetches, never synchronously
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

  async function change(method: "PATCH" | "DELETE", body: { id: number } & Record<string, unknown>): Promise<string | null> {
    try {
      const r =
        method === "DELETE"
          ? await fetch(`/api/watches?id=${String(body.id)}`, { method })
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
        <SectionHeader as="h1" title="Price alerts" note="Watches are checked in the background; a fired alert shows here and, when set up, in Telegram." />
        {notice && <ErrorState message={notice} />}

        {state.phase === "loading" && (
          <p className="results__note" role="status">
            Loading
          </p>
        )}
        {state.phase === "error" && <ErrorState message={state.message} onRetry={() => void load()} />}

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
                <Button size="sm" onClick={() => void sendTest()} loading={test.busy}>
                  Send test message
                </Button>
                {test.text && (
                  <p className={test.ok ? "helper" : "helper helper--error"} role="status">
                    {test.text}
                  </p>
                )}
              </div>
            </section>

            <section className="results" aria-labelledby="watch-head">
              <SectionHeader id="watch-head" title="Watching" />
              {!ready.watches.length ? (
                <EmptyState
                  title="Nothing watched yet"
                  body="Press Watch on a result, or Watch this search above the results."
                  action={
                    <Button href="/" size="sm" variant="primary">
                      Search the stores
                    </Button>
                  }
                />
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
                              <StoreMark id={store} size={18} />
                            ) : (
                              <span className="row__logos">
                                {w.sites.map((s) => (
                                  <StoreMark key={s} id={s} variant="compact" size={18} />
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
                            <Button size="sm" onClick={() => setEditing(w.id)}>
                              Edit target<span className="visually-hidden"> for {name}</span>
                            </Button>
                          )}
                          <Button size="sm" variant="ghost" onClick={() => void change("PATCH", { id: w.id, status: w.status === "active" ? "paused" : "active" }).then(setNotice)}>
                            {w.status === "active" ? "Pause" : "Resume"}
                            <span className="visually-hidden"> {name}</span>
                          </Button>
                          <Button
                            size="sm"
                            variant="destructive"
                            onClick={() => {
                              if (window.confirm(`Stop watching "${name}"?`)) void change("DELETE", { id: w.id }).then(setNotice);
                            }}
                          >
                            Delete<span className="visually-hidden"> {name}</span>
                          </Button>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>

            <section className="results" aria-labelledby="log-head">
              <SectionHeader id="log-head" title="Fired alerts" />
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
                          <StoreMark id={e.site} size={18} />
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
      <AppFooter />
    </div>
  );
}
