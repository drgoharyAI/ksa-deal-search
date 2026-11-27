"use client";

import { useEffect, useState } from "react";
import type { ViewedItem } from "@/src/lib/saved-shared";
import { formatMoney } from "@/src/lib/money";
import { httpsUrl } from "@/src/lib/view";
import { recordView } from "./Saved";
import Button from "./ui/Button";
import SectionHeader from "./ui/SectionHeader";
import StoreMark from "./ui/StoreMark";
import When from "./When";

function ViewedCard({ item: v }: { item: ViewedItem }) {
  const [imgFailed, setImgFailed] = useState(false);
  const href = httpsUrl(v.url);
  return (
    <article className="vcard">
      <div className="vcard__media">
        {v.image && !imgFailed ? (
          // eslint-disable-next-line @next/next/no-img-element -- remote store images stay off Next's optimizer
          <img src={v.image} alt="" width={120} height={120} loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={() => setImgFailed(true)} />
        ) : (
          <span className="card__noimg">No image</span>
        )}
      </div>
      <div className="vcard__body">
        <StoreMark id={v.site} size={16} />
        <h3 className="vcard__title">
          {href ? (
            <a
              className="vcard__link"
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              dir="auto"
              onClick={() => recordView(v)}
            >
              {v.title}
              <span className="visually-hidden"> (opens in a new tab)</span>
            </a>
          ) : (
            <span dir="auto">{v.title}</span>
          )}
        </h3>
        {v.price !== null && (
          <p className="vcard__price">
            <span className="vcard__amount">{formatMoney(v.price, v.currency)}</span> when viewed
          </p>
        )}
        <p className="vcard__seen">
          Viewed <When at={v.viewedAt} />
        </p>
      </div>
    </article>
  );
}

/**
 * "Recently viewed": products the user opened at their store from this app (/api/viewed, the last
 * 50, newest first). Hidden while loading, on error, and when empty. "Clear all" empties the list.
 */
export default function RecentlyViewed({ limit = 12 }: { limit?: number }) {
  const [items, setItems] = useState<ViewedItem[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    fetch("/api/viewed", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { items?: ViewedItem[] } | null) => {
        if (live && Array.isArray(d?.items)) setItems(d.items);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);

  async function clear() {
    const r = await fetch("/api/viewed?all=1", { method: "DELETE" }).catch(() => null);
    if (r?.ok) {
      setItems([]);
      setError(null);
    } else setError("Could not clear the list; try again");
  }

  if (!items.length) return null;
  const shown = items.slice(0, limit);
  return (
    <section className="home-block" aria-labelledby="viewed-head">
      <SectionHeader
        id="viewed-head"
        title="Recently viewed"
        note="Products you opened at a store from this app, newest first. The price is what it cost then."
        actions={
          <Button size="sm" variant="ghost" onClick={() => void clear()}>
            Clear all<span className="visually-hidden"> recently viewed</span>
          </Button>
        }
      />
      {error && (
        <p className="helper helper--error" role="alert">
          {error}
        </p>
      )}
      <ul className="vstrip" role="list">
        {shown.map((v) => (
          <li key={`${v.site}+${v.id}`}>
            <ViewedCard item={v} />
          </li>
        ))}
      </ul>
    </section>
  );
}
