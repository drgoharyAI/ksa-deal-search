# UX redesign QA report (phase U6)

Date: 2026-11-28. Branch `feat/deal-search`. This was the final pass before production. It covered
functional QA, a responsive and accessibility pass, and a performance pass.

**How it was tested**
- Build: a production build (`npm run build && npm start`) on 127.0.0.1:3000.
- Browser: headless Chrome, driven by Playwright (`playwright-core`, system Chrome).
- Store searches: about 12 real searches. Repeat runs of "air fryer" mostly hit the app's cache.
- Telegram: one test message was sent.
- Local database: backed up before the run and restored after it, so QA left no searches, watches,
  favourites or viewed items behind.
- Screenshots: kept with the session notes, not in the repo.

## Result

- **Checks:** 41 feature checks in the checklist below. 37 passed first time, and the other 4 failed
  and now pass after fixes F1, F2, F3 and F6. Ten findings were fixed in all (F1 to F10). The
  keyboard probe also flagged 2 items that are not app defects (see "Not app defects").
- **axe-core 4:** WCAG 2.0, 2.1 and 2.2 A/AA, plus best practice. 0 violations on home, results, results
  with Details open, the compare dialog, the filter sheet (phone), /saved, /history and /alerts, at
  1440 and at 390.
- **Responsive:** no horizontal overflow on any key screen at 375, 390, 430, 768, 1024, 1440 or 1920.
  On touch screens every control is a 44px target or larger.
- **Console:** no app errors and no React warnings in any flow. The only network failures were the
  ones we caused on purpose:
  - aborted streams (Stop, Back)
  - the blocked `/api/search/stream` and `/api/search` in the error test
  - the dev-only run-now route answering 404 in production

## Feature checklist

| Area | Check | Result |
| --- | --- | --- |
| Home | Typing, the suggestions combobox (opens, ArrowDown sets `aria-activedescendant`, Escape closes, Enter picks) | Pass |
| Home | One-click clear ×: empties the field, puts focus back in it, and hides itself when the field is empty; it is a 44×44 target | Pass |
| Home | Store selection: SHEIN off by default, SACO on (8 of 9 on) | Pass |
| Home | Search again: remove one entry, Clear all (asks first) | Pass |
| Home | Recently viewed fills after "View on store" and after a picture click | Pass |
| Home | Deal strip ("Recently seen deals") shows only with real data | Pass |
| Home | Going home from results (wordmark) gives a clean home; Back brings the results back | Pass |
| Home | Back and Forward between home and results | **Fixed** (F1) |
| Streaming | Per-store states: Searching, N results, No results, Temporarily unavailable (with "try after"), Failed, Stopped | Pass |
| Streaming | Stop: stores that had not answered say "Stopped"; the live region says "Search stopped; …" | Pass |
| Streaming | Stop before any store answered | **Fixed** (F2) |
| Streaming | Stop, then home, then Back: no store left "Searching" forever | Pass |
| Streaming | A query with no hits: SACO shows "No results", not blocked | Pass |
| Filters | Sidebar at 64rem and up; a folding panel at 768; a bottom sheet on phones (focus trap over 40 Tabs, Esc, scrim tap, focus back on Filters) | Pass |
| Filters | Chips, removing one chip, Clear all, the URL keeping the filters (they survive a reload), the count badge on Filters ("Filters, 1 on") | Pass |
| Filters | Store, price range, 4+ rating, Only discounted, brand: each narrows the list and adds a chip and a URL parameter | Pass |
| Filters | Verified deals: hidden, because the data had no 30-day lows (as designed) | Pass |
| Sorts | "Best match, then price", "Highest discount", "Best deal": the order changes and `sort=` is in the URL | Pass |
| Sorts | The sort label was cut off ("Best match, then p") | **Fixed** (F6) |
| Cards | Grid/List switch, kept after a reload | Pass |
| Cards | Group card price ladder and "Best price" row | Pass |
| Cards | Less likely matches section | Pass |
| Cards | "Branch pickup only" badge on SACO listings (24 in "air fryer") | Pass |
| Cards | Watch on a pickup-only listing | **Fixed** (F3) |
| Cards | Details disclosure (`aria-expanded`) with related listings | Pass |
| Cards | "View on store" and the picture link open a new tab and record Recently viewed | Pass |
| Compare | Tray; a limit of 4 (the 5th tick is refused, with a note); the dialog is modal and takes focus | Pass |
| Compare | Show only differences (9 rows to 6); Remove moves focus to the next Remove; Esc puts focus back on the tray button | Pass |
| Compare | Phone: columns swipe sideways (`scroll-snap-type: x mandatory`) | Pass |
| Compare | "from" prices are not ranked ("Cheapest is a 'from' price, not ranked"); the row says "Store discount", never "verified" | Pass |
| Compare | A shared link restores the compare tray (3 slots) and runs the search once | Pass |
| Share | Copy link: the clipboard gets the full results URL and the page says "Link copied"; opened in a new browser context it runs exactly one search | Pass |
| Saved | Save/Saved toggle; /saved shows the saved price and the latest seen price; Watch price; Remove | Pass |
| Alerts | Create a search watch (from results) and a product watch (from a card); edit the target (focus moves into the field); pause and resume; delete (asks first) | Pass |
| Alerts | Run check now: the route is dev-only and answers 404 in production. There is no UI for it | Pass (n/a) |
| Alerts | Telegram "Send test message": one message sent, "Sent. Check your Telegram chat." | Pass |
| History | Lists searches with Re-run and Delete; Clear all | Pass |
| Errors | `/api/search/stream` blocked: the page falls back to `/api/search` and shows results | Pass |
| Errors | Both search routes failing: `ErrorState` (role=alert) with "Search again"; after the routes come back, retry recovers | Pass |

