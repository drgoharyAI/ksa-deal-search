"use client";

import { useEffect, useState } from "react";
import type { HistoryEntry } from "@/src/lib/alerts/shared";
import { homeSuggestions, type QuerySuggestion } from "@/src/lib/home";
import SectionHeader from "./ui/SectionHeader";

type Lists = { popular: QuerySuggestion[]; recent: QuerySuggestion[] };

function QueryList({ items, onPick, counts }: { items: QuerySuggestion[]; onPick: (q: string) => void; counts?: boolean }) {
  return (
    <ul className="qlist" role="list">
      {items.map((s) => (
        <li key={s.query}>
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
        </li>
      ))}
    </ul>
  );
}

/**
 * Suggestions from the user's own search history (/api/history): queries searched more than once,
 * then the latest others. Picking one runs it. Hidden while loading, on error, and when empty.
 */
export default function HomeSuggestions({ onPick }: { onPick: (query: string) => void }) {
  const [lists, setLists] = useState<Lists | null>(null);

  useEffect(() => {
    let live = true;
    fetch("/api/history", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { items?: HistoryEntry[] } | null) => {
        if (live && Array.isArray(d?.items)) setLists(homeSuggestions(d.items));
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);

  if (!lists || (!lists.popular.length && !lists.recent.length)) return null;
  return (
    <section className="home-block" aria-labelledby="sugg-head">
      <SectionHeader id="sugg-head" title="Search again" note="From your own search history on this device." />
      <div className="sugg">
        {lists.popular.length > 0 && (
          <div className="sugg__group">
            <h3 className="sugg__label">Searched most</h3>
            <QueryList items={lists.popular} onPick={onPick} counts />
          </div>
        )}
        {lists.recent.length > 0 && (
          <div className="sugg__group">
            <h3 className="sugg__label">Recent</h3>
            <QueryList items={lists.recent} onPick={onPick} />
          </div>
        )}
      </div>
    </section>
  );
}
