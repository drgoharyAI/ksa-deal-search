"use client";

import { useCallback, useEffect, useId, useLayoutEffect, useReducer, useRef, useState, useSyncExternalStore } from "react";
import type { Product } from "@/src/lib/types";
import { formatMoney } from "@/src/lib/money";
import { safeOfferLink } from "@/src/lib/gshop/links";
import { SOURCE_LABELS, type GshopResult, type NoDataReason } from "@/src/lib/gshop/validate";
import type { GshopStatus } from "@/src/lib/gshop/service";
import Button from "./ui/Button";

/**
 * Google Shopping KSA evidence (spec decision "Google Shopping KSA validator"). The check runs only
 * when asked ("Check other stores" in Details and in the compare dialog), or automatically for a
 * few deal-badged products a day when the owner turns that on. Results are kept in a small client
 * store so the card's deal badge shows the same evidence line once a product was checked.
 */

const API = "/api/gshop/validate";
const keyOf = (p: { site: string; id: string }) => `${p.site}\u0000${p.id}`;

// ---------------- the client store of results ----------------

const results = new Map<string, GshopResult>();
const listeners = new Set<() => void>();
let lastStatus: GshopStatus | null = null;

function publish(key: string, r: GshopResult | null): void {
  if (r) results.set(key, r);
  for (const l of listeners) l();
}
function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}

/** The result already fetched for a product on this page, if any. */
function useGshopResult(p: Product): GshopResult | null {
  const k = keyOf(p);
  return useSyncExternalStore(
    subscribe,
    () => results.get(k) ?? null,
    () => null,
  );
}

type Answer = { status?: GshopStatus; result?: GshopResult | null; error?: string; calm?: boolean };

async function call(p: Product, method: "GET" | "POST", auto = false): Promise<Answer> {
  const res =
    method === "GET"
      ? await fetch(`${API}?${new URLSearchParams({ site: p.site, id: p.id }).toString()}`, { cache: "no-store" })
      : await fetch(API, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ site: p.site, id: p.id, ...(auto && { auto: true }) }) });
  const body = (await res.json().catch(() => ({}))) as Answer;
  if (body.status) lastStatus = body.status;
  if (body.result) publish(keyOf(p), body.result);
  if (res.ok) return body;
  // 429: a cap was reached; nothing failed, so it is said calmly.
  return { ...body, error: body.error ?? "The check failed. Try again later.", calm: res.status === 429 };
}

// ---------------- wording ----------------

