"use client";

import { useEffect, useState } from "react";
import type { HistoryEntry } from "@/src/lib/alerts/shared";
import { homeSuggestions, type QuerySuggestion } from "@/src/lib/home";
import Button from "./ui/Button";
import SectionHeader from "./ui/SectionHeader";

type Lists = { popular: QuerySuggestion[]; recent: QuerySuggestion[] };

function QueryList({ items, onPick, onRemove, counts }: { items: QuerySuggestion[]; onPick: (q: string) => void; onRemove: (q: string) => void; counts?: boolean }) {
  return (
    <ul className="qlist" role="list">
      {items.map((s) => (
        <li key={s.query} className="qitem">
          <button type="button" className="qchip" onClick={() => onPick(s.query)}>
            <span className="qchip__text" dir="auto">
              {s.query}
            </span>
            {counts && (
              <span className="qchip__count">
                {s.count}
                <span className="visually-hidden"> searches</span>
              </span>
            )}
          </button>
          <button type="button" className="qitem__remove" aria-label={`Remove "${s.query}" from your search history`} onClick={() => onRemove(s.query)}>
            <span aria-hidden="true">×</span>
          </button>
        </li>
      ))}
    </ul>
  );
}

async function loadLists(): Promise<Lists | null> {
  const r = await fetch("/api/history", { cache: "no-store" });
  const d = (r.ok ? await r.json() : null) as { items?: HistoryEntry[] } | null;
  return Array.isArray(d?.items) ? homeSuggestions(d.items) : null;
}

/**
 * Suggestions from the user's own search history (/api/history): queries searched more than once,
 * then the latest others. Picking one runs it; each can be removed from the history (every search
 * of that query), or the whole history cleared. Hidden while loading, on error, and when empty.
 */
export default function HomeSuggestions({ onPick }: { onPick: (query: string) => void }) {
  const [lists, setLists] = useState<Lists | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    loadLists()
      .then((l) => {
        if (live && l) setLists(l);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);

  async function remove(query: string) {
    const ok = await fetch(`/api/history?${new URLSearchParams({ q: query }).toString()}`, { method: "DELETE" })
      .then((r) => r.ok || r.status === 404)
      .catch(() => false);
    setError(ok ? null : "Could not remove that search; try again");
    const l = await loadLists().catch(() => null);
    if (l) setLists(l);
  }

  async function clearAll() {
    if (!window.confirm("Clear the whole search history? This cannot be undone.")) return;
    const r = await fetch("/api/history?all=1", { method: "DELETE" }).catch(() => null);
    if (r?.ok) {
      setLists({ popular: [], recent: [] });
      setError(null);
    } else setError("Could not clear the history; try again");
  }

  if (!lists || (!lists.popular.length && !lists.recent.length)) return null;
  return (
    <section className="home-block" aria-labelledby="sugg-head">
      <SectionHeader
        id="sugg-head"
        title="Search again"
        note="From the search history this app keeps on its server, shared by anyone who can open it."
        actions={
          <Button size="sm" variant="ghost" onClick={() => void clearAll()}>
            Clear all<span className="visually-hidden"> search history</span>
          </Button>
        }
      />
      {error && (
        <p className="helper helper--error" role="alert">
          {error}
        </p>
      )}
      <div className="sugg">
        {lists.popular.length > 0 && (
          <div className="sugg__group">
            <h3 className="sugg__label">Searched most</h3>
            <QueryList items={lists.popular} onPick={onPick} onRemove={(q) => void remove(q)} counts />
          </div>
        )}
        {lists.recent.length > 0 && (
          <div className="sugg__group">
            <h3 className="sugg__label">Recent</h3>
            <QueryList items={lists.recent} onPick={onPick} onRemove={(q) => void remove(q)} />
          </div>
        )}
      </div>
    </section>
  );
}
