const NBSP = " ";

/** "SAR 1,299" or "SAR 12.50": the item's own currency code, a no-break space, en-US digits. */
export function formatMoney(n: number, currency = "SAR"): string {
  const digits = Number.isInteger(n) ? 0 : 2;
  const num = n.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: 2 });
  return `${currency || "SAR"}${NBSP}${num}`;
}
