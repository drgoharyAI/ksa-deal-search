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

The UI is at `/`; the API is `POST /api/search` (plus `GET /api/suggest` for the query box).
Matching and ranking are rule-based: word rules plus statistics of each result set. No AI or
LLM is involved.

## Setup

Requirements: Node.js 22.13 or newer (`package.json` declares `"engines": { "node": ">=22.13" }`),
and Google Chrome (only for noon).

```bash
npm i
npm run dev                      # development, http://127.0.0.1:3000
# or
npm run build && npm start       # production
npm test                         # unit and fixture tests (vitest), no network
```

### Local only

The server listens on `127.0.0.1` only (`-H 127.0.0.1` in the `dev` and `start` scripts), so
other devices on your network cannot reach it. Every search sends store traffic from your IP,
so the API routes also refuse requests that come from other web pages:

- a `Host` that is not loopback (LAN access, DNS rebinding) gets 403;
- a `Sec-Fetch-Site` other than `same-origin` or `none` gets 403;
- an `Origin` other than the app's own gets 403;
- `POST /api/search` without `Content-Type: application/json` gets 415.

`curl` and scripts on this machine send no `Origin` header and work as before. Do not remove
`-H 127.0.0.1` unless you mean to expose the app.

### Store specs and settings

`npm run dev` and `npm start` first run `scripts/install-specs.mjs` (the `predev` / `prestart`
step). It:

1. copies every `api-specs/*.json` into API Anything's sites folder (`$API_ANYTHING_HOME/sites`,
   default `./.aa-home/sites`);
2. sets the AliExpress `aep_usuc_f` cookie so AliExpress answers for Saudi Arabia, in English,
   in SAR. If this fails it only prints a warning.

The step is idempotent. No configuration file is needed: the install step and the app both
default to the values below. To change them, create an optional `.env.local` (gitignored; a
fresh clone has none):

```
API_ANYTHING_HOME=./.aa-home
API_ANYTHING_LOCAL_ONLY=1
NOON_PROFILE_DIR=...            # optional, see below
```

### noon and Chrome

noon blocks plain HTTP clients, so the app starts your installed Google Chrome and reads search
results through it over the Chrome DevTools Protocol (Playwright `connectOverCDP`). This works:
in the recorded eval runs noon answered 35 of 40 searches.

- Chrome gets its own profile, `%LOCALAPPDATA%\deal-search\noon-profile` (outside the repo;
  `~/.deal-search/noon-profile` on other systems; override with `NOON_PROFILE_DIR`). An older
  `.noon-profile/` in the repo is moved there on the first launch where it is not locked. Until
  then Chrome keeps using the old folder.
- The debug port is a fixed free port bound to `127.0.0.1`, never port 0. Chrome started with
  `--remote-debugging-port=0` reports `navigator.webdriver === true`, and noon's Akamai then
  answers "Access Denied". If a Chrome from an earlier run still holds the profile and answers,
  the app adopts it instead of starting a second one.
- The window opens off-screen (`--window-position=-32000,-32000`). Chrome closes after 10 minutes
  with no noon searches, and the server kills it when its process exits.
- noon searches run one at a time, at least 2 s apart, with a 10 minute cache. If noon blocks,
  the app backs off for 10 minutes instead of retrying.
- If Chrome is not installed, noon shows as an error and the other stores still work.

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
store) and `reason` when nothing matched.

Store statuses:

