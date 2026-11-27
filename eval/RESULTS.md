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

## Round 5: accessory vocabulary + part nouns after the product noun (kept)
`data/accessory-words.json` gains part/consumable words (pad, mat, liner, paper, tray, keycap,
switches, puller, grip, dock, station, filter, nozzle, diffuser, comb, bonnet, glass, lens, tool,
parts, accessories, ...). New strong rule: a part noun from `data/part-words.json` within two tokens
after the query's product noun ("Gaming Mouse Pad", "Hair Dryer Folding Diffuser") is an accessory
whatever its price; category words (bag, charger, cable, case) are not part nouns, so "Backpack
Laptop Bag" and "Power Bank Charger" stay. (A piece-count rule, "30PCS ...", was tried in this
round and removed: it only cost recall on multi-pack cables.)
| p@10 | acc@10 | wrong@10 | recall | cheapest-first |
|---|---|---|---|---|
| 85% | 3% | 4% | 90% | 60% |

## Round 6: "+" splits the title core only between spaces (kept)
The accessory check reads the title before "with / includes / + / &"; a "+" glued to a model
("Galaxy S24+ Case") no longer hides the accessory word behind it.
| p@10 | acc@10 | wrong@10 | recall | cheapest-first |
|---|---|---|---|---|
| 85% (84.7→85.3) | 3% | 4% | 90% | 60% |

## Round 7: different-category items sharing the query words (kept)
`src/lib/match/category.ts` + `data/other-product-words.json`: books about the product
("... for Dummies", "Recipe Book", "75 Recipes", paperback/hardcover) and macro keypads
("keypad", "macropad", a "keyboard" with under ten keys) are dropped. Checked on the title core
(before "with"), so "Air Fryer with ... Recipe Book" stays.
| p@10 | acc@10 | wrong@10 | recall | cheapest-first |
|---|---|---|---|---|
| 91% | 3% | 4.7% | 90% | 67% |

## Round 8: title-core fixes, legs/feet parts (kept)
"built-in" now starts the add-on part of a title ("Power Bank built-in 4 cables"), the title core
falls back to the whole title when it names no query word ("Ps5 Cooling & Dual Controller Charging
Station"), and legs/feet join the part words ("Air Fryer Silicone Rubber Legs").
| p@10 | acc@10 | wrong@10 | recall | cheapest-first |
|---|---|---|---|---|
| 91% (90.7→91.3) | 2% | 4.7% | 90% | 73% |

## Round 9: price sanity for brand queries (kept)
`src/lib/match/price.ts` + `data/brands.json`: when the query names a known brand, items priced
below 0.25 x the median of the matching items (5+ items) are dropped: clones that claim the brand
("Apple Watch Series 10 Smart Watch" at 70 SAR) and parts that slipped past the word rules.
Unbranded queries are untouched (marketplace robot vacuums or smart watches legitimately start at
a few riyals).
| p@10 | acc@10 | wrong@10 | recall | cheapest-first |
|---|---|---|---|---|
| 96% | 2% | 1.3% | 90% | 80% |

## Round 10: part nouns stand alone; core needs a product word (kept)
The "part noun right after the product noun" rule no longer needs the word in the accessory list,
so "switch" can be a part noun ("Mechanical keyboard Switch Gateron") without making every
"PS5 / Switch" controller a price-tested candidate. The title-core fallback now asks for a
digit-free query word, so "Ps5 Cooling & Dual Controller Charging Station" is read in full.
| p@10 | acc@10 | wrong@10 | recall | cheapest-first |
|---|---|---|---|---|
| 97% (96.0→96.7) | 0.7% | 2.0% | 90% | 80% |

## Round 11: piece-count listings of part nouns (kept)
A title with a piece count ("30PCS", "2 pcs", "pack of 10") and a part noun the query does not
name is an accessory ("Dustproof 30PCS Outemu Switch Mechanical Keyboard"). Multi-packs of the
product itself ("3PCS 100W USB-C Cable") are unaffected because cable is not a part noun.
| p@10 | acc@10 | wrong@10 | recall | cheapest-first |
|---|---|---|---|---|
| 97% (96.7→97.3) | 0% | 2.0% | 90% | 80% |

## Round 12: screen-size lists (kept)
A bare size number also matches inside a size list ending in a unit ("24/27/32 Inch",
"24 27 32 34 Inch"), a common marketplace listing for one product in several sizes.
| p@10 | acc@10 | wrong@10 | recall | cheapest-first |
|---|---|---|---|---|
| 97% | 0% | 2.0% | 90% (89.8→90.2) | 80% |

## Round 13: "noise reduction" is not ANC (kept)
Removed "noise reduction" from the anc match aliases: on its own it almost always means call
noise reduction (ENC), labelled wrong-model 34 times and never relevant without other ANC wording.
| p@10 | acc@10 | wrong@10 | recall | cheapest-first |
|---|---|---|---|---|
| 98% (97.3→98.0) | 0% | 1.3% | 90% | 80% |

## Round 14: PRICE_RATIO 0.4 -> 0.3 (kept)
With the structural accessory rules doing most of the work, the price test for accessory-word
candidates can be gentler: a candidate is dropped below 0.3 x the median main-product price.
Recovers cheap real products whose titles mention a part (0.5 was also tried: recall 88%).
| p@10 | acc@10 | wrong@10 | recall | cheapest-first |
|---|---|---|---|---|
| 98% | 0% | 1.3% | 91% (90.2→90.9) | 80% |

## Round 15: BRAND_PRICE_RATIO 0.25 -> 0.15 (reverted)
No metric moved (p@10 98%, recall 91%, cheapest-first 80%).

## Round 16: GAP_RATIO 4 -> 3 (reverted)
No metric moved. Two consecutive rounds without improvement: stop (Task 12 Step 6).

## Final (after round 14)
| p@10 | acc@10 | wrong@10 | recall | cheapest-first |
|---|---|---|---|---|
| 98% | 0% | 1.3% | 91% | 80% |
Every target is met except cheapest-relevant-first (80% vs 90%). The three misses (air fryer,
samsung galaxy s24, ps5 controller) are queries whose cheapest item labelled "relevant" is an
accessory (paper liners, a Galaxy S26 screen protector, a PS5 controller silicone cover); see the
Task 12c report for the suspected label errors.
