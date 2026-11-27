# Design system: "Souq Ledger"

The source of truth for how the app looks. Tokens live in one file, `app/tokens.css`; the reset is
`app/base.css`; component rules are `app/globals.css`; shared React primitives are `app/components/ui/`.
If code and this file disagree, fix one of them in the same change.

## Art direction

**Concept: the souq ledger.** A Saudi merchant's price book. The paper is warm, the ink is
charcoal, and the figures are set in clean tabular type so they line up down the page. Each store
signs its line with its own mark. One stamp of colour, palm green, appears only where the ledger
vouches for something: the primary action, focus, and a price our own history backs.

Why it suits the app. The app is a price-intelligence tool, not a shop. People come to check prices
and they need to trust what they read. A ledger is calm and factual. It shows provenance (which store,
when we saw the price), and it marks a bargain only when there is proof. It lets the eight store
brands (red, orange, yellow, black) keep their colour, because the page around them stays neutral.

What we avoid (from the brief): purple or blue gradients, glass, glow, giant heroes, generic
dashboards, decorative icons and illustrations, over-rounded cards, and invented numbers.

## Colour

Warm off-white neutrals, charcoal text, and one accent. All colours are OKLCH tokens in
`app/tokens.css`. No component declares a literal colour.

| Token | Role |
| --- | --- |
| `--color-paper` | Page background (warm off-white) |
| `--color-paper-2` | Wells, panels, hover fill |
| `--color-paper-3` | Pressed and selected fill, skeletons |
| `--color-surface` | Cards, sheets, dialogs (a shade lighter than paper) |
| `--color-ink` | Primary text, charcoal |
| `--color-ink-2` | Secondary text |
| `--color-muted` | Helper text, captions (4.5:1 or better on paper) |
| `--color-rule`, `--color-rule-2` | Hairlines; stronger borders on controls |
| `--color-accent` | Palm green: primary button, focus ring, selected chip mark |
| `--color-accent-strong` | Accent text on paper, and the primary button's hover state |
| `--color-accent-well`, `--color-accent-edge` | A verified good price (best price, lowest in 30 days) |
| `--color-accent-ink` | Text on the accent |
| `--color-warn-*` | Fake deal, blocked store, "differs" cells |
| `--color-error-*` | Errors and destructive actions |

**The accent is palm green, `oklch(47% 0.085 170)`.** Why it fits:

- **Neutral among the stores.** The store marks are red (AliExpress, Jarir, Carrefour), orange (Amazon,
  Trendyol, eXtra), yellow (noon) and black (SHEIN). A red, orange or gold accent would look like
  one of them. Green belongs to no store.
- **Local.** It is the green of the date palm and of the Saudi flag. It is a deep, muted shade, not a
  bright flag green.
- **One meaning.** Green means "verified": the action you should take, or a price our history backs.
  So the good-price state is the accent family, and the page never has two greens.
- **Legible.** White text on the accent is about 6:1, and accent-strong text on paper is about 8:1.

The brief rules out purple and blue. We also avoid the old coral, because it sat too close to the
red store marks.

## Typography

| Role | Face | Token | Notes |
| --- | --- | --- | --- |
| Display | Gloock 400 | `--font-display` | A high-contrast editorial serif, used for the wordmark, page titles and the home brand line only. One weight. |
| Body and UI | IBM Plex Sans 400/500/600 | `--font-body` | Labels, controls, body copy and prices (with `tabular-nums`). |
| Arabic fallback | IBM Plex Sans Arabic 400/500/600 | in `--font-body` | Plex's own Arabic companion has matching metrics, so a mixed Arabic and Latin product title reads as one line. |
| Code | IBM Plex Mono 400 | `--font-mono` | Query syntax hints only (`under 300`). |

All four faces are self-hosted with `next/font/google`, so the browser makes no request to a font CDN
at runtime. Weights are limited to the ones listed. `font-synthesis: none` is set.

Product titles use `--font-title`, which is the body chain with the Arabic face first in line for
Arabic script. They are set `dir="auto"`-safe: no letter-spacing, and a line-height of 1.35.

**Scale** (about 1.2, with a fluid display size):

| Token | Size | Use |
| --- | --- | --- |
| `--text-xs` | 0.75rem | Counts, tags |
| `--text-sm` | 0.875rem | Labels, meta, helper text |
| `--text-md` | 1rem | Body (16px minimum) |
| `--text-lg` | 1.125rem | Query input, card price on mobile |
| `--text-xl` | 1.375rem | Section heads, card price |
| `--text-2xl` | 1.75rem | Page titles |
| `--text-3xl` | 2.25rem | Group-card price, large figures |
| `--text-display` | clamp(2.25rem, 1.5rem + 2.4vw, 3.5rem) | Home brand line |

Headings use one weight and one colour. Labels are sentence case, never tracked capitals.

## Spacing, layout and breakpoints

