// Currency symbol for amount display, from the rows' rDash currency objects.
import type { AllocationRow } from "@/types/payments";

/** The single currency symbol of the rows, or null when rows are empty or
 *  mixed (mixed currencies can't be summed — CLAUDE.md Open Items). */
export function rowsCurrency(rows: Pick<AllocationRow, "config">[]): { symbol: string | null; mixed: boolean } {
  const symbols = new Set(rows.map((r) => r.config.currency?.symbol).filter((s): s is string => typeof s === "string" && s !== ""));
  if (symbols.size === 1) return { symbol: Array.from(symbols)[0], mixed: false };
  return { symbol: null, mixed: symbols.size > 1 };
}
