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
- Sites other than AliExpress, amazon.sa, noon KSA and jarir.com (see Scope extension).
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
- **Every store must be its Saudi (KSA) storefront** (owner, 2026-11-27): AliExpress with region SA and shipping to SA, amazon.sa, noon.com/saudi-en and jarir.com/sa-en. Prices are in SAR.
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

## Scope extension (owner, 2026-11-27): Amazon KSA, noon KSA, Jarir

The owner asked to add **amazon.sa**, **noon.com (Saudi, English)** and **jarir.com
(Saudi, English)** alongside AliExpress. "Sites other than AliExpress" moves out of
non-goals for these three.

- Each site gets its own API Anything op `<site>.search` (spec in `api-specs/`)
  and its own adapter, following the same contract. Site ids: `amazon-sa`, `noon-sa`, `jarir`.
- All four sites price in SAR, so cross-site ranking needs no conversion.
- **Price on these three (my call):** these sites list a single price for the
  product shown, and none uses AliExpress-style bait options. So `finalPrice =
  listPrice` and they get no detail call. Shipping is not added; it is usually free
  or flat locally. Cards mark it "shipping not included". If a site's spike shows
  bait-style option pricing, add a detail op for that site.
- Each site is spiked first, the same way as AliExpress (learn the op, check that it
  answers at tier 1–2 with English titles and SAR prices, record fixtures). A site
  that can't be learned reliably is dropped from v1 and reported to the owner. It
  does not block the others.
- Amazon: API Anything bundles an `amazon` op for amazon.com. Start from it and
  adapt it to amazon.sa, or learn a new op.

## Left to the builder

- Exact deal-score formula and relevance threshold (tune on real results).
- Synonym/accessory word lists (seed sensibly, keep in editable files).
- Page count defaults, cache TTL, concurrency.
- Project structure, component breakdown, tests.
- How to bundle the op spec (see above).

## Decisions after spikes (owner, 2026-11-27)

- **AliExpress price = the listed (initial) search price.** This replaces the
  "real price of main option + shipping" flow above. Product pages only work at
  tier 3 (6–8 s of Chrome per product), so there are no detail calls in v1. For every
  site, `finalPrice = listPrice` and `detailStatus:"ok"`. AliExpress cards label the
  price "from" and say "shipping not included". The `aliexpress.product` op stays in
  `api-specs/` for later, unused.
- **AliExpress cookie:** the static header is ignored. The KSA/English cookie is
  loaded into API Anything's session with `api-anything login aliexpress --cookies <file>`,
  run by `scripts/install-specs.mjs`. `call()` needs `view: { maxChars: 200000 }`.
- **Amazon KSA:** passed (tier 1, www.amazon.sa, SAR). Dedupe by `id`, and retry 1–2×
  on transient `error` results marked retry-safe.
- **Jarir:** passed (tier 1, via Jarir's Constructor.io search API, store `sa_en`).
  Currency is a fixed `SAR`, because the payload carries none. There is no rating.
- **noon KSA:** blocked by Akamai Bot Manager at tiers 1–2. The owner asked for a way
  through. Second spike: use the owner's real browser session (import cookies from
  the owner's own Chrome with `api-anything login`), then a real-browser tier, then a
  TLS-impersonating client. Personal-volume traffic only, no captcha solving. If none
  is reliable, noon stays out of v1.
- **noon KSA via Playwright (owner, 2026-11-27): works.** The app starts the
  installed `chrome.exe` with a dedicated profile (`%LOCALAPPDATA%\deal-search\noon-profile`, outside the repo, overridable with `NOON_PROFILE_DIR`),
  with `--remote-debugging-port` bound to 127.0.0.1 on a random free port and the
  window off-screen. It attaches with `chromium.connectOverCDP` and reads product cards
  from the search page HTML. Headless and Playwright-launched Chrome get blocked
  (403 / HTTP2 errors). Expect 4–9 s per search on a warm session, about 8 s cold. One shared
  browser runs searches one at a time and closes after 10 min idle. Dedupe by id.
  Selectors use noon's generated class names, so they will break on site changes;
  the adapter reports `error` instead of throwing. While Chrome runs, any local
  process can drive it through the debug port. That's acceptable for a personal PC,
  and the port is never exposed beyond localhost.
- **Trendyol KSA added (owner, 2026-11-27).** Site id `trendyol-sa`. It must be
  Trendyol's Saudi storefront: English, SAR prices, delivery to Saudi Arabia (Trendyol's
  Gulf/international site with country SA). It is spiked like the others: API
  Anything first, Playwright as a fallback. `finalPrice = listPrice`, and cards say
  "shipping not included".
