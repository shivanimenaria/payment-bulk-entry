// Row-level allocation actions. Pure, immutable updates; shared rules only.
import type { AllocationRow } from "@/types/payments";
import { MAX_SUBMIT_UNITS, parseRdashAmount, unitsToDecimalString } from "./money";

export const AMOUNT_INVALID_MESSAGE = "Invalid amount from rDash";
export const DUE_OVER_LIMIT_MESSAGE = "Payment due exceeds the bulk API limit";

/** Why a row can't take a payment, from its rDash amounts (null = fine):
 *  - any of request / paid / due not a valid rDash amount (DECIMAL(33,4)) →
 *    "Invalid amount from rDash" — excluded from totals;
 *  - payment_due above the POST bulk limit (99999999999999999999.9999) →
 *    "Payment due exceeds the bulk API limit" — shown normally and STILL
 *    counted in Total Due, but Pay in Full / Payment Done are disabled. */
export function rowAmountIssue(row: Pick<AllocationRow, "config">): string | null {
  const results = [row.config.request_amount, row.config.paid_amount, row.config.payment_due].map(parseRdashAmount);
  if (results.some((r) => !r.ok)) return AMOUNT_INVALID_MESSAGE;
  const due = results[2];
  if (due.ok && due.units > MAX_SUBMIT_UNITS) return DUE_OVER_LIMIT_MESSAGE;
  return null;
}

/** Can the user enter / change Payment Done on this row?
 *  - detailsUnavailable / detailsError: no (also enforced by validateAllocation).
 *  - an amount PBE can't process (rowAmountIssue): no.
 *  - rowError (failed in a previous bulk submit): no — the amount is kept
 *    unchanged so Retry failed resends exactly what failed. */
export function isAmountEditable(row: AllocationRow): boolean {
  return !row.detailsUnavailable && !row.detailsError && !row.rowError && rowAmountIssue(row) === null;
}

export function setRowAmount(row: AllocationRow, amount: string): AllocationRow {
  return isAmountEditable(row) ? { ...row, amount } : row;
}

/** Pay in Full: Payment Done = Payment Due (exact units). A due that isn't
 *  valid money leaves the row unchanged (never guessed). */
export function payInFull(row: AllocationRow): AllocationRow {
  if (!isAmountEditable(row)) return row;
  const due = parseRdashAmount(row.config.payment_due);
  if (!due.ok || due.units <= BigInt(0) || due.units > MAX_SUBMIT_UNITS) return row;
  return { ...row, amount: unitsToDecimalString(due.units) };
}

/** Clear applied amount: reset Payment Done on every editable row. */
export function clearAppliedAmounts(rows: AllocationRow[]): AllocationRow[] {
  return rows.map((r) => (isAmountEditable(r) && r.amount !== "" ? { ...r, amount: "" } : r));
}

/** Remove a failed (rowError) row from the pending payment: amount cleared,
 *  error cleared, editable again; the remark (and its override flag) is kept.
 *  Pair with removeFailedId (retry.ts) so Retry failed no longer sends it.
 *  Rows without rowError are returned unchanged. */
export function dismissFailedRow(row: AllocationRow): AllocationRow {
  if (!row.rowError) return row;
  return { ...row, amount: "", rowError: null, rowStatus: "idle" };
}
