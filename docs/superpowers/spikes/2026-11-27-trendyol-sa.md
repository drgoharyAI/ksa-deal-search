# Spike: trendyol-sa.search (trendyol.sa Saudi, English, SAR) - 2026-11-27

Status: PASS (Step 2 gate met). Op `trendyol-sa.search`, AA site `trendyol-sa`, minTier 1. No Playwright needed.

## Data source / locale
- `www.trendyol.com/en/sr?q=` returns 403 to curl and redirects the browser to **https://www.trendyol.sa/en/sr?q=laptop**
  (finalUrl in capture). trendyol.sa is the Saudi storefront (storefront id 35, code SA, culture en-SA, currency SAR,
  phone +966, `<html lang="en-SA">`, `og:site_name Trendyol.sa`). Locale is set by the domain + `/en/` path: no cookie needed.
- trendyol.sa serves plain HTTP (no bot wall): AA tier 1 works. The search results are server-rendered into a script:
  `window["__single-search-result__PROPS"]={...}` (JSON; `data.products` = 36 items per page, `data.total`, `data.pageIndex`).
- Internal JSON API exists (`apigw.trendyol.sa/discovery-sfint-search-service/api/search/v1/products/?...&q=&pi=&pageSize=36&storefrontId=35&countryCode=SA&language=en`
  per `_links.next`) but was not needed; embedded JSON is simpler. Aggregations endpoint is open to curl (200).

## Recipe (spec: api-specs/trendyol-sa.json)
- trigger `https://www.trendyol.sa/en/sr?q={q}&pi={page}&sst={sort}`; params `q`, `page` (1-based, `pi`), `sort` (`sst`); all three are REQUIRED by AA (no defaults): pass `sort=SCORE`.
- `--embedded 'window\["__single-search-result__PROPS"\]=(\{)'`, `--extract data.products`
- `--pick id=id,title=name,brand=brand,price=binaryPrice.salePriceWihoutCurrency,origPrice=binaryPrice.strikethroughPrice,discount=binaryPrice.discountPercentage,priceNum=price.discountedPrice,listPrice=price.current,rating=ratingScore.averageRating,reviews=ratingScore.totalCount,image=image,path=url,freeShipping=freeCargo,merchantId=merchantId`
- Learned with 2 browser runs (laptop p1 vs headphones p2).
- Sort values (`sst`): SCORE (default/"Most relevant"), PRICE_BY_ASC, PRICE_BY_DESC, MOST_RECENT, BEST_SELLER, MOST_FAVOURITE, MOST_RATED. PRICE_BY_ASC verified (iphone 16: 9.1, 9.19, 9.63... accessories first).

## Field mapping to Product
- id=id (number); title=title (English); currency="SAR" (constant; also in item `price.currency`/`binaryPrice.currency` = SAR, verified on product page).
- price: use `priceNum` (number, = `price.discountedPrice`, the sale price incl. promo). `price` string is the same value formatted with thousands comma ("4,179.05").
- origPrice: STRING with commas ("4,399"), from `binaryPrice.strikethroughPrice`; null when not discounted. discount: string like "-5%" (null when none). Parse: strip commas, Number().
  `listPrice` (number, `price.current`) mostly equals the strikethrough but can differ (basket promo cases); prefer origPrice when set.
- rating=ratingScore.averageRating (absent key when unrated), reviews=ratingScore.totalCount (count of ratings).
- brand, image (absolute cdn.dsmcdn.com, 400px), freeShipping, merchantId extra.
- **URL rule:** `https://www.trendyol.sa` + `path` (path already starts with `/en/` and carries `?boutiqueId=..&merchantId=..`). Verified: GET returns 200 and the product page shows 3,212 SAR matching search.

## Verification (Step 2)
4 queries x 2 pages, all `ok`, tier 1. Items per page 36 in HTML; AA output truncates at 20000 chars (cap), so a call returns 33-36 items (use fields/maxChars if all 36 wanted).
| query | p1 items / ms | p2 items / ms | overlap |
|---|---|---|---|
| wireless earbuds | 35 / 2549 | 33 / 2583 | 0 |
| iphone 16 | 36 / 5923* | 34 / 1815 | 0 |
| smart tv | 33 / 1884 | 34 / 1523 | 0 |
| printer | 36 / 1741 | 34 / 5326 | 0 |
*first attempts for "iphone 16" p1 and "printer" p1 returned transient HTTP 500; retry succeeded (curl of the same URLs: 200). Typical 1.5-2.5 s, occasional 5-6 s.
"samsung tv" only has 33 results total: p2 is HTTP 404 (AA class `input`, "no results"). Treat 404/class input on page>1 as end of results. Titles English (1 item in smart tv had Arabic text; others none). All prices SAR.

## Bait pricing / options
No option-style pricing; each card is one SKU/variant with one price. BUT Trendyol has promo layers: `appPrice` ("WELCOME15" new-buyer app-only price -15%), basket promotions ("Checkout Discount 1% Off", `discountType: basketPromotion`) and TY Plus prices (`priceLabels`). Search `price.discountedPrice` includes basket promotion discount; app-only price is NOT included (good). Discounts are small in many cases (-1%..-17%); `strikethroughPriceType` is `sellingPrice` or `suggestedPrice` (RRP) - RRP strikethroughs can be marketing-inflated; not verified against history. Results are accessories-heavy for cheap queries -> app accessory filter needed.

## Caveats
- `sort` required param (no default) in the AA op; `page` beyond end -> 404.
- Embedded prop name `__single-search-result__PROPS` could change with a site release (regex recipe would break; `ok:false`/no JSON error).
- www.trendyol.com (Turkey) is 403 to curl; only trendyol.sa is used. Whether other Gulf storefronts differ is untested.
- ~26 requests to Trendyol total (capture, 2 add runs, 10+ calls, curl probes).
- AA spec has no cookie (none needed); headers are static Chrome-158 headers, ignored by tier 1 anyway.
