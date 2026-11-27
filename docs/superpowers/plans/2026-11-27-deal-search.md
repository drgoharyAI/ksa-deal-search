# Deal Search Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a local Next.js app that searches AliExpress (more sites later) through API Anything. It filters results with rule-based smart search and ranks them by real price (main option + shipping to SA) or by discount.

**Architecture:** Next.js route handlers call site adapters. Each adapter wraps `call()` from `api-anything` behind a TTL cache and a concurrency limit. Pure functions in `src/lib` handle query parsing, relevance, accessory filtering, dedupe and ranking. The UI calls `/api/search` first, then `/api/details` in batches to fill in real prices.

**Tech Stack:** Next.js (App Router) + TypeScript + Tailwind, `api-anything@0.5.x`, Vitest, Node 24 on Windows 11.

**Spec:** `docs/superpowers/specs/2026-11-27-deal-search-design.md`

## Global Constraints

- No LLM / AI API calls anywhere: no `@anthropic-ai/*`, `openai`, embeddings or remote model.
- Runs locally only (`npm run dev` / `npm start`). There is no deploy config.
- `api-anything` is imported only in server code (route handlers, `src/sites/**`, `src/lib/aa.ts`). Never in client components.
- `API_ANYTHING_LOCAL_ONLY=1` and `API_ANYTHING_HOME=./.aa-home` are always set (in `.env.local` and the npm scripts).
- AliExpress cookie on every request: `aep_usuc_f=site=glo&c_tp=SAR&region=SA&b_locale=en_US` (English titles, SAR prices).
- Currency is SAR. There is no currency conversion.
- **All stores are the Saudi (KSA) storefront.** That means aliexpress.com with `region=SA` and shipping to SA, `www.amazon.sa`, `www.noon.com/saudi-en`, and `www.jarir.com/sa-en`. Each spike verifies the KSA storefront, SAR prices, and (where shown) delivery to Saudi Arabia. Each adapter has a test asserting every product `url` is on its KSA domain/path and `currency === "SAR"`.
- English only: queries, synonym lists and accessory words.
- Traffic limits: search pages per term = relevance pages 1–2 + `SortType=price_asc` page 1. Up to 2 extra synonym variants. Detail calls only for the top N=20 (configurable). Concurrency 3 for search calls and 2 for detail calls.
- Cache TTL: search 10 min, product detail 60 min.
- On `blocked` or rate-limit results, don't retry. Report them to the UI.
- Product URL: `https://www.aliexpress.com/item/{id}.html`. Image URLs starting `//` get `https:` added.

## Review Focus

1. A query that is only constraints (`under 50`) or is empty → `/api/search` returns 400 `{error:"Enter something to search for"}`, not a crash. Tested in Task 7.
2. One site or one detail call is `blocked` → the other results still show. That site's status shows `blocked`, and the card shows "price unverified". Tested in Tasks 6–7.
3. Everything filtered out → an empty list with `reason`, and the UI shows "No matching products". Tested in Task 7.
4. Raw items missing `price` or `discount`, or with `sold` empty → the item is skipped or gets defaults, with no `NaN` in output. Tested in Task 4.
5. Queries with `/`, `&`, quotes, unicode or extra spaces → slug is `[a-z0-9-]+`, with no empty slug sent. Tested in Task 4.

---

## File Structure

```
api-specs/aliexpress.json          AA site spec (search + product ops), committed
scripts/install-specs.mjs          copy api-specs/*.json → $API_ANYTHING_HOME/sites/
data/synonyms.json                 synonym groups (editable)
data/accessory-words.json          accessory word list (editable)
src/lib/types.ts                   Product, ParsedQuery, SiteAdapter, SiteStatus, RawDetail
src/lib/cache.ts                   TtlCache<T>
src/lib/aa.ts                      aaCall(): cached, concurrency-limited wrapper over api-anything call()
src/lib/query/parse.ts             parseQuery()
src/lib/query/synonyms.ts          expandTerms()
src/lib/match/tokenize.ts          tokenize()
src/lib/match/relevance.ts         scoreRelevance(), filterRelevant()
src/lib/match/accessory.ts         isAccessory()
src/lib/match/dedupe.ts            dedupe()
src/lib/rank.ts                    rank(), dealScore()
src/lib/pipeline.ts                runSearch()
src/sites/aliexpress/search.ts     buildCalls(), normalizeSearchItem(), slugify(), parseSold()
src/sites/aliexpress/detail.ts     fetchDetail(), pickMainOption()
src/sites/registry.ts              sites: Record<string, SiteAdapter>
app/api/search/route.ts            POST /api/search
app/api/details/route.ts           POST /api/details
app/page.tsx + app/components/*    UI
tests/fixtures/aliexpress-*.json   recorded op outputs from Task 1
tests/**/*.test.ts                 Vitest
```

