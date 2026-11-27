"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import Badge from "./ui/Badge";

type Page = "search" | "history" | "alerts";

const LINKS: { page: Page; href: string; label: string }[] = [
  { page: "search", href: "/", label: "Search" },
  { page: "history", href: "/history", label: "History" },
  { page: "alerts", href: "/alerts", label: "Alerts" },
];

/** Fired by the Alerts page once it marked the alerts seen, so the badge clears at once. */
export const ALERTS_SEEN_EVENT = "deal-search:alerts-seen";

/** The compact top bar on every page: the wordmark, then Search, History and Alerts (with the unseen count). */
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
        <Link href="/" className="wordmark" aria-label="Deal search, home">
          Deal search
        </Link>
        <nav className="nav" aria-label="Pages">
          {LINKS.map((l) => (
            <Link key={l.page} href={l.href} className="nav__link" aria-current={l.page === current ? "page" : undefined}>
              {l.label}
              {l.page === "alerts" && unread > 0 && (
                <Badge tone="count">
                  {unread}
                  <span className="visually-hidden"> new</span>
                </Badge>
              )}
            </Link>
          ))}
        </nav>
      </div>
    </header>
  );
}
