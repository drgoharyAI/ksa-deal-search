"use client";

import { createContext, useContext, useId, useState } from "react";
import type { Product } from "@/src/lib/types";
import { SPEC_ROWS, brandLabel, parseSpecs, productKey } from "@/src/lib/specs";
import { storeLabel } from "@/src/lib/stores";
import { httpsUrl } from "@/src/lib/view";
import { formatMoney } from "@/src/lib/money";
import { isFromPrice } from "@/src/lib/discount";
import { Trend, dealExplanation } from "./ResultCard";
import { viewHandlers } from "./Saved";
import Button from "./ui/Button";
import StoreMark from "./ui/StoreMark";
import GshopCheck from "./GshopCheck";

/**
 * What an expanded card reads from the results on screen: other listings like this one (from the
 * grouping rules, src/lib/match/related.ts) and each product's brand (chips.ts reads it over the
 * whole result set). No store is contacted.
 */
export type DetailsSource = {
  related: (p: Product, exclude?: readonly string[]) => Product[];
  brand: (p: Product) => string | undefined;
};
export const DetailsContext = createContext<DetailsSource | null>(null);

const priceOf = (p: Product) => p.finalPrice ?? p.listPrice;

/** The rows of the details list: brand, then each spec the title states. Pure. */
export function detailRows(p: Product, brand?: string): { label: string; value: string }[] {
  const specs = parseSpecs(p.title);
  const rows = brand ? [{ label: "Brand", value: brandLabel(brand) }] : [];
  for (const s of SPEC_ROWS) {
    const v = specs[s.key];
    if (v) rows.push({ label: s.label, value: v });
  }
  return rows;
}

function Related({ items }: { items: Product[] }) {
  if (!items.length) return null;
  return (
    <div className="details__part">
      <h4 className="details__head">Other listings like this</h4>
      <p className="details__note">From these results only.</p>
      <ul className="related" role="list">
        {items.map((r) => {
          const href = httpsUrl(r.url);
          return (
            <li key={productKey(r)} className="related__item">
              <StoreMark id={r.site} size={16} variant="compact" />
              <span className="related__title" dir="auto">
                {href ? (
                  <a href={href} target="_blank" rel="noopener noreferrer" {...viewHandlers(r)}>
                    {r.title}
                    <span className="visually-hidden">{` at ${storeLabel(r.site)} (opens in a new tab)`}</span>
                  </a>
                ) : (
                  r.title
                )}
              </span>
              <span className="related__price">
                {isFromPrice(r) && <span className="card__from">from </span>}
                {formatMoney(priceOf(r), r.currency)}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** The open panel's content (exported for tests). */
export function DetailsBody({ p, exclude, source }: { p: Product; exclude?: readonly string[]; source: DetailsSource | null }) {
  const rows = detailRows(p, source?.brand(p));
  const href = httpsUrl(p.url);
  const history = p.trend && p.trend.points.length >= 2;
  const related = source ? source.related(p, exclude) : [];
  return (
    <>
      <div className="details__part">
        <h4 className="details__head">Full title</h4>
        <p className="details__title" dir="auto">
          {p.title}
        </p>
      </div>
      <div className="details__part">
        <h4 className="details__head">Specs</h4>
        {rows.length ? (
          <dl className="details__specs">
            {rows.map((r) => (
              <div key={r.label} className="details__spec">
                <dt>{r.label}</dt>
                <dd>{r.value}</dd>
              </div>
            ))}
          </dl>
        ) : (
          <p className="details__note">The store&apos;s title names no specs.</p>
        )}
        {rows.length > 0 && <p className="details__note">Read from the title; check the store page before you buy.</p>}
      </div>
      <div className="details__part">
        <h4 className="details__head">Price history</h4>
        {history && p.trend ? <Trend trend={p.trend} title={p.title} /> : null}
        {p.deal ? (
          <p className="details__note">
            <span className={`deal deal--${p.deal.badge}`}>{p.deal.label}</span> {dealExplanation(p.deal)}
          </p>
        ) : null}
        {!history && !p.deal && <p className="details__note">No price history yet. Searches that list it again build one.</p>}
      </div>
      <div className="details__part">
        <h4 className="details__head">Other Saudi stores</h4>
        <GshopCheck product={p} />
      </div>
      <div className="details__part">
        {href ? (
          <Button size="sm" variant="secondary" href={href} external {...viewHandlers(p)}>
            View on {storeLabel(p.site)}
            <span className="visually-hidden">{`: ${p.title} (opens in a new tab)`}</span>
          </Button>
        ) : (
          <span className="card__nolink">No store link</span>
        )}
      </div>
      <Related items={related} />
    </>
  );
}

/**
 * "Details": an accessible disclosure (a button with aria-expanded and aria-controls) that opens
 * the full title, the specs read from it, our price history and the store link, then other
 * listings like this one from the same results. The panel is drawn only while open.
 * `exclude`: product keys not to offer as related (a group card's own rows).
 */
export default function CardDetails({ product: p, exclude }: { product: Product; exclude?: readonly string[] }) {
  const [open, setOpen] = useState(false);
  const source = useContext(DetailsContext);
  const id = useId();
  return (
    <div className="details">
      <button type="button" className="details__toggle" aria-expanded={open} aria-controls={id} onClick={() => setOpen((o) => !o)}>
        {open ? "Hide details" : "Details"}
        <span className="visually-hidden">{` for ${p.title}`}</span>
      </button>
      <div id={id} className="details__panel" hidden={!open}>
        {open && <DetailsBody p={p} exclude={exclude} source={source} />}
      </div>
    </div>
  );
}