---

### Task 1: Spike — product-detail op + search op with sort and cookie (STOP-GATE)

**Files:**
- Create: `api-specs/aliexpress.json`, `tests/fixtures/aliexpress-search.json`, `tests/fixtures/aliexpress-product.json`, `docs/superpowers/spikes/2026-11-27-aliexpress-product.md`

**Interfaces:**
- Produces: op `aliexpress.search` with params `q` (slug), `page` ("1"|"2"…) and `sort` (`""`|`"price_asc"`, mapped to the `SortType` query param). Item fields: `id,title,price,currency,discount,origPrice,rating,sold,image`.
- Produces: op `aliexpress.product` with param `id`. Its data matches `RawDetail`:
  `{ id: string; title: string; skus: { name: string; price: number; currency: string; available?: boolean }[]; shipping: { cost: number | null; currency: string; days?: string } | null }`

- [ ] **Step 1: Start a project-local API Anything home.** Run `git init`, add `.aa-home/` to `.gitignore`, set `API_ANYTHING_HOME=./.aa-home` and `API_ANYTHING_LOCAL_ONLY=1`, then copy `%USERPROFILE%\.api-anything\sites\aliexpress.json` into `.aa-home/sites/`.
- [ ] **Step 2: Add the locale cookie and `sort` to the search op.** Re-learn with `npx api-anything add aliexpress search --trigger 'https://www.aliexpress.com/w/wholesale-{q}.html?page={page}&SortType={sort}' --example q=usb-c-cable --example page=1 --example sort=default --example2 q=mechanical-keyboard --example2 page=2 --example2 sort=price_asc` with the same `--embedded/--extract/--pick` as the spec's spike section. Add header `"cookie": "aep_usuc_f=site=glo&c_tp=SAR&region=SA&b_locale=en_US"` to `request.headers` in the saved spec.
  Verify: `npx api-anything call aliexpress search q=anc-earbuds page=1 sort=price_asc` → `ok:true`, `tier:1`, English titles, `currency:"SAR"`, first price lower than with `sort=default`.
- [ ] **Step 3: Capture a product page.** Run `npx api-anything capture "https://www.aliexpress.com/item/<id from step 2>.html" --example id=<id>`. Look for embedded JSON (e.g. `window.runParams`, `_init_data_`, `__INIT_DATA__`) holding SKU prices and shipping, using `inspect <capture> 1 --embedded ... --outline`. If the document has no SKU data, inspect `mtop.aliexpress.pdp.*` xhr candidates.
- [ ] **Step 4: Learn `aliexpress.product`** with `add aliexpress product --trigger 'https://www.aliexpress.com/item/{id}.html' --example id=<a> --example2 id=<b>` and a recipe whose `--pick` produces the `RawDetail` shape. Use `[*]` paths for skus. If the site can't produce it directly, do the mapping in `fetchDetail` (Task 6) and record the raw shape in the spike notes.
  Verify: call it for 5 different ids → each `ok`, `tier` ≤ 2, ≥1 sku with numeric price, shipping cost for SA present or explicitly free.
- [ ] **Step 5: STOP-GATE.** If `aliexpress.product` fails Step 4 (blocked, tier 3 only, or no shipping/SKU data), **stop the plan**. Write the findings in the spike notes and report to the owner. Do not continue to Task 2.
- [ ] **Step 6: Record outputs.** Save raw `call()` results to the two fixture files: one search of 60 items, and 5 product results including one with multiple skus. Copy `.aa-home/sites/aliexpress.json` to `api-specs/aliexpress.json`. Write the spike notes: recipe, raw shape, tiers and timings.
- [ ] **Step 7: Commit** `chore: aliexpress api-anything ops + fixtures (spike)`.

