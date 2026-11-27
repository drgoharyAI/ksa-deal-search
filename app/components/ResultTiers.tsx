import type { Product } from "@/src/lib/types";
import { isLikelyMatch } from "@/src/lib/rank";
import ResultCard from "./ResultCard";

function Grid({ products }: { products: Product[] }) {
  return (
    <ul className="grid">
      {products.map((p) => (
        <li key={`${p.site}+${p.id}`}>
          <ResultCard product={p} />
        </li>
      ))}
    </ul>
  );
}

/**
 * Ranked results (rank() puts confident matches first). The less likely matches after them get
 * their own heading, so a cheaper doubtful item never reads as the best deal.
 */
export default function ResultTiers({ products }: { products: Product[] }) {
  const split = products.findIndex((p) => !isLikelyMatch(p));
  if (split < 0) return <Grid products={products} />;
  return (
    <>
      {split > 0 && <Grid products={products.slice(0, split)} />}
      <div className="results__divider">
        <h3>Less likely matches</h3>
        <p className="results__note">These name your search but may be a different item, a part or an accessory.</p>
      </div>
      <Grid products={products.slice(split)} />
    </>
  );
}
