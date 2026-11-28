import type { StoreEntry } from "@/src/lib/search-stream";
import { storeLabel } from "@/src/lib/stores";
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

/**
 * The words for each state the status row knows: `text`, the short label the cell shows on its
 * first line; `full`, the whole wording (the cell's tooltip and screen-reader text).
 */
const STATE_LABELS: Record<string, { text: string; full: string }> = {
  empty: { text: "No results", full: "No results" },
  unavailable: { text: "Unavailable", full: "Temporarily unavailable" },
  failed: { text: "Failed", full: "Failed" },
  unsupported: { text: "English only", full: "English only" },
};

/** The states the row styles by name; any other (newer) state is drawn as "other". */
const STYLED = new Set(["searching", "stopped", "ok", "empty", "unavailable", "failed", "unsupported"]);

/** A state name this client does not know, in words: "arabic-only" reads "Arabic only". */
const fallbackLabel = (state: string): string => {
  const words = state.replace(/[-_]+/g, " ").trim();
  return words ? words[0].toUpperCase() + words.slice(1) : "Status unknown";
};

/**
 * The words for a store's state; never a number the backend did not give. `text` and `detail` are
 * the cell's two lines; `full` is everything, for the tooltip and screen readers.
 */
export function storeStateText(e: StoreEntry, stopped = false, formatTime = clock): { text: string; detail?: string; full: string } {
  const withFull = (text: string, detail: string | undefined, long = text) => ({ text, detail, full: detail ? `${long}, ${detail}` : long });
  switch (e.state) {
    case "searching":
      return withFull(stopped ? "Stopped" : "Searching", undefined);
    case "ok":
      return e.count !== undefined ? withFull(plural(e.count), e.partial ? "some pages failed" : undefined) : withFull("Answered", undefined);
    case "empty":
      return withFull(STATE_LABELS.empty.text, e.partial ? "some pages failed" : undefined);
    case "unavailable":
      return withFull(STATE_LABELS.unavailable.text, e.retryAt !== undefined ? `try after ${formatTime(e.retryAt)}` : undefined, STATE_LABELS.unavailable.full);
    case "unsupported":
      return withFull(STATE_LABELS.unsupported.text, "English search terms only");
    default: {
      const label = STATE_LABELS[e.state] ?? { text: fallbackLabel(e.state), full: fallbackLabel(e.state) };
      return withFull(label.text, undefined, label.full);
    }
  }
}

/**
 * The live store row: each store's mark and, in words, where its answer stands. A store still
 * searching shows a quiet moving hairline (still under reduced motion), never a percentage. The
 * row is a list, not a live region: the page announces one short summary at milestones instead.
 * Each cell keeps two lines for the state from the start (a short label, then its detail), so a
 * state arriving mid-stream never moves the page; the whole wording is its tooltip and, for screen
 * readers, hidden text (the visible lines may be cut short in a narrow cell).
 */
export default function StatusBar({ stores, stopped = false, formatTime = clock }: Props) {
  if (!stores.length) return null;
  return (
    <ul className="storestatus" aria-label="Store status">
      {stores.map((e) => {
        const { text, detail, full } = storeStateText(e, stopped, formatTime);
        const state = e.state === "searching" && stopped ? "stopped" : e.state;
        return (
          <li key={e.store} className={`storestatus__item storestatus__item--${STYLED.has(state) ? state : "other"}`} title={`${storeLabel(e.store)}: ${full}`}>
            <StoreMark id={e.store} size={20} />
            <span className="storestatus__state" aria-hidden="true">
              <span className="storestatus__label">{text}</span>
              {detail && <span className="storestatus__detail">{detail}</span>}
            </span>
            <span className="visually-hidden">{full}</span>
            {state === "searching" && <span className="storestatus__pulse" aria-hidden="true" />}
          </li>
        );
      })}
    </ul>
  );
}