---

### Task 2: Scaffold app, test runner, spec install, `aaCall` wrapper

**Files:**
- Create: Next app files (via `create-next-app`, TS + Tailwind + App Router + `src/` off, app in `app/`), `vitest.config.ts`, `scripts/install-specs.mjs`, `.env.local`, `src/lib/cache.ts`, `src/lib/aa.ts`, `src/lib/types.ts`
- Test: `tests/lib/cache.test.ts`, `tests/lib/aa.test.ts`

**Interfaces:**
- Produces: `class TtlCache<T> { constructor(ttlMs: number); get(key: string): T | undefined; set(key: string, v: T): void }`
- Produces: `aaCall(site: string, op: string, args: Record<string,string>, opts: { ttlMs: number; lane: "search" | "detail" }): Promise<AaResult>`, where `type AaResult = { ok: true; tier: number; data: unknown } | { ok: false; class: string; reason: string }`. Results are cached by `site/op/JSON(args)`, and only `ok` results are cached. Lane concurrency is search 3, detail 2 (`p-limit`).
- Produces: in `types.ts`, `Product`, `ParsedQuery`, `SiteAdapter`, `SiteStatus`, `RawDetail` (fields as used in Tasks 3–7).
  - `Product = { site; id; title; listPrice: number; origPrice: number | null; discountPct: number | null; currency: string; rating: number | null; soldCount: number; image: string; url: string; mainOption?: string; shipping?: number | null; finalPrice?: number; detailStatus: "pending" | "ok" | "failed" }`
  - `ParsedQuery = { terms: string; minPrice?: number; maxPrice?: number; minRating?: number; exclude: string[] }`
  - `SiteStatus = { site: string; status: "ok" | "blocked" | "error"; message?: string }`
  - `SiteAdapter = { id: string; label: string; searchCalls(pq: ParsedQuery, variants: string[]): { op: string; args: Record<string,string> }[]; normalizeSearchItem(raw: unknown): Product | null; fetchDetail(p: Product, queryTokens: string[][]): Promise<Product> }`

- [ ] **Step 1:** Scaffold with `npx create-next-app@latest . --ts --tailwind --app --eslint --no-src-dir --import-alias "@/*"`. Then `npm i api-anything p-limit` and `npm i -D vitest`. Add scripts: `"test": "vitest run"`, `"predev"` and `"prestart": "node scripts/install-specs.mjs"`. Put `API_ANYTHING_HOME=./.aa-home` and `API_ANYTHING_LOCAL_ONLY=1` in `.env.local`. `install-specs.mjs` must also load them, so it reads `.env.local` itself.
- [ ] **Step 2: Write failing tests.**
  - `TtlCache returns value before ttl and undefined after` (fake timers)
  - `aaCall caches ok results`: mock `api-anything` `call`, call twice → mock called once.
  - `aaCall does not cache failures`
  - `aaCall returns {ok:false, class:"blocked"} unchanged`
- [ ] **Step 3: Run** `npm test` → FAIL (modules missing).
- [ ] **Step 4:** Implement `cache.ts`, `aa.ts` and `types.ts`.
- [ ] **Step 5: Run** `npm test` → PASS. `node scripts/install-specs.mjs` → `.aa-home/sites/aliexpress.json` exists.
- [ ] **Step 6: Commit** `feat: scaffold next app, aaCall wrapper, spec install`.

---

### Task 3: Query parsing + synonym expansion

**Files:**
- Create: `src/lib/query/parse.ts`, `src/lib/query/synonyms.ts`, `data/synonyms.json`
- Test: `tests/lib/query.test.ts`

**Interfaces:**
- Produces: `parseQuery(input: string): ParsedQuery`
- Produces: `expandTerms(terms: string, max = 2): string[]`. Returns up to `max` variant term strings, each different from `terms` and from each other.
- `data/synonyms.json`: `string[][]`. Seed it with `["anc","noise cancelling","noise canceling"]`, `["earbuds","tws","earphones","wireless earphones"]`, `["usb-c","type-c","usb c"]`, `["powerbank","power bank"]`, `["smartwatch","smart watch"]`, `["phone holder","phone mount"]`.

