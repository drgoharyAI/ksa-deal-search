"use client";

import { useEffect, useRef } from "react";
import type { Product } from "@/src/lib/types";
import { MAX_COMPARE, MIN_COMPARE, compareRows } from "@/src/lib/compare";
import { productKey } from "@/src/lib/specs";

type TrayProps = {
  items: Product[];
  /** Set when a fifth product was refused. */
  full: boolean;
  onRemove: (p: Product) => void;
  onClear: () => void;
  onOpen: () => void;
};

/** The sticky compare tray: what is ticked, "Compare (n)" and "Clear". */
export function CompareTray({ items, full, onRemove, onClear, onOpen }: TrayProps) {
  const n = items.length;
  let note = "";
  if (full) note = `You can compare up to ${MAX_COMPARE} products. Remove one to add another.`;
  else if (n > 0 && n < MIN_COMPARE) note = "Tick one more product to compare.";
  return (
    <section className="tray" aria-label="Compare products" hidden={n === 0}>
      <div className="container tray__inner">
        <ul className="tray__items">
          {items.map((p) => (
            <li key={productKey(p)} className="tray__item">
              {p.image ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={p.image} alt="" width={40} height={40} loading="lazy" decoding="async" referrerPolicy="no-referrer" />
              ) : (
                <span className="tray__noimg" aria-hidden="true" />
              )}
              <button type="button" className="tray__remove" onClick={() => onRemove(p)}>
                Remove<span className="visually-hidden"> {p.title} from compare</span>
              </button>
            </li>
          ))}
        </ul>
        <p className="tray__note" role="status">
          {note}
        </p>
        <div className="tray__actions">
          <button type="button" className="btn btn--quiet btn--small" onClick={onClear}>
            Clear
          </button>
          <button type="button" className="btn btn--primary btn--small" disabled={n < MIN_COMPARE} onClick={onOpen}>
            Compare ({n})
          </button>
        </div>
      </div>
    </section>
  );
}

type DialogProps = { items: Product[]; open: boolean; onClose: () => void };

/**
 * The compare table in a modal <dialog>: showModal() makes the page behind it inert (focus stays
 * inside), Esc closes it, and focus goes back to the control that opened it.
 */
export function CompareDialog({ items, open, onClose }: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const opener = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) {
      opener.current = document.activeElement as HTMLElement | null;
      d.showModal();
    } else if (!open && d.open) d.close();
  }, [open]);

  const rows = items.length ? compareRows(items) : [];
  return (
    <dialog
      ref={ref}
      className="cmp"
      aria-labelledby="cmp-title"
      onClose={() => {
        onClose();
        opener.current?.focus();
      }}
    >
      <div className="cmp__head">
        <h2 id="cmp-title">Compare {items.length} products</h2>
        <button type="button" className="btn btn--quiet btn--small" autoFocus onClick={() => ref.current?.close()}>
          Close
        </button>
      </div>
      <p className="cmp__note">Shaded rows differ. Specs are read from the titles; check the store page before you buy.</p>
      <div className="cmp__scroll" tabIndex={0} role="region" aria-label="Comparison table, scrolls sideways">
        <table className="cmp__table">
          <thead>
            <tr>
              <th scope="col" className="cmp__corner">
                <span className="visually-hidden">Detail</span>
              </th>
              {items.map((p) => (
                <th key={productKey(p)} scope="col" className="cmp__product">
                  {p.image ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={p.image} alt="" width={120} height={120} loading="lazy" decoding="async" referrerPolicy="no-referrer" />
                  ) : (
                    <span className="cmp__noimg">No image</span>
                  )}
                  <a href={p.url} target="_blank" rel="noopener noreferrer">
                    {p.title}
                    <span className="visually-hidden"> (opens in a new tab)</span>
                  </a>
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
                </th>
                {r.cells.map((c, i) => (
                  <td key={i} className={r.lowest?.[i] ? "cmp__lowest" : undefined}>
                    {c ?? <span className="cmp__none">Not given</span>}
                    {r.lowest?.[i] && <span className="cmp__tag">Lowest</span>}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </dialog>
  );
}
