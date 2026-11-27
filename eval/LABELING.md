# Labelling rubric (Task 12b)

Label every normalized product recorded for a query. Use the key `<site>:<id>`.

- **relevant**: the product the shopper is looking for, in the requested category, matching every hard attribute in the query. Price, rating and `-word` constraints do NOT affect the label; the metrics apply those separately. Bundles of the main product (e.g. "earbuds + case") count as relevant.
- **accessory**: an add-on, part, case, cover, strap, cable, charger, protector, stand, tool or replacement part for the product type, rather than the product itself.
- **wrong-model**: the right category but the wrong specific model, generation or spec the query names. Examples: "iphone 16" → iPhone 15 or 16e; "samsung galaxy s24" → S23 or S24 FE; "4k monitor 27" → a 1080p or 32" monitor; "power bank 20000mah" → 10000mAh; "usb-c cable 100w" → a 60W cable. Use this only when the query names a model or spec.
- **off-topic**: anything else (a different category, junk, a toy, a sticker, an unrelated item).

Edge rules:
- A clone or "replica" that claims to be the named brand/model ("i16 pro max smartphone") → wrong-model.
- Model families: "iphone 16" → 16 / 16 Plus / 16 Pro / 16 Pro Max all count as relevant (16e is wrong-model). "samsung galaxy s24" → S24 / S24+ / S24 Ultra count as relevant (S24 FE is wrong-model).
- A title that is only a brand word ("Samsung", "Apple") → off-topic.
- Ambiguous titles: decide from the words in the title alone. Don't guess from price.
- "anc earbuds" means true-wireless earbuds with active noise cancelling. Wired earphones → off-topic. Earbuds without ANC → wrong-model.
- "mechanical keyboard" → keyboards with mechanical switches. Keycaps, switches, tools → accessory. Membrane keyboards → wrong-model.
- "ps5 controller" → a DualSense, or a third-party controller made for PS5. Charging docks and skins → accessory.