## Findings fixed

| # | Finding | Fix | Test |
| --- | --- | --- | --- |
| F1 | **Back from results left the app.** A search from home replaced the home's history entry, so Back went to the previous site (about:blank in the test). | A search shown over the home now pushes its own entry (`urlWrite` in `src/lib/rerun.ts`). The home entry is marked, so Back shows the clean home (results stashed) and Forward brings them back. | `tests/lib/share.test.ts`; browser: history 2 to 3, Back to home, Forward restores |
| F2 | **Stop before any store answered said "No products matched your search and filters"**, which is not true. | A dedicated empty state: "The search was stopped before any results came", with "Search again". The live region says "Search stopped; 0 results from 0 of 8 stores". | browser |
| F3 | **Watch was offered on branch-pickup-only listings** (the known gap at ResultCard.tsx:97). The checker never records a pickup-only price, so the alert could never fire. | `CardWatch` renders nothing for `pickupOnly`. `parseNewWatch` rejects `pickupOnly: true`. A group card's Watch stays when its lead listing can be delivered. | `tests/lib/saco-flows.test.ts`; browser: 24 pickup cards, 0 Watch buttons on them |
| F4 | **Layout shift on a results URL** (shared link, reload, History re-run). The prerendered home showed first and then collapsed into the results layout. CLS was 0.38 on desktop and 0.30 on mobile. | A tiny inline script in `app/layout.tsx` marks `<html>` before first paint when the URL has a query, and CSS keeps the home hidden until the results layout replaces it. There is a 4s CSS fallback, so a failed script never leaves a blank page. The search page clears the mark. | browser: CLS 0.07 (desktop) and 0.06 (mobile) |
| F5 | **Mounting 400+ cards blocked a phone's main thread.** TBT was 9.5s with 4x CPU throttling. | Cards are drawn 48 at a time (`RESULTS_STEP`). More come as the reader scrolls near the end (IntersectionObserver), and "Show more results" does the same from the keyboard. | `tests/app/result-tiers.test.ts`; browser: 48 to 349 cards on scroll; TBT 1.7s |
| F6 | The sort select cut its own label to "Best match, then p" (`max-width: 11rem`). | The select sizes to its longest label and only shrinks when the row is too narrow. | screenshots at all widths |
| F7 | **Tap targets under 44px on phones:** every `btn--sm` (40px), the segmented Grid/List, the sort select, filter chips, and the wordmark (22px tall). | `--target-sm` becomes 44px under `(pointer: coarse)`. The wordmark is a 44px-tall flex link. | responsive audit: 0 targets under 44px at 375, 390 and 430 |
| F8 | **Text fields failed non-text contrast** (WCAG 1.4.11). Their 1px edge was 1.88:1. | New token `--color-field-edge` (3.88:1) on `.input` (selects, price fields, watch target). Documented in DESIGN.md. | computed 3.88:1 |
| F9 | **Save toggle failed label-in-name** (axe, serious). Its visible text "Saved" was not in its accessible name "Save …". | No `aria-label`. The name is now the visible word plus the product in visually hidden text ("Saved JBL Flip 6 …"). | `tests/app/discovery-ui.test.ts`; axe 0 |
| F10 | **Store status details were cut off with "…"** on phones ("some pa…", "try after …"). | The detail sits on its own line under the state and wraps whole. | screenshots 375 and 768 |

