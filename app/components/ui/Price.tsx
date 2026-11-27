import { formatMoney } from "@/src/lib/money";

type Props = {
  amount: number;
  /** The item's own currency; never borrowed from another item. Empty falls back to SAR. */
  currency: string;
  /** A higher earlier price in the same currency, shown struck through. */
  original?: number | null;
  /** Percent off, shown only when `discountFrom` says what backs it. */
  discountPct?: number | null;
  /**
   * What the percent is measured against: "store", the store's own "was" price (not verified by
   * us); "history", the highest price we observed. Without it no percent is shown.
   */
  discountFrom?: "store" | "history";
  /** "from" before the amount (a store that lists its lowest variant). */
  from?: boolean;
  size?: "sm" | "md" | "lg";
  /** Words before the struck price ("was", "highest seen"); for screen readers only unless `showOriginalLabel`. */
  originalLabel?: string;
  /** Show `originalLabel` on screen, e.g. when the struck price is ours, not the store's "was". */
  showOriginalLabel?: boolean;
};

/** The current price set large, the struck original after it, and the percent off it. */
export default function Price({ amount, currency, original, discountPct, discountFrom, from = false, size = "md", originalLabel = "was", showOriginalLabel = false }: Props) {
  const showOrig = typeof original === "number" && Number.isFinite(original) && original > amount;
  const pct = discountFrom && typeof discountPct === "number" && discountPct >= 1 ? Math.round(discountPct) : 0;
  return (
    <p className={`price price--${size}`}>
      {from && <span className="price__from">from</span>}
      <span className="price__amount">{formatMoney(amount, currency)}</span>
      {showOrig && (
        <span className="price__was">
          {showOriginalLabel ? <span className="price__was-label">{originalLabel} </span> : <span className="visually-hidden">{originalLabel} </span>}
          <s className="price__orig">{formatMoney(original, currency)}</s>
        </span>
      )}
      {pct > 0 && (
        <span className={discountFrom === "store" ? "price__off price__off--store" : "price__off"}>
          {`−${pct}%`}
          <span className="visually-hidden">{discountFrom === "store" ? " off the store's was price" : " below the highest price we've seen"}</span>
        </span>
      )}
    </p>
  );
}
