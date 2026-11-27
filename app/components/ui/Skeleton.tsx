/** A grey placeholder in the shape of what is loading; decorative, so hidden from screen readers. */
export default function Skeleton({ variant = "line" }: { variant?: "line" | "short" | "price" | "media" | "action" }) {
  return <span className={`skeleton skeleton--${variant}`} aria-hidden="true" />;
}

/** A result card's loading shape, in the grid or as a list row: picture, store, title, price, action. */
export function SkeletonCard({ variant = "grid" }: { variant?: "grid" | "list" }) {
  return (
    <div className={`card card--${variant} card--skeleton`} aria-hidden="true">
      <div className="card__media">
        <Skeleton variant="media" />
      </div>
      <div className="card__body">
        <Skeleton variant="short" />
        <Skeleton />
        <Skeleton variant="short" />
        <Skeleton variant="price" />
        <Skeleton variant="action" />
      </div>
    </div>
  );
}
