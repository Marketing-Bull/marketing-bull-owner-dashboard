import type { ExpenseFrequency } from "@/lib/types";

/** Yearly total for a recurring amount. `none` has no annual figure. */
export function annualizeExpense(amount: number, frequency: ExpenseFrequency): number | null {
  const factor = frequency === "weekly" ? 52 : frequency === "monthly" ? 12 : frequency === "quarterly" ? 4 : frequency === "yearly" ? 1 : null;
  return factor == null ? null : Number((amount * factor).toFixed(2));
}
