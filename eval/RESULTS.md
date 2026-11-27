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

## Label corrections (controller, 2026-11-27)
The tuning agent flagged 9 labels as wrong; all were confirmed under the rubric. Liners, a mould, skins, grips and a stand were relabelled accessory, and a recipe book off-topic. Overall after the correction: p@10 98%, acc@10 0%, wrong@10 1%, recall 91%, cheapest-first 100%. Every stop-rule target is met on the tuning set. The one remaining weak query is mechanical keyboard (p@10 70%: membrane keyboard + mouse combos).

## Holdout check (8 unseen queries, rules unchanged)
| set | p@10 | acc@10 | wrong@10 | recall | cheapest-first |
|---|---|---|---|---|---|
| tuning (15) | 98% | 0% | 1% | 91% | 100% |
| holdout (8) | 76% | 13% | 10% | 76% | 50% |
The rules overfit the tuning set. Worst holdout queries: ipad air (wrong@10 80%), coffee machine (acc@10 40%, recall 61%), wireless charger 15w (recall 39%), running shoes (recall 71%).

# Task 12d: generalization rounds (dev set = 15 tuning + 8 holdout queries)

Baseline (12c final, labels corrected):
| set | p@10 | acc@10 | wrong@10 | recall | cheapest-first |
|---|---|---|---|---|---|
| tuning (15) | 98.0% | 0% | 1.3% | 91.2% | 100% |
| holdout (8) | 76.3% | 12.5% | 10.0% | 75.9% | 50% |
| all (23) | 90.4% | 4.3% | 4.3% | 85.9% | 82.6% |