- [ ] **Step 1: Write failing tests**
  - `"anc earbuds under 50"` → `{terms:"anc earbuds", maxPrice:50, exclude:[]}`
  - `"keyboard 100-250 >4.5 stars -wired"` → `{terms:"keyboard", minPrice:100, maxPrice:250, minRating:4.5, exclude:["wired"]}`
  - `"<30 usb-c cable"` → `{terms:"usb-c cable", maxPrice:30}` (the `-` inside a word is not an exclude)
  - `"over 20 power bank"` → `minPrice:20`
  - `"   "` → `terms:""`
  - `expandTerms("anc earbuds")` includes `"noise cancelling earbuds"`, length ≤ 2, no duplicates of input
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3:** Implement with regexes for `under|below|<N`, `over|above|>N` (when not followed by `stars`), `N-M`, `>N stars|N+ stars`, and ` -word`. The remainder is lowercased with whitespace collapsed. `expandTerms` replaces the first matching group member (longest match first) with the other members.
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat: rule-based query parsing and synonyms`.

---

### Task 4: AliExpress search adapter (normalize, slugify, sold parsing)

**Files:**
- Create: `src/sites/aliexpress/search.ts`
- Test: `tests/sites/aliexpress-search.test.ts` (uses `tests/fixtures/aliexpress-search.json`)

**Interfaces:**
- Consumes: `Product`, `ParsedQuery` (Task 2)
- Produces: `slugify(terms: string): string`, `parseSold(s: string | undefined): number`, `normalizeSearchItem(raw: unknown): Product | null`, `searchCalls(pq: ParsedQuery, variants: string[]): {op:"search"; args:{q:string;page:string;sort:string}}[]`

- [ ] **Step 1: Write failing tests**
  - `slugify("ANC  Earbuds / Pro & \"Max\"")` → `"anc-earbuds-pro-max"`. `slugify("usb-c cable")` → `"usb-c-cable"`. `slugify("¿¿")` → `""`.
  - `parseSold("10,000+ sold")` → `10000`. `"3K+ sold"` → `3000`. `"1.2K sold"` → `1200`. `undefined` → `0`.
  - `normalizeSearchItem({id:"1",title:"X",price:7.91,currency:"SAR",discount:80,image:"//a/b.jpg"})` → `origPrice` ≈ `39.55`, `image:"https://a/b.jpg"`, `url:"https://www.aliexpress.com/item/1.html"`, `detailStatus:"pending"`, `soldCount:0`, `rating:null`.
  - Missing `price` → `null`. Missing `discount` and `origPrice` → `discountPct:null, origPrice:null`. No `NaN` in any field (check every fixture item).
  - Every fixture item normalizes to a Product or `null`, and ≥ 50 are non-null.
  - `searchCalls({terms:"anc earbuds",exclude:[]}, ["noise cancelling earbuds"])` → 6 calls: per term, pages 1, 2 with `sort:"default"` + page 1 with `sort:"price_asc"`. Terms whose slug is `""` are skipped.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3:** Implement. `origPrice` = raw `origPrice` if present, else `round2(price / (1 - discount/100))` when `0 < discount < 100`.
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat: aliexpress search adapter`.

---

### Task 5: Relevance, accessory filter, dedupe

**Files:**
- Create: `src/lib/match/tokenize.ts`, `relevance.ts`, `accessory.ts`, `dedupe.ts`, `data/accessory-words.json`
- Test: `tests/lib/match.test.ts`

