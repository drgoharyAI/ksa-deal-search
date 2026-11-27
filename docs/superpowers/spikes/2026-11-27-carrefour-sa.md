# Spike: carrefour-sa.search (carrefourksa.com, English, SAR) - 2026-11-27

Status: PASS (Step 2 gate met). Op `carrefour-sa.search`, AA site `carrefour-sa`, minTier 1 (plain HTTP, no browser).

## Data source
The English storefront `https://www.carrefourksa.com/mafsau/en/search?keyword={q}` is a Next.js App Router (RSC) page.
There is no `__NEXT_DATA__` and no search XHR on first load: the product grid is **server-rendered HTML**, so the
op is an `--html` recipe (like amazon-sa). A browser capture showed only auxiliary calls (menu, basket, analytics,
`POST /mafrp/api/v1/search/carousel/rr`); no search JSON API was needed, so none was reverse-engineered.
URL (spec): `https://www.carrefourksa.com/mafsau/en/search?keyword={q}&currentPage={page}&sortBy={sort}`
Plain fetch (no cookies, no cookie jar, no browser) returned the grid, so tier 1.

## Recipe (spec: api-specs/carrefour-sa.json)
Learned with `capture` + `add --from <cap> --pick-request 1 --html '<recipe>'` (two captures: laptop, milk), then hand-edited
to add the `page`/`sort` slots (`currentPage`, `sortBy`) because the learn captures had no such params.
- items: `div.group:has(> a[href*="/p/"])` (product card)
- title `.line-clamp-2`; price `.items-baseline > :nth-child(2)`; orig `.items-baseline > :nth-child(3)` (absent when not discounted);
  disc `.text-xs.font-bold.left` (e.g. "52% OFF", absent when not discounted); url `a@href`
- params: `q` (required), `page` (optional, **0-based**, maps to `currentPage`: 0 = first page, 1 = second), `sort` (optional, enum relevance|price_asc, maps to `sortBy`).
  Spec URL defaults are `currentPage=0&sortBy=relevance`.

## Field mapping to Product
- id: parse `/p/(\d+)` from `url` (e.g. 739302). Not a separate field.
- title = title (English, may contain legit non-ASCII like the multiply sign and en dash).
- price = Number(price.replace(/,/g,'')) - string with thousands comma, e.g. "2,549.00" (!).
- currency = "SAR" (constant; the card shows a separate "SAR" label span before the number, so SAR is on-page, not only inferred).
- origPrice = Number(orig.replace(/,/g,'')) when present (strikethrough price); null when the field is absent.
- discount = disc (string "NN% OFF" -> number); equals round((1-price/orig)*100). Absent when no discount.
- rating, reviews: not on the card (null). image: NOT in the server HTML (images are client-loaded; only badge images present) -> null.
- url: absolute, already `https://www.carrefourksa.com/mafsau/en/<category>/<slug>/p/<id>?offer=offer_carrefour_&sid=EXPRESS&sellerId=0000`.
  The query string is the express/offer context; `url.split('?')[0]` gives the canonical product URL (strip for dedup).

## KSA store / delivery area
- Store is in the path: `/mafsau/en/` (MAF Saudi Arabia, English). No cookie, header or login was needed for results.
- Default area is Riyadh: the page header shows "Granada - Riyadh"; the site's own calls used `latitude=24.7136&longitude=46.6753`
  (Riyadh centre) on a cookieless first visit. Availability/"Tod. 2:00 PM" delivery slot text is area-dependent; prices on the cards are the ones for that default area.
- Not tested: other cities/areas; whether prices vary by area; whether a store-closed state (page said "Store is closed! Place your order for Today, 2:00 PM") hides items. Items were still listed.
- Setting a different area would need cookies via `login <site> --cookies <file>` (not explored, not needed).

## Verification (Step 2)
4 queries x 2 pages (`page=0` and `page=1`), all `ok`, tier 1, English titles, product URLs under /mafsau/en/, all items priced, 0 URL overlap between pages (compared without query string):
| query | p0 items / ms | p1 items / ms | discounted p0/p1 |
|---|---|---|---|
| milk | 60 / 2262 | 60 / 2089 | 24 / 22 |
| coffee | 60 / 2223 | 60 / 1841 | 19 / 20 |
| samsung | 60 / 2401 | 14 / 3938 | 27 / 2 |
| shampoo | 68 / 2905 | 58 / 2009 | 48 / 37 |
Page size is ~60 cards (shampoo 68: some extra sponsored/carousel cards matching the selector). Short or narrow queries run out: "tv" returned only 5 items on page 0 and page 1 returned `class:"input"` ("no results for these args"), "laptop" has 39 results total (page 1 = "No results found"). So `class:"input"` on an empty page 2 is the normal end-of-results signal, not a failure.
Sort: `sort=price_asc` works (milk: 1.00, 1.00, 1.00, 1.25 ...). `sortBy=price_desc` is accepted but is NOT a true descending order (milk: 194.50, 194.50, 39.75, 14.50, 30.24 ...), so it is not in the enum. Relevance order is the default; it often puts accessories/bags among laptop results ("laptop" -> laptop bags, backpacks) -> app filter needed.

## Discounts / bait pricing
Real list-vs-sale: struck-through `orig` and "NN% OFF" badge (up to ~69%). There are additional promo lines on cards not captured ("Extra SAR 200 or 10% off", "Only 3 left", Tabby/Tamara instalments); the "Extra SAR 200 or 10% off" is a conditional promo (not reflected in `price`), so treat `price` as the shelf price. No option-style/bait pricing seen: one SKU, one price per card. Multi-pack titles (e.g. "x 18 Pieces") have pack prices, so unit price comparison needs title parsing.

## Caveats
- HTML scrape: Tailwind-like class selectors (`.line-clamp-2`, `.items-baseline`, `.text-xs.font-bold.left`) can break on a redesign; `a[href*="/p/"]` is more stable. Cards with an unusual price layout (e.g. price on request) would yield empty price.
- `page` is 0-based; wrapper must pass page-1. `currentPage=1` gives page 2 (verified), `page=2` (our first guess) is ignored by the site and returns page 1.
- Akamai (bot manager) fronts the site; plain fetch from this machine worked at ~2-4s/call, but heavier use may trigger challenges. ~22 page requests were made (browser captures also fetch site sub-resources). No CAPTCHA/proxy/spoofing.
- curl from the sandbox could not reach the host; all traffic went through api-anything.
- Fixture: `tests/fixtures/carrefour-sa-search.json` is the raw `call carrefour-sa search q=samsung page=0` result (60 items, 27 discounted).
