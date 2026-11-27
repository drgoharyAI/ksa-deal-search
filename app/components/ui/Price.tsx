import { formatMoney } from "@/src/lib/money";

type Props = {
  amount: number;
  /** The item's own currency; never borrowed from another item. Empty falls back to SAR. */
  currency: string;
  /** A higher earlier price in the same currency, shown struck through. */
  original?: number | null;
  /** Percent off, shown only when `verified` (backed by the store's "was" price or our observations). */
  discountPct?: number | null;
  verified?: boolean;
  /** "from" before the amount (a store that lists its lowest variant). */
  from?: boolean;
  size?: "sm" | "md" | "lg";
  /** Words read before the struck price ("was", "seen at"). */
  originalLabel?: string;
};

/** The current price set large, the struck original after it, and a verified discount. */
export default function Price({ amount, currency, original, discountPct, verified = false, from = false, size = "md", originalLabel = "was" }: Props) {
  const showOrig = typeof original === "number" && Number.isFinite(original) && original > amount;
  const pct = verified && typeof discountPct === "number" && discountPct >= 1 ? Math.round(discountPct) : 0;
  return (
    <p className={`price price--${size}`}>
      {from && <span className="price__from">from</span>}
      <span className="price__amount">{formatMoney(amount, currency)}</span>
      {showOrig && (
        <s className="price__orig">
          <span className="visually-hidden">{originalLabel} </span>
          {formatMoney(original, currency)}
        </s>
      )}
      {pct > 0 && (
        <span className="price__off">
          {`−${pct}%`}
          <span className="visually-hidden"> off</span>
        </span>
      )}
    </p>
  );
}