**Interfaces:**
- Produces: `tokenize(s: string): string[]`. Lowercase, splits on non-alphanumerics but keeps `usb-c` style tokens joined, drops 1-char tokens.
- Produces: `scoreRelevance(queryTokens: string[][], title: string): number`, where `queryTokens` is one token list per term variant. Score is 0..1: the best over variants of (matched query tokens / query tokens). A match is an exact token, a prefix ≥ 4 chars, or Levenshtein ≤ 1 for tokens ≥ 5 chars. Use BM25-style IDF weighting across the current result set.
- Produces: `filterRelevant(products: Product[], queryTokens: string[][], threshold = 0.6): Product[]`
- Produces: `isAccessory(title: string, queryTokens: string[]): boolean`. True when an accessory word appears in the title's first 6 tokens, or appears paired with `for`, and no query token is an accessory word.
- Produces: `dedupe(products: Product[]): Product[]`. Groups titles with token-set Jaccard ≥ 0.85 and keeps the lowest `listPrice`.
- `data/accessory-words.json`: `["case","cover","tips","eartips","strap","band","cable","charger","holder","stand","sticker","film","protector","replacement","adapter","pouch","bag","skin"]`

- [ ] **Step 1: Write failing tests**
  - Query "anc earbuds": `"Baseus EP10 Pro ANC Earbuds Wireless Bluetooth 6.0"` passes. `"Silicone Case Cover for AirPods Pro"` is an accessory. `"Replacement Ear Tips for Earbuds"` is an accessory.
  - Query "usb-c cable": a cable title is **not** an accessory (the query contains `cable`).
  - `"noise cancelling earbuds"` variant tokens let `"Noise Cancelling TWS Earphones"` score ≥ 0.6 when variants are `[["anc","earbuds"],["noise","cancelling","earbuds"],["noise","cancelling","earphones"]]`.
  - Typo: `"earbud"` matches `"earbuds"`.
  - `dedupe` of two titles differing only by color word keeps the cheaper.
  - Empty product list → empty list, no throw.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat: relevance, accessory filter, dedupe`.

---

### Task 6: REMOVED (owner 2026-11-27: AliExpress uses listed price; no detail calls). Implementers skip this task; `fetchDetail = async p => p` everywhere, `/api/details` route and detail UI fill-in are dropped.

### (old) Task 6: Product detail — main option + final price

**Files:**
- Create: `src/sites/aliexpress/detail.ts`, `src/sites/registry.ts`
- Test: `tests/sites/aliexpress-detail.test.ts` (uses `tests/fixtures/aliexpress-product.json`)

**Interfaces:**
- Consumes: `aaCall` (Task 2), `RawDetail` (Task 1), `tokenize`/`scoreRelevance` (Task 5)
- Produces: `pickMainOption(skus: RawDetail["skus"], queryTokens: string[][]): RawDetail["skus"][number] | null`
- Produces: `fetchDetail(p: Product, queryTokens: string[][]): Promise<Product>`. Sets `mainOption`, `shipping`, `finalPrice = price + (shipping ?? 0)` and `detailStatus:"ok"`. On a failed call it sets `detailStatus:"failed"` and `finalPrice = listPrice`.
- Produces: `sites = { aliexpress: SiteAdapter }`, which wires Task 4's `searchCalls`/`normalizeSearchItem` and this task's `fetchDetail`.

- [ ] **Step 1: Write failing tests**
  - Skip SKUs whose names contain `case only`, `single`, `left`, `right`, `replacement`, `box only`, `no earbuds`, or `available:false`.
  - Among the rest, choose the highest `scoreRelevance` against the query. On a tie, choose the median-priced option.
  - Fixture with multiple skus → the chosen option isn't the cheapest bait SKU (assert on the fixture's real values recorded in Task 1).
  - All SKUs filtered → falls back to the median-priced SKU over all SKUs.
  - `skus: []` → `null` → `detailStatus:"failed"`.
  - `fetchDetail` with mocked `aaCall` returning `{ok:false,class:"blocked"}` → `detailStatus:"failed"`, `finalPrice === listPrice`.
  - Shipping `null` → `finalPrice = option price` and `shipping:null`. The UI shows "shipping unknown".
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3:** Implement. Call `aaCall("aliexpress","product",{id},{ttlMs:3_600_000,lane:"detail"})`.
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat: aliexpress product detail and main option`.

---

### Task 7: Ranking, pipeline, API routes

**Files:**
- Create: `src/lib/rank.ts`, `src/lib/pipeline.ts`, `app/api/search/route.ts`, `app/api/details/route.ts`
- Test: `tests/lib/rank.test.ts`, `tests/lib/pipeline.test.ts`