- `ok`: the store answered. A "no results" answer (such as Trendyol's 404 past the last page)
  is an empty `ok`, not a failure.
- `blocked`: the store refused us. The app backs off instead of retrying.
- `error`: the request failed, or the store answered with items none of which could be read
  (its page or payload changed).

## Search syntax

| You type                     | Meaning                         |
| ---------------------------- | ------------------------------- |
| `under 300`, `below 300`, `<300` | max price 300 SAR           |
| `over 50`, `above 50`, `>50` | min price 50 SAR                |
| `50-150`, `sar 50 - 150`     | price range (`300-50` is read as 50 to 300) |
| `>4 stars`, `4.5+ stars`, `over 4 stars` | minimum rating (inclusive) |
| `-wired`                     | drop results with the word "wired" in the title |

Prices may carry `sar`, `sr` or `riyal(s)`. Everything else is the search text.

`-word` matches whole title words, parts of hyphenated words and plurals: `-pro` drops
"AirPods Pro" but keeps "Waterproof", and `-case` drops "Cases" but keeps "Showcase".

Filler words do not have to be in the title. `best wireless earbuds`, `cheap jbl speaker` and
`earbuds for running` (read as "running earbuds") match as you would expect. The filler list is
short and lives in `src/lib/query/filler.ts` (the, best, cheap, new, original, buy, ...). Model
words such as pro, max, plus, mini and air always count. The stores still get your exact text.

## Ranking: confident and "Less likely" matches

Results come in tiers, and every sort (price, discount, deal) applies inside each tier:

1. **Confident matches** come first.
2. **"Less likely matches"** follow, under a divider, each card labelled "Less likely match".
   These items pass the filters, but the evidence that they are the product is weaker:
   - a low match score (`src/lib/match/confidence.ts`): the title is worded unlike the listings
     at the product's usual price, or does not name the query as a phrase when most titles do;
   - title structure (`src/lib/match/structure.ts`): the product noun appears only after "with",
     the query appears only in a later " - " segment, or a cheap title uses words no other
     listing uses;
   - a brand query without a model number (`jbl speaker`, `logitech mouse`): items far below
     the brand's usual price (`src/lib/match/price.ts`). They may be clones, but they may also
     be the brand's own cheap line (JBL Go, Logitech M170), so they stay visible at their price.

Some evidence is strong enough to drop an item:

- a query word missing from the title (from four words on, one non-head word may be missing);
- accessories and parts for the queried product;
- books and other product kinds that share its words;
- for a brand query with a model number (`iphone 16`, `nintendo switch 2`), items far below
  that model's price: clones, games and adapters.

## Tuning the matching

The word lists are small on purpose: most of the ranking comes from statistics of each result
set. Each file under `data/` controls one rule:

| File | Controls |
| --- | --- |
| `data/synonyms.json` | Groups of equivalent terms (`["usb-c", "type-c", "usb c"]`). A query word in a group also searches the stores with the others. |
| `data/match-aliases.json` | Groups of words or phrases that satisfy each other in title matching (`anc` = "noise cancelling", `earbuds` = "tws"). Matching only, no extra store calls. |
| `data/accessory-words.json` | Words (case, cable, strap, ...) that mark a title as an accessory. Accessories are dropped unless the query asks for them (`usb-c cable` keeps cables). |
| `data/part-words.json` | Part nouns that mark a part when they follow the product noun ("Mechanical Keyboard Switch"). |
| `data/other-product-words.json` | Other product kinds that share a query's words (macro keypads sold as "mechanical keyboard"). |
| `data/brands.json` | Brand and product-line words. A query that names one gets the brand price rules (see Ranking). |

Restart the server after editing a file. Then re-run the offline eval (below) and check that no
query set got worse.

## Evaluating changes

The eval harness replays recorded store answers through the real pipeline, so you can measure a
matching change offline, without contacting any store.

- **Queries:** `eval/queries.json` (15 tuning queries) and the holdout sets
  `eval/queries-holdout.json`, `queries-holdout2.json`, `queries-holdout3.json` and
  `queries-holdout4.json`.
- **Record** (live traffic, so use it sparingly):
  `node scripts/eval-record.mjs [--stores a,b] [--queries "q1|q2"] [--force]`. It is gentle: one
  request at a time, at least 3 s between requests to a store and 5 s between noon loads. It is
  resumable, and a store that blocks is dropped for the rest of the run. Raw answers land in
  `eval/recorded/<store>/<slug>.json`. Stop the dev server first. If its noon Chrome is running,
  the recorder's Chrome hands off to it and exits ("Chrome exited early (code 0)"), and noon
  fails for that run.
- **Label:** `node scripts/eval-dump.mjs [--queries "q1|q2"]` writes every recorded product to
  `eval/dump/<slug>.tsv`. Label each one in `eval/labels/<slug>.json` as relevant, accessory,
  wrong-model or off-topic, following `eval/LABELING.md`.
- **Replay and score** (offline): `node scripts/eval.mjs [--queries "q1|q2"] [--top N]`. It prints
  precision@10, accessory@10, wrong-model@10, recall and cheapest-relevant-first per query and
  overall, and writes `eval/last-run.json`. Unlabelled queries print their top 10 instead.
- **Metrics and history:** the definitions, targets and every tuning round are in
  `eval/RESULTS.md`. Keep a change only when no set gets worse.

## Adding a store

1. Learn the store's search operation with API Anything (`npx api-anything learn ...`) in a
   scratch home, and check it returns English titles and SAR prices for Saudi Arabia.
2. Put the resulting spec in `api-specs/<id>.json`. The predev step installs it.
3. Write the adapter in `src/sites/<id>/search.ts`: `searchCalls(pq, variants)` builds the
   calls and `normalizeSearchItem(raw)` maps one result to a `Product` (`currency: "SAR"`,
   `detailStatus: "ok"`), or returns null for an item it cannot read. Add fixture tests under
   `tests/sites/`.
4. Register it in `src/sites/registry.ts`, and add the same id and label to `src/lib/stores.ts`
   (the client-side list; `tests/lib/stores.test.ts` checks they match).
5. Record and label a few queries for it (see Evaluating changes).

## Search suggestions

As you type (2 characters or more, after a 150 ms pause) the query box suggests searches,
Google-style. The app's own route `GET /api/suggest?q=` merges, in this order, up to 8 English
suggestions from:

1. Amazon KSA's public autocomplete (`completion.amazon.sa`, the service amazon.sa's search box uses);
2. Jarir's public Constructor.io autocomplete (`ac.cnstrc.com`, the same public key the Jarir search uses).

