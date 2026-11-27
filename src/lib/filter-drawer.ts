/**
 * Pure helpers for the results page's filter panel (app/components/ResultsLayout.tsx): where the
 * panel lives at each width, the focus trap of the mobile sheet, and the grid or list preference.
 */

/** Desktop: a sticky sidebar. Tablet: a panel the Filters button folds open. Phone: a bottom sheet. */
export type PanelMode = "sidebar" | "panel" | "sheet";

/** The media queries behind each mode (rem widths, as in app/globals.css). */
export const WIDE_QUERY = "(min-width: 64rem)";
export const MEDIUM_QUERY = "(min-width: 48rem)";

export function panelMode(wide: boolean, medium: boolean): PanelMode {
  if (wide) return "sidebar";
  return medium ? "panel" : "sheet";
}

/** What can take focus inside the sheet, in document order. */
export const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * The focus trap: given the focusable elements' count and the index of the focused one (-1 when
 * focus is outside them), the index Tab (or Shift+Tab) should move to, or null to let the browser
 * move focus itself (it is not at either end).
 */
export function trapTab(count: number, index: number, shift: boolean): number | null {
  if (count === 0) return null;
  if (index < 0) return shift ? count - 1 : 0;
  if (shift && index === 0) return count - 1;
  if (!shift && index === count - 1) return 0;
  return null;
}

/** A click on the sheet's scrim: outside the panel's own box (the dialog fills the screen's foot). */
export function outsidePanel(rect: { left: number; right: number; top: number; bottom: number }, x: number, y: number): boolean {
  return x < rect.left || x > rect.right || y < rect.top || y > rect.bottom;
}

/** The Filters button's accessible name: "Filters", or "Filters, 2 on". */
export const filtersButtonName = (active: number): string => (active > 0 ? `Filters, ${active} on` : "Filters");

/** The sheet's confirm button: how many cards the filters leave. */
export const showResultsLabel = (n: number): string => (n === 0 ? "No results to show" : `Show ${n} ${n === 1 ? "result" : "results"}`);

/** Grid cards or list rows; kept per browser in localStorage under VIEW_KEY. */
export type ResultsView = "grid" | "list";
export const VIEW_KEY = "deal-search:view";

export const parseView = (raw: string | null | undefined): ResultsView => (raw === "list" ? "list" : "grid");

/** The saved view; "grid" when storage is empty, blocked or throws. */
export function readView(storage: Pick<Storage, "getItem"> | undefined): ResultsView {
  try {
    return parseView(storage?.getItem(VIEW_KEY));
  } catch {
    return "grid";
  }
}

/** Saves the view; a blocked or full storage is ignored (the toggle still works for this page). */
export function writeView(storage: Pick<Storage, "setItem"> | undefined, view: ResultsView): void {
  try {
    storage?.setItem(VIEW_KEY, view);
  } catch {
    // Private mode or blocked storage: the choice lasts for this page only.
  }
}

/** window.localStorage, or undefined where reading it throws (blocked site data) or on the server. */
export function browserStorage(): Storage | undefined {
  try {
    return typeof window === "undefined" ? undefined : window.localStorage;
  } catch {
    return undefined;
  }
}