- **More KSA stores (owner, 2026-11-27):** eXtra (`extra-sa`, extra.com), Carrefour KSA (`carrefour-sa`, carrefourksa.com), SHEIN KSA (`shein-sa`), Temu KSA (`temu-sa`). All must be Saudi storefronts with SAR prices and English titles. Each is spiked first with the usual method: API Anything at tier 1–2, then real Chrome over CDP only if blocked. Personal-volume traffic only, no CAPTCHA solving. A store that can't be read reliably is dropped and reported.
- **SACO KSA (owner request, 2026-11-27):** site id `saco-sa`, label "SACO" (saco.sa, the Saudi
  home, hardware and tools retailer). The English storefront `www.saco.sa/en` is a Next.js site whose
  search page (`/en/products-search?q={q}&sortBy={sort}&sortDir={dir}`) is server-rendered from SACO's
  Algolia index (default region Central, prices in SAR). The op is an API Anything **HTML recipe at
  tier 1** (plain HTTP, no cookies, no login), learned with `capture` + `add`, like Carrefour. The
  storefront's public Algolia search key was not used: calling a third-party index with a key read
  from the site's JavaScript was refused by this session's permission check, and the page itself
  carries every field. Each card's add-to-cart button gives the SKU, English name, SAR price and
  currency; the card adds the struck-out price, a whole-star rating and a stock badge. Two calls per
  search (best match and lowest price, main term only): SACO's search handles typos and synonyms, and
  each page is about 1.9 MB. No Chrome. SACO's robots.txt disallows `/products-search` for crawlers;
  this is a personal, user-initiated search at a low rate (see the README's personal-use note).
  Spike: `docs/superpowers/spikes/2026-11-27-saco-sa.md`.
- **Out-of-stock listings (owner request, 2026-11-27):** a product the store's search answer
  explicitly marks out of stock is dropped in the pipeline's filter step; unknown stock is kept, and
  stock is never guessed from a missing field. `Product.inStock` is set only from a stated field:
  eXtra `inStockFlag`, Trendyol `tagStockBar.isSoldOut`, SHEIN `soldOutStatus`, SACO's "In stock" /
  "Limited stock" badge. AliExpress, Amazon, Jarir, noon and Carrefour state nothing reliable in
  search results, so their products stay unknown. A watched product dropped as out of stock reports
  "out of stock" on the Alerts page, not "not found".
- **Branch pickup only (owner decision, 2026-11-27, replaces dropping SACO's "Click and pick"):**
  SACO cards whose only option is "Click and pick" (badge "Out of stock" or none) cannot be delivered
  from the default region but can be collected at a branch. They are kept as `Product.pickupOnly`,
  shown with a quiet "Branch pickup only" badge on the card, the grouped card row and the compare
  view, and ranked after the deliverable listings of their match tier, so cheapest-first starts with
  the cheapest deliverable listing. They get no deal badge or trend, are not peers for the others'
  badges, are not recorded as price observations, never trigger an alert (a product watch on one
  reports "pickup only"), and are never a history entry's cheapest match. Only explicit signals count:
  an "Out of stock" badge with no button, or with "Add to cart", is unknown.
  The order lives in `rank()` (`src/lib/rank.ts`), so the client's re-sort and a group's lead row
  follow it too.

## Search history and price alerts (owner, 2026-11-27)
These move out of non-goals.
- **Storage:** a local SQLite file via Node's built-in `node:sqlite` (`%LOCALAPPDATA%\deal-search\data.db`, overridable with `DEAL_SEARCH_DB`). No new native dependencies.
- **Search history:** every successful search is recorded: query, stores, sort, filters, time, result count, and the cheapest confident match (title, store, price, url). A History page lists them newest first, re-runs one with a click, deletes single entries, and can clear all.
- **Price alerts:**
  - **Product watch:** from any result card, with a target price (default: the current price minus 5%).
  - **Search watch:** a query plus stores plus a max price. It fires when any confident match (not "less likely") is at or below the target.
  - Each watch keeps its own price history.
  - An Alerts page lists watches, the last check, the current and lowest price, a small sparkline, and pause and delete buttons.
- **Checker:** runs in the app's server process while the app runs.
  - It checks every 6 h by default (configurable), staggered, and reuses the normal store adapters, caches and back-offs.
  - Each store is fetched at most once per query per cycle.
  - A product watch is checked by re-running its source query on its store and matching the product id.
  - A watch that has already fired notifies again only after the price rises above the target and then falls back.
- **Notifications: Telegram.** A bot token and chat id are kept in `.env.local` (`TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`; never committed). Each message gives the title, store, old and new price, target, and link.
  - The Alerts page has a "Send test message" button.
  - If Telegram isn't configured, alerts still show in the app with a setup hint.
  - The token never reaches the browser.

## Comparison and deal-insight features (owner, 2026-11-27)
1. **Same product across stores.** Group results that are the same product into one card with a price per store, the cheapest highlighted. Matching is rule-based:
   - The strongest signal is a shared model number or part code (such as "WH-1000XM5" or "SM-S921").
   - Without one, the titles must agree strongly: same brand, same key specs (capacity, wattage, size, generation), and token similarity above a tuned threshold.
   - A wrong merge must never happen: when unsure, keep the cards separate.
   - The group shows the best price, and each store row links to that store.
   - Ranking applies per group, using the cheapest confident member.
2. **"Is this a real deal?" badge.** Every search records price observations (site + id → price, time) in the local DB, pruned after 180 days.
   - Badges: "Fake deal", "Lowest in 30 days", "Below usual price" (more than 10% under the 30-day median), "Normal price".
   - "Fake deal" (owner, 2026-11-27; replaces the earlier "Inflated 'was' price" badge) applies only when the card shows a discount (discount of 10% or more, or an original price above the price), and one of these holds. Its tooltip names the reason that fired.
     - With history: the price is not below the 30-day median (at least 98% of it): "Discount claimed, but this is its usual price".
     - With history: the store's original price is above every price we've observed for the item and at least 15% above the 30-day median: "The 'was' price was never charged".
     - Without history (works on the first search): the claimed discount is at least 70%, the original price is at least 3 times the price, and the price sits in the result set's normal range (at least half the median of at least 4 confident listings): "Unrealistic 'was' price". This rule is deliberately conservative: a price far under the other listings counts as genuine clearance and is never flagged, and with enough history the history rules decide instead.
   - Priority when several apply: Fake deal, then Lowest in 30 days, then Below usual price, then Normal price. "Lowest in 30 days" needs the price at or under every price in the window and not a flat line.
   - The history rules need at least 3 observations over at least 2 days (Saudi time), with at least 20 hours between the first and the last; otherwise there is no history badge. One observation per product per hour is stored; insights use the earlier observations plus the current price.
3. **Quick filter chips.** Client-side and instant, with no new request: brand (taken from titles), a price range slider, store, minimum rating, and only discounted. Counts show per chip. Filters combine with sort and the match tiers.
4. **Side-by-side compare.** Tick 2–4 products for a compare drawer or page showing image, title, store, price, discount, rating, the deal badge, and key specs parsed from titles (storage, RAM, wattage, capacity, size, resolution, model). Differences are highlighted.
5. **Price trend on cards.** A tiny inline SVG sparkline and a change label ("↓12% vs last week") from the observations, shown only with enough data (same rule as the badge). Each point is the lowest price of its Saudi day, placed on its day so gaps show; today’s point is the current price. A cached store answer is recorded at the time the store gave it, so a repeat is not a new observation.
No LLM or AI. Everything is computed locally, and the UI follows the Hallmark Floor rules.

## Production deployment on a cloud VPS (owner, 2026-11-27)
This supersedes "Runs locally only".
- **Target:** a Linux VPS in a **Saudi region** so stores serve their KSA storefronts. Suggested: Google Cloud Dammam `me-central2`, Oracle Cloud Jeddah, or a Saudi provider. The owner provides the server and a domain.
- **Packaging:** a Docker image (Node 24 plus Google Chrome stable plus Xvfb, so noon and SHEIN run headed on a virtual display) and docker compose with:
  - the app
  - a Caddy reverse proxy with automatic HTTPS
  - a persistent volume for the DB, Chrome profiles, API Anything home, and logs.
  The app port is not published; only Caddy is exposed.
- **No authentication and no usage limits (owner decision, 2026-11-27).** The app runs on the LAN only.
- **Request guard:**
  - Allowed hosts come from `APP_HOSTS` (the domain) instead of loopback-only.
  - The Origin/Sec-Fetch-Site rules stay.
  - It binds to 0.0.0.0 inside the container only.
  - Local dev keeps the loopback behaviour.
- **Secrets:** Telegram token and chat id,  come from env only, documented in `.env.example`, never in the image or git.
- **Ops:**
  - `/api/health` (unauthenticated, no data) for monitoring.
  - Structured logs.
  - Graceful shutdown that closes the Chrome instances.
  - The alerts checker runs in the app container.
  - A backup script for the DB volume.
  - An update procedure: `git pull` then `docker compose up -d --build`.
- **Datacenter-IP risk:** noon and SHEIN may block VPS IPs. The UI already shows "blocked"; this is documented.

### Update (owner, 2026-11-27): hosted on a local Proxmox server on the LAN, not a cloud VPS
- **Host:** a Debian 12 VM on Proxmox (recommended 2 vCPU, 4 GB RAM, 20 GB disk), running Docker plus docker compose. A VM is preferred over LXC so Chrome and Xvfb run without extra privileges.
- **Network:** LAN only, through the home Saudi residential IP, so the stores serve KSA storefronts. The app container publishes port 3000 on the VM's LAN address. `APP_HOSTS` lists the VM IP and an optional LAN hostname (for example `deals.lan`). Caddy is optional and LAN-only: HTTP by default, or Caddy with its internal CA for LAN HTTPS. There is no public exposure and no login.
- **No rate limits or caps** (owner). The existing per-store caching and blocked-store back-offs are kept: they protect against store blocking and are not user limits.
- **The image stays the same:** Node 24, Chrome stable and Xvfb. It has a persistent volume, `/api/health`, restart `unless-stopped`, graceful Chrome shutdown, and a backup script. Proxmox VM backups also cover the volume.
- **Docs:** create the VM, install Docker, clone, configure `.env`, run `docker compose up -d`, then cover updates, backups, logs, and troubleshooting (a store blocked, or Chrome not starting).
