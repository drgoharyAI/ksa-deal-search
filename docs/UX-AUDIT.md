# UX audit (U1, 2026-11-27)

The state of the UI before the redesign, and which phase changes what. The brief is
`docs/superpowers/plans/briefs/ux-redesign.md`; the design system is `docs/DESIGN.md`.

## Structure

| Route | File | What it does |
| --- | --- | --- |
| `/` | `app/page.tsx` (client) | Search form, per-store status, results (cards, groups, less-likely tier), quick filters, compare tray and dialog, "Watch this search". All state lives in this one component. |
| `/history` | `app/history/HistoryView.tsx` | Past searches from `GET /api/history`: re-run, delete, clear all. |
| `/alerts` | `app/alerts/AlertsView.tsx` | Telegram status and test, watches (edit target, pause, delete, sparkline), fired alerts; marks them seen. |

API routes (all behind `rejectCrossSite`): `POST /api/search`, `GET /api/suggest`,
`GET|DELETE /api/history`, `GET|POST|PATCH|DELETE /api/watches`, `GET /api/alerts`,
`POST /api/alerts/seen`, `POST /api/alerts/test-telegram`, `POST /api/watches/run-now`, `GET /api/health`.
U1 adds `GET /api/discover` (read-only, observations DB).

## Components (app/components)

- `AppHeader`: wordmark and three links; Alerts carries the unseen count (`/api/alerts`, cleared by `ALERTS_SEEN_EVENT`).
- `SearchForm` + `QueryCombobox`: WAI-ARIA combobox with local recents (localStorage) and `/api/suggest`; store checkboxes (SHEIN off by default, with a note); sort, min/max price, min rating.
- `StatusBar`: per-store words (searching, N results, blocked, failed).
- `ResultTiers` -> `ResultCard` / `GroupCard`: price, struck "was", discount, deal badge, 30-day trend, rating, sold, Compare checkbox, Watch form.
- `FilterChips`: client-side store, brand, price range, rating and discounted chips, kept in the URL.
- `Compare`: sticky tray and a modal `<dialog>` table (`src/lib/compare.ts`).
- `WatchForm`, `Sparkline`, `When`, `StoreLogo`.

Logic stays in `src/lib`: `rank.ts` (sort, likely match), `chips.ts` (facets), `view.ts` (units, groups),
`compare.ts`, `stores.ts` (the 8 stores: AliExpress, Amazon KSA, Jarir, noon KSA, Trendyol KSA, eXtra,
Carrefour KSA, SHEIN KSA).

## Styling before U1

`app/tokens.css` (Hallmark "Coral" theme), `app/base.css` (reset, scale, motion guard) and one
`app/globals.css` (BEM-ish classes, about 320 lines). Buttons, chips, notices, empty states and
skeletons were repeated as raw class strings in every view; no shared primitives.

## What works (kept as is)

Search and abort, per-store status, the match tiers, cross-store groups, quick filters with URL
state, compare (tray, dialog, lowest cell), product and search watches, history re-run, alerts and the
unseen badge, query suggestions with keyboard support, reduced-motion handling, 44px-ish targets.

## Gaps found

- The page before a search was an empty box: nothing from the user's own history or the price DB.
- Store coverage was a row of checkboxes with no sense of brand; the stores read the same as filters.
- No footer or data note beyond "Shipping not included" on each card.
- Buttons, badges and empty states diverged slightly between pages (duplicated markup).
- The coral accent sat close to AliExpress, Jarir and Carrefour reds.

## Phase plan

- **U1 (this):** tokens and `DESIGN.md`, primitives in `app/components/ui/`, the shell (header and footer on every page), the search-first home with suggestions and a discovery strip from real data.
- **U2:** a streaming search endpoint (the existing `/api/search` stays) and live per-store status.
- **U3:** results layout: compact search header, filter sidebar on desktop, bottom sheet on mobile, new cards.
- **U4:** compare on mobile, lowest comparable total, no cross-currency comparison.
- **U5:** discovery: recently viewed, favourites, related products, shareable result URLs (SQLite).
- **U6:** responsive and accessibility QA at every breakpoint, then deploy.