/** "just now", "5 min ago", "3 h ago", "2 d ago". */
export function checkedAgo(at: number, now = Date.now()): string {
  const m = Math.floor(Math.max(0, now - at) / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  return h < 24 ? `${h} h ago` : `${Math.round(h / 24)} d ago`;
}

const NO_DATA: Record<NoDataReason, string> = {
  few: "Too few other Saudi stores found",
  "no-match": "Google had no matching product",
  budget: "Check limits reached for now",
  blocked: "Google asked for a CAPTCHA; checks are paused",
  error: "Could not reach Google Shopping",
  off: "Checks are off",
};

/** The line next to the button: SerpApi checks left, or which source is used instead. */
export function budgetLine(s: GshopStatus): string {
  if (!s.serpapi.enabled) return "Add SERPAPI_KEY to enable SerpApi; checks use Google directly.";
  if (s.serpapi.exhausted) return "SerpApi limit reached; using Google directly";
  return `${s.serpapi.left} SerpApi checks left this month`;
}

function cannotCheck(s: GshopStatus): string {
  if (s.google.backedOffUntil) {
    const t = new Date(s.google.backedOffUntil).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
    return `Google asked for a CAPTCHA; checks pause until ${t}.`;
  }
  return "This month's SerpApi checks and this hour's Google checks are used up. Try again later.";
}

// ---------------- the (i) source note ----------------

/**
 * The (i) note's state: open on hover or keyboard focus; a click or tap pins it open (hover-leave
 * does not close a pinned note) and a second one closes it; Esc or a press outside closes it,
 * whatever opened it, until the pointer or focus comes back (WCAG 1.4.13). Pure, for tests.
 */
export type InfoState = { hover: boolean; focus: boolean; pinned: boolean; dismissed: boolean };
export type InfoEvent = "enter" | "leave" | "focus" | "blur" | "click" | "escape" | "outside";
export const INFO_CLOSED: InfoState = { hover: false, focus: false, pinned: false, dismissed: false };

export const infoOpen = (s: InfoState) => s.pinned || (!s.dismissed && (s.hover || s.focus));

export function infoReducer(s: InfoState, e: InfoEvent): InfoState {
  // A dismissal lasts until the pointer and focus have both left; a fresh hover or focus then opens again.
  const away = !s.hover && !s.focus;
  switch (e) {
    case "enter":
      return { ...s, hover: true, dismissed: away ? false : s.dismissed };
    case "leave":
      return { ...s, hover: false, dismissed: s.focus ? s.dismissed : false };
    case "focus":
      return { ...s, focus: true, dismissed: s.focus ? s.dismissed : false };
    case "blur":
      return { ...s, focus: false, pinned: false, dismissed: s.hover ? s.dismissed : false };
    case "click":
      return s.pinned ? { ...s, pinned: false, dismissed: true } : { ...s, pinned: true, dismissed: false };
    case "escape":
    case "outside":
      return { ...s, pinned: false, dismissed: true };
  }
}

/** Hover-leave waits this long, so the pointer can move onto the note. */
const LEAVE_DELAY_MS = 150;

/**
 * A small (i) button (44px target) whose note shows on hover, keyboard focus and tap (see
 * infoReducer). The note describes the button (aria-describedby), so screen readers read it too.
 */
export function SourceInfo({ text }: { text: string }) {
  const [state, dispatch] = useReducer(infoReducer, INFO_CLOSED);
  const open = infoOpen(state);
  const id = useId();
  const ref = useRef<HTMLSpanElement>(null);
  const note = useRef<HTMLSpanElement>(null);
  const leaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Keep the open note inside the viewport (a phone puts the (i) near the right edge).
  useLayoutEffect(() => {
    const el = note.current;
    if (!el || !open) return;
    el.style.transform = "";
    const r = el.getBoundingClientRect();
    const over = r.right - (document.documentElement.clientWidth - 8);
    if (over > 0) el.style.transform = `translateX(${-Math.min(over, r.left - 8)}px)`;
  }, [open]);
  const cancelLeave = () => {
    if (leaveTimer.current) clearTimeout(leaveTimer.current);
    leaveTimer.current = null;
  };
  useEffect(() => cancelLeave, []);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) dispatch("outside");
    };
    // Esc closes the note whatever opened it, wherever focus is.
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") dispatch("escape");
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);
  return (
    <span
      className="info"
      ref={ref}
      onMouseEnter={() => {
        cancelLeave();
        dispatch("enter");
      }}
      onMouseLeave={() => {
        cancelLeave();
        leaveTimer.current = setTimeout(() => dispatch("leave"), LEAVE_DELAY_MS);
      }}
    >
      <button
        type="button"
        className="info__button"
        aria-label="Source"
        aria-describedby={id}
        aria-expanded={open}
        onFocus={() => dispatch("focus")}
        onBlur={() => dispatch("blur")}
        onClick={() => dispatch("click")}
      >
        <span className="info__icon" aria-hidden="true">
          i
        </span>
      </button>
      <span id={id} ref={note} role="tooltip" className="info__note" hidden={!open}>
        {text}
      </span>
    </span>
  );
}

// ---------------- the evidence ----------------

