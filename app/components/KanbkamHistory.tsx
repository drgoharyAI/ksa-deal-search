"use client";

import { useEffect, useId, useLayoutEffect, useReducer, useRef, useState, useSyncExternalStore } from "react";
import type { DealBadge, Product } from "@/src/lib/types";
import { formatMoney } from "@/src/lib/money";
import { kanbkamSupported, safeKanbkamLink, validKanbkamId } from "@/src/lib/kanbkam/links";
import { kanbkamDisagrees, type KanbkamResult } from "@/src/lib/kanbkam/rules";
import type { KanbkamStatus } from "@/src/lib/kanbkam/service";

/**
 * Kanbkam price history (spec decision "Kanbkam price history"): one compact line, "Price history:
 * lowest SAR 269, highest SAR 659", a verdict badge when a rule applies, and the source behind an
 * (i). Amazon.sa and noon listings only. Looked up lazily: when Details, the compare dialog or a
 * deal's evidence is drawn, and for at most 3 deal-badged results after a search has rendered.
 * Results are kept in a small client store, so every place shows the same line.
 */

const API = "/api/kanbkam";
const keyOf = (p: { site: string; id: string }) => `${p.site}\u0000${p.id}`;
const supported = (p: { site: string; id: string }) => kanbkamSupported(p.site) && validKanbkamId(p.site, p.id);

// ---------------- the client store ----------------

const results = new Map<string, KanbkamResult>();
const asked = new Set<string>();
const listeners = new Set<() => void>();
let lastStatus: KanbkamStatus | null = null;

function publish(key: string, r: KanbkamResult | null | undefined): void {
  if (r) results.set(key, r);
  for (const l of listeners) l();
}
function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}
function useKanbkamResult(p: Product): KanbkamResult | null {
  const k = keyOf(p);
  return useSyncExternalStore(
    subscribe,
    () => results.get(k) ?? null,
    () => null,
  );
}

type Answer = { status?: KanbkamStatus; result?: KanbkamResult | null; error?: string; calm?: boolean };

async function call(p: Product, method: "GET" | "POST"): Promise<Answer> {
  const res =
    method === "GET"
      ? await fetch(`${API}?${new URLSearchParams({ site: p.site, id: p.id }).toString()}`, { cache: "no-store" })
      : await fetch(API, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ site: p.site, id: p.id }) });
  const body = (await res.json().catch(() => ({}))) as Answer;
  if (body.status) lastStatus = body.status;
  publish(keyOf(p), body.result);
  if (res.ok) return body;
  // A cap, a pause or the switch being off: nothing broke, so it is said calmly.
  return { ...body, error: body.error ?? "Could not load the price history", calm: res.status === 429 || res.status === 503 };
}

/** The listing's history, from the store or the server: cached first, looked up once per page. */
async function load(p: Product): Promise<Answer> {
  const k = keyOf(p);
  if (results.has(k)) return {};
  const first = await call(p, "GET");
  if (first.result || first.status?.enabled === false || asked.has(k)) return first;
  asked.add(k);
  return call(p, "POST");
}

// ---------------- the (i) source note ----------------

/**
 * The (i) note's state, copied from the gshop note (GshopCheck.tsx) so that file stays untouched:
 * open on hover or keyboard focus; a click or tap pins it; Esc or a press outside closes it,
 * whatever opened it, until the pointer or focus comes back. Focus moving onto the link inside the
 * note keeps it open (the wrapper sees focus within). Pure, for tests.
 */
export type HistoryInfoState = { hover: boolean; focus: boolean; pinned: boolean; dismissed: boolean };
export type HistoryInfoEvent = "enter" | "leave" | "focus" | "blur" | "click" | "escape" | "outside";
export const HISTORY_INFO_CLOSED: HistoryInfoState = { hover: false, focus: false, pinned: false, dismissed: false };

export const historyInfoOpen = (s: HistoryInfoState) => s.pinned || (!s.dismissed && (s.hover || s.focus));

export function historyInfoReducer(s: HistoryInfoState, e: HistoryInfoEvent): HistoryInfoState {
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

const LEAVE_DELAY_MS = 150;

/**
 * A small (i) button (44px target) whose note, "History from Kanbkam" linking to the listing's
 * Kanbkam page, shows on hover, keyboard focus and tap. The note holds a link, so it is a
 * disclosure (aria-controls), not a tooltip. Only an https Kanbkam product page is ever linked.
 */
export function HistoryInfo({ href }: { href: string }) {
  const [state, dispatch] = useReducer(historyInfoReducer, HISTORY_INFO_CLOSED);
  const open = historyInfoOpen(state);
  const id = useId();
  const ref = useRef<HTMLSpanElement>(null);
  const note = useRef<HTMLSpanElement>(null);
  const leaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const link = safeKanbkamLink(href);
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
      onFocus={() => dispatch("focus")}
      onBlur={(e) => {
        // Focus moving between the button and the link inside the note keeps it open.
        if (!ref.current?.contains(e.relatedTarget)) dispatch("blur");
      }}
    >
      <button type="button" className="info__button" aria-label="Source" aria-expanded={open} aria-controls={id} onClick={() => dispatch("click")}>
        <span className="info__icon" aria-hidden="true">
          i
        </span>
      </button>
      <span id={id} className="info__note" ref={note} hidden={!open}>
        {link ? (
          <a href={link} target="_blank" rel="noopener noreferrer nofollow">
            History from Kanbkam<span className="visually-hidden"> (opens in a new tab)</span>
          </a>
        ) : (
          "History from Kanbkam"
        )}
      </span>
    </span>
  );
}

