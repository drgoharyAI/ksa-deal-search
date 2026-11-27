import type { Product } from "@/src/lib/types";
import { isLikelyMatch } from "@/src/lib/rank";
import { leadOf, type ViewItem } from "@/src/lib/view";
import { productKey } from "@/src/lib/specs";
import ResultCard, { type CardVariant } from "./ResultCard";
import GroupCard from "./GroupCard";

/**
 * Compare checkboxes on the cards: which products are ticked, and the toggle. Pass a stable
 * `onToggle` (it is handed to the memoized cards as is).
 */
export type CompareProps = { isChecked: (p: Product) => boolean; onToggle: (p: Product) => void };

type GridProps = { items: ViewItem[]; query?: string; compare?: CompareProps; view?: CardVariant };

function Grid({ items, query, compare, view = "grid" }: GridProps) {
  return (
    <ul className={view === "list" ? "grid grid--list" : "grid"} role="list">
      {items.map((it) => {
        const lead = leadOf(it);
        const cmp = compare && { compareChecked: compare.isChecked(lead), onCompare: compare.onToggle };
        return it.kind === "group" ? (
          <li key={it.key} className="grid__wide">
            <GroupCard group={it} query={query} {...cmp} comparedRows={compare && it.rows.filter(compare.isChecked).map(productKey).join(" ")} />
          </li>
        ) : (
          <li key={it.key}>
            <ResultCard product={it.product} query={query} variant={view} {...cmp} />
          </li>
        );
      })}
    </ul>
  );
}

const single = (p: Product): ViewItem => ({ kind: "product", key: `${p.site}+${p.id}`, product: p });

/**
 * Ranked results (rank() puts confident matches first). The less likely matches after them get
 * their own heading, so a cheaper doubtful item never reads as the best deal. `items` (cards,
 * cross-store groups included) wins over `products` (one card each).
 */
export default function ResultTiers({ products, items: given, query, compare, view }: { products?: Product[]; items?: ViewItem[]; query?: string; compare?: CompareProps; view?: CardVariant }) {
  const items = given ?? (products ?? []).map(single);
  const split = items.findIndex((it) => !isLikelyMatch(leadOf(it)));
  if (split < 0) return <Grid items={items} query={query} compare={compare} view={view} />;
  return (
    <>
      {split > 0 && <Grid items={items.slice(0, split)} query={query} compare={compare} view={view} />}
      <div className="results__divider">
        <h3>Less likely matches</h3>
        <p className="results__note">These name your search but may be a different item, a part or an accessory.</p>
      </div>
      <Grid items={items.slice(split)} query={query} compare={compare} view={view} />
    </>
  );
}
