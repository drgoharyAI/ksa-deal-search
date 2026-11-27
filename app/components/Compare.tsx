"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import type { Product } from "@/src/lib/types";
import { MAX_COMPARE, MIN_COMPARE, compareRows, onlyDifferences, type CompareRow, type CompareSlot } from "@/src/lib/compare";
import { productKey } from "@/src/lib/specs";
import { storeLabel } from "@/src/lib/stores";
import { httpsUrl } from "@/src/lib/view";
import { CardMedia, Trend, dealExplanation } from "./ResultCard";
import StoreLogo from "./StoreLogo";
import Button from "./ui/Button";
import StoreMark from "./ui/StoreMark";

/** What a ticked product that is not in the current results is called. */
const GONE = "No longer in results";
/** While a search is still streaming, a ticked product may simply not have arrived yet. */
const WAITING = "Not in results yet";

/** A slot's name for people: its title when known, else its store. */
const slotName = (s: CompareSlot) => s.product?.title ?? s.snap?.title ?? `A product from ${storeLabel(s.site)}`;

type TrayProps = {
  slots: CompareSlot[];
  /** Set when a product past the limit was refused. */
  full: boolean;
  /** A search is streaming: a missing product may still arrive. */
  waiting: boolean;
  onRemove: (key: string) => void;
  onClear: () => void;
  onOpen: () => void;
  /** Offered when the ticked products came from a search that is not on screen (after a reload). */
  rerun?: { query: string; onRun: () => void };
};

/**
 * The compare tray, docked to the foot of the screen while anything is ticked: a picture (or the
 * store's mark) per product, each a button that removes it, a note, "Clear" and "Compare (N)".
 * N counts the products that can be compared now; one that left the results says so.
 */