No AI is involved. Each source gets 1.5 s; a slow or failing one is skipped, and a source that
answers 403 or 429 is left alone for 10 minutes. Answers are cached on the server for 5 minutes.

Keys: Up and Down move through the list, Enter picks and searches, Escape or Tab closes it,
Shift+Delete removes a highlighted recent search. The highlight stays on the item you chose
while new suggestions arrive. If that item leaves the list, nothing is highlighted, and Enter
searches the text you typed.

Privacy: what you type in the query box (2 to 80 characters, lower-cased) is sent from the app
server to Amazon's and Jarir's suggestion services. No cookies or account details go with it.
Your last 20 searches are kept only in your browser (`localStorage`, key
`deal-search:recent-searches`) and are shown first, marked "recent". To clear them, remove one
with Shift+Delete, or clear this site's data in the browser (or run
`localStorage.removeItem("deal-search:recent-searches")` in its console).

## History & price alerts

Every successful search is saved to a local SQLite file (Node's built-in `node:sqlite`, no
native dependency): `%LOCALAPPDATA%deal-searchdata.db`, or the path in `DEAL_SEARCH_DB`.
The file is outside the repository and is never committed.

- **History** (`/history`): newest first, with the stores, time, result count and the cheapest
  confident match. Re-run opens the search page with the search filled in and runs it; you can
  delete one entry or clear all.
- **Watch** on a result card sets a product alert (target prefilled 5% under the current price).
  **Watch this search** above the results alerts when any confident match (never a "less likely"
  one) is at or under a max price (prefilled 5% under the cheapest confident match).
