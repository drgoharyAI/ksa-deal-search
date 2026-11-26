# Deal Search — Design

Date: 2026-11-27
Status: approved by owner 2026-11-27

## Intent

A personal web app for finding the best deal on a product across shopping sites.
The owner types what they want, picks which sites to search, and gets matching
products ranked by lowest price and/or highest discount. AliExpress is the first
site; more sites (Amazon next) get added over time.

Why: manually searching each site, scrolling past accessories and duplicates, and
comparing prices/discounts by eye is slow. The app does the searching, filtering
and ranking.

## Goals

- Search one or more sites from a single query box.
- Show only products that actually match the query (not cases, cables, tips etc.
  when searching for earbuds).
- Rank by lowest price, highest discount, or a combined deal score.
- Adding a new site = adding one small adapter, nothing else changes.

## Non-goals (v1)

- Accounts, multi-user, public hosting.
- Price history, alerts, watchlists.
- Sites other than AliExpress (architecture must make them easy, but v1 ships one).
- Checkout, cart, affiliate links.

## Anti-goals

- **No LLM / AI API calls anywhere.** The owner explicitly does not want to depend
  on LLM calls. "Smart search" is rule-based and runs locally.
- No hammering sites: personal-volume traffic only. Getting the owner's IP blocked
  by AliExpress would make the app useless.

## Constraints

- Runs locally only (`npm run dev` / `npm start` on the owner's Windows 11 PC,
  Node v24). Not deployed to Vercel: API Anything calls run on the owner's machine,
  network and sessions.
- Owner is in Saudi Arabia. By default AliExpress serves Arabic titles and SAR
  prices based on IP.

## Approaches considered

1. **Own adapter per site** — direct `fetch` + parse embedded JSON. Fewest moving
   parts, fastest, no third-party dependency. No automatic fallback/repair.
2. **API Anything as the engine for all sites** (`api-anything` npm package,
   github.com/goodnight000/api-anything, MIT) — uniform call layer, plain-HTTP
   tier with browser fallback when blocked, self-repair when a site changes,
   ~114 sites bundled (incl. `amazon` product search).
3. **AliExpress official Affiliate API** — stable and legal, but needs app
   key/approval and only covers affiliate-program items.
4. **Paid scraper API** — costs money, unofficial dependency.

**Chosen: 2 (API Anything for everything).** Owner's pick. Spike (below) proved it
works for AliExpress at tier 1.

## Spike results (2026-11-27, throwaway)

- AliExpress search page `https://www.aliexpress.com/w/wholesale-{q}.html?page={n}`
  is server-rendered with all product data embedded as JSON after
  `_init_data_= { data: `. Plain HTTP works, no captcha, across 6+ queries.
- 60 items/page, ~1.4–2.6 s per call. `page` param returns different results.
  `SortType=price_asc` also works (not yet in the op).
- Learned and saved as API Anything op `aliexpress.search` (params `q`, `page`;
  `minTier: 1`) at `~/.api-anything/sites/aliexpress.json`. Recipe:
  - `--embedded '_init_data_= \{ data: (\{)'`
  - `--extract data.root.fields.mods.itemList.content`
  - `--pick id=productId,title=title.displayTitle,price=prices.salePrice.minPrice,currency=prices.salePrice.currencyCode,discount=prices.salePrice.discount,origPrice=prices.originalPrice.minPrice,rating=evaluation.starRating,sold=trade.tradeDesc,image=image.imgUrl`
- Called from Node via `import { call } from "api-anything"` — all `ok`, tier 1.
- `origPrice` is present on only some pages; `discount` (%) is almost always
  present → original price can be derived: `orig = price / (1 - discount/100)`.
- `sold` is a localized string ("+3 ألف مباعة", "100 ألف + مباعة") → needs parsing.
- Image URLs are protocol-relative (`//ae-pic-a1...`) → prefix `https:`.
- Product URL is not in the data; build it: `https://www.aliexpress.com/item/{id}.html`.
- Cookie `aep_usuc_f=site=glo&c_tp=USD&region=SA&b_locale=en_US` switches to English
  titles/USD (verified with curl). `c_tp=SAR` should give English + SAR (not verified).

## Design

### Stack (builder's calls, stated)

Next.js (App Router) + TypeScript + Tailwind. No database. `api-anything` as a
dependency, used only server-side (route handlers / server actions).

### Architecture

```
Browser UI ──► /api/search (route handler)
                 │ parse query → expand synonyms → per-site queries
                 ├─► adapter: aliexpress ─► api-anything call("aliexpress","search",…)
                 ├─► adapter: amazon (later)
                 ▼
               normalize → relevance filter → accessory filter → dedupe → rank
                 ▼
               JSON results ─► UI
```

### Site adapter contract

Each site is one module implementing:

- `id`, `label`, `currency` default
- `buildCalls(parsedQuery) → {op, args}[]` — e.g. AliExpress: slugify terms
  (`"anc earbuds"` → `anc-earbuds`), pages 1..N.
- `normalize(rawItem) → Product`

