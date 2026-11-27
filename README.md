# Deal Search (KSA)

A local Next.js app that searches five Saudi stores at once and ranks the results by price,
discount or "deal" score:

| Store        | id            | How it is fetched                                         |
| ------------ | ------------- | --------------------------------------------------------- |
| AliExpress   | `aliexpress`  | API Anything spec (`api-specs/aliexpress.json`), KSA/SAR cookie |
| Amazon KSA   | `amazon-sa`   | API Anything spec (`api-specs/amazon-sa.json`)            |
| Jarir        | `jarir`       | API Anything spec (`api-specs/jarir.json`)                |
| noon KSA     | `noon-sa`     | Your installed Google Chrome, driven over CDP             |
| Trendyol KSA | `trendyol-sa` | API Anything spec (`api-specs/trendyol-sa.json`)          |

The UI is at `/`; the API is `POST /api/search`.

## Setup

Requirements: Node.js 22.13 or newer, and Google Chrome (only for noon).

```bash
npm i
npm run dev                      # development, http://localhost:3000
# or
npm run build && npm start       # production
```

`npm run dev` and `npm start` first run `scripts/install-specs.mjs` (the `predev` / `prestart`
step). It:

1. copies every `api-specs/*.json` into API Anything's sites folder (`$API_ANYTHING_HOME/sites`,
   default `./.aa-home/sites`);
2. sets the AliExpress `aep_usuc_f` cookie so AliExpress answers for Saudi Arabia, in English,
   in SAR. If this fails it only prints a warning.

The step is idempotent. Settings come from `.env.local` (gitignored):

```
API_ANYTHING_HOME=./.aa-home
API_ANYTHING_LOCAL_ONLY=1
```

### noon and Chrome

noon blocks plain HTTP clients, so the app starts your installed Google Chrome with its own
profile (`.noon-profile/`, gitignored) and reads search results through it. The window opens
off-screen (`--window-position=-32000,-32000`). Chrome closes after 10 minutes with no noon
searches, and the server kills it when its process exits. If Chrome is not installed, noon shows as an error and the
other stores still work.

## API

```http
POST /api/search
Content-Type: application/json

{ "query": "anc earbuds under 300",
  "sites": ["aliexpress", "amazon-sa", "jarir", "noon-sa", "trendyol-sa"],
  "sort": "price" }
```

`sort` is `price`, `discount` or `deal` (default). Optional `minPrice`, `maxPrice`, `minRating`
override the values parsed from the query. The response has `products`, `statuses` (one per
store: `ok`, `blocked` or `error`, with a message) and `reason` when nothing matched.

## Search syntax

| You type                     | Meaning                         |
| ---------------------------- | ------------------------------- |
| `under 300`, `below 300`, `<300` | max price 300 SAR           |
| `over 50`, `above 50`, `>50` | min price 50 SAR                |
| `50-150`, `sar 50 - 150`     | price range                     |
| `>4 stars`, `4.5+ stars`, `over 4 stars` | minimum rating (inclusive) |
| `-wired`                     | drop results whose title contains "wired" |

Prices may carry `sar`, `sr` or `riyal(s)`. Everything else is the search text.

## Tuning the matching

- `data/synonyms.json` is a list of groups of equivalent terms, for example
  `["usb-c", "type-c", "usb c"]`. A query word in a group also searches with the others.
- `data/accessory-words.json` is a list of words (case, cable, strap, ...) that mark a product
  as an accessory. Accessories are dropped unless the query asks for them (for example
  `usb-c cable` keeps cables).

Restart the server after editing either file.

## Adding a store

1. Learn the store's search operation with API Anything (`npx api-anything learn ...`) in a
   scratch home, and check it returns English titles and SAR prices for Saudi Arabia.
2. Put the resulting spec in `api-specs/<id>.json`. The predev step installs it.
3. Write the adapter in `src/sites/<id>/search.ts`: `searchCalls(pq, variants)` builds the
   calls and `normalizeSearchItem(raw)` maps one result to a `Product` (`currency: "SAR"`,
   `detailStatus: "ok"`). Add fixture tests under `tests/sites/`.
4. Register it in `src/sites/registry.ts`, and add the same id and label to `src/lib/stores.ts`
   (the client-side list; `tests/lib/stores.test.ts` checks they match).

## Privacy

`API_ANYTHING_LOCAL_ONLY=1` keeps API Anything local: specs, cookies and caches stay in
`.aa-home/`, and it sends no request to the shared API Anything registry (no spec lookups,
pulls or publishing). The app has no accounts and
stores no searches. Requests go straight from your machine to the stores.

## Verified

Checked on 2026-11-27 against the live stores, all five selected, sort `price`
(`npm test`: 141 tests pass; `npm run build` succeeds). Raw responses are in
`eval/live-2026-11-27/`.

| Query (production, `npm start`) | Stores ok | Blocked / error | Products | Time |
| --- | --- | --- | --- | --- |
| `anc earbuds under 300` | AliExpress, Amazon, Jarir, Trendyol | noon blocked (Akamai "Access Denied") | 442 | 31.3 s |
| `usb-c cable 100w` | AliExpress (2 of 9 calls), Amazon, Jarir, Trendyol | noon blocked | 260 | 37.8 s |
| `mechanical keyboard >4 stars -wired` | Amazon (1 of 2 calls), Jarir (0 results after filters), Trendyol | noon blocked; AliExpress error (page changed or anti-bot page) | 40 | 12.9 s |
| `anc earbuds under 300` again (cache) | same as first run | same | 442 | 0.46 s |

- Every product had a SAR price, an English title, a URL on a KSA store domain
  (`www.aliexpress.com`, `www.amazon.sa`, `www.jarir.com`, `www.trendyol.sa`) and
  `detailStatus: "ok"`. Price filters, the `-wired` exclusion, the rating filter and price sort
  all held.
- The repeat search came from the cache (0.46 s instead of 31 s).
- `npm run dev` also works (one search, HTTP 200, 207 products; AliExpress was still failing).
- Quality notes for tuning: the earbuds top 10 is all very cheap AliExpress items, several of
  them wired earphones that only say "noise reduction"; the keyboard top 10 starts with five
  accessories (keycap puller, switch openers, a switch pack) from Trendyol.

## Known limits

- noon is often blocked by Akamai. The app then shows noon as blocked and backs off for a while
  instead of retrying.
- AliExpress sometimes serves an anti-bot page after a few searches; it then shows as an error
  until it recovers.
- Prices are the listed search-result price, not the checkout price. Shipping is not included.
- "Was" prices (and so discounts) on Trendyol and Amazon may be inflated.
