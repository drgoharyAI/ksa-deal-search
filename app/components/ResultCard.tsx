"use client";

import { memo, useState } from "react";
import type { DealInsight, PriceTrend, Product } from "@/src/lib/types";
import { storeLabel } from "@/src/lib/stores";
import { isLikelyMatch } from "@/src/lib/rank";
import StoreLogo from "./StoreLogo";
import WatchForm, { postWatch } from "./WatchForm";
import { defaultTarget } from "@/src/lib/alerts/shared";
import Sparkline from "./Sparkline";

const NBSP = " ";

const DEAL_EXPLAIN: Record<DealInsight["badge"], string> = {
  "fake-deal": "The discount does not hold up against the prices we've seen",
  "lowest-30d": "Lowest price we've seen in 30 days",
  "below-usual": "More than 10% under its usual price over the last 30 days",
  normal: "In line with the prices we've seen over the last 30 days",
};

/** The explanation for a deal badge; a fake deal names the rule that fired. */
export function dealExplanation(d: DealInsight): string {
  return d.badge === "fake-deal" && d.reason ? d.reason : DEAL_EXPLAIN[d.badge];
}

/** "↓12% vs last week" for sighted readers, "Down 12% vs last week" for screen readers. */
export function trendChange(pct: number): { arrow: string; spoken: string; text: string } {
  if (pct === 0) return { arrow: "", spoken: "", text: "Same as last week" };
  const down = pct < 0;
  return { arrow: down ? "↓" : "↑", spoken: down ? "Down " : "Up ", text: `${Math.abs(pct)}% vs last week` };
}

/**
 * The badge. A fake deal shows its reason as visible text under the badge (no hover needed, read
 * once); the other badges explain themselves to screen readers only.
 */
export function DealBadge({ deal }: { deal: DealInsight }) {
  const explain = dealExplanation(deal);
  const visible = deal.badge === "fake-deal";
  return (
    <div className="card__deal">
      <p className={`deal deal--${deal.badge}`}>
        {deal.label}
        {!visible && <span className="visually-hidden">. {explain}</span>}
      </p>
      {visible && <p className="deal__why">{explain}</p>}
    </div>
  );
}

function Trend({ trend, title }: { trend: PriceTrend; title: string }) {
  const change = trend.changePct7d === undefined ? null : trendChange(trend.changePct7d);
  const first = trend.points[0].day;
  const span = trend.points[trend.points.length - 1].day - first + 1;
  return (
    <div className="card__trend">
      <Sparkline
        points={trend.points.map((pt) => ({ at: pt.day - first, price: pt.price }))}
        span={span}
        label={`Lowest price per day for ${title}, over ${span} days`}
      />
      {change && (
        <span className="card__change">
          {change.arrow && <span aria-hidden="true">{change.arrow}</span>}
          {change.spoken && <span className="visually-hidden">{change.spoken}</span>}
          {change.text}
        </span>
      )}
    </div>
  );
}

export function formatMoney(n: number, currency = "SAR"): string {
  const digits = Number.isInteger(n) ? 0 : 2;
  const num = n.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: 2 });
  return `${currency || "SAR"}${NBSP}${num}`;
}

/**
 * A card's "Compare" checkbox. `onCompare` gets the product, so one stable function serves every
 * card and memoized cards re-render only when their own ticked state changes.
 */
export type CompareControl = { compareChecked?: boolean; onCompare?: (p: Product) => void };

export function CardCompare({ product: p, checked, onCompare }: { product: Product; checked: boolean; onCompare: (p: Product) => void }) {
  return (
    <label className="card__compare">
      <input type="checkbox" checked={checked} onChange={() => onCompare(p)} />
      Compare
      <span className="visually-hidden"> {p.title}</span>
    </label>
  );
}

