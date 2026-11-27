"use client";

import { memo, useId, useState } from "react";
import type { Product } from "@/src/lib/types";
import { storeLabel } from "@/src/lib/stores";
import { isLikelyMatch } from "@/src/lib/rank";
import { productKey } from "@/src/lib/specs";
import { httpsUrl, type GroupItem } from "@/src/lib/view";
import StoreLogo from "./StoreLogo";
import { CardCompare, CardWatch, dealExplanation, formatMoney, type CompareControl } from "./ResultCard";

/** Rows shown before "Show N more". */
const VISIBLE_ROWS = 4;

const priceOf = (p: Product) => p.finalPrice ?? p.listPrice;

function Row({ p, best, color }: { p: Product; best: boolean; color?: string }) {
  const price = formatMoney(priceOf(p), p.currency);
  const store = storeLabel(p.site);
  const href = httpsUrl(p.url);
  const discount = p.discountPct ? Math.round(p.discountPct) : 0;
  return (
    <li className={best ? "gcard__row gcard__row--best" : "gcard__row"}>
      <span className="gcard__store">
        <StoreLogo id={p.site} size={18} />
        <span className="gcard__storename">{store}</span>
      </span>
      <span className="gcard__price">
        {p.site === "aliexpress" && <span className="card__from">from</span>}
        <span className="gcard__amount">{price}</span>
      </span>
      <span className="gcard__tags">
        {best && <span className="gcard__tag gcard__tag--best">Best price</span>}
        {discount > 0 && <span className="gcard__tag">{`−${discount}%`}</span>}
        {p.deal && (
          <span className={`deal deal--${p.deal.badge} gcard__deal`}>
            {p.deal.label}
            {p.deal.badge !== "fake-deal" && <span className="visually-hidden">. {dealExplanation(p.deal)}</span>}
          </span>
        )}
        {color && <span className="gcard__note">{color}</span>}
        {!isLikelyMatch(p) && <span className="gcard__note">Less likely match</span>}
      </span>
      {p.deal?.badge === "fake-deal" && <span className="deal__why gcard__why">{dealExplanation(p.deal)}</span>}
      {href ? (
        <a className="btn btn--quiet btn--small gcard__go" href={href} target="_blank" rel="noopener noreferrer">
          Go to store
          <span className="visually-hidden">{`: ${p.title} at ${store}, ${price} (opens in a new tab)`}</span>
        </a>
      ) : (
        <span className="gcard__nolink">No store link</span>
      )}
    </li>
  );
}

/**
 * The same product at several stores: the best member's picture and title, its price and store,
 * then a row per listing (cheapest confident first, highlighted). "Watch" and "Compare" act on the
 * best member.
 */
function GroupCard({ group: g, query, compareChecked = false, onCompare }: { group: GroupItem; query?: string } & CompareControl) {
  const [failed, setFailed] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const listId = useId();
  const b = g.best;
  const image = [b, ...g.rows].map((p) => p.image).find((src) => !!src && src !== failed);
  const extra = g.rows.length - VISIBLE_ROWS;
  const rows = open || extra <= 0 ? g.rows : g.rows.slice(0, VISIBLE_ROWS);
  const stores = `${g.storeCount} ${g.storeCount === 1 ? "store" : "stores"}`;

  return (
    <article className="card gcard">
      <div className="gcard__head">
        <div className="gcard__media">
          {image ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={image} alt="" width={160} height={160} loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={() => setFailed(image)} />
          ) : (
            <span className="card__noimg">No image</span>
          )}
        </div>
        <div className="gcard__lead">
          <h3 className="card__title">{b.title}</h3>
          <p className="gcard__best">
            Best price <span className="card__amount">{formatMoney(priceOf(b), b.currency)}</span> at{" "}
            <span className="gcard__beststore">
              <StoreLogo id={b.site} size={18} />
              {storeLabel(b.site)}
            </span>
          </p>
          <p className="gcard__count">Prices from {stores}</p>
          {!isLikelyMatch(b) && <p className="card__flag">Less likely match</p>}
        </div>
      </div>
      <ul className="gcard__rows" role="list" id={listId} aria-label={`Prices for ${b.title}`}>
        {rows.map((p) => (
          <Row key={productKey(p)} p={p} best={p === b} color={g.colors[`${p.site}:${p.id}`]} />
        ))}
      </ul>
      <div className="gcard__foot">
        {extra > 0 && (
          <button type="button" className="btn btn--quiet btn--small" aria-expanded={open} aria-controls={listId} onClick={() => setOpen(!open)}>
            {open ? "Show fewer" : `+${extra} more`}
            <span className="visually-hidden">{open ? "" : ` ${extra === 1 ? "price" : "prices"}`}</span>
          </button>
        )}
        <p className="card__ship">Shipping not included</p>
        {onCompare && <CardCompare product={b} checked={compareChecked} onCompare={onCompare} />}
        {query && <CardWatch key={productKey(b)} product={b} query={query} />}
      </div>
    </article>
  );
}

export default memo(GroupCard);
