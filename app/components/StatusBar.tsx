import type { SiteStatus } from "@/src/lib/types";
import { storeLabel } from "@/src/lib/stores";
import StoreMark from "./ui/StoreMark";

type Props = {
  /** Stores being searched right now (loading), or null when settled. */
  pending: string[] | null;
  statuses: SiteStatus[];
  /** Result count per store id, from the current products. */
  counts: Record<string, number>;
};

/** "Store blocked the request; …" from the server becomes "AliExpress blocked the request; …". */
function storeMessage(site: string, message: string): string {
  const label = storeLabel(site);
  return message.startsWith("Store ") ? `${label} ${message.slice(6)}` : `${label}: ${message}`;
}

const plural = (n: number) => `${n} ${n === 1 ? "result" : "results"}`;

export default function StatusBar({ pending, statuses, counts }: Props) {
  if (pending) {
    return (
      <ul className="status" aria-label="Store status">
        {pending.map((site) => (
          <li key={site} className="status__item status__item--loading">
            <StoreMark id={site} size={22} />
            <span className="status__text">Searching</span>
          </li>
        ))}
      </ul>
    );
  }
  if (!statuses.length) return null;
  return (
    <ul className="status" aria-label="Store status">
      {statuses.map((s) => {
        const n = counts[s.site] ?? 0;
        let text: string;
        if (s.status === "ok") text = s.message ? `${plural(n)}, ${s.message}` : plural(n);
        else text = storeMessage(s.site, s.message ?? (s.status === "blocked" ? "Store blocked the request; try again later" : "Store request failed"));
        return (
          <li key={s.site} className={`status__item status__item--${s.status}`}>
            {s.status === "ok" && (
              <StoreMark id={s.site} size={22} />
            )}
            <span className="status__text">{text}</span>
          </li>
        );
      })}
    </ul>
  );
}