/** "Watch": a price alert on this product, opened in place. */
export function CardWatch({ product: p, query }: { product: Product; query: string }) {
  const [watch, setWatch] = useState<"closed" | "open" | "saved">("closed");
  const price = p.finalPrice ?? p.listPrice;
  return (
    <div className="card__watch">
      {watch === "open" ? (
        <WatchForm
          label={`Alert me at or under, ${p.currency || "SAR"}`}
          initial={defaultTarget(price)}
          onCancel={() => setWatch("closed")}
          onSave={async (target) => {
            const err = await postWatch({
              kind: "product",
              site: p.site,
              productId: p.id,
              query,
              target,
              title: p.title,
              url: p.url,
              image: p.image || undefined,
              price,
              currency: p.currency || "SAR",
            });
            if (!err) setWatch("saved");
            return err;
          }}
        />
      ) : watch === "saved" ? null : (
        <button type="button" className="btn btn--quiet btn--small" onClick={() => setWatch("open")}>
          Watch
          <span className="visually-hidden"> {p.title}</span>
        </button>
      )}
      {/* Always in the page, so screen readers announce the text when it changes. */}
      <p className={watch === "saved" ? "card__watched" : "visually-hidden"} role="status">
        {watch === "saved" && (
          <>
            Watching. <a href="/alerts">See alerts</a>
          </>
        )}
      </p>
    </div>
  );
}

/**
 * `query`: the search this card came from; with it the card offers a price alert ("Watch").
 * `onCompare`: with it the card offers a "Compare" checkbox (`compareChecked`: ticked).
 */
function ResultCard({ product: p, query, compareChecked = false, onCompare }: { product: Product; query?: string } & CompareControl) {
  const [imgFailed, setImgFailed] = useState(false);
  const price = p.finalPrice ?? p.listPrice;
  const showImage = !!p.image && !imgFailed;
  const discount = p.discountPct ? Math.round(p.discountPct) : 0;
  const hasOrig = p.origPrice !== null && p.origPrice > price;

  return (
    <article className="card">
      <div className="card__media">
        {showImage ? (
          // Remote store images: plain <img> keeps Next's image optimizer off the five stores' CDNs.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={p.image}
            alt=""
            width={400}
            height={400}
            loading="lazy"
            decoding="async"
            referrerPolicy="no-referrer"
            onError={() => setImgFailed(true)}
          />
        ) : (
          <span className="card__noimg">No image</span>
        )}
        {discount > 0 && <span className="card__badge">{`−${discount}%`}</span>}
      </div>
      <div className="card__body">
        <span className="card__store">
          <StoreLogo id={p.site} size={18} />
          <span className="card__storename">{storeLabel(p.site)}</span>
          {!isLikelyMatch(p) && <span className="card__flag"> · Less likely match</span>}
        </span>
        <h3 className="card__title">
          <a className="card__link" href={p.url} target="_blank" rel="noopener noreferrer">
            {p.title}
            <span className="visually-hidden"> (opens in a new tab)</span>
          </a>
        </h3>
        <p className="card__price">
          {p.site === "aliexpress" && <span className="card__from">from</span>}
          <span className="card__amount">{formatMoney(price, p.currency)}</span>
          {hasOrig && (
            <s className="card__orig">
              <span className="visually-hidden">was </span>
              {formatMoney(p.origPrice as number, p.currency)}
            </s>
          )}
        </p>
        {p.deal && <DealBadge deal={p.deal} />}
        {p.trend && p.trend.points.length >= 2 && <Trend trend={p.trend} title={p.title} />}
        <p className="card__ship">Shipping not included</p>
        {(p.rating !== null || p.soldCount > 0) && (
          <p className="card__meta">
            {p.rating !== null && <span>Rated {p.rating.toFixed(1)} of 5</span>}
            {p.soldCount > 0 && <span>{p.soldCount.toLocaleString("en-US")} sold</span>}
          </p>
        )}
        {p.ratingUnavailable && <p className="card__meta">No rating</p>}
        {onCompare && <CardCompare product={p} checked={compareChecked} onCompare={onCompare} />}
        {query && <CardWatch product={p} query={query} />}
      </div>
    </article>
  );
}

export default memo(ResultCard);