**Interfaces:**
- Produces: `type SortKey = "price" | "discount" | "deal"`
- Produces: `dealScore(p: Product, minPrice: number, maxPrice: number): number`
  `= 0.4*(1 - (price-min)/(max-min || 1)) + 0.3*(discountPct ?? 0)/100 + 0.2*(rating ?? 0)/5 + 0.1*min(1, log10(soldCount+1)/5)`, where `price = finalPrice ?? listPrice`.
- Produces: `rank(products: Product[], sort: SortKey): Product[]`. `price` sorts ascending by `finalPrice ?? listPrice`, `discount` descending by `discountPct`, `deal` descending by `dealScore`. Stable.
- Produces: `runSearch(input: { query: string; sites: string[]; sort: SortKey; minPrice?: number; maxPrice?: number; minRating?: number }): Promise<{ products: Product[]; statuses: SiteStatus[]; queryTokens: string[][]; reason?: string }>`
  Order of operations: parse, merge explicit filters (they override inline ones), expand variants, run calls per site via `aaCall` (lane search, ttl 600000), normalize, apply `exclude`, relevance filter, accessory filter, price/rating filter on `listPrice`, dedupe, rank. Return all products, all with `detailStatus:"pending"`.
- `POST /api/search` body is `runSearch` input. It returns 400 `{error:"Enter something to search for"}` when parsed `terms` is empty.
- `POST /api/details` body `{ products: Product[]; queryTokens: string[][] }` (max 20) → `{ products: Product[] }` with details filled. The route caps at 20 entries.