Common `Product` shape:
`{ site, id, title, price, origPrice, discountPct, currency, rating, soldCount, image, url }`
(`origPrice` derived when missing; `soldCount` parsed to a number).

Adding a site = learn/bundle its API Anything op + write one adapter + register it.

### Shipping the AliExpress op with the app

The op currently lives only in the owner's `~/.api-anything`. The app's repo must
contain the op spec so it is reproducible, and the locale cookie (English titles,
SAR prices) should be part of the request. Exact mechanism (custom
`API_ANYTHING_HOME`, a spec-install step, or a header in the spec) is left to the
builder after reading API Anything's docs. Run with `API_ANYTHING_LOCAL_ONLY=1` so
no search words go to the shared catalog.

### Smart search (rule-based, no LLM)

1. **Query parsing** — extract constraints from free text:
   `under 50` / `<50` / `50-100` (price), `>4.5 stars` (min rating),
   `-case` (exclude word). Remainder = search terms.
2. **Synonym expansion** — small editable dictionary file
   (e.g. `anc ↔ noise cancelling`, `earbuds ↔ tws ↔ earphones`). Search runs with
   the original terms plus 1–2 variants.
3. **Relevance scoring** — BM25-style keyword match of query terms (and synonyms)
   against titles, with light fuzzy matching; drop below a threshold.
4. **Accessory filter** — drop titles dominated by accessory words (`case`,
   `cover`, `tips`, `strap`, `cable`, `holder`, …) unless the query contains them.
5. **Dedupe** — group near-identical titles, keep cheapest.
6. **Ranking** — user picks: lowest price, highest discount, or deal score
   (blend of price, discount, rating, sold count).

Local embeddings (transformers.js) were considered and deferred to a later version.

### UI (v1)

Single page: query box, site checkboxes (AliExpress only in v1), sort selector,
optional min/max price + min rating fields (in addition to inline syntax), results
grid of cards (image, title, price, struck-through original price, discount badge,
rating, sold, site badge, link opening the product on the site). Show per-site
status (ok / blocked / error) so a failing site doesn't hide the others.

### Traffic & caching

- In-memory cache of site responses (~10 min) so repeat/refined searches are instant.
- Cap pages per term (default 2–3) and total calls per search; run calls with small
  concurrency.
- Surface API Anything's `class` (`blocked`, rate limit, etc.) to the UI instead
  of retrying aggressively.

## Settled after builder check

- **API Anything and LLMs:** its learning and repair need no LLM ("No LLM is
  involved", per its README). Learning and repair replay the site's own requests
  in a headless browser. Repair can stay on without breaking the no-LLM anti-goal.
- **Currency (my call):** SAR is the default currency. Cookie
  `aep_usuc_f=site=glo&c_tp=SAR&region=SA&b_locale=en_US` was verified on
  2026-11-27: English titles, `SAR` prices. Inline filters ("under 50") are in SAR.
  `Product` keeps a `currency` field. Converting between currencies is out of v1,
  because there is only one site.
- **Lowest-price coverage (my call):** each term fetches relevance pages 1–2 plus
  page 1 sorted by `SortType=price_asc`. A `sort` param is added to the op. All
  results go through the relevance and accessory filters before ranking.

- **Language (owner's answer):** English only. Queries, synonym lists, accessory
  words and titles are all English. No Arabic support.
- **Price (owner's answer): the real price of the main option plus shipping to
  Saudi Arabia.** The listed `minPrice` is often a cheap "bait" option, such as the
  case alone or one earbud. Flow:
  1. Search returns candidates. The relevance and accessory filters and dedupe run
     on the listed price.
  2. Only the top N candidates (default 20, configurable) get a product-detail call.
     The call returns every option's price and the shipping cost to SA.
  3. The app picks the "main" option: the one whose name best matches the query,
     ignoring options named like accessories or parts ("case only", "single",
     "left", "replacement"). If unsure, it uses the most common or the
     middle-priced option.
  4. Ranking uses `finalPrice = mainOptionPrice + shipping`. Cards show the final
     price, the option chosen, and shipping. The listed "from" price stays visible
     as secondary.
  5. Product details are cached longer than searches (about 1 h). Detail calls run
     with low concurrency, and the UI fills cards in as they arrive.
  - **Risk / first task:** the product-detail operation (`aliexpress.product`) is
    not learned yet. The item page may embed its data like the search page does,
    or it may use signed `mtop` API calls that are harder to replay. The plan's
    first task is a spike to learn this op with API Anything. If it can't be
    learned at tier 1–2, stop and bring it back to the owner before building on
    it.
  - `Product` gains `listPrice`, `mainOption`, `shipping`, `finalPrice` and
    `detailStatus` (`pending` / `ok` / `failed`). If details fail, the card falls
    back to the listed price with a "price unverified" label.

## Left to the builder

- Exact deal-score formula and relevance threshold (tune on real results).
- Synonym/accessory word lists (seed sensibly, keep in editable files).
- Page count defaults, cache TTL, concurrency.
- Project structure, component breakdown, tests.
- How to bundle the op spec (see above).
