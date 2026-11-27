const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ["day", 86_400_000],
  ["hour", 3_600_000],
  ["minute", 60_000],
];

/** "3 hours ago" style text for a past time (ms). */
function ago(at: number, now = Date.now()): string {
  const diff = at - now;
  const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
  for (const [unit, ms] of UNITS) if (Math.abs(diff) >= ms) return rtf.format(Math.round(diff / ms), unit);
  return "just now";
}

/** A <time> with relative text and the full date as its machine value and tooltip. */
export default function When({ at }: { at: number }) {
  const d = new Date(at);
  return (
    <time dateTime={d.toISOString()} title={d.toLocaleString("en-GB")}>
      {ago(at)}
    </time>
  );
}