// ---------------- the line ----------------

type PanelProps = { status: KanbkamStatus | null; result: KanbkamResult | null; busy: boolean; error: string | null; calm?: boolean; deal?: DealBadge };

/** Every state of the price-history line (pure, exported for tests). Off or unknown status: nothing. */
export function KanbkamPanel({ status, result, busy, error, calm = true, deal }: PanelProps) {
  if (!status?.enabled) return null;
  if (result?.status === "ok") {
    const disagree = kanbkamDisagrees(deal, result.verdicts);
    return (
      <div className="khist">
        <p className="khist__line">
          {`Price history: lowest ${formatMoney(result.min, "SAR")}, highest ${formatMoney(result.max, "SAR")}`}
          {result.verdicts.map((v) => (
            <span key={v.kind} className={`khist__verdict khist__verdict--${v.kind}`}>
              {v.label}
            </span>
          ))}
          {result.short && <span className="khist__short">Short price history</span>}
          <HistoryInfo href={result.url} />
        </p>
        {disagree && <p className="khist__note">Our own price history disagrees; both are shown.</p>}
      </div>
    );
  }
  if (result?.status === "missing")
    return (
      <div className="khist">
        <p className="khist__line">Price history: none found for this listing.</p>
      </div>
    );
  if (busy)
    return (
      <div className="khist" aria-busy="true">
        <p className="khist__line">Price history: loading…</p>
      </div>
    );
  if (error)
    return (
      <div className="khist">
        <p className="khist__note" role={calm ? "status" : "alert"}>
          {error}
        </p>
      </div>
    );
  return null;
}

/** The live line for one listing (Details, the compare dialog): looks it up when first drawn. */
export default function KanbkamHistory({ product: p }: { product: Product }) {
  const [status, setStatus] = useState<KanbkamStatus | null>(lastStatus);
  // Settled once the first answer for this listing came back (busy until then).
  const [settled, setSettled] = useState(false);
  const [error, setError] = useState<{ text: string; calm: boolean } | null>(null);
  const result = useKanbkamResult(p);
  const ok = supported(p);
  useEffect(() => {
    if (!ok) return;
    let live = true;
    load(p)
      .then((a) => {
        if (!live) return;
        if (a.status) setStatus(a.status);
        else if (lastStatus) setStatus(lastStatus);
        if (a.error) setError({ text: a.error, calm: a.calm === true });
      })
      .catch(() => {
        if (live) setError({ text: "Could not load the price history", calm: false });
      })
      .finally(() => {
        if (live) setSettled(true);
      });
    return () => {
      live = false;
    };
  }, [p, ok]);
  if (!ok) return null;
  return <KanbkamPanel status={status} result={result} busy={!settled && !result} error={error?.text ?? null} calm={error?.calm} deal={p.deal?.badge} />;
}

/** On a card with a deal badge: the line once the listing's history is known on this page. */
export function KanbkamCardLine({ product: p }: { product: Product }) {
  const r = useKanbkamResult(p);
  return r && lastStatus ? <KanbkamPanel status={lastStatus} result={r} busy={false} error={null} deal={p.deal?.badge} /> : null;
}

const AUTO_BADGES: ReadonlySet<DealBadge> = new Set(["lowest-30d", "below-usual", "fake-deal"]);
const AUTO_PER_SEARCH = 3;

/** The results to look up automatically: deal-badged Amazon.sa and noon listings, 3 at most. Pure. */
export function autoPicks(products: Product[]): Product[] {
  return products.filter((p) => p.deal && AUTO_BADGES.has(p.deal.badge) && supported(p)).slice(0, AUTO_PER_SEARCH);
}

/**
 * After a search has rendered: up to 3 deal-badged Amazon.sa / noon results, one at a time, in
 * the background. Never blocks or delays the search; stops at the first refusal (off, a cap).
 */
export function KanbkamAuto({ products }: { products: Product[] }) {
  const picks = autoPicks(products);
  const keys = picks.map(keyOf).join("|");
  const latest = useRef(picks);
  useEffect(() => {
    latest.current = picks;
  });
  useEffect(() => {
    if (!keys) return;
    let stop = false;
    void (async () => {
      for (const p of latest.current) {
        if (stop) return;
        const a = await load(p).catch((): Answer => ({ error: "failed" }));
        if (a.error || a.status?.enabled === false) return;
      }
    })();
    return () => {
      stop = true;
    };
  }, [keys]);
  return null;
}