- [ ] **Step 1: Write failing tests** (mock `aaCall` with fixture data)
  - `rank` by price uses `finalPrice` when present and `listPrice` otherwise.
  - `dealScore` is between 0 and 1. A cheaper, higher-discount item scores higher than a pricier one with the same rating and sales.
  - `runSearch` with `"anc earbuds under 50"` → every product has `listPrice ≤ 50` and none is an accessory. `statuses` is `[{site:"aliexpress",status:"ok"}]`.
  - Every search call `blocked` → `products:[]`, `statuses[0].status:"blocked"`, no throw.
  - Some calls blocked and some ok → products from the ok calls. Status `ok` with `message` naming the failed count.
  - Everything filtered → `products:[]`, `reason:"No products matched your search and filters"`.
  - Route: `"under 50"` alone → 400 with the exact error string.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat: ranking, search pipeline, api routes`.

---

### Task 8: UI

**Files:**
- Create: `app/page.tsx` (client), `app/components/SearchForm.tsx`, `ResultCard.tsx`, `StatusBar.tsx`

**Interfaces:**
- Consumes: `/api/search`, `/api/details`, `Product`, `SiteStatus`, `SortKey`

Behavior:
- The form has a query box, site checkboxes (AliExpress checked; list from a static array mirroring `registry` ids), a sort select (Lowest price / Highest discount / Best deal), and min price, max price and min rating number inputs.
- On submit: POST `/api/search` and render the cards. There is no details step (Task 6 was removed). Searches can take up to about 10 s while noon runs, so show a per-site loading state.
- Each card shows: image, title (2-line clamp), **price SAR** (AliExpress labelled "from"), "shipping not included", struck original price, discount badge, rating, sold count, a site badge, and a link opening `url` in a new tab.
- The status bar shows each site's status. `blocked` gets an amber message: "AliExpress blocked the request; try again later".
- Empty state shows `reason`. A 400 shows its `error`.

- **Design (owner, 2026-11-27): use the Hallmark skill** (`.claude/skills/hallmark`, Nutlope/hallmark v2). Invoke it for the page design: the job is a search tool, and the primary action is the query box. Follow its Floor rules (CSS tokens at `:root`, `:focus-visible`, reduced-motion, no eyebrows/tracked caps, no invented metrics, `overflow-x: clip`). Pick one theme with `scripts/theme.mjs deal`, or go `custom`. Translate the result into the Next.js components. Tailwind may be replaced by the CSS that Hallmark produces. **Never run `scripts/imagegen.mjs`**: it calls the Together AI image API, which breaks the no-AI-calls constraint. Product images come from the stores, and no stock photos are needed.
- [ ] **Step 1:** Implement the components using the Hallmark design.
- [ ] **Step 1b:** Run `node .claude/skills/hallmark/scripts/sloplint.mjs <built page or route HTML> --render` against the running dev server's page. Fix every `FAIL`, and fix or waive every `REFLEX`.
- [ ] **Step 2: Verify** with `npm run build` → no type errors. Run `npm run dev`, search `anc earbuds under 100` → cards render, prices fill in, and changing the sort re-orders the cards.
- [ ] **Step 3: Commit** `feat: search UI`.

---

### Task 9: End-to-end check + README

**Files:**
- Create: `README.md`

- [ ] **Step 1:** Run `npm test` → all pass. Run `npm run build` → success.
- [ ] **Step 2: Live check** with `npm run dev`, using the queries `anc earbuds under 100`, `usb-c cable 100w`, `mechanical keyboard >4.5 stars -wired`. For each, check the following and record in README "Verified" with the date:
  - results show
  - no accessories in the top 10
  - prices are SAR with English titles
  - ≥ 15 of the top 20 have `detailStatus:"ok"`
  - a repeat search returns instantly from cache
- [ ] **Step 3: README.** Cover setup (`npm i`, `npm run dev`), how to edit `data/synonyms.json` and `data/accessory-words.json`, and how to add a site (learn the op → put the spec in `api-specs/` → write the adapter → register it in `registry.ts`).
- [ ] **Step 4: Commit** `docs: readme and e2e verification`.

---

## Scope extension: amazon.sa, noon KSA, jarir.com

Spec section "Scope extension". Site ids are `amazon-sa`, `noon-sa`, `jarir` and `trendyol-sa` (added 2026-11-27, spike Task 10d). On these sites `finalPrice = listPrice`, `detailStatus:"ok"`, `shipping:null`, and cards say "shipping not included". These tasks run after Task 9. Their spikes (Tasks 10a–c) run early and in parallel. They're research only: each uses its own API Anything home `.aa-home-spike-<id>/` (gitignored) and writes only its own files. The controller commits them.

### Task 10a/10b/10c: Spike — `<id>.search` op (one per site, STOP-GATE per site)

**Files:**
- Create: `api-specs/<id>.json`, `tests/fixtures/<id>-search.json`, `docs/superpowers/spikes/2026-11-27-<id>.md`

**Interfaces:**
- Produces: op `<id>.search` with params `q` and `page`, plus an optional sort param if the site has one. Item fields picked: `id,title,price,currency,origPrice,discount,rating,reviews,image,url`, with as many as the site exposes. `url` must be an absolute product URL or buildable from `id` (document how).

- [ ] **Step 1:** Find the site's English/SAR search URL: amazon.sa `https://www.amazon.sa/s?k={q}&page={page}&language=en_AE`, noon `https://www.noon.com/saudi-en/search/?q={q}&page={page}`, jarir `https://www.jarir.com/sa-en/catalogsearch/result?search={q}` (verify each). Capture it, find the data (embedded JSON, an xhr/fetch JSON API, or server-rendered HTML for an `--html` recipe), and learn the op with two examples. For Amazon, check the bundled `amazon` op first (`npx api-anything ops amazon`).
- [ ] **Step 2: Verify** 4 different queries → `ok`, tier ≤ 2, ≥ 10 items each, English titles, SAR prices, and `page=2` returns different items.
- [ ] **Step 3: STOP-GATE per site.** If Step 2 fails (blocked, tier 3 only, no prices), write findings in the spike notes and report BLOCKED for that site only.
- [ ] **Step 4:** Save one raw `call()` result to the fixture, copy the spec to `api-specs/<id>.json`, and write spike notes: recipe, field mapping, tiers, timings, whether the site shows bait-style option pricing, and the discount/original-price fields.

### Task 11: Adapters for spiked sites

**Files:**
- Create: `src/sites/<id>/search.ts` per site that passed its spike. Modify: `src/sites/registry.ts`, the UI site list.
- Test: `tests/sites/<id>-search.test.ts` per site.

