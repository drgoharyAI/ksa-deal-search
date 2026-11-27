"use client";

import { createContext, memo, useContext, useId, useState } from "react";
import type { Product } from "@/src/lib/types";
import { storeLabel } from "@/src/lib/stores";
import { isLikelyMatch } from "@/src/lib/rank";
import { productKey } from "@/src/lib/specs";
import { httpsUrl, type GroupItem } from "@/src/lib/view";
import StoreLogo from "./StoreLogo";
import { CardCompare, CardMedia, CardWatch, dealExplanation, verifiedDiscount, type CompareControl } from "./ResultCard";
import { formatMoney } from "@/src/lib/money";
import Button from "./ui/Button";

/**
 * Which groups show all their rows, kept by the page so it survives the results changing under
 * the card (a streamed search adds stores, and a group's key changes when a member joins): a
 * group is open when any of its rows was in a group the user opened. Without a provider each
 * card keeps its own state.
 */
export type GroupOpen = { isOpen: (rowKeys: string[]) => boolean; setOpen: (rowKeys: string[], open: boolean) => void };
export const GroupOpenContext = createContext<GroupOpen | null>(null);

/** Rows shown before "Show N more". */
const VISIBLE_ROWS = 4;

const priceOf = (p: Product) => p.finalPrice ?? p.listPrice;

function Row({ p, best, color }: { p: Product; best: boolean; color?: string }) {
  const price = formatMoney(priceOf(p), p.currency);
  const store = storeLabel(p.site);
  const href = httpsUrl(p.url);
  const discount = verifiedDiscount(p) ?? 0;
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
        <Button size="sm" className="gcard__go" href={href} external>
          Go to store
          <span className="visually-hidden">{`: ${p.title} at ${store}, ${price} (opens in a new tab)`}</span>
        </Button>
      ) : (
        <span className="gcard__nolink">No store link</span>
      )}
    </li>
  );
}

/**
 * The same product at several stores: one picture and title, then a price ladder with a row per
 * listing, each linking to its store. "Best price" (accent) marks the lowest price in its currency,
 * and only when another row shares that currency. "Watch" and "Compare" act on the lead member.
 */
function GroupCard({ group: g, query, compareChecked = false, onCompare }: { group: GroupItem; query?: string } & CompareControl) {
  const shared = useContext(GroupOpenContext);
  const [localOpen, setLocalOpen] = useState(false);
  const rowKeys = g.rows.map(productKey);
  const open = shared ? shared.isOpen(rowKeys) : localOpen;
  const setOpen = (v: boolean) => (shared ? shared.setOpen(rowKeys, v) : setLocalOpen(v));
  const listId = useId();
  const b = g.best;
  // One picture for the whole card: the lead's, else the next member's (Carrefour gives none).
  const images = [b, ...g.rows].map((p) => p.image);
  const extra = g.rows.length - VISIBLE_ROWS;
  const rows = open || extra <= 0 ? g.rows : g.rows.slice(0, VISIBLE_ROWS);
  const stores = `${g.storeCount} ${g.storeCount === 1 ? "store" : "stores"}`;

  return (
    <article className={["card gcard", !isLikelyMatch(b) && "card--muted", compareChecked && "card--selected"].filter(Boolean).join(" ")}>
      <div className="gcard__head">
        <CardMedia src={images} site={b.site} className="gcard__media" size={160} />
        <div className="gcard__lead">
          <h3 className="card__title" title={b.title}>
            {b.title}
          </h3>
          <p className="gcard__best">
            {g.bestPrice ? "Best price" : "Listed at"} <span className="card__amount">{formatMoney(priceOf(b), b.currency)}</span> at{" "}
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
          <Row key={productKey(p)} p={p} best={p === g.bestPrice} color={g.colors[`${p.site}:${p.id}`]} />
        ))}
      </ul>
      <div className="gcard__foot">
        {extra > 0 && (
          <Button size="sm" variant="ghost" aria-expanded={open} aria-controls={listId} onClick={() => setOpen(!open)}>
            {open ? "Show fewer" : `+${extra} more`}
            <span className="visually-hidden">{open ? "" : ` ${extra === 1 ? "price" : "prices"}`}</span>
          </Button>
        )}
        {onCompare && <CardCompare product={b} checked={compareChecked} onCompare={onCompare} />}
        {query && <CardWatch key={productKey(b)} product={b} query={query} />}
      </div>
    </article>
  );
}

export default memo(GroupCard);
