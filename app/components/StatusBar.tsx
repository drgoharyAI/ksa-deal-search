import type { StoreEntry } from "@/src/lib/search-stream";
import StoreMark from "./ui/StoreMark";

type Props = {
  /** One entry per store asked, in the form's order (storeEntries()). */
  stores: StoreEntry[];
  /** The search was stopped: stores that had not answered say so instead of "Searching". */
  stopped?: boolean;
  /** Formats a retry time; injectable so tests do not depend on the machine's time zone. */
  formatTime?: (ms: number) => string;
};

const plural = (n: number) => `${n} ${n === 1 ? "result" : "results"}`;
const clock = (ms: number) => new Date(ms).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });

/** The words for a store's state; never a number the backend did not give. */
export function storeStateText(e: StoreEntry, stopped = false, formatTime = clock): { text: string; detail?: string } {
  switch (e.state) {
    case "searching":
      return { text: stopped ? "Stopped" : "Searching" };
    case "ok":
      return e.count !== undefined ? { text: plural(e.count), detail: e.partial ? "some pages failed" : undefined } : { text: "Answered" };
    case "empty":
      return { text: "No results", detail: e.partial ? "some pages failed" : undefined };
    case "unavailable":
      return { text: "Temporarily unavailable", detail: e.retryAt !== undefined ? `try after ${formatTime(e.retryAt)}` : undefined };
    case "failed":
      return { text: "Failed" };
  }
}

/**
 * The live store row: each store's mark and, in words, where its answer stands. A store still
 * searching shows a quiet moving hairline (still under reduced motion), never a percentage. The
 * row is a list, not a live region: the page announces one short summary at milestones instead.
 */
export default function StatusBar({ stores, stopped = false, formatTime = clock }: Props) {
  if (!stores.length) return null;
  return (
    <ul className="storestatus" aria-label="Store status">
      {stores.map((e) => {
        const { text, detail } = storeStateText(e, stopped, formatTime);
        const state = e.state === "searching" && stopped ? "stopped" : e.state;
        return (
          <li key={e.store} className={`storestatus__item storestatus__item--${state}`}>
            <StoreMark id={e.store} size={20} />
            <span className="storestatus__state">
              {text}
              {detail && <span className="storestatus__detail">{detail}</span>}
            </span>
            {state === "searching" && <span className="storestatus__pulse" aria-hidden="true" />}
          </li>
        );
      })}
    </ul>
  );
}
