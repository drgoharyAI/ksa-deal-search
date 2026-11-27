/** A grey placeholder in the shape of what is loading; decorative, so hidden from screen readers. */
export default function Skeleton({ variant = "line" }: { variant?: "line" | "short" | "price" | "media" }) {
  return <span className={`skeleton skeleton--${variant}`} aria-hidden="true" />;
}

/** A result card's loading shape. */
export function SkeletonCard() {
  return (
    <div className="card card--skeleton" aria-hidden="true">
      <Skeleton variant="media" />
      <div className="card__body">
        <Skeleton />
        <Skeleton variant="short" />
        <Skeleton variant="price" />
      </div>
    </div>
  );
}
