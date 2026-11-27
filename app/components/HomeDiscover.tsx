"use client";

import { useEffect, useState } from "react";
import type { DiscoverItem } from "@/src/lib/discover";
import Badge from "./ui/Badge";
import Price from "./ui/Price";
import SectionHeader from "./ui/SectionHeader";
import StoreMark from "./ui/StoreMark";
import When from "./When";

export function DiscoverCard({ item: d }: { item: DiscoverItem }) {
  const [imgFailed, setImgFailed] = useState(false);
  return (
    <article className="dcard">
      <div className="dcard__media">
        {d.image && !imgFailed ? (
          // eslint-disable-next-line @next/next/no-img-element -- remote store images stay off Next's optimizer
          <img src={d.image} alt="" width={160} height={160} loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={() => setImgFailed(true)} />
        ) : (
          <span className="card__noimg">No image</span>
        )}
      </div>
      <div className="dcard__body">
        <StoreMark id={d.site} size={18} />
        <h3 className="dcard__title">
          <a className="dcard__link" href={d.url} target="_blank" rel="noopener noreferrer" dir="auto">
            {d.title}
            <span className="visually-hidden"> (opens in a new tab)</span>
          </a>
        </h3>
        <Price amount={d.price} currency={d.currency} original={d.previousPrice} discountPct={d.dropPct} verified size="sm" originalLabel="highest seen" />
        {d.deal && <Badge tone="accent">{d.deal.label}</Badge>}
        <p className="dcard__seen">
          Seen <When at={d.seenAt} />
        </p>
      </div>
    </article>
  );
}

/**
 * "Recently seen deals": price drops and 30-day lows recorded by this app's own searches
 * (/api/discover, no store traffic). Hidden while loading, on error, and when there are none.
 */
export default function HomeDiscover() {
  const [items, setItems] = useState<DiscoverItem[]>([]);

  useEffect(() => {
    let live = true;
    fetch("/api/discover", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { items?: DiscoverItem[] } | null) => {
        if (live && Array.isArray(d?.items)) setItems(d.items);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);

  if (!items.length) return null;
  return (
    <section className="home-block" aria-labelledby="disc-head">
      <SectionHeader id="disc-head" title="Recently seen deals" note="Drops and 30-day lows in prices your searches recorded. The struck price is the highest seen in 30 days." />
      <ul className="dgrid" role="list">
        {items.map((d) => (
          <li key={`${d.site}:${d.id}`}>
            <DiscoverCard item={d} />
          </li>
        ))}
      </ul>
    </section>
  );
}
