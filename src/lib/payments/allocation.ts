// Row-level allocation actions. Pure, immutable updates; shared rules only.
import type { AllocationRow } from "@/types/payments";
import { paiseToInput, toPaise } from "./money";

/** Can the user enter / change Payment Done on this row?
 *  - detailsUnavailable / detailsError: no (also enforced by validateAllocation).
 *  - rowError (failed in a previous bulk submit): no — the amount is kept
 *    unchanged so Retry failed resends exactly what failed. */
export function isAmountEditable(row: AllocationRow): boolean {
  return !row.detailsUnavailable && !row.detailsError && !row.rowError;
}

export function setRowAmount(row: AllocationRow, amount: string): AllocationRow {
  return isAmountEditable(row) ? { ...row, amount } : row;
}

/** Pay in Full: Payment Done = Payment Due (exact paise). A due that isn't
 *  valid money leaves the row unchanged (never guessed). */
export function payInFull(row: AllocationRow): AllocationRow {
  if (!isAmountEditable(row)) return row;
  const due = toPaise(row.config.payment_due);
  if (due === null || due <= 0) return row;
  return { ...row, amount: paiseToInput(due) };
}

/** Clear applied amount: reset Payment Done on every editable row. */
export function clearAppliedAmounts(rows: AllocationRow[]): AllocationRow[] {
  return rows.map((r) => (isAmountEditable(r) && r.amount !== "" ? { ...r, amount: "" } : r));
}