**Interfaces:**
- Consumes: `SiteAdapter`, `Product`, `slugify` pattern (Task 4), the fixtures (Task 10).
- Produces: `searchCalls(pq, variants)`, with pages 1–2 per term and a price-ascending page if the site has one. Also `normalizeSearchItem(raw): Product | null` (SAR, `detailStatus:"ok"`, `finalPrice = listPrice`, `shipping:null`, `discountPct` computed from `origPrice` when the site omits it), and `fetchDetail = async p => p`.

- [ ] **Step 1: Write failing tests per site.** Every fixture item normalizes to a Product or `null` with no `NaN`. ≥ 10 are non-null. URLs are absolute `https://`. `searchCalls` count matches the per-term rule. The query encoding test uses `"usb-c cable 100w"` and `"a/b & c"`: only safe characters reach `q`.
- [ ] **Step 2: Run** → FAIL. **Step 3:** Implement. **Step 4: Run** → PASS. Then search `usb-c cable` across all sites and check the mixed results rank correctly by price.
- [ ] **Step 5: Commit** `feat: amazon-sa, noon-sa, jarir adapters`.

---

### Task 9b: Traffic & blocking hardening

See `docs/superpowers/plans/briefs/task-9b-brief.md`. It was inserted after the Task 9 live check found AliExpress drift/heal traffic, noon blocks, a 9-calls-per-store fan-out and rating-less Jarir. It runs before Task 12.

### Task 12: Quality tuning loop (owner, 2026-11-27: "keep trying and optimizing based on results till reaching the best results")

Runs after Tasks 7, 11, 8 and 9, once all stores work end to end.

**Files:**
- Create: `eval/queries.json`, `eval/recorded/<store>/<query-slug>.json`, `eval/labels/<query-slug>.json`, `scripts/eval-record.mjs`, `scripts/eval.mjs`, `eval/RESULTS.md`

- [ ] **Step 1: Query set.** Write `eval/queries.json` with 15 realistic KSA shopping queries spanning categories and filter syntax. Examples: `anc earbuds under 300`, `iphone 16`, `usb-c cable 100w`, `air fryer`, `apple watch`, `power bank 20000mah`, `mechanical keyboard -wired`, `gaming mouse`, `samsung galaxy s24`, `laptop backpack`, `4k monitor 27`, `ps5 controller`, `robot vacuum`, `smart watch >4 stars`, `hair dryer`.
- [ ] **Step 2: Record once, replay offline.** `scripts/eval-record.mjs` runs each query's raw store calls once and saves the raw results under `eval/recorded/`, so tuning never re-hits the stores. Budget: about 2 calls per store per query, sequential, with a 3–5 s pause between noon loads. Re-record only if the stores change.
- [ ] **Step 3: Labels.** For each query, label every recorded product `relevant`, `accessory`, `wrong-model` or `off-topic`, saved to `eval/labels/<slug>.json`. Labelling is development-time review (a reviewer agent proposes labels, and the owner may correct them). The app itself never calls an LLM.
- [ ] **Step 4: Metrics.** `scripts/eval.mjs` replays the recorded data through the real pipeline (normalize → filters → rank) and reports per query and overall:
  - precision@10 (relevant among the top 10)
  - accessory@10 and wrong-model@10
  - recall (relevant items kept / relevant items recorded)
  - whether the cheapest relevant item ranks #1 under the "price" sort
- [ ] **Step 5: Iterate.** Tune `data/synonyms.json`, `data/accessory-words.json`, the relevance threshold, `PRICE_RATIO`, `GAP_RATIO`, the dedupe variant words and the deal-score weights, plus the deferred minors in the SDD ledger where they move the metrics. After each change: run `npm test` (must stay green) and `node scripts/eval.mjs`, then log the round's change and metrics in `eval/RESULTS.md`. Never tune by special-casing a single query string.
- [ ] **Step 6: Stop rule.** Stop when overall precision@10 ≥ 0.9, accessory@10 = 0, wrong-model@10 ≤ 0.05, recall ≥ 0.8 and cheapest-relevant-first ≥ 0.9. Also stop if two consecutive rounds show no improvement. Report the final metrics and any queries still below target.
- [ ] **Step 7: Commit** each kept round (`tune: <what changed> (p@10 x→y)`).