- **Alerts** (`/alerts`): every watch with its target, current and lowest price, last check, a
  sparkline, pause or resume, edit target and delete; the log of fired alerts; Telegram status.

The checker runs inside the app's server process while the app runs: every `ALERT_CHECK_HOURS`
hours (default 6), stores fetched one after another about 20 s apart, each store at most once
per query per cycle, through the normal store adapters, caches and back-offs. A blocked store is
skipped until the next cycle. A watch that fired notifies again only after the price rose above
the target and fell back. In development, `POST /api/alerts/run-now` (JSON body `{}`) runs one
cycle at once; it answers 404 in production.

API (local only, same request guard as `/api/search`): `GET|DELETE /api/history` (`?id=N` or
`?all=1`), `GET|POST|PATCH|DELETE /api/watches`, `GET /api/alerts`, `POST /api/alerts/seen`,
`POST /api/alerts/test-telegram`.

### Telegram setup

1. In Telegram, talk to @BotFather → /newbot → copy the token.
2. Send any message to your new bot.
3. Open https://api.telegram.org/bot<TOKEN>/getUpdates and copy `"chat":{"id":…}`.
4. Add `TELEGRAM_BOT_TOKEN=…` and `TELEGRAM_CHAT_ID=…` to `.env.local`.
5. Restart the app.
6. Alerts → Send test message.

The token is a secret: keep it only in `.env.local` (gitignored). It is used only on the server
and never reaches the browser or the logs. Without it, alerts still show on the Alerts page.

## Privacy

`API_ANYTHING_LOCAL_ONLY=1` keeps API Anything local: specs, cookies and caches stay in
`.aa-home/`, and it sends no request to the shared API Anything registry (no spec lookups,
pulls or publishing). The app has no accounts. Search history and alerts stay in a SQLite file on this machine (see
History & price alerts); recent-search suggestions stay in your browser. Requests go straight from your machine
to the stores.

## Verified (historical: 2026-11-27, before Tasks 9b to 14)

Checked against the live stores, all five selected, sort `price` (`npm run build` succeeded).
Raw responses are in `eval/live-2026-11-27/`.

At the time noon was blocked by Akamai on every search. The cause, Chrome launched with debug
port 0, was fixed in Task 9b (see "noon and Chrome"). The ranking has also changed since
(Task 12), so these product counts are out of date. Current quality is measured by the eval
harness: see `eval/RESULTS.md`.

| Query (production, `npm start`) | Stores ok | Blocked / error | Products | Time |
| --- | --- | --- | --- | --- |
| `anc earbuds under 300` | AliExpress, Amazon, Jarir, Trendyol | noon blocked | 442 | 31.3 s |
| `usb-c cable 100w` | AliExpress (2 of 9 calls), Amazon, Jarir, Trendyol | noon blocked | 260 | 37.8 s |
| `mechanical keyboard >4 stars -wired` | Amazon (1 of 2 calls), Jarir (0 results after filters), Trendyol | noon blocked; AliExpress error | 40 | 12.9 s |
| `anc earbuds under 300` again (cache) | same as first run | same | 442 | 0.46 s |

- Every product had a SAR price, an English title and a URL on a KSA store domain. Price
  filters, the `-wired` exclusion, the rating filter and price sort all held.
- "Jarir (0 results after filters)": Jarir gives no ratings, so a rating filter then removed all
  of it. Now a rating filter keeps Jarir's products, marked "No rating".
- A cold `npm run dev` took about 47 s to compile the first page and serve the first search.

## Known limits

- noon is the slowest store. A cold search (Chrome start and warm-up) takes about 15 to 20 s,
  and the whole result waits for it. Deselect noon for a quick search.
- AliExpress sometimes serves an anti-bot page after a few searches; it then shows as an error
  until it recovers.
- Prices are the listed search-result price, not the checkout price. Shipping is not included.
- "Was" prices (and so discounts) on Trendyol and Amazon may be inflated.