/** Verdict badge, the evidence line, the other stores as small links, and the (i) source note. */
export function GshopEvidence({ result: r, now }: { result: GshopResult; now?: number }) {
  const source = r.source ? `${SOURCE_LABELS[r.source]}, checked ${checkedAgo(r.checkedAt, now)}` : `Checked ${checkedAgo(r.checkedAt, now)}`;
  const n = r.others.length;
  return (
    <div className="gshop">
      <p className="gshop__head">
        <span className={`gshop__verdict gshop__verdict--${r.verdict}`}>{r.label}</span>
        <SourceInfo text={source} />
      </p>
      {r.verdict === "no-data" ? (
        <p className="gshop__line">{NO_DATA[r.reason ?? "few"]}</p>
      ) : (
        r.lowest && (
          <p className="gshop__line">
            {`Google Shopping KSA: ${n} other ${n === 1 ? "store" : "stores"}, lowest ${formatMoney(r.lowest.price, "SAR")} at ${r.lowest.store}`}
          </p>
        )
      )}
      {n > 0 && (
        <ul className="gshop__offers" role="list">
          {r.others.map((o) => {
            // Checked again here: only a link that passes the Saudi-merchant rules is ever drawn.
            const href = safeOfferLink(o.url);
            const price = formatMoney(o.price, "SAR");
            return (
              <li key={`${o.store}|${o.price}`} className="gshop__offer">
                {href ? (
                  <a href={href} target="_blank" rel="noopener noreferrer nofollow">
                    <span className="gshop__store">{o.store}</span> <span className="gshop__price">{price}</span>
                    {o.domain && <span className="gshop__domain"> ({o.domain})</span>}
                    <span className="visually-hidden"> (opens in a new tab)</span>
                  </a>
                ) : (
                  <>
                    <span className="gshop__store">{o.store}</span> <span className="gshop__price">{price}</span>
                    {o.domain && <span className="gshop__domain"> ({o.domain})</span>}
                  </>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

// ---------------- the panel (Details, compare) ----------------

type PanelProps = { status: GshopStatus | null; result: GshopResult | null; busy: boolean; error: string | null; calm?: boolean; onCheck: () => void; now?: number };

/** The "Check other stores" block (pure, exported for tests). */
export function GshopPanel({ status, result, busy, error, calm = false, onCheck, now }: PanelProps) {
  const noteId = useId();
  const blocked = status !== null && !status.canCheck;
  return (
    <div className="gshop-check">
      <div className="gshop-check__row">
        <Button size="sm" variant="secondary" onClick={onCheck} loading={busy} disabled={blocked || status === null} aria-describedby={blocked ? noteId : undefined}>
          Check other stores
        </Button>
        {status && <span className="gshop-check__budget">{budgetLine(status)}</span>}
      </div>
      {blocked && status && (
        <p id={noteId} className="details__note">
          {cannotCheck(status)}
        </p>
      )}
      {error &&
        (calm ? (
          <p className="details__note" role="status">
            {error}
          </p>
        ) : (
          <p className="details__note gshop-check__error" role="alert">
            {error}
          </p>
        ))}
      {result && <GshopEvidence result={result} now={now} />}
      <p className="details__note">Other Saudi stores&apos; prices from Google Shopping, checked only when you ask. Check the store page before you buy.</p>
    </div>
  );
}

/** The live block: reads the status and any cached result, checks on click. */
export default function GshopCheck({ product: p }: { product: Product }) {
  const [status, setStatus] = useState<GshopStatus | null>(lastStatus);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ text: string; calm: boolean } | null>(null);
  const result = useGshopResult(p);
  useEffect(() => {
    let live = true;
    call(p, "GET")
      .then((a) => {
        if (live && a.status) setStatus(a.status);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [p]);
  const onCheck = useCallback(() => {
    setBusy(true);
    setError(null);
    call(p, "POST")
      .then((a) => {
        if (a.status) setStatus(a.status);
        if (a.error) setError({ text: a.error, calm: a.calm === true });
      })
      .catch(() => setError({ text: "The check failed. Try again later.", calm: false }))
      .finally(() => setBusy(false));
  }, [p]);
  return <GshopPanel status={status} result={result} busy={busy} error={error?.text ?? null} calm={error?.calm} onCheck={onCheck} />;
}

/** On a card with a deal badge: the evidence line once the product was checked on this page. */
export function GshopCardLine({ product }: { product: Product }) {
  const r = useGshopResult(product);
  return r ? <GshopEvidence result={r} /> : null;
}

const AUTO_BADGES = new Set(["lowest-30d", "below-usual", "fake-deal"]);
const autoAsked = new Set<string>();
/** Asked once per page load: is GSHOP_AUTO on? */
let autoOn: Promise<boolean> | null = null;

/**
 * Automatic checks (GSHOP_AUTO=1 on the server, off by default): up to 5 deal-badged products of
 * the results, one at a time; the server enforces the daily cap. Never on every search otherwise.
 */
export function GshopAuto({ products }: { products: Product[] }) {
  const picks = products.filter((p) => p.deal && AUTO_BADGES.has(p.deal.badge)).slice(0, 5);
  const keys = picks.map(keyOf).join("|");
  const latest = useRef(picks);
  useEffect(() => {
    latest.current = picks;
  });
  useEffect(() => {
    if (!keys) return;
    let stop = false;
    void (async () => {
      autoOn ??= fetch(API, { cache: "no-store" })
        .then((r) => r.json() as Promise<Answer>)
        .then((a) => a.status?.auto === true)
        .catch(() => false);
      if (!(await autoOn)) return;
      for (const p of latest.current) {
        if (stop) return;
        if (autoAsked.has(keyOf(p))) continue;
        autoAsked.add(keyOf(p));
        const a = await call(p, "POST", true).catch((): Answer => ({}));
        if (a.error) return;
      }
    })();
    return () => {
      stop = true;
    };
  }, [keys]);
  return null;
}
