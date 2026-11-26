# Spike: AliExpress product-detail op + search sort/cookie (2026-11-27)

**Result: STOP-GATE HIT.** `aliexpress.product` returns all the data we need
(SKUs with SAR prices, shipping to Saudi Arabia), but only at **tier 3**: a
real Chrome run for every call, about 6–8 s each. Step 4 needs tier ≤ 2. The
owner decides whether to accept tier 3 or pick another approach (options at the end).

`aliexpress.search` meets all of its criteria (tier 1, English, SAR, sort works).

Tool: `api-anything@0.5.0`, `API_ANYTHING_HOME=<repo>/.aa-home`,
`API_ANYTHING_LOCAL_ONLY=1`. Windows 11, Node v24.16.0.

## 1. Search op (`aliexpress.search`): passes

Re-learned with the brief's `add` command (trigger
`https://www.aliexpress.com/w/wholesale-{q}.html?page={page}&SortType={sort}`), using the same
`--embedded`, `--extract` and `--pick` as before. Params are `q`, `page` and `sort`, all strings.
`sort` maps to `query:SortType`. `minTier: 1`.

### Sort values

| `sort` | Result (q=anc-earbuds, page 1, English/SAR) |
|---|---|
| `price_asc` | ascending: 10.91, 13.44, 14.20, 14.91, 15.04 … SAR |
| `default` | relevance: 148.37, 35.12, 93.68 … SAR |
| `""` (empty, sends `SortType=`) | relevance; same first item as `default`, 48 of 60 ids shared. The order varies a little between calls, as relevance results do. |

**Ruling:** the empty string is valid and means default relevance. The app can send
`sort: ""`, as the interface says. `default` also works. The param is still marked
`required`, but an empty string is accepted.

### Locale cookie: the static header is ignored

The brief said to add `"cookie": "aep_usuc_f=site=glo&c_tp=SAR&region=SA&b_locale=en_US"` to
`request.headers`. I did, and it is in `api-specs/aliexpress.json`. **It has no effect.**
`buildRequest` in api-anything (`src/http.ts`) runs `delete req.headers.cookie` and then sends
only the site's session cookie jar. With only the header, titles stayed Arabic.

What works is seeding the jar:

```sh
api-anything login aliexpress --cookies ae-cookies.json
# ae-cookies.json:
# [{"name":"aep_usuc_f","value":"site=glo&c_tp=SAR&region=SA&b_locale=en_US",
#   "domain":".aliexpress.com","path":"/","expires":1830000000,"httpOnly":false,"secure":false,"sameSite":"Lax"}]
```

This answers `ok:true, loggedIn:false`, with a harmless "looks signed out" warning. After it,
search returns English titles and `currency:"SAR"`. The jar lives in
`.aa-home/sessions/aliexpress.json` (DPAPI-encrypted, gitignored).
**The app must seed the jar at setup or startup.** The library's `index.ts` exports no login
function, so the app has to run the CLI.

### Verify (step 2)

`call aliexpress search q=anc-earbuds page=1 sort=price_asc`: `ok:true`, `tier:1`, 60 items,
English titles, `currency:"SAR"`. The first price (10.91) is lower than with `sort=default`
(148.37). Calls take 2.1–3.5 s.

## 2. Product op (`aliexpress.product`): data good, tier 3 only

### Where the data is

- `https://www.aliexpress.com/item/{id}.html` is client-side rendered (`window._d_c_.isCSR = true`,
  `window.runParams = {}`). The HTML holds no product data, and `_init_data_` there is only
  loader code. It redirects to `ar.aliexpress.com/...?gatewayAdapt=glo2ara`, even with the
  en_US cookie. `m.aliexpress.com/item/{id}.html` redirects to the same desktop CSR page.
- The data comes from the mtop JSONP request
  `GET https://acs.aliexpress.com/h5/mtop.aliexpress.pdp.pc.query/1.0/?jsv=2.5.1&appKey=12574478&t=<ms>&sign=<md5>&api=mtop.aliexpress.pdp.pc.query&type=originaljsonp&dataType=originaljsonp&callback=mtopjsonp1&data=<json>`.
  Its `data` is `{"productId":"…","_lang":"en_SA","_currency":"SAR","country":"SA",…}`.
- `sign` is the mtop signature, md5(`_m_h5_tk` token & t & appKey & data). It changes for every
  request. A curl replay of a captured URL answers
  `{"ret":["FAIL_SYS_TOKEN_EMPTY::令牌为空"]}`. The learner flags it:
  `changes between runs without an arg change (nonce/signature), so minTier 3: query:sign`.
  api-anything cannot compute mtop signatures, so tier 1 and tier 2 cannot replay the request.

### Recipe (learned with `add --from <capture> --pick-request 18`)

```
add aliexpress product --from cmwy6ixgr --pick-request 18 --example id=1005008932971097 \
  --from2 cmwy6j3ug --example2 id=1005012033327348 \
  --embedded 'mtopjsonp\d+\((\{)' --extract data.result \
  --pick 'title=PRODUCT_TITLE.text,region=PRICE.region,prices=PRICE.skuIdStrPriceInfoMap,skuProps=SKU.skuProperties,skuPaths=SKU.skuPaths,shipping=SHIPPING.deliveryLayoutInfo[*].bizData'
```

`--match host=… --match path=…` with a trigger did not match the request; a `script`-kind
JSONP request may not be matched that way. Learning from saved captures worked.
`--embedded` with a JSONP-callback regex parses the response.

Note: on Git Bash, `--match 'path=/h5/...'` is mangled into `C:/Program Files/Git/h5/...`
unless `MSYS_NO_PATHCONV=1` is set. If you set it, `API_ANYTHING_HOME` must then be a Windows path.

### Raw shape (one item of `data`)

