"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { Product } from "@/src/lib/types";
import { savedKey, snapshotOf, type ProductSnapshot, type SavedItem } from "@/src/lib/saved-shared";

/**
 * Saving products (favourites) and recording store visits (UX phase U5). Both are kept in the app's
 * SQLite database through /api/favourites and /api/viewed; nothing lives only in the browser.
 */

/** A product as a view records it: a listing, or a snapshot (its price may be unknown). */
type Viewable = Product | (Omit<ProductSnapshot, "price"> & { price: number | null });

/** Records that a product was opened at its store. keepalive: the request outlives the tab switch. */
export function recordView(p: Viewable, send: typeof fetch = fetch): void {
  const snap = "listPrice" in p ? snapshotOf(p) : p;
  try {
    void send("/api/viewed", {
      method: "POST",
      keepalive: true,
      headers: { "content-type": "application/json" },
      body: JSON.stringify(snap),
    }).catch(() => {});
  } catch {
    // A view is a convenience: never block the link.
  }
}

/** onClick and onAuxClick (middle click) for a store link: both open the store, both count as a view. */
export const viewHandlers = (p: Viewable) => ({
  onClick: () => recordView(p),
  onAuxClick: (e: { button: number }) => {
    if (e.button === 1) recordView(p);
  },
});

/** Saves or unsaves a product; resolves to an error message, or null when it worked. */
export async function sendSave(snap: ProductSnapshot & { query?: string | null }, on: boolean, send: typeof fetch = fetch): Promise<string | null> {
  try {
    const r = on
      ? await send("/api/favourites", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(snap) })
      : await send(`/api/favourites?${new URLSearchParams({ site: snap.site, id: snap.id }).toString()}`, { method: "DELETE" });
    // Unsaving one already gone is what was asked for.
    if (r.ok || (!on && r.status === 404)) return null;
    const d = (await r.json().catch(() => null)) as { error?: string } | null;
    return d?.error ?? (on ? "Could not save; try again" : "Could not remove; try again");
  } catch {
    return "Could not reach the app server";
  }
}

export type SavedApi = {
  isSaved: (key: string) => boolean;
  /** Saves (on) or unsaves a product; resolves to an error message or null. */
  toggle: (p: Product, on: boolean, query?: string) => Promise<string | null>;
};

export const SavedContext = createContext<SavedApi | null>(null);

/**
 * The saved keys the server listed, with this page's own toggles laid over them (`local`: each
 * product's latest wish, or its state after a failed request was reverted): a list fetched while a
 * save or unsave was on its way never undoes what the user just did.
 */
export function mergeSaved(server: Iterable<string>, local: ReadonlyMap<string, boolean>): Set<string> {
  const out = new Set(server);
  for (const [key, on] of local) {
    if (on) out.add(key);
    else out.delete(key);
  }
  return out;
}

/**
 * Save and unsave requests, one at a time per product: a quick save then unsave reaches the server
 * in that order (never a DELETE overtaken by its POST). `local` keeps what this page asked for, per
 * product. A failed request is reverted only when it was the latest for its product (a later toggle
 * already says what the user wants).
 */
export function createSaveQueue() {
  const local = new Map<string, boolean>();
  const tails = new Map<string, Promise<unknown>>();
  const seqs = new Map<string, number>();
  return {
    local: local as ReadonlyMap<string, boolean>,
    run(key: string, on: boolean, send: () => Promise<string | null>, revert: () => void): Promise<string | null> {
      const seq = (seqs.get(key) ?? 0) + 1;
      seqs.set(key, seq);
      local.set(key, on);
      const job = (tails.get(key) ?? Promise.resolve()).then(send, send);
      tails.set(key, job.catch(() => {}));
      const done = (err: string | null) => {
        if (seqs.get(key) === seq) {
          tails.delete(key);
          if (err) {
            local.set(key, !on);
            revert();
          }
        }
        return err;
      };
      return job.then(done, () => done("Could not reach the app server"));
    },
  };
}

/** The saved products' keys for this page, loaded once; a toggle shows at once and is undone if the server refuses it. */
export function useFavourites(): SavedApi {
  const [keys, setKeys] = useState<ReadonlySet<string>>(() => new Set());
  // One queue for the page's life (a lazy initial state: created once, never replaced).
  const [saves] = useState(createSaveQueue);
  useEffect(() => {
    let live = true;
    fetch("/api/favourites", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { items?: SavedItem[] } | null) => {
        if (live && Array.isArray(d?.items)) setKeys(mergeSaved(d.items.map(savedKey), saves.local));
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [saves]);
  const toggle = useCallback(async (p: Product, on: boolean, query?: string) => {
    const key = savedKey(p);
    const set = (v: boolean) =>
      setKeys((cur) => {
        const next = new Set(cur);
        if (v) next.add(key);
        else next.delete(key);
        return next;
      });
    set(on);
    return saves.run(key, on, () => sendSave({ ...snapshotOf(p), ...(query ? { query } : {}) }, on), () => set(!on));
  }, [saves]);
  return useMemo(() => ({ isSaved: (k: string) => keys.has(k), toggle }), [keys, toggle]);
}

/**
 * The heart: a 44px toggle (aria-pressed) that saves the product; it reads "Saved" when on. Its
 * name starts with those visible words (WCAG 2.5.3, label in name), then the product for context.
 */
export function SaveToggle({ product: p, query, label, className }: { product: Product; query?: string; label?: string; className?: string }) {
  const api = useContext(SavedContext);
  const [error, setError] = useState<string | null>(null);
  if (!api) return null;
  const on = api.isSaved(savedKey(p));
  return (
    <span className={["save", className].filter(Boolean).join(" ")}>
      <button
        type="button"
        className="save__btn"
        aria-pressed={on}
        onClick={() => {
          setError(null);
          void api.toggle(p, !on, query).then(setError);
        }}
      >
        <svg className="save__heart" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false">
          <path d="M12 20.5 10.6 19.2C5.4 14.5 2 11.4 2 7.7 2 4.6 4.4 2.3 7.4 2.3c1.7 0 3.4.8 4.6 2.1 1.2-1.3 2.9-2.1 4.6-2.1 3 0 5.4 2.3 5.4 5.4 0 3.7-3.4 6.8-8.6 11.5L12 20.5Z" />
        </svg>
        {on ? "Saved" : "Save"}
        <span className="visually-hidden"> {label ?? p.title}</span>
      </button>
      {error && (
        <span className="save__error" role="alert">
          {error}
        </span>
      )}
    </span>
  );
}