Spacing is a 4px-based scale: `--space-3xs` 2, `2xs` 4, `xs` 8, `sm` 12, `md` 16, `lg` 24, `xl` 40,
`2xl` 64, `3xl` 96.

The container is capped at `--container` (1360px) and centred. The gutter is 16px on phones, 24px from
48rem, and 40px from 64rem. At 1920 the gutters grow; the measure and the grids do not.

| Breakpoint | Width | What changes |
| --- | --- | --- |
| Phone | 375, 390, 430 | One column; the result grid has 2 tracks; stores wrap; 44px targets |
| `48rem` | 768 | Grid has 3 tracks; gutter 24px |
| `64rem` | 1024 | Grid has 4 tracks; gutter 40px; the home discovery strip has 4 tracks |
| `90rem` | 1440 | Grid has 5 tracks |
| 1920 | n/a | Container capped; nothing else grows |

Media queries use rem widths (`48rem`, `64rem`, `90rem`), because CSS variables do not work there.

## Radius, borders, elevation

- **Radius (restrained):** `--radius-xs` 4px for logos and tags, `--radius-sm` 6px for controls and
  chips, `--radius-md` 10px for cards, panels and dialogs. `--radius-pill` is for count badges only.
- **Borders:** `--border` is a 1px `--color-rule` hairline. Controls use `--color-rule-2`, and selected
  controls use `--color-ink`.
- **Elevation:** `--shadow-1` for a card at rest (a hairline ring and a 1px shade), `--shadow-2` for
  a lifted card or popover, and `--shadow-3` for a dialog or the compare tray. All shadows are warm
  charcoal at low alpha. There is no glow and no blur backdrop.

## Components (app/components/ui)

| Primitive | Variants | Notes |
| --- | --- | --- |
| `Button` | `primary`, `secondary`, `ghost`, `destructive`; sizes `sm` (40px), `md` (44px), `lg` (52px) | `loading` sets `aria-busy`, disables the button and shows a small spinner. `href` renders a link with the same look. One primary per view. |
| `Input` | `md`, `compact`; `invalid` | A 44px field with the same focus ring as every control. The query box is `QueryCombobox` (its own ARIA). |
| `Chip` | `checkbox` (stores, facets), `toggle` (`aria-pressed`) | A 44px target with a visible selected state (ink border and a green check mark), never colour alone. |
| `Badge` | `neutral`, `accent`, `warn`, `count` | Words, never a dot. `count` is the Alerts number. |
| `StoreMark` | `full` (logo and name), `compact` (logo, name for screen readers) | Uses the store's own logo from `public/stores`. |
| `Price` | sizes `sm`, `md`, `lg` | The current price dominates. A struck original shows only when it is higher and in the same currency. A discount shows only when the caller marks it `verified`. Currency comes from the item and is never assumed. |
| `Skeleton` | `line`, `short`, `price`, `media`, and `SkeletonCard` | It pulses, and stays still under reduced motion. |
| `EmptyState` | title, body, optional action | |
| `ErrorState` | message, optional retry | `role="alert"`. |
| `SectionHeader` | `h1`/`h2`, optional note and actions | |

**Cards.** `--color-surface` on paper, `--radius-md`, and `--shadow-1`. On hover (hover devices only)
the card lifts 1px to `--shadow-2`. There is never a card inside a card. U3 redesigns the result
cards on these tokens.

## Store status (U2)

`StatusBar` is one ledger strip with a cell per store: the `StoreMark`, then the state in words:
Searching, "N results" (only with a count from the backend), No results, Temporarily unavailable
(with "try after HH:MM" when the back-off end is known), Failed, or Stopped. A store still
searching shows a short hairline drifting along the cell's foot; it never fills and is still under
reduced motion. There is no percentage or progress bar. Cells keep their size across states, so
nothing below moves while stores answer. The page announces one summary (aria-live polite) at the
start, at the first results and at the end, never per store.

## States

Every control has hover (`@media (hover: hover)` only), `:focus-visible` (a 2px accent ring, offset
2px, shown at once), active (a 1px press), selected, disabled (opacity 0.5, `not-allowed`), loading
(`aria-busy`), empty, error and success. Status is always words, never a coloured dot.

## Motion

Durations are `--dur-micro` 120ms (press, hover fill), `--dur-short` 200ms (lift, popover) and
`--dur-long` 360ms (sheet). The easing is `--ease-out`. Only `transform`, `opacity`, `background-color`,
`border-color` and `box-shadow` animate, and never `transition: all`. Under
`prefers-reduced-motion: reduce`, all animation and transition is cut to 0.01ms, and the skeleton
pulse and button bar stop. Nothing on the page depends on motion to be understood.

## Content rules

- Prices are the stores' listed prices. Shipping is not included, and the footer says so on every page.
- A discount or deal label appears only when the store's own "was" price or our observations back it.
- No invented ratings, stock, delivery times or counts. A section with no real data is hidden.
- Copy is plain English, in sentence case, with no exclamation marks.