## 12d round 1: accessory-category queries; "replacement" by position (kept)
When the query's product noun is itself an accessory word ("wireless charger", "usb-c cable"),
accessory vocabulary describes the item ("Charger Stand", "Charging Pad/Dock/Station", "Phone
Holder Wireless Charger"), so only the "made for" structure ("Case for Wireless Charger") drops an
item. "replacement" is strong only before the product noun ("Electric Toothbrush ... 4 Replacement
Heads" is the toothbrush with spares). A leading "For" needs an accessory word the query does not
name ("For MagSafe Charger ..." for a charger query).
| set | p@10 | acc@10 | wrong@10 | recall | cheapest-first |
|---|---|---|---|---|---|
| tuning (15) | 98.0% | 0% | 1.3% | 91.5% | 100% |
| holdout (8) | 76.3% | 12.5% | 10.0% | 82.6% | 62.5% |
| all (23) | 90.4% | 4.3% | 4.3% | 88.4% | 87.0% |

## 12d round 2: trademark product lines count as brands (kept)
Root cause of ipad air (wrong@10 80%): not the "air" qualifier. The top 10 were Android tablets
titled "iPad Air Pro 11 inch ... Android 16" at ~300 SAR. They contain both query words, and the
brand price check did not fire because "ipad" was not in `data/brands.json`. A trademark product
line names its brand as surely as the maker's name does, so `iphone, ipad, macbook, imac, airpods,
thinkpad, kindle, dualsense` join the list (like the existing pixel / playstation / xbox).
| set | p@10 | acc@10 | wrong@10 | recall | cheapest-first |
|---|---|---|---|---|---|
| tuning (15) | 98.0% | 0% | 1.3% | 91.5% | 100% |
| holdout (8) | 88.8% | 10.0% | 0% | 82.6% | 75.0% |
| all (23) | 94.8% | 3.5% | 0.9% | 88.4% | 91.3% |

## 12d round 3: fastening and consumable part nouns (kept)
The part-noun rule (a part noun within two tokens after the product noun) only knew device parts.
Added generic fastening and consumable parts that sellers name right after the product they serve:
descaler, descaling, towel, rag, cloth, adhesive, clip(s), buckle(s), lock(s), laces, insole(s)
("Shoe Locks", "Shoe Clip", "Coffee Machine Descaler", "Dash Cam Special Adhesive"). Tried and
removed in the same round: "cleaning" ("5 Cleaning Modes"), "head(s)" ("2 Toothbrush Heads"
included in a kit) and "tape" ("Mouse-Black Ink+Tape"): each cost recall.
| set | p@10 | acc@10 | wrong@10 | recall | cheapest-first |
|---|---|---|---|---|---|
| tuning (15) | 98.0% | 0% | 1.3% | 91.5% | 100% |
| holdout (8) | 95.0% | 3.8% | 0% | 82.5% | 75.0% |
| all (23) | 97.0% | 1.3% | 0.9% | 88.4% | 91.3% |

## 12d round 4: compound words open or closed (kept)
The all-words rule (12c round 1) missed compounds written closed or open: "Dashcam" for "dash
cam", "Airfryer" for "air fryer", "Tooth Brush" for "toothbrush". Two adjacent digit-free query
words now also match their joined form in a title token, and a query word of 6+ letters matches two
adjacent title tokens joined. Softens round 1; no new vocabulary.
| set | p@10 | acc@10 | wrong@10 | recall | cheapest-first |
|---|---|---|---|---|---|
| tuning (15) | 98.0% | 0% | 1.3% | 92.1% | 100% |
| holdout (8) | 95.0% | 3.8% | 0% | 83.3% | 75.0% |
| all (23) | 97.0% | 1.3% | 0.9% | 89.0% | 91.3% |

## 12d round 5: standard name equivalents; ISBN product codes are books (kept)
Matching-only alias groups (`data/match-aliases.json`, never sent to stores) for standard
equivalents the all-words rule rejected: cam = camera, ssd = solid state drive, external =
portable (a portable SSD is an external SSD), shoes = sneakers = trainers. Because "camera" also
admits "Dash Cameras Explained", a product whose code is a valid ISBN-13 (978/979 prefix + check
digit) is dropped as a book unless the query says "book"; all 104 such recorded items are labelled
off-topic. Tried and removed in the same round: machine = maker (coffee machine recall 61% to 83%,
but it also admits "Coffee Art Stencil Maker", p@10 70% to 60%).
| set | p@10 | acc@10 | wrong@10 | recall | cheapest-first |
|---|---|---|---|---|---|
| tuning (15) | 98.0% | 0% | 1.3% | 92.1% | 100% |
| holdout (8) | 95.0% | 3.8% | 0% | 86.3% | 75.0% |
| all (23) | 97.0% | 1.3% | 0.9% | 90.1% | 91.3% |

## 12d round 6: "accessories" after the product noun is a shop label (kept)
"accessory/accessories" more than two tokens after the product noun is the seller's category
label ("Dashcam ... Night Vision Vehicle Accessories", "Car accessory"), not what the item is, so
it no longer makes the item a price-tested accessory candidate. Right after the product noun
("Dash Cam Accessories Kit") or before it, it still counts. Recovers the cheapest dash cam.
| set | p@10 | acc@10 | wrong@10 | recall | cheapest-first |
|---|---|---|---|---|---|
| tuning (15) | 98.0% | 0% | 1.3% | 92.1% | 100% |
| holdout (8) | 95.0% | 3.8% | 0% | 86.5% | 87.5% |
| all (23) | 97.0% | 1.3% | 0.9% | 90.2% | 95.7% |

## 12d rounds 7-10 (all reverted: no combined improvement)
- 7: an item whose product noun appears only after "with / includes / built-in" is another
  product ("Karaoke Microphone with Built-in Speaker"). First try: no metric moved (those items sat
  below the top 10). Second try with "includes": recall fell on bundles ("Power Kit, Includes
  20000mAh Power Bank", anc 85%→83%, charger 90%→88%).
- 8: "handle" as a part noun and "diy" as an accessory word: holdout acc@10 3.8%→1.3%, but
  "Dualsense Controller Ps5 Handle" (handle = gamepad), "Easy-Grip Handle" coffee makers and
  "DIY Dial" smart watches were lost (ps5 93.6%→92.7%, smart watch 91.1%→90.0%).
- 9: "brush" as an accessory word: hair dryer lost cheapest-first, toothbrush recall 88%→85%.
- 10: removing the 12c "switch" part noun: keyboard p@10 70%→60%.
Also tried inside kept rounds and removed: accessory words more than two tokens after the
product noun are never candidates (air fryer p@10 100%→70%); machine = maker (round 5).
Ablation only (not a round): without the 12c piece-count rule, keyboard p@10 70%→60%, nothing
else moves, so it stays. Four rounds in a row without a combined gain: stop.

## 12d final (after round 6)
| set | p@10 | acc@10 | wrong@10 | recall | cheapest-first |
|---|---|---|---|---|---|
| tuning (15) | 98.0% | 0% | 1.3% | 92.1% | 100% |
| holdout (8) | 95.0% | 3.8% | 0% | 86.5% | 87.5% |
| all (23) | 97.0% | 1.3% | 0.9% | 90.2% | 95.7% |
Every target is met on both sets except holdout acc@10 (3.8% vs <= 2%): coffee machine has a
coffee brush kit and a portafilter handle in its top 10, bluetooth speaker a pair of DIY speaker
drivers. None carries a word that separates it from the product without costing recall elsewhere.

## Holdout 2 (6 unseen queries, after 12d, rules unchanged)
| p@10 | acc@10 | wrong@10 | recall | cheapest-first |
|---|---|---|---|---|
| 70% | 20% | 0% | 89% | 50% |
Failures: nintendo switch 2 (acc@10 100%: games, cases and controllers titled with the console name), baby stroller (p@10 50%, recall 72%), air purifier (p@10 80%). Good: electric kettle, gaming chair, macbook air m3. Takeaway: word lists don't transfer to new categories; structural signals are needed.

# Task 12e: structural signals (dev set = all 29 queries: 15 tuning + 8 holdout + 6 holdout2)

Targets per set: p@10 >= 90%, acc@10 <= 3%, wrong@10 <= 5%, recall >= 80%, cheapest-first >= 85%.

Baseline (12d final):
| set | p@10 | acc@10 | wrong@10 | recall | cheapest-first |
|---|---|---|---|---|---|
| tuning (15) | 98.0% | 0% | 1.3% | 92.1% | 100% |
| holdout (8) | 95.0% | 3.8% | 0% | 86.5% | 87.5% |
| holdout2 (6) | 70.0% | 20.0% | 0% | 89.3% | 50.0% |
| all (29) | 91.4% | 5.2% | 0.7% | 90.0% | 86.2% |

## 12e round 1: single-digit model numbers; brand price tiers (kept)
Two root causes in nintendo switch 2. (a) The query tokenizer dropped 1-character tokens, so the
"2" was never required and Switch 1 / OLED / Lite consoles matched; query tokens now keep digits.
(b) The 12c brand price check compares against the median, but for a platform query the
ecosystem (games, controllers, adapters titled "... Nintendo Switch 2") outnumbers the product,
so the median is an accessory price. New price-structure test (`price.ts` `tierCutoff`): the best
two-group split of log prices; when the upper group's geometric mean is 4x the lower one's and it
is a real market (3+ items, 2+ stores), the lower group is dropped. No vocabulary; brand queries
only (unbranded categories legitimately span 5 to 5,000 SAR). On every other brand query the two
tiers are under 2x apart (model lines: 128GB vs Pro Max), so nothing changes there.
| set | p@10 | acc@10 | wrong@10 | recall | cheapest-first |
|---|---|---|---|---|---|
| tuning (15) | 98.0% | 0% | 1.3% | 92.1% | 100% |
| holdout (8) | 95.0% | 3.8% | 0% | 86.5% | 87.5% |
| holdout2 (6) | 83.3% | 6.7% | 0% | 89.3% | 50.0% |
| all (29) | 94.1% | 2.4% | 0.7% | 90.0% | 86.2% |

## 12e round 2: weak-match tier; product noun only after "with" (kept)
New mechanism: `Product.weakMatch` items are ranked after the rest under every sort (`rank.ts`),
not dropped, so weaker structural evidence costs no recall. First signal (`structure.ts`
`productOnlyAfterWith`): the query's product noun (aliases and open/closed compounds allowed)
appears only after "with / built-in", so the item is something else that comes with or shows the
product ("Gaming Designed Coasters Set of 10, with Pictures of ... Chair", "Karaoke Microphone
with Built-in Speaker"). As a hard filter in 12d round 7 it cost recall on bundles; as a demotion
it costs none.
| set | p@10 | acc@10 | wrong@10 | recall | cheapest-first |
|---|---|---|---|---|---|
| tuning (15) | 98.0% | 0% | 1.3% | 92.1% | 100% |
| holdout (8) | 95.0% | 3.8% | 0% | 86.5% | 87.5% |
| holdout2 (6) | 85.0% | 6.7% | 0% | 89.3% | 66.7% |
| all (29) | 94.5% | 2.4% | 0.7% | 90.0% | 89.7% |

## 12e round 3: atypical cheap titles are weak matches (kept)
Result-set statistics instead of word lists (`structure.ts` `typicality`): for each title, the
mean over its descriptive words (not query words, not words with digits, not the first word,
which is usually the brand) of min(1, df / (5% of the matching titles)). Listings of the product
share vocabulary across stores; "Baby Stroller Shaped Party Favors", "Coffee Machine Colored
Socks", a muslin blanket or a fly screen that names the product are made of words no other title
uses. A title under 0.5 typicality priced under 0.3 x the median of the matches is a weak match
(ranked last). The price condition keeps real products with short brand + model titles in place.
Swept: typicality 0.3/0.4/0.5/0.6, common share 3/5/10%, with and without the price condition,
digit and first-word exclusions; this was the best combined setting. Cost: hair dryer's cheapest
relevant item ("Hair Dryer Brush Model OK 723", 16 SAR) is demoted, so tuning cheapest-first
falls 100%→93.3% (still above target); coffee machine's rises to yes.
| set | p@10 | acc@10 | wrong@10 | recall | cheapest-first |
|---|---|---|---|---|---|
| tuning (15) | 98.7% | 0% | 1.3% | 92.1% | 93.3% |
| holdout (8) | 98.8% | 1.3% | 0% | 86.5% | 100% |
| holdout2 (6) | 93.3% | 3.3% | 0% | 89.3% | 66.7% |
| all (29) | 97.6% | 1.0% | 0.7% | 90.0% | 89.7% |

## 12e round 4: query only in a later title segment is a weak match (kept)
`structure.ts` `queryOnlyInLaterSegment`: the title's first " - " / " – " / " | " segment names
the query's product noun but not the whole query, and the whole query matches only in a later
segment: another product of the same line tagged with the queried one ("Nintendo Switch Online
GameCube Controller (Indigo) - (NS2) Nintendo Switch 2 [Pre-Owned]", 932 SAR, above the price
tier split). First tried without the product-noun condition: it also demoted "Samsung Renewed -
Galaxy S24 ..." and "Apple Renewed - iPad Air ..." (a seller prefix), costing samsung galaxy s24
and ipad air their cheapest-first; with the condition nothing else moves.
| set | p@10 | acc@10 | wrong@10 | recall | cheapest-first |
|---|---|---|---|---|---|
| tuning (15) | 98.7% | 0% | 1.3% | 92.1% | 93.3% |
| holdout (8) | 98.8% | 1.3% | 0% | 86.5% | 100% |
| holdout2 (6) | 95.0% | 1.7% | 0% | 89.3% | 83.3% |
| all (29) | 97.9% | 0.7% | 0.7% | 90.0% | 93.1% |

## 12e round 5: word lists removed where structure covers them (kept)
Greedy ablation on the dev set (remove one entry at a time, keep the removal when no set loses on
any metric): 38 of the 39 part nouns in `data/part-words.json` go, including all 15 added in 12d
(descaler, towel, rag, cloth, adhesive, clip(s), buckle(s), lock(s), laces, insole(s)) and the 12c
device parts (pad, mat, band, strap, diffuser, filter, dock, station, ...). Those items are now
caught by the accessory-word price test, the price tiers or the weak-match tier. Only "switch"
stays (keyboard p@10 80%→50% without it). The 12c book words (dummies, paperback, hardcover,
recipe book, cookbooks) go too (ISBN codes + weak tier). Kept because removal costs: macro keypad
words (keyboard p@10 80%→50%), trademark product lines in brands.json (ipad air p@10 100%→0%).
Recall rises slightly (fewer real products caught by a part word).
| set | p@10 | acc@10 | wrong@10 | recall | cheapest-first |
|---|---|---|---|---|---|
| tuning (15) | 98.7% | 0% | 1.3% | 92.3% | 93.3% |
| holdout (8) | 98.8% | 1.3% | 0% | 86.5% | 100% |
| holdout2 (6) | 95.0% | 1.7% | 0% | 89.8% | 83.3% |
| all (29) | 97.9% | 0.7% | 0.7% | 90.2% | 93.1% |

## 12e round 6: narrow accessory words removed (kept)
Same greedy ablation on `data/accessory-words.json` (the price-tested candidate vocabulary). It
would remove 40 of 61 words with recall 90.2%→90.6% and nothing else moving, but that includes
the generic accessory vocabulary of every category (strap, band, stand, adapter, bag, tempered
glass, lens, replacement, spare). Removing those because 29 queries do not need them would be
overfitting in the other direction, so only the 24 category-specific words go: mousepad, mat,
liner, tray, sprayer, dispenser, rack, mold, mould, bumper, puller, socket, station, clicker,
riser, nozzle, comb, hood, reader, cookbook, brushes, switches, feet, eartips.
| set | p@10 | acc@10 | wrong@10 | recall | cheapest-first |
|---|---|---|---|---|---|
| tuning (15) | 98.7% | 0% | 1.3% | 92.4% | 93.3% |
| holdout (8) | 98.8% | 1.3% | 0% | 86.5% | 100% |
| holdout2 (6) | 95.0% | 1.7% | 0% | 89.8% | 83.3% |
| all (29) | 97.9% | 0.7% | 0.7% | 90.2% | 93.1% |

## 12e final (after round 6)
| set | p@10 | acc@10 | wrong@10 | recall | cheapest-first |
|---|---|---|---|---|---|
| tuning (15) | 98.7% | 0% | 1.3% | 92.4% | 93.3% |
| holdout (8) | 98.8% | 1.3% | 0% | 86.5% | 100% |
| holdout2 (6) | 95.0% | 1.7% | 0% | 89.8% | 83.3% |
| all (29) | 97.9% | 0.7% | 0.7% | 90.2% | 93.1% |
Every target is met on every set except holdout2 cheapest-first (83.3% vs 85%). Its one miss is
baby stroller, whose cheapest item labelled relevant is a 10-pack of reflective patches (its
white twin is labelled accessory), so no correct ranking can pass it. Rounds 5 and 6 (list
removals) gave no p@10 gain; the work stopped after them with the targets otherwise met.

## Holdout 3 (6 unseen queries, after 12e, rules unchanged)
| p@10 | acc@10 | wrong@10 | recall | cheapest-first |
|---|---|---|---|---|
| 62% | 10% | 5% | 90% | 50% |
Failures: blender (p@10 0%: "beauty blender" makeup sponges are the cheapest), standing desk (20%: monitor stands, lap desks), noise cancelling headphones (wrong@10 30%: ANC earbuds). Rule tuning plateaus on new categories at 60–75%. Owner decision (2026-11-27): rank by match confidence first, then price.
