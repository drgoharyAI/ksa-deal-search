import type { ReactNode } from "react";

type BadgeTone = "neutral" | "accent" | "warn" | "count";

/** A short label in words (never a dot). "count" is the round number badge, e.g. unseen alerts. */
export default function Badge({ tone = "neutral", children, className }: { tone?: BadgeTone; children: ReactNode; className?: string }) {
  return <span className={["badge", `badge--${tone}`, className].filter(Boolean).join(" ")}>{children}</span>;
}
