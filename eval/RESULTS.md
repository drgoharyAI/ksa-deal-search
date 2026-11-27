# Eval results

Run `node scripts/eval.mjs` (replays `eval/recorded/`, no network). Each tuning round appends its
change and metrics below.

## Metric definitions

Per query, from the replayed pipeline output under sort `"price"`, scored against
`eval/labels/<slug>.json` (`{ "query": "...", "labels": { "<site>:<id>": "relevant" | "accessory" | "wrong-model" | "off-topic" } }`).

- **Eligible** (shared rule, `src/lib/filters.ts`, the same predicates the pipeline uses): valid
  price (listPrice finite and > 0), title does not contain a `-word` (case-insensitive), price
  bounds on listPrice, and with a rating minimum a null rating counts only when that store is
  ratingless in the query's recorded data (e.g. Jarir).
- **precision@10, accessory@10, wrong-model@10**: share of the *filled* top window,
  `min(10, results)` items, labelled relevant / accessory / wrong-model. A query with 3 results
  is scored over 3 items; 0 results scores 0. Unlabelled top items are reported separately
  (`unlabelled@10`). The printout shows `results N (top M)` per query.
- **recall**: relevant items that survive every filter (before dedupe, so a duplicate merged
  into a cheaper copy is not a loss) / relevant recorded items that are *eligible*. Items the
  query's own filters correctly remove (e.g. an 899 SAR earbud for "under 300") are not in the
  denominator.
- **cheapest-relevant-first**: end to end. True when result #1 under sort "price" is labelled
  relevant AND its price is <= the cheapest eligible relevant item among ALL recorded items.
  So a cheap relevant item lost by the relevance/accessory filters also fails it. n/a when the
  query has no eligible relevant item.
- **overall**: macro mean over labelled queries; n/a values are skipped.

Stop rule (Task 12 Step 6): precision@10 >= 0.9, accessory@10 = 0, wrong-model@10 <= 0.05,
recall >= 0.8, cheapest-relevant-first >= 0.9.

## Rounds

(none yet: labels pending, Task 12 Step 3)

## Round 0: baseline (2026-11-27)
Labels: 15/15 queries, ~7,500 products. Sorted by price.
| p@10 | acc@10 | wrong@10 | recall | cheapest-first |
|---|---|---|---|---|
| 41% | 39% | 4% | 92% | 33% |
Worst: samsung galaxy s24 (p@10 0%, accessories 100%), ps5 controller (accessories 90%), mechanical keyboard (p@10 10%), robot vacuum (accessories 80%).

## Round 1: every query token required (kept)
Relevance now requires every query token in the title (all but one non-head token from 4 tokens),
with a light stemmer (gaming/game, cancelling/cancellation) and matching-only alias phrases
(`data/match-aliases.json` + the synonym groups: anc/noise cancelling, ps5/playstation 5/dualsense,
laptop/notebook/computer, controller/gamepad). Drops brand-less and qualifier-less items
(generic "smart watch" for "apple watch", FHD monitors for "4k monitor").
| p@10 | acc@10 | wrong@10 | recall | cheapest-first |
|---|---|---|---|---|
| 51% | 40% | 4% | 88% | 47% |

## Round 2: spec and model-number matching (kept)
Query tokens with digits are matched on the raw title (`src/lib/match/spec.ts`): a bare number must
follow its query word ("iPhone 16", "iphone16"; not "iPhone 6 16GB") or be a screen size ("27-inch",
27"); number+unit tokens accept spacing and thousands separators ("20,000 mAh"); a model number
followed by another digit or by a budget-model suffix (e / fe / lite) is a different model
("16e", "S24 FE"). Relevance for queries under 4 tokens is decided by the all-tokens rule alone.
| p@10 | acc@10 | wrong@10 | recall | cheapest-first |
|---|---|---|---|---|
| 57% | 36% | 2% | 91% | 47% |

## Round 3: "made for the product" accessories (kept)
A title whose query product noun (last digit-free query token, aliases allowed) appears only after
"for"/"compatible"/"fit(s)" is an item made for that product ("Tempered glass for iPhone 16",
"Compatible with Galaxy S24 Ultra Case", "Thumb grips for PS5 controller") and is dropped whatever
its price. "suitable/ideal/perfect/great/good/best for" is a use phrase and ignored; a title that
opens with "For" (a seller habit) also needs an accessory word.
| p@10 | acc@10 | wrong@10 | recall | cheapest-first |
|---|---|---|---|---|
| 71% | 19% | 4% | 90% | 47% |

## Round 4: no typo match on the first letter (kept)
Edit-distance-1 matching now requires the same first letter, so "iphone" no longer matches
"phone" (which let "Mobile Phone ... Dust Plug for iPhone 16" past the "made for" rule).
| p@10 | acc@10 | wrong@10 | recall | cheapest-first |
|---|---|---|---|---|
| 71% | 19% | 4% | 90% | 53% |