```jsonc
{
  "title": "TWS Wireless Bluetooth Earphones ANC …",          // English
  "region": "SA",
  "prices": {                                                  // map keyed by skuIdStr (not an array)
    "12000047256592641": {
      "originalPrice": { "currency": "SAR", "formatedAmount": "56.08", "value": 56.08 },
      "salePriceString": "SAR18.24",                           // sale price is a string only
      "salePriceLocal": "SAR18.24|18|24"
    }
  },
  "skuProps": [                                                // SKU.skuProperties
    { "skuPropertyId": 14, "skuPropertyName": "Color",
      "skuPropertyValues": [ { "propertyValueDisplayName": "White", … } ] },
    { "skuPropertyName": "Ships From", … }
  ],
  "skuPaths": [                                                // SKU.skuPaths
    { "skuIdStr": "12000047256592641", "skuAttr": "14:29#White;200007763:201336100",
      "path": "14:29;200007763:201336100", "salable": true, "skuStock": 44 }
  ],
  "shipping": [                                                // one bizData per delivery option
    { "shipToCode": "SA", "shipFrom": "China",
      "displayAmount": 19, "displayCurrency": "SAR", "formattedAmount": "SAR19.00",
      "currency": "CNY",                                       // base currency: do NOT use with displayAmount
      "shippingFee": "charge",                                 // "free" when free (expected; not seen in this sample)
      "deliveryDayMin": 10, "deliveryDayMax": 18,
      "deliveryProviderName": "Aliexpress Selection Standard",
      "utParams": "{\"fAmount\":19.0,\"fCurrency\":\"SAR\",\"shipToCountry\":\"SA\",…}"  // JSON string
    }
  ]
}
```

### Mapping to `RawDetail`. `--pick` cannot do it, so `fetchDetail` (Task 6) must.

- `id` = call arg.
- `title` = `title`.
- `skus` = for each `skuPaths[i]`:
  - `name`: from `skuAttr`, take each `;`-part's text after `#`. Join with " / ", e.g. "White".
    Skip the "Ships From" part or keep it; this is the implementer's choice.
  - `price`: parse `prices[skuIdStr].salePriceString`. Remove the currency prefix
    (`"SAR18.24"` → 18.24) or take `salePriceLocal.split("|")[0]`. Fall back to
    `originalPrice.value`.
  - `currency`: `prices[skuIdStr].originalPrice.currency` ("SAR").
  - `available`: `salable`.
- `shipping` = pick the first `shipping[]` entry, or the cheapest one:
  - `{ cost: shippingFee === "free" ? 0 : displayAmount, currency: displayCurrency, days: `${deliveryDayMin}-${deliveryDayMax}` }`.
  - It is `null` when the array is empty.

**Ship-to check (owner requirement, KSA view):** in all 5 results `region:"SA"`,
`shipping[*].shipToCode:"SA"`, `utParams.shipToCountry:"SA"`, and `displayCurrency:"SAR"`. Prices are
SAR. Ship-to Saudi Arabia is confirmed. The tier-3 browser had no locale cookie and landed on
`ar.aliexpress.com`. Even so, the mtop request carried `country:"SA"`, `_currency:"SAR"` and
`_lang:"en_SA"`, and returned English titles. The country appears to come from the IP. If the app
ever runs from outside KSA, re-check this.

### Verify (step 4): 5 ids, via library `call()` with `view.maxChars:200000`

| id | ok | tier | ms | skus | SKU price range (SAR) | shipping |
|---|---|---|---|---|---|---|
| 1005008932971097 | ok | **3** | 7747 | 1 | 18.24 | SA, charge, SAR 19, 10–18 d |
| 1005012033327348 | ok | **3** | 6062 | 1 | 24.82 | SA, charge, SAR 19, 10–18 d |
| 1005012229399207 | ok | **3** | 6535 | 6 | 131.96–156.22 | SA, charge, SAR 19, 10–18 d |
| 1005010750452192 | ok | **3** | 6006 | 4 | 20.94–22.35 | SA, charge, SAR 19, 10–18 d |
| 1005012580507258 | ok | **3** | 6340 | 4 | 15.04–15.47 | SA, charge, SAR 19, 10–20 d |

All 5 have numeric SKU prices and SA shipping cost, which passes. **None is tier ≤ 2, so step 4 fails.**

The same calls produced the fixtures, which are real `call()` output:
- `tests/fixtures/aliexpress-search.json` is one search (q=anc-earbuds, page 1, sort ""), with 60 items at tier 1.
- `tests/fixtures/aliexpress-product.json` is `[{args:{id}, result}]` for the 5 ids above, all tier 3.
  Three of them have multiple SKUs.

## 3. Other findings for later tasks

- `call()` caps `data` at 20 000 JSON chars by default (`truncated`, `resultId`). A 60-item
  search is about 26 KB, so the app must pass `{ view: { maxChars: 200000 } }`.
- Pacing: api-anything keeps a gap of at least 1 s between requests per site.
- In the search results, `sold` is now English ("10,000+ sold", "2 sold"). Images are still
  protocol-relative.

## 4. Options for the owner

1. **Accept tier 3 for product detail.** It costs about 6–8 s and a headless Chrome per product.
   Use it only on demand (e.g. "check shipping" for one result, or the top N), with caching.
   Search stays tier 1.
2. **Skip the detail op.** Show search data only. The search item has no shipping cost, so
   showing it would need option 1 or 3.
3. **Sign mtop ourselves**, outside api-anything. Get `_m_h5_tk` from a first call's
   `set-cookie`, then compute md5(token&t&appKey&data). This is fast (tier 1), but it is our own
   code against an undocumented, signed API, and it may break or be blocked.
4. AliExpress Affiliate API (approach 3 in the design). It is official, but needs app approval.
