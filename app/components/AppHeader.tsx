"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

type Page = "search" | "history" | "alerts";

const LINKS: { page: Page; href: string; label: string }[] = [
  { page: "search", href: "/", label: "Search" },
  { page: "history", href: "/history", label: "History" },
  { page: "alerts", href: "/alerts", label: "Alerts" },
];

/** Fired by the Alerts page once it marked the alerts seen, so the badge clears at once. */
export const ALERTS_SEEN_EVENT = "deal-search:alerts-seen";

/** Top bar with the app's three pages; Alerts carries the count of fired alerts not yet seen. */
export default function AppHeader({ current }: { current: Page }) {
  const [unread, setUnread] = useState(0);

  useEffect(() => {
    let live = true;
    fetch("/api/alerts", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { unread?: number } | null) => {
        if (live && typeof d?.unread === "number") setUnread(d.unread);
      })
      .catch(() => {});
    const clear = () => setUnread(0);
    window.addEventListener(ALERTS_SEEN_EVENT, clear);
    return () => {
      live = false;
      window.removeEventListener(ALERTS_SEEN_EVENT, clear);
    };
  }, []);

  return (
    <header className="topbar">
      <div className="container topbar__inner">
        {current === "search" ? <h1 className="wordmark">Deal search</h1> : <p className="wordmark">Deal search</p>}
        <nav className="nav" aria-label="Pages">
          {LINKS.map((l) => (
            <Link key={l.page} href={l.href} className="nav__link" aria-current={l.page === current ? "page" : undefined}>
              {l.label}
              {l.page === "alerts" && unread > 0 && (
                <span className="nav__count">
                  {unread}
                  <span className="visually-hidden"> new</span>
                </span>
              )}
            </Link>
          ))}
        </nav>
      </div>
    </header>
  );
}
