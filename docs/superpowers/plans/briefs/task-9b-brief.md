# Task 9b: Traffic & blocking hardening (inserted before Task 12)

Live check (Task 9, report: .superpowers/sdd/2026-11-27-deal-search/task-9-report.md) found:
- AliExpress began answering an anti-bot page after the first search. api-anything classified it "drift", tried to self-heal (extra requests), and marked the op stale (persisted in .aa-home). The app showed "error", not "blocked".
- noon was blocked (Akamai 403 / Access Denied) on every search in the app, though the spike and the 11b smoke check worked.
- Each search fans out to many calls: per store up to (1 + 2 variants) × 3 pages = 9 calls.
- Amazon had one transient ECONNRESET.
- Jarir has no ratings, so any minRating filter removes all Jarir products.

**Goals:** fewer requests per search, no automatic heal/relearn traffic at runtime, per-store back-off after a block, honest "blocked" status, and noon working again if the cause is ours.

**Files:** src/lib/aa.ts, src/lib/pipeline.ts, src/sites/*/search.ts (searchCalls only), src/sites/noon-sa/*, tests as needed.

- [ ] **Step 1: Call budget.** Per store per search: main term page 1 + main term price-ascending page 1 (where the store supports it), plus the first synonym variant page 1 only. Amazon (no sort): main p1 + p2 + variant p1. noon: unchanged (main term, ≤2 loads). Cap: ≤3 calls per store per search. Update each adapter's searchCalls and their tests.
- [ ] **Step 2: No runtime heal.** Find api-anything's call option(s) to disable heal/recapture/browser escalation at runtime (docs/REFERENCE.md: "Replay, fallback and repair", tiers, `--max-tier`, call options in src of the installed package node_modules/api-anything). Use `maxTier: 1` for AliExpress/Amazon/Jarir/Trendyol (all learned at tier 1) and disable heal if an option exists. If heal cannot be disabled, document it and rely on Step 3's back-off. Add tests that aaCall passes these options.
- [ ] **Step 3: Per-store back-off.** In the pipeline (or aaCall), after a store returns blocked, rate, or drift (drift at runtime usually means an anti-bot page), skip that store for 10 minutes. Return status "blocked" with message "Store blocked the request; try again later". Keep state on globalThis so it survives dev HMR. Add tests with fake timers.
- [ ] **Step 4: Status mapping.** Treat class "drift" from api-anything stores as "blocked" for the UI (generic message). noon's own Drift ("no product cards") stays "error".
- [ ] **Step 5: Ratings.** When minRating is set, products whose store never provides ratings (Jarir, i.e. rating === null for the whole store result) are kept and flagged rather than dropped. Mark via a new optional Product field `ratingUnavailable?: true`, and have the UI card show "No rating" (one-line change in ResultCard). Keep the existing behaviour for stores that do provide ratings but where the item has none (drop when minRating is set).
- [ ] **Step 6: noon diagnosis (≤3 noon page loads total).** Compare the app's noon path with scripts/noon-search.prototype.mjs (warm-up, flags, timing, profile state). Check whether `.noon-profile` holds a flagged session (cookies `_abck`/`bm_sz` from a blocked state). Try once with a fresh profile dir. Report the cause. Fix it only if the cause is in our code or config (e.g. a missing warm-up wait, the wrong window flags, or a reused blocked profile → rotate the profile automatically after a block). Don't add stealth or fingerprint spoofing.
- [ ] **Step 7:** `npm test`, `npx tsc --noEmit` and `npm run build` all green. Commit `fix: request budget, no runtime heal, per-store back-off, rating-less stores`.
- Don't hit AliExpress live in this task unless needed to verify Step 2 (≤2 calls). It may be stale or blocked right now; `api-anything status aliexpress` with the app's env shows the state. Clearing a stale mark is acceptable if the op itself is unchanged.
