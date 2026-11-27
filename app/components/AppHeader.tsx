"use client";

import Link from "next/link";
import { useEffect, useState, type MouseEvent } from "react";
import Badge from "./ui/Badge";

type Page = "search" | "history" | "alerts";

const LINKS: { page: Page; href: string; label: string }[] = [
  { page: "search", href: "/", label: "Search" },
  { page: "history", href: "/history", label: "History" },
  { page: "alerts", href: "/alerts", label: "Alerts" },
];

/** Fired by the Alerts page once it marked the alerts seen, so the badge clears at once. */
export const ALERTS_SEEN_EVENT = "deal-search:alerts-seen";

/** Fired when a home link (wordmark, Search) is clicked while already on "/": Home resets itself. */
export const GO_HOME_EVENT = "deal-search:go-home";

type HomeClick = Pick<MouseEvent, "button" | "metaKey" | "ctrlKey" | "shiftKey" | "altKey" | "defaultPrevented" | "preventDefault">;
type HomeWindow = { location: { pathname: string; search: string; hash: string }; history: { pushState: (data: null, unused: string, url: string) => void }; dispatchEvent: (e: Event) => boolean };

/**
 * A plain click on a home link while on "/" would be a no-op soft navigation that keeps the old
 * results. Instead: stop it, put a clean "/" in the URL (dropping chip params), and tell Home to
 * reset. From another page, or a new-tab click, the link navigates as usual (Home mounts clean).
 */
export function goHome(e: HomeClick, win: HomeWindow): void {
  if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
  if (win.location.pathname !== "/") return;
  e.preventDefault();
  if (win.location.search || win.location.hash) win.history.pushState(null, "", "/");
  win.dispatchEvent(new Event(GO_HOME_EVENT));
}

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
        <Link href="/" className="wordmark" aria-label="Deal search, home" onClick={(e) => goHome(e, window)}>
          Deal search
        </Link>
        <nav className="nav" aria-label="Pages">
          {LINKS.map((l) => (
            <Link
              key={l.page}
              href={l.href}
              className="nav__link"
              aria-current={l.page === current ? "page" : undefined}
              onClick={l.page === "search" ? (e) => goHome(e, window) : undefined}
            >
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
