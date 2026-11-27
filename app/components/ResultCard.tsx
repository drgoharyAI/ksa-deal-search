"use client";

import { memo, useState } from "react";
import type { DealInsight, PriceTrend, Product } from "@/src/lib/types";
import { storeLabel } from "@/src/lib/stores";
import { isLikelyMatch } from "@/src/lib/rank";
import { httpsUrl } from "@/src/lib/view";
import { verifiedDiscount, wasPrice } from "@/src/lib/discount";
import StoreLogo from "./StoreLogo";
import WatchForm, { postWatch } from "./WatchForm";
import { defaultTarget } from "@/src/lib/alerts/shared";
import Sparkline from "./Sparkline";
import Button from "./ui/Button";
import Price from "./ui/Price";
import StoreMark from "./ui/StoreMark";

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
function DealBadge({ deal }: { deal: DealInsight }) {
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
        <Button size="sm" variant="ghost" className="card__watchbtn" onClick={() => setWatch("open")}>
          Watch
          <span className="visually-hidden"> {p.title}</span>
        </Button>
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

/** The view a card is drawn in: a grid card, or a compact list row. */
export type CardVariant = "grid" | "list";

/**
 * The picture box: the store's image at a fixed ratio, or a quiet placeholder with the store's
 * mark. `src` may list several pictures (a group's members): a broken one gives way to the next.
 */
export function CardMedia({ src, site, className = "card__media", size = 400 }: { src: string | string[]; site: string; className?: string; size?: number }) {
  const [failed, setFailed] = useState<ReadonlySet<string>>(() => new Set());
  const show = (Array.isArray(src) ? src : [src]).find((s) => !!s && !failed.has(s));
  return (
    <div className={className}>
      {show ? (
        // Remote store images: plain <img> keeps Next's image optimizer off the stores' CDNs.
        // eslint-disable-next-line @next/next/no-img-element
        <img src={show} alt="" width={size} height={size} loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={() => setFailed((f) => new Set(f).add(show))} />
      ) : (
        <span className="noimg">
          <StoreLogo id={site} size={24} />
          <span className="noimg__text">No image</span>
        </span>
      )}
    </div>
  );
}

/**
 * `query`: the search this card came from; with it the card offers a price alert ("Watch").
 * `onCompare`: with it the card offers a "Compare" checkbox (`compareChecked`: ticked).
 * `variant`: a grid card or a compact list row. A less likely match is drawn muted either way.
 */
function ResultCard({ product: p, query, compareChecked = false, onCompare, variant = "grid" }: { product: Product; query?: string; variant?: CardVariant } & CompareControl) {
  const price = p.finalPrice ?? p.listPrice;
  const store = storeLabel(p.site);
  const likely = isLikelyMatch(p);
  const href = httpsUrl(p.url);
  const discount = verifiedDiscount(p);
  const cls = ["card", `card--${variant}`, !likely && "card--muted", compareChecked && "card--selected"].filter(Boolean).join(" ");

  return (
    <article className={cls}>
      <CardMedia src={p.image} site={p.site} />
      <div className="card__body">
        <div className="card__store">
          <StoreMark id={p.site} size={18} />
          {!likely && <span className="card__flag">Less likely match</span>}
        </div>
        <h3 className="card__title" title={p.title}>
          {p.title}
        </h3>
        <Price amount={price} currency={p.currency} original={wasPrice(p)} discountPct={discount} verified={discount !== null} from={p.site === "aliexpress"} size="md" />
        {(p.rating !== null || p.soldCount > 0 || p.ratingUnavailable) && (
          <p className="card__meta">
            {p.rating !== null && <span>Rated {p.rating.toFixed(1)} of 5</span>}
            {p.soldCount > 0 && <span>{p.soldCount.toLocaleString("en-US")} sold</span>}
            {p.ratingUnavailable && <span>No rating from this store</span>}
          </p>
        )}
        {p.deal && <DealBadge deal={p.deal} />}
        {p.trend && p.trend.points.length >= 2 && <Trend trend={p.trend} title={p.title} />}
        <div className="card__actions">
          {href ? (
            <Button size="sm" className="card__go" href={href} external>
              View on {store}
              <span className="visually-hidden">{`: ${p.title} (opens in a new tab)`}</span>
            </Button>
          ) : (
            <span className="card__nolink">No store link</span>
          )}
          {(onCompare || query) && (
            <div className="card__more">
              {onCompare && <CardCompare product={p} checked={compareChecked} onCompare={onCompare} />}
              {query && <CardWatch product={p} query={query} />}
            </div>
          )}
        </div>
      </div>
    </article>
  );
}

export default memo(ResultCard);
