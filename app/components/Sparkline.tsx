import type { PricePoint } from "@/src/lib/alerts/shared";

const W = 120;
const H = 32;
const PAD = 3;

/**
 * SVG path for the points, oldest left; a flat line when every price is the same. Points are
 * evenly spaced, or, with `xSpan`, placed by `at` on a 0..xSpan-1 axis so gaps show.
 */
export function sparkPath(points: PricePoint[], w = W, h = H, xSpan?: number): string {
  if (!points.length) return "";
  const prices = points.map((p) => p.price);
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const span = max - min;
  const step = points.length > 1 ? (w - PAD * 2) / (points.length - 1) : 0;
  return points
    .map((p, i) => {
      const x = xSpan && xSpan > 1 ? PAD + (p.at / (xSpan - 1)) * (w - PAD * 2) : PAD + i * step;
      const y = span ? PAD + (1 - (p.price - min) / span) * (h - PAD * 2) : h / 2;
      return `${i ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join(" ");
}

/**
 * Inline price history; the target (optional) is a dashed rule when it falls inside the range.
 * `span`: place points by `at` on a 0..span-1 axis (e.g. day of a 30-day window).
 */
export default function Sparkline({ points, target, label, span }: { points: PricePoint[]; target?: number; label: string; span?: number }) {
  if (points.length < 2) return <span className="spark__none">Not enough checks yet</span>;
  const prices = points.map((p) => p.price);
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const ty = target !== undefined && max > min && target >= min && target <= max ? PAD + (1 - (target - min) / (max - min)) * (H - PAD * 2) : null;
  return (
    <svg className="spark" viewBox={`0 0 ${W} ${H}`} width={W} height={H} role="img" aria-label={label}>
      {ty !== null && <line className="spark__target" x1={0} x2={W} y1={ty} y2={ty} />}
      <path className="spark__line" d={sparkPath(points, W, H, span)} />
    </svg>
  );
}