## Metrics

Measured with `PerformanceObserver` in Chrome on the production build, because Lighthouse is not
installed. The mobile runs used 390×844 with DPR 3, 4x CPU throttling, 150ms RTT and 1.6 Mbps.
Each figure shown as "before → after" is from before and after fixes F4 and F5.

| Page | FCP | LCP | CLS | TBT |
| --- | --- | --- | --- | --- |
| Home, desktop | 644ms | 644ms | 0.032 | 0ms |
| Home, mobile | 1.49s | 1.49s | 0.000 | 194ms |
| Results (shared URL), desktop | 496ms | 6.5s* | 0.38 → 0.07 | 70 → 93ms |
| Results (shared URL), mobile | 1.50s | 2.95s | 0.30 → 0.06 | 9.5s → 1.7s |

\* The results LCP is a product picture, so it waits for the slowest store to answer (live stores,
about 6s on that run). It depends on the stores, not the page.

- **Images:** all are lazy, `decoding="async"`, and have `width`/`height` on a fixed 1:1 box. No layout
  shift came from images.
- **Bundle:** 789 KB of client JS across all routes (241 KB gzipped). The largest chunk is 224 KB raw.
  The JS and CSS loaded for the home is 302 KB transferred. `next build` is clean (Turbopack, every
  page static).

## Accessibility notes

- **Landmarks:** one `header`, `nav`, `main` and `footer` on every page. Each page has one `h1` and
  no skipped heading levels. `lang="en"`, and each page has its own `<title>`.
- **Keyboard:**
  - The main flow works from the keyboard alone: type, Enter, Tab to a card, Space to tick Compare,
    open the compare dialog, Esc.
  - Every Tab stop on home and results showed a visible focus ring. On the price sliders the ring is
    on the thumb.
- **aria-live:** one polite summary at the start, at the first results and at the end ("Searching 8
  stores" / "Showing the first results; …" / "347 results from 7 of 8 stores; 1 unavailable or
  failed"). There is never a line per store.
- **Contrast:** every text token passes AA. The lowest is muted on paper-3, at 5.09:1. Text fields
  are now 3.88:1 (F8).
- **Reduced motion:** with `prefers-reduced-motion: reduce`, transitions compute to 0.01ms, and the
  status hairline and skeleton pulse stop.

## Not app defects (probe artefacts)

- **Range inputs and the focus check.** The probe flagged the price range inputs as "no focus ring",
  because the ring is drawn on the `::-webkit-slider-thumb` pseudo-element, which the probe cannot
  read.
- **The compare dialog and Tab.** In the compare dialog, Tab from the last control moves focus to
  the browser's own UI, as a native modal `<dialog>` does. The page behind it stays inert, and focus
  never reached it.

## Remaining known issues

- **Stores during QA:**
  - SACO answered once with `ECONNRESET` ("Failed"); the next run was fine. This is the known
    intermittent reset (stock-saco-report, concern 4).
  - After repeated QA searches, noon, Amazon and Carrefour went "Temporarily unavailable" for a few
    minutes. This is the store protections working as designed.
- **Escape in the query box.** When no suggestions are open, Escape clears the text. That is
  Chrome's native `type="search"` behaviour, and the × button does the same.
- **Long result lists.** Find-in-page (Ctrl+F) only sees the cards drawn so far (F5); scrolling or
  "Show more results" draws the rest.
- **Phone toolbar.** On phones the sticky results toolbar takes two rows (Filters and Sort, then
  Grid/List), because the full sort label is now readable.
- **Store status cells.** A cell grows by one line when a detail appears ("some pages failed", "try
  after …"). This happens only when that store answers.
- **Ranking.** In "air fryer", a silicone tray (an accessory) ranked first under "Best match, then
  price". That is the matching engine, and it is out of scope for the UX pass.
- **Unchanged from U4 and U5:**
  - Opening a Details panel makes its grid row taller.
  - Recent-search remove has no undo.
  - Shared results URLs auto-run on the owner's IP; this is the U5 known exposure.