export function CompareTray({ slots, full, waiting, onRemove, onClear, onOpen, rerun }: TrayProps) {
  const live = slots.filter((s) => s.product).length;
  const gone = slots.length - live;
  // Nothing ticked is on screen and no search can be offered (a shared link opened in another
  // browser): say what to do, and offer no action that cannot work. Shareable result URLs are U5.
  const orphaned = live === 0 && gone > 0 && !waiting && !rerun;
  let note = "";
  if (full) note = `You can compare up to ${MAX_COMPARE} products. Remove one to add another.`;
  else if (orphaned) note = "Open the original search to see these products.";
  else if (gone > 0 && !waiting) note = gone === 1 ? "1 ticked product is no longer in the results." : `${gone} ticked products are no longer in the results.`;
  else if (live > 0 && live < MIN_COMPARE) note = "Tick one more product to compare.";
  // After a chip removes itself, focus goes to the next chip (or the one before), else to Clear,
  // so it never falls to the page or onto a disabled button.
  const root = useRef<HTMLElement>(null);
  const refocus = useRef<number | null>(null);
  useEffect(() => {
    const i = refocus.current;
    if (i === null) return;
    refocus.current = null;
    const chips = root.current?.querySelectorAll<HTMLElement>(".tray__chip");
    if (chips && chips.length) chips[Math.min(i, chips.length - 1)].focus();
    else root.current?.querySelector<HTMLElement>(".tray__clear")?.focus();
  }, [slots]);
  return (
    <section ref={root} className="tray" aria-label="Compare products" hidden={slots.length === 0}>
      <div className="container tray__inner">
        <ul className="tray__items" role="list">
          {slots.map((s, i) => {
            const image = s.product?.image ?? s.snap?.image ?? "";
            return (
              <li key={s.key} className={s.product ? "tray__item" : "tray__item tray__item--gone"}>
                <button
                  type="button"
                  className="tray__chip"
                  onClick={() => {
                    refocus.current = i;
                    onRemove(s.key);
                  }}
                >
                  <span className="tray__thumb">
                    {image ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={image} alt="" width={40} height={40} loading="lazy" decoding="async" referrerPolicy="no-referrer" />
                    ) : (
                      <StoreLogo id={s.site} size={20} />
                    )}
                  </span>
                  <span className="tray__text">
                    <span className="tray__title">{slotName(s)}</span>
                    {!s.product && <span className="tray__gone">{waiting ? WAITING : GONE}</span>}
                    <span className="tray__remove">
                      Remove<span className="visually-hidden">{` ${slotName(s)} from compare`}</span>
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
        <p className={full ? "tray__note tray__note--full" : "tray__note"} role="status">
          {note}
        </p>
        <div className="tray__actions">
          {rerun && (
            <Button size="md" variant="secondary" onClick={rerun.onRun}>
              {`Search "${rerun.query}" again`}
            </Button>
          )}
          <Button size="md" variant="ghost" className="tray__clear" onClick={onClear}>
            Clear
          </Button>
          {!orphaned && (
            <Button size="md" variant="primary" className="tray__open" disabled={live < MIN_COMPARE} onClick={onOpen}>
              Compare ({live})
            </Button>
          )}
        </div>
      </div>
    </section>
  );
}

/** One table cell: the value as the row wants it drawn, or a muted "Not listed". */
function Cell({ r, i, p }: { r: CompareRow; i: number; p: Product }) {
  const c = r.cells[i];
  if (c === null) return <span className="cmp__none">{r.empty ?? "Not listed"}</span>;
  if (r.key === "price") {
    const from = !!r.from?.[i];
    return (
      <>
        {from && <span className="cmp__from">from </span>}
        <span className="cmp__amount">{from ? c.replace(/^from /, "") : c}</span>
        {r.lowest?.[i] && <span className="cmp__tag">Lowest price</span>}
      </>
    );
  }
  if (r.key === "orig") {
    const note = r.cellNotes?.[i];
    return (
      <>
        <span className="visually-hidden">Was </span>
        <s className="cmp__was">{c}</s>
        {note && <span className="cmp__why">{note}</span>}
      </>
    );
  }
  if (r.key === "deal" && p.deal) {
    return (
      <>
        <span className={`deal deal--${p.deal.badge}`}>{c}</span>
        <span className={p.deal.badge === "fake-deal" ? "cmp__why" : "visually-hidden"}>{dealExplanation(p.deal)}</span>
      </>
    );
  }
  if (r.key === "trend" && p.trend) return <Trend trend={p.trend} title={p.title} />;
  return <>{c}</>;
}

type DialogProps = {
  /** The ticked products in the current results, in the order they were ticked. */
  items: Product[];
  /** Ticked products that are not in the results: named, left out of the table. */
  missing?: CompareSlot[];
  open: boolean;
  onClose: () => void;
  onRemove?: (key: string) => void;
  /** Brands over the whole result set (chips.ts), read from titles. */
  brands?: ReadonlyMap<string, string | undefined>;
};

/**
 * The compare table in a modal <dialog> (full screen on phones): showModal() makes the page
 * behind it inert, Esc closes it, and focus goes back to the control that opened it. A dialog,
 * not a route: the products live only in this page's streamed results, so a route would have to
 * search the stores again to draw the same table.
 */
export function CompareDialog({ items, missing = [], open, onClose, onRemove, brands }: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  const [diffOnly, setDiffOnly] = useState(false);
  // Column index whose Remove was pressed: focus moves to the Remove now in that place (the next
  // column, or the last one), so it never drops to the page.
  const refocus = useRef<number | null>(null);
  useEffect(() => {
    const i = refocus.current;
    if (i === null || !open) return;
    refocus.current = null;
    const removes = ref.current?.querySelectorAll<HTMLElement>(".cmp__remove");
    if (removes && removes.length) removes[Math.min(i, removes.length - 1)].focus();
  }, [items, open]);

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) {
      opener.current = document.activeElement as HTMLElement | null;
      d.showModal();
    } else if (!open && d.open) d.close();
  }, [open]);

  const all = items.length ? compareRows(items, { brands }) : [];
  const rows = diffOnly ? onlyDifferences(all) : all;
  const hidden = all.length - rows.length;
  const n = items.length;
  return (
    <dialog
      ref={ref}
      className="cmp"
      aria-labelledby="cmp-title"
      onClose={() => {
        onClose();
        // Back to the opener, unless it is gone or disabled (the dialog closed because one product
        // was left): then the tray's first product, or its Clear.
        const o = opener.current;
        const usable = (e: HTMLElement | null | undefined): e is HTMLElement => !!e && e.isConnected && !(e as HTMLButtonElement).disabled;
        const back = [o, document.querySelector<HTMLElement>(".tray__chip"), document.querySelector<HTMLElement>(".tray__clear")].find(usable);
        back?.focus();
      }}
    >
      <div className="cmp__head">
        <h2 id="cmp-title">Compare {n} products</h2>
        <Button size="md" autoFocus onClick={() => ref.current?.close()}>
          Close
        </Button>
      </div>
      <div className="cmp__bar">
        <label className="cmp__toggle">
          <input type="checkbox" checked={diffOnly} onChange={(e) => setDiffOnly(e.target.checked)} />
          Show only differences
        </label>
        <p className="cmp__note">Prices exclude shipping. Brand and specs are read from the titles; check the store page before you buy.</p>
      </div>
      <p className="cmp__note" role="status">
        {diffOnly && hidden > 0 ? `${hidden} ${hidden === 1 ? "row is" : "rows are"} the same for every product and ${hidden === 1 ? "is" : "are"} hidden.` : ""}
      </p>
      {missing.length > 0 && (
        <p className="cmp__note cmp__note--gone">
          {`Left out, ${GONE.toLowerCase()}: `}
          {missing.map(slotName).join("; ")}
        </p>
      )}
      {n > 2 && <p className="cmp__swipe">{`Swipe the table sideways to see all ${n}.`}</p>}
      <div className="cmp__scroll" tabIndex={0} role="region" aria-label="Comparison table, scrolls sideways">
        <table className="cmp__table" style={{ "--cmp-cols": n } as CSSProperties}>
          <thead>
            <tr>
              <th scope="col" className="cmp__corner">
                <span className="visually-hidden">Detail</span>
              </th>
              {items.map((p) => (
                <th key={productKey(p)} scope="col" className="cmp__product">
                  <CardMedia src={p.image} site={p.site} className="cmp__media" size={160} />
                  <StoreMark id={p.site} size={16} />
                  <span className="cmp__title" dir="auto">
                    {p.title}
                  </span>
                  {onRemove && (
                    <button
                      type="button"
                      className="cmp__remove"
                      onClick={() => {
                        refocus.current = items.indexOf(p);
                        onRemove(productKey(p));
                      }}
                    >
                      Remove<span className="visually-hidden">{` ${p.title} from compare`}</span>
                    </button>
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key} className={r.differs ? "cmp__row--differs" : undefined}>
                <th scope="row">
                  {r.label}
                  {r.differs && <span className="visually-hidden">, differs</span>}
                  {r.note && <span className="cmp__rownote">{r.note}</span>}
                </th>
                {items.map((p, i) => (
                  <td key={productKey(p)} className={[r.diff[i] && "cmp__diff", r.lowest?.[i] && "cmp__lowest"].filter(Boolean).join(" ") || undefined}>
                    <Cell r={r} i={i} p={p} />
                  </td>
                ))}
              </tr>
            ))}
            <tr className="cmp__links">
              <th scope="row">Store link</th>
              {items.map((p) => {
                const href = httpsUrl(p.url);
                return (
                  <td key={productKey(p)}>
                    {href ? (
                      <Button size="md" className="cmp__go" href={href} external>
                        View on {storeLabel(p.site)}
                        <span className="visually-hidden">{`: ${p.title} (opens in a new tab)`}</span>
                      </Button>
                    ) : (
                      <span className="cmp__none">No store link</span>
                    )}
                  </td>
                );
              })}
            </tr>
          </tbody>
        </table>
      </div>
    </dialog>
  );
}
